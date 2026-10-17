// What content.js does with a scene, a shader or layers: syncScene, sliced out and run in a VM with stand-ins, as
// test/ondemand.test.js does for the loader. The parts (GZ_CTX.parts()) are the Look's x, which package A fills in after first
// paint and announces with glaze:parts; lib/scene.js is replaced by a recorder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const a = source.indexOf('  // ---- animated background');
const b = source.indexOf('  // ---- course colors and tint', a);
assert.ok(a > 0 && b > a, 'markers');
// The block imports lib/scene.js (or lib/scene-media.js) with import(), which a VM can't do without flags: the recorder stands in by name.
const block = source.slice(a, b).replace('import(chrome.runtime.getURL(file))', 'importScene(file)');
assert.ok(block.includes('importScene(file)'));

const settle = () => new Promise(setImmediate);
const rig = ({ kind = 'scene', parts = null, glsl = false, needFails = false, enabled = true, solo = true } = {}) => {
  const log = { starts: [], updates: [], needs: [], stops: 0, removed: 0, imports: 0, files: [], listeners: new Map() };
  let failScene = null;
  const canvas = (tag) => ({ tag, remove() { log.removed++; }, setAttribute() {}, parentNode: null });
  const ctx = vm.createContext({
    solo, ultra: false, location: { protocol: 'https:' },
    settings: { enabled }, links: [1], hid: () => false, palette: { '--gz-surface-2': '#202030', '--gz-accent': '#abcdef' },
    html: { hasAttribute: () => false, getAttribute: () => 'normal' },
    worn: { bg: { kind, scene: 'mist', intensity: 50, colors: [] } },
    GZ_SCENE_LOOK: () => ({ dim: 0.3, amount: 0.5, pace: 1 }), GZ_BG_COLORS: () => ['#111111', '#222222', '#333333'],
    document: { body: { append() {} }, createElement: canvas, querySelectorAll: () => [], addEventListener: (event, fn) => log.listeners.set(event, fn) },
    chrome: { runtime: { id: 'glaze', getURL: (f) => f } },
    importScene: (file) => { log.imports++; log.files.push(file); return Promise.resolve({ start: (c, live, onFail) => { failScene = onFail; log.starts.push(c); return { update: (o) => log.updates.push(o), draw() {}, stop() { log.stops++; } }; } }); },
    need: (file, ready) => { log.needs.push(file); return needFails ? Promise.reject(new Error('no')) : Promise.resolve().then(() => { if (!ready()) ctx.GZ_GLSL = {}; }); },
    GZ_CTX: { parts: () => ctx.parts },
    parts, GZ_GLSL: glsl ? {} : undefined,
    JSON, Promise,
  });
  vm.runInContext(`${block}; globalThis.api = { syncScene, stopScene, sceneKind, sceneSig, sceneOpts, state: () => ({ scene, sceneCanvas, sceneFailed, sceneBad }) };`, ctx);
  return { api: ctx.api, log, ctx, fail: (...a) => failScene(...a) };
};
const SHADER = { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(1.); }' } } };
const LAYERS = { bg: { layers: [{ k: 'noise' }] } };

test('a built-in scene loads lib/scene.js, starts it once, and updates it from then on, as before', async () => {
  const r = rig();
  r.api.syncScene(); r.api.syncScene();
  await settle();
  assert.equal(r.log.starts.length, 1);
  assert.equal(r.log.imports, 1);
  assert.deepEqual(r.log.needs, [], 'a built-in scene needs no shader checker');
  r.api.syncScene();
  assert.equal(r.log.updates.length, 3, 'the third update is immediate: the module is here');
  const o = r.log.updates[0];
  assert.equal(o.kind, 'scene'); assert.equal(o.name, 'mist');
  assert.equal(o.ground, '#202030'); assert.equal(o.palette['--gz-accent'], '#abcdef');
  assert.equal(o.x, null, 'no parts, and none needed');
});

