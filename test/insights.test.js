// Insights (lib/insights.js): a term in numbers from the student's own Canvas data, as table tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/insights.js');
const T = require('../lib/todo.js');
const live = require('./fixtures/canvas-grades.json');

const TZ = 'America/New_York';
const at = (s) => Date.parse(s);
const NOW = at('2026-10-15T16:00:00Z'); // a Thursday

test('the term: current student courses, its name and dates, and a key that names it', () => {
  const term = { id: 5, name: 'Fall 2026', start_at: '2026-08-24T04:00:00Z', end_at: '2026-12-19T05:00:00Z' };
  const dflt = { id: 1, name: 'Default Term', start_at: null, end_at: null };
  const c = (id, more = {}) => ({ id, name: `C${id}`, enrollments: [{ type: 'student' }], term, ...more });
  const r = I.term([
    c(1), c(2), c(3, { term: dflt }),
    c(4, { enrollments: [{ type: 'teacher' }] }), // not as a student
    c(5, { access_restricted_by_date: true }),
    c(6, { term: { ...term, id: 4, end_at: '2026-05-01T00:00:00Z' } }), // ended
    c(7, { restrict_enrollments_to_course_dates: true, start_at: '2026-11-01T00:00:00Z', end_at: null }), // not begun
    c(8, { name: '' }),
  ], NOW);
  assert.deepEqual(r.courses.map((x) => x.id), [1, 2, 3]);
  assert.equal(r.key, '1,5');
  assert.equal(r.name, 'Fall 2026', 'the default term has no dates, so it never names the term');
  assert.equal(r.from, at(term.start_at));
  assert.equal(r.to, at(term.end_at));
  assert.deepEqual(I.term([c(3, { term: dflt })], NOW), { key: '1', name: '', from: 0, to: 0, courses: [c(3, { term: dflt })] });
});

test('an item stands as Canvas says: excused, late, missing, on time, open, or not counted', () => {
  const due = '2026-10-10T03:59:00Z';
  const rows = [
    [{ excused: true, late: true }, 'excused'],
    [{ submitted_at: '2026-10-11T00:00:00Z', late: true }, 'late'],
    [{ missing: true, score: 0, workflow_state: 'graded' }, 'missing'],
    [{ submitted_at: '2026-10-09T00:00:00Z' }, 'on'],
    [{ score: 9, workflow_state: 'graded' }, 'on'], // graded with nothing handed in: on paper
    [{ workflow_state: 'unsubmitted' }, ''], // past due, nothing in, not missing
    [null, ''],
  ];
  for (const [submission, s] of rows) assert.equal(I.item({ id: 1, name: 'A', due_at: due, points_possible: 10, submission }, NOW).s, s, JSON.stringify(submission));
  assert.equal(I.item({ id: 1, due_at: '2026-10-20T03:59:00Z', submission: {} }, NOW).s, 'open');
  assert.equal(I.item({ id: 1, due_at: null, submission: {} }, NOW).s, 'open');
  // Its key in Better To Do's plans.
  assert.equal(I.item({ id: 7, quiz_id: 3 }, NOW).k, 'quiz:3');
  assert.equal(I.item({ id: 7, discussion_topic: { id: 4 } }, NOW).k, 'discussion_topic:4');
  assert.deepEqual(I.item({ id: 7, name: ' Lab\n1 ', due_at: due, points_possible: '12.5', submission: { submitted_at: '2026-10-08T00:00:00Z' } }, NOW),
    { k: 'assignment:7', n: 'Lab 1', d: at(due), p: 12.5, a: at('2026-10-08T00:00:00Z'), s: 'on' });
});

test('on time: the share of decided work, excused left out, and work handed in a day early', () => {
  const d = at('2026-10-10T03:59:00Z');
  const t = I.tally([
    { s: 'on', d, a: d - 2 * I.DAY }, { s: 'on', d, a: d - 3600e3 }, { s: 'on', d: 0, a: d }, { s: 'late' }, { s: 'missing' }, { s: 'excused' }, { s: 'open' }, { s: '' },
  ]);
  assert.deepEqual(t, { on: 3, late: 1, missing: 1, excused: 1, early: 1, share: 0.6 });
  assert.equal(I.tally([{ s: 'excused' }, { s: 'open' }]).share, null, 'nothing decided yet: no share');
});

