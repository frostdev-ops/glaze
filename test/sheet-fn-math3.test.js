// The further math and matrix functions (lib/sheet-fn-math3.js). Cases are the worked examples on Microsoft's page for
// each function, https://support.microsoft.com/en-us/excel/functions/<name>-function: acosh, asinh, atanh, cot, csc, sec,
// acot, coth, csch, sech, acoth, ceiling-precise, floor-precise, iso-ceiling, sqrtpi, combina, permutationa, multinomial,
// sumx2my2, sumx2py2, sumxmy2, mmult, mdeterm, minverse, munit (MMULT's, MINVERSE's and MUNIT's examples are screenshots).
// A page's figure shown to fewer digits is checked to those digits. What the pages leave open is Excel 16.114.1's answer
// (probes of 2026-10-30), checked to the 15 digits Excel shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-math2.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-lookup.js');
require('../lib/sheet-fn-math3.js');

const book = (cells = {}, { sheets = ['Sheet1'] } = {}) => {
  const wb = M.workbook();
  wb.sheets[0].name = sheets[0];
  for (const name of sheets.slice(1)) M.apply(wb, { op: 'addSheet', at: wb.sheets.length, name });
  for (const [at, input] of Object.entries(cells)) {
    const [sheet, ref] = at.includes('!') ? at.split('!') : [sheets[0], at];
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    M.apply(wb, { op: 'set', sheet: M.getSheet(wb, sheet).id, r, c, cell: x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v } });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text, at = 'Z100') => out(e.evaluate(text, e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
// [formula, the page's figure]: equal to as many digits as the page shows (decimals, or a mantissa's in 5.73E-20).
const shown = (e, rows) => {
  for (const [f, page] of rows) {
    const got = calc(e, f), [mant, exp] = String(page).split('E'), dp = (mant.split('.')[1] ?? '').length;
    assert.equal(typeof got, 'number', `${f} → ${got}`);
    assert.ok(Math.abs(got - Number(page)) <= 0.5 * 10 ** (-dp + Number(exp ?? 0)) * (1 + 1e-9), `${f} → ${got}, the page shows ${page}`);
  }
};
// [formula, value]: within `rel` of it (Excel's 15 digits, or the golden file's 1e-12).
const near = (e, rows, rel = 5e-15) => {
  for (const [f, want] of rows) {
    const got = calc(e, f);
    assert.equal(typeof got, 'number', `${f} → ${got}`);
    assert.ok(Math.abs(got - want) <= rel * Math.abs(want), `${f} → ${got}, want ${want}`);
  }
};
// A formula's whole array: entered as an array formula over a range of its size, read back.
const spill = (e, f, at = 'AA1') => {
  const rows = calc(e, `ROWS(${f})`), cols = calc(e, `COLUMNS(${f})`);
  if (typeof rows !== 'number') return rows;
  const sh = e.wb.sheets[0], [r, c] = M.cellPosition(at), range = M.rangeName(r, c, r + rows - 1, c + cols - 1);
  e.apply({ op: 'set', sheet: sh.id, r, c, cell: { t: 'n', v: 0, f, a: range } });
  const got = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (__, j) => out(e.value(sh.id, r + i, c + j))));
  e.apply({ op: 'clear', sheet: sh.id, r0: r, c0: c, r1: r + rows - 1, c1: c + cols - 1 });
  return got;
};
// An array result against the figures shown, each to `tol`.
const grid = (e, f, want, tol = 1e-12) => {
  const got = spill(e, f);
  assert.equal(got.length, want.length, f);
  got.forEach((row, i) => {
    assert.equal(row.length, want[i].length, f);
    row.forEach((v, j) => assert.ok(Math.abs(v - want[i][j]) <= tol * Math.max(1, Math.abs(want[i][j])), `${f} [${i},${j}] → ${v}, want ${want[i][j]}`));
  });
};

