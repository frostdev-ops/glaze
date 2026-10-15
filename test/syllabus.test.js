// Syllabus import (lib/syllabus.js): the extractors on syllabi written for these tests, in several layouts and the six
// languages Glaze speaks, the way they reach it (pasted text, Canvas's Syllabus page through lib/doctext.js). Each
// field is checked exactly; a field the heuristics can't read must come back empty, never wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/syllabus.js');
const D = require('../lib/doctext.js');

const FALL = Date.UTC(2026, 7, 24); // Fall 2026 starts August 24
const SPRING = Date.UTC(2027, 0, 11);
const pick = (r) => ({
  name: r.prof.name.value, email: r.prof.email.value, office: r.prof.office.value, note: r.prof.note.value,
  hours: r.hours.map((m) => `${m.days.join(' ')} ${m.start}-${m.end}`),
  meetings: r.meetings.map((m) => `${m.label} | ${m.days.join(' ')} ${m.start}-${m.end} | ${m.location}`),
  dates: r.dates.map((d) => `${d.day} ${d.kind} ${d.title}`),
  scale: r.scale.value ? r.scale.value.map(([l, v]) => `${l} ${v}`).join(', ') : '',
  weights: S.weightsText(r.weights.value),
});

test('an English syllabus with labelled lines (US dates)', () => {
  const r = S.extract(`BIO 1100 Introduction to Biology - Fall 2026
Instructor: Dr. Amara Okafor
Email: aokafor@example.edu
Office: Science Hall 214
Office hours: Tuesdays and Thursdays 2:00-3:30 PM, or by appointment
Lecture: MWF 9:00-9:50 AM, Room 101
Lab: Thursday 1:00-3:50 PM in Lab B

Grading
Homework 20%
Lab reports 25%
Midterm exam 20%
Final exam 35%

Grading scale
A 93-100
A- 90-92.99
B+ 87-89.99
B 83-86.99
C 70-82.99
D 60-69.99
F below 60

Important dates
Midterm exam: Wednesday, October 14
Research paper due Nov. 20 at 11:59 pm
Problem Set 3 due 10/2
Final exam: December 15, 2026, 8:00-10:00 AM
The final is worth 1/3 of the exam grade.`, { start: FALL, md: true });
  assert.deepEqual(pick(r), {
    name: 'Dr. Amara Okafor', email: 'aokafor@example.edu', office: 'Science Hall 214', note: '',
    hours: ['TU TH 14:00-15:30'],
    meetings: ['Lecture | MO WE FR 09:00-09:50 | Room 101', 'Lab | TH 13:00-15:50 | Lab B'],
    dates: ['2026-10-14 exam Midterm exam', '2026-11-20 due Research paper due', '2026-10-02 due Problem Set 3 due', '2026-12-15 exam Final exam'],
    scale: 'A 93, A- 90, B+ 87, B 83, C 70, D 60, F 0',
    weights: 'Homework 20%, Lab reports 25%, Midterm exam 20%, Final exam 35%',
  });
  assert.equal(r.prof.name.conf, 'sure');
  assert.equal(r.prof.name.src, 'Instructor: Dr. Amara Okafor');
  assert.equal(r.scale.conf, 'sure');
  assert.equal(r.weights.conf, 'sure');
  assert.equal(r.dates.find((d) => d.title === 'Problem Set 3 due').conf, 'check', 'a numeric date without a year is a guess');
  assert.ok(r.dates.every((d) => d.src), 'every date shows the line it came from');
});

