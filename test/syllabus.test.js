// Syllabus import (lib/syllabus.js): the extractors on syllabi written for these tests, in several layouts and the six
// languages Glaze speaks, the way they reach it (pasted text, Canvas's Syllabus page through lib/doctext.js). Each
// field is checked exactly; a field the heuristics can't read must come back empty, never wrong.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/syllabus.js');
const D = require('../lib/doctext.js');

test('section-like digits and contents leaders stay bounded at the input limit', () => {
  const { spawnSync } = require('node:child_process');
  const probe = spawnSync(process.execPath, ['-e', `
    const S = require(${JSON.stringify(require.resolve('../lib/syllabus.js'))});
    for (const text of [
      ('1.' + '1'.repeat(1990) + '!\\n').repeat(101),
      ('Quiz ' + '. '.repeat(990) + '!\\n').repeat(101),
    ]) S.extract(text, { start: Date.UTC(2026, 7, 31) });
  `], { timeout: 3000, encoding: 'utf8' });
  assert.equal(probe.error, undefined, 'long digit runs must not cause exponential section matching');
  assert.equal(probe.status, 0, probe.stderr);
});

test('unmatched parentheses at the input limit are read in one pass', () => {
  const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };
  for (const text of ['('.repeat(S.MAX), '(word '.repeat(S.MAX / 6), `Homework (${'1 '.repeat(S.MAX / 2 - 10)}%`, `${'(Quiz 10% '.repeat(S.MAX / 10)}`]) {
    const t0 = cpu();
    S.extract(text, { start: Date.UTC(2026, 7, 31) });
    assert.ok(cpu() - t0 < 1500, `${Math.round(cpu() - t0)} ms for ${JSON.stringify(text.slice(0, 12))}…`);
  }
});

test('dense schedules at the input limit are read in one pass', () => {
  const cpu = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };
  const lines = (l) => `${l.repeat(Math.ceil(2000 / l.length)).slice(0, 1999)}\n`.repeat(100);
  for (const text of [lines('Exam Oct 5-7 '), lines('Quiz 10/5 '), lines('opens Oct 5 and by Oct 7 Exam '), 'Mon\nSep 4\nTopic\tProblem Set 1\ndue\n'.repeat(5000),
    'Quizzes are due every Monday. Final exam: Dec 11\n'.repeat(4000), 'Exam 1 (Thu\n'.repeat(16000)]) {
    const t0 = cpu();
    S.extract(text, { start: Date.UTC(2026, 7, 31), week1: Date.UTC(2026, 7, 31), md: true });
    assert.ok(cpu() - t0 < 1500, `${Math.round(cpu() - t0)} ms for ${JSON.stringify(text.slice(0, 20))}…`);
  }
});

test('nested section numbers are no dates; a two-digit year still is', () => {
  const o = { start: Date.UTC(2026, 7, 31) };
  assert.deepEqual(S.extract('4. Assessment\n4.1. Exams\n4.1.10. Final exam rules\n4.1.11. Quiz policy', o).dates, []);
  assert.deepEqual(S.extract('Klausur 4.1.10.\nSee 3.2.1. Exam format', o).dates, []);
  assert.deepEqual(S.extract('Klausur am 4.2.27\nAbgabe: 11.11.', { ...o, hint: 'de' }).dates.map((d) => d.day), ['2027-02-04', '2026-11-11']);
});

test('weight columns reject extra category cells instead of shifting their percentages', () => {
  for (const labels of ['Homework\nQuizzes\nFinal project', 'Homework\nFinal\nproject']) {
    assert.equal(S.extract(`Grading\n${labels}\n20%\n80%`).weights.value, '');
  }
  assert.equal(pick(S.extract('Grading\nUNIT 1\nHomework\nQuizzes\n20%\n80%')).weights, 'Homework 20%, Quizzes 80%');
});

test('only distinct consecutive numbered weight items fold into a category', () => {
  for (const names of [['CO2', 'CO3', 'CO4'], ['Homework 1', 'Homework 1', 'Homework 2'], ['Quiz 1', 'Quiz 3', 'Quiz 5']]) {
    const rows = names.map((name, i) => ({ name, weight: [20, 30, 50][i] }));
    assert.deepEqual(S.extract(`Grading\n${S.weightsText(rows).replaceAll(', ', '\n')}`).weights.value, rows);
  }
  for (const name of ['Homework', 'Hausaufgabe', 'Tarea', 'Devoir', 'Opdracht', 'Trabalho']) {
    assert.deepEqual(S.extract(`Grading\n${[1, 2, 3].map((i) => `${name} ${i} ${[20, 30, 50][i - 1]}%`).join('\n')}`).weights.value,
      [{ name, weight: 100 }]);
  }
});

test('week anchors use the course year and reject unrelated start dates', () => {
  const course = Date.UTC(2030, 9, 7);
  for (const [hint, header, due] of [
    ['en', 'Week 1 (October 7)', 'Quiz due Friday of week 2'],
    ['de', 'Woche 1 (7. Oktober)', 'Abgabe Freitag der Woche 2'],
    ['es', 'Semana 1 (7 de octubre)', 'Entrega viernes de la semana 2'],
    ['fr', 'Semaine 1 (7 octobre)', 'Rendu vendredi de la semaine 2'],
    ['nl', 'Week 1 (7 oktober)', 'Inleveren vrijdag van week 2'],
    ['pt', 'Semana 1 (7 de outubro)', 'Entrega sexta-feira da semana 2'],
  ]) {
    const r = S.extract(`${header}\n${due}`, { week1: course, hint });
    assert.equal(r.week1.value, '2030-10-07');
    assert.equal(r.dates[0].day, '2030-10-18');
  }
  for (const label of ['Project start date: October 12', 'The course project starts October 12']) {
    const r = S.extract(`${label}\nQuiz due Friday of week 2`, { start: FALL });
    assert.equal(r.week1.value, '2026-08-24');
    assert.equal(r.dates.at(-1).day, '2026-09-04');
  }
  const toc = S.extract('Week 1 (October 12) ........ 4\nQuiz due Friday of week 2', { start: FALL });
  assert.equal(toc.week1.value, '2026-08-24');
});

test('week context ends at a section break and ambiguous weekdays stay empty', () => {
  const r = S.extract('Week 2\nQuiz due Friday\n\nOffice policies\nProject proposals may be discussed on Monday during office hours.', { start: FALL });
  assert.deepEqual(r.dates.map((d) => [d.day, d.title]), [['2026-09-04', 'Quiz due']]);
  for (const text of ['Week 2: Monday quiz, Friday project due', 'Quiz due Friday of week 2 or Friday of week 3']) {
    assert.deepEqual(S.extract(text, { start: FALL }).dates, []);
  }
  assert.deepEqual(S.extract('Week 2 (Sept 7-9)\nQuiz due Friday', { start: FALL }).dates, []);
  const dated = S.extract('Week 2 (Sept 7-11): Quiz due Friday', { start: FALL });
  assert.deepEqual(dated.dates.map((d) => [d.day, d.title]), [['2026-09-11', 'Quiz due']]);
});

test('calendar weeks respect ISO year boundaries and explicitly written years', () => {
  const dates = (text, start) => S.extract(text, { start: start && Date.parse(`${start}T00:00:00Z`), hint: 'de' }).dates;
  assert.deepEqual(dates('Hausarbeit: Freitag, KW 53', '2027-01-04').map((d) => d.day), ['2027-01-01']);
  assert.deepEqual(dates('Hausarbeit: Montag, KW 1', '2026-12-28').map((d) => d.day), ['2027-01-04']);
  assert.deepEqual(dates('Hausarbeit: Freitag, KW 53', '2027-08-30'), [], '2027 has only 52 ISO weeks');
  assert.deepEqual(dates('Hausarbeit: Freitag, KW 45/2027', '2026-10-12').map((d) => [d.day, d.title]), [['2027-11-12', 'Hausarbeit']]);
  assert.deepEqual(dates('Hausarbeit: KW 45/2027 Freitag').map((d) => d.day), ['2027-11-12']);
  assert.deepEqual(dates('Hausarbeit: Freitag, KW 53/2027', '2026-10-12'), []);
  assert.deepEqual(dates('Hausarbeit: Freitag, KW 45/27', '2026-10-12'), [], 'an unsupported year must not be discarded');
});

