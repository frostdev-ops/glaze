// Channel messages belong to the editor's top frame, including its extension origin.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const worker = (globals = {}, permissions) => {
  const local = {};
  const area = (s) => ({
    get: async (k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], opened = [];
  const context = vm.createContext({
    URL, URLSearchParams, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, AbortController, AbortSignal, Response, crypto: globalThis.crypto, atob, btoa, navigator: {},
    Blob, CompressionStream, DecompressionStream, DOMException, setTimeout, clearTimeout, ...globals,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        openOptionsPage: async () => { opened.push('options'); }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(local), sync: area({ enabled: true }), onChanged: { addListener() {} } },
      tabs: { query: async () => [] },
      ...(permissions && { permissions }),
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender) => new Promise((res) => { let n = 0; for (const f of listeners) if (f(structuredClone(m), sender, (r) => res(structuredClone(r))) === true) n++; if (!n) setTimeout(res, 0); });
  const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 2)); };
  return { local, send, settle, opened };
};

const EDITOR = { id: 'glaze', url: 'chrome-extension://x/options.html#mods', frameId: 0, origin: 'chrome-extension://x' };
test('channel messages require the editor top frame and its extension origin', async () => {
  let calls = 0;
  const C = Object.fromEntries(['latest', 'publish', 'ownLink', 'check', 'unfollow', 'dismiss'].map((op) => [op, async () => { calls++; return { ok: true, bytes: new Uint8Array(), link: 'read' }; }]));
  const w = worker({ GZ_MODCHANNEL: C, GZ_MODBUNDLE: { std: () => '' } });
  for (const sender of [
    { ...EDITOR, id: 'other' }, { ...EDITOR, frameId: 1 }, { ...EDITOR, origin: 'null' },
    { ...EDITOR, url: 'https://course.example/' }, { ...EDITOR, url: 'chrome-extension://x/mods/host.html' },
    { ...EDITOR, url: 'chrome-extension://x/options.html.evil' },
  ]) for (const op of ['follow', 'publish', 'ownLink', 'check', 'unfollow', 'dismiss']) {
    assert.equal((await w.send({ type: 'glaze:modchannel', op, id: 'a'.repeat(16), link: 'x' }, sender)).error, 'sender');
  }
  assert.equal(calls, 0);
  assert.deepEqual(w.local, {});
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'follow', link: 'x' }, EDITOR)).ok, true);
  assert.equal(calls, 1);
});

test('an invalid Check now id never expands into checking every mod', async () => {
  let calls = 0;
  const w = worker({ GZ_MODCHANNEL: { check: async () => { calls++; return { ok: true }; } } });
  for (const id of ['', '../other', 42, null, {}, 'a'.repeat(17)])
    assert.equal((await w.send({ type: 'glaze:modchannel', op: 'check', id }, EDITOR)).error, 'bad');
  assert.equal(calls, 0);
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'check' }, EDITOR)).ok, true);
  assert.equal(calls, 1);
});

// A channel on a relay of the student's own (a link names its server): reached only while Glaze holds that relay's host,
// as Sharing's relays are (lib/sessions.js); Glaze's own relay is a required host.
test('a channel on a relay Glaze does not hold is refused before any request; Glaze\'s own relay is always reached', async () => {
  const fetched = [];
  const held = new Set(require('../manifest.json').host_permissions);
  const C = { latest: async (link, env) => { await env.fetch(`${link}/v1/x`, {}); return { bytes: new Uint8Array(), link }; } };
  const w = worker({ GZ_MODCHANNEL: C, GZ_MODBUNDLE: { std: () => '' }, fetch: async (u) => { fetched.push(u); return new Response('{}'); } },
    { contains: async ({ origins }) => origins.every((o) => held.has(o) || [...held].some((p) => p.startsWith('https://*.') && new URL(o.slice(0, -1)).hostname.endsWith(p.slice(9, -2)))) });
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'follow', link: 'https://relay.school.example' }, EDITOR)).ok, false);
  assert.deepEqual(fetched, [], 'no request to a relay the browser would refuse');
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'follow', link: 'https://share.frostdev.io' }, EDITOR)).ok, true);
  held.add('https://relay.school.example/*');
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'follow', link: 'https://relay.school.example' }, EDITOR)).ok, true);
  assert.deepEqual(fetched, ['https://share.frostdev.io/v1/x', 'https://relay.school.example/v1/x']);
});
