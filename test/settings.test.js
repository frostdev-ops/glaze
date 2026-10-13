const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../defaults.js');

test('empty or garbage input yields the defaults', () => {
  for (const raw of [undefined, null, 42, 'x', []]) assert.deepEqual(G.GZ_SANITIZE(raw), G.GZ_DEFAULTS);
});

test('sanitize is idempotent', () => {
  const once = G.GZ_SANITIZE({ colors: { '--gz-accent': '#ABCDEF' }, look: { radius: 4 } });
  assert.deepEqual(G.GZ_SANITIZE(once), once);
});

test('1.0 data migrates: palette kept, motion level derived, preset recovered', () => {
  const midnight = G.GZ_PRESETS.find(([n]) => n === 'Midnight')[1];
  const v1 = { enabled: true, colors: midnight, motion: { enter: false, hover: false, transitions: false }, footer: false };
  const s = G.GZ_SANITIZE(v1);
  assert.equal(s.version, 2);
  assert.deepEqual(s.colors, midnight);
  assert.equal(s.motion.level, 'off');
  assert.equal(s.preset, 'Midnight');
  assert.equal(s.footer, false);
  assert.equal(G.GZ_SANITIZE({ motion: { enter: true, hover: false, transitions: false } }).motion.level, 'subtle');
});

test('edited 1.0 palette has no preset', () => {
  const s = G.GZ_SANITIZE({ colors: { ...G.GZ_DEFAULTS.colors, '--gz-accent': '#123456' } });
  assert.equal(s.preset, null);
  assert.equal(s.colors['--gz-accent'], '#123456');
});

test('hostile import is cleaned, not trusted', () => {
  const s = G.GZ_SANITIZE({
    version: 2,
    enabled: 'yes',
    colors: { '--gz-accent': 'red; background:url(x)', '--gz-evil': '#000000' },
    look: { radius: 999, font: 'comic', scale: '1.1', extra: 1 },
    bg: { kind: 'image', image: 'javascript:alert(1)' },
    motion: { level: 'max' },
    courses: { colors: { '3': '#ffffff', 'x") ; }': '#000000', '4': 'blue', '11': '#000000' } },
    presets: [{ name: 'Frost', colors: {} }, { name: ' Mine ', colors: { '--gz-ink': '#ffffff' } }, { name: '', colors: {} }, 'nope'],
    __proto__: { enabled: false },
  });
  assert.equal(s.enabled, true);
  assert.equal(s.colors['--gz-accent'], G.GZ_DEFAULTS.colors['--gz-accent']);
  assert.ok(!('--gz-evil' in s.colors));
  assert.deepEqual(s.look, G.GZ_DEFAULTS.look);
  assert.equal(s.bg.kind, 'image');
  assert.equal(s.bg.image, '');
  assert.equal(s.motion.level, 'subtle');
  assert.deepEqual(s.courses.colors, { '3': '#ffffff' });
  assert.deepEqual(s.presets.map((p) => p.name), ['Mine']);
  assert.equal(s.presets[0].colors['--gz-ink'], '#ffffff');
  assert.equal(s.presets[0].colors['--gz-accent'], G.GZ_DEFAULTS.colors['--gz-accent']);
});

test('https image URLs only, normalised so they are safe inside url("…")', () => {
  assert.equal(G.GZ_SANITIZE({ bg: { image: 'https://example.com/a.jpg' } }).bg.image, 'https://example.com/a.jpg');
  assert.equal(G.GZ_SANITIZE({ bg: { image: 'https://example.com/a"b\\c\n.jpg' } }).bg.image.includes('"'), false);
  for (const u of ['http://example.com/a.jpg', 'data:image/png;base64,AAAA', 'not a url']) assert.equal(G.GZ_SANITIZE({ bg: { image: u } }).bg.image, '', u);
});

test('custom presets are capped and deduplicated', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `P${i % 15}`, colors: {} }));
  const out = G.GZ_SANITIZE_PRESETS(many);
  assert.equal(out.length, G.GZ_MAX_PRESETS);
  assert.equal(new Set(out.map((p) => p.name)).size, out.length);
});

test('a stored preset name that no longer exists falls back to matching', () => {
  assert.equal(G.GZ_SANITIZE({ version: 2, preset: 'Deleted' }).preset, 'Frost');
});

test('auto light/dark picks the preset for the OS mode', () => {
  const s = G.GZ_SANITIZE({ auto: { on: true, light: 'Paper', dark: 'Forest' } });
  assert.deepEqual(G.GZ_ACTIVE_COLORS(s, true), G.GZ_PRESET('Forest'));
  assert.deepEqual(G.GZ_ACTIVE_COLORS(s, false), G.GZ_PRESET('Paper'));
  assert.deepEqual(G.GZ_ACTIVE_COLORS({ ...s, auto: { ...s.auto, on: false } }, true), s.colors);
});

