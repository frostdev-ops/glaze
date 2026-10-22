// Where the files kept for a Look's background live (lib/media.js): the bytes in the worker's own IndexedDB, a small index in
// storage.local, a one-time move of what an older Glaze kept as base64 in storage.local, a pending slot for a gallery or share
// offer that Cancel empties, and the clean-up of files no Look names any more. Then the worker's side (lib/background.js),
// the editor's (options.js) and a page's (lib/scene-media.js), each run from its own source with stand-ins.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/media.js');
const X = require('../lib/lookparts.js');
const S = require('../lib/share.js');
const G = require('../defaults.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const clone = (x) => (x === undefined ? x : structuredClone(x));
// storage.local, refusing get(null): nothing about kept media may read all of it.
const localArea = (data = {}) => ({
  data,
  get: async (keys) => {
    if (keys === null || keys === undefined) throw new Error('get(null) reads every file in storage.local');
    return Object.fromEntries([].concat(keys).filter((k) => k in data).map((k) => [k, clone(data[k])]));
  },
  set: async (patch) => { Object.assign(data, clone(patch)); return true; },
  remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; return true; },
});
const filesStore = (map = new Map()) => ({
  map,
  get: async (h) => clone(map.get(h)),
  put: async (h, v) => { map.set(h, clone(v)); },
  del: async (hs) => { for (const h of [].concat(hs)) map.delete(h); },
  keys: async () => [...map.keys()],
});
const kit = (local = {}, sync = {}) => ({ local: localArea(local), sync: localArea(sync), files: filesStore() });
const put = (area, file, kind = 'image', extra = {}) => M.change({ op: 'put', kind, b64: M.std(fx(file)), ...extra }, area, { decode: S.decode });
const lookX = async (h, type = 'image') => X.pack({ x: { bg: { media: { type, src: `file:${h}` } } } });
const codeWith = async (h, type = 'image') => S.encode(G.GZ_SANITIZE({ bg: { kind: 'media' } }), {}, { x: { bg: { media: { type, src: `file:${h}` } } } });
const env = { decode: S.decode };

// ---- lib/media.js ---------------------------------------------------------------------------------------------------------
test('a kept file lives in the files store, named by its hash, and storage.local keeps only a small index', async () => {
  const a = kit();
  const r = await put(a, 'anim.webp');
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(a.local.data), [M.INDEX], 'no base64 in storage.local');
  assert.deepEqual(Object.keys(a.local.data[M.INDEX]), [r.h]);
  assert.equal(a.local.data[M.INDEX][r.h].t, 'image/webp');
  assert.equal(a.local.data[M.INDEX][r.h].n, r.size);
  assert.ok(JSON.stringify(a.local.data).length < 200, 'the index is small');
  assert.deepEqual([...a.files.map.keys()], [r.h]);
  assert.equal(M.unstd(a.files.map.get(r.h).b).length, r.size);
  // list and put size what is kept from the index alone: get(null) would throw.
  assert.deepEqual((await M.change({ op: 'list' }, a)).files.map((f) => [f.h, f.t, f.size]), [[r.h, 'image/webp', r.size]]);
  assert.equal((await put(a, 'still.webp')).ok, true);
  assert.equal((await M.read(a, r.h)).mime, 'image/webp', 'the worker still reads it back, checked');
  assert.deepEqual(await M.change({ op: 'drop', h: r.h }, a), { ok: true });
  assert.equal(a.files.map.has(r.h), false);
  assert.equal(r.h in a.local.data[M.INDEX], false);
});

test('a page is handed a kept file as it was kept, without it being read again or hashed', async () => {
  const a = kit();
  const r = await put(a, 'clip.webm', 'video');
  const subtle = globalThis.crypto.subtle, digest = subtle.digest;
  let hashed = 0;
  subtle.digest = (...x) => { hashed++; return digest.apply(subtle, x); };
  try {
    const got = await M.change({ op: 'file', h: r.h }, a);
    assert.deepEqual([got.ok, got.mime, M.unstd(got.b64).length], [true, 'video/webm', r.size]);
    assert.equal(hashed, 0, 'trusts the hash checked when it was kept');
  } finally { subtle.digest = digest; }
  assert.deepEqual(await M.change({ op: 'file', h: 'A'.repeat(43) }, a), { ok: false, error: 'missing' });
  assert.deepEqual(await M.change({ op: 'file', h: '../x' }, a), { ok: false, error: 'bad' });
});

test('a kept Lottie page read also trusts the stored hash instead of hashing again', async () => {
  const a = kit(), r = await put(a, 'spin.json', 'lottie');
  const subtle = globalThis.crypto.subtle, digest = subtle.digest;
  let hashed = 0;
  subtle.digest = (...args) => { hashed++; return digest.apply(subtle, args); };
  try {
    const got = await M.change({ op: 'lottie', src: `file:${r.h}` }, a);
    assert.equal(got.ok, true);
    assert.equal(got.json.w, 200);
    assert.equal(hashed, 0);
  } finally { subtle.digest = digest; }
});

