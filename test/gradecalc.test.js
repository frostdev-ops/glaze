// Canvas's grade arithmetic (lib/gradecalc.js): table cases worked out from Canvas's rules, and every course on the
// local Canvas, where Glaze's totals must equal the current_score/final_score Canvas reports (fixtures/canvas-grades.json,
// fetched as the student; rebuild it when the seed changes).
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/gradecalc.js');
const live = require('./fixtures/canvas-grades.json');

// The API's shapes: an assignment with the student's submission, a group of them.
let n = 100;
const a = (possible, score, more = {}) => {
  const { sub = {}, ...rest } = more;
  return { id: String(++n), name: `Item ${n}`, points_possible: possible, submission_types: ['online_text_entry'], omit_from_final_grade: false,
    anonymize_students: false, published: true, due_at: null, ...rest,
    submission: { score, excused: false, workflow_state: score == null ? 'unsubmitted' : 'graded', ...sub } };
};
const g = (weight, assignments, rules = {}) => ({ id: String(++n), name: `Group ${n}`, group_weight: weight, rules, assignments });
const run = (groups, info = {}, what, opts) => G.calc(G.fromApi(groups, info), what, opts);
const two = (r) => [G.round2(r.current), G.round2(r.final)];

// Kane & Kane's point: dropping the lowest percentage isn't always best. Dropping 50/100 beats dropping 1/5.
const kane = () => [a(5, 1), a(100, 50), a(10, 9)];
const P1 = { id: 1, start_date: '2026-01-01T00:00:00Z', end_date: '2026-04-01T00:00:00Z', weight: 40 };
const P2 = { id: 2, start_date: '2026-04-01T00:00:00Z', end_date: '2026-07-01T00:00:00Z', weight: 60 };
const periodItems = () => [g(0, [a(10, 8, { due_at: '2026-02-10T12:00:00Z' }), a(10, 9, { due_at: '2026-05-10T12:00:00Z' }), a(10, null, { due_at: '2026-06-10T12:00:00Z' })])];

