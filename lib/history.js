// Looks history and favorites. Both live on this device only (storage.local), never in sync and never on a
// server. History is every theme worn, newest first; the background adds to it whatever changed the theme.
// Classic script after defaults.js; module.exports for node.
const GZ_HISTORY = (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_SANITIZE } : require('../defaults.js');
  // What a Look, a palette or a theme code sets. Tooltips and hints are how Glaze behaves, not how it
  // looks, so they stay the student's. `parts` is the Look's extras ({ x, m }, lib/lookparts.js): not a sync setting
  // (the worker and the editor keep them in `lookX`), but part of a Look all the same, so wearing a theme brings them
  // and wearing one without clears them.
  const KEYS = ['colors', 'preset', 'auto', 'look', 'bg', 'parts'];
  const MAX = 20;
  const MAX_FAVORITES = 100;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const partsOf = (p) => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js')).bundle(p);
  // Any settings (stored, partial, an old entry) as one comparable theme. Cleaning one costs a sanitize and a check of its
  // shader (0.3 ms for a stored one), and the editor asks about every entry again whenever it redraws History, so a
  // theme is cleaned once and remembered with its JSON: the last MEMO by what they were made from (a settings object that
  // keeps changing can't be answered from stale), and a theme made here by itself. Callers treat a theme as read-only;
  // `wear` hands out copies.
  const MEMO = 48;
  const memo = new Map();
  const known = new WeakMap();
  const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  const made = (raw) => {
    const hit = raw && typeof raw === 'object' && known.get(raw);
    if (hit) return hit;
    const key = JSON.stringify(raw ?? null);
    let rec = memo.get(key);
    if (rec) memo.delete(key);
    else {
      const s = G.GZ_SANITIZE(raw);
      const { tooltips, hints, ...look } = s.look;
      const th = { colors: s.colors, preset: s.preset, auto: s.auto, look, bg: s.bg, parts: partsOf(raw?.parts) };
      rec = { theme: freeze(th), json: JSON.stringify(th) };
      known.set(th, rec);
    }
    memo.set(key, rec);
    if (memo.size > MEMO) memo.delete(memo.keys().next().value);
    return rec;
  };
  const theme = (raw) => made(raw).theme;
  // Settings `s` going on to wear them: list with them first, once.
  const add = (list, s, at) => {
    const { theme: th, json } = made(s);
    if (same(list[0]?.theme, th)) return list;
    return [{ theme: th, at }, ...list.filter((e) => made(e.theme).json !== json)].slice(0, MAX);
  };
  // The newest entry that isn't what `s` wears now: "Previous Look".
  const previous = (list, s) => {
    const { json } = made(s);
    return list.find((e) => made(e.theme).json !== json) || null;
  };
  const wearing = (s, e) => made(s).json === made(e.theme).json;
  // The KEYS to save for wearing entry `e` over settings `s`.
  const wear = (s, e) => {
    const th = structuredClone(made(e.theme).theme);
    return { ...th, look: { ...th.look, tooltips: s.look.tooltips, hints: s.look.hints } };
  };
  // A favorite is { code, name, author, at }; one per code, newest first.
  const favor = (list, f) => [f, ...list.filter((x) => x.code !== f.code)].slice(0, MAX_FAVORITES);
  // storage.local is Glaze's own, but an old or hand-edited list shouldn't break the editor.
  const entries = (v) => (Array.isArray(v) ? v.filter((e) => e && typeof e === 'object' && e.theme && typeof e.theme === 'object') : []);
  const favorites = (v) => (Array.isArray(v) ? v.filter((f) => typeof f?.code === 'string' && typeof f.name === 'string') : []);

  return { KEYS, MAX, MAX_FAVORITES, theme, add, previous, wearing, wear, favor, entries, favorites };
})();

if (typeof module !== 'undefined') module.exports = GZ_HISTORY;
