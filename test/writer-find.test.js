// Glaze Writer's Find and Replace (writer-find.js) at the EditorState level: matches across marks, inside tables and
// footnotes, never across a paragraph or a note mark; match case and whole word; curly and straight quotes as one; replace
// one and replace all, each one undoable step of its own; the decorations plugin's current match.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const FIND = require('../writer-find.js');
const FX = require('./fixtures/writer-paper-fixtures.js');
const { undo } = GZ_PM.history;

const stateOf = (json, plugins = []) => {
  const base = E.state({ html: '', mode: 'paper' });
  return GZ_PM.state.EditorState.create({ doc: S.paper.nodeFromJSON(json), plugins: [...base.plugins, ...plugins] });
};
const doc = (...content) => ({ type: 'doc', content });
const BLOCK = { align: null, indent: 0, line: null, first: null };
const para = (...content) => ({ type: 'paragraph', attrs: BLOCK, content: content.map((c) => (typeof c === 'string' ? { type: 'text', text: c } : c)) });
const text = (st, h) => st.doc.textBetween(h.from, h.to);

test('finds every match in document order, across marks and page breaks', () => {
  const st = stateOf(doc(para('The clearing and the ', { type: 'text', text: 'clea', marks: [{ type: 'bold' }] }, { type: 'text', text: 'ring', marks: [{ type: 'italic' }] }, '.'), { type: 'page_break' }, para('Clearing again.')));
  const hits = FIND.search(st.doc, 'clearing', {});
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((h) => text(st, h)), ['clearing', 'clearing', 'Clearing']);
  assert.ok(hits[0].from < hits[1].from && hits[1].from < hits[2].from);
});

test('match case and whole word', () => {
  const st = stateOf(doc(para('Art, art, artist, start. ART.')));
  assert.equal(FIND.search(st.doc, 'art', {}).length, 5);
  assert.equal(FIND.search(st.doc, 'art', { word: true }).length, 3);
  assert.equal(FIND.search(st.doc, 'art', { cs: true }).length, 3);
  assert.equal(FIND.search(st.doc, 'art', { cs: true, word: true }).length, 1);
  assert.equal(FIND.search(st.doc, 'Art', { cs: true, word: true }).length, 1);
  assert.equal(FIND.search(st.doc, 'élan', { word: true }).length, 0);
  assert.equal(FIND.search(stateOf(doc(para('Un élan, élans.'))).doc, 'élan', { word: true }).length, 1);
});

test('the query is text, not a pattern, and an empty query finds nothing', () => {
  const st = stateOf(doc(para('Costs (n.d.) rose 3.5* in [2020].')));
  assert.equal(FIND.search(st.doc, '(n.d.)', {}).length, 1);
  assert.equal(FIND.search(st.doc, '3.5*', {}).length, 1);
  assert.equal(FIND.search(st.doc, '[2020]', {}).length, 1);
  assert.equal(FIND.search(st.doc, '', {}).length, 0);
  assert.equal(FIND.search(st.doc, '.', {}).length, 4);
});

test('straight quotes find the smart quotes the editor types, and the other way', () => {
  const st = stateOf(doc(para('Sethe’s “rememory” and Paul D\'s "tin".')));
  assert.equal(FIND.search(st.doc, "Sethe's", {}).length, 1);
  assert.equal(FIND.search(st.doc, '"rememory"', {}).length, 1);
  assert.equal(FIND.search(st.doc, 'D’s “tin”', {}).length, 1);
});

test('never across a paragraph, a hard break or a note mark', () => {
  const st = stateOf(doc(para('river'), para('bank'), para('river', { type: 'hard_break' }, 'bank'), para('river', { type: 'footnote_ref', attrs: { content: 'x' } }, 'bank')));
  assert.equal(FIND.search(st.doc, 'riverbank', {}).length, 0);
  assert.equal(FIND.search(st.doc, 'river bank', {}).length, 0);
  assert.equal(FIND.search(st.doc, 'river', {}).length, 3);
});

