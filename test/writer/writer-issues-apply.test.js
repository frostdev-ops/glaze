// Applying a suggestion (writer/writer-issues.js apply) never deletes a footnote mark or picture: the card's range is
// read again at apply time, and when a mark or picture now sits under it, or its text is no longer what was checked,
// nothing is applied and the card stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');
const PM = globalThis.GZ_PM;
const I = require('../../extension/writer/writer-issues.js');

const view = (html) => {
  const v = { state: PM.state.EditorState.create({ doc: S.parse(S.paper, html), plugins: [I.plugin()] }), dispatch(tr) { this.state = this.state.apply(tr); } };
  return { v, api: I.bind(v) };
};
const notes = (doc) => { let n = 0; doc.descendants((x) => { if (x.type.name === 'footnote_ref') n++; }); return n; };
const NOTE = (doc) => doc.type.schema.nodes.footnote_ref.create({ content: 'A note.' });

test('a suggestion whose range now holds a footnote mark inserted after the check is refused and its card kept', () => {
  const { v, api } = view('<p>The results was clear and significant. We moved on.</p>');
  // The AI checked "The results was clear and significant." (1–39); the student then put a note inside it.
  v.dispatch(v.state.tr.insert(23, NOTE(v.state.doc)));
  api.set('ai', [{ from: 1, to: 40, kind: 'grammar', message: 'Agreement', suggestions: ['The results were clear and significant.'], id: 'x' }]);
  const [card] = api.list();
  assert.ok(card, 'the card is shown');
  assert.equal(api.apply(card, 0), false);
  assert.equal(notes(v.state.doc), 1, 'the note is still there');
  assert.equal(api.list().length, 1, 'the card stays');
});
test('a picture under the range is kept too; a range of plain text still applies', () => {
  const { v, api } = view('<p>Teh cat sat.</p>');
  api.set('harper', [{ from: 1, to: 4, kind: 'spelling', message: 'Spelling', suggestions: ['The'], id: 'a' }]);
  assert.equal(api.apply(api.list()[0], 0), true);
  assert.equal(v.state.doc.textContent, 'The cat sat.');
  const img = view('<p>Big <img src="data:image/png;base64,iVBORw0KGgo=" alt="x"> cats sat.</p>');
  img.api.set('ai', [{ from: 1, to: 7, kind: 'grammar', message: 'Wording', suggestions: ['Large cats'], id: 'b' }]);
  const card = img.api.list()[0];
  if (card) { assert.equal(img.api.apply(card, 0), false); assert.equal(img.api.list().length, 1); }
  let pics = 0; img.v.state.doc.descendants((x) => { if (x.type.name === 'image') pics++; });
  assert.equal(pics, 1, 'the picture is still there');
});
test('a card whose text was replaced by a footnote mark in place of a space is refused', () => {
  const { v, api } = view('<p>teh cat</p>');
  api.set('harper', [{ from: 1, to: 8, kind: 'grammar', message: 'x', suggestions: ['the cat'], id: 'c' }]);
  const card = api.list()[0];
  // Replace the space with a mark outside the plugin's view of edits: the stored text must not read the mark as a space.
  const doc = v.state.doc, tr = v.state.tr.replaceWith(4, 5, NOTE(doc)).setMeta('addToHistory', false);
  v.dispatch(tr);
  const now = api.list()[0];
  if (now) assert.equal(api.apply(now, 0), false);
  assert.equal(notes(v.state.doc), 1);
  assert.ok(card);
});

// writer-cite.js maps a citation's end offset before a footnote mark or picture that follows it, so its fix applies and
// keeps the mark (MLA 9 §6.3: no comma between author and page; APA 7 §8.11: the year is required).
const C = require('../../extension/writer/writer-cite.js');
const MORRISON = { id: 'morrison', type: 'book', author: [{ family: 'Morrison', given: 'Toni' }], title: 'Beloved', issued: { 'date-parts': [[1987]] } };
const SMITH = { id: 'smith', type: 'book', author: [{ family: 'Smith', given: 'Ann' }], title: 'Things', issued: { 'date-parts': [[2020]] } };
const FN = '<sup class="gz-footnote" data-footnote="A note."></sup>', PIC = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">';
const leaves = (doc) => { let n = 0; doc.descendants((x) => { if (x.isInline && !x.isText) n++; }); return n; };
test('a citation fix right before a footnote mark or picture applies and keeps it (MLA 6.3, APA 8.11)', () => {
  for (const after of [FN, PIC]) {
    for (const [style, html, src, want] of [['mla9', `<p>She says (Morrison, 42)${after}.</p>`, MORRISON, 'She says (Morrison 42).'], ['apa7', `<p>It held (Smith, p. 4)${after}.</p>`, SMITH, 'It held (Smith, 2020, p. 4).']]) {
      const { v, api } = view(html);
      const issues = C.check(v.state.doc, [src], style).filter((i) => i.suggestions.length);
      assert.equal(issues.length, 1, `${style} ${after.slice(0, 4)}`);
      assert.equal(v.state.doc.nodeAt(issues[0].to - 1)?.isText, true, 'the range ends on the citation\'s last character');
      api.set('cite', issues);
      assert.equal(api.apply(api.list()[0], 0), true, `${style}: the fix applies`);
      assert.equal(v.state.doc.textContent, want);
      assert.equal(leaves(v.state.doc), 1, 'the mark or picture is kept');
    }
  }
  // A narrative citation's card ends before the mark too.
  const { v } = view(`<p>As Smith (2019)${FN} found.</p>`), card = C.check(v.state.doc, [], 'apa7')[0];
  assert.equal(v.state.doc.textBetween(card.from, card.to, '', '#'), 'Smith (2019)');
});
