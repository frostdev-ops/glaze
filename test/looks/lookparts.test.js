// Look parts (lib/lookparts.js): the cleaners for `x` and `m`, the shader stripper, packing, storage in sync or local, and
// glaze2 theme codes (lib/share.js). Untrusted input: every refusal here is a code from a stranger that must not get in.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const X = require('../lib/lookparts.js');
const MX = require('../lib/motionx.js');
const S = require('../lib/share.js');
const G = require('../defaults.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const SHADER = 'float ring(vec2 p) {\n  return smoothstep(0.3, 0.29, length(p - 0.5));\n}\nvec4 scene(vec2 uv) {\n  return vec4(uC1, ring(uv));\n}';
const FULL = {
  bg: {
    shader: { src: SHADER },
    layers: [
      { k: 'scene', name: 'mist', amount: 80, speed: 50, blend: 'screen', c: ['accent', '#112233'] },
      { k: 'noise', scale: 30, amount: 40, speed: 100, blend: 'add' },
      { k: 'gradient', style: 'conic', angle: 90, amount: 60, blend: 'multiply', c: ['accent', 'ink', '#ffffff', 'surface'] },
      { k: 'particles', count: 120, shape: 'star', size: 8, speed: 80, drift: 270, twinkle: 40, amount: 70, blend: 'add', c: ['accent-hi'] },
    ],
    media: { type: 'video', src: 'https://cdn.example.com/loop.webm', fit: 'contain', dim: 30, loop: false },
  },
  anim: {
    'card.enter': { s: [{ at: 0, y: 12, o: 0 }, { at: 1, y: 0, o: 1 }], ms: 420, ease: [0.2, 0.8, 0.2, 1], delay: 40, stagger: 30 },
    'button.press': { s: [{ at: 0, sc: 1 }, { at: 0.5, sc: 0.95 }, { at: 1, sc: 1 }], ms: 160, ease: 'ease-out' },
  },
  fx: { complete: { kind: 'confetti', count: 40, shapes: ['star', 'heart'], c: ['accent', '#ff00aa'], spread: 120, gravity: 0.8, life: 1500, size: 12 }, 'timer.done': { kind: 'ring' } },
  cursor: { kind: 'sparkle', c: ['accent'], size: 14, len: 8, fade: 500 },
  nav: { place: 'dock', links: [{ id: 'abcdefghij12', n: 'Library', u: 'https://library.example.edu/', i: 'book' }], hidden: ['tools'], groups: [{ label: 'Study', items: ['grades', 'link:abcdefghij12', 'w:clock'] }], icons: { grades: 'star' } },
  rules: [
    { p: 'ultra.course-card.title', do: 'style', st: { fg: 'accent', bw: 2 } },
    { p: 'canvas.dashboard-card', do: 'hide' },
    { p: 'moodle.navbar', do: 'label', t: 'Home' },
    { p: 'ultra.course-card', do: 'move', to: 'ultra.course-list', at: 'after' },
  ],
};
const MODS = [{ id: 'abcdefghijklmnop', h: 'A'.repeat(43), name: 'GPA Garden' }];

test('a full set of parts cleans to itself, and cleaning twice changes nothing', () => {
  const once = X.clean(clone(FULL));
  assert.ok(once);
  assert.ok(X.same(once, FULL));
  assert.deepEqual(X.clean(clone(once)), once);
  for (const part of Object.keys(FULL)) assert.ok(X.same(X.clean({ [part]: FULL[part] })?.[part], FULL[part]), part);
  assert.ok(X.same(X.mods(clone(MODS)), MODS));
  assert.ok(X.same(X.bundle({ x: FULL, m: MODS }), { x: FULL, m: MODS }));
});

test('numbers are clamped and rounded, text is one line, colours are tokens or lowercase hex', () => {
  const x = X.clean({
    anim: { 'page.enter': { s: [{ at: 2, x: -999, sc: 0.123456, o: 0.00004 }, { at: -1, hu: 500 }], ms: 99999.7, delay: -4, stagger: 1e9 } },
    cursor: { kind: 'glow', c: ['#ABCDEF'], size: 0, len: 99.4, fade: 5 },
    fx: { grade: { kind: 'burst', count: 500.6, spread: -5, gravity: 9, life: 1, size: 1000 } },
    nav: { groups: [{ label: '  Two\n lines\u0007 ', items: ['grades'] }] },
  });
  assert.deepEqual(x.anim['page.enter'].s, [{ at: 0, hu: 180 }, { at: 1, x: -200, sc: 0.5, o: 0 }], 'clamped, rounded, sorted by at');
  assert.deepEqual([x.anim['page.enter'].ms, x.anim['page.enter'].delay, x.anim['page.enter'].stagger], [2000, 0, 200]);
  assert.deepEqual(x.cursor, { kind: 'glow', c: ['#abcdef'], size: 2, len: 24, fade: 100 });
  assert.deepEqual(x.fx.grade, { kind: 'burst', count: 60, spread: 0, gravity: 2, life: 200, size: 48 });
  assert.equal(x.nav.groups[0].label, 'Two lines');
  assert.equal(X.mods([{ ...MODS[0], name: ' a\u202eb\u200fc\u0000 ' }])[0].name, 'abc', 'control and direction characters are taken out of text');
  assert.equal(X.clean({ rules: [{ p: 'moodle.navbar', do: 'label', t: 'a\u202eb\nc' }] }).rules[0].t, 'ab c');
  assert.ok(!Object.is(X.clean({ anim: { 'page.enter': { s: [{ at: 0, x: -0.0001 }, { at: 1 }] } } }).anim['page.enter'].s[0].x, -0), 'no negative zero');
});

test('what is not a part is refused whole: unknown keys, wrong types, lists over their limit, empty parts', () => {
  const stops = (n) => Array.from({ length: n }, (_, i) => ({ at: i / 10 }));
  const items = (n) => Array.from({ length: n }, (_, i) => `item${i}`);
  const bad = {
    'not an object': 'x', array: [FULL], null: null, 'nothing in it': {},
    'unknown part': { sound: {} },
    'bg.media without a source': { bg: { media: { type: 'video' } } },
    'empty bg': { bg: {} },
    'bg unknown key': { bg: { shader: { src: SHADER }, canvas: 1 } },
    'shader unknown key': { bg: { shader: { src: SHADER, entry: 'main' } } },
    'shader not text': { bg: { shader: { src: 5 } } },
    'shader empty': { bg: { shader: { src: '  \n ' } } },
    'shader not ASCII': { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(0.); } // é' } } },
    'shader over 8 KiB': { bg: { shader: { src: 'a'.repeat(8193) } } },
    'five layers': { bg: { layers: Array.from({ length: 5 }, () => ({ k: 'noise' })) } },
    'no layers': { bg: { layers: [] } },
    'unknown layer': { bg: { layers: [{ k: 'video' }] } },
    'layer without k': { bg: { layers: [{ name: 'mist' }] } },
    'scene without a name': { bg: { layers: [{ k: 'scene' }] } },
    'scene not built in': { bg: { layers: [{ k: 'scene', name: 'plasma' }] } },
    'gradient with one colour': { bg: { layers: [{ k: 'gradient', c: ['accent'] }] } },
    'gradient with five colours': { bg: { layers: [{ k: 'gradient', c: ['accent', 'ink', 'line', 'ok', 'err'] }] } },
    'gradient style mesh': { bg: { layers: [{ k: 'gradient', style: 'mesh', c: ['accent', 'ink'] }] } },
    'layer key of another kind': { bg: { layers: [{ k: 'noise', count: 5 }] } },
    'layer blend': { bg: { layers: [{ k: 'noise', blend: 'overlay' }] } },
    'four colours on noise': { bg: { layers: [{ k: 'noise', c: ['accent', 'ink', 'line', 'ok'] }] } },
    'colour that is not one': { cursor: { kind: 'trail', c: ['red'] } },
    'colour with alpha': { cursor: { kind: 'trail', c: ['#aabbccdd'] } },
    'number as text': { cursor: { kind: 'trail', size: '12' } },
    'NaN': { cursor: { kind: 'trail', size: NaN } },
    'Infinity': { cursor: { kind: 'trail', size: Infinity } },
    'cursor kind': { cursor: { kind: 'laser' } },
    'cursor without kind': { cursor: { size: 12 } },
    'one stop': { anim: { 'card.enter': { s: stops(1) } } },
    'nine stops': { anim: { 'card.enter': { s: stops(9) } } },
    'stop without at': { anim: { 'card.enter': { s: [{ o: 0 }, { at: 1 }] } } },
    'stop unknown key': { anim: { 'card.enter': { s: [{ at: 0, z: 1 }, { at: 1 }] } } },
    'unknown moment': { anim: { 'page.exit': { s: stops(2) } } },
    'ease name': { anim: { 'card.enter': { s: stops(2), ease: 'bounce' } } },
    'ease with three numbers': { anim: { 'card.enter': { s: stops(2), ease: [0, 0, 1] } } },
    'ease with text': { anim: { 'card.enter': { s: stops(2), ease: [0, 0, 1, 'x'] } } },
    'unknown event': { fx: { click: { kind: 'burst' } } },
    'effect kind': { fx: { complete: { kind: 'explosion' } } },
    'five shapes': { fx: { complete: { kind: 'burst', shapes: ['dot', 'star', 'snow', 'heart', 'leaf'] } } },
    'no shapes': { fx: { complete: { kind: 'burst', shapes: [] } } },
    'unknown shape': { fx: { complete: { kind: 'burst', shapes: ['skull'] } } },
    'seven effect colours': { fx: { complete: { kind: 'burst', c: Array(7).fill('accent') } } },
    'nav place': { nav: { place: 'right' } },
    'nav unknown key': { nav: { place: 'top', style: 'x' } },
    'nav empty': { nav: {} },
    'nav link unknown key': { nav: { links: [{ id: 'abcdefghij12', n: 'x', u: 'https://example.com/', i: 'link', tab: true }] } },
    'rules empty': { rules: [] },
    'sixty-five rules': { rules: Array.from({ length: 65 }, () => ({ p: 'canvas.dashboard-card', do: 'hide' })) },
    'rule action': { rules: [{ p: 'canvas.dashboard-card', do: 'delete' }] },
    'rule with a selector': { rules: [{ p: '.card > a', do: 'hide' }] },
    'rule part not a name': { rules: [{ p: 'Canvas Dashboard', do: 'hide' }] },
    'hide with a style': { rules: [{ p: 'canvas.dashboard-card', do: 'hide', st: { bg: 'accent' } }] },
    'move without a place': { rules: [{ p: 'ultra.course-card', do: 'move', to: 'ultra.course-list' }] },
    'move onto itself': { rules: [{ p: 'ultra.course-card', do: 'move', to: 'ultra.course-card', at: 'after' }] },
    'label without text': { rules: [{ p: 'moodle.navbar', do: 'label' }] },
    'label over 60': { rules: [{ p: 'moodle.navbar', do: 'label', t: 'x'.repeat(61) }] },
    'style key off the list': { rules: [{ p: 'ultra.course-card.title', do: 'style', st: { position: 'fixed' } }] },
    'style with CSS in a colour': { rules: [{ p: 'ultra.course-card.title', do: 'style', st: { bg: 'red; background: url(//evil)' } }] },
    'style font that is typed': { rules: [{ p: 'ultra.course-card.title', do: 'style', st: { f: 'Comic Neue"; } body { x' } }] },
    'style border over 4': { rules: [{ p: 'ultra.course-card.title', do: 'style', st: { bw: 4 } }].map((r) => ({ ...r, st: { bw: 4, extra: 1 } })) },
  };
  for (const [why, x] of Object.entries(bad)) assert.equal(X.clean(clone(x)), null, why);
  // The nav cleaner (lib/navlayout.js) drops what doesn't fit and keeps the rest: such a nav never comes back as it went
  // in, which is all a code needs to be refused.
  const dropped = {
    'nav link with a script': { nav: { links: [{ id: 'abcdefghij12', n: 'x', u: 'javascript:alert(1)', i: 'link' }] } },
    'nav link taking a native id': { nav: { links: [{ id: 'grades', n: 'x', u: 'https://example.com/', i: 'link' }] } },
    'nav seven groups': { nav: { groups: Array.from({ length: 7 }, () => ({ label: 'x', items: ['grades'] })) } },
    'nav a widget that is not one': { nav: { groups: [{ label: 'x', items: ['w:radio'] }] } },
    'nav group with a link it lacks': { nav: { groups: [{ label: 'x', items: ['link:abcdefghij12'] }] } },
    'nav item in two groups': { nav: { groups: [{ label: 'a', items: ['grades'] }, { label: 'b', items: ['grades'] }] } },
    'nav hides Glaze': { nav: { hidden: ['glaze'] } },
    'nav group label over 24': { nav: { groups: [{ label: 'x'.repeat(25), items: items(1) }] } },
    'nav icon not Glaze\'s': { nav: { icons: { grades: 'skull' } } },
  };
  for (const [why, x] of Object.entries(dropped)) assert.ok(!X.same(X.clean(clone(x))?.nav, x.nav), why);
  for (const [why, m] of Object.entries({ none: [], nine: Array.from({ length: 9 }, (_, i) => ({ ...MODS[0], id: `abcdefghijklmno${'abcdefgh'[i]}` })), 'same id twice': [MODS[0], MODS[0]], 'id with capitals': [{ ...MODS[0], id: 'ABCDEFGHIJKLMNOP' }],
    'id too short': [{ ...MODS[0], id: 'abc' }], 'id with 1, 8, 9, 0': [{ ...MODS[0], id: 'abcdefghijklmn19' }], 'hash too short': [{ ...MODS[0], h: 'AAAA' }], 'name over 40': [{ ...MODS[0], name: 'x'.repeat(41) }],
    'name missing': [{ id: MODS[0].id, h: MODS[0].h }], 'unknown key': [{ ...MODS[0], from: 'gallery' }], 'not a list': MODS[0] })) assert.equal(X.mods(clone(m)), null, `m: ${why}`);
  assert.equal(X.bundle({}), null);
  assert.equal(X.bundle({ x: FULL, y: 1 }), null);
  assert.equal(X.bundle({ x: { bg: {} } }), null);
});

test('input from JSON cannot reach a prototype or add a key', () => {
  const evil = [
    '{"__proto__":{"bg":{"layers":[{"k":"noise"}]}}}',
    '{"cursor":{"kind":"glow","__proto__":{"size":5}}}',
    '{"constructor":{"prototype":{"polluted":true}}}',
    '{"anim":{"__proto__":{"s":[]}}}',
    '{"nav":{"icons":{"__proto__":"star"}}}',
    '{"rules":[{"p":"canvas.dashboard-card","do":"hide","__proto__":{"do":"show"}}]}',
  ];
  for (const text of evil) {
    const got = X.clean(JSON.parse(text));
    assert.ok(got === null || !Object.hasOwn(got.nav?.icons || {}, '__proto__'), text);
    if (!text.includes('icons')) assert.equal(got, null, text);
  }
  assert.equal({}.polluted, undefined);
  assert.equal({}.size, undefined);
  // Inherited names are not read either.
  const child = Object.create({ cursor: { kind: 'glow' } });
  assert.equal(X.clean(child), null);
});

test('the names and limits of animations, effects, the cursor and particles are motionx.js\'s, asked of it each time', () => {
  const stops = [{ at: 0 }, { at: 1 }];
  for (const ease of ['linear', 'ease-in-out', 'smooth', 'spring', [0.1, -3, 0.9, 3]]) assert.ok(X.clean({ anim: { 'card.enter': { s: stops, ease } } }), String(ease));
  assert.deepEqual(X.clean({ anim: { 'card.enter': { s: stops, ease: [0.1, -4, 2, 3] } } }).anim['card.enter'].ease, [0.1, -3, 1, 3], 'clamped like any number');
  for (const ease of ['bounce', [0, 0, 1], 5]) assert.equal(X.clean({ anim: { 'card.enter': { s: stops, ease } } }), null, String(ease));
  const was = globalThis.GZ_MX;
  try {
    globalThis.GZ_MX = { ...MX, EASES: { bounce: 'x' }, RANGE: { ...MX.RANGE, x: [-5, 5] }, MOMENTS: ['page.exit'], EVENTS: ['click'], KINDS: ['bang'], CURSORS: ['laser'], SHAPES: ['skull'] };
    assert.equal(X.clean({ anim: { 'page.exit': { s: [{ at: 0, x: 99 }, { at: 1 }], ease: 'bounce' } } }).anim['page.exit'].s[0].x, 5);
    assert.equal(X.clean({ anim: { 'card.enter': { s: stops } } }), null, 'a moment it has no longer');
    assert.equal(X.clean({ anim: { 'page.exit': { s: stops, ease: 'spring' } } }), null);
    assert.ok(X.clean({ fx: { click: { kind: 'bang', shapes: ['skull'] } }, cursor: { kind: 'laser' }, bg: { layers: [{ k: 'particles', shape: 'skull' }] } }));
    assert.equal(X.clean({ cursor: { kind: 'glow' } }), null);
    assert.equal(X.clean({ bg: { layers: [{ k: 'particles', shape: 'star' }] } }), null);
  } finally { if (was === undefined) delete globalThis.GZ_MX; else globalThis.GZ_MX = was; }
  assert.ok(X.clean({ cursor: { kind: 'glow' } }));
});

test('a shader is checked by lib/glsl.js when it is there, and only for its shape when it is not', () => {
  const was = globalThis.GZ_GLSL;
  try {
    globalThis.GZ_GLSL = { check: (src) => ({ ok: !src.includes('BAD'), errors: [] }) };
    assert.ok(X.clean({ bg: { shader: { src: SHADER } } }));
    assert.equal(X.clean({ bg: { shader: { src: `${SHADER}\n// BAD` } } }), null);
    globalThis.GZ_GLSL = { check: () => { throw new Error('boom'); } };
    assert.equal(X.clean({ bg: { shader: { src: SHADER } } }), null, 'a checker that throws refuses');
    delete globalThis.GZ_GLSL;
    assert.ok(X.clean({ bg: { shader: { src: `${SHADER}\n// BAD` } } }));
  } finally { if (was === undefined) delete globalThis.GZ_GLSL; else globalThis.GZ_GLSL = was; }
  assert.equal(X.clean({ bg: { shader: { src: 'a\r\nb' } } }).bg.shader.src, 'a\nb', 'line ends are \\n');
});

test('with the part registry loaded the rules are cleaned by it, and a code that loses a rule is refused', () => {
  const was = globalThis.GZ_PARTS;
  try {
    const known = new Set(['canvas.dashboard-card']);
    globalThis.GZ_PARTS = { has: (n) => known.has(n), rules: (list) => list.filter((r) => known.has(r.p)).map((r) => ({ ...r })) };
    assert.ok(X.clean({ rules: [{ p: 'canvas.dashboard-card', do: 'hide' }] }));
    assert.equal(X.clean({ rules: [{ p: 'canvas.dashboard-card', do: 'hide' }, { p: 'ultra.unknown', do: 'hide' }] }), null);
    assert.equal(X.clean({ rules: Array.from({ length: 65 }, () => ({ p: 'canvas.dashboard-card', do: 'hide' })) }), null);
    globalThis.GZ_PARTS = { rules: () => { throw new Error('boom'); } };
    assert.equal(X.clean({ rules: [{ p: 'canvas.dashboard-card', do: 'hide' }] }), null);
  } finally { if (was === undefined) delete globalThis.GZ_PARTS; else globalThis.GZ_PARTS = was; }
});

test('with the real registry, a rule must name a part that can take it, in a code too', async () => {
  const was = globalThis.GZ_PARTS;
  try {
    globalThis.GZ_PARTS = require('../lib/parts.js');
    const ok = { rules: [{ p: 'ultra.course-card.title', do: 'style', st: { fg: 'accent', o: 50 } }, { p: 'ultra.course-card', do: 'hide' }] };
    assert.ok(X.clean(clone(ok)));
    assert.equal(X.clean({ rules: [{ p: 'ultra.no-such-part', do: 'hide' }] }), null);
    assert.equal(X.clean({ rules: [{ p: 'ultra.course-card.title', do: 'style', st: { bw: 2 } }] }), null, 'a text part takes no border');
    const code = await S.encode(mine, undefined, { x: ok });
    assert.ok((await S.decode(code)).parts.x.rules);
    await assert.rejects(S.decode(await make('glaze2:', { c: C, x: { rules: [{ p: 'ultra.no-such-part', do: 'hide' }] } })), (e) => e.vars.setting === 'x.rules');
  } finally { if (was === undefined) delete globalThis.GZ_PARTS; else globalThis.GZ_PARTS = was; }
});

test('every part at its largest still fits a code: under 48 KiB of JSON', () => {
  const stop = { at: 0, x: 200, y: 200, sc: 1.5, r: 180, kx: 30, ky: 30, o: 1, bl: 20, br: 2, sa: 2, hu: 180 };
  const ids = Array.from({ length: 192 }, (_, i) => `a${i}`);
  const x = {
    bg: { shader: { src: Array.from({ length: 128 }, (_, i) => `float f${i}(float v) { return v * ${i}.5; }`.padEnd(63, ' ')).join('\n').slice(0, 8192) }, layers: [
      { k: 'scene', name: 'pumpkins', amount: 100, speed: 200, blend: 'multiply', c: ['#aabbcc', '#aabbcc', '#aabbcc'] },
      { k: 'noise', scale: 100, amount: 100, speed: 200, blend: 'multiply', c: ['#aabbcc', '#aabbcc', '#aabbcc'] },
      { k: 'gradient', style: 'radial', angle: 360, amount: 100, blend: 'multiply', c: ['#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc'] },
      { k: 'particles', count: 400, shape: 'sparkle'.length ? 'spark' : 'dot', size: 64, speed: 200, drift: 360, twinkle: 100, amount: 100, blend: 'multiply', c: ['#aabbcc', '#aabbcc', '#aabbcc'] }] },
    anim: Object.fromEntries(MX.MOMENTS.map((m) => [m, { s: Array.from({ length: 8 }, (_, i) => ({ ...stop, at: i / 8 })), ms: 2000, ease: [0.123, -1.5, 0.456, 2.5], delay: 1000, stagger: 200 }])),
    fx: Object.fromEntries(MX.EVENTS.map((e) => [e, { kind: 'confetti', count: 60, shapes: ['dot', 'star', 'snow', 'heart'], c: Array(6).fill('#aabbcc'), spread: 360, gravity: -2, life: 2500, size: 48 }])),
    cursor: { kind: 'trail', c: ['#aabbcc', '#aabbcc', '#aabbcc'], size: 48, len: 24, fade: 2000 },
    nav: { place: 'dock', links: Array.from({ length: 8 }, (_, i) => ({ id: `link${String(i).padStart(8, '0')}`, n: 'x'.repeat(40), u: `https://example.edu/${'p'.repeat(480)}`, i: 'globe' })) },
    rules: Array.from({ length: 64 }, (_, i) => ({ p: `ultra.course-card.title-${i}-${'x'.repeat(20)}`.slice(0, 64), do: 'style', st: { bg: '#aabbcc', fg: '#aabbcc', bc: '#aabbcc', bw: 4, r: 32, p: 6, g: 6, sh: 3, o: 100, f: 'jetbrains-nf' } })),
  };
  x.nav.groups = Array.from({ length: 6 }, (_, g) => ({ label: 'x'.repeat(24), items: ids.slice(g * 32, g * 32 + 32).map((id) => id) }));
  const got = X.clean(clone(x));
  // Package D's nav cleaner keeps only the native items it knows, so what the groups lose here is not the point: the size
  // is, so measure the largest everything that cleans, plus the largest nav the design allows.
  assert.ok(got, 'the largest parts clean');
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  const widest = { ...got, nav: x.nav };
  assert.ok(bytes(widest) <= X.MAX_JSON, `${bytes(widest)} bytes of JSON`);
});

test('the shader stripper drops comments and indentation and keeps what a shader means', () => {
  const src = [
    '// a ring',
    'float R = 0.3;   // radius',
    '  /* block',
    '     comment */ float S = 2.0;',
    'float ring(vec2 p) {',
    '\tfloat d = length(p - 0.5);   // distance',
    '    return smoothstep(R, R - 0.01, d) /* edge */ * S;',
    '}',
    '',
    '',
    'vec4 scene(vec2 uv) { return vec4(a/**/b, a - -b, x / y, 1.0); }',
  ].join('\r\n');
  const out = X.strip(src);
  assert.equal(out, [
    'float R = 0.3;',
    'float S = 2.0;',
    'float ring(vec2 p) {',
    'float d = length(p - 0.5);',
    'return smoothstep(R, R - 0.01, d) * S;',
    '}',
    'vec4 scene(vec2 uv) { return vec4(a b, a - -b, x / y, 1.0); }',
  ].join('\n').replace('d) * S', 'd) * S').replace('R - 0.01, d) * S', 'R - 0.01, d) * S'), 'a comment is a space, spaces are not removed, a #define keeps its line');
  assert.equal(X.strip(out), out, 'stripping twice changes nothing');
  assert.ok(out.length < src.length * 0.8);
  // Comments inside comments, and the one that ends a file without a newline.
  assert.equal(X.strip('a /* // */ b // /* c\nd'), 'a b\nd');
  assert.equal(X.strip('x // end'), 'x');
  // An unterminated block comment is left as written, so the shader fails exactly as it did.
  assert.equal(X.strip('float a;\n/* never closed\nfloat b;'), 'float a;\n/* never closed\nfloat b;');
  // `/*/` is not a whole comment.
  assert.equal(X.strip('a /*/ b */ c'), 'a c');
  // Same tokens before and after, for a shader with every kind of comment and spacing in it.
  const tokens = (s) => s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ' ').match(/[A-Za-z_]\w*|\d+\.?\d*|[^\sA-Za-z_\d]/g).join(' ');
  assert.equal(tokens(out), tokens(src));
  const stripped = X.compact({ bg: { shader: { src } } });
  assert.equal(stripped.bg.shader.src, out);
  assert.equal(X.compact({ cursor: { kind: 'glow' } }).cursor.kind, 'glow');
});

