// lib/ai/local/store.js: the local model's weights in OPFS, downloaded on the student's click with Range resume and a
// SHA-256 check per chunk. A fake OPFS (handles, swap-file writables, quota) and a fake fetch that answers as Hugging Face
// does: huggingface.co's resolve URL redirects to its CDN, which serves 206 Range responses.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('../../extension/lib/ai/local/store.js');

const CHUNK = 1024;
const SIZE = CHUNK * 4 + 300; // five chunks, the last one short
const COMMIT = 'a'.repeat(40);
const bytes = (n, seed = 7) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const DATA = bytes(SIZE);
const entry = (data = DATA, extra = {}) => {
  const sums = [];
  for (let at = 0; at < data.length; at += CHUNK) sums.push(sha(data.subarray(at, at + CHUNK)));
  return { id: 'tiny-q4', name: 'Tiny Q4', repo: 'test/Tiny-GGUF', commit: COMMIT, file: 'tiny.gguf',
    url: `https://huggingface.co/test/Tiny-GGUF/resolve/${COMMIT}/tiny.gguf`, size: data.length, chunk: CHUNK, sha256: sums,
    total: sha(data), license: 'lfm1.0', quant: 'Q4_K_M', tier: 1, stock: true, ...extra };
};

// ---- fake OPFS ----
const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
const fakeFs = ({ quota = Infinity } = {}) => {
  const disk = { used: 0, quota };
  const file = (name) => {
    const f = { kind: 'file', name, data: new Uint8Array(0) };
    f.getFile = async () => {
      const snap = f.data;
      return { size: snap.length, text: async () => Buffer.from(snap).toString(), arrayBuffer: async () => snap.slice().buffer, slice: (a = 0, b = snap.length) => ({ arrayBuffer: async () => snap.slice(a, b).buffer }) };
    };
    f.createWritable = async ({ keepExistingData = false } = {}) => {
      let swap = keepExistingData ? f.data.slice() : new Uint8Array(0), at = 0, open = true;
      const grow = (n) => { if (n > swap.length) { const s = new Uint8Array(n); s.set(swap); swap = s; } };
      return {
        seek: async (p) => { at = p; },
        truncate: async (n) => { const s = new Uint8Array(n); s.set(swap.subarray(0, n)); swap = s; if (at > n) at = n; },
        write: async (chunk) => {
          if (!open) throw new Error('closed');
          const b = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk.buffer || chunk);
          if (disk.used - f.data.length + Math.max(swap.length, at + b.length) > disk.quota) throw quotaError();
          grow(at + b.length); swap.set(b, at); at += b.length;
        },
        close: async () => { open = false; disk.used += swap.length - f.data.length; f.data = swap; },
        abort: async () => { open = false; },
      };
    };
    return f;
  };
  const dir = (name) => {
    const d = { kind: 'directory', name, kids: new Map() };
    const get = (n, kind, create) => {
      const k = d.kids.get(n);
      if (k) { if (k.kind !== kind) throw Object.assign(new Error('type mismatch'), { name: 'TypeMismatchError' }); return k; }
      if (!create) throw Object.assign(new Error(`${n} not found`), { name: 'NotFoundError' });
      const made = kind === 'file' ? file(n) : dir(n); d.kids.set(n, made); return made;
    };
    d.getFileHandle = async (n, { create = false } = {}) => get(n, 'file', create);
    d.getDirectoryHandle = async (n, { create = false } = {}) => get(n, 'directory', create);
    const size = (h) => (h.kind === 'file' ? h.data.length : [...h.kids.values()].reduce((s, k) => s + size(k), 0));
    d.removeEntry = async (n, { recursive = false } = {}) => {
      const k = d.kids.get(n);
      if (!k) throw Object.assign(new Error(`${n} not found`), { name: 'NotFoundError' });
      if (k.kind === 'directory' && k.kids.size && !recursive) throw Object.assign(new Error('not empty'), { name: 'InvalidModificationError' });
      disk.used -= size(k); d.kids.delete(n);
    };
    d.entries = async function* entries() { for (const [n, k] of d.kids) yield [n, k]; };
    d.values = async function* values() { for (const k of d.kids.values()) yield k; };
    d.keys = async function* keys() { for (const n of d.kids.keys()) yield n; };
    return d;
  };
  const root = dir('');
  return { root, disk, estimate: async () => ({ quota: disk.quota === Infinity ? 1e15 : disk.quota, usage: disk.used }) };
};

