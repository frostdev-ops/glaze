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

// ACA-3: a date row has an id of its own, so editing its day or title is the same row and the same To Do task.
test('a date row\'s task id is its own, not its day and title', () => {
  const row = { id: 'k3j9a', title: 'Midterm exam', day: '2026-10-12', kind: 'exam' };
  assert.equal(S.taskId('42', row), 'syl-42-k3j9a');
  assert.equal(S.taskId('42', { ...row, day: '2026-10-14' }), S.taskId('42', row), 'a new day is the same task');
  assert.equal(S.taskId('42', { ...row, title: 'Midterm 1' }), S.taskId('42', row), 'a new title is the same task');
  assert.notEqual(S.taskId('42', { ...row, id: 'p0' }), S.taskId('42', row), 'another row is another task');
  assert.match(S.taskId('12345678901234567890', { ...row, id: 'abcdefghij' }), /^[\w-]{1,40}$/, 'the longest fits lib/todo.js task ids');
});

test('ids: a row keeps a good id, is told apart from its twin, matches the same row in the record, else gets the id its day and title always made', () => {
  const quiz = { title: 'Quiz', day: '2026-10-05', kind: 'due' };
  const [a, b] = S.ids([quiz, { ...quiz, day: '2026-10-12' }]);
  assert.match(a.id, /^[a-z\d]{1,10}$/);
  assert.notEqual(a.id, b.id);
  assert.equal(S.taskId('7', a), S.taskId('7', quiz), 'a record from before ids keeps the task it made');
  assert.deepEqual(S.ids([a, b]), [a, b], 'ids it has are kept');
  const [x, y] = S.ids([quiz, quiz]);
  assert.notEqual(x.id, y.id, 'two rows alike still have two ids');
  assert.equal(x.id, a.id, 'the first of them is the one every earlier version made');
  const [p, q] = S.ids([{ ...quiz, id: 'q1' }, { ...quiz, day: '2026-10-12', id: 'q1' }]);
  assert.deepEqual([p.id, q.id === 'q1'], ['q1', false], 'an id another row has is not kept twice');
  assert.notEqual(S.ids([{ ...quiz, id: 'Not Valid!' }])[0].id, 'Not Valid!');
  // A review of a fresh read, against what is kept: the same day and title is the same row; another day is another row.
  const was = [{ ...quiz, id: 'zz9' }];
  assert.equal(S.ids([quiz], was)[0].id, 'zz9');
  assert.notEqual(S.ids([{ ...quiz, day: '2026-10-19' }], was)[0].id, 'zz9');
  assert.equal(S.ids([{ ...quiz, id: 'mine' }], was)[0].id, 'mine', 'an id the row already has wins');
  assert.deepEqual(S.ids([], was), []);
});

test('syllabus task ids for the longest accepted Ultra course still fit the To Do contract', () => {
  const T = require('../lib/todo.js');
  const cid = '_12345678901234567890_12345678901234567890';
  const row = { id: 'abcdefghij', title: 'Exam', day: '2026-11-20' };
  const id = S.taskId(cid, row), data = T.clean({});
  assert.match(id, /^[\w-]{1,40}$/);
  T.edit(data, ['importTask', { id, title: row.title, due: { day: row.day }, cid }]);
  assert.equal(data.tasks.length, 1);
  assert.equal(S.taskId(cid, { ...row, title: 'Edited', day: '2026-11-21' }), id);
});

test('tidy keeps a date\'s id, once, and makes none up', () => {
  const dates = [{ title: 'A', day: '2026-11-20', id: 'a1' }, { title: 'B', day: '2026-11-21', id: 'a1' }, { title: 'C', day: '2026-11-22', id: 'bad id' }, { title: 'D', day: '2026-11-23' }];
  assert.deepEqual(S.tidy({ prof: { name: 'x' }, dates }).dates, [
    { title: 'A', day: '2026-11-20', kind: 'other', id: 'a1' }, { title: 'B', day: '2026-11-21', kind: 'other' },
    { title: 'C', day: '2026-11-22', kind: 'other' }, { title: 'D', day: '2026-11-23', kind: 'other' }]);
  const rec = S.tidy({ prof: { name: 'x' }, dates: [{ title: 'A', day: '2026-11-20', id: 'a1' }] });
  assert.deepEqual(S.tidy(rec), rec, 'idempotent');
});