test('inside tables and footnotes, a note\'s match at its mark', () => {
  const st = stateOf(FX.papers.chicago17());
  const hits = FIND.search(st.doc, 'Knopf', {});
  assert.equal(hits.length, 1);
  assert.ok(hits[0].note, 'the match is in a note');
  assert.equal(st.doc.nodeAt(hits[0].from).type.name, 'footnote_ref');
  assert.equal(hits[0].to, hits[0].from + 1);
  // Body and note matches in one order: "Beloved" in the text, then in the note after it.
  const all = FIND.search(st.doc, 'Beloved', { cs: true });
  for (let i = 1; i < all.length; i++) assert.ok(all[i].from >= all[i - 1].from);
  assert.ok(all.some((h) => h.note) && all.some((h) => !h.note));
  const table = { type: 'table', content: [{ type: 'table_row', content: [{ type: 'table_cell', content: [para('cell river')] }, { type: 'table_cell', content: [para('river')] }] }] };
  const t = stateOf(doc(para('river'), table));
  assert.equal(FIND.search(t.doc, 'river', {}).length, 3);
});

test('replace all is one undoable step, apart from the typing before it', () => {
  let st = stateOf(doc(para('The clearing, the ', { type: 'text', text: 'clearing', marks: [{ type: 'italic' }] }, '.'), para('Clearing.')));
  st = st.apply(st.tr.insertText('!', st.doc.content.size - 1)); // typing just before
  const typed = st.doc;
  const tr = FIND.replace(st, FIND.search(st.doc, 'clearing', {}), 'glade');
  st = st.apply(tr);
  assert.equal(st.doc.textContent, 'The glade, the glade.glade.!');
  // the italic one stays italic
  let italic = '';
  st.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'italic')) italic += n.text; });
  assert.equal(italic, 'glade');
  let back = st;
  undo(back, (t) => { back = back.apply(t); });
  assert.ok(back.doc.eq(typed), 'one undo brings back the text as it was typed, typing kept');
});

test('replace with nothing deletes, and replace in a footnote rewrites the note', () => {
  let st = stateOf(FX.papers.chicago17());
  const hits = FIND.search(st.doc, 'Knopf', {});
  st = st.apply(FIND.replace(st, hits, 'Vintage'));
  let notes = [];
  st.doc.descendants((n) => { if (n.type.name === 'footnote_ref') notes.push(n.attrs.content); });
  assert.ok(notes[0].includes('Vintage') && !notes[0].includes('Knopf'));
  assert.ok(notes[0].includes('<em>Beloved</em>'), 'the note keeps its italics');
  st = st.apply(FIND.replace(st, FIND.search(st.doc, 'Vintage, ', {}), ''));
  notes = [];
  st.doc.descendants((n) => { if (n.type.name === 'footnote_ref') notes.push(n.attrs.content); });
  assert.ok(notes[0].includes('(New York: 1987)'), notes[0]);
});

test('the plugin keeps the matches and the current one, and maps them through edits', () => {
  const p = FIND.plugin();
  let st = stateOf(doc(para('a river, a river, a river')), [p]);
  st = st.apply(st.tr.setMeta(FIND.key, { query: 'river', at: 0 }));
  let s = FIND.key.getState(st);
  assert.equal(s.hits.length, 3);
  assert.equal(s.current, 0);
  assert.equal(s.decos.find().length, 3);
  assert.equal(s.decos.find().filter((d) => /ge-cur/.test(d.type.attrs.class)).length, 1);
  st = st.apply(st.tr.setMeta(FIND.key, { current: 2 }));
  assert.equal(FIND.key.getState(st).current, 2);
  st = st.apply(st.tr.insertText('XX', 1));
  s = FIND.key.getState(st);
  assert.equal(text(st, s.hits[0]), 'river', 'hits follow the edit');
  st = st.apply(st.tr.setMeta(FIND.key, { query: '' }));
  assert.equal(FIND.key.getState(st).hits.length, 0);
  assert.equal(FIND.key.getState(st).decos.find().length, 0);
});

test('first match at or after a position, wrapping', () => {
  const st = stateOf(doc(para('a river, a river, a river')));
  const hits = FIND.search(st.doc, 'river', {});
  assert.equal(FIND.near(hits, 0), 0);
  assert.equal(FIND.near(hits, hits[1].from), 1);
  assert.equal(FIND.near(hits, hits[2].to), 0);
  assert.equal(FIND.near([], 3), -1);
});
