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

  // ---- adapters -----------------------------------------------------------------------------------------------------
  // Each LMS's: family() the kind of page (its sections fold per kind), courseId() the page's course ('' elsewhere),
  // native() its own column ({ el, page }: the column and its content) when the page shows one Glaze recognizes, else
  // null; boundary() where Glaze's own column goes without one; left() what its navigation takes from the window's width.
  // Optional: own, a class for Glaze's own column; overlay() the page is a layer the sidebar only opens over; top() where
  // a fixed column starts (px, null for the navigation's). Course tabs' frames come later still.
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
    },
    // Blackboard Ultra. Its columns are flex columns of blocks with no wrapper of their own, so the column is its own
    // content (page === el): Glaze's header goes first in it, This page right after, the widgets last, and every block
    // between stays where Ultra (or Glaze's outline helpers: Course notes, the syllabus) put it. The Courses page's column
    // holds Ultra's To Do; a course outline's (aside.outline-actions) Faculty, Details & Actions and the schedule. A
    // content item's or a discussion's details column is in a layer over the page, where keeping room is wrong: Ultra's is
    // left as it is, and the existing dock opens as a drawer (overlay). Elsewhere, Glaze's own column, fixed at
    // the window's edge (own) with the page's content kept clear of it (features/sidebar.css).
    ultra: {
      family() {
        const p = location.pathname;
        if (document.querySelector('.layer-details')) return 'detail';
        if (/^\/ultra\/course\/?$/.test(p)) return 'courses';
        if (/^\/ultra\/courses\/_\d+_\d+\/outline/.test(p)) return 'outline';
        return 'other';
      },
      // Follow page: the course whose outline (or an item opened over it) this is; all courses elsewhere.
      courseId: () => (/^\/ultra\/courses\/_\d+_\d+\/outline/.test(location.pathname) && ctx.courseId?.()) || '',
      native() {
        // A details layer covers the outline; it does not replace its column or the live widgets in it.
        const f = /^\/ultra\/courses\/_\d+_\d+\/outline/.test(location.pathname) ? 'outline' : ADAPTERS.ultra.family();
        const el = f === 'courses' ? document.querySelector('div.todo-panel') : f === 'outline' ? document.querySelector('aside.outline-actions') : null;
        return el ? { el, page: el } : null;
      },
      boundary: () => document.body,
      own: 'gz-sb-fixed',
      overlay: () => !!document.querySelector('.layer-details'),
      // Where the page's content starts: a course's panel, else the page (#main-content-inner, whose start padding is
      // Glaze's bar's room), right of Ultra's own nav.
      left() {
        const m = document.querySelector('.course-outline-content') || document.querySelector('div.bb-course-navigation')
          || document.querySelector('.routed-page.bb-offcanvas-container') || document.getElementById('main-content-inner');
        if (!m) return 0;
        const r = m.getBoundingClientRect();
        let pad = 0;
        try { pad = parseFloat(getComputedStyle(m).paddingInlineStart) || 0; } catch { /* no styles to ask */ }
        return Math.max(0, Math.round((rtl() ? innerWidth - r.right : r.left) + pad));
      },
      // Below a course's top bar (with Glaze's course tabs in it), when one is open; else below the navigation (CSS).
      top() {
        const r = document.querySelector('div.bb-course-navigation')?.getBoundingClientRect();
        return r && r.height && r.top < innerHeight / 2 ? Math.max(0, Math.round(r.bottom)) : null;
      },
    },
  };
  const A = ADAPTERS[LMS] || ADAPTERS.canvas;
  // Native To Do lists Better To Do can take the place of (features/apps.css hides them while data-gz-sidebar-todo is set).
  const NATIVE_TODO = '.Sidebar__TodoListContainer, .todo-list-header, ul.to-do-list, bb-todo';

  // ---- state --------------------------------------------------------------------------------------------------------
  let S = null; // lib/sidebar.js
  let on = false, starting = null, failed = false, active = false;
  let key = '', rec = null, flying = 0, reads = 0, lost = false, epoch = 0;
  let family = '', course = '', gen = 0;
  let host = null; // { el, page, own }: the column dressed now
  let kept = []; // the native column's own attributes before, as [name, value | null]
  let own = null, head = null, title = null, jump = null, more = null, toggle = null, grip = null, pageHead = null, pageBtn = null;
  let dock = null, dockBtn = null, list = null, note = null, addBtn = null, adding = null, live = null, edge = null, launch = null;
  let mode = 'none', drawer = false, forced = false, opener = null, inerted = [], dragW = 0, modalAway = false;
  let modalObserver = null, backdrop = null, widthCancel = null, lifted = null;
  let drawnCount = null; // the widgets features/widgets.js drew into the dock (null: not said yet)
  let mo = null, frame = 0, noteTimer = 0, passFrame = 0, offer = null;
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
  const op = (ops) => {
    if (!active || !rec || !S?.ops(ops)) return Promise.resolve(false);
    reads++;
    rec = S.apply(rec, ops, { lms: LMS });
    emit('change');
    paint();
    layout();
    flying++;
    const k = key, g = epoch;
    return send({ type: 'glaze:sidebar', key: k, ops }).then((r) => {
      const ok = r?.ok === true;
      if (g !== epoch) return ok;
      if (!ok) lost = true;
      if (--flying || k !== key) return ok;
      const n = ++reads;
      get(k).then((x) => { if (g === epoch && !flying && n === reads && k === key && active) adopt(x[k]); });
      if (lost) { lost = false; status(t("Couldn't save. Try again.")); }
      return ok;
    });
  };
  const onStore = (ch, a) => { if (a === 'local' && key && ch[key]) { reads++; if (!flying && active) adopt(ch[key].newValue); } };

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
    if (!next.mig) { const a = await send({ type: 'glaze:sidebar', key: k, ops: [{ op: 'migrate' }] }); if (a?.ok && a.rec) next = S.clean(a.rec); }
    if (g !== epoch) return false;
    key = k;
    rec = next;
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    return true;
  };
  // Resolves true once the record is in, false if it can't be here (no account, the extension reloaded): then the page
  // stays as it was, and it tries again after a minute.
  const ready = () => {
    const g = epoch;
    return (starting ||= start().then((ok) => { if (g === epoch) failed = false; return ok; }, () => {
      if (g !== epoch) return false;
      failed = true;
      setTimeout(() => { if (g === epoch) { starting = null; failed = false; } }, 60000);
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
    ]), { className: 'gz-sb-icon gz-sb-more' }), t('Customize sidebar'));
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    toggle = button('', () => {
      if (mode === 'drawer') closeDrawer();
      else { const v = !rec.open; op([{ op: 'open', v }]); say(t(v ? 'Sidebar expanded.' : 'Sidebar collapsed.')); toggle.focus(); }
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
    pageBtn = button(t('This page'), () => fold('page'), { className: 'gz-sb-sec-btn' });
    pageHead = make('h2', { className: 'gz-sb-sec gz-sb-pagehead' }, pageBtn);
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
    launch = label(button(t('Sidebar'), () => openDrawer(launch), { id: 'gz-sb-launch', className: 'gz-sb-btn gz-sb-launch gz-sb-own', hidden: true }), t('Open the sidebar'));
    launch.setAttribute('aria-haspopup', 'dialog');
    backdrop = make('div', { className: 'gz-sb-backdrop', hidden: true });
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.addEventListener('pointerdown', () => closeDrawer());
  };
  const fold = (part) => {
    const v = !(rec.fold[family] || {})[part];
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
    widthCancel?.();
    mo?.disconnect();
    for (const e of [grip, head, pageHead, dock]) e?.remove();
    if (host.own) host.el.remove();
    else {
      for (const [k, v] of kept) { if (v === null) host.el.removeAttribute(k); else host.el.setAttribute(k, v); }
      for (const k of ['data-gz-sidebar-host', 'data-gz-sb-fold-page', 'data-gz-sb-self', 'data-gz-sb-overlay']) host.el.removeAttribute(k);
    }
    kept = [];
    host = null;
  };
  const attach = (n) => {
    closeDrawer(false);
    detach();
    if (n) {
      host = { el: n.el, page: n.page, own: false };
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
    host.el.append(dock);
    // The page's own content may arrive late (Canvas's Dashboard fills its column after load): looked at again once a
    // frame, never rebuilt.
    if (host.page && typeof MutationObserver === 'function') {
      mo ||= new MutationObserver((rs) => { if (!rs?.length || !rs.every(mine)) { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (active) (ultra ? place() : layout()); }); } });
      mo.observe(host.page, { childList: true, subtree: true });
      // Ultra (Angular) may swap its column for a new one between the site's passes: its parent is watched for that.
      if (ultra && host.el.parentNode) mo.observe(host.el.parentNode, { childList: true });
    }
  };
  // Ultra's columns are their own content (ADAPTERS.ultra).
  const self = () => !!host && host.page === host.el;
  // A change only to Glaze's own parts of the column (a docked widget redrawing, the header) says nothing of the page's.
  const part = (n) => n === grip || n === head || n === pageHead || n === dock;
  const mine = (r) => [grip, head, pageHead, dock].some((e) => e && e !== r.target && e.contains?.(r.target)) || part(r.target)
    || ([...(r.addedNodes || []), ...(r.removedNodes || [])].length > 0 && [...(r.addedNodes || []), ...(r.removedNodes || [])].every((e) => part(e) && e.parentNode === host?.el));
  // Content: a child with words or a control, not one Glaze hides (the native To Do it replaces).
  const filled = (el) => [...el.children].some((c) => c.tagName && !part(c) && !['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK'].includes(c.tagName) && !c.hidden
    && !(html().hasAttribute('data-gz-sidebar-todo') && c.closest(NATIVE_TODO) === c)
    && (c.textContent.trim() || c.querySelector('a, button, input, select, textarea, img, svg, canvas, iframe')));

  // ---- the layout ---------------------------------------------------------------------------------------------------
  const widgetsOn = () => { const e = ctx.settings().enhance; return e.widgets || e.notes || e.pet || e.todo; };
  const setVar = (k, v) => { const s = html().style; if (s.getPropertyValue(k) !== v) s.setProperty(k, v); };
  const setAttr = (el, k, v) => { if (v === false || v == null) { if (el.hasAttribute(k)) el.removeAttribute(k); } else if (el.getAttribute(k) !== v) el.setAttribute(k, v); };
  const roomFor = () => Math.min(S.MAX_WIDTH, innerWidth - A.left() - S.GAP - (family === 'grades' ? S.MAIN_GRADES : S.MAIN));
  const layout = () => {
    if (!active || !host) return;
    const pageEmpty = !host.page || (ultra && A.overlay()) || !filled(host.page);
    const docked = drawnCount ?? (widgetsOn() ? S.docked(rec).length : 0);
    const m = S.mode({ vw: innerWidth, left: A.left(), width: dragW || rec.width, grades: family === 'grades', empty: pageEmpty && !docked && !forced, open: rec.open });
    // Over a layer (A.overlay: Ultra's details column), or as a standalone fallback, with anything to show, a drawer.
    const next = (forced || ((host.fallback || A.overlay?.()) && m.mode !== 'none')) && m.mode !== 'drawer' ? 'drawer' : m.mode;
    if (next !== 'drawer' && drawer) closeDrawer(false);
    const w = next === 'drawer' ? Math.min(m.w || rec.width, rec.width) : m.w;
    // Glaze's own column fixed at the edge (A.own) keeps the page's content clear of it, below the adapter's top.
    setAttr(html(), 'data-gz-sb-fixed', host.own && A.own ? '' : false);
    setAttr(html(), 'data-gz-sb-ultra', ultra ? '' : false);
    setAttr(host.el, 'data-gz-sb-overlay', ultra && A.overlay() ? '' : false);
    setAttr(html(), 'data-gz-sidebar', next);
    setAttr(html(), 'data-gz-sidebar-open', next === 'drawer' && drawer ? '' : false);
    setVar('--gz-sidebar-w', `${w}px`);
    const main = document.getElementById('main');
    const css = typeof getComputedStyle === 'function' ? getComputedStyle(html()) : null;
    const navTop = (parseFloat(css?.getPropertyValue('--gz-navbar-top')) || 0) + (parseFloat(css?.getPropertyValue('--gz-ctabs-row')) || 0);
    // Ultra's adapter says where a fixed column starts (a course's top bar), else below the navigation.
    const top = A.top ? A.top() ?? navTop : Math.max(navTop, Math.min(innerHeight - 100, main?.getBoundingClientRect().top || 0));
    setVar('--gz-sb-top', `${top}px`);
    pageHead.hidden = pageEmpty;
    jump.hidden = pageEmpty || !docked || !(host.page.offsetHeight > innerHeight * 0.6);
    edge.hidden = next !== 'none';
    launch.hidden = next !== 'drawer' || drawer;
    backdrop.hidden = next !== 'drawer' || !drawer || modalAway;
    for (const b of [edge, launch, backdrop]) if (b.parentNode !== document.body) document.body.append(b);
    // A labelled landmark beside the content; a dialog while it is an open drawer.
    const dialog = next === 'drawer' && drawer;
    lift(ultra && dialog && !modalAway);
    setAttr(host.el, 'role', next === 'none' || (next === 'drawer' && !drawer) ? false : dialog ? 'dialog' : 'complementary');
    setAttr(host.el, 'aria-labelledby', next === 'none' ? false : 'gz-sb-title');
    setAttr(host.el, 'aria-modal', dialog && !modalAway ? 'true' : false);
    const text = t(next === 'drawer' ? 'Close sidebar' : rec.open ? 'Collapse sidebar' : 'Expand sidebar');
    if (toggle.getAttribute('aria-label') !== text) { label(toggle, text); toggle.textContent = next === 'drawer' ? '×' : (rec.open !== rtl() ? '⇥' : '⇤'); }
    setAttr(toggle, 'aria-expanded', next === 'drawer' ? false : String(rec.open));
    grip.hidden = next !== 'expanded';
    setAttr(grip, 'aria-valuenow', String(w));
    if (next !== mode) { mode = next; emit('mode', mode); }
  };
  const paint = () => {
    if (!active || !host) return;
    const f = rec.fold[family] || {};
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
  const place = () => {
    if (!on || !rec) return;
    build();
    const fam = A.family(), cid = A.courseId();
    const moved = fam !== family || cid !== course;
    if (moved) { family = fam; course = cid; gen++; }
    const n = A.native();
    if (!host || !host.el.isConnected || (n ? host.el !== n.el || host.page !== n.page : !host.own)) attach(n);
    else {
      if (head.parentNode !== host.el) host.el.prepend(grip, head);
      if (self()) { if (pageHead.previousElementSibling !== head) head.after(pageHead); }
      else if (host.page && pageHead.nextElementSibling !== host.page) host.page.before(pageHead);
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
  const onResize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (active) layout(); }); };

  // The inner edge: a drag within 288–480 and the room the content keeps (shown as it moves, saved once let go), or the
  // arrow keys a step at a time (Shift: further), Home and End the narrowest and widest.
  const resizer = (el) => {
    const keep = (px) => { const v = Math.max(S.MIN_WIDTH, Math.min(S.MAX_WIDTH, Math.round(px))); op([{ op: 'width', px: v }]); say(t('Sidebar width {px} pixels', { px: v })); };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || mode !== 'expanded') return;
      e.preventDefault();
      const x0 = e.clientX, w0 = rec.width, max = Math.max(S.MIN_WIDTH, roomFor());
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
        if (ev?.type === 'pointerup' && w && w !== rec.width) keep(w); else layout();
      };
      widthCancel = () => up(null);
      el.setPointerCapture?.(e.pointerId);
      for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) el.addEventListener(k, f);
    });
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 64 : 16;
      const by = { ArrowLeft: step, ArrowRight: -step }[e.key];
      const w = by ? rec.width + (rtl() ? -by : by) : e.key === 'Home' ? S.MIN_WIDTH : e.key === 'End' ? S.MAX_WIDTH : null;
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
    e !== host?.el && !host?.el.contains(e) && e.style.display !== 'none' && !e.closest('[hidden], [aria-hidden="true"]') && (e.getClientRects?.().length ?? 1));
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
    if (!active) return;
    opener = from || document.activeElement;
    drawer = true;
    layout();
    modalSync();
    modalObserver ||= new MutationObserver(modalSync);
    modalObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-hidden', 'open', 'hidden', 'style', 'class'] });
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    toggle.focus();
  };
  const closeDrawer = (restore = true) => {
    const was = drawer;
    drawer = false;
    forced = false;
    modalAway = false;
    modalObserver?.disconnect();
    for (const e of inerted) e.inert = false;
    inerted = [];
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    if (!was) return;
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
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    rows[0].focus();
  };

  // ---- Add widgets --------------------------------------------------------------------------------------------------
  // Every widget that can dock here (features/widgets.js catalog), where it is now, and a button to bring it into the
  // dock: a widget elsewhere moves, it isn't copied.
  const WHERE = { dock: 'In the sidebar', board: 'On the Dashboard', float: 'Floating', off: 'Not shown' };
  const openAdd = (show, focus = true) => {
    if (!active) return;
    if (show && rec.fold[family]?.widgets) op([{ op: 'section', family, part: 'widgets', v: false }]);
    adding.hidden = !show;
    addBtn.setAttribute('aria-expanded', String(!!show));
    if (!show) return;
    const all = globalThis.GZ_WIDGETS_UI?.catalog?.() || [];
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
    const h = html();
    if (h) {
      for (const k of ['data-gz-sidebar', 'data-gz-sidebar-open', 'data-gz-sidebar-todo', 'data-gz-sb-fixed', 'data-gz-sb-ultra']) h.removeAttribute(k);
      h.style?.removeProperty?.('--gz-sidebar-w');
      h.style?.removeProperty?.('--gz-sb-top');
    }
    removeEventListener('resize', onResize);
    try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ }
    starting = null; rec = null; key = ''; flying = 0; lost = false;
    drawnCount = null;
    mode = 'none';
  };
  const sync = (want) => {
    on = !!want;
    if (!on) { teardown(); return; }
    ready().then((ok) => {
      if (!ok || !on) return;
      if (!active) { addEventListener('resize', onResize); try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ } }
      // Ultra's passes come with every change Angular makes: once there, they are gathered into one a frame.
      if (ultra && active) { cancelAnimationFrame(passFrame); passFrame = requestAnimationFrame(() => { if (on && active) place(); }); }
      else place();
    });
  };

  // What features/widgets.js and other files use: host() the column's parts while it is here; context() the page it is
  // for (gen moves on with the page or the account); on('change' | 'mode' | 'context', fn) → stop; drawn(n) how many
  // widgets it drew into the dock.
  const context = () => ({ site: ctx.site, family, courseId: course, gen });
  const hostOf = () => (active && host ? { el: host.el, widgets: list, page: host.page, mode, active: true } : null);
  const drawn = (n) => { if (drawnCount !== n) { drawnCount = n; layout(); } };
  return { sync, ready, active: () => active, failed: () => failed, rec: () => rec, op, host: hostOf, context, on: on_, say, status, drawn, menu, add: () => { if (mode === 'none' || (mode === 'drawer' && !drawer)) { forced = mode === 'none'; openDrawer(document.activeElement); } openAdd(true); } };
})();

GZ_SIDEBAR_UI;
