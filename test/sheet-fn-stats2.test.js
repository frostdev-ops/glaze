// The further statistical functions (lib/sheet-fn-stats2.js). Cases are the worked examples on Microsoft's pages
// (support.microsoft.com/en-us/excel/functions/<name>-function: kurt, skew, skew-p, percentrank-inc, mode-mult,
// linest), what Excel 16.114.1 gave for everything else (probes of 2026-10-30,
// ~/Projects/glaze-plans/sheets/fn-rest-excel-probes-2026-10-30.txt), held to 1e-12, and the distributions far into
// their tails against values worked to 60 digits (mpmath 1.4.1) from the doubles the formulas pass. Excel agrees with
// those to 2e-15 or better.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-info.js');
require('../lib/sheet-fn-lookup.js');
require('../lib/sheet-fn-stats.js');
require('../lib/sheet-fn-stats2.js');

const book = (cells = {}) => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  for (const [at, v] of Object.entries(cells)) {
    const [r, c] = M.cellPosition(at);
    const cell = typeof v === 'string' ? { t: 's', v } : typeof v === 'boolean' ? { t: 'b', v } : { t: 'n', v };
    M.apply(wb, { op: 'set', sheet: sh.id, r, c, cell });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const column = (col, values, from = 1) => Object.fromEntries(values.map((v, i) => [`${col}${from + i}`, v]));
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, f, at = 'Z100') => out(e.evaluate(f, e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
const close = (e, rows, tol = 1e-12) => {
  for (const [f, want] of rows) {
    const x = calc(e, f);
    assert.ok(typeof x === 'number' && (x === want || Math.abs(x - want) <= tol * Math.abs(want)), `${f} = ${x}; want ${want}`);
  }
};
const prints = (e, rows) => {
  for (const [f, printed] of rows) {
    const x = calc(e, f), d = (printed.split('.')[1] ?? '').length;
    assert.ok(typeof x === 'number' && Math.abs(x - Number(printed)) <= 0.50001 * 10 ** -d, `${f} = ${x}; Microsoft prints ${printed}`);
  }
};
// A formula's array, read back from an array formula over a range of its size.
const spill = (e, f, at = 'AA1') => {
  const rows = calc(e, `ROWS(${f})`), cols = calc(e, `COLUMNS(${f})`);
  if (typeof rows !== 'number') return rows;
  const sh = e.wb.sheets[0], [r, c] = M.cellPosition(at);
  e.apply({ op: 'set', sheet: sh.id, r, c, cell: { t: 'n', v: 0, f, a: M.rangeName(r, c, r + rows - 1, c + cols - 1) } });
  const got = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (__, j) => out(e.value(sh.id, r + i, c + j))));
  e.apply({ op: 'clear', sheet: sh.id, r0: r, c0: c, r1: r + rows - 1, c1: c + cols - 1 });
  return got;
};

const A = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3];
const W = [2.5, 3.7, 1.2, 8.8, 4.4, 6.1, 5.5, 7.3];
const X = [1.1, 2.9, 2.2, 4.8, 3.9, 6.2, 5.1, 7.9];
const DATA = () => book({ ...column('A', A), ...column('B', W), ...column('C', X), F1: 7, F2: 7, F3: 7 });

const NAMES = ('KURT SKEW SKEW.P PERCENTRANK PERCENTRANK.INC PERCENTRANK.EXC MODE.MULT LINEST LOGEST TREND GROWTH STEYX COVAR '
  + 'NORMDIST NORMINV NORMSDIST NORMSINV PHI GAUSS FISHER FISHERINV CONFIDENCE CONFIDENCE.NORM CONFIDENCE.T PROB Z.TEST ZTEST T.TEST TTEST '
  + 'GAMMA GAMMALN GAMMALN.PRECISE GAMMA.DIST GAMMADIST GAMMA.INV GAMMAINV BETA.DIST BETADIST BETA.INV BETAINV '
  + 'BINOM.DIST BINOMDIST BINOM.INV CRITBINOM BINOM.DIST.RANGE NEGBINOM.DIST NEGBINOMDIST HYPGEOM.DIST HYPGEOMDIST POISSON POISSON.DIST '
  + 'EXPON.DIST EXPONDIST WEIBULL WEIBULL.DIST LOGNORM.DIST LOGNORMDIST LOGNORM.INV LOGINV T.DIST T.DIST.2T T.DIST.RT TDIST T.INV T.INV.2T TINV '
  + 'CHISQ.DIST CHISQ.DIST.RT CHIDIST CHISQ.INV CHISQ.INV.RT CHIINV F.DIST F.DIST.RT FDIST F.INV F.INV.RT FINV').split(' ');

