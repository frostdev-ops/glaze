// Share protocol v2 (WP-S2: SHR-10, SHR-8): gzs2 signatures and associated data that no batch number can run into, a
// relay that takes no more gzs1 from a session once it has taken gzs2, creation that a lost answer can't wedge, and share
// ids bound to their key, so that nobody else, not even a read link's holder, can register them. Older extensions (gzs1,
// unsigned creation) and older relays keep working. Relays on 127.0.0.1 only, or a relay of the older kind in memory.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../lib/sharing.js');
const S = require('../lib/sessions.js');
const N = require('../lib/notes.js');
const T = require('../lib/todo.js');
const K = require('../lib/cards.js');
const { relay, LIMIT, fromEnv } = require('../server/relay.js');

const memory = () => { const m = new Map(); return { m, put: async (k, b) => { m.set(k, Buffer.from(b)); }, get: async (k) => m.get(k) || null, del: async (k) => { m.delete(k); } }; };
const up = async (t, opts = {}) => {
  const r = relay({ db: ':memory:', store: memory(), gzs2: true, ...opts });
  const a = await r.listen(0, '127.0.0.1');
  t.after(() => r.close());
  return Object.assign(r, { url: `http://127.0.0.1:${a.port}` });
};
const randomKeys = () => G.keys({ sid: crypto.getRandomValues(new Uint8Array(16)), seed: crypto.getRandomValues(new Uint8Array(32)) });
const nodeKey = (pub) => crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub).toString('base64url') }, format: 'jwk' });
const signWith = async (k, bytes) => G.b64(new Uint8Array(await crypto.subtle.sign('Ed25519', k.sk, bytes)));
const json = async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) }).then(json);

// The two formats, written out byte by byte here, apart from lib/sharing.js and server/relay.js. gzs1: the text
// `gzs1|<sid>|<kind>|<extra>`, then the data. gzs2: "gzs2", then sid, kind, extra and data, each after its length as a
// 4-byte big-endian number; its associated data (AES-GCM) is the same without the data's field.
const field = (x) => { const b = Buffer.from(x); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return [n, b]; };
const head2 = (sid, kind, extra) => Buffer.concat([Buffer.from('gzs2'), ...[sid, kind, extra].flatMap(field)]);
const v2 = (sid, kind, extra, data = Buffer.alloc(0)) => Buffer.concat([head2(sid, kind, extra), ...field(data)]);
const v1 = (sid, kind, extra, data = Buffer.alloc(0)) => Buffer.concat([Buffer.from(`gzs1|${sid}|${kind}|${extra}`), Buffer.from(data)]);
const digit = (b) => b >= 0x30 && b <= 0x39;
// A batch sealed until its bytes start with a digit (10 in 256): the batch whose signature, in gzs1, also held at a
// longer number.
const digitBatch = async (k, n, v) => {
  for (;;) { const s = await G.seal(k, 'op', { y: 'notes', o: [] }, String(n), v); if (digit(G.unb64(s.op)[0])) return s; }
};
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest();
// What an older extension does: create without a signature, then sign everything in gzs1.
const createUnsigned = (r, k, del = crypto.randomBytes(32)) => post(`${r.url}/s`, { sid: k.sid, pub: G.b64(k.pub), del: sha(del).toString('base64url') });
const fileId = () => G.b64(crypto.getRandomValues(new Uint8Array(16)));

// Actual pre-S2 source, frozen at f61431b, with its imports resolved as they were from lib/sharing.js.
const oldClient = () => {
  const vm = require('node:vm'), { createRequire } = require('node:module');
  const context = vm.createContext({ module: { exports: {} }, require: createRequire(path.join(__dirname, '../lib/sharing.js')),
    crypto: globalThis.crypto, fetch, TextEncoder, TextDecoder, URL, AbortController, Uint8Array, DataView, setTimeout, clearTimeout, atob, btoa });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/sharing-gzs1.txt'), 'utf8'), context);
  return context.module.exports;
};

test('the operator gate defaults off: no capability, gzs2 data refused, old and new clients exchange gzs1', async (t) => {
  const r = await up(t, { gzs2: fromEnv({}).gzs2 }), old = oldClient();
  const st = old.create('notes', { server: r.url }), a = old.session(st);
  await a.edit({ n1: { title: 'old', html: '' } }); await a.sync();
  const page = await fetch(`${r.url}/s/${st.sid}?after=0`).then((r) => r.json());
  assert.equal(page.gzs, undefined, 'default must not silently switch updated clients to v2');
  const b = G.session(G.join(await a.link(true), true)); await b.sync();
  await b.edit({ n1: { title: 'new', html: '<p>compatible</p>' } }); await b.sync(); await a.sync();
  assert.equal(a.view().n1.title, 'new');
  const k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
  assert.equal((await post(`${r.url}/s/${st.sid}`, { n: st.head + 1, ...await G.seal(k, 'op', { y: 'notes', o: [] }, String(st.head + 1), 2) })).status, 403);
  assert.equal(r.db.prepare('SELECT gzs FROM sessions WHERE sid = ?').get(st.sid).gzs, 1);
});

