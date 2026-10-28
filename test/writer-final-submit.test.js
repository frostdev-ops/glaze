// Writer's submit, final review: what a failed, cancelled or interrupted submit leaves behind (the worker's permit, the
// paper's versions, Ultra's own text box and buttons), and the paper's word count as the editor makes it.
const test = require('node:test');
const assert = require('node:assert/strict');

const BLOCK = { align: null, indent: 0, line: null, first: null };
const para = (...content) => ({ type: 'paragraph', attrs: BLOCK, content });
const text = (t, marks) => ({ type: 'text', text: t, ...(marks && { marks }) });

test('F5: a paper\'s words are counted as the status bar counts them, hard breaks and all', () => {
  const S = require('../lib/writer-schema.js'), E = require('../lib/writer-editor.js'), P = require('../lib/writer-papers.js');
  const docs = {
    hardBreak: [para(text('one'), { type: 'hard_break' }, text('two'))],
    marks: [para(text('alpha'), text('beta', [{ type: 'bold' }]))],
    blocks: [para(text('one two')), para(text('three'))],
    footnote: [para(text('word'), { type: 'footnote_ref', attrs: { content: 'a note of four words' } }, text('next'))],
    quote: [{ type: 'blockquote', content: [para(text('quoted words')), para(text('more'), { type: 'hard_break' }, text('lines'))] }],
  };
  for (const [name, content] of Object.entries(docs)) {
    const json = { type: 'doc', content };
    assert.equal(P.measure(json).words, E.words(S.text(S.paper.nodeFromJSON(json)).text), name);
  }
});

const page = require('./helpers/writer-submit-page.cjs');
const L = require('../lib/writer-submit.js');
const done = (p) => p.sent.filter((m) => m.type === 'submit:done').map((m) => (m.ok ? 'ok' : m.error));

test('D9: once Writer has clicked Ultra\'s Submit, Ultra\'s Save and Close works again (after the paper saves)', async () => {
  const p = page();
  await p.go();
  assert.deepEqual(done(p), ['ok']);
  // Ultra's confirmation, cancelled: the student is back on the attempt and presses Save and Close.
  const save = L.footer(p.box.editor).save;
  save.disabled = false; save.removeAttribute('disabled'); save.className = '';
  p.fire(save, 'click');
  const asked = p.sent.filter((m) => m.type === 'submit:save');
  assert.equal(asked.length, 1, 'the paper is saved first, as before any submit');
  p.hear({ type: 'submit:saved', request: asked[0].request, ok: true });
  assert.equal(p.clicks.filter((b) => b === save).length, 1, 'then Ultra\'s own Save and Close goes on');
});
