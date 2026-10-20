// Course tabs on Canvas and Blackboard Ultra (enhance.tabs), loaded on demand: each site loads this (after
// lib/coursetabs.js) in the top frame, and in each tab's own frame, while the switch is on, calls sync() from its passes,
// and held() from its mutation callback so the strip is back in a top bar Ultra has just drawn before that bar is painted.
// Each course the student opens gets a tab, as a browser's pages do: closed, pinned and reordered with the mouse or the
// keyboard, at most `cap` of them. The strip sits above the course's sticky top bar, between its two rows or below it; on
// an item opened over the course (a document, a discussion), at that panel's header; outside a course, above the page.
// A tab picked from the strip runs as a live page of its own, in a frame over this page (live tabs, below), kept running
// while hidden: what was typed, an upload under way, open folders and the scroll are there again when it is picked again.
// While a tab's frame first loads, a picture of how that course's page last looked covers it (the worker takes pictures
// of the tab on screen; memory and storage.session only, never disk). Nothing is fetched or opened in the background.
// The list is kept per site and account (storage.local ctabs:<origin>:<uid>); identity comes from the site's existing
// once-per-page reader (Canvas's profile or Ultra's /users/me).
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_CTABS = globalThis.GZ_CTABS || (() => {
  const base = globalThis.GZ_CTX;
  if (!base || !globalThis.GZ_CTABS_LIB) return null; // a frame-only injection can outlive its document
  const L = GZ_CTABS_LIB;
  // Canvas's existing list uses host-scoped keys; the shared manager uses each course's local id.
  const ctx = base.site === 'canvas' ? { ...base, courseId: base.canvasCourseId,
    me: () => base.profile().then((p) => String(p.id)),
    courseList: () => Object.fromEntries(Object.entries(base.courseList()).filter(([k]) => k.startsWith(`canvas:${location.origin}/`))
      .map(([k, c]) => [k.slice(k.lastIndexOf('/') + 1), c])),
  } : base;
  const { t } = ctx;
  const html = document.documentElement;
  const preview = /-extension:$/.test(location.protocol);
  const DEF = GZ_SANITIZE({}).tabs;
  const P = () => (preview ? ctx.settings().tabs : prefs) || DEF;

  let on = false;
  let signedOut = false;
  let prefs = null; // storage.sync `tabs`, cleaned
  let epoch = 0; // worker cache generation; pending replies from an older generation are ignored
  let who = null; // the site's signed-in account
  let loaded = false; // the stored list is in (or can't be: then this page's list only)
  let tabs = []; // lib/coursetabs.js's list
  let lastPath = '';
  let last; // the course shown at the last pass
  let strip = null;
  let list = null; // the tablist
  let note = null; // the strip's word (role=status)
  let drawn = '';
  const snaps = new Map(); // cid → snapshot, newest last
  // The editor's preview: three made-up courses, the first one open.
  let demo = ctx.site === 'canvas' ? '1' : '_1_1';
  const DEMO = [['_1_1', 'Computer Science I', 'FA26-CS101-01', 2], ['_2_1', 'Spanish 110', 'FA26-SPAN110-02', 3], ['_3_1', 'Calculus II', 'FA26-MATH201-01', 5]]
    .map(([cid, name, code, slot], i) => ({ cid: ctx.site === 'canvas' ? String(i + 1) : cid, name, code, slot, pin: i === 2, at: 0, path: '', top: 0 }));

  const local = (fn) => { try { if (chrome.runtime?.id) fn(chrome.storage.local); } catch { /* extension reloaded under the tab */ } };
  const key = () => L.storeKey(location.origin, who);
  // The worker keeps snapshots across reloads (lib/background.js 'glaze:snap'), for this site and account only.
  const send = (m) => {
    if (preview || framed || !who || !chrome.runtime?.id) return Promise.resolve(null);
    try { const sent = epoch; return Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:snap', uid: who, born: performance.timeOrigin, epoch, ...m })).then((r) => m.op === 'hello' || sent === epoch ? r : null, () => null); } catch { return Promise.resolve(null); }
  };
  const readPrefs = () => new Promise((res) => { try { if (chrome.runtime?.id) chrome.storage.sync.get('tabs', (r) => res(r?.tabs)); else res(); } catch { res(); } })
    .then((raw) => { prefs = GZ_SANITIZE({ tabs: raw }).tabs; });
  let saveTimer = 0;
  const saveNow = () => {
    clearTimeout(saveTimer);
    if (!who || !loaded || preview) return;
    if (framed) { const x = tabs.find((x) => x.cid === framed); if (x) toTop('place', { uid: who, path: x.path, top: x.top }); }
    else local((s) => s.set({ [key()]: { tabs } }));
  };
  const save = () => { if (framed) return saveNow(); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); };
  const framed = ctx.tabFrame; // in a tab's own frame: its course; '' on the page itself
  let closedCourse = ''; // a closed surrounding Canvas course stays covered until native navigation
  const here = () => (preview ? demo : ctx.courseId() === closedCourse ? '' : ctx.courseId());
  const shown = (e) => !!e && e.getClientRects().length > 0;
  const safePath = (...a) => (a.length ? L.safe(a[0], a[1]) : L.safe(location.pathname, location.search));

  // ---- where the strip goes -------------------------------------------------------------------------------------
  // The course's top bar: div.bb-course-navigation, sticky, two rows (the header, then the tools in
  // .js-course-navigation). A panel opened over the course is the last visible layer that doesn't hold the bar.
  const LAYER = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  const bars = document.getElementsByClassName('bb-course-navigation');
  const courseBar = () => { if (ctx.site === 'canvas') return [document.querySelector('.ic-app-nav-toggle-and-crumbs'), document.getElementById('mobile-header'), document.getElementById('breadcrumbs')].find(shown) || null; for (let i = bars.length - 1; i >= 0; i--) if (bars[i].localName === 'div') return bars[i]; return null; };
  const topLayer = () => [...document.querySelectorAll(LAYER)].filter(shown).pop() || null;
  // Full routed documents/overviews have neither the course bar nor the old panel wrappers. Peek stays excluded.
  const routed = () => [...document.querySelectorAll('.routed-page.bb-offcanvas-container:not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)')]
    .filter((e) => shown(e) && !e.querySelector('.bb-course-navigation')).pop() || null;
  const routedHeader = (page) => page.querySelector('[class*="panelHeaderContainerRoot"], .panel-header, header') || page.querySelector('h1');
  // An assignment's overview has no main: its body (learning-module-panel-view.routed-page-body) holds the content.
  const routedMain = (page) => page && (page.querySelector('main[class*="contentGridArea"], main, [role="main"]') || page.querySelector('.routed-page-body'));
  // A URL or header change cannot prove that Ultra replaced the outgoing content. Require a populated main and a
  // changed main/content node; otherwise the existing bounded full-load fallback keeps the old copy safe.
  const view = () => {
    const page = routed(), main = routedMain(page);
    let child = main?.lastElementChild;
    while (child?.id?.startsWith('gz-')) child = child.previousElementSibling;
    return page && [page, main, child];
  };
  const sameView = (a, b) => !!a && !!b && a[1] === b[1] && a[2] === b[2];
  const readyView = (v) => !!v?.[1] && shown(v[1]) && (!!v[2] || [...v[1].childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) && !loading(v[0]);
  let liveView = null;
  const observeView = () => {
    const v = view();
    if (!v) { liveView = null; return; }
    if (readyView(v) && (!liveView || !sameView(v, liveView.nodes))) liveView = { nodes: v, path: location.pathname + location.search };
  };
  const atView = (path = location.pathname + location.search) => {
    const v = view();
    return v ? readyView(v) && liveView && sameView(v, liveView.nodes) && (liveView.path === path || safePath(...liveView.path.split('?')) === path)
      : !/^\/ultra\/courses\/_\d+_\d+\/(?:document|assessment)\//.test(path);
  };
  // A panel over the bar: one holding the bar's middle (Glaze may inset panels a little from the window's edges).
  const covers = (a, b) => { const r = a.getBoundingClientRect(), s = b.getBoundingClientRect(), x = s.left + s.width / 2, y = s.top + s.height / 2; return r.left <= x && x <= r.right && r.top <= y && y <= r.bottom; };
  const prev = (e) => { const p = e.previousElementSibling; return p === strip ? p.previousElementSibling : p; };
  // The tools row, at the level where the header row sits beside it.
  const row2 = (bar) => {
    let r = bar.querySelector('.js-course-navigation') || bar.querySelector('.bb-ui-navigation-list-horizontal');
    while (r && r.parentElement && r.parentElement !== bar && !prev(r)) r = r.parentElement;
    return r && r.parentElement && prev(r) ? r : null;
  };
  // { at, ok (already there), put } or null (nowhere: hidden).
  const spot = (at, ok, put, clear = null) => ({ at, ok: !!ok, put, clear });
  const home = () => {
    const a = at();
    if (ctx.site === 'canvas') {
      if (!here() && (!loaded || !tabs.length)) return null;
      const bar = courseBar(), body = document.getElementById('main') || document.getElementById('content');
      if (bar) {
        const below = a !== 'above'; // Canvas has one breadcrumb row; between follows that row.
        return spot(below ? 'canvas-below' : 'canvas-above', strip.parentElement === bar && (below ? !strip.nextElementSibling : !strip.previousElementSibling),
          () => below ? bar.append(strip) : bar.prepend(strip), bar);
      }
      return body && (here() || loaded && tabs.length) ? spot('page', body.firstElementChild === strip, () => body.prepend(strip)) : null;
    }
    const bar = courseBar();
    const top = topLayer();
    if (shown(bar) && (!top || top.contains(bar) || !covers(top, bar))) {
      if (a === 'below') return spot(a, strip.parentElement === bar && !strip.nextElementSibling, () => bar.append(strip));
      const r = a === 'between' && row2(bar);
      if (r) return spot(a, strip.nextElementSibling === r, () => r.before(strip));
      return spot('above', strip.parentElement === bar && !strip.previousElementSibling, () => bar.prepend(strip));
    }
    // An item opened over the course: at its panel's header, before it (above) or after it.
    if (here() && top) {
      const hd = top.querySelector('.panel-header, header');
      if (!hd) return spot('nested', top.firstElementChild === strip, () => top.prepend(strip));
      return a === 'above' ? spot('nested', strip.nextElementSibling === hd, () => hd.before(strip)) : spot('nested', strip.previousElementSibling === hd, () => hd.after(strip));
    }
    const page = here() && routed();
    if (page) {
      const hd = routedHeader(page);
      if (!hd) return spot('routed', page.firstElementChild === strip, () => page.prepend(strip));
      return a === 'above' ? spot('routed', strip.nextElementSibling === hd, () => hd.before(strip), hd) : spot('routed', strip.previousElementSibling === hd, () => hd.after(strip), hd);
    }
    // Outside a course (the Courses page, the calendar…): above the page, once there is a tab to go back to.
    const outside = !here() && loaded && tabs.length && (document.getElementById('main-content-inner') || document.getElementById('main-content'));
    return outside ? spot('page', outside.firstElementChild === strip, () => outside.prepend(strip)) : null;
  };
  // Canvas's course menu sticks to the top of the page too: below the row holding the strip (canvas.css), at its height.
  let sizedRow = null;
  const rowSize = ctx.site === 'canvas' && typeof ResizeObserver === 'function'
    ? new ResizeObserver(([e]) => html.style.setProperty('--gz-ctabs-row', `${Math.round(e.borderBoxSize?.[0]?.blockSize ?? e.target.offsetHeight)}px`)) : null;
  const measureRow = (row) => {
    if (!rowSize || row === sizedRow) return;
    rowSize.disconnect();
    sizedRow = row;
    if (row) rowSize.observe(row); else html.style.removeProperty('--gz-ctabs-row');
  };
  let clearHeader = null, hadClear = false;
  const keepClear = (header) => {
    if (!header) measureRow(null);
    if (header === clearHeader) return;
    if (clearHeader && !hadClear) clearHeader.removeAttribute('data-gz-keep-clear');
    clearHeader = header;
    hadClear = !!header?.hasAttribute('data-gz-keep-clear');
    if (header && !hadClear) header.setAttribute('data-gz-keep-clear', '');
  };
  // Glaze's own navigation bar holds the tabs too (features/navbar.js, data-gz-navbar's word `tabs`). At 'nav' they are only
  // there: no strip, in a tab's own frame either (the page around it has the bar). Where no bar holds them, 'nav' is 'above'.
  const navHolds = () => { try { return ((framed ? parent.document : document).documentElement.getAttribute('data-gz-navbar') || '').split(' ').includes('tabs'); } catch { return false; } };
  const at = () => (P().at !== 'nav' ? P().at : navHolds() ? 'nav' : 'above');
  const hosted = () => at() === 'nav';
  const place = () => {
    if (!on || !strip) return;
    if (hosted()) { keepClear(null); strip.remove(); return; }
    const w = home();
    keepClear(w?.clear || null);
    measureRow(w?.at.startsWith('canvas-') ? w.clear : null);
    if (!w) { strip.remove(); return; }
    if (!w.ok) {
      // A node moved loses focus: given back to the tab that had it.
      const f = strip.contains(document.activeElement) && document.activeElement;
      w.put();
      if (f && document.activeElement !== f) f.focus({ preventScroll: true });
    }
    if (strip.dataset.at !== w.at) strip.dataset.at = w.at;
  };
  // From content-ultra.js's mutation callback: only when Ultra replaced the bar or took the strip away with the old one.
  // While neither the bar nor the strip's place changed it reads no layout: it runs on every change Ultra makes, and a
  // read there made the browser restyle and lay out the page each time, before Ultra's next frame. A bar or page hidden
  // or shown with no node added (a class) is seen by its size, once laid out and still before that frame is painted.
  let seenBar = null, lastBar, lastParent, sized = [];
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { lastBar = undefined; held(); }) : null;
  const held = () => {
    if (!on || !strip) return;
    const bar = courseBar();
    if (strip.isConnected && bar === lastBar && strip.parentElement === lastParent) return;
    lastBar = bar;
    if (!strip.isConnected || !(shown(bar) ? bar === seenBar : shown(seenBar) && seenBar.contains(strip))) {
      seenBar = shown(bar) ? bar : routed();
      place();
      seenBar ||= strip.parentElement;
    }
    lastParent = strip.parentElement;
    const boxes = [...new Set([bar, seenBar])].filter(Boolean);
    if (sizes && (boxes.length !== sized.length || boxes.some((e, i) => e !== sized[i]))) { sizes.disconnect(); sized = boxes; for (const e of boxes) sizes.observe(e); }
  };
  // The first paint's reservation (extras.css, set by content-ultra.js from this tab's sessionStorage before this file is in):
  // the strip's place and size, and whether pages outside a course show it.
  const flag = () => {
    const a = at(), v = a === 'nav' ? a : `${a} ${P().size}${loaded && tabs.length ? ' page' : ''}`;
    try { if (sessionStorage.getItem('gz-ctabs') !== v) sessionStorage.setItem('gz-ctabs', v); } catch { /* blocked */ }
    if (html.getAttribute('data-gz-ctabs') !== v) html.setAttribute('data-gz-ctabs', v);
  };

  // ---- the strip ------------------------------------------------------------------------------------------------
  const svg = (d) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' })) e.setAttribute(k, v);
    p.setAttribute('d', d); e.append(p); return e;
  };
  const ICON = { book: 'M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9', pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6', x: 'M7 7l10 10M17 7 7 17' };
  const make = () => {
    strip = document.createElement('div');
    strip.id = 'gz-ctabs';
    strip.setAttribute('data-gz-keep-clear', ''); // floating widgets keep off it (features/widgets.js)
    list = document.createElement('div');
    list.className = 'gz-ctabs-list';
    list.setAttribute('role', 'tablist');
    const hint = Object.assign(document.createElement('span'), { id: 'gz-ctabs-hint', hidden: true });
    note = Object.assign(document.createElement('span'), { className: 'gz-ctabs-note' });
    note.setAttribute('role', 'status');
    note.addEventListener('click', () => { note.textContent = ''; });
    strip.append(list, hint, note);
    strip.addEventListener('click', onClick);
    strip.addEventListener('auxclick', onClick);
    // No autoscroll (middle button), and no scroll from the focus a press gives a tab: the browser would bring the strip
    // into view, moving the page just as its picture is taken. The tab takes the focus without scrolling instead.
    strip.addEventListener('mousedown', (e) => {
      const el = tabOf(e);
      if (!el || e.button > 1) return;
      e.preventDefault();
      if (!e.button) el.focus({ preventScroll: true });
    });
    strip.addEventListener('keydown', onKey);
    strip.addEventListener('pointerdown', onDown);
    strip.addEventListener('pointermove', onMove);
    strip.addEventListener('pointerup', onUp);
    strip.addEventListener('pointercancel', onUp);
  };
  const set = (e, k, v) => { if (v === null) e.removeAttribute(k); else if (e.getAttribute(k) !== v) e.setAttribute(k, v); };
  const makeTab = () => {
    const e = document.createElement('div');
    e.setAttribute('role', 'tab');
    e.setAttribute('aria-describedby', 'gz-ctabs-hint');
    for (const name of ['mark', 'name', 'pin', 'x']) {
      const span = document.createElement('span');
      span.className = `gz-ctab-${name}`;
      if (name !== 'name') span.setAttribute('aria-hidden', 'true');
      if (ICON[name]) span.append(svg(ICON[name]));
      e.append(span);
    }
    return e;
  };
  const labelFor = (cid, name, code) => ctx.nickOf(cid) || (P().label === 'code' && code) || (P().label === 'short' ? L.shortName(name) : name);
  const rowsOf = () => {
    const cur = showing || here();
    const known = ctx.courseList(), colors = ctx.courseColors?.() || {};
    return (loaded ? tabs : []).map((x) => {
      const c = known[x.cid] || {};
      const nick = ctx.nickOf(x.cid);
      const name = c.name || x.name || c.code || x.code || t('Course');
      const code = c.code || x.code || '';
      const color = ctx.site === 'canvas' ? (/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '') : colors[x.cid]?.color || '';
      return { cid: x.cid, pin: x.pin, cur: x.cid === cur, label: labelFor(x.cid, name, code), full: [...new Set([nick, name, code].filter(Boolean))].join(' · '), slot: c.slot || x.slot || '', color };
    });
  };
  const draw = () => {
    if (!strip) return;
    const p = P();
    const cur = showing || here();
    const rows = rowsOf();
    const k = JSON.stringify([rows, p, ctx.locale(), drag?.on && drag.cid]);
    if (k === drawn) return;
    drawn = k;
    if (!framed) globalThis.GZ_NAVBAR_UI?.sync();
    for (const a of ['shape', 'size', 'mark', 'color']) set(strip, `data-${a}`, p[a]);
    if (strip.style.getPropertyValue('--gz-ctab-w') !== `${p.width}px`) strip.style.setProperty('--gz-ctab-w', `${p.width}px`);
    set(list, 'aria-label', t('Course tabs'));
    strip.querySelector('#gz-ctabs-hint').textContent = t('Delete closes a tab, P pins it, and Shift with an arrow key moves it.');
    const old = new Map([...list.children].map((e) => [e.dataset.courseId, e]));
    const focused = list.contains(document.activeElement) ? document.activeElement.dataset.courseId : null;
    const roving = focused || (rows.some((r) => r.cur) ? cur : rows[0]?.cid);
    const els = rows.map((r) => {
      const e = old.get(r.cid) || makeTab();
      set(e, 'data-course-id', r.cid);
      const own = ctx.site === 'canvas' && r.color; // Ultra's tabs take their colour from the slot's class
      const cls = `gz-ctab${r.slot ? ` course-color-${r.slot}` : own ? ' course-color-canvas' : ''}`;
      if (own) { if (e.style.getPropertyValue('--gz-course') !== own) e.style.setProperty('--gz-course', own); } else e.style.removeProperty('--gz-course');
      if (e.className !== cls) e.className = cls;
      set(e, 'aria-selected', String(r.cur));
      set(e, 'tabindex', r.cid === roving ? '0' : '-1');
      set(e, 'data-pin', r.pin ? '' : null);
      set(e, 'data-drag', drag?.on && drag.cid === r.cid ? '' : null);
      set(e, 'aria-label', r.pin ? t('{name}, pinned', { name: r.full }) : r.full);
      set(e, 'title', r.full);
      const n = e.querySelector('.gz-ctab-name');
      if (n.textContent !== r.label) n.textContent = r.label;
      const mark = e.querySelector('.gz-ctab-mark');
      if (p.mark === 'icon' && !mark.firstChild) mark.append(svg(ICON.book));
      else if (p.mark !== 'icon' && mark.firstChild) mark.replaceChildren();
      set(e.querySelector('.gz-ctab-pin'), 'title', t(r.pin ? 'Unpin tab' : 'Pin tab'));
      set(e.querySelector('.gz-ctab-x'), 'title', t('Close tab'));
      return e;
    });
    if (els.length !== list.children.length || els.some((e, i) => list.children[i] !== e)) {
      list.replaceChildren(...els);
      if (focused) list.querySelector(`[data-course-id="${focused}"]`)?.focus({ preventScroll: true });
    }
    // The open course's tab in view, without scrolling the page.
    const sel = list.querySelector('[aria-selected="true"]');
    if (sel && (sel.offsetLeft < list.scrollLeft || sel.offsetLeft + sel.offsetWidth > list.scrollLeft + list.clientWidth)) list.scrollLeft = sel.offsetLeft - 8;
    mark();
  };
  // The strip's word: why a tab closed. Gone again after a few seconds.
  let sayTimer = 0;
  const say = (msg) => {
    if (!framed && showing) frames.get(showing)?.el.contentWindow?.postMessage({ gzCtab: 'note', text: msg }, location.origin);
    if (!note || note.textContent === msg) return;
    note.textContent = msg; clearTimeout(sayTimer); sayTimer = setTimeout(() => { note.textContent = ''; }, 6000);
  };

  // ---- the student's courses ------------------------------------------------------------------------------------
  // The course shown: its tab (made if new; past the cap the least recently used unpinned one goes, with a word), and its
  // place (where in the course, and the scroll there, kept by onScroll).
  const visitTab = (cid) => {
    const c = ctx.courseList()[cid];
    const name = c?.name || cid === ctx.courseId() && courseBar()?.querySelector('course-page-header [class*="courseName"], course-page-header h1')?.textContent.trim() || '';
    const r = L.open(tabs, { cid, at: Date.now(), ...(name && { name: name.slice(0, 200) }), ...(c?.code && { code: c.code }) }, framed ? L.MAX : P().cap,
      (id) => frames.get(id)?.dirty || (spare.get(id) || []).some((f) => f.dirty) || next.get(id)?.dirty);
    tabs = r.tabs;
    if (r.full) say(t('Close or unpin a tab to open another course tab.'));
    if (r.gone.length) {
      const g = r.gone[0];
      const c = ctx.courseList()[g.cid] || {};
      say(t('Closed {name} to make room. Pin a tab to keep it open.', { name: labelFor(g.cid, c.name || g.name || c.code || g.code || t('Course'), c.code || g.code) }));
      for (const x of r.gone) { snaps.delete(x.cid); drop(x.cid); send({ op: 'forget', cid: x.cid }); }
    }
    save();
  };
  const notePlace = (cid) => {
    if (showing || !atView()) return;
    const x = tabs.find((y) => y.cid === cid);
    const p = x && L.placeOf(location.pathname, location.search);
    if (p?.path && x.path !== p.path) { x.path = p.path; x.top = 0; save(); }
  };
  const onScroll = (e) => {
    if (e.isTrusted && !showing) { if (framed) moved(); else { clearTimeout(capTimer); capTimer = 0; later(700); } }
    const cid = !showing && ctx.courseId();
    const sc = e.target === document ? document.scrollingElement : e.target;
    const x = cid && sc === pageScroller() && tabs.find((y) => y.cid === cid);
    if (!x || !safePath()) return;
    observeView();
    if (!atView()) return;
    notePlace(cid);
    x.top = Math.round(sc.scrollTop);
    save();
  };

  // ---- pictures ------------------------------------------------------------------------------------------------
  // How a course's page looked, to the pixel: a picture of the browser tab, which the worker takes (lib/background.js
  // 'shot') while this tab is the one on screen, of whichever page is showing (this one or a tab's frame), once it has
  // finished building, without a tip of Glaze's. Taken as the student is about to leave it (a press on a tab or on a link
  // out of the course), and after it changes, scrolls or stays, at most each 15 s per page; at most one each 0.6 s (the browser
  // allows two a second). Shown only while a tab's frame first loads, at the window size it was taken at.
  // The page's own markers only: Glaze's panels in it (its To Do, widgets) load on their own time.
  const loading = (el) => !!el && [...el.querySelectorAll('.spinner, path[class*="makeStylesindeterminateSvg-"], .MuiSkeleton-root' + (ctx.site === 'canvas' ? ', .loading, [aria-busy="true"]' : ''))]
    .some((e) => shown(e) && !e.closest('[id^="gz-"], [class^="gz-"], [class*=" gz-"]'));
  const split = (path) => { const i = path.indexOf('?'); return i < 0 ? [path, ''] : [path.slice(0, i), path.slice(i + 1)]; };
  // What is on screen: a tab's frame, or this page.
  const surface = () => {
    const f = showing && frames.get(showing);
    if (!f) return { cid: ctx.courseId(), path: safePath(), doc: document };
    let d = null; try { d = f.el.contentDocument; } catch { /* gone */ }
    return { cid: showing, path: f.ready && d ? safePath(d.location.pathname, d.location.search) : null, doc: d, frame: f };
  };
  const petSurface = (petKey) => {
    if (!on || signedOut || framed || preview || !who || petKey !== `pet:${location.origin}/${who}` || !showing || pic || !host?.hasAttribute('data-on')) return null;
    const { doc, path, frame: f } = surface();
    try {
      if (!f?.ready || !f.el.isConnected || f.el.parentElement !== host || f.el.inert || f.el.style.visibility === 'hidden' || !doc?.body || f.uid !== who || f.accountDoc !== doc || doc.location.origin !== location.origin || !(showing === PAGE ? L.outside(doc.location.pathname, doc.location.search) : L.owns(path?.split('?')[0] || '', showing))) return null;
      return { doc, frame: f.el };
    } catch { return null; }
  };
  let shooting = null, shotAt = -1e9;
  const shoot = () => {
    if (shooting) return shooting;
    const { cid, path, doc, frame } = surface();
    if (!on || signedOut || framed || preview || !cid || cid === PAGE || !path || !doc || ctx.holding() || document.visibilityState !== 'visible' || performance.now() - shotAt < 600) return Promise.resolve(null);
    if (safePath(...split(path)) !== path || loading(doc.body) || pic) return Promise.resolve(null);
    if (!frame) {
      if (!atView(path)) return Promise.resolve(null);
      const bar = shown(courseBar()) ? courseBar() : null;
      if (bar ? otherCourse(bar, cid) : !routed()) return Promise.resolve(null);
    }
    shotAt = performance.now();
    // Glaze's tip is not part of the page: hidden for the moment of the picture, a frame before it is taken.
    const tips = [...document.querySelectorAll('.gz-tip'), ...doc.querySelectorAll('.gz-tip')];
    for (const tip of tips) tip.style.visibility = 'hidden';
    const same = () => { const next = surface(); return on && next.cid === cid && next.path === path && next.doc === doc; };
    shooting = new Promise((ok) => requestAnimationFrame(() => setTimeout(ok)))
      .then(() => same() ? send({ op: 'shot', cid, path, strip: null, size: [innerWidth, innerHeight] }) : null)
      .then((x) => {
        if (!same()) { if (x?.snap) send({ op: 'forget', cid }); return null; }
        if (x?.snap?.cid === cid && x.snap.path === path) keep(x.snap);
        return x?.snap || null;
      }, () => null)
      .finally(() => { shooting = null; for (const tip of tips) tip.style.visibility = ''; });
    return shooting;
  };
  const keep = (s) => {
    snaps.delete(s.cid);
    snaps.set(s.cid, s);
    for (const k of L.fit([...snaps.values()].map((x) => [x.cid, x.n, x.at]))) snaps.delete(k);
  };
  const fits = (s, url) => !!s && s.path === url && s.size?.[0] === innerWidth && s.size?.[1] === innerHeight && safePath(...split(url)) === url;
  let capTimer = 0;
  let capWhere = '';
  let capAt = 0;
  // The page on screen: a frame's own address, which moves without this page's.
  const where = () => `${showing ? surface().path : location.href} ${showing}`;
  const capped = () => capWhere === where() && Date.now() - capAt < 15000;
  const later = (wait = 1500) => {
    if (framed || capTimer || capped()) return;
    capTimer = setTimeout(() => {
      capTimer = 0;
      (globalThis.requestIdleCallback || setTimeout)(() => {
        if (capped()) return;
        const at = where();
        shoot().then((snap) => { if (snap) { capWhere = at; capAt = Date.now(); } });
      }, { timeout: 1000 });
    }, wait);
  };
  // Leaving through Ultra's own header (home, the course switcher), or a link out of the course: a picture first, taken on
  // the press, before Ultra starts changing the page. Ultra's sign-out (the main menu's "#" link) forgets them all.
  const onLeave = (e) => {
    if (!on || e.isTrusted === false) return;
    const el = e.target instanceof Element && e.target.closest('a[href], button, [role="button"], [role="link"]');
    if (!el || el.closest('#gz-ctabs')) return;
    const href = el.getAttribute('href') || '';
    if (e.type === 'click' && (ctx.site === 'canvas' ? /^\/logout(?:[/?#]|$)/.test(href) : el.closest('.MuiDrawer-paper, #base_tools') && (href === '#' || /logout/i.test(href)))) {
      if (framed) { if (ctx.site === 'canvas') toTop('signout'); return; }
      send({ op: 'drop', signout: true });
      revoke();
      return;
    }
    const cid = ctx.courseId();
    if (framed || showing || !cid || e.type !== 'pointerdown') return;
    if (el.closest('course-page-header, .MuiDrawer-paper, #base_tools') || (href.startsWith('/') && !href.includes(`/courses/${cid}/`))) shoot();
  };

  // ---- live tabs ------------------------------------------------------------------------------------------------
  // A tab picked from the strip runs in a frame of its own (#gz-ctabs-frames, over the whole window as a course in Ultra
  // is, above Glaze's footer), named gz-ctab:<course> so Glaze there works as on a page of its own (content.js solo). Ultra draws no menu
  // in a frame. Frames stay running while hidden, however long; at most LIVE of them, the least recently shown going
  // first, and a closed tab's at once. This page's own course is shown as itself. The strip in a frame sends its picks
  // here (toTop): a tab, a close, its page leaving its course (then this page goes there), its page changing (a fresh picture).
  // Each frame is a whole Ultra in this tab's one renderer and heap: the cap keeps the tab clear of running out of memory.
  const LIVE = 4;
  // Canvas: its pages outside a course (the Dashboard, the calendar, the Inbox) open in one more frame, kept like a tab's
  // but not one and not counted: the page around, and every tab's frame, keep running.
  const PAGE = 'page';
  const frames = new Map(); // cid (or PAGE) → { el, at (last shown), ready, dirty }
  // Canvas: a frame's earlier pages stay live too, hidden, as Ultra's do while it routes in place: Back, or a link to one of
  // them, shows it at once (then loads it afresh under it). A link starts loading as it is pressed, and its page shows once
  // drawn, the one before staying on screen until then. At most KEEP earlier pages a frame, KEPT in all; never one with
  // unsaved work.
  const KEEP = 3, KEPT = 8;
  const spare = new Map(); // cid (or PAGE) → [frame], its earlier pages, oldest first
  const next = new Map(); // cid (or PAGE) → the frame loading to take its place: { go (shown when drawn), refresh (of a spare) }
  let popping = false; // Back or Forward is taking this page there: no new history entry
  // A page at `url`: a link without a fragment is that page at any of its own (the calendar's month, the Inbox's filter).
  const same = (path, url) => path === url || (!url.includes('#') && path.split('#')[0] === url);
  const pathOf = (f) => { try { const d = f?.el.contentDocument; return d && d.location.origin === location.origin && d.location.href !== 'about:blank' ? d.location.pathname + d.location.search + (ctx.site === 'canvas' ? d.location.hash || '' : '') : ''; } catch { return ''; } };
  const canvasContent = (d) => {
    const el = d.querySelector('#content, #main');
    return shown(el) && (el.childElementCount > 0 || !!el.textContent?.trim());
  };
  let showing = ''; // the course whose frame is on screen; '' for this page
  let shownFrom = ''; // this page's address when a frame covered it: if it changes, the student went somewhere here
  let host = null, pic = null, showTurn = 0, retryNote = null;
  const clearSlow = () => { retryNote?.remove(); retryNote = null; };
  const slowFrame = (cid, f) => {
    if (showing !== cid || !host) return;
    clearSlow(); unpicture(); f.el.style.visibility = '';
    const box = document.createElement('div'); box.className = 'gz-ctabs-retry';
    box.setAttribute('role', 'status');
    const text = document.createElement('p'); text.textContent = t('Course content is taking longer to load.');
    box.append(text);
    if (!f.dirty && !(spare.get(cid) || []).some((s) => s.dirty) && !next.get(cid)?.dirty) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('Retry');
      retry.addEventListener('click', () => { if (frames.get(cid) === f && !f.dirty) visit(cid); });
      box.append(retry);
    }
    const back = document.createElement('button'); back.type = 'button'; back.textContent = t('Go back');
    back.addEventListener('click', () => ctx.site === 'canvas' && closedCourse ? route('/courses') : show(''));
    box.append(back); host.append(box); retryNote = box;
  };
  const toTop = (op, m = {}) => { try { window.top.postMessage({ gzCtab: op, ...m }, location.origin); } catch { /* gone */ } };
  // The sidebar (features/sidebar.js) works in the document on screen only: this page, or the tab's frame over it. A
  // frame learns which it is from the page around it ('visible'), and counts as hidden until then. Its record's changes
  // go through that page ('sidebar'), which sends them only for the frame on screen, signed in as the page is, and
  // answers that frame alone ('sidebar:ack', with the request's number and the gen it was asked with). A drawer open in
  // the frame keeps the page around it inert ('drawer') until it closes or the frame is no longer on screen.
  let told = null;
  const visible = () => (framed ? told === true : !showing);
  const asks = new Map();
  let askN = 0;
  const askSidebar = (key, ops, gen) => new Promise((res) => {
    if (!framed || told !== true) { res(null); return; }
    const n = ++askN;
    const timer = setTimeout(() => { if (asks.delete(n)) res(null); }, 15000);
    asks.set(n, { kind: 'sidebar', gen, res: (r) => { clearTimeout(timer); res(r); } });
    toTop('sidebar', { key, ops, gen, n });
  });
  // An answer to another question, or not with the gen it was asked with, is not this document's.
  const timerGen = Math.random().toString(36).slice(2);
  const askTimer = (op) => new Promise((res) => {
    if (!framed || told !== true || !['toggle', 'reset', 'advance'].includes(op)) { res(null); return; }
    const n = ++askN, gen = timerGen;
    const timer = setTimeout(() => { if (asks.delete(n)) res(null); }, 15000);
    asks.set(n, { kind: 'timer', gen, res: (r) => { clearTimeout(timer); res(r); } });
    toTop('timer', { op, n, gen });
  });
  const acked = (d, kind = 'sidebar') => {
    const a = asks.get(d.n);
    if (!a || a.kind !== kind || d.gen !== a.gen) return;
    asks.delete(d.n);
    a.res(kind === 'timer' ? { ok: d.ok === true, ...(d.ok === true && d.timer && typeof d.timer === 'object' && { timer: d.timer }), ...(d.ok === true && Number.isFinite(d.advanced) && { advanced: d.advanced }) }
      : { ok: d.ok === true, gen: d.gen, ...(d.ok === true && d.rec && typeof d.rec === 'object' && { rec: d.rec }) });
  };
  const drawer = (v) => { if (framed) toTop('drawer', { on: !!v }); };
  // Released as soon as its frame is hidden (made inert) or goes, whatever hid it.
  let drawerFrom = null, drawerInert = [], drawerWatch = null;
  const drawerOff = () => { drawerFrom?.el.removeEventListener('load', drawerOff); drawerWatch?.disconnect(); drawerWatch = null; for (const e of drawerInert) e.inert = false; drawerInert = []; drawerFrom = null; };
  const drawerOn = (src) => {
    drawerOff();
    if (!currentFrame(showing, src) || typeof MutationObserver !== 'function') return;
    drawerFrom = src;
    for (const e of document.body.children) if (e !== host && !e.inert && !['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(e.tagName)) { e.inert = true; drawerInert.push(e); }
    src.el.addEventListener('load', drawerOff);
    drawerWatch = new MutationObserver(() => { if (!currentFrame(showing, src)) drawerOff(); });
    drawerWatch.observe(src.el, { attributes: true, attributeFilter: ['inert', 'style'] });
    drawerWatch.observe(host, { childList: true });
    drawerWatch.observe(document.body, { childList: true });
  };
  const currentFrame = (from, src) => {
    try {
      const doc = src.el.contentDocument;
      return on && !signedOut && from === showing && frames.get(from) === src && src.ready && !pic && !!host
        && src.el.isConnected && src.el.parentNode === host && !src.el.inert && src.el.style.visibility !== 'hidden' && src.el.style.display !== 'none'
        && !!who && src.uid === who && !!doc?.body && src.accountDoc === doc && doc.location.origin === location.origin
        && !!(from === PAGE ? pageable(doc.location.pathname) && L.outside(doc.location.pathname, doc.location.search) : L.owns(doc.location.pathname, from));
    } catch { return false; }
  };
  const relayTimer = (from, src, d) => {
    if (!Number.isSafeInteger(d.n) || d.n < 1 || typeof d.gen !== 'string' || !d.gen || d.gen.length > 64 || !['toggle', 'reset', 'advance'].includes(d.op)) return;
    const doc = src.el.contentDocument;
    const ack = (r) => { try { if (src.el.contentDocument === doc) src.el.contentWindow?.postMessage({ gzCtab: 'timer:ack', n: d.n, gen: d.gen, ok: r?.ok === true, ...(r?.ok === true && { timer: r.timer, advanced: r.advanced }) }, location.origin); } catch { /* gone */ } };
    if (!currentFrame(from, src)) { ack(null); return; }
    try { chrome.runtime.sendMessage({ type: 'glaze:widgetTimer', op: d.op }, (r) => ack(chrome.runtime.lastError ? null : r)); } catch { ack(null); }
  };
  const relay = (from, src, d) => {
    if (!Number.isSafeInteger(d.n) || typeof d.gen !== 'string') return;
    const doc = src.el.contentDocument;
    const ack = (r) => { try { if (src.el.contentDocument === doc) src.el.contentWindow?.postMessage({ gzCtab: 'sidebar:ack', n: d.n, gen: d.gen, ok: r?.ok === true, ...(r?.ok === true && r.rec && { rec: r.rec }) }, location.origin); } catch { /* gone */ } };
    const current = () => currentFrame(from, src) && src.el.contentDocument === doc;
    if (!current()) { ack(null); return; }
    (globalThis.GZ_SIDEBAR ? Promise.resolve() : ctx.need('lib/sidebar.js', () => globalThis.GZ_SIDEBAR)).then(() => {
      if (!current() || !globalThis.GZ_SIDEBAR?.relayable(d, ctx.site === 'canvas' ? 'canvas' : 'ultra', location.origin, who)) { ack(null); return; }
      try { chrome.runtime.sendMessage({ type: 'glaze:sidebar', key: d.key, ops: d.ops }, (r) => ack(chrome.runtime.lastError ? null : r)); } catch { ack(null); }
    }, () => ack(null));
  };
  let movedTimer = 0;
  const moved = () => { clearTimeout(movedTimer); movedTimer = setTimeout(() => toTop('moved'), 500); };
  const lay = () => {
    if (!host) return;
    const foot = document.getElementById('gz-footer');
    host.style.bottom = `${shown(foot) ? Math.max(0, Math.round(innerHeight - foot.getBoundingClientRect().top)) : 0}px`;
  };
  const drop = (cid, replacing = false) => {
    for (const s of spare.get(cid) || []) s.el.remove();
    spare.delete(cid);
    dropNext(cid);
    const f = frames.get(cid);
    if (!f) return;
    if (ctx.site === 'canvas') f.unwatch?.();
    if (drawerFrom === f) drawerOff();
    f.el.remove();
    frames.delete(cid);
    if (waiting === cid) { ++showTurn; wait(''); }
    if (showing === cid && !replacing) show('');
  };
  const dropNext = (cid) => { const g = next.get(cid); if (!g) return; clearTimeout(g.cool); clearTimeout(g.tick); g.clean?.(); g.el.remove(); next.delete(cid); turning(); if (g.reveal && waiting === cid) wait(''); };
  // Canvas loads a whole page for each link, which here would end every tab's frame; Ultra routes in place, so its frames
  // live on. With a frame running, a plain click on a link to a course page opens it in that course's frame instead (made
  // if new), and in a tab's frame a link to another course goes to that course's frame: the page around never reloads.
  // A download, a link to a part of the same page or one opened elsewhere goes as the browser would take it.
  // Run after the page's handlers: Canvas action links may submit a form or cancel navigation themselves.
  const onCourseLink = (e) => {
    if (!on || !e.isTrusted || preview || e.defaultPrevented) return;
    const a = anchorOf(e);
    if (!a || a.closest('form, #gz-ctabs')
      || a.matches('[data-method], [data-remote], [data-confirm], [onclick], [role="button"]')
      || (!a.target && document.querySelector('base[target]'))) return;
    toFrame(e, a);
  };
  // The link pressed, inside a shadow root too (Glaze's bar), where the page's target is the root's host.
  const anchorOf = (e) => (e.composedPath?.() || []).find((n) => n instanceof Element && n.localName === 'a' && n.hasAttribute('href'))
    || (e.target instanceof Element && e.target.closest('a[href]'));
  const toFrame = (e, a) => {
    if (a.localName !== 'a' || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented || a.hasAttribute('download')
      || (a.target && a.target !== '_self') || a.origin !== location.origin) return false;
    const page = L.safe(a.pathname, a.search) || L.outside(a.pathname, a.search), url = page && page + a.hash;
    if (!url || /\/files\/\d+\/download/.test(a.pathname) || (a.hash && page === location.pathname + location.search)) return false;
    const cid = a.pathname.match(/^\/courses\/(\d+)/)?.[1] || '';
    // In a frame: its own pages (a course's, or the page frame's outside one) are turned to by the page around, which
    // keeps this one live; another course's or the page frame's go there; the same page again reloads, as it would.
    const mine = framed && (cid ? cid === framed : framed === PAGE);
    if (framed ? (!cid && !pageable(a.pathname)) || (mine && url === location.pathname + location.search)
      : !goes(cid, a.pathname) || (!showing && url === location.pathname + location.search)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (framed) toTop(mine ? 'go' : 'open', { url }); else (cid ? openAt(cid, url) : openPage(url));
    return true;
  };
  // A page outside a course that can take the page frame: not signing in or out, nor Canvas's own API.
  const pageable = (path) => !/^\/(?:login|logout|api)(?:[/?#]|$)/.test(path);
  // Validate the page and query separately from its anchor, preserving both through a frame handoff or history entry.
  const canvasURL = (path) => {
    if (typeof path !== 'string' || path.length >= 1300) return null;
    const i = path.indexOf('#'), page = i < 0 ? path : path.slice(0, i);
    const url = L.safe(...split(page)) || L.outside(...split(page));
    return url ? url + (i < 0 ? '' : path.slice(i)) : null;
  };
  // On the page itself, where a link goes: a course's page to that course's frame, a page outside a course to the page
  // frame. This page never reloads: it stays, live, under them (Back shows it again).
  const goes = (cid, path) => (cid ? true : pageable(path));
  // A press on a link to a page of a frame that runs: that page starts loading now, ahead of the click (turnTo).
  const onPress = (e) => {
    // Not a touch: it may only be the start of a scroll.
    if (!on || !e.isTrusted || preview || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.pointerType === 'touch') return;
    const a = anchorOf(e);
    if (a && !a.hasAttribute('download') && (!a.target || a.target === '_self') && (a.target || !document.querySelector('base[target]'))
      && !a.closest('form, #gz-ctabs') && !a.matches('[data-method], [data-remote], [data-confirm], [onclick], [role="button"]')) warm(a.href);
  };
  const warm = (href) => {
    let u; try { u = new URL(String(href), location.href); } catch { return; }
    if (u.origin !== location.origin || /\/files\/\d+\/download/.test(u.pathname) || !pageable(u.pathname) || acts(u.pathname)) return;
    const page = L.safe(u.pathname, u.search) || L.outside(u.pathname, u.search), url = page && page + u.hash, cid = u.pathname.match(/^\/courses\/(\d+)/)?.[1] || PAGE;
    // Not the page on screen, nor this page itself (shown as it is: openPage).
    if (!url || page === (framed ? location.pathname + location.search : pathOf(frames.get(cid)).split('#')[0]) || (!framed && page === location.pathname + location.search)) return;
    if (framed) { if (cid === framed) toTop('warm', { url }); }
    else if (frames.get(cid)?.ready) turnTo(cid, url, true);
  };
  // A course page in its course's frame: kept and sent there if it runs (unless it holds unsaved work, then shown as it is),
  // else made, with a tab if the course has none.
  const openAt = (cid, url) => {
    if (!tabs.some((x) => x.cid === cid)) { visitTab(cid); draw(); }
    const x = tabs.find((y) => y.cid === cid);
    if (!x) return;
    x.at = Date.now();
    let f = frames.get(cid);
    if (ctx.site === 'canvas' && f && !f.away && same(f.ready ? pathOf(f) : f.url, url)) {
      if (f.ready) turnTo(cid, url);
      save();
      return reveal(cid);
    }
    // Canvas, a frame that runs: turned to that page, this one kept (with any unsaved work in it).
    const turn = ctx.site === 'canvas' && !!f?.ready && !f.away;
    if (turn) {
      const r = turnTo(cid, url);
      if (r === false) return;
      // A frame not on screen shows once its new page is drawn: never first the page it had.
      if (awaitDrawn(cid, r)) { x.path = url; x.top = 0; save(); return; }
    }
    else if (f?.dirty) say(t('{name} has unsaved work, so it stays where it was.', { name: labelFor(cid, x.name || t('Course'), x.code) }));
    else if (f) { stamp(cid, url); if (!load(cid, f, url)) return; }
    else {
      hostIn();
      if (!room()) return;
      stamp(cid, url);
      f = open(cid, url);
    }
    if (turn || !f?.dirty) { x.path = url; x.top = 0; }
    if (ctx.site === 'canvas' && cid === closedCourse) closedCourse = '';
    save();
    reveal(cid);
  };
  // A page outside a course: this page itself when it is that one, else the page frame (made if new), as a tab's.
  const openPage = (url) => {
    if (url === location.pathname + location.search) { if (showing) stamp('', url); return reveal(''); }
    let f = frames.get(PAGE);
    if (ctx.site === 'canvas' && f && !f.away && same(f.ready ? pathOf(f) : f.url, url)) {
      if (f.ready) turnTo(PAGE, url);
      return reveal(PAGE);
    }
    if (ctx.site === 'canvas' && f?.ready && !f.away) { const r = turnTo(PAGE, url); if (r === false || awaitDrawn(PAGE, r)) return; }
    else if (f?.dirty) say(t('This page has unsaved work, so it stays where it was.'));
    else if (f) { stamp(PAGE, url); if (!load(PAGE, f, url)) return; }
    else {
      hostIn();
      stamp(PAGE, url);
      f = open(PAGE, url);
    }
    reveal(PAGE);
  };
  // A frame's page, loaded in place (the page before it gone), as the browser would.
  const load = (cid, f, url) => {
    try { f.stale = f.el.contentDocument; f.el.contentWindow.location.assign(location.origin + url); } catch { return false; }
    f.url = url;
    f.away = false;
    f.ready = false;
    f.retried = false;
    watch(cid, f);
    return true;
  };

  // ---- a frame's pages (Canvas) -----------------------------------------------------------------------------------
  // History: each page turned to by a link is an entry of this page's (its address unchanged, its state saying which frame
  // and page), so Back and Forward come back here (onPop) and turn the frames, this page never reloading.
  const onScreen = () => (showing ? { cid: showing, url: pathOf(frames.get(showing)) } : { cid: '', url: location.pathname + location.search });
  // Which entry is which, by the Navigation API's entry key: in Chrome this content script's world reads history.state
  // as it was when it last wrote it, not afresh. Where the API is missing, the entries' own state says.
  const turns = new Map(); // entry key → { cid, url }
  const entry = () => { try { return globalThis.navigation?.currentEntry?.key || ''; } catch { return ''; } };
  const turnHere = () => turns.get(entry()) || (!entry() && history.state?.gzTurn) || null;
  const stamp = (cid, url) => {
    if (popping || ctx.site !== 'canvas' || preview || framed) return;
    try {
      // The entry left is the page's own: its state stays as the page set it (a key to it is enough).
      const current = turnHere();
      const before = current || onScreen();
      if (before.cid === cid && before.url === url) return;
      if (!current) {
        if (entry()) turns.set(entry(), onScreen());
        else history.replaceState({ ...(history.state && typeof history.state === 'object' ? history.state : {}), gzTurn: onScreen() }, '');
      }
      history.pushState({ gzTurn: { cid, url } }, '');
      if (entry()) turns.set(entry(), { cid, url });
    } catch { /* not allowed here */ }
  };
  const restamp = (cid, url, key = entry()) => {
    if (key) turns.set(key, { cid, url });
    else try { history.replaceState({ ...history.state, gzTurn: { cid, url } }, ''); } catch { /* not allowed here */ }
  };
  const onPop = () => {
    const s = turnHere();
    if (!on || !s || typeof s.cid !== 'string' || typeof s.url !== 'string' || (s.cid && s.cid !== PAGE && !L.validId(s.cid, ctx.site))) return;
    const url = canvasURL(s.url);
    for (const [c, g] of [...next]) if (g.go) dropNext(c); // a page still on its way is no longer where the student goes
    popping = true;
    try {
      if (!s.cid) show('');
      else if (frames.get(s.cid)?.ready) {
        const g = url && url !== pathOf(frames.get(s.cid)) ? turnTo(s.cid, url) : null;
        if (g !== false && !awaitDrawn(s.cid, g)) reveal(s.cid);
      }
      else if (url) { if (s.cid === PAGE) openPage(url); else openAt(s.cid, url); }
    } finally { popping = false; }
  };
  // To a page of a frame: one of its earlier pages at that address (shown at once, then loaded afresh under it), else a
  // new page loading hidden (one being loaded from a press, ahead), shown once drawn. `warm`: from a press, only loading.
  const turnTo = (cid, url, warm = false, push = true) => {
    const f = frames.get(cid);
    if (!f || !host) return;
    const kept = (spare.get(cid) || []).find((s) => same(pathOf(s), url));
    let g = next.get(cid);
    if (warm) { if (kept || g?.go || (g?.url === url && !g.refresh)) return; }
    else if (same(pathOf(f), url)) { if (!g?.refresh) dropNext(cid); if (push && !popping) stamp(cid, url); return; }
    else if (kept) { dropNext(cid); swap(cid, kept, push && !popping); fresh(cid, kept); return; }
    if (!warm && !canKeep(cid)) return false;
    if (g && (g.url !== url || g.refresh)) { dropNext(cid); g = null; }
    g ||= pend(cid, url);
    clearTimeout(g.cool);
    // Pressed, never clicked (dragged off): let go of it.
    if (warm) { g.cool = setTimeout(() => { if (next.get(cid) === g && !g.go) dropNext(cid); }, 10000); return; }
    // Its entry now, on the click (a browser lets Back skip one made later, without the student's gesture).
    if (!g.go) {
      if (push && !popping) stamp(cid, url);
      g.key = entry();
      g.turn = turnHere();
    }
    g.go = true;
    turning();
    if (g.drawn) landed(cid, g);
    return g;
  };
  const awaitDrawn = (cid, g) => {
    if (showing === cid || !g?.go || next.get(cid) !== g) return false;
    g.reveal = ++showTurn; // a later selection, even of the page already on screen, cancels this reveal
    wait(cid);
    return true;
  };
  const turning = () => host?.toggleAttribute('data-turning', [...next.values()].some((g) => g.go));
  // Drawn: its content laid out, Glaze's look on it (content.js, at document start), any scroll it puts back done. A fresh
  // copy of a page on screen waits for it to finish loading, to come in unnoticed.
  const pend = (cid, url, extra = {}) => {
    const g = { el: frameEl(cid, url, frames.get(cid).el.title), at: Date.now(), ready: false, url, dirty: false, ...extra };
    guardFrame(cid, g);
    next.set(cid, g);
    host.prepend(g.el);
    const t0 = performance.now();
    const step = () => {
      if (next.get(cid) !== g) return;
      let d = null; try { d = g.el.contentDocument; } catch { /* another site */ }
      const late = performance.now() - t0;
      // A redirect outside this origin must never reload the page being kept (which may hold edits).
      if (!d) {
        if (!g.loaded && late < 8000) { g.tick = setTimeout(step, 30); return; }
        const go = g.go; dropNext(cid);
        if (go) { if (g.key ? entry() === g.key : turnHere() === g.turn) restamp(cid, pathOf(frames.get(cid))); say(t("That page can't open inside a course tab, so the course is back. Open its link with Ctrl or Cmd to see it in a new tab.")); }
        return;
      }
      if (pathOf(g) && d.readyState !== 'loading' && canvasContent(d) && !d.documentElement.matches('[data-gz-placing]')
        && !loading(d.body) && (!g.refresh || d.readyState === 'complete')) {
        g.drawn = true;
        if (g.go || g.refresh) landed(cid, g);
        return;
      }
      if (g.refresh && late > 15000) return dropNext(cid);
      // Slow: shown as it loads, as the browser would show it.
      if (g.go && late > 8000) { g.drawn = true; g.slow = true; return landed(cid, g); }
      g.tick = setTimeout(step, 30);
    };
    g.tick = setTimeout(step, 0);
    return g;
  };
  const landed = (cid, g) => {
    if (next.get(cid) !== g) return;
    next.delete(cid);
    clearTimeout(g.cool);
    clearTimeout(g.tick);
    g.clean?.();
    turning();
    const f = frames.get(cid), path = pathOf(g);
    if (!f) return g.el.remove();
    // Taken out of its frame's pages (a redirect to another course, or out of one): there, as a link to it goes.
    if (path && !(cid === PAGE ? !/^\/courses\/\d+/.test(path) : L.owns(split(path.split('#')[0])[0], cid))) {
      g.el.remove();
      if (!g.go) return;
      const u = canvasURL(path), c = u && u.match(/^\/courses\/(\d+)/)?.[1];
      // The redirect belongs to the entry made by the click, even if another course has since been picked.
      const current = g.key ? entry() === g.key : turnHere() === g.turn;
      if (u && pageable(split(u)[0])) {
        if (g.key || current) restamp(c || PAGE, u, g.key);
        if (current) {
          const was = popping; popping = true;
          try { if (c) openAt(c, u); else openPage(u); } finally { popping = was; }
        }
      } else if (current) restamp(cid, pathOf(f));
      return;
    }
    if (g.refresh) {
      const s = g.refresh;
      g.refresh = null; // (the copy replaced must not stay reachable from the one replacing it)
      if (f !== s || s.dirty || s.touched) return g.el.remove();
      try { const a = g.el.contentDocument.scrollingElement, b = s.el.contentDocument.scrollingElement; a.scrollTop = b.scrollTop; a.scrollLeft = b.scrollLeft; } catch { /* gone */ }
      return swap(cid, g, false, false);
    }
    // Its entry, made on the click, gets the address it ended at (a redirect).
    if (path && path !== g.url && (g.key || turnHere() === g.turn)) restamp(cid, path, g.key);
    swap(cid, g, false);
    if (g.reveal === showTurn && frames.get(cid) === g) reveal(cid);
  };
  // `g` takes its frame's place: the page before it kept (or gone, for a fresh copy of it), and on screen if its frame is.
  const swap = (cid, g, push, keepOld = true) => {
    const f = frames.get(cid);
    if (keepOld && !canKeep(cid, g)) { g.el.remove(); if (g.key ? entry() === g.key : turnHere() === g.turn) restamp(cid, pathOf(f)); return false; }
    const focused = !!f && document.activeElement === f.el;
    if (drawerFrom === f) drawerOff();
    wake(g);
    if (push) stamp(cid, pathOf(g));
    spare.set(cid, (spare.get(cid) || []).filter((s) => s !== g));
    g.ready = true;
    // Its account heard of later is no new document to wait for ('account').
    try { g.accountDoc = g.el.contentDocument; } catch { /* gone */ }
    g.at = Date.now();
    frames.set(cid, g);
    if (f && f !== g) {
      f.at = Date.now();
      if (keepOld) { spare.get(cid).push(f); rest(f); } else f.el.remove();
    }
    trim();
    const x = cid !== PAGE && tabs.find((y) => y.cid === cid), p = x && L.placeOf(...split(pathOf(g).split('#')[0]));
    if (p?.path && x.path !== p.path) { x.path = p.path; x.top = 0; save(); }
    g.el.style.visibility = showing === cid ? '' : 'hidden';
    g.el.inert = showing !== cid;
    if (f && f !== g) { f.el.style.visibility = 'hidden'; f.el.inert = true; f.el.contentWindow?.postMessage({ gzCtab: 'visible', on: false }, location.origin); }
    if (g.slow) { g.ready = false; watch(cid, g); }
    if (showing !== cid) return;
    g.el.contentWindow?.postMessage({ gzCtab: 'visible', on: g.ready }, location.origin);
    if (focused) g.el.focus();
    globalThis.GZ_PET_WORLD?.refresh();
    globalThis.GZ_NAVBAR_UI?.sync();
    keepPage();
    later(600);
  };
  // An earlier page shown again: loaded afresh under it (a submission, a module item viewed since), taking its place at
  // the same scroll unless the student has begun using it.
  const fresh = (cid, s) => {
    // Embedded editors don't bubble their input events to Canvas, so even a "clean" page may hold their unsaved work.
    if (s.dirty || acts(pathOf(s)) || s.el.contentDocument?.querySelectorAll('iframe').length) return;
    s.touched = false;
    try {
      const d = s.el.contentDocument, events = ['pointerdown', 'keydown', 'focusin', 'input', 'change', 'submit'], touch = () => { s.touched = true; };
      for (const ev of events) d.addEventListener(ev, touch, true);
      pend(cid, pathOf(s), { refresh: s, clean: () => { for (const ev of events) d.removeEventListener(ev, touch, true); } });
    } catch { /* gone */ }
  };
  // Pages that do something as they load (a quiz attempt, a tool launched, a submission): never loaded ahead or again
  // unasked.
  const acts = (path) => /\/(?:quizzes\/\d+\/take|external_tools|lti|sessionless_launch|submissions)(?:[/?#]|$)/.test(path);
  // A kept page is quiet as a page left behind: its media paused; embedded documents stay live, since a tool may hold
  // unsaved work we can't observe. After a moment it isn't drawn at all (no style, layout, paint or
  // animation frames, about half of what a hidden Canvas page costs while idle), its scroll noted to put back.
  const rest = (f) => {
    clearTimeout(f.resting);
    // Its media paused, in its own frames too (Canvas's media comments); another site's video or audio player stopped,
    // put back as it shows again. Other embeds (a tool, an editor) may hold work: they stay as they are.
    const quiet = (d, n) => {
      for (const m of d.querySelectorAll('video, audio')) if (!m.paused) m.pause();
      for (const e of d.querySelectorAll('iframe')) {
        let inner = null; try { inner = e.contentDocument; } catch { /* another site */ }
        if (inner) { if (n < 2) quiet(inner, n + 1); }
        else if (PLAYER.test(e.src) && !e.hasAttribute('data-gz-rest')) { e.setAttribute('data-gz-rest', e.src); e.src = 'about:blank'; }
      }
    };
    try { quiet(f.el.contentDocument, 0); } catch { /* gone */ }
    f.resting = setTimeout(() => {
      if (![...spare.values()].some((a) => a.includes(f))) return;
      try { const sc = f.el.contentDocument.scrollingElement; f.scroll = [sc.scrollTop, sc.scrollLeft]; } catch { /* gone */ }
      f.el.style.display = 'none';
    }, 3000);
  };
  const wake = (f) => {
    clearTimeout(f.resting);
    try {
      if (f.el.style.display === 'none') {
        f.el.style.display = '';
        const sc = f.el.contentDocument.scrollingElement;
        if (f.scroll) [sc.scrollTop, sc.scrollLeft] = f.scroll;
      }
      const back = (d, n) => {
        for (const e of d.querySelectorAll('iframe')) {
          if (e.hasAttribute('data-gz-rest')) { e.src = e.getAttribute('data-gz-rest'); e.removeAttribute('data-gz-rest'); continue; }
          let inner = null; try { inner = e.contentDocument; } catch { /* another site */ }
          if (inner && n < 2) back(inner, n + 1);
        }
      };
      back(f.el.contentDocument, 0);
    } catch { /* gone */ }
  };
  const PLAYER = /^https:\/\/([\w-]+\.)*(youtube(-nocookie)?\.com|vimeo\.com|kaltura\.com|instructuremedia\.com|panopto\.(com|eu)|vidgrid\.com|wistia\.(com|net)|loom\.com|echo360\.(org|net)|yuja\.com|brightcove\.net|mediasite\.com|dailymotion\.com|soundcloud\.com|spotify\.com)\//;
  // Dirty pages cannot be evicted to enforce the cache bounds. Keep the student on their current page when full.
  const canKeep = (cid, replacing) => {
    const f = frames.get(cid);
    if (!f?.dirty) return true;
    const own = (spare.get(cid) || []).filter((s) => s !== replacing && s.dirty).length;
    const all = [...spare.values()].flat().filter((s) => s !== replacing && s.dirty).length;
    if (own < KEEP && all < KEPT) return true;
    say(t('Close a course tab before opening another to keep your unsaved work.'));
    return false;
  };
  // Earlier pages past KEEP a frame or KEPT in all: the least recently shown go, never one with unsaved work.
  const trim = () => {
    let n = [...spare.values()].reduce((k, a) => k + a.length, 0);
    const old = [...spare].flatMap(([cid, a]) => a.map((f) => [cid, f])).filter(([, f]) => !f.dirty).sort((a, b) => a[1].at - b[1].at);
    for (const [cid, f] of old) {
      const a = spare.get(cid);
      if (n <= KEPT && a.length <= KEEP) continue;
      f.el.remove();
      spare.set(cid, a.filter((s) => s !== f));
      n--;
    }
  };
  // Canvas: a frame still loading with no picture of its page stays off screen and the page on screen stays put, its tab
  // marked as loading, until the frame is ready, as a browser keeps a page until the next one can be drawn. With a picture
  // it shows at once, under that picture, as on Ultra.
  let waiting = '', primed = '';
  const mark = () => { for (const e of list?.children || []) { set(e, 'data-loading', e.dataset.courseId === waiting ? '' : null); set(e, 'aria-busy', e.dataset.courseId === waiting ? 'true' : null); } };
  const wait = (cid) => {
    if (waiting === cid) return;
    waiting = cid;
    mark();
    if (showing) frames.get(showing)?.el.contentWindow?.postMessage({ gzCtab: 'loading', cid }, location.origin);
  };
  const reveal = (cid) => {
    if (ctx.site !== 'canvas') return show(cid);
    const turn = ++showTurn;
    wait(cid);
    if (cid && cid !== PAGE && !frames.has(cid) && on) {
      hostIn();
      if (!room()) { wait(''); return; }
      open(cid);
    }
    const f = cid && frames.get(cid);
    if (!f || f.ready || f.slow) return show(cid);
    // The picture decoded first, so the switch goes straight from this page to it, with no bare ground between.
    const go = (s) => {
      if (turn !== showTurn || waiting !== cid || frames.get(cid) !== f || !fits(s, f.url)) return;
      keep(s);
      const img = new Image();
      img.src = s.shot;
      img.decode().catch(() => {}).then(() => {
        if (turn !== showTurn || waiting !== cid || frames.get(cid) !== f || f.ready || f.slow || !fits(s, f.url)) return;
        primed = s.shot;
        show(cid);
      });
    };
    const s = snaps.get(cid);
    if (s) go(s); else if (cid !== PAGE) send({ op: 'get', cid }).then((r) => { if (r?.snap?.cid === cid) go(r.snap); });
  };
  const hostIn = () => { if (!host) { host = document.createElement('div'); host.id = 'gz-ctabs-frames'; document.body.append(host); } };
  // At most LIVE frames: the least recently shown one without unsaved work makes room.
  const room = () => {
    if (frames.size - frames.has(PAGE) < LIVE) return true;
    const old = [...frames].filter(([k, f]) => !f.dirty && !(spare.get(k) || []).some((s) => s.dirty) && !next.get(k)?.dirty
      && k !== PAGE && (ctx.site !== 'canvas' || k !== showing)).sort((a, b) => a[1].at - b[1].at)[0];
    if (!old) { say(t('Close a course tab before opening another to keep your unsaved work.')); return false; }
    drop(old[0], true);
    return true;
  };
  // A frame is shown once rendered course content has settled. A stalled initial about:blank can be retried once;
  // slow native pages keep loading, with their form state intact, rather than becoming falsely ready.
  const watch = (cid, f) => {
    if (ctx.site === 'canvas') f.unwatch?.();
    const turn = f.watch = {};
    let t0 = performance.now();
    let changed = t0, mo = null, doc = null, timer = 0;
    const scrolled = () => { changed = performance.now(); };
    const clean = () => {
      mo?.disconnect();
      if (ctx.site === 'canvas') { clearTimeout(timer); doc?.removeEventListener('scroll', scrolled, true); }
      mo = null; doc = null;
    };
    if (ctx.site === 'canvas') f.unwatch = clean;
    f.slow = false;
    const step = () => {
      if (frames.get(cid) !== f || f.watch !== turn) return clean();
      let d = null; try { d = f.el.contentDocument; } catch { /* gone */ }
      const now = performance.now();
      if (d && d !== doc && d.body && (ctx.site === 'canvas' ? d.location.origin === location.origin : d.location.pathname.startsWith('/ultra/'))) {
        clean();
        doc = d;
        changed = now;
        mo = new MutationObserver(() => { changed = performance.now(); });
        mo.observe(d.body, { subtree: true, childList: true });
        d.addEventListener('scroll', scrolled, { capture: true, passive: true });
      }
      const built = doc && (ctx.site !== 'canvas' || doc === d && doc !== f.stale) && (cid === PAGE ? !/^\/courses\/\d+/.test(doc.location.pathname) : L.owns(doc.location.pathname, cid)) && (ctx.site === 'canvas' ? canvasContent(doc) : [doc.querySelector('.bb-course-navigation'), doc.querySelector('.routed-page')].some(shown))
        && !loading(doc.body) && !doc.documentElement.matches('[data-gz-placing]');
      if (built && now - changed > 300) {
        clean();
        f.slow = false;
        f.ready = true;
        f.stale = null;
        if (waiting === cid && showing !== cid) { show(cid); return; }
        if (waiting === cid) wait('');
        if (showing === cid) { clearSlow(); f.el.style.visibility = ''; unpicture(); f.el.contentWindow?.postMessage({ gzCtab: 'visible', on: true }, location.origin); globalThis.GZ_PET_WORLD?.refresh(); globalThis.GZ_NAVBAR_UI?.sync(); later(600); }
        return;
      }
      if (now - t0 > 8000 && !f.slow) {
        if (d?.location.href === 'about:blank' && d.body && !d.body.childElementCount && !f.dirty && !f.retried) {
          f.retried = true;
          t0 = now;
          f.el.src = location.origin + f.url;
        } else {
          f.slow = true;
          if (waiting === cid && showing !== cid) show(cid);
          else if (showing === cid) { if (waiting === cid) wait(''); slowFrame(cid, f); }
        }
      }
      timer = setTimeout(step, f.slow ? 1000 : 50);
    };
    step();
  };
  const open = (cid, url) => {
    const x = tabs.find((y) => y.cid === cid);
    if (!x && !(cid === PAGE && url)) return null;
    url ||= L.target(x, P().place);
    const el = frameEl(cid, url, cid === PAGE ? t('Canvas') : x.name || t('Course'));
    const f = { el, at: Date.now(), ready: false, url, dirty: false };
    frames.set(cid, f);
    guardFrame(cid, f);
    host.prepend(el);
    watch(cid, f);
    return f;
  };
  const guardFrame = (cid, f) => {
    const el = f.el;
    // A frame taken to another site (a script, a form: links are caught in the frame) can't be read, nor shown as a course:
    // that page opens in a new tab, as far as the browser lets us say which, and the frame goes back to its course.
    el.addEventListener('load', () => {
      f.loaded = true;
      if (frames.get(cid) !== f) return;
      let away = false;
      try {
        if (cid === PAGE && el.contentWindow.location.href === 'about:blank') return;
        away = el.contentWindow.location.origin !== location.origin;
      } catch { away = true; }
      if (!away) return;
      const active = showing === cid || cid === PAGE && waiting === cid;
      const x = cid !== PAGE && tabs.find((y) => y.cid === cid);
      if (cid === PAGE) drop(cid); // its requested URL may itself redirect off-site: never reload that redirect in a loop
      else el.src = location.origin + (x ? L.target(x, false) : f.url);
      if (active) say(t("That page can't open inside a course tab, so the course is back. Open its link with Ctrl or Cmd to see it in a new tab."));
    });
  };
  const frameEl = (cid, url, title) => {
    const el = document.createElement('iframe');
    el.name = `gz-ctab:${cid}`;
    el.title = title;
    el.allow = 'fullscreen; clipboard-write; autoplay; camera; microphone; display-capture';
    el.src = location.origin + url; // absolute: Ultra's <base href> is its CDN
    el.style.visibility = 'hidden'; // until shown (show())
    el.inert = true;
    return el;
  };
  // The picture over a frame still loading (taken at this window size and menu width), else the frame as it loads.
  const picture = (cid, f) => {
    unpicture(true);
    const s = snaps.get(cid);
    const put = (snap) => {
      if (showing !== cid || frames.get(cid) !== f || f.ready || f.slow || pic || !fits(snap, f.url)) { if (showing === cid && !f.ready && !pic) f.el.style.visibility = ''; return; }
      const box = document.createElement('div');
      box.className = 'gz-ctabs-pic';
      const img = Object.assign(document.createElement('img'), { src: snap.shot, alt: '', draggable: false });
      // A Canvas frame sits inside the navigation's room; crop that same room from the full-window picture.
      const view = ctx.site === 'canvas' && html.hasAttribute('data-gz-navbar') ? host.getBoundingClientRect() : { x: 0, y: 0 };
      // Blurred, with a spinner over it: a picture of the page, not the page, until the page itself is ready.
      const root = box.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'), spinner = document.createElement('div');
      style.textContent = `img{position:absolute;top:${-view.y}px;left:${-view.x}px;width:${innerWidth}px;height:${innerHeight}px;filter:blur(6px) brightness(.9);user-select:none}
.s{position:absolute;top:50%;left:50%;width:2.25rem;height:2.25rem;margin:-1.125rem;box-sizing:border-box;border-radius:50%;border:3px solid color-mix(in srgb,var(--gz-ink,#fff) 25%,transparent);border-top-color:var(--gz-accent,#6fdcff);animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(1turn)}}:host([data-still]) .s{animation:none}`;
      spinner.className = 's'; spinner.setAttribute('role', 'progressbar'); spinner.setAttribute('aria-label', t('Loading…'));
      root.append(style, spinner);
      root.prepend(img);
      if (html.getAttribute('data-gz-motion') === 'off') box.toggleAttribute('data-still', true);
      for (const ev of ['wheel', 'pointerdown', 'touchstart']) box.addEventListener(ev, () => { f.el.style.visibility = ''; unpicture(); }, { passive: true });
      pic = box;
      // Decoded already (reveal): in at once, in the same frame as the switch.
      if (snap.shot === primed && host) host.append(box); else img.decode().catch(() => {}).then(() => { if (pic === box && host) host.append(box); });
    };
    if (s) put(s);
    else if (cid === PAGE) put(null);
    else send({ op: 'get', cid }).then((r) => { if (r?.snap?.cid === cid) { keep(r.snap); put(r.snap); } else put(null); });
  };
  const unpicture = (now = false) => {
    const p = pic;
    pic = null;
    if (!p) return;
    if (now || html.getAttribute('data-gz-motion') === 'off' || !p.isConnected) return p.remove();
    p.style.opacity = '0';
    setTimeout(() => p.remove(), 300);
  };
  const show = async (cid) => {
    const me = ++showTurn;
    if (ctx.site === 'canvas') wait(cid);
    if (cid === showing) { if (ctx.site === 'canvas') { wait(''); primed = ''; } return; }
    // A picture of what goes under, if one is being taken (the press on a tab starts one), finishes first: taken after the
    // switch, it would be of the wrong page.
    if (shooting) await Promise.race([shooting, new Promise((r) => setTimeout(r, 200))]);
    if (me !== showTurn || (cid && !on)) return;
    const back = !!showing && !cid && (document.activeElement?.localName === 'iframe' || strip?.contains(document.activeElement));
    if (cid) hostIn();
    if (cid && !frames.has(cid) && !room()) { if (ctx.site === 'canvas') wait(''); return; }
    const f = cid && (frames.get(cid) || open(cid));
    if (cid && !f) { if (ctx.site === 'canvas') wait(''); return; }
    if (ctx.site === 'canvas') wait('');
    drawerOff();
    showing = cid;
    shownFrom = location.pathname + location.search;
    for (const [k, g] of [...frames]) if (g.away && k !== cid) drop(k, true);
    for (const [k, g] of frames) {
      if (k === cid) g.at = Date.now();
      g.el.style.visibility = k === cid && g.ready ? '' : 'hidden';
      g.el.inert = k !== cid;
      g.el.contentWindow?.postMessage({ gzCtab: 'visible', on: k === cid && g.ready }, location.origin);
    }
    if (host) { host.toggleAttribute('data-on', !!cid); lay(); }
    clearSlow();
    unpicture(true);
    if (f && !f.ready) { if (f.slow) slowFrame(cid, f); else picture(cid, f); }
    primed = '';
    html.toggleAttribute('data-gz-ctab-framed', !!cid);
    ctx.scene();
    for (const n of ['GZ_SIDEBAR_UI', 'GZ_WIDGETS_UI']) globalThis[n]?.cover?.();
    globalThis.GZ_PET_WORLD?.refresh();
    try { if (cid) sessionStorage.setItem('gz-ctabs-shown', cid); else sessionStorage.removeItem('gz-ctabs-shown'); } catch { /* blocked */ }
    keepPage();
    // Keyboard focus goes with it: into the frame, or back to this page's strip.
    if (f) f.el.focus();
    else if (back) list?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
    draw();
    later();
  };
  // A tab: its frame, or this page when it is that course. From a frame, the pick goes to the page around it.
  const visit = (cid) => {
    const x = tabs.find((y) => y.cid === cid);
    if (!x) return;
    if (preview) { demo = cid; drawn = ''; return draw(); }
    if (framed) return toTop('visit', { cid });
    if (ctx.site === 'canvas' && cid === closedCourse) closedCourse = '';
    x.at = Date.now();
    save();
    const f = frames.get(cid);
    if (ctx.site === 'canvas' && f?.away) return openAt(cid, L.target(x, P().place));
    const g = ctx.site === 'canvas' && next.get(cid);
    if (g?.go) {
      stamp(cid, g.url);
      g.key = entry(); g.turn = turnHere();
      if (!awaitDrawn(cid, g)) reveal(cid);
      return;
    }
    if (cid === showing && f?.slow && !f.ready && !f.dirty && !(spare.get(cid) || []).some((s) => s.dirty) && !next.get(cid)?.dirty) { drop(cid, true); showing = ''; }
    const target = cid === ctx.courseId() && !(ctx.site === 'canvas' && frames.has(cid)) ? '' : cid;
    if (ctx.site === 'canvas') stamp(target, target ? pathOf(f) || L.target(x, P().place) : location.pathname + location.search);
    reveal(target);
  };
  if (!framed && !preview) addEventListener('message', (e) => {
    // Which frame: one on screen or hidden, an earlier page of one (spare), or the next one loading.
    const all = [...frames, ...[...spare].flatMap(([k, a]) => a.map((f) => [k, f])), ...next];
    const [from, src] = (e.origin === location.origin && typeof e.data?.gzCtab === 'string' && all.find(([, f]) => f.el.contentWindow === e.source)) || [];
    if (!from || !on) return;
    const { gzCtab: op, cid, url } = e.data;
    const id = L.validId(cid, ctx.site) ? cid : null;
    // A frame's earlier page, or its next one loading: hidden, so only what it holds and who is signed in there count.
    if (frames.get(from) !== src) {
      if (op === 'edited') src.dirty = true;
      // A hidden or replaced page's sidebar asks nothing.
      else if (op === 'sidebar') relay(from, src, e.data);
      else if (op === 'timer') relayTimer(from, src, e.data);
      else if (op === 'loaded') src.el.contentWindow.postMessage({ gzCtab: 'visible', on: false }, location.origin);
      else if (op === 'signout' && ctx.site === 'canvas') { send({ op: 'drop', signout: true }); revoke(); }
      else if (op === 'account' && L.validId(e.data.uid, ctx.site)) {
        if (who && e.data.uid !== who) { send({ op: 'drop', signout: true }); revoke(); }
        else { src.uid = e.data.uid; try { src.accountDoc = src.el.contentDocument; } catch { /* gone */ } }
      }
      return;
    }
    if (op === 'sidebar') { relay(from, src, e.data); return; }
    if (op === 'timer') { relayTimer(from, src, e.data); return; }
    if (op === 'drawer') { if (e.data.on === true && from === showing) drawerOn(src); else if (drawerFrom === src) drawerOff(); return; }
    if (ctx.site === 'canvas' && from !== showing && ['visit', 'shut', 'pin', 'move', 'go', 'warm', 'open', 'away'].includes(op)) return;
    if (op === 'visit' && id) visit(id);
    else if (op === 'shut' && id) shut(id, e.data.keys === true);
    else if (op === 'account' && L.validId(e.data.uid, ctx.site)) {
      if (who && e.data.uid !== who) { send({ op: 'drop', signout: true }); revoke(); }
      else {
        const f = frames.get(from); let doc = null; try { doc = f.el.contentDocument; } catch { /* gone */ }
        if (f.accountDoc !== doc && drawerFrom === f) drawerOff();
        if (f.accountDoc !== doc && f.ready) { f.ready = false; watch(from, f); }
        f.uid = e.data.uid; f.accountDoc = doc;
      }
      globalThis.GZ_PET_WORLD?.refresh();
    }
    else if (op === 'signout' && ctx.site === 'canvas') { send({ op: 'drop', signout: true }); revoke(); }
    else if (op === 'edited') frames.get(from).dirty = true;
    else if (op === 'pin' && id) pinTab(id);
    else if (op === 'move' && id && Number.isInteger(e.data.to)) moveTab(id, e.data.to);
    else if (op === 'place' && e.data.uid === who) {
      const x = tabs.find((x) => x.cid === from), kept = L.clean([{ cid: from, path: e.data.path, top: e.data.top }], ctx.site)[0];
      if (x && kept && (x.path !== kept.path || x.top !== kept.top)) { x.path = kept.path; x.top = kept.top; save(); }
    }
    else if (op === 'loaded') {
      const w = frames.get(from).el.contentWindow;
      w.postMessage({ gzCtab: 'visible', on: from === showing && frames.get(from).ready }, location.origin);
      if (ctx.site === 'canvas' && from === showing) w.postMessage({ gzCtab: 'loading', cid: waiting }, location.origin);
      globalThis.GZ_PET_WORLD?.refresh();
    }
    else if (op === 'moved' && from === showing) { globalThis.GZ_PET_WORLD?.refresh(); later(700); keepPage(); if (ctx.site === 'canvas' || from === PAGE) globalThis.GZ_NAVBAR_UI?.sync(); }
    // A link to a page of its own (go), or pressed (warm): turned to by this page (turnTo), the one it leaves kept.
    else if ((op === 'go' || op === 'warm') && ctx.site === 'canvas' && typeof url === 'string' && url.length < 1300) {
      const u = canvasURL(url), c = u && (u.match(/^\/courses\/(\d+)/)?.[1] || PAGE);
      if (c === from && pageable(split(u)[0])) { if (op === 'warm') turnTo(from, u, true); else if (from === showing) { if (from === PAGE) openPage(u); else openAt(from, u); } }
    }
    else if (op === 'open' && ctx.site === 'canvas' && from === showing && typeof url === 'string' && url.length < 1300) {
      const u = canvasURL(url), c = u && u.match(/^\/courses\/(\d+)/)?.[1];
      if (c && c !== from) openAt(c, u);
      else if (u && !c && from !== PAGE && pageable(split(u)[0])) openPage(u);
    }
    // A hidden page leaving its course waits until it is shown again (it then says so anew).
    else if (op === 'away' && from === showing && typeof url === 'string' && url.length < 1300 && /^\/(?!\/)/.test(url)) {
      // Canvas: another course's page goes to that course's frame, a page outside a course to the page frame; the frame
      // that left stays on screen until the next one shows.
      const u = ctx.site === 'canvas' && canvasURL(url), c = u && u.match(/^\/courses\/(\d+)/)?.[1];
      if (c && c !== from) { frames.get(from).away = true; openAt(c, u); }
      else if (u && !c && from !== PAGE && pageable(split(u)[0])) { frames.get(from).away = true; openPage(u); }
      else { drop(from); show(''); route(url); }
    }
  });
  // In a tab's frame on Ultra, a link out of its course opens in the page around it, never in the frame: an Ultra page
  // through the page's own router, another of this site's pages as a load there, another site in a new tab. (Canvas
  // routes its course links itself.) Links the page opens in a new tab or window keep doing that.
  if (framed && !preview && ctx.site !== 'canvas') document.addEventListener('click', (e) => {
    if (!on || !e.isTrusted || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.composedPath().find((n) => n instanceof HTMLAnchorElement && n.hasAttribute('href'));
    if (!a || a.target && a.target !== '_self' || a.hasAttribute('download')) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || u.href.split('#')[0] === location.href.split('#')[0]) return;
    const own = u.origin === location.origin;
    // Its own course's pages (and Ultra's redirects into them) stay in the frame.
    if (own && (u.pathname.startsWith(`/ultra/courses/${framed}/`) || u.pathname === `/ultra/courses/${framed}` || u.pathname === '/ultra/redirect' && (u.searchParams.get('course_id') || u.searchParams.get('courseId') || framed) === framed)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (own) toTop('away', { url: u.pathname + u.search + u.hash });
    else window.open(u.href, '_blank', 'noopener');
  }, true);
  if (framed && !preview) {
    // Track before load: slow native resources must not leave usable editors unprotected.
    // shortcut: native work without edit/submit events is unknown; use an LMS save-state API when available.
    for (const event of ['input', 'change', 'submit']) document.addEventListener(event, (e) => { if (on && e.isTrusted) toTop('edited'); }, true);
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.top) return;
      if (e.data?.gzCtab === 'visible' && typeof e.data.on === 'boolean') {
        told = e.data.on;
        html.toggleAttribute('data-gz-ctab-framed', !e.data.on); ctx.scene();
        for (const n of ['GZ_SIDEBAR_UI', 'GZ_WIDGETS_UI']) globalThis[n]?.cover?.();
        // A hidden page may have left its course while its navigation request was ignored.
        if (e.data.on) { awayFrom = ''; pass(); }
      }
      else if (e.data?.gzCtab === 'sidebar:ack' && Number.isSafeInteger(e.data.n)) acked(e.data);
      else if (e.data?.gzCtab === 'timer:ack' && Number.isSafeInteger(e.data.n)) acked(e.data, 'timer');
      else if (e.data?.gzCtab === 'note' && typeof e.data.text === 'string' && e.data.text.length <= 500) say(e.data.text);
      else if (e.data?.gzCtab === 'loading' && (e.data.cid === '' || L.validId(e.data.cid, ctx.site))) { waiting = e.data.cid; mark(); }
    });
    toTop('loaded');
  }
  // Ultra routes without reloading: the address goes in history, and the page hears it as Forward. Absolute: Ultra's
  // <base href> is its CDN, another origin.
  const route = (url) => {
    // Ultra's own router knows only its /ultra pages: anything else here (an older /webapps page, a tool) loads.
    if (ctx.site === 'canvas' || !/^\/ultra(\/|$)/.test(url)) { location.assign(location.origin + url); return; }
    try { history.pushState(null, '', location.origin + url); dispatchEvent(new PopStateEvent('popstate', { state: null })); } catch { location.assign(location.origin + url); }
  };
  const otherCourse = (bar, cid) => [...bar.querySelectorAll('a[href*="/courses/_"]')].some((a) => !a.getAttribute('href').includes(`/courses/${cid}/`));
  // In a tab's frame, its scroll put back once when the page first comes (an outline's is features/place.js's), until it
  // holds; anything the student does first ends it. The page around waits for it (data-gz-placing).
  const scrollerOf = (el, content = false) => {
    let n = 0;
    for (let p = content ? el : el?.parentElement; p && p !== document.body && n++ < 30; p = p.parentElement) if (/^(auto|scroll|overlay)$/.test(getComputedStyle(p).overflowY) && (content || p.scrollHeight > p.clientHeight)) return p;
    return document.scrollingElement;
  };
  const pageScroller = () => {
    const main = routedMain(routed());
    return main ? scrollerOf(main, true) : scrollerOf(strip);
  };
  let restored = false;
  const scrollBack = (top) => {
    if (/\/outline\/?$/.test(location.pathname) && ctx.settings().enhance.place) return;
    const t0 = Date.now();
    let steady = 0;
    html.setAttribute('data-gz-placing', '');
    const step = () => {
      const sc = pageScroller();
      if (!ctx.on() || !sc || ctx.acted() > t0 || Date.now() - t0 > 2500 || steady >= 3) return html.removeAttribute('data-gz-placing');
      if (Math.abs(sc.scrollTop - top) < 2) steady++;
      else { steady = 0; sc.scrollTop = top; }
      setTimeout(step, 100);
    };
    step();
  };

  // ---- closing, pinning, moving ---------------------------------------------------------------------------------
  const shut = (cid, keys) => {
    if (framed) return toTop('shut', { cid, keys: !!keys });
    const cur = showing || here() || (closedCourse && waiting);
    const r = L.close(tabs, cid);
    tabs = r.tabs;
    snaps.delete(cid);
    drop(cid);
    send({ op: 'forget', cid });
    save();
    if (cid === cur) {
      if (preview) demo = r.next;
      // Leave the closed course's route; an existing next frame keeps its native state.
      else if (cid === ctx.courseId()) {
        if (ctx.site === 'canvas') {
          closedCourse = cid;
          if (r.next) visit(r.next); else route('/courses');
        } else {
          const n = tabs.find((y) => y.cid === r.next);
          if (frames.has(r.next)) { route('/ultra/course'); visit(r.next); }
          else route(n ? L.target(n, P().place) : '/ultra/course');
        }
      }
      else if (r.next) visit(r.next);
      else if (ctx.site === 'canvas' && closedCourse) route('/courses');
    }
    draw();
    if (keys) list.querySelector(`[data-course-id="${r.next}"]`)?.focus();
    if (!tabs.length) flag();
  };
  const pinTab = (cid) => { if (framed) return toTop('pin', { cid }); tabs = L.pin(tabs, cid, !tabs.find((x) => x.cid === cid)?.pin); save(); draw(); };
  const moveTab = (cid, to) => { if (framed) return toTop('move', { cid, to }); tabs = L.move(tabs, cid, to); save(); draw(); };
  const tabOf = (e) => e.target instanceof Element && e.target.closest('.gz-ctab');
  let dragged = -Infinity;
  const onClick = (e) => {
    const el = tabOf(e);
    if (!el || (e.type === 'auxclick' && e.button !== 1) || (e.type === 'click' && e.button)) return;
    e.preventDefault();
    e.stopPropagation();
    if (performance.now() - dragged < 400) return;
    const cid = el.dataset.courseId;
    if (e.type === 'auxclick' || e.target.closest('.gz-ctab-x')) shut(cid);
    else if (e.target.closest('.gz-ctab-pin')) pinTab(cid);
    else visit(cid);
  };
  // A tablist: arrows and Home/End move the focus, Enter or Space opens, Delete (or Backspace) closes, P pins, Shift and
  // an arrow moves the tab. Nothing with Ctrl, Alt or Cmd: those are the browser's (Ctrl+Tab, Ctrl+W).
  const onKey = (e) => {
    const el = tabOf(e);
    if (!el || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = [...list.children];
    const i = all.indexOf(el);
    const cid = el.dataset.courseId;
    const fwd = getComputedStyle(list).direction === 'rtl' ? -1 : 1;
    let to = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const d = (e.key === 'ArrowRight' ? 1 : -1) * fwd;
      if (e.shiftKey) { moveTab(cid, i + d); list.querySelector(`[data-course-id="${cid}"]`)?.focus(); } else to = all[(i + d + all.length) % all.length];
    } else if (e.key === 'Home') to = all[0];
    else if (e.key === 'End') to = all.at(-1);
    else if (e.key === 'Enter' || e.key === ' ') visit(cid);
    else if (e.key === 'Delete' || e.key === 'Backspace') shut(cid, true);
    else if (e.key === 'p' || e.key === 'P') { pinTab(cid); list.querySelector(`[data-course-id="${cid}"]`)?.focus(); }
    else return;
    e.preventDefault();
    e.stopPropagation();
    if (to) { for (const o of all) o.tabIndex = o === to ? 0 : -1; to.focus(); }
  };
  // Dragging a tab: past 6 px it follows the pointer through its own group (pinned or not).
  let drag = null;
  const onDown = (e) => {
    const el = tabOf(e);
    if (el && !e.button && !e.target.closest('.gz-ctab-x, .gz-ctab-pin')) {
      drag = { el, cid: el.dataset.courseId, x: e.clientX, id: e.pointerId, on: false };
      // About to leave what is on screen for another course's: its picture, now, before anything changes.
      if (el.dataset.courseId !== (showing || ctx.courseId())) shoot();
    }
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.on) {
      if (Math.abs(e.clientX - drag.x) < 6) return;
      drag.on = true;
      try { drag.el.setPointerCapture(e.pointerId); } catch { /* gone */ }
    }
    const all = [...list.children];
    const i = all.indexOf(drag.el);
    let to = i;
    const rtl = all.length > 1 && all[0].getBoundingClientRect().left > all.at(-1).getBoundingClientRect().left;
    for (const [j, o] of all.entries()) {
      if (o === drag.el || o.hasAttribute('data-pin') !== drag.el.hasAttribute('data-pin')) continue;
      const r = o.getBoundingClientRect();
      if (j < i && (rtl ? e.clientX > r.left + r.width / 2 : e.clientX < r.left + r.width / 2)) { to = j; break; }
      if (j > i && (rtl ? e.clientX < r.left + r.width / 2 : e.clientX > r.left + r.width / 2)) to = j;
    }
    if (to !== i) moveTab(drag.cid, to);
    else draw();
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.on) dragged = performance.now();
    drag = null;
    draw();
  };

  // ---- the passes -----------------------------------------------------------------------------------------------
  const onStore = (c, area) => {
    if (area === 'sync' && c.tabs) readPrefs().then(pass);
    // Another of this browser's tabs changed the list: taken, with this page's own course as this page knows it.
    if (area === 'local' && who && c[key()] && !preview) {
      const got = L.clean(c[key()].newValue?.tabs, ctx.site);
      if (JSON.stringify(got) === JSON.stringify(tabs)) return;
      const mine = tabs.filter((x) => x.cid === ctx.courseId() || (ctx.site === 'canvas' && frames.has(x.cid)));
      tabs = got.map((x) => { const live = mine.find((y) => y.cid === x.cid); return live ? { ...x, path: live.path, top: live.top } : x; });
      for (const cid of [...frames.keys()]) if (cid !== PAGE && !tabs.some((x) => x.cid === cid)) drop(cid); // (the page frame has no tab)
      if (ctx.site === 'canvas' && closedCourse && !showing && !waiting && !tabs.length) { route('/courses'); return; }
      pass();
    }
  };
  // Where the page frame is, for a reload of this browser tab (start): its page now, which moves without this page.
  const keepPage = () => {
    let u = '';
    try { const d = showing === PAGE && frames.get(PAGE)?.el.contentDocument; u = d ? L.outside(d.location.pathname, d.location.search) : ''; } catch { /* gone */ }
    try { if (u) sessionStorage.setItem('gz-ctabs-page', u); } catch { /* blocked */ } // (gz-ctabs-shown says whether it shows)
  };
  // A frame's page going (another page of the frame, or the frame let go of): its watch on the page around ends with it, or
  // that page would keep this whole page alive. Restored from the back/forward cache, it watches again.
  const onHide = () => { if (on) { saveNow(); keepPage(); } navWatch?.disconnect(); navWatch = null; };
  const onShow = (e) => { if (e.persisted && on && framed) { listen(false); listen(true); } };
  const onResize = () => {
    lay();
    navRoom();
    if (ctx.site === 'canvas') {
      // A picture made at the old viewport no longer fits; keep the live frame through the resize.
      if (pic) { const f = frames.get(showing); if (f) f.el.style.visibility = ''; unpicture(true); }
      place();
    }
  };
  let navWatch = null;
  // In a Canvas tab's frame: the room Glaze's bar takes on the page around (its words there, and the window's width),
  // which this frame, filling the window under the bar, keeps too (canvas.css).
  const navRoom = () => {
    if (!framed || ctx.site !== 'canvas') return;
    let s = null; try { s = parent.getComputedStyle(parent.document.documentElement); } catch { return; }
    for (const k of ['--gz-navbar-left', '--gz-navbar-top']) {
      const v = s.getPropertyValue(k).trim();
      if (html.style.getPropertyValue(k) !== v) { if (v) html.style.setProperty(k, v); else html.style.removeProperty(k); }
    }
  };
  const listen = (yes) => {
    const f = yes ? 'addEventListener' : 'removeEventListener';
    document[f]('scroll', onScroll, { capture: true, passive: true });
    document[f]('click', onLeave, true);
    document[f]('pointerdown', onLeave, true);
    if (ctx.site === 'canvas') { globalThis[f]('click', onCourseLink); document[f]('pointerdown', onPress, true); if (!framed && !preview) globalThis[f]('popstate', onPop); }
    globalThis[f]('pagehide', onHide);
    globalThis[f]('pageshow', onShow);
    globalThis[f]('resize', onResize);
    // A parent bar can change without any mutation in this course's document.
    navWatch?.disconnect(); navWatch = null;
    if (yes && framed) try {
      navWatch = new MutationObserver(() => { bar.place(); navRoom(); });
      navWatch.observe(parent.document.documentElement, { attributes: true, attributeFilter: ['data-gz-navbar', 'style'] });
      navRoom();
    } catch { /* inaccessible parent: the strip stays above */ }
    try { if (chrome.runtime?.id) chrome.storage.onChanged[yes ? 'addListener' : 'removeListener'](onStore); } catch { /* reloaded */ }
  };
  const start = () => {
    const turn = showTurn;
    readPrefs().then(() => { drawn = ''; pass(); });
    if (preview) { tabs = L.order(DEMO.map((x) => ({ ...x }))); loaded = true; return; }
    // A reload while a tab's frame was on screen: that tab again.
    const was = (() => { try { return framed ? '' : sessionStorage.getItem('gz-ctabs-shown'); } catch { return ''; } })();
    const wasPage = (() => { try { return was === PAGE && ctx.site === 'canvas' ? L.outside(...split(sessionStorage.getItem('gz-ctabs-page') || '')) : null; } catch { return null; } })();
    ctx.me().then((uid) => {
      if (!on) return;
      if (!L.validId(uid, ctx.site)) { loaded = true; pass(); return; }
      who = uid;
      if (framed) toTop('account', { uid });
      hello().then(() => {
        if (!on || signedOut || who !== uid) return;
        local((s) => s.get(key(), (r) => {
          if (!on || signedOut || who !== uid) return;
          const kept = L.clean(r?.[key()]?.tabs, ctx.site);
          tabs = [...kept, ...tabs.filter((x) => !kept.some((y) => y.cid === x.cid))];
          loaded = true;
          last = undefined;
          pass();
          if (showTurn !== turn) return; // a selection made while storage loaded takes precedence over the restore
          if (was && (ctx.site === 'canvas' || was !== ctx.courseId()) && tabs.some((x) => x.cid === was)) reveal(was);
          else if (wasPage) openPage(wasPage);
        }));
      });
    }, () => { loaded = true; pass(); }); // no account: this page's list only, kept nowhere
  };
  let awayFrom = '';
  const pass = () => {
    if (!on) return;
    observeView();
    const cid = here();
    // In a tab's frame, its page leaving its course (another course, a page outside one): the page around goes there.
    if (framed && !preview && (framed === PAGE ? !!cid : cid !== framed)) {
      const url = location.pathname + location.search + (ctx.site === 'canvas' ? location.hash || '' : '');
      if (awayFrom !== url) { awayFrom = url; toTop('away', { url }); }
      return;
    }
    // This page going somewhere itself while a frame covers it (its menu, Back): it is what shows now. Ultra keeps one
    // copy of a course, this page's; Canvas keeps the frame's earlier pages too, including work left in them.
    if (showing && location.pathname + location.search !== shownFrom) show('');
    if (ctx.site !== 'canvas' && !framed && cid && !showing && frames.has(cid) && waiting !== cid) drop(cid);
    if (cid && !preview && loaded && !showing) {
      if (cid !== last || !tabs.some((x) => x.cid === cid)) visitTab(cid);
      notePlace(cid);
      if (framed && !restored) {
        restored = true;
        const x = tabs.find((y) => y.cid === cid);
        if (P().place && x?.top && x.path === location.pathname + location.search) scrollBack(x.top);
      }
    }
    if (cid !== last || lastPath !== location.pathname + location.search) { last = cid; if (framed) moved(); }
    lastPath = location.pathname + location.search;
    flag();
    place();
    draw();
    lay();
    if (cid && !preview && !showing) later();
  };
  const sync = (want) => {
    if (signedOut) want = false;
    if (!want) {
      html.removeAttribute('data-gz-ctabs');
      keepClear(null);
      measureRow(null);
      if (!on) return;
      on = false;
      listen(false);
      clearTimeout(capTimer);
      capTimer = 0;
      clearTimeout(sayTimer);
      saveNow();
      strip?.remove();
      sizes?.disconnect(); sized = []; lastBar = undefined;
      // Every tab's frame stops; this page shows again.
      for (const k of [...frames.keys()]) drop(k);
      unpicture(true);
      clearSlow();
      showing = '';
      waiting = '';
      primed = '';
      host?.remove();
      host = null;
      html.removeAttribute('data-gz-ctab-framed');
      ctx.scene();
      try { sessionStorage.removeItem('gz-ctabs-shown'); } catch { /* blocked */ }
      // Switched off (Glaze or the tabs): nothing of the courses is kept in memory any more.
      snaps.clear();
      send({ op: 'drop' });
      try { sessionStorage.removeItem('gz-ctabs'); } catch { /* blocked */ }
      return;
    }
    if (!on) {
      on = true;
      // Its sheet comes in with content.js's (SHEETS). A page whose content script predates the sheet (an unpacked
      // extension changed on disk but not reloaded) would show the frames unstyled, in the page's flow: link it here.
      if (!preview && !document.querySelector('link[href$="/features/coursetabs.css"]')) (document.head || html).append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: chrome.runtime.getURL('features/coursetabs.css') }));
      if (!strip) make();
      listen(true);
      if (!prefs && !loaded) start();
      else { hello().then(() => { if (!on || signedOut) return; drawn = ''; local((s) => s.get(key(), (r) => { if (who) tabs = L.clean(r?.[key()]?.tabs, ctx.site); pass(); })); }); }
    }
    pass();
  };
  const revoke = () => {
    saveNow();
    who = null;
    signedOut = true;
    sync(false);
    tabs = [];
    loaded = false;
    globalThis.GZ_PET_WORLD?.stop();
  };
  const invalidate = (next) => {
    if (next <= epoch) return;
    epoch = next;
    snaps.clear();
    primed = '';
    unpicture(true);
  };
  const hello = async () => {
    const r = await send({ op: 'hello' });
    if (r?.stale) return revoke();
    if (r?.ok && Number.isSafeInteger(r.epoch)) invalidate(r.epoch);
  };
  // One listener for this document, including while the feature is off; never added by a route or toggle.
  if (!preview) chrome.runtime.onMessage.addListener((m, s, reply) => {
    if (m?.type !== 'glaze:tabs-state' || s.id !== chrome.runtime.id || s.tab || m.site !== location.origin || !Number.isSafeInteger(m.epoch) || m.epoch <= 0) return;
    if (who && m.uid !== who) revoke();
    else invalidate(m.epoch);
    reply({ ok: true });
  });
  // The editor's preview has this file as a <script> after content.js, so its first ask may come before the file is in:
  // here it follows the editor's edits itself.
  if (preview) {
    const follow = () => setTimeout(() => sync(ctx.on() && !!ctx.settings().enhance.tabs && (ctx.tabsPreview?.() ?? true)));
    addEventListener('message', (e) => { if (e.data?.gzPreview) follow(); });
    follow();
  }
  // For Glaze's own navigation bar, which can hold the tabs (hosted): the rows it draws and what its tabs do.
  const bar = {
    rows: () => (on && !framed && !signedOut ? rowsOf() : []),
    visit: (cid) => { if (on && tabs.some((x) => x.cid === cid)) visit(cid); },
    shut: (cid) => { if (on && tabs.some((x) => x.cid === cid)) shut(cid); },
    pin: (cid) => { if (on && tabs.some((x) => x.cid === cid)) pinTab(cid); },
    move: (cid, to) => { if (on && tabs.some((x) => x.cid === cid) && Number.isInteger(to)) moveTab(cid, to); },
    // A press on one of the bar's links: its page starts loading (Canvas, in a frame that runs), ahead of the click.
    warm: (href) => { if (on && ctx.site === 'canvas') warm(href); },
    // Back to the page under the tabs (a frame was showing), as picking the page's own item would.
    leave: () => { if (on && showing) show(''); },
    // The bar began or stopped holding the tabs: the strip and its first-paint word follow.
    place: () => { if (on) flag(); place(); },
    // The document of the course tab's frame on screen (for its course menu), or null when this page is what shows.
    doc: () => {
      const f = on && !framed && showing && frames.get(showing);
      try { const d = f?.el.contentDocument; return d?.location.origin === location.origin ? d : null; } catch { return null; }
    },
    // An address of this site: in a course's frame when a frame is on screen and it is a course page (on Canvas any
    // course's, through its own frame; on Ultra the shown course's), else on this page, as a click on it here would go.
    open: (href) => {
      let u; try { u = new URL(String(href), location.origin); } catch { return false; }
      if (!on || u.origin !== location.origin) return false;
      const page = L.safe(u.pathname, u.search) || (ctx.site === 'canvas' ? L.outside(u.pathname, u.search) : null), url = page && page + (ctx.site === 'canvas' ? u.hash : ''), cid = url && (ctx.site === 'canvas' ? u.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1] : showing);
      if (framed) {
        const mine = cid ? cid === framed : framed === PAGE;
        if (ctx.site !== 'canvas' || !url || /\/files\/\d+\/download/.test(u.pathname)
          || (!cid && !pageable(u.pathname)) || (mine && page === location.pathname + location.search)) return false;
        toTop(mine ? 'go' : 'open', { url });
        return true;
      }
      if (ctx.site === 'canvas' && url && !/\/files\/\d+\/download/.test(u.pathname) && goes(cid || '', u.pathname)) {
        if (u.hash) {
          if (showing && page === pathOf(frames.get(showing)).split('#')[0]) {
            try { frames.get(showing).el.contentWindow.location.hash = u.hash; return true; } catch { return false; }
          }
          if (!showing && page === location.pathname + location.search) return false;
        }
        if (cid) openAt(cid, url); else openPage(url);
        return true;
      }
      if (ctx.site !== 'canvas' && showing && cid && L.owns(u.pathname, cid)) {
        try { frames.get(showing).el.contentWindow.location.assign(location.origin + url); } catch { return false; }
        return true;
      }
      if (showing) show('');
      route(u.pathname + u.search + u.hash);
      return true;
    },
  };
  return { sync, held, petSurface, bar, visible, sidebar: askSidebar, timer: askTimer, drawer, showing: () => showing, frames: () => frames.size, revoked: () => signedOut, snapshots: () => snaps.size };
})();

GZ_CTABS;
