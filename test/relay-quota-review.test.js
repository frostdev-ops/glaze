const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { relay, RATE } = require('../server/relay.js');
const DAY = 864e5;
const today = () => Math.floor(Date.now() / DAY);
const id = () => crypto.randomBytes(16).toString('base64url');
const up = async (t, options = {}) => {
  const r = relay({ db: ':memory:', ...options });
  const { port } = await r.listen(0, '127.0.0.1');
  const clients = [];
  r.server.on('connection', (sock) => clients.push(sock));
  t.after(() => { for (const sock of clients) sock.destroy(); return r.close(); });
  return Object.assign(r, { port, url: `http://127.0.0.1:${port}` });
};
const insert = (r, { sid = id(), age = 0, head = 0, gone = null, expire = 0 } = {}) => {
  r.db.prepare('INSERT INTO sessions(sid,pub,del,touched,head,gone,expire) VALUES(?,?,?,?,?,?,?)')
    .run(sid, Buffer.alloc(32), Buffer.alloc(32), today() - age, head, gone, expire);
  return sid;
};
const create = async (r, ip) => (await fetch(`${r.url}/s`, {
  method: 'POST', headers: ip ? { 'x-real-ip': ip } : {},
  body: JSON.stringify({ sid: id(), pub: 'A'.repeat(43), del: 'A'.repeat(43) }),
})).status;

test('R2 review: an active request body protects empty and old written sessions from expiry', async (t) => {
  for (const [head, age] of [[0, 3], [1, 731]]) {
    const r = await up(t);
    const sid = insert(r, { head, age });
    const arrived = new Promise((resolve) => r.server.once('request', () => setImmediate(resolve)));
    const s = net.connect(r.port, '127.0.0.1', () => s.write(`POST /s/${sid} HTTP/1.1\r\nHost:x\r\nContent-Length:100\r\n\r\n{`));
    s.on('error', () => {});
    s.resume();
    try {
      await arrived;
      await r.expire();
      const row = r.db.prepare('SELECT touched,gone FROM sessions WHERE sid=?').get(sid);
      assert.ok(row, `head ${head}: currently arriving body must protect its session`);
      assert.equal(row.gone, null, 'active share must not become a tombstone');
      assert.equal(row.touched, today());
    } finally { s.destroy(); }
  }
});

test('R2 review: expiry refreshes ongoing store activity across a clock boundary', async (t) => {
  let release, started;
  const gate = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { started = resolve; });
  const r = await up(t, { store: { get: async () => { started(); await gate; return Buffer.alloc(32); }, del: async () => {} } });
  const sid = insert(r, { head: 1 });
  const fid = id();
  r.db.prepare('INSERT INTO blobs(sid,id,size) VALUES(?,?,32)').run(sid, fid);
  const request = fetch(`${r.url}/s/${sid}/b/${fid}`).then((res) => res.arrayBuffer());
  try {
    await reading;
    // A controlled clock boundary: already-admitted activity must remain protected even after its recorded day ages.
    r.db.prepare('UPDATE sessions SET touched=? WHERE sid=?').run(today() - 731, sid);
    await r.expire();
    assert.equal(r.db.prepare('SELECT gone FROM sessions WHERE sid=?').get(sid)?.gone, null);
    assert.equal(r.db.prepare('SELECT touched FROM sessions WHERE sid=?').get(sid)?.touched, today());
  } finally { release(); await request; }
});

test('R2 review: an open live subscription protects a session until it disconnects', async (t) => {
  const r = await up(t);
  const sid = insert(r, { head: 1, age: 731 });
  const ws = new WebSocket(`ws://127.0.0.1:${r.port}/live`);
  t.after(() => ws.close());
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    const rang = new Promise((resolve) => { ws.onmessage = resolve; });
    ws.send(JSON.stringify({ sub: [sid] }));
    await rang;
    await r.expire();
    assert.equal(r.db.prepare('SELECT gone FROM sessions WHERE sid=?').get(sid)?.gone, null);
    assert.equal(r.db.prepare('SELECT touched FROM sessions WHERE sid=?').get(sid)?.touched, today());
  } finally {
    const closed = new Promise((resolve) => { ws.onclose = resolve; });
    ws.close();
    await closed;
  }
  r.db.prepare('UPDATE sessions SET touched=? WHERE sid=?').run(today() - 731, sid);
  await r.expire();
  assert.notEqual(r.db.prepare('SELECT gone FROM sessions WHERE sid=?').get(sid)?.gone, null, 'disconnection releases the activity protection');
});

test('R2 review: operators may keep capacity details in stderr while retaining public health checks', async (t) => {
  const r = await up(t, { healthDetails: false });
  assert.deepEqual(await (await fetch(`${r.url}/health`)).json(), { ok: true });
});

