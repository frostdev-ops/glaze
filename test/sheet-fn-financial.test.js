// The financial functions (lib/sheet-fn-financial.js). Each case is the worked example on Microsoft's page for the
// function (https://support.microsoft.com/en-us/office/<name>-function-…), with its data pasted at A1 as the page
// says. A result is checked twice: against the page's rounded figure, and to 1e-9 relative against the exact value,
// computed in 50-digit decimal arithmetic (closed forms, a loan walked period by period, roots by bisection).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-financial.js');

const book = (cells = {}) => {
  const wb = M.workbook();
  for (const [ref, input] of Object.entries(cells)) {
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    M.apply(wb, { op: 'set', sheet: wb.sheets[0].id, r, c, cell: x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v } });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text) => out(e.evaluate(text, e.wb.sheets[0].id, 99, 25));
const rel = (got, want, f) => {
  assert.equal(typeof got, 'number', `${f} → ${got}`);
  assert.ok(Math.abs(got - want) <= 1e-9 * Math.abs(want), `${f} → ${got}, want ${want}`);
};
// The page's figure: "($1,037.03)", "-2.1%", "59.6738657", read with its own number of decimals.
const shown = (got, page, f) => {
  const pct = page.endsWith('%');
  const body = page.replace(/[$,%\s]/g, '');
  const neg = /^\(.*\)$/.test(body) || body.startsWith('-');
  const digits = body.replace(/[()-]/g, '');
  const dp = (digits.split('.')[1] ?? '').length + (pct ? 2 : 0);
  const want = (neg ? -1 : 1) * Number(digits) / (pct ? 100 : 1);
  assert.ok(Math.abs(got - want) <= 0.5 * 10 ** -dp + 1e-12, `${f} → ${got}, the page shows ${page}`);
};
// [formula, the page's result, the exact value]
const examples = (e, rows) => { for (const [f, page, exact] of rows) { const v = calc(e, f); shown(v, page, f); rel(v, exact, f); } };
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };

const NAMES = 'PMT IPMT PPMT NPER RATE PV FV NPV IRR XNPV XIRR MIRR SLN SYD DB DDB EFFECT NOMINAL CUMIPMT CUMPRINC RRI PDURATION FVSCHEDULE'.split(' ');

test('the financial functions are registered', () => {
  assert.equal(NAMES.length, 23);
  for (const name of NAMES) assert.ok(C.fn(name), name);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-financial.js'), 'utf8')), 'no timers');
});

test('PMT, PV, FV with Microsoft\'s data; rate 0; type 1', () => {
  // pmt-function-0214da64-9a63-4996-bc20-214433fa6441: A2:A4 and A9:A11.
  const e = book({ A2: '8%', A3: 10, A4: '$10,000', A9: '6%', A10: 18, A11: '$50,000' });
  examples(e, [
    ['PMT(A2/12,A3,A4)', '($1,037.03)', -1037.0320893591522],
    ['PMT(A2/12,A3,A4,,1)', '($1,030.16)', -1030.1643271779657],
    ['PMT(A9/12,A10*12, 0,A11)', '($129.08)', -129.08116086799092],
  ]);
  // pv-function: A2 $500.00, A3 8%, A4 20.
  examples(book({ A2: '$500.00', A3: '8%', A4: 20 }), [['PV(A3/12, 12*A4, A2, , 0)', '($59,777.15)', -59777.145851188022]]);
  // fv-function: its four examples.
  examples(book({ A2: 0.06, A3: 10, A4: -200, A5: -500, A6: 1 }), [['FV(A2/12, A3, A4, A5, A6)', '$2,581.40', 2581.4033740601792]]);
  examples(book({ A2: 0.12, A3: 12, A4: -1000 }), [['FV(A2/12, A3, A4)', '$12,682.50', 12682.503013196972]]);
  examples(book({ A2: 0.11, A3: 35, A4: -2000, A5: 1 }), [['FV(A2/12, A3, A4,, A5)', '$82,846.25', 82846.246371899520]]);
  examples(book({ A2: 0.06, A3: 12, A4: -100, A5: -1000, A6: 1 }), [['FV(A2/12, A3, A4, A5, A6)', '$2,301.40', 2301.4018303409409]]);
  // PV's page: if rate is 0, (pmt * nper) + pv + fv = 0.
  cases(e, [
    ['PMT(0,10,1000)', -100], ['PMT(0,10,1000,200)', -120], ['PMT(0,10,1000,200,1)', -120], ['PV(0,10,-100)', 1000], ['PV(0,10,-100,-50)', 1050],
    ['FV(0,10,-100)', 1000], ['FV(0,10,-100,-1000,1)', 2000], ['PMT(0.1,0,1000)', '#NUM!'], ['PMT("x",10,1000)', '#VALUE!'], ['FV(0.1,10,1/0)', '#DIV/0!'],
  ]);
  // The three agree with one another: a loan's payments bring its balance to the future value.
  for (const t of [0, 1]) {
    rel(calc(e, `FV(0.07/12,60,PMT(0.07/12,60,25000,-5000,${t}),25000,${t})`), -5000, `FV of PMT, type ${t}`);
    rel(calc(e, `PV(0.07/12,60,PMT(0.07/12,60,25000,-5000,${t}),-5000,${t})`), 25000, `PV of PMT, type ${t}`);
  }
});

