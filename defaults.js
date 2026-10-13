// Shared by the content script, the popup, the options page and the tests: the one place a default
// lives. Classic script (the extension loads it after lib/color.js); node loads it via module.exports.
const GZC = typeof GZ_COLOR !== 'undefined' ? GZ_COLOR : require('./lib/color.js');
const GZF = typeof GZ_FONTS !== 'undefined' ? GZ_FONTS : require('./lib/fonts.js');

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
// range, 'bool', 'url' (https only, or empty), 'name' (a preset name), 'tabs' (GZ_TABS slugs),
// 'hexes' (three #rrggbb colors, or none), 'font' (a lib/fonts.js id or a typed family name) or
// 'font-auto' (the same, or 'auto'). GZ_SANITIZE walks this.
const GZ_SPEC = {
  auto: { on: [false, 'bool'], light: ['Paper', 'name'], dark: ['Frost', 'name'] },
  look: {
    // Text, headings and code. Headings on auto follow the text; code on auto is left as Ultra has it.
    font: ['system', 'font'], head: ['auto', 'font-auto'], mono: ['auto', 'font-auto'],
    scale: [1, [0.85, 1.25]],
    leading: [1.5, [1.2, 2]],
    radius: [12, [0, 24]],
    density: ['cozy', ['compact', 'cozy', 'roomy']],
    glass: [12, [0, 24]],
    depth: [1, [0, 3]],
    tooltips: [true, 'bool'],
    hints: [true, 'bool'],
  },
  // colors: the three the gradient, aurora and scenes are painted with; none = the palette's.
  // scene: the three.js background drawn when kind is 'scene'; intensity is its one knob (dim and
  // blur are for the other kinds).
  bg: {
    kind: ['solid', ['solid', 'gradient', 'image', 'aurora', 'scene']], image: ['', 'url'], dim: [60, [0, 90]], blur: [0, [0, 20]],
    colors: [[], 'hexes'], grain: [true, 'bool'],
    // The gradient's shape: style, direction (degrees), blend (100 melts the colors together, 0 is
    // hard bands) and spread (how much of the screen the change of color covers, in %).
    style: ['linear', ['linear', 'radial', 'conic', 'mesh']], angle: [135, [0, 360]], blend: [100, [0, 100]], spread: [100, [20, 200]],
    scene: ['mist', ['mist', 'orbs', 'borealis', 'lava', 'waves', 'dust', 'contours', 'horizon']], intensity: [50, [0, 100]],
  },
  motion: {
    level: ['subtle', ['off', 'subtle', 'expressive']],
    followSystem: [true, 'bool'],
    enter: [true, 'bool'],
    hover: [true, 'bool'],
    transitions: [true, 'bool'],
  },
  enhance: {
    urgency: [false, 'bool'], clamp: [false, 'bool'], scores: [true, 'bool'], reading: [false, 'bool'],
    inline: [true, 'bool'], overall: [true, 'bool'], previews: [true, 'bool'], progress: [true, 'bool'], keys: [false, 'bool'],
    newgrades: [true, 'bool'], calc: [true, 'bool'], palette: [true, 'bool'], drafts: [true, 'bool'],
    download: [true, 'bool'],
    // darkDocs: file previews inverted (switched from the floating button too); toggles: the floating
    // document buttons themselves.
    darkDocs: [false, 'bool'], toggles: [true, 'bool'],
  },
  declutter: { help: [false, 'bool'], banner: [false, 'bool'], faculty: [false, 'bool'], tabs: [[], 'tabs'] },
};

