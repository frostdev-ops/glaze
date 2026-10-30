// Relay quotas and reclamation (WP-R2: SHR-5, and the relay half of SHR-4): per-client budgets over a day and over
// IPv6 /56s and /48s, reclaiming sessions nobody uses and rows nobody needs, refusing before a global cap with a warning
// for the operator, and telling clients how full their session is. Local relays on 127.0.0.1 with in-memory databases.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const G = require('../lib/sharing.js');
const { relay, LIMIT, RATE, IPV6 } = require('../server/relay.js');

const DAY = 864e5;
const memory = () => { const m = new Map(); return { m, put: async (k, b) => { m.set(k, Buffer.from(b)); }, get: async (k) => m.get(k) || null, del: async (k) => { m.delete(k); } }; };
const up = async (t, opts = {}) => {
  const r = relay({ db: ':memory:', store: memory(), ...opts });
  const a = await r.listen(0, '127.0.0.1');
  t.after(() => r.close());
  return Object.assign(r, { url: `http://127.0.0.1:${a.port}`, port: a.port });
};
const tmp = (t) => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-quota-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };
const id = () => G.b64(crypto.getRandomValues(new Uint8Array(16)));
const today = () => Math.floor(Date.now() / DAY);
const scale = (bits) => (IPV6 || []).find(([b]) => b === bits)?.[1] ?? { 64: 1, 56: 2, 48: 4 }[bits];
// A device as the extension runs it (lib/sharing.js), optionally from a forwarded client address.
const device = (r, ip, type = 'notes', opts = {}) => {
  const d = { local: {}, st: G.create(type, { server: r.url, ...opts }) };
  const f = (u, init = {}) => fetch(u, ip ? { ...init, headers: { ...init.headers, 'x-real-ip': ip } } : init);
  d.s = G.session(d.st, { fetch: f });
  d.pump = async () => { await d.s.edit(d.local); const out = await d.s.sync(); d.local = d.s.view(); return out; };
  return d;
};
// A share written by hand, with gzs1 signatures, so a test controls every batch's size and sees every answer whole.
const share = async (r, ip) => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const token = crypto.randomBytes(32), sid = id(), headers = ip ? { 'x-real-ip': ip } : {};
  const made = await fetch(`${r.url}/s`, { method: 'POST', headers, body: JSON.stringify({ sid, pub: publicKey.export({ format: 'jwk' }).x, del: crypto.createHash('sha256').update(token).digest('base64url') }) });
  const sign = (kind, extra, data) => crypto.sign(null, Buffer.concat([Buffer.from(`gzs1|${sid}|${kind}|${extra}`), data]), privateKey).toString('base64url');
  let n = 0;
  const answer = async (res) => ({ status: res.status, body: res.status === 204 ? null : await res.json() });
  return {
    sid, status: made.status,
    append: async (size) => {
      const op = crypto.randomBytes(size);
      const res = await answer(await fetch(`${r.url}/s/${sid}`, { method: 'POST', headers, body: JSON.stringify({ n: n + 1, op: op.toString('base64url'), sig: sign('op', n + 1, op) }) }));
      if (res.status === 201) n++;
      return res;
    },
    put: async (size) => {
      const blob = crypto.randomBytes(size), fid = id();
      return (await fetch(`${r.url}/s/${sid}/b/${fid}`, { method: 'PUT', headers: { ...headers, 'x-glaze-sig': sign('blob', fid, blob) }, body: blob })).status;
    },
    read: async () => answer(await fetch(`${r.url}/s/${sid}`, { headers })),
    remove: async () => (await fetch(`${r.url}/s/${sid}`, { method: 'DELETE', headers: { ...headers, authorization: `Bearer ${token.toString('base64url')}` } })).status,
  };
};
const status = async (r, sid) => (await fetch(`${r.url}/s/${sid}`)).status;
const rowsOf = (r, sid) => r.db.prepare('SELECT count(*) AS c FROM sessions WHERE sid = ?').get(sid).c;
const live = (r) => r.db.prepare('SELECT sessions FROM totals').get().sessions;
const backdate = (r, sid, days, column = 'touched') => r.db.prepare(`UPDATE sessions SET ${column} = ${column} - ? WHERE sid = ?`).run(days, sid);

