// Where share keys live (CORE-8): a share session's keys, delete token and unsent changes are in the worker's own
// IndexedDB (glaze-sharing), a mod channel author's key too, and none of it in chrome.storage.local, which any page's
// script can read. A backup still carries the session keys out and brings them back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const G = require('../lib/sharing.js');
const S = require('../lib/sessions.js');
const N = require('../lib/notes.js');
const T = require('../lib/todo.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const NK = 'notesIdx:https://school.instructure.com/5', TK = 'todo:https://school.instructure.com/5';
const clone = (x) => (x === undefined ? x : structuredClone(x));
// A storage area that remembers everything ever written to it.
const localArea = (data = {}) => ({ data, written: [], get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])])),
  set: async (patch) => { Object.assign(data, clone(patch)); localArea.log?.push(clone(patch)); return true; }, remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; return true; } });
const database = () => {
  const stores = { sessions: new Map(), files: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), all: async (s) => [...stores[s].values()].map(clone), put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, k) => { stores[s].delete(k); } };
};
const notesDB = () => {
  const stores = { bodies: new Map(), files: new Map(), blobs: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, ks) => { for (const k of ks) stores[s].delete(k); },
    scan: async (s, p) => [...stores[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...stores[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ quota: 1e9, usage: 0 }) };
};
const server = 'http://127.0.0.1:1';
const device = () => {
  const local = localArea({ shareOn: true, [NK]: N.clean({}), [TK]: T.clean({}) }), sync = localArea(), db = database(), notes = notesDB();
  const worker = S.make({ local, sync, db, notes, relay: server, dev: true, permission: async () => true, fetch: async () => { throw new TypeError('offline'); }, WebSocket });
  return { local, sync, db, notes, worker, send: (op, rest = {}) => worker.handle({ op, ...rest }) };
};
const secrets = (st) => [st.seed, st.del, st.secret, st.pub].filter(Boolean);

test('a share session\'s keys are never written to storage.local, in a whole life of the share and through a backup', async () => {
  const a = device(), b = device();
  const writes = [];
  localArea.log = writes;
  try {
    const id = crypto.randomUUID();
    assert.equal((await N.run({ key: NK, op: 'save', id, base: 0, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title: 'Notes', html: '<p>hello</p>' }, { local: a.local }, a.notes)).ok, true);
    const { sid } = await a.send('create', { kind: 'notes', title: 'Biology', name: 'A', key: NK, ids: [id] });
    const edit = (await a.send('link', { sid, edit: true })).link;
    await b.send('join', { link: edit, name: 'B' });
    await a.send('sync', { sid }); await b.send('sync', { sid });
    const kept = (await a.db.get('sessions', sid)).st;
    assert.ok(kept.seed && kept.del, 'the session, with its keys, is in the worker\'s database');
    // Nothing the worker wrote to either storage area, nor anything now in them, holds a key or the delete token.
    const text = JSON.stringify([writes, a.local.data, a.sync.data, b.local.data, b.sync.data]);
    for (const secret of [...secrets(kept), ...secrets((await b.db.get('sessions', sid)).st)]) assert.equal(text.includes(secret), false, 'a key reached storage');
    // Export all carries the keys out, through the worker, and a new computer takes them back in.
    const exported = (await a.send('exportKeys')).keys;
    assert.deepEqual(exported.map((k) => [k.sid, k.seed, k.del]), [[sid, kept.seed, kept.del]]);
    const c = device();
    assert.deepEqual((await c.send('exportKeys')).keys, []);
    await c.send('importKeys', { keys: JSON.parse(JSON.stringify(exported)) });
    const back = (await c.send('exportKeys')).keys;
    assert.deepEqual(back, exported, 'the restored session has the keys it was exported with');
    assert.equal(c.local.data.shareOn, false, 'a restore never turns sharing on');
    const after = JSON.stringify([writes, c.local.data, c.sync.data]);
    for (const secret of secrets(kept)) assert.equal(after.includes(secret), false, 'a restored key reached storage');
  } finally { localArea.log = null; a.worker.stop(); b.worker.stop(); }
});

