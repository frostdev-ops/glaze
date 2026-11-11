// A randomized multi-device chaos test for Sync to Google Drive (test/documents/drive-chaos.test.js, tools/dev/drive-chaos.js).
// Each device is a worker of its own: a vm context running background.js's own library list and its Drive section, so the
// real drive.js, drive-sync.js, drive-store.js, writer-papers.js, notes.js and doc-files.js, against chrome.storage.local and
// sync, the Notes database and the documents' file store, all kept on a host-side disk that outlives the context. Killing a
// device stops it at its K-th await on that disk or the network, or a named upload (the write applied or not, the reply lost),
// and boots a new context over the same disk, as the browser restarts a stopped worker. Every device talks to stand-in Drives
// (test/helpers/drive-standin.cjs, one per Google account) through a layer that adds Drive's failures and its search lag.
// A seed makes a list of operations (edits, deletes, Settings, tasks, Notes, Looks, Gradescope, outside edits and trash in
// Drive, Sync off and on, an account change, offline, runs, kills); then a quiet phase (no faults, every device on and online,
// runs until nothing changes) and the invariants: convergence, no loss, quiescence, Drive's state, no stall.
// Everything is deterministic for a seed: one virtual clock, seeded randomness, synchronous digests and compression, and
// every await on the disk or the network resolved in order through setImmediate.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const nodeCrypto = require('node:crypto');
const { standin } = require('./drive-standin.cjs');
const { ERRORS } = require('../fixtures/drive/v3.js');

const EXT = path.resolve(__dirname, '../../extension');
const BG = path.join(EXT, 'background');
const sha = (s) => nodeCrypto.createHash('sha256').update(s).digest('hex');
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

// ---- seeded randomness (sfc32)
const rng = (seed) => {
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = (seed >>> 0) ^ 0xdeadbeef;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0; a = b ^ b >>> 9; b = c + (c << 3) | 0; c = c << 21 | c >>> 11; c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  const r = () => next();
  r.int = (n) => Math.floor(next() * n);
  r.pick = (list) => list[Math.floor(next() * list.length)];
  r.chance = (p) => next() < p;
  r.weighted = (table) => { const total = table.reduce((n, [, w]) => n + w, 0); let x = next() * total; for (const [v, w] of table) { if ((x -= w) < 0) return v; } return table[table.length - 1][0]; };
  return r;
};

