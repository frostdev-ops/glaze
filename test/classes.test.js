// Class schedule import (lib/classes.js): the meeting-time reader, whole registrar documents in the formats students copy
// or save (Banner, PeopleSoft, Workday, plain lists, timetables in Glaze's other languages), .ics calendars, matching to
// Canvas courses, what's kept and the worker's writes, and the classes on a day, as reminders and as an export.
// Every sample here was written for this test in the shape of a real system's output; none is a real student's.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/classes.js');
const T = require('../lib/todo.js');
const I = require('../lib/ics.js');
const D = require('../lib/doctext.js');

const NOW = Date.UTC(2026, 9, 15, 15); // Thu 15 Oct 2026
const m = (line, opts) => C.meetings(line, opts).map((x) => [x.days.join(''), C.hhmm(x.start), C.hhmm(x.end), ...(x.unsure.length ? [x.unsure.join()] : [])]);

test('meetings: one line, the usual registrar ways of writing days and times', () => {
  const cases = [
    ['MWF 9:00–9:50 AM', [['135', '09:00', '09:50']]],
    ['TR 1:30-2:45pm', [['24', '13:30', '14:45']]],
    ['TTh 11:00–12:15pm', [['24', '11:00', '12:15']]], // starts in the morning
    ['MoWeFr 10:00AM - 10:50AM', [['135', '10:00', '10:50']]],
    ['MW 08:00 AM - 08:50 AM', [['13', '08:00', '08:50']]],
    ['F 01:00PM-03:50PM', [['5', '13:00', '15:50']]],
    ['TuTh 3:30PM - 4:45PM', [['24', '15:30', '16:45']]],
    ['M/W/F 8-8:50am', [['135', '08:00', '08:50']]],
    ['M-W-F 9:00-9:50', [['135', '09:00', '09:50']]],
    ['Mon–Fri 9:00-10:00', [['12345', '09:00', '10:00']]],
    ['T R 12:30-1:45', [['24', '12:30', '13:45']]],
    ['Tuesday/Thursday 6:00-7:15 PM', [['24', '18:00', '19:15']]],
    ['Mondays 1–3pm and Wednesdays 10–11am', [['1', '13:00', '15:00'], ['3', '10:00', '11:00']]],
    ['9:00-9:50 MWF, 13:00-14:00 TR', [['135', '09:00', '09:50'], ['24', '13:00', '14:00']]],
    ['TR 9:30–10:45 and 11:00–12:15', [['24', '09:30', '10:45'], ['24', '11:00', '12:15']]],
    ['M 6-8:50pm', [['1', '18:00', '20:50']]],
    ['W 18:00–20:45', [['3', '18:00', '20:45']]],
    ['Sat 10am to noon', [['6', '10:00', '12:00']]],
    ['TR 2pm', [['24', '14:00', '15:15', 'end']]], // no end: a guess, marked
    ['MWF 7:00-7:50', [['135', '07:00', '07:50', 'time']]], // morning or evening: marked
    ['9:00 am - 9:50 am\tMWF\tScience Bldg 210', [['135', '09:00', '09:50']]],
    ['Lab\t2:00 pm - 4:50 pm\tR\tChem 220', [['4', '14:00', '16:50']]], // a lone letter as its own cell
  ];
  for (const [line, want] of cases) assert.deepEqual(m(line), want, line);
});

