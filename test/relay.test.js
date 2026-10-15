// Share sessions end to end (spike S6): devices (lib/sharing.js) against a relay (server/relay.js) on 127.0.0.1 only.
// Each device keeps a local copy ({ note id: { title, html } }, standing in for the notes library) and its session as
// JSON. Files go to an in-memory store, a temporary folder, or a local S3 mock standing in for R2; never a real bucket.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const G = require('../lib/sharing.js');
const { relay, LIMIT, RATE, sigv4, s3Store, diskStore } = require('../server/relay.js');

const memory = () => { const m = new Map(); return { m, put: async (k, b) => { m.set(k, Buffer.from(b)); }, get: async (k) => m.get(k) || null, del: async (k) => { m.delete(k); } }; };
const up = async (opts = {}, port = 0) => {
  const r = relay({ db: ':memory:', store: memory(), ...opts });
  const a = await r.listen(port, '127.0.0.1');
  return Object.assign(r, { url: `http://127.0.0.1:${a.port}`, port: a.port });
};
// A device: its local copy, its session JSON, and whether it can reach the network.
const device = (st, opts = {}) => {
  const d = { st, local: {}, online: true };
  d.s = G.session(st, { fetch: (...a) => (d.online ? fetch(...a) : Promise.reject(new TypeError('offline'))), ...opts });
  // Local changes out, everything new in, the merged view written back (what the worker would do).
  d.pump = async () => {
    if (st.seed && st.type) await d.s.edit(d.local);
    const r = await d.s.sync();
    d.local = d.s.view();
    return r;
  };
  return d;
};
const make = (r, type = 'notes', opts) => device(G.create(type, { server: r.url, ...opts }));
const reopen = (d, opts) => device(JSON.parse(JSON.stringify(d.st)), opts);
const join = async (link, opts) => device(G.join(link, true), opts);
const ids = (v) => Object.keys(v).sort();
const rows = (r, sid) => r.db.prepare('SELECT count(*) AS c FROM ops WHERE sid = ?').get(sid).c;
const tmp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-relay-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('two devices that edited offline converge; a conflict keeps both texts', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'Cells', html: '<p>one</p>' }, n2: { title: 'Mitosis', html: '<p>two</p>' } };
  await a.pump();
  // b's clock runs a second ahead, so its edits are the later ones (in the same millisecond, the actor ids decide).
  const ahead = { now: () => Date.now() + 1000 };
  const b = await join(await a.s.link(true), ahead);
  await b.pump();
  assert.deepEqual(b.local, a.local);

  a.online = b.online = false;
  a.local.n1.title = 'Cell biology';
  a.local.n2.html = '<p>two, by A</p>';
  a.local.n4 = { title: 'From A', html: '' };
  await assert.rejects(a.pump(), /offline/);
  b.local.n1.html = '<p>one, longer, by B</p>';
  b.local.n2.html = '<p>two, by B</p>';
  b.local.n3 = { title: 'From B', html: '<p>new</p>' };
  delete b.local.n4;
  await assert.rejects(b.pump(), /offline/);
  assert.ok(a.st.pending.length && b.st.pending.length);
  // Closing Glaze while offline loses nothing: the queue is in the session's JSON.
  const a2 = reopen(a), b2 = reopen(b, ahead);
  a2.local = a.local; b2.local = b.local;

  const copies = (await a2.pump()).copies + (await b2.pump()).copies + (await a2.pump()).copies + (await b2.pump()).copies;
  assert.equal(copies, 1);
  assert.deepEqual(a2.local, b2.local);
  const v = a2.local;
  // Different fields of one note both land; the same field keeps the later edit, and the other becomes a copy.
  assert.deepEqual(v.n1, { title: 'Cell biology', html: '<p>one, longer, by B</p>' });
  assert.equal(v.n2.html, '<p>two, by B</p>');
  const copy = Object.entries(v).find(([, n]) => n.title === 'Mitosis (conflict copy)');
  assert.deepEqual(copy?.[1].html, '<p>two, by A</p>');
  assert.deepEqual(ids(v).filter((x) => x.length < 5), ['n1', 'n2', 'n3', 'n4']);
});

