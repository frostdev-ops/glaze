// One background under course tabs: a course tab's frame wearing the page's own background draws none, and the page under
// it keeps its background live and visible through the frame. Before, the frame drew a second copy sized to itself, which
// never lined up with the page's around Glaze's rail.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const rules = (f) => [...read(f).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim(), body]);
const has = (f, sel, prop) => rules(f).some(([s, b]) => s.split(/,(?![^(]*\))/).some((x) => x.trim() === sel) && prop.test(b));

for (const f of ['extras.css', 'canvas.css']) {
  test(`${f}: a see-through frame paints no ground and no background layer of its own`, () => {
    assert.ok(has(f, 'html[data-gz-bg][data-gz-through]', /background:\s*transparent\s*!important/), 'html ground');
    assert.ok(has(f, 'html[data-gz-through]::before', /content:\s*none/), 'the background layer');
  });
  test(`${f}: the aurora drifts on the background's own knob, which a covering frame leaves running`, () => {
    const aurora = rules(f).filter(([s, b]) => s.includes('[data-gz-bg="aurora"]') && /animation-play-state/.test(b));
    assert.ok(aurora.length);
    for (const [, b] of aurora) assert.match(b, /animation-play-state:\s*var\(--gz-drift\)/);
  });
}

test('extras.css: an Ultra course panel inside a see-through frame drops its copy of the background', () => {
  assert.ok(has('extras.css', 'html[data-gz-through] :is(.panel-wrap, .bb-offcanvas-panel)::before', /content:\s*none/));
});

test('canvas.css: the page under a course frame keeps its scene showing', () => {
  const hidden = rules('canvas.css').filter(([s, b]) => s.startsWith('html[data-gz-ctab-framed]') && /visibility:\s*hidden/.test(b));
  assert.ok(hidden.length);
  for (const [s] of hidden) assert.ok(!s.includes('#gz-scene'), s);
});

test('motion.css: covering a page pauses its ambient motion, not its background drift', () => {
  const m = rules('motion.css');
  assert.ok(m.some(([s, b]) => s === ':root' && /--gz-ambient:\s*var\(--gz-drift\)/.test(b) && /--gz-drift:\s*paused/.test(b)));
  assert.ok(m.some(([s, b]) => s === 'html[data-gz-motion="expressive"]' && /--gz-drift:\s*running/.test(b)));
  assert.ok(m.some(([s, b]) => s === 'html[data-gz-motion="off"]' && /--gz-drift:\s*paused/.test(b)));
  const framed = m.filter(([s]) => s === 'html[data-gz-ctab-framed]');
  assert.ok(framed.some(([, b]) => /--gz-ambient:\s*paused/.test(b)));
  assert.ok(framed.every(([, b]) => !/--gz-drift/.test(b)));
});

test('coursetabs.css: the covered page hides its own strip while a see-through frame shows', () => {
  assert.ok(has('features/coursetabs.css', 'html[data-gz-ctab-framed]:has(> body > #gz-ctabs-frames > iframe[data-gz-through]) #gz-ctabs', /visibility:\s*hidden\s*!important/));
});