// ---- the worker's scripts, compiled once and run in each device's context
// Tiny transfers (o.tiny, --tiny): a transfer goes large past TINY.at bytes instead of 5 MB, in chunks and ranges of
// TINY.step, so most documents, JSON copies, records and snapshots go through staged resumable uploads and ranged downloads.
// Each device's drive.js and drive-sync.js are rewritten so as they load (the shipped files stay as they are), the stand-ins
// take chunks of TINY.quantum, and an applied kill on a chunk leaves Drive part of it. Sync stages as the worker asks
// (background/background.js env.staged, STAGED below), unless o.staged says otherwise: with it off, tiny transfers make nearly
// every document and many records too large to sync, which the checks then hold to staying on their device, marked, with
// nothing staged.
const TINY = { at: 256, step: 512, quantum: 256 };
const SHRUNK = {
  'drive.js': [['const SMALL = 5 << 20;', `const SMALL = ${TINY.at};`], ['const STEP = { min: 256 << 10, max: 8 << 20,', `const STEP = { min: ${TINY.quantum}, max: ${TINY.step},`]],
  'drive-sync.js': [['const BIG = 5 << 20, PIECE = 8 << 20;', `const BIG = ${TINY.at}, PIECE = ${TINY.step};`], ['Math.max(256 << 10,', `Math.max(${TINY.quantum},`]],
};
const scripts = new Map();
const script = (file, tiny = false) => {
  const k = `${tiny ? 'tiny:' : ''}${file}`;
  let s = scripts.get(k);
  if (!s) {
    let src = fs.readFileSync(file, 'utf8');
    for (const [from, to] of (tiny && SHRUNK[path.basename(file)]) || []) {
      if (!src.includes(from)) throw new Error(`drive-chaos: ${path.basename(file)} no longer has ${from}`);
      src = src.replaceAll(from, to);
    }
    s = new vm.Script(src, { filename: path.relative(EXT, file) });
    scripts.set(k, s);
  }
  return s;
};
const BG_SOURCE = fs.readFileSync(path.join(BG, 'background.js'), 'utf8');
// background.js's own first importScripts: every library the worker has before anything loads on demand.
const FIRST = [...BG_SOURCE.slice(0, BG_SOURCE.indexOf(');')).matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);
// What brokerIn('backup') loads (background.js BROKER_FILES.backup).
const BACKUP_FILES = (() => { const m = /BROKER_FILES\.backup = \[([^\]]+)\]/.exec(BG_SOURCE); return m ? [...m[1].matchAll(/'([^']+\.js)'/g)].map((x) => x[1]) : []; })();
// Shared worker helpers used by the Drive section. Keep the real singleton and lazy core import on each device boot.
const MEMORY_HELPERS = new vm.Script((() => {
  const keys = BG_SOURCE.match(/^const keysOf = .+;$/m)?.[0];
  const from = BG_SOURCE.indexOf('let memoryStore = null;'), to = BG_SOURCE.indexOf('const rimeMemoryOn =', from);
  if (!keys || from < 0 || to <= from) throw new Error('drive-chaos: background.js\'s memory helper markers moved');
  return keys + '\n' + BG_SOURCE.slice(from, to);
})(), { filename: 'background/background.js#memory-helpers' });
// background.js's Drive section, as test/documents/drive-sync-background.test.js runs it.
const SECTION_SOURCE = (() => {
  const from = BG_SOURCE.indexOf('// Sync to Google Drive (documents/drive-sync.js'), to = BG_SOURCE.indexOf('// A Download all wait owns', from);
  if (from < 0 || to < 0) throw new Error('drive-chaos: background.js\'s Drive section markers moved');
  return BG_SOURCE.slice(from, to);
})();
const SECTION = new vm.Script(SECTION_SOURCE, { filename: 'background/background.js#drive' });
// Whether the worker stages transfers past one request (documents/drive-sync.js env.staged).
const STAGED = /\n\s*staged: true,/.test(SECTION_SOURCE);

// ---- in the device's context: what the worker has from the browser, over the host's disk. Run there as source, so every
// object, array and byte array it makes is the context's own (drive.js checks bytes instanceof Uint8Array).
function prelude(host) {
  'use strict';
  const g = globalThis;
  // Every value read from the disk, made here: plain data and byte arrays, from whichever context wrote it.
  const clone = (v) => (ArrayBuffer.isView(v) ? new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)) : Array.isArray(v) ? v.map(clone)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)])) : v);
  g.__clone = clone;
  const RealDate = Date;
  g.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(host.now()); } static now() { return host.now(); } };
  Math.random = () => host.random();
  const enc = new host.TextEncoder();
  g.TextEncoder = class { get encoding() { return 'utf-8'; } encode(s = '') { const b = enc.encode(s), out = new Uint8Array(b.length); out.set(b); return out; } };
  g.crypto = {
    subtle: { digest: async (alg, data) => host.digest(alg, data) },
    randomUUID: () => host.uuid(),
    getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(host.random() * 256); return a; },
  };
  // A Blob in memory: its bytes at once, never through the host's file machinery (whose timing would vary).
  g.Blob = class Blob {
    constructor(parts = [], o = {}) {
      const bufs = parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p instanceof Blob ? p._bytes : ArrayBuffer.isView(p) ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength) : p instanceof ArrayBuffer || p?.byteLength !== undefined ? new Uint8Array(p) : enc.encode(String(p))));
      const n = bufs.reduce((s, b) => s + b.length, 0), out = new Uint8Array(n);
      let at = 0;
      for (const b of bufs) { out.set(b, at); at += b.length; }
      this._bytes = out; this.type = o.type || '';
    }
    get size() { return this._bytes.length; }
    arrayBuffer() { return Promise.resolve(this._bytes.slice().buffer); }
    text() { return Promise.resolve(new host.TextDecoder().decode(this._bytes)); }
    slice(a = 0, b = this._bytes.length, type = '') { return new Blob([this._bytes.slice(a, b)], { type }); }
    stream() { const bytes = this._bytes.slice(); return new host.ReadableStream({ start(c) { if (bytes.length) c.enqueue(bytes); c.close(); } }); }
  };
  // Compression in one step at the stream's end (zlib's synchronous calls): the same bytes as the browser's, in order.
  const zipper = (fn) => class { constructor(format) { const chunks = []; const t = new host.TransformStream({ transform(c) { chunks.push(new Uint8Array(c)); }, flush(c) { c.enqueue(host.zip(fn, format, chunks)); } }); this.readable = t.readable; this.writable = t.writable; } };
  g.CompressionStream = zipper('compress');
  g.DecompressionStream = zipper('decompress');
  // Timers: the worker's own waits are the host's to run (a run's push 5 s after a save, Drive's retry waits).
  g.setTimeout = (fn, ms = 0, ...a) => host.timer(() => fn(...a), ms);
  g.clearTimeout = (id) => host.clearTimer(id);
  g.setInterval = () => 0; g.clearInterval = () => {};
  // background.js's own, outside its Drive section (transfers keep the worker up where it isn't Safari).
  g.SAFARI = false;
  // Web Locks, as Chrome's worker has them: each name one holder at a time, in the order asked.
  const held = new Map();
  g.navigator = { locks: { request: (name, a, b) => { const fn = typeof a === 'function' ? a : b; const p = (held.get(name) || Promise.resolve()).then(() => fn({ name })); held.set(name, p.catch(() => {})); return p; } }, storage: { estimate: async () => ({ quota: 1e12, usage: 0 }) } };
  const events = new Map();
  g.addEventListener = (type, fn) => { if (!events.has(type)) events.set(type, []); events.get(type).push(fn); };
  g.__fire = (type) => { for (const fn of events.get(type) || []) fn({ type }); };

  // chrome.storage over the disk: JSON as the browser stores it; an equal write is no change and nobody hears of it.
  const changed = [];
  const area = (name) => ({
    get: (k) => host.io(name, 'get', () => {
      const keys = k == null ? host.disk.keys(name) : typeof k === 'string' ? [k] : Array.isArray(k) ? k : Object.keys(k);
      const out = {};
      for (const x of keys) { const s = host.disk.get(name, x); if (s !== undefined) out[x] = JSON.parse(s); else if (k && typeof k === 'object' && !Array.isArray(k)) out[x] = k[x]; }
      return out;
    }),
    getKeys: () => host.io(name, 'keys', () => host.disk.keys(name)),
    set: (o) => host.io(name, 'set', () => {
      host.refuse(name, o);
      const c = {};
      for (const [k, v] of Object.entries(o)) {
        const s = JSON.stringify(v);
        if (s === undefined) continue;
        const was = host.disk.get(name, k);
        if (was !== s) { c[k] = { ...(was !== undefined && { oldValue: JSON.parse(was) }), newValue: JSON.parse(s) }; host.disk.put(name, k, s); }
      }
      host.emit(name, c);
    }),
    remove: (k) => host.io(name, 'remove', () => {
      const c = {};
      for (const x of [].concat(k)) { const was = host.disk.get(name, x); if (was !== undefined) { c[x] = { oldValue: JSON.parse(was) }; host.disk.drop(name, x); } }
      host.emit(name, c);
    }),
  });
  const listeners = (list) => ({ addListener: (fn) => list.push(fn), removeListener: (fn) => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); } });
  g.__listeners = { changed, message: [], startup: [], connect: [] };
  g.__deliver = (c, name) => { for (const fn of changed) { try { fn(c, name); } catch (e) { console.error(e); } } };
  g.chrome = {
    storage: { local: area('local'), sync: area('sync'), onChanged: listeners(changed) },
    runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => ({ version: '4.0.1', host_permissions: [] }),
      onMessage: listeners(g.__listeners.message), onStartup: listeners(g.__listeners.startup), onConnect: listeners(g.__listeners.connect), lastError: undefined },
    i18n: { getUILanguage: () => 'en' },
  };
  // An IndexedDB store of the worker's, over the disk (the Notes database's three stores, the documents' file store).
  const idb = (db) => ({
    get: (s, k) => host.io(db, 'get', () => clone(host.disk.get(db, `${s}\u0000${k}`))),
    put: (s, k, v) => host.io(db, 'put', () => { host.disk.put(db, `${s}\u0000${k}`, clone(v)); }),
    del: (s, ks) => host.io(db, 'del', () => { for (const k of ks) host.disk.drop(db, `${s}\u0000${k}`); }),
    scan: (s, prefix = '') => host.io(db, 'scan', () => host.disk.keys(db).filter((k) => k.startsWith(`${s}\u0000${prefix}`)).sort().map((k) => [k.slice(s.length + 1), clone(host.disk.get(db, k))])),
    keys: (s, prefix = '') => host.io(db, 'keys', () => host.disk.keys(db).filter((k) => k.startsWith(`${s}\u0000${prefix}`)).sort().map((k) => k.slice(s.length + 1))),
    estimate: async () => ({ quota: 1e12, usage: 0 }),
  });
  g.NOTES_DB = idb('notesdb');
  const docs = idb('docfiles');
  // Sync's transfer staging (glaze-drive): the worker's IndexedDB, here kept on the device's disk like the doc store.
  g.__stage = { get: (k) => docs.get('s', k), many: async (ks) => { const out = []; for (const k of ks) out.push(await docs.get('s', k)); return out; }, keys: (p) => docs.keys('s', p), entries: (p) => docs.scan('s', p),
    write: (puts = [], dels = []) => host.io('docfiles', 'write', () => { for (const [k, v] of puts) host.disk.put('docfiles', `s\u0000${k}`, clone(v)); for (const k of dels) host.disk.drop('docfiles', `s\u0000${k}`); }) };
  const fileDb = {
    get: (k) => docs.get('f', k), many: async (ks) => { const out = []; for (const k of ks) out.push(await docs.get('f', k)); return out; },
    keys: (prefix) => docs.keys('f', prefix), entries: (prefix) => docs.scan('f', prefix),
    write: (puts = [], dels = []) => host.io('docfiles', 'write', () => { for (const [k, v] of puts) host.disk.put('docfiles', `f\u0000${k}`, clone(v)); for (const k of dels) host.disk.drop('docfiles', `f\u0000${k}`); }),
  };
  // The worker's own helpers outside its Drive section (background/background.js), as they are there.
  g.importScripts = (...files) => { for (const f of files) host.load(f); };
  g.brokerTurn = null;
  g.sessionWords = null;
  g.paperStore = null;
  g.docFiles = null;
  g.brokerArea = (a) => ({
    get: (keys) => chrome.storage[a].get(keys),
    set: (patch) => chrome.storage[a].set(patch).then(() => true, () => false),
    remove: (keys) => chrome.storage[a].remove(keys).then(() => true, () => false),
  });
  const brokerFiles = new Set();
  g.brokerIn = (name) => { if (name !== 'backup') return; for (const f of host.backupFiles) if (!brokerFiles.has(f)) { importScripts(f); brokerFiles.add(f); } };
  g.fromEditor = (s) => s.id === chrome.runtime.id && typeof s.url === 'string' && s.url.split(/[?#]/)[0] === chrome.runtime.getURL('options.html');
  g.driveEditor = (s) => g.fromEditor(s) && s.frameId === 0; // background.js's: Settings' own tab (these senders carry no origin)
  g.googlePage = (s) => s.id === chrome.runtime.id && typeof s.url === 'string' && ['options.html', 'papers.html', 'writer.html'].some((p) => s.url.split(/[?#]/)[0] === chrome.runtime.getURL(p));
  g.openDocFiles = () => { if (!g.docFiles) { if (!g.GZ_DOC_FILES) importScripts('../documents/doc-files.js'); g.docFiles = GZ_DOC_FILES.store(fileDb); } return g.docFiles; };
  g.openPapers = () => {
    if (!g.paperStore) {
      importScripts('../writer/writer-styles.js', '../writer/writer-papers.js');
      g.paperStore = GZ_WRITER_PAPERS.open(chrome.storage.local, () => Date.now(), { busy: async () => false, files: openDocFiles() });
    }
    return g.paperStore;
  };
  g.driveLib = () => { if (!g.GZ_DRIVE) importScripts('../documents/doc-kinds.js', '../documents/drive.js'); return GZ_DRIVE; };
  // Google's sign-in (background/google.js) as its account and token: the account the device signed in with (storage.local
  // google, as google.js saved() reads it), and that account's token.
  g.googleLib = () => ({ ON: true });
  g.openGoogle = () => ({
    account: async () => { const x = (await chrome.storage.local.get('google')).google; return typeof x?.email === 'string' ? x.email : null; },
    token: async () => { const x = (await chrome.storage.local.get('google')).google; if (typeof x?.email !== 'string') throw Object.assign(new Error('auth'), { why: 'auth' }); return host.token(x.email); },
    drop: async () => {},
  });
  g.fetch = (url, init) => host.fetch(url, init);
  g.console = host.console;
}

// ---- the stand-in Drives and what the network does to their answers
const ACCOUNTS = { A: 'student@school.edu', B: 'other@school.edu' };
const TOKENS = { [ACCOUNTS.A]: 'tok-A', [ACCOUNTS.B]: 'tok-B' };
const FAULTS = {
  500: () => ({ status: 500, body: { error: { errors: [{ domain: 'global', reason: 'backendError', message: 'Backend Error' }], code: 500, message: 'Backend Error' } } }),
  503: () => ({ status: 503, body: { error: { errors: [{ domain: 'global', reason: 'backendError', message: 'Service Unavailable' }], code: 503, message: 'Service Unavailable' } } }),
  429: () => ({ status: 429, body: ERRORS[429] }),
  rate: () => ({ status: 403, body: ERRORS.userRateLimitExceeded }),
  quota: () => ({ status: 403, body: ERRORS.storageQuotaExceeded }),
  401: () => ({ status: 401, body: ERRORS[401] }),
};
const network = (tiny = false) => {
  const quantum = tiny ? TINY.quantum : undefined;
  const drives = { [ACCOUNTS.A]: standin({ tokens: new Set([TOKENS[ACCOUNTS.A]]), owner: ACCOUNTS.A, quantum }), [ACCOUNTS.B]: standin({ tokens: new Set([TOKENS[ACCOUNTS.B]]), owner: ACCOUNTS.B, quantum }) };
  const byToken = Object.fromEntries(Object.entries(TOKENS).map(([acct, tok]) => [tok, drives[acct]]));
  // Search lag: a file Drive made shows in files.list only after this many lists (each Drive its own count).
  const lag = new Map(Object.values(drives).map((d) => [d, new Map()])), known = new Map(Object.values(drives).map((d) => [d, new Set()]));
  const net = { drives, lag: 0, writes: 0 };
  const bytesOf = (body) => (body == null ? Buffer.alloc(0) : typeof body === 'string' ? Buffer.from(body) : ArrayBuffer.isView(body) ? Buffer.from(body.buffer, body.byteOffset, body.byteLength)
    : body instanceof ArrayBuffer ? Buffer.from(body) : typeof body?._bytes !== 'undefined' ? Buffer.from(body._bytes) : Buffer.from(String(body)));
  // One request: dev's faults, then Drive. → a Response, or null for a network failure.
  net.handle = (dev, url, init = {}) => {
    const headers = { ...(init.headers || {}) };
    const auth = String(headers.authorization || headers.Authorization || '').replace(/^Bearer /, '');
    const drive = byToken[auth] || drives[ACCOUNTS.A];
    const method = init.method || 'GET', write = method !== 'GET';
    const f = dev.fault(url, method);
    if (f === 'offline') return null;
    if (f && f !== 'lost' && FAULTS[f]) { const a = FAULTS[f](); dev.stats.faults++; return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json; charset=UTF-8' } }); }
    const before = drive.log.length;
    const a = drive.handle({ method, url, headers, body: bytesOf(init.body) });
    for (const e of drive.log.slice(before)) {
      e.dev = dev.name;
      // A connection lost right after Drive took an upload of this name (the worker's push stops there).
      if (dev.cut && a && a.status < 300 && new RegExp(dev.cut).test(e.upload?.meta?.name || '')) { dev.cut = null; dev.offline = true; }
    }
    if (write) net.writes++;
    // New files: hidden from search for the lag's count of lists.
    const seen = known.get(drive), delayed = lag.get(drive);
    for (const id of drive.files.keys()) if (!seen.has(id)) { seen.add(id); if (net.lag > 0) delayed.set(id, net.lag); }
    if (f === 'lost') { dev.stats.faults++; return null; } // Drive did it; the answer never came
    if (!a) return null;
    let body = a.body;
    if (method === 'GET' && new URL(url).pathname === '/drive/v3/files' && a.status === 200 && delayed.size) {
      const j = JSON.parse(body.toString('utf8'));
      if (Array.isArray(j.files)) j.files = j.files.filter((x) => !(delayed.get(x.id) > 0));
      for (const [id, n] of delayed) { if (n <= 1) delayed.delete(id); else delayed.set(id, n - 1); }
      body = Buffer.from(JSON.stringify(j));
    }
    return new Response(a.status === 204 || a.status === 304 ? null : body, { status: a.status, headers: a.headers });
  };
  net.calm = () => { net.lag = 0; for (const delayed of lag.values()) delayed.clear(); };
  // The next chunk this request's Drive takes keeps only keep bytes, its answer never coming (a worker stopped mid-chunk).
  net.cut = (init, keep) => {
    const auth = String(init?.headers?.authorization || init?.headers?.Authorization || '').replace(/^Bearer /, '');
    (byToken[auth] || drives[ACCOUNTS.A]).cut(keep, (e) => !!e.chunk && !e.chunk.status);
  };
  return net;
};

// ---- a device: its disk, and the worker running on it now
class Device {
  constructor(world, name, index) {
    this.world = world; this.name = name; this.index = index;
    // What outlives a worker: storage.local and sync, the Notes database, the file store. Values: JSON text (storage) or data.
    this.disk = { local: new Map(), sync: new Map(), notesdb: new Map(), docfiles: new Map() };
    this.gen = 0; this.ctx = null; this.dead = false;
    this.offline = false; this.faults = null; this.syncRefuse = 0;
    this.timers = new Map(); this.timerSeq = 0;
    this.pending = 0; this.events = 0;
    this.armed = null; this.ios = 0;
    this.log = []; this.stats = { faults: 0, kills: 0, boots: 0, runs: 0 };
    this.opRng = rng(1);
    this.boot();
  }
  get account() { const s = this.disk.local.get('google'); return s ? JSON.parse(s).email : null; }
  // A new worker over the same disk: everything in memory gone (pending pushes, Drive sync's queues, the records' applying).
  boot() {
    const gen = ++this.gen, dev = this, world = this.world, r = rng(world.seed * 7919 + this.index * 104729 + gen);
    this.dead = false; this.timers.clear(); this.pending = 0; this.events = 0; this.ios = 0;
    this.stats.boots++;
    const alive = () => !dev.dead && dev.gen === gen;
    const later = (fn) => new Promise((res, rej) => {
      dev.pending++;
      setImmediate(() => { if (!alive()) return; dev.pending--; try { res(fn()); } catch (e) { rej(e); } });
    });
    const loaded = new Set();
    const host = {
      now: () => world.clock,
      random: () => r(),
      uuid: () => { const h = [...Array(16)].map(() => Math.floor(r() * 256)); h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80; const x = h.map((b) => b.toString(16).padStart(2, '0')).join(''); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; },
      digest: (alg, data) => { const b = nodeCrypto.createHash(String(alg?.name || alg).replace('-', '').toLowerCase()).update(Buffer.from(data.buffer, data.byteOffset, data.byteLength)).digest(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); },
      zip: (fn, format, chunks) => {
        const b = Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
        const z = { compress: { gzip: zlib.gzipSync, deflate: zlib.deflateSync, 'deflate-raw': zlib.deflateRawSync }, decompress: { gzip: zlib.gunzipSync, deflate: zlib.inflateSync, 'deflate-raw': zlib.inflateRawSync } }[fn][format];
        return new Uint8Array(z(b));
      },
      TextEncoder, TextDecoder, ReadableStream, TransformStream,
      timer: (fn, ms) => { const id = ++dev.timerSeq; dev.timers.set(id, { fn, ms, gen }); return id; },
      clearTimer: (id) => { dev.timers.delete(id); },
      // An await on the disk or the network: the K-th of an armed run kills the worker there.
      io: (store, op, fn) => {
        if (!alive()) return new Promise(() => {});
        dev.ios++;
        const a = dev.armed;
        if (a?.inject && !a.inject.started && a.inject.at === dev.ios) {
          const x = a.inject;
          world.trace(`  ${dev.name} edits at await ${dev.ios} of the run`);
          x.started = Promise.resolve().then(() => world.perform(dev, x.op)).catch((e) => world.failed(dev, e));
        }
        if (a?.kill === dev.ios) {
          if (a.apply) { try { fn(); } catch { /* refused */ } }
          dev.die(`${store}.${op}`);
          return new Promise(() => {});
        }
        return later(fn);
      },
      fetch: (url, init) => {
        // Known interrupted uploads name the request, rather than an await count that shifts with unrelated reads.
        const stop = dev.armed?.upload, method = init?.method || 'GET';
        if (stop && method === stop.method && new URL(url).pathname.startsWith('/upload/')) {
          const b = init.body, text = typeof b === 'string' ? b : ArrayBuffer.isView(b) ? Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('utf8') : '';
          const metadata = text.startsWith('--') ? text.slice(text.indexOf('\r\n\r\n') + 4).split('\r\n--')[0] : text;
          let role;
          try { role = JSON.parse(metadata).appProperties?.glaze; } catch { /* a media chunk, not upload metadata */ }
          if (role === stop.glaze) dev.armed.kill = dev.ios + 1;
        }
        // Tiny transfers: a kill applied at a chunk leaves Drive part of it, as a worker stopped mid-request does.
        const range = /^bytes (\d+)-(\d+)\//.exec(init?.headers?.['content-range'] || '');
        if (world.o.tiny && range && dev.armed?.apply && dev.armed.kill === dev.ios + 1) world.net.cut(init, r.int(Number(range[2]) - Number(range[1]) + 2));
        return host.io('net', method, () => {
          const res = world.net.handle(dev, url, init);
          if (!res) throw new TypeError('Failed to fetch');
          return res;
        });
      },
      token: (email) => TOKENS[email] || 'tok-none',
      emit: (name, c) => {
        if (!Object.keys(c).length) return;
        dev.observe?.(name, c);
        // A stop right after a write holding this text: the worker dies at its next await (the write's event never heard).
        if (dev.armed?.after && JSON.stringify(c).includes(dev.armed.after)) { dev.armed.kill = dev.ios + 1; dev.armed.after = null; }
        dev.events++;
        setImmediate(() => { if (!alive()) return; dev.events--; dev.ctx.__deliver(c, name); });
      },
      refuse: (name, o) => {
        if (name !== 'sync' || dev.syncRefuse <= 0) return;
        dev.syncRefuse--; dev.stats.faults++;
        throw new Error('This request exceeds the MAX_WRITE_OPERATIONS_PER_MINUTE quota.');
      },
      disk: {
        get: (s, k) => dev.disk[s].get(k), put: (s, k, v) => { dev.disk[s].set(k, v); }, drop: (s, k) => { dev.disk[s].delete(k); },
        keys: (s) => [...dev.disk[s].keys()],
      },
      load: (f) => {
        const file = path.resolve(BG, f);
        if (loaded.has(file)) return;
        loaded.add(file);
        script(file, !!world.o.tiny).runInContext(dev.ctx);
        if (/doc-files\.js$/.test(file)) { const F = dev.ctx.GZ_DOC_FILES, idb = F.idb; F.idb = (f, name, R) => (name === 'glaze-drive' ? dev.ctx.__stage : idb(f, name, R)); }
        if (/drive-sync\.js$/.test(file)) dev.patchSync();
      },
      backupFiles: BACKUP_FILES,
      console: { log: (...a) => dev.note('log', a), info: (...a) => dev.note('info', a), warn: (...a) => dev.note('warn', a), error: (...a) => dev.note('error', a), debug: () => {} },
    };
    this.host = host;
    const ctx = vm.createContext({ URL, URLSearchParams, TextDecoder, Response, Headers, ReadableStream, WritableStream, TransformStream, AbortController, AbortSignal, atob, btoa, structuredClone, queueMicrotask, Event, EventTarget, DOMException });
    ctx.globalThis = ctx; ctx.self = ctx;
    this.ctx = ctx;
    vm.runInContext(`(${prelude.toString()})`, ctx)(host);
    for (const f of FIRST) host.load(f);
    MEMORY_HELPERS.runInContext(ctx);
    SECTION.runInContext(ctx);
    // The device's own helpers in its context: what a page or Settings asks of the worker.
    this.api = vm.runInContext(`({
      turn: (f) => (brokerTurn ||= GZ_CARDS.queue())(f),
      sync: () => openDriveSync(),
      papers: () => openPapers(),
      files: () => openDocFiles(),
      message: (m, url) => { const s = { id: 'glaze', url: 'chrome-extension://glaze/' + url, frameId: 0, tab: { id: 1 } }; let out; for (const f of __listeners.message) { const r = f(m, s, (x) => { out = x; }); } return out; },
      notes: (m) => (brokerTurn ||= GZ_CARDS.queue())(() => GZ_NOTES.run(m, { sync: brokerArea('sync'), local: brokerArea('local') }, NOTES_DB).catch(() => ({ ok: false, error: 'db' }))),
      startup: () => { for (const f of __listeners.startup) f(); },
      online: () => __fire('online'),
      // A library of the worker's by name, whether its script declared it with var or const.
      lib: (name) => ({ GZ_SANITIZE, GZ_TODO, GZ_PET, GZ_GRADESCOPE, GZ_HISTORY, GZ_NOTES })[name],
    })`, ctx);
  }
  // Drive sync's waits through the host: Drive's retry waits pass on the clock at once, a push waits for the device's timers.
  patchSync() {
    const S = this.ctx.GZ_DRIVE_SYNC, create = S.create, dev = this, gen = this.gen;
    if (S.__chaos) return;
    S.__chaos = true;
    // Staged transfers (documents/drive-sync.js env.staged): as the worker asks, or as o.staged says.
    S.create = (env) => create({ ...env, staged: dev.world.staged,
      sleep: (ms) => new Promise((res) => { dev.world.clock += ms; setImmediate(() => { if (dev.gen === gen && !dev.dead) res(); }); }),
      timer: (fn, ms) => { const id = ++dev.timerSeq; dev.timers.set(id, { fn, ms, gen, push: true }); return () => dev.timers.delete(id); } });
  }
  note(level, a) {
    const s = a.map((x) => (x instanceof Error || x?.stack ? `${x.message || x}` : typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
    this.log.push(`[${this.world.step}] ${this.name} ${level}: ${s}`.slice(0, 400));
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    if (level === 'error') this.world.errors.push(`${this.name}: ${s}`.slice(0, 400));
  }
  die(where) {
    this.dead = true; this.stats.kills++;
    this.world.trace(`  ${this.name} killed at ${where} (await ${this.ios})`);
    this.killed?.();
  }
  // A fault for this request, from the device's fault state and the operation's randomness.
  fault(url, method) {
    if (this.offline) return 'offline';
    const f = this.faults;
    if (!f) return null;
    const r = this.opRng;
    if (r.chance(f.p || 0)) {
      const write = method !== 'GET';
      const kinds = [['500', 2], ['503', 1], ['429', 2], ['rate', 1], ['401', 1], ['offline', 1], ...(write ? [['lost', 2], ['quota', f.quota ? 1 : 0]] : [])];
      return r.weighted(kinds);
    }
    return null;
  }
  // Waits until the worker has nothing under way: no await on the disk or the network, no storage event to deliver.
  async settle() {
    for (let i = 0, quiet = 0; ; i++) {
      await new Promise(setImmediate);
      if (this.dead) return 'dead';
      if (this.pending === 0 && this.events === 0) { if (++quiet >= 3) return 'idle'; } else quiet = 0;
      if (i > 2e6) throw new Error(`${this.name} never settles (an endless loop on the disk or the network?)`);
    }
  }
}

// ---- the libraries, in node, for reading a device's disk
const P = require('../../extension/writer/writer-papers.js');
const S = require('../../extension/documents/drive-sync.js');
const ST = require('../../extension/background/drive-store.js');
const N = require('../../extension/planner/notes.js');
const T = require('../../extension/planner/todo.js');
const CL = require('../../extension/planner/classes.js');
const G = require('../../extension/planner/gpa.js');
const SD = require('../../extension/documents/sheets/sheet-data.js');
const M = require('../../extension/documents/sheets/sheet-model.js');
const D0 = require('../../extension/content/defaults.js').GZ_SANITIZE({});

const START = Date.parse('2026-10-30T12:00:00Z');
const FILE_TEXT = { pdf: (t) => `%PDF-1.7\n% ${t}\n`, slides: (t) => `PK\u0003\u0004 deck ${t}` };
const FILE_TYPE = { pdf: 'application/pdf', slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const FILED = ['pdf', 'slides'];
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex').toString('base64');
const SITE = 'https://school.instructure.com/42';
const TODO = `todo:${SITE}`, PET = `pet:${SITE}`, NOTES = `notesIdx:${SITE}`, CLASSES = `classes:${SITE}`, GPA = 'gpaTerms:https://school.instructure.com:u42';
const TOKEN = /ZQ(\d+)QZ/g;
const tokensIn = (s) => [...String(s).matchAll(TOKEN)].map((m) => `ZQ${m[1]}QZ`);
const docOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const hex = (r) => `#${[0, 0, 0].map(() => r.int(256).toString(16).padStart(2, '0')).join('')}`;
const uuidOf = (r) => { const h = [...Array(16)].map(() => r.int(256)); h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80; const x = h.map((b) => b.toString(16).padStart(2, '0')).join(''); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };
const short = (k) => (typeof k === 'string' ? k.replace(/^doc:0*-?0*-?4000-8000-0*/, 'doc:').replace(/^doc:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-([0-9a-f]{4})[0-9a-f]{8}$/, 'doc:…$1') : k);
const json = (s) => (s === undefined ? undefined : JSON.parse(s));

// Records merged item by item: each one's key, cleaner, its items, a new one, an edit, and the record with a list and a deletion.
const ITEMS = {
  tasks: { key: TODO, clean: (v) => T.clean(v), list: (v) => v.tasks, of: (v, id) => T.clean(v).tasks.find((x) => x.id === id),
    make: (n, t) => ({ id: `t${n}`, title: `Task ${n}`, done: 0, at: t }), edit: (n) => ({ title: `Task ${n}` }), with: (v, list) => ({ tasks: list, items: v.items }) },
  classes: { key: CLASSES, clean: (v) => CL.clean(v), list: (v) => v.courses, of: (v, id) => CL.clean(v).courses.find((x) => x.id === id),
    make: (n, t) => ({ id: String(n), name: `Class ${n}`, at: t, periods: [{ days: [1 + (n % 5)], start: 540, end: 600 }] }), edit: (n, t) => ({ name: `Class ${n}`, at: t }),
    with: (v, list, gone, t) => ({ ...v, courses: list, gone: { ...v.gone, ...(gone && { [gone]: t }) } }) },
  gpa: { key: GPA, clean: (v) => G.clean(v), list: (v) => v.t, of: (v, id) => G.clean(v).t.find((x) => x.id === id),
    make: (n, t) => ({ id: `g${n}`, n: `Term ${n}`, c: [{ n: 'Course', cr: 3, g: 'A' }], at: t }), edit: (n, t) => ({ n: `Term ${n}`, at: t }),
    with: (v, list, gone, t) => ({ ...v, t: list, ...((gone || v.d) && { d: { ...v.d, ...(gone && { [gone]: t }) } }) }) },
};

// ---- the operations: plain data made from a seed, each with its own seed for what it decides as it runs, so any subset of
// a list still runs (picks are fractions of what the device has then). shrink() removes and simplifies them.
const USER = ['paper', 'sheet', 'pdf', 'slides', 'setting', 'task', 'note', 'folder', 'look', 'gradescope', 'pet', 'words', 'dash', 'class', 'gpa'];
const generate = (seed, { ops = 40, devices = 2 } = {}) => {
  const r = rng(seed);
  // Records merged item by item (tasks with their ticks, class schedules, GPA terms) from a stream of their own, in place of
  // some of the other user operations, so the rest of a seed's list stays as it was.
  const r2 = rng(seed ^ 0x2b1e5);
  const out = [];
  const userOp = (d) => {
    const t = r.weighted([['paper', 14], ['sheet', 4], ['pdf', 4], ['slides', 2], ['setting', 7], ['task', 4], ['note', 9], ['folder', 3], ['look', 2], ['gradescope', 1], ['pet', 1], ['words', 1], ['dash', 1]]);
    const k = {
      paper: () => r.weighted([['edit', 40], ['new', 22], ['trash', 10], ['untrash', 8], ['delete', 7], ['rename', 10]]),
      sheet: () => r.weighted([['edit', 6], ['new', 4], ['trash', 1]]), pdf: () => r.weighted([['edit', 6], ['new', 4], ['trash', 1]]), slides: () => r.weighted([['edit', 6], ['new', 4], ['trash', 1]]),
      words: () => 'add', dash: () => 'edit',
      setting: () => r.pick(['enabled', 'footer', 'preset', 'colors', 'look']), task: () => r.weighted([['add', 4], ['edit', 3], ['del', 2]]),
      note: () => r.weighted([['new', 5], ['edit', 8], ['picture', 2], ['rename', 2], ['move', 3], ['trash', 2], ['restore', 1], ['purge', 1]]),
      folder: () => r.weighted([['new', 4], ['rename', 2], ['del', 2], ['restore', 1]]), look: () => r.pick(['history', 'favorite']),
      gradescope: () => r.pick(['place', 'hide']), pet: () => r.pick(['wear', 'habitat', 'timer', 'sprite']),
    }[t]();
    const op = { t, k, d, pick: r(), pick2: r(), s: r.int(2 ** 31) };
    const item = r2.weighted([[null, 88], ['task', 6], ['class', 3], ['gpa', 3]]);
    if (!item) return op;
    return { t: item, k: item === 'task' ? r2.weighted([['add', 4], ['edit', 2], ['tick', 2], ['del', 3]]) : r2.weighted([['add', 4], ['edit', 3], ['del', 2]]), d, pick: r2(), pick2: r2(), s: r2.int(2 ** 31) };
  };
  for (let i = 0; i < ops; i++) {
    const d = r.int(devices);
    const kind = r.weighted([['user', 46], ['run', 20], ['drive', 5], ['sync', 2], ['account', 0.8], ['net', 2], ['faults', 2.5], ['lag', 1], ['time', 3], ['restart', 1.5]]);
    let op;
    if (kind === 'user') op = userOp(d);
    else if (kind === 'run') {
      op = { t: 'run', d, how: r.weighted([['poke', 4], ['timers', 4], ['run', 1.5], ['startup', 1]]), s: r.int(2 ** 31) };
      if (r.chance(0.25)) Object.assign(op, { kill: 1 + r.int(r.chance(0.5) ? 60 : 400), apply: r.chance(0.5) });
      else if (r.chance(0.12)) op.after = r.pick(['writerPaper:', 'writerVersions:', 'driveSyncDoc:', 'driveSyncRec:', 'driveSyncDirty', 'driveSyncStamps', 'notesIdx:', '(Drive copy)', '"driveSync"']);
      else if (r.chance(0.2)) op.inject = { at: 1 + r.int(120), op: userOp(d) };
    } else if (kind === 'drive') op = { t: 'drive', k: r.weighted([['outsideDocx', 3], ['outsidePdf', 1.5], ['trashDoc', 3], ['untrashDoc', 1.5], ['removeDoc', 0.7], ['trashData', 0.6], ['trashBackups', 0.4], ['trashRoot', 0.4], ['untrashFolder', 1]]), pick: r(), s: r.int(2 ** 31) };
    else if (kind === 'sync') op = { t: 'sync', d, on: r.chance(0.55), s: r.int(2 ** 31) };
    else if (kind === 'account') op = { t: 'account', d, to: r.weighted([['B', 3], ['A', 3], [null, 1]]), s: r.int(2 ** 31) };
    else if (kind === 'net') op = { t: 'net', d, offline: r.chance(0.5), s: r.int(2 ** 31) };
    else if (kind === 'faults') op = { t: 'faults', d, p: r.pick([0, 0, 0.05, 0.15, 0.3]), quota: r.chance(0.3), refuse: r.chance(0.3) ? 1 + r.int(3) : 0, ...(r.chance(0.15) && { cut: r.pick(['\\.docx$', '\\.glaze\\.json$', '\\.json$']) }) };
    else if (kind === 'lag') op = { t: 'lag', n: r.pick([0, 0, 1, 2, 3]) };
    else if (kind === 'time') op = { t: 'time', ms: r.chance(0.12) ? 864e5 + r.int(36e5) : 60e3 * (1 + r.int(90)) };
    else op = { t: 'restart', d };
    // A run these start (a full one turning Sync on or signing in) may be cut short too.
    if (['sync', 'account', 'net'].includes(op.t) && r.chance(0.2)) Object.assign(op, { kill: 1 + r.int(300), apply: r.chance(0.5) });
    out.push(op);
  }
  return out;
};
const describe = (op) => {
  const d = op.d === undefined ? '' : `${'ABC'[op.d]} `;
  if (op.t === 'run') return `${d}run.${op.how}${op.kill || op.upload ? ` kill@${op.upload ? `${op.upload.method}:${op.upload.glaze}` : op.kill}${op.apply ? '+applied' : ''}` : ''}${op.after ? ` killed right after writing "${op.after}"` : ''}${op.inject ? ` inject@${op.inject.at}(${describe({ ...op.inject.op, d: undefined })})` : ''}`;
  if (USER.includes(op.t)) return `${d}${op.t}.${op.k} pick=${op.pick.toFixed(2)}`;
  if (op.t === 'drive') return `drive.${op.k} pick=${op.pick.toFixed(2)}`;
  const kill = op.kill ? ` kill@${op.kill}${op.apply ? '+applied' : ''}` : '';
  if (op.t === 'sync') return `${d}sync.${op.on ? 'on' : 'off'}${kill}`;
  if (op.t === 'account') return `${d}account→${op.to || 'signed out'}${kill}`;
  if (op.t === 'net') return `${d}${op.offline ? 'offline' : 'online'}${kill}`;
  if (op.t === 'faults') return `${d}faults p=${op.p}${op.quota ? ' +quota' : ''}${op.refuse ? ` +sync-refuse×${op.refuse}` : ''}${op.cut ? ` +offline after an upload of /${op.cut}/` : ''}`;
  if (op.t === 'lag') return `search lag ${op.n}`;
  if (op.t === 'time') return `time +${Math.round(op.ms / 60e3)} min`;
  return `${d}${op.t}`;
};

// Known defects, each with what it needs, so a run can leave those operations out (masks) and look for others meanwhile.
// drive-chaos-findings.md (glaze-plans/release-4.0.1) has each one's repro and diagnosis.
// repro: the fewest operations that show it (two devices unless devices says, all signed in at the start). fixed: a regression test now; its
// operations are no longer masked.
const KNOWN = {
  'null-setting': {
    fixed: true,
    about: 'a Settings value of null (preset, once the palette is the student\'s own) goes back and forth between devices forever',
    skips: (op) => op.t === 'setting' && op.k === 'preset',
    repro: [{ t: 'setting', d: 1, k: 'preset', v: null, pick: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'run', d: 0, how: 'run', s: 3 }],
  },
  'trashed-data': {
    fixed: true,
    about: 'records that don\'t change after Glaze/Data goes into Drive\'s trash are never put in the new Data: other devices never get them',
    skips: (op) => op.t === 'drive' && op.k === 'trashData',
    repro: [{ t: 'setting', d: 0, k: 'footer', v: false, pick: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'drive', k: 'trashData', pick: 0, s: 3 }, { t: 'run', d: 0, how: 'run', s: 4 }],
  },
  'orphan-overwrite': {
    fixed: true,
    about: 'a .docx whose first push stopped before its JSON copy, then edited outside Glaze, is overwritten by the next push',
    skips: () => false, // outsideDocx picks only files with their JSON copy while masked
    // The same adoption after a first meeting that found the JSON copy in Drive's trash and the file put back.
    ignore: (f, w) => f.inv === 'no-loss:outside-edit' && w.met,
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'faults', d: 0, p: 0, cut: '\\.docx$' }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'drive', k: 'outsideDocx', pick: 0, s: 3 }],
  },
  'off-edits': {
    fixed: true,
    about: 'a document saved while Sync was off never goes up when the full run turning Sync on doesn\'t finish (offline, Drive busy, the worker stopping)',
    skips: () => false, // turning Sync on runs with no faults, online and uncut while masked
    // And a document saved while its device had Sync off may differ (the full run can stop for the Glaze folder in the trash too).
    ignore: (f, w) => ['convergence:docs', 'drive-state'].includes(f.inv) && [...w.offEdited].some((k) => f.msg.includes(k)),
    repro: [{ t: 'sync', d: 0, on: false, s: 1 }, { t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 2 }, { t: 'net', d: 0, offline: true, s: 3 }, { t: 'sync', d: 0, on: true, s: 4 }],
  },
  'stray-file': {
    fixed: true,
    about: 'a .docx edited outside Glaze, kept by one device that writes a new file, is kept again by another device editing the document: the first new file stays in Glaze/ as a second copy',
    skips: () => false,
    ignore: (f) => f.inv === 'drive-state' && /visible files for one document/.test(f.msg),
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'drive', k: 'outsideDocx', pick: 0, s: 3 }, { t: 'run', d: 0, how: 'run', s: 4 }, { t: 'paper', k: 'edit', d: 0, pick: 0, pick2: 0, s: 5 }, { t: 'run', d: 1, how: 'run', s: 6 }],
  },
  'missed-file-trash': {
    fixed: true,
    about: 'a document\'s own file put in Drive\'s trash is never seen by a full pass (Sync turned on, off before or already on): it reads only the JSON copies, so the document stays live with its file in the trash; a PDF so is passed over as unreadable by every other device',
    skips: () => false, // trashDoc leaves a document's own file alone while masked
    repro: [{ t: 'pdf', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'sync', d: 1, on: false, s: 3 }, { t: 'drive', k: 'trashDoc', pick: 0, s: 4 }],
  },
  'file-trash-skip': {
    fixed: true,
    about: 'a PDF or deck met while its JSON copy is out of Drive\'s trash and its file still in it (restored one before the other) is passed over for good: the file coming back later brings it to no device that hadn\'t it',
    skips: () => false, // untrashDoc restores a JSON copy only once its document's file is out of the trash, while masked
    repro: [{ t: 'slides', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'drive', k: 'trashDoc', pick: 0.99, s: 3 }, { t: 'run', d: 1, how: 'run', s: 4 }, { t: 'drive', k: 'untrashDoc', pick: 0.99, s: 5 }, { t: 'run', d: 0, how: 'run', s: 6 }],
  },
  'drive-copy-stop': {
    fixed: true,
    about: 'a worker stopped right after saving a conflict\'s "(Drive copy)" (a PDF\'s, or one too big for a version), before marking it, leaves that copy on its device only, and the next run makes a second one',
    skips: () => false,
    ignore: (f, w) => (f.inv === 'convergence:docs' || f.inv === 'drive-state') && w.devices.some((d) => Object.values(w.view(d).docs).some((v) => v.includes('(Drive copy)') && f.msg.includes(JSON.parse(v).key))),
    repro: [{ t: 'pdf', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'pdf', k: 'edit', d: 0, pick: 0, pick2: 0, s: 4 },
      { t: 'pdf', k: 'edit', d: 1, pick: 0, pick2: 0, s: 5 }, { t: 'run', d: 1, how: 'run', s: 6 }, { t: 'run', d: 0, how: 'run', s: 7, after: '(Drive copy)' }],
  },
  'file-push-echo': {
    fixed: true,
    about: 'a PDF or deck pushed again with its content unchanged (after a first meeting kept Drive\'s replacement aside) looks to the other device like a replacement made outside Glaze: each takes it and pushes again, uploading the whole file twice a run, forever',
    skips: (op) => op.t === 'drive' && op.k === 'outsidePdf',
    repro: [{ t: 'slides', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3, after: 'writerPaper:' }, { t: 'drive', k: 'outsidePdf', pick: 0, s: 4 }, { t: 'sync', d: 0, on: false, s: 5 }],
  },
  'lagged-full': {
    fixed: true,
    about: 'a full pass (a device joining, or Sync turned on) while Drive\'s search lags misses a document made just before: its token is taken first, so the document\'s change never comes either, and the device never gets it',
    skips: (op) => op.t === 'lag',
    join: [0],
    repro: [{ t: 'lag', n: 3 }, { t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'account', d: 1, to: 'A', s: 3 }],
  },
  'join-stamp': {
    fixed: true,
    about: 'a first meeting\'s joined record goes up stamped with the time of the meeting, not of the latest change it holds, so it beats a later change another device hadn\'t pushed yet: a note\'s newer text lost to a rename, a task lost when a second device connects',
    skips: () => false,
    ignore: (f, w) => ['no-loss:note', 'lww:settings'].includes(f.inv) && w.met,
    repro: [{ t: 'note', k: 'new', d: 0, pick: 0, pick2: 0.9, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'account', d: 0, to: 'B', s: 4 }, { t: 'note', k: 'rename', d: 0, pick: 0, pick2: 0, s: 5 }, { t: 'note', k: 'edit', d: 1, pick: 0, pick2: 0, s: 6 }],
  },
  'first-meeting-trash': {
    fixed: true,
    about: 'on a first meeting (an account switched back, a restored device), a document in Trash on one side is never met: one in Drive\'s trash goes up again as new (and other devices, picking the lower id of two copies even in the trash, never get it), one in Trash here stays live in Drive',
    skips: () => false,
    // Masked: a document in Trash on some device, or whose JSON copy is in Drive's trash, may differ.
    ignore: (f, w) => f.inv === 'convergence:docs' && (() => {
      const k = /^(doc:[0-9a-f-]+):/.exec(f.msg)?.[1], h = k && sha(k).slice(0, 32);
      return !!k && (w.devices.some((d) => w.view(d).trashed[k]) || [...w.drive.files.values()].some((x) => x.meta.appProperties?.glaze === 'doc' && x.meta.appProperties.key === h && w.drive.view(x.meta.id).trashed));
    })(),
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'account', d: 1, to: 'B', s: 4 }, { t: 'paper', k: 'trash', d: 1, pick: 0, pick2: 0, s: 5 }],
  },
  'carried-time': {
    fixed: true,
    about: 'a record file put in Drive\'s trash with Glaze/Data, another device\'s met in the new Data as a first meeting with no time of this device\'s own (its change sent and settled): an earlier Settings change from the other device wins over a later one',
    skips: () => false,
    repro: [{ t: 'setting', d: 0, k: 'footer', v: false, pick: 0, s: 1 }, { t: 'setting', d: 1, k: 'footer', v: true, pick: 0, s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'run', d: 1, how: 'run', s: 4 }, { t: 'drive', k: 'trashData', pick: 0, s: 5 }],
  },
  'carried-time-stop': {
    fixed: true,
    about: 'carried-time with the worker stopped between letting its record go for the other device\'s file and its own push landing: the time it held was in memory only, so the next run met the record with none, and the earlier change won',
    skips: () => false,
    stops: 'local.get',
    repro: [{ t: 'setting', d: 0, k: 'footer', v: false, pick: 0, s: 1 }, { t: 'setting', d: 1, k: 'footer', v: true, pick: 0, s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'run', d: 1, how: 'run', s: 4 },
      { t: 'drive', k: 'trashData', pick: 0, s: 5 }, { t: 'run', d: 0, how: 'run', s: 6 }, { t: 'run', d: 1, how: 'run', s: 7, kill: 120, apply: false }],
  },
  'lost-answer-outside': {
    fixed: true,
    about: 'a .docx update Drive took whose answer never came (the worker stopped at it), then the file edited outside Glaze: the next push overwrites it, the record still naming the revision before Glaze\'s own',
    skips: () => false,
    stops: 'net.PATCH', // where its kill must land (an upload), or the repro shows nothing
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'paper', k: 'edit', d: 1, pick: 0, pick2: 0, s: 3 }, { t: 'run', d: 1, how: 'run', s: 4, upload: { method: 'PATCH', glaze: 'file' }, apply: true }, { t: 'drive', k: 'outsideDocx', pick: 0, s: 5 }],
  },
  'kept-relink': {
    fixed: true,
    about: 'a JSON copy\'s update Drive took whose answer never came, then the .docx edited outside Glaze: the next run lets the file go as kept, then links the paper to it again as both sides agreeing, so the paper has no file of its own in Glaze/',
    skips: () => false,
    stops: 'net.PATCH',
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'paper', k: 'edit', d: 1, pick: 0, pick2: 0, s: 3 }, { t: 'run', d: 1, how: 'run', s: 4, upload: { method: 'PATCH', glaze: 'doc' }, apply: true }, { t: 'drive', k: 'outsideDocx', pick: 0, s: 5 }],
  },
  'restored-folder': {
    fixed: true,
    about: 'a device connecting while the Glaze folder is in Drive\'s trash makes a Glaze of its own; once the student restores the old one, that device follows it, but the documents already in it (from before its page token) never reach it',
    skips: () => false,
    join: [0],
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'drive', k: 'trashRoot', pick: 0, s: 3 }, { t: 'account', d: 1, to: 'A', s: 4 }, { t: 'run', d: 1, how: 'startup', s: 5 }],
  },
  'revive-removed': {
    fixed: true,
    about: 'a document in Trash here whose JSON copy was then deleted for good in Drive, sent up again live by another device (restored wins): this device lets its link go and keeps the document in Trash',
    skips: () => false,
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'startup', s: 2 }, { t: 'account', d: 0, to: 'B', s: 3 }, { t: 'run', d: 1, how: 'poke', s: 4 }, { t: 'drive', k: 'trashDoc', pick: 0, s: 5 }, { t: 'run', d: 1, how: 'poke', s: 6 }, { t: 'drive', k: 'removeDoc', pick: 0.9, s: 7 }],
  },
  'unlinked-copy': {
    fixed: true,
    about: 'a first push whose JSON copy Drive took but whose answer never came: the next run hears of that copy in Drive\'s changes but passes over it as another device\'s (none linked here yet), and while Drive\'s search lags makes a second one: two copies stay, and a device linked to the first never gets this one\'s later edits',
    skips: () => false,
    stops: 'net.POST',
    repro: [{ t: 'lag', n: 3 }, { t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2, upload: { method: 'POST', glaze: 'doc' }, apply: true }, { t: 'run', d: 0, how: 'run', s: 3 }],
  },
  'stale-sum': {
    fixed: true,
    about: 'a record read by a change page fetched before this device\'s own write to it (Glaze/Data replaced midway, every record met again) takes its sum from that page and its value from the file as it is now: the record is noted as agreeing with a sum it doesn\'t hold, and another device\'s next change to that sum never reaches it',
    skips: () => false,
    devices: 3,
    repro: [{ t: 'words', k: 'add', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'poke', s: 2 }, { t: 'words', k: 'add', d: 1, pick: 0, pick2: 0, s: 3 }, { t: 'run', d: 1, how: 'timers', s: 4 },
      { t: 'sync', d: 2, on: true, s: 5 }, { t: 'drive', k: 'trashData', pick: 0, s: 6 }, { t: 'run', d: 2, how: 'poke', s: 7 }],
  },
  'relinked-copy': {
    fixed: true,
    about: 'a first push whose JSON copy Drive took but whose answer never came, the document then taken and edited on another device: the first device links the copy as its own push and, holding its own older text as a change not yet sent, writes it over the other device\'s edit, which no device keeps',
    skips: () => false,
    stops: 'net.POST',
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2, upload: { method: 'POST', glaze: 'doc' }, apply: true }, { t: 'run', d: 0, how: 'run', s: 3 }, { t: 'paper', k: 'edit', d: 0, pick: 0, pick2: 0, s: 4 }],
  },
  'meet-stop': {
    fixed: true,
    about: 'a deck met while its file was in Drive\'s trash (linked to wait for it) and met afresh once the file comes back, with the worker stopped midway: the link was let go first, so the file\'s change finds nothing to meet and the device never gets the deck',
    skips: () => false,
    stops: 'local.get',
    repro: [{ t: 'slides', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'drive', k: 'trashDoc', pick: 0, s: 3 }, { t: 'run', d: 0, how: 'startup', s: 4 },
      { t: 'drive', k: 'untrashDoc', pick: 0, s: 5 }, { t: 'run', d: 0, how: 'run', s: 6, kill: 62, apply: true }],
  },
  'stranded-records': {
    fixed: true,
    about: 'a second Data made while Drive\'s search didn\'t show the first yet, then merged into it before its record files showed: they stay in the merged folder, followed by the device that wrote them and listed by no other, which never gets them',
    skips: () => false,
    repro: [{ t: 'faults', d: 1, p: 0.3, quota: false, refuse: 2 }, { t: 'run', d: 1, how: 'poke', s: 1059538193 }, { t: 'sheet', k: 'new', d: 1, pick: 0.4254337348975241, pick2: 0.710770957171917, s: 1655149833 }, { t: 'drive', k: 'trashData', pick: 0.695207278477028, s: 206590386 }, { t: 'paper', k: 'new', d: 1, pick: 0.7763760664965957, pick2: 0.5383014006074518, s: 263146629 }, { t: 'note', k: 'new', d: 1, pick: 0.8037255362141877, pick2: 0.8429688038304448, s: 472602691 }, { t: 'lag', n: 2 }, { t: 'run', d: 1, how: 'timers', s: 1477004821 }, { t: 'run', d: 1, how: 'poke', s: 1295093123 }],
  },
  'stale-stamp': {
    fixed: true,
    about: 'a Settings change made while a run read that key (after its time, before its value) was weighed with no time against Drive\'s earlier change, which was written over it, its stamp set to Drive\'s time',
    skips: () => false,
    repro: [{ t: 'setting', k: 'colors', d: 1, pick: 0.58, pick2: 0.28, s: 525175327 }, { t: 'run', d: 1, how: 'run', s: 1121166915 },
      { t: 'run', d: 0, how: 'poke', s: 867526412, inject: { at: 74, op: { t: 'setting', k: 'colors', d: 0, pick: 0.29, pick2: 0.5, s: 42 } } }],
  },
  'purge-revived': {
    fixed: true,
    about: 'a note deleted for good here (its time stamped) after Glaze/Data went into Drive\'s trash: met with another device\'s copy in the new Data as one this device never had, it comes back with older text',
    skips: () => false,
    repro: [{ t: 'note', k: 'new', d: 1, pick: 0, pick2: 0.9, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'run', d: 0, how: 'poke', s: 3 }, { t: 'drive', k: 'trashData', pick: 0, s: 4 },
      { t: 'note', k: 'edit', d: 1, pick: 0, pick2: 0, s: 5 }, { t: 'note', k: 'trash', d: 1, pick: 0, pick2: 0, s: 6 }, { t: 'note', k: 'purge', d: 1, pick: 0, pick2: 0, s: 7 }],
  },
  'resent-unheld': {
    fixed: true,
    about: 'a document this device never took (linked to wait for its file in Drive\'s trash) whose copy is deleted for good while another device sends it up again: the page names the deletion and the new copy together, the deletion is kept, and this device never gets the document',
    skips: () => false,
    devices: 3,
    repro: [{ t: 'slides', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'run', d: 2, how: 'run', s: 3 }, { t: 'drive', k: 'trashDoc', pick: 0, s: 4 },
      { t: 'run', d: 0, how: 'poke', s: 5 }, { t: 'run', d: 2, how: 'poke', s: 6 }, { t: 'account', d: 1, to: 'B', s: 7 }, { t: 'drive', k: 'removeDoc', pick: 0.9, s: 8 }],
  },
  'data-twice': {
    fixed: true,
    devices: 3,
    about: 'Glaze/Data put in Drive\'s trash, a run stopped midway, the new Data trashed and one put back: a Settings key ends different on one device',
    skips: (op) => op.t === 'drive' && op.k === 'untrashFolder',
    repro: [{ t: 'drive', k: 'trashData', pick: 0.19117888156324625, s: 1156524178 }, { t: 'setting', k: 'colors', d: 0, pick: 0.7500670645385981, pick2: 0.9671588835772127, s: 1895708292 }, { t: 'note', k: 'picture', d: 0, pick: 0.23482694174163043, pick2: 0.8804167488124222, s: 2044173913 }, { t: 'run', d: 0, how: 'run', s: 979028695, kill: 158, apply: false }, { t: 'drive', k: 'trashData', pick: 0.839100303594023, s: 61643479 }, { t: 'drive', k: 'untrashFolder', pick: 0.10747946565970778, s: 65859196 }],
  },
  'lost-copy-stop': {
    fixed: true,
    devices: 3,
    about: 'a device stopped while first taking a PDF, whose file then goes to Drive\'s trash and its JSON copy is deleted for good: that device keeps the PDF live with no copy or file of its own in Drive',
    skips: (op) => op.t === 'drive' && op.k === 'removeDoc',
    repro: [{ t: 'pdf', k: 'edit', d: 1, pick: 0.5500041127670556, pick2: 0.1512873312458396, s: 689046160 }, { t: 'run', d: 1, how: 'run', s: 1175053074 }, { t: 'run', d: 0, how: 'startup', s: 1211240399, after: 'writerPaper:' }, { t: 'drive', k: 'trashDoc', pick: 0.376654107356444, s: 1524059004 }, { t: 'run', d: 1, how: 'poke', s: 1289774999 }, { t: 'drive', k: 'removeDoc', pick: 0.8576193870976567, s: 1086094031 }],
  },
  'take-stop-purge': {
    fixed: true,
    about: 'a worker stopped between taking a note and noting it as synced, the note then edited, trashed and deleted for good there before a run sent anything: met with Drive\'s copy as one never held here, it comes back',
    skips: () => false,
    stops: 'local.get',
    repro: [{ t: 'note', k: 'new', d: 1, pick: 0, pick2: 0.9, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'run', d: 0, how: 'run', s: 3, kill: 82, apply: false }, { t: 'note', k: 'edit', d: 0, pick: 0, pick2: 0, s: 4 },
      { t: 'note', k: 'trash', d: 0, pick: 0, pick2: 0, s: 5 }, { t: 'note', k: 'purge', d: 0, pick: 0, pick2: 0, s: 6 }],
  },
  'orphan-restored': {
    fixed: true,
    about: 'a first push whose file upload Drive took but whose answer never came, that orphan then put in Drive\'s trash: the next push writes a second file, and the student restoring the first leaves two visible files for the document',
    skips: () => false,
    stops: 'net.POST',
    repro: [{ t: 'slides', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2, upload: { method: 'POST', glaze: 'file' }, apply: true }, { t: 'drive', k: 'trashDoc', pick: 0, s: 3 }, { t: 'run', d: 0, how: 'run', s: 4 },
      { t: 'drive', k: 'untrashDoc', pick: 0, s: 5 }],
  },
  'lag-duplicate': {
    fixed: true,
    about: 'a first push whose file upload Drive took but whose answer never came, while Drive\'s search doesn\'t show it yet: the next push writes a second file, and both stay visible',
    skips: () => false,
    stops: 'net.POST',
    repro: [{ t: 'lag', n: 6 }, { t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2, upload: { method: 'POST', glaze: 'file' }, apply: true }, { t: 'run', d: 0, how: 'run', s: 3 }],
  },
  'old-file-restored': {
    fixed: true,
    about: 'a document\'s old file restored from Drive\'s trash by the student after the document got a new one (its JSON copy deleted for good meanwhile): two visible files for it',
    skips: () => false,
    devices: 3,
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0.07755651348270476, pick2: 0.061293802224099636, s: 1566503089 }, { t: 'run', d: 1, how: 'poke', s: 108594567 }, { t: 'paper', k: 'trash', d: 1, pick: 0.6084586172364652, pick2: 0.08099821559153497, s: 197002345 }, { t: 'run', d: 1, how: 'poke', s: 1861582629 }, { t: 'drive', k: 'removeDoc', pick: 0.7160781854763627, s: 238334440 }, { t: 'sync', d: 1, on: true, s: 1281916806 }, { t: 'run', d: 1, how: 'timers', s: 1768177510, inject: { at: 41, op: { t: 'paper', k: 'untrash', d: 1, pick: 0.9296708647161722, pick2: 0.22527607856318355, s: 227905390 } } }, { t: 'run', d: 1, how: 'timers', s: 1917384663 }, { t: 'sheet', k: 'edit', d: 2, pick: 0.8254707367159426, pick2: 0.9578920800704509, s: 593990753 }, { t: 'drive', k: 'untrashDoc', pick: 0.30130292498506606, s: 1568503414 }, { t: 'paper', k: 'edit', d: 2, pick: 0.533804090693593, pick2: 0.335794823942706, s: 535149113 }],
  },
  'kept-first-meeting': {
    fixed: true,
    about: 'a device back on its account after another meets a paper whose JSON copy still names the file let go as edited outside Glaze (its new file never went up before the switch): it links that file as the paper\'s, and no device writes the paper a file of its own',
    skips: () => false,
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0.12736053694970906, pick2: 0.026920746779069304, s: 868051097 }, { t: 'paper', k: 'new', d: 1, pick: 0.10011307010427117, pick2: 0.18896764400415123, s: 700670706 }, { t: 'run', d: 1, how: 'startup', s: 2131732419 }, { t: 'faults', d: 1, p: 0.15, quota: false, refuse: 3 }, { t: 'run', d: 1, how: 'poke', s: 538016774 }, { t: 'drive', k: 'trashDoc', pick: 0.4520150083117187, s: 1306075949 }, { t: 'drive', k: 'outsideDocx', pick: 0.9514843598008156, s: 1542684737 }, { t: 'run', d: 1, how: 'poke', s: 60911011, after: 'notesIdx:' }, { t: 'account', d: 1, to: 'B', s: 1972720148 }],
  },
  'kept-first-meeting-3': {
    fixed: true,
    devices: 3,
    about: 'kept-first-meeting, the device that let the file go switching accounts right after',
    skips: () => false,
    repro: [{ t: 'paper', k: 'new', d: 2, pick: 0.6620774620678276, pick2: 0.5868986349087209, s: 400112753 }, { t: 'sync', d: 2, on: true, s: 1985057254 }, { t: 'drive', k: 'outsideDocx', pick: 0.9624791145324707, s: 621458078 }, { t: 'faults', d: 2, p: 0.3, quota: false, refuse: 3 }, { t: 'run', d: 2, how: 'run', s: 2090746289 }, { t: 'account', d: 2, to: 'B', s: 1047616833 }],
  },
  'staged-first-meeting': {
    fixed: true,
    tiny: true,
    staged: true,
    join: [0],
    about: 'a device joining meets a PDF replaced outside Glaze and sends it up again; its JSON copy staged (larger than one request), the document\'s link waits without its key, so the next change page meets it as deleted for good here and puts both of its files in Drive\'s trash: every other device moves it to Trash',
    skips: () => false,
    repro: [{ t: 'pdf', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'drive', k: 'outsidePdf', pick: 0, s: 3 }],
  },
  'copy-stop': {
    fixed: true,
    join: [0],
    about: 'a document restored from Trash whose file was deleted for good in Drive gets a new file, the worker stopping before its JSON copy names it: the link records the new file and both sides read as agreed, so the copy keeps naming the deleted file and no other device ever gets the document (seed 9700878, 2026-10-31)',
    skips: () => false,
    stops: 'local.get',
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0.7293021462392062, pick2: 0.13267629174515605, s: 1511422056 }, { t: 'run', d: 0, how: 'startup', s: 1904310916, after: 'notesIdx:' }, { t: 'paper', k: 'trash', d: 0, pick: 0.391776867210865, pick2: 0.8033320291433483, s: 685288494 }, { t: 'faults', d: 0, p: 0.15, quota: false, refuse: 0 }, { t: 'run', d: 0, how: 'poke', s: 698363760 }, { t: 'paper', k: 'untrash', d: 0, pick: 0.9719573664478958, pick2: 0.019606253132224083, s: 1783675233 }, { t: 'drive', k: 'removeDoc', pick: 0.3167869916651398, s: 100762301 }, { t: 'run', d: 0, how: 'timers', s: 1428463383, kill: 120, apply: false }],
  },
  // Found 2026-10-31 by tiny transfers: a worker stopped at certain awaits of a staged first push (570, 644, 842 here, the
  // write not applied) left a second visible file or JSON copy for the document. Passing at 80be1668.
  'staged-kill-duplicate': {
    fixed: true,
    tiny: true,
    staged: true,
    about: 'a worker stopped at certain awaits of a first push whose uploads are staged leaves two visible files or JSON copies for one document',
    skips: () => false,
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'pdf', k: 'new', d: 0, pick: 0, pick2: 0, s: 2 }, { t: 'setting', d: 0, k: 'colors', pick: 0, s: 3 },
      { t: 'note', k: 'new', d: 0, pick: 0, pick2: 0.9, s: 4 }, { t: 'run', d: 0, how: 'run', s: 5, kill: 842, apply: false }],
  },
  // Found 2026-10-31 by tiny staged transfers (--tiny --staged, 12-35% of seeds failing at 80be1668).
  'staged-answer-dropped': {
    fixed: true,
    tiny: true,
    staged: true,
    join: [0],
    about: 'a staged upload\'s answer is let go by the run\'s last step once its owner is met again, even when that meeting stopped short of taking it (it waited on a staged read of its own copy first): the push sends its JSON copy again on every run, forever',
    skips: () => false,
    repro: [{ t: 'pdf', k: 'new', d: 0, pick: 0.4765420525800437, pick2: 0.22473423089832067, s: 1177548668 }, { t: 'run', d: 0, how: 'timers', s: 162333005 }, { t: 'account', d: 0, to: 'B', s: 998766516 },
      { t: 'drive', k: 'outsidePdf', pick: 0.8306811631191522, s: 655337973 }],
  },
  'staged-trash-read': {
    fixed: true,
    tiny: true,
    staged: true,
    join: [0],
    about: 'a staged download of a file in Drive\'s trash is refused as gone, and its owner asks for it again, forever: a paper restored here after an account switch, whose files are in Drive\'s trash, never reaches Drive or the other device',
    skips: () => false,
    repro: [{ t: 'paper', k: 'edit', d: 0, pick: 0.08711082465015352, pick2: 0.49240474589169025, s: 536242987 }, { t: 'run', d: 0, how: 'poke', s: 1470665041 }, { t: 'paper', k: 'trash', d: 0, pick: 0.6449802806600928, pick2: 0.004706502892076969, s: 113667981 },
      { t: 'sync', d: 0, on: true, s: 1838228239 }, { t: 'account', d: 0, to: 'B', s: 863251049 }, { t: 'paper', k: 'untrash', d: 0, pick: 0.15078959637321532, pick2: 0.32049439242109656, s: 1160143866 }],
  },
  'staged-stale-aim': {
    fixed: true,
    tiny: true,
    staged: true,
    about: 'a push right after taking Drive\'s copy of a paper (renamed on the other device, its .docx edited outside Glaze) aims its staged copy update at the copy\'s revision from before the take: the check before sending finds the copy changed and hands it back, every run, each making a new .docx',
    skips: () => false,
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0.15518367243930697, pick2: 0.3982179658487439, s: 455069467 }, { t: 'run', d: 0, how: 'poke', s: 1952709425 }, { t: 'run', d: 1, how: 'poke', s: 1056797692 },
      { t: 'paper', k: 'rename', d: 1, pick: 0.13557938113808632, pick2: 0.5521365036256611, s: 300925911 }, { t: 'run', d: 1, how: 'poke', s: 291668029 }, { t: 'drive', k: 'outsideDocx', pick: 0.19172523193992674, s: 1934268126 }],
  },
  'staged-record-old-data': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    about: 'a note\'s staged record upload whose answer was lost, Glaze/Data then put in Drive\'s trash: the answer, taken after the pass over the new Data, links the note to its file in the old one, and no other device ever gets the note',
    skips: () => false,
    repro: [{ t: 'note', k: 'edit', d: 1, pick: 0.6947389694396406, pick2: 0.6899177110753953, s: 1137668474 }, { t: 'faults', d: 1, p: 0, quota: false, refuse: 0, cut: '\\.json$' },
      { t: 'run', d: 1, how: 'timers', s: 1926511635 }, { t: 'drive', k: 'trashData', pick: 0.8542803057935089, s: 1654949931 }],
  },
  'staged-outside-loop': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    about: 'a paper\'s staged update whose answer was lost, its .docx then edited outside Glaze: every run makes the paper a new .docx and puts it away, never settling, and the devices\' change tokens stay behind',
    skips: () => false,
    repro: [{ t: 'faults', d: 1, p: 0, quota: false, refuse: 0, cut: '\\.json$' }, { t: 'paper', k: 'edit', d: 1, pick: 0.5097121719736606, pick2: 0.8484496630262583, s: 1698042739 },
      { t: 'run', d: 1, how: 'poke', s: 1184312654, inject: { at: 76, op: { t: 'note', k: 'new', d: 1, pick: 0.8628405916970223, pick2: 0.5734472328331321, s: 1302672762 } } }, { t: 'drive', k: 'outsideDocx', pick: 0.6395302484743297, s: 1862399872 }],
  },
  'staged-record-aim': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    join: [0, 1],
    about: 'a record changed on both devices, this one\'s change the later: its staged upload aims at the file as this device last agreed with it, not as it just read it, so the check before sending finds the other device\'s write and hands it back, every run: the tasks never converge',
    skips: () => false,
    repro: [{ t: 'task', k: 'edit', d: 1, pick: 0.6904091816395521, pick2: 0.6403046664781868, s: 1331773195 }, { t: 'run', d: 1, how: 'poke', s: 1993730222 }, { t: 'task', k: 'edit', d: 0, pick: 0.6321026624646038, pick2: 0.7485288269817829, s: 589884008 },
      { t: 'task', k: 'edit', d: 1, pick: 0.9250958673655987, pick2: 0.4066777254920453, s: 697697893 }, { t: 'run', d: 0, how: 'poke', s: 794821635 }, { t: 'run', d: 1, how: 'timers', s: 27493958 }, { t: 'task', k: 'edit', d: 0, pick: 0.3805331971962005, pick2: 0.768940842943266, s: 311413170 }],
  },
  'staged-merge-aim': {
    fixed: true,
    tiny: true,
    staged: true,
    about: 'a note edited on both devices, merged field by field: the merge\'s staged upload aims at the note\'s file as last agreed, not as just read, and is handed back every run: the later text never reaches the other device',
    skips: () => false,
    repro: [{ t: 'note', k: 'new', d: 1, pick: 0.9103820566087961, pick2: 0.9270836934447289, s: 127026828 }, { t: 'run', d: 1, how: 'poke', s: 1094398469 }, { t: 'run', d: 0, how: 'run', s: 527955377 },
      { t: 'note', k: 'edit', d: 0, pick: 0.1447097782511264, pick2: 0.3049026830121875, s: 1061760165 }, { t: 'note', k: 'edit', d: 1, pick: 0.5914163226261735, pick2: 0.20524716330692172, s: 1544024214 }],
  },
  'staged-slot-lower': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 4,
    join: [0, 1, 2],
    about: 'two devices\' first uploads of one record overlapping: a third device met the lower id first, its staged read then replaced by the higher id\'s, and stays on the file no other device keeps',
    skips: () => false,
    repro: [{ t: 'faults', d: 1, p: 0.3, quota: false, refuse: 0 }, { t: 'pet', k: 'timer', d: 1, pick: 0.34044871130026877, pick2: 0.6097072591073811, s: 1036890564 },
      { t: 'pet', k: 'habitat', d: 0, pick: 0.8076418626587838, pick2: 0.8519927123561502, s: 1023511117 }, { t: 'run', d: 1, how: 'poke', s: 768704070 }],
  },
  'staged-held-file': {
    fixed: true,
    tiny: true,
    staged: true,
    join: [0],
    about: 'a document\'s file already holding this device\'s content (its upload landed, its copy never sent before an account switch): the next push aims a new staged upload at the revision before it, which the check before sending refuses, every run: the copy never follows',
    skips: () => false,
    repro: [{ t: 'paper', k: 'edit', d: 0, pick: 0.08711082465015352, pick2: 0.49240474589169025, s: 536242987 }, { t: 'run', d: 0, how: 'poke', s: 1964915324 }, { t: 'paper', k: 'rename', d: 0, pick: 0.6548932138830423, pick2: 0.47761691943742335, s: 2115051321 },
      { t: 'paper', k: 'new', d: 0, pick: 0.48847157787531614, pick2: 0.13594817533157766, s: 284901788 }, { t: 'sheet', k: 'edit', d: 0, pick: 0.2808572859503329, pick2: 0.7145665257703513, s: 104306932 },
      { t: 'faults', d: 0, p: 0.05, quota: false, refuse: 2 }, { t: 'sync', d: 0, on: true, s: 1838228239 }, { t: 'account', d: 0, to: 'B', s: 863251049 }],
  },
  'staged-own-file-dropped': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    join: [0, 1],
    about: 'two devices each write a paper a new .docx after the old one was edited outside Glaze: the one whose copy goes second follows the other\'s file, and its own new file, its copy never sent, stays visible beside it in Glaze/ for good (found by the bar sweep, seed 9500065)',
    skips: () => false,
    repro: [{ t: 'paper', k: 'edit', d: 1, pick: 0.4102183519862592, pick2: 0.7268775182310492, s: 381382203 }, { t: 'run', d: 1, how: 'startup', s: 11655903 }, { t: 'paper', k: 'edit', d: 1, pick: 0.49151708907447755, pick2: 0.836380569729954, s: 262429425 },
      { t: 'faults', d: 0, p: 0.15, quota: false, refuse: 0 }, { t: 'run', d: 0, how: 'poke', s: 1885313995 }, { t: 'drive', k: 'outsideDocx', pick: 0.6393347012344748, s: 1120477327 }, { t: 'sync', d: 0, on: true, s: 327744370 }],
  },
  'staged-reasked-edit': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    join: [0, 1],
    about: 'a worker stopped right after writing a staged upload\'s answer, its .docx then edited outside Glaze: the next worker asks the finished session again, takes the edited revision as Glaze\'s own, and the next push overwrites the edit (found by the bar sweep, seed 9500455)',
    skips: () => false,
    repro: [{ t: 'paper', k: 'edit', d: 0, pick: 0.7370798222254962, pick2: 0.5469275573268533, s: 47084577 }, { t: 'run', d: 0, how: 'timers', s: 1942766170, after: 'driveSyncDoc:' },
      { t: 'drive', k: 'outsideDocx', pick: 0.605260512791574, s: 712871565 }, { t: 'paper', k: 'edit', d: 0, pick: 0.12561764963902533, pick2: 0.8504263516515493, s: 1788424472 }],
  },
  'staged-stale-parent': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    join: [0, 1],
    about: 'a record\'s staged first upload goes into the Glaze/Data it was staged for after that Data went to Drive\'s trash and was replaced: linked to its file there, no other device ever gets it (found by the bar sweep, seed 9500402)',
    skips: () => false,
    repro: [{ t: 'pdf', k: 'new', d: 0, pick: 0.5046410250943154, pick2: 0.5602296148426831, s: 1736712198 }, { t: 'setting', k: 'footer', d: 0, pick: 0.9339969209395349, pick2: 0.09851757227443159, s: 971247784 },
      { t: 'setting', k: 'preset', d: 0, pick: 0.45765523659065366, pick2: 0.38037433032877743, s: 1201517812 }, { t: 'gradescope', k: 'place', d: 0, pick: 0.35789258894510567, pick2: 0.14992592576891184, s: 593080703 },
      { t: 'faults', d: 0, p: 0.15, quota: false, refuse: 1 }, { t: 'run', d: 0, how: 'timers', s: 1157860440 }, { t: 'drive', k: 'trashData', pick: 0.8646272781770676, s: 592490877 },
      { t: 'note', k: 'edit', d: 0, pick: 0.5276434142142534, pick2: 0.32105529750697315, s: 1516532219 }, { t: 'run', d: 0, how: 'timers', s: 614898878, after: 'driveSyncDoc:' }, { t: 'run', d: 0, how: 'run', s: 1595333163 }],
  },
  'staged-take-stop': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    join: [0, 2],
    about: 'a worker stopped while taking another device\'s PDF from its staged read (after marking it, before saving it): the next run meets the mark with no copy to read, lets the read go unused, and the PDF never comes (found by the bar sweep, seeds 9500841, 9500973)',
    skips: () => false,
    repro: [{ t: 'pdf', k: 'edit', d: 2, pick: 0.6396182728931308, pick2: 0.7343572643585503, s: 1870759343 }, { t: 'run', d: 2, how: 'timers', s: 963650092 }, { t: 'run', d: 0, how: 'poke', s: 1893922477, after: 'driveSyncDirty' }],
  },
  'staged-replay-lost': {
    fixed: true,
    tiny: true,
    staged: true,
    devices: 3,
    join: [0, 1],
    about: 'two devices\' first uploads of Notes\' folders overlapping, one staged: its answer written, the meeting with the other device\'s lower id that waited on it fails (Drive busy), and with the transfer already let go no run ever meets that file: the folders never converge (found by the bar sweep, seed 9500913)',
    skips: () => false,
    repro: [{ t: 'sheet', k: 'new', d: 0, pick: 0.0005167394410818815, pick2: 0.944620011607185, s: 463542006 }, { t: 'run', d: 0, how: 'timers', s: 1732642908 }, { t: 'folder', k: 'rename', d: 0, pick: 0.08206198690459132, pick2: 0.4447550403419882, s: 7503228 }, { t: 'slides', k: 'edit', d: 0, pick: 0.14362404658459127, pick2: 0.7645050184801221, s: 612798184 }, { t: 'time', ms: 89614943 }, { t: 'setting', k: 'preset', d: 1, pick: 0.08503693481907248, pick2: 0.6097094353754073, s: 741330601 }, { t: 'folder', k: 'new', d: 1, pick: 0.20517836906947196, pick2: 0.6513672687578946, s: 1526126662 }, { t: 'paper', k: 'edit', d: 0, pick: 0.7705752935726196, pick2: 0.7185106063261628, s: 395626547 }, { t: 'faults', d: 0, p: 0.05, quota: false, refuse: 0 }, { t: 'run', d: 0, how: 'poke', s: 409358450 }, { t: 'run', d: 1, how: 'startup', s: 2028041668 }, { t: 'run', d: 0, how: 'poke', s: 1206227927 }],
  },
  'staged-create-race': {
    fixed: true,
    tiny: true,
    staged: true,
    about: 'a device\'s staged new file for a record sent after another device had already made one in Glaze/Data (both putting the record back after Data went to Drive\'s trash): two files for one record, each device on its own, never converging (found by the bar sweep, seeds 9600354, 9600370, 9600431)',
    skips: () => false,
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0.5534558244980872, pick2: 0.6365561860147864, s: 546893804 }, { t: 'task', k: 'edit', d: 1, pick: 0.36794293369166553, pick2: 0.542712225811556, s: 1931422005 }, { t: 'task', k: 'add', d: 0, pick: 0.5595889138057828, pick2: 0.6078463774174452, s: 1529591901 }, { t: 'faults', d: 1, p: 0.3, quota: false, refuse: 0 }, { t: 'run', d: 0, how: 'timers', s: 1384711997 }, { t: 'run', d: 1, how: 'timers', s: 575414169 }, { t: 'run', d: 1, how: 'startup', s: 948841068 }, { t: 'drive', k: 'trashData', pick: 0.288371964590624, s: 52449897 }],
  },
  // Records merged item by item (the owner's call, 2026-11-11), found by the record invariants on their first run.
  'record-lww': {
    fixed: true,
    about: 'a To Do list changed on two devices after it synced: the later device\'s list went up whole over the other\'s, and the other device\'s new task was gone from both',
    skips: (op) => ['task', 'class', 'gpa'].includes(op.t),
    repro: [{ t: 'task', k: 'add', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 },
      { t: 'task', k: 'add', d: 0, pick: 0, pick2: 0, s: 4 }, { t: 'task', k: 'add', d: 1, pick: 0, pick2: 0, s: 5 }],
  },
  'record-retold': {
    fixed: true,
    about: 'a To Do list changed and changed back on one device (a task added and deleted) after another device\'s change reached Drive: the change back went up over it as a later change, and the other device\'s new task was gone from both',
    skips: (op) => ['task', 'class', 'gpa'].includes(op.t) && op.k === 'del',
    repro: [{ t: 'task', k: 'add', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 },
      { t: 'task', k: 'add', d: 1, pick: 0, pick2: 0, s: 4 }, { t: 'run', d: 1, how: 'run', s: 5 },
      { t: 'task', k: 'add', d: 0, pick: 0, pick2: 0, s: 6 }, { t: 'task', k: 'del', d: 0, pick: 0.99, pick2: 0, s: 7 }],
  },
  // Open, accepted by the owner: Settings written straight to storage.sync between the worker's compare and its write (a few
  // milliseconds) are written over by Drive's value. Found 2026-10-31 (seed 300933, 80 operations, 3 devices).
  'settings-cas': {
    fixed: false,
    about: 'a Settings change landing between the worker\'s read of the key and its write of Drive\'s value (the compare-and-write race, milliseconds, accepted) is written over',
    skips: (op) => op.t === 'run' && op.inject?.op?.t === 'setting',
    repro: [{ t: 'setting', k: 'colors', d: 1, pick: 0.58, pick2: 0.28, s: 525175327 }, { t: 'run', d: 1, how: 'run', s: 1121166915 },
      { t: 'run', d: 0, how: 'poke', s: 867526412, inject: { at: 79, op: { t: 'setting', k: 'colors', d: 0, pick: 0.29, pick2: 0.5, s: 42 } } }],
  },
  'stale-restore': {
    fixed: true,
    about: 'a device back on its account after another (a first meeting) holds an older PDF whose file the student deleted for good in Drive: it sends its own bytes up as the restore, and the other device, holding the newer bytes in Trash, takes the older over them',
    skips: (op) => op.t === 'drive' && op.k === 'removeDoc',
    repro: [{ t: 'pdf', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'account', d: 1, to: 'B', s: 4 }, { t: 'pdf', k: 'edit', d: 0, pick: 0, pick2: 0, s: 5 },
      { t: 'run', d: 0, how: 'run', s: 6 }, { t: 'drive', k: 'trashDoc', pick: 0.99, s: 7 }, { t: 'run', d: 0, how: 'run', s: 8 }, { t: 'drive', k: 'removeDoc', pick: 0, s: 9 }],
  },
};