// ---- the worker's own copy of a mod channel author's key ------------------------------------------------------------
const OWN = (n) => `modChannelOwn:${String.fromCharCode(97 + n).repeat(16)}`;
const vaultStore = () => { const maps = { vault: new Map() }; return { maps, get: async (s, k) => clone(maps[s].get(k)), put: async (s, k, v) => { maps[s].set(k, clone(v)); }, del: async (s, k) => { maps[s].delete(k); }, all: async (s) => [...maps[s].values()].map(clone) }; };
const worker = (globals = {}, stored = {}) => {
  const local = stored, listeners = [];
  const area = (s) => ({
    get: async (k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const context = vm.createContext({
    URL, URLSearchParams, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, AbortController, AbortSignal, Response, crypto: globalThis.crypto, atob, btoa, navigator: {},
    Blob, CompressionStream, DecompressionStream, DOMException, setTimeout, clearTimeout, ...globals,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        openOptionsPage: async () => {}, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(local), sync: area({ enabled: true }), onChanged: { addListener() {} } },
      tabs: { query: async () => [] },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender) => new Promise((res) => { let n = 0; for (const f of listeners) if (f(structuredClone(m), sender, (r) => res(structuredClone(r))) === true) n++; if (!n) setTimeout(res, 0); });
  return { local, send, run: (code) => vm.runInContext(code, context) };
};
const EDITOR = { id: 'glaze', url: 'chrome-extension://x/options.html#mods', frameId: 0, origin: 'chrome-extension://x' };
// The channel code, as far as keys go: it reads and writes the author's record through the area it is given.
const channel = () => ({
  ownLink: async (id, env) => { const k = `modChannelOwn:${id}`, v = (await env.local.get(k))[k]; return v ? { ok: true, link: v.link } : { ok: false, error: 'missing' }; },
  publish: async (bytes, env) => { await env.local.set({ [OWN(0)]: { st: { seed: 'SEED', del: 'DELETE' }, link: 'read-link', at: 1 }, 'mod:x': { channel: 'link' } }); return { ok: true }; },
});

test('a mod channel author\'s key is written to the worker\'s database, not to storage.local', async () => {
  const vault = vaultStore();
  const w = worker({ GZ_SESSIONS: { database: () => vault }, GZ_MODCHANNEL: channel(), GZ_MODBUNDLE: { std: () => '', CAP: { archive: 1e6 } }, GZ_RELAY: { normalize: () => null }, GZ_SHARING: { SERVER: 'https://relay.invalid' } });
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'publish', zip: 'AAAA' }, EDITOR)).ok, true);
  assert.deepEqual(Object.keys(w.local).filter((k) => k.startsWith('modChannelOwn:')), [], 'nothing of the key in storage.local');
  assert.deepEqual(w.local['mod:x'], { channel: 'link' }, 'what is not a key is stored as before');
  assert.equal(vault.maps.vault.get(OWN(0)).st.seed, 'SEED');
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'ownLink', id: 'a'.repeat(16) }, EDITOR)).link, 'read-link', 'and the channel code finds it again');
});

test('a key still in storage.local moves when it is first asked for, and the rest move once at startup', async () => {
  const vault = vaultStore();
  const stored = { [OWN(0)]: { st: { seed: 'S0', del: 'D0' }, link: 'l0' }, [OWN(1)]: { st: { seed: 'S1', del: 'D1' }, link: 'l1' }, [OWN(2)]: { st: { seed: 'S2', del: 'D2' }, link: 'l2' }, 'mod:x': { channel: 'link' }, big: 'x'.repeat(100) };
  const w = worker({ GZ_SESSIONS: { database: () => vault }, GZ_MODCHANNEL: channel(), GZ_MODBUNDLE: { std: () => '', CAP: { archive: 1e6 } }, GZ_RELAY: { normalize: () => null }, GZ_SHARING: { SERVER: 'https://relay.invalid' } }, stored);
  assert.equal((await w.send({ type: 'glaze:modchannel', op: 'ownLink', id: 'a'.repeat(16) }, EDITOR)).link, 'l0');
  assert.deepEqual(Object.keys(w.local).filter((k) => k.startsWith('modChannelOwn:')).sort(), [OWN(1), OWN(2)], 'asked for, it moved');
  assert.equal(vault.maps.vault.get(OWN(0)).link, 'l0');
  await w.run('moveChannelKeys()');
  assert.deepEqual(Object.keys(w.local).filter((k) => k.startsWith('modChannelOwn:')), [], 'every key is out of storage.local');
  assert.deepEqual([...vault.maps.vault.keys()].sort(), [OWN(0), OWN(1), OWN(2)]);
  assert.deepEqual(vault.maps.vault.get(OWN(2)), { st: { seed: 'S2', del: 'D2' }, link: 'l2' });
  assert.deepEqual([w.local['mod:x'], w.local.big.length, w.local.channelKeysMoved], [{ channel: 'link' }, 100, true], 'nothing else moved, and it is done once');
  // Done once: a later key is not looked for again.
  w.local[OWN(3)] = { st: { seed: 'late' } };
  await w.run('moveChannelKeys()');
  assert.ok(OWN(3) in w.local);
});

