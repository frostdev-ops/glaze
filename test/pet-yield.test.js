// The wandering pet and its Return home pill step aside while the site has a panel or dialog open (features/petworld.js puts
// data-gz-yield on <html>; apps.css hides them there, and while Glaze's Settings is over the page). In a browser:
// scripts/ultra-panels-check.js.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const P = require('../lib/pet.js'), { El } = require('./stand-in-dom.js');

test('out wandering, the pet yields to an open site panel within half a second, comes back after, and lets go when it stops', () => {
  const doc = { activeElement: null, hidden: false, visibilityState: 'visible', location: { pathname: '/ultra/stream' } }, timers = new Map();
  let next = 0, clock = 100000, layer = null;
  const make = (tag) => new El(tag, doc);
  doc.root = make('html'); doc.head = make('head'); doc.body = make('body'); doc.root.append(doc.head, doc.body);
  const asked = [];
  Object.assign(doc, { documentElement: doc.root, scrollingElement: doc.root, createElement: make, querySelectorAll: () => [],
    querySelector: (s) => { if (s.includes('.bb-offcanvas-panel')) { asked.push(s); return layer; } return null; },
    elementsFromPoint: () => [], addEventListener() {}, removeEventListener() {} });
  const stage = make('div'); stage.box = { left: 20, top: 20, width: 300, height: 200 }; doc.body.append(stage);
  const c = { document: doc, console, Math, Date, Object, Array, Number, String, Map, Set, WeakMap, Promise, JSON, Error, RegExp, Infinity, NaN, isFinite, parseFloat,
    GZ_PET: P, GZ_PET_BRAIN: require('../lib/petbrain.js'), GZ_PET_PHYSICS: require('../lib/petphysics.js'),
    GZ_WIDGETS_UI: { avatar: () => ({ play() {}, sleep() {}, wake() {}, stop() {} }) },
    location: { pathname: '/ultra/stream' }, innerWidth: 1000, innerHeight: 700, scrollX: 0, scrollY: 0,
    matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }), MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, getComputedStyle: () => ({}),
    performance: { now: () => clock }, setTimeout: (f, ms) => { timers.set(++next, { f, at: clock + ms }); return next; }, clearTimeout: (id) => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
    chrome: { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://x/${p}` }, storage: { local: { get: (k, cb) => cb({}) }, onChanged: { addListener() {}, removeListener() {} } } } };
  c.window = c; c.globalThis = c; vm.createContext(c);
  const W = vm.runInContext(fs.readFileSync(path.join(__dirname, '../features/petworld.js'), 'utf8'), c);
  const run = (ms) => { const end = clock + ms; while (timers.size) { const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at)[0]; if (t.at > end) break; timers.delete(id); clock = Math.max(clock, t.at); t.f(); } clock = Math.max(clock, end); };
  const yielded = () => doc.root.hasAttribute('data-gz-yield');
  // Out wandering, with reduced motion: the pet's own loop rests, the look for open panels doesn't.
  const pet = W.mount(stage, { key: 'pet:https://x.test/1', data: P.view({ wander: true, earned: { 'work:assignment:1': 20 } }), t: (k) => k, save: async () => ({ ok: true }) });
  run(1000);
  assert.ok(doc.body.children.some((e) => e.className === 'gz-game-home'), 'out wandering, with Return home');
  assert.equal(yielded(), false);
  layer = make('div');
  run(500);
  assert.equal(yielded(), true, 'a panel opened: it steps aside');
  layer = null;
  run(500);
  assert.equal(yielded(), false, 'closed: back');
  layer = make('div'); run(500); assert.equal(yielded(), true);
  pet.stop(); W.mount(stage, { key: 'pet:https://x.test/2', data: P.view({ wander: false }), t: (k) => k, save: async () => ({ ok: true }) });
  assert.equal(yielded(), false, 'another pet, at home: nothing held');
  const before = asked.length; run(5000);
  assert.equal(asked.length, before, 'at home it does not look');
  const css = fs.readFileSync(path.join(__dirname, '../features/apps.css'), 'utf8');
  assert.match(css, /html:is\(\[data-gz-yield\],\[data-gz-settings\]\) :is\(\.gz-game-world,\.gz-game-home\)\{visibility:hidden!important\}/);
});
