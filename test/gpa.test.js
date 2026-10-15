// Past terms, trends, goals and transcript reading (lib/gpa.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/gpa.js');
const D = require('../lib/doctext.js');

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
const term = (n, c, p) => ({ id: 'a', n, c, ...(p === 0 ? { p } : {}) });

test('which grades count, and what they are worth', () => {
  for (const [g, kind, pm, whole] of [
    ['A', 'gpa', 4, 4], ['a-', 'gpa', 3.7, 4], ['B+', 'gpa', 3.3, 3], ['C−', 'gpa', 1.7, 2], ['D-', 'gpa', 0.7, 1], ['F', 'gpa', 0, 0], ['E', 'gpa', 0, 0],
    ['3.7', 'gpa', 3.7, 3.7], ['4,0', 'gpa', 4, 4], ['92', 'gpa', 3.7, 4], ['95', 'gpa', 4, 4],
    ['P', 'pf', null, null], ['NP', 'pf', null, null], ['CR', 'pf', null, null], ['S', 'pf', null, null],
    ['W', 'w', null, null], ['WF', 'w', null, null], ['TR', 'tr', null, null], ['IP', 'none', null, null], ['I', 'none', null, null],
    ['AU', 'none', null, null], ['', 'none', null, null], ['Excellent', 'none', null, null], ['250', 'none', null, null],
  ]) {
    assert.equal(G.kind(g), kind, g);
    assert.equal(G.pointsOf({ g, cr: 3 }, true), pm, `${g} plus/minus`);
    assert.equal(G.pointsOf({ g, cr: 3 }, false), whole, `${g} whole letters`);
  }
  // Honors and AP add to letters when weighted, not to points written as a number, and nothing to an F.
  assert.equal(G.pointsOf({ g: 'B+', l: 1 }, true, true), 4.3);
  assert.equal(G.pointsOf({ g: 'B+', l: 1 }, true, false), 3.3);
  assert.equal(G.pointsOf({ g: '3.3', l: 1 }, true, true), 3.3);
  assert.equal(G.pointsOf({ g: 'F', l: 0.5 }, true, true), 0);
  assert.equal(G.pointsOf({ g: 'A', x: 1 }, true), null, 'left out');
  assert.deepEqual(['A', 'W', 'P', 'TR', 'IP'].map((g) => G.why({ g, cr: 3 })), [null, 'w', 'pf', 'tr', 'none']);
  assert.equal(G.why({ g: 'A', cr: 0 }), 'credits');
  assert.equal(G.why({ g: 'A', cr: 3, x: 1 }), 'out');
});

test('a term GPA over credits, with plus/minus or whole letters, leaving out what does not count', () => {
  const rows = [{ n: 'Bio', cr: 4, g: 'A-' }, { n: 'Eng', cr: 3, g: 'B+' }, { n: 'Art', cr: 2, g: 'P' }, { n: 'Chem', cr: 4, g: 'W' }, { n: 'Lab', cr: 1, g: 'A', x: 1 }];
  const of = (t, w) => require('../lib/gradecalc.js').gpa(G.rowsOf(t, w));
  const pm = of(term('Fall 2024', rows));
  close(pm.gpa, (4 * 3.7 + 3 * 3.3) / 7, 'plus/minus');
  assert.equal(pm.credits, 7);
  close(of(term('Fall 2024', rows, 0)).gpa, (4 * 4 + 3 * 3) / 7, 'whole letters');
  close(of(term('x', [{ cr: 3, g: 'A', l: 1 }, { cr: 3, g: 'B' }]), true).gpa, 4, 'weighted');
  assert.equal(of(term('x', [{ cr: 3, g: 'P' }])).gpa, null, 'nothing counts');
});

test('terms in time order, whatever the naming', () => {
  const names = ['Spring 2025', 'Fall 2024', 'Summer 2025', 'Winter 2025', '2023 Semester 2', '2023 Semester 1', 'My first term', 'Wintersemester 2025/26', 'Sommersemester 2025', 'Automne 2022'];
  const got = G.order(names.map((n) => ({ n }))).map((t) => t.n);
  // 'My first term' has no year: it keeps its place after the term listed before it.
  assert.deepEqual(got, ['Automne 2022', '2023 Semester 1', 'My first term', '2023 Semester 2', 'Fall 2024', 'Winter 2025', 'Spring 2025', 'Summer 2025', 'Sommersemester 2025', 'Wintersemester 2025/26']);
  // A name without a year stays after the term before it.
  assert.deepEqual(G.order([{ n: 'Fall 2024' }, { n: 'Extra' }, { n: 'Spring 2024' }]).map((t) => t.n), ['Spring 2024', 'Fall 2024', 'Extra']);
});