// ---- a run of one list of operations
class World {
  constructor(seed, ops, o = {}) {
    this.seed = seed; this.ops = ops; this.o = { devices: 2, rounds: 8, reads: 24, ...o };
    this.staged = typeof this.o.staged === 'boolean' ? this.o.staged : STAGED;
    this.clock = START; this.step = 0; this.errors = []; this.lines = []; this.rejections = []; this.soft = [];
    this.net = network(!!this.o.tiny);
    this.drive = this.net.drives[ACCOUNTS.A];
    this.devices = [...Array(this.o.devices)].map((_, i) => new Device(this, 'ABC'[i], i));
    // The model: each token a user edit wrote (where and over which), what a delete for good let go, outside edits.
    this.made = new Map(); // token → { parent, key, kind, dev, step }
    this.fresh = new Map(); // token → { key, kind } written by an operation, not yet seen on a disk
    this.pdfTok = new Map(); // a PDF's bytes' SHA-256 → its token
    this.released = new Set(); // tokens a delete for good on some device let go
    this.deleted = new Set(); // document keys deleted for good somewhere
    this.outside = new Map(); // Drive file id → its bytes, as an outside edit left them
    this.notes = new Map(); // note id → [{ step, dev, kind, text, rec }]
    this.settings = new Map(); // Settings key → the last change made to it { v (JSON), step, dev, before, ok }
    this.items = new Map(); // 'tasks:t5', 'classes:12', 'gpa:g7' → each change that landed [{ step, dev, kind, copy (a deletion's: the item as its device held it) }]
    this.bound = new Set(); // devices Sync has been bound to an account on (driveSync.account), ever
    this.met = false; // a first meeting happened (an account switched, a device joining late)
    this.offEdited = new Set(); // documents saved while their device had Sync off
    this.n = 0;
    for (const dev of this.devices) dev.observe = (name, c) => this.observe(dev, name, c);
  }
  trace(s) { this.lines.push(s); }
  // An operation that threw: the harness's own mistake fails the run; the worker refusing (a save racing sync) is noted.
  failed(dev, e) {
    if (e instanceof TypeError || e instanceof ReferenceError || e?.name === 'TypeError' || e?.name === 'ReferenceError') this.broken = `${dev.name}: ${e.stack || e}`;
    this.trace(`  ${dev.name} operation refused: ${e?.message || e}`);
  }
  token() { return `ZQ${++this.n}QZ`; }

