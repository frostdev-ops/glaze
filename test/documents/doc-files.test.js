// Documents' files (lib/doc-files.js): the worker's store in IndexedDB by SHA-256, its owners and sweep, and the port a
// page puts and gets a file over in chunks, against a fake IndexedDB and ports that carry JSON as Chrome's do.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const F = require('../lib/doc-files.js');
const DK = require('../lib/doc-kinds.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

test('a restarted worker loads the file store before answering its first port', async () => {
  const w = require('./helpers/worker-env.cjs')({ globals: fakeIDB() });
  const { port, say, close } = w.connect(F.PORT, { id: 'glaze', frameId: 0, url: 'chrome-extension://x/papers.html', origin: 'chrome-extension://x', tab: { id: 7 } });
  try {
    say({ op: 'stat', hash: 'a'.repeat(64) });
    await w.settle();
    assert.deepEqual(JSON.parse(JSON.stringify(port.posted)), [{ file: null }]);
  } finally { close(); }
});

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bytes = (n, seed = 1) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const make = (o = {}) => {
  const { indexedDB, IDBKeyRange } = fakeIDB();
  let t = o.t ?? 1e12;
  const db = F.idb(indexedDB, 'glaze-docs', IDBKeyRange);
  const wrapped = o.wrap ? o.wrap(db) : db;
  const st = F.store(wrapped, { now: () => t });
  return { st, db, indexedDB, clock: (dt) => { t += dt; }, data: () => indexedDB.dbs.get('glaze-docs')?.get('files') };
};
// A port pair: each message JSON round-tripped and delivered a turn later; disconnect reaches the other end only.
const ports = () => {
  const end = () => ({ msg: [], gone: [], peer: null, dead: false,
    onMessage: { addListener(f) { this.o.msg.push(f); } }, onDisconnect: { addListener(f) { this.o.gone.push(f); } } });
  const a = end(), b = end();
  for (const e of [a, b]) { e.onMessage.o = e; e.onDisconnect.o = e; }
  a.peer = b; b.peer = a;
  const sent = [];
  for (const e of [a, b]) {
    e.postMessage = (m) => { if (e.dead) throw new Error('disconnected'); const json = JSON.stringify(m); sent.push({ from: e === a ? 'page' : 'worker', size: json.length, m }); setImmediate(() => { if (!e.peer.dead) for (const f of e.peer.msg) f(JSON.parse(json)); }); };
    e.disconnect = () => { if (e.dead) return; e.dead = true; setImmediate(() => { if (e.peer.dead) return; e.peer.dead = true; for (const f of e.peer.gone) f(); }); };
  }
  return { page: a, worker: b, sent };
};
const wire = (st, o = {}) => {
  const log = [];
  const client = F.client(() => { const p = ports(); log.push(p); F.serve(o.tap ? o.tap(p.worker) : p.worker, st, o.allowed); return o.pageTap ? o.pageTap(p.page) : p.page; });
  return { client, log };
};

test('the largest file is the kinds\' and the submit sheet\'s one number', () => {
  assert.equal(F.MAX, 50e6);
  assert.equal(DK.KINDS.pdf.max, F.MAX);
  assert.equal(DK.KINDS.slides.max, F.MAX);
  assert.equal(DK.FILE, F.MAX);
  assert.equal(require('../lib/writer-submit.js').MAX_FILE, F.MAX);
  assert.ok(4 * Math.ceil(F.CHUNK / 3) <= 512 << 10, 'a chunk is at most 512 KB on the wire');
});

test('SHA-256 over chunks of any size is node\'s', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, F.CHUNK + 3]) {
    const b = bytes(n, n + 1), s = F.sha256();
    for (let i = 0; i < n; i += 37) s.update(b.subarray(i, i + 37));
    assert.equal(s.hex(), sha(b), String(n));
  }
});

test('a file put over the port comes back the same, in chunks no bigger than 512 KB', async () => {
  const { st } = make(), { client, log } = wire(st);
  const b = bytes(3 * F.CHUNK + 12345, 7);
  const file = await client.put(b, 'application/pdf');
  assert.deepEqual(file, { hash: sha(b), size: b.length, type: 'application/pdf' });
  const back = await client.get(file);
  assert.equal(sha(back), sha(b));
  const wire1 = log.flatMap((p) => p.sent);
  assert.ok(wire1.every((x) => x.size <= (512 << 10) + 64), `largest message ${Math.max(...wire1.map((x) => x.size))}`);
  assert.equal(wire1.filter((x) => x.m.op === 'chunk').length, 4, 'four chunks up');
  assert.equal(wire1.filter((x) => typeof x.m.data === 'string' && !x.m.op).length, 4, 'four chunks down');
  assert.deepEqual(await client.stat(file.hash), file);
  assert.equal(await client.stat('0'.repeat(64)), null);
});

