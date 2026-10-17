// Planning on Blackboard Ultra pages (B2): Better To Do, tasks on cards and reminders in a VM with an inert DOM, storage
// and worker, on Ultra's anchors (page anchors): where each goes, that only Ultra is asked (lib/ultra.js
// pageDue, never Canvas's planner), that a tick stays on this device whatever todo.sync says, and when content-ultra.js
// loads each. The module's closure is reached by a probe appended to its return value here, in the test only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const T = require('../lib/todo.js');
const R = require('../lib/remind.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const O = 'https://bb.example.edu';
const KEY = T.storeKey(O, '_900_1');
const NOW = Date.now();
const H = 36e5;

// Just enough of an element: a tree with parents, siblings, classes and listeners.
class E {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.style = {}; this.children = []; this.attrs = {}; this.on = {}; this.parent = null; }
  set className(v) { this.attrs.class = v; }
  get className() { return this.attrs.class || ''; }
  append(...xs) { for (const x of xs) { if (x && typeof x === 'object') { x.remove?.(); x.parent = this; } this.children.push(x); } }
  replaceChildren(...xs) { for (const c of this.children) if (c && typeof c === 'object') c.parent = null; this.children = []; this.append(...xs); }
  before(x) { x.remove?.(); const p = this.parent; p.children.splice(p.children.indexOf(this), 0, x); x.parent = p; }
  after(x) { x.remove?.(); const p = this.parent; p.children.splice(p.children.indexOf(this) + 1, 0, x); x.parent = p; }
  replaceWith(x) { const p = this.parent; p.children[p.children.indexOf(this)] = x; x.parent = p; this.parent = null; }
  remove() { const p = this.parent; if (p) p.children.splice(p.children.indexOf(this), 1); this.parent = null; }
  get nextElementSibling() { const l = this.parent?.children || []; return l[l.indexOf(this) + 1] || null; }
  get isConnected() { return !!this.parent; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { this.on[t] = f; }
  removeEventListener() {}
  contains(x) { return x === this || this.children.some((c) => c?.contains?.(x)); }
  closest() { return null; }
  matches() { return false; }
  focus() {}
  // ':scope > .x' and '.x', as far as the modules ask.
  querySelector(sel) {
    const cls = sel.replace(':scope > ', '').replace(/^\./, '');
    const direct = sel.startsWith(':scope > ');
    for (const c of this.children) {
      if (!c || typeof c !== 'object') continue;
      if (c.className.split(' ').includes(cls)) return c;
      if (!direct) { const d = c.querySelector(sel); if (d) return d; }
    }
    return null;
  }
  querySelectorAll() { return []; }
  get text() { return [this.textContent || '', ...this.children.map((c) => (c && typeof c === 'object' ? c.text : c ? String(c) : ''))].filter(Boolean).join(' '); }
}

// Ultra's answer for the student's work (lib/ultra.js page.due's shape): links whole, on the site.
const item = (id, cid, title, at, sub = null) => ({ type: 'assignment', id, cid, course: cid === '_101_1' ? 'Biology' : 'History', title, at, url: `${O}/ultra/redirect?redirectType=nautilus&courseId=${cid}&contentId=_9${id}`, sub, ov: null, aid: id, read: false, note: '', ws: '', allDay: false });
const ITEMS = [item('_603_1', '_101_1', 'Lab report', NOW + 5 * H), item('_604_1', '_104_1', 'Essay', NOW + 30 * H)];

// One Ultra page: storage, the worker's To Do queue, GZ_CTX as content-ultra.js gives it, and its anchors.
// hold: files whose arrival (need) waits for release(), as a slow injection's would. stored: storage.local to start with.
const page = ({ path = '/ultra/course', course = '', complete = true, prefs = {}, items = ITEMS, stored = {}, hold = [], enhance = { todo: true, cardTasks: true, remind: true } } = {}) => {
  const store = JSON.parse(JSON.stringify(stored));
  const held = [];
  const calls = [], due = [], sent = [];
  const panel = new E('div'); panel.className = 'todo-panel';
  const bb = new E('bb-todo'); panel.append(bb);
  const aside = new E('aside'); aside.className = 'outline-actions';
  const people = new E(); people.className = 'outline-action-block';
  const details = new E(); details.className = 'js-details-and-actions outline-action-block';
  aside.append(people, details);
  const card = new E('article');
  card.id = 'course-list-course-_101_1';
  card.dataset.courseId = '_101_1';
  const title = new E('h4'); title.className = 'js-course-title-element'; title.textContent = 'BIO 1100: Biology I';
  const det = new E(); det.className = 'element-details'; det.append(title);
  card.append(det);
  const local = (v) => JSON.parse(JSON.stringify(v));
  const c = {
    console, URL, Intl, Date, Set, Map, JSON, Promise, Error, CSS: { escape: (x) => x }, crypto: { randomUUID: () => '12345678-abcd-ef00' },
    setTimeout: () => 0, clearTimeout: () => {}, // timers stay still: a test calls what it needs
    GZ_TODO: T, GZ_REMIND: R, GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' },
    GZ_CANVAS_DUE_WEEK: () => { throw new Error("Canvas's due list is never made on Ultra"); },
    GZ_ULTRA: { page: { due: async (from, to) => { due.push([from, to]); return { items: local(items), complete }; } } },
    GZ_CTX: {
      site: 'ultra', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', celebrate() {},
      need: (file) => (hold.includes(file) ? new Promise((res) => held.push(res)) : Promise.resolve()),
      courseId: () => course || undefined, canvasCourseId: () => { throw new Error("Canvas's course id is never asked on Ultra"); },
      profile: async () => ({ id: '_900_1', time_zone: 'America/New_York' }),
      canvasCourses: async () => [{ id: '_101_1', name: 'BIO 1100: Biology I', course_code: 'FA26-BIO1100-01' }, { id: '_104_1', name: 'HIST 2010: World History', course_code: 'FA26-HIST2010-01' }],
      settings: () => D.GZ_SANITIZE({ enhance }),
    },
    location: { origin: O, pathname: path },
    navigator: { userActivation: { isActive: true } },
    document: {
      activeElement: null, documentElement: new E('html'), visibilityState: 'visible', cookie: '',
      createElement: (tag) => new E(tag), createElementNS: (ns, tag) => new E(tag), addEventListener() {}, removeEventListener() {},
      querySelector: (sel) => ({ 'div.todo-panel > bb-todo': bb, 'aside.outline-actions > .js-details-and-actions': details })[sel] || null,
      querySelectorAll: (sel) => (sel === 'article[id^="course-list-course-"]' ? [card] : []),
      getElementById: (id) => (id === 'gz-todo' ? [panel, aside].flatMap((p) => p.children).find((x) => x.attrs.id === 'gz-todo' || x.id === 'gz-todo') || null : null),
    },
    addEventListener() {}, removeEventListener() {},
    fetch: async (url, init) => { calls.push(`${init?.method || 'GET'} ${url}`); throw new Error('nothing asks the network directly on Ultra'); },
    chrome: {
      runtime: {
        lastError: undefined,
        // The worker's 'glaze:todo' (lib/background.js BROKER): lib/todo.js change over this storage.
        sendMessage: (m, cb) => {
          sent.push(local(m));
          const area = { get: async (k) => local(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]]))), set: async (v) => { Object.assign(store, local(v)); return true; } };
          T.change(local(m), { local: area, sync: area }).then((r) => cb?.(local(r)));
        },
      },
      storage: {
        local: { get: (k, cb) => cb(local(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]])))), set: (v, cb) => { Object.assign(store, local(v)); cb?.(); } },
        sync: { get: (k, cb) => cb({ todo: { ...prefs }, remind: {} }) },
        onChanged: { addListener() {}, removeListener() {} },
      },
    },
  };
  c.globalThis = c;
  vm.createContext(c);
  return { c, store, calls, due, sent, panel, bb, aside, details, card, release: () => { for (const f of held.splice(0)) f(); } };
};
const probe = (src, fields) => src.replace(/( {2}return \{\s*sync,)/, `$1 probe: { ${fields} },`).replace(/var (GZ_\w+) = globalThis\.\1 \|\|/, 'var $1 =');

test('Better To Do on Ultra\'s Courses page: right before Ultra\'s own To Do (hidden by features/apps.css only while it\'s there), from Ultra only', async () => {
  const p = page({ complete: false });
  vm.runInContext(probe(read('features/todo.js'), 'get: () => ({ box, cache, who, key })'), p.c);
  const L = p.c.GZ_TODO_UI;
  L.sync(true);
  await settle();
  const { box, cache, who, key } = L.probe.get();
  assert.deepEqual(p.panel.children.map((x) => x.tagName), ['SECTION', 'BB-TODO'], 'in Ultra\'s To Do column, before its own list');
  assert.equal(box.className, 'gz-todo');
  assert.equal(key, KEY);
  assert.equal(who.tz, 'America/New_York');
  assert.equal(p.due.length, 1, 'one read of Ultra');
  const want = T.fetchRange(D.GZ_SANITIZE({}).todo, Date.now(), 'America/New_York');
  assert.ok(Math.abs(p.due[0][0] - Date.parse(want.start)) < 6e4 && Math.abs(p.due[0][1] - Date.parse(want.end)) < 6e4, "Better To Do's own range");
  assert.deepEqual(p.calls, []);
  assert.equal(cache.complete, false);
  assert.ok(box.text.includes('Blackboard sent only part of your calendar, so some work may be missing.'));
  assert.ok(box.text.includes('Lab report') && box.text.includes('Essay'));
  // The kept answer has no due list of Canvas's (the popup's is content.js's own on Ultra), and the CSS hides Ultra's list
  // only while Glaze's is right before it.
  assert.equal(p.sent.find((m) => m.cache).due, undefined);
  assert.match(read('features/apps.css'), /#gz-todo ~ :is\([^)]*\bbb-todo\b[^)]*\) \{ display: none !important; \}/);
  // Turned off: it goes, and Ultra's own list is all that's left.
  L.sync(false);
  assert.deepEqual(p.panel.children.map((x) => x.tagName), ['BB-TODO']);
});

test("on a course's outline: a block of the right column before Details & Actions, that course's work only", async () => {
  const p = page({ path: '/ultra/courses/_101_1/outline', course: '_101_1' });
  vm.runInContext(probe(read('features/todo.js'), 'get: () => ({ box })'), p.c);
  p.c.GZ_TODO_UI.sync(true);
  await settle();
  const { box } = p.c.GZ_TODO_UI.probe.get();
  assert.deepEqual(p.aside.children.map((x) => x.className), ['outline-action-block', 'gz-todo outline-action-block', 'js-details-and-actions outline-action-block']);
  assert.ok(box.text.includes('Lab report'));
  assert.ok(!box.text.includes('Essay'), "another course's work isn't on this course's list");
  assert.ok(!box.text.includes('Biology'), 'the course is not named on its own page');
});

test('a tick on Ultra stays on this device, even with "Tick off in Canvas too" on', async () => {
  const p = page({ prefs: { sync: true } });
  vm.runInContext(probe(read('features/todo.js'), 'onChange, render, get: () => ({ box })'), p.c);
  p.c.GZ_TODO_UI.sync(true);
  await settle();
  const tick = { dataset: { act: 'done' }, checked: true, closest: () => ({ dataset: { key: 'assignment:_603_1' } }) };
  p.c.GZ_TODO_UI.probe.onChange({ target: tick, isTrusted: true });
  await settle();
  assert.deepEqual(p.calls, [], 'nothing is written to Blackboard');
  assert.equal(p.store[KEY].items['assignment:_603_1'].done, true);
});

test("tasks on Ultra's course cards: after the card's details, from the same answer, and the card's own click left to the course", async () => {
  const p = page();
  vm.runInContext(read('features/cardtasks.js'), p.c);
  p.c.GZ_CARD_TASKS.sync(true);
  await settle();
  assert.equal(p.due.length, 1);
  assert.deepEqual(p.calls, []);
  const ct = p.card.children[1];
  assert.equal(ct?.className, 'gz-ct');
  assert.equal(ct.attrs['aria-label'], 'Tasks for BIO 1100: Biology I');
  assert.ok(ct.text.includes('Lab report') && !ct.text.includes('Essay'));
  // A click, key or press on a task is the task's: the card around it (Ultra opens the course on a click anywhere) never sees it.
  for (const t of ['click', 'keydown', 'pointerdown', 'mousedown']) {
    let stopped = false;
    ct.on[t]({ stopPropagation: () => { stopped = true; } });
    assert.ok(stopped, t);
  }
  assert.equal(p.store.todoCache.key, KEY, 'kept for Better To Do and the reminders too');
  // Again on the next pass, with nothing new: nothing is redrawn.
  p.c.GZ_CARD_TASKS.sync(true);
  await settle();
  assert.equal(p.card.children[1], ct);
});

test('reminders on Ultra: quiet on a test, assignment or tool page; links made whole; Ultra asked only when no list or cards will', async () => {
  const p = page({ path: '/ultra/stream' });
  vm.runInContext(probe(read('features/reminders.js'), 'quiet, theyAsk, abs, load'), p.c);
  const M = p.c.GZ_REMIND_UI.probe;
  const at = (path) => { p.c.location.pathname = path; };
  at('/ultra/courses/_101_1/outline/assessment/_700_1/overview'); assert.equal(M.quiet(), true);
  at('/ultra/courses/_101_1/outline/assessment/test/_700_1/overview/attempt/_800_1'); assert.equal(M.quiet(), true);
  at('/ultra/courses/_101_1/outline/lti/launchFrame'); assert.equal(M.quiet(), true);
  at('/ultra/courses/_101_1/outline'); assert.equal(M.quiet(), false);
  assert.equal(M.theyAsk(), true, 'Better To Do asks on an outline');
  at('/ultra/course'); assert.equal(M.theyAsk(), true);
  at('/ultra/stream'); assert.equal(M.theyAsk(), false, 'elsewhere the reminders ask for themselves');
  assert.equal(M.abs('/ultra/courses/_101_1/outline'), `${O}/ultra/courses/_101_1/outline`);
  assert.equal(M.abs(`${O}/ultra/redirect?x=1`), `${O}/ultra/redirect?x=1`);
});

test('content-ultra.js loads each where it goes: Better To Do on the Courses page and outlines, cards with cards, reminders anywhere; top frame only', async () => {
  const src = read('content-ultra.js');
  const decls = ['load', 'top', 'syncTodo', 'syncCardTasks', 'syncRemind'].map((n) => src.match(new RegExp(` {2}const ${n} = .*\\n`))[0]).join('');
  const asked = [];
  const ctx = {
    I: { links: [1], settings: { enhance: { todo: true, cardTasks: true, remind: false, remindExam: false, remindPlan: false, remindClass: false, streak: true } } },
    location: { pathname: '/ultra/course' }, window: {}, CARD: 'article[id^="course-list-course-"]', cards: true, tabFrame: '',
    document: { querySelector: () => (ctx.cards ? {} : null) },
    need: async (file) => { asked.push(file); },
    GZ_TODO_UI: { sync: (on) => asked.push(`todo ${on}`) }, GZ_CARD_TASKS: { sync: (on) => asked.push(`cards ${on}`) }, GZ_REMIND_UI: { sync: (on) => asked.push(`remind ${on}`) },
  };
  ctx.window.top = ctx.window;
  ctx.solo = true;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${decls}\nglobalThis.all = () => [syncTodo(), syncCardTasks(), syncRemind()];`, ctx);
  const run = async (path, cards = true) => { asked.length = 0; ctx.location.pathname = path; ctx.cards = cards; await Promise.all(ctx.all()); return [...asked]; };
  assert.deepEqual(await run('/ultra/course'), ['features/todo.js', 'features/cardtasks.js', 'features/reminders.js', 'todo true', 'cards true', 'remind true']);
  assert.deepEqual(await run('/ultra/course', false), ['features/todo.js', 'cards false', 'features/reminders.js', 'todo true', 'remind true'], 'no cards drawn yet: none asked');
  assert.deepEqual(await run('/ultra/courses/_101_1/outline'), ['features/todo.js', 'cards false', 'features/reminders.js', 'todo true', 'remind true']);
  assert.deepEqual(await run('/ultra/courses/_101_1/grades'), ['todo false', 'cards false', 'features/reminders.js', 'remind true']);
  assert.deepEqual(await run('/ultra/coursesx'), ['todo false', 'cards false', 'features/reminders.js', 'remind true']);
  ctx.window.top = {}; // a frame inside the page
  ctx.solo = false;
  assert.deepEqual(await run('/ultra/course'), ['todo false', 'cards false', 'remind false']);
  // A course tab's frame is a page of its own (its To Do panel), but reminders stay the page's around it.
  ctx.solo = true; ctx.tabFrame = '_101_1';
  assert.deepEqual(await run('/ultra/courses/_101_1/outline'), ['features/todo.js', 'cards false', 'remind false', 'todo true']);
});

// ---- Codex's B2 review: each failed before its fix ----

test('review (B2 1): a module that lands after Glaze or its switch went off stays off; a list turned off while lib/ultra.js loads reads nothing', async () => {
  // content-ultra.js: the switches are asked again when the file lands, not taken from when it was asked for.
  const src = read('content-ultra.js');
  const decls = ['load', 'top', 'syncTodo'].map((n) => src.match(new RegExp(` {2}const ${n} = .*\\n`))[0]).join('');
  let arrive;
  const asked = [];
  const ctx = { I: { links: [1], settings: { enhance: { todo: true } } }, location: { pathname: '/ultra/course' }, window: {}, need: () => new Promise((r) => { arrive = r; }) };
  ctx.window.top = ctx.window;
  ctx.solo = true;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${decls}\nglobalThis.syncTodo = syncTodo;`, ctx);
  const late = ctx.syncTodo();
  ctx.I.links = []; // Glaze turned off (its sheets gone) while the file was on its way
  ctx.syncTodo(); // the off pass: nothing loaded yet to turn off
  ctx.GZ_TODO_UI = { sync: (on) => asked.push(on) };
  arrive();
  await late;
  assert.deepEqual(asked, [false]);

  // Better To Do: off() while lib/ultra.js is on its way, so the read is never asked.
  const p = page({ hold: ['lib/ultra.js'] });
  vm.runInContext(probe(read('features/todo.js'), 'get: () => ({ box })'), p.c);
  p.c.GZ_TODO_UI.sync(true);
  await settle();
  p.c.GZ_TODO_UI.sync(false);
  p.release();
  await settle();
  assert.deepEqual(p.due, [], 'no read after the list went');
  assert.deepEqual(p.panel.children.map((x) => x.tagName), ['BB-TODO']);

  // Tasks on cards and reminders, the same.
  const q = page({ hold: ['lib/ultra.js'] });
  vm.runInContext(read('features/cardtasks.js'), q.c);
  q.c.GZ_CARD_TASKS.sync(true);
  await settle();
  q.c.GZ_CARD_TASKS.sync(false);
  q.release();
  await settle();
  assert.deepEqual(q.due, []);
  const r = page({ path: '/ultra/stream', hold: ['lib/ultra.js'] });
  vm.runInContext(read('features/reminders.js'), r.c);
  r.c.GZ_REMIND_UI.sync(true);
  await settle();
  r.c.GZ_REMIND_UI.sync(false);
  r.release();
  await settle();
  assert.deepEqual(r.due, []);
});

test("review (B2 2): on Ultra the cards and the reminders count this device's ticks, whatever \"Tick off in Canvas too\" says", async () => {
  const now = Date.now();
  const stored = { [KEY]: { tasks: [], items: { 'assignment:_603_1': { done: true } } } };
  const p = page({ prefs: { sync: true }, stored });
  vm.runInContext(read('features/cardtasks.js'), p.c);
  p.c.GZ_CARD_TASKS.sync(true);
  await settle();
  assert.ok(!p.card.children[1].text.includes('Lab report'), 'ticked done here: off the card');
  const r = page({ path: '/ultra/stream', prefs: { sync: true }, enhance: { remind: true }, stored: { ...stored, todoCache: { key: KEY, at: now, start: new Date(now - 9 * 864e5).toISOString(), end: new Date(now + 9 * 864e5).toISOString(), teach: true, progress: true, items: ITEMS, grading: [], sums: {} } } });
  vm.runInContext(probe(read('features/reminders.js'), 'reckon'), r.c);
  r.c.GZ_REMIND_UI.sync(true);
  await settle();
  const { b } = r.c.GZ_REMIND_UI.probe.reckon(now);
  const open = b.groups.flatMap(([, l]) => l).map((x) => x.key);
  assert.ok(!open.includes('assignment:_603_1') && open.includes('assignment:_604_1'), 'no reminder for work ticked done here');
});

test('review (B2 3): when Ultra sent only part of the calendar, a card and the list say so, never "Nothing due" or "Nothing to do"', async () => {
  const MISSING = 'Blackboard sent only part of your calendar, so some work may be missing.';
  const p = page({ complete: false, items: [] });
  vm.runInContext(read('features/cardtasks.js'), p.c);
  p.c.GZ_CARD_TASKS.sync(true);
  await settle();
  const ct = p.card.children[1];
  assert.equal(ct.text, MISSING);
  assert.ok(!ct.text.includes('Nothing due'));
  // With some work there, the list stays and the line follows it.
  const q = page({ complete: false });
  vm.runInContext(read('features/cardtasks.js'), q.c);
  q.c.GZ_CARD_TASKS.sync(true);
  await settle();
  assert.ok(q.card.children[1].text.includes('Lab report') && q.card.children[1].text.includes(MISSING));
  // A complete answer with nothing in it is "Nothing due", as before.
  const w = page({ items: [] });
  vm.runInContext(read('features/cardtasks.js'), w.c);
  w.c.GZ_CARD_TASKS.sync(true);
  await settle();
  assert.equal(w.card.children[1].text, 'Nothing due');
  // Better To Do: the line, and no "Nothing to do".
  const l = page({ complete: false, items: [] });
  vm.runInContext(probe(read('features/todo.js'), 'get: () => ({ box })'), l.c);
  l.c.GZ_TODO_UI.sync(true);
  await settle();
  const t = l.c.GZ_TODO_UI.probe.get().box.text;
  assert.ok(t.includes(MISSING) && !t.includes('Nothing to do'));
});


test('NEW-1: Ultra W11 stores its calculation day without changing a stable run', async () => {
  const today = T.dayOf(NOW, 'America/New_York'), rk = R.storeKey(O, '_900_1');
  const r = page({ path: '/ultra/stream', enhance: { streak: true }, stored: {
    [rk]: { streak: { start: today - 20, best: 100, asOf: today - 1 } },
    todoCache: { key: KEY, at: NOW, start: new Date(NOW - 9 * 864e5).toISOString(), end: new Date(NOW + 9 * 864e5).toISOString(), items: [], grading: [], sums: {} },
  } });
  r.c.chrome.runtime.sendMessage = (m, cb) => {
    r.sent.push(m);
    const area = { get: async () => r.store, set: async (v) => { Object.assign(r.store, v); return true; } };
    R.change(m, { local: area }, NOW).then(cb);
  };
  vm.runInContext(read('features/reminders.js'), r.c);
  r.c.GZ_REMIND_UI.sync(true); await settle();
  assert.equal(r.store[rk].streak.asOf, today);
  assert.equal(r.sent.filter((m) => m.op === 'streak').length, 1);
  assert.deepEqual(r.calls, [], 'no new direct request');
  r.c.GZ_REMIND_UI.sync(false);
});
