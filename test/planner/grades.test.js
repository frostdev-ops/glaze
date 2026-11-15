const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../extension/planner/grades.js');
const C = require('../../extension/planner/gradecalc.js'); // the what-if calculator, loaded on demand

// A gradebook record as Ultra returns it with expand=column.
let n = 0;
const g = (cat, possible, score, extra = {}) => ({
  columnId: `_${++n}_1`, status: score == null ? 'NEEDS_GRADING' : 'GRADED', isExempt: false, hasBeenViewedByStudent: true,
  displayGrade: score == null ? null : { score }, column: { calculationType: 'NON_CALCULATED', gradebookCategoryId: cat, possible, scorable: true, columnName: `Item ${n}` }, ...extra,
});
const weights = (cats, extra = {}) => ({
  isTotalCalculation: false,
  formula: `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>@X@BBCalColElem(wgt:${JSON.stringify({ weights: cats.map(([alias, weight, more]) => ({ element: { type: 'cat', alias, mode: 'proportional', ...more }, weight })), running: true, ...extra })})@X@</mi></math>`,
  aliases: Object.fromEntries(cats.map(([alias]) => [alias, `_${alias.slice(2)}_1`])),
});
const overall = (formula, score) => ({ columnId: '_99_1', displayGrade: score == null ? null : { score }, column: { calculationType: 'CUSTOM', externalGrade: true, scorable: false, calculatedFormula: formula } });

// A real course's shape (Spanish 1100, Oct 2026): six weighted categories, one still empty; Blackboard said 82.45625.
const spanish = () => {
  const f = weights([['c_1', 15], ['c_2', 10], ['c_3', 10], ['c_4', 20], ['c_5', 25], ['c_6', 20], ['c_7', 0, { exclude_list: [{ exclude_alias: 'c_7' }] }]]);
  return [
    ...[95, 90, 90, 95].map((s) => g('_1_1', 100, s)), // 370/400
    g('_2_1', 50, 44), g('_2_1', 50, null),
    g('_3_1', 100, 0),
    g('_4_1', 100, 94.7),
    g('_5_1', 100, 97.4),
    g('_6_1', 100, null), g('_6_1', 100, null),
    g('_7_1', 10, 10),
    overall(f, 82.45625),
  ];
};

test('weighted overall: reproduces Blackboard, then answers what-ifs', () => {
  const m = C.model(spanish());
  assert.equal(m.kind, 'weighted');
  assert.ok(Math.abs(m.percent() - 82.45625) < 1e-9);
  // The two tests (20%) at full marks: the empty category joins.
  const tests = m.items.filter((i) => i.cat === '_6_1').map((i) => [i.id, 100]);
  assert.ok(Math.abs(m.percent(new Map(tests)) - 85.965) < 1e-9);
  const need = m.need(85);
  assert.equal(need.left, 3);
  assert.ok(need.share > 0.8 && need.share < 1);
  assert.ok(Math.abs(m.percent(new Map(m.remaining(new Map()).map((i) => [i.id, need.share * i.possible]))) - 85) < 1e-6);
  assert.equal(m.need(99).reachable, false);
  assert.equal(m.need(50).share, 0, 'already there with zeros on the rest');
});

test("Ultra's own categories, titled with its language key, read as their names; a teacher's own stays as titled", () => {
  const cat = (title, own = false) => ({ gradebookCategory: { title, isUserDefined: own } });
  const rows = spanish();
  for (const [i, c] of [[0, cat('DISCUSSION.NAME')], [4, cat('SELF_AND_PEER.NAME')], [7, cat('Exam.name', true)], [8, cat('Final project', true)]]) Object.assign(rows[i].column, c);
  // The empty category has no item to name it: its title from Ultra's list of categories (planner/page/grades.js names).
  const m = C.model(rows, { _6_1: 'QUIZ.NAME' });
  assert.equal(m.kind, 'weighted');
  assert.deepEqual(m.course.groups.map((x) => [x.name, x.sys]),
    [['Discussion', true], ['Self and peer', false], ['', false], ['Exam.name', false], ['Final project', false], ['Quiz', true]]);
  assert.ok(Object.values(C.ULTRA_CATS).includes('Assignment'));
});

