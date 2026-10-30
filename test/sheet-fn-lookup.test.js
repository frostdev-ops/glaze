// Lookup and reference functions (lib/sheet-fn-lookup.js). Function cases are the worked examples on Microsoft's page
// for each function, support.microsoft.com/en-us/excel/functions/<name>-function (vlookup, hlookup, xlookup, xmatch,
// match, index, lookup, offset, indirect, choose, row, rows, column, columns, address, transpose, unique, sort, sortby,
// filter, sequence, hyperlink), with their data where the page gives it in text; where it shows its data only in an
// image, the cases follow the formulas and results its text and alt text state. Edge cases follow the rules those pages
// state: approximate matches over sorted data, values of another kind never matching, wildcards and ~, errors.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-text.js');
require('../lib/sheet-fn-date.js');
require('../lib/sheet-fn-lookup.js');

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
  const e = C.engine(wb, { now: () => new Date(2011, 5, 15, 9, 30).getTime() });
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text, at = 'Z100') => out(e.evaluate(text, e.wb.sheets[0].id, ...M.cellPosition(at)));
const val = (e, at) => out(e.value(e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows, at) => { for (const [f, want] of rows) assert.equal(calc(e, f, at), want, f); };
// A formula's whole array: entered as an array formula over a range of its size (ROWS and COLUMNS of it), read back.
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

const NAMES = 'VLOOKUP HLOOKUP XLOOKUP XMATCH MATCH INDEX LOOKUP OFFSET INDIRECT CHOOSE ROW ROWS COLUMN COLUMNS ADDRESS TRANSPOSE UNIQUE SORT SORTBY FILTER SEQUENCE HYPERLINK'.split(' ');

test('the lookup functions are registered, OFFSET and INDIRECT volatile, and nothing sets a timer', () => {
  for (const name of NAMES) assert.ok(C.fn(name), name);
  assert.ok(C.fn('OFFSET').volatile && C.fn('INDIRECT').volatile);
  assert.ok(!C.fn('INDEX').volatile && !C.fn('XLOOKUP').volatile);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-lookup.js'), 'utf8')));
});

// VLOOKUP's page shows its employee table only in an image; these are the cells its alt text names (Fontana's first name
// Olivier, 102 Fontana, 103 Leal, 105 Burke born 3/4/1955), the rest filled in.
const EMPLOYEES = {
  A1: 'ID', B1: 'Last', C1: 'First', D1: 'Title', E1: 'Birth',
  A2: 101, B2: 'Davis', C2: 'Sara', D2: 'Sales Rep', E2: '12/8/1968', A3: 102, B3: 'Fontana', C3: 'Olivier', D3: 'V.P. of Sales', E3: '2/19/1952',
  A4: 103, B4: 'Leal', C4: 'Karina', D4: 'Sales Rep', E4: '8/30/1963', A5: 104, B5: 'Patten', C5: 'Michael', D5: 'Sales Rep', E5: '9/19/1958',
  A6: 105, B6: 'Burke', C6: 'Brian', D6: 'Sales Mgr', E6: '3/4/1955', A7: 106, B7: 'Sousa', C7: 'Luis', D7: 'Sales Rep', E7: '7/2/1963',
};

test('VLOOKUP: exact and approximate, wildcards, column errors', () => {
  const e = book(EMPLOYEES);
  cases(e, [
    ['VLOOKUP(B3,B2:E7,2,FALSE)', 'Olivier'], ['VLOOKUP("Fontana",B2:E7,2,FALSE)', 'Olivier'], ['VLOOKUP(102,A2:C7,2,FALSE)', 'Fontana'],
    ['IF(VLOOKUP(103,A1:E7,2,FALSE)="Souse","Located","Not found")', 'Not found'], ['INT(YEARFRAC(DATE(2014,6,30),VLOOKUP(105,A2:E7,5,FALSE),1))', 59],
    ['IFNA(VLOOKUP(105,A2:E7,2,FALSE),"Employee not found")', 'Burke'], ['IFNA(VLOOKUP(107,A2:E7,2,FALSE),"Employee not found")', 'Employee not found'],
    ['VLOOKUP("Fontan?",B2:E7,2,FALSE)', 'Olivier'], ['VLOOKUP("fontana",B2:E7,2,FALSE)', 'Olivier'], ['VLOOKUP("P*",B2:E7,2,FALSE)', 'Michael'],
    ['VLOOKUP(107,A2:E7,2,FALSE)', '#N/A'], ['VLOOKUP(102,A2:E7,6,FALSE)', '#REF!'], ['VLOOKUP(102,A2:E7,0,FALSE)', '#VALUE!'], ['VLOOKUP(102,A2:E7,1.9,FALSE)', 102],
    ['VLOOKUP(104.5,A2:E7,2)', 'Patten'], ['VLOOKUP(104.5,A2:E7,2,TRUE)', 'Patten'], ['VLOOKUP(500,A2:E7,2,TRUE)', 'Sousa'], ['VLOOKUP(100,A2:E7,2,TRUE)', '#N/A'],
    ['VLOOKUP(104.5,A2:E7,2,FALSE)', '#N/A'], ['VLOOKUP(102,A2:E7,2,)', 'Fontana'], ['VLOOKUP(104.5,A2:E7,2,)', '#N/A'], ['VLOOKUP("102",A2:E7,2,FALSE)', '#N/A'],
    ['VLOOKUP(102,A:E,4,FALSE)', 'V.P. of Sales'], ['VLOOKUP(1/0,A2:E7,2,FALSE)', '#DIV/0!'],
  ]);
  assert.equal(calc(e, 'VLOOKUP(A2:A7,A2:B7,2,FALSE)', 'Z4'), 'Leal', 'a range lookup value intersects the formula\'s row');
  spills(e, [['VLOOKUP(102,A2:E7,{2,3},FALSE)', [['Fontana', 'Olivier']]], ['VLOOKUP({101;106},A2:B7,2,FALSE)', [['Davis'], ['Sousa']]]]);
});

test('HLOOKUP, with Microsoft\'s data', () => {
  const e = book({ A1: 'Axles', B1: 'Bearings', C1: 'Bolts', A2: 4, B2: 4, C2: 9, A3: 5, B3: 7, C3: 10, A4: 6, B4: 8, C4: 11 });
  cases(e, [
    ['HLOOKUP("Axles", A1:C4, 2, TRUE)', 4], ['HLOOKUP("Bearings", A1:C4, 3, FALSE)', 7], ['HLOOKUP("B", A1:C4, 3, TRUE)', 5], ['HLOOKUP("Bolts", A1:C4, 4)', 11],
    ['HLOOKUP(3, {1,2,3;"a","b","c";"d","e","f"}, 2, TRUE)', 'c'], ['HLOOKUP("bolts",A1:C4,2,FALSE)', 9], ['HLOOKUP("Be*",A1:C4,2,FALSE)', 4],
    ['HLOOKUP("A",A1:C4,2)', '#N/A'], ['HLOOKUP("Nuts",A1:C4,2,FALSE)', '#N/A'], ['HLOOKUP("Bolts",A1:C4,5)', '#REF!'], ['HLOOKUP("Bolts",A1:C4,0)', '#VALUE!'],
  ]);
});

test('MATCH: types 1, 0 and -1, Microsoft\'s data, wildcards and ~', () => {
  const e = book({ A1: 'Product', B1: 'Count', A2: 'Bananas', B2: 25, A3: 'Oranges', B3: 38, A4: 'Apples', B4: 40, A5: 'Pears', B5: 41 });
  cases(e, [
    ['MATCH(39,B2:B5,1)', 2], ['MATCH(41,B2:B5,0)', 4], ['MATCH(40,B2:B5,-1)', '#N/A'], ['MATCH(25,{5,25,38},0)', 2], ['MATCH("b",{"a","b","c"},0)', 2],
    ['MATCH(39,B2:B5)', 2], ['MATCH(41,B2:B5)', 4], ['MATCH(100,B2:B5)', 4], ['MATCH(24,B2:B5)', '#N/A'], ['MATCH(38,B2:B5,1)', 2],
    ['MATCH(30,{50,40,30,20},-1)', 3], ['MATCH(35,{50,40,30,20},-1)', 2], ['MATCH(10,{50,40,30,20},-1)', 4], ['MATCH(60,{50,40,30,20},-1)', '#N/A'],
    ['MATCH("bananas",A2:A5,0)', 1], ['MATCH("PEARS",A2:A5,0)', 4], ['MATCH("b*",A2:A5,0)', 1], ['MATCH("?ears",A2:A5,0)', 4], ['MATCH("*e*",A2:A5,0)', 2],
    ['MATCH("*",A2:A5,0)', 1], ['MATCH("??????",A2:A5,0)', 3], ['MATCH("b*",A2:A5,1)', '#N/A'], ['MATCH("Kiwi",A2:A5,0)', '#N/A'],
    ['MATCH("~*",{"a","*"},0)', 2], ['MATCH("a~?",{"ab","a?"},0)', 2], ['MATCH("a?",{"ab","a?"},0)', 1], ['MATCH("a~~",{"a","a~"},0)', 2], ['MATCH("a~b",{"ab","a~b"},0)', 1],
    ['MATCH("1*",{10,"10"},0)', 2], ['MATCH(#N/A,B2:B5,0)', '#N/A'], ['MATCH(1/0,B2:B5,0)', '#DIV/0!'],
  ]);
});

test('approximate matches search by halves: values of another kind are passed over and never match', () => {
  const e = book({ G1: 1, G3: 3, G4: '#N/A', G5: 5, G6: 7, H1: 'x', H2: 'y', H3: 'x', H4: 'y', I1: 10, I2: 20, I3: 30, I4: 40, J1: 'apple', J2: 5, J3: 'kiwi', J5: 'fig', K2: '=""' });
  cases(e, [
    ['MATCH(6,G1:G6,1)', 5], ['MATCH(2,G1:G6,1)', 1], ['MATCH(4,G1:G6,1)', 3], ['MATCH(0,G1:G6,1)', '#N/A'], ['MATCH(100,G1:G6,1)', 6], ['MATCH(7,G1:G6)', 6],
    ['VLOOKUP(4,G1:G6,1)', 3], ['LOOKUP(6.5,G1:G6)', 5],
    // Sorted as Excel orders kinds: numbers, then text, then FALSE, then TRUE.
    ['MATCH("b",{1,2,"a","b","c"},1)', 4], ['MATCH("bb",{1,2,"a","b","c"},1)', 4], ['MATCH(5,{"a","b","c"},1)', '#N/A'], ['MATCH(1.5,{1,"x",2},1)', 1],
    ['MATCH(TRUE,{1,"a",FALSE,TRUE},1)', 4], ['MATCH(FALSE,{1,"a",FALSE,TRUE},1)', 3], ['MATCH("Cherry",{"Apple","Banana","Date"},1)', 2], ['MATCH("cherry",{"Apple","Banana","Date"})', 2],
    ['VLOOKUP("a",I1:I4,1)', '#N/A'], ['MATCH(2,{1,2,2,2,3},1)', 4], ['MATCH(2,{1,2,2,2,3},0)', 2], ['MATCH(2,{3,2,2,1},-1)', 2],
    // An exact match is of the same kind: no text for a number, no number for TRUE, and never a blank cell for 0 or "".
    ['MATCH(1,{"1",1},0)', 2], ['MATCH("1",{1},0)', '#N/A'], ['MATCH(TRUE,{1,TRUE},0)', 2], ['MATCH(1,{TRUE,1},0)', 2], ['MATCH(0,K1:K3,0)', '#N/A'], ['MATCH("",K1:K3,0)', 2],
    // The idioms that lean on it: the last match of a condition, the last number or text in a column.
    ['LOOKUP(2,1/(H1:H4="x"),I1:I4)', 30], ['LOOKUP(2,1/(H1:H4="y"),I1:I4)', 40], ['LOOKUP(2,1/(H1:H4="z"),I1:I4)', '#N/A'],
    ['MATCH(9.99E+307,G:G)', 6], ['LOOKUP(9.99E+307,G:G)', 7], ['LOOKUP(9.99E+307,J:J)', 5], ['LOOKUP("zzzz",J:J)', 'fig'], ['MATCH("zzzz",J:J)', 5],
  ]);
});

const STAFF = {
  A1: 'Name', B1: 'Dept', C1: 'Score', A2: 'Amy', B2: 'Sales', C2: 70, A3: 'Ben', B3: 'Ops', C3: 85, A4: 'Cal', B4: 'Sales', C4: 90, A5: 'Dee', B5: 'Tech', C5: 85, A6: 'Eve', B6: 'Ops', C6: 60,
  D2: 'x', D4: 'y', D6: 'z', E2: 1, E3: 2, E4: 3, E5: 4, E6: 5, F2: 10, F3: 20, F4: 30, F5: 40, F6: 50, G2: 'a', G3: 'b', G4: 'c', G5: 'd', G6: 'e', H2: 50, H3: 40, H4: 30, H5: 20, H6: 10,
};

test('XLOOKUP: match modes, search modes, if_not_found, rows and columns returned, references', () => {
  const e = book(STAFF);
  cases(e, [
    ['XLOOKUP("Cal",A2:A6,C2:C6)', 90], ['XLOOKUP("cal",A2:A6,B2:B6)', 'Sales'], ['XLOOKUP("Zed",A2:A6,C2:C6)', '#N/A'],
    ['XLOOKUP("Zed",A2:A6,C2:C6,"Employee not found")', 'Employee not found'], ['XLOOKUP("Zed",A2:A6,C2:C6,0)', 0], ['XLOOKUP("Zed",A2:A6,C2:C6,)', '#N/A'],
    ['XLOOKUP(85,C2:C6,A2:A6)', 'Ben'], ['XLOOKUP(85,C2:C6,A2:A6,,0,-1)', 'Dee'], ['XLOOKUP(85,C2:C6,A2:A6,,0,1)', 'Ben'],
    ['XLOOKUP(80,C2:C6,A2:A6,,-1)', 'Amy'], ['XLOOKUP(80,C2:C6,A2:A6,,1)', 'Ben'], ['XLOOKUP(80,C2:C6,A2:A6,,1,-1)', 'Dee'], ['XLOOKUP(85,C2:C6,A2:A6,,-1)', 'Ben'],
    ['XLOOKUP(50,C2:C6,A2:A6,,-1)', '#N/A'], ['XLOOKUP(95,C2:C6,A2:A6,,1)', '#N/A'], ['XLOOKUP(95,C2:C6,A2:A6,"none",1)', 'none'],
    ['XLOOKUP("?e*",A2:A6,C2:C6,,2)', 85], ['XLOOKUP("?e*",A2:A6,C2:C6)', '#N/A'], ['XLOOKUP("*e",A2:A6,C2:C6,,2,-1)', 60], ['XLOOKUP("~*",{"a","*"},{1,2},,2)', 2],
    ['XLOOKUP(30,F2:F6,G2:G6,,0,2)', 'c'], ['XLOOKUP(35,F2:F6,G2:G6,,-1,2)', 'c'], ['XLOOKUP(35,F2:F6,G2:G6,,1,2)', 'd'], ['XLOOKUP(35,F2:F6,G2:G6,,0,2)', '#N/A'],
    ['XLOOKUP(5,F2:F6,G2:G6,,-1,2)', '#N/A'], ['XLOOKUP(55,F2:F6,G2:G6,,1,2)', '#N/A'], ['XLOOKUP(55,F2:F6,G2:G6,,-1,2)', 'e'],
    ['XLOOKUP(30,H2:H6,G2:G6,,0,-2)', 'c'], ['XLOOKUP(35,H2:H6,G2:G6,,-1,-2)', 'c'], ['XLOOKUP(35,H2:H6,G2:G6,,1,-2)', 'b'], ['XLOOKUP(35,H2:H6,G2:G6,,0,-2)', '#N/A'],
    ['XLOOKUP(2,{1,2,3},{"x","y","z"})', 'y'], ['XLOOKUP("Score",A1:C1,A4:C4)', 90], ['XLOOKUP("Cal",A2:A6,C2:C5)', '#VALUE!'],
    ['XLOOKUP("Cal",A2:A6,XLOOKUP("Score",A1:C1,A2:C6))', 90], ['INDEX(XLOOKUP("Cal",A2:A6,A2:C6),2)', 'Sales'], ['XLOOKUP(1/0,A2:A6,C2:C6)', '#DIV/0!'],
    // An omitted lookup value finds a blank cell.
    ['XLOOKUP(,D2:D6,E2:E6)', 2], ['XLOOKUP(,D2:D6,E2:E6,,0,-1)', 4],
    // The reference it returns can end a range: Microsoft's SUM(XLOOKUP(…):XLOOKUP(…)), which reads SUM(C3:C5).
    ['SUM(XLOOKUP("Ben",A2:A6,C2:C6):XLOOKUP("Dee",A2:A6,C2:C6))', 260],
  ]);
  spills(e, [
    ['XLOOKUP("Cal",A2:A6,B2:C6,0,1)', [['Sales', 90]]], ['XLOOKUP(2,{1,2,3},{"x","y","z";10,20,30})', [['y'], [20]]], ['XLOOKUP("Score",A1:C1,A2:C6)', [[70], [85], [90], [85], [60]]],
    ['XLOOKUP({"Amy";"Eve"},A2:A6,C2:C6)', [[70], [60]]], ['XLOOKUP({"Amy";"Zed"},A2:A6,C2:C6,"-")', [[70], ['-']]],
  ]);
  assert.equal(calc(e, 'XLOOKUP("Cal",A2:A6,A2:C6)'), 'Cal', 'a row returned to one cell shows its first value');
});

test('XMATCH: Microsoft\'s examples and every mode', () => {
  const e = book(STAFF);
  cases(e, [
    ['XMATCH(4,{5,4,3,2,1})', 2], ['XMATCH(4.5,{5,4,3,2,1},1)', 1], ['XMATCH(4.5,{5,4,3,2,1},-1)', 2], ['XMATCH(4.5,{5,4,3,2,1})', '#N/A'],
    ['XMATCH("Dee",A2:A6)', 4], ['XMATCH("dee",A2:A6)', 4], ['XMATCH(85,C2:C6,0,-1)', 4], ['XMATCH("C*",A2:A6,2)', 3], ['XMATCH("C*",A2:A6)', '#N/A'],
    ['XMATCH(35,F2:F6,-1,2)', 3], ['XMATCH(35,F2:F6,1,2)', 4], ['XMATCH(40,F2:F6,0,2)', 4], ['XMATCH(35,H2:H6,-1,-2)', 3], ['XMATCH(40,H2:H6,0,-2)', 2],
    ['XMATCH(,D2:D6)', 2], ['XMATCH(,D2:D6,0,-1)', 4], ['XMATCH("Tech",B1:B6)', 5], ['XMATCH("Score",A1:C1)', 3],
    ['INDEX(A2:C6,XMATCH("Dee",A2:A6),XMATCH("Dept",A1:C1))', 'Tech'],
  ]);
});

test('INDEX: array and reference forms, a 0 row or column takes it all', () => {
  const e = book({ A1: 'Data', B1: 'Data', A2: 'Apples', B2: 'Lemons', A3: 'Bananas', B3: 'Pears' });
  cases(e, [['INDEX(A2:B3,2,2)', 'Pears'], ['INDEX(A2:B3,2,1)', 'Bananas'], ['INDEX({1,2;3,4},0,2)', 2], ['INDEX({1,2;3,4},2,2)', 4]]);
  spills(e, [['INDEX({1,2;3,4},0,2)', [[2], [4]]], ['INDEX({1,2;3,4},2)', [[3, 4]]], ['INDEX({1,2;3,4},0,0)', [[1, 2], [3, 4]]], ['INDEX(A2:B3,0,1)', [['Apples'], ['Bananas']]]]);
  const f = book({
    A1: 'Fruit', B1: 'Price', C1: 'Count', A2: 'Apples', B2: 0.69, C2: 40, A3: 'Bananas', B3: 0.34, C3: 38, A4: 'Lemons', B4: 0.55, C4: 15, A5: 'Oranges', B5: 0.25, C5: 25,
    A6: 'Pears', B6: 0.59, C6: 40, A7: 'Almonds', B7: 2.8, C7: 10, A8: 'Cashews', B8: 3.55, C8: 16, A9: 'Peanuts', B9: 1.25, C9: 20, A10: 'Walnuts', B10: 1.75, C10: 12,
    'Sheet2!A1': 'other',
  }, { sheets: ['Sheet1', 'Sheet2'] });
  cases(f, [
    ['INDEX(A2:C6, 2, 3)', 38], ['INDEX((A1:C6, A8:C11), 2, 2, 2)', 1.25], ['SUM(INDEX(A1:C11, 0, 3, 1))', 216], ['ROUND(SUM(B2:INDEX(A2:C6, 5, 2)),10)', 2.42],
    ['INDEX(A2:C6,6,1)', '#REF!'], ['INDEX(A2:C6,1,4)', '#REF!'], ['INDEX((A1:C6,A8:C11),1,1,3)', '#REF!'], ['INDEX(A2:C6,1,1,2)', '#REF!'], ['INDEX(A2:C6,-1,1)', '#VALUE!'],
    ['INDEX((A1:A2,Sheet2!A1:A2),1,1,2)', '#VALUE!'], ['INDEX(A2:A6,3)', 'Lemons'], ['INDEX(A2:C2,2)', 0.69], ['INDEX(A2:C2,1,3)', 40], ['INDEX(A2:C2,2,1)', '#REF!'],
    ['ROUND(SUM(INDEX(A2:C6,,2)),10)', 2.42], ['SUM(INDEX(A2:C6,2,0))', 38.34], ['ROWS(INDEX(A2:C6,0,0))', 5], ['COLUMNS(INDEX(A2:C6,3))', 3],
    ['INDEX(5,1,1)', 5], ['INDEX(A2:C6,2.9,1.9)', 'Bananas'], ['INDEX(A:C,4,1)', 'Lemons'], ['SUM(INDEX(A:C,0,3))', 216], ['INDEX(A2:C6,"2",1)', 'Bananas'],
  ]);
  spills(f, [['INDEX(A2:C6,2)', [['Bananas', 0.34, 38]]], ['INDEX(A2:C6,{1;3},1)', [['Apples'], ['Lemons']]]]);
});

test('LOOKUP: vector and array forms', () => {
  const e = book({ A1: 'Frequency', B1: 'Color', A2: 4.14, B2: 'red', A3: 4.19, B3: 'orange', A4: 5.17, B4: 'yellow', A5: 5.77, B5: 'green', A6: 6.39, B6: 'blue' });
  cases(e, [
    ['LOOKUP(4.19, A2:A6, B2:B6)', 'orange'], ['LOOKUP(5.75, A2:A6, B2:B6)', 'yellow'], ['LOOKUP(7.66, A2:A6, B2:B6)', 'blue'], ['LOOKUP(0, A2:A6, B2:B6)', '#N/A'],
    ['LOOKUP(5.75, A2:A6)', 5.17], ['LOOKUP("Orange",{"apple","orange","pear"},{1,2,3})', 2],
    // An array wider than tall is searched along its first row, otherwise down its first column; the last row or column answers.
    ['LOOKUP("C",{"a","b","c","d";1,2,3,4})', 3], ['LOOKUP("bump",{"a",1;"b",2;"c",3})', 2], ['LOOKUP(5.5,A2:B6)', 'yellow'], ['LOOKUP(2,{1,2;"x","y"})', 2],
    ['LOOKUP(1/0,A2:A6,B2:B6)', '#DIV/0!'],
  ]);
});

test('OFFSET: a reference moved and resized; off the sheet is #REF!', () => {
  const e = book({ B5: 'Data', C5: 'Data', B6: 4, C6: 10, B7: 8, C7: 3, B8: 3, C8: 6 });
  cases(e, [
    ['OFFSET(D3,3,-2,1,1)', 4], ['SUM(OFFSET(D3:F5,3,-2, 3, 3))', 34], ['OFFSET(D3, -3, -3)', '#REF!'], ['OFFSET(B6,1,1)', 3], ['SUM(OFFSET(B6:C8,0,0))', 34],
    ['SUM(OFFSET(B6,1,0,2))', 11], ['ROWS(OFFSET(B6,0,0,3,2))', 3], ['COLUMNS(OFFSET(B6,0,0,3,2))', 2], ['ROWS(OFFSET(B6:C8,1,0))', 3],
    ['OFFSET(A1,1048576,0)', '#REF!'], ['OFFSET(A1,0,16384)', '#REF!'], ['OFFSET("B6",1,1)', '#VALUE!'], ['OFFSET({1,2},0,0)', '#VALUE!'], ['OFFSET((B6,C6),0,0)', '#VALUE!'],
    ['SUM(OFFSET(B5,1,0,3):C8)', 34], ['OFFSET(B6,1/0,0)', '#DIV/0!'],
  ]);
});

test('INDIRECT: A1 and R1C1 text, other sheets, defined names; recalculated on every edit', () => {
  const e = book({ A2: "'B2", B2: 1.333, A3: "'B3", B3: 45, A4: 'George', B4: 10, A5: 5, B5: 62, 'My Data!A1': 'there', 'Sheet3!B2': 7 },
    { sheets: ['Sheet1', 'My Data', 'Sheet3'], names: [{ name: 'George', ref: 'Sheet1!$B$4' }, { name: 'Pair', ref: 'Sheet1!$B$2:$B$3' }] });
  cases(e, [
    ['INDIRECT(A2)', 1.333], ['INDIRECT(A3)', 45], ['INDIRECT(A4)', 10], ['INDIRECT("B"&A5)', 62], ['INDIRECT("b2")', 1.333], ['INDIRECT("$B$3")', 45],
    ['SUM(INDIRECT("B2:B5"))', 118.333], ['SUM(INDIRECT("Pair"))', 46.333], ['INDIRECT("\'My Data\'!A1")', 'there'], ['INDIRECT("Sheet3!B2")', 7], ['INDIRECT("sheet3!b2")', 7],
    ['SUM(INDIRECT("B:B"))', 118.333], ['SUM(INDIRECT("2:2"))', 1.333], ['INDIRECT(ADDRESS(5,2))', 62],
    ['INDIRECT("R2C2",FALSE)', 1.333], ['SUM(INDIRECT("R2C2:R3C2",FALSE))', 46.333], ['SUM(INDIRECT("C2",FALSE))', 118.333], ['SUM(INDIRECT("R2",FALSE))', 1.333],
    ['INDIRECT("\'My Data\'!R1C1",FALSE)', 'there'], ['INDIRECT("Sheet3!R2C2",FALSE)', 7], ['INDIRECT("r5c2",FALSE)', 62], ['INDIRECT("R2C2",0)', 1.333],
    ['INDIRECT("R1C1")', '#REF!'], ['INDIRECT("B2",FALSE)', '#REF!'], ['INDIRECT("R0C1",FALSE)', '#REF!'], ['INDIRECT("R1C16385",FALSE)', '#REF!'],
    ['INDIRECT("Nowhere!A1")', '#REF!'], ['INDIRECT("")', '#REF!'], ['INDIRECT("A1048577")', '#REF!'], ['INDIRECT("XFE1")', '#REF!'], ['INDIRECT("1+1")', '#REF!'],
    ['INDIRECT(A5)', '#REF!'], ['INDIRECT("Sheet1:Sheet3!A1")', '#REF!'], ['INDIRECT(1/0)', '#DIV/0!'],
  ]);
  cases(e, [['INDIRECT("R[1]C[-1]",FALSE)', 45], ['INDIRECT("RC[-1]",FALSE)', 1.333], ['INDIRECT("R[-1]C[-1]",FALSE)', 0]], 'C2');
  cases(e, [['INDIRECT("R[-1]C",FALSE)', 1.333]], 'B3');
  cases(e, [['INDIRECT("R[-1]C",FALSE)', '#REF!'], ['INDIRECT("RC[-1]",FALSE)', '#REF!']], 'A1');
  const g = book({ C1: '=INDIRECT("D1")*2', D1: '=E1+1', E1: 1, F1: '=OFFSET(E1,0,0)+1' });
  assert.deepEqual([val(g, 'C1'), val(g, 'F1')], [4, 2]);
  g.edit(g.wb.sheets[0].id, 0, 4, '5');
  assert.deepEqual([val(g, 'C1'), val(g, 'F1')], [12, 6], 'they wait for the cells they reach');
});

test('CHOOSE: only the value chosen is evaluated; an index array chooses element by element', () => {
  const e = book({ A1: 'Data', A2: '1st', B2: 'Nails', A3: '2nd', B3: 'Screws', A4: '3rd', B4: 'Nuts', A5: 'Finished', B5: 'Bolts' });
  cases(e, [
    ['CHOOSE(2,A2,A3,A4,A5)', '2nd'], ['CHOOSE(4,B2,B3,B4,B5)', 'Bolts'], ['CHOOSE(3,"Wide",115,"world",8)', 'world'], ['CHOOSE(2.9,"a","b","c")', 'b'],
    ['CHOOSE(0,"a","b")', '#VALUE!'], ['CHOOSE(3,"a","b")', '#VALUE!'], ['CHOOSE(1,"a",1/0)', 'a'], ['CHOOSE(2,"a",1/0)', '#DIV/0!'], ['CHOOSE("2","a","b")', 'b'],
    ['CHOOSE(1/0,"a")', '#DIV/0!'],
  ]);
  spills(e, [['CHOOSE({1,2},"x","y")', [['x', 'y']]], ['CHOOSE({1,2},A2:A3,B2:B3)', [['1st', 'Nails'], ['2nd', 'Screws']]], ['CHOOSE({1;3},"x","y")', [['x'], ['#VALUE!']]]]);
  const f = book({ A1: 'Data', A2: 23, A3: 45, A4: 12, A5: 10 });
  cases(f, [['SUM(A2:CHOOSE(2,A3,A4,A5))', 80], ['SUM(CHOOSE(2,A2:A3,A4:A5))', 22]]);
});

test('ROW, COLUMN, ROWS, COLUMNS', () => {
  const e = book();
  cases(e, [['ROW()', 2], ['ROW(C10)', 10], ['COLUMN()', 3], ['COLUMN(D10)', 4], ['COLUMN(C3:D6)', 3], ['ROW(C3:D6)', 3], ['SUM(ROW(A1:A3))', 6], ['ROW({1,2})', '#VALUE!']], 'C2');
  cases(e, [
    ['ROWS(C1:E4)', 4], ['ROWS({1,2,3;4,5,6})', 2], ['COLUMNS(C1:E4)', 3], ['COLUMNS({1,2,3;4,5,6})', 3], ['ROWS(A:A)', 1048576], ['COLUMNS(1:1)', 16384], ['ROWS(5)', 1],
    ['ROWS(SEQUENCE(7,2))', 7], ['COLUMNS(SEQUENCE(7,2))', 2], ['ROWS(1/0)', '#DIV/0!'],
  ]);
  spills(e, [['ROW(C3:C5)', [[3], [4], [5]]], ['COLUMN(C3:E3)', [[3, 4, 5]]]]);
});

test('ADDRESS: abs_num, R1C1 and a sheet name', () => {
  const e = book();
  cases(e, [
    ['ADDRESS(2,3)', '$C$2'], ['ADDRESS(2,3,2)', 'C$2'], ['ADDRESS(2,3,2,FALSE)', 'R2C[3]'], ['ADDRESS(2,3,1,FALSE,"[Book1]Sheet1")', "'[Book1]Sheet1'!R2C3"],
    ['ADDRESS(2,3,1,FALSE,"EXCEL SHEET")', "'EXCEL SHEET'!R2C3"], ['ADDRESS(77,300)', '$KN$77'], ['ADDRESS(1,1,,,"Sheet2")', 'Sheet2!$A$1'],
    ['ADDRESS(2,3,3)', '$C2'], ['ADDRESS(2,3,4)', 'C2'], ['ADDRESS(2,3,1,FALSE)', 'R2C3'], ['ADDRESS(2,3,3,FALSE)', 'R[2]C3'], ['ADDRESS(2,3,4,FALSE)', 'R[2]C[3]'],
    ['ADDRESS(1048576,16384)', '$XFD$1048576'], ['ADDRESS(2.9,3.9)', '$C$2'], ['ADDRESS(0,1)', '#VALUE!'], ['ADDRESS(1,16385)', '#VALUE!'], ['ADDRESS(1,1,5)', '#VALUE!'],
  ]);
});

test('TRANSPOSE, UNIQUE, SORT, SORTBY: whole arrays in an array formula, the top-left value in one cell', () => {
  const e = book({ A1: 1, B1: 'a', A2: 2, B2: 'b', A3: 3, A4: 4, B4: 'd', D1: 'Apple', D2: 'apple', D3: 'Pear', D4: 'Fig', D5: 'Pear', E1: '=TRANSPOSE(A1:B4)', F1: '=SORT(A1:A4,1,-1)' });
  spills(e, [
    ['TRANSPOSE(A1:B4)', [[1, 2, 3, 4], ['a', 'b', 0, 'd']]], ['TRANSPOSE({1,2,3})', [[1], [2], [3]]], ['TRANSPOSE({1,2;3,4})', [[1, 3], [2, 4]]],
    ['UNIQUE(D1:D5)', [['Apple'], ['Pear'], ['Fig']]], ['UNIQUE(D1:D5,,TRUE)', [['Fig']]], ['UNIQUE({1,2;1,2;3,4})', [[1, 2], [3, 4]]], ['UNIQUE({1,2,1;3,4,3},TRUE)', [[1, 2], [3, 4]]],
    ['UNIQUE({1;"1";1;TRUE})', [[1], ['1'], [true]]], ['SORT(UNIQUE(D1:D5))', [['Apple'], ['Fig'], ['Pear']]],
    ['SORT({3;1;2})', [[1], [2], [3]]], ['SORT({3;1;2},1,-1)', [[3], [2], [1]]], ['SORT({3,1,2},,,TRUE)', [[1, 2, 3]]], ['SORT({"b";"B";"a"})', [['a'], ['b'], ['B']]],
    ['SORT({"b";2;TRUE;"A";1;FALSE})', [[1], [2], ['A'], ['b'], [false], [true]]], ['SORT({"b";2;TRUE;"A";1;FALSE},1,-1)', [[true], [false], ['b'], ['A'], [2], [1]]],
    ['SORT({1,"z";2,"y";3,"x"},2)', [[3, 'x'], [2, 'y'], [1, 'z']]], ['SORT({1,"b";2,"a";1,"a"},{1,2},{1,-1})', [[1, 'b'], [1, 'a'], [2, 'a']]], ['SORT({1,"b";2,"a";1,"a"},{1,2})', [[1, 'a'], [1, 'b'], [2, 'a']]],
    ['SORTBY({"a";"b";"c"},{3;1;2})', [['b'], ['c'], ['a']]], ['SORTBY({"a";"b";"c"},{3;1;2},-1)', [['a'], ['c'], ['b']]], ['SORTBY({"a","b","c"},{3,1,2})', [['b', 'c', 'a']]],
    ['SORTBY({"a";"b";"c";"d"},{1;2;1;2},1,{4;3;2;1},-1)', [['a'], ['c'], ['b'], ['d']]], ['SORTBY({"a";"b";"c";"d"},{1;2;1;2},1,{4;3;2;1})', [['c'], ['a'], ['d'], ['b']]],
  ]);
  cases(e, [
    ['SORT({1;2},2)', '#VALUE!'], ['SORT({1;2},1,2)', '#VALUE!'], ['SORTBY({"a";"b"},{2;1},0)', '#VALUE!'], ['SORTBY({"a";"b"},{2;1;3})', '#VALUE!'], ['SORTBY({"a";"b"},{2,1;1,2})', '#VALUE!'],
    ['UNIQUE({1;1},,TRUE)', '#CALC!'], ['SORT(1/0)', '#DIV/0!'],
  ]);
  assert.deepEqual([val(e, 'E1'), val(e, 'F1')], [1, 4], 'one cell shows the top-left value');
});

test('FILTER: rows or columns kept, if_empty, and #CALC! for nothing', () => {
  const e = book({ ...STAFF, J1: '=FILTER(A2:A6,C2:C6>80)' });
  spills(e, [
    ['FILTER(A2:C6,B2:B6="Sales")', [['Amy', 'Sales', 70], ['Cal', 'Sales', 90]]], ['FILTER(A2:C6,(B2:B6="Ops")*(C2:C6>70),"")', [['Ben', 'Ops', 85]]],
    ['SORT(FILTER(A2:C6,(B2:B6="Sales")+(B2:B6="Ops"),""),3,-1)', [['Cal', 'Sales', 90], ['Ben', 'Ops', 85], ['Amy', 'Sales', 70], ['Eve', 'Ops', 60]]],
    ['FILTER(A1:C1,{1,0,1})', [['Name', 'Score']]], ['FILTER(A2:A6,{1;0;2;0;TRUE})', [['Amy'], ['Cal'], ['Eve']]], ['FILTER(D2:D6,D2:D6<>"")', [['x'], ['y'], ['z']]],
  ]);
  cases(e, [
    ['FILTER(A2:C6,B2:B6="HR","")', ''], ['FILTER(A2:C6,B2:B6="HR","none")', 'none'], ['FILTER(A2:C6,B2:B6="HR")', '#CALC!'], ['FILTER(A2:A6,{1;0;#N/A;0;1})', '#N/A'],
    ['FILTER(A2:A6,{1;0;1;0;"x"})', '#VALUE!'], ['FILTER(A2:A6,{1;0})', '#VALUE!'], ['IFERROR(FILTER(A2:A6,C2:C6>100),"no one")', 'no one'],
  ]);
  assert.equal(val(e, 'J1'), 'Ben');
});

test('SEQUENCE and HYPERLINK', () => {
  const e = book({ D1: 'Budget', H10: 42, Z1: 'http://example.com' });
  spills(e, [
    ['SEQUENCE(4,5)', [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20]]], ['SEQUENCE(5,1,1001,1000)', [[1001], [2001], [3001], [4001], [5001]]],
    ['SEQUENCE(3)', [[1], [2], [3]]], ['SEQUENCE(2,3,10,-2)', [[10, 8, 6], [4, 2, 0]]], ['SEQUENCE(1,3,0.5)', [[0.5, 1.5, 2.5]]],
    ['TEXT(DATE(YEAR(TODAY()),SEQUENCE(1,6),1),"mmm")', [['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']]],
  ]);
  cases(e, [
    ['SEQUENCE(4,5)', 1], ['SUM(SEQUENCE(100))', 5050], ['SEQUENCE(0)', '#CALC!'], ['SEQUENCE(-1)', '#VALUE!'], ['SEQUENCE(2,0)', '#CALC!'], ['SEQUENCE(1048577)', '#VALUE!'],
    ['HYPERLINK("http://example.microsoft.com/report/budget report.xlsx", "Click for report")', 'Click for report'], ['HYPERLINK("[Book1.xlsx]Sheet1!A10","Go to Sheet1 > A10")', 'Go to Sheet1 > A10'],
    ['HYPERLINK("[http://example.microsoft.com/report/budget report.xlsx]Annual!F10", D1)', 'Budget'], ['HYPERLINK("D:\\FINANCE\\1stqtr.xlsx", H10)', 42], ['HYPERLINK($Z$1)', 'http://example.com'],
    ['HYPERLINK("http://x",1/0)', '#DIV/0!'],
  ]);
});

