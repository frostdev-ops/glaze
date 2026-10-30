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
  const doc = S.paper.nodeFromJSON(r.doc);
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
    assert.deepEqual(marks(n), ['italic', 'link'], 'the title in italics; the link draws the Hyperlink style\'s look, not marks of its own');
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
  assert.ok(!r.warnings.includes('Fonts Word and Blackboard don\'t share were replaced.'), 'Calibri Light, the headings\' theme font, is one of Word\'s well-known fonts, kept by name');
  const [title, , h1, strong, l1, l2, l3, quote, spaced, exact, least, ns1, ns2, right, runs, brk] = tops;
  assert.deepEqual(pick(title, 'line', 'after', 'before'), { line: 1, after: null, before: null }, 'Title: its own single line and no space after (MLA\'s own) over the defaults\' 8 pt');
  assert.deepEqual(marks(title), ['text_style:{"font":"Calibri Light","size":28}']);
  assert.equal(h1.type.name, 'heading');
  assert.deepEqual(pick(h1, 'level', 'before', 'after', 'line', 'keepNext', 'keepLines'), { level: 1, before: 12, after: null, line: 1.08, keepNext: true, keepLines: true }, 'Heading 1 over Normal over the defaults');
  assert.deepEqual(marks(h1), ['color:{"color":"2F5496"}', 'text_style:{"font":"Calibri Light","size":16}']);
  assert.deepEqual(marks(strong), ['bold', 'italic'], 'Strong and Emphasis, character styles');
  assert.deepEqual([l1, l2, l3].map((n) => pick(n, 'left', 'indent', 'before', 'after')), [{ left: null, indent: 1, before: null, after: null }, { left: null, indent: 1, before: null, after: null }, { left: null, indent: 1, before: null, after: 8 }],
    'List Paragraph: half an inch in; contextual spacing drops the space between two of the style, not before the Quote');
  assert.equal(quote.type.name, 'blockquote', 'Word\'s Quote style is a block quote');
  assert.deepEqual(pick(quote.firstChild, 'before', 'after', 'left', 'right', 'align', 'first'), { before: 10, after: 8, left: 0.1, right: 0.6, align: 'center', first: null }, 'its 0.6 in: the format\'s half inch for the quote and 0.1 of its own');
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
  const d = S.paper.nodeFromJSON(r.doc);
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
  assert.match(o.parts['word/styles.xml'], /<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"\/><w:kern w:val="2"\/><w:sz w:val="22"\/>/, 'the base font and size, kerning as the file had it');
  assert.match(d, /<w:spacing w:after="200" w:line="276" w:lineRule="auto"\/>/);
  const sp = (await open('spacing')).doc, d2 = X.exportDocx(sp, { format: 'mla9', date: new Date('2026-10-27T12:00:00Z') }).parts['word/document.xml'];
  for (const re of [/<w:keepNext\/><w:keepLines\/>/, /<w:widowControl w:val="0"\/>/, /<w:pStyle w:val="BlockQuote"\/><w:spacing w:before="200" w:after="160"[^>]*\/><w:ind w:left="864" w:right="864"\/><w:jc w:val="center"\/>/, /w:line="360" w:lineRule="exact"/, /w:line="400" w:lineRule="atLeast"/, /<w:color w:val="C00000"\/>/, /<w:highlight w:val="yellow"\/>/]) assert.match(d2, re);
  const tb = (await open('tabs')).doc, d3 = X.exportDocx(tb, { format: 'mla9', date: new Date('2026-10-27T12:00:00Z') });
  assert.match(d3.parts['word/document.xml'], /<w:tabs><w:tab w:val="left" w:pos="1440"\/><w:tab w:val="center" w:pos="4680"\/><w:tab w:val="right" w:pos="7920"\/><w:tab w:val="decimal" w:pos="9000"\/><\/w:tabs>/);
  assert.match(d3.parts['word/document.xml'], /<w:tab w:val="right" w:leader="dot" w:pos="9346"\/>/);
});