const NAMES = ('ACOSH ASINH ATANH COT CSC SEC ACOT COTH CSCH SECH ACOTH CEILING.PRECISE FLOOR.PRECISE ISO.CEILING SQRTPI COMBINA PERMUTATIONA '
  + 'MULTINOMIAL SUMX2MY2 SUMX2PY2 SUMXMY2 MMULT MDETERM MINVERSE MUNIT').split(' ');

test('the functions are registered, none volatile, and nothing sets a timer', () => {
  assert.equal(NAMES.length, 25);
  for (const name of NAMES) { assert.ok(C.fn(name), name); assert.ok(!C.fn(name).volatile, name); }
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-math3.js'), 'utf8')), 'no timers');
});

test('inverse hyperbolic functions: the pages\' examples, domains, and where Excel overflows squaring', () => {
  const e = book();
  shown(e, [['ACOSH(10)', '2.9932228'], ['ASINH(-2.5)', '-1.647231146'], ['ASINH(10)', '2.99822295'], ['ATANH(0.76159416)', '1.00000001'], ['ATANH(-0.1)', '-0.100335348'],
    ['ACOTH(6)', '0.168']]);
  cases(e, [['ACOSH(1)', 0], ['ACOSH(0.5)', '#NUM!'], ['ACOSH(-1)', '#NUM!'], ['ACOSH("x")', '#VALUE!'], ['ATANH(1)', '#NUM!'], ['ATANH(-1)', '#NUM!'],
    // Excel squares the number: past about 1.34E+154 that overflows.
    ['ACOSH(1.35E+154)', '#NUM!'], ['ACOSH(1E+200)', '#NUM!'], ['ASINH(1.35E+154)', '#NUM!'], ['ASINH(-1E+300)', '#NUM!'],
    // ...and adds 1 under the root, so a tiny number's ASINH is 0; ATANH and ACOTH keep tiny results.
    ['ASINH(1E-300)', 0], ['ATANH(1E-20)', 1e-20], ['ACOTH(1E+300)', 1e-300], ['ACOTH(-1E+300)', -1e-300],
    ['ACOTH(1)', '#NUM!'], ['ACOTH(-1)', '#NUM!'], ['ACOTH(0.5)', '#NUM!'], ['ACOTH(-0.5)', '#NUM!'], ['ACOTH(0)', '#NUM!']]);
  near(e, [['ACOSH(1E+154)', 355.291251501643], ['ACOSH(1.3E+154)', 355.55361576611], ['ASINH(-1E+154)', -355.291251501643], ['ASINH(-2.5)', -1.6472311463711],
    ['ATANH(0.76159416)', 1.00000000962972], ['ACOTH(-2)', -0.549306144334055], ['ACOTH(2^27)', 7.45058059692383e-9]]);
});

test('COT CSC SEC: the pages\' examples; 0 divides by zero; |x| of 2^27 or more is #NUM!', () => {
  const e = book({ A5: 45 });
  shown(e, [['COT(30)', '-0.156'], ['COT(A5)', '0.617'], ['CSC(15)', '1.538'], ['SEC(45)', '1.90359'], ['SEC(30)', '6.48292']]);
  cases(e, [['COT(0)', '#DIV/0!'], ['CSC(0)', '#DIV/0!'], ['COT(2^27)', '#NUM!'], ['COT(-2^27)', '#NUM!'], ['CSC(2^27)', '#NUM!'], ['SEC(2^27)', '#NUM!'],
    ['SEC(-2^27)', '#NUM!'], ['COT("x")', '#VALUE!'], ['CSC("x")', '#VALUE!'], ['SEC("x")', '#VALUE!']]);
  near(e, [['COT(2^27-1)', 0.30689377710631], ['SEC(PI()/2)', 1.63312393531954e16], ['CSC(PI())', 8.16561967659768e15], ['COT(PI()/2)', 6.12323399573677e-17],
    ['COT(30)', -0.156119952161659], ['SEC(45)', 1.90359440740442], ['CSC(15)', 1.53778056154085]]);
});

