// Glaze Sheets' date and time functions: DATE TIME DATEVALUE TIMEVALUE YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM
// ISOWEEKNUM DAYS DAYS360 EDATE EOMONTH NETWORKDAYS NETWORKDAYS.INTL WORKDAY WORKDAY.INTL YEARFRAC DATEDIF NOW TODAY,
// registered with the calc engine (sheet-calc.js define). Serials are the workbook's date system (sheet-model.js): in
// 1900's, serial 60 is 1900-02-29, so Excel's calendar has that day and 1900 is a leap year here too. A date argument
// reads text as typed input and drops its time; one outside the date system's years (1900 or 1904 to 9999) is #NUM!.
// Classic script; module.exports for node.
var GZ_SHEET_FN_DATE = globalThis.GZ_SHEET_FN_DATE || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { ERR, isErr, num, text, bool, each } = C.lib;
  const LAST = 2958465, SHIFT_1904 = 1462;

  const last = (ctx) => (ctx.date1904 ? LAST - SHIFT_1904 : LAST);
  const valid = (n, ctx) => { if (!(n >= 0 && n <= last(ctx))) throw ERR.NUM; return n; };
  const serial = (v, ctx) => valid(Math.floor(num(v, ctx)), ctx);
  const parts = (n, ctx) => M.fromSerial(n, ctx.date1904);
  const ymd = (y, m, d, ctx) => M.toSerial(y, m, d, ctx.date1904);
  const leap = (y) => (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) || y === 1900;
  const daysIn = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  // EDATE/EOMONTH use the Gregorian month end even though DATE accepts serial 60 as February 29, 1900.
  const monthEnd = (y, m) => y === 1900 && m === 2 ? 28 : daysIn(y, m);
  const dow = (n, ctx) => (n + (ctx.date1904 ? SHIFT_1904 : 0) + 6) % 7;
  const whole = (v, ctx) => Math.trunc(num(v, ctx));
  const given = (v) => v !== undefined && v !== null;
  // y, m (any whole number, rolling into years) as a month that exists, or #NUM!.
  const month = (y, m) => {
    const t = y * 12 + m - 1, yy = Math.floor(t / 12);
    if (!(yy >= 1900 && yy <= 9999)) throw ERR.NUM;
    return [yy, t - yy * 12 + 1];
  };

  // Typed text as a date or time; a plain number is not one.
  const typed = (v, ctx) => {
    if (typeof v !== 'string') throw ERR.VALUE;
    const x = M.parseNumber(v, { date1904: ctx.date1904, year: new Date(ctx.now()).getFullYear() });
    if (!x || !/[dyh]/.test(x.fmt ?? '')) throw ERR.VALUE;
    return x.v;
  };
  // A time of day in whole seconds, rounded to the nearest one.
  const seconds = (v, ctx) => {
    const n = num(v, ctx);
    if (!(n >= 0 && n < last(ctx) + 1)) throw ERR.NUM;
    return Math.round((n - Math.floor(n)) * 86400) % 86400;
  };

  // WEEKDAY's return types: [the first day, Sunday 0; what it counts as].
  const WEEKDAY = { 1: [0, 1], 2: [1, 1], 3: [1, 0], 11: [1, 1], 12: [2, 1], 13: [3, 1], 14: [4, 1], 15: [5, 1], 16: [6, 1], 17: [0, 1] };
  const WEEK_START = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };
  const isoWeek = (n, ctx) => {
    const thursday = n - ((dow(n, ctx) + 6) % 7) + 3;
    const y = thursday < (ctx.date1904 ? 0 : 1) ? (ctx.date1904 ? 1903 : 1899) : parts(thursday, ctx).y;
    return Math.floor((thursday - ymd(y, 1, 1, ctx)) / 7) + 1;
  };

  // A weekend as seven flags, Sunday first: a number code, or seven 0/1 characters from Monday.
  const WEEKENDS = { 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6], 11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6] };
  const weekend = (w, ctx) => {
    const off = new Array(7).fill(false);
    if (typeof w === 'string') {
      if (!/^[01]{7}$/.test(w)) throw ERR.VALUE;
      for (let i = 0; i < 7; i++) off[(i + 1) % 7] = w[i] === '1';
      return off;
    }
    const days = WEEKENDS[given(w) ? whole(w, ctx) : 1];
    if (!days) throw ERR.NUM;
    for (const d of days) off[d] = true;
    return off;
  };
  const holidays = (arg, ctx) => {
    const out = new Set();
    if (given(arg)) each(arg, ctx, (v) => { if (isErr(v)) throw v; if (typeof v === 'boolean') throw ERR.VALUE; out.add(serial(v, ctx)); });
    return out;
  };
  const networkdays = (a, b, off, hol, ctx) => {
    const lo = Math.min(a, b), hi = Math.max(a, b), weeks = Math.floor((hi - lo + 1) / 7);
    let n = weeks * off.filter((x) => !x).length;
    for (let s = lo + weeks * 7; s <= hi; s++) if (!off[dow(s, ctx)]) n++;
    for (const h of hol) if (h >= lo && h <= hi && !off[dow(h, ctx)]) n--;
    return a <= b ? n : -n;
  };
  const workday = (start, days, off, hol, ctx) => {
    if (off.every(Boolean)) throw ERR.VALUE;
    const step = days < 0 ? -1 : 1;
    let s = start;
    for (let left = Math.abs(days); left > 0;) {
      s = valid(s + step, ctx);
      if (!off[dow(s, ctx)] && !hol.has(s)) left--;
    }
    return s;
  };

  // DAYS360: the U.S. (NASD) method moves a start on the last day of February to the 30th, and an end on the 31st to
  // the 30th only when the start is then the 30th; the European method moves any 31st to the 30th.
  const days360 = (a, b, euro, ctx) => {
    const p = parts(a, ctx), q = parts(b, ctx);
    let d1 = p.d, d2 = q.d;
    if (d1 === 31) d1 = 30;
    else if (!euro && p.m === 2 && d1 === daysIn(p.y, 2)) d1 = 30;
    if (d2 === 31 && (euro || d1 === 30)) d2 = 30;
    return (q.y - p.y) * 360 + (q.m - p.m) * 30 + d2 - d1;
  };
  // YEARFRAC's five bases as Excel computes them (the start is the earlier date).
  const endOfFeb = (p) => p.m === 2 && p.d === daysIn(p.y, 2);
  const BASES = [
    (a, b, p, q) => {
      let d1 = p.d, d2 = q.d;
      if (d1 === 31 && d2 === 31) { d1 = 30; d2 = 30; }
      else if (d1 === 31) d1 = 30;
      else if (d1 === 30 && d2 === 31) d2 = 30;
      else if (endOfFeb(p) && endOfFeb(q)) { d1 = 30; d2 = 30; }
      else if (endOfFeb(p)) d1 = 30;
      return ((q.y - p.y) * 360 + (q.m - p.m) * 30 + d2 - d1) / 360;
    },
    (a, b, p, q, ctx) => {
      const withinYear = p.y === q.y || (p.y + 1 === q.y && (p.m > q.m || (p.m === q.m && p.d >= q.d)));
      if (!withinYear) return (b - a) / ((ymd(q.y + 1, 1, 1, ctx) - ymd(p.y, 1, 1, ctx)) / (q.y - p.y + 1));
      const feb29 = (y) => leap(y) && a < ymd(y, 3, 1, ctx) && b >= ymd(y, 3, 1, ctx);
      const long = p.y === q.y ? leap(p.y) : feb29(p.y) || feb29(q.y) || (q.m === 2 && q.d === 29);
      return (b - a) / (long ? 366 : 365);
    },
    (a, b) => (b - a) / 360,
    (a, b) => (b - a) / 365,
    (a, b, p, q) => ((q.y - p.y) * 360 + (q.m - p.m) * 30 + Math.min(q.d, 30) - Math.min(p.d, 30)) / 360,
  ];

  const datePart = (key) => ({ p: ['v'], min: 1, max: 1, fn: ([v], ctx) => parts(serial(v, ctx), ctx)[key] });
  const timePart = (f) => ({ p: ['v'], min: 1, max: 1, fn: ([v], ctx) => f(seconds(v, ctx)) });
  const networkdaysDef = (intl) => ({ p: intl ? ['v', 'v', 'v', 'a'] : ['v', 'v', 'a'], min: 2, max: intl ? 4 : 3, fn: (args, ctx) => {
    const [s, e] = args, off = weekend(intl ? args[2] : 1, ctx);
    return networkdays(serial(s, ctx), serial(e, ctx), off, holidays(args[intl ? 3 : 2], ctx), ctx);
  } });
  const workdayDef = (intl) => ({ p: intl ? ['v', 'v', 'v', 'a'] : ['v', 'v', 'a'], min: 2, max: intl ? 4 : 3, fn: (args, ctx) => {
    const [s, k] = args, off = weekend(intl ? args[2] : 1, ctx);
    return workday(serial(s, ctx), whole(k, ctx), off, holidays(args[intl ? 3 : 2], ctx), ctx);
  } });
  const now = (ctx) => {
    const t = new Date(ctx.now());
    return ymd(t.getFullYear(), t.getMonth() + 1, t.getDate(), ctx) + (t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds() + t.getMilliseconds() / 1000) / 86400;
  };

  const FNS = {
    // A year 0-1899 counts from 1900; months and days past their ends roll over, before their starts roll back.
    DATE: { p: ['v', 'v', 'v'], min: 3, max: 3, fn: ([y, m, d], ctx) => {
      let year = whole(y, ctx);
      if (year < 0 || year >= 10000) throw ERR.NUM;
      if (year < 1900) year += 1900;
      return valid(ymd(year, whole(m, ctx), whole(d, ctx), ctx), ctx);
    } },
    TIME: { p: ['v', 'v', 'v'], min: 3, max: 3, fn: (args, ctx) => {
      const [h, m, s] = args.map((v) => whole(v, ctx));
      if (h > 32767 || m > 32767 || s > 32767) throw ERR.NUM;
      const total = h * 3600 + m * 60 + s;
      if (total < 0) throw ERR.NUM;
      return (total % 86400) / 86400;
    } },
    DATEVALUE: { p: ['v'], min: 1, max: 1, fn: ([v], ctx) => valid(Math.floor(typed(v, ctx)), ctx) },
    TIMEVALUE: { p: ['v'], min: 1, max: 1, fn: ([v], ctx) => { const n = typed(v, ctx); return Math.round((n - Math.floor(n)) * 864e5) / 864e5; } },
    YEAR: datePart('y'),
    MONTH: datePart('m'),
    DAY: datePart('d'),
    HOUR: timePart((s) => Math.floor(s / 3600)),
    MINUTE: timePart((s) => Math.floor(s / 60) % 60),
    SECOND: timePart((s) => s % 60),
    WEEKDAY: { p: ['v', 'v'], min: 1, max: 2, fn: ([v, t], ctx) => {
      const n = serial(v, ctx), type = WEEKDAY[given(t) ? whole(t, ctx) : 1];
      if (!type) throw ERR.NUM;
      return ((dow(n, ctx) - type[0] + 7) % 7) + type[1];
    } },
    // Week 1 holds January 1 (type 21: ISO weeks, week 1 holding the year's first Thursday).
    WEEKNUM: { p: ['v', 'v'], min: 1, max: 2, fn: ([v, t], ctx) => {
      const n = serial(v, ctx), type = given(t) ? whole(t, ctx) : 1;
      if (type === 21) return isoWeek(n, ctx);
      const start = WEEK_START[type];
      if (start === undefined) throw ERR.NUM;
      const jan1 = ymd(parts(n, ctx).y, 1, 1, ctx);
      return Math.floor((n - jan1 + ((dow(jan1, ctx) - start + 7) % 7)) / 7) + 1;
    } },
    ISOWEEKNUM: { p: ['v'], min: 1, max: 1, fn: ([v], ctx) => isoWeek(serial(v, ctx), ctx) },
    DAYS: { p: ['v', 'v'], min: 2, max: 2, fn: ([e, s], ctx) => serial(e, ctx) - serial(s, ctx) },
    DAYS360: { p: ['v', 'v', 'v'], min: 2, max: 3, fn: ([s, e, euro], ctx) => days360(serial(s, ctx), serial(e, ctx), given(euro) && bool(euro), ctx) },
    // The same day months away, or that month's last day when it is shorter.
    EDATE: { p: ['v', 'v'], min: 2, max: 2, fn: ([s, k], ctx) => {
      const p = parts(serial(s, ctx), ctx), [y, m] = month(p.y, p.m + whole(k, ctx));
      return valid(ymd(y, m, Math.min(p.d, monthEnd(y, m)), ctx), ctx);
    } },
    EOMONTH: { p: ['v', 'v'], min: 2, max: 2, fn: ([s, k], ctx) => {
      const p = parts(serial(s, ctx), ctx), [y, m] = month(p.y, p.m + whole(k, ctx));
      return valid(ymd(y, m, monthEnd(y, m), ctx), ctx);
    } },
    NETWORKDAYS: networkdaysDef(false),
    'NETWORKDAYS.INTL': networkdaysDef(true),
    WORKDAY: workdayDef(false),
    'WORKDAY.INTL': workdayDef(true),
    YEARFRAC: { p: ['v', 'v', 'v'], min: 2, max: 3, fn: ([s, e, b], ctx) => {
      let a = serial(s, ctx), z = serial(e, ctx);
      const basis = BASES[given(b) ? whole(b, ctx) : 0];
      if (!basis) throw ERR.NUM;
      if (a > z) [a, z] = [z, a];
      return basis(a, z, parts(a, ctx), parts(z, ctx), ctx);
    } },
    // "MD" counts from the start's day in the month before the end's (or the end's own month), rolling over as DATE
    // does when that month is shorter: so 1/31 to 3/1 is -2, as in Excel. "YD" counts whole months in the start's
    // calendar and adds that same "MD" remainder from the end's calendar, including their different leap days.
    DATEDIF: { p: ['v', 'v', 'v'], min: 3, max: 3, fn: ([s, e, u], ctx) => {
      const a = serial(s, ctx), b = serial(e, ctx), unit = text(u).toUpperCase();
      if (a > b) throw ERR.NUM;
      const p = parts(a, ctx), q = parts(b, ctx), short = q.d < p.d ? 1 : 0;
      const months = (q.y - p.y) * 12 + q.m - p.m - short;
      switch (unit) {
        case 'Y': return Math.floor(months / 12);
        case 'M': return months;
        case 'D': return b - a;
        case 'YM': return months % 12;
        case 'MD': return b - ymd(q.y, q.m - short, p.d, ctx);
        case 'YD': return ymd(p.y, p.m + months % 12, p.d, ctx) - a + b - ymd(q.y, q.m - short, p.d, ctx);
        default: throw ERR.NUM;
      }
    } },
    NOW: { p: [], min: 0, max: 0, volatile: true, fn: (args, ctx) => now(ctx) },
    TODAY: { p: [], min: 0, max: 0, volatile: true, fn: (args, ctx) => Math.floor(now(ctx)) },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_DATE; else GZ_SHEET_FN_DATE;
