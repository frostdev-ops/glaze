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

// chrome.storage: get reads when asked and answers on the next turn, or, once `hold` is set, when the test lets it.
const area = (data = {}) => {
  const s = { data, hold: false, held: [] };
  s.get = (key, cb) => {
    const value = structuredClone(data[key]);
    const run = () => cb({ [key]: value });
    if (s.hold) s.held.push(run); else Promise.resolve().then(run);
  };
  s.set = (o, cb) => { Object.assign(data, o); cb?.(); };
  s.remove = (key, cb) => { delete data[key]; cb?.(); };
  return s;
};

// BIO 1100 from the local Canvas: its course-list row (Canvas's totals, the student) and its assignment groups.
const BIO = live.courses.find((c) => c.course.course_code === 'BIO 1100');
const ORIGIN = 'https://school.instructure.com';
const KEY = `whatIf:${ORIGIN}:3`;
const row = (more = {}) => ({ ...BIO.course, id: String(BIO.course.id), name: 'Introduction to Biology', enrollments: [{ type: 'student', user_id: '3', ...BIO.course.enrollment }], ...more });

// features/grades.js on a course's Grades page, with Canvas's answers held until the test lets them through.
const gradesPage = ({ local = {}, list = [row()], search = '', groups = BIO.groups, capi = () => Promise.resolve(null) } = {}) => {
  const doc = page();
  doc.body.append(el(doc, 'div', { id: 'assignments' }, el(doc, 'table', { id: 'grades_summary' })));
  const state = { on: true, settings: { enabled: true, enhance: { calc: true, gpa: false } }, fetches: [] };
  const storage = { local: area(local), sync: area() };
  const fetch = () => new Promise((resolve, reject) => state.fetches.push({
    ok: () => resolve({ ok: true, text: async () => JSON.stringify(groups), headers: { get: () => '' } }),
    fail: () => resolve({ ok: false, status: 503 }),
    drop: () => reject(new Error('offline')),
  }));
  const ctx = vm.createContext({
    document: doc, location: { pathname: `/courses/${BIO.course.id}/grades`, search, origin: ORIGIN },
    CSS: { escape: (s) => s }, queueMicrotask, URLSearchParams, URL, Intl, fetch, GZ_I18N: I, chrome: { storage },
    GZ_CTX: {
      t: (k, v) => I.t(k, v, 'en'), locale: () => 'en', capi, canvasCourses: () => Promise.resolve(list), canvasCourseId: () => String(BIO.course.id),
      need: (f, ready) => (ready() ? Promise.resolve() : Promise.reject(new Error('not loaded'))), settings: () => state.settings, on: () => state.on,
    },
  });
  vm.runInContext(read('lib/gradecalc.js'), ctx);
  vm.runInContext(read('features/grades.js'), ctx);
  return { doc, state, storage, UI: ctx.GZ_GRADES_UI, box: () => doc.getElementById('gz-calc') };
};
const open = async (p) => { const b = p.box(); b.open = true; b.fire('toggle'); await settle(); };
const totals = (p) => p.box().all((e) => e.tagName === 'DD').map((d) => d.textContent);

test('nothing is drawn by work that finishes after Glaze was switched off', async () => {
  const p = gradesPage({ local: { [KEY]: { [BIO.course.id]: { s: {}, h: [], p: [], c: 70 } } } });
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

test('Clear all courses stays cleared, even with a save already reading storage', async () => {
  const p = gradesPage({ local: { [KEY]: { [BIO.course.id]: { s: {}, h: [], p: [], c: 70 }, 26: { s: {}, h: [], p: [], c: 80 } } } });
  p.UI.render();
  await settle();
  p.state.fetches.shift().ok();
  await settle();
  await open(p);
  assert.deepEqual(totals(p), ['83.85%', '83.85%', '21.92%']);
  p.storage.local.hold = true; // storage answers only when the test says
  const score = find(p.box(), (e) => e.dataset.f === 's:175');
  score.value = '90';
  score.fire('input');
  await settle();
  byText(p.box(), 'Clear all courses').fire('click');
  p.storage.local.hold = false;
  while (p.storage.local.held.length) p.storage.local.held.shift()();
  await settle();
  assert.equal(p.storage.local.data[KEY], undefined, 'no course comes back');
  assert.deepEqual(totals(p), ['83.85%', '83.85%', '21.92%'], 'and the page shows none');
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
  const saved = p.storage.local.data[KEY][BIO.course.id].p;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].pd, '1');
  assert.ok(find(p.box(), (e) => e.dataset.f === `n:${saved[0].id}`), 'and is shown in it');
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