test('COTH CSCH SECH ACOT: the pages\' examples; Excel applies no 2^27 limit to the hyperbolic ones', () => {
  const e = book();
  shown(e, [['COTH(2)', '1.037'], ['CSCH(1.5)', '0.4696'], ['SECH(45)', '5.73E-20'], ['SECH(30)', '1.87E-13'], ['ACOT(2)', '0.4636']]);
  cases(e, [['COTH(0)', '#DIV/0!'], ['CSCH(0)', '#DIV/0!'], ['COTH(2^27)', 1], ['COTH(-2^27)', -1], ['COTH(1E+300)', 1], ['CSCH(2^27)', 0], ['CSCH(-800)', 0],
    ['SECH(2^27)', 0], ['SECH(-1000)', 0], ['COTH("x")', '#VALUE!'], ['ACOT("x")', '#VALUE!'],
    // ACOT runs from 0 to pi: a negative number's angle is past pi/2.
    ['ACOT(0)', Math.PI / 2], ['ACOT(1E+300)', 1e-300], ['ACOT(-1E+300)', Math.PI], ['ACOT(-1E-300)', Math.PI / 2]]);
  near(e, [['COTH(-1E-300)', -1e300], ['ACOT(-1)', 2.35619449019234], ['ACOT(-2)', 2.67794504458899], ['SECH(45)', 5.72503716109879e-20], ['COTH(2)', 1.03731472072755], ['CSCH(1.5)', 0.469642440595225]]);
});

test('CEILING.PRECISE FLOOR.PRECISE ISO.CEILING: the pages\' examples; significance\'s sign ignored, 0 gives 0', () => {
  const e = book();
  cases(e, [
    ['CEILING.PRECISE(4.3)', 5], ['CEILING.PRECISE(-4.3)', -4], ['CEILING.PRECISE(4.3, 2)', 6], ['CEILING.PRECISE(4.3,-2)', 6], ['CEILING.PRECISE(-4.3,2)', -4],
    ['CEILING.PRECISE(-4.3,-2)', -4],
    ['FLOOR.PRECISE(-3.2,-1)', -4], ['FLOOR.PRECISE(3.2, 1)', 3], ['FLOOR.PRECISE(-3.2, 1)', -4], ['FLOOR.PRECISE(3.2,-1)', 3], ['FLOOR.PRECISE(3.2)', 3],
    ['ISO.CEILING(4.3)', 5], ['ISO.CEILING(-4.3)', -4], ['ISO.CEILING(4.3, 2)', 6], ['ISO.CEILING(4.3,-2)', 6], ['ISO.CEILING(-4.3,2)', -4], ['ISO.CEILING(-4.3,-2)', -4],
    ['CEILING.PRECISE(4.3,0)', 0], ['FLOOR.PRECISE(0,2)', 0], ['ISO.CEILING(-4.3,0)', 0], ['CEILING.PRECISE(4.3,)', 5],
    // The quotient at 15 digits, as Excel shows it.
    ['FLOOR.PRECISE(-3.2,0.1)', -3.2], ['CEILING.PRECISE(1.5,0.1)', 1.5],
    ['CEILING.PRECISE("x")', '#VALUE!'], ['FLOOR.PRECISE(1,"x")', '#VALUE!'],
    ['CEILING.PRECISE(-4.1,2)', -4], ['ISO.CEILING(4.3,-2)', 6],
  ]);
});

test('SQRTPI: the page\'s examples; a negative number is #NUM!', () => {
  const e = book();
  shown(e, [['SQRTPI(1)', '1.772454'], ['SQRTPI(2)', '2.506628']]);
  near(e, [['SQRTPI(2)', 2.5066282746310002]], 1e-15);
  cases(e, [['SQRTPI(-1)', '#NUM!'], ['SQRTPI(0)', 0], ['SQRTPI("x")', '#VALUE!']]);
});