test('packed parts round-trip, and anything else in their place is no parts', async () => {
  const P = { x: X.clean(clone(FULL)), m: MODS };
  const packed = await X.pack(P);
  assert.match(packed, /^x1:[\w-]+$/);
  assert.ok(X.same(await X.unpack(packed), P));
  for (const bad of [undefined, null, '', 'x1:', 'x1:!!!', 'x2:AAAA', packed.slice(0, 20), `${packed}0`, `x1:${'A'.repeat(300000)}`, 42, {}]) assert.equal(await X.unpack(bad), null, String(bad).slice(0, 20));
  // A small string that inflates past the cap.
  const bomb = 'x1:' + X.b64(await X.deflate(new TextEncoder().encode(JSON.stringify({ x: { rules: [{ p: 'moodle.navbar', do: 'label', t: 'a'.repeat(60) }] }, pad: ' '.repeat(100000) }))));
  assert.equal(await X.unpack(bomb), null);
  // JSON that is not parts, even if cleanly packed.
  const wrong = 'x1:' + X.b64(await X.deflate(new TextEncoder().encode(JSON.stringify({ x: { cursor: { kind: 'laser' } } }))));
  assert.equal(await X.unpack(wrong), null);
  await assert.rejects(X.pack({ x: { rules: [] }, pad: 'z'.repeat(X.MAX_JSON) }), /too big/);
});

