// Dropped scores: lib/gradecalc.js against two reference solvers on seeded, generated assignment groups, so the
// numbers behind the choice to reproduce Canvas's drop search can be rerun.
// - `reviewed`: the solver as Codex reviewed it at c84efec (6,912 cases checked against brute force there), which
//   reproduces Canvas's search; kept here only to measure against.
// - `exact`: Dinkelbach's iteration, which always finds a best set, given Canvas's ceiling for work worth no points
//   and its tie rules as far as they can be stated without the search: the alternative that was turned down.
// `node --test` runs a sample (SAMPLE groups per corpus). The full run: GZ_PARITY_FULL=1 node --test test/gradecalc-parity.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/gradecalc.js');

const FULL = !!process.env.GZ_PARITY_FULL;
const SAMPLE = 1000;
const sum = (list, f) => list.reduce((n, x) => n + f(x), 0);
const byId = (a, b) => Number(a.id) - Number(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const reviewed = (() => {
  const keep = (list, fixed, k, best, maxPossible) => {
    if (list.length <= k) return list;
    const all = [...list, ...fixed];
    const pointed = all.filter((i) => i.possible > 0);
    if (!pointed.length) return [...list].sort((a, b) => a.score - b.score || byId(a, b)).slice(-k);
    const shares = pointed.map((i) => i.score / i.possible).sort((a, b) => a - b);
    const unpointed = all.filter((i) => !(i.possible > 0));
    const possible = sum(pointed, (i) => i.possible);
    let lo = shares[0];
    let hi = unpointed.length ? (Math.max(possible, sum(pointed, (i) => i.score)) + sum(unpointed, (i) => i.score)) / possible : shares[shares.length - 1];
    const F = (q) => {
      const rated = list.map((i) => [i.score - q * i.possible, i]).sort(([a, x], [b, y]) => (best ? b - a : a - b) || byId(x, y)).slice(0, k);
      return [sum(rated, ([v]) => v) + sum(fixed, (i) => i.score - q * i.possible), rated.map(([, i]) => i)];
    };
    let mid = (lo + hi) / 2;
    let [x, kept] = F(mid);
    const close = 1 / (2 * k * maxPossible ** 2);
    while (hi - lo >= close) {
      if (x < 0) hi = mid; else lo = mid;
      const next = (lo + hi) / 2;
      if (next === lo || next === hi) break;
      mid = next;
      [x, kept] = F(mid);
    }
    return kept;
  };
  return (subs, rules) => {
    let { lo, hi } = rules;
    if (!lo && !hi) return subs;
    const fixed = subs.filter((s) => rules.never.includes(s.id));
    const free = subs.filter((s) => !rules.never.includes(s.id)).sort(byId);
    if (!free.length) return fixed;
    if (lo >= free.length) lo = free.length - 1;
    if (lo + hi >= free.length) hi = 0;
    const most = free.length - lo;
    const least = most - hi;
    if (![...free, ...fixed].some((s) => s.possible > 0)) return [...[...free].sort((a, b) => a.score - b.score || byId(a, b)).slice(-most).slice(0, least), ...fixed];
    const max = Math.max(...[...free, ...fixed].map((s) => s.possible));
    return [...keep(keep(free, fixed, most, true, max), fixed, least, false, max), ...fixed];
  };
})();

const exact = (() => {
  const reach = (set, up) => {
    const pts = sum(set, (i) => i.score);
    const out = sum(set, (i) => i.possible);
    if (out > 0) return pts / out;
    const every = up ? pts >= 0 : pts <= 0;
    return every === up ? Infinity : -Infinity;
  };
  const pick = (pool, always, size, up) => {
    if (pool.length <= size) return pool;
    const all = [...pool, ...always];
    const worth = all.filter((i) => i.possible > 0);
    const none = all.filter((i) => !(i.possible > 0));
    if (!worth.length) return [...pool].sort((a, b) => b.score - a.score || byId(a, b)).slice(0, size);
    const dir = up ? 1 : -1;
    const flat = !none.length && new Set(worth.map((i) => i.score / i.possible)).size === 1;
    const order = (q, tilt) => [...pool].sort((a, b) => {
      const d = dir * ((b.score - q * b.possible) - (a.score - q * a.possible));
      return (Math.abs(d) > 1e-12 ? d : !flat && tilt * dir * (a.possible - b.possible)) || byId(a, b);
    }).slice(0, size);
    const pts = sum(worth, (i) => i.possible);
    const limit = up && none.length ? (Math.max(pts, sum(worth, (i) => i.score)) + sum(none, (i) => i.score)) / pts : Infinity;
    let set = [...pool].sort((a, b) => dir * (reach([b], up) - reach([a], up)) || byId(a, b)).slice(0, size);
    let q = reach([...set, ...always], up);
    for (let step = 0; step < 100; step++) {
      if (q >= limit) return order(limit, -1);
      if (!Number.isFinite(q)) break;
      const next = order(q, 1);
      const r = reach([...next, ...always], up);
      if (dir * (r - q) > 1e-12) { set = next; q = r; continue; }
      if (Math.abs(r - q) <= 1e-12) set = next;
      break;
    }
    return set;
  };
  return (subs, rules) => {
    if (!rules.lo && !rules.hi) return subs;
    const always = subs.filter((s) => rules.never.includes(s.id));
    const pool = subs.filter((s) => !rules.never.includes(s.id));
    if (!pool.length) return always;
    const afterLow = Math.max(1, pool.length - rules.lo);
    const afterHigh = afterLow - rules.hi >= 1 ? afterLow - rules.hi : afterLow;
    if (![...pool, ...always].some((i) => i.possible > 0)) {
      const high = [...pool].sort((a, b) => b.score - a.score || byId(a, b)).slice(0, afterLow);
      return [...high.sort((a, b) => a.score - b.score || byId(a, b)).slice(0, afterHigh), ...always];
    }
    return [...pick(pick(pool, always, afterLow, true), always, afterHigh, false), ...always];
  };
})();

// mulberry32, seeded per corpus.
const prng = (seed) => (n) => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
};
// Mixed groups of any shape: point values from `unit` to 20 units (a sixth worth none), scores up to 3 units above
// possible, 0-3 lowest and 0-1 highest dropped, a never-drop now and then. Groups without a drop rule are skipped.
const mixed = (seed, unit, maxSize, tries) => {
  const rnd = prng(seed);
  const out = [];
  for (let t = 0; t < tries; t++) {
    const size = 2 + rnd(maxSize - 1);
    const subs = Array.from({ length: size }, (_, i) => { const p = rnd(6) === 0 ? 0 : (1 + rnd(20)) * unit; return { id: String(i + 1), possible: p, score: rnd(Math.round(p / unit) + 3) * unit }; });
    const rules = { lo: rnd(4), hi: rnd(2), never: rnd(3) === 0 ? [String(1 + rnd(size))] : [] };
    if (rules.lo || rules.hi) out.push([subs, rules]);
  }
  return out;
};
// Groups like real courses: 3-12 items worth one point value (or two), scores mostly 40-100%, now and then a little
// extra credit, sometimes a zero-point bonus item; drop 1-2 lowest, sometimes 1 highest. One generator, run in order.
const realistic = (tries) => {
  const rnd = prng(2026);
  const kinds = {};
  for (const [name, two, bonus] of [['one point value', false, 0], ['two point values', true, 0], ['one value + zero-point bonus', false, 1], ['two values + bonus', true, 1]]) {
    kinds[name] = [];
    for (let t = 0; t < tries; t++) {
      const size = 3 + rnd(10);
      const a = [5, 10, 20, 25, 100][rnd(5)], b = [5, 10, 20, 25, 100][rnd(5)];
      const subs = Array.from({ length: size }, (_, i) => {
        const p = two && rnd(2) ? b : a;
        const ec = rnd(15) === 0 ? 1 + rnd(3) : 0;
        return { id: String(i + 1), possible: p, score: Math.min(p + ec, Math.round((0.4 + 0.6 * (rnd(1000) / 1000)) * p) + ec) };
      });
      if (bonus && rnd(3) === 0) subs.push({ id: String(size + 1), possible: 0, score: rnd(4) });
      kinds[name].push([subs, { lo: 1 + rnd(2), hi: rnd(4) === 0 ? 1 : 0, never: [] }]);
    }
  }
  return kinds;
};
// The full run: 20,000 tries per mixed corpus and 30,000 per realistic kind (172,369 groups), as first measured.
const corpora = (mixedTries, realTries) => ({
  'mixed, whole points, up to 12 items': mixed(99, 1, 12, mixedTries),
  'mixed, half points': mixed(5, 0.5, 8, mixedTries),
  'mixed, quarter points': mixed(11, 0.25, 8, mixedTries),
  ...realistic(realTries),
});