test('COMBINA and PERMUTATIONA: the pages\' examples; arguments truncated; Excel\'s answers at 0 and on overflow', () => {
  const e = book();
  cases(e, [['COMBINA(4,3)', 20], ['COMBINA(10,3)', 220], ['PERMUTATIONA(3,2)', 9], ['PERMUTATIONA(2,2)', 4],
    ['COMBINA(0,0)', 1], ['COMBINA(2,3)', 4], ['COMBINA(0,1)', '#NUM!'], ['COMBINA(1,0)', 1], ['COMBINA(10,0)', 1], ['COMBINA(-1,2)', '#NUM!'], ['COMBINA(2,-1)', '#NUM!'],
    ['COMBINA(4.9,3.9)', 20], ['COMBINA(1000,500)', '#NUM!'], ['COMBINA(200,2)', 20100], ['COMBINA(171,1)', 171], ['COMBINA(170,2)', 14535], ['COMBINA(2^53,1)', '#NUM!'],
    ['COMBINA("x",1)', '#VALUE!'],
    // The page says no objects is #NUM!; Excel counts the one empty arrangement, and none of length 1.
    ['PERMUTATIONA(0,0)', 1], ['PERMUTATIONA(0,1)', 0], ['PERMUTATIONA(2,0)', 1], ['PERMUTATIONA(3.9,2.9)', 9], ['PERMUTATIONA(-1,2)', '#NUM!'], ['PERMUTATIONA(2,-1)', '#NUM!'],
    // Excel refuses a number or count of 2^31-1 or more (1E+9 still passes).
    ['PERMUTATIONA(1,1E+9)', 1], ['PERMUTATIONA(1,2^31-1)', '#NUM!'], ['PERMUTATIONA(1,2^40)', '#NUM!'], ['PERMUTATIONA(2^40,1)', '#NUM!'], ['PERMUTATIONA(0,2^40)', '#NUM!'],
    ['PERMUTATIONA(10,400)', '#NUM!'], ['PERMUTATIONA(2,1024)', '#NUM!'], ['PERMUTATIONA(2,"x")', '#VALUE!']]);
  near(e, [['PERMUTATIONA(2,1000)', 1.07150860718627e301]]);
});

test('MULTINOMIAL: the page\'s example; numbers truncated; text or TRUE in a range is #VALUE!; a sum past 170 overflows', () => {
  const e = book({ J1: 2, J2: 3, J3: 4, A1: 1, C1: 1, C2: 'x', E1: 1, E2: true, G1: 1, G2: '#N/A' });
  cases(e, [['MULTINOMIAL(2, 3, 4)', 1260], ['MULTINOMIAL(J1:J3)', 1260], ['MULTINOMIAL({2,3,4})', 1260], ['MULTINOMIAL(2.5,3)', 10], ['MULTINOMIAL(2.9,3.9)', 10],
    ['MULTINOMIAL(-1,2)', '#NUM!'], ['MULTINOMIAL(-0.5,2)', '#NUM!'], ['MULTINOMIAL(0)', 1], ['MULTINOMIAL("2",3)', 10], ['MULTINOMIAL(1,TRUE)', '#VALUE!'],
    ['MULTINOMIAL("x")', '#VALUE!'], ['MULTINOMIAL(C1:C2)', '#VALUE!'], ['MULTINOMIAL(E1:E2)', '#VALUE!'], ['MULTINOMIAL(A1:A2)', 1], ['MULTINOMIAL(G1:G2)', '#N/A'],
    ['MULTINOMIAL(170,1)', '#NUM!'], ['MULTINOMIAL(171)', '#NUM!'], ['MULTINOMIAL(100,100)', '#NUM!'], ['MULTINOMIAL(1000,1)', '#NUM!']]);
  // 170!/(85!·85!) exactly; Excel shows 9.14484184513371E+49 here and 1.0000000000002 for MULTINOMIAL(170), off in
  // the 12th digit.
  near(e, [['MULTINOMIAL(85,85)', 9.1448418451315549893681152591738975450186892788720e49], ['MULTINOMIAL(170)', 1], ['MULTINOMIAL(169,1)', 170]]);
});

