// Glaze Sheets' financial functions: PMT IPMT PPMT NPER RATE PV FV NPV IRR XNPV XIRR MIRR SLN SYD DB DDB EFFECT
// NOMINAL CUMIPMT CUMPRINC RRI PDURATION FVSCHEDULE, registered with the calc engine (sheet-calc.js define).
// Excel's conventions: cash paid out is negative, cash received positive; type 0 pays at the end of each period, any
// other number at the start; with rate 0 the annuity is pmt * nper + pv + fv = 0. RATE, IRR and XIRR are Newton's
// method from the guess (10% if left out), with bounded steps and a balance check. Tolerances: RATE and IRR
// 1e-7, XIRR 1e-8. RATE uses the bounded budget checked against Excel 16.114.1; IRR 20, XIRR 100.
// Classic script; module.exports for node.
var GZ_SHEET_FN_FINANCIAL = globalThis.GZ_SHEET_FN_FINANCIAL || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, isErr, num, round, each } = C.lib;

  const finite = (x) => { if (!Number.isFinite(x)) throw ERR.NUM; return x || 0; };
  const given = (v) => v !== undefined && v !== null;
  const opt = (v, ctx, dflt) => (given(v) ? num(v, ctx) : dflt);
  const due = (v, ctx) => (num(v ?? 0, ctx) ? 1 : 0);

  // (1 + r)^n and (1 + r)^n - 1, the second without cancellation for small r.
  const grow = (r, n) => (r > -1 ? Math.exp(n * Math.log1p(r)) : (1 + r) ** n);
  const grown = (r, n) => (r > -1 ? Math.expm1(n * Math.log1p(r)) : (1 + r) ** n - 1);
  const fvOf = (r, n, pmt, pv, t) => (r === 0 ? -(pv + pmt * n) : -(pv * grow(r, n) + (pmt * (1 + r * t) * grown(r, n)) / r));
  const pvOf = (r, n, pmt, fv, t) => {
    if (grow(r, n) === 0) throw ERR.DIV0;
    return r === 0 ? -(fv + pmt * n) : -(fv + (pmt * (1 + r * t) * grown(r, n)) / r) / grow(r, n);
  };
  const pmtOf = (r, n, pv, fv, t) => {
    if (n === 0) throw ERR.NUM;
    return r === 0 ? -(pv + fv) / n : (-(fv + pv * grow(r, n)) * r) / ((1 + r * t) * grown(r, n));
  };
  // The interest in period `per`: none in the first when paid in advance; otherwise the rate on the balance owed.
  const ipmtOf = (r, per, n, pv, fv, t) => {
    const pmt = pmtOf(r, n, pv, fv, t);
    if (per === 1) return t ? 0 : -pv * r;
    return (t ? fvOf(r, per - 2, pmt, pv, 1) - pmt : fvOf(r, per - 1, pmt, pv, 0)) * r;
  };

  // Keep Newton steps above -100%, backing off when the balance grows. Each accepted step counts toward
  // the documented limit; backtracking is bounded independently so a bad guess cannot monopolize calculation.
  const newton = (f, x, tol, steps, flatRoot = false) => {
    if (x <= -1) throw ERR.VALUE;
    const scale = Math.max(1, Math.abs(f(0)[0]));
    for (let i = 0; i < steps; i++) {
      const [y, dy] = f(x);
      if (flatRoot && y === 0 && dy === 0) return x || 0;
      if (!Number.isFinite(y) || !Number.isFinite(dy) || dy === 0) break;
      if (y === 0) return x || 0;
      let next = x - y / dy;
      if (next <= -1) next = (x - 1) / 2;
      let accepted = false;
      for (let j = 0; j < 64 && Number.isFinite(next); j++) {
        const [ny] = f(next);
        if (Number.isFinite(ny) && Math.abs(ny) <= Math.abs(y)) { accepted = true; break; }
        next = (x + next) / 2;
      }
      if (!accepted) break;
      if (Math.abs(next - x) < tol && Math.abs(f(next)[0]) <= tol * scale) return polish(f, next) || 0;
      x = next;
    }
    throw ERR.NUM;
  };
  // Converged: up to three more steps while each shrinks the balance, so the result is the root to its last digits, as
  // Excel's RATE is.
  const polish = (f, x) => {
    for (let i = 0; i < 3; i++) {
      const [y, dy] = f(x), next = x - y / dy;
      if (!y || !Number.isFinite(next) || next <= -1 || !(Math.abs(f(next)[0]) < Math.abs(y))) break;
      x = next;
    }
    return x;
  };

  // The annuity balance and its derivative. Excel 16.114.1 accepts RATE cases requiring more than the
  // support page's 20 Newton steps; a bounded 144-step search matches the probed success and failure cases; Excel does not publish its solver.
  const annuity = (n, pmt, pv, fv, t) => (r) => {
    if (Math.abs(r) < 1e-10) return [pv + pmt * n + fv, n * pv + pmt * t * n + (pmt * n * (n - 1)) / 2];
    const g = grow(r, n), g1 = grown(r, n), d = n * grow(r, n - 1);
    return [pv * g + (pmt * (1 + r * t) * g1) / r + fv, pv * d + (pmt * t * g1) / r + (pmt * (1 + r * t) * (d * r - g1)) / (r * r)];
  };

  // Cash flows in order: the numbers of a range or array (text, booleans and blanks passed over); a typed value read as
  // a number. An error is the result.
  const flows = (args, ctx) => {
    const out = [];
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (typeof v === 'number') out.push(v);
      else if (direct && v !== null) out.push(num(v, ctx));
    }, true);
    return out;
  };
  const npvOf = (r, vals) => { let s = 0; for (let i = 0; i < vals.length; i++) s += vals[i] / grow(r, i + 1); return s; };
  const mixed = (vals) => vals.some((v) => v > 0) && vals.some((v) => v < 0);

  // XNPV and XIRR's flows and dates: every position of each, numbers only; dates whole days from 0 to 9999-12-31, none
  // before the first.
  const grid = (a, ctx) => {
    if (a instanceof C.lib.Ref) { const g = C.lib.toArray(a, ctx); if (isErr(g)) throw g; return g.flat(); }
    if (Array.isArray(a)) return a.flat();
    return [a];
  };
  const schedule = (values, dates, ctx, error = ERR.VALUE) => {
    const vs = grid(values, ctx), ds = grid(dates, ctx);
    for (const v of [...vs, ...ds]) if (isErr(v)) throw v;
    if (vs.some((v) => typeof v !== 'number')) throw error;
    if (ds.some((d) => typeof d !== 'number' || d < 0 || d >= 2958466)) throw error;
    if (vs.length !== ds.length) throw ERR.NUM;
    const days = ds.map(Math.trunc);
    if (days.some((d) => d < days[0])) throw ERR.NUM;
    return { vs, years: days.map((d) => (d - days[0]) / 365) };
  };
  const xnpvOf = (r, { vs, years }) => { let s = 0; for (let i = 0; i < vs.length; i++) s += vs[i] / grow(r, years[i]); return s; };

  // CUMIPMT and CUMPRINC's checks: → [rate, nper, pv, first, last, type].
  const cumulative = ([rate, nper, pv, start, end, type], ctx) => {
    const r = num(rate, ctx), n = num(nper, ctx), p = num(pv, ctx), s = Math.trunc(num(start, ctx)), e = Math.trunc(num(end, ctx)), t = num(type, ctx);
    if (r <= 0 || n <= 0 || p <= 0 || s < 1 || e < 1 || s > e || e > n || (t !== 0 && t !== 1)) throw ERR.NUM;
    return [r, n, p, s, e, t];
  };
  // The balance owed (as FV signs it) just after the payment of period k, for the principal paid between two periods.
  const owed = (r, pv, t, pmt, k) => (k === 0 ? -pv : t ? fvOf(r, k - 1, pmt, pv, 1) - pmt : fvOf(r, k, pmt, pv, 0));
  const principal = (r, n, pv, s, e, t) => { const pmt = pmtOf(r, n, pv, 0, t); return [owed(r, pv, t, pmt, s - 1) - owed(r, pv, t, pmt, e), pmt]; };

  const V = (k, min = k) => ({ p: Array(k).fill('v'), min, max: k });

  const FNS = {
    PMT: { ...V(5, 3), fn: ([r, n, pv, fv, t], ctx) => finite(pmtOf(num(r, ctx), num(n, ctx), num(pv, ctx), opt(fv, ctx, 0), due(t, ctx))) },
    PV: { ...V(5, 3), fn: ([r, n, pmt, fv, t], ctx) => finite(pvOf(num(r, ctx), num(n, ctx), num(pmt, ctx), opt(fv, ctx, 0), due(t, ctx))) },
    FV: { ...V(5, 3), fn: ([r, n, pmt, pv, t], ctx) => finite(fvOf(num(r, ctx), num(n, ctx), num(pmt, ctx), opt(pv, ctx, 0), due(t, ctx))) },
    IPMT: { ...V(6, 4), fn: ([r, per, n, pv, fv, t], ctx) => {
      const k = num(per, ctx), count = num(n, ctx);
      if (k < 1 || k > count) throw ERR.NUM;
      return finite(ipmtOf(num(r, ctx), k, count, num(pv, ctx), opt(fv, ctx, 0), due(t, ctx)));
    } },
    PPMT: { ...V(6, 4), fn: ([r, per, n, pv, fv, t], ctx) => {
      const rate = num(r, ctx), k = num(per, ctx), count = num(n, ctx), p = num(pv, ctx), f = opt(fv, ctx, 0), type = due(t, ctx);
      if (k < 1 || k > count) throw ERR.NUM;
      return finite(pmtOf(rate, count, p, f, type) - ipmtOf(rate, k, count, p, f, type));
    } },
    NPER: { ...V(5, 3), fn: ([r, pmt, pv, fv, t], ctx) => {
      const rate = num(r, ctx), p = num(pmt, ctx), v = num(pv, ctx), f = opt(fv, ctx, 0), type = due(t, ctx);
      if (rate === 0) { if (p === 0) throw ERR.DIV0; return finite(-(v + f) / p); }
      const a = p * (1 + rate * type), x = (a - f * rate) / (a + v * rate);
      if (!(x > 0) || rate <= -1) throw ERR.NUM;
      return finite(Math.log(x) / Math.log1p(rate));
    } },
    RATE: { ...V(6, 3), fn: ([n, pmt, pv, fv, t, guess], ctx) => {
      const count = num(n, ctx);
      if (count <= 0) throw ERR.NUM;
      return newton(annuity(count, num(pmt, ctx), num(pv, ctx), opt(fv, ctx, 0), due(t, ctx)), opt(guess, ctx, 0.1), 1e-7, 144);
    } },

    NPV: { p: ['v', 'r'], min: 2, fn: ([r, ...vals], ctx) => {
      const rate = num(r, ctx);
      if (rate === -1) throw ERR.DIV0;
      return finite(npvOf(rate, flows(vals, ctx)));
    } },
    IRR: { p: ['r', 'v'], min: 1, max: 2, fn: ([values, guess], ctx) => {
      if (isErr(guess)) return guess;
      const vs = flows([values], ctx);
      if (!mixed(vs)) throw ERR.NUM;
      const f = (r) => {
        let y = 0, dy = 0;
        for (let i = 0; i < vs.length; i++) { const g = grow(r, i); y += vs[i] / g; dy -= (i * vs[i]) / (g * (1 + r)); }
        return [y, dy];
      };
      return newton(f, opt(guess, ctx, 0.1), 1e-7, 20, true);
    } },
    MIRR: { p: ['r', 'v', 'v'], min: 3, max: 3, fn: ([values, finance, reinvest], ctx) => {
      for (const v of [finance, reinvest]) if (isErr(v)) return v;
      const vs = flows([values], ctx), fr = num(finance, ctx), rr = num(reinvest, ctx), n = vs.length;
      if (!mixed(vs) || rr === -1) throw ERR.DIV0;
      let gains = 0, costs = 0;
      for (let i = 0; i < n; i++) {
        if (vs[i] > 0) gains += vs[i] * grow(rr, n - 1 - i);
        if (vs[i] < 0) {
          if (fr === -1 && i > 0) throw ERR.DIV0;
          costs += vs[i] / grow(fr, i);
        }
      }
      return finite((-gains / costs) ** (1 / (n - 1)) - 1);
    } },
    XNPV: { p: ['v', 'r', 'r'], min: 3, max: 3, fn: ([r, values, dates], ctx) => {
      const rate = num(r, ctx);
      if (rate <= -1) throw ERR.NUM;
      const vs = grid(values, ctx);
      if (vs.every((v) => v === null)) throw ERR.VALUE;
      const s = schedule(values, dates, ctx, ERR.NUM);
      return finite(xnpvOf(rate, s));
    } },
    XIRR: { p: ['r', 'r', 'v'], min: 2, max: 3, fn: ([values, dates, guess], ctx) => {
      if (isErr(guess)) return guess;
      const vs = grid(values, ctx);
      if (vs.every((v) => v === null)) throw ERR.NUM;
      const s = schedule(values, dates, ctx);
      if (!mixed(s.vs)) throw ERR.NUM;
      if (s.years.every((y) => y === 0)) {
        if (opt(guess, ctx, 0.1) <= -1) throw ERR.VALUE;
        if (s.vs.reduce((a, v) => a + v, 0) === 0) return 0;
        throw ERR.NUM;
      }
      const f = (r) => {
        let y = 0, dy = 0;
        for (let i = 0; i < s.vs.length; i++) { const g = grow(r, s.years[i]); y += s.vs[i] / g; dy -= (s.years[i] * s.vs[i]) / (g * (1 + r)); }
        return [y, dy];
      };
      return newton(f, opt(guess, ctx, 0.1), 1e-8, 100);
    } },

    SLN: { ...V(3), fn: ([cost, salvage, life], ctx) => {
      const l = num(life, ctx);
      if (l === 0) throw ERR.DIV0;
      return finite((num(cost, ctx) - num(salvage, ctx)) / l);
    } },
    SYD: { ...V(4), fn: ([cost, salvage, life, per], ctx) => {
      const l = num(life, ctx), k = num(per, ctx);
      if (l <= 0 || k <= 0 || k > l) throw ERR.NUM;
      return finite(((num(cost, ctx) - num(salvage, ctx)) * (l - k + 1) * 2) / (l * (l + 1)));
    } },
    // The rate is 1 - (salvage / cost)^(1 / life) to three decimals; the first year has `month` months and the year
    // after the last the rest.
    DB: { ...V(5, 4), fn: ([cost, salvage, life, period, month], ctx) => {
      const c = num(cost, ctx), s = num(salvage, ctx), l = num(life, ctx), per = num(period, ctx), m = Math.trunc(opt(month, ctx, 12));
      const k = Math.max(1, Math.trunc(per));
      if (c < 0 || s < 0 || l <= 0 || per <= 0 || m < 1 || m > 12 || k > l + (m < 12 ? 1 : 0)) throw ERR.NUM;
      if (c === 0) return 0;
      const rate = round(1 - (s / c) ** (1 / l), 3), first = (c * rate * m) / 12;
      if (k === 1) return finite(first);
      // All complete periods after the first form a geometric progression; no loop over a user-sized life.
      const d = (c - first) * (1 - rate) ** (k - 2) * rate;
      return finite(k > l ? d * (12 - m) / 12 : d);
    } },
    // Min((cost - prior) * factor / life, cost - salvage - prior): the balance declines by the rate until it would
    // pass salvage, then stops there.
    DDB: { ...V(5, 4), fn: ([cost, salvage, life, period, factor], ctx) => {
      const c = num(cost, ctx), s = num(salvage, ctx), l = num(life, ctx), k = num(period, ctx), f = opt(factor, ctx, 2);
      if (c < 0 || s < 0 || l <= 0 || k <= 0 || f <= 0 || k > l) throw ERR.NUM;
      const rate = Math.min(f / l, 1);
      const before = c * (1 - rate) ** (k - 1), after = c * (1 - rate) ** k;
      return finite(Math.max(0, after < s ? before - s : before - after));
    } },

    EFFECT: { ...V(2), fn: ([rate, npery], ctx) => {
      const r = num(rate, ctx), n = Math.trunc(num(npery, ctx));
      if (r <= 0 || n < 1) throw ERR.NUM;
      return finite(grown(r / n, n));
    } },
    NOMINAL: { ...V(2), fn: ([rate, npery], ctx) => {
      const r = num(rate, ctx), n = Math.trunc(num(npery, ctx));
      if (r <= 0 || n < 1) throw ERR.NUM;
      return finite(n * Math.expm1(Math.log1p(r) / n));
    } },
    CUMIPMT: { ...V(6), fn: (args, ctx) => {
      const [r, n, pv, s, e, t] = cumulative(args, ctx);
      const [paid, pmt] = principal(r, n, pv, s, e, t);
      return finite((e - s + 1) * pmt - paid);
    } },
    CUMPRINC: { ...V(6), fn: (args, ctx) => {
      const [r, n, pv, s, e, t] = cumulative(args, ctx);
      return finite(principal(r, n, pv, s, e, t)[0]);
    } },
    RRI: { ...V(3), fn: ([nper, pv, fv], ctx) => {
      const n = num(nper, ctx), p = num(pv, ctx), f = num(fv, ctx);
      if (n <= 0 || p === 0 || f / p < 0) throw ERR.NUM;
      return finite((f / p) ** (1 / n) - 1);
    } },
    PDURATION: { ...V(3), fn: ([rate, pv, fv], ctx) => {
      const r = num(rate, ctx), p = num(pv, ctx), f = num(fv, ctx);
      if (r <= 0 || p <= 0 || f <= 0) throw ERR.NUM;
      return finite((Math.log(f) - Math.log(p)) / Math.log1p(r));
    } },
    // Blank cells in the schedule are 0; anything else not a number is #VALUE!.
    FVSCHEDULE: { p: ['v', 'r'], min: 2, max: 2, fn: ([principal0, rates], ctx) => {
      let x = num(principal0, ctx);
      each(rates, ctx, (v, direct) => {
        if (isErr(v)) throw v;
        if (typeof v !== 'number' && !direct) throw ERR.VALUE;
        x *= 1 + (direct ? num(v, ctx) : v);
      }, true);
      return finite(x);
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_FINANCIAL; else GZ_SHEET_FN_FINANCIAL;
