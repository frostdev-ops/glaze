// Glaze Sheets' further math functions: SUMPRODUCT SUMSQ PRODUCT QUOTIENT CEILING CEILING.MATH FLOOR FLOOR.MATH
// MROUND TRUNC EVEN ODD SIGN EXP LN LOG LOG10 PI RADIANS DEGREES SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH RAND
// RANDBETWEEN FACT FACTDOUBLE GCD LCM BASE DECIMAL ROMAN ARABIC AGGREGATE SUBTOTAL SERIESSUM, registered with the calc
// engine (sheet-calc.js define). Rounding to a multiple reads the quotient at 15 significant digits, as Excel shows
// it, so CEILING(1.5,0.1) is 1.5. RAND and RANDBETWEEN draw from the engine's random(), anew on every recalculation.
// SUBTOTAL and AGGREGATE leave out cells whose formula calls either of them; the sheet keeps one set of hidden rows, so
// a hidden row inside the sheet's filter is taken as filtered out (SUBTOTAL 1-11 still skip it) and any other as hidden
// by hand.
// Classic script; module.exports for node.
var GZ_SHEET_FN_MATH2 = globalThis.GZ_SHEET_FN_MATH2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const F = typeof GZ_SHEET_FORMULA !== 'undefined' ? GZ_SHEET_FORMULA : require('./sheet-formula.js');
  const { ERR, isErr, num, text, round, each, eachCell, toArray, map, Ref, Areas } = C.lib;

  const finite = (x) => { if (!Number.isFinite(x)) throw ERR.NUM; return x || 0; };
  const given = (v) => v !== undefined && v !== null;
  const digits15 = (x) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(15)) : x);
  const whole = (v, ctx) => Math.trunc(num(v, ctx));
  const MAX_INT = 2 ** 53;

  // As SUM reads its arguments: typed values as numbers, a range's or array's numbers only, any error the result.
  const numbers = (args, ctx, cb) => {
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (typeof v === 'number') cb(v);
      else if (direct && v !== null) cb(num(v, ctx));
    });
  };
  // A range, array or value as a grid of values.
  const grid = (a, ctx) => {
    if (isErr(a)) throw a;
    if (a instanceof Areas) throw ERR.VALUE;
    if (a instanceof Ref) { const g = toArray(a, ctx); if (isErr(g)) throw g; return g; }
    return Array.isArray(a) ? a : [[a]];
  };

  // x rounded by `to` to a whole number of steps.
  const steps = (x, step, to) => digits15(to(digits15(x / step)) * step);
  const away = (q) => Math.sign(q) * Math.floor(Math.abs(q) + 0.5);
  const logOf = (x, base) => {
    if (base === 10) return Math.log10(x);
    if (base === 2) return Math.log2(x);
    const r = Math.log(x) / Math.log(base), k = Math.round(r);
    return Math.abs(r - k) < 1e-12 * Math.max(1, Math.abs(k)) && base ** k === x ? k : r;
  };
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  // GCD and LCM's arguments: whole numbers from 0 to 2^53; text or booleans in a range are #VALUE!.
  const naturals = (args, ctx) => {
    const out = [];
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (!direct && typeof v !== 'number') throw ERR.VALUE;
      const n = Math.trunc(direct ? num(v, ctx) : v);
      if (n < 0 || n >= MAX_INT) throw ERR.NUM;
      out.push(n);
    });
    return out;
  };

  // ROMAN's numerals and, for each form, the pairs it may write as one value (a smaller numeral before a larger):
  // form 0 only one power of ten down (IV IX XL XC CD CM), each later form one numeral further (LD, then XD, VD, ID).
  const NUMERALS = [[1000, 'M'], [500, 'D'], [100, 'C'], [50, 'L'], [10, 'X'], [5, 'V'], [1, 'I']];
  const ROMAN_FORMS = [0, 1, 2, 3, 4].map((form) => {
    const out = NUMERALS.slice();
    NUMERALS.forEach(([big, bn], b) => {
      const ten = b % 2 ? b + 1 : b + 2;
      for (let s = ten; s < NUMERALS.length && s - ten <= form; s++) out.push([big - NUMERALS[s][0], NUMERALS[s][1] + bn]);
    });
    return out.sort((x, y) => y[0] - x[0]);
  });
  const ROMAN_VALUE = new Map(NUMERALS.map(([v, ch]) => [ch, v]));

  // ── SUBTOTAL and AGGREGATE ──────────────────────────────────────────────────────────────────────────────────────────
  const NESTED = new Map();
  const nested = (cell) => {
    if (cell?.f === undefined) return false;
    let hit = NESTED.get(cell.f);
    if (hit === undefined) {
      try { hit = F.tokenize(cell.f).some((t) => t.k === 'fn' && (t.name === 'SUBTOTAL' || t.name === 'AGGREGATE')); } catch { hit = false; }
      if (NESTED.size >= 10000) NESTED.clear();
      NESTED.set(cell.f, hit);
    }
    return hit;
  };
  const hiddenRow = (sheet, r) => sheet.hidden.rows.has(r);
  const filteredRow = (sheet, r) => !!sheet.filter && r > sheet.filter.r0 && r <= sheet.filter.r1 && sheet.hidden.rows.has(r);
  // A reference's values, row by row, less the rows `skip.row` leaves out, error values when `skip.errors`, nested
  // subtotals when `skip.nested`.
  const collect = (ref, ctx, skip) => {
    const out = [];
    eachCell(ref, ctx, (v, i, j) => {
      const r = ref.r0 + i;
      if (v === null || (skip.row && skip.row(ref.sheet, r))) return;
      if (skip.nested && nested(ref.sheet.rows.get(r)?.get(ref.c0 + j))) return;
      if (skip.errors && isErr(v)) return;
      out.push(v);
    }, true);
    return out;
  };
  const numeric = (vals) => {
    const xs = [];
    for (const v of vals) { if (isErr(v)) throw v; if (typeof v === 'number') xs.push(v); }
    return xs;
  };
  const sum = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
  const squares = (xs) => { const m = sum(xs) / xs.length; let s = 0; for (const x of xs) s += (x - m) ** 2; return s; };
  const spread = (sample, root) => (vals) => {
    const xs = numeric(vals), n = xs.length - (sample ? 1 : 0);
    if (n < 1) throw ERR.DIV0;
    const v = squares(xs) / n;
    return root ? Math.sqrt(v) : v;
  };
  const extreme = (pick) => (vals) => { const xs = numeric(vals); let m = xs.length ? xs[0] : 0; for (const x of xs) m = pick(m, x); return m; };
  const sorted = (vals) => numeric(vals).sort((a, b) => a - b);
  const inclusive = (xs, k) => {
    if (!xs.length || k < 0 || k > 1) throw ERR.NUM;
    const h = (xs.length - 1) * k, lo = Math.floor(h);
    return lo + 1 < xs.length ? xs[lo] + (h - lo) * (xs[lo + 1] - xs[lo]) : xs[lo];
  };
  const exclusive = (xs, k) => {
    const h = (xs.length + 1) * k, lo = Math.floor(h);
    if (!xs.length || k <= 0 || k >= 1 || h < 1 || h > xs.length) throw ERR.NUM;
    return lo < xs.length ? xs[lo - 1] + (h - lo) * (xs[lo] - xs[lo - 1]) : xs[lo - 1];
  };
  const ranked = (xs, k, desc) => { const i = Math.ceil(k); if (i < 1 || i > xs.length) throw ERR.NUM; return desc ? xs[xs.length - i] : xs[i - 1]; };
  // Functions 1-13 by number, on the values a reference gives; 14-19 also take k.
  const AGG = {
    1: (vals) => { const xs = numeric(vals); if (!xs.length) throw ERR.DIV0; return sum(xs) / xs.length; },
    2: (vals) => vals.filter((v) => typeof v === 'number').length,
    3: (vals) => vals.length,
    4: extreme(Math.max),
    5: extreme(Math.min),
    6: (vals) => { const xs = numeric(vals); let p = xs.length ? 1 : 0; for (const x of xs) p *= x; return p; },
    7: spread(true, true), 8: spread(false, true),
    9: (vals) => sum(numeric(vals)),
    10: spread(true, false), 11: spread(false, false),
    12: (vals) => {
      const xs = sorted(vals), n = xs.length;
      if (!n) throw ERR.NUM;
      return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
    },
    // The most frequent value; of equals, the one first seen.
    13: (vals) => {
      const xs = numeric(vals), counts = new Map();
      let most = 1;
      for (const x of xs) { const n = (counts.get(x) ?? 0) + 1; counts.set(x, n); if (n > most) most = n; }
      if (most < 2) throw ERR.NA;
      return xs.find((x) => counts.get(x) === most);
    },
    14: (xs, k) => ranked(xs, k, true),
    15: (xs, k) => ranked(xs, k, false),
    16: (xs, k) => inclusive(xs, k),
    17: (xs, q) => { const n = Math.trunc(q); if (n < 0 || n > 4) throw ERR.NUM; return inclusive(xs, n / 4); },
    18: (xs, k) => exclusive(xs, k),
    19: (xs, q) => { const n = Math.trunc(q); if (n < 1 || n > 3) throw ERR.NUM; return exclusive(xs, n / 4); },
  };
  // The values of SUBTOTAL's or AGGREGATE's reference arguments; each must be one area of one sheet.
  const referenced = (refs, ctx, skip) => {
    const vals = [];
    for (const ref of refs) {
      if (isErr(ref)) throw ref;
      if (!(ref instanceof Ref)) throw ERR.VALUE;
      for (const v of collect(ref, ctx, skip)) vals.push(v);
    }
    return vals;
  };

  const ONE = { p: ['v'], min: 1, max: 1 };
  const unary = (f) => ({ ...ONE, fn: ([x], ctx) => finite(f(num(x, ctx))) });
  const domain = (ok, f) => unary((x) => { if (!ok(x)) throw ERR.NUM; return f(x); });

  const FNS = {
    SUMPRODUCT: { p: ['a'], min: 1, fn: (args, ctx) => {
      const grids = args.map((a) => grid(a, ctx));
      const rows = grids[0].length, cols = grids[0][0].length;
      if (grids.some((g) => g.length !== rows || g[0].length !== cols)) throw ERR.VALUE;
      let s = 0;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        let p = 1;
        for (const g of grids) { const v = g[i][j]; if (isErr(v)) throw v; p *= typeof v === 'number' ? v : 0; }
        s += p;
      }
      return finite(s);
    } },
    SUMSQ: { p: ['r'], min: 1, fn: (args, ctx) => { let s = 0; numbers(args, ctx, (v) => { s += v * v; }); return finite(s); } },
    PRODUCT: { p: ['r'], min: 1, fn: (args, ctx) => { let p = 1, seen = false; numbers(args, ctx, (v) => { p *= v; seen = true; }); return seen ? finite(p) : 0; } },
    QUOTIENT: { p: ['v', 'v'], min: 2, max: 2, fn: ([n, d], ctx) => {
      const a = num(n, ctx), b = num(d, ctx);
      if (b === 0) throw ERR.DIV0;
      return finite(Math.trunc(digits15(a / b)));
    } },

    // Up to a multiple of significance: away from zero when both are negative, toward zero for a negative number.
    CEILING: { p: ['v', 'v'], min: 2, max: 2, fn: ([x, s], ctx) => {
      const a = num(x, ctx), b = num(s, ctx);
      if (a === 0 || b === 0) return 0;
      if (a > 0 && b < 0) throw ERR.NUM;
      return finite(steps(a, b, Math.ceil));
    } },
    FLOOR: { p: ['v', 'v'], min: 2, max: 2, fn: ([x, s], ctx) => {
      const a = num(x, ctx), b = num(s, ctx);
      if (a === 0) return 0;
      if (b === 0) throw ERR.DIV0;
      if (a > 0 && b < 0) throw ERR.NUM;
      return finite(steps(a, b, Math.floor));
    } },
    // Significance's sign is ignored (1 if left out); a nonzero mode turns a negative number's rounding round.
    'CEILING.MATH': { p: ['v', 'v', 'v'], min: 1, max: 3, fn: ([x, s, mode], ctx) => {
      const a = num(x, ctx), b = given(s) ? Math.abs(num(s, ctx)) : 1, m = given(mode) ? num(mode, ctx) : 0;
      if (b === 0) return 0;
      return finite(steps(a, b, a < 0 && m !== 0 ? Math.floor : Math.ceil));
    } },
    'FLOOR.MATH': { p: ['v', 'v', 'v'], min: 1, max: 3, fn: ([x, s, mode], ctx) => {
      const a = num(x, ctx), b = given(s) ? Math.abs(num(s, ctx)) : 1, m = given(mode) ? num(mode, ctx) : 0;
      if (b === 0) return 0;
      return finite(steps(a, b, a < 0 && m !== 0 ? Math.ceil : Math.floor));
    } },
    MROUND: { p: ['v', 'v'], min: 2, max: 2, fn: ([x, mult], ctx) => {
      const a = num(x, ctx), b = num(mult, ctx);
      if (a === 0 || b === 0) return 0;
      if ((a > 0) !== (b > 0)) throw ERR.NUM;
      return finite(steps(a, b, away));
    } },
    TRUNC: { p: ['v', 'v'], min: 1, max: 2, fn: ([x, d], ctx) => round(num(x, ctx), given(d) ? num(d, ctx) : 0, 'down') },
    EVEN: unary((x) => Math.sign(x) * Math.ceil(digits15(Math.abs(x)) / 2) * 2),
    ODD: unary((x) => { const k = Math.ceil(digits15(Math.abs(x))); return (x < 0 ? -1 : 1) * (k % 2 ? k : k + 1); }),
    SIGN: unary(Math.sign),

    EXP: unary(Math.exp),
    LN: domain((x) => x > 0, Math.log),
    LOG10: domain((x) => x > 0, Math.log10),
    LOG: { p: ['v', 'v'], min: 1, max: 2, fn: ([x, base], ctx) => {
      const a = num(x, ctx), b = given(base) ? num(base, ctx) : 10;
      if (a <= 0 || b <= 0) throw ERR.NUM;
      if (b === 1) throw ERR.DIV0;
      return finite(logOf(a, b));
    } },
    PI: { p: [], min: 0, max: 0, fn: () => Math.PI },
    RADIANS: unary((x) => (x * Math.PI) / 180),
    DEGREES: unary((x) => (x * 180) / Math.PI),
    SIN: unary(Math.sin), COS: unary(Math.cos), TAN: unary(Math.tan), ATAN: unary(Math.atan),
    ASIN: domain((x) => x >= -1 && x <= 1, Math.asin),
    ACOS: domain((x) => x >= -1 && x <= 1, Math.acos),
    // Excel's order: the x coordinate first.
    ATAN2: { p: ['v', 'v'], min: 2, max: 2, fn: ([x, y], ctx) => {
      const a = num(x, ctx), b = num(y, ctx);
      if (a === 0 && b === 0) throw ERR.DIV0;
      return Math.atan2(b, a);
    } },
    SINH: unary(Math.sinh), COSH: unary(Math.cosh), TANH: unary(Math.tanh),

    RAND: { p: [], min: 0, max: 0, volatile: true, fn: (args, ctx) => ctx.random() },
    // A whole number from bottom (rounded up) to top (rounded down).
    RANDBETWEEN: { p: ['v', 'v'], min: 2, max: 2, volatile: true, fn: ([bottom, top], ctx) => {
      const lo = Math.ceil(num(bottom, ctx)), hi = Math.floor(num(top, ctx));
      if (lo > hi) throw ERR.NUM;
      return lo + Math.floor(ctx.random() * (hi - lo + 1));
    } },

    FACT: { ...ONE, fn: ([x], ctx) => {
      const value = num(x, ctx), n = Math.trunc(value);
      if (value < 0) throw ERR.NUM;
      let p = 1;
      for (let i = 2; i <= n && Number.isFinite(p); i++) p *= i;
      return finite(p);
    } },
    FACTDOUBLE: { ...ONE, fn: ([x], ctx) => {
      const value = num(x, ctx), n = Math.trunc(value);
      if (value < -1) throw ERR.NUM;
      let p = 1;
      for (let i = n; i > 1 && Number.isFinite(p); i -= 2) p *= i;
      return finite(p);
    } },
    GCD: { p: ['r'], min: 1, fn: (args, ctx) => naturals(args, ctx).reduce(gcd, 0) },
    LCM: { p: ['r'], min: 1, fn: (args, ctx) => {
      let l = 1;
      for (const n of naturals(args, ctx)) {
        if (n === 0) return 0;
        l = (l / gcd(l, n)) * n;
        if (l >= MAX_INT) throw ERR.NUM;
      }
      return l;
    } },

    BASE: { p: ['v', 'v', 'v'], min: 2, max: 3, fn: ([x, radix, min], ctx) => {
      const n = whole(x, ctx), r = whole(radix, ctx), len = given(min) ? whole(min, ctx) : 0;
      if (n < 0 || n >= MAX_INT || r < 2 || r > 36 || len < 0 || len > 255) throw ERR.NUM;
      return n.toString(r).toUpperCase().padStart(len, '0');
    } },
    DECIMAL: { p: ['v', 'v'], min: 2, max: 2, fn: ([t, radix], ctx) => {
      const s = text(t), r = whole(radix, ctx);
      if (r < 2 || r > 36 || s.length > 255) throw ERR.NUM;
      let n = 0;
      for (const ch of s) {
        const d = parseInt(ch, 36);
        if (Number.isNaN(d) || d >= r) throw ERR.NUM;
        n = n * r + d;
      }
      return finite(n);
    } },
    // Form 0 (or TRUE) classic to 4 (or FALSE) simplified.
    ROMAN: { p: ['v', 'v'], min: 1, max: 2, fn: ([x, form], ctx) => {
      let n = whole(x, ctx);
      const f = typeof form === 'boolean' ? (form ? 0 : 4) : given(form) ? whole(form, ctx) : 0;
      if (n < 0 || n > 3999 || f < 0 || f > 4) throw ERR.VALUE;
      let s = '';
      for (const [v, letters] of ROMAN_FORMS[f]) while (n >= v) { s += letters; n -= v; }
      return s;
    } },
    // Any order of numerals, a smaller one before a larger subtracted; a leading - negates; spaces around are ignored.
    ARABIC: { ...ONE, fn: ([t]) => {
      if (t !== null && typeof t !== 'string') throw ERR.VALUE;
      let s = (t ?? '').replace(/^ +| +$/g, '').toUpperCase();
      if (s === '') return 0;
      const sign = s[0] === '-' ? -1 : 1;
      if (sign < 0) s = s.slice(1);
      if (s === '' || s.length > 255) throw ERR.VALUE;
      const vals = [...s].map((ch) => { const v = ROMAN_VALUE.get(ch); if (!v) throw ERR.VALUE; return v; });
      let n = 0;
      vals.forEach((v, i) => { n += i + 1 < vals.length && v < vals[i + 1] ? -v : v; });
      return sign * n;
    } },

    // Options: 0-3 leave out nested subtotals; 1, 3, 5, 7 hidden rows; 2, 3, 6, 7 error values. Functions 1-13 take
    // references; 14-19 an array (a calculated one leaves out only errors) and k.
    AGGREGATE: { p: ['v', 'v', 'a'], min: 3, fn: ([fnum, option, ...refs], ctx) => {
      const f = whole(fnum, ctx), o = whole(option, ctx);
      if (!(f >= 1 && f <= 19) || !(o >= 0 && o <= 7)) throw ERR.VALUE;
      const skip = { row: o % 2 ? hiddenRow : null, errors: [2, 3, 6, 7].includes(o), nested: o <= 3 };
      if (f <= 13) return finite(AGG[f](referenced(refs, ctx, skip)));
      if (refs.length !== 2) throw ERR.VALUE;
      const [array, kArg] = refs;
      if (isErr(array)) throw array;
      if (array instanceof Areas) throw ERR.VALUE;
      const vals = array instanceof Ref ? collect(array, ctx, skip) : grid(array, ctx).flat().filter((v) => v !== null && !(skip.errors && isErr(v)));
      // Sort once for the whole k array; repeating the sort per rank becomes quadratic for vector queries.
      const xs = sorted(vals);
      return map([ctx.value(kArg)], (k) => {
        if (isErr(k)) return k;
        try { return finite(AGG[f](xs, num(k, ctx))); } catch (e) { if (isErr(e)) return e; throw e; }
      });
    } },
    // 1-11 leave out filtered rows, 101-111 every hidden row; nested subtotals are always left out.
    SUBTOTAL: { p: ['v', 'r'], min: 2, fn: ([fnum, ...refs], ctx) => {
      const f = whole(fnum, ctx), base = f > 100 ? f - 100 : f;
      if (!(base >= 1 && base <= 11) || (f > 11 && f < 101)) throw ERR.VALUE;
      return finite(AGG[base](referenced(refs, ctx, { row: f > 100 ? hiddenRow : filteredRow, errors: false, nested: true })));
    } },

    SERIESSUM: { p: ['v', 'v', 'v', 'r'], min: 4, max: 4, fn: ([x, n, m, coefficients], ctx) => {
      const a = num(x, ctx), p = num(n, ctx), step = num(m, ctx);
      let s = 0, i = 0;
      for (const row of grid(coefficients, ctx)) for (const c of row) {
        if (isErr(c)) throw c;
        if (c !== null && typeof c !== 'number') throw ERR.VALUE;
        s += (c ?? 0) * a ** (p + i++ * step);
      }
      return finite(s);
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_MATH2; else GZ_SHEET_FN_MATH2;
