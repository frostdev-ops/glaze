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
      settings: () => ({ enhance: { drafts: true } }),
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
          remove: (k, cb) => { for (const x of [k].flat()) delete store[x]; cb?.(); },
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
  const src = read('features/todo.js').replace('  return { sync, add, cmds, mount, unmount, suspend, resume };', `  return { sync, add, cmds, mount, unmount, suspend, resume, probe: {
    refresh, keepDraft, onStore, onChange, onShow, onSubmit, onClick, form: (x) => { form = x; }, formNow: () => form, save, rowOf, render, get: () => ({ data, cache, fetching, note: line?.textContent, box, dead, who }),
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
  const decls = read('content-canvas.js').match(/ {2}const sidebarHere = .*\n(?: {2}const \w+ = .*\n)*? {2}const syncTodo = .*\n/)[0];
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

test('saving an edited task keeps a tick made while its form was open', async () => {
  const task = { id: 'abc', title: 'Read ch. 4', cid: '', due: null, notes: '', done: 0, at: 1 };
  const f = feature({ stored: { [KEY(3)]: { tasks: [task], items: {} } } });
  f.p.seed({ prefs: O, data: { tasks: [task], items: {} } });
  f.p.render(true);
  const edit = { tagName: 'BUTTON', dataset: { act: 'edit' }, closest: () => ({ dataset: { key: 'task:abc' } }) };
  f.p.onClick({ target: { closest: () => edit } });
  await f.p.save([['taskDone', 'abc', 5000]]); // ticked from the row, or in another tab
  f.c.FormData = class { constructor() { return [['title', 'Read ch. 4 and 5'], ['cid', ''], ['date', ''], ['time', ''], ['notes', '']]; } };
  f.p.onSubmit({ target: { dataset: { act: 'saveTask' }, closest: () => null, querySelector: () => null }, isTrusted: true, preventDefault() {} });
  await settled();
  assert.deepEqual([f.store[KEY(3)].tasks[0].title, f.store[KEY(3)].tasks[0].done], ['Read ch. 4 and 5', 5000]);
  assert.equal(f.p.get().data.tasks[0].done, 5000);
});

test('a task past the limit is not shown as added: the list says it was not saved and the form keeps what was typed', async () => {
  const tasks = Array.from({ length: 500 }, (_, i) => ({ id: `t${i}`, title: `Task ${i}`, cid: '', due: null, notes: '', done: 0, at: 1 }));
  const f = feature({ stored: { [KEY(3)]: { tasks, items: {} } } });
  f.p.seed({ prefs: O, data: { tasks, items: {} } });
  f.p.render(true);
  f.c.FormData = class { constructor() { return [['title', 'The 501st'], ['cid', ''], ['date', ''], ['time', ''], ['notes', 'x']]; } };
  f.p.form({ cid: '' });
  f.p.onSubmit({ target: { dataset: { act: 'saveTask' }, closest: () => null, querySelector: () => null }, isTrusted: true, preventDefault() {} });
  await settled();
  assert.equal(f.p.get().note, "Couldn't save that on this device, so nothing changed.");
  assert.equal(f.store[KEY(3)].tasks.length, 500);
  assert.equal(f.p.formNow().draft.title, 'The 501st');
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
  const editor = { id: 'glaze', tab: {}, frameId: 0, url: 'chrome-extension://x/options.html' };
  const nope = { ok: false, error: 'sender' };
  const own = 'todo:https://school.instructure.com/3';
  const add = { type: 'glaze:todo', key: own, edits: [['task', { id: 'n', title: 'New' }]] };
  // Who may ask.
  assert.deepEqual(await send({ ...add, key: 'todo:https://other.instructure.com/3' }, page), nope, "another site's account");
  assert.deepEqual(await send(add, { ...page, id: 'other' }), nope, 'another extension');
  assert.deepEqual(await send(add, { ...page, url: 'https://evil.example/' }), nope, 'a site Glaze does not run on');
  assert.deepEqual(await send({ type: 'glaze:todo', restore: { tasks: {}, settings: { version: 2 } } }, page), nope, 'a Canvas page cannot restore a backup');
  assert.deepEqual(await send(add, editor), nope, 'the editor only restores');
  assert.deepEqual(await send({ type: 'glaze:todo', restore: { tasks: {}, settings: { version: 2 } } }, { ...editor, frameId: 4 }), nope, 'Settings shown inside a school page cannot restore a backup: only its own tab');
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

// ---- mounted by its widget in the sidebar's dock --------------------------------------------------------------------
const course = (f) => { const asked = []; f.c.GZ_TODO = { ...T, build: (x) => { asked.push(x.course); return T.build(x); } }; return asked; };

test('outside the dock the head has no scope buttons, and nothing in their place (not the word "undefined")', async () => {
  const f = feature();
  const target = new E();
  f.c.GZ_TODO_UI.mount(target, { courseId: '25' });
  await settle(); await settle();
  const head = f.p.get().box.children[0];
  assert.deepEqual(head.children.filter((x) => x === undefined || x === null || typeof x === 'string' || x?.className === 'gz-todo-scope'), []);
});

test('in the dock: Follow page shows this course, All courses every course, and the choice goes to the record', async () => {
  const f = feature();
  const asked = course(f);
  const target = new E(), chosen = [];
  const ui = f.c.GZ_TODO_UI;
  ui.mount(target, { courseId: '25', scope: 'follow', setScope: (v) => chosen.push(v) });
  await settle(); await settle();
  assert.equal(asked.at(-1), '25', 'this course');
  const box = f.p.get().box;
  assert.ok(target.children.includes(box));
  const head = box.children[0]; // the head, with its two buttons
  const btns = head.children.find((x) => x?.className === 'gz-todo-scope').children;
  assert.deepEqual(btns.map((b) => [b.dataset.v, b.attrs['aria-pressed']]), [['follow', 'true'], ['all', 'false']]);
  f.p.onClick({ target: { closest: () => btns[1] } });
  assert.deepEqual(chosen, ['all']);
  ui.mount(target, { courseId: '25', scope: 'all', setScope: (v) => chosen.push(v) });
  assert.equal(asked.at(-1), '', 'every course');
  // The site's own sidebar pass can't take it from its widget.
  ui.sync(false);
  assert.equal(f.p.get().box, box);
});

test('an open task form survives the list going and coming back, and another page through the drafts store', async () => {
  const f = feature();
  const target = new E();
  const ui = f.c.GZ_TODO_UI;
  ui.mount(target, { courseId: '', scope: 'follow', setScope() {} });
  await settle(); await settle();
  f.p.form({ cid: '25', draft: { title: 'Essay outline', notes: 'Three sources' } });
  ui.unmount(target);
  assert.equal(f.p.get().box, null);
  const kept = f.store['draft:todo:https://canvas.test/3'];
  assert.equal(kept.todo.draft.title, 'Essay outline');
  ui.mount(target, { courseId: '', scope: 'follow', setScope() {} });
  assert.equal(f.p.formNow().draft.title, 'Essay outline', 'kept in this document');
  // Another page: the stored draft opens once, and leaves the store.
  const g = feature({ stored: { 'draft:todo:https://canvas.test/3': kept } });
  g.c.GZ_TODO_UI.mount(new E(), { courseId: '', scope: 'follow', setScope() {} });
  await settle(); await settle();
  assert.deepEqual({ ...g.p.formNow().draft }, { title: 'Essay outline', notes: 'Three sources' });
  assert.equal(g.p.formNow().draft.title, 'Essay outline');
  assert.equal(g.p.formNow().cid, '25');
  assert.equal('draft:todo:https://canvas.test/3' in g.store, false);
});

test('a list that cannot load in the dock says so, so Canvas\'s own comes back', async () => {
  const f = feature({ profile: async () => { throw new Error('signed out'); } });
  let failed = 0;
  f.c.GZ_TODO_UI.mount(new E(), { courseId: '', scope: 'follow', setScope() {}, failed: () => failed++ });
  await settle(); await settle();
  assert.equal(failed, 1);
  assert.equal(f.p.get().box, null);
  assert.equal(f.c.GZ_TODO_UI.mount(new E(), { courseId: '', scope: 'follow', failed: () => failed++ }), false);
  assert.equal(failed, 2);
});

test('a legacy list cannot consume a draft saved for a later dock mount', async () => {
  const key = 'draft:todo:https://canvas.test/3';
  const saved = { text: 'Essay outline', at: Date.now(), todo: { cid: '25', draft: { title: 'Essay outline' } } };
  const f = feature({ stored: { [key]: saved } });
  f.c.GZ_TODO_UI.sync(true);
  await settle(); await settle();
  assert.deepEqual(f.store[key], saved, 'only a dock mount may claim the draft');
  f.c.GZ_TODO_UI.sync(false);
  f.c.GZ_TODO_UI.mount(new E(), { courseId: '', scope: 'follow' });
  await settle(); await settle();
  assert.equal(f.p.formNow().draft.title, 'Essay outline');
});

test('draft backup disabled leaves no cross-document draft to restore', async () => {
  const key = 'draft:todo:https://canvas.test/3';
  const f = feature({ stored: { [key]: { at: Date.now(), todo: { draft: { title: 'Old draft' } } } } });
  f.c.GZ_CTX.settings = () => ({ enhance: { drafts: false } });
  f.c.GZ_TODO_UI.mount(new E(), { courseId: '', scope: 'follow' });
  await settle(); await settle();
  assert.equal(f.p.formNow(), null);
});

test('the native fallback is owned only after the mounted list has data to render', async () => {
  const f = feature({ holdPlanner: true });
  let ready = 0;
  f.c.GZ_TODO_UI.mount(new E(), { courseId: '', scope: 'follow', rendered: () => ready++ });
  await settle(); await settle();
  assert.equal(ready, 0, 'the loading shell does not own the fallback');
  assert.equal(f.p.get().box.hidden, true, 'the pending replacement cannot duplicate native To Do');
  for (const release of f.held.splice(0)) release();
  await settle(); await settle();
  assert.ok(ready > 0, 'a rendered list claims the fallback');
  assert.equal(f.p.get().box.hidden, false);
});

test('a retained task draft never follows a different signed-in account', async () => {
  let account = '3';
  const f = feature({ profile: async () => ({ id: account, time_zone: 'UTC' }) });
  const ui = f.c.GZ_TODO_UI, target = new E();
  ui.mount(target, { courseId: '', scope: 'follow' }); await settle(); await settle();
  f.p.form({ cid: '25', draft: { title: 'Private outline' } });
  ui.unmount(target);
  account = '4';
  ui.mount(target, { courseId: '', scope: 'follow' }); await settle(); await settle();
  assert.equal(f.p.formNow(), null);
  assert.equal(f.store['draft:todo:https://canvas.test/3'].todo.draft.title, 'Private outline');
});

test('a course-tab switch hands the open task form to the document shown next through the drafts store, never to two at once', async () => {
  const shared = { store: {}, waiting: [] };
  const key = 'draft:todo:https://canvas.test/3';
  const a = feature({ shared }), b = feature({ shared });
  for (const f of [a, b]) f.c.GZ_TODO_UI.mount(new E(), { courseId: '25', scope: 'follow', setScope() {} });
  await settle(); await settle();
  b.c.GZ_TODO_UI.suspend(); // b is a hidden frame
  a.p.form({ cid: '25', draft: { title: 'Essay outline', notes: 'Three sources' } });
  // Switch to b: a keeps the form in the drafts store and lets go of it; b takes it once.
  a.c.GZ_TODO_UI.suspend();
  assert.equal(shared.store[key].todo.draft.title, 'Essay outline');
  assert.equal(a.p.formNow(), null);
  await b.c.GZ_TODO_UI.resume(); await settle();
  assert.deepEqual({ ...b.p.formNow().draft }, { title: 'Essay outline', notes: 'Three sources' });
  assert.equal(key in shared.store, false);
  // And back: it follows again; the document left holds none.
  b.c.GZ_TODO_UI.suspend();
  await a.c.GZ_TODO_UI.resume(); await settle();
  assert.equal(a.p.formNow().draft.title, 'Essay outline');
  assert.equal(b.p.formNow(), null);
  // Without Back up what you type, the form stays in the document's own memory only.
  a.c.GZ_CTX.settings = () => ({ enhance: { drafts: false } });
  a.c.GZ_TODO_UI.suspend();
  assert.equal(a.p.formNow().draft.title, 'Essay outline');
  assert.equal(key in shared.store, false);
});

test('a suspended task list cannot erase a handed-off draft on pagehide or unmount, or refresh on settings changes', async () => {
  const f = feature(), ui = f.c.GZ_TODO_UI, target = new E();
  ui.mount(target, { courseId: '25', scope: 'follow' }); await settle(); await settle();
  f.p.form({ cid: '25', draft: { title: 'Hand this forward' } });
  ui.suspend();
  const key = 'draft:todo:https://canvas.test/3';
  f.p.keepDraft();
  assert.equal(f.store[key]?.todo.draft.title, 'Hand this forward', 'a hidden pagehide preserves the handoff');
  const before = planner(f.calls);
  await f.p.refresh(true);
  assert.equal(planner(f.calls), before, 'no forced refresh while covered');
  ui.mount(target, { courseId: '26', scope: 'follow' });
  await f.p.refresh(true);
  assert.equal(planner(f.calls), before, 'a context update cannot wake a covered list');
  ui.unmount(target);
  assert.equal(f.store[key]?.todo.draft.title, 'Hand this forward', 'hidden teardown preserves the handoff');
});

test('only the latest task draft resume can consume storage after rapid tab switches', async () => {
  const f = feature(), ui = f.c.GZ_TODO_UI;
  ui.mount(new E(), { courseId: '25', scope: 'follow' }); await settle(); await settle();
  ui.suspend();
  const reads = [], key = 'draft:todo:https://canvas.test/3';
  f.c.chrome.storage.local.get = (k, cb) => reads.push(cb);
  const first = ui.resume(); ui.suspend(); const second = ui.resume();
  reads[1]({ [key]: { at: Date.now(), todo: { draft: { title: 'Latest owner' } } } }); await second;
  // The old callback must not consume a newer draft that another document has since deposited.
  f.store[key] = { at: Date.now(), todo: { draft: { title: 'Waiting for next owner' } } };
  f.p.form(null);
  reads[0]({ [key]: { at: Date.now(), todo: { draft: { title: 'Old snapshot' } } } }); await first;
  assert.equal(f.p.formNow(), null);
  assert.equal(f.store[key].todo.draft.title, 'Waiting for next owner');
});

test('a draft handoff committed after the next document resumed arrives through storage, and failed backups stay in memory', async () => {
  const shared = { store: {}, waiting: [] }, key = 'draft:todo:https://canvas.test/3';
  const a = feature({ shared }), b = feature({ shared });
  for (const f of [a, b]) f.c.GZ_TODO_UI.mount(new E(), { courseId: '25', scope: 'follow' });
  await settle(); await settle(); b.c.GZ_TODO_UI.suspend();
  const held = [], set = a.c.chrome.storage.local.set;
  a.c.chrome.storage.local.set = (v, cb) => { if (v[key]) held.push(() => { set(v, () => cb?.()); b.p.onStore({ [key]: { newValue: v[key] } }, 'local'); }); else set(v, cb); };
  a.p.form({ draft: { title: 'Late handoff' } }); a.c.GZ_TODO_UI.suspend();
  await b.c.GZ_TODO_UI.resume(); assert.equal(b.p.formNow(), null, 'the first read precedes commit');
  held.shift()(); await settle();
  assert.equal(b.p.formNow()?.draft.title, 'Late handoff'); assert.equal(a.p.formNow(), null);
  b.c.GZ_TODO_UI.suspend();
  a.c.chrome.storage.local.set = (v, cb) => { a.c.chrome.runtime.lastError = { message: 'quota' }; cb(); a.c.chrome.runtime.lastError = undefined; };
  await a.c.GZ_TODO_UI.resume(); a.p.form({ draft: { title: 'Keep on failure' } }); a.c.GZ_TODO_UI.suspend();
  await settle(); assert.equal(a.p.formNow()?.draft.title, 'Keep on failure', 'a rejected backup cannot lose the only copy');
});

// The head keeps what is used every day (the view switch in the dock, Add task); Share sessions and Export wait behind ⋯.
test("the head: Add task and ⋯ only; ⋯ opens Share sessions and Export, and choosing one closes it", async () => {
  const f = feature();
  const target = new E();
  f.c.GZ_TODO_UI.mount(target, { courseId: '25', scope: 'follow', setScope() {} });
  await settle(); await settle();
  const head = () => f.p.get().box.children[0];
  const acts = () => head().children.filter((x) => x?.dataset?.act).map((x) => x.dataset.act);
  const row = () => head().children.find((x) => x?.className === 'gz-todo-tools');
  assert.deepEqual(acts(), ['add', 'tools']);
  assert.equal(row(), undefined);
  assert.ok(head().children.find((x) => x?.className === 'gz-todo-scope'), 'the view switch stays');
  const more = head().children.find((x) => x.dataset?.act === 'tools');
  assert.equal(more.attrs['aria-expanded'], 'false');
  f.p.onClick({ target: { closest: () => more } });
  assert.deepEqual(row().children.map((x) => x.dataset.act), ['sessions', 'ics']);
  assert.equal(head().children.find((x) => x.dataset?.act === 'tools').attrs['aria-expanded'], 'true');
  f.p.onClick({ target: { closest: () => row().children[0] } }); // a script's click: nothing opens, but the row closes
  assert.equal(row(), undefined, 'choosing one closes it');
  await settle();
});

// An announcement in the list opens in Glaze's pop-up (features/announce.js, stood in for here) as its settings say, and
// keeps the browser's own for a modifier or middle click; once Canvas has it as read, the list says so too.
test('an announcement opens through GZ_ANNOUNCE for a plain click; Ctrl, Cmd, Shift, Alt keep the browser\'s', async () => {
  const f = feature();
  const gone = [];
  f.c.GZ_ANNOUNCE = { ready: Promise.resolve(), go: (r) => gone.push(r) };
  const loaded = [];
  f.c.GZ_CTX.need = async (file) => { loaded.push(file); };
  const ann = { type: 'announcement', id: '7', cid: '25', course: 'BIO', title: 'Lab moved', at: Date.now() - 864e5, url: '/courses/25/discussion_topics/7', read: false };
  f.p.seed({ prefs: O, cache: { key: 'todo:https://canvas.test/3', at: Date.now(), items: [ann], grading: [], sums: {} } });
  f.p.render(true);
  const a = { dataset: { ann: 'announcement:7' }, href: 'https://canvas.test/courses/25/discussion_topics/7' };
  const click = (o = {}) => ({ target: { closest: (s) => (s === 'a[data-ann]' ? a : null) }, button: 0, isTrusted: true, prevented: false, preventDefault() { this.prevented = true; }, ...o });
  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { isTrusted: false }]) {
    const e = click(mod);
    f.p.onClick(e);
    assert.equal(e.prevented, false, JSON.stringify(mod));
  }
  await settle();
  assert.deepEqual(gone, []);
  const e = click();
  f.p.onClick(e);
  assert.equal(e.prevented, true);
  await settle();
  assert.deepEqual(loaded, ['features/announce.js']);
  const r = gone[0];
  assert.deepEqual({ site: r.site, entry: r.entry, courseId: r.courseId, id: r.id, url: r.url, title: r.title, course: r.course },
    { site: 'canvas', entry: 'glaze', courseId: '25', id: '7', url: 'https://canvas.test/courses/25/discussion_topics/7', title: 'Lab moved', course: 'BIO' });
  assert.equal(typeof r.from, 'function', 'focus goes back to the link as drawn after the list redraws');
  r.onRead();
  assert.equal(f.p.get().cache.items[0].read, true, 'read once Canvas has it');
});
