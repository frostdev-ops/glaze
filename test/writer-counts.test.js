// Glaze Writer's word count popover (writer-counts.js): words as the status bar counts them, characters with and without
// spaces, paragraphs, sentences and reading time, for the whole document and for a selection.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const C = require('../writer-counts.js');
const FX = require('./fixtures/writer-paper-fixtures.js');

const BLOCK = { align: null, indent: 0, line: null, first: null };
const para = (...content) => ({ type: 'paragraph', attrs: BLOCK, ...(content.length ? { content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c } : c)) } : {}) });
const doc = (...content) => S.paper.nodeFromJSON({ type: 'doc', content });

test('a small document', () => {
  const d = doc(para('The river keeps. It waits!'), para(), para('Does it ask?  No.'), { type: 'page_break' }, para('Works Cited'));
  const c = C.counts(d);
  assert.equal(c.words, 11);
  assert.equal(c.chars, 'The river keeps. It waits!'.length + 'Does it ask?  No.'.length + 'Works Cited'.length);
  assert.equal(c.charsNoSpaces, ['The river keeps. It waits!', 'Does it ask?  No.', 'Works Cited'].join('').replace(/\s/g, '').length);
  assert.equal(c.paragraphs, 3);
  assert.equal(c.sentences, 5);
  assert.equal(c.minutes, 1);
});

test('words match the status bar\'s count on every paper fixture', () => {
  for (const id of ['mla9', 'apa7', 'chicago17']) {
    const d = S.paper.nodeFromJSON(FX.papers[id]());
    const c = C.counts(d);
    assert.equal(c.words, E.words(S.text(d).text), id);
    assert.ok(c.sentences > 40 && c.paragraphs > 15, `${id}: ${JSON.stringify(c)}`);
    assert.equal(c.minutes, Math.max(1, Math.round(c.words / 238)));
  }
});

test('a selection counts only what it covers, clipped inside paragraphs', () => {
  const d = doc(para('One two three. Four five.'), para('Six seven.'));
  const from = 1 + 'One '.length, to = d.child(0).nodeSize + 1 + 'Six'.length;
  const c = C.counts(d, from, to);
  assert.equal(c.words, 5);
  assert.equal(c.chars, 'two three. Four five.'.length + 'Six'.length);
  assert.equal(c.paragraphs, 2);
  assert.equal(c.sentences, 3);
});

test('an empty document and note marks', () => {
  assert.deepEqual(C.counts(doc(para())), { words: 0, chars: 0, charsNoSpaces: 0, paragraphs: 0, sentences: 0, minutes: 0 });
  const d = doc(para('Cited', { type: 'footnote_ref', attrs: { content: 'A note.' } }, ' here.'));
  assert.equal(C.counts(d).chars, 'Cited here.'.length);
});

test('characters are what a reader sees: an accent or emoji is one', () => {
  const c = C.counts(doc(para('café 👋🏽')));
  assert.equal(c.chars, 6);
  assert.equal(c.charsNoSpaces, 5);
});
