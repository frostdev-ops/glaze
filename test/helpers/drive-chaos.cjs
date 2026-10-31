// A randomized multi-device chaos test for Sync to Google Drive (test/documents/drive-chaos.test.js, tools/dev/drive-chaos.js).
// Each device is a worker of its own: a vm context running background.js's own library list and its Drive section, so the
// real drive.js, drive-sync.js, drive-store.js, writer-papers.js, notes.js and doc-files.js, against chrome.storage.local and
// sync, the Notes database and the documents' file store, all kept on a host-side disk that outlives the context. Killing a
// device stops it at its K-th await on that disk or the network (the write applied or not, the reply lost) and boots a new
// context over the same disk, as the browser restarts a stopped worker. Every device talks to stand-in Drives
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
const scripts = new Map();
const script = (file) => {
  let s = scripts.get(file);
  if (!s) { s = new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(EXT, file) }); scripts.set(file, s); }
  return s;
};
const BG_SOURCE = fs.readFileSync(path.join(BG, 'background.js'), 'utf8');
// background.js's own first importScripts: every library the worker has before anything loads on demand.
const FIRST = [...BG_SOURCE.slice(0, BG_SOURCE.indexOf(');')).matchAll(/'([^']+\.js)'/g)].map((m) => m[1]);
// What brokerIn('backup') loads (background.js BROKER_FILES.backup).
const BACKUP_FILES = (() => { const m = /BROKER_FILES\.backup = \[([^\]]+)\]/.exec(BG_SOURCE); return m ? [...m[1].matchAll(/'([^']+\.js)'/g)].map((x) => x[1]) : []; })();
// background.js's Drive section, as test/documents/drive-sync-background.test.js runs it.
const SECTION = (() => {
  const from = BG_SOURCE.indexOf('// Sync to Google Drive (documents/drive-sync.js'), to = BG_SOURCE.indexOf('// A Download all wait owns', from);
  if (from < 0 || to < 0) throw new Error('drive-chaos: background.js\'s Drive section markers moved');
  return new vm.Script(BG_SOURCE.slice(from, to), { filename: 'background/background.js#drive' });
})();

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
const network = () => {
  const drives = { [ACCOUNTS.A]: standin({ tokens: new Set([TOKENS[ACCOUNTS.A]]), owner: ACCOUNTS.A }), [ACCOUNTS.B]: standin({ tokens: new Set([TOKENS[ACCOUNTS.B]]), owner: ACCOUNTS.B }) };
  const byToken = Object.fromEntries(Object.entries(TOKENS).map(([acct, tok]) => [tok, drives[acct]]));
  // Search lag: a file Drive made shows in files.list only after this many lists (each Drive its own count).
  const lag = new Map(), known = new Map(Object.values(drives).map((d) => [d, new Set()]));
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
    const seen = known.get(drive);
    for (const id of drive.files.keys()) if (!seen.has(id)) { seen.add(id); if (net.lag > 0) lag.set(id, net.lag); }
    if (f === 'lost') { dev.stats.faults++; return null; } // Drive did it; the answer never came
    if (!a) return null;
    let body = a.body;
    if (method === 'GET' && new URL(url).pathname === '/drive/v3/files' && a.status === 200 && lag.size) {
      const j = JSON.parse(body.toString('utf8'));
      if (Array.isArray(j.files)) j.files = j.files.filter((x) => !(lag.get(x.id) > 0));
      for (const [id, n] of lag) { if (n <= 1) lag.delete(id); else lag.set(id, n - 1); }
      body = Buffer.from(JSON.stringify(j));
    }
    return new Response(a.status === 204 || a.status === 304 ? null : body, { status: a.status, headers: a.headers });
  };
  net.calm = () => { net.lag = 0; lag.clear(); };
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
      fetch: (url, init) => host.io('net', (init?.method || 'GET'), () => {
        const res = world.net.handle(dev, url, init);
        if (!res) throw new TypeError('Failed to fetch');
        return res;
      }),
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
        script(file).runInContext(dev.ctx);
        if (/drive-sync\.js$/.test(file)) dev.patchSync();
      },
      backupFiles: BACKUP_FILES,
      console: { log: (...a) => dev.note('log', a), info: (...a) => dev.note('info', a), warn: (...a) => dev.note('warn', a), error: (...a) => dev.note('error', a), debug: () => {} },
      TextDecoderClass: TextDecoder,
    };
    this.host = host;
    const ctx = vm.createContext({ URL, URLSearchParams, TextDecoder, Response, Headers, ReadableStream, WritableStream, TransformStream, AbortController, AbortSignal, atob, btoa, structuredClone, queueMicrotask, Event, EventTarget, DOMException });
    ctx.globalThis = ctx; ctx.self = ctx;
    this.ctx = ctx;
    vm.runInContext(`(${prelude.toString()})`, ctx)(host);
    for (const f of FIRST) host.load(f);
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
    S.create = (env) => create({ ...env,
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
const SD = require('../../extension/documents/sheets/sheet-data.js');
const M = require('../../extension/documents/sheets/sheet-model.js');
const D0 = require('../../extension/content/defaults.js').GZ_SANITIZE({});

const START = Date.parse('2026-10-30T12:00:00Z');
const FILE_TEXT = { pdf: (t) => `%PDF-1.7\n% ${t}\n`, slides: (t) => `PK\u0003\u0004 deck ${t}` };
const FILE_TYPE = { pdf: 'application/pdf', slides: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const FILED = ['pdf', 'slides'];
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a40000000049454e44ae426082', 'hex').toString('base64');
const SITE = 'https://school.instructure.com/42';
const TODO = `todo:${SITE}`, PET = `pet:${SITE}`, NOTES = `notesIdx:${SITE}`;
const TOKEN = /ZQ(\d+)QZ/g;
const tokensIn = (s) => [...String(s).matchAll(TOKEN)].map((m) => `ZQ${m[1]}QZ`);
const docOf = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const hex = (r) => `#${[0, 0, 0].map(() => r.int(256).toString(16).padStart(2, '0')).join('')}`;
const uuidOf = (r) => { const h = [...Array(16)].map(() => r.int(256)); h[6] = (h[6] & 0x0f) | 0x40; h[8] = (h[8] & 0x3f) | 0x80; const x = h.map((b) => b.toString(16).padStart(2, '0')).join(''); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };
const short = (k) => (typeof k === 'string' ? k.replace(/^doc:0*-?0*-?4000-8000-0*/, 'doc:').replace(/^doc:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-([0-9a-f]{4})[0-9a-f]{8}$/, 'doc:…$1') : k);
const json = (s) => (s === undefined ? undefined : JSON.parse(s));

// ---- the operations: plain data made from a seed, each with its own seed for what it decides as it runs, so any subset of
// a list still runs (picks are fractions of what the device has then). shrink() removes and simplifies them.
const USER = ['paper', 'sheet', 'pdf', 'slides', 'setting', 'task', 'note', 'folder', 'look', 'gradescope', 'pet', 'words', 'dash'];
const generate = (seed, { ops = 40, devices = 2 } = {}) => {
  const r = rng(seed);
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
    return { t, k, d, pick: r(), pick2: r(), s: r.int(2 ** 31) };
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
  if (op.t === 'run') return `${d}run.${op.how}${op.kill ? ` kill@${op.kill}${op.apply ? '+applied' : ''}` : ''}${op.after ? ` killed right after writing "${op.after}"` : ''}${op.inject ? ` inject@${op.inject.at}(${describe({ ...op.inject.op, d: undefined })})` : ''}`;
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
// repro: the fewest operations that show it (two devices, both signed in at the start).
const KNOWN = {
  'null-setting': {
    about: 'a Settings value of null (preset, once the palette is the student\'s own) goes back and forth between devices forever',
    skips: (op) => op.t === 'setting' && op.k === 'preset',
    repro: [{ t: 'setting', d: 1, k: 'preset', v: null, pick: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'run', d: 0, how: 'run', s: 3 }],
  },
  'trashed-data': {
    about: 'records that don\'t change after Glaze/Data goes into Drive\'s trash are never put in the new Data: other devices never get them',
    skips: (op) => op.t === 'drive' && op.k === 'trashData',
    repro: [{ t: 'setting', d: 0, k: 'footer', v: false, pick: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'drive', k: 'trashData', pick: 0, s: 3 }, { t: 'run', d: 0, how: 'run', s: 4 }],
  },
  'orphan-overwrite': {
    about: 'a .docx whose first push stopped before its JSON copy, then edited outside Glaze, is overwritten by the next push',
    skips: () => false, // outsideDocx picks only files with their JSON copy while masked
    // The same adoption after a first meeting that found the JSON copy in Drive's trash and the file put back.
    ignore: (f, w) => f.inv === 'no-loss:outside-edit' && w.met,
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'faults', d: 0, p: 0, cut: '\\.docx$' }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'drive', k: 'outsideDocx', pick: 0, s: 3 }],
  },
  'off-edits': {
    about: 'a document saved while Sync was off never goes up when the full run turning Sync on doesn\'t finish (offline, Drive busy, the worker stopping)',
    skips: () => false, // turning Sync on runs with no faults, online and uncut while masked
    repro: [{ t: 'sync', d: 0, on: false, s: 1 }, { t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 2 }, { t: 'net', d: 0, offline: true, s: 3 }, { t: 'sync', d: 0, on: true, s: 4 }],
  },
  'stray-file': {
    about: 'a .docx edited outside Glaze, kept by one device that writes a new file, is kept again by another device editing the document: the first new file stays in Glaze/ as a second copy',
    skips: () => false,
    ignore: (f) => f.inv === 'drive-state' && /visible files for one document/.test(f.msg),
    repro: [{ t: 'paper', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'drive', k: 'outsideDocx', pick: 0, s: 3 }, { t: 'run', d: 0, how: 'run', s: 4 }, { t: 'paper', k: 'edit', d: 0, pick: 0, pick2: 0, s: 5 }, { t: 'run', d: 1, how: 'run', s: 6 }],
  },
  'missed-file-trash': {
    about: 'a document\'s own file put in Drive\'s trash is never seen by a full pass (Sync turned on, off before or already on): it reads only the JSON copies, so the document stays live with its file in the trash; a PDF so is passed over as unreadable by every other device',
    skips: () => false, // trashDoc leaves a document's own file alone while masked
    repro: [{ t: 'pdf', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'sync', d: 1, on: false, s: 3 }, { t: 'drive', k: 'trashDoc', pick: 0, s: 4 }],
  },
  'file-trash-skip': {
    about: 'a PDF or deck met while its JSON copy is out of Drive\'s trash and its file still in it (restored one before the other) is passed over for good: the file coming back later brings it to no device that hadn\'t it',
    skips: () => false, // untrashDoc restores a JSON copy only once its document's file is out of the trash, while masked
    repro: [{ t: 'slides', k: 'new', d: 1, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 1, how: 'run', s: 2 }, { t: 'drive', k: 'trashDoc', pick: 0.99, s: 3 }, { t: 'run', d: 1, how: 'run', s: 4 }, { t: 'drive', k: 'untrashDoc', pick: 0.99, s: 5 }, { t: 'run', d: 0, how: 'run', s: 6 }],
  },
  'drive-copy-stop': {
    about: 'a worker stopped right after saving a conflict\'s "(Drive copy)" (a PDF\'s, or one too big for a version), before marking it, leaves that copy on its device only, and the next run makes a second one',
    skips: () => false,
    ignore: (f, w) => (f.inv === 'convergence:docs' || f.inv === 'drive-state') && w.devices.some((d) => Object.values(w.view(d).docs).some((v) => v.includes('(Drive copy)') && f.msg.includes(JSON.parse(v).key))),
    repro: [{ t: 'pdf', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'pdf', k: 'edit', d: 0, pick: 0, pick2: 0, s: 4 },
      { t: 'pdf', k: 'edit', d: 1, pick: 0, pick2: 0, s: 5 }, { t: 'run', d: 1, how: 'run', s: 6 }, { t: 'run', d: 0, how: 'run', s: 7, after: '(Drive copy)' }],
  },
  'join-stamp': {
    about: 'a first meeting\'s joined record goes up stamped with the time of the meeting, not of the latest change it holds, so it beats a later change another device hadn\'t pushed yet: a note\'s newer text lost to a rename, a task lost when a second device connects',
    skips: () => false,
    ignore: (f, w) => ['no-loss:note', 'lww:settings'].includes(f.inv) && w.met,
    repro: [{ t: 'note', k: 'new', d: 0, pick: 0, pick2: 0.9, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'account', d: 0, to: 'B', s: 4 }, { t: 'note', k: 'rename', d: 0, pick: 0, pick2: 0, s: 5 }, { t: 'note', k: 'edit', d: 1, pick: 0, pick2: 0, s: 6 }],
  },
  'first-meeting-trash': {
    about: 'on a first meeting (an account switched back, a restored device), a document in Trash on one side is never met: one in Drive\'s trash goes up again as new (and other devices, picking the lower id of two copies even in the trash, never get it), one in Trash here stays live in Drive',
    skips: () => false,
    // Masked: a document in Trash on some device, or whose JSON copy is in Drive's trash, may differ.
    ignore: (f, w) => f.inv === 'convergence:docs' && (() => {
      const k = /^(doc:[0-9a-f-]+):/.exec(f.msg)?.[1], h = k && sha(k).slice(0, 32);
      return !!k && (w.devices.some((d) => w.view(d).trashed[k]) || [...w.drive.files.values()].some((x) => x.meta.appProperties?.glaze === 'doc' && x.meta.appProperties.key === h && w.drive.view(x.meta.id).trashed));
    })(),
    repro: [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'run', d: 0, how: 'run', s: 2 }, { t: 'run', d: 1, how: 'run', s: 3 }, { t: 'account', d: 1, to: 'B', s: 4 }, { t: 'paper', k: 'trash', d: 1, pick: 0, pick2: 0, s: 5 }],
  },
};

