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

test('a list through a numbering style (numStyleLink) and a level its instance overrides take their own formats', async () => {
  const numbering = `<w:numbering ${NSW}><w:abstractNum w:abstractNumId="10"><w:numStyleLink w:val="BulletStyle"/></w:abstractNum><w:abstractNum w:abstractNumId="11"><w:styleLink w:val="BulletStyle"/>${lvlX(0, 'bullet', '▪')}${lvlX(1, 'bullet', 'o')}</w:abstractNum>`
    + `<w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="11"/></w:num><w:abstractNum w:abstractNumId="20">${lvlX(0, 'decimal', '%1.')}</w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="20"/></w:num>`
    + `<w:num w:numId="5"><w:abstractNumId w:val="20"/><w:lvlOverride w:ilvl="0">${lvlX(0, 'upperRoman', '%1.')}</w:lvlOverride></w:num><w:num w:numId="6"><w:abstractNumId w:val="20"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num></w:numbering>`;
  const styles = X.exportDocx(S.parse(S.paper, '<p>x</p>')).parts['word/styles.xml'].replace('</w:styles>', '<w:style w:type="numbering" w:styleId="BulletStyle"><w:name w:val="Bullet Style"/><w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr></w:style></w:styles>');
  const body = item('Bullet A', 1) + item('Bullet B', 1) + p('gap') + item('One', 3) + p('gap2') + item('Roman I', 5) + p('gap3') + item('Four', 6);
  const got = await imp(pack(body, { 'word/numbering.xml': numbering, 'word/styles.xml': styles }));
  const want = ['bullet_list(square) Bullet A,Bullet B', 'ordered_list(default) One', 'ordered_list(upper-roman) Roman I', 'ordered_list(default) Four@4'];
  assert.deepEqual(lists(got.node), want);
  assert.deepEqual(lists((await imp(X.exportDocx(got.node).bytes)).node), want, 'and back through export');
});

test('a page break inside a list item is a page break; the list goes on numbering after it', async () => {
  const numbering = `<w:numbering ${NSW}><w:abstractNum w:abstractNumId="1">${lvlX(0, 'upperRoman', '%1.')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const li = (inner) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${inner}</w:p>`, br = '<w:r><w:br w:type="page"/></w:r>';
  const end = await imp(pack(li(r('One') + br) + li(r('Two')), { 'word/numbering.xml': numbering }));
  assert.equal(shape(end.node), '"One" BREAK "Two"');
  assert.deepEqual(lists(end.node), ['ordered_list(upper-roman) One', 'ordered_list(upper-roman,continued) Two']);
  const mid = await imp(pack(li(r('One') + br + r('and more')) + li(r('Two')), { 'word/numbering.xml': numbering }));
  assert.equal(shape(mid.node), '"One" BREAK "and more" "Two"');
  assert.deepEqual(lists(mid.node), ['ordered_list(upper-roman) One', 'ordered_list(upper-roman,continued) Two'], 'the text after the break is the item\'s, unnumbered');
  assert.equal(nodes(mid.node, 'hard_break').length, 0);
});

// ---- tables
const tblX = (rows, pr = '') => `<w:tbl><w:tblPr>${pr}</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>${rows}</w:tbl>`;
const tcX = (s, v = '') => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${v ? `<w:vAlign w:val="${v}"/>` : ''}</w:tcPr>${p(s)}</w:tc>`;
const grid = (doc) => nodes(doc, 'table').map((t) => t.content.content.map((row) => row.content.content.map((c) => `${c.type.name === 'table_header' ? 'th' : 'td'}:${c.textContent}${c.attrs.valign ? `/${c.attrs.valign}` : ''}`).join(' ')));
test('table rows and cells inside content controls and custom XML come in, with their alignment and header rows', async () => {
  const sdt = (x) => `<w:sdt><w:sdtPr/><w:sdtContent>${x}</w:sdtContent></w:sdt>`, cx = (x) => `<w:customXml w:element="x">${x}</w:customXml>`;
  const head = '<w:trPr><w:tblHeader/></w:trPr>';
  const got = await imp(pack(tblX(sdt(`<w:tr>${head}${tcX('H1')}${tcX('H2')}${tcX('H3')}</w:tr>`) + `<w:tr>${tcX('A1', 'center')}${sdt(tcX('B1', 'bottom'))}${cx(tcX('C1', 'center'))}</w:tr>` + cx(`<w:tr>${tcX('A2')}${tcX('B2')}${tcX('C2', 'bottom')}</w:tr>`)) + p('After')));
  assert.equal(got.node.textContent, 'H1H2H3A1B1C1A2B2C2After');
  assert.deepEqual(grid(got.node), [['th:H1 th:H2 th:H3', 'td:A1/middle td:B1/bottom td:C1/middle', 'td:A2 td:B2 td:C2/bottom']]);
  const nil = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="nil"/>`).join('');
  const two = await imp(pack(tblX(sdt(`<w:tr>${tcX('x', 'center')}</w:tr>`), `<w:tblBorders>${nil}</w:tblBorders>`) + p('Between') + tblX(`<w:tr>${tcX('y', 'bottom')}</w:tr>`, '<w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders>')));
  assert.deepEqual(nodes(two.node, 'table').map((t) => t.attrs.borders), [false, true]);
  assert.deepEqual(grid(two.node), [['td:x/middle'], ['td:y/bottom']]);
});

