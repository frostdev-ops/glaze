// Local pet game (W24). Sources are existing device records only; the worker reads and reconciles them in its queue.
var GZ_PET = globalThis.GZ_PET || (() => {
  const lib = (name, file) => globalThis[name] || require(file);
  const KEY = /^pet:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i;
  const WORK = /^(?:assignment|quiz|discussion_topic|sub_assignment):(?:\d{1,20}|_\d{1,20}_\d{1,20})$/;
  const ITEM = /^(?:(?:assignment|quiz|discussion_topic|sub_assignment):(?:\d{1,20}|_\d{1,20}_\d{1,20})|task:[\w-]{1,40})$/;
  const MAX = 65536, MAX_DAYS = 32768;
  const LEVELS = [0, 60, 160, 320, 600];
  const DECOR = {
    books: { level: 1, art: 'study/closed-books', name: 'Books' }, plant: { level: 2, art: 'cozy-autumn/mushroom', name: 'Mushroom' },
    moon: { level: 3, art: 'space-sky/crescent-moon', name: 'Moon', fixed: true }, stars: { level: 4, art: 'study/star-cluster', name: 'Stars', fixed: true },
    shelf: { level: 1, art: 'habitat/shelf', name: 'Oak shelf', fixed: true, shelf: true }, bed: { level: 2, art: 'habitat/pet-bed', name: 'Cozy bed' },
    ball: { level: 1, art: 'habitat/toy-ball', name: 'Toy ball', toy: true }, yarn: { level: 1, art: 'habitat/yarn-ball', name: 'Yarn ball', toy: true },
    ledge: { level: 3, art: 'habitat/shelf', name: 'Low shelf', fixed: true, shelf: true }, loft: { level: 7, art: 'habitat/shelf', name: 'Loft shelf', fixed: true, shelf: true },
    kelp: { level: 3, art: 'habitat/kelp', name: 'Kelp garden' }, castle: { level: 5, art: 'habitat/sandcastle', name: 'Aquarium castle' },
    lamp: { level: 6, art: 'study/desk-lamp', name: 'Reading lamp' }, pillow: { level: 8, art: 'cozy-autumn/folded-blanket', name: 'Soft blanket' },
    globe: { level: 10, art: 'space-sky/earthlike-planet', name: 'Little world' }, telescope: { level: 12, art: 'space-sky/telescope', name: 'Telescope' },
    rocket: { level: 15, art: 'space-sky/rocket', name: 'Dream rocket' }, rainbow: { level: 20, art: 'space-sky/rainbow', name: 'Rainbow', fixed: true },
    cap: { level: 25, art: 'study/graduation-cap', name: 'Graduation cap' }, sun: { level: 35, art: 'space-sky/sun', name: 'Sunshine', fixed: true },
    comet: { level: 50, art: 'space-sky/comet', name: 'Comet', fixed: true },
  };
  const HABITATS = { room: 'Cozy room', garden: 'Moss garden', aquarium: 'Water tank', sky: 'Cloud loft' };
  const floor = (level) => level <= LEVELS.length ? LEVELS[level - 1] : 600 + (level - 5) * 200 + (level - 5) * (level - 6) * 20;
  const position = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && v.x >= 5 && v.x <= 95 && v.y >= 10 && v.y <= 96 ? { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10 } : null;
  const cellPosition = (cell) => ({ x: 16 + cell % 3 * 34, y: 24 + Math.floor(cell / 3) * 34 });
  const WEAR = { plain: { level: 1, art: 'study-buddy' }, bandana: { level: 2, art: 'study-buddy-bandana' }, happy: { level: 5, art: 'study-buddy-happy' } };
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const storeKey = (origin, uid) => `pet:${origin}/${uid}`;
  const taskSource = (todo, k) => [k.startsWith('task:') ? todo.tasks.find((x) => `task:${x.id}` === k)?.done ?? null : null, todo.items[k]?.done ?? null, todo.items[k]?.on ?? null];
  const sourceValid = (v) => Array.isArray(v) && v.length === 3 && (v[0] === null || Number.isFinite(v[0]) && v[0] >= 0 && v[0] < 1e14) && (v[1] === null || typeof v[1] === 'boolean') && (v[2] === null || typeof v[2] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v[2]) && Number.isFinite(Date.parse(v[2])) && new Date(v[2]).toISOString().slice(0, 10) === v[2]);
  const restoredTodo = (state, raw) => {
    const todo = lib('GZ_TODO', './todo.js').clean(raw);
    for (const [k, saved] of Object.entries(state.restored)) {
      const actual = taskSource(todo, k);
      actual.forEach((value, i) => { if (value !== saved.to[i]) saved.from[i] = saved.to[i] = value; });
      if (saved.from.every((value, i) => value === saved.to[i])) { delete state.restored[k]; continue; }
      const [done, mark, on] = saved.from, task = todo.tasks.find((x) => `task:${x.id}` === k);
      if (task) { if (done === null) todo.tasks = todo.tasks.filter((x) => x !== task); else task.done = done; }
      const item = todo.items[k] ||= {};
      if (mark === null) delete item.done; else item.done = mark;
      if (on === null) delete item.on; else item.on = on;
      if (!Object.keys(item).length) delete todo.items[k];
    }
    return todo;
  };
  const timerSignal = (raw, now = Date.now()) => {
    const timer = lib('GZ_WIDGETS', './widgets.js').cleanTimer(raw);
    return `${timer.phase}:${timer.end}:${timer.left}:${timer.phase === 'work' && timer.end > now ? 'focus' : 'break'}`;
  };
  const backup = (raw = {}) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 32 || JSON.stringify(raw).length > 16 * 1024 * 1024) return null;
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
      if (!KEY.test(key) || !value || !(out[key] = clean(value))) return null;
      if (!value.needs) delete out[key].needs;
    }
    return out;
  };
  const merge = (current, incoming, tasks) => {
    const a = clean(current), b = clean(incoming);
    if (!a || !b) return null;
    const maxima = (left, right) => Object.fromEntries([...new Set([...Object.keys(left), ...Object.keys(right)])].map((k) => [k, Math.max(left[k] || 0, right[k] || 0)]));
    // A backup adds missing history. Current settled zeros still represent deliberate unticks.
    const training = (brain) => brain.counts.reduce((n, v) => n + v, 0) + brain.observations * .2;
    const brain = current && training(a.brain) >= training(b.brain) ? a.brain : b.brain;
    if (tasks) {
      const before = restoredTodo(a, tasks.before), after = lib('GZ_TODO', './todo.js').clean(tasks.after);
      // Imported completion/plan fields are a baseline, not a new user untick or re-tick.
      for (const k of new Set(Object.keys(a.earned).map((id) => id.slice(5)))) {
        const from = taskSource(before, k), to = taskSource(after, k);
        if (JSON.stringify(from) !== JSON.stringify(to)) a.restored[k] = { from, to }; else delete a.restored[k];
      }
    }
    for (const id of Object.keys(a.earned)) delete b.restored[id.slice(5)];
    return clean({ ...b, brain, restored: { ...b.restored, ...a.restored }, timerSignal: a.timerSignal,
      needs: incoming?.needs && (!current?.needs || b.needs.at > a.needs.at) ? b.needs : a.needs,
      earned: { ...b.earned, ...a.earned }, days: [...new Set([...a.days, ...b.days])], seen: maxima(a.seen, b.seen), sub: maxima(a.sub, b.sub) });
  };
  // null means unreadable or over capacity: callers must leave the original record untouched, never reset it.
  const clean = (raw, now = Date.now()) => {
    if (raw != null && (typeof raw !== 'object' || Array.isArray(raw))) return null;
    const sub = obj(raw?.sub);
    if (raw?.sub !== undefined && sub !== raw.sub) return null;
    if (Object.keys(sub).length > MAX || Object.entries(sub).some(([k, v]) => !WORK.test(k) || !Number.isFinite(v) || v <= 0 || v >= 1e14)) return null;
    if (Object.keys(obj(raw?.restored)).length > MAX) return null;
    if (Object.keys(obj(raw?.earned)).length > MAX || Object.keys(obj(raw?.seen)).length > MAX || (Array.isArray(raw?.days) && raw.days.length > MAX_DAYS)) return null;
    return {
      earned: Object.fromEntries(Object.entries(obj(raw?.earned)).filter(([k, v]) => ((k.startsWith('work:') && WORK.test(k.slice(5))) || (k.startsWith('plan:') && ITEM.test(k.slice(5)))) && [0, 8, 10, 15, 20].includes(v))),
      restored: Object.fromEntries(Object.entries(obj(raw?.restored)).filter(([k, v]) => ITEM.test(k) && sourceValid(v?.from) && sourceValid(v?.to)).map(([k, v]) => [k, { from: v.from.slice(), to: v.to.slice() }])),
      timerSignal: typeof raw?.timerSignal === 'string' && /^(work|rest):[0-9.e+]{1,24}:[0-9.e+]{1,24}:(focus|break)$/.test(raw.timerSignal) ? raw.timerSignal : '',
      sub: { ...sub }, // Provider hand-in clock; independent of device/cache freshness and never clamped to now.
      seen: Object.fromEntries(Object.entries(obj(raw?.seen)).filter(([k, v]) => WORK.test(k) && Number.isFinite(v) && v >= 0 && v < 1e14)),
      days: [...new Set((Array.isArray(raw?.days) ? raw.days : []).filter((d) => Number.isInteger(d) && d >= 0 && d <= Math.floor(now / 864e5) + 1))].sort((a, b) => a - b),
      wear: Object.hasOwn(WEAR, raw?.wear) ? raw.wear : 'plain',
      sprite: typeof raw?.sprite === 'string' && /^(?:own:[a-f0-9-]{36}|[a-z][a-z0-9-]{0,30})$/.test(raw.sprite) ? raw.sprite : '',
      decor: Object.fromEntries(Object.entries(obj(raw?.decor)).filter(([k, v]) => Object.hasOwn(DECOR, k) && Number.isInteger(v) && v >= 0 && v < 9)),
      positions: Object.fromEntries(Object.entries(obj(raw?.positions)).filter(([k, v]) => Object.hasOwn(DECOR, k) && position(v)).map(([k, v]) => [k, position(v)])),
      habitat: Object.hasOwn(HABITATS, raw?.habitat) ? raw.habitat : 'room',
      wander: raw?.wander === true, physics: raw?.physics !== false,
      learning: raw?.learning !== false, brain: lib('GZ_PET_BRAIN', './petbrain.js').clean(raw?.brain),
      needs: lib('GZ_PET_BRAIN', './petbrain.js').needs(raw?.needs, Number.isFinite(raw?.needs?.at) && raw.needs.at > 0 ? Math.min(now, raw.needs.at) : now),
    };
  };
  const view = (raw) => {
    const s = clean(raw);
    if (!s) return null;
    const work = Object.entries(s.earned).filter(([k]) => k.startsWith('work:')).reduce((n, [, xp]) => n + xp, 0);
    const plans = Object.entries(s.earned).filter(([k]) => k.startsWith('plan:')).reduce((n, [, xp]) => n + xp, 0);
    const streak = s.days.length * 5, xp = work + plans + streak;
    let level = LEVELS.filter((n) => xp >= n).length;
    while (xp >= floor(level + 1)) level++;
    if (WEAR[s.wear].level > level) s.wear = 'plain';
    s.decor = Object.fromEntries(Object.entries(s.decor).filter(([id]) => DECOR[id].level <= level));
    return { ...s, needs: lib('GZ_PET_BRAIN', './petbrain.js').needs(s.needs), xp, work, plans, streakXp: streak, level, floor: floor(level), next: floor(level + 1) };
  };
  // Absent historical data never removes earned progress; an explicit undo or a newer correction does.
  const reconcile = (raw, { todo, insights, planner, cache, streak, streakOn = true, todoO = { done: 'auto', sync: false }, now, tz }) => {
    const T = lib('GZ_TODO', './todo.js'), I = lib('GZ_INSIGHTS', './insights.js');
    const s = clean(raw, now);
    if (!s) return null;
    const d = restoredTodo(s, todo), known = new Map(), rows = new Map(), undone = new Set();
    s.needs = lib('GZ_PET_BRAIN', './petbrain.js').needs(s.needs, now);
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
      if (todoO.sync && !row) continue; // Missing native tick state is unknown, not an undo.
      if (row ? T.isDone(row, todoO.done, mark) === false && (row.ov?.done === false || mark === false || todoO.done === 'manual')
        : mark === false || (todoO.done === 'manual' && mark !== true)) undone.add(k);
    }
    for (const [k, x] of known) {
      const seen = s.seen[k] || 0;
      if (x.seen < seen) { known.delete(k); continue; }
      // Keep native ticks unless a fresh source proves a newer hand-in on the provider clock.
      if (todoO.sync && !rows.has(k) && Object.hasOwn(s.earned, `work:${k}`)
        && !(s.sub[k] && x.submitted && x.seen > seen && x.a > s.sub[k])) continue;
      const points = undone.has(k) || !x.submitted || x.s === 'excused' ? 0 : x.s === '' ? 15 : x.s === 'late' || (x.a && x.d && x.a > x.d) ? 10 : x.d ? 20 : 15;
      // A visible undo of submitted work is a settled zero, even on the pet's first read.
      if (undone.has(k) && x.submitted) s.earned[`work:${k}`] = 0; else award('work', k, points);
      if (points || Object.hasOwn(s.seen, k) || Object.hasOwn(s.earned, `work:${k}`)) s.seen[k] = x.seen;
      if (Object.hasOwn(s.earned, `work:${k}`) && x.submitted && x.a > 0) s.sub[k] = Math.max(s.sub[k] || 0, x.a);
    }
    for (const k of undone) { award('work', k, 0); award('plan', k, 0); }
    if (todo !== undefined) {
      const tasks = new Map(d.tasks.map((x) => [`task:${x.id}`, x]));
      // Missing task/plan records are tidying, not undo. Known incomplete tasks are an explicit undo.
      for (const [k, task] of tasks) if (!task.done) award('plan', k, 0);
      for (const [k, l] of Object.entries(d.items)) {
        if (todoO.sync && WORK.test(k) && !rows.has(k) && Object.hasOwn(s.earned, `plan:${k}`)) continue;
        const x = known.get(k), task = tasks.get(k), day = T.keyDay(l.on);
        if (undone.has(k) && x?.submitted && day !== null) s.earned[`plan:${k}`] = 0;
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
      if (saved.start < 0 || end - saved.start > MAX_DAYS) return null;
      const days = new Set(s.days);
      for (let day = saved.start; day < end; day++) days.add(day);
      s.days = [...days].sort((a, b) => a - b);
    }
    return clean(s, now);
  };
  const change = async (m, { local, sync }) => {
    if (typeof m?.key !== 'string' || !KEY.test(m.key)) return { ok: false, error: 'bad' };
    const suffix = m.key.slice(4), tk = `todo:${suffix}`, ik = `insights:${suffix}`, rk = `remind:${suffix}`;
    const got = await local.get([m.key, tk, ik, rk, 'todoCache', 'petCharacter', 'widgetTimer']);
    const cur = clean(got[m.key]);
    if (!cur) return { ok: false, error: 'history' };
    const T = lib('GZ_TODO', './todo.js');
    const prefs = sync?.get ? await sync.get(['todo', 'enhance', 'card']) : {};
    const sanitize = typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../defaults.js').GZ_SANITIZE;
    const options = sanitize(prefs), cache = got.todoCache?.key === tk ? got.todoCache : null;
    const s = reconcile(cur, { todo: got[tk], insights: got[ik], planner: cache?.items, cache, streak: got[rk]?.streak, streakOn: options.enhance.streak, todoO: { ...options.todo, sync: options.todo.sync && !/_\d+_\d+$/.test(suffix) }, now: Date.now(), tz: T.zone(m.tz) });
    if (!s) return { ok: false, error: 'history', data: view(cur) };
    const sprites = globalThis.GZ_PET_SPRITES || require('./petsprites.js');
    if (got.petCharacter === undefined && !s.sprite && ['cat', 'bunny'].includes(prefs.card?.pet)) s.sprite = prefs.card.pet;
    if (typeof got.petCharacter === 'string') s.sprite = sprites.ID.test(got.petCharacter) ? got.petCharacter : '';
    if (s.sprite && !(await sprites.change({ op: 'get', id: s.sprite }, { local })).pet) s.sprite = '';
    const v = view(s);
    const B = lib('GZ_PET_BRAIN', './petbrain.js');
    if ((m.action !== undefined || m.context !== undefined) && (!B.ACTIONS.includes(m.action) || !B.context(m.context))) return { ok: false, error: 'bad' };
    const respond = (event) => {
      s.needs = B.interact(s.needs, event);
      if (s.learning) s.brain = B.feedback(s.brain, event, { action: m.action, context: m.context });
    };
    if (v.xp > view(cur).xp) respond('celebrate');
    const signal = timerSignal(got.widgetTimer);
    if (signal.endsWith(':focus') !== s.timerSignal.endsWith(':focus')) respond(signal.endsWith(':focus') ? 'focus' : 'break');
    if (s.timerSignal || got.widgetTimer) s.timerSignal = signal;
    if (m.op === 'sprite') {
      if (m.sprite !== '' && (!sprites.ID.test(m.sprite) || !(await sprites.change({ op: 'get', id: m.sprite }, { local })).pet)) return { ok: false, error: 'bad' };
      s.sprite = m.sprite;
    } else if (m.op === 'wear') {
      if (!Object.hasOwn(WEAR, m.wear) || WEAR[m.wear].level > v.level) return { ok: false, error: 'locked' };
      s.wear = m.wear;
    } else if (m.op === 'decor') {
      if (!Object.hasOwn(DECOR, m.item) || DECOR[m.item].level > v.level || (m.cell !== null && (!Number.isInteger(m.cell) || m.cell < 0 || m.cell > 8))) return { ok: false, error: 'bad' };
      if (m.cell === null) { delete s.decor[m.item]; delete s.positions[m.item]; }
      else { s.decor[m.item] = m.cell; delete s.positions[m.item]; }
    } else if (m.op === 'place') {
      const at = position(m.position);
      if (!Object.hasOwn(DECOR, m.item) || DECOR[m.item].level > v.level || !at) return { ok: false, error: 'bad' };
      s.decor[m.item] = 4; s.positions[m.item] = at;
      if (JSON.stringify(cur.positions[m.item]) !== JSON.stringify(at)) respond('discover');
    } else if (m.op === 'habitat') {
      if (!Object.hasOwn(HABITATS, m.habitat)) return { ok: false, error: 'bad' };
      s.habitat = m.habitat;
      if (cur.habitat !== s.habitat) respond('discover');
    } else if (m.op === 'interact') {
      if (['focus', 'break', 'celebrate'].includes(m.event)) return { ok: false, error: 'bad' };
      const needs = B.interact(s.needs, m.event);
      if (!needs) return { ok: false, error: 'bad' };
      s.needs = needs;
      if (s.learning) s.brain = B.feedback(s.brain, m.event, { action: m.action, context: m.context });
    } else if (m.op === 'observe') {
      const brain = B.observe(s.brain, m.action, m.context);
      if (!s.learning || !brain) return { ok: false, error: 'bad' };
      s.brain = brain;
    } else if (m.op === 'learn') {
      const brain = B.learn(s.brain, m.action, m.context, m.reward);
      if (!s.learning || !brain) return { ok: false, error: 'bad' };
      s.brain = brain;
    } else if (m.op === 'forget') {
      s.brain = B.clean();
    } else if (['wander', 'physics', 'learning'].includes(m.op)) {
      if (typeof m[m.op] !== 'boolean') return { ok: false, error: 'bad' };
      s[m.op] = m[m.op];
      if (m.op === 'wander' && cur.wander !== s.wander) respond(s.wander ? 'out' : m.voluntary === true ? 'settle' : 'home');
      if (m.op === 'learning' && !s.learning) s.brain = B.clean({ ...s.brain, traces: [] });
    } else if (m.op !== 'read') return { ok: false, error: 'bad' };
    const patch = { [m.key]: s };
    if (m.op === 'sprite' || (got.petCharacter === undefined && s.sprite)) patch.petCharacter = s.sprite;
    if ((JSON.stringify(s) !== JSON.stringify(cur) || Object.hasOwn(patch, 'petCharacter')) && !await local.set(patch)) return { ok: false, error: 'write' };
    return { ok: true, data: view(s) };
  };
  return { KEY, MAX, MAX_DAYS, LEVELS, DECOR, HABITATS, WEAR, floor, position, cellPosition, storeKey, clean, view, reconcile, change, backup, merge };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET; else GZ_PET;
