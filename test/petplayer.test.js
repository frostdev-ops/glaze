const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const S = require('../lib/petsprites.js');
const page = () => {
  const timers = new Map(), docEvents = new Map(), winEvents = new Map(), motionEvents = new Map(); let n = 0, observer, motionObserver, image, draws = 0, revoked = 0, now = 0, lastFrame = [], motionLevel = 'subtle';
  const canvas = { isConnected: true, getContext: () => ({ clearRect() {}, drawImage(...args) { draws++; lastFrame = args.slice(1, 3); } }) };
  const scratch = () => ({ getContext: () => ({ clearRect() {}, drawImage() {} }) });
  const context = { GZ_PET_SPRITES: S, console, document: { createElement: scratch, documentElement: { getAttribute: () => motionLevel }, hidden: false, addEventListener: (k, f) => docEvents.set(k, f), removeEventListener: (k) => docEvents.delete(k) },
    window: { addEventListener: (k, f) => winEvents.set(k, f), removeEventListener: (k) => winEvents.delete(k) },
    performance: { now: () => now }, setTimeout: (f) => { timers.set(++n, f); return n; }, clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (f) => { timers.set(++n, f); return n; }, cancelAnimationFrame: (id) => timers.delete(id),
    matchMedia: () => motion, Image: class { constructor() { image = this; } },
    IntersectionObserver: class { constructor(f) { observer = f; } observe() {} disconnect() {} },
    MutationObserver: class { constructor(f) { motionObserver = f; } observe() {} disconnect() {} },
    chrome: { runtime: { id: 'x', getURL: (p) => `chrome-extension://x/${p}` } },
    URL: { createObjectURL: () => 'blob:own', revokeObjectURL: () => revoked++ }, Blob, Uint8Array,
  };
  const motion = { matches: false, addEventListener: (k, f) => motionEvents.set(k, f), removeEventListener: (k) => motionEvents.delete(k) };
  vm.createContext(context); const player = vm.runInContext(fs.readFileSync(require.resolve('../lib/petplayer.js'), 'utf8'), context);
  return { context, timers, docEvents, winEvents, motionEvents, motion, canvas, setMotion: (value) => { motionLevel = value; motionObserver(); }, player, load: () => image.onload(), observer: (v) => observer([{ isIntersecting: v }]), draws: () => draws, revoked: () => revoked, frame: () => lastFrame, tick: (ms) => { now = ms; [...timers.values()][0](); } };
};
test('pet clock pauses offscreen/hidden/reduced-motion and cleans all listeners on removal', () => {
  const p = page(), live = p.player.mount(p.canvas, { path: 'x.webp', spriteVersionNumber: 2 }); p.load();
  assert.equal(p.timers.size, 1); p.observer(false); assert.equal(p.timers.size, 0);
  p.observer(true); assert.equal(p.timers.size, 1);
  p.context.document.hidden = true; p.docEvents.get('visibilitychange')(); assert.equal(p.timers.size, 0);
  p.context.document.hidden = false; p.motion.matches = true; p.motionEvents.get('change')(); assert.equal(p.timers.size, 0);
  const count = p.draws(); live.set('jumping'); assert.equal(p.draws(), count + 1); assert.equal(p.timers.size, 0);
  live.stop(); assert.equal(p.timers.size + p.docEvents.size + p.winEvents.size + p.motionEvents.size, 0);
});
test('late image loads and invalidated extension contexts do not restart animation', () => {
  const p = page(), live = p.player.mount(p.canvas, { path: 'x.webp', spriteVersionNumber: 1 }); live.stop(); assert.equal(p.timers.size, 0);
  const q = page(); q.player.mount(q.canvas, { path: 'x.webp', spriteVersionNumber: 1 }); q.context.chrome.runtime.id = undefined; q.load();
  assert.equal(q.timers.size + q.docEvents.size + q.winEvents.size + q.motionEvents.size, 0);
});

test('detached and invalidated hidden pets release all listeners without waking', () => {
  for (const invalidated of [false, true]) {
    const p = page(); p.player.mount(p.canvas, { path: 'x.webp', spriteVersionNumber: 2 }); p.load();
    if (invalidated) { p.context.chrome.runtime.id = undefined; p.context.document.hidden = true; }
    else p.canvas.isConnected = false;
    p.docEvents.get('visibilitychange')();
    assert.equal(p.timers.size + p.docEvents.size + p.winEvents.size + p.motionEvents.size, 0);
  }
});
test('a stale intersection callback cannot wake an explicitly sleeping pet', () => {
  const p = page(), live = p.player.mount(p.canvas, { path: 'x.webp', spriteVersionNumber: 2 }); p.load();
  live.sleep(); p.observer(true);
  assert.equal(p.timers.size, 0);
  live.wake(); assert.equal(p.timers.size, 1);
});

test('Glaze Motion off stops the sprite clock and resumes live when enabled', () => {
  const p = page(), live = p.player.mount(p.canvas, { path: 'x.webp', spriteVersionNumber: 2 }); p.load();
  assert.equal(p.timers.size, 1);
  p.setMotion('off'); assert.equal(p.timers.size, 0);
  live.set('jumping'); assert.equal(p.timers.size, 0);
  p.setMotion('subtle'); assert.equal(p.timers.size, 1);
  live.stop(); p.setMotion('expressive'); assert.equal(p.timers.size, 0);
});

test('the renderer keeps a compatible imported seventh idle frame', () => {
  const p = page(); p.player.mount(p.canvas, { path: 'rime.webp', spriteVersionNumber: 2, frameCounts: [7, ...S.COUNTS.slice(1)] }); p.load();
  p.tick(750); assert.deepEqual(p.frame(), [1152, 0]);
  p.tick(875); assert.deepEqual(p.frame(), [0, 0]);
});
