// The calc engine (lib/sheet-calc.js) and the 40 core functions (lib/sheet-fn-math.js, -logical.js, -text.js).
// Function cases are the worked examples on Microsoft's page for each function, with their data; engine cases follow
// Excel's documented rules (dependency order, circular references read 0, the seven error values, implicit
// intersection, the final-operation rounding to 0 of KB 78113, criteria wildcards).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-text.js');

// A workbook from { 'A1': typed input, 'Sheet2!B1': ... }, calculated.
const book = (cells = {}, { sheets = ['Sheet1'], date1904 = false, names = [] } = {}) => {
  const wb = M.workbook({ date1904 });
  wb.sheets[0].name = sheets[0];
  for (const name of sheets.slice(1)) M.apply(wb, { op: 'addSheet', at: wb.sheets.length, name });
  wb.names.push(...names);
  for (const [at, input] of Object.entries(cells)) {
    const [sheet, ref] = at.includes('!') ? at.split('!') : [sheets[0], at];
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025, date1904 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    const cell = x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v };
    M.apply(wb, { op: 'set', sheet: M.getSheet(wb, sheet).id, r, c, cell });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const where = (e, at) => {
  const [sheet, ref] = at.includes('!') ? at.split('!') : [null, at];
  const sh = sheet ? M.getSheet(e.wb, sheet) : e.wb.sheets[0];
  const [r, c] = M.cellPosition(ref);
  return [sh.id, r, c];
};
const out = (x) => (C.isErr(x) ? x.code : x);
const val = (e, at) => out(e.value(...where(e, at)));
const calc = (e, text, at = 'Z100') => out(e.evaluate(text, ...where(e, at)));
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };

test('the 40 core functions are registered, each in its group\'s file', () => {
  const core = 'SUM AVERAGE COUNT COUNTA COUNTBLANK MIN MAX ROUND ROUNDUP ROUNDDOWN INT MOD ABS SQRT POWER SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIF IF IFS AND OR NOT IFERROR IFNA TRUE FALSE CONCAT CONCATENATE LEFT RIGHT MID LEN TRIM UPPER LOWER TEXT VALUE'.split(' ');
  assert.equal(core.length, 40);
  for (const name of core) assert.ok(C.fn(name), name);
  assert.equal(C.fn('NOSUCH'), null);
});

test('SUM, AVERAGE, MIN, MAX: typed arguments count text numbers and booleans, ranges count only numbers', () => {
  const e = book({ A2: 10, A3: 7, A4: 9, A5: 27, A6: 2, B1: 1, B2: "'2", B3: true, B4: '#DIV/0!', C1: -5, C2: 15, C3: 30 });
  cases(e, [
    ['SUM(C1:C3)', 40], ['SUM(C1:C3,15)', 55], ['SUM("3",2,TRUE)', 6], ['SUM(B1:B3)', 1], ['SUM(B1:B4)', '#DIV/0!'], ['SUM("abc")', '#VALUE!'],
    ['SUM()', '#VALUE!'], ['SUM(1,,2)', 3], ['SUM(Z1:Z9)', 0], ['SUM({1,2;3,4})', 10],
    ['AVERAGE(A2:A6)', 11], ['AVERAGE(A2:A6,5)', 10], ['AVERAGE(Z1:Z9)', '#DIV/0!'], ['AVERAGE(TRUE,3)', 2], ['AVERAGE(B1:B3)', 1],
    ['MIN(A2:A6)', 2], ['MAX(A2:A6)', 27], ['MIN(A2:A6,0)', 0], ['MAX(A2:A6,30)', 30], ['MAX(Z1:Z9)', 0], ['MIN(B2:B3)', 0], ['MAX("40",A2:A6)', 40],
  ]);
});

test('COUNT, COUNTA, COUNTBLANK', () => {
  // Microsoft's COUNT data: A2 "Data", A3 "Sales", A4 12/8/2008, A5 blank, A6 19, A7 22.24, A8 TRUE, A9 #DIV/0!
  const e = book({ A2: 'Data', A3: 'Sales', A4: '12/8/2008', A6: 19, A7: 22.24, A8: true, A9: '#DIV/0!', B1: 1, B3: '=""', B4: 'x', C1: '=1/0' });
  cases(e, [
    ['COUNT(A2:A8)', 3], ['COUNT(A5:A8)', 2], ['COUNT(A2:A8,2)', 4], ['COUNT("1",TRUE,"x",1/0)', 2], ['COUNT(A2:A9)', 3],
    ['COUNTA(A3:A8)', 5], ['COUNTA(A2:A9)', 7], ['COUNTA(B1:B4)', 3], ['COUNTA(C1)', 1], ['COUNTA(1,"",FALSE)', 3],
    ['COUNTBLANK(B1:B4)', 2], ['COUNTBLANK(A1:A9)', 2], ['COUNTBLANK(Z1:Z10)', 10], ['COUNTBLANK(A:A)', 1048576 - 7],
  ]);
});

test('ROUND, ROUNDUP, ROUNDDOWN, INT, MOD, ABS, SQRT, POWER', () => {
  const e = book();
  cases(e, [
    ['ROUND(2.15,1)', 2.2], ['ROUND(2.149,1)', 2.1], ['ROUND(-1.475,2)', -1.48], ['ROUND(21.5,-1)', 20], ['ROUND(626.3,-3)', 1000],
    ['ROUND(1.98,-1)', 0], ['ROUND(-50.55,-2)', -100], ['ROUND(2.675,2)', 2.68], ['ROUND(1.005,2)', 1.01], ['ROUND(1.5,400)', 1.5], ['ROUND(5,-400)', 0],
    ['ROUNDUP(3.2,0)', 4], ['ROUNDUP(76.9,0)', 77], ['ROUNDUP(3.14159,3)', 3.142], ['ROUNDUP(-3.14159,1)', -3.2], ['ROUNDUP(31415.92654,-2)', 31500],
    ['ROUNDDOWN(3.2,0)', 3], ['ROUNDDOWN(76.9,0)', 76], ['ROUNDDOWN(3.14159,3)', 3.141], ['ROUNDDOWN(-3.14159,1)', -3.1], ['ROUNDDOWN(31415.92654,-2)', 31400],
    ['ROUND("2.5",)', 3], ['ROUND(TRUE,0)', 1], ['ROUND("x",0)', '#VALUE!'],
    ['INT(8.9)', 8], ['INT(-8.9)', -9], ['MOD(3,2)', 1], ['MOD(-3,2)', 1], ['MOD(3,-2)', -1], ['MOD(-3,-2)', -1], ['MOD(3,0)', '#DIV/0!'],
    ['ABS(2)', 2], ['ABS(-2)', 2], ['SQRT(16)', 4], ['SQRT(-16)', '#NUM!'], ['SQRT(ABS(-16))', 4],
    ['POWER(5,2)', 25], ['POWER(0,0)', '#NUM!'], ['POWER(0,-1)', '#DIV/0!'], ['POWER(-8,1/3)', '#NUM!'], ['POWER(-2,3)', -8], ['POWER(10,400)', '#NUM!'],
  ]);
  near(calc(e, 'POWER(98.6,3.2)'), 2401077.222, 1e-9);
  near(calc(e, 'POWER(4,5/4)'), 5.656854249, 1e-9);
});

