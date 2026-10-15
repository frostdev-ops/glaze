const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = () => process.env.GZ_B7C_REVIEW_BASE
  ? require('node:child_process').execFileSync('git', ['show', `${process.env.GZ_B7C_REVIEW_BASE}:features/nav.js`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
  : fs.readFileSync(require.resolve('../features/nav.js'), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise(setImmediate);

test('a late pet read cannot overwrite a newer account snapshot', async () => {
  const src = source(), a = src.indexOf('  const readLocal ='), b = src.indexOf('  const refreshNext =', a);
  const old = deferred(), now = Date.now(), origin = 'https://school.test';
  let calls = 0;
  const c = vm.createContext({ chrome: { runtime: { id: 'glaze' } }, rev: 1, reads: 0, active: true, isPreview: false, local: {}, nextItems: [], nextAt: 0, draws: 0, location: { origin }, drawWidgets() { c.draws++; }, get: async (_, key) => {
    if (Array.isArray(key)) return { todoCache: { key: `todo:${origin}/${++calls === 1 ? '_1_1' : '_2_1'}`, at: now } };
    return key.endsWith('/_1_1') ? old.promise : { [key]: 'current pet' };
  } });
  const read = vm.runInContext(src.slice(a, b) + '\nreadLocal;', c);
  read(); await turn(); read(); await turn();
  assert.equal(c.local.pet, 'current pet');
  old.resolve({ [`pet:${origin}/_1_1`]: 'old pet' }); await turn();
  assert.equal(c.local.pet, 'current pet'); assert.equal(c.local.todoCache.key, `todo:${origin}/_2_1`); assert.equal(c.draws, 1);
});

const nextFixture = () => {
  const src = source(), a = src.indexOf('  const refreshNext ='), b = src.indexOf('  const timerAction =', a), libraries = deferred();
  let calls = 0, draws = 0;
  const c = vm.createContext({ chrome: { runtime: { id: 'glaze' } }, document: { visibilityState: 'visible' }, isPreview: false, nextBusy: false, nextAt: 0, nextRetry: { key: '', at: 0 }, config: { widgets: [{ id: 'next', on: true }] }, rev: 1, reads: 0, active: true, nextItems: [], nextError: false, local: {}, location: { origin: 'https://school.test', href: 'https://school.test/ultra/grades' }, X: { on: () => true, settings: () => ({ enabled: true }), need: () => libraries.promise }, drawWidgets: () => { draws++; }, GZ_ULTRA: { page: { planned: async () => { calls++; return { key: 'todo:account', items: [] }; } } }, GZ_TODO: { clean: () => ({ items: {} }), isDone: () => false }, GZ_SANITIZE: () => ({ todo: { done: 'manual' } }), get: async () => ({}) });
  const refresh = vm.runInContext(src.slice(a, b) + '\nrefreshNext;', c);
  return { c, refresh, libraries, calls: () => calls, draws: () => draws };
};

test('disabling Next due while its libraries load prevents the planner request', async () => {
  const f = nextFixture(), pending = f.refresh(); f.c.config.widgets[0].on = false; f.libraries.resolve(); await pending;
  assert.equal(f.calls(), 0); assert.equal(f.c.nextBusy, false); assert.equal(f.c.nextAt, 0);
});

test('an obsolete Next due request releases its throttle and redraws the current mount', async () => {
  const f = nextFixture(), pending = f.refresh(); f.c.rev++; f.libraries.resolve(); await pending;
  assert.equal(f.c.nextAt, 0); assert.equal(f.c.nextBusy, false); assert.equal(f.draws(), 1); assert.equal(f.calls(), 0);
});

test('a rejected Next due request is retryable and keeps its visible error', async () => {
  const f = nextFixture(); f.c.GZ_ULTRA.page.planned = async () => { throw new Error('offline'); };
  const pending = f.refresh(); f.libraries.resolve(); await pending;
  assert.equal(f.c.nextAt, 0); assert.equal(f.c.nextBusy, false); assert.equal(f.c.nextError, true); assert.equal(f.draws(), 1);
});

test('failed Next due requests stay bounded through one-second ticks and remounts', async () => {
  const f = nextFixture(); let now = Date.now(), attempts = 0;
  f.c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  f.c.GZ_ULTRA.page.planned = async () => { attempts++; throw new Error('offline'); };
  f.libraries.resolve(); await f.refresh();
  for (let second = 1; second < 60; second++) {
    now += 1000; f.c.rev++; f.c.reads++;
    await f.refresh();
  }
  assert.equal(attempts, 1, 'settings, visibility ticks and remounts keep the failure backoff');
  now += 1000; await f.refresh(); assert.equal(attempts, 2, 'one retry after sixty seconds');
  f.c.local.todoCache = { key: 'todo:https://school.test/_2_1' }; await f.refresh();
  assert.equal(attempts, 3, 'a different account does not inherit the earlier failure');
});

test('a failure completing after remount keeps its backoff and off prevents its later retry', async () => {
  const f = nextFixture(), reply = deferred(); let now = Date.now(), attempts = 0;
  f.c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  f.c.GZ_ULTRA.page.planned = () => { attempts++; return reply.promise; };
  f.libraries.resolve(); const pending = f.refresh(); await turn(); f.c.rev++;
  reply.reject(new Error('offline')); await pending; await f.refresh();
  assert.equal(attempts, 1, 'an obsolete failure cannot be retried by its replacement mount');
  now += 60000; f.c.X.on = () => false; await f.refresh(); assert.equal(attempts, 1);
});

test('successful Next due reads keep their two-minute freshness window', async () => {
  const f = nextFixture(); let now = Date.now();
  f.c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  f.libraries.resolve(); await f.refresh(); now += 119999; await f.refresh(); assert.equal(f.calls(), 1);
  now++; await f.refresh(); assert.equal(f.calls(), 2);
});

test('invalidated widget clocks stop without scheduling another callback', () => {
  const src = source(), a = src.indexOf('  const drawWidgets ='), b = src.indexOf('  const mountWidgets =', a);
  let schedules = 0;
  const c = vm.createContext({ chrome: { runtime: {} }, clock: 1, active: true, host: {}, top: {}, document: { visibilityState: 'visible' }, config: { widgets: [{ id: 'unknown', on: true }] }, widgetNodes: new Map(), clearTimeout() {}, setTimeout() { schedules++; }, local: {} });
  const draw = vm.runInContext(src.slice(a, b) + '\ndrawWidgets;', c); draw(); assert.equal(schedules, 0); assert.equal(c.clock, 0);
});