test('the best run of on-time weeks: weeks with nothing due neither count nor break it', () => {
  const w = (n, s) => ({ d: at('2026-09-01T16:00:00Z') + n * 7 * I.DAY, s }); // Tuesdays
  const items = [w(0, 'on'), w(0, 'on'), w(1, 'on'), w(3, 'on'), w(4, 'late'), w(4, 'on'), w(5, 'on'), w(6, 'on'), w(6, 'open'), w(7, 'excused')];
  assert.deepEqual(I.runs(items, TZ), { best: 3, now: 2 });
  assert.deepEqual(I.runs([], TZ), { best: 0, now: 0 });
  // Monday is a week's first day in the student's zone: Sunday 23:00 in New York is still last week.
  assert.equal(I.week(T.dayOf(at('2026-10-12T03:00:00Z'), TZ)), T.keyDay('2026-10-05'));
  assert.equal(I.week(T.dayOf(at('2026-10-12T05:00:00Z'), TZ)), T.keyDay('2026-10-12'));
});

test('workload by week: counts and points over the term, the busiest three weeks ahead marked', () => {
  const on = (day, p = 10, s = 'open', n = 'x') => ({ d: at(`${day}T20:00:00Z`), p, s, n });
  const items = [
    on('2026-09-02'), on('2026-10-13', 5, 'on'), on('2026-10-14', 5), on('2026-10-20'), on('2026-10-21'), on('2026-10-22'),
    on('2026-10-28', 50), on('2026-10-29', 50), on('2026-11-04', 100), on('2026-11-11'), on('2026-11-12', 1, 'excused'), { d: 0, p: 9, s: 'open' },
  ];
  const weeks = I.workload(items, { from: at('2026-08-24T04:00:00Z'), to: at('2026-12-19T05:00:00Z'), now: NOW, tz: TZ });
  assert.equal(T.dayKey(weeks[0].w), '2026-08-24');
  assert.equal(T.dayKey(weeks.at(-1).w), '2026-12-14');
  const of = (k) => weeks.find((w) => T.dayKey(w.w) === k);
  assert.deepEqual([of('2026-08-31').n, of('2026-10-12').n, of('2026-10-12').p, of('2026-11-09').n], [1, 2, 10, 1], 'excused work is not workload');
  assert.ok(of('2026-10-12').now && !of('2026-10-12').past && of('2026-10-05').past);
  assert.deepEqual(weeks.filter((w) => w.heavy).map((w) => T.dayKey(w.w)), ['2026-10-12', '2026-10-19', '2026-10-26'], 'most items first, then most points');
  assert.equal(weeks.reduce((n, w) => n + w.n, 0), 10);
  assert.deepEqual(I.workload([], { from: 0, to: 0, now: NOW, tz: TZ }), []);
  // No term dates: the due dates make the term, and half a year either side of now is the most it shows.
  const far = I.workload([on('2025-01-01'), on('2027-12-01')], { from: 0, to: 0, now: NOW, tz: TZ });
  assert.equal(far.length, 53);
  assert.equal(far.reduce((n, w) => n + w.n, 0), 0);
});

test('plans kept: done by the end of the planned day; sessions by the day of the last one', () => {
  const items = [
    { k: 'assignment:1', a: at('2026-10-06T22:00:00Z') }, // done Tue Oct 6, New York
    { k: 'assignment:2', a: at('2026-10-09T03:00:00Z') }, // done Thu Oct 8 at 23:00 New York
    { k: 'quiz:3', a: 0 }, // not handed in
    { k: 'assignment:4', a: 0 },
    { k: 'assignment:5', a: 0 },
  ];
  const s = (iso, min = 30) => ({ at: at(iso), min });
  const data = T.clean({
    tasks: [{ id: 't1', title: 'Read ch. 3', done: at('2026-10-02T14:00:00Z') }, { id: 't2', title: 'Notes' }],
    items: {
      'assignment:1': { on: '2026-10-06', sessions: [s('2026-10-05T14:00:00Z')] }, // kept; its session (the day before) not
      'assignment:2': { on: '2026-10-07', sessions: [s('2026-10-05T14:00:00Z'), s('2026-10-08T22:00:00Z')] }, // a day late; last session's day: kept
      'quiz:3': { on: '2026-10-09' }, // not kept
      'assignment:4': { done: true, on: '2026-10-09' }, // ticked, time unknown: left out
      'assignment:5': { on: '2026-10-15' }, // today: not over yet
      'assignment:9': { on: '2026-10-01' }, // not this term's work
      'task:t1': { on: '2026-10-02' }, // kept
      'task:t2': { on: '2026-08-01', sessions: [s('2026-10-10T14:00:00Z')] }, // before the term: only its session counts, not kept
    },
  });
  const r = I.planning(data, items, { now: NOW, tz: TZ, fromDay: T.keyDay('2026-08-24') });
  assert.deepEqual(r, { on: { kept: 2, all: 4 }, focus: { kept: 1, all: 3 } });
  assert.deepEqual(I.planning(T.clean(null), items, { now: NOW, tz: TZ }), { on: { kept: 0, all: 0 }, focus: { kept: 0, all: 0 } });
});

