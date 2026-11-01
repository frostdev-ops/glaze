// Stand-ins shared by the model-update tests: a fake OPFS (handles, swap-file writables, quota), a fake Hugging Face serving
// files by their resolve URL (206 Range replies from its CDN), Web Locks and a BroadcastChannel between stores. The OPFS,
// locks and bus are test/ai/ai-local-store.test.js's own.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');


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

// ---- entries ----
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bytes = (n, seed = 7) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
// A models.json entry for `data`, its URL pinned to `commit`, chunks of `chunk` bytes.
const entry = (data, { id = 'rime-q4', commit = 'a'.repeat(40), file = 'Rime-Q4.gguf', chunk = 1024, ...extra } = {}) => {
  const sums = [];
  for (let at = 0; at < data.length; at += chunk) sums.push(sha(data.subarray(at, at + chunk)));
  return { id, name: id, repo: 'test/Rime-GGUF', commit, file, url: `https://huggingface.co/test/Rime-GGUF/resolve/${commit}/${file}`, size: data.length, chunk,
    sha256: sums, total: sha(data), license: 'lfm1.0', quant: 'Q4_K_M', tier: 1, ...extra };
};

// ---- fake Hugging Face: files by their resolve URL ----
// files: { [url]: Uint8Array }. corrupt: { [url]: { [chunk]: times } }. offline(): fail the call. onChunk(url, n): awaited
// before each reply. log: every call.
const fakeHf = (files, { chunk = 1024, corrupt = {}, offline = () => false, onChunk = null } = {}) => {
  const log = [];
  const hf = async (url, init = {}) => {
    if (init.signal?.aborted) throw init.signal.reason;
    if (offline()) throw new TypeError('Failed to fetch');
    const data = files[url];
    const range = /^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range || init.headers?.range || '');
    log.push({ url, range: range && [+range[1], +range[2]] });
    assert.equal(init.credentials, 'omit');
    if (!data || !range) return { status: 404, ok: false, url, headers: new Headers(), body: null };
    const a = +range[1], b = Math.min(+range[2], data.length - 1), n = Math.floor(a / chunk);
    let body = data.slice(a, b + 1);
    if (corrupt[url]?.[n] > 0) { corrupt[url][n]--; body = body.slice(); body[3] ^= 0xff; }
    await onChunk?.(url, n);
    const stream = new ReadableStream({ start(c) { c.enqueue(body); c.close(); } });
    return { status: 206, ok: true, redirected: true, url: 'https://us.aws.cdn.hf.co/xet-bridge-us/abc?Signature=x', type: 'cors',
      headers: new Headers({ 'content-range': `bytes ${a}-${b}/${data.length}`, 'content-length': String(body.length) }), body: stream };
  };
  hf.log = log;
  return hf;
};

module.exports = { fakeFs, fakeHf, fakeLocks, fakeBus, entry, sha, bytes };
