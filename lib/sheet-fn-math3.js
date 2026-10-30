// Glaze Sheets' further math and matrix functions: ACOSH ASINH ATANH COT CSC SEC ACOT COTH CSCH SECH ACOTH
// CEILING.PRECISE FLOOR.PRECISE ISO.CEILING SQRTPI COMBINA PERMUTATIONA MULTINOMIAL SUMX2MY2 SUMX2PY2 SUMXMY2 MMULT
// MDETERM MINVERSE MUNIT, registered with the calc engine (sheet-calc.js define). Excel's rules: COT CSC SEC refuse
// |x| >= 2^27 (#NUM!); ACOSH and ASINH square their number, so past about 1.34E+154 they overflow (#NUM!); ACOT runs
// from 0 to pi. The PRECISE roundings ignore significance's sign and read the quotient at 15 digits. The SUMX
// functions pair two ranges of one count by position, skip a pair holding a non-number, and divide by zero with no
// pair left (a one-cell reference to a blank is #VALUE!). MDETERM and MINVERSE factor by LU with partial pivoting: an exactly zero pivot makes the determinant 0 and
// the inverse #NUM!. The matrix functions take numbers only (#VALUE! for text, logicals or blanks); results are arrays.
// Classic script; module.exports for node.
var GZ_SHEET_FN_MATH3 = globalThis.GZ_SHEET_FN_MATH3 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { ERR, isErr, num, each, toArray, view, Ref, Areas } = C.lib;

  const finite = (x) => { if (!Number.isFinite(x)) throw ERR.NUM; return x || 0; };
  const given = (v) => v !== undefined && v !== null;
  const digits15 = (x) => (Number.isFinite(x) && x !== 0 ? Number(x.toPrecision(15)) : x);
  // x rounded by `to` to a whole number of steps.
  const steps = (x, step, to) => digits15(to(digits15(x / step)) * step);
  const MAX_INT = 2 ** 53;
  const TRIG_LIMIT = 2 ** 27;
  const INT_LIMIT = 2 ** 31 - 1;

  const ONE = { p: ['v'], min: 1, max: 1 };
  const unary = (f) => ({ ...ONE, fn: ([x], ctx) => finite(f(num(x, ctx))) });
  const nonzero = (d) => { if (d === 0) throw ERR.DIV0; return d; };
  const trig = (f) => unary((x) => { if (Math.abs(x) >= TRIG_LIMIT) throw ERR.NUM; return f(x); });
  // x² as Excel forms it for ACOSH and ASINH: an overflow is #NUM!.
  const square = (x) => { const s = x * x; if (!Number.isFinite(s)) throw ERR.NUM; return s; };

  // Significance's absolute value, 1 when left out; a zero number or significance gives 0.
  const precise = (to) => ({ p: ['v', 'v'], min: 1, max: 2, fn: ([x, s], ctx) => {
    const a = num(x, ctx), b = given(s) ? Math.abs(num(s, ctx)) : 1;
    if (a === 0 || b === 0) return 0;
    return finite(steps(a, b, to));
  } });

  // n choose k for whole numbers, as a product that stops once it overflows.
  const choose = (n, k) => {
    k = Math.min(k, n - k);
    let c = 1;
    for (let i = 1; i <= k && Number.isFinite(c); i++) c = (c * (n - k + i)) / i;
    return c < MAX_INT ? Math.round(c) : c;
  };
  // 0! to 170!, the last factorial short of overflow.
  const FACTS = [1];
  for (let i = 1; i <= 170; i++) FACTS.push(FACTS[i - 1] * i);
  const whole = (v, ctx) => Math.trunc(num(v, ctx));

  // Number pairs at the same position of two ranges or arrays of one count (#N/A otherwise); a pair holding a
  // non-number is skipped, an error is the result.
  const pairs = (a, b, ctx) => {
    const A = view(a, ctx), B = view(b, ctx);
    if (A.rows * A.cols !== B.rows * B.cols) throw ERR.NA;
    const filled = new Set();
    A.each((i, j) => filled.add(i * A.cols + j));
    B.each((i, j) => filled.add(i * B.cols + j));
    const xs = [], ys = [];
    for (const k of [...filled].sort((p, q) => p - q)) {
      const x = A.get(Math.floor(k / A.cols), k % A.cols), y = B.get(Math.floor(k / B.cols), k % B.cols);
      if (isErr(x)) throw x;
      if (isErr(y)) throw y;
      if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); }
    }
    if (!xs.length) throw ERR.DIV0;
    return [xs, ys];
  };
  // A one-cell reference to a blank is #VALUE!, as in Excel.
  const blankCell = (a, ctx) => a instanceof Ref && a.rows === 1 && a.cols === 1 && ctx.read(a.sheet, a.r0, a.c0) === null;
  const paired = (f) => ({ p: ['a', 'a'], min: 2, max: 2, fn: ([a, b], ctx) => {
    if (isErr(a)) throw a;
    if (isErr(b)) throw b;
    if (blankCell(a, ctx) || blankCell(b, ctx)) throw ERR.VALUE;
    const [xs, ys] = pairs(a, b, ctx);
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += f(xs[i], ys[i]);
    return finite(s);
  } });

  // A range, array or value as a matrix of numbers: an error is the result, any other non-number #VALUE!.
  const matrix = (a, ctx) => {
    if (isErr(a)) throw a;
    if (a instanceof Areas) throw ERR.VALUE;
    let g = a;
    if (a instanceof Ref) { g = toArray(a, ctx); if (isErr(g)) throw g; }
    else if (!Array.isArray(a)) g = [[a]];
    for (const row of g) for (const v of row) {
      if (isErr(v)) throw v;
      if (typeof v !== 'number') throw ERR.VALUE;
    }
    return g;
  };
  const squareOnly = (g) => { if (g.length !== g[0].length) throw ERR.VALUE; return g; };
  // LU factors of a square matrix with partial pivoting (rows swapped for the largest pivot): L below the diagonal, U
  // on and above it, the row order, the swaps' sign, and whether a pivot was exactly zero.
  const lu = (g) => {
    const n = g.length, a = g.map((row) => row.slice()), order = [...Array(n).keys()];
    let sign = 1, singular = false;
    for (let k = 0; k < n; k++) {
      let p = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
      if (p !== k) { [a[p], a[k]] = [a[k], a[p]]; [order[p], order[k]] = [order[k], order[p]]; sign = -sign; }
      if (a[k][k] === 0) { singular = true; continue; }
      for (let i = k + 1; i < n; i++) {
        const f = (a[i][k] /= a[k][k]);
        if (f !== 0) for (let j = k + 1; j < n; j++) a[i][j] -= f * a[k][j];
      }
    }
    return { a, order, sign, singular };
  };
  const finiteAll = (g) => { for (const row of g) for (const v of row) if (!Number.isFinite(v)) throw ERR.NUM; return g; };

  const FNS = {
    ACOSH: unary((x) => { if (x < 1) throw ERR.NUM; return Math.log(x + Math.sqrt(square(x) - 1)); }),
    // ln(|x| + √(x²+1)) with x's sign: a tiny number's 1 + x² is 1, so its ASINH is 0, as in Excel.
    ASINH: unary((x) => Math.sign(x) * Math.log(Math.abs(x) + Math.sqrt(square(x) + 1))),
    ATANH: unary((x) => { if (!(Math.abs(x) < 1)) throw ERR.NUM; return Math.atanh(x); }),
    ACOTH: unary((x) => { if (!(Math.abs(x) > 1)) throw ERR.NUM; return Math.atanh(1 / x); }),
    COT: trig((x) => Math.cos(x) / nonzero(Math.sin(x))),
    CSC: trig((x) => 1 / nonzero(Math.sin(x))),
    SEC: trig((x) => 1 / Math.cos(x)),
    ACOT: unary((x) => (x === 0 ? Math.PI / 2 : x > 0 ? Math.atan(1 / x) : Math.PI + Math.atan(1 / x))),
    COTH: unary((x) => 1 / Math.tanh(nonzero(x))),
    CSCH: unary((x) => 1 / Math.sinh(nonzero(x))),
    SECH: unary((x) => 1 / Math.cosh(x)),

    'CEILING.PRECISE': precise(Math.ceil),
    'ISO.CEILING': precise(Math.ceil),
    'FLOOR.PRECISE': precise(Math.floor),
    SQRTPI: unary((x) => { if (x < 0) throw ERR.NUM; return Math.sqrt(x * Math.PI); }),

    // Combinations with repetition, C(n+k-1, k); none chosen from none is 1.
    COMBINA: { p: ['v', 'v'], min: 2, max: 2, fn: ([n, k], ctx) => {
      const rawN = num(n, ctx), rawK = num(k, ctx);
      if (rawN < 0 || rawK < 0) throw ERR.NUM;
      const a = Math.trunc(rawN), b = Math.trunc(rawK);
      if (a < 0 || b < 0 || (a === 0 && b > 0) || a >= MAX_INT || a - 1 >= MAX_INT - b) throw ERR.NUM;
      return a === 0 ? 1 : finite(choose(a + b - 1, b));
    } },
    PERMUTATIONA: { p: ['v', 'v'], min: 2, max: 2, fn: ([n, k], ctx) => {
      const rawN = num(n, ctx), rawK = num(k, ctx);
      if (rawN < 0 || rawK < 0) throw ERR.NUM;
      const a = Math.trunc(rawN), b = Math.trunc(rawK);
      if (a < 0 || b < 0 || a >= INT_LIMIT || b >= INT_LIMIT) throw ERR.NUM;
      return finite(a ** b);
    } },
    // (Σn)! / Πn! of the numbers truncated; a negative is #NUM!, as is a sum whose factorial overflows (past 170). A
    // range's text or logicals are #VALUE!, its blanks left out.
    MULTINOMIAL: { p: ['r'], min: 1, fn: (args, ctx) => {
      let sum = 0, product = 1;
      for (const a of args) each(a, ctx, (v, direct) => {
        if (isErr(v)) throw v;
        if (typeof v === 'boolean' || (!direct && typeof v !== 'number')) throw ERR.VALUE;
        const x = num(v, ctx);
        if (x < 0) throw ERR.NUM;
        const n = Math.trunc(x);
        sum += n;
        if (sum > 170) throw ERR.NUM;
        product *= FACTS[n];
      });
      return finite(FACTS[sum] / product);
    } },

    SUMX2MY2: paired((x, y) => x * x - y * y),
    SUMX2PY2: paired((x, y) => x * x + y * y),
    SUMXMY2: paired((x, y) => (x - y) ** 2),

    MMULT: { p: ['a', 'a'], min: 2, max: 2, fn: ([a, b], ctx) => {
      const A = matrix(a, ctx), B = matrix(b, ctx), n = A[0].length, cols = B[0].length;
      if (n !== B.length) throw ERR.VALUE;
      if (A.length * cols > M.CAP.cells) throw ERR.NUM;
      return finiteAll(A.map((row) => {
        const out = new Array(cols).fill(0);
        for (let j = 0; j < cols; j++) for (let k = 0; k < n; k++) out[j] += row[k] * B[k][j];
        return out;
      }));
    } },
    MDETERM: { p: ['a'], min: 1, max: 1, fn: ([a], ctx) => {
      const { a: f, sign, singular } = lu(squareOnly(matrix(a, ctx)));
      if (singular) return 0;
      let d = sign;
      for (let i = 0; i < f.length; i++) d *= f[i][i];
      return finite(d);
    } },
    // Each column of the identity solved through the LU factors.
    MINVERSE: { p: ['a'], min: 1, max: 1, fn: ([a], ctx) => {
      const { a: f, order, singular } = lu(squareOnly(matrix(a, ctx))), n = f.length;
      if (singular) throw ERR.NUM;
      const out = f.map(() => new Array(n));
      for (let c = 0; c < n; c++) {
        const y = order.map((r) => (r === c ? 1 : 0));
        for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) y[i] -= f[i][j] * y[j];
        for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) y[i] -= f[i][j] * y[j]; y[i] /= f[i][i]; }
        for (let i = 0; i < n; i++) out[i][c] = y[i];
      }
      return finiteAll(out);
    } },
    MUNIT: { ...ONE, fn: ([d], ctx) => {
      const n = whole(d, ctx);
      if (n < 1) throw ERR.VALUE;
      if (n * n > M.CAP.cells) throw ERR.NUM;
      return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i === j ? 1 : 0)));
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_MATH3; else GZ_SHEET_FN_MATH3;