test('week arithmetic stays in UTC across both daylight saving changes', () => {
  const { spawnSync } = require('node:child_process');
  for (const TZ of ['UTC', 'America/New_York', 'Europe/Berlin', 'Pacific/Auckland']) {
    const r = spawnSync(process.execPath, ['-e', `
      const S = require(${JSON.stringify(require.resolve('../lib/syllabus.js'))});
      console.log(JSON.stringify([
        S.weekDay('2027-03-08', 2, 6), S.weekDay('2026-10-26', 2, 6),
        S.extract('Quiz due Monday of week 2', {week1: Date.UTC(2027, 2, 10)}).dates[0].day,
        S.extract('Klausur am 4.2.', {start: Date.UTC(2027, 0, 11), md: true}).dates[0].day,
        S.extract('Exam 4/2', {start: Date.UTC(2027, 0, 11), md: true}).dates[0].day,
        S.extract('Examen 4/2', {start: Date.UTC(2027, 0, 11), md: false}).dates[0].day,
      ]));
    `], { env: { ...process.env, TZ }, encoding: 'utf8', timeout: 3000 });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), ['2027-03-21', '2026-11-08', '2027-03-22', '2027-02-04', '2027-04-02', '2027-02-04'], TZ);
  }
});

test('dated table cells remain dates when a section number matches their day', () => {
  for (const [header, exam] of [['Date', 'Exam'], ['Datum', 'Klausur'], ['Fecha', 'Examen'], ['Date', 'Partiel'], ['Datum', 'Tentamen'], ['Data', 'Prova']]) {
    const text = `4. Assessment\n${header}\tAssessment\n4.1.\t${exam} 1\n4.2.\t${exam} 2`;
    assert.deepEqual(S.extract(text, { start: Date.UTC(2026, 9, 12) }).dates.map((d) => d.day), ['2027-01-04', '2027-02-04']);
  }
});

test('week schedules do not create deadlines for explicitly absent assessments', () => {
  for (const [header, row] of [
    ['Week 2', 'Monday\tNo quiz this week'], ['Week 2', 'Monday\tLabor Day - no due dates'],
    ['Woche 2', 'Montag\tKeine Prüfung diese Woche'], ['Semana 2', 'lunes\tNo hay examen esta semana'],
    ['Semaine 2', 'lundi\tPas de contrôle cette semaine'], ['Week 2', 'maandag\tGeen tentamen deze week'],
    ['Semana 2', 'segunda-feira\tSem prova nesta semana'],
  ]) assert.deepEqual(S.extract(`${header}\n${row}`, { start: FALL }).dates, [], row);
  assert.deepEqual(S.extract('Week 2 (Sept 7-11): Monday quiz, Friday project due', { start: FALL }).dates, [],
    'an ambiguous week row must not fall back to using the week start as its deadline');
});

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
  assert.deepEqual(rows('Final exam: December 15-17'), [['Final exam · December 15-17', '2026-12-17', 'check']], 'a window is its last day, still a guess');
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

// Owner, 2026-10-26: an exam window is one date, its last day, to check, with the window in the title.
test('date ranges are their last day with the window in the title, and numeric dates that read either way are guesses', () => {
  const d = (text, md) => S.extract(text, { start: FALL, md }).dates.map((x) => [x.title, x.day, x.conf]);
  assert.deepEqual(d('Final exam: December 15-17'), [['Final exam · December 15-17', '2026-12-17', 'check']]);
  assert.deepEqual(d('Partiel : 15–17 décembre 2026'), [['Partiel · 15-17 décembre 2026', '2026-12-17', 'check']]);
  assert.deepEqual(d('Midterm exam: Oct 3–5, 2026'), [['Midterm exam · Oct 3-5, 2026', '2026-10-05', 'check']]);
  assert.deepEqual(d('Quiz 10/04/2026', true), [['Quiz', '2026-10-04', 'check']], 'October 4 or 10 April');
  assert.deepEqual(d('Quiz 10/24/2026', true), [['Quiz', '2026-10-24', 'sure']], 'only one reading');
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

  // A named weekday stays that weekday when the student moves week 1 to another weekday; "7th day of week 3" moves with it.
  const named = S.extract('Lab report due Friday of week 2\nQuiz 3 due on the 7th day of week 3', { week1: Date.UTC(2026, 8, 2) }).dates;
  assert.deepEqual(named.map((d) => [d.day, d.week, d.wd, d.dow]), [['2026-09-11', 2, 2, 'FR'], ['2026-09-22', 3, 6, undefined]]);
  assert.deepEqual(named.map((d) => S.weekDay('2026-09-02', d.week, d.wd, d.dow)), ['2026-09-11', '2026-09-22'], 'Wednesday anchor');
  assert.deepEqual(named.map((d) => S.weekDay('2026-08-31', d.week, d.wd, d.dow)), ['2026-09-11', '2026-09-20'], 'Monday anchor');
  for (const [text, dow] of [['Freitag der Woche 10', 'FR'], ['Week 5 – Friday: Lab report 2 due', 'FR'], ['Due Sunday of Week 2', 'SU']]) {
    assert.equal(S.extract(`Abgabe ${text}`, { week1: Date.UTC(2026, 8, 2), hint: 'de' }).dates[0]?.dow, dow, text);
  }
  assert.equal(S.weekDay('2026-08-31', 2, 2, 'XX'), '');
  assert.equal(S.weekDay('2026-11-02', 5, 4), '2026-12-04');
  assert.equal(S.weekDay('2026-08-31', 1, 6), '2026-09-06');
  assert.equal(S.weekDay('2026-02-30', 1, 0), '');
  assert.equal(S.weekDay('2026-08-31', 0, 0), '');
  assert.equal(S.weekDay('2026-08-31', 1, 7), '');
});

// Shapes from the mock corpus (research-based syllabi, 2026-10-26), with invented content: what a PDF's text, a DOCX
// table or a picture's text does to a schedule.
const days = (text, opts) => S.extract(text, opts).dates.map((d) => `${d.day} ${d.kind} ${d.title}`);

test('a deadline whose cell or sentence wrapped is read with its date', () => {
  const o = { start: FALL, md: true };
  assert.deepEqual(days('Wk\tDates\tTopic\tLab\tDue\n3\t9/7-9/11\tTides I\tNo lab\nCore sample (Marsh) due in\nlab Thu 9/17', o),
    ['2026-09-17 due Core sample (Marsh) due in lab']);
  assert.deepEqual(days('6\t9/28-10/2\tReview; EXAM 1 (Thu\n10/1, 7:00 pm)\tCh. 6', o), ['2026-10-01 exam 6 · Review; EXAM 1 · Ch. 6']);
  assert.deepEqual(days('Fri\nSep 4\nCurrents\tWorksheet 1\ndue\nWed\nOct 7\nMidterm I (in class)\tFormula sheet', o),
    ['2026-09-04 due Currents · Worksheet 1 due', '2026-10-07 exam Midterm I (in class) · Formula sheet']);
  assert.deepEqual(days('Semana\tFecha\tContenido\tActividad evaluable\n4\t29 de\nseptiembre\nMareas\tEntrega de la práctica 1 (viernes 2\nde octubre)', { start: FALL, hint: 'es' }),
    ['2026-10-02 due 4 · Mareas · Entrega de la práctica 1']);
  assert.deepEqual(days('Deadline conceptversie\nverslag: maandag 28\nseptember', { start: FALL, hint: 'nl' }), ['2026-09-28 due Deadline conceptversie verslag']);
  assert.deepEqual(days('Zusätzlich ist ein Exposé einzureichen: Abgabe der\nSkizze bis Mittwoch, KW 47.', { start: Date.UTC(2026, 9, 12), hint: 'de' }),
    ['2026-11-18 due Zusätzlich ist ein Exposé einzureichen: Abgabe der Skizze']);
  assert.deepEqual(days('Exercice 2 : dimanche de la\nsemaine 3, 23 h 59', { week1: Date.UTC(2026, 7, 31), hint: 'fr' }), ['2026-09-20 due Exercice 2']);
});

