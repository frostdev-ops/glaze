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
  assert.deepEqual(lec.rrule, { freq: 'WEEKLY', interval: 1, count: null, until: at('2026-12-12T04:59:59Z'), byday: ['FR', 'MO', 'WE'], wkst: 'SU', unsupported: false });
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
  assert.equal(cal.events[0].rrule.unsupported, true);
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
  assert.match(out, /^UID:localhost_3000-assignment-183@glaze$/m);
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
