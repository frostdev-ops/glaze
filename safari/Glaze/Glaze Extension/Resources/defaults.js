// Shared by the content script, the popup, the options page and the tests: the one place a default
// lives. Classic script (the extension loads it after lib/color.js); node loads it via module.exports.
const GZC = typeof GZ_COLOR !== 'undefined' ? GZ_COLOR : require('./lib/color.js');

// One row per colour token: CSS variable, label, default value (the "Frost" preset).
const GZ_COLORS = [
  ['--gz-accent', 'Accent', '#17c8f4'],
  ['--gz-accent-hi', 'Accent bright', '#6fdcff'],
  ['--gz-accent-soft', 'Accent tint', '#082f49'],
  ['--gz-accent-ink', 'Text on accent', '#04121f'],
  ['--gz-surface', 'Surface', '#0d1b2e'],
  ['--gz-surface-2', 'Ground', '#060d18'],
  ['--gz-ink', 'Text', '#e8f2fa'],
  ['--gz-ink-muted', 'Muted text', '#8fa8c0'],
  ['--gz-ink-faint', 'Faint text', '#5c7189'],
  ['--gz-line', 'Line', '#16283f'],
  ['--gz-line-strong', 'Strong line', '#24405f'],
  ['--gz-ok', 'Success', '#34d399'],
  ['--gz-warn', 'Warning', '#fbbf24'],
  ['--gz-err', 'Error', '#f87171'],
];

// Course tabs the declutter switches can hide, by the path segment of their link (so the match
// doesn't depend on the language Ultra is shown in).
const GZ_TABS = [['calendar', 'Calendar'], ['announcements', 'Announcements'], ['engagement', 'Discussions'], ['grades', 'Gradebook'], ['messages', 'Messages'], ['groups', 'Groups'], ['achievements', 'Achievements']];

// Everything else, as [default, rule]. A rule is an enum (array of strings), a [min, max] number
// range, 'bool', 'url' (https only, or empty), 'name' (a preset name) or 'tabs' (GZ_TABS slugs).
// GZ_SANITIZE walks this.
const GZ_SPEC = {
  auto: { on: [false, 'bool'], light: ['Paper', 'name'], dark: ['Frost', 'name'] },
  look: {
    font: ['system', ['system', 'blackboard', 'inter', 'atkinson', 'serif', 'mono']],
    scale: [1, [0.85, 1.25]],
    leading: [1.5, [1.2, 2]],
    radius: [12, [0, 24]],
    density: ['cozy', ['compact', 'cozy', 'roomy']],
    glass: [12, [0, 24]],
    depth: [1, [0, 3]],
    tooltips: [true, 'bool'],
    hints: [true, 'bool'],
  },
  bg: { kind: ['solid', ['solid', 'gradient', 'image', 'aurora']], image: ['', 'url'], dim: [60, [0, 90]], blur: [0, [0, 20]] },
  motion: {
    level: ['subtle', ['off', 'subtle', 'expressive']],
    followSystem: [true, 'bool'],
    enter: [true, 'bool'],
    hover: [true, 'bool'],
    transitions: [true, 'bool'],
  },
  enhance: {
    urgency: [false, 'bool'], clamp: [false, 'bool'], scores: [false, 'bool'], reading: [false, 'bool'],
    inline: [false, 'bool'], previews: [false, 'bool'], progress: [false, 'bool'], keys: [false, 'bool'],
  },
  declutter: { help: [false, 'bool'], banner: [false, 'bool'], faculty: [false, 'bool'], tabs: [[], 'tabs'] },
};

const GZ_DEFAULTS = {
  version: 2,
  enabled: true,
  colors: Object.fromEntries(GZ_COLORS.map(([v, , d]) => [v, d])),
  preset: 'Frost',
  ...Object.fromEntries(Object.entries(GZ_SPEC).map(([g, keys]) => [g, Object.fromEntries(Object.entries(keys).map(([k, [d]]) => [k, d]))])),
  courses: { harmonize: true, colors: {} },
  footer: true,
  presets: [],
};

// ---- presets ---------------------------------------------------------------------------------
// A preset is a full palette. Values are listed in GZ_COLORS order, so a token added to GZ_COLORS
// without a matching value here shows up as undefined immediately rather than silently defaulting.
const GZ_PALETTE = (...v) => Object.fromEntries(GZ_COLORS.map(([tok], i) => [tok, v[i]]));