test('keeping old AAD cannot make an old reader accept a gzs2 signature', async () => {
  const old = oldClient(), k = await randomKeys(), n = '1', data = { y: 'notes', o: [] };
  const ordinary = await G.seal(k, 'op', data, n, 2);
  await assert.rejects(old.open(k, 'op', ordinary, n), /signature/);
  const oldCiphertext = await old.seal(k, 'op', data, n);
  const signed2 = { ...oldCiphertext, sig: await signWith(k, v2(k.sid, 'op', n, G.unb64(oldCiphertext.op))) };
  await assert.rejects(old.open(k, 'op', signed2, n), /signature/, 'the actual old reader refuses before AES-GCM');
});

test('actual old members work on an enabled relay until another member locks their session to v2', async (t) => {
  const r = await up(t), old = oldClient(), st = old.create('notes', { server: r.url }), a = old.session(st);
  await a.edit({ n1: { title: 'legacy', html: '' } }); await a.sync();
  const readerState = old.join(await a.link(false), true), reader = old.session(readerState); await reader.sync();
  assert.equal(reader.view().n1.title, 'legacy');
  const b = G.session(G.join(await a.link(true), true)); await b.sync(); await b.edit({ n1: { title: 'v2', html: '' } }); await b.sync();
  await a.edit({ n1: { title: 'queued legacy edit', html: '' } }); await assert.rejects(a.sync(), /send/);
  assert.ok(st.pending.length, 'old editor retains its local edit');
  for (let i = 0; i < 3; i++) { const out = await reader.sync(); assert.equal(out.bad, 1); }
  assert.equal(reader.view().n1.title, 'legacy', 'actual old reader skips the v2 signature and must update');
});

test('gate off preserves rare legacy bound-prefix IDs; gate on requires binding only for new IDs', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stage-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const opts = { db: path.join(dir, 'share.db'), store: memory() };
  let r = await up(t, { ...opts, gzs2: false });
  const sid = Buffer.concat([Buffer.from('gzb1'), crypto.randomBytes(12)]), k = await G.keys({ sid, seed: crypto.randomBytes(32) });
  const token = crypto.randomBytes(32);
  assert.equal((await createUnsigned(r, k, token)).status, 201);
  assert.equal((await createUnsigned(r, k, token)).status, 200);
  assert.equal((await post(`${r.url}/s`, { sid: k.sid, pub: G.b64(k.pub), del: sha(token).toString('base64url'), sig: 'ignored while staged' })).status, 200);
  await r.close(); r = await up(t, { ...opts, gzs2: true });
  assert.equal((await createUnsigned(r, k, token)).status, 200, 'an already owned legacy prefix id is not rejected');
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 1, ...await G.seal(k, 'op', { y: 'notes', o: [] }, '1', 1) })).status, 201);
  const freshSid = Buffer.concat([Buffer.from('gzb1'), crypto.randomBytes(12)]), fresh = await G.keys({ sid: freshSid, seed: crypto.randomBytes(32) });
  assert.equal((await createUnsigned(r, fresh)).status, 403, 'approved rare legacy exception only after enablement');
  const bound = await G.createBound('notes', { server: r.url }), s = G.session(bound); await s.edit({ n1: { title: 'v2', html: '' } }); await s.sync();
  await r.close(); r = await up(t, { ...opts, gzs2: false });
  const page = await fetch(`${r.url}/s/${bound.sid}`).then((r) => r.json()); assert.equal(page.gzs, undefined); assert.equal(page.locked, true);
  const bk = await G.keys({ sid: G.unb64(bound.sid), seed: G.unb64(bound.seed) });
  for (const v of [1, 2]) assert.equal((await post(`${r.url}/s/${bound.sid}`, { n: bound.head + 1, ...await G.seal(bk, 'op', { y: 'notes', o: [] }, String(bound.head + 1), v) })).status, 403, 'gate rollback keeps v2 sessions read-only, never unlocked');
  assert.equal(fromEnv({}).gzs2, false); assert.equal(fromEnv({ GZS2: '1' }).gzs2, true); assert.equal(fromEnv({ GZS2: 'true' }).gzs2, false);
});

test('a successful gzs2 write cannot be downgraded by a later 403 with its capability stripped', async (t) => {
  const r = await up(t), st = G.create('notes', { server: r.url });
  let strip = false, legacyWrites = 0;
  const transport = async (u, init) => {
    if (strip && init?.method === 'POST' && new URL(u).pathname !== '/s') {
      const b = JSON.parse(init.body), k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
      if (crypto.verify(null, v1(st.sid, 'op', String(b.n), G.unb64(b.op)), nodeKey(k.pub), G.unb64(b.sig))) legacyWrites++;
      return new Response(JSON.stringify({ error: 'signature' }), { status: 403 });
    }
    return fetch(u, init);
  };
  const s = G.session(st, { fetch: transport }); await s.edit({ n1: { title: 'first', html: '' } }); await s.sync();
  strip = true; await s.edit({ n1: { title: 'second', html: '' } }); await assert.rejects(s.sync(), /send/);
  assert.equal(legacyWrites, 0, 'after accepting v2, a relay cannot obtain a new legacy signature');
  assert.ok(st.pending.length);
});

