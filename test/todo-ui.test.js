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

// shared: { store, waiting, turn } for tabs that share one storage.local and one background worker.
const feature = ({ summary = () => ({ graded: 1, ungraded: 2 }), setOk = true, defer = false, holdPlanner = false, stored = {}, shared = null, profile = async () => ({ id: '3', time_zone: 'America/New_York' }) } = {}) => {
  const calls = [];
  const kept = [];
  const store = shared?.store || JSON.parse(JSON.stringify(stored)); // storage.local
  const waiting = shared?.waiting || []; // the student's data writes held back (defer), to answer in order
  const held = []; // planner answers held back (holdPlanner)
  const native = new E();
  const activation = { isActive: true };
  const runtime = { lastError: undefined };
  const c = {
    console, URL, Intl, Date, Set, Map, JSON, Promise, CSS: { escape: (x) => x }, crypto: { randomUUID: () => '12345678-abcd-ef00' },
    GZ_TODO: T, GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_CANVAS_DUE_WEEK: () => [],
    GZ_CTX: {
      t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', canvasCourseId: () => '', celebrate() {}, need: async () => {},
      profile() { return this.capi('/users/self/profile'); },
      canvasCourses: async () => [{ id: '25', name: 'Biology', enrollments: [{ type: 'teacher' }] }],
      capi: async (url) => {
        calls.push(url);
        if (url === '/users/self/profile') return profile();
        if (url.includes('submission_summary')) return summary(url);
        return [{ type: 'grading', course_id: 25, needs_grading_count: 2, assignment: { id: 7, name: 'Lab report' } }];
      },
    },
    location: { origin: 'https://canvas.test', pathname: '/' },
    navigator: { userActivation: activation },
    document: { cookie: '_csrf_token=abc%3D', activeElement: null, documentElement: new E('html'), visibilityState: 'visible', createElement: (t) => new E(t), querySelector: () => native, addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {},
    chrome: {
      runtime: Object.assign(runtime, {
        // The background worker's 'glaze:todo' (lib/background.js): one queue, lib/todo.js change, over this storage.
        sendMessage: (m, cb) => {
          if (m?.type !== 'glaze:todo') return;
          const area = {
            get: async (k) => JSON.parse(JSON.stringify(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]])))),
            set: (v) => new Promise((res) => c.chrome.storage.local.set(v, () => res(!runtime.lastError))),
            remove: async (k) => { for (const x of [k].flat()) delete store[x]; return true; },
          };
          const turn = shared?.turn || (c.turn ||= { last: Promise.resolve() });
          const run = turn.last.then(() => T.change(JSON.parse(JSON.stringify(m)), { local: area, sync: area }));
          turn.last = run.catch(() => {});
          run.then((r) => cb(JSON.parse(JSON.stringify(r))), () => cb({ ok: false, error: 'write' }));
        },
      }),
      storage: {
        local: {
          set: (v, cb) => {
            const answer = () => {
              if (setOk) { kept.push(JSON.parse(JSON.stringify(v))); Object.assign(store, JSON.parse(JSON.stringify(v))); } else runtime.lastError = { message: 'QUOTA_BYTES' };
              cb(); runtime.lastError = undefined;
            };
            if (defer && Object.keys(v).some((k) => k.startsWith('todo:'))) waiting.push(answer); else answer();
          },
          get: (k, cb) => cb(JSON.parse(JSON.stringify(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]]))))),
        },
        sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {}, removeListener() {} },
      },
    },
    fetch: async (url, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${new URL(url).pathname}`);
      const empty = { ok: true, headers: { get: () => null }, text: async () => '[]' };
      if (!opts.method && holdPlanner && url.includes('/planner/items')) return new Promise((res) => held.push(() => res(empty)));
      if (opts.method) return { ok: true, headers: { get: () => null }, text: async () => '{"id":"40","marked_complete":true}' };
      return { ok: true, headers: { get: () => null }, text: async () => '[]' };
    },
  };
  c.globalThis = c;
  const src = read('features/todo.js').replace('  return { sync, add, cmds };', `  return { sync, add, cmds, probe: {
    refresh, onChange, onShow, onSubmit, form: (x) => { form = x; }, save, rowOf, render, get: () => ({ data, cache, fetching, note: line?.textContent, box, dead, who }),
    seed(x) { L = GZ_TODO; who = { uid: '3', tz: 'America/New_York' }; key = 'todo:https://canvas.test/3'; prefs = { ...x.prefs };
      data = x.data || { tasks: [], items: {} }; cache = x.cache || null; started = Promise.resolve(); courses = { cids: null, names: {}, list: [] };
      box = new E('section'); head = new E(); line = new E('p'); body = new E(); },
  } };`).replace('var GZ_TODO_UI = globalThis.GZ_TODO_UI ||', 'var GZ_TODO_UI =');
  vm.createContext(c);
  vm.runInContext(`${E}\n${src}`, c);
  return { c, calls, kept, store, waiting, held, activation, p: c.GZ_TODO_UI.probe };
};
const planner = (calls) => calls.filter((u) => u.includes('/planner/items')).length;
const summaries = (calls) => calls.filter((u) => u.includes('submission_summary')).length;

test('a late sharing loader for an old To Do mount cannot leave a port after teardown', async () => {
  const f = feature(), loaders = [];
  let ports = 0;
  f.c.GZ_SHARING_UI = { surface: () => { ports++; return () => { ports--; }; } };
  f.c.GZ_CTX.need = (file) => file === 'features/sharing.js' ? new Promise((r) => loaders.push(r)) : Promise.resolve();
  f.c.GZ_TODO_UI.sync(true); f.c.GZ_TODO_UI.sync(false); f.c.GZ_TODO_UI.sync(true);
  for (const done of loaders) done(); await settle();
  assert.equal(ports, 1);
  f.c.GZ_TODO_UI.sync(false); assert.equal(ports, 0);
});

test('a module that arrives after the list was turned off stays off', async () => {
  const decls = read('content-canvas.js').match(/ {2}const todoHere = .*\n {2}const syncTodo = .*\n/)[0];
  let arrive;
  const ctx = { I: { links: [1], settings: { enhance: { todo: true } } }, location: { pathname: '/' }, need: () => new Promise((r) => { arrive = r; }) };
  vm.createContext(ctx);
  vm.runInContext(`${decls}\nglobalThis.syncTodo = syncTodo;`, ctx);
  const late = ctx.syncTodo();
  ctx.I.settings.enhance.todo = false;
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

test("a teacher's fresh planner answer from the course cards (teach: null) is kept; only the grading is asked for", async () => {
  const f = feature();
  const now = Date.now();
  const cards = { key: 'todo:https://canvas.test/3', at: now, ...T.fetchRange(O, now, 'America/New_York'), teach: null, progress: true, items: [T.slim({ plannable_type: 'assignment', plannable_id: 5, course_id: 25, plannable_date: new Date(now + 36e5).toISOString(), plannable: { title: 'Quiz' } })], grading: [], sums: {} };
  f.p.seed({ prefs: O, cache: cards });
  await f.p.refresh();
  assert.equal(planner(f.calls), 0);
  assert.ok(f.calls.includes('/users/self/todo?per_page=100'));
  const c = f.p.get().cache;
  assert.equal(c.teach, true);
  assert.equal(c.items[0].title, 'Quiz');
  assert.equal(c.grading.length, 1);
  // Asked again on purpose (a refused tick): the planner too.
  await f.p.refresh(true);
  assert.equal(planner(f.calls), 1);
});

const item = () => T.slim({ plannable_type: 'assignment', plannable_id: 3, course_id: 25, plannable_date: new Date(Date.now() + 36e5).toISOString(), plannable: { title: 'Essay' } });
const tick = (checked = true) => ({ dataset: { act: 'done' }, checked, getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }), closest: () => ({ dataset: { key: 'assignment:3' } }) });

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

test('a start that was superseded (off, then on again) can neither kill nor overwrite the newer list', async () => {
  const answers = [];
  const f = feature({ profile: () => new Promise((res, rej) => answers.push({ res, rej })) });
  f.c.GZ_TODO_UI.sync(true); // start A asks for the profile
  await settle();
  f.c.GZ_TODO_UI.sync(false); // turned off while it waits
  f.c.GZ_TODO_UI.sync(true); // and on again: start B
  await settle();
  assert.equal(answers.length, 2);
  answers[1].res({ id: '3', time_zone: 'America/New_York' }); // B succeeds
  await settle(); await settle();
  answers[0].rej(new Error('network')); // A fails late
  await settle(); await settle();
  assert.equal(f.p.get().dead, false);
  assert.ok(f.p.get().box, 'the newer list is still on the page');
  assert.equal(f.p.get().who.uid, '3');
});

test('changes saved one after another all stay, each applied to what the one before left', async () => {
  const f = feature({ defer: true });
  f.p.seed({ prefs: O });
  const pick = (k, value) => f.p.onChange({ target: { dataset: { act: 'on' }, value, closest: () => ({ dataset: { key: k } }) }, isTrusted: true });
  pick('assignment:1', '2026-10-20');
  pick('assignment:2', '2026-10-21'); // asked for while the first is still being stored
  await settle();
  f.waiting.shift()(); // the first lands
  await settle();
  pick('assignment:3', '2026-10-22');
  while (f.waiting.length) { f.waiting.shift()(); await settle(); }
  await settle();
  const want = { 'assignment:1': { on: '2026-10-20' }, 'assignment:2': { on: '2026-10-21' }, 'assignment:3': { on: '2026-10-22' } };
  assert.deepEqual(JSON.parse(JSON.stringify(f.kept.at(-1)['todo:https://canvas.test/3'].items)), want);
  assert.deepEqual(JSON.parse(JSON.stringify(f.p.get().data.items)), want);
});

test("a trusted event without the student's activation (a script's .click()) writes nothing", async () => {
  const f = feature();
  f.p.seed({ prefs: { ...O, sync: true }, cache: { key: 'todo:https://canvas.test/3', at: Date.now(), items: [item()], grading: [], sums: {} } });
  f.p.render(true);
  f.activation.isActive = false;
  f.p.onChange({ target: tick(), isTrusted: true });
  await settle();
  assert.deepEqual(f.calls, []);
  f.activation.isActive = true; // a click or Space just now
  f.p.onChange({ target: tick(), isTrusted: true });
  await settle();
  assert.deepEqual(f.calls, ['POST /api/v1/planner/overrides']);
});

const settled = async (n = 6) => { for (let i = 0; i < n; i++) await settle(); };
const KEY = (uid) => `todo:https://canvas.test/${uid}`;

test('a queued change stays with the account and list it was made in, even after a remount as someone else', async () => {
  let n = 0;
  const f = feature({ defer: true, profile: async () => ({ id: String(++n), time_zone: 'America/New_York' }), stored: { [KEY(2)]: { tasks: [{ id: 'two', title: 'Theirs' }], items: {} } } });
  f.c.GZ_TODO_UI.sync(true);
  await settled();
  assert.equal(f.p.get().who.uid, '1');
  const pick = (k, value) => f.p.onChange({ target: { dataset: { act: 'on' }, value, closest: () => ({ dataset: { key: k } }) }, isTrusted: true });
  pick('assignment:1', '2026-10-20');
  pick('assignment:2', '2026-10-21'); // both asked for as user 1; the first is still being stored
  await settled();
  f.c.GZ_TODO_UI.sync(false);
  f.c.GZ_TODO_UI.sync(true); // the list again, now as user 2
  await settled();
  assert.equal(f.p.get().who.uid, '2');
  while (f.waiting.length) { f.waiting.shift()(); await settled(); }
  assert.ok(f.kept.filter((w) => Object.keys(w).some((k) => k.startsWith('todo:'))).every((w) => Object.keys(w).includes(KEY(1))), 'every change went to user 1');
  assert.deepEqual(f.store[KEY(1)].items, { 'assignment:1': { on: '2026-10-20' }, 'assignment:2': { on: '2026-10-21' } });
  assert.deepEqual(f.store[KEY(2)], { tasks: [{ id: 'two', title: 'Theirs' }], items: {} });
  assert.deepEqual(JSON.parse(JSON.stringify(f.p.get().data)).tasks.map((x) => x.id), ['two'], "user 2's list shows user 2's data");
  assert.deepEqual(JSON.parse(JSON.stringify(f.p.get().data.items)), {});
});

test("a list mounted again while the old one's planner request is out asks for its own answer", async () => {
  const f = feature({ holdPlanner: true });
  f.c.GZ_TODO_UI.sync(true);
  await settled();
  assert.equal(planner(f.calls), 1);
  f.c.GZ_TODO_UI.sync(false);
  f.c.GZ_TODO_UI.sync(true);
  await settled();
  assert.equal(planner(f.calls), 2, 'the new list asked for itself');
  while (f.held.length) { f.held.shift()(); await settled(); }
  assert.ok(f.p.get().cache, 'and has its answer, not Loading');
});

test("the list's slow planner answer never replaces a newer one another tab or the cards kept meanwhile", async () => {
  const f = feature({ holdPlanner: true });
  f.p.seed({ prefs: O });
  const p = f.p.refresh();
  await settled();
  const newer = { key: 'todo:https://canvas.test/3', at: Date.now() + 1000, ...T.fetchRange(O, Date.now(), 'America/New_York'), teach: true, progress: true, items: [], grading: [], sums: {}, mark: 'newer' };
  f.store.todoCache = newer;
  while (f.held.length) { f.held.shift()(); await settled(); }
  await p;
  assert.equal(f.store.todoCache.mark, 'newer');
  assert.equal(f.p.get().cache.mark, 'newer');
});

test("two tabs adding tasks at once both keep theirs (the worker's one queue)", async () => {
  const shared = { store: {}, waiting: [], turn: { last: Promise.resolve() } };
  const one = feature({ defer: true, shared }), two = feature({ defer: true, shared });
  for (const f of [one, two]) { f.p.seed({ prefs: O }); f.p.render(true); }
  const add = (f, title) => {
    const form = { dataset: { act: 'saveTask' }, closest: () => null, querySelector: () => null };
    f.c.FormData = class { constructor() { return [['title', title], ['cid', ''], ['date', ''], ['time', ''], ['notes', '']]; } };
    f.p.form({ cid: '' });
    f.p.onSubmit({ target: form, isTrusted: true, preventDefault() {} });
  };
  one.c.crypto.randomUUID = () => 'aaaaaaaa-1111-0000';
  two.c.crypto.randomUUID = () => 'bbbbbbbb-2222-0000';
  add(one, 'From tab one');
  add(two, 'From tab two'); // both asked for before either is stored
  await settled();
  while (shared.waiting.length) { shared.waiting.shift()(); await settled(); }
  assert.deepEqual(shared.store[KEY(3)].tasks.map((x) => x.title).sort(), ['From tab one', 'From tab two']);
});

test("the worker takes To Do writes from a Canvas page for its own site's accounts, and backups from the editor only, one at a time", async () => {
  const m = require('../manifest.json');
  const store = { sync: { version: 2 }, local: { [KEY(3)]: { tasks: [{ id: 'old', title: 'Before' }], items: {} } } };
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  // Settings with colors 'refuse' don't take, after a pause long enough for a later import to overtake them.
  const area = (s, name) => ({
    get: (k) => later(() => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: (v) => new Promise((res, rej) => setTimeout(() => (name === 'sync' && v.colors === 'refuse' ? rej(new Error('quota')) : res(Object.assign(s, structuredClone(v)))), name === 'sync' ? 20 : 0)),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete s[x]; }),
  });
  const listeners = [];
  const context = vm.createContext({
    URL, console, TextEncoder, structuredClone, Promise, Date, Intl, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(store.local, 'local'), sync: area(store.sync, 'sync'), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  const page = { id: 'glaze', tab: {}, url: 'https://school.instructure.com/courses/1' };
  const editor = { id: 'glaze', tab: {}, url: 'chrome-extension://x/options.html' };
  const nope = { ok: false, error: 'sender' };
  const own = 'todo:https://school.instructure.com/3';
  const add = { type: 'glaze:todo', key: own, edits: [['task', { id: 'n', title: 'New' }]] };
  // Who may ask.
  assert.deepEqual(await send({ ...add, key: 'todo:https://other.instructure.com/3' }, page), nope, "another site's account");
  assert.deepEqual(await send(add, { ...page, id: 'other' }), nope, 'another extension');
  assert.deepEqual(await send(add, { ...page, url: 'https://evil.example/' }), nope, 'a site Glaze does not run on');
  assert.deepEqual(await send({ type: 'glaze:todo', restore: { tasks: {}, settings: { version: 2 } } }, page), nope, 'a Canvas page cannot restore a backup');
  assert.deepEqual(await send(add, editor), nope, 'the editor only restores');
  const r = await send(add, page);
  assert.equal(r.ok, true);
  assert.deepEqual(store.local[own].tasks.map((x) => x.id), ['n']);
  // Two imports at once: the older one fails and undoes itself before the newer one is stored, so the newer stays.
  const backup = (title, colors) => ({ type: 'glaze:todo', restore: { tasks: { [KEY(3)]: { tasks: [{ id: title, title }], items: {} } }, settings: { version: 2, colors } } });
  const [a, b] = await Promise.all([send(backup('A', 'refuse'), editor), send(backup('B', 'fine'), editor)]);
  assert.deepEqual([a.ok, b.ok], [false, true]);
  assert.deepEqual(store.local[KEY(3)].tasks.map((x) => x.title), ['B']);
  assert.equal(store.sync.colors, 'fine');
});
