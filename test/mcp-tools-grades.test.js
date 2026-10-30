// The grades group's MCP tools (lib/mcp/tools-grades.js): grades_list, each course's latest grade as lib/modbroker.js
// gives a mod, and course_grades, one course's work and grade over the term, both from the account's own Insights record
// (test/helpers/mcp-caches.cjs makes them with the code that writes them). No account ever sees another's.
const test = require('node:test');
const assert = require('node:assert/strict');
const GR = require('../lib/mcp/tools-grades.js');
const B = require('../lib/modbroker.js');
const AT = require('../lib/ai/tools.js');
const S = require('../lib/ai/schema.js');
const C = require('./helpers/mcp-caches.cjs');

const { CANVAS, ULTRA, NOW } = C;
const A = `${CANVAS}/5`, BEE = `${CANVAS}/6`, UL = `${ULTRA}/${C.ULTRA_UID}`;
const tool = (name) => GR.tools().find((t) => t.name === name);
const run = (name, store, account, args = {}) => tool(name).run(args, C.ctx(store, account));
const leaks = (v, who) => new RegExp(`${who} secret`).test(JSON.stringify(v));

// A's record, B's (newer, at the same school, with a course only B takes) and the Ultra account's.
const school = async () => {
  const store = { todoCache: await C.canvasPlan('5', [C.planner({ id: 1, title: 'A secret lab', at: '2026-10-16T03:59:00Z' })]) };
  const [math, eng, bio, hist] = C.canvasGrades();
  await C.keepInsights(store, CANVAS, '5', [C.canvasCourse(bio, NOW - 7200e3), C.canvasCourse(eng, NOW - 7200e3, { name: 'A secret English' })], NOW - 7200e3);
  await C.keepInsights(store, CANVAS, '6', [C.canvasCourse(math, NOW - 3600e3), C.canvasCourse(hist, NOW - 3600e3),
    { ...C.canvasCourse(bio, NOW - 3600e3), id: '32', name: 'B secret seminar' }], NOW - 3600e3);
  await C.keepInsights(store, ULTRA, C.ULTRA_UID, [C.ultraCourse('_101_1', 'BIO 1100: Biology I', C.ultraRows('grades'), NOW),
    C.ultraCourse('_102_1', 'ENG 1100: College Writing', C.ultraRows('grades-status'), NOW)], NOW - 30e3);
  return store;
};

test('each tool is a read tool GZ_AI_TOOLS takes, in the grades group, scoped to an account', () => {
  const tools = GR.tools();
  assert.deepEqual(tools.map((t) => t.name), ['grades_list', 'course_grades']);
  for (const t of tools) {
    const d = AT.define(t);
    assert.deepEqual([d.kind, d.group, d.scope], ['read', 'grades', 'account'], t.name);
    assert.ok(S.clean(d.parameters) && !['account', 'reason'].some((k) => Object.hasOwn(d.parameters.properties, k)), t.name);
  }
  assert.deepEqual(S.validate({}, tool('course_grades').parameters), ['$: missing course']);
  const reg = AT.registry();
  assert.equal(GR.register(reg).length, 2);
  assert.deepEqual(reg.list(), ['grades_list', 'course_grades']);
});

test('grades_list: each account\'s own latest grades, as a mod gets them, kept apart at one school and across schools', async () => {
  const store = await school();
  for (const who of [A, BEE, UL]) {
    const r = await run('grades_list', store, who);
    const rec = store[`insights:${who}`];
    assert.deepEqual(r, { account: who, at: rec.at, items: await B.CALLS.grades.run([], C.broker(store, who)) }, who);
    assert.ok(r.items.length >= 2, who);
  }
  // Each course's last trend point: Canvas's own current score (test/insights.test.js holds the trend to it).
  const last = (id) => store[`insights:${A}`].courses.find((c) => c.id === id).trend.at(-1)[0];
  assert.deepEqual((await run('grades_list', store, A)).items, [
    { courseId: '25', name: 'BIO 1100', percent: 83.85, at: last('25') },
    { courseId: '26', name: 'A secret English', percent: 88, at: last('26') }]);
  assert.deepEqual((await run('grades_list', store, UL)).items.map((g) => [g.courseId, g.percent]), [['_101_1', 88], ['_102_1', 85]]);
  // B's record is the school's newest: A never gets it, nor B A's.
  assert.ok(!leaks(await run('grades_list', store, A), 'B'));
  assert.ok(!leaks(await run('grades_list', store, BEE), 'A'));
  // No record, a cleared one, A's id at another school, an id that starts like A's: what to open.
  await C.clearInsights(store, CANVAS, '7', NOW);
  for (const [who, page] of [[`${CANVAS}/7`, 'the Dashboard'], [`${CANVAS}/8`, 'the Dashboard'], ['https://other.instructure.com/5', 'the Dashboard'], [`${CANVAS}/55`, 'the Dashboard'], [`${ULTRA}/_901_1`, 'the Courses page']]) {
    const r = await run('grades_list', store, who);
    assert.deepEqual(r, { account: who, at: null, items: [], missing: `Turn on Insights in Glaze's settings, then open it from ${page} at ${who.slice(0, who.lastIndexOf('/'))}, signed in as this account.` }, who);
  }
});

