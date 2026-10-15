// Share sessions end to end (spike S6): devices (lib/sharing.js) against a relay (server/relay.js) on 127.0.0.1 only.
// Each device keeps a local copy ({ note id: { title, html } }, standing in for the notes library) and its session as
// JSON. Covers edits made offline converging, live updates, closing and reopening, read links, a server that tampers,
// compaction, deletion, limits, and a server restored from an older backup.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../lib/sharing.js');
const { relay, LIMIT, RATE } = require('../server/relay.js');

const up = async (opts = {}, port = 0) => {
  const r = relay({ db: ':memory:', ...opts });
  const a = await r.listen(port, '127.0.0.1');
  return Object.assign(r, { url: `http://127.0.0.1:${a.port}`, port: a.port });
};
// A device: its local copy, its session JSON, and whether it can reach the network.
const device = (st) => {
  const d = { st, local: {}, online: true };
  d.s = G.session(st, { fetch: (...a) => (d.online ? fetch(...a) : Promise.reject(new TypeError('offline'))) });
  // Local changes out, everything new in, the merged view written back (what the worker would do).
  d.pump = async () => {
    if (st.seed && st.type) await d.s.edit(d.local);
    const r = await d.s.sync();
    d.local = d.s.view();
    return r;
  };
  return d;
};
const reopen = (d) => device(JSON.parse(JSON.stringify(d.st)));
const join = async (link) => device(G.join(link, true));
const ids = (v) => Object.keys(v).sort();
const rows = (r, sid) => r.db.prepare('SELECT count(*) AS c FROM ops WHERE sid = ?').get(sid).c;

test('two devices that edited offline converge; a conflict keeps both texts', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'Cells', html: '<p>one</p>' }, n2: { title: 'Mitosis', html: '<p>two</p>' } };
  await a.pump();
  const b = await join(await a.s.link(true));
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
  const a2 = reopen(a), b2 = reopen(b);
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
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'Plan', html: '' } };
  await a.pump();
  const link = await a.s.link(true);
  const b = await join(link);
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

  // Closed: its session stays as JSON while three changes land; opened again, it catches up.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-relay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'share.db');
  let r = await up({ db });
  const a = device(G.create(r.url, 'look'));
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

test('read links read, and nothing they hold can write', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'Shared', html: '<p>x</p>' } };
  await a.pump();
  const c = await join(await a.s.link(false));
  await c.pump();
  assert.deepEqual(c.local, a.local);
  await assert.rejects(c.s.edit({ n1: { title: 'Mine now', html: '' } }), /read-only/);
  assert.equal((await c.s.link(true)).includes('#1.r.'), true); // a read link only ever passes on a read link
  // A batch sealed with the read secret but signed by any other key: the relay refuses it.
  const k = await G.keys(G.parse(await a.s.link(false), true));
  const rogue = await G.keys({ sid: G.unb64(k.sid), seed: crypto.getRandomValues(new Uint8Array(32)) });
  const forged = await G.seal({ ...rogue, enc: k.enc }, 'op', { y: 'notes', o: [] });
  const res = await fetch(`${r.url}/s/${a.st.sid}`, { method: 'POST', body: JSON.stringify(forged) });
  assert.equal(res.status, 403);
});

test('a relay that tampers can withhold but not forge: bad batches are skipped', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'Real', html: '<p>real</p>' } };
  await a.pump();
  const other = device(G.create(r.url, 'notes'));
  other.local = { n1: { title: 'From another session', html: '' } };
  await other.pump();
  const b = await join(await a.s.link(true));
  // The relay itself appends: another session's batch (validly signed there), and a real batch with a flipped byte.
  const steal = r.db.prepare('SELECT op, sig FROM ops WHERE sid = ?').get(other.st.sid);
  const mine = r.db.prepare('SELECT op, sig FROM ops WHERE sid = ?').get(a.st.sid);
  const flipped = Buffer.from(mine.op);
  flipped[40] ^= 1;
  const add = r.db.prepare('INSERT INTO ops (sid, n, op, sig) VALUES (?, ?, ?, ?)');
  add.run(a.st.sid, 2, steal.op, steal.sig);
  add.run(a.st.sid, 3, flipped, mine.sig);
  r.db.prepare('UPDATE sessions SET head = 3 WHERE sid = ?').run(a.st.sid);
  const got = await b.pump();
  assert.equal(got.bad, 2);
  assert.deepEqual(b.local, { n1: { title: 'Real', html: '<p>real</p>' } });
  assert.equal(b.st.cursor, 3);
});

