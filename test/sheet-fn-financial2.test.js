// VDB ISPMT DOLLARDE DOLLARFR (lib/sheet-fn-financial2.js). Cases are the worked examples on Microsoft's pages for
// each function (support.microsoft.com/en-us/office/vdb-function-dde4e207-f3fa-488d-91d2-66d55e861d73,
// ispmt-function-fa58adb6-9d39-4ce0-8f43-75399cea56cc, dollarde-function-db85aab0-1677-428a-9dfd-a38476693427,
// dollarfr-function-0835d163-3023-4a33-9824-3042c5d4f495), their Remarks, and what Excel 16.114.1 gave for the rest
// (probes of 2026-10-30, ~/Projects/glaze-plans/sheets/fn-rest-excel-probes-2026-10-30.txt), held to 1e-12. ISPMT's page
// shows its example only as an image; its cases are Excel's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-info.js');
require('../lib/sheet-fn-financial2.js');

const book = (rows = []) => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v === null) return;
    const cell = typeof v === 'string' ? { t: 's', v } : typeof v === 'boolean' ? { t: 'b', v } : { t: 'n', v };
    M.apply(wb, { op: 'set', sheet: sh.id, r, c, cell });
  }));
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, f, at = 'Z100') => out(e.evaluate(f, e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
const close = (e, rows) => {
  for (const [f, want] of rows) {
    const x = calc(e, f);
    assert.ok(typeof x === 'number' && (x === want || Math.abs(x - want) <= 1e-12 * Math.abs(want)), `${f} = ${x}; Excel ${want}`);
  }
};
const prints = (e, rows) => {
  for (const [f, printed] of rows) {
    const x = calc(e, f), d = (printed.split('.')[1] ?? '').length;
    assert.ok(typeof x === 'number' && Math.abs(x - Number(printed)) <= 0.50001 * 10 ** -d, `${f} = ${x}; Microsoft prints ${printed}`);
  }
};

test('the functions are registered, and nothing sets a timer', () => {
  for (const name of ['VDB', 'ISPMT', 'DOLLARDE', 'DOLLARFR']) assert.ok(C.fn(name), name);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-financial2.js'), 'utf8')));
});

test('VDB: Microsoft\'s examples', () => {
  const e = book([['Data', 'Description'], [2400, 'Initial cost'], [300, 'Salvage value'], [10, 'Lifetime in years']]);
  prints(e, [
    ['VDB(A2, A3, A4*365, 0, 1)', '1.32'], ['VDB(A2, A3, A4*12, 0, 1)', '40.00'], ['VDB(A2, A3, A4, 0, 1)', '480.00'],
    ['VDB(A2, A3, A4*12, 6, 18)', '396.31'], ['VDB(A2, A3, A4*12, 6, 18, 1.5)', '311.81'], ['VDB(A2, A3, A4, 0, 0.875, 1.5)', '315.00'],
  ]);
});

test('VDB: switching to straight line, partial periods, no_switch, as Excel computes them', () => {
  const e = book();
  close(e, [
    ['VDB(2400,300,3650,0,1)', 1.3150684931506849], ['VDB(2400,300,120,6,18)', 396.30605326475086],
    ['VDB(2400,300,120,6,18,1.5)', 311.80893665823413], ['VDB(2400,300,10,5,10,3)', 103.36800000000005],
    ['VDB(2400,300,10,0,1)', 480], ['VDB(2400,300,10,0,10)', 2100], ['VDB(2400,300,10,0,10,2,TRUE)', 2100.0000000000009],
    ['VDB(2400,300,10,6,10,2,TRUE)', 329.1456000000005],
    // A fractional start: what is left of the asset then, over what is left of its life, at the original rate.
    ['VDB(2400,300,10,0.5,3.5)', 1054.0799999999999], ['VDB(2400,300,10,2.3,7.9,1.5)', 1035.6205510372342],
    ['VDB(2400,300,10,0.5,3.5,2,TRUE)', 1054.0800000000002], ['VDB(2400,300,10,2.3,7.9,1.5,TRUE)', 990.45196472812484],
    // A factor of 0 is straight line from the start; a rate of 1 or more takes everything in the first period.
    ['VDB(2400,300,10,0,1,0)', 210], ['VDB(2400,300,1,0,1,2)', 2100], ['VDB(2400,300,2.5,0,2.5)', 2100],
    // A salvage above the cost depreciates by the difference.
    ['VDB(2400,3000,10,0,1)', -600],
  ]);
  cases(e, [
    ['VDB(2400,300,10,4,4)', 0],
    ['VDB(2400,300,10,11,12)', '#NUM!'], ['VDB(2400,300,10,3,2)', '#NUM!'], ['VDB(2400,300,10,-1,1)', '#NUM!'],
    ['VDB(-2400,300,10,0,1)', '#NUM!'], ['VDB(2400,-300,10,0,1)', '#NUM!'], ['VDB(2400,300,10,0,1,-1)', '#NUM!'],
    ['VDB(2400,300,0,0,0)', '#DIV/0!'], ['VDB(2400,300,10,0,1,2,"x")', '#VALUE!'], ['VDB(2400,300,10,0,1,2,NA())', '#N/A'],
  ]);
});

test('ISPMT: interest for a period of even principal payments, periods counted from zero', () => {
  const e = book();
  close(e, [
    ['ISPMT(0.1/12,1,36,8000000)', -64814.814814814818], ['ISPMT(0.1,1,3,8000000)', -533333.33333333337],
    ['ISPMT(0.1,0,3,8000000)', -800000], ['ISPMT(0.1,4,3,8000000)', 266666.66666666669],
  ]);
  cases(e, [['ISPMT(0.1,1,0,8000000)', '#DIV/0!'], ['ISPMT("x",1,3,8000000)', '#VALUE!']]);
});

test('DOLLARDE and DOLLARFR: Microsoft\'s examples and Remarks', () => {
  const e = book();
  cases(e, [
    ['DOLLARDE(1.02,16)', 1.125], ['DOLLARDE(1.1,32)', 1.3125000000000002], ['DOLLARFR(1.125,16)', 1.02], ['DOLLARFR(1.125,32)', 1.04],
    // A fraction is truncated; below 0 #NUM!; from 0 to below 1 #DIV/0!.
    ['DOLLARDE(1.02,16.9)', 1.125], ['DOLLARDE(1.02,-1)', '#NUM!'], ['DOLLARDE(1.02,0.5)', '#DIV/0!'], ['DOLLARDE(1.02,0)', '#DIV/0!'],
    ['DOLLARFR(1.125,0)', '#DIV/0!'], ['DOLLARFR(1.125,-2)', '#NUM!'],
  ]);
  close(e, [
    ['DOLLARDE(-1.02,16)', -1.125], ['DOLLARDE(1.5,10)', 1.5], ['DOLLARDE(1.05,10)', 1.05], ['DOLLARDE(1.1,100)', 1.1000000000000001],
    ['DOLLARDE(1.1,3)', 1.3333333333333337], ['DOLLARFR(-1.125,16)', -1.02], ['DOLLARFR(1.3,3)', 1.0900000000000001], ['DOLLARFR(1.5,10)', 1.5],
  ]);
});

test('DOLLARDE and DOLLARFR reject negative fractions before truncation', () => {
  cases(book(), [['DOLLARDE(1.02,-0.5)', '#NUM!'], ['DOLLARFR(1.125,-0.5)', '#NUM!']]);
});
