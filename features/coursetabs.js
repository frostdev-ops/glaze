// Course tabs on Blackboard Ultra (enhance.tabs, B8), loaded on demand: content-ultra.js loads this (after
// lib/coursetabs.js) in the top frame while the switch is on, calls sync() from its passes, and held() from its mutation
// callback so the strip is back in a top bar Ultra has just drawn before that bar is painted.
// Each course the student opens gets a tab, as a browser's pages do: closed, pinned and reordered with the mouse or the
// keyboard, at most `cap` of them. The strip sits above the course's sticky top bar, between its two rows or below it; on
// an item opened over the course (a document, a discussion), at that panel's header; outside a course, above the page.
// A tab goes back to where it was in its course; an Assignment overview needs a positive already-cached column.
// Leaving a course keeps an inert copy of what was on screen (snapshot), in memory only: this page's, and the worker's
// storage.session across reloads, never on disk. A tab's click shows its copy at once while Ultra opens the course, then
// fades to the live page. Nothing is fetched or opened in the background: a copy is only what the student already saw.
// The list is kept per site and account (storage.local ctabs:<origin>:<uid>); the account is Ultra's /users/me, asked
// once a page and shared with Glaze's other features (content-ultra.js me).
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_CTABS = globalThis.GZ_CTABS || (() => {
  const ctx = globalThis.GZ_CTX;
  const L = GZ_CTABS_LIB;
  const { t } = ctx;
  const html = document.documentElement;
  const preview = /-extension:$/.test(location.protocol);
  const DEF = GZ_SANITIZE({}).tabs;
  const P = () => (preview ? ctx.settings().tabs : prefs) || DEF;

  let on = false;
  let signedOut = false;
  let prefs = null; // storage.sync `tabs`, cleaned
  let epoch = 0; // worker cache generation; pending replies from an older generation are ignored
  let who = null; // the account: Ultra's user id
  let loaded = false; // the stored list is in (or can't be: then this page's list only)
  let tabs = []; // lib/coursetabs.js's list
  let lastPath = '';
  let last; // the course shown at the last pass
  let strip = null;
  let list = null; // the tablist
  let note = null; // the strip's word (role=status)
  let drawn = '';
  let go = null; // a switch under way: { cid, url, at, top, over (the copy on screen), timer, click, hard }
  const snaps = new Map(); // cid → snapshot, newest last
  // The editor's preview: three made-up courses, the first one open.
  let demo = '_1_1';
  const DEMO = [['_1_1', 'Computer Science I', 'FA26-CS101-01', 2], ['_2_1', 'Spanish 110', 'FA26-SPAN110-02', 3], ['_3_1', 'Calculus II', 'FA26-MATH201-01', 5]]
    .map(([cid, name, code, slot], i) => ({ cid, name, code, slot, pin: i === 2, at: 0, path: '', top: 0 }));

  const local = (fn) => { try { if (chrome.runtime?.id) fn(chrome.storage.local); } catch { /* extension reloaded under the tab */ } };
  const key = () => L.storeKey(location.origin, who);
  // The worker keeps snapshots across reloads (lib/background.js 'glaze:snap'), for this site and account only.
  const send = (m) => {
    if (preview || !who || !chrome.runtime?.id) return Promise.resolve(null);
    try { const sent = epoch; return Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:snap', uid: who, born: performance.timeOrigin, epoch, ...m })).then((r) => m.op === 'hello' || sent === epoch ? r : null, () => null); } catch { return Promise.resolve(null); }
  };
  const readPrefs = () => new Promise((res) => { try { if (chrome.runtime?.id) chrome.storage.sync.get('tabs', (r) => res(r?.tabs)); else res(); } catch { res(); } })
    .then((raw) => { prefs = GZ_SANITIZE({ tabs: raw }).tabs; });
  let saveTimer = 0;
  const saveNow = () => { clearTimeout(saveTimer); if (who && loaded && !preview) local((s) => s.set({ [key()]: { tabs } })); };
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); };
  const here = () => (preview ? demo : ctx.courseId());
  const shown = (e) => !!e && e.getClientRects().length > 0;
  const safePath = (...a) => (a.length ? L.safe(a[0], a[1]) : L.safe(location.pathname, location.search));

  // ---- where the strip goes -------------------------------------------------------------------------------------
  // The course's top bar (parity/spikes/B8.md): div.bb-course-navigation, sticky, two rows (the header, then the tools in
  // .js-course-navigation). A panel opened over the course is the last visible layer that doesn't hold the bar.
  const LAYER = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  const bars = document.getElementsByClassName('bb-course-navigation');
  const courseBar = () => { for (let i = bars.length - 1; i >= 0; i--) if (bars[i].localName === 'div') return bars[i]; return null; };
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
    if (go?.over) return spot('snap', strip.parentElement === go.over, () => go.over.append(strip));
    const a = P().at;
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
  let clearHeader = null, hadClear = false;
  const keepClear = (header) => {
    if (header === clearHeader) return;
    if (clearHeader && !hadClear) clearHeader.removeAttribute('data-gz-keep-clear');
    clearHeader = header;
    hadClear = !!header?.hasAttribute('data-gz-keep-clear');
    if (header && !hadClear) header.setAttribute('data-gz-keep-clear', '');
  };
  const place = () => {
    if (!on || !strip) return;
    const w = home();
    keepClear(w?.clear || null);
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
  let seenBar = null;
  const held = () => {
    if (!on || !strip || go?.over) return;
    const bar = courseBar();
    if (strip.isConnected && (shown(bar) ? bar === seenBar : shown(seenBar) && seenBar.contains(strip))) return;
    seenBar = shown(bar) ? bar : routed();
    place();
    seenBar ||= strip.parentElement;
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
  const draw = () => {
    if (!strip) return;
    const p = P();
    const cur = go?.cid || here();
    const known = ctx.courseList();
    const rows = (loaded ? tabs : []).map((x) => {
      const c = known[x.cid] || {};
      const nick = ctx.nickOf(x.cid);
      const name = c.name || x.name || c.code || x.code || t('Course');
      const code = c.code || x.code || '';
      return { cid: x.cid, pin: x.pin, cur: x.cid === cur, label: labelFor(x.cid, name, code), full: [...new Set([nick, name, code].filter(Boolean))].join(' · '), slot: c.slot || x.slot || '' };
    });
    const k = JSON.stringify([rows, p, ctx.locale(), drag?.on && drag.cid]);
    if (k === drawn) return;
    drawn = k;
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
      const cls = `gz-ctab${r.slot ? ` course-color-${r.slot}` : ''}`;
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
  };
  // The strip's word: why a tab closed. Gone again after a few seconds.
  let sayTimer = 0;
  const say = (msg) => { if (!note || note.textContent === msg) return; note.textContent = msg; clearTimeout(sayTimer); sayTimer = setTimeout(() => { note.textContent = ''; }, 6000); };

  // ---- the student's courses ------------------------------------------------------------------------------------
  // The course shown: its tab (made if new; past the cap the least recently used unpinned one goes, with a word), and its
  // place (where in the course, and the scroll there, kept by onScroll).
  const visitTab = (cid) => {
    const c = ctx.courseList()[cid];
    const name = c?.name || courseBar()?.querySelector('course-page-header [class*="courseName"], course-page-header h1')?.textContent.trim() || '';
    const r = L.open(tabs, { cid, at: Date.now(), ...(name && { name: name.slice(0, 200) }), ...(c?.code && { code: c.code }) }, P().cap);
    tabs = r.tabs;
    if (r.full) say(t('Close or unpin a tab to open another course tab.'));
    if (r.gone.length) {
      const g = r.gone[0];
      const c = ctx.courseList()[g.cid] || {};
      say(t('Closed {name} to make room. Pin a tab to keep it open.', { name: labelFor(g.cid, c.name || g.name || c.code || g.code || t('Course'), c.code || g.code) }));
      for (const x of r.gone) { snaps.delete(x.cid); send({ op: 'forget', cid: x.cid }); }
    }
    save();
  };
  const notePlace = (cid) => {
    if (!atView()) return;
    const x = tabs.find((y) => y.cid === cid);
    const p = x && L.placeOf(location.pathname, location.search);
    if (p?.path && x.path !== p.path) { x.path = p.path; x.top = 0; save(); }
  };
  const onScroll = (e) => {
    if (go) { go.changed = performance.now(); return; }
    if (e.isTrusted) { clearTimeout(capTimer); capTimer = 0; later(700); }
    const cid = ctx.courseId();
    const sc = e.target === document ? document.scrollingElement : e.target;
    const x = cid && sc === pageScroller() && tabs.find((y) => y.cid === cid);
    if (!x || !safePath()) return;
    observeView();
    if (!atView()) return;
    notePlace(cid);
    x.top = Math.round(sc.scrollTop);
    save();
  };

  // ---- snapshots ------------------------------------------------------------------------------------------------
  // What a course page looked like, to the pixel: a picture of the browser tab, which the worker takes
  // (lib/background.js 'shot') while this tab is the one on screen. Only of a page a tab may go back to, once Ultra has
  // finished building it, and never with Glaze's copy or a tip of Glaze's in it. Taken when the student is about to leave
  // (a press on a course tab, or on a link out of the course), a moment after each new page, after scrolling, and every
  // 15 s while one stays open; at most one a second (the browser allows two).
  const loading = (el) => [...el.querySelectorAll('.spinner, path[class*="makeStylesindeterminateSvg-"], .MuiSkeleton-root')].some(shown);
  const split = (path) => { const i = path.indexOf('?'); return i < 0 ? [path, ''] : [path.slice(0, i), path.slice(i + 1)]; };
  let shooting = null, shotAt = -1e9;
  const shoot = (cid = ctx.courseId(), path = safePath()) => {
    const no = (why) => { html.dataset.gzShotDebug = `${Math.round(performance.now())} ${why}`; return Promise.resolve(null); };
    if (shooting) return shooting;
    if (!on || signedOut || go || !cid || !path || preview) return no('state');
    if (ctx.holding()) return no('holding');
    if (document.visibilityState !== 'visible') return no('hidden');
    if (performance.now() - shotAt < 600) return no('rate');
    if (safePath(...split(path)) !== path) return no('path');
    if (!atView(path)) return no('view');
    if (loading(document.body)) return no('loading');
    if (document.querySelector('#gz-ctabs-snap')) return no('snap');
    const bar = shown(courseBar()) ? courseBar() : null;
    if (bar ? otherCourse(bar, cid) : !routed()) return no('bar');
    const box = strip?.isConnected && shown(strip) && strip.getBoundingClientRect();
    shotAt = performance.now();
    // Glaze's tip is not part of the page: hidden for the moment of the picture, a frame before it is taken.
    const tips = [...document.querySelectorAll('.gz-tip')];
    for (const t of tips) t.style.visibility = 'hidden';
    shooting = new Promise((ok) => requestAnimationFrame(() => setTimeout(ok))).then(() => send({ op: 'shot', cid, path, strip: box ? [box.top, box.left, box.width].map(Math.round) : null, size: [innerWidth, innerHeight] }))
      .then((x) => { html.dataset.gzShotDebug = `${Math.round(performance.now())} ${x?.snap ? 'ok' : 'worker-null'}`; if (x?.snap?.cid === cid && x.snap.path === path) keep(x.snap); return x?.snap || null; }, () => null)
      .finally(() => { shooting = null; for (const t of tips) t.style.visibility = ''; });
    return shooting;
  };
  const keep = (s) => {
    snaps.delete(s.cid);
    snaps.set(s.cid, s);
    for (const k of L.fit([...snaps.values()].map((x) => [x.cid, x.n, x.at]))) snaps.delete(k);
  };
  // A picture is shown only for the page it was taken of, at the window size it was taken at.
  const fits = (s, url) => !!s && s.path === url && s.size?.[0] === innerWidth && s.size?.[1] === innerHeight && safePath(...split(url)) === url;
  let capTimer = 0;
  let capWhere = '';
  let capAt = 0;
  const later = (wait = 1500) => {
    if (capTimer || (wait > 1000 && capWhere === location.href && Date.now() - capAt < 15000)) return;
    capTimer = setTimeout(() => {
      capTimer = 0;
      (globalThis.requestIdleCallback || setTimeout)(() => { capWhere = location.href; capAt = Date.now(); shoot(); }, { timeout: 1000 });
    }, wait);
  };
  // Leaving through Ultra's own header (home, the course switcher), or a link out of the course: a picture first, taken on
  // the press, before Ultra starts changing the page. Ultra's sign-out (the main menu's "#" link) forgets them all.
  const onLeave = (e) => {
    if (!on || e.isTrusted === false) return;
    const el = e.target instanceof Element && e.target.closest('a[href], button, [role="button"], [role="link"]');
    if (!el || el.closest('#gz-ctabs')) return;
    const href = el.getAttribute('href') || '';
    if (e.type === 'click' && el.closest('.MuiDrawer-paper, #base_tools') && (href === '#' || /logout/i.test(href))) {
      send({ op: 'drop', signout: true });
      revoke();
      return;
    }
    const cid = ctx.courseId();
    if (go || !cid || e.type !== 'pointerdown') return;
    if (el.closest('course-page-header, .MuiDrawer-paper, #base_tools') || (href.startsWith('/') && !href.includes(`/courses/${cid}/`))) shoot();
  };

  // ---- the picture on screen ------------------------------------------------------------------------------------
  // Over the whole window, under the live strip (moved onto it), until the live page has settled where the tab left it.
  // A press on it is kept and given to the live page once that is shown; a wheel or touch shows the live page at once.
  const cover = (s) => {
    const g = go;
    const over = document.createElement('div');
    over.id = 'gz-ctabs-snap';
    const host = document.createElement('div');
    over.append(host);
    const img = Object.assign(document.createElement('img'), { src: s.shot, alt: '', draggable: false });
    img.style.cssText = 'display:block;width:100vw;height:100vh;pointer-events:auto;user-select:none';
    host.attachShadow({ mode: 'closed' }).append(img);
    if (s.strip) for (const [k, v] of [['t', s.strip[0]], ['l', s.strip[1]], ['w', s.strip[2]]]) over.style.setProperty(`--gz-snap-${k}`, `${v}px`);
    img.addEventListener('pointerdown', (e) => { if (go === g && e.isTrusted) g.press = [e.clientX, e.clientY]; });
    for (const ev of ['wheel', 'touchmove']) img.addEventListener(ev, () => { if (go === g) end(); }, { passive: true });
    // Decoded before it goes up, so its first frame is the whole picture.
    img.decode().catch(() => {}).then(() => {
      if (go !== g || g.over) return;
      html.append(over);
      g.over = over;
      place();
    });
  };
  const fade = (over) => {
    over.inert = true;
    if (html.getAttribute('data-gz-motion') === 'off') return over.remove();
    over.style.opacity = '0';
    setTimeout(() => over.remove(), 300);
  };

  // ---- switching ------------------------------------------------------------------------------------------------
  // Ultra routes without reloading, and follows Back and Forward: the address goes in history, and the page hears it as
  // Forward. A course that hasn't opened after 2.5 s (another Ultra that doesn't follow) is loaded instead. Absolute:
  // Ultra's <base href> is its CDN, another origin.
  const route = (url) => {
    try { history.pushState(null, '', location.origin + url); dispatchEvent(new PopStateEvent('popstate', { state: null })); } catch { location.assign(location.origin + url); }
  };
  // The picture of the page being left is taken first (usually already, on the press; else at most 200 ms), then the
  // tab's own picture goes up and Ultra opens its page underneath.
  let visiting = 0;
  const visit = async (cid) => {
    const x = tabs.find((y) => y.cid === cid);
    if (!x) return;
    if (preview) { demo = cid; drawn = ''; return draw(); }
    const cur = ctx.courseId();
    if (cid === cur && !go) return;
    if (go) end(true);
    const me = ++visiting;
    if (cur && tabs.some((y) => y.cid === cur)) await Promise.race([shoot(cur), new Promise((r) => setTimeout(r, 200))]);
    if (me !== visiting || !on || go) return;
    x.at = Date.now();
    save();
    const url = L.target(x, P().place);
    begin({ cid, url, top: P().place && url === x.path ? x.top : 0 });
    route(url);
    draw();
  };
  const begin = (g) => {
    go = { ...g, before: view(), at: performance.now(), changed: performance.now() };
    moved.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    const s = snaps.get(g.cid);
    if (fits(s, g.url)) cover(s);
    else if (!s) {
      send({ op: 'get', cid: g.cid }).then((r) => {
        if (go?.cid !== g.cid || go.over || !fits(r?.snap, g.url) || performance.now() - go.at > 500) return;
        keep(r.snap);
        cover(r.snap);
      });
    }
    tick();
  };
  // Back or Forward to another course's page that has its picture: the same, with Ultra doing the routing.
  const onPop = () => {
    if (!on || go || !loaded) return;
    const cid = location.pathname.match(/^\/ultra\/courses\/(_\d+_\d+)\//)?.[1];
    const url = location.pathname + location.search;
    const x = cid && cid !== last && tabs.find((y) => y.cid === cid);
    if (x && fits(snaps.get(cid), url)) begin({ cid, url, top: x.path === url ? x.top : 0 });
  };
  // Anything changing in the page while a picture is up (not the strip): the live page is shown only once it is still.
  const moved = new MutationObserver((rs) => { if (go && rs.some((r) => !strip?.contains(r.target))) go.changed = performance.now(); });
  const tick = () => { if (go) go.timer = setTimeout(() => { check(); tick(); }, 50); };
  const otherCourse = (bar, cid) => [...bar.querySelectorAll('a[href*="/courses/_"]')].some((a) => !a.getAttribute('href').includes(`/courses/${cid}/`));
  const check = () => {
    const g = go;
    if (!g) return;
    if (!ctx.on()) return sync(false);
    const now = performance.now(), dt = now - g.at;
    const bar = shown(courseBar()) ? courseBar() : null;
    const v = view();
    const there = ctx.courseId() === g.cid && (bar ? shown(bar) && !otherCourse(bar, g.cid) : readyView(v) && !sameView(v, g.before));
    // Built: its scroll put back while the picture still covers it; shown once nothing has moved for a quarter second
    // (3 s at most: Ultra may never stop).
    if (there && !ctx.holding() && !loading(bar?.closest('.panel-wrap, .bb-offcanvas-panel') || v?.[0] || document.body)) {
      if (!g.built) { g.built = now; g.changed = now; if (g.top) scrollBack(g.top); }
      if (now - g.changed > 250 || now - g.built > 3000) return end();
    }
    // Ultra (or the student) went somewhere else: nothing to wait for.
    if (!location.pathname.startsWith(`/ultra/courses/${g.cid}/`)) return end(true);
    if (dt > 2500 && !g.hard && !there) {
      g.hard = true;
      // The next page finds its picture (from the worker), as this one would have.
      try { sessionStorage.setItem('gz-ctabs-go', `${g.cid} ${who}`); } catch { /* blocked */ }
      location.assign(location.origin + g.url);
    }
    if (dt > 8000) end();
  };
  const end = (cut) => {
    const g = go;
    go = null;
    moved.disconnect();
    clearTimeout(g.timer);
    observeView();
    place();
    if (g.over) { if (cut) g.over.remove(); else fade(g.over); }
    draw();
    if (cut) return;
    if (g.top && !g.built) scrollBack(g.top);
    // A press on the picture goes to what is under it now, if that is a link to a page of the course.
    const a = g.press && document.elementFromPoint(...g.press)?.closest('a[href]');
    try { const u = a && new URL(a.getAttribute('href'), location.origin); if (u && u.origin === location.origin && safePath(u.pathname, u.search)) a.click(); } catch { /* malformed native link */ }
  };
  // The tab's scroll, put back until it holds; anything the student does first ends it. On the outline with "Your place"
  // on, features/place.js does this (with the open folders).
  const scrollerOf = (el, content = false) => {
    let n = 0;
    for (let p = content ? el : el?.parentElement; p && p !== document.body && n++ < 30; p = p.parentElement) if (/^(auto|scroll|overlay)$/.test(getComputedStyle(p).overflowY) && (content || p.scrollHeight > p.clientHeight)) return p;
    return document.scrollingElement;
  };
  const pageScroller = () => {
    const main = routedMain(routed());
    return main ? scrollerOf(main, true) : scrollerOf(strip);
  };
  const scrollBack = (top) => {
    if (/\/outline\/?$/.test(location.pathname) && ctx.settings().enhance.place) return;
    const t0 = Date.now();
    let steady = 0;
    const step = () => {
      const sc = pageScroller();
      if (!ctx.on() || !sc || ctx.acted() > t0 || Date.now() - t0 > 2500 || steady >= 3) return;
      if (Math.abs(sc.scrollTop - top) < 2) steady++;
      else { steady = 0; sc.scrollTop = top; }
      setTimeout(step, 100);
    };
    step();
  };

  // ---- closing, pinning, moving ---------------------------------------------------------------------------------
  const shut = (cid, keys) => {
    const r = L.close(tabs, cid);
    tabs = r.tabs;
    snaps.delete(cid);
    send({ op: 'forget', cid });
    save();
    if (cid === here()) {
      if (preview) demo = r.next;
      else if (r.next) visit(r.next);
      else route('/ultra/course');
    }
    draw();
    if (keys) list.querySelector(`[data-course-id="${r.next}"]`)?.focus();
    if (!tabs.length) flag();
  };
  const pinTab = (cid) => { tabs = L.pin(tabs, cid, !tabs.find((x) => x.cid === cid)?.pin); save(); draw(); };
  const moveTab = (cid, to) => { tabs = L.move(tabs, cid, to); save(); draw(); };
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
      // About to leave this page for another course's: its picture, now, before anything changes.
      if (el.dataset.courseId !== ctx.courseId()) shoot();
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
      const got = L.clean(c[key()].newValue?.tabs);
      if (JSON.stringify(got) === JSON.stringify(tabs)) return;
      const mine = tabs.find((x) => x.cid === ctx.courseId());
      tabs = got.map((x) => (mine && x.cid === mine.cid ? mine : x));
      pass();
    }
  };
  const onHide = () => { if (on) saveNow(); };
  const listen = (yes) => {
    const f = yes ? 'addEventListener' : 'removeEventListener';
    document[f]('scroll', onScroll, { capture: true, passive: true });
    document[f]('click', onLeave, true);
    document[f]('pointerdown', onLeave, true);
    globalThis[f]('popstate', onPop);
    globalThis[f]('pagehide', onHide);
    try { if (chrome.runtime?.id) chrome.storage.onChanged[yes ? 'addListener' : 'removeListener'](onStore); } catch { /* reloaded */ }
  };
  const start = () => {
    readPrefs().then(() => { drawn = ''; pass(); });
    if (preview) { tabs = L.order(DEMO.map((x) => ({ ...x }))); loaded = true; return; }
    const pending = (() => { try { const v = sessionStorage.getItem('gz-ctabs-go'); sessionStorage.removeItem('gz-ctabs-go'); return v?.split(' '); } catch { return null; } })();
    ctx.me().then((uid) => {
      if (!on) return;
      if (typeof uid !== 'string' || !/^_\d+_\d+$/.test(uid)) { loaded = true; pass(); return; }
      who = uid;
      hello().then(() => {
        if (!on || signedOut || who !== uid) return;
        local((s) => s.get(key(), (r) => {
          if (!on || signedOut || who !== uid) return;
          const kept = L.clean(r?.[key()]?.tabs);
          tabs = [...kept, ...tabs.filter((x) => !kept.some((y) => y.cid === x.cid))];
          loaded = true;
          last = undefined;
          pass();
          // Arrived by a full load from a switch on the last page: its copy, from the worker, until this one is built.
          if (pending?.[1] === who && pending[0] === ctx.courseId() && !go) {
            const url = location.pathname + location.search;
            const tab = tabs.find((x) => x.cid === pending[0]);
            begin({ cid: pending[0], url, top: P().place && tab?.path === url ? tab.top : 0 });
          }
        }));
      });
    }, () => { loaded = true; pass(); }); // no account: this page's list only, kept nowhere
  };
  const pass = () => {
    if (!on) return;
    if (!go) observeView();
    const cid = here();
    if (cid && !preview && loaded) {
      if (cid !== last || !tabs.some((x) => x.cid === cid)) visitTab(cid);
      notePlace(cid);
    }
    if (cid !== last) last = cid;
    lastPath = location.pathname + location.search;
    flag();
    place();
    draw();
    if (cid && !go && !preview) later();
  };
  const sync = (want) => {
    if (signedOut) want = false;
    if (!want) {
      html.removeAttribute('data-gz-ctabs');
      keepClear(null);
      if (!on) return;
      on = false;
      listen(false);
      clearTimeout(capTimer);
      capTimer = 0;
      clearTimeout(sayTimer);
      saveNow();
      if (go) end(true);
      strip?.remove();
      for (const copy of document.querySelectorAll('#gz-ctabs-snap')) copy.remove();
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
      else { hello().then(() => { if (!on || signedOut) return; drawn = ''; local((s) => s.get(key(), (r) => { if (who) tabs = L.clean(r?.[key()]?.tabs); pass(); })); }); }
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
  };
  const invalidate = (next) => {
    if (next <= epoch) return;
    epoch = next;
    snaps.clear();
    if (go?.over) { const old = go.over; go.over = null; place(); old.remove(); }
    for (const copy of document.querySelectorAll('#gz-ctabs-snap')) copy.remove();
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
    const follow = () => setTimeout(() => sync(ctx.on() && !!ctx.settings().enhance.tabs));
    addEventListener('message', (e) => { if (e.data?.gzPreview) follow(); });
    follow();
  }
  return { sync, held, showing: () => !!go?.over, revoked: () => signedOut, snapshots: () => snaps.size };
})();

GZ_CTABS;
