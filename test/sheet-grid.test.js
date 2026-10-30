// The spreadsheet grid's pure parts (sheet-grid.js): the Fenwick tree of row and column offsets, selection maths and the
// data edge Ctrl+arrow goes to, fill series detection and the formula shift a fill makes, and the clipboard's TSV and HTML
// both ways (Excel's mso-number-format and Google Sheets' data-sheets-* read on paste). The DOM grid is scripts/sheets-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../sheet-grid.js');

test('offsets: a Fenwick tree of sizes, hidden ones zero, found back from a pixel', () => {
  const s = new G.Sizes(1e5, 20);
  assert.equal(s.total(), 2e6);
  assert.equal(s.offset(0), 0);
  assert.equal(s.offset(10), 200);
  s.set(3, 50);
  s.set(5, 0);
  assert.equal(s.size(3), 50);
  assert.equal(s.offset(4), 3 * 20 + 50);
  assert.equal(s.offset(6), 3 * 20 + 50 + 20 + 0);
  assert.equal(s.total(), 2e6 + 30 - 20);
  assert.equal(s.at(0), 0);
  assert.equal(s.at(59), 2);
  assert.equal(s.at(60), 3);
  assert.equal(s.at(109), 3);
  assert.equal(s.at(110), 4);
  assert.equal(s.at(130), 6, 'a hidden row is never the one under a pixel');
  assert.equal(s.at(-5), 0);
  assert.equal(s.at(1e9), 1e5 - 1);
  // Growing keeps what was set; a rebuild from a map of sizes matches set() one by one.
  s.grow(2e5);
  assert.equal(s.size(3), 50);
  assert.equal(s.total(), 4e6 + 10);
  const t = new G.Sizes(1e5, 20, new Map([[3, 50], [5, 0]]));
  for (const i of [0, 4, 6, 999, 99999]) assert.equal(t.offset(i), new G.Sizes(1e5, 20, new Map([[3, 50], [5, 0]])).offset(i));
  assert.equal(t.offset(6), 150);
  // A million rows: every query is a few steps, and the whole stays a number of pixels.
  const big = new G.Sizes(1048576, 20);
  const t0 = performance.now();
  for (let i = 0; i < 1e5; i++) big.at(i * 200);
  assert.ok(performance.now() - t0 < 500);
});

test('Excel\'s column width and row height units as pixels', () => {
  // colW is a file's <col width> (characters of the maximum digit width, 7 px, with its 5 px of padding); rowH points.
  assert.equal(G.px.col(9.140625), 64);
  assert.equal(G.px.col(undefined), 64, 'no width: the default 8.43 characters');
  assert.equal(G.px.toCol(64), 9.140625);
  assert.equal(G.px.col(G.px.toCol(150)), 150);
  assert.equal(G.px.row(15), 20);
  assert.equal(G.px.toRow(20), 15);
});

test('selection: ranges normalized, extended, listed with Ctrl, and their bounds', () => {
  const r = G.range(5, 3, 2, 1);
  assert.deepEqual(r, { r0: 2, c0: 1, r1: 5, c1: 3 });
  assert.ok(G.inside(r, 3, 2) && !G.inside(r, 6, 2));
  const sel = G.select(null, 0, 0);
  assert.deepEqual(sel, { active: [0, 0], anchor: [0, 0], ranges: [{ r0: 0, c0: 0, r1: 0, c1: 0 }] });
  const ext = G.select(sel, 3, 2, { extend: true });
  assert.deepEqual(ext.ranges, [{ r0: 0, c0: 0, r1: 3, c1: 2 }]);
  assert.deepEqual(ext.active, [0, 0], 'Shift keeps the active cell');
  const more = G.select(ext, 7, 7, { add: true });
  assert.deepEqual(more.ranges, [{ r0: 0, c0: 0, r1: 3, c1: 2 }, { r0: 7, c0: 7, r1: 7, c1: 7 }]);
  assert.deepEqual(more.active, [7, 7]);
  assert.deepEqual(G.bounds(more.ranges), { r0: 0, c0: 0, r1: 7, c1: 7 });
  assert.equal(G.count(more.ranges), 13);
  assert.equal(G.name(more.ranges[0]), 'A1:C4');
  assert.equal(G.name({ r0: 4, c0: 1, r1: 4, c1: 1 }), 'B5');
});

