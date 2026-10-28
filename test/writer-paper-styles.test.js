// Glaze Writer's paper formats (lib/writer-styles.js): the three formats' numbers, the page CSS and the .docx styles made
// from the same ones, the line heights pagination counts (Word's), and a student's presets kept valid.
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../lib/writer-styles.js');
const S = require('../lib/writer-schema.js');
const FX = require('./fixtures/writer-paper-fixtures.js');

test('MLA 9, APA 7 and Chicago 17 as their guides set them', () => {
  const { mla9, apa7, chicago17 } = ST.FORMATS;
  for (const f of [mla9, apa7, chicago17]) {
    assert.deepEqual([f.font, f.size, f.line, f.first, f.margins], ['Times New Roman', 12, 2, 0.5, [1, 1, 1, 1]], f.id);
    assert.equal(f.header.distance, 0.5);
  }
  assert.deepEqual([mla9.opening, mla9.header.text, mla9.list.title, mla9.title.bold], ['heading', 'name-page', 'Works Cited', false]);
  assert.deepEqual([apa7.opening, apa7.header.text, apa7.header.first, apa7.list.title, apa7.list.bold, apa7.title.bold], ['title-page', 'page', true, 'References', true, true]);
  assert.deepEqual(apa7.headings.map((h) => [h.align, !!h.bold, !!h.italic]), [['center', true, false], ['left', true, false], ['left', true, true], ['left', true, false], ['left', true, true]]);
  assert.deepEqual([chicago17.header.first, chicago17.list.title, chicago17.notes.size, chicago17.list.line, chicago17.quote.line], [false, 'Bibliography', 10, 1, 1]);
});

test('line heights are Word\'s: double Times New Roman 12 is 27.6pt (36.8px), so 23 lines fill a page', () => {
  const f = ST.FORMATS.mla9;
  assert.equal(ST.lineHeight(f), 36.8);
  assert.equal(ST.lineHeight(f, { line: 1 }), 18.4);
  assert.equal(ST.lineHeight(f, { font: 'Calibri', size: 11, line: 1 }), 17.933);
  assert.equal(Math.floor(ST.geometry(f).body / ST.lineHeight(f)), 23);
  assert.deepEqual(ST.geometry(f), { width: 816, height: 1056, top: 96, right: 96, bottom: 96, left: 96, body: 864, content: 624, header: 48 });
});

