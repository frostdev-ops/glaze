// The courses group's MCP tools (lib/mcp/tools-study.js): accounts_list, courses_list, todo_list and schedule_list over
// Glaze's caches, which test/helpers/mcp-caches.cjs makes with the code that writes them. Each answer is the slim shape
// lib/modbroker.js gives a mod on that account's page, and no account ever sees another's.
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../lib/mcp/tools-study.js');
const B = require('../lib/modbroker.js');
const AT = require('../lib/ai/tools.js');
const S = require('../lib/ai/schema.js');
const C = require('./helpers/mcp-caches.cjs');

const { CANVAS, ULTRA, NOW } = C;
const A = `${CANVAS}/5`, BEE = `${CANVAS}/6`, UL = `${ULTRA}/${C.ULTRA_UID}`;
const DAY = 864e5;
const tool = (name) => ST.tools().find((t) => t.name === name);
const run = (name, store, account, args = {}, more) => tool(name).run(args, C.ctx(store, account, more));
const leaks = (v, who) => new RegExp(`${who} secret`).test(JSON.stringify(v));

// A (5) and B (6) share a Canvas school; the planner cache is A's. seenCourses keeps the school's courses for both, as
// content-canvas.js merges them; B's Insights names B's.
const A_PLAN = [
  C.planner({ id: 1, course: 25, name: 'BIO 1100', title: 'A secret lab', at: '2026-10-16T03:59:00Z' }),
  C.planner({ type: 'quiz', id: 2, course: 26, name: 'ENG 1100', title: 'Reading quiz', at: '2026-10-20T03:59:00Z', sub: { submitted: true } }),
  C.planner({ id: 3, course: 31, name: 'A secret elective', title: 'Portfolio', at: '2026-10-22T03:59:00Z', ov: { id: '9', marked_complete: true } }),
  C.planner({ type: 'planner_note', id: 4, course: null, name: null, title: 'Bring goggles', details: 'A secret note text', at: '2026-10-15T16:00:00Z' }),
  C.planner({ id: 5, course: 25, name: 'BIO 1100', title: 'Lab report', at: '2026-10-14T03:59:00Z', sub: { missing: true } }),
];
const SEEN = [
  { id: 25, name: 'BIO 1100', course_code: 'BIO1100-01', color: '#aabbcc' }, { id: 26, name: 'ENG 1100', course_code: 'ENG1100-02' },
  { id: 27, name: 'MATH 1350', course_code: 'MATH1350' }, { id: 28, name: 'HIST 2010', course_code: 'HIST2010' },
  { id: 31, name: 'A secret elective', course_code: 'ELEC' }, { id: 32, name: 'B secret seminar', course_code: 'SEM', color: '#112233' },
];
const school = async ({ plan, bee = true, ultra = true } = {}) => {
  const store = { todoCache: plan || await C.canvasPlan('5', A_PLAN), seenCourses: { ...await C.canvasSeen(SEEN), ...(ultra && await C.ultraSeen()) } };
  if (bee) await C.keepInsights(store, CANVAS, '6', [...C.canvasGrades().map((c) => C.canvasCourse(c, NOW - 7200e3)), { id: '32', name: 'B secret seminar', items: [], trend: [[NOW - 9e6, 91]] }], NOW - 3600e3);
  if (ultra) await C.keepInsights(store, ULTRA, C.ULTRA_UID, [C.ultraCourse('_101_1', 'BIO 1100: Biology I', C.ultraRows('grades'), NOW)], NOW - 30e3);
  return store;
};

test('each tool is a read tool GZ_AI_TOOLS takes, in the courses group, scoped to an account but accounts_list', () => {
  const tools = ST.tools();
  assert.deepEqual(tools.map((t) => t.name), ['accounts_list', 'courses_list', 'todo_list', 'schedule_list']);
  for (const t of tools) {
    const d = AT.define(t);
    assert.equal(d.kind, 'read', t.name);
    assert.equal(d.group, 'courses', t.name);
    assert.equal(d.scope, t.name === 'accounts_list' ? undefined : 'account', t.name);
    assert.ok(S.clean(d.parameters), t.name);
    // The view adds account (lib/mcp/registry.js) and the harness reason; neither is a tool's own.
    assert.ok(!['account', 'reason'].some((k) => Object.hasOwn(d.parameters.properties, k)), t.name);
    assert.ok(d.title && d.description.length <= AT.LIMIT.description, t.name);
  }
  const reg = AT.registry();
  assert.equal(ST.register(reg).length, 4);
  assert.deepEqual(reg.list(), ['accounts_list', 'courses_list', 'todo_list', 'schedule_list']);
  assert.ok(AT.is(reg.get('todo_list')));
});