// [name, groups, info, [current, final] as Canvas rounds them, what-if, options]
const CASES = [
  ['points: earned over possible', [g(0, [a(10, 8), a(20, 15), a(10, null)])], {}, [76.67, 57.5]],
  ['points: nothing graded yet', [g(0, [a(10, null), a(30, null)])], {}, [null, 0]],
  ['weighted: share × weight', [g(50, [a(10, 9)]), g(50, [a(50, 40)])], { weighted: true }, [85, 85]],
  ['weighted: a group without graded work is left out of current', [g(40, [a(20, 18)]), g(60, [a(100, null)])], { weighted: true }, [90, 36]],
  ['weighted: weights over 100 are not scaled down', [g(60, [a(10, 8)]), g(60, [a(10, 5)])], { weighted: true }, [78, 78]],
  ['weighted: weights under 100 are scaled up', [g(30, [a(10, 10)]), g(20, [a(10, 5)])], { weighted: true }, [80, 80]],
  ['weighted: no weight anywhere', [g(0, [a(10, 10)]), g(0, [a(10, 5)])], { weighted: true }, [null, null]],
  ['excused work never counts', [g(0, [a(10, 10), a(50, null, { sub: { excused: true, workflow_state: 'graded' } })])], {}, [100, 100]],
  ['omitted from the final grade', [g(0, [a(10, 5), a(90, 0, { omit_from_final_grade: true })])], {}, [50, 50]],
  ['ungraded by type', [g(0, [a(10, 5), a(90, 0, { submission_types: ['not_graded'] })])], {}, [50, 50]],
  ['unpublished', [g(0, [a(10, 5), a(90, 0, { published: false })])], {}, [50, 50]],
  ['a quiz waiting for review is graded only in final', [g(0, [a(10, 8), a(10, 3, { sub: { workflow_state: 'pending_review' } })])], {}, [80, 55]],
  ['points above possible are extra credit', [g(0, [a(10, 12)])], {}, [120, 120]],
  ['a zero-point assignment adds its points', [g(0, [a(10, 8), a(0, 2)])], {}, [100, 100]],
  ['weighted: a zero-possible group adds nothing', [g(90, [a(100, 80)]), g(10, [a(0, 5)])], { weighted: true }, [80, 80]],
  ['points: a zero-possible group adds its points', [g(0, [a(100, 80)]), g(0, [a(0, 5)])], {}, [85, 85]],
  ['drop lowest keeps the best set, not the best percentages', [g(0, kane(), { drop_lowest: 1 })], {}, [66.67, 66.67]],
  ['drop highest keeps the worst set', [g(0, kane(), { drop_highest: 1 })], {}, [48.57, 48.57]],
  ['never drop', (() => { const k = kane(); return [g(0, k, { drop_lowest: 1, never_drop: [Number(k[1].id)] })]; })(), {}, [53.64, 53.64]],
  ['more drops than work keeps one', [g(0, kane(), { drop_lowest: 5 })], {}, [90, 90]],
  ['drops in current see graded work only; final drops a zero', [g(0, [a(5, 1), a(10, 9), a(100, null)], { drop_lowest: 1 })], {}, [90, 66.67]],
  ['drop lowest and highest together', [g(0, [a(10, 2), a(10, 5), a(10, 7), a(10, 10)], { drop_lowest: 1, drop_highest: 1 })], {}, [60, 60]],
  ['drops among zero-point work go by score', [g(0, [a(10, 10)]), g(0, [a(0, 1), a(0, 3), a(0, 2)], { drop_lowest: 1 })], {}, [150, 150]],
  ['weighted periods', periodItems(), { periods: [P1, P2], weightedPeriods: true }, [86, 59]],
  ['weighted periods: one without graded work leaves current', [g(0, [a(10, 8, { due_at: '2026-02-10T12:00:00Z' }), a(10, null, { due_at: '2026-05-10T12:00:00Z' })])], { periods: [P1, P2], weightedPeriods: true }, [80, 32]],
  ['weighted periods under 100 are scaled up', periodItems(), { periods: [{ ...P1, weight: 30 }, { ...P2, weight: 30 }], weightedPeriods: true }, [85, 62.5]],
  ['unweighted periods: the course counts everything', periodItems(), { periods: [P1, P2] }, [85, 56.67]],
  ['one grading period', periodItems(), { periods: [P1, P2], weightedPeriods: true }, [90, 45], undefined, { period: '2' }],
  ['due when a period ends is in that period', [g(0, [a(10, 8, { due_at: '2026-04-01T00:00:00Z' }), a(10, 2, { due_at: '2026-04-01T00:01:00Z' })])], { periods: [P1, P2] }, [80, 80], undefined, { period: '1' }],
  ['no due date: the last period', [g(0, [a(10, 6), a(10, 2, { due_at: '2026-02-01T00:00:00Z' })])], { periods: [P1, P2] }, [60, 60], undefined, { period: '2' }],
  ['anonymous work not yet posted, where the school leaves it out', [g(0, [a(10, 8), a(10, null, { anonymize_students: true })])], {}, [80, 80], undefined, { anon: true }],
  ['anonymous work not yet posted, where the school counts it', [g(0, [a(10, 8), a(10, null, { anonymize_students: true })])], {}, [80, 40]],
];

test('table: Canvas rules, current and final', () => {
  assert.ok(CASES.length >= 30);
  for (const [name, groups, info, want, what, opts] of CASES) assert.deepEqual(two(run(groups, info, what, opts)), want, name);
});

test('every course on the local Canvas comes out at the totals Canvas reports', () => {
  assert.ok(live.courses.length >= 4);
  for (const { course, groups, periods } of live.courses) {
    const r = run(groups, { weighted: course.apply_assignment_group_weights, periods, weightedPeriods: course.has_weighted_grading_periods });
    assert.deepEqual(two(r), [course.enrollment.computed_current_score, course.enrollment.computed_final_score], course.course_code);
  }
});

test('rounding is Canvas’s, not the float’s', () => {
  assert.equal(G.round2(69.125), 69.13);
  assert.equal(G.round2((51 / 80) * 30 + 8 + 42), 69.13);
  assert.equal(G.round2(0.1 + 0.2), 0.3);
  assert.equal(G.round2(null), null);
  assert.equal(G.round2(NaN), null);
});