test('SUMIF and SUMIFS, with Microsoft\'s data', () => {
  const e = book({
    A2: 100000, A3: 200000, A4: 300000, A5: 400000, B2: 7000, B3: 14000, B4: 21000, B5: 28000, C2: 250000,
    E2: 'Vegetables', E3: 'Vegetables', E4: 'Fruits', E6: 'Vegetables', E7: 'Fruits',
    F2: 'Tomatoes', F3: 'Celery', F4: 'Oranges', F5: 'Butter', F6: 'Carrots', F7: 'Apples',
    G2: 2300, G3: 5500, G4: 800, G5: 400, G6: 4200, G7: 1200,
    I2: 5, I3: 4, I4: 15, I5: 3, I6: 22, I7: 12, I8: 10, I9: 33,
    J2: 'Apples', J3: 'Apples', J4: 'Artichokes', J5: 'Artichokes', J6: 'Bananas', J7: 'Bananas', J8: 'Carrots', J9: 'Carrots',
    K2: 'Tom', K3: 'Sarah', K4: 'Tom', K5: 'Sarah', K6: 'Tom', K7: 'Sarah', K8: 'Tom', K9: 'Sarah',
  });
  cases(e, [
    ['SUMIF(A2:A5,">160000",B2:B5)', 63000], ['SUMIF(A2:A5,">160000")', 900000], ['SUMIF(A2:A5,300000,B2:B5)', 21000],
    ['SUMIF(A2:A5,">"&C2,B2:B5)', 49000], ['SUMIF(E2:E7,"Fruits",G2:G7)', 2000], ['SUMIF(E2:E7,"vegetables",G2:G7)', 12000],
    ['SUMIF(F2:F7,"*es",G2:G7)', 4300], ['SUMIF(E2:E7,"",G2:G7)', 400], ['SUMIF(A2:A5,">160000",B2)', 63000],
    ['SUMIFS(I2:I9,J2:J9,"=A*",K2:K9,"Tom")', 20], ['SUMIFS(I2:I9,J2:J9,"<>Bananas",K2:K9,"Tom")', 30], ['SUMIFS(I2:I9,J2:J9,"A*",K2:K8,"Tom")', '#VALUE!'],
    ['SUM(SUMIF(E2:E7,{"Fruits","Vegetables"},G2:G7))', 14000],
  ]);
});

test('COUNTIF, COUNTIFS, AVERAGEIF, and what criteria strings mean', () => {
  const e = book({
    A2: 'apples', A3: 'oranges', A4: 'peaches', A5: 'apples', B2: 32, B3: 54, B4: 75, B5: 86,
    D2: 'Davidoski', D3: 'Burke', D4: 'Sundaram', D5: 'Levitan', E2: 'Yes', E3: 'Yes', E4: 'Yes', E5: 'No', F2: 'No', F3: 'Yes', F4: 'Yes', F5: 'Yes', G2: 'No', G3: 'No', G4: 'Yes', G5: 'Yes',
    I2: 1, I3: 2, I4: 3, I5: 4, I6: 5, I7: 6, J2: '5/1/2011', J3: '5/2/2011', J4: '5/3/2011', J5: '5/4/2011', J6: '5/5/2011', J7: '5/6/2011',
    L2: 100000, L3: 200000, L4: 300000, L5: 400000, M2: 7000, M3: 14000, M4: 21000, M5: 28000,
    O1: 1, O2: "'1", O3: 'a*b', O4: 'aXb', O5: '=""', O6: true, O7: '#N/A', O8: "'TRUE",
  });
  cases(e, [
    ['COUNTIF(A2:A5,"apples")', 2], ['COUNTIF(A2:A5,A4)', 1], ['COUNTIF(A2:A5,A2)+COUNTIF(A2:A5,A3)', 3], ['COUNTIF(B2:B5,">55")', 2],
    ['COUNTIF(B2:B5,"<>"&B4)', 3], ['COUNTIF(B2:B5,">=32")-COUNTIF(B2:B5,">85")', 3], ['COUNTIF(A2:A5,"*")', 4], ['COUNTIF(A2:A5,"?????es")', 2],
    ['COUNTIF(A2:A5,"APPLES")', 2],
    ['COUNTIFS(E2:G2,"=Yes")', 1], ['COUNTIFS(E2:E5,"=Yes",F2:F5,"=Yes")', 2], ['COUNTIFS(E5:G5,"=Yes",E3:G3,"=Yes")', 1],
    ['COUNTIFS(I2:I7,"<6",I2:I7,">1")', 4], ['COUNTIFS(I2:I7,"<5",J2:J7,"<5/3/2011")', 2], ['COUNTIFS(I2:I7,"<"&I6,J2:J7,"<"&J4)', 2],
    ['COUNTIFS(I2:I7,">1",J2:J6,">1")', '#VALUE!'],
    ['AVERAGEIF(M2:M5,"<23000")', 14000], ['AVERAGEIF(L2:L5,"<250000")', 150000], ['AVERAGEIF(L2:L5,"<95000")', '#DIV/0!'], ['AVERAGEIF(L2:L5,">250000",M2:M5)', 24500],
    ['COUNTIF(O1:O8,1)', 2], ['COUNTIF(O1:O8,"1")', 2], ['COUNTIF(O1:O8,">0")', 1], ['COUNTIF(O1:O8,"a~*b")', 1], ['COUNTIF(O1:O8,"a?b")', 2],
    ['COUNTIF(O1:O8,TRUE)', 1], ['COUNTIF(O1:O8,"TRUE")', 1], ['COUNTIF(O1:O8,"#N/A")', 1], ['COUNTIF(O1:O8,"")', 1], ['COUNTIF(O1:O9,"")', 2],
    ['COUNTIF(O1:O9,"=")', 1], ['COUNTIF(O1:O8,"<>")', 8], ['COUNTIF(O1:O8,"<>1")', 6], ['COUNTIF(O1:O8,Z1)', 0], ['COUNTIF(A:A,"")', 1048572],
  ]);
});