test('compaction: the log folds into a snapshot; a new member and a long-gone one both catch up', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = device(G.create(r.url, 'notes'));
  const old = await join(await a.s.link(true));
  a.local = { n1: { title: 'v0', html: '' } };
  await a.pump();
  await old.pump();
  for (let i = 1; i <= 12; i++) { a.local.n1.title = `v${i}`; a.local[`n${i + 1}`] = { title: `note ${i}`, html: `<p>${i}</p>` }; if (i % 3 === 0) delete a.local[`n${i}`]; await a.pump(); }
  assert.equal(await a.s.compact(), false); // not yet worth it
  assert.equal(await a.s.compact(true), true);
  assert.equal(rows(r, a.st.sid), 0);
  const res = await fetch(`${r.url}/s/${a.st.sid}/snap`, { method: 'PUT', body: JSON.stringify({ upto: a.st.cursor, op: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', sig: 'A'.repeat(86) }) });
  assert.equal(res.status, 409); // nothing new to fold
  a.local.n1.html = '<p>after the snapshot</p>';
  await a.pump();
  const fresh = await join(await a.s.link(false));
  await fresh.pump();
  await old.pump();
  assert.deepEqual(fresh.local, a.local);
  assert.deepEqual(old.local, a.local);
  assert.equal(rows(r, a.st.sid), 1);
});

test('deletion: only the creator deletes; members keep their copies, and the id is never reused', async (t) => {
  const r = await up();
  t.after(() => r.close());
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'Bye', html: '<p>soon gone</p>' } };
  await a.pump();
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
  assert.equal((await fetch(`${r.url}/s/${a.st.sid}`)).status, 410);
  assert.deepEqual(await b.pump(), { gone: true });
  assert.deepEqual(b.local, { n1: { title: 'Bye', html: '<p>soon gone</p>' } });
  assert.equal(rows(r, a.st.sid), 0);
  const again = await fetch(`${r.url}/s`, { method: 'POST', body: JSON.stringify({ sid: a.st.sid, pub: G.b64(new Uint8Array(32)), del: G.b64(new Uint8Array(32)) }) });
  assert.equal(again.status, 409);
});

test('limits: batch size, session size, request rates and subscriptions', async (t) => {
  const r = await up({ limit: { ...LIMIT, op: 2048, session: 6000, body: 8000 }, rate: { ...RATE, create: [3, 3600e3] } });
  t.after(() => r.close());
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'x', html: '' } };
  await a.pump();
  a.local.n1.html = `<p>${'x'.repeat(3000)}</p>`;
  await assert.rejects(a.pump(), (e) => e.status === 413);
  a.st.pending = [];
  // Each of these seals to about 1.8 KB: three fit in the session's 6,000 bytes, the fourth doesn't.
  for (let i = 0; i < 3; i++) { a.local.n1.html = `<p>${String(i).repeat(1500)}</p>`; await a.pump(); }
  a.local.n1.html = `<p>${'y'.repeat(1500)}</p>`;
  await assert.rejects(a.pump(), (e) => e.status === 507);
  const big = await fetch(`${r.url}/s/${a.st.sid}`, { method: 'POST', body: JSON.stringify({ op: 'A'.repeat(9000), sig: 'A'.repeat(86) }) }).catch(() => ({ status: 'reset' }));
  assert.equal(big.status, 413);
  // Sessions from one address: three, then the fourth waits.
  const made = [];
  for (let i = 0; i < 3; i++) made.push((await fetch(`${r.url}/s`, { method: 'POST', body: JSON.stringify({ sid: G.b64(crypto.getRandomValues(new Uint8Array(16))), pub: 'A'.repeat(43), del: 'A'.repeat(43) }) })).status);
  assert.deepEqual(made, [201, 201, 429]); // the first session above was the third
  // Too many sessions on one socket: the relay closes it.
  const ws = new WebSocket(`${r.url.replace('http', 'ws')}/live`);
  const closed = new Promise((resolve) => { ws.onclose = (e) => resolve(e.code); });
  ws.onopen = () => ws.send(JSON.stringify({ sub: Array.from({ length: LIMIT.sub + 1 }, () => a.st.sid) }));
  assert.equal(await closed, 1008);
  // A value too big for any batch never leaves the device; the rest of the change does.
  const c = device(G.create(r.url, 'notes'));
  assert.deepEqual(await c.s.edit({ long: { title: 'Long', html: `<p>${'z'.repeat(G.LIMIT.op)}</p>` } }), { n: 1, big: ['long'] });
});

test('a relay restored from an older backup heals from what the devices kept', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-relay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = path.join(dir, 'share.db'), backup = path.join(dir, 'backup.db');
  let r = await up({ db });
  const a = device(G.create(r.url, 'notes'));
  a.local = { n1: { title: 'Before the backup', html: '' } };
  await a.pump();
  const b = await join(await a.s.link(true));
  await b.pump();
  r.db.exec(`VACUUM INTO '${backup}'`);
  a.local.n2 = { title: 'After the backup', html: '<p>lost by the server</p>' };
  await a.pump();
  await b.pump();
  b.local.n3 = { title: 'Also after', html: '' };
  await b.pump();
  const port = r.port;
  await r.close();
  fs.copyFileSync(backup, db);
  for (const x of ['-wal', '-shm']) fs.rmSync(db + x, { force: true });
  r = await up({ db }, port);
  t.after(() => r.close());
  // A kept-alive connection to the old process fails once; a device just syncs again on its next trigger.
  await a.pump().catch(() => a.pump());
  await b.pump().catch(() => b.pump());
  await a.pump();
  const fresh = await join(await a.s.link(false));
  await fresh.pump();
  assert.deepEqual(ids(fresh.local), ['n1', 'n2', 'n3']);
  assert.deepEqual(a.local, b.local);
  assert.deepEqual(fresh.local, a.local);
});
