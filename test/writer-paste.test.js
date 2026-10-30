// Rich paste (writer-paste.js): Word's, Google Docs' and web pages' clipboard HTML normalised to what a paper holds, then
// read by the paper schema as paste reads it (S.slice); what "Match the paper" takes away; what is left as the format's.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const ST = require('../lib/writer-styles.js');
const P = require('../writer-paste.js');
const FX = require('./fixtures/writer-paste-html.js');

const read = (html, schema = S.paper) => schema.topNodeType.create(null, S.slice(schema, html).content);
const blocks = (doc) => { const out = []; doc.descendants((n, pos, parent) => { if (n.isTextblock) { out.push({ n, parent }); return false; } return true; }); return out; };
const block = (doc, needle) => blocks(doc).find((b) => b.n.textContent.includes(needle));
const marksOn = (doc, needle) => {
  let hit = null;
  doc.descendants((n) => { if (!hit && n.isText && n.text.includes(needle)) hit = n; return !hit; });
  assert.ok(hit, needle);
  return Object.fromEntries(hit.marks.map((m) => [m.type.name, Object.keys(m.attrs).length ? { ...m.attrs } : true]));
};

test('every fixture says what was seen and what was modelled', () => {
  for (const [k, f] of Object.entries(FX)) assert.match(f._note, /[Mm]odelled/, k);
});

test('sources: Word, Docs, a web page, Writer\'s own', () => {
  assert.equal(P.normalize(FX.word.html).source, 'word');
  assert.equal(P.normalize(FX.docs.html).source, 'docs');
  assert.equal(P.normalize(FX.web.html).source, 'web');
  const own = '<p data-pm-slice="1 1 []"><strong>mine</strong></p>';
  assert.deepEqual(P.normalize(own), { html: own, source: 'writer', rich: false });
});

test('rich paste refuses excessive size, tokens and nesting before normalizing', () => {
  for (const input of ['x'.repeat(S.MAX_INPUT + 1), '<b>x</b>'.repeat(31000), '<span>'.repeat(100) + 'keep all of this' + '</span>'.repeat(100)]) {
    assert.throws(() => P.normalize(input), (e) => e.code === 'WRITER_INPUT_LIMIT');
  }
});