test('live: an open device gets a change within a moment; a closed one catches up when reopened', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'Plan', html: '' } };
  await a.pump();
  const b = await join(await a.s.link(true));
  await b.pump();
  let seen;
  const got = new Promise((resolve) => { seen = resolve; });
  const bell = G.live(r.url, [b.st.sid], async (m) => { if (m.n > b.st.cursor) { await b.pump(); if (b.local.n1.html) seen(); } });
  t.after(() => bell.close());
  await new Promise((resolve) => setTimeout(resolve, 100)); // subscribed
  const t0 = performance.now();
  a.local.n1.html = '<p>Read chapter 3</p>';
  await a.pump();
  await got;
  const ms = performance.now() - t0;
  assert.ok(ms < 1000, `${ms} ms`);
  t.diagnostic(`edit to an open device: ${ms.toFixed(1)} ms (send, ring, catch up)`);

  bell.close();
  const saved = JSON.stringify(b.st);
  for (const html of ['<p>1</p>', '<p>2</p>', '<p>3</p>']) { a.local.n1.html = html; await a.pump(); }
  a.local.n2 = { title: 'Added while closed', html: '' };
  await a.pump();
  const back = device(JSON.parse(saved));
  back.local = b.local;
  await back.pump();
  assert.deepEqual(back.local, a.local);
});

test('the relay keeps sessions across a restart', async (t) => {
  const db = path.join(tmp(t), 'share.db');
  let r = await up({ db });
  const a = make(r, 'look');
  const { encode } = require('../lib/share.js');
  const { GZ_SANITIZE } = require('../defaults.js');
  a.local = { look: { name: 'Frost', code: await encode(GZ_SANITIZE({})) } };
  await a.pump();
  const port = r.port;
  await r.close();
  r = await up({ db }, port);
  t.after(() => r.close());
  const b = await join(await a.s.link(false));
  await b.pump();
  assert.equal(b.st.type, 'look');
  assert.deepEqual(b.local, a.local);
});

test('read links read; nothing they hold can write, and a signed batch sent again is refused (no replay)', async (t) => {
  const r = await up({ limit: { ...LIMIT, session: 4000 } });
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'Shared', html: '<p>x</p>' } };
  await a.pump();
  const c = await join(await a.s.link(false));
  await c.pump();
  assert.deepEqual(c.local, a.local);
  await assert.rejects(c.s.edit({ n1: { title: 'Mine now', html: '' } }), /read-only/);
  assert.equal((await c.s.link(true)).includes('#1.r.'), true); // a read link only ever passes on a read link
  const post = (body) => fetch(`${r.url}/s/${a.st.sid}`, { method: 'POST', body: JSON.stringify(body) });
  // A batch sealed with the read secret but signed by another key.
  const k = await G.keys(G.parse(await a.s.link(false), true));
  const rogue = await G.keys({ sid: G.unb64(k.sid), seed: crypto.getRandomValues(new Uint8Array(32)) });
  assert.equal((await post({ n: 2, ...await G.seal({ ...rogue, enc: k.enc }, 'op', { y: 'notes', o: [] }, '2') })).status, 403);
  // An editor's real batch, read back and sent again: its place is taken, and it's signed for no other place.
  const got = await (await fetch(`${r.url}/s/${a.st.sid}?after=0`)).json();
  const [first] = got.ops;
  assert.equal((await post(first)).status, 409);
  for (let i = 0; i < 20; i++) assert.equal((await post({ ...first, n: got.head + 1 })).status, 403);
  assert.equal(rows(r, a.st.sid), 1);
  a.local.n1.html = '<p>still room for the editor</p>';
  await a.pump();
});

