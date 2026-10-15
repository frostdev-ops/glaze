const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I = require('../lib/ics.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures/ics', name));
const at = (s) => Date.parse(s);
const iso = (ms) => new Date(ms).toISOString().replace('.000', '');
const FALL = [at('2026-08-01T00:00:00Z'), at('2027-01-01T00:00:00Z')];

// The student feed of the local Canvas (/feeds/calendars/user_….ics), as Canvas serves it.
test('Canvas feed: all-day assignments, timed events, folded URLs, escaped text', () => {
  const cal = I.parse(fixture('canvas-feed.ics'), { tz: 'America/New_York' });
  assert.equal(cal.name, 'Sam Taylor Calendar (Canvas)');
  assert.equal(cal.events.length, 32);
  // Canvas writes VALUE=DATE twice on assignment due dates.
  const hw = cal.events.find((e) => e.uid === 'event-assignment-183');
  assert.deepEqual([hw.allDay, hw.start, hw.end, hw.summary], [true, '2026-09-20', '2026-09-21', 'Homework 1 [MATH 1350]']);
  assert.equal(hw.url, 'https://localhost:3000/calendar?include_contexts=course_27&month=09&year=2026#assignment_183');
  const lab = cal.events.find((e) => e.uid === 'event-calendar-event-31');
  assert.deepEqual([lab.allDay, iso(lab.start), iso(lab.end), lab.location, lab.tz], [false, '2026-10-15T14:00:00Z', '2026-10-15T15:50:00Z', 'Science Hall 214', 'UTC']);
  assert.ok(cal.events.every((e) => e.uid && e.summary && !e.rrule));
  assert.equal(I.expand(cal, ...FALL).length, 32);
});

test('Google export: weekly MWF class across the DST change, EXDATEs, a moved and a cancelled lecture', () => {
  const cal = I.parse(fixture('google-class.ics'));
  assert.deepEqual([cal.name, cal.tz], ['Fall 2026 classes', 'America/New_York']);
  const lec = cal.events.find((e) => e.summary === 'BIO 1100 Lecture' && !e.recurrenceId);
  assert.equal(lec.description, "Lecture, then questions.\nBring the lab manual; it's on the bookstore list.");
  assert.equal(lec.location, 'Science Hall 214, Northfield University');
  assert.deepEqual(lec.rrule, { freq: 'WEEKLY', interval: 1, count: null, until: at('2026-12-12T04:59:59Z'), byday: ['FR', 'MO', 'WE'], wkst: 'SU' });
  assert.deepEqual(lec.unsupported, []);
  assert.equal(lec.exdates.length, 3);

  const occ = I.expand(cal, ...FALL).filter((o) => o.event.uid === lec.uid);
  // Every Mon/Wed/Fri from Aug 24 to Dec 11, less Labor Day, Nov 25 and 27 (EXDATE), and Oct 21 (cancelled).
  let mwf = 0;
  for (let d = at('2026-08-24'); d <= at('2026-12-11'); d += 864e5) if ([1, 3, 5].includes(new Date(d).getUTCDay())) mwf++;
  assert.equal(occ.length, mwf - 4);
  const starts = occ.map((o) => iso(o.start));
  assert.equal(starts[0], '2026-08-24T13:00:00Z');
  assert.ok(!starts.includes('2026-09-07T13:00:00Z') && !starts.includes('2026-10-21T13:00:00Z'));
  // 9:00 stays 9:00 local when New York leaves daylight time on Nov 1.
  assert.ok(starts.includes('2026-10-30T13:00:00Z') && starts.includes('2026-11-02T14:00:00Z'));
  assert.equal(starts.at(-1), '2026-12-11T14:00:00Z');
  const moved = occ.find((o) => o.event.recurrenceId != null);
  assert.deepEqual([moved.event.summary, iso(moved.start), iso(moved.end), moved.event.location], ['BIO 1100 Lecture (moved)', '2026-10-16T14:00:00Z', '2026-10-16T14:50:00Z', 'Science Hall 120']);
  assert.ok(!starts.includes('2026-10-16T13:00:00Z'), 'the moved instance replaces the original');
  assert.ok(occ.every((o) => o.end - o.start === 50 * 60e3));

  const brk = cal.events.find((e) => e.summary === 'Thanksgiving break');
  assert.deepEqual([brk.allDay, brk.start, brk.end], [true, '2026-11-26', '2026-11-28']);
});

