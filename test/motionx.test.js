// Look parts that move, the pure half (lib/motionx.js): animations compiled to CSS from numbers only, the knobs motion.css
// reads them through, the effects' and the pointer's cleaners, and the particles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/motionx.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---- a grammar for what compile may write -------------------------------------------------------------------------------
const NUM = '-?\\d+(?:\\.\\d+)?';
const EASE = `(?:linear|ease|ease-in|ease-out|ease-in-out|var\\(--gz-ease\\)|var\\(--gz-spring\\)|cubic-bezier\\(${NUM},${NUM},${NUM},${NUM}\\))`;
const FN = `(?:translate\\(${NUM}px,${NUM}px\\)|rotate\\(${NUM}deg\\)|skew\\(${NUM}deg,${NUM}deg\\)|scale\\(${NUM}\\)|blur\\(${NUM}px\\)|brightness\\(${NUM}\\)|saturate\\(${NUM}\\)|hue-rotate\\(${NUM}deg\\)|opacity\\(${NUM}\\))`;
const FNS = `${FN}(?: ${FN})*`;
const KNOB = {
  'enter': `gz-x-[0-9a-z]+ ${NUM}ms ${EASE} backwards`, 'enter-page': null, 'enter-panel': null, 'enter-tile': null, 'rail-open': null, 'tip-in': null,
  'stagger': `\\d+ms`, 'lift': `(?:${FNS}|none)`, 'hover-filter': FNS, 'hover-t': `\\d+ms`, 'hover-ease': EASE, 'press': NUM,
};
for (const k of ['enter-page', 'enter-panel', 'enter-tile', 'rail-open', 'tip-in']) KNOB[k] = KNOB.enter;
const KEYFRAME_DECL = new RegExp(`^(?:transform:${FNS}|translate:${NUM}px ${NUM}px|rotate:${NUM}deg|scale:${NUM}|opacity:${NUM}|filter:${FNS})$`);
// Throws unless `css` is made only of the shapes compile writes: keyframes of known properties and :root knobs of known forms.
const assertSafe = (css) => {
  const roots = css.match(/:root\{[^{}]*\}$/);
  const frames = roots ? css.slice(0, roots.index) : css;
  if (css) assert.ok(roots, `no :root block: ${css}`);
  const names = new Set();
  let left = frames;
  for (const m of frames.matchAll(/@keyframes (gz-x-[0-9a-z]+)\{((?:\d+(?:\.\d+)?%\{[^{}]*\})+)\}/g)) {
    names.add(m[1]);
    left = left.replace(m[0], '');
    for (const row of m[2].matchAll(/\d+(?:\.\d+)?%\{([^{}]*)\}/g)) for (const d of row[1].split(';').filter(Boolean)) assert.match(d, KEYFRAME_DECL);
  }
  assert.equal(left, '', 'only keyframes before :root');
  if (!roots) return;
  for (const d of roots[0].slice(6, -1).split(';')) {
    const [, name, value] = d.match(/^--gz-x-([a-z-]+):(.*)$/);
    assert.ok(Object.hasOwn(KNOB, name), `knob ${name}`);
    assert.match(value, new RegExp(`^${KNOB[name]}$`), d);
    const used = value.match(/^(gz-x-[0-9a-z]+) /)?.[1];
    if (used) assert.ok(names.has(used), `${used} is defined`);
  }
  assert.doesNotMatch(css, /[<>"'\\]|url\(|expression|import|javascript/i);
};

const ENTER = { s: [{ at: 0, y: 20, o: 0 }, { at: 1, y: 0, o: 1 }], ms: 500, ease: 'spring', delay: 0, stagger: 80 };

test('an entrance becomes one @keyframes and the knob that reads it', () => {
  const css = M.compile({ 'card.enter': ENTER });
  assertSafe(css);
  const name = css.match(/@keyframes (gz-x-[0-9a-z]+)/)[1];
  assert.equal(css, `@keyframes ${name}{0%{translate:0px 20px;opacity:0}100%{translate:0px 0px;opacity:1}}:root{--gz-x-enter:${name} 500ms var(--gz-spring) backwards;--gz-x-stagger:80ms}`);
});

test('each moment feeds the knob motion.css reads for it, and motion.css reads every one', () => {
  const stops = [{ at: 0, sc: 0.9, o: 0 }, { at: 1, sc: 1, o: 1 }];
  const want = { 'page.enter': 'enter-page', 'panel.enter': 'enter-panel', 'card.enter': 'enter', 'tile.enter': 'enter-tile', 'rail.open': 'rail-open', 'tooltip.in': 'tip-in' };
  const motion = read('motion.css');
  for (const [moment, knob] of Object.entries(want)) {
    const css = M.compile({ [moment]: { s: stops } });
    assertSafe(css);
    assert.match(css, new RegExp(`:root\\{--gz-x-${knob}:gz-x-`), moment);
    assert.match(motion, new RegExp(`--gz-${knob}: var\\(--gz-x-${knob}, `), `motion.css: --gz-${knob} reads --gz-x-${knob}`);
  }
  // The states a moment holds.
  const hover = M.compile({ 'card.hover': { s: [{ at: 0, sc: 1 }, { at: 1, y: -6, sc: 1.05, br: 1.1, o: 0.9 }], ms: 200, ease: [0.3, 1.4, 0.5, 1] } });
  assertSafe(hover);
  assert.equal(hover, ':root{--gz-x-lift:translate(0px,-6px) scale(1.05);--gz-x-hover-filter:opacity(0.9) brightness(1.1);--gz-x-hover-t:200ms;--gz-x-hover-ease:cubic-bezier(0.3,1.4,0.5,1)}');
  const press = M.compile({ 'button.press': { s: [{ at: 0, sc: 1 }, { at: 1, sc: 0.9 }] } });
  assert.equal(press, ':root{--gz-x-press:0.9}');
  for (const k of ['lift', 'hover-filter', 'hover-t', 'hover-ease', 'press', 'stagger']) assert.match(motion, new RegExp(`var\\(--gz-x-${k}[,)]`), `motion.css reads --gz-x-${k}`);
});

test('motion off, the three switches and reduced motion zero the knobs a Look feeds', () => {
  // Every knob a Look can feed sits in motion.css behind its off group, as the built-in ones do: the groups name them.
  const css = read('motion.css');
  const group = (sel) => css.match(new RegExp(`html\\[data-gz-motion="off"\\], html\\[data-gz-${sel}\\] \\{([^}]*)\\}`))[1];
  for (const k of ['enter', 'enter-page', 'enter-panel', 'enter-tile', 'rail-open', 'tip-in', 'stagger']) assert.match(group('no-enter'), new RegExp(`--gz-${k}: (none|0s)`), `no-enter zeroes --gz-${k}`);
  for (const k of ['lift', 'press', 'card-hover-filter']) assert.match(group('no-hover'), new RegExp(`--gz-${k}: none`), `no-hover zeroes --gz-${k}`);
  assert.match(group('no-trans'), /--gz-t-hover: 0s/);
  assert.match(css, /@media \(hover: none\) \{[^}]*--gz-lift: none[^}]*--gz-card-hover-filter: none/);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*html:not\(\[data-gz-motion\]\) \{([^}]*)\}/)[1];
  for (const k of ['enter', 'enter-page', 'enter-panel', 'enter-tile', 'rail-open', 'tip-in']) assert.match(reduced, new RegExp(`--gz-${k}: none`));
  // The off groups are written on html[data-gz-*], which outranks the :root the Look's values sit on.
  assert.doesNotMatch(M.compile({ 'card.enter': ENTER }), /data-gz|html/);
});

