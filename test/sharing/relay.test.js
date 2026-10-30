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
const { spawn } = require('node:child_process');
const G = require('../lib/sharing.js');
const { relay, backup, LIMIT, RATE, sigv4, s3Store, diskStore } = require('../server/relay.js');

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
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Polls until check() is true or ms pass; returns the last answer, so a test asserts on it.
const until = async (check, ms = 2000) => { const end = Date.now() + ms; for (;;) { const ok = await check(); if (ok || Date.now() > end) return ok; await sleep(25); } };
const handshake = (p, key = true) => `GET ${p} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n${key ? 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' : ''}Sec-WebSocket-Version: 13\r\n\r\n`;
const connections = (r) => new Promise((resolve, reject) => r.server.getConnections((e, n) => (e ? reject(e) : resolve(n))));

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
  // Each of these seals to about 1.8 KB: three fit in the session's 6,000 bytes, the fourth doesn't. The log is full,
  // so that send compacts it: trimmed to what this device has read, with the whole state (one note) after the trim.
  for (let i = 0; i < 3; i++) { a.local.n1.html = `<p>${String(i).repeat(1500)}</p>`; await a.pump(); }
  a.local.n1.html = `<p>${'y'.repeat(1500)}</p>`;
  await a.pump();
  assert.deepEqual([a.st.base, a.st.head, rows(r, a.st.sid)], [4, 5, 1]);
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

test('a full log (507) makes room: trimmed to what the sender read, the state sent after it; a member behind catches up', async (t) => {
  const r = await up({ limit: { ...LIMIT, session: 8000 } });
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'one', html: '<p>1</p>' }, n2: { title: 'two', html: '' } };
  await a.pump();
  const late = await join(await a.s.link(false));
  await late.pump(); // and then reads nothing while the log fills and is trimmed past it
  for (let i = 0; i < 8; i++) { a.local.n2.html = `<p>${String(i).repeat(1500)}</p>`; await a.pump(); }
  assert.ok(a.st.base > late.st.cursor, `trimmed to ${a.st.base}`);
  assert.equal(a.st.pending.length, 0);
  await late.pump();
  assert.deepEqual(late.local, a.local);
  // A state that can't fit even in an empty log: one try at making room per sync, then 507 with the state still queued.
  for (let i = 3; i <= 7; i++) a.local[`n${i}`] = { title: `${i}`, html: `<p>${String(i).repeat(1500)}</p>` };
  const pushes = () => r.db.prepare('SELECT head FROM sessions WHERE sid = ?').get(a.st.sid).head;
  await assert.rejects(a.pump(), (e) => e.status === 507);
  assert.ok(a.st.pending.flat().some((o) => o.e === 'n7'));
  const head = pushes();
  await assert.rejects(a.pump(), (e) => e.status === 507);
  assert.equal(pushes(), head, 'nothing more lands');
});

test('a request refused whatever it carries is answered before its body is read', { timeout: 10000 }, async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'Cells', html: '' } };
  await a.pump();
  const id = () => crypto.randomBytes(16).toString('base64url');
  // The headers promise 20 MB and nothing more is sent: only an answer that doesn't wait for the body comes back.
  const ask = (line, extra = '') => new Promise((resolve, reject) => {
    const s = net.connect(r.port, '127.0.0.1');
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) { s.destroy(); resolve(got.split('\r\n')[0]); } });
    s.on('error', reject);
    s.write(`${line} HTTP/1.1\r\nHost: relay\r\n${extra}Content-Type: application/octet-stream\r\nContent-Length: ${20 << 20}\r\n\r\n`);
  });
  assert.match(await ask(`PUT /s/${id()}/b/${id()}`, `X-Glaze-Sig: ${'A'.repeat(86)}\r\n`), / 404 /, 'a file for a share that does not exist');
  assert.match(await ask(`POST /s/${id()}`), / 404 /, 'a batch for a share that does not exist');
  assert.match(await ask(`PUT /s/${a.st.sid}/b/${id()}`), / 400 /, 'a file without a signature');
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

// A relay in its own process, so a crash shows as an exit code rather than taking the test runner down with it.
const relayProcess = async (t) => {
  const dir = tmp(t);
  const code = `const { relay, diskStore } = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'relay.js'))});
    relay({ db: ${JSON.stringify(path.join(dir, 'share.db'))}, store: diskStore(${JSON.stringify(path.join(dir, 'blobs'))}) })
      .listen(0, '127.0.0.1').then((a) => console.log('PORT', a.port));`;
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => p.kill());
  let out = '', err = '';
  p.stderr.on('data', (d) => { err += d; });
  const port = await new Promise((resolve, reject) => {
    p.stdout.on('data', (d) => { out += d; const m = /PORT (\d+)/.exec(out); if (m) resolve(Number(m[1])); });
    p.on('exit', (c) => reject(new Error(`relay exited ${c}: ${err}`)));
  });
  return { p, port, url: `http://127.0.0.1:${port}`, err: () => err };
};

test('SHR-1: a refused WebSocket upgrade that the client resets does not take the relay down', { timeout: 20000 }, async (t) => {
  const c = await relayProcess(t);
  // The client resets once the refusal arrives ('answer'), or straight after sending ('now').
  const reset = (p, when, key = true) => new Promise((resolve) => {
    const s = net.connect(c.port, '127.0.0.1', () => { s.write(handshake(p, key)); if (when === 'now') setImmediate(() => s.resetAndDestroy()); });
    s.once('data', () => s.resetAndDestroy());
    s.on('error', () => {});
    s.on('close', resolve);
  });
  for (const [p, key] of [['/nope', true], ['/', true], ['/live', false]]) for (const when of ['answer', 'now']) await reset(p, when, key);
  assert.equal(c.p.exitCode, null, `the relay exited: ${c.err()}`);
  // 429: the address's sockets are all taken, and one more is refused.
  const open = [];
  t.after(() => { for (const ws of open) ws.close(); });
  for (let i = 0; i < LIMIT.sockets; i++) {
    const ws = new WebSocket(`ws://127.0.0.1:${c.port}/live`);
    open.push(ws);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  }
  for (let i = 0; i < 5; i++) await reset('/live', 'answer');
  await sleep(300);
  assert.equal(c.p.exitCode, null, `the relay exited: ${c.err()}`);
  assert.equal((await fetch(`${c.url}/health`)).status, 200);
});

