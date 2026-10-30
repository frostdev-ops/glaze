const test = require('node:test'), assert = require('node:assert/strict');
const { engine } = require('./helpers/scene-engine.cjs');
const opts = { name: 'mist', ground: '#000', colors: ['#123', '#456', '#789'], dim: 0, amount: 0.5, speed: 1 };

test('a scene cut off from its caller stops its frames and keeps its last frame on screen', () => {
  const e = engine(); let live = true;
  const scene = e.start({}, () => live); scene.update(opts);
  assert.equal(e.counts.draws, 1); assert.equal(e.frames.size, 1);
  const [id, tick] = [...e.frames][0]; e.frames.delete(id); live = false; tick(100);
  assert.equal(e.frames.size, 0, 'reload does not schedule another animation frame');
  assert.equal(e.listeners.size, 0);
  assert.deepEqual(e.counts, { draws: 1, disposed: 0, lost: 0, geometry: 0, material: 0 }, 'the drawing stays: the page is not left bare');
  scene.stop(); scene.draw(); scene.update(opts);
  assert.equal(e.counts.draws, 1, 'a frozen scene never draws again');
});

test('a scene switched off frees everything, once', () => {
  const e = engine(); const scene = e.start({}, () => true); scene.update(opts);
  scene.stop(); scene.stop(); scene.draw(); scene.update(opts);
  assert.deepEqual([e.counts.disposed, e.counts.lost, e.frames.size, e.listeners.size], [1, 1, 0, 0]);
  assert.equal(e.counts.draws, 1);
  assert.deepEqual([e.counts.geometry, e.counts.material, e.canvasListeners.size, e.docListeners.size], [1, 1, 0, 0], 'its mesh, material and its listeners go too');
});

test('standalone promo callers keep their still frame and resize behavior', () => {
  const e = engine(), scene = e.start({}); scene.update({ ...opts, speed: 0 });
  assert.equal(e.counts.draws, 1); assert.equal(e.frames.size, 0);
  e.listeners.get('resize')(); assert.equal(e.counts.draws, 2);
  scene.stop(); assert.equal(e.counts.disposed, 1);
});

test('a scene\'s time follows the wall clock from its anchor, and a new speed starts from the time reached', () => {
  const e = engine(), scene = e.start({}); scene.update(opts);
  const u = () => e.made.materials[0].uniforms.uTime.value;
  assert.deepEqual({ ...scene.clock }, { t: 0, at: 1000 });
  e.tick(340); assert.ok(Math.abs(u() - 0.34) < 1e-9, u());
  scene.update({ ...opts, speed: 2 });
  assert.ok(Math.abs(u() - 0.34) < 1e-9, 'no jump');
  e.tick(100); assert.ok(Math.abs(u() - 0.54) < 1e-9, u());
});

test('a course tab\'s scene takes the page\'s clock and shows the page\'s moment', () => {
  const e = engine(), scene = e.start({});
  scene.update({ ...opts, clock: { t: 5, at: 900 } });
  const u = () => e.made.materials[0].uniforms.uTime.value;
  assert.ok(Math.abs(u() - 5.1) < 1e-9, `drawn at once at the page's time: ${u()}`);
  e.tick(400); assert.ok(Math.abs(u() - 5.5) < 1e-9, u());
});
