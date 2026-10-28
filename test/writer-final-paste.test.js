// Writer's final review, paste and editor commands: rich paste keeps a list's numbers, a heading's left alignment and text
// direction; every picture in a paper is one Word takes; commands reach every selected table cell; a paper's tabs survive
// its own HTML; a footnote is never cut inside its markup; the link field keeps the schema's one rule for addresses.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const P = require('../writer-paste.js');
const OBJ = require('../lib/writer-objects.js');

const read = (html) => S.paper.topNodeType.create(null, S.slice(S.paper, html).content);
const paste = (html, o) => read(P.normalize(html, o).html);
// Each ordered item's number as the page draws it: every list counts from 1, an item at a level counts on that level
// and starts the deeper ones again, and an item's start sets its own.
const numbers = (doc) => {
  const out = [];
  doc.forEach((list) => {
    if (list.type.name !== 'ordered_list') return;
    const styles = OBJ.levelStyles(list), count = [];
    list.forEach((li) => {
      const lv = li.attrs.indent || 0;
      count[lv] = li.attrs.start ?? (count[lv] || 0) + 1;
      count.length = lv + 1;
      out.push(`${OBJ.marker(styles[lv], count[lv])} ${li.textContent}`);
    });
  });
  return out;
};
const wordItem = (list, mark, text, level = 1) => `<p class=MsoListParagraph style='margin-left:${0.5 * level}in;text-indent:-.25in;mso-list:${list} level${level} ${list.replace('l', 'lfo')}'><![if !supportLists]><span style='mso-list:Ignore'>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>${text}<o:p></o:p></p>`;
const word = (body) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"></head><body lang=EN-US><div class=WordSection1>${body}</div></body></html>`;

test('A1: a pasted list keeps its opening number: <ol start>, and Word\'s own markers', () => {
  assert.deepEqual(numbers(paste('<html><body><ol start="4"><li>four</li><li>five</li></ol></body></html>')), ['4 four', '5 five']);
  assert.deepEqual(numbers(paste('<meta charset="utf-8"><b id="docs-internal-guid-1"><ol start="4"><li dir="ltr"><p dir="ltr"><span>four</span></p></li><li dir="ltr"><p dir="ltr"><span>five</span></p></li></ol></b>')), ['4 four', '5 five']);
  assert.deepEqual(numbers(paste(word(wordItem('l0', '4.', 'four') + wordItem('l0', '5.', 'five')))), ['4 four', '5 five']);
  // A list a paragraph interrupts goes on from Word's number.
  assert.deepEqual(numbers(paste(word(wordItem('l0', '1.', 'one') + '<p class=MsoNormal>Between<o:p></o:p></p>' + wordItem('l0', '2.', 'two')))), ['1 one', '2 two']);
  // The schema reads <ol start> itself too, where no paste normaliser stands in front.
  assert.deepEqual(numbers(read('<ol start="7"><li>seven</li><li>eight</li></ol>')), ['7 seven', '8 eight']);
  // A plain list is unchanged: no restart anywhere.
  const plain = paste('<html><body><ol><li>a</li><li>b</li></ol></body></html>');
  assert.deepEqual(numbers(plain), ['1 a', '2 b']);
  plain.descendants((n) => { if (n.type.name === 'list_item') assert.equal(n.attrs.start, null); });
});

test('A2: adjacent pasted lists stay two lists, each numbered as it was', () => {
  const two = paste(word(wordItem('l0', '1.', 'first A') + wordItem('l0', '2.', 'first B') + wordItem('l1', 'a)', 'second A') + wordItem('l1', 'b)', 'second B')));
  assert.deepEqual(numbers(two), ['1 first A', '2 first B', 'a second A', 'b second B']);
  assert.deepEqual(numbers(paste(word(wordItem('l0', '1.', 'A') + wordItem('l0', '2.', 'B') + wordItem('l1', '1.', 'C') + wordItem('l1', '2.', 'D')))), ['1 A', '2 B', '1 C', '2 D']);
  assert.deepEqual(numbers(paste('<html><body><ol><li>A</li><li>B</li></ol><ol><li>C</li><li>D</li></ol></body></html>')), ['1 A', '2 B', '1 C', '2 D']);
  // One Word list over two levels stays one list, its levels in their own styles.
  const nested = paste(word(wordItem('l0', '1.', 'top') + wordItem('l0', 'a.', 'sub', 2) + wordItem('l0', 'b.', 'sub two', 2) + wordItem('l0', '2.', 'top two')));
  assert.equal(nested.childCount, 1);
  assert.deepEqual(numbers(nested), ['1 top', 'a sub', 'b sub two', '2 top two']);
  assert.deepEqual(numbers(paste(word(wordItem('l0', 'I.', 'one') + wordItem('l0', 'II.', 'two')))), ['I one', 'II two']);
});

