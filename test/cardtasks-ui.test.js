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
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
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
  remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); this.parent = null; }
  before(x) { const p = this.parent; p.children.splice(p.children.indexOf(this), 0, x); x.parent = p; }
  get isConnected() { return !!this.parent; }
  get nextElementSibling() { const l = this.parent?.children || []; return l[l.indexOf(this) + 1] || null; }
  addEventListener(t, f) { (this.on ||= {})[t] = f; }
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

// gs: a stored Gradescope record (lib/gradescope.js), with enhance.gradescope on.
const feature = ({ stored = {}, list = false, hold = false, gs = null } = {}) => {
  const state = { list, race: null }; // race: another context's newer answer, committed just before the cards' write
  const held = [];
  const f0 = { fetched: false };
  const calls = [];
  const store = JSON.parse(JSON.stringify(gs ? { ...stored, gradescope: gs } : stored));
  const listeners = [];
  const cards = [cardFor('25')];
  const c = {
    console, URL, Intl, Date, Set, Map, JSON, Promise, Error,
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_CANVAS_DUE_WEEK: () => [],
    GZ_CTX: {
      t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', need: async () => {},
      canvasCourses: async () => [{ id: '25', name: 'Biology', enrollments: [{ type: 'StudentEnrollment' }] }],
      capi: async (u) => { calls.push(u); return { id: '3', time_zone: 'America/New_York' }; },
      profile() { return this.capi('/users/self/profile'); },
      settings: () => ({ enhance: { gradescope: !!gs } }),
    },
    navigator: {},
    GZ_TODO: T,
    location: { origin: 'https://canvas.test', pathname: '/' },
    fetch: async (u) => {
      calls.push(u);
      f0.fetched = true;
      const r = { ok: true, text: async () => JSON.stringify([item(1, NOW + 864e5), item(2, NOW + 2 * 864e5)]), headers: { get: () => null } };
      return hold ? new Promise((res) => held.push(() => res(r))) : r;
    },
    chrome: {
      runtime: {
        // The worker's 'glaze:todo' (lib/background.js BROKER): lib/todo.js change over this storage.
        sendMessage: (m, cb) => {
          if (m.cache && state.race) { store.todoCache = state.race; state.race = null; }
          const local = { get: async (k) => Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]])), set: async (v) => { Object.assign(store, JSON.parse(JSON.stringify(v))); return true; } };
          // The worker's 'glaze:gradescope' too, telling every listener what changed, as storage does.
          if (m.type === 'glaze:gradescope') {
            return c.GZ_GRADESCOPE.change(JSON.parse(JSON.stringify(m)), { local }).then((r) => {
              if (r.ok) for (const f of listeners) f({ gradescope: { newValue: store.gradescope } }, 'local');
              cb?.(JSON.parse(JSON.stringify(r)));
            });
          }
          T.change(JSON.parse(JSON.stringify(m)), { local }).then((r) => cb(JSON.parse(JSON.stringify(r))));
        },
      },
      storage: {
        local: { get: (k, cb) => { cb(Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]]))); if (state.race && f0.fetched) { store.todoCache = state.race; state.race = null; } }, set: (v, cb) => { Object.assign(store, v); cb?.(); } },
        sync: { get: (k, cb) => cb({}) },
        onChanged: { addListener: (f) => listeners.push(f) },
      },
    },
    document: {
      visibilityState: 'visible', addEventListener() {},
      getElementById: (id) => (id === 'gz-todo' && state.list ? {} : null),
      querySelectorAll: (sel) => (sel === '.ic-DashboardCard' ? cards : cards.flatMap((x) => x.children.filter((y) => y.className === 'gz-ct'))),
      createElement: (tag) => new E(tag),
      querySelector: (sel) => (sel === '.ic-DashboardCard > .gz-ct' ? cards[0].children.find((y) => y.className === 'gz-ct') || null : null),
    },
    addEventListener() {},
  };
  c.globalThis = c;
  vm.createContext(c);
  if (gs) {
    // lib/todo.js's Gradescope parts use the page's own globals (GZ_CTX, document): here it runs in the page's VM.
    delete c.GZ_TODO;
    c.GZ_SPEC = D.GZ_SPEC;
    for (const f of ['lib/todo.js', 'lib/gradescope.js']) vm.runInContext(read(f), c);
  }
  vm.runInContext(read('features/cardtasks.js'), c);
  return { m: c.GZ_CARD_TASKS, calls, store, cards, listeners, state, held };
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