// What a save does to To Do (taskEdits): was is the record before, now the one being saved, picked the ids ticked "Add to To Do".
const edits = (o) => S.taskEdits({ cid: '42', note: 'From your syllabus', at: 5, picked: new Set(), tasks: [], ...o });
const row = (id, title, day) => ({ id, title, day, kind: 'exam' });
const have = (id, more = {}) => ({ id: `syl-42-${id}`, title: 'x', cid: '42', due: { day: '2026-10-12' }, done: 0, ...more });
const imp = (id, title, day) => ['importTask', { id: `syl-42-${id}`, title, cid: '42', due: { day }, notes: 'From your syllabus', done: 0, at: 5 }];

test('a ticked date is added, or brought up to date where its task is already', () => {
  const r = row('a', 'Midterm exam', '2026-10-12');
  assert.deepEqual(edits({ now: [r], picked: new Set(['a']) }), [imp('a', 'Midterm exam', '2026-10-12')]);
  assert.deepEqual(edits({ was: [r], now: [r], picked: new Set(['a']), tasks: [have('a')] }), [imp('a', 'Midterm exam', '2026-10-12')], 'ticked again: the same task');
  assert.deepEqual(edits({ now: [r] }), [], 'not ticked: nothing');
});

test('a date edited in the record moves its task with it, ticked or not, and only if there is one', () => {
  const was = [row('a', 'Midterm exam', '2026-10-12'), row('b', 'Final', '2026-12-14')];
  const now = [row('a', 'Midterm exam', '2026-10-14'), row('b', 'Final', '2026-12-14')];
  assert.deepEqual(edits({ was, now, tasks: [have('a'), have('b')] }), [imp('a', 'Midterm exam', '2026-10-14')], 'the one that changed, in place');
  assert.deepEqual(edits({ was, now: [row('a', 'Midterm exam 1', '2026-10-12'), was[1]], tasks: [have('a')] }), [imp('a', 'Midterm exam 1', '2026-10-12')], 'a new title too');
  assert.deepEqual(edits({ was, now, tasks: [have('b')] }), [], 'no task for it: none made without a tick');
  assert.deepEqual(edits({ was, now, picked: new Set(['a']), tasks: [] }), [imp('a', 'Midterm exam', '2026-10-14')], 'a tick adds it');
  assert.deepEqual(edits({ was, now: was, tasks: [have('a', { due: { day: '2026-10-20' } })] }), [], 'a task the student moved stays where they put it while the date is as it was');
});

test('a date taken out of the record takes its task, unless the student has done it', () => {
  const was = [row('a', 'Midterm exam', '2026-10-12'), row('b', 'Final', '2026-12-14'), row('c', 'Paper', '2026-11-20')];
  assert.deepEqual(edits({ was, now: [was[2]], tasks: [have('a'), have('b', { done: 7000 }), have('c')] }), [['dropTask', 'syl-42-a']], 'a done one stays, and so does a kept date\'s');
  assert.deepEqual(edits({ was, now: [], tasks: [] }), [], 'no task there: nothing to drop');
  assert.deepEqual(edits({ was: undefined, now: [], tasks: [have('a')] }), [], 'no record before: nothing known to be gone');
});

test('a record from before ids: its dates have the ids their tasks were made with', () => {
  const old = [{ title: 'Midterm exam', day: '2026-10-12', kind: 'exam' }, { title: 'Final', day: '2026-12-14', kind: 'exam' }];
  const made = old.map((d) => S.taskId('42', d)); // as the earlier version made them
  const [first, second] = S.ids(old);
  assert.deepEqual([S.taskId('42', first), S.taskId('42', second)], made);
  // Editing the first one's day in the dialog (it keeps its id), and dropping the second:
  const out = S.taskEdits({ cid: '42', note: 'n', at: 5, picked: new Set(), was: old, now: [{ ...first, day: '2026-10-14' }],
    tasks: made.map((id) => ({ id, title: 'x', cid: '42', due: { day: '2026-10-12' }, done: 0 })) });
  assert.deepEqual(out, [['importTask', { id: made[0], title: 'Midterm exam', cid: '42', due: { day: '2026-10-14' }, notes: 'n', done: 0, at: 5 }], ['dropTask', made[1]]]);
});