test('a shader Look with no parts yet draws nothing, and the gradient shows; the parts arriving draw it', async () => {
  const r = rig({ kind: 'shader' });
  r.api.syncScene();
  await settle();
  assert.deepEqual([r.log.starts.length, r.log.imports, r.log.needs.length], [0, 0, 0], 'nothing is even loaded');
  r.ctx.parts = SHADER;
  r.log.listeners.get('glaze:parts')();
  await settle();
  assert.equal(r.log.starts.length, 1);
  assert.deepEqual(r.log.needs, ['lib/glsl.js'], 'the checker is loaded on demand, first');
  assert.equal(r.log.updates[0].kind, 'shader');
  assert.equal(r.log.updates[0].x.bg.shader.src, SHADER.bg.shader.src);
});

test('with the checker already here, a shader does not ask again; a built-in scene switching to a shader waits for it', async () => {
  const r = rig({ kind: 'scene', glsl: true });
  r.api.syncScene(); await settle();
  r.ctx.worn.bg.kind = 'shader'; r.ctx.parts = SHADER;
  r.api.syncScene(); await settle();
  assert.deepEqual(r.log.needs, []);
  assert.equal(r.log.updates.at(-1).kind, 'shader');
  const q = rig({ kind: 'scene' });
  q.api.syncScene(); await settle();
  q.ctx.worn.bg.kind = 'shader'; q.ctx.parts = SHADER;
  q.api.syncScene();
  assert.equal(q.log.updates.length, 1, 'not updated before the checker is in: the scene would refuse the shader');
  await settle();
  assert.deepEqual(q.log.needs, ['lib/glsl.js']);
  assert.equal(q.log.updates.at(-1).kind, 'shader');
});

test('if the checker will not load the shader is not drawn, and the built-in scenes are not given up on', async () => {
  const r = rig({ kind: 'shader', parts: SHADER, needFails: true });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  assert.equal(r.api.state().sceneFailed, false);
});

test('layers draw once they have layers', async () => {
  const r = rig({ kind: 'layers' });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  r.ctx.parts = { bg: { layers: [] } };
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0, 'an empty list is nothing');
  r.ctx.parts = LAYERS;
  r.log.listeners.get('glaze:parts')(); await settle();
  assert.equal(r.log.starts.length, 1);
  assert.deepEqual(r.log.needs, [], 'layers are Glaze\'s own: no checker');
  assert.equal(r.log.updates[0].x, LAYERS);
});

test('the parts going away takes the scene down to the gradient', async () => {
  const r = rig({ kind: 'shader', parts: SHADER });
  r.api.syncScene(); await settle();
  assert.ok(r.api.state().scene);
  r.ctx.parts = null;
  r.log.listeners.get('glaze:parts')();
  assert.deepEqual([r.api.state().scene, r.log.stops, r.log.removed], [null, 1, 1]);
});

test('a background this device can\'t draw stays the gradient until the Look changes, then tries again', async () => {
  const r = rig({ kind: 'shader', parts: SHADER });
  r.api.syncScene(); await settle();
  r.fail('compile', [{ line: 1, message: 'no' }]);
  assert.equal(r.api.state().scene, null);
  assert.equal(r.log.removed, 1);
  const starts = r.log.starts.length;
  r.api.syncScene(); r.log.listeners.get('glaze:parts')(); await settle();
  assert.equal(r.log.starts.length, starts, 'not asked to fail again on every sync');
  r.ctx.parts = { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(0.); }' } } };
  r.log.listeners.get('glaze:parts')(); await settle();
  assert.equal(r.log.starts.length, starts + 1, 'another shader gets its chance');
  r.fail('budget', []);
  r.ctx.worn.bg.kind = 'scene';
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, starts + 2, 'so does a built-in scene');
  assert.equal(r.api.state().sceneFailed, false, 'the page\'s scenes are not given up on');
});

test('off, a hidden course tab, or a page that is not its own: no scene', async () => {
  for (const [name, r] of [['disabled', rig({ enabled: false })], ['a framed page', rig({ solo: false })], ['a solid background', rig({ kind: 'solid' })], ['no links', rig()], ['hidden', rig()]]) {
    if (name === 'no links') r.ctx.links.length = 0;
    if (name === 'hidden') r.ctx.hid = () => true;
    r.api.syncScene(); await settle();
    assert.deepEqual([name, r.log.starts.length, r.log.imports], [name, 0, 0]);
  }
  const live = rig();   // and one that was running is taken down
  live.api.syncScene(); await settle();
  live.ctx.hid = () => true;
  live.api.syncScene();
  assert.deepEqual([live.api.state().scene, live.log.stops], [null, 1]);
});