test('Ctrl+arrow: to the edge of the data, over a gap to the next, else the sheet\'s edge', () => {
  const filled = new Set(['0,0', '1,0', '2,0', '6,0', '9,0']);
  const has = (r, c) => filled.has(`${r},${c}`);
  const lim = { rows: 100, cols: 26 };
  assert.deepEqual(G.edge(has, 0, 0, 1, 0, lim), [2, 0], 'inside a run: its end');
  assert.deepEqual(G.edge(has, 2, 0, 1, 0, lim), [6, 0], 'at a run\'s end: the next filled');
  assert.deepEqual(G.edge(has, 3, 0, 1, 0, lim), [6, 0], 'from a blank: the next filled');
  assert.deepEqual(G.edge(has, 9, 0, 1, 0, lim), [99, 0], 'past the last: the edge');
  assert.deepEqual(G.edge(has, 9, 0, -1, 0, lim), [6, 0]);
  assert.deepEqual(G.edge(has, 0, 0, 0, 1, lim), [0, 25]);
  assert.deepEqual(G.edge(has, 0, 0, -1, 0, lim), [0, 0], 'at the edge already');
});

const n = (v) => ({ t: 'n', v }), s = (v) => ({ t: 's', v });
const vals = (out) => out.map((x) => (x.cell.f !== undefined ? `=${x.cell.f}` : x.cell.v));

test('fill series: numbers by their step, a single number copied, text with a number counting on, days and months cycling', () => {
  assert.deepEqual(vals(G.fill([n(1), n(2)], 3)), [3, 4, 5]);
  assert.deepEqual(vals(G.fill([n(10), n(7)], 2)), [4, 1]);
  assert.deepEqual(vals(G.fill([n(1), n(3), n(4)], 2)).map((v) => Math.round(v * 1e9) / 1e9), [5.666666667, 7.166666667], 'more than two: the linear trend, as Excel');
  assert.deepEqual(vals(G.fill([n(5)], 3)), [5, 5, 5]);
  assert.deepEqual(vals(G.fill([s('Item 1')], 3)), ['Item 2', 'Item 3', 'Item 4']);
  assert.deepEqual(vals(G.fill([s('Q1 2025'), s('Q1 2026')], 2)), ['Q1 2027', 'Q1 2028']);
  assert.deepEqual(vals(G.fill([s('Mon')], 3)), ['Tue', 'Wed', 'Thu']);
  assert.deepEqual(vals(G.fill([s('Friday')], 3)), ['Saturday', 'Sunday', 'Monday']);
  assert.deepEqual(vals(G.fill([s('Nov')], 3)), ['Dec', 'Jan', 'Feb']);
  assert.deepEqual(vals(G.fill([s('january'), s('march')], 2)), ['may', 'july'], 'their step and their case');
  assert.deepEqual(vals(G.fill([s('a'), s('b')], 3)), ['a', 'b', 'a'], 'plain text repeats');
  assert.deepEqual(vals(G.fill([n(1), s('x')], 4)), [1, 'x', 1, 'x']);
  assert.deepEqual(vals(G.fill([{ t: 'b', v: true }], 2)), [true, true]);
  // Backwards (up or left): the series runs the other way.
  assert.deepEqual(vals(G.fill([n(5), n(6)], 2, { back: true })), [4, 3]);
  assert.deepEqual(vals(G.fill([s('Item 3')], 2, { back: true })), ['Item 2', 'Item 1']);
  // A date (a number in a date format) counts by the day.
  assert.deepEqual(vals(G.fill([{ t: 'n', v: 45000, s: 2 }], 2, { isDate: (x) => x.s === 2 })), [45001, 45002]);
  // Styles go with the values.
  assert.equal(G.fill([{ t: 'n', v: 1, s: 4 }, { t: 'n', v: 2, s: 4 }], 1)[0].cell.s, 4);
  // An empty source fills empty.
  assert.deepEqual(G.fill([null], 2).map((x) => x.cell), [null, null]);
});

test('fill shifts formulas by how far each copy moves, absolute parts kept', () => {
  const down = G.fill([{ t: 'n', v: 0, f: 'A1*2+$B$1' }], 3, { dr: 1, dc: 0 });
  assert.deepEqual(vals(down), ['=A2*2+$B$1', '=A3*2+$B$1', '=A4*2+$B$1']);
  const right = G.fill([{ t: 'n', v: 0, f: 'SUM(A1:A3)' }, { t: 'n', v: 0, f: 'A$1' }], 3, { dr: 0, dc: 1 });
  assert.deepEqual(vals(right), ['=SUM(C1:C3)', '=C$1', '=SUM(E1:E3)']);
  const up = G.fill([{ t: 'n', v: 0, f: 'A5' }], 2, { dr: -1, dc: 0, back: true });
  assert.deepEqual(vals(up), ['=A4', '=A3']);
  assert.deepEqual(vals(G.fill([{ t: 'n', v: 0, f: 'A1' }], 1, { dr: -1, dc: 0, back: true })), ['=#REF!'], 'off the sheet: #REF!');
  assert.deepEqual(G.fill([n(1), n(2)], 2).map((x) => x.from), [0, 1], 'each copy says which source it came from');
});