test('Canvas\'s Syllabus page: tables through lib/doctext.js', () => {
  const html = `<div id="course_syllabus" class="user_content">
<h2>MATH 1350 Calculus I</h2>
<table><tbody><tr><td><strong>Instructor</strong></td><td>Prof. Daniel Kim</td></tr>
<tr><td>E-mail</td><td><a href="mailto:dkim@example.edu">dkim@example.edu</a></td></tr>
<tr><td>Office hours</td><td>Mon 3:00-4:00 PM</td></tr>
<tr><td></td><td>Wed 10:00-11:00 AM</td></tr></tbody></table>
<p>Class meets TR 11:00am-12:15pm in Bldg 4, Room 120.</p>
<h3>Grade breakdown</h3>
<table><thead><tr><th>Component</th><th>Weight</th></tr></thead>
<tbody><tr><td>Quizzes</td><td>15%</td></tr><tr><td>Homework (online)</td><td>15%</td></tr><tr><td>Exams (3)</td><td>45%</td></tr><tr><td>Final exam</td><td>25%</td></tr></tbody></table>
<h3>Letter grades</h3>
<table><tbody><tr><td>A</td><td>90 and above</td></tr><tr><td>B</td><td>80 - 89</td></tr><tr><td>C</td><td>70 - 79</td></tr><tr><td>D</td><td>60 - 69</td></tr><tr><td>F</td><td>below 60</td></tr></tbody></table>
<h3>Schedule</h3>
<table><tbody><tr><td>Week 1</td><td>Aug 24</td><td>Limits</td></tr>
<tr><td>Week 7</td><td>Oct 6</td><td>Exam 1</td></tr>
<tr><td>Week 16</td><td>Dec 10</td><td>Final exam, 8-10am</td></tr></tbody></table></div>`;
  const r = S.extract(D.html(html), { start: FALL, md: true });
  assert.deepEqual(pick(r), {
    name: 'Prof. Daniel Kim', email: 'dkim@example.edu', office: '', note: '',
    hours: ['MO 15:00-16:00', 'WE 10:00-11:00'],
    meetings: ['Class meets | TU TH 11:00-12:15 | Bldg 4, Room 120'],
    dates: ['2026-10-06 exam Week 7 · Exam 1', '2026-12-10 exam Week 16 · Final exam'],
    scale: 'A 90, B 80, C 70, D 60, F 0',
    weights: 'Quizzes 15%, Homework 15%, Exams 45%, Final exam 25%',
  });
});

test('a scale read column by column, and weights written percent first', () => {
  const r = S.extract(`Course grade
10%
Participation
40%
Essays
50%
Final portfolio

Grading scale
A:
B:
C:
D:
90 and above
80 - 89
70 - 79
60 - 69`);
  assert.equal(pick(r).scale, 'A 90, B 80, C 70, D 60');
  assert.equal(pick(r).weights, 'Participation 10%, Essays 40%, Final portfolio 50%');
});

test('scales written range first, with ≥, in parentheses or as bare minimums', () => {
  const scale = (text) => pick(S.extract(text)).scale;
  assert.equal(scale('93-100 A\n90-92 A-\n87-89 B+\n83-86 B\n0-82 C'), 'A 93, A- 90, B+ 87, B 83, C 0');
  assert.equal(scale('Grades: A (93-100%), B (85-92%), C (75-84%), D (65-74%), F (below 65%)'), 'A 93, B 85, C 75, D 65, F 0');
  assert.equal(scale('A = 94 and above; A- = 90-93; B+ = 87-89; B = 84-86'), 'A 94, A- 90, B+ 87, B 84');
  assert.equal(scale('Scale: A 93, A- 90, B+ 87, B 83, B- 80'), 'A 93, A- 90, B+ 87, B 83, B- 80');
  assert.equal(scale('A: 92,5 – 100 %\nB: 82,5 – 92,4 %\nC: 72,5 – 82,4 %'), 'A 92.5, B 82.5, C 72.5');
  assert.equal(scale('Two sections, A and B, meet in room C.'), '', 'letters without numbers are no scale');
  assert.equal(scale('A 90-100\nB 80-89'), '', 'two letters are too few to be sure of');
});

test('weights must add up to 100, and the parenthesised share of one item is left out', () => {
  const w = (text) => pick(S.extract(text)).weights;
  assert.equal(w('Homework (20%), Quizzes (10%), Midterm (30%), Final (40%)'), 'Homework 20%, Quizzes 10%, Midterm 30%, Final 40%');
  assert.equal(w('Exams 60% (30% each)\nProjects 40%'), 'Exams 60%, Projects 40%');
  assert.equal(w('Homework is worth 25%\nLabs count for 25%\nExams 50%'), 'Homework 25%, Labs 25%, Exams 50%');
  assert.equal(w('Late work loses 10% a day. Attendance 5%.'), '', 'shares that do not add up to 100 are not weights');
});

