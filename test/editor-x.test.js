// The editor's Look parts builders (lib/editor-x*.js): what they write is a cleaned `x` that survives the codec, shader
// problems land on the author's lines, and the page carries the builders where their settings live.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const GLSL = require('../lib/glsl.js');
const XP = require('../lib/lookparts.js');
const S = require('../lib/share.js');
const E = require('../lib/editor-x.js');
const BG = require('../lib/editor-xbg.js');
const M = require('../lib/editor-xmotion.js');
const I = require('../lib/i18n.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
// The checker, as the options page has it (lib/lookparts.js asks for it when it is there).
const withGlsl = async (fn) => { globalThis.GZ_GLSL = GLSL; try { return await fn(); } finally { delete globalThis.GZ_GLSL; } };
const roundTrip = async (x) => {
  const P = XP.bundle({ x });
  assert.ok(P, 'cleans');
  assert.ok(XP.same(P.x, x), 'unchanged by cleaning');
  assert.ok(XP.same(await XP.unpack(await XP.pack(P)), P), 'through storage packing');
  const s = D.GZ_SANITIZE();
  if (x.bg) s.bg.kind = x.bg.shader ? 'shader' : 'layers';
  const got = await S.decode(await S.encode(s, {}, P));
  assert.ok(XP.same(got.parts.x, XP.compact(P.x)), 'through a glaze2 code');
};

test('put sets and takes out one part, keeps the rest and the mods, and refuses what does not clean', () => withGlsl(() => {
  const m = [{ id: 'abcdefghijklmnop', h: 'a'.repeat(43), name: 'Garden' }];
  const nav = { place: 'top' };
  let P = E.put({ x: { nav }, m }, 'cursor', { kind: 'glow' });
  assert.deepEqual(P, { x: { cursor: { kind: 'glow' }, nav }, m });
  P = E.put(P, 'cursor', null);
  assert.deepEqual(P, { x: { nav }, m });
  assert.deepEqual(E.put({ x: { cursor: { kind: 'glow' } } }, 'cursor', {}), null, 'nothing left is no parts');
  assert.deepEqual(E.put(null, 'anim', null), null);
  assert.equal(E.put(null, 'bg', { shader: { src: 'vec4 scene(vec2 uv) { float a = 0.; for (int i = 0; i < 1000; i++) a += 1.; return vec4(a); }' } }), undefined, 'a shader the checker refuses');
  assert.equal(E.put(null, 'cursor', { kind: 'laser' }), undefined);
  assert.equal(E.put(null, 'fx', { complete: { kind: 'burst', c: [] } }), undefined, 'an emptied list must be pruned, not saved');
  assert.deepEqual(E.prune({ a: [], b: {}, c: null, d: undefined, e: 0, f: ['x'] }), { e: 0, f: ['x'] });
}));

test('every F1 edit preserves the other package parts and mod references', () => {
  let parts = { x: { nav: { place: 'top' }, rules: [{ p: 'canvas.dashboard-card', do: 'hide' }] }, m: [{ id: 'abcdefghijklmnop', h: 'a'.repeat(43), name: 'Garden' }] };
  const other = structuredClone(parts);
  for (const [key, value] of [['bg', { layers: [BG.fresh('noise')] }], ['anim', { 'page.enter': M.ENTER.rise[1] }], ['fx', { complete: { kind: 'ring' } }], ['cursor', { kind: 'trail' }], ['anim', null], ['bg', null]]) {
    const next = E.put(parts, key, value);
    assert.notEqual(next, undefined, key);
    assert.deepEqual(next.x.nav, other.x.nav);
    assert.deepEqual(next.x.rules, other.x.rules);
    assert.deepEqual(next.m, other.m);
    for (const k of Object.keys(parts.x)) if (k !== key) assert.deepEqual(next.x[k], parts.x[k], `${key} preserves ${k}`);
    parts = next;
  }
});

test('the Ultra preview accepts settings and parts only from its editor parent at the same origin', () => {
  const source = read('content.js');
  const block = source.slice(source.indexOf('  if (isPreview) {\n    addEventListener(\'message\''), source.indexOf('  chrome.storage.onChanged.addListener((changes, area) => {'));
  let receive;
  const parent = {}, writes = [], origin = 'chrome-extension://fixture';
  vm.runInNewContext(block, { isPreview: true, parent, location: { origin }, addEventListener: (_, fn) => { receive = fn; },
    GZ_XPARTS_PAGE: { preview: (p) => writes.push(p) }, GZ_SANITIZE: (s) => s, settings: { enabled: false }, links: [], enable() {}, disable() {}, applySettings() {},
  });
  const data = { gzPreview: { enabled: false }, gzPreviewParts: { x: { cursor: { kind: 'glow' } } } };
  receive({ origin: 'https://foreign.test', source: parent, data });
  receive({ origin, source: {}, data });
  assert.equal(writes.length, 0, 'same-origin sibling windows cannot change the preview');
  receive({ origin, source: parent, data });
  assert.deepEqual(writes, [data.gzPreviewParts]);
});

test('the preview saying why its background stopped: a context the browser took back is not a shader the device refused', () => {
  const source = read('lib/editor-xbg.js'), a = source.indexOf('  const sceneSays = (d) => {'), b = source.indexOf('\n  };\n', a);
  assert.ok(a > 0 && b > a);
  const says = vm.runInContext(`(() => { const tr = (s) => s;\n${source.slice(a, b + 5)}\nreturn sceneSays; })()`, vm.createContext({}));
  const lost = 'The graphics stopped while drawing this: showing the gradient.';
  assert.equal(says({ gzSceneFailed: { why: 'lost' } }), lost);
  assert.equal(says({ gzSceneFailed: { why: 'dropped' } }), lost);
  assert.equal(says({ gzSceneFailed: { why: 'compile' } }), "This device couldn't draw the shader: showing the gradient.");
});

test('compiler reports are accepted only from the preview frame at the same origin', () => {
  const handlers = [], accepted = [], frame = { contentWindow: {} }, origin = 'chrome-extension://fixture';
  const ctx = vm.createContext({ document: { getElementById: () => null }, location: { origin }, addEventListener: (_, fn) => handlers.push(fn) });
  vm.runInContext(read('lib/editor-x.js'), ctx);
  ctx.GZ_EDITOR_X.mount({ frame });
  ctx.GZ_EDITOR_X.fromPreview((d) => accepted.push(d));
  const data = { gzSceneFailed: { errors: [{ line: 1, message: '<img src=x onerror=alert(1)>' }] } };
  handlers[0]({ origin: 'https://foreign.test', source: frame.contentWindow, data });
  handlers[0]({ origin, source: {}, data });
  assert.equal(accepted.length, 0);
  handlers[0]({ origin, source: frame.contentWindow, data });
  assert.deepEqual(accepted, [data]);
});

test('in-flight saves and stale storage reads cannot roll back newer builder edits', async () => {
  const source = read('options.js'), callbacks = [];
  let receive, finishRead, reads = 0, fills = 0;
  const s = { parts: { x: { cursor: { kind: 'glow' } } } };
  const ctx = vm.createContext({ s, clearTimeout, setTimeout, addEventListener() {}, hint() {}, t: (s) => s, fill: () => fills++,
    GZ_UI: { save: (_, keys, done) => callbacks.push(done), load: () => { reads++; return new Promise((r) => { finishRead = r; }); } },
    chrome: { storage: { onChanged: { addListener: (fn) => { receive = fn; } } } },
  });
  vm.runInContext(source.slice(source.indexOf('  const pending = new Set()'), source.indexOf('  const get = (path)')) + '\nglobalThis.write = save;', ctx);
  vm.runInContext(source.slice(source.indexOf('  const syncSettings'), source.indexOf('  // ---- share:')), ctx);
  ctx.write(['parts']);
  receive({}, 'sync');
  assert.equal(reads, 0, 'own save notifications cannot reload an older queued write');
  callbacks.shift()('');
  receive({}, 'sync');
  assert.ok(reads >= 1, 'external changes are still read once writes finish');
  s.parts = { x: { cursor: { kind: 'trail' } } };
  ctx.write(['parts']);
  finishRead({ parts: { x: { cursor: { kind: 'glow' } } } });
  await new Promise(setImmediate);
  assert.equal(s.parts.x.cursor.kind, 'trail', 'a read begun before an edit cannot replace it');
  assert.equal(fills, 0, 'stale snapshots cannot redraw away keyboard focus');
});

test('shader problems are grouped by the line they are on, in order; anything else is the whole shader', () => withGlsl(() => {
  const src = ['vec4 scene(vec2 uv) {', '  float a = 1.;', '  for (int i = 0; i < 1000; i++) { a -= .1; }', '  return vec4(uC1, a);', '}'].join('\n');
  const r = GLSL.check(src);
  assert.equal(r.ok, false);
  const lines = E.byLine(r.errors);
  assert.ok(lines.has(3), `the loop is on line 3: ${JSON.stringify(r.errors)}`);
  assert.deepEqual(E.byLine([{ line: 4, message: 'b' }, { line: 2, message: 'a' }, { line: 4, message: 'c' }, { message: 'd' }, { line: -1, message: 'e' }, null]),
    new Map([[0, ['d', 'e', '']], [2, ['a']], [4, ['b', 'c']]]));
  assert.deepEqual(E.byLine('nonsense'), new Map());
  const text = 'one\ntwo\nthree';
  assert.deepEqual([1, 2, 3, 9].map((n) => E.lineStart(text, n)), [0, 4, 8, 8]);
}));

test('shader diagnostics translate their placeholders while preserving compiler details', () => {
  const errors = GLSL.check('uniform float k;').errors;
  const driver = "'scene': no matching function {untouched}";
  const wrapper = GLSL.parseLog(`ERROR: 0:25: ${driver}`, 3);
  for (const lang of I.CODES) {
    const t = (message, vars) => I.t(message, vars, lang);
    const translated = E.byLine(errors, t).get(1)[0];
    assert.notEqual(translated, I.t(errors[0].message, errors[0].vars));
    assert.ok(translated.includes('`uniform`'));
    assert.ok(!translated.includes('{name}'));
    const size = E.byLine(GLSL.check('a'.repeat(GLSL.MAX + 1)).errors, t).get(0)[0];
    assert.ok(size.includes(I.num(GLSL.MAX + 1, lang)));
    assert.ok(size.includes(I.num(GLSL.MAX, lang)));
    assert.ok(E.byLine(wrapper, t).get(0)[0].includes(driver));
    assert.deepEqual(E.byLine([{ line: 2, message: driver }], t).get(2), [driver]);
  }
});

test('every example shader is in assets/shaders and passes the checker', () => withGlsl(async () => {
  for (const [name] of BG.EXAMPLES) {
    const src = read(`assets/shaders/${name}.glsl`);
    assert.ok(GLSL.check(src).ok, name);
    await roundTrip({ bg: { shader: { src } } });
  }
}));

test('layer stacks: every preset, a fresh layer of each kind and a reordered stack clean unchanged and round-trip', async () => {
  for (const [name, layers] of BG.PRESETS) { assert.ok(layers.length >= 1 && layers.length <= 4, name); await roundTrip({ bg: { layers } }); }
  for (const [k] of BG.KINDS) {
    await roundTrip({ bg: { layers: [BG.fresh(k)] } });
    for (const key of BG.FIELDS[k]) assert.ok(key === 'name' || key === 'c' || Object.hasOwn(XP.DEFAULTS.layer[k], key), `${k}.${key} has a default to show`);
  }
  const [, layers] = BG.PRESETS[0];
  assert.deepEqual(BG.move(layers, 0, 1), [layers[1], layers[0]]);
  assert.equal(BG.move(layers, 0, -1), layers, 'past the bottom: unchanged');
  assert.equal(BG.move(layers, 1, 1), layers, 'past the top: unchanged');
  assert.equal(XP.bundle({ x: { bg: { layers: [...layers, ...layers, BG.fresh('noise')] } } }), null, 'five layers are refused: the builder stops at four');
});

test('motion: every ready animation, an added stop, effects and a cursor clean unchanged, round-trip, and are recognised again', async () => {
  const MX = require('../lib/motionx.js');
  assert.deepEqual(Object.keys(M.MOMENTS).sort(), [...MX.MOMENTS].sort(), 'every moment has a label');
  assert.deepEqual(Object.keys(M.EVENTS).sort(), [...MX.EVENTS].sort(), 'every event has a label');
  assert.deepEqual(Object.keys(M.KEYS).sort(), Object.keys(MX.RANGE).sort(), 'every stop value has a slider');
  for (const k of Object.keys(M.KEYS)) { const [lo, hi] = MX.RANGE[k]; assert.ok(M.KEYS[k][3] >= lo && M.KEYS[k][3] <= hi, k); }
  for (const moment of MX.MOMENTS) {
    for (const [name, [, a]] of Object.entries(M.presetsFor(moment))) {
      await roundTrip({ anim: { [moment]: a } });
      // Cleaning reorders keys; the editor still names it.
      assert.equal(M.presetOf(moment, XP.bundle({ x: { anim: { [moment]: a } } }).x.anim[moment]), name);
      assert.ok(MX.compile({ [moment]: a }), `${moment} ${name} compiles to something`);
    }
  }
  const a = M.ENTER.pop[1];
  const s = [...a.s.slice(0, 1), M.between(a.s, 0), ...a.s.slice(1)];
  assert.deepEqual(s[1], { at: 0.35 });
  await roundTrip({ anim: { 'page.enter': { ...a, s, ease: [0.2, -0.5, 0.1, 1.4], delay: 120 } } });
  assert.equal(M.presetOf('page.enter', { ...a, ms: 900 }), '', 'changed: built by hand');
  const fx = Object.fromEntries(MX.EVENTS.map((e, i) => [e, { kind: MX.KINDS[i % MX.KINDS.length], ...(i % 2 && { count: 20, shapes: ['star', 'heart'], c: ['accent', '#ff00aa'], spread: 90, gravity: -0.5, life: 900, size: 10 }) }]));
  await roundTrip({ fx, cursor: { kind: 'trail', c: ['accent-hi'], size: 12, len: 10, fade: 400 } });
});

test('the page carries the builders in the sections their settings live in, with their scripts before options.js', () => {
  const html = read('options.html');
  const kinds = [...html.matchAll(/<input type="radio" name="bg\.kind" value="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(kinds.sort(), [...D.GZ_SPEC.bg.kind[1]].sort(), 'every background kind is a choice');
  const section = (route) => html.split(`data-editor-section="${route}"`)[1].split('</section>')[0];
  assert.match(section('look/background'), /<div id="x-shader" class="x-builder" data-kinds="shader"><\/div>/);
  assert.match(section('look/background'), /<div id="x-layers" class="x-builder" data-kinds="layers"><\/div>/);
  assert.match(section('look/background'), /<div id="x-media" class="x-builder" data-kinds="media"><\/div>/);
  assert.match(section('look/background'), /data-kinds="gradient aurora scene shader layers"><span>Colors/);
  assert.match(section('look/background'), /data-kinds="scene shader layers"><span><label for="bg-intensity" id="bg-intensity-name">Intensity<\/label>/);
  assert.match(section('look/motion'), /<div id="x-motion" class="group"><\/div>/);
  assert.match(section('look/pointer'), /<div class="seg pt-cards" role="radiogroup" aria-labelledby="heading-look-pointer" aria-describedby="pointer-note" id="pointer-tiles" data-setting-owner="extras\.pointer"><\/div>/);
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  for (const [a, b] of [['lib/motionx.js', 'lib/editor-x.js'], ['lib/lookparts.js', 'lib/editor-x.js'], ['lib/glsl.js', 'lib/editor-xbg.js'], ['lib/media.js', 'lib/editor-xbg.js'], ['lib/editor-x.js', 'lib/editor-xbg.js'], ['lib/editor-x.js', 'lib/editor-xmotion.js'], ['lib/editor-xmotion.js', 'options.js'], ['lib/editor-xbg.js', 'options.js'], ['lib/lookx.js', 'options.js'], ['lib/editor-xmotion.js', 'lib/editor-pointer.js'], ['lib/editor-pointer.js', 'options.js']]) {
    assert.ok(at(a) > 0 && at(a) < at(b), `${a} loads before ${b}`);
  }
  const js = read('options.js');
  assert.match(js, /GZ_EDITOR_X\.mount\(\{ s, save[^\n]*preview, t, frame, hint \}\)/);
  assert.match(js.split('const refresh = () => {')[1].split('};')[0], /GZ_EDITOR_X\.render\(\);/);
  // Builders never save on their own: only through the editor's save() and the Look's parts key.
  for (const f of ['lib/editor-x.js', 'lib/editor-xbg.js', 'lib/editor-xmotion.js']) assert.doesNotMatch(read(f), /chrome\.storage|GZ_UI\.save|innerHTML|insertAdjacentHTML/, f);
  // The preview plays what the editor asks, and only that.
  assert.match(read('lib/editor-preview.js'), /e\.origin === location\.origin && e\.source === parent \? e\.data\?\.gzPreviewMoment : null/);
});

test('the media builder offers exactly the kinds and fits the cleaner has, each writes a part that cleans, and a bad link writes nothing', () => {
  assert.deepEqual(BG.MEDIA_KINDS.map(([k]) => k), XP.MEDIA.types);
  assert.deepEqual(BG.MEDIA_FITS.map(([k]) => k), XP.MEDIA.fits);
  for (const [type] of BG.MEDIA_KINDS) for (const [fit] of BG.MEDIA_FITS) {
    const P = E.put(null, 'bg', { media: { type, src: 'https://cdn.example.com/a', fit, dim: 40, loop: true } });
    assert.ok(P && XP.same(P.x.bg.media, { type, src: 'https://cdn.example.com/a', fit, dim: 40, loop: true }), `${type} ${fit}`);
  }
  // What the link box writes is the address as the parser spells it, or nothing (the editor says why).
  assert.equal(XP.MEDIA.url('http://cdn.example.com/a'), null);
  assert.equal(XP.MEDIA.url('https://192.168.0.4/a'), null);
  assert.equal(XP.MEDIA.url('https://CDN.example.com/a b'), 'https://cdn.example.com/a%20b');
  assert.equal(E.put(null, 'bg', { media: { type: 'video', src: 'http://cdn.example.com/a' } }), undefined, 'a link that does not clean is not written');
  assert.deepEqual(E.put({ x: { bg: { media: { type: 'video', src: 'https://cdn.example.com/a' }, layers: [{ k: 'noise' }] } } }, 'bg', E.prune({ layers: [{ k: 'noise' }] })), { x: { bg: { layers: [{ k: 'noise' }] } } }, 'taking the media out keeps the other drafts');
  // The editor sends the worker the field `kind`: the message's own `type` names it to the worker.
  assert.match(read('lib/editor-xbg.js'), /askWorker\(\{ op: 'put', kind: mediaKind, b64 \}\)/);
  assert.match(read('lib/editor-xbg.js'), /\{ type: 'glaze:media', \.\.\.m \}/);
});

test('the event builder offers the canvas marks and shows the Look\'s selected marks', () => {
  const MX = require('../lib/motionx.js'), checks = [];
  let builder;
  const node = () => ({ dataset: {}, querySelector: node, append() {}, closest: () => null, childElementCount: 0, replaceChildren() {} });
  const host = node();
  const context = vm.createContext({ document: { getElementById: (id) => id === 'x-motion' ? host : null },
    GZ_MX: MX, GZ_EDITOR_X: {
      add: (b) => { builder = b; }, tr: (s) => s, tokenName: (s) => s,
      el: (tag, props) => { if (tag === 'input' && props.type === 'checkbox') checks.push(props); return node(); },
      select: node, slider: node, colors: node, button: node, status: node, motionNote: () => '',
    } });
  vm.runInContext(read('lib/editor-xmotion.js'), context);
  builder.mount({ s: { parts: { x: { fx: { complete: { kind: 'sprite', shapes: ['ghost'] } } } } } });
  for (const shape of MX.DRAWN) assert.ok(checks.some((c) => c['data-focus'] === `fx-complete-${shape}`), shape);
  assert.equal(checks.find((c) => c['data-focus'] === 'fx-complete-ghost').checked, true);
});

test('Motion has the Look\'s animations, event effects and typing effect; its pointer and cursor effect are under Look › Pointer', () => {
  const MX = require('../lib/motionx.js'), labels = [], writes = [], saves = [];
  let builder, resetClick;
  const node = () => ({ dataset: {}, querySelector: node, append() {}, closest: () => null, childElementCount: 0, replaceChildren() {} });
  const section = { querySelector: () => ({ addEventListener: (t, f) => { resetClick = f; } }) };
  const host = { ...node(), closest: () => section };
  const context = vm.createContext({ document: { getElementById: (id) => id === 'x-motion' ? host : null },
    GZ_MX: MX, GZ_EDITOR_X: {
      add: (b) => { builder = b; }, tr: (s) => s, tokenName: (s) => s, prune: (o) => o,
      el: (tag, props, ...kids) => { if (tag === 'h3') labels.push(kids.flat()[0]); return node(); },
      select: (o) => { labels.push(o.label); return node(); }, slider: node, colors: node, button: node, status: node, motionNote: () => '',
    } });
  vm.runInContext(read('lib/editor-xmotion.js'), context);
  builder.mount({ s: { parts: { x: { pointer: 'aqua', cursor: { kind: 'glow' }, type: { kind: 'ink' } } }, extras: {} }, write: (k) => writes.push(k), save: (keys, soon, parts) => saves.push([keys, soon, parts]) });
  assert.ok(labels.includes('Typing effect') && labels.includes('Event effects'), labels.join(', '));
  for (const gone of ['Pointer', 'Cursor effect']) assert.ok(!labels.includes(gone), gone);
  resetClick({ isTrusted: true });
  assert.deepEqual(JSON.parse(JSON.stringify(saves)), [[['parts'], false, ['anim', 'fx', 'type']]], 'Reset must merge only its parts into the latest Look');
  assert.deepEqual(writes, ['anim', 'fx', 'type'], 'Motion\'s Reset leaves the pointer to Pointer\'s');
});
