// The calendar file (lib/calexport.js through lib/ics.js): what goes in, the ranges, the UIDs, and that the file reads back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const X = require('../lib/calexport.js');
const T = require('../lib/todo.js');
const ICS = require('../lib/ics.js');

const TZ = 'America/New_York';
const NOW = Date.parse('2026-10-15T14:00:00Z'); // Thursday, 10:00 in New York
const ALL = { icsDue: true, icsTasks: true, icsPlan: true, icsGs: true };
const words = { plan: (x) => `Do: ${x}`, focus: (x) => `Focus: ${x}` };
const item = (o) => ({ type: 'assignment', id: '1', cid: '7', course: 'Biology', title: 'Lab 1', at: Date.parse('2026-10-20T03:59:00Z'), url: '/courses/7/assignments/1', ov: null, allDay: false, ...o });

const run = (o = {}) => {
  const r = X.range(o.range || '4w', NOW, TZ, o.courses);
  return X.events({ items: [], gs: [], data: {}, o: ALL, ...r, site: 'https://canvas.test', host: 'canvas.test', names: { 7: 'Biology' }, words, ...o });
};

test('ranges run from the start of today to the end of the last day, in the Canvas time zone', () => {
  const r = X.range('2w', NOW, TZ);
  assert.equal(new Date(r.from).toISOString(), '2026-10-15T04:00:00.000Z');
  // Across the November change: midnight in New York is 05:00Z by then.
  assert.equal(new Date(r.to).toISOString(), '2026-10-29T04:00:00.000Z');
  assert.equal(new Date(X.range('16w', NOW, TZ).to).toISOString(), '2027-02-04T05:00:00.000Z');
  assert.equal(r.guessed, false);
});

test('this term: the latest end among courses under way; the default term has no dates, so 16 weeks, said so', () => {
  const courses = [
    { id: 1, term: { start_at: '2026-08-20T00:00:00Z', end_at: '2026-12-18T05:00:00Z' } },
    { id: 2, term: { start_at: '2027-01-10T00:00:00Z', end_at: '2027-05-10T00:00:00Z' } }, // next term: not begun
    { id: 3, restrict_enrollments_to_course_dates: true, end_at: '2026-12-20T22:00:00Z', term: { end_at: '2027-06-01T00:00:00Z' } }, // its own dates
    { id: 4, term: { end_at: '2026-05-01T00:00:00Z' } }, // over
  ];
  const r = X.range('term', NOW, TZ, courses);
  assert.equal(new Date(r.to).toISOString(), '2026-12-21T05:00:00.000Z', 'through Dec 20 in New York');
  assert.equal(r.guessed, false);
  const none = X.range('term', NOW, TZ, [{ id: 5, term: { name: 'Default Term', start_at: null, end_at: null } }]);
  assert.equal(none.guessed, true);
  assert.equal(none.to, X.range('16w', NOW, TZ).to);
  assert.equal(X.range('term', NOW, TZ, [{ term: { end_at: '2030-01-01T00:00:00Z' } }]).last - T.dayOf(NOW, TZ), 366, 'at most a year');
});

test('Canvas items: deadlines as instants, all-day as dates, only in range, only shown courses, never dismissed, announcements or calendar events', () => {
  const items = [
    item(),
    item({ id: '2', title: 'Holiday', allDay: true, at: Date.parse('2026-10-22T00:00:00Z') }),
    item({ id: '3', at: NOW - 864e5 }), // yesterday
    item({ id: '4', at: Date.parse('2026-11-12T05:00:00Z') }), // past 4 weeks (ends Nov 12 00:00 New York = 05:00Z)
    item({ id: '5', ov: { id: '9', done: false, dismissed: true } }),
    item({ id: '6', type: 'announcement' }),
    item({ id: '8', type: 'calendar_event' }), // Canvas's own calendar feed has those
    item({ id: '7', cid: '99' }), // a concluded course
  ];
  const ev = run({ items, cids: new Set(['7']) });
  assert.deepEqual(ev.map((e) => e.uid), ['canvas.test/assignment/1@glaze', 'canvas.test/assignment/2@glaze']);
  assert.deepEqual([ev[0].start, ev[0].end, ev[0].url, ev[0].description], [items[0].at, undefined, 'https://canvas.test/courses/7/assignments/1', 'Biology']);
  assert.deepEqual([ev[1].start, ev[1].end], ['2026-10-22', '2026-10-23']);
  assert.equal(run({ items, o: { ...ALL, icsDue: false } }).length, 0);
});