test('the same bytes are kept once', async () => {
  const { st, data } = make();
  const b = bytes(F.CHUNK * 2 + 5, 3);
  const a1 = await st.put(b, 'application/pdf'), a2 = await st.put(b.slice(), 'application/pdf');
  assert.equal(a1.hash, a2.hash);
  const keys = [...data().keys()];
  assert.equal(keys.filter((k) => k.startsWith('f:')).length, 1);
  assert.equal(keys.filter((k) => k.startsWith('c:')).length, 3, 'one file\'s chunks');
  assert.equal(keys.filter((k) => k.startsWith('u:')).length, 0, 'no upload left');
});

test('a chunk stored is its own bytes, never the buffer it was cut from', async () => {
  const { st, data } = make();
  const big = bytes(F.CHUNK * 2, 9);
  await st.put(big.subarray(0, 1000), 'application/pdf');
  const chunk = [...data().entries()].find(([k]) => k.startsWith('c:'))[1];
  assert.equal(chunk.buffer.byteLength, 1000);
});

test('owners: a file goes when the last document pointing at it lets it go, after HOLD', async () => {
  const { st, data, clock } = make();
  const x = await st.put(bytes(100, 1), 'application/pdf'), y = await st.put(bytes(200, 2), 'application/pdf');
  await st.own('doc:a', [x.hash, y.hash]);
  await st.own('doc:b', [x.hash]);
  clock(F.HOLD + 1);
  await st.own('doc:a', [x.hash]);
  assert.equal(await st.stat(y.hash), null, 'y went with its one owner');
  assert.ok(await st.stat(x.hash), 'x stays');
  await st.own('doc:a', []);
  assert.ok(await st.stat(x.hash), 'b still holds x');
  await st.own('doc:b', []);
  assert.equal(await st.stat(x.hash), null);
  assert.deepEqual([...data().keys()], [], 'no chunk, file or owner left');
});

test('a file put in the last HOLD stays though a document lets it go: an import of the same bytes may be on its way', async () => {
  const { st, clock } = make();
  const x = await st.put(bytes(100, 1), 'application/pdf');
  await st.own('doc:a', [x.hash]);
  clock(F.HOLD + 1);
  await st.put(bytes(100, 1), 'application/pdf'); // the same bytes again: its clock starts over
  await st.own('doc:a', []);
  assert.ok(await st.stat(x.hash));
  clock(F.GRACE + 1);
  assert.equal(await st.sweep({ live: new Set() }), 1);
  assert.equal(await st.stat(x.hash), null, 'a sweep takes it once nothing pointed at it for GRACE');
});

test('own reports hashes it points at that are not kept', async () => {
  const { st } = make();
  const x = await st.put(bytes(10), 'application/pdf');
  assert.deepEqual(await st.own('doc:a', [x.hash, 'a'.repeat(64)]), { missing: ['a'.repeat(64)] });
});

test('sweep: an abandoned upload and stray chunks go; an upload under way and owned files stay', async () => {
  const { st, data, clock } = make();
  const kept = await st.put(bytes(F.CHUNK + 1, 4), 'application/pdf');
  await st.own('doc:a', [kept.hash]);
  const live = await st.begin({ size: 10, type: 'application/pdf' });
  await st.chunk(live, bytes(5));
  // A worker stopped mid-upload leaves its record and chunks, which no running upload names.
  const store = data();
  store.set('u:dead', { at: 0, size: 10 });
  store.set('c:dead:000000', bytes(5));
  store.set('c:lost:000000', bytes(5));
  clock(F.GRACE + 1);
  await st.sweep();
  const keys = [...store.keys()];
  assert.ok(!keys.some((k) => k.includes('dead') || k.includes('lost')), keys.join());
  assert.ok(keys.includes(`u:${live}`) && keys.some((k) => k.startsWith(`c:${live}:`)), 'the live upload stays');
  assert.ok(await st.stat(kept.hash));
  await st.chunk(live, bytes(5));
  assert.equal((await st.end(live)).size, 10);
});

test('own with add only adds: what a document held stays until it is reconciled', async () => {
  const { st, clock } = make();
  const x = await st.put(bytes(10, 1), 'application/pdf'), y = await st.put(bytes(10, 2), 'application/pdf');
  await st.own('doc:a', [x.hash]);
  clock(F.HOLD + 1);
  await st.own('doc:a', [y.hash], { add: true });
  assert.ok(await st.stat(x.hash) && await st.stat(y.hash));
  await st.own('doc:a', [y.hash]);
  assert.equal(await st.stat(x.hash), null);
});

