// Check with AI (writer/frame/writer-ai.js placer): a suggestion's offsets in the text the model read become positions in the
// document as it is now, and the words there must still be the quote. A footnote mark or picture put inside the range since the
// check is no text in textBetween, so the words looked unchanged and the suggestion was offered over it (writer-issues.js's
// apply guard was the only thing that refused it). The placer rejects such leaves independently of the quote's characters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../extension/writer/writer-schema.js');

const P = S.paper, PM = GZ_PM;
const src = fs.readFileSync(path.join(__dirname, '../../extension/writer/frame/writer-ai.js'), 'utf8');
const PLACER = src.slice(src.indexOf('  const placer = '), src.indexOf('  const review = async'));
assert.ok(PLACER.includes('textBetween'));

const note = () => P.nodes.footnote_ref.create({ content: 'Smith, 3.' });
const pic = () => P.nodes.image.create({ src: 'https://example.com/a.png' });
const para = (...parts) => P.nodes.paragraph.create(null, parts.map((p) => (typeof p === 'string' ? P.text(p) : p)));
const doc = (...blocks) => P.nodes.doc.create(null, blocks);
const TEXT = 'The results was clear and significant, as the first study showed.';

// The placer for the document the model read, over the document now (what a transaction made of it).
const placerOver = (before, edit, change = (tr) => tr) => {
  const tr = change(new PM.transform.Transform(before));
  const ctx = vm.createContext({ S, view: () => ({ state: { doc: tr.doc } }) });
  vm.runInContext(`${PLACER}\nglobalThis.placer = placer;`, ctx);
  return { place: ctx.placer(before, tr.mapping, edit), now: tr.doc };
};
const at = (quote) => [TEXT.indexOf(quote), TEXT.indexOf(quote) + quote.length, quote];
// The position in `d` of the paragraph's offset `n` (the paragraph starts at 1).
const insertAt = (leaf, offset) => (tr) => tr.insert(1 + offset, leaf());

test('unchanged text still places, for a suggestion and for a feedback anchor', () => {
  for (const edit of [true, false]) {
    const { place } = placerOver(doc(para(TEXT)), edit);
    const [s, e, q] = at('results was clear');
    assert.deepEqual({ ...place(s, e, q) }, { from: 1 + s, to: 1 + e }, `edit ${edit}`);
    assert.equal(place(s, e, 'results were clear'), null, `edit ${edit}: other words`);
  }
});

test('a footnote mark or picture put inside a suggestion\'s range after the check drops it', () => {
  for (const leaf of [note, pic]) {
    const [s, e, q] = at('results was clear');
    const inside = insertAt(leaf, s + 'results'.length);
    const { place, now } = placerOver(doc(para(TEXT)), true, inside);
    let leaves = 0;
    now.descendants((n) => { if (n.isInline && !n.isText) leaves++; });
    assert.equal(leaves, 1, 'the leaf is in the document');
    assert.equal(now.textBetween(1, now.content.size - 1, '\n'), TEXT, 'textBetween alone reads no change');
    assert.equal(place(s, e, q), null, `${leaf().type.name} inside the range`);
  }
});

test('a literal object-replacement character cannot hide a new footnote or picture inside a suggestion', () => {
  const quote = 'results \ufffc was clear', text = `The ${quote} and significant.`;
  const before = doc(para(text)), start = text.indexOf(quote), end = start + quote.length;
  const unchanged = placerOver(before, true).place(start, end, quote);
  assert.ok(unchanged, 'the literal Unicode character is ordinary text before it is replaced');
  for (const leaf of [note, pic]) {
    const pos = 1 + text.indexOf('\ufffc');
    const { place, now } = placerOver(before, true, (tr) => tr.replaceWith(pos, pos + 1, leaf()));
    assert.equal(now.nodeAt(pos).type.name, leaf().type.name, 'the character was replaced by an inline object');
    assert.equal(place(start, end, quote), null, `${leaf().type.name} must not be covered by the suggestion`);
  }
});

test('a leaf outside the range, or at its edge, leaves the suggestion in place', () => {
  const [s, e, q] = at('results was clear');
  for (const leaf of [note, pic]) {
    for (const offset of [0, s - 1, s, e, e + 1, TEXT.length]) {
      const { place, now } = placerOver(doc(para(TEXT)), true, insertAt(leaf, offset));
      const got = place(s, e, q);
      assert.ok(got, `${leaf().type.name} at ${offset}`);
      assert.equal(now.textBetween(got.from, got.to, '\n'), q, `${leaf().type.name} at ${offset}`);
    }
  }
});

test('a feedback anchor is not dropped by a leaf (it only marks words)', () => {
  const [s, e, q] = at('results was clear');
  const { place } = placerOver(doc(para(TEXT)), false, insertAt(note, s + 'results'.length));
  assert.ok(place(s, e, q));
});

test('a suggestion at the check\'s own paragraph with a leaf elsewhere in the document still places', () => {
  const before = doc(para(TEXT), para('Second paragraph.'));
  const { place } = placerOver(before, true, (tr) => tr.insert(before.content.size - 1, note()));
  const [s, e, q] = at('first study');
  assert.deepEqual({ ...place(s, e, q) }, { from: 1 + s, to: 1 + e });
});
