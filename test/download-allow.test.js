// Canvas's Download all when the file server's host isn't held (features/download.js with a stand-in port): the worker says
// which host, the module's header shows Glaze's own frame (features/allow.html) with one button, and its answer decides:
// granted, the file is asked for again and the zip goes on; refused, the download stops with its usual error. And the frame
// itself (features/allow.js): the button names the host, its click asks the browser for exactly that host and says what came
// back to the page around it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.instructure.com', EXT = 'chrome-extension://glaze', CDN = 'inst-fs-iad.example-cdn.net';

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), kids: [], attrs: {}, listeners: {}, style: { setProperty() {} }, dataset: {}, textContent: '', parent: null, isConnected: true }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  append(...k) { for (const x of k) { x.parent = this; this.kids.push(x); } }
  after(x) { const p = this.parent; x.parent = p; p.kids.splice(p.kids.indexOf(this) + 1, 0, x); for (const f of x.listeners.load || []) f(); }
  remove() { if (this.parent) this.parent.kids.splice(this.parent.kids.indexOf(this), 1); this.parent = null; this.isConnected = false; }
  click() { for (const f of this.listeners.click || []) f({ isTrusted: true, stopPropagation() {} }); }
  get iframes() { return this.kids.filter((k) => k.tagName === 'IFRAME'); }
}

// A Modules page with one module of one file, and a port whose worker the test plays.
const page = () => {
  const header = new El('div'), module = { dataset: { moduleId: '73' }, isConnected: true, classList: { contains: () => false },
    getBoundingClientRect: () => ({ top: 0 }), querySelector: (sel) => (sel === '.ig-header' ? header : sel === '.context_module_item' || sel === '.context_module_item.attachment' ? {} : sel === '.name' ? { textContent: 'Week 1' } : null) };
  const ids = () => Object.fromEntries(header.kids.filter((k) => k.id).map((k) => [k.id, k]));
  const listeners = { message: [] }, posted = [], saved = [], channels = new Map();
  class MessageChannel {
    constructor() { const a = { close() {}, start() {} }, b = { close() {}, start() {} }; a.postMessage = (data) => b.onmessage?.({ data, source: null }); b.postMessage = (data) => a.onmessage?.({ data, source: null }); this.port1 = a; this.port2 = b; }
  }
  let worker = null;
  const port = { postMessage: (m) => posted.push(m), disconnect() {}, onMessage: { addListener: (f) => { worker = f; } }, onDisconnect: { addListener() {} } };
  const document = { querySelectorAll: (sel) => (sel.startsWith('.context_module') ? [module] : sel === '.gz-dl' ? header.kids.filter((k) => k.className === 'gz-dl') : []),
    getElementById: (id) => ids()[id] || null,
    createElement: (tag) => { const e = new El(tag); if (tag === 'a') e.click = () => saved.push(e.download); if (tag === 'iframe') e.contentWindow = { frame: true, postMessage(m, origin, ports) { channels.set(e.contentWindow, ports[0]); } }; return e; } };
  const capi = async (p) => (p === '/files/9' ? { id: 9, display_name: 'notes.pdf', size: 3 } : p === '/files/9/public_url' ? { public_url: `https://${CDN}/files/9/notes.pdf?token=a` } : null);
  const ctx = { site: 'canvas', t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])), locale: () => 'en', capi, canvasCourseId: () => '25', courseId: () => null,
    settings: () => ({ enhance: { download: true } }), on: () => true, moduleItems: async () => [{ type: 'File', content_id: '9' }] };
  const g = { MessageChannel, GZ_CTX: ctx, document, location: { pathname: '/courses/25/modules', origin: ORIGIN }, innerHeight: 900, console, Promise, URL, Map, Set, WeakMap, Uint8Array, Uint16Array, Uint32Array, DataView, ArrayBuffer, TextEncoder, Blob, Error, Object, Array, String, Number, Math, JSON, Intl, atob, btoa, DOMException, AbortController,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, encodeURIComponent,
    URL: Object.assign(function (...a) { return new URL(...a); }, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }),
    addEventListener: (t, f) => (listeners[t] ||= []).push(f), removeEventListener: (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
    chrome: { runtime: { id: 'glaze', connect: () => port, getURL: (p) => `${EXT}/${p}` } } };
  g.globalThis = g;
  vm.createContext(g);
  ctx.need = (file, ready) => { if (!ready()) vm.runInContext(read(file), g); return Promise.resolve(); };
  vm.runInContext(read('features/download.js'), g);
  g.GZ_DOWNLOAD.sync();
  const button = () => ids()['gz-dl-73'];
  const say = (m) => worker(m);
  const answer = (source, data, origin = EXT) => { if (channels.has(source)) channels.get(source).postMessage(data); for (const f of [...listeners.message]) f({ source, data, origin }); };
  return { header, button, posted, say, answer, saved, listeners, channels, answerPort: (f, data) => { assert.ok(channels.has(f.contentWindow), 'a private port connects this frame'); channels.get(f.contentWindow).postMessage(data); } };
};
const files = (p) => p.posted.filter((m) => m.type === 'file').map((m) => m.url);
const URL9 = `https://${CDN}/files/9/notes.pdf?token=a`;