test('SHR-5: one /64 can\'t store more than its daily quota, whatever its hourly budget still allows', async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', rate: { ...RATE, stored: [12000, ...(RATE.stored || []).slice(1)] } });
  const a = await share(r, '2001:db8:1:2::10');
  assert.equal(a.status, 201);
  assert.deepEqual([await a.put(5000), await a.put(5000)], [201, 201]);
  // Charged from the declared length before the body is read, like the hourly budget: the third file doesn't fit today.
  assert.equal(await a.put(5000), 429);
  // Nor does a batch, from any address of that /64.
  const same = await share(r, '2001:db8:1:2::99');
  assert.equal(same.status, 201);
  assert.equal((await same.append(3000)).status, 429);
  assert.equal((await same.append(500)).status, 201, 'what is left of the day is still there');
  // Nor from another /64 of that /48: no IPv6 allocation stores more a day than one address.
  const near = await share(r, '2001:db8:1:5ff::1');
  assert.equal(await near.put(5000), 429);
  // Another subscriber is not affected.
  const other = await share(r, '2001:db8:77::1');
  assert.equal(await other.put(5000), 201);
  assert.deepEqual(RATE.stored?.slice(1), [DAY, 1], 'stored bytes are budgeted over a day, the same for any allocation');
  assert.ok(RATE.stored[0] > RATE.bytes[0], 'and the day allows more than an hour');
});

test('SHR-5: IPv6 budgets count by /56 and /48 as well as /64: 256 /64s in one /48 share the /48\'s', async (t) => {
  const cap = 2;
  const r = await up(t, { ipHeader: 'x-real-ip', rate: { ...RATE, create: [cap, 3600e3] } });
  const create = async (ip) => (await fetch(`${r.url}/s`, { method: 'POST', headers: { 'x-real-ip': ip }, body: JSON.stringify({ sid: id(), pub: 'A'.repeat(43), del: 'A'.repeat(43) }) })).status;
  const made = async (ips) => { let n = 0; for (const ip of ips) if (await create(ip) === 201) n++; return n; };
  // One /64 in each of the 256 /56s of 2001:db8:a::/48: every /64 and /56 has room, the /48 runs out.
  assert.equal(await made(Array.from({ length: 256 }, (_, i) => `2001:db8:a:${(i << 8).toString(16)}::1`)), cap * scale(48));
  // 256 /64s of one /56 (2001:db8:b::/56): the /56 runs out first.
  assert.equal(await made(Array.from({ length: 256 }, (_, i) => `2001:db8:b:${i.toString(16)}::1`)), cap * scale(56));
  // One /64 still has only its own, whichever addresses in it ask; written in full or shortened alike.
  assert.equal(await made(['2001:db8:c:1::1', '2001:0db8:000c:0001:0:0:0:2', '2001:db8:c:1:ffff::3', '2001:db8:c:1::4']), cap);
  // IPv4 addresses are not grouped: each has its own.
  assert.equal(await made(['198.51.100.1', '198.51.100.2', '198.51.100.3']), 3);
  assert.equal(await made(['198.51.100.1', '198.51.100.1']), 1);
  assert.deepEqual(IPV6.map(([bits]) => bits), [64, 56, 48]);
});

