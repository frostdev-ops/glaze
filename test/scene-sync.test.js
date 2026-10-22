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
const block = source.slice(a, b).replace(/import\((chrome\.runtime\.getURL\((?:file|`\$\{file\}[^`]*`)\)(?: \+ `[^`]*`)?)\)/, 'importScene($1, file)');
assert.ok(block.includes('importScene('));

const background = source.match(/background: (\(el\) => \{.*\}),\n/)[1];
const loader = source.slice(source.indexOf('  const loading = new Map();'), source.indexOf("  // Moodle's extras"));
const settle = () => new Promise(setImmediate);
const rig = ({ kind = 'scene', parts = null, glsl = false, needFails = false, enabled = true, solo = true, importFails = 0, startFails = 0, hostFails = null, hostHangs = 0, hostSilent = false, glslHangs = 0, importHangs = 0 } = {}) => {
  const log = { starts: [], updates: [], needs: [], answers: [], held: [], stops: 0, removed: 0, imports: 0, files: [], urls: [], listeners: new Map() };
  const timers = new Map(); let nextTimer = 0;
  let failScene = null;
  const canvas = (tag) => ({ tag, remove() { log.removed++; }, setAttribute() {}, parentNode: null });
  const ctx = vm.createContext({
    solo, ultra: false, isPreview: false, loading: new Map(), docId: 'fixture-document', location: { protocol: 'https:' },
    settings: { enabled }, links: [1], hid: () => false, palette: { '--gz-surface-2': '#202030', '--gz-accent': '#abcdef' },
    html: { hasAttribute: () => false, getAttribute: () => 'normal' },
    worn: { bg: { kind, scene: 'mist', intensity: 50, colors: [] } },
    GZ_SCENE_LOOK: () => ({ dim: 0.3, amount: 0.5, pace: 1 }), GZ_BG_COLORS: () => ['#111111', '#222222', '#333333'],
    document: { hidden: false, body: { append() {}, setAttribute() {}, removeAttribute() {} }, createElement: canvas, querySelectorAll: () => [], addEventListener: (event, fn) => log.listeners.set(event, fn) },
    chrome: { runtime: { id: 'glaze', getURL: (f) => f, sendMessage: async (m) => {
      const file = m.files[0], ran = () => { if (file === 'lib/glsl.js') ctx.GZ_GLSL = {}; else ctx.GZ_SCENE_HOST = { place() {}, clear() {} }; };
      log.needs.push(file);
      // A request the worker sits on: answered (the file run, ok) only when the test calls log.answers[i].
      if (file === 'lib/glsl.js' ? glslHangs-- > 0 : hostHangs-- > 0) {
        if (hostSilent) ran(); // the worker ran the file, and its answer was lost
        return new Promise((ok) => log.answers.push(() => { ran(); ok({ ok: true }); }));
      }
      if (file !== 'lib/glsl.js' && hostFails-- > 0) throw new Error('temporary injection failure');
      ran(); return { ok: true };
    } } },
    importScene: (url, file) => {
      log.imports++; log.files.push(file); log.urls.push(url);
      const mod = { start: (c, live, onFail) => { failScene = onFail; log.starts.push(c); if (startFails-- > 0) throw new Error('temporary WebGL context failure'); return { update: (o) => log.updates.push(o), draw() {}, stop() { log.stops++; } }; } };
      // An import that never settles until the test settles it: log.held[i].ok() or .no().
      if (importHangs-- > 0) return new Promise((ok, no) => log.held.push({ ok: () => ok(mod), no: () => no(new Error('late module failure')) }));
      if (importFails-- > 0) return Promise.reject(new Error('temporary module load failure'));
      return Promise.resolve(mod);
    },
    need: (file, ready) => { if (file === 'lib/scene-host.js') { ctx.GZ_SCENE_HOST = { place() {}, clear() {} }; return Promise.resolve(); } log.needs.push(file); return needFails ? Promise.reject(new Error('no')) : Promise.resolve().then(() => { if (!ready()) ctx.GZ_GLSL = {}; }); },
    applySettings: () => ctx.api.syncScene(), // the settings paint finishes by syncing the scene
    GZ_CTX: { parts: () => ctx.parts },
    parts, GZ_GLSL: glsl ? {} : undefined,
    JSON, Promise, setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(`${hostFails === null && !hostHangs && !glslHangs ? '' : loader}\n${block}; globalThis.api = { syncScene, stopScene, sceneKind, sceneSig, sceneOpts, background: ${background}, state: () => ({ scene, sceneCanvas, sceneFailed, sceneBad }) };`, ctx);
  return { api: ctx.api, log, ctx, timers, retry: async () => { const [id, timer] = [...timers].find(([, timer]) => timer.ms < 60000) || []; assert.ok(timer, 'a recovery attempt must be scheduled'); timers.delete(id); timer.fn(); await settle(); }, fail: (...a) => failScene(...a) };
};
const SHADER = { bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(1.); }' } } };
const LAYERS = { bg: { layers: [{ k: 'noise' }] } };

test('a temporary animation module failure recovers without reloading the page', async () => {
  const r = rig({ importFails: 1 });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  await r.retry();
  assert.equal(r.log.imports, 2, 'discard the rejected module promise');
  assert.equal(r.log.updates.length, 1, 'the animation starts after the transient failure');
  assert.equal(r.api.state().sceneFailed, false);
});

test('a temporary scene-host injection failure recovers within the startup retry budget', async () => {
  const r = rig({ hostFails: 1 });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  await r.retry();
  assert.equal(r.log.needs.length, 2, 'the recovery asks the broker again instead of reusing its rejected promise');
  assert.equal(r.log.updates.length, 1);
  assert.equal(r.api.state().sceneFailed, false);
});

test('a mod background retries a temporary scene-host failure and bounds persistent failures', async () => {
  for (const hostFails of [1, 3]) {
    const r = rig({ hostFails });
    r.api.background({}); await settle();
    await r.retry();
    if (hostFails === 3) await r.retry();
    assert.equal(r.log.needs.length, hostFails === 1 ? 2 : 3);
    assert.equal(r.api.state().sceneFailed, hostFails === 3);
    assert.equal(r.log.imports, 0, 'a mod background does not load the built-in renderer');
    r.api.syncScene(); await settle();
    assert.equal(r.log.needs.length, hostFails === 1 ? 2 : 3, 'a persistent failure stays bounded');
  }
});

test('a scene host request the worker never answers does not hold the background: the startup asks again', async () => {
  const r = rig({ hostHangs: 1 });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  await r.retry(); // the wait for an answer runs out
  r.api.syncScene(); await settle();
  assert.equal(r.log.needs.length, 1, 'syncs meanwhile ask nothing more: the retry does');
  await r.retry();
  assert.equal(r.log.needs.length, 2, 'the retry asks the worker again instead of waiting on the lost request');
  assert.equal(r.log.updates.length, 1);
  assert.equal(r.api.state().sceneFailed, false);
});

test('an answer that comes after the startup gave up still starts the background, once', async () => {
  const r = rig({ hostHangs: 3 });
  r.api.syncScene(); await settle();
  for (let i = 0; i < 5; i++) await r.retry(); // three waits run out, two retries between them
  assert.deepEqual([r.log.needs.length, r.timers.size, r.api.state().sceneFailed], [3, 0, true], 'bounded: given up');
  r.log.answers[0](); await settle(); // the worker wakes and answers the first request
  assert.equal(r.log.starts.length, 1);
  assert.equal(r.api.state().sceneFailed, false);
  r.log.answers[1](); r.log.answers[2](); await settle();
  assert.deepEqual([r.log.starts.length, r.log.updates.length], [1, 1], 'later answers start nothing more');
});

test('an earlier request answered while a retry still waits starts the background at once', async () => {
  const r = rig({ hostHangs: 2 });
  r.api.syncScene(); await settle();
  await r.retry(); await r.retry(); // the first wait runs out; the retry asks again, unanswered too
  assert.equal(r.log.needs.length, 2);
  r.log.answers[0](); await settle();
  assert.equal(r.log.updates.length, 1, 'not held until the retry\'s own wait runs out');
  for (const [id, timer] of [...r.timers]) { r.timers.delete(id); timer.fn(); }
  r.log.answers[1](); await settle();
  assert.deepEqual([r.log.starts.length, r.log.stops, r.timers.size, r.api.state().sceneFailed], [1, 0, 0, false], 'the abandoned wait running out later changes nothing');
});

test('a scene host the worker ran without answering is used by the next attempt, not asked for again', async () => {
  const r = rig({ hostHangs: 1, hostSilent: true });
  r.api.syncScene(); await settle();
  await r.retry(); await r.retry(); // the wait runs out; the retry finds it in
  assert.deepEqual([r.log.needs.length, r.log.updates.length], [1, 1]);
});

test('an animation module import that never settles does not hold the background: it is asked for again at a new URL', async () => {
  const r = rig({ importHangs: 1 });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  await r.retry(); // the wait runs out
  r.api.syncScene(); await settle();
  assert.equal(r.log.imports, 1, 'syncs meanwhile import nothing more: the retry does');
  await r.retry();
  assert.deepEqual([r.log.imports, new Set(r.log.urls).size, r.log.updates.length], [2, 2, 1]);
  assert.deepEqual([r.timers.size, r.api.state().sceneFailed], [0, false]);
});

test('an import that settles after the startup let go of it: in, it starts the background once; failed, it drops nothing', async () => {
  const r = rig({ importHangs: 3 });
  r.api.syncScene(); await settle();
  for (let i = 0; i < 5; i++) await r.retry(); // three waits run out, two retries between them
  assert.deepEqual([r.log.imports, r.log.starts.length, r.api.state().sceneFailed], [3, 0, true]);
  r.log.held[0].ok(); await settle();
  assert.deepEqual([r.log.starts.length, r.api.state().sceneFailed], [1, false], 'the module in after all starts it');
  r.log.held[1].ok(); r.log.held[2].no(); await settle();
  assert.equal(r.log.starts.length, 1, 'later ones start nothing more');
  r.api.stopScene(); r.api.syncScene(); await settle();
  assert.deepEqual([r.log.imports, r.log.starts.length], [3, 2], 'a late failure does not drop the module that came in');
  const q = rig({ importHangs: 1 });
  q.api.syncScene(); await settle();
  await q.retry(); await q.retry();
  q.log.held[0].no(); await settle();
  q.api.stopScene(); q.api.syncScene(); await settle();
  assert.deepEqual([q.log.imports, q.log.starts.length], [2, 2], 'nor the one the retry loaded');
});

test('a course frame shown again while its hidden startup still loads starts one scene', async () => {
  const r = rig({ importHangs: 1 });
  r.api.syncScene();
  r.ctx.hid = () => true; r.api.syncScene();
  r.ctx.hid = () => false; r.api.syncScene();
  r.log.held[0].ok(); await settle();
  assert.deepEqual([r.log.imports, r.log.starts.length, r.timers.size], [1, 1, 0]);
});

test('mod handoffs cancel pending built-in startup and restore the built-in scene on removal', async () => {
  const r = rig(); let removed = 0;
  const mod = { remove() { removed++; } };
  r.api.syncScene();
  r.api.background(mod); await settle();
  assert.equal(r.log.starts.length, 0, 'the pending built-in cannot mount over the mod');
  r.api.background(null); await settle();
  assert.equal(removed, 1);
  assert.equal(r.log.starts.length, 1);
  r.api.background(mod); await settle();
  assert.equal(r.log.stops, 1, 'a running built-in releases its renderer when a mod takes over');
  assert.equal(r.log.imports, 1, 'handoffs retain the successfully loaded module');
});

test('temporary WebGL startup failures retry with the already loaded scene module', async () => {
  const r = rig({ startFails: 1 });
  r.api.syncScene(); r.api.syncScene(); await settle();
  assert.equal(r.timers.size, 1, 'concurrent paints share one startup attempt and recovery timer');
  assert.equal(r.log.removed, 1, 'remove the failed canvas');
  await r.retry();
  assert.equal(r.log.imports, 1, 'a healthy module is retained after renderer startup fails');
  assert.equal(r.log.updates.length, 1);
});

test('persistent startup failures have bounded retries and do not block a different background', async () => {
  const r = rig({ startFails: 3 });
  r.api.syncScene(); await settle();
  await r.retry(); await r.retry();
  assert.equal(r.log.starts.length, 3);
  assert.equal(r.timers.size, 0, 'persistent failures must not retry indefinitely');
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 3);
  r.ctx.worn.bg.kind = 'media'; r.ctx.parts = { bg: { media: { type: 'video', src: 'https://cdn.example.com/loop.webm' } } };
  r.api.syncScene(); await settle();
  assert.equal(r.log.updates.at(-1).kind, 'media', 'WebGL failure cannot disable video backgrounds');
});

test('a background that gave up gets new tries when the page is back on screen', async () => {
  const r = rig({ startFails: 4 });
  r.api.syncScene(); await settle();
  await r.retry(); await r.retry();
  assert.deepEqual([r.log.starts.length, r.timers.size, r.api.state().sceneFailed], [3, 0, true], 'given up');
  const shown = r.log.listeners.get('visibilitychange');
  assert.ok(shown, 'the page coming back on screen is heard');
  r.ctx.document.hidden = true; shown(); await settle();
  assert.equal(r.log.starts.length, 3, 'not while hidden');
  r.ctx.document.hidden = false; shown(); await settle();
  assert.equal(r.log.starts.length, 4, 'a fresh attempt');
  await r.retry();
  assert.equal(r.log.updates.length, 1, 'with fresh tries, it starts');
  shown(); await settle();
  assert.deepEqual([r.log.starts.length, r.log.stops], [5, 0], 'a running background is left alone');
});

test('disabling a failed animation cancels its pending recovery', async () => {
  const r = rig({ startFails: 1 }); r.api.syncScene(); await settle();
  assert.equal(r.timers.size, 1);
  r.ctx.settings.enabled = false; r.api.syncScene();
  assert.equal(r.timers.size, 0);
  r.ctx.settings.enabled = true; r.api.syncScene(); await settle();
  assert.equal(r.log.updates.length, 1, 'enabling gives the animation a fresh chance');
});

test('a new background attempt never reuses module URLs poisoned by previous failures', async () => {
  const r = rig(), actual = r.ctx.importScene, poisoned = new Map(); let healthy = false;
  r.ctx.importScene = (url, file) => {
    if (poisoned.has(url)) return poisoned.get(url);
    const p = healthy ? actual(url, file) : Promise.reject(new Error('cached module failure'));
    poisoned.set(url, p); return p;
  };
  r.api.syncScene(); await settle(); await r.retry(); await r.retry();
  assert.equal(r.api.state().sceneFailed, true);
  healthy = true;
  r.ctx.settings.enabled = false; r.api.syncScene();
  r.ctx.settings.enabled = true; r.api.syncScene(); await settle();
  assert.equal(r.log.updates.length, 1, 'off/on can recover even after every old module URL failed');
  assert.equal(poisoned.size, 4);
});

test('asynchronous player module failures share the bounded startup recovery', async () => {
  const r = rig(); r.api.syncScene(); await settle();
  r.fail('module'); await r.retry();
  r.fail('module'); await r.retry();
  r.fail('module');
  assert.equal(r.timers.size, 0, 'asynchronous initialization must not reset the retry budget');
  assert.equal(r.api.state().sceneBad, '', 'a failed player import is not a refused media file');
});

test('a scene whose context the browser takes back starts again on a new canvas, bounded while it keeps happening', async () => {
  let now = 0;
  const r = rig(); r.ctx.Date = { now: () => now };
  r.api.syncScene(); await settle();
  r.fail('dropped');
  assert.equal(r.api.state().sceneBad, '', 'not a background this device cannot draw');
  assert.equal(r.log.removed, 1, 'the dead canvas goes');
  await r.retry();
  assert.deepEqual([r.log.starts.length, r.log.starts[1] !== r.log.starts[0]], [2, true], 'a new canvas');
  r.fail('dropped'); await r.retry();
  r.fail('dropped');
  assert.deepEqual([r.log.starts.length, r.timers.size, r.api.state().sceneFailed], [3, 0, true], 'taken back at every start: it gives up');
  const q = rig(); q.ctx.Date = { now: () => now };
  q.api.syncScene(); await settle();
  for (let i = 0; i < 4; i++) { now += 61000; q.fail('dropped'); await q.retry(); }
  assert.deepEqual([q.log.starts.length, q.api.state().sceneFailed], [5, false], 'after a minute of drawing, each one is a new start');
});

test('a built-in scene loads lib/scene.js, starts it once, and updates it from then on, as before', async () => {
  const r = rig();
  r.api.syncScene(); r.api.syncScene();
  await settle();
  assert.equal(r.log.starts.length, 1);
  assert.equal(r.log.imports, 1);
  assert.deepEqual(r.log.needs, [], 'a built-in scene needs no shader checker');
  r.api.syncScene();
  assert.equal(r.log.updates.length, 2, 'one shared startup, then an immediate update from the loaded module');
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

test('a shader checker request the worker never answers does not hold the shader: the startup asks again', async () => {
  const r = rig({ kind: 'shader', parts: SHADER, glslHangs: 1 });
  r.api.syncScene(); await settle();
  assert.equal(r.log.starts.length, 0);
  await r.retry(); // the wait runs out
  await r.retry(); // the retry asks again
  assert.equal(r.log.needs.filter((f) => f === 'lib/glsl.js').length, 2, 'not the lost request again');
  assert.deepEqual([r.log.starts.length, r.log.updates[0]?.kind], [1, 'shader']);
  const q = rig({ kind: 'shader', parts: SHADER, glslHangs: 3 });
  q.api.syncScene(); await settle();
  for (let i = 0; i < 5; i++) await q.retry();
  assert.deepEqual([q.log.starts.length, q.timers.size, q.api.state().sceneFailed], [0, 0, true], 'bounded: given up');
  q.log.answers[0](); await settle();
  assert.equal(q.log.starts.length, 1, 'an answer after all starts it');
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