// The audit's scenario (r9), through the caller's path: the professor moves the midterm, the student edits it and saves again.
test('moving a saved date and saving again leaves one task, not two (ACA-3)', async () => {
  const T = require('../lib/todo.js');
  const store = {};
  const area = { local: { get: async (ks) => Object.fromEntries(ks.map((k) => [k, store[k]])), set: async (o) => { Object.assign(store, o); return true; } } };
  const key = 'todo:https://x.instructure.com/7';
  const save = (was, now, picked) => T.change({ key, edits: S.taskEdits({ cid: '42', note: 'From your syllabus', at: 1, was, now, picked: new Set(picked), tasks: store[key]?.tasks }) }, area);
  const v1 = S.ids([{ title: 'Midterm exam', day: '2026-10-12', kind: 'exam' }]);
  await save(undefined, v1, [v1[0].id]);
  assert.deepEqual(store[key].tasks.map((x) => [x.title, x.due]), [['Midterm exam', { day: '2026-10-12' }]]);
  await T.change({ key, edits: [['addStep', `task:${S.taskId('42', v1[0])}`, { id: 's1', title: 'Review' }]] }, area);
  const v2 = [{ ...v1[0], day: '2026-10-14' }];
  await save(v1, v2, [v2[0].id]);
  assert.deepEqual(store[key].tasks.map((x) => [x.title, x.due]), [['Midterm exam', { day: '2026-10-14' }]], 'one task, on the new day');
  assert.equal(store[key].items[`task:${S.taskId('42', v1[0])}`].subs[0].title, 'Review', 'with its steps');
  // The student edits the title and the day, without ticking anything: it still moves.
  const v3 = [{ ...v2[0], title: 'Midterm 1', day: '2026-10-16' }];
  await save(v2, v3, []);
  assert.deepEqual(store[key].tasks.map((x) => [x.title, x.due]), [['Midterm 1', { day: '2026-10-16' }]]);
  // And the row removed: the task goes.
  await save(v3, [], []);
  assert.deepEqual(store[key].tasks, []);
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
  // This process's CPU time, not the clock's: on a shared CI runner other test files take turns on the CPU, which
  // stretches wall time without the reader doing any more work.
  const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };
  const time = (text) => { const t0 = cpu(); const r = S.extract(text); return { r, ms: cpu() - t0 }; };
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

// ACA-7: a course with no term dates has no start to place a year-less date by; today stands in for it.
test('with no term start known, a year-less date takes the year nearest today, and a past one is not a sure one', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 0 });
  const on = (y, m, d) => t.mock.timers.setTime(Date.UTC(y, m - 1, d, 12));
  const rows = (text, opts) => S.extract(text, opts).dates.map((x) => [x.title, x.day, x.conf]);
  on(2026, 10, 21);
  assert.deepEqual(rows('Exam 1: September 1\nExam 2: October 23\nFinal exam: December 16'), [
    ['Exam 1', '2026-09-01', 'check'], ['Exam 2', '2026-10-23', 'sure'], ['Final exam', '2026-12-16', 'sure']], 'September stays in 2026: not a year late as a sure one');
  assert.deepEqual(rows('Quiz: September 20\nExam: August 5\nMidterm: January 12\nExam: May 5'), [
    ['Quiz', '2026-09-20', 'sure'], ['Exam', '2026-08-05', 'check'], ['Midterm', '2027-01-12', 'sure'], ['Exam', '2026-05-05', 'check']], 'within 45 days back: as before; further back: this year\'s, to check; next January: next year');
  assert.deepEqual(rows('Exam: September 1, 2026\nFinal: Jan 12, 2027\nQuiz 9/1/2026', { md: true }), [['Exam', '2026-09-01', 'sure'], ['Final', '2027-01-12', 'sure'], ['Quiz', '2026-09-01', 'check']], 'a year written is the year');
  assert.deepEqual(rows('Quiz 9/1', { md: true }), [['Quiz', '2026-09-01', 'check']]);
  assert.deepEqual(rows('Final exam: December 15-17'), [['Final exam', '2026-12-15', 'check']], 'a range is still a guess');
  assert.deepEqual(S.extract('Exam 1: September 1', {}).dates.map((x) => x.day), ['2026-09-01'], 'an options object with no start is the same as none');
  assert.deepEqual(S.extract('Exam 1: September 1', { start: undefined }).dates.map((x) => x.day), ['2026-09-01']);
  assert.deepEqual(S.extract('Exam 1: September 1', { start: NaN }).dates.map((x) => x.day), ['2026-09-01']);
  // Just after New Year, last month's date is last year's; next month's is this year's.
  on(2027, 1, 5);
  assert.deepEqual(rows('Exam: December 10\nExam: January 20\nExam: March 3\nExam: November 2'), [
    ['Exam', '2026-12-10', 'sure'], ['Exam', '2027-01-20', 'sure'], ['Exam', '2027-03-03', 'sure'], ['Exam', '2026-11-02', 'check']]);
  // Late in a year, January is next year's.
  on(2026, 12, 20);
  assert.deepEqual(rows('Exam: December 1\nExam: January 12\nExam: November 2'), [['Exam', '2026-12-01', 'sure'], ['Exam', '2027-01-12', 'sure'], ['Exam', '2026-11-02', 'check']]);
  assert.deepEqual(rows('Exam: February 30'), [], 'no such day in any year');
  // A term start that is known keeps the rule that serves a term across New Year.
  assert.deepEqual(rows('Exam 1: Dec 10\nExam 2: Jan 21', { start: FALL }), [['Exam 1', '2026-12-10', 'sure'], ['Exam 2', '2027-01-21', 'sure']]);
  assert.deepEqual(rows('Exam 1: Jan 20\nExam 2: Mar 3', { start: SPRING }), [['Exam 1', '2027-01-20', 'sure'], ['Exam 2', '2027-03-03', 'sure']]);
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

