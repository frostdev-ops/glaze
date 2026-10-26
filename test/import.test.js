// PDF and picture import (W23). lib/doctext.js's helpers for them; features/import.js handing a file to the reader's
// frame; then every fixture in test/fixtures/import (made by scripts/import-fixtures.js and scripts/import-check.js;
// none is a real student's) through the code the reader runs: pdf.js (lib/pdfjs) for PDFs, the OCR worker itself
// (lib/ocr.js, in a vm with a worker's globals) for pictures and scanned pages, and each import flow's extractor
// (lib/classes.js, lib/syllabus.js, lib/gpa.js). A fixture's accuracy is the share of its known fields the extractor
// got exactly right. Each is printed and must not fall below what was measured when this was written (ACCURACY).
// What the reader does in a browser (decoding pictures, drawing scanned pages, the frame) is scripts/import-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const D = require('../lib/doctext.js');

const root = path.join(__dirname, '..');
const fixture = (f) => fs.readFileSync(path.join(__dirname, 'fixtures/import', f));
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ---- the helpers ---------------------------------------------------------------------------------------------------
test('kind: by the first bytes where they say, else by name and type', () => {
  assert.equal(D.kind('notes.txt', 'text/plain', ascii('%PDF-1.7\n')), 'pdf', 'a PDF with the wrong name still reads');
  assert.equal(D.kind('scan', '', fixture('timetable-photo.jpg').subarray(0, 16)), 'image');
  assert.equal(D.kind('x', '', fixture('timetable.png').subarray(0, 16)), 'image');
  assert.equal(D.kind('x', '', fixture('timetable.webp').subarray(0, 16)), 'image');
  assert.equal(D.kind('IMG_0001.HEIC', '', ascii('\0\0\0\x18ftypheic\0\0\0\0')), 'image');
  assert.equal(D.kind('a.avif', '', ascii('\0\0\0\x1cftypavif')), 'image');
  assert.equal(D.kind('Transcript.PDF', ''), 'pdf');
  assert.equal(D.kind('photo', 'image/heic'), 'image');
  assert.equal(D.kind('s.docx', '', ascii('PK\x03\x04')), 'docx');
  assert.equal(D.kind('s.pptx', ''), 'pptx');
  assert.equal(D.kind('page.HTM', ''), 'html');
  assert.equal(D.kind('notes.md', ''), 'text');
  assert.equal(D.kind('data.xlsx', ''), '');
});

test('imageSize: from the header, before decoding', () => {
  assert.deepEqual(D.imageSize(fixture('timetable.png')), { w: 860, h: 600 });
  assert.deepEqual(D.imageSize(fixture('timetable.webp')), { w: 860, h: 600 });
  assert.deepEqual(D.imageSize(fixture('timetable-photo.jpg')), { w: 860, h: 600 });
  const b = (n, ...xs) => { const u = new Uint8Array(n); xs.forEach(([at, v]) => u.set(v, at)); return u; };
  assert.deepEqual(D.imageSize(b(10, [0, ascii('GIF89a')], [6, [0x20, 0x03, 0x58, 0x02]])), { w: 800, h: 600 });
  assert.deepEqual(D.imageSize(b(26, [0, ascii('BM')], [18, [0x40, 0x1f, 0, 0]], [22, [0x30, 0xe8, 0xff, 0xff]])), { w: 8000, h: 6096 }, 'a BMP stored top-down');
  // A JPEG whose frame header comes after a big EXIF block (a phone's thumbnail).
  const jpeg = b(70010, [0, [0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]], [65539, [0xff, 0xc0, 0, 17, 8, 0x0b, 0xd0, 0x0f, 0xc0]]);
  assert.deepEqual(D.imageSize(jpeg), { w: 4032, h: 3024 });
  // HEIC: a grid's whole picture (the largest 'ispe' in its 'meta' box), not a 512-pixel tile's, nor four bytes of the
  // picture data after it that happen to spell 'ispe'.
  const heic = b(160, [0, [0, 0, 0, 16]], [4, ascii('ftypheic')], [16, [0, 0, 0, 104]], [20, ascii('meta')],
    [40, ascii('ispe')], [48, [0, 0, 2, 0, 0, 0, 2, 0]], [80, ascii('ispe')], [88, [0, 0, 0x0f, 0xc0, 0, 0, 0x0b, 0xd0]],
    [120, [0, 0, 0, 40]], [124, ascii('mdat')], [128, ascii('ispe')], [136, [0, 0, 0x7f, 0xff, 0, 0, 0x7f, 0xff]]);
  assert.deepEqual(D.imageSize(heic), { w: 4032, h: 3024 });
  assert.equal(D.imageSize(b(40, [0, [0, 0, 0, 16]], [4, ascii('ftypheic')], [16, [0, 0, 0, 24]], [20, ascii('mdat')])), null, 'no meta box: no size');
  assert.equal(D.imageSize(ascii('%PDF-1.7')), null);
  assert.equal(D.imageSize(b(30, [0, [0xff, 0xd8, 0x00]])), null, 'a broken JPEG says nothing');
});

