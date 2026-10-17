// lib/scene.js in a VM (test/helpers/scene-engine.cjs): the budget guard on a fake GPU whose frame time the test sets, a
// student's shader (checked before any GL; what failure reports), and layers. The real compiler and GPU are in
// scripts/scene-check.mjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { engine } = require('./helpers/scene-engine.cjs');
const GLSL = require('../lib/glsl.js');
const I = require('../lib/i18n.js');

const base = { kind: 'scene', name: 'graveyard', ground: '#101020', colors: ['#111111', '#222222', '#333333'], dim: 0.1, amount: 0.5, speed: 1 };
const MIN = 'vec4 scene(vec2 uv) { return vec4(uv, 0., 1.); }';
const shader = (src = MIN, o = {}) => ({ ...base, kind: 'shader', name: undefined, x: { bg: { shader: { src } } }, ...o });
const layersOf = (layers, o = {}) => ({ ...base, kind: 'layers', name: undefined, palette: { '--gz-accent': '#abcdef' }, x: { bg: { layers } }, ...o });
const fixture = (name) => fs.readFileSync(path.join(__dirname, '../assets/shaders', `${name}.glsl`), 'utf8');
// Objects made inside the VM have its own Object.prototype; deepEqual wants this realm's.
const plain = (v) => JSON.parse(JSON.stringify(v));
// Run n animation frames, each with its fence judged.
const frames = async (e, n, dt = 34) => { for (let i = 0; i < n && e.frames.size; i++) { e.tick(dt); await e.pump(); } };
const redraw = async (e, scene, n) => { for (let i = 0; i < n; i++) { scene.draw(); await e.pump(); } };
// A scene with its reports collected.
const watch = (e, canvas = {}) => {
  const w = { steps: [], fails: [] };
  w.scene = e.start(canvas, () => true, (...a) => w.fails.push(a), (s) => w.steps.push(s));
  w.levels = () => w.steps.map((s) => s.level);
  return w;
};

// ---- the budget guard -----------------------------------------------------------------------------------------------------

test('a scene under budget is never stepped down, and is measured on only some frames', async () => {
  const e = engine({ latency: 5 }), w = watch(e);
  w.scene.update(base); await e.pump();
  await frames(e, 120);
  assert.deepEqual(w.steps, []);
  assert.deepEqual(w.fails, []);
  assert.deepEqual(e.renderer.size, [768, 540], 'graveyard keeps its own 0.6');
  assert.ok(e.made.fences >= 8 && e.made.fences < 20, `${e.made.fences} fences in 121 frames: every one of the first 8, then one in 40`);
});

test('over budget: a smaller scale after the median of five frames, then it stays if that is enough', async () => {
  const e = engine({ latency: (_, [px]) => px * 0.03 }), w = watch(e); // 23 ms at 768 wide, 7.7 at 256
  w.scene.update(base); await e.pump();
  await frames(e, 8);
  assert.deepEqual(w.steps.map((s) => [s.level, s.scale, s.still, s.why]), [[1, 0.2, false, 'over']]);
  assert.ok(w.steps[0].ms > 12, `measured ${w.steps[0].ms}`);
  assert.deepEqual(e.renderer.size, [256, 180], 'resized to 0.2 at once');
  await frames(e, 60);
  assert.equal(w.steps.length, 1, 'at 0.2 it is 7.7 ms: under budget, so it stays');
  assert.equal(e.frames.size, 1, 'and keeps animating');
});

test('still over: one still frame at 0.2 and no more animation; drawn again, if even that is too slow, the gradient', async () => {
  const e = engine({ latency: 20 }), w = watch(e);
  w.scene.update(base); await e.pump();
  await frames(e, 30);
  assert.deepEqual(w.steps.map((s) => [s.level, s.scale, s.still]), [[1, 0.2, false], [2, 0.2, true]]);
  assert.deepEqual([e.frames.size, w.fails.length], [0, 0], 'the picture stays; nothing animates');
  const drawn = e.counts.draws;
  e.advance(10000);
  assert.equal(e.counts.draws, drawn);
  await redraw(e, w.scene, 10);
  assert.deepEqual(w.levels(), [1, 2, 3]);
  assert.equal(w.fails.length, 1);
  const [why, errors, info] = w.fails[0];
  assert.equal(why, 'budget');
  assert.match(errors[0].message, /20 ms a frame/);
  assert.deepEqual([info.level, info.ms], [3, 20]);
  assert.equal(e.counts.disposed, 1, 'stopped');
  const after = e.counts.draws;
  w.scene.update(base); w.scene.draw();
  assert.equal(e.counts.draws, after, 'a failed scene draws no more');
});