test('a delay is a hold on the first stop, so a staggered card keeps it', () => {
  const css = M.compile({ 'page.enter': { s: [{ at: 0, o: 0 }, { at: 0.5, o: 0.5 }, { at: 1, o: 1 }], ms: 600, delay: 200 } });
  assertSafe(css);
  assert.match(css, /\{0%\{opacity:0\}25%\{opacity:0\}62\.5%\{opacity:0\.5\}100%\{opacity:1\}\}/);
  assert.match(css, /--gz-x-enter-page:gz-x-[0-9a-z]+ 800ms /);
});

test('a stop sets only what it names, and every stop that moves sets each part the animation uses', () => {
  const css = M.compile({ 'panel.enter': { s: [{ at: 0, x: -30, r: -20, o: 0 }, { at: 0.5, sc: 1.2 }, { at: 1, x: 0, r: 0, sc: 1, o: 1 }] } });
  assertSafe(css);
  assert.match(css, /0%\{translate:-30px 0px;rotate:-20deg;scale:1;opacity:0\}50%\{translate:0px 0px;rotate:0deg;scale:1\.2\}100%\{translate:0px 0px;rotate:0deg;scale:1;opacity:1\}/);
  assert.doesNotMatch(css, /transform:/, 'an entrance without a skew never owns transform: the hover lift is a transform transition');
});