test('a German syllabus', () => {
  const r = S.extract(`Einführung in die Soziologie (WiSe 2026/27)
Dozentin: Prof. Dr. Maria Schneider
E-Mail: m.schneider@uni-beispiel.de
Büro: Raum 3.14
Sprechstunde: Mi 14:00-15:00 Uhr
Vorlesung: Di und Do 10:15-11:45 Uhr, Hörsaal 3
Klausur: 12.02.2027
Abgabe der Hausarbeit: 15. März
Bewertung: Hausarbeit 40 %, Klausur 60 %
Notenskala: A ab 90 %, B ab 80 %, C ab 70 %, D ab 60 %, F unter 60 %`, { start: Date.UTC(2026, 9, 12) });
  assert.deepEqual(pick(r), {
    name: 'Prof. Dr. Maria Schneider', email: 'm.schneider@uni-beispiel.de', office: 'Raum 3.14', note: '',
    hours: ['WE 14:00-15:00'],
    meetings: ['Vorlesung | TU TH 10:15-11:45 | Hörsaal 3'],
    dates: ['2027-02-12 exam Klausur', '2027-03-15 due Abgabe der Hausarbeit'],
    scale: 'A 90, B 80, C 70, D 60, F 0',
    weights: 'Hausarbeit 40%, Klausur 60%',
  });
});

test('a Spanish syllabus', () => {
  const r = S.extract(`Programa de la asignatura: Química General
Profesora: Dra. Lucía Fernández
Correo: lfernandez@universidad.es
Despacho: Edificio B, 2.07
Horario de atención: lunes y miércoles 12:00-13:00
Clases: martes y jueves 9:00-10:30, aula 2.04
Examen parcial: 15 de octubre
Entrega del proyecto: 30 de noviembre
Evaluación: Tareas 30 %, Examen parcial 30 %, Proyecto final 40 %
Escala de calificaciones: A 90-100, B 80-89, C 70-79, D 60-69, F 0-59`, { start: Date.UTC(2026, 8, 7) });
  assert.deepEqual(pick(r), {
    name: 'Dra. Lucía Fernández', email: 'lfernandez@universidad.es', office: 'Edificio B, 2.07', note: '',
    hours: ['MO WE 12:00-13:00'],
    meetings: ['Clases | TU TH 09:00-10:30 | aula 2.04'],
    dates: ['2026-10-15 exam Examen parcial', '2026-11-30 due Entrega del proyecto'],
    scale: 'A 90, B 80, C 70, D 60, F 0',
    weights: 'Tareas 30%, Examen parcial 30%, Proyecto final 40%',
  });
});

test('a French syllabus', () => {
  const r = S.extract(`Introduction à l'économie
Enseignant : M. Jean Dupont
Courriel : jean.dupont@univ-exemple.fr
Bureau : 3.12
Permanence : jeudi 10h-12h
Cours : lundi 8h30-10h30, amphi A
Partiel : le 21 octobre
Rendu du dossier : 4 décembre
Pondération : Contrôle continu 40 %, Examen final 60 %`, { start: Date.UTC(2026, 8, 1) });
  assert.deepEqual(pick(r), {
    name: 'M. Jean Dupont', email: 'jean.dupont@univ-exemple.fr', office: '3.12', note: '',
    hours: ['TH 10:00-12:00'],
    meetings: ['Cours | MO 08:30-10:30 | amphi A'],
    dates: ['2026-10-21 exam Partiel', '2026-12-04 due Rendu du dossier'],
    scale: '',
    weights: 'Contrôle continu 40%, Examen final 60%',
  });
});

test('a Dutch syllabus', () => {
  const r = S.extract(`Studiehandleiding Statistiek 1
Docent: dr. Pieter van der Berg
E-mail: p.vanderberg@uni.nl
Spreekuur: wo 13:00-14:00
Hoorcollege: ma en do 13.45-15.30 uur, zaal 2
Tentamen: 18 december
Inleveren verslag: 27 november
Beoordeling: Verslag 30%, Tentamen 70%`, { start: Date.UTC(2026, 8, 1) });
  assert.deepEqual(pick(r), {
    name: 'dr. Pieter van der Berg', email: 'p.vanderberg@uni.nl', office: '', note: '',
    hours: ['WE 13:00-14:00'],
    meetings: ['Hoorcollege | MO TH 13:45-15:30 | zaal 2'],
    dates: ['2026-12-18 exam Tentamen', '2026-11-27 due Inleveren verslag'],
    scale: '',
    weights: 'Verslag 30%, Tentamen 70%',
  });
});