test('one frame over 100 ms steps down at once, without waiting for five', async () => {
  const e = engine({ latency: (n) => (n === 4 ? 150 : 4) }), w = watch(e);
  w.scene.update(base); await e.pump();
  await frames(e, 6);
  assert.deepEqual(w.steps.map((s) => [s.level, s.why, s.ms]), [[1, 'stalled', 100]], 'counted as the 100 ms cap');
});

test('a blocked main thread is not the GPU: occasional late readings are ignored, a constant run of them is a slow page', async () => {
  const e = engine({ latency: 3 }), w = watch(e);
  w.scene.update(base); await e.pump();
  for (let i = 0; i < 60; i++) { e.tick(34); if (i % 3 === 0) e.advance(80); await e.pump(); }   // one fence in three is found 80 ms late: the page was busy
  assert.deepEqual(w.steps, []);
  assert.deepEqual(w.fails, []);
  const slow = engine({ latency: 80 }), ws = watch(slow);   // the same lateness, but it was the GPU
  ws.scene.update(base); await slow.pump(); await frames(slow, 8);
  assert.deepEqual(ws.levels(), [1]);
  // Late on every sampled frame for 3 s, as a CPU renderer leaves the main thread: the page is slow, not unlucky.
  const starved = engine({ latency: 3 }), wv = watch(starved);
  wv.scene.update(base); await starved.pump();
  for (let i = 0; i < 40; i++) { starved.tick(34); starved.advance(80); await starved.pump(); }
  assert.deepEqual(wv.levels(), [1]);
  assert.equal(wv.steps[0].why, 'late');
  assert.ok(wv.steps[0].ms > 12);
});

test('back from a hidden tab the first frames are cold: measured afresh, and not counted', async () => {
  let cold = 0;
  const e = engine({ latency: () => (cold-- > 0 ? 60 : 4) }), w = watch(e);
  w.scene.update(base); await e.pump();
  await frames(e, 80);
  const steady = e.made.fences;
  await frames(e, 20);
  assert.ok(e.made.fences - steady <= 1, 'settled: about one frame in 40');
  cold = 2;
  e.advance(20000); e.docListeners.get('visibilitychange')();   // the tab was hidden for 20 s and is shown again; the frames after it are slow
  const before = e.made.fences;
  await frames(e, 8);
  assert.ok(e.made.fences - before >= 7, 'sampled on every frame again');
  assert.deepEqual(w.steps, [], 'and the slow ones were warm-up');
});

test('a scene held still is not measured: one frame, no fence; it is once it animates', async () => {
  const e = engine({ latency: 4 }), scene = e.start({});
  scene.update({ ...base, speed: 0 }); await e.pump();
  assert.deepEqual([e.counts.draws, e.made.fences, e.frames.size], [1, 0, 0]);
  scene.update({ ...base, speed: 1 });
  assert.equal(e.made.fences, 1);
});

test('a context without fences runs unguarded rather than not at all', () => {
  const e = engine({ latency: 4 }); delete e.gl.fenceSync;
  const scene = e.start({}); scene.update(base);
  assert.deepEqual([e.counts.draws, e.frames.size], [1, 1]);
});

test('a fence that throws refuses an unmeasured shader', async () => {
  const e = engine({ latency: 4, glsl: GLSL }), canvas = e.canvas(), w = watch(e, canvas);
  e.gl.fenceSync = () => { throw new Error('nope'); };
  w.scene.update(shader());
  await e.pump();
  assert.deepEqual(e.renderer.size, [64, 45], 'no full-size draw');
  assert.equal(canvas.style.visibility, 'hidden');
  assert.equal(w.fails[0][0], 'budget');
});

test('a sampled frame still on the GPU when its scene is replaced or cut off moves nothing', async () => {
  let slow = false;
  const latency = () => (slow ? 150 : 4);
  // Replaced by another scene: the old guard's late reading must not resize the new one.
  let e = engine({ latency }), w = watch(e);
  w.scene.update(base); await e.pump(); await frames(e, 5);   // past warm-up
  slow = true; e.tick(34);                                     // a slow sampled frame is in flight
  w.scene.update({ ...base, name: 'contours' });
  await e.pump();
  assert.deepEqual(w.steps, []);
  assert.deepEqual(plain(e.renderer.size), [640, 450], 'contours at its own 0.5');
  // Cut off from its caller: the last frame stays on screen, so the canvas must not be resized under it.
  slow = false;
  let live = true;
  e = engine({ latency });
  const steps = [], scene = e.start({}, () => live, () => {}, (s) => steps.push(s));
  scene.update(base); await e.pump(); await frames(e, 5);
  slow = true; e.tick(34);
  const size = plain(e.renderer.size);
  live = false; scene.update(base);
  await e.pump();
  assert.deepEqual(plain(e.renderer.size), size);
  assert.deepEqual(steps, []);
});

