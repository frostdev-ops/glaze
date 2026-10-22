// The site's part of the first content script (B0b), as a page boots: the real libraries, defaults.js and content.js in a
// VM with an inert page and browser. A page whose list lacks its part (a host registered for Moodle that now serves
// Canvas) asks the worker for it; the theme must not wait for that answer, only the sweep and the extras may.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const FIRST = ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js'];
const HEAD = { ultra: 'base[href*="/ultra/"]', canvas: 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]' };

// An element that takes whatever content.js does to it and answers "nothing here".
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.kids = []; this.dataset = {}; this.childNodes = []; this.children = [];
    const props = new Map();
    this.style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '', length: 0 };
    this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  toggleAttribute(k, on) { if (on) this.attrs.set(k, ''); else this.attrs.delete(k); }
  getAttributeNames() { return [...this.attrs.keys()]; }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches() { return false; }
  contains() { return false; }
  append(...n) { this.kids.push(...n); }
  appendChild(n) { this.kids.push(n); return n; }
  before() {}
  after() {}
  remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  getClientRects() { return []; }
}

const page = ({ site, preload, answer, raw = {}, local: own = {}, pathname }) => {
  const sent = [], held = [], swept = [], storeListeners = [];
  // An Ultra site the student said yes to (lib/background.js approved): school.test is no Blackboard host of its own.
  const local = { [site]: [site === 'ultra' ? 'https://school.test' : 'https://school.test/*'], ...own };
  const html = new El('html');
  html.lang = 'en';
  const head = new El('head');
  head.querySelector = (sel) => (sel.includes(HEAD[site]) ? { matches: (s) => s === HEAD[site] } : null);
  const body = new El('body');
  const document = {
    contentType: 'text/html', documentElement: html, head, body, readyState: 'interactive', hidden: false,
    // Canvas's wrapper: what isCanvas() asks for.
    querySelector: (sel) => (sel === '#application.ic-app' ? body : null),
    querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [],
    createElement: (tag) => new El(tag), createElementNS: (_, tag) => new El(tag), createTextNode: () => new El('#text'),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener() {}, removeEventListener() {}, fonts: { load: () => Promise.resolve([]), add() {} },
  };
  const area = () => ({
    get: (keys, cb) => (cb ? cb(structuredClone(local)) : Promise.resolve(structuredClone(local))),
    set: (o, cb) => { cb?.(); return Promise.resolve(); },
    remove: (k, cb) => { cb?.(); return Promise.resolve(); },
  });
  const c = vm.createContext({
    document, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto,
    location: { protocol: 'https:', origin: 'https://school.test', pathname: pathname || (site === 'ultra' ? '/ultra/course' : '/'), href: 'https://school.test/', search: '', hash: '' },
    navigator: { language: 'en' }, Element: El, HTMLElement: El, SVGElement: class {}, Node: El, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ getPropertyValue: () => '', color: '', backgroundColor: '' }), CSS: { supports: () => false },
    matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class { constructor(f) { this.f = f; } observe(target) { if (target === body) swept.push(target); } disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    // Timers are left unrun: the boot is what is checked, not the throttled passes after it.
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => 0 }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerHeight: 900, innerWidth: 1400,
    fetch: () => Promise.resolve({ ok: true, url: 'https://school.test/', text: () => Promise.resolve('[]'), json: () => Promise.resolve([]), headers: { get: () => null } }),
    chrome: {
      runtime: {
        id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, lastError: undefined,
        sendMessage: (m) => {
          sent.push(m);
          if (m?.files?.includes(`content-${site}.js`)) {
            if (answer === 'held') return new Promise((resolve) => held.push(resolve));
            return Promise.resolve({ ok: false, error: 'not loadable' });
          }
          return Promise.resolve({ ok: false, error: 'not in this test' });
        },
      },
      storage: { sync: { get: (k, cb) => cb(raw) }, local: area(), onChanged: { addListener: (f) => storeListeners.push(f) } },
    },
  });
  c.window = c; c.top = c; c.globalThis = c;
  for (const f of FIRST) vm.runInContext(read(f), c, { filename: f });
  const loadPart = () => {
    // Ultra's initial list and the worker fallback both put its schema before its part.
    if (site === 'ultra') vm.runInContext(read('lib/nav.js'), c, { filename: 'lib/nav.js' });
    vm.runInContext(read(`content-${site}.js`), c);
  };
  if (preload) loadPart();
  const done = vm.runInContext(read('content.js'), c, { filename: 'content.js' });
  const sheets = () => head.kids.map((l) => String(l.href || '').split('/').pop()).filter((f) => f.endsWith('.css'));
  // The part's file arriving, as lib/background.js would put it in, then the worker's answer.
  const arrive = () => { loadPart(); held.shift()({ ok: true }); };
  return { c, html, sent, held, swept, sheets, done, arrive, storeListeners, asked: () => sent.filter((m) => m?.files?.includes(`content-${site}.js`)).length };
};

