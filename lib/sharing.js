// Share sessions (spike S6; nothing loads this yet). A shared thing (a notes folder with its pictures and attachments,
// a Look, later a To Do list) is a set of entities whose fields merge last-writer-wins by a hybrid logical clock, so
// every copy that has seen the same changes is the same, whatever order they came in. Sealed end to end: AES-GCM under
// a key from the link's # part, every batch and file signed with an Ed25519 key only edit links carry, each batch for
// its place in the log. server/relay.js stores and relays them and can read none of them. Offline first: the caller
// keeps the local copy; a session is plain JSON (merge state, unsent batches, cursor) kept beside it. Without the
// server, nothing local changes. Classic script; module.exports for node.
var GZ_SHARING = globalThis.GZ_SHARING || (() => {
  const S = globalThis.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  // The relay a new share uses unless the student set another (settings: share.server).
  const SERVER = 'https://share.frostdev.io';
  // A sealed batch; an encrypted file (a 20 MiB attachment, padded); a clock reading's lead over this computer's clock
  // before it's applied (held until then); how far the log runs past its last trim before an editor compacts it; one
  // sync's budget (pages, bytes read, restarts, tries for a place in the log); one request's time (for a file, the time
  // it may go without a byte moving: see call()); the slowest upload rate a file is allowed, in bytes a second.
  const LIMIT = { op: 4 << 20, blob: (20 << 20) + 4096 + 28, skew: 864e5, compact: 200, pages: 64, bytes: 64 << 20, resets: 1, tries: 8, timeout: 30e3, rate: 64 << 10 };
  const ID = /^[\w-]{1,64}$/;
  const T = /^[0-9a-z]{20}$/; // 9 digits of ms, 3 of counter, 8 of actor, base 36: compared as strings
  const B = /^[\w-]{22}$/, H = /^[\w-]{43}$/;
  // The codecs, as the other classic scripts declare them (GZ_SHARE is a top-level const, never on globalThis).
  const N = () => (typeof GZ_NOTES !== 'undefined' ? GZ_NOTES : require('./notes.js'));
  const L = () => (typeof GZ_SHARE !== 'undefined' ? GZ_SHARE : require('./share.js'));

  const b64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64 = (s) => {
    if (typeof s !== 'string' || !/^[\w-]*$/.test(s)) throw new Error('bad');
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  };
  const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
  const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { out.set(x, i); i += x.length; } return out; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sha256 = async (bytes) => new Uint8Array(await S.digest('SHA-256', bytes));

  // ---- keys and links --------------------------------------------------------------------------------------------
  // The session id is random, never derived from a key: the server knows it, and it tells nothing. An edit link carries
  // the id and a 32-byte seed; the read secret and the signing key come from the seed. A read link carries the id, the
  // read secret and the public key, so a reader can check everything but sign nothing.
  const hkdf = async (ikm, salt, info) => new Uint8Array(await S.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) },
    await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), 256));
  const PKCS8 = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]); // Ed25519 seed wrapper
  const keys = async ({ sid, seed, secret, pub }) => {
    let sk = null;
    if (seed) {
      secret = await hkdf(seed, sid, 'glaze share 1 read');
      sk = await S.importKey('pkcs8', cat(PKCS8, seed), { name: 'Ed25519' }, true, ['sign']);
      pub = unb64((await S.exportKey('jwk', sk)).x);
    }
    const enc = await S.importKey('raw', await hkdf(secret, sid, 'glaze share 1 aes'), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const vk = await S.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return { sid: b64(sid), seed, secret, pub, sk, vk, enc };
  };
  // Whether this browser can join at all (Ed25519: Chrome 137, Safari 17, Firefox 129).
  const supported = () => S.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']).then(() => true, () => false);
  // A server Glaze may talk to: https, or http on this computer in a development build (dev).
  const server = (v, dev = false) => {
    let u;
    try { u = new URL(v); } catch { return null; }
    const local = dev && u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if ((u.protocol !== 'https:' && !local) || u.username || u.password || u.search || u.hash) return null;
    return u.origin + u.pathname.replace(/\/+$/, '');
  };
  // <server>/j#1.e.<id + seed> or <server>/j#1.r.<id + secret + public key>. Browsers don't send what's after #.
  const link = (srv, k, edit) => `${srv}/j#1.${edit ? 'e' : 'r'}.${b64(edit ? cat(unb64(k.sid), k.seed) : cat(unb64(k.sid), k.secret, k.pub))}`;
  const parse = (text, dev = false) => {
    let u;
    try { u = new URL(String(text).trim()); } catch { return null; }
    const m = /^#1\.([er])\.([\w-]+)$/.exec(u.hash);
    const srv = m && u.pathname.endsWith('/j') && !u.username && !u.password && !u.search ? server(u.origin + u.pathname.slice(0, -2), dev) : null;
    let b;
    try { b = srv && unb64(m[2]); } catch { return null; }
    if (!b || b.length !== (m[1] === 'e' ? 48 : 80)) return null;
    return { server: srv, sid: b.slice(0, 16), ...(m[1] === 'e' ? { seed: b.slice(16) } : { secret: b.slice(16, 48), pub: b.slice(48) }) };
  };

  // ---- sealing ---------------------------------------------------------------------------------------------------
  // JSON, padded with spaces to a multiple of 256 bytes (JSON.parse ignores them) so a length says less, encrypted with
  // a random nonce, then signed with the nonce and ciphertext: the server checks the signature without the key. The
  // session id, the kind ('op') and the batch's place in the log are bound in as associated data and signed, so a
  // batch opens only as what, and where, its author sent it.
  const aad = (sid, kind, extra) => te.encode(`gzs1|${sid}|${kind}|${extra}`);
  const seal = async (k, kind, data, extra = '') => {
    if (!k.sk) throw new Error('read-only');
    const json = te.encode(JSON.stringify(data));
    const body = new Uint8Array(Math.ceil((json.length + 1) / 256) * 256).fill(32);
    body.set(json);
    const iv = rand(12), a = aad(k.sid, kind, extra);
    const blob = cat(iv, new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: a }, k.enc, body)));
    if (blob.length > LIMIT.op) throw new Error('big');
    return { op: b64(blob), sig: b64(new Uint8Array(await S.sign({ name: 'Ed25519' }, k.sk, cat(a, blob)))) };
  };
  const open = async (k, kind, { op, sig }, extra = '') => {
    const a = aad(k.sid, kind, extra), blob = unb64(op);
    if (blob.length < 29 || !await S.verify({ name: 'Ed25519' }, k.vk, unb64(sig), cat(a, blob))) throw new Error('signature');
    return JSON.parse(td.decode(await S.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: a }, k.enc, blob.subarray(12))));
  };

  // ---- the clock and the merge -----------------------------------------------------------------------------------
  // A hybrid logical clock per session and device: never behind the wall clock, never behind anything it has seen, so
  // a change made after seeing another always sorts after it. Ties can't happen: the actor id is part of the reading.
  const stamp = ([ms, c], actor) => ms.toString(36).padStart(9, '0') + c.toString(36).padStart(3, '0') + actor;
  const msOf = (t) => parseInt(t.slice(0, 9), 36);
  const tick = (st, now) => { st.clock = now > st.clock[0] ? [now, 0] : st.clock[1] < 46655 ? [st.clock[0], st.clock[1] + 1] : [st.clock[0] + 1, 0]; return stamp(st.clock, st.actor); };
  const see = (st, t) => { const c = [msOf(t), parseInt(t.slice(9, 12), 36)]; if (c[0] > st.clock[0] || (c[0] === st.clock[0] && c[1] > st.clock[1])) st.clock = c; };

  // Entity ids come from others: never one that reaches an object's prototype, and only ever an own property. An adapter
  // that names the shapes its ids have (`id`) takes no others, so a name like toString is no entity at all.
  const okId = (e) => typeof e === 'string' && ID.test(e) && !['__proto__', 'constructor', 'prototype'].includes(e);
  const idOk = (ad, e) => okId(e) && (typeof ad?.id !== 'function' || ad.id(e) === true);
  const adapter = (st) => (Object.hasOwn(ADAPTERS, st.type) ? ADAPTERS[st.type] : undefined);
  const entity = (st, e) => (Object.hasOwn(st.state, e) ? st.state[e] : (st.state[e] = {}));
  // Field changes { e, f, v, t, p } from anyone, checked one by one (they're untrusted: the adapter cleans every value
  // or drops it) and kept where newer. p is the reading of the value its author replaced. Returns this device's own
  // values that a change displaced without building on them: a concurrent edit this device lost. For text an adapter
  // names in `copy`, sync() keeps such a value as a new entity (a conflict copy), so nothing typed is lost. Only the
  // loser's device does that, so a conflict makes one copy, not one per member.
  const merge = async (st, ad, ops, now) => {
    const lost = [];
    for (const o of Array.isArray(ops) ? ops : []) {
      if (!o || !idOk(ad, o.e) || !T.test(o.t) || !(o.p === '' || T.test(o.p))) continue;
      if (o.f !== 'del' && !ad.fields.includes(o.f)) continue;
      const v = o.f === 'del' ? (typeof o.v === 'boolean' ? o.v : undefined) : await ad.clean(o.f, o.v);
      if (v === undefined) continue;
      // From a clock far ahead: held until it isn't, so every member applies it, and a reading near the end of the
      // clock's range can't freeze a field.
      if (msOf(o.t) > now + LIMIT.skew) { if (!st.held.some((h) => h.t === o.t && h.e === o.e && h.f === o.f)) st.held.push({ ...o, v }); continue; }
      see(st, o.t);
      const ent = entity(st, o.e);
      const cur = Object.hasOwn(ent, o.f) ? ent[o.f] : null;
      if (cur && cur[1] >= o.t) continue;
      if (cur && cur[1].slice(12) === st.actor && o.p !== cur[1] && ad.copy?.includes(o.f)) lost.push({ e: o.e, f: o.f, v: cur[0] });
      ent[o.f] = [v, o.t, o.p];
    }
    return lost;
  };
  // What the merged state says now: { entity: { field: value } }, deleted entities left out, and any whose id the adapter
  // doesn't take (a state kept before it did).
  const view = (st) => Object.fromEntries(Object.entries(st.state).filter(([e, ent]) => !ent.del?.[0] && idOk(adapter(st), e))
    .map(([e, ent]) => [e, Object.fromEntries(Object.entries(ent).filter(([f]) => f !== 'del').map(([f, x]) => [f, x[0]]))]));
  // Field changes in batches that seal under the size cap. A change too big for any batch is left out and named.
  const batches = (ops) => {
    const out = [[]], big = [];
    let size = 0;
    for (const o of ops) {
      const n = te.encode(JSON.stringify(o)).length + 1;
      if (n > LIMIT.op * 0.7) { big.push(o); continue; }
      if (size + n > LIMIT.op * 0.7) { out.push([]); size = 0; }
      out[out.length - 1].push(o);
      size += n;
    }
    return { list: out.filter((b) => b.length), big };
  };
  // What changed here: the adapter's view of the local copy against the merged state, at one clock reading. An entity
  // missing from the view is deleted, so the caller passes a view read after its last write landed. Answers how many
  // changes were queued, and the entities with a value too big to share (a note over about 2.8 MB): those stay local.
  // Values go through the adapter's clean() here too, so every member keeps exactly the same value. A restore sends
  // every field again: a member who joined after a compaction has only the deletion.
  const edit = async (st, ad, local, now) => {
    if (!st.seed) throw new Error('read-only');
    const ops = [];
    for (const [e, fields] of Object.entries(local)) {
      if (!idOk(ad, e)) continue;
      const ent = Object.hasOwn(st.state, e) ? st.state[e] : {};
      const restore = !!ent.del?.[0];
      if (restore) ops.push({ e, f: 'del', v: false });
      for (const f of ad.fields) {
        const v = f in fields ? await ad.clean(f, fields[f]) : undefined;
        if (v !== undefined && (restore || !same(ent[f]?.[0], v))) ops.push({ e, f, v });
      }
    }
    for (const [e, ent] of Object.entries(st.state)) if (idOk(ad, e) && !Object.hasOwn(local, e) && !ent.del?.[0] && Object.keys(ent).length) ops.push({ e, f: 'del', v: true });
    if (!ops.length) return { n: 0, big: [] };
    const t = tick(st, now);
    // Unsent, a change replaces the one it builds on: the queue keeps the newest value per entity and field (a device
    // offline for a hundred saves of a note queues one copy of it, not a hundred), and that value names the one the
    // others last saw it replace, so no member takes it for a concurrent edit.
    const field = (o) => `${o.e} ${o.f}`, queued = new Map(st.pending.flat().map((o) => [field(o), o]));
    for (const o of ops) {
      const cur = (Object.hasOwn(st.state, o.e) && st.state[o.e][o.f]?.[1]) || '', had = queued.get(field(o));
      o.t = t; o.p = had?.t === cur ? had.p : cur;
    }
    const { list, big } = batches(ops);
    for (const o of list.flat()) { entity(st, o.e)[o.f] = [o.v, o.t, o.p]; queued.delete(field(o)); queued.set(field(o), o); }
    st.pending = batches([...queued.values()]).list;
    return { n: ops.length - big.length, big: [...new Set(big.map((o) => o.e))] };
  };
  // A state as field changes. A deleted entity keeps only its deletion: what it held isn't sent again (a device that
  // restores it has it and sends it then). Remote data never comes through here; merge() checks that.
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const flat = (state) => Object.entries(isObj(state) ? state : {}).flatMap(([e, ent]) => Object.entries(isObj(ent) ? ent : {})
    .filter(([f, x]) => Array.isArray(x) && (!ent.del?.[0] || f === 'del')).map(([f, [v, t, p]]) => ({ e, f, v, t, p })));
  // The whole state again, in batches: what compaction sends past the trim, and what a device sends when the server
  // has lost what it had (a backup restored).
  const everything = (st) => batches(flat(st.state).filter((o) => idOk(adapter(st), o.e))).list;

  // ---- adapters: one per kind of shared thing ---------------------------------------------------------------------
  // fields: what is shared per entity; clean(field, value): the value as this Glaze would keep it, or undefined to drop
  // it (a remote value is untrusted); copy: fields whose lost concurrent edits become a new entity, made by copyOf.
  // An adapter never touches storage: the caller reads the local copy into a view and writes the merged view back.
  // A kind can be removed by deleting its entry; a session of a kind this Glaze doesn't know stays unopened.
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
  // A file's reference: the encrypted file's id on the relay (id), its SHA-256 (h, checked before it's opened), its
  // size (s), name (n) and type (t). Signed with the batch that carries it, so the relay can't swap the file.
  const fileRef = (v, max) => (isObj(v) && B.test(v.id) && H.test(v.h) && Number.isSafeInteger(v.s) && v.s >= 0 && v.s <= max
    && typeof v.n === 'string' && v.n.length <= 200 && typeof v.t === 'string' && /^[\w.+-]{1,60}\/[\w.+-]{1,60}$/.test(v.t)
    ? { id: v.id, h: v.h, s: v.s, n: v.n, t: v.t.toLowerCase() } : undefined);
  const ADAPTERS = {
    // A notes folder: one entity per note (its id: title, html), one per picture or attachment (its id, the one in the
    // notes' data-gz-file: file), and '_' for the folder's name. The worker stores a file under its id once it has it.
    notes: {
      fields: ['title', 'html', 'file'],
      copy: ['html'],
      clean: (f, v) => (f === 'title' ? str(v, N().LIMIT.title) : f === 'file' ? fileRef(v, N().LIMIT.file)
        : str(v, N().LIMIT.body) !== undefined ? N().sanitize(v) : undefined),
      copyOf: (ent, f, v) => ({ title: `${ent.title || ''} (conflict copy)`.trim().slice(-N().LIMIT.title), html: v }),
    },
    // A Look: its theme code (lib/share.js decode, all or nothing, as for a pasted code) and its name.
    look: {
      fields: ['name', 'code'],
      clean: async (f, v) => (f === 'name' ? str(v, 80) : typeof v === 'string' && await L().decode(v).then(() => true, () => false) ? v : undefined),
    },
  };

  // ---- talking to the relay --------------------------------------------------------------------------------------
  const fail = (what, r) => Object.assign(new Error(what), { status: r?.status });
  // A body read up to a cap: a server can't make a device read without end. `moved` is told of every piece that arrives.
  const bytesOf = async (r, cap, moved) => {
    if (Number(r.headers.get('content-length')) > cap) { await r.body?.cancel().catch(() => {}); throw fail('big', r); }
    if (!r.body) return new Uint8Array();
    const parts = [];
    let n = 0;
    const reader = r.body.getReader();
    for (let x = await reader.read(); !x.done; x = await reader.read()) {
      if (x.value.length) moved?.();
      n += x.value.length;
      if (n > cap) { await reader.cancel().catch(() => {}); throw fail('big', r); }
      parts.push(x.value);
    }
    return cat(...parts);
  };

  // A new session for a local thing. Nothing is sent yet: the first sync() registers it, so sharing works offline
  // and the link can be handed out at once. del is the creator's delete token; only its hash goes to the server.
  // expire: the creator's opt-in for the relay to delete it after a year that nobody used it.
  const create = (type, { server: srv = SERVER, expire = false } = {}) => {
    if (!ADAPTERS[type]) throw new Error('type');
    return { v: 1, type, server: srv, sid: b64(rand(16)), seed: b64(rand(32)), del: b64(rand(32)), expire: !!expire, made: false, ...fresh() };
  };
  // cursor: the newest batch merged; last: its signature, which the server must still have under that number; head:
  // the newest the server had; stuck: a batch that failed its checks, tried again before it's skipped.
  const fresh = () => ({ actor: [...rand(8)].map((x) => (x % 36).toString(36)).join(''), clock: [0, 0], cursor: 0, last: null, head: 0, base: 0, stuck: null, state: {}, pending: [], held: [], gone: false });
  // A session from a link someone sent. Its kind is learned from the first batch.
  const join = (text, dev = false) => {
    const p = parse(text, dev);
    if (!p) return null;
    return { v: 1, type: null, server: p.server, sid: b64(p.sid), ...(p.seed ? { seed: b64(p.seed) } : { secret: b64(p.secret), pub: b64(p.pub) }), made: true, ...fresh() };
  };
  // Keys for Export all: what a new computer needs to rejoin (and, for the creator, to delete or set expiry). The
  // export is then as private as the links themselves; the UI says so.
  const exportKeys = (st) => ({ v: 1, type: st.type, server: st.server, sid: st.sid, ...(st.seed ? { seed: st.seed } : { secret: st.secret, pub: st.pub }), ...(st.del && { del: st.del, expire: !!st.expire }) });
  const importKeys = (rec, dev = false) => {
    if (!isObj(rec) || rec.v !== 1 || !server(rec.server, dev) || !B.test(rec.sid) || (rec.type !== null && !Object.hasOwn(ADAPTERS, rec.type))) return null;
    if (rec.seed ? !H.test(rec.seed) : !H.test(rec.secret) || !H.test(rec.pub)) return null;
    if (rec.del !== undefined && (!rec.seed || !H.test(rec.del))) return null;
    return { v: 1, type: rec.type, server: server(rec.server, dev), sid: rec.sid, ...(rec.seed ? { seed: rec.seed } : { secret: rec.secret, pub: rec.pub }),
      ...(rec.del && { del: rec.del, expire: rec.expire === true }), made: true, ...fresh() };
  };

  // One session's live object: the JSON (st) plus its keys, derived once. fetch, now, signal (stops everything) and
  // timeout (per request) can be swapped; tests do.
  const session = (st, { fetch: f = (...a) => globalThis.fetch(...a), now = Date.now, signal, timeout = LIMIT.timeout, checkpoint } = {}) => {
    let k;
    const key = async () => (k ||= await keys({ sid: unb64(st.sid), ...(st.seed ? { seed: unb64(st.seed) } : { secret: unb64(st.secret), pub: unb64(st.pub) }) }));
    const url = (p = '') => `${st.server}/s/${st.sid}${p}`;
    const ad = () => ADAPTERS[st.type];
    const unpack = (x) => (x?.y === st.type || (!st.type && Object.hasOwn(ADAPTERS, x?.y) && (st.type = x.y)) ? x : null);
    // One request, its answer read (JSON, or bytes up to cap) within the time allowed: `timeout` in all. A file's
    // (`file`) is allowed to take as long as it keeps moving: a download's clock starts again with every piece that
    // arrives, so a slow link is not cut off for being slow, only for going quiet. A fetch shows no progress while a body
    // goes up, so an upload (`file.up` bytes) gets `timeout` and the time its size needs at the slowest rate allowed.
    const call = async (u, init = {}, cap = 1 << 20, as = 'json', file = null) => {
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      let timer = setTimeout(stop, timeout + (file?.up ? Math.ceil(file.up / LIMIT.rate * 1000) : 0));
      const moved = file && (() => { clearTimeout(timer); timer = setTimeout(stop, timeout); });
      signal?.addEventListener('abort', stop, { once: true });
      try {
        if (signal?.aborted) throw fail('aborted');
        const r = await f(u, { credentials: 'omit', cache: 'no-store', ...init, signal: ctl.signal });
        moved?.();
        const body = r.status === 204 || init.method === 'HEAD' ? new Uint8Array() : await bytesOf(r, cap, moved);
        let data = body;
        if (as === 'json') try { data = JSON.parse(td.decode(body) || 'null'); } catch { data = null; }
        return { ok: r.ok, status: r.status, data, size: body.length };
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    };
    const post = (u, body, method = 'POST') => call(u, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const register = async (kk) => {
      const r = await post(`${st.server}/s`, { sid: st.sid, pub: b64(kk.pub), del: b64(await sha256(unb64(st.del))), expire: !!st.expire });
      if (!r.ok) throw fail('create', r);
      st.made = true;
    };
    // A batch into the next place in the log, signed for that place. Another device may take it first: then the next.
    const push = async (kk, batch) => {
      for (let i = 0; i < LIMIT.tries; i++) {
        const n = st.head + 1;
        const r = await post(url(), { n, ...await seal(kk, 'op', { y: st.type, o: batch }, String(n)) });
        if (r.status === 409 && Number.isSafeInteger(r.data?.head)) { st.head = r.data.head; continue; }
        if (r.ok) st.head = n;
        return r;
      }
      throw fail('busy');
    };
    // Drops the log up to where this device has read, signed over that batch's signature, so it trims only the log it
    // was made for.
    const trim = async (kk) => {
      // A durable caller keeps the merged state and a compact retry marker before history can disappear, including
      // when the server commits the trim but its reply is lost.
      await checkpoint?.();
      const upto = st.cursor;
      const sig = b64(new Uint8Array(await S.sign({ name: 'Ed25519' }, kk.sk, cat(aad(kk.sid, 'trim', String(upto)), unb64(st.last)))));
      const r = await post(url('/trim'), { upto, sig });
      if (r.ok) st.base = upto;
      return r.ok;
    };
    // Send what's queued (editors), then read what's new, then keep any lost edit as a copy and send that too. Within
    // a budget (pages, bytes, restarts), so a server that misbehaves can't keep a device busy: `more` says to come
    // back. Throws on a network error, a timeout or a refusal, with everything still queued; safe to call again.
    // Answers { changed, bad, copies, more }: whether the view may differ, and batches that failed their checks.
    const run = async () => {
      if (st.gone) return { gone: true };
      const kk = await key();
      const out = { changed: false, bad: 0, copies: 0, more: false };
      const budget = { pages: LIMIT.pages, bytes: LIMIT.bytes, resets: LIMIT.resets };
      if (!st.made) await register(kk);
      // The worker keeps this small retry marker before compaction: a trim can commit while sending its replacement
      // fails, and keeping a second copy of a large state as pending may exceed the worker's storage cap.
      if (st.snapshot) { st.pending = everything(st); delete st.snapshot; }
      let again = false, room = false;
      // Unknown to the server (restored from a backup older than the session): the creator registers it again and
      // sends everything it has.
      const lostSession = async (r) => {
        if (r.status !== 404 || !st.del || again) return false;
        again = true;
        await register(kk);
        Object.assign(st, { cursor: 0, last: null, head: 0, stuck: null, pending: everything(st) });
        return true;
      };
      for (let round = 0; round < 3; round++) {
        let full = null;
        while (st.pending.length && kk.sk) {
          const r = await push(kk, st.pending[0]);
          if (r.status === 410) return gone();
          if (await lostSession(r)) continue;
          // A full log takes nothing more until it's compacted: read on, then make room below (once a sync).
          if (r.status === 507 && !room) { full = r; break; }
          if (!r.ok) throw fail('send', r);
          st.pending.shift();
        }
        const lost = [];
        const held = st.held;
        st.held = [];
        if (held.length && ad()) { lost.push(...await merge(st, ad(), held, now())); out.changed = true; }
        let halt = false;
        for (let more = true; more && !halt;) {
          if (budget.pages-- <= 0 || budget.bytes <= 0) { out.more = true; break; }
          const r = await call(url(`?after=${st.cursor}`), {}, LIMIT.op * 2 + (1 << 20));
          budget.bytes -= r.size;
          if (r.status === 410) return gone();
          if (await lostSession(r)) break;
          if (!r.ok) throw fail('read', r);
          const page = r.data;
          if (!Number.isSafeInteger(page?.head) || !Number.isSafeInteger(page.base) || !Array.isArray(page.ops) || page.base < 0 || page.base > page.head) throw fail('read', r);
          st.head = page.head;
          // The batch this device read last isn't the server's under that number any more: the server was restored from
          // an older backup. Read it all again, and an editor sends everything it has again (merging is idempotent).
          if (st.cursor > 0 && st.cursor >= page.base && page.at !== st.last) {
            if (budget.resets-- <= 0) throw fail('read', r); // a server that keeps changing its story
            Object.assign(st, { cursor: 0, last: null, stuck: null });
            if (kk.sk) st.pending.push(...everything(st));
            continue;
          }
          const from = st.cursor;
          for (const o of page.ops) {
            // Strictly in order: the next batch is the one after the cursor, or after the trim when the cursor is
            // behind it. Anything else (a page reordered, a hole) stops here, and the next sync reads again from the
            // first missing batch: the cursor never passes a batch this device hasn't had.
            if (o?.n !== Math.max(st.cursor, page.base) + 1 || o.n > page.head) { halt = true; out.more = true; break; }
            const x = typeof o.op === 'string' && typeof o.sig === 'string' ? await open(kk, 'op', o, String(o.n)).then(unpack, () => null) : null;
            if (!x) {
              // A batch that fails its checks: tried again on the next two syncs (a store that was briefly wrong),
              // then skipped, so one bad batch can't stop a session for good.
              const tries = st.stuck?.n === o.n ? st.stuck.tries + 1 : 1;
              out.bad++;
              if (tries < 3) { st.stuck = { n: o.n, tries }; halt = true; out.more = true; break; }
            } else { lost.push(...await merge(st, ad(), x.o, now())); out.changed = true; }
            Object.assign(st, { cursor: o.n, last: o.sig, stuck: null });
          }
          st.base = page.base;
          more = !!page.more;
          if (more && st.cursor === from && !halt) throw fail('read', r); // "more" that brings nothing
        }
        // Each lost edit becomes a new entity beside the one it lost on; it, and anything else queued, goes next round.
        if (lost.length && kk.sk) {
          const v = view(st), local = { ...v };
          for (const l of lost) local[globalThis.crypto.randomUUID()] = ad().copyOf(v[l.e] || {}, l.f, l.v);
          await edit(st, ad(), local, now());
          out.copies += lost.length;
        }
        // Room in a full log: there is none for the whole state ahead of a trim, so the trim goes first, to where this
        // device has read, and the state (its unsent edits in it) goes after it next round. A member who hadn't read
        // that far reads the state instead. If the trim can't be made, the next round tries the queue once more.
        if (full) {
          room = true;
          if (st.last && st.cursor > st.base && await trim(kk)) st.pending = everything(st);
          continue;
        }
        if (!st.pending.length || !kk.sk || halt || out.more) break;
      }
      if (!st.pending.length) delete st.snapshot;
      return out;
    };
    const gone = () => { st.gone = true; st.pending = []; return { gone: true }; };
    // One sync, edit or upload at a time per session: a ring can come while a sync runs.
    let turn = Promise.resolve();
    const queue = (task) => { const p = turn.then(task); turn = p.catch(() => {}); return p; };
    // Files: padded to 4 KiB, encrypted, signed (only editors upload; the relay checks), and fetched back by id. The
    // reference goes into a field (a notes file entity), so the batch that carries it vouches for the file's hash.
    const FILE_PAD = 4096;
    const put = (bytes) => queue(async () => {
      const kk = await key();
      if (!kk.sk) throw new Error('read-only');
      if (!st.made) await register(kk);
      const id = b64(rand(16)), a = aad(kk.sid, 'blob', id), iv = rand(12);
      const body = new Uint8Array(Math.max(1, Math.ceil(bytes.length / FILE_PAD)) * FILE_PAD);
      body.set(bytes);
      const blob = cat(iv, new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: a }, kk.enc, body)));
      if (blob.length > LIMIT.blob) throw new Error('big');
      const sig = b64(new Uint8Array(await S.sign({ name: 'Ed25519' }, kk.sk, cat(a, blob))));
      const r = await call(url(`/b/${id}`), { method: 'PUT', headers: { 'content-type': 'application/octet-stream', 'x-glaze-sig': sig }, body: blob }, 1 << 20, 'json', { up: blob.length });
      if (!r.ok) throw fail('file', r);
      return { id, h: b64(await sha256(blob)), s: bytes.length };
    });
    const get = async (ref) => {
      if (!isObj(ref) || !B.test(ref.id) || !H.test(ref.h) || !Number.isSafeInteger(ref.s) || ref.s < 0 || ref.s > LIMIT.blob - 28) throw new Error('file');
      const kk = await key();
      const cap = Math.min(LIMIT.blob, Math.max(1, Math.ceil(ref.s / FILE_PAD)) * FILE_PAD + 28);
      const r = await call(url(`/b/${ref.id}`), {}, cap, 'bytes', {});
      if (!r.ok) throw fail('file', r);
      if (b64(await sha256(r.data)) !== ref.h) throw new Error('signature');
      const plain = await S.decrypt({ name: 'AES-GCM', iv: r.data.subarray(0, 12), additionalData: aad(kk.sid, 'blob', ref.id) }, kk.enc, r.data.subarray(12));
      return new Uint8Array(plain, 0, ref.s);
    };
    return {
      st,
      view: () => view(st),
      edit: (local) => queue(() => edit(st, ad(), local, now())),
      sync: () => queue(run),
      put,
      get,
      removeFile: (id) => queue(async () => {
        const kk = await key();
        if (!kk.sk) throw new Error('read-only');
        if (typeof id !== 'string' || !B.test(id)) throw new Error('file');
        const sig = b64(new Uint8Array(await S.sign('Ed25519', kk.sk, aad(kk.sid, 'blob-delete', id))));
        const r = await call(url(`/b/${id}`), { method: 'DELETE', headers: { 'x-glaze-sig': sig } });
        if (!r.ok && r.status !== 404) throw fail('file', r);
      }),
      link: async (editable) => link(st.server, await key(), editable && !!st.seed),
      // An editor compacts once the log runs LIMIT.compact batches past its last trim: it sends the whole state again
      // at the end of the log, then has the server drop everything up to where it had read, so a new member reads the
      // state, not the history. A log too full for one more copy of the state (507) is trimmed first, and the state
      // queued to go after the trim with the next sync.
      compact: (force = false) => queue(async () => {
        const kk = await key();
        if (!kk.sk || st.pending.length || !st.last || st.cursor <= st.base || (!force && st.cursor - st.base < LIMIT.compact)) return false;
        for (const b of everything(st)) {
          const r = await push(kk, b);
          if (r.status === 507) { if (!await trim(kk)) return false; st.pending = everything(st); return true; }
          if (!r.ok) return false;
        }
        return trim(kk);
      }),
      // The creator's opt-in: the relay deletes the share after a year nobody used it.
      expiry: (on) => queue(async () => {
        if (!st.del) throw new Error('not creator');
        if (!st.made) await register(await key());
        const r = await call(url('/expiry'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${st.del}` }, body: JSON.stringify({ on: !!on }) });
        if (!r.ok) throw fail('expiry', r);
        st.expire = !!on;
        return st.expire;
      }),
      // Delete for everyone: the creator only. Every member keeps their local copy.
      remove: () => queue(async () => {
        if (!st.del) throw new Error('not creator');
        const r = await call(url(), { method: 'DELETE', headers: { authorization: `Bearer ${st.del}` } });
        if (!r.ok && r.status !== 410 && !(r.status === 404 && !st.made)) throw fail('delete', r);
        gone();
        return true;
      }),
    };
  };

  // The doorbell: one socket per server for the sessions open on screen. The server answers each session's newest
  // batch number at once and again on every change ({ s, n }), or { s, gone: 1 }; ring() decides whether to sync.
  // It sends a heartbeat every 25 s (which also keeps Chrome's service worker awake while the socket is open, Chrome
  // 116+); 60 s of silence means a dead connection. Reconnects with backoff until close().
  const live = (srv, sids, ring, { WebSocket: W = globalThis.WebSocket } = {}) => {
    let ws, closed = false, wait = 1000, timer, quiet;
    const hush = () => { clearTimeout(quiet); quiet = setTimeout(() => ws?.close(), 60000); };
    const connect = () => {
      ws = new W(`${srv.replace(/^http/, 'ws')}/live`);
      ws.onopen = () => { wait = 1000; hush(); ws.send(JSON.stringify({ sub: sids })); };
      ws.onmessage = (e) => { hush(); let m; try { m = JSON.parse(e.data); } catch { return; } if (typeof m?.s === 'string') ring(m); };
      ws.onclose = () => { clearTimeout(quiet); if (!closed) timer = setTimeout(connect, (wait = Math.min(wait * 2, 60000)) * (0.5 + Math.random() / 2)); };
    };
    connect();
    return { close: () => { closed = true; clearTimeout(timer); clearTimeout(quiet); ws?.close(); } };
  };

  return { SERVER, LIMIT, ADAPTERS, b64, unb64, keys, supported, server, link, parse, seal, open, merge, view, edit, flat, everything, create, join, exportKeys, importKeys, session, live };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHARING;
