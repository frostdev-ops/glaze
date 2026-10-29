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

test('an imported MLA heading accepts explicit left alignment and blank paragraphs before its title', () => {
  const paper = F.template(ST.FORMATS.mla9, { ...v, instructor: 'Prof. Okafor' });
  for (const p of paper.content.slice(0, 4)) p.attrs.align = 'left';
  paper.content.splice(4, 0, { type: 'paragraph' }, { type: 'paragraph' });
  const d = node(paper), opening = F.read(d, ST.FORMATS.mla9);
  assert.equal(opening.at.title, 6);
  assert.equal(opening.end, 7);
  assert.equal(opening.lines.course, v.course);
  assert.equal(F.surname(d, ST.FORMATS.mla9), 'Rivera');
  assert.ok(!F.check(d, ST.FORMATS.mla9).issues.some((i) => i.rule === 'opening'));
  const apa = node(F.restyle(d, ST.FORMATS.mla9, ST.FORMATS.apa7));
  assert.equal(F.read(apa, ST.FORMATS.apa7).lines.name, v.name);
});

test('the reference list recognizes manual breaks before blank spacing and rendered page boundaries', () => {
  for (const id of ST.IDS) {
    const json = FX.papers[id](), list = ST.listAt(json);
    json.content.splice(list.title, 0, { type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'hard_break' }] });
    assert.ok(!F.check(node(json), ST.FORMATS[id]).issues.some((i) => i.rule === 'list-page'), `${id}: manual break before blank spacing`);
    json.content.splice(list.title - 1, 1);
    const doc = node(json), title = ST.listAt(doc).title;
    const tops = []; doc.forEach((n, pos) => tops.push({ n, pos }));
    const from = tops[title].pos + 1, bodyEnd = tops[title - 3].pos + tops[title - 3].n.nodeSize - 2;
    const check = (pageAt) => F.check(doc, ST.FORMATS[id], {}, { pageAt }).issues.some((i) => i.rule === 'list-page');
    assert.equal(check((pos) => pos >= from ? 6 : 5), false, `${id}: automatic page boundary`);
    assert.equal(check(() => 6), true, `${id}: body and heading share a page`);
    assert.equal(check((pos) => pos >= bodyEnd ? 6 : 5), true, `${id}: body's last line is on the heading's page`);
    assert.equal(check(() => 0), true, `${id}: unknown layout retains the structural warning`);
  }
});

test('a references-only document already starts on its own page; a preceding image is body content', () => {
  const json = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', attrs: { align: 'center' }, content: [{ type: 'text', text: 'Works Cited' }] }] };
  const check = () => F.check(node(json), ST.FORMATS.mla9).issues.some((i) => i.rule === 'list-page');
  assert.equal(check(), false);
  json.content[0].content = [{ type: 'image', attrs: { src: 'https://example.test/image.png' } }];
  assert.equal(check(), true);
});

