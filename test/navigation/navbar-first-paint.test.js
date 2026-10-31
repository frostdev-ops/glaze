// Glaze's bar on Ultra at first paint and on a route change (perf step 1b): the bar as this tab last drew it is kept for the
// next page (navigation/page/navbar.js keep), checked (navigation/nav.js kept) and drawn from (nav.js paint); a route change
// only moves the marks, on the same nodes; a flush with nothing changed builds nothing. The real Ultra adapter and renderer
// run in the stand-in DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El, matches } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const G = require('../../extension/content/defaults.js'), M = require('../../extension/navigation/navbar.js');
const L = require('../../extension/navigation/navlayout.js'), N = require('../../extension/navigation/nav-items.js');
const NAV = require('../../extension/navigation/nav.js');
const read = (file) => fs.readFileSync(require.resolve(`../../extension/${file}`), 'utf8');
const origin = 'https://bb.school.test';
const tick = () => new Promise((r) => setImmediate(r));

class NavEl extends El {
  get localName() { return this.tagName.toLowerCase(); }
  get ownerDocument() { return this.doc; }
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.filter((e) => e instanceof El).length; }
  get classList() { return Object.assign(this.className.split(/\s+/).filter(Boolean), { contains: (c) => this.className.split(/\s+/).includes(c) }); }
  get dir() { return this.getAttribute('dir') || ''; }
  set dir(v) { this.setAttribute('dir', v); }
  get href() { const h = this.getAttribute('href'); return h == null ? '' : new URL(h, this.doc.location.href).href; }
  set href(v) { this.setAttribute('href', v); }
  get pathname() { return this.href && new URL(this.href).pathname; }
  get offsetTop() { return this.box?.top || 0; }
  get offsetLeft() { return this.box?.left || 0; }
  get part() { const names = () => (this.getAttribute('part') || '').split(' ').filter(Boolean); return { toggle: (n, on) => this.setAttribute('part', [...names().filter((x) => x !== n), ...(on ? [n] : [])].join(' ')), contains: (n) => names().includes(n) }; }
  get isConnected() { let p = this; while (p.parentNode || p.host) p = p.parentNode || p.host; return p === this.doc.root; }
  getAttributeNames() {
    return [...(this.id ? ['id'] : []), ...(this.className ? ['class'] : []), ...(this.hidden ? ['hidden'] : []),
      ...Object.keys(this.dataset).map((k) => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`), ...Object.keys(this.attrs)];
  }
  matches(selector) {
    return selector.split(',').some((s) => {
      const excluded = [...s.matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1]);
      const includes = [...s.matchAll(/\[([\w-]+)\*="([^"]*)"\]/g)];
      const simple = s.replace(/:not\([^)]+\)/g, '').replace(/\[([\w-]+)\*="[^"]*"\]/g, '[$1]').trim();
      return /^[^:]*$/.test(simple) && matches(this, simple) && excluded.every((x) => !matches(this, x)) && includes.every(([, k, v]) => this.getAttribute(k)?.includes(v));
    });
  }
  querySelectorAll(selector) { return this.all().filter((e) => e.matches(selector)); }
  closest(selector) { for (let p = this; p?.tagName; p = p.parentNode) if (p.matches(selector)) return p; return null; }
  getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }
  attachShadow() { const r = new NavEl('shadow-root', this.doc); r.host = this; Object.defineProperty(r, 'activeElement', { get: () => null }); this.shadowRoot = r; return r; }
  focus() { this.doc.focused = this; }
  click() { this.clicks = (this.clicks || 0) + 1; }
}
const upgrade = (e) => { Object.setPrototypeOf(e, NavEl.prototype); for (const c of e.children) if (c instanceof El) upgrade(c); return e; };

const ITEMS = [['institution-page', 'Institution Page'], ['stream', 'Activity Stream'], ['course', 'Courses'], ['calendar', 'Calendar'], ['grades', 'Grades']];

// An Ultra page with its drawer, Glaze's bar on (an open rail at 1440 px), the account _42_1, this tab's sessionStorage.
function setup({ path = '/ultra/course', store = new Map(), account = () => Promise.resolve('_42_1'), navbar = {}, before } = {}) {
  const document = { location: new URL(path, origin), focused: null, visibilityState: 'visible', referrer: '', addEventListener() {}, removeEventListener() {} };
  document.root = document.documentElement = new NavEl('html', document);
  document.body = new NavEl('body', document); document.root.append(document.body);
  document.createElement = (tag) => new NavEl(tag, document);
  document.createElementNS = (_, tag) => new NavEl(tag, document);
  document.querySelector = (s) => document.root.querySelector(s);
  document.querySelectorAll = (s) => document.root.querySelectorAll(s);
  document.getElementById = (id) => document.root.querySelector(`#${id}`);
  document.createTreeWalker = (el) => { let next = true; return { nextNode: () => (next ? (next = false, { data: el.textContent }) : null) }; };
  const paper = document.createElement('div'); paper.className = 'MuiPaper-root MuiDrawer-paper';
  const nav = document.createElement('nav'); nav.className = 'makeStylesnavigation-0-2-5';
  for (const [id, label] of [...ITEMS, ['#', 'Sign Out']]) { const a = document.createElement('a'); a.href = id === '#' ? '#' : `/ultra/${id}`; a.textContent = label; nav.append(a); }
  paper.append(nav); document.body.append(paper);
  const route = (to) => {
    document.location.pathname = to;
    for (const a of nav.querySelectorAll('a')) a.className = a.getAttribute('href') === to ? 'Mui-selected' : '';
  };
  route(document.location.pathname);
  const settings = G.GZ_SANITIZE({ navbar: { on: true, ...navbar }, enhance: { tabs: false, dashboard: true } });
  const observers = [], animation = new Map(), events = {}, changes = [];
  let serial = 0, builds = 0;
  class MO { constructor(fn) { this.fn = fn; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } }
  const window = {}; window.top = window;
  const sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const context = vm.createContext({ document, location: document.location, window, URL, sessionStorage, innerWidth: 1440, innerHeight: 900,
    GZ_NAVBAR: { ...M, build: (...a) => (builds++, M.build(...a)) }, GZ_NAV_LAYOUT: L, GZ_NAV_ITEMS: N, GZ_NAV: NAV,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 }, MutationObserver: MO, CSS: { escape: (s) => s }, getComputedStyle: () => ({}),
    matchMedia: (q) => ({ matches: q === '(min-width: 900px)' ? context.innerWidth >= 900 : true }),
    requestAnimationFrame: (fn) => { animation.set(++serial, fn); return serial; }, cancelAnimationFrame: (id) => animation.delete(id),
    setTimeout: () => ++serial, clearTimeout() {}, addEventListener: (name, fn) => { events[name] = fn; },
    chrome: { runtime: { id: 'glaze', getURL: (s) => `chrome-extension://glaze/${s}` },
      storage: { sync: { get: (_, cb) => cb({ navbarItems: { glaze: [] } }) }, local: { get: (_, cb) => cb({}), set() {} }, onChanged: { addListener() {} } } },
    GZ_CTX: { site: 'ultra', t: (s) => s, settings: () => settings, on: () => true, parts: () => null, locale: () => 'en', account,
      setVar: (k, v) => document.documentElement.style.setProperty(k, v), need: () => Promise.reject(new Error('lazy')) } });
  before?.(document, context);
  vm.runInContext(read('navigation/page/navbar.js') + '\nglobalThis.GZ_NAVBAR_UI = GZ_NAVBAR_UI;', context);
  const ui = context.GZ_NAVBAR_UI;
  ui.on('change', (v) => changes.push(v));
  ui.sync();
  const host = document.getElementById('gz-navbar'), root = host?.shadowRoot;
  root?.querySelector('link').dispatchEvent({ type: 'load' });
  return { ui, document, host, root, settings, store, events, changes, route, nav, context,
    builds: () => builds, frame: () => { for (const [id, fn] of [...animation]) { animation.delete(id); fn(); } },
    mutate: () => { for (const o of observers) if (o.on) o.fn([]); },
    item: (id) => root.querySelector(`.rail .list [data-id="${id}"]`) };
}

test('the compared shape leaves out where the student is; a change to the items is still a change', () => {
  const native = (active) => ITEMS.map(([id, label]) => ({ id, label, href: `${origin}/ultra/${id}`, active: id === active }));
  const a = M.build({ native: native('course') }), b = M.build({ native: native('calendar') });
  const rows = (cur) => ['_1_1', '_2_1'].map((cid) => ({ cid, label: cid, full: cid, cur: cid === cur, pin: false, color: '' }));
  assert.equal(M.shape([a, rows('_1_1')]), M.shape([b, rows('_2_1')]), 'only the active item and the shown course tab differ');
  assert.notEqual(M.marks(a, rows('_1_1')), M.marks(b, rows('_1_1')));
  assert.notEqual(M.marks(a, rows('_1_1')), M.marks(a, rows('_2_1')));
  assert.equal(M.marks(a, rows('_1_1')), M.marks(M.build({ native: native('course') }), rows('_1_1')));
  const renamed = native('course'); renamed[3].label = 'Schedule';
  assert.notEqual(M.shape([a]), M.shape([M.build({ native: renamed })]), 'a renamed item draws the bar again');
  const badged = native('course'); badged[4].badge = '2';
  assert.notEqual(M.shape([a]), M.shape([M.build({ native: badged })]), 'a badge draws the bar again');
});

test('a route change moves the marks on the same nodes; only a change to the items draws them again', () => {
  const h = setup();
  const course = h.item('course'), calendar = h.item('calendar'), list = h.root.querySelector('.rail .list');
  assert.equal(course.getAttribute('aria-current'), 'page');
  assert.equal(h.changes.length, 1);
  h.route('/ultra/calendar'); h.ui.sync();
  assert.equal(h.item('calendar'), calendar, 'the calendar item is the same node');
  assert.equal(h.item('course'), course, 'the courses item is the same node');
  assert.equal(calendar.getAttribute('aria-current'), 'page');
  assert.equal(calendar.getAttribute('part'), 'item active');
  assert.equal(course.getAttribute('aria-current'), null);
  assert.equal(course.getAttribute('part'), 'item');
  assert.equal(h.changes.length, 2, 'readers hear the move');
  assert.equal(h.changes.at(-1).active, 'calendar');
  assert.equal(h.root.querySelector('.out').getAttribute('aria-current'), null, 'Sign out is never where the student is');
  // The marker moves in the next frame, with the page's own layout, not forced in the flush.
  calendar.box = { left: 0, top: 120, width: 200, height: 44 };
  const ind = h.root.querySelector('.rail .ind');
  assert.notEqual(ind.style.getPropertyValue('--y'), '120px');
  h.frame();
  assert.equal(ind.style.getPropertyValue('--y'), '120px');
  assert.equal(ind.hidden, false);
  // A renamed item (Ultra redrew its drawer): drawn again.
  h.nav.querySelectorAll('a')[1].textContent = 'Activity'; h.mutate(); h.ui.sync();
  assert.notEqual(h.item('calendar'), calendar, 'drawn again');
  assert.equal(h.item('stream').textContent.includes('Activity'), true);
  assert.equal(list.isConnected, true);
});

test('a flush with nothing changed reads the drawer from its last read and builds nothing', () => {
  const h = setup();
  const builds = h.builds(), course = h.item('course');
  for (let i = 0; i < 5; i++) h.ui.sync();
  assert.equal(h.builds(), builds, 'no model built');
  assert.equal(h.changes.length, 1, 'nothing heard');
  assert.equal(h.item('course'), course);
  // Ultra's drawer changing (a badge) is heard by its observer, and read again.
  const badge = h.document.createElement('span'); badge.className = 'MuiBadge-badge'; badge.textContent = '3';
  h.nav.querySelectorAll('a')[4].append(badge); h.ui.sync();
  assert.equal(h.item('grades').querySelector('.badge'), null, 'unheard, the last read stands');
  h.mutate(); h.ui.sync();
  assert.equal(h.item('grades').querySelector('.badge')?.textContent, '3');
  assert.equal(h.builds(), builds + 1);
});

test('the bar as drawn is kept for the next page, and that page draws it with where the student is now', async () => {
  const h = setup();
  await tick();
  h.events.pagehide();
  const raw = h.store.get('gz-navbar');
  assert.ok(raw, 'kept');
  const s = JSON.parse(raw);
  assert.equal(s.u, '_42_1');
  assert.equal(s.w, 'rail auto float');
  assert.equal(s.v, '1440x900');
  assert.equal(s.k, NAV.key(h.settings));
  assert.deepEqual(s.a, [['dir', 'ltr'], ['data-place', 'rail'], ['data-style', 'float'], ['data-motion', '']]);
  const at = { words: 'rail auto float', key: NAV.key(h.settings), size: '1440x900', now: s.t + 1000, from: '', origin };
  assert.deepEqual(NAV.kept(raw, at), s, 'the next page takes it');
  assert.ok(/^<nav [^>]*data-open=""/.test(s.m), 'the rail as pinned, never as peeked');
  assert.ok(!/data-peek/.test(s.m));
  // Parsed and painted on the next page, at Grades, with what a page's own script might have slipped in.
  const doc = { location: new URL(`${origin}/ultra/grades`) };
  doc.root = new El('html', doc);
  const body = upgrade(parse(`<body>${s.m.replace('</nav>', '<img src="x" onerror="alert(1)"><script>alert(1)</script><a class="item" data-id="evil" href="javascript:alert(1)" onclick="alert(1)">x</a></nav>')}</body>`, doc));
  NAV.paint(body, '/ultra/grades');
  const items = body.querySelectorAll('.list .item[data-id]');
  assert.deepEqual(items.map((e) => e.dataset.id), ['institution-page', 'stream', 'course', 'calendar', 'grades']);
  assert.deepEqual(items.map((e) => e.getAttribute('aria-current')), [null, null, null, null, 'page']);
  assert.equal(items[4].getAttribute('part'), 'item active');
  assert.equal(items[2].getAttribute('part'), 'item');
  assert.equal(body.querySelector('script'), null);
  assert.equal(body.querySelector('img[onerror]'), null);
  const evil = body.querySelector('[data-id="evil"]');
  assert.equal(evil.getAttribute('href'), null, 'no address but the school\'s https');
  assert.equal(evil.getAttribute('onclick'), null, 'no handlers');
  assert.equal(body.querySelector('.list [data-id="course"]').getAttribute('href'), `${origin}/ultra/course`);
  // In a course, Courses is where the student is.
  NAV.paint(body, '/ultra/courses/_101_1/outline');
  assert.equal(body.querySelector('.list [data-id="course"]').getAttribute('aria-current'), 'page');
  assert.equal(body.querySelector('.list [data-id="grades"]').getAttribute('aria-current'), null);
});

test('what was kept is drawn only for this tab\'s same settings and window, from Ultra, for ten minutes', () => {
  const s = { u: '_42_1', t: 1000, w: 'rail auto float', k: NAV.key(G.GZ_SANITIZE({})), v: '1440x900', a: [], m: '<nav class="rail"></nav>' };
  const at = { words: s.w, key: s.k, size: s.v, now: 2000, from: `${origin}/ultra/course`, origin };
  const raw = JSON.stringify(s);
  assert.deepEqual(NAV.kept(raw, at), s);
  assert.deepEqual(NAV.kept(raw, { ...at, from: '' }), s, 'a reload or a typed address');
  for (const [why, change] of [['another shape (a top bar)', { words: 'top float' }], ['another brand', { key: NAV.key(G.GZ_SANITIZE({ navbar: { brand: 'school' } })) }],
    ['badges off', { key: NAV.key(G.GZ_SANITIZE({ navbar: { badges: false } })) }], ['another logo', { key: NAV.key(G.GZ_SANITIZE({ nav: { li: 'bbbbbbbbbbbb' } })) }],
    ['another window', { size: '1280x800' }], ['ten minutes on', { now: 1000 + 6e5 }], ['after signing in (the sign-in page led here)', { from: `${origin}/webapps/login/` }],
    ['after a school sign-in elsewhere', { from: 'https://idp.school.test/' }], ['another school', { from: 'https://other.test/ultra/course' }]]) assert.equal(NAV.kept(raw, { ...at, ...change }), null, why);
  assert.equal(NAV.kept(null, at), null);
  assert.equal(NAV.kept(JSON.stringify({ ...s, m: 1 }), at), null);
  assert.throws(() => NAV.kept('{', at));
});

test('nothing is kept once the account signs out, for an unknown account, or for another one', async () => {
  const out = setup();
  await tick();
  out.ui.go('logout');
  out.events.pagehide();
  assert.equal(out.store.has('gz-navbar'), false, 'signed out');
  const unknown = setup({ account: () => Promise.reject(new Error('401')) });
  await tick();
  unknown.events.pagehide();
  assert.equal(unknown.store.has('gz-navbar'), false, 'no account known');
  const store = new Map([['gz-navbar', JSON.stringify({ u: '_7_1', m: '' })]]);
  setup({ store });
  await tick();
  assert.equal(store.has('gz-navbar'), false, "another account's copy goes once this one is known");
});

test('the bar takes over its first-paint copy: the same host and sheet, its copy gone, in use again', () => {
  let copy, sheet, old;
  const h = setup({ before: (document) => {
    copy = document.createElement('div'); copy.id = 'gz-navbar'; copy.dataset.first = ''; copy.inert = true;
    const r = copy.attachShadow({ mode: 'open' });
    sheet = document.createElement('link'); sheet.sheet = {};
    old = document.createElement('nav'); old.className = 'rail';
    r.append(sheet, old); document.root.prepend(copy);
  } });
  assert.equal(h.host, copy);
  assert.equal(h.host.hasAttribute('data-first'), false);
  assert.equal(h.host.inert, false);
  assert.equal(h.host.hidden, false, 'its sheet is in already');
  assert.equal(h.root.children[0], sheet);
  assert.equal(old.isConnected, false);
  assert.equal(h.root.querySelectorAll('nav.rail').length, 1);
  assert.equal(h.document.querySelectorAll('#gz-navbar').length, 1, 'one bar, one set of focus targets');
  assert.equal(h.item('course').getAttribute('aria-current'), 'page');
});

test('a first-paint copy goes when the bar turns out to be off', () => {
  let copy;
  const h = setup({ navbar: { on: false }, before: (document) => {
    copy = document.createElement('div'); copy.id = 'gz-navbar'; copy.dataset.first = ''; copy.attachShadow({ mode: 'open' }); document.root.prepend(copy);
  } });
  assert.equal(h.host, null);
  assert.equal(copy.isConnected, false);
});
