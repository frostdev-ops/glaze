// Glaze Writer's formats on a paper (lib/writer-format.js): a new paper's opening and list page from Ultra's names, the
// switch between formats, and the format checks: each flags its seeded error (test/fixtures/writer-paper-fixtures.js) and
// a clean paper has none.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const ST = require('../lib/writer-styles.js');
const F = require('../lib/writer-format.js');
const FX = require('./fixtures/writer-paper-fixtures.js');

const node = (j) => S.paper.nodeFromJSON(j);
const ctx = { name: FX.context.name, course: FX.context.course };
const v = { name: 'Alex Rivera', instructor: '', course: 'ENGL 2110: American Literature II', date: '27 October 2026', title: 'Essay 2' };

test('a new MLA paper: the heading block filled from Ultra (instructor left to type), the title, the body, Works Cited on its own page', () => {
  const d = node(F.template(ST.FORMATS.mla9, v, [{ type: 'paragraph', attrs: { align: null, indent: 0, line: null, first: null }, content: [{ type: 'text', text: 'From Ultra.' }] }]));
  assert.deepEqual(d.content.content.map((n) => [n.type.name, n.textContent, n.attrs.align || null, n.attrs.first ?? null]), [
    ['paragraph', 'Alex Rivera', null, 0], ['paragraph', '', null, 0], ['paragraph', 'ENGL 2110: American Literature II', null, 0], ['paragraph', '27 October 2026', null, 0],
    ['paragraph', 'Essay 2', 'center', null], ['paragraph', 'From Ultra.', null, null], ['page_break', '', null, null], ['paragraph', 'Works Cited', 'center', null]]);
  assert.equal(F.surname(d, ST.FORMATS.mla9), 'Rivera');
  assert.deepEqual(F.read(d, ST.FORMATS.mla9).lines, { name: 'Alex Rivera', instructor: '', course: 'ENGL 2110: American Literature II', date: '27 October 2026', title: 'Essay 2' });
});

test('new APA and Chicago papers open on a title page', () => {
  const apa = node(F.template(ST.FORMATS.apa7, v));
  const texts = apa.content.content.map((n) => n.textContent);
  assert.deepEqual(texts.slice(0, 11), ['', '', '', 'Essay 2', '', 'Alex Rivera', 'ENGL 2110: American Literature II', '', '27 October 2026', '', 'Essay 2']);
  assert.equal(apa.child(9).type.name, 'page_break');
  assert.ok(apa.child(3).firstChild.marks.some((m) => m.type.name === 'bold'), 'APA\'s title is bold');
  assert.equal(apa.lastChild.textContent, 'References');
  const chi = node(F.template(ST.FORMATS.chicago17, v));
  assert.equal(chi.child(6).textContent, 'Essay 2');
  assert.equal(chi.lastChild.textContent, 'Bibliography');
  assert.deepEqual(F.read(chi, ST.FORMATS.chicago17).lines, { title: 'Essay 2', name: 'Alex Rivera', course: 'ENGL 2110: American Literature II', instructor: '', date: '27 October 2026' });
});

test('switching formats carries the opening\'s lines over and renames the list; a paper not in the old shape keeps its opening', () => {
  const mla = FX.papers.mla9();
  const apa = node(F.restyle(mla, ST.FORMATS.mla9, ST.FORMATS.apa7, {}));
  const o = F.read(apa, ST.FORMATS.apa7);
  assert.deepEqual(o.lines, { title: FX.context.title, name: FX.context.name, course: FX.context.course, instructor: FX.context.instructor, date: '26 October 2026' });
  assert.ok(apa.textContent.includes('Professor Okafor') && apa.textContent.includes('ENGL 2110'));
  assert.equal(apa.child(ST.listAt(apa).title).textContent, 'References');
  const body = (d, f) => d.content.content.slice(F.read(d, f).end).map((n) => n.textContent).join('\n');
  assert.equal(body(apa, ST.FORMATS.apa7), body(node(mla), ST.FORMATS.mla9).replace('Works Cited', 'References'), 'the body, once, as it was');
  const back = node(F.restyle(apa, ST.FORMATS.apa7, ST.FORMATS.mla9, {}));
  assert.deepEqual(F.read(back, ST.FORMATS.mla9).lines.name, FX.context.name);
  assert.equal(back.child(ST.listAt(back).title).textContent, 'Works Cited');
  const loose = { type: 'doc', content: [{ type: 'paragraph', attrs: { align: 'center', indent: 0, line: null, first: null }, content: [{ type: 'text', text: 'Just a title' }] }] };
  assert.deepEqual(F.restyle(loose, ST.FORMATS.mla9, ST.FORMATS.apa7).content.map((n) => n.content?.[0]?.text), ['Just a title']);
});