test('a key that cannot be moved stays where it is and is tried again at the next start', async () => {
  const vault = vaultStore();
  vault.put = async () => { throw new Error('disk full'); };
  const w = worker({ GZ_SESSIONS: { database: () => vault }, GZ_MODCHANNEL: channel(), GZ_MODBUNDLE: { std: () => '', CAP: { archive: 1e6 } }, GZ_RELAY: { normalize: () => null }, GZ_SHARING: { SERVER: 'https://relay.invalid' } }, { [OWN(0)]: { st: { seed: 'S0' }, link: 'l0' } });
  await assert.rejects(w.run('moveChannelKeys()'), /disk full/);
  assert.ok(OWN(0) in w.local, 'the key is kept');
  assert.equal('channelKeysMoved' in w.local, false);
});

test('the session database adds its vault to a database made before it, and makes all three in a new one', async () => {
  const original = globalThis.indexedDB;
  try {
    for (const had of [['sessions', 'files'], []]) {
      const created = [];
      globalThis.indexedDB = { open: (name, version) => {
        const request = { name, version };
        const result = { objectStoreNames: { contains: (n) => had.includes(n) }, createObjectStore: (n) => { created.push(n); }, close() {},
          transaction: () => { const tx = { objectStore: () => ({ get: () => { const r = {}; queueMicrotask(() => { r.result = undefined; r.onsuccess(); tx.oncomplete(); }); return r; } }) }; return tx; } };
        request.result = result;
        queueMicrotask(() => { request.onupgradeneeded(); request.onsuccess(); });
        return request;
      } };
      assert.equal(await S.database().get('vault', 'k'), undefined);
      assert.deepEqual(created, ['sessions', 'files', 'vault'].filter((n) => !had.includes(n)));
    }
  } finally { globalThis.indexedDB = original; }
});

test('migration retries removing an exposed key after its durable vault copy already exists', async () => {
  const vault = vaultStore(), old = { st: { seed: 'FAKE-OLD' }, link: 'old' }, current = { st: { seed: 'FAKE-CURRENT' }, link: 'current' };
  vault.maps.vault.set(OWN(0), current);
  const w = worker({ GZ_SESSIONS: { database: () => vault } }, { [OWN(0)]: old });
  await w.run('moveChannelKeys()');
  assert.equal(Object.hasOwn(w.local, OWN(0)), false, 'the exposed copy is removed on retry');
  assert.deepEqual(vault.maps.vault.get(OWN(0)), current, 'the newer durable key is preserved');
  assert.equal(w.local.channelKeysMoved, true);
});

test('migration and a new author-key write cannot race and restore an older key', async () => {
  const vault = vaultStore(), old = { st: { seed: 'FAKE-OLD' } }, current = { st: { seed: 'FAKE-CURRENT' } };
  let entered, release;
  const reading = new Promise((r) => { entered = r; }), held = new Promise((r) => { release = r; });
  const put = vault.put;
  vault.put = async (s, k, v) => { if (v.st.seed === 'FAKE-OLD') { entered(); await held; } await put(s, k, v); };
  const w = worker({ GZ_SESSIONS: { database: () => vault } }, { [OWN(0)]: old });
  const moving = w.run('moveChannelKeys()');
  await reading;
  const writing = w.run(`channelLocal().set({ [${JSON.stringify(OWN(0))}]: { st: { seed: 'FAKE-CURRENT' } } })`);
  await new Promise(setImmediate);
  release();
  await Promise.all([moving, writing]);
  assert.deepEqual(vault.maps.vault.get(OWN(0)), current, 'the newer key wins after migration');
});
