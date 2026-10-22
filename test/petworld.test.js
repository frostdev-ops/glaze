// features/petworld.js in a VM with a stand-in DOM, virtual time and a seeded random: the loop the pet runs while it is on the page.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const P = require('../lib/pet.js'), { El } = require('./stand-in-dom.js');

const world = ({ record = { earned: { 'work:assignment:1': 20 } }, seed = 1 } = {}) => {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const M = Object.create(Math); M.random = random;
  const doc = { activeElement: null, hidden: false, visibilityState: 'visible', location: { pathname: '/' } }, docEvents = [], winEvents = [], timers = new Map();
  let next = 0, clock = 100000;
  const make = (tag) => new El(tag, doc);
  doc.root = make('html'); doc.head = make('head'); doc.body = make('body'); doc.root.append(doc.head, doc.body);
  Object.assign(doc, { documentElement: doc.root, scrollingElement: doc.root, createElement: make, querySelectorAll: (s) => doc.root.querySelectorAll(s), querySelector: (s) => doc.root.querySelector(s),
    elementsFromPoint: () => [], addEventListener: (type, f) => docEvents.push({ type, f }), removeEventListener: (type, f) => { const i = docEvents.findIndex((x) => x.type === type && x.f === f); if (i >= 0) docEvents.splice(i, 1); } });
  const stage = make('div'); stage.box = { left: 20, top: 20, width: 300, height: 200 }; doc.body.append(stage);
  let reads = 0; const rect = stage.getBoundingClientRect.bind(stage); stage.getBoundingClientRect = () => { reads++; return rect(); };
  const saved = [], data = P.view(record);
  const c = { document: doc, console, Math: M, Date, Object, Array, Number, String, Map, Set, WeakMap, Promise, JSON, Error, RegExp, Infinity, NaN, isFinite, parseFloat,
    GZ_PET: P, GZ_PET_BRAIN: require('../lib/petbrain.js'), GZ_PET_PHYSICS: require('../lib/petphysics.js'),
    GZ_WIDGETS_UI: { avatar: () => ({ play() {}, sleep() {}, wake() {}, stop() {} }) },
    location: { pathname: '/' }, innerWidth: 1000, innerHeight: 700, scrollX: 0, scrollY: 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), MutationObserver: class { observe() {} disconnect() {} },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, getComputedStyle: () => ({}),
    performance: { now: () => clock }, setTimeout: (f, ms) => { timers.set(++next, { f, ms, at: clock + ms }); return next; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (type, f) => winEvents.push({ type, f }), removeEventListener() {},
    chrome: { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://x/${p}` }, storage: { local: { get: (k, cb) => cb({}) }, onChanged: { addListener() {}, removeListener() {} } } } };
  c.window = c; c.globalThis = c; vm.createContext(c);
  const W = vm.runInContext(fs.readFileSync(require.resolve('../features/petworld.js'), 'utf8'), c);
  const key = 'pet:https://x.test/1';
  W.mount(stage, { key, data, t: (k) => k, save: async (patch) => { saved.push(patch); return { ok: true, data }; } });
  const actor = stage.children.find((e) => e.className === 'gz-game-actor');
  // Run the page's timers in order until `until` says stop; each fire moves the clock to the timer's time.
  const run = (ms, each = () => {}) => {
    const end = clock + ms; let fires = 0;
    while (timers.size) {
      const [id, t] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (t.at > end) break;
      timers.delete(id); clock = Math.max(clock, t.at); fires++; t.f(); each(fires);
    }
    clock = Math.max(clock, end);
    return fires;
  };
  const scroll = () => { for (const l of winEvents.filter((e) => e.type === 'scroll')) l.f({ type: 'scroll', target: doc.root }); };
  const pointer = (x, y) => { for (const l of docEvents.filter((e) => e.type === 'pointermove')) l.f({ type: 'pointermove', isTrusted: true, clientX: x, clientY: y, pointerId: 1, target: { closest: () => null, ownerDocument: doc }, preventDefault() {} }); };
  return { W, stage, actor, run, pointer, scroll, timers, saved, reads: () => reads, resetReads: () => { reads = 0; }, now: () => clock, doc };
};

test('the pet world runs at frame rate while the pointer is about and the pet is not at rest', () => {
  const w = world();
  assert.ok(w.actor, 'the actor is on the stage');
  let fires = 0;
  for (let i = 0; i < 4; i++) { w.pointer(500 + i, 500); fires += w.run(500); }
  assert.ok(fires >= 50, `about 30 ticks a second, got ${fires} in two seconds`);
});

// WID-12
const untilRest = (w) => {
  const stop = new Error('rest');
  try { w.run(600000, () => { if (w.actor.dataset.intent === 'rest') throw stop; }); } catch (e) { if (e === stop) return true; throw e; }
  return false;
};
test('WID-12: a pet that is asleep does not run a 30 Hz loop with layout reads', () => {
  const w = world();
  assert.ok(untilRest(w), 'the pet falls asleep within ten virtual minutes');
  w.run(3000); // it settles on the floor
  w.resetReads();
  const fires = w.run(30000);
  assert.ok(fires <= 60, `a sleeping pet is looked at about once a second, not ${fires} times in 30 s`);
  assert.ok(w.reads() <= 120, `and reads the layout rarely: ${w.reads()}`);
});
test('WID-12: it is looked at faster again as soon as the pointer moves, and wakes for its next choice', () => {
  const w = world();
  assert.ok(untilRest(w)); w.run(3000);
  w.run(10000);
  const before = [...w.timers.values()].pop().ms;
  assert.ok(before > 100, `resting: next look in ${before} ms`);
  w.pointer(500, 500);
  assert.ok([...w.timers.values()].pop().ms <= 34, 'the pointer brings back the frame loop');
  w.run(3000);
  // It still makes its next choice when the rest is over (45 to 120 s).
  let changed = false;
  w.run(130000, () => { if (w.actor.dataset.intent !== 'rest') changed = true; });
  assert.ok(changed, 'the pet does something else after its rest');
});
test('WID-12: a scroll brings a resting pet back to the frame loop', () => {
  const w = world();
  assert.ok(untilRest(w)); w.run(10000);
  assert.ok([...w.timers.values()].pop().ms > 100);
  w.scroll();
  assert.ok([...w.timers.values()].pop().ms <= 34);
});