test('meetings: other languages, 24-hour clocks and their separators', () => {
  const cases = [
    ['Mo 10:15–11:45 Analysis I', 'de', [['1', '10:15', '11:45']]],
    ['Di 08:00-09:30', 'de', [['2', '08:00', '09:30']]],
    ['Mittwoch 14:00 - 15:30 Uhr', 'en', [['3', '14:00', '15:30']]],
    ['Mo bis Fr 10–12 Uhr', 'de', [['12345', '10:00', '12:00']]],
    ['lundi 14h–15h30', 'en', [['1', '14:00', '15:30']]],
    ['Mardi et jeudi de 8h30 à 10h', 'fr', [['24', '08:30', '10:00']]],
    ['Lunes y miércoles 9:00-10:30 Cálculo I (Aula 3.2)', 'en', [['13', '09:00', '10:30']]],
    ['L-V 9:00-10:30', 'es', [['12345', '09:00', '10:30']]],
    ['L, X 11:00 a 12:30', 'es', [['13', '11:00', '12:30']]],
    ['ma 13.45-15.30 Statistiek, zaal 2.14', 'nl', [['1', '13:45', '15:30']]],
    ['di en do 9:00-10:45', 'nl', [['24', '09:00', '10:45']]],
    ['ma t/m vr 9:00-10:00', 'nl', [['12345', '09:00', '10:00']]],
    ['Segunda e quarta 19:00–20:40 Cálculo I, sala 204', 'en', [['13', '19:00', '20:40']]],
    ['ter. e qui. das 10h às 11h40', 'pt', [['24', '10:00', '11:40']]],
  ];
  for (const [line, hint, want] of cases) assert.deepEqual(m(line, { hint }), want, line);
});

test('meetings: what is not a meeting', () => {
  for (const line of [
    'Room 101-105, see pages 9-10', 'MATH 1210 Calculus I', 'Due 10/16 at 11:59pm', 'Credits: 4.000', 'Phone 555-1234',
    'Read chapters 3-4 before Monday', 'Final grades posted Dec 18', 'Section 002 · 3 credits', 'Sat',
  ]) assert.deepEqual(m(line), [], line);
});

// ---- whole documents ----------------------------------------------------------------------------------------------
const summary = (r) => r.entries.map((e) => [e.code, e.name, e.periods.map((p) => [p.days.join(''), C.hhmm(p.start), C.hhmm(p.end), p.loc, p.from, p.to])]);

test('Banner "Student Detail Schedule", copied from the page', () => {
  const text = `Student Detail Schedule
Fall 2026
Total Credit Hours: 7.000

Calculus I - MATH 1210 - 002
Associated Term:	Fall 2026
CRN:	40213
Status:	**Web Registered** on Jul 14, 2026
Assigned Instructor:	Jane Doe
Credits:	4.000
Scheduled Meeting Times
Type	Time	Days	Where	Date Range	Schedule Type	Instructors
Class	9:00 am - 9:50 am	MWF	Science Bldg 210	Aug 24, 2026 - Dec 11, 2026	Lecture	Jane Doe (P)
Class	2:00 pm - 2:50 pm	R	Science Bldg 118	Aug 24, 2026 - Dec 11, 2026	Recitation	Sam Lee

Intro to Psychology - PSYC 1010 - 001
Associated Term:	Fall 2026
CRN:	40877
Scheduled Meeting Times
Type	Time	Days	Where	Date Range	Schedule Type	Instructors
Class	11:00 am - 12:15 pm	TR	Behavioral Sci 105	Aug 24, 2026 - Dec 11, 2026	Lecture	Ann Kim (P)
`;
  const r = C.fromText(text, { now: NOW });
  assert.deepEqual(summary(r), [
    ['MATH 1210', 'Calculus I', [['135', '09:00', '09:50', 'Science Bldg 210', '2026-08-24', '2026-12-11'], ['4', '14:00', '14:50', 'Science Bldg 118', '2026-08-24', '2026-12-11']]],
    ['PSYC 1010', 'Intro to Psychology', [['24', '11:00', '12:15', 'Behavioral Sci 105', '2026-08-24', '2026-12-11']]],
  ]);
  assert.ok(r.entries.every((e) => e.periods.every((p) => !p.unsure.length || p.unsure.join() === 'label')));
});

