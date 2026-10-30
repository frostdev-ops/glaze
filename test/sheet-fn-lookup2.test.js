// The array-shaping lookup functions (lib/sheet-fn-lookup2.js). Function cases are the worked examples on Microsoft's
// page for each function, support.microsoft.com/en-us/excel/functions/<name>-function (areas, take, drop, choosecols,
// chooserows, vstack, expand, tocol, torow, wraprows, wrapcols) and support.microsoft.com/office/
// hstack-function-98c4ab76-10fe-4b4f-8d5f-af1c125fe8c2. The pages give their data as a flat list of cells and describe
// results in words; the cases lay the data out over the ranges the formulas name and state the arrays those words
// describe. Where a page's text leaves cells out (VSTACK's and HSTACK's third examples, WRAPROWS' letters) the cases
// fill them in. WRAPCOLS(A2:F2,3) is two columns: six values fill two columns of three, not the A4:C6 the page says.
// Edge cases follow the pages' rules and Excel 16.114.1 probes (counts truncate toward zero, an empty result is
// #CALC!, an index of 0 or past the size is #VALUE!, pads stay errors or blanks as given, a 3-D reference is #VALUE!
// in AREAS).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-text.js');
require('../lib/sheet-fn-info.js');
require('../lib/sheet-fn-lookup.js');
require('../lib/sheet-fn-lookup2.js');

const book = (cells = {}, { sheets = ['Sheet1'] } = {}) => {
  const wb = M.workbook();
  wb.sheets[0].name = sheets[0];
  for (const name of sheets.slice(1)) M.apply(wb, { op: 'addSheet', at: wb.sheets.length, name });
  for (const [at, input] of Object.entries(cells)) {
    const [sheet, ref] = at.includes('!') ? at.split('!') : [sheets[0], at];
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    const cell = x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v };
    M.apply(wb, { op: 'set', sheet: M.getSheet(wb, sheet).id, r, c, cell });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text, at = 'Z100') => out(e.evaluate(text, e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
// A formula's whole array: entered as an array formula over a range of its size (ROWS and COLUMNS of it), read back.
// A blank element shows as 0.
const spill = (e, f, at = 'AA1') => {
  const rows = calc(e, `ROWS(${f})`), cols = calc(e, `COLUMNS(${f})`);
  if (typeof rows !== 'number') return rows;
  const sh = e.wb.sheets[0], [r, c] = M.cellPosition(at), range = M.rangeName(r, c, r + rows - 1, c + cols - 1);
  e.apply({ op: 'set', sheet: sh.id, r, c, cell: { t: 'n', v: 0, f, a: range } });
  const got = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (__, j) => out(e.value(sh.id, r + i, c + j))));
  e.apply({ op: 'clear', sheet: sh.id, r0: r, c0: c, r1: r + rows - 1, c1: c + cols - 1 });
  return got;
};
const spills = (e, rows) => { for (const [f, want] of rows) assert.deepEqual(spill(e, f), want, f); };
const NA = '#N/A', CALC = '#CALC!', VALUE = '#VALUE!', NUM = '#NUM!';

const NAMES = 'AREAS TAKE DROP CHOOSECOLS CHOOSEROWS VSTACK HSTACK EXPAND TOCOL TOROW WRAPROWS WRAPCOLS'.split(' ');

test('the shaping functions are registered and nothing sets a timer', () => {
  for (const name of NAMES) assert.ok(C.fn(name), name);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-lookup2.js'), 'utf8')));
});

// A1:C3 = 1..9 by rows; F1:H2 = "x", #DIV/0!, blank / 10, blank, "y"; E1:E3 blank (the probes' data).
const GRID = { A1: 1, B1: 2, C1: 3, A2: 4, B2: 5, C2: 6, A3: 7, B3: 8, C3: 9, F1: 'x', G1: '=1/0', F2: 10, H2: 'y' };
const NINE = { A2: 1, B2: 2, C2: 3, A3: 4, B3: 5, C3: 6, A4: 7, B4: 8, C4: 9 };

