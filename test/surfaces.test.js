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
  const files = ['sharing/sessions.css', 'options.html', 'popup.html', 'theme.css', 'canvas.css', 'moodle.css', 'extras.css', 'features/apps.css', 'features/lookx.css', 'ui.css'];
  for (const file of files) {
    const source = fs.readFileSync(require.resolve(`../${file}`), 'utf8');
    const css = file.endsWith('.html') ? [...source.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : source;
    for (const m of css.matchAll(/border-radius:([^;{}]+);/g)) if (/\b\d+(?:\.\d+)?px\b/.test(m[1]) && !/999px/.test(m[1])) assert.match(m[1], /--gz-(?:radius|card-radius)/, `${file}: ${m[0]}`);
    for (const m of css.matchAll(/(?:background|background-color):([^;{}]+);/g)) if (/var\(--gz-surface(?:-2)?(?:\)|,)/.test(m[1])) assert.match(m[1], /--gz-surface-(?:fill|paint)/, `${file}: ${m[0]}`);
  }
  assert.doesNotMatch(fs.readFileSync(require.resolve('../features/surfaces.css'), 'utf8'), /backdrop-filter\s*:/);
});

test('every extension HTML entry loads the shared surface schema before defaults', () => {
  for (const file of ['options.html', 'popup.html', 'preview.html', 'sharing/sessions.html']) {
    const html = fs.readFileSync(require.resolve(`../${file}`), 'utf8');
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    const defaults = scripts.findIndex((s) => s.endsWith('defaults.js'));
    const surfaces = scripts.findIndex((s) => s.endsWith('lib/surfaces.js'));
    assert.ok(surfaces >= 0 && surfaces < defaults, `${file}: defaults requires surfaces`);
    if (scripts.includes('ui.js')) assert.match(html, /href="features\/surfaces\.css"/, `${file}: UI surface variables need the derived fill sheet`);
  }
});

test('the editor and popup keep a solid readable ground and apply global depth', () => {
  const vm = require('node:vm'), style = {}, attrs = {};
  const UI = vm.runInNewContext(fs.readFileSync(require.resolve('../ui.js'), 'utf8') + ';GZ_UI', {
    ...G, GZ_COLOR: require('../lib/color.js'), chrome: { storage: { sync: {} } }, matchMedia: () => ({ matches: false }),
    document: { documentElement: { style: { setProperty: (k, v) => { style[k] = v; } }, setAttribute: (k, v) => { attrs[k] = v; } } },
  });
  UI.paint(G.GZ_SANITIZE({ bg: { kind: 'scene' }, look: { surfaceOpacity: 20, depth: 0, glass: 3 } }));
  assert.equal(style['--gz-surface-opacity'], '100%');
  assert.equal(style['--gz-glass'], '3px');
  assert.equal(attrs['data-gz-depth'], '0');
  assert.equal(attrs['data-gz-motion'], 'subtle');
});

test('Sessions surface reads preserve role defaults, reject stale answers, and fail closed', async () => {
  const vm = require('node:vm'), source = fs.readFileSync(require.resolve('../sharing/sessions.js'), 'utf8');
  const code = source.slice(source.indexOf('  const LOOK_KEYS'), source.indexOf('  const say'));
  const style = {}, attrs = {}, reads = [], sync = { get: () => new Promise((resolve) => reads.push(resolve)) };
  const api = vm.runInNewContext(`let dead = false; ${code}; ({paintLook, stop: () => { dead = true; }})`, {
    ...G, GZ_SURFACES: require('../lib/surfaces.js'), Date, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'glaze' }, storage: { sync, onChanged: { addListener() {} } } }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { documentElement: { style: { setProperty: (k, v) => { style[k] = v; }, removeProperty: (k) => { delete style[k]; } }, setAttribute: (k, v) => { attrs[k] = v; } } },
  });
  const latest = api.paintLook(); reads[1]({ look: { radius: 4, depth: 2, surfaceCustom: true, surfaceColor: '#334455', surfaceBorder: 0 } }); await latest;
  reads[0]({ look: { radius: 24 } }); await new Promise(setImmediate);
  assert.equal(style['--gz-radius'], '4px'); assert.equal(style['--gz-surface-color'], '#334455');
  assert.equal(style['--gz-surface-border'], '0%'); assert.equal(attrs['data-gz-depth'], '2');
  assert.equal(style['--gz-surface'], undefined, 'the original standalone role palette remains the fallback');
  sync.get = async () => { throw Error('failed'); }; await api.paintLook(); assert.equal(style['--gz-radius'], '4px');
  sync.get = async () => ({ look: { radius: 0 } }); api.stop(); await api.paintLook(); assert.equal(style['--gz-radius'], '4px');
});

test('Sessions permits the local frost texture without allowing network connections', () => {
  const html = fs.readFileSync(require.resolve('../sharing/sessions.html'), 'utf8');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /(?:^|; )img-src 'self' data:(?:;|$)/);
  assert.match(csp, /(?:^|; )connect-src 'none'(?:;|$)/);
  assert.doesNotMatch(csp, /https?:|\*/);
});

test('Moodle cards layer local frost over the shared panel fill', () => {
  const css = fs.readFileSync(require.resolve('../moodle.css'), 'utf8');
  const card = css.match(/html \.card \{([^}]+)\}/)[1];
  assert.match(card, /background: var\(--gz-surface-grain, none\), var\(--gz-panel\)/);
});

test('course surface colors use only known valid records, with picks winning independently of palette tint', () => {
  const key = 'canvas:https://school.instructure.com/12';
  const s = G.GZ_SANITIZE({ courses: { colors: { [key]: '#112233' }, tint: false } });
  const list = { [key]: { color: '#445566' } };
  assert.equal(G.GZ_COURSE_COLOR(s, list, key), '#112233');
  s.courses.colors[key] = 'url(https://invalid.test)';
  assert.equal(G.GZ_COURSE_COLOR(s, list, key), '#445566');
  list[key].color = 'currentColor';
  assert.equal(G.GZ_COURSE_COLOR(s, list, key), '');
  assert.equal(G.GZ_COURSE_COLOR(s, list, null), '');
  const vm = require('node:vm'), source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const line = source.match(/^  const surfaceCourse = .*;$/m)[0];
  for (const site of ['ultra', 'canvas', 'moodle']) {
    const c = vm.createContext({ chrome: { runtime: { id: 'glaze' } }, GZ_COURSE_COLOR: G.GZ_COURSE_COLOR, settings: s, courseList: list, ultra: site === 'ultra', courseId: () => key, canvasCourseKey: () => key });
    const get = vm.runInContext(`${line}\nsurfaceCourse`, c);
    list[key].color = '#445566'; assert.equal(get(), '#445566', site);
    c.canvasCourseKey = c.courseId = () => null; assert.equal(get(), '', `${site}: navigation clears the old course`);
    c.canvasCourseKey = c.courseId = () => key; delete c.chrome.runtime.id; assert.equal(get(), '', `${site}: invalidated context clears`);
  }
});
