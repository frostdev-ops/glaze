const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../../extension/courses/stream.js'), D = require('../../extension/content/defaults.js');

test('only deadline notifications use due dates, not grades or newly posted assignment content', () => {
  for (const type of ['GB:DUE', 'DF:DUE', 'AS:OVERDUE']) assert.equal(S.deadline(type), true);
  for (const type of [null, 'bb_mygrades', 'CO:CO_AVAIL', 'DUE_CHANGED', 'GB:DUE:UPDATED', 'bb_tel:stu_grade']) assert.equal(S.deadline(type), false);
});

test('localized due dates preserve the exact deadline and time zone', () => {
  const now = new Date(2026, 9, 23, 12);
  assert.deepEqual(S.date({ datetime: '10/25/26, 11:59 PM', timezone: 'EDT' }, 'en-US', false, now), { label: 'Oct 25', full: '10/25/26, 11:59 PM (EDT)' });
  assert.equal(S.date({ datetime: '25.10.2026, 23:59', timezone: 'MESZ' }, 'de-DE', false, now).full, '25.10.2026, 23:59 (MESZ)');
  assert.match(S.date({ datetime: '1/5/27, 11:59 PM' }, 'en-US', false, now).label, /2027/);
});

test('hiding encouragement never hides grade-risk warnings or unknown telemetry', () => {
  assert.equal(S.encouragement({ streamType: 'bb_tel:stu_grade', notificationType: 'GradeIncreased' }), true);
  for (const notificationType of [undefined, 'GradeDecreased', 'AtRisk', 'Unknown']) assert.equal(S.encouragement({ streamType: 'bb_tel:stu_grade', notificationType }), false);
  assert.equal(S.encouragement({ streamType: 'bb_mygrades', notificationType: 'GradeIncreased' }), false);
});

test('missing and invalid due dates safely retain the posted timestamp', () => {
  for (const values of [null, {}, { datetime: 42 }, { datetime: '' }, { datetime: 'No due date' }, { datetime: '2/30/26, 11:59 PM' },
    { datetime: '10/25/26, 11:99 PM' }, { datetime: '10/25/26, 13:00 PM' }, { datetime: '10/25/26, 24:00' }]) assert.equal(S.date(values), null);
  assert.equal(S.json('{broken'), null); assert.equal(S.json(null), null);
});

test('US 24-hour deadlines retain their time in relative mode', () => {
  assert.equal(S.date({ datetime: '10/23/26, 23:59' }, 'en-US', true, new Date(2026, 9, 23, 12)).label, 'in 12 hours');
});

test('a Stream module injected before bootstrap does not retain an unusable context', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const source = fs.readFileSync(require.resolve('../../extension/courses/page/stream.js'), 'utf8');
  const c = vm.createContext({ GZ_CTX: undefined });
  assert.doesNotThrow(() => vm.runInContext(source, c));
  assert.equal(c.GZ_STREAM_UI, undefined);
});

test('relative dates use the browser zone; an unrecognized/different zone keeps a calendar date', () => {
  const now = new Date(2026, 9, 23, 12);
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date(2026, 9, 25)).find((p) => p.type === 'timeZoneName').value;
  assert.equal(S.date({ datetime: '10/25/26, 11:59 PM', timezone: zone }, 'en-US', true, now).label, 'in 2 days');
  assert.equal(S.date({ datetime: '10/25/26, 11:59 PM', timezone: 'School time' }, 'en-US', true, now).label, 'Oct 25');
});

test('old settings gain smart dates without hiding notifications; invalid imports fall back safely', () => {
  assert.deepEqual(D.GZ_SANITIZE({}).stream, { dates: 'smart', relative: false, compact: false, encouragement: true, status: true });
  assert.deepEqual(D.GZ_SANITIZE({ stream: { dates: 'evil', compact: 'yes', encouragement: false, extra: 1 } }).stream,
    { dates: 'smart', relative: false, compact: false, encouragement: false, status: true });
  for (const dates of ['smart', 'posted', 'both']) assert.equal(D.GZ_SANITIZE({ stream: { dates } }).stream.dates, dates);
});