test('a Brazilian Portuguese syllabus (day-first numeric dates)', () => {
  const r = S.extract(`Plano de ensino - Cálculo II
Professora: Dra. Ana Souza
E-mail: ana.souza@universidade.br
Horário de atendimento: quinta 16h-17h
Aulas: segunda e quarta 19h-20h40, sala 5
Prova 1: 15/09
Entrega do trabalho: 20 de novembro
Avaliação: Provas 60%, Trabalhos 40%
Conceitos: A 90-100, B 80-89, C 70-79, D 60-69, F 0-59`, { start: Date.UTC(2026, 7, 3) });
  assert.deepEqual(pick(r), {
    name: 'Dra. Ana Souza', email: 'ana.souza@universidade.br', office: '', note: '',
    hours: ['TH 16:00-17:00'],
    meetings: ['Aulas | MO WE 19:00-20:40 | sala 5'],
    dates: ['2026-09-15 exam Prova 1', '2026-11-20 due Entrega do trabalho'],
    scale: 'A 90, B 80, C 70, D 60, F 0',
    weights: 'Provas 60%, Trabalhos 40%',
  });
});

test('office hours with no time to read are kept as words; an unlabelled professor is a guess', () => {
  const r = S.extract('Welcome to ENG 1100 with Professor Helen Marsh.\nOffice hours: by appointment\nContact: hmarsh@example.edu');
  assert.equal(r.prof.name.value, 'Professor Helen Marsh');
  assert.equal(r.prof.name.conf, 'check');
  assert.equal(r.prof.note.value, 'by appointment');
  assert.equal(r.prof.email.value, 'hmarsh@example.edu');
  assert.deepEqual(r.hours, []);
});

test('text with nothing to find gives empty fields, not guesses', () => {
  const r = S.extract('Welcome! In this course we read novels and talk about them. Bring a notebook. Problem Set 3 is optional; 50% of you will love it.');
  assert.deepEqual(pick(r), { name: '', email: '', office: '', note: '', hours: [], meetings: [], dates: [], scale: '', weights: '' });
  assert.deepEqual(S.extract(''), S.extract(null));
});

test('dates fall in the course\'s term: the year after for a term that crosses New Year, the year written when there is one', () => {
  const days = (text, start, md) => S.extract(text, { start, md }).dates.map((d) => d.day);
  assert.deepEqual(days('Exam 1: Dec 10\nExam 2: Jan 21', FALL), ['2026-12-10', '2027-01-21']);
  assert.deepEqual(days('Exam 1: Jan 20\nExam 2: Mar 3', SPRING), ['2027-01-20', '2027-03-03']);
  assert.deepEqual(days('Exam: Jan 20, 2026', FALL), ['2026-01-20']);
  assert.deepEqual(days('Quiz 10/4', FALL, true), ['2026-10-04']);
  assert.deepEqual(days('Quiz 10/4', FALL, false), ['2027-04-10']);
  assert.deepEqual(days('Quiz 2026-10-04', FALL, true), ['2026-10-04']);
  assert.deepEqual(days('Exam: Feb 30', FALL), [], 'no such day');
  assert.deepEqual(days('Midterms: Oct 12 and Nov 16', FALL), ['2026-10-12', '2026-11-16']);
});