test('a sweep takes an unowned file only when no record points at it', async () => {
  const { st, clock } = make();
  const x = await st.put(bytes(10, 1), 'application/pdf'), y = await st.put(bytes(10, 2), 'application/pdf');
  clock(F.GRACE + 1);
  assert.equal(await st.sweep(), 0, 'without the records read whole, nothing unowned goes');
  assert.equal(await st.sweep({ live: new Set([y.hash]) }), 1);
  assert.equal(await st.stat(x.hash), null);
  assert.ok(await st.stat(y.hash), 'a record points at y though no document owns it');
});

test('a file the store no longer has is missing, to get and to read', async () => {
  const { st, data } = make(), { client } = wire(st);
  const x = await client.put(bytes(F.CHUNK + 10, 5), 'application/pdf');
  // A chunk lost (a cleared site data, a damaged database).
  data().delete([...data().keys()].find((k) => k.startsWith('c:')));
  await assert.rejects(client.get(x), (e) => e.why === 'missing');
  await assert.rejects(client.get({ ...x, hash: 'b'.repeat(64) }), (e) => e.why === 'missing');
});

test('a stored chunk changed without changing its length is refused on read', async () => {
  const { st, data } = make(), { client } = wire(st);
  const file = await client.put(bytes(F.CHUNK + 10, 51), 'application/pdf');
  const key = [...data().keys()].find((k) => k.startsWith('c:'));
  data().get(key)[10] ^= 1;
  await assert.rejects(client.get(file), (e) => e.why === 'missing');
  await assert.rejects(st.read(file.hash, () => {}), (e) => e.why === 'missing');
});

test('re-importing the original file repairs missing or damaged chunks and keeps its owners', async () => {
  for (const damage of ['missing', 'changed']) {
    const { st, data } = make(), { client } = wire(st), original = bytes(F.CHUNK + 10, 52);
    const file = await client.put(original, 'application/pdf');
    await st.own('doc:a', [file.hash]);
    const key = [...data().keys()].find((k) => k.startsWith('c:'));
    if (damage === 'missing') data().delete(key); else data().get(key)[10] ^= 1;
    await assert.rejects(client.get(file), (e) => e.why === 'missing');
    assert.deepEqual(await client.put(original, 'application/pdf'), file);
    assert.equal(sha(await client.get(file)), file.hash, damage);
    assert.deepEqual(data().get(`f:${file.hash}`).owners, ['doc:a']);
    assert.equal([...data().keys()].filter((k) => k.startsWith('c:')).length, 2, 'no old chunk left');
  }
});

test('quota exceeded: the put says quota, and leaves no upload or chunk behind', async () => {
  let full = false;
  const { st, data } = make({ wrap: (db) => ({ ...db, write: async (puts, dels) => { if (full && puts.some(([k]) => k.startsWith('c:'))) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); return db.write(puts, dels); } }) });
  const { client } = wire(st);
  full = true;
  await assert.rejects(client.put(bytes(F.CHUNK * 2, 6), 'application/pdf'), (e) => e.why === 'quota');
  for (let i = 0; i < 20 && [...(data()?.keys() || [])].length; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual([...data().keys()], []);
});

test('quota exceeded when publishing the file releases its uploaded chunks', async () => {
  const { st, data } = make({ wrap: (db) => ({ ...db, write: async (puts, dels) => {
    if (puts.some(([k]) => k.startsWith('f:'))) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    return db.write(puts, dels);
  } }) });
  await assert.rejects(wire(st).client.put(bytes(F.CHUNK + 10, 61), 'application/pdf'), (e) => e.why === 'quota');
  assert.deepEqual([...data().keys()], [], 'a refused file cannot keep consuming the remaining room');
});

test('a page disconnecting while its upload starts releases the late upload', async () => {
  let release, started;
  const beginning = new Promise((r) => { started = r; });
  const gate = new Promise((r) => { release = r; });
  const { st, data } = make({ wrap: (db) => ({ ...db, write: async (puts, dels) => {
    if (puts.some(([k]) => k.startsWith('u:'))) { started(); await gate; }
    return db.write(puts, dels);
  } }) });
  const p = ports();
  F.serve(p.worker, st);
  p.page.postMessage({ op: 'put', size: 100, type: 'application/pdf' });
  await beginning;
  p.page.disconnect();
  release();
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  assert.deepEqual([...data().keys()], []);
});