test('drops say what they left out', () => {
  const k = kane();
  const r = run([g(0, k, { drop_lowest: 1 })]);
  const [group] = Object.values(r.groups);
  assert.deepEqual(group.current, { score: 10, possible: 15, dropped: [k[1].id] });
  const graded = run([g(0, [a(5, 1), a(10, 9), a(100, null)], { drop_lowest: 1 })]);
  const [both] = Object.values(graded.groups);
  assert.equal(both.current.dropped.length, 1, 'current drops among graded work');
  assert.equal(both.final.dropped.length, 1);
  assert.notDeepEqual(both.current.dropped, both.final.dropped, 'final drops the zero instead');
});

test('what-if: scores for work not graded, overrides of real scores, hidden work, pretend assignments', () => {
  const items = [a(10, 8), a(20, 15), a(10, null), a(10, null, { sub: { excused: true } })];
  const groups = [g(0, items)];
  const course = G.fromApi(groups);
  const gid = course.groups[0].id;
  const at = (what) => two(G.calc(course, what));
  assert.deepEqual(at({ scores: { [items[2].id]: 10 } }), [82.5, 82.5]);
  assert.deepEqual(at({ scores: { [items[0].id]: 10 } }), [83.33, 62.5]);
  assert.deepEqual(at({ scores: { [items[3].id]: 5 } }), [70, 56], 'a what-if score counts excused work');
  assert.deepEqual(at({ hidden: [items[1].id] }), [80, 40]);
  assert.deepEqual(at({ extra: [{ id: 'p1', group: gid, name: 'Quiz', possible: 10, score: 9 }] }), [80, 64]);
  assert.deepEqual(at({ extra: [{ id: 'p1', group: gid, name: 'Quiz', possible: 10, score: 9 }], hidden: ['p1'] }), [76.67, 57.5]);
  assert.deepEqual(at(), [76.67, 57.5], 'nothing changes the course itself');
});

test('what you need: the even share of the rest, through weights and drops', () => {
  const course = G.fromApi([g(0, [a(10, 8), a(10, null), a(10, null)])]);
  const r = G.need(course, {}, 80);
  assert.equal(r.left, 2);
  assert.ok(Math.abs(r.share - 0.8) < 1e-9);
  assert.deepEqual(G.need(course, {}, 95), { left: 2, best: (28 / 30) * 100, reachable: false });
  assert.equal(G.need(course, {}, 20).share, 0);
  // Dropping the lowest of three: two 9s on the rest make 90%, where a plain share would say 9.5 each.
  const dropped = G.fromApi([g(0, [a(10, 8), a(10, null), a(10, null)], { drop_lowest: 1 })]);
  assert.ok(Math.abs(G.need(dropped, {}, 90).share - 0.9) < 1e-9);
  // Work with a what-if score is no longer left.
  const id = course.groups[0].items[1].id;
  assert.equal(G.need(course, { scores: { [id]: 10 } }, 80).left, 1);
  assert.equal(G.need(G.fromApi([g(0, [a(10, 8)])]), {}, 80).left, 0);
});