// ---- a run of one list of operations
class World {
  constructor(seed, ops, o = {}) {
    this.seed = seed; this.ops = ops; this.o = { devices: 2, rounds: 8, reads: 24, ...o };
    this.clock = START; this.step = 0; this.errors = []; this.lines = []; this.rejections = []; this.soft = [];
    this.net = network();
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
    this.settings = new Map(); // Settings key → the last change made to it { v (JSON), step, dev }
    this.met = false; // a first meeting happened (an account switched, a device joining late)
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
  noteHtml(dev, id) { const n = this.noteIdx(dev).notes[id]; if (!n) return undefined; const b = dev.disk.notesdb.get(`bodies\u0000${SITE}/${id}/${n.rev}`); return b ? b.html : n.rev > 0 ? null : ''; }

  // ---- what each operation does on its device (no waiting for the device to settle: an injected one runs inside a run)
  async perform(dev, op) {
    const r = rng(op.s || 1), api = dev.api, ctx = dev.ctx, step = this.step;
    const at = (list, f = op.pick) => (list.length ? list[Math.min(list.length - 1, Math.floor(f * list.length))] : null);
    const save = (key, patch, o = {}) => api.turn(() => api.papers().save(key, patch, o));
    const live = (kind) => this.papers(dev).filter((p) => (p.rec.kind || 'paper') === kind && !P.trashed(p.rec) && P.local(p.key));
    const note = (s) => this.trace(`#${step} ${dev.name} ${s}`);
    if (['paper', 'sheet', 'pdf', 'slides'].includes(op.t)) {
      const kind = op.t, list = live(kind);
      const newKey = () => `doc:${uuidOf(r)}`;
      // A PDF's or deck's bytes, each holding its token (the file store keeps them by hash).
      const fileBytes = (tok) => { const s = FILE_TEXT[kind](tok); this.pdfTok.set(sha(s), tok); return new ctx.TextEncoder().encode(s); };
      if (op.k === 'new' || (op.k === 'edit' && !list.length)) {
        const key = newKey(), tok = this.token(), title = `${kind[0].toUpperCase()}${this.n}`;
        this.fresh.set(tok, { key, kind });
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
      return ctx.chrome.storage.sync.set({ [op.k]: v }).then(() => {
        // A change that landed (an equal write is none): the value every device must end with, unless a later one comes.
        if (dev.disk.sync.get(op.k) !== was) this.settings.set(op.k, { v: dev.disk.sync.get(op.k), step, dev: dev.name });
      }, (e) => note(`  refused: ${e.message}`));
    }
    if (op.t === 'task') {
      return api.turn(async () => {
        const cur = api.lib('GZ_TODO').clean((await ctx.chrome.storage.local.get(TODO))[TODO]);
        const tasks = cur.tasks.map((x) => ({ ...x }));
        if (op.k === 'add' || !tasks.length) { tasks.push({ id: `t${++this.n}`, title: `Task ${this.n}`, done: 0, at: this.clock }); note(`task.add t${this.n}`); }
        else if (op.k === 'edit') { const x = at(tasks); x.title = `Task ${++this.n}`; note(`task.edit ${x.id}`); }
        else { const x = at(tasks); tasks.splice(tasks.indexOf(x), 1); note(`task.del ${x.id}`); }
        await ctx.chrome.storage.local.set({ [TODO]: api.lib('GZ_TODO').clean({ tasks, items: cur.items }) });
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
    if (op.k === 'removeDoc') { const f = at([...tagged('file'), ...tagged('doc')].filter((x) => x.meta.explicitlyTrashed)); if (f) { note(`delete for good ${f.meta.name}`); this.outside.delete(f.meta.id); drive.remove(f.meta.id); } return; }
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
    this.clock += 1000 + rng(op.s || this.step).int(120e3);
    if (dev) dev.opRng = rng((op.s || 7) ^ 0x5bd1e995);
    if (op.t === 'time') { this.clock += op.ms; this.trace(`#${this.step} ${describe(op)}`); return; }
    if (op.t === 'lag') { this.net.lag = op.n; this.trace(`#${this.step} ${describe(op)}`); return; }
    if (op.t === 'faults') { dev.faults = op.p ? { p: op.p, quota: op.quota } : null; dev.syncRefuse = op.refuse || 0; dev.cut = op.cut || null; this.trace(`#${this.step} ${describe(op)}`); return; }
    if (op.t === 'drive') { this.driveOp(op); return; }
    if (op.t === 'restart') { this.trace(`#${this.step} ${dev.name} worker restarts (idle)`); dev.dead = true; dev.boot(); return; }
    // Masked off-edits: the run turning Sync on finishes (no faults, online, never cut short).
    let held = null;
    if (op.t === 'sync' && op.on && (this.o.masks || []).includes('off-edits')) { held = { faults: dev.faults, offline: dev.offline, cut: dev.cut }; Object.assign(dev, { faults: null, offline: false, cut: null }); op = (({ kill, apply, ...x }) => x)(op); }
    // What may start a run: armed for a kill or an edit at its K-th await.
    const armed = op.kill || op.inject || op.after ? { kill: op.kill, apply: op.apply, after: op.after || null, inject: op.inject ? { ...op.inject } : null } : null;
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
    // Convergence.
    const [first, ...rest] = views;
    rest.forEach((v, i) => {
      const other = this.devices[i + 1].name;
      for (const part of ['docs', 'records', 'notes']) {
        for (const k of new Set([...Object.keys(first[part]), ...Object.keys(v[part])])) {
          if (first[part][k] !== v[part][k]) F(`convergence:${part}`, `${k}: A=${(first[part][k] ?? 'missing').slice(0, 160)} ${other}=${(v[part][k] ?? 'missing').slice(0, 160)}`);
        }
      }
      if (first.folders !== v.folders) F('convergence:noteFolders', `A=${first.folders.slice(0, 200)} ${other}=${v.folders.slice(0, 200)}`);
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
        if (!n) { if (!list.some((x) => x.kind === 'purge')) F('no-loss:note', `note ${id.slice(0, 8)} missing on ${this.devices[i].name} (last written on ${last.dev} at #${last.step})`); continue; }
        const t = tokensIn(JSON.parse(n).html || '')[0] || null;
        if (lastText && !ok.has(t)) F('no-loss:note', `note ${id.slice(0, 8)} on ${this.devices[i].name} holds ${t}, its last text was ${lastText.text} (#${lastText.step} on ${lastText.dev})`);
        else if (lastText && t !== lastText.text && i === 0) this.soft.push(`note ${id.slice(0, 8)}: its last text ${lastText.text} (#${lastText.step} on ${lastText.dev}) gave way to ${t}, from a later rename, move or trash on a device that held it (last writer wins)`);
      }
    }
    // Settings: the later change wins, key by key (first meetings included: Settings take the later change there too), so
    // each key ends as its last change left it. Switching accounts A→B→A brings older Settings back (a known limit).
    for (const [k, x] of this.settings) {
      const got = this.devices[0].disk.sync.get(k);
      if (got !== x.v && !this.accounts) F('lww:settings', `${k} is ${got ?? 'missing'} everywhere, its last change was ${x.v} (#${x.step} on ${x.dev})`);
    }
    // Every picture a note shows is on each device that holds the note.
    for (const dev of this.devices) {
      for (const [id, n] of Object.entries(this.noteIdx(dev).notes)) {
        for (const fid of N.refs(this.noteHtml(dev, id) || '')) {
          if (!dev.disk.notesdb.has(`files\u0000${SITE}/${fid}`) || !dev.disk.notesdb.has(`blobs\u0000${SITE}/${fid}`)) F('no-loss:note-file', `${dev.name}: note ${id.slice(0, 8)} shows picture ${fid.slice(0, 8)}, which isn't there${n.del ? ' (note in Trash)' : ''}`);
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
    if (op.kill) plainer.push((({ kill, apply, ...x }) => x)(op));
    if (op.inject) plainer.push((({ inject, ...x }) => x)(op));
    for (const p of plainer) { const next = [...list]; next[i] = p; if (await fails(next)) { list = next; break; } }
  }
  return list;
};

module.exports = { rng, canon, sha, network, Device, World, generate, describe, play, shrink, KNOWN, ACCOUNTS, TOKENS, FIRST, prelude, START };
