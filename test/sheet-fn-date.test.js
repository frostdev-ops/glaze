// Date and time functions (lib/sheet-fn-date.js). Function cases are the worked examples on Microsoft's page for each
// function, support.microsoft.com/en-us/excel/functions/<name>-function (date, time, datevalue, timevalue, year, month,
// day, hour, minute, second, weekday, weeknum, isoweeknum, days, days360, edate, eomonth, networkdays,
// networkdays-intl, workday, workday-intl, yearfrac, datedif, now, today), with their data; a date the page gives as a
// date is checked as its serial from Date.UTC. Edge cases follow the rules those pages state, the 1900-02-29 serial,
// and 1904 workbooks. Excel's results beyond Microsoft's pages come from two reimplementations that record them: David
// A. Wheeler's YEARFRAC test data from Excel 2007 (dwheeler.com/yearfrac, calc_yearfrac.py, 2008), and the comments
// in LibreOffice's sc/source/core/tool/interpr2.cxx (ScGetDiffDate360, ScGetDateDif).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-text.js');
require('../lib/sheet-fn-date.js');

// June 15, 2011, 9:30 AM on the machine's clock: DATEVALUE("5-JUL")'s example assumes the clock says 2011.
const CLOCK = new Date(2011, 5, 15, 9, 30, 0).getTime();
const book = (cells = {}, { date1904 = false, now = () => CLOCK } = {}) => {
  const wb = M.workbook({ date1904 });
  for (const [at, input] of Object.entries(cells)) {
    const [r, c] = M.cellPosition(at);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2011, date1904 }) : { t: 'n', v: input };
    const cell = x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v };
    M.apply(wb, { op: 'set', sheet: wb.sheets[0].id, r, c, cell });
  }
  const e = C.engine(wb, { now });
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text, at = 'Z100') => out(e.evaluate(text, e.wb.sheets[0].id, ...M.cellPosition(at)));
const val = (e, at) => out(e.value(e.wb.sheets[0].id, ...M.cellPosition(at)));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
const near = (e, rows, tol = 1e-8) => {
  for (const [f, want] of rows) { const got = calc(e, f); assert.ok(typeof got === 'number' && Math.abs(got - want) <= tol, `${f}: ${got} ≉ ${want}`); }
};
// The 1900 system's serial for a date from 1900-03-01 on, counted independently of the model.
const serial = (y, m, d) => (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5;

const NAMES = 'DATE TIME DATEVALUE TIMEVALUE YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM ISOWEEKNUM DAYS DAYS360 EDATE EOMONTH NETWORKDAYS NETWORKDAYS.INTL WORKDAY WORKDAY.INTL YEARFRAC DATEDIF NOW TODAY'.split(' ');

test('the date functions are registered, NOW and TODAY volatile, and nothing sets a timer', () => {
  for (const name of NAMES) assert.ok(C.fn(name), name);
  assert.ok(C.fn('NOW').volatile && C.fn('TODAY').volatile);
  assert.ok(!C.fn('DATE').volatile);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-date.js'), 'utf8')));
});

test('DATE: years 0-1899 count from 1900, months and days roll over and back, out of range is #NUM!', () => {
  const e = book({ A2: 3, B2: 14, C2: 2012, C3: '3/14/2012', C4: "'20140314" });
  cases(e, [
    ['DATE(C2,A2,B2)', 40982], ['DATE(YEAR(C3)+5,MONTH(C3),DAY(C3))', serial(2017, 3, 14)], ['DATE(LEFT(C4,4),MID(C4,5,2),RIGHT(C4,2))', serial(2014, 3, 14)],
    ['DATE(108,1,2)', serial(2008, 1, 2)], ['DATE(2008,1,2)', serial(2008, 1, 2)], ['DATE(2008,1,1)', 39448],
    ['DATE(2008,14,2)', serial(2009, 2, 2)], ['DATE(2008,-3,2)', serial(2007, 9, 2)], ['DATE(2008,1,35)', serial(2008, 2, 4)], ['DATE(2008,1,-15)', serial(2007, 12, 16)],
    ['DATE(2008,0,1)', serial(2007, 12, 1)], ['DATE(2008,12,32)', serial(2009, 1, 1)], ['DATE(2008,2,30)', serial(2008, 3, 1)], ['DATE(2008.9,1.9,2.9)', serial(2008, 1, 2)],
    ['DATE(-1,1,1)', '#NUM!'], ['DATE(10000,1,1)', '#NUM!'], ['DATE(9999,12,31)', 2958465], ['DATE(9999,12,32)', '#NUM!'], ['DATE(1899,1,1)', serial(3799, 1, 1)],
    ['DATE("2008","1","2")', serial(2008, 1, 2)], ['DATE("x",1,1)', '#VALUE!'], ['DATE(1/0,1,1)', '#DIV/0!'],
  ]);
});

test('TIME: hours past 23 wrap, minutes and seconds carry, the result is a fraction of a day', () => {
  const e = book({ A2: 12, B2: 0, C2: 0, A3: 16, B3: 48, C3: 10 });
  cases(e, [['TIME(A2,B2,C2)', 0.5], ['TIME(27,0,0)', 0.125], ['TIME(0,750,0)', calc(e, 'TIME(12,30,0)')], ['TIME(0,0,2000)', calc(e, 'TIME(0,33,20)')],
    ['TIME(24,0,0)', 0], ['TIME(1,-30,0)', 1 / 48], ['TIME(0,-1,0)', '#NUM!'], ['TIME(1.9,0,0)', 1 / 24]]);
  near(e, [['TIME(A3,B3,C3)', 0.7001157], ['TIME(0,750,0)', 0.520833], ['TIME(0,0,2000)', 0.023148]], 1e-6);
  assert.equal(calc(e, 'TIME(23,59,59)'), 86399 / 86400);
});

test('DATEVALUE and TIMEVALUE read en-US date and time text as typed input does', () => {
  const e = book({ A2: 11, A3: 3, A4: 2011, B1: '8/22/2011' });
  cases(e, [
    ['DATEVALUE("8/22/2011")', 40777], ['DATEVALUE("22-MAY-2011")', 40685], ['DATEVALUE("2011/02/23")', 40597], ['DATEVALUE("5-JUL")', serial(2011, 7, 5)],
    ['DATEVALUE(A2&"/"&A3&"/"&A4)', 40850], ['DATEVALUE("1/1/2008")', 39448], ['DATEVALUE("1/30/2008")', serial(2008, 1, 30)], ['DATEVALUE("30-Jan-2008")', serial(2008, 1, 30)],
    ['DATEVALUE("8/22/2011 6:35 AM")', 40777], ['DATEVALUE("12/31/9999")', 2958465], ['DATEVALUE("12/31/1899")', '#VALUE!'], ['DATEVALUE("2/30/2011")', '#VALUE!'],
    ['DATEVALUE("abc")', '#VALUE!'], ['DATEVALUE("1,200")', '#VALUE!'], ['DATEVALUE(40777)', '#VALUE!'], ['DATEVALUE(B1)', '#VALUE!'],
    ['TIMEVALUE("2:24 AM")', 0.1], ['TIMEVALUE("18:45")', 0.78125], ['TIMEVALUE("6:45 PM")', 0.78125], ['TIMEVALUE("22-Aug-2011 6:35 AM")', 395 / 1440],
    ['TIMEVALUE("8/22/2011")', 0], ['TIMEVALUE("abc")', '#VALUE!'], ['TIMEVALUE("0.5")', '#VALUE!'], ['TIMEVALUE(0.5)', '#VALUE!'],
  ]);
  near(e, [['TIMEVALUE("22-Aug-2011 6:35 AM")', 0.2743]], 1e-4);
  // The page's 39634 is July 5, 2008: what a clock in 2008 gives.
  assert.equal(calc(book({}, { now: () => new Date(2008, 0, 2).getTime() }), 'DATEVALUE("5-JUL")'), 39634, 'a date without a year takes the engine clock\'s');
});

test('YEAR, MONTH, DAY, HOUR, MINUTE, SECOND', () => {
  const e = book({ A3: '7/5/2023', A4: '7/5/2025', B2: '15-Apr-11', C2: 0.75, C3: '7/18/2011 7:45', C4: '4/21/2012', D2: '12:45:00 PM', D3: '4:48:18 PM', D4: '4:48 PM' });
  cases(e, [
    ['YEAR(A3)', 2023], ['YEAR(A4)', 2025], ['MONTH(B2)', 4], ['DAY(B2)', 15], ['YEAR(DATE(2025,5,23))', 2025], ['MONTH(DATE(2008,5,23))', 5], ['DAY(DATE(2008,5,23))', 23],
    ['HOUR(C2)', 18], ['HOUR(C3)', 7], ['HOUR(C4)', 0], ['MINUTE(D2)', 45], ['SECOND(D3)', 18], ['SECOND(D4)', 0],
    ['HOUR("6:45 PM")', 18], ['HOUR(0.78125)', 18], ['HOUR(TIMEVALUE("6:45 PM"))', 18], ['MINUTE(0.78125)', 45],
    ['SECOND(TIME(16,48,18))', 18], ['MINUTE(TIME(10,59,59))', 59], ['HOUR(TIME(23,59,59))', 23], ['HOUR(45000.75)', 18],
    ['YEAR(45720.99)', 2025], ['DAY(45720.99)', 4], ['YEAR(2958465)', 9999], ['YEAR(2958466)', '#NUM!'], ['YEAR(-1)', '#NUM!'], ['HOUR(-0.5)', '#NUM!'],
    ['YEAR("x")', '#VALUE!'], ['YEAR(Z1)', 1900], ['MONTH(Z1)', 1], ['DAY(Z1)', 0],
  ]);
});

test('WEEKDAY: every return_type, out of range is #NUM!', () => {
  const e = book({ A2: '2/14/2008' });
  cases(e, [
    ['WEEKDAY(A2)', 5], ['WEEKDAY(A2,2)', 4], ['WEEKDAY(A2,3)', 3], ['WEEKDAY(A2,1)', 5], ['WEEKDAY(A2,11)', 4], ['WEEKDAY(A2,12)', 3], ['WEEKDAY(A2,13)', 2],
    ['WEEKDAY(A2,14)', 1], ['WEEKDAY(A2,15)', 7], ['WEEKDAY(A2,16)', 6], ['WEEKDAY(A2,17)', 5], ['WEEKDAY(A2+3,3)', 6], ['WEEKDAY(A2+4,3)', 0],
    ['WEEKDAY(A2,4)', '#NUM!'], ['WEEKDAY(A2,0)', '#NUM!'], ['WEEKDAY(A2,18)', '#NUM!'], ['WEEKDAY(-1)', '#NUM!'], ['WEEKDAY("2/14/2008")', 5],
  ]);
});

test('WEEKNUM (system 1 for each start day, 21 for ISO) and ISOWEEKNUM', () => {
  const e = book({ A2: '3/9/2012' });
  cases(e, [
    ['WEEKNUM(A2)', 10], ['WEEKNUM(A2,2)', 11], ['ISOWEEKNUM(A2)', 10], ['WEEKNUM(A2,21)', 10],
    ['WEEKNUM(A2,1)', 10], ['WEEKNUM(A2,11)', 11], ['WEEKNUM(A2,12)', 11], ['WEEKNUM(A2,13)', 11], ['WEEKNUM(A2,14)', 11], ['WEEKNUM(A2,15)', 11], ['WEEKNUM(A2,16)', 10], ['WEEKNUM(A2,17)', 10],
    ['WEEKNUM(DATE(2012,1,1))', 1], ['WEEKNUM(DATE(2012,1,7))', 1], ['WEEKNUM(DATE(2012,1,8))', 2], ['WEEKNUM(DATE(2012,1,2),2)', 2], ['WEEKNUM(DATE(2012,1,3),12)', 2],
    ['WEEKNUM(DATE(2012,12,31))', 53], ['WEEKNUM(A2,3)', '#NUM!'], ['WEEKNUM(A2,22)', '#NUM!'], ['WEEKNUM(-1)', '#NUM!'],
    ['ISOWEEKNUM(DATE(2012,1,1))', 52], ['ISOWEEKNUM(DATE(2012,1,2))', 1], ['ISOWEEKNUM(DATE(2012,12,31))', 1], ['ISOWEEKNUM(DATE(2015,12,28))', 53],
    ['ISOWEEKNUM(DATE(2016,1,1))', 53], ['WEEKNUM(DATE(2016,1,1),21)', 53], ['ISOWEEKNUM(DATE(2016,1,4))', 1], ['ISOWEEKNUM(DATE(2021,1,3))', 53], ['ISOWEEKNUM("x")', '#VALUE!'],
  ]);
});

test('DAYS, and DAYS360 by the U.S. and European methods', () => {
  const e = book({ A2: '31-DEC-2021', A3: '1-JAN-2021', B2: '1-Jan-11', B3: '30-Jan-11', B4: '1-Feb-11', B5: '31-Dec-11' });
  cases(e, [
    ['DAYS("15-MAR-2021","1-FEB-2021")', 42], ['DAYS(A2,A3)', 364], ['DAYS(A3,A2)', -364], ['DAYS(A2+0.9,A3)', 364], ['DAYS("x",A3)', '#VALUE!'], ['DAYS(-1,A3)', '#NUM!'],
    ['DAYS360(B3,B4)', 1], ['DAYS360(B2,B5)', 360], ['DAYS360(B2,B4)', 30], ['DAYS360(B4,B3)', -1],
    ['DAYS360(DATE(2011,1,31),DATE(2011,3,31))', 60], ['DAYS360(DATE(2011,1,31),DATE(2011,3,31),TRUE)', 60],
    ['DAYS360(DATE(2011,1,15),DATE(2011,3,31))', 76], ['DAYS360(DATE(2011,1,15),DATE(2011,3,31),TRUE)', 75],
    ['DAYS360(DATE(2011,1,30),DATE(2011,3,31))', 60], ['DAYS360(DATE(2011,1,29),DATE(2011,3,31))', 62],
    ['DAYS360(DATE(2011,2,28),DATE(2011,3,31))', 30], ['DAYS360(DATE(2011,2,28),DATE(2011,3,31),TRUE)', 32],
    ['DAYS360(DATE(2012,2,29),DATE(2012,3,31))', 30], ['DAYS360(DATE(2012,2,28),DATE(2012,3,31))', 33],
    ['DAYS360(DATE(2011,1,31),DATE(2011,2,28))', 28], ['DAYS360(DATE(2011,1,31),DATE(2011,2,28),TRUE)', 28], ['DAYS360("x",B5)', '#VALUE!'],
    // Excel's, as LibreOffice records them: the U.S. method doesn't swap a later start, so it isn't symmetric.
    ['DAYS360(DATE(1995,2,28),DATE(1995,8,31))', 180], ['DAYS360(DATE(1996,2,29),DATE(1996,8,31))', 180], ['DAYS360(DATE(1996,1,30),DATE(1996,3,31))', 60],
    ['DAYS360(DATE(1996,1,31),DATE(1996,3,31))', 60], ['DAYS360(DATE(1999,2,2),DATE(2000,3,31))', 419], ['DAYS360(DATE(2000,3,31),DATE(1999,2,2))', -418],
  ]);
});

test('EDATE and EOMONTH: a shorter month takes its last day; past the date range is #NUM!', () => {
  const e = book({ A2: '15-Jan-11', B2: '1-Jan-11' });
  cases(e, [
    ['EDATE(A2,1)', serial(2011, 2, 15)], ['EDATE(A2,-1)', serial(2010, 12, 15)], ['EDATE(A2,2)', serial(2011, 3, 15)], ['EDATE(A2,1.9)', serial(2011, 2, 15)],
    ['EDATE(A2,-1.9)', serial(2010, 12, 15)], ['EDATE(DATE(2011,1,31),1)', serial(2011, 2, 28)], ['EDATE(DATE(2012,1,31),1)', serial(2012, 2, 29)],
    ['EDATE(DATE(2011,3,31),-1)', serial(2011, 2, 28)], ['EDATE(DATE(2011,3,31),12)', serial(2012, 3, 31)], ['EDATE(A2+0.5,0)', serial(2011, 1, 15)],
    ['EDATE(DATE(9999,12,1),1)', '#NUM!'], ['EDATE(DATE(1900,1,1),-1)', '#NUM!'], ['EDATE("x",1)', '#VALUE!'], ['EDATE(-1,1)', '#NUM!'],
    ['EOMONTH(B2,1)', serial(2011, 2, 28)], ['EOMONTH(B2,-3)', serial(2010, 10, 31)], ['EOMONTH(B2,1)', 40602], ['EOMONTH(B2,-3)', 40482],
    ['EOMONTH(DATE(2012,2,10),0)', serial(2012, 2, 29)], ['EOMONTH(DATE(2011,1,15),-1.9)', serial(2010, 12, 31)], ['EOMONTH(DATE(2011,12,31),2)', serial(2012, 2, 29)],
    ['EOMONTH(DATE(9999,12,1),1)', '#NUM!'], ['EOMONTH(DATE(9999,12,1),0)', 2958465], ['EOMONTH(-1,0)', '#NUM!'],
  ]);
});

test('NETWORKDAYS and NETWORKDAYS.INTL: weekend codes and strings, holidays from ranges and arrays', () => {
  const e = book({ A2: '10/1/2012', A3: '3/1/2013', A4: '11/22/2012', A5: '12/4/2012', A6: '1/21/2013', B1: '11/24/2012', C1: 'x' });
  cases(e, [
    ['NETWORKDAYS(A2,A3)', 110], ['NETWORKDAYS(A2,A3,A4)', 109], ['NETWORKDAYS(A2,A3,A4:A6)', 107], ['NETWORKDAYS(A3,A2,A4:A6)', -107],
    ['NETWORKDAYS(A2,A3,B1)', 110], ['NETWORKDAYS(A2,A3,{"11/22/2012","11/22/2012"})', 109], ['NETWORKDAYS(A2,A3,A4:A7)', 107], ['NETWORKDAYS(A2,A3,A2:A6)', 105], ['NETWORKDAYS(A2,A2)', 1],
    ['NETWORKDAYS(DATE(2012,10,6),DATE(2012,10,7))', 0], ['NETWORKDAYS(A2+0.7,A3)', 110], ['NETWORKDAYS("x",A3)', '#VALUE!'], ['NETWORKDAYS(A2,A3,C1)', '#VALUE!'],
    ['NETWORKDAYS(A2,A3,1/0)', '#DIV/0!'],
    ['NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,1,31))', 22], ['NETWORKDAYS.INTL(DATE(2006,2,28),DATE(2006,1,31))', -21],
    ['NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),7,{"2006/1/2","2006/1/16"})', 22], ['NETWORKDAYS.INTL(DATE(2006,1,1),DATE(2006,2,1),"0010001",{"2006/1/2","2006/1/16"})', 20],
    ['NETWORKDAYS.INTL(A2,A3,1,A4:A6)', 107], ['NETWORKDAYS.INTL(A2,A3,"0000011",A4:A6)', 107], ['NETWORKDAYS.INTL(A2,A3,"1111111")', 0],
    ['NETWORKDAYS.INTL(A2,A3,"000001")', '#VALUE!'], ['NETWORKDAYS.INTL(A2,A3,"0000021")', '#VALUE!'], ['NETWORKDAYS.INTL(-1,A3)', '#NUM!'], ['NETWORKDAYS.INTL(A2,-1)', '#NUM!'],
  ]);
  // Monday, January 2, 2012, alone and through its week, under every weekend number.
  for (const code of [1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16, 17]) {
    assert.equal(calc(e, `NETWORKDAYS.INTL(DATE(2012,1,2),DATE(2012,1,2),${code})`), [2, 3, 12].includes(code) ? 0 : 1, `Monday under ${code}`);
    assert.equal(calc(e, `NETWORKDAYS.INTL(DATE(2012,1,2),DATE(2012,1,8),${code})`), code < 10 ? 5 : 6, `a week under ${code}`);
  }
  for (const [mask, monday] of [['1000000', 0], ['0100000', 1], ['0000001', 1]]) assert.equal(calc(e, `NETWORKDAYS.INTL(DATE(2012,1,2),DATE(2012,1,2),"${mask}")`), monday, mask);
});

test('WORKDAY and WORKDAY.INTL', () => {
  const e = book({ A2: '10/1/2008', A3: 151, A4: '11/26/2008', A5: '12/4/2008', A6: '1/21/2009' });
  cases(e, [
    ['WORKDAY(A2,A3)', serial(2009, 4, 30)], ['WORKDAY(A2,A3,A4:A6)', serial(2009, 5, 5)], ['WORKDAY(A2,A3)', 39933], ['WORKDAY(A2,A3,A4:A6)', 39938],
    ['WORKDAY(A2,A3+0.9)', 39933], ['WORKDAY(DATE(2012,1,9),-1)', serial(2012, 1, 6)], ['WORKDAY(DATE(2012,1,7),0)', serial(2012, 1, 7)], ['WORKDAY(DATE(2012,1,6),1)', serial(2012, 1, 9)],
    ['WORKDAY(DATE(2012,1,7),1)', serial(2012, 1, 9)], ['WORKDAY(DATE(2012,1,7),-1)', serial(2012, 1, 6)], ['WORKDAY(DATE(2012,1,6),1,DATE(2012,1,9))', serial(2012, 1, 10)],
    ['WORKDAY(DATE(9999,12,30),5)', '#NUM!'], ['WORKDAY("x",1)', '#VALUE!'],
    ['WORKDAY.INTL(DATE(2012,1,1),30,0)', '#NUM!'], ['WORKDAY.INTL(DATE(2012,1,1),90,11)', 41013], ['TEXT(WORKDAY.INTL(DATE(2012,1,1),30,17),"m/dd/yyyy")', '2/05/2012'],
    ['WORKDAY.INTL(DATE(2012,1,1),30,17)', 40944], ['WORKDAY.INTL(DATE(2012,1,1),30,"0000011")', calc(e, 'WORKDAY(DATE(2012,1,1),30)')], ['WORKDAY.INTL(A2,A3,,A4:A6)', 39938],
    ['WORKDAY.INTL(DATE(2012,1,1),5,"1111111")', '#VALUE!'], ['WORKDAY.INTL(DATE(2012,1,1),5,"111111")', '#VALUE!'], ['WORKDAY.INTL(DATE(2012,1,1),5,1,-1)', '#NUM!'],
    ['WORKDAY.INTL(-1,5)', '#NUM!'], ['WORKDAY.INTL(DATE(2012,1,3),1,"0011000")', serial(2012, 1, 6)], ['WORKDAY.INTL(DATE(2012,1,6),1,"0011000")', serial(2012, 1, 7)],
  ]);
});

test('YEARFRAC: all five bases, leap years, the U.S. end-of-February rule', () => {
  const e = book({ A2: '1/1/2012', A3: '7/30/2012' });
  near(e, [['YEARFRAC(A2,A3)', 0.58055556], ['YEARFRAC(A2,A3,1)', 0.57650273], ['YEARFRAC(A2,A3,3)', 0.57808219]]);
  near(e, [
    ['YEARFRAC(A2,A3,0)', 209 / 360], ['YEARFRAC(A2,A3,1)', 211 / 366], ['YEARFRAC(A2,A3,2)', 211 / 360], ['YEARFRAC(A2,A3,3)', 211 / 365], ['YEARFRAC(A2,A3,4)', 209 / 360],
    ['YEARFRAC(A3,A2,1)', 211 / 366], ['YEARFRAC(A2+0.9,A3+0.2)', 209 / 360], ['YEARFRAC(A2,A3,1.7)', 211 / 366],
    // Actual/actual: within a year, 366 when a February 29 is in the span (or ends it), else 365; past a year, the
    // average length of the calendar years it touches.
    ['YEARFRAC(DATE(2011,7,1),DATE(2012,7,1),1)', 1], ['YEARFRAC(DATE(2011,1,1),DATE(2012,1,1),1)', 1], ['YEARFRAC(DATE(2012,1,1),DATE(2013,1,1),1)', 1],
    ['YEARFRAC(DATE(2011,3,1),DATE(2012,2,29),1)', 365 / 366], ['YEARFRAC(DATE(2012,3,1),DATE(2013,2,28),1)', 364 / 365], ['YEARFRAC(DATE(2012,2,29),DATE(2012,12,31),1)', 306 / 366],
    ['YEARFRAC(DATE(2011,1,1),DATE(2013,1,2),1)', 732 / (1096 / 3)], ['YEARFRAC(DATE(2010,6,1),DATE(2012,6,1),1)', 731 / (1096 / 3)],
    // 30/360 U.S.: a start on the last day of February counts as the 30th (an end too, when both are), a 31st start as
    // the 30th, and an end on the 31st as the 30th only when the start is the 30th or 31st.
    ['YEARFRAC(DATE(2011,2,28),DATE(2011,3,31))', 31 / 360], ['YEARFRAC(DATE(2012,2,29),DATE(2013,2,28))', 1], ['YEARFRAC(DATE(2011,2,28),DATE(2012,2,29))', 1],
    ['YEARFRAC(DATE(2011,1,30),DATE(2011,3,31))', 60 / 360], ['YEARFRAC(DATE(2011,1,29),DATE(2011,3,31))', 62 / 360], ['YEARFRAC(DATE(2011,1,31),DATE(2011,3,31))', 60 / 360],
    ['YEARFRAC(DATE(2011,2,28),DATE(2011,3,31),4)', 32 / 360], ['YEARFRAC(DATE(2011,1,29),DATE(2011,3,31),4)', 61 / 360],
  ], 1e-12);
  // Excel 2007's results in Wheeler's data, and Excel 2002's for the end-of-February start his README quotes.
  near(e, [
    ['YEARFRAC(DATE(2000,1,1),DATE(2001,1,1),1)', 1], ['YEARFRAC(DATE(2000,1,1),DATE(2002,1,1),1)', 2.0009124090], ['YEARFRAC(DATE(2000,1,1),DATE(2000,1,2),1)', 0.0027322400],
    ['YEARFRAC(DATE(2000,1,1),DATE(2004,1,31),1)', 4.080459770], ['YEARFRAC(DATE(1999,1,5),DATE(2000,2,28),4)', 1.147222222], ['YEARFRAC(DATE(1999,1,5),DATE(2000,2,29),4)', 1.15],
    ['YEARFRAC(DATE(2000,1,1),DATE(2000,1,31),0)', 0.083333333], ['YEARFRAC(DATE(2000,1,1),DATE(2000,2,28),0)', 0.158333333], ['YEARFRAC(DATE(2002,2,28),DATE(2002,12,31),0)', 0.836111111],
  ]);
  cases(e, [['YEARFRAC(A2,A3,5)', '#NUM!'], ['YEARFRAC(A2,A3,-1)', '#NUM!'], ['YEARFRAC("x",A3)', '#VALUE!'], ['YEARFRAC(A2,A2)', 0]]);
});

test('DATEDIF: every unit, and "MD" counting back into a shorter month as Excel does', () => {
  const e = book({ A2: '1/1/2001', B2: '1/1/2003', A3: '6/1/2001', B3: '8/15/2002', D17: '1/1/2014', E17: '5/6/2016' });
  cases(e, [
    ['DATEDIF(A2,B2,"Y")', 2], ['DATEDIF(A3,B3,"D")', 440], ['DATEDIF(A3,B3,"YD")', 75], ['DATEDIF("2001/1/30",B2,"D")', calc(e, 'B2-DATEVALUE("2001/1/30")')],
    ['DATEDIF(D17,E17,"Y")', 2], ['DATEDIF(D17,E17,"YM")', 4], ['DATEDIF(D17,E17,"MD")', 5], ['E17-DATE(YEAR(E17),MONTH(E17),1)', 5], ['DATEDIF(D17,E17,"M")', 28],
    ['DATEDIF(A3,B3,"M")', 14], ['DATEDIF(A3,B3,"YM")', 2], ['DATEDIF(A3,B3,"MD")', 14], ['DATEDIF(A3,B3,"md")', 14],
    ['DATEDIF(B2,A2,"Y")', '#NUM!'], ['DATEDIF(A2,B2,"W")', '#NUM!'], ['DATEDIF(A2,A2,"D")', 0], ['DATEDIF(A2,B2+0.9,"D")', 730],
    // A month counts only once the end's day reaches the start's.
    ['DATEDIF(DATE(2011,1,31),DATE(2011,2,28),"M")', 0], ['DATEDIF(DATE(2011,1,31),DATE(2011,2,28),"MD")', 28], ['DATEDIF(DATE(2016,2,29),DATE(2017,2,28),"Y")', 0],
    ['DATEDIF(DATE(2016,2,29),DATE(2017,3,1),"Y")', 1], ['DATEDIF(DATE(2011,5,20),DATE(2012,5,19),"YM")', 11], ['DATEDIF(DATE(2011,5,20),DATE(2012,5,19),"YD")', 365],
    ['DATEDIF(DATE(2011,1,31),DATE(2011,3,1),"MD")', -2], ['DATEDIF(DATE(2011,1,31),DATE(2011,3,1),"M")', 1], ['DATEDIF(DATE(2011,3,31),DATE(2011,5,1),"MD")', 0],
    // Excel's results recorded by LibreOffice: "MD" rolls a missing day into the end's month; the YD case below
    // remains 323 despite the leap year at the end (also confirmed live in Excel 16.114.1).
    ['DATEDIF(DATE(2012,1,28),DATE(2012,3,1),"MD")', 2], ['DATEDIF(DATE(2011,1,29),DATE(2011,3,1),"MD")', 0], ['DATEDIF(DATE(1988,6,22),DATE(2012,5,11),"YD")', 323],
  ]);
});

test('NOW and TODAY read the engine\'s clock, in local time, and move only with a recalculation', () => {
  let clock = CLOCK;
  const e = book({ A1: '=NOW()', B1: '=TODAY()', C1: '=A1+1', D1: 5 }, { now: () => clock });
  assert.equal(val(e, 'A1'), serial(2011, 6, 15) + 9.5 / 24);
  assert.equal(val(e, 'B1'), serial(2011, 6, 15));
  assert.equal(val(e, 'C1'), serial(2011, 6, 16) + 9.5 / 24);
  clock = new Date(2011, 5, 16, 18, 0, 0).getTime();
  assert.equal(val(e, 'A1'), serial(2011, 6, 15) + 9.5 / 24, 'no timer moves it');
  e.edit(e.wb.sheets[0].id, 0, 3, '6');
  assert.equal(val(e, 'A1'), serial(2011, 6, 16) + 0.75);
  assert.equal(val(e, 'B1'), serial(2011, 6, 16));
  assert.equal(val(e, 'C1'), serial(2011, 6, 17) + 0.75, 'what reads it follows');
  cases(e, [['NOW(1)', '#VALUE!'], ['DAY(TODAY())', 16], ['MONTH(TODAY())', 6], ['INT(NOW())=TODAY()', true]]);
});

test('the 1900 system has 1900-02-29, serial 60, and serial 0 is 1900-01-00', () => {
  const e = book();
  cases(e, [
    ['DATE(1900,2,29)', 60], ['DATE(1900,3,1)', 61], ['DATE(1900,2,28)', 59], ['DATE(1900,3,0)', 60], ['DATE(1900,1,1)', 1], ['DATE(1900,1,0)', 0], ['DATE(1900,1,-1)', '#NUM!'],
    ['DAY(60)', 29], ['MONTH(60)', 2], ['DAY(61)', 1], ['MONTH(61)', 3], ['YEAR(0)', 1900], ['MONTH(0)', 1], ['DAY(0)', 0], ['DATEVALUE("2/29/1900")', 60],
    ['WEEKDAY(1)', 1], ['WEEKDAY(0)', 7], ['WEEKDAY(60)', 4], ['WEEKDAY(61)', 5], ['DAYS(DATE(1900,3,1),DATE(1900,2,28))', 2], ['EOMONTH(DATE(1900,2,1),0)', 59],
  ]);
});

test('a 1904 workbook counts from 1904-01-01 and gives the same differences', () => {
  const e = book({ A2: '10/1/2012', A3: '3/1/2013', A4: '11/22/2012' }, { date1904: true });
  const S = 1462;
  cases(e, [
    ['DATE(2008,1,2)', serial(2008, 1, 2) - S], ['DATE(1904,1,1)', 0], ['DATE(1903,12,31)', '#NUM!'], ['DATE(0,1,1)', '#NUM!'], ['DATE(4,1,1)', 0], ['DATE(9999,12,31)', 2958465 - S],
    ['YEAR(0)', 1904], ['MONTH(0)', 1], ['DAY(0)', 1], ['WEEKDAY(0)', 6], ['YEAR(2958465-1462)', 9999], ['YEAR(2958466-1462)', '#NUM!'], ['YEAR(-1)', '#NUM!'],
    ['DATEVALUE("8/22/2011")', 40777 - S], ['TODAY()', serial(2011, 6, 15) - S], ['A2', serial(2012, 10, 1) - S],
    ['NETWORKDAYS(A2,A3,A4)', 109], ['WORKDAY(DATE(2008,10,1),151)', 39933 - S], ['EOMONTH(DATE(2011,1,1),1)', 40602 - S], ['EDATE(DATE(2011,1,15),1)', serial(2011, 2, 15) - S],
    ['WEEKDAY(DATE(2008,2,14))', 5], ['WEEKNUM(DATE(2012,3,9),2)', 11], ['ISOWEEKNUM(DATE(2012,3,9))', 10], ['ISOWEEKNUM(0)', 53], ['DAYS360(DATE(2011,1,1),DATE(2011,12,31))', 360],
    ['DATEDIF(DATE(2014,1,1),DATE(2016,5,6),"MD")', 5], ['DATEDIF(DATE(2011,1,31),DATE(2011,3,1),"MD")', -2], ['YEAR(TODAY())', 2011],
  ]);
  near(e, [['YEARFRAC(DATE(2012,1,1),DATE(2012,7,30),1)', 211 / 366], ['YEARFRAC(DATE(2011,1,1),DATE(2013,1,2),1)', 732 / (1096 / 3)]], 1e-12);
});

// Live Microsoft Excel 16.114.1, 2026-10-30: unlike DATE, these month functions clamp February 1900 to day 28.
test('EDATE and EOMONTH use February 28 at the 1900 month end', () => {
  cases(book(), [
    ['EDATE(31,1)', 59], ['EDATE(60,0)', 59], ['EDATE(60,1)', 89], ['EDATE(60,-1)', 29],
    ['EOMONTH(60,0)', 59], ['EOMONTH(31,1)', 59],
  ]);
});

// Live Excel: YD counts whole months using the start calendar, then the MD remainder using the end calendar.
test('DATEDIF YD keeps the start calendar for whole months across leap years', () => {
  for (const date1904 of [false, true]) cases(book({}, { date1904 }), [
    ['DATEDIF(DATE(2011,1,1),DATE(2012,3,1),"YD")', 59], ['DATEDIF(DATE(2012,1,1),DATE(2013,3,1),"YD")', 60],
    ['DATEDIF(DATE(2011,5,20),DATE(2012,5,19),"YD")', 365], ['DATEDIF(DATE(2012,5,20),DATE(2013,5,19),"YD")', 364],
    ['DATEDIF(DATE(2011,2,28),DATE(2012,3,1),"YD")', 2], ['DATEDIF(DATE(2012,2,29),DATE(2013,3,1),"YD")', 0],
    ['DATEDIF(DATE(2011,1,31),DATE(2012,3,1),"YD")', 30], ['DATEDIF(DATE(2012,1,31),DATE(2013,3,1),"YD")', 29],
    ['DATEDIF(DATE(2011,5,20),DATE(2014,5,19),"YD")', 365], ['DATEDIF(DATE(1988,6,22),DATE(2012,5,11),"YD")', 323],
  ]);
});
