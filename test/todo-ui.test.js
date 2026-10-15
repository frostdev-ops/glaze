// Better To Do's page side (features/todo.js and its content.js hook) in a VM with an inert DOM, network and storage:
// the lifecycle, request and write rules that lib/todo.js's table tests can't reach. The module's closure is reached
// by appending a probe to its return value here, in the test only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const T = require('../lib/todo.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = () => new Promise(setImmediate);
const O = D.GZ_SANITIZE({}).todo;

// Just enough of an element for the list to draw into.
class E {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.style = {}; this.children = []; this.attrs = {}; }
  append(...xs) { this.children.push(...xs); }
  replaceChildren(...xs) { this.children = xs; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  contains() { return false; }
  closest() { return null; }
  addEventListener() {}
  removeEventListener() {}
  remove() {}
  before() {}
  matches() { return false; }
  focus() {}
}

const feature = ({ summary = () => ({ graded: 1, ungraded: 2 }), setOk = true } = {}) => {
  const calls = [];
  const kept = [];
  const runtime = { lastError: undefined };
  const c = {
    console, URL, Intl, Date, Set, Map, JSON, Promise, CSS: { escape: (x) => x }, crypto: { randomUUID: () => '12345678-abcd-ef00' },
    GZ_TODO: T, GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_CANVAS_DUE_WEEK: () => [],
    GZ_CTX: {
      t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', canvasCourseId: () => '', celebrate() {},
      canvasCourses: async () => [{ id: '25', name: 'Biology', enrollments: [{ type: 'teacher' }] }],
      capi: async (url) => {
        calls.push(url);
        if (url.includes('submission_summary')) return summary(url);
        return [{ type: 'grading', course_id: 25, needs_grading_count: 2, assignment: { id: 7, name: 'Lab report' } }];
      },
    },
    location: { origin: 'https://canvas.test', pathname: '/' },
    document: { cookie: '_csrf_token=abc%3D', activeElement: null, documentElement: new E('html'), visibilityState: 'visible', createElement: (t) => new E(t), querySelector: () => null, addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {},
    chrome: {
      runtime,
      storage: {
        local: { set: (v, cb) => { if (setOk) kept.push(v); else runtime.lastError = { message: 'QUOTA_BYTES' }; cb(); runtime.lastError = undefined; } },
        sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {}, removeListener() {} },
      },
    },
    fetch: async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${new URL(url).pathname}`);
      if (opts.method) return { ok: true, headers: { get: () => null }, text: async () => '{"id":"40","marked_complete":true}' };
      return { ok: true, headers: { get: () => null }, text: async () => '[]' };
    },
  };
  c.globalThis = c;
  const src = read('features/todo.js').replace('  return { sync, add, cmds };', `  return { sync, add, cmds, probe: {
    refresh, onChange, onShow, save, rowOf, render, get: () => ({ data, cache, fetching, note: line?.textContent }),
    seed(x) { L = GZ_TODO; who = { uid: '3', tz: 'America/New_York' }; key = 'todo:https://canvas.test/3'; prefs = { ...x.prefs };
      data = x.data || { tasks: [], items: {} }; cache = x.cache || null; started = Promise.resolve(); courses = { cids: null, names: {}, list: [] };
      box = new E('section'); head = new E(); line = new E('p'); body = new E(); },
  } };`).replace('var GZ_TODO_UI = globalThis.GZ_TODO_UI ||', 'var GZ_TODO_UI =');
  vm.createContext(c);
  vm.runInContext(`${E}\n${src}`, c);
  return { c, calls, kept, p: c.GZ_TODO_UI.probe };
};
const planner = (calls) => calls.filter((u) => u.includes('/planner/items')).length;
const summaries = (calls) => calls.filter((u) => u.includes('submission_summary')).length;

test('a module that arrives after the list was turned off stays off', async () => {
  const decls = read('content.js').match(/ {2}const todoHere = .*\n {2}const syncTodo = .*\n/)[0];
  let arrive;
  const ctx = { ultra: false, links: [1], settings: { enhance: { todo: true } }, location: { pathname: '/' }, need: () => new Promise((r) => { arrive = r; }) };
  vm.createContext(ctx);
  vm.runInContext(`${decls}\nglobalThis.syncTodo = syncTodo;`, ctx);
  const late = ctx.syncTodo();
  ctx.settings.enhance.todo = false;
  ctx.syncTodo(); // the off pass: nothing loaded yet to turn off
  const asked = [];
  ctx.GZ_TODO_UI = { sync: (on) => asked.push(on) };
  arrive();
  await late;
  assert.deepEqual(asked, [false]);
});

test("a teacher's missing grading counts don't refetch the planner on every pass; they're asked for again when the page is shown", async () => {
  let fail = true;
  const f = feature({ summary: () => (fail ? Promise.reject(new Error('403')) : { graded: 1, ungraded: 2 }) });
  f.p.seed({ prefs: O });
  await f.p.refresh();
  assert.equal(f.p.get().cache.partial, true);
  for (let i = 0; i < 5; i++) { f.c.GZ_TODO_UI.sync(true); await f.p.get().fetching; } // content.js's passes
  assert.equal(planner(f.calls), 1);
  assert.equal(summaries(f.calls), 1);
  fail = false;
  f.p.onShow();
  await f.p.get().fetching;
  assert.equal(planner(f.calls), 1, 'the planner answer is still fresh');
  assert.equal(summaries(f.calls), 2);
  assert.deepEqual({ ...f.p.get().cache.sums['7'] }, { graded: 1, ungraded: 2 });
  assert.equal(f.p.get().cache.partial, false);
});

const item = () => T.slim({ plannable_type: 'assignment', plannable_id: 3, course_id: 25, plannable_date: new Date(Date.now() + 36e5).toISOString(), plannable: { title: 'Essay' } });
const tick = (checked = true) => ({ dataset: { act: 'done' }, checked, closest: () => ({ dataset: { key: 'assignment:3' } }) });

test("only the student's own tick writes to Canvas, never a script's change event", async () => {
  const f = feature();
  f.p.seed({ prefs: { ...O, sync: true }, cache: { key: 'todo:https://canvas.test/3', at: Date.now(), items: [item()], grading: [], sums: {} } });
  f.p.render(true);
  f.p.onChange({ target: tick(), isTrusted: false });
  await settle();
  assert.deepEqual(f.calls, []);
  f.p.onChange({ target: tick(), isTrusted: true });
  await settle();
  assert.deepEqual(f.calls, ['POST /api/v1/planner/overrides']);
});

test("a change storage didn't keep is put back and said so", async () => {
  const f = feature({ setOk: false });
  f.p.seed({ prefs: O, cache: { key: 'todo:https://canvas.test/3', at: Date.now(), items: [item()], grading: [], sums: {} } });
  f.p.render(true);
  f.p.onChange({ target: tick(), isTrusted: true });
  await settle();
  assert.deepEqual({ ...f.p.get().data.items }, {});
  assert.equal(f.p.get().note, "Couldn't save that on this device, so nothing changed.");
  const ok = feature();
  ok.p.seed({ prefs: O, cache: { key: 'todo:https://canvas.test/3', at: Date.now(), items: [item()], grading: [], sums: {} } });
  ok.p.render(true);
  ok.p.onChange({ target: tick(), isTrusted: true });
  await settle();
  assert.equal(ok.p.get().data.items['assignment:3'].done, true);
  assert.equal(ok.p.get().note, 'Essay is done.');
});

test('whatever the list shows can be acted on, however long the timeframe', () => {
  const far = T.slim({ plannable_type: 'assignment', plannable_id: 5, course_id: 25, plannable_date: new Date(Date.now() + 390 * T.DAY).toISOString(), plannable: { title: 'Far off' } });
  const f = feature();
  f.p.seed({ prefs: { ...O, span: 'custom', n: 60, unit: 'weeks' }, cache: { key: 'todo:https://canvas.test/3', at: Date.now(), items: [far], grading: [], sums: {} } });
  f.p.render(true);
  assert.equal(f.p.rowOf({ closest: () => ({ dataset: { key: 'assignment:5' } }) })?.title, 'Far off');
});