test('the functions are registered, legacy names share their new functions, and nothing sets a timer', () => {
  for (const name of NAMES) assert.ok(C.fn(name), name);
  const legacy = { NORMDIST: 'NORM.DIST', NORMINV: 'NORM.INV', NORMSINV: 'NORM.S.INV', COVAR: 'COVARIANCE.P', PERCENTRANK: 'PERCENTRANK.INC',
    CRITBINOM: 'BINOM.INV', POISSON: 'POISSON.DIST', EXPONDIST: 'EXPON.DIST', WEIBULL: 'WEIBULL.DIST', GAMMADIST: 'GAMMA.DIST', GAMMAINV: 'GAMMA.INV',
    BINOMDIST: 'BINOM.DIST', LOGINV: 'LOGNORM.INV', CHIDIST: 'CHISQ.DIST.RT', CHIINV: 'CHISQ.INV.RT', FDIST: 'F.DIST.RT', FINV: 'F.INV.RT',
    TINV: 'T.INV.2T', BETAINV: 'BETA.INV', ZTEST: 'Z.TEST', TTEST: 'T.TEST', 'CONFIDENCE': 'CONFIDENCE.NORM', NEGBINOMDIST: null, HYPGEOMDIST: null };
  for (const [old, name] of Object.entries(legacy)) if (name) assert.equal(C.fn(old).fn, C.fn(name).fn, old);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-stats2.js'), 'utf8')));
});

test('KURT, SKEW, SKEW.P: Microsoft\'s examples and the fewest points each takes', () => {
  const e = book(column('A', ['Data', 3, 4, 5, 2, 3, 4, 5, 6, 4, 7]));
  prints(e, [['KURT(A2:A11)', '-0.151799637'], ['SKEW(A2:A11)', '0.359543'], ['SKEW.P(A2:A11)', '0.303193']]);
  close(DATA(), [['KURT(B1:B8)', -0.6412725370659933], ['SKEW(B1:B8)', 0.04630649340146819], ['SKEW.P(B1:B8)', 0.03712779280525781], ['KURT(1,2,3,5)', 12 / 35]]);
  cases(DATA(), [['KURT(1,2,3)', '#DIV/0!'], ['KURT(F1:F3,7)', '#DIV/0!'], ['SKEW(1,2)', '#DIV/0!'], ['SKEW.P(1,2)', '#DIV/0!'], ['SKEW.P(F1:F3)', '#DIV/0!'],
    ['KURT(A1:A10,"x")', '#VALUE!'], ['SKEW(A1:A10,NA())', '#N/A'], ['SKEW(1,2,"3")', 0]]);
});

test('PERCENTRANK: Microsoft\'s examples, interpolation, truncation to significance', () => {
  const e = book(column('A', ['Data', 13, 12, 11, 8, 4, 3, 2, 1, 1, 1]));
  cases(e, [['PERCENTRANK.INC(A2:A11,2)', 0.333], ['PERCENTRANK.INC(A2:A11,4)', 0.555], ['PERCENTRANK.INC(A2:A11,8)', 0.666], ['PERCENTRANK.INC(A2:A11,5)', 0.583]]);
  const d = DATA();
  cases(d, [
    ['PERCENTRANK(A1:A10,4)', 0.555], ['PERCENTRANK(A1:A10,4.5)', 0.611], ['PERCENTRANK.INC(A1:A10,4,5)', 0.55555], ['PERCENTRANK.EXC(A1:A10,4)', 0.545],
    ['PERCENTRANK.EXC(A1:A10,1)', 0.09], ['PERCENTRANK.EXC(A1:A10,9)', 0.909], ['PERCENTRANK.INC(A1:A10,1)', 0], ['PERCENTRANK.INC(A1:A10,9)', 1],
    ['PERCENTRANK(A1:A10,4,1.9)', 0.5], ['PERCENTRANK.INC(A1:A10,3.3,4)', 0.4777], ['PERCENTRANK.INC(A1:A10,4,16)', 0.555555555555556],
    ['PERCENTRANK(A1:A10,10)', '#N/A'], ['PERCENTRANK(A1:A10,0.5)', '#N/A'], ['PERCENTRANK.INC(A1:A10,2/3,15)', '#N/A'],
    ['PERCENTRANK(A1:A10,4,0)', '#NUM!'], ['PERCENTRANK(Z1:Z3,4)', '#NUM!'],
  ]);
});