const fresh = (items, at = Date.now()) => ({ key: KEY, at, ...T.fetchRange(D.GZ_SANITIZE({}).todo, at, 'America/New_York'), items: items.map(T.slim) });
const titles = (card) => box(card).children.map((li) => li.children[0].children[0].textContent);

test("an answer asked for before a newer one arrived (the list's, another tab's) neither replaces it nor is kept", async () => {
  const f = feature({ hold: true });
  f.m.sync(true);
  await settle();
  assert.equal(f.held.length, 1);
  const newer = fresh([item(99, NOW + 864e5)], Date.now() + 1000);
  f.store.todoCache = newer;
  for (const l of f.listeners) l({ todoCache: { newValue: newer } }, 'local');
  f.held[0]();
  await settle();
  assert.equal(f.store.todoCache.items[0].id, '99');
  assert.deepEqual(titles(f.cards[0]), ['A99']);
});

test("a list that goes without an answer (it failed) leaves the cards to ask for themselves, once", async () => {
  const f = feature({ list: true });
  f.m.sync(true);
  await settle();
  assert.equal(planner(f.calls), 0);
  f.state.list = false; // the list failed and took itself off the page
  f.m.sync(true); // content.js's next pass
  f.m.sync(true);
  await settle();
  assert.equal(planner(f.calls), 1);
  assert.deepEqual(titles(f.cards[0]), ['A1', 'A2']);
});

test('one profile request a page, whoever asks (Better To Do and the cards)', async () => {
  const decl = read('content.js').match(/ {2}let mine = null;\n {2}const profile = .*\n/)[0];
  const asked = [];
  const ctx = { capi: (u) => { asked.push(u); return Promise.resolve({ id: '3' }); } };
  vm.createContext(ctx);
  vm.runInContext(`${decl}\nglobalThis.profile = profile;`, ctx);
  await Promise.all([ctx.profile(), ctx.profile()]);
  assert.deepEqual(asked, ['/users/self/profile']);
});

test("another context's newer answer, committed between the cards' fetch and their write, is never replaced (one queue turn)", async () => {
  const f = feature({ hold: true });
  f.m.sync(true);
  await settle();
  f.state.race = fresh([item(99, NOW + 864e5)], Date.now() + 1000); // its storage event not delivered yet
  f.held[0]();
  await settle();
  assert.equal(f.store.todoCache.items[0].id, '99');
  assert.deepEqual(titles(f.cards[0]), ['A99']);
});

test('a stale answer at startup with the list on the page: when the list goes, the cards ask', async () => {
  const f = feature({ list: true, stored: { todoCache: fresh([item(88, NOW + 864e5)], Date.now() - 180000) } });
  f.m.sync(true);
  await settle();
  assert.equal(planner(f.calls), 0);
  assert.deepEqual(titles(f.cards[0]), ['A88']);
  f.state.list = false; // gone before the next pass
  f.m.sync(true);
  await settle();
  assert.equal(planner(f.calls), 1);
  assert.deepEqual(titles(f.cards[0]), ['A1', 'A2']);
});

// Gradescope (lib/gradescope.js): a Gradescope account's work shows for a Canvas account only once it says yes, and the
// question is asked quietly wherever the work would show: here, one line above the first card's tasks.
const GS_ID = '0123456789abcdef01234567';
const gsRecord = (bind = {}) => ({
  acct: { id: GS_ID, name: 'Sam' }, map: { 77: { to: 'canvas:https://canvas.test/25', name: 'BIO' } }, bind,
  courses: { 77: { at: NOW, bad: 0, rows: [{ id: '501', title: 'G1', due: NOW + 1.5 * 864e5, late: null, sub: false, graded: false, score: null, points: null, lateSub: false }] } },
});
const click = (button, isTrusted = true) => button.on.click({ isTrusted, preventDefault() {}, stopPropagation() {} });
const askLine = (card) => card.children.find((x) => x.className?.split(' ').includes('gz-ct-ask'));