test('a declared v2 upload verifies its large body only once on an unlocked session', async (t) => {
  const r = await up(t), k = await randomKeys(); await createUnsigned(r, k);
  let attempts = 0; const verify = crypto.verify;
  t.mock.method(crypto, 'verify', (...args) => { attempts++; return verify(...args); });
  const response = await fetch(`${r.url}/s/${k.sid}/b/${fileId()}`, { method: 'PUT',
    headers: { 'x-glaze-gzs': '2', 'x-glaze-sig': crypto.randomBytes(64).toString('base64url') }, body: crypto.randomBytes(1 << 20) });
  assert.equal(response.status, 403); assert.equal(attempts, 1, 'an untrusted hint selects a format but never bypasses verification');
});

test('concurrent signed creates are idempotent only for both matching key and delete hash', async (t) => {
  const r = await up(t), k = await randomKeys(), del = crypto.randomBytes(32);
  const body = { sid: k.sid, pub: G.b64(k.pub), del: G.b64(del), sig: await signWith(k, v2(k.sid, 'create', '0', del)) };
  const replies = await Promise.all([post(`${r.url}/s`, body), post(`${r.url}/s`, body)]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 201]);
  let comparisons = 0; const equal = crypto.timingSafeEqual;
  t.mock.method(crypto, 'timingSafeEqual', (...args) => { comparisons++; return equal(...args); });
  assert.equal((await post(`${r.url}/s`, body)).status, 200); assert.equal(comparisons, 2, 'both fixed-length credentials compared');
  const other = await randomKeys(), otherBody = { ...body, pub: G.b64(other.pub), sig: await signWith(other, v2(k.sid, 'create', '0', del)) };
  comparisons = 0; assert.equal((await post(`${r.url}/s`, otherBody)).status, 409); assert.equal(comparisons, 2);
  assert.equal((await post(`${r.url}/s`, { ...body, pub: 'x'.repeat(44) })).status, 400);
  assert.equal(r.db.prepare('SELECT count(*) AS n FROM sessions WHERE sid = ?').get(k.sid).n, 1);
});

test('a failed lock update rolls back the same transaction as its accepted batch', async (t) => {
  const r = await up(t), k = await randomKeys(); await createUnsigned(r, k);
  r.db.exec("CREATE TRIGGER refuse_lock BEFORE UPDATE OF gzs ON sessions BEGIN SELECT RAISE(FAIL, 'lock write failed'); END");
  const op = await G.seal(k, 'op', { y: 'notes', o: [] }, '1', 2);
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 1, ...op })).status, 500);
  assert.equal(r.db.prepare('SELECT count(*) AS n FROM ops WHERE sid = ?').get(k.sid).n, 0);
  const row = r.db.prepare('SELECT head,gzs FROM sessions WHERE sid = ?').get(k.sid); assert.deepEqual([row.head,row.gzs], [0,1]);
});

test('SHR-10: a gzs2 signature for batch n never holds at n followed by a digit; its associated data is length-prefixed the same way', async () => {
  const k = await randomKeys(), pub = nodeKey(k.pub);
  const s = await digitBatch(k, 1);
  const blob = Buffer.from(G.unb64(s.op)), sig = Buffer.from(G.unb64(s.sig)), moved = `1${String.fromCharCode(blob[0])}`;
  // Exactly the gzs2 layout signs the batch, and its first byte can't become part of the batch number.
  assert.ok(crypto.verify(null, v2(k.sid, 'op', '1', blob), pub, sig), 'signed over the gzs2 layout');
  for (const v of [v1, v2]) assert.equal(crypto.verify(null, v(k.sid, 'op', moved, blob.subarray(1)), pub, sig), false, `${v.name} at ${moved}`);
  await assert.rejects(G.open(k, 'op', { op: G.b64(blob.subarray(1)), sig: s.sig }, moved), /signature/);
  assert.deepEqual(await G.open(k, 'op', s, '1'), { y: 'notes', o: [] });
  // Sealed under the gzs2 header as associated data, and nothing else.
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: head2(k.sid, 'op', '1') }, k.enc, blob.subarray(12));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)), { y: 'notes', o: [] });
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv: blob.subarray(0, 12), additionalData: v1(k.sid, 'op', '1') }, k.enc, blob.subarray(12)));
  // Readers still open gzs1, which older versions write; each format only at its own place.
  const old = await G.seal(k, 'op', { y: 'notes', o: ['old'] }, '5', 1);
  assert.ok(crypto.verify(null, v1(k.sid, 'op', '5', G.unb64(old.op)), pub, Buffer.from(G.unb64(old.sig))));
  assert.deepEqual(await G.open(k, 'op', old, '5'), { y: 'notes', o: ['old'] });
  await assert.rejects(G.open(k, 'op', old, '6'), /signature/);
});

