// Glaze Writer opening Word files as Word lays them out (lib/writer-docx.js importDocx): properties resolved from the
// document's defaults through its paragraph and character styles to direct formatting; paragraph spacing, line rules,
// contextual spacing, indents, tab stops, keep options and widow control; the page's size, margins, header and footer with
// their fields; the base font through the theme; run formatting; and the .docx Writer exports for an imported paper
// giving the same document back. The files are Word-shaped fixtures (test/fixtures/writer-docx-import.js); Word's own
// layout of them is scripts/writer-import-fidelity.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const ST = require('../lib/writer-styles.js');
const P = require('../lib/writer-paginate.js');
const F = require('../lib/writer-format.js');
const FX = require('./fixtures/writer-docx-import.js');

const open = async (id, format = 'mla9') => {
  const r = await X.importDocx(FX.bytes(id), { format });
  const doc = S.paper.nodeFromJSON({ ...S.parse(S.paper, r.html).toJSON(), attrs: { setup: r.setup } });
  return { r, doc, tops: doc.content.content };
};
const pick = (n, ...keys) => Object.fromEntries(keys.map((k) => [k, n.attrs[k]]));
const marks = (n) => { const out = new Set(); n.descendants((c) => { for (const m of c.marks) out.add(m.type.name === 'text_style' || m.type.name === 'color' || m.type.name === 'highlight' ? `${m.type.name}:${JSON.stringify(m.attrs)}` : m.type.name); }); return [...out].sort(); };

test('an MLA paper from Word: the defaults\' 1.16 lines and 8 pt after on the heading block, double spacing kept with its 8 pt after', async () => {
  const { r, tops } = await open('mla-word');
  assert.deepEqual(r.warnings, []);
  const heading = tops.slice(0, 5);
  for (const n of heading) assert.deepEqual(pick(n, 'line', 'after', 'before', 'first', 'align'), { line: 1.16, after: 8, before: null, first: 0, align: null }, `heading line "${n.textContent}"`);
  assert.deepEqual(pick(tops[5], 'line', 'after', 'first', 'align'), { line: 1.16, after: 8, first: null, align: 'center' }, 'the title: centred, no indent of its own');
  const body = tops.slice(6, 11);
  assert.deepEqual(body.map((n) => [n.attrs.line, n.attrs.after, n.attrs.first, n.textContent.startsWith('\t')]), [[null, 8, 0, true], [null, 8, 0, true], [null, 8, null, false], [null, 8, 0, true], [null, 8, 0, true]],
    'double is MLA\'s own (left to it); 8 pt after kept; a tab opens four paragraphs, a first-line indent of MLA\'s half inch the fifth');
  assert.equal(tops[11].firstChild?.type.name, 'hard_break', 'the empty line holding a line break keeps it: two lines tall, as in Word');
  assert.deepEqual(tops.slice(12, 17).map((n) => [n.content.size, n.attrs.after]), Array(5).fill([0, 8]), 'five more empty double-spaced lines with 8 pt after');
  assert.deepEqual(pick(tops[17], 'align', 'after', 'line'), { align: 'center', after: 8, line: null }, 'Works Cited');
  for (const n of tops.slice(18, 22)) {
    assert.deepEqual(pick(n, 'after', 'line', 'first', 'indent', 'left'), { after: null, line: null, first: null, indent: 0, left: null }, 'entries: MLA\'s own hanging indent and spacing');
    assert.deepEqual(marks(n), ['color:{"color":"467886"}', 'italic', 'link', 'underline'], 'the title in italics, the link in the Hyperlink style\'s colour and underline');
  }
  assert.ok(!tops.some((n) => marks(n).some((m) => m.startsWith('text_style'))), 'Times New Roman 12 throughout: the base font, no runs of their own');
});

