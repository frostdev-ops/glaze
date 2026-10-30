// Glaze Sheets' VDB ISPMT DOLLARDE DOLLARFR, registered with the calc engine (sheet-calc.js define).
// VDB follows Excel 16.114.1, which no page spells out: each period declines the book value by factor/life, never below
// salvage, until straight line over the life left (book less salvage over the periods left) is more, and from then on
// is straight line. A period in part counts in proportion. A fractional start begins anew: the asset as it stands then,
// over the life left, at the same rate. no_switch keeps the declining balance throughout, partial periods in
// proportion at either end.
// Classic script; module.exports for node.
var GZ_SHEET_FN_FINANCIAL2 = globalThis.GZ_SHEET_FN_FINANCIAL2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, num, bool } = C.lib;

  const finite = (x) => { if (!Number.isFinite(x)) throw ERR.NUM; return x || 0; };
  const given = (v) => v !== undefined && v !== null;

  // The depreciation of periods 1 to n, from a book value of cost.
  const schedule = (cost, salvage, life, rate, n, line) => {
    const out = [];
    let book = cost, straight = null;
    for (let i = 1; i <= n; i++) {
      let d;
      if (straight !== null) d = straight;
      else {
        const declining = book * rate, left = book - salvage;
        const even = left / (life - i + 1);
        if (line && even > declining) d = straight = even;
        else d = Math.min(declining, left);
      }
      if (!line && d < 0 && book >= salvage) d = 0;
      out.push(d);
      book -= d;
    }
    return out;
  };
  // Periods from..to of a schedule, a period in part in proportion.
  const span = (d, from, to) => {
    let v = 0;
    const first = Math.floor(from), last = Math.ceil(to);
    for (let i = first + 1; i <= last; i++) v += d[i - 1] * (i === first + 1 ? Math.min(to, first + 1) - from : i === last ? to + 1 - last : 1);
    return v;
  };
  // Long lives use the geometric declining-balance sum. The straight-line switch predicate is monotone at integer
  // period starts before life ends, so binary search finds the first switch in O(log life), with no schedule array.
  const cumulative = (cost, salvage, life, rate, t, line) => {
    if (t === 0) return 0;
    if (salvage > cost) return Math.min(t, 1) * (cost - salvage);
    if (rate === 0) return line ? ((cost - salvage) * t) / life : 0;
    const logq = Math.log1p(-rate), book = (n) => n === 0 ? cost : cost * Math.exp(n * logq);
    const declining = (n) => Math.min(cost - salvage, -cost * Math.expm1(n * logq));
    let switchAt = Math.ceil(t);
    if (line) {
      const switches = (n) => (book(n) - salvage) / (life - n) > book(n) * rate;
      let lo = 0, hi = Math.ceil(t) - 1;
      if (switches(hi)) {
        while (lo < hi) { const mid = Math.floor(lo + (hi - lo) / 2); if (switches(mid)) hi = mid; else lo = mid + 1; }
        switchAt = lo;
      }
    }
    if (switchAt < t) return declining(switchAt) + ((book(switchAt) - salvage) / (life - switchAt)) * (t - switchAt);
    const n = Math.floor(t), fraction = t - n;
    return declining(n) + fraction * Math.max(0, Math.min(book(n) * rate, book(n) - salvage));
  };
  const vdb = (cost, salvage, life, start, end, factor, noSwitch) => {
    const rate = Math.min(factor / life, 1);
    const total = (c, l, t, line) => t > 10000 ? cumulative(c, salvage, l, rate, t, line) : span(schedule(c, salvage, l, rate, Math.ceil(t), line), 0, t);
    if (noSwitch) return end > 10000 ? total(cost, life, end, false) - total(cost, life, start, false)
      : span(schedule(cost, salvage, life, rate, Math.ceil(end), false), start, end);
    const before = total(cost, life, start, true);
    return total(cost - before, life - start, end - start, true);
  };

  // A fraction's denominator: truncated, below 0 #NUM!, below 1 #DIV/0!.
  const denominator = (f, ctx) => {
    const value = num(f, ctx);
    if (value < 0) throw ERR.NUM;
    const n = Math.trunc(value);
    if (n < 1) throw ERR.DIV0;
    return n;
  };
  const split = (x) => { const whole = Math.trunc(x); return [whole, x - whole]; };
  const scale = (n) => 10 ** Math.ceil(Math.log10(n));

  const FNS = {
    VDB: { p: ['v', 'v', 'v', 'v', 'v', 'v', 'v'], min: 5, max: 7, fn: ([c, s, l, a, b, f, ns], ctx) => {
      const cost = num(c, ctx), salvage = num(s, ctx), life = num(l, ctx), start = num(a, ctx), end = num(b, ctx);
      const factor = given(f) ? num(f, ctx) : 2, noSwitch = given(ns) ? bool(ns) : false;
      if (cost < 0 || salvage < 0 || start < 0 || end < start || end > life || factor < 0) throw ERR.NUM;
      if (life === 0) throw ERR.DIV0;
      return finite(vdb(cost, salvage, life, start, end, factor, noSwitch));
    } },
    // pv × rate × (per / nper − 1): the interest on what is left of the principal after per even payments.
    ISPMT: { p: ['v', 'v', 'v', 'v'], min: 4, max: 4, fn: ([r, p, n, v], ctx) => {
      const rate = num(r, ctx), per = num(p, ctx), nper = num(n, ctx), pv = num(v, ctx);
      if (nper === 0) throw ERR.DIV0;
      return finite(pv * rate * (per / nper - 1));
    } },
    // 1.02 at 16 is 1 and 2/16: the digits after the point, as many as the fraction has, are the numerator.
    DOLLARDE: { p: ['v', 'v'], min: 2, max: 2, fn: ([x, f], ctx) => {
      const d = num(x, ctx), n = denominator(f, ctx), [whole, part] = split(d);
      return finite(whole + (part * scale(n)) / n);
    } },
    DOLLARFR: { p: ['v', 'v'], min: 2, max: 2, fn: ([x, f], ctx) => {
      const d = num(x, ctx), n = denominator(f, ctx), [whole, part] = split(d);
      return finite(whole + (part * n) / scale(n));
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_FINANCIAL2; else GZ_SHEET_FN_FINANCIAL2;