test('a relay that tampers can withhold but not forge; a bad batch is tried again, then skipped', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'Real', html: '<p>real</p>' } };
  await a.pump();
  a.local.n2 = { title: 'Second', html: '' };
  await a.pump();
  const other = make(r);
  other.local = { n1: { title: 'From another session', html: '' } };
  await other.pump();
  const b = await join(await a.s.link(true));
  // The relay corrupts batch 2 for a while, and appends another session's batch (validly signed there) as batch 3.
  const real = r.db.prepare('SELECT op FROM ops WHERE sid = ? AND n = 2').get(a.st.sid).op;
  const flipped = Buffer.from(real);
  flipped[40] ^= 1;
  r.db.prepare('UPDATE ops SET op = ? WHERE sid = ? AND n = 2').run(flipped, a.st.sid);
  const steal = r.db.prepare('SELECT op, sig FROM ops WHERE sid = ?').get(other.st.sid);
  r.db.prepare('INSERT INTO ops (sid, n, op, sig) VALUES (?, 3, ?, ?)').run(a.st.sid, steal.op, steal.sig);
  r.db.prepare('UPDATE sessions SET head = 3 WHERE sid = ?').run(a.st.sid);
  let got = await b.pump();
  assert.deepEqual([got.bad, got.more, b.st.cursor], [1, true, 1]);
  assert.deepEqual(b.local, { n1: { title: 'Real', html: '<p>real</p>' } });
  // The relay recovers: the next sync reads batch 2 after all.
  r.db.prepare('UPDATE ops SET op = ? WHERE sid = ? AND n = 2').run(real, a.st.sid);
  got = await b.pump();
  assert.equal(b.local.n2.title, 'Second');
  // Batch 3 never opens here: tried on three syncs, then skipped for good.
  assert.equal(got.bad, 1);
  got = await b.pump();
  assert.equal(got.bad, 1);
  got = await b.pump();
  assert.deepEqual([got.bad, got.more, b.st.cursor], [1, false, 3]);
  assert.deepEqual(b.local, a.local);
});

test('compaction: the state goes past a trim; new and long-gone members catch up, and three 400 KB notes fit', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = make(r);
  const old = await join(await a.s.link(true));
  a.local = { n1: { title: 'v0', html: '' } };
  await a.pump();
  await old.pump();
  for (let i = 1; i <= 12; i++) { a.local.n1.title = `v${i}`; a.local[`n${i + 1}`] = { title: `note ${i}`, html: `<p>${i}</p>` }; if (i % 3 === 0) delete a.local[`n${i}`]; await a.pump(); }
  assert.equal(await a.s.compact(), false); // not yet worth it
  const before = a.st.cursor;
  assert.equal(await a.s.compact(true), true);
  assert.equal(r.db.prepare('SELECT min(n) AS n FROM ops WHERE sid = ?').get(a.st.sid).n, before + 1);
  // A trim signed for this log doesn't apply to another: sent again, it's stale.
  assert.equal((await fetch(`${r.url}/s/${a.st.sid}/trim`, { method: 'POST', body: JSON.stringify({ upto: before, sig: 'A'.repeat(86) }) })).status, 409);
  a.local.n1.html = '<p>after the trim</p>';
  await a.pump();
  const fresh = await join(await a.s.link(false));
  await fresh.pump();
  await old.pump();
  assert.deepEqual(fresh.local, a.local);
  assert.deepEqual(old.local, a.local);
  // Deleted notes' text (n3 was "note 2") isn't in what a new member reads.
  const text = JSON.stringify(fresh.st.state);
  assert.ok(!text.includes('<p>2</p>') && !text.includes('"note 2"'));
  // A member from before the trim restores a deleted note from its own copy: it comes back whole for the new member.
  old.local.n3 = { title: 'note 2', html: '<p>2</p>' };
  await old.pump();
  await fresh.pump();
  assert.deepEqual(fresh.local.n3, { title: 'note 2', html: '<p>2</p>' });

  // Normal notes of 400 KB each: every one seals on its own, and compaction sends them in as many batches.
  const big = make(r);
  big.local = Object.fromEntries([1, 2, 3].map((i) => [`b${i}`, { title: `Big ${i}`, html: `<p>${String(i).repeat(400000)}</p>` }]));
  await big.pump();
  for (let i = 0; i < 3; i++) { big.local.b1.title = `Big 1, edit ${i}`; await big.pump(); }
  assert.equal(await big.s.compact(true), true);
  const late = await join(await big.s.link(false));
  await late.pump();
  assert.deepEqual(late.local, big.local);
});

