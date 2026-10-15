// The Canvas grades extras as they behave on a page (features/grades.js, and content.js's card grades), run in a VM
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
  const m = s.match(/^([a-z]+)?((?:\.[\w-]+)*)(?:\[([\w-]+)(\*?=)"([^"]*)"\])?$/i);
  if (!m) throw new Error(`selector the stand-in can't read: ${s}`);
  const [, tag, classes, attr, op, value] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  const own = String(el.className || '').split(/\s+/);
  if (classes && !classes.slice(1).split('.').every((c) => own.includes(c))) return false;
  if (attr) {
    const v = attr.startsWith('data-') ? el.dataset[attr.slice(5)] : el.getAttribute(attr);
    if (v == null || (op === '=' ? v !== value : !v.includes(value))) return false;
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
    URL, console, setTimeout, clearTimeout,
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

// ---- content.js: the Dashboard cards' grade, as a link of its own ----
const source = read('content.js');
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
  const ctx = vm.createContext({ document: doc, observer: {}, GZ_PAGE: require('../lib/page.js'), locale: () => 'en', t: (k, v) => I.t(k, v, 'en'), canvasCourses: () => Promise.resolve(list) });
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