for (const id of ST.IDS) {
  test(`${id}: a clean paper has no format issues, and the checklist is all ticks`, () => {
    const r = F.check(node(FX.papers[id]()), ST.FORMATS[id], ctx);
    assert.deepEqual(r.issues.map((i) => i.rule), []);
    assert.ok(r.rows.length >= 6 && r.rows.every((x) => x.count === 0));
  });
  for (const [rule, json] of FX.seeded[id]()) {
    test(`${id}: the seeded ${rule} is flagged`, () => {
      const d = node(json), r = F.check(d, ST.FORMATS[id], ctx), hit = r.issues.find((i) => i.rule === rule);
      assert.ok(hit, `${rule} in ${JSON.stringify(r.issues.map((i) => i.rule))}`);
      assert.deepEqual([hit.source, hit.kind, typeof hit.message, Array.isArray(hit.suggestions)], ['format', 'format', 'string', true]);
      assert.ok(hit.from >= 0 && hit.to <= d.content.size && hit.from <= hit.to);
      assert.ok(r.rows.find((x) => x.id === hit.row).count >= 1, 'counted in its checklist row');
    });
  }
}

test('fix suggestions and messages: MLA citation shape, date order, and the translatable key with its values', () => {
  const [, cite] = FX.seeded.mla9().find(([r]) => r === 'cite-shape');
  const i = F.check(node(cite), ST.FORMATS.mla9, ctx).issues.find((x) => x.rule === 'cite-shape');
  assert.deepEqual([i.message, i.suggestions], ['MLA citation', ['(Morrison 42)']]);
  assert.equal(node(cite).textBetween(i.from, i.to), '(Morrison, 42)');
  const [, date] = FX.seeded.mla9().find(([r]) => r === 'heading-date');
  assert.deepEqual(F.check(node(date), ST.FORMATS.mla9, ctx).issues.find((x) => x.rule === 'heading-date').suggestions, ['26 October 2026']);
  const [, font] = FX.seeded.mla9().find(([r]) => r === 'font');
  const f = F.check(node(font), ST.FORMATS.mla9, ctx).issues.find((x) => x.rule === 'font');
  assert.deepEqual([f.key, f.vars, f.message, f.fix], ['The paper\'s text is all {font} {size}', { font: 'Times New Roman', size: 12 }, 'The paper\'s text is all Times New Roman 12', { op: 'unmark', mark: 'text_style' }]);
});

test('quotes: paired in order, so the text between two short quotations is never taken for a long one', () => {
  const para = (t) => ({ type: 'doc', content: [...FX.papers.mla9().content.slice(0, 5), { type: 'paragraph', attrs: { align: null, indent: 0, line: null, first: null }, content: [{ type: 'text', text: t }] }, ...FX.papers.mla9().content.slice(-6)] });
  const long = 'x '.repeat(400);
  assert.deepEqual(F.check(node(para(`She says "rememory," ${long} and "the price of the ticket" here.`)), ST.FORMATS.mla9, ctx).issues.map((i) => i.rule), []);
  assert.deepEqual(F.check(node(para(`She says “${long}” here.`)), ST.FORMATS.mla9, ctx).issues.map((i) => i.rule), ['block-quote']);
  assert.deepEqual(F.check(node(para(`She says "${'word '.repeat(45)}" here.`)), ST.FORMATS.apa7, ctx).issues.map((i) => i.rule).filter((r) => r === 'block-quote'), ['block-quote'], 'APA: 40 words or more');
  assert.deepEqual(F.check(node(para(`She says "${'word '.repeat(45)}" here.`)), ST.FORMATS.mla9, ctx, { lines: () => 3 }).issues.map((i) => i.rule), [], 'MLA counts lines (the frame measures them)');
});

test('a preset away from its format\'s margins, font or header is flagged with a fix back to the format', () => {
  const f = ST.custom({ id: 'custom:x', label: 'Mine', base: 'mla9', font: 'Arial', size: 11, line: 1.5, margin: 1.25, header: 'page' });
  const r = F.check(node(FX.papers.mla9()), f, ctx);
  assert.deepEqual(r.issues.map((i) => i.rule).sort(), ['header-kind', 'margins', 'preset-font', 'preset-line']);
  assert.ok(r.issues.every((i) => i.fix?.op === 'format' && i.fix.id === 'mla9'));
});

test('APA permits Arial 11 and Calibri 11; Chicago permits Arial 11 and Calibri 12', () => {
  // APA 7, section 2.19: https://apastyle.apa.org/style-grammar-guidelines/paper-format/font
  // Chicago/Turabian (17th-compatible), Main Text tip sheet: https://www.chicagomanualofstyle.org/turabian/Student-Tip-Sheets.html
  for (const [id, font, size] of [['apa7', 'Arial', 11], ['apa7', 'Calibri', 11], ['chicago17', 'Arial', 11], ['chicago17', 'Calibri', 12]]) {
    const f = ST.custom({ id: 'custom:font', label: 'Legible', base: id, font, size });
    assert.ok(!F.check(node(FX.papers[id]()), f, ctx).issues.some((i) => i.rule === 'preset-font'), `${id} ${font} ${size}`);
  }
});

test('a bold Chicago title and a paper without borrowed material are legitimate', () => {
  const f = ST.FORMATS.chicago17, json = FX.papers.chicago17();
  json.content[6].content.forEach((n) => { n.marks = [{ type: 'bold' }]; });
  assert.ok(!F.check(node(json), f, ctx).issues.some((i) => i.rule === 'title-bold'), 'the official title-page sample uses bold');
  const own = node(F.template(f, v, [{ type: 'paragraph', content: [{ type: 'text', text: 'My own observation. '.repeat(30) }] }]));
  assert.ok(!F.check(own, f, ctx).issues.some((i) => i.rule === 'notes-none'), 'length alone proves no need for a citation');
});