test('SHR-10: once a session has taken gzs2, the relay takes no gzs1 write for it, so the splice can\'t take a place', async (t) => {
  const r = await up(t);
  const k = await randomKeys();
  // An older extension made the share, and writes as it always has: those writes are taken.
  assert.equal((await createUnsigned(r, k)).status, 201);
  const one = await digitBatch(k, 1, 1), target = 10 + G.unb64(one.op)[0] - 0x30;
  const append = (n, x) => post(`${r.url}/s/${k.sid}`, { n, ...x });
  assert.equal((await append(1, one)).status, 201);
  for (let n = 2; n < target - 1; n++) assert.equal((await append(n, await G.seal(k, 'op', { y: 'notes', o: [] }, String(n), 1))).status, 201, `gzs1 batch ${n}`);
  // An updated editor's batch, in gzs2: from now on the session takes gzs2 only.
  assert.equal((await append(target - 1, await G.seal(k, 'op', { y: 'notes', o: [] }, String(target - 1)))).status, 201);
  // Batch 1 as anyone with the id can read it, its first byte moved into the batch number: refused.
  const page = await fetch(`${r.url}/s/${k.sid}?after=0`).then((x) => x.json());
  const b1 = page.ops.find((o) => o.n === 1);
  const splice = await append(target, { op: G.b64(G.unb64(b1.op).subarray(1)), sig: b1.sig });
  assert.equal(splice.status, 403);
  // So is a well-signed gzs1 batch for that place; the answer says the relay takes gzs2.
  const late = await append(target, await G.seal(k, 'op', { y: 'notes', o: [] }, String(target), 1));
  assert.deepEqual([late.status, late.body.gzs], [403, 2]);
  assert.equal((await append(target, await G.seal(k, 'op', { y: 'notes', o: [] }, String(target)))).status, 201);
  // A reader opens both formats, in order, and skips nothing.
  const reader = G.join(G.link(r.url, k, false), true);
  const out = await G.session(reader).sync();
  assert.deepEqual([out.bad, out.more, reader.cursor, reader.type], [0, false, target, 'notes']);
});

test('any gzs2 write a session takes moves it to gzs2: a file, a file delete, a trim, a signed create; one refused doesn\'t', async (t) => {
  const r = await up(t, { limit: { ...LIMIT, session: 6000 } });
  const gzs = (sid) => r.db.prepare('SELECT gzs FROM sessions WHERE sid = ?').get(sid).gzs;
  const writes = {
    file: async (k) => { const id = fileId(), blob = crypto.randomBytes(100); return (await fetch(`${r.url}/s/${k.sid}/b/${id}`, { method: 'PUT', headers: { 'x-glaze-sig': await signWith(k, v2(k.sid, 'blob', id, blob)) }, body: blob })).status; },
    'file delete': async (k) => { const id = fileId(); return (await fetch(`${r.url}/s/${k.sid}/b/${id}`, { method: 'DELETE', headers: { 'x-glaze-sig': await signWith(k, v2(k.sid, 'blob-delete', id)) } })).status; },
    trim: async (k, one) => (await post(`${r.url}/s/${k.sid}/trim`, { upto: 1, sig: await signWith(k, v2(k.sid, 'trim', '1', G.unb64(one.sig))) })).status,
    create: async (k, one, token) => (await post(`${r.url}/s`, { sid: k.sid, pub: G.b64(k.pub), del: sha(token).toString('base64url'), sig: await signWith(k, v2(k.sid, 'create', '0', sha(token))) })).status,
  };
  for (const [what, write] of Object.entries(writes)) {
    const k = await randomKeys(), token = crypto.randomBytes(32);
    assert.equal((await createUnsigned(r, k, token)).status, 201);
    const one = await G.seal(k, 'op', { y: 'notes', o: [] }, '1', 1);
    assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 1, ...one })).status, 201);
    assert.equal(gzs(k.sid), 1, what);
    assert.ok([200, 201, 204].includes(await write(k, one, token)), what);
    assert.equal(gzs(k.sid), 2, what);
    assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 2, ...await G.seal(k, 'op', { y: 'notes', o: [] }, '2', 1) })).status, 403, what);
  }
  // A gzs2 batch the session has no room for is not taken, and leaves the session as it was.
  const k = await randomKeys();
  await createUnsigned(r, k);
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 1, ...await G.seal(k, 'op', { y: 'notes', o: ['x'.repeat(7000)] }, '1') })).status, 507);
  assert.equal(gzs(k.sid), 1);
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 1, ...await G.seal(k, 'op', { y: 'notes', o: [] }, '1', 1) })).status, 201);
});

