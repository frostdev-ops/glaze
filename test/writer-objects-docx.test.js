// lib/writer-objects-docx.js: what Glaze Writer's objects add to a .docx, as two passes lib/writer-docx.js can make: on
// export, over the parts it wrote (numbering per list level, restarts and continued lists, table borders, header rows,
// rows kept whole, cell alignment, pictures set as blocks with captions, horizontal lines); on import, over the HTML it
// read (the same, back). Each pass is checked on its own and through a full export → import round trip.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const OD = require('../lib/writer-objects-docx.js');

const P = S.paper;
const date = new Date('2026-10-27T12:00:00Z');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const doc = (html) => S.parse(P, html);
// The export call site: after writer-docx builds its parts, before it zips them.
const exported = (d) => { const o = X.exportDocx(d, { format: 'mla9', date }); OD.exportParts(d, o.parts, { format: 'mla9' }); return o.parts; };
// The import call site: writer-docx's HTML and the parts it parsed.
const imported = async (parts) => {
  const Z = require('../lib/zip.js'), enc = new TextEncoder();
  const chunks = Z.zip(Object.entries(parts).map(([name, text]) => ({ name, data: enc.encode(text), date })));
  const r = await X.importDocx(Buffer.concat(chunks.map((c) => Buffer.from(c))), { format: 'mla9' });
  const ctx = { body: X.xml(parts['word/document.xml']), numbering: parts['word/numbering.xml'] ? X.xml(parts['word/numbering.xml']) : null, styles: X.xml(parts['word/styles.xml']) };
  return S.parse(P, OD.importHTML(r.html, ctx));
};
const nums = (xml) => [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => +m[1]);
const lvl = (numbering, abs, ilvl) => new RegExp(`<w:abstractNum w:abstractNumId="${abs}">.*?<w:lvl w:ilvl="${ilvl}">(.*?)</w:lvl>`).exec(numbering)?.[1] || '';

test('export: a plain paper is left exactly as writer-docx wrote it', () => {
  const d = doc('<p>One</p><ol><li>a</li><li class="ql-indent-1">b</li></ol><ul><li>c</li></ul><table><tr><td><p>x</p></td></tr></table>');
  const before = X.exportDocx(d, { format: 'mla9', date }).parts, after = exported(d);
  for (const k of Object.keys(before)) if (k !== 'word/document.xml') assert.equal(after[k], before[k], k);
  assert.equal(after['word/document.xml'], before['word/document.xml'].replace(/<w:tr>/g, '<w:tr><w:trPr><w:cantSplit/></w:trPr>'), 'only rows are kept whole, as the pages draw them');
});

test('export: each list level\'s numbering style and bullet becomes its Word level', () => {
  const p = exported(doc('<ol data-styles="upper-roman,upper-alpha,decimal"><li>a</li></ol><ul data-styles="square,dash"><li>b</li></ul>'))['word/numbering.xml'];
  assert.match(lvl(p, 1, 0), /<w:numFmt w:val="upperRoman"\/><w:lvlText w:val="%1."\/>/);
  assert.match(lvl(p, 1, 1), /<w:numFmt w:val="upperLetter"\/><w:lvlText w:val="%2."\/>/);
  assert.match(lvl(p, 1, 2), /<w:numFmt w:val="decimal"\/>/);
  assert.match(lvl(p, 1, 3), /<w:numFmt w:val="decimal"\/>/, 'levels past the list\'s own take the defaults');
  assert.match(lvl(p, 2, 0), /<w:numFmt w:val="bullet"\/><w:lvlText w:val="▪"\/>/);
  assert.match(lvl(p, 2, 1), /<w:lvlText w:val="–"\/>/);
});

