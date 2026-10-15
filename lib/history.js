// Looks history and favorites. Both live on this device only (storage.local), never in sync and never on a
// server. History is every theme worn, newest first; the background adds to it whatever changed the theme.
// Classic script after defaults.js; module.exports for node.
const GZ_HISTORY = (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_SANITIZE } : require('../defaults.js');
  // What a Look, a palette or a theme code sets. Tooltips and hints are how Glaze behaves, not how it
  // looks, so they stay the student's.
  const KEYS = ['colors', 'preset', 'auto', 'look', 'bg'];
  const MAX = 20;
  const MAX_FAVORITES = 100;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Any settings (stored, partial, an old entry) as one comparable theme.
  const theme = (raw) => {
    const s = G.GZ_SANITIZE(raw);
    const { tooltips, hints, ...look } = s.look;
    return { colors: s.colors, preset: s.preset, auto: s.auto, look, bg: s.bg };
  };
  // Settings `s` going on to wear them: list with them first, once.
  const add = (list, s, at) => {
    const th = theme(s);
    if (same(list[0]?.theme, th)) return list;
    return [{ theme: th, at }, ...list.filter((e) => !same(theme(e.theme), th))].slice(0, MAX);
  };
  // The newest entry that isn't what `s` wears now: "Previous Look".
  const previous = (list, s) => {
    const th = theme(s);
    return list.find((e) => !same(theme(e.theme), th)) || null;
  };
  const wearing = (s, e) => same(theme(s), theme(e.theme));
  // The KEYS to save for wearing entry `e` over settings `s`.
  const wear = (s, e) => {
    const th = theme(e.theme);
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
