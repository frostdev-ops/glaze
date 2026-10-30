// The statistical functions (lib/sheet-fn-stats.js). Each group's cases are the worked examples on Microsoft's page for
// the function (support.microsoft.com/en-us/excel/functions/<name>-function), its table laid out as it lands pasted at
// A1, header rows and the formula table's own header row included: AVERAGEA(A2:A5,A7) and AVERAGEIFS(B2:B5,...) reach
// into them, and Microsoft's results count that text. Where a page shows its example only as an image (PERCENTILE,
// PERCENTILE.EXC, CORREL, FREQUENCY), the image's data. A result Microsoft prints rounded is matched to the digits it
// prints. Edge cases follow each page's Remarks. The normal distribution is also held to 1e-12 against values computed
// to 100 digits at the double each formula passes (Python's decimal module: erf's Taylor series, Newton's method for
// the inverse).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-text.js');
require('../lib/sheet-fn-stats.js');

// A calculated workbook: rows of typed input from A1 (null leaves a cell blank), then { ref: input } cells, where an
// input { f, a } is an array formula over the range a.
const book = (rows = [], extra = {}) => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  const put = (r, c, input) => {
    let cell;
    if (input && typeof input === 'object') cell = { t: 'n', v: 0, f: input.f, a: input.a };
    else {
      const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
      cell = x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v };
    }
    M.apply(wb, { op: 'set', sheet: sh.id, r, c, cell });
  };
  rows.forEach((row, r) => row.forEach((v, c) => { if (v !== null && v !== undefined) put(r, c, v); }));
  for (const [ref, v] of Object.entries(extra)) put(...M.cellPosition(ref), v);
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const val = (e, ref) => out(e.value(e.wb.sheets[0].id, ...M.cellPosition(ref)));
const calc = (e, f, at = 'Z100') => out(e.evaluate(f, e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
// Results Microsoft prints rounded: equal to the digits printed.
const prints = (e, rows) => {
  for (const [f, printed] of rows) {
    const x = calc(e, f), d = (printed.split('.')[1] ?? '').length;
    assert.ok(typeof x === 'number' && Math.abs(x - Number(printed)) <= 0.50001 * 10 ** -d, `${f} = ${x}; Microsoft prints ${printed}`);
  }
};
const close = (e, rows, tol = 1e-12) => {
  for (const [f, want] of rows) {
    const x = calc(e, f);
    assert.ok(typeof x === 'number' && Math.abs(x - want) <= tol * Math.abs(want), `${f} = ${x}; want ${want}`);
  }
};
const column = (header, values) => [[header], ...values.map((v) => [v])];

test('the statistical functions are registered; legacy names are their new functions', () => {
  const names = ('AVERAGEA AVERAGEIFS MEDIAN MODE MODE.SNGL STDEV STDEV.S STDEV.P STDEVP STDEVA STDEVPA VAR VAR.S VAR.P VARP VARA VARPA '
    + 'LARGE SMALL RANK RANK.EQ RANK.AVG PERCENTILE PERCENTILE.INC PERCENTILE.EXC QUARTILE QUARTILE.INC QUARTILE.EXC MAXA MINA MAXIFS '
    + 'MINIFS GEOMEAN HARMEAN TRIMMEAN AVEDEV DEVSQ CORREL PEARSON COVARIANCE.P COVARIANCE.S SLOPE INTERCEPT RSQ FORECAST '
    + 'FORECAST.LINEAR NORM.DIST NORM.S.DIST NORM.INV NORM.S.INV STANDARDIZE PERMUT COMBIN FREQUENCY').split(' ');
  for (const name of names) assert.ok(C.fn(name), name);
  const legacy = { MODE: 'MODE.SNGL', STDEV: 'STDEV.S', STDEVP: 'STDEV.P', VAR: 'VAR.S', VARP: 'VAR.P', RANK: 'RANK.EQ', PERCENTILE: 'PERCENTILE.INC', QUARTILE: 'QUARTILE.INC', FORECAST: 'FORECAST.LINEAR' };
  for (const [old, name] of Object.entries(legacy)) assert.equal(C.fn(old).fn, C.fn(name).fn, old);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-stats.js'), 'utf8')), 'no timers');
});

test('AVERAGEA, MAXA, MINA: text in a range is 0, booleans 1 and 0', () => {
  // averagea-function: A7 holds the formula table's header, "Formula", which AVERAGEA(A2:A5,A7) counts as 0.
  const e = book([...column('Data', [10, 7, 9, 2, 'Not available']), ['Formula']]);
  prints(e, [['AVERAGEA(A2:A6)', '5.6'], ['AVERAGEA(A2:A5,A7)', '5.6']]);
  cases(e, [['AVERAGEA(A2:A5)', 7], ['AVERAGEA(TRUE,"4")', 2.5], ['AVERAGEA("x")', '#VALUE!'], ['AVERAGEA(A2,1/0)', '#DIV/0!'], ['AVERAGEA(Z1:Z3)', '#DIV/0!']]);
  // maxa-function, mina-function
  cases(book(column('Data', [0, 0.2, 0.5, 0.4, true])), [['MAXA(A2:A6)', 1], ['MAXA(Z1:Z3)', 0], ['MAX(A2:A6)', 0.5]]);
  cases(book(column('Data', [false, 0.2, 0.5, 0.4, 0.8])), [['MINA(A2:A6)', 0], ['MINA(Z1:Z3)', 0], ['MIN(A2:A6)', 0.2]]);
  cases(book([[-5], ['abc'], [-2]]), [['MAXA(A1:A3)', 0], ['MAX(A1:A3)', -2], ['MINA(A1:A3)', -5], ['MAXA(A1:A3,"3")', 3], ['MAXA(A1:A3,"x")', '#VALUE!']]);
});

test('AVERAGEIFS, MAXIFS, MINIFS, with Microsoft\'s data', () => {
  // averageifs-function, example 1 as printed: its header spans rows 1-3, so B2:B5 holds "Quiz", "Grade", 75, 94.
  const quiz = book([
    ['Student', 'First', 'Second', 'Final'], [null, 'Quiz', 'Quiz', 'Exam'], [null, 'Grade', 'Grade', 'Grade'],
    ['Emilio', 75, 85, 87], ['Julie', 94, 80, 88], ['Hans', 86, 93, 'Incomplete'], ['Frederique', 'Incomplete', 75, 75],
  ]);
  cases(quiz, [
    ['AVERAGEIFS(B2:B5, B2:B5, ">70", B2:B5, "<90")', 75], ['AVERAGEIFS(C2:C5, C2:C5, ">95")', '#DIV/0!'],
    ['AVERAGEIFS(D2:D5, D2:D5, "<>Incomplete", D2:D5, ">80")', 87.5], ['AVERAGEIFS(B4:B7, B4:B7, ">70", B4:B7, "<90")', 80.5],
    ['AVERAGEIFS(B2:B5, C2:C6, ">0")', '#VALUE!'],
  ]);
  const homes = book([
    ['Type', 'Price', 'Town', 'Number of Bedrooms', 'Garage?'], ['Cozy Rambler', 230000, 'Issaquah', 3, 'No'], ['Snug Bungalow', 197000, 'Bellevue', 2, 'Yes'],
    ['Cool Cape Codder', 345678, 'Bellevue', 4, 'Yes'], ['Splendid Split Level', 321900, 'Issaquah', 2, 'Yes'], ['Exclusive Tudor', 450000, 'Bellevue', 5, 'Yes'],
    ['Classy Colonial', 395000, 'Bellevue', 4, 'No'],
  ]);
  cases(homes, [
    ['AVERAGEIFS(B2:B7, C2:C7, "Bellevue", D2:D7, ">2",E2:E7, "Yes")', 397839], ['AVERAGEIFS(B2:B7, C2:C7, "Issaquah", D2:D7, "<=3",E2:E7, "No")', 230000],
  ]);
  // maxifs-function and minifs-function, examples 1-6 each.
  const ex = (rows) => book(rows);
  const levels = (data) => [['Weight', 'Grade', 'Class', 'Level'], ...data];
  cases(ex([['Grade', 'Weight'], [89, 1], [93, 2], [96, 2], [85, 3], [91, 1], [88, 1]]), [['MAXIFS(A2:A7,B2:B7,1)', 91], ['MINIFS(A2:A7,B2:B7,1)', 88]]);
  cases(ex([['Weight', 'Grade'], [10, 'b'], [1, 'a'], [100, 'a'], [1, 'b'], [1, 'a'], [1, 'a']]), [['MAXIFS(A2:A5,B3:B6,"a")', 10], ['MAXIFS(A2:A5,B2:c6,"a")', '#VALUE!'], ['MINIFS(A2:A5,B2:C6,"a")', '#VALUE!']]);
  cases(ex([['Weight', 'Grade'], [10, 'b'], [11, 'a'], [100, 'a'], [111, 'b'], [1, 'a'], [1, 'a']]), [['MINIFS(A2:A5,B3:B6,"a")', 10]]);
  cases(ex(levels([[10, 'b', 'Business', 100], [1, 'a', 'Technical', 100], [100, 'a', 'Business', 200], [1, 'b', 'Technical', 300], [1, 'a', 'Technical', 100], [50, 'b', 'Business', 400]])),
    [['MAXIFS(A2:A7,B2:B7,"b",D2:D7,">100")', 50]]);
  cases(ex(levels([[10, 'b', 'Business', 100], [11, 'a', 'Technical', 100], [12, 'a', 'Business', 200], [13, 'b', 'Technical', 300], [14, 'b', 'Technical', 300], [15, 'b', 'Business', 400]])),
    [['MINIFS(A2:A7,B2:B7,"b",D2:D7,">100")', 13]]);
  cases(ex(levels([[10, 'b', 'Business', 8], [1, 'a', 'Technical', 8], [100, 'a', 'Business', 8], [11, 'b', 'Technical', 0], [1, 'a', 'Technical', 8], [12, 'b', 'Business', 0]])),
    [['MAXIFS(A2:A7,B2:B7,"b",D2:D7,A8)', 12]]);
  cases(ex(levels([[10, 'b', 'Business', 8], [1, 'a', 'Technical', 8], [100, 'a', 'Business', 8], [11, 'b', 'Technical', 0], [1, 'a', 'Technical', 8], [1, 'b', 'Business', 0]])),
    [['MINIFS(A2:A7,B2:B7,"b",D2:D7,A8)', 1]]);
  cases(ex(levels([[10, 'b', 'Business', 100], [1, 'a', 'Technical', 100], [100, 'a', 'Business', 200], [1, 'b', 'Technical', 300], [1, 'a', 'Technical', 100], [1, 'a', 'Business', 400]])),
    [['MAXIFS(A2:A6,B2:B6,"a",D2:D6,">200")', 0], ['MINIFS(A2:A6,B2:B6,"a",D2:D6,">200")', 0]]);
});

test('MEDIAN and MODE: ranges give numbers only, typed booleans and number text count', () => {
  // median-function
  const e = book(column('Data', [1, 2, 3, 4, 5, 6]));
  cases(e, [
    ['MEDIAN(A2:A6)', 3], ['MEDIAN(A2:A7)', 3.5], ['MEDIAN(A1:A6)', 3], ['MEDIAN(TRUE,"3",5)', 3], ['MEDIAN(A2:A4,0)', 1.5],
    ['MEDIAN({1,"2",TRUE,4})', 2.5], ['MEDIAN("x")', '#VALUE!'], ['MEDIAN(A2:A6,1/0)', '#DIV/0!'], ['MEDIAN(Z1:Z3)', '#NUM!'],
  ]);
  // mode-function, mode-sngl-function
  const m = book(column('Data', [5.6, 4, 4, 3, 2, 4]));
  cases(m, [['MODE(A2:A7)', 4], ['MODE.SNGL(A2:A7)', 4], ['MODE(A2,A5,A6)', '#N/A'], ['MODE({1,2,3})', '#N/A'], ['MODE.SNGL(A2:A7,"x")', '#VALUE!']]);
});

test('STDEV and VAR, sample and population, plain and A', () => {
  const strength = [1345, 1301, 1368, 1322, 1310, 1370, 1318, 1350, 1303, 1299];
  // stdev-, stdev-p-, stdevp-, stdeva-, stdevpa-function: "Data", "Strength", then the ten values in A3:A12.
  const s = book([['Data'], ...column('Strength', strength)]);
  prints(s, [
    ['STDEV(A3:A12)', '27.46392'], ['STDEV.P(A3:A12)', '26.05455814'], ['STDEVP(A3:A12)', '26.05456'], ['STDEVA(A3:A12)', '27.46391572'],
    ['STDEVPA(A3:A12)', '26.05456'], ['STDEV(A1:A12)', '27.46391572'],
  ]);
  // var-, var-s-, var-p-, varp-, vara-, varpa-function, and stdev-s-function's result: "Strength", then A2:A11.
  const v = book(column('Strength', strength));
  prints(v, [
    ['STDEV.S(A2:A11)', '27.46391572'], ['VAR(A2:A11)', '754.2667'], ['VAR.S(A2:A11)', '754.27'], ['VAR.P(A2:A11)', '678.84'], ['VARP(A2:A11)', '678.84'],
    ['VARA(A2:A11)', '754.26667'], ['VARPA(A2:A11)', '678.84'],
  ]);
  // The A variants count the header text as 0.
  const n = strength.length + 1, mean = strength.reduce((a, b) => a + b, 0) / n, ss = [0, ...strength].reduce((a, x) => a + (x - mean) ** 2, 0);
  for (const [f, want] of [['VARA(A1:A11)', ss / (n - 1)], ['VARPA(A1:A11)', ss / n], ['STDEVA(A1:A11)', Math.sqrt(ss / (n - 1))], ['STDEVPA(A1:A11)', Math.sqrt(ss / n)]]) {
    assert.ok(Math.abs(calc(v, f) - want) <= 1e-12 * want, f);
  }
  cases(v, [
    ['VAR(A1:A11)', calc(v, 'VAR(A2:A11)')], ['STDEV.S(5)', '#DIV/0!'], ['STDEV(Z1:Z3)', '#DIV/0!'], ['VAR.S(A2)', '#DIV/0!'], ['VAR(Z1:Z3)', '#DIV/0!'],
    ['STDEV.P(Z1:Z3)', '#DIV/0!'], ['VAR.P(Z1:Z3)', '#DIV/0!'], ['VARPA(Z1:Z3)', '#DIV/0!'], ['VAR.P(7)', 0], ['STDEV.P(A2)', 0],
    ['STDEV("x",1,2)', '#VALUE!'], ['VAR.S(TRUE,"3")', 2], ['VARA(A2:A11,1/0)', '#DIV/0!'],
  ]);
});

test('LARGE, SMALL, RANK, RANK.EQ, RANK.AVG', () => {
  // large-function
  const l = book([['Data', 'Data'], [3, 4], [5, 2], [3, 4], [5, 6], [4, 7]]);
  cases(l, [
    ['LARGE(A2:B6,3)', 5], ['LARGE(A2:B6,7)', 4], ['LARGE(A2:B6,1)', 7], ['LARGE(A2:B6,10)', 2], ['LARGE(A2:B6,0)', '#NUM!'], ['LARGE(A2:B6,11)', '#NUM!'],
    ['LARGE(Z1:Z3,1)', '#NUM!'], ['SUM(LARGE(A2:B6,{1,2}))', 13],
  ]);
  // small-function
  const s = book([['Data 1', 'Data 2'], [3, 1], [4, 4], [5, 8], [2, 3], [3, 7], [4, 12], [6, 54], [4, 8], [7, 23]]);
  cases(s, [['SMALL(A2:A10,4)', 4], ['SMALL(B2:B10,2)', 3], ['SMALL(A2:A10,1)', 2], ['SMALL(A2:A10,9)', 7], ['SMALL(A2:A10,10)', '#NUM!'], ['SMALL(A2:A10,-1)', '#NUM!']]);
  // rank-function, rank-eq-function; the Remarks' correction factor (5 + 1 - 2 - 3)/2 makes 3.5's revised rank 3.5.
  const r = book(column('Data', [7, 3.5, 3.5, 1, 2]), { C1: 1, C2: 2, C3: 3, C4: 4, C5: 10, C6: 10, C7: 11 });
  cases(r, [
    ['RANK(A3,A2:A6,1)', 3], ['RANK(A2,A2:A6,1)', 5], ['RANK.EQ(A2,A2:A6,1)', 5], ['RANK.EQ(A6,A2:A6)', 4], ['RANK.EQ(A3,A2:A6,1)', 3],
    ['RANK(A3,A2:A6,0)', 2], ['RANK.AVG(A3,A2:A6,1)', 3.5], ['RANK.AVG(A3,A2:A6)', 2.5], ['RANK(A3,A1:A6,1)', 3],
    ['RANK(10,C1:C7,1)', 5], ['RANK(11,C1:C7,1)', 7], ['RANK.AVG(10,C1:C7,1)', 5.5], ['RANK(5,A2:A6)', '#N/A'], ['RANK("x",A2:A6)', '#VALUE!'],
  ]);
  // rank-avg-function
  const t = book([['Day', 'Temp (F)'], ['7/1/2011', 89], ['7/2/2011', 88], ['7/3/2011', 92], ['7/4/2011', 101], ['7/5/2011', 94], ['7/6/2011', 97], ['7/7/2011', 95]]);
  cases(t, [['RANK.AVG(94,B2:B8)', 4]]);
});

test('PERCENTILE and QUARTILE: INC over [0, 1], EXC inside (0, 1), interpolating between ranks', () => {
  // percentile-inc-function; percentile-function's example (an image) has 1, 2, 3, 4 in E2:E5.
  const p = book(column('Data', [1, 3, 2, 4]), { E1: 'Data', E2: 1, E3: 2, E4: 3, E5: 4 });
  prints(p, [['PERCENTILE.INC(A2:A5,0.3)', '1.9'], ['PERCENTILE(E2:E5,0.3)', '1.9']]);
  cases(p, [
    ['PERCENTILE.INC(A2:A5,0)', 1], ['PERCENTILE.INC(A2:A5,1)', 4], ['PERCENTILE.INC(A2:A5,0.5)', 2.5], ['PERCENTILE.INC(A2:A5,-0.1)', '#NUM!'],
    ['PERCENTILE.INC(A2:A5,1.1)', '#NUM!'], ['PERCENTILE.INC(Z1:Z3,0.5)', '#NUM!'], ['PERCENTILE.INC(A2:A5,"x")', '#VALUE!'],
  ]);
  // percentile-exc-function's example (an image): 1 to 9 in B2:B10.
  const x = book([[null, 'Data'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => [null, v])]);
  cases(x, [
    ['PERCENTILE.EXC(B2:B10,0.25)', 2.5], ['PERCENTILE.EXC(B2:B10, 0)', '#NUM!'], ['PERCENTILE.EXC(B2:B10, 0.01)', '#NUM!'], ['PERCENTILE.EXC(B2:B10, 2)', '#NUM!'],
    ['PERCENTILE.EXC(B2:B10,0.1)', 1], ['PERCENTILE.EXC(B2:B10,0.9)', 9], ['PERCENTILE.EXC(B2:B10,0.95)', '#NUM!'], ['PERCENTILE.EXC(B2:B10,1)', '#NUM!'],
    ['PERCENTILE.EXC(Z1:Z3,0.5)', '#NUM!'],
  ]);
  // quartile-function, quartile-inc-function: quart 0, 2 and 4 are MIN, MEDIAN and MAX; a fraction is truncated.
  const q = book(column('Data', [1, 2, 4, 7, 8, 9, 10, 12]));
  cases(q, [
    ['QUARTILE(A2:A9,1)', 3.5], ['QUARTILE.INC(A2:A9,1)', 3.5], ['QUARTILE(A2:A9,0)', 1], ['QUARTILE(A2:A9,2)', 7.5], ['QUARTILE(A2:A9,4)', 12],
    ['QUARTILE(A2:A9,1.9)', 3.5], ['QUARTILE(A2:A9,-1)', '#NUM!'], ['QUARTILE(A2:A9,5)', '#NUM!'], ['QUARTILE(Z1:Z3,1)', '#NUM!'],
  ]);
  // quartile-exc-function
  const qx = book(column('Data', [6, 7, 15, 36, 39, 40, 41, 42, 43, 47, 49]));
  cases(qx, [
    ['QUARTILE.EXC(A2:A12,1)', 15], ['QUARTILE.EXC(A2:A12,3)', 43], ['QUARTILE.EXC(A2:A12,2)', 40], ['QUARTILE.EXC(A2:A12,0)', '#NUM!'],
    ['QUARTILE.EXC(A2:A12,4)', '#NUM!'], ['PERCENTILE.EXC(A2:A12,0.25)', 15], ['QUARTILE.EXC(Z1:Z3,1)', '#NUM!'],
  ]);
  close(qx, [['PERCENTILE.EXC(A2:A12,0.1)', 6.2]]);
});

test('GEOMEAN, HARMEAN, TRIMMEAN, AVEDEV, DEVSQ', () => {
  // geomean-, harmean-, devsq-function
  const e = book(column('Data', [4, 5, 8, 7, 11, 4, 3]));
  prints(e, [['GEOMEAN(A2:A8)', '5.476987'], ['HARMEAN(A2:A8)', '5.028376']]);
  cases(e, [
    ['DEVSQ(A2:A8)', 48], ['GEOMEAN(A2:A8,0)', '#NUM!'], ['HARMEAN(A2:A8,-1)', '#NUM!'], ['GEOMEAN(Z1:Z3)', '#NUM!'], ['HARMEAN(Z1:Z3)', '#N/A'],
    ['DEVSQ(Z1:Z3)', '#NUM!'], ['GEOMEAN(4,"9")', 6], ['HARMEAN(TRUE,1)', 1],
  ]);
  // avedev-function
  prints(book([['Data', 'Description'], [4, 'Average of the absolute deviations'], [5], [6], [7], [5], [4], [3]]), [['AVEDEV(A2:A8)', '1.020408']]);
  // trimmean-function; its Remarks: 10% of 30 points is 3, rounded down to 2, one from each end.
  const t = book(column('Data', [4, 5, 6, 7, 2, 3, 4, 5, 1, 2, 3]), Object.fromEntries([...Array(30)].map((_, i) => [`C${i + 1}`, i < 28 ? i + 1 : i === 28 ? 500 : 1000])));
  prints(t, [['TRIMMEAN(A2:A12,0.2)', '3.778']]);
  cases(t, [['TRIMMEAN(C1:C30,0.1)', calc(t, 'AVERAGE(C2:C29)')], ['TRIMMEAN(C1:C30,0.1)', 905 / 28], ['TRIMMEAN(A2:A12,0)', calc(t, 'AVERAGE(A2:A12)')], ['TRIMMEAN(A2:A12,-0.1)', '#NUM!'], ['TRIMMEAN(A2:A12,1.5)', '#NUM!'], ['TRIMMEAN(Z1:Z3,0.1)', '#NUM!']]);
});

test('CORREL, PEARSON, COVARIANCE, SLOPE, INTERCEPT, RSQ, FORECAST: pairs of numbers, one size', () => {
  // correl-function's example (an image) and covariance-p-function share their data. Row 7 adds a pair with text in
  // it, which the Remarks say is ignored.
  const e = book([['Data1', 'Data2'], [3, 9], [2, 7], [4, 12], [5, 15], [6, 17], ['n/a', 100]]);
  prints(e, [['CORREL(A2:A6,B2:B6)', '0.997054486'], ['CORREL(A2:A7,B2:B7)', '0.997054486'], ['COVARIANCE.P(A2:A6, B2:B6)', '5.2']]);
  cases(e, [
    ['CORREL(A2:A6,B2:B5)', '#N/A'], ['PEARSON(A2:A6,B2:B5)', '#N/A'], ['COVARIANCE.P(A2:A6,B2:B5)', '#N/A'], ['COVARIANCE.S(A2:A6,B2:B5)', '#N/A'],
    ['SLOPE(A2:A6,B2:B5)', '#N/A'], ['INTERCEPT(A2:A6,B2:B5)', '#N/A'], ['RSQ(A2:A6,B2:B5)', '#N/A'], ['FORECAST(1,A2:A6,B2:B5)', '#N/A'],
    ['CORREL(Z1:Z5,Y1:Y5)', '#DIV/0!'], ['CORREL(A2:A6,{1;1;1;1;1})', '#DIV/0!'], ['COVARIANCE.P(Z1:Z5,Y1:Y5)', '#DIV/0!'],
    ['COVARIANCE.S(A2,B2)', '#DIV/0!'], ['RSQ(A2,B2)', '#DIV/0!'], ['CORREL(A2:A6,{1;2;3;4;#N/A})', '#N/A'],
  ]);
  // pearson-function
  prints(book([['Data'], ['Independent values', 'Dependent values'], [9, 10], [7, 6], [5, 1], [3, 5], [1, 3]]), [['PEARSON(A3:A7,B3:B7)', '0.699379'], ['CORREL(A3:A7,B3:B7)', '0.699379']]);
  // covariance-s-function: its formula row comes first, the data in A3:B5.
  prints(book([['Formula'], [null], [2, 5], [4, 11], [8, 12]]), [['COVARIANCE.S({2,4,8},{5,11,12})', '9.666666667'], ['COVARIANCE.S(A3:A5,B3:B5)', '9.666666667']]);
  // slope-function: its known y's are printed as the dates 1/2/1900 ... (the serials 2, 3, 9, 1, 8, 7, 5).
  const sl = book([['Data'], ['Known y', 'Known x'], ['1/2/1900', 6], ['1/3/1900', 5], ['1/9/1900', 11], ['1/1/1900', 7], ['1/8/1900', 5], ['1/7/1900', 4], ['1/5/1900', 4]]);
  prints(sl, [['SLOPE(A3:A9,B3:B9)', '0.305556']]);
  // The Remarks: known y's of 0 against known x's of 1 have no single line.
  cases(sl, [['SLOPE({0;0},{1;1})', '#DIV/0!'], ['INTERCEPT({0;0},{1;1})', '#DIV/0!'], ['FORECAST.LINEAR(2,{0;0},{1;1})', '#DIV/0!']]);
  // intercept-function, rsq-function
  prints(book([['Known y', 'Known x'], [2, 6], [3, 5], [9, 11], [1, 7], [8, 5]]), [['INTERCEPT(A2:A6, B2:B6)', '0.0483871']]);
  prints(book([['Data'], ['Known y', 'Known x'], [2, 6], [3, 5], [9, 11], [1, 7], [8, 5], [7, 4], [5, 4]]), [['RSQ(A3:A9, B3:B9)', '0.05795']]);
  // forecast-and-forecast-linear-functions
  const f = book([['Known Y', 'Known X'], [6, 20], [7, 28], [9, 31], [15, 38], [21, 40]]);
  prints(f, [['FORECAST.LINEAR(30,A2:A6,B2:B6)', '10.607253'], ['FORECAST(30,A2:A6,B2:B6)', '10.607253']]);
  cases(f, [['FORECAST.LINEAR("x",A2:A6,B2:B6)', '#VALUE!'], ['FORECAST(30,A2:A6,{1;1;1;1;1})', '#DIV/0!']]);
  const slope = calc(f, 'SLOPE(A2:A6,B2:B6)'), intercept = calc(f, 'INTERCEPT(A2:A6,B2:B6)');
  assert.ok(Math.abs(intercept + slope * 30 - calc(f, 'FORECAST(30,A2:A6,B2:B6)')) < 1e-12);
});

test('NORM.DIST, NORM.S.DIST, NORM.INV, NORM.S.INV, STANDARDIZE', () => {
  // norm-dist-, norm-inv-, standardize-function; norm-s-dist-, norm-s-inv-function have no data.
  const d = book([['Data', 'Description'], [42, 'Value'], [40, 'Mean'], [1.5, 'Standard deviation']], { D1: 'Data', D2: 0.908789, D3: 40, D4: 1.5 });
  prints(d, [
    ['NORM.DIST(A2,A3,A4,TRUE)', '0.9087888'], ['NORM.DIST(A2,A3,A4,FALSE)', '0.10934'], ['NORM.S.DIST(1.333333,TRUE)', '0.908788726'],
    ['NORM.S.DIST(1.333333,FALSE)', '0.164010148'], ['NORM.INV(D2,D3,D4)', '42.000002'], ['NORM.S.INV(0.908789)', '1.3333347'], ['STANDARDIZE(A2,A3,A4)', '1.33333333'],
  ]);
  cases(d, [
    ['NORM.DIST(A2,A3,0,TRUE)', '#NUM!'], ['NORM.DIST(A2,A3,-1,TRUE)', '#NUM!'], ['NORM.DIST(A2,"x",A4,TRUE)', '#VALUE!'], ['NORM.DIST(1.2,0,1,TRUE)', calc(d, 'NORM.S.DIST(1.2,TRUE)')],
    ['NORM.INV(0,40,1.5)', '#NUM!'], ['NORM.INV(1,40,1.5)', '#NUM!'], ['NORM.INV(0.5,40,0)', '#NUM!'], ['NORM.INV("x",40,1.5)', '#VALUE!'], ['NORM.INV(0.5,40,1.5)', 40],
    ['NORM.S.INV(0)', '#NUM!'], ['NORM.S.INV(1)', '#NUM!'], ['NORM.S.INV(-0.5)', '#NUM!'], ['NORM.S.INV("x")', '#VALUE!'], ['NORM.S.DIST("x",TRUE)', '#VALUE!'],
    ['STANDARDIZE(42,40,0)', '#NUM!'], ['NORM.S.DIST(0,TRUE)', 0.5], ['NORM.S.INV(0.5)', 0],
  ]);
  close(d, [
    ['NORM.S.DIST(1.96,TRUE)', 0.97500210485177952], ['NORM.S.DIST(-1,TRUE)', 0.15865525393145705], ['NORM.S.DIST(0.5,TRUE)', 0.69146246127401312],
    ['NORM.S.DIST(3,TRUE)', 0.9986501019683699], ['NORM.S.DIST(-5,TRUE)', 2.8665157187919391e-07], ['NORM.S.DIST(-10,TRUE)', 7.6198530241605255e-24],
    ['NORM.S.DIST(1.333333,TRUE)', 0.90878872560409507], ['NORM.S.DIST(0,FALSE)', 0.3989422804014327], ['NORM.S.DIST(1.333333,FALSE)', 0.16401014756936722],
    ['NORM.S.DIST(-2.5,FALSE)', 0.017528300493568537], ['NORM.S.INV(0.975)', 1.9599639845400538], ['NORM.S.INV(0.3)', -0.52440051270804078],
    ['NORM.S.INV(1e-10)', -6.3613409024040566], ['NORM.S.INV(0.908789)', 1.3333346730441074], ['NORM.S.INV(0.999999)', 4.7534243088170873],
    ['NORM.INV(0.975,40,1.5)', 42.93994597681008], ['NORM.DIST(42,40,1.5,TRUE)', 0.90878878027413212],
  ]);
  for (const p of [1e-300, 1e-100, 1e-20, 0.01, 0.2, 0.5, 0.75, 0.99]) close(d, [[`NORM.S.DIST(NORM.S.INV(${p}),TRUE)`, p]]);
});

test('PERMUT and COMBIN truncate their arguments', () => {
  // permut-function, combin-function
  const e = book([['Data', 'Description'], [100, 'Number of objects'], [3, 'Number of objects in each permutation']]);
  cases(e, [
    ['PERMUT(A2,A3)', 970200], ['PERMUT(3,2)', 6], ['PERMUT(3.9,2.9)', 6], ['PERMUT("x",2)', '#VALUE!'], ['PERMUT(0,0)', 1], ['PERMUT(3,-1)', '#NUM!'],
    ['PERMUT(2,3)', '#NUM!'], ['PERMUT(5,0)', 1], ['PERMUT(1e9,1e9)', '#NUM!'],
    ['COMBIN(8,2)', 28], ['COMBIN(8.9,2.7)', 28], ['COMBIN("x",2)', '#VALUE!'], ['COMBIN(-1,0)', '#NUM!'], ['COMBIN(3,-1)', '#NUM!'], ['COMBIN(2,3)', '#NUM!'],
    ['COMBIN(0,0)', 1], ['COMBIN(49,6)', 13983816], ['COMBIN(1e9,5e8)', '#NUM!'],
  ]);
  close(e, [['COMBIN(60,30)', 118264581564861424]], 1e-15);
});

test('FREQUENCY returns a column one longer than its bins', () => {
  // frequency-function's example (an image): scores in A2:A10, bins in B2:B4, the result in B14:B17.
  const e = book([['Scores', 'Bins'], [79, 70], [85, 79], [78, 89], [85], [50], [81], [95], [88], [97]], {
    B14: { f: 'FREQUENCY(A2:A10, B2:B4)', a: 'B14:B17' }, C14: { f: 'FREQUENCY(Z1:Z9,B2:B4)', a: 'C14:C17' }, D14: { f: 'FREQUENCY(A1:A10,B1:B4)', a: 'D14:D17' }, E1: '#DIV/0!',
  });
  assert.deepEqual(['B14', 'B15', 'B16', 'B17'].map((r) => val(e, r)), [1, 2, 4, 2]);
  assert.deepEqual(['C14', 'C15', 'C16', 'C17'].map((r) => val(e, r)), [0, 0, 0, 0], 'no data: zeros');
  assert.deepEqual(['D14', 'D15', 'D16', 'D17'].map((r) => val(e, r)), [1, 2, 4, 2], 'text is ignored');
  cases(e, [['FREQUENCY(A2:A10,Z1:Z3)', 9], ['SUM(FREQUENCY(A2:A10,B2:B4))', 9], ['FREQUENCY(A2:A10,B2:B4)', 1], ['FREQUENCY(A1:E1,B2:B4)', '#DIV/0!']]);
});

test('errors read in a range are the result; an argument left out reads as 0', () => {
  const e = book([[1, 4], ['#N/A', 5], [3, 6]]);
  for (const f of ['AVERAGEA', 'MEDIAN', 'MODE', 'STDEV', 'STDEVPA', 'VAR.P', 'MAXA', 'MINA', 'GEOMEAN', 'HARMEAN', 'AVEDEV', 'DEVSQ']) assert.equal(calc(e, `${f}(A1:A3)`), '#N/A', f);
  cases(e, [
    ['LARGE(A1:A3,1)', '#N/A'], ['PERCENTILE(A1:A3,0.5)', '#N/A'], ['QUARTILE.EXC(A1:A3,1)', '#N/A'], ['TRIMMEAN(A1:A3,0)', '#N/A'], ['RANK(1,A1:A3)', '#N/A'],
    ['CORREL(A1:A3,B1:B3)', '#N/A'], ['SLOPE(B1:B3,A1:A3)', '#N/A'], ['MAXIFS(A1:A3,B1:B3,">4")', '#N/A'], ['MAXIFS(A1:A3,B1:B3,"<5")', 1],
    ['NORM.S.DIST(#DIV/0!,TRUE)', '#DIV/0!'], ['MEDIAN(1,,5)', 1], ['AVERAGEA(4,)', 2], ['STDEV.P(1,)', 0.5],
  ]);
});

// Excel 16.114.1, hidden native workbook, 2026-10-30. Unlike references, array constants do not count logicals;
// only AVERAGEA counts their text. The reference fixture below has the same three kinds of value.
test('Excel array constants and references have distinct A coercion rules', () => {
  const e = book([['x'], [true], [4]]);
  close(e, [['AVERAGEA({1,"x",TRUE,4})', 5 / 3], ['AVERAGEA(A1:A3)', 5 / 3], ['VARA(A1:A3)', 13 / 3]]);
  cases(e, [
    ['AVERAGEA({TRUE,FALSE})', '#DIV/0!'], ['AVERAGEA({"x","y"})', 0],
    ['MAXA({-1,"x",TRUE,-4})', -1], ['MINA({1,"2",TRUE,4})', 1], ['MINA(A1:A3)', 0],
    ['VARA({1,"x",TRUE,4})', 4.5], ['VARPA({1,"x",TRUE,4})', 2.25],
    ['STDEVA({TRUE,FALSE})', '#DIV/0!'], ['STDEVPA({1,"x",TRUE,4})', 1.5],
  ]);
});

test('Excel checks negative combinatorial arguments before truncating', () => {
  cases(book(), [
    ['PERMUT(0.9,0)', 1], ['PERMUT(-0.5,0)', '#NUM!'], ['PERMUT(3,-0.5)', '#NUM!'],
    ['COMBIN(-0.5,0)', '#NUM!'], ['COMBIN(3,-0.5)', '#NUM!'], ['COMBIN(0.5,0.9)', 1],
  ]);
});

// Excel 16.114.1: LARGE rounds k up, SMALL truncates it; both reject k below 1 before rounding.
test('Excel order-statistic and quartile fractional boundaries', () => {
  cases(book(), [
    ['LARGE({1,2,3},1.5)', 2], ['SMALL({1,2,3},1.5)', 1],
    ['LARGE({1,2,3},0.5)', '#NUM!'], ['SMALL({1,2,3},0.5)', '#NUM!'],
    ['QUARTILE.INC({1,2,3,4},-0.5)', '#NUM!'], ['QUARTILE.INC({1,2,3,4},4.7)', 4],
    ['QUARTILE.EXC({1,2,3,4},3.7)', 3.75],
  ]);
});

test('statistical extrema and order statistics accept the 250000-cell limit', () => {
  const xs = Array.from({ length: M.CAP.cells }, (_, i) => [(i * 137) % M.CAP.cells]);
  const call = (name, args) => C.fn(name).fn(args, {});
  assert.equal(call('MAXA', [xs]), M.CAP.cells - 1);
  assert.equal(call('MINA', [xs]), 0);
  for (const k of [1, 2, 12345, 125000, M.CAP.cells]) {
    assert.equal(call('LARGE', [xs, k]), M.CAP.cells - k);
    assert.equal(call('SMALL', [xs, k]), k - 1);
  }
  const ctx = { read: (sheet, r, c) => sheet.rows.get(r).get(c).v };
  const sheet = { rows: new Map(xs.map(([v], r) => [r, new Map([[0, { v }]])])) };
  const range = new C.lib.Ref(sheet, 0, 0, xs.length - 1, 0);
  assert.equal(C.fn('MAXIFS').fn([range, range, '>=0'], ctx), M.CAP.cells - 1);
  assert.equal(C.fn('MINIFS').fn([range, range, '>=0'], ctx), 0);
});

// Excel 16.114.1: representable results must survive intermediate products near the double limit.
test('correlation and combinations avoid intermediate overflow', () => {
  const e = book();
  close(e, [
    ['CORREL({1e150,2e150,3e150},{1e150,2e150,3e150})', 1],
    ['PEARSON({1e150,2e150,3e150},{3e150,2e150,1e150})', -1],
    ['RSQ({1e150,2e150,3e150},{1e150,2e150,3e150})', 1],
    ['COMBIN(1029,514)', 1.429820686498904e308],
  ]);
  cases(e, [['COMBIN(1030,515)', '#NUM!']]);
});

test('normal density rejects an overflowing squared standardized value', () => {
  cases(book(), [
    ['NORM.S.DIST(1e200,FALSE)', '#NUM!'], ['NORM.DIST(1,0,1e-200,FALSE)', '#NUM!'],
    ['NORM.DIST(1,0,1e-150,FALSE)', 0], ['NORM.DIST(1,0,1e-300,TRUE)', 1],
  ]);
  close(book(), [['NORM.DIST(0,0,1e-300,FALSE)', 3.989422804014327e299]]);
});

test('TRIMMEAN floors exclusion counts without a 15-digit rounding snap', () => {
  cases(book(), [
    ['TRIMMEAN({1,2,4,8,16,32,64,128,256,1000},0.599999999999999)', 42],
    ['TRIMMEAN({1,2,4,8,16,32,64,128,256,1000},0.3999999999999999)', 63.75],
  ]);
});

test('native Excel confirms omissions, empty pairs, modal ties and unsorted frequency bins', () => {
  const e = book([[1, 4], ['#N/A', 5], [3, 6]], { D1: { f: 'FREQUENCY({1,2,3,4,5},{4,2,4})', a: 'D1:D4' } });
  cases(e, [
    ['MEDIAN(1,,3)', 1], ['MODE({2,1,1,2})', 2], ['TRIMMEAN({1,2,9},1)', '#NUM!'],
    ['STDEV.S(A1:A3)', '#N/A'], ['VAR.S(A1:A3)', '#N/A'], ['CORREL(A1:A3,B1:B3)', '#N/A'],
  ]);
  close(e, [['STDEV(1,,3)', Math.sqrt(7 / 3)]]);
  for (const name of ['CORREL', 'PEARSON', 'SLOPE', 'INTERCEPT', 'RSQ', 'COVARIANCE.P', 'COVARIANCE.S']) {
    assert.equal(calc(e, `${name}(G1:G3,H1:H3)`), '#DIV/0!', name);
  }
  cases(e, [['FORECAST(2,G1:G3,H1:H3)', '#DIV/0!'], ['FORECAST.LINEAR(2,G1:G3,H1:H3)', '#DIV/0!']]);
  assert.deepEqual(['D1', 'D2', 'D3', 'D4'].map((ref) => val(e, ref)), [2, 2, 0, 1]);
});
