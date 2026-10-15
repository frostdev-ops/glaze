// Local pet game (W24). Sources are existing device records only; the worker reads and reconciles them in its queue.
var GZ_PET = globalThis.GZ_PET || (() => {
  const lib = (name, file) => globalThis[name] || require(file);
  const KEY = /^pet:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i;
  const WORK = /^(?:assignment|quiz|discussion_topic|sub_assignment):(?:\d{1,20}|_\d{1,20}_\d{1,20})$/;
  const ITEM = /^(?:(?:assignment|quiz|discussion_topic|sub_assignment):(?:\d{1,20}|_\d{1,20}_\d{1,20})|task:[\w-]{1,40})$/;
  const MAX = 4096;
  const LEVELS = [0, 60, 160, 320, 600];
  const DECOR = { books: { level: 1, art: 'study/closed-books' }, plant: { level: 2, art: 'cozy-autumn/mushroom' }, moon: { level: 3, art: 'space-sky/crescent-moon' }, stars: { level: 4, art: 'study/star-cluster' } };
  const WEAR = { plain: { level: 1, art: 'study-buddy' }, bandana: { level: 2, art: 'study-buddy-bandana' }, happy: { level: 5, art: 'study-buddy-happy' } };
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const storeKey = (origin, uid) => `pet:${origin}/${uid}`;
  // null means unreadable or over capacity: callers must leave the original record untouched, never reset it.
  const clean = (raw, now = Date.now()) => {
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) return null;
    if (Object.keys(obj(raw?.earned)).length > MAX || Object.keys(obj(raw?.seen)).length > MAX || (Array.isArray(raw?.days) && raw.days.length > MAX)) return null;
    return {
      earned: Object.fromEntries(Object.entries(obj(raw?.earned)).filter(([k, v]) => ((k.startsWith('work:') && WORK.test(k.slice(5))) || (k.startsWith('plan:') && ITEM.test(k.slice(5)))) && [0, 8, 10, 15, 20].includes(v))),
      seen: Object.fromEntries(Object.entries(obj(raw?.seen)).filter(([k, v]) => WORK.test(k) && Number.isFinite(v) && v >= 0 && v < 1e14)),
      days: [...new Set((Array.isArray(raw?.days) ? raw.days : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= Math.floor(now / 864e5) + 1))].sort((a, b) => a - b),
      wear: Object.hasOwn(WEAR, raw?.wear) ? raw.wear : 'plain',
      decor: Object.fromEntries(Object.entries(obj(raw?.decor)).filter(([k, v]) => Object.hasOwn(DECOR, k) && Number.isInteger(v) && v >= 0 && v < 9)),
    };
  };
  const view = (raw) => {
    const s = clean(raw);
    if (!s) return null;
    const work = Object.entries(s.earned).filter(([k]) => k.startsWith('work:')).reduce((n, [, xp]) => n + xp, 0);
    const plans = Object.entries(s.earned).filter(([k]) => k.startsWith('plan:')).reduce((n, [, xp]) => n + xp, 0);
    const streak = s.days.length * 5, xp = work + plans + streak;
    const level = LEVELS.filter((n) => xp >= n).length;
    if (WEAR[s.wear].level > level) s.wear = 'plain';
    s.decor = Object.fromEntries(Object.entries(s.decor).filter(([id]) => DECOR[id].level <= level));
    return { ...s, xp, work, plans, streakXp: streak, level, floor: LEVELS[level - 1], next: LEVELS[level] ?? null };
  };
  // Absent historical data never removes earned progress; an explicit undo or a newer correction does.
  const reconcile = (raw, { todo, insights, planner, cache, streak, streakOn = true, todoO = { done: 'auto', sync: false }, now, tz }) => {
    const T = lib('GZ_TODO', './todo.js'), I = lib('GZ_INSIGHTS', './insights.js');
    const s = clean(raw, now);
    if (!s) return null;
    const d = T.clean(todo), known = new Map(), rows = new Map(), undone = new Set();
    const award = (kind, k, value) => { const id = `${kind}:${k}`; if (value || Object.hasOwn(s.earned, id)) s.earned[id] = value; };
    const rec = I.clean(insights);
    for (const c of rec?.courses || []) for (const x of c.items) if (WORK.test(x.k)) known.set(x.k, { ...x, seen: rec.at, submitted: !!x.a && ['on', 'late', ''].includes(x.s) });
    for (const x of Array.isArray(planner) ? planner : []) {
      if (!x || typeof x !== 'object') continue;
      const k = `${x.type}:${x.id}`;
      if (!WORK.test(k)) continue;
      rows.set(k, x);
      if (known.has(k) && (cache?.at || 0) < (rec?.at || 0)) continue;
      const sub = x.sub || {}, old = known.get(k);
      known.set(k, { k, seen: cache?.at || 0, a: sub.submitted === true && sub.redo !== true ? old?.a || 0 : 0, d: x.at || old?.d || 0,
        s: sub.excused === true ? 'excused' : sub.submitted === true && sub.redo !== true ? x.state === 'unknown' ? '' : sub.late === true ? 'late' : 'on' : 'open', submitted: sub.submitted === true && sub.redo !== true });
    }
    // Use the same done state Better To Do displays, including Canvas planner overrides and manual mode.
    for (const k of new Set([...known.keys(), ...rows.keys(), ...Object.keys(d.items).filter((k) => WORK.test(k))])) {
      const row = rows.get(k), mark = todoO.sync ? undefined : d.items[k]?.done;
      if (todoO.sync && !row) { known.delete(k); continue; } // Native tick state is unknown outside the planner window.
      if (row ? T.isDone(row, todoO.done, mark) === false && (row.ov?.done === false || mark === false || todoO.done === 'manual')
        : mark === false || (todoO.done === 'manual' && mark !== true)) undone.add(k);
    }
    for (const [k, x] of known) {
      if (x.seen < (s.seen[k] || 0)) { known.delete(k); continue; }
      const points = undone.has(k) || !x.submitted || x.s === 'excused' ? 0 : x.s === '' ? 15 : x.s === 'late' || (x.a && x.d && x.a > x.d) ? 10 : x.d ? 20 : 15;
      award('work', k, points);
      if (points || Object.hasOwn(s.seen, k) || Object.hasOwn(s.earned, `work:${k}`)) s.seen[k] = x.seen;
    }
    for (const k of undone) { award('work', k, 0); award('plan', k, 0); }
    if (todo !== undefined) {
      const tasks = new Map(d.tasks.map((x) => [`task:${x.id}`, x]));
      // Missing task/plan records are tidying, not undo. Known incomplete tasks are an explicit undo.
      for (const [k, task] of tasks) if (!task.done) award('plan', k, 0);
      for (const [k, l] of Object.entries(d.items)) {
        if (todoO.sync && WORK.test(k) && !rows.has(k)) continue;
        const x = known.get(k), task = tasks.get(k), day = T.keyDay(l.on);
        if (undone.has(k) || day === null || day >= T.dayOf(now, tz) || (task && !task.done) || (x && !x.submitted)) { award('plan', k, 0); continue; }
        if (!task && !x?.a) continue; // Clearing Insights cannot turn an unknown completion time into a failed plan.
        const kept = I.planning({ tasks: task ? [task] : [], items: { [k]: l } }, x ? [x] : [], { now, tz, fromDay: -Infinity }).on.kept;
        award('plan', k, kept ? 8 : 0);
      }
    }
    // W11's calculated record is authoritative, including restores. A stale start cannot verify later days.
    const saved = lib('GZ_REMIND', './remind.js').clean({ streak }, now).streak;
    const today = T.dayOf(now, tz);
    const end = saved?.asOf === null ? null : Math.min(today, saved?.asOf);
    if (streakOn && saved && end !== null && saved.start < end) {
      if (saved.start < 0 || end - saved.start > MAX) return null;
      const days = new Set(s.days);
      for (let day = saved.start; day < end; day++) days.add(day);
      s.days = [...days].sort((a, b) => a - b);
    }
    return clean(s, now);
  };
  const change = async (m, { local, sync }) => {
    if (typeof m?.key !== 'string' || !KEY.test(m.key)) return { ok: false, error: 'bad' };
    const suffix = m.key.slice(4), tk = `todo:${suffix}`, ik = `insights:${suffix}`, rk = `remind:${suffix}`;
    const got = await local.get([m.key, tk, ik, rk, 'todoCache']);
    const cur = clean(got[m.key]);
    if (!cur) return { ok: false, error: 'history' };
    const prefs = sync?.get ? await sync.get(['todo', 'enhance']) : {};
    const sanitize = typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../defaults.js').GZ_SANITIZE;
    const options = sanitize(prefs), cache = got.todoCache?.key === tk ? got.todoCache : null;
    const s = reconcile(cur, { todo: got[tk], insights: got[ik], planner: cache?.items, cache, streak: got[rk]?.streak, streakOn: options.enhance.streak, todoO: { ...options.todo, sync: options.todo.sync && !/_\d+_\d+$/.test(suffix) }, now: Date.now(), tz: lib('GZ_TODO', './todo.js').zone(m.tz) });
    if (!s) return { ok: false, error: 'history', data: view(cur) };
    const v = view(s);
    if (m.op === 'wear') {
      if (!Object.hasOwn(WEAR, m.wear) || WEAR[m.wear].level > v.level) return { ok: false, error: 'locked' };
      s.wear = m.wear;
    } else if (m.op === 'decor') {
      if (!Object.hasOwn(DECOR, m.item) || DECOR[m.item].level > v.level || (m.cell !== null && (!Number.isInteger(m.cell) || m.cell < 0 || m.cell > 8))) return { ok: false, error: 'bad' };
      if (m.cell === null) delete s.decor[m.item]; else s.decor[m.item] = m.cell;
    } else if (m.op !== 'read') return { ok: false, error: 'bad' };
    if (JSON.stringify(s) !== JSON.stringify(cur) && !await local.set({ [m.key]: s })) return { ok: false, error: 'write' };
    return { ok: true, data: view(s) };
  };
  return { KEY, MAX, LEVELS, DECOR, WEAR, storeKey, clean, view, reconcile, change };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET; else GZ_PET;