test('IPMT and PPMT with Microsoft\'s data; periods outside 1 to nper', () => {
  // ipmt-function: A2 10.00%, A3 1, A4 3, A5 $8,000.
  const e = book({ A2: '10.00%', A3: 1, A4: 3, A5: '$8,000' });
  examples(e, [
    ['IPMT(A2/12, A3, A4*12, A5)', '($66.67)', -66.666666666666667],
    ['IPMT(A2, 3, A4, A5)', '($292.45)', -292.44712990936556],
  ]);
  // ppmt-function: A2 10%, A3 2, A4 $2,000.00; A8 8%, A9 10, A10 $200,000.00.
  examples(book({ A2: '10%', A3: 2, A4: '$2,000.00', A8: '8%', A9: 10, A10: '$200,000.00' }), [
    ['PPMT(A2/12, 1, A3*12, A4)', '($75.62)', -75.623186008366340],
    ['PPMT(A8, A9, 10, A10)', '($27,598.05)', -27598.053462421375],
  ]);
  cases(e, [['IPMT(0.1,0,3,8000)', '#NUM!'], ['IPMT(0.1,4,3,8000)', '#NUM!'], ['PPMT(0.1,4,3,8000)', '#NUM!'], ['IPMT(0.1,1,3,8000,0,1)', 0], ['IPMT(0,2,3,900)', 0], ['PPMT(0,2,3,900)', -300]]);
  // Each payment is its interest and its principal, at the end or the start of the period.
  for (const t of [0, 1]) for (const per of [1, 2, 7, 12]) {
    const f = `IPMT(0.05/12,${per},12,5000,0,${t})+PPMT(0.05/12,${per},12,5000,0,${t})`;
    rel(calc(e, f), calc(e, `PMT(0.05/12,12,5000,0,${t})`), f);
  }
});

test('NPER and RATE with Microsoft\'s data; RATE iterates from its guess and gives up with #NUM!', () => {
  // nper-function: A2 0.12, A3 -100, A4 -1000, A5 10000, A6 1.
  const e = book({ A2: 0.12, A3: -100, A4: -1000, A5: 10000, A6: 1 });
  examples(e, [
    ['NPER(A2/12, A3, A4, A5, 1)', '59.6738657', 59.673865674294626],
    ['NPER(A2/12, A3, A4, A5)', '60.0821229', 60.082122853761723],
    ['NPER(A2/12, A3, A4)', '-9.57859404', -9.5785940398131667],
  ]);
  cases(e, [['NPER(0,-100,1000)', 10], ['NPER(0,-100,1000,-500)', 15], ['NPER(0.1,-50,1000)', '#NUM!'], ['NPER(0,0,1000)', '#NUM!']]);
  // rate-function: A2 4, A3 -200, A4 8000; the page shows 1% and 9.24%.
  const r = book({ A2: 4, A3: -200, A4: 8000 });
  examples(r, [
    ['RATE(A2*12, A3, A4)', '1%', 0.0077014724882020438],
    ['RATE(A2*12, A3, A4)*12', '9.24%', 0.0077014724882020438 * 12],
    ['RATE(A2*12, A3, A4,,,0.5)', '1%', 0.0077014724882020438],
  ]);
  rel(calc(r, 'RATE(60,PMT(0.004,60,20000,-1000,1),20000,-1000,1)'), 0.004, 'RATE undoes PMT, type 1');
  cases(r, [['RATE(10,100,1000)', '#NUM!'], ['RATE(0,-100,1000)', '#NUM!'], ['RATE(48,-200,8000,0,0,30)', '#NUM!']]);
  assert.ok(Math.abs(calc(r, 'RATE(10,-100,1000)')) < 1e-12, 'no interest');
});