test('a grade trend ends on Canvas\'s own current score, for every course of the live fixture', () => {
  for (const { course, groups, periods } of live.courses) {
    const info = { weighted: course.apply_assignment_group_weights, periods, weightedPeriods: course.has_weighted_grading_periods };
    const tr = I.trend(groups, info, TZ);
    if (course.enrollment.computed_current_score == null) { assert.deepEqual(tr, [], course.course_code); continue; }
    assert.ok(tr.length >= 2, course.course_code);
    assert.equal(tr.at(-1)[1], course.enrollment.computed_current_score, course.course_code);
    assert.ok(tr.every(([ms], i) => !i || ms > tr[i - 1][0]), 'in date order, one point a day');
  }
});

test("with grading periods, the trend's last point is the current period's score, as Canvas's current score is", () => {
  const a = (id, due, score) => ({ id, points_possible: 10, published: true, submission_types: ['online_upload'], due_at: due, submission: { score, workflow_state: 'graded' } });
  const groups = [{ id: 1, assignments: [a(1, '2026-09-10T20:00:00Z', 10), a(2, '2026-10-05T20:00:00Z', 5), a(3, '2026-10-06T20:00:00Z', null)] }];
  const periods = [{ id: '1', start_date: '2026-08-24T04:00:00Z', end_date: '2026-10-01T04:00:00Z', weight: 50 }, { id: '2', start_date: '2026-10-01T04:00:00Z', end_date: '2026-12-19T05:00:00Z', weight: 50 }];
  const info = { weighted: false, periods, weightedPeriods: false };
  const tr = I.trend(groups, info, TZ, 2);
  assert.deepEqual(tr, [[at('2026-09-10T20:00:00Z'), 100, '1'], [at('2026-10-05T20:00:00Z'), 50, '2']]);
  const C = require('../lib/gradecalc.js');
  assert.equal(tr.at(-1)[1], C.round2(C.calc(C.fromApi(groups, info), {}, { period: '2' }).current), "W2's engine for that period");
  // Without a current period (between periods, or none), the course as Canvas totals it.
  assert.deepEqual(I.trend(groups, info, TZ, null).map((p) => p[1]), [100, 75]);
  assert.deepEqual(I.trend(groups, info, TZ, 9).map((p) => p[1]), [100, 75], 'a period the course doesn\'t have');
  // The view: First, Now and Change are the current period's.
  const rec = I.clean({ courses: [{ id: '1', name: 'BIO', gp: '2', trend: tr, items: [] }] });
  assert.deepEqual(['first', 'last', 'change', 'gp'].map((k) => I.view(rec, { now: NOW, tz: TZ }).courses[0][k]), [50, 50, null, '2']);
});

test('a grade trend: weights apply from the first point, same-day work is one point, excused work none', () => {
  const g = (id, weight, ...assignments) => ({ id, group_weight: weight, assignments });
  const a = (id, due, score, possible = 10, sub = {}) => ({ id, points_possible: possible, published: true, submission_types: ['online_upload'], due_at: due, submission: { score, workflow_state: 'graded', ...sub } });
  const groups = [
    g(1, 50, a(1, '2026-09-01T20:00:00Z', 10), a(2, '2026-09-08T20:00:00Z', 5), a(3, '2026-09-08T21:00:00Z', 10), a(6, '2026-09-20T20:00:00Z', null, 10, { excused: true })),
    g(2, 50, a(4, '2026-09-15T20:00:00Z', 6), a(5, '2026-10-30T20:00:00Z', null)),
  ];
  assert.deepEqual(I.trend(groups, { weighted: true }, TZ), [[at('2026-09-01T20:00:00Z'), 100], [at('2026-09-08T21:00:00Z'), 83.33], [at('2026-09-15T20:00:00Z'), 71.67]]);
  assert.deepEqual(I.trend([], {}, TZ), []);
});

