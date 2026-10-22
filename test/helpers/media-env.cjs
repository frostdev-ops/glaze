// lib/scene-media.js without a browser: the module itself, run as a script in a VM with stand-ins for the page's elements, its
// storage and the worker. Its export is made a plain const and its one dynamic import (Lottie's player) is the stand-in
// `lottie`. Used by test/scene-media.test.js. Nothing in the VM moves on its own: the test fires the events (loadeddata,
// visibilitychange, resize) and runs the timers it asks for.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../../lib/scene-media.js'), 'utf8')
  .replace(/^export const /gm, 'const ')
  .replace(/import\(chrome\.runtime\.getURL\((['`])lib\/lottie\/lottie_light_canvas\.min\.js/, "importLottie(chrome.runtime.getURL($1lib/lottie/lottie_light_canvas.min.js");
if (!source.includes('importLottie(')) throw new Error('scene-media.js no longer imports Lottie the way this stand-in expects');

class El {
  constructor(tag, env) {
    Object.assign(this, { tag, env, children: [], parentNode: null, attrs: {}, listeners: {}, css: {}, paused: true, plays: 0, pauses: 0, currentTime: 0, ended: false, loads: 0, width: 0, height: 0 });
    this.style = { setProperty: (k, v) => { this.css[k] = v; } };
    env.made.push(this);
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'src') this._src = ''; }
  addEventListener(type, f, o) { (this.listeners[type] ||= []).push({ f, once: !!o?.once }); }
  removeEventListener(type, f) { this.listeners[type] = (this.listeners[type] || []).filter((l) => l.f !== f); }
  fire(type) { for (const l of [...(this.listeners[type] || [])]) { if (l.once) this.removeEventListener(type, l.f); l.f({ type }); } }
  append(...k) { for (const x of k) { x.parentNode?.children.splice(x.parentNode.children.indexOf(x), 1); x.parentNode = this; this.children.push(x); } }
  replaceChildren(...k) { for (const c of this.children) c.parentNode = null; this.children = []; this.append(...k); }
  get src() { return this._src || ''; }
  set src(v) { this._src = v; this.env.srcs.push([this.tag, v]); }
  play() { this.plays++; this.paused = false; return Promise.resolve(); }
  pause() { this.pauses++; this.paused = true; }
  load() { this.loads++; }
  decode() { return this.env.decodeFails ? Promise.reject(new Error('decode')) : Promise.resolve(); }
  querySelector(tag) { return this.children.find((c) => c.tag === tag) || null; }
  toBlob(cb) { cb(new Blob(['still'], { type: 'image/png' })); }
  getContext() { return { drawImage: (...a) => this.env.draws.push([this, ...a]) }; }
  get offsetWidth() { return this.env.width; }
  get offsetHeight() { return this.env.height; }
  get naturalWidth() { return 640; }
  get naturalHeight() { return 360; }
}

exports.env = ({ preview = false, storage = {}, ask = async () => ({ ok: true, json: { w: 10, h: 10 }, canvases: 1 }), decodeFails = false, lottieDelayed = false, bitmapWait = null } = {}) => {
  const env = { width: 1280, height: 800, made: [], srcs: [], draws: [], blobs: [], revoked: [], posted: [], messages: [], timers: [], listeners: {}, docListeners: {}, decodeFails, anims: [], lottieOk: true, digests: 0, storageReads: 0 };
  const document = {
    hidden: false,
    createElement: (tag) => new El(tag, env),
    addEventListener: (type, f) => { (env.docListeners[type] ||= new Set()).add(f); },
    removeEventListener: (type, f) => { env.docListeners[type]?.delete(f); },
  };
  const lottie = {
    loadAnimation: (o) => {
      const calls = [];
      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 800;
      o.container.append(canvas);
      const a = { o, calls, isLoaded: !lottieDelayed, listeners: {}, play: () => calls.push('play'), pause: () => calls.push('pause'), goToAndStop: (...x) => calls.push(['goToAndStop', ...x]),
        destroy: () => calls.push('destroy'), resize: () => calls.push('resize'), setSubframe: (v) => calls.push(['setSubframe', v]), addEventListener: (t, f) => { (a.listeners[t] ||= []).push(f); } };
      env.anims.push(a);
      return a;
    },
  };
  // WebCrypto's digest finishes on a thread of its own, after a test's short wait on a busy machine; the same SHA-256
  // made here resolves with the page's other promises, before any wait ends.
  const subtle = { digest: async (alg, data) => { env.digests++; const b = crypto.createHash('sha256').update(data).digest(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } };
  const ctx = vm.createContext({
    document, Image: function Image() { return new El('img', env); }, Blob, atob, btoa, console, Promise, JSON, Object, Array, Uint8Array, String, Number, Math, Error, crypto: { subtle },
    createImageBitmap: async () => { await bitmapWait; return { width: 640, height: 360, close() { env.bitmapClosed = true; } }; },
    chrome: {
      runtime: { getURL: (f) => f, lastError: null, sendMessage: (m, cb) => { env.messages.push(m); ask(m).then(cb); } },
      storage: { local: { get: async (k) => (env.storageReads++, Object.fromEntries([].concat(k).filter((x) => x in storage).map((x) => [x, storage[x]]))) } },
    },
    URL: { createObjectURL: (b) => { const u = `blob:glaze/${env.blobs.length}`; env.blobs.push([u, b.size, b.type]); return u; }, revokeObjectURL: (u) => env.revoked.push(u) },
    location: { protocol: preview ? 'chrome-extension:' : 'https:', origin: 'chrome-extension://glaze' },
    parent: { postMessage: (m, o) => env.posted.push([m, o]) },
    addEventListener: (t, f) => { (env.listeners[t] ||= new Set()).add(f); },
    removeEventListener: (t, f) => { env.listeners[t]?.delete(f); },
    setTimeout: (f, ms) => env.timers.push({ f, ms }),
    clearTimeout: (id) => { if (env.timers[id - 1]) env.timers[id - 1].dead = true; },
    importLottie: async () => { if (!env.lottieOk) throw new Error('no lottie'); ctx.lottie = lottie; },
  });
  ctx.window = ctx;
  ctx.globalThis = ctx;
  env.start = vm.runInContext(`${source}\nstart`, ctx);
  env.document = document;
  // The timers the test asks to run now.
  env.tick = () => { for (const t of env.timers.filter((x) => !x.dead && !x.ran)) { t.ran = true; t.f(); } };
  env.resize = () => [...(env.listeners.resize || [])].forEach((f) => f());
  env.visibility = (hidden) => { document.hidden = hidden; [...(env.docListeners.visibilitychange || [])].forEach((f) => f()); };
  env.sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('base64url');
  env.listening = () => (env.listeners.resize?.size || 0) + (env.docListeners.visibilitychange?.size || 0);
  return env;
};