// ---- storage --------------------------------------------------------------------------------------------------------
const store = (data = {}, { refuse = () => false } = {}) => {
  const calls = [];
  return {
    data, calls,
    get: async (k) => (k === null ? structuredClone(data) : Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])]))),
    set: async (o) => { calls.push(['set', Object.keys(o)]); if (refuse(o)) return false; Object.assign(data, structuredClone(o)); return true; },
    remove: async (k) => { calls.push(['remove', k]); for (const x of [].concat(k)) delete data[x]; return true; },
  };
};
// Incompressible ASCII that holds no comment marker (a shader is stripped on its way into a code).
const noise = (n) => Array.from(crypto.randomBytes(n), (b) => String.fromCharCode(33 + (b % 94))).join('').replaceAll('/', '~');

test('parts that fit a sync item are stored there, in the same write as the Look', async () => {
  const sync = store(), local = store({ lookX: 'old device copy' });
  const P = { x: X.clean(clone(FULL)) };
  assert.equal(await X.write({ sync, local }, P, { version: 2, bg: { kind: 'shader' } }), true);
  assert.deepEqual(sync.calls, [['set', ['version', 'bg', 'lookX']]], 'one sync write holds the Look and its parts');
  assert.equal(typeof sync.data.lookX, 'string');
  assert.ok(!('lookX' in local.data), 'a device copy that is no longer used is removed');
  assert.ok(X.same(await X.read({ sync, local }), P));
});

