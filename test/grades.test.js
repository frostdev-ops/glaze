const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/grades.js');

// A gradebook record as Ultra returns it with expand=column.
let n = 0;
const g = (cat, possible, score, extra = {}) => ({
  columnId: `_${++n}_1`, status: score == null ? 'NEEDS_GRADING' : 'GRADED', isExempt: false, hasBeenViewedByStudent: true,
  displayGrade: score == null ? null : { score }, column: { calculationType: 'NON_CALCULATED', gradebookCategoryId: cat, possible, scorable: true, columnName: `Item ${n}` }, ...extra,
});

test('late: the latest attempt after the due date, for work waiting to be graded', () => {
  const waiting = g('_1_1', 10, null, { lastAttemptId: '_5_1' });
  waiting.column.dueDate = '2026-10-05T03:59:00.000Z';
  assert.deepEqual(R.awaiting([waiting, g('_1_1', 10, 5, { lastAttemptId: '_6_1' })]), [waiting]);
  assert.ok(R.late('2026-10-05T04:10:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late('2026-10-05T03:58:00.000Z', waiting.column.dueDate));
  assert.ok(!R.late(null, waiting.column.dueDate));
});