  // A token's first landing on a disk: its parent is what it replaced there.
  observe(dev, name, c) {
    if (name !== 'local') return;
    // An item's change, once its write lands as it was made (another write to the key meanwhile is not it).
    const x = dev.intent;
    if (x && Object.hasOwn(c, x.key) && x.landed(ITEMS[x.kind].of(c[x.key].newValue, x.id))) {
      dev.intent = null;
      const list = this.items.get(`${x.kind}:${x.id}`) || [];
      list.push({ step: x.step, dev: dev.name, kind: x.op, copy: x.copy });
      this.items.set(`${x.kind}:${x.id}`, list);
    }
    for (const [k, ch] of Object.entries(c)) {
      if (!k.startsWith('writerPaper:') && !k.startsWith('writerSheet:')) continue;
      const tokensOf = (v) => {
        if (!v) return [];
        if (FILED.includes(v.kind)) { const t = this.pdfTok.get(v.file?.hash); return t ? [t] : []; }
        return tokensIn(JSON.stringify(k.startsWith('writerSheet:') ? v.rows : v.doc ?? ''));
      };
      for (const t of tokensOf(ch.newValue)) {
        if (!this.fresh.has(t)) continue;
        const f = this.fresh.get(t), old = tokensOf(ch.oldValue)[0] || null;
        this.fresh.delete(t);
        this.made.set(t, { parent: old !== t ? old : null, key: f.key, kind: f.kind, dev: dev.name, step: this.step });
      }
    }
  }

