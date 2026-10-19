// Exercise the real worker boundary, including browsers that omit MessageSender.documentId.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const KEY = 'notesIdx:https://school.instructure.com/5';
const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const worker = () => {
  const listeners = [], connects = [], removed = [], handled = [];
  let clock = 1000, clients = 0;
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  const ctx = vm.createContext({ URL, TextEncoder, TextDecoder, structuredClone, console, crypto, atob, btoa, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return clock; } }, navigator: {},
    GZ_SESSIONS: { make: () => ({ handle: async (m) => { handled.push(structuredClone(m)); return { ok: true, scope: m.scope }; },
      connect: () => { clients++; return () => { clients--; }; }, stop() {}, changed() {} }) },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), ctx); },
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: { addListener: (f) => listeners.push(f) }, onConnect: { addListener: (f) => connects.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      tabs: { onRemoved: { addListener: (f) => removed.push(f) } }, storage: { local: area, sync: area, onChanged: { addListener() {} } } } });
  vm.runInContext(read('lib/background.js'), ctx);
  const send = (m, s) => new Promise((resolve) => { for (const f of listeners) if (f(m, s, (r) => resolve(structuredClone(r))) === true) return; resolve(null); });
  const lms = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', tab: { id: 9 } };
  const panel = { id: 'glaze', frameId: 4, url: 'chrome-extension://glaze/sharing/quick.html', tab: { id: 9 } };
  const mint = () => send({ type: 'glaze:quick-ticket', key: KEY, note: '' }, lms);
  const port = (sender = panel) => {
    const incoming = [], disconnected = [], replies = [];
    const p = { name: 'glaze:quick', sender, closed: false, onMessage: { addListener: (f) => incoming.push(f) },
      onDisconnect: { addListener: (f) => disconnected.push(f) }, postMessage: (m) => replies.push(structuredClone(m)),
      disconnect: () => { if (!p.closed) { p.closed = true; for (const f of disconnected) f(); } } };
    for (const f of connects) f(p);
    return { p, replies, post: async (m) => { assert.ok(incoming.length, 'worker handles the quick port'); for (const f of incoming) f(m); await tick(); return replies.at(-1); } };
  };
  return { send, mint, port, panel, handled, removed, advance: (ms) => { clock += ms; }, clients: () => clients };
};

test('a URL ticket cannot authorize repeatable frame-id-only session messages', async () => {
  const w = worker(), { ticket } = await w.mint();
  const sender = { ...w.panel, url: `${w.panel.url}?t=${ticket}` };
  // At 97efb38e this succeeds, and keeps succeeding after a reload with the same frame id and no documentId.
  assert.equal((await w.send({ type: 'glaze:sessions', op: 'list' }, sender)).error, 'sender');
  assert.equal(w.handled.length, 0);
});

test('quick tickets are consumed by one live port, independent of documentId or frame reuse', async () => {
  const w = worker(), { ticket } = await w.mint(), a = w.port();
  assert.equal((await a.post({ id: 0, ticket })).ok, true);
  assert.equal((await a.post({ id: 1, op: 'list', scope: { key: 'forged' } })).scope.key, KEY);
  const b = w.port(); // Same tab and frame id, but a new document/port.
  assert.equal((await b.post({ id: 0, ticket })).ok, false);
  a.p.disconnect();
  const before = w.handled.length;
  await a.post({ id: 2, op: 'list' });
  assert.equal(w.handled.length, before, 'disconnected authority cannot be used');
  assert.equal(w.clients(), 0);
});

test('quick ports reject expired tickets and wrong sender/tab, and enforce the operation allowlist', async () => {
  const w = worker();
  for (const change of [{ tab: { id: 10 } }, { frameId: 0 }, { id: 'other' }, { origin: 'https://school.instructure.com' }, { url: 'chrome-extension://glaze/options.html' }]) {
    const { ticket } = await w.mint(), p = w.port({ ...w.panel, ...change });
    await tick();
    if (!p.p.closed) assert.equal((await p.post({ id: 0, ticket })).ok, false);
    assert.equal(w.clients(), 0);
  }
  const { ticket } = await w.mint(); w.advance(120001);
  assert.equal((await w.port().post({ id: 0, ticket })).ok, false);
  const fresh = await w.mint(), p = w.port();
  await p.post({ id: 0, ticket: fresh.ticket });
  assert.equal((await p.post({ id: 1, op: 'exportKeys' })).error, 'sender');
  assert.equal((await p.post({ id: 2, op: 'list' })).ok, true);
  p.p.disconnect();
});

test('a new opening and tab removal revoke the previous quick port', async () => {
  const w = worker(), { ticket } = await w.mint(), a = w.port();
  await a.post({ id: 0, ticket });
  await w.mint();
  assert.equal(a.p.closed, true);
  assert.equal(w.clients(), 0);
  const fresh = await w.mint(), b = w.port(); await b.post({ id: 0, ticket: fresh.ticket });
  for (const f of w.removed) f(9);
  assert.equal(b.p.closed, true);
  assert.equal(w.clients(), 0);
});
