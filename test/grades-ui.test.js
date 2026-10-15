// The Canvas grades extras as they behave on a page (features/grades.js, and content-canvas.js' card grades), run in a VM
// on a small stand-in for the DOM and chrome.storage, with Canvas's answers from the local Canvas fixture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../lib/i18n.js');
const live = require('./fixtures/canvas-grades.json');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

// ---- a DOM stand-in: elements, a tree, events, and the few selectors the code uses ----
const matches = (el, sel) => sel.split(',').some((one) => {
  const s = one.trim();
  const m = s.match(/^([a-z]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)(?:(\*?=)"([^"]*)")?\])?$/i);
  if (!m) throw new Error(`selector the stand-in can't read: ${s}`);
  const [, tag, classes, attr, op, value] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const own = String(el.className || '').split(/\s+/);
  if (classes && !classes.slice(1).split('.').every((c) => own.includes(c))) return false;
  if (attr) {
    const v = attr.startsWith('data-') ? el.dataset[attr.slice(5)] : el.getAttribute(attr);
    if (v == null || (op && (op === '=' ? v !== value : !v.includes(value)))) return false;
  }
  return true;
});
class El {
  constructor(tag, doc) { Object.assign(this, { tagName: tag.toUpperCase(), doc, children: [], parentNode: null, dataset: {}, attrs: {}, on: {}, style: { display: '' }, own: '', className: '', id: '' }); }
  get textContent() { return this.own + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of [...this.children]) c.remove(); this.own = String(v); }
  append(...kids) {
    for (const k of kids) {
      if (k === '' || k == null) continue;
      const n = typeof k === 'string' ? Object.assign(new El('#text', this.doc), { own: k }) : k;
      n.remove();
      n.parentNode = this;
      this.children.push(n);
    }
  }
  replaceChildren(...kids) { for (const c of [...this.children]) c.remove(); this.own = ''; this.append(...kids); }
  remove() { const p = this.parentNode; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentNode = null; } }
  before(n) { n.remove(); const p = this.parentNode; p.children.splice(p.children.indexOf(this), 0, n); n.parentNode = p; }
  after(n) { n.remove(); const p = this.parentNode; p.children.splice(p.children.indexOf(this) + 1, 0, n); n.parentNode = p; }
  get nextElementSibling() { const p = this.parentNode; return (p && p.children[p.children.indexOf(this) + 1]) || null; }
  get previousElementSibling() { const p = this.parentNode; return (p && p.children[p.children.indexOf(this) - 1]) || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.doc.body; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
  fire(type) { for (const f of this.on[type] || []) f({ type, target: this, preventDefault() {} }); }
  focus() { this.doc.activeElement = this; }
  all(pred, out = []) { for (const c of this.children) { if (c.tagName !== '#TEXT' && pred(c)) out.push(c); c.all(pred, out); } return out; }
  querySelectorAll(sel) { return this.all((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let n = this; n && n !== this.doc.body; n = n.parentNode) if (matches(n, sel)) return n; return null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
}
const page = () => {
  const doc = { activeElement: null };
  doc.body = new El('body', doc);
  doc.createElement = (tag) => new El(tag, doc);
  doc.getElementById = (id) => doc.body.all((e) => e.id === id)[0] || null;
  doc.querySelector = (sel) => doc.body.querySelector(sel);
  doc.querySelectorAll = (sel) => doc.body.querySelectorAll(sel);
  return doc;
};
const el = (doc, tag, props = {}, ...kids) => { const e = Object.assign(doc.createElement(tag), props); e.append(...kids); return e; };
const find = (root, pred) => root.all(pred)[0];
const byText = (root, text) => find(root, (e) => e.tagName === 'BUTTON' && e.textContent === text);

// chrome.storage.local shared by every tab and the service worker, with change events. A tab's view of it answers
// on the next turn, or, while that tab is held, when the test lets it; it reads when asked, as Chrome does.
const shared = (init = {}) => {
  const data = structuredClone(init);
  const listeners = [];
  const tell = (ch) => { if (Object.keys(ch).length) for (const f of listeners) f(ch, 'local'); };
  const pick = (keys) => Object.fromEntries((keys == null ? Object.keys(data) : [].concat(keys)).filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
  const set = (patch) => { const ch = {}; for (const [k, v] of Object.entries(patch)) { ch[k] = { oldValue: data[k], newValue: structuredClone(v) }; data[k] = structuredClone(v); } tell(ch); };
  const remove = (keys) => { const ch = {}; for (const k of [].concat(keys)) if (k in data) { ch[k] = { oldValue: data[k] }; delete data[k]; } tell(ch); };
  // The worker's writes fail for keys in `fail` (a full disk, a quota), as Chrome's reject.
  const fail = new Set();
  const worker = {
    get: (k) => Promise.resolve(pick(k)),
    set: (p) => (Object.keys(p).some((k) => fail.has(k)) ? Promise.reject(new Error('QUOTA_BYTES')) : (set(p), Promise.resolve())),
    remove: (k) => { remove(k); return Promise.resolve(); },
  };
  const tab = (held) => ({
    get: (k, cb) => { const v = pick(k); const run = () => cb(v); if (held.on) held.queue.push(run); else Promise.resolve().then(run); },
    set: (p, cb) => { set(p); cb?.(); },
    remove: (k, cb) => { remove(k); cb?.(); },
  });
  return { data, listeners, worker, tab, fail };
};
// The service worker (lib/background.js) on that storage, answering messages as Chrome would.
const WORKER_ID = 'glaze-test-id';
const serviceWorker = (store) => {
  const listeners = [];
  const none = { addListener() {} };
  const empty = { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() };
  const ctx = vm.createContext({
    URL, console, setTimeout, clearTimeout, TextEncoder,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), ctx); },
    chrome: {
      runtime: { id: WORKER_ID, getURL: (p = '') => `chrome-extension://${WORKER_ID}/${p}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local: store.worker, sync: empty, onChanged: none },
      scripting: { executeScript: () => Promise.resolve([]) },
    },
  });
  vm.runInContext(read('lib/background.js'), ctx);
  return (m, sender) => new Promise((resolve) => {
    let waits = false;
    for (const f of listeners) if (f(m, sender, (r) => resolve(r === undefined ? r : JSON.parse(JSON.stringify(r)))) === true) waits = true;
    if (!waits) resolve(undefined);
  });
};

// BIO 1100 from the local Canvas: its course-list row (Canvas's totals, the student) and its assignment groups.
const BIO = live.courses.find((c) => c.course.course_code === 'BIO 1100');
const ORIGIN = 'https://school.instructure.com';
const KEY = `whatIf:${ORIGIN}:3`;
const row = (more = {}) => ({ ...BIO.course, id: String(BIO.course.id), name: 'Introduction to Biology', enrollments: [{ type: 'student', user_id: '3', ...BIO.course.enrollment }], ...more });

// features/grades.js on a course's Grades page in one tab, with Canvas's answers held until the test lets them through.
// Tabs share `store` and its service worker; `held.on` holds this tab's storage reads and messages (a slow tab).
const gradesPage = ({ store = shared(), list = [row()], search = '', groups = BIO.groups, capi = () => Promise.resolve(null), tab = 1 } = {}) => {
  const doc = page();
  doc.body.append(el(doc, 'div', { id: 'assignments' }, el(doc, 'table', { id: 'grades_summary' })));
  const state = { on: true, settings: { enabled: true, enhance: { calc: true, gpa: false } }, fetches: [] };
  const held = { on: false, queue: [] };
  store.send ||= serviceWorker(store);
  const sender = { id: WORKER_ID, tab: { id: tab }, frameId: 0, url: `${ORIGIN}/courses/${BIO.course.id}/grades` };
  const sendMessage = (m) => new Promise((resolve) => { const run = () => store.send(m, sender).then(resolve); if (held.on) held.queue.push(run); else run(); });
  const fetch = () => new Promise((resolve, reject) => state.fetches.push({
    ok: () => resolve({ ok: true, text: async () => JSON.stringify(groups), headers: { get: () => '' } }),
    fail: () => resolve({ ok: false, status: 503 }),
    drop: () => reject(new Error('offline')),
  }));
  const chrome = { runtime: { sendMessage }, storage: { local: store.tab(held), sync: shared().tab({}), onChanged: { addListener: (f) => store.listeners.push(f) } } };
  const ctx = vm.createContext({
    document: doc, location: { pathname: `/courses/${BIO.course.id}/grades`, search, origin: ORIGIN },
    CSS: { escape: (s) => s }, queueMicrotask, URLSearchParams, URL, Intl, fetch, GZ_I18N: I, chrome,
    GZ_CTX: {
      t: (k, v) => I.t(k, v, 'en'), locale: () => 'en', capi, canvasCourses: () => Promise.resolve(list), canvasCourseId: () => String(BIO.course.id),
      need: (f, ready) => (ready() ? Promise.resolve() : Promise.reject(new Error('not loaded'))), settings: () => state.settings, on: () => state.on,
    },
  });
  vm.runInContext(read('lib/gradecalc.js'), ctx);
  vm.runInContext(read('features/grades.js'), ctx);
  const release = () => { held.on = false; while (held.queue.length) held.queue.shift()(); };
  return { doc, state, store, held, release, UI: ctx.GZ_GRADES_UI, box: () => doc.getElementById('gz-calc') };
};
const ready = async (p) => { p.UI.render(); await settle(); if (p.state.fetches.length) p.state.fetches.shift().ok(); await settle(); if (!p.box().open) await open(p); if (p.state.fetches.length) p.state.fetches.shift().ok(); await settle(); };
const open = async (p) => { const b = p.box(); b.open = true; b.fire('toggle'); await settle(); };
const totals = (p) => p.box().all((e) => e.tagName === 'DD').map((d) => d.textContent);

test('nothing is drawn by work that finishes after Glaze was switched off', async () => {
  const p = gradesPage({ store: shared({ [KEY]: { [BIO.course.id]: { s: {}, h: [], p: [], c: 70 } } }) });
  p.UI.render();
  await settle();
  assert.ok(p.box(), 'the calculator is there while the course loads');
  // Switched off: content.js's disable() takes the box away; then Canvas answers.
  p.state.on = false;
  p.box().remove();
  p.state.fetches.shift().ok();
  await settle();
  assert.equal(p.box(), null);
  p.UI.render();
  assert.equal(p.box(), null, 'nor by a later pass');
  p.state.on = true;
  p.state.settings = { ...p.state.settings, enabled: false };
  p.UI.render();
  assert.equal(p.box(), null, 'the theme switched off counts too');
});

test('two tabs: a change still on its way from one tab doesn’t bring back what Clear all in another removed', async () => {
  const store = shared({ [KEY]: { [BIO.course.id]: { s: {}, h: [], p: [], c: 70, at: 1 }, 26: { s: {}, h: [], p: [], c: 80, at: 1 } } });
  const a = gradesPage({ store, tab: 1 });
  const b = gradesPage({ store, tab: 2 });
  await ready(a);
  await ready(b);
  assert.deepEqual(totals(a), ['83.85%', '83.85%', '21.92%']);
  // Tab A is slow: its storage and its messages wait. A score typed there, then Clear all in tab B.
  a.held.on = true;
  const score = find(a.box(), (e) => e.dataset.f === 's:175');
  score.value = '90';
  score.fire('input');
  await settle();
  assert.equal(totals(a)[1], '86%');
  byText(b.box(), 'Clear all courses').fire('click');
  await settle(10);
  a.release();
  await settle(10);
  assert.equal(store.data[KEY], undefined, 'no course comes back');
  assert.deepEqual(totals(a), ['83.85%', '83.85%', '21.92%'], 'and tab A shows the clear too');
  // A change made after the clear is kept.
  const again = find(a.box(), (e) => e.dataset.f === 's:175');
  again.value = '80';
  again.fire('input');
  await settle(10);
  assert.deepEqual(store.data[KEY][BIO.course.id].s['175'].slice(0, 2), [80, null]);
});

test('a Clear all that can’t be recorded clears nothing and says so; one that was can’t be undone by an earlier edit after a restart', async () => {
  const store = shared({ [KEY]: { [BIO.course.id]: { s: { 175: [90, null] }, h: [], p: [], c: 70, at: 1 } } });
  store.fail.add('whatIfCleared');
  const p = gradesPage({ store });
  await ready(p);
  assert.equal(totals(p)[1], '86%');
  byText(p.box(), 'Clear all courses').fire('click');
  await settle(10);
  assert.match(p.box().textContent, /Not cleared\. Try again in a moment\./);
  assert.equal(totals(p)[1], '86%', 'still shown');
  assert.deepEqual(store.data[KEY][BIO.course.id].s, { 175: [90, null] }, 'and still stored');
  assert.equal(store.data.whatIfCleared, undefined);
  // Recorded this time. Then the worker restarts and an edit made before the clear arrives.
  store.fail.clear();
  byText(p.box(), 'Clear all courses').fire('click');
  await settle(10);
  assert.equal(store.data[KEY], undefined);
  assert.doesNotMatch(p.box().textContent, /Not cleared/);
  const restarted = serviceWorker(store);
  const sender = { id: WORKER_ID, tab: { id: 9 }, frameId: 0, url: `${ORIGIN}/courses/${BIO.course.id}/grades` };
  assert.deepEqual(await restarted({ type: 'glaze:whatif', op: 'course', key: KEY, cid: String(BIO.course.id), rec: { s: { 175: [90, null] }, h: [], p: [] }, at: 2 }, sender), { ok: true });
  assert.equal(store.data[KEY], undefined, 'nothing comes back');
});

test('a page may change only its own Canvas site’s what-if records', async () => {
  const store = shared();
  const send = serviceWorker(store);
  const from = (url) => ({ id: WORKER_ID, tab: { id: 3 }, frameId: 0, url });
  const op = (key) => ({ type: 'glaze:whatif', op: 'grade', key, cid: '25', c: 90, at: Date.now() });
  assert.deepEqual(await send(op(`whatIf:${ORIGIN}:3`), from(`${ORIGIN}/`)), { ok: true });
  assert.deepEqual(await send(op('whatIf:https://other.instructure.com:3'), from(`${ORIGIN}/`)), { ok: false, error: 'sender' });
  assert.deepEqual(await send(op(`whatIf:${ORIGIN}:3`), from('https://example.com/')), { ok: false, error: 'sender' });
  assert.deepEqual(await send({ ...op(`whatIf:${ORIGIN}:3`), op: 'everything' }, from(`${ORIGIN}/`)), { ok: false, error: 'sender' });
  assert.deepEqual(Object.keys(store.data), [`whatIf:${ORIGIN}:3`]);
});

// Syllabus import (features/syllabus.js) keeps what a syllabus said through the same worker ('glaze:syllabus').
test('a page keeps or deletes only its own Canvas site’s syllabus records, and only what lib/syllabus.js allows', async () => {
  const store = shared();
  const send = serviceWorker(store);
  const from = (url) => ({ id: WORKER_ID, tab: { id: 3 }, frameId: 0, url });
  const key = `syllabus:${ORIGIN}/3/25`;
  const rec = { prof: { name: 'Dr. Okafor', email: 'a@b.edu' }, weights: [{ name: 'Labs', weight: 40 }], html: '<b>', scale: [['A', 93]] };
  const kept = await send({ type: 'glaze:syllabus', key, rec, at: 10 }, from(`${ORIGIN}/courses/25`));
  assert.equal(kept.ok, true);
  assert.deepEqual(store.data[key], kept.rec);
  assert.equal(store.data[key].html, undefined, 'tidied');
  assert.deepEqual(await send({ type: 'glaze:syllabus', key: 'syllabus:https://other.instructure.com/3/25', rec, at: 11 }, from(`${ORIGIN}/`)), { ok: false, error: 'sender' });
  assert.deepEqual(await send({ type: 'glaze:syllabus', key, rec, at: 12 }, from('https://example.com/')), { ok: false, error: 'sender' });
  assert.deepEqual(await send({ type: 'glaze:syllabus', key, rec: { prof: {} }, at: 13 }, from(`${ORIGIN}/`)), { ok: false, error: 'bad' });
  assert.equal((await send({ type: 'glaze:syllabus', key, rec: null, at: 14 }, from(`${ORIGIN}/`))).ok, true);
  assert.deepEqual(store.data, { [key]: { deleted: 14 } }, 'only the time of the delete is left');
});

test('the what-if calculator shows the syllabus\'s weights as a note, and still counts Canvas\'s', async () => {
  const sylKey = `syllabus:${ORIGIN}/3/${BIO.course.id}`;
  const plain = gradesPage();
  await ready(plain);
  const p = gradesPage({ store: shared({ [sylKey]: { weights: [{ name: 'Labs', weight: 50 }, { name: 'Exams', weight: 50 }] } }) });
  await ready(p);
  const note = find(p.box(), (e) => e.tagName === 'P' && e.textContent.startsWith('Your syllabus lists'));
  assert.equal(note?.textContent, 'Your syllabus lists Labs 50%, Exams 50%. Glaze counts the weights Canvas has.');
  assert.deepEqual(totals(p), totals(plain), 'the figures are Canvas\'s');
  assert.equal(find(plain.box(), (e) => e.tagName === 'P' && e.textContent.startsWith('Your syllabus')), undefined);
});

test('a course that failed to load can be asked for again', async () => {
  const p = gradesPage();
  p.UI.render();
  await settle();
  await open(p);
  p.state.fetches.shift().fail();
  await settle();
  const retry = byText(p.box(), 'Try again');
  assert.ok(retry, 'a Try again button');
  retry.fire('click');
  await settle();
  assert.equal(p.state.fetches.length, 1, 'one request, not a loop');
  p.state.fetches.shift().ok();
  await settle();
  assert.deepEqual(totals(p), ['83.85%', '83.85%', '21.92%']);
});

test('a pretend assignment added while a grading period is shown belongs to that period', async () => {
  const periods = [
    { id: '1', start_date: '2026-08-01T00:00:00Z', end_date: '2026-10-10T00:00:00Z', weight: 50 },
    { id: '2', start_date: '2026-10-10T00:00:00Z', end_date: '2026-12-31T00:00:00Z', weight: 50 },
  ];
  const p = gradesPage({ search: '?grading_period_id=1', list: [row({ has_grading_periods: true })], capi: (q) => Promise.resolve(/grading_periods/.test(q) ? { grading_periods: periods } : null) });
  p.UI.render();
  await settle();
  await open(p);
  p.state.fetches.shift().ok();
  await settle();
  const groups = p.box().all((e) => e.tagName === 'FIELDSET');
  byText(groups[0], 'Add a pretend assignment').fire('click');
  await settle();
  const saved = p.store.data[KEY][BIO.course.id].p;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].pd, '1');
  assert.ok(find(p.box(), (e) => e.dataset.f === `n:${saved[0].id}`), 'and is shown in it');
});

// ---- the GPA on the Dashboard ----
const gpaPage = ({ store = shared(), list, capi }) => {
  const doc = page();
  doc.body.append(el(doc, 'div', { id: 'DashboardCard_Container' }));
  const state = { settings: { enabled: true, enhance: { gpa: true, gpaPlus: true } } };
  const chrome = { runtime: { sendMessage: () => Promise.resolve() }, storage: { local: store.tab({}), sync: shared().tab({}), onChanged: { addListener: (f) => store.listeners.push(f) } } };
  const ctx = vm.createContext({
    document: doc, location: { pathname: '/', search: '', origin: ORIGIN }, CSS: { escape: (s) => s }, queueMicrotask, URLSearchParams, URL, Intl, GZ_I18N: I, chrome,
    GZ_CTX: {
      t: (k, v) => I.t(k, v, 'en'), locale: () => 'en', capi, canvasCourses: () => Promise.resolve(list), canvasCourseId: () => undefined,
      need: (f, ready) => (ready() ? Promise.resolve() : Promise.reject(new Error('not loaded'))), settings: () => state.settings, on: () => true,
    },
  });
  vm.runInContext(read('lib/gradecalc.js'), ctx);
  vm.runInContext(read('features/grades.js'), ctx);
  return { doc, UI: ctx.GZ_GRADES_UI, box: () => doc.getElementById('gz-gpa') };
};

test('GPA: a course answer without a grading scheme says the what-if needs a scale, rather than waiting for ever', async () => {
  const asked = [];
  const p = gpaPage({
    store: shared({ [KEY]: { 27: { s: {}, h: [], p: [], c: 92, at: 1 } } }),
    list: [{ id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 92, computed_current_grade: 'A' }], term: { id: '1', name: 'Fall 2026', start_at: '2026-08-01T00:00:00Z' } }],
    capi: (q) => { asked.push(q); return Promise.resolve({ id: '27' }); },
  });
  p.UI.render();
  await settle(10);
  assert.deepEqual(asked, ['/courses/27?include[]=grading_scheme'], 'asked once');
  const text = p.box().textContent;
  assert.match(text, /Give Calculus I a grading scale below to count its what-if grade\./);
  p.UI.render();
  await settle(10);
  assert.equal(asked.length, 1, 'and not again');
});

// The GPA with past terms, trends and a goal (features/gpaterms.js, lib/gpa.js), kept through the service worker.
const CALC = [{ id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 92 }], term: { id: '1', name: 'Fall 2026', start_at: '2026-08-01T00:00:00Z' } }];
// extra: more of the page's globals (a stand-in features/import.js, say).
const histPage = (store, held = {}, list = CALC, groups = [], sync = {}, extra = {}) => {
  const doc = page();
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  doc.body.append(el(doc, 'div', { id: 'DashboardCard_Container' }));
  const state = { settings: { enabled: true, enhance: { gpa: true, gpaPlus: true } } };
  store.send ||= serviceWorker(store);
  const sender = { id: WORKER_ID, tab: { id: 1 }, frameId: 0, url: `${ORIGIN}/` };
  let ctx;
  const need = (f, ready) => { if (!ready()) vm.runInContext(read(f), ctx); return ready() ? Promise.resolve() : Promise.reject(new Error('not loaded')); };
  const chrome = { runtime: { sendMessage: (m) => store.send(m, sender) }, storage: { local: store.tab(held), sync: shared(sync).tab({}), onChanged: { addListener: (f) => store.listeners.push(f) } } };
  ctx = vm.createContext({
    document: doc, location: { pathname: '/', search: '', hash: '', origin: ORIGIN }, CSS: { escape: (s) => s }, queueMicrotask, URLSearchParams, URL, Intl, AbortController, GZ_I18N: I, chrome,
    TextEncoder, fetch: () => Promise.resolve({ ok: true, text: async () => JSON.stringify(groups), headers: { get: () => '' } }),
    GZ_CTX: {
      t: (k, v) => I.t(k, v, 'en'), locale: () => 'en', capi: () => Promise.resolve(null), canvasCourses: () => Promise.resolve(list), canvasCourseId: () => undefined,
      need, settings: () => state.settings, on: () => true,
    },
    ...extra,
  });
  vm.runInContext(read('lib/gradecalc.js'), ctx);
  vm.runInContext(read('features/grades.js'), ctx);
  const box = () => doc.getElementById('gz-gpa');
  const f = (key) => find(box(), (e) => e.dataset.f === key);
  return { doc, UI: ctx.GZ_GRADES_UI, box, f, hist: () => find(box(), (e) => /gz-gpa-hist\b/.test(e.className)) };
};

test('GPA: past terms count in the overall GPA, show as a trend table, set a goal and come in from a transcript', async () => {
  const TKEY = `gpaTerms:${ORIGIN}:3`;
  const store = shared({ [TKEY]: { t: [
    { id: 'b', n: 'Spring 2026', c: [{ n: 'MATH 201', cr: 4, g: 'B' }, { n: 'HIST 110', cr: 3, g: 'W' }] },
    { id: 'a', n: 'Fall 2025', c: [{ n: 'BIO 101', cr: 4, g: 'A-' }, { n: 'ENG 101', cr: 3, g: 'B+' }, { n: 'ART 120', cr: 2, g: 'P' }] },
  ] } });
  const p = histPage(store);
  p.UI.render();
  await settle(10);
  // Fall 24.7 over 7, Spring 12 over 4, Calculus I at 92% is an A- (3.7) over 3: 47.8 / 14.
  assert.match(p.box().textContent, /3\.41Overall, with past terms/);
  const h = p.hist();
  h.open = true;
  h.fire('toggle');
  await settle(10);
  const table = find(h, (e) => e.tagName === 'TABLE' && /Your GPA by term/.test(e.textContent));
  assert.deepEqual(table.all((e) => e.tagName === 'TR').slice(1).map((r) => r.children.map((c) => c.textContent)),
    [['Fall 2025', '3.53', '7', '3.53'], ['Spring 2026', '3.00', '4', '3.34'], ['Fall 2026Now, from Canvas', '3.70', '3', '3.41']], 'oldest first, then this term');
  assert.ok(find(h, (e) => e.tagName === 'SVG' && e.getAttribute('aria-hidden') === 'true'), 'a chart, with the table for screen readers');
  assert.match(h.textContent, /Withdrawn: not in the GPA/);
  // A goal out of reach, then one within it.
  p.f('goal:v').value = '3.5';
  p.f('goal:v').fire('change');
  await settle(10);
  assert.deepEqual(store.data[TKEY].g, { k: 'cum', v: 3.5 }, 'kept by the service worker');
  assert.match(p.hist().textContent, /Out of reach this term: the best grades your courses can still give would bring your cumulative GPA to 3\.48\./);
  p.f('goal:v').value = '3.4';
  p.f('goal:v').fire('change');
  await settle(10);
  assert.match(p.hist().textContent, /This term needs a GPA of 3\.64: about A- in every course\.Your grades now get you there\./);
  // A term from a transcript's text: reviewed first, then kept.
  p.f('imp:text').value = 'Fall 2024\nCHEM 101 General Chemistry 4.00 C+\nTerm GPA: 2.30';
  p.f('imp:text').fire('input');
  byText(p.hist(), 'Read it').fire('click');
  await settle(10);
  assert.match(p.hist().textContent, /Your transcript says 2\.30; Glaze makes it 2\.30\./);
  assert.equal(store.data[TKEY].t.length, 2, 'nothing kept before review');
  byText(p.hist(), 'Add these terms').fire('click');
  await settle(10);
  assert.deepEqual(store.data[TKEY].t.map((x) => x.n), ['Spring 2026', 'Fall 2025', 'Fall 2024']);
  const trend = find(p.hist(), (e) => e.tagName === 'TABLE' && /Your GPA by term/.test(e.textContent));
  assert.equal(trend.all((e) => e.tagName === 'TR')[1].children[0].textContent, 'Fall 2024', 'first in the trend');
  // A new term, kept at once.
  byText(p.hist(), 'Add a term').fire('click');
  await settle(10);
  assert.equal(store.data[TKEY].t.length, 4);
  const other = await store.send({ type: 'glaze:gpaterms', key: 'gpaTerms:https://other.instructure.com:3', op: 'clear', at: Date.now() }, { id: WORKER_ID, tab: { id: 1 }, frameId: 0, url: `${ORIGIN}/` });
  assert.deepEqual(other, { ok: false, error: 'sender' }, "a page can't change another site's terms");
});

// A goal for this term, with the GPA view open.
const goalPage = async (list, groups, goal = { k: 'term', v: 3.5 }, sync = {}) => {
  const p = histPage(shared({ [`gpaTerms:${ORIGIN}:3`]: { t: [], g: goal } }), {}, list, groups, sync);
  p.UI.render();
  await settle(10);
  p.hist().open = true;
  p.hist().fire('toggle');
  await settle(10);
  return p;
};
const term = { id: '1', name: 'Fall 2026', start_at: '2026-08-01T00:00:00Z' };

test('GPA goal: a pass/fail course is no GPA course, and a course with no grade yet doesn\'t make the goal "met now"', async () => {
  const p = await goalPage([
    { id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3' }], term },
    { id: '28', name: 'Art Studio', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 95, computed_current_grade: 'P' }], term },
  ]);
  const text = p.hist().textContent;
  assert.doesNotMatch(text, /Your grades now get you there/);
  assert.match(text, /Some courses have no grade yet, so whether your grades now get you there isn't known\. One way there:/);
  assert.match(text, /Calculus I/);
  assert.doesNotMatch(text.slice(text.indexOf('One way there')), /Art Studio/, 'the P course is offered no letter');
});

test('GPA goal: What it takes aims at the percent that rounds to the letter, as the route does', async () => {
  // 799.96 of 900 earned, 100 left: full marks make 89.996%, which Canvas shows as 90%, an A-.
  const groups = [{ id: '1', name: 'All', group_weight: 0, assignments: [
    { id: 'a', name: 'Done', points_possible: 900, submission: { score: 799.96 } }, { id: 'b', name: 'Final', points_possible: 100, submission: {} }] }];
  const p = await goalPage([{ id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 88.88 }], term }], groups, { k: 'term', v: 3.7 });
  assert.match(p.hist().textContent, /Calculus IB\+A-90%\+What it takes/);
  byText(p.hist(), 'What it takes').fire('click');
  await settle(20);
  const text = p.hist().textContent;
  assert.doesNotMatch(text, /Out of reach|no way there/);
  assert.match(text, /A-90%\+You'd need about 100% on the item left\./);
});

test('GPA goal: What it takes on a bound off the hundredths (A- from 90.004) aims where Canvas rounds into it', async () => {
  // 800.01 of 900 earned, 100 left: full marks make 90.001%, shown as 90.00%, which is under 90.004: a B+.
  const groups = [{ id: '1', name: 'All', group_weight: 0, assignments: [
    { id: 'a', name: 'Done', points_possible: 900, submission: { score: 800.01 } }, { id: 'b', name: 'Final', points_possible: 100, submission: {} }] }];
  const sync = { gpaCourses: { [`canvas:${ORIGIN}/27`]: { s: 'A 94, A- 90.004, B+ 87, B 84, B- 80, C 70, F 0' } } };
  const p = await goalPage([{ id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 88.89 }], term }], groups, { k: 'term', v: 3.7 }, sync);
  assert.match(p.hist().textContent, /Calculus IB\+A-90%\+What it takes/);
  byText(p.hist(), 'What it takes').fire('click');
  await settle(20);
  const text = p.hist().textContent;
  assert.doesNotMatch(text, /You'd need about/);
  assert.match(text, /Out of reach: the best grades your courses can still give make 3\.30 this term\./, 'the course is held at B+');
});

test('GPA goal: a course not graded yet on a Pass/Fail scale adds no GPA credits', async () => {
  const sync = { gpaCourses: { [`canvas:${ORIGIN}/28`]: { s: 'P 60, F 0' } } };
  const p = await goalPage([
    { id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 95 }], term },
    { id: '28', name: 'Art Studio', enrollments: [{ type: 'student', user_id: '3' }], term },
  ], [], { k: 'term', v: 4 }, sync);
  const text = p.hist().textContent;
  assert.doesNotMatch(text, /Out of reach/);
  assert.match(text, /This term needs a GPA of 4\.00: about A in every course\./);
  assert.match(text.slice(text.indexOf('Aim for')), /Art Studio–P60%\+Pass Art Studio \(reach P\)\./, 'not routed to a letter: a condition to pass');
});

test('GPA goal: a course with an F now on a Pass/Fail scale is a condition to pass, not left out of "met now"', async () => {
  const sync = { gpaCourses: { [`canvas:${ORIGIN}/28`]: { s: 'P 60, F 0' } } };
  const p = await goalPage([
    { id: '27', name: 'Calculus I', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 95 }], term },
    { id: '28', name: 'Art Studio', enrollments: [{ type: 'student', user_id: '3', computed_current_score: 40 }], term },
  ], [], { k: 'term', v: 4 }, sync);
  const text = p.hist().textContent;
  assert.match(text, /Now, from Canvas2\.0062\.00/, 'the trend counts the F now: 2.00 over 6 credits');
  assert.match(text, /This term needs a GPA of 4\.00/, 'passing leaves it out of the best case');
  assert.doesNotMatch(text, /Your grades now get you there/);
  assert.match(text, /One way there, from your grades now:/);
  assert.match(text, /Art StudioFP60%\+Pass Art Studio \(reach P\)\./);
});

test('GPA: a read of past terms held up while another tab removed them all doesn\'t bring them back', async () => {
  const TKEY = `gpaTerms:${ORIGIN}:3`;
  const store = shared({ [TKEY]: { t: [{ id: 'a', n: 'Fall 2025', c: [{ n: 'BIO 101', cr: 4, g: 'A' }] }] } });
  const held = { on: true, queue: [] };
  const p = histPage(store, held);
  p.UI.render();
  await settle(10);
  // Remove all from another tab, while this tab's first read is still on its way.
  const sender = { id: WORKER_ID, tab: { id: 2 }, frameId: 0, url: `${ORIGIN}/` };
  assert.deepEqual(await store.send({ type: 'glaze:gpaterms', key: TKEY, op: 'clear', at: Date.now() }, sender), { ok: true });
  held.on = false;
  while (held.queue.length) held.queue.shift()();
  await settle(10);
  assert.doesNotMatch(p.box().textContent, /with past terms/, 'the old read is dropped');
  p.hist().open = true;
  p.hist().fire('toggle');
  await settle(10);
  assert.doesNotMatch(p.hist().textContent, /Fall 2025/);
  // And a change sent from a view that never saw the clear is refused.
  assert.deepEqual(await store.send({ type: 'glaze:gpaterms', key: TKEY, op: 'term', term: { id: 'a', n: 'Fall 2025', c: [] }, at: Date.now() + 1, base: 0 }, sender), { ok: false, error: 'stale' });
  assert.deepEqual(store.data[TKEY].t, []);
});

test('GPA: a transcript whose term GPA matches over fewer credits than it printed is flagged in review, and its course kept', async () => {
  const TKEY = `gpaTerms:${ORIGIN}:3`;
  const store = shared();
  const p = histPage(store);
  p.UI.render();
  await settle(10);
  p.hist().open = true;
  p.hist().fire('toggle');
  await settle(10);
  p.f('imp:text').value = 'Fall 2025\nCIS301 Software Quality Assurance 3 A\nTerm GPA 4.00 Credits 6.00';
  p.f('imp:text').fire('input');
  byText(p.hist(), 'Read it').fire('click');
  await settle(10);
  const text = p.hist().textContent;
  assert.match(text, /These courses come to 3 credits, a total your transcript doesn't show/);
  assert.match(text, /Your transcript says 4\.00; Glaze makes it 4\.00\. Check the grades and credits\./, 'no reassurance');
  byText(p.hist(), 'Add these terms').fire('click');
  await settle(10);
  assert.deepEqual(store.data[TKEY].t[0].c.map((c) => c.n), ['CIS301 Software Quality Assurance']);
});

test('GPA: of two transcript files picked one after the other, the later one is reviewed even if the earlier is read last', async () => {
  const p = histPage(shared());
  p.UI.render();
  await settle(10);
  p.hist().open = true;
  p.hist().fire('toggle');
  await settle(10);
  const later = [];
  const file = (name, text) => ({ name, type: 'text/plain', size: text.length, slice: () => new Blob([text]), text: () => new Promise((r) => later.push(() => r(text))) });
  const input = p.f('imp:file');
  input.files = [file('fall.txt', 'Fall 2024\nBIO 101 Biology 4 A')];
  input.fire('change');
  p.f('imp:file').files = [file('spring.txt', 'Spring 2025\nENG 101 Writing 3 B')];
  p.f('imp:file').fire('change');
  await settle(10); // both files are being read (features/import.js looks at their first bytes before their text)
  assert.equal(later.length, 2);
  later[1]();
  await settle(10);
  later[0]();
  await settle(10);
  assert.match(p.hist().textContent, /Spring 2025/);
  assert.doesNotMatch(p.hist().textContent, /Fall 2024/);
});

test('GPA: a PDF or photo being read is called off by the next read and by closing Past terms, and nothing it finds is shown after', async () => {
  // features/import.js held: each read waits until the test answers it.
  const reads = [];
  const GZ_IMPORT = { read: (file, opts) => new Promise((resolve) => reads.push({ file, opts, resolve })), note: () => '', doubt: () => false };
  const p = histPage(shared(), {}, CALC, [], {}, { GZ_IMPORT });
  p.UI.render();
  await settle(10);
  p.hist().open = true;
  p.hist().fire('toggle');
  await settle(10);
  const pick = async (name) => { p.f('imp:file').files = [{ name, type: 'application/pdf', size: 9 }]; p.f('imp:file').fire('change'); await settle(10); };
  await pick('fall.pdf');
  await pick('spring.pdf');
  assert.equal(reads.length, 2);
  assert.equal(reads[0].opts.signal.aborted, true, 'the first read stops when the second starts, before either said how far it got');
  assert.equal(reads[1].opts.signal.aborted, false);
  p.hist().open = false;
  p.hist().fire('toggle');
  assert.equal(reads[1].opts.signal.aborted, true, 'closing Past terms, trends and goal stops the read at once');
  reads[1].resolve({ text: 'Spring 2025\nENG 101 Writing 3 B', ocr: null });
  await settle(10);
  p.hist().open = true;
  p.hist().fire('toggle');
  await settle(10);
  assert.doesNotMatch(p.hist().textContent, /Check what Glaze found/, 'what a read stopped by closing found is never shown');
});

// ---- content-canvas.js: the Dashboard cards' grade, as a link of its own ----
const source = read('content-canvas.js');
const block = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return source.slice(a, b); };
const dashboard = () => {
  const doc = page();
  const card = el(doc, 'div', { className: 'ic-DashboardCard' });
  card.setAttribute('aria-label', 'Calculus I');
  const link = el(doc, 'a', { className: 'ic-DashboardCard__link' }, el(doc, 'div', { className: 'ic-DashboardCard__header-subtitle' }, 'MATH 1350'));
  link.setAttribute('href', '/courses/27');
  card.append(el(doc, 'div', { className: 'ic-DashboardCard__header' }, link));
  doc.body.append(card);
  const list = [{ id: '27', enrollments: [{ type: 'student', computed_current_score: 83.5 }] }];
  const ctx = vm.createContext({ document: doc, I: { observer: {} }, GZ_PAGE: require('../lib/page.js'), locale: () => 'en', t: (k, v) => I.t(k, v, 'en'), canvasCourses: () => Promise.resolve(list) });
  vm.runInContext(`${block('  const tagCanvasCards = () => {', '  // Canvas: its course colors come inline')}; globalThis.tag = tagCanvasCards;`, ctx);
  return { doc, card, list, tag: ctx.tag };
};

test('a card’s grade is also a link to the course’s grades, for the keyboard and screen readers', async () => {
  const d = dashboard();
  d.tag();
  await settle();
  const a = d.card.querySelector('.gz-card-grade');
  assert.ok(a, 'a link');
  assert.equal(a.tagName, 'A');
  assert.equal(a.href, '/courses/27/grades');
  assert.equal(a.getAttribute('aria-label'), 'Grades for Calculus I: 83.5%');
  assert.equal(a.closest('.ic-DashboardCard__link'), null, 'beside the card’s own link, not inside it');
  assert.equal(d.card.querySelector('.ic-DashboardCard__link').nextElementSibling, a, 'right after it, next in Tab order');
  d.tag();
  await settle();
  assert.equal(d.card.querySelectorAll('.gz-card-grade').length, 1, 'once');
  d.list[0].enrollments[0].computed_current_score = null;
  d.tag();
  await settle();
  assert.equal(d.card.querySelector('.gz-card-grade'), null, 'and gone with the grade');
});

// ---- Blackboard Ultra (B4): the same what-if and GPA, from Ultra's gradebook through lib/ultra.js ----
const UO = 'https://lms.example.edu';
const UKEY = `whatIf:${UO}:_900_1`; // the student of test/fixtures/ultra-memberships.json
const ufix = (n) => JSON.parse(read(`test/fixtures/ultra-${n}.json`));
const U_NOW = Date.parse('2026-10-15T12:00:00Z'); // in the fixtures' Fall 2026 term
class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [U_NOW])); } static now() { return U_NOW; } }
// features/grades.js on an Ultra page, with B4's anchors: a course's overall grade header, or the Grades page's terms.
// books: what content-ultra.js's bookFor has for each course; answers: Ultra's API by a part of the address.
const ultraPage = ({ store = shared(), path = '/ultra/courses/_101_1/grades', books = { _101_1: ufix('grades').results }, enhance = { calc: true }, answers = {} } = {}) => {
  const doc = page();
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  doc.body.append(/\/outline/.test(path) ? el(doc, 'aside', { className: 'outline-actions' }, el(doc, 'div', { className: 'js-details-and-actions outline-action-block' }), el(doc, 'div', { className: 'conditional-block' }))
    : path.includes('/courses/') ? el(doc, 'div', { className: 'grades-list' }, el(doc, 'aside', { className: 'student-grade-overview' }), el(doc, 'div', { className: 'student-tabs' }))
    : el(doc, 'div', { id: 'body-content' }, el(doc, 'div', { className: 'base-grades' }, el(doc, 'div', { className: 'carousel' }, el(doc, 'div', { id: 'container-term-current' })))));
  const state = { settings: { enabled: true, enhance: { gpaPlus: true, ...enhance } }, asked: [] };
  store.data.ultra ||= [UO]; // a site Glaze has found to be Ultra (lib/background.js fromUltra)
  store.send ||= serviceWorker(store);
  const sender = { id: WORKER_ID, tab: { id: 1 }, frameId: 0, url: `${UO}${path}` };
  let ctx;
  const need = (f, ready) => { if (!ready()) vm.runInContext(read(f), ctx); return ready() ? Promise.resolve() : Promise.reject(new Error('not loaded')); };
  const fetch = (url, o) => {
    state.asked.push([o?.method, o?.redirect, url.replace(UO, '')]);
    const body = Object.entries(answers).find(([k]) => url.includes(k))?.[1];
    return Promise.resolve(body ? { ok: true, text: async () => JSON.stringify(body) } : { ok: false, status: 404 });
  };
  // Promise or callback, as Chrome answers either.
  const sendMessage = (m, cb) => { const r = store.send(m, sender); if (cb) r.then(cb); return r; };
  const chrome = { runtime: { sendMessage }, storage: { local: store.tab({}), sync: shared().tab({}), onChanged: { addListener: (f) => store.listeners.push(f) } } };
  ctx = vm.createContext({
    document: doc, location: { pathname: path, search: '', hash: '', origin: UO }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    CSS: { escape: (s) => s }, queueMicrotask, URLSearchParams, URL, Intl, GZ_I18N: I, chrome, TextEncoder, fetch, Date: FixedDate,
    GZ_PAGE: require('../lib/page.js'), GZ_COURSES: require('../defaults.js').GZ_COURSES,
    GZ_CTX: {
      site: 'ultra', t: (k, v) => I.t(k, v, 'en'), locale: () => 'en', need, settings: () => state.settings, on: () => true,
      courseId: () => path.match(/_\d+_\d+/)?.[0], myCourses: () => Promise.resolve(ufix('memberships').results),
      bookFor: (cid) => (books[cid] ? { results: books[cid], key: `k${cid}` } : { key: '' }),
    },
  });
  vm.runInContext(read('lib/gradecalc.js'), ctx);
  vm.runInContext(read('features/grades.js'), ctx);
  return { doc, state, store, ctx, UI: ctx.GZ_GRADES_UI, box: () => doc.getElementById('gz-calc'), gpa: () => doc.getElementById('gz-gpa') };
};

test("Ultra what-if: under the overall grade, by the course's own recipe (Blackboard's 88%), kept by site and user", async () => {
  const p = ultraPage();
  p.UI.render();
  await settle(10);
  assert.equal(p.doc.querySelector('aside.student-grade-overview').nextElementSibling, p.box(), 'right under the overall grade');
  await open(p);
  await settle(10);
  assert.deepEqual(totals(p), ['88%', '88%', '64%'], 'Blackboard now, with your changes, with work not graded yet as zero');
  assert.doesNotMatch(p.box().textContent, /Estimate/);
  // Lab Report 3, not graded yet, at full marks: Assignment (40%) goes from 90% to 95%.
  const lab3 = find(p.box(), (e) => e.dataset.f === 's:_603_1');
  lab3.value = '100';
  lab3.fire('input');
  await settle(10);
  assert.equal(totals(p)[1], '90%');
  assert.deepEqual(p.store.data[UKEY]._101_1.s._603_1.slice(0, 2), [100, null]);
  // A pretend item in a category, as on Canvas.
  byText(p.box(), 'Add a pretend assignment').fire('click');
  await settle(10);
  assert.equal(p.store.data[UKEY]._101_1.p.length, 1);
  assert.match(p.box().textContent, /Assignment · 40%/);
  assert.match(p.box().textContent, /Blackboard never sees these scores/);
  assert.deepEqual(p.state.asked, [], 'nothing asked of Ultra: the page had the gradebook');
});

test("Ultra what-if: Glaze 2.2's saved scores move over, the graded one goes with a word, and the old store goes", async () => {
  const store = shared({ whatIf: { _101_1: { _603_1: 100, _601_1: 50 }, _777_1: { _1_1: 5 } } });
  const p = ultraPage({ store });
  p.UI.render();
  await settle(12);
  assert.equal(p.box().open, true, 'opened: something to say');
  assert.match(p.box().textContent, /Your grade for Lab Report 1 is in, so your what-if score for it is gone\./);
  assert.equal(totals(p)[1], '90%', 'the score still waiting for a grade is in');
  assert.deepEqual(Object.keys(store.data[UKEY]._101_1.s), ['_603_1']);
  assert.deepEqual(store.data.whatIf, { _777_1: { _1_1: 5 } }, "only this course's leave the old store");
});

test('Ultra what-if: a course with no overall grade is an estimate from the share of points, and says so', async () => {
  const p = ultraPage({ path: '/ultra/courses/_102_1/grades', books: { _102_1: ufix('grades-status').results } });
  p.UI.render();
  await settle(10);
  await open(p);
  await settle(10);
  const text = p.box().textContent;
  assert.match(text, /This course has no overall grade in Blackboard\./);
  assert.match(text, /Estimate now85%/);
  assert.ok(find(p.box(), (e) => e.className === 'gz-calc-tag' && e.textContent === 'Estimate'), 'marked in its heading');
  assert.doesNotMatch(text, /Blackboard now/, "no figure of Blackboard's to show");
});

test("Ultra GPA: on Grades, above the terms, this term's courses with Blackboard's grade or an estimate, schemas asked once", async () => {
  const p = ultraPage({ path: '/ultra/grades', enhance: { gpa: true }, books: { _101_1: ufix('grades').results, _102_1: ufix('grades-status').results }, answers: { '/gradebook/schemas': { results: [] } } });
  p.UI.render();
  await settle(12);
  p.UI.render();
  await settle(12);
  const box = p.gpa();
  assert.equal(box.nextElementSibling, p.doc.querySelector('div.base-grades'), 'above the term carousel, not in it');
  // 88% is a B+ (3.3) and the estimate's 85% a B (3.0) on the common scale: 3.15. The other two have no grade yet.
  assert.match(box.textContent, /3\.15Fall 2026/);
  const cells = box.all((e) => e.className === 'gz-gpa-grade').map((e) => e.textContent);
  assert.deepEqual(cells, ['B+ · 88% · 3.30', 'B · 85% · 3.00 · Estimate', 'No grade yet', 'No grade yet']);
  assert.match(box.textContent, /From your current grades in Blackboard/);
  const schemas = p.state.asked.filter(([, , u]) => /schemas/.test(u));
  assert.deepEqual(schemas, [['GET', 'error', '/learn/api/public/v1/courses/_101_1/gradebook/schemas?limit=200'], ['GET', 'error', '/learn/api/public/v1/courses/_102_1/gradebook/schemas?limit=200']]);
});

// The public content API's answer for a course, as B4 measured it: id, parentId, title, body, contentHandler.id and
// availability.available only. An Ultra document is a page whose text can sit in its blocks (its children).
const CONTENTS = { results: [
  { id: '_720_1', parentId: '_700_1', title: 'Week 1', contentHandler: { id: 'resource/x-bb-folder' }, availability: { available: 'Yes' } },
  { id: '_721_1', parentId: '_720_1', title: 'Reading: cells', body: '<p>The cell membrane.</p>', contentHandler: { id: 'resource/x-bb-document' }, availability: { available: 'Yes' } },
  { id: '_722_1', parentId: '_700_1', title: 'Course Syllabus', contentHandler: { id: 'resource/x-bb-document' }, availability: { available: 'Yes' } },
  { id: '_723_1', parentId: '_722_1', title: 'Block', body: '<p>Instructor: Dr. Ada Lovelace</p><p>Email: ada@example.edu</p><p>Grading scale: A 93, B 83, C 73, D 63, F 0</p>', contentHandler: { id: 'resource/x-bb-document' }, availability: { available: 'Yes' } },
  { id: '_724_1', parentId: '_700_1', title: 'Syllabus (next term)', body: '<p>Not yet.</p>', contentHandler: { id: 'resource/x-bb-document' }, availability: { available: 'No' } },
] };

test('Ultra syllabus import: on the outline under Ultra\'s details, from a document of the course, kept by site, user and course', async () => {
  const p = ultraPage({ path: '/ultra/courses/_101_1/outline', enhance: { syllabus: true }, books: {}, answers: { '/contents?': CONTENTS } });
  vm.runInContext(read('features/syllabus.js'), p.ctx);
  const S = p.ctx.GZ_SYL_UI;
  S.sync(true);
  await settle(12);
  const bar = p.doc.getElementById('gz-syl');
  assert.equal(p.doc.querySelector('div.js-details-and-actions').nextElementSibling, bar, "a block of its own under Ultra's details and actions");
  assert.match(bar.className, /outline-action-block/);
  byText(bar, 'Import a syllabus').fire('click');
  await settle(12);
  const dlg = p.doc.getElementById('gz-syl-dlg');
  assert.equal(dlg.open, true);
  const sel = p.doc.getElementById('gz-syl-doc');
  // Documents only, available ones only, a syllabus first; a page's text is its blocks'.
  assert.deepEqual(sel.children.map((o) => o.textContent), ['Course Syllabus', 'Reading: cells']);
  assert.deepEqual(p.state.asked.map(([m, r, u]) => [m, r, u]), [['GET', 'error', '/learn/api/public/v1/courses/_101_1/contents?recursive=true&limit=200&fields=id,parentId,title,body,contentHandler.id,availability.available']]);
  sel.value = '0';
  byText(dlg, 'Read this document').fire('click');
  await settle(12);
  assert.match(dlg.textContent, /Check what Glaze found/);
  assert.match(dlg.textContent, /Dr\. Ada Lovelace/);
  assert.doesNotMatch(dlg.textContent, /Not yet/);
  byText(dlg, 'Save').fire('click');
  await settle(20);
  const kept = p.store.data[`syllabus:${UO}/_900_1/_101_1`];
  assert.ok(kept, 'kept under this site, user and course');
  assert.deepEqual(kept.scale, [['A', 93], ['B', 83], ['C', 73], ['D', 63], ['F', 0]]);
  assert.match(dlg.textContent, /Blackboard's own weights are the ones that count/);
});

test('an Ultra page may change only its own site’s grade records, by its own ids', async () => {
  const store = shared();
  const send = serviceWorker(store);
  const from = (url) => ({ id: WORKER_ID, tab: { id: 3 }, frameId: 0, url });
  const at = Date.now();
  const op = (key, cid = '_101_1') => ({ type: 'glaze:whatif', op: 'grade', key, cid, c: 90, at });
  assert.deepEqual(await send(op(UKEY), from(`${UO}/ultra/courses/_101_1/grades`)), { ok: false, error: 'sender' }, 'not a site Glaze has found to be Ultra');
  store.data.ultra = [UO];
  assert.deepEqual(await send(op(UKEY), from(`${UO}/ultra/courses/_101_1/grades`)), { ok: true });
  assert.deepEqual(await send(op(UKEY), from(`${UO}/webapps/portal`)), { ok: false, error: 'sender' }, 'not an Ultra page');
  assert.deepEqual(await send(op(UKEY), from('http://lms.example.edu/ultra/grades')), { ok: false, error: 'sender' }, 'not https');
  assert.deepEqual(await send(op('whatIf:https://other.example.edu:_900_1'), from(`${UO}/ultra/grades`)), { ok: false, error: 'sender' });
  assert.deepEqual(await send(op(UKEY, '../1'), from(`${UO}/ultra/grades`)), { ok: false, error: 'sender' });
  const gpa = (key) => send({ type: 'glaze:gpa', key, patch: { c: 4 } }, from(`${UO}/ultra/grades`));
  assert.equal((await gpa(`ultra:${UO}/_101_1`)).ok, true);
  assert.deepEqual(await gpa(`canvas:${UO}/101`), { ok: false, error: 'sender' }, "Canvas's keys aren't an Ultra page's");
  const sylKey = `syllabus:${UO}/_900_1/_101_1`;
  assert.equal((await send({ type: 'glaze:syllabus', key: sylKey, rec: { prof: { name: 'Dr. Ada' } }, at }, from(`${UO}/ultra/courses/_101_1/outline`))).ok, true);
  assert.equal((await send({ type: 'glaze:gpaterms', key: `gpaTerms:${UO}:_900_1`, op: 'goal', goal: { k: 'cum', v: 3.5 }, at, base: 0 }, from(`${UO}/ultra/grades`))).ok, true);
  assert.equal((await send({ type: 'glaze:insights', key: `insights:${UO}/_900_1`, op: 'clear', at }, from(`${UO}/ultra/course`))).ok, true);
  assert.deepEqual(Object.keys(store.data).sort(), [`gpaTerms:${UO}:_900_1`, `insights:${UO}/_900_1`, sylKey, UKEY, "ultra"].sort());
});