test('a table\'s style (named, else the default table style) sets its cells\' paragraphs, runs and borders', async () => {
  const styles = `<w:styles ${NSW}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
    + '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
    + `<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')}</w:tblBorders></w:tblPr></w:style>`
    + '<w:style w:type="table" w:styleId="Small"><w:name w:val="Small"/><w:basedOn w:val="TableGrid"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>';
  const tbl = (style, text) => `<w:tbl><w:tblPr>${style ? `<w:tblStyle w:val="${style}"/>` : ''}<w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4675"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr>${p(text)}</w:tc></w:tr></w:tbl>`;
  const got = await imp(pack(p('Body paragraph text, the most of it. '.repeat(10)) + p('Single, none after', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>') + tbl('TableGrid', 'Grid cell') + tbl('', 'Plain cell') + tbl('Small', 'Small cell'), { 'word/styles.xml': styles }));
  const spacing = (n) => [n.attrs.line, n.attrs.after];
  const [body, single] = got.node.content.content;
  const [grid, plain, small] = nodes(got.node, 'table');
  assert.deepEqual(spacing(nodes(grid, 'paragraph')[0]), spacing(single), 'Table Grid: single, none after');
  assert.deepEqual(spacing(nodes(plain, 'paragraph')[0]), spacing(body), 'Normal Table: the document\'s own spacing');
  assert.deepEqual(spacing(nodes(small, 'paragraph')[0]), spacing(single));
  assert.deepEqual([grid, plain, small].map((t) => t.attrs.borders), [true, false, true], 'Normal Table draws no borders');
  assert.deepEqual(nodes(small, 'text').map((t) => t.marks.find((m) => m.type.name === 'text_style')?.attrs.size), [9], 'the style\'s run size');
  assert.deepEqual(nodes(grid, 'text').map((t) => t.marks.length), [0]);
});

test('export pads table cells as the page does: 4 px (60 twips) left and right, none above or below', () => {
  const x = X.exportDocx(S.parse(S.paper, '<table><tr><td><p>Cell</p></td></tr></table>')).parts['word/document.xml'];
  const pr = /<w:tblPr>(.*?)<\/w:tblPr>/.exec(x)[1];
  assert.match(pr, /<w:tblCellMar><w:top w:w="0" w:type="dxa"\/><w:left w:w="60" w:type="dxa"\/><w:bottom w:w="0" w:type="dxa"\/><w:right w:w="60" w:type="dxa"\/><\/w:tblCellMar>/);
  const order = ['tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize', 'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar', 'tblLook'];
  const kids = X.xml(`<w:tblPr ${NSW}>${pr}</w:tblPr>`).kids[0].kids.filter((k) => k.name).map((k) => k.local);
  assert.deepEqual(kids, [...kids].sort((a, b) => order.indexOf(a) - order.indexOf(b)), kids.join(' '));
  const css = require('fs').readFileSync(require('path').join(__dirname, '../writer-paper.css'), 'utf8');
  assert.match(css, /\.gp-flow \.ProseMirror td, \.gp-flow \.ProseMirror th \{[^}]*padding: 0 4px;/, 'the page\'s padding this matches');
});

test('page breaks import to Word\'s page count: a page break before at a page\'s top adds none', async () => {
  // Word 16 on the Mac, 2026-10-28: 3, 2, 3 and 2 pages.
  const brk = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const probes = {
    'two breaks': [p('Page one text.') + brk + brk + p('After two page breaks.'), '"Page one text." BREAK BREAK "After two page breaks."'],
    'break then page break before': [p('Page one text.') + brk + p('A paragraph set to page break before.', '<w:pageBreakBefore/>'), '"Page one text." BREAK "A paragraph set to page break before."'],
    'two breaks in one paragraph': ['<w:p><w:r><w:t>Page one text.</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>After two breaks in one paragraph.</w:t></w:r></w:p>', '"Page one text." BREAK BREAK "After two breaks in one paragraph."'],
    'section break': [p('Cover page') + '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:pPr></w:p>' + p('Body starts on page 2'), '"Cover page" "" BREAK "Body starts on page 2"'],
  };
  for (const [name, [body, want]] of Object.entries(probes)) {
    const got = await imp(pack(body));
    assert.equal(shape(got.node), want, name);
    assert.equal(nodes((await imp(X.exportDocx(got.node).bytes)).node, 'page_break').length, nodes(got.node, 'page_break').length, `${name}: through export and back`);
  }
  const after = await imp(pack(`<w:p>${r('Ends with a break')}<w:r><w:br w:type="page"/></w:r></w:p>` + p('Next', '<w:pageBreakBefore/>')));
  assert.equal(shape(after.node), '"Ends with a break" BREAK "Next"');
});

// ---- pictures
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pics = (doc) => nodes(doc, 'image').map((n) => `${n.attrs.display}/${n.attrs.align}/${JSON.stringify(n.attrs.caption)}`);
test('a captioned block picture comes back a captioned block picture, its caption no paragraph of its own', async () => {
  const body = `<p>${'Body sentence. '.repeat(200)}</p>`;
  const doc = S.parse(S.paper, `${body}<p><img src="${PNG}" alt="Chart" width="200" data-display="block" data-align="right" data-caption="Figure 1. Sales &amp; costs &lt;2026&gt;"></p>${body}`);
  const back = await imp(X.exportDocx(doc).bytes);
  assert.deepEqual(pics(back.node), ['block/right/"Figure 1. Sales & costs <2026>"']);
  assert.equal(back.node.childCount, 3);
  assert.ok(!back.node.content.content.some((n) => n.attrs.keepNext), 'the keep with next export gives it is the caption\'s');
  const again = X.exportDocx(back.node).parts['word/document.xml'];
  assert.equal((again.match(/<w:keepNext\/>/g) || []).length, 1);
  assert.equal((again.match(/w:val="Caption"/g) || []).length, 1);
  const lone = await imp(pack(p('Figure 2. A caption with no picture', '<w:pStyle w:val="Caption"/>')));
  assert.equal(lone.node.textContent, 'Figure 2. A caption with no picture');
  assert.doesNotMatch(lone.html, /data-w-/);
});

test('the page draws a caption as Word\'s Caption style does: no space above, two points smaller, 8 pt at least', () => {
  const css = require('fs').readFileSync(require('path').join(__dirname, '../writer-objects.css'), 'utf8');
  const rule = /\.gzo-img\[data-caption\]::after \{([^}]*)\}/.exec(css)[1];
  assert.match(rule, /padding-top: 0;/);
  assert.match(rule, /font-size: max\(8pt, calc\(1em - 2pt\)\);/);
  const styles = X.exportDocx(S.parse(S.paper, `<p><img src="${PNG}" data-display="block" data-caption="C"></p>`), { format: 'mla9' }).parts['word/styles.xml'];
  assert.match(/w:styleId="Caption".*?<\/w:style>/.exec(styles)[0], /w:before="0" w:after="0" w:line="240" w:lineRule="auto".*<w:sz w:val="20"\/>/);
});

// ---- headers and footers
const withHeader = async (inner) => {
  const parts = { ...X.exportDocx(S.parse(S.paper, '<p>Body</p>'), { format: 'mla9', surname: 'Rivera' }).parts };
  parts['word/header1.xml'] = parts['word/header1.xml'].replace(/(<w:hdr[^>]*>)[\s\S]*(<\/w:hdr>)/, `$1${inner}$2`);
  return imp(zipParts(parts), { format: 'mla9' });
};
const runsOf = (paras) => (paras || []).map((x) => x.runs.map((k) => (k.field ? `{${k.field}}` : k.text)).join(''));
test('a header\'s table keeps its text, cells in order and tab-separated, with a warning; wrapped paragraphs come in', async () => {
  const page = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>2</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const got = await withHeader(`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${p('RUNNING HEAD')}</w:tc><w:tc><w:tcPr/><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${page}</w:p></w:tc></w:tr></w:tbl><w:p/>`);
  assert.deepEqual(runsOf(got.setup.headers.default), ['RUNNING HEAD\t{PAGE}', '']);
  assert.ok(got.warnings.includes('Some pictures, objects or equations were left out.'), got.warnings.join());
  const again = await imp(X.exportDocx(got.node, { format: 'mla9' }).bytes, { format: 'mla9' });
  assert.deepEqual(runsOf(again.setup.headers.default), ['RUNNING HEAD\t{PAGE}', ''], 'and export writes it');
  const wrapped = await withHeader(`<w:customXml w:element="h">${p('In custom XML')}</w:customXml><w:ins w:id="9" w:author="a">${p('Inserted')}</w:ins><w:moveTo w:id="8" w:author="a">${p('Moved here')}</w:moveTo><w:del w:id="7" w:author="a">${p('Deleted')}</w:del><w:moveFrom w:id="6" w:author="a">${p('Moved away')}</w:moveFrom>`);
  assert.deepEqual(runsOf(wrapped.setup.headers.default), ['In custom XML', 'Inserted', 'Moved here']);
});

// ---- symbols
test('a w:sym character comes in as its Unicode equivalent (Symbol\'s and Wingdings\' private-use codes mapped)', async () => {
  const sym = (font, ch) => `<w:r><w:sym w:font="${font}" w:char="${ch}"/></w:r>`;
  const got = await imp(pack(`<w:p>${r('Angle ')}${sym('Symbol', 'F061')}${r(', ')}${sym('Symbol', 'F0B1')}${sym('Symbol', '44')}${sym('Symbol', 'F0E5')}${sym('Symbol', 'F0D6')}${r(' check ')}${sym('Wingdings', 'F0FC')}${sym('Wingdings', 'F0A7')}${r(' bullet ')}${sym('Arial', '2022')}</w:p>`));
  assert.equal(got.node.textContent, 'Angle α, ±Δ∑√ check ✓▪ bullet •');
  assert.deepEqual(got.warnings, []);
  const odd = await imp(pack(`<w:p>${r('A')}${sym('Wingdings', 'F041')}${sym('Webdings', 'F06A')}${r('B')}</w:p>`));
  assert.equal(odd.node.textContent, 'AB');
  assert.deepEqual(odd.warnings, ['Some pictures, objects or equations were left out.']);
});

// ---- alternate content
test('mc:AlternateContent comes in once: its Choice when the importer reads what it requires, else its Fallback', async () => {
  const mc = (req, choice, fallback) => `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="${req}">${choice}</mc:Choice><mc:Fallback>${fallback}</mc:Fallback></mc:AlternateContent>`;
  assert.equal((await imp(pack(`<w:p>${r('A')}${mc('w14', r('choice'), r('fallback'))}${r('B')}</w:p>`))).node.textContent, 'AchoiceB');
  assert.equal((await imp(pack(`<w:p>${r('A')}${mc('cx1', r('choice'), r('fallback'))}${r('B')}</w:p>`))).node.textContent, 'AfallbackB');
  assert.equal((await imp(pack(mc('w14', p('Block choice'), p('Block fallback'))))).node.textContent, 'Block choice');
  const base = X.exportDocx(S.parse(S.paper, `<p>x<img src="${PNG}" alt="Dot"></p>`));
  const all = await entries(base.bytes), doc = all.find((e) => e.name === 'word/document.xml'), x = new TextDecoder().decode(doc.data), draw = /<w:drawing>[\s\S]*?<\/w:drawing>/.exec(x)[0];
  const vml = '<w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" style="width:10pt;height:10pt"><v:imagedata r:id="rId1"/></v:shape></w:pict>';
  for (const [name, d] of [['drawing, VML fallback', mc('wps', draw, vml)], ['drawing, drawing fallback', mc('wps', draw, draw)], ['unknown choice, drawing fallback', mc('zz', vml, draw)]]) {
    const got = await imp(Buffer.concat(Z.zip(all.map((e) => (e === doc ? { name: e.name, data: new TextEncoder().encode(x.replace(draw, d)) } : e)))));
    assert.equal(nodes(got.node, 'image').length, 1, name);
    assert.deepEqual(got.warnings, [], name);
  }
});