// The owner, 2026-11-01: students opened the course instead of the assignment, from its name in bold on top of each card
// (Ultra's own order: course, then item). Glaze puts the item first, in bold, and the course under it.
test('an Activity card reads item first, in bold, then its course and the rest in Ultra\'s order', () => {
  const { cssRules, chain, winner } = require('../helpers/css-cascade.cjs');
  const theme = cssRules('content/theme.css');
  const details = chain('html', 'body', 'div#site-wrap', 'div.activity-stream', 'div#activity-stream', 'div.stream-item', 'div.element-card.stream-panel-activity-card', 'div.element-details.course-color-9');
  const kid = (spec, parent = details) => Object.assign(chain(spec), { parent });
  const order = (cls) => Number(winner(theme, kid(`div.${cls}`), 'order')?.[0] ?? 0);
  assert.ok(order('timestamp') < order('name'), 'its date stays where it was');
  assert.ok(order('name') < order('context'), 'the item above its course');
  assert.equal(order('context'), order('content'), 'the course, then the rest, in Ultra\'s order');
  assert.equal(order('context'), order('anything-else'));
  const weight = (cls) => winner(theme, kid('a', kid(`div.${cls}`)), 'font-weight')?.[0];
  assert.equal(winner(theme, kid('div.name'), 'font-weight')?.[0], '700');
  assert.equal(weight('name'), '700', 'its link too');
  assert.equal(winner(theme, kid('div.context'), 'font-weight')?.[0], '400');
  assert.equal(weight('context'), '400');
});

// An Activity card's assignment, among the planner's Ultra items (courses/ultra.js due(): id the gradebook column, content
// its content item, cid the course), for the submission status beside it (courses/page/cardtasks.js, stream.status).
const ITEMS = [
  { type: 'assignment', id: '_605_1', content: '_501_1', cid: '_101_1', course: 'BIO 1100: Biology I', title: 'Practice essay', sub: { submitted: true } },
  { type: 'assignment', id: '_606_1', content: '_502_1', cid: '_102_1', course: 'ENG 1100: College Writing', title: 'Quiz 1', sub: { submitted: false } },
  { type: 'quiz', id: '_607_1', content: '_503_1', cid: '_103_1', course: 'MATH 1350: Calculus I', title: 'Quiz 1', sub: null },
];
test('an Activity card finds its assignment by the ids in its link, else by its title in its course', () => {
  assert.equal(S.find(ITEMS, { links: ['/ultra/courses/_101_1/outline/assessment/_501_1'] })?.id, '_605_1', 'the content item');
  assert.equal(S.find(ITEMS, { links: ['/ultra/courses/_101_1/grades/assessment/_605_1/overview'] })?.id, '_605_1', 'the gradebook column');
  assert.equal(S.find(ITEMS, { links: ['/ultra/redirect?redirectType=nautilus&courseId=_102_1&contentId=_502_1'] })?.id, '_606_1', "Ultra's redirect");
  assert.equal(S.find(ITEMS, { links: ['#'], title: '  Practice   essay ', course: 'BIO 1100: Biology I' })?.id, '_605_1', 'title and course name');
  assert.equal(S.find(ITEMS, { links: ['/ultra/courses/_102_1/outline'], title: 'Quiz 1' })?.id, '_606_1', 'title in the course its link names');
});
test("an Activity card's title alone, or in another course, names nothing", () => {
  assert.equal(S.find(ITEMS, { title: 'Quiz 1' }), null, 'two courses have a Quiz 1');
  assert.equal(S.find(ITEMS, { title: 'Practice essay' }), null, 'no course to tell it by');
  assert.equal(S.find(ITEMS, { title: 'Practice essay', course: 'ENG 1100: College Writing' }), null, 'another course');
  assert.equal(S.find(ITEMS, { links: ['/ultra/courses/_101_1/outline/assessment/_999_1'], title: 'Lab report' }), null, 'an item the planner lacks');
  assert.equal(S.find([], { links: ['/ultra/courses/_101_1/outline/assessment/_501_1'] }), null);
  assert.equal(S.find(ITEMS, {}), null);
});
test('submission status on Activity cards is a stream setting, on unless turned off', () => {
  assert.equal(D.GZ_SANITIZE({}).stream.status, true);
  assert.equal(D.GZ_SANITIZE({ stream: { status: false } }).stream.status, false);
});