test('saved what-if scores: kept while the real grade is the one they were saved against', () => {
  const items = [a(10, 8), a(10, null), a(10, null, { sub: { excused: true } })];
  const course = G.fromApi([g(0, items)]);
  const gid = course.groups[0].id;
  const rec = {
    s: { [items[0].id]: [10, 8], [items[1].id]: [7, null], [items[2].id]: [5, 'x'], 999: [1, null], [items[0].id + 'x']: ['no', null] },
    h: [items[1].id, 'gone', 'p1'],
    p: [{ id: 'p1', g: gid, n: 'Quiz', s: 9, pp: 10 }, { id: 'p2', g: 'nowhere', n: 'X', s: 1, pp: 1 }, { id: 'bad id', g: gid, s: 1, pp: 1 }],
    c: 91,
  };
  const r = G.reconcile(rec, course);
  assert.deepEqual(Object.keys(r.kept.s).sort(), [items[0].id, items[1].id, items[2].id].sort());
  assert.deepEqual(r.kept.h, [items[1].id, 'p1']);
  assert.deepEqual(r.kept.p.map((p) => p.id), ['p1']);
  assert.equal(r.kept.c, 91);
  assert.deepEqual(r.gone, []);
  assert.deepEqual(r.what.scores, { [items[0].id]: 10, [items[1].id]: 7, [items[2].id]: 5 });
  // The grade arrives, another changes, the excuse is lifted: each saved score goes, and says so.
  const later = G.fromApi([g(0, [{ ...items[0], submission: { score: 9 } }, { ...items[1], submission: { score: 6 } }, { ...items[2], submission: { score: null } }])]);
  later.groups[0].id = gid;
  const r2 = G.reconcile(r.kept, later);
  assert.deepEqual(r2.kept.s, {});
  assert.deepEqual(r2.gone.map((x) => [x.name, x.was, x.now]), [[items[0].name, 8, 9], [items[1].name, null, 6], [items[2].name, 'x', null]]);
  assert.deepEqual(G.reconcile(undefined, course).kept, { s: {}, h: [], p: [], c: null });
});

test('saved what-if records: one per course, emptied courses removed, the last 100 kept', () => {
  const rec = { s: { 1: [5, null] }, h: [], p: [], c: null };
  let all = G.store(undefined, '10', rec, 1);
  assert.deepEqual(all, { 10: { ...rec, at: 1 } });
  all = G.store(all, '11', rec, 2);
  assert.deepEqual(Object.keys(G.store(all, '10', { s: {}, h: [], p: [], c: null }, 3)), ['11']);
  for (let i = 0; i < 120; i++) all = G.store(all, String(100 + i), rec, 10 + i);
  assert.equal(Object.keys(all).length, 100);
  assert.ok(all['219'] && !all['10']);
});

test('letters: the highest bound reached, from the rounded score', () => {
  assert.equal(G.letter(94), 'A');
  assert.equal(G.letter(93.995), 'A');
  assert.equal(G.letter(93.99), 'A-');
  assert.equal(G.letter(-5), 'F');
  assert.equal(G.letter(null), null);
  const mine = G.parseScheme('A 90, B 80, C 70');
  assert.equal(G.letter(85, mine), 'B');
  assert.equal(G.letter(50, mine), 'C', 'below every bound: the lowest');
  assert.deepEqual(G.schemeOf([['A', 0.94], ['B', 0.8], ['F', 0]]), [['A', 94], ['B', 80], ['F', 0]]);
});

test('scales typed by the student', () => {
  assert.deepEqual(G.parseScheme('A 93, A- 90; B+ 87%\nB=83, Pass: 60.5'), [['A', 93], ['A-', 90], ['B+', 87], ['B', 83], ['Pass', 60.5]]);
  for (const bad of ['', 'A 93, A 90', 'A 120', '93', 'A', 'A ninety', 'Excellent work 12 90']) assert.equal(G.parseScheme(bad), null, bad);
  assert.equal(G.schemeText(G.parseScheme('B 80,A 90')), 'A 90, B 80');
});

test('GPA: points on the 4.0 and plus/minus scales, the weighted bonus, credits', () => {
  assert.equal(G.points('A-', true), 3.7);
  assert.equal(G.points('A-', false), 4);
  assert.equal(G.points('a−', true), 3.7);
  assert.equal(G.points('B+', true, 1), 4.3);
  assert.equal(G.points('A', false, 1), 5);
  assert.equal(G.points('F', true, 1), 0, 'a failing grade gets no bonus');
  assert.equal(G.points('Pass', true), null);
  const r = G.gpa([{ credits: 3, points: 4 }, { credits: 4, points: 3 }, { credits: 3, points: null }, { credits: 0, points: 2 }]);
  assert.ok(Math.abs(r.gpa - 24 / 7) < 1e-12);
  assert.deepEqual([r.credits, r.n], [7, 2]);
  assert.equal(G.gpa([]).gpa, null);
});

