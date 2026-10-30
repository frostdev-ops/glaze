// Excel number formats (lib/sheet-numfmt.js). Expected strings are Excel's: Microsoft's "Number format codes" and
// "Review guidelines for customizing a number format" pages give most of these tables; the rest follow the rules those
// pages state (rounding to 15 significant digits first, the minus sign at the front, one section for every sign).
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/sheet-numfmt.js');

const table = (rows) => { for (const [fmt, v, want, opts] of rows) assert.equal(F.format(v, fmt, opts), want, `${JSON.stringify(fmt)} ${v}`); };

test('General fits 11 characters, then scientific', () => {
  table([
    ['General', 0, '0'], ['General', 1, '1'], ['General', -1, '-1'], ['General', 1234.5678, '1234.5678'],
    ['General', 0.1 + 0.2, '0.3'], ['General', 1 / 3, '0.333333333'], ['General', 2 / 3, '0.666666667'],
    ['General', 123456789012, '1.23457E+11'], ['General', 12345678901, '12345678901'], ['General', 99999999999, '99999999999'],
    ['General', 999999999999, '1E+12'], ['General', 1e20, '1E+20'], ['General', 1.5e300, '1.5E+300'],
    ['General', 0.0001, '0.0001'], ['General', 0.00001, '0.00001'], ['General', 0.000123456789, '0.000123457'],
    ['General', -0.0000123, '-0.0000123'], ['General', 1e-10, '1E-10'], ['General', 123456.123456789, '123456.1235'],
    ['General', 12345678.9012, '12345678.9'], ['General', -1234567.891, '-1234567.891'], ['General', -0, '0'],
    ['General', 'text', 'text'], ['General', true, 'TRUE'], ['General', false, 'FALSE'], ['General', null, ''],
  ]);
  assert.equal(F.general(1234.5678, 5), '1235', 'a narrow column keeps what fits');
  assert.equal(F.general(1 / 3, 5), '0.333');
  assert.equal(F.general(123456, 5), '1E+05');
});

test('a number as text carries 15 significant digits', () => {
  for (const [v, want] of [[1 / 3, '0.333333333333333'], [0.1 + 0.2, '0.3'], [1e15, '1000000000000000'], [123456789012345, '123456789012345'],
    [0.00001, '0.00001'], [0.0001, '0.0001'], [1234.5, '1234.5'], [-0, '0'], [2 ** 53, '9007199254740990'], [1e21, '1E+21'],
    [12345678901234567890, '12345678901234600000'], [-2.5, '-2.5'], [1e-300, '1E-300']]) assert.equal(F.numberText(v), want, String(v));
});

test('digit placeholders 0 # ? with the decimal point, thousands and scaling', () => {
  table([
    ['0', 1234.59, '1235'], ['0.00', 1234.567, '1234.57'], ['#,##0', 1234567, '1,234,567'], ['#,##0.00', 1234.5, '1,234.50'],
    ['#,##0.00', -1234.5, '-1,234.50'], ['####.#', 1234.59, '1234.6'], ['#.000', 8.9, '8.900'], ['0.#', 0.631, '0.6'],
    ['#.0#', 12, '12.0'], ['#.0#', 1234.568, '1234.57'], ['???.???', 44.398, ' 44.398'], ['???.???', 102.65, '102.65 '],
    ['???.???', 2.8, '  2.8  '], ['#,###', 12000, '12,000'], ['#,', 12000, '12'], ['0.0,,', 12200000, '12.2'],
    ['00000', 123, '00123'], ['#', 0, ''], ['0.##', 1, '1.'], ['#.00', 0.5, '.50'], ['0', 0.5, '1'], ['0', -0.5, '-1'],
    ['0', 2.5, '3'], ['0.00', 1.005, '1.01'], ['0.00', 2.675, '2.68'], ['0', -0.2, '0'], ['#,##0', 999.5, '1,000'],
    ['0.000', 1e-10, '0.000'], ['#,##0', 1e15, '1,000,000,000,000,000'], ['0', 123456789012345680000, '123456789012346000000'],
  ]);
});