test('Outlook export: Windows zone names resolved through the file\'s VTIMEZONE, alarms ignored', () => {
  const cal = I.parse(fixture('outlook-class.ics'));
  const eng = cal.events.find((e) => e.summary === 'ENG 1100 College Writing');
  assert.equal(eng.tz, 'Eastern Standard Time');
  assert.equal(eng.description, '\n');
  assert.equal(eng.uid, '040000008200E00074C5B7101A82E0080000000010B2A7C1F9D7DC01000000000000000010000000B5D0E63A3E8E5F4C9F2A0C1D7E6B5A43');
  const occ = I.expand(cal, ...FALL).filter((o) => o.event === eng);
  let tr = 0;
  for (let d = at('2026-08-25'); d <= at('2026-12-10'); d += 864e5) if ([2, 4].includes(new Date(d).getUTCDay())) tr++;
  assert.equal(occ.length, tr);
  assert.equal(iso(occ[0].start), '2026-08-25T16:30:00Z');
  assert.equal(iso(occ.at(-1).start), '2026-12-10T17:30:00Z');

  // Berlin leaves summer time on Oct 25: 14:15 local is 12:15Z, then 13:15Z.
  const sem = cal.events.find((e) => e.summary === 'Seminar Europäische Geschichte');
  assert.equal(sem.location, 'Hörsaal 3');
  assert.deepEqual(I.expand(cal, ...FALL).filter((o) => o.event === sem).map((o) => iso(o.start)),
    ['2026-10-14T12:15:00Z', '2026-10-21T12:15:00Z', '2026-10-28T13:15:00Z', '2026-11-04T13:15:00Z']);
});

test('a VTIMEZONE alone gives the same offsets as the IANA zone it describes', () => {
  const vtz = (id) => fixture('outlook-class.ics').toString().replace(/W\. Europe Standard Time/g, id);
  const ev = (start) => `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;TZID=Not A Real Zone:${start}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  for (let m = 1; m <= 12; m++) {
    for (const day of ['01', '15', '28']) {
      const local = `2027${String(m).padStart(2, '0')}${day}T141500`;
      const a = I.parse(vtz('Not A Real Zone') + ev(local)).events.at(-1).start;
      const b = I.parse(ev(local).replace('Not A Real Zone', 'Europe/Berlin')).events[0].start;
      assert.equal(a, b, local);
    }
  }
});

test('Apple export: biweekly COUNT, quoted parameters with colons, categories, all-day', () => {
  const cal = I.parse(fixture('apple-class.ics'));
  assert.equal(cal.name, 'School');
  const lab = cal.events.find((e) => e.uid === '6B29FC40-CA47-1067-B31D-00DD010662DA');
  assert.equal(lab.summary, 'CHEM lab (every other Monday)');
  assert.equal(lab.location, 'Lambert 201\nNorthfield University');
  assert.deepEqual(lab.categories, ['School', 'Lab']);
  assert.equal(lab.tz, 'America/Los_Angeles');
  const starts = I.expand(cal, ...FALL).filter((o) => o.event === lab).map((o) => iso(o.start));
  assert.deepEqual(starts, ['2026-08-31T21:00:00Z', '2026-09-14T21:00:00Z', '2026-09-28T21:00:00Z', '2026-10-12T21:00:00Z',
    '2026-10-26T21:00:00Z', '2026-11-09T22:00:00Z', '2026-11-23T22:00:00Z', '2026-12-07T22:00:00Z']);
  const last = cal.events.find((e) => e.summary === 'Last day of classes');
  assert.deepEqual([last.allDay, last.start, last.end], [true, '2026-12-11', '2026-12-12']);
});

test('a fold that splits a UTF-8 character still decodes when given bytes', () => {
  const head = Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261014T120000Z\r\nSUMMARY:Caf');
  const e = Buffer.from('é');
  const tail = Buffer.from(' au lait\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
  const bytes = Buffer.concat([head, e.subarray(0, 1), Buffer.from('\r\n '), e.subarray(1), tail]);
  assert.equal(I.parse(new Uint8Array(bytes)).events[0].summary, 'Café au lait');
  assert.equal(I.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)).events[0].summary, 'Café au lait');
});

test('times that DST skips or repeats follow RFC 5545', () => {
  const one = (dt) => I.parse(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID="America/New_York":${dt}\nEND:VEVENT\nEND:VCALENDAR`).events[0].start;
  assert.equal(iso(one('20260308T023000')), '2026-03-08T07:30:00Z', 'a skipped time uses the offset before the gap');
  assert.equal(iso(one('20261101T013000')), '2026-11-01T05:30:00Z', 'a repeated time is its first occurrence');
  assert.equal(iso(one('20261101T023000')), '2026-11-01T07:30:00Z');
});