test('older extensions keep working with this relay: unsigned create, then gzs1 batches, files, file deletes and trims', async (t) => {
  const r = await up(t);
  const k = await randomKeys(), token = crypto.randomBytes(32);
  assert.equal((await createUnsigned(r, k, token)).status, 201);
  const sign = (kind, extra, data) => signWith(k, v1(k.sid, kind, extra, data));
  for (let n = 1; n <= 3; n++) assert.equal((await post(`${r.url}/s/${k.sid}`, { n, ...await G.seal(k, 'op', { y: 'notes', o: [] }, String(n), 1) })).status, 201);
  const page = await fetch(`${r.url}/s/${k.sid}?after=0`).then((x) => x.json());
  assert.equal(page.gzs, 2, 'the relay says what it takes; older extensions ignore it');
  const id = G.b64(crypto.getRandomValues(new Uint8Array(16))), blob = crypto.randomBytes(4096 + 28);
  assert.equal((await fetch(`${r.url}/s/${k.sid}/b/${id}`, { method: 'PUT', headers: { 'x-glaze-sig': await sign('blob', id, blob) }, body: blob })).status, 201);
  assert.equal((await fetch(`${r.url}/s/${k.sid}/b/${id}`, { method: 'DELETE', headers: { 'x-glaze-sig': await sign('blob-delete', id) } })).status, 204);
  const last = Buffer.from(page.ops.find((o) => o.n === 2).sig, 'base64url');
  assert.deepEqual(await post(`${r.url}/s/${k.sid}/trim`, { upto: 2, sig: await sign('trim', '2', last) }), { status: 200, body: { base: 2 } });
  assert.equal((await fetch(`${r.url}/s/${k.sid}`, { method: 'DELETE', headers: { authorization: `Bearer ${token.toString('base64url')}` } })).status, 204);
});

// A relay of the kind before gzs2, in memory: it ignores a create's signature, never says gzs, and takes gzs1 only.
// `upgraded` makes it take gzs2 as well and say so (without this version's other rules), as a relay updated in place.
// `formats` lists every signature it took: '<kind> <format>'.
const olderRelay = () => {
  const o = { sessions: new Map(), files: new Map(), formats: [], upgraded: false };
  const answer = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const say = (body) => (o.upgraded ? { ...body, gzs: 2 } : body);
  const takes = (row, kind, extra, data, sig) => {
    const s = Buffer.from(sig || '', 'base64url'), v = crypto.verify(null, v1(row.sid, kind, extra, data), nodeKey(row.pub), s) ? 1
      : o.upgraded && crypto.verify(null, v2(row.sid, kind, extra, data), nodeKey(row.pub), s) ? 2 : 0;
    if (v) o.formats.push(`${kind} ${v}`);
    return v;
  };
  o.fetch = async (u, init = {}) => {
    const url = new URL(u), method = init.method || 'GET', body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    if (url.pathname === '/s' && method === 'POST') {
      if (o.sessions.has(body.sid)) return answer(409, say({ error: 'exists' }));
      o.sessions.set(body.sid, { sid: body.sid, pub: Buffer.from(body.pub, 'base64url'), ops: [], base: 0, baseSig: null });
      return answer(201, say({}));
    }
    const m = /^\/s\/([\w-]{22})(?:\/(trim)|\/b\/([\w-]{22}))?$/.exec(url.pathname), row = m && o.sessions.get(m[1]);
    if (!row) return answer(404, { error: 'unknown' });
    if (m[3]) {
      const sig = init.headers?.['x-glaze-sig'];
      if (method === 'PUT') { if (!takes(row, 'blob', m[3], Buffer.from(body), sig)) return answer(403, say({ error: 'signature' })); o.files.set(m[3], Buffer.from(body)); return answer(201, {}); }
      if (method === 'DELETE') { if (!takes(row, 'blob-delete', m[3], Buffer.alloc(0), sig)) return answer(403, say({ error: 'signature' })); o.files.delete(m[3]); return new Response(null, { status: 204 }); }
      return o.files.has(m[3]) ? new Response(o.files.get(m[3])) : answer(404, { error: 'unknown' });
    }
    const head = row.ops.length ? row.ops.at(-1).n : row.base;
    if (m[2]) {
      const last = row.ops.find((x) => x.n === body.upto);
      if (!last) return answer(409, { error: 'stale' });
      if (!takes(row, 'trim', String(body.upto), last.sig, body.sig)) return answer(403, say({ error: 'signature' }));
      Object.assign(row, { ops: row.ops.filter((x) => x.n > body.upto), base: body.upto, baseSig: last.sig });
      return answer(200, { base: body.upto });
    }
    if (method === 'POST') {
      if (body.n !== head + 1) return answer(409, { error: 'place', head });
      const op = Buffer.from(body.op, 'base64url');
      if (!takes(row, 'op', String(body.n), op, body.sig)) return answer(403, say({ error: 'signature' }));
      row.ops.push({ n: body.n, op, sig: Buffer.from(body.sig, 'base64url') });
      return answer(201, { n: body.n });
    }
    const after = Number(url.searchParams.get('after') || 0);
    const at = after > row.base ? row.ops.find((x) => x.n === after)?.sig : after === row.base && after > 0 ? row.baseSig : null;
    return answer(200, say({ head, base: row.base, at: at ? at.toString('base64url') : null, more: false,
      ops: row.ops.filter((x) => x.n > Math.max(after, row.base)).map((x) => ({ n: x.n, op: x.op.toString('base64url'), sig: x.sig.toString('base64url') })) }));
  };
  return o;
};