test('a schedule table counts what is due in its due column, and its rows\' dates for it', () => {
  const o = { start: FALL, md: true };
  const docx = `Week\tDate\tTopic / In Class\tReading Due\tAssignment Due
1\tSept. 1\tIntroductions\tSyllabus
2\tSept. 8\tSummary workshop\tModel essays\tDiscussion 1
\tSept. 10\tPeer review\t\tEssay 1 rough draft
10\tNov. 3\tResearch essay workshop
\tDec. 17\tNo class - finals week`;
  assert.deepEqual(days(docx, o), ['2026-09-08 due 2 · Summary workshop · Model essays · Discussion 1', '2026-09-10 due Peer review · Essay 1 rough draft']);
  assert.deepEqual(days('#\tTopic\tReleased\tDue\nA1\tStacks\tWed 8/26\tWed 9/9\nA2\tQueues\tWed 9/9\tWed 9/23', o),
    ['2026-09-09 due A1 · Stacks', '2026-09-23 due A2 · Queues']);
  assert.deepEqual(days('Termin\tThema\tÜbungsblatt\tAbgabe\nDi, 13.10.\tEinführung\tBlatt 1\tFr, 23.10., 12:00\nDi, 22.12.\tkeine Vorlesung', { start: Date.UTC(2026, 9, 12), hint: 'de' }),
    ['2026-10-23 due Einführung · Blatt 1']);
  assert.deepEqual(days('Data\tAula\tConteúdo\tAtividade\n02/03\t1\tApresentação da disciplina\n30/03\t8\tCasos de uso\tLista 2: entrega até a sexta-feira da semana 5\nInício das aulas: 01/03/2027', { start: SPRING, hint: 'pt' }),
    ['2027-04-02 due 8 · Casos de uso · Lista 2: entrega'], 'a topic is no deadline; a due cell\'s week is the row\'s deadline');
  assert.deepEqual(days('Wk Dates\tTopic\n6\tTue., Feb. 16 / Thu., Feb. 18\tStudent presentations as assessment', { start: SPRING }), [], 'a topic table with nothing due');
  assert.deepEqual(days('Nr.\tDatum\tThema\tReferat\n4\t04.11.2026\tMigration\tReferat Gruppe A', { start: Date.UTC(2026, 9, 12), hint: 'de' }),
    ['2026-11-04 due 4 · Migration · Referat Gruppe A'], 'a column named for what is handed in');
});

test('each time goes with what comes before it, and a row\'s own date with the rest', () => {
  const o = { start: FALL, hint: 'es' };
  assert.deepEqual(days('8\t27 de octubre\tRepaso y examen parcial\tExamen parcial (jueves 29 de octubre, en clase)', o),
    ['2026-10-29 exam 8 · Repaso y examen parcial · Examen parcial ( , en clase)'], 'the session\'s date is not the exam\'s');
  assert.deepEqual(days('Semana 2\t18/01 - 22/01\tEstados financieros\tCaso práctico 1: entrega 29/01', { start: SPRING, hint: 'es' }),
    ['2027-01-29 due Semana 2 · Estados financieros · Caso práctico 1: entrega'], 'a week\'s dates are not a deadline next to one');
  assert.deepEqual(days('Paper due Oct 5; revisions due Oct 19', { start: FALL }), ['2026-10-05 due Paper due', '2026-10-19 due Revisions due']);
  assert.deepEqual(days('Thanksgiving: there are no due dates on Thursday, November 26, but Week 4 work is still due on day 7.', { start: FALL }), []);
  assert.deepEqual(days('Quiz 3 on Oct 5 or Oct 7', { start: FALL }), [], 'either day');
});

test('several things due on one line are a row each, and a week row\'s things without a day are due its last day', () => {
  const week1 = Date.UTC(2026, 10, 2);
  assert.deepEqual(days('Homework 2.1-2.4; Quiz 2; Discussion 1 (initial post by day 4) - due by 11:59 p.m. on the 7th\nday of Week 2', { week1 }),
    ['2026-11-15 due Homework 2.1-2.4', '2026-11-15 exam Quiz 2', '2026-11-15 due Discussion 1 (initial post by day 4) - due']);
  const row = 'Week\tTopics\tAssignments\nWeek 2 (Nov 9-15)\tPricing\tDiscussion 2: initial post Thursday of Week 2, replies Sunday of Week 2 Quiz 2 (Chapters 3-4) Case Study 1 due Sunday, November 15';
  assert.deepEqual(days(row, { week1 }), ['2026-11-12 due Discussion 2: initial post', '2026-11-15 due Discussion 2: replies', '2026-11-15 exam Quiz 2 (Chapters )', '2026-11-15 due Case Study 1 due']);
  assert.deepEqual(days('Week & Dates\t(Tt)\tContents\tAssignments & Assessments\nNov. 2-8\tModule 1 Lesson 5\tOnline Assignments · Discussion #1: Introductions', { start: Date.UTC(2026, 7, 31) }),
    ['2026-11-08 due Online Assignments', '2026-11-08 due Discussion #1: Introductions'], 'a picture\'s table read with one cell fewer');
  assert.deepEqual(days('Week\tMonday\tContent\nWeek 3 (Sept 14-20)\nMon\tTides\tQuiz 2\nWed\tWaves\tLab report 1 due', { start: FALL }),
    ['2026-09-14 exam Tides · Quiz 2', '2026-09-16 due Waves · Lab report 1 due'], 'a weekday\'s row under its week');
});

test('a window or a week is its last day, to check, with the window in the title', () => {
  const o = { start: FALL };
  assert.deepEqual(S.extract('Final Exam (proctored): opens Wednesday, December 16 and must be completed\nby Saturday, December 19, 11:59 p.m.', o).dates.map((d) => [d.day, d.kind, d.title, d.conf]),
    [['2026-12-19', 'exam', 'Final Exam (proctored) · opens Wednesday, December 16', 'check']]);
  assert.deepEqual(days('Exam 2 available Oct 5 thru Oct 7', o), ['2026-10-07 exam Exam 2 · available Oct 5 thru Oct 7']);
  assert.deepEqual(days('Lab Practical - week of Nov. 16, in your lab section', o), ['2026-11-22 exam Lab Practical - , in your lab section · week of Nov. 16']);
  assert.deepEqual(days('Parcial: del 11 al 15 de octubre', { start: FALL, hint: 'es' }), ['2026-10-15 exam Parcial · del 11 al 15 de octubre']);
});

test('worked examples, ungraded work and topics that only mention a thing handed in are no deadlines', () => {
  const o = { start: FALL };
  assert.deepEqual(days('For example, if a paper is due Friday, March 6 and you submit it Saturday, you lose 10%.', o), []);
  assert.deepEqual(days('15\t15 de diciembre\tRepaso\tCuestionario de autoevaluación (no puntúa)', { ...o, hint: 'es' }), []);
  assert.deepEqual(days('Wed., Jan. 27: Empire and the paper state.\nDec. 10\tPortfolio workshop\nExam 2 review session: Oct 3', { start: SPRING }), []);
  assert.deepEqual(days('Midterm paper (8-10 pp.) due Fri., March 5', { start: SPRING }), ['2027-03-05 due Midterm paper ( pp.) due']);
  assert.deepEqual(days('Tue 9/29 - Prelim 1, 7:30-9:00 PM, Ruiz Hall', { start: FALL, md: true }), ['2026-09-29 exam Prelim 1, Ruiz Hall']);
});