// ---- content.js -----------------------------------------------------------------------------------------------------
const source = read('content.js');
const a = source.indexOf('  // ---- animated background'), b = source.indexOf('  // ---- course colors and tint', a);
const block = source.slice(a, b).replace(/import\((chrome\.runtime\.getURL\((?:file|`\$\{file\}[^`]*`)\)(?: \+ `[^`]*`)?)\)/, 'importScene($1, file)');
const on = source.match(/^  const on = .*;$/m)[0];
const settle = () => new Promise(setImmediate);

// tabFrame: '' on the page itself. through: what lib/scene-host.js answers (tested below on its own).
const rig = ({ tabFrame = '_1_1', ultra = true, kind = 'scene', bg = 'scene', through = true, framed = false, modBg = false } = {}) => {
  const log = { starts: 0, stops: 0, needs: [], asked: [], pointer: [] };
  const attrs = new Map([['data-gz-bg', bg], ['data-gz-motion', 'normal']]);
  if (framed) attrs.set('data-gz-ctab-framed', '');
  const html = { hasAttribute: (k) => attrs.has(k), getAttribute: (k) => attrs.get(k) ?? null, toggleAttribute: (k, v) => { if (v) attrs.set(k, ''); else attrs.delete(k); } };
  const host = { place() { return false; }, clear() {}, pointer: (s) => log.pointer.push(s), through: (sig, u, hidden) => { log.asked.push([sig, u, hidden]); return !!sig && host.answer; }, answer: through };
  const ctx = vm.createContext({
    tabFrame, ultra, solo: true, isPreview: false, docId: 'd', location: { protocol: 'https:', pathname: '/' },
    settings: { enabled: true, enhance: { quizLight: true } }, links: [1], palette: { '--gz-surface-2': '#202030' },
    hid: () => !!tabFrame && attrs.has('data-gz-ctab-framed'), html,
    worn: { bg: { kind, scene: 'mist', intensity: 50, colors: [] } },
    GZ_SCENE_LOOK: () => ({ dim: 0.3, amount: 0.5, pace: 1 }), GZ_BG_COLORS: () => ['#111111', '#222222', '#333333'],
    GZ_SCENE_HOST: host,
    document: { hidden: false, body: {}, getElementById: () => null, querySelector: () => null, createElement: () => ({ remove() {}, setAttribute() {} }), addEventListener() {} },
    chrome: { runtime: { id: 'glaze', getURL: (f) => f } },
    importScene: () => Promise.resolve({ start: () => { log.starts++; return { update() {}, draw() {}, stop() { log.stops++; } }; } }),
    need: (file) => { log.needs.push(file); return Promise.resolve(); },
    GZ_CTX: { parts: () => null },
    JSON, Promise, setTimeout: () => 0, clearTimeout() {},
  });
  vm.runInContext(`${on}\n${block}; bgSig = 'k1'; ${modBg ? 'modBg = { remove() {} };' : ''} globalThis.api = { syncScene, sceneOpts, placeScene };`, ctx);
  return { api: ctx.api, log, attrs, host, ctx };
};

test('a frame wearing the page\'s background starts no scene of its own and is marked see-through', async () => {
  const r = rig(); r.api.syncScene(); await settle();
  assert.equal(r.log.starts, 0);
  assert.ok(r.attrs.has('data-gz-through'));
  assert.deepEqual(JSON.parse(JSON.stringify(r.log.asked[0])), ['k1', true, false]);
});

test('a frame draws its own background when the page says it differs or a layer covers its course', async () => {
  const r = rig({ through: false }); r.api.syncScene(); await settle();
  assert.ok(!r.attrs.has('data-gz-through'));
  assert.equal(r.log.starts, 1);
  assert.ok(r.log.pointer.at(-1)?.update, 'the scene host hears the scene');
});

test('a frame with a background no page shares asks with no signature: solid, a mod\'s, Glaze off for it', async () => {
  for (const o of [{ bg: 'solid', kind: 'solid' }, { modBg: true }]) {
    const r = rig(o); r.api.syncScene(); await settle();
    assert.ok(!r.attrs.has('data-gz-through'), JSON.stringify(o));
    assert.ok(r.log.asked.every(([sig]) => sig === false), JSON.stringify(o));
  }
});

test('the page itself is never see-through and asks nothing', async () => {
  const r = rig({ tabFrame: '' }); r.api.syncScene(); await settle();
  assert.equal(r.log.asked.length, 0); assert.ok(!r.attrs.has('data-gz-through')); assert.equal(r.log.starts, 1);
});

test('a layer opening over a see-through frame\'s course brings its own scene, and closing it lets the page\'s show again', async () => {
  const r = rig(); r.api.syncScene(); await settle();
  assert.equal(r.log.starts, 0);
  r.host.answer = false; r.api.placeScene(); await settle();
  assert.equal(r.log.starts, 1); assert.ok(!r.attrs.has('data-gz-through'));
  r.host.answer = true; r.api.placeScene(); await settle();
  assert.equal(r.log.stops, 1); assert.ok(r.attrs.has('data-gz-through'));
});

test('a frame asks for the scene host first, on Ultra and Canvas', () => {
  for (const ultra of [true, false]) {
    const r = rig({ ultra }); r.ctx.GZ_SCENE_HOST = undefined; r.api.syncScene();
    assert.ok(!r.attrs.has('data-gz-through'));
    assert.ok(r.log.needs.includes('lib/scene-host.js'));
  }
});

test('a hidden frame tells the host so', async () => {
  const r = rig({ framed: true }); r.api.syncScene(); await settle();
  assert.equal(r.log.asked[0][2], true);
});

test('the page under a course frame keeps its scene moving', () => {
  const r = rig({ tabFrame: '', framed: true });
  assert.ok(r.api.sceneOpts().speed > 0);
});

test('content.js tells a frame what its background is made of: the page publishes it on <html>', () => {
  assert.match(source, /if \(!tabFrame\) setAttr\('data-gz-bg-key', bgSig\);/);
  assert.match(source, /JSON\.stringify\(\[s\.bg, colors, partsOf\(\)\?\.bg, html\.getAttribute\('data-gz-motion'\)\]\)/);
});

// ---- lib/scene-host.js --------------------------------------------------------------------------------------------
const hostSource = read('lib/scene-host.js');
// A frame (frame: true) under a page whose <html> carries key, or the page itself.
const host = ({ frame = true, key = 'k1', layers = [] } = {}) => {
  const listeners = new Map(), frames = [], posted = [], observed = [];
  const pageAttrs = new Map(key == null ? [] : [['data-gz-bg-key', key]]);
  const frameAttrs = new Set(), ownAttrs = new Set();
  const win = {};
  const ctx = {
    addEventListener: (ev, fn) => listeners.set(ev, fn), requestAnimationFrame: (fn) => frames.push(fn),
    location: { origin: 'https://lms' },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(n, o) { observed.push([n, o, this.fn]); } },
    document: {
      body: { name: 'body', setAttribute() {}, removeAttribute() {}, hasAttribute: () => false }, querySelectorAll: (s) => (s.includes('iframe') ? [{ contentWindow: win, getBoundingClientRect: () => ({ left: 272, top: 10 }) }] : layers),
      documentElement: { hasAttribute: () => false, toggleAttribute: (k, v) => { if (v) ownAttrs.add(k); else ownAttrs.delete(k); } },
    },
    parent: { postMessage: (m, o) => posted.push([m, o]), document: { documentElement: { getAttribute: (k) => pageAttrs.get(k) ?? null, hasAttribute: (k) => pageAttrs.has(k) } } },
    frameElement: frame ? { toggleAttribute: (k, v) => { if (v) frameAttrs.add(k); else frameAttrs.delete(k); } } : null,
  };
  ctx.window = ctx; ctx.top = frame ? {} : ctx;
  const H = vm.runInNewContext(hostSource, ctx);
  return { H, listeners, frames, posted, observed, pageAttrs, frameAttrs, ownAttrs, win };
};
const json = (x) => JSON.parse(JSON.stringify(x));