test('IF, IFS, AND, OR, NOT, IFERROR, IFNA, TRUE, FALSE', () => {
  const e = book({ A2: 93, A3: 55, B2: 210, C2: 35, B3: 55, C3: 0, C4: 23, D1: true, D2: 'x', D3: 0 });
  cases(e, [
    ['IF(B2>C2,"Over Budget","OK")', 'Over Budget'], ['IF(FALSE,1)', false], ['IF(TRUE,)', 0], ['IF(FALSE,1,)', 0], ['IF("abc",1,2)', '#VALUE!'],
    ['IF("true",1,2)', 1], ['IF(1/0,1,2)', '#DIV/0!'], ['IF(TRUE,1,1/0)', 1], ['IF(Z1,1,2)', 2], ['IF(2,"y","n")', 'y'],
    ['IFS(A2>89,"A",A2>79,"B",A2>69,"C",A2>59,"D",TRUE,"F")', 'A'], ['IFS(A3>89,"A",A3>79,"B",A3>69,"C",A3>59,"D",TRUE,"F")', 'F'], ['IFS(FALSE,1)', '#N/A'],
    ['AND(TRUE,TRUE)', true], ['AND(TRUE,FALSE)', false], ['AND(2+2=4,2+3=5)', true], ['AND(D1:D3)', false], ['AND(D1:D2)', true], ['AND(D2)', '#VALUE!'],
    ['AND("abc")', '#VALUE!'], ['AND(FALSE,1/0)', '#DIV/0!'], ['OR(1+1=1,2+2=5)', false], ['OR(TRUE,FALSE)', true], ['OR(D2:D3)', false], ['NOT(FALSE)', true],
    ['NOT(1+1=2)', false], ['NOT("x")', '#VALUE!'],
    ['IFERROR(B2/C2,"Error in calculation")', 6], ['IFERROR(B3/C3,"Error in calculation")', 'Error in calculation'], ['IFERROR(B4/C4,"Error in calculation")', 0],
    ['IFNA(#N/A,"x")', 'x'], ['IFNA(1/0,"x")', '#DIV/0!'], ['IFNA(5,"x")', 5], ['TRUE()', true], ['FALSE()', false], ['TRUE(1)', '#VALUE!'],
  ]);
});

test('text: CONCAT, CONCATENATE, LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, TEXT, VALUE', () => {
  const e = book({ A1: 'x', A2: 2, B2: true, C2: 'brook trout', C3: 'species', C4: 32, D1: 0.1, D2: '=1/3' });
  cases(e, [
    ['CONCAT("a",A1:B2,1)', 'ax2TRUE1'], ['CONCATENATE("Stream population for ",C2," ",C3," is ",C4,"/mile")', 'Stream population for brook trout species is 32/mile'],
    ['CONCAT(D2)', '0.333333333333333'], ['CONCAT(1/0,"a")', '#DIV/0!'], ['"a"&D1*3', 'a0.3'], ['1&2', '12'], ['REPT', '#NAME?'],
    ['LEFT("Sale Price",4)', 'Sale'], ['LEFT("Sweden")', 'S'], ['RIGHT("Sale Price",5)', 'Price'], ['RIGHT("Stock Number")', 'r'],
    ['MID("Fluid Flow",1,5)', 'Fluid'], ['MID("Fluid Flow",7,20)', 'Flow'], ['MID("Fluid Flow",20,5)', ''], ['LEFT("abc",-1)', '#VALUE!'],
    ['MID("abc",0,1)', '#VALUE!'], ['LEFT(12345,2)', '12'], ['RIGHT(TRUE,2)', 'UE'],
    ['LEN("Phoenix, AZ")', 11], ['LEN("")', 0], ['LEN("     One   ")', 11], ['LEN(Z9)', 0], ['LEN(1/3)', 17],
    ['TRIM(" First Quarter Earnings ")', 'First Quarter Earnings'], ['TRIM("a   b")', 'a b'], ['UPPER("total")', 'TOTAL'], ['LOWER("E. E. Cummings")', 'e. e. cummings'],
    ['TEXT(1234.567,"$#,##0.00")', '$1,234.57'], ['TEXT(0.285,"0.0%")', '28.5%'], ['TEXT(4.34,"# ?/?")', '4 1/3'],
    ['TEXT(1234567898,"[<=9999999]###-####;(###) ###-####")', '(123) 456-7898'], ['TEXT(1234,"0000000")', '0001234'],
    ["TEXT(123456,\"##0° 00' 00''\")", "12° 34' 56''"], ['TEXT(45720,"dddd")', 'Tuesday'], ['TEXT("12","0.00")', '12.00'], ['TEXT("abc","0")', 'abc'],
    ['TEXT(1,"[Purple]0")', '#VALUE!'], ['TEXT(-1,"yyyy")', '#VALUE!'], ['TEXT(TRUE,"0")', 'TRUE'],
    ['VALUE("$1,000")', 1000], ['VALUE("abc")', '#VALUE!'], ['VALUE("12%")', 0.12], ['VALUE(5)', 5], ['VALUE("3/4/2025")', 45720],
  ]);
  near(calc(e, 'VALUE("16:48:00")-VALUE("12:00:00")'), 0.2, 1e-12);
});