test('the GPA’s synced choices: sanitized, defaults left out, under 8 KB', () => {
  const k = 'canvas:https://school.instructure.com/12';
  assert.deepEqual(G.cleanGpa({
    [k]: { c: 4, l: 1, x: 1, s: 'B 80,A 90', extra: 'no' },
    'canvas:http://localhost:3000/5': { c: 3, l: 0.25, x: true, s: 'nonsense' },
    'canvas:http://localhost:3000/6': { c: 0.5 },
    'canvas:javascript:alert(1)/7': { c: 4 },
    _12_1: { c: 4 },
    'canvas:https://school.instructure.com/8': { c: 99 },
  }), { [k]: { c: 4, l: 1, x: 1, s: 'A 90, B 80' }, 'canvas:http://localhost:3000/6': { c: 0.5 } });
  assert.deepEqual(G.cleanGpa(null), {});
  assert.deepEqual(G.cleanGpa([1]), {});
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`canvas:https://a-very-long-school-host-name.instructure.com/${1000 + i}`, { c: 4, l: 1, s: 'A+ 97, A 93, A- 90, B+ 87, B 83, B- 80, C+ 77, C 73' }]));
  const out = G.cleanGpa(many);
  assert.ok(new TextEncoder().encode(`gpaCourses${JSON.stringify(out)}`).length <= 8000);
  assert.ok(Object.keys(out).length > 10);
  assert.deepEqual(G.cleanGpa(out), out, 'clean twice, same');
});

// ---- Codex review of W2 (each fails on c84efec) ----------------------------------------------------------------------
test('halves round away from zero on both sides, as Canvas stores totals', () => {
  assert.equal(G.round2(-69.125), -69.13);
  assert.equal(G.round2(69.125), 69.13);
  assert.equal(G.round2(-0.001), 0);
  assert.deepEqual(two(run([g(0, [a(800, -553)])])), [-69.13, -69.13]);
});

test('a what-if typed against a negative real grade is kept while that grade stands', () => {
  const items = [a(10, -2)];
  const course = G.fromApi([g(0, items)]);
  const r = G.reconcile({ s: { [items[0].id]: [5, -2] }, h: [], p: [] }, course);
  assert.deepEqual(r.kept.s, { [items[0].id]: [5, -2] });
  assert.deepEqual(r.gone, []);
  assert.deepEqual(G.reconcile({ s: { [items[0].id]: [5, 'nonsense'] } }, course).kept.s, {}, 'a malformed baseline still goes');
});

test('a pretend assignment counts in the grading period it was added in', () => {
  const groups = [g(0, [a(100, 50, { due_at: '2026-02-10T12:00:00Z' }), a(100, 90, { due_at: '2026-05-10T12:00:00Z' })])];
  const course = G.fromApi(groups, { periods: [P1, P2] });
  const gid = course.groups[0].id;
  const rec = { s: {}, h: [], p: [{ id: 'p1', g: gid, n: 'Quiz', s: 100, pp: 100, pd: '1' }] };
  const r = G.reconcile(rec, course);
  assert.equal(r.kept.p[0].pd, '1');
  assert.deepEqual(two(G.calc(course, r.what, { period: '1' })), [75, 75]);
  assert.deepEqual(two(G.calc(course, r.what, { period: '2' })), [90, 90]);
  assert.equal(G.reconcile({ ...rec, p: [{ ...rec.p[0], pd: '9' }] }, course).kept.p[0].pd, null, 'a period the course does not have');
  assert.deepEqual(two(G.calc(course, G.reconcile({ ...rec, p: [{ ...rec.p[0], pd: null }] }, course).what, { period: '2' })), [95, 95], 'none named: the last period');
});