test('SHR-5: live sockets are counted by /56 and /48 too, so many /64s can\'t fill the relay\'s socket cap', { timeout: 10000 }, async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', limit: { ...LIMIT, sockets: 2 } });
  const open = (ip) => new Promise((resolve) => {
    const s = net.connect({ port: r.port, host: '127.0.0.1' }, () => s.write(`GET /live HTTP/1.1\r\nHost: x\r\nX-Real-IP: ${ip}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    t.after(() => s.destroy());
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) resolve(got.split(' ')[1]); });
    s.on('error', () => {});
    s.on('close', () => resolve(got.split(' ')[1]));
  });
  const codes = [];
  for (let i = 0; i < 40; i++) codes.push(await open(`2001:db8:d:${(i << 8).toString(16)}::1`));
  assert.equal(codes.filter((c) => c === '101').length, 2 * scale(48));
  assert.ok(codes.slice(2 * scale(48)).every((c) => c === '429'), codes.join());
});

test('SHR-5: bodies in flight are counted by /56 and /48 too, and no /48 can hold more than twice an address\'s room', { timeout: 10000 }, async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', limit: { ...LIMIT, inflight: 1000 } });
  const a = await share(r);
  // Each request declares 900 bytes and sends a few: it holds its room until its body ends or times out.
  const hang = (ip) => new Promise((resolve) => {
    const s = net.connect({ port: r.port, host: '127.0.0.1' }, () => s.write(`POST /s/${a.sid} HTTP/1.1\r\nHost: x\r\nX-Real-IP: ${ip}\r\nContent-Length: 900\r\n\r\n{"n":`));
    t.after(() => s.destroy());
    let got = '';
    s.on('data', (d) => { got += d; if (got.includes('\r\n')) resolve(got.split(' ')[1]); });
    s.on('error', () => {});
    s.on('close', () => resolve(got.split(' ')[1] || 'closed'));
    setTimeout(() => resolve('held'), 300);
  });
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push(await hang(`2001:db8:e:${(i << 8).toString(16)}::1`));
  // One /64 alone may hold 1,000 bytes (one body); the /48 twice that, not four times.
  assert.deepEqual(codes, ['held', 'held', '429', '429', '429', '429']);
  assert.equal(await hang('2001:db8:f::1'), 'held', 'another /48 has its own');
});

test('SHR-5: a session nobody wrote goes after a few unused days; its creator registers it again when it comes back', async (t) => {
  const r = await up(t);
  const empty = device(r);
  await empty.s.sync(); // registered, never written
  const opened = await share(r); // never written, but someone opens it
  const filed = await share(r);
  assert.equal(await filed.put(100), 201); // a file and no batch: written
  const written = device(r);
  written.local = { n1: { title: 'Kept', html: '<p>x</p>' } };
  await written.pump();
  for (const sid of [empty.st.sid, opened.sid, filed.sid, written.st.sid]) backdate(r, sid, 3);
  assert.equal((await opened.read()).status, 200);
  assert.equal(live(r), 4);
  await r.expire();
  assert.deepEqual(await Promise.all([empty.st.sid, opened.sid, filed.sid, written.st.sid].map((sid) => status(r, sid))), [404, 200, 200, 200]);
  assert.equal(rowsOf(r, empty.st.sid), 0, 'nothing was stored, so nothing is kept: not even a tombstone');
  assert.equal(live(r), 3);
  // Its creator's next sync finds it unknown, registers it again and sends what it has, as after a restore.
  empty.local = { n1: { title: 'Late start', html: '' } };
  await empty.pump();
  assert.equal(await status(r, empty.st.sid), 200);
  assert.ok(r.db.prepare('SELECT head FROM sessions WHERE sid = ?').get(empty.st.sid).head >= 1);
});

test('SHR-5: any share nobody read or wrote for two years goes; reading one keeps it; opt-in expiry still takes a year', async (t) => {
  const store = memory();
  const r = await up(t, { store });
  const idle = await share(r), recent = await share(r), read = await share(r);
  for (const s of [idle, recent, read]) assert.equal((await s.append(100)).status, 201);
  assert.equal(await idle.put(200), 201);
  backdate(r, idle.sid, 731);
  backdate(r, recent.sid, 700);
  backdate(r, read.sid, 731);
  // Any read counts as use, not only for shares that opted in to expiry.
  assert.equal((await read.read()).status, 200);
  assert.equal(r.db.prepare('SELECT touched FROM sessions WHERE sid = ?').get(read.sid).touched, today());
  await r.expire();
  assert.deepEqual(await Promise.all([idle, recent, read].map((s) => status(r, s.sid))), [410, 200, 200]);
  assert.equal(store.m.size, 0, 'its files went with it');
  const opted = device(r, '', 'notes', { expire: true });
  opted.local = { n1: { title: 'x', html: '' } };
  await opted.pump();
  backdate(r, opted.st.sid, 366);
  await r.expire();
  assert.equal(await status(r, opted.st.sid), 410);
});

test('SHR-5: a deleted share stops counting at once, and its row is pruned once the grace period and its files are gone', async (t) => {
  const store = memory();
  const r = await up(t, { store, maxSessions: 3, full: 1 }); // this test isolates live counting, not the 95% margin
  const a = await share(r), b = await share(r), c = await share(r);
  for (const s of [a, b, c]) assert.equal(s.status, 201);
  assert.equal((await share(r)).status, 507);
  assert.equal(await a.put(100), 201);
  assert.equal(await a.remove(), 204);
  await r.expire();
  assert.equal(live(r), 2);
  // MAX_SESSIONS counts live sessions only: the tombstone leaves room for a new share at once.
  const d = await share(r);
  assert.equal(d.status, 201);
  // Within the grace period the tombstone stays (members still learn it was deleted, and its id isn't taken).
  backdate(r, a.sid, 364, 'gone');
  await r.expire();
  assert.deepEqual([await status(r, a.sid), rowsOf(r, a.sid)], [410, 1]);
  // A tombstone whose files the store couldn't delete yet is kept until they're gone: its row is how they're found.
  const del = store.del;
  store.del = async () => { throw new Error('store down'); };
  assert.equal(await b.put(100), 201);
  assert.equal(await b.remove(), 204);
  backdate(r, a.sid, 2, 'gone');
  backdate(r, b.sid, 400, 'gone');
  await r.expire();
  assert.deepEqual([rowsOf(r, a.sid), rowsOf(r, b.sid), await status(r, a.sid), await status(r, b.sid)], [0, 1, 404, 410]);
  store.del = del;
  await r.expire();
  assert.deepEqual([rowsOf(r, b.sid), store.m.size], [0, 0]);
  assert.equal(live(r), 2);
  assert.equal(r.db.prepare('SELECT count(*) AS c FROM sessions').get().c, 2);
});

test('SHR-5: writes and new shares are refused at 95% of a global cap, and the operator is warned from 80%', async (t) => {
  const lines = [];
  const warn = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  t.after(() => { console.warn = warn; });
  const health = async (r) => (await fetch(`${r.url}/health`)).json();
  const r = await up(t, { maxBytes: 10000 });
  const a = await share(r);
  for (let i = 0; i < 7; i++) assert.equal((await a.append(1000)).status, 201);
  assert.deepEqual([lines, await health(r)], [[], { ok: true, low: [] }]);
  assert.equal((await a.append(1000)).status, 201); // 8,000 of 10,000
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^relay: .*80% of MAX_BYTES/);
  assert.deepEqual(await health(r), { ok: true, low: ['log'] });
  assert.equal((await a.append(1000)).status, 201);
  assert.equal(lines.length, 1, 'warned once per crossing, not per write');
  // 10,000 bytes would still be within the cap itself, but not within 95% of it.
  const refused = await a.append(1000);
  assert.deepEqual([refused.status, refused.body.error], [507, 'full']);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^relay: .*95% of MAX_BYTES.*refused/);
  assert.equal((await a.append(1000)).status, 507);
  assert.equal(lines.length, 2);
  assert.equal((await a.append(400)).status, 201, 'what fits under 95% still goes');

  // Files and sessions alike.
  const f = await up(t, { maxBlobBytes: 10000 });
  const b = await share(f);
  assert.equal(await b.put(9000), 201);
  assert.equal(await b.put(600), 507);
  assert.ok(lines.some((l) => /MAX_BLOB_BYTES/.test(l)));
  const s = await up(t, { maxSessions: 20 });
  const codes = [];
  for (let i = 0; i < 20; i++) codes.push((await share(s)).status);
  assert.deepEqual(codes, [...Array(19).fill(201), 507]);
  assert.ok(lines.some((l) => /80% of MAX_SESSIONS/.test(l)) && lines.some((l) => /95% of MAX_SESSIONS/.test(l)));
  assert.deepEqual(await health(s), { ok: true, low: ['sessions'] });
});

test('SHR-4: reads and appends tell a client how full its session is; the extension as released ignores it', async (t) => {
  const r = await up(t, { limit: { ...LIMIT, session: 50000 } });
  const a = await share(r);
  const first = await a.append(1000);
  assert.deepEqual([first.status, first.body], [201, { n: 1, used: 1000, limit: 50000 }]);
  assert.deepEqual((await a.append(2000)).body, { n: 2, used: 3000, limit: 50000 });
  const page = await a.read();
  assert.deepEqual([page.body.head, page.body.used, page.body.limit], [2, 3000, 50000]);
  // Clients that don't know the fields sync, trim and catch up as before.
  const d = device(r);
  d.local = { n1: { title: 'One', html: '<p>1</p>' } };
  await d.pump();
  for (const html of ['<p>2</p>', '<p>3</p>']) { d.local.n1.html = html; await d.pump(); }
  assert.equal(await d.s.compact(true), true);
  const m = G.session(G.join(await d.s.link(false), true), { fetch });
  await m.sync();
  assert.deepEqual(m.view(), d.local);
});

test('SHR-5: a database from an older relay: tombstones stop counting, and every live share starts its idle clock now', async (t) => {
  const db = path.join(tmp(t), 'share.db');
  let r = await up(t, { db });
  const a = await share(r), b = await share(r);
  assert.equal((await b.append(100)).status, 201);
  assert.equal(await a.remove(), 204);
  // As the relay before quotas left it: tombstones counted, and a share that never opted in kept the day it was made.
  r.db.exec('PRAGMA user_version = 0; UPDATE totals SET sessions = 2');
  backdate(r, b.sid, 1000);
  await r.close();
  r = await up(t, { db });
  assert.equal(live(r), 1);
  assert.equal(r.db.prepare('SELECT touched FROM sessions WHERE sid = ?').get(b.sid).touched, today());
  await r.expire();
  assert.equal(await status(r, b.sid), 200);
});