test('TSV and CSV: quotes, doubled quotes, line breaks inside a field, CRLF, a BOM, a ragged last line', () => {
  assert.deepEqual(G.parseDelimited('a\tb\n1\t2', '\t'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(G.parseDelimited('\uFEFFname,note\r\n"Ada","said ""hi""\nthen left"\r\n', ','), [['name', 'note'], ['Ada', 'said "hi"\nthen left']]);
  assert.deepEqual(G.parseDelimited('x\n', '\t'), [['x']], 'a trailing line break ends the last row, no empty row after');
  assert.deepEqual(G.parseDelimited('', '\t'), [['']]);
  assert.deepEqual(G.parseDelimited('a,,c', ','), [['a', '', 'c']]);
  assert.throws(() => G.parseDelimited('"open', ','), /quote/);
  assert.equal(G.writeDelimited([['a', 'b c'], ['1', 'x\ty'], ['say "hi"', 'two\nlines']], '\t'), 'a\tb c\r\n1\t"x\ty"\r\n"say ""hi"""\t"two\nlines"');
  assert.deepEqual(G.parseDelimited(G.writeDelimited([['a', '"q"', 'b\nc']], ','), ','), [['a', '"q"', 'b\nc']]);
  assert.equal(G.sniff('a;b;c\n1;2;3'), ';');
  assert.equal(G.sniff('a,b\n1,2'), ',');
  assert.equal(G.sniff('a\tb\n1\t2'), '\t');
});

test('pasted HTML: a table\'s cells, Excel\'s mso-number-format (inline and by class), Sheets\' data-sheets-value and formula', () => {
  const excel = '<html><head><style>.xl65{mso-number-format:"0\\.00";}\n.xl66{mso-number-format:"\\@";}\n.xl67{mso-number-format:Percent;}</style></head><body><table>'
    + '<tr><td>Name</td><td class=xl65>3.5</td><td class="xl66">007</td></tr>'
    + '<tr><td>A &amp; B<br>C</td><td style="mso-number-format:\'\\#\\,\\#\\#0\'">1,200</td><td class=xl67>12%</td></tr></table></body></html>';
  const a = G.parseHTML(excel);
  assert.deepEqual(a.map((row) => row.map((x) => x.text)), [['Name', '3.5', '007'], ['A & B\nC', '1,200', '12%']]);
  assert.equal(a[0][1].fmt, '0.00');
  assert.equal(a[0][2].fmt, '@');
  assert.equal(a[1][1].fmt, '#,##0');
  assert.equal(a[1][2].fmt, '0%');
  const sheets = '<meta charset="utf-8"><google-sheets-html-origin><table data-sheets-root="1"><tbody><tr>'
    + '<td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:42.5}">42.50</td>'
    + '<td data-sheets-value=\'{"1":2,"2":"hello"}\'>hello</td>'
    + '<td data-sheets-value="{&quot;1&quot;:4,&quot;4&quot;:1}">TRUE</td>'
    + '<td data-sheets-value="{&quot;1&quot;:3,&quot;3&quot;:6}" data-sheets-formula="=R[0]C[-3]*2">85</td></tr></tbody></table>';
  const b = G.parseHTML(sheets);
  assert.deepEqual(b[0].map((x) => x.value), [42.5, 'hello', true, 6]);
  assert.equal(b[0][3].formula, 'R[0]C[-3]*2');
  assert.deepEqual(G.parseHTML('<p>no table</p>'), null);
  assert.deepEqual(G.parseHTML('<table><tr><td><script>x()</script>ok</td></tr></table>')[0][0].text, 'ok', 'a script\'s text is no cell text');
});

test('copying: TSV and an HTML table of the shown text, and the internal copy found again by the TSV\'s hash', () => {
  const rows = [[{ text: 'Name' }, { text: '3.50' }], [{ text: 'a<b & "c"' }, { text: '' }]];
  const out = G.copy(rows);
  assert.equal(out.tsv, 'Name\t3.50\r\na<b & "c"\t');
  assert.match(out.html, /^<table>/);
  assert.ok(out.html.includes('<td>a&lt;b &amp; &quot;c&quot;</td>'));
  assert.deepEqual(G.parseHTML(out.html).map((r) => r.map((x) => x.text)), [['Name', '3.50'], ['a<b & "c"', '']]);
  assert.equal(G.sig(out.tsv), G.sig('Name\t3.50\r\na<b & "c"\t'));
  assert.notEqual(G.sig(out.tsv), G.sig('Name\t3.5'));
  // Line endings as another program writes them still match.
  assert.equal(G.sig(out.tsv.replace(/\r\n/g, '\n')), G.sig(out.tsv));
});

test('Sheets\' R1C1 formula as A1 at the cell it lands in', () => {
  assert.equal(G.fromR1C1('R[0]C[-3]*2', 4, 3), 'A5*2');
  assert.equal(G.fromR1C1('SUM(R1C1:R[-1]C)', 9, 1), 'SUM($A$1:B9)');
  assert.equal(G.fromR1C1('R[-10]C', 2, 0), '#REF!');
});