test('Download all: the worker\'s ask shows Glaze\'s Allow frame for that host; granted, the file is asked for again and saved', async () => {
  const p = page();
  p.button().click();
  await settle();
  assert.deepEqual(files(p), [URL9]);
  p.say({ type: 'ask', host: CDN });
  await settle();
  const [frame] = p.header.iframes;
  assert.ok(frame, 'a frame in the module header');
  assert.equal(frame.src, `${EXT}/features/allow.html#${CDN}`);
  assert.equal(p.header.kids.indexOf(frame), p.header.kids.indexOf(p.button()) + 1, 'beside the button');
  // Anything but the frame's own answer, for its host, changes nothing.
  p.answer({}, { gzAllow: CDN, ok: true });
  p.answer(frame.contentWindow, { gzAllow: 'other.example', ok: true });
  await settle();
  assert.deepEqual(files(p), [URL9], 'a page posting "yes" is not the frame');
  assert.ok(frame.isConnected);
  p.answer(frame.contentWindow, { gzAllow: CDN, ok: true });
  await settle();
  assert.equal(frame.isConnected, false, 'the frame goes');
  assert.deepEqual(files(p), [URL9, URL9], 'the same file is asked for again');
  p.say({ type: 'chunk', data: btoa('abc') });
  p.say({ type: 'done' });
  await settle();
  assert.deepEqual(p.saved, ['Week 1.zip']);
  assert.match(p.button().textContent, /^Saved 1 files/);
});

test('Download all: refused at the frame, the download stops with its usual error and nothing more is asked for', async () => {
  const p = page();
  p.button().click();
  await settle();
  p.say({ type: 'ask', host: CDN });
  await settle();
  const [frame] = p.header.iframes;
  p.answer(frame.contentWindow, { gzAllow: CDN, ok: false });
  await settle();
  assert.equal(frame.isConnected, false);
  assert.deepEqual(files(p), [URL9]);
  assert.equal(p.button().textContent, 'Download failed');
  assert.deepEqual(p.saved, []);
});

test('Download all: asked again for a host just allowed (the grant didn\'t hold), the file counts as failed instead of asking forever', async () => {
  const p = page();
  p.button().click();
  await settle();
  p.say({ type: 'ask', host: CDN });
  await settle();
  p.answer(p.header.iframes[0].contentWindow, { gzAllow: CDN, ok: true });
  await settle();
  p.say({ type: 'ask', host: CDN });
  await settle();
  assert.equal(p.header.iframes.length, 0, 'no second frame');
  assert.equal(p.button().textContent, 'Download failed');
});