test('a Glaze reloaded under the page: nothing happens, the last frame stays', async () => {
  const r = rig({ kind: 'scene' });
  r.api.syncScene(); await settle();
  r.ctx.chrome.runtime.id = undefined;
  r.api.syncScene();
  assert.equal(r.log.updates.length, 1);
  assert.equal(r.log.stops, 0);
});

test('the fallback gradient\'s dim follows intensity for all four kinds', () => {
  assert.ok(source.includes("const look = (kind === 'scene' || kind === 'shader' || kind === 'layers' || kind === 'media') && GZ_SCENE_LOOK(s.bg.intensity);"));
});

test('pending module loads recheck whether the scene is still allowed', async () => {
  for (const change of [r => { r.ctx.settings.enabled = false; }, r => { r.ctx.chrome.runtime.id = undefined; }]) {
    const r = rig();
    r.api.syncScene();
    change(r);
    r.api.syncScene();
    await settle();
    assert.equal(r.log.starts.length, 0);
  }
});

const MEDIA = { bg: { media: { type: 'video', src: 'https://cdn.example.com/loop.webm' } } };

test('a media Look loads its own module (never three.js), draws into a div, and waits for its parts', async () => {
  const r = rig({ kind: 'media' });
  r.api.syncScene(); await settle();
  assert.deepEqual([r.log.starts.length, r.log.imports], [0, 0], 'no media yet: nothing is even loaded');
  r.ctx.parts = MEDIA;
  r.log.listeners.get('glaze:parts')(); await settle();
  assert.deepEqual(r.log.files, ['lib/scene-media.js']);
  assert.equal(r.log.starts.length, 1);
  assert.equal(r.log.starts[0].tag, 'div');
  assert.deepEqual(r.log.needs, [], 'no shader checker');
  assert.equal(r.log.updates[0].kind, 'media');
  assert.equal(r.log.updates[0].x, MEDIA);
  assert.equal(r.log.updates[0].ground, '#202030');
  r.api.syncScene();
  assert.equal(r.log.updates.length, 2, 'then updated in place');
  assert.equal(r.log.imports, 1);
});

test('switching between media and a scene stops the one and starts the other, each from its own module', async () => {
  const r = rig({ kind: 'scene' });
  r.api.syncScene(); await settle();
  assert.deepEqual([r.log.files, r.log.starts[0].tag], [['lib/scene.js'], 'canvas']);
  r.ctx.worn.bg.kind = 'media'; r.ctx.parts = MEDIA;
  r.api.syncScene(); await settle();
  assert.equal(r.log.stops, 1, 'the three.js scene is taken down');
  assert.deepEqual([r.log.files, r.log.starts.length, r.log.starts[1].tag], [['lib/scene.js', 'lib/scene-media.js'], 2, 'div']);
  r.ctx.worn.bg.kind = 'layers'; r.ctx.parts = LAYERS;
  r.api.syncScene(); await settle();
  assert.equal(r.log.stops, 2);
  assert.deepEqual([r.log.files, r.log.starts.at(-1).tag, r.log.starts.length], [['lib/scene.js', 'lib/scene-media.js'], 'canvas', 3], 'each module is imported once, and the first is reused');
});

test('a media file that cannot be shown leaves the gradient until the Look changes', async () => {
  const r = rig({ kind: 'media', parts: MEDIA });
  r.api.syncScene(); await settle();
  r.fail('load');
  assert.deepEqual([r.api.state().scene, r.log.removed], [null, 1]);
  const starts = r.log.starts.length;
  r.api.syncScene(); r.log.listeners.get('glaze:parts')(); await settle();
  assert.equal(r.log.starts.length, starts, 'not asked again for the same Look');
  r.ctx.parts = { bg: { media: { type: 'video', src: 'https://cdn.example.com/other.webm' } } };
  r.log.listeners.get('glaze:parts')(); await settle();
  assert.equal(r.log.starts.length, starts + 1, 'another file gets its chance');
});

test('a module load that finishes after the kind changed does not start the wrong scene', async () => {
  const r = rig({ kind: 'media', parts: MEDIA });
  r.api.syncScene();
  r.ctx.worn.bg.kind = 'scene';
  await settle();
  assert.equal(r.log.starts.length, 0);
});