test('a gate-disabled read does not consume an older device\'s once-only v2 recovery', async () => {
  const older = olderRelay(), old = oldClient(), st = G.create('notes', { server: 'https://relay.test' }), a = G.session(st, { fetch: older.fetch });
  await a.edit({ n1: { title: 'first', html: '' } }); await a.sync();
  const b = old.join(await a.link(false)), bs = old.session(b, { fetch: older.fetch }); await bs.sync();
  older.upgraded = true; await a.sync(); await a.edit({ n1: { title: 'second', html: '' } }); await a.sync();
  for (let i = 0; i < 3; i++) await bs.sync();
  assert.equal(bs.view().n1.title, 'first', 'actual old reader skipped the new signature');
  older.upgraded = false;
  const upgraded = G.session(b, { fetch: older.fetch }); await upgraded.sync();
  assert.equal(b.opens, undefined, 'do not mark the replay complete before capability is visible');
  older.upgraded = true; const out = await upgraded.sync();
  assert.equal(out.bad, 0); assert.equal(upgraded.view().n1.title, 'second');
});

test('SHR-10: the extension writes gzs2 only to a relay that says it takes it, and falls back to gzs1 when it doesn\'t', async () => {
  const older = olderRelay();
  const st = G.create('notes', { server: 'https://relay.test' });
  const s = G.session(st, { fetch: older.fetch });
  // A relay that never says gzs2 (released before it, or not yet updated): everything as before, gzs1.
  await s.edit({ n1: { title: 'One', html: '<p>1</p>' } });
  await s.sync();
  const kept = await s.put(new Uint8Array([1, 2, 3])), dropped = await s.put(new Uint8Array([9]));
  await s.edit({ ...s.view(), f1: { file: { ...kept, n: 'a.bin', t: 'application/octet-stream' } } });
  await s.sync();
  await s.removeFile(dropped.id);
  assert.equal(await s.compact(true), true);
  assert.equal(st.gzs, undefined);
  assert.deepEqual([...new Set(older.formats)].sort(), ['blob 1', 'blob-delete 1', 'op 1', 'trim 1']);
  // The relay is updated: its next answer says gzs2, and every write after it is gzs2. A file sealed before still opens.
  Object.assign(older, { upgraded: true, formats: [] });
  await s.sync();
  assert.equal(st.gzs, 2);
  await s.edit({ ...s.view(), n1: { title: 'Two', html: '<p>2</p>' } });
  await s.sync();
  const fresh = await s.put(new Uint8Array([4, 5]));
  assert.deepEqual([...await s.get(fresh)], [4, 5]);
  assert.deepEqual([...await s.get(kept)], [1, 2, 3]);
  await s.removeFile(kept.id);
  assert.deepEqual(older.formats, ['op 2', 'blob 2', 'blob-delete 2']);
  // Once a v2 write succeeded, rolling back to an older relay must not obtain fresh downgrade signatures.
  Object.assign(older, { upgraded: false, formats: [] });
  await s.edit({ ...s.view(), n1: { title: 'Three', html: '<p>3</p>' } });
  await assert.rejects(s.sync(), /send/);
  assert.equal(st.locked, true); assert.ok(st.pending.length); assert.deepEqual(older.formats, []);
  // A reader on it opens everything, whichever format each batch is in.
  const reader = G.session(G.join(await s.link(false)), { fetch: older.fetch });
  const out = await reader.sync();
  assert.deepEqual([out.bad, reader.view().n1], [0, { title: 'Two', html: '<p>2</p>' }]);
});

test('SHR-8: a create sent again after its answer was lost is made; the relay says so when key and delete hash match', async (t) => {
  const r = await up(t);
  const st = G.create('notes', { server: r.url });
  let lose = true;
  const lossy = async (u, init) => {
    const res = await fetch(u, init);
    if (lose && u.endsWith('/s') && init.method === 'POST') { lose = false; throw new TypeError('network error after the relay committed'); }
    return res;
  };
  const s = G.session(st, { fetch: lossy });
  await s.edit({ n1: { title: 'Biology', html: '<p>cells</p>' } });
  await assert.rejects(s.sync(), /network error/);
  assert.equal(st.made, false);
  await s.sync();
  assert.deepEqual([st.made, st.pending.length, st.gzs], [true, 0, 2]);
  assert.equal((await fetch(`${r.url}/s/${st.sid}`).then((x) => x.json())).head, 1);
  // By hand: the same create again is made (200); another delete hash or another key is not (409).
  const k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
  const del = crypto.createHash('sha256').update(G.unb64(st.del)).digest();
  const body = { sid: st.sid, pub: G.b64(k.pub), del: del.toString('base64url'), expire: false, sig: await signWith(k, v2(st.sid, 'create', '0', del)) };
  assert.deepEqual(await post(`${r.url}/s`, body), { status: 200, body: { gzs: 2 } });
  const otherDel = crypto.randomBytes(32);
  assert.equal((await post(`${r.url}/s`, { ...body, del: otherDel.toString('base64url'), sig: await signWith(k, v2(st.sid, 'create', '0', otherDel)) })).status, 409);
  const other = await randomKeys();
  assert.equal((await post(`${r.url}/s`, { ...body, pub: G.b64(other.pub), sig: await signWith(other, v2(st.sid, 'create', '0', del)) })).status, 409);
  // A signature over other terms than those sent proves nothing: refused, whatever the row.
  assert.equal((await post(`${r.url}/s`, { ...body, expire: true })).status, 403);
  // An older extension's unsigned create, sent again, is made too.
  const old = await randomKeys(), token = crypto.randomBytes(32);
  assert.deepEqual([(await createUnsigned(r, old, token)).status, (await createUnsigned(r, old, token)).status], [201, 200]);
  assert.equal((await createUnsigned(r, old)).status, 409);
});