test('a skew has no property of its own, so an entrance with one keeps a transform listing the same functions', () => {
  const css = M.compile({ 'card.enter': { s: [{ at: 0, x: -30, kx: 10, o: 0 }, { at: 0.5, sc: 1.2 }, { at: 1, x: 0, kx: 0, sc: 1, o: 1 }] } });
  assertSafe(css);
  assert.match(css, /0%\{transform:translate\(-30px,0px\) skew\(10deg,0deg\) scale\(1\);opacity:0\}50%\{transform:translate\(0px,0px\) skew\(0deg,0deg\) scale\(1\.2\)\}100%\{transform:translate\(0px,0px\) skew\(0deg,0deg\) scale\(1\);opacity:1\}/);
});

test('filters list the same functions in every stop that has one', () => {
  const css = M.compile({ 'tile.enter': { s: [{ at: 0, bl: 12, br: 0.5 }, { at: 1, hu: 30, sa: 1.4 }] } });
  assertSafe(css);
  assert.match(css, /0%\{filter:blur\(12px\) brightness\(0\.5\) saturate\(1\) hue-rotate\(0deg\)\}100%\{filter:blur\(0px\) brightness\(1\) saturate\(1\.4\) hue-rotate\(30deg\)\}/);
});

test('numbers are clamped to their limits and anything else is dropped', () => {
  const css = M.compile({ 'card.enter': { s: [{ at: -4, x: 9999, y: -9999, sc: 40, r: 720, kx: 99, ky: -99, o: 7, bl: 99, br: 9, sa: -3, hu: 999 }, { at: 9, x: 'ten', y: NaN, sc: Infinity, o: null, bl: {}, br: [], sa: true }], ms: 99999, delay: -5, stagger: 5000 } });
  assertSafe(css);
  assert.match(css, /0%\{transform:translate\(200px,-200px\) rotate\(180deg\) skew\(30deg,-30deg\) scale\(1\.5\);opacity:1;filter:blur\(20px\) brightness\(2\) saturate\(0\) hue-rotate\(180deg\)\}100%\{\}\}/);
  assert.match(css, /2000ms var\(--gz-ease\) backwards/);
  assert.match(css, /--gz-x-stagger:200ms/);
  assert.match(M.compile({ 'card.enter': { s: [{ at: 0, o: 0 }, { at: 1, o: 1 }], ms: 1 } }), / 50ms /);
});

test('easings: a name from the table or four numbers, else the default', () => {
  const at = (ease) => M.compile({ 'page.enter': { s: [{ at: 0, o: 0 }, { at: 1, o: 1 }], ease } }).match(/ ([^ ]+) backwards/)[1];
  for (const [name, css] of Object.entries(M.EASES)) assert.equal(at(name), css);
  assert.equal(at([0.2, 0.8, 0.4, 1.1]), 'cubic-bezier(0.2,0.8,0.4,1.1)');
  assert.equal(at([2, 9, -1, -9]), 'cubic-bezier(1,3,0,-3)', 'x within 0..1, y within -3..3');
  for (const bad of ['', 'ease; background:red', 'url(x)', 'constructor', '__proto__', 'toString', 7, null, [1, 2, 3], [1, 2, 3, 'x'], [1, 2, 3, NaN], {}]) assert.equal(at(bad), 'var(--gz-ease)', String(bad));
});