const noUnhandled = async (run) => {
  let unhandled = [];
  const count = (e) => { unhandled.push(String(e?.stack || e)); };
  process.on('unhandledRejection', count);
  try { await run(); await settle(); } finally { process.off('unhandledRejection', count); }
  assert.deepEqual(unhandled, [], 'no unhandled rejection');
};

const SHEETS = { canvas: ['canvas.css', 'motion.css', 'apps.css', 'coursetabs.css', 'sidebar.css', 'surfaces.css'], ultra: ['theme.css', 'motion.css', 'extras.css', 'apps.css', 'coursetabs.css', 'sidebar.css', 'surfaces.css'] };
// Canvas's part draws its sidebar's attributes (paintNav); Ultra's has nothing on <html> of its own, so its
// gradebook helper, asked through GZ_CTX, is what shows it is in.
const partOn = (p, site) => (site === 'canvas' ? p.html.hasAttribute('data-gz-nav-labels') : typeof p.c.GZ_CTX.bookFor('_1_1') === 'object');

test('Ultra arriving after the initial settings answer recovers saved nav appearance with its schema', () => noUnhandled(async () => {
  const p = page({ site: 'ultra', preload: false, answer: 'held', raw: { nav: { brand: 'school', detailed: true, width: 280, gap: 7 } } });
  await settle();
  p.arrive();
  await settle();
  assert.equal(p.html.getAttribute('data-gz-nav-brand'), 'school');
  assert.equal(p.html.style.getPropertyValue('--gz-nav-width'), '280px');
  assert.equal(p.html.style.getPropertyValue('--gz-nav-gap'), '7px');
  assert.equal(p.c.GZ_CTX.settings().nav.width, 280);
}));

for (const site of ['canvas', 'ultra']) {
  test(`${site}: its part preloaded, as on its own pages: the theme, the context and the sweep, nothing asked`, () => noUnhandled(async () => {
    const p = page({ site, preload: true });
    await settle();
    assert.deepEqual(p.sheets(), SHEETS[site]);
    assert.equal(p.asked(), 0);
    assert.equal(p.swept.length, 1, 'the sweep started');
    assert.ok(partOn(p, site));
    // On a site the student approved, nothing is reported or asked: only the student's yes approves one (WP-C2).
    assert.equal(p.sent.filter((m) => m === 'ultra' || m?.type === 'glaze:ultra').length, 0);
  }));

  test(`${site}: a page without its part keeps the theme while the part is asked for, and sweeps once it is in`, () => noUnhandled(async () => {
    const p = page({ site, preload: false, answer: 'held' });
    await settle();
    assert.equal(p.asked(), 1, 'asked once');
    assert.equal(p.held.length, 1, 'the answer is held');
    // While it is held: the stylesheets (Canvas's hold the first paint), the settings on <html> and the helpers are there.
    assert.deepEqual(p.sheets(), SHEETS[site], 'the theme does not wait for the part');
    assert.ok(p.html.hasAttribute('data-gz-dark-theme') && p.html.style.getPropertyValue('--gz-surface'), 'the palette is painted');
    assert.equal(typeof p.c.GZ_CTX?.need, 'function', 'GZ_CTX is there for files that load meanwhile');
    assert.equal(p.swept.length, 0, 'the sweep and the extras wait for the part');
    if (site === 'canvas') assert.ok(!partOn(p, site));
    p.arrive();
    await settle();
    assert.equal(p.swept.length, 1, 'the sweep starts once the part is in');
    assert.ok(partOn(p, site), 'and the part is worn');
    assert.deepEqual(p.sheets(), SHEETS[site], 'the same sheets, once');
  }));

  test(`${site}: a part that can't be had leaves the theme on and sweeps without it`, () => noUnhandled(async () => {
    const p = page({ site, preload: false, answer: 'fail' });
    await settle();
    assert.equal(p.asked(), 1);
    assert.deepEqual(p.sheets(), SHEETS[site]);
    assert.equal(p.swept.length, 1, 'the sweep starts with what is shared');
    assert.throws(() => p.c.GZ_CTX.bookFor('_1_1'), (e) => e.name === 'TypeError', 'the part\'s own helpers are not there');
  }));
}