test('Gradescope: the one-time question sits above the first card\'s tasks; the student\'s answer is the one answer', async () => {
  const f = feature({ gs: gsRecord() });
  f.m.sync(true);
  await settle();
  f.m.sync(true); // the Gradescope file is in: the next pass draws with it
  await settle();
  const card = f.cards[0];
  const ask = askLine(card);
  assert.ok(ask, 'asked');
  assert.equal(card.children.indexOf(ask) + 1, card.children.indexOf(box(card)), 'right above the tasks');
  assert.equal(ask.dataset.ask, `${GS_ID} Sam`);
  assert.equal(ask.children[0].textContent, 'Show Gradescope work from Sam here?');
  assert.deepEqual(titles(card), ['A1', 'A2'], 'nothing from Gradescope before the answer');
  // A pass over the same page leaves the line as it is (focus stays on it).
  f.m.sync(true);
  await settle();
  assert.equal(askLine(card), ask);
  // A script's click answers nothing.
  click(ask.children[1], false);
  await settle();
  assert.equal(f.store.gradescope.bind['https://canvas.test/3'], undefined);
  // The student's: kept for this Canvas account (site and user), the line goes and the work shows.
  click(ask.children[1]);
  await settle();
  assert.deepEqual(f.store.gradescope.bind['https://canvas.test/3'], { id: GS_ID, show: true });
  assert.equal(askLine(card), undefined);
  assert.deepEqual(titles(card), ['A1', 'G1', 'A2']);
});

test('Gradescope: a yes to the question about one account, clicked after another account signed in, grants nothing', async () => {
  const f = feature({ gs: gsRecord() });
  f.m.sync(true);
  await settle();
  f.m.sync(true);
  await settle();
  const ask = askLine(f.cards[0]);
  // Gradescope's account changes (another student signed in on Gradescope) before this page has redrawn.
  f.store.gradescope = { acct: { id: 'f'.repeat(24), name: 'Alex' }, map: {}, courses: {}, hide: false, bind: {} };
  click(ask.children[1]);
  await settle();
  assert.deepEqual(f.store.gradescope.bind, {}, "Sam's question answers nothing about Alex");
});

test('Gradescope: answered anywhere (here, Better To Do, the reminders hub) is answered everywhere; "Not here" hides it', async () => {
  // Answered yes elsewhere: no question, the work shows.
  const yes = feature({ gs: gsRecord({ 'https://canvas.test/3': { id: GS_ID, show: true } }) });
  yes.m.sync(true);
  await settle();
  yes.m.sync(true);
  await settle();
  assert.equal(askLine(yes.cards[0]), undefined);
  assert.deepEqual(titles(yes.cards[0]), ['A1', 'G1', 'A2']);
  // Answered "Not here" elsewhere: no question, nothing shows.
  const no = feature({ gs: gsRecord({ 'https://canvas.test/3': { id: GS_ID, show: false } }) });
  no.m.sync(true);
  await settle();
  no.m.sync(true);
  await settle();
  assert.equal(askLine(no.cards[0]), undefined);
  assert.deepEqual(titles(no.cards[0]), ['A1', 'A2']);
  // "Not here" from this line: the same.
  const here = feature({ gs: gsRecord() });
  here.m.sync(true);
  await settle();
  here.m.sync(true);
  await settle();
  click(askLine(here.cards[0]).children[2]);
  await settle();
  assert.deepEqual(here.store.gradescope.bind['https://canvas.test/3'], { id: GS_ID, show: false });
  assert.equal(askLine(here.cards[0]), undefined);
  assert.deepEqual(titles(here.cards[0]), ['A1', 'A2']);
  // Another Canvas user's answer is theirs: this one is still asked.
  const other = feature({ gs: gsRecord({ 'https://canvas.test/999': { id: GS_ID, show: true } }) });
  other.m.sync(true);
  await settle();
  other.m.sync(true);
  await settle();
  assert.ok(askLine(other.cards[0]));
  // Better To Do on the page asks it there: one question a page.
  other.state.list = true;
  other.m.sync(true);
  await settle();
  assert.equal(askLine(other.cards[0]), undefined);
  other.state.list = false;
  other.m.sync(true);
  await settle();
  assert.ok(askLine(other.cards[0]));
  // Off: no line.
  other.m.sync(false);
  assert.equal(askLine(other.cards[0]), undefined);
});
