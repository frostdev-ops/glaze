// Glaze Sheets' further statistical functions, registered with the calc engine (sheet-calc.js define): KURT SKEW
// SKEW.P PERCENTRANK.INC PERCENTRANK.EXC MODE.MULT LINEST LOGEST TREND GROWTH STEYX PHI GAUSS FISHER FISHERINV
// CONFIDENCE.NORM CONFIDENCE.T PROB Z.TEST T.TEST GAMMA GAMMALN GAMMALN.PRECISE, the distributions BINOM.DIST BINOM.INV
// BINOM.DIST.RANGE NEGBINOM.DIST HYPGEOM.DIST POISSON.DIST EXPON.DIST WEIBULL.DIST LOGNORM.DIST LOGNORM.INV GAMMA.DIST
// GAMMA.INV BETA.DIST BETA.INV CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT F.DIST F.DIST.RT F.INV F.INV.RT T.DIST
// T.DIST.2T T.DIST.RT T.INV T.INV.2T, and their legacy names. Arguments read as sheet-fn-stats.js reads them; degrees of
// freedom and counts are truncated (Excel 16.114.1).
// The numerics: ln Γ from the Lanczos approximation of Numerical Recipes, 3rd ed. (Press et al. 2007, gammln); binomial
// and Poisson terms by C. Loader, "Fast and accurate computation of binomial probabilities" (2000), as R's
// dbinom_raw, dpois_raw, stirlerr and bd0 have it, which keeps every density and every incomplete function's prefactor to
// a few ulps; the regularized incomplete gamma by its series and continued fraction, the incomplete beta by its
// continued fraction (Numerical Recipes gser, gcf, betacf, modified Lentz); inverses by Newton's method on the log of the
// smaller tail inside a bracket each step narrows. Regression by Householder QR with column pivoting, a column whose
// part outside the others' span is under 1e-12 of its length dropped as collinear (coefficient 0).
// Classic script; module.exports for node.
var GZ_SHEET_FN_STATS2 = globalThis.GZ_SHEET_FN_STATS2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const S = typeof GZ_SHEET_FN_STATS !== 'undefined' ? GZ_SHEET_FN_STATS : require('./sheet-fn-stats.js');
  const { ERR, isErr, num, bool, same, round, each, view, toArray, Ref, Areas } = C.lib;
  const { cdf, quantile } = S;

  const given = (v) => v !== undefined && v !== null;
  const finite = (x) => { if (!Number.isFinite(x)) throw ERR.NUM; return x || 0; };
  const whole = (v, ctx) => Math.trunc(num(v, ctx));
  const numbers = (args, ctx) => {
    const out = [];
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      if (typeof v === 'number') out.push(v);
      else if (direct) out.push(v === null ? 0 : num(v, ctx));
    }, true);
    return out;
  };
  // Two ranges or arrays of one size (else #N/A), as the numbers at the positions where both hold one.
  const pairs = (a, b, ctx) => {
    const P = view(a, ctx), Q = view(b, ctx);
    if (P.rows * P.cols !== Q.rows * Q.cols) throw ERR.NA;
    const xs = [], ys = [];
    for (let k = 0; k < P.rows * P.cols; k++) {
      const x = P.get(Math.floor(k / P.cols), k % P.cols), y = Q.get(Math.floor(k / Q.cols), k % Q.cols);
      if (isErr(x)) throw x;
      if (isErr(y)) throw y;
      if (typeof x === 'number' && typeof y === 'number') { xs.push(x); ys.push(y); }
    }
    return [xs, ys];
  };
  const sum = (xs) => { let s = 0; for (const x of xs) s += x; return s; };
  const mean = (xs) => sum(xs) / xs.length;
  const squares = (xs, m) => { let s = 0; for (const x of xs) s += (x - m) * (x - m); return s; };
  const variance = (xs) => { if (xs.length < 2) throw ERR.DIV0; return squares(xs, mean(xs)) / (xs.length - 1); };

  // ── Γ and Loader's terms ────────────────────────────────────────────────────────────────────────────────────────────
  const LN_SQRT_2PI = 0.918938533204672741780329736406;
  const LANCZOS = [57.1562356658629235, -59.5979603554754912, 14.1360979747417471, -0.491913816097620199, 0.339946499848118887e-4,
    0.465236289270485756e-4, -0.983744753048795646e-4, 0.158088703224912494e-3, -0.210264441724104883e-3, 0.217439618115212643e-3,
    -0.164318106536763890e-3, 0.844182239838527433e-4, -0.261908384015814087e-4, 0.368991826595316234e-5];
  // ln Γ(x) for x > 0.
  const lgamma = (x) => {
    let y = x, ser = 0.999999999999997092;
    const t = x + 5.24218750000000000;
    for (const c of LANCZOS) ser += c / ++y;
    return (x + 0.5) * Math.log(t) - t + (Math.log(2.5066282746310005 * ser) - Math.log(x));
  };
  // sin(πx), exact at whole and half numbers.
  const sinpi = (x) => {
    let r = x % 2;
    if (r > 1) r -= 2; else if (r < -1) r += 2;
    if (r > 0.5) r = 1 - r; else if (r < -0.5) r = -1 - r;
    return Math.sin(Math.PI * r);
  };
  // Γ(x): whole numbers as products; otherwise Γ on [1, 2] times the factors that carry it to x, or by reflection
  // below 1/2. NaN at 0 and the negative whole numbers.
  const gamma = (x) => {
    if (Number.isInteger(x)) {
      if (x <= 0) return NaN;
      let p = 1;
      for (let i = 2; i < x && Number.isFinite(p); i++) p *= i;
      return p;
    }
    if (x < 0.5) return Math.PI / (sinpi(x) * gamma(1 - x));
    if (x < 1) return gamma(x + 1) / x;
    const base = 1 + (x - Math.floor(x));
    let p = Math.exp(lgamma(base));
    for (let k = base; k < x - 0.5 && Number.isFinite(p); k++) p *= k;
    return p;
  };
  const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);

  // ln n! − ln(√(2π) n^(n+½) e^−n).
  const S0 = 1 / 12, S1 = 1 / 360, S2 = 1 / 1260, S3 = 1 / 1680, S4 = 1 / 1188;
  const stirlerr = (n) => {
    if (n <= 15) return lgamma(n + 1) - (n + 0.5) * Math.log(n) + n - LN_SQRT_2PI;
    const nn = n * n;
    if (n > 500) return (S0 - S1 / nn) / n;
    if (n > 80) return (S0 - (S1 - S2 / nn) / nn) / n;
    if (n > 35) return (S0 - (S1 - (S2 - S3 / nn) / nn) / nn) / n;
    return (S0 - (S1 - (S2 - (S3 - S4 / nn) / nn) / nn) / nn) / n;
  };
  // x ln(x / np) + np − x, without the cancellation near x = np.
  const bd0 = (x, np) => {
    if (Math.abs(x - np) < 0.1 * (x + np)) {
      let v = (x - np) / (x + np), s = (x - np) * v;
      if (Math.abs(s) < 2.2250738585072014e-308) return s;
      let ej = 2 * x * v;
      v *= v;
      for (let j = 1; j < 1000; j++) {
        ej *= v;
        const next = s + ej / (2 * j + 1);
        if (next === s) return next;
        s = next;
      }
    }
    return x * Math.log(x / np) + np - x;
  };
  // C(n, x) p^x q^(n−x), for real x and n. The larger of np and nq is n less the smaller, so that a p near 1 counts as
  // 1 − q exactly: raised to a large power, the rounding of p itself would show.
  const dbinom = (x, n, p, q) => {
    if (p === 0) return x === 0 ? 1 : 0;
    if (q === 0) return x === n ? 1 : 0;
    const np = q < 0.5 ? n - n * q : n * p, nq = p < 0.5 ? n - n * p : n * q;
    if (x === 0) return n === 0 ? 1 : Math.exp(p < 0.1 ? -bd0(n, nq) - np : n * Math.log(q));
    if (x === n) return Math.exp(q < 0.1 ? -bd0(n, np) - nq : n * Math.log(p));
    if (x < 0 || x > n) return 0;
    const lc = stirlerr(n) - stirlerr(x) - stirlerr(n - x) - bd0(x, np) - bd0(n - x, nq);
    const lf = Math.log(2 * Math.PI) + Math.log(x) + (x < n / 2 ? Math.log1p(-x / n) : Math.log((n - x) / n));
    return Math.exp(lc - 0.5 * lf);
  };
  // λ^x e^−λ / Γ(x + 1), for real x.
  const dpois = (x, lambda) => {
    if (lambda === 0) return x === 0 ? 1 : 0;
    if (x === 0) return Math.exp(-lambda);
    if (x < 0) return 0;
    return Math.exp(-stirlerr(x) - bd0(x, lambda)) / Math.sqrt(2 * Math.PI * x);
  };

  // ── Incomplete gamma and beta ───────────────────────────────────────────────────────────────────────────────────────
  const TINY = 1e-300, LIMIT = 1000000;
  // ln Γ(1+a), a <= .01, from its convergent zeta series. Keep the factor a explicit near zero.
  const lgamma1p = (a) => {
    const zeta = [1.6449340668482264, 1.2020569031595943, 1.0823232337111382, 1.03692775514337,
      1.0173430619844491, 1.008349277381923, 1.0040773561979443, 1.0020083928260822, 1.000994575127818];
    let s = -0.5772156649015329 * a, power = a;
    for (let k = 2; k <= 10; k++) { power *= -a; s -= zeta[k - 2] * power / k; }
    return s;
  };
  // [P(a, x), Q(a, x)], the regularized lower and upper incomplete gamma, the smaller computed directly.
  const incgamma = (a, x) => {
    if (x <= 0) return [0, 1];
    if (x === Infinity) return [1, 0];
    // For tiny shape, P is almost one even below the series/fraction crossover. Compute log(P) without subtracting
    // nearly equal numbers, then Q with expm1. This is the alternating lower-gamma series on x <= 1.
    if (a < 0.01 && x <= 1) {
      let term = -x, s = term / (a + 1);
      for (let n = 2; n < LIMIT; n++) {
        term *= -x / n;
        const next = s + term / (a + n);
        if (next === s) break;
        s = next;
      }
      const logp = a * Math.log(x) - lgamma1p(a) + Math.log1p(a * s);
      return [Math.exp(logp), -Math.expm1(logp)];
    }
    const f = dpois(a, x);
    if (f === 0) return x < a ? [0, 1] : [1, 0];
    if (x < a + 1) {
      let term = 1, s = 1;
      let n = 1;
      for (; n < LIMIT && term > s * 1e-17; n++) { term *= x / (a + n); s += term; }
      if (n === LIMIT) throw ERR.NUM;
      const p = f * s;
      return [p, 1 - p];
    }
    let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
    let converged = false;
    for (let i = 1; i < LIMIT; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
      c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) <= Number.EPSILON) { converged = true; break; }
    }
    if (!converged) throw ERR.NUM;
    const q = a * f * h;
    return [1 - q, q];
  };
  const betacf = (a, b, x) => {
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < TINY) d = TINY;
    d = 1 / d;
    let h = d;
    for (let m = 1; m < LIMIT; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
      c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) <= Number.EPSILON) return h;
    }
    throw ERR.NUM;
  };
  // [I_x(a, b), 1 − I_x(a, b)] for x and y = 1 − x, each given exactly: x^a y^b / B(a, b) as Loader's term times the
  // continued fraction on the side where it converges.
  const incbeta = (a, b, x, y) => {
    if (x <= 0) return [0, 1];
    if (y <= 0) return [1, 0];
    if (a === b && x === y) return [0.5, 0.5];
    const front = (dbinom(a, a + b, x, y) * a * b) / (a + b);
    if (x < (a + 1) / (a + b + 2)) { const i = (front * betacf(a, b, x)) / a; return [i, 1 - i]; }
    const j = (front * betacf(b, a, y)) / b;
    return [1 - j, j];
  };

  // ── Densities ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const dgamma = (x, a, s) => (a < 1 ? (dpois(a, x / s) * a) / x : dpois(a - 1, x / s) / s);
  const dbeta = (x, a, b) => {
    if (x === 0) return a < 1 ? Infinity : a > 1 ? 0 : b;
    if (x === 1) return b < 1 ? Infinity : b > 1 ? 0 : a;
    if (a <= 2 || b <= 2) return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lbeta(a, b));
    return (a + b - 1) * dbinom(a - 1, a + b - 2, x, 1 - x);
  };
  const df = (x, m, n) => {
    if (x === 0) return m > 2 ? 0 : m === 2 ? 1 : Infinity;
    const f = 1 / (n + x * m), q = n * f, p = x * m * f;
    if (m >= 2) return ((m * q) / 2) * dbinom((m - 2) / 2, (m + n - 2) / 2, p, q);
    return ((m * m * q) / (2 * p * (m + n))) * dbinom(m / 2, (m + n) / 2, p, q);
  };
  const dt = (x, n) => {
    const t = -bd0(n / 2, (n + 1) / 2) + stirlerr((n + 1) / 2) - stirlerr(n / 2), x2n = (x * x) / n;
    let u, scale;
    if (x2n > 1 / Number.EPSILON) { u = n * (Math.log(Math.abs(x)) - Math.log(n) / 2); scale = Math.sqrt(n) / Math.abs(x); }
    else if (x2n > 0.2) { const l = Math.log(1 + x2n) / 2; u = n * l; scale = Math.exp(-l); }
    else { u = -bd0(n / 2, (n + x * x) / 2) + (x * x) / 2; scale = Math.exp(-Math.log1p(x2n) / 2); }
    return Math.exp(t - u) * scale / Math.sqrt(2 * Math.PI);
  };
  const phi = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

  // ── The continuous distributions: tails [lower, upper] at x, density, a first guess for the inverse ──────────────────
  const T = (n) => ({
    tails: (t) => {
      const tt = t * t, [x, y] = Number.isFinite(tt) ? [n / (n + tt), tt / (n + tt)] : [n / t / t, 1];
      const [ix, iy] = incbeta(n / 2, 0.5, x, y), far = 0.5 * ix, near = 0.5 + 0.5 * iy;
      return t >= 0 ? [near, far] : [far, near];
    },
    pdf: (t) => dt(t, n),
    guess: (p, q) => Math.max(Math.abs(quantile(Math.min(p, q))), 0.1),
  });
  const GAMMA = (a) => ({
    tails: (x) => incgamma(a, x),
    pdf: (x) => (x === 0 ? 0 : dgamma(x, a, 1)),
    guess: (p, q) => {
      const z = p <= q ? quantile(p) : -quantile(q), t = 1 / (9 * a), w = a * (1 - t + z * Math.sqrt(t)) ** 3;
      return w > 0 && Number.isFinite(w) ? w : Math.exp((Math.log(p) + lgamma(a + 1)) / a) || a;
    },
  });
  const BETA = (a, b) => ({ tails: (x) => incbeta(a, b, x, 1 - x), pdf: (x) => dbeta(x, a, b), guess: () => a / (a + b) });
  const F = (m, n) => ({
    tails: (x) => incbeta(m / 2, n / 2, (m * x) / (m * x + n), n / (m * x + n)),
    pdf: (x) => df(x, m, n),
    guess: () => 1,
  });
  // The x in (lo, hi) whose lower tail is p and upper q (p + q = 1, the smaller exact): Newton's method on the log of
  // the smaller tail, every step narrowing a bracket; a step that leaves it goes to the bracket's middle (its geometric
  // middle once it is all above 0, its double while it has no top).
  const invert = (dist, p, q, lo = 0, hi = Infinity) => {
    const low = p <= q, target = low ? p : q, goal = Math.log(target);
    let x = Math.min(Math.max(dist.guess(p, q), lo), hi);
    if (!(x > lo && x < hi)) x = Number.isFinite(hi) ? (lo + hi) / 2 : lo + 1;
    for (let i = 0; i < 1000; i++) {
      const tail = dist.tails(x)[low ? 0 : 1];
      if (tail === target) return x;
      const h = Math.log(tail) - goal;
      if ((h < 0) === low) lo = x; else hi = x;
      let next = x - h / (((low ? 1 : -1) * dist.pdf(x)) / tail);
      if (!(next > lo && next < hi)) next = !Number.isFinite(hi) ? Math.max(2 * x, 1) : lo > 0 ? Math.sqrt(lo) * Math.sqrt(hi) : hi / 2;
      if (Math.abs(next - x) <= 1e-15 * Math.abs(next) || (Number.isFinite(hi) && hi - lo <= 1e-15 * hi)) return next;
      x = next;
    }
    throw ERR.NUM;
  };

  // ── Regression ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const matrix = (a, ctx) => {
    if (isErr(a)) throw a;
    if (a instanceof Areas) throw ERR.VALUE;
    const g = a instanceof Ref ? toArray(a, ctx) : Array.isArray(a) ? a : [[a]];
    if (isErr(g)) throw g;
    return g.map((row) => row.map((v) => { if (isErr(v)) throw v; if (typeof v !== 'number') throw ERR.VALUE; return v; }));
  };
  // known_y's and known_x's as n values of y and n rows of k variables: a column of y takes each column of x as a
  // variable, a row of y each row; a grid of y one variable over x of its shape. x left out is 1, 2, 3… as y is laid out.
  const design = (ys, xs, ctx) => {
    const Y = matrix(ys, ctx), yr = Y.length, yc = Y[0].length;
    const X = given(xs) ? matrix(xs, ctx) : Y.map((row, i) => row.map((_, j) => i * yc + j + 1));
    const xr = X.length, xc = X[0].length, y = Y.flat();
    if (yc === 1 && xr === yr) return { y, rows: X, k: xc, across: false, shape: [xr, xc] };
    if (yr === 1 && xc === yc) return { y, rows: Y[0].map((_, j) => X.map((row) => row[j])), k: xr, across: true, shape: [xr, xc] };
    if (xr === yr && xc === yc) return { y, rows: X.flat().map((v) => [v]), k: 1, across: false, shape: [xr, xc] };
    throw ERR.REF;
  };
  // Compensated dot products and scaled norms keep long columns accurate without argument spreads or overflow.
  const dot = (a, b, from = 0) => {
    let s = 0, carry = 0;
    for (let i = from; i < a.length; i++) { const x = a[i] * b[i] - carry, next = s + x; carry = (next - s) - x; s = next; }
    return s;
  };
  const norm = (a, from = 0) => {
    let scale = 0;
    for (let i = from; i < a.length; i++) scale = Math.max(scale, Math.abs(a[i]));
    if (!scale) return 0;
    let s = 0, carry = 0;
    for (let i = from; i < a.length; i++) { const x = (a[i] / scale) ** 2 - carry, next = s + x; carry = (next - s) - x; s = next; }
    return scale * Math.sqrt(s);
  };
  // The least-squares fit of y on the rows' variables (and an intercept): coefficients, intercept, rank, and the
  // statistics LINEST reports.
  const regress = ({ y, rows, k }, intercept) => {
    const n = y.length;
    const my = intercept ? mean(y) : 0, mx = Array.from({ length: k }, (_, j) => (intercept ? mean(rows.map((r) => r[j])) : 0));
    const cols = Array.from({ length: k }, (_, j) => rows.map((r) => r[j] - mx[j]));
    const b = y.map((v) => v - my), length0 = cols.map((c) => norm(c));
    const order = [], R = [];
    let rest = cols.map((_, j) => j);
    for (let s = 0; s < Math.min(n, k); s++) {
      const tail = (j) => norm(cols[j], s);
      rest = rest.filter((j) => tail(j) > 1e-12 * length0[j]);
      if (!rest.length) break;
      const j = rest.reduce((best, c) => (tail(c) >= tail(best) ? c : best));
      rest = rest.filter((c) => c !== j);
      const col = cols[j], alpha = (col[s] > 0 ? -1 : 1) * tail(j);
      const v = col.map((x, i) => (i < s ? 0 : i === s ? x - alpha : x)), vv = dot(v, v, s);
      const reflect = (c) => { const f = (2 * dot(v, c, s)) / vv; for (let i = s; i < n; i++) c[i] -= f * v[i]; };
      for (const c of rest) reflect(cols[c]);
      reflect(b);
      R.push({ diag: alpha, row: new Map(rest.map((c) => [c, cols[c][s]])) });
      order.push(j);
    }
    const rank = order.length, coef = new Array(k).fill(0);
    for (let s = rank - 1; s >= 0; s--) {
      let t = b[s];
      for (let u = s + 1; u < rank; u++) t -= R[s].row.get(order[u]) * coef[order[u]];
      coef[order[s]] = t / R[s].diag;
    }
    const at = (s, u) => (s === u ? R[s].diag : u > s ? R[s].row.get(order[u]) : 0);
    // R⁻¹ by columns, for the coefficients' errors; R⁻ᵀ x̄ for the intercept's.
    const inv = Array.from({ length: rank }, () => new Array(rank).fill(0));
    for (let c = 0; c < rank; c++) for (let s = c; s >= 0; s--) {
      let t = s === c ? 1 : 0;
      for (let u = s + 1; u <= c; u++) t -= at(s, u) * inv[u][c];
      inv[s][c] = t / at(s, s);
    }
    const w = [];
    for (let s = 0; s < rank; s++) { let t = mx[order[s]]; for (let u = 0; u < s; u++) t -= at(u, s) * w[u]; w.push(t / at(s, s)); }
    const fitted = rows.map((r) => my + r.reduce((t, x, j) => t + coef[j] * (x - mx[j]), 0));
    let ssresid = y.reduce((t, v, i) => t + (v - fitted[i]) ** 2, 0);
    const ssreg = fitted.reduce((t, v) => t + (v - my) ** 2, 0);
    // A perfect fit's residual can consist only of QR roundoff. With no residual degrees of freedom Excel reports
    // zero errors, and #NUM! for F; a constant response also has r² = 1.
    if (Math.sqrt(ssresid) <= 16 * Number.EPSILON * norm(y)) ssresid = 0;
    const dof = n - rank - (intercept ? 1 : 0), sey = dof > 0 ? Math.sqrt(ssresid / dof) : 0;
    const se = new Array(k).fill(0);
    order.forEach((j, s) => { let t = 0; for (let c = 0; c < rank; c++) t += inv[s][c] ** 2; se[j] = sey * Math.sqrt(t); });
    return {
      coef, b: my - coef.reduce((t, m, j) => t + m * mx[j], 0), rank, dof, sey, ssreg, ssresid, n,
      seb: intercept ? sey * Math.sqrt(1 / n + w.reduce((t, x) => t + x * x, 0)) : ERR.NA, se,
    };
  };
  const linest = (fit, stats, transform = (x) => x) => {
    const k = fit.coef.length, number = (x) => (Number.isFinite(x) ? x : ERR.NUM), NA = ERR.NA;
    const top = [...fit.coef.map(transform).reverse(), transform(fit.b)];
    if (!stats) return [top.map(number)];
    const pad = (a) => [...a, ...new Array(k + 1 - a.length).fill(NA)];
    const r2 = fit.ssreg + fit.ssresid === 0 ? 1 : fit.ssreg / (fit.ssreg + fit.ssresid), f = fit.ssreg / fit.rank / (fit.ssresid / fit.dof);
    return [top, [...fit.se.slice().reverse(), fit.seb], pad([r2, fit.sey]), pad([f, fit.dof]), pad([fit.ssreg, fit.ssresid])]
      .map((row) => row.map((x) => (isErr(x) ? x : number(x))));
  };
  const logs = (d) => ({ ...d, y: d.y.map((v) => { if (v <= 0) throw ERR.NUM; return Math.log(v); }) });
  const constant = (c) => !given(c) || bool(c);
  // TREND's and GROWTH's values at new_x's (by default the known x's), laid out as new_x's are.
  const predict = ([ys, xs, nx, c], ctx, log) => {
    const d = design(ys, xs, ctx), fit = regress(log ? logs(d) : d, constant(c));
    const at = (row) => { const v = fit.b + row.reduce((t, x, j) => t + fit.coef[j] * x, 0); return log ? Math.exp(v) : v; };
    if (!given(nx)) {
      const out = d.rows.map(at);
      if (d.k === 1) { const [r, cc] = d.shape; return Array.from({ length: r }, (_, i) => Array.from({ length: cc }, (__, j) => finite(out[i * cc + j]))); }
      return d.across ? [out.map(finite)] : out.map((v) => [finite(v)]);
    }
    const N = matrix(nx, ctx);
    if (d.k === 1) return N.map((row) => row.map((x) => finite(at([x]))));
    if (!d.across && N[0].length === d.k) return N.map((row) => [finite(at(row))]);
    if (d.across && N.length === d.k) return [N[0].map((_, j) => finite(at(N.map((row) => row[j]))))];
    throw ERR.REF;
  };

  // ── Reading a distribution's arguments ──────────────────────────────────────────────────────────────────────────────
  const unit = (p, open = true) => { if (open ? !(p > 0 && p < 1) : !(p >= 0 && p <= 1)) throw ERR.NUM; return p; };
  const positive = (x) => { if (!(x > 0)) throw ERR.NUM; return x; };
  const freedom = (v, ctx) => { const n = whole(v, ctx); if (n < 1 || n > 1e10) throw ERR.NUM; return n; };
  const fn = (p, f, min = p.length) => ({ p: p.map(() => 'v'), min, max: p.length, fn: (args, ctx) => finite(f(args, ctx)) });

  // The x where a distribution's lower tail is p (0 below, #NUM! at 1).
  const lowerInverse = (dist, p) => (p === 0 ? 0 : invert(dist, p, 1 - p));
  // The x where its upper tail is q (0 at 1).
  const upperInverse = (dist, q) => (q === 1 ? 0 : invert(dist, 1 - q, q));
  const tUpper = (t, n) => T(n).tails(t)[1];
  const tInverseUpper = (q, n) => (q === 0.5 ? 0 : q < 0.5 ? invert(T(n), 1 - q, q) : -invert(T(n), q, 1 - q));
  const tTest = (args, ctx) => {
    const [a, b, tl, ty] = args, tails = whole(tl, ctx), type = whole(ty, ctx);
    if (tails !== 1 && tails !== 2) throw ERR.NUM;
    if (type < 1 || type > 3) throw ERR.NUM;
    let t, dof;
    if (type === 1) {
      const [xs, ys] = pairs(a, b, ctx), d = xs.map((x, i) => x - ys[i]), v = variance(d);
      if (v === 0) throw ERR.DIV0;
      t = mean(d) / Math.sqrt(v / d.length); dof = d.length - 1;
    } else {
      const xs = numbers([a], ctx), ys = numbers([b], ctx), v1 = variance(xs), v2 = variance(ys), n1 = xs.length, n2 = ys.length;
      if (type === 2) {
        const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
        t = (mean(xs) - mean(ys)) / Math.sqrt(pooled * (1 / n1 + 1 / n2)); dof = n1 + n2 - 2;
      } else {
        const e1 = v1 / n1, e2 = v2 / n2;
        t = (mean(xs) - mean(ys)) / Math.sqrt(e1 + e2); dof = (e1 + e2) ** 2 / (e1 * e1 / (n1 - 1) + e2 * e2 / (n2 - 1));
      }
      if (!Number.isFinite(t)) throw ERR.DIV0;
    }
    return tails * tUpper(Math.abs(t), dof);
  };
  const hypgeom = (x, n, M, N) => { const p = n / N, q = (N - n) / N; return (dbinom(x, M, p, q) * dbinom(n - x, N - M, p, q)) / dbinom(n, N, p, q); };
  // P(X ≤ x): the terms summed from x away from the mean, or one less those past x.
  const hypgeomCdf = (x, n, M, N) => {
    const lo = Math.max(0, n - (N - M)), hi = Math.min(n, M), upper = x >= (n * M) / N;
    let term = hypgeom(upper ? x + 1 : x, n, M, N), s = 0;
    if (upper) {
      if (x >= hi) return 1;
      for (let i = x + 1; i <= hi && term > s * 1e-17; i++) { s += term; term *= ((M - i) * (n - i)) / ((i + 1) * (N - M - n + i + 1)); }
      return 1 - s;
    }
    for (let i = x; i >= lo && term > s * 1e-17; i--) { s += term; term *= (i * (N - M - n + i)) / ((M - i + 1) * (n - i + 1)); }
    return s;
  };
  const binomCdf = (k, n, p) => (k >= n ? 1 : incbeta(n - k, k + 1, 1 - p, p)[0]);
  const binomArgs = ([k, n, p], ctx) => {
    const count = num(k, ctx), size = num(n, ctx);
    if (count < 0 || size < 0) throw ERR.NUM;
    const trials = Math.trunc(size), x = Math.trunc(count), pr = num(p, ctx);
    if (x < 0 || x > trials || pr < 0 || pr > 1) throw ERR.NUM;
    return [x, trials, pr];
  };
  const hypgeomArgs = ([x, n, M, N], ctx) => {
    if (num(x, ctx) < 0) throw ERR.NUM;
    const s = whole(x, ctx), draws = whole(n, ctx), succ = whole(M, ctx), pop = whole(N, ctx);
    if (pop <= 0 || draws <= 0 || draws > pop || succ <= 0 || succ > pop || s < Math.max(0, draws - pop + succ) || s > Math.min(draws, succ)) throw ERR.NUM;
    return [s, draws, succ, pop];
  };
  const negbinomArgs = ([f, s, p], ctx) => {
    if (num(f, ctx) < 0) throw ERR.NUM;
    const fails = whole(f, ctx), succ = whole(s, ctx), pr = num(p, ctx);
    if (fails < 0 || succ < 1 || pr < 0 || pr > 1) throw ERR.NUM;
    return [fails, succ, pr];
  };
  const gammaArgs = (x, a, b, ctx) => {
    const v = num(x, ctx), shape = positive(num(a, ctx)), scale = positive(num(b, ctx));
    return [v, shape, scale];
  };
  const betaArgs = ([x, a, b, , lo, hi], ctx) => {
    const v = num(x, ctx), p = positive(num(a, ctx)), q = positive(num(b, ctx));
    const A = given(lo) ? num(lo, ctx) : 0, B = given(hi) ? num(hi, ctx) : 1;
    if (v < A || v > B || A === B) throw ERR.NUM;
    return [(v - A) / (B - A), (B - v) / (B - A), p, q, B - A];
  };
  const chiArgs = ([x, k], ctx) => { const v = num(x, ctx), n = freedom(k, ctx); if (v < 0) throw ERR.NUM; return [v, n]; };
  const fArgs = ([x, a, b], ctx) => { const v = num(x, ctx), m = freedom(a, ctx), n = freedom(b, ctx); if (v < 0) throw ERR.NUM; return [v, m, n]; };
  // PERCENTRANK: x's rank in the sorted data over n − 1 (INC) or its position over n + 1 (EXC), interpolated between
  // the values either side, cut (not rounded) to `significance` digits.
  const percentrank = (exclusive) => ({ p: ['r', 'v', 'v'], min: 2, max: 3, fn: ([a, x, sig], ctx) => {
    const xs = numbers([a], ctx).sort((p, q) => p - q), v = num(x, ctx), digits = given(sig) ? whole(sig, ctx) : 3, n = xs.length;
    if (!n || digits < 1) throw ERR.NUM;
    if (v < xs[0] || v > xs[n - 1]) throw ERR.NA;
    let r;
    if (v === xs[0]) r = exclusive ? 1 / (n + 1) : 0;
    else {
      let i = 1;
      while (i < n && xs[i] < v) i++;
      if (v === xs[i]) r = exclusive ? (i + 1) / (n + 1) : i / (n - 1);
      else {
        const part = (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
        r = exclusive ? (i + part) / (n + 1) : (i - 1 + part) / (n - 1);
      }
    }
    return round(r, digits, 'down');
  } });
  const SHAPE = { p: ['r'], min: 1 };
  const moments = (xs) => {
    const m = mean(xs);
    let m2 = 0, m3 = 0, m4 = 0;
    for (const x of xs) { const d = x - m, d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
    return { n: xs.length, m2, m3, m4 };
  };

  const FNS = {
    KURT: { ...SHAPE, fn: (args, ctx) => {
      const { n, m2, m4 } = moments(numbers(args, ctx));
      if (n < 4) throw ERR.DIV0;
      const s2 = m2 / (n - 1);
      if (!s2) throw ERR.DIV0;
      return finite(((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * (m4 / (s2 * s2)) - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)));
    } },
    SKEW: { ...SHAPE, fn: (args, ctx) => {
      const { n, m2, m3 } = moments(numbers(args, ctx));
      if (n < 3) throw ERR.DIV0;
      const s = Math.sqrt(m2 / (n - 1));
      if (!s) throw ERR.DIV0;
      return finite((n / ((n - 1) * (n - 2))) * (m3 / (s * s * s)));
    } },
    'SKEW.P': { ...SHAPE, fn: (args, ctx) => {
      const { n, m2, m3 } = moments(numbers(args, ctx));
      if (n < 3) throw ERR.DIV0;
      const s = Math.sqrt(m2 / n);
      if (!s) throw ERR.DIV0;
      return finite(m3 / n / (s * s * s));
    } },
    'PERCENTRANK.INC': percentrank(false),
    'PERCENTRANK.EXC': percentrank(true),
    // The values seen most often (more than once), in the order first seen, as a column.
    'MODE.MULT': { ...SHAPE, fn: (args, ctx) => {
      const counts = new Map();
      for (const x of numbers(args, ctx)) counts.set(x, (counts.get(x) ?? 0) + 1);
      let most = 0;
      for (const count of counts.values()) if (count > most) most = count;
      if (most < 2) throw ERR.NA;
      return [...counts].filter(([, c]) => c === most).map(([x]) => [x]);
    } },

    LINEST: { p: ['a', 'a', 'v', 'v'], min: 1, max: 4, fn: ([ys, xs, c, st], ctx) => linest(regress(design(ys, xs, ctx), constant(c)), given(st) && bool(st)) },
    LOGEST: { p: ['a', 'a', 'v', 'v'], min: 1, max: 4, fn: ([ys, xs, c, st], ctx) => linest(regress(logs(design(ys, xs, ctx)), constant(c)), given(st) && bool(st), Math.exp) },
    TREND: { p: ['a', 'a', 'a', 'v'], min: 1, max: 4, fn: (args, ctx) => predict(args, ctx, false) },
    GROWTH: { p: ['a', 'a', 'a', 'v'], min: 1, max: 4, fn: (args, ctx) => predict(args, ctx, true) },
    STEYX: { p: ['r', 'r'], min: 2, max: 2, fn: ([a, b], ctx) => {
      const [ys, xs] = pairs(a, b, ctx), n = ys.length;
      if (n < 3) throw ERR.DIV0;
      const mx = mean(xs), my = mean(ys);
      let sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      if (!sxx) throw ERR.DIV0;
      return finite(Math.sqrt((syy - (sxy * sxy) / sxx) / (n - 2)));
    } },

    PHI: fn(['x'], ([x], ctx) => phi(num(x, ctx))),
    // Φ(z) − ½; near 0 by its series, which keeps every digit.
    GAUSS: fn(['z'], ([z], ctx) => {
      const x = num(z, ctx);
      if (Math.abs(x) >= 0.5) return cdf(x) - 0.5;
      let term = x, s = x;
      for (let k = 1; Math.abs(term) > Math.abs(s) * 1e-17; k++) { term *= (-x * x) / (2 * k); s += term / (2 * k + 1); }
      return s / Math.sqrt(2 * Math.PI);
    }),
    FISHER: fn(['x'], ([x], ctx) => { const v = num(x, ctx); if (!(v > -1 && v < 1)) throw ERR.NUM; return Math.atanh(v); }),
    FISHERINV: fn(['y'], ([y], ctx) => Math.tanh(num(y, ctx))),
    'CONFIDENCE.NORM': fn(['a', 's', 'n'], ([a, s, n], ctx) => {
      const alpha = unit(num(a, ctx)), sd = positive(num(s, ctx)), size = whole(n, ctx);
      if (size < 1) throw ERR.NUM;
      return (-quantile(alpha / 2) * sd) / Math.sqrt(size);
    }),
    'CONFIDENCE.T': fn(['a', 's', 'n'], ([a, s, n], ctx) => {
      const alpha = unit(num(a, ctx)), sd = positive(num(s, ctx)), size = whole(n, ctx);
      if (size < 1) throw ERR.NUM;
      if (size === 1) throw ERR.DIV0;
      return (tInverseUpper(alpha / 2, size - 1) * sd) / Math.sqrt(size);
    }),
    // The probability of x_range's values between lower and upper (or equal to lower); prob_range must sum to 1.
    PROB: { p: ['r', 'r', 'v', 'v'], min: 3, max: 4, fn: ([xr, pr, lo, hi], ctx) => {
      const X = view(xr, ctx), P = view(pr, ctx);
      if (X.rows * X.cols !== P.rows * P.cols) throw ERR.NA;
      const a = num(lo, ctx), b = given(hi) ? num(hi, ctx) : a;
      let total = 0, s = 0;
      for (let k = 0; k < X.rows * X.cols; k++) {
        const x = X.get(Math.floor(k / X.cols), k % X.cols), p = P.get(Math.floor(k / P.cols), k % P.cols);
        if (isErr(x)) throw x;
        if (isErr(p)) throw p;
        if (typeof x !== 'number' || typeof p !== 'number') continue;
        total += p;
        if (given(hi) ? x >= a && x <= b : same(x, a)) s += p;
      }
      if (!same(total, 1)) throw ERR.NUM;
      return s;
    } },
    // 1 − Φ((x̄ − x) / (σ / √n)), σ the sample's own unless given.
    'Z.TEST': { p: ['r', 'v', 'v'], min: 2, max: 3, fn: ([a, x, sigma], ctx) => {
      const xs = numbers([a], ctx), v = num(x, ctx);
      if (!xs.length) throw ERR.NA;
      const sd = given(sigma) ? num(sigma, ctx) : Math.sqrt(variance(xs));
      if (!sd) throw ERR.DIV0;
      if (sd < 0) throw ERR.NUM;
      return finite(cdf(-(mean(xs) - v) / (sd / Math.sqrt(xs.length))));
    } },
    // tails 1 or 2; type 1 paired, 2 equal variances, 3 unequal (Welch's degrees of freedom).
    'T.TEST': { p: ['r', 'r', 'v', 'v'], min: 4, max: 4, fn: (args, ctx) => finite(tTest(args, ctx)) },

    GAMMA: fn(['x'], ([x], ctx) => { const v = num(x, ctx); if (Number(Math.abs(v).toPrecision(15)) < 2.2250738585072014e-308) throw ERR.NUM; return gamma(v); }),
    GAMMALN: fn(['x'], ([x], ctx) => { const v = positive(num(x, ctx)); if (Number(v.toPrecision(15)) < 2.2250738585072014e-308) throw ERR.NUM; return lgamma(v); }),
    'GAMMA.DIST': fn(['x', 'a', 'b', 'c'], ([x, a, b, c], ctx) => {
      const [v, shape, scale] = gammaArgs(x, a, b, ctx), cum = bool(c);
      if (v < 0) throw ERR.NUM;
      if (cum) return incgamma(shape, v / scale)[0];
      if (v === 0) { if (shape <= 1) throw ERR.NUM; return 0; }
      return dgamma(v, shape, scale);
    }),
    'GAMMA.INV': fn(['p', 'a', 'b'], ([p, a, b], ctx) => {
      const [pr, shape, scale] = gammaArgs(p, a, b, ctx);
      if (!(pr >= 0 && pr < 1)) throw ERR.NUM;
      return scale * lowerInverse(GAMMA(shape), pr);
    }),
    'BETA.DIST': fn(['x', 'a', 'b', 'c', 'A', 'B'], (args, ctx) => {
      const [x, y, a, b, width] = betaArgs(args, ctx);
      return bool(args[3]) ? incbeta(a, b, x, y)[0] : dbeta(x, a, b) / width;
    }, 4),
    BETADIST: fn(['x', 'a', 'b', 'A', 'B'], ([x, a, b, A, B], ctx) => { const [u, v, p, q] = betaArgs([x, a, b, true, A, B], ctx); return incbeta(p, q, u, v)[0]; }, 3),
    'BETA.INV': fn(['p', 'a', 'b', 'A', 'B'], ([p, a, b, lo, hi], ctx) => {
      const pr = unit(num(p, ctx)), x = positive(num(a, ctx)), y = positive(num(b, ctx));
      const A = given(lo) ? num(lo, ctx) : 0, B = given(hi) ? num(hi, ctx) : 1;
      if (A >= B) throw ERR.NUM;
      return A + (B - A) * invert(BETA(x, y), pr, 1 - pr, 0, 1);
    }, 3),

    'BINOM.DIST': fn(['k', 'n', 'p', 'c'], (args, ctx) => {
      const [k, n, p] = binomArgs(args, ctx);
      return bool(args[3]) ? binomCdf(k, n, p) : dbinom(k, n, p, 1 - p);
    }),
    // The least k whose cumulative probability reaches alpha.
    'BINOM.INV': fn(['n', 'p', 'a'], ([n, p, a], ctx) => {
      if (num(n, ctx) < 0) throw ERR.NUM;
      const trials = whole(n, ctx), pr = unit(num(p, ctx)), alpha = unit(num(a, ctx));
      if (trials < 0) throw ERR.NUM;
      let k = Math.max(0, Math.min(trials, Math.floor(trials * pr + quantile(alpha) * Math.sqrt(trials * pr * (1 - pr)))));
      while (k > 0 && binomCdf(k - 1, trials, pr) >= alpha) k--;
      while (k < trials && binomCdf(k, trials, pr) < alpha) k++;
      return k;
    }),
    'BINOM.DIST.RANGE': fn(['n', 'p', 's', 's2'], ([n, p, s, s2], ctx) => {
      if (num(n, ctx) < 0 || num(s, ctx) < 0 || (given(s2) && num(s2, ctx) < 0)) throw ERR.NUM;
      const trials = whole(n, ctx), pr = num(p, ctx), from = whole(s, ctx), to = given(s2) ? whole(s2, ctx) : from;
      if (trials < 0 || pr < 0 || pr > 1 || from < 0 || from > trials || to < from || to > trials) throw ERR.NUM;
      if (to - from > 100000) return binomCdf(to, trials, pr) - (from ? binomCdf(from - 1, trials, pr) : 0);
      let t = 0;
      for (let k = from; k <= to; k++) t += dbinom(k, trials, pr, 1 - pr);
      return t;
    }, 3),
    'NEGBINOM.DIST': fn(['f', 's', 'p', 'c'], (args, ctx) => {
      const [f, s, p] = negbinomArgs(args, ctx);
      return bool(args[3]) ? incbeta(s, f + 1, p, 1 - p)[0] : (s / (s + f)) * dbinom(s, f + s, p, 1 - p);
    }),
    NEGBINOMDIST: fn(['f', 's', 'p'], (args, ctx) => { const [f, s, p] = negbinomArgs(args, ctx); return (s / (s + f)) * dbinom(s, f + s, p, 1 - p); }),
    'HYPGEOM.DIST': fn(['x', 'n', 'M', 'N', 'c'], (args, ctx) => {
      const [x, n, M, N] = hypgeomArgs(args, ctx);
      return bool(args[4]) ? hypgeomCdf(x, n, M, N) : hypgeom(x, n, M, N);
    }),
    HYPGEOMDIST: fn(['x', 'n', 'M', 'N'], (args, ctx) => hypgeom(...hypgeomArgs(args, ctx))),
    'POISSON.DIST': fn(['x', 'm', 'c'], ([x, m, c], ctx) => {
      if (num(x, ctx) < 0) throw ERR.NUM;
      const k = whole(x, ctx), lambda = num(m, ctx);
      if (k < 0 || lambda < 0) throw ERR.NUM;
      return bool(c) ? incgamma(k + 1, lambda)[1] : dpois(k, lambda);
    }),
    'EXPON.DIST': fn(['x', 'l', 'c'], ([x, l, c], ctx) => {
      const v = num(x, ctx), rate = positive(num(l, ctx));
      if (v < 0) throw ERR.NUM;
      return bool(c) ? -Math.expm1(-rate * v) : rate * Math.exp(-rate * v);
    }),
    'WEIBULL.DIST': fn(['x', 'a', 'b', 'c'], ([x, a, b, c], ctx) => {
      const v = num(x, ctx), k = positive(num(a, ctx)), scale = positive(num(b, ctx));
      if (v < 0) throw ERR.NUM;
      const z = (v / scale) ** k;
      if (bool(c)) return -Math.expm1(-z);
      return v === 0 ? 0 : (k / scale) * (v / scale) ** (k - 1) * Math.exp(-z);
    }),
    'LOGNORM.DIST': fn(['x', 'm', 's', 'c'], ([x, m, s, c], ctx) => {
      const v = positive(num(x, ctx)), mu = num(m, ctx), sd = positive(num(s, ctx)), z = (Math.log(v) - mu) / sd;
      return bool(c) ? cdf(z) : phi(z) / (sd * v);
    }),
    LOGNORMDIST: fn(['x', 'm', 's'], ([x, m, s], ctx) => { const v = positive(num(x, ctx)), mu = num(m, ctx), sd = positive(num(s, ctx)); return cdf((Math.log(v) - mu) / sd); }),
    'LOGNORM.INV': fn(['p', 'm', 's'], ([p, m, s], ctx) => { const pr = unit(num(p, ctx)), mu = num(m, ctx), sd = positive(num(s, ctx)); return Math.exp(mu + sd * quantile(pr)); }),

    'CHISQ.DIST': fn(['x', 'k', 'c'], ([x, k, c], ctx) => {
      const [v, n] = chiArgs([x, k], ctx);
      if (bool(c)) return incgamma(n / 2, v / 2)[0];
      if (v === 0) { if (n < 2) throw ERR.NUM; return n === 2 ? 0.5 : 0; }
      return dgamma(v, n / 2, 2);
    }),
    'CHISQ.DIST.RT': fn(['x', 'k'], (args, ctx) => { const [v, n] = chiArgs(args, ctx); return incgamma(n / 2, v / 2)[1]; }),
    'CHISQ.INV': fn(['p', 'k'], ([p, k], ctx) => { const pr = num(p, ctx), n = freedom(k, ctx); if (!(pr >= 0 && pr < 1)) throw ERR.NUM; return 2 * lowerInverse(GAMMA(n / 2), pr); }),
    'CHISQ.INV.RT': fn(['p', 'k'], ([p, k], ctx) => { const q = num(p, ctx), n = freedom(k, ctx); if (!(q > 0 && q <= 1)) throw ERR.NUM; return 2 * upperInverse(GAMMA(n / 2), q); }),
    'F.DIST': fn(['x', 'm', 'n', 'c'], ([x, a, b, c], ctx) => {
      const [v, m, n] = fArgs([x, a, b], ctx);
      if (bool(c)) return F(m, n).tails(v)[0];
      if (v === 0 && m < 2) throw ERR.NUM;
      return df(v, m, n);
    }),
    'F.DIST.RT': fn(['x', 'm', 'n'], (args, ctx) => { const [v, m, n] = fArgs(args, ctx); return F(m, n).tails(v)[1]; }),
    'F.INV': fn(['p', 'm', 'n'], ([p, a, b], ctx) => {
      const pr = num(p, ctx), m = freedom(a, ctx), n = freedom(b, ctx);
      if (!(pr >= 0 && pr < 1)) throw ERR.NUM;
      return lowerInverse(F(m, n), pr);
    }),
    'F.INV.RT': fn(['p', 'm', 'n'], ([p, a, b], ctx) => {
      const q = num(p, ctx), m = freedom(a, ctx), n = freedom(b, ctx);
      if (!(q > 0 && q <= 1)) throw ERR.NUM;
      return upperInverse(F(m, n), q);
    }),
    'T.DIST': fn(['x', 'n', 'c'], ([x, k, c], ctx) => {
      const v = num(x, ctx), n = freedom(k, ctx);
      return bool(c) ? T(n).tails(v)[0] : dt(v, n);
    }),
    'T.DIST.2T': fn(['x', 'n'], ([x, k], ctx) => { const v = num(x, ctx), n = freedom(k, ctx); if (v < 0) throw ERR.NUM; return Math.min(1, 2 * tUpper(v, n)); }),
    'T.DIST.RT': fn(['x', 'n'], ([x, k], ctx) => tUpper(num(x, ctx), freedom(k, ctx))),
    TDIST: fn(['x', 'n', 't'], ([x, k, t], ctx) => {
      const v = num(x, ctx), n = freedom(k, ctx), tails = whole(t, ctx);
      if (v < 0 || (tails !== 1 && tails !== 2)) throw ERR.NUM;
      return Math.min(1, tails * tUpper(v, n));
    }),
    'T.INV.2T': fn(['p', 'n'], ([p, k], ctx) => { const pr = num(p, ctx), n = freedom(k, ctx); if (!(pr > 0 && pr <= 1)) throw ERR.NUM; return tInverseUpper(pr / 2, n); }),
  };
  // p is kept exact as the smaller tail: the lower below ½, else 1 − p as the upper.
  FNS['T.INV'] = fn(['p', 'n'], ([p, k], ctx) => {
    const pr = unit(num(p, ctx)), n = freedom(k, ctx);
    return pr === 0.5 ? 0 : pr < 0.5 ? -invert(T(n), 1 - pr, pr) : invert(T(n), pr, 1 - pr);
  });
  FNS['GAMMALN.PRECISE'] = FNS.GAMMALN;
  FNS.NORMSDIST = fn(['z'], ([z], ctx) => cdf(num(z, ctx)));
  const LEGACY = {
    PERCENTRANK: 'PERCENTRANK.INC', CONFIDENCE: 'CONFIDENCE.NORM', ZTEST: 'Z.TEST', TTEST: 'T.TEST', GAMMADIST: 'GAMMA.DIST', GAMMAINV: 'GAMMA.INV',
    BETAINV: 'BETA.INV', BINOMDIST: 'BINOM.DIST', CRITBINOM: 'BINOM.INV', POISSON: 'POISSON.DIST', EXPONDIST: 'EXPON.DIST', WEIBULL: 'WEIBULL.DIST',
    LOGINV: 'LOGNORM.INV', CHIDIST: 'CHISQ.DIST.RT', CHIINV: 'CHISQ.INV.RT', FDIST: 'F.DIST.RT', FINV: 'F.INV.RT', TINV: 'T.INV.2T',
  };
  for (const [old, name] of Object.entries(LEGACY)) FNS[old] = FNS[name];
  const FROM_STATS = { COVAR: 'COVARIANCE.P', NORMDIST: 'NORM.DIST', NORMINV: 'NORM.INV', NORMSINV: 'NORM.S.INV' };
  for (const [old, name] of Object.entries(FROM_STATS)) FNS[old] = S.FNS[name];
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return { FNS, lgamma, gamma, incgamma, incbeta, dbinom, dpois };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_STATS2; else GZ_SHEET_FN_STATS2;
