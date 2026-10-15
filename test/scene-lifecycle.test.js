const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const file = process.env.GZ_LIFECYCLE_REPO ? path.join(process.env.GZ_LIFECYCLE_REPO, 'lib/scene.js') : require.resolve('../lib/scene.js');
const text = fs.readFileSync(file, 'utf8');
const source = text.slice(text.indexOf('export const start = ')).replace('export const start', 'const start');
const engine = () => {
  let next = 0;
  const frames = new Map(), listeners = new Map(), counts = { draws: 0, disposed: 0, lost: 0, geometry: 0, material: 0 };
  class Color { set() { return this; } lerp() { return this; } }
  class Renderer {
    setPixelRatio() {} setSize() {} setClearColor() {} render() { counts.draws++; }
    dispose() { counts.disposed++; } forceContextLoss() { counts.lost++; }
  }
  const c = { WebGLRenderer: Renderer, Color, Scene: class { add() {} remove() {} }, FPS: 30,
    SCENES: { mist: { scale: 0.5, make: () => [{ geometry: { dispose: () => counts.geometry++ }, material: { dispose: () => counts.material++ } }, {}] } },
    requestAnimationFrame: (fn) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event),
    innerWidth: 1280, innerHeight: 900, performance: { now: () => 0 } };
  return { start: vm.runInNewContext(source + '\nstart', c), frames, listeners, counts };
};
const opts = { name: 'mist', ground: '#000', colors: ['#123', '#456', '#789'], dim: 0, amount: 0.5, speed: 1 };

test('a scene stops frames and disposes resources when its caller is invalidated', () => {
  const e = engine(); let live = true;
  const scene = e.start({}, () => live); scene.update(opts);
  assert.equal(e.counts.draws, 1); assert.equal(e.frames.size, 1);
  const [id, tick] = [...e.frames][0]; e.frames.delete(id); live = false; tick(100);
  assert.equal(e.frames.size, 0, 'reload does not schedule another animation frame');
  assert.equal(e.listeners.size, 0);
  assert.deepEqual(e.counts, { draws: 1, disposed: 1, lost: 1, geometry: 1, material: 1 });
  scene.stop(); scene.draw(); scene.update(opts);
  assert.equal(e.counts.disposed, 1, 'stop is idempotent and a disposed scene cannot revive');
  assert.equal(e.counts.draws, 1);
});

test('standalone promo callers keep their still frame and resize behavior', () => {
  const e = engine(), scene = e.start({}); scene.update({ ...opts, speed: 0 });
  assert.equal(e.counts.draws, 1); assert.equal(e.frames.size, 0);
  e.listeners.get('resize')(); assert.equal(e.counts.draws, 2);
  scene.stop(); assert.equal(e.counts.disposed, 1);
});