test('pgm: grey on white paper, a mostly dark picture turned around, a small one twice the size', () => {
  const px = (...rgba) => Uint8ClampedArray.from(rgba);
  const head = (p) => new TextDecoder().decode(p.subarray(0, p.indexOf(10, p.indexOf(10, 3) + 1) + 1));
  const row = (p) => [...p.subarray(head(p).length, head(p).length + 6)]; // the first of two rows, 3 pixels made 6
  const light = D.pgm(px(255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255), 3, 1);
  assert.equal(head(light), 'P5\n6 2\n255\n');
  assert.deepEqual(row(light), [255, 255, 255, 191, 64, 0]);
  assert.deepEqual(row(D.pgm(px(20, 20, 20, 255, 230, 230, 230, 255, 20, 20, 20, 255), 3, 1)), [235, 183, 78, 78, 183, 235], 'dark theme: light text becomes dark ink');
  assert.deepEqual(row(D.pgm(px(0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0), 3, 1)), [255, 191, 64, 64, 191, 255], 'transparent is paper');
  assert.equal(head(D.pgm(new Uint8ClampedArray(2000 * 4).fill(255), 2000, 1)), 'P5\n2000 1\n255\n', 'a big one as it is');
});

test('pdfText: runs in drawing order; a new line, a tab across a cell gap, a space across a word gap', () => {
  // y up, as in a PDF; the page's viewport flips it.
  const run = (str, x, y, width, size = 10, hasEOL = false) => ({ str, transform: [size, 0, 0, size, x, y], width, hasEOL });
  const page = { vt: [1, 0, 0, -1, 0, 792], items: [
    run('Course', 50, 700, 30), run(' ', 80, 700, 40), run('Title', 120, 700, 22), { type: 'beginMarkedContent' },
    run('BIO', 50, 685, 16), run('1100', 68, 685, 20), run('Biology', 120, 685, 35, 10, true),
    run('', 0, 0, 0, 0, true),
    run('Two columns: the right one', 320, 700, 120), run('starts a line, not a cell.', 50, 600, 110),
  ] };
  assert.equal(D.pdfText([page]), 'Course\tTitle\nBIO 1100\tBiology\nTwo columns: the right one\nstarts a line, not a cell.');
  assert.equal(D.pdfText([page, { items: [run('Page two', 50, 700, 40)] }]).split('\n\n')[1], 'Page two', 'pages are split by a blank line');
  // A page turned a quarter: its text reads across the page as shown.
  const turned = { vt: [0, 1, 1, 0, 0, 0], items: [{ str: 'Fall', transform: [0, 10, -10, 0, 700, 50], width: 20 }, { str: '2025', transform: [0, 10, -10, 0, 700, 73], width: 22 }] };
  assert.equal(D.pdfText([turned]), 'Fall 2025');
});

test('ocrText: lines, cells by their gaps, slips mended, and how sure it was', () => {
  let y = 10;
  const word = (text, x0, x1, confidence = 95) => ({ text, confidence, bbox: { x0, y0: y, x1, y1: y + 14 } });
  const line = (...words) => { y += 24; return { bbox: { x0: 0, y0: words[0].bbox.y0, x1: 500, y1: words[0].bbox.y1 }, words }; };
  const r = D.ocrText({ blocks: [{ paragraphs: [{ lines: [
    line(word('MATH', 0, 40), word('1350', 46, 80), word('Calculus', 120, 180), word('|', 186, 190, 60), word('©', 200, 204, 20)),
    line(word('‘Principles', 0, 80, 40), word('MTWR_', 100, 150)),
    line(word('Chemistry', 0, 70), word('||', 76, 82)),
    line(word('=', 0, 5, 10)),
  ] }] }] });
  assert.equal(r.text, 'MATH 1350\tCalculus I\nPrinciples\tMTWR\nChemistry II');
  assert.deepEqual(r.unsure, ['MATH 1350\tCalculus I', 'Principles\tMTWR']);
  assert.equal(r.conf, Math.round((95 * 3 + 60 + 40 + 95 + 95 + 95) / 8));
  assert.deepEqual(D.ocrText({}), { text: '', conf: 0, unsure: [] });
});

test('ocrText: a line it mends is reported unsure as mended, so the review still marks what came from it', () => {
  const word = (text, x0, confidence = 95) => ({ text, confidence, bbox: { x0, y0: 10, x1: x0 + 6 * text.length, y1: 24 } });
  const line = (...words) => ({ bbox: { x0: 0, y0: 6, x1: 500, y1: 40 }, words });
  let x = 0;
  const words = ['Office', 'hours:', 'Monday', '11:00', 'AM', '12:15', 'PM'].map((w) => { const r = word(w, x, w === '11:00' ? 40 : 95); x += 6 * w.length + 6; return r; });
  const r = D.ocrText({ blocks: [{ paragraphs: [{ lines: [line(...words)] }] }] });
  assert.equal(r.text, 'Office hours: Monday 11:00 AM - 12:15 PM', 'the lost dash between two times is put back');
  assert.deepEqual(r.unsure, [r.text]);
  // The syllabus reads its office hours from that line (lib/syllabus.js, which scripts/import-truth.js loads with the
  // class-time reader it needs); the field from it is marked.
  require('../scripts/import-truth.js');
  const src = require('../lib/syllabus.js').extract(r.text).hours[0].src;
  assert.ok(importer().I.doubt(r, src), `"${src}" is one of the unsure lines`);
});

// The engine's JSON as it gives it (blocks → paragraphs → lines → words { text, confidence, bbox }), one engine line
// per [[text, x0, x1, y0, y1, confidence?], …]; coordinates as on the picture it read, twice the size of the original.
const engineJson = (...blocks) => {
  const box = (bs) => ({ x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) });
  const conf = (xs) => Math.round(xs.reduce((a, x) => a + x.confidence, 0) / xs.length);
  return { page_id: 'page_1', blocks: blocks.map((lines) => {
    const ls = lines.map((ws) => {
      const words = ws.map(([text, x0, x1, y0, y1, confidence = 95]) => ({ text, confidence, bbox: { x0, y0, x1, y1 }, choices: [{ text, confidence }], font_name: '' }));
      return { text: `${words.map((w) => w.text).join(' ')}\n`, confidence: conf(words), bbox: box(words.map((w) => w.bbox)), words };
    });
    const p = { text: ls.map((l) => l.text).join(''), confidence: conf(ls), bbox: box(ls.map((l) => l.bbox)), is_ltr: true, lines: ls };
    return { text: p.text, confidence: p.confidence, bbox: p.bbox, blocktype: 1, paragraphs: [p] };
  }) };
};