  // ---- reading a device's disk
  get(dev, k, area = 'local') { return json(dev.disk[area].get(k)); }
  papers(dev) { return (this.get(dev, P.KEYS.INDEX) || []).map((r) => ({ ...r, rec: this.get(dev, P.KEYS.PAPER + r.key) })).filter((r) => r.rec).sort((a, b) => (a.key < b.key ? -1 : 1)); }
  partsOf(dev, key, rec) { return Object.fromEntries(Object.keys(rec.parts || {}).map((n) => { const p = this.get(dev, `${P.KEYS.PART}${key}:${n}`) || {}; const { rev, ...rest } = p; return [n, rest]; })); }
  tokenOf(dev, rec) {
    if (!rec) return null;
    if (FILED.includes(rec.kind)) return this.pdfTok.get(rec.file?.hash) || null;
    if (rec.kind === 'sheet') return tokensIn(JSON.stringify(this.partsOf(dev, rec.key, rec)))[0] || null;
    return tokensIn(JSON.stringify(rec.doc || ''))[0] || null;
  }
  noteIdx(dev) { return N.clean(this.get(dev, NOTES)); }
  // Whether Sync has ever been bound to an account on dev (background.js stamps changes only from then on).
  connected(dev) { if (typeof this.get(dev, 'driveSync')?.account === 'string') this.bound.add(dev.name); return this.bound.has(dev.name); }
  noteHtml(dev, id) { const n = this.noteIdx(dev).notes[id]; if (!n) return undefined; const b = dev.disk.notesdb.get(`bodies\u0000${SITE}/${id}/${n.rev}`); return b ? b.html : n.rev > 0 ? null : ''; }