test('Word: headings, marks, colour, highlight, caps, sizes, fonts, links; spacing, indents, keeps, breaks; lists; tables', () => {
  const r = P.normalize(FX.word.html, { base: { font: 'Times New Roman', size: 12 } });
  assert.equal(r.rich, true);
  const doc = read(r.html);
  const h = block(doc, 'A Heading From Word');
  assert.equal(h.n.type.name, 'heading');
  assert.equal(h.n.attrs.level, 1);
  assert.deepEqual(Object.keys(marksOn(doc, 'bold words')), ['bold']);
  assert.deepEqual(Object.keys(marksOn(doc, 'italic words')), ['italic']);
  assert.deepEqual(Object.keys(marksOn(doc, 'underlined words')), ['underline']);
  assert.deepEqual(Object.keys(marksOn(doc, 'struck words')), ['strike']);
  assert.deepEqual(marksOn(doc, 'red words'), { color: { color: 'C00000' } });
  assert.deepEqual(marksOn(doc, 'highlighted words'), { highlight: { color: 'yellow' } });
  assert.deepEqual(marksOn(doc, 'small caps words'), { small_caps: true });
  assert.deepEqual(marksOn(doc, 'capital words'), { all_caps: true });
  assert.deepEqual(marksOn(doc, 'larger words'), { text_style: { font: null, size: 14 } });
  assert.deepEqual(marksOn(doc, 'arial words'), { text_style: { font: 'Arial', size: null } });
  assert.deepEqual(Object.keys(marksOn(doc, 'a link')), ['link'], 'a link\'s own colour is the paper\'s, not a colour mark');
  assert.equal(marksOn(doc, 'a link').link.href, 'https://example.com/source');
  // Times New Roman 12 runs are the format's: no font or size mark on plain text.
  assert.deepEqual(marksOn(doc, 'E = mc'), {});
  const body = block(doc, 'E = mc');
  assert.equal(body.n.attrs.line, 2, 'line-height:200%');
  assert.equal(body.n.attrs.after, 8, 'MsoNormal\'s 8 pt after from the <style> block');
  const spaced = blocks(doc)[2].n.attrs;
  assert.deepEqual([spaced.before, spaced.after, spaced.exact, spaced.indent, spaced.left, spaced.right, spaced.first, spaced.keepNext], [12, 6, 18, 1, null, 0.5, -0.5, true]);
  const kids = doc.content.content.map((n) => n.type.name);
  const brk = kids.indexOf('page_break');
  assert.ok(brk > 0, 'page-break-before:always');
  assert.equal(doc.child(brk + 1).attrs.widow, false, 'mso-pagination:none');
  const ul = doc.content.content.find((n) => n.type.name === 'bullet_list'), ol = doc.content.content.find((n) => n.type.name === 'ordered_list');
  assert.deepEqual(ul.content.content.map((li) => [li.textContent, li.attrs.indent]), [['first bullet', 0], ['nested bullet', 1], ['second bullet', 0]]);
  assert.deepEqual(ol.content.content.map((li) => li.textContent), ['first step', 'second step']);
  assert.ok(!doc.textContent.includes('·'), 'the marker spans are gone');
  for (const li of [...ul.content.content, ...ol.content.content]) assert.deepEqual([li.attrs.left, li.attrs.first], [null, null], 'a list item\'s indent is the list\'s');
  const table = doc.content.content.find((n) => n.type.name === 'table');
  assert.ok(table);
  assert.equal(block(doc, 'right cell').n.attrs.align, 'center');
  assert.deepEqual(Object.keys(marksOn(doc, 'right cell')), ['bold']);
});

test('Docs: the guid wrapper isn\'t bold; 1.38 is 1.15 lines; black and transparent are no colour; lists by aria-level', () => {
  const r = P.normalize(FX.docs.html);
  assert.equal(r.rich, true);
  const doc = read(r.html);
  assert.equal(block(doc, 'A Heading From Docs').n.type.name, 'heading');
  const first = block(doc, 'bold words');
  assert.deepEqual(Object.keys(marksOn(doc, first.n.textContent.slice(0, 12))), ['text_style'], 'plain run: Arial 11 only');
  assert.deepEqual(marksOn(doc, first.n.textContent.slice(0, 12)).text_style, { font: 'Arial', size: 11 });
  assert.deepEqual(Object.keys(marksOn(doc, 'bold words')).sort(), ['bold', 'text_style']);
  assert.deepEqual(Object.keys(marksOn(doc, 'italic words')).sort(), ['italic', 'text_style']);
  const red = marksOn(doc, 'red highlighted words');
  assert.deepEqual([red.color, red.highlight], [{ color: '980000' }, { color: 'yellow' }]);
  assert.deepEqual(Object.keys(marksOn(doc, 'a link')).sort(), ['link', 'text_style']);
  assert.ok(marksOn(doc, '1').sup, 'vertical-align:super');
  assert.equal(first.n.attrs.line, 1.15);
  assert.equal(first.n.attrs.after, 0, 'margin-bottom:0pt kept as the source says (tidy drops it where the format agrees)');
  const second = blocks(doc).find((b) => b.n.attrs.first != null);
  assert.deepEqual([second.n.attrs.first, second.n.attrs.after], [0.5, 8]);
  const ul = doc.content.content.find((n) => n.type.name === 'bullet_list');
  assert.deepEqual(ul.content.content.map((li) => [li.textContent, li.attrs.indent]), [['first item', 0], ['nested item', 1]]);
  assert.ok(doc.content.content.some((n) => n.type.name === 'ordered_list'));
  const cell = block(doc, 'cell one');
  assert.equal(cell.n.attrs.line, 1, 'line-height:1.2 is single');
  assert.ok(doc.content.content.some((n) => n.type.name === 'table'));
});