// [name, colors]. Every palette clears the pairs in GZ_CONTRAST (test/settings.test.js checks).
const GZ_PRESETS = [
  ['Frost', { ...GZ_DEFAULTS.colors }],
  ['Midnight', GZ_PALETTE(
    '#a78bfa', '#c4b5fd', '#2a2140', '#16101f',
    '#16161a', '#0d0d10', '#ececf1', '#a1a1ac', '#6e6e78', '#26262c', '#3a3a44',
    '#34d399', '#fbbf24', '#f87171')],
  ['Forest', GZ_PALETTE(
    '#5eead4', '#99f6e4', '#062f2a', '#04201c',
    '#0f1f18', '#081410', '#e4f2ea', '#93b3a4', '#648376', '#17332a', '#26503f',
    '#34d399', '#fbbf24', '#f87171')],
  ['Ember', GZ_PALETTE(
    '#fb923c', '#fdba74', '#3a2113', '#1e1006',
    '#221c19', '#15100e', '#f5ebe4', '#b4a094', '#82706a', '#332723', '#4d3a33',
    '#34d399', '#fbbf24', '#f87171')],
  ['Paper', GZ_PALETTE(
    '#2563eb', '#1d4ed8', '#dbeafe', '#ffffff',
    '#ffffff', '#f4f5f7', '#14181f', '#5b6472', '#848b96', '#e3e6ea', '#c8cdd4',
    '#15803d', '#b45309', '#b91c1c')],
  ['Rose', GZ_PALETTE(
    '#c026d3', '#a21caf', '#fbe3fb', '#ffffff',
    '#fff7fa', '#fdeef4', '#2a1622', '#6d4d61', '#997d8d', '#f4dbe6', '#e5bfd1',
    '#15803d', '#b45309', '#be123c')],
];
const GZ_MAX_PRESETS = 12;

// ---- sanitize --------------------------------------------------------------------------------
// Stored data (any version) and imported JSON both pass through here: unknown keys dropped, every
// value type- and range-checked, anything invalid replaced by its default. Idempotent, so it runs
// on every read instead of a one-off migration.
const HEX = /^#[0-9a-f]{6}$/i;
// Ultra gives each course one of ten colour slots (.course-color-1…10), the same on every page.
const COURSE_SLOT = /^([1-9]|10)$/;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const cleanName = (n) => (typeof n === 'string' ? n.trim().slice(0, 40) : '');

const cleanValue = (v, d, rule) => {
  if (rule === 'bool') return typeof v === 'boolean' ? v : d;
  if (rule === 'name') return cleanName(v) || d;
  if (rule === 'tabs') return Array.isArray(v) ? [...new Set(v.filter((t) => GZ_TABS.some(([slug]) => slug === t)))] : [...d];
  if (rule === 'url') {
    if (v === '') return '';
    // href, not the raw string: the parser percent-encodes quotes and strips newlines, so the value
    // is safe inside the CSS url("…") content.js builds from it.
    try { const u = typeof v === 'string' && v.length <= 2048 && new URL(v); return u && u.protocol === 'https:' ? u.href : d; } catch { return d; }
  }
  if (typeof rule[0] === 'number') return typeof v === 'number' && v >= rule[0] && v <= rule[1] ? v : d;
  return rule.includes(v) ? v : d;
};

const cleanColors = (raw) => Object.fromEntries(GZ_COLORS.map(([v, , d]) => [v, isObj(raw) && HEX.test(raw[v]) ? raw[v].toLowerCase() : d]));

const GZ_SANITIZE_PRESETS = (list) => {
  const seen = new Set(GZ_PRESETS.map(([n]) => n));
  const out = [];
  for (const p of Array.isArray(list) ? list : []) {
    const name = cleanName(p?.name);
    if (!name || seen.has(name) || !isObj(p.colors)) continue;
    seen.add(name);
    out.push({ name, colors: cleanColors(p.colors) });
    if (out.length === GZ_MAX_PRESETS) break;
  }
  return out;
};

