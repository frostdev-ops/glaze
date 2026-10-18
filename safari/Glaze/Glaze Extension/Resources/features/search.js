// Search in the command palette on Canvas and Ultra (enhance.search), loaded on demand when the palette opens. The palette
// calls attach(cmd, show). From 2 characters, after a 150 ms pause, your courses are asked for pages, assignments,
// discussions, announcements, modules and files whose titles match (lib/seek.js). Ultra uses its public content tree,
// announcements and discussion lists, matching titles and their public body text on the device: this course and this term's first. What
// comes back joins the list as it arrives below what is already there, so nothing moves under the cursor, and each
// keystroke cancels what was still being asked. Turning the setting (or Glaze) off stops it at once. Answers are kept in
// memory for five minutes, on this page only. Read-only GETs to this LMS.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_SEARCH = globalThis.GZ_SEARCH || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const ultra = ctx.site === 'ultra';
  let kept = null, sources = null;
  const retry = new Map();
  let quit = null; // stops the open palette's search
  // Whether Glaze and this search are on, as storage has it: content.js's own copy of the settings can lag behind a
  // change. Read from storage when the palette attaches, then followed through every change, even one that comes while
  // lib/seek.js is still loading (a change seen wins over the read, which only fills in what no change has said).
  // Unknown is off: a read that fails leaves it off. content.js's copy saying off is off too. Switched off in the popup
  // or the editor while the palette is open, what is running stops at once.
  const stored = { enabled: undefined, search: undefined };
  const allowed = () => ctx.on() && stored.enabled === true && stored.search === true && ctx.settings().enhance.search !== false;
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync' || !(ch.enabled || ch.enhance)) return;
      if (ch.enabled) stored.enabled = ch.enabled.newValue !== false;
      if (ch.enhance) stored.search = ch.enhance.newValue?.search !== false;
      if (!allowed()) quit?.();
    });
  } catch { /* extension reloaded under the tab */ }
  const fromStorage = () => new Promise((res) => {
    try { chrome.storage.sync.get(['enabled', 'enhance'], (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); }
  });
  const get = (path, signal) => fetch(`${location.origin}/api/v1${path}`, { credentials: 'same-origin', headers: { accept: 'application/json+canvas-string-ids' }, signal })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then((s) => JSON.parse(s.replace(/^while\(1\);/, '')));

  // cmd is the open palette ({ input, list, found, seeking, stop }); show(true) redraws it keeping the choice where it is.
  const attach = async (cmd, show) => {
    const [, r] = await Promise.all([ctx.need('lib/seek.js', () => globalThis.GZ_SEEK), fromStorage(),
      ...(ultra ? [ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA), ctx.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT)] : [])]);
    if (r) {
      stored.enabled ??= r.enabled !== false;
      stored.search ??= r.enhance?.search !== false;
    }
    if (!cmd.box.isConnected || cmd.stop || !allowed()) return;
    const S = globalThis.GZ_SEEK;
    if (!ultra) kept ||= S.cache();

    // Screen readers hear the count once the search is done, not every arrival.
    const live = document.createElement('p');
    live.className = 'screenreader-only';
    live.setAttribute('aria-live', 'polite');
    cmd.list.after(live);
    let wait = 0, ctl = null, last = '';
    cmd.stop = () => { clearTimeout(wait); ctl?.abort(); };
    quit = () => {
      kept = sources = null; // switched off with the palette closed too: nothing cached outlives "off"
      retry.clear();
      if (!cmd.box.isConnected) return;
      last = '';
      cmd.stop();
      cmd.found = null;
      cmd.searchNote = '';
      cmd.seeking = false;
      live.textContent = '';
      show();
    };
    const run = async (term) => {
      if (!allowed()) return void quit();
      const c = (ctl = new AbortController());
      try {
        let courses, adapter = {}, complete = true;
        if (ultra) {
          const U = globalThis.GZ_ULTRA;
          // shortcut: at most 30 requests per query and two pages (400 rows) per list; raise only after measuring large schools.
          const r = U.read({ origin: location.origin, signal: c.signal, maxPages: 2, maxRequests: 30 });
          sources ||= S.cache(300000, 301);
          let courseSource = sources.get('courses');
          if (!courseSource) {
            const mem = await ctx.myCourses();
            if (c.signal.aborted) return;
            const terms = await r.terms().catch(() => { complete = false; return []; });
            if (c.signal.aborted) return;
            courses = Object.entries(U.courses(mem, { terms })).filter(([, x]) => !x.org)
              .map(([id, x]) => ({ id, name: x.name, course_code: x.code, term: x.term, closed: x.closed }));
            courseSource = { rows: courses, complete: complete && mem.complete !== false && terms.complete !== false };
            if (courses.length) sources.set('courses', courseSource); // a failed lookup answers [] (content-ultra.js myCourses): ask again
          }
          courses = courseSource.rows;
          complete = courseSource.complete;
          // shortcut: first 100 open current-term courses, so all three source lists fit the 301-entry cache.
          const now = Date.now(), here = ctx.courseId();
          const eligible = S.order(courses.filter((x) => !x.closed && (x.id === here || !x.term || S.current(x, now))), here, now, (id) => /^_\d+_\d+$/.test(id));
          if (eligible.length > 100) complete = false;
          courses = eligible.slice(0, 100);
          adapter = { kinds: U.SEARCH_KINDS, conc: 3, load: async (course, k) => {
            const key = `${course.id}|${k.kind}`;
            let source = sources.get(key);
            if (!source) {
              if (Date.now() < (retry.get(key) || 0)) { complete = false; return []; }
              try {
                const rows = await r.search(course, k, (html) => GZ_DOCTEXT.html(html));
                source = { complete: rows.complete !== false, rows: rows.map(({ text, ...row }) => ({ ...row, index: S.fold(`${row.title} ${text}`) })) };
                retry.delete(key);
              } catch (e) {
                if (c.signal.aborted || e.message === 'Ultra request budget') { complete = false; return []; }
                if (!/^HTTP (403|404)$/.test(e.message)) { complete = false; retry.set(key, Date.now() + (e.message === 'HTTP 429' ? 30000 : 3000)); return []; }
                source = { rows: [], complete: true };
              }
              if (c.signal.aborted) return [];
              sources.set(key, source);
            }
            if (!source.complete) complete = false;
            const q = S.fold(term);
            return source.rows.filter((x) => x.until >= Date.now() && x.index.includes(q));
          } };
        } else { kept ||= S.cache(); courses = S.order(await ctx.canvasCourses(), ctx.canvasCourseId(), Date.now()); }
        const n = await S.search({
          term, courses, cache: ultra ? null : kept, signal: c.signal, get: (p) => get(p, c.signal), ...adapter,
          onBatch: (rs) => {
            cmd.found.push(...rs.map((r) => ({ label: r.title, hint: r.course, group: r.kind, run: () => location.assign(r.url) })));
            show(true);
          },
        });
        if (!c.signal.aborted) {
          cmd.searchNote = complete ? '' : t('Search is partial. Narrow your query or open a course to search further.');
          live.textContent = [n ? t('Results from your courses: {n}', { n }) : complete ? t('Nothing found in your courses.') : '', cmd.searchNote].filter(Boolean).join(' ');
        }
      } catch { /* unavailable tools or a signed-out session leave the ordinary palette usable */ }
      if (c.signal.aborted) return;
      cmd.seeking = false;
      show(true);
    };
    // After content.js's own redraw for the same keystroke: a new term clears the old results and starts the pause.
    // First (what was typed while this loaded): the rows already on screen stay where they are, "Searching…" below them.
    const input = (first) => {
      const term = allowed() ? S.term(cmd.input.value) : '';
      if (term === last) return;
      last = term;
      cmd.stop();
      live.textContent = '';
      cmd.found = term ? [] : null;
      cmd.searchNote = '';
      cmd.seeking = !!term;
      if (first === true && term) cmd.head = cmd.shown.slice();
      show(first === true);
      if (term) wait = setTimeout(() => run(term), 150);
    };
    cmd.input.addEventListener('input', input);
    input(true);
  };
  return { attach };
})();

GZ_SEARCH;