test('a file an older Glaze kept in storage.local moves to the files store once, and bad ones are dropped', async () => {
  const bytes = fx('anim.webp'), h = await M.sha(bytes);
  const old = { [`${M.KEY}${h}`]: { t: 'image/webp', b: M.std(bytes) }, [`${M.KEY}${'B'.repeat(43)}`]: { t: 'image/webp', b: M.std(bytes) }, keep: 1 };
  const a = kit(old);
  const moved = await M.migrate(a, Object.keys(old));
  assert.deepEqual(Object.keys(moved), [h]);
  assert.deepEqual(Object.keys(a.local.data).sort(), ['keep', M.INDEX].sort(), 'both old keys are gone from storage.local');
  assert.deepEqual([...a.files.map.keys()], [h], 'the one that is what its name says is kept');
  assert.equal((await M.change({ op: 'file', h }, a)).mime, 'image/webp');
  // A page asking for a file not moved yet moves just that one.
  const b = kit({ [`${M.KEY}${h}`]: { t: 'image/webp', b: M.std(bytes) } });
  assert.equal((await M.change({ op: 'file', h }, b)).ok, true);
  assert.equal(`${M.KEY}${h}` in b.local.data, false);
  assert.ok(b.files.map.has(h));
  // Nothing to move: nothing is written.
  const c = kit({ keep: 1 });
  assert.deepEqual(await M.migrate(c, ['keep']), {});
  assert.deepEqual(c.local.data, { keep: 1 });
});

test('a file kept for an offer waits as pending: Cancel takes it, using the Look keeps it', async () => {
  const a = kit();
  const r = await put(a, 'anim.webp', 'image', { pending: true });
  assert.equal(a.local.data[M.INDEX][r.h].p, true);
  assert.deepEqual(await M.change({ op: 'drop', h: r.h, pending: true }, a), { ok: true });
  assert.deepEqual([...a.files.map.keys()], [], 'cancelling an offer leaves no stored media');
  assert.equal(a.local.data[M.INDEX], undefined);
  // Used: no longer pending, and a late Cancel does not take it.
  const k = await put(a, 'anim.webp', 'image', { pending: true });
  assert.deepEqual(await M.change({ op: 'keep', h: k.h }, a), { ok: true });
  assert.equal(a.local.data[M.INDEX][k.h].p, undefined);
  assert.deepEqual(await M.change({ op: 'drop', h: k.h, pending: true }, a), { ok: true });
  assert.ok(a.files.map.has(k.h), 'kept');
  // A file this computer already kept is never made pending by an offer naming it.
  await put(a, 'anim.webp', 'image', { pending: true });
  assert.equal(a.local.data[M.INDEX][k.h].p, undefined);
  assert.deepEqual(await M.change({ op: 'keep', h: 'A'.repeat(43) }, a), { ok: false, error: 'missing' });
});

test('migration failures keep the legacy file and report failure until index and old-key cleanup both persist', async () => {
  for (const failure of ['file', 'index', 'remove']) {
    const bytes = fx('anim.webp'), h = await M.sha(bytes), key = `${M.KEY}${h}`;
    const a = kit({ [key]: { t: 'image/webp', b: M.std(bytes) } });
    const putFile = a.files.put, set = a.local.set, remove = a.local.remove;
    let fail = true;
    a.files.put = async (...args) => { if (fail && failure === 'file') throw new Error('quota'); return putFile(...args); };
    a.local.set = async (...args) => fail && failure === 'index' ? false : set(...args);
    a.local.remove = async (...args) => fail && failure === 'remove' ? false : remove(...args);
    await assert.rejects(M.migrate(a, [key]), /quota|write/, failure + ' must not report successful migration');
    assert.ok(a.local.data[key], failure + ' preserves the original bytes');
    fail = false;
    await M.migrate(a, [key]);
    assert.equal(a.local.data[key], undefined);
    assert.deepEqual((await M.read(a, h)).bytes, bytes);
    assert.ok(a.local.data[M.INDEX][h]);
  }
});

test('no room: put says full, after letting go of offers nobody used', async () => {
  const a = kit();
  const big = { t: 'video/webm', n: M.LIMIT.total - 100, at: 1 };
  a.local.data[M.INDEX] = { ['B'.repeat(43)]: big };
  a.files.map.set('B'.repeat(43), { t: 'video/webm', b: 'AAAA' });
  assert.equal((await put(a, 'anim.webp')).error, 'full');
  assert.equal((await put(a, 'anim.webp', 'image', { pending: true })).error, 'full');
  // An old offer's file goes to make room.
  a.local.data[M.INDEX]['B'.repeat(43)] = { ...big, p: true };
  const r = await put(a, 'anim.webp');
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(a.local.data[M.INDEX]), [r.h]);
  assert.deepEqual([...a.files.map.keys()], [r.h]);
});