test('the page from sectPr, the base font from the runs, the header\'s own text with its PAGE field', async () => {
  const { r, doc } = await open('mla-word');
  const s = doc.attrs.setup;
  assert.deepEqual(ST.setup(s), s, 'what import stores is already normal');
  assert.deepEqual([s.page, s.margins, s.header, s.footer, s.font, s.size, s.tab, s.kern, s.title], [[8.5, 11], [1, 1, 1, 1], 0.5, 0.5, 'Times New Roman', 12, 0.5, true, false]);
  assert.deepEqual(s.headers.default, [{ align: 'right', line: 1, after: 0, tabs: [[3.25, 'c'], [6.5, 'r']], runs: [{ text: 'Rivera ' }, { field: 'PAGE' }] }]);
  assert.equal(s.headers.first, null);
  assert.equal(s.footers.default, null);
  assert.equal(r.html.includes('PAGE'), false, 'the field\'s code is not text');
  const look = ST.look(ST.FORMATS.mla9, s);
  assert.deepEqual([look.font, look.size, ST.geometry(look).width, ST.geometry(look).body], ['Times New Roman', 12, 816, 864]);
  assert.deepEqual(ST.headerParts(look, 3, ''), [{ align: 'right', line: 1, after: 0, tabs: [[3.25, 'c'], [6.5, 'r']], runs: [{ text: 'Rivera ' }, { text: '3' }] }]);
});

test('style inheritance: docDefaults → the paragraph style\'s basedOn chain → direct formatting; character styles', async () => {
  const { r, tops } = await open('spacing');
  const s = tops[0].type.schema && (await open('spacing')).doc.attrs.setup;
  assert.deepEqual([s.font, s.size], ['Calibri', 11], 'rPrDefault\'s minorHAnsi is the theme\'s Calibri');
  assert.ok(r.warnings.includes('Fonts Word and Blackboard don\'t share were replaced.'), 'Calibri Light, the headings\' theme font, is not a paper font');
  const [title, , h1, strong, l1, l2, l3, quote, spaced, exact, least, ns1, ns2, right, runs, brk] = tops;
  assert.deepEqual(pick(title, 'line', 'after', 'before'), { line: 1, after: null, before: null }, 'Title: its own single line and no space after (MLA\'s own) over the defaults\' 8 pt');
  assert.deepEqual(marks(title), ['text_style:{"font":null,"size":28}']);
  assert.equal(h1.type.name, 'heading');
  assert.deepEqual(pick(h1, 'level', 'before', 'after', 'line', 'keepNext', 'keepLines'), { level: 1, before: 12, after: null, line: 1.08, keepNext: true, keepLines: true }, 'Heading 1 over Normal over the defaults');
  assert.deepEqual(marks(h1), ['color:{"color":"2F5496"}', 'text_style:{"font":null,"size":16}']);
  assert.deepEqual(marks(strong), ['bold', 'italic'], 'Strong and Emphasis, character styles');
  assert.deepEqual([l1, l2, l3].map((n) => pick(n, 'left', 'indent', 'before', 'after')), [{ left: null, indent: 1, before: null, after: null }, { left: null, indent: 1, before: null, after: null }, { left: null, indent: 1, before: null, after: 8 }],
    'List Paragraph: half an inch in; contextual spacing drops the space between two of the style, not before the Quote');
  assert.deepEqual(pick(quote, 'before', 'after', 'left', 'right', 'align', 'first'), { before: 10, after: 8, left: 0.6, right: 0.6, align: 'center', first: null });
  assert.deepEqual(marks(quote), ['color:{"color":"404040"}', 'italic']);
  assert.deepEqual(pick(spaced, 'before', 'after'), { before: 18, after: 18 });
  assert.deepEqual(pick(exact, 'exact', 'least', 'line'), { exact: 18, least: null, line: null }, 'exactly 18 pt');
  assert.deepEqual(pick(least, 'exact', 'least', 'line'), { exact: null, least: 20, line: null }, 'at least 20 pt');
  for (const n of [ns1, ns2]) assert.deepEqual(pick(n, 'after', 'line'), { after: null, line: 1 }, 'No Spacing, a style not based on Normal');
  assert.deepEqual(pick(right, 'right', 'line', 'after'), { right: 1, line: null, after: 8 });
  assert.deepEqual(marks(runs), ['bold', 'color:{"color":"C00000"}', 'highlight:{"color":"yellow"}', 'italic', 'strike', 'sub', 'sup', 'underline']);
  assert.equal(brk.childCount && brk.content.content.filter((c) => c.type.name === 'hard_break').length, 1, 'a line break');
});

