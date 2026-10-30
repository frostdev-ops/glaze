// features/petworld.js in a VM with a stand-in DOM, virtual time and a seeded random: the loop the pet runs while it is on the page.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const P = require('../lib/pet.js'), { El } = require('./stand-in-dom.js');

const world = ({ record = { earned: { 'work:assignment:1': 20 } }, seed = 1 } = {}) => {
  let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const M = Object.create(Math); M.random = random;
  const doc = { activeElement: null, hidden: false, visibilityState: 'visible', location: { pathname: '/' } }, docEvents = [], winEvents = [], timers = new Map(), observers = [];
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
    ResizeObserver: class { constructor(f) { this.f = f; this.els = new Set(); observers.push(this); } observe(el) { this.els.add(el); } unobserve(el) { this.els.delete(el); } disconnect() { this.els.clear(); } },
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
  // The stage laid out at a new size, as a tile resized under it: its observers are told, as the browser does.
  const resize = (width, height) => { stage.box = { ...stage.box, width, height }; for (const o of observers) if (o.els.has(stage)) o.f([{ target: stage }]); };
  return { W, stage, actor, run, pointer, scroll, resize, timers, saved, reads: () => reads, resetReads: () => { reads = 0; }, now: () => clock, doc,
    chrome: c.chrome, hide: () => { for (const l of winEvents.filter((e) => e.type === 'pagehide')) l.f(); } };
};

test('the pet world tears down after chrome.storage disappears or its event is invalidated', () => {
  for (const throwing of [false, true]) {
    const w = world();
    if (throwing) w.chrome.storage.onChanged.removeListener = () => { throw Error('Extension context invalidated.'); };
    delete w.chrome.storage;
    assert.doesNotThrow(w.hide);
    assert.equal(w.timers.size, 0);
    assert.equal(w.doc.root.querySelectorAll('.gz-game-world').length, 0);
  }
});

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

// The habitat fills its tile, so its stage is as small as a dock tile or as large as a board slot, and changes size under the pet
// when the tile is resized. The pet and its furniture scale with it and keep their places relative to it, inside it.
const boxOf = (el) => {
  const m = /translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px/.exec(el.style.transform || '');
  const u = Number(el.style['--gz-pet-u'] || 1);
  const w = el.className === 'gz-game-actor' ? 80 * u : parseFloat(el.style.width), h = el.className === 'gz-game-actor' ? 86 * u : parseFloat(el.style.height);
  return m && { x: Number(m[1]), y: Number(m[2]), w, h };
};
test('the habitat follows its stage: resized, it keeps the pet and furniture inside and in their places', () => {
  const placed = { books: { x: 80, y: 92 }, shelf: { x: 25, y: 40 }, ball: { x: 50, y: 94 } };
  const w = world({ record: { earned: { 'work:assignment:1': 20 }, decor: { books: 4, shelf: 4, ball: 4 }, positions: placed } });
  w.resize(300, 200); w.run(3000);
  for (const [width, height] of [[160, 120], [640, 420], [220, 300]]) {
    w.resize(width, height); w.run(3000);
    const parts = w.stage.children.filter((e) => ['gz-game-item', 'gz-game-actor'].includes(e.className));
    assert.equal(parts.length, 4, 'the pet and three pieces');
    for (const el of parts) {
      const b = boxOf(el), name = el.dataset.item || 'the pet';
      assert.ok(b, `${name} is placed`);
      assert.ok(b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= width + 0.5 && b.y + b.h <= height + 0.5, `${name} inside ${width}×${height}: ${JSON.stringify(b)}`);
      if (el.dataset.item) assert.ok(Math.abs((b.x + b.w / 2) / width * 100 - placed[el.dataset.item].x) < 6, `${name} keeps its place across the habitat at ${width}×${height}: ${((b.x + b.w / 2) / width * 100).toFixed(1)}%`);
    }
    const pet = boxOf(w.actor), shelf = boxOf(parts.find((e) => e.dataset.item === 'shelf'));
    assert.ok(pet.w < width / 2 && pet.h < height * .8, `the pet is sized to the habitat: ${pet.w}×${pet.h} in ${width}×${height}`);
    assert.ok(Math.abs(shelf.w - width * .34) < 1, 'the shelf spans a third of the habitat');
  }
  const small = boxOf(w.actor);
  w.resize(640, 420); w.run(2000);
  assert.ok(boxOf(w.actor).w > small.w * 1.5, 'a larger habitat has a larger pet');
});

test('an exploring pet stays page-sized while its home furniture follows the resized habitat without writes', () => {
  const w = world({ record: { wander: true, physics: false, learning: false, decor: { books: 4, shelf: 4 }, positions: { books: { x: 80, y: 92 }, shelf: { x: 25, y: 40 } } } });
  const actor = w.doc.root.querySelector('.gz-game-actor');
  const writes = w.saved.length;
  for (const [width, height] of [[160, 120], [640, 420], [220, 180]]) {
    w.resize(width, height);
    const scale = Math.max(.5, Math.min(1.6, width / 340, height / 230));
    const books = boxOf(w.stage.querySelector('[data-item="books"]')), shelf = boxOf(w.stage.querySelector('[data-item="shelf"]'));
    assert.ok(Math.abs(books.w - 54 * scale) < .01, `home furniture scales while the pet explores: ${books.w} at ${width}×${height}`);
    assert.ok(Math.abs(shelf.h - 38 * scale) < .01, 'shelf height follows the home scale too');
    assert.equal(Number(actor.style['--gz-pet-u']), 1, 'the exploring pet keeps its page size');
  }
  assert.equal(w.saved.length, writes, 'resizing never writes furniture coordinates or pet data');
  w.W.stop();
});