test('parts too big for a sync item stay on this computer, with their hash in sync', async () => {
  const sync = store(), local = store();
  const P = { x: { bg: { shader: { src: noise(8000) } } } };
  assert.equal(await X.write({ sync, local }, P, { version: 2 }), true);
  assert.deepEqual(sync.data.lookX, { h: X.hash(local.data.lookX) });
  assert.ok(X.same(await X.read({ sync, local }), P));
  // Another computer sees the hash and not the parts: none, and it can tell.
  const elsewhere = store();
  assert.equal(await X.fromStored(sync.data.lookX, elsewhere), undefined);
  assert.equal(await X.read({ sync, local: elsewhere }), null);
  // A device copy that isn't the one sync names is not worn.
  local.data.lookX = await X.pack({ x: { cursor: { kind: 'glow' } } });
  assert.equal(await X.read({ sync, local }), null);
  assert.equal(await X.fromStored(sync.data.lookX, local), undefined);
  // And back to something small: sync holds it again, and the device copy goes.
  await X.write({ sync, local }, { x: { cursor: { kind: 'glow' } } }, {});
  assert.equal(typeof sync.data.lookX, 'string');
  assert.ok(!('lookX' in local.data));
});

test('a sync write that is refused falls back to this computer; one that fails everywhere says so', async () => {
  const P = { x: { cursor: { kind: 'glow' } } };
  let sync = store({}, { refuse: (o) => typeof o.lookX === 'string' }), local = store();
  assert.equal(await X.write({ sync, local }, P, { version: 2 }), true);
  assert.deepEqual(sync.data.lookX, { h: X.hash(local.data.lookX) });
  assert.ok(X.same(await X.read({ sync, local }), P));
  sync = store({}, { refuse: () => true });
  assert.equal(await X.write({ sync, local: store() }, P, {}), false);
  // An area that throws or answers false is a failure, not a crash.
  assert.equal(await X.write({ sync: { set: () => { throw new Error('gone'); } }, local: store() }, P, {}), false);
  assert.equal(await X.write({ sync: store(), local: { get: async () => ({}), set: async () => false, remove: async () => true } }, { x: { bg: { shader: { src: noise(8000) } } } }, {}), false);
});

