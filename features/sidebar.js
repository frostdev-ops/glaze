// The sidebar (enhance.sidebar): the page's own sidebar content (This page), then the widgets the student docks under it
// (My widgets), in one column at the window's right edge, loaded on demand. The site's part calls sync(on) from its passes
// (content-canvas.js, content-ultra.js syncSidebar), in the top frame; features/widgets.js draws the docked widgets into host().widgets,
// with the same tiles as its boards and floats. The state is lib/sidebar.js: one record per account on this device,
// changed field by field through the worker ('glaze:sidebar').
// The page's own column stays where and as the LMS made it: nothing of it is moved, cloned or rebuilt. Glaze adds its
// header before the column's first child and its widgets after the last, and lays the column out with attributes and
// CSS variables only (features/sidebar.css); a page without a column gets Glaze's own (#gz-sidebar), beside its content.
// Wide enough, the column keeps its room beside the content (expanded, or collapsed to its header); narrower, it is a
// drawer behind a button. A page with nothing for it keeps no room, only a button at the edge to add widgets.
// Each LMS is an adapter (ADAPTERS): Canvas and Blackboard Ultra. Nothing here asks the LMS for anything but who is signed in.
// A second injection into the same frame keeps the first.
var GZ_SIDEBAR_UI = globalThis.GZ_SIDEBAR_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const ultra = ctx.site === 'ultra';
  const LMS = ultra ? 'ultra' : 'canvas';
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const button = (text, run, props = {}) => { const b = make('button', { type: 'button', className: 'gz-sb-btn', textContent: text, ...props }); b.addEventListener('click', run); return b; };
  const label = (b, text) => { b.setAttribute('aria-label', text); b.title = text; return b; };
  const area = (a) => { try { return chrome.storage[a]; } catch { return null; } };
  const get = (keys) => new Promise((res) => { try { area('local').get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const html = () => document.documentElement;
  const has = (el, c) => ` ${el?.className || ''} `.includes(` ${c} `);
  const rtl = () => html()?.dir === 'rtl';
  const headerBottom = (headers) => {
    let bottom = 0;
    for (const e of headers) {
      const r = e.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight)) continue;
      let visible = true;
      for (let p = e; p?.tagName; p = p.parentElement) {
        const s = typeof getComputedStyle === 'function' ? getComputedStyle(p) : null;
        if (p.hidden || s?.display === 'none' || s?.visibility === 'hidden' || s?.visibility === 'collapse' || s?.opacity === '0') { visible = false; break; }
      }
      if (visible) bottom = Math.max(bottom, r.bottom);
    }
    return Math.round(bottom);
  };

  // ---- adapters -----------------------------------------------------------------------------------------------------
  // Each LMS's: family() the kind of page (its sections fold per kind), courseId() the page's course ('' elsewhere),
  // native() its own column ({ el, page }: the column and its content) when the page shows one Glaze recognizes, else
  // null; boundary() where Glaze's own column goes without one; left() what its navigation takes from the window's width.
  // Optional: own, a class for Glaze's own column; overlay() the page is a layer the sidebar only opens over; top() where
  // a fixed column starts (px, null for the navigation's).
  const ADAPTERS = {
    canvas: {
      family() {
        const p = location.pathname, b = document.body;
        if (p === '/') return 'dashboard';
        if (/^\/calendar2?\/?$/.test(p)) return 'calendar';
        if (/\/assignments\/syllabus\/?$/.test(p)) return 'syllabus';
        if (/^\/courses\/\d+\/grades\b/.test(p)) return 'grades';
        if (/^\/courses\/\d+\/quizzes\/\d+/.test(p)) return 'quiz';
        if (/^\/courses\/\d+\/assignments\/\d+/.test(p)) return 'assignment';
        if (/^\/courses\/\d+\/discussion_topics\/\d+/.test(p)) return 'discussion';
        if (/^\/courses\/\d+\/?$/.test(p) || has(b, 'home')) return 'course-home';
        return 'other';
      },
      courseId: () => String(ctx.canvasCourseId?.() || ''),
      // #right-side-wrapper around #right-side, on a page Canvas shows it on (body.with-right-side; the planner
      // Dashboard hides it inline). Anything else is left as Canvas has it.
      native() {
        const el = document.getElementById('right-side-wrapper'), page = document.getElementById('right-side');
        if (!el || !page || page.parentNode !== el || !has(document.body, 'with-right-side') || el.style.display === 'none') return null;
        return { el, page };
      },
      // Last in the row beside the content, where Canvas's own column would be.
      boundary: () => document.getElementById('not_right_side') || document.body,
      standalone: () => has(document.body, 'with-right-side') && document.getElementById('right-side-wrapper')?.style.display !== 'none',
      // Canvas's #main starts right of its navigation and course menu (or Glaze's bar, which moves #wrapper).
      left() {
        const m = document.getElementById('main') || document.getElementById('wrapper');
        if (!m) return 0;
        const r = m.getBoundingClientRect();
        return Math.max(0, Math.round(rtl() ? innerWidth - r.right : r.left));
      },
      // Without a breadcrumb bar (Dashboard/Calendar), course tabs go inside #main, including in a course frame.
      // That strip is not represented by --gz-ctabs-row: measure its actual bottom as well as the content start.
      headers: () => [...document.querySelectorAll('#gz-ctabs')],
      top: (headers) => Math.max(headerBottom(headers), Math.min(innerHeight - 100, document.getElementById('main')?.getBoundingClientRect().top || 0)),
    },
    // Blackboard Ultra. Its columns are flex columns of blocks with no wrapper of their own, so the column is its own
    // content (page === el): Glaze's header goes first in it, This page right after, the widgets last, and every block
    // between stays where Ultra (or Glaze's outline helpers: Course notes, the syllabus) put it. The Courses page's column
    // holds Ultra's To Do; a course outline's (aside.outline-actions) Faculty, Details & Actions and the schedule; a
    // discussion's (.layer-details, a column of its grid beside the thread) its details and participants. A content
    // item's details column is in a layer over the page, where keeping room is wrong: Ultra's is left as it is, and the
    // existing dock opens as a drawer (overlay). An assignment's overview or attempt keeps its details in its own page
    // (they scroll with it): Glaze's own column shows them in This page (panels(), projected in place, never moved).
    // Elsewhere, Glaze's own column, fixed at the window's edge (own) with the page's content kept clear of it
    // (features/sidebar.css).
    ultra: {
      family() {
        const p = location.pathname;
        if (ADAPTERS.ultra.discussion()) return 'discussion';
        if (document.querySelector('.layer-details')) return 'detail';
        if (/^\/ultra\/course\/?$/.test(p)) return 'courses';
        if (/^\/ultra\/courses\/_\d+_\d+\/outline/.test(p)) return 'outline';
        // The Gradebook: a table, so the content keeps more room (sidebar.grades).
        if (/^\/ultra\/courses\/_\d+_\d+\/grades/.test(p) || document.querySelector('.course-content-container > .panel-wrap.grades')) return 'grades';
        if (/^\/ultra\/courses\/_\d+_\d+\/assessment\//.test(p) || document.getElementById('learningModulePanelContainerId')) return 'assessment';
        return 'other';
      },
      // A discussion's details column: in the page's grid beside the thread, not a layer over it.
      discussion: () => document.querySelector('.course-main-container > .layer-details'),
      // Follow page: the course this page is in (its outline, a discussion or an assignment in it); all courses elsewhere.
      courseId: () => (/^\/ultra\/courses\/_\d+_\d+\//.test(location.pathname) && ctx.courseId?.()) || '',
      native() {
        // A details layer covers the outline; it does not replace its column or the live widgets in it.
        const f = /^\/ultra\/courses\/_\d+_\d+\/outline/.test(location.pathname) ? 'outline' : ADAPTERS.ultra.family();
        const attempt = f === 'assessment' && nativeAttempt(), older = f === 'assessment' && !attempt && nativeTestAttempt();
        if (attempt || older) return { el: attempt || older, page: attempt || older, kind: attempt ? 'attempt' : 'test' };
        const el = f === 'courses' ? document.querySelector('div.todo-panel') : f === 'outline' ? document.querySelector('aside.outline-actions')
          : f === 'assessment' ? nativeAssessment()
          : f === 'discussion' ? ADAPTERS.ultra.discussion() : null;
        return el ? { el, page: el, kind: f === 'assessment' ? 'overview' : '' } : null;
      },
      boundary: () => document.body,
      own: 'gz-sb-fixed',
      overlay: () => !!document.querySelector('.layer-details') && !ADAPTERS.ultra.discussion(),
      layer: () => [...document.querySelectorAll('.bb-offcanvas-panel.screen')].filter((e) => {
        const r = e.getBoundingClientRect(); return !e.closest('.peek, .peek-panel__content-wrapper, .ms-Panel-main') && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
      }).pop() || null,
      // Where the page's content starts: a course's panel, else the page (#main-content-inner, whose start padding is
      // Glaze's bar's room), right of Ultra's own nav.
      left() {
        // An outgoing view may stay mounted but hidden while the next course tool is shown.
        const m = ['.course-outline-content', 'div.bb-course-navigation', '.routed-page.bb-offcanvas-container', '#main-content-inner']
          .flatMap((s) => [...document.querySelectorAll(s)]).find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        if (!m) return 0;
        const r = m.getBoundingClientRect();
        let pad = 0;
        try { pad = parseFloat(getComputedStyle(m).paddingInlineStart) || 0; } catch { /* no styles to ask */ }
        return Math.max(0, Math.round((rtl() ? innerWidth - r.right : r.left) + pad));
      },
      headers() {
        const headers = new Set(document.querySelectorAll('div.bb-course-navigation, .routed-page > content-page-header, .route-view-container > content-page-header, .bb-offcanvas-panel.full .panel-header.simple-header, .course-content-container > .panel-wrap > .panel-header'));
        // Full routed documents/assessments use a panel header instead of content-page-header. Stay within that
        // shell, outside its content: a document's own headings and article headers are not navigation.
        for (const page of document.querySelectorAll('.routed-page.bb-offcanvas-container')) {
          for (const e of page.querySelectorAll('[class*="panelHeaderContainerRoot"], .panel-header, header, [class*="headerRoot"]')) {
            const body = e.closest('main, [role="main"], article, .routed-page-body, .routed-scroll, .panel-body');
            if (body && page.contains(body)) continue;
            // Course tabs can be siblings of the inner header inside this wrapper; reserve its whole height.
            const wrap = e.closest('[class*="headerRoot"]');
            headers.add(wrap && page.contains(wrap) ? wrap : e);
          }
        }
        return [...headers];
      },
      // Both course navigation and routed tools' breadcrumbs can cover the column. Their viewport bottoms already
      // include any navigation/tab rows above them, including inside a course frame: never add those heights again.
      // Angular can keep outgoing routes mounted while hidden or translated outside the viewport.
      top: headerBottom,
    },
  };
  const A = ADAPTERS[LMS] || ADAPTERS.canvas;
  // The sidebar settings (defaults.js sidebar), one for every account: title ('' is "Sidebar"); style float (the default,
  // as the navigation's default) | embed, or auto as Glaze's navigation's; open auto (the account's expanded or collapsed), expanded or collapsed at the start of
  // each page, or drawer always; width until the account drags one (lib/sidebar.js shown); order This page or My widgets
  // first; page This page shown, folded at first or hidden; heading and jump the header's name and Jump to widgets;
  // surface glass (blur px, opacity %), solid or clear; radius and density, auto for the Look's; min and grades the room
  // the content keeps, else a drawer; canvas and ultra per site (the site's part); off the kinds of page
  // (GZ_SIDEBAR_KINDS, from the page families here) it stays off on; todo To Do's scope until the account picks one.
  const cfg = () => ctx.settings().sidebar || {};
  const styleOf = () => { const c = cfg().style ?? 'float'; return c === 'auto' ? (ctx.settings().navbar?.style === 'embed' ? 'embed' : 'float') : c === 'embed' ? 'embed' : 'float'; };
  const KIND = { dashboard: 'dashboard', courses: 'dashboard', 'course-home': 'course', outline: 'course', discussion: 'discussion', assignment: 'assignment', assessment: 'assignment', grades: 'grades', calendar: 'calendar', syllabus: 'calendar', quiz: 'quiz' };
  const offOn = (fam) => (cfg().off || []).includes(KIND[fam] || 'other');
  const enabled = () => ctx.settings().enhance.sidebar !== false && cfg()[LMS] !== false && !offOn(A.family());
  const name = () => cfg().title || t('Sidebar');
  // Native To Do lists Better To Do can take the place of (features/apps.css hides them while data-gz-sidebar-todo is set).
  const NATIVE_TODO = '.Sidebar__TodoListContainer, .todo-list-header, ul.to-do-list, bb-todo';
  // In a course tab's frame (features/coursetabs.js), the sidebar is the frame's while the frame is on screen, and the
  // page around it hides its own. Only the document on screen draws, watches or changes anything: a covered or hidden one
  // keeps its record up to date and waits (asleep), and its changes go through the page around it (GZ_CTABS.sidebar).
  const framed = !!ctx.tabFrame && globalThis.top !== globalThis.window;
  const covered = () => { const c = globalThis.GZ_CTABS; return document.visibilityState === 'hidden' || html().hasAttribute('data-gz-review-focus') || html().hasAttribute('data-gz-review-immersive') || (c?.visible ? !c.visible() : framed); };
  // A request's answer is for the page it was asked on: gen moves on with the route, the account and the document.
  const DOC = Math.random().toString(36).slice(2, 10);

  // ---- state --------------------------------------------------------------------------------------------------------
  let S = null; // lib/sidebar.js
  let on = false, starting = null, failed = false, active = false;
  let key = '', rec = null, flying = 0, reads = 0, lost = false, epoch = 0;
  let family = '', course = '', gen = 0, route = '', seenRoute = '', nativeView = null;
  let host = null; // { el, page, own }: the column dressed now
  let kept = []; // the native column's own attributes before, as [name, value | null]
  let slot = null, own = null, head = null, title = null, jump = null, more = null, toggle = null, grip = null, pageHead = null, pageBtn = null;
  let dock = null, dockBtn = null, list = null, note = null, addBtn = null, adding = null, live = null, edge = null, launch = null;
  let mode = 'none', drawer = false, forced = false, opener = null, inerted = [], dragW = 0, modalAway = false;
  let modalObserver = null, backdrop = null, widthCancel = null, lifted = null;
  let drawnCount = null; // the widgets features/widgets.js drew into the dock (null: not said yet)
  let mo = null, frame = 0, noteTimer = 0, retryTimer = 0, passFrame = 0, offer = null, asleep = false;
  let topRO = null, topHeaders = [];
  let openHere = null; // expanded or collapsed on this page, when the settings start each page one way
  const isOpen = () => (['expanded', 'collapsed'].includes(cfg().open) ? openHere ?? cfg().open === 'expanded' : rec.open);
  const subs = { change: new Set(), mode: new Set(), context: new Set() };
  const emit = (e, ...a) => { for (const f of subs[e]) { try { f(...a); } catch { /* one listener's fault stays its own */ } } };
  const on_ = (e, f) => { subs[e]?.add(f); return () => subs[e]?.delete(f); };

  // ---- the record ---------------------------------------------------------------------------------------------------
  // A change shows at once and goes to the worker, which applies it to what is stored then. While changes are out, the
  // stored record that comes back is the answer to the last one; one that couldn't be saved is put back as stored, and
  // the student told so briefly.
  const adopt = (raw) => {
    const next = S.clean(raw);
    if (JSON.stringify(next) === JSON.stringify(rec)) return;
    rec = next;
    emit('change');
    paint();
    layout();
  };
  const genOf = () => {
    const path = location.pathname + (location.search || '');
    if (seenRoute !== path) { seenRoute = path; gen++; }
    return `${DOC}.${gen}`;
  };
  const post = (k, ops) => {
    if (framed) return globalThis.GZ_CTABS?.sidebar?.(k, ops, genOf()) || Promise.resolve(null);
    // The worker may have restarted before persisting the bootstrap's site report.
    return send({ type: 'glaze:sidebar', key: k, ops });
  };
  // A change that finishes after the page moved on still counts (what is stored is adopted), but says nothing here.
  const op = (ops) => {
    if (!active || asleep || !rec || !S?.ops(ops)) return Promise.resolve(false);
    reads++;
    rec = S.apply(rec, ops, { lms: LMS });
    emit('change');
    paint();
    layout();
    flying++;
    const k = key, g = epoch, asked = genOf();
    return post(k, ops).then((r) => {
      const ok = r?.ok === true;
      if (g !== epoch) return ok;
      if (!ok && asked === genOf()) lost = asked;
      if (--flying || k !== key) return ok;
      const n = ++reads;
      get(k).then((x) => { if (g === epoch && !flying && n === reads && k === key && active) adopt(x[k]); });
      if (lost) { if (!asleep && lost === genOf()) status(t("Couldn't save. Try again.")); lost = false; }
      return ok;
    });
  };
  const onStore = (ch, a) => {
    if (a !== 'local' || !key) return;
    if (ch[key]) { reads++; if (!flying && rec) adopt(ch[key].newValue); }
    // Registration and the localhost copy's clear/install can finish after the first request. Retry from stored state.
    if (active && rec && !rec.mig && (ch.ultra || ch.freshDefaults || ch[key])) op([{ op: 'migrate' }]);
  };

  // Who is signed in: the page's account reader (content.js GZ_CTX.account), the uid the worker checks the key against.
  const account = async () => String((await ctx.account()) ?? '');
  const start = async () => {
    const g = epoch;
    await ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS);
    if (g !== epoch) return false;
    await ctx.need('lib/sidebar.js', () => globalThis.GZ_SIDEBAR);
    if (g !== epoch) return false;
    S = globalThis.GZ_SIDEBAR;
    const k = S.key(LMS, location.origin, await account());
    if (g !== epoch) return false;
    if (!k) throw new Error('no account');
    const r = await get(k);
    if (g !== epoch) return false;
    let next = S.clean(r[k]);
    // The one-time move into the dock is written first, and only then shown (lib/sidebar.js migrate).
    if (!next.mig) { const a = await post(k, [{ op: 'migrate' }]); if (a?.ok && a.rec) next = S.clean(a.rec); }
    if (g !== epoch) return false;
    if (key !== k) gen++;
    key = k;
    rec = next;
    emit('context', context());
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    return true;
  };
  // Resolves true once the record is in, false if it can't be here (no account, the extension reloaded): then the page
  // stays as it was, and it tries again after a minute.
  const ready = () => {
    if (!enabled()) return Promise.resolve(false);
    const g = epoch;
    return (starting ||= start().then((ok) => { if (g === epoch) failed = false; return ok; }, () => {
      if (g !== epoch) return false;
      failed = true;
      retryTimer = setTimeout(() => { if (g === epoch) { starting = null; failed = false; } }, 60000);
      return false;
    }));
  };

  // ---- Glaze's parts of the column -----------------------------------------------------------------------------------
  let live0 = null;
  const say = (text) => { if (live) live.textContent = text; else live0 = text; };
  const status = (text) => {
    if (!note) return;
    note.textContent = text;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { if (note) note.textContent = ''; }, 4000);
  };
  const build = () => {
    if (head) return;
    title = make('h2', { id: 'gz-sb-title', className: 'gz-sb-title', textContent: t('Sidebar') });
    jump = button(t('Jump to widgets'), () => jumpTo(), { className: 'gz-sb-btn gz-sb-small gz-sb-jump', hidden: true });
    more = label(button('⋯', () => menu(more, [
      { label: t('Add widgets'), run: () => openAdd(true) },
      ...(jump.hidden ? [] : [{ label: t('Jump to widgets'), run: jumpTo }]),
      ...(rec && rec.width !== S.WIDTH ? [{ label: t('Reset width'), run: () => { op([{ op: 'width', px: S.WIDTH }]); say(t('Sidebar width reset.')); } }] : []),
      // The width, expanded, folded sections, To Do's scope and docked widgets' heights as new; placements stay.
      { label: t('Reset sidebar for this account'), run: () => { op([{ op: 'reset' }]); say(t('Sidebar reset.')); } },
    ]), { className: 'gz-sb-icon gz-sb-more' }), t('Customize sidebar'));
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    toggle = button('', () => {
      if (mode === 'drawer') closeDrawer();
      else {
        // Set to start each page expanded or collapsed (sidebar.open), the choice holds on this page only. The page,
        // reflowed round the new width, crossfades in (lib/motion.js swap) rather than jumping.
        const change = () => {
          const v = !isOpen();
          if (['expanded', 'collapsed'].includes(cfg().open)) { openHere = v; layout(); } else op([{ op: 'open', v }]);
          say(t(v ? 'Sidebar expanded.' : 'Sidebar collapsed.')); toggle.focus();
        };
        if (globalThis.GZ_MOTION) GZ_MOTION.swap(change); else change();
      }
    }, { className: 'gz-sb-icon gz-sb-toggle' });
    live = make('p', { className: 'gz-sr', textContent: live0 || '' });
    live.setAttribute('role', 'status');
    head = make('div', { className: 'gz-sb-head' }, title, jump, more, toggle, live);
    // The column's inner edge: drag it, or use the arrow keys, for the column's width.
    grip = make('div', { className: 'gz-sb-resize', tabIndex: 0 });
    grip.setAttribute('role', 'separator');
    grip.setAttribute('aria-orientation', 'vertical');
    grip.setAttribute('aria-label', t('Sidebar width'));
    grip.setAttribute('aria-valuemin', String(S.MIN_WIDTH));
    grip.setAttribute('aria-valuemax', String(S.MAX_WIDTH));
    grip.title = t('Drag to resize, or use the arrow keys.');
    resizer(grip);
    pageBtn = button(t('This page'), () => fold('page'), { className: 'gz-sb-sec-btn', id: 'gz-sb-ph' });
    pageBtn.setAttribute('aria-label', t('This page'));
    pageHead = make('h2', { className: 'gz-sb-sec gz-sb-pagehead' }, pageBtn);
    pageHead.setAttribute('aria-labelledby', 'gz-sb-ph');
    // Room in Glaze's own column for the page's side panels shown in This page (project).
    slot = make('div', { className: 'gz-sb-slot' });
    slot.setAttribute('aria-hidden', 'true');
    dockBtn = button(t('My widgets'), () => fold('widgets'), { className: 'gz-sb-sec-btn', id: 'gz-sb-wh' });
    list = make('div', { className: 'gz-sb-dock' });
    note = make('p', { className: 'gz-sb-note' });
    note.setAttribute('role', 'status');
    addBtn = button(`+ ${t('Add widgets')}`, () => openAdd(adding?.hidden !== false), { className: 'gz-sb-btn gz-sb-small gz-sb-add' });
    addBtn.setAttribute('aria-expanded', 'false');
    adding = make('div', { className: 'gz-sb-adding', id: 'gz-sb-adding', hidden: true });
    addBtn.setAttribute('aria-controls', 'gz-sb-adding');
    // Ultra's boards disagreed about To Do (lib/sidebar.js migrate): offered here, never forced, until docked or dismissed.
    offer = make('div', { className: 'gz-sb-offer', hidden: true },
      make('p', { className: 'gz-sb-faint', textContent: t('To Do is on one of your Blackboard boards but not the other. Keep it in the sidebar instead?') }),
      button(t('Move To Do to sidebar'), () => { op([{ op: 'dock', id: 'todo', at: 0 }]); say(t('{name} is in the sidebar.', { name: t('To Do') })); dockBtn.focus(); }, { className: 'gz-sb-btn gz-sb-small' }),
      button(t('Dismiss'), () => { op([{ op: 'offer', v: 'dismissed' }]); dockBtn.focus(); }, { className: 'gz-sb-btn gz-sb-small' }));
    dock = make('section', { id: 'gz-sb-widgets', className: 'gz-sb-widgets' }, make('h2', { className: 'gz-sb-sec' }, dockBtn), offer, list, note, addBtn, adding);
    dock.setAttribute('aria-labelledby', 'gz-sb-wh');
    edge = button(`+ ${t('Add widgets')}`, () => { forced = true; openDrawer(edge); openAdd(true); }, { id: 'gz-sb-edge', className: 'gz-sb-btn gz-sb-edge gz-sb-own', hidden: true });
    // Its words show, and its name says what it does: no title as well, which a screen reader reads again after it.
    launch = button(name(), () => openDrawer(launch), { id: 'gz-sb-launch', className: 'gz-sb-btn gz-sb-launch gz-sb-own', hidden: true });
    launch.setAttribute('aria-label', t('Open {name}', { name: name() }));
    launch.setAttribute('aria-haspopup', 'dialog');
    backdrop = make('div', { className: 'gz-sb-backdrop', hidden: true });
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('pointerdown', () => closeDrawer());
  };
  const pageFolded = () => (rec.fold[family] || {}).page ?? cfg().page === 'folded';
  const fold = (part) => {
    const v = !((rec.fold[family] || {})[part] ?? (part === 'page' && cfg().page === 'folded'));
    op([{ op: 'section', family, part, v }]);
    (part === 'page' ? pageBtn : dockBtn).focus();
  };
  const jumpTo = () => {
    dock?.scrollIntoView?.({ block: 'start' });
    dockBtn?.focus({ preventScroll: true });
  };

  // The column dressed: a native one keeps its own content where it is, with Glaze's header first and the widgets last;
  // without one (or one Glaze doesn't recognize, left as it is), Glaze's own beside the content.
  const ATTRS = ['role', 'aria-labelledby', 'aria-modal', 'aria-label'];
  const detach = () => {
    if (!host) return;
    lift(false);
    watchNativeScroll(null);
    widthCancel?.();
    mo?.disconnect();
    topRO?.disconnect(); topHeaders = [];
    absorb([]);
    absorbBlocked = new WeakMap();
    for (const e of [grip, head, pageHead, slot, dock]) e?.remove();
    if (host.own) host.el.remove();
    else {
      for (const [k, v] of kept) { if (v === null) host.el.removeAttribute(k); else host.el.setAttribute(k, v); }
      for (const k of ['data-gz-sidebar-host', 'data-gz-sb-fold-page', 'data-gz-sb-self', 'data-gz-sb-overlay', 'data-gz-sb-page-hidden']) host.el.removeAttribute(k);
    }
    kept = [];
    host = null;
  };
  const attach = (n) => {
    closeDrawer(false);
    detach();
    if (n) {
      host = { el: n.el, page: n.page, own: false, kind: n.kind };
      kept = ATTRS.map((k) => [k, n.el.getAttribute(k)]);
    } else {
      own ||= make('aside', { id: 'gz-sidebar', className: A.own ? `gz-sb-own ${A.own}` : 'gz-sb-own' });
      A.boundary().append(own);
      host = { el: own, page: null, own: true };
    }
    host.el.setAttribute('data-gz-sidebar-host', host.own ? 'glaze' : 'native');
    host.el.prepend(grip, head);
    if (self()) { host.el.setAttribute('data-gz-sb-self', ''); head.after(pageHead); }
    else if (host.page) host.page.before(pageHead);
    else { head.after(pageHead); pageHead.after(slot); }
    host.el.append(dock);
    watch();
  };
  // The page's own content may arrive late (Canvas's Dashboard fills its column after load): looked at again once a
  // frame, never rebuilt. Not while asleep.
  const watch = () => {
    mo?.disconnect();
    if (!host?.page || asleep || typeof MutationObserver !== 'function') return;
    mo ||= new MutationObserver((rs) => { if (!asleep && (!rs?.length || !rs.every(mine))) { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (active && !asleep) (ultra ? place() : layout()); }); } });
    mo.observe(host.page, { childList: true, subtree: true });
    // Ultra (Angular) may swap its column for a new one between the site's passes: its parent is watched for that.
    if (ultra && host.el.parentNode) mo.observe(host.el.parentNode, { childList: true });
  };
  // Ultra's columns are their own content (ADAPTERS.ultra).
  const self = () => !!host && host.page === host.el;
  // A change only to Glaze's own parts of the column (a docked widget redrawing, the header) says nothing of the page's.
  const part = (n) => n === grip || n === head || n === pageHead || n === slot || n === dock;
  const mine = (r) => [grip, head, pageHead, slot, dock].some((e) => e && e !== r.target && e.contains?.(r.target)) || part(r.target)
    || ([...(r.addedNodes || []), ...(r.removedNodes || [])].length > 0 && [...(r.addedNodes || []), ...(r.removedNodes || [])].every((e) => part(e) && e.parentNode === host?.el));
  // Content: a child with words or a control, not one Glaze hides (the native To Do it replaces).
  const filled = (el) => [...el.children].some((c) => c.tagName && !part(c) && !['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK'].includes(c.tagName) && !c.hidden
    && !(html().hasAttribute('data-gz-sidebar-todo') && c.closest(NATIVE_TODO) === c)
    && (c.textContent.trim() || c.querySelector('a, button, input, select, textarea, img, svg, canvas, iframe')));

  // ---- absorbing an assignment's side panels into This page ---------------------------------------------------------
  // The overview's verified side column can be dressed over a slot using a Glaze-owned stylesheet. No attributes,
  // inline styles, listeners or nodes of Ultra's are changed. Its heading and controls keep their native reading order.
  // Independent scrollers cannot safely share keyboard scrolling: only a fully visible, non-scrolling slot qualifies.
  // Any scroll, re-render, obstruction or changed geometry restores native flow, without trying again on every pass.
  // Unrecognized attempt shells keep Ultra's presentation. Verified current shells use their native column as host.
  let absorbed = [], absorbSheet = null, absorbRO = null, absorbMO = null, absorbRootMO = null, absorbBox = null, absorbBlocked = new WeakMap(), absorbGen = 0, rubricNative = null;
  const OVERVIEW = 'section.assessment-overview-modern-panel.routed-page.route-view-container > learning-module-panel-view.routed-page-body > div.table-of-contents-disabled > div.panel-content-body > div.root-learning-module-panel > div#learningModulePanelContainerId.content-item-container > div.content-item-container-children > content-body > div.base-body > div.content-root > div.standard-content-body > div.assessment-overview-grid';
  const PANEL = `${OVERVIEW} > div.overview-section.overview-attempts-section.overview-attempts-section-container:has(> h2#grades-attempts-header.section-label)`;
  const REVIEW = 'div.bb-offcanvas-panel.screen.student-view-submission-panel';
  const RUBRIC = `${REVIEW} > div.bb-offcanvas-panel-wrap main > aside:has(.rubric-inline-container)`;
  const absorbKey = () => JSON.stringify([location.pathname, location.search, innerWidth, innerHeight, cfg(), rec?.width, isOpen()]);
  // Only the read-only submission viewer's two-column layout. Other document/preview layers keep their native panels.
  const rubricView = () => {
    if (!ultra || !/^\/ultra\/courses\/_\d+_\d+\/assessment\/_\d+_\d+\/overview\/student-submission-view\/?$/.test(location.pathname)) return null;
    const roots = [...document.querySelectorAll(REVIEW)];
    if (roots.length !== 1) return null;
    const layer = roots[0], children = [...layer.children].filter((e) => e.id !== 'gz-ctabs'), wrap = children.length === 1 && children[0];
    if (!wrap || wrap.tagName !== 'DIV' || !has(wrap, 'bb-offcanvas-panel-wrap') || layer.closest('.peek, .peek-panel__content-wrapper, .ms-Panel-main')) return null;
    const mains = [...wrap.querySelectorAll('main')], main = mains.length === 1 && mains[0], kids = main && [...main.children];
    if (!kids || kids.length !== 2 || kids[0].tagName !== 'SECTION' || kids[1].tagName !== 'ASIDE') return null;
    const viewer = kids[0], el = kids[1], rubrics = [...el.querySelectorAll('.rubric-inline-container')], headings = [...el.children].filter((e) => e.tagName === 'H2');
    const editor = el.closest('[contenteditable]');
    if (rubrics.length !== 1 || !rubrics[0].children.length || headings.length !== 1 || !headings[0].textContent.trim()
      || editor && editor.getAttribute('contenteditable') !== 'false'
      || [...el.querySelectorAll('[contenteditable]')].some((e) => e.getAttribute('contenteditable') !== 'false')
      || el.querySelector('form, input, select, textarea, iframe, [role="textbox"], [role="combobox"], button[type="submit"]')) return null;
    const frames = [...viewer.querySelectorAll('[role="tabpanel"] iframe')];
    if (frames.length !== 1 || !frames[0].parentElement.id.startsWith('files-viewer-tab-panel-')) return null;
    try { const u = new URL(frames[0].getAttribute('src')); if (u.origin !== 'https://annotate-us.foundations.blackboard.com' || !/^\/ui\/pdf-viewer\/[^/]+\/index\.html$/.test(u.pathname)) return null; } catch { return null; }
    if (!el.isConnected || el.closest('[hidden], [aria-hidden="true"]')) return null;
    return { layer, wrap, main, viewer, el, heading: headings[0], frame: frames[0] };
  };
  const readOnlyPanel = (el) => {
    const editor = el.closest('[contenteditable]');
    if (editor && editor.getAttribute('contenteditable') !== 'false' || el.closest('form')) return false;
    const owned = (x) => { for (let p = x; p && p !== el; p = p.parentElement) if (part(p)) return true; return false; };
    return ![...el.querySelectorAll('[contenteditable]')].some((x) => x.getAttribute('contenteditable') !== 'false' && !owned(x))
      && ![...el.querySelectorAll('form, input, select, textarea, iframe, button, [role="button"], [role="textbox"], [role="combobox"]')].some((x) => !owned(x));
  };
  const overviewPanel = () => {
    if (!ultra || cfg().absorb === false || !/^\/ultra\/courses\/_\d+_\d+\/assessment\/_\d+_\d+\/overview\/?$/.test(location.pathname) || html().hasAttribute('data-gz-focus')) return null;
    const grids = [...document.querySelectorAll('div.assessment-overview-grid')];
    if (grids.length !== 1) return null;
    const grid = grids[0], kids = [...grid.children].filter((e) => e !== backdrop);
    // Ultra omits Description/Assessment Details when absent; submitted work also drops js-multiple from its
    // action link. Validate the remaining ordered native sections and stable action class, without fixed positions.
    const classes = ['overview-due-date-section', 'overview-attempts-section'];
    if (has(kids[0], 'overview-description-section')) classes.unshift('overview-description-section');
    if (has(kids[kids.length - 1], 'assessment-details-section')) classes.push('assessment-details-section');
    const attempts = classes.indexOf('overview-attempts-section');
    if (kids.length !== classes.length || kids.some((e, i) => e.tagName !== 'DIV' || !has(e, 'overview-section') || !has(e, classes[i]) || (i !== attempts && !has(e, 'main-section-container')))) return null;
    // Check direct parents ourselves, rather than accepting a descendant selector's partial match.
    const chain = ['div.standard-content-body', 'div.content-root', 'div.base-body', 'content-body', 'div.content-item-container-children',
      'div#learningModulePanelContainerId.content-item-container', 'div.root-learning-module-panel', 'div.panel-content-body',
      'div.table-of-contents-disabled, div.table-of-contents-enabled', 'learning-module-panel-view.routed-page-body', 'section.assessment-overview-modern-panel.routed-page.route-view-container'];
    let parent = grid.parentElement;
    for (const sel of chain) { if (!parent || parent.closest(sel) !== parent) return null; parent = parent.parentElement; }
    const e = kids[attempts], heads = [...e.children].filter((n) => n.tagName === 'H2' && has(n, 'section-label'));
    if (!has(e, 'overview-attempts-section-container') || heads.length !== 1 || heads[0].id !== 'grades-attempts-header'
      || document.querySelectorAll('#grades-attempts-header').length !== 1 || !e.querySelector('a.button.button-attempt')
      || !readOnlyPanel(e) || !e.isConnected || e.closest('[hidden], [aria-hidden="true"]')) return null;
    return { el: e, grid };
  };
  // Current Ultra overviews have a TOC shell or a query-container grid. Use their existing column as the host:
  // native controls and docked widgets then share one scroller, with no projection, cloning or native-node moves.
  // The older verified shell keeps its conservative projection path for compatibility.
  const nativeAssessment = () => {
    const panel = overviewPanel();
    if (!panel) return null;
    return panel.el.closest('div.table-of-contents-enabled') || getComputedStyle(panel.grid).containerType === 'inline-size' ? panel.el : null;
  };
  const nativeAttempt = () => {
    if (!ultra || cfg().absorb === false || html().hasAttribute('data-gz-focus')
      || !/^\/ultra\/courses\/_\d+_\d+\/assessment\/_\d+_\d+\/attempt\/(?:create|_\d+_\d+)\/?$/.test(location.pathname)) return null;
    const roots = [...document.querySelectorAll('bb-assignment-attempt-authoring-panel.react-container')];
    if (roots.length !== 1) return null;
    const root = roots[0], panels = [...root.querySelectorAll('div[class*="makeStylesdetails-"]')];
    if (panels.length !== 1) return null;
    const el = panels[0], container = el.parentElement, body = container?.parentElement, content = body?.parentElement;
    const base = content?.parentElement, panel = base?.parentElement, wrap = panel?.parentElement;
    const styled = (e, name) => String(e?.className || '').split(/\s+/).some((c) => c.startsWith(`makeStyles${name}-`));
    if (!styled(container, 'container') || !styled(body, 'body') || !styled(content, 'contentRoot') || !styled(base, 'baseBody')
      || !styled(panel, 'panelRoot') || wrap?.parentElement !== root || root.children.length !== 1 || wrap.children.length !== 1
      || panel.children.length !== 1 || content.children.length !== 1 || body.children.length !== 1) return null;
    const columns = [...container.children].filter((e) => e !== backdrop), shells = [...base.children];
    if (columns.length !== 2 || columns[1] !== el || !styled(columns[0], 'authoring') || shells.length !== 3
      || !styled(shells[0], 'headerRoot') || shells[1] !== content || !styled(shells[2], 'footerWrapper')) return null;
    const editor = columns[0].querySelector('#bb-editorassignment-attempt-authoring-submission[contenteditable="true"]');
    const footer = shells[2].firstElementChild, buttons = footer && [...footer.querySelectorAll('button')];
    const native = [...el.children].filter((e) => !part(e)), title = native[0]?.querySelector('h2');
    if (!editor || footer?.tagName !== 'FOOTER' || !styled(footer, 'footerRoot') || buttons.length !== 2
      || buttons.some((e) => e.getAttribute('type') !== 'button') || !styled(native[0], 'sidePanelContentMarginFix') || !title?.textContent.trim()
      || !el.isConnected || el.closest('[hidden], [aria-hidden="true"]') || !readOnlyPanel(el)) return null;
    return el;
  };
  // Ultra's older (Angular) test attempt: the questions and its read-only Details & Information side by side in the panel
  // that scrolls them, Save and Submit in a footer below that panel. Its details column, as the attempt's, is the host.
  const nativeTestAttempt = () => {
    if (!ultra || cfg().absorb === false || html().hasAttribute('data-gz-focus')
      || !/^\/ultra\/courses\/_\d+_\d+\/assessment\/_\d+_\d+\/attempt\/(?:create|_\d+_\d+)\/?$/.test(location.pathname)) return null;
    const panels = [...document.querySelectorAll('div.assessment-attempt-panel')];
    if (panels.length !== 1) return null;
    const panel = panels[0], shell = panel.parentElement;
    const kids = (e, tag, name) => [...(e?.children || [])].filter((x) => x.tagName === tag && has(x, name));
    const sections = kids(panel, 'SECTION', 'panel-content'), rows = kids(sections[0], 'DIV', 'panel-content-flex');
    if (!has(panel, 'panel-wrap') || !has(shell, 'test-attempt') || sections.length !== 1 || rows.length !== 1) return null;
    const columns = [...rows[0].children].filter((e) => e !== backdrop), el = columns[1];
    const footers = [...shell.children].filter((x) => x.tagName === 'BB-ASSESSMENT-ATTEMPT-FOOTER').flatMap((f) => kids(f, 'FOOTER', 'submit-footer'));
    const native = [...(el?.children || [])].filter((e) => !part(e)), title = native[0]?.querySelector('h2');
    if (columns.length !== 2 || columns[0].tagName !== 'DIV' || !has(columns[0], 'panel-content-full') || !columns[0].querySelector('bb-attempt-canvas')
      || el.tagName !== 'DIV' || !has(el, 'panel-content-info') || !has(el, 'assessment-summary') || !has(native[0], 'row') || !has(native[0], 'collapse') || !title?.textContent.trim()
      || footers.length !== 1 || !footers[0].querySelector('.js-send-draft-button')
      || !el.isConnected || el.closest('[hidden], [aria-hidden="true"]') || !readOnlyPanel(el)) return null;
    return el;
  };
  const absorbable = () => {
    if (!ultra || cfg().absorb === false) { absorbBlocked = new WeakMap(); return []; }
    const review = rubricView();
    if (review) return absorbBlocked.get(review.el) === absorbKey() ? [] : [review.el];
    const e = overviewPanel()?.el;
    if (!e) return [];
    return absorbBlocked.get(e) === absorbKey() ? [] : [e];
  };
  const pv = (e, k, v) => { if (e.style.getPropertyValue(k) !== v) e.style.setProperty(k, v); };
  const restoreAbsorbed = () => {
    absorbGen++;
    absorbRO?.disconnect(); absorbMO?.disconnect(); absorbRootMO?.disconnect();
    absorbRO = absorbMO = absorbRootMO = null;
    absorbSheet?.remove(); absorbSheet = null;
    document.removeEventListener('scroll', absorbInvalid, true);
    removeEventListener('beforeprint', absorbInvalid);
    removeEventListener('popstate', absorbInvalid);
    removeEventListener('hashchange', absorbInvalid);
    absorbed = []; absorbBox = null; rubricNative = null;
    pageBtn?.removeAttribute('aria-describedby');
    slot?.style.removeProperty('height');
    if (slot && slot.getAttribute('style') === '') slot.removeAttribute('style');
  };
  const absorbInvalid = () => {
    if (!absorbed.length) return;
    const review = !!rubricNative;
    absorbBlocked.set(absorbed[0], absorbKey());
    restoreAbsorbed();
    if (host?.own) pageHead.hidden = true;
    if (review && on && active && !covered()) queueMicrotask(() => { if (on && active && !asleep) layout(); });
  };
  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const syncAbsorbed = () => {
    if (!absorbed.length) return;
    try {
      const e = absorbed[0], now = absorbable(), r = e.getBoundingClientRect(), sr = slot.getBoundingClientRect(), hr = host.el.getBoundingClientRect();
      if (!on || !active || asleep || covered() || mode !== 'expanded' || cfg().page === 'hidden' || pageFolded()
        || now.length !== 1 || now[0] !== e || !slot.isConnected || host.el.scrollTop || host.el.scrollHeight > hr.height + 1
        || r.width < 1 || r.height < 1 || r.left < hr.left || r.right > hr.right || r.top < pageHead.getBoundingClientRect().bottom
        || r.bottom > hr.bottom - 4 || Math.abs(r.top - sr.top) > 1 || Math.abs(r.left - sr.left) > 1
        || (absorbBox && ['left', 'top', 'width', 'height'].some((k) => Math.abs(r[k] - absorbBox[k]) > 1))) throw Error('geometry');
      if (rubricNative && (rubricNative.viewer.getBoundingClientRect().width + 1 < rubricNative.viewerWidth || e.scrollHeight > e.clientHeight + 1)) throw Error('viewer');
      for (const own of [head, pageHead, dock, grip]) if (overlaps(r, own.getBoundingClientRect())) throw Error('controls');
      // Test the real painted controls, not synthetic dispatchEvent: another stacking context must fail closed.
      for (const x of [e, ...e.querySelectorAll(rubricNative ? 'a[href], button, [role="button"], [tabindex]' : 'a[href]')].filter((x) => !x.closest('[hidden], [aria-hidden="true"]') && x.getBoundingClientRect().height > 0)) {
        const b = x.getBoundingClientRect();
        if (b.width < 1 || b.height < 1 || b.left < r.left || b.right > r.right || b.top < r.top || b.bottom > r.bottom) throw Error('control');
        const points = x === e ? [[b.left + b.width / 2, b.top + 2], [b.left + b.width / 2, b.bottom - 2]] : [[b.left + b.width / 2, b.top + b.height / 2]];
        for (const [x0, y0] of points) if (!x.contains(document.elementFromPoint(x0, y0))) throw Error('covered');
      }
      absorbBox = r;
    } catch { absorbInvalid(); }
  };
  const absorb = (list) => {
    if (list.length === absorbed.length && list.every((e, i) => e === absorbed[i])) { if (list.length) syncAbsorbed(); return; }
    restoreAbsorbed();
    if (!list.length || !slot?.isConnected || !host?.own || typeof getComputedStyle !== 'function' || typeof document.elementFromPoint !== 'function') return;
    const e = list[0];
    try {
      const css = (node) => getComputedStyle(node);
      const review = rubricView();
      if (review?.el === e) {
        absorbed = list;
        const native = e.getBoundingClientRect(), vc = css(review.viewer), mc = css(review.main);
        rubricNative = { ...review, width: native.width, viewerWidth: review.viewer.getBoundingClientRect().width };
        if (mc.display !== 'flex' || mc.flexDirection !== 'row' || Number(vc.flexGrow) < 1 || native.width < 200) throw Error('layout');
        const nodes = [e];
        for (let i = 0; i < nodes.length; i++) {
          const x = nodes[i], children = [...x.children].filter((n) => n.tagName);
          if (nodes.length + children.length > 400 || x.clientHeight > 0 && x.scrollHeight > x.clientHeight + 1) throw Error('overflow');
          nodes.push(...children);
        }
        let count = 0;
        for (let p = e; p; p = p.parentElement) {
          if (++count > 30) throw Error('depth');
          const c = css(p), stack = p === review.layer && c.position === 'absolute' && c.zIndex === '1011';
          if (c.display === 'none' || c.visibility !== 'visible' || c.transform !== 'none' || c.perspective !== 'none' || c.filter !== 'none'
            || c.backdropFilter !== 'none' || c.clipPath !== 'none' || c.opacity !== '1' || c.isolation !== 'auto' || !['none', ''].includes(c.contain)
            || !['normal', ''].includes(c.containerType) || c.willChange !== 'auto' || (!stack && c.position !== 'static' && c.zIndex !== 'auto')) throw Error('stack');
        }
        if (host.el.scrollTop || host.el.scrollHeight > host.el.getBoundingClientRect().height + 1) throw Error('scroll');
        pv(slot, 'height', '1px');
        const sr = slot.getBoundingClientRect();
        absorbSheet = make('style', { id: 'gz-sb-absorb' });
        // The native rubric remains in the layer's stacking context. The owned card has an unpainted, non-intercepting
        // slot above it; only Glaze's headers and widgets paint and accept events above the full-window layer.
        absorbSheet.textContent = `@media screen { html[data-gz-sidebar="expanded"]:not([data-gz-focus], [data-gz-review-focus], [data-gz-review-immersive]) ${RUBRIC} {
          position:fixed!important; z-index:1011!important; top:${sr.top}px!important; left:${sr.left}px!important; right:auto!important; bottom:auto!important;
          width:${sr.width}px!important; height:auto!important; max-height:none!important; min-width:0!important; max-width:none!important; margin:0!important; box-sizing:border-box;
          overflow:visible!important; padding:calc(var(--gz-sb-pad,1rem) * .75)!important; background:var(--gz-surface)!important;
        } html[data-gz-sidebar="expanded"]:not([data-gz-focus], [data-gz-review-focus], [data-gz-review-immersive]) ${REVIEW} main > section { flex:1 1 0!important; min-width:0!important; margin-inline-end:var(--gz-sb-room)!important; }
        html[data-gz-sidebar="expanded"][data-gz-sb-fixed] #gz-sidebar.gz-sb-fixed[data-gz-sidebar-host] { z-index:1012!important; background:none!important; backdrop-filter:none!important; -webkit-backdrop-filter:none!important; pointer-events:none!important; }
        #gz-sidebar > :not(.gz-sb-slot) { pointer-events:auto; }
        #gz-sidebar > :is(.gz-sb-head,.gz-sb-pagehead,#gz-sb-widgets) { background:var(--gz-sb-fill,var(--gz-surface)); }
        }`;
        document.body.append(absorbSheet);
        pv(slot, 'height', `${e.getBoundingClientRect().height}px`);
        const hr = host.el.getBoundingClientRect(), x = sr.left - hr.left, y = sr.top - hr.top, right = x + sr.width, bottom = y + e.getBoundingClientRect().height;
        // The owned background accepts events everywhere except the exact native Rubric aperture.
        absorbSheet.textContent += `@media screen { #gz-sidebar.gz-sb-fixed::before { content:""; position:absolute; inset:0; z-index:-1;
          border-radius:inherit; background:var(--gz-sb-fill,var(--gz-surface)); pointer-events:auto;
          clip-path:polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${x}px ${y}px,${right}px ${y}px,${right}px ${bottom}px,${x}px ${bottom}px,${x}px ${y}px,0 0);
        } }`;
      } else {
        const grid = css(e.parentElement), native = css(e);
        const columns = grid.gridTemplateColumns.split(/\s+/).map(parseFloat);
        if (grid.display !== 'grid' || columns.length !== 3 || columns.some((v) => !Number.isFinite(v)) || columns[0] < 1 || columns[1] !== 0 || columns[2] < 200
          || native.gridColumnStart !== '3' || native.gridColumnEnd !== 'span 1' || native.gridRowStart !== '1' || native.gridRowEnd !== 'span 2') return;
        // A transformed, clipped or independently stacked ancestor cannot project into the sidebar's viewport layer.
        let count = 0;
        for (let p = e; p; p = p.parentElement) {
          if (++count > 30) return;
          const c = css(p);
          if (c.display === 'none' || c.visibility !== 'visible' || c.transform !== 'none' || c.perspective !== 'none' || c.filter !== 'none'
            || c.backdropFilter !== 'none' || c.clipPath !== 'none' || c.opacity !== '1' || c.isolation !== 'auto'
            || !['none', ''].includes(c.contain) || !['normal', ''].includes(c.containerType) || c.willChange !== 'auto'
            || (c.position !== 'static' && c.zIndex !== 'auto')) return;
        }
        if (host.el.scrollTop || host.el.scrollHeight > host.el.getBoundingClientRect().height + 1) return;
        absorbed = list;
        absorbSheet = make('style', { id: 'gz-sb-absorb' });
        pv(slot, 'height', '1px');
        const sr = slot.getBoundingClientRect();
        absorbSheet.textContent = `@media screen { html[data-gz-sidebar="expanded"]:not([data-gz-focus]) ${PANEL} {
          position:fixed!important; z-index:1001!important; top:${sr.top}px!important; left:${sr.left}px!important; right:auto!important; bottom:auto!important;
          width:${sr.width}px!important; max-width:none!important; min-width:0!important; margin:0!important; box-sizing:border-box;
          padding:calc(var(--gz-sb-pad, 1rem) * .75)!important; border:1px solid var(--gz-border-line, var(--gz-line))!important;
          border-radius:var(--gz-sb-ir, 8px)!important; background:var(--gz-surface)!important; box-shadow:none!important;
        } html[data-gz-sidebar="expanded"]:not([data-gz-focus]) ${OVERVIEW} { grid-template-columns:minmax(0,1fr)!important; }
        html[data-gz-sidebar="expanded"]:not([data-gz-focus]) ${OVERVIEW} > :not(.overview-attempts-section) { grid-column:1 / -1!important; } }`;
        document.body.append(absorbSheet);
        pv(slot, 'height', `${e.getBoundingClientRect().height}px`);
      }
      syncAbsorbed();
      if (!absorbed.length) return;
      const heading = rubricNative?.heading;
      if (!rubricNative || heading?.id && document.getElementById(heading.id) === heading) pageBtn.setAttribute('aria-describedby', heading?.id || 'grades-attempts-header');
      const g = absorbGen;
      const changed = () => { if (g === absorbGen) absorbInvalid(); };
      if (typeof ResizeObserver === 'function') { absorbRO = new ResizeObserver(() => { if (g === absorbGen) syncAbsorbed(); }); for (const x of [e, host.el, head, pageHead, slot, dock]) absorbRO.observe(x); }
      absorbMO = new MutationObserver(changed);
      // Watch only this overview and its ancestor attributes, never a whole-page mutation sweep.
      absorbMO.observe(e.parentElement.parentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      for (let p = e.parentElement.parentElement.parentElement; p && p !== html(); p = p.parentElement) absorbMO.observe(p, { attributes: true, childList: true });
      absorbRootMO = new MutationObserver(changed);
      absorbRootMO.observe(html(), { attributes: true, attributeFilter: ['data-gz-focus', 'data-gz-review-focus', 'data-gz-review-immersive', 'dir', 'class', 'style'] });
      document.addEventListener('scroll', absorbInvalid, { capture: true, passive: true });
      addEventListener('beforeprint', absorbInvalid);
      addEventListener('popstate', absorbInvalid);
      addEventListener('hashchange', absorbInvalid);
    } catch { absorbInvalid(); }
  };

  // ---- the layout ---------------------------------------------------------------------------------------------------
  const widgetsOn = () => { const e = ctx.settings().enhance; return e.widgets || e.notes || e.pet || e.todo; };
  let hadStyle = null;
  const setVar = (k, v) => { if (hadStyle === null) hadStyle = html().hasAttribute('style'); const s = html().style; if (s.getPropertyValue(k) !== v) s.setProperty(k, v); };
  const setAttr = (el, k, v) => { if (v === false || v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  // A drawer starts closed. Canvas's column holds a quiz's timer and question list, so a quiz's content gives up room down
  // to S.MAIN_KEEP before they go into one. On the grades page, while what-if scores show the note that they aren't
  // official (with Revert), the table keeps the room any page does (sidebar.min) instead of its own: narrower, it would
  // run under the column.
  const whatIf = () => { const n = document.getElementById('student-grades-revert'); return !!n && n.style.display !== 'none'; };
  const minMain = () => {
    const c = cfg(), min = c.min ?? S.MAIN, grades = c.grades ?? S.MAIN_GRADES;
    if (!ultra && family === 'quiz') return Math.min(min, S.MAIN_KEEP);
    return family !== 'grades' ? min : !ultra && whatIf() ? Math.min(min, grades) : grades;
  };
  let safeEnd = 0;
  const inset = () => styleOf() === 'float' ? 12 : 0;
  // Keep columns inside their native scroll/layout roots: discussion participants depend on that ancestry, and
  // current assessment grids are query containers. Sticky positioning lets native controls and widgets scroll together.
  const nativeScrollRoot = () => {
    if (!ultra || host?.own) return null;
    return family === 'discussion' ? host?.el.closest('#full-discussions[bb-intersection-observer-root]')
      : family === 'assessment' ? ['attempt', 'test'].includes(host.kind) ? host.el.parentElement : host?.el.closest('.assessment-overview-grid') : null;
  };
  let nativeScroller = null;
  const watchNativeScroll = (root) => {
    let next = null;
    if (root) {
      for (let p = host.el.parentElement; p && p !== html(); p = p.parentElement) {
        if (/(auto|scroll|overlay)/.test(getComputedStyle(p).overflowY)) { next = p; break; }
      }
      next ||= document;
    }
    if (next === nativeScroller) return;
    nativeScroller?.removeEventListener('scroll', queueLayout);
    nativeScroller = next;
    nativeScroller?.addEventListener('scroll', queueLayout, { passive: true });
  };
  const roomFor = () => Math.min(S.MAX_WIDTH, innerWidth - A.left() - inset() - safeEnd - S.GAP - minMain());
  // How the sidebar looks (the settings): on <html>, for features/sidebar.css.
  const dress = () => {
    const c = cfg(), h = html();
    setAttr(h, 'data-gz-sb-style', styleOf());
    setAttr(h, 'data-gz-sb-surface', ['glass', 'solid', 'clear'].includes(c.surface) ? c.surface : 'glass');
    setAttr(h, 'data-gz-sb-radius', c.radius && c.radius !== 'auto' ? c.radius : false);
    setAttr(h, 'data-gz-sb-density', c.density && c.density !== 'auto' ? c.density : false);
    setAttr(h, 'data-gz-sb-order', c.order === 'widgets' ? 'widgets' : false);
    setAttr(h, 'data-gz-sb-notitle', c.heading === false ? '' : false);
    setVar('--gz-sb-blur', `${Number.isFinite(c.blur) ? c.blur : 16}px`);
    setVar('--gz-sb-alpha', `${Number.isFinite(c.opacity) ? c.opacity : 88}%`);
    if (title.textContent !== name()) title.textContent = name();
    if (launch.textContent !== name()) { launch.textContent = name(); launch.setAttribute('aria-label', t('Open {name}', { name: name() })); }
  };
  const layout = () => {
    if (!active || !host || asleep) return;
    dress();
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(html()) : null;
    safeEnd = styleOf() === 'float' ? parseFloat(css?.getPropertyValue('--gz-sb-safe')) || 0 : 0;
    const hidePage = cfg().page === 'hidden';
    const shownPanels = family === 'assessment' && host.own ? absorbable() : [];
    const pageEmpty = hidePage || ((!host.page || (ultra && A.overlay()) || !filled(host.page)) && !shownPanels.length);
    const docked = drawnCount ?? (widgetsOn() ? S.docked(rec).length : 0);
    const width = S.shown(rec, cfg()).width;
    const layer = A.layer?.(), review = layer && rubricView();
    const limit = review ? (rubricNative?.width ?? review.el.getBoundingClientRect().width) - S.GAP - inset() - safeEnd : 0;
    const reviewReady = review && shownPanels[0] === review.el && limit >= S.MIN_WIDTH && (!docked || drawnCount !== null) && !hidePage && !pageFolded();
    const m = S.mode({ vw: innerWidth, left: A.left(), right: inset() + safeEnd, width: reviewReady ? Math.min(dragW || width, limit) : dragW || width, min: minMain(), empty: pageEmpty && !docked && !forced, open: isOpen() });
    // Over a layer (A.overlay: Ultra's details column), as a standalone fallback, or set to (sidebar.open), with anything
    // to show, a drawer.
    const next = (forced || ((layer && (!reviewReady || m.mode !== 'expanded') || host.fallback || A.overlay?.() || cfg().open === 'drawer') && m.mode !== 'none')) && m.mode !== 'drawer' ? 'drawer' : m.mode;
    if (next !== 'drawer' && drawer) closeDrawer(false);
    const w = next === 'drawer' ? Math.min(m.w || width, width) : m.w;
    // Glaze's own column fixed at the edge (A.own) keeps the page's content clear of it, below the adapter's top.
    setAttr(html(), 'data-gz-sb-fixed', host.own && A.own ? '' : false);
    setAttr(html(), 'data-gz-sb-ultra', ultra ? '' : false);
    // Absolute course tools reserve room in their panel, instead of also narrowing its containing page.
    const tool = ultra && host.own && [...document.querySelectorAll('.course-content-container > .panel-wrap')].some((p) =>
      p.getBoundingClientRect().width > 0 && typeof getComputedStyle === 'function' && getComputedStyle(p).position === 'absolute');
    setAttr(html(), 'data-gz-sb-tool', tool ? '' : false);
    setAttr(html(), 'data-gz-sb-family', family || false);
    setAttr(html(), 'data-gz-sb-assessment', family === 'assessment' && !host.own ? host.kind : false);
    const nativeRoot = nativeScrollRoot();
    setAttr(html(), 'data-gz-sb-native-root', nativeRoot ? '' : false);
    watchNativeScroll(nativeRoot);
    setAttr(html(), 'data-gz-sb-layer', layer ? '' : false);
    setAttr(host.el, 'data-gz-sb-overlay', ultra && A.overlay() ? '' : false);
    setAttr(html(), 'data-gz-sidebar', next);
    setAttr(html(), 'data-gz-sidebar-open', next === 'drawer' && drawer ? '' : false);
    setVar('--gz-sidebar-w', `${w}px`);
    setVar('--gz-sb-left', `${A.left()}px`);
    const main = document.getElementById('main');
    const navTop = (parseFloat(css?.getPropertyValue('--gz-navbar-top')) || 0) + (parseFloat(css?.getPropertyValue('--gz-ctabs-row')) || 0);
    // Each LMS's headers and the global navigation share this viewport: use their furthest bottom.
    const headers = A.headers?.();
    watchTop(headers);
    const reviewTop = review?.layer.querySelector('[class*="headerRoot"]')?.getBoundingClientRect().bottom;
    const top = reviewTop ?? (A.top ? Math.max(navTop, A.top(headers) ?? 0) : Math.max(navTop, Math.min(innerHeight - 100, main?.getBoundingClientRect().top || 0)));
    setVar('--gz-sb-top', `${top}px`);
    if (nativeRoot) {
      const scrollRect = nativeScroller === document ? null : nativeScroller?.getBoundingClientRect();
      setVar('--gz-sb-native-offset', `${Math.max(0, top - (scrollRect?.top || 0))}px`);
      setVar('--gz-sb-native-top', `${Math.max(top, host.el.getBoundingClientRect().top)}px`);
      setVar('--gz-sb-native-end', `${scrollRect ? Math.max(0, innerHeight - scrollRect.bottom) : 0}px`);
    }
    foot();
    pageHead.hidden = pageEmpty;
    setAttr(host.el, 'data-gz-sb-page-hidden', hidePage ? '' : false);
    jump.hidden = cfg().jump === false || pageEmpty || !docked || !((host.page?.offsetHeight || slot?.offsetHeight || 0) > innerHeight * 0.6);
    edge.hidden = next !== 'none';
    launch.hidden = next !== 'drawer' || drawer;
    backdrop.hidden = next !== 'drawer' || !drawer || modalAway;
    for (const b of [edge, launch]) if (b.parentNode !== document.body) document.body.append(b);
    bars();
    // Keep our backdrop in the same native stacking context as a sticky discussion drawer.
    const backdropParent = nativeRoot ? host.el.parentElement : document.body;
    if (backdrop.parentNode !== backdropParent) backdropParent.append(backdrop);
    // A labelled landmark beside the content; a dialog while it is an open drawer.
    const dialog = next === 'drawer' && drawer;
    lift(ultra && dialog && !modalAway && !nativeRoot);
    setAttr(host.el, 'role', next === 'none' || (next === 'drawer' && !drawer) ? false : dialog ? 'dialog' : 'complementary');
    setAttr(host.el, 'aria-labelledby', next === 'none' ? false : 'gz-sb-title');
    setAttr(host.el, 'aria-modal', dialog && !modalAway ? 'true' : false);
    const text = t(next === 'drawer' ? 'Close sidebar' : isOpen() ? 'Collapse sidebar' : 'Expand sidebar');
    if (toggle.getAttribute('aria-label') !== text) { label(toggle, text); toggle.textContent = next === 'drawer' ? '×' : (isOpen() !== rtl() ? '⇥' : '⇤'); }
    setAttr(toggle, 'aria-expanded', next === 'drawer' ? false : String(isOpen()));
    grip.hidden = next !== 'expanded';
    setAttr(grip, 'aria-valuenow', String(w));
    if (next !== mode) { mode = next; emit('mode', mode); }
    absorb(next === 'expanded' && !hidePage && !pageFolded() ? shownPanels : []);
    if (host.own) pageHead.hidden = !absorbed.length;
    if (layer && next === 'expanded' && !rubricNative && review) {
      absorbBlocked.set(review.el, absorbKey());
      queueMicrotask(() => { if (on && active && !asleep) layout(); });
    }
  };
  const paint = () => {
    if (!active || !host || asleep) return;
    const f = { ...rec.fold[family] };
    // This page folded at first (sidebar.page), until it is unfolded on a page of this kind.
    f.page ??= cfg().page === 'folded';
    pageBtn.setAttribute('aria-expanded', String(!f.page));
    setAttr(host.el, 'data-gz-sb-fold-page', f.page && host.page ? '' : false);
    dockBtn.setAttribute('aria-expanded', String(!f.widgets));
    list.hidden = !!f.widgets;
    addBtn.hidden = !!f.widgets;
    if (f.widgets && adding) adding.hidden = true;
    offer.hidden = !!f.widgets || rec.offer.todo !== 'pending' || rec.dest.todo === 'dock' || !ctx.settings().enhance.todo;
    if (!adding.hidden) openAdd(true, false);
  };
  // A pass (the site's, or the column changed): the column found again, dressed if it isn't, laid out.
  // The page's kind and course move on only once its new view is there: an address alone (Ultra routes in place) doesn't
  // relabel what still shows. A populated replacement column, changed native blocks, or a details layer come or gone
  // establishes the new view. Elapsed time says nothing about a slow route's content.
  const viewOf = (n) => {
    if (!n) return null;
    const nodes = [...n.page.children].filter((e) => !part(e) && !/^gz-/.test(e.id || '') && !/(^|\s)gz-/.test(e.className || ''));
    const content = n.el.closest('.course-content-container')?.querySelector('.course-outline-content');
    return { el: n.el, nodes, text: nodes.map((e) => e.textContent).join('\n'), content,
      child: content?.querySelector('[class*="contentList-"]')?.lastElementChild || content?.lastElementChild,
      cid: content?.closest('[bb-course-membership-markups]')?.getAttribute('bb-course-membership-markups') };
  };
  const busyView = (el) => !!el?.querySelector('.spinner, [aria-busy="true"], .MuiSkeleton-root, path[class*="makeStylesindeterminateSvg-"]');
  const settled = (fam, cid, n) => {
    if (!ultra || !family || !host) return true;
    if (busyView(n?.el)) return false;
    if (cid === course && ['detail', 'discussion'].some((f) => family === f || fam === f)) return true;
    if (!n) return !host.el.isConnected || host.own || !document.querySelector('aside.outline-actions, div.todo-panel');
    const v = viewOf(n);
    if (v.cid && cid && v.cid !== cid) return false;
    const body = v.content && !busyView(v.content) && (v.content !== nativeView?.content || v.child !== nativeView?.child);
    return body || (filled(n.page) && (!nativeView || n.el !== nativeView.el || v.text !== nativeView.text || v.nodes.length !== nativeView.nodes.length || v.nodes.some((e, i) => e !== nativeView.nodes[i])));
  };
  const place = () => {
    if (!on || !rec) return;
    if (covered()) { cover(); return; }
    asleep = false;
    build();
    const path = location.pathname + (location.search || '');
    if (route !== path) { absorbInvalid(); route = path; openHere = null; genOf(); closeDrawer(false); }
    const fam = A.family(), cid = A.courseId();
    // A kind of page the sidebar is off on (sidebar.off): the page as the LMS has it, no dock, until a page it is on.
    if (!enabled()) { teardown(); return; }
    const moved = fam !== family || cid !== course;
    const n = A.native();
    if (moved && !settled(fam, cid, n)) return;
    if (moved) { family = fam; course = cid; gen++; }
    nativeView = viewOf(n);
    if (!host || !host.el.isConnected || (n ? host.el !== n.el || host.page !== n.page : !host.own)) attach(n);
    else {
      if (head.parentNode !== host.el) host.el.prepend(grip, head);
      if (self()) { if (pageHead.previousElementSibling !== head) head.after(pageHead); }
      else if (host.page && pageHead.nextElementSibling !== host.page) host.page.before(pageHead);
      else if (!host.page && (pageHead.previousElementSibling !== head || slot.previousElementSibling !== pageHead)) { head.after(pageHead); pageHead.after(slot); }
      if (dock.parentNode !== host.el) host.el.append(dock);
      // Ultra's late blocks stay before the dock visually through flex order, without reinserting live media.
    }
    host.fallback = !n && !!A.standalone?.();
    const first = !active;
    active = true;
    if (first) emit('change');
    else if (moved) emit('context', context());
    paint();
    layout();
  };
  // Glaze's footer: fixed on Ultra, at the end of the page on Canvas. Reserve Canvas's footer height even below the
  // fold, so scrolling it into view never shrinks the column under the pointer or needs another layout measurement.
  const foot = () => {
    const f = document.getElementById('gz-footer');
    const r = f?.isConnected && f.getClientRects().length ? f.getBoundingClientRect() : null;
    setVar('--gz-sb-foot', `${r ? Math.max(0, Math.round(ultra ? innerHeight - r.top : r.height)) : 0}px`);
  };
  // A bar the site fixes along the window's bottom holds its actions at its end, where the edge buttons are: Ultra's Save
  // and Submit (content.js tags them; an older test's footer Ultra places absolutely, untagged) and its help button,
  // Canvas's Previous and Next; the site's CSS stands them on Glaze's bar. The button showing stands above the highest one
  // under it (--gz-sb-bar). A layer the window's height is no bar.
  const bars = () => {
    const b = [launch, edge].find((x) => !x.hidden)?.getBoundingClientRect();
    let up = 0;
    if (b?.width) for (const e of document.querySelectorAll('[data-gz-fixed-bottom], .pagehelp-directive, #module_sequence_footer, footer.submit-footer.panel-footer-fixed')) {
      const r = e.getBoundingClientRect();
      if (r.height && r.height < innerHeight / 2 && r.left < b.right && r.right > b.left && !host.el.contains(e)) up = Math.max(up, Math.round(innerHeight - r.top));
    }
    if (up) setVar('--gz-sb-bar', `${up}px`); else html().style.removeProperty('--gz-sb-bar');
  };
  const queueLayout = () => { if (!active || asleep) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (active && !asleep) layout(); }); };
  const onResize = () => { absorbInvalid(); queueLayout(); };
  // Breadcrumbs can wrap when their title arrives or the LMS changes its tools, without a window resize.
  // Reuse the observer until Angular replaces a header; only the active document keeps observations.
  const watchTop = (next) => {
    if (!next || typeof ResizeObserver !== 'function') return;
    if (next.length === topHeaders.length && next.every((e, i) => e === topHeaders[i])) return;
    topRO ||= new ResizeObserver(queueLayout);
    topRO.disconnect();
    topHeaders = next;
    for (const e of next) topRO.observe(e);
  };
  // The document on screen changed (features/coursetabs.js): asleep, the drawer and menu close and nothing is watched;
  // awake again, the column is looked at as on a pass.
  const cover = () => {
    const now = covered();
    if (now === asleep) return;
    if (now) {
      closeMenu();
      closeDrawer(false);
      asleep = true;
      mo?.disconnect();
      topRO?.disconnect(); topHeaders = [];
      watchNativeScroll(null);
      for (const f of [frame, passFrame]) cancelAnimationFrame(f);
      clearTimeout(noteTimer);
      widthCancel?.();
      absorb([]);
      return;
    }
    asleep = false;
    if (on) { watch(); sync(true); }
  };

  // The inner edge: a drag within 288–480 and the room the content keeps (shown as it moves, saved once let go), or the
  // arrow keys a step at a time (Shift: further), Home and End the narrowest and widest.
  const resizer = (el) => {
    const keep = (px) => { const v = Math.max(S.MIN_WIDTH, Math.min(S.MAX_WIDTH, Math.round(px))); op([{ op: 'width', px: v }]); say(t('Sidebar width {px} pixels', { px: v })); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || mode !== 'expanded') return;
      e.preventDefault();
      const x0 = e.clientX, w0 = S.shown(rec, cfg()).width, max = Math.max(S.MIN_WIDTH, roomFor());
      const move = (ev) => {
        dragW = Math.max(S.MIN_WIDTH, Math.min(max, w0 + (rtl() ? ev.clientX - x0 : x0 - ev.clientX)));
        setVar('--gz-sidebar-w', `${dragW}px`);
      };
      const up = (ev) => {
        for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) el.removeEventListener(k, f);
        widthCancel = null;
        if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
        const w = dragW;
        dragW = 0;
        if (ev?.type === 'pointerup' && w && w !== w0) keep(w); else layout();
      };
      widthCancel = () => up(null);
      el.setPointerCapture?.(e.pointerId);
      for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) el.addEventListener(k, f);
    });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 64 : 16;
      const by = { ArrowLeft: step, ArrowRight: -step }[e.key];
      const w = by ? S.shown(rec, cfg()).width + (rtl() ? -by : by) : e.key === 'Home' ? S.MIN_WIDTH : e.key === 'End' ? S.MAX_WIDTH : null;
      if (w === null) return;
      e.preventDefault();
      keep(Math.min(w, Math.max(S.MIN_WIDTH, roomFor())));
    });
  };

  // ---- the drawer ---------------------------------------------------------------------------------------------------
  // A dialog over the page: the rest of the page inert while it is open, Tab kept in it, Escape closes it, and the focus
  // goes back where it was. An LMS dialog opened from inside it is added to the page after, so it stays reachable.
  const ours = (e) => e === edge || e === launch || e === backdrop || e.id === 'gz-sb-menu';
  // The top layer escapes Ultra's positioned course panels without moving any live DOM. Native dialogs temporarily
  // take focus and stacking back (modalSync); closing the drawer restores the native host's popover attribute too.
  const lift = (want) => {
    if (lifted && (!want || lifted.el !== host?.el)) {
      try { lifted.el.hidePopover(); } catch { /* the host was replaced */ }
      if (lifted.value === null) lifted.el.removeAttribute('popover'); else lifted.el.setAttribute('popover', lifted.value);
      lifted = null;
    }
    if (!want || lifted || !host?.el.showPopover) return;
    const el = host.el, value = el.getAttribute('popover');
    el.setAttribute('popover', 'manual');
    try { el.showPopover(); lifted = { el, value }; }
    catch { if (value === null) el.removeAttribute('popover'); else el.setAttribute('popover', value); }
  };
  const nativeModal = () => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]')].some((e) =>
    e !== host?.el && e !== A.layer?.() && !host?.el.contains(e) && e.style.display !== 'none' && !e.closest('[hidden], [aria-hidden="true"]') && (e.getClientRects?.().length ?? 1));
  const modalSync = () => {
    if (!drawer || !host) return;
    const away = nativeModal(), wanted = new Set();
    // Native portals may have existed before opening the drawer. While their modal is visible, let the LMS own
    // focus and background handling, then resume this drawer when it closes.
    if (!away) for (let a = host.el; a && a !== document.body && a.parentElement; a = a.parentElement) {
      for (const s of a.parentElement.children) if (s !== a && s.tagName && !['SCRIPT', 'STYLE', 'LINK'].includes(s.tagName) && !ours(s)) wanted.add(s);
    }
    for (const e of inerted) if (!wanted.has(e)) e.inert = false;
    inerted = inerted.filter((e) => wanted.has(e));
    for (const e of wanted) if (!e.inert) { e.inert = true; inerted.push(e); }
    if (modalAway !== away) { modalAway = away; layout(); }
  };
  const openDrawer = (from) => {
    if (!active || asleep) return;
    opener = from || document.activeElement;
    drawer = true;
    layout();
    modalSync();
    modalObserver ||= new MutationObserver(modalSync);
    modalObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-hidden', 'open', 'hidden', 'style', 'class'] });
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    // In a course tab's frame, the page around it (its navigation, the tabs) is inert while the drawer is open.
    if (framed) globalThis.GZ_CTABS?.drawer?.(true);
    toggle.focus();
  };
  const closeDrawer = (restore = true) => {
    const was = drawer;
    drawer = false;
    lift(false);
    forced = false;
    modalAway = false;
    modalObserver?.disconnect();
    for (const e of inerted) e.inert = false;
    inerted = [];
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    if (!was) return;
    if (framed) globalThis.GZ_CTABS?.drawer?.(false);
    closeMenu();
    if (adding && !adding.hidden) openAdd(false, false);
    layout();
    if (restore && opener?.isConnected) opener.focus();
    opener = null;
  };
  const focusables = () => [...host.el.querySelectorAll('a[href], button, input, select, textarea, iframe, [tabindex], [contenteditable="true"]')].filter((x) =>
    !x.disabled && x.type !== 'hidden' && (x.tabIndex ?? 0) >= 0 && !x.hidden && !x.closest('[hidden], [inert], [aria-hidden="true"]')
    && (x.getClientRects?.().length ?? 1) && (typeof getComputedStyle !== 'function' || getComputedStyle(x).visibility !== 'hidden'));
  const onFocus = (e) => {
    if (drawer && !modalAway && !host?.el.contains(e.target) && !menuEl?.contains(e.target)) (focusables()[0] || toggle).focus();
  };
  const onKey = (e) => {
    if (!drawer || modalAway || menuEl?.contains(e.target)) return;
    if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    const all = focusables();
    if (!all.length) return;
    const [a, z] = [all[0], all.at(-1)];
    if (!host.el.contains(e.target) || (e.shiftKey ? e.target === a : e.target === z)) { e.preventDefault(); (e.shiftKey ? z : a).focus(); }
  };

  // ---- menus --------------------------------------------------------------------------------------------------------
  // A small menu under its button (this one's customizations; a widget's destinations, from features/widgets.js): arrow
  // keys move in it, Escape or Tab closes it and gives the focus back. items: [{ label, run }].
  let menuEl = null, menuBtn = null;
  const closeMenu = (back = false) => {
    if (!menuEl) return;
    menuEl.remove();
    document.removeEventListener('pointerdown', outside, true);
    menuBtn?.setAttribute('aria-expanded', 'false');
    if (back && menuBtn?.isConnected) menuBtn.focus();
    menuEl = menuBtn = null;
  };
  const outside = (e) => { if (menuEl && !menuEl.contains(e.target) && e.target !== menuBtn) closeMenu(); };
  const menu = (btn, items) => {
    const again = menuBtn === btn;
    closeMenu();
    if (again || !items.length) return;
    menuBtn = btn;
    const go = (run) => () => { closeMenu(true); run(); };
    const rows = items.map((x) => { const b = button(x.label, go(x.run), { className: 'gz-sb-item', tabIndex: -1 }); b.setAttribute('role', 'menuitem'); return b; });
    menuEl = make('div', { id: 'gz-sb-menu', className: 'gz-sb-menu' }, ...rows);
    menuEl.setAttribute('role', 'menu');
    if (btn.getAttribute('aria-label')) menuEl.setAttribute('aria-label', btn.getAttribute('aria-label'));
    const r = btn.getBoundingClientRect();
    Object.assign(menuEl.style, { top: `${Math.round(r.bottom + 4)}px`, ...(rtl() ? { left: `${Math.round(r.left)}px` } : { right: `${Math.max(0, Math.round(innerWidth - r.right))}px` }) });
    menuEl.addEventListener('keydown', (e) => {
      const i = rows.indexOf(e.target);
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: rows.length - 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); rows[(to + rows.length) % rows.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation?.(); closeMenu(true); }
    });
    (ultra && drawer ? dock : document.body).append(menuEl);
    const box = menuEl.getBoundingClientRect();
    const clamp = (v, size, room) => Math.max(8, Math.min(v, room - size - 8));
    Object.assign(menuEl.style, { top: `${clamp(r.bottom + 4, box.height, innerHeight)}px`,
      ...(rtl() ? { left: `${clamp(r.left, box.width, innerWidth)}px` } : { right: `${clamp(innerWidth - r.right, box.width, innerWidth)}px` }) });
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    rows[0].focus();
  };

  // ---- Add widgets --------------------------------------------------------------------------------------------------
  // Every widget that can dock here (features/widgets.js catalog), where it is now, and a button to bring it into the
  // dock: a widget elsewhere moves, it isn't copied.
  const WHERE = { dock: 'In the sidebar', board: 'On the Dashboard', float: 'Floating', off: 'Not shown' };
  let addSig = '';
  const openAdd = (show, focus = true) => {
    if (!active) return;
    if (show && rec.fold[family]?.widgets) op([{ op: 'section', family, part: 'widgets', v: false }]);
    adding.hidden = !show;
    addBtn.setAttribute('aria-expanded', String(!!show));
    if (!show) return;
    const all = globalThis.GZ_WIDGETS_UI?.catalog?.() || [];
    const sig = JSON.stringify(all);
    if (sig === addSig && adding.children.length) { if (focus) adding.querySelector('button')?.focus(); return; }
    addSig = sig;
    const rows = all.map((x) => make('li', { className: 'gz-sb-row' },
      make('span', { className: 'gz-sb-name', textContent: x.name }), make('span', { className: 'gz-sb-faint', textContent: t(WHERE[x.where] || WHERE.off) }),
      x.where === 'dock' ? null : button(t(x.where === 'off' ? 'Add' : 'Move here'), () => {
        op([{ op: 'dock', id: x.id }]).then(() => {});
        say(t('{name} is in the sidebar.', { name: x.name }));
        openAdd(true);
        list.querySelector(`[data-tile="${x.id}"]`)?.focus?.();
      }, { className: 'gz-sb-btn gz-sb-small' })));
    adding.replaceChildren(
      make('h3', { className: 'gz-sb-sub', textContent: t('Add widgets') }),
      rows.length ? make('ul', { className: 'gz-sb-rows' }, ...rows) : make('p', { className: 'gz-sb-faint', textContent: t('Turn on widgets in Glaze settings to add them here.') }),
      button(t('Done'), () => { openAdd(false); addBtn.focus(); }, { className: 'gz-sb-btn gz-sb-small' }));
    if (focus) adding.querySelector('button')?.focus();
  };

  // ---- starting and stopping ----------------------------------------------------------------------------------------
  // Everything Glaze added taken away, and the column back as the LMS had it. features/widgets.js hears first, so it
  // takes its docked tiles away itself.
  const teardown = () => {
    epoch++;
    gen++;
    const was = active;
    active = false;
    if (was) emit('change');
    closeMenu();
    closeDrawer(false);
    detach();
    own?.remove();
    edge?.remove();
    launch?.remove();
    backdrop?.remove();
    cancelAnimationFrame(frame);
    cancelAnimationFrame(passFrame);
    clearTimeout(noteTimer);
    clearTimeout(retryTimer);
    nativeView = null; route = '';
    asleep = false;
    bare();
    openHere = null;
    removeEventListener('resize', onResize);
    watchNativeScroll(null);
    document.removeEventListener('visibilitychange', cover);
    try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ }
    starting = null; rec = null; key = ''; flying = 0; lost = false;
    drawnCount = null;
    mode = 'none';
  };
  // <html> as before the sidebar: its attributes and variables gone.
  const SB_ATTRS = ['data-gz-sidebar', 'data-gz-sidebar-open', 'data-gz-sidebar-todo', 'data-gz-sb-fixed', 'data-gz-sb-ultra', 'data-gz-sb-family', 'data-gz-sb-tool', 'data-gz-sb-layer',
    'data-gz-sb-style', 'data-gz-sb-surface', 'data-gz-sb-radius', 'data-gz-sb-density', 'data-gz-sb-order', 'data-gz-sb-notitle', 'data-gz-sb-native-root', 'data-gz-sb-assessment'];
  const bare = () => {
    const h = html();
    if (!h) return;
    for (const k of SB_ATTRS) h.removeAttribute(k);
    for (const k of ['--gz-sidebar-w', '--gz-sb-left', '--gz-sb-top', '--gz-sb-foot', '--gz-sb-bar', '--gz-sb-blur', '--gz-sb-alpha', '--gz-sb-native-offset', '--gz-sb-native-top', '--gz-sb-native-end']) if (h.style?.getPropertyValue?.(k)) h.style.removeProperty(k);
    if (hadStyle === false && h.getAttribute('style') === '') h.removeAttribute('style');
    hadStyle = null;
  };
  const sync = (want) => {
    on = !!want && enabled();
    if (!on) { teardown(); return; }
    document.addEventListener('visibilitychange', cover);
    ready().then(async (ok) => {
      if (!ok || !on) return;
      const g = epoch;
      let uid;
      try { uid = await account(); } catch { if (g === epoch) teardown(); return; }
      if (g !== epoch || !on) return;
      if (S.key(LMS, location.origin, uid) !== key) { teardown(); sync(true); return; }
      if (covered()) { cover(); return; }
      if (!active) { addEventListener('resize', onResize); document.addEventListener('visibilitychange', cover); }
      // Ultra's passes come with every change Angular makes: once there, they are gathered into one a frame.
      if (ultra && active) { cancelAnimationFrame(passFrame); passFrame = requestAnimationFrame(() => { if (on && active && !asleep) place(); }); }
      else place();
    });
  };

  // What features/widgets.js and other files use: host() the column's parts while it is here; context() the page it is
  // for (gen moves on with the page, the account or the document); on('change' | 'mode' | 'context', fn) → stop; drawn(n)
  // how many widgets it drew into the dock; asleep() while another document has the sidebar; cover() said by course tabs
  // when the document on screen changes.
  const context = () => ({ site: ctx.site, family, courseId: course, accountId: S?.parse(key)?.uid || '', gen: genOf() });
  const hostOf = () => (active && host && !asleep ? { el: host.el, widgets: list, page: host.page, mode, active: true } : null);
  const drawn = (n) => {
    if (drawnCount !== n) { drawnCount = n; layout(); }
    if (!asleep && adding && !adding.hidden) openAdd(true, false);
  };
  // To Do's scope here: the account's choice, else the settings' (lib/sidebar.js shown).
  const scope = () => (rec && S ? S.shown(rec, cfg()).todoScope : 'follow');
  return { enabled, scope, sync, ready, cover, asleep: () => asleep, active: () => active, failed: () => failed, rec: () => rec, op, host: hostOf, context, on: on_, say, status, drawn, menu, add: () => { if (mode === 'none' || (mode === 'drawer' && !drawer)) { forced = mode === 'none'; openDrawer(document.activeElement); } openAdd(true); } };
})();

GZ_SIDEBAR_UI;
