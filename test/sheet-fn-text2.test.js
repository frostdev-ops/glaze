// The remaining text functions (lib/sheet-fn-text2.js). Cases are the worked examples on Microsoft's page for each
// function, https://support.microsoft.com/en-us/excel/functions/<name>-function: textbefore, textafter, textsplit,
// textjoin, substitute, replace, rept, search, exact, proper, clean, char, code, unichar, unicode, dollar, fixed,
// numbervalue, valuetotext, arraytotext; FIND's page is retired, so its cases are from the Internet Archive's copy of
// https://support.microsoft.com/en-us/office/find-function-c7912941-af2a-4bdf-a553-d0d89b0a0628 (2025-11-26).
// Where a page's table is misprinted the data is the one its formulas and results need: TEXTBEFORE's first example has
// its sentences one row up, TEXTJOIN's second the empty row its ignore_empty=FALSE result shows, ARRAYTOTEXT's B4 the
// text "1,123" both its results print.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-text.js');
require('../lib/sheet-fn-text2.js');

// arrays: { 'D1:F2': formula } entered as array formulas, so a function's whole array result can be read back.
const book = (cells = {}, arrays = {}) => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  for (const [ref, input] of Object.entries(cells)) {
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input } : { t: 'n', v: input };
    M.apply(wb, { op: 'set', sheet: sh.id, r, c, cell: x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v } });
  }
  for (const [range, f] of Object.entries(arrays)) {
    const { r0, c0 } = M.rangePosition(range);
    M.apply(wb, { op: 'set', sheet: sh.id, r: r0, c: c0, cell: { t: 'n', v: 0, f, a: range } });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text) => out(e.evaluate(text, e.wb.sheets[0].id, 99, 25));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
const grid = (e, range) => {
  const { r0, c0, r1, c1 } = M.rangePosition(range);
  const rows = [];
  for (let r = r0; r <= r1; r++) { const row = []; for (let c = c0; c <= c1; c++) row.push(out(e.value(e.wb.sheets[0].id, r, c))); rows.push(row); }
  return rows;
};
// A formula's array result, read from an array formula over `range`.
const spill = (cells, f, range) => grid(book(cells, { [range]: f }), range);

const NAMES = 'TEXTBEFORE TEXTAFTER TEXTSPLIT TEXTJOIN SUBSTITUTE REPLACE REPT FIND FINDB SEARCH SEARCHB EXACT PROPER CLEAN CHAR CODE UNICHAR UNICODE DOLLAR FIXED NUMBERVALUE VALUETOTEXT ARRAYTOTEXT'.split(' ');

test('the text functions are registered', () => {
  assert.equal(NAMES.length, 23);
  for (const name of NAMES) assert.ok(C.fn(name), name);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-text2.js'), 'utf8')), 'no timers');
});