// ---- fake Hugging Face ----
const fakeHf = (data = DATA, { cdn = 'https://us.aws.cdn.hf.co/xet-bridge-us/abc?Signature=x', corrupt = {}, offline = false, foreign = null, perChunk = null } = {}) => {
  const log = [];
  const hf = async (url, init = {}) => {
    if (init.signal?.aborted) throw init.signal.reason;
    if (offline) throw new TypeError('Failed to fetch');
    const range = /^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range || init.headers?.range || '');
    log.push({ url, range: range && [+range[1], +range[2]], init });
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    const final = foreign || cdn;
    const a = +range[1], b = Math.min(+range[2], data.length - 1);
    let body = data.slice(a, b + 1);
    const n = Math.floor(a / CHUNK);
    if (corrupt[n] > 0) { corrupt[n]--; body = body.slice(); body[3] ^= 0xff; }
    perChunk?.(n);
    const parts = [body.subarray(0, body.length >> 1), body.subarray(body.length >> 1)];
    const stream = new ReadableStream({
      pull(c) {
        if (init.signal?.aborted) { c.error(init.signal.reason); return; }
        const p = parts.shift(); if (p) c.enqueue(p); else c.close();
      },
    });
    return { status: 206, ok: true, redirected: true, url: final, type: 'cors',
      headers: new Headers({ 'content-range': `bytes ${a}-${b}/${data.length}`, 'content-length': String(body.length) }), body: stream };
  };
  hf.log = log;
  return hf;
};

// Web Locks as one origin's contexts share them (FIFO per name; a signal ends a wait), and a BroadcastChannel between
// stores (each message delivered later, never to its sender).
const fakeLocks = () => {
  const tails = new Map();
  return {
    held: new Set(),
    request(name, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const prev = tails.get(name) || Promise.resolve();
      let release;
      const mine = new Promise((r) => { release = r; });
      tails.set(name, prev.then(() => mine));
      return new Promise((resolve, reject) => {
        const { signal } = opts;
        const quit = () => reject(signal.reason);
        if (signal?.aborted) { quit(); prev.then(release); return; }
        signal?.addEventListener('abort', quit, { once: true });
        prev.then(async () => {
          if (signal?.aborted) { release(); return; }
          signal?.removeEventListener('abort', quit);
          this.held.add(name);
          try { resolve(await cb({ name })); } catch (e) { reject(e); } finally { this.held.delete(name); release(); }
        });
      });
    },
  };
};
const fakeBus = () => {
  const members = new Set();
  return () => {
    const ch = { onmessage: null, postMessage: (data) => { for (const o of members) if (o !== ch) setTimeout(() => o.onmessage?.({ data })); }, close: () => members.delete(ch) };
    members.add(ch);
    return ch;
  };
};
const make = (opts = {}) => {
  const fs = opts.fs || fakeFs(opts);
  const fetch = opts.fetch || fakeHf(DATA, opts);
  const locks = opts.locks || fakeLocks(), channel = 'channel' in opts ? opts.channel : fakeBus();
  const store = S.create({ models: opts.models || [entry()], fetch, root: async () => fs.root, estimate: fs.estimate, locks, channel });
  return { store, fs, fetch, locks, channel };
};
// A second store over the same OPFS root, locks and channel: another context of the same extension.
const twin = (m, opts = {}) => S.create({ models: opts.models || [entry()], fetch: opts.fetch || m.fetch, root: async () => m.fs.root, estimate: m.fs.estimate,
  locks: m.locks, channel: 'channel' in opts ? opts.channel : m.channel });
const settle = () => new Promise((r) => setTimeout(r, 5));
const chunksFetched = (fetch) => fetch.log.map((l) => Math.floor(l.range[0] / CHUNK));