test('floating times, DURATION, missing DTEND, and a fallback zone', () => {
  const cal = I.parse([
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:f', 'DTSTART:20261014T090000', 'DURATION:PT1H15M', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:g', 'DTSTART:20261014T090000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:h', 'DTSTART;VALUE=DATE:20261014', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:i', 'DTSTART;TZID=/mozilla.org/20050126_1/Asia/Tokyo:20261014T090000', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:j', 'SUMMARY:no start', 'END:VEVENT',
    'END:VCALENDAR'].join('\n'), { tz: 'Asia/Kolkata' });
  const [f, g, h, i] = cal.events;
  assert.equal(cal.events.length, 4, 'an event without DTSTART is dropped');
  assert.deepEqual([iso(f.start), iso(f.end), f.tz], ['2026-10-14T03:30:00Z', '2026-10-14T04:45:00Z', 'Asia/Kolkata']);
  assert.equal(g.end, g.start);
  assert.deepEqual([h.start, h.end], ['2026-10-14', '2026-10-15']);
  assert.deepEqual([iso(i.start), i.tz], ['2026-10-14T00:00:00Z', 'Asia/Tokyo']);
  assert.equal(cal.tz, 'Asia/Kolkata');
});

test('rules this reader can\'t follow are flagged and give only their first occurrence', () => {
  const cal = I.parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:mlk\nDTSTART;VALUE=DATE:20270118\nRRULE:FREQ=YEARLY;COUNT=5;BYDAY=3MO;BYMONTH=1\nEND:VEVENT\n'
    + 'BEGIN:VEVENT\nUID:ny\nDTSTART;VALUE=DATE:20270101\nRRULE:FREQ=YEARLY;COUNT=3\nEND:VEVENT\n'
    + 'BEGIN:VEVENT\nUID:d\nDTSTART:20270104T080000Z\nRRULE:FREQ=DAILY;INTERVAL=2;BYDAY=MO,TU,WE,TH,FR;UNTIL=20270110T080000Z\nEND:VEVENT\nEND:VCALENDAR');
  const occ = I.expand(cal, at('2026-01-01'), at('2031-01-01'));
  assert.deepEqual(cal.events[0].unsupported, ['RRULE BYMONTH', 'RRULE BYDAY']);
  assert.deepEqual(occ.filter((o) => o.event.uid === 'mlk').map((o) => o.start), ['2027-01-18']);
  assert.deepEqual(occ.filter((o) => o.event.uid === 'ny').map((o) => o.start), ['2027-01-01', '2028-01-01', '2029-01-01']);
  // Every other day from Mon Jan 4, weekdays only, through Sun Jan 10: Jan 4, 6, 8.
  assert.deepEqual(occ.filter((o) => o.event.uid === 'd').map((o) => iso(o.start).slice(0, 10)), ['2027-01-04', '2027-01-06', '2027-01-08']);
});