test('files no Look names are collected: not the worn Look, history, favorites, or a file just kept', async () => {
  const at = 10 * 60e3, a = kit();
  const files = {};
  for (const f of ['anim.webp', 'still.webp', 'anim.avif']) files[f] = (await put(a, f)).h;
  const lottie = (await put(a, 'spin.json', 'lottie')).h, video = (await put(a, 'clip.webm', 'video')).h, offered = (await put(a, 'clip.mp4', 'video', { pending: true })).h;
  for (const e of Object.values(a.local.data[M.INDEX])) e.at = 0;
  a.sync.data.lookX = await lookX(files['anim.webp']);
  a.local.data.lookHistory = [{ theme: { parts: { x: { bg: { media: { type: 'image', src: `file:${files['still.webp']}` } } } } }, at: 1 }];
  a.local.data.lookFavorites = [{ code: await codeWith(lottie, 'lottie'), name: 'Spin' }, { code: 'glaze1:x', name: 'old' }];
  const fresh = (await put(a, 'anim.avif')).h; // the same file as before, kept again just now
  assert.equal(fresh, files['anim.avif']);
  a.local.data[M.INDEX][fresh].at = at - 30e3;
  const r = await M.collect(a, { ...env, now: () => at });
  assert.deepEqual(r.gone.sort(), [video].sort(), 'only the video nobody names, and not the one kept a moment ago');
  assert.deepEqual(Object.keys(a.local.data[M.INDEX]).sort(), [files['anim.webp'], files['still.webp'], fresh, lottie, offered].sort());
  assert.equal(a.files.map.has(video), false);
  // An offer nobody answered goes after an hour; a just-kept file nobody names after a minute.
  const later = await M.collect(a, { ...env, now: () => at + 2 * 60 * 60e3 });
  assert.deepEqual(later.gone.sort(), [offered, fresh].sort());
  // A Look worn from the offer: no longer pending.
  a.local.data.lookHistory = [];
  a.sync.data.lookX = await lookX(lottie, 'lottie');
  a.local.data.lookFavorites = [];
  const gone = await M.collect(a, { ...env, now: () => at * 100 });
  assert.deepEqual(gone.gone.sort(), [files['anim.webp'], files['still.webp']].sort());
  assert.deepEqual(Object.keys(a.local.data[M.INDEX]), [lottie]);
  // A record the index doesn't list (a write cut short) goes too; an index entry with no record is forgotten.
  a.files.map.set('C'.repeat(43), { t: 'video/webm', b: 'AAAA' });
  a.local.data[M.INDEX]['D'.repeat(43)] = { t: 'video/webm', n: 3, at: at * 100 };
  a.sync.data.lookX = await lookX('D'.repeat(43), 'video');
  a.local.data.lookFavorites = [{ code: await codeWith(lottie, 'lottie'), name: 'Spin' }];
  await M.collect(a, { ...env, now: () => at * 100 });
  assert.deepEqual([...a.files.map.keys()], [lottie]);
  assert.deepEqual(Object.keys(a.local.data[M.INDEX]), [lottie]);
});

test('with no index, collecting still cleans up a record left by an interrupted first write', async () => {
  const a = kit({ lookFavorites: [{ code: 'glaze2:x', name: 'n' }] });
  a.files.map.set('A'.repeat(43), { t: 'video/webm', b: 'AAAA' });
  assert.deepEqual(await M.collect(a, env), { ok: true, gone: [] });
  assert.equal(a.files.map.size, 0);
  assert.deepEqual(a.local.data, { lookFavorites: [{ code: 'glaze2:x', name: 'n' }] });
});

test('collection and a late pending Cancel preserve a file now named by a Look', async () => {
  for (const reference of ['worn', 'history', 'favorite', 'rotation']) {
    const a = kit(), r = await put(a, 'anim.webp', 'image', { pending: true });
    a.local.data[M.INDEX][r.h].at = 0;
    if (reference === 'worn') a.sync.data.lookX = await lookX(r.h);
    if (reference === 'history') a.local.data.lookHistory = [{ theme: { parts: { x: { bg: { media: { type: 'image', src: `file:${r.h}` } } } } } }];
    if (reference === 'favorite') a.local.data.lookFavorites = [{ code: await codeWith(r.h) }];
    if (reference === 'rotation') a.local.data.rotateLooks = [await codeWith(r.h)];
    assert.equal((await M.change({ op: 'drop', h: r.h, pending: true }, a, env)).ok, true);
    assert.ok(a.files.map.has(r.h), reference + ' survives a late Cancel');
    await M.collect(a, { ...env, now: () => 10 * 60 * 60e3 });
    assert.ok(a.files.map.has(r.h), reference + ' survives collection');
  }
});