test('GPA: one scale turns any percentage into a letter, so a what-if equal to the grade changes nothing', () => {
  const scheme = [['A', 90], ['B', 80], ['F', 0]]; // the course's own: A from 90
  const e = { computed_current_score: 92, computed_current_grade: 'A' };
  const known = G.gpaRow(e, {}, 92, { plus: true }, scheme);
  assert.deepEqual([known.letter, known.pts, known.wiLetter, known.wi.pts], ['A', 4, 'A', 4]);
  const unknown = G.gpaRow(e, {}, 92, { plus: true });
  assert.equal(unknown.needs, true, 'Canvas has a letter but the scheme is not known yet: ask for it');
  assert.equal(unknown.wiLetter, null, 'and no guess on another scale meanwhile');
  const own = G.gpaRow(e, { s: 'A 95, B 85, F 0' }, 92, { plus: true });
  assert.deepEqual([own.letter, own.wiLetter, own.needs], ['B', 'B', false], 'the student’s own scale wins, for both');
  const plain = G.gpaRow({ computed_current_score: 92 }, { l: 1, c: 4 }, 85, { plus: true });
  assert.deepEqual([plain.letter, plain.pts, plain.wpts, plain.wiLetter, plain.credits], ['A-', 3.7, 4.7, 'B', 4]);
});

test('what-if changes from any tab: one made before a Clear all is dropped, however late it arrives', () => {
  const rec = (c) => ({ s: { 175: [90, null] }, h: [], p: [], c });
  let r = G.applyWhatIf({ op: 'course', cid: '25', rec: rec(null), at: 100 }, {}, 0);
  assert.deepEqual(Object.keys(r.all), ['25']);
  assert.equal(r.all['25'].at, 100);
  r = G.applyWhatIf({ op: 'grade', cid: '26', c: 80, at: 150 }, r.all, r.cleared);
  assert.deepEqual(Object.keys(r.all).sort(), ['25', '26']);
  // Clear all at 200 (tab B); then tab A's change made at 120 arrives.
  r = G.applyWhatIf({ op: 'clear', at: 200 }, { ...r.all, 27: { ...rec(null), at: 250 } }, r.cleared);
  assert.deepEqual([Object.keys(r.all), r.cleared], [['27'], 200], 'what was changed after the clear was asked for stays');
  const late = G.applyWhatIf({ op: 'course', cid: '25', rec: rec(null), at: 120 }, r.all, r.cleared);
  assert.deepEqual(Object.keys(late.all), ['27'], 'the late one is dropped');
  const after = G.applyWhatIf({ op: 'course', cid: '25', rec: rec(70), at: 300 }, r.all, r.cleared);
  assert.deepEqual(Object.keys(after.all).sort(), ['25', '27']);
  assert.deepEqual(G.applyWhatIf({ op: 'course', cid: '25', rec: { s: {}, h: [], p: [], c: null }, at: 400 }, { 25: { ...rec(null), at: 1 } }, 0).all, {}, 'an emptied course goes');
});

test('each what-if change writes only the fields it carries', () => {
  // Cleared at 200. The Dashboard then sets a GPA what-if of 95; a Grades tab whose copy is older (course grade
  // null) saves an assignment score.
  let r = G.applyWhatIf({ op: 'grade', cid: '25', c: 95, at: 250 }, {}, 200);
  r = G.applyWhatIf({ op: 'course', cid: '25', rec: { s: { 175: [90, null] }, h: [], p: [], c: null }, at: 300 }, r.all, r.cleared);
  assert.deepEqual([r.all['25'].c, r.all['25'].s], [95, { 175: [90, null, 300] }], 'the course grade stays');
  r = G.applyWhatIf({ op: 'grade', cid: '25', c: null, at: 350 }, r.all, r.cleared);
  assert.deepEqual([r.all['25'].c, r.all['25'].s], [null, { 175: [90, null, 300] }], 'and a course-grade change leaves the scores');
});