test('accounts_list: every account with a planner or Insights record kept, newest first, by school and user', async () => {
  const store = await school();
  // A cleared record, a to-do list's own data and a key that isn't an account's are not accounts with data.
  await C.clearInsights(store, CANVAS, '7', NOW);
  store[`todo:${CANVAS}/8`] = { tasks: [], items: {} };
  store['insights:evil/1'] = { at: NOW, courses: [] };
  const want = [
    { account: UL, lms: 'ultra', origin: ULTRA, seen: NOW - 30e3 },
    { account: A, lms: 'canvas', origin: CANVAS, seen: NOW - 60e3 },
    { account: BEE, lms: 'canvas', origin: CANVAS, seen: NOW - 3600e3 },
  ];
  assert.deepEqual(await run('accounts_list', store), { account: null, at: NOW - 30e3, items: want });
  // Without the worker's key list, the same from one read of everything.
  assert.deepEqual(await run('accounts_list', store, undefined, {}, { keys: undefined }), { account: null, at: NOW - 30e3, items: want });
  // An account with both: when Glaze last read either.
  await C.keepInsights(store, CANVAS, '5', [C.canvasCourse(C.canvasGrades()[0], NOW - 10e3)], NOW - 10e3);
  assert.deepEqual((await run('accounts_list', store)).items[0], { account: A, lms: 'canvas', origin: CANVAS, seen: NOW - 10e3 });
  const none = await run('accounts_list', {});
  assert.deepEqual([none.account, none.at, none.items], [null, null, []]);
  assert.match(none.missing, /^Open /);
});

// The broker's items with Glaze's own mark beside each (lib/mcp/tools-study.js marked): none here.
const unmarked = (items) => items.map((i) => ({ ...i, marked: null }));
test('todo_list: the account\'s planner items as a mod gets them, with the span Glaze read; another account\'s is never shown', async () => {
  const store = await school();
  const mine = unmarked(await B.CALLS.todo.run([], C.broker(store, A)));
  assert.equal(mine.length, 5);
  const plan = store.todoCache;
  assert.deepEqual(await run('todo_list', store, A), { account: A, at: plan.at, covers: { from: Date.parse(plan.start), to: Date.parse(plan.end), complete: true }, items: mine });
  assert.deepEqual(Object.keys(mine[0]), ['id', 'type', 'courseId', 'course', 'title', 'due', 'url', 'done', 'submitted', 'graded', 'late', 'missing', 'marked']);
  assert.ok(!JSON.stringify(mine).includes('note text'), 'planner notes\' text stays out, as for mods');
  // One course; what is due in the next days (from now, as a mod tool's days).
  assert.deepEqual((await run('todo_list', store, A, { course: '25' })).items.map((i) => i.id), ['1', '5']);
  assert.deepEqual((await run('todo_list', store, A, { days: 5 })).items.map((i) => i.id), ['1', '2', '4']);
  assert.deepEqual((await run('todo_list', store, A, { course: '26', days: 5 })).items.map((i) => i.id), ['2']);
  assert.deepEqual((await run('todo_list', store, A, { days: 1 }, { now: () => NOW + 30 * DAY })).items, []);
  // B, the Ultra account, A's user id at another school, and one that merely starts like A's: nothing kept for them.
  for (const [who, page] of [[BEE, 'the Dashboard'], [UL, 'the Courses page'], ['https://other.instructure.com/5', 'the Dashboard'], [`${CANVAS}/55`, 'the Dashboard']]) {
    const r = await run('todo_list', store, who, { days: 30 });
    assert.deepEqual([r.account, r.at, r.items], [who, null, []], who);
    assert.equal(r.missing, `Open ${page} at ${who.slice(0, who.lastIndexOf('/'))}, signed in as this account, so Glaze reads its to-do list.`);
    assert.ok(!leaks(r, 'A'), who);
  }
  // Ultra's planner, once it is the one kept, with a calendar Glaze couldn't read whole.
  store.todoCache = await C.ultraPlan(NOW - 120e3, false);
  const u = await run('todo_list', store, UL);
  assert.deepEqual(u.items, unmarked(await B.CALLS.todo.run([], C.broker(store, UL))));
  assert.deepEqual(u.items.map((i) => i.title), ['Publisher Homework 4', 'Lab Report 3', 'Essay 3']);
  assert.equal(u.covers.complete, false);
  assert.deepEqual((await run('todo_list', store, A)).items, [], 'A\'s is gone with it');
});

