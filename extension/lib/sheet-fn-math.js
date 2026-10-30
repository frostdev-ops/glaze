// Glaze Sheets' math and aggregate functions: SUM AVERAGE COUNT COUNTA COUNTBLANK MIN MAX ROUND ROUNDUP ROUNDDOWN INT
// MOD ABS SQRT POWER SUMIF SUMIFS COUNTIF COUNTIFS AVERAGEIF, registered with the calc engine (sheet-calc.js define).
// Aggregates follow Excel: a typed argument counts text that reads as a number and booleans (and errors on other text),
// and an argument left out is 0; a range or array counts its numbers only. Any error read is the result.
// Classic script; module.exports for node.
var GZ_SHEET_FN_MATH = globalThis.GZ_SHEET_FN_MATH || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, isErr, num, power, round, each, eachCell, view, resize, criteria, Ref } = C.lib;

  const numbers = (args, ctx, cb) => {
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (typeof v === 'number') cb(v);
      else if (direct) cb(num(v, ctx));
    });
  };
  const AGG = { p: ['r'], min: 1 };
  const digits = (d) => (d === undefined ? 0 : num(d));
  const rounding = (mode) => ({ p: ['v', 'v'], min: 2, max: 2, fn: ([x, d], ctx) => round(num(x, ctx), digits(d), mode) });
  const finite = (r) => (Number.isFinite(r) ? r : ERR.NUM);

  // The positions criteria ranges (and a sum range) share: every non-blank one, plus whether the rest all match.
  const ranges = (views) => {
    const { rows, cols } = views[0];
    if (views.some((v) => v.rows !== rows || v.cols !== cols)) throw ERR.VALUE;
    const seen = new Set();
    for (const v of views) v.each((i, j) => seen.add(i * cols + j));
    return { rows, cols, seen };
  };
  const conditions = (args, start, ctx) => {
    const tests = [];
    for (let i = start; i + 1 < args.length; i += 2) tests.push({ range: view(args[i], ctx), test: criteria(args[i + 1], ctx) });
    if ((args.length - start) % 2) throw ERR.VALUE;
    return tests;
  };
  const matches = (tests, i, j) => tests.every((t) => t.test(t.range.get(i, j)));

  const FNS = {
    SUM: { ...AGG, fn: (args, ctx) => { let s = 0; numbers(args, ctx, (v) => { s += v; }); return finite(s); } },
    AVERAGE: { ...AGG, fn: (args, ctx) => { let s = 0, n = 0; numbers(args, ctx, (v) => { s += v; n++; }); return n ? finite(s / n) : ERR.DIV0; } },
    MIN: { ...AGG, fn: (args, ctx) => { let m = Infinity; numbers(args, ctx, (v) => { if (v < m) m = v; }); return m === Infinity ? 0 : m; } },
    MAX: { ...AGG, fn: (args, ctx) => { let m = -Infinity; numbers(args, ctx, (v) => { if (v > m) m = v; }); return m === -Infinity ? 0 : m; } },
    // Numbers, and typed booleans, number text and arguments left out; errors and other text are passed over.
    COUNT: { ...AGG, fn: (args, ctx) => {
      const reads = (v) => { try { num(v, ctx); return true; } catch { return false; } };
      let n = 0;
      for (const a of args) each(a, ctx, (v, direct) => { if (typeof v === 'number' || (direct && (v === null || typeof v === 'boolean' || (typeof v === 'string' && reads(v))))) n++; });
      return n;
    } },
    COUNTA: { ...AGG, fn: (args, ctx) => { let n = 0; for (const a of args) each(a, ctx, (v, direct) => { if (v !== null || direct) n++; }); return n; } },
    // Blank cells and empty text.
    COUNTBLANK: { p: ['r'], min: 1, max: 1, fn: ([a], ctx) => {
      if (a instanceof Ref) { let filled = 0; eachCell(a, ctx, (v) => { if (v !== null && v !== '') filled++; }); return a.rows * a.cols - filled; }
      if (Array.isArray(a)) return a.flat().filter((v) => v === null || v === '').length;
      throw ERR.VALUE;
    } },

    ROUND: rounding('half'),
    ROUNDUP: rounding('up'),
    ROUNDDOWN: rounding('down'),
    INT: { p: ['v'], min: 1, max: 1, fn: ([x], ctx) => Math.floor(num(x, ctx)) },
    // Excel 16.114.1 refuses a quotient of 1.1259E+12 or more.
    MOD: { p: ['v', 'v'], min: 2, max: 2, fn: ([n, d], ctx) => {
      const a = num(n, ctx), b = num(d, ctx);
      if (b === 0) throw ERR.DIV0;
      if (Math.abs(a / b) >= 1.1259e12) throw ERR.NUM;
      return finite(a - b * Math.floor(a / b)) || 0;
    } },
    ABS: { p: ['v'], min: 1, max: 1, fn: ([x], ctx) => Math.abs(num(x, ctx)) },
    SQRT: { p: ['v'], min: 1, max: 1, fn: ([x], ctx) => { const a = num(x, ctx); if (a < 0) throw ERR.NUM; return Math.sqrt(a); } },
    POWER: { p: ['v', 'v'], min: 2, max: 2, fn: ([b, e], ctx) => { const r = power(num(b, ctx), num(e, ctx)); if (isErr(r)) throw r; return finite(r); } },

    // The sum range is the criteria range's size from the sum range's corner, as Excel takes it.
    SUMIF: { p: ['r', 'v', 'r'], min: 2, max: 3, fn: ([range, crit, sum], ctx) => {
      const R = view(range, ctx), test = criteria(crit, ctx);
      const S = sum === undefined || sum === null ? R : view(resize(sum, R.rows, R.cols), ctx);
      const { cols, seen } = ranges(test(null) ? [R, S] : [R]);
      let s = 0;
      for (const p of seen) {
        const i = Math.floor(p / cols), j = p % cols;
        if (!test(R.get(i, j))) continue;
        const v = S.get(i, j);
        if (isErr(v)) throw v;
        if (typeof v === 'number') s += v;
      }
      return finite(s);
    } },
    SUMIFS: { p: ['r', 'r', 'v'], rep: 2, min: 3, fn: (args, ctx) => {
      const S = view(args[0], ctx), tests = conditions(args, 1, ctx);
      ranges([S, ...tests.map((t) => t.range)]);
      let s = 0;
      S.each((i, j, v) => {
        if (!matches(tests, i, j)) return;
        if (isErr(v)) throw v;
        if (typeof v === 'number') s += v;
      });
      return finite(s);
    } },
    COUNTIF: { p: ['r', 'v'], min: 2, max: 2, fn: ([range, crit], ctx) => {
      const R = view(range, ctx), test = criteria(crit, ctx);
      let n = 0, filled = 0;
      R.each((i, j, v) => { filled++; if (test(v)) n++; });
      return test(null) ? n + R.rows * R.cols - filled : n;
    } },
    COUNTIFS: { p: ['r', 'v'], rep: 2, min: 2, fn: (args, ctx) => {
      const tests = conditions(args, 0, ctx);
      const { rows, cols, seen } = ranges(tests.map((t) => t.range));
      let n = 0;
      for (const p of seen) if (matches(tests, Math.floor(p / cols), p % cols)) n++;
      if (tests.every((t) => t.test(null))) n += rows * cols - seen.size;
      return n;
    } },
    AVERAGEIF: { p: ['r', 'v', 'r'], min: 2, max: 3, fn: ([range, crit, avg], ctx) => {
      const R = view(range, ctx), test = criteria(crit, ctx);
      const S = avg === undefined || avg === null ? R : view(resize(avg, R.rows, R.cols), ctx);
      const { cols, seen } = ranges(test(null) ? [R, S] : [R]);
      let s = 0, n = 0;
      for (const p of seen) {
        const i = Math.floor(p / cols), j = p % cols;
        if (!test(R.get(i, j))) continue;
        const v = S.get(i, j);
        if (isErr(v)) throw v;
        if (typeof v === 'number') { s += v; n++; }
      }
      return n ? finite(s / n) : ERR.DIV0;
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_MATH; else GZ_SHEET_FN_MATH;