test('a clear arriving late takes each part changed before it, even from a record changed after it', () => {
  // A score typed at 100; the course grade set at 300; then a Clear all asked for at 200 arrives.
  let r = G.applyWhatIf({ op: 'course', cid: '25', rec: { s: { 175: [90, null] }, h: [], p: [] }, at: 100 }, {}, 0);
  r = G.applyWhatIf({ op: 'grade', cid: '25', c: 95, at: 300 }, r.all, r.cleared);
  r = G.applyWhatIf({ op: 'clear', at: 200 }, r.all, r.cleared);
  assert.deepEqual([r.all['25'].s, r.all['25'].c, r.cleared], [{}, 95, 200], 'the score goes, the course grade stays');
  // The same with work left out and a pretend assignment, and a resend that doesn't change a part keeps its time.
  r = G.applyWhatIf({ op: 'course', cid: '26', rec: { s: { 1: [5, null] }, h: ['2'], p: [{ id: 'p1', g: '9', n: 'Quiz', s: 9, pp: 10, pd: null }] }, at: 400 }, {}, 0);
  r = G.applyWhatIf({ op: 'course', cid: '26', rec: { s: { 1: [5, null], 3: [7, null] }, h: ['2'], p: [{ id: 'p1', g: '9', n: 'Quiz', s: 9, pp: 10, pd: null }] }, at: 600 }, r.all, r.cleared);
  r = G.applyWhatIf({ op: 'clear', at: 500 }, r.all, r.cleared);
  assert.deepEqual([r.all['26'].s, r.all['26'].h, r.all['26'].p], [{ 3: [7, null, 600] }, [], []]);
});

test('a clear recorded but not finished completes with the next change', () => {
  const stored = { 25: { s: { 1: [5, null] }, h: [], p: [], c: null, at: 100 }, 26: { s: {}, h: [], p: [], c: 80, at: 300 } };
  assert.deepEqual(Object.keys(G.applyWhatIf({ op: 'grade', cid: '27', c: 70, at: 400 }, stored, 200).all).sort(), ['26', '27']);
  assert.deepEqual(Object.keys(G.applyWhatIf({ op: 'grade', cid: '27', c: 70, at: 400 }, stored, 0).all).sort(), ['25', '26', '27'], 'never cleared: all stay');
});

test('what a tab sends is cleaned before it is stored', () => {
  const r = G.cleanRecord({
    s: { 175: [90, null], 176: [-1, null], 177: [5, 'x'], '<b>': [1, null], 178: [5, 'nonsense'] },
    h: ['175', 7, 'x'.repeat(40)],
    p: [{ id: 'p1', g: '67', n: 'Q'.repeat(300), s: 9, pp: 10, pd: '1' }, { id: 'bad', g: '67', s: 1, pp: 1 }, { id: 'p2', g: '67', s: -1, pp: 1 }],
    c: 2000, extra: 'gone',
  });
  assert.deepEqual(r.s, { 175: [90, null], 177: [5, 'x'] });
  assert.deepEqual(r.h, ['175']);
  assert.deepEqual(r.p.map((x) => [x.id, x.n.length, x.pd]), [['p1', 100, '1']]);
  assert.equal(r.c, null);
  assert.deepEqual(G.cleanRecord('junk'), { s: {}, h: [], p: [], c: null });
});

test('the Dashboard sets a course’s what-if grade without touching the rest of its record', () => {
  const all = { 10: { s: { 1: [5, null] }, h: ['2'], p: [], c: null, at: 1 } };
  const set = G.withCourseGrade(all, '10', 91);
  assert.deepEqual([set['10'].s, set['10'].h, set['10'].c], [{ 1: [5, null, 1] }, ['2'], 91], 'parts stored without a time take their record’s');
  assert.deepEqual(G.withCourseGrade({ 11: { s: {}, h: [], p: [], c: 80 } }, '11', null), {}, 'cleared: nothing left, the course goes');
  assert.equal(G.withCourseGrade({ 12: 'junk' }, '12', 70)['12'].c, 70);
});

test('drops match Canvas where sets tie or work is worth no points', () => {
  // A zero-point entry scored 0 is kept over 8/9, as Canvas does (the group is then worth no points).
  assert.deepEqual(G.drop([{ id: '1', possible: 0, score: 0 }, { id: '2', possible: 9, score: 8 }], { lo: 1, hi: 0, never: [] }).map((s) => s.id), ['1']);
  // 12/14 and 15/17 both make 100% with a never-dropped 3/1: Canvas keeps 15/17.
  const tie = [{ id: '1', possible: 14, score: 12 }, { id: '2', possible: 1, score: 3 }, { id: '3', possible: 17, score: 15 }];
  assert.deepEqual(G.drop(tie, { lo: 2, hi: 0, never: ['2'] }).map((s) => s.id).sort(), ['2', '3']);
});
