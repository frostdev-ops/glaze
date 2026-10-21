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
    look: { radius: 999, font: 'comic"; } body { x', head: 'url(x)', scale: '1.1', extra: 1 },
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
  // The parser keeps a quote in the host and a backslash in the query or fragment: either would end or escape url("…").
  for (const u of ['https://a"b.example/x.jpg', 'https://a%22b.example/x.jpg', 'https://example.com/a.jpg?x\\', 'https://example.com/a.jpg#x\\']) assert.equal(G.GZ_SANITIZE({ bg: { image: u } }).bg.image, '', u);
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

test('score bars, countdowns, folder previews, course progress, card grades, draft backup, download all, remembering your place, the course menu, the document buttons, the document viewer\'s palette, search in your courses, Better To Do, the Ultra Dashboard, the widgets (with none added), the sidebar, hiding folders and course tabs are on by default; the rest are off', () => {
  const on = Object.entries(G.GZ_DEFAULTS.enhance).filter(([, v]) => v === true).map(([k]) => k);
  assert.deepEqual(on.sort(), ['calc', 'coursemenu', 'dashboard', 'docTheme', 'download', 'drafts', 'hideFolders', 'inline', 'newcontent', 'newgrades', 'overall', 'palette', 'place', 'previews', 'progress', 'scores', 'search', 'sidebar', 'tabs', 'todo', 'toggles', 'widgets']);
  assert.equal(G.GZ_DEFAULTS.enhance.docPages, 'plain');
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

test('a drawn background\'s CSS fallback is dimmed like a quiet gradient, whatever the intensity', () => {
  // The scene Looks dim their colours by a third or less, but the fallback (the bright gradient, before the scene draws
  // or without WebGL) is what the page's text sits on then.
  for (const L of G.GZ_LOOKS.filter((l) => l.bg.kind === 'scene')) assert.ok(G.GZ_SCENE_LOOK(L.bg.intensity ?? G.GZ_DEFAULTS.bg.intensity).dim < 0.75, L.name);
  const fs = require('node:fs');
  const css = fs.readFileSync(require.resolve('../extras.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const base = css.indexOf('html[data-gz-bg]:not([data-gz-bg="solid"]) {');
  const m = css.match(/html\[data-gz-bg\]:is\(([^)]*)\) \{\s*--gz-bg-tint: color-mix\(in srgb, var\(--gz-surface-2\) max\(var\(--gz-bg-dim, 60%\), 75%\), transparent\);\s*\}/);
  assert.ok(m && base >= 0 && m.index > base, 'after the layer\'s own tint, at its specificity, so it wins');
  // The kinds content.js gives the scene's dim to are the ones floored here.
  const kinds = [...fs.readFileSync(require.resolve('../content.js'), 'utf8').match(/const look = \(([^)]*)\) && GZ_SCENE_LOOK/)[1].matchAll(/'(\w+)'/g)].map((k) => k[1]);
  assert.deepEqual([...m[1].matchAll(/\[data-gz-bg="(\w+)"\]/g)].map((k) => k[1]).sort(), kinds.sort());
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

test('theme codes round-trip palette, look and background, and nothing else', async () => {
  const S = require('../lib/share.js');
  const s = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Midnight'), look: { font: 'Comic Neue', radius: 4, tooltips: false }, bg: { kind: 'image', image: 'https://example.com/a.jpg', dim: 30 }, enhance: { keys: true } });
  const code = await S.encode(s);
  assert.match(code, /^glaze1:[\w-]+$/);
  assert.ok(code.length < 450, `short enough to paste anywhere (${code.length})`);
  const got = await S.decode(` ${code.slice(0, 40)}\n${code.slice(40)} `);
  assert.deepEqual(got.colors, s.colors);
  assert.equal(got.look.font, 'Comic Neue');
  assert.equal(got.look.radius, 4);
  assert.ok(!('tooltips' in got.look), 'behaviour settings are not part of a theme');
  assert.deepEqual(got.bg, s.bg);
  // A picture tried and set aside stays stored, and may be private: a Look that doesn't show it leaves it out.
  const aside = 'https://photos.example.com/u/me/IMG_1.jpg?token=x';
  const other = await S.decode(await S.encode(G.GZ_SANITIZE({ bg: { kind: 'gradient', image: aside }, nav: { k: 'solid', u: aside } })));
  assert.deepEqual([other.bg.kind, 'image' in other.bg, other.nav.k, 'u' in other.nav], ['gradient', false, 'solid', false]);
});

test('theme codes are untrusted: anything off refuses the whole code', async () => {
  const S = require('../lib/share.js');
  const make = async (obj) => {
    const z = await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return `glaze1:${Buffer.from(z).toString('base64url')}`;
  };
  const c = G.GZ_COLORS.map(([, , d]) => d.slice(1)).join('');
  await S.decode(await make({ c, l: { radius: 3 }, b: { kind: 'aurora' } }));
  for (const [why, obj] of [
    ['javascript url', { c, b: { kind: 'image', image: 'javascript:alert(1)' } }],
    ['http url', { c, b: { image: 'http://example.com/a.jpg' } }],
    ['css in a font name', { c, l: { font: 'x"; } body { y' } }],
    ['out of range', { c, l: { radius: 99 } }],
    ['unknown setting', { c, l: { tooltips: false } }],
    ['unknown group', { c, enhance: { keys: true } }],
    ['short palette', { c: c.slice(6) }],
    ['look not an object', { c, l: [{ scale: 99 }] }],
    ['look a string', { c, l: 'drop-me' }],
    ['background an array', { c, b: [{ image: 'http://invalid.example/a' }] }],
    ['background null', { c, b: null }],
  ]) await assert.rejects(S.decode(await make(obj)), Error, why);
  for (const bad of ['', 'hello', 'glaze1:!!!', 'glaze1:AAAA', `glaze1:${'A'.repeat(5000)}`]) await assert.rejects(S.decode(bad), Error, bad.slice(0, 20));
  // A tiny code that inflates past the cap.
  await assert.rejects(S.decode(await make({ c, l: { font: 'x'.repeat(50000) } })), /damaged/);
});

test('course tint is off and empty until configured; junk is dropped', () => {
  assert.deepEqual(G.GZ_DEFAULTS.courses, { harmonize: true, colors: {}, tint: false, tinted: [], strength: 60, looks: {}, names: {} });
  const c = G.GZ_SANITIZE({ courses: { tint: 'yes', tinted: ['2', '2', '11', 3, 'x', '10', '_53708_1', '_x_1', '_53708_1'], strength: 500 } }).courses;
  assert.deepEqual([c.tint, c.tinted, c.strength], [false, ['2', '10', '_53708_1'], 60]);
});

test('course tint never costs a contrast pair, and at full strength is the course color where that reads', () => {
  const C = require('../lib/color.js');
  // Ultra's ten slot colors, plus black and white: the extremes a picked course color can be.
  const courses = ['#c473d4', '#2fd9fc', '#ffe12b', '#ff6417', '#89f3db', '#fe5b91', '#85f472', '#22c7cc', '#ca22ad', '#157afb', '#000000', '#ffffff'];
  for (const [name, colors] of G.GZ_PRESETS) {
    for (const course of courses) {
      for (const t of [0.1, 0.6, 1]) {
        const out = G.GZ_TINT(colors, course, t);
        for (const r of G.GZ_CONTRAST(out)) assert.ok(r.pass, `${name} ${course} ${t}: ${r.label} ${r.ratio.toFixed(2)}`);
        assert.equal(out['--gz-ink'], colors['--gz-ink']);
      }
      const full = G.GZ_TINT(colors, course, 1);
      const reads = C.contrast(course, full['--gz-surface']) >= 3 && C.contrast(colors['--gz-accent-ink'], course) >= 4.5;
      if (reads) assert.equal(full['--gz-accent'], course, `${name} ${course}`);
      else assert.notEqual(full['--gz-accent'], course, `${name} ${course}`);
    }
  }
});

test('looks apply cleanly: every value is one Glaze accepts, contrast holds, and the look reads as on', () => {
  assert.equal(G.GZ_LOOKS.length, 10);
  const mine = G.GZ_SANITIZE({ look: { tooltips: false, scale: 1.2, font: 'mono' }, bg: { image: 'https://example.com/a.jpg', kind: 'image' }, auto: { on: true } });
  for (const L of G.GZ_LOOKS) {
    const s = { ...mine, ...G.GZ_LOOK_APPLY(mine, L) };
    assert.deepEqual(G.GZ_SANITIZE(s), s, `${L.name} survives GZ_SANITIZE unchanged`);
    for (const r of G.GZ_CONTRAST(s.colors)) assert.ok(r.pass, `${L.name}: ${r.label} ${r.ratio.toFixed(2)}`);
    assert.ok(G.GZ_LOOK_ON(s, L), `${L.name} reads as on`);
    assert.ok(!s.auto.on, 'picking a look turns auto light/dark off');
    assert.equal(s.look.tooltips, false, 'tooltips stay the user\'s');
    assert.equal(s.bg.image, 'https://example.com/a.jpg', 'the image address stays the user\'s');
    if (!('scale' in L.look)) assert.equal(s.look.scale, G.GZ_DEFAULTS.look.scale, `${L.name} resets what it doesn't name`);
    for (const O of G.GZ_LOOKS) if (O !== L) assert.ok(!G.GZ_LOOK_ON(s, O), `${L.name} isn't also ${O.name}`);
  }
});

test('courses come from the membership list, each in its own color slot', () => {
  const m = (courseId, name, courseCardColorIndex, extra) => ({ courseId, courseCardColorIndex, course: { name }, ...extra });
  assert.deepEqual(G.GZ_COURSES([
    m('_1_1', 'SPAN1100', 2), m('_2_1', 'CS2010', 1), m('_3_1', 'Tutoring', 2326), m('_4_1', 'Orientation', 2508),
    m('_5_1', 'Hidden', 3, { userHasHidden: true }), m('_6_1', 'No index'),
  ].map((x, i) => (i === 2 ? { ...x, course: { ...x.course, isOrganization: true } } : x))), {
    _1_1: { name: 'SPAN1100', slot: '3', org: false }, _2_1: { name: 'CS2010', slot: '2', org: false },
    _3_1: { name: 'Tutoring', slot: '7', org: true }, _4_1: { name: 'Orientation', slot: '9', org: false },
  });
  assert.deepEqual(G.GZ_COURSES(undefined), {});
});

test('every course gets its own color, and a slot keeps its color for its newest course', () => {
  const C = (slot, org = false) => ({ name: 'x', slot, org });
  // Three courses in slot 3, a course and an organization in slot 2: one of each slot keeps Ultra's.
  const courses = { _9_1: C('3'), _10_1: C('3'), _11_1: C('3'), _1_1: C('2'), _2_1: C('2', true) };
  const r = G.GZ_COURSE_COLORS(courses);
  assert.equal(r._11_1.color, G.GZ_SLOT_COLORS[3]);
  assert.equal(r._1_1.color, G.GZ_SLOT_COLORS[2]);
  assert.ok(r._11_1.own && r._1_1.own && !r._10_1.own && !r._2_1.own);
  assert.equal(new Set(Object.values(r).map((c) => c.color)).size, 5);
  // Past Ultra's ten, every course still has a color of its own.
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`_${i + 1}_1`, C(String(i % 10 + 1))]));
  assert.equal(new Set(Object.values(G.GZ_COURSE_COLORS(many)).map((c) => c.color)).size, 30);
  // A pick by id wins; one by slot (from before 2.1.3) is the slot's own course's.
  const p = G.GZ_COURSE_COLORS(courses, { _10_1: '#123456', 3: '#abcdef' });
  assert.deepEqual([p._10_1, p._11_1.color, p._9_1.picked], [{ color: '#123456', picked: true, own: false }, '#abcdef', false]);
  assert.deepEqual(G.GZ_COURSE_VARS(p._11_1), {});
  assert.deepEqual(G.GZ_COURSE_VARS(p._10_1), { '--gz-pick': '#123456' });
  assert.deepEqual(G.GZ_COURSE_VARS(r._2_1), { '--gz-pick': 'initial', '--gz-course-raw': r._2_1.color });
  const s = G.GZ_SANITIZE({ courses: { colors: { 3: '#ABCDEF', _10_1: '#123456', _x: '#000000', 11: '#000000' } } }).courses;
  assert.deepEqual(s.colors, { 3: '#abcdef', _10_1: '#123456' });
});

test('nicknames: by course id, one trimmed line of at most 60 characters, strings only', () => {
  const long = 'é'.repeat(70);
  const n = G.GZ_SANITIZE({ courses: { names: {
    _1_1: '  Bio  ', _2_1: 'Two\n  lines\t here', _3_1: long, _4_1: '   ', _5_1: 7, _6_1: null, '3': 'slot', x: 'junk', _7_1: ['a'], _8_1: '😀'.repeat(61),
  } } }).courses.names;
  assert.deepEqual(Object.keys(n), ['_1_1', '_2_1', '_3_1', '_8_1']);
  assert.deepEqual([n._1_1, n._2_1, [...n._3_1].length, [...n._8_1].length], ['Bio', 'Two lines here', 60, 60]);
  assert.deepEqual(G.GZ_SANITIZE({ courses: { names: 'Bio' } }).courses.names, {});
  assert.deepEqual(G.GZ_SANITIZE({}).courses.names, {}, 'none until given');
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`_${i}_1`, `${i}`]));
  assert.equal(Object.keys(G.GZ_SANITIZE({ courses: { names: many } }).courses.names).length, 200, 'capped like the other per-course maps');
  // They share the courses sync item (8 KB): long ones stop at a byte budget, with room left for the rest.
  const big = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`_${i}_1`, '😀'.repeat(60)]));
  const all = G.GZ_SANITIZE({ courses: { names: big, colors: Object.fromEntries(Object.keys(big).slice(0, 60).map((id) => [id, '#abcdef'])) } }).courses;
  assert.ok(Object.keys(all.names).length >= 10, 'some are kept');
  assert.ok(new TextEncoder().encode(JSON.stringify(all)).length + 'courses'.length < 8192, 'the item fits sync storage');
});