test('page breaks, keep options and widow control', async () => {
  const { tops } = await open('spacing');
  const types = tops.map((n) => n.type.name);
  const breaks = types.map((t, i) => (t === 'page_break' ? i : -1)).filter((i) => i >= 0);
  assert.equal(breaks.length, 2, 'the break inside a paragraph and the page break before one');
  assert.ok(tops[breaks[0] - 1].textContent && tops[breaks[0] + 1].textContent, 'the paragraph split at its break: text either side');
  assert.equal(tops[breaks[0] + 1].attrs.first, 0, 'its second half has no first-line indent of its own, as the paragraph didn\'t');
  const after = tops.slice(breaks[1] + 1);
  assert.deepEqual(after.map((n) => [n.type.name, n.attrs.keepNext, n.attrs.keepLines, n.attrs.widow]), [['paragraph', null, null, null], ['heading', true, true, null], ['paragraph', null, null, null], ['paragraph', null, null, false], ['paragraph', null, null, null], ['paragraph', null, true, null], ['paragraph', null, null, null]]);
});

test('tabs: the default stop from settings, a paragraph\'s own stops with their kinds and leaders, a style\'s stop cleared', async () => {
  const { doc, tops } = await open('tabs');
  assert.equal(doc.attrs.setup.tab, 0.5);
  const row = tops[4];
  assert.deepEqual(row.attrs.tabs, [[1, 'l'], [3.25, 'c'], [5.5, 'r'], [6.25, 'd']]);
  assert.equal((row.textContent.match(/\t/g) || []).length, 4);
  assert.deepEqual(tops[10].attrs.tabs, [[6.49, 'r', 'dot']], 'a dotted leader to the right margin');
  assert.deepEqual(pick(tops[13], 'indent', 'first', 'tabs'), { indent: 1, first: -0.25, tabs: null }, 'a hanging indent: its first tab goes to the left indent, no stop needed');
  assert.deepEqual(pick(tops[16], 'tabs', 'after', 'line'), { tabs: [[6.5, 'r']], after: null, line: 1 }, 'the Header style\'s centre stop cleared, its right stop kept');
});

