// Search in the command palette on Canvas (enhance.search), loaded on demand when the palette opens: content.js (openCmd)
// calls attach(cmd, show). From 2 characters, after a 150 ms pause, your courses are asked for pages, assignments,
// discussions, announcements, modules and files whose titles match (lib/seek.js): this course and this term's first. What
// comes back joins the end of the list as it arrives, so nothing moves under the cursor, and each keystroke cancels what
// was still being asked. Answers are kept in memory for five minutes, on this page only. Read-only GETs to this Canvas.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_SEARCH = globalThis.GZ_SEARCH || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  let kept = null;
  const get = (path, signal) => fetch(`${location.origin}/api/v1${path}`, { credentials: 'same-origin', headers: { accept: 'application/json+canvas-string-ids' }, signal })
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then((s) => JSON.parse(s.replace(/^while\(1\);/, '')));

  // cmd is the open palette ({ input, list, found, seeking, stop }); show(true) redraws it keeping the choice where it is.
  const attach = async (cmd, show) => {
    await ctx.need('lib/seek.js', () => globalThis.GZ_SEEK);
    if (!cmd.box.isConnected || cmd.stop) return;
    const S = globalThis.GZ_SEEK;
    kept ||= S.cache();
    // Screen readers hear the count once the search is done, not every arrival.
    const live = document.createElement('p');
    live.className = 'screenreader-only';
    live.setAttribute('aria-live', 'polite');
    cmd.list.after(live);
    let wait = 0, ctl = null, last = '';
    cmd.stop = () => { clearTimeout(wait); ctl?.abort(); };
    const run = async (term) => {
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
    const input = () => {
      const term = S.term(cmd.input.value);
      if (term === last) return;
      last = term;
      cmd.stop();
      live.textContent = '';
      cmd.found = term ? [] : null;
      cmd.seeking = !!term;
      show();
      if (term) wait = setTimeout(() => run(term), 150);
    };
    cmd.input.addEventListener('input', input);
    input(); // what was typed while this loaded
  };
  return { attach };
})();

GZ_SEARCH;
