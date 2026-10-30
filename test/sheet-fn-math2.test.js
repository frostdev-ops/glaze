// The remaining math functions (lib/sheet-fn-math2.js). Cases are the worked examples on Microsoft's page for each
// function, https://support.microsoft.com/en-us/office/<name>-function-<id>:
//   sumproduct 16753e75-9f68-4874-94ac-4d2145a2fd2e, sumsq e3313c02-51cc-4963-aae6-31442d9ec307, product
//   8e6b5b24-90ee-4650-aeec-80982a0512ce, quotient 9f7bf099-2a18-4282-8fa4-65290cc99dee, ceiling 0a5cd7c8-0720-4f0a-bd2c-c943e510899f,
//   ceiling-math 80f95d2f-b499-4eee-9f16-f795a8e306c8, floor 14bb497c-24f2-4e04-b327-b0b4de5a8886, floor-math
//   c302b599-fbdb-4177-ba19-2c2b1249a2f5, mround c299c3b0-15a5-426d-aa4b-d2d5b3baf427, trunc 8b86a64c-3127-43db-ba14-aa5ceb292721,
//   even 197b5f06-c795-4c1e-8696-3c3b8a646cf9, odd deae64eb-e08a-4c88-8b40-6d0b42575c98, sign 109c932d-fcdc-4023-91f1-2dd0e916a1d8,
//   exp c578f034-2c45-4c37-bc8c-329660a63abe, ln 81fe1ed7-dac9-4acd-ba1d-07a142c6118f, log 4e82f196-1ca9-4747-8fb0-6c4a3abb3280,
//   log10 c75b881b-49dd-44fb-b6f4-37e3486a0211, pi 264199d0-a3ba-46b8-975a-c4a04608989b, radians ac409508-3d48-45f5-ac02-1497c92de5bf,
//   degrees 4d6ec4db-e694-4b94-ace0-1cc3f61f9ba1, sin cf0e3432-8b9e-483c-bc55-a76651c95602, cos 0fb808a5-95d6-4553-8148-22aebdce5f05,
//   tan 08851a40-179f-4052-b789-d7f699447401, asin 81fb95e5-6d6f-48c4-bc45-58f955c6d347, acos cb73173f-d089-4582-afa1-76e5524b5d5b,
//   atan 50746fa8-630a-406b-81d0-4a2aed395543, atan2 c04592ab-b9e3-4908-b428-c96b3a565033, sinh 1e4e8b9f-2b65-43fc-ab8a-0a37f4081fa7,
//   cosh e460d426-c471-43e8-9540-a57ff3b70555, tanh 017222f0-a0c3-4f69-9787-b3202295dc6c, rand 4cbfa695-8869-4788-8d90-021ea9f5be73,
//   randbetween 4cc7f0d1-87dc-4eb7-987f-a469ab381685, fact ca8588c2-15f2-41c0-8e8c-c11bd471a4f3, factdouble
//   e67697ac-d214-48eb-b7b7-cce2589ecac8, gcd d5107a51-69e3-461f-8e4c-ddfc21b5073a, lcm 7152b67a-8bb5-4075-ae5c-06ede5563c94,
//   base 2ef61411-aee9-4f29-a811-1c42456c6342, decimal ee554665-6176-46ef-82de-0a283658da2e, roman d6b0b99e-de46-4704-a518-b45a0f8b56f5,
//   arabic 9a8da418-c17b-4ef9-a657-9370a30a674f, aggregate 43b9278e-6aa7-4f17-92b6-e19993fa26df, subtotal
//   7b027003-f060-4ade-9040-e478765b9939, seriessum a3ab25b5-1093-4f5b-b084-96c49087f637.
// A page's figure shown to fewer digits is checked to those digits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-math2.js');

const book = (cells = {}, { sheets = ['Sheet1'], opts, hide = [], filter } = {}) => {
  const wb = M.workbook();
  wb.sheets[0].name = sheets[0];
  for (const name of sheets.slice(1)) M.apply(wb, { op: 'addSheet', at: wb.sheets.length, name });
  for (const [at, input] of Object.entries(cells)) {
    const [sheet, ref] = at.includes('!') ? at.split('!') : [sheets[0], at];
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    M.apply(wb, { op: 'set', sheet: M.getSheet(wb, sheet).id, r, c, cell: x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v } });
  }
  for (const row of hide) M.apply(wb, { op: 'hide', sheet: wb.sheets[0].id, axis: 'row', i: row - 1, hidden: true });
  if (filter) wb.sheets[0].filter = M.rangePosition(filter);
  const e = C.engine(wb, opts);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text) => out(e.evaluate(text, e.wb.sheets[0].id, 99, 25));
