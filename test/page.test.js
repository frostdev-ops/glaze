const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/page.js');

const now = new Date(2026, 9, 11, 15, 0); // Sun 11 Oct 2026, 3 PM

test('due dates in the formats Ultra writes', () => {
  assert.equal(P.due('Due date: 10/11/26, 11:59 PM (EDT)', now), 'today');
  assert.equal(P.due('Due: 10/13/26 9:00 AM', now), 'soon');
  assert.equal(P.due('Due date: 10/18/26, 11:59 PM (EDT)', now), null);
  assert.equal(P.due('Due Date: 10/4/26, 11:59 PM (EDT)', now), 'overdue');
  assert.equal(P.due('Due date: 10/11/2026, 2:59 PM', now), 'overdue');
});

test('12 AM and 12 PM', () => {
  assert.equal(P.due('Due date: 10/12/26, 12:00 AM', now), 'soon');   // midnight starting Monday
  assert.equal(P.due('Due date: 10/11/26, 12:00 PM', now), 'overdue'); // noon today, already past
});

test('the soon window is three days past today', () => {
  assert.equal(P.due('Due date: 10/14/26, 11:59 PM', now), 'soon');
  assert.equal(P.due('Due date: 10/15/26, 12:01 AM', now), null);
});

test('anything else is left alone', () => {
  for (const t of ['Due date: 18.10.26, 23:59', 'Posted 10/11/26', 'Due date: tomorrow', '', 'Due date: 13/45/26, 11:59 PM']) {
    assert.equal(P.due(t, now), null, t);
  }
});

test('score share and band', () => {
  assert.deepEqual(P.score('2', '2'), { ratio: 1, band: 'hi' });
  assert.deepEqual(P.score('7', '10'), { ratio: 0.7, band: 'mid' });
  assert.equal(P.score('0', '100').band, 'lo');
  assert.equal(P.score('12', '10').ratio, 1);
  for (const [g, m] of [['-', '10'], ['5', '0'], ['5', ''], ['A', 'B']]) assert.equal(P.score(g, m), null, `${g}/${m}`);
});

test('hover hints for dates read naturally', () => {
  assert.deepEqual(P.when('Due date: 10/13/26, 11:59 PM (EDT)', now), { title: 'Due in 2 days', sub: 'Tuesday, October 13 at 11:59 PM', rel: 'in 2 days' });
  assert.deepEqual(P.when('Due date: 10/12/26, 9:00 AM', now), { title: 'Due tomorrow', sub: 'Monday, October 12 at 9:00 AM', rel: 'tomorrow' });
  assert.equal(P.when('Due date: 10/11/26, 11:59 PM', now).title, 'Due in 9 hours');
  assert.equal(P.when('Due date: 10/11/26, 3:20 PM', now).title, 'Due in 20 minutes');
  assert.equal(P.when('Due Date: 10/4/26, 11:59 PM', now).title, 'Was due last week');
  assert.deepEqual(P.when('9/17/26', now), { title: '3 weeks ago', sub: 'Thursday, September 17', rel: '3 weeks ago' });
  assert.equal(P.when('10/10/26', now).title, 'Yesterday');
  assert.equal(P.when('1/5/27', now).sub, 'Tuesday, January 5, 2027');
  assert.equal(P.when('Due: 12/25/26', now).title, 'Due in 2 months');
});

test('no hint where there is no real date', () => {
  for (const t of ['', 'Fall 2026', '2 / 2', '2/30/26', '13/1/26', null]) assert.equal(P.when(t, now), null, String(t));
});

test('describe() takes ISO dates from the content API', () => {
  assert.equal(P.describe(new Date('2026-10-19T03:59:00.000Z'), true, now).rel, 'next week');
  assert.equal(P.describe(new Date(2026, 9, 11, 18, 0), true, now).rel, 'in 3 hours');
});

test('the gradebook by content item, and what counts as done', () => {
  const grades = P.gradesByContent([
    { status: 'NEEDS_GRADING', column: { contentId: '_1_1' } },
    { status: 'GRADED', column: {} }, // an external tool's column: no content item
  ]);
  assert.deepEqual([...grades.keys()], ['_1_1']);
  assert.equal(P.gradesByContent(undefined).size, 0);
  assert.ok(P.isDone(null, { status: 'NEEDS_GRADING' }));
  assert.ok(P.isDone(null, { isExempt: true }));
  assert.ok(P.isDone('true', undefined));
  assert.ok(!P.isDone('mixed', {}));
});