test('expand keeps to the window, even for a rule with no end', () => {
  const cal = I.parse('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:w\nDTSTART:20000103T150000Z\nDTEND:20000103T160000Z\nRRULE:FREQ=WEEKLY\nEND:VEVENT\nEND:VCALENDAR');
  const occ = I.expand(cal, at('2026-10-12T00:00:00Z'), at('2026-10-26T00:00:00Z'));
  assert.deepEqual(occ.map((o) => iso(o.start)), ['2026-10-12T15:00:00Z', '2026-10-19T15:00:00Z']);
});

test('write: CRLF, escaping, folding at 75 octets without splitting characters, stable UIDs', () => {
  const now = at('2026-10-15T12:00:00Z');
  const long = 'Read chapters 4–6; bring notes, questions\\ideas. ' + 'Café ☕ 🧪 '.repeat(12);
  const out = I.write({ name: 'Glaze: To Do', events: [
    { uid: I.uid('localhost:3000', 'assignment', 183), summary: 'Essay, draft; final', description: long, start: at('2026-10-20T03:59:00Z'), end: at('2026-10-20T03:59:00Z'), url: 'https://canvas.example.edu/courses/1/assignments/183' },
    { uid: I.uid('class', 'BIO 1100', 'MWF'), summary: 'BIO 1100', location: 'Science Hall 214', start: '2026-08-24T09:00', end: '2026-08-24T09:50', rrule: { freq: 'WEEKLY', byday: ['MO', 'WE', 'FR'], until: '2026-12-11' } },
    { uid: 'exam-1@glaze', summary: 'Midterm\r\n1\u0007', start: '2026-09-25', end: '2026-09-26', url: 'javascript:alert(1)' },
  ] }, { now });
  assert.ok(out.endsWith('\r\n') && !/[^\r]\n/.test(out), 'CRLF only');
  for (const l of out.split('\r\n')) assert.ok(Buffer.byteLength(l) <= 75, `${Buffer.byteLength(l)} octets: ${l}`);
  assert.ok(!out.includes('�'));
  assert.match(out, /^UID:localhost%3A3000\/assignment\/183@glaze$/m);
  assert.match(out, /^SUMMARY:Essay\\, draft\\; final$/m);
  assert.match(out, /^DTSTART:20261020T035900Z$/m);
  assert.match(out, /^DTSTART:20260824T090000$/m);
  assert.match(out, /^RRULE:FREQ=WEEKLY;UNTIL=20261211T235959;BYDAY=MO,WE,FR$/m);
  assert.match(out, /^DTSTART;VALUE=DATE:20260925$/m);
  assert.match(out, /^SUMMARY:Midterm\\n1$/m);
  assert.doesNotMatch(out, /javascript:/);
  assert.equal(out.match(/^DTSTAMP:20261015T120000Z$/gm).length, 3);
  assert.equal(I.uid('localhost:3000', 'assignment', 183), I.uid('localhost:3000', 'assignment', 183));

  // Round trip: what Glaze writes, Glaze (and any reader) reads back the same.
  const back = I.parse(out, { tz: 'America/Chicago' });
  assert.equal(back.name, 'Glaze: To Do');
  assert.equal(back.events[0].description, long);
  assert.equal(back.events[0].summary, 'Essay, draft; final');
  assert.equal(back.events[0].url, 'https://canvas.example.edu/courses/1/assignments/183');
  const cls = I.expand(back, ...FALL).filter((o) => o.event.summary === 'BIO 1100');
  assert.equal(iso(cls[0].start), '2026-08-24T14:00:00Z', 'floating 9:00 read in Chicago');
  assert.equal(iso(cls.at(-1).start), '2026-12-11T15:00:00Z');
  assert.deepEqual([back.events[2].start, back.events[2].end, back.events[2].summary], ['2026-09-25', '2026-09-26', 'Midterm\n1']);
  assert.throws(() => I.write({ events: [{ summary: 'no uid', start: now }] }), RangeError);
});