test('R2 review: reclamation retains sessions and tombstones while doomed file keys remain', async (t) => {
  const r = await up(t);
  for (const gone of [null, today() - 366]) {
    const sid = insert(r, { age: 3, gone });
    r.db.prepare('INSERT INTO doomed(sid,id,size,since,next) VALUES(?,?,32,?,?)').run(sid, id(), Date.now(), Date.now() + DAY);
    await r.expire();
    assert.ok(r.db.prepare('SELECT sid FROM sessions WHERE sid=?').get(sid), 'doomed object still owns the session id');
    r.db.prepare('DELETE FROM doomed WHERE sid=?').run(sid);
    await r.expire();
    assert.equal(r.db.prepare('SELECT sid FROM sessions WHERE sid=?').get(sid), undefined);
  }
});

test('R2 review: migration starts opted-in live shares at the upgrade day too, once only', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-r2-migrate-'));
  const db = path.join(dir, 'share.db');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let r = await up(t, { db });
  const sid = insert(r, { age: 1000, head: 1, expire: 1 });
  r.db.exec('PRAGMA user_version=0');
  await r.close();
  r = await up(t, { db });
  assert.equal(r.db.prepare('SELECT touched FROM sessions WHERE sid=?').get(sid)?.touched, today());
  await r.expire();
  assert.equal(r.db.prepare('SELECT gone FROM sessions WHERE sid=?').get(sid)?.gone, null);
  r.db.prepare('UPDATE sessions SET touched=? WHERE sid=?').run(today() - 10, sid);
  await r.close();
  r = await up(t, { db });
  assert.equal(r.db.prepare('SELECT touched FROM sessions WHERE sid=?').get(sid)?.touched, today() - 10, 'migration does not restart the clock every boot');
});

test('R2 review: prospective session admission preserves the fractional 95% headroom', async (t) => {
  const r = await up(t, { maxSessions: 21 });
  const codes = [];
  for (let n = 0; n < 21; n++) codes.push(await create(r));
  assert.deepEqual(codes, [...Array(19).fill(201), 507, 507]);
});

test('R2 review: every IPv4-mapped spelling shares the IPv4 budget', async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', rate: { ...RATE, create: [1, DAY] } });
  for (const forms of [
    ['192.0.2.1', '::ffff:192.0.2.1', '::ffff:c000:201', '0:0:0:0:0:ffff:c000:201', '0:0:0:0:0:ffff:192.0.2.1'],
    ['198.51.100.1', '::FFFF:C633:6401'],
  ]) {
    assert.equal(await create(r, forms[0]), 201);
    for (const form of forms.slice(1)) assert.equal(await create(r, form), 429, form);
  }
});

test('R2 review: IPv6 boundary, embedded IPv4 and scoped link-local spellings share their correct prefixes', async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', rate: { ...RATE, create: [1, DAY] } });
  for (const forms of [
    ['fe80::1%eth0', 'fe80:0:0:0:0:0:0:2%eth1'],
    ['2001:db8:100:2::192.0.2.1', '2001:0db8:0100:0002:0:0:c000:201'],
  ]) {
    assert.equal(await create(r, forms[0]), 201);
    assert.equal(await create(r, forms[1]), 429);
  }
  for (const [word, expected] of [['1200', 201], ['12ff', 201], ['1201', 429], ['1300', 201], ['13ff', 201], ['1400', 429]]) {
    assert.equal(await create(r, `2001:db8:abcd:${word}::1`), expected, word);
  }
  assert.equal(await create(r, '2001:db8:abce:1200::1'), 201);
});

test('R2 review: refusal at an aggregate bucket does not spend a fresh child budget', async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', rate: { ...RATE, create: [1, 1000] } });
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  for (let n = 0; n < 4; n++) assert.equal(await create(r, `2001:db8:444:${(n << 8).toString(16)}::1`), 201);
  assert.equal(await create(r, '2001:db8:444:400::1'), 429);
  now += 250; // /48 recovers one token; a child that was refused still owns its whole burst
  assert.equal(await create(r, '2001:db8:444:400::1'), 201);
});

test('R2 review: rejected rotating IPv6 identities do not allocate fresh rate buckets', async (t) => {
  const r = await up(t, { ipHeader: 'x-real-ip', rate: { ...RATE, create: [1, DAY] } });
  const allocated = new Set();
  const original = Map.prototype.set;
  t.mock.method(Map.prototype, 'set', function (key, value) {
    if (typeof key === 'string' && key.startsWith('2001:db8:99:') && key.endsWith('/64') && typeof value === 'object') allocated.add(key);
    return original.call(this, key, value);
  });
  for (let n = 0; n < 36; n++) assert.equal(await create(r, `2001:db8:99:${(n << 8).toString(16)}::1`), n < 4 ? 201 : 429);
  assert.equal(allocated.size, 4, 'exhausted /48 must refuse new /64s without retaining them');
});
