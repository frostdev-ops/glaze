// The local model's weights in OPFS (navigator.storage.getDirectory()), for Glaze's own engine. A model comes from
// ai/local/models.json (tools/vendor/model-manifest.js writes it): a Hugging Face file pinned to a commit, its size and the
// SHA-256 of each 64 MB chunk. download() fetches it by Range from huggingface.co's resolve URL, which redirects to HF's
// CDN, on the student's click only. Each chunk is checked before the next starts and kept as its own file, so a
// cancelled or killed download resumes from its verified chunks (a writable commits on close; rewriting one 1 GB file in
// place would copy it on every chunk). The folder is named by the file's hash, so another version never mixes in; an
// empty `ready` file marks it complete. open() reads byte ranges, never the whole file.
// Model updates (docs/ai-harness.md "Model updates"; ai/local/updates.js): an id names a model's place (a size of Rime),
// and a newer version of it keeps the id. The state file beside the models (TOP/~updates.json, written by edit() under the
// Web Lock STATE_LOCK) holds the accepted signed list's entries, the version each downloaded id stays on until a swap
// (pins), versions kept beside it (keep: a download in progress, or the old one until the new one has answered), the trial
// and the versions that failed. compose() makes the catalog from models.json and that file: entries (each id's version in
// use), spares (kept versions) and latest (the version each id should run). A version is its own tag folder.
// Plain script for the worker, an extension page or a Worker; node exports.
var GZ_AI_STORE = globalThis.GZ_AI_STORE || (() => {
  const TOP = 'glaze-models';
  const HEX = /^[0-9a-f]{64}$/;
  const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  const STALL = 60000; // no bytes for this long: the network is gone
  const STATE = '~updates.json', STATE_LOCK = 'glaze-model-updates'; // never an id: ID starts with a letter or digit
  const SHOW = 1 << 20; // progress at most once a MB, or a sixteenth of a smaller chunk

  const fail = (reason, message, extra) => Object.assign(new Error(message), { reason, ...extra });
  const aborted = () => fail('aborted', 'The download was cancelled');
  const removed = () => fail('removed', 'The model was removed');
  // Why a job's signal fired: the error it was aborted with (removed), else a cancel.
  const why = (signal) => (signal?.reason?.reason ? signal.reason : aborted());
  const gone = (e) => e?.name === 'NotFoundError' || e?.name === 'TypeMismatchError';
  const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  const len = (m, i) => Math.min(m.chunk, m.size - i * m.chunk);
  const tag = (m) => `${m.total.slice(0, 16)}-${m.chunk}`;

  // huggingface.co and its CDN hosts, over https on the default port.
  const allowedHost = (u) => {
    let url;
    try { url = new URL(u); } catch { return false; }
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    const h = url.hostname;
    return h === 'huggingface.co' || h.endsWith('.hf.co') || /^cdn-lfs[a-z0-9-]*\.huggingface\.co$/.test(h);
  };

  const path = /^[\w.-]+(\/[\w.-]+)*$/;
  const valid = (m) => !!m && typeof m === 'object' && typeof m.id === 'string' && ID.test(m.id)
    && typeof m.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(m.repo) && typeof m.file === 'string' && path.test(m.file)
    && !/(^|\/)\.+(\/|$)/.test(`${m.repo}/${m.file}`)
    && typeof m.commit === 'string' && /^[0-9a-f]{40}$/.test(m.commit)
    && m.url === `https://huggingface.co/${m.repo}/resolve/${m.commit}/${m.file}`
    && Number.isSafeInteger(m.size) && m.size > 0 && Number.isSafeInteger(m.chunk) && m.chunk > 0 && m.chunk <= 268435456
    && Array.isArray(m.sha256) && m.sha256.length === Math.ceil(m.size / m.chunk) && m.sha256.every((h) => typeof h === 'string' && HEX.test(h))
    && typeof m.total === 'string' && HEX.test(m.total)
    // The picture download's files: its language model (role pictures, naming its projector) and the projector.
    && (m.role === undefined || m.role === 'projector' ? m.projector === undefined : m.role === 'pictures' && typeof m.projector === 'string' && ID.test(m.projector));

  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const freeze = (m) => Object.freeze({ ...m, sha256: Object.freeze([...m.sha256]) });
  // The catalog from models.json's entries and the state file (null: models.json alone). A list entry is a text model
  // (a tier, no role) and never takes a tier a shipped model holds under another id, or moves a shipped id to another
  // tier; one whose whole hash failed (failed) is never offered. → { entries, spares, latest, state }, each a Map by id
  // (spares: id → [versions kept beside the one in use]).
  const compose = (bundled, st) => {
    const entries = new Map(), spares = new Map();
    for (const m of bundled || []) if (valid(m) && !entries.has(m.id)) entries.set(m.id, freeze(m));
    if (!isObj(st)) return { entries, spares, latest: new Map(entries), state: null };
    const failed = isObj(st.failed) ? st.failed : {};
    const base = new Map(entries), tiers = new Map();
    for (const m of base.values()) if (!m.role) tiers.set(m.tier, m.id);
    const text = (m) => valid(m) && m.role === undefined && Number.isSafeInteger(m.tier) && m.tier > 0;
    // Where a shipped id is, a list's or pin's version must keep its tier; a new id must take a tier no shipped id holds.
    const fits = (m) => (base.has(m.id) ? !base.get(m.id).role && base.get(m.id).tier === m.tier : !tiers.has(m.tier) || tiers.get(m.tier) === m.id);
    for (const m of Array.isArray(st.models) ? st.models : []) {
      if (!text(m) || !fits(m) || Object.hasOwn(failed, m.total) || (!base.has(m.id) && entries.has(m.id))) continue;
      entries.set(m.id, freeze(m));
      tiers.set(m.tier, m.id);
    }
    const latest = new Map(entries);
    for (const [id, m] of Object.entries(isObj(st.pins) ? st.pins : {})) if (text(m) && m.id === id && fits(m) && (entries.has(id) ? entries.get(id).tier === m.tier : !tiers.has(m.tier))) entries.set(id, freeze(m));
    for (const [id, list] of Object.entries(isObj(st.keep) ? st.keep : {})) {
      const use = entries.get(id);
      if (!use || !Array.isArray(list)) continue;
      const kept = list.filter((m) => text(m) && m.id === id && m.tier === use.tier && m.total !== use.total).map(freeze);
      if (kept.length) spares.set(id, kept);
    }
    return { entries, spares, latest, state: st };
  };

  // SHA-256 over many buffers (WebCrypto's digest takes one): the whole file's hash, chunk by chunk.
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
    0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
    0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138,
    0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624,
    0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
    0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
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

  const anySignal = (signals) => {
    if (AbortSignal.any) return AbortSignal.any(signals);
    const c = new AbortController();
    for (const s of signals) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
    return c.signal;
  };

  // models: the entries, or a function giving them; left out, the shipped models.json. The rest stand in for the
  // browser's in tests. Every context of the extension (the worker, pages, Workers) may hold a store over the same OPFS:
  // a model's writes (download, verify, remove) take the origin's Web Lock for it, asked for when they're called, so the
  // lock's queue orders them across contexts. Each remove raises the model's removal generation (kept in OPFS, changed
  // only under the lock) and tells the other contexts, over a BroadcastChannel, to stop downloads up to the generation it
  // read; a download reads its generation holding the lock and stops, without reporting ready, if a remove says so.
  const create = ({ models, fetch: get, root, estimate, subtle, locks, channel } = {}) => {
    get ||= (...a) => globalThis.fetch(...a);
    root ||= () => navigator.storage.getDirectory();
    estimate ||= () => navigator.storage.estimate();
    if (locks === undefined) locks = globalThis.navigator?.locks || null;
    if (channel === undefined) channel = typeof BroadcastChannel === 'function' ? () => new BroadcastChannel('glaze-models') : null;
    const digest = (b) => (subtle || globalThis.crypto.subtle).digest('SHA-256', b);
    const jobs = new Map(); // id (a kept version's: id@total) → the download in progress, shared by its callers
    const jobsOf = (id) => [...jobs].filter(([k]) => k === id || k.startsWith(`${id}@`));
    const queue = new Map(); // id → the last of the writes to its folder, where there are no Web Locks

    // Stop this store's download of `id`, its callers told `err`'s reason.
    const cancel = (id, err) => {
      for (const [k, job] of jobsOf(id)) { jobs.delete(k); job.controller.abort(err); }
    };
    let bus = null;
    const tell = () => {
      if (!bus && channel) {
        bus = channel();
        bus.onmessage = (e) => {
          const d = e?.data;
          if (d?.type === 'catalog') { catalog = null; return; } // another context changed the state file
          if (d?.type !== 'remove' || typeof d.id !== 'string' || !Number.isSafeInteger(d.upto)) return;
          for (const [k, job] of jobsOf(d.id)) {
            if (job.gen === null) job.cut = Math.max(job.cut, d.upto); // not yet read: checked when it is
            else if (job.gen <= d.upto) { jobs.delete(k); job.controller.abort(removed()); }
          }
        };
        bus.unref?.(); // node: never what keeps a process alive
      }
      return bus;
    };

    let catalog = null;
    // The state file, or null when there is none or it isn't one.
    const readState = async () => {
      try {
        const top = await (await root()).getDirectoryHandle(TOP);
        const st = JSON.parse(await (await (await top.getFileHandle(STATE)).getFile()).text());
        return isObj(st) && st.v === 1 ? st : null;
      } catch { return null; }
    };
    const load = () => (catalog ||= (async () => {
      tell(); // hear other contexts' state changes
      let list = typeof models === 'function' ? await models() : models;
      if (!list) list = await (await globalThis.fetch(new URL('/ai/local/models.json', globalThis.location.origin).href)).json();
      if (list && !Array.isArray(list)) list = list.models;
      return compose(list, await readState());
    })().catch((e) => { catalog = null; throw e; }));
    const model = async (id) => {
      const m = (await load()).entries.get(id);
      if (!m) throw fail('unknown', `No model ${JSON.stringify(id)}`);
      return m;
    };
    // The version of `id` with whole hash `total`: the one in use, or one kept beside it. Left out, the one in use.
    const version = async (id, total) => {
      if (total === undefined) return model(id);
      const c = await load(), use = c.entries.get(id);
      const m = use?.total === total ? use : (c.spares.get(id) || []).find((x) => x.total === total);
      if (!m) throw fail('unknown', `No version ${String(total).slice(0, 16)} of ${JSON.stringify(id)}`);
      return m;
    };
    // The tag folders of `id` a download must leave: its version in use and the ones kept.
    const keeps = async (id) => { const c = await load(); return new Set([c.entries.get(id), ...(c.spares.get(id) || [])].filter(Boolean).map(tag)); };

    const exclusive = (id, fn) => {
      const run = (queue.get(id) || Promise.resolve()).then(fn);
      const tail = run.catch(() => {});
      queue.set(id, tail);
      tail.then(() => { if (queue.get(id) === tail) queue.delete(id); });
      return run;
    };
    // fn, holding the model's lock. A signal ends the wait for it with the signal's reason.
    const held = (id, signal, fn) => {
      const run = () => { if (signal?.aborted) throw why(signal); return fn(); };
      if (!locks) return exclusive(id, run);
      return locks.request(`glaze-model:${id}`, signal ? { signal } : {}, run).catch((e) => { throw signal?.aborted ? why(signal) : e; });
    };
    // The model's removal generation: `~<id>~<n>`, an empty file beside the models; 0 before any remove.
    const stamp = (id) => `~${id}~`;
    const generation = async (id) => {
      let top, n = 0;
      try { top = await (await root()).getDirectoryHandle(TOP); } catch (e) { if (gone(e)) return 0; throw e; }
      for await (const name of top.keys()) {
        if (!name.startsWith(stamp(id))) continue;
        const g = Number(name.slice(stamp(id).length));
        if (Number.isSafeInteger(g) && g > n) n = g;
      }
      return n;
    };

    const folder = async (m, create) => {
      try {
        const top = await (await root()).getDirectoryHandle(TOP, { create });
        const own = await top.getDirectoryHandle(m.id, { create });
        return { own, dir: await own.getDirectoryHandle(tag(m), { create }) };
      } catch (e) { if (!create && gone(e)) return null; throw e; }
    };

    // Which chunks the folder holds whole, their files, the bytes they make, and whether it was marked complete.
    const scan = async (m, dir) => {
      const have = [], exists = [], files = [];
      let bytes = 0, ready = false;
      for (let i = 0; i < m.sha256.length; i++) {
        let f = null;
        try { f = await (await dir.getFileHandle(String(i))).getFile(); } catch (e) { if (!gone(e)) throw e; }
        exists[i] = !!f; have[i] = !!f && f.size === len(m, i); files[i] = f;
        if (have[i]) bytes += f.size;
      }
      try { await dir.getFileHandle('ready'); ready = true; } catch (e) { if (!gone(e)) throw e; }
      return { have, exists, files, bytes, ready };
    };
    const state = (s) => (s.ready ? (s.have.every(Boolean) ? { state: 'ready' } : { state: 'corrupt' })
      : s.bytes ? { state: 'partial', bytes: s.bytes } : { state: 'missing' });

    // → { state: 'missing' | 'partial' (with bytes) | 'ready' | 'corrupt' }, from the files' sizes. total: a kept version's.
    const status = async (id, { total } = {}) => {
      const m = await version(id, total);
      const f = await folder(m, false);
      return f ? state(await scan(m, f.dir)) : { state: 'missing' };
    };

    // Rehash every kept chunk; one that fails is dropped (download() fetches it again). → 'corrupt' if any was, else status.
    const verify = async (id) => {
      const m = await model(id);
      return held(id, null, async () => {
        const f = await folder(m, false);
        if (!f) return { state: 'missing' };
        const s = await scan(m, f.dir);
        let bad = s.ready && !s.have.every(Boolean);
        for (let i = 0; i < s.have.length; i++) {
          if (!s.have[i]) { if (s.exists[i]) { await f.dir.removeEntry(String(i)); bad = true; } continue; }
          if (hex(await digest(await s.files[i].arrayBuffer())) !== m.sha256[i]) { await f.dir.removeEntry(String(i)); bad = true; }
        }
        if (!bad) return state(s);
        if (s.ready) await f.dir.removeEntry('ready');
        return { state: 'corrupt' };
      });
    };

    const room = async () => {
      let e = null;
      try { e = await estimate(); } catch { /* unknown */ }
      return e && Number.isFinite(e.quota) && Number.isFinite(e.usage) ? Math.max(0, e.quota - e.usage) : null;
    };

    // Chunk i, by Range from the pinned resolve URL (its signed CDN address expires, so never kept): exactly its bytes
    // from huggingface.co or its CDN, no cookies, no cache.
    const fetchChunk = async (m, i, signal, progress) => {
      const from = i * m.chunk, want = len(m, i), to = from + want - 1;
      const stall = new AbortController();
      let timer;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => stall.abort(), STALL); };
      const both = anySignal([signal, stall.signal]);
      const lost = (e) => (signal.aborted ? why(signal) : e?.reason ? e : fail('network', 'The download lost its connection', e ? { cause: e } : {}));
      arm();
      try {
        let r;
        try {
          r = await get(m.url, { headers: { Range: `bytes=${from}-${to}` }, credentials: 'omit', cache: 'no-store', redirect: 'follow',
            referrerPolicy: 'no-referrer', mode: 'cors', signal: both });
        } catch (e) { throw lost(e); }
        const drop = () => { try { r.body?.cancel?.().catch(() => {}); } catch { /* gone */ } };
        if (typeof r.url !== 'string' || !allowedHost(r.url)) { drop(); throw fail('redirect', 'The download went to a host other than Hugging Face'); }
        if (r.status !== 206 || r.headers.get('content-range') !== `bytes ${from}-${to}/${m.size}`) {
          drop(); throw fail('server', `Hugging Face answered ${r.status} for bytes ${from}-${to}`, { status: r.status });
        }
        const buf = new Uint8Array(want);
        const reader = r.body.getReader();
        let at = 0, shown = 0;
        const step = Math.min(SHOW, Math.ceil(want / 16));
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (at + value.length > want) throw fail('server', 'Hugging Face sent more than the range asked for');
            buf.set(value, at); at += value.length; arm();
            if (at - shown >= step) { shown = at; progress(at); }
            if (at === want) { reader.cancel().catch(() => {}); break; } // all here: a cancel now mustn't lose it
          }
        } catch (e) { reader.cancel().catch(() => {}); throw lost(e); }
        if (at !== want) throw lost();
        return buf;
      } finally { clearTimeout(timer); }
    };

    const write = async (dir, name, body) => {
      const h = await dir.getFileHandle(name, { create: true });
      let w;
      try { w = await h.createWritable({ keepExistingData: false }); await w.write(body); await w.close(); }
      catch (e) {
        try { await w?.abort(); } catch { /* closed */ }
        try { await dir.removeEntry(name); } catch { /* never made */ }
        throw e;
      }
    };

    // pause(signal): awaited before each chunk (a background update waits while the model runs). whole: the file's own
    // SHA-256 must be m.total before it is marked ready; if not, its chunks go (reason hash, whole).
    const fetchAll = async (m, signal, say, { pause, whole } = {}) => {
      const { own, dir } = await folder(m, true);
      const others = [], keep = await keeps(m.id);
      for await (const name of own.keys()) if (name !== tag(m) && !keep.has(name)) others.push(name);
      for (const name of others) await own.removeEntry(name, { recursive: true });
      const s = await scan(m, dir);
      if (s.ready && s.have.every(Boolean)) { say(1); return { state: 'ready' }; }
      if (s.ready) await dir.removeEntry('ready');
      for (let i = 0; i < s.have.length; i++) if (s.exists[i] && !s.have[i]) await dir.removeEntry(String(i));
      let kept = s.bytes;
      say(kept / m.size);
      const available = await room();
      if (available !== null && available < m.size - kept) throw fail('quota', 'Not enough space for the model', { needed: m.size - kept, available });
      for (let i = 0; i < s.have.length; i++) {
        if (s.have[i]) continue;
        if (signal.aborted) throw why(signal);
        if (pause) { await pause(signal); if (signal.aborted) throw why(signal); }
        let body;
        for (let attempt = 0; ; attempt++) {
          body = await fetchChunk(m, i, signal, (got) => say((kept + got) / m.size));
          if (hex(await digest(body)) === m.sha256[i]) break;
          if (attempt) throw fail('hash', `Chunk ${i} failed its check twice`, { chunk: i });
        }
        // A verified chunk is kept even if a cancel came while it was checked: resuming needn't fetch it again.
        try { await write(dir, String(i), body); }
        catch (e) {
          if (e?.name !== 'QuotaExceededError') throw e;
          throw fail('quota', 'Not enough space for the model', { needed: m.size - kept, available: (await room()) ?? 0 });
        }
        kept += len(m, i);
        say(kept / m.size);
      }
      if (whole) {
        const h = sha256();
        for (let i = 0; i < m.sha256.length; i++) {
          if (signal.aborted) throw why(signal);
          h.update(new Uint8Array(await (await (await dir.getFileHandle(String(i))).getFile()).arrayBuffer()));
        }
        if (h.hex() !== m.total) {
          for (let i = 0; i < m.sha256.length; i++) await dir.removeEntry(String(i));
          throw fail('hash', 'The file failed its whole-file check', { whole: true });
        }
      }
      await dir.getFileHandle('ready', { create: true });
      say(1);
      return { state: 'ready' };
    };

    // Registered before anything is awaited, so a remove that follows at once finds it. key: id, or id@total for a kept version.
    const start = (id, key, { total, pause, whole } = {}) => {
      const job = { listeners: new Set(), callers: 0, controller: new AbortController(), last: null, gen: null, cut: -1 };
      jobs.set(key, job);
      tell();
      const say = (p) => {
        p = Math.max(job.last ?? 0, Math.min(1, Math.max(0, p)));
        job.last = p;
        for (const f of job.listeners) try { f(p); } catch { /* a listener's own */ }
      };
      const { signal } = job.controller;
      // The lock is asked for now, so its queue orders this download against removes in every context; the generation is
      // read holding it. A remove queued behind it says so (its message, `cut`) before or while it runs.
      job.done = held(id, signal, async () => {
        job.gen = await generation(id);
        if (job.gen <= job.cut) throw removed();
        const r = await fetchAll(await version(id, total), signal, say, { pause, whole });
        if (signal.aborted) throw why(signal); // a remove during the last write: its files are going
        return r;
      }).finally(() => { if (jobs.get(key) === job) jobs.delete(key); });
      return job;
    };
    // A caller's cancel ends its own wait; the download stops when the last caller still waiting cancels.
    const join = (key, job, signal, onProgress) => new Promise((resolve, reject) => {
      const listen = typeof onProgress === 'function' ? onProgress : null;
      job.callers++;
      let settled = false;
      const finish = (f, v) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', stop); if (listen) job.listeners.delete(listen); f(v);
      };
      const stop = () => {
        finish(reject, aborted());
        if (--job.callers === 0) { if (jobs.get(key) === job) jobs.delete(key); job.controller.abort(); }
      };
      signal?.addEventListener('abort', stop, { once: true });
      // Progress so far, replayed once the cancel is heard: a listener that cancels on it is cancelled.
      if (listen) { job.listeners.add(listen); if (job.last !== null) try { listen(job.last); } catch { /* its own */ } }
      job.done.then((v) => finish(resolve, v), (e) => finish(reject, e));
    });

    // → { state: 'ready' }; or throws an Error whose `reason` is aborted, removed, network, hash (with chunk, or whole),
    // quota (with needed and available bytes), redirect, server or unknown. total: a version kept beside the one in use (a
    // background update's); pause and whole as fetchAll takes them, from the call that starts the download.
    const download = (id, { signal, onProgress, total, pause, whole } = {}) => {
      if (signal?.aborted) return Promise.reject(aborted());
      const key = total === undefined ? id : `${id}@${total}`;
      return join(key, jobs.get(key) || start(id, key, { total, pause, whole }), signal, onProgress);
    };

    // → { id, size, read(offset, length) → Promise<Uint8Array> } over a ready model.
    const open = async (id) => {
      const m = await model(id);
      const f = await folder(m, false);
      const s = f && await scan(m, f.dir);
      const now = s ? state(s) : { state: 'missing' };
      if (now.state !== 'ready') throw fail(now.state, `Model ${id} is not ready (${now.state})`);
      const files = s.files;
      const read = async (offset, length) => {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > m.size) {
          throw new RangeError(`read(${offset}, ${length}) outside 0..${m.size}`);
        }
        if (!length) return new Uint8Array(0);
        const first = Math.floor(offset / m.chunk), last = Math.floor((offset + length - 1) / m.chunk);
        const part = async (i) => {
          const base = i * m.chunk, a = Math.max(offset, base) - base, b = Math.min(offset + length, base + len(m, i)) - base;
          return [base + a - offset, new Uint8Array(await files[i].slice(a, b).arrayBuffer())];
        };
        if (first === last) return (await part(first))[1];
        const out = new Uint8Array(length);
        const parts = [];
        for (let i = first; i <= last; i++) parts.push(part(i));
        for (const [at, bytes] of await Promise.all(parts)) out.set(bytes, at);
        return out;
      };
      return { id, size: m.size, read };
    };

    // Frees a model's space. A download of it, here or in another context, ends with reason `removed` first. Any id
    // kept here, also one the manifest no longer offers.
    const remove = async (id) => {
      if (typeof id !== 'string' || !ID.test(id)) throw fail('unknown', `No model ${JSON.stringify(id)}`);
      cancel(id, removed());
      const bus = tell();
      if (bus) bus.postMessage({ type: 'remove', id, upto: await generation(id) });
      await held(id, null, async () => {
        const top = await (await root()).getDirectoryHandle(TOP, { create: true });
        const old = [];
        for await (const name of top.keys()) if (name.startsWith(stamp(id))) old.push(name);
        await top.getFileHandle(`${stamp(id)}${await generation(id) + 1}`, { create: true });
        for (const name of old) await top.removeEntry(name);
        try { await top.removeEntry(id, { recursive: true }); } catch (e) { if (!gone(e)) throw e; }
      });
      // Its versions are gone: the state forgets them (a download takes the newest again); the serial and failures stay.
      await edit((st) => {
        if (!st || !(st.pins?.[id] || st.keep?.[id] || st.trial?.id === id)) return undefined;
        const { [id]: _p, ...pins } = isObj(st.pins) ? st.pins : {}, { [id]: _k, ...keep } = isObj(st.keep) ? st.keep : {};
        return { ...st, pins, keep, trial: st.trial?.id === id ? null : st.trial ?? null };
      });
    };

    // A kept version's folder goes (the old one once the new has answered, or the new one rolled back); never the one in use.
    const drop = async (id, total) => {
      if (typeof id !== 'string' || !ID.test(id) || typeof total !== 'string' || !HEX.test(total)) throw fail('unknown', 'No such version');
      const use = (await load()).entries.get(id);
      if (use?.total === total) throw fail('in-use', 'That version is in use');
      cancel(`${id}@${total}`, removed());
      return held(id, null, async () => {
        let own;
        try { own = await (await (await root()).getDirectoryHandle(TOP)).getDirectoryHandle(id); } catch (e) { if (gone(e)) return; throw e; }
        const names = [];
        for await (const name of own.keys()) if (name.startsWith(`${total.slice(0, 16)}-`) && (!use || name !== tag(use))) names.push(name);
        for (const name of names) await own.removeEntry(name, { recursive: true });
      });
    };

    // The state file, changed: fn(state or null) → the new state, or undefined for no change; under the origin's lock, so
    // every context's changes apply in turn. Every store then reads its catalog again (this one now, others when told).
    const lockState = (fn) => (locks ? locks.request(STATE_LOCK, fn) : exclusive('~state', fn));
    const edit = (fn) => lockState(async () => {
      const cur = await readState();
      const next = await fn(cur ? structuredClone(cur) : null);
      if (next === undefined) return cur;
      if (!isObj(next) || next.v !== 1) throw new TypeError('not a state');
      const top = await (await root()).getDirectoryHandle(TOP, { create: true });
      await write(top, STATE, new TextEncoder().encode(JSON.stringify(next)));
      catalog = null;
      tell()?.postMessage({ type: 'catalog' });
      return next;
    });

    const used = async (h) => {
      if (h.kind === 'file') return (await h.getFile()).size;
      let n = 0;
      for await (const k of h.values()) n += await used(k);
      return n;
    };
    // The manifest's models with their status; then any model kept here that it no longer offers, as `stale` with its bytes.
    const list = async () => {
      const cat = (await load()).entries;
      const out = [];
      for (const m of cat.values()) {
        const { id, name, size, quant, tier, license, stock, role, projector, tools, version: v } = m;
        out.push({ id, name, size, quant, tier, license, ...(stock && { stock }), ...(role && { role }), ...(projector && { projector }), ...(Number.isSafeInteger(tools) && { tools }),
          ...(typeof v === 'string' && { version: v }), ...(await status(id)) });
      }
      let top = null;
      try { top = await (await root()).getDirectoryHandle(TOP); } catch (e) { if (!gone(e)) throw e; }
      if (top) {
        for await (const [name, h] of top.entries()) {
          if (h.kind !== 'directory' || cat.has(name)) continue;
          const bytes = await used(h);
          if (bytes) out.push({ id: name, state: 'stale', bytes });
        }
      }
      return out;
    };

    return { status, download, open, remove, list, verify, drop, edit, catalog: () => load(), refresh: () => { catalog = null; } };
  };

  return { ...create(), create, valid, allowedHost, compose };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_STORE; else GZ_AI_STORE;
