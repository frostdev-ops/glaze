// XOR and SWITCH (lib/sheet-fn-logical2.js). Cases are the worked examples on Microsoft's pages for each function
// (support.microsoft.com/en-us/office/xor-function-1548d4c2-5e47-4f77-9a92-0533bba14f37,
// switch-function-47ab33c0-28ce-4530-8a45-d532ec4aa25e), their Remarks, and what Excel 16.114.1 gave for the rest
// (probes of 2026-10-30, ~/Projects/glaze-plans/sheets/fn-rest-excel-probes-2026-10-30.txt).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-logical.js');
require('../lib/sheet-fn-date.js');
require('../lib/sheet-fn-info.js');
require('../lib/sheet-fn-lookup.js');
require('../lib/sheet-fn-logical2.js');

const book = (cells = {}) => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  for (const [at, input] of Object.entries(cells)) {
    const x = typeof input === 'string' ? M.parseInput(input) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    M.apply(wb, { op: 'set', sheet: sh.id, r: M.cellPosition(at)[0], c: M.cellPosition(at)[1], cell: x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v } });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, f, at = 'Z100') => out(e.evaluate(f, e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };

test('XOR and SWITCH are registered, and nothing sets a timer', () => {
  for (const name of ['XOR', 'SWITCH']) assert.ok(C.fn(name), name);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-logical2.js'), 'utf8')));
});

test('XOR: true when an odd number of its values are TRUE', () => {
  const e = book({ A1: true, A2: "'TRUE", A3: 'x', A4: false, A5: true });
  cases(e, [
    ['XOR(3>0,2<9)', false], ['XOR(3>12,4>6)', false], ['XOR(TRUE,FALSE)', true], ['XOR(TRUE,TRUE,TRUE)', true],
    // Remarks: text and blanks in a range are ignored; a range with no logical value is #VALUE!.
    ['XOR(A1:A3)', true], ['XOR(A1:A5)', false], ['XOR(A2)', '#VALUE!'], ['XOR(A3)', '#VALUE!'], ['XOR(B1)', '#VALUE!'],
    // Typed text reads as a logical when it says TRUE or FALSE; numbers are true unless 0.
    ['XOR("TRUE")', true], ['XOR("x")', '#VALUE!'], ['XOR(1,2)', false], ['XOR(0,2)', true], ['XOR({1,0,1},TRUE)', true],
    ['XOR(TRUE,NA())', '#N/A'],
  ]);
});

test('SWITCH: the result for the first value that matches, else the default or #N/A', () => {
  const e = book({ A2: 2, A3: 99, A4: 99, A5: 2, A6: 3 });
  cases(e, [
    ['SWITCH(WEEKDAY(A2),1,"Sunday",2,"Monday",3,"Tuesday","No match")', 'Monday'],
    ['SWITCH(A3,1,"Sunday",2,"Monday",3,"Tuesday")', '#N/A'],
    ['SWITCH(A4,1,"Sunday",2,"Monday",3,"Tuesday","No match")', 'No match'],
    ['SWITCH(A5,1,"Sunday",7,"Saturday","weekday")', 'weekday'],
    ['SWITCH(A6,1,"Sunday",2,"Monday",3,"Tuesday","No match")', 'Tuesday'],
  ]);
});

test('SWITCH: matching, laziness, errors and arrays as Excel has them', () => {
  const e = book({ A1: 3, A2: 1, A3: 4 });
  cases(e, [
    // Text matches without case; a value of another kind never matches; a blank expression is 0, not "".
    ['SWITCH("b","a",1,"B",2)', 2], ['SWITCH(1,"1","text","num")', 'num'], ['SWITCH(TRUE,1,"one","no")', 'no'],
    ['SWITCH(D1,0,"zero","other")', 'zero'], ['SWITCH(D1,"","empty","other")', 'other'],
    // Values are compared in order and evaluated only until one matches; results only for the match.
    ['SWITCH(1,1,"a",NA(),"b")', 'a'], ['SWITCH(1,NA(),"a",1,"b")', '#N/A'], ['SWITCH(1,1,"a",2,1/0)', 'a'],
    ['SWITCH(2,1,"a",2,1/0)', '#DIV/0!'], ['SWITCH(NA(),1,"a","d")', '#N/A'],
    // An array expression gives an array of results; a result that is a range intersects as a value.
    ['INDEX(SWITCH({1,2},1,"a",2,"b"),1,2)', 'b'], ['SWITCH(2,1,"a",2,A1:A3)', '#VALUE!'], ['SWITCH(2,1,"a",2,A1:A3)+0', '#VALUE!'],
    ['SWITCH(1,1)', '#VALUE!'],
  ]);
  assert.equal(calc(e, 'SWITCH(2,1,"a",2,A1:A3)', 'Z2'), 1, 'intersects the row it is on');
});

test('SWITCH matches array values at each expression position', () => {
  const e = book();
  cases(e, [
    ['SWITCH(0,A1,"blank","other")', 'blank'],
    ['SWITCH(2,{1,2},"array","other")', 'other'],
    ['INDEX(SWITCH({1,2},{1,2},"array","other"),1,2)', 'array'],
    ['INDEX(SWITCH({1,2},{1,2},{10,20},1/0),1,2)', 20],
  ]);
});

test('SWITCH materializes each lazy comparison range once', () => {
  const values = Array.from({ length: 1000 }, (_, i) => [i]), ref = new C.lib.Ref({}, 0, 0, 999, 0);
  let reads = 0;
  const ctx = { value: (v) => { if (v === ref) { reads++; return values; } return v; } };
  const result = C.fn('SWITCH').fn([values, () => ref, () => 7, () => 0], ctx);
  assert.ok(result.every(([v]) => v === 7));
  assert.equal(reads, 1, 'repeated range conversion makes an n-cell SWITCH quadratic');
});