const sameColors = (a, b) => GZ_COLORS.every(([v]) => a[v] === b[v]);
// Built-ins first, then the user's own.
const GZ_ALL_PRESETS = (custom = []) => [...GZ_PRESETS, ...custom.map((p) => [p.name, p.colors])];
const GZ_PRESET = (name, custom) => GZ_ALL_PRESETS(custom).find(([n]) => n === name)?.[1] || null;
const GZ_MATCH_PRESET = (colors, custom) => GZ_ALL_PRESETS(custom).find(([, c]) => sameColors(c, colors))?.[0] || null;

const GZ_SANITIZE = (raw) => {
  raw = isObj(raw) ? raw : {};
  const out = { version: 2, enabled: typeof raw.enabled === 'boolean' ? raw.enabled : GZ_DEFAULTS.enabled };
  out.colors = cleanColors(raw.colors);
  for (const [g, keys] of Object.entries(GZ_SPEC)) {
    const src = isObj(raw[g]) ? raw[g] : {};
    out[g] = Object.fromEntries(Object.entries(keys).map(([k, [d, rule]]) => [k, cleanValue(src[k], d, rule)]));
  }
  // 1.0 had only the three motion switches: all off meant "no motion".
  if (!raw.version && isObj(raw.motion) && raw.motion.level === undefined) {
    out.motion.level = out.motion.enter || out.motion.hover || out.motion.transitions ? 'subtle' : 'off';
  }
  const rc = isObj(raw.courses) ? raw.courses : {};
  const cc = isObj(rc.colors) ? Object.entries(rc.colors).filter(([slot, c]) => COURSE_SLOT.test(slot) && HEX.test(c)) : [];
  out.courses = { harmonize: typeof rc.harmonize === 'boolean' ? rc.harmonize : true, colors: Object.fromEntries(cc.map(([id, c]) => [id, c.toLowerCase()])) };
  out.footer = typeof raw.footer === 'boolean' ? raw.footer : GZ_DEFAULTS.footer;
  out.presets = GZ_SANITIZE_PRESETS(raw.presets);
  // 1.0 stored no preset name: recover it from the palette, so the popup can mark it.
  out.preset = raw.preset === undefined || raw.preset === null
    ? GZ_MATCH_PRESET(out.colors, out.presets)
    : GZ_PRESET(cleanName(raw.preset), out.presets) ? cleanName(raw.preset) : GZ_MATCH_PRESET(out.colors, out.presets);
  return out;
};

// The palette to paint: the user's colours, or with auto on, the light/dark preset for the OS mode.
const GZ_ACTIVE_COLORS = (s, prefersDark) => {
  if (!s.auto.on) return s.colors;
  return GZ_PRESET(prefersDark ? s.auto.dark : s.auto.light, s.presets) || s.colors;
};

// ---- contrast ---------------------------------------------------------------------------------
// [foreground, background, minimum ratio, what it is]. Text pairs need WCAG AA 4.5:1; the muted
// and faint roles are secondary text and lines, held to 3:1.
const GZ_CONTRAST_PAIRS = [
  ['--gz-ink', '--gz-surface', 4.5, 'Text on surface'],
  ['--gz-ink', '--gz-surface-2', 4.5, 'Text on ground'],
  ['--gz-ink-muted', '--gz-surface', 3, 'Muted text on surface'],
  ['--gz-ink-faint', '--gz-surface-2', 3, 'Faint text on ground'],
  ['--gz-accent', '--gz-surface', 3, 'Accent on surface'],
  ['--gz-accent-ink', '--gz-accent', 4.5, 'Text on accent'],
];
const GZ_CONTRAST = (colors) => GZ_CONTRAST_PAIRS.map(([fg, bg, min, label]) => {
  const ratio = GZC.contrast(colors[fg], colors[bg]);
  return { fg, bg, min, label, ratio, pass: ratio >= min };
});

if (typeof module !== 'undefined') {
  module.exports = { GZ_COLORS, GZ_TABS, GZ_SPEC, GZ_DEFAULTS, GZ_PALETTE, GZ_PRESETS, GZ_MAX_PRESETS, GZ_SANITIZE, GZ_SANITIZE_PRESETS, GZ_ALL_PRESETS, GZ_PRESET, GZ_MATCH_PRESET, GZ_ACTIVE_COLORS, GZ_CONTRAST };
}
