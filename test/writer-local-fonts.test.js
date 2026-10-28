// An imported paper's well-known fonts Writer doesn't bundle (Word 365's Aptos and Office's others): kept by name in the
// setup and on runs, laid out with their own single line (Word's spacing), drawn in the font where the computer has it
// and its bundled twin where not, named in the .docx's fontTable; a paste still sets only the four.
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../lib/writer-styles.js');
const S = require('../lib/writer-schema.js');
const P = require('../writer-paste.js');
const X = require('../lib/writer-docx.js');

const mla = ST.FORMATS.mla9;

test('the setup keeps Aptos; its lines are Word\'s Aptos lines; the page asks for Aptos, then Calibri', () => {
  const s = ST.setup({ ...ST.pageSetup(mla), own: false, font: 'Aptos', size: 12 });
  assert.equal(s.font, 'Aptos');
  assert.equal(ST.setup({ ...s, font: 'Wingdings' }).font, null, 'an unknown font is still refused');
  const L = ST.look(mla, s);
  assert.equal(ST.lineHeight(L, { line: 1 }), Math.round((Math.round(12 * 20 * 2631 / 2048) / 20) * 96 / 72 * 1000) / 1000);
  assert.match(ST.css(L), /font-family: "Aptos", "Calibri", sans-serif/);
  for (const name of ['Aptos Display', 'Calibri Light', 'Cambria', 'Georgia']) assert.ok(ST.LOCAL[name], name);
});

test('runs keep a well-known font through Writer\'s HTML; a paste maps only to the four', () => {
  const doc = S.parse(S.paper, '<p><span style="font-family:Aptos">aptos words</span> <span style="font-family:Cambria">cambria words</span></p>');
  const fonts = [];
  doc.descendants((n) => { if (n.isText) fonts.push(n.marks.find((m) => m.type.name === 'text_style')?.attrs.font ?? null); });
  assert.deepEqual(fonts, ['Aptos', null, 'Cambria']);
  const again = S.parse(S.paper, S.serialize(S.paper, doc));
  assert.equal(S.serialize(S.paper, again), S.serialize(S.paper, doc));
  assert.doesNotMatch(P.normalize('<p><span style="font-family:Aptos">pasted</span></p>').html, /Aptos/);
});

test('the .docx names the paper\'s own font in its defaults and its font table', () => {
  const setup = { ...ST.pageSetup(mla), own: false, font: 'Aptos', size: 12 };
  const o = X.exportDocx({ type: 'doc', attrs: { setup }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body', marks: [{ type: 'text_style', attrs: { font: 'Cambria', size: null } }] }] }] }, { format: 'mla9', date: new Date('2026-10-28T12:00:00Z') });
  assert.match(o.parts['word/styles.xml'], /<w:rFonts w:ascii="Aptos"/);
  assert.match(o.parts['word/fontTable.xml'], /w:name="Aptos"/);
  assert.match(o.parts['word/fontTable.xml'], /w:name="Cambria"/);
  assert.match(o.parts['word/document.xml'], /w:ascii="Cambria"/);
});