test('no parts is written as an empty lookX in the same write as the Look, and reads as none', async () => {
  const sync = store({ lookX: await X.pack({ x: { cursor: { kind: 'glow' } } }) }), local = store({ lookX: 'x' });
  assert.equal(await X.write({ sync, local }, null, { version: 2, look: {} }), true);
  assert.deepEqual(sync.calls, [['set', ['version', 'look', 'lookX']]]);
  assert.equal(sync.data.lookX, '');
  assert.ok(!('lookX' in local.data));
  assert.equal(await X.read({ sync, local }), null);
  assert.equal(await X.read({ sync: store(), local }), null, 'never set is none too');
});

test('areas() turns the extension\'s callback storage into what write and read use', async () => {
  const data = {};
  const cb = (o) => ({ get: (k, f) => f(k === null ? { ...o } : Object.fromEntries([].concat(k).filter((x) => x in o).map((x) => [x, o[x]]))), set: (v, f) => { Object.assign(o, v); f(); }, remove: (k, f) => { delete o[k]; f(); } });
  const chrome = { runtime: {}, storage: { sync: cb(data), local: cb({}) } };
  const a = X.areas(chrome);
  assert.equal(await X.write(a, { x: { cursor: { kind: 'ripple' } } }, { version: 2 }), true);
  assert.ok(X.same((await X.read(a)).x, { cursor: { kind: 'ripple' } }));
  chrome.runtime.lastError = { message: 'quota' };
  assert.deepEqual(await a.sync.get('lookX'), {});
  assert.equal(await a.sync.set({ a: 1 }), false);
});