  // ---- what each operation does on its device (no waiting for the device to settle: an injected one runs inside a run)
  async perform(dev, op) {
    const r = rng(op.s || 1), api = dev.api, ctx = dev.ctx, step = this.step;
    const at = (list, f = op.pick) => (list.length ? list[Math.min(list.length - 1, Math.floor(f * list.length))] : null);
    const save = (key, patch, o = {}) => api.turn(() => api.papers().save(key, patch, o));
    const live = (kind) => this.papers(dev).filter((p) => (p.rec.kind || 'paper') === kind && !P.trashed(p.rec) && P.local(p.key));
    const note = (s) => this.trace(`#${step} ${dev.name} ${s}`);
    if (['paper', 'sheet', 'pdf', 'slides'].includes(op.t)) {
      const kind = op.t, list = live(kind), off = !(this.get(dev, 'driveSync') || {}).on;
      const newKey = () => `doc:${uuidOf(r)}`;
      // A PDF's or deck's bytes, each holding its token (the file store keeps them by hash).
      const fileBytes = (tok) => { const s = FILE_TEXT[kind](tok); this.pdfTok.set(sha(s), tok); return new ctx.TextEncoder().encode(s); };
      if (op.k === 'new' || (op.k === 'edit' && !list.length)) {
        const key = newKey(), tok = this.token(), title = `${kind[0].toUpperCase()}${this.n}`;
        this.fresh.set(tok, { key, kind });
        if (off) this.offEdited.add(key);
        note(`${kind}.new ${short(key)} ${tok}`);
        if (kind === 'paper') return save(key, { doc: docOf(tok), title, named: true });
        if (kind === 'sheet') {
          const wb = M.workbook(); wb.sheets[0].rows.set(0, new Map([[0, { v: tok }]]));
          const { book, parts } = SD.split(wb);
          return save(key, { kind: 'sheet', book, title, named: true, cells: 1 }, { parts: Object.fromEntries([...parts].map(([n, rows]) => [n, { rows }])) });
        }
        const ref = await api.files().put(fileBytes(tok), FILE_TYPE[kind]);
        return save(key, { kind, file: ref, size: ref.size, title, named: true, ...(kind === 'slides' && { ext: '.pptx' }) });
      }
      if (op.k === 'edit') {
        const p = at(list), tok = this.token();
        this.fresh.set(tok, { key: p.key, kind });
        if (off) this.offEdited.add(p.key);
        note(`${kind}.edit ${short(p.key)} ${this.tokenOf(dev, p.rec)}→${tok}`);
        if (kind === 'paper') return save(p.key, { doc: docOf(tok) }, { base: p.rec.revision });
        if (kind === 'sheet') {
          const parts = this.partsOf(dev, p.key, p.rec), wb = SD.join(p.rec.book, new Map(Object.entries(parts).map(([n, x]) => [n, x.rows])));
          wb.sheets[0].rows.set(0, new Map([[0, { v: tok }]]));
          const next = SD.split(wb), names = [...next.parts.keys()];
          return save(p.key, { kind: 'sheet', book: next.book, cells: 1 }, { parts: Object.fromEntries([...next.parts].map(([n, rows]) => [n, { rows }])), drop: Object.keys(parts).filter((n) => !names.includes(n)), base: p.rec.revision });
        }
        const ref = await api.files().put(fileBytes(tok), FILE_TYPE[kind]);
        return save(p.key, { file: ref, size: ref.size }, { reason: 'edit', base: p.rec.revision });
      }
      if (op.k === 'trash') { const p = at(list); if (!p) return; note(`${kind}.trash ${short(p.key)}`); return api.turn(() => api.papers().trash(p.key)); }
      const trashed = this.papers(dev).filter((p) => (p.rec.kind || 'paper') === kind && P.trashed(p.rec) && P.local(p.key));
      if (op.k === 'untrash') { const p = at(trashed); if (!p) return; note(`${kind}.untrash ${short(p.key)}`); return api.turn(() => api.papers().untrash(p.key)); }
      if (op.k === 'delete') {
        const p = at(trashed);
        if (!p) return;
        // Delete forever: what this device holds of it, and what that came from, is the student's to let go.
        const versions = this.get(dev, P.KEYS.VERSIONS + p.key) || [];
        for (const t of [this.tokenOf(dev, p.rec), ...tokensIn(JSON.stringify(versions))]) this.release(t);
        this.deleted.add(p.key);
        note(`${kind}.delete ${short(p.key)}`);
        return api.turn(() => api.papers().remove(p.key));
      }
      if (op.k === 'rename') { const p = at(list); if (!p) return; const title = `R${++this.n}`; note(`${kind}.rename ${short(p.key)} ${title}`); return save(p.key, { title, named: true }); }
      return;
    }
    if (op.t === 'setting') {
      const raw = op.v !== undefined ? op.v : { enabled: r.chance(0.5), footer: r.chance(0.5), preset: r.pick(['Frost', 'Dusk', null]), colors: { ...D0.colors, '--gz-accent': hex(r) }, look: { ...D0.look, density: r.pick(['compact', 'cozy', 'roomy']) } }[op.k];
      // As Settings writes it: through the sanitizer (the palette's name is checked against the student's own palettes there).
      const v = op.k === 'preset' ? raw : api.lib('GZ_SANITIZE')({ [op.k]: raw })[op.k];
      note(`setting ${op.k}=${JSON.stringify(v).slice(0, 40)}`);
      const was = dev.disk.sync.get(op.k);
      // Made on a device Sync was never bound on: its first connection joins with Restore's rules, so a value Drive holds
      // then wins over it (the owner's rule). ok: the values the key may end with, this change's and, while every later
      // change is one of these, the last change made on a connected device.
      const before = !this.connected(dev);
      return ctx.chrome.storage.sync.set({ [op.k]: v }).then(() => {
        // A change that landed (an equal write is none): the value every device must end with, unless a later one comes.
        if (dev.disk.sync.get(op.k) === was) return;
        const prev = this.settings.get(op.k), now = dev.disk.sync.get(op.k);
        this.settings.set(op.k, { v: now, step, dev: dev.name, before, ok: before ? [...(prev ? (prev.before ? prev.ok : [prev.v]) : []), now] : [now] });
      }, (e) => note(`  refused: ${e.message}`));
    }
    if (op.t === 'task' || op.t === 'class' || op.t === 'gpa') {
      const kind = { task: 'tasks', class: 'classes', gpa: 'gpa' }[op.t], I = ITEMS[kind];
      return api.turn(async () => {
        const cur = I.clean((await ctx.chrome.storage.local.get(I.key))[I.key]), list = I.list(cur).map((x) => ({ ...x })), t = this.clock;
        let x, change = op.k;
        if (op.k === 'add' || !list.length) { change = 'add'; x = I.make(++this.n, t); list.push(x); }
        else x = at(list);
        const copy = canon(x);
        if (change === 'edit') Object.assign(x, I.edit(++this.n, t));
        else if (change === 'tick') x.done = t;
        else if (change === 'del') list.splice(list.indexOf(x), 1);
        note(`${op.t}.${change} ${x.id}`);
        const next = I.clean(I.with(cur, list, change === 'del' ? x.id : null, t)), want = change === 'del' ? null : canon(I.of(next, x.id));
        dev.intent = { key: I.key, kind, id: x.id, op: change, step, copy: change === 'del' ? copy : null, landed: (v) => (want === null ? !v : canon(v) === want) };
        try { await ctx.chrome.storage.local.set({ [I.key]: next }); } finally { if (dev.intent?.id === x.id) dev.intent = null; }
      });
    }
    if (op.t === 'look') {
      return api.turn(async () => {
        const k = op.k === 'history' ? 'lookHistory' : 'lookFavorites', cur = (await ctx.chrome.storage.local.get(k))[k] || [];
        const next = op.k === 'history' ? [{ theme: { colors: { '--gz-accent': hex(r) } }, at: this.clock }, ...cur].slice(0, 20) : [...cur.filter(() => r.chance(0.7)), { code: `c${++this.n}`, name: `Look ${this.n}` }].slice(-10);
        note(`look.${op.k}`);
        await ctx.chrome.storage.local.set({ [k]: next });
      });
    }
    if (op.t === 'gradescope') {
      return api.turn(async () => {
        const cur = api.lib('GZ_GRADESCOPE').clean((await ctx.chrome.storage.local.get('gradescope')).gradescope);
        const acct = cur.acct || { id: 'a1b2c3d4e5f60718293a4b5c', name: 'Student' };
        const map = { ...cur.map }, gid = String(1 + r.int(4));
        if (op.k === 'place') map[gid] = { to: r.chance(0.7) ? `canvas:${SITE}` : '', name: `Course ${gid}` };
        note(`gradescope.${op.k} ${gid}`);
        await ctx.chrome.storage.local.set({ gradescope: api.lib('GZ_GRADESCOPE').clean({ ...cur, acct, map, hide: op.k === 'hide' ? !cur.hide : cur.hide }) });
      });
    }
    if (op.t === 'pet') {
      return api.turn(async () => {
        const cur = api.lib('GZ_PET').clean((await ctx.chrome.storage.local.get(PET))[PET] || {}) || api.lib('GZ_PET').clean({});
        const next = { ...cur, ...(op.k === 'wear' && { wear: r.pick(['plain', 'bandana', 'happy']) }), ...(op.k === 'habitat' && { habitat: r.pick(['room', 'garden', 'aquarium', 'sky']) }),
          ...(op.k === 'timer' && { timerSignal: `work:${this.clock + 1500e3}:0:focus` }), ...(op.k === 'sprite' && { sprite: r.chance(0.5) ? '' : `s${++this.n}` }) };
        note(`pet.${op.k}`);
        await ctx.chrome.storage.local.set({ [PET]: api.lib('GZ_PET').clean(next) });
      });
    }
    if (op.t === 'words') {
      return api.turn(async () => {
        const cur = (await ctx.chrome.storage.local.get('writerWords')).writerWords || [];
        note(`words.add w${++this.n}`);
        await ctx.chrome.storage.local.set({ writerWords: [...cur, `w${this.n}`].slice(-50) });
      });
    }
    if (op.t === 'dash') {
      const k = `notes:${SITE}`;
      note(`dash.edit d${++this.n}`);
      return api.turn(() => ctx.chrome.storage.local.set({ [k]: { text: `Dashboard note ${this.n}`, at: this.clock } }));
    }
    if (op.t === 'note' || op.t === 'folder') return this.noteOp(dev, op, r, at, note);
    throw new Error(`no such operation ${op.t}`);
  }
  release(t) { for (let x = t; x && !this.released.has(x); x = this.made.get(x)?.parent) this.released.add(x); }

