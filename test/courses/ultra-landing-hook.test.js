// The opt-in landing's hook in content-ultra.js (syncWidgets): a page loaded at Ultra's bare address asks for the landing
// only once Ultra has gone on from it, with that first address. The real content-ultra.js in a VM over a stand-in page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('../stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');

const page = (at, hold = null) => {
  const doc = { activeElement: null, fire() {} };
  doc.root = new El('html', doc);
  const body = new El('body', doc);
  doc.root.append(body);
  const location = { origin: 'https://bb.test', protocol: 'https:', hostname: 'bb.test', port: '', pathname: at, search: '' };
  const landed = [];
  const ctx = vm.createContext({
    document: Object.assign(doc, { documentElement: doc.root, body, querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: () => null, addEventListener() {} }),
    location, console, Promise, Date, setTimeout: () => 1, clearTimeout() {}, queueMicrotask, JSON, Map, Set, Object, Array, String, Number, RegExp, Math, Intl, URL, URLSearchParams,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: { runtime: { id: 'x' }, storage: { local: { get: (k, cb) => cb({}), set() {} }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {} } } },
    GZ_PAGE: require('../../extension/core/page.js'), GZ_COURSES: require('../../extension/content/defaults.js').GZ_COURSES,
  });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.top = ctx;
  vm.runInContext(read('content/content-ultra.js'), ctx);
  // Only the landing's file answers; anything else the pass asks for never comes.
  const need = (file, ready) => {
    if (file === 'courses/page/dashboard.js') { ctx.GZ_DASH_UI = { land: (f) => landed.push(f) }; return hold || Promise.resolve(ready()); }
    return new Promise(() => {});
  };
  const I = { C: {}, html: doc.root, isPreview: false, solo: true, tabFrame: '', need, t: (x) => x, locale: () => 'en', api: () => new Promise(() => {}),
    courseId: () => '', markDue() {}, drawProgress() {}, cardBadge() {}, cardsInView: { observe() {}, unobserve() {} }, inView: new Set(), tagCards() {}, tagExtras() {},
    courseSlots: {}, courseColors: () => ({}), varText: () => '', CARD: 'article', dueLabelled: () => false,
    links: [1], settings: { enabled: true, enhance: { dashboard: true }, nav: { brand: 'x' }, courses: { names: {}, tint: false, tinted: [] }, sidebar: {} },
    observer: {}, worn: { nav: {} }, courseList: {} };
  const X = ctx.GZ_SITE_ULTRA(I);
  const pass = async () => { try { X.syncWidgets(); } catch { /* a part this stand-in lacks */ } for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  return { location, landed, pass };
};

test('loaded at Ultra\'s bare address, the landing is asked for only once Ultra has gone on, with that first address', async () => {
  const p = page('/ultra');
  await p.pass();
  await p.pass();
  assert.deepEqual(p.landed, [], 'still at the bare address');
  p.location.pathname = '/ultra/stream';
  await p.pass();
  await p.pass();
  assert.deepEqual(p.landed, ['/ultra'], 'once, after Ultra went on');
});

test('loaded at Ultra\'s stream, the landing is asked for at the first pass', async () => {
  const p = page('/ultra/stream');
  await p.pass();
  assert.deepEqual(p.landed, ['/ultra/stream']);
});

test('a resolved sign-in deep link cannot become a landing while the Dashboard library loads', async () => {
  let release;
  const p = page('/ultra', new Promise((r) => { release = r; }));
  await p.pass();
  p.location.pathname = '/ultra/calendar';
  await p.pass();
  p.location.pathname = '/ultra/stream';
  release();
  await p.pass();
  assert.deepEqual(p.landed, [], 'the deep link already ended the initial landing opportunity');
});