test('a web page: its fonts that aren\'t the paper\'s go, colours and marks stay, layout CSS goes', () => {
  const doc = read(P.normalize(FX.web.html).html);
  assert.equal(block(doc, 'A Heading From The Web').n.type.name, 'heading');
  const p = block(doc, 'strong words').n;
  assert.deepEqual([p.attrs.line, p.attrs.after, p.attrs.before, p.attrs.first], [null, null, null, null], 'a site\'s line-height and margins aren\'t the paper\'s');
  assert.deepEqual(marksOn(doc, 'strong words').bold, true);
  assert.equal(marksOn(doc, 'marked words').highlight.color, 'yellow');
  assert.equal(marksOn(doc, 'crimson words').color.color, 'DC143C');
  assert.equal(marksOn(doc, 'a link').color, undefined);
  assert.equal(marksOn(doc, p.textContent.slice(0, 10)).color, undefined, 'rgb(51,51,51) body text is near black: automatic');
  assert.equal(marksOn(doc, 'strong words').text_style?.font ?? null, null, 'Georgia isn\'t a paper font');
  assert.deepEqual(doc.content.content.find((n) => n.type.name === 'bullet_list').content.content.map((li) => li.textContent), ['web one', 'web two']);
});

test('match: only the structure and the marks that are the writer\'s own stay', () => {
  for (const f of [FX.word, FX.docs, FX.web]) {
    const doc = read(P.normalize(f.html, { match: true }).html);
    doc.descendants((n) => {
      if (n.isText) for (const m of n.marks) assert.ok(['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'link'].includes(m.type.name), `${m.type.name} kept`);
      if (n.isTextblock) for (const k of ['line', 'first', 'before', 'after', 'exact', 'least', 'left', 'right', 'tabs', 'keepNext', 'keepLines', 'widow', 'align']) assert.equal(n.attrs[k] ?? null, null, k);
      return true;
    });
    assert.equal(P.normalize(f.html, { match: true }).rich, false);
  }
});

test('strip and tidy over a pasted range, on a transaction', () => {
  const doc = read(P.normalize(FX.word.html).html);
  const { Transform } = GZ_PM.transform;
  const tr = new Transform(doc);
  P.strip(tr, 0, doc.content.size);
  tr.doc.descendants((n) => {
    if (n.isText) for (const m of n.marks) assert.ok(['bold', 'italic', 'underline', 'strike', 'sup', 'sub', 'link'].includes(m.type.name), m.type.name);
    if (n.isTextblock) assert.equal(n.attrs.line ?? null, null);
    return true;
  });
  // tidy: what equals the paper's own (its font and size, its spacing) is left unmarked.
  const d2 = read(P.normalize(FX.docs.html).html), L = ST.look(ST.FORMATS.mla9, { ...ST.pageSetup(ST.FORMATS.mla9), font: 'Arial', size: 11, own: false });
  const t2 = new Transform(d2);
  P.tidy(t2, 0, d2.content.size, L);
  let marked = 0;
  t2.doc.descendants((n) => { if (n.isText && n.marks.some((m) => m.type.name === 'text_style' && (m.attrs.font || m.attrs.size === 11))) marked++; return true; });
  assert.equal(marked, 0, 'Arial 11 on an Arial 11 paper: no marks');
});

test('compose keeps what Quill holds from a Word paste: lists by their markers, marks', () => {
  const doc = read(P.normalize(FX.word.html).html, S.compose);
  assert.ok(doc.content.content.some((n) => n.type.name === 'bullet_list'));
  assert.ok(!doc.textContent.includes('·'));
  assert.deepEqual(Object.keys(marksOn(doc, 'bold words')), ['bold']);
});

test('rich paste keeps the alternative text of pictures it cannot embed', () => {
  for (const src of ['https://example.com/chart.png', 'file:///private/chart.png', 'cid:chart']) {
    const doc = read(P.normalize(`<p>Before <img src="${src}" alt="A &amp; B &lt;chart&gt;"> after</p>`).html);
    assert.equal(doc.textContent, 'Before A & B <chart> after');
    assert.equal(doc.firstChild.content.content.some((n) => n.type.name === 'image'), false);
  }
});

test('pasted headings retain source emphasis and mixed bold text', () => {
  const doc = read(P.normalize('<h1 style="font-weight:normal;font-style:italic">Plain <strong>bold</strong></h1>').html);
  assert.equal(doc.firstChild.attrs.weight, 'normal');
  assert.equal(doc.firstChild.attrs.slant, 'normal', 'source emphasis is carried by the runs');
  assert.equal(marksOn(doc, 'Plain').italic, true);
  assert.equal(marksOn(doc, 'Plain').bold, undefined);
  assert.equal(marksOn(doc, 'bold').bold, true);
  assert.equal(marksOn(doc, 'bold').italic, true);
  const bare = read(P.normalize('<h1>Default heading</h1>').html);
  assert.equal(marksOn(bare, 'Default heading').bold, true, 'bare HTML headings retain browser bold emphasis');
});

// Legibility (lib/writer-color.js): a run's colour stays only where the paper shows it, on its highlight or else the white
// page, at 1.6:1 or more. Word's clipboard as it writes shading (background beside mso-shading and mso-pattern), cell and
// page colours (bgcolor) and theme colours (mso-themecolor beside the hex).
const fromWord = (body, page = '') => `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=ProgId content=Word.Document></head><body lang=EN-US${page}><div class=WordSection1>${body}</div></body></html>`;
const runOf = (html, needle) => marksOn(read(P.normalize(html).html), needle);

test('legibility: light text on a dark paragraph shading, cell or page takes the paper\'s ink, and the shading stays dropped', () => {
  const shaded = fromWord(`<p class=MsoNormal style='background:#1F1F1F;mso-shading:white;mso-pattern:solid #1F1F1F'><span style='color:white'>shaded white</span> <span style='color:#FFFFCC'>pale yellow</span> <span style='color:#C00000'>dark red</span></p>`);
  assert.deepEqual(runOf(shaded, 'shaded white'), {});
  assert.deepEqual(runOf(shaded, 'pale yellow'), {});
  assert.deepEqual(runOf(shaded, 'dark red'), { color: { color: 'C00000' } }, 'legible on the page: kept');
  const cell = fromWord(`<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0><tr><td width=312 valign=top bgcolor="#262626" style='background:#262626;mso-shading:white;mso-pattern:solid #262626;padding:0in 5.4pt 0in 5.4pt'><p class=MsoNormal><span style='color:white;mso-themecolor:background1'>cell white</span></p></td></tr></table>`);
  assert.deepEqual(runOf(cell, 'cell white'), {});
  const page = fromWord(`<p class=MsoNormal><span style='color:#F2F2F2'>page white</span></p>`, ' bgcolor="#0E2841" style=\'tab-interval:.5in\'');
  assert.deepEqual(runOf(page, 'page white'), {});
  assert.deepEqual(runOf(fromWord(`<p class=MsoNormal><span style='color:white'>already invisible</span></p>`), 'already invisible'), {}, 'white on white in Word: visible on the paper');
});

test('legibility: Word\'s theme text and page colours are the paper\'s ink; accents and tints keep their hex', () => {
  const html = fromWord(`<p class=MsoNormal><span style='color:#1F1F1F;mso-themecolor:background1'>dark page colour</span> <span style='color:#262626;mso-themecolor:text1'>theme text</span> <span style='color:#44546A;mso-themecolor:text2'>theme text two</span> <span style='color:#4472C4;mso-themecolor:accent1'>accent words</span> <span style='color:#595959;mso-themecolor:text1;mso-themetint:166'>tinted text</span></p>`);
  assert.deepEqual(runOf(html, 'dark page colour'), {});
  assert.deepEqual(runOf(html, 'theme text two'), {});
  assert.deepEqual(runOf(html, 'theme text'), {});
  assert.deepEqual(runOf(html, 'accent words'), { color: { color: '4472C4' } });
  assert.deepEqual(runOf(html, 'tinted text'), { color: { color: '595959' } }, 'a tint or shade of text1 is a colour of its own');
  const inner = fromWord(`<p class=MsoNormal><span style='color:white;mso-themecolor:background1'>outer <span style='color:#C00000'>inner red</span></span></p>`);
  assert.deepEqual(runOf(inner, 'inner red'), { color: { color: 'C00000' } }, 'a theme hint goes with the colour beside it, not a child\'s own');
});

test('legibility: Automatic is no colour; a colour is read against the highlight it gets', () => {
  const html = fromWord(`<p class=MsoNormal><span style='color:windowtext'>window text</span> <span style='color:auto'>auto text</span> <span style='background:navy;mso-highlight:navy;color:white'>white on navy</span> <span style='background:yellow;mso-highlight:yellow;color:#FFFF00'>yellow on yellow</span></p>`);
  assert.deepEqual(runOf(html, 'window text'), {});
  assert.deepEqual(runOf(html, 'auto text'), {});
  assert.deepEqual(runOf(html, 'white on navy'), { color: { color: 'FFFFFF' }, highlight: { color: 'darkBlue' } });
  assert.deepEqual(runOf(html, 'yellow on yellow'), { highlight: { color: 'yellow' } });
  const bright = fromWord(`<p class=MsoNormal><span style='color:#FFA500'>orange</span> <span style='color:#D9D9D9'>pale grey</span></p>`);
  assert.deepEqual(runOf(bright, 'orange'), { color: { color: 'FFA500' } }, 'orange on white (1.97:1) keeps its colour');
  assert.deepEqual(runOf(bright, 'pale grey'), {}, 'a pale grey (1.4:1) is the paper\'s ink');
  const web = `<p style="background-color: rgb(30, 30, 30); color: rgb(230, 230, 230);">dark mode page</p>`;
  assert.deepEqual(runOf(web, 'dark mode page'), {}, 'a dark-mode site\'s light text');
});


test('transparent and translucent paste colours become visible ink on the retained surface', () => {
  assert.deepEqual(runOf('<p style="color:transparent">visible</p>', 'visible'), {});
  assert.deepEqual(runOf('<p style="color:rgba(0,0,0,.05)">pale alpha</p>', 'pale alpha'), {});
  assert.deepEqual(runOf('<p style="color:rgba(192,0,0,.5)">half red</p>', 'half red'), { color: { color: 'E08080' } });
  assert.deepEqual(runOf('<p><span style="background:navy;color:rgba(255,255,255,50%)">half white</span></p>', 'half white'), { color: { color: '8080C0' }, highlight: { color: 'darkBlue' } });
  assert.deepEqual(runOf('<body style="background:#111;color:#eeeeee"><table><tr><td style="background:#fff"><p>light cell</p></td></tr></table></body>', 'light cell'), {});
});

test('Writer copy and paste retains explicit black, pale and tinted colours exactly', () => {
  const original = S.parse(S.paper, '<p><span data-gz-color="000000">black</span><span data-gz-color="D9D9D9">pale</span><span data-gz-color="4472C4">accent</span></p>');
  const html = S.serialize(S.paper, original);
  assert.equal(S.serialize(S.paper, read(P.normalize(html.replace('<p>', '<p data-pm-slice="1 1 []">')).html)), html);
});


test('automatic or rejected paste ink remains legible on every retained highlighter', () => {
  const C = require('../lib/color.js');
  for (const [name, on] of Object.entries(S.HIGHLIGHT)) {
    for (const color of ['windowtext', 'transparent', 'black', 'white', on]) {
      const marks = runOf(`<p><span style="background:${on};color:${color}">band</span></p>`, 'band');
      assert.equal(marks.highlight?.color, name === 'white' ? undefined : name);
      const ink = `#${marks.color?.color || '111111'}`;
      assert.ok(C.contrast(ink, on) >= 1.6, `${name}: ${ink} on ${on}, ${C.contrast(ink, on)}:1`);
    }
  }
});
