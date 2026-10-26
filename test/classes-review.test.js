const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/classes.js');
const T = require('../lib/todo.js');
const I = require('../lib/ics.js');
const NY = 'America/New_York', LA = 'America/Los_Angeles';
const key = C.storeKey('https://canvas.test', '3');
const p = (more = {}) => ({ days: [1], start: 540, end: 600, loc: 'Room 1', from: '2026-10-05', to: '2026-11-30', skip: [], ...more });
const area = (data) => {
  const box = data ? { [key]: data } : {};
  let writes = 0;
  return { box, get writes() { return writes; }, local: { get: async () => structuredClone(box), set: async (next) => { writes++; Object.assign(box, structuredClone(next)); return true; } } };
};
const save = (a, at, periods, more = {}) => C.change({ key, at, op: 'add', tz: NY, courses: [{ id: '25', name: 'Biology', periods }], ...more }, a);

test('reimport preserves manual days off and removals while updating imported holidays', async () => {
  const a = area();
  await save(a, 1, [p({ skip: ['2026-10-12', '2026-10-19'] })]);
  const edited = { ...a.box[key].courses[0].periods[0], skip: ['2026-10-19', '2026-11-02'] };
  await save(a, 2, [edited], { op: 'put' });
  await save(a, 3, [p({ skip: ['2026-10-12', '2026-11-09'] })]);
  assert.deepEqual(a.box[key].courses[0].periods[0].skip, ['2026-11-02', '2026-11-09']);
  await save(a, 4, [p({ skip: ['2026-10-12', '2026-11-09'] })]);
  assert.deepEqual(a.box[key].courses[0].periods[0].skip, ['2026-11-02', '2026-11-09']);
});

test('legacy days off without import provenance survive reimport', async () => {
  const a = area({ tz: NY, courses: [{ id: '25', name: 'Biology', at: 1, periods: [p({ skip: ['2026-11-02'] })] }] });
  await save(a, 2, [p({ skip: ['2026-11-09'] })]);
  assert.deepEqual(a.box[key].courses[0].periods[0].skip, ['2026-11-02', '2026-11-09']);
});