test('TEXTBEFORE and TEXTAFTER with Microsoft\'s data', () => {
  const e = book({ A2: 'Little Red Riding Hood\'s red hood', A3: 'Little red Riding Hood\'s red hood', B2: 'Marcus Aurelius', B3: 'Socrates', B4: 'Immanuel Kant', C1: ',', C2: ';' });
  cases(e, [
    ['TEXTBEFORE("Red riding hood\'s, red hood", "hood")', 'Red riding '], ['TEXTBEFORE("Red riding hood\'s, red hood", "")', ''],
    ['TEXTBEFORE("Red riding hood\'s, red hood", "", -1)', 'Red riding hood\'s, red hood'],
    ['TEXTBEFORE(A2,"Red")', 'Little '], ['TEXTBEFORE(A3,"Red")', '#N/A'], ['TEXTBEFORE(A3,"red",2)', 'Little red Riding Hood\'s '], ['TEXTBEFORE(A3,"red",-2)', 'Little '],
    ['TEXTBEFORE(A3,"Red",,FALSE)', '#N/A'], ['TEXTBEFORE(A3,"red",3)', '#N/A'],
    ['TEXTBEFORE(B2," ",,,1)', 'Marcus'], ['TEXTBEFORE(B3," ",,,0)', '#N/A'], ['TEXTBEFORE(B3," ",,,1)', 'Socrates'], ['TEXTBEFORE(B4," ",,,1)', 'Immanuel'],
    ['TEXTAFTER("Red riding hood\'s, red hood", "hood")', '\'s, red hood'], ['TEXTAFTER("Red riding hood\'s, red hood", "")', 'Red riding hood\'s, red hood'],
    ['TEXTAFTER("Red riding hood\'s, red hood", "", -1)', ''],
    ['TEXTAFTER(A2,"Red")', ' Riding Hood\'s red hood'], ['TEXTAFTER(A2,"basket")', '#N/A'], ['TEXTAFTER(A3,"red",2)', ' hood'], ['TEXTAFTER(A3,"red",-2)', ' Riding Hood\'s red hood'],
    ['TEXTAFTER(A3,"Red",,FALSE)', '#N/A'], ['TEXTAFTER(A2,"red",3)', '#N/A'],
    ['TEXTAFTER(B2," ",,,1)', 'Aurelius'], ['TEXTAFTER(B3," ",,,0)', '#N/A'], ['TEXTAFTER(B3," ",,,1)', ''],
    // instance_num 0 or longer than the text is #VALUE!; case-insensitive with 1; several delimiters; if_not_found.
    ['TEXTBEFORE(A3,"red",0)', '#VALUE!'], ['TEXTAFTER(A3,"red",40)', '#VALUE!'], ['TEXTBEFORE(A3,"RED",2,1)', 'Little red Riding Hood\'s '],
    ['TEXTBEFORE("a,b;c",{";",","},2)', 'a,b'], ['TEXTAFTER("a,b;c",C1:C2,-1)', 'c'], ['TEXTAFTER(A2,"basket",,,,"none")', 'none'], ['TEXTBEFORE("","x")', ''],
    ['TEXTBEFORE(B3," ",-1,,1)', ''], ['TEXTAFTER(B3," ",-1,,1)', 'Socrates'], ['TEXTBEFORE(A2,"Red",1,2)', '#VALUE!'],
  ]);
  assert.deepEqual(spill({ B2: 'Marcus Aurelius', B3: 'Socrates', B4: 'Immanuel Kant' }, 'TEXTBEFORE(B2:B4," ",,,1)', 'D2:D4'), [['Marcus'], ['Socrates'], ['Immanuel']]);
});

test('TEXTSPLIT with Microsoft\'s examples, read whole', () => {
  const A2 = 'Do. Or do not. There is no try. -Anonymous';
  assert.deepEqual(spill({ A2: 'Dakota Lennon Sanchez' }, 'TEXTSPLIT(A2, " ")', 'C1:E1'), [['Dakota', 'Lennon', 'Sanchez']]);
  assert.deepEqual(spill({ A3: 'To be or not to be' }, 'TEXTSPLIT(A3, " ")', 'C1:H1'), [['To', 'be', 'or', 'not', 'to', 'be']]);
  assert.deepEqual(spill({ A2: "'1,2,3;4,5,6" }, 'TEXTSPLIT(A2,",",";")', 'C1:E2'), [['1', '2', '3'], ['4', '5', '6']]);
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2,".")', 'C1:F1'), [['Do', ' Or do not', ' There is no try', ' -Anonymous']]);
  const five = [['Do', ' Or do not', ' There is no try', ' ', 'Anonymous']];
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2,{".","-"})', 'C1:G1'), five);
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2,{".","-"},,FALSE)', 'C1:G1'), five);
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2,,".")', 'C1:C4'), [['Do'], [' Or do not'], [' There is no try'], [' -Anonymous']]);
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2,,{".","-"})', 'C1:C5'), five[0].map((s) => [s]));
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2,,{".","-"},TRUE)', 'C1:C5'), five[0].map((s) => [s]));
  assert.deepEqual(spill({ A2 }, 'TEXTSPLIT(A2," ",".",TRUE)', 'C1:F4'), [
    ['Do', '#N/A', '#N/A', '#N/A'], ['Or', 'do', 'not', '#N/A'], ['There', 'is', 'no', 'try'], ['-Anonymous', '#N/A', '#N/A', '#N/A'],
  ]);
  // Empty pieces stay unless ignore_empty; ragged rows pad with pad_with; match_mode 1 ignores case.
  assert.deepEqual(spill({}, 'TEXTSPLIT("a,,b;c",",",";")', 'C1:E2'), [['a', '', 'b'], ['c', '#N/A', '#N/A']]);
  assert.deepEqual(spill({}, 'TEXTSPLIT("a,,b;c",",",";",TRUE,,"-")', 'C1:D2'), [['a', 'b'], ['c', '-']]);
  assert.deepEqual(spill({}, 'TEXTSPLIT("1x2X3","x",,,1)', 'C1:E1'), [['1', '2', '3']]);
  assert.deepEqual(spill({}, 'TEXTSPLIT("1x2X3","x")', 'C1:D1'), [['1', '2X3']]);
  const e = book({ A2 });
  cases(e, [['TEXTSPLIT(A2,"")', '#VALUE!'], ['TEXTSPLIT(A2,,)', '#VALUE!'], ['TEXTSPLIT(A2,".")', 'Do'], ['TEXTSPLIT(1/0,",")', '#DIV/0!']]);
});