// ---- glaze2 codes ---------------------------------------------------------------------------------------------------
const make = async (prefix, obj) => `${prefix}${Buffer.from(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url')}`;
const C = G.GZ_COLORS.map(([, , d]) => d.slice(1)).join('');
const mine = G.GZ_SANITIZE({ look: { radius: 6 }, bg: { kind: 'shader' } });

test('decoding bounds the original text before stripping pasted whitespace', async () => {
  const code = await S.encode(mine, {}, { x: { cursor: { kind: 'glow' } } });
  const limit = 4 * S.MAX_CODE2;
  const padded = code + ' '.repeat(limit - code.length);
  assert.ok((await S.decode(padded)).parts.x.cursor);
  await assert.rejects(S.decode(padded + ' '), /damaged/);
  await assert.rejects(S.decode(' '.repeat(limit * 100) + code), /damaged/);
  const adapter = require('../lib/sharing.js').ADAPTERS.look;
  assert.equal(await adapter.clean('code', padded), padded);
  assert.equal(await adapter.clean('code', padded + ' '), undefined);
});

test('codes carry only the active background part while storage keeps both drafts', async () => {
  const parts = { x: X.clean(clone(FULL)), m: MODS };
  const before = clone(parts);
  for (const kind of G.GZ_SPEC.bg.kind[1]) {
    const settings = G.GZ_SANITIZE({ look: { radius: 6 }, bg: { kind } });
    const got = await S.decode(await S.encode(settings, {}, parts));
    const expected = X.compact(clone(parts.x));
    for (const key of ['shader', 'layers', 'media']) if (key !== kind) delete expected.bg[key];
    if (!Object.keys(expected.bg).length) delete expected.bg;
    assert.deepEqual(got.parts, { x: expected, m: MODS }, kind);
    assert.equal(got.bg.kind, kind);
    assert.equal(got.look.radius, 6);
    const onlyBg = await S.decode(await S.encode(settings, {}, { x: { bg: parts.x.bg } }));
    assert.equal(!!onlyBg.parts, ['shader', 'layers', 'media'].includes(kind), `only background: ${kind}`);
  }
  assert.deepEqual(parts, before, 'encoding leaves the author drafts untouched');
  assert.deepEqual(await X.unpack(await X.pack(parts)), before, 'storage preserves both drafts');
});

test('a Look with parts is a glaze2 code and comes back as it went in, shader comments gone', async () => {
  const parts = { x: X.clean(clone(FULL)), m: MODS };
  const code = await S.encode(mine, undefined, parts);
  assert.match(code, /^glaze2:[\w-]+$/);
  const got = await S.decode(code);
  const active = X.compact(clone(parts.x));
  delete active.bg.layers;
  delete active.bg.media;
  assert.ok(X.same(got.parts, { x: active, m: MODS }));
  assert.equal(got.bg.kind, 'shader');
  assert.equal(got.look.radius, 6);
  assert.equal(await S.decode(`\n${code.slice(0, 30)} ${code.slice(30)}\n`).then((g) => g.parts.m[0].name), 'GPA Garden');
  // Only mods, only x, and the empty kinds of "no parts".
  assert.match(await S.encode(mine, undefined, { m: MODS }), /^glaze2:/);
  assert.deepEqual((await S.decode(await S.encode(mine, undefined, { m: MODS }))).parts, { m: MODS });
  assert.deepEqual((await S.decode(await S.encode(mine, undefined, { x: { cursor: { kind: 'glow' } } }))).parts, { x: { cursor: { kind: 'glow' } } });
  for (const none of [undefined, null, {}, { x: undefined, m: undefined }]) {
    const plain = await S.encode(mine, undefined, none);
    assert.match(plain, /^glaze1:/, 'a Look without parts stays readable by every Glaze');
    assert.equal((await S.decode(plain)).parts, null);
  }
});

