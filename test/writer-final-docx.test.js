// lib/writer-docx.js and lib/writer-objects-docx.js against what Word really writes: each part's own relationships,
// wrapped table rows and cells, table styles, captions, section and page breaks, header tables, list markers, symbols,
// alternate content, endnotes, link fields, case-insensitive part names, and the order Word's schema gives pPr and rPr.
// Synthetic OOXML only.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.GZ_WRITER_OBJECTS_DOCX = require('../lib/writer-objects-docx.js');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const Z = require('../lib/zip.js');
const { pack, p, r } = require('./fixtures/writer-hostile.js');

const NSW = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const imp = async (bytes, o) => { const got = await X.importDocx(bytes, o); return { ...got, node: S.paper.nodeFromJSON(got.doc) }; };
const nodes = (doc, name) => { const out = []; doc.descendants((n) => { if (n.type.name === name) out.push(n); }); return out; };
const links = (doc) => { const out = []; doc.descendants((n) => { const l = n.isText && n.marks.find((m) => m.type.name === 'link'); if (l) out.push([n.text, l.attrs.href]); }); return out; };
const zipParts = (parts) => Buffer.concat(Z.zip(Object.entries(parts).map(([name, data]) => ({ name, data: typeof data === 'string' ? new TextEncoder().encode(data) : data }))));
const rels = (list) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

// ---- relationships
test('a footnote\'s link resolves against the footnotes part\'s own relationships', async () => {
  const note = 'See <a href="https://journal.example/right-source">the source</a>.';
  const doc = S.parse(S.paper, `<p>Body cites <a href="https://body.example/other">another page</a> here<sup class="gz-footnote" data-footnote="${note.replace(/"/g, '&quot;')}"></sup>.</p>`);
  const back = await imp(X.exportDocx(doc).bytes);
  const content = nodes(back.node, 'footnote_ref')[0].attrs.content;
  assert.match(content, /href="https:\/\/journal\.example\/right-source"/);
  assert.doesNotMatch(content, /body\.example/);
  assert.deepEqual(links(back.node), [['another page', 'https://body.example/other']]);
});

test('relationships are read once per part: many links import in time linear in their number', async () => {
  const file = (n) => pack(`<w:p>${Array.from({ length: n }, (_, i) => `<w:hyperlink r:id="L${i}">${r('x')}</w:hyperlink>`).join('')}</w:p>`,
    { 'word/_rels/document.xml.rels': rels([['rS', 'styles', 'styles.xml'], ...Array.from({ length: n }, (_, i) => [`L${i}`, 'hyperlink', `https://e.test/${i}`, true])]) });
  const time = async (n) => { const bytes = file(n); let best = Infinity; for (let k = 0; k < 3; k++) { const t0 = process.hrtime.bigint(); await X.importDocx(bytes); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); } return best; };
  const small = await time(500), large = await time(4000);
  const got = await imp(file(4000));
  assert.equal(links(got.node).length, 4000);
  assert.ok(large / small < 14, `8 times the links took ${(large / small).toFixed(1)} times as long (${small.toFixed(0)} ms, ${large.toFixed(0)} ms)`);
});

// ---- the package
const entries = async (bytes) => { const z = require('../lib/doctext.js').unzip(bytes); return Promise.all(z.names.map(async (name) => ({ name, data: await z.bytes(name) }))); };
test('part names match relationship targets without regard to case, as the package format has it', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const out = X.exportDocx(S.parse(S.paper, `<p>Hello case<img src="data:image/png;base64,${png}" alt="Dot"></p>`));
  const renamed = (await entries(out.bytes)).map((e) => ({ ...e, name: e.name === 'word/document.xml' ? 'word/Document.xml' : e.name === 'word/media/image1.png' ? 'word/media/IMAGE1.png' : e.name }));
  const got = await imp(Buffer.concat(Z.zip(renamed)));
  assert.equal(got.node.textContent, 'Hello case');
  assert.equal(nodes(got.node, 'image').length, 1);
  assert.deepEqual(got.warnings, []);
});