const GZ_DEFAULTS = {
  version: 2,
  enabled: true,
  colors: Object.fromEntries(GZ_COLORS.map(([v, , d]) => [v, d])),
  preset: 'Frost',
  ...Object.fromEntries(Object.entries(GZ_SPEC).map(([g, keys]) => [g, Object.fromEntries(Object.entries(keys).map(([k, [d]]) => [k, d]))])),
  // tint: inside a course listed in `tinted` (color slots), its color tints the palette, `strength` %.
  courses: { harmonize: true, colors: {}, tint: false, tinted: [], strength: 60 },
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

// Ready-made background colors: [name, [three hex]]. Bright on purpose: dim mixes them toward the ground.
const GZ_BG_SETS = [
  ['Lagoon', ['#22d3ee', '#6366f1', '#34d399']],
  ['Dusk', ['#f472b6', '#a78bfa', '#fb923c']],
  ['Ember', ['#f97316', '#ef4444', '#facc15']],
  ['Mint', ['#5eead4', '#a3e635', '#38bdf8']],
  ['Lilac', ['#c084fc', '#f0abfc', '#818cf8']],
  ['Slate', ['#94a3b8', '#64748b', '#cbd5e1']],
];
// The background's three colors: the user's own (bg.colors), or the palette's accent, bright accent
// and muted text, a neutral from the same palette (its success green clashed with warm palettes).
const GZ_BG_COLORS = (own, colors) => (own.length ? own : [colors['--gz-accent'], colors['--gz-accent-hi'], colors['--gz-ink-muted']]);

// The gradient as a CSS image. Colors are var(--gz-bg-N), so palette changes flow through without
// rebuilding it; `space` is the interpolation space ('oklab' where supported: no muddy midpoints).
// Each color holds solid for (1 - blend) of its share, then melts into the next.
const GZ_GRADIENT = ({ style, angle, blend, spread }, space = '') => {
  const cols = ['var(--gz-bg-1)', 'var(--gz-bg-2)', 'var(--gz-bg-3)'];
  const pct = (v) => `${+(v * 100).toFixed(2)}%`;
  const stops = (list, start, len) => {
    const step = len / (list.length - 1);
    const hold = ((1 - blend / 100) * step) / 2;
    return list.map((c, i) => `${c} ${pct(Math.max(start, start + i * step - hold))} ${pct(Math.min(start + len, start + i * step + hold))}`).join(', ');
  };
  const sp = space ? ` in ${space}` : '';
  const s = spread / 100;
  // A point toward `deg` from the centre, `r` of the way to the edge (0 deg is the top).
  const at = (deg, r) => `${pct(0.5 + Math.sin((deg * Math.PI) / 180) * r)} ${pct(0.5 - Math.cos((deg * Math.PI) / 180) * r)}`;
  const linear = `linear-gradient(${angle}deg${sp}, ${stops(cols, 0.5 - s / 2, s)})`;
  if (style === 'radial') return `radial-gradient(circle farthest-corner at ${at(angle, 0.4)}${sp}, ${stops(cols, 0, s)})`;
  if (style === 'conic') return `conic-gradient(from ${angle}deg at 50% 50%${sp}, ${stops([...cols, cols[0]], 0, 1)})`;
  if (style === 'mesh') {
    // The linear sweep, with the end colors glowing in from the two sides across it.
    const glow = (c, deg) => `radial-gradient(circle at ${at(deg, 0.5)}${sp}, ${c} ${pct((1 - blend / 100) * 0.2 * s)}, transparent ${pct(0.6 * s)})`;
    return `${glow(cols[2], angle - 90)}, ${glow(cols[0], angle + 90)}, ${linear}`;
  }
  return linear;
};

// Intensity 0-100 → how far a scene's colors sit from the ground (as dim does for the other kinds),
// how much each scene lets itself show, and how fast it moves.
const GZ_SCENE_LOOK = (intensity) => {
  const t = intensity / 100;
  return { dim: 0.75 * (1 - t), amount: t, pace: 0.5 + t };
};

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
  if (rule === 'font' || rule === 'font-auto') {
    const f = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    return (rule === 'font-auto' && f === 'auto') || GZF.resolve(f) ? f : d;
  }
  if (rule === 'hexes') return Array.isArray(v) && v.length === 3 && v.every((c) => HEX.test(c)) ? v.map((c) => c.toLowerCase()) : [...d];
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
  out.courses = {
    harmonize: typeof rc.harmonize === 'boolean' ? rc.harmonize : true,
    colors: Object.fromEntries(cc.map(([id, c]) => [id, c.toLowerCase()])),
    tint: cleanValue(rc.tint, false, 'bool'),
    tinted: Array.isArray(rc.tinted) ? [...new Set(rc.tinted.filter((n) => typeof n === 'string' && COURSE_SLOT.test(n)))] : [],
    strength: cleanValue(rc.strength, 60, [10, 100]),
  };
  out.footer = typeof raw.footer === 'boolean' ? raw.footer : GZ_DEFAULTS.footer;
  out.presets = GZ_SANITIZE_PRESETS(raw.presets);
  // 1.0 stored no preset name: recover it from the palette, so the popup can mark it.
  out.preset = raw.preset === undefined || raw.preset === null
    ? GZ_MATCH_PRESET(out.colors, out.presets)
    : GZ_PRESET(cleanName(raw.preset), out.presets) ? cleanName(raw.preset) : GZ_MATCH_PRESET(out.colors, out.presets);
  return out;
};