test('SUMX2MY2 SUMX2PY2 SUMXMY2: the pages\' examples; pairs with a non-number skipped; sizes must match', () => {
  const e = book({
    A2: 2, B2: 6, A3: 3, B3: 5, A4: 9, B4: 11, A5: 1, B5: 7, A6: 8, B6: 5, A7: 7, B7: 4, A8: 5, B8: 4,
    D3: 2, E3: 6, D4: 3, E4: 5, D5: 9, E5: 11, D6: 1, E6: 7, D7: 8, E7: 5, D8: 7, E8: 4, D9: 5, E9: 4,
    G1: 1, G2: '#N/A', H1: 2, H2: 3, J1: 1, K1: 2, K2: 3, P1: 'x',
    'Data!A1': 3, 'Data!A2': 1, 'Data!A3': 4, 'Data!A4': 1, 'Data!A5': 5, 'Data!B1': 2, 'Data!B2': 7, 'Data!B3': 1, 'Data!B4': 8, 'Data!B5': 2,
  }, { sheets: ['Sheet1', 'Data'] });
  cases(e, [
    ['SUMX2MY2(A2:A8,B2:B8)', -55], ['SUMX2MY2({2, 3, 9, 1, 8, 7, 5}, {6, 5, 11, 7, 5, 4, 4})', -55],
    ['SUMX2PY2(D3:D9,E3:E9)', 521], ['SUMX2PY2({2,3,9,1,8,7,5}, {6,5,11,7,5,4,4})', 521],
    ['SUMXMY2(D3:D9,E3:E9)', 79], ['SUMXMY2({2, 3, 9, 1, 8, 7, 5}, {6, 5, 11, 7, 5, 4, 4})', 79],
    ['SUMX2MY2(Data!A1:A5,Data!B1:B5)', -70], ['SUMX2PY2(Data!A1:A5,Data!B1:B5)', 174], ['SUMXMY2(Data!A1:A5,Data!B1:B5)', 104],
    ['SUMX2MY2({1,"a",TRUE},{1,2,3})', 0], ['SUMX2MY2({1,2},{1;2})', 0], ['SUMXMY2({1,2;3,4},{1,2,3,4})', 0], ['SUMX2MY2(3,2)', 5],
    ['SUMX2MY2(J1:J2,K1:K2)', -3], ['SUMX2MY2({1,2},{1,2,3})', '#N/A'], ['SUMX2PY2({1,2},"a")', '#N/A'], ['SUMX2PY2(1,{1,2})', '#N/A'],
    ['SUMX2MY2(G1:G2,H1:H2)', '#N/A'],
    // No pair of numbers at all divides by zero, as in Excel.
    ['SUMX2MY2("3",2)', '#DIV/0!'], ['SUMX2PY2(TRUE,1)', '#DIV/0!'], ['SUMX2MY2({"a","b"},{1,2})', '#DIV/0!'], ['SUMXMY2(M1:M2,N1:N2)', '#DIV/0!'],
    ['SUMX2MY2(P1,H1)', '#DIV/0!'],
    // Except that a one-cell reference to a blank is #VALUE!, either side.
    ['SUMX2MY2(M1,H1)', '#VALUE!'], ['SUMX2MY2(H1,M1)', '#VALUE!'], ['SUMX2PY2(M1,M2)', '#VALUE!'], ['SUMX2MY2(M1,"a")', '#VALUE!'],
  ]);
});