test('Download all: Cancel while the frame waits takes the frame away', async () => {
  const p = page();
  p.button().click();
  await settle();
  p.say({ type: 'ask', host: CDN });
  await settle();
  const [frame] = p.header.iframes;
  p.button().click();
  await settle();
  assert.equal(frame.isConnected, false);
  assert.equal(p.button().textContent, 'Cancelled');
  assert.equal(p.listeners.message.length, 0, 'its listener goes too');
});

test('review: Allow answers use a private frame port when Firefox reports a null source', async () => {
  const p = page();
  p.button().click();
  await settle();
  p.say({ type: 'ask', host: CDN });
  await settle();
  const f = p.header.iframes[0];
  p.answer(null, { gzAllow: CDN, ok: true });
  await settle();
  assert.deepEqual(files(p), [URL9], 'broadcasts with null source cannot answer');
  p.answerPort(f, { gzAllow: CDN, ok: true });
  await settle();
  assert.deepEqual(files(p), [URL9, URL9], 'the frame port works without MessageEvent.source');
});

// ---- the frame ------------------------------------------------------------------------------------------------------------
const frame = ({ hash = `#${CDN}`, request = async () => true, manifest = { host_permissions: [] } } = {}) => {
  const button = new El('button'), asked = [], told = [];
  let active = false;
  const document = { getElementById: (id) => (id === 'allow' ? button : null), documentElement: new El('html'), body: { scrollWidth: 120, scrollHeight: 26 } };
  const g = { document, location: { hash }, console, Promise, URL, decodeURIComponent, navigator: { language: 'en' }, Intl, Object, Array, String, Number, JSON, Math, Error,
    parent: { postMessage: (m, o) => told.push([JSON.parse(JSON.stringify(m)), o]) }, addEventListener(t, f) { if (t === 'message') this.heard = f; }, requestAnimationFrame: (f) => f(),
    chrome: { runtime: { getManifest: () => manifest }, permissions: { request: (o) => { asked.push([[...o.origins], active]); return request(o); } } } };
  g.globalThis = g;
  vm.createContext(g);
  for (const f of ['lib/i18n.js', 'features/allow.js']) vm.runInContext(read(f), g);
  g.heard?.({ data: { gzAllow: decodeURIComponent(hash.slice(1)) }, ports: [{ postMessage: (m) => told.push([JSON.parse(JSON.stringify(m)), '*']) }] });
  const click = (isTrusted = true) => { active = true; for (const f of button.listeners.click || []) f({ isTrusted }); active = false; };
  return { button, asked, told, click };
};

test('the Allow frame: one button naming the host; its click asks for exactly https://host/* inside the click and tells the page', async () => {
  const f = frame();
  assert.equal(f.button.textContent, `Allow ${CDN}`);
  f.click(false);
  assert.deepEqual(f.asked, [], 'a click the page made up asks nothing');
  f.click();
  await settle();
  assert.deepEqual(f.asked, [[[`https://${CDN}/*`], true]]);
  assert.deepEqual(f.told.filter(([m]) => 'ok' in m), [[{ gzAllow: CDN, ok: true }, '*']]);
  const no = frame({ request: async () => false });
  no.click();
  await settle();
  assert.deepEqual(no.told.filter(([m]) => 'ok' in m), [[{ gzAllow: CDN, ok: false }, '*']]);
  const threw = frame({ request: () => Promise.reject(new Error('This function must be called during a user gesture')) });
  threw.click();
  await settle();
  assert.deepEqual(threw.told.filter(([m]) => 'ok' in m), [[{ gzAllow: CDN, ok: false }, '*']]);
});

test('the Allow frame: an address that is no plain host gets no button and asks nothing', async () => {
  for (const hash of ['', '#', '#https://x.example/', '#a b', '#x.example/path', '#*.example.com', '#localhost', '#evil.example:8443']) {
    const f = frame({ hash });
    assert.equal(f.button.hidden, true, hash);
    f.click();
    await settle();
    assert.deepEqual(f.asked, [], hash);
  }
});