test('PeopleSoft "My Class Schedule" list view, with a holiday list under it', () => {
  const text = `CHEM 101 - General Chemistry
Status	Units	Grading	Grade	Deadlines
Enrolled	4.00	Graded
Class Nbr	Section	Component	Days & Times	Room	Instructor	Start/End Date
1234	001	Lecture	MoWeFr 10:00AM - 10:50AM	Chem Bldg 100	R. Smith	08/24/2026 - 12/11/2026
1235	L01	Laboratory	Th 2:00PM - 4:50PM	Chem Bldg 220	Staff	08/24/2026 - 12/11/2026

ENGL 102 - Composition II
Class Nbr	Section	Component	Days & Times	Room	Instructor	Start/End Date
2210	014	Lecture	TuTh 9:30AM - 10:45AM	Humanities 304	M. Jones	08/24/2026 - 12/11/2026

Academic calendar
Labor Day (no classes): 09/07/2026
Thanksgiving break: 11/25/2026 - 11/27/2026
`;
  const r = C.fromText(text, { now: NOW });
  assert.deepEqual(summary(r), [
    ['CHEM 101', 'General Chemistry', [['135', '10:00', '10:50', 'Chem Bldg 100', '2026-08-24', '2026-12-11'], ['4', '14:00', '16:50', 'Chem Bldg 220', '2026-08-24', '2026-12-11']]],
    ['ENGL 102', 'Composition II', [['24', '09:30', '10:45', 'Humanities 304', '2026-08-24', '2026-12-11']]],
  ]);
  assert.deepEqual(r.skip, ['2026-09-07', '2026-11-25', '2026-11-26', '2026-11-27']);
  // Each period keeps only the skipped days it meets on.
  assert.deepEqual(r.entries[0].periods[0].skip, ['2026-09-07', '2026-11-25', '2026-11-27']);
  assert.deepEqual(r.entries[0].periods[1].skip, ['2026-11-26']);
  assert.deepEqual(r.entries[1].periods[0].skip, ['2026-11-26']);
});

test('Workday-style rows with pipes, and a plain list typed by hand', () => {
  const workday = `My Enrolled Courses
CS 101 - Intro to Programming | MWF | 10:00 AM - 10:50 AM | Engineering Hall 105
CS 101 - Intro to Programming | F | 1:00 PM - 2:50 PM | Engineering Hall 220
HIST 2010 - World History | TR | 12:30 PM - 1:45 PM | Online
Term: 08/24/2026 - 12/11/2026`;
  const r = C.fromText(workday, { now: NOW });
  assert.deepEqual(summary(r), [
    ['CS 101', 'Intro to Programming', [['135', '10:00', '10:50', 'Engineering Hall 105', '2026-08-24', '2026-12-11'], ['5', '13:00', '14:50', 'Engineering Hall 220', '2026-08-24', '2026-12-11']]],
    ['HIST 2010', 'World History', [['24', '12:30', '13:45', 'Online', '2026-08-24', '2026-12-11']]],
  ]);
  const list = `My classes this fall (Aug 24 – Dec 11)
BIO 1100 Biology   TR 1:30-2:45pm   Life Sciences 120
MATH 1350 Statistics   MWF 8-8:50am   Room 204
Spanish conversation club, Wednesdays 5-6pm, Student Union`;
  const s = C.fromText(list, { now: NOW });
  assert.deepEqual(summary(s), [
    ['BIO 1100', 'Biology', [['24', '13:30', '14:45', 'Life Sciences 120', '2026-08-24', '2026-12-11']]],
    ['MATH 1350', 'Statistics', [['135', '08:00', '08:50', 'Room 204', '2026-08-24', '2026-12-11']]],
    ['', 'Spanish conversation club', [['3', '17:00', '18:00', 'Student Union', '2026-08-24', '2026-12-11']]],
  ]);
  // A room read only from where it stands is marked for checking.
  assert.deepEqual(s.entries[0].periods[0].unsure, ['loc']);
  assert.deepEqual(s.entries[1].periods[0].unsure, []);
});

