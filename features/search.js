// Search in the command palette on Canvas (enhance.search), loaded on demand when the palette opens: content.js (openCmd)
// calls attach(cmd, show). From 2 characters, after a 150 ms pause, your courses are asked for pages, assignments,
// discussions, announcements, modules and files whose titles match (lib/seek.js): this course and this term's first. What
// comes back joins the list as it arrives below what is already there, so nothing moves under the cursor, and each
// keystroke cancels what was still being asked. Turning the setting (or Glaze) off stops it at once. Answers are kept in memory for five minutes, on this page only. Read-only GETs to this Canvas.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_SEARCH = globalThis.GZ_SEARCH || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  let kept = null;
  let quit = null; // stops the open palette's search
  // Whether Glaze and this search are on, as storage has it: content.js's own copy of the settings can lag behind a
  // change. Read from storage when the palette attaches, then followed through every change, even one that comes while
  // lib/seek.js is still loading (a change seen while that read is out wins over the read). Switched off in the popup or
  // the editor while the palette is open, what is running stops at once.
  let stored = { enabled: true, search: true }, changes = 0;
  const allowed = () => ctx.on() && stored.enabled && stored.search;
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'sync' || !(ch.enabled || ch.enhance)) return;
      changes++;
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
    const seen = changes;
    const [, r] = await Promise.all([ctx.need('lib/seek.js', () => globalThis.GZ_SEEK), fromStorage()]);
    if (r && seen === changes) stored = { enabled: r.enabled !== false, search: r.enhance?.search !== false };
    if (!cmd.box.isConnected || cmd.stop || !allowed()) return;
    const S = globalThis.GZ_SEEK;
    kept ||= S.cache();
    // Screen readers hear the count once the search is done, not every arrival.
    const live = document.createElement('p');
    live.className = 'screenreader-only';
    live.setAttribute('aria-live', 'polite');
    cmd.list.after(live);
    let wait = 0, ctl = null, last = '';
    cmd.stop = () => { clearTimeout(wait); ctl?.abort(); };
    quit = () => {
      if (!cmd.box.isConnected) return;
      last = '';
      cmd.stop();
      cmd.found = null;
      cmd.seeking = false;
      live.textContent = '';
      show();
    };
    const run = async (term) => {
      if (!allowed()) return void quit();
      const c = (ctl = new AbortController());
      const courses = S.order(await ctx.canvasCourses(), ctx.canvasCourseId(), Date.now());
      const n = await S.search({
        term, courses, cache: kept, signal: c.signal, get: (p) => get(p, c.signal),
        onBatch: (rs) => {
          cmd.found.push(...rs.map((r) => ({ label: r.title, hint: r.course, group: r.kind, run: () => location.assign(r.url) })));
          show(true);
        },
      });
      if (c.signal.aborted) return;
      cmd.seeking = false;
      show(true);
      live.textContent = n ? t('Results from your courses: {n}', { n }) : t('Nothing found in your courses.');
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