test('the cumulative GPA term by term', () => {
  const s = G.series([
    { name: 'Fall 2024', rows: [{ credits: 3, points: 4 }, { credits: 3, points: 3 }] },
    { name: 'Spring 2025', rows: [{ credits: 3, points: null }] },
    { name: 'Now', rows: [{ credits: 4, points: 2 }] },
  ]);
  assert.deepEqual(s.map((x) => x.name), ['Fall 2024', 'Spring 2025', 'Now']);
  close(s[0].gpa, 3.5, 'first term');
  assert.equal(s[1].gpa, null);
  close(s[1].cum, 3.5, 'unchanged by a term with nothing that counts');
  close(s[2].cum, (12 + 9 + 8) / 10, 'cumulative');
});

test('a goal: what this term needs, rounded up, and when it is out of reach or already met', () => {
  const past = { points: 3.0 * 30, credits: 30 };
  // (3.2 × 45 − 90) / 15 = 3.6
  assert.deepEqual(G.goal({ past, credits: 15, top: 4 }, 'cum', 3.2), { need: 3.6 });
  // Never rounded down: 3.4 × 46 − 90 = 66.4 over 16 = 4.15 → out of reach; 3.3 → (151.8 − 90) / 16 = 3.8625 → 3.87
  assert.deepEqual(G.goal({ past, credits: 16, top: 4 }, 'cum', 3.3), { need: 3.87 });
  const far = G.goal({ past, credits: 15, top: 4 }, 'cum', 3.5);
  assert.equal(far.reachable, false);
  close(far.best, (90 + 60) / 45, 'the best it can come to');
  assert.deepEqual(G.goal({ past, credits: 15, top: 4 }, 'cum', 2), { met: true });
  assert.deepEqual(G.goal({ past, credits: 15, top: 4 }, 'term', 3.5), { need: 3.5 });
  assert.equal(G.goal({ past, credits: 15, top: 4 }, 'term', 4.2).reachable, false);
  assert.deepEqual(G.goal({ past, credits: 15, top: 4.5 }, 'term', 4.2), { need: 4.2 }, 'weighted: honors make room above 4');
  assert.equal(G.goal({ past, credits: 0, top: 4 }, 'cum', 3), null);
  // Float noise doesn't push a round need up a step: (3.5 × 20 − 3.5 × 10) / 10 is 3.5
  assert.deepEqual(G.goal({ past: { points: 35, credits: 10 }, credits: 10, top: 4 }, 'cum', 3.5), { need: 3.5 });
});

test('a route: the cheapest steps up from the grades now', () => {
  const S = require('../lib/gradecalc.js').SCHEME;
  const courses = [
    { credits: 4, letter: 'B+', score: 89.5, scale: S }, // half a point from A-
    { credits: 3, letter: 'B', score: 84, scale: S },
    { credits: 3, letter: null, score: null, scale: null }, // no grade yet: starts at the average
  ];
  // Need 3.4: B+ (4) is 13.2, B (3) 9, the new course at B+ (3.3 ≥ 3.4? no: A- 3.7) 11.1 → 33.3 ≥ 34? no: one step more.
  const r = G.route(courses, 3.4, true);
  assert.deepEqual(r.map((x) => x.letter), ['A-', 'B', 'A-']);
  assert.deepEqual(r.map((x) => x.up), [1, 0, null], 'no grade now: not "no change"');
  assert.deepEqual(r.map((x) => x.min), [90, 84, null]);
  // Already enough: nothing moves (and the course without a grade stays unknown).
  assert.deepEqual(G.route(courses, 2, true).map((x) => x.up), [0, 0, null]);
  // Straight A's fall short: no route.
  assert.equal(G.route(courses, 4.01, true), null);
  // Whole letters: A- is an A.
  assert.deepEqual(G.route([{ credits: 3, letter: 'A-' }], 4, false).map((x) => x.letter), ['A']);
  // Credits count: with no scores known, the 4-credit course goes up first.
  assert.deepEqual(G.route([{ credits: 1, letter: 'B' }, { credits: 4, letter: 'B' }], 3.2, true).map((x) => x.letter), ['B', 'B+']);
  // A course whose work left can't reach a letter is held below it; the others make up for it.
  const capped = G.route([{ credits: 3, letter: 'B', score: 84, scale: S, max: 86.6 }, { credits: 3, letter: 'B', score: 84, scale: S }], 3.3, true);
  assert.deepEqual(capped.map((x) => x.letter), ['B', 'A-']);
  assert.equal(G.route([{ credits: 3, letter: 'B', score: 84, scale: S, max: 86.6 }], 3.3, true), null, 'and no route when none can');
  // A best percent reaches a letter as Canvas rounds it (gradecalc's reaches, as letter() uses): 89.995 is an A-.
  for (const [max, need, want] of [[89.996, 3.7, 'A-'], [89.995, 3.7, 'A-'], [89.994, 3.7, null], [90, 3.7, 'A-'], [93.995, 4, 'A'], [93.994, 4, null], [86.995, 3.3, 'B+'], [86.99, 3.3, null]]) {
    const r = G.route([{ credits: 3, letter: 'B', score: 84, scale: S, max }], need, true);
    assert.equal(r && r[0].letter, want, `best ${max}, need ${need}`);
    assert.equal(want, require('../lib/gradecalc.js').points(require('../lib/gradecalc.js').letter(max), true) >= need ? want : null, 'the same letter Canvas would give');
  }
  // The floor of a letter on a scale with fewer steps.
  assert.equal(G.floor([['A', 90], ['B', 80], ['C', 70], ['F', 0]], 'B+', true), 90);
});