test('default Dashboard alone does not load widgets on course routes; an explicitly saved global float does', () => noUnhandled(async () => {
  const opts = { site: 'ultra', preload: true, pathname: '/ultra/courses/_1_1/outline', raw: { enhance: { notes: false, widgets: false, pet: false, sidebar: false } } };
  const asks = (p) => p.sent.filter((m) => m?.files?.includes('features/widgets.js')).length;
  const p = page(opts);
  await settle();
  assert.equal(asks(p), 0, 'no global tiles: retain lazy cost');
  // With the sidebar (on by default), Better To Do's dock is drawn by the widgets, so they load for it.
  const s = page({ ...opts, raw: { enhance: { notes: false, widgets: false, pet: false } } });
  await settle();
  assert.equal(asks(s), 1, 'the sidebar\'s To Do: the widgets load for the dock');
  const q = page({ ...opts, local: { widgetLayout: { boards: { pages: [{ id: 'timer', on: true }] } } } });
  await settle();
  assert.equal(asks(q), 1, 'saved global tile: load its UI with legacy Widgets off');
  const r = page(opts);
  await settle();
  for (const f of r.storeListeners) f({ widgetLayout: { newValue: { boards: { pages: [{ id: 'timer', on: true }] } } } }, 'local');
  await settle();
  assert.equal(asks(r), 1, 'a float enabled in another tab becomes available');
}));

test('Ultra course cards peek at existing promises and books without starting a reader', async () => {
  const p = page({ site: 'ultra', preload: true, raw: { enabled: false } });
  await p.done;
  let requests = 0;
  p.c.fetch = async (u) => { requests++; return { ok: true, url: u, text: async () => JSON.stringify(u.endsWith('/users/me') ? { id: '_900_1' } : { results: [] }), headers: { get: () => null } }; };
  const cold = p.c.GZ_CTX.canvasPeek();
  for (let i = 0; i < 10; i++) { const next = p.c.GZ_CTX.canvasPeek(); assert.equal(next.me, cold.me); assert.equal(next.courses, cold.courses); assert.equal(next.books, cold.books); }
  assert.equal(requests, 0, 'peeking starts nothing, even if the boot already has a pending reader');
  const me = p.c.GZ_CTX.me(), courses = p.c.GZ_CTX.myCourses(), book = p.c.GZ_CTX.bookFor('_101_1');
  await Promise.all([me, courses, book.pending]);
  const count = requests, warm = p.c.GZ_CTX.canvasPeek();
  assert.equal(warm.me, me); assert.equal(warm.courses, courses); assert.equal(warm.books.get('_101_1'), book);
  assert.equal(p.c.GZ_CTX.canvasPeek().books, warm.books); assert.equal(requests, count);
});

test('an existing Ultra grade request refreshes mounted course cards when it finishes without native DOM', async () => {
  const p = page({ site: 'ultra', preload: true, raw: { enabled: false }, pathname: '/ultra/institution-page' });
  await p.done;
  let updates = 0, requests = 0, finish, observed;
  p.c.GZ_COURSE_CARDS = { sync: () => { updates++; observed = p.c.GZ_CTX.canvasPeek().books.get('_101_1').overall?.label; } };
  p.c.fetch = async (u) => {
    requests++;
    const profile = u.endsWith('/users/me');
    if (!profile) await new Promise((r) => { finish = r; });
    return { ok: true, url: u, text: async () => JSON.stringify(profile ? { id: '_900_1' } : { results: [{ columnId: '_5_1', effectiveScore: 87, pointsPossible: 100, displayGrade: { text: '87%' }, column: { externalGrade: true } }] }), headers: { get: () => null } };
  };
  const book = p.c.GZ_CTX.bookFor('_101_1');
  await settle();
  assert.equal(book.pending, true); assert.equal(updates, 0);
  finish(); await settle();
  assert.equal(book.pending, false);
  assert.equal(updates, 1, 'the existing grade reader wakes cached board cards');
  assert.equal(observed, '87%', 'the cache is ready before the callback');
  assert.equal(requests, 2, 'only the existing profile and grade requests');
});