test('percent, scientific and engineering notation', () => {
  table([
    ['0%', 0.08, '8%'], ['0.00%', 0.1234, '12.34%'], ['0.0%', 2.8, '280.0%'], ['0%', -0.5, '-50%'],
    ['0.00E+00', 12200000, '1.22E+07'], ['0.00E+00', 0.000012, '1.20E-05'], ['0.00E-00', 12200000, '1.22E07'],
    ['0.00E+00', -12200000, '-1.22E+07'], ['0.0E+0', 0, '0.0E+0'], ['0.00E+00', 9.999, '1.00E+01'],
    ['##0.0E+0', 12345, '12.3E+3'], ['##0.0E+0', 0.0012345, '1.2E-3'], ['##0.0E+0', 1234567, '1.2E+6'],
  ]);
});

test('literals: quoted text, backslash, the characters Excel shows as they are', () => {
  table([
    ['"$"#,##0.00', 1234.5, '$1,234.50'], ['"$"#,##0.00', -1234.5, '-$1,234.50'], ['\\$0.00', 1.5, '$1.50'],
    ['0.00 "km"', 12, '12.00 km'], ['(###) ###-####', 5551234567, '(555) 123-4567'], ['000-00-0000', 123456789, '123-45-6789'],
    ['000-00-0000', 12345, '000-01-2345'], ['"Total: "0', 7, 'Total: 7'], ['0" units"', 1, '1 units'], ['"-"', 5, '-'],
    ['#,##0.00_);(#,##0.00)', 1234.5, '1,234.50 '], ['#,##0.00_);(#,##0.00)', -1234.5, '(1,234.50)'], ['+0;-0;0', 3, '+3'],
    ['[$€-407]#,##0.00', 1234.5, '€1,234.50'], ['[$USD] 0', 5, 'USD 5'],
  ]);
});

test('sections: positive; negative; zero; text', () => {
  table([
    ['0.00;(0.00)', -5, '(5.00)'], ['0.00;(0.00)', 5, '5.00'], ['0.00;(0.00)', 0, '0.00'], ['0;-0;"zero"', 0, 'zero'],
    ['0;-0;"zero"', -3, '-3'], ['0;-0;0;"text: "@', 'abc', 'text: abc'], ['0.00', 'abc', 'abc'], ['0;-0;;@', 0, ''],
    ['0.0;-0.0', -0.04, '-0.0'], ['"pos";"neg";"zero";"text"', -1, 'neg'], ['@', 123, '123'], ['@', 'abc', 'abc'],
    ['"Item: "@', 'abc', 'Item: abc'], ['@@', 'ab', 'abab'], ['0;0', -7, '7'], ['General;-General', -7, '-7'],
    ['0', true, 'TRUE'], ['0.00', '#N/A', '#N/A'],
  ]);
});