test('in a 1904 workbook lookups match the serials its dates hold', () => {
  const e = book({ A1: '3/3/2025', A2: '3/4/2025', A3: '3/5/2025', B1: 'mon', B2: 'tue', B3: 'wed' }, { date1904: true });
  cases(e, [
    ['XLOOKUP(DATE(2025,3,4),A1:A3,B1:B3)', 'tue'], ['VLOOKUP(DATE(2025,3,4)+0.5,A1:B3,2)', 'tue'], ['MATCH(DATE(2025,3,5),A1:A3,0)', 3], ['MATCH("3/4/2025",A1:A3,0)', '#N/A'],
    ['XLOOKUP(DATEVALUE("3/4/2025"),A1:A3,B1:B3)', 'tue'], ['INDEX(A1:A3,2)', 45720 - 1462],
  ]);
});

test('an array past the engine\'s 250,000-cell cap is #NUM!, as the engine\'s own arrays are', () => {
  const e = book({ E60000: 1 });
  cases(e, [
    ['TRANSPOSE(A1:E60000)', '#NUM!'], ['SORT(A1:E60000)', '#NUM!'], ['UNIQUE(A1:E60000)', '#NUM!'], ['SORTBY(A1:E60000,E1:E60000)', '#NUM!'],
    ['FILTER(A1:E60000,E1:E60000=1)', '#NUM!'], ['XLOOKUP(1,E1:E60000,A1:E60000)', 0], ['SEQUENCE(1000,1000)', '#NUM!'], ['SEQUENCE(250000)', 1],
    ['ROW(A1:A300000)', '#NUM!'], ['COLUMN(A1:XFD1)', 1], ['ROWS(A1:E60000)', 60000],
  ]);
});