test('ocrText: preserves the engine reading order of separate prose columns', () => {
  const columns = [
    [[['Read', 20, 60, 20, 40], ['this', 65, 100, 20, 40]], [['column', 20, 90, 50, 70], ['first.', 95, 150, 50, 70]]],
    [[['Then', 300, 350, 20, 40], ['read', 355, 400, 20, 40]], [['this', 300, 340, 50, 70], ['column.', 345, 420, 50, 70]]],
  ];
  const blocks = engineJson(...columns);
  const expected = 'Read this\ncolumn first.\nThen read\nthis column.';
  assert.equal(D.ocrText(blocks).text, expected);
  // The same columns can be paragraphs of one engine block.
  assert.equal(D.ocrText({ blocks: [{ paragraphs: blocks.blocks.flatMap((b) => b.paragraphs) }] }).text, expected);
});

test('ocrText: preserves RTL and mixed direction word order', () => {
  for (const words of [
    [['مرحبا', 240, 300, 20, 40], ['بكم', 180, 230, 20, 40]],
    [['ציון', 260, 300, 20, 40], ['C', 230, 240, 20, 40, 40], ['10', 180, 200, 20, 40]],
  ]) {
    const json = engineJson([words]);
    json.blocks[0].paragraphs[0].is_ltr = false;
    const r = D.ocrText(json);
    assert.equal(r.text, words.map((w) => w[0]).join(' '));
    assert.deepEqual(r.unsure, words.some((w) => w[5] < 65) ? [r.text] : []);
  }
});

test('ocrText: preserves engine lines on skewed and quarter turned pages', () => {
  for (const slope of [-0.2, 0.2]) {
    const json = engineJson(Array.from({ length: 3 }, (_, i) => Array.from({ length: 4 }, (_, k) =>
      [`row${i}word${k}`, k * 100, k * 100 + 90, 100 + i * 35 + slope * k * 100, 120 + i * 35 + slope * k * 100])));
    for (const [i, line] of json.blocks[0].paragraphs[0].lines.entries()) {
      line.baseline = { x0: 0, y0: 120 + i * 35, x1: 390, y1: 120 + i * 35 + slope * 390 };
    }
    assert.equal(D.ocrText(json).text, Array.from({ length: 3 }, (_, i) => Array.from({ length: 4 }, (_, k) => `row${i}word${k}`).join(' ')).join('\n'));
  }
  const turned = engineJson([
    [['First', 100, 120, 100, 160], ['line', 100, 120, 170, 220]],
    [['Second', 70, 90, 100, 170], ['line', 70, 90, 180, 230]],
  ]);
  for (const line of turned.blocks[0].paragraphs[0].lines) line.baseline = { x0: line.bbox.x0, x1: line.bbox.x0, y0: 100, y1: 230 };
  assert.equal(D.ocrText(turned).text, 'First line\nSecond line');
});

test('ocrText: keeps large single letters and numbers as text instead of icons', () => {
  for (const heading of ['A', 'I', 'C', '10', '1a', 'An']) {
    const r = D.ocrText(engineJson([
      [[heading, 20, 100, 20, 100, 60]],
      [['Read', 20, 60, 130, 150], ['the', 65, 95, 130, 150], ['instructions.', 100, 200, 130, 150]],
    ]));
    assert.equal(r.text, `${heading}\nRead the instructions.`, heading);
    assert.deepEqual(r.unsure, [heading]);
    assert.equal(r.conf, 86);
  }
});

test('ocrText: keeps uncertain grades and short words in joined rows', () => {
  for (const value of ['A', 'I', 'C', '10', '1a', 'an', 'to']) {
    const r = D.ocrText(engineJson([
      [['Course', 20, 90, 14, 34], ['First', 200, 250, 0, 20]],
      [['Second', 200, 270, 25, 45], [value, 400, 420, 14, 34, 40]],
    ]));
    assert.equal(r.text, `Course\tFirst Second\t${value}`, value);
    assert.deepEqual(r.unsure, [r.text]);
    assert.equal(r.conf, 81);
  }
});

test('ocrText: keeps small conjunctions and plus signs outside bulleted table lists', () => {
  for (const word of ['e', 'o', '+']) {
    const r = D.ocrText(engineJson([[[word, 20, 30, 30, 40, 60], ['Material', 46, 140, 20, 40]] ]));
    assert.equal(r.text, `${word} Material`);
    assert.deepEqual(r.unsure, [r.text]);
  }
});

test('ocrText: confidence describes the words retained in a joined row', () => {
  const r = D.ocrText(engineJson([
    [['Course', 20, 90, 14, 34], ['e', 180, 188, 10, 20, 0], ['First', 200, 250, 0, 20]],
    [['e', 180, 188, 35, 45, 0], ['Second', 200, 270, 25, 45]],
  ]));
  assert.equal(r.text, 'Course\tFirst · Second');
  assert.deepEqual(r.unsure, []);
  assert.equal(r.conf, 95, 'discarded bullet guesses are not recognized words');
});