test('the same bounded calendar reimported in another zone matches instants across DST', async () => {
  const feed = (skip = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bio\r\nSUMMARY:Biology\r\nDTSTART;TZID=America/New_York:20261005T090000\r\nDTEND;TZID=America/New_York:20261005T100000\r\nRRULE:FREQ=WEEKLY;COUNT=9\r\n${skip}END:VEVENT\r\nEND:VCALENDAR\r\n`;
  const a = area(), now = Date.UTC(2026, 9, 15);
  await save(a, 1, C.fromIcs(feed(), { now, tz: NY }).entries[0].periods);
  const before = C.icsEvents(a.box[key], { from: '2026-10-05', to: '2026-11-30', tz: NY });
  await save(a, 2, C.fromIcs(feed('EXDATE;TZID=America/New_York:20261102T090000\r\n'), { now, tz: LA }).entries[0].periods, { tz: LA });
  assert.equal(a.box[key].courses[0].periods.length, 1);
  assert.deepEqual(C.icsEvents(a.box[key], { from: '2026-10-05', to: '2026-11-30', tz: NY }).map((e) => e.start), before.filter((e) => e.start !== Date.UTC(2026, 10, 2, 14)).map((e) => e.start));
});

test('equivalent periods on different local weekdays reconcile days off in the retained zone', async () => {
  const a = area();
  await save(a, 1, [p({ start: 1380, end: 1430, from: '2026-10-05', to: '2026-10-26' })]);
  await save(a, 2, [p({ days: [2], start: 240, end: 290, from: '2026-10-06', to: '2026-10-27', skip: ['2026-10-20'] })], { tz: 'Europe/London' });
  // London changes clocks a week before New York: the last meeting above is deliberately a different instant.
  assert.equal(a.box[key].courses[0].periods.length, 2, 'different recurrence instants must stay separate');
  const b = area();
  await save(b, 1, [p({ start: 1380, end: 1430, from: '2026-10-05', to: '2026-10-19' })]);
  await save(b, 2, [p({ days: [2], start: 240, end: 290, from: '2026-10-06', to: '2026-10-20', skip: ['2026-10-13'] })], { tz: 'Europe/London' });
  assert.equal(b.box[key].courses[0].periods.length, 1);
  assert.deepEqual(b.box[key].courses[0].periods[0].skip, ['2026-10-12']);
});

test('new saves without a profile zone freeze the device zone while legacy periods remain floating', async () => {
  const a = area({ courses: [{ id: '26', name: 'Old', periods: [p()] }] });
  await save(a, 1, [p()], { tz: undefined });
  assert.equal(a.box[key].courses.find((c) => c.id === '25').periods[0].tz, new Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(a.box[key].courses.find((c) => c.id === '26').periods[0].tz, undefined);
});

test('calendar export distinguishes equal wall times in different period zones', () => {
  const store = { courses: [{ id: '25', name: 'Biology', periods: [p({ tz: NY }), p({ tz: LA })] }] };
  const evs = C.icsEvents(store, { from: '2026-10-05', to: '2026-10-05', tz: NY });
  assert.equal(evs.length, 2);
  assert.equal(new Set(evs.map((e) => e.uid)).size, 2);
  assert.equal(I.parse(I.write({ name: 'Classes', events: evs })).events.length, 2);
});

test('over-limit days off reject the entire batch without a storage write', async () => {
  const a = area();
  await save(a, 1, [p()]);
  const before = structuredClone(a.box), writes = a.writes;
  const skip = Array.from({ length: 201 }, (_, i) => C.keyOf(C.dayNum('2026-01-01') + i));
  const r = await C.change({ key, at: 2, op: 'add', courses: [{ id: '26', name: 'Chemistry', periods: [p()] }, { id: '25', name: 'Biology', periods: [p({ skip })] }] }, a);
  assert.deepEqual(r, { ok: false, error: 'skip' });
  assert.deepEqual(a.box, before);
  assert.equal(a.writes, writes);
  assert.equal((await save(a, 3, [p({ skip: skip.slice(0, 200) })])).ok, true);
});

test('pasted schedules report the 21st distinct period before a truncated review can be saved', () => {
  const text = Array.from({ length: 21 }, (_, i) => `BIO 1100 Biology M ${C.hhmm(420 + i * 20)}-${C.hhmm(430 + i * 20)} Room ${i}`).join('\n');
  assert.equal(C.fromText(text).error, 'periods');
});

test('period and course limits leave earlier batch edits and tombstones untouched', async () => {
  for (const [error, courses] of [
    ['periods', [{ id: '26', periods: Array.from({ length: 21 }, (_, i) => p({ loc: `Room ${i}` })) }]],
    ['courses', Array.from({ length: 60 }, (_, i) => ({ id: `o-c${i}`, periods: [p()] }))],
  ]) {
    const a = area({ gone: { 26: 1 }, courses: [{ id: '25', name: 'Biology', at: 1, periods: [p()] }] });
    const before = structuredClone(a.box);
    assert.deepEqual(await C.change({ key, op: 'add', at: 2, courses: [{ id: '25', name: 'Biology', periods: [p({ skip: ['2026-10-12'] })] }, ...courses] }, a), { ok: false, error });
    assert.equal(a.writes, 0);
    assert.deepEqual(a.box, before);
  }
});

test('mixed-zone instants pass intact through reminder, agenda and export consumers with legacy fallbacks', () => {
  const R = require('../lib/remind.js'), W = require('../lib/widgets.js'), X = require('../lib/calexport.js');
  for (const tz of [NY, LA]) {
    const store = { tz: 'America/Phoenix', courses: [{ id: '_25_1', name: 'Biology', periods: [p({ tz: NY }), p({ tz: LA }), p({ start: 720, end: 780 })] }] };
    const day = C.dayNum('2026-11-02'), from = T.midnight(day, tz), to = T.midnight(day + 1, tz);
    const meetings = C.between(store, from, to, tz);
    assert.deepEqual(meetings.map((x) => new Date(x.at).toISOString()), ['2026-11-02T14:00:00.000Z', '2026-11-02T17:00:00.000Z', '2026-11-02T19:00:00.000Z']);
    const evs = R.events({ rows: [], cats: {}, o: {}, tz, extra: C.events(store, { now: from, tz }) }).filter((x) => x.end >= from && x.end < to);
    assert.deepEqual(evs.map((x) => x.end), meetings.map((x) => x.at));
    assert.ok(evs.every((x) => x.url === '/ultra/courses/_25_1/outline'));
    assert.deepEqual(W.agenda(T, { day, tz, extra: meetings }).map((x) => x.at), meetings.map((x) => x.at));
    assert.deepEqual(X.events({ o: {}, classes: C.icsEvents(store, { from: '2026-11-02', to: '2026-11-02', tz }) }).map((x) => x.start), meetings.map((x) => x.at));
  }
});

test('a calendar split at different DST boundaries reimports once and keeps manual days off', async () => {
  const feed = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bio\r\nSUMMARY:Biology\r\nDTSTART;TZID=America/New_York:20260824T090000\r\nDTEND;TZID=America/New_York:20260824T100000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  for (const [first, second] of [[NY, 'America/Phoenix'], ['America/Phoenix', NY]]) {
    const a = area(), now = Date.UTC(2026, 9, 15);
    await save(a, 1, C.fromIcs(feed, { now, tz: first }).entries[0].periods, { tz: first });
    const original = structuredClone(a.box[key].courses[0].periods);
    await save(a, 2, original.map((p) => ({ ...p, skip: [...p.skip, '2026-11-02'] })), { op: 'put', tz: first });
    const expected = C.icsEvents(a.box[key], { from: '2026-08-24', to: '2027-08-01', tz: NY }).map((e) => e.start);
    await save(a, 3, C.fromIcs(feed, { now, tz: second }).entries[0].periods, { tz: second });
    assert.equal(a.box[key].courses[0].periods.length, original.length);
    assert.deepEqual(C.icsEvents(a.box[key], { from: '2026-08-24', to: '2027-08-01', tz: NY }).map((e) => e.start), expected);
  }
});

test('a class export UID does not change when the range excludes its other-zone twin', () => {
  const store = { courses: [{ id: '25', name: 'Biology', periods: [p({ start: 1380, end: 1430, tz: NY }), p({ start: 1380, end: 1430, tz: LA })] }] };
  const wide = C.icsEvents(store, { from: '2026-10-05', to: '2026-10-06', tz: NY });
  const narrow = C.icsEvents(store, { from: '2026-10-06', to: '2026-10-06', tz: NY });
  assert.equal(narrow.length, 1);
  assert.equal(narrow[0].uid, wide.find((e) => e.start === narrow[0].start).uid);
});

test('manual changes made while reviewing a DST-split reimport reach the retained period', async () => {
  const feed = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:bio\r\nSUMMARY:Biology\r\nDTSTART;TZID=America/New_York:20260824T090000\r\nDTEND;TZID=America/New_York:20260824T100000\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const a = area(), now = Date.UTC(2026, 9, 15);
  await save(a, 1, C.fromIcs(feed, { now, tz: NY }).entries[0].periods);
  const next = C.fromIcs(feed, { now, tz: 'America/Phoenix' }).entries[0].periods.map((p) => ({ ...p, importedSkip: [...p.skip] }));
  next.find((p) => p.start === 420).skip.push('2026-11-02');
  await save(a, 2, next, { tz: 'America/Phoenix' });
  assert.equal(a.box[key].courses[0].periods.length, 1);
  assert.deepEqual(a.box[key].courses[0].periods[0].skip, ['2026-11-02']);
});

test('trimming imported days off to 200 permits saving and preserves the removed source date', async () => {
  const a = area();
  const importedSkip = Array.from({ length: 201 }, (_, i) => C.keyOf(C.dayNum('2026-01-01') + i));
  assert.equal((await save(a, 1, [p({ skip: importedSkip.slice(1), importedSkip })])).ok, true);
  assert.equal(a.box[key].courses[0].periods[0].skip.length, 200);
  assert.deepEqual(a.box[key].courses[0].periods[0].importedSkip, importedSkip);
});