test('a route offers only letters a course can still give: by its scale, and by its work left as Canvas rounds', () => {
  const S = require('../lib/gradecalc.js').SCHEME;
  const B_TOP = [['B', 80], ['C', 60], ['F', 0]];
  const c = { credits: 3, letter: 'B', score: 90, scale: B_TOP };
  assert.equal(G.topOf(c, true), G.LADDER.true.indexOf('B'));
  assert.equal(G.route([c], 4, true), null, 'no A to offer on a scale that has none');
  assert.deepEqual(G.route([c, { credits: 3, letter: 'B', score: 84, scale: S }], 3.5, true).map((x) => x.letter), ['B', 'A'], 'the other course carries it');
  // Work left that tops out at 88% ends on B+, even from an A- now.
  assert.equal(G.topOf({ credits: 3, scale: S, max: 88 }, true), G.LADDER.true.indexOf('B+'));
  assert.deepEqual(G.route([{ credits: 3, letter: 'A-', score: 91, scale: S, max: 88 }], 1, true), [{ letter: 'B+', min: 87, up: -1 }]);
  assert.equal(G.topOf({ credits: 3, scale: S, max: 89.996 }, true), G.LADDER.true.indexOf('A-'), 'rounded as Canvas does');
  assert.equal(G.topOf({ credits: 3, scale: null, max: 50 }, true), G.LADDER.true.length - 1, 'no scale known: no letter ruled out');
  // An E now is an F; a course with no grade now has no known baseline.
  assert.deepEqual(G.route([{ credits: 3, letter: 'E' }], 1, true), [{ letter: 'D', min: null, up: 2 }]);
  assert.deepEqual(G.route([{ credits: 3, letter: null }], 3.5, true), [{ letter: 'A-', min: null, up: null }]);
  // The lowest raw percent that reaches a bound.
  const C = require('../lib/gradecalc.js');
  assert.ok(C.reaches(C.reachFrom(90), 90) && !C.reaches(C.reachFrom(90) - 0.0001, 90));
});

test('a removed term stays removed, and an import does not replace a newer term of the same name', () => {
  const term = (id, n, at) => ({ op: 'term', term: { id, n, c: [] }, at, base: 0 });
  let rec = G.change(undefined, term('one', 'Fall 2024', 10));
  rec = G.change(rec, { op: 'drop', id: 'one', at: 30 });
  assert.deepEqual(rec, { t: [], d: { one: 30 } });
  assert.deepEqual(G.change(rec, term('one', 'Fall 2024', 25)).t, [], 'an older put of it, arriving late, is dropped');
  assert.equal(G.change(rec, { op: 'drop', id: 'one', at: 20 }).d.one, 30);
  rec = G.change(rec, term('two', 'Spring 2025', 40));
  const late = G.change(rec, { op: 'add', terms: [{ id: 'three', n: 'spring 2025', c: [] }], at: 35 });
  assert.deepEqual(late.t.map((t) => t.id), ['two'], 'an import made before the term changed leaves it');
  rec = G.change(rec, { op: 'add', terms: [{ id: 'three', n: 'spring 2025', c: [] }], at: 45 });
  assert.deepEqual(rec.t.map((t) => t.id), ['three']);
  assert.equal(rec.d.two, 45, 'the term an import replaced is removed for good');
  assert.deepEqual(G.change(rec, term('two', 'Spring 2025', 42)).t.map((t) => t.id), ['three']);
  const many = G.clean({ t: [], d: Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`x${i}`, i + 1])) });
  assert.equal(Object.keys(many.d).length, 200);
  assert.ok(!('x0' in many.d) && 'x249' in many.d, 'the newest are kept');
});