// ACA-3: this used to send importTask a second time with the same id and a new day and title, which the caller could never
// do (its ids were made from the day and title). A saved row keeps its id now, so the edits come from the caller's own path.
test('a date edited and saved again to Better To Do keeps whether it was done, and its steps', () => {
  const T = require('../lib/todo.js');
  const [r] = S.ids([{ title: 'Midterm exam', day: '2026-11-04', kind: 'exam' }]);
  const id = S.taskId('25', r);
  const send = (d, o) => { for (const e of S.taskEdits({ cid: '25', note: 'From your syllabus', at: 1, picked: new Set(), ...o })) T.edit(d, e); };
  const d = T.clean({});
  send(d, { now: [r], picked: new Set([r.id]), tasks: [] });
  T.edit(d, ['taskDone', id, 5000]);
  T.edit(d, ['addStep', `task:${id}`, { id: 's1', title: 'Review chapter 3' }]);
  const moved = { ...r, title: 'Midterm exam 1', day: '2026-11-05' };
  send(d, { was: [r], now: [moved], picked: new Set([r.id]), tasks: d.tasks });
  const out = T.clean(d);
  assert.equal(out.tasks.length, 1, 'one task, not one for each version of the row');
  assert.equal(out.tasks[0].done, 5000, 'still done');
  assert.equal(out.tasks[0].title, 'Midterm exam 1');
  assert.deepEqual(out.tasks[0].due, { day: '2026-11-05' });
  assert.equal(out.items[`task:${id}`].subs[0].title, 'Review chapter 3');
  const fresh = { ...r, id: 'brandnew', title: 'Paper' };
  send(d, { was: [moved], now: [moved, fresh], picked: new Set(['brandnew']), tasks: d.tasks });
  T.edit(d, ['importTask', { id: 'syl-25-new', title: 'x', cid: '25', due: { day: '2026-11-06' }, done: 9 }]);
  assert.equal(T.clean(d).tasks.find((x) => x.id === 'syl-25-brandnew').done, 0, 'a new one starts not done');
  assert.equal(T.clean(d).tasks.find((x) => x.id === 'syl-25-new').done, 0, 'whatever the caller says');
});