const val = (e, ref) => out(e.value(e.wb.sheets[0].id, ...M.cellPosition(ref)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
// [formula, the page's figure]: equal to as many decimals as the page shows.
const shown = (e, rows) => {
  for (const [f, page] of rows) {
    const got = calc(e, f), dp = (String(page).split('.')[1] ?? '').length;
    assert.equal(typeof got, 'number', `${f} → ${got}`);
    assert.ok(Math.abs(got - Number(page)) <= 0.5 * 10 ** -dp + 1e-15, `${f} → ${got}, the page shows ${page}`);
  }
};

const NAMES = ('SUMPRODUCT SUMSQ PRODUCT QUOTIENT CEILING CEILING.MATH FLOOR FLOOR.MATH MROUND TRUNC EVEN ODD SIGN EXP LN LOG LOG10 PI RADIANS DEGREES '
  + 'SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH RAND RANDBETWEEN FACT FACTDOUBLE GCD LCM BASE DECIMAL ROMAN ARABIC AGGREGATE SUBTOTAL SERIESSUM').split(' ');

test('the math functions are registered, volatile where Excel\'s are', () => {
  assert.equal(NAMES.length, 43);
  for (const name of NAMES) assert.ok(C.fn(name), name);
  assert.ok(C.fn('RAND').volatile && C.fn('RANDBETWEEN').volatile);
  assert.ok(!C.fn('PI').volatile);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-math2.js'), 'utf8')), 'no timers');
});

test('SUMPRODUCT with the page\'s four tables; non-numbers are 0; sizes must match', () => {
  const e = book({
    B2: 'X', C2: 'S', D2: 45, B3: 'Y', C3: 'M', D3: 21, B4: 'Z', C4: 'L', D4: 25, B5: 'X', C5: 'L', D5: 20, B6: 'Y', C6: 'M', D6: 41, B7: 'Z', C7: 'S', D7: 19, B10: 'Y', C10: 'M',
    F2: '$3.25', F3: '$2.20', F4: '$4.20', F5: '$3.62', G2: 9, G3: 7, G4: 3, G5: 6, G6: 'n/a',
    I2: 'Jones', J2: '$3,466', K2: -82, I3: 'Deacon', J3: '$9,085', K3: -100, I4: 'Xi', J4: '$7,997', K4: -73, I5: 'Omalpu', J5: '$1,398', K5: -53, I8: 'Deacon',
    M2: 'North', N2: 'Apples', O2: 2763, M3: 'South', N3: 'Pears', O3: 9359, M4: 'East', N4: 'Cherries', O4: 3830, M5: 'West', N5: 'Bananas', O5: 8720,
    M6: 'North', N6: 'Pears', O6: 1873, M7: 'South', N7: 'Apples', O7: 4065, M8: 'East', N8: 'Cherries', O8: 1419, M9: 'West', N9: 'Bananas', O9: 7173, M12: 'East', N12: 'Cherries',
    Q1: 1, Q2: '#N/A',
  });
  cases(e, [
    ['SUMPRODUCT((B2:B7=B10)*(C2:C7=C10)*D2:D7)', 62], ['SUMPRODUCT(((J2:J5)+(K2:K5))*(I2:I5=I8))', 8985], ['SUMPRODUCT((M2:M9=M12)*(N2:N9=N12)*O2:O9)', 5249],
    ['SUMPRODUCT(F2:F5,G2:G6)', '#VALUE!'], ['SUMPRODUCT(G2:G6,G2:G6)', 175], ['SUMPRODUCT(D2:D7>20)', 0], ['SUMPRODUCT(--(D2:D7>20))', 4],
    ['SUMPRODUCT({1,2;3,4},{5,6;7,8})', 70], ['SUMPRODUCT({1,2},{1;2})', '#VALUE!'], ['SUMPRODUCT(Q1:Q2)', '#N/A'], ['SUMPRODUCT({1,"a",TRUE})', 1],
  ]);
  assert.ok(Math.abs(calc(e, 'SUMPRODUCT(F2:F5,G2:G5)') - 78.97) < 1e-9);
  assert.equal(calc(e, 'SUMPRODUCT(F2:F5,G2:G5)'), calc(e, 'F2*G2+F3*G3+F4*G4+F5*G5'));
});

test('a range past the engine\'s cell cap is #NUM!', () => {
  const e = book({ A1: 1, Z10000: 1 });
  cases(e, [['SUMPRODUCT(A1:Z10000)', '#NUM!'], ['SERIESSUM(1,1,1,A1:Z10000)', '#NUM!'], ['AGGREGATE(14,6,A1:Z10000+0,1)', '#NUM!']]);
});

test('SUMSQ, PRODUCT, QUOTIENT', () => {
  const e = book({ A2: 5, A3: 15, A4: 30, B1: 3, B2: 'x', B3: true, B4: 4 });
  cases(e, [
    ['SUMSQ(3, 4)', 25], ['SUMSQ(B1:B4)', 25], ['SUMSQ("2",TRUE)', 5], ['SUMSQ("x")', '#VALUE!'], ['SUMSQ({1,2},3)', 14],
    ['PRODUCT(A2:A4)', 2250], ['PRODUCT(A2:A4, 2)', 4500], ['A2*A3*A4', 2250], ['PRODUCT(B1:B4)', 12], ['PRODUCT(Z1:Z3)', 0], ['PRODUCT(1/0,2)', '#DIV/0!'],
    ['QUOTIENT(5, 2)', 2], ['QUOTIENT(4.5, 3.1)', 1], ['QUOTIENT(-10, 3)', -3], ['QUOTIENT(1,0)', '#DIV/0!'], ['QUOTIENT("x",2)', '#VALUE!'],
    // Excel 16.114.1: unlike SUM's family, PRODUCT passes over an argument left out.
    ['PRODUCT(2,,3)', 6], ['SUMSQ(2,,3)', 13],
  ]);
});

test('CEILING, CEILING.MATH, FLOOR, FLOOR.MATH, MROUND, TRUNC, EVEN, ODD, SIGN', () => {
  const e = book();
  cases(e, [
    ['CEILING(2.5, 1)', 3], ['CEILING(-2.5, -2)', -4], ['CEILING(-2.5, 2)', -2], ['CEILING(1.5, 0.1)', 1.5], ['CEILING(0.234, 0.01)', 0.24], ['CEILING("x",1)', '#VALUE!'],
    ['CEILING(4,2)', 4], ['CEILING(4.42,0.05)', 4.45],
    ['CEILING.MATH(24.3,5)', 25], ['CEILING.MATH(6.7)', 7], ['CEILING.MATH(-8.1,2)', -8], ['CEILING.MATH(-5.5,2,-1)', -6],
    ['CEILING.MATH(6.3)', 7], ['CEILING.MATH(-6.7)', -6], ['CEILING.MATH(-6.3,1,1)', -7], ['CEILING.MATH(5,0)', 0], ['CEILING.MATH(24.3,-5)', 25],
    ['FLOOR(3.7,2)', 2], ['FLOOR(-2.5,-2)', -2], ['FLOOR(2.5,-2)', '#NUM!'], ['FLOOR(1.58,0.1)', 1.5], ['FLOOR(0.234,0.01)', 0.23], ['FLOOR(-2.5,2)', -4],
    ['FLOOR("x",1)', '#VALUE!'],
    ['FLOOR.MATH(24.3,5)', 20], ['FLOOR.MATH(6.7)', 6], ['FLOOR.MATH(-8.1,2)', -10], ['FLOOR.MATH(-5.5,2,-1)', -4],
    ['FLOOR.MATH(6.3)', 6], ['FLOOR.MATH(-6.7)', -7], ['FLOOR.MATH(-6.3,1,-1)', -6],
    ['MROUND(10, 3)', 9], ['MROUND(-10, -3)', -9], ['MROUND(1.3, 0.2)', 1.4], ['MROUND(5, -2)', '#NUM!'], ['MROUND(7.5,5)', 10], ['MROUND(-7.5,-5)', -10],
    ['TRUNC(8.9)', 8], ['TRUNC(-8.9)', -8], ['TRUNC(0.45)', 0], ['TRUNC(3.14159,2)', 3.14], ['TRUNC(-3.14159,3)', -3.141], ['TRUNC(1234.567,-2)', 1200], ['TRUNC(1234567.891,15)', 1234567.891], ['TRUNC(2E+21)', 2e21],
    ['EVEN(1.5)', 2], ['EVEN(3)', 4], ['EVEN(2)', 2], ['EVEN(-1)', -2], ['EVEN(0)', 0], ['EVEN("x")', '#VALUE!'],
    ['ODD(1.5)', 3], ['ODD(3)', 3], ['ODD(2)', 3], ['ODD(-1)', -1], ['ODD(-2)', -3], ['ODD("x")', '#VALUE!'],
    ['SIGN(10)', 1], ['SIGN(4-4)', 0], ['SIGN(-0.00001)', -1],
  ]);
});

test('EXP, LN, LOG, LOG10, PI, RADIANS, DEGREES and the trigonometric functions', () => {
  const e = book({ A3: 3 });
  shown(e, [
    ['EXP(1)', '2.71828183'], ['EXP(2)', '7.3890561'], ['LN(86)', '4.4543473'], ['LN(2.7182818)', '1'], ['LOG(86, 2.7182818)', '4.4543473'], ['LOG10(86)', '1.9345'],
    ['PI()', '3.141592654'], ['PI()/2', '1.570796327'], ['PI()*(A3^2)', '28.27433388'], ['RADIANS(270)', '4.712389'],
    ['SIN(PI())', '0.0'], ['SIN(PI()/2)', '1.0'], ['SIN(30*PI()/180)', '0.5'], ['SIN(RADIANS(30))', '0.5'],
    ['COS(1.047)', '0.5001711'], ['COS(60*PI()/180)', '0.5'], ['COS(RADIANS(60))', '0.5'], ['TAN(0.785)', '0.99920'], ['TAN(45*PI()/180)', '1'], ['TAN(RADIANS(45))', '1'],
    ['ASIN(-0.5)', '-0.523598776'], ['ASIN(-0.5)*180/PI()', '-30'], ['DEGREES(ASIN(-0.5))', '-30'], ['ACOS(-0.5)', '2.094395102'], ['ACOS(-0.5)*180/PI()', '120'],
    ['DEGREES(ACOS(-0.5))', '120'], ['ATAN(1)', '0.785398163'], ['ATAN(1)*180/PI()', '45'], ['DEGREES(ATAN(1))', '45'],
    ['ATAN2(1, 1)', '0.785398163'], ['ATAN2(-1, -1)', '-2.35619449'], ['ATAN2(-1, -1)*180/PI()', '-135'], ['DEGREES(ATAN2(-1, -1))', '-135'],
    ['2.868*SINH(0.0342*1.03)', '0.1010491'], ['COSH(4)', '27.308233'], ['COSH(EXP(1))', '7.6101251'], ['TANH(-2)', '-0.964028'], ['TANH(0)', '0'], ['TANH(0.5)', '0.462117'],
  ]);
  cases(e, [
    ['LN(EXP(3))', 3], ['LOG(10)', 1], ['LOG(8, 2)', 3], ['LOG10(10)', 1], ['LOG10(100000)', 5], ['LOG10(10^5)', 5], ['DEGREES(PI())', 180], ['LOG(1000,10)', 3], ['LOG(125,5)', 3],
    ['LN(0)', '#NUM!'], ['LN(-1)', '#NUM!'], ['LOG(0)', '#NUM!'], ['LOG(10,0)', '#NUM!'], ['LOG(10,1)', '#DIV/0!'], ['LOG10(-5)', '#NUM!'], ['EXP(710)', '#NUM!'],
    ['ASIN(2)', '#NUM!'], ['ACOS(-1.5)', '#NUM!'], ['ATAN2(0,0)', '#DIV/0!'], ['ATAN2(0,1)', Math.PI / 2], ['COSH(1000)', '#NUM!'], ['SINH(-1000)', '#NUM!'], ['TANH(1000)', 1],
    ['SIN("x")', '#VALUE!'], ['PI(1)', '#VALUE!'],
  ]);
});

test('RAND and RANDBETWEEN draw from the engine\'s source of randomness, again on every edit', () => {
  let i = 0;
  const e = book({ A1: '=RAND()', A2: '=RANDBETWEEN(1,100)', A3: '=RANDBETWEEN(-1,1)', A4: '=INT(RAND()*100)' }, { opts: { random: () => (++i * 0.377) % 1 } });
  const first = ['A1', 'A2', 'A3', 'A4'].map((r) => val(e, r));
  assert.ok(first[0] >= 0 && first[0] < 1);
  assert.ok(first.slice(1).every(Number.isInteger));
  assert.equal(i, 4, 'one draw per call');
  e.edit(e.wb.sheets[0].id, 9, 9, '1');
  const again = ['A1', 'A2', 'A3', 'A4'].map((r) => val(e, r));
  assert.notDeepEqual(again, first, 'an edit anywhere draws again');
  const seq = (r) => book({}, { opts: { random: () => r } });
  cases(seq(0), [['RANDBETWEEN(1,100)', 1], ['RANDBETWEEN(-1,1)', -1], ['RAND()', 0]]);
  cases(seq(0.999999), [['RANDBETWEEN(1,100)', 100], ['RANDBETWEEN(-1,1)', 1], ['RANDBETWEEN(1.5,3.5)', 3], ['RANDBETWEEN(5,5)', 5]]);
  cases(seq(0.5), [['RANDBETWEEN(1,100)', 51], ['RANDBETWEEN(5,1)', '#NUM!'], ['RANDBETWEEN("x",1)', '#VALUE!']]);
  const counts = [0, 0, 0, 0, 0];
  for (let k = 0; k < 100; k++) counts[calc(seq(k / 100), 'RANDBETWEEN(1,4)')]++;
  assert.deepEqual(counts, [0, 25, 25, 25, 25], 'each whole number as likely');
});

test('FACT, FACTDOUBLE, GCD, LCM', () => {
  const e = book({ A1: 24, A2: 36, A3: 'x', B1: 12, B2: 18 });
  cases(e, [
    ['FACT(5)', 120], ['FACT(1.9)', 1], ['FACT(0)', 1], ['FACT(-1)', '#NUM!'], ['FACT(1)', 1], ['FACT(170)>7E306', true], ['FACT(171)', '#NUM!'],
    ['FACTDOUBLE(6)', 48], ['FACTDOUBLE(7)', 105], ['FACTDOUBLE(0)', 1], ['FACTDOUBLE(7.9)', 105], ['FACTDOUBLE(-1)', 1], ['FACTDOUBLE("x")', '#VALUE!'],
    ['GCD(5, 2)', 1], ['GCD(24, 36)', 12], ['GCD(7, 1)', 1], ['GCD(5, 0)', 5], ['GCD(24.9, 36.2)', 12], ['GCD(A1:A2)', 12], ['GCD(A1:A2,B1:B2)', 6],
    ['GCD(-1,2)', '#NUM!'], ['GCD(2^53,2)', '#NUM!'], ['GCD("x",2)', '#VALUE!'], ['GCD(A1:A3)', '#VALUE!'], ['GCD(0,0)', 0],
    ['LCM(5, 2)', 10], ['LCM(24, 36)', 72], ['LCM(A1:A2,B1:B2)', 72], ['LCM(5,0)', 0], ['LCM(-1,2)', '#NUM!'], ['LCM(2^52+1,2^52+3)', '#NUM!'], ['LCM("x",2)', '#VALUE!'],
  ]);
});

test('BASE, DECIMAL, ROMAN, ARABIC', () => {
  const e = book({ B1: 'mcmxii' });
  cases(e, [
    ['BASE(7,2)', '111'], ['BASE(100,16)', '64'], ['BASE(15,2,10)', '0000001111'], ['BASE(16,2)', '10000'], ['BASE(16,2,8)', '00010000'], ['BASE(255,36)', '73'],
    ['BASE(7.9,2.5)', '111'], ['BASE(0,2)', '0'], ['BASE(-1,2)', '#NUM!'], ['BASE(2^53,2)', '#NUM!'], ['BASE(7,1)', '#NUM!'], ['BASE(7,37)', '#NUM!'], ['BASE(7,2,256)', '#NUM!'],
    ['BASE("x",2)', '#VALUE!'],
    ['DECIMAL("FF",16)', 255], ['DECIMAL(111,2)', 7], ['DECIMAL("zap",36)', 45745], ['DECIMAL("ff",16)', 255], ['DECIMAL("FF",37)', '#NUM!'], ['DECIMAL("FF",1)', '#NUM!'],
    ['ROMAN(499,0)', 'CDXCIX'], ['ROMAN(499,1)', 'LDVLIV'], ['ROMAN(499,2)', 'XDIX'], ['ROMAN(499,3)', 'VDIV'], ['ROMAN(499,4)', 'ID'], ['ROMAN(499)', 'CDXCIX'],
    ['ROMAN(499,TRUE)', 'CDXCIX'], ['ROMAN(499,FALSE)', 'ID'], ['ROMAN(1999,0)', 'MCMXCIX'], ['ROMAN(3999)', 'MMMCMXCIX'], ['ROMAN(0)', ''], ['ROMAN(2013)', 'MMXIII'],
    ['ROMAN(-1)', '#VALUE!'], ['ROMAN(4000)', '#VALUE!'], ['ROMAN(499,5)', '#VALUE!'],
    ['ARABIC("LVII")', 57], ['ARABIC(B1)', 1912], ['ARABIC("mxmvii")', 1997], ['ARABIC("MXMVII")', 1997], ['ARABIC("")', 0], ['ARABIC(" -MMXI ")', -2011],
    ['ARABIC("ID")', 499], ['ARABIC(5)', '#VALUE!'], ['ARABIC("ABC")', '#VALUE!'], [`ARABIC("${'M'.repeat(255)}")`, 255000], [`ARABIC("${'M'.repeat(256)}")`, '#VALUE!'],
  ]);
  for (const n of [1, 4, 9, 14, 40, 90, 400, 444, 999, 1994, 2024, 3888]) for (const form of [0, 1, 2, 3, 4]) {
    assert.equal(calc(e, `ARABIC(ROMAN(${n},${form}))`), n, `ROMAN(${n},${form}) reads back`);
  }
});

test('AGGREGATE with Microsoft\'s data: its options for errors, hidden rows and nested subtotals', () => {
  const data = {
    A1: '#DIV/0!', B1: 82, A2: 72, B2: 65, A3: 30, B3: 95, A4: '#NUM!', B4: 63, A5: 31, B5: 53, A6: 96, B6: 71, A7: 32, B7: 55, A8: 81, B8: 83, A9: 33, B9: 100,
    A10: 53, B10: 91, A11: 34, B11: 89,
  };
  const e = book(data);
  cases(e, [
    ['AGGREGATE(4, 6, A1:A11)', 96], ['AGGREGATE(14, 6, A1:A11, 3)', 72], ['AGGREGATE(15, 6, A1:A11)', '#VALUE!'], ['AGGREGATE(12, 6, A1:A11, B1:B11)', 68], ['MAX(A1:A2)', '#DIV/0!'],
    ['AGGREGATE(4, 4, A1:A11)', '#DIV/0!'], ['AGGREGATE(4, 0, A1:A11)', '#DIV/0!'], ['AGGREGATE(9, 6, A1:A11)', 462], ['AGGREGATE(1, 6, A2:A3)', 51], ['AGGREGATE(2, 4, A1:A11)', 9],
    ['AGGREGATE(3, 6, A1:A11)', 9], ['AGGREGATE(3, 4, A1:A11)', 11], ['AGGREGATE(5, 6, A1:A11)', 30], ['AGGREGATE(6, 6, A2:A3)', 2160], ['AGGREGATE(15, 6, A1:A11, 2)', 31],
    ['AGGREGATE(13, 6, A1:B11)', 53], ['AGGREGATE(16, 6, B1:B11, 0.5)', 82], ['AGGREGATE(17, 6, B1:B11, 1)', 64], ['AGGREGATE(18, 6, B1:B11, 0.25)', 63],
    ['AGGREGATE(19, 6, B1:B11, 3)', 91], ['AGGREGATE(19, 6, B1:B11, 4)', '#NUM!'], ['AGGREGATE(14, 6, A1:A11, 10)', '#NUM!'],
    ['AGGREGATE(14, 6, A1:A11/(A1:A11<80), 1)', 72], ['AGGREGATE(9, 6, A1:A11*2)', '#VALUE!'], ['AGGREGATE(20, 6, A1:A11)', '#VALUE!'], ['AGGREGATE(9, 8, A1:A11)', '#VALUE!'],
  ]);
  for (const [f, want] of [['AGGREGATE(7, 6, B1:B11)', 16.401219466856727], ['AGGREGATE(8, 6, B1:B11)', 15.637949179654425], ['AGGREGATE(10, 6, B1:B11)', 269], ['AGGREGATE(11, 6, B1:B11)', 244.54545454545453]]) {
    assert.ok(Math.abs(calc(e, f) - want) < 1e-12 * want, f);
  }
  // Rows 6 and 8 (96 and 81) hidden; C1 a nested subtotal in the range it sums.
  const h = book({ ...data, C1: '=SUBTOTAL(9,A2:A3)', C2: 5, C3: '=AGGREGATE(9,6,A2:A3)*2', C4: '=C2*2' }, { hide: [6, 8] });
  cases(h, [
    ['AGGREGATE(4, 7, A1:A11)', 72], ['AGGREGATE(4, 6, A1:A11)', 96], ['AGGREGATE(4, 5, A2:A3)', 72], ['AGGREGATE(9, 3, A1:A11)', 285], ['AGGREGATE(14, 7, A1:A11, 1)', 72],
    ['AGGREGATE(9, 0, C1:C4)', 15], ['AGGREGATE(9, 4, C1:C4)', 321], ['AGGREGATE(9, 6, C1:C4)', 321],
  ]);
  const s = book({ 'Sheet2!A1': 1, A1: 2 }, { sheets: ['Sheet1', 'Sheet2'] });
  cases(s, [['AGGREGATE(9, 0, Sheet1:Sheet2!A1)', '#VALUE!']]);
});

test('SUBTOTAL with Microsoft\'s data: 1-11 count hidden rows, 101-111 skip them, filtered rows and nested subtotals never count', () => {
  const e = book({ A2: 120, A3: 10, A4: 150, A5: 23 });
  cases(e, [
    ['SUBTOTAL(9,A2:A5)', 303], ['SUBTOTAL(1,A2:A5)', 75.75], ['SUBTOTAL(2,A1:A5)', 4], ['SUBTOTAL(3,A1:A5)', 4], ['SUBTOTAL(4,A2:A5)', 150], ['SUBTOTAL(5,A2:A5)', 10],
    ['SUBTOTAL(6,A2:A3)', 1200], ['SUBTOTAL(109,A2:A5)', 303], ['SUBTOTAL(9,A2:A3,A4:A5)', 303], ['SUBTOTAL(12,A2:A5)', '#VALUE!'], ['SUBTOTAL(100,A2:A5)', '#VALUE!'],
    ['SUBTOTAL(9,{1,2})', '#VALUE!'], ['SUBTOTAL(1,Z1:Z5)', '#DIV/0!'],
  ]);
  for (const [f, want] of [['SUBTOTAL(7,A2:A5)', 69.70592992469626], ['SUBTOTAL(8,A2:A5)', 60.36710610920487], ['SUBTOTAL(10,A2:A5)', 4858.916666666667], ['SUBTOTAL(11,A2:A5)', 3644.1875]]) {
    assert.ok(Math.abs(calc(e, f) - want) < 1e-12 * want, f);
  }
  // Row 3 (10) hidden by hand, row 8 (7) filtered out of the filter on A6:A9; B1 and B2 subtotals inside the range.
  const h = book({ A2: 120, A3: 10, A4: 150, A5: 23, A6: 'Head', A7: 1, A8: 7, A9: 2, B1: '=SUBTOTAL(9,A2:A3)', B2: '=SUBTOTAL(109,A2:A3)*2', B3: 4 }, { hide: [3, 8], filter: 'A6:A9' });
  cases(h, [
    ['SUBTOTAL(9,A2:A5)', 303], ['SUBTOTAL(109,A2:A5)', 293], ['SUBTOTAL(9,A7:A9)', 3], ['SUBTOTAL(109,A7:A9)', 3], ['SUBTOTAL(2,A2:A9)', 6], ['SUBTOTAL(102,A2:A9)', 5],
    ['SUBTOTAL(9,B1:B3)', 4], ['SUM(B1:B3)', 374],
  ]);
  assert.equal(val(h, 'B1'), 130);
  const s = book({ 'Sheet2!A1': 1, A1: 2 }, { sheets: ['Sheet1', 'Sheet2'] });
  cases(s, [['SUBTOTAL(9,Sheet1:Sheet2!A1)', '#VALUE!']]);
});

test('SERIESSUM with Microsoft\'s data', () => {
  const e = book({ A3: 0.785398163, A4: 1, A5: -0.5, A6: 0.041666667, A7: -0.001388889, B3: '=PI()/4', B4: 1, B5: '=-1/FACT(2)', B6: '=1/FACT(4)', B7: '=-1/FACT(6)', C1: 'x' });
  shown(e, [['SERIESSUM(A3,0,2,A4:A7)', '0.707103'], ['SERIESSUM(B3,0,2,B4:B7)', '0.707103']]);
  const x = 0.785398163;
  assert.ok(Math.abs(calc(e, 'SERIESSUM(A3,0,2,A4:A7)') - (1 - 0.5 * x ** 2 + 0.041666667 * x ** 4 - 0.001388889 * x ** 6)) < 1e-15);
  cases(e, [['SERIESSUM(2,1,1,{1,1,1})', 14], ['SERIESSUM(2,0,1,C1:C2)', '#VALUE!'], ['SERIESSUM("x",0,1,{1})', '#VALUE!']]);
});

// Excel 16.114.1: FACT checks the original sign; FACTDOUBLE allows exactly -1.
test('factorial domains are checked before truncating', () => {
  cases(book(), [['FACT(-0.5)', '#NUM!'], ['FACTDOUBLE(-1)', 1], ['FACTDOUBLE(-1.9)', '#NUM!']]);
});
test('SERIESSUM uses zero coefficients for blank reference positions', () => {
  cases(book({ A1: 1, A3: 3 }), [['SERIESSUM(2,0,1,A1:A3)', 13], ['SERIESSUM(2,0,1,B1:B2)', 0]]);
});
test('AGGREGATE returns each requested rank in an array formula', () => {
  const e = book();
  const sh = e.wb.sheets[0];
  e.apply({ op: 'set', sheet: sh.id, r: 0, c: 3, cell: { t: 'n', v: 0, f: 'AGGREGATE(14,6,{2,4,1,3},{1,2,3,4})', a: 'D1:G1' } });
  e.recalc();
  assert.deepEqual(['D1','E1','F1','G1'].map((r) => val(e, r)), [4,3,2,1]);
});

test('hiding rows or changing the filter recalculates SUBTOTAL and AGGREGATE, and what reads them', () => {
  const e = book({ A1: 1, A2: 10, A3: 100, B1: '=SUBTOTAL(109,A1:A3)', B2: '=AGGREGATE(9,5,A1:A3)', B3: '=B1*2', B4: '=SUBTOTAL(9,A1:A3)', 'Sheet2!A1': '=SUBTOTAL(109,Sheet1!A1:A3)' },
    { sheets: ['Sheet1', 'Sheet2'] });
  const sh = e.wb.sheets[0], other = e.wb.sheets[1].id;
  const read = () => [val(e, 'B1'), val(e, 'B2'), val(e, 'B3'), val(e, 'B4'), out(e.value(other, 0, 0))];
  assert.deepEqual(read(), [111, 111, 222, 111, 111]);
  const hide = e.apply({ op: 'hide', sheet: sh.id, axis: 'row', i: 1, hidden: true });
  assert.deepEqual(read(), [101, 101, 202, 111, 101], 'row 2 hidden by hand');
  const filter = e.apply({ op: 'prop', sheet: sh.id, key: 'filter', value: { r0: 0, c0: 0, r1: 2, c1: 0 } });
  assert.deepEqual(read(), [101, 101, 202, 101, 101], 'row 2 now filtered out, which SUBTOTAL(9) skips too');
  e.apply(filter.inverse);
  e.apply(hide.inverse);
  assert.deepEqual(read(), [111, 111, 222, 111, 111]);
  e.apply({ op: 'batch', ops: [{ op: 'hide', sheet: sh.id, axis: 'row', i: 0, hidden: true }, { op: 'hide', sheet: sh.id, axis: 'row', i: 2, hidden: true }] });
  assert.deepEqual(read(), [10, 10, 20, 111, 10]);
});