test('MODE.MULT: every most frequent value, in the order first seen, as a column', () => {
  const e = book(column('A', ['Data', 1, 2, 3, 4, 3, 2, 1, 2, 3, 5, 6, 1]));
  assert.deepEqual(spill(e, 'MODE.MULT(A2:A13)'), [[1], [2], [3]]);
  assert.equal(calc(e, 'MODE.MULT(A2:A13)'), 1);
  const d = DATA();
  assert.deepEqual(spill(d, 'MODE.MULT(A1:A10)'), [[3], [1], [5]]);
  cases(d, [['MODE.MULT(F1:F3)', 7], ['INDEX(MODE.MULT({1,2,2,1}),2)', 2], ['MODE.MULT(1,2,3)', '#N/A'], ['MODE.MULT(A1:A10,NA())', '#N/A']]);
});

test('LINEST: Microsoft\'s examples', () => {
  const one = book({ ...column('A', ['Known y', 1, 9, 5, 7]), ...column('B', ['Known x', 0, 4, 2, 3]) });
  const [[m, b]] = spill(one, 'LINEST(A2:A5,B2:B5,,FALSE)');
  assert.ok(Math.abs(m - 2) <= 1e-12 && Math.abs(b - 1) <= 1e-12, `LINEST = ${m}, ${b}; Microsoft prints 2, 1`);
  const sales = book({ ...column('A', [1, 2, 3, 4, 5, 6]), ...column('B', [3100, 4500, 4400, 5400, 7500, 8100]) });
  close(sales, [['SUM(LINEST(B1:B6, A1:A6)*{9,1})', 11000]]);
  const rows = [[2310, 2, 2, 20, 142000], [2333, 2, 2, 12, 144000], [2356, 3, 1.5, 33, 151000], [2379, 3, 2, 43, 150000], [2402, 2, 3, 53, 139000],
    [2425, 4, 2, 23, 169000], [2448, 2, 1.5, 99, 126000], [2471, 2, 2, 34, 142900], [2494, 3, 3, 23, 163000], [2517, 4, 4, 55, 169000], [2540, 2, 3, 22, 149000]];
  const cells = {};
  rows.forEach((r, i) => r.forEach((v, j) => { cells[`${'ABCDE'[j]}${i + 2}`] = v; }));
  const office = book(cells);
  const s = spill(office, 'LINEST(E2:E12,A2:D12,TRUE,TRUE)');
  assert.deepEqual([s.length, s[0].length], [5, 5]);
  const near = (x, printed) => Math.abs(x - Number(printed)) <= 0.50001 * 10 ** -((printed.split('.')[1] ?? '').length);
  for (const [[i, j], printed] of [[[0, 0], '-234.2371645'], [[1, 0], '13.26801148'], [[2, 0], '0.996747993'], [[2, 1], '970.5784629'], [[3, 0], '459.7536742'],
    [[3, 1], '6'], [[4, 0], '1732393319'], [[0, 4], '52317.83051'], [[0, 1], '2553.21066'], [[0, 2], '12529.76817'], [[0, 3], '27.64138737']]) {
    assert.ok(near(s[i][j], printed), `LINEST row ${i + 1} column ${j + 1}: ${s[i][j]}; Microsoft prints ${printed}`);
  }
  assert.deepEqual(s.slice(2).map((r) => r.slice(2)), [['#N/A', '#N/A', '#N/A'], ['#N/A', '#N/A', '#N/A'], ['#N/A', '#N/A', '#N/A']]);
  close(office, [['INDEX(LINEST(E2:E12,A2:D12,TRUE,TRUE),1,1)', -234.23716447120248], ['INDEX(LINEST(E2:E12,A2:D12,TRUE,TRUE),1,5)', 52317.830507291350],
    ['INDEX(LINEST(E2:E12,A2:D12,TRUE,TRUE),2,3)', 400.06683819395295], ['INDEX(LINEST(E2:E12,A2:D12,TRUE,TRUE),3,2)', 970.57846292850593],
    ['INDEX(LINEST(E2:E12,A2:D12,TRUE,TRUE),5,1)', 1732393319.2292504], ['INDEX(LINEST(E2:E12,A2:D12,TRUE,TRUE),5,2)', 5652135.3162039667],
    ['INDEX(TREND(E2:E12,A2:D12,{2400,3,2,30}),1)', 154325.77107364728]]);
});