test('operators: arithmetic, the seven errors, Excel\'s comparison order, blank coercion', () => {
  const e = book({ A1: 3, B1: 'abc', B2: "'7" });
  cases(e, [
    ['1/0', '#DIV/0!'], ['#N/A+1', '#N/A'], ['NOSUCH(1)', '#NAME?'], ['Nowhere*2', '#NAME?'], ['Sheet9!A1', '#REF!'], ['A1:A2 B1:B2', '#NULL!'],
    ['"a"+1', '#VALUE!'], ['SQRT(-1)', '#NUM!'], ['B1*2', '#VALUE!'], ['B2*2', 14], ['"1,000"+1', 1001], ['"3/4/2025"+0', 45720], ['""+1', '#VALUE!'],
    ['TRUE+TRUE', 2], ['-2^2', 4], ['2^3^2', 64], ['2^-1', 0.5], ['50%', 0.5], ['A1%*100', 3], ['10^309', '#NUM!'], ['(-8)^(1/3)', '#NUM!'],
    ['"a"="A"', true], ['1<"a"', true], ['"z"<TRUE', true], ['FALSE<TRUE', true], ['"abc"<"abd"', true], ['"B">"a"', true], ['2>"1"', false],
    ['Z1=0', true], ['Z1=""', true], ['Z1=FALSE', true], ['Z1+1', 1], ['"x"&Z1', 'x'], ['Z1', 0], ['-Z1', 0], ['+B1', 'abc'],
    ['0.1+0.2=0.3', true], ['(0.5-0.4-0.1)', 0.5 - 0.4 - 0.1], ['0.5-0.4-0.1', 0],
  ]);
  assert.equal(calc(e, '1*(0.5-0.4-0.1)'), 0.5 - 0.4 - 0.1, 'KB 78113: only a final + or - rounds to 0');
  const errs = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);
  assert.deepEqual(Object.values(C.ERR).map((x) => x.code).sort(), [...errs].sort());
});

test('arrays as arguments; a single cell shows the top-left value; ranges intersect the formula\'s row or column', () => {
  const e = book({ A1: 1, A2: 2, A3: 3, B1: 'a', B2: 'b', B3: 'a', C2: '=A1:A3', C5: '=A1:A3', D2: '=A:A*10', E1: '=A1:C1', B5: '=A1:C1', E2: '={1,2}+{10;20}' });
  cases(e, [
    ['SUM({1,2}*2)', 6], ['SUM({1,2,3}+{10;20})', 102], ['SUM(COUNTIF(B1:B3,{"a","b"}))', 3], ['ROUND({1.25,2.35},1)', 1.3], ['{1,2}+{10;20}', 11],
    ['SUM({1,2}+{1,2,3})', '#N/A'], ['AND({TRUE,FALSE})', false], ['LEN({"ab","c"})', 2],
  ]);
  assert.equal(val(e, 'C2'), 2, 'a column range in row 2 reads row 2');
  assert.equal(val(e, 'C5'), '#VALUE!', 'no row 5 in A1:A3');
  assert.equal(val(e, 'D2'), 20);
  assert.equal(val(e, 'B5'), 'a', 'a row range in column B reads column B');
  assert.equal(val(e, 'E1'), '#VALUE!', 'no column E in A1:C1');
  assert.equal(val(e, 'E2'), 11);
  assert.equal(calc(e, 'SUM(A1:A3*2)', 'Z5'), '#VALUE!', 'outside an array formula a range in arithmetic intersects');
});

test('an array formula evaluates its ranges whole and fills its range', () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  const set = (ref, cell) => { const [r, c] = M.cellPosition(ref); M.apply(wb, { op: 'set', sheet: sh.id, r, c, cell }); };
  set('A1', { t: 'n', v: 1 }); set('A2', { t: 'n', v: 2 }); set('A3', { t: 'n', v: 3 });
  set('C1', { t: 'n', v: 0, f: 'SUM(A1:A3*2)', a: 'C1' });
  set('D1', { t: 'n', v: 0, f: 'A1:A3*10', a: 'D1:D4' });
  set('E1', { t: 'n', v: 0, f: 'D2+1' });
  const e = C.engine(wb);
  e.recalc();
  const v = (ref) => out(e.value(sh.id, ...M.cellPosition(ref)));
  assert.equal(v('C1'), 12);
  assert.deepEqual(['D1', 'D2', 'D3', 'D4'].map(v), [10, 20, 30, '#N/A']);
  assert.equal(v('E1'), 21);
  const { changed } = e.apply({ op: 'set', sheet: sh.id, r: 1, c: 0, cell: { t: 'n', v: 5 } });
  assert.deepEqual(['C1', 'D2', 'E1'].map(v), [18, 50, 51]);
  assert.ok(changed.some(([, r, c]) => r === 1 && c === 3), 'the filled cell D2 is reported changed');
  assert.throws(() => e.apply({ op: 'set', sheet: sh.id, r: 2, c: 3, cell: { t: 'n', v: 1 } }), (x) => x.code === 'array-part');
  e.apply({ op: 'clear', sheet: sh.id, r0: 0, c0: 3, r1: 3, c1: 3 });
  assert.equal(v('D2'), null);
  assert.equal(v('E1'), 1);
});

test('an array formula\'s range moves with it when rows or columns are inserted or deleted', () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  for (const [r, v] of [[0, 1], [1, 2], [2, 3]]) M.apply(wb, { op: 'set', sheet: sh.id, r, c: 0, cell: { t: 'n', v } });
  M.apply(wb, { op: 'cells', sheet: sh.id, cells: [[0, 3, { t: 'n', v: 0, f: 'A1:A3*10', a: 'D1:D3' }], [1, 3, null], [2, 3, null]] });
  const e = C.engine(wb);
  e.recalc();
  const ins = e.apply({ op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 1 });
  assert.equal(M.cell(sh, 1, 3).a, 'D2:D4');
  assert.equal(M.cell(sh, 1, 3).f, 'A2:A4*10');
  assert.deepEqual([1, 2, 3].map((r) => e.value(sh.id, r, 3)), [10, 20, 30]);
  e.apply({ op: 'insert', sheet: sh.id, axis: 'col', at: 0, n: 2 });
  assert.equal(M.cell(sh, 1, 5).a, 'F2:F4');
  assert.equal(e.value(sh.id, 3, 5), 30);
  e.apply({ op: 'delete', sheet: sh.id, axis: 'col', at: 0, n: 2 });
  e.apply(ins.inverse);
  assert.equal(M.cell(sh, 0, 3).a, 'D1:D3');
  assert.deepEqual([0, 1, 2].map((r) => e.value(sh.id, r, 3)), [10, 20, 30]);
});