test('TEXTJOIN with Microsoft\'s data: ignore_empty, a range of delimiters, the 32,767-character limit', () => {
  const e = book({
    A2: 'US Dollar', A3: 'Australian Dollar', A4: 'Chinese Yuan', A5: 'Hong Kong Dollar', A6: 'Israeli Shekel', A7: 'South Korean Won', A8: 'Russian Ruble',
    C2: 'a1', D2: 'b1', C3: 'a2', D3: 'b2', C5: 'a4', D5: 'b4', C6: 'a5', D6: 'b5', C7: 'a6', D7: 'b6', C8: 'a7', D8: 'b7',
    F2: 'Tulsa', G2: 'OK', H2: 74133, I2: 'US', F3: 'Seattle', G3: 'WA', H3: 98109, I3: 'US', F4: 'Iselin', G4: 'NJ', H4: "'08830", I4: 'US',
    F5: 'Fort Lauderdale', G5: 'FL', H5: 33309, I5: 'US', F6: 'Tempe', G6: 'AZ', H6: 85285, I6: 'US', F7: 'end', F8: ',', G8: ',', H8: ',', I8: ';',
    K1: 1.5, K2: '#N/A',
  });
  cases(e, [
    ['TEXTJOIN(", ", TRUE, A2:A8)', 'US Dollar, Australian Dollar, Chinese Yuan, Hong Kong Dollar, Israeli Shekel, South Korean Won, Russian Ruble'],
    ['TEXTJOIN(", ", TRUE, C2:D8)', 'a1, b1, a2, b2, a4, b4, a5, b5, a6, b6, a7, b7'],
    ['TEXTJOIN(", ", FALSE, C2:D8)', 'a1, b1, a2, b2, , , a4, b4, a5, b5, a6, b6, a7, b7'],
    ['TEXTJOIN(F8:I8, TRUE, F2:I7)', 'Tulsa,OK,74133,US;Seattle,WA,98109,US;Iselin,NJ,08830,US;Fort Lauderdale,FL,33309,US;Tempe,AZ,85285,US;end'],
    ['TEXTJOIN(" ",TRUE, "The", "sun", "will", "come", "up", "tomorrow.")', 'The sun will come up tomorrow.'],
    ['TEXTJOIN("-",FALSE,K1,TRUE,"",{1,2})', '1.5-TRUE--1-2'], ['TEXTJOIN("",TRUE,"a","b")', 'ab'], ['TEXTJOIN(",",TRUE,K1:K2)', '#N/A'],
    ['TEXTJOIN(1/0,TRUE,"a")', '#DIV/0!'], ['TEXTJOIN(",",TRUE,REPT("a",32767),"b")', '#VALUE!'],
  ]);
  assert.equal(calc(e, 'LEN(TEXTJOIN("",TRUE,REPT("a",32766),"b"))'), 32767);
});

test('SUBSTITUTE, REPLACE, REPT with Microsoft\'s data', () => {
  const e = book({ A2: 'Sales Data', A3: 'Quarter 1, 2008', A4: 'Quarter 1, 2011', B2: 'abcdefghijk', B3: 2009, B4: 123456 });
  cases(e, [
    ['SUBSTITUTE(A2, "Sales", "Cost")', 'Cost Data'], ['SUBSTITUTE(A3, "1", "2", 1)', 'Quarter 2, 2008'], ['SUBSTITUTE(A4, "1", "2", 3)', 'Quarter 1, 2012'],
    ['SUBSTITUTE(A4, "1", "2")', 'Quarter 2, 2022'], ['SUBSTITUTE("aaa","aa","b")', 'ba'], ['SUBSTITUTE("Data","data","x")', 'Data'], ['SUBSTITUTE("abc","","x")', 'abc'],
    ['SUBSTITUTE(A4,"1","2",4)', 'Quarter 1, 2011'], ['SUBSTITUTE(A4,"1","2",0)', '#VALUE!'], ['SUBSTITUTE(12321,2,"")', '131'],
    ['REPLACE(B2,6,5,"*")', 'abcde*k'], ['REPLACE(B3,3,2,"10")', '2010'], ['REPLACE(B4,1,3,"@")', '@456'], ['REPLACE("abc",10,1,"Z")', 'abcZ'], ['REPLACE("abc",2,0,"Z")', 'aZbc'],
    ['REPLACE("abc",0,1,"Z")', '#VALUE!'], ['REPLACE("abc",1,-1,"Z")', '#VALUE!'],
    ['REPT("*-", 3)', '*-*-*-'], ['REPT("-",10)', '----------'], ['REPT("ab",0)', ''], ['REPT("ab",2.9)', 'abab'], ['REPT("ab",-1)', '#VALUE!'], ['REPT("ab",16384)', '#VALUE!'],
    ['LEN(REPT("a",32767))', 32767],
  ]);
});

