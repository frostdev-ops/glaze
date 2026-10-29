// The Documents home's pure rules (lib/doc-home.js): shown titles, search matching, sort, the course choices, which dropped
// files become documents, a document's flat text, and arrow-key moves. The page itself is scripts/documents-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const DH = require('../lib/doc-home.js');
const DK = require('../lib/doc-kinds.js');
const S = require('../lib/writer-schema.js');

test('a title: the student\'s, else the stored one, else the first line, else untitled', () => {
  assert.equal(DH.titleOf({ named: true, title: 'Mine' }, 'First line', 'Untitled document'), 'Mine');
  assert.equal(DH.titleOf({ named: false, title: 'Essay 2' }, 'First line', 'Untitled document'), 'Essay 2');
  assert.equal(DH.titleOf({ named: false, title: '' }, 'First line', 'Untitled document'), 'First line');
  assert.equal(DH.titleOf({ title: '' }, '', 'Untitled document'), 'Untitled document');
  assert.equal(DH.titleOf({}, undefined, 'Sans titre'), 'Sans titre');
});

test('search folds case, accents and spaces, and every term must match', () => {
  assert.deepEqual(DH.terms('  Café   NOTES '), ['cafe', 'notes']);
  assert.deepEqual(DH.terms(''), []);
  const row = { course: 'ENGL 2110' };
  assert.equal(DH.matches(row, 'Reading notes', [], null), true, 'no terms: everything');
  assert.equal(DH.matches(row, 'Reading notes', DH.terms('read'), null), true, 'the title at once');
  assert.equal(DH.matches(row, 'Reading notes', DH.terms('engl notes'), null), true, 'title and course together');
  assert.equal(DH.matches(row, 'Reading notes', DH.terms('heliotrope'), null), null, 'unknown until the body is read');
  assert.equal(DH.matches(row, 'Reading notes', DH.terms('heliotrope'), 'The heliotrope opened.'), true);
  assert.equal(DH.matches(row, 'Reading notes', DH.terms('notes heliotrope'), 'The héliotrope opened.'), true, 'terms across title and body');
  assert.equal(DH.matches(row, 'Reading notes', DH.terms('heliotrope'), 'Nothing here.'), false);
  assert.equal(DH.matches({}, 'Réveil', DH.terms('reveil'), null), true, 'accents fold both ways');
});

test('sort: last edited newest first; title A to Z, numbers by value, ties newest first', () => {
  const rows = [{ key: 'a', updated: 1 }, { key: 'b', updated: 3 }, { key: 'c', updated: 2 }, { key: 'd', updated: 4 }];
  const titles = new Map([['a', 'Draft 10'], ['b', 'draft 2'], ['c', 'Ésai'], ['d', 'Draft 2']]);
  assert.deepEqual(DH.sort(rows, 'updated', titles, 'en').map((r) => r.key), ['d', 'b', 'c', 'a']);
  assert.deepEqual(DH.sort(rows, 'title', titles, 'en').map((r) => r.key), ['d', 'b', 'a', 'c']);
  assert.deepEqual(rows.map((r) => r.key), ['a', 'b', 'c', 'd'], 'the rows themselves stay as they were');
});

test('course choices: each name once, A to Z, and whether any row has none', () => {
  const rows = [{ course: 'ENGL 2110' }, { course: 'BIOL 1010' }, { course: ' ENGL 2110 ' }, { course: '' }, {}];
  assert.deepEqual(DH.courses(rows, 'en'), { names: ['BIOL 1010', 'ENGL 2110'], none: true });
  assert.deepEqual(DH.courses([{ course: 'X' }], 'en'), { names: ['X'], none: false });
  assert.ok(DH.inCourse({ course: 'X' }, '') && DH.inCourse({}, ''));
  assert.ok(DH.inCourse({ course: 'X' }, 'X') && !DH.inCourse({ course: 'Y' }, 'X'));
  assert.ok(DH.inCourse({ course: '' }, DH.NONE) && DH.inCourse({}, DH.NONE) && !DH.inCourse({ course: 'X' }, DH.NONE));
});

test('drop routing: Word files within the cap become documents, at most 20; the rest say why', () => {
  const f = (name, size = 1000) => ({ name, size });
  const r = DH.route([f('a.docx'), f('notes.txt'), f('B.DOCX', 16e6), f('c.docx', 0), f('scan.pdf')], DK.forFile, DK.KINDS);
  assert.deepEqual(r.take.map((x) => [x.file.name, x.kind]), [['a.docx', 'paper']]);
  assert.deepEqual(r.refused.map((x) => [x.file.name, x.why]), [['notes.txt', 'type'], ['B.DOCX', 'size'], ['c.docx', 'size'], ['scan.pdf', 'type']]);
  const many = DH.route(Array.from({ length: 23 }, (_, i) => f(`${i}.docx`)), DK.forFile, DK.KINDS);
  assert.equal(many.take.length, 20);
  assert.deepEqual(many.refused.map((x) => x.why), ['count', 'count', 'count']);
  assert.equal(DH.route([f('a.docx', DK.KINDS.paper.max)], DK.forFile, DK.KINDS).take.length, 1, 'the cap itself fits');
  assert.equal(DH.stem('River notes.docx'), 'River notes');
  assert.equal(DH.stem('my.essay.final.DOCX'), 'my.essay.final');
  assert.equal(DH.stem('   .docx'), '');
});

test('flat text is the schema\'s text, without building the document', () => {
  const html = '<p>First <b>bold</b> line</p><ul><li><p>An item</p></li></ul><p>Broken<br>line</p><p></p><table><tr><td><p>Cell</p></td></tr></table>';
  const doc = S.parse(S.paper, html);
  const json = doc.toJSON();
  const lines = (x) => x.split('\n').filter(Boolean).join('\n');
  assert.equal(lines(DH.flat(json)), lines(S.text(doc).text), 'the same lines, empty ones aside');
  assert.match(DH.flat(json), /^First bold line\nAn item\nBroken\nline/);
  assert.ok(DH.flat(json).includes('Cell'));
  assert.equal(DH.flat(null), '');
  assert.equal(DH.flat({ type: 'doc', content: [{ type: 'paragraph' }] }), '');
});

test('arrow moves: the grid by its columns, the list by one, Home and End to the ends', () => {
  assert.equal(DH.move(0, 'ArrowRight', 10, 4), 1);
  assert.equal(DH.move(9, 'ArrowRight', 10, 4), 9, 'stops at the end');
  assert.equal(DH.move(0, 'ArrowLeft', 10, 4), 0);
  assert.equal(DH.move(1, 'ArrowDown', 10, 4), 5);
  assert.equal(DH.move(7, 'ArrowDown', 10, 4), 7, 'no card below: stays');
  assert.equal(DH.move(5, 'ArrowUp', 10, 4), 1);
  assert.equal(DH.move(2, 'ArrowUp', 10, 4), 2);
  assert.equal(DH.move(3, 'ArrowDown', 10, 1), 4, 'the list moves by one');
  assert.equal(DH.move(6, 'Home', 10, 4), 0);
  assert.equal(DH.move(2, 'End', 10, 4), 9);
  assert.equal(DH.move(2, 'Enter', 10, 4), null);
  assert.equal(DH.move(0, 'ArrowRight', 0, 4), null, 'no cards');
  assert.equal(DH.move(-1, 'ArrowRight', 3, 1), 1, 'from nowhere: from the first');
});