test('SHR-1: refused upgrades are closed at once, even while the client keeps sending; a global cap bounds live sockets', { timeout: 20000 }, async (t) => {
  const clients = [];
  const r = await up({ ipHeader: 'x-real-ip', limit: { ...LIMIT, socketsAll: 3 } });
  r.server.on('connection', (s) => clients.push(s)); // teardown also closes descriptors leaked by the archived relay
  t.after(() => { for (const s of clients) s.destroy(); return r.close(); });
  // Ten refused upgrades, each followed by 4 MB the relay never reads and a FIN that can't be sent until it does.
  const stuffed = [];
  t.after(() => { for (const s of stuffed) s.destroy(); });
  for (let i = 0; i < 10; i++) {
    const s = net.connect(r.port, '127.0.0.1', () => { s.write(handshake('/nope') + 'x'.repeat(4 << 20)); s.end(); });
    s.on('error', () => {});
    s.resume();
    stuffed.push(s);
    clients.push(s);
  }
  assert.equal(await until(async () => (await connections(r)) === 0), true, `${await connections(r)} refused sockets still open`);
  // Live sockets from three addresses fill the relay-wide cap; a fourth address is refused until one closes.
  const status = (ip) => new Promise((resolve, reject) => {
    const s = net.connect(r.port, '127.0.0.1', () => s.write(handshake('/live').replace('Host: x\r\n', `Host: x\r\nX-Real-IP: ${ip}\r\n`)));
    clients.push(s);
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) resolve({ s, line: got.split('\r\n')[0] }); });
    // macOS resets a socket the accept-time cap closes; Linux closes it cleanly. Both are a refusal before headers.
    s.on('error', (e) => (e.code === 'ECONNRESET' ? resolve({ s, line: got.split('\r\n')[0] }) : reject(e)));
    s.on('close', () => resolve({ s, line: got.split('\r\n')[0] }));
    t.after(() => s.destroy());
  });
  const live = [];
  for (const ip of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) live.push(await status(ip));
  assert.deepEqual(live.map((x) => x.line.split(' ')[1]), ['101', '101', '101']);
  assert.match((await status('203.0.113.4')).line, /^(?:HTTP\/1\.1 503 |$)/); // accept-time cap may close before headers
  live[0].s.destroy();
  assert.equal(await until(async () => / 101 /.test((await status('203.0.113.5')).line)), true);
});

test('SHR-1: a request refused before its body is read has its connection closed, not left holding the body', { timeout: 10000 }, async (t) => {
  const r = await up();
  t.after(() => r.close());
  const id = () => crypto.randomBytes(16).toString('base64url');
  const ended = await new Promise((resolve) => {
    const s = net.connect(r.port, '127.0.0.1', () => s.write(`PUT /s/${id()}/b/${id()} HTTP/1.1\r\nHost: relay\r\nX-Glaze-Sig: ${'A'.repeat(86)}\r\nContent-Length: ${20 << 20}\r\n\r\n`));
    let got = '';
    s.on('data', (d) => { got += d; });
    s.on('error', () => {});
    s.on('close', () => resolve(got.split('\r\n')[0]));
    setTimeout(() => { resolve('still open'); s.destroy(); }, 2000);
  });
  assert.match(ended, / 404 /);
});

test('SHR-6: upload bodies in flight are capped per address and overall, spooled to disk, and charged before they are read', { timeout: 20000 }, async (t) => {
  const dir = tmp(t);
  const spool = path.join(dir, 'spool');
  const r = await up({ ipHeader: 'x-real-ip', spool, limit: { ...LIMIT, inflight: 250000, inflightAll: 350000 } });
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  const id = () => crypto.randomBytes(16).toString('base64url');
  // An unsigned upload that declares 100,000 bytes, sends half of them and waits: answered at once, or held.
  const held = [];
  t.after(() => { for (const s of held) s.destroy(); });
  const hold = (ip, len = 100000) => new Promise((resolve) => {
    const s = net.connect(r.port, '127.0.0.1', () => s.write(`PUT /s/${a.st.sid}/b/${id()} HTTP/1.1\r\nHost: x\r\nX-Real-IP: ${ip}\r\nX-Glaze-Sig: ${'A'.repeat(86)}\r\nContent-Length: ${len}\r\n\r\n${'x'.repeat(len / 2)}`));
    let got = '';
    s.on('data', (d) => { got += d; });
    s.on('error', () => {});
    held.push(s);
    setTimeout(() => resolve(/^HTTP\/1\.1 (\d+)/.exec(got)?.[1] ?? 'held'), 300);
  });
  // One address: two fit in its 250,000 bytes, the rest are refused before anything is read.
  const one = [];
  for (let i = 0; i < 6; i++) one.push(await hold('203.0.113.1'));
  assert.deepEqual(one, ['held', 'held', '429', '429', '429', '429']);
  // Another address fits once more in the relay's 350,000 bytes; then the relay is full for everyone.
  assert.deepEqual([await hold('203.0.113.2'), await hold('203.0.113.2'), await hold('203.0.113.3')], ['held', '503', '503']);
  // What's held is on disk, not in memory: one spool file per held upload.
  assert.equal(await until(() => fs.readdirSync(spool).filter((f) => f.endsWith('.part')).length === 3), true, `spool: ${fs.readdirSync(spool)}`);
  // Clients that give up release their room and their spool files.
  for (const s of held.splice(0)) s.destroy();
  assert.equal(await until(() => fs.readdirSync(spool).length === 0), true, `spool: ${fs.readdirSync(spool)}`);
  assert.equal(await until(async () => (await hold('203.0.113.3')) === 'held'), true);

  // A body without a declared length is refused (411), and one declared over the cap is refused before it's read (413).
  const answer = (head) => new Promise((resolve) => {
    const s = net.connect(r.port, '127.0.0.1', () => s.write(head));
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) { s.destroy(); resolve(got.split('\r\n')[0]); } });
    s.on('error', () => resolve('reset'));
    setTimeout(() => { s.destroy(); resolve('no answer'); }, 2000);
  });
  assert.match(await answer(`PUT /s/${a.st.sid}/b/${id()} HTTP/1.1\r\nHost: x\r\nX-Real-IP: 203.0.113.9\r\nX-Glaze-Sig: ${'A'.repeat(86)}\r\nTransfer-Encoding: chunked\r\n\r\n1000\r\n`), / 411 /);
  assert.match(await answer(`PUT /s/${a.st.sid}/b/${id()} HTTP/1.1\r\nHost: x\r\nX-Real-IP: 203.0.113.9\r\nX-Glaze-Sig: ${'A'.repeat(86)}\r\nContent-Length: ${LIMIT.blob + 1}\r\n\r\n`), / 413 /);
  assert.match(await answer(`POST /s/${a.st.sid} HTTP/1.1\r\nHost: x\r\nX-Real-IP: 203.0.113.9\r\nContent-Length: ${LIMIT.body + 1}\r\n\r\n`), / 413 /);

  // Uploads with bad signatures pay for their bytes like any other: the budget is charged from the declared length.
  const r2 = await up({ rate: { ...RATE, bytes: [150000, 3600e3] } });
  t.after(() => r2.close());
  const b = make(r2);
  b.local = { n1: { title: 'x', html: '' } };
  await b.pump();
  const bogus = () => fetch(`${r2.url}/s/${b.st.sid}/b/${id()}`, { method: 'PUT', headers: { 'x-glaze-sig': 'A'.repeat(86) }, body: Buffer.alloc(100000) }).then((x) => x.status);
  assert.deepEqual([await bogus(), await bogus()], [403, 429]);
});