test('SHR-8: a share id is bound to its key: no other key can register it, before or after its creator does', async (t) => {
  const r = await up(t);
  const st = await G.createBound('notes', { server: r.url });
  const k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
  // The id: four bytes that say it is bound, then the first 12 of SHA-256('glaze share id' + the public key).
  const id = Buffer.from(G.unb64(st.sid));
  assert.deepEqual([...id.subarray(0, 4)], [0x67, 0x7a, 0x62, 0x31]);
  assert.deepEqual(id.subarray(4), crypto.createHash('sha256').update('glaze share id').update(k.pub).digest().subarray(0, 12));
  // Random ids never look bound.
  for (let i = 0; i < 50; i++) assert.notDeepEqual([...G.unb64(G.create('notes').sid).subarray(0, 4)], [0x67, 0x7a, 0x62, 0x31]);
  // The read link went out before the share was registered (made offline). Its holder has the id and the public key.
  const reader = G.join(await G.session(st).link(false), true);
  const rk = await G.keys({ sid: G.unb64(reader.sid), secret: G.unb64(reader.secret), pub: G.unb64(reader.pub) });
  const squat = crypto.randomBytes(32), del = crypto.createHash('sha256').update(squat).digest();
  // Unsigned, with the real public key: refused.
  assert.deepEqual(await createUnsigned(r, rk, squat), { status: 403, body: { error: 'bound', gzs: 2 } });
  // Signed by a key of the squatter's own, with that key: refused, the id isn't that key's.
  const own = await G.keys({ sid: G.unb64(st.sid), seed: crypto.getRandomValues(new Uint8Array(32)) });
  assert.equal((await post(`${r.url}/s`, { sid: st.sid, pub: G.b64(own.pub), del: del.toString('base64url'), sig: await signWith(own, v2(st.sid, 'create', '0', del)) })).status, 403);
  // The real public key with a signature by another key: refused.
  assert.equal((await post(`${r.url}/s`, { sid: st.sid, pub: G.b64(rk.pub), del: del.toString('base64url'), sig: await signWith(own, v2(st.sid, 'create', '0', del)) })).status, 403);
  // The creator registers it and shares, and the reader reads.
  const s = G.session(st);
  await s.edit({ n1: { title: 'Mine', html: '<p>made offline</p>' } });
  await s.sync();
  assert.equal(st.made, true);
  const rs = G.session(reader);
  await rs.sync();
  assert.deepEqual(rs.view(), s.view());
  // Registered, it stays the creator's: an unsigned create with the real key and another delete hash is refused too.
  assert.equal((await createUnsigned(r, rk, squat)).status, 409);
  // The relay reclaims an id nothing was written to (empty-session expiry); the same rules hold when it is free again.
  const idle = await G.createBound('notes', { server: r.url });
  const is = G.session(idle);
  await is.sync();
  assert.equal(idle.made, true);
  r.db.prepare('DELETE FROM sessions WHERE sid = ?').run(idle.sid);
  const ik = await G.keys({ sid: G.unb64(idle.sid), seed: G.unb64(idle.seed) });
  assert.equal((await createUnsigned(r, ik)).status, 403);
  await is.sync(); // the creator finds it unknown and registers it again
  assert.equal(r.db.prepare('SELECT count(*) AS c FROM sessions WHERE sid = ?').get(idle.sid).c, 1);
});

test('an existing id stays its key\'s, for ids made before binding too', async (t) => {
  const r = await up(t);
  const st = G.create('notes', { server: r.url }), s = G.session(st);
  await s.edit({ n1: { title: 'Old style id', html: '' } });
  await s.sync();
  const k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
  const other = await G.keys({ sid: G.unb64(st.sid), seed: crypto.getRandomValues(new Uint8Array(32)) });
  const del = crypto.randomBytes(32);
  assert.equal((await post(`${r.url}/s`, { sid: st.sid, pub: G.b64(other.pub), del: del.toString('base64url'), sig: await signWith(other, v2(st.sid, 'create', '0', del)) })).status, 409);
  assert.equal((await createUnsigned(r, k)).status, 409);
  assert.equal((await createUnsigned(r, other)).status, 409);
});