// ---- a student's shader ----------------------------------------------------------------------------------------------------

test('a shader that passes the checker is drawn by a raw ESSL 1.00 material with the wrapped source', () => {
  const e = engine({ glsl: GLSL }), scene = e.start({});
  scene.update(shader(fixture('aurora')));
  assert.equal(e.made.materials.length, 1);
  const m = e.made.materials[0];
  assert.equal(m.glslVersion, '100');
  assert.equal(m.fragmentShader, GLSL.wrap(fixture('aurora')));
  assert.equal(m.vertexShader, GLSL.VERT);
  assert.equal(typeof e.renderer.debug.onShaderError, 'function', 'compile errors are listened for');
  scene.update({ ...base, name: 'mist' });
  assert.equal(e.renderer.debug.onShaderError, null, 'a built-in keeps three\'s own log');
});

test('a refused shader never reaches GL, and the caller hears why with lines in the student\'s own source', async () => {
  const e = engine({ latency: 4, glsl: GLSL }), w = watch(e);
  w.scene.update(shader(`// one\n#extension GL_OES_standard_derivatives : enable\n${MIN}`));
  await e.pump();
  assert.equal(e.made.materials.length, 0, 'no material, so no shaderSource');
  assert.deepEqual([e.counts.draws, e.made.fences, e.frames.size], [0, 0, 0]);
  assert.equal(w.fails.length, 1);
  assert.equal(w.fails[0][0], 'refused');
  assert.equal(w.fails[0][1][0].line, 2);
  assert.match(I.t(w.fails[0][1][0].message, w.fails[0][1][0].vars), /#extension/);
  assert.equal(e.counts.disposed, 1, 'the scene stopped itself');
});

test('even when the checker is not loaded a shader is refused, not drawn', async () => {
  const e = engine({ latency: 4 }), w = watch(e);
  w.scene.update(shader());
  await e.pump();
  assert.equal(e.made.materials.length, 0);
  assert.equal(w.fails[0][0], 'refused');
  assert.match(w.fails[0][1][0].message, /not loaded/);
});

test('nothing to draw is a failure, not a built-in scene in its place', async () => {
  for (const o of [{ kind: 'shader' }, { kind: 'shader', x: { bg: { shader: {} } } }, { kind: 'shader', x: { bg: { shader: { src: 5 } } } }, { kind: 'layers' }, { kind: 'layers', x: { bg: { layers: [] } } }, { kind: 'layers', x: { bg: { layers: [{ k: 'bogus' }, null, 5] } } }]) {
    const e = engine({ glsl: GLSL }), w = watch(e);
    w.scene.update({ ...base, ...o });
    await e.pump();
    assert.equal(w.fails.length, 1, JSON.stringify(o));
    assert.equal(w.fails[0][0], 'empty');
    assert.deepEqual([e.made.materials.length, e.counts.draws], [0, 0]);
  }
});

test('a shader this device\'s compiler rejects reports the compiler\'s lines, once, and stops', async () => {
  const e = engine({ latency: 4, glsl: GLSL }), w = watch(e);
  w.scene.update(shader(`// a\n// b\n${MIN}`)); await e.pump();
  const gl = { getShaderInfoLog: () => "ERROR: 0:3: 'i' : Loop index cannot be compared with non-constant expression\nERROR: 0:40: 'x' : in the wrapper", getProgramInfoLog: () => '' };
  e.renderer.debug.onShaderError(gl, {}, {}, {});
  e.renderer.debug.onShaderError(gl, {}, {}, {});
  assert.equal(w.fails.length, 0, 'deferred: three is still inside render()');
  await e.pump();
  assert.equal(w.fails.length, 1);
  assert.equal(w.fails[0][0], 'compile');
  assert.deepEqual(w.fails[0][1].map((x) => x.line), [3, 0]);
  assert.equal(e.counts.disposed, 1);
  const none = engine({ glsl: GLSL }), w2 = watch(none);
  w2.scene.update(shader()); none.renderer.debug.onShaderError({ getShaderInfoLog: () => '', getProgramInfoLog: () => 'link trouble' }, {}, {}, {});
  await none.pump();
  assert.match(I.t(w2.fails[0][1][0].message, w2.fails[0][1][0].vars), /link trouble/, 'a link failure still says something');
});

test('in the editor\'s preview the page above is told each step and why a background failed; a real page says nothing', async () => {
  const e = engine({ latency: (_, [px]) => px * 0.03, preview: true }), w = watch(e);
  w.scene.update(base); await e.pump();
  await frames(e, 8);
  assert.equal(e.posted.length, 1);
  assert.equal(e.posted[0][1], 'chrome-extension://glaze');
  assert.deepEqual(Object.keys(e.posted[0][0]), ['gzSceneStep']);
  assert.deepEqual(plain(e.posted[0][0].gzSceneStep), plain(w.steps[0]));
  const f = engine({ glsl: GLSL, preview: true }), wf = watch(f);
  wf.scene.update(shader('uniform float k;'));
  await f.pump();
  assert.deepEqual(f.posted.map((p) => Object.keys(p[0])), [['gzSceneFailed']]);
  assert.equal(f.posted[0][0].gzSceneFailed.why, 'refused');
  assert.ok(f.posted[0][0].gzSceneFailed.errors.some((x) => x.line === 1 && /uniform/.test(I.t(x.message, x.vars))));
  const page = engine({ glsl: GLSL }), wp = watch(page);
  wp.scene.update(shader('uniform float k;')); await page.pump();
  assert.equal(wp.fails.length, 1);
  assert.deepEqual(page.posted, []);
});

test('a lost context takes a shader to the gradient at once, for good; a built-in or layers are left to three', async () => {
  const e = engine({ latency: 4, glsl: GLSL }), w = watch(e);
  w.scene.update(shader(fixture('liquid'))); await e.pump();
  e.canvasListeners.get('webglcontextlost')();
  await e.pump();
  assert.equal(w.fails.length, 1);
  assert.equal(w.fails[0][0], 'lost');
  assert.equal(e.counts.disposed, 1);
  assert.equal(e.canvasListeners.size, 0);
  const b = engine({ latency: 4 }), wb = watch(b);
  wb.scene.update(base); await b.pump();
  b.canvasListeners.get('webglcontextlost')();
  await b.pump();
  assert.deepEqual([wb.fails.length, b.counts.disposed, b.frames.size], [0, 0, 1], 'still drawing, as three restores it');
  const lay = engine({ latency: 4 }), wl = watch(lay);
  wl.scene.update(layersOf([{ k: 'noise' }])); lay.canvasListeners.get('webglcontextlost')();
  await lay.pump();
  assert.equal(wl.fails.length, 0, 'layers hold no student code');
});

test('a shader starts with a hidden 72x45 probe frame, then draws at 0.6', async () => {
  const e = engine({ latency: 3, glsl: GLSL }), canvas = e.canvas(), w = watch(e, canvas);
  w.scene.update(shader(fixture('starfield')));
  assert.deepEqual(e.renderer.size, [64, 45], 'the probe');
  assert.equal(canvas.style.visibility, 'hidden');
  assert.equal(e.frames.size, 1, 'a second probe frame is asked for');
  await e.pump();
  await frames(e, 1);
  assert.deepEqual(w.steps.map((s) => [s.level, s.why]), [[0, 'probe']]);
  assert.deepEqual(e.renderer.size, [768, 540]);
  assert.equal(canvas.style.visibility, '', 'shown once it is measured');
});

test('motion off: the probe frames, one still frame, then nothing', async () => {
  const e = engine({ latency: 3, glsl: GLSL }), w = watch(e);
  w.scene.update(shader(fixture('aurora'), { speed: 0 }));
  await e.pump();
  await frames(e, 1);
  assert.equal(e.counts.draws, 3, 'two probe frames and the picture');
  assert.equal(e.frames.size, 0, 'no animation frames asked for any more');
  assert.deepEqual(e.renderer.size, [768, 540]);
  e.advance(5000);
  assert.equal(e.counts.draws, 3);
  assert.deepEqual(w.levels(), [0]);
});

test('the probe decides: a slowish one starts small, a slow one gets a still frame, a hopeless one the gradient', async () => {
  let e = engine({ latency: 20, glsl: GLSL }), w = watch(e);
  w.scene.update(shader()); await e.pump();
  await frames(e, 3);
  assert.deepEqual(w.steps.map((s) => [s.level, s.why]), [[1, 'probe']]);
  assert.deepEqual([plain(e.renderer.size), e.frames.size], [[256, 180], 1], 'at 0.2, still animating');
  e = engine({ latency: 60, glsl: GLSL }); w = watch(e);
  w.scene.update(shader()); await e.pump();
  await frames(e, 3);
  assert.deepEqual(w.steps.map((s) => [s.level, s.why]), [[2, 'probe']]);
  assert.deepEqual([w.fails.length, plain(e.renderer.size), e.frames.size], [0, [256, 180], 0], 'one still frame at 0.2');
  e = engine({ latency: 300, glsl: GLSL }); w = watch(e);
  w.scene.update(shader()); await e.pump();
  await frames(e, 3);
  assert.deepEqual(w.steps.map((s) => [s.level, s.why]), [[3, 'probe']]);
  assert.deepEqual(w.fails.map((f) => f[0]), ['budget']);
  e = engine({ latency: 5000, glsl: GLSL }); w = watch(e);
  w.scene.update(shader()); await e.pump(2000);
  assert.deepEqual(w.steps.map((s) => s.why), ['probe'], 'an absurd first probe frame is enough');
  assert.equal(w.fails.length, 1);
});

test('a shader\'s source change is a new scene with a new probe; the same source updating is not', async () => {
  const e = engine({ latency: 3, glsl: GLSL }), w = watch(e);
  w.scene.update(shader()); await e.pump(); await frames(e, 2);
  const made = e.made.materials.length;
  w.scene.update(shader(MIN, { amount: 0.9, colors: ['#ffffff', '#000000', '#ff0000'] }));
  assert.equal(e.made.materials.length, made, 'colours and intensity are uniforms');
  assert.equal(e.counts.material, 0);
  w.scene.update(shader(`${MIN}\n// edited`));
  assert.equal(e.made.materials.length, made + 1);
  assert.equal(e.counts.material, 1, 'the old material was disposed');
  assert.deepEqual(e.renderer.size, [64, 45], 'probing again');
});

// ---- layers ----------------------------------------------------------------------------------------------------------------

test('a blocking probe submission is measured before any full-size frame', async () => {
  const e = engine({ latency: 1, submitMs: 300, glsl: GLSL }), w = watch(e);
  w.scene.update(shader()); await e.pump(); await frames(e, 2);
  assert.equal(w.fails.length, 1);
  assert.equal(w.fails[0][0], 'budget');
  assert.equal(e.counts.draws, 1, 'only the probe reached GL');
});

test('a probe never promotes after repeated main-thread jank or unavailable fences', async () => {
  const e = engine({ latency: 1, glsl: GLSL }), w = watch(e);
  w.scene.update(shader());
  for (let i = 0; i < 12 && e.frames.size; i++) { e.advance(80); await e.pump(); if (e.frames.size) e.tick(); }
  assert.equal(w.fails.length, 1);
  assert.ok(w.steps.every(s => s.scale === 0), 'no visible/full-size frame was authorized');
  for (const method of [() => null, () => { throw Error('no fence'); }]) {
    const f = engine({ latency: 1, glsl: GLSL }), wf = watch(f);
    f.gl.fenceSync = method;
    wf.scene.update(shader()); await f.pump();
    assert.equal(wf.fails.length, 1);
    assert.equal(f.counts.draws, 1);
  }
});

test('a custom shader cannot keep running when fences disappear after its probe', async () => {
  const e = engine({ latency: 1, glsl: GLSL }), w = watch(e);
  w.scene.update(shader()); await e.pump(); await frames(e, 1);
  assert.deepEqual(w.levels(), [0]);
  e.gl.fenceSync = () => null;
  w.scene.draw(); await e.pump();
  assert.equal(w.fails[0]?.[0], 'budget');
  assert.equal(e.frames.size, 0);
});

test('in-flight sampled frames do not queue more draws', async () => {
  const e = engine({ latency: 20 }), w = watch(e);
  w.scene.update(base);
  const before = e.counts.draws;
  w.scene.draw(); w.scene.update(base); e.listeners.get('resize')();
  assert.equal(e.counts.draws, before, 'draw, update and resize all respect the fence');
  await e.pump();
  w.scene.stop();
});

test('hidden scenes do not draw, and a still shader resumes its probe on return', async () => {
  const f = engine({ latency: 3, glsl: GLSL }), wf = watch(f);
  f.document.hidden = true;
  wf.scene.update(shader(MIN, { speed: 0 }));
  assert.equal(f.counts.draws, 0);
  f.document.hidden = false; f.docListeners.get('visibilitychange')();
  await f.pump(); await frames(f, 2);
  assert.equal(f.counts.draws, 3, 'on return the still shader completes its probe');
});

test('stopping a sampled scene deletes its fence and closes both polling ports', async () => {
  const e = engine({ latency: 20 }), w = watch(e);
  w.scene.update(base); w.scene.stop(); await e.pump();
  assert.equal(e.made.deletedFences, 1);
  assert.equal(e.made.closedPorts, 2);
});

test('layers are drawn bottom first, one clear, each with its own blend', () => {
  const e = engine(), scene = e.start({});
  scene.update(layersOf([{ k: 'scene', name: 'mist', amount: 80, blend: 'normal' }, { k: 'noise', blend: 'add' }, { k: 'gradient', blend: 'screen', c: ['accent', '#ff0000'] }, { k: 'particles', blend: 'multiply', count: 30 }], { speed: 0 }));
  assert.equal(e.made.materials.length, 4);
  assert.deepEqual(e.made.materials.map((m) => [m.blendSrc, m.blendDst]), [[201, 206], [201, 201], [201, 204], [208, 206]]);
  assert.ok(e.made.materials.every((m) => m.blending === 5 && m.blendEquation === 100 && m.transparent));
  assert.equal(e.renderer.autoClear, false);
  assert.deepEqual([e.counts.draws, e.made.clears], [4, 1]);
  assert.deepEqual(e.made.renderOrder.map((o) => o.material), e.made.materials, 'bottom first');
  assert.match(e.made.materials[0].fragmentShader, /#define main gz_main[\s\S]*#undef main\nvoid main\(\) \{ gz_main\(\);/, 'the scene\'s own shader, premultiplied by the amount');
});

test('a single scene layer is drawn the way the scene is: one render call and the clear left to it', () => {
  const e = engine(), scene = e.start({});
  scene.update(layersOf([{ k: 'scene', name: 'mist' }], { speed: 0 }));
  assert.deepEqual([e.counts.draws, e.made.clears, e.renderer.autoClear], [1, 0, true]);
});

test('at most four layers, of the four kinds; anything else is dropped', () => {
  const e = engine(), scene = e.start({});
  scene.update(layersOf([{ k: 'bogus' }, null, { k: 'noise' }, { k: 'noise' }, { k: 'gradient' }, { k: 'particles' }, { k: 'scene', name: 'dust' }], { speed: 0 }));
  assert.deepEqual(plain(e.made.materials.map((m) => m.defines)), [{}, {}, { STYLE: 0 }, { SHAPE: 0 }]);
});

test('every built-in scene works as a layer, points scenes included', () => {
  for (const name of ['mist', 'orbs', 'borealis', 'lava', 'contours', 'horizon', 'graveyard', 'pumpkins', 'waves', 'dust', 'no such scene']) {
    const e = engine(), scene = e.start({});
    scene.update(layersOf([{ k: 'scene', name }], { speed: 0 }));
    assert.equal(e.made.materials.length, 1, name);
    assert.match(e.made.materials[0].fragmentShader, /gz_main/, name);
  }
});

test('the drawing is as sharp as the sharpest layer needs', () => {
  const e = engine(), scene = e.start({});
  scene.update(layersOf([{ k: 'scene', name: 'mist' }, { k: 'gradient' }], { speed: 0 }));
  assert.deepEqual(e.renderer.size, [320, 225], 'mist and a gradient: 0.25');
  scene.update(layersOf([{ k: 'scene', name: 'mist' }, { k: 'particles' }], { speed: 0 }));
  assert.deepEqual(e.renderer.size, [640, 450], 'with particles: 0.5');
});

test('amount, speed, colours and the rest are uniforms: changing them rebuilds nothing; changing a blend or a count does', () => {
  const e = engine(), scene = e.start({});
  const l = (extra = {}) => layersOf([{ k: 'particles', count: 40, amount: 100, speed: 100, blend: 'add', c: ['#112233'], ...extra }, { k: 'noise', scale: 20 }], { speed: 0 });
  scene.update(l());
  const built = e.made.materials.length;
  scene.update(l({ amount: 20, speed: 50, size: 30, drift: 90, twinkle: 100, c: ['#445566', 'accent'] }));
  assert.equal(e.made.materials.length, built);
  const u = e.made.materials[0].uniforms;
  assert.equal(u.uLayer.value, 0.2);
  assert.equal(u.uC1.value.hex, '#445566');
  assert.equal(u.uC2.value.hex, '#abcdef', 'a palette name is looked up in the caller\'s palette');
  assert.equal(u.uC3.value.hex, '#445566', 'two colours alternate to fill the three; none at all would be the Look\'s');
  assert.equal(u.uTwinkle.value, 1);
  assert.ok(Math.abs(u.uDir.value - Math.PI / 2) < 1e-9);
  assert.equal(u.uPt.value, 15, '30 css px at 0.5');
  scene.update(l({ c: ['#ffffff'] }));
  assert.deepEqual(['uC1', 'uC2', 'uC3'].map((k) => u[k].value.hex), ['#ffffff', '#ffffff', '#ffffff'], 'one colour is all that colour');
  scene.update(l({ blend: 'screen' }));
  assert.equal(e.made.materials.length, built + 2);
  scene.update(l({ blend: 'screen', count: 41 }));
  assert.equal(e.made.materials.length, built + 4);
  assert.deepEqual(e.made.attributes.filter(([n]) => n === 'seed').map((a) => a[1]), [40, 40, 41]);
});

test('layer values are clamped, and a colour that means nothing falls back to the Look\'s', () => {
  const e = engine(), scene = e.start({});
  scene.update(layersOf([{ k: 'particles', count: 99999, amount: 900, size: -5, drift: 'x', c: ['nonsense', 5, null, '#12345'] }, { k: 'noise', amount: NaN, speed: -3 }], { speed: 0 }));
  const [p, n] = e.made.materials;
  assert.equal(e.made.attributes.find(([name]) => name === 'seed')[1], 400);
  assert.equal(p.uniforms.uLayer.value, 1);
  assert.equal(p.uniforms.uPt.value, 0.5, 'a size of at least 1 css px, at 0.5');
  assert.ok(Math.abs(p.uniforms.uDir.value - Math.PI) < 1e-9, 'a default drift: down');
  assert.deepEqual([p.uniforms.uC1.value.hex, p.uniforms.uC2.value.hex, p.uniforms.uC3.value.hex], ['#111111', '#222222', '#333333']);
  assert.equal(n.uniforms.uLayer.value, 0.7, 'an amount that is not a number is the default');
});

test('a key a layer leaves out means what lib/lookparts.js says it means', () => {
  const D = require('../lib/lookparts.js').DEFAULTS.layer;
  const drawn = (layer) => {
    const e = engine(), scene = e.start({});
    scene.update(layersOf([layer], { speed: 2 }));
    e.tick(34);
    const m = e.made.materials[0];
    return { uniforms: Object.fromEntries(Object.entries(m.uniforms).filter(([k]) => k !== 'uAspect' && k !== 'uPx').map(([k, u]) => [k, u.value?.hex ?? u.value])), blend: [m.blendSrc, m.blendDst], defines: plain(m.defines), attributes: e.made.attributes.length };
  };
  for (const [k, d] of Object.entries(D)) {
    const own = { k, ...(k === 'scene' && { name: 'mist' }), ...(k === 'gradient' && { c: ['#111111', '#222222'] }) };
    assert.deepEqual(drawn(own), drawn({ ...own, ...d }), `${k}: leaving out ${Object.keys(d).join(', ')} is the same as saying them`);
  }
  assert.deepEqual(Object.keys(D).sort(), ['gradient', 'noise', 'particles', 'scene']);
  // And the shapes it can name are the ones this draws, in the same order (a shape is drawn by its place in the list).
  const drawnShapes = fs.readFileSync(path.join(__dirname, '../lib/scene.js'), 'utf8').match(/const SHAPES = (\[[^\]]*\])/)[1];
  assert.deepEqual(JSON.parse(drawnShapes.replace(/'/g, '"')), require('../lib/motionx.js').SHAPES);
  const kinds = require('../defaults.js').GZ_SPEC.bg.kind[1];
  assert.ok(kinds.includes('shader') && kinds.includes('layers'));
});

test('what lib/lookparts.js cleans is what the scene draws, and its sanitizer asks the shader checker', () => {
  const P = require('../lib/lookparts.js');
  const layers = [{ k: 'gradient', c: ['accent', '#FF0000'], style: 'conic' }, { k: 'scene', name: 'borealis', blend: 'add' }, { k: 'particles', shape: 'heart', count: 20, c: ['accent-hi'] }, { k: 'noise', scale: 10 }];
  const got = P.bundle({ x: { bg: { layers } } });
  assert.ok(got, 'the layers are a Look part');
  const e = engine(), scene = e.start({});
  scene.update(layersOf(got.x.bg.layers, { speed: 0, palette: { '--gz-accent': '#111111', '--gz-accent-hi': '#222222' } }));
  assert.deepEqual(plain(e.made.materials.map((m) => m.defines)), [{ STYLE: 2 }, {}, { SHAPE: 3 }, {}]);
  assert.deepEqual([e.made.materials[0].uniforms.uC1.value.hex, e.made.materials[0].uniforms.uC2.value.hex], ['#111111', '#ff0000'], 'a token and a hex, as cleaned');
  assert.equal(e.made.materials[2].uniforms.uC1.value.hex, '#222222');
  globalThis.GZ_GLSL = GLSL;
  try {
    assert.ok(P.bundle({ x: { bg: { shader: { src: fixture('aurora') } } } }), 'a shader the checker passes is a part');
    assert.equal(P.bundle({ x: { bg: { shader: { src: `#extension GL_OES_standard_derivatives : enable\n${MIN}` } } } }), null, 'one it refuses refuses the whole code');
    assert.equal(P.bundle({ x: { bg: { shader: { src: 'vec4 scene(vec2 uv) { float s = 0.; for (int i = 0; i < int(1e5); i++) s += 1.; return vec4(s); }' } } } }), null);
  } finally { delete globalThis.GZ_GLSL; }
});

test('each layer keeps its own time, at its own speed', () => {
  const e = engine(), scene = e.start({});
  scene.update(layersOf([{ k: 'noise', speed: 100 }, { k: 'noise', speed: 50 }, { k: 'noise', speed: 0 }, { k: 'noise', speed: 200 }], { speed: 2 }));
  e.tick(34); e.tick(34);
  const t = e.made.materials.map((m) => m.uniforms.uTime.value);
  assert.ok(t[0] > 0 && Math.abs(t[1] - t[0] / 2) < 1e-9 && t[2] === 0 && Math.abs(t[3] - t[0] * 2) < 1e-9, JSON.stringify(t));
  assert.equal(e.made.materials[0].uniforms.uAspect, e.made.materials[1].uniforms.uAspect, 'the screen\'s own uniforms are shared');
  assert.notEqual(e.made.materials[0].uniforms.uTime, e.made.materials[1].uniforms.uTime);
});

test('a gradient takes 2 to 4 colours, and conic closes on its first', () => {
  const e = engine(), scene = e.start({});
  const grad = (c, style) => { scene.update(layersOf([{ k: 'gradient', style, c, angle: 90 }], { speed: 0, ground: '#000000' })); return e.made.materials.at(-1).uniforms; };
  let u = grad(['#111111', '#222222'], 'linear');
  assert.equal(u.uStops.value, 2);
  assert.equal(u.uC3.value.hex, '#222222', 'the unused stops repeat the last');
  assert.ok(Math.abs(u.uAngle.value - Math.PI / 2) < 1e-9);
  u = grad(['#111111', '#222222', '#333333', '#444444'], 'radial');
  assert.equal(u.uStops.value, 4);
  u = grad(['#111111', '#222222', '#333333', '#444444'], 'conic');
  assert.equal(u.uStops.value, 5);
  assert.equal(u.uC5.value.hex, '#111111');
  u = grad([], 'conic');
  assert.deepEqual([u.uStops.value, u.uC1.value.hex, u.uC3.value.hex], [3, '#111111', '#111111'], 'none given: the Look\'s first two');
});

test('layers run under the budget guard too, from the sharpest layer\'s scale, with no probe', async () => {
  const e = engine({ latency: 30 }), canvas = e.canvas(), w = watch(e, canvas);
  w.scene.update(layersOf([{ k: 'scene', name: 'mist' }, { k: 'particles' }]));
  assert.notEqual(canvas.style.visibility, 'hidden', 'layers made of Glaze\'s own are shown at once');
  assert.deepEqual(e.renderer.size, [640, 450]);
  await e.pump(); await frames(e, 40);
  assert.deepEqual(w.levels(), [1, 2]);
  await redraw(e, w.scene, 10);
  assert.deepEqual(w.fails.map((f) => f[0]), ['budget']);
});

test('built-in scenes are what they were: their own scale, no probe, the canvas untouched, kind and x ignored', () => {
  for (const o of [{}, { kind: 'scene', x: { bg: { shader: { src: MIN } } } }, { kind: 'solid', x: null }]) {
    const e = engine({ glsl: GLSL }), canvas = e.canvas(), scene = e.start(canvas);
    scene.update({ ...base, ...o, name: 'horizon', speed: 0 });
    assert.deepEqual(e.renderer.size, [640, 450], 'horizon is 0.5');
    assert.deepEqual([e.counts.draws, e.made.materials.length, canvas.style.visibility], [1, 1, undefined]);
    assert.equal(e.made.materials[0].glslVersion, undefined, 'three\'s ESSL 3.00 wrapper, not the raw one');
  }
});