// Regression tests from the S4 review. Each failed (or hung) on the first version of lib/ics.js.
const cal1 = (...lines) => ['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n');
const ev = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const NY = (local) => `DTSTART;TZID=America/New_York:${local}`;
const local = (ms) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'short' }).format(ms);

test('review: a huge INTERVAL is flagged instead of looping forever, and work is bounded', () => {
  const cal = I.parse(cal1(ev('UID:big', 'DTSTART:20261001T090000Z', 'RRULE:FREQ=MONTHLY;INTERVAL=2147483647;COUNT=2')));
  assert.ok(cal.events[0].unsupported.includes('RRULE INTERVAL'));
  assert.equal(I.expand(cal, at('2026-01-01'), at('2100-01-01')).length, 1);
  // A shared step budget cuts a long expansion short and says so.
  const daily = I.parse(cal1(ev('UID:d', 'DTSTART:20000101T090000Z', 'RRULE:FREQ=DAILY')));
  const occ = I.expand(daily, at('2026-01-01'), at('2027-01-01'), { limits: { steps: 100 } });
  assert.equal(occ.truncated, true);
  assert.equal(I.expand(daily, at('2026-01-01'), at('2026-01-03')).truncated, undefined);
  assert.throws(() => I.expand(daily, NaN, at('2026-01-01')), RangeError);
  assert.throws(() => I.expand(daily, at('2027-01-01'), at('2026-01-01')), RangeError);
  // Input caps: bytes, and events kept.
  assert.throws(() => I.parse('x'.repeat(100), { limits: { bytes: 50 } }), RangeError);
  const three = I.parse(cal1(ev('UID:1', 'DTSTART:20261001'), ev('UID:2', 'DTSTART:20261002'), ev('UID:3', 'DTSTART:20261003')), { limits: { events: 2 } });
  assert.deepEqual([three.events.length, three.truncated], [2, true]);
});