test('FIND, FINDB, SEARCH, SEARCHB with Microsoft\'s data', () => {
  const e = book({
    A2: 'Miriam McGovern', B2: 'Ceramic Insulators #124-TD45-87', B3: 'Copper Coils #12-671-6772', B4: 'Variable Resistors #116010',
    C2: 'Statements', C3: 'Profit Margin', C4: 'margin', C5: 'The "boss" is here.',
  });
  cases(e, [
    ['FIND("M",A2)', 1], ['FIND("m",A2)', 6], ['FIND("M",A2,3)', 8],
    ['MID(B2,1,FIND(" #",B2,1)-1)', 'Ceramic Insulators'], ['MID(B3,1,FIND(" #",B3,1)-1)', 'Copper Coils'], ['MID(B4,1,FIND(" #",B4,1)-1)', 'Variable Resistors'],
    ['FIND("",A2)', 1], ['FIND("",A2,5)', 5], ['FIND("z",A2)', '#VALUE!'], ['FIND("M",A2,0)', '#VALUE!'], ['FIND("M",A2,16)', '#VALUE!'], ['FIND("",A2,16)', '#VALUE!'], ['FIND("",A2,15)', 15], ['FIND("*",A2)', '#VALUE!'],
    ['FINDB("m",A2)', 6], ['FIND(1,12321,2)', 5],
    ['SEARCH("e",C2,6)', 7], ['SEARCH(C4,C3)', 8], ['REPLACE(C3,SEARCH(C4,C3),6,"Amount")', 'Profit Amount'], ['MID(C3,SEARCH(" ",C3)+1,4)', 'Marg'],
    ['SEARCH("""",C5)', 5], ['MID(C5,SEARCH("""",C5)+1,SEARCH("""",C5,SEARCH("""",C5)+1)-SEARCH("""",C5)-1)', 'boss'],
    ['SEARCH("M?r",C3)', 8], ['SEARCH("p*m",C3)', 1], ['SEARCH("~*","a*b")', 2], ['SEARCH("~?","a?b")', 2], ['SEARCH("x",C3)', '#VALUE!'], ['SEARCH("e",C2,11)', '#VALUE!'],
    ['SEARCH("e",C2,0)', '#VALUE!'], ['SEARCHB("MARGIN",C3)', 8], ['SEARCH("(",  "a(b")', 2],
  ]);
});

test('EXACT, PROPER, CLEAN, CHAR, CODE, UNICHAR, UNICODE with Microsoft\'s data', () => {
  const e = book({ A2: 'word', B2: 'word', A3: 'Word', B3: 'word', A4: 'w ord', B4: 'word', C2: 'this is a TITLE', C3: '2-way street', C4: '76BudGet', D2: '=CHAR(9)&"Monthly report"&CHAR(10)' });
  cases(e, [
    ['EXACT(A2,B2)', true], ['EXACT(A3,B3)', false], ['EXACT(A4,B4)', false], ['EXACT(1,"1")', true],
    ['PROPER(C2)', 'This Is A Title'], ['PROPER(C3)', '2-Way Street'], ['PROPER(C4)', '76Budget'], ['PROPER("don\'t")', 'Don\'T'], ['PROPER("élan VITAL")', 'Élan Vital'],
    ['CLEAN(D2)', 'Monthly report'], ['LEN(CLEAN(CHAR(127)&"a"))', 2],
    ['CHAR(65)', 'A'], ['CHAR(33)', '!'], ['CHAR(0)', '#VALUE!'], ['CHAR(256)', '#VALUE!'], ['CHAR(65.9)', 'A'], ['CHAR(128)', '€'], ['CHAR(150)', '–'], ['CHAR(151)', '—'], ['CODE("—")', 151], ['CODE("Ā")', 63], ['CHAR(233)', 'é'],
    ['CODE("A")', 65], ['CODE("!")', 33], ['CODE("Apple")', 65], ['CODE("")', '#VALUE!'], ['CODE("€")', 128], ['CODE(CHAR(200))', 200], ['CODE(CHAR(150))', 150],
    ['UNICHAR(66)', 'B'], ['UNICHAR(32)', ' '], ['UNICHAR(0)', '#VALUE!'], ['UNICHAR(55296)', '#N/A'], ['UNICHAR(1114112)', '#VALUE!'], ['UNICHAR(128512)', '😀'],
    ['UNICODE(" ")', 32], ['UNICODE("B")', 66], ['UNICODE("😀")', 128512], ['UNICODE("")', '#VALUE!'], ['UNICODE(UNICHAR(8364))', 8364],
  ]);
  for (let n = 1; n <= 255; n++) assert.equal(calc(e, `CODE(CHAR(${n}))`), n, `CHAR(${n}) reads back`);
});