// ---- links
const marksOf = (doc) => { const out = []; doc.descendants((n) => { if (n.isText) out.push([n.text, n.marks.map((m) => m.type.name).sort().join(',')]); }); return out; };
test('a link\'s Hyperlink character style is the link\'s look, not underline and colour marks of its own', async () => {
  const back = await imp(X.exportDocx(S.parse(S.paper, '<p>Read <a href="https://example.org/a">this page</a> now.</p>')).bytes);
  assert.deepEqual(marksOf(back.node), [['Read ', ''], ['this page', 'link'], [' now.', '']]);
  const styled = `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>blue</w:t></w:r>`;
  const plain = await imp(pack(`<w:p>${r('Not a link: ')}${styled}</w:p>`));
  assert.deepEqual(marksOf(plain.node), [['Not a link: ', ''], ['blue', 'color,underline']], 'without a link the style still draws its text');
});

test('tel: links come back from the .docx as the schema accepts them', async () => {
  for (const href of ['tel:+15551234567', 'mailto:a@b.co', 'https://example.com/x']) {
    const back = await imp(X.exportDocx(S.parse(S.paper, `<p><a href="${href}">call</a></p>`)).bytes);
    assert.deepEqual(links(back.node), [['call', href]], href);
  }
  const bad = await imp(pack(`<w:p><w:hyperlink r:id="J">${r('js')}</w:hyperlink></w:p>`, { 'word/_rels/document.xml.rels': rels([['J', 'hyperlink', 'javascript:alert(1)', true]]) }));
  assert.deepEqual(links(bad.node), []);
});

test('a HYPERLINK field\'s result is a link; one to a bookmark is text', async () => {
  const field = (code, result) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const styled = (s) => `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${s}</w:t></w:r>`;
  const got = await imp(pack(`<w:p>${r('See ')}${field('HYPERLINK "https://example.org/x" \\o "tip"', styled('linked ') + styled('text'))}${r(' and ')}${field('HYPERLINK \\l "_Toc1"', r('a heading'))}${r('.')}</w:p>`));
  assert.equal(got.node.textContent, 'See linked text and a heading.');
  assert.deepEqual(links(got.node), [['linked text', 'https://example.org/x']]);
  assert.deepEqual(marksOf(got.node).map(([, m]) => m), ['', 'link', '']);
});

// ---- export validity
test('no exported part holds a character XML forbids, a picture\'s caption included', () => {
  const BAD = 'a\u0001b\u000bc\u001fd￾e￿g';
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const doc = S.paper.nodeFromJSON({ type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: `Body ${BAD}` }] },
    { type: 'paragraph', content: [{ type: 'image', attrs: { src: png, alt: `Alt ${BAD}`, display: 'block', caption: `Cap ${BAD}` } }] },
  ] });
  const out = X.exportDocx(doc, { title: `Title ${BAD}` });
  for (const [name, text] of Object.entries(out.parts)) assert.doesNotMatch(text, /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/, name);
  assert.match(out.parts['word/document.xml'], /Cap abcdeg</);
});

