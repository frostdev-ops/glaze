// Tasks on course cards (features/cardtasks.js) in a VM with an inert DOM, network and storage: when it asks Canvas
// (only with no fresh shared answer and no To Do list on the page, once), what it keeps (the list's shape), and that a
// pass over unchanged cards writes nothing. What goes on a card is lib/todo.js card(), tested in todo.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const T = require('../lib/todo.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const KEY = 'todo:https://canvas.test/3';
const NOW = Date.now();

class E {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.children = []; this.attrs = {}; this.parent = null; }
  append(...xs) { for (const x of xs) { if (typeof x === 'object') x.parent = this; this.children.push(x); } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ''; }
  // ':scope > .x', '.x' and 'a[href*="/courses/"]', as far as the module asks.
  querySelector(sel) {
    if (sel.startsWith('a[')) return this.children.find((c) => c.tagName === 'A') || this.children.map((c) => c.querySelector?.(sel)).find(Boolean) || null;
    const cls = sel.replace(':scope > .', '');
    return this.children.find((c) => c.className?.split(' ').includes(cls)) || null;
  }
  after(x) { const p = this.parent; p.children.splice(p.children.indexOf(this) + 1, 0, x); x.parent = p; p.writes = (p.writes || 0) + 1; }
  replaceWith(x) { const p = this.parent; p.children[p.children.indexOf(this)] = x; x.parent = p; p.writes = (p.writes || 0) + 1; }
  remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); }
}
const cardFor = (cid) => {
  const el = new E();
  el.setAttribute('aria-label', 'Biology');
  const head = new E();
  head.className = 'ic-DashboardCard__header';
  const a = new E('a');
  a.setAttribute('href', `/courses/${cid}`);
  head.append(a);
  el.append(head);
  return el;
};
const item = (id, at) => ({ plannable_type: 'assignment', plannable_id: id, course_id: 25, plannable_date: new Date(at).toISOString(), html_url: `/courses/25/assignments/${id}`, plannable: { title: `A${id}` }, submissions: { submitted: false } });

const feature = ({ stored = {}, list = false } = {}) => {
  const calls = [];
  const store = JSON.parse(JSON.stringify(stored));
  const listeners = [];
  const cards = [cardFor('25')];
  const c = {
    console, URL, Intl, Date, Set, Map, JSON, Promise, Error,
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_CANVAS_DUE_WEEK: () => [],
    GZ_CTX: {
      t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', need: async () => {},
      canvasCourses: async () => [{ id: '25', name: 'Biology', enrollments: [{ type: 'StudentEnrollment' }] }],
      capi: async (u) => { calls.push(u); return { id: '3', time_zone: 'America/New_York' }; },
    },
    GZ_TODO: T,
    location: { origin: 'https://canvas.test', pathname: '/' },
    fetch: async (u) => { calls.push(u); return { ok: true, text: async () => JSON.stringify([item(1, NOW + 864e5), item(2, NOW + 2 * 864e5)]), headers: { get: () => null } }; },
    chrome: {
      runtime: {},
      storage: {
        local: { get: (k, cb) => cb(Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]]))), set: (v, cb) => { Object.assign(store, v); cb?.(); } },
        sync: { get: (k, cb) => cb({}) },
        onChanged: { addListener: (f) => listeners.push(f) },
      },
    },
    document: {
      visibilityState: 'visible', addEventListener() {},
      getElementById: (id) => (id === 'gz-todo' && list ? {} : null),
      querySelectorAll: (sel) => (sel === '.ic-DashboardCard' ? cards : cards.flatMap((x) => x.children.filter((y) => y.className === 'gz-ct'))),
      createElement: (tag) => new E(tag),
    },
    addEventListener() {},
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(read('features/cardtasks.js'), c);
  return { m: c.GZ_CARD_TASKS, calls, store, cards, listeners };
};
const planner = (calls) => calls.filter((u) => u.includes('/planner/items')).length;
const box = (card) => card.children.find((x) => x.className === 'gz-ct');

test('no fresh answer and no list on the page: asks the planner once, keeps it in the list\'s shape, draws the card', async () => {
  const f = feature();
  f.m.sync(true);
  f.m.sync(true); // passes while it starts ask nothing more
  await settle();
  assert.equal(planner(f.calls), 1);
  const c = f.store.todoCache;
  assert.equal(c.key, KEY);
  assert.equal(c.teach, true); // a student's answer: the list (teacher on, no courses taught) takes it as its own
  assert.equal(JSON.stringify([c.grading, c.sums]), '[[],{}]');
  const ul = box(f.cards[0]);
  assert.equal(ul.tagName, 'UL');
  assert.equal(ul.attrs['aria-label'], 'Tasks for Biology');
  assert.deepEqual(ul.children.map((li) => li.children[0].children[0].textContent), ['A1', 'A2']);
  assert.equal(ul.children[0].children[0].href, '/courses/25/assignments/1');
  // A pass over the same cards writes nothing.
  const writes = f.cards[0].writes;
  f.m.sync(true);
  await settle();
  assert.equal(f.cards[0].writes, writes);
  assert.equal(planner(f.calls), 1);
  // Off: the lists go.
  f.m.sync(false);
  assert.equal(box(f.cards[0]), undefined);
});

test('a fresh shared answer, or the To Do list on the page, means no request of its own', async () => {
  const range = T.fetchRange(D.GZ_SANITIZE({}).todo, NOW, 'America/New_York');
  const fresh = feature({ stored: { todoCache: { key: KEY, at: NOW, ...range, items: [T.slim(item(1, NOW + 864e5))] } } });
  fresh.m.sync(true);
  await settle();
  assert.equal(planner(fresh.calls), 0);
  assert.equal(box(fresh.cards[0]).children.length, 1);
  const listed = feature({ list: true });
  listed.m.sync(true);
  await settle();
  assert.equal(planner(listed.calls), 0);
  assert.equal(box(listed.cards[0]), undefined); // nothing yet: the list's answer arrives through storage
  for (const l of listed.listeners) l({ todoCache: { newValue: { key: KEY, at: NOW, ...range, items: [T.slim(item(1, NOW + 864e5))] } } }, 'local');
  assert.equal(box(listed.cards[0]).children.length, 1);
});