test('only the known moments, only up to eight stops, and nothing for a part that says nothing', () => {
  assert.equal(M.compile(null), '');
  assert.equal(M.compile('card.enter'), '');
  assert.equal(M.compile([]), '');
  assert.equal(M.compile({}), '');
  assert.equal(M.compile({ 'card.leave': ENTER, __proto__: ENTER, constructor: ENTER, 'card.enter': { s: [{ at: 0 }, { at: 1 }] } }), '', 'unknown moments, and stops that name nothing');
  assert.equal(M.compile({ 'card.enter': { s: [{ at: 0, o: 0 }] } }), '', 'an entrance needs two stops');
  assert.equal(M.compile({ 'card.enter': { s: 'o: 1' } }), '');
  const nine = Array.from({ length: 12 }, (_, i) => ({ at: i / 11, o: i / 11 }));
  assert.equal((M.compile({ 'card.enter': { s: nine } }).match(/%\{/g) || []).length, 8);
  assertSafe(M.compile({ 'card.enter': { s: nine } }));
});

test('compiling is deterministic: key order does not matter, identical moments share a @keyframes', () => {
  const a = M.compile({ 'card.enter': ENTER, 'tile.enter': ENTER, 'page.enter': { s: [{ at: 0, o: 0 }, { at: 1, o: 1 }] } });
  const b = M.compile({ 'page.enter': { s: [{ at: 0, o: 0 }, { at: 1, o: 1 }] }, 'tile.enter': ENTER, 'card.enter': ENTER });
  assert.equal(a, b);
  assertSafe(a);
  assert.equal((a.match(/@keyframes/g) || []).length, 2, 'card.enter and tile.enter are one animation');
  assert.equal(M.compile(JSON.parse(JSON.stringify({ 'card.enter': ENTER }))), M.compile({ 'card.enter': ENTER }));
  assert.notEqual(M.hash('a'), M.hash('b'));
});

test('nothing from the input reaches the CSS: hostile values, many random shapes', () => {
  const hostile = ['};body{display:none}', 'red', '1;} :root{--x:1', 'url(//evil/x)', '</style><script>x</script>', '\\0041', '"', "'", 'calc(1px', 1e308, -1e308, NaN, Infinity, null, undefined, true, {}, [], () => 1, 1e-9, -0, 0.0004];
  const keys = [...Object.keys(M.RANGE), 'at', 'zz', 'ms', '__proto__', 'x;y'];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const any = () => hostile[Math.floor(rnd() * hostile.length)];
  const num = () => (rnd() < 0.5 ? any() : (rnd() - 0.5) * 800);
  let made = 0;
  for (let n = 0; n < 600; n++) {
    const anim = {};
    for (const moment of [...M.MOMENTS, 'evil', '__proto__']) {
      if (rnd() < 0.4) continue;
      const s = Array.from({ length: Math.floor(rnd() * 12) }, () => Object.fromEntries(keys.filter(() => rnd() < 0.4).map((k) => [k, num()])));
      anim[moment] = { s: rnd() < 0.9 ? s : any(), ms: num(), delay: num(), stagger: num(), ease: rnd() < 0.5 ? any() : [num(), num(), num(), num()] };
    }
    const css = M.compile(anim);
    assertSafe(css);
    if (css) made++;
  }
  assert.ok(made > 100, `${made} of 600 random Looks made some CSS`);
});

test('effects: the events there are, the kinds and shapes there are, numbers clamped, colours checked', () => {
  const f = M.fx({ kind: 'confetti', count: 999, shapes: ['star', 'heart', 'star', 'x', 'leaf', 'snow', 'spark'], c: ['accent', '#FF00AA', 'red; x', '#12', 'ink-muted', '', 7, 'a b', 'b'.repeat(40)], spread: 999, gravity: -9, life: 1, size: 0 });
  assert.deepEqual(f, { kind: 'confetti', count: 60, shapes: ['star', 'heart', 'leaf', 'snow'], c: ['accent', '#ff00aa', 'ink-muted'], spread: 360, gravity: -2, life: 200, size: 2 });
  assert.deepEqual(M.fx({}), { kind: 'burst', count: 12, shapes: ['dot'], c: ['accent', 'ok', 'warn'], spread: 360, gravity: 0.3, life: 900, size: 8 });
  assert.deepEqual(M.fx({ kind: 'nope', count: 'x', shapes: 'dot', life: NaN }), M.fx({}));
  for (const k of M.KINDS) assert.equal(M.fx({ kind: k }).kind, k);
  for (const bad of [null, undefined, 'burst', 3, [], [{ kind: 'burst' }]]) assert.equal(M.fx(bad), null);
  const all = M.fxs({ complete: {}, submit: { kind: 'rain' }, grade: { kind: 'ring' }, streak: { kind: 'sprite' }, 'timer.done': { kind: 'confetti' }, 'look.rotate': {}, 'page.enter': {}, __proto__: {}, constructor: {}, bogus: {} });
  assert.deepEqual(Object.keys(all).sort(), [...M.EVENTS].sort());
  assert.deepEqual(M.fxs(null), {});
  assert.deepEqual(M.fxs({ complete: 'burst', submit: null }), {});
  // Cleaning is idempotent.
  assert.deepEqual(M.fx(f), f);
  assert.deepEqual(M.fxs(all), all);
});

test('the pointer effect: four kinds, size, length and fade clamped', () => {
  assert.deepEqual(M.cursor({ kind: 'trail', c: ['accent'], size: 99, len: 1, fade: 9999 }), { kind: 'trail', c: ['accent'], size: 48, len: 2, fade: 2000 });
  assert.deepEqual(M.cursor({ kind: 'glow' }), { kind: 'glow', c: ['accent'], size: 10, len: 10, fade: 600 });
  for (const k of M.CURSORS) assert.equal(M.cursor({ kind: k }).kind, k);
  for (const bad of [null, {}, { kind: 'comet' }, { kind: 'constructor' }, 'trail', [], { kind: ['trail'] }]) assert.equal(M.cursor(bad), null);
  const c = M.cursor({ kind: 'sparkle', c: ['#abcdef', 'x y', 'ok'], size: 'big', len: 3.6 });
  assert.deepEqual(c, { kind: 'sparkle', c: ['#abcdef', 'ok'], size: 10, len: 4, fade: 600 });
  assert.deepEqual(M.cursor(c), c);
});

// ---- particles ----------------------------------------------------------------------------------------------------------------
const seeded = (n = 1) => () => { n = (n * 16807) % 2147483647; return (n - 1) / 2147483646; };
const finite = (p) => ['x', 'y', 'vx', 'vy', 'g', 'd', 'r', 'vr', 's', 'life', 'age'].every((k) => Number.isFinite(p[k]));

test('every kind makes its count of finite particles, and all of them finish', () => {
  for (const kind of M.KINDS) {
    const f = M.fx({ kind, count: 30, life: 1000, shapes: ['dot', 'star'] });
    const ps = M.spawn(f, 200, 300, 800, 600, seeded(3));
    assert.equal(ps.length, kind === 'ring' ? 2 : 30, kind);
    assert.ok(ps.every(finite), kind);
    for (let t = 0; t < 4000; t += 16) for (const p of ps) M.step(p, 16);
    assert.ok(ps.every((p) => !M.alive(p)), `${kind}: none left after a few seconds`);
    assert.ok(ps.every((p) => M.fade(p) === 0 || p.age >= p.life), kind);
  }
});

test('burst fans from the point by the spread; a spread of nothing goes straight up; gravity pulls the way it signs', () => {
  const up = M.spawn(M.fx({ kind: 'burst', count: 20, spread: 0 }), 100, 100, 800, 600, seeded(5));
  assert.ok(up.every((p) => Math.abs(p.vx) < 1e-9 && p.vy < 0));
  const round = M.spawn(M.fx({ kind: 'burst', count: 40, spread: 360 }), 100, 100, 800, 600, seeded(5));
  assert.ok(round.some((p) => p.vx > 50) && round.some((p) => p.vx < -50) && round.some((p) => p.vy > 50) && round.some((p) => p.vy < -50));
  const heavy = M.spawn(M.fx({ kind: 'burst', count: 1, spread: 0, gravity: 2 }), 0, 0, 800, 600, seeded(2))[0];
  const light = M.spawn(M.fx({ kind: 'burst', count: 1, spread: 0, gravity: -2 }), 0, 0, 800, 600, seeded(2))[0];
  for (let i = 0; i < 30; i++) { M.step(heavy, 16); M.step(light, 16); }
  assert.ok(heavy.y > light.y);
  const p = M.spawn(M.fx({ kind: 'burst', count: 1 }), 5, 5, 800, 600, seeded(1))[0];
  assert.equal(p.age, 0);
  M.step(p, 16);
  assert.equal(p.age, 16);
});

test('rain starts above the window, across its width, at different moments; sprites rise; rings start staggered', () => {
  const rain = M.spawn(M.fx({ kind: 'rain', count: 40 }), 0, 0, 1000, 700, seeded(9));
  assert.ok(rain.every((p) => p.y < 0 && p.x >= 0 && p.x <= 1000 && p.age <= 0));
  assert.ok(new Set(rain.map((p) => Math.round(p.age))).size > 10);
  const sprite = M.spawn(M.fx({ kind: 'sprite', count: 10 }), 300, 300, 800, 600, seeded(4));
  for (const p of sprite) p.age = 0;
  for (let i = 0; i < 40; i++) for (const p of sprite) M.step(p, 16);
  assert.ok(sprite.every((p) => p.y < 300), 'rises');
  const rings = M.spawn(M.fx({ kind: 'ring', count: 60, size: 10 }), 50, 60, 800, 600, seeded(1));
  assert.equal(rings.length, 4);
  assert.deepEqual(rings.map((p) => p.shape), ['ring', 'ring', 'ring', 'ring']);
  assert.ok(rings.every((p, i) => p.s === 40 && p.age === -i * 0.18 * p.life || (i === 0 && p.age === 0)));
});

test('confetti pieces are drawn as pieces, not dots; the pointer makes its own particles', () => {
  const ps = M.spawn(M.fx({ kind: 'confetti', count: 10, shapes: ['dot'] }), 0, 0, 800, 600, seeded(2));
  assert.ok(ps.every((p) => p.shape === 'rect'));
  const cur = M.cursor({ kind: 'sparkle', c: ['accent', 'ok'], size: 12, fade: 500 });
  const dust = M.dust(cur, 10, 10, seeded(1)), spot = M.spot(cur, 10, 10, seeded(1)), ring = M.ripple(cur, 10, 10, true, seeded(1)), small = M.ripple(cur, 10, 10, false, seeded(1)), glow = M.glow(cur, 10, 10);
  assert.ok([dust, spot, ring, glow].every(finite));
  assert.equal(spot.life, 500);
  assert.ok(['spark', 'star'].includes(dust.shape));
  assert.equal(ring.shape, 'ring');
  assert.ok(ring.s > small.s);
  assert.equal(glow.shape, 'glow');
  assert.equal(M.fade({ age: -5, life: 100 }), 0);
  assert.equal(M.fade({ age: 0, life: 100 }), 0, 'not started: nothing shows');
  assert.ok(M.fade({ age: 10, life: 100 }) > M.fade({ age: 90, life: 100 }));
});