test('LINEST, LOGEST, TREND, GROWTH, STEYX: Excel\'s statistics, with and without an intercept', () => {
  const d = DATA();
  close(d, [
    ['INDEX(LINEST(C1:C8,B1:B8),1)', 0.6991372191691106], ['INDEX(LINEST(C1:C8,B1:B8),2)', 0.8105099803525162],
    ['INDEX(LINEST(C1:C8,B1:B8,TRUE,TRUE),3,1)', 0.6270654298542162], ['INDEX(LINEST(C1:C8,B1:B8,TRUE,TRUE),5,1)', 21.457395177823962],
    ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),1,1)', 0.83313104256476789], ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),3,1)', 0.92355663714953895],
    ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),3,2)', 1.4003537648474660], ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),4,1)', 84.571063058717513],
    ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),5,1)', 165.84306533294270], ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),5,2)', 13.726934667057305],
    ['INDEX(LINEST(C1:C8),1,1)', 0.82976190476190503], ['INDEX(LINEST(C1:C8),1,2)', 0.52857142857142758],
    ['INDEX(LOGEST(C1:C8,B1:B8),1)', 1.2206016084717295], ['INDEX(LOGEST(C1:C8,B1:B8,TRUE,TRUE),1,2)', 1.3710544483449321],
    ['INDEX(LOGEST(C1:C8,B1:B8,TRUE,TRUE),3,1)', 0.61951738079803254], ['INDEX(LOGEST(C1:C8,B1:B8,FALSE,TRUE),1,1)', 1.2859730709174939],
    ['TREND(C1:C8,B1:B8,10)', 7.801882172043623], ['TREND(C1:C8,B1:B8,10,FALSE)', 8.3313104256476791], ['INDEX(TREND(C1:C8),3)', 3.0178571428571428],
    ['GROWTH(C1:C8,B1:B8,10)', 10.064543502376493], ['GROWTH(C1:C8,B1:B8,10,FALSE)', 12.368548684243137], ['INDEX(GROWTH(C1:C8,B1:B8),2)', 2.8666737687117960],
    ['STEYX(C1:C8,B1:B8)', 1.4583869412342778],
  ]);
  cases(d, [
    ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),1,2)', 0], ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),2,2)', '#N/A'], ['INDEX(LINEST(C1:C8,B1:B8,FALSE,TRUE),4,2)', 7],
    ['INDEX(LINEST(C1:C8,B1:B8,TRUE,TRUE),4,2)', 6], ['INDEX(LOGEST(C1:C8,B1:B8,FALSE,TRUE),1,2)', 1], ['STEYX({1,2},{1,2})', '#DIV/0!'],
    ['LINEST(C1:C8,B1:B7)', '#REF!'], ['GROWTH({1,-2,3},{1,2,3},4)', '#NUM!'], ['LINEST({1,"x",3})', '#VALUE!'],
  ]);
  // A column that is a multiple of another is dropped (its coefficient and error 0), the degrees of freedom one more.
  const rows = { ...column('A', [142000, 144000, 151000, 150000, 139000, 169000, 126000, 142900, 163000, 169000, 149000]) };
  const twice = 'LINEST(A1:A11,{1;2;3;4;5;6;7;8;9;10;11}*{1,2},TRUE,TRUE)';
  close(book(rows), [[`INDEX(${twice},1,1)`, 653.63636363636363], [`INDEX(${twice},2,1)`, 625.64303009138405]]);
  cases(book(rows), [[`INDEX(${twice},1,2)`, 0], [`INDEX(${twice},2,2)`, 0], [`INDEX(${twice},4,2)`, 9]]);
});