test('A4, margins, header and footer distances, a different first page, PAGE and NUMPAGES fields; Arial 11 with Courier New, Calibri and sizes', async () => {
  const { doc, tops } = await open('page');
  const s = doc.attrs.setup;
  assert.deepEqual([s.page, s.margins, s.header, s.footer, s.title, s.font, s.size], [[8.268, 11.693], [1.25, 1.25, 1, 1.25], 0.591, 0.394, true, 'Arial', 11]);
  assert.deepEqual(s.headers.default, [{ align: null, line: 1, after: 0, tabs: [[3.25, 'c'], [6.5, 'r']], runs: [{ text: 'Field Notes: The Valley\t\tPage ' }, { field: 'PAGE' }] }]);
  assert.deepEqual(s.footers.default, [{ align: 'center', line: 1, after: 0, tabs: [[3.25, 'c'], [6.5, 'r']], runs: [{ text: 'Page ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }] }]);
  assert.deepEqual(s.headers.first, [{ align: null, line: 1, after: 0, tabs: [[3.25, 'c'], [6.5, 'r']], runs: [] }]);
  assert.deepEqual(s.footers.first[0].runs, [{ text: 'Draft for the class', i: true }]);
  const look = ST.look(ST.FORMATS.mla9, s), g = ST.geometry(look);
  assert.deepEqual([g.width, g.height, g.top, g.left, g.content, g.header, g.footer].map(Math.round), [794, 1123, 120, 120, 554, 57, 38]);
  assert.deepEqual(ST.headerParts(look, 1, ''), s.headers.first, 'page 1 shows the first-page header');
  assert.deepEqual(ST.footerParts(look, 2, 4)[0].runs, [{ text: 'Page ' }, { text: '2' }, { text: ' of ' }, { text: '4' }]);
  assert.deepEqual(pick(tops[1], 'after', 'line'), { after: 10, line: 1.15 });
  assert.deepEqual(marks(tops[2]), ['text_style:{"font":"Courier New","size":null}']);
  assert.deepEqual(marks(tops[3]), ['text_style:{"font":"Calibri","size":14}']);
  assert.ok(marks(tops[4]).includes('text_style:{"font":null,"size":9}'));
  assert.equal(tops[6].attrs.align, 'justify');
});

test('a minimal file with no defaults is Word\'s bare default: Times New Roman 10, single-spaced, nothing after', async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const Z = require('../lib/zip.js');
  const files = [['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<w:document ${W}><w:body><w:p><w:r><w:t>one</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`]];
  const bytes = Buffer.concat(Z.zip(files.map(([name, t]) => ({ name, data: new TextEncoder().encode(t), date: new Date('2026-10-27T12:00:00Z') }))).map((c) => Buffer.from(c)));
  const r = await X.importDocx(bytes, { format: 'mla9' });
  assert.deepEqual([r.setup.font, r.setup.size, r.setup.page, r.setup.margins], ['Times New Roman', 10, [8.5, 11], [1, 1.25, 1, 1.25]], 'Word\'s defaults for a section without pgSz and pgMar');
  const d = S.parse(S.paper, r.html);
  assert.deepEqual(pick(d.firstChild, 'line', 'after', 'first'), { line: 1, after: null, first: 0 });
});

test('export of an imported paper writes its own page, header, footer, defaults, spacing, indents, tabs and keeps', async () => {
  const { doc } = await open('page');
  const o = X.exportDocx(doc, { format: 'mla9', date: new Date('2026-10-27T12:00:00Z') }), d = o.parts['word/document.xml'];
  assert.match(d, /<w:pgSz w:w="11906" w:h="16838"\/><w:pgMar w:top="1800" w:right="1800" w:bottom="1440" w:left="1800" w:header="851" w:footer="567" w:gutter="0"\/>/);
  assert.match(d, /<w:headerReference w:type="first" r:id="rId\d+"\/>/);
  assert.match(d, /<w:titlePg\/>/);
  const parts = Object.keys(o.parts).filter((p) => /word\/(header|footer)\d\.xml/.test(p)).sort();
  assert.deepEqual(parts, ['word/footer1.xml', 'word/footer2.xml', 'word/header1.xml', 'word/header2.xml']);
  const footer = parts.map((p) => o.parts[p]).find((x) => x.includes('NUMPAGES'));
  assert.match(footer, /<w:jc w:val="center"\/>.*Page .*<w:instrText xml:space="preserve"> PAGE <\/w:instrText>.* of .*<w:instrText xml:space="preserve"> NUMPAGES <\/w:instrText>/);
  assert.match(o.parts['word/styles.xml'], /<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"\/><w:sz w:val="22"\/>/);
  assert.match(d, /<w:spacing w:after="200" w:line="276" w:lineRule="auto"\/>/);
  const sp = (await open('spacing')).doc, d2 = X.exportDocx(sp, { format: 'mla9', date: new Date('2026-10-27T12:00:00Z') }).parts['word/document.xml'];
  for (const re of [/<w:keepNext\/><w:keepLines\/>/, /<w:widowControl w:val="0"\/>/, /<w:spacing w:before="200" w:after="160"[^>]*\/><w:ind w:left="864" w:right="864" w:firstLine="0"\/><w:jc w:val="center"\/>/, /w:line="360" w:lineRule="exact"/, /w:line="400" w:lineRule="atLeast"/, /<w:color w:val="C00000"\/>/, /<w:highlight w:val="yellow"\/>/]) assert.match(d2, re);
  const tb = (await open('tabs')).doc, d3 = X.exportDocx(tb, { format: 'mla9', date: new Date('2026-10-27T12:00:00Z') });
  assert.match(d3.parts['word/document.xml'], /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="center" w:pos="4680"\/><w:tab w:val="right" w:pos="7920"\/><w:tab w:val="decimal" w:pos="9000"\/><\/w:tabs>/);
  assert.match(d3.parts['word/document.xml'], /<w:tab w:val="right" w:leader="dot" w:pos="9346"\/>/);
});

test('round trip: Writer\'s .docx of an imported paper imports to the same paper', async () => {
  for (const id of Object.keys(FX.files)) {
    const { doc } = await open(id);
    const bytes = X.exportDocx(doc, { format: 'mla9', surname: 'Rivera', date: new Date('2026-10-27T12:00:00Z') }).bytes;
    const r = await X.importDocx(bytes, { format: 'mla9' });
    const back = S.paper.nodeFromJSON({ ...S.parse(S.paper, r.html).toJSON(), attrs: { setup: r.setup } });
    assert.deepEqual(back.attrs.setup, doc.attrs.setup, `${id}: the page, header and footer`);
    const blocks = (x) => { const out = []; x.descendants((n) => { if (n.isBlock) out.push({ type: n.type.name, ...n.attrs, text: n.textContent, marks: marks(n) }); return !n.isTextblock; }); return out; };
    assert.deepEqual(blocks(back), blocks(doc), `${id}: every block's text, attributes and marks`);
  }
});

test('the page plan: space before (none at a page\'s top after a natural break), keep lines together, widow control off', () => {
  const LH = 36.8, geo = { body: 864, stride: 1082.4, notes: [], sep: 18.4 };
  const text = (n, o = {}) => ({ kind: 'text', lines: Array.from({ length: n }, () => ({ h: LH, notes: [] })), after: o.after || 0, before: o.before || 0, keepNext: !!o.keepNext, keepLines: !!o.keepLines, widow: o.widow });
  const at = (blocks) => P.plan(blocks, geo).breaks.map(({ b, l, gap }) => [b, l, Math.round(gap * 10) / 10]);
  assert.deepEqual(at([text(20), text(3, { before: 48 })]), [[1, 0, Math.round((1082.4 - 20 * LH - 48) * 10) / 10]], 'space before counts: 48px pushes three lines that fit to the next page, which starts at their first line');
  assert.deepEqual(at([text(23), text(2, { before: 48 })]), [[1, 0, Math.round((1082.4 - 23 * LH - 48) * 10) / 10]], 'at a page\'s top its space before goes: the gap takes it back');
  assert.deepEqual(at([text(23), { kind: 'break', lines: [], after: 0 }, text(2, { before: 48 })]), [[2, 0, Math.round((1082.4 - 23 * LH) * 10) / 10]], 'after a page break it stays');
  assert.deepEqual(at([text(18), text(8, { keepLines: true })]), [[1, 0, Math.round((1082.4 - 18 * LH) * 10) / 10]], 'kept together: all of it moves');
  assert.deepEqual(at([text(20), text(4, { widow: false })]).map(([b, l]) => [b, l]), [[1, 3]], 'widow control off: three lines stay and one goes alone');
  assert.deepEqual(at([text(21), text(1, { keepNext: true }), text(4)]).map(([b, l]) => [b, l]), [[1, 0]], 'keep with next on a paragraph');
});

test('format checks flag what an imported paper does differently and fix it to the format\'s value', async () => {
  const { doc } = await open('mla-word');
  const r = F.check(doc, ST.FORMATS.mla9, {});
  const space = r.issues.filter((i) => i.rule === 'paragraph-space');
  assert.equal(space.length, 1, 'one card for them all');
  assert.equal(space[0].message, 'Paragraphs have no space after them');
  assert.deepEqual([space[0].fix.op, space[0].fix.key, space[0].fix.at.length, space[0].from], ['clear', 'after', 19, 1], 'its fix clears the 8 pt after on all 19');
  assert.ok(r.issues.some((i) => i.rule === 'spacing' && i.from === 1), 'the heading block\'s 1.16 lines');
  const page = (await open('page')).doc, p = F.check(page, ST.FORMATS.mla9, {});
  assert.ok(p.issues.some((i) => i.rule === 'margins' && i.fix?.op === 'setup' && i.fix.key === 'margins'), 'the document\'s own margins');
  assert.ok(p.issues.some((i) => i.rule === 'preset-font' && i.fix?.op === 'setup' && i.fix.key === 'font'), 'its own base font');
});