test('a fresh download fetches each chunk once by Range, verifies it and ends ready', async () => {
  const { store, fetch } = make();
  assert.deepEqual(await store.status('tiny-q4'), { state: 'missing' });
  const seen = [];
  const r = await store.download('tiny-q4', { onProgress: (p) => seen.push(p) });
  assert.equal(r.state, 'ready');
  assert.deepEqual(chunksFetched(fetch), [0, 1, 2, 3, 4]);
  assert.deepEqual(fetch.log.map((l) => l.range), [[0, 1023], [1024, 2047], [2048, 3071], [3072, 4095], [4096, 4395]]);
  for (const l of fetch.log) assert.equal(l.url, entry().url, 'always the pinned resolve URL, never a stored CDN URL');
  assert.deepEqual(await store.status('tiny-q4'), { state: 'ready' });
  assert.ok(seen.length >= 5 && seen.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= seen[i - 1])), 'progress climbs within 0..1');
  assert.equal(seen.at(-1), 1);
});

test('read gives exact slices, across chunk edges, and refuses out-of-range reads', async () => {
  const { store } = make();
  await store.download('tiny-q4');
  const m = await store.open('tiny-q4');
  assert.equal(m.size, SIZE);
  for (const [o, n] of [[0, 1], [0, SIZE], [1000, 100], [1023, 2], [CHUNK, CHUNK], [500, 3000], [SIZE - 7, 7], [4096, 0]]) {
    const got = await m.read(o, n);
    assert.ok(got instanceof Uint8Array);
    assert.deepEqual(Buffer.from(got), Buffer.from(DATA.subarray(o, o + n)), `read(${o}, ${n})`);
  }
  await assert.rejects(m.read(SIZE - 1, 2), RangeError);
  await assert.rejects(m.read(-1, 2), RangeError);
  await assert.rejects(m.read(0.5, 2), RangeError);
});

test('open refuses a model that is not ready', async () => {
  const { store } = make();
  await assert.rejects(store.open('tiny-q4'), (e) => e.reason === 'missing');
  await assert.rejects(store.status('nope'), (e) => e.reason === 'unknown');
});

test('a cancelled download keeps its verified chunks, and resuming fetches only the rest', async () => {
  const ctl = new AbortController();
  let after = 0;
  const { store, fetch, fs } = make({ perChunk: () => { if (++after === 3) ctl.abort(); } });
  await assert.rejects(store.download('tiny-q4', { signal: ctl.signal }), (e) => e.reason === 'aborted');
  assert.deepEqual(await store.status('tiny-q4'), { state: 'partial', bytes: 2 * CHUNK });
  const before = fetch.log.length;
  const again = S.create({ models: [entry()], fetch, root: async () => fs.root, estimate: fs.estimate, locks: fakeLocks() }); // a new worker
  assert.deepEqual(await again.status('tiny-q4'), { state: 'partial', bytes: 2 * CHUNK });
  const seen = [];
  assert.equal((await again.download('tiny-q4', { onProgress: (p) => seen.push(p) })).state, 'ready');
  assert.deepEqual(chunksFetched({ log: fetch.log.slice(before) }), [2, 3, 4], 'no verified chunk fetched twice');
  assert.ok(seen[0] >= (2 * CHUNK) / SIZE, 'progress resumes from the kept bytes');
  const m = await again.open('tiny-q4');
  assert.deepEqual(Buffer.from(await m.read(0, SIZE)), Buffer.from(DATA));
});

test('a cancel that lands once a chunk has arrived keeps that chunk', async () => {
  const ctl = new AbortController();
  const { store } = make();
  // Progress reaches 2 chunks' worth as chunk 1's last bytes arrive, before its hash and write.
  await assert.rejects(store.download('tiny-q4', { signal: ctl.signal, onProgress: (p) => { if (p * SIZE >= 2 * CHUNK) ctl.abort(); } }), (e) => e.reason === 'aborted');
  // The caller's wait ends at its cancel; the chunk's check and write finish after. Wait on the state, bounded.
  let now;
  for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 5))) if ((now = await store.status('tiny-q4')).bytes === 2 * CHUNK) break;
  assert.deepEqual(now, { state: 'partial', bytes: 2 * CHUNK });
  assert.deepEqual(await store.status('tiny-q4'), now, 'and nothing after it');
});