test('colours and conditions pick the section and its colour', () => {
  assert.deepEqual(F.render(-1, '0.00;[Red]-0.00'), { text: '-1.00', color: '#FF0000', fill: null });
  assert.deepEqual(F.render(1, '0.00;[Red]-0.00'), { text: '1.00', color: null, fill: null });
  assert.equal(F.render(5, '[Blue]0').color, '#0000FF');
  assert.equal(F.render(5, '[color 10]0').color, F.PALETTE[9]);
  assert.equal(F.PALETTE.length, 56);
  assert.equal(F.PALETTE[2], '#FF0000');
  table([
    ['[<=100]"low";[>100]"high"', 50, 'low'], ['[<=100]"low";[>100]"high"', 150, 'high'],
    ['[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 1234567, '1.2M'], ['[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 12345, '12.3K'],
    ['[>=1000000]0.0,,"M";[>=1000]0.0,"K";0', 999, '999'], ['[Red][<=100]0;[Blue][>100]0', 150, '150'],
    ['[<0]"neg "0;0', -5, 'neg 5'],
  ]);
  assert.equal(F.render(50, '[Red][<=100]0;[Blue][>100]0').color, '#FF0000');
});

test('fill (*) and padding (_) are kept for the grid and dropped from text', () => {
  const acct = '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)';
  assert.equal(F.format(1234.5, acct), ' $1,234.50 ');
  assert.equal(F.format(-1234.5, acct), ' $(1,234.50)');
  assert.equal(F.format(0, acct), ' $-   ');
  assert.equal(F.format('x', acct), ' x ');
  assert.deepEqual(F.render(1234.5, acct).fill, { at: 2, ch: ' ' }, 'the fill repeats at text index 2');
  assert.equal(F.format(5, '0*-'), '5');
});

test('fractions', () => {
  table([
    ['# ?/?', 1.25, '1 1/4'], ['# ?/?', 1.5, '1 1/2'], ['# ???/???', 5.25, '5   1/4  '], ['# ???/???', 5.3, '5   3/10 '],
    ['?/?', 0.5, '1/2'], ['?/?', 1.5, '3/2'], ['# ?/8', 1.375, '1 3/8'], ['# ??/??', 3.14159, '3 14/99'],
    ['# ?/?', 2, '2    '], ['# ?/?', 0.999, '1    '], ['# ?/?', -1.25, '-1 1/4'], ['0 ?/?', 0.25, '0 1/4'],
    ['# ??/100', 0.5, ' 50/100'],
  ]);
});

test('dates and times', () => {
  const day = 45720; // 2025-03-04, a Tuesday
  table([
    ['m/d/yyyy', day, '3/4/2025'], ['mm/dd/yy', day, '03/04/25'], ['d-mmm-yy', day, '4-Mar-25'],
    ['dddd, mmmm d, yyyy', day, 'Tuesday, March 4, 2025'], ['ddd', day, 'Tue'], ['mmmmm', day, 'M'], ['yyyy-mm-dd', day, '2025-03-04'],
    ['h:mm AM/PM', day + 0.5625, '1:30 PM'], ['hh:mm:ss', day + 0.5625, '13:30:00'], ['h:mm', 0.5625, '13:30'],
    ['h:mm A/P', 0.5625, '1:30 P'], ['h:mm a/p', 0.25, '6:00 a'], ['h AM/PM', 0, '12 AM'], ['h AM/PM', 0.5, '12 PM'],
    ['[h]:mm', 1.5, '36:00'], ['[mm]:ss', 0.0625, '90:00'], ['[h]:mm:ss', 2.5, '60:00:00'], ['[ss]', 0.001, '86'],
    ['mm:ss', 0.5 + 75 / 86400, '01:15'], ['hh:mm:ss.00', 0.5 + 1.25 / 86400, '12:00:01.25'], ['mm:ss.0', 0.5 + 0.06 / 86400, '00:00.1'],
    ['m/d/yyyy', 60, '2/29/1900'], ['m/d/yyyy', 0, '1/0/1900'], ['m/d/yyyy', 61, '3/1/1900'], ['m/d/yyyy', 1, '1/1/1900'],
    ['m/d/yyyy', 0, '1/1/1904', { date1904: true }], ['General', day, '45720'], ['yy', 1, '00'],
    ['m/d/yyyy h:mm:ss', day + 0.999999999, '3/5/2025 0:00:00'], ['h:mm', 0.5 + 59.6 / 86400, '12:01'],
    ['h:mm:ss', 0.5 + 59.6 / 86400, '12:01:00'], ['[$-409]h:mm AM/PM', 0.75, '6:00 PM'], ['dd"th"', day, '04th'],
    ['mmm d', 'Mar', 'Mar'], ['yyyy;@', 'x', 'x'], ['d\\-m', day, '4-3'],
  ]);
  assert.equal(F.format(-1, 'm/d/yyyy'), null, 'no date before the epoch');
  assert.equal(F.format(2958466, 'yyyy'), null, 'none after 9999');
});

test('built-in format ids 0-49 are kept as ids', () => {
  assert.equal(F.builtin(0), 'General');
  assert.equal(F.builtin(1), '0');
  assert.equal(F.builtin(10), '0.00%');
  assert.equal(F.builtin(14), 'm/d/yyyy');
  assert.equal(F.builtin(22), 'm/d/yyyy h:mm');
  assert.equal(F.builtin(44), '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)');
  assert.equal(F.builtin(49), '@');
  assert.equal(F.builtin(30), 'General', 'an id this locale leaves undefined reads as General');
  assert.equal(F.builtin(164), null);
  assert.equal(F.idOf('0.00%'), 10);
  assert.equal(F.idOf('m/d/yyyy'), 14);
  assert.equal(F.idOf('0.000'), null);
  assert.equal(F.code(14), 'm/d/yyyy');
  assert.equal(F.code('0.0'), '0.0');
  assert.equal(F.code(undefined), 'General');
  assert.equal(F.format(45720, 14), '3/4/2025', 'an id formats as its code');
  for (const id of [14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47, '[h]:mm', 'yyyy;@', '[$-409]mmm d']) assert.equal(F.isDate(id), true, String(id));
  for (const id of [0, 1, 9, 11, 12, 49, '"y"0', '[Red]0', '0.00E+00', '@', '\\d0', '[>5]0']) assert.equal(F.isDate(id), false, String(id));
});

test('a malformed code throws; TEXT turns that into #VALUE!', () => {
  for (const bad of ['"open', '0;0;0;0;0', '[Purple]0', '[h', '0.0E']) assert.throws(() => F.format(1, bad), (e) => e.code === 'format', bad);
});

// Formula-only oracle: Excel for Mac 16.114.1, 2026-10-30. TEXT(...,"General") and value&"".
test('Excel scientific boundaries differ between General and number-to-text coercion', () => {
  assert.equal(F.general(1e-9), '0.000000001');
  assert.equal(F.general(1e-10), '1E-10');
  assert.equal(F.numberText(1e-18), '0.000000000000000001');
  assert.equal(F.numberText(1e-19), '1E-19');
  assert.equal(F.numberText(1e19), '10000000000000000000');
  assert.equal(F.numberText(1e20), '1E+20');
  assert.equal(F.format(0.5 + 59.4 / 86400, 'h:mm'), '12:00');
  assert.equal(F.format(0.5 + 59.6 / 86400, '[h]:mm'), '12:01');
  assert.equal(F.format(0.25, '# ?/?'), ' 1/4');
});

// Microsoft number-format guidelines; conditional signs and comma placement also checked in Excel 16.114.1.
test('conditional fallback keeps the sign and scaling commas may precede the decimal point', () => {
  table([
    ['[>100]0;0', -5, '-5'], ['[<0]0', -5, '5'], ['[>100]0;[<-100]0;0', -5, '-5'],
    ['0,,.0', 12000000, '12.0'], ['0,.00', 12000, '12.00'],
  ]);
});

test('fraction approximation work does not grow with the denominator limit', () => {
  const original = Math.round;
  let calls = 0;
  Math.round = (v) => {
    if (++calls > 1000) throw new Error('denominator scan exceeded 1000 candidates');
    return original(v);
  };
  try { assert.equal(typeof F.format(0.123456789, '# ?????????/?????????'), 'string'); }
  finally { Math.round = original; }
});

// Excel 16.114.1, in cells and through TEXT alike: a negative number that shows as zero shows no minus sign.
test('a negative number shown as zero has no minus sign', () => {
  table([
    ['0', -0.4, '0'], ['0.0', -0.04, '0.0'], ['#', -0.4, ''], ['0%', -0.004, '0%'], ['0.0', -0.4, '-0.4'], ['0%', -0.4, '-40%'],
    ['0E+00', -0.4, '-4E-01'], ['0;(0)', -0.4, '(0)'], ['General', -1, '-1'],
  ]);
});