const tot = (s) => [sum(s, (i) => i.score), sum(s, (i) => i.possible)];
const shareOf = (s) => { const [x, p] = tot(s); return p > 0 ? x / p : 0; };
const compare = (a, b) => (Math.abs(shareOf(a) - shareOf(b)) > 1e-9 ? 'share' : tot(a).join() !== tot(b).join() ? 'points' : '');
const measure = (mixedTries, realTries) => Object.entries(corpora(mixedTries, realTries)).map(([name, groups]) => {
  const row = { name, groups: groups.length, glaze: { share: 0, points: 0 }, exact: { share: 0, points: 0 } };
  for (const [subs, rules] of groups) {
    const want = reviewed(subs, rules);
    for (const [k, f] of [['glaze', G.drop], ['exact', exact]]) { const d = compare(f(subs, rules), want); if (d) row[k][d]++; }
  }
  return row;
});

test(`dropped scores: Glaze keeps what the reviewed solver keeps (${FULL ? 'full run' : `${SAMPLE} tries per corpus`})`, () => {
  const rows = FULL ? measure(20000, 30000) : measure(SAMPLE, SAMPLE);
  const total = rows.reduce((n, r) => n + r.groups, 0);
  for (const r of rows) assert.deepEqual(r.glaze, { share: 0, points: 0 }, r.name);
  if (FULL) {
    console.log(`${total} groups, Glaze identical to the reviewed solver in all of them.`);
    for (const r of rows) console.log(`  ${r.name}: ${r.groups} groups; exact solver differs in ${r.exact.share} (share) + ${r.exact.points} (same share, other points) = ${(((r.exact.share + r.exact.points) / r.groups) * 100).toFixed(2)}%`);
  }
});