test('a corrupted chunk is refused and fetched again; a second corruption ends with reason hash', async () => {
  const one = make({ corrupt: { 2: 1 } });
  assert.equal((await one.store.download('tiny-q4')).state, 'ready');
  assert.deepEqual(chunksFetched(one.fetch), [0, 1, 2, 2, 3, 4]);
  assert.deepEqual(Buffer.from(await (await one.store.open('tiny-q4')).read(0, SIZE)), Buffer.from(DATA));

  const two = make({ corrupt: { 3: 2 } });
  await assert.rejects(two.store.download('tiny-q4'), (e) => e.reason === 'hash' && e.chunk === 3);
  assert.deepEqual(chunksFetched(two.fetch), [0, 1, 2, 3, 3]);
  assert.deepEqual(await two.store.status('tiny-q4'), { state: 'partial', bytes: 3 * CHUNK }, 'the bad bytes were never kept');
});

test('too little space is reason quota, with the bytes needed and available', async () => {
  const { store } = make({ quota: 2000 });
  await assert.rejects(store.download('tiny-q4'), (e) => e.reason === 'quota' && e.needed === SIZE && e.available === 2000);
  // Space the estimate promised but the write then refused is quota too.
  const fs = fakeFs({ quota: 2000 });
  const liar = S.create({ models: [entry()], fetch: fakeHf(), root: async () => fs.root, estimate: async () => ({ quota: 1e12, usage: 0 }), locks: fakeLocks() });
  await assert.rejects(liar.download('tiny-q4'), (e) => e.reason === 'quota' && e.needed > 0 && typeof e.available === 'number');
  assert.deepEqual(await liar.status('tiny-q4'), { state: 'partial', bytes: CHUNK });
});

test('a redirect to a host other than Hugging Face and its CDN is refused', async () => {
  for (const foreign of ['https://evil.example/x', 'https://huggingface.co.evil.example/x', 'http://us.aws.cdn.hf.co/x', 'https://hf.co.example/x']) {
    const { store } = make({ foreign });
    await assert.rejects(store.download('tiny-q4'), (e) => e.reason === 'redirect', foreign);
    assert.deepEqual(await store.status('tiny-q4'), { state: 'missing' });
  }
  for (const cdn of ['https://us.aws.cdn.hf.co/a', 'https://cas-bridge.xethub.hf.co/a', 'https://cdn-lfs-us-1.huggingface.co/a', 'https://cdn-lfs.huggingface.co/a', 'https://huggingface.co/a']) {
    const { store } = make({ cdn });
    assert.equal((await store.download('tiny-q4')).state, 'ready', cdn);
  }
});

test('a manifest entry whose URL is not its pinned huggingface.co resolve URL is not offered', async () => {
  const bad = [entry(DATA, { id: 'a', url: 'https://evil.example/tiny.gguf' }), entry(DATA, { id: 'b', commit: 'main', url: 'https://huggingface.co/test/Tiny-GGUF/resolve/main/tiny.gguf' }),
    entry(DATA, { id: 'c', sha256: entry().sha256.slice(1) }), entry(DATA, { id: '../d' })];
  const { store } = make({ models: [...bad, entry()] });
  assert.deepEqual((await store.list()).map((m) => m.id), ['tiny-q4']);
  await assert.rejects(store.status('a'), (e) => e.reason === 'unknown');
});

test('offline is reason network, and keeps what was verified', async () => {
  const { store } = make({ offline: true });
  await assert.rejects(store.download('tiny-q4'), (e) => e.reason === 'network');
  let n = 0;
  const fetch = fakeHf();
  const flaky = async (u, i) => { if (++n === 3) throw new TypeError('Failed to fetch'); return fetch(u, i); };
  const m = make({ fetch: flaky });
  await assert.rejects(m.store.download('tiny-q4'), (e) => e.reason === 'network');
  assert.deepEqual(await m.store.status('tiny-q4'), { state: 'partial', bytes: 2 * CHUNK });
});

test('concurrent callers share one download and each hears its progress', async () => {
  const { store, fetch } = make();
  const a = [], b = [];
  const [x, y] = await Promise.all([store.download('tiny-q4', { onProgress: (p) => a.push(p) }), store.download('tiny-q4', { onProgress: (p) => b.push(p) })]);
  assert.equal(x.state, 'ready'); assert.equal(y.state, 'ready');
  assert.deepEqual(chunksFetched(fetch), [0, 1, 2, 3, 4], 'one download');
  assert.equal(a.at(-1), 1); assert.equal(b.at(-1), 1);
  // One caller cancelling leaves the other's download running; the last one cancelling stops it.
  const m = make();
  const c1 = new AbortController();
  const first = m.store.download('tiny-q4', { signal: c1.signal });
  const second = m.store.download('tiny-q4');
  c1.abort();
  await assert.rejects(first, (e) => e.reason === 'aborted');
  assert.equal((await second).state, 'ready');
  // A finished model's download returns at once, fetching nothing.
  const before = m.fetch.log.length;
  assert.equal((await m.store.download('tiny-q4')).state, 'ready');
  assert.equal(m.fetch.log.length, before);
});