test('a device whose older version skipped gzs2 batches it could not open reads the log again, once, when updated', async (t) => {
  const r = await up(t);
  const st = G.create('notes', { server: r.url }), a = G.session(st);
  await a.edit({ n1: { title: 'First', html: '' } });
  await a.sync();
  const b = G.join(await a.link(false), true);
  await G.session(b).sync();
  // The editor changes the note; the member's older version couldn't open that batch and skipped it after three tries.
  await a.edit({ n1: { title: 'Second', html: '<p>missed</p>' } });
  await a.sync();
  const page = await fetch(`${r.url}/s/${st.sid}?after=${b.cursor}`).then((x) => x.json());
  Object.assign(b, { cursor: page.head, last: page.ops.at(-1).sig, stuck: null });
  delete b.opens; // as an older version kept it
  let reads = 0;
  const counting = (u, init) => { if (/\?after=0$/.test(u)) reads++; return fetch(u, init); };
  const bs = G.session(b, { fetch: counting });
  const out = await bs.sync();
  assert.deepEqual([bs.view().n1, out.bad, reads], [{ title: 'Second', html: '<p>missed</p>' }, 0, 1]);
  await bs.sync();
  assert.equal(reads, 1, 'only once');
});

test('the relay\'s database goes to version 2; its sessions take gzs1 until they take gzs2', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-gzs2-')), db = path.join(dir, 'share.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let r = await up(t, { db });
  const k = await randomKeys();
  // As a version-1 relay left it: no record of formats.
  r.db.exec('ALTER TABLE sessions DROP COLUMN gzs; PRAGMA user_version = 1');
  r.db.prepare('INSERT INTO sessions (sid, pub, del, touched) VALUES (?, ?, ?, ?)').run(k.sid, k.pub, crypto.randomBytes(32), Math.floor(Date.now() / 864e5));
  await r.close();
  r = await up(t, { db });
  assert.deepEqual([r.db.prepare('PRAGMA user_version').get().user_version, r.db.prepare('SELECT gzs FROM sessions WHERE sid = ?').get(k.sid)?.gzs], [2, 1]);
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 1, ...await G.seal(k, 'op', { y: 'notes', o: [] }, '1', 1) })).status, 201);
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 2, ...await G.seal(k, 'op', { y: 'notes', o: [] }, '2') })).status, 201);
  assert.equal(r.db.prepare('SELECT gzs FROM sessions WHERE sid = ?').get(k.sid).gzs, 2);
  assert.equal((await post(`${r.url}/s/${k.sid}`, { n: 3, ...await G.seal(k, 'op', { y: 'notes', o: [] }, '3', 1) })).status, 403);
  // Opened again, it migrates nothing twice.
  await r.close();
  r = await up(t, { db });
  assert.equal(r.db.prepare('SELECT gzs FROM sessions WHERE sid = ?').get(k.sid).gzs, 2);
});

// The worker's broker (lib/sessions.js) as test/sessions-sync.test.js runs it, without a surface open.
const clone = (x) => (x === undefined ? x : structuredClone(x));
const area = (data = {}) => ({ data, get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])])),
  set: async (patch) => { Object.assign(data, clone(patch)); return true; }, remove: async () => true });
const stores = (...names) => {
  const s = Object.fromEntries(names.map((n) => [n, new Map()]));
  return { get: async (n, k) => clone(s[n].get(k)), all: async (n) => [...s[n].values()].map(clone), put: async (n, k, v) => { s[n].set(k, clone(v)); }, del: async (n, k) => { s[n].delete(k); },
    scan: async (n, p) => [...s[n]].filter(([k]) => k.startsWith(p)), keys: async (n, p) => [...s[n].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ quota: 1e9, usage: 0 }) };
};

test('SHR-8: a share made from Notes has an id bound to its key and is made signed, so it takes gzs2 from the start', async (t) => {
  const r = await up(t);
  const NK = 'notesIdx:https://school.instructure.com/5';
  const local = area({ [NK]: N.clean({}), 'todo:https://school.instructure.com/5': T.clean({}) }), db = stores('sessions', 'files'), notes = stores('bodies', 'files', 'blobs'), serial = K.queue();
  const worker = S.make({ local, sync: area(), db, notes, relay: r.url, dev: true, serial, permission: async () => true, fetch });
  const id = crypto.randomUUID();
  assert.equal((await N.run({ key: NK, op: 'save', id, base: 0, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title: 'Shared', html: '<p>x</p>' }, { local }, notes)).ok, true);
  const { sid } = await serial(() => worker.handle({ op: 'create', kind: 'notes', title: 'Shared', name: 'A', key: NK, ids: [id] }));
  const { st } = await db.get('sessions', sid);
  const k = await G.keys({ sid: G.unb64(sid), seed: G.unb64(st.seed) });
  assert.deepEqual(Buffer.from(G.unb64(sid)), Buffer.concat([Buffer.from([0x67, 0x7a, 0x62, 0x31]), sha(Buffer.concat([Buffer.from('glaze share id'), k.pub])).subarray(0, 12)]));
  assert.deepEqual([st.made, st.gzs, st.pending.length], [true, 2, 0]);
  assert.equal(r.db.prepare('SELECT gzs FROM sessions WHERE sid = ?').get(sid).gzs, 2);
});