// Syllabi as a PDF's text layer gives them (lib/doctext.js pdfText): icon glyphs and tabs before labels, tables read cell
// by cell, a table of contents, numbered sections. Shapes copied from real syllabi; names, courses and numbers made up.
test('an office-hours note comes from a line the label starts, not a heading that lists it or a sentence that mentions it', () => {
  const r = S.extract(`Department secretary's telephone number and e-mail address:
Telephone No.: (555)-010-2000\tE-mail address: deptoffice@example.edu
Semester offered: Fall 2026
Faculty member's name, office hours, and e-mail address:
Instructor’s Name: Dr. Lindqvist
Office Hours: Per student's requests
E-mail: lindqviste@example.edu (preferred method of contact)`, { start: FALL, md: true });
  assert.deepEqual([r.prof.name.value, r.prof.email.value, r.prof.note.value], ['Dr. Lindqvist', 'lindqviste@example.edu', "Per student's requests"]);
  const said = S.extract('•\tI encourage you to attend office hours regularly and take advantage of the free tutoring\nservices available through the Learning Center.');
  assert.equal(said.prof.note.value, '');
  assert.equal(S.extract('▪\tVirtual Office Hours: by appointment').prof.note.value, 'by appointment');
  assert.equal(S.extract('Office hours by appointment only').prof.note.value, 'by appointment only');
});

test('office hours given twice are one, with the icon before their label taken as a bullet and the place kept whole', () => {
  const r = S.extract(`CONTACT INFORMATION
●\tProf. Elena Varga-Ruiz
✉\tEmail: vargaruize@example.edu
Replies within 24 hours on weekdays.
▦\tVirtual Office Hours
Wednesdays, 2:00–3:30 p.m.
▶\tMicrosoft Teams
Prof. Varga’s Virtual Room

1.1. Your instructor
▪\tContact Info: Prof. Elena Varga-Ruiz
▪\tEmail: vargaruize@example.edu
▪\tVirtual Office Hours: Wednesdays, 2:00 PM – 3:30 PM via Microsoft Teams - Prof.
Varga's Virtual Room. (Please allow up to 24 hours for email replies).`, { start: FALL, md: true });
  assert.deepEqual(r.hours.map((m) => [m.label, m.days.join(' '), m.start, m.end, m.location]), [['Virtual Office Hours', 'WE', '14:00', '15:30', 'Microsoft Teams']]);
  assert.deepEqual([r.prof.name.value, r.prof.email.value], ['Prof. Elena Varga-Ruiz', 'vargaruize@example.edu']);
});

test('a table of contents and numbered section headings are not dates; a day-first date still is', () => {
  const r = S.extract(`Table of contents (clickable links)
1.\tCOURSE INFORMATION.......................................................... 2
1.1.\tYOUR INSTRUCTOR ............................................................ 2
3.\tGRADING INFORMATION.......................................................... 8
3.1.\tGRADE DISTRIBUTION AND SCALE ............................................... 8
3.2.\tQUIZZES .................................................................... 9
3.3.\tHOMEWORK AND LATE WORK POLICY .............................................. 9
3.4.\tVIDEO ASSIGNMENTS........................................................... 9
6.\tRUBRICS..................................................................... 18
6.1.\tORAL PRESENTATIONS.......................................................... 18
6.2.\tDISCUSSION BOARDS .......................................................... 19

1. Course Information
1.1. Your instructor
3. Grading Information
3.1. Grade Distribution And Scale
3.2. Quizzes
•\tYou will have four tests throughout the course.
3.3. Homework And Late Work Policy
3.3.1. Late homework
3.4. Video Assignments
6. Rubrics
6.1. Oral Presentations
6.2. Discussion Boards`, { start: FALL, md: true });
  assert.deepEqual(pick(r).dates, []);
  // Day-first dates as German syllabi write them, alone or at a schedule row's start, are still dates.
  const de = S.extract('Klausur am 4.2.\n11.11.\tAbgabe des Exposés\n1. Sitzung: Einführung', { start: Date.UTC(2026, 9, 12) });
  assert.deepEqual(pick(de).dates, ['2027-02-04 exam Klausur', '2026-11-11 due Abgabe des Exposés']);
});