test('export: a continued list shares the list before it; a restart is a new instance with its start', () => {
  const parts = exported(doc('<ol><li>a</li><li>b</li></ol><p>x</p><ol data-continue="true"><li>c</li><li data-start="1">d</li><li>e</li></ol>'));
  assert.deepEqual(nums(parts['word/document.xml']), [1, 1, 1, 3, 3]);
  assert.match(parts['word/numbering.xml'], /<w:num w:numId="3"><w:abstractNumId w:val="1"\/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"\/><\/w:lvlOverride><\/w:num>/);
});

test('export: borders off, a header row repeated on each page, and cell alignment', () => {
  const x = exported(doc('<table data-borders="none"><tr><th><p>H</p></th><th><p>I</p></th></tr><tr><td data-valign="middle"><p>a</p></td><td data-valign="bottom"><p>b</p></td></tr></table>'))['word/document.xml'];
  assert.match(x, /<w:tblBorders>(<w:(top|left|bottom|right|insideH|insideV) w:val="nil"\/>){6}<\/w:tblBorders>/);
  assert.match(x, /<w:tr><w:trPr><w:cantSplit\/><w:tblHeader\/><\/w:trPr>/);
  assert.match(x, /<w:tcW w:w="\d+" w:type="dxa"\/><w:vAlign w:val="center"\/><\/w:tcPr>/);
  assert.match(x, /<w:vAlign w:val="bottom"\/><\/w:tcPr>/);
});

test('export: a merged cell\'s continuation keeps no alignment of its own; nested tables map in document order', () => {
  const x = exported(doc('<table><tr><td rowspan="2" data-valign="bottom"><p>a</p></td><td><table data-borders="none"><tr><td data-valign="middle"><p>in</p></td></tr></table></td></tr><tr><td><p>c</p></td></tr></table>'))['word/document.xml'];
  assert.deepEqual([...x.matchAll(/<w:vAlign w:val="(\w+)"\/>/g)].map((m) => m[1]), ['bottom', 'center']);
  assert.equal((x.match(/w:val="nil"/g) || []).length, 6, 'only the nested table loses its borders');
});

test('export: a block picture sets its paragraph\'s alignment; a caption follows as a Caption paragraph kept with it', () => {
  const parts = exported(doc(`<p>Before</p><p><img src="${PNG}" width="200" data-display="block" data-align="right" data-caption="Fig. 1. A &amp; B."></p><p>After</p>`));
  const x = parts['word/document.xml'];
  assert.match(x, /<w:p><w:pPr><w:keepNext\/><w:ind w:firstLine="0"\/><w:jc w:val="right"\/><\/w:pPr><w:r><w:drawing>/);
  assert.match(x, /<\/w:drawing><\/w:r><\/w:p><w:p><w:pPr><w:pStyle w:val="Caption"\/><w:jc w:val="right"\/><\/w:pPr><w:r><w:t xml:space="preserve">Fig. 1. A &amp; B.<\/w:t><\/w:r><\/w:p>/);
  assert.match(parts['word/styles.xml'], /<w:style w:type="paragraph" w:styleId="Caption">.*<w:sz w:val="20"\/>.*<\/w:style><\/w:styles>$/);
  const inline = exported(doc(`<p>Text <img src="${PNG}" width="20"> more</p>`))['word/document.xml'];
  assert.doesNotMatch(inline, /Caption|w:jc/);
});

test('export: a horizontal line is an empty paragraph with a bottom border, where it stands', () => {
  const x = exported(doc('<p>One</p><hr><blockquote><p>Q</p></blockquote><hr><p>Two</p>'))['word/document.xml'];
  const body = x.slice(x.indexOf('<w:body>') + 8, x.indexOf('<w:sectPr'));
  const paras = body.match(/<w:p>.*?<\/w:p>/g);
  assert.equal(paras.length, 5);
  assert.match(paras[1], /<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"\/><\/w:pBdr>/);
  assert.match(paras[2], /Q/);
  assert.match(paras[3], /<w:pBdr>/);
  assert.match(paras[4], /Two/);
});

test('round trip: lists, tables and pictures come back from the .docx with their attributes', async () => {
  const src = doc(`<ol data-styles="upper-roman,lower-alpha"><li>a</li><li class="ql-indent-1">b</li></ol><p>x</p><ol data-continue="true"><li>c</li><li data-start="1">d</li></ol>`
    + `<ul data-styles="dash"><li>e</li></ul>`
    + `<table data-borders="none"><tr><th><p>H</p></th></tr><tr><td data-valign="middle"><p>v</p></td></tr></table>`
    + `<p><img src="${PNG}" width="200" data-display="block" data-align="center"></p>`);
  const back = await imported(exported(src));
  const lists = back.content.content.filter((n) => /_list$/.test(n.type.name));
  assert.deepEqual(lists.map((n) => [n.type.name, n.attrs.styles, n.attrs.continue]), [
    ['ordered_list', 'upper-roman,lower-alpha', false], ['ordered_list', 'upper-roman,lower-alpha', true], ['bullet_list', 'dash', undefined]]);
  assert.deepEqual(lists[1].content.content.map((li) => li.attrs.start), [null, 1]);
  let t = null, img = null;
  back.descendants((n) => { if (n.type.name === 'table') t = n; if (n.type.name === 'image') img = n; });
  assert.equal(t.attrs.borders, false);
  assert.equal(t.firstChild.firstChild.type.name, 'table_header');
  assert.equal(t.child(1).firstChild.attrs.valign, 'middle');
  assert.deepEqual([img.attrs.display, img.attrs.align], ['block', 'center']);
});

test('import: a Word file\'s own numbering formats map to list styles; unknown ones fall back', async () => {
  const numbering = `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="chineseCounting"/></w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="7"/></w:num></w:numbering>`;
  const body = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:t>a</w:t></w:r></w:p><w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="4"/></w:numPr></w:pPr><w:r><w:t>b</w:t></w:r></w:p></w:body></w:document>`;
  const html = OD.importHTML('<ol><li>a</li><li class="ql-indent-1">b</li></ol>', { body: X.xml(body), numbering: X.xml(numbering), styles: null });
  assert.equal(html, '<ol data-styles="upper-alpha,lower-alpha"><li>a</li><li class="ql-indent-1">b</li></ol>');
  assert.equal(OD.importHTML('<p>plain</p>', { body: X.xml(body.replace(/<w:p>.*<\/w:p>/, '<w:p><w:r><w:t>plain</w:t></w:r></w:p>')), numbering: null, styles: null }), '<p>plain</p>');
});