test('exempt items leave the calculation; equal weighting averages the items', () => {
  const f = weights([['c_1', 50, { mode: 'equal' }], ['c_2', 50]]);
  const rows = [g('_1_1', 10, 10), g('_1_1', 100, 50), g('_2_1', 100, 80), g('_2_1', 100, 0, { isExempt: true }), overall(f, 77.5)];
  const m = C.model(rows);
  assert.equal(m.kind, 'weighted');
  assert.equal(m.percent(), 77.5); // (75% + 80%) / 2
});

test("what Glaze can't read, it says so instead of guessing", () => {
  const drop = weights([['c_1', 100, { drop_lowest: 1 }]]);
  assert.equal(C.model([g('_1_1', 10, 5), overall(drop, 50)]).kind, 'unsupported');
  assert.equal(C.model([g('_1_1', 10, 5), overall({ isTotalCalculation: true, formula: '<math><mi>@X@BBCalColElem(tot:{"elements":[]})@X@</mi></math>' }, 5)]).kind, 'unsupported');
  assert.match(C.model([g('_1_1', 10, 5), overall({ formula: 'garbage' }, 5)]).note, /can't work out/);
  // Parsed, but doesn't come out at Blackboard's number.
  assert.equal(C.model([g('_1_1', 10, 5), overall(weights([['c_1', 100]]), 70)]).kind, 'unsupported');
});

test("an overall grade that is not a number has nothing to check the recipe against: unsupported, not trusted as weighted", () => {
  const rows = (shown) => { const o = overall(weights([['c_1', 100]]), 80); o.displayGrade = shown; return [g('_1_1', 10, 8), o]; };
  // Not graded yet, hidden, a letter or other text, a figure that isn't one.
  for (const shown of [null, {}, { text: 'B+' }, { score: null, text: 'Pass' }, { score: 'B+' }, { score: '' }, { score: NaN }]) {
    const m = C.model(rows(shown));
    assert.deepEqual([m.kind, m.overall], ['unsupported', null], JSON.stringify(shown));
    assert.equal(m.why, 'Blackboard shows no overall number to check it against', JSON.stringify(shown));
  }
  // A number, even as text, is still the check: this recipe makes 80%.
  assert.equal(C.model(rows({ score: 80 })).kind, 'weighted');
  assert.equal(C.model(rows({ score: '80' })).kind, 'weighted');
  assert.equal(C.model(rows({ score: 70 })).kind, 'unsupported', 'and a wrong one still fails');
});

test('no overall grade in Blackboard: a plain share of points, said to be just that', () => {
  const m = C.model([g('_1_1', 10, 8), g('_2_1', 30, 15), g('_2_1', 60, null)]);
  assert.equal(m.kind, 'points');
  assert.ok(Math.abs(m.percent() - 57.5) < 1e-9); // 23 of 40 graded points
  assert.match(m.note, /no overall grade/);
});

test('new grades: what changed since the gradebook was last shown, or what Ultra says is unviewed', () => {
  const a = g('_1_1', 10, 8);
  const b = g('_1_1', 10, 9, { hasBeenViewedByStudent: false });
  const c = g('_1_1', 10, null);
  const first = R.fresh([a, b, c], undefined);
  assert.deepEqual([...first.ids], [b.columnId]);
  assert.deepEqual(Object.keys(first.seen), [a.columnId, b.columnId], 'only graded items are remembered');
  assert.equal(R.fresh([a, b, c], first.seen).ids.size, 0);
  const regraded = { ...a, displayGrade: { score: 10 } };
  assert.deepEqual([...R.fresh([regraded, b], first.seen).ids], [a.columnId]);
});

test('new content: items not seen before, counted into the folders above them', () => {
  // The shape of contents?recursive=true: a folder holding an Ultra document (a page whose one block is a child).
  const items = [
    { id: 'f', parentId: 'root' }, { id: 'p', parentId: 'f', contentHandler: { isBbPage: true } }, { id: 'blk', parentId: 'p' },
    { id: 'sub', parentId: 'f' }, { id: 'x', parentId: 'sub' }, { id: 'top', parentId: 'root' },
  ];
  const first = R.newItems(items, undefined);
  assert.equal(first.ids.size, 0, 'the first visit marks everything seen');
  assert.deepEqual(first.seen, ['f', 'p', 'sub', 'x', 'top'], "a page's blocks are part of the page");
  const more = [...items, { id: 'y', parentId: 'sub' }, { id: 'p2', parentId: 'f', contentHandler: { isBbPage: true } }, { id: 'blk2', parentId: 'p2' }];
  const next = R.newItems(more, first.seen, new Set(['f', 'top']));
  assert.deepEqual([...next.ids], ['y', 'p2']);
  assert.deepEqual([...next.inside], [['sub', 1], ['f', 2]]);
  assert.equal(next.seen, first.seen, 'unchanged until a new item is on the page');
  const opened = R.newItems(more, first.seen, new Set(['f', 'sub', 'y']));
  assert.deepEqual(opened.seen, [...first.seen, 'y']);
  assert.deepEqual(R.newItems(null, first.seen).seen, first.seen, 'a failed request changes nothing');
  assert.equal(R.newItems(null, undefined).seen, undefined, 'and never records an empty course');
  // Folders in each other (a parentId cycle) end the count, not the page.
  const loop = R.newItems([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'z', parentId: 'a' }], ['a', 'b']);
  assert.deepEqual([[...loop.ids], [...loop.inside.keys()]], [['z'], ['a', 'b']]);
});