test('making room for an offer does not evict pending media already named by a favorite', async () => {
  const a = kit(), r = await put(a, 'anim.webp', 'image', { pending: true });
  a.local.data[M.INDEX][r.h].n = M.LIMIT.total - 1;
  a.local.data.lookFavorites = [{ code: await codeWith(r.h) }];
  assert.equal((await put(a, 'still.webp', 'image', { pending: true })).error, 'full');
  assert.ok(a.files.map.has(r.h));
});

test('collection preserves media when reading the worn local Look fails', async () => {
  const a = kit(), r = await put(a, 'anim.webp');
  a.local.data[M.INDEX][r.h].at = 0;
  a.sync.data.lookX = { h: 'stored-look' };
  const get = a.local.get;
  a.local.get = async (keys) => { if (keys === 'lookX') throw new Error('temporary read failure'); return get(keys); };
  await assert.rejects(M.collect(a, { ...env, now: () => 10 * 60e3 }), /temporary read failure/);
  assert.ok(a.files.map.has(r.h));
});

test('Reset everything takes every kept file', async () => {
  const a = kit();
  await put(a, 'anim.webp');
  await put(a, 'clip.webm', 'video', { pending: true });
  a.files.map.set('C'.repeat(43), { t: 'video/webm', b: 'AAAA' });
  assert.deepEqual(await M.change({ op: 'reset' }, a), { ok: true });
  assert.deepEqual([...a.files.map.keys()], []);
  assert.equal(M.INDEX in a.local.data, false);
});

test('list marks the files a saved Look (history or a favorite) names', async () => {
  const a = kit();
  const h1 = (await put(a, 'anim.webp')).h, h2 = (await put(a, 'still.webp')).h;
  a.local.data.lookFavorites = [{ code: await codeWith(h2), name: 'Still' }];
  const { files } = await M.change({ op: 'list' }, a, env);
  assert.deepEqual(files.map((f) => [f.h, !!f.saved]).sort(), [[h1, false], [h2, true]].sort());
});