test('COVAR, the normal distribution\'s legacy names, PHI, GAUSS, FISHER, CONFIDENCE', () => {
  const d = DATA();
  close(d, [
    ['COVAR(B1:B8,C1:C8)', 3.8364062499999996], ['NORMDIST(1,0,1,TRUE)', 0.841344746068543], ['NORMINV(0.95,0,1)', 1.6448536269514715],
    ['NORMSDIST(1.96)', 0.9750021048517795], ['NORMSINV(0.975)', 1.9599639845400536], ['PHI(0.5)', 0.3520653267642995], ['GAUSS(1)', 0.34134474606854304],
    ['GAUSS(1E-10)', 3.989422804014327e-11], ['FISHER(0.5)', 0.5493061443340549], ['FISHERINV(0.5)', 0.46211715726000974],
    ['CONFIDENCE(0.05,2,50)', 0.554361529739871], ['CONFIDENCE.NORM(0.05,2,50)', 0.554361529739871], ['CONFIDENCE.T(0.05,2,50)', 0.5683937109914596],
  ]);
  cases(d, [['GAUSS(-40)', -0.5], ['PHI(40)', 0], ['FISHER(1)', '#NUM!'], ['FISHERINV(30)', 1], ['CONFIDENCE.T(0.05,2,1)', '#DIV/0!'],
    ['CONFIDENCE.T(0.05,2,1.5)', '#DIV/0!'], ['CONFIDENCE.NORM(0.05,2,0.5)', '#NUM!'], ['CONFIDENCE(0,2,50)', '#NUM!'], ['CONFIDENCE(0.05,0,50)', '#NUM!']]);
});

test('PROB, Z.TEST, T.TEST', () => {
  const d = DATA();
  close(d, [
    ['PROB({1,2,3,4},{0.1,0.2,0.3,0.4},2,3)', 0.5], ['PROB({1,2,3,4},{0.1,0.2,0.3,0.4},2)', 0.2], ['PROB({1,2,3,4},{0.1,0.2,0.3,0.4},0,10)', 1],
    ['PROB({1,2,3,4},{0.1,-0.2,0.7,0.4},2)', -0.2],
    ['Z.TEST(A1:A10,4)', 0.5509401063731295], ['Z.TEST(A1:A10,4,2)', 0.56281646941855412], ['Z.TEST(A1:A10,6)', 0.99641425746209911],
    ['T.TEST(B1:B8,C1:C8,2,1)', 0.25675383618160735], ['TTEST(B1:B8,C1:C8,2,2)', 0.5767150824191365], ['T.TEST(B1:B8,C1:C8,1,1)', 0.12837691809080368],
    ['T.TEST(B1:B8,C1:C8,2,3)', 0.57685235657689504], ['T.TEST(B1:B8,C1:C8,1,3)', 0.28842617828844752], ['T.TEST(B1:B8,C1:C7,2,2)', 0.31347509003232293],
  ]);
  cases(d, [
    ['PROB({1,2,3,4},{0.1,0.2,0.3,0.4},3,2)', 0], ['PROB({1,2,3,4},{0.1,0.2,0.3,0.4},2.5)', 0], ['PROB({1,2,3,4},{0.1,0.2,0.3,0.3},2)', '#NUM!'],
    ['PROB({1,2,3},{0.5,0.5},2)', '#N/A'], ['ZTEST(F1:F3,4)', '#DIV/0!'], ['T.TEST(B1:B8,C1:C8,2,4)', '#NUM!'], ['T.TEST(B1:B8,C1:C8,3,1)', '#NUM!'],
    ['T.TEST(B1:B8,C1:C7,2,1)', '#N/A'],
  ]);
});

test('the discrete distributions', () => {
  const d = DATA();
  close(d, [
    ['BINOMDIST(3,10,0.5,FALSE)', 0.1171875], ['BINOM.DIST(3,10,0.5,TRUE)', 0.171875], ['BINOM.DIST(3.7,10.2,0.5,FALSE)', 0.1171875],
    ['BINOM.DIST(500,1000,0.5,FALSE)', 0.0252250181783608019], ['BINOM.DIST(4000,10000,0.4,TRUE)', 0.504342996311506153],
    ['BINOM.DIST.RANGE(60,0.75,48)', 0.083974967429047503], ['BINOM.DIST.RANGE(60,0.75,45,50)', 0.52362979347188721],
    ['NEGBINOM.DIST(3,5,0.5,FALSE)', 0.13671875], ['NEGBINOMDIST(3,5,0.5)', 0.13671875], ['NEGBINOM.DIST(3,5,0.5,TRUE)', 0.36328125],
    ['HYPGEOM.DIST(1,4,8,20,FALSE)', 0.3632610939112486], ['HYPGEOMDIST(1,4,8,20)', 0.3632610939112486], ['HYPGEOM.DIST(1,4,8,20,TRUE)', 0.46542827657378727],
    ['POISSON(2,3,FALSE)', 0.22404180765538775], ['POISSON.DIST(2,3,TRUE)', 0.4231900811268434], ['POISSON.DIST(2.7,3,FALSE)', 0.22404180765538775],
    ['POISSON.DIST(1000,1000,TRUE)', 0.508409367168505991],
  ]);
  cases(d, [
    ['BINOM.INV(10,0.5,0.75)', 6], ['CRITBINOM(10,0.5,0.75)', 6], ['CRITBINOM(10.7,0.5,0.75)', 6], ['BINOM.DIST(11,10,0.5,TRUE)', '#NUM!'],
    ['BINOM.INV(10,0.5,0)', '#NUM!'], ['BINOM.INV(10,0.5,1)', '#NUM!'], ['BINOM.INV(10,0,0.5)', '#NUM!'], ['BINOM.INV(10,1,0.5)', '#NUM!'],
    ['POISSON.DIST(-1,3,TRUE)', '#NUM!'], ['POISSON.DIST(1,-3,TRUE)', '#NUM!'], ['BINOM.DIST.RANGE(60,0.75,50,45)', '#NUM!'],
  ]);
});