test('scene host: a frame shows the page\'s background when its signature matches and no layer covers its course', () => {
  const h = host();
  assert.equal(h.H.through('k1', true, false, () => {}), true);
  assert.ok(h.frameAttrs.has('data-gz-through'));
  assert.equal(h.H.through('k1', true, true, () => {}), true, 'still see-through while hidden');
  assert.ok(!h.frameAttrs.has('data-gz-through'), 'but the page shows its own strip again');
  for (const sig of [false, '', 'k2']) assert.equal(h.H.through(sig, true, false, () => {}), false, String(sig));
  assert.equal(host({ key: null }).H.through('k1', true, false, () => {}), false);
  const layer = { getClientRects: () => [1], closest: (s) => (s === '.bb-offcanvas-panel' ? layer : null) };
  assert.equal(host({ layers: [layer] }).H.through('k1', true, false, () => {}), false, 'a layer over the course');
  assert.equal(host({ layers: [layer] }).H.through('k1', false, false, () => {}), true, 'Canvas has no layers');
});

test('scene host: a frame listens once, and hears the page change its background', () => {
  const h = host(); let again = 0;
  h.H.through('k1', true, false, () => again++); h.H.through('k1', true, false, () => again++);
  assert.equal(h.observed.length, 1);
  assert.deepEqual(json(h.observed[0][1]), { attributeFilter: ['data-gz-bg-key'] });
  h.observed[0][2](); assert.equal(again, 1);
  assert.ok(h.listeners.has('pointermove'));
});

test('scene host: a see-through frame forwards pointer moves once a frame, while the page\'s scene follows them', () => {
  const h = host(); h.H.through('k1', true, false, () => {});
  const move = h.listeners.get('pointermove');
  move({ clientX: 1, clientY: 1, pointerType: 'mouse' });
  assert.equal(h.frames.length, 0, 'the page\'s scene does not follow the pointer');
  h.pageAttrs.set('data-gz-scene-pointer', '');
  move({ clientX: 5, clientY: 6, pointerType: 'mouse' }); move({ clientX: 7, clientY: 8, pointerType: 'mouse' }); move({ clientX: 9, clientY: 9, pointerType: 'touch' });
  assert.equal(h.frames.length, 1); h.frames[0]();
  assert.deepEqual(json(h.posted), [[{ gzScenePoint: [7, 8] }, 'https://lms']]);
  h.H.through('k1', true, true, () => {}); move({ clientX: 1, clientY: 1, pointerType: 'mouse' });
  assert.equal(h.frames.length, 1, 'not while hidden');
});

test('scene host: the page\'s scene hears its frames\' pointer moves, offset by where the frame sits', () => {
  const h = host({ frame: false }); const points = [];
  const scene = { follows: true, point: (x, y) => points.push([x, y]) };
  h.H.pointer(scene); h.H.pointer(scene);
  assert.ok(h.ownAttrs.has('data-gz-scene-pointer'));
  const relay = h.listeners.get('message');
  relay({ origin: 'https://lms', source: h.win, data: { gzScenePoint: [10, 20] } });
  relay({ origin: 'https://evil', source: h.win, data: { gzScenePoint: [1, 1] } });
  relay({ origin: 'https://lms', source: {}, data: { gzScenePoint: [1, 1] } });
  assert.deepEqual(points, [[282, 30]]);
  h.H.pointer(null); assert.ok(!h.ownAttrs.has('data-gz-scene-pointer'));
  relay({ origin: 'https://lms', source: h.win, data: { gzScenePoint: [10, 20] } });
  assert.equal(points.length, 1);
  const f = host(); f.H.pointer(scene); assert.ok(!f.ownAttrs.has('data-gz-scene-pointer') && !f.listeners.has('message'), 'a frame never relays');
});