test('ocrText: a table row whose cells are several lines, or centred in it, is one line; level rows and a paragraph stay lines', () => {
  // A course calendar laid out as the engine reads it in one block: the week's dates centred in their cell, so the
  // engine puts them on a line with the second line of the cells beside them, or on a line of their own; bullets read
  // as "e"; the week's number in a coloured disc read as a tall "Ge"; specks.
  const r = D.ocrText(engineJson([
    [['Week', 260, 340, 352, 387], ['&', 355, 370, 352, 386], ['Dates', 385, 470, 353, 387], ['Topics', 1175, 1290, 352, 387], ['Work', 2146, 2230, 352, 387]],
    [['Unit', 760, 830, 472, 503], ['1', 845, 860, 473, 503], ['e', 1897, 1913, 481, 496, 80], ['Reading', 1940, 2070, 473, 504], ['quiz', 2085, 2150, 473, 512]],
    [['Ge', 98, 214, 455, 570, 74], ['Sep.', 260, 330, 509, 540], ['7', 352, 372, 509, 540], ['–', 386, 404, 524, 528], ['13', 416, 453, 509, 540],
      ['Chapter', 760, 890, 528, 559], ['2:', 905, 930, 528, 559], ['Cells', 945, 1030, 528, 559],
      ['e', 1897, 1913, 536, 552, 88], ['Lab', 1940, 2000, 528, 559], ['report', 2015, 2120, 528, 566], ['#1:', 2135, 2190, 528, 559], ['Microscopes', 2205, 2420, 528, 566]],
    [['Unit', 760, 830, 670, 701], ['2', 845, 860, 670, 701], ['e', 1897, 1913, 650, 666], ['Problem', 1940, 2080, 642, 673], ['set', 2095, 2150, 642, 673], ['1', 2165, 2180, 642, 673]],
    // A cell's border read as two words the engine was unsure of.
    [['E', 2101, 2120, 661, 714, 63], ['e', 1897, 1913, 705, 721], ['Midterm', 1940, 2090, 697, 728], ['exam', 2105, 2190, 697, 728], ['ae', 2336, 2380, 709, 723, 47]],
    [['Sep.', 260, 330, 707, 738], ['14', 352, 390, 707, 738], ['–', 404, 422, 722, 726], ['20', 436, 473, 707, 738], ['Chapter', 760, 890, 725, 756], ['3:', 905, 930, 725, 756], ['Energy', 945, 1060, 725, 763]],
    [['e', 1897, 1913, 760, 776], ['Essay', 1940, 2030, 752, 783], ['outline', 2045, 2160, 752, 783], ['due', 2175, 2235, 752, 783]],
  ], [
    // A timetable's rows close together but each level across: two lines.
    [['BIO', 100, 160, 900, 931], ['1100', 175, 250, 900, 931], ['Biology', 760, 880, 900, 938], ['MWF', 1940, 2020, 900, 931]],
    [['CHEM', 100, 190, 935, 966], ['1210', 205, 280, 935, 966], ['Chemistry', 760, 920, 935, 973], ['TR', 1940, 1980, 935, 966]],
  ], [
    // A paragraph, its lines close together: three lines.
    [['Late', 322, 390, 1100, 1130], ['work', 405, 480, 1100, 1130], ['loses', 495, 580, 1100, 1130], ['ten', 595, 650, 1100, 1130], ['points', 665, 770, 1100, 1137]],
    [['a', 322, 340, 1135, 1165], ['day,', 355, 420, 1135, 1172], ['up', 435, 470, 1135, 1172], ['to', 485, 515, 1135, 1165], ['five', 530, 600, 1135, 1165]],
    [['days.', 322, 410, 1170, 1200]],
  ]));
  assert.equal(r.text, [
    'Week & Dates\tTopics\tWork',
    'Sep. 7 – 13\tUnit 1 Chapter 2: Cells\tReading quiz · Lab report #1: Microscopes',
    'Sep. 14 – 20\tUnit 2 Chapter 3: Energy\tProblem set 1 · Midterm exam · Essay outline due',
    'BIO 1100\tBiology\tMWF',
    'CHEM 1210\tChemistry\tTR',
    'Late work loses ten points',
    'a day, up to five',
    'days.',
  ].join('\n'));
  assert.deepEqual(r.unsure, [], 'the icon is no word, so it makes nothing unsure');
  // The syllabus reads a row's date with what is due on the same line (lib/syllabus.js is line by line).
  require('../scripts/import-truth.js');
  const dates = require('../lib/syllabus.js').extract(r.text, { start: Date.UTC(2026, 8, 7), hint: 'en' }).dates;
  assert.ok(dates.some((d) => /Lab report #1/.test(d.title)), JSON.stringify(dates));
  assert.ok(dates.some((d) => /Midterm exam/.test(d.title)), JSON.stringify(dates));
});

test('ocrText: a chart\'s label over its value is one line; a table\'s column of values is not', () => {
  // A pie chart read in sparse blocks: a title, then each label's words over its value; one label level with another's
  // value on the other side of the pie.
  const chart = D.ocrText(engineJson(
    [[['GRADE', 343, 486, 44, 82], ['BREAKDOWN', 503, 800, 44, 82]]],
    [[['Projects', 234, 400, 140, 164]]], [[['40%', 291, 353, 188, 212]]],
    [[['Weekly', 92, 200, 344, 370]]], [[['quizzes', 60, 230, 392, 422]]], [[['25%', 108, 170, 440, 464]]],
    [[['Final', 944, 1030, 436, 462], ['exam', 1045, 1150, 436, 462]]], [[['35%', 997, 1060, 484, 508]]],
  ));
  assert.equal(chart.text, 'GRADE BREAKDOWN\nProjects 40%\nWeekly quizzes 25%\nFinal exam 35%');
  const S = require('../lib/syllabus.js');
  assert.equal(S.weightsText(S.extract(chart.text).weights.value), 'Projects 40%, Weekly quizzes 25%, Final exam 35%');
  // A table: each value is its row's, under the column's heading.
  const table = D.ocrText(engineJson([
    [['Category', 100, 260, 600, 630], ['Weight', 900, 1020, 600, 630]],
    [['Labs', 100, 170, 650, 680], ['30%', 900, 960, 650, 680]],
    [['Exams', 100, 210, 700, 730], ['70%', 900, 960, 700, 730]],
  ]));
  assert.equal(table.text, 'Category\tWeight\nLabs\t30%\nExams\t70%');
});

// ---- features/import.js: the reader's frame -------------------------------------------------------------------------
const importer = () => {
  const frames = [];
  const document = {
    documentElement: { append: (f) => { f.parent = true; frames.push(f); } },
    createElement: () => {
      const f = { style: {}, attrs: {}, on: {}, posted: [], parent: false, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.parent = false; } };
      f.addEventListener = (type, fn) => { f.on[type] = fn; };
      f.contentWindow = { postMessage: (m, origin, ports) => f.posted.push({ m, origin, ports }) };
      return f;
    },
  };
  const timers = [], asked = [];
  const ctx = vm.createContext({
    document, MessageChannel, URL, Uint8Array, Blob, Promise, crypto,
    setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: () => {},
    // The worker gives a pass for each job (lib/background.js 'glaze:reader').
    chrome: { runtime: { getURL: (p) => `chrome-extension://glazeid/${p}`, sendMessage: async (m) => { asked.push(m); return { ok: true }; } } },
    GZ_I18N: { locale: () => 'de' }, GZ_DOCTEXT: D,
    GZ_CTX: { t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'de-DE', need: async () => {} },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'features/import.js'), 'utf8'), ctx);
  return { I: ctx.GZ_IMPORT, frames, timers, asked };
};
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };

test('import: a PDF goes to the reader page in a frame of its own, over a channel only it holds, to its origin only', async () => {
  const { I, frames, asked } = importer();
  const file = new File([fixture('timetable.pdf')], 'timetable.pdf');
  const said = [];
  const p = I.read(file, { progress: (s) => said.push(s) });
  await settle();
  const [f] = frames;
  assert.equal(f.src, 'chrome-extension://glazeid/reader.html');
  assert.equal(f.attrs['aria-hidden'], 'true');
  assert.equal(f.tabIndex, -1);
  assert.equal(f.posted.length, 0, 'nothing is sent before the reader has loaded');
  f.on.load();
  const [{ m, origin, ports }] = f.posted;
  assert.equal(origin, 'chrome-extension://glazeid', 'never "*": a frame the page navigated elsewhere gets nothing');
  assert.deepEqual([m.type, m.kind, m.file, [...m.langs]], ['glaze:read', 'pdf', file, ['deu']], 'with the page language’s OCR model');
  assert.deepEqual(asked.map(({ type, op, pass }) => [type, op, pass]), [['glaze:reader', 'job', m.pass]], 'and the one-use pass it asked the worker for first');
  assert.match(m.pass, /^[\w-]{36}$/);
  assert.equal(ports.length, 1);
  ports[0].postMessage({ type: 'progress', stage: 'text', page: 1, pages: 2 });
  ports[0].postMessage({ type: 'progress', stage: 'text', page: 1, pages: 2 });
  ports[0].postMessage({ type: 'done', text: 'BIO 1100', pages: 2, ocr: null });
  const r = await p;
  assert.equal(r.text, 'BIO 1100');
  assert.deepEqual(said, ['Reading page 1 of 2…'], 'the same words once');
  assert.equal(f.parent, false, 'the frame is gone once the text is back');
});