// Day and time reading itself is W14's (lib/classes.js meetings, tested in test/classes.test.js); these check how the
// syllabus uses it: labels, places, office hours apart, dated sessions left out, the text's language, guesses marked.
test('class times come from lib/classes.js, with the line\'s label and place', () => {
  const r = S.extract('Lecture: MWF 9:00-9:50 AM, Room 101\nOffice hours: Mon 2-3pm\nMidterm review: Monday, October 5, 6-8pm\nDiscussion: TR 2pm');
  assert.deepEqual(r.meetings.map((m) => [m.label, m.days.join(' '), m.start, m.end, m.location, m.conf]), [
    ['Lecture', 'MO WE FR', '09:00', '09:50', 'Room 101', 'sure'],
    ['Discussion', 'TU TH', '14:00', '15:15', '', 'check'], // no end written: W14's 75 minutes, marked to check
  ]);
  assert.deepEqual(r.hours.map((m) => `${m.days.join(' ')} ${m.start}-${m.end}`), ['MO 14:00-15:00'], 'office hours are not class times');
  // Spanish letters (L-X) read as Monday and Wednesday once the text is Spanish; "ma en do" as Dutch Monday and Thursday.
  assert.deepEqual(S.extract('Programa\nClases: martes y jueves 9:00-10:30\nTutorías: L-X 10:00-11:30').hours.map((m) => m.days.join(' ')), ['MO WE']);
  // One Dutch line alone doesn't say it's Dutch ("do" is also German and Spanish): W14 reads only "do" then. With the
  // page's language as the hint, both days.
  assert.deepEqual(S.extract('Hoorcollege: ma en do 13.45-15.30 uur, zaal 2', { hint: 'nl' }).meetings.map((m) => [m.days.join(' '), m.location]), [['MO TH', 'zaal 2']]);
  assert.equal(S.extract('Vorlesung: Di 10-12 Uhr', { hint: 'de' }).meetings[0]?.days.join(' '), 'TU', 'the page\'s language as the hint');
});

test('what the review screen writes: weights as text, and the record kept', () => {
  assert.deepEqual(S.parseWeights('Homework 20%, Exams: 50 %; Final 30'), [{ name: 'Homework', weight: 20 }, { name: 'Exams', weight: 50 }, { name: 'Final', weight: 30 }]);
  assert.deepEqual(S.parseWeights('Labs 12,5%'), [{ name: 'Labs', weight: 12.5 }]);
  assert.equal(S.parseWeights('Homework'), null);
  assert.equal(S.parseWeights('Homework 120%'), null);
  assert.deepEqual(S.parseWeights(''), []);
  assert.equal(S.weightsText([{ name: 'Homework', weight: 20 }]), 'Homework 20%');

  assert.equal(S.tidy(null), null);
  assert.equal(S.tidy({ prof: {}, meetings: [{ days: ['XX'], start: '9', end: '10' }] }), null, 'nothing valid is nothing');
  const rec = S.tidy({
    prof: { name: '  Dr.  Okafor ', email: 'not an email', office: 'x'.repeat(300), extra: 1 },
    meetings: [{ label: 'Lecture', days: ['FR', 'MO', 'MO'], start: '09:00', end: '09:50', location: 'Room 1' }, { days: ['MO'], start: '10:00', end: '09:00' }],
    dates: [{ title: 'Exam', day: '2026-02-30', kind: 'exam' }, { title: 'Paper', day: '2026-11-20', kind: 'odd' }],
    scale: [['B', 80], ['A', 90], ['C', 170]],
    weights: [{ name: 'Homework', weight: 20 }, { name: '', weight: 10 }],
    at: 5, html: '<script>',
  });
  assert.deepEqual(rec, {
    prof: { name: 'Dr. Okafor', email: '', office: 'x'.repeat(120), note: '' },
    hours: [], meetings: [{ label: 'Lecture', days: ['MO', 'FR'], start: '09:00', end: '09:50', location: 'Room 1' }],
    dates: [{ title: 'Paper', day: '2026-11-20', kind: 'other' }],
    scale: [['A', 90], ['B', 80]], weights: [{ name: 'Homework', weight: 20 }], at: 5,
  });
  assert.deepEqual(S.tidy(rec), rec, 'idempotent');
});

