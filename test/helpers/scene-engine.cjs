// lib/scene.js without a browser: the module itself, run as a script in a VM with stand-ins for three.js, the page and the
// GPU. Its import is dropped and its exports made plain consts; `start` is what the VM hands back. Used by
// test/scene-lifecycle.test.js and test/scene-modes.test.js. GZ_LIFECYCLE_REPO points at another checkout's scene.js
// (a review runs the lifecycle test against the code it is judging).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = process.env.GZ_LIFECYCLE_REPO ? path.join(process.env.GZ_LIFECYCLE_REPO, 'lib/scene.js') : path.join(__dirname, '../../lib/scene.js');
const source = fs.readFileSync(file, 'utf8').replace(/^import \{[\s\S]*?\} from '\.\/three\.min\.js';\n/m, '')
  .replace(/^const \{[\s\S]*?\} = await import\([^\n]+\);\n/m, '').replace(/^export const /gm, 'const ');

// latency: how long the fake GPU takes to finish a frame, in the fake clock's milliseconds (a number, or a function of the
// draw count and the drawing buffer's [width, height], so a test can make cost follow the pixels). Nothing in the VM moves
// on its own: the test calls pump() to run the guard's MessageChannel ticks, each one 1 ms of fake time, tick() to run
// an animation frame, and advance() to move the clock, running the timers that come due.
exports.engine = ({ latency = null, glsl = null, preview = false, submitMs = 0 } = {}) => {
  let next = 0, now = 1000, draws = 0, renderer = null;
  const posted = []; // what the page above (the editor, when preview is true) is told
  const frames = new Map(), listeners = new Map(), canvasListeners = new Map(), docListeners = new Map(), queue = [], timers = new Map();
  const counts = { draws: 0, disposed: 0, lost: 0, geometry: 0, material: 0 };
  const made = { materials: [], attributes: [], renderOrder: [], clears: 0, fences: 0, deletedFences: 0, closedPorts: 0 };
  class Color { constructor() { this.hex = ''; this.mixed = 0; } set(c) { this.hex = c; return this; } lerp(_, t) { this.mixed = t; return this; } }
  class Renderer {
    constructor() { this.debug = {}; this.autoClear = true; renderer = this; }
    setPixelRatio() {} setSize(w, h) { this.size = [w, h]; } setClearColor() {}
    render(scene, camera) { now += submitMs; counts.draws++; draws++; made.renderOrder.push(scene.children[0]); this.last = { scene, camera }; }
    clear() { made.clears++; }
    dispose() { counts.disposed++; } forceContextLoss() { counts.lost++; }
    getContext() { return gl; }
  }
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, SYNC_STATUS: 2, SIGNALED: 3, ALIASED_POINT_SIZE_RANGE: 4, lost: false,
    isContextLost() { return this.lost; }, flush() {}, deleteSync() { made.deletedFences++; }, getParameter: () => [1, 255],
    fenceSync() { if (latency == null && !glsl) return null; made.fences++; return { until: now + (typeof latency === 'function' ? latency(draws, renderer.size) : latency ?? 1) }; },
    getSyncParameter: (fence) => (now >= fence.until ? 3 : 0),
  };
  class Geometry { dispose() { counts.geometry++; } setAttribute(name, a) { made.attributes.push([name, a.count]); return this; } }
  class Material { constructor(o) { Object.assign(this, o); made.materials.push(this); } dispose() { counts.material++; } }
  class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
  class Cam { constructor() { this.isPerspectiveCamera = false; } }
  class Persp extends Cam { constructor() { super(); this.isPerspectiveCamera = true; this.position = { set() {} }; } lookAt() {} updateProjectionMatrix() {} }
  const ctx = {
    WebGLRenderer: Renderer, Color, ColorManagement: {}, Scene: class { constructor() { this.children = []; } add(o) { this.children.push(o); } remove(o) { this.children = this.children.filter((c) => c !== o); } },
    Mesh, Points: Mesh, PlaneGeometry: Geometry, BufferGeometry: Geometry, Float32BufferAttribute: class { constructor(a, n) { this.count = a.length / n; } },
    ShaderMaterial: Material, RawShaderMaterial: Material, OrthographicCamera: Cam, PerspectiveCamera: Persp,
    CustomBlending: 5, AddEquation: 100, OneFactor: 201, DstColorFactor: 208, OneMinusSrcAlphaFactor: 206, OneMinusSrcColorFactor: 204,
    requestAnimationFrame: (fn) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event),
    innerWidth: 1280, innerHeight: 900, performance: { now: () => now }, queueMicrotask, console,
    setTimeout: (fn, ms = 0) => { timers.set(++next, { fn, at: now + ms }); return next; }, clearTimeout: (id) => timers.delete(id),
    document: { hidden: false, addEventListener: (event, fn) => docListeners.set(event, fn), removeEventListener: (event) => docListeners.delete(event) },
    location: { protocol: preview ? 'chrome-extension:' : 'https:', origin: 'chrome-extension://glaze' }, window: {}, parent: { postMessage: (m, origin) => posted.push([m, origin]) },
    MessageChannel: class { constructor() { const port1 = { close() { made.closedPorts++; } }; this.port1 = port1; this.port2 = { close() { made.closedPorts++; }, postMessage: () => queue.push(() => port1.onmessage?.()) }; } },
  };
  if (glsl) ctx.GZ_GLSL = glsl;
  const context = vm.createContext(ctx);
  context.globalThis = context;
  const start = vm.runInContext(`${source}\nstart`, context);
  // A canvas the scene can listen to and style, the part of a page canvas it uses.
  const canvas = (extra = {}) => ({
    style: {}, clientWidth: 1280, clientHeight: 900,
    addEventListener: (event, fn) => canvasListeners.set(event, fn), removeEventListener: (event) => canvasListeners.delete(event), ...extra,
  });
  return {
    start: (c = {}, ...rest) => start(canvas(c), ...rest), canvas, frames, listeners, canvasListeners, docListeners, counts, made, gl, posted, document: ctx.document,
    // Run the guard's polling for ms of fake time (one MessageChannel tick is 1 ms), then let queued microtasks run.
    async pump(ms = 400) {
      for (let t = 0; t < ms && queue.length; t++) { now += 1; queue.shift()(); }
      await Promise.resolve();
    },
    // The next animation frame, dt ms after the last.
    tick(dt = 34) { const [id, fn] = [...frames][0]; frames.delete(id); now += dt; fn(now); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now && timers.delete(id)) t.fn();
    },
    timers,
    get now() { return now; },
    get renderer() { return renderer; },
  };
};