test('every token has a value in every built-in preset', () => {
  for (const [name, colors] of G.GZ_PRESETS) for (const [v] of G.GZ_COLORS) assert.match(colors[v], /^#[0-9a-f]{6}$/, `${name} ${v}`);
});

test('every built-in preset clears its contrast pairs', () => {
  for (const [name, colors] of G.GZ_PRESETS) {
    for (const r of G.GZ_CONTRAST(colors)) assert.ok(r.pass, `${name}: ${r.label} ${r.ratio.toFixed(2)} < ${r.min}`);
  }
});

test('declutter tabs keep only known slugs, once each', () => {
  assert.deepEqual(G.GZ_SANITIZE({ declutter: { tabs: ['groups', 'groups', 'nope', 3, 'achievements'] } }).declutter.tabs, ['groups', 'achievements']);
  assert.deepEqual(G.GZ_SANITIZE({ declutter: { tabs: 'groups' } }).declutter.tabs, []);
  const a = G.GZ_SANITIZE({}); const b = G.GZ_SANITIZE({});
  a.declutter.tabs.push('groups');
  assert.deepEqual(b.declutter.tabs, [], 'defaults are not shared between results');
});

test('score bars, countdowns, folder previews, course progress and draft backup are on by default; the rest are off', () => {
  const on = Object.entries(G.GZ_DEFAULTS.enhance).filter(([, v]) => v).map(([k]) => k);
  assert.deepEqual(on.sort(), ['drafts', 'inline', 'previews', 'progress', 'scores']);
  assert.equal(G.GZ_SANITIZE({ enhance: { scores: false } }).enhance.scores, false, 'an explicit off is kept');
});

test('background colors: three hex or none; none follows the palette', () => {
  assert.deepEqual(G.GZ_SANITIZE({ bg: { colors: ['#AABBCC', '#000000', '#ffffff'] } }).bg.colors, ['#aabbcc', '#000000', '#ffffff']);
  for (const bad of [['#aabbcc'], ['#aabbcc', '#000000', 'red'], '#aabbcc', ['#aabbcc', '#000000', '#ffffff', '#111111']]) {
    assert.deepEqual(G.GZ_SANITIZE({ bg: { colors: bad } }).bg.colors, [], JSON.stringify(bad));
  }
  const frost = G.GZ_DEFAULTS.colors;
  assert.deepEqual(G.GZ_BG_COLORS([], frost), [frost['--gz-accent'], frost['--gz-accent-hi'], frost['--gz-ink-muted']]);
  assert.deepEqual(G.GZ_BG_COLORS(['#111111', '#222222', '#333333'], frost), ['#111111', '#222222', '#333333']);
  for (const [name, set] of G.GZ_BG_SETS) assert.deepEqual(G.GZ_SANITIZE({ bg: { colors: set } }).bg.colors, set, name);
});

test('animated scenes are a background kind, off by default', () => {
  assert.equal(G.GZ_DEFAULTS.bg.kind, 'solid');
  const s = G.GZ_SANITIZE({ bg: { kind: 'scene', scene: 'waves' } });
  assert.equal(s.bg.kind, 'scene');
  assert.equal(s.bg.scene, 'waves');
  assert.equal(G.GZ_SANITIZE({ bg: { scene: 'plasma' } }).bg.scene, 'mist');
  assert.equal(G.GZ_SANITIZE({ bg: { intensity: 140 } }).bg.intensity, 50);
});

test('every scene the settings allow is drawn by lib/scene.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../lib/scene.js'), 'utf8');
  const drawn = src.slice(src.indexOf('const SCENES = {')).match(/^ {2}(\w+):/gm).map((m) => m.trim().slice(0, -1));
  assert.deepEqual([...drawn].sort(), [...G.GZ_SPEC.bg.scene[1]].sort());
});

test('intensity runs from barely there to full strength', () => {
  const lo = G.GZ_SCENE_LOOK(0); const hi = G.GZ_SCENE_LOOK(100);
  assert.ok(lo.dim > hi.dim && lo.amount < hi.amount && lo.pace < hi.pace);
  assert.equal(hi.dim, 0);
  assert.ok(G.GZ_SCENE_LOOK(G.GZ_DEFAULTS.bg.intensity).dim < 0.6, 'the default stands out more than the old fixed dim of 60%');
});

test('gradient: blend sets how long each color holds, spread how much of the line the change covers', () => {
  const g = (o) => G.GZ_GRADIENT({ ...G.GZ_DEFAULTS.bg, ...o });
  assert.equal(g({ blend: 100 }), 'linear-gradient(135deg, var(--gz-bg-1) 0% 0%, var(--gz-bg-2) 50% 50%, var(--gz-bg-3) 100% 100%)');
  assert.equal(g({ blend: 0 }), 'linear-gradient(135deg, var(--gz-bg-1) 0% 25%, var(--gz-bg-2) 25% 75%, var(--gz-bg-3) 75% 100%)');
  assert.match(g({ spread: 50 }), /var\(--gz-bg-1\) 25% 25%.*var\(--gz-bg-3\) 75% 75%/);
  assert.match(g({ style: 'conic' }), /^conic-gradient\(from 135deg .*var\(--gz-bg-1\) 100% 100%\)$/, 'conic comes back round to the first color');
  assert.equal(g({ style: 'mesh' }).split('-gradient(').length - 1, 3, 'mesh: two glows over the sweep');
  assert.match(G.GZ_GRADIENT(G.GZ_DEFAULTS.bg, 'oklab'), /^linear-gradient\(135deg in oklab, /);
});
