// Assignment and discussion rubrics, read with the student's session. The site's controls stay in place and work until a complete
// rubric is ready; the same read-only table goes inline or into Glaze's shared pop-up. Loaded by features/routes.js.
var GZ_RUBRIC_UI = globalThis.GZ_RUBRIC_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  const html = document.documentElement, t = ctx.t;
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
  const CSS = `:host { display:block; min-width:0; max-width:100%; color:var(--gz-ink,#1d2733); font:1rem/1.5 var(--gz-font,system-ui,sans-serif); }
* { box-sizing:border-box; } section { min-width:0; } h2 { margin:0 0 .75em; font:600 1.05em/1.3 var(--gz-font-head,var(--gz-font,system-ui)); color:inherit; }
.scroll { max-width:100%; overflow-x:auto; overscroll-behavior-x:contain; border:1px solid var(--gz-line,#c8d0db); border-radius:var(--gz-radius-sm,8px); background:var(--gz-surface,#fff); }
table { width:100%; border-collapse:collapse; table-layout:fixed; color:inherit; } caption { padding:.75em; font-weight:600; text-align:start; overflow-wrap:anywhere; }
th,td { padding:.75em; border-block-start:1px solid var(--gz-line,#c8d0db); border-inline-end:1px solid var(--gz-line,#c8d0db); text-align:start; vertical-align:top; overflow-wrap:anywhere; }
tr > :last-child { border-inline-end:0; } thead th { background:var(--gz-surface-2,#edf1f5); font-weight:600; } tbody th { font-weight:500; }
th:first-child { width:11em; } .detail { margin:.4em 0 0; font-size:.9em; font-weight:400; } .detail > :first-child { margin-top:0; } .detail > :last-child { margin-bottom:0; }
.detail p { margin:.4em 0; } section > .detail { margin:0 0 .75em; } .detail img { max-width:100%; height:auto; } .detail pre { white-space:pre-wrap; } a { color:var(--gz-accent,#086bc1); }
.value,.score,.weight,.unscored { margin:.4em 0 0; font-size:.85em; font-weight:500; } .value { color:var(--gz-ink-muted,#526174); }
td[aria-current] { background:var(--gz-accent-soft,#e2f2ff); box-shadow:inset 0 0 0 2px var(--gz-accent,#086bc1); }
.selected { display:block; margin-top:.5em; font-size:.8em; font-weight:600; } .feedback { font-weight:400; } .feedback strong { font-weight:600; }
.total { margin:.75em 0 0; font-weight:600; } :focus-visible { outline:2px solid var(--gz-accent,#086bc1); outline-offset:3px; }
@media print { .scroll { overflow:visible; } table { min-width:0!important; } }`;
  let R, wanted = false, active = null, cached = null, epoch = 0, pending = null, queued = false, stopped = false, masterOff = false, changedPrefs;
  const ready = Promise.all([
    ctx.need('lib/rubric.js', () => globalThis.GZ_RUBRIC_LIB),
    ctx.need('lib/lmsq.js', () => globalThis.GZ_LMSQ),
    ctx.need('features/popup.js', () => globalThis.GZ_POPUP).then(() => GZ_POPUP.ready),
  ]).then(() => { R = globalThis.GZ_RUBRIC_LIB; if (wanted) sync(); });
  ready.catch(() => {});
  const shown = (e) => !!e?.isConnected && !!e.getClientRects().length && !e.closest('[hidden], [inert], [aria-hidden="true"]');
  const visible = () => !document.hidden && !(ctx.tabFrame && html.hasAttribute('data-gz-ctab-framed'));
  const prefs = () => changedPrefs ?? ctx.settings().rubric ?? {};
  const mode = () => R?.mode({ rubric: prefs() });
  const here = () => location.pathname + location.search;
  const eligible = () => !stopped && !masterOff && wanted && ctx.on() && ctx.solo && visible() && mode() !== 'site';
  const plain = (e) => !e.defaultPrevented && e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
  const blockedCanvas = () => {
    const q = new URLSearchParams(location.search);
    if (['reviewee_id', 'anonymous_asset_id', 'user_id', 'student_id', 'assessment_user_id', 'reviewer_id', 'assessment_request'].some((k) => q.has(k))) return true;
    return !!document.querySelector('#observer-picker-mountpoint, [data-testid="peer-review-rubric-alert"], [data-testid="view-rubric-button"], .assessment_request_completed_message, .assessment_request_incomplete_message');
  };
  const host = (route) => {
    if (ctx.site === 'ultra') {
      if (route.view !== 'overview') {
        // A discussion's Details panel and the attempt page View instructions opens have no room beside the link: Glaze's
        // pop-up opens from it in place of Ultra's Rubric Details panel.
        const links = [...document.querySelectorAll(route.view === 'discussion'
          ? 'a.rubric-title[analytics-id="components.directives.discussionSettings.gradedWithRubric.li"]'
          : 'a[data-analytics-id="assignment.attempt.authoring.rubric.view.link"]')].filter((e) => shown(e) || active?.link === e);
        return links.length === 1 ? { box: links[0].parentElement, row: links[0], link: links[0], inline: false } : null;
      }
      const links = [...document.querySelectorAll('.assessment-details-section li.js-rubric-overview a.graded-with-rubric-button[analytics-id="course.content.assessment.overview.gradedWithRubric"]')].filter((e) => shown(e) || active?.link === e);
      if (links.length !== 1) return null;
      const link = links[0];
      const row = link?.closest('li.js-rubric-overview'), box = row?.closest('.assessment-details-section');
      if (!box || !shown(box) || !shown(link) && active?.link !== link || row.querySelector('form, input, select, textarea, [contenteditable], [role="textbox"]')) return null;
      return { box, row, link, inline: true };
    }
    if (blockedCanvas() || !document.querySelector('#assignments-2-student-header')) return null;
    const box = document.querySelector('[data-testid="rubric-tab"]'), toggle = box?.querySelector('[data-testid="fill-out-rubric-toggle"]');
    const link = toggle?.matches('button[aria-expanded]') ? toggle : toggle?.querySelector('button[aria-expanded]');
    if (!link || link.getAttribute('aria-expanded') !== 'false' || !shown(link) || shown(box.querySelector('[data-testid="rubric-preview"]'))
      || box.querySelector('input, textarea, select, [contenteditable], .save_rubric_button')) return null;
    return { box, row: toggle, link, inline: false };
  };
  const number = (n) => new Intl.NumberFormat(typeof ctx.locale === 'function' ? ctx.locale() : undefined, { maximumFractionDigits: 2 }).format(n);
  const quantified = (n, kind) => `${number(n)}${kind.startsWith('percent') ? '%' : ` ${t('Points')}`}`;
  const value = (v, kind) => !v ? '' : v.n != null ? quantified(v.n, kind)
    : `${number(v.hi)} – ${v.loExclusive ? '>' : ''}${quantified(v.lo, kind)}`;
  const detail = (text, model, format) => {
    if (!text) return null;
    const e = make('div', { className: 'detail' });
    e.append(...(format === 'text' || model.site === 'canvas' ? [text] : GZ_POPUP.safe(text, location.origin)));
    return e;
  };
  const table = (m, inline) => {
    const node = make('div', { id: inline ? 'gz-rubric' : '', className: 'gz-rubric' }), root = node.attachShadow({ mode: 'closed' });
    const section = make('section'), heading = make('h2', { textContent: t('Rubric') });
    const caption = make('caption', { id: 'gz-rubric-caption', textContent: m.title || t('Rubric') });
    const grid = make('table', {}, caption), levels = m.levels.length ? m.levels : [{ id: '', label: t('Feedback') }];
    grid.style.minWidth = `${11 + levels.length * 8}em`;
    const headers = make('tr');
    const th = (text, scope) => { const e = make('th', { textContent: text }); e.setAttribute('scope', scope); return e; };
    headers.append(th(t('Criterion'), 'col'), ...levels.map((l, i) => th(l.label || t('Rating {n}', { n: i + 1 }), 'col')));
    grid.append(make('thead', {}, headers));
    const body = make('tbody');
    for (const row of m.criteria) {
      const result = m.result?.criteria?.[row.id], name = th(row.label, 'row');
      name.append(...[detail(row.detail, m), row.unscored && make('p', { className: 'unscored', textContent: t('Not scored') })].filter(Boolean));
      if (!m.hidePoints) {
        if (row.weight != null) name.append(make('p', { className: 'weight', textContent: `${t('Weight')}: ${number(row.weight)}%` }));
        if (result?.score != null) name.append(make('p', { className: 'score', textContent: `${t('Score')}: ${quantified(result.score, m.kind)}` }));
        else if (row.points != null && !m.kind.startsWith('percent')) name.append(make('p', { className: 'value', textContent: quantified(row.points, m.kind) }));
      }
      const tr = make('tr', {}, name);
      for (let i = 0; i < levels.length; i++) {
        const c = row.cells[i], cell = make('td');
        if (c) {
          if (c.label && c.label !== levels[i].label) cell.append(make('strong', { textContent: c.label }));
          const text = detail(c.detail, m); if (text) cell.append(text);
          if (!m.hidePoints && c.value) cell.append(make('p', { className: 'value', textContent: value(c.value, m.kind) }));
          if (result?.cell && result.cell === c.id) { cell.setAttribute('aria-current', 'true'); cell.append(make('span', { className: 'selected', textContent: t('Selected') })); }
        }
        tr.append(cell);
      }
      body.append(tr);
      if (result?.comment) {
        const cell = make('td', { className: 'feedback' }, make('strong', { textContent: t('Feedback') }), detail(result.comment, m, m.result.commentFormat));
        cell.colSpan = levels.length + 1; body.append(make('tr', {}, cell));
      }
    }
    grid.append(body);
    const scroll = make('div', { className: 'scroll', tabIndex: 0 }, grid);
    scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-labelledby', caption.id);
    if (inline) section.append(heading);
    const instructions = detail(m.detail, m); if (instructions) section.append(instructions);
    section.append(scroll);
    if (!m.hidePoints && !m.hideTotal && (m.result?.score != null || m.total != null)) {
      const score = m.result?.score, total = m.result?.possible ?? m.total;
      const text = score != null && total != null ? `${number(score)} / ${quantified(total, 'points')}` : quantified(score ?? total, 'points');
      section.append(make('p', { className: 'total', textContent: `${t('Total')}: ${text}` }));
    }
    root.append(make('style', { textContent: CSS }), section);
    return node;
  };
  const unmount = (a) => {
    const focused = a.node && document.activeElement === a.node;
    a.node?.remove(); a.node = null;
    for (const e of a.hidden || []) e.removeAttribute('data-gz-rubric-hidden');
    a.hidden = []; a.sheet?.remove(); a.sheet = null; a.inlineNow = false;
    if (focused && a.path === here() && shown(a.link)) a.link.focus({ preventScroll: true });
  };
  const clear = (forget = false) => {
    if (forget) cached = null;
    ++epoch; pending?.abort(); pending = null;
    const a = active; active = null;
    if (!a) return;
    a.resize?.disconnect(); a.popup?.close(true); unmount(a);
  };
  const layout = (a) => {
    if (active !== a || !a.model || !a.box.isConnected || a.popup?.isOpen()) return;
    const css = getComputedStyle(a.box);
    const width = a.box.clientWidth - parseFloat(css.paddingLeft || 0) - parseFloat(css.paddingRight || 0);
    const font = Math.max(16, parseFloat(css.fontSize) || 16);
    const inline = a.inline && mode() === 'auto-inline' && R.room(width, a.model, font, a.inlineNow);
    if (a.node && a.node.style.fontSize !== `${font}px`) a.node.style.fontSize = `${font}px`;
    if (inline === !!a.node || document.activeElement === a.link || a.node && document.activeElement === a.node) return;
    if (!inline) { unmount(a); return; }
    a.node = table(a.model, true); a.node.style.fontSize = `${font}px`; a.inlineNow = true;
    const list = a.row.parentElement;
    a.hidden = [a.row];
    if (list?.matches('ul.section-content') && list.children.length === 1) {
      a.hidden = [list, ...[...a.box.children].filter((e) => e.matches('.grid-item-label, h2.section-label'))];
    }
    a.sheet = make('style', { textContent: '[data-gz-rubric-hidden] { display:none!important; }' });
    for (const e of a.hidden) e.setAttribute('data-gz-rubric-hidden', '');
    a.box.append(a.sheet, a.node);
  };
  const get = async (url, signal, live) => {
    const res = await GZ_LMSQ.fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'error', signal, headers: { accept: 'application/json' } }, 0, live);
    if (!live()) throw Error('stale');
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const text = await res.text(); if (!live()) throw Error('stale');
    return JSON.parse(text.replace(/^while\(1\);/, ''));
  };
  const load = async (route, uid, signal, live) => {
    if (ctx.site === 'canvas') {
      if (!/^\d+$/.test(uid)) return null;
      const path = `${location.origin}/api/v1/courses/${route.courseId}/assignments/${route.assignmentId}`;
      const assignment = await get(path, signal, live);
      let submission = null;
      try { submission = await get(`${path}/submissions/self?include[]=rubric_assessment&include[]=full_rubric_assessment`, signal, live); } catch (e) { if (!live()) throw e; }
      return R.parse.canvas(assignment, submission, { courseId: route.courseId, assignmentId: route.assignmentId, userId: uid });
    }
    await ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA); if (!live()) throw Error('stale');
    const reader = GZ_ULTRA.read({ origin: location.origin, signal, live, f: (...args) => GZ_LMSQ.fetch(...args, 0, live), maxPages: 3, maxRequests: 6 });
    const rows = await reader.grades(route.courseId, uid);
    const matches = rows.filter((g) => g?.column?.contentId === route.contentId && g.courseId === route.courseId && g.userId === uid);
    if (matches.length !== 1) return null;
    const row = matches[0], columnId = row.columnId;
    if (!/^_\d+_\d+$/.test(columnId)) return null;
    const column = await reader.get(`/learn/api/v1/courses/${route.courseId}/gradebook/columns/${columnId}?expand=associatedRubrics`);
    if (column.id !== columnId || column.courseId !== route.courseId || column.contentId && column.contentId !== route.contentId) return null;
    if (!Array.isArray(column.rubricAssociations) || column.rubricAssociations.length !== 1) return null;
    const association = column.rubricAssociations[0], attemptId = row.lastAttemptId;
    let attempt = null;
    if (attemptId) {
      if (!/^_\d+_\d+$/.test(attemptId)) return null;
      try { attempt = await reader.get(`/learn/api/v1/courses/${route.courseId}/gradebook/attempts/${attemptId}?columnId=${columnId}&expand=viewUrl,toolAttemptDetail,feedbackToUser`); }
      catch (e) { if (!live()) throw e; return null; }
      if (attempt.id !== attemptId || attempt.courseId !== route.courseId || attempt.userId !== uid) return null;
    }
    // The student's grade row releases selections; column settings and display grades cannot release a new attempt.
    const evaluation = attempt?.status === 'COMPLETED' ? attempt.rubricEvaluation : null;
    const graded = row.status === 'GRADED' || row.submissionStatus?.status === 'GRADED';
    const unopened = !attemptId && !row.lastAttempt && !row.status && (!row.submissionStatus || typeof row.submissionStatus === 'object' && !row.submissionStatus.status);
    const state = graded ? 'graded'
      : unopened || attempt?.status === 'IN_PROGRESS' || ['UNOPENED', 'NOT_SUBMITTED'].includes(row.submissionStatus?.status) ? 'before'
      : ['SUBMITTED', 'GRADED'].includes(row.submissionStatus?.status) || ['NEEDS_GRADING', 'COMPLETED'].includes(attempt?.status) ? 'after'
      : null;
    if (!state) return null;
    return R.parse.ultra(association.rubricDefinition, association, evaluation, { courseId: route.courseId, contentId: route.contentId, columnId, userId: uid, attemptId, state, pointsPossible: column.possible, columnBound: true });
  };
  const read = async (route, signal, live) => {
    const uid = String(await ctx.account()); if (!live()) throw Error('stale');
    if (cached?.path === here() && cached.user === uid) return cached.model;
    const model = await load(route, uid, signal, live).catch((e) => { if (!live()) throw e; return null; });
    if (live()) cached = { path: here(), user: uid, model };
    return model;
  };
  const open = (a) => {
    if (active !== a || !a.model || !eligible() || a.path !== here()) return;
    const handle = GZ_POPUP.open({ title: t('Rubric'), body: table(a.model, false), source: a.link, wide: true,
      onClose: () => { if (a.popup !== handle) return; a.popup = null; if (active === a) layout(a); } });
    a.popup = handle;
  };
  const click = (e) => {
    const a = active;
    if (!a?.model || !plain(e) || !a.link.contains(e.target) || !eligible() || a.path !== here()) return;
    e.preventDefault(); e.stopImmediatePropagation(); open(a);
  };
  const sync = () => {
    wanted = true;
    if (!R) return;
    if (cached?.path !== here()) cached = null;
    if (!eligible()) { clear(!visible() || masterOff || !ctx.on()); return; }
    const route = R.route(ctx.site, location.pathname);
    const found = route && host(route);
    if (!found) { clear(); return; }
    if (active?.path === here() && active.link === found.link && active.box === found.box) { layout(active); return; }
    clear();
    const a = active = { ...found, path: here(), model: null, inlineNow: false, hidden: [] };
    const controller = pending = new AbortController(), turn = epoch;
    const live = () => active === a && turn === epoch && !controller.signal.aborted && eligible() && a.path === here() && a.link.isConnected;
    read(route, controller.signal, live).then((model) => {
      if (!live() || !model) return;
      a.model = model;
      a.resize = new ResizeObserver(() => { if (eligible()) layout(a); }); a.resize.observe(a.box); layout(a);
    }, () => {}).finally(() => { if (pending === controller) pending = null; });
  };
  const off = () => { wanted = false; clear(true); };
  const schedule = () => {
    if (queued || stopped) return;
    queued = true; queueMicrotask(() => { queued = false; if (wanted) sync(); });
  };
  const rootObserver = new MutationObserver(schedule);
  rootObserver.observe(html, { attributes: true });
  const changed = (changes, area) => {
    if (area !== 'sync' || !['enabled', 'rubric', 'look'].some((k) => k in changes)) return;
    if (changes.enabled) masterOff = changes.enabled.newValue === false;
    if (changes.rubric) changedPrefs = GZ_SANITIZE({ rubric: changes.rubric.newValue }).rubric;
    if (masterOff || changedPrefs?.show === 'site') clear(masterOff);
    schedule();
  };
  try { chrome.storage.onChanged.addListener(changed); } catch { /* reloaded */ }
  document.addEventListener('click', click, true);
  const focusout = (e) => { if (active && (e.target === active.link || e.target === active.node)) schedule(); };
  document.addEventListener('focusout', focusout);
  document.addEventListener('visibilitychange', schedule);
  addEventListener('popstate', schedule); addEventListener('hashchange', schedule);
  const resume = (e) => { if (e.persisted) schedule(); };
  addEventListener('pageshow', resume);
  addEventListener('pagehide', (e) => {
    if (e.persisted) { clear(true); return; }
    stopped = true; off(); rootObserver.disconnect(); document.removeEventListener('click', click, true); document.removeEventListener('focusout', focusout); document.removeEventListener('visibilitychange', schedule); removeEventListener('popstate', schedule); removeEventListener('hashchange', schedule); removeEventListener('pageshow', resume); try { chrome.storage.onChanged.removeListener(changed); } catch { /* reloaded */ }
  });
  return { sync, off, ready };
})();

GZ_RUBRIC_UI;