test('review: generated times inside a DST gap are skipped and not counted', () => {
  // Sundays at 02:30 New York from March 1, 2026; March 8 has no 02:30.
  const cal = I.parse(cal1(ev('UID:g', NY('20260301T023000'), 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=3')));
  assert.deepEqual(I.expand(cal, at('2026-02-01'), at('2026-05-01')).map((o) => local(o.start)),
    ['2026-03-01 02:30', '2026-03-15 02:30', '2026-03-22 02:30']);
});

test('review: DTEND and hour durations are exact, day durations are nominal', () => {
  const two = I.parse(cal1(ev('UID:p', NY('20260308T013000'), 'DURATION:PT2H'))).events[0];
  assert.equal(two.end - two.start, 2 * 3600e3, 'PT2H is two elapsed hours across the gap');
  const day = I.parse(cal1(ev('UID:q', NY('20260307T120000'), 'DURATION:P1D'))).events[0];
  assert.equal(local(day.end), '2026-03-08 12:00', 'P1D is the same time next day');
  const wk = I.parse(cal1(ev('UID:w', NY('20260301T013000'), 'DTEND;TZID=America/New_York:20260301T033000', 'RRULE:FREQ=WEEKLY;COUNT=3')));
  assert.deepEqual(I.expand(wk, at('2026-02-01'), at('2026-05-01')).map((o) => (o.end - o.start) / 3600e3), [2, 2, 2]);
});

test('review: UNTIL keeps its full value and must match DTSTART; bad integers are refused', () => {
  const daily = (start, until) => I.write({ events: [{ uid: 'u', start, rrule: { freq: 'DAILY', until } }] }, { now: 0 });
  assert.match(daily('2026-09-28T09:00', '2026-10-02T08:00'), /^RRULE:FREQ=DAILY;UNTIL=20261002T080000$/m);
  const back = I.parse(daily('2026-09-28T09:00', '2026-10-02T08:00'), { tz: 'UTC' });
  assert.equal(I.expand(back, at('2026-09-01'), at('2026-11-01')).length, 4, 'Sep 28 to Oct 1, not Oct 2');
  assert.match(daily('2026-09-28', '2026-10-02'), /UNTIL=20261002$/m);
  assert.match(daily(at('2026-09-28T09:00:00Z'), at('2026-10-02T09:00:00Z')), /UNTIL=20261002T090000Z$/m);
  assert.throws(() => daily('2026-09-28', at('2026-10-02T00:00:00Z')), RangeError);
  assert.throws(() => daily('2026-09-28T09:00', at('2026-10-02T00:00:00Z')), RangeError);
  assert.throws(() => daily(at('2026-09-28T09:00:00Z'), '2026-10-02'), RangeError);
  const counted = (count, interval) => I.write({ events: [{ uid: 'u', start: '2026-09-28', rrule: { freq: 'DAILY', count, interval } }] }, { now: 0 });
  assert.match(counted(2 ** 32 + 1), /COUNT=4294967297$/m, 'no 32-bit wrap');
  assert.throws(() => counted(0), RangeError);
  assert.throws(() => counted(3, 1.5), RangeError);
  assert.throws(() => I.write({ events: [{ uid: 'u', start: '2026-09-28', rrule: { freq: 'DAILY', byday: ['XX'] } }] }), RangeError);
});

test('review: impossible dates are refused, not moved to another day; DTEND has DTSTART\'s form and comes later', () => {
  const cal = I.parse(cal1(ev('UID:feb', 'DTSTART;VALUE=DATE:20260230'), ev('UID:hour', 'DTSTART:20261001T250000Z'), ev('UID:fine', 'DTSTART:20261001')));
  assert.deepEqual(cal.events.map((e) => e.uid), ['fine']);
  assert.deepEqual(cal.problems, [{ uid: 'feb', reason: 'impossible DTSTART' }, { uid: 'hour', reason: 'impossible DTSTART' }]);
  const w = (start, end) => I.write({ events: [{ uid: 'u', start, end }] }, { now: 0 });
  assert.throws(() => w('2026-02-30T09:00'), RangeError);
  assert.throws(() => w(1e100), RangeError);
  assert.throws(() => w(NaN), RangeError);
  assert.throws(() => w('2026-09-28', '2026-09-28T10:00'), RangeError);
  assert.throws(() => w(at('2026-09-28T10:00:00Z'), at('2026-09-28T09:00:00Z')), RangeError);
  assert.throws(() => w('2026-09-28', '2026-09-28'), RangeError);
  assert.doesNotMatch(w(at('2026-09-28T10:00:00Z'), at('2026-09-28T10:00:00Z')), /DTEND/, 'a deadline has no DTEND');
  assert.match(w('0099-01-05', '0099-01-06'), /DTSTART;VALUE=DATE:00990105/);
});

test('review: a TZID named like an object property falls back instead of crashing', () => {
  for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const cal = I.parse(cal1(ev('UID:z', `DTSTART;TZID=${id}:20261001T090000`)), { tz: 'Asia/Tokyo' });
    assert.deepEqual([cal.events[0].tz, iso(cal.events[0].start)], ['Asia/Tokyo', '2026-10-01T00:00:00Z'], id);
  }
});

test('review: RDATE adds occurrences; what is not followed is reported', () => {
  const cal = I.parse(cal1(
    ev('UID:r', 'DTSTART:20261001T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=2', 'RDATE:20261002T090000Z'),
    ev('UID:only', 'DTSTART;VALUE=DATE:20261005', 'RDATE;VALUE=DATE:20261007,20261009'),
    ev('UID:per', 'DTSTART:20261001T090000Z', 'RDATE;VALUE=PERIOD:20261003T090000Z/PT1H'),
    ev('UID:fut', 'DTSTART:20261003T090000Z', 'RECURRENCE-ID;RANGE=THISANDFUTURE:20261001T090000Z')));
  const occ = I.expand(cal, at('2026-09-01'), at('2026-12-01'));
  assert.deepEqual(occ.filter((o) => o.event.uid === 'r').map((o) => iso(o.start).slice(0, 10)), ['2026-10-01', '2026-10-02', '2026-10-08']);
  assert.deepEqual(occ.filter((o) => o.event.uid === 'only').map((o) => o.start), ['2026-10-05', '2026-10-07', '2026-10-09']);
  assert.deepEqual(cal.events.find((e) => e.uid === 'per').unsupported, ['RDATE PERIOD']);
  assert.deepEqual(cal.events.find((e) => e.uid === 'fut').unsupported, ['RANGE=THISANDFUTURE']);
  assert.deepEqual(cal.events[0].unsupported, []);
});

test('review: RDATE and EXDATE instants in the fall-back hour keep their identity', () => {
  // New York repeats 01:00–02:00 on Nov 1, 2026: 01:30 is 05:30Z (EDT) and again 06:30Z (EST).
  const occ = (...extra) => I.expand(I.parse(cal1(ev('UID:f', NY('20261101T000000'), 'DURATION:PT30M', ...extra))), at('2026-10-01'), at('2026-12-01'))
    .map((o) => `${iso(o.start).slice(11, 16)}-${iso(o.end).slice(11, 16)}`);
  assert.deepEqual(occ('RDATE:20261101T063000Z'), ['04:00-04:30', '06:30-07:00'], 'a UTC RDATE stays the second 01:30');
  assert.deepEqual(occ('RDATE;TZID=America/New_York:20261101T013000'), ['04:00-04:30', '05:30-06:00'], 'a local RDATE is the first 01:30');
  assert.deepEqual(occ('RDATE:20261101T063000Z', 'EXDATE:20261101T063000Z'), ['04:00-04:30']);
  assert.deepEqual(occ('RDATE:20261101T063000Z', 'EXDATE:20261101T053000Z'), ['04:00-04:30', '06:30-07:00'], 'the other 01:30 is not excluded');
  assert.deepEqual(occ('RDATE:20261101T063000Z', 'EXDATE;TZID=America/New_York:20261101T013000'), ['04:00-04:30', '06:30-07:00']);
  // A day-long RDATE in the fold ends at the same local time next day.
  const day = I.expand(I.parse(cal1(ev('UID:d', NY('20261031T013000'), 'DURATION:P1D', 'RDATE:20261101T063000Z'))), at('2026-10-01'), at('2026-12-01'));
  assert.deepEqual(day.map((o) => [iso(o.start), iso(o.end)]).at(-1), ['2026-11-01T06:30:00Z', '2026-11-02T06:30:00Z']);
  // A rule-generated 01:30 in the fold is the first one; EXDATE removes it only by that instant.
  const weekly = (...extra) => I.expand(I.parse(cal1(ev('UID:w', NY('20261025T013000'), 'RRULE:FREQ=WEEKLY;COUNT=3', ...extra))), at('2026-10-01'), at('2026-12-01')).map((o) => iso(o.start));
  assert.ok(weekly().includes('2026-11-01T05:30:00Z'));
  assert.ok(!weekly('EXDATE;TZID=America/New_York:20261101T013000').includes('2026-11-01T05:30:00Z'));
  assert.ok(weekly('EXDATE:20261101T063000Z').includes('2026-11-01T05:30:00Z'));
});

test('review: generated UIDs keep different items apart; supplied UIDs are TEXT-escaped both ways', () => {
  assert.notEqual(I.uid('class', 'BIO 1100', 'MWF'), I.uid('class', 'BIO_1100', 'MWF'));
  assert.notEqual(I.uid('a-b', 'c'), I.uid('a', 'b-c'));
  assert.notEqual(I.uid('a/b', 'c'), I.uid('a', 'b/c'));
  assert.equal(I.parse(cal1(ev('UID:a\\,b', 'DTSTART:20261001'))).events[0].uid, 'a,b');
  const out = I.write({ events: [{ uid: 'a,b;c\\d', start: '2026-10-01' }] }, { now: 0 });
  assert.match(out, /^UID:a\\,b\\;c\\\\d$/m);
  assert.equal(I.parse(out).events[0].uid, 'a,b;c\\d');
});