test('schedule_list: dates or date-times, at most 60 days, the same items as the broker\'s schedule', async () => {
  const store = await school();
  const env = C.broker(store, A);
  const local = (y, m, d) => new Date(y, m - 1, d).getTime();
  // A date alone is the student's own day, its start to its end.
  const days = await run('schedule_list', store, A, { from: '2026-10-15', to: '2026-10-19' });
  assert.deepEqual(days.items, unmarked(await B.CALLS.schedule.run([local(2026, 10, 15), local(2026, 10, 20) - 1], env)));
  assert.equal(days.at, store.todoCache.at);
  assert.deepEqual(days.covers, { from: Date.parse(store.todoCache.start), to: Date.parse(store.todoCache.end), complete: true });
  // With a zone, that moment; without one, the student's own clock.
  for (const [from, to, want] of [
    ['2026-10-15T00:00:00Z', '2026-10-20T04:00:00Z', [Date.UTC(2026, 9, 15), Date.UTC(2026, 9, 20, 4)]],
    ['2026-10-15T12:00+02:00', '2026-10-21T23:59:59.5-04:00', [Date.UTC(2026, 9, 15, 10), Date.UTC(2026, 9, 22, 3, 59, 59, 500)]],
    ['2026-10-13T10:00', '2026-10-16T09:30:15', [new Date(2026, 9, 13, 10).getTime(), new Date(2026, 9, 16, 9, 30, 15).getTime()]]]) {
    assert.deepEqual((await run('schedule_list', store, A, { from, to })).items, unmarked(await B.CALLS.schedule.run(want, env)), `${from} ${to}`);
  }
  assert.deepEqual((await run('schedule_list', store, A, { from: '2026-10-16T00:00:00Z', to: '2026-10-21T00:00:00Z' })).items.map((i) => i.id), ['1', '2']);
  assert.equal((await run('schedule_list', store, A, { from: '2026-10-01T00:00:00Z', to: '2026-11-30T00:00:00Z' })).items.length, 5, 'sixty days exactly');
  // Refused, as the broker refuses them: backwards, longer than 60 days, not a date.
  for (const [from, to] of [['2026-10-20', '2026-10-19'], ['2026-10-01T00:00:00Z', '2026-11-30T00:00:00.001Z'], ['2026-10-01', '2026-12-15'], ['2026-02-30', '2026-03-01'],
    ['2026-10-15T24:00', '2026-10-16'], ['2026-10-15T10:00+25:00', '2026-10-16'], ['tomorrow', '2026-10-16'], ['1969-12-31', '1970-01-02'], ['1970-01-01T00:00+01:00', '1970-01-02'], [1792000000000, 1792100000000], ['2026-10-15', undefined]]) {
    const r = await run('schedule_list', store, A, { from, to });
    assert.equal(r.ok, false, `${from} ${to}`);
    assert.equal(typeof r.error, 'string');
    assert.ok(!leaks(r, 'A'));
  }
  // The schema an app sees holds to the same forms.
  const p = tool('schedule_list').parameters;
  assert.deepEqual(S.validate({ from: '2026-10-15', to: '2026-10-21T23:59:59.999Z' }, p), []);
  assert.notDeepEqual(S.validate({ from: '10/15/2026', to: '2026-10-21' }, p), []);
  assert.notDeepEqual(S.validate({ from: '2026-10-15' }, p), []);
  // Another account: nothing, and what to open.
  const r = await run('schedule_list', store, BEE, { from: '2026-10-15', to: '2026-10-19' });
  assert.deepEqual([r.at, r.items], [null, []]);
  assert.match(r.missing, /Dashboard at https:\/\/school\.instructure\.com/);
});