test('import: a read called off, failed or gone quiet removes the frame and says why', async () => {
  const { I, frames, timers } = importer();
  const ctl = new AbortController();
  const p1 = I.read(new File([fixture('timetable.png')], 'a.png'), { signal: ctl.signal });
  await settle();
  ctl.abort();
  await assert.rejects(p1, (e) => e.cancelled === true);
  assert.equal(frames[0].parent, false);

  const p2 = I.read(new File([ascii('%PDF-1.7 locked')], 'x.pdf'));
  await settle();
  frames[1].on.load();
  frames[1].posted[0].ports[0].postMessage({ type: 'error', code: 'locked' });
  await assert.rejects(p2, (e) => e.mine && /protected by a password/.test(e.message));
  assert.equal(frames[1].parent, false);

  const p3 = I.read(new File([ascii('%PDF-1.7')], 'y.pdf'));
  await settle();
  timers.at(-1).fn(); // a minute without a word from the reader
  await assert.rejects(p3, (e) => e.mine && /couldn't read that file/.test(e.message));
  assert.equal(frames[2].parent, false);
});

test('import: text, web pages and Word stay in the page; other files are refused with what Glaze reads', async () => {
  const { I, frames } = importer();
  assert.deepEqual({ ...await I.read(new File(['MWF 9-9:50'], 'a.txt', { type: 'text/plain' })) }, { text: 'MWF 9-9:50', ocr: null });
  assert.equal((await I.read(new File(['<table><tr><td>A</td><td>93</td></tr></table>'], 'a.html'))).text, 'A\t93');
  await assert.rejects(I.read(new File(['x'], 'grades.xlsx')), (e) => e.mine && /Glaze reads PDFs, pictures/.test(e.message));
  await assert.rejects(I.read(new File(['PK'], 'broken.docx')), (e) => e.mine && /couldn't read that file/.test(e.message));
  assert.equal(frames.length, 0);
  assert.equal(I.note(null), '');
  assert.match(I.note({ conf: 92, unsure: [] }), /^Glaze read this from a picture\. Check it/);
  assert.match(I.note({ conf: 92, unsure: ['x'] }), /wasn't sure of some of it/);
  assert.equal(I.doubt({ unsure: ['BIO 1100\tBiology\tMWF 9:00'] }, 'BIO 1100'), true);
  assert.equal(I.doubt({ unsure: ['ENG 1100'] }, 'BIO 1100'), false);
});

// ---- reader.js itself, in a vm: whom it reads for, and what it refuses before decoding -------------------------------
// A stand-in pdf.js beside a stand-in reader.html records what the reader asks of it (and refuses every PDF);
// createImageBitmap records each decode (and fails); the worker redeems a pass once, as lib/background.js does.
const stand = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'glaze-reader-test-'));
fs.mkdirSync(path.join(stand, 'lib/pdfjs'), { recursive: true });
fs.writeFileSync(path.join(stand, 'lib/pdfjs/pdf.mjs'), `export const GlobalWorkerOptions = {};
export const getDocument = (opts) => { (globalThis.__glazeReaderPdf ||= []).push(opts); return { promise: Promise.reject(Object.assign(new Error('stand-in'), { name: 'InvalidPDFException' })), destroy: async () => {} }; };\n`);
test.after(() => fs.rmSync(stand, { recursive: true, force: true }));
const reader = () => {
  let onmessage = null;
  const passes = new Set(), decoded = [];
  const ctx = vm.createContext({
    GZ_DOCTEXT: D, URL, Blob, File, Uint8Array, Promise, Object, Error, Math, JSON, Array, Set, console,
    location: { href: pathToFileURL(path.join(stand, 'reader.html')).href },
    addEventListener: (type, f) => { if (type === 'message') onmessage = f; },
    chrome: { runtime: { sendMessage: async (m) => ({ ok: m?.type === 'glaze:reader' && m.op === 'claim' && passes.delete(m.pass) }) } },
    createImageBitmap: async (b) => { decoded.push(b); throw new Error('stand-in decoder'); },
    Worker: class { postMessage() {} terminate() {} },
  });
  new vm.Script(fs.readFileSync(path.join(root, 'reader.js'), 'utf8'), { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(ctx);
  // A job as any page could post it, with a channel of its own; → the reader's answer, or null when it says nothing.
  const post = (data) => new Promise((resolve) => {
    const ch = new MessageChannel();
    const quiet = setTimeout(() => { ch.port1.close(); resolve(null); }, 250);
    ch.port1.onmessage = ({ data: m }) => { if (m.type !== 'progress') { clearTimeout(quiet); ch.port1.close(); resolve(m); } };
    onmessage({ data, ports: [ch.port2], origin: 'https://elsewhere.example', source: {} });
  });
  return { post, decoded, pass: () => { const p = crypto.randomUUID(); passes.add(p); return p; } };
};
const job = (name, bytes, kind, pass) => ({ type: 'glaze:read', file: new File([bytes], name), kind, ...(pass && { pass }) });

test('reader: no work without the one-use pass Glaze\'s import got from the worker, and one file per reader', async () => {
  const r = reader();
  const png = fixture('timetable.png');
  assert.equal(await r.post(job('a.png', png, 'image')), null, 'no pass: a site that framed the reader gets nothing done');
  assert.equal(await r.post(job('a.png', png, 'image', 'made-up')), null, 'nor with one it made up');
  assert.equal(r.decoded.length, 0);
  const pass = r.pass();
  const [first, second] = await Promise.all([r.post(job('a.png', png, 'image', pass)), r.post(job('b.png', png, 'image', r.pass()))]);
  assert.equal(first?.code, 'format', 'the import\'s own file is read (the stand-in decoder fails it)');
  assert.equal(second, null, 'a second file, even with a pass, is refused: the import opens a reader per file');
  assert.equal(r.decoded.length, 1);
  assert.equal(await reader().post(job('a.png', png, 'image', pass)), null, 'a pass works once');
});

test('reader: a picture\'s size is read from its whole header before it is decoded, and a picture whose size can\'t be read isn\'t decoded', async () => {
  // A JPEG whose frame header says 10,000 × 10,000, after 17 APP segments (more than 1 MiB) of a camera's metadata.
  const big = new Uint8Array(2 + 17 * 65537 + 11 + 2);
  big.set([0xff, 0xd8]);
  for (let i = 0; i < 17; i++) big.set([0xff, 0xe1, 0xff, 0xff], 2 + i * 65537);
  big.set([0xff, 0xc0, 0, 11, 8, 0x27, 0x10, 0x27, 0x10, 1, 0], 2 + 17 * 65537);
  big.set([0xff, 0xd9], big.length - 2);
  assert.ok(big.length > 1 << 20);
  assert.deepEqual(D.imageSize(big), { w: 10000, h: 10000 });
  let r = reader();
  assert.equal((await r.post(job('big.jpg', big, 'image', r.pass())))?.code, 'pixels');
  assert.equal(r.decoded.length, 0, 'refused before decoding');
  r = reader();
  assert.equal((await r.post(job('odd.png', ascii('not really a picture at all'), 'image', r.pass())))?.code, 'format');
  assert.equal(r.decoded.length, 0, 'a size it can\'t read is refused, not decoded to find out');
});

test('reader: pdf.js is held to the same pixel limit for the pictures inside a PDF', async () => {
  const r = reader();
  assert.equal((await r.post(job('t.pdf', fixture('timetable.pdf'), 'pdf', r.pass())))?.code, 'broken', 'the stand-in refuses every PDF');
  const opts = globalThis.__glazeReaderPdf.at(-1);
  assert.equal(opts.maxImageSize, D.READ.pixels);
  assert.equal(opts.enableXfa, false);
});

// ---- lib/background.js: the reader's passes ---------------------------------------------------------------------------
const workerPasses = () => {
  const listeners = [];
  const none = { addListener() {} };
  const ID = 'glazeid';
  const ctx = vm.createContext({
    URL, console, setTimeout, clearTimeout, TextEncoder, crypto, Date,
    importScripts: (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'lib', f), 'utf8'), ctx); },
    chrome: {
      runtime: { id: ID, getURL: (p = '') => `chrome-extension://${ID}/${p}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async () => ({}), set: async () => {} }, onChanged: none },
      scripting: { executeScript: () => Promise.resolve([]) },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8'), ctx);
  const send = (m, sender) => new Promise((resolve) => {
    let answered = false;
    for (const f of listeners) if (f(m, { id: ID, ...sender }, (r) => { answered = true; resolve(r && { ...r }); }) === true || answered) return;
    resolve(undefined);
  });
  return { send };
};

test('the worker hands a pass only to a content script in a tab, and redeems it once, for the reader in that tab', async () => {
  const w = workerPasses();
  const tab = { id: 7 }, page = { tab, frameId: 0, url: 'https://school.instructure.com/courses/25' };
  const readerIn = (id) => ({ tab: { id }, frameId: 3, url: 'chrome-extension://glazeid/reader.html' });
  const pass = crypto.randomUUID();
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'job', pass }, { url: 'chrome-extension://glazeid/options.html' }), { ok: false }, 'not from an extension page');
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'job', pass: 'short' }, page), { ok: false }, 'not a guessable pass');
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'job', pass }, page), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'claim', pass }, page), { ok: false }, 'only the reader redeems it');
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'claim', pass }, readerIn(8)), { ok: false }, 'and only in the tab that asked');
  const again = crypto.randomUUID();
  await w.send({ type: 'glaze:reader', op: 'job', pass: again }, page);
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'claim', pass: again }, readerIn(7)), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'claim', pass: again }, readerIn(7)), { ok: false }, 'once');
});

// ---- the engines, as the reader runs them ----------------------------------------------------------------------------
let pdfjs = null;
const pdf = async (bytes) => {
  if (!pdfjs) {
    const [log, warn] = [console.log, console.warn];
    console.log = console.warn = () => {}; // pdf.js warns at import that node has no canvas; text needs none
    try { pdfjs = await import(pathToFileURL(path.join(root, 'lib/pdfjs/pdf.mjs')).href); } finally { [console.log, console.warn] = [log, warn]; }
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(root, 'lib/pdfjs/pdf.worker.mjs')).href;
  }
  return pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 });
};
const pdfText = async (bytes) => {
  const task = await pdf(bytes);
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); pages.push({ items: (await p.getTextContent()).items, vt: p.getViewport({ scale: 1 }).transform }); }
    return pages.map((p) => D.pdfText([p]));
  } finally { await task.destroy(); }
};

// lib/ocr.js itself, in a vm with what a worker in the extension has: importScripts, fetch of its own files (anything
// else fails the test), DecompressionStream, postMessage.
const ocrWorker = () => {
  const asked = [];
  let answer = null, started = null;
  const own = (u) => { const url = new URL(u); asked.push(url.href); assert.ok(url.href.startsWith('chrome-extension://glaze/lib/'), `fetched ${url.href}`); return fs.readFileSync(path.join(root, url.pathname)); };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, URL, TextDecoder, TextEncoder, WebAssembly, Response, DecompressionStream, setTimeout, clearTimeout, performance, crypto,
    location: { href: 'chrome-extension://glaze/lib/ocr.js' },
    fetch: async (u) => new Response(own(String(u)), { headers: { 'content-type': String(u).endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' } }),
    postMessage: (m) => { if (m.type !== 'progress') answer?.(m); },
    WorkerGlobalScope: function WorkerGlobalScope() {},
  };
  ctx.self = ctx;
  ctx.importScripts = (p) => vm.runInContext(own(new URL(p, ctx.location.href)).toString(), ctx);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/ocr.js'), 'utf8'), ctx);
  const ask = (m) => new Promise((r) => { answer = r; ctx.onmessage({ data: m }); });
  // Started as the reader starts it for an English page, with a language it hasn't got thrown in.
  const start = () => (started ||= ask({ type: 'start', langs: ['eng', 'klingon'] }));
  return { asked, start, read: async (image) => { await start(); const r = await ask({ type: 'read', image }); assert.equal(r.type, 'done', r.why); return D.ocrText(JSON.parse(r.json)); } };
};
// A Chrome screenshot (8-bit RGB or RGBA PNG) as canvas pixels, for D.pgm as the reader makes it.
const png = (buf) => {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), type = buf[25];
  assert.ok(buf[24] === 8 && (type === 2 || type === 6) && !buf[28], 'an 8-bit RGB(A) PNG, not interlaced');
  const idat = [];
  for (let i = 8; i < buf.length; i += 12 + buf.readUInt32BE(i)) if (buf.toString('latin1', i + 4, i + 8) === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + buf.readUInt32BE(i)));
  const raw = zlib.inflateSync(Buffer.concat(idat)), n = type === 6 ? 4 : 3, stride = w * n, rgba = new Uint8ClampedArray(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= n ? cur[x - n] : 0, b = prev[x], c = x >= n ? prev[x - n] : 0, p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      cur[x] = line[x] + [0, a, b, (a + b) >> 1, paeth][f];
    }
    for (let x = 0; x < w; x++) { rgba.set(cur.subarray(x * n, x * n + 3), (y * w + x) * 4); rgba[(y * w + x) * 4 + 3] = n === 4 ? cur[x * 4 + 3] : 255; }
    prev = cur;
  }
  return D.pgm(rgba, w, h);
};
// A scanned page's picture, decoded by pdf.js, as canvas pixels (the reader draws the page instead; node has no canvas).
const scanned = async (bytes, n) => {
  const task = await pdf(bytes);
  const page = await (await task.promise).getPage(n);
  const ops = await page.getOperatorList();
  const name = ops.argsArray[ops.fnArray.indexOf(pdfjs.OPS.paintImageXObject)][0];
  const img = await new Promise((r) => page.objs.get(name, r));
  const { width: w, height: h, data } = img, k = data.length / (w * h), rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba.set(k === 1 ? [data[i], data[i], data[i]] : data.subarray(i * k, i * k + 3), i * 4); rgba[i * 4 + 3] = 255; }
  await task.destroy();
  return D.pgm(rgba, w, h);
};

// ---- what each flow makes of it, scored (scripts/import-truth.js) -------------------------------------------------
const { SCORE } = require('../scripts/import-truth.js');

// [fixture, how it is read, lowest accuracy accepted]: the floor is what this code measured, so a change that reads
// worse fails.
const ocr = ocrWorker();
const ACCURACY = [
  ['timetable.pdf', 'text layer', 1],
  ['syllabus.pdf', 'text layer', 1],
  ['syllabus-2col.pdf', 'text layer, two columns', 20 / 22], // B and F wrap onto the next line of their column
  ['transcript.pdf', 'text layer', 1],
  ['transcript-scan.pdf', 'no text layer: OCR of the page', 34 / 36], // "P" read as "r"; Chemistry "II" as "I!", mended
  ['timetable.png', 'OCR, screenshot', 1],
  ['timetable.webp', 'OCR, screenshot', 1],
  // Tilted, soft and small: the meetings mostly come through, the places don't (the cells' gaps are lost), and
  // "BIO 1100L" reads as "BIO 1100.". The review marks every row of it; the student corrects there.
  ['timetable-photo.jpg', 'OCR, phone photo', 0.4],
  ['syllabus.png', 'OCR, screenshot', 20 / 21],
  ['transcript-photo.jpg', 'OCR, phone photo, sharp', 1],
  // The class schedule's own list on Canvas: a course on one line, its times on the next, buttons centred beside both,
  // which make the three one row. On the dark one BIO 1100L's heading isn't joined to its times; on both, a place
  // followed by " - Days off: 1" is read with it, and so isn't the place.
  ['canvas-schedule-light.png', 'OCR, Canvas screenshot, light', 0.8],
  ['canvas-schedule-dark.png', 'OCR, Canvas screenshot, dark', 0.6],
];

test('the OCR worker starts on the bundled models only, and refuses a language it doesn\'t have', async () => {
  assert.deepEqual({ ...await ocr.start() }, { type: 'ready' });
  assert.deepEqual(ocr.asked.map((u) => u.replace('chrome-extension://glaze/', '')).sort(), ['lib/tesseract/eng.traineddata.gz', 'lib/tesseract/tesseract-core-simd-lstm.js', 'lib/tesseract/tesseract-core-simd-lstm.wasm']);
});

test('PDFs: a locked one says so, a broken one fails, a scanned one has no text layer', async () => {
  const locked = await pdf(fixture('locked.pdf'));
  await assert.rejects(locked.promise, (e) => e.name === 'PasswordException', 'the reader tells the student it is password-protected');
  const broken = await pdf(ascii('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF'));
  await assert.rejects(broken.promise.then((d) => d.getPage(1)));
  await Promise.all([locked.destroy(), broken.destroy()]);
  assert.deepEqual((await pdfText(fixture('transcript-scan.pdf'))).map((t) => t.replace(/\s/g, '').length), [0], 'the reader OCRs it');
});

test('extraction accuracy, per fixture', async (t) => {
  const table = [], low = [];
  for (const [f, how, floor] of ACCURACY) {
    if (!fs.existsSync(path.join(__dirname, 'fixtures/import', f))) { t.diagnostic(`${f}: missing (scripts/import-check.js makes it)`); continue; }
    const bytes = fixture(f);
    const at = Date.now();
    let text, conf = '';
    if (f.endsWith('.pdf') && how.startsWith('text')) text = (await pdfText(bytes)).join('\n\n');
    else {
      // A scanned page and a PNG as the reader hands them over (grey pixels); the photo and WebP as files, which the
      // engine decodes itself (node can't decode them; the browser run is scripts/import-check.js).
      const image = f.endsWith('.pdf') ? await scanned(bytes, 1) : f.endsWith('.png') ? png(bytes) : new Uint8Array(bytes);
      const r = await ocr.read(image);
      text = r.text;
      conf = ` OCR confidence ${r.conf}, unsure lines ${r.unsure.length},`;
    }
    const s = SCORE[f](text);
    table.push(`${f} (${how}):${conf} ${s.ok}/${s.of} = ${Math.round((s.ok / s.of) * 100)}%, extra ${s.extra}, ${Date.now() - at} ms`);
    if (s.ok / s.of < floor - 1e-9) low.push(`${f}: ${s.ok}/${s.of}, below ${floor}\n${text}`);
  }
  t.diagnostic(`accuracy\n${table.join('\n')}`);
  assert.deepEqual(low, []);
});