test('a transcript as text: terms, courses, credits either side of the grade, and its own term GPA', () => {
  const text = [
    'UNOFFICIAL TRANSCRIPT', 'Student: Sam Taylor',
    'Fall 2024',
    'Course\tTitle\tCredits\tGrade\tPoints',
    'BIO 1100\tIntroduction to Biology\t4.00\tA-\t14.80',
    'ENG-101\tCollege Writing\t3.00\tB+\t9.90',
    'ART 120 Drawing I 2.00 P 0.00',
    'Term GPA: 3.53   Cum GPA: 3.53',
    'Spring Semester 2025',
    'MATH 2210A Calculus I A 4',
    'HIST 150 World History 3.00 W',
    'CHEM 101', 'General Chemistry', '4.00', 'B', '12.00',
    'Term GPA 3.50 Cumulative GPA 3.52',
    'Fall 2024 (continued)',
  ].join('\n');
  const t = G.parse(text);
  assert.deepEqual(t.map((x) => x.n), ['Fall 2024', 'Spring Semester 2025']);
  assert.deepEqual(t[0].c, [{ n: 'BIO 1100 Introduction to Biology', cr: 4, g: 'A-' }, { n: 'ENG-101 College Writing', cr: 3, g: 'B+' }, { n: 'ART 120 Drawing I', cr: 2, g: 'P' }]);
  assert.equal(t[0].gpa, 3.53);
  assert.deepEqual(t[1].c, [{ n: 'MATH 2210A Calculus I', cr: 4, g: 'A' }, { n: 'HIST 150 World History', cr: 3, g: 'W' }, { n: 'CHEM 101 General Chemistry', cr: 4, g: 'B' }]);
  assert.equal(t[1].gpa, 3.5, 'the term GPA, not the cumulative one');
  // Courses before any term heading still come back, under a term without a name.
  assert.deepEqual(G.parse('Intro to Psychology 3 A\nTerm totals 3 A'), [{ n: '', c: [{ n: 'Intro to Psychology', cr: 3, g: 'A' }], gpa: null, printed: [3] }]);
  assert.deepEqual(G.parse('Nothing to see here\n2024 was a year'), []);
});

test('a course row is a course whatever its title says; the review checks the credits as well as the GPA', () => {
  const t = G.parse(['Fall 2025', 'CIS301 Software Quality Assurance 3 A', 'CIS302 Databases 3 A', 'CIS 499 Senior project',
    'Term GPA 4.00 Credits 6.00', 'Cum GPA 3.80 Cum Credits 60'].join('\n'));
  assert.deepEqual(t[0].c.map((c) => c.n), ['CIS301 Software Quality Assurance', 'CIS302 Databases']);
  assert.deepEqual(t[0].printed, [6], "the term's printed credits, not the cumulative ones nor the GPA");
  assert.deepEqual(t[0].skipped, ['CIS 499 Senior project'], 'a coded line that is no course is listed');
  assert.deepEqual(G.check(t[0]), { gpa: true, mine: 4, credits: true, all: 6 });
  // One course missing: the GPA still matches, the credits don't, so the check says so.
  assert.deepEqual(G.check({ ...t[0], c: t[0].c.slice(0, 1) }), { gpa: true, mine: 4, credits: false, all: 3 });
  assert.equal(G.check({ ...t[0], printed: undefined }).credits, null, 'nothing printed, nothing to compare');
  // Summary lines are still no courses.
  const s = G.parse('Fall 2025\nBIO 101 Biology 3 A\nQuality Points 12.00 A\nTerm Totals 3.00 3.00 12.00')[0];
  assert.deepEqual(s.c.map((c) => c.n), ['BIO 101 Biology']);
  assert.deepEqual(s.printed, [3, 3, 12]);
});