test('a shader goes into a code without its comments and indentation, and the editor\'s copy is untouched', async () => {
  const src = `// my shader\n${SHADER.replaceAll('\n', '\n    ')}\n/* end */`;
  const parts = { x: X.clean({ bg: { shader: { src } } }) };
  const code = await S.encode(mine, undefined, parts);
  const got = await S.decode(code);
  assert.equal(got.parts.x.bg.shader.src, X.strip(src));
  assert.ok(got.parts.x.bg.shader.src.length < src.length);
  assert.equal(parts.x.bg.shader.src, src, 'the parts given are not changed');
  assert.ok(X.same(await S.decode(await S.encode(mine, undefined, got.parts)), got), 'what was decoded encodes to the same');
});

test('glaze2 codes are refused whole for anything off in their parts, and glaze1 never carries parts', async () => {
  const x = X.clean(clone(FULL));
  await S.decode(await make('glaze2:', { c: C, x }));
  for (const [why, obj] of [
    ['x unknown part', { c: C, x: { sound: {} } }],
    ['x empty', { c: C, x: {} }],
    ['x an array', { c: C, x: [] }],
    ['x null', { c: C, x: null }],
    ['x text', { c: C, x: 'cursor' }],
    ['number out of range', { c: C, x: { cursor: { kind: 'glow', size: 99 } } }],
    ['number not rounded', { c: C, x: { cursor: { kind: 'glow', size: 3.14159 } } }],
    ['colour in capitals', { c: C, x: { cursor: { kind: 'glow', c: ['#AABBCC'] } } }],
    ['a default written in', { c: C, x: { nav: { place: 'left', links: [{ id: 'abcdefghij12', n: 'Library', u: 'https://library.example.edu/' }] } } }],
    ['media', { c: C, x: { bg: { media: { type: 'video' } } } }],
    ['shader not ASCII', { c: C, x: { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(0.); } ☃' } } } }],
    ['stops out of order', { c: C, x: { anim: { 'card.enter': { s: [{ at: 1 }, { at: 0 }] } } } }],
    ['m empty', { c: C, m: [] }],
    ['m not a list', { c: C, m: MODS[0] }],
    ['m bad id', { c: C, m: [{ ...MODS[0], id: 'short' }] }],
    ['key from a newer Glaze', { c: C, x, z: 1 }],
  ]) await assert.rejects(S.decode(await make('glaze2:', obj)), Error, why);
  // glaze1 reads six keys only: a glaze1 code with x or m was not made by Glaze.
  await assert.rejects(S.decode(await make('glaze1:', { c: C, x })), /newer Glaze/);
  await assert.rejects(S.decode(await make('glaze1:', { c: C, m: MODS })), /newer Glaze/);
  // The part that failed is named.
  await assert.rejects(S.decode(await make('glaze2:', { c: C, x: { cursor: { kind: 'glow', size: 99 } } })), (e) => e.vars.setting === 'x.cursor');
  await assert.rejects(S.decode(await make('glaze2:', { c: C, m: [] })), (e) => e.vars.setting === 'm');
  // Prefixes.
  for (const bad of ['glaze3:AAAA', 'glaze2:', 'glaze2:!!!', 'glaze2:AAAA', 'GLAZE2:AAAA']) await assert.rejects(S.decode(bad), Error, bad);
});

test('glaze2 limits: 20,000 characters and 48 KiB of JSON; glaze1 keeps 4,000 and 8 KiB', async () => {
  // A code longer than 20,000 characters is damaged before it is read; a glaze1 one over 4,000 is too.
  await assert.rejects(S.decode(`glaze2:${'A'.repeat(20000)}`), /damaged/);
  await assert.rejects(S.decode(`glaze1:${'A'.repeat(4001)}`), /damaged/);
  // JSON past 48 KiB inflates to a refusal even from a tiny code.
  await assert.rejects(S.decode(await make('glaze2:', { c: C, x: { cursor: { kind: 'glow' } }, pad: ' '.repeat(60000) })), /damaged/);
  // 8 KiB to 48 KiB of JSON is fine in glaze2 and not in glaze1.
  const roomy = { c: C, x: { bg: { shader: { src: noise(8000) } } }, l: { radius: 6 } };
  assert.ok((await S.decode(await make('glaze2:', roomy))).parts.x.bg.shader);
  await assert.rejects(S.decode(await make('glaze1:', { c: C, l: { font: 'x'.repeat(9000) } })), /damaged/);
  // The worst case the design measured: an incompressible 8 KiB shader and every part at its largest.
  const worst = { x: { bg: { shader: { src: noise(8192) }, layers: FULL.bg.layers }, anim: FULL.anim, fx: FULL.fx, cursor: FULL.cursor, nav: FULL.nav, rules: FULL.rules }, m: MODS };
  const code = await S.encode(mine, undefined, worst);
  assert.ok(code.length < 20000, `${code.length} characters`);
  assert.ok(code.length > 4000, 'a Look this size is a glaze2 code and no glaze1 limit applies');
  assert.equal((await S.decode(code)).parts.x.bg.shader.src, X.strip(worst.x.bg.shader.src));
  // A typical Look with a small shader is well inside what a chat takes.
  assert.ok((await S.encode(mine, undefined, { x: { bg: { shader: { src: SHADER } } } })).length < 1500);
});

test('the student\'s pointer choice is theirs: a code of their Look is the same with or without it, and none can bring one', async () => {
  const look = { x: { pointer: 'pumpkin', cursor: { kind: 'flicker' } } };
  for (const pointer of ['off', 'aqua', 'lava', 'own']) {
    const s = { ...mine, extras: { ...mine.extras, pointer, pointerAnim: false } };
    // The Look's own pointer and its animation go in the code; the student's choice and switch don't.
    const code = await S.encode(s, undefined, look);
    assert.equal(code, await S.encode(mine, undefined, look), `${pointer}: the code is the one without the choice`);
    const got = await S.decode(code);
    assert.ok(X.same(got.parts, look), JSON.stringify(got.parts));
    assert.ok(!('extras' in got));
    // A Look without parts: a glaze1 code, no pointer in it at all.
    const plain = await S.encode(s, undefined, null);
    assert.equal(plain, await S.encode(mine, undefined, null), `${pointer}: glaze1`);
    assert.equal((await S.decode(plain)).parts, null);
  }
  // A code that tries to bring a pointer choice is refused whole, in either form.
  for (const prefix of ['glaze1:', 'glaze2:']) {
    await assert.rejects(S.decode(await make(prefix, { c: C, extras: { pointer: 'lava' } })), /newer Glaze/);
    await assert.rejects(S.decode(await make(prefix, { c: C, e: { pointer: 'lava' } })), /newer Glaze/);
  }
});

test('encode refuses parts that decode would refuse, so a copied code always works', async () => {
  for (const x of [{ cursor: { kind: 'glow', size: 99 } }, { bg: { media: { type: 'video' } } }, { cursor: { kind: 'glow', c: ['#AABBCC'] } }, { anim: {} }, { nope: 1 }]) {
    await assert.rejects(S.encode(mine, undefined, { x }), /extras Glaze can't put in a code/, JSON.stringify(x));
  }
  await assert.rejects(S.encode(mine, undefined, { x: FULL, m: [{ ...MODS[0], id: 'bad' }] }), /extras/);
  // A parts object that is a different shape from { x, m } adds nothing.
  assert.match(await S.encode(mine, undefined, { y: 1 }), /^glaze1:/);
});


test('all displayed part labels remove controls and bidi characters, with the registry loaded too', async () => {
  const dirty = 'a\u0085\u202eb\u2069c';
  const nav = { groups: [{ label: dirty, items: ['grades'] }], links: [{ id: 'abcdefghij12', n: dirty, u: 'https://example.com/', i: 'link' }] };
  const got = X.clean({ nav });
  assert.equal(got.nav.groups[0].label, 'abc');
  assert.equal(got.nav.links[0].n, 'abc');
  const was = globalThis.GZ_PARTS;
  try {
    globalThis.GZ_PARTS = require('../lib/parts.js');
    const x = { rules: [{ p: 'ultra.course-card.title', do: 'label', t: dirty }] };
    assert.equal(X.clean(x).rules[0].t, 'a bc');
    await assert.rejects(S.decode(await make('glaze2:', { c: C, x })), /can't use/);
    await assert.rejects(S.decode(await make('glaze2:', { c: C, x: { nav } })), /can't use/);
  } finally { if (was === undefined) delete globalThis.GZ_PARTS; else globalThis.GZ_PARTS = was; }
});

test('a write refuses unclean parts before changing either store or the Look', async () => {
  for (const P of [false, 0, '', { x: { cursor: { kind: 'laser' } } }, { x: { cursor: { kind: 'glow', size: 99 } } }, { x: { nav: { hidden: ['glaze'] } } }]) {
    const sync = store({ bg: { kind: 'solid' }, lookX: 'old' }), local = store({ lookX: 'old' });
    assert.equal(await X.write({ sync, local }, P, { bg: { kind: 'shader' } }), false);
    assert.deepEqual(sync.calls, []);
    assert.deepEqual(local.calls, []);
  }
});

test('a refused fallback preserves the local parts still named by sync', async () => {
  const old = await X.pack({ x: { cursor: { kind: 'glow' } } });
  const sync = store({ bg: { kind: 'solid' }, lookX: { h: X.hash(old) } }, { refuse: () => true });
  const local = store({ lookX: old });
  assert.equal(await X.write({ sync, local }, { x: { cursor: { kind: 'ripple' } } }, { bg: { kind: 'shader' } }), false);
  assert.equal(local.data.lookX, old);
  assert.deepEqual(await X.read({ sync, local }), { x: { cursor: { kind: 'glow' } } });
});

test('shader compaction preserves preprocessor and continuation semantics', () => {
  for (const src of [
    '#define F/**/(x) x\nvec4 scene(vec2 uv) { return vec4(F(1.)); }',
    '#define A 1 /* spanning\ncomment */\nvec4 scene(vec2 uv) { return vec4(A); }',
    '#define A 1 // continued \\\n+ 2\nvec4 scene(vec2 uv) { return vec4(A); }',
    '// a line\n\nvec4 scene(vec2 uv) { return vec4(float(__LINE__)); }',
    'vec4 scene(vec2 uv) { // hidden \\\nreturn vec4(0.);\nreturn vec4(1.); }',
    'vec4 scene(vec2 uv) { return vec4(1.); } /* never closed\n  still open',
  ]) assert.equal(X.strip(src), src, 'source with preprocessing or an incomplete comment is preserved');
});


test('all bidi controls are removed from mod reference names', () => {
  assert.equal(X.mods([{ ...MODS[0], name: 'a\u061cb' }])[0].name, 'ab');
});


test('stripping does not expose a continued line comment or move __LINE__', () => {
  const src = 'vec4 scene(vec2 uv) { // hidden \\\nreturn vec4(0.);\nreturn vec4(1.); }';
  const tokens = (s) => s.replace(/\\\n/g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  assert.equal(tokens(X.strip(src)), tokens(src));
  const lines = '// comment\n\nvec4 scene(vec2 uv) { return vec4(float(__LINE__)); }';
  const at = (s) => s.slice(0, s.indexOf('__LINE__')).split('\n').length;
  assert.equal(at(X.strip(lines)), at(lines));
});


test('a committed clear succeeds even if removing its unused local copy fails', async () => {
  const sync = store({ lookX: 'old' });
  const local = { remove: async () => false };
  assert.equal(await X.write({ sync, local }, null, { bg: { kind: 'solid' } }), true);
  assert.deepEqual(sync.data, { lookX: '', bg: { kind: 'solid' } });
});

test('packing writes bytes straight into the compression stream, never through a Blob stream (Safari content scripts refuse its chunks)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/lookparts.js'), 'utf8');
  assert.doesNotMatch(src, /\.stream\(\)\.pipeThrough/);
  assert.match(src, /writer\.write\(new Uint8Array\(bytes\)\)/);
});