test('timetables in German, Spanish, French, Dutch and Portuguese', () => {
  const de = `Stundenplan Wintersemester 2026/27
Vorlesungszeit: 19.10.2026 – 12.02.2027
Montag 08:00 - 09:30 Lineare Algebra (Raum 0.234)
Mittwoch 10:15 - 11:45 Lineare Algebra (Raum 0.234)
Do 14:00–15:30 Analysis I, Hörsaal H1
Weihnachtsferien: 21.12.2026 – 06.01.2027`;
  const r = C.fromText(de, { now: NOW, lang: 'de' });
  assert.equal(r.lang, 'de');
  assert.deepEqual(summary(r), [
    ['', 'Lineare Algebra', [['1', '08:00', '09:30', 'Raum 0.234', '2026-10-19', '2027-02-12'], ['3', '10:15', '11:45', 'Raum 0.234', '2026-10-19', '2027-02-12']]],
    ['', 'Analysis I', [['4', '14:00', '15:30', 'Hörsaal H1', '2026-10-19', '2027-02-12']]],
  ]);
  assert.equal(r.skip.length, 17);

  const es = `Horario primer cuatrimestre
Lunes y miércoles 9:00-10:30 Cálculo I (Aula 3.2)
Martes 11:00 a 13:00 Física General, Aula Magna
Clases del 7 de septiembre de 2026 al 18 de diciembre de 2026`;
  assert.deepEqual(summary(C.fromText(es, { now: NOW })), [
    ['', 'Cálculo I', [['13', '09:00', '10:30', 'Aula 3.2', '2026-09-07', '2026-12-18']]],
    ['', 'Física General', [['2', '11:00', '13:00', 'Aula Magna', '2026-09-07', '2026-12-18']]],
  ]);

  const fr = `Emploi du temps — semestre 1
Lundi 14h00–15h30 : Algorithmique, salle B204
Mardi et jeudi de 8h30 à 10h : Probabilités, amphi A
Vacances de la Toussaint : 19/10/2026 – 30/10/2026`;
  const f = C.fromText(fr, { now: NOW });
  assert.deepEqual(summary(f).map(([c, n, p]) => [n, p.map((x) => x.slice(0, 4))]), [
    ['Algorithmique', [['1', '14:00', '15:30', 'salle B204']]],
    ['Probabilités', [['24', '08:30', '10:00', 'amphi A']]],
  ]);
  assert.equal(f.skip[0], '2026-10-19');

  const nl = `Rooster blok 2
ma 13:45-15:30 Statistiek, zaal 2.14
di en do 9:00-10:45 Inleiding Recht, lokaal C1.03`;
  assert.deepEqual(summary(C.fromText(nl, { now: NOW, lang: 'nl' })).map(([c, n, p]) => [n, p.map((x) => x.slice(0, 4))]), [
    ['Statistiek', [['1', '13:45', '15:30', 'zaal 2.14']]],
    ['Inleiding Recht', [['24', '09:00', '10:45', 'lokaal C1.03']]],
  ]);

  const pt = `Grade horária 2026.2
Segunda e quarta 19:00–20:40 Cálculo I, sala 204
Sexta-feira 08:00 às 09:40 Introdução à Programação, Laboratório 3`;
  assert.deepEqual(summary(C.fromText(pt, { now: NOW })).map(([c, n, p]) => [n, p.map((x) => x.slice(0, 3))]), [
    ['Cálculo I', [['13', '19:00', '20:40']]],
    ['Introdução à Programação', [['5', '08:00', '09:40']]],
  ]);
});

test('one-off lines, office hours and holidays are not classes', () => {
  const text = `PHYS 2210 Physics II   MWF 11:00-11:50am   Room 140
Office hours: Tuesdays 2-3pm, Room 312
Midterm exam: Tue, Oct 20, 2026 7:00-9:00pm
Spring break (no classes) Mar 9-13`;
  const r = C.fromText(text, { now: NOW });
  assert.deepEqual(summary(r), [['PHYS 2210', 'Physics II', [['135', '11:00', '11:50', 'Room 140', '', '']]]]);
  assert.equal(r.ignored, 2);
  assert.deepEqual(r.skip, ['2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12', '2027-03-13']);
});