test('edits recalculate only what depends on them, in order, and report what changed', () => {
  const e = book({ A1: 1, B1: '=A1*2', C1: '=B1+1', D1: '=SUM(A:A)', E1: 7, F1: '=E1' });
  assert.deepEqual([val(e, 'B1'), val(e, 'C1'), val(e, 'D1')], [2, 3, 1]);
  const id = e.wb.sheets[0].id;
  const { changed, inverse } = e.edit(id, 0, 0, '5');
  assert.deepEqual([val(e, 'B1'), val(e, 'C1'), val(e, 'D1')], [10, 11, 5]);
  const names = changed.map(([, r, c]) => M.cellName(r, c)).sort();
  assert.deepEqual(names, ['A1', 'B1', 'C1', 'D1']);
  e.edit(id, 99, 0, '10');
  assert.equal(val(e, 'D1'), 15, 'a whole-column reference sees a new cell');
  e.apply(inverse);
  assert.equal(val(e, 'A1'), 1);
  assert.equal(val(e, 'C1'), 3);
  e.edit(id, 0, 1, '=A1*3');
  assert.equal(val(e, 'C1'), 4, 'a replaced formula has its new precedents');
  e.edit(id, 0, 1, '');
  assert.equal(val(e, 'C1'), 1);
  assert.equal(val(e, 'B1'), null);
});

test('long chains recalculate without recursion, in either direction', () => {
  for (const reverse of [false, true]) {
    const wb = M.workbook();
    const sh = wb.sheets[0];
    const n = 30000;
    for (let r = 0; r < n; r++) {
      const cell = reverse ? (r === n - 1 ? { t: 'n', v: 1 } : { t: 'n', v: 0, f: `A${r + 2}+1` }) : (r === 0 ? { t: 'n', v: 1 } : { t: 'n', v: 0, f: `A${r}+1` });
      sh.rows.set(r, new Map([[0, cell]]));
    }
    const e = C.engine(wb);
    e.recalc();
    assert.equal(e.value(sh.id, reverse ? 0 : n - 1, 0), n);
    e.apply({ op: 'set', sheet: sh.id, r: reverse ? n - 1 : 0, c: 0, cell: { t: 'n', v: 101 } });
    assert.equal(e.value(sh.id, reverse ? 0 : n - 1, 0), n + 100);
  }
});

test('circular references read 0 and name a cell in the status; breaking the loop clears it', () => {
  const e = book({ A1: '=B1+1', B1: '=A1+1', C3: '=C3', D1: '=A1+10' }, { sheets: ['Sheet1', 'Sheet2'] });
  assert.deepEqual([val(e, 'A1'), val(e, 'B1'), val(e, 'C3'), val(e, 'D1')], [0, 0, 0, 10]);
  const refs = e.status.circular.map((x) => x.ref).sort();
  assert.deepEqual(refs, ['A1', 'B1', 'C3']);
  const id = e.wb.sheets[0].id;
  e.edit(id, 0, 1, '5');
  assert.deepEqual([val(e, 'A1'), val(e, 'D1')], [6, 16]);
  assert.deepEqual(e.status.circular.map((x) => x.ref), ['C3']);
  e.edit(e.wb.sheets[1].id, 0, 0, '=Sheet2!A1*2');
  assert.ok(e.status.circular.some((x) => x.ref === 'Sheet2!A1'), 'another sheet\'s cell carries its sheet');
});

test('volatile functions recalculate on every edit and never by themselves', () => {
  let ticks = 0;
  C.define('TESTTICK', { min: 0, max: 0, volatile: true, fn: () => ++ticks });
  const e = book({ A1: '=TESTTICK()', B1: '=A1*2', C1: 5 });
  assert.equal(val(e, 'B1'), 2);
  const id = e.wb.sheets[0].id;
  e.edit(id, 0, 2, '6');
  assert.equal(val(e, 'A1'), 2);
  assert.equal(val(e, 'B1'), 4, 'its dependents follow');
  e.edit(id, 50, 50, 'x');
  assert.equal(val(e, 'A1'), 3, 'an edit anywhere recalculates it');
  for (const name of ['NOW', 'TODAY', 'RAND', 'RANDBETWEEN', 'OFFSET', 'INDIRECT']) assert.ok(C.VOLATILE.has(name), name);
  for (const f of ['sheet-calc.js', 'sheet-fn-math.js', 'sheet-fn-logical.js', 'sheet-fn-text.js']) {
    assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', f), 'utf8')), `${f} sets no timer`);
  }
});

test('other sheets, 3-D references and defined names', () => {
  const e = book({ A1: 1, 'Sheet2!A1': 10, 'Sheet3!A1': 100, B1: '=SUM(Sheet1:Sheet3!A1)', B2: "='Sheet2'!A1*2", B3: '=Rate*100', B4: '=SUM(Data)', B5: '=Sheet1:Sheet3!A1', C1: 2, C2: 3 },
    { sheets: ['Sheet1', 'Sheet2', 'Sheet3'], names: [{ name: 'Rate', ref: '0.05' }, { name: 'Data', ref: 'Sheet1!$C$1:$C$2' }] });
  assert.deepEqual([val(e, 'B1'), val(e, 'B2'), val(e, 'B3'), val(e, 'B4'), val(e, 'B5')], [111, 20, 5, 5, '#VALUE!']);
  e.edit(M.getSheet(e.wb, 'Sheet2').id, 0, 0, '20');
  assert.deepEqual([val(e, 'B1'), val(e, 'B2')], [121, 40]);
  e.edit(e.wb.sheets[0].id, 1, 2, '30');
  assert.equal(val(e, 'B4'), 32, 'a name\'s range is a dependency');
  e.apply({ op: 'name', name: 'Rate', ref: '0.5' });
  assert.equal(val(e, 'B3'), 50);
  e.apply({ op: 'name', name: 'Rate', ref: null });
  assert.equal(val(e, 'B3'), '#NAME?');
});

