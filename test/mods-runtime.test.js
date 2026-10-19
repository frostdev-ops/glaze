// Code mods' sandbox runtime, each piece in a VM with stand-ins: the host's one handshake and its per-mod routing
// (mods/host.js), the frame UI bootstrap (mods/boot.js), and the page side's watchdog (features/mods.js). Real MessagePorts
// carry the messages. The browser side, with the real sandbox and CSP, is scripts/mods-sandbox-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
// Values from the VMs carry their own realm's prototypes: compared as data.
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const eq = (a, b, ...m) => assert.deepStrictEqual(plain(a), plain(b), ...m);
const inbox = (port) => { const got = []; port.onmessage = (e) => got.push(e.data); return got; };
// Every channel made here (by the tests or the code under test) is closed at the end, so node can exit.
const channels = [];
class MessageChannel extends globalThis.MessageChannel { constructor() { super(); channels.push(this); } }
test.after(() => { for (const c of channels) { c.port1.close(); c.port2.close(); } });
const NONCE = 'a'.repeat(36) + 'b'.repeat(36);

// ---- mods/host.js ----------------------------------------------------------------------------------------------------------
const host = ({ origin = 'null', chrome, hash = `#${NONCE}`, now = () => 1000 } = {}) => {
  const listeners = new Set(), workers = [], blobs = [];
  const parent = { name: 'the LMS tab' };
  class Worker { constructor(url) { this.url = url; this.sent = []; this.terminated = false; workers.push(this); } postMessage(m) { this.sent.push(m); } terminate() { this.terminated = true; } }
  class ImageBitmap extends ArrayBuffer { constructor(w, h) { super(1); this.width = w; this.height = h; this.closed = false; } close() { this.closed = true; } }
  const ctx = vm.createContext({
    ImageBitmap, performance: { now },
    location: { hash, href: `chrome-extension://glaze/mods/host.html${hash}` }, parent, self: { origin }, chrome, URL, Blob, Worker, MessageChannel, TextEncoder,
    addEventListener: (t, f) => t === 'message' && listeners.add(f), removeEventListener: (t, f) => listeners.delete(f), setTimeout,
  });
  ctx.URL = class extends URL { static createObjectURL(blob) { blobs.push(blob); return 'blob:null/1'; } };
  ctx.globalThis = ctx;
  vm.runInContext(read('mods/host.js'), ctx);
  const post = (data, { source = parent, ports } = {}) => { const ch = new MessageChannel(); for (const f of [...listeners]) f({ source, data, ports: ports || [ch.port2] }); return ch.port1; };
  return { post, parent, workers, listeners, blobs, ImageBitmap };
};
const hello = { type: 'glaze:host', nonce: NONCE };

test('the host takes exactly one handshake: from its parent, with its nonce and one port', async () => {
  const h = host();
  const refused = [
    h.post(hello, { source: { name: 'a mod frame' } }), h.post(hello, { source: null }), h.post({ ...hello, nonce: 'guess' }), h.post({ ...hello, nonce: NONCE.slice(1) }),
    h.post({ ...hello, nonce: undefined }), h.post({ ...hello, type: 'glaze:init' }), h.post('glaze:host'), h.post(null), h.post([hello]),
  ];
  const outs = refused.map(inbox);
  const two = new MessageChannel(), none = new MessageChannel();
  const twoGot = inbox(two.port1), noneGot = inbox(none.port1);
  h.post(hello, { ports: [] });
  h.post(hello, { ports: [two.port2, none.port2] });
  await settle();
  eq([...outs.flat(), ...twoGot, ...noneGot], [], 'no answer to any of them');
  assert.equal(h.listeners.size, 1, 'still waiting for the real one');
  const port = h.post(hello);
  const got = inbox(port);
  await settle();
  eq(got, [{ ready: true }]);
  assert.equal(h.listeners.size, 0, 'and then it listens to the window no more');
  const again = inbox(h.post(hello));
  await settle();
  eq(again, [], 'a second handshake, even a right one, gets nothing');
  for (const f of refused) f.close();
  port.close();
});

test('a host whose address carries no proper nonce never answers', async () => {
  for (const hash of ['', '#', '#short']) {
    const h = host({ hash });
    const got = inbox(h.post({ ...hello, nonce: hash.slice(1) }));
    await settle();
    eq(got, [], JSON.stringify(hash));
  }
});

test('a host that isn\'t really the sandbox says so and starts nothing', async () => {
  for (const opts of [{ origin: 'chrome-extension://glaze' }, { chrome: { runtime: { id: 'glaze' } } }]) {
    const h = host(opts);
    const port = h.post(hello);
    const got = inbox(port);
    await settle();
    eq(got, [{ ready: false }], JSON.stringify(opts));
    port.postMessage({ op: 'start', mods: [{ id: 'a', worker: '1', frames: [] }] });
    await settle();
    assert.equal(h.workers.length, 0);
  }
});

test('each mod has its own channel: calls go up tagged by the host, answers go back to that mod alone', async () => {
  const h = host();
  const port = h.post(hello);
  const up = inbox(port);
  port.postMessage({ op: 'start', mods: [{ id: 'a', worker: 'code a', frames: [] }, { id: 'b', worker: 'code b', frames: [] }, { id: 'a', worker: 'again' }, { id: 'c', worker: null }] });
  await settle();
  const [A, B] = h.workers;
  assert.equal(h.workers.length, 2, 'one Worker per mod with code, a second start of one ignored');
  eq([A.sent, B.sent], [[{ run: ['code a'] }], [{ run: ['code b'] }]]);
  assert.match(A.url, /^blob:/);
  // A mod can't name itself or another: the host tags what comes on its channel.
  A.onmessage({ data: { id: 1, call: 'storage.get', args: ['k'], mod: 'b', via: 'frame:x' } });
  B.onmessage({ data: { id: 1, call: 'theme', args: [] } });
  for (const junk of [{ id: 1.5, call: 'x', args: [] }, { id: 2, call: 'x'.repeat(65), args: [] }, { id: 3, call: 'x', args: {} }, { id: 4, args: [] }, 'text', null])
    A.onmessage({ data: junk });
  await settle();
  eq(up.slice(1), [{ mod: 'a', via: 'worker', id: 1, call: 'storage.get', args: ['k'] }, { mod: 'b', via: 'worker', id: 1, call: 'theme', args: [] }]);
  port.postMessage({ mod: 'a', via: 'worker', id: 1, ok: true, value: 42 });
  port.postMessage({ mod: 'b', via: 'worker', id: 1, ok: false, error: 'permission' });
  port.postMessage({ mod: 'nobody', via: 'worker', id: 1, ok: true, value: 'lost' });
  await settle();
  eq(A.sent.slice(1), [{ id: 1, ok: true, value: 42 }]);
  eq(B.sent.slice(1), [{ id: 1, ok: false, error: 'permission' }]);
  // Heartbeats: the host answers and passes them to every Worker, whose answers go up by mod.
  port.postMessage({ ping: 7 });
  await settle();
  eq(up.at(-1), { pong: 7 });
  eq([A.sent.at(-1), B.sent.at(-1)], [{ ping: 7 }, { ping: 7 }]);
  B.onmessage({ data: { pong: 7 } });
  A.onmessage({ data: { ran: true } });
  await settle();
  eq(up.slice(-2), [{ pong: 7, mod: 'b' }, { ran: 'a', via: 'worker' }]);
  // Events to one or all; an ended mod is gone; one whose code threw is stopped and reported.
  port.postMessage({ event: 'theme' });
  port.postMessage({ event: 'visible', data: false, mod: 'b' });
  port.postMessage({ kill: 'a' });
  await settle();
  eq(A.sent.at(-1), { event: 'theme' });
  eq(B.sent.slice(-2), [{ event: 'theme' }, { event: 'visible', data: false }]);
  assert.equal(A.terminated, true);
  B.onmessage({ data: { error: 'SyntaxError' } });
  await settle();
  assert.equal(B.terminated, true);
  eq(up.at(-1), { stopped: 'b', why: 'error' });
  A.onmessage({ data: { id: 9, call: 'theme', args: [] } });
  await settle();
  eq(up.at(-1), { stopped: 'b', why: 'error' }, 'nothing more from an ended mod');
  port.close();
});