// ECMA-376 Part 1's sequences: CT_PPr (CT_PPrBase, then rPr, sectPr, pPrChange) and CT_RPr (EG_RPrBase).
const PPR = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const RPR = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText', 'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];
const outOfOrder = (tree, seen) => {
  const bad = [];
  (function walk(n, parent) {
    for (const k of (n.kids || []).filter((x) => x.name)) {
      const seq = k.local === 'pPr' ? PPR : k.local === 'rPr' && parent !== 'rPr' ? RPR : null;
      if (seq) {
        const names = k.kids.filter((x) => x.name).map((x) => x.local);
        names.forEach((x) => seen.add(`${k.local}/${x}`));
        names.forEach((x, i) => { if (!seq.includes(x) || (i && seq.indexOf(x) <= seq.indexOf(names[i - 1]))) bad.push(`${k.local}: ${names.join(' ')}`); });
      }
      walk(k, k.local);
    }
  })(tree, '');
  return [...new Set(bad)];
};
test('export writes every pPr and rPr child in the order Word\'s schema gives them', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const note = '<strong><em>Bold note</em></strong> <a href="https://e.test/n">link</a>';
  const html = `<h2>Heading</h2><p dir="rtl" style="text-align:right;line-height:2;text-indent:0.5in" data-gz="before:6;after:3;right:0.5;tabs:1l 3c:dot;keep:next lines;widow:0">`
    + `<span dir="rtl"><span data-gz-caps="small"><span data-gz-color="FF0000"><span data-gz-highlight="yellow"><span style="font-family:Arial;font-size:14pt"><strong><em><s><u><sup>all</sup></u></s></em></strong></span></span></span></span></span>`
    + `<span data-gz-caps="all">caps</span><sub>sub</sub> <a href="https://e.test/">link</a><sup class="gz-footnote" data-footnote="${note.replace(/"/g, '&quot;')}"></sup></p>`
    + `<hr class="gz-page-break"><p dir="ltr" style="margin-left:1in">After a break</p><blockquote><p>Quoted</p></blockquote><ol><li>One</li><li class="ql-indent-1">Two</li></ol><hr class="gz-rule">`
    + `<p><img src="${png}" alt="Dot" data-display="block" data-align="right" data-caption="Figure 1"></p><table><tr><td><p>Cell</p></td></tr></table><pre>code</pre>`;
  const header = [{ align: 'right', line: 1, after: 0, before: 2, left: 0.5, right: 0.25, first: -0.25, tabs: [[3, 'c'], [6.5, 'r']], runs: [{ text: 'Run ', b: true, i: true, u: true, s: true, sup: true, font: 'Arial', size: 10, color: 'FF0000' }, { field: 'PAGE', b: true }] }];
  const doc = S.parse(S.paper, html);
  const setup = { page: [8.5, 11], margins: [1, 1, 1, 1], headers: { default: header, first: header }, footers: { default: header, first: null }, title: true };
  const out = X.exportDocx(S.paper.nodeFromJSON({ ...doc.toJSON(), attrs: { setup } }), { format: 'mla9' });
  const seen = new Set(), checked = Object.keys(out.parts).filter((n) => /^word\/(document|footnotes|header\d+|footer\d+)\.xml$/.test(n));
  assert.ok(checked.includes('word/footnotes.xml') && checked.some((n) => n.includes('header')) && checked.some((n) => n.includes('footer')), checked.join());
  for (const name of checked) assert.deepEqual(outOfOrder(X.xml(out.parts[name]), seen), [], name);
  for (const k of ['pPr/pStyle', 'pPr/keepNext', 'pPr/keepLines', 'pPr/pageBreakBefore', 'pPr/widowControl', 'pPr/numPr', 'pPr/pBdr', 'pPr/tabs', 'pPr/bidi', 'pPr/spacing', 'pPr/ind', 'pPr/jc',
    'rPr/rStyle', 'rPr/rFonts', 'rPr/b', 'rPr/bCs', 'rPr/i', 'rPr/iCs', 'rPr/caps', 'rPr/smallCaps', 'rPr/strike', 'rPr/color', 'rPr/sz', 'rPr/szCs', 'rPr/highlight', 'rPr/u', 'rPr/vertAlign', 'rPr/rtl']) assert.ok(seen.has(k), `the check saw ${k}`);
});

// ---- page and section breaks
const shape = (d) => d.content.content.map((n) => (n.type.name === 'page_break' ? 'BREAK' : n.type.name === 'table' ? `table(${n.textContent})` : JSON.stringify(n.textContent))).join(' ');
const breaksIn = (x) => (x.match(/<w:pageBreakBefore\/>|<w:br w:type="page"\/>/g) || []).length;
test('export writes each page break, two in a row and one before a table among them, where Word keeps it', async () => {
  const doc = S.parse(S.paper, '<p>Title page</p><hr class="gz-page-break"><hr class="gz-page-break"><p>Body</p><hr class="gz-page-break"><table><tr><td><p>Cell</p></td></tr></table><p>End</p><hr class="gz-page-break"><hr class="gz-page-break">');
  const x = X.exportDocx(doc).parts['word/document.xml'];
  assert.equal(breaksIn(x), 5);
  assert.doesNotMatch(x, /<w:tc>(?:(?!<\/w:tc>).)*pageBreakBefore/, 'no break inside a cell, where Word ignores it');
  assert.equal(shape((await imp(X.exportDocx(doc).bytes)).node), '"Title page" BREAK BREAK "Body" BREAK table(Cell) "End" BREAK BREAK ""');
  const one = S.parse(S.paper, '<p>Title page</p><hr class="gz-page-break"><p>Body</p>');
  assert.match(X.exportDocx(one).parts['word/document.xml'], /<w:p><w:pPr><w:pageBreakBefore\/>[^]*?Body/, 'one break is still the next paragraph\'s page break before');
});