test('a transcript as an HTML table, through lib/doctext.js', () => {
  const html = `<h2>Fall 2024</h2><table><tr><th>Course</th><th>Title</th><th>Cr</th><th>Grade</th></tr>
    <tr><td>BIO 1100</td><td>Intro &amp; Lab</td><td>4,0</td><td>A&minus;</td></tr><tr><td>PSY 101</td><td>Psychology</td><td>3</td><td>CR</td></tr></table>`;
  const t = G.parse(D.html(html));
  assert.deepEqual(t, [{ n: 'Fall 2024', gpa: null, c: [{ n: 'BIO 1100 Intro & Lab', cr: 4, g: 'A-' }, { n: 'PSY 101 Psychology', cr: 3, g: 'CR' }] }]);
});

test('an older change to a term, arriving after a newer one, does not undo it', () => {
  const row = (cr) => ({ id: 'one', n: 'Fall 2024', c: [{ n: 'Bio', cr: 4, g: 'A' }, { n: 'Eng', cr, g: 'B' }] });
  let rec = G.change(undefined, { op: 'term', term: row(3), at: 5 });
  rec = G.change(rec, { op: 'term', term: row(4), at: 20 });
  rec = G.change(rec, { op: 'term', term: { ...row(3), n: 'Fall 2024 (old tab)' }, at: 10 });
  assert.deepEqual(rec.t, [{ ...row(4), at: 20 }], 'the newer credits stay');
  assert.deepEqual(G.change(rec, { op: 'drop', id: 'one', at: 15 }).t.length, 1, 'nor does an older removal');
  assert.deepEqual(G.change(rec, { op: 'drop', id: 'one', at: 25 }).t, []);
});

test('what is kept is cleaned, and changes go in one at a time', () => {
  const t1 = { id: 'one', n: '  Fall   2024 ', c: [{ n: 'Bio', cr: 4, g: 'A' }, { n: 'x', cr: -1, g: 'B', l: 2, x: 0 }, 'junk'], p: 1, extra: 1 };
  let rec = G.change(undefined, { op: 'term', term: t1, at: 10 });
  assert.deepEqual(rec, { t: [{ id: 'one', n: 'Fall 2024', c: [{ n: 'Bio', cr: 4, g: 'A' }, { n: 'x', cr: 0, g: 'B' }], at: 10 }] });
  rec = G.change(rec, { op: 'term', term: { id: 'one', n: 'Fall 2024', c: [], p: 0 }, at: 11 });
  assert.deepEqual(rec.t, [{ id: 'one', n: 'Fall 2024', c: [], p: 0, at: 11 }], 'replaced by id');
  rec = G.change(rec, { op: 'add', terms: [{ id: 'two', n: 'fall 2024', c: [] }, { id: 'three', n: 'Spring 2025', c: [] }, { id: 'BAD!', n: 'x', c: [] }], at: 12 });
  assert.deepEqual(rec.t.map((t) => t.id), ['two', 'three'], 'an import replaces a term of the same name');
  rec = G.change(rec, { op: 'goal', goal: { k: 'cum', v: 3.456 }, at: 13 });
  assert.deepEqual(rec.g, { k: 'cum', v: 3.46 });
  assert.equal(G.change(rec, { op: 'goal', goal: { k: 'cum', v: 9 }, at: 14 }).g, undefined, 'a goal past 6 clears it');
  rec = G.change(rec, { op: 'drop', id: 'two', at: 15 });
  assert.deepEqual(rec.t.map((t) => t.id), ['three']);
  rec = G.change(rec, { op: 'clear', at: 20 });
  assert.deepEqual(rec, { t: [], cl: 20 });
  // A change made before the clear, arriving after it, is refused; so is one made later on a view from before it
  // (a page whose read was held up while the clear came: base is the last clear it knew of).
  assert.equal(G.change(rec, { op: 'term', term: t1, at: 19, base: 20 }), null);
  assert.equal(G.change(rec, { op: 'term', term: t1, at: 21 }), null, 'no base: a view from before any clear');
  assert.equal(G.change(rec, { op: 'term', term: t1, at: 21, base: 0 }), null);
  assert.equal(G.change(rec, { op: 'term', term: t1, at: 21, base: 20 }).t.length, 1, 'a view that saw the clear');
  // Caps: 40 terms, 40 rows, names cut.
  const many = G.clean({ t: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, n: 'x'.repeat(200), c: Array.from({ length: 50 }, () => ({ n: 'c', cr: 3, g: 'A' })) })) });
  assert.equal(many.t.length, 40);
  assert.equal(many.t[0].c.length, 40);
  assert.equal(many.t[0].n.length, 60);
  assert.deepEqual(G.clean('nope'), { t: [] });
  assert.ok(G.KEY.test('gpaTerms:http://localhost:3000:12') && !G.KEY.test('gpaTerms:http://localhost:3000:1 2'));
});