test('the view: per course and overall, and the summary card', () => {
  const rec = I.clean({
    term: '5', name: 'Fall 2026', from: at('2026-08-24T04:00:00Z'), to: at('2026-12-19T05:00:00Z'), at: NOW,
    courses: [
      { id: '1', name: 'BIO', trend: [[at('2026-09-01T00:00:00Z'), 80], [at('2026-10-01T00:00:00Z'), 86.5]],
        items: [{ k: 'assignment:1', n: 'Lab', d: at('2026-10-01T20:00:00Z'), p: 10, a: at('2026-09-30T20:00:00Z'), s: 'on' }, { k: 'assignment:2', n: 'Quiz', d: at('2026-10-21T20:00:00Z'), p: 5, a: 0, s: 'open' }] },
      { id: '2', name: 'ENG', trend: [[at('2026-09-01T00:00:00Z'), 90], [at('2026-10-01T00:00:00Z'), 88]],
        items: [{ k: 'assignment:3', n: 'Essay', d: at('2026-10-02T20:00:00Z'), p: 20, a: at('2026-10-03T20:00:00Z'), s: 'late' }, { k: 'assignment:4', n: 'Draft', d: at('2026-10-06T20:00:00Z'), p: 5, a: 0, s: 'missing' }] },
      { id: '3', name: 'ART', q: true, trend: [[at('2026-09-01T00:00:00Z'), 50], [at('2026-10-01T00:00:00Z'), 99]], items: [] },
    ],
  });
  const v = I.view(rec, { now: NOW, tz: TZ, data: T.clean({ items: { 'assignment:1': { on: '2026-09-30' } } }), streak: { best: 12 } });
  assert.deepEqual(v.courses.map((c) => [c.name, c.tally.share, c.first, c.last, c.change]), [['BIO', 1, 80, 86.5, 6.5], ['ENG', 0, 90, 88, -2], ['ART', null, null, null, null]], 'a letters-only course shows no numbers');
  assert.equal(v.total.share, 1 / 3);
  assert.deepEqual(v.card, { share: 1 / 3, handed: 2, courses: 3, best: 0, rise: { name: 'BIO', change: 6.5 }, busiest: { w: T.keyDay('2026-09-28'), n: 2 }, left: 10, plans: 1, streak: 12 });
  // No plans, no rise, no term end: those say nothing.
  const bare = I.view({ ...rec, to: 0, courses: [rec.courses[1]] }, { now: NOW, tz: TZ });
  assert.deepEqual([bare.card.rise, bare.card.left, bare.card.plans, bare.card.streak], [null, null, null, null]);
});

test('the cache keeps only what it should, and stays small', () => {
  assert.equal(I.clean(null), null);
  const r = I.clean({
    term: '5', at: 5, cl: -1, extra: 'x',
    courses: [{ id: '1', name: 'BIO', q: 1, secret: 'x', items: [{ k: 'assignment:1', n: 'A', d: 1, p: 'no', a: 'x', s: 'on', html: '<b>' }, { k: 'javascript:1', s: 'on' }, { k: 'quiz:2', s: 'weird' }],
      trend: [[1, 50], [2, Infinity], 'x', [0, 3]] }, { id: 'x' }],
  });
  assert.deepEqual(r, { term: '5', name: '', from: 0, to: 0, at: 5, cl: 0, cut: 0,
    courses: [{ id: '1', name: 'BIO', q: false, more: false, gp: '', cut: 2, items: [{ k: 'assignment:1', n: 'A', d: 1, p: 0, a: 0, s: 'on' }], trend: [[1, 50]] }] }, 'what it drops, it counts');
  assert.deepEqual(I.clean(r), r, 'and cleaning again keeps the count');
});