test('NPV, IRR and MIRR with Microsoft\'s data', () => {
  // npv-function: example 1, A2:A6; example 2, A2:A8.
  examples(book({ A2: 0.1, A3: -10000, A4: 3000, A5: 4200, A6: 6800 }), [['NPV(A2, A3, A4, A5, A6)', '$1,188.44', 1188.4434123352230]]);
  const n = book({ A2: 0.08, A3: -40000, A4: 8000, A5: 9200, A6: 10000, A7: 12000, A8: 14500, B4: 'text', B5: true });
  examples(n, [
    ['NPV(A2, A4:A8)+A3', '$1,922.06', 1922.0615549323722],
    ['NPV(A2, A4:A8, -9000)+A3', '($3,749.47)', -3749.4650870155708],
  ]);
  // Only numbers count in a range; a typed TRUE or number text counts as a value; an error is the result.
  cases(n, [['NPV(0,B4:B5,A4)', 8000], ['NPV(0,TRUE,"2")', 3], ['NPV(-1,1)', '#DIV/0!'], ['NPV(0.1,1/0)', '#DIV/0!'], ['NPV(0.1,"x")', '#VALUE!']]);
  rel(calc(n, 'NPV(0.1,{100,200;300,400})'), 100 / 1.1 + 200 / 1.1 ** 2 + 300 / 1.1 ** 3 + 400 / 1.1 ** 4, 'an array row by row');

  // irr-function: A2:A7.
  const i = book({ A2: '-$70,000', A3: '$12,000', A4: '$15,000', A5: '$18,000', A6: '$21,000', A7: '$26,000', B2: -100, B3: 'x', B5: 110 });
  examples(i, [
    ['IRR(A2:A6)', '-2.1%', -0.021244848273410991],
    ['IRR(A2:A7)', '8.7%', 0.086630948036531614],
    ['IRR(A2:A4,-10%)', '-44.4%', -0.44350694133474054],
  ]);
  assert.ok(Math.abs(calc(i, 'NPV(IRR(A2:A7),A3:A7)+A2')) < 1e-6, 'the rate at which the NPV is 0');
  cases(i, [['IRR(A3:A7)', '#NUM!'], ['IRR({-1,-2})', '#NUM!'], ['IRR({1,-3,3})', '#NUM!']]);
  rel(calc(i, 'IRR(B2:B5)'), 0.1, 'text and blanks in the range are passed over');

  // mirr-function: A2:A9.
  const m = book({ A2: -120000, A3: 39000, A4: 30000, A5: 21000, A6: 37000, A7: 46000, A8: 0.1, A9: 0.12 });
  examples(m, [
    ['MIRR(A2:A7, A8, A9)', '13%', 0.12609413036590515],
    ['MIRR(A2:A5, A8, A9)', '-5%', -0.048044655249980820],
    ['MIRR(A2:A7, A8, 14%)', '13%', 0.13475911082831485],
  ]);
  cases(m, [['MIRR(A3:A7,A8,A9)', '#DIV/0!'], ['MIRR({-1,-2},A8,A9)', '#DIV/0!']]);
});