test('IndexedDB unavailable: the put says unavailable', async () => {
  const st = F.store(F.idb({ open: () => { throw Object.assign(new Error('no'), { name: 'InvalidStateError' }); } }, 'glaze-docs', fakeIDB().IDBKeyRange));
  const { client } = wire(st);
  await assert.rejects(client.put(bytes(10), 'application/pdf'), (e) => e.why === 'unavailable');
  const broken = F.store(F.idb({ open: () => { const r = {}; setImmediate(() => { r.error = new Error('denied'); r.onerror?.(); }); return r; } }, 'glaze-docs', fakeIDB().IDBKeyRange));
  await assert.rejects(wire(broken).client.put(bytes(10), 'application/pdf'), (e) => e.why === 'unavailable');
});

test('quota exceeded while opening IndexedDB is reported as quota', async () => {
  for (const mode of ['throw', 'event']) {
    const indexedDB = { open: () => {
      const error = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      if (mode === 'throw') throw error;
      const r = {};
      setImmediate(() => { r.error = error; r.onerror(); });
      return r;
    } };
    const st = F.store(F.idb(indexedDB, 'glaze-docs', fakeIDB().IDBKeyRange));
    await assert.rejects(wire(st).client.put(bytes(10), 'application/pdf'), (e) => e.why === 'quota', mode);
  }
});

test('a transfer cut mid-chunk: interrupted, and the worker drops the half upload', async () => {
  const { st, data } = make();
  // The page goes (its tab closed) after its second chunk.
  let page = null;
  const { client } = wire(st, { pageTap: (p) => { page = p; const post = p.postMessage; let n = 0; p.postMessage = (m) => { if (m.op === 'chunk' && ++n === 3) p.disconnect(); return post(m); }; return p; } });
  await assert.rejects(client.put(bytes(F.CHUNK * 4, 8), 'application/pdf'), (e) => e.why === 'interrupted');
  for (let i = 0; i < 50 && [...data().keys()].length; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual([...data().keys()], [], 'no upload or chunk left');
  assert.ok(page.dead);
  // A read cut while the page holds a chunk: the worker stops at the next acknowledgement.
  const x = await st.put(bytes(F.CHUNK * 3, 9), 'application/pdf');
  const cut = wire(st, { pageTap: (p) => { const post = p.postMessage; let n = 0; p.postMessage = (m) => { if (m.op === 'ack' && ++n === 1) p.disconnect(); return post(m); }; return p; } });
  await assert.rejects(cut.client.get(x), (e) => e.why === 'interrupted');
  // The worker ending the port (stopped mid-transfer) is the same to the page.
  const gone = wire(st, { tap: (p) => { const post = p.postMessage; p.postMessage = (m) => { if (m.data) { p.disconnect(); return; } post(m); }; return p; } });
  await assert.rejects(gone.client.get(x), (e) => e.why === 'interrupted');
});

test('a sender the worker refuses gets nothing', async () => {
  const { st } = make(), { client } = wire(st, { allowed: Promise.resolve(false) });
  await assert.rejects(client.put(bytes(10), 'application/pdf'), (e) => ['bad', 'interrupted'].includes(e.why));
});

test('refs, sameness and what records point at', () => {
  const h = 'c'.repeat(64), f = { hash: h, size: 10, type: 'application/pdf' };
  assert.ok(F.ref(f));
  for (const bad of [null, 'JVBERi0=', { ...f, hash: 'x' }, { ...f, size: 0 }, { ...f, size: F.MAX + 1 }, { ...f, type: 3 }, [f]]) assert.equal(F.ref(bad), false, JSON.stringify(bad));
  assert.ok(F.same(f, { ...f }));
  assert.ok(!F.same(f, { ...f, hash: 'd'.repeat(64) }));
  assert.ok(F.same('abc', 'abc'));
  assert.deepEqual([...F.refsOf({ file: f }, [{ file: f }, { file: 'JVBE' }, { file: { ...f, hash: 'e'.repeat(64) } }], null)], [h, 'e'.repeat(64)]);
  assert.equal(F.typeOf({ kind: 'pdf' }), 'application/pdf');
  assert.equal(F.typeOf({ kind: 'slides', ext: '.ppsx' }), F.TYPES['.ppsx']);
});

test('a 50 MB file goes through in under 2 MB of messages at a time and comes back whole', { timeout: 120000 }, async () => {
  const { st } = make(), { client, log } = wire(st);
  const b = bytes(50e6, 11);
  const file = await client.put(b, 'application/pdf');
  assert.equal(file.hash, sha(b));
  const back = await client.get(file);
  assert.equal(back.length, b.length);
  assert.equal(sha(back), file.hash);
  assert.ok(log.flatMap((p) => p.sent).every((x) => x.size <= (512 << 10) + 64));
  await assert.rejects(client.put(new Uint8Array(F.MAX + 1), 'application/pdf'), (e) => e.why === 'size');
});