test('deletion: only the creator deletes; members keep their copies, files go, and the id is never reused', async (t) => {
  const store = memory();
  const r = await up({ store });
  t.after(() => r.close());
  const a = make(r);
  const pic = crypto.getRandomValues(new Uint8Array(5000));
  a.local = { n1: { title: 'Bye', html: '<p>soon gone</p>' }, f1: { file: { ...await a.s.put(pic), n: 'a.png', t: 'image/png' } } };
  await a.pump();
  assert.equal(store.m.size, 1);
  const b = await join(await a.s.link(true));
  await b.pump();
  await assert.rejects(b.s.remove(), /not creator/);
  const wrong = await fetch(`${r.url}/s/${a.st.sid}`, { method: 'DELETE', headers: { authorization: `Bearer ${G.b64(new Uint8Array(32))}` } });
  assert.equal(wrong.status, 403);
  let rang;
  const gone = new Promise((resolve) => { rang = resolve; });
  const bell = G.live(r.url, [b.st.sid], (m) => { if (m.gone) rang(); });
  t.after(() => bell.close());
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await a.s.remove(), true);
  await gone;
  await r.expire(); // waits for the files' removal
  assert.equal(store.m.size, 0);
  assert.equal((await fetch(`${r.url}/s/${a.st.sid}`)).status, 410);
  assert.deepEqual(await b.pump(), { gone: true });
  assert.equal(b.local.n1.title, 'Bye');
  assert.equal(rows(r, a.st.sid), 0);
  const again = await fetch(`${r.url}/s`, { method: 'POST', body: JSON.stringify({ sid: a.st.sid, pub: G.b64(new Uint8Array(32)), del: G.b64(new Uint8Array(32)) }) });
  assert.equal(again.status, 409);
});

test('limits: batch size, session size, request rates and subscriptions', async (t) => {
  const r = await up({ limit: { ...LIMIT, op: 2048, session: 6000, body: 8000 }, rate: { ...RATE, create: [3, 3600e3] } });
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  a.local.n1.html = `<p>${'x'.repeat(3000)}</p>`;
  await assert.rejects(a.pump(), (e) => e.status === 413);
  a.st.pending = [];
  // Each of these seals to about 1.8 KB: three fit in the session's 6,000 bytes, the fourth doesn't.
  for (let i = 0; i < 3; i++) { a.local.n1.html = `<p>${String(i).repeat(1500)}</p>`; await a.pump(); }
  a.local.n1.html = `<p>${'y'.repeat(1500)}</p>`;
  await assert.rejects(a.pump(), (e) => e.status === 507);
  const big = await fetch(`${r.url}/s/${a.st.sid}`, { method: 'POST', body: JSON.stringify({ n: 9, op: 'A'.repeat(9000), sig: 'A'.repeat(86) }) }).catch(() => ({ status: 'reset' }));
  assert.equal(big.status, 413);
  const made = [];
  for (let i = 0; i < 3; i++) made.push((await fetch(`${r.url}/s`, { method: 'POST', body: JSON.stringify({ sid: G.b64(crypto.getRandomValues(new Uint8Array(16))), pub: 'A'.repeat(43), del: 'A'.repeat(43) }) })).status);
  assert.deepEqual(made, [201, 201, 429]); // the first session above was the third
  const ws = new WebSocket(`${r.url.replace('http', 'ws')}/live`);
  const closed = new Promise((resolve) => { ws.onclose = (e) => resolve(e.code); });
  ws.onopen = () => ws.send(JSON.stringify({ sub: Array.from({ length: LIMIT.sub + 1 }, () => a.st.sid) }));
  assert.equal(await closed, 1008);
  const c = make(r);
  // (A note's longest HTML, 2 MiB of characters, fits; three-byte characters can pass the batch cap.)
  assert.deepEqual(await c.s.edit({ long: { title: 'Long', html: `<p>${'€'.repeat(1500000)}</p>` } }), { n: 1, big: ['long'] });
});

