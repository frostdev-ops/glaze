// The document kinds the Documents home knows (lib/doc-kinds.js): each kind's fixed facts, a stored row's kind, a file's
// kind by its extension, and the page code each kind's script attaches.
const test = require('node:test');
const assert = require('node:assert/strict');
const DK = require('../lib/doc-kinds.js');

test('paper and sheet are the kinds, frozen', () => {
  assert.deepEqual(Object.keys(DK.KINDS), ['paper', 'sheet']);
  assert.deepEqual(DK.KINDS.paper, { label: 'Document', icon: 'paper', accept: ['.docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', max: 15e6, param: 'paper' });
  assert.deepEqual(DK.KINDS.sheet, { label: 'Spreadsheet', icon: 'sheet', accept: ['.xlsx', '.csv'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', max: 15e6, param: 'sheet' });
  for (const k of Object.values(DK.KINDS)) assert.ok(Object.isFrozen(k) && Object.isFrozen(k.accept));
  assert.ok(Object.isFrozen(DK.KINDS));
  assert.throws(() => { 'use strict'; DK.KINDS.paper.max = 1; });
});

test('a row without kind is a paper', () => {
  assert.equal(DK.kindOf({ key: 'doc:x' }), 'paper');
  assert.equal(DK.kindOf({ kind: '' }), 'paper');
  assert.equal(DK.kindOf(null), 'paper');
  assert.equal(DK.kindOf({ kind: 'paper' }), 'paper');
  assert.equal(DK.kindOf({ kind: 'sheet' }), 'sheet', 'a later kind reads as itself');
});

test('a file\'s kind is its extension\'s, any case', () => {
  assert.equal(DK.forFile('Essay.docx'), 'paper');
  assert.equal(DK.forFile('ESSAY.DOCX'), 'paper');
  assert.equal(DK.forFile('my.essay.Docx'), 'paper');
  assert.equal(DK.forFile('Grades.xlsx'), 'sheet');
  assert.equal(DK.forFile('export.CSV'), 'sheet');
  for (const name of ['essay.doc', 'essay.pdf', 'docx', 'essay', '', null, undefined, 'essay.docx.zip', 'book.xls', 'book.xlsm', 'book.ods', 'data.tsv', 'book.xlsx.zip']) assert.equal(DK.forFile(name), null, String(name));
});

test('a kind\'s page code registers onto its facts', () => {
  assert.deepEqual(DK.get('paper'), DK.KINDS.paper, 'nothing registered yet');
  const impl = { edit: () => 'edit', thumb: () => 'thumb', exportFile: () => 'out', importFile: () => 'in', measure: () => 3 };
  DK.register('paper', impl);
  const paper = DK.get('paper');
  assert.equal(paper.label, 'Document');
  assert.equal(paper.edit(), 'edit');
  assert.equal(paper.measure(), 3);
  assert.throws(() => DK.register('chart', impl), /chart/);
  assert.equal(DK.get('chart'), null);
  assert.equal(DK.get('toString'), null);
});

const fresh = () => { delete require.cache[require.resolve('../lib/doc-kinds.js')]; delete globalThis.GZ_DOC_KINDS; return require('../lib/doc-kinds.js'); };

// What the page opens is what its scripts registered: a kind with no importFile (writer.sheets off: sheet-kind.js registers
// viewing and editing only) takes no file, and its extensions leave the file chooser's accept.
test('only a registered kind with importFile opens files', () => {
  const K = fresh();
  assert.equal(K.opens('Essay.docx'), null, 'nothing registered: nothing opens');
  assert.equal(K.accept(), '');
  K.register('paper', { importFile: () => 'key', thumb: () => null });
  assert.equal(K.opens('Essay.docx'), 'paper');
  assert.equal(K.opens('Grades.xlsx'), null, 'sheet not registered');
  assert.equal(K.accept(), '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  K.register('sheet', { thumb: () => null, edit: () => null });
  assert.equal(K.opens('Grades.xlsx'), null, 'a kind without importFile opens no file');
  assert.equal(K.opens('grades.csv'), null);
  K.register('sheet', { importFile: () => 'key', thumb: () => null });
  assert.equal(K.opens('Grades.xlsx'), 'sheet');
  assert.equal(K.opens('grades.csv'), 'sheet');
  assert.equal(K.accept(), '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  fresh();
});

// A kind's script may decide late whether it registers its importFile (sheet-kind.js reads writer.sheets first); the page
// waits for every such decision before it routes or draws, and a script that fails doesn't hold the page.
test('settled waits for every kind script, failed ones included', async () => {
  const K = fresh();
  let late;
  K.wait(new Promise((ok) => { late = ok; }).then(() => K.register('sheet', { importFile: () => 'k' })));
  K.wait(Promise.reject(new Error('a kind script failed')));
  let done = false;
  const all = K.settled().then(() => { done = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, 'still waiting for the late kind');
  late();
  await all;
  assert.equal(K.opens('a.xlsx'), 'sheet');
  await K.settled();
  fresh();
});