test('DOLLAR, FIXED, NUMBERVALUE with Microsoft\'s data', () => {
  const e = book({ A2: 1234.567, A3: -1234.567, A4: -0.123, A5: 99.888, B4: 44.332 });
  cases(e, [
    ['DOLLAR(A2,2)', '$1,234.57'], ['DOLLAR(A3,-2)', '($1,200)'], ['DOLLAR(A4,4)', '($0.1230)'], ['DOLLAR(A5)', '$99.89'], ['DOLLAR(A2,0)', '$1,235'], ['DOLLAR(0)', '$0.00'],
    ['DOLLAR(A2,128)', '#VALUE!'], ['DOLLAR("x")', '#VALUE!'],
    ['FIXED(A2, 1)', '1,234.6'], ['FIXED(A2, -1)', '1,230'], ['FIXED(A3, -1, TRUE)', '-1230'], ['FIXED(B4)', '44.33'], ['FIXED(A2,0)', '1,235'], ['FIXED(1234567.891,2,TRUE)', '1234567.89'],
    ['FIXED(-0.001)', '0.00'], ['FIXED(A2,128)', '#VALUE!'],
    ['NUMBERVALUE("2.500,27",",",".")', 2500.27], ['NUMBERVALUE("3.5%")', 0.035], ['NUMBERVALUE("9%%")', 0.0009], ['NUMBERVALUE(" 3 000  ")', 3000], ['NUMBERVALUE("")', 0],
    ['NUMBERVALUE("1.2.3")', '#VALUE!'], ['NUMBERVALUE("1.000,5")', '#VALUE!'], ['NUMBERVALUE("1,000.5")', 1000.5], ['NUMBERVALUE("2.500,27",",;",".;")', 2500.27],
    ['NUMBERVALUE("abc")', '#VALUE!'], ['NUMBERVALUE("-1.5E3")', -1500], ['NUMBERVALUE(12)', 12], ['NUMBERVALUE("1,5",",",",")', '#VALUE!'],
  ]);
});

test('VALUETOTEXT and ARRAYTOTEXT with Microsoft\'s data', () => {
  const e = book({ A2: true, A3: 1234.01234, A4: 'Hello', A5: '#VALUE!', A6: 'Seattle', A7: 1234, B2: '#VALUE!', B3: 'Seattle', B4: "'1,123", C1: 'say "hi"' });
  const rows = [['A2', 'TRUE', 'TRUE'], ['A3', '1234.01234', '1234.01234'], ['A4', 'Hello', '"Hello"'], ['A5', '#VALUE!', '#VALUE!'], ['A6', 'Seattle', '"Seattle"'], ['A7', '1234', '1234']];
  for (const [ref, concise, strict] of rows) {
    assert.equal(calc(e, `VALUETOTEXT(${ref}, 0)`), concise, ref);
    assert.equal(calc(e, `VALUETOTEXT(${ref}, 1)`), strict, ref);
  }
  cases(e, [
    ['VALUETOTEXT(A4)', 'Hello'], ['VALUETOTEXT(C1,1)', '"say ""hi"""'], ['VALUETOTEXT(A4,2)', '#VALUE!'], ['VALUETOTEXT(1/3)', '0.333333333333333'], ['VALUETOTEXT(Z1)', ''],
    ['ARRAYTOTEXT(A2:B4,0)', 'TRUE, #VALUE!, 1234.01234, Seattle, Hello, 1,123'], ['ARRAYTOTEXT(A2:B4,1)', '{TRUE,#VALUE!;1234.01234,"Seattle";"Hello","1,123"}'],
    ['ARRAYTOTEXT(A2:B4)', 'TRUE, #VALUE!, 1234.01234, Seattle, Hello, 1,123'], ['ARRAYTOTEXT({1,2;3,"a"},1)', '{1,2;3,"a"}'], ['ARRAYTOTEXT(A4)', 'Hello'],
    ['ARRAYTOTEXT(A2:B4,2)', '#VALUE!'],
  ]);
});