test('nothing is left out quietly: 301 items all count, and whatever a cap or paging leaves out is named', () => {
  const D = at('2026-10-01T20:00:00Z');
  const items = (n, s) => Array.from({ length: n }, (_, i) => ({ k: `assignment:${i + 2}`, n: 'x', d: D, p: 1, a: 0, s }));
  const rec = I.clean({ term: '5', courses: [{ id: '1', name: 'BIO', items: [{ k: 'assignment:1', d: D, p: 1, a: D - 1, s: 'on' }, ...items(300, 'missing')], trend: [] }] });
  const v = I.view(rec, { now: NOW, tz: TZ });
  assert.deepEqual([v.total.on, v.total.missing, v.total.share, v.courses[0].cut], [1, 300, 1 / 301, 0]);
  assert.deepEqual(v.left, { names: [], courses: 0 });
  // Past the cap (far above a real course): counted as left out, and the view names the course.
  const big = I.clean({ courses: [{ id: '1', name: 'BIO', items: items(I.MAX.items + 1, 'on') }, { id: '2', name: 'ENG', more: true, items: [] },
    ...Array.from({ length: I.MAX.courses }, (_, i) => ({ id: String(i + 3), name: 'X', items: [] }))] });
  assert.equal(big.courses[0].items.length, I.MAX.items);
  assert.equal(big.courses[0].cut, 1);
  assert.equal(big.cut, 2, 'two courses past the cap');
  assert.deepEqual(I.view(big, { now: NOW, tz: TZ }).left, { names: ['BIO', 'ENG'], courses: 2 });
  // A trend past its cap keeps its first point.
  const long = I.clean({ courses: [{ id: '1', trend: Array.from({ length: 500 }, (_, i) => [i + 1, i]) }] }).courses[0].trend;
  assert.deepEqual([long.length, long[0], long.at(-1)], [I.MAX.points, [1, 0], [500, 499]]);
});

test('writes: a put after a clear, from before it, or older than what is stored is not kept', async () => {
  const key = I.storeKey('https://school.instructure.com', '42');
  assert.equal(key, 'insights:https://school.instructure.com/42');
  const store = {};
  const local = { get: async (k) => ({ [k]: store[k] }), set: async (p) => { Object.assign(store, p); return true; } };
  const rec = (term = '5') => ({ term, courses: [{ id: '1', name: 'BIO', items: [], trend: [] }] });
  assert.deepEqual(await I.change({ key: 'insights:evil/1', op: 'put', at: 1, rec: rec() }, local), { ok: false, error: 'bad' });
  assert.deepEqual(await I.change({ key, op: 'put', at: 100, base: 0, rec: rec() }, local), { ok: true });
  assert.equal(store[key].at, 100);
  assert.deepEqual(await I.change({ key, op: 'put', at: 90, base: 0, rec: { ...rec(), name: 'old' } }, local), { ok: true, kept: false }, 'an older answer for the same term');
  assert.deepEqual(await I.change({ key, op: 'put', at: 95, base: 0, rec: rec('6') }, local), { ok: true, kept: false }, 'nor an older one for another term');
  assert.deepEqual(await I.change({ key, op: 'put', at: 110, base: 0, rec: rec('6') }, local), { ok: true }, 'a newer one for another term replaces it');
  assert.equal(store[key].term, '6');
  assert.deepEqual(await I.change({ key, op: 'clear', at: 200 }, local), { ok: true });
  assert.deepEqual(store[key], { cl: 200 });
  assert.deepEqual(await I.change({ key, op: 'put', at: 300, base: 0, rec: rec() }, local), { ok: false, error: 'cleared' }, 'made on a view read before the clear');
  assert.deepEqual(await I.change({ key, op: 'put', at: 150, base: 200, rec: rec() }, local), { ok: false, error: 'cleared' }, 'asked for before the clear');
  assert.deepEqual(await I.change({ key, op: 'put', at: 300, base: 200, rec: rec() }, local), { ok: true });
  assert.equal(store[key].cl, 200, 'the clear is remembered');
  assert.deepEqual(await I.change({ key, op: 'clear', at: 150 }, local), { ok: true });
  assert.deepEqual(store[key], { cl: 200 }, 'an earlier clear arriving late keeps the later time');
  const failing = { get: local.get, set: async () => false };
  assert.deepEqual(await I.change({ key, op: 'put', at: 400, base: 200, rec: rec() }, failing), { ok: false });
});