test('a malformed WebSocket request is refused, and the relay keeps running', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const reply = await new Promise((resolve, reject) => {
    const sock = net.connect(r.port, '127.0.0.1', () => sock.write('GET http://[ HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
    let got = '';
    sock.on('data', (d) => { got += d; });
    sock.on('end', () => resolve(got));
    sock.on('error', reject);
  });
  assert.match(reply, /^HTTP\/1\.1 400/);
  assert.equal((await fetch(`${r.url}/health`)).status, 200);
});

test('subscriptions leave nothing behind when a socket moves to other sessions and closes', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const ids2 = [G.b64(crypto.getRandomValues(new Uint8Array(16))), G.b64(crypto.getRandomValues(new Uint8Array(16)))];
  const ws = new WebSocket(`${r.url.replace('http', 'ws')}/live`);
  await new Promise((resolve) => { ws.onopen = resolve; });
  ws.send(JSON.stringify({ sub: [ids2[0]] }));
  ws.send(JSON.stringify({ sub: [ids2[1]] }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual([...r.subs.keys()], [ids2[1]]);
  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(r.subs.size, 0);
});

test('sync has a budget: a relay that never finishes, keeps changing its story, stalls or floods is stopped', async () => {
  const st = G.create('notes', { server: 'https://relay.test' });
  st.made = true;
  const k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
  const real = await G.seal(k, 'op', { y: 'notes', o: [] }, '1');
  const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  const run = async (answer, opts = {}) => {
    let calls = 0;
    const s = G.session(JSON.parse(JSON.stringify(st)), { fetch: async (u, init) => { calls++; return answer(u, init, calls); }, ...opts });
    const t0 = Date.now();
    const out = await s.sync().then((x) => x, (e) => e);
    return { out, calls, ms: Date.now() - t0, s };
  };
  // "more" forever, with nothing new.
  let x = await run(() => json({ head: 5, base: 0, at: null, ops: [], more: true }));
  assert.match(x.out.message, /read/);
  assert.ok(x.calls <= 2, `${x.calls} calls`);
  // A different "last batch" every time: one restart, then it stops.
  x = await run((u, init, n) => json({ head: 1, base: 0, at: n === 1 ? null : `other${n}`, ops: [{ n: 1, ...real }], more: true }));
  assert.match(x.out.message ?? '', /read/);
  assert.equal(x.calls, 4);
  // No answer at all: the request times out.
  x = await run((u, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), { timeout: 50 });
  assert.match(x.out.message, /aborted/);
  assert.ok(x.ms < 1000);
  // An endless body: read up to the cap, then dropped.
  let sent = 0;
  const flood = new ReadableStream({ pull: (c) => { sent += 65536; c.enqueue(new Uint8Array(65536)); } });
  x = await run(() => new Response(flood, { status: 200 }));
  assert.match(x.out.message, /big/);
  assert.ok(sent < G.LIMIT.op * 3, `${sent} bytes read`);
  // A stop from the caller ends it at once.
  const ctl = new AbortController();
  ctl.abort();
  x = await run(() => json({ head: 0, base: 0, at: null, ops: [], more: false }), { signal: ctl.signal });
  assert.match(x.out.message, /aborted/);
  assert.equal(x.calls, 0);
});

test('a relay restored from an older backup heals, even from a member who only read the state after a trim', async (t) => {
  const dir = tmp(t);
  const db = path.join(dir, 'share.db'), backup = path.join(dir, 'backup.db');
  let r = await up({ db });
  const a = make(r);
  a.local = { n1: { title: 'Before the backup', html: '' } };
  await a.pump();
  r.db.exec(`VACUUM INTO '${backup}'`);
  a.local.n2 = { title: 'After the backup', html: '<p>lost by the server</p>' };
  await a.pump();
  assert.equal(await a.s.compact(true), true);
  // d joins after the trim: everything it has came from the state sent past it.
  const d = await join(await a.s.link(true));
  await d.pump();
  assert.deepEqual(ids(d.local), ['n1', 'n2']);
  d.local.n3 = { title: 'From d', html: '' };
  await d.pump();
  const port = r.port;
  await r.close();
  fs.copyFileSync(backup, db);
  for (const x of ['-wal', '-shm']) fs.rmSync(db + x, { force: true });
  r = await up({ db }, port);
  t.after(() => r.close());
  // Only d comes back (a is gone for good). A kept-alive connection to the old process may fail once.
  await d.pump().catch(() => d.pump());
  const fresh = await join(await a.s.link(false));
  await fresh.pump();
  assert.deepEqual(ids(fresh.local), ['n1', 'n2', 'n3']);
  assert.deepEqual(fresh.local, d.local);
});

test('files: sealed, uploaded by editors only, checked on the way back; through a local S3 mock as for R2', async (t) => {
  const s3 = await mockS3();
  t.after(() => s3.close());
  const r = await up({ store: s3Store({ endpoint: s3.url, bucket: 'glaze-share', keyId: 'TESTKEY', secret: 'test-secret' }), limit: { ...LIMIT, blobs: 30000 } });
  t.after(() => r.close());
  const a = make(r);
  const pic = crypto.getRandomValues(new Uint8Array(10000));
  const ref = await a.s.put(pic);
  a.local = { n1: { title: 'With a picture', html: '<p><img data-gz-file="f1"></p>' }, f1: { file: { ...ref, n: 'cell.png', t: 'image/png' } } };
  await a.pump();
  // What the bucket holds is ciphertext, padded: never the picture's bytes.
  const [key] = s3.objects.keys();
  assert.equal(key, `${a.st.sid}/${ref.id}`);
  assert.equal(s3.objects.get(key).length, 12288 + 28);
  assert.equal(s3.objects.get(key).includes(Buffer.from(pic.subarray(0, 64))), false);
  const b = await join(await a.s.link(false));
  await b.pump();
  assert.deepEqual(Buffer.from(await b.s.get(b.local.f1.file)), Buffer.from(pic));
  // A swapped file fails its hash; a reader can't upload; an upload can't be replaced.
  const swapped = Buffer.from(s3.objects.get(key));
  swapped[100] ^= 1;
  s3.objects.set(key, swapped);
  await assert.rejects(b.s.get(b.local.f1.file), /signature/);
  await assert.rejects(b.s.put(pic), /read-only/);
  const blob = Buffer.alloc(4124, 7);
  assert.equal((await fetch(`${r.url}/s/${a.st.sid}/b/${ref.id}`, { method: 'PUT', headers: { 'x-glaze-sig': 'A'.repeat(86) }, body: blob })).status, 409);
  assert.equal((await fetch(`${r.url}/s/${a.st.sid}/b/${'C'.repeat(22)}`, { method: 'PUT', headers: { 'x-glaze-sig': 'A'.repeat(86) }, body: blob })).status, 403);
  // The session's room for files: 30,000 bytes here.
  await a.s.put(new Uint8Array(10000));
  await assert.rejects(a.s.put(new Uint8Array(10000)), (e) => e.status === 507);
  // Every request to the bucket was signed (SigV4) and carried its body's hash.
  assert.ok(s3.seen.length >= 4 && s3.seen.every((x) => x.ok), JSON.stringify(s3.seen.filter((x) => !x.ok)));
  // Deleting the share empties its part of the bucket.
  await a.s.remove();
  await r.expire();
  assert.equal(s3.objects.size, 0);
});

test('files on the relay\'s own disk, for self-hosting without R2', async (t) => {
  const dir = tmp(t);
  const r = await up({ store: diskStore(path.join(dir, 'blobs')) });
  t.after(() => r.close());
  const a = make(r);
  const ref = await a.s.put(new TextEncoder().encode('lecture slides'));
  assert.equal(new TextDecoder().decode(await a.s.get(ref)), 'lecture slides');
  assert.ok(fs.existsSync(path.join(dir, 'blobs', a.st.sid, ref.id)));
  await a.s.remove();
  await r.expire();
  assert.equal(fs.existsSync(path.join(dir, 'blobs', a.st.sid)), false);
});

test('expiry: opt-in, the creator\'s choice; a share nobody used for a year goes, the rest stay', async (t) => {
  const store = memory();
  const r = await up({ store });
  t.after(() => r.close());
  const keep = make(r);
  const drop = make(r, 'notes', { expire: true });
  const later = make(r);
  for (const d of [keep, drop, later]) { d.local = { n1: { title: 'x', html: '' } }; await d.pump(); }
  await drop.s.put(new Uint8Array(100));
  assert.equal(await later.s.expiry(true), true);
  assert.equal((await fetch(`${r.url}/s/${later.st.sid}/expiry`, { method: 'POST', headers: { authorization: `Bearer ${G.b64(new Uint8Array(32))}` }, body: '{"on":false}' })).status, 403);
  // A year passes for every session; only the ones that opted in go.
  r.db.prepare('UPDATE sessions SET touched = touched - 366').run();
  await r.expire();
  assert.deepEqual(await Promise.all([keep, drop, later].map(async (d) => (await fetch(`${r.url}/s/${d.st.sid}`)).status)), [200, 410, 410]);
  assert.equal(store.m.size, 0);
  // Used within the year: kept.
  const used = make(r, 'notes', { expire: true });
  used.local = { n1: { title: 'x', html: '' } };
  await used.pump();
  r.db.prepare('UPDATE sessions SET touched = touched - 300 WHERE sid = ?').run(used.st.sid);
  await r.expire();
  assert.equal((await fetch(`${r.url}/s/${used.st.sid}`)).status, 200);
});

test('keys from Export all bring a share back on a new computer, delete rights included', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'Backed up', html: '<p>x</p>' } };
  await a.pump();
  const moved = device(G.importKeys(JSON.parse(JSON.stringify(G.exportKeys(a.st))), true));
  await moved.pump();
  assert.deepEqual(moved.local, a.local);
  moved.local.n1.html = '<p>from the new computer</p>';
  await moved.pump();
  await a.pump();
  assert.equal(a.local.n1.html, '<p>from the new computer</p>');
  assert.equal(await moved.s.remove(), true);
  assert.deepEqual(await a.pump(), { gone: true });
});