test('keys and task ids', () => {
  assert.equal(S.key('https://school.instructure.com', '42', '7'), 'syllabus:https://school.instructure.com/42/7');
  assert.ok(S.KEY.test(S.key('http://localhost:3000', '1', '25')));
  assert.ok(!S.KEY.test('syllabus:https://evil.example/../1/2'));
  const a = S.taskId('25', { day: '2026-10-14', title: 'Midterm exam' });
  assert.equal(a, S.taskId('25', { day: '2026-10-14', title: 'Midterm exam' }), 'the same date makes the same task');
  assert.notEqual(a, S.taskId('25', { day: '2026-10-15', title: 'Midterm exam' }));
  assert.match(S.taskId('12345678901234567890', { day: '2026-10-14', title: 'x' }), /^[\w-]{1,40}$/, 'fits lib/todo.js task ids');
});

test('a scale keeps its ranges; overlaps, gaps and letters out of order make it a guess, never sure', () => {
  const sc = (text) => S.extract(`Grading scale\n${text}`).scale;
  const fine = sc('A 90-100\nB 80-89.99\nC 70-79.99\nF below 70');
  assert.equal(fine.conf, 'sure');
  assert.deepEqual(fine.issues, []);
  assert.deepEqual(fine.ranges, [['A', 90, 100], ['B', 80, 89.99], ['C', 70, 79.99], ['F', 0, 69.99]]);
  const overlap = sc('A 90-100\nB 80-95\nC 70-79');
  assert.equal(overlap.conf, 'check');
  assert.deepEqual(overlap.issues, [{ kind: 'overlap', a: 'A 90–100', b: 'B 80–95' }]);
  const gap = sc('A 90-100\nB 80-85\nC 70-79');
  assert.equal(gap.conf, 'check');
  assert.deepEqual(gap.issues, [{ kind: 'gap', a: 'A 90–100', b: 'B 80–85' }]);
  const order = sc('A 90-100\nB 70-79\nC 80-89\nD 60-69');
  assert.equal(order.conf, 'check');
  assert.equal(order.issues[0].kind, 'order', 'C 80-89 below B breaks the order (and B to A leaves a gap)');
});

test('a syllabus record only moves forward: an older save never replaces a newer one, nor brings back a deleted one', () => {
  const rec = (name, at) => ({ prof: { name }, at });
  let stored = S.change(undefined, { rec: rec('New', 0), at: 200 });
  assert.equal(stored.prof.name, 'New');
  assert.equal(stored.at, 200);
  assert.equal(S.change(stored, { rec: rec('Old', 0), at: 100 }), null, 'older: dropped');
  stored = S.change(stored, { rec: null, at: 300 });
  assert.deepEqual(stored, { deleted: 300 });
  assert.equal(S.tidy(stored), null, 'a deleted record reads as none');
  assert.equal(S.change(stored, { rec: rec('Late', 0), at: 250 }), null, 'a save made before the delete stays deleted');
  assert.equal(S.change(stored, { rec: rec('Again', 0), at: 400 }).prof.name, 'Again', 'a save after it is kept');
  assert.equal(S.change(undefined, { rec: rec('x', 0) }), null, 'no time, no write');
});

test('a large or hostile text is read in one pass, and a text over the cap is cut and says so', () => {
  const time = (text) => { const t0 = performance.now(); const r = S.extract(text); return { r, ms: performance.now() - t0 }; };
  // Codex's witness: rows of zero weights made the old search quadratic (48 KB took 0.6 s).
  const zeros = time('Category 0%\n'.repeat(Math.floor(S.MAX / 12)));
  assert.ok(zeros.ms < 1500, `${Math.round(zeros.ms)} ms for ${S.MAX} characters of zero weights`);
  assert.equal(zeros.r.weights.value, '');
  const mixed = time(Array.from({ length: 4000 }, (_, i) => `Quiz ${i}: Oct ${(i % 28) + 1} 9:00-9:50 AM Room ${i} A ${90 - (i % 50)} Homework ${i % 7}% b@c.de`).join('\n'));
  assert.ok(mixed.ms < 1500, `${Math.round(mixed.ms)} ms for a long text of dates, times, letters and weights`);
  const big = time('x'.repeat(S.MAX + 10) + '\nInstructor: Dr. Late Name');
  assert.equal(big.r.truncated, true);
  assert.equal(big.r.prof.name.value, '', 'what is past the cap is not read');
  assert.equal(S.extract('Instructor: Dr. Amara Okafor').truncated, false);
});

