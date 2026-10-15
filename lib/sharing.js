// Share sessions (spike S6; nothing loads this yet). A shared thing (a notes folder, a Look, later a To Do list) is a
// set of entities whose fields merge last-writer-wins by a hybrid logical clock, so every copy that has seen the same
// changes is the same, whatever order they came in. Sealed end to end: AES-GCM under a key from the link's # part,
// every batch signed with an Ed25519 key that only edit links carry. server/relay.js stores and relays the sealed
// batches and can read none of them. Offline first: the caller keeps the local copy; a session is plain JSON (merge
// state, unsent batches, cursor), kept beside it. Without the server, nothing local changes.
// Classic script; module.exports for node.
var GZ_SHARING = globalThis.GZ_SHARING || (() => {
  const S = globalThis.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  // A sealed batch, a clock reading's lead over this computer's clock before it's applied (held until then), the
  // batches a page of catch-up holds, and how far the log runs past the last snapshot before an editor compacts it.
  const LIMIT = { op: 1 << 20, skew: 864e5, compact: 200 };
  const ID = /^[\w-]{1,64}$/;
  const T = /^[0-9a-z]{20}$/; // 9 digits of ms, 3 of counter, 8 of actor, base 36: compared as strings
  const N = () => globalThis.GZ_NOTES || require('./notes.js');
  const L = () => globalThis.GZ_SHARE || require('./share.js');

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

  // ---- keys and links --------------------------------------------------------------------------------------------
  // The session id is random, never derived from a key: the server knows it, and it tells nothing. An edit link carries
  // the id and a 32-byte seed; the read secret and the signing key come from the seed. A read link carries the id, the
  // read secret and the public key, so a reader can check every batch but sign none.
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
  // <server>/j#1.e.<id + seed> or <server>/j#1.r.<id + secret + public key>. Nothing after # reaches any server.
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
  // session id, the kind and (for a snapshot) how far it reaches are bound in as associated data and signed.
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

  // Field changes { e, f, v, t, p } from anyone, checked one by one (they're untrusted: the adapter cleans every value
  // or drops it) and kept where newer. p is the reading of the value its author replaced. Returns this device's own
  // values that a change displaced without building on them: a concurrent edit this device lost. For text an adapter
  // names in `copy`, sync() keeps such a value as a new entity (a conflict copy), so nothing typed is lost. Only the
  // loser's device does that, so a conflict makes one copy, not one per member.
  // Entity ids come from others: never one that reaches an object's prototype, and only ever an own property.
  const okId = (e) => typeof e === 'string' && ID.test(e) && !['__proto__', 'constructor', 'prototype'].includes(e);
  const entity = (st, e) => (Object.hasOwn(st.state, e) ? st.state[e] : (st.state[e] = {}));
  const merge = async (st, ad, ops, now) => {
    const lost = [];
    for (const o of Array.isArray(ops) ? ops : []) {
      if (!o || !okId(o.e) || !T.test(o.t) || !(o.p === '' || T.test(o.p))) continue;
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
  // What the merged state says now: { entity: { field: value } }, deleted entities left out.
  const view = (st) => Object.fromEntries(Object.entries(st.state).filter(([, ent]) => !ent.del?.[0])
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
  // changes were queued, and the entities with a value too big to share (a very long note): those stay local only.
  // Values go through the adapter's clean() here too, so every member keeps exactly the same value.
  const edit = async (st, ad, local, now) => {
    if (!st.seed) throw new Error('read-only');
    const ops = [];
    for (const [e, fields] of Object.entries(local)) {
      if (!okId(e)) continue;
      const ent = Object.hasOwn(st.state, e) ? st.state[e] : {};
      if (ent.del?.[0]) ops.push({ e, f: 'del', v: false });
      for (const f of ad.fields) {
        const v = f in fields ? await ad.clean(f, fields[f]) : undefined;
        if (v !== undefined && !same(ent[f]?.[0], v)) ops.push({ e, f, v });
      }
    }
    for (const [e, ent] of Object.entries(st.state)) if (!(e in local) && !ent.del?.[0] && Object.keys(ent).length) ops.push({ e, f: 'del', v: true });
    if (!ops.length) return { n: 0, big: [] };
    const t = tick(st, now);
    for (const o of ops) { o.t = t; o.p = (Object.hasOwn(st.state, o.e) && st.state[o.e][o.f]?.[1]) || ''; }
    const { list, big } = batches(ops);
    for (const b of list) for (const o of b) entity(st, o.e)[o.f] = [o.v, o.t, o.p];
    st.pending.push(...list);
    return { n: ops.length - big.length, big: [...new Set(big.map((o) => o.e))] };
  };
  // A state as field changes. Snapshots come from others: anything not shaped like a field is skipped here, and
  // merge() checks the rest.
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const flat = (state) => Object.entries(isObj(state) ? state : {}).flatMap(([e, ent]) => Object.entries(isObj(ent) ? ent : {})
    .filter(([, x]) => Array.isArray(x)).map(([f, [v, t, p]]) => ({ e, f, v, t, p })));
  // The whole state again, in batches: what a device sends when the server has lost what it had (a backup restored).
  const everything = (st) => batches(flat(st.state)).list;

  // ---- adapters: one per kind of shared thing ---------------------------------------------------------------------
  // fields: what is shared per entity; clean(field, value): the value as this Glaze would keep it, or undefined to drop
  // it (a remote value is untrusted); copy: fields whose lost concurrent edits become a new entity, made by copyOf.
  // An adapter never touches storage: the caller reads the local copy into a view and writes the merged view back.
  // A kind can be removed by deleting its entry; a session of a kind this Glaze doesn't know stays unopened.
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
  const ADAPTERS = {
    // A notes folder: one entity per note (its id), plus '_' for the folder's name. Pictures and attachments stay
    // on the device that has them (a later version can seal them as blobs).
    notes: {
      fields: ['title', 'html'],
      copy: ['html'],
      clean: (f, v) => (f === 'title' ? str(v, N().LIMIT.title) : str(v, N().LIMIT.body) !== undefined ? N().sanitize(v) : undefined),
      copyOf: (ent, f, v) => ({ title: `${ent.title || ''} (conflict copy)`.trim().slice(-N().LIMIT.title), html: v }),
    },
    // A Look: its theme code (lib/share.js decode, all or nothing, as for a pasted code) and its name.
    look: {
      fields: ['name', 'code'],
      clean: async (f, v) => (f === 'name' ? str(v, 80) : typeof v === 'string' && await L().decode(v).then(() => true, () => false) ? v : undefined),
    },
  };

  // ---- talking to the relay --------------------------------------------------------------------------------------
  const post = (f, url, body, method = 'POST') => f(url, { method, credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const sha256 = async (bytes) => new Uint8Array(await S.digest('SHA-256', bytes));
  const fail = (what, r) => Object.assign(new Error(what), { status: r?.status });

  // A new session for a local thing. Nothing is sent yet: the first sync() registers it, so sharing works offline
  // and the link can be handed out at once. del is the creator's delete token; only its hash goes to the server.
  const create = (srv, type) => {
    if (!ADAPTERS[type]) throw new Error('type');
    return { v: 1, type, server: srv, sid: b64(rand(16)), seed: b64(rand(32)), del: b64(rand(32)), made: false, ...fresh() };
  };
  // cursor: the newest batch merged, and last: its signature, which the server must still have under that number.
  const fresh = () => ({ actor: [...rand(8)].map((x) => (x % 36).toString(36)).join(''), clock: [0, 0], cursor: 0, last: null, base: 0, state: {}, pending: [], held: [], gone: false });
  // A session from a link someone sent. Its kind is learned from the first batch.
  const join = (text, dev = false) => {
    const p = parse(text, dev);
    if (!p) return null;
    return { v: 1, type: null, server: p.server, sid: b64(p.sid), ...(p.seed ? { seed: b64(p.seed) } : { secret: b64(p.secret), pub: b64(p.pub) }), made: true, ...fresh() };
  };

  // One session's live object: the JSON (st) plus its keys, derived once. fetch and now can be swapped for tests.
  const session = (st, { fetch: f = (...a) => globalThis.fetch(...a), now = Date.now } = {}) => {
    let k;
    const key = async () => (k ||= await keys({ sid: unb64(st.sid), ...(st.seed ? { seed: unb64(st.seed) } : { secret: unb64(st.secret), pub: unb64(st.pub) }) }));
    const url = (p = '') => `${st.server}/s/${st.sid}${p}`;
    const ad = () => ADAPTERS[st.type];
    const unpack = (x) => (x?.y === st.type || (!st.type && ADAPTERS[x?.y] && (st.type = x.y)) ? x : null);
    const register = async (kk) => {
      const r = await post(f, `${st.server}/s`, { sid: st.sid, pub: b64(kk.pub), del: b64(await sha256(unb64(st.del))) });
      if (!r.ok) throw fail('create', r);
      st.made = true;
    };
    // Send what's queued (editors), then read what's new, then keep any lost edit as a copy and send that too.
    // Throws on a network error or a refusal, with everything still queued; safe to call again at any time.
    // Answers { changed, bad, copies }: whether the view may differ, and how many batches failed their checks.
    const run = async () => {
      if (st.gone) return { gone: true };
      const kk = await key();
      const out = { changed: false, bad: 0, copies: 0 };
      if (!st.made) await register(kk);
      let again = false;
      for (let round = 0; round < 3; round++) {
        while (st.pending.length && kk.sk) {
          const r = await post(f, url(), await seal(kk, 'op', { y: st.type, o: st.pending[0] }));
          if (r.status === 410) return gone();
          // Unknown to a server restored from an older backup: the creator registers it again and resends it all.
          if (r.status === 404 && st.del && !again) { again = true; await register(kk); st.pending = everything(st); continue; }
          if (!r.ok) throw fail('send', r);
          st.pending.shift();
        }
        const lost = [];
        const held = st.held;
        st.held = [];
        if (held.length && ad()) { lost.push(...await merge(st, ad(), held, now())); out.changed = true; }
        for (let more = true; more;) {
          const r = await f(url(`?after=${st.cursor}`), { credentials: 'omit', cache: 'no-store' });
          if (r.status === 410) return gone();
          if (!r.ok) throw fail('read', r);
          const page = await r.json();
          if (!Number.isSafeInteger(page?.head) || !Number.isSafeInteger(page.base) || !Array.isArray(page.ops)) throw fail('read', r);
          // The batch this device read last isn't the server's under that number any more: the server was restored
          // from an older backup. Read it all again, and an editor sends everything it has again (merging is idempotent).
          if (st.cursor > page.base && page.at !== st.last) { st.cursor = 0; st.last = null; if (kk.sk) st.pending.push(...everything(st)); continue; }
          if (page.snap) {
            const x = await open(kk, 'snap', page.snap, String(page.base)).then(unpack, () => null);
            if (x) { lost.push(...await merge(st, ad(), [...flat(x.s), ...(Array.isArray(x.h) ? x.h : [])], now())); out.changed = true; } else out.bad++;
            if (page.base > st.cursor) { st.cursor = page.base; st.last = null; }
          }
          for (const o of page.ops) {
            if (!Number.isSafeInteger(o?.n) || o.n <= st.cursor) continue;
            const x = await open(kk, 'op', o).then(unpack, () => null);
            if (x) { lost.push(...await merge(st, ad(), x.o, now())); out.changed = true; } else out.bad++;
            st.cursor = o.n;
            st.last = o.sig;
          }
          st.base = page.base;
          more = !!page.more;
        }
        // Each lost edit becomes a new entity beside the one it lost on; it, and anything else queued, goes next round.
        if (lost.length && kk.sk) {
          const v = view(st), local = { ...v };
          for (const l of lost) local[globalThis.crypto.randomUUID()] = ad().copyOf(v[l.e] || {}, l.f, l.v);
          await edit(st, ad(), local, now());
          out.copies += lost.length;
        }
        if (!st.pending.length || !kk.sk) break;
      }
      return out;
    };
    // One sync or edit at a time per session: a ring can come while a sync runs.
    let turn = Promise.resolve();
    const queue = (task) => { const p = turn.then(task); turn = p.catch(() => {}); return p; };
    const gone = () => { st.gone = true; st.pending = []; return { gone: true }; };
    return {
      st,
      view: () => view(st),
      edit: (local) => queue(() => edit(st, ad(), local, now())),
      sync: () => queue(run),
      link: async (editable) => link(st.server, await key(), editable && !!st.seed),
      // An editor folds the log into one sealed snapshot once it runs LIMIT.compact batches past the last one.
      compact: (force = false) => queue(async () => {
        const kk = await key();
        if (!kk.sk || st.pending.length || st.cursor <= st.base || (!force && st.cursor - st.base < LIMIT.compact)) return false;
        const r = await post(f, url('/snap'), { upto: st.cursor, ...await seal(kk, 'snap', { y: st.type, s: st.state, h: st.held }, String(st.cursor)) }, 'PUT');
        if (r.ok) st.base = st.cursor;
        return r.ok;
      }),
      // Delete for everyone: the creator only. Every member keeps their local copy.
      remove: () => queue(async () => {
        if (!st.del) throw new Error('not creator');
        const r = await f(url(), { method: 'DELETE', credentials: 'omit', headers: { authorization: `Bearer ${st.del}` } });
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

  return { LIMIT, ADAPTERS, b64, unb64, keys, supported, server, link, parse, seal, open, merge, view, edit, flat, everything, create, join, session, live };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHARING;