test('the page CSS and the .docx styles come from the same numbers', () => {
  for (const id of ST.IDS) {
    const f = ST.FORMATS[id], css = ST.css(f), xml = ST.stylesXML(f);
    assert.ok(css.includes(`font-family: "${f.font}"`) && css.includes(`font-size: ${f.size}pt`) && css.includes(`line-height: ${ST.lineHeight(f)}px`), id);
    assert.ok(css.includes(`text-indent: ${f.first}in`) && css.includes(`.gp-flow { width: ${ST.geometry(f).content}px; left: 96px; top: 96px; }`), id);
    assert.ok(xml.includes(`<w:rFonts w:ascii="${f.font}"`) && xml.includes(`<w:sz w:val="${f.size * 2}"/>`) && xml.includes(`w:line="${f.line * 240}"`) && xml.includes(`<w:ind w:firstLine="${f.first * 1440}"/>`), id);
    f.headings.forEach((h, i) => {
      assert.ok(css.includes(`h${i + 1} { font-size: inherit; font-weight: ${h.bold ? 700 : 400}; font-style: ${h.italic ? 'italic' : 'normal'}; text-align: ${h.align};`), `${id} h${i + 1} css`);
      assert.match(xml, new RegExp(`w:styleId="Heading${i + 1}".*?<w:jc w:val="${h.align}"/>.*?<w:b w:val="${h.bold ? 1 : 0}"/>`), `${id} h${i + 1} docx`);
    });
    assert.ok(css.includes(`p.gp-entry { padding-left: ${f.list.hanging}in; text-indent: -${f.list.hanging}in`) && xml.includes(`<w:ind w:left="${f.list.hanging * 1440}" w:hanging="${f.list.hanging * 1440}"/>`), `${id} hanging list`);
    assert.match(ST.sectPr(f, { header: 'rId1', first: 'rId2' }), /<w:pgSz w:w="12240" w:h="15840"\/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720"/);
  }
  assert.match(ST.sectPr(ST.FORMATS.chicago17, { header: 'rId1', first: 'rId2' }), /w:type="first".*<w:titlePg\/>/);
  assert.doesNotMatch(ST.sectPr(ST.FORMATS.mla9, { header: 'rId1', first: 'rId2' }), /titlePg|w:type="first"/);
});

test('headers, dates and first-line indents by format', () => {
  const { mla9, apa7, chicago17 } = ST.FORMATS;
  assert.deepEqual([ST.headerText(mla9, 3, 'Rivera'), ST.headerText(mla9, 3, ''), ST.headerText(apa7, 1), ST.headerText(chicago17, 1), ST.headerText(chicago17, 2)], ['Rivera 3', '3', '1', '', '2']);
  const d = new Date(2026, 9, 27);
  assert.deepEqual([ST.dateText(mla9, d), ST.dateText(apa7, d), ST.dateText(chicago17, d)], ['27 October 2026', 'October 27, 2026', 'October 27, 2026']);
  assert.deepEqual([ST.firstOf(mla9, {}), ST.firstOf(mla9, { align: 'center' }), ST.firstOf(mla9, { first: 0 }), ST.firstOf(mla9, { first: -0.5 })], [0.5, 0, 0, -0.5]);
});

test('a student\'s preset: built on a format, within range, else refused', () => {
  const p = { id: 'custom:a1', label: 'Arial 11', base: 'apa7', font: 'Arial', size: 11, line: 1.5, first: 0.25, margin: 1.25, header: 'none' };
  const f = ST.custom(p);
  assert.deepEqual([f.id, f.label, f.base, f.font, f.size, f.line, f.first, f.margins, f.header.text, f.opening, f.list.title], ['custom:a1', 'Arial 11', 'apa7', 'Arial', 11, 1.5, 0.25, [1.25, 1.25, 1.25, 1.25], 'none', 'title-page', 'References']);
  assert.deepEqual(ST.preset(f), p, 'what it stores round-trips');
  assert.equal(ST.get(p).font, 'Arial', 'a stored preset');
  assert.equal(ST.get(f).id, 'custom:a1', 'a made one');
  assert.equal(ST.get(ST.FORMATS.chicago17), ST.FORMATS.chicago17);
  for (const bad of [{ ...p, font: 'Comic Sans MS' }, { ...p, size: 40 }, { ...p, line: 3 }, { ...p, margin: 3 }, { ...p, id: 'x' }, { ...p, base: 'ieee' }, { ...p, label: '' }, { ...p, header: '<b>' }, null]) assert.equal(ST.custom(bad), null, JSON.stringify(bad));
  assert.equal(ST.get('nope'), ST.FORMATS.mla9);
});

test('the list page: found by its title in any format, its entries up to the end', () => {
  const doc = S.paper.nodeFromJSON(FX.papers.mla9()), at = ST.listAt(doc);
  assert.equal(doc.child(at.title).textContent, 'Works Cited');
  assert.equal(at.to - at.from, 4);
  assert.deepEqual(ST.listAt(FX.papers.apa7()), ST.listAt(S.paper.nodeFromJSON(FX.papers.apa7())), 'JSON and nodes alike');
  assert.equal(ST.listAt(S.parse(S.paper, '<p>Works Cited</p><p>x</p>')), null, 'only a centred title');
  assert.deepEqual(ST.blockBox(ST.FORMATS.chicago17, {}, { entry: true }), { line: 18.4, after: 16, before: 0 });
});

test('APA 7 has its fifth heading level: indented, bold italic, on screen and in Word', () => {
  const ST = require('../lib/writer-styles.js'), f = ST.FORMATS.apa7;
  assert.match(ST.css(f), / h5 \{[^}]*font-weight: 700; font-style: italic;[^}]*text-indent: 0\.5in/);
  const h5 = /<w:style w:type="paragraph" w:styleId="Heading5">[\s\S]*?<\/w:style>/.exec(ST.stylesXML(f))?.[0] || '';
  assert.match(h5, /<w:b( w:val="1")?\/>/);
  assert.match(h5, /<w:i( w:val="1")?\/>/);
  assert.match(h5, /w:firstLine="720"/);
});