test('the continuous distributions: Excel\'s values', () => {
  const d = DATA();
  close(d, [
    ['EXPONDIST(1,2,TRUE)', 0.8646647167633873], ['EXPON.DIST(1,2,FALSE)', 0.2706705664732254], ['EXPON.DIST(0,2,FALSE)', 2],
    ['WEIBULL.DIST(2,1.5,3,TRUE)', 0.41977020402532705], ['WEIBULL(2,1.5,3,FALSE)', 0.23687782228285617],
    ['LOGNORM.DIST(4,1,0.5,TRUE)', 0.7801170895122241], ['LOGNORMDIST(4,1,0.5)', 0.7801170895122241], ['LOGNORM.DIST(4,1,0.5,FALSE)', 0.14800157244728185],
    ['LOGNORM.INV(0.5,1,0.5)', 2.718281828459045], ['LOGINV(0.5,1,0.5)', 2.718281828459045],
    ['TDIST(2,10,2)', 0.0733880347707404], ['T.DIST(1.5,10,TRUE)', 0.9177463367772799], ['T.DIST(1.5,10.5,TRUE)', 0.9177463367772799],
    ['T.DIST.2T(2,10)', 0.0733880347707404], ['T.DIST.RT(2,10)', 0.0366940173853702], ['TDIST(2,10.7,2.9)', 0.073388034770740407],
    ['TINV(0.05,10)', 2.2281388519862744], ['T.INV(0.975,10)', 2.2281388519862744], ['T.INV.2T(0.05,10)', 2.2281388519862744], ['T.INV(0.975,10.9)', 2.2281388519862744],
    ['CHIDIST(3.84,1)', 0.05004352124870511], ['CHISQ.DIST.RT(3.84,1)', 0.05004352124870511], ['CHISQ.DIST(3.84,1,TRUE)', 0.9499564787512949],
    ['CHISQ.DIST(3.84,1.5,TRUE)', 0.94995647875129485], ['CHIINV(0.05,1)', 3.8414588206941236], ['CHISQ.INV.RT(0.05,1)', 3.8414588206941236],
    ['CHISQ.INV(0.95,1)', 3.8414588206941236], ['FDIST(3,5,10)', 0.06555756209384413], ['F.DIST.RT(3,5,10)', 0.06555756209384413],
    ['F.DIST(3,5,10,TRUE)', 0.9344424379061559], ['F.DIST(3,5.5,10.5,TRUE)', 0.93444243790615589], ['FINV(0.05,5,10)', 3.325834530413013],
    ['F.INV.RT(0.05,5,10)', 3.325834530413013], ['F.INV(0.05,5,10)', 0.21119042878234487],
    ['GAMMA(5)', 24], ['GAMMA(0.5)', 1.772453850905516], ['GAMMA(-1.5)', 2.3632718012073544], ['GAMMA(0.0000001)', 9999999.4227844328],
    ['GAMMA(170.5)', 5.5620924145600007e+305], ['GAMMA(-1E-300)', -1e300], ['GAMMALN(10)', 12.80182748008147], ['GAMMALN.PRECISE(0.5)', 0.5723649429247001],
    ['GAMMALN(1E10)', 220258509288.81058], ['GAMMALN.PRECISE(171.7)', 710.17161294037498],
    ['GAMMA.DIST(2,3,2,TRUE)', 0.08030139707139419], ['GAMMADIST(2,3,2,FALSE)', 0.09196986029286058], ['GAMMA.INV(0.5,3,2)', 5.348120627447122],
    ['BETA.DIST(0.4,2,3,TRUE)', 0.5248], ['BETADIST(0.4,2,3)', 0.5248], ['BETA.INV(0.5,2,3)', 0.3857275681323895],
    ['BETA.DIST(3,2,3,TRUE,1,5)', 0.6875], ['BETA.DIST(3,2,3,FALSE,1,5)', 0.375], ['BETA.INV(0.5,2,3,1,5)', 2.5429102725295580],
  ]);
  cases(d, [
    ['GAMMA(0)', '#NUM!'], ['GAMMA(-1)', '#NUM!'], ['GAMMA(171.7)', '#NUM!'], ['GAMMA(1E-308)', '#NUM!'], ['GAMMALN(0)', '#NUM!'], ['GAMMALN(-1.5)', '#NUM!'],
    ['GAMMA.INV(0,3,2)', 0], ['GAMMA.DIST(0,3,2,FALSE)', 0], ['GAMMA.DIST(0,1,2,FALSE)', '#NUM!'], ['GAMMA.DIST(0,0.5,2,FALSE)', '#NUM!'],
    ['BETA.DIST(0,2,3,FALSE)', 0], ['BETA.DIST(1,2,3,TRUE)', 1], ['BETADIST(0.4,2,3,0.4,1)', 0], ['BETA.INV(0,2,3)', '#NUM!'], ['BETA.INV(1,2,3)', '#NUM!'],
    ['WEIBULL.DIST(0,1.5,3,FALSE)', 0], ['WEIBULL.DIST(0,1,3,FALSE)', 0], ['EXPON.DIST(-1,2,TRUE)', '#NUM!'], ['LOGNORM.DIST(0,1,0.5,TRUE)', '#NUM!'],
    ['F.INV(0,5,10)', 0], ['CHISQ.INV(0,1)', 0], ['T.INV(0.5,10)', 0], ['T.INV.2T(1,10)', 0], ['CHISQ.INV.RT(1,1)', 0], ['F.INV.RT(1,5,10)', 0], ['TINV(1,10)', 0],
    ['T.DIST(1,0.5,TRUE)', '#NUM!'], ['T.DIST.2T(-1,10)', '#NUM!'], ['TDIST(1,10,3)', '#NUM!'], ['CHISQ.DIST(-1,2,TRUE)', '#NUM!'], ['F.DIST(1,0,10,TRUE)', '#NUM!'],
  ]);
});

