// Glaze Sheets' statistical functions, registered with the calc engine (sheet-calc.js define): AVERAGEA AVERAGEIFS
// MEDIAN MODE.SNGL STDEV.S STDEV.P STDEVA STDEVPA VAR.S VAR.P VARA VARPA LARGE SMALL RANK.EQ RANK.AVG PERCENTILE.INC
// PERCENTILE.EXC QUARTILE.INC QUARTILE.EXC MAXA MINA MAXIFS MINIFS GEOMEAN HARMEAN TRIMMEAN AVEDEV DEVSQ CORREL PEARSON
// COVARIANCE.P COVARIANCE.S SLOPE INTERCEPT RSQ FORECAST.LINEAR NORM.DIST NORM.S.DIST NORM.INV NORM.S.INV STANDARDIZE
// PERMUT COMBIN FREQUENCY, and the legacy names MODE STDEV STDEVP VAR VARP RANK PERCENTILE QUARTILE FORECAST.
// Excel's rules: ranges and arrays give their numbers only; typed arguments also give booleans and text that reads as
// a number (other text is #VALUE!), and an argument left out is 0. The A variants also read text in a range as 0 and
// booleans as 1 and 0. Pair functions skip a position unless both values there are numbers. Any error read is the
// result.
// Classic script; module.exports for node.
var GZ_SHEET_FN_STATS = globalThis.GZ_SHEET_FN_STATS || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, isErr, num, bool, round, same, each, view, criteria } = C.lib;

  // ── Reading arguments ───────────────────────────────────────────────────────────────────────────────────────────────
  const numbers = (args, ctx) => {
    const out = [];
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (typeof v === 'number') out.push(v);
      else if (direct) out.push(v === null ? 0 : num(v, ctx));
    }, true);
    return out;
  };
  const values = (args, ctx, arrayText = false) => {
    const out = [];
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (typeof v === 'number') out.push(v);
      // Excel's A functions count text and logicals in references, but array constants give numbers only.
      // AVERAGEA alone also counts an array's text as zero.
      else if (Array.isArray(a)) { if (arrayText && typeof v === 'string') out.push(0); }
      else if (typeof v === 'boolean') out.push(v ? 1 : 0);
      else if (direct) out.push(v === null ? 0 : num(v, ctx));
      else out.push(0);
    }, true);
    return out;
  };
  const ascending = (xs) => xs.sort((a, b) => a - b);
  // Keep the smaller tail in a heap, with its least desirable value at the root. No full sort, recursion, or
  // input-dependent quadratic partitioning: O(n log min(k, n-k+1)) work and the collected input's storage only.
  const select = (xs, index) => {
    const upper = index > (xs.length - 1) / 2, size = upper ? xs.length - index : index + 1;
    const worse = upper ? (a, b) => a < b : (a, b) => a > b;
    const sift = (root) => {
      const x = xs[root];
      for (let child = root * 2 + 1; child < size; child = root * 2 + 1) {
        if (child + 1 < size && worse(xs[child + 1], xs[child])) child++;
        if (!worse(xs[child], x)) break;
        xs[root] = xs[child]; root = child;
      }
      xs[root] = x;
    };
    for (let i = (size >> 1) - 1; i >= 0; i--) sift(i);
    for (let i = size; i < xs.length; i++) if (worse(xs[0], xs[i])) { xs[0] = xs[i]; sift(0); }
    return xs[0];
  };
  // Two ranges or arrays of one size (else #N/A), as the numbers at the positions where both hold one.
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
    return [xs, ys];
  };
  // The values of the first range where each later range (of its size and shape, else #VALUE!) meets its criteria.
  const matching = (args, ctx) => {
    if ((args.length - 1) % 2) throw ERR.VALUE;
    const T = view(args[0], ctx), tests = [];
    for (let i = 1; i < args.length; i += 2) {
      const R = view(args[i], ctx);
      if (R.rows !== T.rows || R.cols !== T.cols) throw ERR.VALUE;
      tests.push([R, criteria(args[i + 1], ctx)]);
    }
    const out = [];
    T.each((i, j, v) => {
      if (!tests.every(([R, test]) => test(R.get(i, j)))) return;
      if (isErr(v)) throw v;
      if (typeof v === 'number') out.push(v);
    });
    return out;
  };

  // ── Arithmetic ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const finite = (r) => (Number.isFinite(r) ? r : ERR.NUM);
  const sum = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
  const mean = (xs) => sum(xs) / xs.length;
  const extreme = (xs, largest) => { let best = xs[0] ?? 0; for (const x of xs) if (largest ? x > best : x < best) best = x; return best; };
  const devsq = (xs) => { const m = mean(xs); let s = 0; for (const x of xs) s += (x - m) * (x - m); return s; };
  const variance = (xs, sample) => { const n = xs.length; if (n < (sample ? 2 : 1)) throw ERR.DIV0; return devsq(xs) / (sample ? n - 1 : n); };
  // Σ(x - x̄)(y - ȳ), Σ(x - x̄)², Σ(y - ȳ)² and the means of paired values.
  const moments = (xs, ys) => {
    const n = xs.length;
    if (!n) throw ERR.DIV0;
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    return { n, mx, my, sxy, sxx, syy };
  };
  const correl = (xs, ys) => { const m = moments(xs, ys); if (!m.sxx || !m.syy) throw ERR.DIV0; return (m.sxy / Math.sqrt(m.sxx)) / Math.sqrt(m.syy); };
  const line = (ys, xs) => { const m = moments(xs, ys); if (!m.sxx) throw ERR.DIV0; const slope = m.sxy / m.sxx; return { slope, intercept: m.my - slope * m.mx }; };

  // Percentiles of sorted xs: INC places k over [x1, xn] at rank k(n-1); EXC over rank k(n+1), refusing ranks outside
  // [1, n]. Between two ranks, linear interpolation.
  const inc = (xs, k) => {
    const n = xs.length;
    if (!n || k < 0 || k > 1) throw ERR.NUM;
    const h = k * (n - 1), lo = Math.floor(h);
    return lo + 1 < n ? xs[lo] + (h - lo) * (xs[lo + 1] - xs[lo]) : xs[n - 1];
  };
  const exc = (xs, k) => {
    const n = xs.length;
    if (!n || k <= 0 || k >= 1) throw ERR.NUM;
    const h = k * (n + 1), lo = Math.floor(h);
    if (h < 1 || h > n) throw ERR.NUM;
    return lo < n ? xs[lo - 1] + (h - lo) * (xs[lo] - xs[lo - 1]) : xs[n - 1];
  };

  // ── The normal distribution ─────────────────────────────────────────────────────────────────────────────────────────
  // erfc from W. J. Cody, "Rational Chebyshev approximations for the error function", Math. Comp. 23 (1969) 631-638,
  // as in his CALERF (netlib specfun/erf, 1985): erf for |x| <= 0.46875, then erfc as exp(-x²) times a rational in x
  // (to 4) or in 1/x², exp(-x²) split in two so its rounding stays small.
  const EA = [3.16112374387056560e0, 1.13864154151050156e2, 3.77485237685302021e2, 3.20937758913846947e3, 1.85777706184603153e-1];
  const EB = [2.36012909523441209e1, 2.44024637934444173e2, 1.28261652607737228e3, 2.84423683343917062e3];
  const EC = [5.64188496988670089e-1, 8.88314979438837594e0, 6.61191906371416295e1, 2.98635138197400131e2, 8.81952221241769090e2,
    1.71204761263407058e3, 2.05107837782607147e3, 1.23033935479799725e3, 2.15311535474403846e-8];
  const ED = [1.57449261107098347e1, 1.17693950891312499e2, 5.37181101862009858e2, 1.62138957456669019e3, 3.29079923573345963e3,
    4.36261909014324716e3, 3.43936767414372164e3, 1.23033935480374942e3];
  const EP = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4,
    1.63153871373020978e-2];
  const EQ = [2.56852019228982242e0, 1.87295284992346047e0, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
  const SQRPI = 5.6418958354775628695e-1;
  const erfc = (x) => {
    const y = Math.abs(x);
    if (y <= 0.46875) {
      const ysq = y > 1.11e-16 ? y * y : 0;
      let n = EA[4] * ysq, d = ysq;
      for (let i = 0; i < 3; i++) { n = (n + EA[i]) * ysq; d = (d + EB[i]) * ysq; }
      return 1 - (x * (n + EA[3])) / (d + EB[3]);
    }
    let r = 0;
    if (y <= 4) {
      let n = EC[8] * y, d = y;
      for (let i = 0; i < 7; i++) { n = (n + EC[i]) * y; d = (d + ED[i]) * y; }
      r = (n + EC[7]) / (d + ED[7]);
    } else if (y < 26.543) {
      const ysq = 1 / (y * y);
      let n = EP[5] * ysq, d = ysq;
      for (let i = 0; i < 4; i++) { n = (n + EP[i]) * ysq; d = (d + EQ[i]) * ysq; }
      r = (SQRPI - (ysq * (n + EP[4])) / (d + EQ[4])) / y;
    }
    if (r) { const ysq = Math.trunc(y * 16) / 16, del = (y - ysq) * (y + ysq); r = Math.exp(-ysq * ysq) * Math.exp(-del) * r; }
    return x < 0 ? 2 - r : r;
  };
  const cdf = (z) => 0.5 * erfc(-z / Math.SQRT2);
  const pdf = (z) => {
    const square = z * z;
    if (!Number.isFinite(square)) throw ERR.NUM;
    return Math.exp(-0.5 * square) / Math.sqrt(2 * Math.PI);
  };
  // The inverse of cdf from M. J. Wichura, "Algorithm AS 241: The percentage points of the normal distribution",
  // Applied Statistics 37 (1988) 477-484 (PPND16, about 16 digits), with its coefficients as CPython's statistics module
  // gives them.
  const poly = (cs, x) => { let s = 0; for (const c of cs) s = s * x + c; return s; };
  const IA = [2.5090809287301226727e3, 3.3430575583588128105e4, 6.7265770927008700853e4, 4.5921953931549871457e4, 1.3731693765509461125e4,
    1.9715909503065514427e3, 1.3314166789178437745e2, 3.3871328727963666080e0];
  const IB = [5.2264952788528545610e3, 2.8729085735721942674e4, 3.9307895800092710610e4, 2.1213794301586595867e4, 5.3941960214247511077e3,
    6.8718700749205790830e2, 4.2313330701600911252e1, 1.0];
  const IC = [7.7454501427834140764e-4, 2.2723844989269184583e-2, 2.4178072517745061177e-1, 1.2704582524523683826e0, 3.6478483247632045260e0,
    5.7694972214606914055e0, 4.6303378461565452959e0, 1.4234371107496835773e0];
  const ID = [1.0507500716444168432e-9, 5.4759380849953449460e-4, 1.5198666563616457197e-2, 1.4810397642748007459e-1, 6.8976733498510000455e-1,
    1.6763848301838038494e0, 2.0531916266377588219e0, 1.0];
  const IE = [2.0103343992922881326e-7, 2.7115555687434875782e-5, 1.2426609473880784386e-3, 2.6532189526576123093e-2, 2.9656057182850489123e-1,
    1.7848265399172913358e0, 5.4637849111641143699e0, 6.6579046435011037772e0];
  const IF = [2.0442631033899397856e-15, 1.4215117583164458887e-7, 1.8463183175100546818e-5, 7.8686913114561329059e-4, 1.4875361290850615025e-2,
    1.3692988092273580531e-1, 5.9983220655588793769e-1, 1.0];
  const quantile = (p) => {
    const q = p - 0.5;
    if (Math.abs(q) <= 0.425) { const r = 0.180625 - q * q; return (q * poly(IA, r)) / poly(IB, r); }
    let r = Math.sqrt(-Math.log(q < 0 ? p : 1 - p));
    const x = r <= 5 ? (r -= 1.6, poly(IC, r) / poly(ID, r)) : (r -= 5, poly(IE, r) / poly(IF, r));
    return q < 0 ? -x : x;
  };
  const probability = (p) => { if (!(p > 0 && p < 1)) throw ERR.NUM; return p; };
  const spread = (s, ctx) => { const sd = num(s, ctx); if (!(sd > 0)) throw ERR.NUM; return sd; };

  // ── The functions ───────────────────────────────────────────────────────────────────────────────────────────────────
  const AGG = { p: ['r'], min: 1 };
  const over = (read, f) => ({ ...AGG, fn: (args, ctx) => finite(f(read(args, ctx))) });
  const nonempty = (xs, e = ERR.NUM) => { if (!xs.length) throw e; return xs; };
  const positive = (xs) => { if (!xs.length || xs.some((x) => x <= 0)) throw ERR.NUM; return xs; };
  const nth = (largest) => ({ p: ['r', 'v'], min: 2, max: 2, fn: ([a, k], ctx) => {
    const xs = numbers([a], ctx), rank = num(k, ctx);
    if (rank < 1 || rank > xs.length) throw ERR.NUM;
    const i = largest ? Math.ceil(rank) : Math.trunc(rank);
    return select(xs, largest ? xs.length - i : i - 1);
  } });
  const ranking = (average) => ({ p: ['v', 'r', 'v'], min: 2, max: 3, fn: ([x, ref, order], ctx) => {
    const n = num(x, ctx), up = order !== undefined && num(order, ctx) !== 0;
    let ahead = 0, ties = 0;
    for (const v of numbers([ref], ctx)) {
      if (same(v, n)) ties++;
      else if (up ? v < n : v > n) ahead++;
    }
    if (!ties) throw ERR.NA;
    return average ? ahead + (ties + 1) / 2 : ahead + 1;
  } });
  const percentile = (pick) => ({ p: ['r', 'v'], min: 2, max: 2, fn: ([a, k], ctx) => finite(pick(ascending(numbers([a], ctx)), num(k, ctx))) });
  const quartile = (pick, lo, hi) => ({ p: ['r', 'v'], min: 2, max: 2, fn: ([a, q], ctx) => {
    const raw = num(q, ctx), quart = Math.trunc(raw);
    if (raw < 0) throw ERR.NUM;
    if (quart < lo || quart > hi) throw ERR.NUM;
    return finite(pick(ascending(numbers([a], ctx)), quart / 4));
  } });
  const paired = (f) => ({ p: ['r', 'r'], min: 2, max: 2, fn: ([a, b], ctx) => finite(f(...pairs(a, b, ctx))) });
  const ifs = (f) => ({ p: ['r', 'r', 'v'], rep: 2, min: 3, fn: (args, ctx) => f(matching(args, ctx)) });
  const forecast = { p: ['v', 'r', 'r'], min: 3, max: 3, fn: ([x, ys, xs], ctx) => {
    const at = num(x, ctx), { slope, intercept } = line(...pairs(ys, xs, ctx));
    return finite(intercept + slope * at);
  } };

  const FNS = {
    AVERAGEA: over((args, ctx) => values(args, ctx, true), (xs) => mean(nonempty(xs, ERR.DIV0))),
    AVERAGEIFS: ifs((xs) => (xs.length ? finite(mean(xs)) : ERR.DIV0)),
    MAXA: over(values, (xs) => extreme(xs, true)),
    MINA: over(values, (xs) => extreme(xs, false)),
    MAXIFS: ifs((xs) => extreme(xs, true)),
    MINIFS: ifs((xs) => extreme(xs, false)),
    MEDIAN: over(numbers, (xs) => {
      const s = ascending(nonempty(xs)), h = s.length >> 1;
      return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
    }),
    // The value seen most often; of several, the one seen first.
    'MODE.SNGL': over(numbers, (xs) => {
      const counts = new Map();
      for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
      let best = null, most = 1;
      for (const [x, n] of counts) if (n > most) { best = x; most = n; }
      if (best === null) throw ERR.NA;
      return best;
    }),
    'STDEV.S': over(numbers, (xs) => Math.sqrt(variance(xs, true))),
    'STDEV.P': over(numbers, (xs) => Math.sqrt(variance(xs, false))),
    STDEVA: over(values, (xs) => Math.sqrt(variance(xs, true))),
    STDEVPA: over(values, (xs) => Math.sqrt(variance(xs, false))),
    'VAR.S': over(numbers, (xs) => variance(xs, true)),
    'VAR.P': over(numbers, (xs) => variance(xs, false)),
    VARA: over(values, (xs) => variance(xs, true)),
    VARPA: over(values, (xs) => variance(xs, false)),
    LARGE: nth(true),
    SMALL: nth(false),
    'RANK.EQ': ranking(false),
    'RANK.AVG': ranking(true),
    'PERCENTILE.INC': percentile(inc),
    'PERCENTILE.EXC': percentile(exc),
    'QUARTILE.INC': quartile(inc, 0, 4),
    'QUARTILE.EXC': quartile(exc, 1, 3),
    GEOMEAN: over(numbers, (xs) => Math.exp(sum(positive(xs).map(Math.log)) / xs.length)),
    HARMEAN: over(numbers, (xs) => xs.length / sum(positive(nonempty(xs, ERR.NA)).map((x) => 1 / x))),
    // Drops the same count from each end: percent of the points, rounded down to an even number.
    TRIMMEAN: { p: ['r', 'v'], min: 2, max: 2, fn: ([a, pct], ctx) => {
      const xs = ascending(numbers([a], ctx)), p = num(pct, ctx);
      if (p < 0 || p >= 1 || !xs.length) throw ERR.NUM;
      const cut = round((xs.length * p) / 2, 0, 'down');
      return finite(mean(xs.slice(cut, xs.length - cut)));
    } },
    AVEDEV: over(numbers, (xs) => { const m = mean(nonempty(xs)); return sum(xs.map((x) => Math.abs(x - m))) / xs.length; }),
    DEVSQ: over(numbers, (xs) => devsq(nonempty(xs))),
    CORREL: paired(correl),
    PEARSON: paired(correl),
    RSQ: paired((ys, xs) => correl(xs, ys) ** 2),
    'COVARIANCE.P': paired((xs, ys) => moments(xs, ys).sxy / xs.length),
    'COVARIANCE.S': paired((xs, ys) => { if (xs.length < 2) throw ERR.DIV0; return moments(xs, ys).sxy / (xs.length - 1); }),
    SLOPE: paired((ys, xs) => line(ys, xs).slope),
    INTERCEPT: paired((ys, xs) => line(ys, xs).intercept),
    'FORECAST.LINEAR': forecast,
    'NORM.DIST': { p: ['v', 'v', 'v', 'v'], min: 4, max: 4, fn: ([x, m, s, cumulative], ctx) => {
      const z = (num(x, ctx) - num(m, ctx)) / spread(s, ctx);
      return finite(bool(cumulative) ? cdf(z) : pdf(z) / spread(s, ctx));
    } },
    'NORM.S.DIST': { p: ['v', 'v'], min: 2, max: 2, fn: ([z, cumulative], ctx) => { const x = num(z, ctx); return bool(cumulative) ? cdf(x) : pdf(x); } },
    'NORM.INV': { p: ['v', 'v', 'v'], min: 3, max: 3, fn: ([p, m, s], ctx) => {
      const pr = probability(num(p, ctx)), mu = num(m, ctx);
      return finite(mu + spread(s, ctx) * quantile(pr));
    } },
    'NORM.S.INV': { p: ['v'], min: 1, max: 1, fn: ([p], ctx) => quantile(probability(num(p, ctx))) },
    STANDARDIZE: { p: ['v', 'v', 'v'], min: 3, max: 3, fn: ([x, m, s], ctx) => {
      const d = num(x, ctx) - num(m, ctx);
      return finite(d / spread(s, ctx));
    } },
    PERMUT: { p: ['v', 'v'], min: 2, max: 2, fn: ([a, b], ctx) => {
      const rawN = num(a, ctx), rawK = num(b, ctx);
      if (rawN < 0 || rawK < 0) throw ERR.NUM;
      const n = Math.trunc(rawN), k = Math.trunc(rawK);
      if (n < k) throw ERR.NUM;
      let r = 1;
      for (let i = 0; i < k && Number.isFinite(r); i++) r *= n - i;
      return finite(r);
    } },
    COMBIN: { p: ['v', 'v'], min: 2, max: 2, fn: ([a, b], ctx) => {
      const rawN = num(a, ctx), rawK = num(b, ctx);
      if (rawN < 0 || rawK < 0) throw ERR.NUM;
      const n = Math.trunc(rawN), k0 = Math.trunc(rawK);
      if (n < k0) throw ERR.NUM;
      const k = Math.min(k0, n - k0);
      let r = 1;
      for (let i = 1; i <= k && Number.isFinite(r); i++) r = (r / i) * (n - k + i);
      return finite(r < 2 ** 53 ? Math.round(r) : r);
    } },
    // A column one longer than the bins: how many values fall at or below each bin and above the next lower one, then
    // above the highest. Bins count in sorted order and report in theirs.
    FREQUENCY: { p: ['r', 'r'], min: 2, max: 2, fn: ([data, bins], ctx) => {
      const xs = numbers([data], ctx), bs = numbers([bins], ctx);
      const order = bs.map((_, i) => i).sort((i, j) => bs[i] - bs[j]);
      const counts = new Array(bs.length + 1).fill(0);
      for (const x of xs) {
        let lo = 0, hi = order.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (bs[order[mid]] < x) lo = mid + 1; else hi = mid; }
        counts[lo < order.length ? order[lo] : bs.length]++;
      }
      return counts.map((n) => [n]);
    } },
  };
  const LEGACY = { MODE: 'MODE.SNGL', STDEV: 'STDEV.S', STDEVP: 'STDEV.P', VAR: 'VAR.S', VARP: 'VAR.P', RANK: 'RANK.EQ', PERCENTILE: 'PERCENTILE.INC', QUARTILE: 'QUARTILE.INC', FORECAST: 'FORECAST.LINEAR' };
  for (const [old, name] of Object.entries(LEGACY)) FNS[old] = FNS[name];
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return { FNS, erfc, cdf, quantile };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_STATS; else GZ_SHEET_FN_STATS;
