// Glaze Writer's .docx (lib/writer-docx.js): the package export writes, part by part, against golden XML; doctext reads
// it back to the paper's text; importing it gives the paper back; and the import's limits for hostile files. Word opening
// these files is scripts/writer-word-fidelity.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const D = require('../lib/doctext.js');
const Z = require('../lib/zip.js');
const FX = require('./fixtures/writer-paper-fixtures.js');

const date = new Date('2026-10-27T12:00:00Z');
const golden = (n) => fs.readFileSync(path.join(__dirname, 'fixtures/writer-docx', n), 'utf8');
const pretty = (x) => `${x.replace(/></g, '>\n<')}\n`;
const mla = () => X.exportDocx(FX.papers.mla9(), { format: 'mla9', surname: 'Rivera', title: 'Essay 2: Memory in Beloved', date });
const chicago = () => X.exportDocx(FX.papers.chicago17(), { format: 'chicago17', title: 'Essay 2: Memory in Beloved', date });
const zipOf = (files) => { const parts = Z.zip(files.map(([name, text]) => ({ name, data: typeof text === 'string' ? new TextEncoder().encode(text) : text, date }))); return Buffer.concat(parts.map((p) => Buffer.from(p))); };

test('export: the MLA paper\'s parts are the golden XML', () => {
  const o = mla();
  for (const [file, part] of [['mla9-document.xml', 'word/document.xml'], ['mla9-styles.xml', 'word/styles.xml'], ['mla9-settings.xml', 'word/settings.xml'], ['mla9-header1.xml', 'word/header1.xml'], ['mla9-content-types.xml', '[Content_Types].xml'], ['mla9-document-rels.xml', 'word/_rels/document.xml.rels'], ['fonttable.xml', 'word/fontTable.xml']]) {
    assert.equal(pretty(o.parts[part]), golden(file), part);
  }
});

test('export: Chicago\'s footnotes, first-page header and section are the golden XML', () => {
  const o = chicago();
  assert.equal(pretty(o.parts['word/footnotes.xml']), golden('chicago17-footnotes.xml'));
  assert.equal(pretty(o.parts['word/header2.xml']), golden('chicago17-header2.xml'));
  assert.equal(pretty(o.parts['word/document.xml'].match(/<w:sectPr>.*<\/w:sectPr>/)[0]), golden('chicago17-sectpr.xml'));
  assert.equal(o.notes, 5);
});