test('weights from a table read cell by cell, a table with its total, and a chart\'s labels each above its percent', () => {
  const units = [[12, 10], [10, 10], [10, 10], [8, 10], [10, 10]].map(([p, q], i) => `UNIT ${i + 1}\nProblem set ${i + 1}\nQuiz ${i + 1}\n${p}%\n${q}%\n5th day of week ${i + 1}`).join('\n');
  const cells = S.extract(`Quizzes:
Each of the five units ends with a quiz. All assessments are out of 100 points with the following weights assigned to each.
Grading Methods for assessing student performance – Percentage & Schedule:
Name\tWeight\tDate/Schedule
${units}

An approximate guideline for grade distribution is as follows:`).weights;
  assert.deepEqual([S.weightsText(cells.value), cells.conf], ['Problem set 50%, Quiz 50%', 'sure'], 'a numbered series of one kind is one category');
  const pie = `Homework
40%
Unit tests
20%
Audio
recordings
10%
Video
Projects
20%
Discussions
10%
FINAL GRADE CALCULATION`;
  const both = S.extract(`4.1. Grade Distribution And Scale
•\tThe grading scale is as follows:
Grades Breakdown
Percentage
Online Platform Categories: Homework, Audio Recordings, Unit Tests\t70%
Discussion Forums\t20%
Video Projects\t10%
Total\t100%
Extra Credit\tAdditional opportunity
•\tLate work will have a 10% penalty. If there are circumstances preventing you from
submitting an assignment on time, please write to your professor.
Points\tGrade
93 and above\tA
90 – 92\tA-
80 – 89\tB
70 – 79\tC
60 – 69\tD
59 and below\tF
${pie}`).weights;
  assert.equal(S.weightsText(both.value), 'Homework / Audio Recordings / Unit Tests 70%, Discussion Forums 20%, Video Projects 10%', 'a total is no category');
  assert.ok(S.parseWeights(S.weightsText(both.value)), 'what the review screen shows can be saved as it is');
  assert.equal(pick(S.extract(`Points\tGrade\n59 and below\tF\n${pie}`)).weights, 'Homework 40%, Unit tests 20%, Audio recordings 10%, Video Projects 20%, Discussions 10%', 'the chart\'s title is no category');
  assert.equal(pick(S.extract('Breakdown\n10%\nParticipation\n40%\nEssays\n50%\nFinal portfolio')).weights, '', 'a label at each end, and neither a heading: either reading could be right');
});

