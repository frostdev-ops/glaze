// Documents' files: a PDF's or a deck's bytes (lib/doc-kinds.js), kept by the worker in its own IndexedDB, glaze-docs
// (lib/background.js), by their SHA-256. writer.html in a school's page (whose IndexedDB the site around it partitions),
// papers.html and Settings' backup reach them over a runtime port (PORT), in chunks of CHUNK bytes, each sent as base64
// and acknowledged before the next (Safari's message size is the tightest), so neither side holds more than the one copy
// it is building. A record points at its file as { hash, size, type } (lib/writer-papers.js); the worker keeps, per
// document, the hashes its record and versions point at (owners), and a file goes once no document points at it. One
// object store, string keys: f:<hash> a file (its chunks' id and count, its owners), c:<id>:<n> a chunk, u:<id> an upload
// under way, o:<document> the hashes a document holds.
// Classic script for the worker and the pages; module.exports for node.
var GZ_DOC_FILES = globalThis.GZ_DOC_FILES || (() => {
  const PORT = 'glaze:docFiles';
  const CHUNK = 384 << 10; // 512 KB as base64
  // The largest file (lib/doc-kinds.js FILE; test/doc-files.test.js holds them equal) and what a record held inline before
  // the store (its base64 within the record's 4 MB), which a record may still hold, and a browser without the store writes.
  const MAX = 50e6, LEGACY = 3e6;
  // An upload, or a file nothing points at, stays this long before a sweep takes it: a restore uploads before it commits.
  // A file put in the last HOLD (an import whose record is on its way, the same bytes as one going) never goes at once.
  const GRACE = 864e5, HOLD = 10 * 60e3;
  const HASH = /^[0-9a-f]{64}$/;
  const TYPES = { pdf: 'application/pdf', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow' };
  const typeOf = (rec) => (rec?.kind === 'pdf' ? TYPES.pdf : TYPES[rec?.ext] || TYPES['.pptx']);
  const fail = (why) => Object.assign(new Error(`file ${why}`), { why });
  const WHY = new Set(['missing', 'quota', 'unavailable', 'interrupted', 'size', 'bad']);
  // An error as one of WHY: a refused write for room is 'quota'; anything else IndexedDB throws, 'unavailable'.
  const why = (e) => (WHY.has(e?.why) ? e.why : e?.name === 'QuotaExceededError' || e?.inner?.name === 'QuotaExceededError' ? 'quota' : 'unavailable');
  const ref = (f) => !!f && typeof f === 'object' && !Array.isArray(f) && HASH.test(f.hash) && Number.isSafeInteger(f.size) && f.size > 0 && f.size <= MAX && typeof f.type === 'string' && f.type.length <= 200;
  const same = (a, b) => a === b || (ref(a) && ref(b) && a.hash === b.hash && a.size === b.size);
  // The hashes records, versions or lists of them point at.
  const refsOf = (...values) => {
    const out = new Set();
    const add = (v) => { if (ref(v?.file)) out.add(v.file.hash); };
    for (const v of values) if (Array.isArray(v)) v.forEach(add); else add(v);
    return out;
  };

  const b64 = (bytes) => {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => {
    if (typeof s !== 'string' || s.length > 4 * Math.ceil(CHUNK / 3)) throw fail('bad');
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  // ---- SHA-256 over chunks as they come (WebCrypto's digest wants the whole file at once)
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
    0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const sha256 = () => {
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64), tail = new Uint8Array(64);
    let fill = 0, total = 0;
    const block = (b, o) => {
      for (let t = 0; t < 16; t++, o += 4) W[t] = (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
      for (let t = 16; t < 64; t++) {
        const x = W[t - 15], y = W[t - 2];
        W[t] = (((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)) + W[t - 7] + (((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)) + W[t - 16];
      }
      let a = H[0], b2 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let t = 0; t < 64; t++) {
        const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[t] + W[t]) | 0;
        const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b2) ^ (a & c) ^ (b2 & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b2; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    };
    return {
      update(bytes) {
        let i = 0;
        total += bytes.length;
        if (fill) {
          i = Math.min(64 - fill, bytes.length);
          tail.set(bytes.subarray(0, i), fill); fill += i;
          if (fill < 64) return;
          block(tail, 0); fill = 0;
        }
        for (; i + 64 <= bytes.length; i += 64) block(bytes, i);
        if (i < bytes.length) { tail.set(bytes.subarray(i), 0); fill = bytes.length - i; }
      },
      hex() {
        const bits = total * 8, end = new Uint8Array(fill + 9 <= 64 ? 64 - fill : 128 - fill);
        end[0] = 0x80;
        const v = new DataView(end.buffer);
        v.setUint32(end.length - 8, Math.floor(bits / 2 ** 32)); v.setUint32(end.length - 4, bits >>> 0);
        this.update(end);
        return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
      },
    };
  };
  const digest = (bytes) => { const s = sha256(); s.update(bytes); return s.hex(); };

  // ---- IndexedDB, one object store, each call one transaction: the store's own steps are ordered so a stop between
  // any two leaves nothing a record points at gone (a file's entry before its chunks, a document's owners after its
  // record). A request's result is read once its transaction completes.
  const idb = (factory = globalThis.indexedDB, name = 'glaze-docs', Range = globalThis.IDBKeyRange) => {
    let db = null;
    const open = () => (db ||= new Promise((res, rej) => {
      let r;
      try { r = factory.open(name, 1); } catch (e) { rej(Object.assign(fail('unavailable'), { inner: e })); return; }
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); db = null; }; res(r.result); };
      r.onerror = () => rej(Object.assign(fail('unavailable'), { inner: r.error }));
    }).catch((e) => { db = null; throw e; }));
    const tx = async (mode, fn) => {
      const d = await open();
      let t;
      try { t = d.transaction('files', mode); } catch (e) { db = null; throw Object.assign(fail('unavailable'), { inner: e }); }
      const out = fn(t.objectStore('files'));
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(Object.assign(fail(t.error?.name === 'QuotaExceededError' ? 'quota' : 'unavailable'), { inner: t.error })); });
      return out();
    };
    const range = (prefix) => Range.bound(prefix, `${prefix}￿`);
    return {
      get: (k) => tx('readonly', (st) => { const r = st.get(k); return () => r.result; }),
      many: (ks) => tx('readonly', (st) => { const rs = ks.map((k) => st.get(k)); return () => rs.map((r) => r.result); }),
      keys: (prefix) => tx('readonly', (st) => { const r = st.getAllKeys(range(prefix)); return () => r.result; }),
      entries: (prefix) => tx('readonly', (st) => { const a = st.getAllKeys(range(prefix)), b = st.getAll(range(prefix)); return () => a.result.map((k, i) => [k, b.result[i]]); }),
      write: (puts = [], dels = []) => tx('readwrite', (st) => { for (const [k, v] of puts) st.put(v, k); for (const k of dels) st.delete(k); return () => undefined; }),
    };
  };

  // ---- the worker's store. db: idb() or a test's; now: the clock.
  const store = (db, { now = () => Date.now() } = {}) => {
    let turn = Promise.resolve();
    const serial = (fn) => { const p = turn.then(fn, fn); turn = p.catch(() => {}); return p; };
    const uploads = new Map();
    const chunkKey = (id, n) => `c:${id}:${String(n).padStart(6, '0')}`;
    const dropChunks = async (id) => { const ks = await db.keys(`c:${id}:`); if (ks.length) await db.write([], ks); };
    const begin = ({ size, type } = {}) => serial(async () => {
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX) throw fail('size');
      const id = `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      await db.write([[`u:${id}`, { at: now(), size }]]);
      uploads.set(id, { size, type: typeof type === 'string' ? type.slice(0, 200) : '', got: 0, n: 0, hash: sha256() });
      return id;
    });
    // bytes: a chunk of its own (never a view into a larger buffer: IndexedDB would keep the whole buffer).
    const chunk = (id, bytes) => serial(async () => {
      const u = uploads.get(id);
      if (!u) throw fail('interrupted');
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > CHUNK || u.got + bytes.length > u.size) throw fail('size');
      const own = bytes.byteOffset || bytes.byteLength !== bytes.buffer.byteLength ? bytes.slice() : bytes;
      await db.write([[chunkKey(id, u.n), own]]);
      u.hash.update(own); u.got += own.length; u.n++;
    });
    // → the file's ref. A file already kept (the same bytes) is kept once, its sweep clock reset.
    const end = (id) => serial(async () => {
      const u = uploads.get(id);
      if (!u) throw fail('interrupted');
      try {
        if (u.got !== u.size) throw fail('size');
        const hash = u.hash.hex(), have = await db.get(`f:${hash}`);
        if (have) { await db.write([[`f:${hash}`, { ...have, at: now() }]], [`u:${id}`]); await dropChunks(id); }
        else await db.write([[`f:${hash}`, { hash, size: u.size, type: u.type, id, n: u.n, at: now(), owners: [] }]], [`u:${id}`]);
        return { hash, size: u.size, type: u.type };
      } catch (e) {
        await db.write([], [`u:${id}`]).catch(() => {});
        await dropChunks(id).catch(() => {});
        throw e;
      } finally { uploads.delete(id); }
    });
    const abort = (id) => serial(async () => { if (!uploads.delete(id)) return; await db.write([], [`u:${id}`]); await dropChunks(id); });
    // Whole bytes the worker holds (a record's base64 moving over): put in chunks of their own.
    const put = async (bytes, type) => {
      const id = await begin({ size: bytes?.length, type });
      try { for (let at = 0; at < bytes.length; at += CHUNK) await chunk(id, bytes.slice(at, at + CHUNK)); }
      catch (e) { await abort(id).catch(() => {}); throw e; }
      return end(id);
    };
    const stat = async (hash) => { if (!HASH.test(hash)) return null; const f = await db.get(`f:${hash}`); return f ? { hash, size: f.size, type: f.type } : null; };
    // Each chunk in order to each(bytes), awaited before the next is read. A file gone, or not whole, is 'missing'.
    const read = async (hash, each) => {
      const f = HASH.test(hash) ? await db.get(`f:${hash}`) : null;
      if (!f) throw fail('missing');
      let got = 0;
      const check = sha256();
      for (let n = 0; n < f.n; n++) {
        const c = await db.get(chunkKey(f.id, n));
        if (!(c instanceof Uint8Array) || (got += c.length) > f.size) throw fail('missing');
        check.update(c);
        await each(c, n);
      }
      if (got !== f.size || check.hex() !== hash) throw fail('missing');
      return { hash, size: f.size, type: f.type };
    };
    // The hashes document `owner` points at now (its record and versions). A file it no longer points at, and no other
    // document does, goes. add: only those joining (before a record points at them: a refusal then refuses the save, so
    // no record points at a file it doesn't own). → { missing: the hashes it points at that aren't kept }.
    const own = (owner, hashes, { add = false } = {}) => serial(async () => {
      if (typeof owner !== 'string' || !owner) throw fail('bad');
      const was = (await db.get(`o:${owner}`)) || [], next = [...new Set([...(add ? was : []), ...hashes])].filter((h) => HASH.test(h));
      const all = [...new Set([...was, ...next])], metas = all.length ? await db.many(all.map((h) => `f:${h}`)) : [];
      const puts = [], dels = [], dead = [], missing = [];
      all.forEach((h, i) => {
        const f = metas[i], wanted = next.includes(h);
        if (!f) { if (wanted) missing.push(h); return; }
        const owners = new Set(f.owners || []), had = owners.has(owner);
        if (wanted) owners.add(owner); else owners.delete(owner);
        if (!wanted && !owners.size && !(now() - (f.at || 0) < HOLD)) { dels.push(`f:${h}`); dead.push(f.id); }
        else if (had !== wanted) puts.push([`f:${h}`, { ...f, owners: [...owners] }]);
      });
      if (next.length) { if (JSON.stringify(next) !== JSON.stringify(was)) puts.push([`o:${owner}`, next]); } else if (was.length) dels.push(`o:${owner}`);
      if (puts.length || dels.length) await db.write(puts, dels);
      for (const id of dead) await dropChunks(id);
      return { missing };
    });
    // What a stopped worker or an abandoned upload left: uploads older than GRACE and chunks no file or upload names; with
    // live (every hash every record and version points at, read whole), files no document has owned for GRACE that none
    // of them points at. → how many files went.
    const sweep = ({ live = null } = {}) => serial(async () => {
      const t = now(), files = await db.entries('f:'), ups = await db.entries('u:'), keep = new Set();
      let gone = 0;
      for (const [k, u] of ups) { const id = k.slice(2); if (uploads.has(id) || !(t - (u?.at || 0) > GRACE)) keep.add(id); else await db.write([], [k]); }
      for (const [k, f] of files) {
        if (live && !(f.owners || []).length && !live.has(f.hash) && t - (f.at || 0) > GRACE) { await db.write([], [k]); gone++; } else keep.add(f.id);
      }
      const stray = (await db.keys('c:')).filter((k) => !keep.has(k.split(':')[1]));
      if (stray.length) await db.write([], stray);
      return gone;
    });
    return { begin, chunk, end, abort, put, stat, read, own, sweep };
  };

  // ---- the worker's end of a port: one transfer each. put: { op: 'put', size, type } → { ready }; { op: 'chunk', data }
  // → { ack } each; { op: 'end' } → { file }. get: { op: 'get', hash } → { data } each, answered { op: 'ack' }, then
  // { done, file }. stat: { op: 'stat', hash } → { file } or { file: null }. Any failure: { error: WHY }, and the port
  // closes. allowed: whether the sender may (a promise), settled before anything runs.
  const serve = (port, st, allowed = Promise.resolve(true)) => {
    let up = null, ack = null, closed = false;
    const say = (m) => { if (!closed) port.postMessage(m); };
    const close = () => { if (closed) return; closed = true; try { port.disconnect(); } catch { /* gone */ } };
    let queue = Promise.resolve(allowed).then((ok) => { if (!ok) { close(); throw fail('bad'); } }, () => { close(); throw fail('bad'); });
    queue.catch(() => {});
    port.onDisconnect.addListener(() => { closed = true; ack?.(false); if (up) st.abort(up).catch(() => {}); up = null; });
    const run = async (m) => {
      if (closed) return;
      if (m?.op === 'put') {
        if (up) throw fail('bad');
        const id = await st.begin({ size: m.size, type: m.type });
        if (closed) { await st.abort(id); return; }
        up = id;
        say({ ready: true });
      } else if (m?.op === 'chunk') {
        if (!up) throw fail('interrupted');
        await st.chunk(up, unb64(m.data));
        say({ ack: true });
      } else if (m?.op === 'end') {
        if (!up) throw fail('interrupted');
        const id = up;
        up = null;
        say({ file: await st.end(id) });
      } else if (m?.op === 'get') {
        const file = await st.read(m.hash, async (c) => {
          say({ data: b64(c) });
          if (!await new Promise((r) => { ack = r; })) throw fail('interrupted');
          ack = null;
        });
        say({ done: true, file });
      } else if (m?.op === 'stat') say({ file: await st.stat(m.hash) });
      else throw fail('bad');
    };
    port.onMessage.addListener((m) => {
      if (m?.op === 'ack') { ack?.(true); return; }
      queue = queue.then(() => run(m)).catch((e) => {
        if (up) { st.abort(up).catch(() => {}); up = null; }
        say({ error: why(e) });
        close();
        queue = Promise.reject(e);
        queue.catch(() => {});
      });
    });
  };

  // ---- a page's end. connect: a new port to the worker. → { put, get, stat }; each throws an error with why (WHY).
  const client = (connect = () => chrome.runtime.connect({ name: PORT })) => {
    const session = () => {
      let port;
      try { port = connect(); } catch { throw fail('unavailable'); }
      const inbox = [];
      let wake = null, gone = false;
      port.onMessage.addListener((m) => { inbox.push(m); wake?.(); });
      port.onDisconnect.addListener(() => { gone = true; wake?.(); });
      const next = async () => {
        while (!inbox.length) { if (gone) throw fail('interrupted'); await new Promise((r) => { wake = r; }); wake = null; }
        const m = inbox.shift();
        if (m?.error) throw fail(WHY.has(m.error) ? m.error : 'unavailable');
        return m;
      };
      const send = (m) => { if (gone) throw fail('interrupted'); try { port.postMessage(m); } catch { throw fail('interrupted'); } };
      return { send, next, close: () => { if (gone) return; gone = true; try { port.disconnect(); } catch { /* gone */ } } };
    };
    // bytes (Uint8Array) → the kept file's ref, each chunk encoded as it is sent.
    const put = async (bytes, type = '') => {
      if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX) throw fail('size');
      const s = session();
      try {
        s.send({ op: 'put', size: bytes.length, type: String(type).slice(0, 200) });
        await s.next();
        for (let at = 0; at < bytes.length; at += CHUNK) { s.send({ op: 'chunk', data: b64(bytes.subarray(at, at + CHUNK)) }); await s.next(); }
        s.send({ op: 'end' });
        const { file } = await s.next();
        if (!ref(file) || file.size !== bytes.length) throw fail('unavailable');
        return file;
      } finally { s.close(); }
    };
    // A ref → its bytes, each chunk decoded into the one buffer the file is.
    const get = async (file) => {
      if (!ref(file)) throw fail('missing');
      const s = session(), out = new Uint8Array(file.size);
      let at = 0;
      try {
        s.send({ op: 'get', hash: file.hash });
        for (;;) {
          const m = await s.next();
          if (m.done) break;
          const part = unb64(m.data);
          if (at + part.length > out.length) throw fail('missing');
          out.set(part, at); at += part.length;
          s.send({ op: 'ack' });
        }
        if (at !== out.length) throw fail('missing');
        return out;
      } finally { s.close(); }
    };
    const stat = async (hash) => { const s = session(); try { s.send({ op: 'stat', hash }); return (await s.next()).file || null; } finally { s.close(); } };
    return { put, get, stat };
  };

  return { PORT, CHUNK, MAX, LEGACY, GRACE, HOLD, TYPES, typeOf, ref, same, refsOf, b64, unb64, digest, sha256, idb, store, serve, client, why, fail };
})();

if (typeof module !== 'undefined') module.exports = GZ_DOC_FILES;