// ---- the worker -----------------------------------------------------------------------------------------------------------
const manifest = require('../manifest.json');
const worker = ({ fetch, local: seed = {}, sync: syncSeed = {}, keyListing = true } = {}) => {
  const on = { message: [], changed: [], startup: [], installed: [] };
  const local = { ...seed }, sync = { ...syncSeed }, opened = [];
  const timers = [], localReads = [];
  let readGate = null, historyGate = null;
  const holdHistorySnapshot = () => { let release; historyGate = new Promise((r) => { release = r; }); return () => { historyGate = null; release(); }; };
  const holdSyncSnapshot = () => { let release; const wait = new Promise((r) => { release = r; }); readGate = wait; return () => { readGate = null; release(); }; };
  const area = (store) => ({
    get: async (k) => { if (store === local) localReads.push(k); if (store === local && k === 'lookHistory' && historyGate) await historyGate; if (store === sync && k === null && readGate) await readGate; return k === null ? clone(store) : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, clone(store[x])])); },
    set: async (v) => { Object.assign(store, clone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete store[x]; },
    ...(keyListing && { getKeys: async () => Object.keys(store) }),
  });
  const { indexedDB, IDBKeyRange } = fakeIDB();
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, Blob, Response, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, crypto, AbortSignal, fetch,
    indexedDB, IDBKeyRange, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {}, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(require.resolve(`../lib/${f}`), 'utf8'), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (p = '') => `chrome-extension://glaze/${p}`, getManifest: () => manifest,
        openOptionsPage: () => { opened.push('options'); return Promise.resolve(); },
        onMessage: { addListener: (f) => on.message.push(f) }, onInstalled: { addListener: (f) => on.installed.push(f) }, onStartup: { addListener: (f) => on.startup.push(f) }, onConnect: { addListener() {} },
      },
      storage: { local: area(local), sync: area(sync), onChanged: { addListener: (f) => on.changed.push(f) } },
      scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {}, getRegisteredContentScripts: async () => [] },
      tabs: { onRemoved: { addListener() {} }, create: () => {} },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/background.js'), 'utf8'), context);
  const ask = (m, s) => new Promise((res) => { for (const f of on.message) if (f(m, s, (r) => res(clone(r))) === true) return; res('ignored'); });
  const send = (m, s) => on.message.forEach((f) => f(m, s));
  const until = async (ok) => { for (let i = 0; i < 2000 && !ok(); i++) await new Promise((r) => setTimeout(r, 2)); assert.ok(ok(), 'waited too long'); };
  const kept = async () => (await new Promise((res) => {
    const r = indexedDB.open('glaze-media', 1);
    r.onsuccess = () => { const db = r.result; if (!indexedDB.dbs.get('glaze-media')?.has('files')) return res([]); const st = db.transaction('files').objectStore('files').getAllKeys(); st.onsuccess = () => res(st.result); };
  }));
  return { on, ask, send, until, local, sync, opened, kept, indexedDB, timers, holdSyncSnapshot, holdHistorySnapshot, localReads };
};
const editor = { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/options.html' };
const page = { id: 'glaze', frameId: 0, tab: { id: 1 }, url: 'https://school.instructure.com/courses/1', origin: 'https://school.instructure.com' };
const gallery = { url: 'https://frostdev.io/glaze/looks/', frameId: 0 };

test('worker: a queued editor checkpoint owns its unsaved media before history lands', async () => {
  const w = worker();
  const r = await w.ask({ type: 'glaze:media', op: 'put', kind: 'image', b64: M.std(fx('anim.webp')) }, editor);
  w.local[M.INDEX][r.h].at = 0;
  const release = w.holdHistorySnapshot();
  const pending = w.ask({ type: 'glaze:history-checkpoint', theme: { parts: { x: { bg: { media: { type: 'image', src: `file:${r.h}` } } } } } }, editor);
  for (const f of w.on.changed) f({ lookFavorites: { newValue: [] } }, 'local');
  await new Promise((r) => setTimeout(r, 25));
  const kept = await w.kept();
  release();
  const answer = await pending;
  assert.deepEqual(kept, [r.h], 'checkpoint prevents premature collection');
  assert.equal(answer.ok, true);
  assert.ok(w.local.lookHistory[0].theme.parts.x.bg.media.src.endsWith(r.h));
});

test('worker: a gallery Look\'s file waits as pending for the editor\'s answer, outside storage.local', async () => {
  const bytes = fx('spin.json'), h = await M.sha(M.check(bytes, 'bg').bytes), code = await codeWith(h, 'lottie');
  const w = worker({ fetch: async () => new Response(bytes) });
  w.send({ gallery: { code, name: 'Spin' } }, gallery);
  await w.until(() => w.local.galleryOffer);
  assert.deepEqual(w.local.galleryOffer.media, { h, pending: true });
  assert.equal(Object.keys(w.local).some((k) => k.startsWith('lookMedia:')), false, 'no base64 in storage.local');
  assert.deepEqual(await w.kept(), [h]);
  // The editor cancels: nothing stays.
  assert.deepEqual(await w.ask({ type: 'glaze:media', op: 'drop', h, pending: true }, editor), { ok: true });
  assert.deepEqual(await w.kept(), []);
  assert.equal(w.local[M.INDEX], undefined);
});

test('worker: when there is no room for a gallery Look\'s file, the offer says so', async () => {
  const bytes = fx('spin.json'), h = await M.sha(M.check(bytes, 'bg').bytes), code = await codeWith(h, 'lottie');
  const w = worker({ fetch: async () => new Response(bytes), local: { [M.INDEX]: { ['B'.repeat(43)]: { t: 'video/webm', n: M.LIMIT.total, at: Date.now() } } } });
  w.send({ gallery: { code, name: 'Spin' } }, gallery);
  await w.until(() => w.local.galleryOffer);
  assert.deepEqual(w.local.galleryOffer.media, { h, error: 'full' });
});

test('worker: gallery capacity cleanup retains the file a favorite already names', async () => {
  const bytes = fx('spin.json'), h = await M.sha(M.check(bytes, 'bg').bytes), code = await codeWith(h, 'lottie');
  const w = worker({ fetch: async () => new Response(bytes) });
  const old = await w.ask({ type: 'glaze:media', op: 'put', kind: 'image', b64: M.std(fx('anim.webp')), pending: true }, editor);
  w.local[M.INDEX][old.h].n = M.LIMIT.total - 1;
  w.local.lookFavorites = [{ code: await codeWith(old.h) }];
  w.send({ gallery: { code, name: 'Spin' } }, gallery);
  await w.until(() => w.local.galleryOffer);
  assert.equal(w.local.galleryOffer.media.error, 'full');
  assert.deepEqual(await w.kept(), [old.h]);
});

test('worker: a page gets the worn Look\'s kept file, and no other; the editor\'s preview any', async () => {
  const w = worker({ local: { ultra: [], canvas: ['https://school.instructure.com/*'] } });
  const put = await w.ask({ type: 'glaze:media', op: 'put', kind: 'video', b64: M.std(fx('clip.webm')) }, editor);
  const other = await w.ask({ type: 'glaze:media', op: 'put', kind: 'image', b64: M.std(fx('anim.webp')) }, editor);
  assert.ok(put.ok && other.ok);
  w.sync.lookX = await lookX(put.h, 'video');
  const got = await w.ask({ type: 'glaze:keptFile', h: put.h }, page);
  assert.deepEqual([got.ok, got.mime, M.unstd(got.b64).length], [true, 'video/webm', put.size]);
  assert.deepEqual(await w.ask({ type: 'glaze:keptFile', h: other.h }, page), { ok: false, error: 'sender' });
  assert.equal((await w.ask({ type: 'glaze:keptFile', h: other.h }, { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/preview.html?site=canvas' })).ok, true);
  assert.deepEqual(await w.ask({ type: 'glaze:keptFile', h: put.h }, { ...page, url: 'https://evil.example/' }), { ok: false, error: 'sender' });
});

test('worker: only the editor keeps, cancels and resets; Reset everything takes every kept file', async () => {
  const w = worker();
  const r = await w.ask({ type: 'glaze:media', op: 'put', kind: 'image', b64: M.std(fx('anim.webp')) }, editor);
  for (const op of ['keep', 'reset']) assert.deepEqual(await w.ask({ type: 'glaze:media', op, h: r.h }, page), { ok: false, error: 'sender' }, op);
  assert.deepEqual(await w.ask({ type: 'glaze:media', op: 'reset' }, editor), { ok: true });
  assert.deepEqual(await w.kept(), []);
  assert.equal(w.local[M.INDEX], undefined);
});

test('worker: media writes require the exact ticketed Settings document and cannot elevate an LMS caller', async () => {
  const w = worker({ local: { canvas: ['https://school.instructure.com/*'] } });
  const framed = { ...editor, frameId: 5, documentId: 'settings-one', tab: page.tab, origin: 'chrome-extension://glaze' };
  for (const op of ['put', 'list', 'keep', 'drop', 'reset']) {
    assert.equal((await w.ask({ type: 'glaze:media', op }, framed)).error, 'sender');
    assert.equal((await w.ask({ type: 'glaze:media', op }, page)).error, 'sender');
  }
  const ticket = await w.ask({ type: 'glaze:settings-ticket' }, page);
  assert.equal(ticket.ok, true);
  assert.equal((await w.ask({ type: 'glaze:settings-claim', ticket: ticket.ticket }, framed)).ok, true);
  const r = await w.ask({ type: 'glaze:media', op: 'put', kind: 'image', b64: M.std(fx('anim.webp')) }, framed);
  assert.equal(r.ok, true);
  assert.equal((await w.ask({ type: 'glaze:media', op: 'list' }, framed)).files.length, 1);
  for (const sender of [{ ...framed, documentId: 'new-document' }, { ...framed, frameId: 6 }, { ...framed, origin: 'https://evil.example' }, page]) {
    assert.equal((await w.ask({ type: 'glaze:media', op: 'reset' }, sender)).error, 'sender');
  }
  assert.equal((await w.ask({ type: 'glaze:media', op: 'keep', h: r.h }, framed)).ok, true);
  assert.equal((await w.ask({ type: 'glaze:media', op: 'reset' }, framed)).ok, true);
});

test('worker: concurrent lazy migrations and editor puts preserve every index entry', async () => {
  const first = fx('anim.webp'), second = fx('still.webp'), a = await M.sha(first), b = await M.sha(second);
  const w = worker({ local: { [`${M.KEY}${a}`]: { t: 'image/webp', b: M.std(first) }, [`${M.KEY}${b}`]: { t: 'image/webp', b: M.std(second) } } });
  const preview = { ...editor, url: 'chrome-extension://glaze/preview.html' };
  const results = await Promise.all([
    w.ask({ type: 'glaze:keptFile', h: a }, preview), w.ask({ type: 'glaze:keptFile', h: b }, preview),
    w.ask({ type: 'glaze:media', op: 'put', kind: 'video', b64: M.std(fx('clip.webm')) }, editor),
  ]);
  assert.ok(results.every((r) => r.ok));
  const names = (await w.ask({ type: 'glaze:media', op: 'list' }, editor)).files.map((f) => f.h).sort();
  assert.deepEqual(names, [a, b, results[2].h].sort());
  assert.deepEqual((await w.kept()).sort(), names);
});

test('worker: listing and reset handle legacy media even before the update migration finishes', async () => {
  const bytes = fx('anim.webp'), h = await M.sha(bytes), key = `${M.KEY}${h}`;
  const w = worker({ local: { [key]: { t: 'image/webp', b: M.std(bytes) } } });
  const listed = await w.ask({ type: 'glaze:media', op: 'list' }, editor);
  assert.equal(listed.files.length, 1, 'legacy media remains discoverable in Settings and backup restore');
  assert.equal((await w.ask({ type: 'glaze:media', op: 'reset' }, editor)).ok, true);
  assert.equal(w.local[key], undefined);
  assert.equal((await w.ask({ type: 'glaze:keptFile', h }, { ...editor, url: 'chrome-extension://glaze/preview.html' })).ok, false, 'reset cannot resurrect the legacy copy');
});

test('worker: without getKeys, migrate known legacy files without reading all storage and preserve unseen copies', async () => {
  const bytes = fx('anim.webp'), unknown = fx('still.webp'), h = await M.sha(bytes), u = await M.sha(unknown);
  const key = `${M.KEY}${h}`, unseen = `${M.KEY}${u}`;
  // channelKeysMoved: the mod-channel key move (WP-S3) has its own one-time read on such browsers; this is about media.
  const w = worker({ keyListing: false, local: { channelKeysMoved: true, [key]: { t: 'image/webp', b: M.std(bytes) }, [unseen]: { t: 'image/webp', b: M.std(unknown) } }, sync: { lookX: await lookX(h) } });
  for (const f of w.on.installed) f({ reason: 'update' });
  await w.until(() => !w.local[key]);
  const listed = await w.ask({ type: 'glaze:media', op: 'list' }, editor);
  assert.deepEqual(listed.files.map((f) => f.h), [h]);
  assert.ok(w.local[unseen], 'enumeration is unavailable: an unknown legacy key is preserved');
  assert.equal((await w.ask({ type: 'glaze:media', op: 'reset' }, editor)).ok, true);
  assert.ok(w.local[unseen], 'reset cannot enumerate and erase an unseen legacy key');
  assert.equal(w.local[key], undefined);
  assert.equal(w.localReads.includes(null), false, 'media never falls back to get(null)');
  const preview = { ...editor, url: 'chrome-extension://glaze/preview.html' };
  assert.equal((await w.ask({ type: 'glaze:keptFile', h: u }, preview)).ok, true, 'a requested unknown file still migrates lazily');
  assert.equal(w.local[unseen], undefined);
});

test('worker: favorite cleanup cannot collect the Look left while its history write is queued', async () => {
  const w = worker();
  const r = await w.ask({ type: 'glaze:media', op: 'put', kind: 'image', b64: M.std(fx('anim.webp')) }, editor);
  w.local[M.INDEX][r.h].at = 0;
  const old = await lookX(r.h);
  w.sync.lookX = '';
  for (const f of w.on.changed) f({ lookX: { oldValue: old, newValue: '' } }, 'sync');
  await new Promise(setImmediate); // the theme-left snapshot has completed
  const release = w.holdSyncSnapshot();
  w.timers.at(-1)(); // the resting period ends, but history's storage read is still waiting
  for (const f of w.on.changed) f({ lookFavorites: { newValue: [] } }, 'local');
  await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(await w.kept(), [r.h], 'a queued history recording still protects the previous file');
  release();
  await w.until(() => w.local.lookHistory?.some((e) => e.theme.parts?.x?.bg?.media?.src === `file:${r.h}`));
});

test('worker: an update moves files kept in storage.local to the files store, and the start collects files nobody names', async () => {
  const bytes = fx('anim.webp'), h = await M.sha(bytes), stale = await M.sha(fx('still.webp'));
  const w = worker({ local: { [`${M.KEY}${h}`]: { t: 'image/webp', b: M.std(bytes) }, [`${M.KEY}${stale}`]: { t: 'image/webp', b: M.std(fx('still.webp')) } } });
  w.sync.lookX = await lookX(h);
  for (const f of w.on.installed) f({ reason: 'update' });
  await w.until(() => !Object.keys(w.local).some((k) => k.startsWith(M.KEY)));
  await w.until(() => w.local[M.INDEX] && Object.keys(w.local[M.INDEX]).length === 2);
  assert.deepEqual((await w.kept()).sort(), [h, stale].sort());
  // Later, at a start: the one nobody names goes (it was moved more than a minute ago).
  for (const e of Object.values(w.local[M.INDEX])) e.at = 0;
  for (const f of w.on.startup) f();
  await w.until(() => Object.keys(w.local[M.INDEX] || {}).length === 1);
  assert.deepEqual(await w.kept(), [h]);
  const played = await w.ask({ type: 'glaze:keptFile', h }, { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/preview.html' });
  assert.equal(played.mime, 'image/webp');
});

// ---- the editor -----------------------------------------------------------------------------------------------------------
const options = fs.readFileSync(require.resolve('../options.js'), 'utf8');

test('editor: an offer whose file had no room says so', async () => {
  const section = options.slice(options.indexOf('  const tryCode ='), options.indexOf("  $('#share-try').addEventListener"));
  const notes = [];
  const controls = { '#share-code': { value: await codeWith('A'.repeat(43), 'video') }, '#share-offer': {}, '#share-what': { replaceChildren() {}, append: (...xs) => notes.push(...xs.map((x) => x.textContent ?? x)) } };
  const context = vm.createContext({
    GZ_SHARE: S, GZ_XPARTS: X, GZ_SANITIZE: G.GZ_SANITIZE, GZ_MATCH_PRESET: G.GZ_MATCH_PRESET, GZ_CARDS: require('../lib/cards.js'), GZ_FONTS: require('../lib/fonts.js'),
    GZ_I18N: { ui: () => 'en', locale: () => 'en' }, s: G.GZ_SANITIZE(), offer: null, from: null, offerFile: '', offerGeneration: 0, letGo() {}, URL, Intl,
    $: (id) => controls[id], document: { createElement: () => ({}) }, fontName: (f) => f.name,
    t: (x, vars) => x.replace(/\{(\w+)(?:\|\w+)?\}/g, (_, k) => vars[k]), endOffer() {}, hint() {}, preview() {}, GZ_UI: { paint() {} },
  });
  await vm.runInContext(`${section}\ntryCode({ name: 'Loop', author: '', media: { h: '${'A'.repeat(43)}', error: 'full' } });`, context);
  assert.match(notes.join(' '), /isn.t room/i);
});

test('editor: Cancel lets an offer\'s pending file go, using it keeps it, and Reset everything clears kept files', async () => {
  const sent = [];
  const chrome = { runtime: { lastError: null, sendMessage: (m, cb) => { sent.push(JSON.parse(JSON.stringify(m))); cb?.({ ok: true }); } } };
  const pick = (from, to) => options.slice(options.indexOf(from), options.indexOf(to));
  // The offer's end, as the editor wires it.
  const ends = pick('  let from = null;', '  const tryCode =');
  const listeners = {};
  const $ = (id) => (listeners[id] ||= { hidden: false, value: '', addEventListener: (type, f) => { listeners[id][type] = f; }, focus() {} });
  const ctx = vm.createContext({ chrome, $, GZ_UI: { paint() {} }, preview() {}, s: {}, offer: null, addEventListener() {} });
  vm.runInContext(`${ends}\nglobalThis.ends = { endOffer, take: (h, pending) => { offerFile = pending ? h : ''; } };`, ctx);
  ctx.ends.take('A'.repeat(43), true);
  ctx.ends.endOffer();
  assert.deepEqual(sent, [{ type: 'glaze:media', op: 'drop', h: 'A'.repeat(43), pending: true }], 'cancelling an offer leaves no stored media');
  ctx.ends.endOffer();
  assert.equal(sent.length, 1, 'once');
  ctx.ends.take('A'.repeat(43), true);
  ctx.ends.endOffer(true);
  assert.deepEqual(sent.at(-1), { type: 'glaze:media', op: 'keep', h: 'A'.repeat(43) });
  // Reset everything.
  const reset = pick("  $('#reset-all').addEventListener", '  for (const button of $$(\'[data-reset-setting]\'))');
  assert.match(reset, /type: 'glaze:media', op: 'reset'/);
});

test('editor: a refused gallery code releases its pending file, and Cancel wins over a decoding offer', async () => {
  const section = options.slice(options.indexOf('  let from = null;'), options.indexOf("  $('#share-try').addEventListener"));
  let decode;
  const sent = [], controls = { '#share-code': { value: 'glaze2:pending' }, '#share-offer': {} };
  const ctx = vm.createContext({
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(clone(m)); cb?.({ ok: true }); } } },
    $: (id) => controls[id], GZ_SHARE: { decode: () => new Promise((resolve, reject) => { decode = { resolve, reject }; }) },
    GZ_UI: { paint() {} }, GZ_I18N: { locale: () => 'en', ui: () => 'en' },
    s: {}, offer: null, preview() {}, addEventListener() {}, t: (s) => s, hint() {}, Intl,
  });
  vm.runInContext(`${section}\nglobalThis.startOffer = tryCode; globalThis.cancel = endOffer;`, ctx);
  const h = 'A'.repeat(43);
  const refused = ctx.startOffer({ media: { h, pending: true } });
  decode.reject(new Error('bad code'));
  await refused;
  assert.equal(sent.at(-1)?.op, 'drop', 'even a refused code releases its file');
  sent.length = 0;
  const pending = ctx.startOffer({ media: { h, pending: true } });
  ctx.cancel();
  assert.equal(sent.at(-1)?.op, 'drop', 'Cancel can drop a file while decode is pending');
  decode.resolve({});
  await pending;
  assert.equal(ctx.offer, null, 'late decoding does not reopen the cancelled offer');
});

// ---- a page ---------------------------------------------------------------------------------------------------------------
test('page: a kept file is asked of the worker and played without hashing it on every page load', async () => {
  const { env: pageEnv } = require('./helpers/media-env.cjs');
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => i & 255), h = 'H'.repeat(43);
  const e = pageEnv({ ask: async (m) => (m.type === 'glaze:keptFile' && m.h === h ? { ok: true, mime: 'video/webm', b64: Buffer.from(bytes).toString('base64') } : { ok: false }) });
  const host = e.document.createElement('div'), fails = [];
  const scene = e.start(host, () => true, (why) => fails.push(why));
  scene.update({ x: { bg: { media: { type: 'video', src: `file:${h}` } } }, ground: '#000', speed: 1 });
  await new Promise((r) => setTimeout(r, 20));
  const v = e.made.find((x) => x.tag === 'video');
  assert.ok(v, fails.join());
  v.fire('loadeddata');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(e.messages.map((m) => m.type), ['glaze:keptFile']);
  assert.deepEqual(e.blobs, [['blob:glaze/0', 300, 'video/webm']]);
  assert.equal(e.digests, 0, 'no SHA-256 on the page');
  assert.equal(e.storageReads, 0, 'and no storage.local read of the file');
});