test('SigV4 matches AWS\'s published test vectors', () => {
  const base = { keyId: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', date: new Date('2015-08-30T12:36:00Z') };
  // aws4_testsuite get-vanilla and post-x-www-form-urlencoded (botocore tests/unit/auth/aws4_testsuite)
  assert.match(sigv4({ ...base, method: 'GET', url: 'https://example.amazonaws.com/' }).authorization, /SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31$/);
  assert.match(sigv4({ ...base, method: 'POST', url: 'https://example.amazonaws.com/', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'Param1=value1' }).authorization,
    /SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a$/);
});

// A local stand-in for an S3-compatible bucket (R2): checks each request's SigV4 header shape and body hash.
async function mockS3() {
  const objects = new Map(), seen = [];
  const srv = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => {
      const body = Buffer.concat(parts);
      const ok = /^AWS4-HMAC-SHA256 Credential=TESTKEY\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(req.headers.authorization || '')
        && req.headers['x-amz-content-sha256'] === crypto.createHash('sha256').update(body).digest('hex');
      seen.push({ method: req.method, url: req.url, ok });
      const key = req.url.startsWith('/glaze-share/') && req.url.slice('/glaze-share/'.length);
      if (!ok || !key) { res.writeHead(403); return res.end(); }
      if (req.method === 'PUT') { objects.set(key, body); res.writeHead(200); return res.end(); }
      if (req.method === 'GET') { const o = objects.get(key); res.writeHead(o ? 200 : 404); return res.end(o); }
      if (req.method === 'DELETE') { objects.delete(key); res.writeHead(204); return res.end(); }
      res.writeHead(405);
      return res.end();
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return { objects, seen, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((resolve) => { srv.closeAllConnections(); srv.close(resolve); }) };
}
