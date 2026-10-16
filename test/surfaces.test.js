const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const G = require('../defaults.js'), S = require('../lib/share.js');
test('old Looks retain role-specific opacity, no frost, palette colors and existing depth', () => {
  for (const look of G.GZ_LOOKS) {
    const settings = G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, look), vars = G.GZ_SURFACE_VARS(settings);
    assert.equal(vars['--gz-surface-opacity'], ''); assert.equal(vars['--gz-surface-color'], ''); assert.equal(vars['--gz-surface-grain'], 'none');
    assert.equal(vars['--gz-shadow-strength'], '35%'); assert.equal(vars['--gz-surface-border'], '100%');
    assert.equal(vars['--gz-glass-mix'], settings.look.glass ? '78%' : '100%');
  }
});
test('custom opacity never creates transparent glass without blur or over a solid page', () => {
  const settings = G.GZ_SANITIZE({ look: { glass: 12, surfaceOpacity: 25 }, bg: { kind: 'gradient' } });
  assert.equal(G.GZ_SURFACE_VARS(settings)['--gz-surface-opacity'], '25%');
  for (const s of [{ ...settings, look: { ...settings.look, glass: 0 } }, { ...settings, bg: { kind: 'solid' } }]) {
    assert.equal(G.GZ_SURFACE_VARS(s)['--gz-surface-opacity'], '100%'); assert.equal(G.GZ_SURFACE_VARS(s)['--gz-glass-mix'], '100%');
  }
});
test('surface colors and limits are sanitized before CSS or a saved Look can consume them', () => {
  const s = G.GZ_SANITIZE({ look: { surfaceColor: 'red);url(https://bad.test)', shadowColor: 'transparent', surfaceTint: 900, surfaceOpacity: NaN, surfaceFrost: {}, surfaceBorder: -2 } });
  for (const key of ['surfaceColor', 'shadowColor', 'surfaceTint', 'surfaceOpacity', 'surfaceFrost', 'surfaceBorder']) assert.equal(s.look[key], G.GZ_DEFAULTS.look[key]);
});
test('theme codes round-trip custom surfaces and restore surface defaults from old codes', async () => {
  const s = G.GZ_SANITIZE({ look: { surfaceCustom: true, surfaceColor: '#426298', surfaceOpacity: 85, surfaceFrost: 16, shadowCustom: true, shadowColor: '#223344', surfaceBorder: 42 } });
  const got = await S.decode(await S.encode(s));
  for (const key of Object.keys(G.GZ_SPEC.look).filter((k) => /^(surface|shadow)/.test(k))) assert.equal(got.look[key], s.look[key]);
  const plain = await S.decode(await S.encode(G.GZ_DEFAULTS));
  assert.equal(plain.look.surfaceCustom, false); assert.equal(plain.look.surfaceOpacity, -1);
});
test('catalogued content fills and radii use shared variables; no new row blur is introduced', () => {
  const files = ['theme.css', 'canvas.css', 'moodle.css', 'extras.css', 'features/apps.css', 'features/lookx.css', 'ui.css'];
  for (const file of files) {
    const css = fs.readFileSync(require.resolve(`../${file}`), 'utf8');
    for (const m of css.matchAll(/border-radius:([^;{}]+);/g)) if (/\b\d+(?:\.\d+)?px\b/.test(m[1]) && !/999px/.test(m[1])) assert.match(m[1], /--gz-(?:radius|card-radius)/, `${file}: ${m[0]}`);
    for (const m of css.matchAll(/(?:background|background-color):([^;{}]+);/g)) if (/var\(--gz-surface(?:-2)?\)/.test(m[1])) assert.match(m[1], /--gz-surface-(?:fill|paint)/, `${file}: ${m[0]}`);
  }
  assert.doesNotMatch(fs.readFileSync(require.resolve('../features/surfaces.css'), 'utf8'), /backdrop-filter\s*:/);
});