test('nicknames: the budget is the whole courses item, colors, ticks and looks included', () => {
  const bytes = (c) => new TextEncoder().encode('courses' + JSON.stringify(c)).length;
  const ids = Array.from({ length: 90 }, (_, i) => `_${1000000 + i}_1`);
  const raw = { courses: {
    colors: Object.fromEntries(ids.map((id) => [id, '#abcdef'])), tint: true, tinted: ids, looks: Object.fromEntries(ids.map((id) => [id, 'Aurora Night'])),
    names: Object.fromEntries(ids.map((id) => [id, 'é'.repeat(60)])),
  } };
  const c = G.GZ_SANITIZE(raw).courses;
  assert.equal(Object.keys(c.looks).length, 90, 'the looks are all kept');
  const n = Object.keys(c.names).length;
  assert.ok(n > 0 && n < 90, `some nicknames are kept (${n})`);
  assert.ok(bytes(c) <= 8192, `the item fits sync storage (${bytes(c)} bytes)`);
  // Exactly as many as fit: one more would not.
  const more = { ...c, names: { ...c.names, [ids[n]]: 'é'.repeat(60) } };
  assert.ok(bytes(more) > 8192, 'one more would not fit');
  assert.equal(G.GZ_SYNC_BYTES('courses', c), bytes(c));
  // Without the rest, the nicknames get its room.
  assert.equal(Object.keys(G.GZ_SANITIZE({ courses: { names: raw.courses.names } }).courses.names).length, 59);
  // What fits is kept as it is: sanitizing again changes nothing.
  assert.deepEqual(G.GZ_SANITIZE({ courses: c }).courses, c);
});

test('dark documents, a switch up to 2.2, become inverted documents; a choice made since is kept', () => {
  const pages = (enhance) => G.GZ_SANITIZE({ enhance }).enhance.docPages;
  assert.equal(pages({ darkDocs: true }), 'dark');
  assert.equal(pages({ darkDocs: false }), 'plain');
  assert.equal(pages({ darkDocs: true, docPages: 'dim' }), 'dim');
  assert.equal(pages({ darkDocs: true, docPages: 'plain' }), 'plain');
  assert.equal(pages({ docPages: 'sepia' }), 'plain');
  assert.ok(!('darkDocs' in G.GZ_SANITIZE({ enhance: { darkDocs: true } }).enhance));
});
