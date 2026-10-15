// Local pet game (W24). Sources are existing device records only; the worker reads and reconciles them in its queue.
var GZ_PET = globalThis.GZ_PET || (() => {
  const lib = (name, file) => globalThis[name] || require(file);
  const KEY = /^pet:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i;
  const ITEM = /^(?:[a-z_]+:(?:\d+|_\d+_\d+)|task:[\w-]{1,40})$/;
  const LEVELS = [0, 60, 160, 320, 600];
  const DECOR = { books: { level: 1, art: 'study/closed-books' }, plant: { level: 2, art: 'cozy-autumn/mushroom' }, moon: { level: 3, art: 'space-sky/crescent-moon' }, stars: { level: 4, art: 'study/star-cluster' } };
  const WEAR = { plain: { level: 1, art: 'study-buddy' }, bandana: { level: 2, art: 'study-buddy-bandana' }, happy: { level: 5, art: 'study-buddy-happy' } };
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const storeKey = (origin, uid) => `pet:${origin}/${uid}`;
  const clean = (raw) => ({
    earned: Object.fromEntries(Object.entries(obj(raw?.earned)).filter(([k, v]) => /^(?:work|plan):/.test(k) && ITEM.test(k.slice(5)) && [0, 8, 10, 15, 20].includes(v))),
    seen: Object.fromEntries(Object.entries(obj(raw?.seen)).filter(([k, v]) => ITEM.test(k) && Number.isFinite(v) && v >= 0 && v < 1e14)),
    days: [...new Set((Array.isArray(raw?.days) ? raw.days : []).filter((d) => Number.isInteger(d) && Math.abs(d) < 1e6))].sort((a, b) => a - b),
    wear: Object.hasOwn(WEAR, raw?.wear) ? raw.wear : 'plain',
    decor: Object.fromEntries(Object.entries(obj(raw?.decor)).filter(([k, v]) => Object.hasOwn(DECOR, k) && Number.isInteger(v) && v >= 0 && v < 9)),
  });
  const view = (raw) => {
    const s = clean(raw), work = Object.entries(s.earned).filter(([k]) => k.startsWith('work:')).reduce((n, [, xp]) => n + xp, 0);
    const plans = Object.entries(s.earned).filter(([k]) => k.startsWith('plan:')).reduce((n, [, xp]) => n + xp, 0);
    const streak = s.days.length * 5, xp = work + plans + streak;
    const level = LEVELS.filter((n) => xp >= n).length;
    if (WEAR[s.wear].level > level) s.wear = 'plain';
    s.decor = Object.fromEntries(Object.entries(s.decor).filter(([id]) => DECOR[id].level <= level));
    return { ...s, xp, work, plans, streakXp: streak, level, floor: LEVELS[level - 1], next: LEVELS[level] ?? null };
  };
  // Missing cache rows never remove earned progress. A row explicitly undone does; focus sessions earn nothing.
  const reconcile = (raw, { todo, insights, planner, cache, streak, now, tz }) => {
    const T = lib('GZ_TODO', './todo.js'), I = lib('GZ_INSIGHTS', './insights.js');
    const s = clean(raw), d = T.clean(todo), known = new Map();
    const rec = I.clean(insights);
    for (const c of rec?.courses || []) for (const x of c.items) known.set(x.k, { ...x, seen: rec.at, submitted: !!x.a && ['on', 'late'].includes(x.s) });
    for (const x of Array.isArray(planner) ? planner : []) {
      if (!x || typeof x !== 'object') continue;
      const k = `${x.type}:${x.id}`;
      if (!ITEM.test(k) || (known.has(k) && (cache?.at || 0) < rec.at)) continue;
      const sub = x.sub || {}, old = known.get(k);
      known.set(k, { k, seen: cache?.at || 0, a: sub.submitted && !sub.redo ? old?.a || 0 : 0, d: x.at || old?.d || 0, s: sub.excused ? 'excused' : sub.submitted && !sub.redo ? sub.late ? 'late' : 'on' : 'open', submitted: !!sub.submitted && !sub.redo });
    }
    for (const [k, x] of known) {
      if (x.seen < (s.seen[k] || 0)) { known.delete(k); continue; }
      s.seen[k] = x.seen;
      s.earned[`work:${k}`] = d.items[k]?.done === false || !x.submitted || x.s === 'excused' ? 0 : x.s === 'late' || (x.a && x.d && x.a > x.d) ? 10 : x.d ? 20 : 15;
    }
    if (todo !== undefined) {
      // W17's definition: a do-on day already over, with a known completion time no later than that day's end.
      const items = [...known.values()];
      for (const [k, l] of Object.entries(d.items)) {
        const kept = I.planning({ ...d, items: { [k]: l } }, items, { now, tz }).on.kept;
        if (known.has(k) || k.startsWith('task:') || l.done === false || !l.on || T.keyDay(l.on) >= T.dayOf(now, tz)) s.earned[`plan:${k}`] = l.done === false ? 0 : kept ? 8 : 0;
        if (l.done === false && Object.hasOwn(s.earned, `work:${k}`)) s.earned[`work:${k}`] = 0;
      }
      for (const k of Object.keys(s.earned)) if (k.startsWith('plan:') && !Object.hasOwn(d.items, k.slice(5))) s.earned[k] = 0;
    }
    // Only a fresh cache covering W11's full month can establish streak days. Best is not a history of earned days.
    const R = lib('GZ_REMIND', './remind.js'), today = T.dayOf(now, tz);
    const saved = R.clean({ streak }, now).streak;
    const from = T.midnight(today - 31, tz), through = T.midnight(today + 1, tz);
    if (saved && cache && cache.complete !== false && now >= cache.at && now - cache.at < 6e5 && Date.parse(cache.start) <= from && Date.parse(cache.end) >= through) {
      const o = { span: 'custom', unit: 'days', n: 8, start: 'rolling', past: 'month', group: false, done: 'auto' };
      const b = T.build({ items: planner || [], data: d, o, now, tz });
      const run = R.streak(b, saved, today), days = new Set(s.days);
      for (let day = Math.max(run.start, today - 31); day <= today - (run.extended ? 0 : 1); day++) days.add(day);
      s.days = [...days].sort((a, b) => a - b);
    }
    return s;
  };
  const change = async (m, { local }) => {
    if (typeof m?.key !== 'string' || !KEY.test(m.key)) return { ok: false, error: 'bad' };
    const suffix = m.key.slice(4), tk = `todo:${suffix}`, ik = `insights:${suffix}`, rk = `remind:${suffix}`;
    const got = await local.get([m.key, tk, ik, rk, 'todoCache']);
    const cache = got.todoCache?.key === tk ? got.todoCache : null;
    const s = reconcile(got[m.key], { todo: got[tk], insights: got[ik], planner: cache?.items, cache, streak: got[rk]?.streak, now: Date.now(), tz: lib('GZ_TODO', './todo.js').zone(m.tz) });
    const v = view(s);
    if (m.op === 'wear') {
      if (!Object.hasOwn(WEAR, m.wear) || WEAR[m.wear].level > v.level) return { ok: false, error: 'locked' };
      s.wear = m.wear;
    } else if (m.op === 'decor') {
      if (!Object.hasOwn(DECOR, m.item) || DECOR[m.item].level > v.level || (m.cell !== null && (!Number.isInteger(m.cell) || m.cell < 0 || m.cell > 8))) return { ok: false, error: 'bad' };
      if (m.cell === null) delete s.decor[m.item]; else s.decor[m.item] = m.cell;
    } else if (m.op !== 'read') return { ok: false, error: 'bad' };
    if (JSON.stringify(s) !== JSON.stringify(clean(got[m.key])) && !await local.set({ [m.key]: s })) return { ok: false, error: 'write' };
    return { ok: true, data: view(s) };
  };
  return { KEY, LEVELS, DECOR, WEAR, storeKey, clean, view, reconcile, change };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET; else GZ_PET;