test('export: what Word needs to open it as a 2013+ Letter document with the format\'s header', () => {
  const o = mla(), doc = o.parts['word/document.xml'];
  assert.match(o.parts['word/settings.xml'], /compatibilityMode" w:uri="http:\/\/schemas.microsoft.com\/office\/word" w:val="15"/);
  assert.match(doc, /<w:pgSz w:w="12240" w:h="15840"\/>/, 'Letter, never A4');
  assert.match(doc, /w:header="720"/, 'MLA\'s header half an inch down');
  assert.match(o.parts['word/header1.xml'], /Rivera <\/w:t><\/w:r><w:r><w:fldChar w:fldCharType="begin"\/><\/w:r><w:r><w:instrText xml:space="preserve"> PAGE <\/w:instrText>/, '"Lastname" then a PAGE field');
  for (const f of ['Times New Roman', 'Arial', 'Calibri', 'Courier New']) assert.ok(o.parts['word/fontTable.xml'].includes(`w:name="${f}"`), f);
  assert.match(o.parts['word/styles.xml'], /<w:rFonts w:ascii="Times New Roman"[^>]*\/><w:sz w:val="24"\/>/);
  assert.match(o.parts['word/styles.xml'], /<w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"\/>/, 'double');
  assert.ok(o.bytes[0] === 0x50 && o.bytes[1] === 0x4b, 'a zip');
  assert.ok(Object.keys(o.parts).every((p) => o.parts[p].startsWith('<?xml')));
});

test('export: each quoted paragraph and list item stays its own paragraph; page breaks become the next paragraph\'s', () => {
  const doc = S.parse(S.paper, '<p>a</p><blockquote><p>q1</p><p>q2</p></blockquote><ul><li>one</li><li class="ql-indent-1">two</li></ul><ol><li>x</li></ol><hr class="gz-page-break"><p class="ql-align-center">Works Cited</p><p>Entry.</p>');
  const o = X.exportDocx(doc, { format: 'mla9', date }), body = o.parts['word/document.xml'];
  assert.equal((body.match(/w:val="BlockQuote"/g) || []).length, 2, 'two quoted paragraphs, not one merged');
  assert.match(body, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">one/);
  assert.match(body, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="1"\/><\/w:numPr><\/w:pPr><w:r><w:t xml:space="preserve">two/);
  assert.match(body, /<w:numId w:val="2"\/>.*x</, 'the next list restarts its numbering');
  assert.match(o.parts['word/numbering.xml'], /<w:abstractNum w:abstractNumId="1">.*w:val="bullet".*<w:abstractNum w:abstractNumId="2">.*w:val="decimal"/);
  assert.match(body, /<w:pPr><w:pageBreakBefore\/><w:ind w:firstLine="0"\/><w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">Works Cited/);
  assert.match(body, /<w:pStyle w:val="Bibliography"\/><\/w:pPr><w:r><w:t xml:space="preserve">Entry\./, 'list entries take the hanging-indent style');
  assert.doesNotMatch(body, /w:type="page"/, 'no page-break runs that leave an empty line');
});

test('export: marks, links, fonts, line spacing, indents, tables and pictures', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const doc = S.parse(S.paper, `<p style="line-height:1.5;text-indent:-0.5in" class="ql-indent-1"><strong>b</strong><em>i</em><u>u</u><s>s</s><sup>p</sup><sub>d</sub><a href="https://example.com/x">link</a><span style="font-family:Arial;font-size:14pt">ar</span><img src="data:image/png;base64,${png}" alt="dot"></p><table><tr><td colspan="2"><p>c</p></td></tr><tr><td><p>1</p></td><td><p>2</p></td></tr></table>`);
  const o = X.exportDocx(doc, { format: 'apa7', date }), body = o.parts['word/document.xml'];
  for (const re of [/<w:b\/><w:bCs\/>/, /<w:i\/><w:iCs\/>/, /<w:u w:val="single"\/>/, /<w:strike\/>/, /superscript/, /subscript/, /<w:rFonts w:ascii="Arial"[^>]*\/><w:sz w:val="28"\/>/, /<w:spacing w:line="360" w:lineRule="auto"\/><w:ind w:left="720" w:hanging="720"\/>/, /<w:gridSpan w:val="2"\/>/, /<a:blip r:embed="rId\d+"\/>/]) assert.match(body, re);
  assert.match(o.parts['word/_rels/document.xml.rels'], /Target="https:\/\/example.com\/x" TargetMode="External"/);
  assert.match(o.parts['word/_rels/document.xml.rels'], /Target="media\/image1.png"/);
  assert.match(o.parts['word/document.xml'], /<w:hyperlink r:id="rId\d+" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"\/>/);
  assert.ok(!o.parts['word/header2.xml'], 'APA numbers the title page too');
});

test('export: the opening\'s explicit no-indent lines keep it; centred lines get none from Normal', () => {
  const body = mla().parts['word/document.xml'];
  assert.match(body, /<w:p><w:pPr><w:ind w:firstLine="0"\/><\/w:pPr><w:r><w:t xml:space="preserve">Alex Rivera/);
  assert.match(body, /<w:pPr><w:ind w:firstLine="0"\/><w:jc w:val="center"\/><\/w:pPr><w:r><w:t xml:space="preserve">What the River Keeps/);
});

test('export: footnote hyperlinks have relationships in the footnotes part', () => {
  const d = S.paper.nodes.doc.create(null, S.paper.nodes.paragraph.create(null, S.paper.nodes.footnote_ref.create({ content: '<a href="https://example.com/note">source</a>' })));
  const out = X.exportDocx(d, { date });
  const id = /<w:hyperlink r:id="([^"]+)"/.exec(out.parts['word/footnotes.xml'])[1];
  assert.ok(out.parts['word/_rels/footnotes.xml.rels']?.includes(`Id="${id}"`));
  assert.match(out.parts['word/_rels/footnotes.xml.rels'], /Target="https:\/\/example.com\/note" TargetMode="External"/);
});

test('export: pictures keep their intrinsic aspect ratio', () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const d = S.parse(S.paper, `<p><img src="${src}" width="320"></p>`);
  const part = X.exportDocx(d, { date }).parts['word/document.xml'];
  const [, w, h] = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(part);
  assert.equal(w, h, 'a square PNG must remain square in Word');
});

test('doctext reads each export back to the paper\'s text, after its running header', async () => {
  for (const [id, o, header] of [['mla9', mla(), 'Rivera 1\n\n'], ['chicago17', chicago(), '1\n\n']]) {
    const text = await D.docx(o.bytes), want = S.text(S.paper.nodeFromJSON(FX.papers[id]())).text.split('\n').filter((l) => l.trim()).join('\n');
    assert.equal(text, header + want, id);
  }
});

test('import gives the export back: text, blocks, marks, indents, notes, page breaks and lists', async () => {
  for (const id of ['mla9', 'apa7', 'chicago17']) {
    const doc = S.paper.nodeFromJSON(FX.papers[id]());
    const back = S.parse(S.paper, (await X.importDocx(X.exportDocx(doc, { format: id, surname: 'Rivera', date }).bytes, { format: id })).html);
    assert.equal(S.text(back).text, S.text(doc).text, `${id}: text`);
    const shape = (d) => { const o = []; d.descendants((n) => { if (n.isBlock) o.push([n.type.name, n.attrs.align || null, n.attrs.first ?? null, n.attrs.indent || 0, n.attrs.level || null].join(':')); if (n.type.name === 'footnote_ref') o.push(`note:${n.attrs.content}`); n.marks?.forEach((m) => o.push(m.type.name)); }); return o; };
    assert.deepEqual(shape(back), shape(doc), `${id}: structure`);
  }
  const lists = S.parse(S.paper, '<ul><li>a</li><li class="ql-indent-1">b</li></ul><ol><li>c</li></ol>');
  const again = S.parse(S.paper, (await X.importDocx(X.exportDocx(lists, { date }).bytes)).html);
  assert.equal(S.serialize(S.paper, again), S.serialize(S.paper, lists));
});

test('import reads Word\'s own shapes: styles, headings, hanging indents, tracked changes and breaks', async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0"?><w:document ${W}><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Part</w:t></w:r></w:p>
    <w:p><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Beloved</w:t></w:r><w:ins w:id="1"><w:r><w:t xml:space="preserve"> added</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>
    <w:p><w:r><w:t>before</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Comic Sans MS"/></w:rPr><w:t>font</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`;
  const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
  const bytes = zipOf([['[Content_Types].xml', '<Types/>'], ['_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ['word/document.xml', document], ['word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`], ['word/styles.xml', styles]]);
  const r = await X.importDocx(bytes, { format: 'mla9' });
  assert.equal(r.html, '<h2>Part</h2><p style="margin-left:0.5in;text-indent:-0.5in"><em>Beloved</em> added</p><p style="text-indent:0in">before</p><hr class="gz-page-break"><p style="text-indent:0in">after</p><p style="text-indent:0in">font</p>');
  assert.deepEqual(r.warnings.sort(), ['Fonts Word and Blackboard don\'t share were replaced.', 'Tracked changes were accepted.']);
  const d = S.parse(S.paper, r.html);
  assert.deepEqual([d.child(1).attrs.indent, d.child(1).attrs.first, d.child(2).attrs.first], [1, -0.5, 0], 'a 0 first-line indent stays an explicit 0');
});

test('import refuses hostile files before inflating them', async () => {
  await assert.rejects(X.importDocx(new Uint8Array(0)), /smaller than 15 MB/);
  await assert.rejects(X.importDocx(new Uint8Array(16e6)), /smaller than 15 MB/);
  await assert.rejects(X.importDocx(new TextEncoder().encode('not a zip')), /zip/);
  await assert.rejects(X.importDocx(zipOf([['../evil.xml', 'x'], ['word/document.xml', '<w:document/>']])), /invalid or duplicate paths/);
  await assert.rejects(X.importDocx(zipOf([['word/document.xml', '<w:document/>'], ['WORD/document.xml', '<w:document/>']])), /invalid or duplicate paths/);
  await assert.rejects(X.importDocx(zipOf([['word/document.xml', '<!DOCTYPE x [<!ENTITY a "aaaa">]><w:document><w:body/></w:document>']])), /declarations are not supported/);
  await assert.rejects(X.importDocx(zipOf(Array.from({ length: 2001 }, (_, i) => [`f${i}.xml`, 'x']))), /too many files/);
  await assert.rejects(X.importDocx(zipOf([['word/document.xml', `<w:document><w:body>${'<w:p/>'.repeat(100001)}</w:body></w:document>`]])), /too many elements/);
  await assert.rejects(X.importDocx(zipOf([['word/document.xml', '<w:document/>']])), /not a Word document/);
  assert.throws(() => X.xml('x'.repeat(5e6 + 1)), /too large/);
});

test('import refuses truncated XML and duplicate archive members', async () => {
  const good = '<w:document><w:body><w:p><w:r><w:t>safe</w:t></w:r></w:p></w:body></w:document>';
  await assert.rejects(X.importDocx(zipOf([['word/document.xml', '<w:document><w:body><w:p><w:r><w:t>truncated']])), /malformed XML/);
  await assert.rejects(X.importDocx(zipOf([['word/document.xml', good], ['word/document.xml', good]])), /duplicate/);
  assert.throws(() => X.xml('<a><b></a>'), /malformed XML/);
});

test('import refuses nested footnote references before expanding their graph', async () => {
  const main = '<w:document><w:body><w:p><w:r><w:footnoteReference w:id="1"/></w:r></w:p></w:body></w:document>';
  const notes = '<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:footnoteReference w:id="1"/><w:footnoteReference w:id="1"/></w:r></w:p></w:footnote></w:footnotes>';
  // Nesting the same footnote is invalid OOXML and used to expand exponentially. The operation budget
  // makes the old failure bounded in this test instead of exhausting the test runner.
  const original = X.LIMIT.depth; X.LIMIT.depth = 6;
  try { await assert.rejects(X.importDocx(zipOf([['word/document.xml', main], ['word/footnotes.xml', notes]])), /nested footnote/); }
  finally { X.LIMIT.depth = original; }
});