test('inserting, deleting and renaming rewrite formulas and keep values; undo restores both', () => {
  const e = book({ A1: 1, A2: 2, A3: 3, B1: '=SUM(A1:A3)', B2: '=A3*2', 'Data!A1': '=Sheet1!A2' }, { sheets: ['Sheet1', 'Data'] });
  const id = e.wb.sheets[0].id, sh = e.wb.sheets[0];
  const ins = e.apply({ op: 'insert', sheet: id, axis: 'row', at: 1, n: 1 });
  assert.equal(M.cell(sh, 0, 1).f, 'SUM(A1:A4)');
  assert.equal(M.cell(sh, 2, 1).f, 'A4*2');
  assert.equal(M.cell(e.wb.sheets[1], 0, 0).f, 'Sheet1!A3');
  assert.deepEqual([val(e, 'B1'), val(e, 'B3'), val(e, 'Data!A1')], [6, 6, 2]);
  e.apply(ins.inverse);
  assert.equal(M.cell(sh, 0, 1).f, 'SUM(A1:A3)');
  const del = e.apply({ op: 'delete', sheet: id, axis: 'row', at: 2, n: 1 });
  assert.equal(M.cell(sh, 1, 1).f, '#REF!*2');
  assert.deepEqual([val(e, 'B1'), val(e, 'B2')], [3, '#REF!']);
  e.apply(del.inverse);
  assert.deepEqual([val(e, 'B1'), val(e, 'B2')], [6, 6]);
  e.apply({ op: 'rename', sheet: id, name: 'Main Sheet' });
  assert.equal(M.cell(e.wb.sheets[1], 0, 0).f, "'Main Sheet'!A2");
  assert.equal(val(e, 'Data!A1'), 2);
  e.apply({ op: 'removeSheet', sheet: id });
  assert.equal(val(e, 'Data!A1'), '#REF!');
});

test('structured and external references keep the value the file cached', () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  sh.rows.set(0, new Map([[0, { t: 'n', v: 42, f: 'SUM(Table1[Amount])' }], [1, { t: 's', v: 'kept', f: '[1]Sheet1!A1' }], [2, { t: 'n', v: 0, f: 'A1+1' }]]));
  const e = C.engine(wb);
  e.recalc();
  assert.deepEqual([e.value(sh.id, 0, 0), e.value(sh.id, 0, 1), e.value(sh.id, 0, 2)], [42, 'kept', 43]);
});

test('typed entry: a formula, a value, or a value that gives a General cell its format', () => {
  const e = book({ A1: 2 });
  const id = e.wb.sheets[0].id, sh = e.wb.sheets[0];
  e.edit(id, 0, 1, '=a1*3');
  assert.equal(M.cell(sh, 0, 1).f, 'A1*3', 'entered formulas are normalized');
  assert.equal(val(e, 'B1'), 6);
  e.edit(id, 0, 2, '12%');
  assert.equal(val(e, 'C1'), 0.12);
  assert.equal(e.wb.styles[M.cell(sh, 0, 2).s].fmt, '0%');
  e.edit(id, 0, 2, '7');
  assert.equal(e.wb.styles[M.cell(sh, 0, 2).s].fmt, '0%', 'a formatted cell keeps its format');
  assert.equal(e.edit(id, 0, 3, '=SUM(').error.code, 'syntax', 'a formula Excel would refuse is refused, nothing written');
  assert.equal(M.cell(sh, 0, 3), null);
  e.edit(id, 0, 4, "'=1+1");
  assert.equal(val(e, 'E1'), '=1+1');
});

test('the date system follows the workbook', () => {
  const e = book({ A1: '3/4/2025' }, { date1904: true });
  assert.equal(val(e, 'A1'), 45720 - 1462);
  assert.equal(calc(e, 'TEXT(A1,"m/d/yyyy")'), '3/4/2025');
  assert.equal(calc(e, 'VALUE("3/4/2025")'), 45720 - 1462);
});

test('a full recalculation of 50,000 formulas stays quick', (t) => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  for (let r = 0; r < 10000; r++) {
    sh.rows.set(r, new Map([[0, { t: 'n', v: r }], [1, { t: 'n', v: 0, f: `A${r + 1}*2` }], [2, { t: 'n', v: 0, f: `B${r + 1}+A${r + 1}` }],
      [3, { t: 'n', v: 0, f: `IF(C${r + 1}>100,"big","small")` }], [4, { t: 'n', v: 0, f: `SUM(A${r + 1}:C${r + 1})` }], [5, { t: 'n', v: 0, f: `COUNTIF(D${r + 1}:D${r + 10},"big")` }]]));
  }
  sh.rows.get(0).set(6, { t: 'n', v: 0, f: 'SUM(A:A)' });
  const t0 = performance.now();
  const e = C.engine(wb);
  e.recalc();
  const full = performance.now() - t0;
  assert.equal(e.value(sh.id, 9999, 4), 6 * 9999);
  assert.equal(e.value(sh.id, 0, 6), (9999 * 10000) / 2);
  const t1 = performance.now();
  e.apply({ op: 'set', sheet: sh.id, r: 5000, c: 0, cell: { t: 'n', v: 1 } });
  const edit = performance.now() - t1;
  assert.ok(full < 20000, `full recalc ${full.toFixed(0)} ms`);
  assert.ok(edit < 20000, `an edit ${edit.toFixed(0)} ms`);
  assert.equal(e.value(sh.id, 0, 6), (9999 * 10000) / 2 - 5000 + 1);
  t.diagnostic(`full ${full.toFixed(0)} ms, edit ${edit.toFixed(0)} ms`);
});