test('late: the latest attempt after the due date, for work waiting to be graded', () => {
  const waiting = g('_1_1', 10, null, { lastAttemptId: '_5_1' });
  waiting.column.dueDate = '2026-10-05T03:59:00.000Z';
  assert.deepEqual(R.awaiting([waiting, g('_1_1', 10, 5, { lastAttemptId: '_6_1' })]), [waiting]);
  assert.ok(R.late('2026-10-05T04:10:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late('2026-10-05T03:58:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late(null, waiting.column.dueDate));
});

test("the old Ultra what-if's saved scores move into the what-if store, and go once graded", () => {
  const m = C.model(spanish());
  const [open] = m.remaining(new Map());
  const graded = m.items.find((i) => i.score != null);
  // Glaze 2.2 kept { course: { column: score } } in whatIf, for work not graded yet.
  const old = { _1_1: { [open.id]: 40, [graded.id]: 10, bad: 'x', '../x': 5 }, _2_1: { [open.id]: 7 } };
  const s = C.oldScores(old, '_1_1');
  assert.deepEqual(s, { [open.id]: [40, null], [graded.id]: [10, null] }, 'saved against no grade; malformed ones dropped');
  assert.deepEqual(C.oldScores(undefined, '_1_1'), {});
  assert.deepEqual(C.oldScores({ _1_1: 'x' }, '_1_1'), {});
  // reconcile keeps the one still waiting for a grade; the graded one goes, and says so.
  const r = C.reconcile({ s, h: [], p: [] }, m.course);
  assert.deepEqual(r.kept.s, { [open.id]: [40, null] });
  assert.deepEqual(r.gone.map((x) => x.id), [graded.id]);
  assert.ok(Math.abs(m.percent(new Map(Object.entries(r.what.scores))) - C.calc(m.course, r.what).current) < 1e-12);
  // Kept as the worker keeps Canvas's (background/background.js 'glaze:whatif'), by Ultra's ids.
  const all = C.applyWhatIf({ op: 'course', cid: '_1_1', at: 5, rec: { ...r.kept, p: [{ id: 'pa1', g: '_6_1', n: 'Final', s: 90, pp: 100 }] } }, {}, 0).all;
  assert.deepEqual(Object.keys(all), ['_1_1']);
  assert.deepEqual(all._1_1.s[open.id].slice(0, 2), [40, null]);
  assert.equal(all._1_1.p[0].g, '_6_1');
});

test('the old store moves in one step: never over a part already there, never past a Clear all, and only what was seen leaves', () => {
  const legacy = { _1_1: { _3_1: 100, _4_1: 50, _5_1: 7 }, _2_1: { _9_1: 1 } };
  const stored = { _1_1: { s: { _4_1: [60, null, 9] }, h: ['_6_1'], ht: { _6_1: 9 }, p: [], at: 9 } };
  // Seen: _3_1 and _4_1 as read, and _5_1 with a value that has changed since (left alone). Waiting: _3_1, _4_1.
  const m = { cid: '_1_1', at: 5, seen: { _3_1: 100, _4_1: 50, _5_1: 8 }, keep: ['_3_1', '_4_1'] };
  const r = C.moveLegacy(m, stored, legacy, 0);
  assert.deepEqual(r.moved, ['_3_1'], "_4_1 already has a score: that one stays");
  assert.deepEqual(r.all._1_1.s, { _4_1: [60, null, 9], _3_1: [100, null, 1] });
  assert.deepEqual([r.all._1_1.h, r.all._1_1.ht], [['_6_1'], { _6_1: 9 }]);
  assert.deepEqual(r.legacy, { _2_1: { _9_1: 1 }, _1_1: { _5_1: 7 } }, 'only the entries seen, with the values seen');
  // Cleared since: nothing comes in, and what was seen still leaves the old store.
  const c = C.moveLegacy(m, stored, legacy, 3);
  assert.deepEqual(c.moved, []);
  assert.equal(c.all._1_1.s._3_1, undefined);
  assert.deepEqual(c.legacy, r.legacy);
  // The last entry gone: nothing is left of the old store.
  assert.equal(C.moveLegacy({ cid: '_2_1', seen: { _9_1: 1 }, keep: [] }, {}, { _2_1: { _9_1: 1 } }, 0).legacy, null);
  // A part moved in is older than any later clear.
  assert.deepEqual(Object.keys(C.applyWhatIf({ op: 'clear', at: 2 }, r.all, 0).all._1_1.s), ['_4_1']);
});

test('the same calculator: what-ifs, left-out work and pretend items on an Ultra course, by its own recipe', () => {
  const m = C.model(spanish());
  const base = C.calc(m.course, {});
  assert.ok(Math.abs(base.current - 82.45625) < 1e-9, "current is Blackboard's running total");
  // A pretend test at full marks in the empty tests category is the same as one real test at full marks there.
  const pretend = C.calc(m.course, { extra: [{ id: 'pa1', group: '_6_1', name: 'Test', possible: 100, score: 100 }] }).current;
  const real = m.percent(new Map([[m.items.find((i) => i.cat === '_6_1').id, 100]]));
  assert.ok(Math.abs(pretend - real) < 1e-9);
  // Leaving out the one zero in category 3 takes that category out of the running total: 65.965 of 70 weight.
  const zero = m.items.find((i) => i.cat === '_3_1').id;
  assert.ok(Math.abs(C.calc(m.course, { hidden: [zero] }).current - (65.965 / 70) * 100) < 1e-9);
  // Not a running total: work not graded yet counts as zero, and that is the overall grade.
  const f = weights([['c_1', 50], ['c_2', 50]], { running: false });
  const z = C.model([g('_1_1', 10, 10), g('_1_1', 10, null), g('_2_1', 10, 5), overall(f, 50)]);
  assert.equal(z.kind, 'weighted');
  assert.equal(z.zeros, true);
  assert.equal(z.percent(), 50); // (10/20 + 5/10) / 2
  assert.equal(z.percent(new Map([[z.remaining(new Map())[0].id, 10]])), 75);
  // Weights over 100 are scaled as Blackboard scales them.
  const over = C.model([g('_1_1', 10, 8), g('_2_1', 10, 6), overall(weights([['c_1', 60], ['c_2', 60]]), 70)]);
  assert.equal(over.kind, 'weighted');
  assert.ok(Math.abs(over.percent() - 70) < 1e-9);
});

test('Canvas new items: only available module content, with stable string ids', () => {
  const modules = [
    { items: [{ id: 1, type: 'Page' }, { id: 2, type: 'SubHeader' }, { id: 3, type: 'File', published: false }] },
    { state: 'locked', items: [{ id: 4, type: 'Page' }] },
    { published: false, items: [{ id: 5, type: 'Assignment' }] },
  ];
  const items = R.canvasItems(modules);
  assert.deepEqual(items, [{ id: '1' }]);
  const first = R.newItems(items);
  assert.deepEqual(first.seen, ['1']);
  assert.equal(first.ids.size, 0);
  modules[1].state = 'unlocked';
  const next = R.newItems(R.canvasItems(modules), first.seen);
  assert.deepEqual([...next.ids], ['4'], 'newly accessible content counts as new');
  assert.equal(R.canvasItems([...modules, { items_count: 200 }]), null, 'oversized modules cannot seed a false empty baseline');
  assert.equal(R.canvasItems(null), null, 'failure preserves the visit baseline');
});


test('Canvas news: stale tabs patch only their field and visit ids only grow', () => {
  const latest = { seen: ['271', '280'], items: { at: 200, value: [{ id: '280' }] }, grades: { at: 100, value: 2 } };
  const grades = { at: 300, value: 1 };
  const refreshed = R.canvasNewsRecord(latest, { grades });
  assert.deepEqual(refreshed, { ...latest, grades }, 'grade refresh preserves the newer visit and item cache');
  assert.deepEqual(R.canvasNewsRecord(refreshed, { seen: ['271', '318'] }), {
    ...refreshed, seen: ['271', '280', '318'],
  }, "an older visit snapshot adds ids without forgetting another tab's ids");
});


test('review: category localizableTitle keys work with an already readable title', () => {
  const rows = spanish();
  rows[0].column.gradebookCategory = { title: 'Discussion', isUserDefined: false, localizableTitle: { languageKey: 'gradebook.category.discussion' } };
  rows[4].column.gradebookCategory = { title: 'My discussion', isUserDefined: true, localizableTitle: { languageKey: 'gradebook.category.discussion' } };
  const groups = C.model(rows).course.groups;
  assert.deepEqual([groups[0].name, groups[0].sys], ['Discussion', true]);
  assert.deepEqual([groups[1].name, groups[1].sys], ['My discussion', false]);
});

// Spanish 1110's shape (Nov 2026): no overall column for the student, but the teacher's own "Overall Grade" (a CUSTOM
// column marked isTotalCalculation, not externalGrade) weights two categories and three single items, one of them a
// calculated average column. Blackboard shows it as 75 (C): (0 x 15 + 100 x 45) / 60 with the rest not graded yet.
const recipe = (parts, extra = {}) => ({
  isTotalCalculation: true,
  formula: `<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>@X@BBCalColElem(wgt:${JSON.stringify({ weights: parts.map(([type, alias, weight, more]) => ({ element: { type, alias, mode: 'proportional', ...more }, weight })), running: true, ...extra })})@X@</mi></math>`,
  aliases: Object.fromEntries(parts.map(([, alias]) => [alias, `_${alias.slice(2)}_1`])),
});
const calcCol = (id, name, possible, score, formula, extra = {}) => ({ columnId: `_${id}_1`, displayGrade: score == null ? null : { isOverride: false, score, ...extra.shown }, column: { calculationType: 'CUSTOM', scorable: true, possible, effectiveColumnName: name, columnName: name, calculatedFormula: formula, ...extra.column } });
const spanish1110 = (shown = 75, teacher = {}) => {
  const avg = { formula: '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>@X@BBCalColElem(avg:{"running":true,"selected":{"average":true,"elements":[{"type":"item","alias":"i_525"}]}})@X@</mi></math>X_Running_Total=true', aliases: { i_525: '_525_1' } };
  return [
    g('_771_1', 100, 100), g('_771_1', 0, 10), // the teacher's extra credit, weighted 0
    g('_499_1', 100, 0), // Discussion 15%
    g('_496_1', 50, null), // Assignment 10%
    { ...g('_498_1', 100, null), columnId: '_526_1' }, { ...g('_498_1', 100, null), columnId: '_527_1' }, // Test, left out as a category
    calcCol(528, 'VHL Homework Current Grade', 100, 100, avg),
    calcCol(508, 'Overall Grade', 96.66666, shown, recipe([['cat', 'c_771', 0], ['cat', 'c_499', 15], ['cat', 'c_496', 10], ['item', 'i_527', 10], ['item', 'i_526', 20],
      ['cat', 'c_498', 0, { exclude_list: [{ exclude_alias: 'c_498' }] }], ['item', 'i_528', 45]]), { shown: { grade: 'C' }, ...teacher }),
  ];
};

test("single weighted items and the teacher's own overall column: Blackboard's 75%, by its recipe", () => {
  const m = C.model(spanish1110());
  assert.equal(m.kind, 'weighted');
  assert.equal(m.column, 'Overall Grade');
  assert.equal(m.overall, 75);
  assert.ok(Math.abs(m.percent() - 75) < 1e-9);
  // Each single item is a group of its own, at its weight; the average column is an item with the score it shows.
  const one = m.course.groups.find((x) => x.id === 'i_528_1');
  assert.deepEqual([one.name, one.weight, one.single, one.items.map((i) => [i.id, i.score, i.possible])], ['VHL Homework Current Grade', 45, true, [['_528_1', 100, 100]]]);
  assert.deepEqual(m.course.groups.map((x) => x.id), ['_499_1', '_496_1', 'i_527_1', 'i_526_1', 'i_528_1']);
  // The lesson tests (20%) at full marks join the running total: (0 x 15 + 100 x 20 + 100 x 45) / 80.
  assert.ok(Math.abs(m.percent(new Map([['_526_1', 100]])) - 81.25) < 1e-9);
  assert.equal(new Set(m.items.map((i) => i.id)).size, m.items.length, 'each item once');
  assert.ok(m.items.some((i) => i.id === '_528_1'), 'the average column takes a what-if like any item');
  assert.equal(m.need(90).left, 3);
});

test("a teacher's overall column that doesn't come out at its own figure isn't trusted, and says so", () => {
  const m = C.model(spanish1110(80));
  assert.equal(m.kind, 'unsupported');
  assert.equal(m.why, "its recipe doesn't come out at Blackboard's own figure");
  assert.deepEqual([m.overall, m.column], [80, 'Overall Grade']);
  // An average column, or a weighted one that is neither marked nor named as the overall grade, is no course grade.
  const plain = spanish1110(75, { column: { effectiveColumnName: 'Lab average', columnName: 'Lab average' } });
  plain[plain.length - 1].column.calculatedFormula.isTotalCalculation = false;
  assert.equal(C.model(plain).kind, 'points');
  const named = spanish1110(75, { column: { effectiveColumnName: 'Course Grade', columnName: 'Course Grade' } });
  named[named.length - 1].column.calculatedFormula.isTotalCalculation = false;
  assert.deepEqual([C.model(named).kind, C.model(named).column], ['weighted', 'Course Grade']);
  // Two that both qualify equally: no guess.
  const two = spanish1110();
  two.push({ ...two[two.length - 1], columnId: '_509_1' });
  assert.equal(C.model(two).kind, 'points');
});

test("an item whose name Ultra keeps only as punctuation reads by its column's own name", () => {
  const row = g('_1_1', 50, 48);
  Object.assign(row.column, { effectiveColumnName: '.', columnName: 'Module 6: Assignment 1' });
  const blank = g('_1_1', 50, 40);
  Object.assign(blank.column, { effectiveColumnName: ' ', columnName: '' });
  assert.deepEqual(C.model([row, blank]).items.map((i) => i.name), ['Module 6: Assignment 1', 'Untitled']);
});

test('a category total is not selected as the course grade merely because its name contains total or overall', () => {
  const rows = [g('_1_1', 100, 100), g('_2_1', 100, 0)];
  const formula = weights([['c_1', 100]]); // a correct recipe for the homework alone, not the whole course
  for (const name of ['Homework Total', 'Quiz subtotal', 'Overall Homework Grade', 'Total Quizzes']) {
    const m = C.model([...rows, calcCol(508, name, 100, 100, formula)]);
    assert.equal(m.kind, 'points', name);
    assert.equal(m.percent(), 50, `${name} must not turn a 50% points estimate into a trusted 100% course grade`);
    assert.equal(m.column, undefined);
  }
  for (const name of ['Overall Grade', 'Overall', 'Total', 'Total Grade', 'Course Total', 'Course Grade', 'Final Grade', 'Overall Course Grade']) {
    assert.equal(C.model([...rows, calcCol(508, name, 100, 100, formula)]).kind, 'weighted', name);
  }
});

// The scales an Ultra course grades its items on (gradebook/schemas, public v1, measured 2026-11-14): every item's
// displayGrade.score is points; CompleteIncomplete and Tabular add the grade written ("Complete", "C"); a Tabular symbol's
// absoluteValue is the percent that letter stands for; missing work past due is scored zero automatically.
const SCHEMAS = [{ id: '_1_9', scaleType: 'Score' }, { id: '_2_9', scaleType: 'Percent' }, { id: '_3_9', scaleType: 'CompleteIncomplete', symbols: [] },
  { id: '_4_9', scaleType: 'Tabular', symbols: [{ text: 'A', absoluteValue: 96.5 }, { text: 'B', absoluteValue: 85 }] }, { id: '_5_9', scaleType: 'Text' }];
const on = (row, schema, shown = {}) => { row.column.gradingSchemaId = schema; row.displayGrade = row.displayGrade && { ...row.displayGrade, ...shown }; return row; };

test("Ultra's item scales from the course's schemas: points, percent, complete/incomplete, letters with what each stands for", () => {
  const rows = [on(g('_1_1', 10, 8), '_1_9'), on(g('_1_1', 100, 50), '_2_9'), on(g('_1_1', 10, 10), '_3_9', { grade: 'Complete' }),
    on(g('_1_1', 50, 42.5), '_4_9', { grade: 'B' }), on(g('_1_1', 10, 0), '_1_9', { scoredByAutomaticZero: true }), on(g('_1_1', 10, 7), '_5_9')];
  const m = C.model(rows, {}, SCHEMAS);
  assert.deepEqual(m.items.map((i) => [i.scale, i.missing, i.shown]), [['points', false, ''], ['percent', false, ''], ['complete', false, 'Complete'],
    ['letter', false, 'B'], ['points', true, ''], ['points', false, '']]);
  assert.deepEqual(m.items[3].letters, [['A', 96.5], ['B', 85]]);
  // Ultra's own answer for a schema (private v1) names its letters symbol and absoluteTranslation.
  const own = [{ id: '_4_9', scaleType: 'TABULAR', symbols: [{ symbol: 'A', absoluteTranslation: 96.5 }] }];
  assert.deepEqual(C.model([on(g('_1_1', 50, 42.5), '_4_9', { grade: 'B' })], {}, own).items[0].letters, [['A', 96.5]]);
  // No schemas: every item in points, the grade written still read.
  assert.deepEqual(C.model(rows).items.map((i) => i.scale), ['points', 'points', 'points', 'points', 'points', 'points']);
  assert.equal(C.model(rows).items[3].shown, 'B');
});

test("a points total Glaze can't read is exact where the plain share of points comes out at Blackboard's figure", () => {
  const tot = (score, possible) => { const o = overall({ isTotalCalculation: true, formula: '<math><mi>@X@BBCalColElem(tot:{"running":true})@X@</mi></math>', aliases: {} }, score); o.column.possible = possible; return o; };
  const work = () => [g('_1_1', 10, 8), g('_2_1', 30, 15), g('_2_1', 60, null)];
  // Shown as a percent: 23 of 40 graded points.
  const pct = C.model([...work(), tot(57.5, 100)]);
  assert.deepEqual([pct.kind, pct.points, pct.zeros, pct.overall], ['weighted', true, false, 57.5]);
  assert.ok(Math.abs(pct.percent() - 57.5) < 1e-9);
  assert.deepEqual(pct.course.groups.map((x) => x.id), ['_1_1', '_2_1']);
  // Shown as points of the column's own total: 23 of 40.
  assert.equal(C.model([...work(), tot(23, 40)]).kind, 'weighted');
  // Counting work not graded yet as zero: 23 of 100.
  const zeros = C.model([...work(), tot(23, 100)]);
  assert.deepEqual([zeros.kind, zeros.zeros], ['weighted', true]);
  // Neither: still unsupported, and why.
  const off = C.model([...work(), tot(60, 100)]);
  assert.deepEqual([off.kind, off.why], ['unsupported', "its overall grade is a points total Glaze can't read yet"]);
  // A weighting Glaze reads that doesn't come out is never swapped for a share of points that happens to, nor one with
  // rules it can't read (dropped scores) that comes out at the same figure today.
  const w = C.model([g('_1_1', 10, 8), g('_2_1', 30, 15), overall(weights([['c_1', 50], ['c_2', 50]]), 57.5)]);
  assert.deepEqual([w.kind, w.why], ['unsupported', "its recipe doesn't come out at Blackboard's own figure"]);
  assert.equal(C.model([g('_1_1', 10, 5), overall(weights([['c_1', 100, { drop_lowest: 1 }]]), 50)]).kind, 'unsupported');
});

test('a trusted points overall is reported as a percent, including a teacher total', () => {
  for (const external of [true, false]) {
    const total = overall({ isTotalCalculation: true, formula: '@X@BBCalColElem(tot:{"running":true})@X@' }, 23);
    Object.assign(total.column, { externalGrade: external, columnName: 'Overall Grade', possible: 40 });
    const m = C.model([g('_1_1', 10, 8), g('_2_1', 30, 15), total]);
    assert.equal(m.kind, 'weighted');
    assert.equal(m.overall, 57.5, 'overall is consumed as a percentage by the calculator and GPA');
    assert.equal(m.percent(), m.overall);
  }
});