// The palette to paint: the user's colors, or with auto on, the light/dark preset for the OS mode.
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

// ---- course tint ------------------------------------------------------------------------------
// Inside a course picked for it, the accent family takes the course's hue, and `t` (0-1) of the way
// from the palette's lightness and colorfulness to the course color's own: any strength reads as
// that course, and blending the hues instead would turn a pink accent and a green course gray. Bright
// and tint keep their place (bright toward the text, tint toward the ground); the surfaces lean a
// tenth of `t` toward the course. Contrast holds: a surface tint that costs text contrast the palette
// had is dropped, and the accent moves toward the text until it reads on the surface and its own
// text reads on it (in every preset, text on the accent is ground-like). A palette where that can't
// work gets black or white text on the accent, one of which always clears 4.5:1.
const GZ_TINT = (colors, course, t) => {
  const m = GZC.mix;
  const ink = colors['--gz-ink'];
  const lean = (v, to) => m(GZC.rehue(colors[v], course), to, t);
  const out = {
    ...colors,
    '--gz-accent': lean('--gz-accent', course),
    '--gz-accent-hi': lean('--gz-accent-hi', m(course, ink, 0.3)),
    '--gz-accent-soft': lean('--gz-accent-soft', m(course, colors['--gz-surface-2'], 0.8)),
    '--gz-surface': m(colors['--gz-surface'], course, t / 10),
    '--gz-surface-2': m(colors['--gz-surface-2'], course, t / 10),
  };
  const was = GZ_CONTRAST(colors);
  if (GZ_CONTRAST(out).some((r, i) => r.fg.startsWith('--gz-ink') && was[i].pass && !r.pass)) {
    out['--gz-surface'] = colors['--gz-surface'];
    out['--gz-surface-2'] = colors['--gz-surface-2'];
  }
  const reads = (fg, bg) => GZ_CONTRAST(out).find((r) => r.fg === fg && r.bg === bg).pass;
  const ok = () => reads('--gz-accent', '--gz-surface') && reads('--gz-accent-ink', '--gz-accent');
  for (let i = 0; i < 20 && !ok(); i++) out['--gz-accent'] = m(out['--gz-accent'], ink, 0.15);
  if (!ok()) out['--gz-accent-ink'] = GZC.contrast(out['--gz-accent'], '#000000') > GZC.contrast(out['--gz-accent'], '#ffffff') ? '#000000' : '#ffffff';
  return out;
};

if (typeof module !== 'undefined') {
  module.exports = { GZ_COLORS, GZ_TABS, GZ_SPEC, GZ_DEFAULTS, GZ_PALETTE, GZ_PRESETS, GZ_MAX_PRESETS, GZ_BG_SETS, GZ_BG_COLORS, GZ_GRADIENT, GZ_SCENE_LOOK, GZ_SANITIZE, GZ_SANITIZE_PRESETS, GZ_ALL_PRESETS, GZ_PRESET, GZ_MATCH_PRESET, GZ_ACTIVE_COLORS, GZ_CONTRAST, GZ_TINT };
}