// Live Microsoft Excel 16.114.1, 2026-10-30; these cases distinguish lookup rules from the engine's comparisons.
test('lookup wildcards consume every tilde escape, including a trailing tilde', () => {
  cases(book(), [
    ['MATCH("a~b",{"ab","a~b"},0)', 1], ['MATCH("a~",{"a","a~"},0)', 1], ['MATCH("~",{"~",""},0)', 2],
    ['XLOOKUP("a~b",{"ab","a~b"},{1,2},,2)', 1], ['XMATCH("a~",{"a","a~"},2)', 1],
    ['VLOOKUP("a~b",{"ab",1;"a~b",2},2,FALSE)', 1], ['HLOOKUP("a~b",{"ab","a~b";1,2},2,FALSE)', 1],
  ]);
});

test('descending MATCH chooses the first exact duplicate and the last next-larger duplicate', () => {
  cases(book(), [
    ['MATCH(2,{3,2,2,2,1},-1)', 2], ['MATCH(2,{5,3,2,2,2,1},-1)', 3],
    ['MATCH(1.5,{3,2,2,2,1},-1)', 4], ['MATCH(2,{1,2,2,2,3},1)', 4],
  ]);
});

test('XLOOKUP and XMATCH binary modes use type boundaries and directional duplicate rules', () => {
  cases(book(), [
    ['XMATCH(2,{1,2,2,2,3},0,2)', 2], ['XMATCH(2,{1,2,2,2,3},-1,2)', 2],
    ['XMATCH(2,{3,2,2,2,1},0,-2)', 4], ['XMATCH(2,{2,2,2,2,2,2,2},0,2)', 1], ['XMATCH(2,{2,2,2,2,2,2,2},0,-2)', 7],
    ['XMATCH(2.5,{1,2,2,2,3},-1,2)', 4], ['XMATCH(1.5,{1,2,2,2,3},1,2)', 2],
    ['XMATCH(3,{1,2,"a",FALSE,TRUE},1,2)', 3], ['XMATCH("0",{1,2,"a",FALSE,TRUE},-1,2)', 2],
    ['XMATCH(3,{TRUE,FALSE,"b","a",2,1},1,-2)', 4], ['XMATCH(3,{TRUE,FALSE,"b","a",2,1},-1,-2)', 5],
    ['XMATCH(FALSE,{TRUE,FALSE,"b","a",2,1},0,-2)', 2],
    ['XLOOKUP(2,{1,2,2,2,3},{10,20,30,40,50},,0,2)', 20],
    ['XMATCH("ab",{"ab","ac"},2,2)', '#VALUE!'], ['XLOOKUP("a*",{"aa","ab","ba"},{1,2,3},,2,-2)', '#VALUE!'],
    ['XMATCH(2,{1,#N/A,3},-1,2)', 1], ['XMATCH(2,{1,#N/A,3},1,2)', 2], ['XMATCH(3,{1,#DIV/0!,3},0,2)', '#N/A'],
  ]);
});