test('remove frees the space, also during a download, and list reports each model', async () => {
  const { store, fs } = make();
  await store.download('tiny-q4');
  assert.equal(fs.disk.used, SIZE);
  assert.deepEqual((await store.list()).map(({ id, state, size }) => ({ id, state, size })), [{ id: 'tiny-q4', state: 'ready', size: SIZE }]);
  await store.remove('tiny-q4');
  assert.equal(fs.disk.used, 0);
  assert.deepEqual(await store.status('tiny-q4'), { state: 'missing' });
  await store.remove('tiny-q4'); // nothing there: fine

  // A model kept by an older catalog is listed as stale with its bytes, so it can be removed; an empty folder isn't.
  const older = make();
  await older.store.download('tiny-q4');
  await (await older.fs.root.getDirectoryHandle('glaze-models')).getDirectoryHandle('empty', { create: true });
  const newer = twin(older, { models: [entry(DATA, { id: 'next' })] });
  assert.deepEqual((await newer.list()).map(({ id, state, bytes }) => ({ id, state, bytes })), [{ id: 'next', state: 'missing', bytes: undefined }, { id: 'tiny-q4', state: 'stale', bytes: SIZE }]);
  await newer.remove('tiny-q4');
  assert.equal(older.fs.disk.used, 0);

  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = fakeHf();
  const slow = async (u, i) => { if (fetch.log.length === 2) await gate; return fetch(u, i); };
  const m = make({ fetch: slow });
  const running = m.store.download('tiny-q4');
  while (fetch.log.length < 2) await new Promise((r) => setImmediate(r));
  const gone = m.store.remove('tiny-q4');
  release();
  await assert.rejects(running, (e) => e.reason === 'removed');
  await gone;
  assert.equal(m.fs.disk.used, 0);
  assert.deepEqual(await m.store.status('tiny-q4'), { state: 'missing' });
});

test('a stored copy that lost a chunk is corrupt, verify drops a bad chunk, and download repairs both', async () => {
  const { store, fs, fetch } = make();
  await store.download('tiny-q4');
  const top = await (await fs.root.getDirectoryHandle('glaze-models')).getDirectoryHandle('tiny-q4');
  const [dir] = [...top.kids.values()];
  assert.equal(top.kids.size, 1, 'one folder per pinned version');
  await dir.removeEntry('1');
  assert.deepEqual(await store.status('tiny-q4'), { state: 'corrupt' });
  await assert.rejects(store.open('tiny-q4'), (e) => e.reason === 'corrupt');
  let before = fetch.log.length;
  assert.equal((await store.download('tiny-q4')).state, 'ready');
  assert.deepEqual(chunksFetched({ log: fetch.log.slice(before) }), [1]);

  (await dir.getFileHandle('3')).data[10] ^= 1; // a bit flipped on disk
  assert.deepEqual(await store.status('tiny-q4'), { state: 'ready' }, 'status reads sizes, not bytes');
  assert.deepEqual(await store.verify('tiny-q4'), { state: 'corrupt' });
  before = fetch.log.length;
  assert.equal((await store.download('tiny-q4')).state, 'ready');
  assert.deepEqual(chunksFetched({ log: fetch.log.slice(before) }), [3]);
  assert.deepEqual(await store.verify('tiny-q4'), { state: 'ready' });
});

test('a copy kept for another commit of the same id is replaced, never mixed in', async () => {
  const { store, fs } = make();
  await store.download('tiny-q4');
  const DATA2 = bytes(SIZE, 99);
  const next = entry(DATA2, { commit: 'b'.repeat(40), url: `https://huggingface.co/test/Tiny-GGUF/resolve/${'b'.repeat(40)}/tiny.gguf` });
  const fetch = fakeHf(DATA2);
  const s2 = S.create({ models: [next], fetch, root: async () => fs.root, estimate: fs.estimate, locks: fakeLocks() });
  assert.deepEqual(await s2.status('tiny-q4'), { state: 'missing' });
  assert.equal((await s2.download('tiny-q4')).state, 'ready');
  assert.deepEqual(chunksFetched(fetch), [0, 1, 2, 3, 4]);
  assert.deepEqual(Buffer.from(await (await s2.open('tiny-q4')).read(0, SIZE)), Buffer.from(DATA2));
  assert.equal(fs.disk.used, SIZE);
});

