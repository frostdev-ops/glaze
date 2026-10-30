// The document kinds the Documents home knows (lib/doc-kinds.js): each kind's fixed facts, a stored row's kind, a file's
// kind by its extension, and the page code each kind's script attaches.
const test = require('node:test');
const assert = require('node:assert/strict');
const DK = require('../lib/doc-kinds.js');

test('paper is the one kind, frozen', () => {
  assert.deepEqual(Object.keys(DK.KINDS), ['paper']);
  assert.deepEqual(DK.KINDS.paper, { label: 'Document', icon: 'paper', accept: ['.docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', max: 15e6, param: 'paper' });
  assert.ok(Object.isFrozen(DK.KINDS) && Object.isFrozen(DK.KINDS.paper) && Object.isFrozen(DK.KINDS.paper.accept));
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
  for (const name of ['essay.doc', 'essay.pdf', 'docx', 'essay', '', null, undefined, 'essay.docx.zip']) assert.equal(DK.forFile(name), null, String(name));
});

test('a kind\'s page code registers onto its facts', () => {
  assert.deepEqual(DK.get('paper'), DK.KINDS.paper, 'nothing registered yet');
  const impl = { edit: () => 'edit', thumb: () => 'thumb', exportFile: () => 'out', importFile: () => 'in', measure: () => 3 };
  DK.register('paper', impl);
  const paper = DK.get('paper');
  assert.equal(paper.label, 'Document');
  assert.equal(paper.edit(), 'edit');
  assert.equal(paper.measure(), 3);
  assert.throws(() => DK.register('sheet', impl), /sheet/);
  assert.equal(DK.get('sheet'), null);
  assert.equal(DK.get('toString'), null);
});