test('dates: years taken from the other end of a range, or nearest today', () => {
  const r = C.fromText('Spring term: Jan 12 – May 1\nECON 201 Microeconomics MW 3:30-4:45pm', { now: NOW });
  assert.deepEqual([r.term.from, r.term.to], ['2027-01-12', '2027-05-01']);
  const d = C.fromText('Semester: 14.09.2026 bis 05.02.2027\nMo 10:15–11:45 Analysis I', { now: NOW, lang: 'de' });
  assert.deepEqual([d.term.from, d.term.to], ['2026-09-14', '2027-02-05']);
  // Month first with "/" in English, day first elsewhere; a part over 12 settles it either way.
  assert.equal(C.fromText('Dates 09/14/2026 - 12/18/2026\nMWF 9-9:50am Chem', { now: NOW }).term.from, '2026-09-14');
  assert.equal(C.fromText('Dates 14/09/2026 - 18/12/2026\nL-V 9:00-10:00 Química', { now: NOW, lang: 'es' }).term.from, '2026-09-14');
  assert.equal(C.fromText('Classes begin: September 8, 2026\nClasses end: December 18, 2026\nMWF 9-9:50am Chem 1', { now: NOW }).term.to, '2026-12-18');
});

test('HTML and Word files go through lib/doctext.js to the same reader', async () => {
  const html = `<html><head><title>Schedule</title><style>td{}</style></head><body><nav>Home</nav>
<h2>BIO 1100 - Biology</h2><table><tr><th>Days</th><th>Time</th><th>Location</th></tr>
<tr><td>TR</td><td>1:30 pm - 2:45 pm</td><td>Life Sciences 120</td></tr></table>
<h2>ENG 1100 - Writing</h2><table><tr><th>Days</th><th>Time</th><th>Location</th></tr>
<tr><td>MWF</td><td>10:00 am - 10:50 am</td><td>Humanities 210</td></tr></table></body></html>`;
  assert.deepEqual(summary(C.fromText(D.html(html), { now: NOW })), [
    ['BIO 1100', 'Biology', [['24', '13:30', '14:45', 'Life Sciences 120', '', '']]],
    ['ENG 1100', 'Writing', [['135', '10:00', '10:50', 'Humanities 210', '', '']]],
  ]);
  // A minimal Word document: one table, as Word writes rows and cells.
  const Z = require('../lib/zip.js');
  const cell = (s) => `<w:tc><w:p><w:r><w:t>${s}</w:t></w:r></w:p></w:tc>`;
  const row = (...cs) => `<w:tr>${cs.map(cell).join('')}</w:tr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Fall 2026 schedule (Aug 24, 2026 - Dec 11, 2026)</w:t></w:r></w:p>
<w:tbl>${row('Course', 'Days', 'Time', 'Room')}${row('HIST 2010 World History', 'TR', '12:30 PM - 1:45 PM', 'Online')}${row('MATH 1350 Statistics', 'MWF', '8:00 AM - 8:50 AM', 'Room 204')}</w:tbl></w:body></w:document>`;
  const text = await D.docx(new Uint8Array(Buffer.concat(Z.zip([{ name: 'word/document.xml', data: new TextEncoder().encode(doc) }]))));
  assert.deepEqual(summary(C.fromText(text, { now: NOW })), [
    ['HIST 2010', 'World History', [['24', '12:30', '13:45', 'Online', '2026-08-24', '2026-12-11']]],
    ['MATH 1350', 'Statistics', [['135', '08:00', '08:50', 'Room 204', '2026-08-24', '2026-12-11']]],
  ]);
});