test('a CDN reply that is not the asked range is refused', async () => {
  const fetch = fakeHf();
  const wrong = async (u, i) => { const r = await fetch(u, i); return { ...r, status: 200 }; };
  await assert.rejects(make({ fetch: wrong }).store.download('tiny-q4'), (e) => e.reason === 'server');
  const short = async (u, i) => { const r = await fetch(u, i); return { ...r, headers: new Headers({ 'content-range': `bytes 0-10/${SIZE}` }) }; };
  await assert.rejects(make({ fetch: short }).store.download('tiny-q4'), (e) => e.reason === 'server');
});

test('the shipped manifest is well formed and pinned', () => {
  const M = require('../../extension/lib/ai/local/models.json');
  assert.ok(Array.isArray(M.models) && M.models.length >= 1);
  for (const m of M.models) {
    assert.match(m.commit, /^[0-9a-f]{40}$/);
    assert.equal(m.url, `https://huggingface.co/${m.repo}/resolve/${m.commit}/${m.file}`);
    assert.equal(m.chunk, 67108864);
    assert.equal(m.sha256.length, Math.ceil(m.size / m.chunk));
    for (const h of [...m.sha256, m.total]) assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(S.valid(m), true, m.id);
  }
});

test('a download asked for just before a remove is cancelled, not restarted once the catalog loads', async () => {
  const { store, fetch } = make();
  const p = store.download('tiny-q4');
  await store.remove('tiny-q4');
  await assert.rejects(p, (e) => e.reason === 'removed');
  await settle();
  assert.deepEqual(await store.status('tiny-q4'), { state: 'missing' });
  assert.equal(fetch.log.length, 0);
});

test('a caller whose progress replay cancels it is cancelled, and stops counting as waiting', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = fakeHf();
  const slow = async (u, i) => { if (fetch.log.length === 1) await gate; return fetch(u, i); };
  const m = make({ fetch: slow });
  const a = new AbortController(), b = new AbortController();
  const first = m.store.download('tiny-q4', { signal: a.signal });
  while (fetch.log.length < 1) await settle();
  const second = m.store.download('tiny-q4', { signal: b.signal, onProgress: () => b.abort() });
  await assert.rejects(second, (e) => e.reason === 'aborted');
  a.abort(); // the last one waiting: the download stops
  await assert.rejects(first, (e) => e.reason === 'aborted');
  release();
  await settle();
  assert.ok(fetch.log.length <= 2, `the download went on: ${fetch.log.length} requests`);
  assert.notEqual((await m.store.status('tiny-q4')).state, 'ready');
});

test('a remove in another context cancels a running download with reason removed and frees its space', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = fakeHf();
  const slow = async (u, i) => { if (fetch.log.length === 2) await gate; return fetch(u, i); };
  const a = make({ fetch: slow });
  const b = twin(a);
  const running = a.store.download('tiny-q4');
  while (fetch.log.length < 2) await settle();
  const gone = b.remove('tiny-q4');
  await settle();
  release();
  await assert.rejects(running, (e) => e.reason === 'removed');
  await gone;
  assert.equal(a.fs.disk.used, 0);
  assert.deepEqual(await a.store.status('tiny-q4'), { state: 'missing' });
  assert.deepEqual(await b.status('tiny-q4'), { state: 'missing' });
});