test('XNPV and XIRR with Microsoft\'s data; dates truncated, out of order, mismatched', () => {
  // xnpv-function: A2:B6. xirr-function: the same flows and dates (its table starts a row lower).
  const e = book({
    A2: '-$10,000', A3: '$2,750', A4: '$4,250', A5: '$3,250', A6: '$2,750', B2: '1/1/2008', B3: '3/1/2008', B4: '10/30/2008', B5: '2/15/2009', B6: '4/1/2009',
    D3: '-10,000', D4: '2,750', D5: '4,250', D6: '3,250', D7: '2,750', E3: '1-Jan-08', E4: '1-Mar-08', E5: '30-Oct-08', E6: '15-Feb-09', E7: '1-Apr-09',
    F2: 39448.75, F3: 39508.5, F4: 39751.1, F5: 39859.9, F6: 39904.2, G2: 39448, G3: 39904, G4: 39751, G5: 39859, G6: 39508,
    H2: 39448, H3: 39447, H4: 39751, H5: 39859, H6: 39904,
  });
  examples(e, [
    ['XNPV(.09, A2:A6, B2:B6)', '$2,086.65', 2086.6476020315366],
    ['XIRR(D3:D7, E3:E7, 0.1)', '37.34%', 0.37336253351883151],
    ['XIRR(A2:A6, B2:B6)', '37.34%', 0.37336253351883151],
    ['XNPV(.09, A2:A6, F2:F6)', '$2,086.65', 2086.6476020315366],
  ]);
  rel(calc(e, 'XNPV(.09,{-10000,2750,4250,3250,2750},G2:G6)'), 2086.6476020315366, 'dates after the first in any order');
  assert.ok(Math.abs(calc(e, 'XNPV(XIRR(A2:A6,B2:B6),A2:A6,B2:B6)')) < 1e-6);
  cases(e, [
    ['XNPV(.09,A2:A6,H2:H6)', '#NUM!'], ['XIRR(A2:A6,H2:H6)', '#NUM!'], ['XNPV(.09,A2:A6,B2:B5)', '#NUM!'], ['XIRR(A2:A5,B2:B6)', '#NUM!'],
    ['XIRR(A3:A6,B3:B6)', '#NUM!'], ['XNPV(.09,A2:A6,{39448,39508,39751,39859,-1})', '#VALUE!'], ['XNPV("x",A2:A6,B2:B6)', '#VALUE!'],
  ]);
});

test('SLN, SYD, DB, DDB with Microsoft\'s data', () => {
  examples(book({ A2: '$30,000', A3: '$7,500', A4: 10 }), [['SLN(A2, A3, A4)', '$2,250', 2250]]);
  const s = book({ A2: '$ 30,000.00', A3: '$ 7,500.00', A4: 10 });
  examples(s, [['SYD(A2,A3,A4,1)', '$4,090.91', 4090.9090909090909], ['SYD(A2,A3,A4,10)', '$409.09', 409.09090909090909]]);
  cases(s, [['SLN(1000,100,0)', '#DIV/0!'], ['SYD(A2,A3,A4,11)', '#NUM!'], ['SYD(A2,A3,A4,0)', '#NUM!']]);
  // db-function: A2 $1,000,000, A3 $100,000, A4 6; the rate is rounded to three decimals.
  const d = book({ A2: '$1,000,000', A3: '$100,000', A4: 6 });
  const DB = [['$186,083.33', 186083.33333333333], ['$259,639.42', 259639.41666666667], ['$176,814.44', 176814.44275], ['$120,410.64', 120410.63551275],
    ['$81,999.64', 81999.64278418275], ['$55,841.76', 55841.756736028453], ['$15,845.10', 15845.098473848073]];
  examples(d, DB.map(([page, exact], k) => [`DB(A2,A3,A4,${k + 1},7)`, page, exact]));
  rel(calc(d, 'DB(A2,A3,A4,1)'), 1e6 * 0.319, 'a whole first year when month is left out');
  cases(d, [['DB(A2,A3,A4,8,7)', '#NUM!'], ['DB(A2,A3,A4,0)', '#NUM!'], ['DB(A2,A3,A4,1,13)', '#NUM!']]);
  // ddb-function: A2 $2,400, A3 $300, A4 10.
  const dd = book({ A2: '$2,400', A3: '$300', A4: 10 });
  examples(dd, [
    ['DDB(A2,A3,A4*365,1)', '$1.32', 1.3150684931506849],
    ['DDB(A2,A3,A4*12,1,2)', '$40.00', 40],
    ['DDB(A2,A3,A4,1,2)', '$480.00', 480],
    ['DDB(A2,A3,A4,2,1.5)', '$306.00', 306],
    ['DDB(A2,A3,A4,10)', '$22.12', 22.1225472],
  ]);
  // The balance never falls below salvage: the periods sum to cost - salvage once it is reached.
  rel(calc(dd, 'SUM(DDB(A2,A3,A4,{1,2,3,4,5,6,7,8,9,10}))'), 2400 - 300, 'ten periods');
  cases(dd, [['DDB(A2,A3,A4,11)', '#NUM!'], ['DDB(A2,A3,A4,0)', '#NUM!'], ['DDB(A2,A3,A4,1,0)', '#NUM!'], ['DDB(-1,A3,A4,1)', '#NUM!'], ['DDB(A2,A3,2,2,4)', 0], ['DDB(A2,A3,2,1,4)', 2100]]);
});

