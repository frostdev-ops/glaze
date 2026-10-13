const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/grades.js');

// A gradebook record as Ultra returns it with expand=column.
let n = 0;
const g = (cat, possible, score, extra = {}) => ({
  columnId: `_${++n}_1`, status: score == null ? 'NEEDS_GRADING' : 'GRADED', isExempt: false, hasBeenViewedByStudent: true,
  displayGrade: score == null ? null : { score }, column: { calculationType: 'NON_CALCULATED', gradebookCategoryId: cat, possible, scorable: true, columnName: `Item ${n}` }, ...extra,
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

test('late: the latest attempt after the due date, for work waiting to be graded', () => {
  const waiting = g('_1_1', 10, null, { lastAttemptId: '_5_1' });
  waiting.column.dueDate = '2026-10-05T03:59:00.000Z';
  assert.deepEqual(R.awaiting([waiting, g('_1_1', 10, 5, { lastAttemptId: '_6_1' })]), [waiting]);
  assert.ok(R.late('2026-10-05T04:10:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late('2026-10-05T03:58:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late(null, waiting.column.dueDate));
});