// ---- .ics -----------------------------------------------------------------------------------------------------------
const ICS = (body, extra = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n${extra}${body}END:VCALENDAR\r\n`;
const VEV = (p) => `BEGIN:VEVENT\r\n${Object.entries(p).map(([k, v]) => `${k}:${v}`).join('\r\n')}\r\nEND:VEVENT\r\n`;

test('.ics: weekly classes, a moved and a cancelled meeting, in the student\'s zone', () => {
  const text = ICS(
    VEV({ UID: 'a@x', SUMMARY: 'MATH 1210 Calculus I', 'DTSTART;TZID=America/New_York': '20260824T090000', 'DTEND;TZID=America/New_York': '20260824T095000',
      RRULE: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261211T235959Z', 'EXDATE;TZID=America/New_York': '20260907T090000', LOCATION: 'Science Bldg 210' })
    + VEV({ UID: 'b@x', SUMMARY: 'PSYC 1010', 'DTSTART;TZID=America/New_York': '20260825T110000', 'DTEND;TZID=America/New_York': '20260825T121500', RRULE: 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=30' })
    + VEV({ UID: 'c@x', SUMMARY: 'MATH 1210 Midterm', DTSTART: '20261020T230000Z', DTEND: '20261021T010000Z' })
    + VEV({ UID: 'd@x', SUMMARY: 'Reading day', 'DTSTART;VALUE=DATE': '20261204', 'DTEND;VALUE=DATE': '20261205' }),
  );
  const r = C.fromIcs(text, { now: NOW, tz: 'America/New_York' });
  assert.deepEqual(summary(r), [
    ['MATH 1210', 'Calculus I', [['135', '09:00', '09:50', 'Science Bldg 210', '2026-08-24', '2026-12-11']]],
    ['PSYC 1010', 'PSYC 1010', [['24', '11:00', '12:15', '', '2026-08-25', '2026-12-03']]], // 30 meetings
  ]);
  assert.deepEqual(r.entries[0].periods[0].skip, ['2026-09-07']);
  assert.equal(r.ignored, 1); // the midterm; the all-day day off isn't a class at all
  // The same calendar read by a student in Chicago: an hour earlier on their clock.
  const chi = C.fromIcs(text, { now: NOW, tz: 'America/Chicago' });
  assert.equal(C.hhmm(chi.entries[0].periods[0].start), '08:00');
});

test('.ics: an export of separate events (no RRULE) still makes weekly periods; an open-ended rule has no end', () => {
  const ev = [];
  for (const d of ['20260901', '20260903', '20260908', '20260910', '20260915', '20260917']) ev.push(VEV({ UID: `s${d}@x`, SUMMARY: 'Organic Chemistry', DTSTART: `${d}T130000`, DTEND: `${d}T141500`, LOCATION: 'Chem 101' }));
  ev.push(VEV({ UID: 'open@x', SUMMARY: 'Choir', DTSTART: '20260902T180000', DTEND: '20260902T193000', RRULE: 'FREQ=WEEKLY' }));
  const r = C.fromIcs(ICS(ev.join(''), 'X-WR-TIMEZONE:Europe/Berlin\r\n'), { now: NOW, tz: 'Europe/Berlin' });
  assert.deepEqual(summary(r), [
    ['', 'Organic Chemistry', [['24', '13:00', '14:15', 'Chem 101', '2026-09-01', '2026-09-17']]],
    ['', 'Choir', [['3', '18:00', '19:30', '', '2026-09-02', '']]],
  ]);
});

test('.ics: the real Canvas feed fixture holds deadlines and one-off events, not classes', () => {
  const feed = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures/ics/canvas-feed.ics'));
  const r = C.fromIcs(feed, { now: Date.UTC(2026, 9, 15), tz: 'America/Denver' });
  assert.ok(Array.isArray(r.entries));
  for (const e of r.entries) for (const p of e.periods) assert.ok(p.end > p.start);
});

// ---- matching -------------------------------------------------------------------------------------------------------
test('matching a schedule entry to a Canvas course: code first, then name', () => {
  const courses = [
    { id: '11', name: 'Biology: Cells and Life', course_code: 'BIO-1100-01' },
    { id: '12', name: 'Writing Seminar', course_code: 'ENG 1100' },
    { id: '13', name: 'Statistics for Science', course_code: 'MATH1350' },
    { id: '14', name: 'World History', course_code: 'HIST 2010' },
    { id: '15', name: 'History of Art', course_code: 'ARTH 2010' },
  ];
  assert.equal(C.match({ code: 'BIO 1100', name: 'Biology' }, courses), '11');
  assert.equal(C.match({ code: 'MATH 1350', name: 'Stats' }, courses), '13');
  assert.equal(C.match({ code: '', name: 'World History' }, courses), '14');
  assert.equal(C.match({ code: '', name: 'Writing seminar' }, courses), '12');
  assert.equal(C.match({ code: '', name: 'History' }, courses), '', 'two courses share the word: no guess');
  assert.equal(C.match({ code: 'CHEM 101', name: 'Chemistry' }, courses), '');
  assert.equal(C.match({ code: '', name: '?' }, courses), '');
});

// ---- kept data and the worker's writes -------------------------------------------------------------------------------
const KEY = C.storeKey('https://canvas.test', '3');
const area = (box = {}) => ({ box, local: { get: async (ks) => Object.fromEntries(ks.filter((k) => k in box).map((k) => [k, structuredClone(box[k])])), set: async (p) => { Object.assign(box, structuredClone(p)); return true; }, remove: async (ks) => { for (const k of ks) delete box[k]; return true; } } });
const P = (days, start, end, more = {}) => ({ days, start, end, loc: '', from: '', to: '', skip: [], ...more });

test('clean: what is kept is checked, whatever is stored', () => {
  const raw = { courses: [
    { id: '11', code: 'BIO 1100', name: 'Biology', periods: [P([4, 2, 2, 9], 810, 885, { from: '2026-12-11', to: '2026-08-24', skip: ['2026-02-30', '2026-11-26', 'x'], loc: 'Room\u0000 1' }), P([1], 900, 800), P([], 1, 2)] },
    { id: '11', code: 'dupe', periods: [P([1], 1, 2)] },
    { id: 'o-choir', name: 'Choir', periods: [P([3], 1080, 1170)] },
    { id: 'bad id', periods: [P([1], 1, 2)] },
    { id: '12', periods: [] },
  ] };
  assert.deepEqual(C.clean(raw), { courses: [
    { id: '11', code: 'BIO 1100', name: 'Biology', periods: [{ days: [2, 4], start: 810, end: 885, loc: 'Room  1', from: '2026-08-24', to: '2026-12-11', skip: ['2026-11-26'] }] },
    { id: 'o-choir', code: '', name: 'Choir', periods: [{ days: [3], start: 1080, end: 1170, loc: '', from: '', to: '', skip: [] }] },
  ] });
  assert.deepEqual(C.clean(null), { courses: [] });
  assert.deepEqual(C.clean({ courses: 'x' }), { courses: [] });
  assert.equal(C.otherId('Spanish Conversation Club!'), 'o-spanish-conversation-club');
});

test('the worker\'s writes: add joins periods, put replaces a course, drop and clear remove', async () => {
  const a = area();
  const bio = { id: '11', code: 'BIO 1100', name: 'Biology', periods: [P([2, 4], 810, 885)] };
  assert.equal((await C.change({ key: KEY, op: 'add', courses: [bio] }, a)).ok, true);
  // The same period again is kept once; a new one joins it.
  await C.change({ key: KEY, op: 'add', courses: [{ ...bio, periods: [P([2, 4], 810, 885), P([5], 600, 650)] }] }, a);
  assert.equal(a.box[KEY].courses[0].periods.length, 2);
  await C.change({ key: KEY, op: 'put', courses: [{ ...bio, periods: [P([1], 480, 530)] }] }, a);
  assert.deepEqual(a.box[KEY].courses[0].periods.map((p) => p.days), [[1]]);
  await C.change({ key: KEY, op: 'add', courses: [{ id: 'o-choir', name: 'Choir', periods: [P([3], 1080, 1170)] }] }, a);
  await C.change({ key: KEY, op: 'drop', id: '11' }, a);
  assert.deepEqual(a.box[KEY].courses.map((c) => c.id), ['o-choir']);
  const r = await C.change({ key: KEY, op: 'clear' }, a);
  assert.deepEqual([r.ok, KEY in a.box], [true, false]);
  assert.deepEqual(await C.change({ key: 'classes:https://canvas.test/abc', op: 'clear' }, a), { ok: false, error: 'bad' });
  assert.deepEqual(await C.change({ key: KEY, op: 'nuke' }, a), { ok: false, error: 'bad' });
  const failing = area();
  failing.local.set = async () => false;
  assert.deepEqual(await C.change({ key: KEY, op: 'add', courses: [bio] }, failing), { ok: false, error: 'write' });
});

test('the worker allows a page its own site\'s schedules only', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/background.js'), 'utf8');
  assert.match(src, /classes: \{\s*allow: async \(m, s\) => typeof m\.key === 'string' && GZ_CLASSES\.STORE_KEY\.test\(m\.key\) && m\.key\.startsWith\(`classes:\$\{await fromCanvas\(s\)\}\/`\)/);
  assert.match(src, /importScripts\([^)]*'classes\.js'/);
  for (const f of ['lib/classes.js', 'features/classes.js', 'lib/ics.js', 'lib/doctext.js']) assert.ok(src.includes(`'${f}'`), `LOADABLE: ${f}`);
});

// ---- using it ---------------------------------------------------------------------------------------------------------
const STORE = { courses: [
  { id: '11', code: 'BIO 1100', name: 'Biology', periods: [{ days: [2, 4], start: 810, end: 885, loc: 'Life Sciences 120', from: '2026-08-24', to: '2026-12-11', skip: ['2026-11-26'] }] },
  { id: 'o-choir', code: '', name: 'Choir', periods: [{ days: [4], start: 1080, end: 1170, loc: '', from: '', to: '', skip: [] }] },
] };

test('the classes on a day: in term, on its weekdays, not on a skipped date', () => {
  const day = (k) => C.onDay(STORE, C.dayNum(k)).map((x) => [x.name, C.hhmm(x.start)]);
  assert.deepEqual(day('2026-10-15'), [['Biology', '13:30'], ['Choir', '18:00']]); // a Thursday
  assert.deepEqual(day('2026-10-14'), []);
  assert.deepEqual(day('2026-11-26'), [['Choir', '18:00']]);
  assert.deepEqual(day('2026-12-17'), [['Choir', '18:00']]); // after BIO's term
  assert.equal(C.weekday(C.dayNum('2026-10-15')), 4);
});

test('class-start reminders: lead minutes before, in the student\'s zone, in lib/remind.js\'s shape', () => {
  const R = require('../lib/remind.js');
  const tz = 'America/New_York';
  const now = Date.UTC(2026, 9, 15, 12); // 8:00 in New York
  const evs = C.events(STORE, { now, tz, lead: 15 });
  const bio = evs.find((e) => e.key === 'class:11.0' && e.end === T.typed('2026-10-15', '13:30', tz));
  assert.ok(bio);
  assert.equal(bio.at, bio.end - 15 * 6e4);
  assert.equal(bio.url, '/courses/11');
  assert.equal(bio.course, 'Life Sciences 120');
  assert.equal(evs.find((e) => e.key === 'class:o-choir.0').url, '');
  // They pass through lib/remind.js as its own categories do, and its store accepts their ids.
  const shown = R.events({ rows: [], cats: {}, o: {}, tz, extra: evs });
  assert.ok(shown.some((e) => e.cat === 'class' && e.key === 'class:11.0'));
  assert.ok(R.clean({ mute: { 'class:o-choir.0': now }, seen: { [`class:11.0@${bio.at}`]: now } }, now).mute['class:o-choir.0']);
  assert.ok(R.clean({ seen: { [`class:11.0@${bio.at}`]: now } }, now).seen[`class:11.0@${bio.at}`]);
});

test('the export hook: one floating-time event per meeting, written by lib/ics.js', () => {
  const evs = C.icsEvents(STORE, { site: 'canvas.test', from: '2026-10-12', to: '2026-10-18' });
  assert.deepEqual(evs.map((e) => [e.start, e.end, e.summary]), [
    ['2026-10-13T13:30', '2026-10-13T14:45', 'BIO 1100 Biology'], ['2026-10-15T13:30', '2026-10-15T14:45', 'BIO 1100 Biology'], ['2026-10-15T18:00', '2026-10-15T19:30', 'Choir'],
  ]);
  const text = I.write({ name: 'Classes', events: evs }, { now: NOW });
  assert.match(text, /DTSTART:20261013T133000\r\n/);
  assert.equal(new Set(evs.map((e) => e.uid)).size, 3);
  assert.deepEqual(C.icsEvents(STORE, { site: 'x', from: '2026-10-12', to: '2026-10-18' }).map((e) => e.uid), C.icsEvents(STORE, { site: 'x', from: '2026-10-12', to: '2026-10-18' }).map((e) => e.uid), 'stable');
});
