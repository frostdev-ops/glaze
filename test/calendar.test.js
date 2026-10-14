const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../defaults.js');

// Ultra's calendar items, as /learn/api/v1/calendars/calendarItems gives them.
const item = (calendarId, title) => ({ calendarId, title, endDate: '2026-10-16T03:59:00.000Z' });

test('a calendar entry is the course of its slot whose item title it shows, and only one', () => {
  const courses = { _9_1: { slot: '3' }, _10_1: { slot: '3' }, _11_1: { slot: '4' } };
  const items = [item('_9_1', 'Essay 2'), item('_10_1', 'Lab report'), item('_11_1', 'Quiz'), item('_10_1', 'Quiz'), item('PERSONAL', 'Lab report')];
  assert.equal(D.GZ_CAL_COURSE('Due: Lab report', '3', items, courses), '_10_1');
  assert.equal(D.GZ_CAL_COURSE('Essay 2', '3', items, courses), '_9_1');
  // _11_1's Quiz is in another slot, so this one is _10_1's; a title in two courses of a slot says nothing.
  assert.equal(D.GZ_CAL_COURSE('Quiz', '3', items, courses), '_10_1');
  assert.equal(D.GZ_CAL_COURSE('Quiz', '3', [...items, item('_9_1', 'Quiz')], courses), null);
  // A course not listed yet may be in any slot.
  assert.equal(D.GZ_CAL_COURSE('Essay 2', '3', [...items, item('_12_1', 'Essay 2')], courses), null);
  assert.equal(D.GZ_CAL_COURSE('Office hours', '3', items, courses), null);
});

// Ultra's To Do list, as /learn/api/v1/calendars/todo/studentItems gives it.
const todo = (title, dueDate, courseId = '_9_1', contentId = null) => ({ title, dueDate, column: { courseId, contentId }, isLateAttemptCreationDisallowed: false, contentVisibility: 'VISIBLE' });

test('due this week: today and later from the To Do list, to seven days on, soonest first', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const list = D.GZ_DUE_WEEK({
    overdueItems: [todo('Late', '2026-10-13T03:59:00Z')],
    dueTodayItems: [todo('Gone', '2026-10-14T11:00:00Z'), todo('Tonight', '2026-10-15T03:59:00Z', '_10_1', '_3766429_1')],
    futureDueItems: [todo('Later', '2026-10-20T03:59:00Z'), todo('Next week', '2026-10-22T03:59:00Z'), todo('VHL Credit Category', '2026-10-16T03:59:00Z', null), null],
  }, now);
  assert.deepEqual(list.map((d) => [d.title, d.cid, d.content]), [['Tonight', '_10_1', '_3766429_1'], ['Later', '_9_1', null]]);
  assert.equal(list[0].due, Date.parse('2026-10-15T03:59:00Z'));
  assert.deepEqual(D.GZ_DUE_WEEK(undefined, now), []);
});