test('A3: a pasted heading keeps an explicit left alignment the format would centre; a paragraph\'s left stays the default', () => {
  assert.equal(paste('<html><body><h1 style="text-align:left">Left title</h1></body></html>').firstChild.attrs.align, 'left');
  assert.equal(paste('<html><body><h2 align="left">Left two</h2></body></html>').firstChild.attrs.align, 'left');
  assert.equal(paste(word("<h1 style='text-align:left'>Word left<o:p></o:p></h1>")).firstChild.attrs.align, 'left');
  assert.equal(paste('<html><body><h1 style="text-align:right">Right</h1></body></html>').firstChild.attrs.align, 'right');
  assert.equal(paste('<html><body><h1>Plain</h1></body></html>').firstChild.attrs.align, null);
  assert.equal(paste('<html><body><p style="text-align:left">Body</p></body></html>').firstChild.attrs.align, null);
  assert.equal(paste('<html><body><h1 style="text-align:left">Matched</h1></body></html>', { match: true }).firstChild.attrs.align, null, 'Match the paper takes it away');
});

test('A4: pasted text keeps its direction: a block\'s and a run\'s, from a page, Word and Docs', () => {
  const runDirs = (doc) => { const out = []; doc.descendants((n) => { if (n.isText) out.push([n.text, n.marks.find((m) => m.type.name === 'direction')?.attrs.dir ?? null]); }); return out; };
  assert.equal(paste('<html><body><p dir="rtl">مرحبا بالعالم</p></body></html>').firstChild.attrs.dir, 'rtl');
  assert.deepEqual(runDirs(paste('<html><body><p>English <span dir="rtl">مرحبا</span> end</p></body></html>')), [['English ', null], ['مرحبا', 'rtl'], [' end', null]]);
  const w = paste(word("<p class=MsoNormal dir=RTL style='text-align:right;direction:rtl;unicode-bidi:embed'><span lang=AR-SA dir=RTL>مرحبا</span></p>"));
  assert.equal(w.firstChild.attrs.dir, 'rtl');
  assert.deepEqual(runDirs(w), [['مرحبا', null]], 'a run in its paragraph\'s own direction needs no mark');
  assert.equal(paste('<meta charset="utf-8"><b id="docs-internal-guid-1"><p dir="rtl" style="text-align:right"><span>مرحبا</span></p></b>').firstChild.attrs.dir, 'rtl');
  assert.equal(paste('<html><body><ul><li dir="rtl">بند</li></ul></body></html>').firstChild.firstChild.attrs.dir, 'rtl');
  assert.deepEqual(runDirs(paste('<html><body><p dir="rtl">عربي <span dir="ltr">English</span></p></body></html>')), [['عربي ', null], ['English', 'ltr']]);
  // Docs marks every block ltr: that is the paper's own direction, so nothing is set and nothing counts as formatting.
  const docs = P.normalize('<meta charset="utf-8"><b id="docs-internal-guid-1"><p dir="ltr"><span>Plain</span></p></b>');
  assert.equal(read(docs.html).firstChild.attrs.dir, null);
  assert.equal(docs.rich, false);
  assert.equal(paste('<html><body><p dir="rtl">مطابق</p></body></html>', { match: true }).firstChild.attrs.dir, 'rtl', 'direction is the text\'s, not formatting Match the paper takes away');
});
