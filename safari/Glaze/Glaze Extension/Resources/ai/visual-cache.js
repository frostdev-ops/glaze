// Local, disposable visual readings shared by Writer prefetch and Feedback. Only the trusted worker creates a cache:
// scope is its freshly verified school/account/assignment, never a page-selected key. context is the full task context
// (instructions, description, rubric, locale and safe model/config identity), without the current draft. The image
// helper's compact context also participates in the key; paper layout never affects these observations. Names and URLs
// never identify image contents.
// Persist only SHA-256 keys, complete checked readings and timestamps; no source context, identity, credentials or image
// bytes. A separate in-memory failure guard lasts through active work on the same assignment and 30 seconds of idle
// time afterward, with a 15-minute absolute bound. The helper rechecks every hit and owns its 512 estimated-token output
// contract. Classic script; node exports.
var GZ_AI_VISUAL_CACHE = globalThis.GZ_AI_VISUAL_CACHE || (() => {
  const KEY = 'aiVisualReadings', LOCK = 'glaze:ai-visual-cache', SCHEMA = 1;
  const LIMIT = Object.freeze({ entries: 128, age: 30 * 24 * 60 * 60 * 1000, failureAge: 30000, failureMax: 15 * 60 * 1000, context: 256 << 10, image: 8 << 20, value: 2048 });
  const queues = new WeakMap(), failures = new WeakMap(), groups = new WeakMap();
  const encoder = new TextEncoder();
  const object = (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const p = Object.getPrototypeOf(v);
    return p === null || Object.getPrototypeOf(p) === null;
  };
  const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
  const utf8 = (text) => encoder.encode(text);
  // Stable, bounded JSON without coercion, omitted values or class instances. Snapshot before awaiting anything so
  // mutating a caller's scope/context cannot retarget a queued write. Property order never changes a context identity.
  const canonical = (value) => {
    const seen = new Set(); let nodes = 0, length = 0;
    const add = (s) => { length += s.length; if (length > LIMIT.context) throw new TypeError('context'); return s; };
    const visit = (v, depth) => {
      if (++nodes > 10000 || depth > 20) throw new TypeError('context');
      if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) return add(JSON.stringify(v));
      if (typeof v === 'string') { if (v.length > LIMIT.context) throw new TypeError('context'); return add(JSON.stringify(v)); }
      if ((!Array.isArray(v) && !object(v)) || seen.has(v)) throw new TypeError('context');
      seen.add(v);
      const out = Array.isArray(v)
        ? '[' + Array.from(v, (x) => visit(x, depth + 1)).join(',') + ']'
        : '{' + Object.keys(v).sort().map((k) => add(JSON.stringify(k)) + ':' + visit(v[k], depth + 1)).join(',') + '}';
      seen.delete(v);
      if (out.length > LIMIT.context) throw new TypeError('context');
      return out;
    };
    const out = visit(value, 0);
    if (utf8(out).length > LIMIT.context) throw new TypeError('context');
    return out;
  };
  const identity = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\p{Cc}\p{Bidi_Control}]/u.test(v);
  const scopeOf = (raw) => {
    if (!only(raw, ['school', 'account', 'assignment']) || !identity(raw.school, 512) || !identity(raw.account, 512) || !identity(raw.assignment, 2048)) return null;
    const school = new URL(raw.school.includes('://') ? raw.school : `https://${raw.school}`);
    if (school.protocol !== 'https:' || school.username || school.password || school.pathname !== '/' || school.search || school.hash) return null;
    return { school: school.origin, account: raw.account, assignment: raw.assignment };
  };
  // This is a storage-shape and size guard, not a substitute for writer-image.check's semantic validation. Byte size
  // matches the helper's JSON UTF-8 / 4 estimate; it does not claim to count any provider's actual tokenizer exactly.
  const valueOf = (raw, incomplete = false) => {
    if (!only(raw, ['description', 'requirements', 'complete', 'reason', 'relevance']) || raw.complete !== !incomplete
      || !['relevant', 'irrelevant', 'uncertain'].includes(raw.relevance) || typeof raw.description !== 'string'
      || !raw.description.trim() || raw.description.length > 4096 || !Array.isArray(raw.requirements) || raw.requirements.length > 12
      || raw.requirements.some((s) => typeof s !== 'string' || !s.trim() || s.length < 3 || s.length > 300) || new Set(raw.requirements).size !== raw.requirements.length) return null;
    if (incomplete ? (typeof raw.reason !== 'string' || !raw.reason.trim() || raw.reason.length > 200 || raw.relevance === 'irrelevant') : raw.reason !== '') return null;
    const value = { description: raw.description, requirements: [...raw.requirements], complete: raw.complete, reason: raw.reason, relevance: raw.relevance };
    return utf8(JSON.stringify(value)).length <= LIMIT.value ? value : null;
  };
  const bytesOf = (image) => {
    if (!object(image) || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mime)) return null;
    const data = image.data;
    if (data instanceof Uint8Array) return data.byteLength && data.byteLength <= LIMIT.image * 0.75 ? new Uint8Array(data) : null;
    if (data instanceof ArrayBuffer) return data.byteLength && data.byteLength <= LIMIT.image * 0.75 ? new Uint8Array(data.slice(0)) : null;
    // Check before decoding; unlike a URL/name, distinct base64 spellings of identical bytes have the same digest.
    if (typeof data !== 'string' || !data.length || data.length > LIMIT.image || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}(?![\s\S])/.test(data)) return null;
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  };
  const rowsOf = (raw, time) => {
    if (!only(raw, ['schema', 'entries']) || raw.schema !== SCHEMA || !Array.isArray(raw.entries) || raw.entries.length > LIMIT.entries) return [];
    const rows = new Map();
    for (const row of raw.entries) {
      if (!only(row, ['key', 'createdAt', 'usedAt', 'value']) || typeof row.key !== 'string' || !/^[a-f0-9]{64}$/.test(row.key)
        || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > time || time - row.createdAt >= LIMIT.age
        || !Number.isSafeInteger(row.usedAt) || row.usedAt < row.createdAt || row.usedAt > time) continue;
      const value = valueOf(row.value);
      if (value && (!rows.has(row.key) || rows.get(row.key).usedAt < row.usedAt)) rows.set(row.key, { key: row.key, createdAt: row.createdAt, usedAt: row.usedAt, value });
    }
    return [...rows.values()];
  };
  // No mutable record cache: every transaction rereads its own injected store. Web Locks cover separate worker/global
  // instances; without them, adapters sharing a store object use the same in-process queue.
  const queued = (store, locks, work) => {
    const previous = queues.get(store) || Promise.resolve();
    const result = previous.then(() => locks?.request ? locks.request(LOCK, work) : work());
    const tail = result.catch(() => {});
    queues.set(store, tail);
    tail.then(() => { if (queues.get(store) === tail) queues.delete(store); });
    return result;
  };
  const dropGroup = (store, all, id) => {
    all.delete(id);
    const rows = failures.get(store);
    if (rows) for (const [key, row] of rows) if (row.group === id) rows.delete(key);
  };
  // Group identity hashes the full verified scope/context, independently of each picture. Expire idle groups before
  // renewing activity so a manual retry after 30 seconds cannot revive a stale failure. No timers or unbounded maps.
  const groupOf = (store, id, time, create) => {
    const all = groups.get(store) || new Map();
    for (const [key, group] of all) if (group.at > time || (!group.active && time - group.at >= LIMIT.failureAge)) dropGroup(store, all, key);
    let group = all.get(id);
    if (!group && create) group = { at: time, active: 0 };
    if (group) { all.delete(id); all.set(id, group); }
    while (all.size > LIMIT.entries) dropGroup(store, all, all.keys().next().value);
    if (group || groups.has(store)) groups.set(store, all);
    return group;
  };
  // The returned get/set and optional getFailure/setFailure adapters plug directly into writer-image.prepare. Invalid
  // scope or context disables caching (null). Runtime hashing/storage failures are misses/false, never failed inference.
  const create = ({ store, scope, context, version = 'writer-image-v1', now = Date.now, crypto = globalThis.crypto,
    locks = globalThis.navigator?.locks, signal } = {}) => {
    let bound;
    try {
      if (!store || typeof store.get !== 'function' || typeof store.set !== 'function' || typeof now !== 'function' || !identity(version, 80)) return null;
      const safeScope = scopeOf(scope);
      if (!safeScope || context === undefined) return null;
      bound = canonical({ schema: SCHEMA, version, scope: safeScope, context });
    } catch { return null; }
    // Node-only fallback for tests; no module loader or dependency is required in the worker.
    const digest = async (bytes) => {
      const api = crypto?.subtle || (typeof module !== 'undefined' && module.exports && typeof require === 'function' ? require('node:crypto').webcrypto.subtle : null);
      if (!api) return null;
      return Array.from(new Uint8Array(await api.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
    };
    const base = digest(utf8(bound)).catch(() => null);
    // Task.run holds this lease for an entire image/Feedback task and releases it in finally. Concurrent or consecutive
    // image tasks can share a failure without replaying image 1 while image 2 is still running. A release is idempotent,
    // also runs on cancellation, and cannot resurrect a group evicted while it was active.
    const hold = async () => {
      const noop = () => {};
      let release = noop;
      try {
        const id = await base, time = now();
        if (!id || signal?.aborted || !Number.isSafeInteger(time) || time < 0) return noop;
        const group = groupOf(store, id, time, true);
        group.active++; group.at = time;
        let released = false;
        release = () => {
          if (released) return;
          released = true;
          try { signal?.removeEventListener('abort', release); } catch {}
          group.active--;
          if (groups.get(store)?.get(id) !== group) return;
          try {
            const ended = now();
            if (Number.isSafeInteger(ended) && ended >= 0) group.at = Math.max(group.at, ended);
          } catch {}
        };
        signal?.addEventListener('abort', release, { once: true });
        if (signal?.aborted) release();
        return release;
      } catch { release(); return noop; }
    };
    const keyOf = async (input) => {
      if (signal?.aborted || !object(input) || (input.context !== undefined && typeof input.context !== 'string')
        || (input.contextComplete !== undefined && typeof input.contextComplete !== 'boolean')) return null;
      const image = input.image, bytes = bytesOf(image), mime = image?.mime;
      if (!bytes) return null;
      const task = canonical({ context: input.context ?? '', contextComplete: input.contextComplete ?? true });
      const [identity, imageHash] = await Promise.all([base, digest(bytes)]);
      if (!identity || !imageHash || signal?.aborted) return null;
      return digest(utf8(canonical([identity, mime, imageHash, task])));
    };
    const access = async (input, raw, write) => {
      try {
        const value = write ? valueOf(raw) : null;
        if (write && !value) return false;
        const key = await keyOf(input);
        if (!key) return write ? false : null;
        return await queued(store, locks, async () => {
          if (signal?.aborted) return write ? false : null;
          const time = now();
          if (!Number.isSafeInteger(time) || time < 0) return write ? false : null;
          const stored = (await store.get(KEY))?.[KEY], rows = rowsOf(stored, time);
          if (signal?.aborted) return write ? false : null;
          const row = rows.find((r) => r.key === key);
          if (!write && !row) {
            // Prune expired/corrupt records on the next read as well as on a write. An absent cache needs no write.
            if (stored != null && JSON.stringify(stored) !== JSON.stringify({ schema: SCHEMA, entries: rows })) {
              try { await store.set({ [KEY]: { schema: SCHEMA, entries: rows } }); } catch {}
            }
            return null;
          }
          // The helper may hand a hit back to set. That must not extend its original 30-day lifetime. Equal timestamps
          // still have a definite LRU order: put this transaction first before the stable recency sort.
          const createdAt = row && JSON.stringify(row.value) === JSON.stringify(value) ? row.createdAt : time;
          const next = write ? { key, createdAt, usedAt: time, value } : { ...row, usedAt: time };
          const entries = [next, ...rows.filter((r) => r.key !== key)].sort((a, b) => b.usedAt - a.usedAt).slice(0, LIMIT.entries);
          // A failed recency write does not invalidate an otherwise valid cache hit.
          try {
            const saved = await store.set({ [KEY]: { schema: SCHEMA, entries } });
            if (write) {
              if (saved !== false) failures.get(store)?.delete(key);
              return saved !== false && !signal?.aborted;
            }
          } catch { if (write) return false; }
          return signal?.aborted ? null : valueOf(row.value);
        });
      } catch { return write ? false : null; }
    };
    // No persistent writes or timers: after hashing, this transaction is synchronous. Separate adapters on the same
    // worker/store share the guard, but another account/context has its own group and every image has its own key.
    const failure = async (input, raw, write) => {
      try {
        const value = write ? valueOf(raw, true) : null;
        if (write && !value) return false;
        const key = await keyOf(input), id = await base, time = now();
        if (!key || signal?.aborted || !Number.isSafeInteger(time) || time < 0) return write ? false : null;
        const group = groupOf(store, id, time, write);
        if (!group) return write ? false : null;
        const rows = failures.get(store) || new Map();
        for (const [k, row] of rows) if (row.at > time || time - row.at >= LIMIT.failureMax || !groups.get(store)?.has(row.group)) rows.delete(k);
        const row = rows.get(key);
        if (!write) {
          if (!row) return null;
          rows.delete(key); rows.set(key, row);
          return valueOf(row.value, true);
        }
        const same = row && JSON.stringify(row.value) === JSON.stringify(value), at = same ? row.at : time;
        if (!same) group.at = time;
        rows.delete(key); rows.set(key, { at, value, group: id });
        while (rows.size > LIMIT.entries) rows.delete(rows.keys().next().value);
        failures.set(store, rows);
        return true;
      } catch { return write ? false : null; }
    };
    return { get: (input) => access(input, null, false), set: (input, value) => access(input, value, true),
      getFailure: (input) => failure(input, null, false), setFailure: (input, value) => failure(input, value, true), hold };
  };
  return { KEY, LOCK, SCHEMA, LIMIT, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_VISUAL_CACHE; else GZ_AI_VISUAL_CACHE;