// Microsoft: Excel Recalculation, dirty precedents must settle before their dependents.
test('a returned range discovers dirty precedents outside its literal argument', () => {
  C.define('TESTOFFSET', { min: 1, max: 1, p: ['r'], volatile: true, fn: ([ref]) => new C.lib.Ref(ref.sheet, ref.r0 + 1, ref.c0, ref.r1 + 1, ref.c1) });
  const e = book({ C1: '=SUM(TESTOFFSET(A1))', A2: '=B2*2', B2: 3, D1: '=C1+1' });
  assert.equal(val(e, 'D1'), 7);
  e.edit(e.wb.sheets[0].id, 1, 1, '5');
  assert.equal(val(e, 'D1'), 11);
  e.edit(e.wb.sheets[0].id, 1, 0, '=C1');
  assert.equal(val(e, 'C1'), 0);
  assert.ok(e.status.circular.length);
});

test('cycles through cell names are reported and clearing a formula removes its reverse edges', () => {
  const e = book({ A1: '=Loop', B1: '=A1+1' }, { names: [{ name: 'Loop', ref: 'Sheet1!$B$1' }] });
  assert.deepEqual([val(e, 'A1'), val(e, 'B1')], [0, 0]);
  const id = e.wb.sheets[0].id;
  e.apply({ op: 'clear', sheet: id, r0: 0, r1: 0, c0: 1, c1: 1 });
  assert.equal(val(e, 'A1'), 0);
  assert.deepEqual(e.status.circular, []);
  e.edit(id, 0, 1, '8');
  assert.equal(val(e, 'A1'), 8);
  e.apply({ op: 'clear', sheet: id, r0: 0, r1: 0, c0: 0, c1: 0 });
  const dependents = [];
  e.dependents(id, 0, 1, (k) => dependents.push(k));
  assert.deepEqual(dependents, []);
});

test('array members count toward the cell cap before the engine allocates them', () => {
  const wb = M.workbook(), sh = wb.sheets[0];
  sh.rows.set(0, new Map([[0, { t: 'n', v: 0, f: '1', a: 'A1:A250001' }]]));
  const before = structuredClone(wb);
  // Stop a broken implementation at its first allocation rather than allocate the oversized array in this test.
  const original = sh.rows.set;
  sh.rows.set = () => { throw new Error('allocated before checking cap'); };
  assert.throws(() => C.engine(wb), (e) => e.code === 'cap-cells');
  delete sh.rows.set;
  assert.equal(sh.rows.set, original);
  assert.deepEqual(wb, before);
});

test('broadcast and materialized array values are bounded before allocation', () => {
  const result = C.lib.map([Array.from({ length: 501 }, () => [1]), [Array(501).fill(2)]], (a, b) => a + b);
  assert.ok(C.isErr(result) && result.code === '#NUM!');
  const wb = M.workbook(), sh = wb.sheets[0];
  sh.rows.set(0, new Map([[0, { t: 'n', v: 0, f: 'SUM(B1:ZZ1000*2)', a: 'A1' }]]));
  const e = C.engine(wb);
  e.recalc();
  assert.equal(out(e.value(sh.id, 0, 0)), '#NUM!');
});

test('reverse range queries skip disjoint row intervals', () => {
  const wb = M.workbook(), sh = wb.sheets[0];
  for (let r = 0; r < 10000; r += 2) sh.rows.set(r, new Map([[1, { t: 'n', v: 0, f: `SUM(A${r + 1}:A${r + 2})` }]]));
  const e = C.engine(wb);
  const col = e.index.get(sh.id).cols.get(0);
  // Count index entries visited, independent of machine speed.
  let visited = 0;
  const ranges = col.ranges;
  const iterator = ranges[Symbol.iterator].bind(ranges);
  ranges[Symbol.iterator] = function* () { for (const entry of iterator()) { visited++; yield entry; } };
  const found = [];
  e.dependents(sh.id, 5000, 0, (k) => found.push(k));
  assert.equal(found.length, 1);
  assert.ok(visited <= 21, `visited ${visited} disjoint intervals`);
});

test('creating an array through apply undoes its generated cells as well as its head', () => {
  const e = book({ D1: 9 }), id = e.wb.sheets[0].id;
  const before = structuredClone(e.wb);
  const { inverse } = e.apply({ op: 'set', sheet: id, r: 0, c: 0, cell: { t: 'n', v: 0, f: '{1;2;3}', a: 'A1:A3' } });
  assert.equal(val(e, 'A3'), 3);
  e.apply(inverse);
  assert.deepEqual(e.wb, before);
  assert.equal(e.members.size, 0);
});

test('applying an oversized array fails atomically before materializing its cells', () => {
  const e = book({ D1: 9 }), sh = e.wb.sheets[0];
  const before = structuredClone(e.wb);
  const original = sh.rows.set;
  sh.rows.set = () => { throw new Error('allocated before checking cap'); };
  assert.throws(() => e.apply({ op: 'set', sheet: sh.id, r: 0, c: 0, cell: { t: 'n', v: 0, f: '1', a: 'A1:A250001' } }), (x) => x.code === 'cap-cells');
  delete sh.rows.set;
  assert.equal(sh.rows.set, original);
  assert.deepEqual(e.wb, before);
});

// KB 78113 documents cancellation near zero; the exact boundaries and parentheses are verified in Excel 16.114.1.
test('final subtraction cancellation follows binary magnitude and excludes a parenthesized result', () => {
  const e = book();
  cases(e, [
    ['1-(1-15*2^-53)', 0], ['1-(1-16*2^-53)', 16 * 2 ** -53],
    ['0.75-(0.75-7*2^-53)', 0], ['0.75-(0.75-8*2^-53)', 8 * 2 ** -53],
    ['(1.333+1.225-1.333-1.225)', 1.333 + 1.225 - 1.333 - 1.225],
    ['1.333+1.225-1.333-1.225', 0],
  ]);
});

test('lib.used: a range of more than 4,096 rows or columns reads to the sheet\'s last used cell', () => {
  C.define('TESTUSED', { p: ['r'], min: 1, max: 1, fn: ([ref], ctx) => C.lib.used(ref, ctx).map((k, i) => k - (i ? ref.c0 : ref.r0) + 1).join('x') });
  const e = book({ C5: 1, E3: 2 });
  cases(e, [
    ['TESTUSED(A1:B2)', '2x2'], ['TESTUSED(A1:A4096)', '4096x1'], ['TESTUSED(A1:A4097)', '5x1'], ['TESTUSED(A:A)', '5x1'],
    ['TESTUSED(1:1)', '1x5'], ['TESTUSED(A:XFD)', '5x5'], ['TESTUSED(Z10:Z5000)', '1x1'], ['TESTUSED(B2:F5000)', '4x4'],
  ]);
});