// The client every mod gets, as the host sends it: run in a Worker-like scope over a real port.
test('the glaze client: promise calls, events, heartbeats and the mod\'s code run once at global scope', async () => {
  const src = read('mods/host.js');
  const client = src.slice(src.indexOf('  function glazeClient(port) {'), src.indexOf('\n  }\n', src.indexOf('  function glazeClient(port) {')) + 4);
  const ch = new MessageChannel();
  const ctx = vm.createContext({ setTimeout, Promise, Error, Object, Map, Number, String, Array });
  ctx.globalThis = ctx;
  vm.runInContext(`${client}\nglazeClient(port);`, Object.assign(ctx, { port: ch.port1 }));
  const out = inbox(ch.port2);
  ch.port2.postMessage({ run: ['var shown = []; glaze.on("theme", (d) => shown.push(d)); var got = glaze.storage.get("k");'] });
  ch.port2.postMessage({ run: ['var shown = "run twice"'] });
  await settle();
  eq(out, [{ id: 1, call: 'storage.get', args: ['k'] }, { ran: true }]);
  ch.port2.postMessage({ id: 1, ok: true, value: 'v' });
  ch.port2.postMessage({ event: 'theme', data: 1 });
  ch.port2.postMessage({ ping: 3 });
  await settle();
  assert.equal(await ctx.got, 'v');
  eq([...ctx.shown], [1]);
  eq(out.at(-1), { pong: 3 });
  vm.runInContext('var f = glaze.fetch("https://x.test/", undefined).catch((e) => e.message); var g = glaze.grades();', ctx);
  await settle();
  eq(out.slice(-2), [{ id: 2, call: 'fetch', args: ['https://x.test/', {}] }, { id: 3, call: 'grades', args: [] }]);
  ch.port2.postMessage({ id: 2, ok: false, error: 'permission' });
  await settle();
  assert.equal(await ctx.f, 'permission');
  assert.throws(() => vm.runInContext('glaze = 1; "use strict"; Object.defineProperty(globalThis, "glaze", { value: 2 })', ctx), 'glaze can\'t be swapped out');
  const ch2 = new MessageChannel(), ctx2 = vm.createContext({ setTimeout, Promise });
  ctx2.globalThis = ctx2;
  vm.runInContext(`${client}\nglazeClient(port);`, Object.assign(ctx2, { port: ch2.port1 }));
  const out2 = inbox(ch2.port2);
  ch2.port2.postMessage({ run: ['this is not javascript'] });
  await settle();
  assert.equal(out2.length, 1);
  assert.match(out2[0].error, /Unexpected/);
  ch.port1.close(); ch2.port1.close();
});

// ---- mods/boot.js ----------------------------------------------------------------------------------------------------------
const boot = (globals = {}) => {
  const listeners = new Set();
  const parent = { name: 'the host' };
  const ctx = vm.createContext({ parent, addEventListener: (t, f) => listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) });
  ctx.globalThis = ctx;
  const fn = function RTC() {};
  for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription', 'RTCRtpSender']) Object.defineProperty(ctx, k, { value: fn, writable: true, configurable: true });
  Object.assign(ctx, globals);
  vm.runInContext(read('mods/boot.js'), ctx);
  const post = (data, source = parent) => { const ch = new MessageChannel(); for (const f of [...listeners]) f({ source, data, ports: [ch.port2] }); return ch.port1; };
  return { ctx, post, parent, listeners };
};

test('the bootstrap takes every RTC* global away for good before anything else runs', () => {
  const { ctx } = boot();
  for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate', 'RTCSessionDescription', 'RTCRtpSender']) {
    assert.equal(ctx[k], undefined, k);
    assert.throws(() => Object.defineProperty(ctx, k, { value: 1 }), TypeError, `${k} can't be put back`);
    ctx[k] = 1;
    assert.equal(ctx[k], undefined, `${k} can't be assigned`);
  }
});

test('the bootstrap boots once, for its parent only, and runs the client it is sent', async () => {
  const b = boot();
  const stranger = b.post({ type: 'glaze:boot' }, { name: 'the LMS page' });
  stranger.postMessage({ client: '(function (port) { port.postMessage({ hijacked: true }); })' });
  const strangerGot = inbox(stranger);
  b.post({ type: 'other' }).postMessage({ client: '(function (port) { port.postMessage({ hijacked: true }); })' });
  await settle();
  eq(strangerGot, []);
  assert.equal(b.listeners.size, 1);
  const port = b.post({ type: 'glaze:boot' });
  const got = inbox(port);
  port.postMessage({ client: '(function (port) { port.postMessage({ client: "ran" }); })' });
  port.postMessage({ client: '(function (port) { port.postMessage({ client: "twice" }); })' });
  await settle();
  eq(got, [{ client: 'ran' }], 'once');
  assert.equal(b.listeners.size, 0);
  const late = b.post({ type: 'glaze:boot' });
  const lateGot = inbox(late);
  late.postMessage({ client: '(function (port) { port.postMessage({ hijacked: true }); })' });
  await settle();
  eq(lateGot, [], 'no second boot, even from the parent');
  for (const p of [stranger, port, late]) p.close();
});

test('a frame where an RTC* global couldn\'t be taken away never boots', async () => {
  const listeners = new Set(), parent = {};
  const ctx = vm.createContext({ parent, addEventListener: (t, f) => listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) });
  ctx.globalThis = ctx;
  Object.defineProperty(ctx, 'RTCPeerConnection', { value: function RTC() {}, writable: false, configurable: false });
  vm.runInContext(read('mods/boot.js'), ctx);
  const ch = new MessageChannel();
  const got = inbox(ch.port1);
  for (const f of listeners) f({ source: parent, data: { type: 'glaze:boot' }, ports: [ch.port2] });
  ch.port1.postMessage({ client: '(function (port) { port.postMessage({ booted: true }); })' });
  await settle();
  eq(got, []);
  ch.port1.close();
});

// ---- features/mods.js: the page side and its watchdog ------------------------------------------------------------------------
const M = require('../features/mods.js');
test('the watchdog\'s call: a silent host takes its frame UIs\' mods with it, a silent Worker goes alone', () => {
  const base = { now: 10000, host: 9000, ok: true, seen: [['a', 9000], ['b', 4000]], frames: ['f'] };
  eq(M.verdict(base), { host: false, kill: ['b'] });
  eq(M.verdict({ ...base, seen: [['a', 5000]] }), { host: false, kill: [] }, 'exactly HANG is not yet');
  eq(M.verdict({ ...base, host: 4000 }), { host: true, stop: ['f'] }, 'Workers look silent too when the host is frozen: the host decides');
  eq(M.verdict({ ...base, host: 4000, ok: false }), { host: true, stop: [] }, 'a host that never answered blames no mod');
});

// A page with Glaze's content script: stand-in DOM, chrome and clock; the test plays the host on the port it is handed.
const page = ({ path = '/courses/1', list } = {}) => {
  let clock = 1000;
  const timers = new Set();
  const sent = [], frames = [], appended = [];
  const chrome = { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, sendMessage: async (m) => { sent.push(m); return m.type === 'glaze:mod' ? { ok: true, value: `answer to ${m.call}` } : m.op === 'list' ? { mods: list() } : { ok: true }; } },
    storage: { onChanged: { addListener: (f) => { chrome.changed = f; } } } };
  const el = (tag) => {
    const e = { tag, isConnected: false, listeners: {}, style: {}, setAttribute() {}, replaceChildren() {}, append(c) { c.isConnected = true; }, remove() { this.isConnected = false; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, attachShadow() { return e; } };
    if (tag === 'iframe') { frames.push(e); e.contentWindow = { postMessage: (data, origin, ports) => { e.posted = [...(e.posted || []), { data, origin, ports }]; } }; }
    return e;
  };
  const document = { hidden: false, createElement: el, documentElement: { append: (m) => { m.isConnected = true; appended.push(m); }, getAttribute: () => null }, getElementById: () => null, querySelectorAll: () => [],
    addEventListener: (t, f) => { document[`on${t}`] = f; }, dispatchEvent: (e) => { (document.events ||= []).push(e.type); } };
  const ctx = vm.createContext({ chrome, document, location: { pathname: path, href: `https://lms.test${path}` }, crypto: { randomUUID: () => 'u'.repeat(36) }, MessageChannel, Promise, JSON, Map, Set, Object, Array, Number, Math,
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1,
    performance: { now: () => clock }, setTimeout: (f, ms) => { const t = { at: clock + ms, f }; timers.add(t); return t; }, clearTimeout: (t) => timers.delete(t), addEventListener() {} });
  ctx.globalThis = ctx;
  vm.runInContext(read('features/mods.js'), ctx);
  const tick = async (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.delete(due);
      clock = due.at;
      due.f();
      await settle();
    }
    clock = end;
    await settle();
  };
  // Load the newest host frame and take the port handed to it.
  const load = async () => {
    const f = frames.at(-1);
    for (const g of f.listeners.load) g();
    const port = f.posted.at(-1).ports[0];
    const got = inbox(port);
    await settle();
    return { f, port, got };
  };
  return { G: ctx.GZ_MODS, ctx, chrome, sent, frames, appended, tick, load, set clock(v) { clock = v; }, get clock() { return clock; } };
};
const W = (id) => ({ id, name: id, worker: 'code', slots: [], on: [], events: [], text: {} });
const F = (id) => ({ id, name: id, worker: 'code', slots: [{ key: 'tile:x', name: 'X', size: 's', file: 'x.html' }], on: [], events: [], text: { 'x.html': '<p>' } });
// What the Workers' host is told to start: the Workers only, never a frame UI.
const H = (m) => ({ id: m.id, name: m.name, worker: m.worker, frames: [], text: {} });
// A slot's element on the page, which a frame UI's own host goes into (GZ_MODS.attach, as a tile's fill does).
const slotEl = () => ({ isConnected: true, style: {}, append(c) { c.isConnected = true; } });
const stopsOf = (p) => p.sent.filter((m) => m.op === 'stopped').map((m) => [m.mod, m.why]);

