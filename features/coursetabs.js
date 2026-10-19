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
    const a = P().at;
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
  // Glaze's own navigation bar can hold the tabs instead of the strip (features/navbar.js, data-gz-navbar's word `tabs`).
  const hosted = () => !framed && !preview && (html.getAttribute('data-gz-navbar') || '').split(' ').includes('tabs');
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
    const v = `${P().at} ${P().size}${loaded && tabs.length ? ' page' : ''}`;
    try { if (sessionStorage.getItem('gz-ctabs') !== v) sessionStorage.setItem('gz-ctabs', v); } catch { /* blocked */ }
    if (html.getAttribute('data-gz-ctabs') !== v) html.setAttribute('data-gz-ctabs', v);
  };

  // ---- the strip ------------------------------------------------------------------------------------------------
  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  const ICON = { book: svg('M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h9'), pin: svg('M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6'), x: svg('M7 7l10 10M17 7 7 17') };
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
    e.innerHTML = `<span class="gz-ctab-mark" aria-hidden="true"></span><span class="gz-ctab-name"></span><span class="gz-ctab-pin" aria-hidden="true">${ICON.pin}</span><span class="gz-ctab-x" aria-hidden="true">${ICON.x}</span>`;
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
      if (p.mark === 'icon' && !mark.firstChild) mark.innerHTML = ICON.book;
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
    const r = L.open(tabs, { cid, at: Date.now(), ...(name && { name: name.slice(0, 200) }), ...(c?.code && { code: c.code }) }, framed ? L.MAX : P().cap, (id) => frames.get(id)?.dirty);
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
      if (!f?.ready || !f.el.isConnected || f.el.parentElement !== host || f.el.inert || f.el.style.visibility === 'hidden' || !doc?.body || f.uid !== who || f.accountDoc !== doc || doc.location.origin !== location.origin || !L.owns(path?.split('?')[0] || '', showing)) return null;
      return { doc, frame: f.el };
    } catch { return null; }
  };
  let shooting = null, shotAt = -1e9;
  const shoot = () => {
    if (shooting) return shooting;
    const { cid, path, doc, frame } = surface();
    if (!on || signedOut || framed || preview || !cid || !path || !doc || ctx.holding() || document.visibilityState !== 'visible' || performance.now() - shotAt < 600) return Promise.resolve(null);
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
  const frames = new Map(); // cid → { el, at (last shown), ready, dirty }
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
    if (!f.dirty) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('Retry');
      retry.addEventListener('click', () => { if (frames.get(cid) === f && !f.dirty) visit(cid); });
      box.append(retry);
    }
    const back = document.createElement('button'); back.type = 'button'; back.textContent = t('Go back');
    back.addEventListener('click', () => ctx.site === 'canvas' && closedCourse ? route('/courses') : show(''));
    box.append(back); host.append(box); retryNote = box;
  };
  const toTop = (op, m = {}) => { try { window.top.postMessage({ gzCtab: op, ...m }, location.origin); } catch { /* gone */ } };
  let movedTimer = 0;
  const moved = () => { clearTimeout(movedTimer); movedTimer = setTimeout(() => toTop('moved'), 500); };
  const lay = () => {
    if (!host) return;
    const foot = document.getElementById('gz-footer');
    host.style.bottom = `${shown(foot) ? Math.max(0, Math.round(innerHeight - foot.getBoundingClientRect().top)) : 0}px`;
  };
  const drop = (cid, replacing = false) => {
    const f = frames.get(cid);
    if (!f) return;
    f.el.remove();
    frames.delete(cid);
    if (waiting === cid) wait('');
    if (showing === cid && !replacing) show('');
  };
  // Canvas loads a whole page for each link, which here would end every tab's frame; Ultra routes in place, so its frames
  // live on. With a frame running, a plain click on a link to a course page opens it in that course's frame instead (made
  // if new), and in a tab's frame a link to another course goes to that course's frame: the page around never reloads.
  // A download, a link to a part of the same page or one opened elsewhere goes as the browser would take it.
  // Run after the page's handlers: Canvas action links may submit a form or cancel navigation themselves.
  const onCourseLink = (e) => {
    if (!on || !e.isTrusted || preview || e.defaultPrevented) return;
    const a = e.target instanceof Element && e.target.closest('a[href]');
    if (!a || a.closest('form, [id^="gz-"], [class^="gz-"], [class*=" gz-"]')
      || a.matches('[data-method], [data-remote], [data-confirm], [onclick], [role="button"]')
      || (!a.target && document.querySelector('base[target]'))) return;
    toFrame(e, a);
  };
  const toFrame = (e, a) => {
    if (a.localName !== 'a' || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.defaultPrevented || a.hasAttribute('download')
      || (a.target && a.target !== '_self') || a.origin !== location.origin || a.hash) return false;
    const url = L.safe(a.pathname, a.search), cid = url && a.pathname.match(/^\/courses\/(\d+)/)?.[1];
    if (!cid || /\/files\/\d+\/download/.test(a.pathname) || (framed ? cid === framed : !frames.size)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (framed) toTop('open', { url }); else openAt(cid, url);
    return true;
  };
  // A course page in its course's frame: kept and sent there if it runs (unless it holds unsaved work, then shown as it is),
  // else made, with a tab if the course has none.
  const openAt = (cid, url) => {
    if (ctx.site === 'canvas' && cid === closedCourse) closedCourse = '';
    if (!tabs.some((x) => x.cid === cid)) { visitTab(cid); draw(); }
    const x = tabs.find((y) => y.cid === cid);
    if (!x) return;
    x.at = Date.now(); x.path = url; x.top = 0;
    save();
    let f = frames.get(cid);
    if (f?.dirty) say(t('{name} has unsaved work, so it stays where it was.', { name: labelFor(cid, x.name || t('Course'), x.code) }));
    else if (f) {
      try { f.stale = f.el.contentDocument; f.el.contentWindow.location.assign(location.origin + url); } catch { return; }
      f.url = url;
      if (f.ready) { f.ready = false; watch(cid, f); }
    } else {
      hostIn();
      if (!room()) return;
      f = open(cid, url);
    }
    reveal(cid);
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
    if (ctx.site === 'canvas' && cid && !frames.has(cid) && on) {
      hostIn();
      if (!room()) return;
      open(cid);
    }
    const f = cid && frames.get(cid);
    if (ctx.site !== 'canvas' || !f || f.ready || f.slow) { wait(''); return show(cid); }
    wait(cid);
    // The picture decoded first, so the switch goes straight from this page to it, with no bare ground between.
    const go = (s) => {
      if (waiting !== cid || frames.get(cid) !== f || !fits(s, f.url)) return;
      keep(s);
      const img = new Image();
      img.src = s.shot;
      img.decode().catch(() => {}).then(() => { primed = s.shot; if (waiting === cid && frames.get(cid) === f && !f.ready) { wait(''); show(cid); } });
    };
    const s = snaps.get(cid);
    if (s) go(s); else send({ op: 'get', cid }).then((r) => { if (r?.snap?.cid === cid) go(r.snap); });
  };
  const hostIn = () => { if (!host) { host = document.createElement('div'); host.id = 'gz-ctabs-frames'; document.body.append(host); } };
  // At most LIVE frames: the least recently shown one without unsaved work makes room.
  const room = () => {
    if (frames.size < LIVE) return true;
    const old = [...frames].filter(([k, f]) => !f.dirty && (ctx.site !== 'canvas' || k !== showing)).sort((a, b) => a[1].at - b[1].at)[0];
    if (!old) { say(t('Close a course tab before opening another to keep your unsaved work.')); return false; }
    drop(old[0], true);
    return true;
  };
  // A frame is shown once rendered course content has settled. A stalled initial about:blank can be retried once;
  // slow native pages keep loading, with their form state intact, rather than becoming falsely ready.
  const watch = (cid, f) => {
    let t0 = performance.now();
    let changed = t0, mo = null, doc = null;
    f.slow = false;
    const step = () => {
      if (frames.get(cid) !== f) return mo?.disconnect();
      let d = null; try { d = f.el.contentDocument; } catch { /* gone */ }
      const now = performance.now();
      if (d && d !== doc && d.body && (ctx.site === 'canvas' ? d.location.origin === location.origin : d.location.pathname.startsWith('/ultra/'))) {
        mo?.disconnect();
        doc = d;
        changed = now;
        mo = new MutationObserver(() => { changed = performance.now(); });
        mo.observe(d.body, { subtree: true, childList: true });
        d.addEventListener('scroll', () => { changed = performance.now(); }, { capture: true, passive: true });
      }
      const built = doc && doc !== f.stale && L.owns(doc.location.pathname, cid) && (ctx.site === 'canvas' ? shown(doc.querySelector('#content, #main')) : [doc.querySelector('.bb-course-navigation'), doc.querySelector('.routed-page')].some(shown))
        && !loading(doc.body) && !doc.documentElement.matches('[data-gz-placing]');
      if (built && now - changed > 300) {
        mo?.disconnect();
        f.slow = false;
        f.ready = true;
        f.stale = null;
        if (waiting === cid) { wait(''); show(cid); return; }
        if (showing === cid) { clearSlow(); f.el.style.visibility = ''; unpicture(); globalThis.GZ_PET_WORLD?.refresh(); later(600); }
        return;
      }
      if (now - t0 > 8000 && !f.slow) {
        if (d?.location.href === 'about:blank' && d.body && !d.body.childElementCount && !f.dirty && !f.retried) {
          f.retried = true;
          t0 = now;
          f.el.src = location.origin + f.url;
        } else {
          f.slow = true;
          if (waiting === cid) { wait(''); show(cid); } else if (showing === cid) slowFrame(cid, f);
        }
      }
      setTimeout(step, f.slow ? 1000 : 50);
    };
    step();
  };
  const open = (cid, url) => {
    const x = tabs.find((y) => y.cid === cid);
    if (!x) return null;
    url ||= L.target(x, P().place);
    const el = document.createElement('iframe');
    el.name = `gz-ctab:${cid}`;
    el.title = x.name || t('Course');
    el.allow = 'fullscreen; clipboard-write; autoplay; camera; microphone; display-capture';
    el.src = location.origin + url; // absolute: Ultra's <base href> is its CDN
    el.style.visibility = 'hidden'; // until shown (show())
    el.inert = true;
    const f = { el, at: Date.now(), ready: false, url, dirty: false };
    frames.set(cid, f);
    host.prepend(el);
    watch(cid, f);
    return f;
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
      // Blurred, with a spinner over it: a picture of the page, not the page, until the page itself is ready.
      const root = box.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>img{position:absolute;top:0;left:0;width:${innerWidth}px;height:${innerHeight}px;filter:blur(6px) brightness(.9);user-select:none}
.s{position:absolute;top:50%;left:50%;width:2.25rem;height:2.25rem;margin:-1.125rem;box-sizing:border-box;border-radius:50%;border:3px solid color-mix(in srgb,var(--gz-ink,#fff) 25%,transparent);border-top-color:var(--gz-accent,#6fdcff);animation:r .8s linear infinite}
@keyframes r{to{transform:rotate(1turn)}}:host([data-still]) .s{animation:none}</style><div class="s" role="progressbar"></div>`;
      root.querySelector('.s').setAttribute('aria-label', t('Loading…'));
      root.prepend(img);
      if (html.getAttribute('data-gz-motion') === 'off') box.toggleAttribute('data-still', true);
      for (const ev of ['wheel', 'pointerdown', 'touchstart']) box.addEventListener(ev, () => { f.el.style.visibility = ''; unpicture(); }, { passive: true });
      pic = box;
      // Decoded already (reveal): in at once, in the same frame as the switch.
      if (snap.shot === primed && host) host.append(box); else img.decode().catch(() => {}).then(() => { if (pic === box && host) host.append(box); });
    };
    if (s) put(s);
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
    if (cid === showing) return;
    // A picture of what goes under, if one is being taken (the press on a tab starts one), finishes first: taken after the
    // switch, it would be of the wrong page.
    if (shooting) await Promise.race([shooting, new Promise((r) => setTimeout(r, 200))]);
    if (me !== showTurn || (cid && !on)) return;
    const back = !!showing && !cid && (document.activeElement?.localName === 'iframe' || strip?.contains(document.activeElement));
    if (cid) hostIn();
    if (cid && !frames.has(cid) && !room()) return;
    const f = cid && (frames.get(cid) || open(cid));
    if (cid && !f) return;
    showing = cid;
    shownFrom = location.pathname + location.search;
    for (const [k, g] of [...frames]) if (g.away && k !== cid) drop(k, true);
    for (const [k, g] of frames) {
      if (k === cid) g.at = Date.now();
      g.el.style.visibility = k === cid && g.ready ? '' : 'hidden';
      g.el.inert = k !== cid;
      g.el.contentWindow?.postMessage({ gzCtab: 'visible', on: k === cid }, location.origin);
    }
    if (host) { host.toggleAttribute('data-on', !!cid); lay(); }
    clearSlow();
    unpicture(true);
    if (f && !f.ready) { if (f.slow) slowFrame(cid, f); else picture(cid, f); }
    html.toggleAttribute('data-gz-ctab-framed', !!cid);
    ctx.scene();
    globalThis.GZ_PET_WORLD?.refresh();
    try { if (cid) sessionStorage.setItem('gz-ctabs-shown', cid); else sessionStorage.removeItem('gz-ctabs-shown'); } catch { /* blocked */ }
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
    if (cid === showing && f?.slow && !f.ready && !f.dirty) { drop(cid, true); showing = ''; }
    reveal(cid === ctx.courseId() && !(ctx.site === 'canvas' && frames.has(cid)) ? '' : cid);
  };
  if (!framed && !preview) addEventListener('message', (e) => {
    const from = e.origin === location.origin && typeof e.data?.gzCtab === 'string' && [...frames].find(([, f]) => f.el.contentWindow === e.source)?.[0];
    if (!from || !on) return;
    const { gzCtab: op, cid, url } = e.data;
    const id = L.validId(cid, ctx.site) ? cid : null;
    if (op === 'visit' && id) visit(id);
    else if (op === 'shut' && id) shut(id, e.data.keys === true);
    else if (op === 'account' && L.validId(e.data.uid, ctx.site)) {
      if (who && e.data.uid !== who) { send({ op: 'drop', signout: true }); revoke(); }
      else {
        const f = frames.get(from); let doc = null; try { doc = f.el.contentDocument; } catch { /* gone */ }
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
    else if (op === 'loaded') { frames.get(from).el.contentWindow.postMessage({ gzCtab: 'visible', on: from === showing }, location.origin); globalThis.GZ_PET_WORLD?.refresh(); }
    else if (op === 'moved' && from === showing) { globalThis.GZ_PET_WORLD?.refresh(); later(700); }
    else if (op === 'open' && ctx.site === 'canvas' && from === showing && typeof url === 'string' && url.length < 1300) {
      const u = L.safe(...split(url)), c = u && u.match(/^\/courses\/(\d+)/)?.[1];
      if (c && c !== from) openAt(c, u);
    }
    // A hidden page leaving its course waits until it is shown again (it then says so anew).
    else if (op === 'away' && from === showing && typeof url === 'string' && url.length < 1300 && (ctx.site === 'canvas' ? /^\/(?!\/)/.test(url) : /^\/ultra(\/|$)/.test(url))) {
      // Canvas: another course's page goes to that course's frame; the frame that left stays on screen until it shows.
      const u = ctx.site === 'canvas' && L.safe(...split(url)), c = u && u.match(/^\/courses\/(\d+)/)?.[1];
      if (c && c !== from) { frames.get(from).away = true; openAt(c, u); }
      else { drop(from); show(''); route(url); }
    }
  });
  if (framed && !preview) {
    // Track before load: slow native resources must not leave usable editors unprotected.
    // shortcut: native work without edit/submit events is unknown; use an LMS save-state API when available.
    for (const event of ['input', 'change', 'submit']) document.addEventListener(event, (e) => { if (on && e.isTrusted) toTop('edited'); }, true);
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== window.top) return;
      if (e.data?.gzCtab === 'visible' && typeof e.data.on === 'boolean') {
        html.toggleAttribute('data-gz-ctab-framed', !e.data.on); ctx.scene();
        // A hidden page may have left its course while its navigation request was ignored.
        if (e.data.on) { awayFrom = ''; pass(); }
      }
      else if (e.data?.gzCtab === 'note' && typeof e.data.text === 'string' && e.data.text.length <= 500) say(e.data.text);
      else if (e.data?.gzCtab === 'loading' && (e.data.cid === '' || L.validId(e.data.cid, ctx.site))) { waiting = e.data.cid; mark(); }
    });
    toTop('loaded');
  }
  // Ultra routes without reloading: the address goes in history, and the page hears it as Forward. Absolute: Ultra's
  // <base href> is its CDN, another origin.
  const route = (url) => {
    if (ctx.site === 'canvas') { location.assign(location.origin + url); return; }
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
    const cur = showing || here();
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
  let dragged = 0;
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
      const mine = tabs.find((x) => x.cid === ctx.courseId());
      tabs = got.map((x) => (mine && x.cid === mine.cid ? { ...x, path: mine.path, top: mine.top } : x));
      for (const cid of [...frames.keys()]) if (!tabs.some((x) => x.cid === cid)) drop(cid);
      pass();
    }
  };
  const onHide = () => { if (on) saveNow(); };
  const onResize = () => { lay(); if (ctx.site === 'canvas') place(); };
  const listen = (yes) => {
    const f = yes ? 'addEventListener' : 'removeEventListener';
    document[f]('scroll', onScroll, { capture: true, passive: true });
    document[f]('click', onLeave, true);
    document[f]('pointerdown', onLeave, true);
    if (ctx.site === 'canvas') globalThis[f]('click', onCourseLink);
    globalThis[f]('pagehide', onHide);
    globalThis[f]('resize', onResize);
    try { if (chrome.runtime?.id) chrome.storage.onChanged[yes ? 'addListener' : 'removeListener'](onStore); } catch { /* reloaded */ }
  };
  const start = () => {
    readPrefs().then(() => { drawn = ''; pass(); });
    if (preview) { tabs = L.order(DEMO.map((x) => ({ ...x }))); loaded = true; return; }
    // A reload while a tab's frame was on screen: that tab again.
    const was = (() => { try { return framed ? '' : sessionStorage.getItem('gz-ctabs-shown'); } catch { return ''; } })();
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
          if (was && was !== ctx.courseId() && tabs.some((x) => x.cid === was)) show(was);
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
    if (framed && !preview && cid !== framed) {
      const url = location.pathname + location.search;
      if (awayFrom !== url) { awayFrom = url; toTop('away', { url }); }
      return;
    }
    // This page going somewhere itself while a frame covers it (its menu, Back): it is what shows now. A course it opens
    // that has a frame keeps one copy, this page's.
    if (showing && location.pathname + location.search !== shownFrom) show('');
    if (!framed && cid && !showing && frames.has(cid) && waiting !== cid) drop(cid); // (one opened from a link here is on its way)
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
    // Back to the page under the tabs (a frame was showing), as picking the page's own item would.
    leave: () => { if (on && showing) show(''); },
    place,
  };
  return { sync, held, petSurface, bar, showing: () => showing, frames: () => frames.size, revoked: () => signedOut, snapshots: () => snaps.size };
})();

GZ_CTABS;