test('linear next-smaller and next-larger X lookups cross type boundaries', () => {
  cases(book(), [
    ['XMATCH(3,{1,2,"a",FALSE,TRUE},1)', 3], ['XMATCH("0",{1,2,"a",FALSE,TRUE},-1)', 2],
    ['XLOOKUP(3,{1,2,"a",FALSE,TRUE},{10,20,30,40,50},,1)', 30],
    ['XMATCH(2,{1,#N/A,3},1)', 3], ['XMATCH(3,{1,#DIV/0!,3},0)', 3],
  ]);
});

test('LOOKUP extends a one-cell result reference horizontally', () => {
  const e = book({ A1: 1, A2: 2, A3: 3, D1: 10, E1: 20, F1: 30, D2: 40, D3: 50 });
  cases(e, [
    ['LOOKUP(3,A1:A3,D1)', 30], ['LOOKUP(2,A1:A3,D1)', 20], ['LOOKUP(3,A1:A3,D1:D2)', 50],
    ['LOOKUP(3,A1:A3,{10})', '#N/A'],
  ]);
});

test('FILTER accepts Boolean text and still propagates include errors', () => {
  const e = book();
  spills(e, [['FILTER({1;2},{"TRUE";"FALSE"})', [[1]]], ['FILTER({1,2},{"true","false"})', [[1]]]]);
  cases(e, [['FILTER({1;2},{"1";"0"})', '#VALUE!'], ['FILTER({1;2},{" true";"false"})', '#VALUE!'], ['FILTER({1;2},{1;#N/A})', '#N/A']]);
});

