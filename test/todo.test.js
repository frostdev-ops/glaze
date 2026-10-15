// Better To Do: days in the Canvas time zone, the window, grouping, status, labels and the student's own data.
// The browser here is in Tokyo while the student's Canvas is in New York: nothing may lean on the machine's zone.
process.env.TZ = 'Asia/Tokyo';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/todo.js');
const D = require('../defaults.js');

const NY = 'America/New_York';
const at = (iso) => Date.parse(iso);
const day = (k) => T.keyDay(k);
const O = { span: 'week', n: 7, unit: 'days', start: 'rolling', past: 'week', urgent: true, done: 'auto', group: true };
const NOW = at('2026-10-15T16:00:00Z'); // Thursday, noon in New York, 1 a.m. Friday in Tokyo

test('a day is the calendar date in the Canvas zone, across midnight and DST', () => {
  assert.equal(T.dayKey(T.dayOf(at('2026-10-16T03:59:00Z'), NY)), '2026-10-15'); // 11:59 PM
  assert.equal(T.dayKey(T.dayOf(at('2026-10-16T04:00:00Z'), NY)), '2026-10-16'); // midnight
  assert.equal(T.dayKey(T.dayOf(at('2026-10-16T03:59:00Z'), 'Asia/Tokyo')), '2026-10-16');
  // Fall back (Nov 1) and spring forward (Mar 8): the day starts at the zone's own midnight.
  assert.equal(new Date(T.midnight(day('2026-11-01'), NY)).toISOString(), '2026-11-01T04:00:00.000Z');
  assert.equal(new Date(T.midnight(day('2026-11-02'), NY)).toISOString(), '2026-11-02T05:00:00.000Z');
  assert.equal(new Date(T.midnight(day('2026-03-08'), NY)).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(new Date(T.midnight(day('2026-03-09'), NY)).toISOString(), '2026-03-09T04:00:00.000Z');
  // 11:59 PM on the 25-hour day is still that day.
  assert.equal(T.dayKey(T.dayOf(at('2026-11-02T04:59:00Z'), NY)), '2026-11-01');
  // What the student types is read in the Canvas zone too, DST included.
  assert.equal(new Date(T.typed('2026-03-08', '03:00', NY)).toISOString(), '2026-03-08T07:00:00.000Z');
  assert.equal(new Date(T.typed('2026-11-01', '23:59', NY)).toISOString(), '2026-11-02T04:59:00.000Z');
  assert.equal(T.typed('2026-11-01', '', NY), null);
  assert.deepEqual(T.inputs(at('2026-11-02T04:59:00Z'), NY), { date: '2026-11-01', time: '23:59' });
  assert.equal(T.zone('America/New_York'), NY);
  assert.equal(T.zone('Mountain Time (US & Canada)'), undefined);
  assert.equal(T.zone(''), undefined);
});

test('the window: timeframe, week start and how far back', () => {
  const today = day('2026-10-15'); // a Thursday
  assert.deepEqual(T.span(O, today), { past: today - 7, to: today + 7, weekEnd: today + 7 });
  assert.equal(T.span({ ...O, start: 'monday' }, today).to, day('2026-10-19'));
  assert.equal(T.span({ ...O, start: 'sunday' }, today).to, day('2026-10-18'));
  assert.equal(T.span({ ...O, start: 'saturday' }, today).to, day('2026-10-17'));
  // On the week's first day, the week is the whole week.
  assert.equal(T.span({ ...O, start: 'monday' }, day('2026-10-19')).to, day('2026-10-26'));
  // Custom, free: days run from today; weeks follow the week start.
  assert.deepEqual(T.span({ ...O, span: 'custom', n: 3, unit: 'days' }, today), { past: today - 7, to: today + 3, weekEnd: today + 3 });
  assert.equal(T.span({ ...O, span: 'custom', n: 2, unit: 'weeks', start: 'monday' }, today).to, day('2026-10-26'));
  assert.equal(T.span({ ...O, span: 'custom', n: 2, unit: 'weeks' }, today).to, today + 14);
  for (const [past, n] of [['never', 0], ['3days', 3], ['month', 30], ['always', 180]]) assert.equal(T.span({ ...O, past }, today).past, today - n);
  // What's asked of Canvas: a week back at least, seven days ahead at least, a day of slack.
  const r = T.fetchRange({ ...O, span: 'custom', n: 1, past: 'never' }, NOW, NY);
  assert.equal(r.start, '2026-10-07T04:00:00.000Z');
  assert.ok(Date.parse(r.end) >= NOW + 8 * 864e5);
  assert.equal(T.fetchRange({ ...O, span: 'custom', n: 4, unit: 'weeks' }, NOW, NY).end, '2026-11-13T05:00:00.000Z');
});

// Canvas planner items as the API sends them.
const item = (type, id, date, extra = {}) => ({ plannable_type: type, plannable_id: id, course_id: 'course' in extra ? extra.course : 25, context_name: 'Biology', plannable_date: date,
  html_url: `https://school.instructure.com/courses/25/assignments/${id}`, plannable: { title: `${type} ${id}`, ...extra.plannable },
  submissions: extra.sub === undefined ? { submitted: false, excused: false, graded: false, late: false, missing: false, redo_request: false } : extra.sub,
  planner_override: extra.ov || null });
const sub = (s) => ({ submitted: false, excused: false, graded: false, late: false, missing: false, redo_request: false, ...s });
const ITEMS = [
  item('assignment', 1, '2026-10-14T03:59:00Z', { sub: sub({ missing: true }) }), // due Tue 11:59 PM: past due
  item('assignment', 2, '2026-10-01T03:59:00Z'), // two weeks ago: outside a week's past-due window
  item('assignment', 3, '2026-10-15T14:00:00Z'), // this morning: past due already
  item('quiz', 4, '2026-10-16T03:59:00Z', { plannable: { assignment_id: 40 } }), // tonight 11:59 PM
  item('assignment', 5, '2026-10-16T04:00:00Z'), // midnight: tomorrow
  item('assignment', 6, '2026-10-17T03:59:00Z'), // tomorrow night
  item('discussion_topic', 7, '2026-10-20T03:59:00Z', { sub: false }), // Monday
  item('assignment', 8, '2026-10-26T03:59:00Z'), // beyond the week
  item('assignment', 9, '2026-10-13T03:59:00Z', { sub: sub({ submitted: true, late: true }) }),
  item('assignment', 10, '2026-10-12T03:59:00Z', { sub: sub({ graded: true, submitted: true }) }),
  item('assignment', 11, '2026-10-12T03:59:00Z', { sub: sub({ excused: true, graded: true }) }),
  item('assignment', 12, '2026-10-18T03:59:00Z', { ov: { id: 900, marked_complete: true, dismissed: false } }),
  item('assignment', 13, '2026-10-18T03:59:00Z', { ov: { id: 901, marked_complete: false, dismissed: true } }),
  item('assignment', 14, '2026-10-18T03:59:00Z', { sub: sub({ submitted: true }), ov: { id: 902, marked_complete: false, dismissed: false } }),
  item('announcement', 15, '2026-10-14T13:00:00Z', { sub: false, plannable: { read_state: 'unread' } }),
  item('announcement', 16, '2026-10-13T13:00:00Z', { sub: false, plannable: { read_state: 'read' } }),
  item('announcement', 17, '2026-10-16T13:00:00Z', { sub: false, plannable: { read_state: 'unread' } }), // not posted yet
  item('calendar_event', 18, '2026-10-16T14:00:00Z', { sub: false }),
  item('assignment', 19, '2026-10-16T03:59:00Z', { course: 26 }),
  item('planner_note', 20, '2026-10-16T16:00:00Z', { course: null, sub: false, plannable: { details: 'Bring goggles' } }),
  item('assessment_request', 21, '2026-10-16T03:59:00Z', { sub: false, plannable: { workflow_state: 'completed' } }),
].map(T.slim);
const keys = (rows) => rows.map((r) => r.key);
const groups = (out) => Object.fromEntries(out.groups.map(([g, rows]) => [g, keys(rows)]));

test('Canvas items, grouped by day in the Canvas zone, with done, graded and announcements apart', () => {
  const out = T.build({ items: ITEMS, o: O, now: NOW, tz: NY, cids: new Set(['25']) });
  assert.deepEqual(groups(out), {
    past: ['assignment:1', 'assignment:3'],
    today: ['quiz:4'],
    tomorrow: ['assignment:5', 'planner_note:20', 'assignment:6'],
    week: ['assignment:14', 'discussion_topic:7'],
  });
  assert.deepEqual(keys(out.done), ['assignment:12', 'assessment_request:21', 'assignment:9']);
  assert.deepEqual(keys(out.graded), ['assignment:10', 'assignment:11']);
  assert.deepEqual(keys(out.unread), ['announcement:15']);
  assert.deepEqual(keys(out.read), ['announcement:16']);
  assert.deepEqual(out.count, { done: 5, all: 13 });
  const row = (k) => [...out.groups.flatMap(([, l]) => l), ...out.done, ...out.graded].find((r) => r.key === k);
  assert.equal(row('assignment:1').status, 'Missing');
  assert.equal(row('assignment:9').status, 'Submitted late');
  assert.equal(row('assignment:11').status, 'Excused');
  assert.equal(row('assignment:12').status, 'Done');
  // A mark that says "not done" wins over a submission (Canvas's planner does the same).
  assert.equal(row('assignment:14').done, false);
  assert.equal(row('assignment:14').status, 'Submitted');
  assert.equal(row('quiz:4').aid, '40');
  assert.equal(row('quiz:4').url, '/courses/25/assignments/4');
  assert.equal(row('assignment:1').urgent, true);
  assert.equal(row('quiz:4').urgent, true);
  assert.equal(row('assignment:6').urgent, false);
});

test('a course page shows that course only; the Dashboard skips hidden and past courses but keeps notes', () => {
  const course = T.build({ items: ITEMS, o: O, now: NOW, tz: NY, course: '26' });
  assert.deepEqual(groups(course), { today: ['assignment:19'] });
  const dash = T.build({ items: ITEMS, o: O, now: NOW, tz: NY, cids: new Set(['26']) });
  assert.deepEqual(groups(dash), { today: ['assignment:19'], tomorrow: ['planner_note:20'] });
  const any = T.build({ items: ITEMS, o: O, now: NOW, tz: NY });
  assert.ok(keys(any.groups.flat(2).filter((r) => r.key)).includes('planner_note:20'));
});

test("a card's tasks: that course's open items with a date, soonest first, up to n; done ones crossed out only if asked", () => {
  const b = T.build({ items: ITEMS, o: O, now: NOW, tz: NY, course: '25' });
  assert.deepEqual(keys(T.card(b, 4, false)), ['assignment:1', 'assignment:3', 'quiz:4', 'assignment:5']);
  // Crossed out: done and not yet past (12 and 21), in date order with the rest; done last week (9, 10, 11) stays off.
  assert.deepEqual(keys(T.card(b, 10, true)), ['assignment:1', 'assignment:3', 'assessment_request:21', 'quiz:4', 'assignment:5', 'assignment:6', 'assignment:12', 'assignment:14', 'discussion_topic:7']);
  assert.equal(T.card(b, 10, true).find((r) => r.key === 'assignment:12').done, true);
  // Another course's, a note with no course, and a task with no date are not on this card.
  const own = T.build({ items: ITEMS, data: { tasks: [{ id: 'a', title: 'Read', cid: '25' }, { id: 'b', title: 'Lab', cid: '25', due: { day: '2026-10-15' } }] }, o: O, now: NOW, tz: NY, course: '25' });
  assert.deepEqual(keys(T.card(own, 4, false)), ['assignment:1', 'assignment:3', 'quiz:4', 'task:b']);
  assert.deepEqual(T.card(T.build({ items: ITEMS, o: O, now: NOW, tz: NY, course: '99' }), 4, true), []);
  // Undated work planned for a day ("do on") or a focus session counts from the start of that day, as on the list.
  const planned = T.build({ items: ITEMS, o: O, now: NOW, tz: NY, course: '25', data: {
    tasks: [{ id: 'p', title: 'Plan', cid: '25' }, { id: 's', title: 'Focus', cid: '25' }],
    items: { 'task:p': { on: '2026-10-16' }, 'task:s': { sessions: [{ at: at('2026-10-15T20:00:00Z'), min: 30 }] } },
  } });
  assert.deepEqual(keys(T.card(planned, 6, false, NY)), ['assignment:1', 'task:s', 'assignment:3', 'quiz:4', 'assignment:5', 'task:p']);
});

test('the planner answer is kept in the worker only if the one stored is not newer; the due list goes with it', async () => {
  const key = 'todo:https://school.instructure.com/3';
  const store = {};
  const local = { get: async (k) => Object.fromEntries(k.filter((x) => x in store).map((x) => [x, store[x]])), set: async (v) => (Object.assign(store, v), true) };
  const put = (at, due) => T.change({ key, cache: { key, at, items: [] }, due }, { local });
  assert.deepEqual(await put(200, [{ title: 'x' }]), { ok: true, kept: true });
  assert.deepEqual([store.dueWeekAt, store.dueWeekFrom], [200, 'https://school.instructure.com']);
  const older = await put(100, []);
  assert.equal(older.kept, false);
  assert.equal(older.cache.at, 200);
  assert.equal(store.todoCache.at, 200);
  assert.equal((await put(200)).kept, true); // the same answer again (grading counts, a mark)
  assert.equal((await T.change({ key, cache: { key: 'todo:https://school.instructure.com/4', at: 300, items: [] } }, { local })).ok, false); // another account's
});

test('settings: past-due window, timeframe, week start, manual completion, grouping off', () => {
  const g = (o) => groups(T.build({ items: ITEMS, o: { ...O, ...o }, now: NOW, tz: NY, cids: new Set(['25']) }));
  assert.equal(g({ past: 'never' }).past, undefined);
  assert.deepEqual(g({ past: 'always' }).past, ['assignment:2', 'assignment:1', 'assignment:3']);
  assert.deepEqual(g({ start: 'monday' }).week, ['assignment:14']); // Monday's discussion is next week, past the timeframe
  assert.deepEqual(g({ span: 'custom', n: 3, unit: 'weeks' }).later, ['assignment:8']);
  assert.deepEqual(g({ span: 'custom', n: 2, unit: 'weeks', start: 'monday' }).later, ['discussion_topic:7', 'assignment:8']);
  assert.deepEqual(g({ span: 'custom', n: 2, unit: 'days' }), { past: ['assignment:1', 'assignment:3'], today: ['quiz:4'], tomorrow: ['assignment:5', 'planner_note:20', 'assignment:6'] });
  // Manual: only marks count. Excused and graded still say so.
  const manual = T.build({ items: ITEMS, o: { ...O, done: 'manual' }, now: NOW, tz: NY, cids: new Set(['25']) });
  assert.deepEqual(keys(manual.done), ['assignment:12']);
  assert.deepEqual(keys(manual.graded), []);
  assert.ok(keys(manual.groups.find(([k]) => k === 'past')[1]).includes('assignment:9'));
  // Grouping off: one list by date.
  assert.deepEqual(g({ group: false }), { all: ['assignment:1', 'assignment:3', 'quiz:4', 'assignment:5', 'planner_note:20', 'assignment:6', 'assignment:14', 'discussion_topic:7'] });
  // Urgent highlight off.
  const calm = T.build({ items: ITEMS, o: { ...O, urgent: false }, now: NOW, tz: NY, cids: new Set(['25']) });
  assert.ok(calm.groups.flatMap(([, l]) => l).every((r) => !r.urgent));
});

test("the student's own: custom tasks, do-on dates, timed sessions, local marks", () => {
  const data = {
    tasks: [
      { id: 'a', title: 'Read chapter 4', cid: '25', due: { day: '2026-10-16' }, notes: 'pp. 80-95', done: 0, at: 1 },
      { id: 'b', title: 'Call the library', cid: '', due: null, notes: '', done: 0, at: 1 },
      { id: 'c', title: 'Old errand', cid: '', due: { day: '2026-10-10' }, notes: '', done: NOW - 3600e3, at: 1 },
      { id: 'd', title: 'Overdue errand', cid: '', due: { at: at('2026-10-15T15:00:00Z') }, notes: '', done: 0, at: 1 },
    ],
    items: {
      'assignment:8': { on: '2026-10-16' }, // due beyond the week, planned for tomorrow
      'assignment:6': { sessions: [{ at: at('2026-10-15T20:00:00Z'), min: 50 }] }, // a session this afternoon
      'assignment:5': { done: true }, // ticked in Glaze, not in Canvas
      'task:a': { subs: [{ id: 's1', title: 'Skim', done: true }] },
      'task:zzz': { on: '2026-10-16' }, // a task that's gone
    },
  };
  const out = T.build({ items: ITEMS, data, o: O, now: NOW, tz: NY, cids: new Set(['25']), names: { 25: 'Biology' } });
  assert.deepEqual(groups(out), {
    past: ['assignment:1', 'assignment:3', 'task:d'],
    today: ['quiz:4', 'assignment:6'],
    tomorrow: ['planner_note:20', 'assignment:6', 'task:a', 'assignment:8'], // 6: due tomorrow, a session today
    week: ['assignment:14', 'discussion_topic:7'],
    none: ['task:b'],
  });
  assert.ok(keys(out.done).includes('assignment:5'));
  assert.ok(keys(out.done).includes('task:c'));
  const a = out.groups.flatMap(([, l]) => l).find((r) => r.key === 'task:a');
  assert.equal(a.course, 'Biology');
  assert.equal(a.allDay, true);
  assert.deepEqual(a.local.subs, [{ id: 's1', title: 'Skim', done: true }]);
  // Marks go to Canvas instead: Glaze's own is set aside, Canvas's counts.
  const synced = T.build({ items: ITEMS, data, o: O, now: NOW, tz: NY, cids: new Set(['25']), sync: true });
  assert.ok(!keys(synced.done).includes('assignment:5'));
  // A task on a course page shows there only.
  const course = T.build({ items: [], data, o: O, now: NOW, tz: NY, course: '25' });
  assert.deepEqual(groups(course), { tomorrow: ['task:a'] });
});

test('teachers: work to grade, per course, and graded out of handed in', () => {
  const grading = [
    { type: 'grading', needs_grading_count: 4, course_id: 26, context_name: 'Writing', html_url: 'http://localhost:3000/courses/26/gradebook/speed_grader?assignment_id=178', assignment: { id: 178, name: 'Peer review', due_at: '2026-10-06T03:59:00Z' } },
    { type: 'grading', needs_grading_count: 0, course_id: 26, assignment: { id: 179, name: 'Done already' } },
    { type: 'grading', needs_grading_count: 1, course_id: 25, assignment: { id: 171, name: 'Lab report 2' } },
  ].map(T.slimGrading);
  const out = T.build({ items: [], grading, o: O, now: NOW, tz: NY, course: '26' });
  assert.deepEqual(out.grading.map((g) => [g.key, g.n, g.url]), [['grade:178', 4, '/courses/26/gradebook/speed_grader?assignment_id=178']]);
  assert.deepEqual(T.graded(T.build({ items: [], grading, o: O, now: NOW, tz: NY }).grading, { 178: { graded: 1, ungraded: 4 }, 171: { graded: 3, ungraded: 1 } }), { graded: 4, all: 9 });
  assert.deepEqual(T.graded(out.grading, {}), { graded: 0, all: 0 });
});

test('dates read in the student language, relative or absolute, in the Canvas zone', () => {
  const l = (x, lang = 'en') => T.label(x, NOW, NY, lang);
  assert.equal(l({ at: at('2026-10-16T03:59:00Z') }).rel, 'in 12 hours');
  assert.equal(l({ at: at('2026-10-15T16:30:00Z') }).rel, 'in 30 minutes');
  assert.equal(l({ at: at('2026-10-17T03:59:00Z') }).rel, 'tomorrow');
  assert.equal(l({ at: at('2026-10-14T03:59:00Z') }).rel, '2 days ago');
  assert.equal(l({ at: at('2026-10-17T03:59:00Z') }, 'de').rel, 'morgen');
  assert.equal(l({ at: at('2026-10-16T03:59:00Z') }).abs, 'Thu 11:59 PM');
  assert.equal(l({ at: at('2026-10-30T03:59:00Z') }).abs, 'Thu, Oct 29, 11:59 PM');
  assert.deepEqual(l({ allDay: true, day: day('2026-10-16') }), { rel: 'tomorrow', abs: 'Fri' });
  assert.equal(l({ allDay: true, day: day('2026-10-16') }, 'fr').rel, 'demain');
});

test("what's stored and imported is cleaned", () => {
  const raw = {
    tasks: [
      { id: 'ok', title: '  Essay   plan ', cid: 25, due: { day: '2026-10-20' }, notes: 'x'.repeat(3000), done: 5, at: 9 },
      { id: 'no title', title: '' },
      { id: '<script>', title: 'bad id' },
      { id: 'when', title: 'Bad due', due: { day: 'tomorrow' } },
      'junk',
    ],
    items: {
      'assignment:1': { on: '2026-10-16', done: 'yes', sessions: [{ at: 2e12, min: 30 }, { at: 1e12, min: 3 }, { at: 'x', min: 30 }], subs: [{ id: 'a', title: 'A' }, { id: 'b', title: ' ' }] },
      'task:ok': { done: true },
      'task:gone': { done: true },
      'assignment:2': { on: 'someday' },
      'javascript:alert(1)': { on: '2026-10-16' },
    },
  };
  assert.deepEqual(T.clean(raw), {
    tasks: [
      { id: 'ok', title: 'Essay plan', cid: '25', due: { day: '2026-10-20' }, notes: 'x'.repeat(2000), done: 5, at: 9 },
      { id: 'when', title: 'Bad due', cid: '', due: null, notes: '', done: 0, at: 0 },
    ],
    items: {
      'assignment:1': { on: '2026-10-16', sessions: [{ at: 2e12, min: 30 }], subs: [{ id: 'a', title: 'A', done: false }] },
      'task:ok': { done: true },
    },
  });
  assert.deepEqual(T.clean(undefined), { tasks: [], items: {} });
  assert.equal(T.storeKey('https://school.instructure.com', '3'), 'todo:https://school.instructure.com/3');
  assert.ok(T.STORE_KEY.test('todo:http://localhost:3000/3'));
  assert.ok(!T.STORE_KEY.test('todo:https://a.b/3/x'));
});

test('planner items are kept small and on their own site', () => {
  const s = T.slim({ plannable_type: 'planner_note', plannable_id: '7', course_id: null, plannable_date: '2026-10-16T16:00:00Z', html_url: 'https://x.test/api/v1/planner_notes/7', plannable: { title: 'Note', details: 'Bring goggles' } });
  assert.deepEqual(s, { type: 'planner_note', id: '7', cid: '', course: '', title: 'Note', at: at('2026-10-16T16:00:00Z'), url: '', sub: null, ov: null, aid: '', read: false, note: 'Bring goggles', ws: '', allDay: false });
  assert.equal(T.slim({ plannable_type: 'assignment', plannable_id: 1, html_url: '//evil.test/x' }).url, '');
  assert.equal(T.slim({ plannable_type: 'assignment', plannable_id: 1, html_url: 'https://other.test/courses/1/assignments/1' }).url, '/courses/1/assignments/1');
});

test('its settings join GZ_SPEC from here, so the first content script carries only the switch', () => {
  assert.equal(D.GZ_SPEC.enhance.todo[0], true); // on by default (owner, 2026-10-15); one switch turns it off
  assert.equal(D.GZ_SPEC.todo, T.SPEC);
  assert.deepEqual(D.GZ_SANITIZE({}).todo, { span: 'week', n: 7, unit: 'days', start: 'rolling', past: 'week', rel: false, urgent: true, teacher: true, progress: true, done: 'auto', group: true, sync: false, cardN: 4, cardStatus: true, cardCross: false, gsDaily: false,
    icsDue: true, icsTasks: true, icsPlan: true, icsGs: true, icsClasses: true, icsRange: '4w' });
  assert.equal(D.GZ_SPEC.enhance.cardTasks[0], false); // tasks on cards: off too
  assert.deepEqual(D.GZ_SANITIZE({ todo: { span: 'custom', n: 90, unit: 'weeks', past: 'forever', sync: 'yes' } }).todo, { ...D.GZ_SANITIZE({}).todo, span: 'custom', unit: 'weeks' });
});

test('real calendar dates only; a skipped time moves forward; a redo stays open', () => {
  // 2026-02-30 is no date; an object in a file is no date either, and nothing throws.
  assert.equal(T.keyDay('2026-02-30'), null);
  assert.equal(T.keyDay('2026-02-28'), day('2026-02-28'));
  assert.equal(T.keyDay({ toString: null }), null);
  const cleaned = T.clean({ tasks: [{ id: 'a', title: 'Feb 30', due: { day: '2026-02-30' } }, { id: 'b', title: 'Object', due: { day: { toString: null } } }],
    items: { 'assignment:1': { on: '2026-13-01' } } });
  assert.deepEqual(cleaned.tasks.map((x) => x.due), [null, null]);
  assert.deepEqual(cleaned.items, {});
  // 2:30 doesn't happen in New York on 8 March 2026: it is 3:30 (EDT), not 1:30 (EST). 1:30 on 1 November is the first one.
  assert.equal(new Date(T.typed('2026-03-08', '02:30', NY)).toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(new Date(T.typed('2026-03-08', '01:30', NY)).toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(new Date(T.typed('2026-11-01', '01:30', NY)).toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(T.typed('2026-02-30', '10:00', NY), null);
  // Graded, but a resubmission is asked for: still to do (Canvas keeps it open too).
  const redo = T.slim(item('assignment', 30, '2026-10-16T18:00:00Z', { sub: sub({ submitted: true, graded: true, redo_request: true }) }));
  assert.equal(T.isDone(redo, 'auto'), false);
  assert.ok(keys(T.build({ items: [redo], o: O, now: NOW, tz: NY }).groups.flatMap(([, l]) => l)).includes('assignment:30'));
});

test('a plan never hides a deadline: planned for another day, an item shows under both until it is done', () => {
  const o = { ...O, span: 'custom', n: 3, unit: 'weeks' };
  const plan = (on) => groups(T.build({ items: ITEMS, data: { items: { 'assignment:6': { on } } }, o, now: NOW, tz: NY, cids: new Set(['25']) }));
  // Due tomorrow, planned for 1 November: under Tomorrow and under Later.
  const later = plan('2026-11-01');
  assert.ok(later.tomorrow.includes('assignment:6'));
  assert.ok(later.later.includes('assignment:6'));
  // Planned past the timeframe: still under its due date.
  assert.ok(plan('2026-12-24').tomorrow.includes('assignment:6'));
  // Planned for the day it's due: once.
  assert.equal(Object.values(plan('2026-10-16')).flat().filter((k) => k === 'assignment:6').length, 1);
  // Overdue and planned for tomorrow: under Past due and Tomorrow.
  const late = groups(T.build({ items: ITEMS, data: { items: { 'assignment:1': { on: '2026-10-16' } } }, o, now: NOW, tz: NY, cids: new Set(['25']) }));
  assert.ok(late.past.includes('assignment:1') && late.tomorrow.includes('assignment:1'));
  // Counted once, and once in a single list by date.
  const out = T.build({ items: ITEMS, data: { items: { 'assignment:6': { on: '2026-11-01' } } }, o, now: NOW, tz: NY, cids: new Set(['25']) });
  const flat = T.build({ items: ITEMS, data: { items: { 'assignment:6': { on: '2026-11-01' } } }, o: { ...o, group: false }, now: NOW, tz: NY, cids: new Set(['25']) });
  assert.equal(out.count.all, flat.groups[0][1].length + out.count.done);
  assert.equal(flat.groups[0][1].filter((r) => r.key === 'assignment:6').length, 1);
  // Done: gone from both.
  const done = groups(T.build({ items: ITEMS, data: { items: { 'assignment:6': { on: '2026-11-01', done: true } } }, o, now: NOW, tz: NY, cids: new Set(['25']) }));
  assert.ok(!Object.values(done).flat().includes('assignment:6'));
});

test('one rule for local times in every zone: skipped times land past the gap, repeated ones are the earlier', () => {
  const at2 = (d, t, z) => new Date(T.typed(d, t, z)).toISOString();
  // Spring forward: the time doesn't happen; it is read with the offset from before, landing past the gap.
  assert.equal(at2('2026-03-08', '02:30', NY), '2026-03-08T07:30:00.000Z'); // 3:30 EDT
  assert.equal(at2('2026-03-29', '02:30', 'Europe/Berlin'), '2026-03-29T01:30:00.000Z'); // 3:30 CEST
  assert.equal(at2('2026-10-04', '02:30', 'Australia/Sydney'), '2026-10-03T16:30:00.000Z'); // 3:30 AEDT
  assert.equal(at2('2026-10-04', '02:15', 'Australia/Lord_Howe'), '2026-10-03T15:45:00.000Z'); // 2:45, a half-hour gap
  // Fall back: the time happens twice; the first one.
  assert.equal(at2('2026-11-01', '01:30', NY), '2026-11-01T05:30:00.000Z'); // 1:30 EDT
  assert.equal(at2('2026-10-25', '02:30', 'Europe/Berlin'), '2026-10-25T00:30:00.000Z'); // 2:30 CEST
  assert.equal(at2('2026-04-05', '02:30', 'Australia/Sydney'), '2026-04-04T15:30:00.000Z'); // 2:30 AEDT
  assert.equal(at2('2026-04-05', '01:45', 'Australia/Lord_Howe'), '2026-04-04T14:45:00.000Z'); // 1:45 at +11
  // And ordinary times either side.
  assert.equal(at2('2026-10-04', '04:00', 'Australia/Sydney'), '2026-10-03T17:00:00.000Z');
  assert.equal(at2('2026-03-29', '01:30', 'Europe/Berlin'), '2026-03-29T00:30:00.000Z');
});

test('a backup is imported whole or not at all', async () => {
  const area = (start, fail) => {
    const s = { ...start };
    return {
      s,
      get: async (keys) => Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, s[k]])),
      set: async (v) => { if (fail) throw new Error('QUOTA_BYTES_PER_ITEM'); Object.assign(s, v); },
      remove: async (keys) => { for (const k of keys) delete s[k]; },
    };
  };
  const old = { tasks: [{ id: 'a', title: 'Old' }], items: {} };
  const tasks = { 'todo:https://x.test/3': { tasks: [], items: {} }, 'todo:https://x.test/4': { tasks: [], items: {} } };
  // Settings refused: the tasks those keys held come back, and a key that wasn't there goes.
  const local = area({ 'todo:https://x.test/3': old, other: 1 });
  assert.deepEqual(await T.restore(tasks, { version: 2 }, local, area({}, true)), { ok: false });
  assert.deepEqual(local.s, { 'todo:https://x.test/3': old, other: 1 });
  // Tasks refused: settings untouched.
  const sync = area({ version: 2, colors: 'mine' });
  assert.deepEqual(await T.restore(tasks, { version: 2, colors: 'theirs' }, area({}, true), sync), { ok: false });
  assert.equal(sync.s.colors, 'mine');
  // Both take.
  const l2 = area({}), s2 = area({});
  assert.deepEqual(await T.restore(tasks, { version: 2, colors: 'theirs' }, l2, s2), { ok: true });
  assert.deepEqual(Object.keys(l2.s), Object.keys(tasks));
  assert.equal(s2.s.colors, 'theirs');
});

test("an import whose undo fails too says so, instead of 'nothing changed'", async () => {
  let sets = 0;
  const local = { get: async () => ({ 'todo:https://x.test/3': { tasks: [], items: {} } }), set: async () => { if (++sets > 1) throw new Error('quota'); }, remove: async () => {} };
  const sync = { set: async () => { throw new Error('sync quota'); } };
  assert.deepEqual(await T.restore({ 'todo:https://x.test/3': { tasks: [{ id: 'n', title: 'New' }], items: {} } }, { version: 2 }, local, sync), { ok: false, undone: false });
  // An undo that works: a plain failure, nothing changed. The worker's areas answer false rather than throw.
  const ok = { get: async () => ({}), set: async () => true, remove: async () => true };
  assert.deepEqual(await T.restore({ 'todo:https://x.test/3': { tasks: [], items: {} } }, { version: 2 }, ok, { set: async () => false }), { ok: false });
});
