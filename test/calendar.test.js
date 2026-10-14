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

// Canvas's planner, as /api/v1/planner/items gives it.
const flags = (o = {}) => ({ submitted: false, excused: false, graded: false, late: false, missing: false, needs_grading: false, redo_request: false, ...o });
const plan = (plannable_type, title, plannable_date, o = {}) => ({ plannable_type, course_id: 9, context_name: 'Introduction to Biology', html_url: `/courses/9/${plannable_type}s/1`, plannable_date, plannable: { title }, planner_override: null, submissions: flags(), ...o });

test('Canvas due this week: course work still to do, in the next seven days, soonest first', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const list = D.GZ_CANVAS_DUE_WEEK([
    plan('assignment', 'Lab report', '2026-10-20T03:59:00Z'),
    plan('quiz', 'Quiz', '2026-10-15T03:59:00Z', { course_id: '10', context_name: 'College Writing', html_url: 'http://school.example/courses/10/quizzes/4#submit' }),
    plan('discussion_topic', 'Post a reply', '2026-10-16T03:59:00Z', { submissions: false }),
    plan('wiki_page', 'Read the syllabus page', '2026-10-17T03:59:00Z', { submissions: false, html_url: null }),
    plan('assignment', 'Earlier today', '2026-10-14T11:00:00Z'),
    plan('assignment', 'Next week', '2026-10-22T03:59:00Z'),
    plan('assignment', 'Dateless', undefined),
  ], now);
  assert.deepEqual(list.map((d) => [d.title, d.cid, d.course, d.url]), [
    ['Quiz', '10', 'College Writing', '/courses/10/quizzes/4#submit'], // a full address is cut to its path
    ['Post a reply', '9', 'Introduction to Biology', '/courses/9/discussion_topics/1'],
    ['Read the syllabus page', '9', 'Introduction to Biology', '/courses/9'], // no address of its own: its course
    ['Lab report', '9', 'Introduction to Biology', '/courses/9/assignments/1'],
  ]);
  assert.equal(list[0].due, Date.parse('2026-10-15T03:59:00Z'));
  assert.deepEqual(D.GZ_CANVAS_DUE_WEEK(undefined, now), []);
  assert.deepEqual(D.GZ_CANVAS_DUE_WEEK({ errors: [] }, now), []);
});

test('Canvas due this week: events, announcements and personal notes are not work, and done work is left out', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const at = '2026-10-16T03:59:00Z';
  const left = (...os) => D.GZ_CANVAS_DUE_WEEK(os.map((o, i) => plan('assignment', `Item ${i}`, at, o)), now).map((d) => d.title);
  assert.deepEqual(D.GZ_CANVAS_DUE_WEEK([plan('calendar_event', 'Lab section', at, { submissions: false }), plan('announcement', 'News', at, { submissions: false }),
    { ...plan('planner_note', 'Buy goggles', at, { submissions: false }), course_id: null, context_name: undefined, html_url: undefined }, { ...plan('assignment', 'Group work', at), course_id: undefined }], now), []);
  assert.deepEqual(left({}, { submissions: flags({ submitted: true }) }, { planner_override: { marked_complete: true } }, { submissions: flags({ excused: true }) }, { submissions: flags({ graded: true }) }), ['Item 0']);
  // Marked incomplete again, or sent back for a redo: a handed-in assignment is work to do once more.
  assert.deepEqual(left({ submissions: flags({ submitted: true }), planner_override: { marked_complete: false } }, { submissions: flags({ submitted: true, redo_request: true }) }, { planner_override: { marked_complete: false } }), ['Item 0', 'Item 1', 'Item 2']);
});

test('Canvas due this week: done as Canvas reckons it, the planner mark first, then peer reviews, then the submission', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const at = '2026-10-16T03:59:00Z';
  const left = (...os) => D.GZ_CANVAS_DUE_WEEK(os.map((o, i) => plan('assignment', `Item ${i}`, at, o)), now).map((d) => d.title);
  // An explicit mark wins either way: incomplete keeps graded or excused work, complete drops work not handed in.
  assert.deepEqual(left({ submissions: flags({ graded: true }), planner_override: { marked_complete: false } }, { submissions: flags({ excused: true }), planner_override: { marked_complete: false } },
    { planner_override: { marked_complete: true } }, { submissions: flags({ redo_request: true }), planner_override: { marked_complete: true } }), ['Item 0', 'Item 1']);
  // Sent back to redo: still due, graded or not.
  assert.deepEqual(left({ submissions: flags({ graded: true, redo_request: true }) }, { submissions: flags({ submitted: true, graded: true, redo_request: true }) }, { submissions: flags({ graded: true }) }), ['Item 0', 'Item 1']);
  // A peer review has nothing to hand in (submissions: false); Canvas marks the review itself completed.
  const review = (workflow_state, o = {}) => plan('assessment_request', `Review ${workflow_state}`, at, { submissions: false, plannable: { title: `Review ${workflow_state}`, workflow_state }, ...o });
  assert.deepEqual(D.GZ_CANVAS_DUE_WEEK([review('assigned'), review('completed'), review('completed', { plannable: { title: 'Review again', workflow_state: 'completed' }, planner_override: { marked_complete: false } })], now).map((d) => d.title),
    ['Review assigned', 'Review again']);
});