// Deadlines by course week: days from week 1's first day, the anchor, which is a start the text states, else the course's
// own (opts.week1), else the term's (opts.start); never a guess without one.
test('deadlines by course week become days from week 1, which the text, the course or the term gives', () => {
  const rows = (r) => r.dates.map((d) => `${d.day} ${d.kind} ${d.title}${d.week ? ` w${d.week}/${d.wd}` : ''} ${d.conf}`);
  const week1 = (r) => [r.week1.value, r.week1.from, r.week1.conf];
  const table = `Due dates of quizzes and assignments for each Unit will be the 7th day (Sunday) of each week.
Name\tWeight\tDate/Schedule
${[1, 2, 3].map((k) => `UNIT ${k}\nHomework ${k}\nQuiz ${k}\n${k === 2 ? 14 : 18}%\n${16}%\n7th day of week ${k}`).join('\n')}
`;
  const term = S.extract(table, { start: Date.UTC(2026, 7, 31), md: true });
  assert.deepEqual(rows(term), [
    '2026-09-06 due Homework 1 w1/6 check', '2026-09-06 exam Quiz 1 w1/6 check', '2026-09-13 due Homework 2 w2/6 check',
    '2026-09-13 exam Quiz 2 w2/6 check', '2026-09-20 due Homework 3 w3/6 check', '2026-09-20 exam Quiz 3 w3/6 check']);
  assert.deepEqual(week1(term), ['2026-08-31', 'term', 'check']);
  assert.match(term.week1.src, /./);
  const course = S.extract(table, { start: Date.UTC(2026, 7, 31), week1: Date.UTC(2026, 9, 19), md: true });
  assert.deepEqual([course.dates[1].day, course.dates[5].day, ...week1(course)], ['2026-10-25', '2026-11-08', '2026-10-19', 'course', 'sure'], 'the course\'s own start beats the term\'s');

  const stated = S.extract(`Our 7-week course runs from November 2 to December 20, 2026.
Week 5 – Friday: Lab report 2 due
Quiz 4 (end of week 4)
Reflection paper due Sunday of Week 2`, { start: Date.UTC(2026, 7, 31), week1: Date.UTC(2026, 9, 19), md: true });
  assert.deepEqual(rows(stated), ['2026-12-04 due Lab report 2 due w5/4 check', '2026-11-29 exam Quiz 4 w4/6 check', '2026-11-15 due Reflection paper due w2/6 check']);
  assert.deepEqual(week1(stated), ['2026-11-02', 'text', 'sure'], 'a start the text states beats the course\'s and the term\'s');

  // A schedule that dates its own weeks: each week's dates place its deadlines, not arithmetic.
  const schedule = S.extract(`Week 1 (Aug 24–28)
Syllabus quiz due Friday
Week 3 (Sept 14–18)
Reading: Chapter 4
Essay 1 due Friday
Week 4 (Sept 21–25)
Quiz 2 on Wednesday`, { start: Date.UTC(2026, 8, 7), md: true });
  assert.deepEqual(rows(schedule), ['2026-08-28 exam Syllabus quiz due check', '2026-09-18 due Essay 1 due check', '2026-09-23 exam Quiz 2 check']);
  assert.deepEqual(week1(schedule), ['2026-08-24', 'text', 'check']);

  // Week 1 starts on the anchor's own day: a course that starts on a Wednesday has Wednesday-to-Tuesday weeks.
  const midweek = S.extract('Lab 1 due Friday of week 1\nLab 2 due Monday of week 2', { week1: Date.UTC(2026, 8, 2) });
  assert.deepEqual(rows(midweek), ['2026-09-04 due Lab 1 due w1/2 check', '2026-09-14 due Lab 2 due w2/5 check']);

  const oct12 = { start: Date.UTC(2026, 9, 12) };
  const one = (text, hint) => rows(S.extract(text, { ...oct12, hint }));
  assert.deepEqual(one('Abgabe Essay: Freitag der Woche 3', 'de'), ['2026-10-30 due Abgabe Essay w3/4 check']);
  assert.deepEqual(one('Hausarbeit: Freitag, KW 45', 'de'), ['2026-11-06 due Hausarbeit check'], 'a calendar week is the year\'s, Monday first');
  assert.deepEqual(one('Entrega del ensayo: viernes de la semana 2', 'es'), ['2026-10-23 due Entrega del ensayo w2/4 check']);
  assert.deepEqual(one('Rendu du dossier : vendredi de la semaine 2', 'fr'), ['2026-10-23 due Rendu du dossier w2/4 check']);
  assert.deepEqual(one('Inleveren verslag: vrijdag van week 2', 'nl'), ['2026-10-23 due Inleveren verslag w2/4 check']);
  assert.deepEqual(one('Entrega do trabalho: sexta-feira da semana 2', 'pt'), ['2026-10-23 due Entrega do trabalho w2/4 check']);

  // No anchor at all: no week-based rows, and no week 1.
  const none = S.extract('Quiz 4 (end of week 4)\nLab report due Friday of week 2');
  assert.deepEqual([none.dates, week1(none)], [[], ['', '', '']]);
  assert.deepEqual(week1(S.extract('Exam: Oct 14', oct12)), ['', '', ''], 'no week-based date, no week 1');
  assert.deepEqual(S.extract('Due dates for each module will be the 7th day (Sunday) of each week.\nWeek 2: no class', oct12).dates, []);

  assert.equal(S.weekDay('2026-11-02', 5, 4), '2026-12-04');
  assert.equal(S.weekDay('2026-08-31', 1, 6), '2026-09-06');
  assert.equal(S.weekDay('2026-02-30', 1, 0), '');
  assert.equal(S.weekDay('2026-08-31', 0, 0), '');
  assert.equal(S.weekDay('2026-08-31', 1, 7), '');
});
