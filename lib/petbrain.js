// A local contextual bandit: online gradient updates learn which actions the student welcomes.
var GZ_PET_BRAIN = globalThis.GZ_PET_BRAIN || (() => {
  const ACTIONS = ['walk', 'perch', 'hide', 'rest', 'greet'], FEATURES = 12;
  const EVENTS = { pet: [6, 3, 1, 1], play: [5, 8, -3, 1], away: [0, -2, 0, -.7], home: [2, -1, 4, -.5], out: [2, 4, -2, .3], rest: [1, -1, 5, .2] };
  const clamp = (n) => Math.max(0, Math.min(100, n));
  const needs = (raw, now = Date.now()) => {
    if (!Number.isFinite(now)) now = Date.now();
    now = Math.max(0, Math.min(864e13, Math.floor(now / 60000) * 60000));
    const at = Number.isFinite(raw?.at) ? Math.max(0, Math.min(now, raw.at)) : now;
    const elapsed = Math.max(0, Math.min(864e5, now - at)), relax = 1 - Math.exp(-elapsed / (4 * 36e5));
    const hour = new Date(now).getHours(), energy = 62 + 18 * Math.cos((hour - 14) / 24 * Math.PI * 2);
    const value = (key, base) => Math.round(clamp((Number.isFinite(raw?.[key]) ? clamp(raw[key]) : base) * (1 - relax) + base * relax) * 10) / 10;
    return { mood: value('mood', 72), playful: value('playful', 65), energy: value('energy', energy), at: Math.floor(now / 60000) * 60000 };
  };
  const interact = (raw, event, now = Date.now()) => {
    if (!Object.hasOwn(EVENTS, event)) return null;
    const v = needs(raw, now), delta = EVENTS[event];
    return { ...v, mood: clamp(v.mood + delta[0]), playful: clamp(v.playful + delta[1]), energy: clamp(v.energy + delta[2]) };
  };
  const context = (v) => Array.isArray(v) && v.length === FEATURES && [...v].every((n) => Number.isFinite(n) && n >= -1 && n <= 1) && v[0] === 1;
  const clean = (raw) => ({
    weights: ACTIONS.map((_, i) => Array.from({ length: FEATURES }, (_, j) => Number.isFinite(raw?.weights?.[i]?.[j]) ? Math.max(-3, Math.min(3, raw.weights[i][j])) : 0)),
    counts: ACTIONS.map((_, i) => Number.isSafeInteger(raw?.counts?.[i]) ? Math.max(0, Math.min(1e9, raw.counts[i])) : 0),
  });
  const score = (weights, x) => Math.tanh(weights.reduce((n, w, i) => n + w * x[i], 0));
  const choose = (raw, x, available = ACTIONS, random = Math.random) => {
    const model = clean(raw), choices = Array.isArray(available) ? available.filter((a) => ACTIONS.includes(a)) : [];
    if (!context(x) || !choices.length) return 'rest';
    if (random() < .14) return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))];
    const scores = choices.map((a) => { const i = ACTIONS.indexOf(a); const needs = a === 'rest' ? -x[5] * .16 : a === 'greet' || a === 'hide' ? x[4] * .12 : x[5] * .05; return { a, value: score(model.weights[i], x) + needs + .18 / Math.sqrt(1 + model.counts[i]) + random() * .08 }; });
    return scores.sort((a, b) => b.value - a.value)[0].a;
  };
  const learn = (raw, action, x, reward) => {
    if (!ACTIONS.includes(action) || !context(x) || !Number.isFinite(reward) || reward < -1 || reward > 1) return null;
    const model = clean(raw), i = ACTIONS.indexOf(action), predicted = score(model.weights[i], x);
    const rate = .2 / Math.sqrt(1 + model.counts[i] / 40), norm = x.reduce((n, v) => n + v * v, 0);
    model.weights[i] = model.weights[i].map((w, j) => Math.round(Math.max(-3, Math.min(3, w * .999 + rate * (reward - predicted) * x[j] / norm)) * 1e6) / 1e6);
    model.counts[i] = Math.min(1e9, model.counts[i] + 1);
    return model;
  };
  const predict = (raw, action, x) => ACTIONS.includes(action) && context(x) ? score(clean(raw).weights[ACTIONS.indexOf(action)], x) : 0;
  return { ACTIONS, FEATURES, EVENTS, context, clean, choose, learn, predict, needs, interact };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_BRAIN; else GZ_PET_BRAIN;