test('EFFECT, NOMINAL, RRI, PDURATION, FVSCHEDULE with Microsoft\'s data', () => {
  const e = book({ A2: 0.0525, A3: 4, B2: 0.053543, C1: 0.09, C2: 0.11, C4: 0.1, D1: 'x' });
  examples(e, [
    ['EFFECT(A2,A3)', '0.0535427', 0.053542667370758057],
    ['NOMINAL(B2,A3)', '0.05250032', 0.052500319868355864],
    ['RRI(96,10000,11000)', '0.0009933', 0.00099330737629139485],
    ['PDURATION(2.5%,2000,2200)', '3.86', 3.8598661626226452],
    ['PDURATION(0.025/12,1000,1200)', '87.6', 87.605476419375628],
    ['FVSCHEDULE(1,{0.09,0.11,0.1})', '1.3309', 1.33089],
    ['FVSCHEDULE(1,C1:C4)', '1.3309', 1.33089],
  ]);
  rel(calc(e, 'EFFECT(A2,4.9)'), 0.053542667370758057, 'npery truncated');
  rel(calc(e, 'FVSCHEDULE(100,0.1)'), 110, 'one rate');
  rel(calc(e, 'NOMINAL(EFFECT(A2,12),12)'), 0.0525, 'NOMINAL undoes EFFECT');
  cases(e, [
    ['EFFECT(0,4)', '#NUM!'], ['EFFECT(A2,0.5)', '#NUM!'], ['EFFECT("x",4)', '#VALUE!'], ['NOMINAL(-0.1,4)', '#NUM!'], ['NOMINAL(B2,0)', '#NUM!'],
    ['RRI(0,10000,11000)', '#NUM!'], ['RRI(10,0,100)', '#NUM!'], ['PDURATION(0,1,2)', '#NUM!'], ['PDURATION(0.1,-1,2)', '#NUM!'], ['PDURATION(0.1,1,0)', '#NUM!'],
    ['FVSCHEDULE(1,C1:D1)', '#VALUE!'], ['FVSCHEDULE(1,{1,"x"})', '#VALUE!'],
  ]);
});

test('CUMIPMT and CUMPRINC with Microsoft\'s data and their #NUM! rules', () => {
  const e = book({ A2: 0.09, A3: 30, A4: 125000 });
  examples(e, [
    ['CUMIPMT(A2/12,A3*12,A4,13,24,0)', '-11135.23213', -11135.232130750843],
    ['CUMIPMT(A2/12,A3*12,A4,1,1,0)', '-937.5', -937.5],
    ['CUMPRINC(A2/12,A3*12,A4,13,24,0)', '-934.1071234', -934.10712342089831],
    ['CUMPRINC(A2/12,A3*12,A4,1,1,0)', '-68.27827118', -68.278271180978417],
  ]);
  const periods = `{${Array.from({ length: 12 }, (_, k) => k + 13).join(',')}}`;
  for (const t of [0, 1]) {
    rel(calc(e, `CUMIPMT(A2/12,A3*12,A4,13,24,${t})`), calc(e, `SUM(IPMT(A2/12,${periods},A3*12,A4,0,${t}))`), `CUMIPMT is the sum of IPMT, type ${t}`);
    rel(calc(e, `CUMPRINC(A2/12,A3*12,A4,13,24,${t})`), calc(e, `SUM(PPMT(A2/12,${periods},A3*12,A4,0,${t}))`), `CUMPRINC is the sum of PPMT, type ${t}`);
    rel(calc(e, `CUMPRINC(A2/12,A3*12,A4,1,360,${t})`), -125000, `the whole loan, type ${t}`);
  }
  for (const name of ['CUMIPMT', 'CUMPRINC']) {
    cases(e, [
      [`${name}(0,360,A4,1,1,0)`, '#NUM!'], [`${name}(A2/12,0,A4,1,1,0)`, '#NUM!'], [`${name}(A2/12,360,0,1,1,0)`, '#NUM!'], [`${name}(A2/12,360,A4,0,1,0)`, '#NUM!'],
      [`${name}(A2/12,360,A4,2,1,0)`, '#NUM!'], [`${name}(A2/12,360,A4,1,1,2)`, '#NUM!'], [`${name}(A2/12,360,A4,1,361,0)`, '#NUM!'], [`${name}(A2/12,360,A4,1,1)`, '#VALUE!'],
    ]);
  }
});