// Owner, 2026-10-26: a weekly rule is a row on each of its days across the course, to check, marked as one rule.
test('a weekly rule is a row each week within stated course dates, without the breaks the text names', () => {
  const rule = (text, opts) => S.extract(text, opts).dates.filter((d) => d.rule === 'weekly').map((d) => `${d.day} ${d.kind} ${d.title}`);
  const text = `Weekly online quizzes are due Mondays at 11:59 PM.
Mon 9/7 - Labor Day: no class
Sat 10/10 - Tue 10/13 - Fall break
Final exam: Sat 10/24
Course ends: October 24`;
  assert.deepEqual(rule(text, { start: FALL, md: true, week1: FALL }), ['2026-08-31', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-19'].map((d) => `${d} exam Weekly online quizzes`));
  assert.ok(S.extract(text, { start: FALL, md: true, week1: FALL }).dates.filter((d) => d.rule).every((d) => d.conf === 'check'));
  for (const [hint, line] of [['de', 'Abgabe der Übungsblätter jeweils freitags bis 12 Uhr.'], ['es', 'Las tareas se entregan todos los viernes.'], ['fr', 'Les devoirs sont à remettre chaque vendredi.'],
    ['nl', 'Opdrachten inleveren elke vrijdag.'], ['pt', 'Os trabalhos devem ser entregues toda sexta-feira.'], ['en', 'Reading responses close every Friday.']]) {
    assert.deepEqual(rule(`${line}\nCourse ends: Sept 30, 2026`, { week1: Date.UTC(2026, 8, 7), hint }).map((d) => d.slice(0, 14)), ['2026-09-11 due', '2026-09-18 due', '2026-09-25 due'], line);
  }
  assert.deepEqual(rule('Assignments are released on Wednesdays and due two weeks later.\nFinal exam: Dec 10', { week1: FALL }), [], 'released, not due, on Wednesdays');
  assert.deepEqual(rule('Weekly quizzes are due Mondays.', { week1: FALL }), [], 'no last day to stop at');
  assert.deepEqual(rule('Abgabe jeweils freitags.\nTermin\tAbgabe\nDi, 13.10.\tFr, 23.10.\nDi, 20.10.\tFr, 30.10.', { start: Date.UTC(2026, 9, 12), hint: 'de' }), [], 'the schedule dates them itself');
});

const slots = (list) => list.map((m) => `${m.label ? `${m.label} | ` : ''}${m.days.join(' ')} ${m.start}-${m.end}${m.location ? ` | ${m.location}` : ''}`);

test('dated rows, room numbers and a course week\'s times are no class meetings', () => {
  const de = S.extract('Übung: Do 14:15–15:45, SR 1.07\nTermin\tThema\tÜbungsblatt\tAbgabe\nDi, 13.10.\tEinführung\tBlatt 1\tFr, 23.10., 12:00', { start: FALL, hint: 'de' });
  assert.deepEqual(slots(de.meetings), ['Übung | TH 14:15-15:45 | SR 1.07']);
  const r = S.extract(`Lecture: MWF 9:00–9:50, Hall 1
2\t1/18/2027\tClass moves to Tue 1/19/2027, 0800–1150
Tue 9/29 - Prelim 1, 7:30–9:00 PM, Ruiz Hall
A course week runs from Monday 12:00 a.m. through Sunday 11:59 p.m.; day 7 of a week is its
Sunday. Plan on 15–18 hours of work per week.
Inleveren verslag: week 6,
vrijdag 17.00 uur`, { start: FALL });
  assert.deepEqual(slots(r.meetings), ['Lecture | MO WE FR 09:00-09:50 | Hall 1']);
});

test('office hours: a 24-hour clock, cum tempore, a staff table\'s column, a TA\'s with the role, and more labels', () => {
  const r = S.extract(`Office Hours: Tuesday 1230–1430 and Thursday 0900–1000, or by appointment
Clinical: Wednesdays 0645–1515 at assigned facility`, { hint: 'en' });
  assert.deepEqual(slots(r.hours), ['Office Hours | TU 12:30-14:30', 'Office Hours | TH 09:00-10:00']);
  assert.deepEqual(slots(r.meetings), ['Clinical | WE 06:45-15:15 | assigned facility']);
  assert.deepEqual(slots(S.extract('Vorlesung: Di 10–12 Uhr (c.t.), HS 3', { hint: 'de' }).meetings), ['Vorlesung | TU 10:15-11:45 | HS 3']);
  assert.equal(r.prof.note.value, '', 'times read are no note');
  const staff = S.extract('Role\tName\tEmail\tOffice Hours\nInstructor\tProf. Ana Ruiz\taruiz@x.edu\tMon 2–3:30 PM, Hall 412\nTA\tSam Lee\tslee@x.edu\tFri 1–3 PM, Lab 2');
  assert.deepEqual([slots(staff.hours), staff.meetings], [['MO 14:00-15:30 | Hall 412', 'TA | FR 13:00-15:00 | Lab 2'], []]);
  assert.deepEqual(slots(S.extract('▦\tVirtual Office Hours\nThursdays, 10:00–11:30 a.m.').hours), ['TH 10:00-11:30'], 'an icon\'s cell is no table');
  assert.deepEqual(slots(S.extract('Teaching Assistant: Sam Lee · slee@x.edu · Office hours: Mon 3–4 pm, Room 5').hours), ['Teaching Assistant | MO 15:00-16:00 | Room 5']);
  assert.deepEqual(slots(S.extract('Übungsleitung: Jonas Weber (jw@x.de), Sprechzeit\nMo 9–10 Uhr, Raum 3.09', { hint: 'de' }).hours), ['Übungsleitung | MO 09:00-10:00 | Raum 3.09']);
  assert.deepEqual(slots(S.extract('Disponibilités : mardi 13 h à 15 h, local A-1', { hint: 'fr' }).hours), ['Disponibilités | TU 13:00-15:00 | local A-1']);
  assert.deepEqual(slots(S.extract('Atendimento: quartas-feiras, 14h às 16h, sala 3', { hint: 'pt' }).hours), ['Atendimento | WE 14:00-16:00 | sala 3']);
});

// Owner, 2026-10-26: grading in points only becomes percents of the total; letters on 0–10 or 0–20 become percents.
test('grading in points becomes percents of its total, and a scale in points or on 0–10 or 0–20 becomes percents', () => {
  const pts = S.extract(`Grade Breakdown
Assignment\tPoints
Lab notebooks (4 × 50 points)\t200
Problem sets\t150
Midterm\t250
Final project\t400
Total\t1000
Grading Scale
Grade\tPoints
A\t900–1000
B\t800–899
C\t700–799
D\t600–699
F\t599 and below`);
  assert.deepEqual([S.weightsText(pts.weights.value), pts.weights.conf], ['Lab notebooks 20%, Problem sets 15%, Midterm 25%, Final project 40%', 'check']);
  assert.deepEqual([pick(pts).scale, pts.scale.conf], ['A 90, B 80, C 70, D 60, F 0', 'check']);
  assert.match(pts.scale.src, /900-1000/, 'the source line as written');
  assert.equal(S.weightsText(S.extract('Grading\nHomework – 150 points\nQuizzes – 100 points\nExams – 750 points\nTotal – 1000 points').weights.value), 'Homework 15%, Quizzes 10%, Exams 75%');
  assert.equal(S.weightsText(S.extract('Course grade:\nHomework (150 pts)\nQuizzes (50 pts)').weights.value), 'Homework 75%, Quizzes 25%');
  assert.equal(S.extract('Assignment\tPoints\nEssays\t400\nQuizzes\t100\nTotal\t900').weights.value, '', 'a total that is not the sum');
  assert.equal(pick(S.extract('Grading Scale\nA: 900 points and above\nB: 800 points\nC: 700 points')).weights, '', 'a scale is no weights');
  assert.equal(pick(S.extract('Conceitos: A: 9,0 a 10,0; B: 7,5 a 8,9; C: 6,0 a 7,4; D: 0 a 5,9.', { hint: 'pt' })).scale, 'A 90, B 75, C 60, D 0');
  assert.equal(pick(S.extract('Barème : A : 16 à 20 ; B : 14 à 15,9 ; C : 12 à 13,9 ; D : 10 à 11,9 ; E : 0 à 9,9', { hint: 'fr' })).scale, 'A 80, B 70, C 60, D 50, E 0');
});

test('a sentence\'s percent beside a breakdown is no category, nor does an item\'s own label start a new block', () => {
  assert.equal(pick(S.extract('Completion\nThis course is Pass / No Pass. To pass you need 70% overall:\nJournals – 40%\nGrant draft – 30%\nPitch – 30%')).weights, 'Journals 40%, Grant draft 30%, Pitch 30%');
  assert.equal(pick(S.extract('Évaluation\tPondération\tDate\nExercices (6)\t10 %\tVoir le calendrier\nExamen intra\t30 %\tlundi 26 octobre\nProjet\t60 %\tlundi 30 novembre\nTout travail remis en retard sera pénalisé de 10 % par jour.', { hint: 'fr' })).weights,
    'Exercices 10%, Examen intra 30%, Projet 60%');
  assert.equal(pick(S.extract('Grading\nProgramming assignments (6): 36%\nPrelim 1: 15%\nPrelim 2: 15%\nFinal exam: 25%\nQuizzes and participation: 9%')).weights,
    'Programming assignments 36%, Prelim 1 15%, Prelim 2 15%, Final exam 25%, Quizzes and participation 9%');
  assert.equal(pick(S.extract('Toetsing\nTentamen\t70%\nGroepsopdracht (verslag + presentatie)\t30%', { hint: 'nl' })).weights, 'Tentamen 70%, Groepsopdracht 30%');
});

test('a professor\'s name ends at its table cell, a facilitator teaches, and an office can follow an e-mail on its line', () => {
  assert.equal(S.extract('Profesora:\tMtra. Clara Ibáñez Soto\tGrupo:\t4CP2', { hint: 'es' }).prof.name.value, 'Mtra. Clara Ibáñez Soto');
  assert.equal(S.extract('Facilitator: Marisol Okoye-Lind, MPA\nEmail: m.okoye@x.edu').prof.name.value, 'Marisol Okoye-Lind');
  assert.equal(S.extract('Lecturer: Dr. Ama Boateng\n✉ aboateng@x.edu · Office: LSB 3340').prof.office.value, 'LSB 3340');
});

test('a scale table of two columns read across, and a failing letter written after its bound', () => {
  const two = S.extract('Grading Scale\nGrade\tPercentage\tGrade\tPercentage\nA\t94–100\tC+\t77–79.99\nA-\t90–93.99\tC\t70–76.99\nB+\t87–89.99\tD\t60–69.99\nB\t84–86.99\tF\tbelow 60\nB-\t80–83.99');
  assert.equal(pick(two).scale, 'A 94, A- 90, B+ 87, B 84, B- 80, C+ 77, C 70, D 60, F 0');
  assert.match(two.scale.src, /B- · 80-83\.99/);
  assert.equal(pick(S.extract('Letter grades: 90–100% A, 80–89% B, 70–79% C, 60–69% D, below 60% F.')).scale, 'A 90, B 80, C 70, D 60, F 0');
  assert.equal(pick(S.extract('Letter grades: 90–100% A, 80–89% B, 70–79% C, 60–69% D; below 40% the course is failed.')).scale, 'A 90, B 80, C 70, D 60', 'no letter given');
});

test('an office named by a room\'s word and number is distinct from an office-hours venue', () => {
  assert.equal(S.extract('Profesora: Mtra. Clara Soto\nCubículo: 14, Edificio D', { hint: 'es' }).prof.office.value, 'Cubículo 14, Edificio D');
  const staff = S.extract('Role\tName\tEmail\tOffice Hours\nInstructor\tProf. Ana Ruiz\taruiz@x.edu\tMon 2–3:30 PM, Hall 412\nTA\tSam Lee\tslee@x.edu\tFri 1–3 PM, Lab 2');
  assert.deepEqual([staff.prof.office.value, staff.prof.office.conf], ['', '']);
  assert.equal(S.extract('Instructor: Dr. Lee Park\nOffice hours: Tuesdays 7–8 p.m. via Zoom').prof.office.value, '', 'a call is no office');
});

test('a scale table written range first ends with its capitalised "Below"', () => {
  assert.equal(pick(S.extract('Your Average\tCourse Grade\n90 – 100\tA\n80 – 89\tB\n70 – 79\tC\n60 – 69\tD\nBelow 60\tF')).scale, 'A 90, B 80, C 70, D 60, F 0');
});

// Round-two review: synthetic counterexamples, independent of the mock holdout corpus.
test('review: office-hours venues alone never identify the professor office', () => {
  for (const [hint, label] of [['en', 'Office hours'], ['de', 'Sprechstunden'], ['es', 'Horas de oficina'], ['fr', 'Heures de bureau'], ['nl', 'Spreekuur'], ['pt', 'Atendimento']]) {
    const text = `Instructor: Dr. Lee Park\n${label}: Monday 2–3 PM, Library 205`;
    assert.equal(S.extract(text, { hint }).prof.office.value, '', text);
    assert.equal(S.extract(`Office: Hall 410\n${text}`, { hint }).prof.office.value, 'Hall 410');
  }
});

const reviewPoints = 'Assignment\tPoints\nEssays\t400\nExams\t600\nTotal\t1000\n';
test('review: a points total cannot turn unrelated numbers or inconsistent scales into letter grades', () => {
  for (const tail of [
    'Room assignments\nA 900\nB 800\nC 700',
    'Grade\tPoints\nA 180–200\nB 160–179\nC 140–159',
    'Grade\tPoints\nA 900–1000\nB 80–89\nC 70–79',
    'Grade\tPoints\nA 900–1000\nB 800–950\nC 700–799',
  ]) assert.equal(S.extract(reviewPoints + tail).scale.value, '', tail);
  assert.deepEqual(S.extract(reviewPoints + 'Grade\tPoints\nA 900–1000\nB 800–899\nC 0–799').scale.value, [['A', 90], ['B', 80], ['C', 0]]);
});

test('review: short letter scales need an explicit maximum of ten or twenty', () => {
  for (const text of ['Conceitos\nA 9–9.5\nB 7–8.9\nC 0–6.9', 'Barème\nA 16–18\nB 14–15\nC 0–13']) {
    assert.equal(S.extract(text).scale.value, '', text);
  }
  assert.deepEqual(S.extract('Grading scale\nA 9–10%\nB 7–8.99%\nC 0–6.99%').scale.value, [['A', 9], ['B', 7], ['C', 0]]);
});

const reviewOpts = { start: Date.UTC(2026, 7, 31), week1: Date.UTC(2026, 7, 31), md: true };
const reviewWeekly = (text, opts = reviewOpts) => S.extract(text, opts).dates.filter((d) => d.rule === 'weekly');
test('review: weekly expansion rejects negation, examples, optional work and unresolved exceptions', () => {
  for (const line of [
    'No quizzes are due every Friday.', 'Quizzes are not due every Friday.',
    'Optional quizzes are due every Friday.', 'For example, quizzes are due every Friday.',
    'Quizzes are due every Friday except the first week.', 'Quizzes are due every Friday, except during spring break.',
    'Keine Abgabe jeweils freitags.', 'Las tareas no se entregan todos los viernes.',
    'Les devoirs ne sont pas à remettre chaque vendredi.', 'Geen opdrachten inleveren elke vrijdag.',
    'Os trabalhos não devem ser entregues toda sexta-feira.',
  ]) assert.deepEqual(reviewWeekly(`${line}\nCourse ends: September 25`), [], line);
});

test('review: recurring end dates and holidays belong to their own clauses', () => {
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday.\nClasses end: September 25; final exam: October 9').map((d) => d.day),
    ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25']);
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday.\nFall break (no classes) September 11; paper due September 18\nCourse ends: September 25').map((d) => d.day),
    ['2026-09-04', '2026-09-18', '2026-09-25']);
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday.\nFall break: September 11–September 18\nCourse ends: September 25').map((d) => d.day), ['2026-09-04', '2026-09-25']);
});

test('review: repeated weekly rules produce one occurrence per day and respect dated rows and the cap', () => {
  const line = 'Quizzes are due every Friday.\n';
  const rows = reviewWeekly(line.repeat(2) + 'Course ends: September 25');
  assert.deepEqual(rows.map((d) => d.day), ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25']);
  assert.equal(reviewWeekly(line.repeat(2) + 'Course ends: December 31, 2027').length, 20);
  assert.deepEqual(reviewWeekly(line + 'Quiz 1: September 11\nCourse ends: September 25').map((d) => d.day), ['2026-09-04', '2026-09-18', '2026-09-25']);
  assert.deepEqual(reviewWeekly(line + 'Quiz 1: September 11\nQuiz 2: September 18\nCourse ends: September 25'), []);
});

test('review: wrapped holiday records and unknown due cells do not invent deadlines', () => {
  for (const text of [
    'No class September 7\nquiz due later',
    'Date\tAssignment Due\nSeptember 7\tHomework TBD',
    'Date\tAssignment Due\nSeptember 7\tProject deadline to be announced',
  ]) assert.deepEqual(S.extract(text, reviewOpts).dates, [], text);
  assert.deepEqual(S.extract('Week 2\nMon\tNo quiz\nWed\tProject due', reviewOpts).dates.map((d) => d.day), ['2026-09-09']);
  assert.deepEqual(S.extract('Quiz 1 due October 5; Paper 2 due October 19', reviewOpts).dates.map((d) => d.day), ['2026-10-05', '2026-10-19']);
});

// Recall on syllabi the heuristics were not written against (2026-10-26): layouts and words real schedules use.
const rows = (text, opts) => S.extract(text, opts).dates.map((d) => `${d.day} ${d.kind}`);
test('a dated row\'s cells are no sentences: a question as a topic leaves the row its date', () => {
  assert.deepEqual(rows('1\t1–7 Feb\tWhy stories?\tQuiz 1', { start: Date.UTC(2027, 0, 19) }), ['2027-02-07 exam']);
});

test('a day, a dash and a month ("26-Jan", "4-Feb-2027") is a date', () => {
  const r = S.extract('Session\tDay\tDate\tCase / Topic\tDeliverable\n3\tTue\t26-Jan\tCase: Harrow\tCase write-up due 9:00 a.m.\n6\tThu\t4-Feb-2027\tCase: Kestrel\tCase write-up due 9:00 a.m.', { start: Date.UTC(2027, 0, 19), md: true });
  assert.deepEqual(r.dates.map((d) => `${d.day} ${d.kind}`), ['2027-01-26 due', '2027-02-04 due']);
});

test('"the last day of week 3" is that week\'s seventh day, in each language', () => {
  for (const [hint, line] of [['en', 'Quiz 1 — by 23:59 on the last day of Week 3'], ['de', 'Test 1 — am letzten Tag der Woche 3'], ['es', 'Prueba 1: el último día de la semana 3'],
    ['fr', 'Quiz 1 : le dernier jour de la semaine 3'], ['nl', 'Toets 1: laatste dag van week 3'], ['pt', 'Prova 1: último dia da semana 3']]) {
    assert.deepEqual(S.extract(line, { week1: SPRING, hint }).dates.map((d) => `${d.day} ${d.week}`), ['2027-01-31 3'], line);
  }
});

test('auditions, a Chilean solemne, a German compound test, work collected and a French "date limite" are deadlines', () => {
  assert.deepEqual(rows('Seating auditions: Monday, August 31, 6:00–9:00 p.m.', { start: FALL, md: true }), ['2026-08-31 exam']);
  assert.deepEqual(rows('Solemne 1: 09/10/2026\nCertamen 2: 13/11/2026', { start: FALL, hint: 'es' }), ['2026-10-09 exam', '2026-11-13 exam']);
  assert.deepEqual(rows('Zwischentest (Kapitel 1–4): Donnerstag, 19.11.2026\nAbschlussklausur: 25.02.2027', { start: Date.UTC(2026, 9, 12), hint: 'de' }), ['2026-11-19 exam', '2027-02-25 exam']);
  assert.deepEqual(rows('Process books are collected for a check on Friday, September 25.', { start: FALL, md: true }), ['2026-09-25 due']);
  assert.deepEqual(rows('Travail 1 – Analyse de cas : date limite le 21 février 2027\nRapport d\'étape : 12 février 2027', { start: SPRING, hint: 'fr' }), ['2027-02-21 due', '2027-02-12 due']);
  assert.deepEqual(rows('Practice logs are due Sunday, August 30.', { start: FALL, md: true }), ['2026-08-30 due'], 'a practice log is work, not a practice test');
  assert.deepEqual(rows('Practice quiz (ungraded): Friday, August 28.\nThe contest closes on Sept 4.', { start: FALL, md: true }), [], 'a practice test, and a word that only ends in "test"');
});

test('work released on one day and due on another is one row on the day it is due', () => {
  const r = S.extract('Final exam • Take-home: released Friday, December 11, 9:00 a.m.; due Monday, December 14, 5:00 p.m.', { start: FALL, md: true });
  assert.deepEqual(r.dates.map((d) => `${d.day} ${d.kind}`), ['2026-12-14 exam']);
  assert.match(r.dates[0].title, /released Friday, December 11/);
  assert.deepEqual(rows('Exam 2 posted Oct 5, due Oct 7.\nPaper 1 opens Oct 5; Quiz 3 due Oct 7.', { start: FALL, md: true }), ['2026-10-07 exam', '2026-10-05 due', '2026-10-07 exam']);
});

test('a deliverables column names its own work, before its date', () => {
  const r = S.extract('Wk\tDates\tStudio\tDeliverables\n3\tSep 7–Sep 11\tP1: precedent analysis\tPin-up: P1 concept boards — Friday, Sep. 11th\n5\tSep 21–Sep 25\tP1 development\tP1 Final Review, 1:30–5:20, Gallery — Wednesday, Sep. 23rd\n11\tNov 2–Nov 6\tP2 detailing\tP2 Midterm Review (guest critics) — Wednesday, Nov. 4th\n12\tNov 9–Nov 13\tP3: urban block',
    { start: FALL, md: true });
  assert.deepEqual(r.dates.map((d) => `${d.day} ${d.kind} ${d.title}`), ['2026-09-11 due Pin-up: P1 concept boards', '2026-09-23 due P1 Final Review, Gallery', '2026-11-04 due P2 Midterm Review (guest critics)']);
  assert.deepEqual(rows('Session\tDate\tTopic\tDeliverable\n25\t4/20\tGroup presentations (slot A)\tGroup presentation (assigned slot)\n24\t4/15\tGroup project workshop', { start: SPRING, md: true }), ['2027-04-20 due']);
});

test('a table with a weight column lists graded work: each dated row is a deadline', () => {
  const fr = S.extract('Titre\tDate\tPondération\nRapport d\'étape (équipe)\t12 février 2027\tPondération 10 %\nExamen intra\t15 mars 2027 de 12 h 30 à 15 h 20\tPondération 25 %\nQuiz en ligne\tChaque vendredi\tPondération 10 %', { start: SPRING, hint: 'fr' });
  assert.deepEqual(fr.dates.filter((d) => !d.rule).map((d) => `${d.day} ${d.kind} ${d.title}`), ['2027-02-12 due Rapport d\'étape (équipe)', '2027-03-15 exam Examen intra']);
  assert.deepEqual(rows('Evaluación\tFecha\tPonderación\nInforme 1\t10/09/2026\t10%\nSolemne 1\t09/10/2026\t25%', { start: Date.UTC(2026, 7, 3), hint: 'es' }), ['2026-09-10 due', '2026-10-09 exam']);
  assert.deepEqual(rows('Week\tDate\tTopic\nWeek 2\tSept 4\tElasticity', { start: FALL, md: true }), [], 'no weight column: a topic stays a topic');
});

test('a heading names the date on the line under it', () => {
  assert.deepEqual(rows('Seating auditions\nMonday, August 31, 6:00–9:00 p.m. Sign up for a 10-minute slot.', { start: FALL, md: true }), ['2026-08-31 exam']);
  assert.deepEqual(rows('Assignments\nOct 3: Lab 1 due', { start: FALL, md: true }), ['2026-10-03 due'], 'a line with its own work keeps it, once');
  assert.deepEqual(rows('Course schedule\nMonday, August 31: introductions', { start: FALL, md: true }), [], 'a heading that names no work');
});

test('a day a sentence excepts is no deadline', () => {
  assert.deepEqual(S.extract('Hausübungen: Abgabe jeweils montags bis 10 Uhr (außer in der vorlesungsfreien Zeit 21.12.–03.01.).', { start: Date.UTC(2026, 9, 12), hint: 'de' }).dates.filter((d) => !d.rule), []);
  assert.deepEqual(rows('Problem sets are due on Fridays, except Nov. 27.', { start: FALL, md: true }), []);
});

// Owner, 2026-10-26: recurring rules are expanded; the weeks, start, end and days off a rule's own sentence gives bound it.
const ruleDays = (text, opts) => S.extract(text, opts).dates.filter((d) => d.rule === 'weekly').map((d) => `${d.day.slice(5)} ${d.kind}`);
test('a weekly rule\'s own weeks bound it, and the breaks it excepts are left out', () => {
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday of weeks 3–5.\nCourse ends: September 25').map((d) => d.day), ['2026-09-18', '2026-09-25']);
  assert.deepEqual(ruleDays('Pre-lab quizzes close every Monday at 8:00 a.m., weeks 2–13. They cover that week\'s lab handout.\nMLK Day (Mon 1/18): no lecture. Spring Break (March 15–19): no lecture or lab.\nFinal Exam: Monday, May 3', { week1: SPRING, md: true }),
    ['01-25', '02-01', '02-08', '02-15', '02-22', '03-01', '03-08', '03-22', '03-29', '04-05'].map((d) => `${d} exam`));
  const fr = 'Quiz en ligne chaque vendredi (semaines 2 à 12, sauf la semaine de lecture), à faire sur monPortail avant 23 h 59.\nSemaine de lecture : du 1er mars 2027 au 5 mars 2027. Congés universitaires : Vendredi saint (vendredi 26 mars 2027).';
  const want = ['01-22', '01-29', '02-05', '02-12', '02-19', '02-26', '03-12', '03-19', '04-02'].map((d) => `${d} exam`);
  assert.deepEqual(ruleDays(fr, { week1: SPRING, hint: 'fr' }), want);
  assert.deepEqual(ruleDays(`Titre\tDate\tPondération\nQuiz en ligne (10, les 8 meilleurs comptent)\tChaque vendredi\tPondération 10 %\n${fr}`, { week1: SPRING, hint: 'fr' }), want, 'the table\'s row and the sentence are one rule');
  assert.deepEqual(ruleDays('Quizzes are due every Friday, except during spring break.\nFinal exam: Friday, December 11', { start: FALL, md: true }), [], 'a break the text never dates can\'t be left out');
});

test('a weekly rule starts at the course week it names and skips the dates it excepts', () => {
  assert.deepEqual(ruleDays('Vorlesungsbeginn: 12.10.2026 · Vorlesungsende: 05.02.2027\nHausübungen: Abgabe jeweils montags bis 10 Uhr (ab der 3. Vorlesungswoche, außer in der vorlesungsfreien Zeit 21.12.–03.01.) im Briefkasten.', { start: Date.UTC(2026, 9, 12), hint: 'de' }),
    ['10-26', '11-02', '11-09', '11-16', '11-23', '11-30', '12-07', '12-14', '01-04', '01-11', '01-18', '01-25', '02-01'].map((d) => `${d} due`));
  assert.deepEqual(ruleDays('Quizzes are due every Friday starting in week 3.\nCourse ends: September 25', reviewOpts), ['09-18 exam', '09-25 exam']);
});

test('a weekly rule\'s own first and last day bound it; days off, and days of the exams it skips, are left out', () => {
  const es = `Controles semanales: los viernes, en línea, desde el viernes 14 de agosto hasta el viernes 20 de noviembre; no hay control en las semanas de feriado, de receso ni de solemne.
El viernes 18 y el sábado 19 de septiembre son feriados legales. La Semana de receso va del lunes 21 al viernes 25 de septiembre.
Solemne 1: 09/10/2026
Solemne 2: 13/11/2026`;
  assert.deepEqual(ruleDays(es, { start: Date.UTC(2026, 7, 3), hint: 'es' }), ['08-14', '08-21', '08-28', '09-04', '09-11', '10-02', '10-16', '10-23', '10-30', '11-06', '11-20'].map((d) => `${d} exam`));
});

test('"classes run" a span of days: its first day starts week 1 and its last ends the weekly rules', () => {
  const text = 'Classes run August 24 – December 4. Fall break (Oct 10–13): no rehearsal. Thanksgiving recess Nov 25–29.\nPractice logs are due every Sunday by 11:59 p.m. on Canvas (minimum 4 hours a week).';
  assert.deepEqual(ruleDays(text, { start: Date.UTC(2026, 7, 17), md: true }), ['08-30', '09-06', '09-13', '09-20', '09-27', '10-04', '10-18', '10-25', '11-01', '11-08', '11-15', '11-22'].map((d) => `${d} due`));
});

test('two days with "and" share the second\'s month, and a range may name its weekdays', () => {
  const r = S.extract('El viernes 18 y el sábado 19 de septiembre son feriados.\nTarea 1: entrega el viernes 18 y el lunes 21 de septiembre', { start: Date.UTC(2026, 7, 3), hint: 'es' });
  assert.deepEqual(r.dates.map((d) => d.day), ['2026-09-18', '2026-09-21']);
  assert.deepEqual(rows('Examen parcial: del lunes 21 al viernes 25 de septiembre', { start: Date.UTC(2026, 7, 3), hint: 'es' }), ['2026-09-25 exam']);
});

// Owner, 2026-10-26: a TA's, a tutor's or an assistant's times are office hours, labelled with the role as written.
test('a line a staff role starts gives that person\'s hours, not a class', () => {
  const r = S.extract(`Graduate Assistant · Ines Varga · desk crits Tuesdays 6–8 PM in studio (Hollister 300)
Studio\tMWF 1:30–5:20 PM, Hollister 300
Teaching Fellow: Marcus Lin · mlin@whitcombe.edu · Thursdays 12–1 pm (Zoom)
Community TA: Ines Wakeman-Osei — live chat in the forum, Fridays 14:00–15:00 UTC.
Skills Lab Coordinator (Ms. Dana Okwuosa, RN): open lab Mon & Wed 1500–1700, Skills Lab B.
TA: Jane Doe — discussion section Wednesdays 10–11 am, Room 5`, { start: FALL, md: true, hint: 'en' });
  assert.deepEqual(r.hours.map((m) => `${m.label} | ${m.days.join(' ')} ${m.start}-${m.end}`), ['Graduate Assistant | TU 18:00-20:00', 'Teaching Fellow | TH 12:00-13:00', 'Community TA | FR 14:00-15:00', 'Skills Lab Coordinator | MO WE 15:00-17:00']);
  assert.deepEqual(r.meetings.map((m) => `${m.days.join(' ')} ${m.start}-${m.end}`), ['MO WE FR 13:30-17:20', 'WE 10:00-11:00'], 'a TA\'s discussion section is a class');
  const es = S.extract('Ayudante\tTomás Fuenzalida · tf@alumnos.umaipo.cl ·\natención de alumnos martes 12:00–13:00, Sala B-12', { start: FALL, hint: 'es' });
  assert.deepEqual(slots(es.hours).map((s) => s.replace(/^.*\| (?=\w\w \d)/, '')), ['TU 12:00-13:00 | Sala B-12']);
  assert.deepEqual(es.meetings, []);
});

test('a course\'s weeks ("weeks 4–14") are no hours', () => {
  const r = S.extract('Clinical: Thursdays 0630–1500 on your assigned unit (weeks 4–14)\nCare maps are due every Friday by 0800 during clinical weeks (weeks 4–14).', { start: SPRING, md: true });
  assert.deepEqual(r.meetings.map((m) => `${m.days.join(' ')} ${m.start}-${m.end}`), ['TH 06:30-15:00']);
});

test('an office and its office hours on one line: the office ends where their label starts', () => {
  const r = S.extract('Professor • Professor Adaeze Wolfenden-Liu.\nOffice: Law Building 4.22. Office hours:\nTuesdays after class and by appointment.\nLab TA: Office: HS 318', { start: FALL, md: true });
  assert.deepEqual([r.prof.office.value, r.prof.note.value], ['Law Building 4.22', 'Tuesdays after class and by appointment.']);
  assert.equal(S.extract('Office: HS 340 · Office hours: Mon 11:00–12:00, Thu 2:00–3:00', { start: FALL, md: true }).prof.office.value, 'HS 340');
  assert.equal(S.extract('Office hours: Tue 2–3 PM (office: by the lab)', { start: FALL, md: true }).prof.office.value, '', 'an office named after its hours\' label is not read');
});

test('review: frequencies need an explicit end, not another assignment date', () => {
  const text = 'Titre\tDate\tPondération\nQuiz en ligne\tChaque vendredi\t10 %\nExamen\tDecember 11\t30 %';
  assert.deepEqual(reviewWeekly(text), []);
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday.\nFinal exam: December 11'), []);
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday, weeks 2–3.').map((d) => d.day), ['2026-09-11', '2026-09-18']);
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday.\nCourse ends: September 18').map((d) => d.day), ['2026-09-04', '2026-09-11', '2026-09-18']);
});

test('review: a weekday and week range do not make quiz commentary a recurring exam', () => {
  for (const line of ['Quiz feedback is available every Friday', 'Quizzes are discussed every Friday', 'We discuss quizzes every Friday']) {
    assert.deepEqual(reviewWeekly(`${line}, weeks 3–5.\nCourse ends: September 25`), [], line);
  }
  assert.deepEqual(ruleDays('Quiz en ligne chaque vendredi (semaines 2 à 3).', { ...reviewOpts, hint: 'fr' }), ['09-11 exam', '09-18 exam']);
  assert.deepEqual(ruleDays('Controles semanales: los viernes, semanas 2 a 3.', { ...reviewOpts, hint: 'es' }), ['09-11 exam', '09-18 exam']);
});

test('review: every part of an exception list must be resolved before weekly expansion', () => {
  for (const except of ['September 11, 18 and 25', 'September 11 and the final week', 'spring break and the final week']) {
    assert.deepEqual(reviewWeekly(`Quizzes are due every Friday, weeks 1–6, except ${except}.\nSpring break: September 18\nCourse ends: October 9`), [], except);
  }
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday, weeks 1–4, except September 11 and September 18.').map((d) => d.day), ['2026-09-04', '2026-09-25']);
  assert.deepEqual(reviewWeekly('Quizzes are due every Friday from December 18 until January 15, except December 25 and January 1.').map((d) => d.day), ['2026-12-18', '2027-01-08', '2027-01-15']);
  assert.deepEqual(S.extract('Quizzes are due every Friday, weeks 1–4, except Sep. 11 and Sep. 18.', reviewOpts).dates.map((d) => d.day), ['2026-09-04', '2026-09-25']);
  assert.deepEqual(S.extract('Quizzes are due every Friday, weeks 1–6, except September 11, September 18, September 25, October 2 and October 9.', reviewOpts).dates.map((d) => d.day), ['2026-09-04']);
});

test('review: a weight header does not make topics or zero-weight rows deadlines', () => {
  for (const text of [
    'Date\tTopic\tWeight\nSeptember 7\tElasticity\t0%',
    'Date\tTopic\tWeight\nSeptember 7\tElasticity\t20%',
    'Titre\tDate\tPondération\nRévision\tSeptember 7\t0 %',
  ]) assert.deepEqual(S.extract(text, reviewOpts).dates, [], text);
  assert.deepEqual(S.extract('Titre\tDate\tPondération\nRapport d\'étape\tSeptember 7\t10 %', reviewOpts).dates.map((d) => `${d.day} ${d.kind}`), ['2026-09-07 due']);
});

test('review: a staff line can name its class section after the time', () => {
  for (const text of [
    'TA: Jane Doe — Wednesdays 10–11 am, discussion section, Room 5',
    'TA: Sam Lee — Mondays 9–10 am, class sections 101 and 102',
    'TA: Sam Lee — sections 101 and 102, Mondays 9–10 am',
  ]) {
    const r = S.extract(text, reviewOpts);
    assert.deepEqual(r.hours, [], text);
    assert.equal(r.meetings.length, 1, text);
  }
  assert.equal(S.extract('Teaching Assistant: Sam Lee · Office hours: Mondays 9–10 am, Room 5', reviewOpts).hours.length, 1);
});

test('review: topic cells cannot override an empty deliverables column', () => {
  for (const text of [
    'Date\tTopic\tDeliverables\nSeptember 7\tAuditions\tNone',
    'Date\tTopic\tAssignments\nSeptember 7\tQuiz design\tNone',
  ]) assert.deepEqual(S.extract(text, reviewOpts).dates, [], text);
  assert.deepEqual(S.extract('Date\tTopic\tDeliverables\nSeptember 7\tAuditions\tProject due', reviewOpts).dates.map((d) => `${d.day} ${d.kind}`), ['2026-09-07 due']);
});

test('review: parenthetical comments do not end an exception list', () => {
  const text = 'Quizzes are due every Friday, except September 11 (orientation) and September 18.\nCourse ends: September 25';
  assert.deepEqual(S.extract(text, reviewOpts).dates, []);
  assert.deepEqual(S.extract('Quizzes are due every Friday, weeks 1–4 (except September 11 and September 18).', reviewOpts).dates.map((d) => d.day), ['2026-09-04', '2026-09-25']);
});

test('review: weekly exceptions and release windows use their course year across New Year', () => {
  const opts = { start: Date.UTC(2027, 0, 11), md: true };
  const weekly = 'Quizzes are due every Friday from December 18, 2026 until January 15, 2027, except December 25 and January 1.';
  assert.deepEqual(S.extract(weekly, opts).dates.map((d) => d.day), ['2026-12-18', '2027-01-08', '2027-01-15']);
  assert.deepEqual(S.extract('Classes run December 28, 2026 – January 15, 2027.\nQuiz released December 30; due January 4', opts).dates.map((d) => `${d.day} ${d.kind}`), ['2027-01-04 exam']);
});

test('review: audition topics and preparation dates are not assessments', () => {
  for (const text of [
    'Date\tTopic\nSeptember 7\tAudition techniques',
    'Audition preparation: September 7',
    'Auditions\nSeptember 7: techniques and preparation',
  ]) assert.deepEqual(S.extract(text, reviewOpts).dates, [], text);
  assert.deepEqual(S.extract('Seating auditions\nSeptember 7: sign up for a slot.', reviewOpts).dates.map((d) => `${d.day} ${d.kind}`), ['2026-09-07 exam']);
});

test('review: excepted week ranges cannot become recurrence bounds', () => {
  const text = 'Quizzes are due every Friday, except September 11 and weeks 3–5.\nCourse ends: October 9';
  assert.deepEqual(S.extract(text, reviewOpts).dates, []);
});