test('the scene kind follows the winning background after installed and running mod parts merge', async () => {
  const X = require('../lib/lookparts.js');
  const p = page();
  let override;
  p.chrome.runtime.sendMessage = async () => ({ ok: true, value: override });
  p.G.start([W('a')]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  const source = read('content.js');
  const start = source.indexOf('  const partsOf ='), end = source.indexOf('  const sceneModule =', start);
  assert.ok(start >= 0 && end > start, 'scene kind helpers are bounded by their declarations');
  const scene = source.slice(start, end);
  p.ctx.worn = { bg: { kind: 'gradient' } };
  vm.runInContext(`let modBg = false; (() => { ${read('features/lookparts.js').split('\n').find((l) => l.startsWith('  const bgKind ='))}\nglobalThis.GZ_XPARTS_PAGE = { bgKind }; })();`, p.ctx);
  vm.runInContext(`${scene}\nglobalThis.kind = bgKind; globalThis.draws = sceneKind;`, p.ctx);
  const shader = { shader: { src: 'vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }' } }, layers = { layers: [{ k: 'noise' }] };
  try {
    for (const [installed, running, kind] of [[shader, layers, 'layers'], [layers, shader, 'shader']]) {
      const base = X.over(null, [{ bg: installed }]);
      vm.runInContext('modBg = true;', p.ctx);
      p.ctx.GZ_CTX = { parts: () => p.G.parts(base) };
      override = { bg: running };
      port.postMessage({ mod: 'a', via: 'worker', id: 1, call: 'look.override', args: [] });
      await settle();
      eq(p.G.parts(base).bg, running, 'running code wins the entire background');
      assert.equal(p.ctx.kind(), kind);
      assert.equal(p.ctx.draws(), true, 'the winning background can draw');
      override = null;
      port.postMessage({ mod: 'a', via: 'worker', id: 2, call: 'look.override', args: [] });
      await settle();
      assert.equal(p.ctx.kind(), installed.shader ? 'shader' : 'layers', 'clearing code gives the installed background back');
    }
    vm.runInContext('modBg = false;', p.ctx);
    override = { bg: layers };
    port.postMessage({ mod: 'a', via: 'worker', id: 3, call: 'look.override', args: [] });
    await settle();
    assert.equal(p.ctx.kind(), 'layers', 'code alone can override the selected kind');
    const merged = p.ctx.GZ_CTX.parts();
    p.ctx.kind();
    assert.equal(p.ctx.GZ_CTX.parts(), merged, 'asking for the kind does not evict the merged parts cache');
    override = { cursor: { kind: 'glow' } };
    port.postMessage({ mod: 'a', via: 'worker', id: 4, call: 'look.override', args: [] });
    await settle();
    assert.equal(p.ctx.kind(), 'gradient', 'an unrelated code override preserves the selected kind');
  } finally { port.close(); }
});

test('one post on the host\'s first load, with the nonce in its address; nothing on a quiz or tool page', async () => {
  const p = page();
  p.G.start([W('a')]);
  const f = p.frames[0];
  assert.match(f.src, /^chrome-extension:\/\/glaze\/mods\/host\.html#u{72}$/);
  const { port, got } = await p.load();
  eq(f.posted.map((x) => [x.data, x.origin, x.ports.length]), [[{ type: 'glaze:host', nonce: 'u'.repeat(72) }, '*', 1]]);
  eq(got[0], { op: 'start', mods: [H(W('a'))], boot: 'chrome-extension://glaze/mods/boot.js' });
  // A second load is the host navigated away: no second post; a new host instead.
  for (const g of f.listeners.load) g();
  await settle();
  assert.equal(f.posted.length, 1);
  assert.equal(p.frames.length, 2);
  assert.equal(p.appended[0].isConnected, false);
  port.close();
  for (const path of ['/courses/1/quizzes/2/take', '/courses/1/external_tools/3', '/ultra/courses/_1_1/outline/assessment/_2_1', '/mod/quiz/attempt.php']) {
    const q = page({ path });
    q.G.start([W('a')]);
    assert.equal(q.frames.length, 0, path);
  }
});

test('calls go to the worker as glaze:mod with the host\'s tags, and come back to the host; a busy mod waits', async () => {
  const p = page();
  p.G.start([W('a')]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  port.postMessage({ mod: 'a', via: 'worker', id: 4, call: 'theme', args: [] });
  port.postMessage({ mod: 'zz', via: 'worker', id: 5, call: 'theme', args: [] });
  await settle();
  eq(p.sent.filter((m) => m.type === 'glaze:mod'), [{ type: 'glaze:mod', mod: 'a', via: 'worker', call: 'theme', args: [] }]);
  eq(got.slice(1).sort((x, y) => x.id - y.id), [{ mod: 'a', via: 'worker', id: 4, ok: true, value: 'answer to theme' }, { mod: 'zz', via: 'worker', id: 5, ok: false, error: 'busy' }]);
  eq(p.sent.find((m) => m.op === 'runtime'), { type: 'glaze:modpage', op: 'runtime', ok: true }, 'the sandbox ran: kept for the editor');
  port.close();
});

test('a Worker that stops answering is ended alone; the host and the others go on', async () => {
  const p = page();
  p.G.start([W('a'), W('b')]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  // The host answers every ping, and so does b; a never does.
  port.onmessage = (e) => { got.push(e.data); if (Number.isSafeInteger(e.data.ping)) { port.postMessage({ pong: e.data.ping }); port.postMessage({ pong: e.data.ping, mod: 'b' }); } };
  await p.tick(4000);
  eq(stopsOf(p), []);
  await p.tick(3000);
  assert.ok(got.some((m) => m.kill === 'a'));
  assert.ok(!got.some((m) => m.kill === 'b'));
  eq(stopsOf(p), [['a', 'hung']]);
  assert.equal(p.frames.length, 1, 'the same host');
  eq(p.G.stats().gone, { a: 'hung' });
  port.close();
});

test('a frozen host goes, the mod whose frame UI froze it is stopped, and the others start again in a new host without it', async () => {
  const p = page();
  p.G.start([W('a'), F('f')]);
  const first = await p.load();
  first.port.postMessage({ ready: true });
  await settle();
  p.G.attach('f', 'tile:x', slotEl());
  assert.equal(p.frames.length, 2, 'the frame UI has a host of its own, in its slot');
  const slot = await p.load();
  eq(slot.got[0], { op: 'start', mods: [{ id: 'f', name: 'f', worker: null, frames: [{ slot: 'tile:x', file: 'x.html' }], text: { 'x.html': '<p>' } }], boot: 'chrome-extension://glaze/mods/boot.js' });
  slot.port.postMessage({ ready: true });
  await settle();
  await p.tick(6100); // both hosts have gone quiet: the beat sees 5 s without a word
  assert.equal(p.appended[0].isConnected, false, 'the frozen host is removed');
  eq(stopsOf(p), [['f', 'hung']]);
  assert.equal(p.frames.length, 3);
  const second = await p.load();
  eq(second.got[0], { op: 'start', mods: [H(W('a'))], boot: 'chrome-extension://glaze/mods/boot.js' }, 'restarted without it');
  first.port.close(); second.port.close(); slot.port.close();
});

test('a frame UI named by a long task in its own host is stopped at once; the Workers\' host goes on', async () => {
  const p = page();
  p.G.start([F('f'), F('g')]);
  const first = await p.load();
  first.port.postMessage({ ready: true });
  await settle();
  p.G.attach('f', 'tile:x', slotEl());
  const f = await p.load();
  p.G.attach('g', 'tile:x', slotEl());
  const g = await p.load();
  f.port.postMessage({ ready: true }); g.port.postMessage({ ready: true });
  f.port.postMessage({ slow: 'f', ms: 900 });
  g.port.postMessage({ slow: 'f', ms: 2500 });
  await settle();
  eq(stopsOf(p), [], 'under two seconds is slow, not frozen; and a host speaks only for its own mod');
  f.port.postMessage({ slow: 'f', ms: 2500 });
  await settle();
  eq(stopsOf(p), [['f', 'hung']]);
  assert.ok(first.got.some((m) => m.kill === 'f'), 'its Worker ended too');
  eq(p.G.stats().slotHosts, 1, 'g\'s frame UI goes on');
  assert.equal(p.frames.length, 3, 'no new host');
  first.port.close(); f.port.close(); g.port.close();
});

test('a host that never answers blames no mod, is tried a few times, then code mods are recorded as not running here', async () => {
  const p = page();
  p.G.start([F('f')]);
  for (let i = 0; i < 6; i++) { if (p.frames.length > i) await p.load(); await p.tick(6100); }
  eq(stopsOf(p), []);
  assert.equal(p.frames.length, 4, 'the first host and three more');
  eq(p.sent.filter((m) => m.op === 'runtime'), [{ type: 'glaze:modpage', op: 'runtime', ok: false }]);
  assert.equal(p.G.stats().running, false);
});

test('a host that says it isn\'t the sandbox stops everything at once, for good on this page', async () => {
  const p = page();
  p.G.start([W('a')]);
  const { port } = await p.load();
  port.postMessage({ ready: false });
  await settle();
  assert.equal(p.appended[0].isConnected, false);
  eq(p.sent.filter((m) => m.op === 'runtime'), [{ type: 'glaze:modpage', op: 'runtime', ok: false }]);
  await p.tick(20000);
  assert.equal(p.frames.length, 1, 'no new host');
  port.close();
});

test('when Glaze is reloaded under the page, everything stops at the next heartbeat', async () => {
  const p = page();
  p.G.start([W('a')]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  delete p.chrome.runtime.id;
  await p.tick(2100);
  assert.equal(p.appended[0].isConnected, false);
  assert.equal(p.G.stats().running, false);
  await p.tick(20000);
  assert.equal(p.frames.length, 1);
  port.close();
});

test('dev mode changes remove the old host immediately and refresh the runnable list', async () => {
  let list = [W('a'), W('b')];
  const p = page({ list: () => list });
  p.G.start(list);
  const first = await p.load();
  first.port.postMessage({ ready: true });
  await settle();
  list = [W('b')];
  p.chrome.changed({ modDev: { oldValue: true, newValue: false } }, 'local');
  assert.equal(p.appended[0].isConnected, false, 'stops even a frozen host before the list comes back');
  await p.tick(100);
  const second = await p.load();
  second.port.postMessage({ ready: true });
  await settle();
  eq(second.got.find((m) => m.op === 'start').mods, [H(W('b'))]);
  list = [W('a'), W('b')];
  p.chrome.changed({ modDev: { oldValue: false, newValue: true } }, 'local');
  await p.tick(100);
  const third = await p.load();
  third.port.postMessage({ ready: true });
  await settle();
  eq(third.got.find((m) => m.op === 'start').mods, list.map(H));
  p.G.stop();
  for (const x of [first, second, third]) x.port.close();
});

test('revocation rebuilds the host without the mod; changed code restarts it', async () => {
  let list = [W('a'), W('b')];
  const p = page({ list: () => list });
  p.G.start(list);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  list = [W('b')];
  p.chrome.changed({ ['mod:a']: { newValue: { enabled: false, blocked: 'malware' } } }, 'local');
  await p.tick(100);
  assert.equal(p.appended[0].isConnected, false, 'revocation removes the entire old host');
  assert.equal(p.frames.length, 2, 'b restarts alone');
  const second = await p.load();
  port.postMessage({ mod: 'a', via: 'worker', id: 1, call: 'theme', args: [] });
  await settle();
  assert.equal(p.sent.filter((m) => m.type === 'glaze:mod').length, 0, 'the revoked port reaches no broker');
  list = [{ ...W('b'), worker: 'code v2' }];
  p.chrome.changed({ ['mod:b']: { newValue: {} } }, 'local');
  await p.tick(100);
  assert.equal(p.frames.length, 3, 'new code: a new host');
  assert.ok(second.got.some((m) => m.event === 'stop'), 'the old one heard stop first');
  second.port.close();
  port.close();
});

// ---- content.js: when features/mods.js is asked for ------------------------------------------------------------------------
test('content.js loads the page side only in the top frame, where the package has the sandbox, once the worker names a mod to run', async () => {
  const src = read('content.js');
  const gate = src.slice(src.indexOf('  const modsIn ='), src.indexOf('  ready.then(() => modsIn(true));'));
  const run = async ({ top = true, isPreview = false, on = true, sandbox = true, index = ['abcdefghijklmnop'], mods = [{ id: 'abcdefghijklmnop' }], loaded = false } = {}) => {
    const asked = [], started = [], messages = [];
    const ctx = vm.createContext({
      isPreview, settings: {}, on: () => on, no: () => {},
      local: (fn) => fn({ get: (k, cb) => { assert.equal(k, 'mods'); cb(index === null ? {} : { mods: index }); } }),
      chrome: { runtime: { getManifest: () => (sandbox ? { sandbox: { pages: ['mods/host.html'] } } : {}), sendMessage: async (m) => { messages.push(m); return { ok: true, mods }; } } },
      need: async (file) => { asked.push(file); ctx.GZ_MODS = { start: (l) => started.push(l) }; },
    });
    ctx.window = {};
    ctx.window.top = top ? ctx.window : {};
    ctx.globalThis = ctx;
    if (loaded) ctx.GZ_MODS = { start: () => started.push('again') };
    vm.runInContext(`const partsIn = () => {}; const solo = window.top === window;\n${gate}\nmodsIn();`, ctx);
    await settle();
    return { asked, started: plain(started), messages: plain(messages) };
  };
  eq(await run(), { asked: ['features/mods.js'], started: [null], messages: [{ type: 'glaze:modpage', op: 'list' }] });
  for (const [why, opts] of [['a frame', { top: false }], ['the editor preview', { isPreview: true }], ['Glaze off or a quiz page', { on: false }], ['no sandbox in this package (Firefox, Safari)', { sandbox: false }], ['loaded already', { loaded: true }]])
    eq((await run(opts)).asked, [], why);
  eq(await run({ index: [] }), { asked: [], started: [], messages: [] }, 'nothing installed: not even a message');
  eq(await run({ index: null }), { asked: [], started: [], messages: [] }, 'never installed any');
  eq((await run({ mods: [] })).asked, [], 'installed, but none on: the worker names none');
});


test('the blocklist package key refreshes the running list', async () => {
  let list = [W('a')];
  const p = page({ list: () => list });
  p.G.start(list);
  await p.load();
  list = [];
  p.chrome.changed({ modsBlocklist: { newValue: { list: { mods: ['a'] } } } }, 'local');
  await p.tick(100);
  assert.equal(p.G.stats().running, false);
});


test('revocation removes even a frozen host before waiting for the broker', async () => {
  let list = [F('a'), W('b')];
  const p = page({ list: () => list });
  p.G.start(list);
  const first = await p.load();
  list = [W('b')];
  p.chrome.changed({ ['mod:a']: { newValue: { enabled: false } } }, 'local');
  assert.equal(p.appended[0].isConnected, false, 'no kill message can reach a frozen host');
  await p.tick(100);
  const second = await p.load();
  eq(second.got[0].mods.map((m) => m.id), ['b']);
  p.chrome.changed({ enabled: { newValue: false } }, 'sync');
  assert.equal(p.appended[1].isConnected, false, 'Glaze off removes it synchronously');
  first.port.close(); second.port.close();
});

test('hidden pages still detect extension reload and exhausted hosts stay stopped', async () => {
  const p = page();
  p.G.start([W('a')]);
  await p.load();
  p.ctx.document.hidden = true;
  await p.tick(2100);
  delete p.chrome.runtime.id;
  await p.tick(2100);
  assert.equal(p.G.stats().running, false);
  const q = page();
  q.G.start([W('a')]);
  const first = await q.load();
  first.port.postMessage({ ready: false });
  await settle();
  q.G.start([W('a')]);
  assert.equal(q.frames.length, 1, 'a later start cannot bypass the runtime failure');
  first.port.close();
});

test('showing a page after extension reload does not use the removed run', async () => {
  const p = page();
  p.G.start([F('a')]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  delete p.chrome.runtime.id;
  assert.doesNotThrow(() => p.ctx.document.onvisibilitychange());
  port.close();
});


test('the host rejects oversized and cyclic messages before forwarding, and bounds pending calls per mod', async () => {
  const h = host();
  const port = h.post(hello), up = inbox(port);
  port.postMessage({ op: 'start', mods: [{ id: 'a', worker: 'code', frames: [] }] });
  await settle();
  const a = h.workers[0];
  const cyclic = []; cyclic.push(cyclic);
  for (const args of [['é'.repeat(600 * 1024)], cyclic]) a.onmessage({ data: { id: 100, call: 'storage.set', args } });
  await settle();
  assert.equal(up.length, 1, 'oversized or uncloneable JSON stays at the first trusted hop');
  eq(a.sent.slice(1).map((m) => m.error), ['size', 'args']);
  for (let id = 1; id <= 65; id++) a.onmessage({ data: { id, call: 'theme', args: [] } });
  await settle();
  assert.equal(up.filter((m) => m.call).length, 64);
  assert.equal(a.sent.at(-1).error, 'busy');
  port.postMessage({ mod: 'a', via: 'worker', id: 1, ok: true, value: 1 });
  await settle();
  a.onmessage({ data: { id: 66, call: 'theme', args: [] } });
  await settle();
  assert.equal(up.at(-1).id, 66, 'a reply frees a pending slot');
  port.close();
});


test('a newly loaded runtime starts from a fresh broker reply', async () => {
  const p = page({ list: () => [W('fresh')] });
  p.G.start();
  await p.tick(100);
  assert.equal(p.frames.length, 1, 'the runtime asks for current enabled mods after loading');
  const { port, got } = await p.load();
  eq(got[0].mods.map((m) => m.id), ['fresh']);
  port.close();
});


test('data Workers cannot communicate across mods or create a fresh Worker realm', async () => {
  const h = host(), port = h.post(hello);
  port.postMessage({ op: 'start', mods: [{ id: 'a', worker: 'code', frames: [] }] });
  await settle();
  const navigatorPrototype = { locks: { request() {} }, storage: { getDirectory() {} }, serviceWorker: {} };
  const ctx = vm.createContext({ BroadcastChannel: function () {}, Worker: function () {}, SharedWorker: function () {}, RTCPeerConnection: function () {}, caches: {}, indexedDB: {}, navigator: Object.create(navigatorPrototype), addEventListener() {}, postMessage() {} });
  ctx.self = ctx;
  vm.runInContext(await h.blobs[0].text(), ctx);
  for (const key of ['BroadcastChannel', 'Worker', 'SharedWorker', 'RTCPeerConnection', 'caches', 'indexedDB']) {
    assert.equal(ctx[key], undefined, key);
    assert.throws(() => Object.defineProperty(ctx, key, { value: 1 }), TypeError, key);
  }
  for (const key of ['locks', 'storage', 'serviceWorker']) assert.equal(navigatorPrototype[key], undefined, key);
  port.close();
});


test('the bootstrap URL comes from runtime.getURL, even when the sandbox host resolves to its static id', async () => {
  const p = page();
  p.chrome.runtime.getURL = (file) => `chrome-extension://${file === 'mods/boot.js' ? 'dynamic-id' : 'static-id'}/${file}`;
  p.G.start([W('a')]);
  const { port, got } = await p.load();
  assert.equal(got[0].boot, 'chrome-extension://dynamic-id/mods/boot.js');
  port.close();
});


test('an unrelated blocklist refresh never resurrects a watchdog-stopped mod', async () => {
  const mods = [F('bad'), W('good')], p = page({ list: () => mods });
  p.G.start(mods);
  const first = await p.load();
  first.port.postMessage({ ready: true });
  await settle();
  p.G.attach('bad', 'tile:x', slotEl());
  const slot = await p.load();
  slot.port.postMessage({ ready: true }); slot.port.postMessage({ slow: 'bad', ms: 2500 });
  await settle();
  eq(p.G.stats().gone, { bad: 'hung' });
  p.chrome.changed({ modsBlocklist: { newValue: { list: { mods: [] } } } }, 'local');
  await p.tick(100);
  const second = await p.load();
  eq(second.got[0].mods.map((m) => m.id), ['good']);
  eq(p.G.stats().gone, { bad: 'hung' });
  p.G.attach('bad', 'tile:x', slotEl());
  eq(p.G.stats().slotHosts, 0, 'its frame UI doesn\'t start again either');
  first.port.close(); second.port.close(); slot.port.close();
});

test('what the worker answered is applied: Look parts over the student\'s in the student\'s order, replacements, broadcasts, data events by grant', async () => {
  const A = { ...W('a'), on: ['effect:complete', 'nav'], events: ['todo'], slots: [{ key: 'nav', name: 'Rail', file: null }] };
  const B = { ...W('b'), on: ['effect:complete', 'bg'], events: [] };
  const p = page({ list: () => [A, B] });
  const answers = { 'rules.set': [{ p: 'ultra.nav', do: 'style', st: { r: 4 } }], 'look.override': { cursor: { kind: 'trail' } }, broadcast: { hi: 1 } };
  const send = p.chrome.runtime.sendMessage;
  p.chrome.runtime.sendMessage = async (m) => (m.type === 'glaze:mod' ? { ok: true, value: answers[m.call] } : send(m));
  p.G.start([A, B]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  assert.equal(p.G.parts(null), null, 'nothing laid over yet');
  port.postMessage({ mod: 'b', via: 'worker', id: 1, call: 'rules.set', args: [] });
  port.postMessage({ mod: 'b', via: 'worker', id: 2, call: 'look.override', args: [] });
  await settle();
  answers['look.override'] = { cursor: { kind: 'glow' } };
  await settle();
  port.postMessage({ mod: 'a', via: 'worker', id: 3, call: 'look.override', args: [] });
  await settle();
  const base = { rules: [{ p: 'ultra.nav', do: 'hide' }] };
  eq(p.G.parts(base), { rules: [{ p: 'ultra.nav', do: 'hide' }, { p: 'ultra.nav', do: 'style', st: { r: 4 } }], cursor: { kind: 'glow' } }, 'the first mod in order wins a part; rules add up after the Look\'s');
  assert.ok(Object.isFrozen(p.G.parts(base).rules), 'frozen, as the Look\'s are');
  assert.ok(p.ctx.document.events.includes('glaze:parts'), 'features are told');
  assert.equal(p.G.replaces('effect:complete'), true);
  assert.equal(p.G.replaces('nav'), true, 'a has a nav slot and the student turned it on');
  assert.equal(p.G.replaces('bg'), false, 'b turned bg on but has no background slot');
  port.postMessage({ mod: 'a', via: 'frame:rail:x', id: 4, call: 'broadcast', args: [{ hi: 1 }] });
  await settle();
  eq(got.filter((m) => m.event === 'broadcast'), [{ event: 'broadcast', mod: 'a', data: { hi: 1 }, except: 'frame:rail:x' }], 'to its own mod only, not back to the sender');
  p.ctx.document['onglaze:moment']({ detail: { name: 'complete' } });
  await settle();
  eq(got.filter((m) => m.event === 'complete' || m.event === 'effect').map((m) => [m.event, m.mod]), [['complete', 'a'], ['effect', 'a']], 'the data event to the granted mod, the effect to the first that replaces it');
  p.ctx.document.documentElement.getAttribute = (k) => (k === 'data-gz-motion' ? 'off' : null);
  p.ctx.document['onglaze:moment']({ detail: { name: 'complete' } });
  await settle();
  eq(got.filter((m) => m.event === 'effect').length, 1, 'no effect with motion off');
  port.postMessage({ stopped: 'a', why: 'error' });
  await settle();
  eq(p.G.parts(base), { rules: [{ p: 'ultra.nav', do: 'hide' }, { p: 'ultra.nav', do: 'style', st: { r: 4 } }], cursor: { kind: 'trail' } }, 'a stopped mod\'s parts go with it');
  assert.equal(p.G.replaces('nav'), false);
  port.close();
});

test('the glaze client\'s v1 calls: transforms answer when Glaze asks, palette commands run in the mod, a Worker\'s frames stop while paused', async () => {
  const src = read('mods/host.js');
  const client = src.slice(src.indexOf('  function glazeClient(port) {'), src.indexOf('\n  }\n', src.indexOf('  function glazeClient(port) {')) + 4);
  const ch = new MessageChannel();
  const ctx = vm.createContext({ setTimeout, clearTimeout, Promise, Error, TypeError, Object, Map, Number, String, Array, performance });
  ctx.globalThis = ctx;
  vm.runInContext(`${client}\nglazeClient(port);`, Object.assign(ctx, { port: ch.port1 }));
  const out = inbox(ch.port2);
  ch.port2.postMessage({ run: [`var ran = 0, frames = 0;
    glaze.cards.decorate((courses) => Object.fromEntries(courses.map((c) => [c.id, { badge: c.name.slice(0, 3) }])));
    glaze.nav.items((items) => ({ order: items.map((i) => i.id).reverse() }));
    glaze.palette.commands([{ id: 'water', title: 'Water', run: () => { ran++; } }]);
    glaze.ui.render('tile:garden', { type: 'text', text: 'hi' });
    const tick = () => { frames++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);`] });
  await settle();
  eq(out.slice(0, 2), [{ id: 1, call: 'palette.set', args: [[{ id: 'water', title: 'Water' }]] }, { id: 2, call: 'ui.render', args: ['tile:garden', { type: 'text', text: 'hi' }] }], 'the function stays in the mod');
  ch.port2.postMessage({ event: 'cards', data: { courses: [{ id: '1', name: 'Biology' }] } });
  ch.port2.postMessage({ event: 'nav.items', data: { items: [{ id: 'a' }, { id: 'b' }] } });
  ch.port2.postMessage({ event: 'palette.run', data: { id: 'water' } });
  await settle();
  const calls = out.filter((m) => m.call === 'cards.set' || m.call === 'nav.set').map((m) => [m.call, m.args]);
  eq(calls, [['cards.set', [{ 1: { badge: 'Bio' } }]], ['nav.set', [{ order: ['b', 'a'] }]]]);
  assert.equal(ctx.ran, 1);
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(ctx.frames >= 2, 'frames run');
  ch.port2.postMessage({ event: 'canvas.pause', data: { paused: true } });
  await settle();
  const held = ctx.frames;
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(ctx.frames <= held + 1, 'no frames while paused');
  ch.port2.postMessage({ event: 'canvas.pause', data: { paused: false } });
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(ctx.frames > held + 1, 'and they come back');
  ch.port2.postMessage({ event: 'canvas.pause', data: { paused: true } });
  await settle();
  ch.port1.close();
});

test('Look rules and every mod rule layer merge in student order without changing part precedence', async () => {
  const p = page();
  p.G.start([W('a'), W('b')]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  const baseRule = { p: 'ultra.nav', do: 'hide' };
  const rule = (t) => ({ p: 'ultra.nav', do: 'label', t });
  const answers = {
    a: { 'look.override': { rules: [rule('a Look')], nav: { order: ['courses'] } }, 'rules.set': [rule('a rules')] },
    b: { 'look.override': { rules: [rule('b Look')], cursor: { kind: 'trail' } }, 'rules.set': [rule('b rules')], 'nav.set': { order: ['calendar'] } },
  };
  p.chrome.runtime.sendMessage = async (m) => ({ ok: true, value: answers[m.mod][m.call] });
  for (const [mod, calls] of Object.entries(answers)) for (const call of Object.keys(calls)) port.postMessage({ mod, via: 'worker', id: 1, call, args: [] });
  await settle();
  const base = { rules: [baseRule] };
  eq(p.G.parts(base), { rules: [baseRule, rule('a Look'), rule('a rules'), rule('b Look'), rule('b rules')], nav: { order: ['courses'] }, cursor: { kind: 'trail' } });
  eq(base, { rules: [baseRule] });
  port.close();
});

test('a detached frame cannot apply a broker reply after its slot has been replaced', async () => {
  const p = page();
  p.G.start([F('a')]);
  const main = await p.load();
  main.port.postMessage({ ready: true });
  await settle();
  const detach = p.G.attach('a', 'tile:x', slotEl());
  const old = await p.load();
  old.port.postMessage({ ready: true });
  let answer;
  p.chrome.runtime.sendMessage = () => new Promise((resolve) => { answer = resolve; });
  old.port.postMessage({ mod: 'a', via: 'frame:tile:x', id: 1, call: 'palette.set', args: [] });
  await settle();
  assert.equal(typeof answer, 'function');
  detach();
  p.G.attach('a', 'tile:x', slotEl());
  answer({ ok: true, value: [{ id: 'stale', title: 'Stale command' }] });
  await settle();
  eq(p.G.cmds(), [], 'only a live frame may apply its answer');
  main.port.close(); old.port.close();
});

test('a tool inserted without a route change stops mods on the next page sweep', async () => {
  const p = page();
  p.G.start([W('a')]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  p.ctx.document.getElementById = (id) => id === 'tool_content' ? {} : null;
  p.G.pass();
  assert.equal(p.G.stats().running, false);
  port.close();
});


test('the host stops a mod that floods messages while other mods keep running', async () => {
  const h = host(), port = h.post(hello), got = inbox(port);
  port.postMessage({ op: 'start', mods: [H(W('a')), H(W('b'))] });
  await settle();
  for (let i = 0; i < 241; i++) h.workers[0].onmessage({ data: { pong: i } });
  await settle();
  assert.equal(h.workers[0].terminated, true);
  assert.equal(h.workers[1].terminated, false);
  eq(got.at(-1), { stopped: 'a', why: 'error' });
  port.close();
});

test('the host bounds Worker bitmap dimensions and frame rate and drops frames while paused', async () => {
  let clock = 1000;
  const h = host({ now: () => clock }), port = h.post(hello), got = inbox(port);
  port.postMessage({ op: 'start', mods: [H(W('a'))] });
  await settle();
  const send = (w, height, slot = 'tile:x') => {
    const bm = new h.ImageBitmap(w, height);
    h.workers[0].onmessage({ data: { frame: slot, bm } });
    return bm;
  };
  const hidden = send(100, 100);
  assert.equal(hidden.closed, true, 'no pixels before Glaze supplies a visible canvas');
  port.postMessage({ event: 'canvas.size', mod: 'a', data: { slot: 'tile:x', w: 100, h: 100 } });
  port.postMessage({ event: 'canvas.pause', mod: 'a', data: { paused: false } });
  await settle();
  assert.equal(send(8192, 8192).closed, true, 'the Worker cannot enlarge the page canvas');
  assert.equal(send(100, 100, 'tile:unknown').closed, true);
  send(100, 100);
  clock += 10;
  assert.equal(send(100, 100).closed, true, 'at most 60 frames a second per canvas');
  clock += 7;
  send(100, 100);
  await settle();
  assert.equal(got.filter((m) => m.frame).length, 2);
  port.postMessage({ event: 'canvas.pause', mod: 'a', data: { paused: true } });
  await settle();
  clock += 20;
  assert.equal(send(100, 100).closed, true);
  port.close();
});

test('built-in tile replacements require opt-in and a matching slot, and student order picks the owner', async () => {
  const mod = (id, on) => ({ ...W(id), on, slots: [{ key: 'tile:timer', name: id, size: 'm', file: null }] });
  const a = mod('a', []), b = mod('b', []);
  let list = [a, b];
  const p = page({ list: () => list });
  p.G.start(list);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  assert.equal(p.G.tiles().timer, undefined, 'off by default');
  list = [{ ...a, on: ['tile:timer'] }, { ...b, on: ['tile:timer'] }];
  p.chrome.changed({ 'modReplace:a': { newValue: { 'tile:timer': true } } }, 'local');
  await p.tick(100);
  assert.equal(p.G.tiles().timer?.name, 'a');
  list.reverse();
  p.chrome.changed({ modOrder: { newValue: ['b', 'a'] } }, 'local');
  await p.tick(100);
  assert.equal(p.G.tiles().timer?.name, 'b');
  list = [{ ...b, on: ['tile:notes'] }, a];
  p.chrome.changed({ 'modReplace:b': { newValue: { 'tile:notes': true } } }, 'local');
  await p.tick(100);
  assert.equal(p.G.replaces('tile:notes'), false, 'no declared slot for that built-in');
  assert.equal(p.G.tiles().timer, undefined);
  port.close();
});

test('stopping a mod detaches its canvas observer and closes pictures that finish decoding later', async () => {
  const mod = { ...W('a'), slots: [{ key: 'tile:x', file: null }] };
  const p = page();
  p.G.start([mod]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  let decode, picture, disconnects = 0;
  const canvas = { isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 100 }), getContext: () => ({}), style: { setProperty() {} } };
  p.ctx.ResizeObserver = class { observe() {} disconnect() { disconnects++; } };
  p.ctx.atob = atob; p.ctx.Blob = Blob;
  p.ctx.createImageBitmap = () => new Promise((resolve) => { decode = resolve; });
  p.ctx.GZ_MODUI = { render: (root, tree, opts) => { picture = opts.asset('leaf.png'); return { canvas }; } };
  p.chrome.runtime.sendMessage = async () => ({ ok: true, type: 'image/png', b64: 'eA==' });
  p.G.attach('a', 'tile:x', { attachShadow: () => ({ replaceChildren() {} }) });
  await settle();
  p.G.stop(false);
  let closes = 0;
  decode({ close: () => closes++ });
  await picture;
  await settle();
  eq(p.G.stats().slots, [], 'a stopped run keeps no mounted UI');
  assert.equal(disconnects, 1);
  assert.equal(closes, 1, 'an in-flight picture is released after it arrives');
  port.close();
});

test('a changed mod omitted from the new runnable list loses all of its old overlays', async () => {
  let list = [W('a')];
  const p = page({ list: () => list });
  p.G.start(list);
  const first = await p.load();
  first.port.postMessage({ ready: true });
  const send = p.chrome.runtime.sendMessage;
  p.chrome.runtime.sendMessage = (m) => m.type === 'glaze:mod' ? Promise.resolve({ ok: true, value: [{ id: 'old', title: 'Old command' }] }) : send(m);
  first.port.postMessage({ mod: 'a', via: 'worker', id: 1, call: 'palette.set', args: [] });
  await settle();
  assert.equal(p.G.cmds().length, 1);
  list = [];
  p.chrome.changed({ 'mod:a': { oldValue: {}, newValue: {} } }, 'local');
  await p.tick(100);
  list = [W('a')];
  p.chrome.changed({ 'mod:a': { oldValue: {}, newValue: {} } }, 'local');
  await p.tick(100);
  eq(p.G.cmds(), [], 'restarting without a palette call cannot revive the old commands');
  first.port.close();
});

test('a failed picture from a stopped run cannot evict the new run picture', async () => {
  const mod = { ...W('a'), slots: [{ key: 'tile:x', file: null }] }, p = page();
  const decodes = [];
  p.ctx.atob = atob; p.ctx.Blob = Blob;
  p.ctx.createImageBitmap = () => new Promise((resolve, reject) => decodes.push({ resolve, reject }));
  p.ctx.GZ_MODUI = { render: (root, tree, opts) => { opts.asset('leaf.png').catch(() => {}); return { canvas: null }; } };
  p.chrome.runtime.sendMessage = async () => ({ ok: true, type: 'image/png', b64: 'eA==' });
  const attach = () => p.G.attach('a', 'tile:x', { attachShadow: () => ({ replaceChildren() {} }) });
  p.G.start([mod]); attach(); await settle();
  p.G.stop(false);
  p.G.start([mod]); attach(); await settle();
  decodes[0].reject(new Error('old decode failed'));
  await settle();
  attach(); await settle();
  assert.equal(decodes.length, 2, 'the new run still shares its existing picture promise');
  decodes[1].resolve({ close() {} });
  p.G.stop(false);
});

test('a frame-only mod receives its initial page and visibility events after its client is ready', async () => {
  const p = page();
  p.ctx.GZ_CTX = { site: 'ultra' };
  p.G.start([{ ...F('a'), worker: null }]);
  const main = await p.load();
  main.port.postMessage({ ready: true });
  await settle();
  p.G.attach('a', 'tile:x', slotEl());
  const frame = await p.load();
  frame.port.postMessage({ ready: true });
  frame.port.postMessage({ ran: 'a', via: 'frame:tile:x' });
  await settle();
  eq(frame.got.filter((m) => m.event).map((m) => [m.event, m.data]), [
    ['page', { site: 'ultra', kind: 'course', courseId: '1' }], ['visible', true], ['nav.items', { items: [] }],
  ]);
  assert.equal(main.got.some((m) => m.event === 'page'), false, 'the new frame greets only its own client');
  main.port.close(); frame.port.close();
});

test('a folded canvas pauses the Worker even while the page and its mount remain connected', async () => {
  const p = page();
  p.G.start([{ ...W('a'), slots: [{ key: 'tile:x', file: null }] }]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  let visible = true;
  const canvas = { isConnected: true, getBoundingClientRect: () => ({ width: visible ? 100 : 0, height: visible ? 100 : 0, top: 0, left: 0, bottom: visible ? 100 : 0, right: visible ? 100 : 0 }), getContext: () => ({}), style: { setProperty() {} } };
  p.ctx.ResizeObserver = class { observe() {} disconnect() {} };
  p.ctx.GZ_MODUI = { render: () => ({ canvas }) };
  p.G.attach('a', 'tile:x', { attachShadow: () => ({ replaceChildren() {} }) });
  await settle();
  assert.equal(got.filter((m) => m.event === 'canvas.pause').at(-1).data.paused, false);
  visible = false;
  p.G.pass();
  await settle();
  assert.equal(got.filter((m) => m.event === 'canvas.pause').at(-1).data.paused, true);
  p.G.stop(false); port.close();
});

test('Look overrides and nav layouts are immediate while full UI and effect replacements stay off', async () => {
  const mod = { ...W('a'), slots: [{ key: 'nav', file: null }, { key: 'background', file: null }] };
  const p = page();
  p.G.start([mod]);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  const look = { bg: { layers: [{ k: 'noise' }] }, fx: { complete: { kind: 'ring' } } };
  const nav = { hidden: ['calendar'] };
  p.chrome.runtime.sendMessage = async (m) => ({ ok: true, value: m.call === 'look.override' ? look : nav });
  port.postMessage({ mod: 'a', via: 'worker', id: 1, call: 'look.override', args: [] });
  port.postMessage({ mod: 'a', via: 'worker', id: 2, call: 'nav.set', args: [] });
  await settle();
  eq(p.G.parts(null), { ...look, nav });
  for (const key of ['nav', 'bg', 'effect:complete']) assert.equal(p.G.replaces(key), false, key);
  port.close();
});

// ---- Glaze's bar: nav.read, nav.items, nav.layout and a replacement ---------------------------------------------------------
// A stand-in for features/navbar.js's API: its model, the mods' items by owner, its listeners, what it was asked to open.
const fakeBar = (model) => {
  const items = new Map(), heard = {}, went = [];
  let synced = 0;
  return { items, heard, went, get synced() { return synced; }, live: () => true, model: () => model, sync: () => { synced++; },
    on(e, f) { (heard[e] ||= []).push(f); }, clear: (owner) => items.delete(owner),
    add: (owner, it) => { if (!/^[a-z][a-z0-9-]{0,31}$/.test(it.id)) return false; if (!items.has(owner)) items.set(owner, new Map()); items.get(owner).set(it.id, it); return true; },
    go: (id) => { went.push(id); return true; } };
};
const BAR = { place: 'rail', active: 'calendar', menu: null,
  groups: [{ id: 'main', label: 'Main', items: ['course', 'calendar', 'grades'] }],
  items: [{ id: 'course', label: 'Courses', icon: 'book', href: 'https://lms.test/courses', badge: '', active: false, hidden: false }, { id: 'calendar', label: 'Calendar', icon: 'calendar', href: 'https://lms.test/calendar', badge: '3', active: true, hidden: false },
    { id: 'grades', label: 'Grades', icon: 'grades', href: 'https://lms.test/grades', badge: '', active: false, hidden: true }] };

test('nav.items: a mod\'s items go to the bar under its own name, at most eight, and go with the mod', async () => {
  const p = page();
  const bar = p.ctx.GZ_NAVBAR_UI = fakeBar(BAR);
  let value;
  p.chrome.runtime.sendMessage = async (m) => (m.type === 'glaze:mod' ? { ok: true, value } : { ok: true });
  p.G.start([W('a'), W('b')]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  const ask = async (call, v, mod = 'a') => { value = v; const id = Math.random(); port.postMessage({ mod, via: 'worker', id, call, args: [] }); await settle(); return got.find((x) => x.id === id); };
  eq((await ask('nav.add', { id: 'due', label: 'Due', action: true })).ok, true);
  const item = bar.items.get('a').get('due');
  assert.equal(item.by, 'a', 'marked as the mod\'s');
  item.select();
  await settle();
  eq(got.filter((x) => x.event === 'nav.action'), [{ event: 'nav.action', mod: 'a', data: { id: 'due' } }], 'a click is told to that mod alone');
  eq((await ask('nav.update', { id: 'due', patch: { href: 'https://lms.test/x' } })).ok, true);
  assert.equal(bar.items.get('a').get('due').href, 'https://lms.test/x');
  assert.equal(bar.items.get('a').get('due').select, null, 'an href takes the action\'s place');
  eq(await ask('nav.update', { id: 'other', patch: { label: 'X' } }), { mod: 'a', via: 'worker', id: got.at(-1).id, ok: false, error: 'args' }, 'only its own items');
  for (let i = 0; i < 7; i++) await ask('nav.add', { id: `i${i}`, label: 'I', action: true });
  eq((await ask('nav.add', { id: 'nine', label: 'I', action: true })).error, 'args', 'at most eight');
  eq((await ask('nav.add', { id: 'b1', label: 'B', action: true }, 'b')).ok, true);
  eq((await ask('nav.remove', { id: 'i0' })).ok, true);
  assert.equal(bar.items.get('a').size, 7);
  port.postMessage({ stopped: 'a', why: 'error' });
  await settle();
  assert.equal(bar.items.has('a'), false, 'all of a stopped mod\'s items go');
  assert.equal(bar.items.get('b').size, 1, 'another mod\'s stay');
  port.close();
});

test('nav.read: the model is cleaned and capped, and the bar\'s events reach only granted mods', async () => {
  const p = page();
  p.ctx.GZ_NAVBAR_UI = fakeBar(BAR);
  p.chrome.runtime.sendMessage = async (m) => (m.type === 'glaze:mod' ? { ok: true, value: true } : { ok: true });
  p.G.start([{ ...W('a'), events: ['nav.read'] }, W('b')]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  p.G.pass();
  port.postMessage({ mod: 'a', via: 'worker', id: 1, call: 'nav.model', args: [] });
  await settle();
  eq(got.find((x) => x.id === 1).value, { place: 'rail', items: [{ id: 'course', label: 'Courses', icon: 'book', badge: '', active: false, group: 'Main' }, { id: 'calendar', label: 'Calendar', icon: 'calendar', badge: '3', active: true, group: 'Main' }],
    groups: [{ label: 'Main', items: ['course', 'calendar'] }], course: null, active: 'calendar' }, 'no addresses, no hidden items');
  const bar = p.ctx.GZ_NAVBAR_UI;
  for (const f of bar.heard.navigate) f({ id: 'calendar' });
  for (const f of bar.heard.sheet) f({ open: true });
  for (const f of bar.heard.change) f({});
  await settle();
  eq(got.filter((x) => x.event?.startsWith('nav.') && x.event !== 'nav.items').map((x) => [x.event, x.mod, x.data]), [['nav.navigate', 'a', { id: 'calendar' }], ['nav.sheet', 'a', { open: true }], ['nav.change', 'a', {}]]);
  eq(got.filter((x) => x.event === 'nav.items').at(-1).data, { items: [{ id: 'course', label: 'Courses' }, { id: 'calendar', label: 'Calendar' }] }, 'the older transform reads the new bar');
  port.close();
});

test('nav.layout lays over the student\'s like nav.set, first mod wins, and "Use my own" turns that mod\'s off', async () => {
  const lay = { a: { hidden: ['calendar'], place: 'top' }, b: { hidden: ['grades'] } };
  let list = [W('a'), W('b')];
  const p = page({ list: () => list });
  p.chrome.runtime.sendMessage = async (m) => (m.type === 'glaze:mod' ? { ok: true, value: lay[m.mod] } : m.op === 'list' ? { mods: list } : { ok: true });
  p.G.start(list);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  port.postMessage({ mod: 'b', via: 'worker', id: 1, call: 'nav.layout', args: [] });
  port.postMessage({ mod: 'a', via: 'worker', id: 2, call: 'nav.set', args: [] });
  await settle();
  eq(p.G.parts(null).nav, lay.a, 'the first in the student\'s order wins');
  eq(p.G.arranger(), { id: 'a', name: 'a', place: 'top' });
  list = [{ ...W('a'), arranges: false }, W('b')];
  p.chrome.changed({ 'modNavLayout:a': { newValue: false } }, 'local');
  await p.tick(100);
  eq(p.G.parts(null).nav, lay.b, 'Use my own: a\'s layout is off, the next mod\'s shows');
  eq(p.G.arranger()?.id, 'b');
  assert.equal(p.G.stats().running, true, 'without restarting the mods');
  lay.b = null;
  port.postMessage({ mod: 'b', via: 'worker', id: 4, call: 'nav.layout', args: [] });
  await settle();
  assert.equal(p.G.parts(null).nav, undefined, 'null withdraws it');
  port.close();
});

test('Use my own also withdraws a nav in Look overrides and keeps the worn layout', async () => {
  let list = [W('a'), W('b')];
  const p = page({ list: () => list });
  const layouts = { a: { hidden: ['calendar'] }, b: { hidden: ['grades'] } };
  p.chrome.runtime.sendMessage = async (m) => m.type === 'glaze:mod' ? { ok: true, value: { nav: layouts[m.mod], cursor: { kind: 'trail' } } } : { mods: list };
  p.G.start(list);
  const { port } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  for (const mod of ['a', 'b']) port.postMessage({ mod, via: 'worker', id: mod, call: 'look.override', args: [] });
  await settle();
  const base = { nav: { hidden: ['tools'] } };
  eq(p.G.parts(base).nav, layouts.a);
  list = list.map((m) => ({ ...m, arranges: false }));
  p.chrome.changed({ 'modNavLayout:a': { newValue: false }, 'modNavLayout:b': { newValue: false } }, 'local');
  await p.tick(100);
  eq(p.G.parts(base).nav, base.nav, 'restore the worn layout');
  assert.equal(p.G.parts(null).nav, undefined, 'no worn layout means no nav overlay');
  eq(p.G.parts(null).cursor, { kind: 'trail' }, 'other Look parts still apply');
  port.postMessage({ mod: 'a', via: 'worker', id: 'again', call: 'look.override', args: [] });
  await settle();
  assert.equal(p.G.parts(null).nav, undefined, 'proposing again cannot undo the opt-out');
  port.close();
});

test('a nav replacement stands in for Glaze\'s bar, hides it, comes off again, and go() needs a click in its slot first', async () => {
  let list = [{ ...W('a'), on: ['nav'], slots: [{ key: 'nav', name: 'My nav', file: null }] }];
  const p = page({ list: () => list });
  const bar = p.ctx.GZ_NAVBAR_UI = fakeBar(BAR);
  let sent = null;
  p.ctx.GZ_MODUI = { render: (root, tree, o) => { sent = o.send; return { canvas: null }; } };
  p.chrome.runtime.sendMessage = async (m) => (m.type === 'glaze:mod' ? { ok: true, value: { id: 'calendar' } } : m.op === 'list' ? { mods: list } : { ok: true });
  p.G.start(list);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  p.G.pass();
  await settle();
  assert.equal(p.G.stats().navMode, 'bar');
  assert.equal(p.G.navStands(), true, 'Glaze\'s bar is told to hide');
  const box = p.appended.find((e) => e.className === 'gz-mod-nav');
  assert.match(box.style.cssText, /position:fixed.*width:var\(--gz-navbar-left/, 'in the rail\'s room');
  const go = async (id) => { port.postMessage({ mod: 'a', via: 'worker', id, call: 'nav.go', args: [] }); await settle(); return got.find((x) => x.id === id); };
  assert.equal((await go(1)).error, 'permission', 'no click, no navigation');
  sent('click', 'b');
  p.clock += 900;
  assert.equal((await go(2)).ok, true);
  eq(bar.went, ['calendar']);
  assert.equal((await go(3)).error, 'permission', 'one click, one go');
  sent('click', 'b');
  p.clock += 1100;
  assert.equal((await go(4)).error, 'permission', 'not after a second');
  sent('click', 'b');
  port.postMessage({ mod: 'a', via: 'frame:nav', id: 5, call: 'nav.go', args: [] });
  await settle();
  assert.equal(got.find((x) => x.id === 5).error, 'permission', 'a Worker only');
  const syncs = bar.synced;
  list = [{ ...list[0], on: [] }];
  p.chrome.changed({ 'modReplace:a': { newValue: {} } }, 'local');
  await p.tick(100);
  p.G.pass();
  assert.equal(p.G.stats().navMode, '');
  assert.equal(p.G.navStands(), false);
  assert.equal(box.isConnected, false);
  assert.ok(bar.synced > syncs, 'Glaze\'s bar is drawn again');
  port.close();
});

test('replacement gestures cannot be forged by messages, another mod or another slot', async () => {
  const p = page(), bar = p.ctx.GZ_NAVBAR_UI = fakeBar(BAR), sends = new Map();
  p.ctx.GZ_MODUI = { render: (root, tree, o) => { sends.set(root, o.send); return { canvas: null }; } };
  p.chrome.runtime.sendMessage = async () => ({ ok: true, value: { id: 'calendar' } });
  const nav = { key: 'nav', name: 'Nav' }, tile = { key: 'tile:x', name: 'X' };
  p.G.start([{ ...W('a'), on: ['nav'], slots: [nav, tile] }, { ...W('b'), on: ['nav'], slots: [nav] }]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  p.G.pass();
  const other = p.ctx.document.createElement('div'), otherSlot = p.ctx.document.createElement('div');
  p.G.attach('b', 'nav', other); p.G.attach('a', 'tile:x', otherSlot);
  await settle();
  const go = async (id, mod = 'a') => { port.postMessage({ mod, via: 'worker', id, call: 'nav.go', args: [] }); await settle(); return got.find((x) => x.id === id); };
  port.postMessage({ event: 'ui', mod: 'a', data: { slot: 'nav', id: 'go', kind: 'click' } });
  assert.equal((await go(1)).error, 'permission');
  sends.get(other)('click', 'go');
  assert.equal((await go(2)).error, 'permission', 'another mod cannot lend a gesture');
  assert.equal((await go(3, 'b')).error, 'permission', 'only the active replacement may go');
  sends.get(otherSlot)('click', 'go');
  assert.equal((await go(4)).error, 'permission', 'another slot of the same mod cannot lend a gesture');
  const own = p.appended.find((e) => e.className === 'gz-mod-nav');
  sends.get(own)('click', 'go');
  assert.equal((await go(5)).ok, true);
  eq(bar.went, ['calendar']);
  port.close();
});

test('a canvas behind a replacement pauses even when its layout box stays nonzero', async () => {
  const p = page();
  p.G.start([{ ...W('a'), slots: [{ key: 'tile:x', file: null }] }]);
  const { port, got } = await p.load();
  port.postMessage({ ready: true });
  await settle();
  let visibility = 'visible';
  p.ctx.getComputedStyle = () => ({ visibility });
  const canvas = { isConnected: true, getBoundingClientRect: () => ({ width: 100, height: 100 }), getContext: () => ({}), style: { setProperty() {} } };
  p.ctx.ResizeObserver = class { observe() {} disconnect() {} };
  p.ctx.GZ_MODUI = { render: () => ({ canvas }) };
  const el = p.ctx.document.createElement('div');
  p.G.attach('a', 'tile:x', el);
  await settle();
  p.G.pass();
  await settle();
  assert.equal(got.filter((m) => m.event === 'canvas.pause').at(-1).data.paused, false);
  visibility = 'hidden'; p.G.pass(); await settle();
  assert.equal(got.filter((m) => m.event === 'canvas.pause').at(-1).data.paused, true);
  visibility = 'visible'; p.G.pass(); await settle();
  assert.equal(got.filter((m) => m.event === 'canvas.pause').at(-1).data.paused, false);
  port.close();
});