test('custom tasks with a due date; plans and focus sessions under their item\'s title; Gradescope only when picked', () => {
  const gs = [item({ type: 'gradescope', id: '55', title: 'HW 3', url: 'https://www.gradescope.com/courses/1/assignments/55', course: '' })];
  const data = {
    tasks: [
      { id: 'a1', title: 'Read ch. 4', cid: '7', due: { day: '2026-10-18' }, notes: 'pages 80-95' },
      { id: 'a2', title: 'Email TA', due: { at: Date.parse('2026-10-16T13:00:00Z') } },
      { id: 'a3', title: 'Someday' },
    ],
    items: {
      'assignment:1': { on: '2026-10-17', sessions: [{ at: Date.parse('2026-10-16T18:00:00Z'), min: 50 }, { at: NOW - 864e5, min: 30 }] },
      'task:a3': { on: '2026-10-19' },
      'assignment:404': { on: '2026-10-19' }, // not in what was read: left out
    },
  };
  const ev = run({ items: [item()], gs, data });
  const by = Object.fromEntries(ev.map((e) => [e.uid, e]));
  assert.deepEqual(Object.keys(by).sort(), [
    'canvas.test/assignment/1@glaze', 'canvas.test/gradescope/55@glaze', 'canvas.test/on/assignment%3A1@glaze', 'canvas.test/on/task%3Aa3@glaze',
    `canvas.test/session/assignment%3A1/${Date.parse('2026-10-16T18:00:00Z')}@glaze`, 'canvas.test/task/a1@glaze', 'canvas.test/task/a2@glaze',
  ]);
  assert.deepEqual([by['canvas.test/task/a1@glaze'].start, by['canvas.test/task/a1@glaze'].description], ['2026-10-18', 'Biology\npages 80-95']);
  assert.equal(by['canvas.test/gradescope/55@glaze'].url, 'https://www.gradescope.com/courses/1/assignments/55');
  const s = by[`canvas.test/session/assignment%3A1/${Date.parse('2026-10-16T18:00:00Z')}@glaze`];
  assert.deepEqual([s.summary, s.end - s.start, s.url], ['Focus: Lab 1', 50 * 6e4, 'https://canvas.test/courses/7/assignments/1']);
  assert.equal(by['canvas.test/on/task%3Aa3@glaze'].summary, 'Do: Someday');
  // Each part has its own switch; a plan keeps its title when its item's deadline isn't exported.
  const plansOnly = run({ items: [item()], gs, data, o: { icsPlan: true } });
  assert.deepEqual(plansOnly.map((e) => e.summary).sort(), ['Do: Lab 1', 'Do: Someday', 'Focus: Lab 1']);
  assert.ok(!run({ items: [item()], gs, data, o: { ...ALL, icsGs: false } }).some((e) => e.uid.includes('gradescope')));
  // W14's class periods pass straight through.
  const cls = { uid: 'x@glaze', summary: 'BIO 101', start: '2026-10-19T09:00', end: '2026-10-19T09:50', rrule: { freq: 'WEEKLY', byday: ['MO'] } };
  assert.ok(run({ classes: [cls] }).includes(cls));
});

test('the same items give the same UIDs on every export, and the file reads back, escaping intact', () => {
  const items = [item({ title: 'Essay; draft, v2\nfinal \\ notes' })];
  const a = run({ items }), b = run({ items });
  assert.deepEqual(a.map((e) => e.uid), b.map((e) => e.uid));
  const text = ICS.write({ name: 'Glaze', events: a }, { now: NOW });
  assert.match(text, /SUMMARY:Essay\\; draft\\, v2\\nfinal \\\\ notes\r\n/);
  assert.match(text, /DTSTAMP:20261015T140000Z/);
  const back = ICS.parse(text);
  assert.equal(back.events[0].summary, 'Essay; draft, v2\nfinal \\ notes');
  assert.equal(back.events[0].start, items[0].at);
  assert.equal(back.events[0].uid, 'canvas.test/assignment/1@glaze');
});

test('the on-demand files end on their module and keep the first when loaded twice', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const [file, name] of [['lib/ics.js', 'GZ_ICS'], ['lib/calexport.js', 'GZ_CALEXPORT'], ['features/calexport.js', 'GZ_CAL_UI']]) {
    const ctx = vm.createContext({ TextEncoder, GZ_CTX: { t: (k) => k } });
    vm.runInContext('globalThis.globalThis = this;', ctx);
    assert.ok(vm.runInContext(read(file), ctx), `${file}: no last value`);
    const first = vm.runInContext(name, ctx);
    vm.runInContext(read(file), ctx);
    assert.equal(vm.runInContext(name, ctx), first, file);
  }
});