test('a download queued in another context before a remove does not outlive it', async () => {
  for (const channel of [undefined, null]) {
    let loaded;
    const catalog = new Promise((r) => { loaded = r; });
    // With no message (null) the lock's order alone decides: the download first, then the remove.
    const a = make({ models: () => catalog, ...(channel === null && { channel }) });
    const b = twin(a, { channel: a.channel });
    const p = a.store.download('tiny-q4').then((r) => r.state, (e) => e.reason);
    await settle(); // asked for, and waiting on its catalog
    const gone = b.remove('tiny-q4');
    await settle();
    loaded([entry()]);
    await gone;
    const ended = await p;
    assert.ok(channel === null ? ['ready', 'removed'].includes(ended) : ended === 'removed', `${channel}: ${ended}`);
    await settle();
    assert.deepEqual(await b.status('tiny-q4'), { state: 'missing' }, 'nothing kept after the remove');
    assert.equal(a.fs.disk.used, 0);
    // A download asked for after the remove runs.
    assert.equal((await a.store.download('tiny-q4')).state, 'ready');
  }
});

test('verify in another context waits for a running download instead of deleting its chunks', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = fakeHf();
  const slow = async (u, i) => { if (fetch.log.length === 2) await gate; return fetch(u, i); };
  const a = make({ fetch: slow });
  const b = twin(a);
  const running = a.store.download('tiny-q4');
  while (fetch.log.length < 2) await settle();
  let checked = null;
  const check = b.verify('tiny-q4').then((v) => { checked = v; });
  await settle();
  assert.equal(checked, null, 'verify waits');
  release();
  assert.equal((await running).state, 'ready');
  await check;
  assert.deepEqual(checked, { state: 'ready' });
  assert.deepEqual(chunksFetched(fetch), [0, 1, 2, 3, 4]);
});

test('a remove while the last chunk is checked and written ends the download as removed, never ready', async () => {
  const { store } = make();
  let removing = null;
  const p = store.download('tiny-q4', { onProgress: (x) => { if (x === 1 && !removing) removing = store.remove('tiny-q4'); } });
  await assert.rejects(p, (e) => e.reason === 'removed');
  await removing;
  assert.deepEqual(await store.status('tiny-q4'), { state: 'missing' });
});

test('a download started once another context\'s remove has finished is not cancelled by its late message', async () => {
  const fetch = fakeHf();
  const slow = async (u, i) => { if (!fetch.log.length) await settle(); return fetch(u, i); }; // the message lands mid-download
  const a = make({ fetch: slow });
  const b = twin(a);
  await a.store.remove('other'); // a has been listening since its own earlier work
  await b.remove('tiny-q4');
  assert.equal((await a.store.download('tiny-q4')).state, 'ready');
  await settle();
  assert.deepEqual(await a.store.status('tiny-q4'), { state: 'ready' });
});

test('removes and downloads in quick succession keep their order whatever the clock says', async () => {
  const real = performance.now;
  performance.now = () => 1000; // a clock too coarse to tell them apart
  try {
    const a = make({ channel: null });
    const b = twin(a, { channel: null });
    await a.store.remove('tiny-q4');
    assert.equal((await a.store.download('tiny-q4')).state, 'ready', 'a download after a remove runs');
    await b.remove('tiny-q4');
    await b.remove('tiny-q4');
    // Queued before a third remove, with no message to tell it: it runs first, and the remove still leaves nothing.
    let loaded;
    const catalog = new Promise((r) => { loaded = r; });
    const c = twin(a, { models: () => catalog, channel: null });
    const p = c.download('tiny-q4').catch((e) => e);
    await settle();
    const gone = b.remove('tiny-q4');
    await settle();
    loaded([entry()]);
    await gone; await p;
    assert.deepEqual(await b.status('tiny-q4'), { state: 'missing' });
    assert.equal((await a.store.download('tiny-q4')).state, 'ready');
  } finally { performance.now = real; }
});

test('a download asked for before another context\'s remove never adopts the generation that remove made', async () => {
  const a = make();
  let release;
  const gate = new Promise((r) => { release = r; });
  let first = true;
  // a's first OPFS read is slow: its snapshot of the removal generation lands after b's remove has written a new one.
  const slowRoot = async () => { if (first) { first = false; await gate; } return a.fs.root; };
  const early = S.create({ models: [entry()], fetch: a.fetch, root: slowRoot, estimate: a.fs.estimate, locks: a.locks, channel: a.channel });
  const b = twin(a);
  const p = early.download('tiny-q4');
  const gone = b.remove('tiny-q4');
  await settle();
  release();
  await assert.rejects(p, (e) => e.reason === 'removed');
  await gone;
  assert.equal(a.fetch.log.length, 0);
  assert.deepEqual(await b.status('tiny-q4'), { state: 'missing' });
});