test('define() refuses a name already defined, so no file can replace another\'s function', () => {
  const sum = C.fn('SUM');
  assert.throws(() => C.define('SUM', { fn: () => 0 }), /SUM is defined twice/);
  assert.equal(C.fn('SUM'), sum);
});

test('every function file loads beside the others', () => {
  const lib = path.join(__dirname, '..', 'lib');
  const files = fs.readdirSync(lib).filter((f) => /^sheet-fn-.*\.js$/.test(f)).map((f) => path.join(lib, f));
  const out = require('node:child_process').execFileSync(process.execPath, ['-e', `for (const f of ${JSON.stringify(files)}) require(f); console.log(require(${JSON.stringify(path.join(lib, 'sheet-calc.js'))}).fn('ROW') ? 'ok' : 'none')`], { encoding: 'utf8' });
  assert.equal(out.trim(), 'ok');
});

// Excel 16.114.1: an argument left out is a typed 0 to the aggregates, as to the statistical functions; COUNT and COUNTA
// count it; AND and OR read it as FALSE.
test('an argument left out counts as 0', () => {
  const e = book();
  cases(e, [
    ['AVERAGE(1,,3)', 4 / 3], ['MIN(1,,3)', 0], ['MAX(-1,,-3)', 0], ['SUM(1,,2)', 3], ['AVERAGE(,)', 0], ['MAX(,)', 0],
    ['COUNT(1,,3)', 3], ['COUNTA(1,,3)', 3], ['COUNT(,)', 2], ['COUNTA(,)', 2], ['AND(TRUE,)', false], ['OR(FALSE,)', false],
  ]);
});

test('moving a sheet changes which sheets a 3-D reference spans', () => {
  const e = book({ A1: 1, 'Sheet2!A1': 10, 'Sheet3!A1': 100, B1: '=SUM(Sheet1:Sheet2!A1)' }, { sheets: ['Sheet1', 'Sheet2', 'Sheet3'] });
  const third = M.getSheet(e.wb, 'Sheet3').id;
  assert.equal(val(e, 'B1'), 11);
  e.apply({ op: 'moveSheet', sheet: third, to: 1 });
  assert.equal(val(e, 'B1'), 111, 'Sheet3 is now between Sheet1 and Sheet2');
  e.edit(third, 0, 0, '200');
  assert.equal(val(e, 'B1'), 211, 'and is read as a precedent');
  e.apply({ op: 'moveSheet', sheet: third, to: 2 });
  e.edit(third, 0, 0, '300');
  assert.equal(val(e, 'B1'), 11);
});

test('formulaAt: a formula\'s cell, or the head of the array formula covering it', () => {
  const e = book({ A1: '=1+1', B1: 5 });
  const sh = e.wb.sheets[0];
  e.apply({ op: 'set', sheet: sh.id, r: 2, c: 0, cell: { t: 'n', v: 0, f: '{1;2}*3', a: 'A3:A4' } });
  assert.equal(e.formulaAt(sh, 0, 0).f, '1+1');
  assert.equal(e.formulaAt(sh.id, 0, 0).f, '1+1', 'by sheet id too');
  assert.equal(e.formulaAt(sh, 3, 0), M.cell(sh, 2, 0), 'a member gives its head');
  assert.equal(e.formulaAt(sh, 0, 1), null);
  assert.equal(e.formulaAt(sh, 9, 9), null);
  assert.equal(e.formulaAt(999, 0, 0), null);
});

test('functions reach the workbook through ctx: sheetNamed, evalName, extent, formulaAt, sheets, style', () => {
  C.define('TESTCTX', { p: [], min: 0, max: 0, fn: (args, ctx) => [
    ctx.sheetNamed('SHEET2')?.name, ctx.evalName({ k: 'name', name: 'rate', sheet: null }), ctx.extent(ctx.sheet).join(','),
    ctx.formulaAt(ctx.sheet, 0, 0)?.f, ctx.sheets.length, ctx.style(1)?.fmt,
  ].join('|') });
  const e = book({ A1: '=2*3', C4: 1, 'Sheet2!A1': 1 }, { sheets: ['Sheet1', 'Sheet2'], names: [{ name: 'Rate', ref: '0.05' }] });
  e.wb.styles.push({ fmt: '0.00' });
  assert.equal(calc(e, 'TESTCTX()'), 'Sheet2|0.05|3,2|2*3|2|0.00');
});

// Excel 16.114.1: criteria text without * or ? is compared as it is, tildes and all; with them, ~ takes the next
// character as itself and a ~ at the end is dropped. Each string marks which of the cells COUNTIF counts.
test('criteria: tildes are literal unless the text has a wildcard', () => {
  const run = (cells, rows) => {
    const e = book(Object.fromEntries(cells.map((v, i) => [`A${i + 1}`, `'${v}`])));
    for (const [p, want] of rows) assert.equal(cells.map((_, i) => calc(e, `COUNTIF(A${i + 1},"${p}")`)).join(''), want, p);
  };
  run(['a~', 'a~b', 'a~~b', 'ab', 'a*b', 'a~*b', '~', '~~'], [
    ['a~', '10000000'], ['a~b', '01000000'], ['a~~b', '00100000'], ['a~~', '00000000'], ['~', '00000010'], ['~~', '00000001'],
    ['a~*b', '00001000'], ['a~~*b', '01100100'], ['*~', '11111111'], ['~*', '00000000'], ['a~?b', '00000000'], ['a?b', '01001000'], ['a*b', '01111100'],
  ]);
  run(['a~b', 'ab', 'a~bc', 'abc', 'a~~b', '~ab', 'a~', 'a~~'], [
    ['a~b*', '01010000'], ['*a~b', '01000100'], ['a~bc?', '00000000'], ['~a*', '11111011'], ['a*~', '11111011'], ['a*~~', '00000011'], ['?~', '00000000'], ['a~~?', '10000001'],
  ]);
  assert.equal(C.lib.wildcard('a~*')('A*'), true);
  assert.equal(C.lib.wildcard('a~*')('ab'), false);
});