// Distinct cell text must not collide with the internal row-key separator.
test('UNIQUE preserves distinct rows and columns containing NUL text', () => {
  const e = book({ A1: 'a', B1: 'b\u0000sc', A2: 'a\u0000sb', B2: 'c' });
  cases(e, [['ROWS(UNIQUE(A1:B2))', 2], ['ROWS(UNIQUE(A1:B2,,TRUE))', 2], ['COLUMNS(UNIQUE(TRANSPOSE(A1:B2),TRUE))', 2]]);
});

test('CHOOSE caps the combined dimensions before allocating its result', () => {
  cases(book(), [
    ['ROWS(CHOOSE({1,2},SEQUENCE(501),SEQUENCE(1,500)))', '#NUM!'],
    ['COLUMNS(CHOOSE({1;2},SEQUENCE(500),SEQUENCE(1,501)))', '#NUM!'],
    ['ROWS(CHOOSE({1,2},SEQUENCE(250),SEQUENCE(1,1000)))', 250],
  ]);
});

test('INDIRECT resolves defined names in R1C1 mode and preserves Excel space rules', () => {
  const e = book({ A1: 42 }, { names: [{ name: 'Thing', ref: 'Sheet1!$A$1' }] });
  cases(e, [
    ['INDIRECT("Thing",FALSE)', 42], ['INDIRECT("Sheet1!Thing",FALSE)', 42], ['INDIRECT("Thing ",FALSE)', 42],
    ['INDIRECT("R1C1 ",FALSE)', 42], ['INDIRECT("A1 ")', 42],
    ['INDIRECT(" A1 ")', '#REF!'], ['INDIRECT(" Thing",FALSE)', '#REF!'], ['INDIRECT(" R1C1 ",FALSE)', '#REF!'],
    ['INDIRECT("[missing.xlsx]Sheet1!Thing",FALSE)', '#REF!'], ['INDIRECT("A1",FALSE)', '#REF!'],
  ]);
});

test('X binary searches place blanks after values instead of treating them as zero', () => {
  const e = book({ A1: 1, A2: 2, A3: 3, B1: 10, B2: 20, B3: 30, D1: 'a', D3: 'c', E1: false, E3: true, Z99: 0 });
  cases(e, [
    ['XMATCH(2,A:A,0,2)', 2], ['XMATCH(2,A1:A100,0,2)', 2], ['XLOOKUP(2,A:A,B:B,,0,2)', 20],
    ['XMATCH("b",D1:D3,-1,2)', 1], ['XMATCH("b",D1:D3,1,2)', 2], ['XMATCH(TRUE,E1:E3,0,2)', '#N/A'],
  ]);
});
