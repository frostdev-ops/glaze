// The information functions (lib/sheet-fn-info.js). Cases are the worked examples on Microsoft's page for each function
// (support.microsoft.com/en-us/excel/functions/<name>-function; the IS functions share is-functions), its table laid out
// as it lands pasted at A1; CELL's and COLUMN's examples are images, so their data come from the images. CELL("format")
// follows the page's table of formats and codes. Edge cases follow each page's Remarks.
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

// A calculated workbook from { 'A1': typed input, 'Sheet2!B1': ... }. An input { f, a } is an array formula over a; { v,
// s } a number with style s. Names may be scoped to a sheet by its name.
const book = (cells = {}, { sheets = ['Sheet1'], names = [], styles = [] } = {}) => {
  const wb = M.workbook();
  wb.sheets[0].name = sheets[0];
  for (const name of sheets.slice(1)) M.apply(wb, { op: 'addSheet', at: wb.sheets.length, name });
  wb.styles.push(...styles);
  for (const x of names) wb.names.push(x.sheet ? { ...x, sheet: M.getSheet(wb, x.sheet).id } : x);
  for (const [at, input] of Object.entries(cells)) {
    const [sheet, ref] = at.includes('!') ? at.split('!') : [sheets[0], at];
    let cell;
    if (input && typeof input === 'object') cell = input.f !== undefined ? { t: 'n', v: 0, f: input.f, a: input.a } : { t: 'n', v: input.v, s: input.s };
    else {
      const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
      cell = x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v };
    }
    M.apply(wb, { op: 'set', sheet: M.getSheet(wb, sheet).id, r: M.cellPosition(ref)[0], c: M.cellPosition(ref)[1], cell });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const where = (e, at) => {
  const [sheet, ref] = at.includes('!') ? at.split('!') : [null, at];
  return [(sheet ? M.getSheet(e.wb, sheet) : e.wb.sheets[0]).id, ...M.cellPosition(ref)];
};
const out = (x) => (C.isErr(x) ? x.code : x);
const val = (e, at) => out(e.value(...where(e, at)));
const calc = (e, f, at = 'Z100') => out(e.evaluate(f, ...where(e, at)));
const cases = (e, rows, at) => { for (const [f, want] of rows) assert.equal(calc(e, f, at), want, f); };

test('the information functions are registered', () => {
  const names = 'ISBLANK ISERR ISERROR ISNA ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISREF ISEVEN ISODD ISFORMULA N T TYPE ERROR.TYPE NA CELL INFO SHEET SHEETS ROW ROWS COLUMN COLUMNS FORMULATEXT'.split(' ');
  for (const name of names) assert.ok(C.fn(name), name);
  assert.ok(C.fn('CELL').volatile && C.fn('INFO').volatile && C.fn('SHEET').volatile);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-info.js'), 'utf8')), 'no timers');
});

test('the IS functions, with Microsoft\'s examples: values are not converted', () => {
  const e = book({ A1: 'Data', A2: 'Gold', A3: 'Region1', A4: '#REF!', A5: 330.92, A6: '#N/A', A7: 'Formula', B1: '=""', C1: '=1/0' });
  cases(e, [
    ['ISLOGICAL(TRUE)', true], ['ISLOGICAL("TRUE")', false], ['ISNUMBER(4)', true], ['ISREF(G8)', true], ['ISREF(XYZ1)', false],
    ['ISBLANK(A2)', false], ['ISERROR(A4)', true], ['ISNA(A4)', false], ['ISNA(A6)', true], ['ISERR(A6)', false], ['ISNUMBER(A5)', true], ['ISTEXT(A3)', true],
    ['ISNUMBER("19")', false], ['ISNONTEXT(Z1)', true], ['ISNONTEXT(A3)', false], ['ISNONTEXT(A6)', true], ['ISBLANK(Z1)', true], ['ISBLANK(B1)', false],
    ['ISBLANK("")', false], ['ISERR(A4)', true], ['ISERR(C1)', true], ['ISERROR(C1)', true], ['ISERROR(1/0)', true], ['ISNA(NA())', true], ['ISTEXT(B1)', true],
    ['ISREF(A1:B2)', true], ['ISREF(Sheet1!A1)', true], ['ISREF((A1,B2))', true], ['ISREF(1)', false], ['ISREF("A1")', false], ['ISREF(A1:A2 B3:B4)', false],
    ['ISLOGICAL(1)', false], ['ISNUMBER(TRUE)', false], ['ISTEXT(1)', false],
  ]);
});

test('ISEVEN and ISODD truncate; dates are numbers; other values are #VALUE!', () => {
  const e = book({ A6: '12/23/2011' });
  cases(e, [
    ['ISEVEN(-1)', false], ['ISEVEN(2.5)', true], ['ISEVEN(5)', false], ['ISEVEN(0)', true], ['ISEVEN(A6)', true],
    ['ISODD(-1)', true], ['ISODD(2.5)', false], ['ISODD(5)', true], ['ISODD(-2.5)', false], ['ISEVEN("x")', '#VALUE!'], ['ISODD("x")', '#VALUE!'],
    ['ISEVEN(Z1)', true], ['ISEVEN(1/0)', '#DIV/0!'],
  ]);
  assert.equal(val(e, 'A6'), 40900);
});

test('ISFORMULA and FORMULATEXT read the cell\'s formula', () => {
  const e = book({
    A2: '=TODAY()', A3: 7, A4: 'Hello, world!', A5: '=3/0', C2: '=FORMULATEXT(C2)', D1: { f: 'A3*{1;2}', a: 'D1:D2' }, 'Sheet2!A1': '=Sheet1!A3+1',
  }, { sheets: ['Sheet1', 'Sheet2'], names: [{ name: 'Rate', ref: '0.05' }, { name: 'Cell', ref: 'Sheet1!$A$5' }] });
  cases(e, [
    ['ISFORMULA(A2)', true], ['ISFORMULA(A3)', false], ['ISFORMULA(A4)', false], ['ISFORMULA(A5)', true], ['ISFORMULA(Z1)', false],
    ['ISFORMULA(Cell)', true], ['ISFORMULA(Rate)', '#VALUE!'], ['ISFORMULA(5)', '#VALUE!'], ['ISFORMULA(D2)', true], ['ISFORMULA(Sheet2!A1)', true],
    ['FORMULATEXT(A2)', '=TODAY()'], ['FORMULATEXT(A5)', '=3/0'], ['FORMULATEXT(A3)', '#N/A'], ['FORMULATEXT(Z1)', '#N/A'], ['FORMULATEXT(A2:A5)', '=TODAY()'],
    ['FORMULATEXT(A:A)', '#N/A'], ['FORMULATEXT(5)', '#VALUE!'], ['FORMULATEXT(Sheet2!A1)', '=Sheet1!A3+1'], ['FORMULATEXT(D2)', '{=A3*{1;2}}'],
  ]);
  assert.equal(val(e, 'C2'), '=FORMULATEXT(C2)', 'its own cell, with no circular reference');
  assert.deepEqual(e.status.circular, []);
  e.edit(e.wb.sheets[0].id, 2, 0, '=1+1');
  assert.equal(calc(e, 'FORMULATEXT(A3)'), '=1+1');
});

test('N, T, TYPE, ERROR.TYPE, NA', () => {
  const n = book({ A1: 'Data', A2: 7, A3: 'Even', A4: true, A5: '4/17/2011' });
  cases(n, [['N(A2)', 7], ['N(A3)', 0], ['N(A4)', 1], ['N(A5)', 40650], ['N("7")', 0], ['N(FALSE)', 0], ['N(Z1)', 0], ['N(1/0)', '#DIV/0!']]);
  const t = book({ A1: 'Data', A2: 'Rainfall', A3: 19, A4: true });
  cases(t, [['T(A2)', 'Rainfall'], ['T(A3)', ''], ['T(A4)', ''], ['T("x")', 'x']]);
  const ty = book({ A1: 'Data', A2: 'Smith', B1: '=1/0' });
  cases(ty, [
    ['TYPE(A2)', 2], ['TYPE("Mr. "&A2)', 2], ['TYPE(2+A2)', 16], ['(2+A2)', '#VALUE!'], ['TYPE({1,2;3,4})', 64],
    ['TYPE(1)', 1], ['TYPE(TRUE)', 4], ['TYPE(B1)', 16], ['TYPE(Z1)', 1],
  ]);
  const er = book({ A1: 'Data', A2: '#NULL!', A3: '#DIV/0!' });
  cases(er, [
    ['ERROR.TYPE(A2)', 1], ['ERROR.TYPE(A3)', 2], ['ERROR.TYPE(#VALUE!)', 3], ['ERROR.TYPE(#REF!)', 4], ['ERROR.TYPE(#NAME?)', 5],
    ['ERROR.TYPE(SQRT(-1))', 6], ['ERROR.TYPE(NA())', 7], ['ERROR.TYPE(1)', '#N/A'], ['ERROR.TYPE("x")', '#N/A'], ['IF(ERROR.TYPE(A3)<3,"The divisor is zero")', 'The divisor is zero'],
    ['NA()', '#N/A'], ['NA(1)', '#VALUE!'],
  ]);
});

test('CELL: address, col, row, contents, type and format; the rest and INFO are refused', () => {
  const formats = [
    ['General', 'G'], ['0', 'F0'], ['#,##0', ',0'], ['0.00', 'F2'], ['#,##0.00', ',2'], ['$#,##0_);($#,##0)', 'C0'], ['$#,##0_);[Red]($#,##0)', 'C0-'],
    ['$#,##0.00_);($#,##0.00)', 'C2'], ['$#,##0.00_);[Red]($#,##0.00)', 'C2-'], ['0%', 'P0'], ['0.00%', 'P2'], ['0.00E+00', 'S2'], ['# ?/?', 'G'], ['# ??/??', 'G'],
    ['m/d/yy', 'D4'], ['m/d/yy h:mm', 'D4'], ['mm/dd/yy', 'D4'], ['d-mmm-yy', 'D1'], ['dd-mmm-yy', 'D1'], ['d-mmm', 'D2'], ['dd-mmm', 'D2'], ['mmm-yy', 'D3'],
    ['mm/dd', 'D5'], ['h:mm AM/PM', 'D7'], ['h:mm:ss AM/PM', 'D6'], ['h:mm', 'D9'], ['h:mm:ss', 'D8'],
    // Built-in ids: "$" quoted, a four-digit year; parentheses around positives.
    [5, 'C0'], [8, 'C2-'], [14, 'D4'], [22, 'D4'], [10, 'P2'], ['(0.0);(0.0)', 'F1()'], ['0;[Red]-0', 'F0-'],
  ];
  const cells = { B1: 'Data', B2: 75, B3: 'Hello world!', B4: 2, B5: '=""', B6: '="x"' };
  formats.forEach((_, i) => { cells[`F${i + 1}`] = { v: 1, s: i + 1 }; });
  const e = book(cells, { sheets: ['Sheet1', 'Sheet 2'], styles: formats.map(([fmt]) => ({ fmt })) });
  cases(e, [
    ['CELL("row",B2)', 2], ['CELL("contents",B3)', 'Hello world!'], ['CELL("type",B4)', 'v'], ['CELL("type",B3)', 'l'], ['CELL("type",Z1)', 'b'],
    ['CELL("type",B5)', 'l'], ['CELL("type",B6)', 'l'], ['CELL("address",B2)', '$B$2'], ['CELL("address",B2:D9)', '$B$2'], ['CELL("col",D9)', 4], ['CELL("row",B2:D9)', 2],
    ['CELL("contents",B2:B4)', 75], ['CELL("ROW",B2)', 2], ['CELL("format",Z1)', 'G'], ['CELL("row")', 100], ['CELL("col")', 26], ['CELL("address")', '$Z$100'],
    ['CELL("color",B2)', '#VALUE!'], ['CELL("filename",B2)', '#VALUE!'], ['CELL("width",B2)', '#VALUE!'], ['CELL("prefix",B2)', '#VALUE!'],
    ['CELL("protect",B2)', '#VALUE!'], ['CELL("parentheses",B2)', '#VALUE!'], ['CELL("nonsense",B2)', '#VALUE!'], ['CELL("row",5)', '#VALUE!'],
    ['CELL("row",1/0)', '#DIV/0!'], ['INFO("numfile")', '#VALUE!'], ['INFO("recalc")', '#VALUE!'], ['INFO("system")', '#VALUE!'],
  ]);
  formats.forEach(([fmt, code], i) => assert.equal(calc(e, `CELL("format",F${i + 1})`), code, String(fmt)));
});

test('SHEET and SHEETS number sheets in the workbook\'s order', () => {
  const e = book({ A1: '=SHEET()', 'Stuff!A1': '=SHEET()' }, {
    sheets: ['Sheet1', 'Sales', 'Stuff'],
    names: [{ name: 'QSalesByRegion', ref: 'Sales!$A$1:$B$4' }, { name: 'Hi_Temps', ref: 'Stuff!$A$1', sheet: 'Stuff' }, { name: 'My3DRef', ref: 'Sales:Stuff!$A$1' }],
  });
  cases(e, [
    ['SHEET(QSalesByRegion)', 2], ['SHEET(Hi_Temps)', '#NAME?'], ['SHEET("Stuff")', 3], ['SHEET("stuff")', 3], ['SHEET("badSheetName")', '#N/A'], ['SHEET(Sheet1!#REF!)', '#REF!'],
    ['SHEET()', 1], ['SHEET(Stuff!B2)', 3], ['SHEET(Sales:Stuff!A1)', 2],
    ['SHEETS()', 3], ['SHEETS(My3DRef)', 2], ['SHEETS(Sales!A1)', 1], ['SHEETS(Sheet1:Stuff!A1:B2)', 3], ['SHEETS((A1,B2))', 1], ['SHEETS(5)', '#N/A'],
  ]);
  cases(e, [['SHEET()', 3], ['SHEET(Hi_Temps)', 3]], 'Stuff!B1');
  assert.deepEqual([val(e, 'A1'), val(e, 'Stuff!A1')], [1, 3]);
  e.apply({ op: 'moveSheet', sheet: M.getSheet(e.wb, 'Stuff').id, to: 0 });
  assert.deepEqual([val(e, 'Sheet1!A1'), val(e, 'Stuff!A1')], [2, 1], 'moving a sheet renumbers');
});

test('ROW, ROWS, COLUMN, COLUMNS', () => {
  const e = book({
    A2: '=ROW()', B1: '=COLUMN()', B9: { f: 'COLUMN(B2:D2)', a: 'B9:D9' }, E1: { f: 'ROW(A1:A3)', a: 'E1:E3' }, F1: { f: 'ROW(A:A)*0+1', a: 'F1:F2' }, G1: { f: 'SUM((A:A=2)*ROW(A:A))', a: 'G1' },
  });
  cases(e, [
    ['ROW(C10)', 10], ['COLUMN(B13)', 2], ['COLUMN(D10)', 4], ['ROWS(C1:E4)', 4], ['ROWS({1,2,3;4,5,6})', 2], ['COLUMNS(C1:E4)', 3], ['COLUMNS({1,2,3;4,5,6})', 3],
    ['ROW(C3:C5)', 3], ['COLUMN(C3:E3)', 3], ['SUM(ROW(A1:A3))', 6], ['SUM(COLUMN(A1:C1))', 6], ['ROWS(A:A)', 1048576], ['COLUMNS(1:1)', 16384],
    ['ROWS(5)', 1], ['ROW()', 100], ['COLUMN()', 26], ['ROW("A1")', '#VALUE!'], ['ROW((A1,B2))', '#REF!'], ['ROWS((A1,B2))', '#REF!'], ['ROW(1/0)', '#DIV/0!'],
  ]);
  assert.deepEqual([val(e, 'A2'), val(e, 'B1')], [2, 2]);
  assert.deepEqual(['B9', 'C9', 'D9'].map((r) => val(e, r)), [2, 3, 4], 'COLUMN of a range is a row of numbers');
  assert.deepEqual(['E1', 'E2', 'E3'].map((r) => val(e, r)), [1, 2, 3]);
  assert.deepEqual(['F1', 'F2'].map((r) => val(e, r)), [1, 1], 'ROW of a whole column in an array formula');
  assert.equal(val(e, 'G1'), 2, 'a whole column\'s rows pair with its values, both stopping at the used range');
});

// Excel 16.114.1: legacy formulas intersect references; an array formula keeps their array type.
test('TYPE observes implicit intersection and array-formula context', () => {
  const e = book({ A1: 1, A2: 'text', B1: true, C1: { f: 'TYPE(A1:A2)', a: 'C1' } });
  assert.equal(calc(e, 'TYPE(A1:A2)', 'Z2'), 2);
  assert.equal(calc(e, 'TYPE(A1:A2)', 'Z100'), 16);
  assert.equal(calc(e, 'TYPE((A1,B1))'), 16);
  assert.equal(calc(e, 'TYPE({1,2})'), 64);
  assert.equal(val(e, 'C1'), 64);
});

test('CELL uses the resulting text type and returns numeric zero for blank contents', () => {
  const e = book({ A1: '="text"', A2: '=""' });
  cases(e, [
    ['CELL("type",A1)', 'l'], ['CELL("type",A2)', 'l'],
    ['ISNUMBER(CELL("contents",Z1))', true], ['ISBLANK(CELL("contents",Z1))', false],
    ['SHEETS(TRUE)', '#N/A'], ['SHEETS("Sheet1")', '#N/A'], ['SHEETS({1,2})', '#N/A'],
  ]);
});