test('new APA and Chicago papers open on a title page', () => {
  const apa = node(F.template(ST.FORMATS.apa7, v));
  const texts = apa.content.content.map((n) => n.textContent);
  assert.deepEqual(texts.slice(0, 12), ['', '', '', 'Essay 2', '', 'Alex Rivera', '', 'ENGL 2110: American Literature II', '', '27 October 2026', '', 'Essay 2']);
  assert.equal(apa.child(10).type.name, 'page_break');
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
  assert.deepEqual(o.lines, { title: FX.context.title, name: FX.context.name, affiliation: '', course: FX.context.course, instructor: FX.context.instructor, date: '26 October 2026' });
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

test('APA title pages include affiliation and the assignment due date when known', () => {
  const f = ST.FORMATS.apa7, values = { ...v, affiliation: 'Department of English, Example University', dueDate: 'November 3, 2026' };
  const d = node(F.template(f, values));
  assert.ok(d.textContent.includes(values.affiliation));
  assert.ok(d.textContent.includes(values.dueDate));
  assert.equal(F.read(d, f).lines.name, v.name);
  assert.equal(F.read(d, f).lines.affiliation, values.affiliation);
});

test('Chicago blocks a quotation at five lines, even below one hundred words', () => {
  const f = ST.FORMATS.chicago17;
  const d = node(F.template(f, v, [{ type: 'paragraph', content: [{ type: 'text', text: `She writes "${'quoted word '.repeat(20)}" here.` }] }]));
  const issue = F.check(d, f, ctx, { lines: () => 5 }).issues.find((i) => i.rule === 'block-quote');
  assert.ok(issue);
  assert.match(issue.message, /five lines/);
});

test('the Outline: the paper\'s title, its headings by level, and its list of sources, each where it starts', () => {
  const par = (text) => ({ type: 'paragraph', attrs: { align: null, indent: 0, line: null, first: null }, content: [{ type: 'text', text }] });
  const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const d = node(F.template(ST.FORMATS.mla9, v, [par('Body.'), h(1, 'Memory'), par('More.'), h(2, 'The river')]));
  const o = F.outline(d, ST.FORMATS.mla9);
  assert.deepEqual(o.map((x) => [x.kind, x.level, x.text]), [['title', 0, 'Essay 2'], ['heading', 1, 'Memory'], ['heading', 2, 'The river'], ['list', 0, 'Works Cited']]);
  for (const x of o) assert.equal(d.resolve(x.pos + 1).parent.textContent, x.text, `${x.text} starts at its pos`);
  const apa = node(F.template(ST.FORMATS.apa7, v));
  assert.deepEqual(F.outline(apa, ST.FORMATS.apa7).map((x) => [x.kind, x.text]), [['title', 'Essay 2'], ['list', 'References']]);
  assert.deepEqual(F.outline(node({ type: 'doc', content: [par('Only a paragraph.')] }), ST.FORMATS.mla9), [], 'nothing to outline');
});

test('an unheaded essay has an inferred introduction, body paragraphs and conclusion linked to its prose', () => {
  const paragraphs = [
    'School gardens give students a shared place to learn and work together.',
    'First, a garden connects classroom lessons with practical experiments. '.repeat(5),
    'Shared projects also teach students how to divide work and resolve disagreements.',
    'A garden can give the neighborhood a place to meet and exchange ideas.',
    'Taken together, these benefits make a school garden a lasting investment in the community.',
  ];
  const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  for (const id of ST.IDS) {
    const json = F.template(ST.FORMATS[id], { ...v, instructor: 'Prof. Okafor' }, paragraphs.map(p));
    const doc = node(json), before = JSON.stringify(doc.toJSON()), items = F.outline(doc, ST.FORMATS[id], { paragraphs: true });
    const sections = items.filter((x) => x.kind === 'section');
    assert.deepEqual(sections.map((x) => [x.text, x.number]), [['Introduction', undefined], ['Body {n}', 1], ['Body {n}', 2], ['Body {n}', 3], ['Conclusion', undefined]], id);
    assert.equal(items[0].kind, 'title'); assert.equal(items.at(-1).kind, 'list');
    sections.forEach((x, i) => {
      assert.equal(doc.resolve(x.pos + 1).parent.textContent, paragraphs[i], `${id}: navigates to paragraph ${i + 1}`);
      assert.ok(x.inferred && x.preview.length <= 161);
      assert.ok(!x.preview.includes('Prof.') && !x.preview.includes(v.course));
    });
    assert.equal(JSON.stringify(doc.toJSON()), before, 'inference never inserts headings into the document');
  }
});

test('authored headings take precedence, and an unheaded lead is one introduction', () => {
  const p = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
  const doc = node(F.template(ST.FORMATS.mla9, v, [p('An opening claim.'), p('Its background.'), h(1, 'Evidence'), p('Support for the claim.'), h(2, 'A contrasting view'), p('An alternative interpretation.')]));
  const items = F.outline(doc, ST.FORMATS.mla9, { paragraphs: true });
  assert.deepEqual(items.map((x) => [x.kind, x.text]), [['title', v.title], ['section', 'Introduction'], ['heading', 'Evidence'], ['heading', 'A contrasting view'], ['list', 'Works Cited']]);
});

test('inferred sections skip quotes, blank spacers and uncentered references; short drafts use paragraph labels', () => {
  const p = (text, attrs = {}) => ({ type: 'paragraph', attrs, ...(text ? { content: [{ type: 'text', text }] } : {}) });
  const doc = node({ type: 'doc', content: [p('A standalone title', { align: 'center' }), p('First claim.'), p(''),
    { type: 'blockquote', content: [p('Quoted evidence should not become another body section.')] }, p('Second claim.'), p('Final thought.'),
    p('Works Cited'), p('Rivera, Alex. A Sample Book. Example Press, 2026.')] });
  const items = F.outline(doc, ST.FORMATS.mla9, { paragraphs: true });
  assert.deepEqual(items.map((x) => x.text), ['A standalone title', 'Introduction', 'Body {n}', 'Conclusion', 'Works Cited']);
  assert.deepEqual(F.outline(node({ type: 'doc', content: [p('A short draft.'), p('Still developing.')] }), ST.FORMATS.mla9, { paragraphs: true }).map((x) => [x.text, x.number]), [['Paragraph {n}', 1], ['Paragraph {n}', 2]]);
  assert.deepEqual(F.outline(node({ type: 'doc', content: [p('')] }), ST.FORMATS.mla9, { paragraphs: true }), []);
});
