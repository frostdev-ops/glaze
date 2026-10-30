const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const { pack, r } = require('./fixtures/writer-hostile.js');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const contentOf = (doc) => { let content; doc.descendants((n) => { if (n.type.name === 'footnote_ref') content = n.attrs.content; }); return content; };

test('multi-paragraph footnotes keep paragraph boundaries, hard breaks and marks through two imports', async () => {
  const bytes = pack(`<w:p>${r('Body')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`, {
    'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${r(' First paragraph.')}</w:p><w:p>${r('Second line')}<w:r><w:br/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Still second.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
  });
  const first = S.paper.nodeFromJSON((await X.importDocx(bytes)).doc);
  const note = contentOf(first);
  assert.equal(note, '<p>First paragraph.</p><p>Second line<br><strong>Still second.</strong></p>');
  const out = X.exportDocx(first);
  const noteXML = /<w:footnote w:id="1">([\s\S]*?)<\/w:footnote>/.exec(out.parts['word/footnotes.xml'])[1];
  assert.equal((noteXML.match(/<w:p>/g) || []).length, 2);
  const second = S.paper.nodeFromJSON((await X.importDocx(out.bytes)).doc);
  assert.equal(contentOf(second), note);
});

test('note sanitising keeps empty paragraphs and hard breaks while removing objects and unsafe links', () => {
  const note = S.inline('<p>A<br>B</p><p></p><p><script>bad()</script><a href="javascript:1">C</a><img src="https://bad.test/x"></p>');
  assert.equal(note, '<p>A<br>B</p><p></p><p>C</p>');
  assert.equal(S.inline(note), note);
});
