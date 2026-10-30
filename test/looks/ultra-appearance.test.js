const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const root = process.env.GZ_B6_REPO || path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.kids = []; this.dataset = {}; this.childNodes = []; this.children = []; this.nodeType = 1;
    const props = new Map(); this.style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '', length: 0 };
    this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} }; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); } toggleAttribute(k, on) { if (on) this.attrs.set(k, ''); else this.attrs.delete(k); }
  getAttributeNames() { return [...this.attrs.keys()]; } addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; } matches() { return false; } contains() { return false; }
  append(...n) { this.kids.push(...n); } appendChild(n) { this.kids.push(n); return n; } before() {} after() {} remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; } getClientRects() { return []; }
}
test('ordinary Ultra mutation flushes refresh late cards and replacement navigation', async () => {
  const timers = []; let mo = null;
  const html = new El('html'); html.lang = 'en';
  const head = new El('head'); head.querySelector = (sel) => (sel.includes('base[href*="/ultra/"]') ? { matches: () => true } : null);
  const body = new El('body'); body.contains = () => true;
  const document = { contentType: 'text/html', documentElement: html, head, body, readyState: 'interactive', hidden: false,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [],
    createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: () => new El('#text'),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener() {}, removeEventListener() {}, fonts: { load: () => Promise.resolve([]), add() {} } };
  // school.test: an Ultra site the student said yes to (lib/background.js approved).
  const area = () => ({ get: (k, cb) => (cb ? cb({ ultra: ['https://school.test'] }) : Promise.resolve({})), set: (o, cb) => { cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } });
  const location = { protocol: 'https:', origin: 'https://school.test', pathname: '/ultra/stream', href: 'https://school.test/ultra/stream', search: '', hash: '' };
  let paints = 0, navs = 0, loads = [];
  const c = vm.createContext({ document, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto, location,
    navigator: { language: 'en' }, Element: El, HTMLElement: El, SVGElement: class {}, Node: El, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ getPropertyValue: () => '', color: '', backgroundColor: '' }), CSS: { supports: () => false },
    matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class { constructor(f) { this.f = f; if (!mo) mo = this; } observe(t) { if (t === body) mo = this; } disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => 0 }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerHeight: 900, innerWidth: 1400,
    fetch: () => Promise.resolve({ ok: true, url: 'https://school.test/', text: () => Promise.resolve('[]'), json: () => Promise.resolve([]), headers: { get: () => null } }),
    chrome: { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, lastError: undefined,
      sendMessage: (m) => { if (m?.type === 'glaze:load') { loads.push(...m.files); if (m.files.includes('features/cards.js')) c.GZ_CARD_UI = { paint: () => { paints++; } }; if (m.files.includes('features/nav.js')) c.GZ_NAV_UI = { sync: () => navs++ }; return Promise.resolve({ ok: true }); } return Promise.resolve({ ok: false }); } },
      storage: { sync: { get: (k, cb) => cb({ nav: { labels: 'icons' }, navbar: { on: false } }) }, local: area(), onChanged: { addListener() {} } } } });
  c.window = c; c.top = c; c.globalThis = c;
  for (const f of ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/nav.js', 'content-ultra.js']) vm.runInContext(read(f), c, { filename: f });
  vm.runInContext(read('content.js'), c, { filename: 'content.js' });
  await settle();
  const runTimers = async () => { while (timers.length) { const t = timers.shift(); if (t.ms <= 1000) t.f(); } await settle(); };
  await runTimers();
  assert.equal(loads.includes('features/cards.js'), false, 'no card code on stream');
  // SPA navigation to Courses: Ultra adds the page (a few subtrees) and later its cards.
  location.pathname = '/ultra/course'; location.href = 'https://school.test/ultra/course';
  const recs = (n) => Array.from({ length: n }, () => ({ type: 'childList', addedNodes: [new El('article')], target: body }));
  mo.f(recs(40)); await runTimers();
  assert.ok(loads.includes('features/cards.js') && paints > 0, 'SPA navigation loads and paints card appearance');
  // Pretend it was loaded (e.g. landed on /ultra/course): new cards rendered later (term filter, load more, re-render).
  if (!c.GZ_CARD_UI) c.GZ_CARD_UI = { paint: () => { paints++; } };
  const before = paints;
  mo.f(recs(12)); await runTimers();
  assert.ok(paints > before, 'late/replaced cards paint on a small mutation pass');
  const beforeNav = navs;
  mo.f(recs(600)); await runTimers();
  assert.ok(paints > before && navs > beforeNav, 'the full pass still refreshes appearance');
  const n = navs; mo.f(recs(1)); await runTimers(); assert.ok(navs > n, 'a replacement drawer refreshes names/tooltips on an ordinary pass');
  const owned = new El('section'), child = new El('span');
  owned.closest = child.closest = () => owned;
  const inside = (target) => ({ type: 'childList', target, addedNodes: [new El('span')], removedNodes: [] });
  const idle = navs;
  mo.f([inside(owned), inside(child), { type: 'attributes', target: child, attributeName: 'style', oldValue: '' }]); await runTimers();
  assert.equal(navs, idle, 'changes inside an owned root or its descendants do not rescan native navigation');
  mo.f([{ type: 'childList', target: body, addedNodes: [], removedNodes: [owned] }]); await runTimers();
  assert.ok(navs > idle, 'native-parent removal of an owned root still runs remount/teardown work');
  const removed = navs;
  mo.f([inside(child), ...recs(1), { type: 'attributes', target: body, attributeName: 'class', oldValue: '' }]); await runTimers();
  assert.ok(navs > removed, 'native additions and attributes survive a mixed owned/native batch');
  delete c.chrome.runtime.id;
  assert.equal(c.GZ_CTX.on(), false, 'reload invalidation is visible before the next core mutation');
});
