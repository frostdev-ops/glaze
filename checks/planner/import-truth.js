// What the import fixtures (test/fixtures/import, scripts/import-fixtures.js) say, and how much of it an import flow's
// extractor got exactly right from a text: the share of known fields, for test/import.test.js (node) and
// scripts/import-check.js (the browser). → { ok, of, extra }, extra being what it found that isn't there.
const C = require('../lib/classes.js');
globalThis.GZ_CLASSES = C; // lib/syllabus.js reads class times with it
const S = require('../lib/syllabus.js');
const G = require('../lib/gpa.js');

// Class schedule: per class, its meeting (days, start, end) and its place. Extra classes are counted apart.
const TIMETABLE = [['BIO 1100', '135', '09:00', '09:50', 'Science Hall 120'], ['BIO 1100L', '2', '14:00', '16:50', 'Science Hall 214'],
  ['ENG 1100', '24', '11:00', '12:15', 'Humanities 302'], ['MATH 1350', '1234', '13:00', '13:50', 'Math Building 105'], ['HIST 2010', '13', '15:30', '16:45', 'Library 210']];
const schedule = (text) => {
  const r = C.fromText(text, { lang: 'en', now: Date.UTC(2026, 9, 15) });
  const of = (e, code) => e.code === code || new RegExp(`\\b${code}\\b`).test(e.label);
  let ok = 0;
  for (const [code, days, start, end, loc] of TIMETABLE) {
    const ps = r.entries.filter((e) => of(e, code)).flatMap((e) => e.periods);
    if (ps.some((p) => p.days.join('') === days && C.hhmm(p.start) === start && C.hhmm(p.end) === end)) ok++;
    if (ps.some((p) => p.loc === loc)) ok++;
  }
  return { ok, of: TIMETABLE.length * 2, extra: r.entries.filter((e) => !TIMETABLE.some(([code]) => of(e, code))).length };
};

// Syllabus: professor, office, each office hour and class time, each letter of the scale, each weight, each date.
const SYLLABI = {
  bio: { name: 'Dr. Amara Okafor', email: 'aokafor@frostdale.edu', office: 'Science Hall 214', hours: ['TU TH 14:00-15:30'],
    meetings: ['MO WE FR 09:00-09:50 | Science Hall 120', 'TU 14:00-16:50 | Science Hall 214'], scale: ['A 93', 'A- 90', 'B+ 87', 'B 83', 'B- 80', 'C 70', 'D 60', 'F 0'],
    weights: ['Homework 20', 'Lab reports 25', 'Midterm exam 20', 'Final exam 35'], dates: ['2026-10-14 exam', '2026-11-20 due', '2026-12-15 exam'] },
  hist: { name: 'Prof. Daniel Reyes', email: 'dreyes@frostdale.edu', office: 'Library 305', hours: ['MO 13:00-14:30'], meetings: ['MO WE 15:30-16:45 | Library 210'],
    scale: ['A 94', 'A- 90', 'B+ 87', 'B 84', 'B- 80', 'C 70', 'D 60', 'F 0'], weights: ['Reading responses 15', 'Map quizzes 10', 'Midterm exam 25', 'Research paper 25', 'Final exam 25'],
    dates: ['2026-09-16 exam', '2026-10-21 exam', '2026-11-18 due', '2026-12-14 exam'] },
};
const syllabus = (want) => (text) => {
  const r = S.extract(text, { start: Date.UTC(2026, 7, 24), md: true, hint: 'en' });
  const got = { hours: r.hours.map((m) => `${m.days.join(' ')} ${m.start}-${m.end}`), meetings: r.meetings.map((m) => `${m.days.join(' ')} ${m.start}-${m.end} | ${m.location}`),
    scale: (r.scale.value || []).map(([l, v]) => `${l} ${v}`), weights: (r.weights.value || []).map((w) => `${w.name} ${w.weight}`), dates: r.dates.map((d) => `${d.day} ${d.kind}`) };
  let ok = ['name', 'email', 'office'].filter((k) => r.prof[k].value === want[k]).length, of = 3;
  for (const k of Object.keys(got)) { of += want[k].length; ok += want[k].filter((x) => got[k].includes(x)).length; }
  return { ok, of, extra: Object.keys(got).reduce((n, k) => n + got[k].filter((x) => !want[k].includes(x)).length, 0) };
};

// Transcript: each term's name and GPA, each course's name, credits and grade.
const TRANSCRIPT = [['Fall 2025', 3.48, [['BIO 1000 Foundations of Biology', 3, 'A-'], ['CHEM 1010 General Chemistry I', 4, 'B+'], ['ENG 1000 Academic Writing', 3, 'A'], ['MATH 1300 Precalculus', 3, 'B']]],
  ['Spring 2026', 3.46, [['PSY 1010 Introduction to Psychology', 3, 'A'], ['CHEM 1020 General Chemistry II', 4, 'B'], ['COMM 1100 Public Speaking', 3, 'A-'], ['MATH 1340 Statistics', 3, 'B+'], ['ART 1050 Drawing I', 2, 'P']]],
  ['Summer 2026', 4, [['HIST 1500 American History', 3, 'A']]]];
const transcript = (text) => {
  const terms = G.parse(text);
  let ok = 0, of = 0;
  for (const [name, gpa, rows] of TRANSCRIPT) {
    const t = terms.find((x) => x.n === name);
    of += 2 + rows.length * 3;
    if (!t) continue;
    ok += 1 + (t.gpa === gpa);
    for (const [n, cr, g] of rows) {
      // A course whose title was misread still counts its credits and grade, found by its code.
      const c = t.c.find((x) => x.n === n) || t.c.find((x) => x.n.split(' ').slice(0, 2).join(' ') === n.split(' ').slice(0, 2).join(' '));
      if (c) ok += (c.n === n) + (c.cr === cr) + (c.g === g);
    }
  }
  return { ok, of, extra: terms.reduce((n, t) => n + t.c.length, 0) - TRANSCRIPT.reduce((n, [, , rows]) => n + rows.length, 0) };
};

// Each fixture and what reads it.
const SCORE = {
  'timetable.pdf': schedule, 'timetable.png': schedule, 'timetable.webp': schedule, 'timetable-photo.jpg': schedule,
  'canvas-schedule-light.png': schedule, 'canvas-schedule-dark.png': schedule,
  'syllabus.pdf': syllabus(SYLLABI.bio), 'syllabus.png': syllabus(SYLLABI.bio), 'syllabus-2col.pdf': syllabus(SYLLABI.hist),
  'transcript.pdf': transcript, 'transcript-scan.pdf': transcript, 'transcript-photo.jpg': transcript,
};

module.exports = { TIMETABLE, SYLLABI, TRANSCRIPT, SCORE };