test('status chips beside due dates in course content', () => {
  const soon = 'Due date: 10/13/26, 11:59 PM (EDT)'; // in 2 days
  const later = 'Due date: 10/18/26, 11:59 PM (EDT)'; // next week
  const gone = 'Due date: 10/4/26, 11:59 PM (EDT)'; // last week
  const S = (text, circle, grade) => P.status(text, circle, grade, now);
  // Graded, with the mark and a band like the score bars.
  assert.deepEqual(S(gone, null, { status: 'GRADED', displayGrade: { score: 18 }, pointsPossible: 20 }), { label: 'Graded · 18/20', tone: 'graded-hi' });
  assert.deepEqual(S(gone, null, { status: 'GRADED', displayGrade: { score: 2.5 }, pointsPossible: 5 }), { label: 'Graded · 2.5/5', tone: 'graded-lo' });
  assert.deepEqual(S(gone, null, { status: 'GRADED', displayGrade: { text: 'A-' } }), { label: 'Graded · A-', tone: 'done' });
  // Submitted: before the due date it still says when.
  assert.deepEqual(S(soon, null, { status: 'NEEDS_GRADING' }), { label: 'Submitted · due in 2 days', tone: 'done' });
  assert.deepEqual(S(gone, 'true', { status: 'NEEDS_GRADING' }), { label: 'Submitted', tone: 'done' });
  assert.deepEqual(S(gone, 'true', null), { label: 'Done', tone: 'done' });
  assert.deepEqual(S(soon, null, { isExempt: true }), { label: 'Exempt', tone: 'muted' });
  // Not done yet: the countdown, with the circle's word where the course has circles.
  assert.deepEqual(S(soon, 'false', {}), { label: 'in 2 days · Unopened', tone: 'soon' });
  assert.deepEqual(S(later, 'mixed', {}), { label: 'next week · Opened', tone: 'later' });
  assert.deepEqual(S(later, null, {}), { label: 'next week', tone: 'later' });
  // Past due: said only when the status is known.
  assert.deepEqual(S(gone, null, {}), { label: 'Past due · Not submitted', tone: 'overdue' });
  assert.deepEqual(S(gone, 'mixed', undefined), { label: 'Past due · Opened', tone: 'overdue' });
  assert.equal(S(gone, null, undefined), null);
  assert.equal(S(gone, null, null), null);
});

test('the overall grade for course cards', () => {
  const col = { externalGrade: true, visible: true, visibleInBook: true };
  // As Ultra's Grades page shows it: 77.30273 of 93.75 is 82.45%, cut, not rounded to 82.46.
  assert.deepEqual(P.overall([{ column: { contentId: '_1_1' } }, { effectiveScore: 77.30273, pointsPossible: 93.75, column: col }]), { label: '82.45%', tone: 'graded-mid' });
  assert.deepEqual(P.overall([{ effectiveScore: 90, pointsPossible: 100, column: col }]), { label: '90%', tone: 'graded-hi' });
  assert.deepEqual(P.overall([{ effectiveScore: 8.999, pointsPossible: 10, column: col }]), { label: '89.99%', tone: 'graded-mid' });
  assert.deepEqual(P.overall([{ effectiveScore: 61, pointsPossible: 100, displayGrade: { text: 'D-' }, column: col }]), { label: 'D-', tone: 'graded-lo' });
  // Nothing graded yet, hidden from students, or no overall column: no chip.
  assert.equal(P.overall([{ effectiveScore: null, pointsPossible: 0, column: col }]), null);
  assert.equal(P.overall([{ effectiveScore: 50, pointsPossible: 100, column: { ...col, visible: false } }]), null);
  assert.equal(P.overall([{ effectiveScore: 50, pointsPossible: 100, column: { ...col, visibleInBook: false } }]), null);
  assert.equal(P.overall([{ effectiveScore: 50, pointsPossible: 100, column: { contentId: '_1_1' } }]), null);
  assert.equal(P.overall(undefined), null);
});