test('the continuous distributions far into their tails, against 60-digit values', () => {
  const d = DATA();
  close(d, [
    ['CHISQ.DIST.RT(100,3)', 1.55415943138960492e-21], ['T.DIST.RT(10,3)', 0.00106419952920707508], ['GAMMA.DIST(50,30,1,TRUE)', 0.99908317113854392],
    ['BETA.DIST(0.999,0.5,0.5,TRUE)', 0.979864958366622509], ['T.INV(1E-10,5)', -156.825592708894317], ['CHISQ.INV(1E-10,3)', 5.2093976214344802e-7],
    ['BETA.INV(1E-10,2,3)', 4.08249401580833285e-6], ['F.INV.RT(1E-10,3,4)', 182572.630278789801], ['GAMMA.INV(0.999999,0.1,1)', 9.457027060457439506],
    ['T.DIST(-40,2,TRUE)', 0.000312207336092370322], ['CHISQ.DIST(1E-5,2,TRUE)', 4.99998750002083331e-6], ['F.DIST(1E-3,2,7,TRUE)', 0.000999357479435562603],
    ['GAMMA.DIST(1E-3,1E-3,1,TRUE)', 0.99368764670886029], ['BETA.DIST(0.5,200,300,TRUE)', 0.999996456519735607], ['BETA.INV(0.3,200,300)', 0.388410831537716975],
    ['T.DIST(0.1,1E6,TRUE)', 0.539827827253978419], ['CHISQ.INV(0.5,1000)', 999.333412403380969], ['GAMMA.INV(0.5,1000,1)', 999.666686426965182],
    ['T.INV(0.9,1)', 3.0776835371752534], ['T.INV(0.999,2)', 22.3271247701198754],
  ]);
});
