// A bounded, local contextual bandit; only numeric signals and aggregate habits are retained.
var GZ_PET_BRAIN = globalThis.GZ_PET_BRAIN || (() => {
  const VERSION = 2, ACTIONS = ['walk', 'perch', 'hide', 'rest', 'greet', 'investigate', 'follow', 'play', 'study', 'groom', 'stretch', 'home'], FEATURES = 26;
  const EVENTS = { pet: [6, 3, 1, 1], play: [5, 8, -3, 1], away: [0, -2, 0, -.7], home: [2, -1, 4, -.5], out: [2, 4, -2, .3], rest: [1, -1, 5, .2], focus: [2, -1, 1, .45], break: [3, 4, 2, .5], celebrate: [6, 5, 1, .8], discover: [3, 4, -1, .6], settle: [2, -1, 3, .4] };
  const EXTRA = { pet: [5, 0, 3], play: [3, 4, 1], away: [0, 0, 1], home: [1, -1, 5], out: [1, 3, -1], rest: [0, -1, 4], focus: [1, 1, 2], break: [2, 3, 2], celebrate: [4, 3, 2], discover: [1, 6, 1], settle: [1, -1, 5] };
  const own = (v, k) => v !== null && typeof v === 'object' && Object.hasOwn(v, k) ? v[k] : undefined;
  const bound = (v, lo, hi, fallback = 0) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  const round = (v) => Math.round(v * 1e6) / 1e6;
  const row = (v, i) => Array.isArray(v) ? own(v, i) : undefined;
  const cell = (v, i, j) => row(row(v, i), j);
  const actionIndex = (a) => ACTIONS.indexOf(a);
  const stamp = (v) => Number.isSafeInteger(v) && v > 0 && v <= Date.now() ? v : 0;
  const context = (v) => Array.isArray(v) && (v.length === 12 || v.length === 24 || v.length === FEATURES) && v[0] === 1 && Array.from({ length: v.length }, (_, i) => Object.hasOwn(v, i) && Number.isFinite(v[i]) && v[i] >= -1 && v[i] <= 1).every(Boolean);
  const dense = (v) => v.length === FEATURES ? v.slice() : [...v, ...Array(FEATURES - v.length).fill(0)];
  const vector = (v = {}) => {
    const n = own(v, 'needs'), need = (k, base) => bound(own(n, k), 0, 100, base) / 50 - 1;
    const hour = bound(own(v, 'hour'), 0, 24, new Date().getHours()) / 24 * Math.PI * 2, kind = own(v, 'kind');
    const yes = (k) => own(v, k) === true ? 1 : 0;
    return [1, yes('focus'), yes('pointerNear'), need('mood', 72), need('playful', 65), need('energy', 62), Math.sin(hour), Math.cos(hour), kind === 'heading' ? 1 : 0, kind === 'card' ? 1 : 0, yes('wandering'), yes('water'), need('bond', 55), need('curiosity', 65), need('comfort', 75), bound(own(v, 'idle'), 0, 120) / 120, bound(own(v, 'cursorSpeed'), 0, 1000) / 1000, yes('typing'), yes('scrolling'), yes('moved'), yes('celebrating'), yes('decor'), kind === 'bed' ? 1 : 0, yes('returning'), kind === 'ball' ? 1 : 0, kind === 'yarn' ? 1 : 0];
  };
  const needs = (raw, now = Date.now()) => {
    now = Math.floor(bound(now, 0, 864e13, Date.now()) / 60000) * 60000;
    const at = Math.floor(bound(own(raw, 'at'), 0, now, now) / 60000) * 60000;
    const relax = 1 - Math.exp(-Math.min(864e5, now - at) / (4 * 36e5));
    const bases = { mood: 72, playful: 65, energy: 62 + 18 * Math.cos((new Date(now).getHours() - 14) / 24 * Math.PI * 2), bond: 55, curiosity: 65, comfort: 75 };
    const value = {};
    for (const key of Object.keys(bases)) value[key] = Math.round((bound(own(raw, key), 0, 100, bases[key]) * (1 - relax) + bases[key] * relax) * 10) / 10;
    return { ...value, at: now };
  };
  const interact = (raw, event, now = Date.now()) => {
    if (!Object.hasOwn(EVENTS, event)) return null;
    const v = needs(raw, now), delta = [...EVENTS[event].slice(0, 3), ...EXTRA[event]];
    ['mood', 'playful', 'energy', 'bond', 'curiosity', 'comfort'].forEach((key, i) => { v[key] = bound(v[key] + delta[i], 0, 100); });
    return v;
  };
  const clean = (raw) => {
    const matrix = (key, columns, lo, hi, fallback = 0) => ACTIONS.map((_, i) => Array.from({ length: columns }, (_, j) => round(bound(cell(own(raw, key), i, j), lo, hi, fallback))));
    const values = (key, lo, hi) => ACTIONS.map((_, i) => round(bound(row(own(raw, key), i), lo, hi)));
    const traces = [], input = own(raw, 'traces');
    if (Array.isArray(input)) for (let i = 0; i < Math.min(3, input.length); i++) {
      const t = own(input, i), action = own(t, 'action'), x = own(t, 'context'), at = stamp(own(t, 'at'));
      if (actionIndex(action) >= 0 && context(x) && at && (!traces.length || at > traces[traces.length - 1].at)) traces.push({ action, context: dense(x), at });
    }
    return { version: VERSION, weights: matrix('weights', FEATURES, -3, 3), confidence: matrix('confidence', FEATURES, 1, 1e6, 1), counts: values('counts', 0, 1e9).map(Math.floor), short: values('short', -1, 1), long: values('long', -1, 1), habits: matrix('habits', 6, -1, 1), habitCounts: matrix('habitCounts', 6, 0, 1e6).map((r) => r.map(Math.floor)), transitions: matrix('transitions', ACTIONS.length, 0, 1e6), observations: Math.floor(bound(own(raw, 'observations'), 0, 1e6)), observedAt: stamp(own(raw, 'observedAt')), lastAction: actionIndex(own(raw, 'lastAction')) >= 0 ? own(raw, 'lastAction') : '', feedbackAt: stamp(own(raw, 'feedbackAt')), traces };
  };
  const bucket = (x) => Math.min(5, Math.floor(((Math.atan2(x[6], x[7]) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 3) + 1e-9));
  const score = (weights, x) => Math.tanh(weights.reduce((n, w, i) => n + w * x[i], 0));
  const predict = (raw, action, x) => {
    const i = actionIndex(action);
    if (i < 0 || !context(x)) return 0;
    const m = clean(raw); return score(m.weights[i], dense(x));
  };
  const CALM = ['perch', 'hide', 'rest', 'study', 'groom', 'stretch', 'home'];
  const drive = (a, x) => {
    const low = (i) => (1 - x[i]) / 2, focused = Math.max(x[1], x[17]), busy = Math.max(focused, x[18]);
    const drives = {
      walk: .08 * low(13) + .08 * x[10] - .2 * busy,
      perch: .5 + .1 * x[8] + .3 * focused + .12 * (1 - low(14)),
      hide: .24 + .16 * x[9] + .12 * low(14) - .08 * x[23],
      rest: .34 + .3 * low(5) + .12 * x[15] + .22 * focused,
      greet: .24 * low(12) + .22 * x[23] + .12 * x[20] - .2 * busy,
      investigate: .3 * low(13) + .16 * x[21] + .12 * x[19] - .22 * busy,
      follow: .18 * x[2] + .12 * x[16] + .14 * low(12) - .25 * busy,
      play: .28 * low(4) + .18 * x[20] + .08 * x[2] - .32 * busy - .16 * low(5),
      study: .28 + .58 * focused + .12 * x[18] + .08 * x[9],
      groom: .3 + .2 * low(14) + .12 * (1 - low(14)) + .12 * x[15],
      stretch: .14 + .2 * x[15] + .12 * low(5) - .1 * busy,
      home: .28 + .26 * x[22] + .22 * low(14) + .16 * low(5) + .08 * focused,
    };
    return drives[a];
  };
  const choose = (raw, x, available = ACTIONS, random = Math.random, options = {}) => {
    const choices = Array.isArray(available) ? ACTIONS.filter((a) => available.includes(a)) : [];
    if (!context(x) || !choices.length) return 'rest';
    const m = clean(raw), v = dense(x), norm = v.reduce((n, z) => n + z * z, 0), b = bucket(v);
    const recent = Array.isArray(options?.recent) ? options.recent.slice(-6) : [], previous = actionIndex(recent[recent.length - 1]);
    const roll = () => bound(typeof random === 'function' ? random() : .5, 0, 1, .5);
    let best = choices[0], top = -Infinity;
    // Diagonal confidence explores uncertain signals; short values let changed preferences recover quickly.
    for (const a of choices) {
      const i = actionIndex(a), uncertainty = Math.sqrt(v.reduce((n, z, j) => n + z * z / m.confidence[i][j], 0) / norm);
      const learned = raw ? score(m.weights[i], v) + .12 * m.short[i] + .06 * m.long[i] + .18 * m.habits[i][b] + .08 * uncertainty : 0;
      const familiarity = raw && previous >= 0 ? .06 * m.transitions[previous][i] / (1 + m.transitions[previous].reduce((n, z) => n + z, 0)) : 0;
      const fatigue = recent.reduce((n, old, j) => n + (old === a ? (CALM.includes(a) ? .025 : .09) * (j + 1) / recent.length : 0), 0);
      const value = learned + drive(a, v) + familiarity - fatigue + roll() * .05;
      if (value > top) { best = a; top = value; }
    }
    return best;
  };
  const update = (m, action, x, reward, credit = 1) => {
    const i = actionIndex(action), v = dense(x), predicted = score(m.weights[i], v), norm = v.reduce((n, z) => n + z * z, 0);
    const rate = .42 / (1 + Math.min(400, m.counts[i]) / 200), b = bucket(v);
    m.weights[i] = m.weights[i].map((w, j) => round(bound(w * .9995 + rate * credit * (reward - predicted) * v[j] / norm, -3, 3)));
    m.confidence[i] = m.confidence[i].map((c, j) => round(Math.min(1e6, c + credit * v[j] * v[j])));
    m.short[i] = round(m.short[i] + .3 * credit * (reward - m.short[i]));
    m.long[i] = round(m.long[i] + .035 * credit * (reward - m.long[i]));
    m.habits[i][b] = round(m.habits[i][b] + .18 * credit * (reward - m.habits[i][b]));
    m.habitCounts[i][b] = Math.min(1e6, m.habitCounts[i][b] + 1); m.counts[i] = Math.min(1e9, m.counts[i] + 1);
    return m;
  };
  const learn = (raw, action, x, reward) => actionIndex(action) >= 0 && context(x) && Number.isFinite(reward) && reward >= -1 && reward <= 1 ? update(clean(raw), action, x, reward) : null;
  const observe = (raw, action, x, now = Date.now()) => {
    if (actionIndex(action) < 0 || !context(x) || !stamp(now)) return null;
    const m = clean(raw);
    if ((m.observedAt && now - m.observedAt < 8000) || now <= m.feedbackAt) return m;
    if (m.lastAction && now - m.observedAt <= 60000) {
      const i = actionIndex(m.lastAction), j = actionIndex(action);
      m.transitions[i] = m.transitions[i].map((n, k) => round(Math.min(1e6, n * .997 + (j === k ? 1 : 0))));
    }
    m.traces = [...m.traces.filter((t) => now - t.at <= 60000), { action, context: dense(x), at: now }].slice(-3);
    m.observations = Math.min(1e6, m.observations + 1); m.observedAt = now; m.lastAction = action;
    return m;
  };
  const feedback = (raw, event, options = {}) => {
    if (!Object.hasOwn(EVENTS, event)) return null;
    const now = own(options, 'now') ?? Date.now();
    if (!stamp(now)) return null;
    let m = clean(raw);
    if (now <= m.feedbackAt || now < m.observedAt) return m;
    const action = own(options, 'action'), x = own(options, 'context');
    if ((action !== undefined || x !== undefined) && (actionIndex(action) < 0 || !context(x))) return null;
    const current = action !== undefined ? dense(x) : null;
    const traces = m.traces.filter((t) => now >= t.at && now - t.at <= 60000 && !(current && t.action === action && t.context.every((z, i) => z === current[i])));
    if (current) traces.push({ action, context: current, at: now });
    // Feedback consumes its traces once, assigning less credit to older decisions in a short sequence.
    const credits = traces.slice(-3).map((t) => Math.exp(-(now - t.at) / 20000)), total = Math.max(1, credits.reduce((n, c) => n + c, 0));
    traces.slice(-3).forEach((t, i) => { m = update(m, t.action, t.context, EVENTS[event][3], credits[i] / total); });
    m.traces = []; m.feedbackAt = now;
    return m;
  };
  const describe = (raw) => {
    const m = clean(raw), total = m.counts.reduce((n, c) => n + c, 0), familiarity = Math.round(100 * (1 - Math.exp(-(total + m.observations * .2) / 90)));
    let favorite = 1, top = -Infinity;
    ACTIONS.forEach((_, i) => { const value = m.long[i] * .6 + m.short[i] * .4; if (m.counts[i] && value > top) { favorite = i; top = value; } });
    let habit = '', strength = .1;
    m.habits[favorite].forEach((value, b) => { const confidence = Math.min(1, m.habitCounts[favorite][b] / 4), score = value * confidence; if (score > strength) { habit = ['night', 'morning', 'morning', 'afternoon', 'evening', 'night'][b]; strength = score; } });
    return { familiarity, favorite: ACTIONS[favorite], habit };
  };
  return { VERSION, ACTIONS, FEATURES, EVENTS, vector, context, clean, choose, learn, predict, needs, interact, observe, feedback, describe };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_BRAIN; else GZ_PET_BRAIN;