test('a section that starts on a new page (Word\'s default) starts one; a continuous one does not', async () => {
  const sect = (type = '') => `<w:sectPr>${type ? `<w:type w:val="${type}"/>` : ''}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr>`;
  const sp = (s, type) => `<w:p><w:pPr>${sect(type)}</w:pPr>${r(s)}</w:p>`;
  assert.equal(shape((await imp(pack(sp('Cover page') + p('Body starts on page 2')))).node), '"Cover page" BREAK "Body starts on page 2"');
  // A section's w:type says how that section starts: the break after a section's last paragraph is the next section's.
  assert.equal(shape((await imp(pack(sp('A') + sp('B', 'continuous') + sp('C', 'nextColumn') + sp('D', 'oddPage') + p('E')))).node), '"A" "B" "C" BREAK "D" BREAK "E"');
  assert.equal(shape((await imp(pack(sp('Cover') + p('Next', '<w:pageBreakBefore/>')))).node), '"Cover" BREAK "Next"', 'a page break before at the new section\'s top is the same page');
});

// ---- lists
const lists = (doc) => { const out = []; doc.descendants((n) => { if (/_list$/.test(n.type.name)) { out.push(`${n.type.name}(${n.attrs.styles || 'default'}${n.attrs.continue ? ',continued' : ''}) ${n.content.content.map((x) => x.textContent + (x.attrs.start ? `@${x.attrs.start}` : '')).join(',')}`); return false; } return true; }); return out; };
const lvlX = (i, fmt, text, start = 1) => `<w:lvl w:ilvl="${i}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/></w:lvl>`;
const item = (s, n, pr = '') => p(s, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${n}"/></w:numPr>${pr}`);
test('a body-level marker, a deleted paragraph or a section break between list items keeps every list\'s numbering', async () => {
  const numbering = `<w:numbering ${NSW}><w:abstractNum w:abstractNumId="1">${lvlX(0, 'upperRoman', '%1.')}</w:abstractNum><w:abstractNum w:abstractNumId="2">${lvlX(0, 'decimal', '%1.', 5)}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>`;
  const want = ['ordered_list(upper-roman) Roman one,Roman two', 'ordered_list(default) Five@5'];
  for (const marker of ['', `<w:del w:id="9" w:author="R">${p('Deleted paragraph')}</w:del>`, '<w:moveFrom w:id="4" w:author="R"><w:p/></w:moveFrom>', '<w:commentRangeStart w:id="0"/>', '<w:permStart w:id="1" w:edGrp="everyone"/>', '<w:moveFromRangeStart w:id="3" w:name="m"/>', '<w:moveToRangeEnd w:id="3"/>', '<w:customXmlInsRangeStart w:id="5"/>']) {
    const got = await imp(pack(item('Roman one', 1) + marker + item('Roman two', 1) + p('Gap') + item('Five', 2), { 'word/numbering.xml': numbering }));
    assert.deepEqual(lists(got.node), want, marker || 'no marker');
  }
  const wrapped = await imp(pack(item('Roman one', 1) + `<w:customXml w:element="x">${item('Roman two', 1)}</w:customXml>` + p('Gap') + item('Five', 2), { 'word/numbering.xml': numbering }));
  assert.deepEqual(lists(wrapped.node), want, 'an item in a custom XML wrapper stays in its list');
  const sectioned = await imp(pack(item('Roman one', 1, '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>') + item('Roman two', 1) + p('Gap') + item('Five', 2), { 'word/numbering.xml': numbering }));
  assert.deepEqual(lists(sectioned.node), ['ordered_list(upper-roman) Roman one', 'ordered_list(upper-roman,continued) Roman two', 'ordered_list(default) Five@5'], 'a list split by a section break continues');
});