test('course_grades: one course\'s grade, its grade after each day\'s graded work, and where each piece of work stands', async () => {
  const store = await school();
  const rec = store[`insights:${A}`];
  const bio = rec.courses.find((c) => c.id === '25');
  const r = await run('course_grades', store, A, { course: '25' });
  const [latest] = (await run('grades_list', store, A)).items;
  assert.deepEqual(r.course, { ...latest, lettersOnly: false, complete: true }, 'the same figure grades_list gives');
  assert.equal(r.account, A);
  assert.equal(r.at, rec.at);
  assert.deepEqual(r.trend, bio.trend.map(([at, percent]) => ({ at, percent, period: null })));
  const STATUS = { on: 'on-time', late: 'late', missing: 'missing', excused: 'excused', open: 'open', '': 'unknown' };
  assert.deepEqual(r.items, bio.items.map((i) => ({ type: i.k.split(':')[0], id: i.k.split(':')[1], title: i.n, due: i.d || null, points: i.p, handedIn: i.a || null, status: STATUS[i.s] })));
  assert.ok(r.items.length > 5 && new Set(r.items.map((i) => i.status)).size > 1);
  assert.deepEqual(Object.keys(r), ['account', 'at', 'course', 'trend', 'items']);
  // Ultra's: its work's standing from the gradebook rows, as Insights reads it.
  const u = await run('course_grades', store, UL, { course: '_101_1' });
  assert.deepEqual(u.course.percent, 88);
  const by = Object.fromEntries(u.items.map((i) => [i.id, i]));
  assert.deepEqual([by._603_1.type, by._603_1.status, by._603_1.title, by._605_1.type], ['assignment', 'open', 'Lab Report 3', 'discussion_topic'], 'due on the 19th');
  const status = await run('course_grades', store, UL, { course: '_102_1' });
  assert.deepEqual(status.items.map((i) => i.status).sort(), ['late', 'on-time', 'open'], 'graded on time, handed in late, and Essay 3, due on the 23rd');
  // A course Insights read in part (more pages than it reads) says so.
  rec.courses[0].more = true;
  assert.equal((await run('course_grades', store, A, { course: '25' })).course.complete, false);
});

test('course_grades: letter grades only shows no figure, as Insights shows none; a course not in the account\'s record is refused', async () => {
  const store = await school();
  const q = { ...C.canvasGrades()[2], course: { ...C.canvasGrades()[2].course, restrict_quantitative_data: true } };
  await C.keepInsights(store, CANVAS, '5', [C.canvasCourse(q, NOW)], NOW);
  const r = await run('course_grades', store, A, { course: '25' });
  assert.deepEqual(r.course, { courseId: '25', name: 'BIO 1100', percent: null, at: null, lettersOnly: true, complete: true });
  assert.deepEqual(r.trend, []);
  assert.ok(r.items.length && r.items.every((i) => i.points === null));
  // B's course, by its id, from A: nothing of B's.
  for (const course of ['32', '27', 'nope', '']) {
    const no = await run('course_grades', store, A, { course });
    assert.equal(no.ok, false, course);
    assert.equal(typeof no.error, 'string');
    assert.ok(!leaks(no, 'B') && !JSON.stringify(no).includes('MATH'), course);
  }
  // No record: what to open.
  assert.match((await run('course_grades', store, `${CANVAS}/9`, { course: '25' })).missing, /^Turn on Insights/);
});

test('nothing is read for an account that isn\'t exactly one', async () => {
  const store = await school();
  for (const account of ['', CANVAS, `${CANVAS}/`, `${CANVAS}/5/`, `${CANVAS}/../5`, `${CANVAS}:443/5`, ` ${A}`, `${CANVAS}/_5`, 'file:///5', undefined, 5, { toString: () => A }]) {
    for (const name of ['grades_list', 'course_grades']) {
      const c = C.ctx(store, account);
      assert.deepEqual(await tool(name).run({ course: '25' }, c), { ok: false, error: 'Unknown account.' }, `${name} ${String(account)}`);
      assert.deepEqual(c.local.reads, []);
    }
  }
});

test('grade tools refuse trailing account line terminators before reading', async () => {
  for (const suffix of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    for (const account of [A + suffix, UL + suffix]) {
      for (const name of ['grades_list', 'course_grades']) {
        const c = C.ctx({}, account);
        assert.deepEqual(await tool(name).run({ course: '25' }, c), { ok: false, error: 'Unknown account.' });
        assert.deepEqual(c.local.reads, []);
      }
    }
  }
});

test('course_grades marks its item limit as incomplete even when Insights cached the whole course', async () => {
  const store = {}, raw = C.canvasGrades()[2];
  const assignment = raw.groups[0].assignments[0];
  raw.groups = [{ ...raw.groups[0], assignments: Array.from({ length: B.LIMIT.items + 1 }, (_, i) => ({ ...assignment, id: 10000 + i })) }];
  await C.keepInsights(store, CANVAS, '5', [C.canvasCourse(raw, NOW)], NOW);
  const rec = store[`insights:${A}`].courses[0];
  assert.equal(rec.items.length, B.LIMIT.items + 1);
  assert.equal(rec.cut, 0);
  const r = await run('course_grades', store, A, { course: rec.id });
  assert.equal(r.items.length, B.LIMIT.items);
  assert.equal(r.course.complete, false);
});