  async noteOp(dev, op, r, at, note) {
    const idx = this.noteIdx(dev), api = dev.api, notes = Object.entries(idx.notes).sort(([a], [b]) => (a < b ? -1 : 1)), folders = Object.entries(idx.folders).sort(([a], [b]) => (a < b ? -1 : 1));
    const liveNotes = notes.filter(([, n]) => !n.del), liveFolders = folders.filter(([, f]) => !f.del);
    const run = async (m, id) => {
      const before = canon(this.noteIdx(dev).notes[id] ?? null);
      const out = await api.notes({ key: NOTES, ...m });
      const after = this.noteIdx(dev).notes[id];
      // What the device holds of the note once the change landed: its text (a token) and whether that was a text edit.
      if (id && canon(after ?? null) !== before) {
        const list = this.notes.get(id) || [];
        list.push({ step: this.step, dev: dev.name, kind: m.op === 'save' ? 'text' : m.op === 'purge' ? 'purge' : 'meta', text: after ? tokensIn(this.noteHtml(dev, id) || '')[0] || null : null });
        this.notes.set(id, list);
      }
      if (!out?.ok) note(`  notes refused: ${out?.error}`);
      return out;
    };
    if (op.t === 'folder') {
      if (op.k === 'new' || !folders.length) { const id = uuidOf(r); note(`folder.new ${id.slice(0, 8)}`); return run({ op: 'folder', id, name: `F${++this.n}` }); }
      if (op.k === 'rename') { const [id] = at(folders); note(`folder.rename ${id.slice(0, 8)}`); return run({ op: 'folder', id, name: `F${++this.n}` }); }
      if (op.k === 'del') { const f = at(liveFolders); if (!f) return; const mode = op.pick2 < 0.5 ? 'keep' : 'trash'; note(`folder.del ${f[0].slice(0, 8)} ${mode}`);
        const ids = Object.entries(idx.notes).filter(([, n]) => n.folder === f[0]).map(([id]) => id);
        const out = await api.notes({ key: NOTES, op: 'folderDel', id: f[0], notes: mode });
        for (const id of ids) { const list = this.notes.get(id) || []; list.push({ step: this.step, dev: dev.name, kind: 'meta', text: tokensIn(this.noteHtml(dev, id) || '')[0] || null }); this.notes.set(id, list); }
        return out; }
      const f = at(folders.filter(([, x]) => x.del)); if (!f) return; note(`folder.restore ${f[0].slice(0, 8)}`); return run({ op: 'restore', ids: [f[0]] });
    }
    const folder = () => (op.pick2 < 0.4 || !liveFolders.length ? '' : at(liveFolders, op.pick2)[0]);
    if (op.k === 'new' || ((op.k === 'edit' || op.k === 'picture') && !liveNotes.length)) {
      const id = uuidOf(r), tok = this.token();
      note(`note.new ${id.slice(0, 8)} ${tok}`);
      return run({ op: 'save', id, base: 0, sid: `s${this.n}`, html: `<p>${tok}</p>`, title: `N${this.n}`, folder: folder() }, id);
    }
    if (op.k === 'picture' && liveNotes.length) {
      // A picture put in a note: its file first, then the text that shows it (as the Notes page does).
      const [id, n] = at(liveNotes), fid = uuidOf(r), tok = this.token();
      note(`note.picture ${id.slice(0, 8)} ${fid.slice(0, 8)} ${tok}`);
      const f = await api.notes({ key: NOTES, op: 'file', id: fid, kind: 'image', name: 'cell.png', data: PNG, note: id });
      if (!f?.ok) { note(`  notes refused: ${f?.error}`); return f; }
      return run({ op: 'save', id, base: n.rev, sid: `s${this.n}`, html: `<p>${tok}</p><img data-gz-file="${fid}">` }, id);
    }
    if (op.k === 'edit' || op.k === 'picture') { const [id, n] = at(liveNotes), tok = this.token(); note(`note.edit ${id.slice(0, 8)} ${tokensIn(this.noteHtml(dev, id) || '')[0]}→${tok}`); return run({ op: 'save', id, base: n.rev, sid: `s${this.n}`, html: `<p>${tok}</p>` }, id); }
    if (op.k === 'rename') { const x = at(liveNotes); if (!x) return; note(`note.rename ${x[0].slice(0, 8)}`); return run({ op: 'meta', id: x[0], title: `N${++this.n}` }, x[0]); }
    if (op.k === 'move') { const x = at(liveNotes); if (!x) return; const to = folder(); note(`note.move ${x[0].slice(0, 8)} → ${to.slice(0, 8) || 'none'}`); return run({ op: 'meta', id: x[0], folder: to }, x[0]); }
    if (op.k === 'trash') { const x = at(liveNotes); if (!x) return; note(`note.trash ${x[0].slice(0, 8)}`); return run({ op: 'trash', ids: [x[0]] }, x[0]); }
    const gone = notes.filter(([, n]) => n.del), x = at(gone);
    if (!x) return;
    if (op.k === 'restore') { note(`note.restore ${x[0].slice(0, 8)}`); return run({ op: 'restore', ids: [x[0]] }, x[0]); }
    note(`note.purge ${x[0].slice(0, 8)}`);
    return run({ op: 'purge', ids: [x[0]] }, x[0]);
  }

  // The student's or another app's doing in Drive (account A's).
  driveOp(op) {
    const r = rng(op.s), drive = this.drive, files = [...drive.files.values()];
    const at = (list) => (list.length ? list[Math.min(list.length - 1, Math.floor(op.pick * list.length))] : null);
    const trashed = (f) => !!drive.view(f.meta.id)?.trashed;
    const tagged = (tag) => files.filter((f) => f.meta.appProperties?.glaze === tag);
    const note = (s) => this.trace(`#${this.step} drive ${s}`);
    if (op.k === 'outsideDocx' || op.k === 'outsidePdf') {
      const pdf = op.k === 'outsidePdf';
      const copied = (x) => tagged('doc').some((j) => j.meta.appProperties.key === x.meta.appProperties.key && !trashed(j));
      const f = at(tagged('file').filter((x) => !trashed(x) && (pdf ? /\.(pdf|pptx)$/.test(x.meta.name) : /\.docx$/.test(x.meta.name)) && (copied(x) || !(this.o.masks || []).includes('orphan-overwrite'))));
      if (!f) return;
      if (pdf) {
        const kind = /\.pptx$/.test(f.meta.name) ? 'slides' : 'pdf', was = this.pdfTok.get(sha(f.bytes)), tok = this.token(), s = FILE_TEXT[kind](tok);
        this.pdfTok.set(sha(s), tok);
        this.made.set(tok, { parent: was || null, key: null, kind, dev: 'drive', step: this.step });
        note(`outsidePdf ${f.meta.name} ${was}→${tok}`);
        return drive.edit(f.meta.id, s);
      }
      const bytes = `PK outside edit ${++this.n} ${r.int(1e9)}`;
      this.outside.set(f.meta.id, bytes);
      note(`outsideDocx ${f.meta.name} (${f.meta.id})`);
      return drive.edit(f.meta.id, bytes);
    }
    if (op.k === 'trashDoc') {
      const f = at([...tagged('file'), ...tagged('doc')].filter((x) => !trashed(x)));
      if (!f) return;
      // Masked missed-file-trash: a document's own file never goes into Drive's trash (a full pass would miss it).
      if (f.meta.appProperties.glaze === 'file' && (this.o.masks || []).includes('missed-file-trash')) { note(`(trash ${f.meta.name}: skipped, known missed-file-trash)`); return; }
      note(`trash ${f.meta.name}`); drive.trash(f.meta.id, true); return;
    }
    if (op.k === 'untrashDoc') {
      const fileTrashed = (j) => tagged('file').some((x) => x.meta.appProperties.key === j.meta.appProperties.key && trashed(x));
      const masked = (this.o.masks || []).includes('file-trash-skip');
      const f = at([...tagged('file'), ...tagged('doc')].filter((x) => x.meta.explicitlyTrashed && !(masked && x.meta.appProperties.glaze === 'doc' && fileTrashed(x))));
      if (f) { note(`untrash ${f.meta.name}`); drive.trash(f.meta.id, false); }
      return;
    }
    // The student's delete for good lets go of what only that file held: a .docx's outside edit, a PDF's or deck's bytes no
    // device holds.
    if (op.k === 'removeDoc') {
      const f = at([...tagged('file'), ...tagged('doc')].filter((x) => x.meta.explicitlyTrashed));
      if (!f) return;
      note(`delete for good ${f.meta.name}`); this.outside.delete(f.meta.id);
      const t = f.bytes && this.pdfTok.get(sha(f.bytes));
      drive.remove(f.meta.id);
      return t && (async () => { for (const d of this.devices) if ((await this.held(d)).has(t)) return; this.released.add(t); })();
    }
    const folder = (tag) => at(tagged(tag).filter((x) => !trashed(x) && x.meta.mimeType === drive.FOLDER));
    if (op.k === 'trashData' || op.k === 'trashBackups' || op.k === 'trashRoot') { const f = folder({ trashData: 'data', trashBackups: 'backups', trashRoot: 'root' }[op.k]); if (f) { note(`trash folder ${f.meta.name}`); drive.trash(f.meta.id, true); } return; }
    const f = at(files.filter((x) => x.meta.mimeType === drive.FOLDER && x.meta.explicitlyTrashed));
    if (f) { note(`untrash folder ${f.meta.name}`); drive.trash(f.meta.id, false); }
  }

  // ---- one operation, then the device settles; a kill reboots it over its disk
  async exec(op) {
    this.step++;
    const masked = (x) => (this.o.masks || []).find((m) => KNOWN[m]?.skips(x));
    if (masked(op)) { this.trace(`#${this.step} (${describe(op)}: skipped, known ${masked(op)})`); return; }
    if (op.inject && masked(op.inject.op)) op = (({ inject, ...x }) => x)(op);
    const dev = op.d === undefined ? null : this.devices[op.d];
    for (const d of this.devices) this.connected(d);
    this.clock += 1000 + rng(op.s || this.step).int(120e3);
    if (dev) dev.opRng = rng((op.s || 7) ^ 0x5bd1e995);
    if (op.t === 'time') { this.clock += op.ms; this.trace(`#${this.step} ${describe(op)}`); return; }
    if (op.t === 'lag') { this.net.lag = op.n; this.trace(`#${this.step} ${describe(op)}`); return; }
    if (op.t === 'faults') { dev.faults = op.p ? { p: op.p, quota: op.quota } : null; dev.syncRefuse = op.refuse || 0; dev.cut = op.cut || null; this.trace(`#${this.step} ${describe(op)}`); return; }
    if (op.t === 'drive') { await this.driveOp(op); return; }
    if (op.t === 'restart') { this.trace(`#${this.step} ${dev.name} worker restarts (idle)`); dev.dead = true; dev.boot(); return; }
    // Masked off-edits: the run turning Sync on finishes (no faults, online, never cut short).
    let held = null;
    if (op.t === 'sync' && op.on && (this.o.masks || []).includes('off-edits')) { held = { faults: dev.faults, offline: dev.offline, cut: dev.cut }; Object.assign(dev, { faults: null, offline: false, cut: null }); op = (({ kill, upload, apply, ...x }) => x)(op); }
    // What may start a run: armed for a kill or an edit at its K-th await.
    const armed = op.kill || op.upload || op.inject || op.after ? { kill: op.kill, upload: op.upload, apply: op.apply, after: op.after || null, inject: op.inject ? { ...op.inject } : null } : null;
    dev.armed = armed; dev.ios = 0;
    const killed = new Promise((res) => { dev.killed = res; });
    let started;
    if (op.t === 'run') {
      this.trace(`#${this.step} ${describe(op)}`);
      dev.stats.runs++;
      if (op.how === 'poke') dev.api.message({ type: 'glaze:drive', op: 'status' }, 'papers.html');
      else if (op.how === 'startup') dev.api.startup();
      else if (op.how === 'run') started = dev.api.sync().run();
      else for (const [id, t] of [...dev.timers]) { dev.timers.delete(id); t.fn(); }
    } else if (op.t === 'sync') {
      this.trace(`#${this.step} ${describe(op)}`);
      started = dev.api.message({ type: 'glaze:driveSync', op: 'set', on: op.on }, 'options.html');
    } else if (op.t === 'account') {
      this.trace(`#${this.step} ${describe(op)}`);
      this.met = true;
      if (op.to !== 'A') this.accounts = true;
      started = dev.api.turn(() => (op.to ? dev.ctx.chrome.storage.local.set({ google: { email: ACCOUNTS[op.to], sub: op.to, flow: 'chrome' } }) : dev.ctx.chrome.storage.local.remove('google')));
    } else if (op.t === 'net') {
      this.trace(`#${this.step} ${describe(op)}`);
      dev.offline = op.offline;
      if (!op.offline) dev.api.online();
    } else started = this.perform(dev, op);
    await Promise.race([Promise.resolve(started).then(() => dev.settle(), (e) => { this.failed(dev, e); return dev.settle(); }), killed]);
    if (!dev.dead && armed?.inject?.started) { await Promise.race([armed.inject.started, killed]); if (!dev.dead) await dev.settle(); }
    dev.armed = null; dev.killed = null;
    if (held) Object.assign(dev, held);
    if (dev.dead) dev.boot();
  }

  // ---- the quiet phase: no faults, every device on account A, online and on; runs until nothing changes
  async quiet() {
    const r = { rounds: 0 };
    this.trace('-- quiet');
    this.net.calm();
    for (const dev of this.devices) { dev.faults = null; dev.syncRefuse = 0; dev.offline = false; dev.cut = null; dev.armed = null; }
    // The student puts the Glaze folder back if it was in Drive's trash (Sync says only they can).
    for (const f of this.drive.files.values()) if (f.meta.appProperties?.glaze === 'root' && f.meta.explicitlyTrashed) { this.trace(`  student restores ${f.meta.name} from Drive's trash`); this.drive.trash(f.meta.id, false); }
    for (const dev of this.devices) {
      this.clock += 1000;
      if (dev.account !== ACCOUNTS.A) { await dev.api.turn(() => dev.ctx.chrome.storage.local.set({ google: { email: ACCOUNTS.A, sub: 'A', flow: 'chrome' } })); await dev.settle(); }
      const st = this.get(dev, 'driveSync') || {};
      if (!st.on || st.account !== ACCOUNTS.A) { this.trace(`  ${dev.name} sync.on`); dev.api.message({ type: 'glaze:driveSync', op: 'set', on: true }, 'options.html'); await dev.settle(); }
    }
    let last = null;
    for (r.rounds = 1; r.rounds <= this.o.rounds; r.rounds++) {
      const before = this.net.writes;
      const results = [];
      for (const dev of this.devices) {
        const st = this.get(dev, 'driveSync') || {};
        this.clock = Math.max(this.clock + 31e3, (st.wait || 0) + 1);
        const out = await dev.api.sync().run();
        await dev.settle();
        results.push(`${dev.name}:${out?.ok ? 'ok' : out?.why}`);
      }
      const print = this.fingerprint();
      this.trace(`  round ${r.rounds}: ${results.join(' ')} writes=${this.net.writes - before}`);
      if (this.net.writes === before && print === last && results.every((x) => x.endsWith(':ok'))) break;
      last = print;
    }
    return r;
  }
  fingerprint() { return sha(canon({ d: this.devices.map((d) => this.view(d)), f: [...this.drive.files.values()].map((f) => [f.meta.id, f.meta.version]) })); }

  // What a device holds that syncs: its documents (as drive-sync.js sends them), its records (as drive-store.js reads them) and Notes.
  view(dev) {
    const docs = {}, trashed = {};
    for (const p of this.papers(dev)) {
      if (!S.KINDS.includes(p.rec.kind || 'paper') || !P.local(p.key)) continue;
      const v = canon(S.body(p.key, p.rec, (p.rec.kind || 'paper') === 'sheet' ? this.partsOf(dev, p.key, p.rec) : null));
      (P.trashed(p.rec) ? trashed : docs)[p.key] = v;
    }
    const records = {};
    for (const [k, v] of dev.disk.sync) records[`sync:${k}`] = v;
    for (const [k, v] of dev.disk.local) {
      const def = ST.CATS.find((c) => c.area === 'local' && c.test(k));
      if (!def || k.startsWith('notesIdx:')) continue;
      records[`local:${k}`] = canon(def.view ? def.view(JSON.parse(v)) : JSON.parse(v));
    }
    const idx = this.noteIdx(dev), notes = {};
    for (const [id, n] of Object.entries(idx.notes)) { const { rev, ex, sid, ...rest } = n; notes[id] = canon({ ...rest, html: this.noteHtml(dev, id) }); }
    return { docs, trashed, records, notes, folders: canon(idx.folders) };
  }
  // Every token a device holds anywhere: a document's text (in Trash too), its versions, a "(Drive copy)".
  async held(dev) {
    const out = new Map();
    const add = (t, where) => { if (t && !out.has(t)) out.set(t, where); };
    for (const p of this.papers(dev)) add(this.tokenOf(dev, p.rec), `${short(p.key)}${P.trashed(p.rec) ? ' (Trash)' : ''}`);
    for (const [k, v] of dev.disk.local) {
      if (!k.startsWith(P.KEYS.VERSIONS)) continue;
      for (const x of JSON.parse(v)) {
        for (const t of tokensIn(JSON.stringify(x.doc ?? ''))) add(t, `version of ${short(k.slice(P.KEYS.VERSIONS.length))}`);
        if (x.file?.hash) add(this.pdfTok.get(x.file.hash), `version of ${short(k.slice(P.KEYS.VERSIONS.length))}`);
        if (typeof x.gz === 'string') { try { const wb = await SD.unpack(x.gz); for (const t of tokensIn(JSON.stringify(wb, (_, y) => (y instanceof Map ? [...y] : y)))) add(t, `sheet version of ${short(k.slice(P.KEYS.VERSIONS.length))}`); } catch { /* not one */ } }
      }
    }
    return out;
  }

