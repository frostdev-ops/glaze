// Course tabs on Blackboard Ultra (enhance.tabs, B8), loaded on demand: content-ultra.js loads this (after
// lib/coursetabs.js) in the top frame while the switch is on, calls sync() from its passes, and held() from its mutation
// callback so the strip is back in a top bar Ultra has just drawn before that bar is painted.
// Each course the student opens gets a tab, as a browser's pages do: closed, pinned and reordered with the mouse or the
// keyboard, at most `cap` of them. The strip sits above the course's sticky top bar, between its two rows or below it; on
// an item opened over the course (a document, a discussion), at that panel's header; outside a course, above the page.
// A tab goes back to where it was in its course (lib/coursetabs.js target: never into a test, attempt or assessment).
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

  const local = (fn) => { try { fn(chrome.storage.local); } catch { /* extension reloaded under the tab */ } };
  const key = () => L.storeKey(location.origin, who);
  // The worker keeps snapshots across reloads (lib/background.js 'glaze:snap'), for this site and account only.
  const send = (m) => {
    if (preview || !who) return Promise.resolve(null);
    try { const sent = epoch; return Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:snap', uid: who, born: performance.timeOrigin, epoch, ...m })).then((r) => m.op === 'hello' || sent === epoch ? r : null, () => null); } catch { return Promise.resolve(null); }
  };
  const readPrefs = () => new Promise((res) => { try { chrome.storage.sync.get('tabs', (r) => res(r?.tabs)); } catch { res(); } })
    .then((raw) => { prefs = GZ_SANITIZE({ tabs: raw }).tabs; });
  let saveTimer = 0;
  const saveNow = () => { clearTimeout(saveTimer); if (who && loaded && !preview) local((s) => s.set({ [key()]: { tabs } })); };
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); };
  const here = () => (preview ? demo : ctx.courseId());
  const shown = (e) => !!e && e.getClientRects().length > 0;

  // ---- where the strip goes -------------------------------------------------------------------------------------
  // The course's top bar (parity/spikes/B8.md): div.bb-course-navigation, sticky, two rows (the header, then the tools in
  // .js-course-navigation). A panel opened over the course is the last visible layer that doesn't hold the bar.
  const LAYER = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  const bars = document.getElementsByClassName('bb-course-navigation');
  const courseBar = () => { for (let i = bars.length - 1; i >= 0; i--) if (bars[i].localName === 'div') return bars[i]; return null; };
  const topLayer = () => [...document.querySelectorAll(LAYER)].filter(shown).pop() || null;
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
  const spot = (at, ok, put) => ({ at, ok: !!ok, put });
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
    // Outside a course (the Courses page, the calendar…): above the page, once there is a tab to go back to.
    const page = !here() && loaded && tabs.length && (document.getElementById('main-content-inner') || document.getElementById('main-content'));
    return page ? spot('page', page.firstElementChild === strip, () => page.prepend(strip)) : null;
  };
  const place = () => {
    if (!on || !strip) return;
    const w = home();
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
    if (!on || !strip || go?.over || (strip.isConnected && bars[0] === seenBar)) return;
    seenBar = bars[0];
    place();
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
    strip.addEventListener('mousedown', (e) => { if (e.button === 1 && tabOf(e)) e.preventDefault(); }); // no autoscroll
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
      return { cid: x.cid, pin: x.pin, cur: x.cid === cur, label: nick || (p.label === 'code' && code) || name, full: [nick || name, code !== name && code].filter(Boolean).join(' · '), slot: c.slot || x.slot || '' };
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
      set(e, 'aria-label', r.pin ? t('{name}, pinned', { name: r.label }) : r.label);
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
      say(t('Closed {name} to make room. Pin a tab to keep it open.', { name: ctx.nickOf(g.cid) || ctx.courseList()[g.cid]?.name || g.name || t('Course') }));
      for (const x of r.gone) { snaps.delete(x.cid); send({ op: 'forget', cid: x.cid }); }
    }
    save();
  };
  const notePlace = (cid) => {
    const x = tabs.find((y) => y.cid === cid);
    const p = x && L.placeOf(location.pathname, location.search);
    if (p?.path && x.path !== p.path) { x.path = p.path; x.top = 0; save(); }
  };
  const onScroll = (e) => {
    const cid = !go && ctx.courseId();
    const sc = e.target === document ? document.scrollingElement : e.target;
    const x = cid && sc instanceof Element && sc.contains(strip) && tabs.find((y) => y.cid === cid);
    if (!x || !L.safe(location.pathname, location.search)) return;
    x.top = Math.round(sc.scrollTop);
    save();
  };

  // ---- snapshots ------------------------------------------------------------------------------------------------
  // What is on screen of the course now: its layer (the panel holding its bar) and any layer opened over it, each copied
  // with the ancestors CSS matches it by. Only a page a tab may go back to, and only once Ultra has finished building it.
  const loading = (el) => [...el.querySelectorAll('.spinner, path[class*="makeStylesindeterminateSvg-"], .MuiSkeleton-root')].some(shown);
  const layers = () => {
    const base = courseBar()?.closest('.panel-wrap, .bb-offcanvas-panel');
    if (!base) return [];
    const all = [...document.querySelectorAll(LAYER)].filter(shown);
    const over = all.filter((l) => !base.contains(l) && base.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING);
    return [...(shown(base) ? [base] : []), ...over.filter((l) => !over.some((o) => o !== l && o.contains(l)))];
  };
  const NAME = /^[a-z][a-z0-9-]*$/;
  const chain = (l) => {
    const out = [];
    for (let p = l.parentElement; p && p !== document.body && p !== html && out.length < 30; p = p.parentElement) {
      out.unshift([p.localName, p.id, p.getAttribute('class') || '', p.getAttribute('style') || '', p.getAttribute('bb-course-membership-markups') || '']);
    }
    return out;
  };
  // Nothing that runs, loads or takes input (lib/coursetabs.js DROP, keepAttr); hidden parts left out.
  const sanitize = (root) => {
    if (L.DROP.has(root.localName.toLowerCase())) return null;
    if (own(root)) root = asPlain(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    const drop = [], defined = [];
    for (let n = w.currentNode; n; n = w.nextNode()) {
      if (n.nodeType === 8 || L.DROP.has(n.localName.toLowerCase()) || n.hasAttribute('hidden') || n.classList.contains('ng-hide') || n.style?.display === 'none' || n.style?.visibility === 'hidden') { if (n !== root) drop.push(n); continue; }
      const special = own(n);
      for (const a of [...n.attributes]) if (!L.keepAttr(a.name, a.value, n.localName)) n.removeAttribute(a.name);
      if (n.hasAttribute('style')) n.style.cssText = styleText(n.style);
      if (special) defined.push(n);
    }
    for (const n of drop) n.remove();
    for (const n of defined) if (n !== root && root.contains(n)) asPlain(n);
    return root;
  };
  // Chrome's isolated world has no custom-element registry. Every custom name becomes a div before connection,
  // including tags registered after capture; data-gz-tag keeps ordinary readable type selectors. A customized built-in
  // must be recreated too: removing its is attribute leaves an internal upgrade name behind.
  const own = (e) => e.localName.includes('-') || e.hasAttribute('is');
  const asPlain = (y) => {
    const custom = y.localName.includes('-');
    const d = document.createElement(custom ? 'div' : y.localName);
    for (const a of y.attributes) if (a.name !== 'is') d.setAttribute(a.name, a.value);
    if (custom) d.setAttribute('data-gz-tag', y.localName);
    d.append(...y.childNodes);
    y.replaceWith(d);
    return d;
  };
  // A copy of `live`, as HTML: walked beside the original for what only it knows (how far each part is scrolled, which
  // pictures are already in: the others are left out, so showing the copy loads nothing), the strip left as a gap.
  const copy = (live) => {
    // Parsing in a template keeps custom-element constructors and resource loading dormant until sanitized.
    const template = document.createElement('template');
    const text = live.outerHTML;
    if (text.length > L.SNAP_ONE) return '';
    template.innerHTML = text;
    const c = template.content.firstElementChild;
    const a = document.createTreeWalker(live, NodeFilter.SHOW_ELEMENT);
    const b = document.createTreeWalker(c, NodeFilter.SHOW_ELEMENT);
    let gap = null;
    const defined = [];
    for (let x = a.currentNode, y = b.currentNode; x && y; x = a.nextNode(), y = b.nextNode()) {
      if (x.scrollTop) y.setAttribute('data-gz-top', Math.round(x.scrollTop));
      if (x.scrollLeft) y.setAttribute('data-gz-left', Math.round(x.scrollLeft));
      if (x === strip) gap = [y, x.offsetHeight];
      else if (x.localName === 'img') {
        y.removeAttribute('src');
        if (x.complete && x.naturalWidth && x.naturalWidth * x.naturalHeight <= 1e6) {
          try {
            const bitmap = document.createElement('canvas');
            bitmap.width = x.naturalWidth; bitmap.height = x.naturalHeight;
            bitmap.getContext('2d').drawImage(x, 0, 0);
            y.setAttribute('src', bitmap.toDataURL('image/png'));
          } catch { /* A tainted picture cannot be copied without fetching it again. */ }
        }
      }
      else if (own(x)) defined.push(y);
    }
    if (gap) {
      const ph = document.createElement('div');
      ph.className = 'gz-ctabs-gap';
      ph.style.height = `${gap[1]}px`;
      gap[0].replaceWith(ph);
    }
    for (const y of defined) if (y !== c && c.contains(y)) asPlain(y);
    return sanitize(c).outerHTML;
  };
  const capture = (cid = ctx.courseId(), path = L.safe(location.pathname, location.search)) => {
    if (!on || signedOut || go || !path || ctx.holding()) return;
    const bar = courseBar();
    if (!bar || otherCourse(bar, cid)) return;
    const ls = layers();
    if (!ls.length || ls.some(loading)) return;
    const r = strip?.isConnected && strip.getBoundingClientRect();
    const s = { cid, path, at: Date.now(), strip: r ? [r.top, r.left, r.width].map(Math.round) : null, layers: [], n: 0 };
    for (const l of ls) {
      const b = l.getBoundingClientRect();
      const h = copy(l);
      if (!h) return;
      s.layers.push({ html: h, at: [b.top, innerWidth - b.right, innerHeight - b.bottom, b.left].map(Math.round), chain: chain(l) });
    }
    s.n = JSON.stringify({ layers: s.layers, strip: s.strip, path: s.path }).length;
    if (s.n > L.SNAP_ONE) return;
    keep(s);
  };
  const keep = (s) => {
    snaps.delete(s.cid);
    snaps.set(s.cid, s);
    for (const k of L.fit([...snaps.values()].map((x) => [x.cid, x.n, x.at]))) snaps.delete(k);
  };
  // To the worker, for after a reload: when the student leaves the course, or the page.
  const pushed = new WeakSet();
  const push = (cid) => { const s = snaps.get(cid); if (s && !pushed.has(s)) { pushed.add(s); send({ op: 'put', cid, snap: s }); } };
  // A fresh copy for leaving some way Glaze doesn't see coming: a moment after each new page of the course, and every
  // 15 s while one stays open (Ultra never stops changing the page, so not after every change).
  let capTimer = 0;
  let capWhere = '';
  let capAt = 0;
  const later = () => {
    if (capTimer || (capWhere === location.href && Date.now() - capAt < 15000)) return;
    capTimer = setTimeout(() => {
      capTimer = 0;
      (globalThis.requestIdleCallback || setTimeout)(() => { capWhere = location.href; capAt = Date.now(); capture(); }, { timeout: 1000 });
    }, 1500);
  };
  // Leaving through Ultra's own header (home, the course switcher), a link out of the course, or Back: a copy first.
  // Ultra's sign-out (the main menu's "#" link) forgets them all.
  const onLeave = (e) => {
    if (!on || e.isTrusted === false) return;
    const el = e.type === 'click' && e.target instanceof Element && e.target.closest('a[href], button, [role="button"], [role="link"]');
    if (el && !el.closest('#gz-ctabs')) {
      const href = el.getAttribute('href') || '';
      if (el.closest('.MuiDrawer-paper, #base_tools') && (href === '#' || /logout/i.test(href))) {
        send({ op: 'drop', signout: true });
        revoke();
        return;
      }
    }
    if (go) return;
    const cid = ctx.courseId();
    if (!cid) return;
    if (e.type === 'popstate') return last && capture(last, L.safe(...lastPath.split('?')));
    if (!el || el.closest('#gz-ctabs')) return;
    const href = el.getAttribute('href') || '';
    if (el.closest('course-page-header') || (href.startsWith('/') && !href.includes(`/courses/${cid}/`))) capture();
  };

  // ---- the copy on screen ---------------------------------------------------------------------------------------
  // Readable rules only: relinking an opaque CDN sheet can revalidate it, and CSS URLs can fetch even inside an inert
  // tree. Unreadable sheets and resource declarations are omitted; the live page still keeps all of its original styles.
  const styleText = (style) => [...style].filter((k) => L.cssSafe(style.getPropertyValue(k))
    && !(/^(?:background|border-image|mask|list-style|cursor|content|filter|clip-path|shape-outside|offset-path|fill|stroke|marker|-webkit-mask|-webkit-box-reflect)/.test(k) && /var\s*\(/i.test(style.getPropertyValue(k))))
    .map((k) => `${k}:${style.getPropertyValue(k)}${style.getPropertyPriority(k) ? ' !important' : ''}`).join(';');
  const ruleText = (r, tags) => {
    if (r instanceof CSSImportRule || r instanceof CSSFontFaceRule) return '';
    const nested = r.cssRules ? [...r.cssRules].map((x) => ruleText(x, tags)).join('\n') : '';
    if (r.style) {
      const text = `${styleText(r.style)};${nested}`;
      const head = r.cssText.slice(0, r.cssText.indexOf('{'));
      return r.cssText.includes('{') ? `${head.startsWith('@') ? head : L.selectors(head, tags)}{${text}}` : text;
    }
    if (r.cssRules) return `${r.cssText.slice(0, r.cssText.indexOf('{'))}{${nested}}`;
    return L.cssSafe(r.cssText) ? r.cssText : '';
  };
  const mirror = (tags) => {
    const fragment = document.createDocumentFragment();
    for (const sheet of document.styleSheets) {
      if (sheet.disabled) continue;
      let text;
      try { text = [...sheet.cssRules].map((r) => ruleText(r, tags)).join('\n'); } catch { continue; }
      const e = Object.assign(document.createElement('style'), { textContent: text });
      if (sheet.media?.mediaText) e.media = sheet.media.mediaText;
      fragment.append(e);
    }
    return fragment;
  };
  const OWN = `[data-gz-layer] { position: absolute !important; inset: 0 !important; width: auto !important; height: auto !important; margin: 0 !important; transform: none !important; }
.gz-at { position: fixed; overflow: hidden; background: var(--gz-ground, var(--gz-surface-2, Canvas)); }
.gz-at * { animation: none !important; transition: none !important; font-family: system-ui, sans-serif !important; }
.gz-catch { position: fixed; pointer-events: auto; cursor: progress; }`;
  const cover = (s) => {
    const over = document.createElement('div');
    over.id = 'gz-ctabs-snap';
    const host = document.createElement('div');
    over.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const tags = new Set();
    for (const l of s.layers) {
      const inset = l.at.map((v) => `${Math.max(0, v)}px`).join(' ');
      const at = Object.assign(document.createElement('div'), { className: 'gz-at', inert: true });
      at.style.inset = inset;
      // <html> and <body> again (Glaze's rules hang off html's data-gz-*), then each ancestor: boxless, there to be matched.
      const h = document.createElement('html');
      for (const a of html.attributes) if (a.name !== 'style' && a.name !== 'data-gz-ctabs' && L.keepAttr(a.name, a.value, 'html')) h.setAttribute(a.name, a.value);
      h.style.cssText = `${styleText(html.style)};display:contents`;
      const b = document.createElement('body');
      b.className = document.body.className;
      b.style.display = 'contents';
      h.append(b);
      let p = b;
      for (const [tag, id, cls, style, cm] of l.chain) {
        if (!NAME.test(tag) || L.DROP.has(tag)) continue;
        const custom = tag.includes('-');
        const e = document.createElement(custom ? 'div' : tag);
        if (custom) { e.setAttribute('data-gz-tag', tag); tags.add(tag); }
        if (id) e.id = id;
        if (cls) e.setAttribute('class', cls);
        if (cm) e.setAttribute('bb-course-membership-markups', cm);
        e.style.cssText = style;
        e.style.cssText = `${styleText(e.style)};display:contents`;
        p.append(e);
        p = e;
      }
      const tpl = document.createElement('template');
      tpl.innerHTML = l.html;
      const lay = tpl.content.firstElementChild;
      if (!lay) continue;
      const safeLayer = sanitize(lay);
      if (!safeLayer) continue;
      safeLayer.setAttribute('data-gz-layer', '');
      for (const e of [safeLayer, ...safeLayer.querySelectorAll('[data-gz-tag]')]) {
        const tag = e.getAttribute('data-gz-tag');
        if (tag) tags.add(tag);
      }
      p.append(safeLayer);
      at.append(h);
      const catcher = Object.assign(document.createElement('div'), { className: 'gz-catch' });
      catcher.style.inset = inset;
      catcher.addEventListener('click', (e) => remember(root, e));
      root.append(at, catcher);
    }
    root.prepend(mirror(tags), Object.assign(document.createElement('style'), { textContent: OWN }));
    if (s.strip) for (const [k, v] of [['t', s.strip[0]], ['l', s.strip[1]], ['w', s.strip[2]]]) over.style.setProperty(`--gz-snap-${k}`, `${v}px`);
    html.append(over);
    for (const e of root.querySelectorAll('[data-gz-top], [data-gz-left]')) { e.scrollTop = +e.getAttribute('data-gz-top') || 0; e.scrollLeft = +e.getAttribute('data-gz-left') || 0; }
    go.over = over;
    place();
  };
  // A click on the copy waits for the live page: the link under it is followed there, if it is a page a tab may open.
  const remember = (root, e) => {
    if (!go) return;
    const hit = [...root.querySelectorAll('a[href]')].reverse().find((a) => { const r = a.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; });
    const href = hit?.getAttribute('href') || '';
    let url;
    try { const u = new URL(href, location.origin); if (u.origin === location.origin) url = L.safe(u.pathname, u.search); } catch { /* malformed native link */ }
    if (hit && url) go.click = { href, url, text: hit.textContent.trim() };
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
  const visit = (cid) => {
    const x = tabs.find((y) => y.cid === cid);
    if (!x) return;
    if (preview) { demo = cid; drawn = ''; return draw(); }
    const cur = ctx.courseId();
    if (cid === cur && !go) return;
    if (cur && tabs.some((y) => y.cid === cur)) { capture(); push(cur); }
    if (go) end(true);
    x.at = Date.now();
    save();
    const url = L.target(x, P().place);
    go = { cid, url, at: performance.now(), top: P().place && url === x.path ? x.top : 0 };
    const s = snaps.get(cid);
    if (s?.path === url) cover(s);
    else if (!s) {
      send({ op: 'get', cid }).then((r) => {
        if (go?.cid !== cid || go.over || r?.snap?.path !== url || performance.now() - go.at > 500) return;
        keep(r.snap);
        cover(r.snap);
      });
    }
    route(url);
    draw();
    tick();
  };
  const tick = () => { if (go) go.timer = setTimeout(() => { check(); tick(); }, 50); };
  const otherCourse = (bar, cid) => [...bar.querySelectorAll('a[href*="/courses/_"]')].some((a) => !a.getAttribute('href').includes(`/courses/${cid}/`));
  const check = () => {
    const g = go;
    if (!g) return;
    const dt = performance.now() - g.at;
    const bar = courseBar();
    const there = ctx.courseId() === g.cid && shown(bar) && !otherCourse(bar, g.cid);
    if (there && dt > 120 && !ctx.holding() && !loading(bar.closest('.panel-wrap, .bb-offcanvas-panel') || document.body)) return end();
    // Ultra (or the student) went somewhere else: nothing to wait for.
    if (!location.pathname.startsWith(`/ultra/courses/${g.cid}/`)) return end(true);
    if (dt > 2500 && !g.hard && !there) {
      g.hard = true;
      // The next page finds its copy (from the worker), as this one would have.
      try { sessionStorage.setItem('gz-ctabs-go', `${g.cid} ${who}`); } catch { /* blocked */ }
      location.assign(location.origin + g.url);
    }
    if (dt > 8000) end();
  };
  const end = (cut) => {
    const g = go;
    go = null;
    clearTimeout(g.timer);
    place();
    if (g.over) { if (cut) g.over.remove(); else fade(g.over); }
    draw();
    if (cut) return;
    if (g.top) scrollBack(g.top);
    if (g.click && [...document.querySelectorAll('a[href]')].some((a) => a.getAttribute('href') === g.click.href && a.textContent.trim() === g.click.text && shown(a))) route(g.click.url);
  };
  // The tab's scroll, put back until it holds; anything the student does first ends it. On the outline with "Your place"
  // on, features/place.js does this (with the open folders).
  const scrollerOf = (el) => {
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll|overlay/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    return document.scrollingElement;
  };
  const scrollBack = (top) => {
    if (/\/outline\/?$/.test(location.pathname) && ctx.settings().enhance.place) return;
    const t0 = Date.now();
    let steady = 0;
    const step = () => {
      const sc = scrollerOf(strip);
      if (!sc || ctx.acted() > t0 || Date.now() - t0 > 2500 || steady >= 3) return;
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
    if (el && !e.button && !e.target.closest('.gz-ctab-x, .gz-ctab-pin')) drag = { el, cid: el.dataset.courseId, x: e.clientX, id: e.pointerId, on: false };
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
  const onHide = () => { if (!on) return; capture(); push(ctx.courseId()); saveNow(); };
  const listen = (yes) => {
    const f = yes ? 'addEventListener' : 'removeEventListener';
    document[f]('scroll', onScroll, { capture: true, passive: true });
    document[f]('click', onLeave, true);
    globalThis[f]('popstate', onLeave, true);
    globalThis[f]('pagehide', onHide);
    try { chrome.storage.onChanged[yes ? 'addListener' : 'removeListener'](onStore); } catch { /* reloaded */ }
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
            go = { cid: pending[0], url, at: performance.now(), top: P().place && tab?.path === url ? tab.top : 0 };
            send({ op: 'get', cid: go.cid }).then((x) => { if (go?.cid === pending[0] && !go.over && x?.snap?.path === go.url) cover(x.snap); });
            tick();
          }
        }));
      });
    }, () => { loaded = true; pass(); }); // no account: this page's list only, kept nowhere
  };
  const pass = () => {
    if (!on) return;
    const cid = here();
    if (cid && !preview && loaded) {
      if (cid !== last || !tabs.some((x) => x.cid === cid)) visitTab(cid);
      notePlace(cid);
    }
    if (cid !== last) {
      if (last && !preview) push(last);
      last = cid;
    }
    lastPath = location.pathname + location.search;
    flag();
    place();
    draw();
    if (cid && !go && !preview) later();
  };
  const sync = (want) => {
    if (signedOut) want = false;
    if (!want) {
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
  return { sync, held, snapshots: () => snaps.size };
})();

GZ_CTABS;