test('SHR-6: files are read back from the store as a stream, never whole in memory', async (t) => {
  const { Readable } = require('node:stream');
  const base = memory();
  // A store whose reads are streams, as the disk and R2 stores' now are.
  const store = { ...base, get: async (k) => { const b = await base.get(k); return b && Readable.from([b.subarray(0, 100), b.subarray(100)]); } };
  const r = await up({ store });
  t.after(() => r.close());
  const a = make(r);
  const pic = crypto.getRandomValues(new Uint8Array(9000));
  const ref = await a.s.put(pic);
  assert.deepEqual(Buffer.from(await a.s.get(ref)), Buffer.from(pic));
  // The disk store hands back a stream too, and nothing for a key it doesn't hold.
  const dir = tmp(t);
  const disk = diskStore(dir);
  await disk.put('s/k', Buffer.from('bytes'));
  const got = await disk.get('s/k');
  assert.equal(typeof got.pipe, 'function');
  assert.equal(Buffer.concat(await got.toArray()).toString(), 'bytes');
  assert.equal(await disk.get('s/none'), null);
});

test('SHR-7: a file upload on a slow link is not cut while it progresses; a stalled one is; other bodies keep a total limit', { timeout: 20000 }, async (t) => {
  // An idle window ten times the trickle's step, so a loaded machine's late timer isn't taken for a stall.
  const r = await up({ limit: { ...LIMIT, idle: 1000, progress: 1024, bodyTime: 600 } });
  t.after(() => r.close());
  // Node's own request timeout counts the whole upload: it would cut a 20 MiB file on a slow link at 60 s.
  assert.equal(r.server.requestTimeout, 0);
  assert.ok(r.server.headersTimeout > 0 && r.server.headersTimeout <= 30e3, `headersTimeout ${r.server.headersTimeout}`);
  assert.ok(r.server.timeout > 0, 'idle sockets time out');
  // A real, signed upload sent 2 KiB every 100 ms: longer than both the idle window and the other bodies' total limit.
  const trickle = (u, init) => new Promise((resolve, reject) => {
    const body = Buffer.from(init.body);
    const req = http.request(u, { method: 'PUT', headers: { ...init.headers, 'content-length': body.length } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve(new Response(Buffer.concat(parts), { status: res.statusCode })));
    });
    req.on('error', reject);
    let at = 0;
    const step = () => { if (at >= body.length) return req.end(); req.write(body.subarray(at, at += 2048)); setTimeout(step, 100); };
    step();
  });
  const a = device(G.create('notes', { server: r.url }), { fetch: (u, init) => (init?.method === 'PUT' ? trickle(u, init) : fetch(u, init)) });
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  const t0 = Date.now();
  const ref = await a.s.put(crypto.getRandomValues(new Uint8Array(20000)));
  assert.ok(Date.now() - t0 > 1000, `took ${Date.now() - t0} ms`);
  assert.equal((await a.s.get(ref)).length, 20000);
  // Half a file, then nothing: cut once the idle window passes without progress.
  const id = () => crypto.randomBytes(16).toString('base64url');
  const cut = (head, drip) => new Promise((resolve) => {
    const t1 = Date.now();
    const s = net.connect(r.port, '127.0.0.1', () => s.write(head));
    const timer = drip && setInterval(() => s.write('x'), 100);
    s.on('error', () => {});
    s.on('close', () => { clearInterval(timer); resolve(Date.now() - t1); });
    s.resume();
    setTimeout(() => s.destroy(), 5000);
  });
  const stalled = await cut(`PUT /s/${a.st.sid}/b/${id()} HTTP/1.1\r\nHost: x\r\nX-Glaze-Sig: ${'A'.repeat(86)}\r\nContent-Length: 30000\r\n\r\n${'x'.repeat(10000)}`);
  assert.ok(stalled < 4000, `a stalled upload was cut after ${stalled} ms`);
  // A batch that keeps dripping is still cut at its total limit.
  const dripping = await cut(`POST /s/${a.st.sid} HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{`, true);
  assert.ok(dripping < 2000, `a dripping batch was cut after ${dripping} ms`);
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
  const db = path.join(dir, 'share.db'), copy = path.join(dir, 'backup.db');
  let r = await up({ db });
  const a = make(r);
  a.local = { n1: { title: 'Before the backup', html: '' } };
  await a.pump();
  await backup(db, copy); // while the relay serves, as the owner's nightly job does
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
  fs.copyFileSync(copy, db);
  for (const x of ['-wal', '-shm']) fs.rmSync(db + x, { force: true });
  // The copy carries no lease, so the restored relay starts at once rather than wait one out (60 s): a quarter of that
  // tells the two apart on a loaded machine too.
  const t0 = Date.now();
  r = await up({ db }, port);
  t.after(() => r.close());
  assert.ok(Date.now() - t0 < 15e3, `started after ${Date.now() - t0} ms`);
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

// A store whose first put waits until the test lets it go (a slow R2 or disk write), then works, fails (true), or
// lands and then throws ('landed': the bucket kept it but the reply was lost). A copy over `base`, which keeps its
// objects, so one relay's view of a shared store can misbehave on its own.
// A test that fails while the upload waits here would leave it waiting, and the relay's close (which waits for every
// request) with it: the file would never exit. So the gate also opens, as a failed write, when the test ends, before
// the relay's own close hook runs.
const slow = (t, base = memory()) => {
  const s = { ...base };
  let go, first = true;
  s.started = new Promise((resolve) => { s.start = resolve; });
  const gate = new Promise((resolve) => { go = resolve; });
  s.put = async (k, b) => {
    if (!first) return base.put(k, b);
    first = false;
    s.start();
    const how = await gate;
    if (how === 'landed') { await base.put(k, b); throw new Error('reply lost'); }
    if (how) throw new Error('store down');
    return base.put(k, b);
  };
  s.release = (how = false) => go(how);
  t.after(() => go(true));
  return s;
};
// The grace the relays below get: long enough that no scheduled delete runs by itself during a test, however slow the
// machine. A test moves past it by ageing the doomed keys (a controlled clock, as for the lease), then runs the sweep.
const GRACE = 60e3;
const pastGrace = (r) => r.db.prepare('UPDATE doomed SET since = since - ?, next = next - ?').run(GRACE + 1000, GRACE + 1000);
const doomed = (r, sid) => r.db.prepare('SELECT count(*) AS c FROM doomed WHERE sid = ?').get(sid).c;
const booked = (r) => r.db.prepare('SELECT blob FROM totals').get().blob;
const blobRows = (r, sid) => r.db.prepare('SELECT count(*) AS c FROM blobs WHERE sid = ?').get(sid).c;

test('creator deletion reclaims in-flight uploads; idle expiry waits for activity to finish', async (t) => {
  for (const [how, fail] of [['creator', false], ['creator', true], ['expiry', false]]) {
    const store = slow(t);
    const r = await up({ store });
    t.after(() => r.close());
    const a = make(r, 'notes', { expire: how === 'expiry' });
    a.local = { n1: { title: 'x', html: '' } };
    await a.pump();
    const upload = a.s.put(new Uint8Array(3000)).then(() => 'stored', (e) => e.status ?? e.message);
    await store.started;
    if (how === 'creator') assert.equal((await fetch(`${r.url}/s/${a.st.sid}`, { method: 'DELETE', headers: { authorization: `Bearer ${a.st.del}` } })).status, 204);
    else {
      r.db.prepare('UPDATE sessions SET touched = touched - 400 WHERE sid = ?').run(a.st.sid);
      await r.expire();
      assert.equal((await fetch(`${r.url}/s/${a.st.sid}`)).status, 200, 'an ongoing upload is use, not idle');
      store.release();
      assert.equal(await upload, 'stored');
      // Once the upload has finished and nobody uses the share again, ordinary opt-in expiry reclaims it.
      r.db.prepare('UPDATE sessions SET touched = touched - 400 WHERE sid = ?').run(a.st.sid);
    }
    await r.expire();
    assert.equal((await fetch(`${r.url}/s/${a.st.sid}`)).status, 410, `${how} ${fail}`);
    if (how === 'creator') {
      store.release(fail);
      assert.equal(await upload, 410, `${how} ${fail}: the upload isn't acknowledged`);
    }
    await r.expire();
    assert.deepEqual([store.m.size, blobRows(r, a.st.sid)], [0, 0], `${how} ${fail}`);
  }
});

test('a failed upload, even one that landed before failing, is doomed: deleted, its room back after the grace', async (t) => {
  for (const how of [true, 'landed']) {
    const dir = tmp(t);
    const db = path.join(dir, 'share.db');
    const store = slow(t);
    let r = await up({ db, store, maxBlobBytes: 5000, grace: GRACE });
    const r1 = r;
    t.after(() => r1.close());
    const a = make(r);
    a.local = { n1: { title: 'x', html: '' } };
    await a.pump();
    const upload = a.s.put(new Uint8Array(3000)).then(() => 'stored', (e) => e.status);
    await store.started;
    store.release(how);
    assert.equal(await upload, 500);
    // No row, nothing in the store (a put that threw may still have landed: it's deleted all the same), and its room
    // held until the first scheduled delete.
    assert.deepEqual([blobRows(r, a.st.sid), doomed(r, a.st.sid), store.m.size, booked(r)], [0, 1, 0, 4124], `${how}`);
    await assert.rejects(a.s.put(new Uint8Array(4000)), (e) => e.status === 507);
    pastGrace(r);
    await r.expire();
    assert.equal(booked(r), 0);
    await a.s.put(new Uint8Array(4000));
    // A relay that dies between counting an upload and storing it leaves a pending row it owned (and maybe the object).
    const port = r.port;
    r.db.prepare('INSERT INTO blobs (sid, id, size, at, owner) VALUES (?, ?, ?, ?, ?)').run(a.st.sid, 'P'.repeat(22), 100, Date.now(), 'a-relay-that-died');
    store.m.set(`${a.st.sid}/${'P'.repeat(22)}`, Buffer.alloc(100));
    await r.close();
    r = await up({ db, store, maxBlobBytes: 5000, grace: GRACE }, port);
    t.after(() => r.close());
    // At start its row becomes a doomed key: the object goes, its room stays booked until the first scheduled delete.
    await r.expire();
    assert.deepEqual([store.m.size, blobRows(r, a.st.sid), booked(r)], [1, 1, 4124 + 100]);
    pastGrace(r);
    await r.expire();
    assert.deepEqual([store.m.size, blobRows(r, a.st.sid), booked(r)], [1, 1, 4124]);
  }
});

// The relay's own command line, as the owner runs it beside a serving relay (a separate process).
const cli = (args, env) => new Promise((resolve) => {
  const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server', 'relay.js'), ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('close', (code) => resolve({ code, out: out.trim() }));
});

test('a backup taken while an upload is in flight leaves it alone, and the room adds up whatever happens next', async (t) => {
  // The upload then: is stored; or its share is deleted before it ends, and it's stored or fails. Room for one file only.
  for (const [then, fail] of [['stored', false], ['deleted', false], ['deleted', true]]) {
    const dir = tmp(t);
    const db = path.join(dir, 'share.db'), blobs = path.join(dir, 'blobs');
    const store = slow(t, diskStore(blobs));
    const r = await up({ db, store, maxBlobBytes: 5000 });
    t.after(() => r.close());
    const a = make(r);
    a.local = { n1: { title: 'x', html: '' } };
    await a.pump();
    const bytes = new Uint8Array(4000).fill(7); // 4,124 bytes sealed
    const upload = a.s.put(bytes).then((ref) => ref, (e) => e.status ?? e.message);
    await store.started;
    // The owner's nightly backup runs now, in its own process.
    assert.equal((await cli(['--backup', path.join(dir, 'backup.db')], { DB: db, BLOBS: blobs })).code, 0);
    assert.equal(blobRows(r, a.st.sid), 1, `${then} ${fail}: the pending upload is still on the books`);
    if (then === 'deleted') assert.equal((await fetch(`${r.url}/s/${a.st.sid}`, { method: 'DELETE', headers: { authorization: `Bearer ${a.st.del}` } })).status, 204);
    store.release(fail);
    const got = await upload;
    await r.expire();
    if (then === 'stored') {
      assert.equal(typeof got, 'object', `upload: ${got}`);
      assert.deepEqual(Buffer.from(await a.s.get(got)), Buffer.from(bytes));
      assert.equal(r.db.prepare('SELECT at FROM blobs WHERE sid = ? AND id = ?').get(a.st.sid, got.id).at, null);
    } else {
      assert.equal(got, 410);
      assert.deepEqual([blobRows(r, a.st.sid), fs.existsSync(blobs) ? fs.readdirSync(blobs, { recursive: true }).length : 0], [0, 0], `${then} ${fail}`);
      // Nothing left on the books either: the next share's file fits in the room.
      const c = make(r);
      await c.s.put(new Uint8Array(4000));
    }
    assert.deepEqual(r.db.prepare('SELECT blob FROM totals').get().blob, r.db.prepare('SELECT coalesce(sum(size), 0) AS s FROM blobs').get().s);
    // The backup is a usable database.
    const { DatabaseSync } = require('node:sqlite');
    const copy = new DatabaseSync(path.join(dir, 'backup.db'), { readOnly: true });
    assert.equal(copy.prepare('SELECT count(*) AS c FROM sessions').get().c, 1);
    copy.close();
  }
});

test('a share deleted by --delete in its own process frees its room for the serving relay at once', async (t) => {
  const dir = tmp(t);
  const db = path.join(dir, 'share.db'), blobs = path.join(dir, 'blobs');
  const r = await up({ db, store: diskStore(blobs), maxBlobBytes: 5000 });
  t.after(() => r.close());
  const a = make(r), b = make(r);
  await a.s.put(new Uint8Array(4000));
  await assert.rejects(b.s.put(new Uint8Array(4000)), (e) => e.status === 507);
  assert.deepEqual(await cli(['--delete', a.st.sid], { DB: db, BLOBS: blobs }), { code: 0, out: 'deleted' });
  await b.s.put(new Uint8Array(4000)); // no restart needed
  assert.equal(fs.existsSync(path.join(blobs, a.st.sid)), false);
});

test('one serving relay per database: a second waits out the lease and refuses; a dead one\'s uploads are reclaimed', { timeout: 30e3 }, async (t) => {
  // On a mocked clock only pass() moves: a loaded machine stalling between the holder's renewal and the other relay's
  // check can't lapse the lease, and a relay left waiting never starts.
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  const pass = async (ms) => { for (let n = 0; n < ms; n += 5) { t.mock.timers.tick(5); await new Promise(setImmediate); } };
  const dir = tmp(t);
  const db = path.join(dir, 'share.db');
  const store = memory();
  const first = await up({ db, store, lease: 300 });
  // A second relay on the same database, while the first renews its lease.
  const second = relay({ db, store: memory(), lease: 300 });
  t.after(() => Promise.all([first.close(), second.close()]));
  const t0 = Date.now();
  const refused = second.listen(0, '127.0.0.1').then(() => 'served', (e) => ({ e, after: Date.now() - t0 }));
  await pass(1500);
  const { e, after } = await refused;
  assert.match(e?.message ?? 'served', /another relay is serving this database/);
  assert.ok(after >= 900, `gave up after ${after} ms`);
  await second.close();
  await first.close(); // gives the lease back: the next one starts at once
  const third = await up({ db, store, lease: 300 });
  await third.close();
  // A relay that died holding the lease, with an upload pending: the next waits out its lease, then reclaims the upload.
  const a = G.create('notes', { server: 'http://127.0.0.1:1' });
  const d0 = new (require('node:sqlite').DatabaseSync)(db);
  d0.prepare('INSERT INTO sessions (sid, pub, del, touched) VALUES (?, ?, ?, 0)').run(a.sid, Buffer.alloc(32), Buffer.alloc(32));
  d0.prepare('INSERT INTO blobs (sid, id, size, at, owner) VALUES (?, ?, 100, ?, ?)').run(a.sid, 'D'.repeat(22), Date.now(), 'dead');
  d0.prepare('INSERT OR REPLACE INTO lease (id, boot, seen) VALUES (1, ?, ?)').run('dead', Date.now());
  d0.close();
  store.m.set(`${a.sid}/${'D'.repeat(22)}`, Buffer.alloc(100));
  const fourth = relay({ db, store, lease: 300, grace: GRACE });
  t.after(() => fourth.close());
  const holder = () => fourth.db.prepare('SELECT boot FROM lease').get().boot;
  const started = fourth.listen(0, '127.0.0.1');
  await pass(295);
  assert.equal(holder(), 'dead', 'took over before the lease lapsed');
  await pass(25);
  await started;
  assert.equal(holder(), fourth.boot);
  // Its row became a doomed key, its object deleted and its room still booked. A late write from the dead relay (a bucket
  // finishing a request it already had) lands afterwards; the next scheduled delete takes it.
  assert.deepEqual([store.m.size, blobRows(fourth, a.sid), doomed(fourth, a.sid), booked(fourth)], [0, 0, 1, 100]);
  store.m.set(`${a.sid}/${'D'.repeat(22)}`, Buffer.alloc(100));
  pastGrace(fourth);
  await fourth.expire();
  assert.deepEqual([store.m.size, doomed(fourth, a.sid), booked(fourth)], [0, 1, 0]); // kept, and deleted again, for a week
});

test('a relay whose lease was taken over commits nothing after its wait: no row, no room, and the object it wrote goes', async (t) => {
  // Codex's witness: an old relay's upload waits in the store while its renewals stall past the lease (the test ages
  // the lease, a controlled clock rather than a real 60-second stall), and a replacement takes over.
  for (const fail of [false, true, 'landed']) {
    const dir = tmp(t);
    const db = path.join(dir, 'share.db');
    const shared = memory();
    const store = slow(t, shared);
    const old = await up({ db, store, maxBlobBytes: 5000 });
    t.after(() => old.close());
    const a = make(old);
    a.local = { n1: { title: 'x', html: '' } };
    await a.pump();
    const upload = a.s.put(new Uint8Array(4000)).then(() => 'stored', (e) => e.status ?? e.message); // 4,124 B sealed
    await store.started;
    old.db.prepare('UPDATE lease SET seen = seen - 61000').run();
    const next = await up({ db, store: shared, maxBlobBytes: 5000, grace: GRACE });
    t.after(() => next.close());
    // The old upload's room stays on the books until none of its writes can land: never spent twice.
    const b = make(next);
    await assert.rejects(b.s.put(new Uint8Array(4000)), (e) => e.status === 507, `fail ${fail}`);
    store.release(fail);
    assert.equal(await upload, 503, `fail ${fail}: the old relay acknowledges nothing`);
    assert.equal(shared.m.size, 0, `fail ${fail}: the object the old relay wrote is gone`);
    assert.notEqual((await fetch(`${old.url}/health`).catch(() => ({ status: 'closed' }))).status, 200, 'the old relay stopped');
    // After the grace the reclaimed row and its room go, and the replacement can use the room once.
    pastGrace(next);
    await next.expire();
    assert.deepEqual([shared.m.size, blobRows(next, a.st.sid), next.db.prepare('SELECT blob FROM totals').get().blob], [0, 0, 0]);
    const ref = await b.s.put(new Uint8Array(4000));
    assert.deepEqual([shared.m.size, next.db.prepare('SELECT blob FROM totals').get().blob], [1, 4124]);
    assert.equal((await b.s.get(ref)).length, 4000);
    await assert.rejects(make(next).s.put(new Uint8Array(4000)), (e) => e.status === 507);
  }
});

test('a late write landing after the grace is still reconciled: recorded by the old relay, deleted by the holder, across restarts', async (t) => {
  // Codex's verification 4: the old upload lands after the replacement's first scheduled delete, and either the old
  // relay's own delete fails (store briefly down for it), or its put lands and then throws (the reply was lost).
  for (const [how, delFails] of [[false, true], ['landed', false]]) {
    const dir = tmp(t);
    const db = path.join(dir, 'share.db');
    const shared = memory();
    const store = slow(t, shared);
    const old = await up({ db, store, maxBlobBytes: 5000 });
    t.after(() => old.close());
    const a = make(old);
    a.local = { n1: { title: 'x', html: '' } };
    await a.pump();
    const upload = a.s.put(new Uint8Array(4000)).then(() => 'stored', (e) => e.status ?? e.message);
    await store.started;
    old.db.prepare('UPDATE lease SET seen = seen - 61000').run();
    let next = await up({ db, store: shared, maxBlobBytes: 5000, grace: GRACE });
    const first = next;
    t.after(() => first.close());
    // Past the grace: the replacement's first scheduled delete has run, the room is free, and it is spent.
    pastGrace(next);
    await next.expire();
    const b = make(next);
    await b.s.put(new Uint8Array(4000));
    assert.deepEqual([shared.m.size, booked(next)], [1, 4124]);
    if (delFails) store.del = async () => { throw new Error('store down'); };
    store.release(how);
    assert.equal(await upload, 503);
    // The late object is on the books (honestly over the cap) and in the doomed list, whatever happened to its delete.
    assert.equal(booked(next), delFails ? 8248 : 8248, `${how} ${delFails}: the late object is on the books`);
    assert.equal(doomed(next, a.st.sid), 1);
    await assert.rejects(make(next).s.put(new Uint8Array(4000)), (e) => e.status === 507);
    // The holder's sweep deletes it on schedule, after a restart too.
    const port = next.port;
    await next.close();
    next = await up({ db, store: shared, maxBlobBytes: 5000, grace: GRACE }, port);
    t.after(() => next.close());
    pastGrace(next);
    await next.expire();
    assert.deepEqual([shared.m.size, booked(next), blobRows(next, a.st.sid)], [1, 4124, 0], `${how} ${delFails}`);
  }
});

test('a relay that loses its lease cuts connections after the drain, and still dooms what its uploads wrote', async (t) => {
  const dir = tmp(t);
  const db = path.join(dir, 'share.db');
  const shared = memory();
  const store = slow(t, shared);
  const old = await up({ db, store, lease: 300, drain: 100 });
  t.after(() => old.close());
  const a = make(old);
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  const upload = a.s.put(new Uint8Array(3000)).then(() => 'stored', (e) => e.status ?? e.message);
  await store.started;
  old.db.prepare("UPDATE lease SET boot = 'someone-else', seen = ?").run(Date.now()); // another relay took over
  // The store hasn't answered; after the drain the connection is cut, without an answer.
  const t0 = Date.now();
  const got = await upload;
  const cut = Date.now() - t0;
  assert.notEqual(got, 'stored');
  store.release(); // the write lands only now, after the connection is gone
  await old.close(); // ends once the upload's handler has run: its key is doomed and its object deleted
  assert.equal(shared.m.size, 0, 'the late object was deleted after the connection was cut');
  assert.ok(cut < 2000, `cut after ${cut} ms`);
  const { DatabaseSync } = require('node:sqlite');
  const d = new DatabaseSync(db, { readOnly: true });
  assert.equal(d.prepare('SELECT count(*) AS c FROM doomed WHERE sid = ?').get(a.st.sid).c, 1);
  d.close();
});

test('a live holder\'s upload completes however long it takes; a relay that loses its lease stops taking work at once', async (t) => {
  const store = slow(t);
  const r = await up({ store, lease: 300 });
  t.after(() => r.close());
  const a = make(r);
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  const upload = a.s.put(new Uint8Array(3000)).then((ref) => ref, (e) => e.status ?? e.message);
  await store.started;
  await new Promise((resolve) => setTimeout(resolve, 700)); // more than two leases: renewals keep it
  store.release();
  const ref = await upload;
  assert.equal(typeof ref, 'object', `upload: ${ref}`);
  assert.equal((await a.s.get(ref)).length, 3000);
  // Another relay takes the lease (written directly): within a quarter lease this one answers nothing but 503.
  r.db.prepare("UPDATE lease SET boot = 'someone-else', seen = ?").run(Date.now());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.notEqual((await fetch(`${r.url}/health`).catch(() => ({ status: 'closed' }))).status, 200);
});

test('--delete in its own process beside a serving relay: an upload to that share ends 410 and leaves nothing; others are untouched', async (t) => {
  for (const same of [true, false]) {
    const dir = tmp(t);
    const db = path.join(dir, 'share.db'), blobs = path.join(dir, 'blobs');
    const store = slow(t, diskStore(blobs));
    const r = await up({ db, store });
    t.after(() => r.close());
    const doomed = make(r), other = make(r);
    for (const d of [doomed, other]) { d.local = { n1: { title: 'x', html: '' } }; await d.pump(); }
    const target = same ? doomed : other;
    const upload = target.s.put(new Uint8Array(3000)).then((ref) => ref, (e) => e.status ?? e.message);
    await store.started;
    assert.deepEqual(await cli(['--delete', doomed.st.sid], { DB: db, BLOBS: blobs }), { code: 0, out: 'deleted' });
    store.release();
    const got = await upload;
    await r.expire();
    if (same) {
      assert.equal(got, 410);
      assert.deepEqual([blobRows(r, doomed.st.sid), fs.existsSync(path.join(blobs, doomed.st.sid)) && fs.readdirSync(path.join(blobs, doomed.st.sid)).length], [0, false]);
    } else {
      assert.equal(typeof got, 'object', `upload: ${got}`);
      assert.equal(r.db.prepare('SELECT at FROM blobs WHERE sid = ? AND id = ?').get(other.st.sid, got.id).at, null);
      assert.equal((await other.s.get(got)).length, 3000);
    }
  }
});

test('a deleted share\'s files stop counting, also after a restart, and after a store that was down recovers', async (t) => {
  const dir = tmp(t);
  const db = path.join(dir, 'share.db');
  const store = memory();
  const del = store.del;
  let r = await up({ db, store, maxBlobBytes: 5000 });
  let port = r.port;
  const a = make(r);
  await a.s.put(new Uint8Array(4000)); // 4,124 bytes sealed
  await a.s.remove();
  await r.expire();
  assert.equal(store.m.size, 0);
  await r.close();
  r = await up({ db, store, maxBlobBytes: 5000 }, port);
  const b = make(r);
  await b.s.put(new Uint8Array(4000)); // fits: the deleted share no longer counts
  // The store is down while b is deleted: its file is still there, so it still counts until it's gone.
  store.del = async () => { throw new Error('store down'); };
  await b.s.remove();
  await r.expire();
  assert.deepEqual([store.m.size, blobRows(r, b.st.sid)], [1, 1]);
  const c = make(r);
  await assert.rejects(c.s.put(new Uint8Array(4000)), (e) => e.status === 507);
  await r.close();
  store.del = del;
  r = await up({ db, store, maxBlobBytes: 5000 }, port);
  t.after(() => r.close());
  await r.expire();
  assert.deepEqual([store.m.size, blobRows(r, b.st.sid)], [0, 0]);
  const d = make(r);
  await d.s.put(new Uint8Array(4000));
});

test('SHR-11: a database error while removing files is logged; the relay keeps running and later removals still happen', { timeout: 10000 }, async (t) => {
  const store = memory();
  const r = await up({ store });
  // The archived relay's rejected cleanup chain also leaves close() pending. Keep that expected red failure from
  // wedging the test runner's teardown; close() still closes its server and clears its timers before the failed await.
  t.after(() => Promise.race([r.close(), sleep(200)]));
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const logged = t.mock.method(console, 'error', () => {});
  const a = make(r);
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  await a.s.put(new Uint8Array(100));
  // Standing in for a full disk: the file row can't be deleted.
  r.db.exec("CREATE TRIGGER fail_blob_delete BEFORE DELETE ON blobs BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END;");
  assert.equal(await a.s.remove(), true);
  await r.flush();
  await sleep(50);
  assert.deepEqual(unhandled.map((e) => e.message), []);
  assert.ok(logged.mock.calls.some((c) => /disk is full/.test(c.arguments.join(' '))), 'the error is logged');
  assert.equal(blobRows(r, a.st.sid), 1);
  // The disk has room again: the next sweep removes the file, and so do later deletions.
  r.db.exec('DROP TRIGGER fail_blob_delete');
  await r.expire();
  assert.deepEqual([store.m.size, blobRows(r, a.st.sid)], [0, 0]);
  const b = make(r);
  await b.s.put(new Uint8Array(100));
  await b.s.remove();
  await r.expire();
  assert.deepEqual([store.m.size, blobRows(r, b.st.sid)], [0, 0]);
  assert.equal((await fetch(`${r.url}/health`)).status, 200);
});

test('SHR-13: half-written .part files are swept when the relay starts, and go with their key', async (t) => {
  const dir = tmp(t);
  const blobs = path.join(dir, 'blobs'), spool = path.join(dir, 'spool');
  const sid = 'S'.repeat(22), id = 'I'.repeat(22), kept = 'K'.repeat(22);
  fs.mkdirSync(path.join(blobs, sid), { recursive: true });
  fs.mkdirSync(spool);
  // Left by a relay that crashed mid-write: the disk store's own temporary file, and an upload's spool file.
  fs.writeFileSync(path.join(blobs, sid, `${id}.part`), 'half');
  fs.writeFileSync(path.join(blobs, sid, kept), 'a stored file');
  fs.writeFileSync(path.join(spool, 'upload.part'), 'half');
  const store = diskStore(blobs);
  const r = await up({ db: path.join(dir, 'share.db'), store, spool });
  t.after(() => r.close());
  await r.flush(); // the store's sweep runs in the background once the relay serves
  assert.deepEqual(fs.readdirSync(path.join(blobs, sid)), [kept]);
  assert.deepEqual(fs.readdirSync(spool), []);
  // Deleting a key also deletes a .part beside it.
  fs.writeFileSync(path.join(blobs, sid, `${id}.part`), 'half again');
  await store.del(`${sid}/${id}`);
  assert.deepEqual(fs.readdirSync(path.join(blobs, sid)), [kept]);
});

test('catch-up applies batches strictly in order: a reordered or gapped page never moves the cursor past a missing batch', async (t) => {
  const r = await up({ limit: { ...LIMIT, page: 1 } }); // one batch per page: catch-up over many pages
  t.after(() => r.close());
  const a = make(r);
  for (let i = 1; i <= 5; i++) { a.local[`n${i}`] = { title: `n${i}`, html: '' }; await a.pump(); }
  const link = await a.s.link(false);
  // An ordinary catch-up over five pages.
  const plain = await join(link);
  await plain.pump();
  assert.deepEqual(plain.local, a.local);
  // A relay that answers once with batches out of order, then once with a hole, then honestly.
  const r2 = await up();
  t.after(() => r2.close());
  const e = make(r2);
  e.local = { n1: { title: 'one', html: '' } };
  await e.pump();
  e.local.n2 = { title: 'two', html: '' };
  await e.pump();
  e.local.n3 = { title: 'three', html: '' };
  await e.pump();
  const lies = [(ops) => ops.reverse(), (ops) => ops.filter((o) => o.n !== 1)];
  const b = await join(await e.s.link(false), {
    fetch: async (u, init) => {
      const res = await fetch(u, init);
      if (!u.includes('?after=') || !lies.length) return res;
      const page = await res.json();
      page.ops = lies.shift()(page.ops);
      return new Response(JSON.stringify(page), { status: 200 });
    },
  });
  for (let i = 0; i < 2; i++) {
    const got = await b.pump();
    assert.deepEqual([b.st.cursor, got.more, Object.keys(b.local)], [0, true, []], `lie ${i}`);
  }
  await b.pump();
  assert.deepEqual(b.local, e.local);
});

test('a forwarded client address is trusted only from configured proxies, and only if it is an address', async (t) => {
  const tries = async (opts, values) => {
    const r = await up({ rate: { ...RATE, create: [1, 3600e3] }, ...opts });
    t.after(() => r.close());
    const out = [];
    for (const v of values) {
      const res = await fetch(`${r.url}/s`, { method: 'POST', headers: { 'x-real-ip': v }, body: JSON.stringify({ sid: G.b64(crypto.getRandomValues(new Uint8Array(16))), pub: 'A'.repeat(43), del: 'A'.repeat(43) }) });
      out.push(res.status);
    }
    return out;
  };
  assert.deepEqual(await tries({}, ['203.0.113.1', '203.0.113.1', '203.0.113.2']), [201, 429, 429]); // no header configured
  assert.deepEqual(await tries({ ipHeader: 'x-real-ip' }, ['203.0.113.1', '203.0.113.1', '203.0.113.2']), [201, 429, 201]); // loopback is trusted by default
  assert.deepEqual(await tries({ ipHeader: 'x-real-ip', trustedProxies: '10.0.0.0/8' }, ['203.0.113.1', '203.0.113.2']), [201, 429]); // this peer isn't a proxy
  assert.deepEqual(await tries({ ipHeader: 'x-real-ip' }, ['not-an-address', 'also-not']), [201, 429]); // not an address: the peer counts
});

test('the number of live sessions is capped; a deleted one leaves room at once, and its tombstone is pruned later', async (t) => {
  const r = await up({ maxSessions: 2, full: 1 }); // isolate the hard live-session cap from the 95% safety margin
  t.after(() => r.close());
  const a = make(r), b = make(r), c = make(r);
  await a.s.sync();
  await b.s.sync();
  await assert.rejects(c.s.sync(), (e) => e.status === 507);
  await a.s.remove();
  await c.s.sync();
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

test('a file delete requires its own editor signature bound to the session and file', async (t) => {
  const store = memory(), r = await up({ store });
  t.after(() => r.close());
  const a = make(r), ref = await a.s.put(new Uint8Array([1, 2, 3]));
  const reader = await join(await a.s.link(false));
  await assert.rejects(reader.s.removeFile(ref.id), /read-only/);
  const url = `${r.url}/s/${a.st.sid}/b/${ref.id}`;
  assert.equal((await fetch(url, { method: 'DELETE', headers: { 'x-glaze-sig': 'A'.repeat(86) } })).status, 403);
  const k = await G.keys({ sid: G.unb64(a.st.sid), seed: G.unb64(a.st.seed) });
  // Match the negotiated protocol: the staging gate defaults to gzs1, and enabled relays lock this client to gzs2.
  const field = (x) => { const b = Buffer.from(x); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return [n, b]; };
  const message = a.st.gzs === 2 ? Buffer.concat([Buffer.from('gzs2'), ...[a.st.sid, 'blob-delete', ref.id, ''].flatMap(field)])
    : Buffer.from(`gzs1|${a.st.sid}|blob-delete|${ref.id}`);
  const sig = G.b64(new Uint8Array(await crypto.subtle.sign('Ed25519', k.sk, message)));
  // A signature for another file cannot delete this one.
  const other = await a.s.put(new Uint8Array([4]));
  assert.equal((await fetch(`${r.url}/s/${a.st.sid}/b/${other.id}`, { method: 'DELETE', headers: { 'x-glaze-sig': sig } })).status, 403);
  await a.s.removeFile(ref.id);
  assert.equal((await fetch(url)).status, 404);
  assert.equal(store.m.has(`${a.st.sid}/${ref.id}`), false);
  assert.ok(store.m.has(`${a.st.sid}/${other.id}`));
  await a.s.removeFile(ref.id); // retries are harmless
  // The hand-made signature does authenticate for its own file: the refusal above was about the file.
  assert.equal((await fetch(url, { method: 'DELETE', headers: { 'x-glaze-sig': sig } })).status, 204);
});
