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