test('MMULT: the pages\' examples; only numbers; array1\'s columns must be array2\'s rows', () => {
  const e = book({
    A2: 1, B2: 3, A3: 7, B3: 2, A5: 2, B5: 0, A6: 0, B6: 2,
    // MMULT's second example: quantities of corks, bottles and barrels; each one's price and weight.
    'Sheet2!B3': 14, 'Sheet2!C3': 9, 'Sheet2!D3': 3, 'Sheet2!B4': 2, 'Sheet2!C4': 11, 'Sheet2!D4': 15,
    'Sheet2!A6': 200, 'Sheet2!B6': 4, 'Sheet2!A7': 250, 'Sheet2!B7': 42, 'Sheet2!A8': 425, 'Sheet2!B8': 115,
    G1: 1, G2: '#N/A', H1: 2, H2: 3, J1: 1, K1: 2, K2: 3, L1: 1, L2: true, M1: 2, M2: 3,
  }, { sheets: ['Sheet1', 'Sheet2'] });
  assert.deepEqual(spill(e, 'MMULT(A2:B3,A5:B6)'), [[2, 6], [14, 4]]);
  assert.deepEqual(spill(e, 'MMULT(Sheet2!B3:D4,Sheet2!A6:B8)'), [[6325, 779], [9525, 2195]]);
  assert.deepEqual(spill(e, 'MMULT({1,2;3,4},{5;6})'), [[17], [39]]);
  assert.deepEqual(spill(e, 'MUNIT(3)'), [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  cases(e, [['AND(MMULT({1,3;5,12},MUNIT(2))={1,3;5,12})', true], ['INDEX(MMULT({1,2;3,4},{5;6}),2,1)', 39], ['MMULT(2,3)', 6],
    ['INDEX(MMULT({1,2;3,4},{5,6}),1,1)', '#VALUE!'], ['INDEX(MMULT({1,2},{5;6;7}),1,1)', '#VALUE!'], ['INDEX(MMULT({1,2},{3;"a"}),1,1)', '#VALUE!'],
    ['INDEX(MMULT({1,TRUE},{3;4}),1,1)', '#VALUE!'], ['INDEX(MMULT(J1:K2,K1:K2),1,1)', '#VALUE!'], ['INDEX(MMULT(L1:M2,K1:K2),1,1)', '#VALUE!'],
    ['INDEX(MMULT(G1:H2,K1:K2),1,1)', '#N/A'], ['INDEX(MMULT({1,2;3,4},{1;#N/A}),1,1)', '#N/A'], ['INDEX(MMULT({1,2;3,4},{1,2;"a",#N/A}),1,1)', '#VALUE!']]);
});

test('MDETERM: the page\'s examples; square and all numbers, else #VALUE!; a singular matrix\'s exact 0 kept', () => {
  const e = book({ A2: 1, B2: 3, C2: 8, D2: 5, A3: 1, B3: 3, C3: 6, D3: 1, A4: 1, B4: 1, C4: 1, D4: 0, A5: 7, B5: 3, C5: 10, D5: 2,
    G1: 1, G2: '#N/A', H1: 2, H2: 3, J1: 1, K1: 2, K2: 3, L1: 1, L2: true, M1: 2, M2: 3, N1: 1, N2: 'x', O1: 2, O2: 3 });
  near(e, [['MDETERM(A2:D5)', 88], ['MDETERM({3,6,1;1,1,0;3,10,2})', 1], ['MDETERM({3,6;1,1})', -3], ['MDETERM({4,7;2,6})', 10], ['MDETERM({1.1,2.2;3.3,4.4})', -2.42],
    ['MDETERM({2,1,1;4,-6,0;-2,7,2})', -16], ['MDETERM({1,2,3;4,5,6;7,8,9})', 6.66133814775094e-16]]);
  cases(e, [['MDETERM({1,3,8,5;1,3,6,1})', '#VALUE!'], ['MDETERM({1,2;3,4})', -2], ['MDETERM({1,2;2,4})', 0], ['MDETERM({1,2,1;2,4,2;1,0,1})', 0], ['MDETERM({0,0;0,0})', 0],
    ['MDETERM({0,1;1,0})', -1], ['MDETERM(5)', 5], ['MDETERM("5")', '#VALUE!'], ['MDETERM(J1:K2)', '#VALUE!'], ['MDETERM(N1:O2)', '#VALUE!'], ['MDETERM(L1:M2)', '#VALUE!'],
    ['MDETERM(G1:H2)', '#N/A'], ['MDETERM({1,"a";2,3})', '#VALUE!'], ['MDETERM({1,TRUE;2,3})', '#VALUE!']]);
  assert.ok(Object.is(calc(e, 'MDETERM({1,2;2,4})'), 0), 'an exact 0');
});

test('MINVERSE: the page\'s examples; a singular matrix is #NUM!; square and all numbers, else #VALUE!', () => {
  const e = book({ A2: 4, B2: -1, A3: 2, B3: 0, D2: 1, E2: 2, F2: -1, D3: 3, E3: 4, F3: -1, D4: 0, E4: 2, F4: 0, J1: 1, K1: 2, K2: 3, L1: 1, L2: true, M1: 2, M2: 3 });
  grid(e, 'MINVERSE(A2:B3)', [[0, 0.5], [-1, 2]]);
  grid(e, 'MINVERSE(D2:F4)', [[-0.5, 0.5, -0.5], [0, 0, 0.5], [-1.5, 0.5, 0.5]]);
  grid(e, 'MINVERSE({4,7;2,6})', [[0.6, -0.7], [-0.2, 0.4]]);
  // Excel's 15 digits: pivoting leaves this singular matrix a tiny determinant, so it inverts to huge values.
  near(e, [['INDEX(MINVERSE({1,2,3;4,5,6;7,8,9}),1,1)', -4.5035996273705e15], ['INDEX(MINVERSE({1,2,3;4,5,6;7,8,9}),1,2)', 9.00719925474099e15],
    ['INDEX(MINVERSE({1,2,3;4,5,6;7,8,9}),3,3)', -4.5035996273705e15]]);
  cases(e, [['INDEX(MINVERSE({4,7;2,6}),1,1)', 0.6000000000000001], ['INDEX(MINVERSE({1,2;2,4}),1,1)', '#NUM!'], ['INDEX(MINVERSE({0,0;0,0}),1,1)', '#NUM!'],
    ['MINVERSE(4)', 0.25], ['MINVERSE(0)', '#NUM!'], ['INDEX(MINVERSE(J1:K2),1,1)', '#VALUE!'], ['INDEX(MINVERSE(L1:M2),1,1)', '#VALUE!'],
    ['INDEX(MINVERSE({1,3,8,5;1,3,6,1}),1,1)', '#VALUE!'], ['MINVERSE("x")', '#VALUE!']]);
});

test('MUNIT: the page\'s example; dimension truncated, under 1 is #VALUE!', () => {
  const e = book();
  assert.deepEqual(spill(e, 'MUNIT(2.7)'), [[1, 0], [0, 1]]);
  cases(e, [['MUNIT(0)', '#VALUE!'], ['MUNIT(-1)', '#VALUE!'], ['ROWS(MUNIT(0.5))', '#VALUE!'], ['MUNIT("a")', '#VALUE!'], ['INDEX(MUNIT(3),2,1)', 0],
    ['MUNIT(TRUE)', 1], ['ROWS(MUNIT(1))', 1], ['ROWS(MUNIT(2.7))', 2], ['MUNIT(501)', '#NUM!']]);
});

test('the golden cases, at the golden file\'s 1e-12', () => {
  const e = book();
  near(e, [['SQRTPI(2)', 2.5066282746310002], ['ASINH(1)', 0.8813735870195429], ['ATANH(0.5)', 0.5493061443340549], ['COT(1)', 0.6420926159343308],
    ['CSC(1)', 1.1883951057781212], ['SEC(1)', 1.8508157176809255], ['ACOT(1)', 0.7853981633974483], ['MULTINOMIAL(2,3,4)', 1259.999999999999]], 1e-12);
  cases(e, [['ACOSH(1)', 0], ['ACOSH(0.5)', '#NUM!'], ['COT(0)', '#DIV/0!'], ['COMBINA(4,3)', 20], ['PERMUTATIONA(3,2)', 9], ['MDETERM({1,2;3,4})', -2], ['MDETERM({1,2;2,4})', 0]]);
});

test('COMBINA and PERMUTATIONA reject negative inputs before truncation', () => {
  cases(book(), [['COMBINA(-0.5,1)', '#NUM!'], ['COMBINA(2,-0.5)', '#NUM!'],
    ['PERMUTATIONA(-0.5,2)', '#NUM!'], ['PERMUTATIONA(2,-0.5)', 1]]);
});
