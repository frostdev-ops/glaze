const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const X = require('../lib/writer-docx.js');
const PA = require('../lib/writer-papers.js');
const { fixtures } = require('./fixtures/writer-hostile.js');
globalThis.GZ_WRITER_OBJECTS_DOCX = require('../lib/writer-objects-docx.js');
const storage = () => {
  const data = {};
  return { get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (p) => Object.assign(data, structuredClone(p)), remove: async () => {} };
};
const nodes = (doc, name) => { const out = []; doc.descendants((n) => { if (n.type.name === name) out.push(n); }); return out; };
for (const [name, make] of Object.entries(fixtures)) test(`hostile ${name}: import → edit → version → restore → export → re-import`, async () => {
  const f = make(), imported = await X.importDocx(f.bytes), first = S.paper.nodeFromJSON(imported.doc);
  assert.equal(first.textContent, f.text, 'all accepted visible content survives import');
  if (f.headings) assert.deepEqual(nodes(first, 'heading').map((n) => n.attrs.level), f.headings);
  if (f.levels) assert.deepEqual(nodes(first, 'list_item').map((n) => n.attrs.indent), f.levels);
  if (f.note) assert.ok(nodes(first, 'footnote_ref')[0].attrs.content.includes(f.note));
  if (f.images) assert.equal(nodes(first, 'image').length, f.images);
  if (f.breaks) assert.equal(nodes(first, 'page_break').length, f.breaks);
  if (f.warnings) for (const warning of f.warnings) assert.ok(imported.warnings.includes(warning), warning);
  first.check();
  let state = E.state({ mode: 'paper' });
  state = state.apply(state.tr.replaceWith(0, state.doc.content.size, first.content).setDocAttribute('setup', first.attrs.setup));
  let at; state.doc.descendants((n, pos) => { if (at == null && n.isTextblock) at = pos + 1; });
  state = state.apply(state.tr.insertText('!', at));
  const edited = state.doc;
  let time = 1;
  const papers = PA.open(storage(), () => ++time);
  await papers.save(name, { doc: edited.toJSON(), format: 'mla9', keep: true });
  const version = (await papers.versions(name))[0];
  await papers.save(name, { doc: S.paper.node('doc', null, [S.paper.node('paragraph')]).toJSON(), keep: false });
  const restored = (await papers.restore(name, version.id)).paper;
  assert.ok(S.paper.nodeFromJSON(restored.doc).eq(edited));
  assert.equal(restored.keep, true);
  const out = X.exportDocx(restored.doc), back = S.paper.nodeFromJSON((await X.importDocx(out.bytes)).doc);
  back.check();
  assert.equal(back.textContent, edited.textContent, 'every character survives the whole sequence');
  for (const type of ['table', 'image', 'footnote_ref', 'list_item', 'page_break']) assert.equal(nodes(back, type).length, nodes(edited, type).length, `${type} survives the whole sequence`);
  if (f.headings) assert.deepEqual(nodes(back, 'heading').map((n) => n.attrs.level), f.headings);
  if (f.stripped) { assert.ok(!Object.keys(out.parts).some((p) => /vba/i.test(p))); assert.ok(!Object.values(out.parts).some((p) => /invalid.test/.test(p))); }
});
test('zero-byte and truncated Word files are refused', async () => {
  await assert.rejects(X.importDocx(new Uint8Array()));
  const bytes = fixtures.unicode().bytes;
  for (const cut of [1, 30, Math.floor(bytes.length / 2), bytes.length - 22]) await assert.rejects(X.importDocx(bytes.slice(0, cut)));
});

test('explicit Word paragraph and run direction survive HTML and Word round trips', async () => {
  const { pack, p, r } = require('./fixtures/writer-hostile.js');
  const bytes = pack(p('فقرة', '<w:bidi/>') + `<w:p>${r('A ')}<w:r><w:rPr><w:rtl/></w:rPr><w:t>123 مرحبا</w:t></w:r><w:r><w:rPr><w:rtl w:val="0"/></w:rPr><w:t> B</w:t></w:r></w:p>`);
  const doc = S.paper.nodeFromJSON((await X.importDocx(bytes)).doc);
  assert.equal(doc.firstChild.attrs.dir, 'rtl');
  assert.deepEqual(doc.lastChild.content.content.slice(1).map((n) => n.marks.find((m) => m.type.name === 'direction')?.attrs.dir), ['rtl', 'ltr']);
  const html = S.serialize(S.paper, doc);
  assert.match(html, /dir="rtl"/);
  assert.ok(S.parse(S.paper, html).type.create(doc.attrs, S.parse(S.paper, html).content).eq(doc));
  const exported = X.exportDocx(doc);
  assert.match(exported.parts['word/document.xml'], /<w:bidi\/>/);
  assert.match(exported.parts['word/document.xml'], /<w:rtl\/>/);
  const back = S.paper.nodeFromJSON((await X.importDocx(exported.bytes)).doc);
  assert.equal(back.firstChild.attrs.dir, 'rtl');
  assert.deepEqual(back.lastChild.toJSON(), doc.lastChild.toJSON());
  assert.deepEqual(S.loses(S.compose, '<p dir="rtl">فقرة</p>'), ['format']);
});

test('an unsupported stored picture fails export instead of silently replacing it with text', () => {
  const image = S.paper.node('image', { src: 'data:image/webp;base64,UklGRg==', alt: 'Diagram' });
  assert.throws(() => X.exportDocx(S.paper.node('doc', null, [S.paper.node('paragraph', null, image)])), /picture|image/i);
});
