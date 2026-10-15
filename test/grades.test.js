const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/grades.js');

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
  const m = R.model(spanish());
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

test('exempt items leave the calculation; equal weighting averages the items', () => {
  const f = weights([['c_1', 50, { mode: 'equal' }], ['c_2', 50]]);
  const rows = [g('_1_1', 10, 10), g('_1_1', 100, 50), g('_2_1', 100, 80), g('_2_1', 100, 0, { isExempt: true }), overall(f, 77.5)];
  const m = R.model(rows);
  assert.equal(m.kind, 'weighted');
  assert.equal(m.percent(), 77.5); // (75% + 80%) / 2
});

test("what Glaze can't read, it says so instead of guessing", () => {
  const drop = weights([['c_1', 100, { drop_lowest: 1 }]]);
  assert.equal(R.model([g('_1_1', 10, 5), overall(drop, 50)]).kind, 'unsupported');
  assert.equal(R.model([g('_1_1', 10, 5), overall({ isTotalCalculation: true, formula: '<math><mi>@X@BBCalColElem(tot:{"elements":[]})@X@</mi></math>' }, 5)]).kind, 'unsupported');
  assert.match(R.model([g('_1_1', 10, 5), overall({ formula: 'garbage' }, 5)]).note, /can't work out/);
  // Parsed, but doesn't come out at Blackboard's number.
  assert.equal(R.model([g('_1_1', 10, 5), overall(weights([['c_1', 100]]), 70)]).kind, 'unsupported');
});

test('no overall grade in Blackboard: a plain share of points, said to be just that', () => {
  const m = R.model([g('_1_1', 10, 8), g('_2_1', 30, 15), g('_2_1', 60, null)]);
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
});

test('late: the latest attempt after the due date, for work waiting to be graded', () => {
  const waiting = g('_1_1', 10, null, { lastAttemptId: '_5_1' });
  waiting.column.dueDate = '2026-10-05T03:59:00.000Z';
  assert.deepEqual(R.awaiting([waiting, g('_1_1', 10, 5, { lastAttemptId: '_6_1' })]), [waiting]);
  assert.ok(R.late('2026-10-05T04:10:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late('2026-10-05T03:58:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late(null, waiting.column.dueDate));
});

test('what-if scores: kept while their item waits for a grade, for the last 20 courses', () => {
  const m = R.model(spanish());
  const [open, other] = m.remaining(new Map());
  const graded = m.items.find((i) => i.score != null);
  const kept = R.keptScores(new Map([[open.id, 40], [graded.id, 10], ['_gone_1', 5], [other.id, 'x']]), m.items);
  assert.deepEqual([...kept], [[open.id, 40]], 'graded, gone and malformed scores go');
  let all = R.storeScores(undefined, '_1_1', kept);
  assert.deepEqual(all, { _1_1: { [open.id]: 40 } });
  for (let i = 2; i <= 21; i++) all = R.storeScores(all, `_${i}_1`, kept);
  assert.equal(Object.keys(all).length, 20);
  assert.ok(!all._1_1, 'the course touched longest ago goes first');
  all = R.storeScores(all, '_5_1', new Map());
  assert.ok(!('_5_1' in all), 'cleared: nothing stored for the course');
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
