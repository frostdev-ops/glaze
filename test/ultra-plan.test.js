// Planning on Blackboard Ultra (B2), the parts that don't touch a page: Ultra accounts' own keys, Ultra's courses in
// Canvas's course shape, an Ultra page's due items (lib/ultra.js pageDue), Gradescope courses placed with Ultra courses,
// and the background worker taking an Ultra page's writes for its own site only. Synthetic fixtures (test/fixtures/ultra-*.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const U = require('../lib/ultra.js');
const T = require('../lib/todo.js');
const R = require('../lib/remind.js');
const CL = require('../lib/classes.js');
const X = require('../lib/calexport.js');
const G = require('../lib/gradescope.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const load = (n) => JSON.parse(read(`test/fixtures/ultra-${n}.json`));
const o = 'https://bb.example.edu';
const NOW = Date.parse('2026-10-15T12:00:00Z');
const LATER = Date.parse('2026-10-24T12:00:00Z');
const DAY = 864e5;

test("Ultra accounts keep their own To Do, reminders and class schedule, under their site and _N_N id", () => {
  for (const [L, k] of [[T, 'todo'], [R, 'remind'], [CL, 'classes']]) {
    assert.ok(L.STORE_KEY.test(`${k}:${o}/_900_1`), k);
    assert.ok(L.STORE_KEY.test(`${k}:https://school.instructure.com/3`), `${k}: Canvas's still`);
    for (const bad of [`${k}:${o}/_900`, `${k}:${o}/900_1`, `${k}:${o}/_900_1/x`, `${k}:${o}/`]) assert.ok(!L.STORE_KEY.test(bad), bad);
  }
  assert.ok(T.ID.test('_900_1') && T.ID.test('42') && !T.ID.test('_9') && !T.ID.test('a1'));
  // A class kept for an Ultra course reminds with a link to its outline (made whole on the page: Ultra's base is its CDN).
  const store = { courses: [{ id: '_101_1', code: 'BIO 1100', name: 'Biology', periods: [{ days: [4], start: 600, end: 650, loc: '', from: '', to: '', skip: [] }] }] };
  assert.deepEqual(CL.clean(store).courses.map((c) => c.id), ['_101_1']);
  const e = CL.events(store, { now: NOW, tz: 'UTC', lead: 10 });
  assert.equal(e[0].url, '/ultra/courses/_101_1/outline');
  assert.match(e[0].key, /^class:_101_1\.0$/);
});

test("Ultra's courses in Canvas's course shape: code, term dates, closed ones restricted, hidden ones left out", () => {
  const ms = load('memberships').results.map((m) => JSON.parse(JSON.stringify(m)));
  ms[2].userHasHidden = true;
  ms[3].course.isClosed = true;
  const l = U.list(ms, { origin: o });
  assert.deepEqual(l.map((c) => [c.id, c.course_code, c.access_restricted_by_date]), [['_101_1', 'FA26-BIO1100-01', false], ['_102_1', 'FA26-ENG1100-01', false], ['_104_1', 'FA26-HIST2010-01', true]]);
  assert.deepEqual(l[0], { id: '_101_1', name: 'BIO 1100: Biology I', course_code: 'FA26-BIO1100-01', access_restricted_by_date: false,
    term: { id: '_51_1', name: 'Fall 2026', start_at: '2026-08-31T04:00:00.000Z', end_at: '2026-12-22T04:59:00.000Z' } });
  // The class schedule matches a class to it by code first, then by name; the calendar file's "This term" reads its term.
  assert.equal(CL.match({ code: 'BIO 1100', name: 'Lab' }, l), '_101_1');
  assert.equal(CL.match({ code: '', name: 'College Writing' }, l), '_102_1');
  assert.equal(CL.match({ code: 'CHEM 2000', name: 'Organic Chemistry' }, l), '');
  const r = X.range('term', NOW, 'UTC', l.filter((c) => !c.access_restricted_by_date));
  assert.equal(r.guessed, false);
  assert.equal(r.last, T.dayOf(Date.parse('2026-12-22T04:59:00.000Z'), 'UTC') + 1);
  assert.deepEqual(U.list([], { origin: o }), []);
});

// Ultra's answers by path, as the student's own Ultra would give them (lib/ultra.js read's f).
const ultra = (answers) => {
  const asked = [];
  const f = async (url, init) => {
    asked.push({ url, init });
    const u = new URL(url);
    const key = Object.keys(answers).filter((k) => (u.pathname + u.search).startsWith(k)).sort((a, b) => b.length - a.length)[0];
    const body = key ? answers[key] : null;
    return { ok: !!body, status: body ? 200 : 404, text: async () => JSON.stringify(body) };
  };
  return { f, asked };
};

test("an Ultra page's reads, all through lib/ultra.js's reader: the student and courses once a page, what's due once per range however many features ask, links on the site", async () => {
  const { f, asked } = ultra({
    '/learn/api/v1/users/me': { id: '_900_1' },
    '/learn/api/v1/users/_900_1/memberships': load('memberships'),
    '/learn/api/v1/calendars/todo/studentItems': load('todo'),
    '/learn/api/v1/calendars/calendarItems': load('calendar-items'),
    '/learn/api/v1/courses/_101_1/gradebook/grades': load('grades'),
    '/learn/api/v1/courses/_102_1/gradebook/grades': load('grades-status'),
    '/learn/api/v1/courses/_101_1/gradebook/memberships/_301_1/exceptions': { results: [] },
    '/learn/api/v1/courses/_102_1/gradebook/memberships/_302_1/exceptions': { results: [] },
  });
  const had = { location: globalThis.location, fetch: globalThis.fetch };
  globalThis.location = { origin: o };
  globalThis.fetch = f;
  try {
    const range = [LATER - 14 * DAY, LATER + 14 * DAY];
    const [p, l] = await Promise.all([U.page.profile(), U.page.courses()]);
    assert.equal(p.id, '_900_1');
    assert.equal(p.time_zone, Intl.DateTimeFormat().resolvedOptions().timeZone, "the browser's zone, by name");
    assert.deepEqual(l.map((c) => c.id), ['_101_1', '_102_1', '_103_1', '_104_1']);
    const [a, b, c] = await Promise.all([U.page.due(...range), U.page.due(...range), U.page.due(range[0], range[1] + DAY)]);
    assert.equal(a, b, 'the To Do list, the cards and the reminders asking at once get one answer');
    assert.notEqual(a, c, 'another range is its own read');
    assert.equal(a.complete, true);
    assert.deepEqual(a.items.map((i) => i.id).sort(), ['_603_1', '_605_1', '_606_1', '_613_1']);
    for (const i of a.items) assert.ok(i.url.startsWith(`${o}/ultra/`), i.url);
    assert.ok(asked.every(({ url, init }) => url.startsWith(`${o}/learn/api/`) && init.method === 'GET' && init.redirect === 'error'));
    assert.equal(asked.filter(({ url }) => /\/users\/(me|_900_1\/memberships)/.test(url)).length, 2, 'the student and their courses, once a page');
    const n = asked.length;
    await U.page.due(...range);
    assert.ok(asked.length > n, 'a read that has come back is asked again next time: nothing is kept here');
  } finally { Object.assign(globalThis, had); }
});

test('Gradescope courses can be placed with Ultra courses, and show for that Ultra account only once it said yes', () => {
  const seen = {
    _101_1: { name: 'BIO 1100: Biology I', slot: '3', site: o, code: 'FA26-BIO1100-01' },
    _102_1: { name: 'ENG 1100: College Writing', slot: '4' }, // recorded before Ultra courses kept their site: not offered
    'canvas:https://school.instructure.com/7': { name: 'Biology', code: 'BIO 7', canvas: true },
    'ultra:https://bb.test/_1_1': { name: 'Not how Ultra keeps its courses' },
  };
  const l = G.canvas(seen);
  assert.deepEqual(l.map((c) => [c.key, c.label]).sort(), [['canvas:https://school.instructure.com/7', 'Biology · BIO 7 · school.instructure.com'],
    [`ultra:${o}/_101_1`, 'BIO 1100: Biology I · FA26-BIO1100-01 · bb.example.edu']]);
  assert.equal(G.suggest({ short: 'BIO1100', name: 'Biology I' }, l), `ultra:${o}/_101_1`);
  const ACCT = 'a'.repeat(24);
  const row = (id, title) => ({ id, title, due: NOW + DAY, late: null, sub: false, graded: false, score: null, points: 10, lateSub: false });
  const rec = {
    acct: { id: ACCT, name: 'Sam' },
    map: { 11: { to: `ultra:${o}/_101_1`, name: 'BIO' }, 12: { to: `canvas:${o}/7`, name: 'Same host, Canvas' } },
    courses: { 11: { at: NOW, bad: 0, rows: [row('55', 'HW 3')] }, 12: { at: NOW, bad: 0, rows: [row('56', 'Other')] } },
    bind: { [`${o}/_900_1`]: { id: ACCT, show: true } },
  };
  assert.deepEqual(Object.keys(G.clean(rec).map), ['11', '12']);
  assert.deepEqual(Object.keys(G.clean(rec).bind), [`${o}/_900_1`]);
  assert.deepEqual(G.items(rec, o, '_900_1', NOW).map((i) => [i.title, i.cid, i.type]), [['HW 3', '_101_1', 'gradescope']]);
  assert.deepEqual(G.items(rec, o, '_900_2', NOW), [], 'another Ultra account of the site never said yes');
  assert.equal(G.ask(rec, o, '_900_2'), 'Sam');
  assert.equal(G.ask(rec, o, '_900_1'), null);
});

// The background worker (lib/background.js), with its storage in memory: who may write.
const worker = ({ sessionFail = null } = {}) => {
  const m = require('../manifest.json');
  const store = { sync: { version: 2, enabled: true, enhance: { gradescope: true } }, local: {}, session: {} };
  const removed = [];
  const area = (s) => ({
    get: async (k) => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
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
      tabs: { onRemoved: { addListener: (f) => removed.push(f) } },
      storage: { session: Object.fromEntries(Object.entries(area(store.session)).map(([k, f]) => [k, (...a) => { if (sessionFail === k) throw Error('storage unavailable'); return f(...a); }])), local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  return { store, send, removed };
};

test("the worker takes an Ultra page's planning writes for its own site's accounts only, on a host Glaze found Ultra on", async () => {
  const w = worker();
  const page = { id: 'glaze', tab: {}, frameId: 0, url: `${o}/ultra/courses/_101_1/outline` };
  const nope = { ok: false, error: 'sender' };
  const todo = (key) => ({ type: 'glaze:todo', key, edits: [['task', { id: 'n', title: 'Read chapter 3' }]] });
  const own = `todo:${o}/_900_1`;
  const until = async (f) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setTimeout(r, 2)); };
  // An /ultra address alone isn't Ultra: only a host where Glaze's detection found it (content-ultra.js says so as it starts).
  assert.deepEqual(await w.send(todo(own), page), nope, 'a host Glaze has not found Ultra on');
  await w.send({ type: 'glaze:ultra' }, { ...page, frameId: 2 });
  await w.send({ type: 'glaze:ultra' }, { ...page, url: 'http://bb.example.edu/ultra/course' });
  await w.send({ type: 'glaze:ultra' }, { ...page, url: `${o}/webapps/portal/frameset.jsp` });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.store.local.ultra, undefined, 'a frame, http or a page outside /ultra records nothing');
  await w.send({ type: 'glaze:ultra' }, page);
  await until(() => w.store.local.ultra);
  assert.deepEqual(w.store.local.ultra, [o]);
  assert.equal((await w.send(todo(own), page)).ok, true);
  assert.deepEqual(w.store.local[own].tasks.map((x) => x.title), ['Read chapter 3']);
  assert.deepEqual(await w.send(todo('todo:https://other.example.edu/_900_1'), page), nope, "another site's account");
  assert.deepEqual(await w.send(todo(own), { ...page, url: 'http://bb.example.edu/ultra/course' }), nope, 'not over https');
  assert.deepEqual(await w.send(todo(own), { ...page, url: `${o}/webapps/portal/frameset.jsp` }), nope, 'not an Ultra page');
  assert.deepEqual(await w.send(todo(own), { ...page, url: `${o}/ultrax/course` }), nope, 'a lookalike path');
  assert.deepEqual(await w.send(todo(own), { ...page, id: 'other' }), nope, 'another extension');
  assert.deepEqual(await w.send(todo(own), { ...page, tab: undefined }), nope, 'not from a tab');
  assert.deepEqual(await w.send({ type: 'glaze:todo', restore: { tasks: {}, settings: { version: 2 } } }, page), nope, 'only the editor restores');
  // Reminders and the class schedule, the same way.
  const remind = (key) => ({ type: 'glaze:remind', key, op: 'mute', item: 'assignment:_603_1' });
  assert.equal((await w.send(remind(`remind:${o}/_900_1`), page)).ok, true);
  assert.deepEqual(await w.send(remind('remind:https://other.example.edu/_900_1'), page), nope);
  const classes = (key) => ({ type: 'glaze:classes', key, op: 'add', at: NOW, courses: [{ id: '_101_1', code: 'BIO 1100', name: 'Biology', periods: [{ days: [2], start: 540, end: 590 }] }] });
  assert.equal((await w.send(classes(`classes:${o}/_900_1`), page)).ok, true);
  assert.deepEqual(w.store.local[`classes:${o}/_900_1`].courses.map((c) => c.id), ['_101_1']);
  assert.deepEqual(await w.send(classes('classes:https://other.example.edu/_900_1'), page), nope);
  // Gradescope: an Ultra account answers for itself, and keeps rows read for a course placed with its own site's course.
  const ACCT = 'b'.repeat(24);
  w.store.local.gradescope = { acct: { id: ACCT, name: 'Sam' }, map: { 11: { to: `ultra:${o}/_101_1`, name: 'BIO' } }, courses: {}, bind: {} };
  assert.equal((await w.send({ type: 'glaze:gradescope', op: 'bind', key: `${o}/_900_1`, acct: ACCT, show: true }, page)).ok, true);
  assert.deepEqual(await w.send({ type: 'glaze:gradescope', op: 'bind', key: 'https://other.example.edu/_900_1', acct: ACCT, show: true }, page), nope);
  assert.equal((await w.send({ type: 'glaze:gradescope', op: 'rows', acct: ACCT, gid: '11', to: `ultra:${o}/_101_1`, rows: [] }, page)).ok, true);
  assert.deepEqual(await w.send({ type: 'glaze:gradescope', op: 'rows', acct: ACCT, gid: '11', to: `ultra:${o}/_101_1`, rows: [] }, { ...page, url: 'https://other.example.edu/ultra/course' }), nope);
});


test('widget layout broker accepts top-frame LMS/editor changes only and refuses master-off writes', async () => {
  const w = worker();
  w.store.local.ultra = [o];
  const page = { id: 'glaze', tab: { id: 7 }, frameId: 0, url: `${o}/ultra/course` };
  const msg = { type: 'glaze:widgetLayout', more: { pet: { size: 'm' } }, ops: [{ s: 'courses', id: 'notes', set: { fold: true } }] };
  assert.equal((await w.send(msg, page)).ok, true);
  const saved = structuredClone(w.store.local.widgetLayout);
  for (const sender of [{ ...page, frameId: 1 }, { ...page, id: 'other' }, { ...page, tab: undefined }, { ...page, url: 'https://unknown.test/ultra/course' }, { ...page, url: `${o}/ultrax/course` }, { ...page, url: 'http://bb.example.edu/ultra/course' }]) {
    assert.equal((await w.send(msg, sender)).ok, false, JSON.stringify(sender));
  }
  w.store.sync.enabled = false;
  assert.equal((await w.send(msg, page)).ok, false);
  assert.deepEqual(w.store.local.widgetLayout, saved);
});

test('landing worker validates top frame, recorded Ultra site, current master/dashboard/opt-in and claims each tab atomically', async () => {
  const w = worker();
  w.store.local.ultra = [o];
  w.store.sync.widgets = { land: true };
  const page = { id: 'glaze', tab: { id: 7 }, frameId: 0, url: `${o}/ultra/stream` };
  const msg = { type: 'glaze:landed' };
  for (const sender of [{ ...page, frameId: 1 }, { ...page, id: 'other' }, { ...page, tab: undefined }, { ...page, url: 'https://unknown.test/ultra/stream' }, { ...page, url: `${o}/ultrax/stream` }, { ...page, url: 'http://bb.example.edu/ultra/stream' }]) {
    assert.deepEqual(await w.send(msg, sender), { first: false }, JSON.stringify(sender));
  }
  for (const [key, set] of [['master', () => { w.store.sync.enabled = false; }], ['dashboard', () => { w.store.sync.enhance.dashboard = false; }], ['opt-in', () => { w.store.sync.widgets.land = false; }]]) {
    set();
    assert.deepEqual(await w.send(msg, page), { first: false }, key);
    w.store.sync.enabled = true; w.store.sync.enhance.dashboard = true; w.store.sync.widgets.land = true;
  }
  assert.deepEqual(w.store.session, {}, 'refusals do not consume the once bit');
  const both = await Promise.all([w.send(msg, page), w.send(msg, page)]);
  assert.deepEqual(both.map((x) => x.first).sort(), [false, true], 'only one simultaneous claim wins');
  assert.deepEqual(await w.send(msg, { ...page, tab: { id: 8 } }), { first: true }, 'another tab');
  w.removed[0](7);
  await new Promise(setImmediate);
  assert.equal(w.store.session['landed:7'], undefined, 'tab closure cleans its marker');
  for (const k of ['get', 'set']) {
    const broken = worker({ sessionFail: k });
    broken.store.local.ultra = [o]; broken.store.sync.widgets = { land: true };
    assert.deepEqual(await broken.send(msg, page), { first: false }, `session ${k} throws`);
  }
});

test('course tile writes belong to the recorded Ultra origin and to board surfaces only', async () => {
  const w = worker(); w.store.local.ultra = [o];
  const sender = { id: 'glaze', tab: { id: 7 }, frameId: 0, url: `${o}/ultra/course` };
  const msg = (origin, s = 'courses') => ({ type: 'glaze:widgetLayout', ops: [{ s, id: `course:${origin}/_101_1`, set: { on: true } }] });
  assert.equal((await w.send(msg(o), sender)).ok, true);
  for (const m of [msg('https://other.test'), msg(o, 'pages'), msg(o, 'canvas'), msg(o + '/bad')]) assert.equal((await w.send(m, sender)).ok, false);
  assert.equal((await w.send(msg(o), { ...sender, url: `${o}/course` })).ok, false);
  const frame = { ...sender, frameId: 1, url: 'about:blank', origin: o, tab: { id: 7, url: `${o}/ultra/course` } };
  assert.equal((await w.send({ type: 'glaze:widgetLayout', ops: [{ s: 'courses', id: 'quotes', set: { on: true } }] }, frame)).ok, true, 'accepted Ultra live frames retain ordinary widget writes');
  assert.equal((await w.send(msg(o), frame)).ok, false, 'course boards remain top-frame only');
});
