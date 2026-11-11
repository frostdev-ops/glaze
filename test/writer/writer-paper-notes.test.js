// A footnote edited in its popup (writer/frame/writer-paper.js noteEdit): the popup shows the note's plain text, and only
// what the student changed is rewritten, so the rest keeps its italics (a Chicago note's title), links and bold.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');
globalThis.GZ_WRITER_SCHEMA = S;
const P = require('../../extension/writer/frame/writer-paper.js');

const note = (html) => S.inline(html);
test('editing a note keeps the formatting of the text around the change (CMOS 14.19: titles in notes keep their italics)', () => {
  const content = note('Zadie Smith, <em>Swing Time</em> (New York: Penguin, 2016), 320. See <a href="https://example.com/">here</a>.');
  const plain = P.noteText(content);
  assert.equal(plain, 'Zadie Smith, Swing Time (New York: Penguin, 2016), 320. See here.');
  assert.equal(P.noteEdit(content, plain.replace('320', '321')), note('Zadie Smith, <em>Swing Time</em> (New York: Penguin, 2016), 321. See <a href="https://example.com/">here</a>.'));
  // Typing inside the italic title extends it; typing after it does not.
  assert.equal(P.noteEdit(content, plain.replace('Swing Time', 'Swing Times')), note('Zadie Smith, <em>Swing Times</em> (New York: Penguin, 2016), 320. See <a href="https://example.com/">here</a>.'));
  assert.equal(P.noteEdit(content, plain.replace('Penguin', 'Penguin Press')), note('Zadie Smith, <em>Swing Time</em> (New York: Penguin Press, 2016), 320. See <a href="https://example.com/">here</a>.'));
  // Paragraphs and line breaks: the same split the popup shows.
  const two = note('<p>First <strong>bold</strong>.</p><p>Second<br>line.</p>');
  assert.equal(P.noteText(two), 'First bold.\n\nSecond\nline.');
  assert.equal(P.noteEdit(two, 'First bold!\n\nSecond\nline.'), note('<p>First <strong>bold</strong>!</p><p>Second<br>line.</p>'));
  // Text typed with no formatting is escaped, never markup.
  assert.equal(P.noteEdit(note('Plain.'), 'Plain <b>&</b>.'), note('Plain &lt;b&gt;&amp;&lt;/b&gt;.'));
});
test('separate edits in one popup preserve the marks between the changes', () => {
  const content = note('Zadie Smith, <em>Swing Time</em>, 320. See <a href="https://example.com/">here</a> and <strong>this</strong>.');
  const text = P.noteText(content).replace('Zadie', 'Z.').replace('320', '321').replace('this.', 'these.');
  assert.equal(P.noteEdit(content, text), note('Z. Smith, <em>Swing Time</em>, 321. See <a href="https://example.com/">here</a> and <strong>these</strong>.'));
  const unicode = note('😀 <em>Title</em> 10.');
  assert.equal(P.noteEdit(unicode, '😃 Title 11.'), note('😃 <em>Title</em> 11.'));
});