test('round trip: Writer\'s .docx of an imported paper imports to the same paper', async () => {
  for (const id of Object.keys(FX.files)) {
    const { doc } = await open(id);
    const bytes = X.exportDocx(doc, { format: 'mla9', surname: 'Rivera', date: new Date('2026-10-27T12:00:00Z') }).bytes;
    const r = await X.importDocx(bytes, { format: 'mla9' });
    const back = S.paper.nodeFromJSON(r.doc);
    // A base font that isn't a paper font (Aptos) is null, the format's; Writer's .docx names the format's.
    assert.deepEqual(back.attrs.setup, { ...doc.attrs.setup, font: doc.attrs.setup.font ?? ST.FORMATS.mla9.font }, `${id}: the page, header and footer`);
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
  assert.deepEqual(at([text(23), { kind: 'break', lines: [], after: 0 }, text(2, { before: 48 })]), [[2, 0, Math.round((1082.4 - 23 * LH - 48) * 10) / 10]], 'after a page break too, as Word does');
  assert.deepEqual(at([text(1, { after: 16 }), text(22, { before: 16 }), text(1)]).map(([b, l]) => [b, l]), [[2, 0]], 'between two paragraphs the larger of after and before (16), not both (32): all 22 lines fit under the first');
  assert.deepEqual(at([text(18), text(8, { keepLines: true })]), [[1, 0, Math.round((1082.4 - 18 * LH) * 10) / 10]], 'kept together: all of it moves');
  assert.deepEqual(at([text(20), text(4, { widow: false })]).map(([b, l]) => [b, l]), [[1, 3]], 'widow control off: three lines stay and one goes alone');
  assert.deepEqual(at([text(21), text(1, { keepNext: true }), text(4)]).map(([b, l]) => [b, l]), [[1, 0]], 'keep with next on a paragraph');
});

test('a line fits while its text does: multiple spacing\'s extra space may hang into the bottom margin, as in Word', () => {
  const geo = { body: 864, stride: 1082.4, notes: [], sep: 18.4 }, line = (slack) => ({ h: 36.8, notes: [], slack });
  const block = (n, slack, before = 0) => ({ kind: 'text', lines: Array.from({ length: n }, () => line(slack)), after: 0, before, widow: false });
  // Word measured: a first paragraph's 27 pt before keeps 23 double-spaced lines on page 1 (the last one's box 13.8 pt
  // past the margin), 28 pt does not; single-spaced lines must fit whole.
  const pt = (n) => (n * 96) / 72;
  assert.deepEqual(P.plan([block(1, 18.4, pt(27)), block(29, 18.4)], geo).breaks.map(({ b, l }) => [b, l]), [[1, 22]], 'double, 27 pt before: 23 lines on page 1');
  assert.deepEqual(P.plan([block(1, 18.4, pt(28)), block(29, 18.4)], geo).breaks.map(({ b, l }) => [b, l]), [[1, 21]], 'double, 28 pt before: 22');
  assert.deepEqual(P.plan([block(1, 0, pt(27)), block(29, 0)], geo).breaks.map(({ b, l }) => [b, l]), [[1, 21]], 'no slack: the whole box must fit');
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

test('a paper that keeps the file\'s formatting hears nothing about what the file sets; applying the format clears it', async () => {
  const { doc } = await open('page');
  const all = F.check(doc, ST.FORMATS.mla9, {}).issues.map((i) => i.rule), kept = F.check(doc, ST.FORMATS.mla9, {}, { keep: true }).issues.map((i) => i.rule);
  for (const rule of ['spacing', 'paragraph-space', 'margins', 'preset-font']) assert.ok(all.includes(rule) && !kept.includes(rule), rule);
  assert.ok(kept.includes('list-missing'), 'what the file doesn\'t set is still checked');
  const applied = S.paper.nodeFromJSON(F.apply(doc));
  assert.equal(applied.attrs.setup, null);
  applied.descendants((n) => { if (n.isTextblock) for (const k of ['line', 'exact', 'least', 'before', 'after']) assert.equal(n.attrs[k], null, k); return true; });
  assert.deepEqual(F.check(applied, ST.FORMATS.mla9, {}).issues.filter((i) => F.KEPT.has(i.rule) && i.rule !== 'font').map((i) => i.rule), [], 'nothing the format would flag is left but runs in other fonts');
});

test('a Google Docs export: Arial 12 on the runs over Docs\' Arial 11 defaults, header 0, no header parts, its styles\' 1.15 lines kept', async () => {
  const { r, doc, tops } = await open('docs');
  assert.deepEqual(r.warnings, []);
  const s = doc.attrs.setup;
  assert.deepEqual(ST.setup(s), s);
  assert.deepEqual([s.page, s.margins, s.header, s.footer, s.font, s.size, s.tab, s.kern, s.title], [[8.5, 11], [1, 1, 1, 1], 0, 0.5, 'Arial', 12, 0.5, false, false], 'sz 24 on the runs is the base; header="0" kept');
  assert.deepEqual([s.headers, s.footers], [{ default: null, first: null }, { default: null, first: null }], 'no header or footer parts: none drawn');
  assert.deepEqual(ST.headerParts(ST.look(ST.FORMATS.mla9, s), 2, ''), [], 'and not MLA\'s page number either');
  const [title, subtitle] = tops;
  assert.deepEqual(pick(title, 'line', 'after', 'before', 'keepNext', 'keepLines'), { line: 1.15, after: 3, before: null, keepNext: true, keepLines: true }, 'Title: a lineRule with no line keeps the defaults\' 276');
  assert.deepEqual(marks(title), ['direction', 'text_style:{"font":null,"size":26}']);
  assert.deepEqual(pick(subtitle, 'line', 'after'), { line: 1.15, after: 16 });
  assert.deepEqual(marks(subtitle), ['color:{"color":"666666"}', 'direction', 'text_style:{"font":null,"size":15}']);
  for (const n of tops.slice(2, 6)) assert.deepEqual(pick(n, 'line', 'after', 'before', 'first'), { line: null, after: null, before: null, first: 0 }, 'heading block: double is MLA\'s own, nothing after');
  assert.deepEqual(pick(tops[6], 'align', 'line', 'after', 'first'), { align: 'center', line: null, after: null, first: null }, 'the centred title');
  assert.deepEqual(tops.slice(7, 10).map((n) => [n.attrs.first, n.textContent.startsWith('\t')]), Array(3).fill([0, true]), 'opened with a tab, no indent of their own');
  const heads = tops.filter((n) => n.type.name === 'heading');
  assert.deepEqual(heads.map((n) => [n.attrs.level, n.attrs.before, n.attrs.after, n.attrs.line, n.attrs.keepNext]),
    [[1, 20, 6, 1.15, true], [2, 18, 6, 1.15, true], [3, 16, 4, 1.15, true], [4, 14, 4, 1.15, true], [5, 12, 4, 1.15, true], [6, 12, 4, 1.15, true]], 'Heading 1-6 retain their depth and spacing');
  assert.deepEqual(heads.map((n) => marks(n).filter((m) => m.startsWith('text_style') || m.startsWith('color'))),
    [['text_style:{"font":null,"size":20}'], ['text_style:{"font":null,"size":16}'], ['color:{"color":"434343"}', 'text_style:{"font":null,"size":14}'], ['color:{"color":"666666"}'], ['color:{"color":"666666"}', 'text_style:{"font":null,"size":11}'], ['color:{"color":"666666"}', 'text_style:{"font":null,"size":11}']]);
  const types = tops.map((n) => n.type.name), at = types.indexOf('page_break');
  assert.equal(types.filter((t) => t === 'page_break').length, 1, 'pageBreakBefore w:val="0" on every paragraph is no break; the one set on is');
  assert.equal(tops[at + 1].attrs.first, null, 'the paragraph after it keeps MLA\'s indent');
  const bold = tops.filter((n) => marks(n).includes('bold'));
  assert.equal(bold.length, 1, 'the bold run; a bold paragraph mark bolds no text');
  assert.ok(bold[0].textContent.includes('the ledger of the market'));
  assert.ok(!tops.filter((n) => n.type.name === 'paragraph').slice(2).some((n) => marks(n).some((m) => m.startsWith('text_style'))), 'body in the base, Arial 12');
  assert.deepEqual(tops.slice(-2).map((n) => [n.content.size, n.attrs.line]), [[0, null], [0, null]], 'the two empty double-spaced paragraphs at the end');
});

test('a Word 365 paper from today\'s Normal.dotm: 1.16 lines and 8 pt after kept, Title and Heading 1 as Word writes them', async () => {
  const { doc, tops } = await open('aptos-word');
  const s = doc.attrs.setup;
  assert.deepEqual([s.page, s.margins, s.header, s.size, s.kern, s.headers.default], [[8.5, 11], [1, 1, 1, 1], 0.5, 12, true, null]);
  assert.deepEqual(pick(tops[0], 'line', 'after'), { line: 1, after: 4 });
  const h = tops.find((n) => n.type.name === 'heading');
  assert.deepEqual(pick(h, 'level', 'before', 'after', 'line', 'keepNext', 'keepLines'), { level: 1, before: 18, after: 4, line: 1.16, keepNext: true, keepLines: true });
  assert.ok(marks(h).includes('color:{"color":"0F4761"}'));
  for (const n of tops.filter((x) => x.type.name === 'paragraph').slice(1)) assert.deepEqual(pick(n, 'line', 'after', 'first'), { line: 1.16, after: 8, first: 0 });
});

// lib/writer-color.js on import: a run's colour stays where the paper shows it (on its highlight, else the white page, at
// 2:1); Word's theme text and page colours and Automatic are the paper's ink.
test('legibility: white on a shaded paragraph or cell, theme text and Automatic import as the paper\'s ink; accents stay', async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const Z = require('../lib/zip.js');
  const run = (rpr, t) => `<w:r><w:rPr>${rpr}</w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
  const body = `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="1F1F1F"/></w:pPr>${run('<w:color w:val="FFFFFF"/>', 'shaded white')}${run('<w:color w:val="C00000"/>', ' dark red')}</w:p>`
    + `<w:p>${run('<w:color w:val="262626" w:themeColor="text1"/>', 'theme text')}${run('<w:color w:val="1F1F1F" w:themeColor="background1"/>', ' theme page')}${run('<w:color w:val="4472C4" w:themeColor="accent1"/>', ' accent words')}${run('<w:color w:val="auto"/>', ' auto words')}${run('<w:color w:val="404040" w:themeColor="text1" w:themeTint="BF"/>', ' tinted text')}</w:p>`
    + `<w:p>${run('<w:color w:val="FFFFFF"/><w:highlight w:val="darkBlue"/>', 'white on dark blue')}${run('<w:color w:val="FFFF00"/><w:highlight w:val="yellow"/>', ' yellow on yellow')}</w:p>`
    + `<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="262626"/></w:tcPr><w:p>${run('<w:color w:val="FFFFFF" w:themeColor="background1"/>', 'cell white')}</w:p></w:tc></w:tr></w:tbl>`;
  const files = [['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`]];
  const bytes = Buffer.concat(Z.zip(files.map(([name, t]) => ({ name, data: new TextEncoder().encode(t), date: new Date('2026-10-29T12:00:00Z') }))).map((c) => Buffer.from(c)));
  const doc = S.paper.nodeFromJSON((await X.importDocx(bytes, { format: 'mla9' })).doc);
  const on = (needle) => { let hit = null; doc.descendants((n) => { if (!hit && n.isText && n.text.includes(needle)) hit = n; return !hit; }); assert.ok(hit, needle); return hit.marks.filter((m) => m.type.name === 'color' || m.type.name === 'highlight').map((m) => `${m.type.name}:${m.attrs.color}`).sort(); };
  assert.deepEqual(on('shaded white'), []);
  assert.deepEqual(on('dark red'), ['color:C00000']);
  assert.deepEqual(on('theme text'), []);
  assert.deepEqual(on('theme page'), []);
  assert.deepEqual(on('accent words'), ['color:4472C4']);
  assert.deepEqual(on('auto words'), []);
  assert.deepEqual(on('tinted text'), ['color:404040'], 'a tint of text1 is a colour of its own');
  assert.deepEqual(on('white on dark blue'), ['color:FFFFFF', 'highlight:darkBlue']);
  assert.deepEqual(on('yellow on yellow'), ['highlight:yellow']);
  assert.deepEqual(on('cell white'), []);
});