test('TAKE: Microsoft examples', () => {
  spills(book(NINE), [
    ['TAKE(A2:C4,2)', [[1, 2, 3], [4, 5, 6]]], ['TAKE(A2:C4,,2)', [[1, 2], [4, 5], [7, 8]]],
    ['TAKE(A2:C4,-2)', [[4, 5, 6], [7, 8, 9]]], ['TAKE(A2:C4,2,2)', [[1, 2], [4, 5]]],
  ]);
});

test('TAKE: zero is #CALC!, counts truncate, past the size is the whole array', () => {
  const e = book(GRID);
  cases(e, [
    ['TAKE(A1:C3,0)', CALC], ['TAKE(A1:C3,,0)', CALC], ['TAKE(A1:C3,1,0)', CALC], ['TAKE(A1:C3,0.5)', CALC], ['TAKE(A1:C3,-0.5)', CALC],
    ['TAKE(A1:C3,E1)', CALC], ['TAKE(A1:C3,"x")', VALUE], ['TAKE(A1:C3,1/0)', '#DIV/0!'], ['TAKE(1/0,1)', '#DIV/0!'], ['TAKE(5,1)', 5],
    ['SUM(TAKE(A1:C3,-1,-1))', 9],
  ]);
  spills(e, [
    ['TAKE(A1:C3,)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]], ['TAKE(A1:C3,1.9)', [[1, 2, 3]]], ['TAKE(A1:C3,-1.9)', [[7, 8, 9]]],
    ['TAKE(A1:C3,10)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]], ['TAKE(A1:C3,-10,-10)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]],
    ['TAKE(A1:C3,2000000)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]], ['TAKE(A1:C3,"2")', [[1, 2, 3], [4, 5, 6]]], ['TAKE(A1:C3,TRUE)', [[1, 2, 3]]],
    ['TAKE(F1:H2,2)', [['x', '#DIV/0!', 0], [10, 0, 'y']]], ['TAKE({1,2;3,4},-1)', [[3, 4]]],
  ]);
  assert.equal(calc(e, 'ISBLANK(INDEX(TAKE(E1:E3,2),1))'), true);
});

test('DROP: Microsoft examples', () => {
  spills(book(NINE), [
    ['DROP(A2:C4,2)', [[7, 8, 9]]], ['DROP(A2:C4,,2)', [[3], [6], [9]]], ['DROP(A2:C4,-2)', [[1, 2, 3]]], ['DROP(A2:C4,2,2)', [[9]]],
  ]);
});

test('DROP: zero drops nothing, everything is #CALC!, counts truncate', () => {
  const e = book(GRID);
  cases(e, [['DROP(A1:C3,3)', CALC], ['DROP(A1:C3,-3)', CALC], ['DROP(A1:C3,,5)', CALC], ['DROP(A1:C3,1,-3)', CALC], ['DROP(1/0,1)', '#DIV/0!'], ['DROP(5,0)', 5]]);
  spills(e, [
    ['DROP(A1:C3,0)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]], ['DROP(A1:C3,,0)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]], ['DROP(A1:C3,)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]],
    ['DROP(A1:C3,1,0)', [[4, 5, 6], [7, 8, 9]]], ['DROP(A1:C3,1.9)', [[4, 5, 6], [7, 8, 9]]], ['DROP(A1:C3,-1.5)', [[1, 2, 3], [4, 5, 6]]],
    ['DROP(A1:C3,0.5)', [[1, 2, 3], [4, 5, 6], [7, 8, 9]]], ['DROP(A1:C3,1,-2)', [[4], [7]]], ['DROP(A1:C3,-1,1)', [[2, 3], [5, 6]]],
  ]);
});

test('CHOOSECOLS: Microsoft examples', () => {
  const cells = {};
  for (let i = 0; i < 30; i++) cells[M.cellName(1 + Math.floor(i / 5), i % 5)] = i + 1;
  spills(book(cells), [['CHOOSECOLS(A2:E7,1,3,5,1)', [[1, 3, 5, 1], [6, 8, 10, 6], [11, 13, 15, 11], [16, 18, 20, 16], [21, 23, 25, 21], [26, 28, 30, 26]]]]);
  const rows = [[1, 2, 13, 14], [3, 4, 15, 16], [5, 6, 17, 18], [7, 8, 19, 20], [9, 10, 21, 22], [11, 12, 23, 24]], four = {};
  rows.forEach((line, i) => line.forEach((v, j) => { four[M.cellName(i + 1, j)] = v; }));
  spills(book(four), [
    ['CHOOSECOLS(A2:D7,3,4)', rows.map((line) => [line[2], line[3]])], ['CHOOSECOLS(A2:D7,-1,-2)', rows.map((line) => [line[3], line[2]])],
  ]);
});

test('CHOOSECOLS: 0 or past the size either way is #VALUE!, vectors of indices flatten', () => {
  const e = book(GRID);
  cases(e, [
    ['CHOOSECOLS(A1:C3,0)', VALUE], ['CHOOSECOLS(A1:C3,4)', VALUE], ['CHOOSECOLS(A1:C3,-4)', VALUE], ['CHOOSECOLS(A1:C3,0.5)', VALUE],
    ['CHOOSECOLS(A1:C3,{1,0})', VALUE], ['CHOOSECOLS(A1:C3,{1,2;3,1})', VALUE], ['CHOOSECOLS(A1:C3,E1)', VALUE], ['CHOOSECOLS(A1:C3,"x")', VALUE],
    ['CHOOSECOLS(A1:C3,1/0)', '#DIV/0!'], ['CHOOSECOLS(1/0,1)', '#DIV/0!'], ['CHOOSECOLS(5,1)', 5],
  ]);
  spills(e, [
    ['CHOOSECOLS(A1:C3,-3)', [[1], [4], [7]]], ['CHOOSECOLS(A1:C3,1.9)', [[1], [4], [7]]], ['CHOOSECOLS(A1:C3,-1.5)', [[3], [6], [9]]],
    ['CHOOSECOLS(A1:C3,{1,3})', [[1, 3], [4, 6], [7, 9]]], ['CHOOSECOLS(A1:C3,{1;3})', [[1, 3], [4, 6], [7, 9]]], ['CHOOSECOLS(A1:C3,"2")', [[2], [5], [8]]],
    ['CHOOSECOLS(A1:C3,TRUE)', [[1], [4], [7]]], ['CHOOSECOLS(A1:C3,A1:B1)', [[1, 2], [4, 5], [7, 8]]],
  ]);
});

test('CHOOSEROWS: Microsoft examples', () => {
  const cells = {};
  for (let i = 0; i < 12; i++) cells[M.cellName(1 + Math.floor(i / 2), i % 2)] = i + 1;
  spills(book(cells), [
    ['CHOOSEROWS(A2:B7,1,3,5,1)', [[1, 2], [5, 6], [9, 10], [1, 2]]], ['CHOOSEROWS(A2:B7,{1,3},5,1)', [[1, 2], [5, 6], [9, 10], [1, 2]]],
    ['CHOOSEROWS(A2:B7,-1,-2)', [[11, 12], [9, 10]]],
  ]);
});

test('CHOOSEROWS: the same index rules', () => {
  const e = book(GRID);
  cases(e, [['CHOOSEROWS(A1:C3,4)', VALUE], ['CHOOSEROWS(A1:C3,-4)', VALUE], ['CHOOSEROWS(A1:C3,0)', VALUE], ['CHOOSEROWS(A1:C3,"x")', VALUE], ['CHOOSEROWS(A1:C3,{1,"a"})', VALUE], ['CHOOSEROWS(5,1)', 5]]);
  spills(e, [['CHOOSEROWS(A1:C3,{1,3},-1)', [[1, 2, 3], [7, 8, 9], [7, 8, 9]]], ['CHOOSEROWS(F1:H2,-1)', [[10, 0, 'y']]]]);
});

test('VSTACK: Microsoft examples', () => {
  spills(book({ A2: 'A', B2: 'B', C2: 'C', A3: 'AA', B3: 'BB', C3: 'CC', E2: 'D', F2: 'E', G2: 'F', E3: 'DD', F3: 'EE', G3: 'FF' }), [
    ['VSTACK(A2:C3,E2:G3)', [['A', 'B', 'C'], ['AA', 'BB', 'CC'], ['D', 'E', 'F'], ['DD', 'EE', 'FF']]],
  ]);
  spills(book({ A2: 1, B2: 2, A3: 'A', B3: 'B', A4: 3, B4: 4, C2: 'X', D2: 'Y', C3: 'C', D3: 'D', E2: 5, F2: 6 }), [
    ['VSTACK(A2:B4,C2:D3,E2:F2)', [[1, 2], ['A', 'B'], [3, 4], ['X', 'Y'], ['C', 'D'], [5, 6]]],
  ]);
  spills(book({ A2: 1, B2: 2, A3: 'A', B3: 'B', A4: 3, B4: 4, C2: 'X', D2: 'Y', E2: 'Z', C3: 'C', D3: 'D', E3: 'E', F2: 5 }), [
    ['VSTACK(A2:B4,C2:E3,F2)', [[1, 2, NA], ['A', 'B', NA], [3, 4, NA], ['X', 'Y', 'Z'], ['C', 'D', 'E'], [5, NA, NA]]],
  ]);
});

test('HSTACK: Microsoft examples', () => {
  spills(book({ A2: 'A', B2: 'B', C2: 'C', A3: 'D', B3: 'E', C3: 'F', E2: 'AA', F2: 'BB', G2: 'CC', E3: 'DD', F3: 'EE', G3: 'FF' }), [
    ['HSTACK(A2:C3,E2:G3)', [['A', 'B', 'C', 'AA', 'BB', 'CC'], ['D', 'E', 'F', 'DD', 'EE', 'FF']]],
  ]);
  spills(book({ A2: 1, B2: 2, A3: 'A', B3: 'B', A4: 3, B4: 4, C2: 'X', D2: 'Y', C3: 'C', D3: 'D', E2: 5, F2: 6 }), [
    ['HSTACK(A2:B4,C2:D3,E2:F2)', [[1, 2, 'X', 'Y', 5, 6], ['A', 'B', 'C', 'D', NA, NA], [3, 4, NA, NA, NA, NA]]],
    // A blank cell stacks as a blank, which shows as 0.
    ['HSTACK(A2:B4,C2:D3,E2:F3)', [[1, 2, 'X', 'Y', 5, 6], ['A', 'B', 'C', 'D', 0, 0], [3, 4, NA, NA, NA, NA]]],
  ]);
});

test('VSTACK and HSTACK: #N/A pads, a lone error argument is that error, blanks stay blank', () => {
  const e = book(GRID);
  cases(e, [['VSTACK(1/0,1)', '#DIV/0!'], ['HSTACK(1,NA())', NA], ['VSTACK(A1:B2,C1:C1)', 1], ['INDEX(VSTACK(A1:B2,C1),3,2)', NA]]);
  spills(e, [
    ['VSTACK(A1:B2,C1)', [[1, 2], [4, 5], [3, NA]]], ['VSTACK(A1:A2,"x")', [[1], [4], ['x']]], ['VSTACK(F1:H2)', [['x', '#DIV/0!', 0], [10, 0, 'y']]],
    ['HSTACK(A1:B2,C1)', [[1, 2, 3], [4, 5, NA]]], ['HSTACK(1,{2;3})', [[1, 2], [NA, 3]]], ['VSTACK({1,#N/A},2)', [[1, NA], [2, NA]]],
  ]);
  assert.equal(calc(e, 'ISBLANK(INDEX(VSTACK(E1:E2,A1),1))'), true);
  assert.equal(calc(e, 'ISBLANK(INDEX(HSTACK(E1,A1),1,1))'), true);
});

test('EXPAND: Microsoft examples', () => {
  const e = book({ A2: 1, B2: 2, A3: 3, B3: 4 });
  spills(e, [
    ['EXPAND(A2:B3,3,3)', [[1, 2, NA], [3, 4, NA], [NA, NA, NA]]],
    ['EXPAND(A2,3,3,"-")', [[1, '-', '-'], ['-', '-', '-'], ['-', '-', '-']]],
  ]);
});

test('EXPAND: smaller than the array is #VALUE!, an omitted size keeps it, pads as given', () => {
  const e = book(GRID);
  cases(e, [
    ['EXPAND(A1:B2,1)', VALUE], ['EXPAND(A1:B2,0)', VALUE], ['EXPAND(A1:B2,-1)', VALUE], ['EXPAND(A1:B2,1.5)', VALUE], ['EXPAND(A1:B2,2,1)', VALUE],
    ['EXPAND(A1:B2,3,3,{7,8})', VALUE], ['EXPAND(A1:B2,2000000,1)', VALUE], ['EXPAND(A1:B2,"x")', VALUE], ['EXPAND(1/0,2)', '#DIV/0!'],
    ['EXPAND(A1,600,600)', NUM],
  ]);
  spills(e, [
    ['EXPAND(A1:B2,3)', [[1, 2], [4, 5], [NA, NA]]], ['EXPAND(A1:B2,,3)', [[1, 2, NA], [4, 5, NA]]], ['EXPAND(A1:B2,2.9,3.1)', [[1, 2, NA], [4, 5, NA]]],
    ['EXPAND(A1:B2,3,,0)', [[1, 2], [4, 5], [0, 0]]], ['EXPAND(A1:B2,,,"-")', [[1, 2], [4, 5]]], ['EXPAND(A1:B2,"3")', [[1, 2], [4, 5], [NA, NA]]],
    ['EXPAND(A1:B2,3,3,1/0)', [[1, 2, '#DIV/0!'], [4, 5, '#DIV/0!'], ['#DIV/0!', '#DIV/0!', '#DIV/0!']]],
  ]);
  // A blank pad cell pads with blanks.
  assert.equal(calc(e, 'ISBLANK(INDEX(EXPAND(A1:B2,3,3,E1),3,3))'), true);
});

const NAMES_GRID = { A2: 'Ben', B2: 'Peter', C2: 'Mary', D2: 'Sam', A3: 'John', B3: 'Hillary', C3: 'Jenny', D3: 'James', A4: 'Agnes', B4: 'Harry', C4: 'Felicity', D4: 'Joe' };
const { C4, D4, ...WITH_BLANKS } = NAMES_GRID;
const ALL = ['Ben', 'Peter', 'Mary', 'Sam', 'John', 'Hillary', 'Jenny', 'James', 'Agnes', 'Harry'];
const BY_COLUMN = ['Ben', 'John', 'Agnes', 'Peter', 'Hillary', 'Harry', 'Mary', 'Jenny', 'Sam', 'James'];

test('TOCOL and TOROW: Microsoft examples', () => {
  const full = book(NAMES_GRID), gaps = book(WITH_BLANKS);
  spills(full, [['TOCOL(A2:D4)', [...ALL, 'Felicity', 'Joe'].map((v) => [v])], ['TOROW(A2:D4)', [[...ALL, 'Felicity', 'Joe']]]]);
  spills(gaps, [
    ['TOCOL(A2:D4)', [...ALL, 0, 0].map((v) => [v])], ['TOCOL(A2:D4,1)', ALL.map((v) => [v])], ['TOCOL(A2:D4,1,TRUE)', BY_COLUMN.map((v) => [v])],
    ['TOROW(A2:D4)', [[...ALL, 0, 0]]], ['TOROW(A2:D4,1)', [ALL]], ['TOROW(A2:D4,1,TRUE)', [BY_COLUMN]],
  ]);
});

test('TOCOL and TOROW: ignore 0-3 truncated, else #VALUE!; nothing left is #CALC!', () => {
  const e = book(GRID);
  cases(e, [
    ['TOCOL(F1:H2,4)', VALUE], ['TOCOL(F1:H2,-1)', VALUE], ['TOCOL(F1:H2,"x")', VALUE], ['TOCOL(F1:H2,,"x")', VALUE], ['TOCOL(F1:H2,1/0)', '#DIV/0!'],
    ['TOCOL(E1:E3,1)', CALC], ['TOROW(E1:E3,1)', CALC], ['TOCOL(G1,2)', CALC], ['TOCOL(1/0)', '#DIV/0!'], ['TOCOL(5)', 5], ['TOROW(5)', 5],
  ]);
  spills(e, [
    ['TOCOL(F1:H2)', [['x'], ['#DIV/0!'], [0], [10], [0], ['y']]], ['TOCOL(F1:H2,1)', [['x'], ['#DIV/0!'], [10], ['y']]],
    ['TOCOL(F1:H2,2)', [['x'], [0], [10], [0], ['y']]], ['TOCOL(F1:H2,3)', [['x'], [10], ['y']]], ['TOCOL(F1:H2,0,TRUE)', [['x'], [10], ['#DIV/0!'], [0], [0], ['y']]],
    ['TOCOL(F1:H2,3,TRUE)', [['x'], [10], ['y']]], ['TOCOL(F1:H2,1.5)', [['x'], ['#DIV/0!'], [10], ['y']]], ['TOCOL(F1:H2,2.9)', [['x'], [0], [10], [0], ['y']]],
    ['TOCOL(F1:H2,"1")', [['x'], ['#DIV/0!'], [10], ['y']]], ['TOCOL(F1:H2,TRUE)', [['x'], ['#DIV/0!'], [10], ['y']]], ['TOCOL(F1:H2,,2)', [['x'], [10], ['#DIV/0!'], [0], [0], ['y']]],
    ['TOCOL({1,2;3,4},,TRUE)', [[1], [3], [2], [4]]], ['TOROW(F1:H2,3)', [['x', 10, 'y']]], ['TOROW(F1:H2,,TRUE)', [['x', 10, '#DIV/0!', 0, 0, 'y']]],
  ]);
  // Without ignore, a blank stays blank.
  assert.equal(calc(e, 'ISBLANK(INDEX(TOCOL(E1:E3),2))'), true);
});

test('WRAPROWS and WRAPCOLS: Microsoft examples', () => {
  const e = book({ A2: 'A', B2: 'B', C2: 'C', D2: 'D', E2: 'E', F2: 'F', G2: 'G' });
  spills(e, [
    ['WRAPROWS(A2:G2,3)', [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', NA, NA]]], ['WRAPROWS(A2:G2,3,"x")', [['A', 'B', 'C'], ['D', 'E', 'F'], ['G', 'x', 'x']]],
    ['WRAPCOLS(A2:F2,3)', [['A', 'D'], ['B', 'E'], ['C', 'F']]], ['WRAPCOLS(A2:G2,3,"x")', [['A', 'D', 'G'], ['B', 'E', 'x'], ['C', 'F', 'x']]],
  ]);
});

test('WRAPROWS and WRAPCOLS: a vector only, wrap_count below 1 is #NUM!, pads as given', () => {
  const e = book(GRID);
  cases(e, [
    ['WRAPROWS(A1:C3,2)', VALUE], ['WRAPCOLS(A1:C3,2)', VALUE], ['WRAPROWS(A1:C1,0)', NUM], ['WRAPROWS(A1:C1,0.5)', NUM], ['WRAPROWS(A1:C1,-1)', NUM],
    ['WRAPCOLS(A1:C1,0)', NUM], ['WRAPROWS(1/0,1)', '#DIV/0!'], ['WRAPROWS(A1:C1,1/0)', '#DIV/0!'], ['WRAPROWS(A1:C1,"x")', VALUE], ['WRAPROWS(5,2)', 5],
  ]);
  spills(e, [
    ['WRAPROWS(A1:C1,5)', [[1, 2, 3]]], ['WRAPROWS(A1:C1,1000000)', [[1, 2, 3]]], ['WRAPROWS(A1:C1,1.9)', [[1], [2], [3]]], ['WRAPROWS(A1:A3,2)', [[1, 4], [7, NA]]],
    ['WRAPROWS(A1:C1,2,"x")', [[1, 2], [3, 'x']]], ['WRAPROWS(F1:H1,2)', [['x', '#DIV/0!'], [0, NA]]], ['WRAPROWS(A1:C1,"2")', [[1, 2], [3, NA]]],
    ['WRAPROWS(A1:C1,2,1/0)', [[1, 2], [3, '#DIV/0!']]], ['WRAPCOLS(A1:C1,2)', [[1, 3], [2, NA]]], ['WRAPCOLS(A1:A3,5)', [[1], [4], [7]]],
    ['WRAPCOLS(A1:C1,2,"x")', [[1, 3], [2, 'x']]], ['WRAPROWS(E1:E3,2)', [[0, 0], [0, NA]]],
  ]);
  assert.equal(calc(e, 'ISBLANK(INDEX(WRAPROWS(A1:C1,2,E1),2,2))'), true);
});

test('past the cell cap is #NUM!', () => {
  const e = book(GRID);
  cases(e, [
    ['VSTACK(SEQUENCE(200000),SEQUENCE(200000))', NUM], ['HSTACK(SEQUENCE(1,10000),SEQUENCE(30,1))', NUM], ['EXPAND(1,250001)', NUM],
    ['ROWS(VSTACK(SEQUENCE(100000),SEQUENCE(100000)))', 200000],
  ]);
});

test('AREAS: Microsoft examples, references only, a 3-D reference #VALUE!', () => {
  const e = book(GRID, { sheets: ['Jan', 'Feb', 'Mar'] });
  cases(e, [
    ['AREAS(B2:D4)', 1], ['AREAS((B2:D4,E5,F6:I9))', 3], ['AREAS(B2:D4 B2)', 1],
    ['AREAS(A1)', 1], ['AREAS(E1)', 1], ['AREAS(INDEX(A1:C3,1,1))', 1], ['AREAS(INDIRECT("A1"))', 1], ['AREAS(A1:B2 C3)', '#NULL!'],
    ['AREAS(INDIRECT("nowhere"))', '#REF!'], ['AREAS(Jan:Mar!B2)', VALUE], ['AREAS((Jan:Mar!B2,B1))', VALUE], ['AREAS(Jan:Jan!B2)', 1],
    // Excel refuses these formulas; the engine says what ROW and COLUMN say of a value that is no reference.
    ['AREAS({1,2})', VALUE], ['AREAS(5)', VALUE], ['AREAS(1/0)', '#DIV/0!'],
  ]);
});

test('golden cases', () => {
  const data = { 'Data!K1': 'id', 'Data!L1': 'name', 'Data!M1': 'score' };
  [3, 1, 4, 1, 5, 9, 2, 6, 5, 3].forEach((v, i) => { data[`Data!A${i + 1}`] = v; });
  [[101, 'Ann', 88], [102, 'Bob', 95], [103, 'Cy', 72], [104, 'Dee', 95], [105, 'Eve', 60]].forEach(([a, b, c], i) => {
    Object.assign(data, { [`Data!K${i + 2}`]: a, [`Data!L${i + 2}`]: b, [`Data!M${i + 2}`]: c });
  });
  const e = book(data, { sheets: ['Sheet1', 'Data'] });
  cases(e, [
    ['AREAS((Data!A1:A2,Data!B1:B3))', 2], ['SUM(TAKE(Data!A1:A10,3))', 8], ['SUM(DROP(Data!A1:A10,8))', 8],
    ['SUM(CHOOSECOLS(Data!K2:M6,3))', 410], ['INDEX(VSTACK({1,2},{3,4}),2,1)', 3],
  ]);
});
