// writer/writer-schema.js text(): a range of offsets that ends where a footnote mark or picture begins stops before it,
// a range across one is refused (an edit would delete it), and AI's form of the text carries the notes after the draft
// with the draft's offsets unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');

const P = S.paper;
const note = (html) => P.nodes.footnote_ref.create({ content: html });
const pic = () => P.nodes.image.create({ src: 'https://example.com/a.png' });
const para = (...parts) => P.nodes.paragraph.create(null, parts.map((p) => (typeof p === 'string' ? P.text(p) : p)));
const doc = (...blocks) => P.nodes.doc.create(null, blocks);
const count = (d, name) => { let n = 0; d.descendants((x) => { if (x.type.name === name) n++; }); return n; };
const SENT = 'The results was clear and significant.';

test('a range ending where a footnote mark or picture begins stops before it, and replacing it keeps the leaf', () => {
  for (const leaf of [note('Smith, <em>Time</em>, 3.'), pic()]) {
    const d = doc(para(SENT, leaf, ' We then moved on.'));
    const t = S.text(d), end = SENT.length;
    assert.equal(t.text.slice(0, end), SENT);
    assert.equal(t.posAt(end, -1), 1 + end, 'the end side stays before the leaf');
    assert.equal(t.posAt(end), 2 + end, 'a start offset still lands after it');
    const r = t.range(0, end);
    assert.deepEqual(r, { from: 1, to: 1 + end });
    const { Slice, Fragment } = GZ_PM.model;
    const after = d.replace(r.from, r.to, new Slice(Fragment.from(P.text('The results were clear and significant.')), 0, 0));
    assert.equal(count(after, leaf.type.name), 1, `${leaf.type.name} kept`);
    assert.equal(after.textContent.startsWith('The results were clear'), true);
  }
});

test('a range across a footnote mark or picture is refused; one across a hard break or a paragraph end is not a leaf', () => {
  const d = doc(para('One two', note('n'), ' three.'), para('Four', P.nodes.hard_break.create(), 'five.'));
  const t = S.text(d);
  assert.equal(t.range(0, 'One two three'.length), null, 'across the note');
  assert.equal(t.range(4, 7) && d.textBetween(t.range(4, 7).from, t.range(4, 7).to), 'two');
  assert.equal(t.range(7, 14) && d.textBetween(t.range(7, 14).from, t.range(7, 14).to), ' three.', 'starting right after the note');
  const four = t.text.indexOf('Four'), r = t.range(four, t.text.length);
  assert.ok(r, 'a hard break inside is fine');
  assert.equal(d.textBetween(r.from, r.to, '\n', '\n'), 'Four\nfive.');
  assert.equal(t.range(5, 5), null, 'empty');
  assert.equal(t.range(-1, 3), null);
  assert.equal(t.range(3, t.text.length + 1), null);
});
test('AI\'s form of the text adds the notes, in order, after the draft; the draft\'s offsets and ranges are those of text()', () => {
  const d = doc(para('Alpha', note('Smith, <em>Swing Time</em>, 320.'), ' beta.'), para('Gamma', note('Second<br>note.'), '.'));
  const plain = S.text(d), ai = S.text(d, { notes: true });
  assert.equal(plain.text, 'Alpha beta.\nGamma.', 'plain text() is unchanged (word counts read it)');
  assert.equal(ai.text, 'Alpha beta.\nGamma.\n\nFootnotes:\n1. Smith, Swing Time, 320.\n2. Second note.');
  assert.equal(ai.main, plain.text.length);
  for (let i = 0; i <= plain.text.length; i++) { assert.equal(ai.posAt(i), plain.posAt(i)); assert.equal(ai.posAt(i, -1), plain.posAt(i, -1)); }
  const n = ai.text.indexOf('Smith');
  assert.equal(ai.range(n, n + 5), null, 'note text maps to no place in the paper');
  assert.deepEqual(S.notes(d), ['Smith, Swing Time, 320.', 'Second note.']);
  assert.deepEqual(S.notes(d.child(1)), ['Second note.']);
  const none = doc(para('No notes here.'));
  assert.equal(S.text(none, { notes: true }).text, 'No notes here.');
});
