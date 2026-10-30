// The local model's weights in OPFS (navigator.storage.getDirectory()), for Glaze's own engine. A model comes from
// ai/local/models.json (scripts/model-manifest.js writes it): a Hugging Face file pinned to a commit, its size and the
// SHA-256 of each 64 MB chunk. download() fetches it by Range from huggingface.co's resolve URL, which redirects to HF's
// CDN, on the student's click only. Each chunk is checked before the next starts and kept as its own file, so a
// cancelled or killed download resumes from its verified chunks (a writable commits on close; rewriting one 1 GB file in
// place would copy it on every chunk). The folder is named by the file's hash, so another version never mixes in; an
// empty `ready` file marks it complete. open() reads byte ranges, never the whole file.
// Plain script for the worker, an extension page or a Worker; node exports.
var GZ_AI_STORE = globalThis.GZ_AI_STORE || (() => {
  const TOP = 'glaze-models';
  const HEX = /^[0-9a-f]{64}$/;
  const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  const STALL = 60000; // no bytes for this long: the network is gone
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
    && typeof m.total === 'string' && HEX.test(m.total);

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
    const jobs = new Map(); // id → the download in progress, shared by its callers
    const queue = new Map(); // id → the last of the writes to its folder, where there are no Web Locks

    // Stop this store's download of `id`, its callers told `err`'s reason.
    const cancel = (id, err) => {
      const job = jobs.get(id);
      if (job) { jobs.delete(id); job.controller.abort(err); }
    };
    let bus = null;
    const tell = () => {
      if (!bus && channel) {
        bus = channel();
        bus.onmessage = (e) => {
          const d = e?.data, job = d?.type === 'remove' && typeof d.id === 'string' && Number.isSafeInteger(d.upto) && jobs.get(d.id);
          if (!job) return;
          if (job.gen === null) job.cut = Math.max(job.cut, d.upto); // not yet read: checked when it is
          else if (job.gen <= d.upto) cancel(d.id, removed());
        };
        bus.unref?.(); // node: never what keeps a process alive
      }
      return bus;
    };

    let catalog = null;
    const load = () => (catalog ||= (async () => {
      let list = typeof models === 'function' ? await models() : models;
      if (!list) list = await (await globalThis.fetch(new URL('/ai/local/models.json', globalThis.location.origin).href)).json();
      if (list && !Array.isArray(list)) list = list.models;
      const map = new Map();
      for (const m of list || []) if (valid(m) && !map.has(m.id)) map.set(m.id, Object.freeze({ ...m, sha256: Object.freeze([...m.sha256]) }));
      return map;
    })().catch((e) => { catalog = null; throw e; }));
    const model = async (id) => {
      const m = (await load()).get(id);
      if (!m) throw fail('unknown', `No model ${JSON.stringify(id)}`);
      return m;
    };

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

    // → { state: 'missing' | 'partial' (with bytes) | 'ready' | 'corrupt' }, from the files' sizes.
    const status = async (id) => {
      const m = await model(id);
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

    const fetchAll = async (m, signal, say) => {
      const { own, dir } = await folder(m, true);
      const others = [];
      for await (const name of own.keys()) if (name !== tag(m)) others.push(name);
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
      await dir.getFileHandle('ready', { create: true });
      say(1);
      return { state: 'ready' };
    };

    // Registered before anything is awaited, so a remove that follows at once finds it.
    const start = (id) => {
      const job = { listeners: new Set(), callers: 0, controller: new AbortController(), last: null, gen: null, cut: -1 };
      jobs.set(id, job);
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
        const r = await fetchAll(await model(id), signal, say);
        if (signal.aborted) throw why(signal); // a remove during the last write: its files are going
        return r;
      }).finally(() => { if (jobs.get(id) === job) jobs.delete(id); });
      return job;
    };
    // A caller's cancel ends its own wait; the download stops when the last caller still waiting cancels.
    const join = (id, job, signal, onProgress) => new Promise((resolve, reject) => {
      const listen = typeof onProgress === 'function' ? onProgress : null;
      job.callers++;
      let settled = false;
      const finish = (f, v) => {
        if (settled) return;
        settled = true; signal?.removeEventListener('abort', stop); if (listen) job.listeners.delete(listen); f(v);
      };
      const stop = () => {
        finish(reject, aborted());
        if (--job.callers === 0) { if (jobs.get(id) === job) jobs.delete(id); job.controller.abort(); }
      };
      signal?.addEventListener('abort', stop, { once: true });
      // Progress so far, replayed once the cancel is heard: a listener that cancels on it is cancelled.
      if (listen) { job.listeners.add(listen); if (job.last !== null) try { listen(job.last); } catch { /* its own */ } }
      job.done.then((v) => finish(resolve, v), (e) => finish(reject, e));
    });

    // → { state: 'ready' }; or throws an Error whose `reason` is aborted, removed, network, hash (with chunk), quota (with
    // needed and available bytes), redirect, server or unknown.
    const download = (id, { signal, onProgress } = {}) => {
      if (signal?.aborted) return Promise.reject(aborted());
      return join(id, jobs.get(id) || start(id), signal, onProgress);
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
      return held(id, null, async () => {
        const top = await (await root()).getDirectoryHandle(TOP, { create: true });
        const old = [];
        for await (const name of top.keys()) if (name.startsWith(stamp(id))) old.push(name);
        await top.getFileHandle(`${stamp(id)}${await generation(id) + 1}`, { create: true });
        for (const name of old) await top.removeEntry(name);
        try { await top.removeEntry(id, { recursive: true }); } catch (e) { if (!gone(e)) throw e; }
      });
    };

    const used = async (h) => {
      if (h.kind === 'file') return (await h.getFile()).size;
      let n = 0;
      for await (const k of h.values()) n += await used(k);
      return n;
    };
    // The manifest's models with their status; then any model kept here that it no longer offers, as `stale` with its bytes.
    const list = async () => {
      const cat = await load();
      const out = [];
      for (const m of cat.values()) {
        const { id, name, size, quant, tier, license, stock } = m;
        out.push({ id, name, size, quant, tier, license, ...(stock && { stock }), ...(await status(id)) });
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

    return { status, download, open, remove, list, verify };
  };

  return { ...create(), create, valid, allowedHost };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_STORE; else GZ_AI_STORE;