test('a weight block that does not add up to 100 is shown whole, marked to check, with its total', () => {
  const w = S.extract('Grading weights\nHomework 60%\nFinal exam 40%\nLabs 20%').weights;
  assert.deepEqual(w.value, [{ name: 'Homework', weight: 60 }, { name: 'Final exam', weight: 40 }, { name: 'Labs', weight: 20 }]);
  assert.equal(w.conf, 'check');
  assert.deepEqual(w.issues, [{ kind: 'sum', total: 120 }]);
  assert.match(w.src, /Labs 20%/);
  assert.equal(S.extract('Grading\nHomework 40%\nExams 60%').weights.conf, 'sure');
  assert.deepEqual(S.extract('Grading\nHomework 40%\nExams 60%').weights.issues, []);
});

test('date ranges and numeric dates that read either way are guesses', () => {
  const d = (text, md) => S.extract(text, { start: FALL, md }).dates.map((x) => [x.title, x.day, x.end, x.conf]);
  assert.deepEqual(d('Final exam: December 15-17'), [['Final exam', '2026-12-15', '2026-12-17', 'check']]);
  assert.deepEqual(d('Partiel : 15–17 décembre 2026'), [['Partiel', '2026-12-15', '2026-12-17', 'check']]);
  assert.deepEqual(d('Midterm exam: Oct 3–5, 2026'), [['Midterm exam', '2026-10-03', '2026-10-05', 'check']]);
  assert.deepEqual(d('Quiz 10/04/2026', true), [['Quiz', '2026-10-04', undefined, 'check']], 'October 4 or 10 April');
  assert.deepEqual(d('Quiz 10/24/2026', true), [['Quiz', '2026-10-24', undefined, 'sure']], 'only one reading');
});

test('a TA\'s e-mail is not the professor\'s', () => {
  const p = (text) => S.extract(text).prof.email;
  const both = p('Instructor: Alice Smith\nTA: Bob Jones\nEmail: bob@example.edu\nInstructor email: alice@example.edu');
  assert.deepEqual([both.value, both.conf], ['alice@example.edu', 'sure']);
  const onlyTa = p('Instructor: Alice Smith\nTA: Bob Jones\nEmail: bob@example.edu');
  assert.deepEqual([onlyTa.value, onlyTa.conf], ['bob@example.edu', 'check'], 'past the TA, only a guess');
  const own = p('Instructor: Alice Smith\nEmail: alice@example.edu\nTA: Bob Jones, bob@example.edu');
  assert.deepEqual([own.value, own.conf], ['alice@example.edu', 'sure']);
});

test('a damaged stored date is dropped, not thrown on', () => {
  assert.deepEqual(S.tidy({ prof: { name: 'x' }, dates: [{ title: 'Bad', day: '2026-99-99' }, { title: 'Good', day: '2026-11-20' }] }).dates, [{ title: 'Good', day: '2026-11-20', kind: 'other' }]);
});

test('a date saved again to Better To Do keeps whether it was done, and its steps', () => {
  const T = require('../lib/todo.js');
  const task = { id: 'syl-25-abc', title: 'Midterm exam', cid: '25', due: { day: '2026-11-04' }, notes: 'From your syllabus', at: 1 };
  const d = T.clean({});
  T.edit(d, ['importTask', task]);
  T.edit(d, ['taskDone', 'syl-25-abc', 5000]);
  T.edit(d, ['addStep', 'task:syl-25-abc', { id: 's1', title: 'Review chapter 3' }]);
  T.edit(d, ['importTask', { ...task, title: 'Midterm exam 1', due: { day: '2026-11-05' } }]);
  const out = T.clean(d);
  assert.equal(out.tasks.length, 1);
  assert.equal(out.tasks[0].done, 5000, 'still done');
  assert.equal(out.tasks[0].title, 'Midterm exam 1');
  assert.deepEqual(out.tasks[0].due, { day: '2026-11-05' });
  assert.equal(out.items['task:syl-25-abc'].subs[0].title, 'Review chapter 3');
  T.edit(d, ['importTask', { ...task, id: 'syl-25-new', done: 9 }]);
  assert.equal(T.clean(d).tasks.find((x) => x.id === 'syl-25-new').done, 0, 'a new one starts not done');
});