  // ---- the invariants, once the quiet phase is over
  async check(quiet) {
    const fail = [];
    const F = (inv, msg) => fail.push({ inv, msg });
    const views = this.devices.map((d) => this.view(d));
    // Too large to sync (documents/drive-sync.js driveSyncLarge): what any device marks stays on its device, out of the
    // comparisons. With the stage off nothing is staged, and with tiny transfers every live document is marked (its JSON copy
    // alone is past one request), on every device Sync is on for.
    const large = { docs: new Set(), recs: new Set() };
    for (const d of this.devices) { const m = this.get(d, 'driveSyncLarge') || {}; for (const k of Object.keys(m.docs || {})) large.docs.add(k); for (const k of Object.keys(m.recs || {})) large.recs.add(k); }
    const noteLarge = (id) => [...large.recs].some((r) => r.startsWith('notes:') && r.endsWith(`|${id}`));
    if (!this.staged) {
      for (const d of this.devices) if (Object.keys(this.get(d, 'driveSyncMoves') || {}).length) F('large', `${d.name} staged a transfer: ${Object.keys(this.get(d, 'driveSyncMoves')).join(' ')}`);
      const sent = this.drive.log.filter((x) => x.query?.uploadType === 'resumable' || x.chunk || x.range);
      if (sent.length) F('large', `${sent.length} staged requests, the first ${sent[0].dev} ${sent[0].method} ${sent[0].path}`);
      if (this.o.tiny) views.forEach((v, i) => { if ((this.get(this.devices[i], 'driveSync') || {}).on) for (const k of Object.keys(v.docs)) if (!(this.get(this.devices[i], 'driveSyncLarge')?.docs || {})[k]) F('large', `${this.devices[i].name}: ${k} is past one request and not marked too large`); });
    }
    const skip = (part, k) => (part === 'docs' ? large.docs.has(k) : part === 'records' ? large.recs.has(k) : noteLarge(k));
    // Convergence.
    const [first, ...rest] = views;
    rest.forEach((v, i) => {
      const other = this.devices[i + 1].name;
      for (const part of ['docs', 'records', 'notes']) {
        for (const k of new Set([...Object.keys(first[part]), ...Object.keys(v[part])])) {
          if (first[part][k] !== v[part][k] && !skip(part, k)) F(`convergence:${part}`, `${k}: A=${(first[part][k] ?? 'missing').slice(0, 160)} ${other}=${(v[part][k] ?? 'missing').slice(0, 160)}`);
        }
      }
      if (first.folders !== v.folders && !noteLarge('folders')) F('convergence:noteFolders', `A=${first.folders.slice(0, 200)} ${other}=${v.folders.slice(0, 200)}`);
      // Trash isn't compared: a document goes into Trash with each device's own text (its content stops syncing there), and
      // one trashed before it ever went up stays on its device. What it holds is still checked by no loss.
    });
    // No loss: every token no later edit came from, and no delete for good let go, is still held somewhere.
    const held = await Promise.all(this.devices.map((d) => this.held(d)));
    const parents = new Set([...this.made.values()].map((x) => x.parent).filter(Boolean));
    for (const [t, m] of this.made) {
      if (parents.has(t) || this.released.has(t)) continue;
      // An outside edit in Drive also survives in the file holding it (in Drive's trash with its document, say).
      if (m.dev === 'drive' && [...this.drive.files.values()].some((f) => f.bytes && this.pdfTok.get(sha(f.bytes)) === t)) continue;
      if (!held.some((h) => h.has(t))) F('no-loss:document', `${t} (${m.kind} ${short(m.key) || ''} written on ${m.dev} at #${m.step}${m.parent ? ` over ${m.parent}` : ''}) is on no device`);
    }
    // A Word file edited outside Glaze is never overwritten.
    for (const [id, bytes] of this.outside) {
      const f = this.drive.files.get(id);
      if (f && f.bytes?.toString('latin1') !== bytes) F('no-loss:outside-edit', `${f.meta.name} (${id}), edited outside Glaze, was overwritten`);
    }
    // Every note's last text: the last text written, unless a later write from a device that held another text won (last
    // writer wins, by design) or a delete for good did.
    for (const [id, list] of this.notes) {
      const i0 = list.map((x) => x.kind).lastIndexOf('text'), lastText = list[i0], last = list[list.length - 1];
      const ok = new Set(list.slice(Math.max(0, i0)).map((x) => x.text).filter(Boolean));
      for (const [i, v] of views.entries()) {
        const n = v.notes[id];
        if (!n) { if (!list.some((x) => x.kind === 'purge') && !noteLarge(id)) F('no-loss:note', `note ${id.slice(0, 8)} missing on ${this.devices[i].name} (last written on ${last.dev} at #${last.step})`); continue; }
        const t = tokensIn(JSON.parse(n).html || '')[0] || null;
        // Purged after its last text, then brought back by a device returning to the account (switching accounts A→B→A brings
        // older data back, a known limit; a first meeting never lets a tombstone delete): by design.
        if (lastText && !ok.has(t) && this.accounts && list.slice(i0).some((x) => x.kind === 'purge')) { if (i === 0) this.soft.push(`note ${id.slice(0, 8)}: purged after its last text ${lastText.text}, back with ${t} from a device that switched accounts (a known limit)`); }
        else if (lastText && !ok.has(t) && !noteLarge(id)) F('no-loss:note', `note ${id.slice(0, 8)} on ${this.devices[i].name} holds ${t}, its last text was ${lastText.text} (#${lastText.step} on ${lastText.dev})`);
        else if (lastText && t !== lastText.text && i === 0) this.soft.push(`note ${id.slice(0, 8)}: its last text ${lastText.text} (#${lastText.step} on ${lastText.dev}) gave way to ${t}, from a later rename, move or trash on a device that held it (last writer wins)`);
      }
    }
    // Settings: the later change wins, key by key (first meetings included: Settings take the later change there too), so
    // each key ends as its last change left it. Switching accounts A→B→A brings older Settings back (a known limit). By
    // design, a device's first connection joins with Restore's rules: changes made there before it was ever connected give
    // way to Drive's value, the last change made on a connected device (or an earlier such change, Drive's then).
    for (const [k, x] of this.settings) {
      const got = this.devices[0].disk.sync.get(k);
      if (got !== x.v && !this.accounts && !(x.before && x.ok.includes(got)) && !large.recs.has(`sync:${k}`)) F('lww:settings', `${k} is ${got ?? 'missing'} everywhere, its last change was ${x.v} (#${x.step} on ${x.dev})`);
    }
    // Records merged item by item (tasks, class schedules, GPA terms): an item whose last change wasn't its deletion is on
    // every device, a task with every tick it was given; one deleted stays deleted. A task deleted on one device and changed
    // on another that hadn't heard of the deletion keeps the change, so a task comes back only as some change made it, never
    // as the deleting device held it; class schedules and GPA terms go by when each changed. Switching accounts A→B→A brings
    // older data back (a known limit: a first meeting joins). One too large to sync stays on its device.
    for (const [id, list] of this.items) {
      const kind = id.slice(0, id.indexOf(':')), item = id.slice(kind.length + 1), I = ITEMS[kind], last = list[list.length - 1];
      if (large.recs.has(`local:${I.key}`)) continue; // too large to sync: on its device alone
      for (const dev of this.devices) {
        const got = I.of(this.get(dev, I.key), item);
        if (last.kind !== 'del') {
          if (!got) F('no-loss:record', `${kind} ${item} missing on ${dev.name}, its last change ${last.kind} on ${last.dev} at #${last.step}`);
          else if (kind === 'tasks' && !got.done && !this.accounts && list.some((x) => x.kind === 'tick')) F('no-loss:record', `task ${item} on ${dev.name} lost its tick (#${list.find((x) => x.kind === 'tick').step})`);
        } else if (got && !this.accounts && (kind !== 'tasks' || canon(got) === last.copy)) F('no-return:record', `${kind} ${item} is back on ${dev.name} after its deletion on ${last.dev} at #${last.step}`);
      }
    }
    // Every picture a note shows is on each device that holds the note.
    for (const dev of this.devices) {
      for (const [id, n] of Object.entries(this.noteIdx(dev).notes)) {
        for (const fid of N.refs(this.noteHtml(dev, id) || '')) {
          if ((!dev.disk.notesdb.has(`files\u0000${SITE}/${fid}`) || !dev.disk.notesdb.has(`blobs\u0000${SITE}/${fid}`)) && !noteLarge(id) && ![...large.recs].some((r) => r.endsWith(`|file|${fid}`))) F('no-loss:note-file', `${dev.name}: note ${id.slice(0, 8)} shows picture ${fid.slice(0, 8)}, which isn't there${n.del ? ' (note in Trash)' : ''}`);
        }
      }
    }
    // Quiescence: a quiet round writes nothing and reads a bounded amount.
    if (quiet.rounds > this.o.rounds) F('quiescence', `still changing after ${this.o.rounds} quiet rounds`);
    else {
      const from = this.drive.log.length, writes = this.net.writes, perDev = {};
      for (const dev of this.devices) {
        const n0 = this.drive.log.length;
        this.clock += 31e3;
        const out = await dev.api.sync().run();
        await dev.settle();
        perDev[dev.name] = this.drive.log.length - n0;
        if (!out?.ok) F('no-stall', `${dev.name}'s quiet run: ${out?.why}`);
      }
      const extra = this.drive.log.slice(from).filter((e) => e.method !== 'GET');
      if (this.net.writes !== writes) F('quiescence', `a quiet round wrote to Drive: ${extra.map((e) => `${e.dev} ${e.method} ${e.path}${e.upload ? ` (${e.upload.meta?.name || e.upload.meta?.appProperties?.glaze || ''})` : ''}`).join('; ').slice(0, 400)}`);
      for (const [d, n] of Object.entries(perDev)) if (n > this.o.reads) F('quiescence', `${d}'s quiet run read Drive ${n} times`);
    }
    // Drive's state: one copy of each document in Glaze/, one Glaze, nothing deleted for good but old snapshots.
    const st = this.devices.map((d) => this.get(d, 'driveSync') || {});
    const folder = st[0].folder;
    if (st.some((x) => x.folder !== folder)) F('drive-state', `devices disagree on the Glaze folder: ${st.map((x) => x.folder).join(' ')}`);
    const visible = (f) => !this.drive.view(f.meta.id).trashed;
    const roots = [...this.drive.files.values()].filter((f) => f.meta.appProperties?.glaze === 'root' && f.meta.mimeType === this.drive.FOLDER && visible(f) && f.meta.parents.includes('0AroOt'));
    if (roots.length !== 1) F('drive-state', `${roots.length} Glaze folders in My Drive`);
    const per = new Map();
    for (const f of this.drive.files.values()) {
      if (!f.meta.parents.includes(folder) || !visible(f) || !['doc', 'file'].includes(f.meta.appProperties?.glaze)) continue;
      const k = `${f.meta.appProperties.glaze}:${f.meta.appProperties.key}`;
      per.set(k, [...(per.get(k) || []), f.meta.name]);
    }
    // Every live document has its JSON copy and its own file in Glaze/, out of Drive's trash.
    for (const k of Object.keys(views[0].docs)) {
      if (large.docs.has(k)) continue;
      const h = sha(k).slice(0, 32);
      for (const role of ['doc', 'file']) if (!per.has(`${role}:${h}`)) F('drive-state', `${k}, live on A, has no visible ${role === 'doc' ? 'JSON copy' : 'file of its own'} in Glaze/`);
    }
    for (const [k, names] of per) if (names.length > 1) F('drive-state', `${names.length} visible ${k.startsWith('doc') ? 'JSON copies' : 'files'} for one document in Glaze/: ${names.join(', ')}`);
    for (const e of this.drive.log.filter((x) => x.method === 'DELETE' && x.deleted)) {
      if (e.deleted.appProperties?.glaze !== 'snapshot' || e.deleted.mimeType !== 'application/zip') F('drive-state', `${e.dev} deleted ${e.deleted.name} for good`);
    }
    // No stall: each device caught up with Drive's changes, on, with no problem.
    const head = String(JSON.parse(this.drive.handle({ method: 'GET', url: 'https://www.googleapis.com/drive/v3/changes/startPageToken', headers: { authorization: `Bearer ${TOKENS[ACCOUNTS.A]}` } }).body.toString()).startPageToken);
    this.drive.log.pop();
    st.forEach((x, i) => {
      if (!x.on || x.problem) F('no-stall', `${this.devices[i].name}: on=${x.on} problem=${x.problem}`);
      else if (x.token !== head) F('no-stall', `${this.devices[i].name}'s change token ${x.token} is behind Drive's ${head}`);
    });
    for (const e of this.rejections) F('unhandled', e);
    if (this.broken) F('harness', this.broken.split('\n').slice(0, 4).join(' | '));
    const ignored = (f) => (this.o.masks || []).some((m) => KNOWN[m]?.ignore?.(f, this));
    return fail.filter((f) => !ignored(f));
  }

  async play() {
    const onRejection = (e) => this.rejections.push(String(e?.stack || e).split('\n').slice(0, 3).join(' | '));
    process.on('unhandledRejection', onRejection);
    try {
      // Every device signs in with account A first, as a student connecting Drive on each.
      // Every device but the first may join later (an account op, or the quiet phase), meeting the folder with its own data.
      const r = rng(this.seed ^ 0x1234567);
      for (const dev of this.devices) {
        const out = Array.isArray(this.o.join) ? !this.o.join.includes(dev.index) : dev.index > 0 && this.o.join !== 'all' && r.chance(0.4);
        if (out) { this.trace(`${dev.name} starts signed out`); this.met = true; continue; }
        await dev.api.turn(() => dev.ctx.chrome.storage.local.set({ google: { email: ACCOUNTS.A, sub: 'A', flow: 'chrome' } })); await dev.settle(); this.clock += 5000;
      }
      for (const op of this.ops) await this.exec(op);
      this.quietRun = await this.quiet();
      return this.o.noCheck ? [] : await this.check(this.quietRun);
    } finally { process.off('unhandledRejection', onRejection); }
  }
}

// One seed's run. → { seed, ok, failures, trace, ops, stats }
const play = async (seed, o = {}) => {
  const ops = o.list || generate(seed, o);
  const w = new World(seed, ops, o);
  let failures;
  try { failures = await w.play(); } catch (e) { failures = [{ inv: 'harness', msg: String(e?.stack || e).split('\n').slice(0, 6).join('\n') }]; }
  return { seed, ok: !failures.length, failures, soft: w.soft, trace: w.lines, ops, errors: w.errors, logs: w.devices.map((d) => d.log), stats: w.devices.map((d) => ({ name: d.name, ...d.stats })) };
};

// The smallest list of operations that still breaks the same invariant (delta debugging), then each operation made plainer.
const shrink = async (seed, ops, inv, o = {}, budget = 200) => {
  const fails = async (list) => { if (budget-- <= 0) return false; const r = await play(seed, { ...o, list }); return r.failures.some((f) => f.inv === inv); };
  let list = ops, n = 2;
  while (list.length >= 2 && budget > 0) {
    const size = Math.ceil(list.length / n);
    let cut = false;
    for (let i = 0; i < list.length; i += size) {
      const rest = [...list.slice(0, i), ...list.slice(i + size)];
      if (rest.length && await fails(rest)) { list = rest; n = Math.max(n - 1, 2); cut = true; break; }
    }
    if (!cut) { if (n >= list.length) break; n = Math.min(list.length, n * 2); }
  }
  for (let i = 0; i < list.length && budget > 0; i++) {
    const op = list[i];
    const plainer = [];
    if (op.kill || op.upload) plainer.push((({ kill, upload, apply, ...x }) => x)(op));
    if (op.inject) plainer.push((({ inject, ...x }) => x)(op));
    for (const p of plainer) { const next = [...list]; next[i] = p; if (await fails(next)) { list = next; break; } }
  }
  return list;
};

module.exports = { TINY, STAGED, rng, canon, sha, network, Device, World, generate, describe, play, shrink, KNOWN, ACCOUNTS, TOKENS, FIRST, prelude, START };