test('courses_list: only account-owned memberships, in the slim mod shape, with one or several accounts at a school', async () => {
  // Ultra: even one known account cannot prove ownership of the school's other courses.
  const store = await school();
  const ultra = await run('courses_list', store, UL);
  const [bio] = await B.CALLS.courses.run([], C.broker(store, UL));
  assert.deepEqual(ultra, { account: UL, at: store[`insights:${UL}`].at, items: [{ ...bio, color: null }] });
  assert.deepEqual(ultra.items.map((c) => c.id), ['_101_1']);
  assert.deepEqual(Object.keys(ultra.items[0]), ['id', 'name', 'code', 'color']);
  // Canvas with A alone: the account's planner establishes membership and its cache time.
  const alone = await school({ bee: false, ultra: false });
  delete alone.seenCourses[`canvas:${CANVAS}/32`];
  const solo = await run('courses_list', alone, A);
  assert.deepEqual(solo, { account: A, at: alone.todoCache.at, items: [
    { id: '25', name: 'BIO 1100', code: 'BIO1100-01', color: null }, { id: '26', name: 'ENG 1100', code: 'ENG1100-02', color: null },
    { id: '31', name: 'A secret elective', code: 'ELEC', color: null }] });
  // A and B: the courses each one's own planner and Insights name, by its own names, and no colour another may have picked.
  const a = await run('courses_list', store, A), b = await run('courses_list', store, BEE);
  assert.deepEqual(a, { account: A, at: store.todoCache.at, items: [
    { id: '25', name: 'BIO 1100', code: 'BIO1100-01', color: null }, { id: '26', name: 'ENG 1100', code: 'ENG1100-02', color: null },
    { id: '31', name: 'A secret elective', code: 'ELEC', color: null }] });
  assert.deepEqual(b.items.map((c) => [c.id, c.name, c.code, c.color]), [['27', 'MATH 1350', 'MATH1350', null], ['26', 'ENG 1100', 'ENG1100-02', null],
    ['25', 'BIO 1100', 'BIO1100-01', null], ['28', 'HIST 2010', 'HIST2010', null], ['32', 'B secret seminar', 'SEM', null]]);
  assert.equal(b.at, store[`insights:${CANVAS}/6`].at);
  assert.ok(!leaks(a, 'B') && !leaks(b, 'A'));
  // Nothing of its own kept for an account (its planner gone to another), or no course at its school: what to open.
  store.todoCache = await C.ultraPlan();
  for (const [who, s] of [[A, store], [`${ULTRA}/_901_1`, { ...store, seenCourses: {} }], ['https://other.instructure.com/5', store]]) {
    const r = await run('courses_list', s, who);
    assert.deepEqual([r.at, r.items], [null, []], who);
    assert.match(r.missing, /^Open the (Dashboard|Courses page) at .*, signed in as this account, so Glaze reads its courses\.$/, who);
  }
});

test('nothing is read for an account that isn\'t exactly one, and nothing leaks', async () => {
  const store = await school();
  const bad = ['', 'x', CANVAS, `${CANVAS}/`, `${CANVAS}/../5`, `${CANVAS}/5/`, `${CANVAS}/5?x=1`, `${CANVAS}/5#x`, ` ${A}`, `${A} `, `${CANVAS.toUpperCase()}/5`,
    `${CANVAS}:443/5`, `${CANVAS}/abc`, `${CANVAS}/_5`, `${CANVAS}/${'9'.repeat(21)}`, 'javascript:alert(1)/5', 'file:///5', `ftp://school.instructure.com/5`,
    undefined, null, 5, ['x'], { toString: () => A }];
  for (const account of bad) {
    for (const name of ['courses_list', 'todo_list', 'schedule_list']) {
      const c = C.ctx(store, account);
      const r = await tool(name).run({ from: '2026-10-15', to: '2026-10-19' }, c);
      assert.deepEqual(r, { ok: false, error: 'Unknown account.' }, `${name} ${String(account)}`);
      assert.deepEqual(c.local.reads, [], `${name} reads nothing`);
    }
  }
  // Glaze's own AI calling with its own context: no account, so nothing.
  assert.deepEqual(await tool('todo_list').run({}, { local: C.area(store) }), { ok: false, error: 'Unknown account.' });
});

test('account line terminators are refused before any storage read', async () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    for (const account of [A + suffix, UL + suffix]) {
      assert.equal(ST.parse(account), null, JSON.stringify(account));
      for (const name of ['courses_list', 'todo_list', 'schedule_list']) {
        const c = C.ctx({}, account);
        assert.deepEqual(await tool(name).run({ from: '2026-10-15', to: '2026-10-19' }, c), { ok: false, error: 'Unknown account.' });
        assert.deepEqual(c.local.reads, []);
      }
    }
  }
});

test('courses_list never attributes school-wide courses without account evidence, even with only one known account', async () => {
  const store = await school({ bee: false, ultra: false });
  const a = await run('courses_list', store, A);
  assert.ok(!leaks(a, 'B'), 'B left courses but no planner or Insights record');
  assert.deepEqual(a.items.map((c) => c.id), ['25', '26', '31']);
  for (const account of [BEE, `${CANVAS}/7`]) {
    const r = await run('courses_list', store, account);
    assert.deepEqual(r.items, [], 'an arbitrary account must not inherit the school cache');
    assert.equal(r.at, null);
    assert.match(r.missing, /^Open /);
  }
  delete store.todoCache;
  assert.deepEqual((await run('courses_list', store, A)).items, [], 'even no remaining account records prove no ownership');
});

test('cache fixtures record Canvas courses with the real writer\'s id and name checks', async () => {
  const seen = await C.canvasSeen([SEEN[0], { id: 'bad', name: 'Invalid', course_code: 'BAD' }, { id: 90, name: '', course_code: 'EMPTY' }]);
  assert.deepEqual(Object.keys(seen), [`canvas:${CANVAS}/25`]);
  assert.deepEqual(seen[`canvas:${CANVAS}/25`], { name: 'BIO 1100', code: 'BIO1100-01', canvas: true, color: '#aabbcc' });
});
