const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

// Run only the page probe, with deterministic frames and transition promises. No browser is loaded.
const source = fs.readFileSync(require.resolve('../../checks/navigation/ultra-feel-check.js'), 'utf8');
const probe = source.slice(source.indexOf('function probe()'), source.indexOf('\n// PERF_DEVICE=neo:'));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  let now = 0, destination = false;
  const frames = [], events = new Map();
  const element = { isConnected: true, getClientRects: () => [1], getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 30 }),
    scrollIntoView() {}, contains: () => true };
  const document = { activeViewTransition: null, getElementById: () => null, elementFromPoint: () => element,
    querySelector: (s) => s.startsWith('.js-course-navigation') ? element : null,
    querySelectorAll: (s) => s === '.destination' && destination ? [element] : [] };
  const c = vm.createContext({ document, location: { href: 'https://school.test/ultra/outline' },
    performance: { now: () => now }, PerformanceObserver: class { observe() {} },
    getComputedStyle: () => ({ visibility: 'visible', opacity: '1' }),
    requestAnimationFrame: (fn) => frames.push(fn), setTimeout: () => {},
    addEventListener: (type, fn) => events.set(type, fn) });
  c.window = c;
  vm.runInContext(`${probe}\nprobe();`, c);
  const p = c.__feel;
  p.arm({ find: 'tool', arg: 'announcement', anchor: '.old', dest: '.destination' });
  p.base();
  events.get('pointerdown')({ isTrusted: true, timeStamp: 0 });
  const tick = (at) => { now = at; const callbacks = frames.splice(0); callbacks.forEach((fn) => fn()); };
  tick(16);
  events.get('click')({ isTrusted: true, timeStamp: 24, composedPath: () => [] });
  const update = deferred(), ready = deferred();
  document.activeViewTransition = { updateCallbackDone: update.promise, ready: ready.promise };
  return { p, tick, update, ready, destination: () => { destination = true; c.location.href = 'https://school.test/ultra/announcement'; } };
}

test('the feel probe keeps sampling a DOM-ready destination while a transition holds painting', async () => {
  const f = fixture();
  f.destination(); f.tick(32);
  assert.equal(f.p.done(), false, 'the old page is still painted');
  assert.equal(f.p.result().clickToReady, null);
  f.update.resolve(); f.ready.resolve(); await Promise.resolve();
  f.tick(48);
  assert.equal(f.p.done(), true);
  assert.equal(f.p.result().clickToReady.ms, 24);
});

test('the feel probe waits for transition ready after the update callback resolves', async () => {
  const f = fixture();
  f.tick(32);
  f.update.resolve(); await Promise.resolve();
  f.destination(); f.tick(48);
  assert.equal(f.p.result().heldFrames, 2, 'capturing the new state still holds rendering');
  assert.equal(f.p.done(), false);
  f.ready.resolve(); await Promise.resolve();
  f.tick(64);
  assert.equal(f.p.done(), true);
  assert.equal(f.p.result().clickToReady.ms, 40);
});

const measurementOptions = (value) => {
  const start = source.indexOf('const neo = process.env.PERF_DEVICE'), end = source.indexOf('\nlet checks = ', start);
  return vm.runInNewContext(`${source.slice(start, end)}\nmeasureReps;`, { process: { env: { FEEL_MEASURE: value } } });
};

test('feel measurement repetitions reject invalid values before starting any browser work', () => {
  for (const value of ['-1', '1.5', 'Infinity', 'invalid', '9007199254740992']) {
    assert.throws(() => measurementOptions(value), /FEEL_MEASURE/, value);
  }
});

test('feel measurement repetitions allow zero or an absent option and whole tours', () => {
  assert.equal(measurementOptions(undefined), 0);
  assert.equal(measurementOptions('0'), 0);
  assert.equal(measurementOptions('3'), 3);
});
