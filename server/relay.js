#!/usr/bin/env node
// Glaze's share relay (spike S6). It keeps share sessions as sealed batches and encrypted files, and rings the devices
// that follow them. It can't read either: Glaze encrypts everything with a key from the share link's # part, which
// browsers don't send. It checks every write's signature against the session's public key, so only edit links write,
// and each batch is signed for its place in the log, so nothing can be replayed. No accounts, no cookies, no request
// logs; client addresses live in memory only, for rate limits, and go once their limits refill.
// Node's built-ins only (node:sqlite: Node 22.13 or later). One command, behind a TLS reverse proxy:
//   node server/relay.js                   PORT (8787), HOST (127.0.0.1), DB (./share.db), BLOBS (./share-blobs),
//                                          IP_HEADER (the header the proxy puts the client's address in; for
//                                          X-Forwarded-For its last entry), TRUSTED_PROXIES (the peers whose IP_HEADER
//                                          counts, addresses or CIDRs; default this computer only), MAX_BYTES (5 GiB
//                                          of batches), MAX_BLOB_BYTES (20 GiB of files), MAX_SESSIONS (500,000,
//                                          deleted ones included). These cap what's stored, not the disk itself:
//                                          leave room for the database's own overhead, its WAL and backups.
//                                          Files go to Cloudflare R2 instead of BLOBS when R2_ACCOUNT_ID,
//                                          R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are set.
//   node server/relay.js --backup <file>   a consistent copy of the database (SQLite's online backup, read-only), safe
//                                          beside a serving relay; files aren't in it
//   node server/relay.js --delete <id>     delete a session and its files (an abuse report), beside a serving relay too
// One relay serves a database at a time: it holds a lease in the database, renewed every 15 s and checked by every write
// it makes (a relay that lost it writes nothing and stops). After a crash, the next start waits for the lease to lapse
// (up to a minute). An upload that never committed has its key recorded (doomed) and deleted again over a week.
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { DatabaseSync, backup: sqliteBackup } = require('node:sqlite');

// A sealed batch; one session's batches together; a JSON body (a batch in base64); a catch-up page; an encrypted file
// (a 20 MiB attachment, padded); one session's files together; sessions per socket; sockets per address; a frame from
// a client; what a socket may have waiting to be sent before it counts as not reading.
const LIMIT = { op: 4 << 20, session: 50 << 20, body: 5600000 + 4096, page: 4 << 20, blob: (20 << 20) + 4096 + 28, blobs: 500 << 20, sub: 200, sockets: 8, frame: 16384, backlog: 65536 };
// Per client address (an IPv6 /64): [burst, refilled over ms]. bytes counts what is written, down what is read.
const RATE = { create: [30, 3600e3], write: [240, 60e3], read: [600, 60e3], bytes: [500 << 20, 3600e3], down: [2 ** 31, 3600e3] };
const SID = /^[\w-]{22}$/, KEY = /^[\w-]{43}$/, SIG = /^[\w-]{86}$/, B64 = /^[\w-]+$/;
const DAY = 864e5;
const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glaze share</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:34em;margin:3em auto;padding:0 1em;color:#222;background:#fff}@media(prefers-color-scheme:dark){body{color:#eee;background:#161616}}</style>
<h1>A Glaze share link</h1><p>Someone shared notes, a Look or a list with you through Glaze. To open it, copy this page's address and
paste it into Glaze under <b>Shared</b>. If Glaze is installed and set to use this server, it offers to open it here.</p>
<p>What's shared is encrypted. Its key is the part of the address after <b>#</b>, which browsers don't send to servers.
This page runs no scripts. Your browser may keep the whole address, key included, in its history; pasting the link into
Glaze instead of opening it avoids that.</p>`;

// ---- file stores: the relay's own disk, or an S3-compatible bucket (Cloudflare R2) ------------------------------------
// AWS Signature Version 4 (header form), as R2 takes it. Exported for its test vector.
const sigv4 = ({ method, url, headers = {}, body = '', keyId, secret, region, service = 's3', date = new Date() }) => {
  const u = new URL(url);
  const amz = date.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const hash = (x) => crypto.createHash('sha256').update(x).digest('hex');
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-date': amz };
  const names = Object.keys(all).sort();
  const scope = `${amz.slice(0, 8)}/${region}/${service}/aws4_request`;
  const canonical = [method, u.pathname, '', ...names.map((n) => `${n}:${all[n]}`), '', names.join(';'), all['x-amz-content-sha256'] || hash(body)].join('\n');
  let k = crypto.createHmac('sha256', `AWS4${secret}`).update(amz.slice(0, 8)).digest();
  for (const x of [region, service, 'aws4_request']) k = crypto.createHmac('sha256', k).update(x).digest();
  const sig = crypto.createHmac('sha256', k).update(['AWS4-HMAC-SHA256', amz, scope, hash(canonical)].join('\n')).digest('hex');
  delete all.host; // fetch sets it
  return { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
};
const s3Store = ({ endpoint, bucket, keyId, secret, region = 'auto' }) => {
  const call = async (method, key, body = Buffer.alloc(0)) => {
    const url = `${endpoint}/${bucket}/${key}`;
    const headers = sigv4({ method, url, headers: { 'x-amz-content-sha256': crypto.createHash('sha256').update(body).digest('hex') }, keyId, secret, region });
    const r = await fetch(url, { method, headers, body: method === 'PUT' ? body : undefined, signal: AbortSignal.timeout(60e3) });
    if (!r.ok && !(method === 'DELETE' && r.status === 404) && !(method === 'GET' && r.status === 404)) throw new Error(`store ${method} ${r.status}`);
    return r;
  };
  return {
    put: async (key, bytes) => { await call('PUT', key, bytes); },
    get: async (key) => { const r = await call('GET', key); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; },
    del: async (key) => { await call('DELETE', key); },
  };
};
const diskStore = (dir) => {
  const at = (key) => path.join(dir, ...key.split('/'));
  return {
    put: async (key, bytes) => {
      await fs.promises.mkdir(path.dirname(at(key)), { recursive: true });
      await fs.promises.writeFile(`${at(key)}.part`, bytes);
      await fs.promises.rename(`${at(key)}.part`, at(key));
    },
    get: (key) => fs.promises.readFile(at(key)).catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e))),
    del: async (key) => { await fs.promises.rm(at(key), { force: true }); await fs.promises.rmdir(path.dirname(at(key))).catch(() => {}); },
  };
};

const relay = ({ db: file = 'share.db', store = diskStore('share-blobs'), ipHeader = '', trustedProxies = '127.0.0.1/8,::1/128', maxBytes = 5 * 2 ** 30,
  maxBlobBytes = 20 * 2 ** 30, maxSessions = 500000, expiryDays = 365, lease = 60e3, grace = 600e3, drain = 5000, rate = RATE, limit = LIMIT } = {}) => {
  // A busy timeout: --delete and a serving relay may write at the same moment.
  const db = new DatabaseSync(file, { timeout: 5000 });
  // A file's row is written before its object and counts from then on: `at` is set while it uploads (pending) and
  // cleared once stored, so a row with no object, or an object a deleted share no longer wants, is always found.
  // `doomed` holds the keys that may hold an object no row wants: an upload that didn't commit (it failed, or its relay
  // lost the lease, or another relay reclaimed it). Recorded before anything is deleted, deleted again on a schedule
  // that outlasts any write still in flight, and dropped only after the last delete. No bucket listing is needed.
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, pub BLOB, del BLOB, expire INTEGER NOT NULL DEFAULT 0, touched INTEGER NOT NULL,
      head INTEGER NOT NULL DEFAULT 0, base INTEGER NOT NULL DEFAULT 0, base_sig BLOB, bytes INTEGER NOT NULL DEFAULT 0, gone INTEGER) STRICT;
    CREATE TABLE IF NOT EXISTS ops (sid TEXT NOT NULL, n INTEGER NOT NULL, op BLOB NOT NULL, sig BLOB NOT NULL, PRIMARY KEY (sid, n)) STRICT, WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS blobs (sid TEXT NOT NULL, id TEXT NOT NULL, size INTEGER NOT NULL, at INTEGER, owner TEXT, PRIMARY KEY (sid, id)) STRICT, WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS doomed (sid TEXT NOT NULL, id TEXT NOT NULL, size INTEGER NOT NULL, since INTEGER NOT NULL, next INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0, counted INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (sid, id)) STRICT, WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK (id = 1), boot TEXT NOT NULL, seen INTEGER NOT NULL) STRICT;
    -- What's stored, kept by SQLite itself in the same transaction as every change, so every process (the serving relay,
    -- a --delete beside it, a relay that lost its lease) sees the same numbers: batches' bytes; files' bytes (a file
    -- counts from its pending row until its row goes with its object, and a doomed key while it counts); and sessions
    -- with their tombstones.
    CREATE TABLE IF NOT EXISTS totals (id INTEGER PRIMARY KEY CHECK (id = 1), log INTEGER NOT NULL, blob INTEGER NOT NULL, sessions INTEGER NOT NULL) STRICT;
    INSERT OR IGNORE INTO totals SELECT 1, (SELECT coalesce(sum(bytes), 0) FROM sessions),
      (SELECT coalesce(sum(size), 0) FROM blobs) + (SELECT coalesce(sum(size * counted), 0) FROM doomed), (SELECT count(*) FROM sessions);
    CREATE TRIGGER IF NOT EXISTS blob_in AFTER INSERT ON blobs BEGIN UPDATE totals SET blob = blob + NEW.size; END;
    CREATE TRIGGER IF NOT EXISTS blob_out AFTER DELETE ON blobs BEGIN UPDATE totals SET blob = blob - OLD.size; END;
    CREATE TRIGGER IF NOT EXISTS doomed_in AFTER INSERT ON doomed BEGIN UPDATE totals SET blob = blob + NEW.size * NEW.counted; END;
    CREATE TRIGGER IF NOT EXISTS doomed_out AFTER DELETE ON doomed BEGIN UPDATE totals SET blob = blob - OLD.size * OLD.counted; END;
    CREATE TRIGGER IF NOT EXISTS doomed_count AFTER UPDATE OF counted ON doomed BEGIN UPDATE totals SET blob = blob + (NEW.counted - OLD.counted) * NEW.size; END;
    CREATE TRIGGER IF NOT EXISTS session_in AFTER INSERT ON sessions BEGIN UPDATE totals SET sessions = sessions + 1, log = log + NEW.bytes; END;
    CREATE TRIGGER IF NOT EXISTS session_bytes AFTER UPDATE OF bytes ON sessions BEGIN UPDATE totals SET log = log + NEW.bytes - OLD.bytes; END;`);
  const q = Object.fromEntries(Object.entries({
    get: 'SELECT * FROM sessions WHERE sid = ?',
    make: 'INSERT INTO sessions (sid, pub, del, expire, touched) VALUES (?, ?, ?, ?, ?)',
    touch: 'UPDATE sessions SET touched = ? WHERE sid = ? AND touched < ?',
    expiry: 'UPDATE sessions SET expire = ?, touched = ? WHERE sid = ?',
    add: 'INSERT INTO ops (sid, n, op, sig) VALUES (?, ?, ?, ?)',
    grow: 'UPDATE sessions SET head = ?, bytes = bytes + ? WHERE sid = ?',
    page: 'SELECT n, op, sig FROM ops WHERE sid = ? AND n > ? ORDER BY n LIMIT 1000',
    at: 'SELECT sig FROM ops WHERE sid = ? AND n = ?',
    upto: 'SELECT coalesce(sum(length(op)), 0) AS b FROM ops WHERE sid = ? AND n <= ?',
    drop: 'DELETE FROM ops WHERE sid = ? AND n <= ?',
    trim: 'UPDATE sessions SET base = ?, base_sig = ?, bytes = bytes - ? WHERE sid = ?',
    gone: 'UPDATE sessions SET pub = NULL, del = NULL, base_sig = NULL, bytes = 0, gone = ? WHERE sid = ?',
    blob: 'SELECT size, at, owner FROM blobs WHERE sid = ? AND id = ?',
    addBlob: 'INSERT OR IGNORE INTO blobs (sid, id, size, at, owner) VALUES (?, ?, ?, ?, ?)',
    // A key doomed again (a late write from a relay that lost its lease) counts again and starts its schedule over.
    doom: `INSERT INTO doomed (sid, id, size, since, next) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (sid, id) DO UPDATE SET since = excluded.since, next = excluded.next, tries = 0, counted = 1`,
    due: 'SELECT sid, id, since, tries FROM doomed WHERE next <= ? ORDER BY next LIMIT 1000',
    doomRetry: 'UPDATE doomed SET next = ? WHERE sid = ? AND id = ?',
    doomStep: 'UPDATE doomed SET tries = ?, next = ?, counted = ? WHERE sid = ? AND id = ?',
    undoom: 'DELETE FROM doomed WHERE sid = ? AND id = ?',
    leaseGet: 'SELECT boot, seen FROM lease WHERE id = 1',
    leaseTake: 'INSERT OR REPLACE INTO lease (id, boot, seen) VALUES (1, ?, ?)',
    leaseRenew: 'UPDATE lease SET seen = ? WHERE id = 1 AND boot = ?',
    leaseFree: 'DELETE FROM lease WHERE id = 1 AND boot = ?',
    stored: 'UPDATE blobs SET at = NULL WHERE sid = ? AND id = ?',
    dropBlob: 'DELETE FROM blobs WHERE sid = ? AND id = ?',
    blobBytes: 'SELECT coalesce(sum(size), 0) AS b FROM blobs WHERE sid = ?',
    // Files to remove from the store: a deleted share's stored files; and, for the relay holding the lease only, pending
    // uploads it doesn't own (left by a relay that died or lost the lease), which it dooms.
    orphans: `SELECT b.sid, b.id, b.size, b.at FROM blobs b JOIN sessions s ON s.sid = b.sid
      WHERE (b.at IS NULL AND s.gone IS NOT NULL) OR (b.at IS NOT NULL AND $serving = 1 AND (b.owner IS NULL OR b.owner <> $boot)) LIMIT 1000`,
    old: 'SELECT sid FROM sessions WHERE expire = 1 AND gone IS NULL AND touched < ?',
    totals: 'SELECT log, blob, sessions FROM totals WHERE id = 1',
  }).map(([k, sql]) => [k, db.prepare(sql)]));
  const tx = (f) => { db.exec('BEGIN IMMEDIATE'); try { const out = f(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  // Read at each check, never cached: another process may have changed them.
  const used = () => q.totals.get();
  const today = () => Math.floor(Date.now() / DAY);

  // ---- limits: token buckets per client address, in memory only --------------------------------------------------
  const buckets = new Map();
  const take = (ip, kind, cost = 1) => {
    const [cap, per] = rate[kind], now = Date.now();
    const b = buckets.get(ip) || buckets.set(ip, {}).get(ip);
    const [tok, at] = b[kind] || [cap, now];
    const left = Math.min(cap, tok + ((now - at) * cap) / per);
    b[kind] = [left >= cost ? left - cost : left, now];
    return left >= cost;
  };
  // IPv4 as is; IPv6 by its /64, which one subscriber usually holds whole.
  const keyOf = (ip) => {
    ip = ip.replace(/^::ffff:(?=\d+\.)/, '');
    if (!ip.includes(':')) return ip;
    const [a, b = ''] = ip.split('%')[0].split('::');
    const head = a ? a.split(':') : [], tail = b ? b.split(':') : [];
    const all = ip.includes('::') ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
    return all.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(':') + '::/64';
  };
  // The forwarded address counts only when the peer is one of the configured proxies and the value is an address;
  // otherwise the peer itself does. Setting IP_HEADER alone trusts nobody but this computer.
  const trusted = new net.BlockList();
  const family = (ip) => (net.isIPv6(ip) ? 'ipv6' : 'ipv4');
  for (const x of String(trustedProxies).split(',')) {
    const [ip, bits] = x.trim().split('/');
    if (!net.isIP(ip)) continue;
    if (bits === undefined) trusted.addAddress(ip, family(ip)); else trusted.addSubnet(ip, Number(bits), family(ip));
  }
  const bare = (ip) => ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  const clientOf = (req) => {
    const peer = bare(req.socket.remoteAddress || '');
    const fwd = ipHeader && net.isIP(peer) && trusted.check(peer, family(peer)) ? bare(String(req.headers[ipHeader] || '').split(',').pop().trim()) : '';
    return keyOf(net.isIP(fwd) ? fwd : peer);
  };
  // A request target Node accepts can still be one URL refuses (`http://[`): that's a bad request, never a crash.
  const target = (req) => { try { return new URL(req.url, 'http://relay'); } catch { return null; } };

  // ---- the live doorbell: a minimal WebSocket server (RFC 6455, text frames) --------------------------------------
  const subs = new Map(); // sid -> Set of sockets
  const perIp = new Map();
  const all = new Set();
  const frame = (op, data) => Buffer.concat([data.length < 126 ? Buffer.from([0x80 | op, data.length]) : Buffer.from([0x80 | op, 126, data.length >> 8, data.length & 255]), data]);
  // A socket that doesn't read what it's sent is cut off rather than buffered for.
  const say = (sock, m) => { if (sock.destroyed) return; if (sock.writableLength > limit.backlog) sock.destroy(); else sock.write(frame(1, Buffer.from(JSON.stringify(m)))); };
  const ring = (sid, m) => { for (const sock of subs.get(sid) || []) say(sock, { s: sid, ...m }); };
  const unsub = (sock) => { for (const sid of sock.subs || []) { const set = subs.get(sid); set?.delete(sock); if (set && !set.size) subs.delete(sid); } sock.subs = new Set(); };
  const upgrade = (req, sock, early) => {
    const ip = clientOf(req);
    const key = req.headers['sec-websocket-key'];
    if (!serving) return sock.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    if (target(req)?.pathname !== '/live' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string') return sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    if ((perIp.get(ip) || 0) >= limit.sockets || !take(ip, 'read')) return sock.end('HTTP/1.1 429 Too Many Requests\r\n\r\n');
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    all.add(sock);
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    sock.subs = new Set();
    let buf = Buffer.alloc(0), done = false;
    const bye = (code = 1000) => {
      if (done) return;
      done = true;
      unsub(sock);
      all.delete(sock);
      perIp.set(ip, perIp.get(ip) - 1);
      if (!perIp.get(ip)) perIp.delete(ip);
      if (!sock.destroyed) sock.end(frame(8, Buffer.from([code >> 8, code & 255])));
    };
    const text = (s) => {
      let m;
      try { m = JSON.parse(s); } catch { return bye(1003); }
      if (!take(ip, 'read')) return bye(1008);
      if (!Array.isArray(m?.sub) || m.sub.length > limit.sub || !m.sub.every((x) => typeof x === 'string' && SID.test(x))) return bye(1008);
      unsub(sock);
      sock.subs = new Set(m.sub);
      for (const sid of sock.subs) {
        (subs.get(sid) || subs.set(sid, new Set()).get(sid)).add(sock);
        const r = q.get.get(sid);
        if (r) say(sock, r.gone ? { s: sid, gone: 1 } : { s: sid, n: r.head });
      }
    };
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2 && !done) {
        const op = buf[0] & 15, fin = buf[0] & 0x80, masked = buf[1] & 0x80;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        if (len === 127 || len > limit.frame || !masked || !fin) return bye(1009);
        if (buf.length < at + 4 + len) return;
        const data = Buffer.from(buf.subarray(at + 4, at + 4 + len));
        for (let i = 0; i < len; i++) data[i] ^= buf[at + (i & 3)];
        buf = buf.subarray(at + 4 + len);
        if (op === 1) text(data.toString());
        else if (op === 8) bye();
        else if (op === 9) { if (sock.writableLength <= limit.backlog) sock.write(frame(10, data)); }
        else if (op !== 10) bye(1003);
      }
    };
    sock.on('data', onData);
    if (early?.length) onData(early); // bytes that came with the handshake
    sock.on('error', () => bye(1011));
    sock.on('close', () => bye());
  };

  // ---- deletion and expiry ------------------------------------------------------------------------------------------
  // A deleted session's batches go at once; its id stays (with the day) so it can't be made again. Its files go from
  // the store one by one, each row only once its file is gone, so a store that's down is caught up with later.
  // A pending upload belongs to the serving relay that started it (its boot id). Only the relay holding the database's
  // lease reclaims pending rows, and only those it doesn't own. A process that isn't serving (--delete) never touches
  // pending rows; an upload in flight finds its session gone itself.
  const boot = crypto.randomUUID();
  // listening: this relay serves (and so must hold the lease for every write); serving: it holds the lease right now.
  let listening = false, serving = false;
  // The lease is this relay's fencing token. Every write a serving relay makes runs in a transaction that first checks
  // it still holds the lease and renews it, so a relay that stalled (in an upload, say) while another took over writes
  // nothing. One that finds it has lost the lease answers 503 to everything at once, and closes once its requests end.
  const fenced = () => Object.assign(new Error('not serving'), { status: 503, fenced: true });
  const lose = () => {
    if (!serving) return;
    serving = false;
    console.error('relay: lost the database lease; stopping');
    setImmediate(() => close(true));
  };
  const write = (f) => tx(() => {
    if (listening && (!serving || !q.leaseRenew.run(Date.now(), boot).changes)) { lose(); throw fenced(); }
    return f();
  });
  const uploading = new Set();
  let removing = Promise.resolve();
  // ---- doomed keys: an object no row wants, deleted durably -------------------------------------------------------
  // A lapsed lease doesn't prove its holder's store write has stopped (a paused process can resume; a bucket can finish
  // a request it already had), and a put that threw may have landed anyway. So an upload that doesn't commit, whatever
  // its put did, is doomed: its key is recorded first, in a write that needs no lease (recording a key to delete is
  // always safe), then deleted at once if the store answers, and again `grace`, 6, 144 and 1,008 × grace after it was
  // doomed (10 minutes, an hour, a day and a week by default). Its room counts until the first of those deletes; the
  // record goes after the last. A failed delete is tried again every few minutes, across restarts, by whichever relay
  // holds the lease. A key doomed again (a late write that landed after all) counts again and starts over. What stays a
  // timing assumption: a dead relay's request that a bucket completes more than a week after it was sent.
  const STEPS = [1, 6, 144, 1008].map((x) => x * grace);
  // Recorded by a relay without the lease: due at once, so the holder takes it over on its next sweep and schedules it
  // by its own clock and grace.
  const doom = (sid, id, size) => {
    const now = Date.now();
    tx(() => q.doom.run(sid, id, size, now, now));
    return store.del(`${sid}/${id}`).catch((e) => console.error('relay: file store:', e.message));
  };
  // The holder deletes each due key; how many scheduled points have passed since it was doomed decides what's next:
  // after the first, its room stops counting; after the last, the record goes.
  const reconcile = async () => {
    for (const { sid, id, since } of q.due.all(Date.now())) {
      // The key is wanted again (an upload reused the id): never delete it from under its row.
      if (q.blob.get(sid, id)) { write(() => q.undoom.run(sid, id)); continue; }
      try { await store.del(`${sid}/${id}`); } catch (e) {
        console.error('relay: file store:', e.message);
        write(() => q.doomRetry.run(Date.now() + Math.min(grace, 300e3), sid, id));
        return;
      }
      const passed = STEPS.filter((s) => s <= Date.now() - since).length;
      write(() => (passed >= STEPS.length ? q.undoom.run(sid, id) : q.doomStep.run(passed, since + STEPS[passed], passed ? 0 : 1, sid, id)));
    }
  };
  const removeFiles = () => (removing = removing.then(async () => {
    try {
      for (const { sid, id, size, at } of q.orphans.all({ serving: serving ? 1 : 0, boot })) {
        if (uploading.has(`${sid}/${id}`)) continue;
        if (at !== null) {
          // Another relay's upload that never committed: its row becomes a doomed key, in one write, so its room stays
          // counted through the schedule.
          write(() => { q.dropBlob.run(sid, id); q.doom.run(sid, id, size, Date.now(), Date.now() + STEPS[0]); });
          await store.del(`${sid}/${id}`).catch(() => {});
          continue;
        }
        try { await store.del(`${sid}/${id}`); } catch (e) { console.error('relay: file store:', e.message); return; }
        write(() => q.dropBlob.run(sid, id));
      }
      if (serving) await reconcile();
    } catch (e) { if (!e.fenced) throw e; }
  }));
  const remove = (sid) => {
    const row = q.get.get(sid);
    if (!row || row.gone) return false;
    write(() => { q.drop.run(sid, Number.MAX_SAFE_INTEGER); q.gone.run(today(), sid); });
    ring(sid, { gone: 1 });
    removeFiles();
    return true;
  };
  // Opt-in expiry: a session its creator asked to expire goes once nobody has read or written it for expiryDays.
  const expire = async () => { for (const { sid } of q.old.all(today() - expiryDays)) remove(sid); return removeFiles(); };
  // ---- the lease: one serving relay per database ------------------------------------------------------------------
  // listen() takes it (waiting out a dead holder's lease, refusing while a live one renews it), renews it every quarter
  // lease, and gives it back on close. Without it, nothing is reclaimed and no timers run: --backup and --delete
  // processes beside a serving relay leave its uploads alone.
  const timers = [];
  const takeLease = async () => {
    const giveUp = Date.now() + 3 * lease;
    for (;;) {
      const held = tx(() => {
        const r = q.leaseGet.get();
        if (r && r.boot !== boot && Date.now() - r.seen < lease) return r.seen;
        q.leaseTake.run(boot, Date.now());
        return 0;
      });
      if (!held) return;
      if (Date.now() > giveUp) throw new Error('another relay is serving this database');
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, held + lease - Date.now() + 10)));
    }
  };
  const serve = async () => {
    await takeLease();
    listening = serving = true;
    timers.push(
      // Renewal between writes. A relay that stalls past its lease and finds it taken stops serving at once.
      setInterval(() => { try { write(() => {}); } catch {} }, lease / 4),
      // Forget an address once every one of its buckets would be full again.
      setInterval(() => {
        const now = Date.now();
        for (const [ip, b] of buckets) if (Object.entries(b).every(([k, [, at]]) => now - at >= rate[k][1])) buckets.delete(ip);
      }, 600e3),
      // Expiry every 6 hours; files left in the store (and reclaims whose grace is over) every `grace`.
      setInterval(() => { expire().catch(() => {}); }, 6 * 3600e3),
      setInterval(() => { removeFiles().catch(() => {}); }, grace),
      // A heartbeat to every socket: a dead connection shows itself, and it keeps a Chrome service worker awake while open.
      setInterval(() => { for (const sock of all) say(sock, {}); }, 25e3),
    );
    for (const t of timers) t.unref();
    // Pending uploads of a relay that died, and anything due to expire.
    await expire().catch(() => {});
  };

  // ---- HTTP ---------------------------------------------------------------------------------------------------------
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, {
      'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      ...(type.startsWith('text/html') && { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" }),
      ...(status === 429 && { 'retry-after': '60' }),
    });
    res.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
  };
  const raw = (req, cap) => new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (d) => { size += d.length; if (size > cap) { req.pause(); reject(Object.assign(new Error('big'), { status: 413 })); } else parts.push(d); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
  const json = (req) => raw(req, limit.body).then((b) => { try { return JSON.parse(b.toString() || 'null'); } catch { throw Object.assign(new Error('bad'), { status: 400 }); } });
  const bytes = (s) => (typeof s === 'string' && B64.test(s) ? Buffer.from(s, 'base64url') : null);
  const sigOf = (s) => (typeof s === 'string' && SIG.test(s) ? Buffer.from(s, 'base64url') : null);
  // What a signature covers: Glaze's prefix, the session, the kind, its place (a batch's number, a trim's end, a file's
  // id), then the bytes. The same function makes it in lib/sharing.js.
  const signed = (pub, sid, kind, extra, data, sig) => {
    try {
      const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub).toString('base64url') }, format: 'jwk' });
      return crypto.verify(null, Buffer.concat([Buffer.from(`gzs1|${sid}|${kind}|${extra}`), data]), key, sig);
    } catch { return false; }
  };
  const ROUTE = /^\/s\/([\w-]{22})(?:\/(trim|expiry)|\/b\/([\w-]{22}))?$/;
  const handle = async (req, res) => {
    const ip = clientOf(req);
    const url = target(req);
    if (!url) return send(res, 400, { error: 'bad' });
    // A relay that has lost its lease takes no more work, not even a health check.
    if (!serving) return send(res, 503, { error: 'not serving' });
    const look = req.method === 'GET' || req.method === 'HEAD';
    if (look && (url.pathname === '/' || url.pathname === '/j')) return send(res, 200, PAGE, 'text/html; charset=utf-8');
    if (look && url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/s') {
      if (!take(ip, 'create')) return send(res, 429, { error: 'rate' });
      const b = await json(req);
      if (!SID.test(b?.sid) || !KEY.test(b.pub) || !KEY.test(b.del)) return send(res, 400, { error: 'bad' });
      const [status, error] = write(() => {
        if (q.get.get(b.sid)) return [409, 'exists'];
        const u = used();
        if (u.log >= maxBytes || u.sessions >= maxSessions) return [507, 'full'];
        q.make.run(b.sid, Buffer.from(b.pub, 'base64url'), Buffer.from(b.del, 'base64url'), b.expire === true ? 1 : 0, today());
        return [201];
      });
      return send(res, status, error ? { error } : {});
    }
    const m = ROUTE.exec(url.pathname);
    const kind = !m ? null : m[3] ? { GET: 'getBlob', PUT: 'putBlob' }[req.method] : m[2] === 'trim' ? req.method === 'POST' && 'trim'
      : m[2] === 'expiry' ? req.method === 'POST' && 'expiry' : { GET: 'read', POST: 'append', DELETE: 'delete' }[req.method];
    if (!kind) return send(res, m ? 405 : 404, { error: m ? 'method' : 'unknown' });
    if (!take(ip, kind === 'read' || kind === 'getBlob' ? 'read' : 'write')) return send(res, 429, { error: 'rate' });
    // The body first, then the session as it is once the body is in: other requests may have changed it meanwhile.
    const b = kind === 'putBlob' ? await raw(req, limit.blob) : ['append', 'trim', 'expiry'].includes(kind) ? await json(req) : null;
    const sid = m[1];
    const row = q.get.get(sid);
    if (!row) return send(res, 404, { error: 'unknown' });
    if (row.gone) return send(res, 410, { error: 'gone' });
    // The last day anyone used it, kept only for a session that can expire.
    if (row.expire) write(() => q.touch.run(today(), sid, today()));

    if (kind === 'read') {
      const after = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) return send(res, 400, { error: 'bad' });
      // at: the signature of batch `after` (of the last one trimmed, when that's where it is), so a device can tell a
      // server restored from an older backup from the one it read.
      const at = after > row.base ? q.at.get(sid, after)?.sig : after === row.base && after > 0 ? row.base_sig : null;
      const out = { head: row.head, base: row.base, at: at ? Buffer.from(at).toString('base64url') : null, ops: [], more: false };
      let size = 0;
      const rows = q.page.all(sid, Math.max(after, row.base));
      for (const o of rows) {
        if (size + o.op.length > limit.page && out.ops.length) { out.more = true; break; }
        out.ops.push({ n: o.n, op: Buffer.from(o.op).toString('base64url'), sig: Buffer.from(o.sig).toString('base64url') });
        size += o.op.length;
      }
      if (!out.more && rows.length === 1000) out.more = true;
      if (!take(ip, 'down', size)) return send(res, 429, { error: 'rate' });
      return send(res, 200, out);
    }
    if (kind === 'append') {
      // Signed for one place in the log: the next one. A batch sent again, or for another place, isn't taken.
      const op = bytes(b?.op), sig = sigOf(b?.sig);
      if (!op || !sig || op.length < 29 || !Number.isSafeInteger(b.n)) return send(res, 400, { error: 'bad' });
      if (op.length > limit.op) return send(res, 413, { error: 'big' });
      if (b.n !== row.head + 1) return send(res, 409, { error: 'place', head: row.head });
      if (!signed(row.pub, sid, 'op', String(b.n), op, sig)) return send(res, 403, { error: 'signature' });
      if (!take(ip, 'bytes', op.length)) return send(res, 429, { error: 'rate' });
      if (row.bytes + op.length > limit.session || used().log + op.length > maxBytes) return send(res, 507, { error: 'full' });
      write(() => { q.add.run(sid, b.n, op, sig); q.grow.run(b.n, op.length, sid); });
      ring(sid, { n: b.n });
      return send(res, 201, { n: b.n });
    }
    if (kind === 'trim') {
      // An editor drops the batches up to `upto` after sending the whole state again past them. Signed over upto and
      // the signature of batch upto, so it trims only the log it was made for.
      const sig = sigOf(b?.sig);
      if (!sig || !Number.isSafeInteger(b.upto)) return send(res, 400, { error: 'bad' });
      const last = b.upto > row.base && b.upto <= row.head ? q.at.get(sid, b.upto)?.sig : null;
      if (!last) return send(res, 409, { error: 'stale' });
      if (!signed(row.pub, sid, 'trim', String(b.upto), Buffer.from(last), sig)) return send(res, 403, { error: 'signature' });
      const freed = Number(q.upto.get(sid, b.upto).b);
      write(() => { q.drop.run(sid, b.upto); q.trim.run(b.upto, last, freed, sid); });
      return send(res, 200, { base: b.upto });
    }
    if (kind === 'putBlob') {
      const sig = sigOf(req.headers['x-glaze-sig']);
      if (!sig || b.length < 29) return send(res, 400, { error: 'bad' });
      if (q.blob.get(sid, m[3])) return send(res, 409, { error: 'exists' });
      if (!signed(row.pub, sid, 'blob', m[3], b, sig)) return send(res, 403, { error: 'signature' });
      if (!take(ip, 'bytes', b.length)) return send(res, 429, { error: 'rate' });
      if (Number(q.blobBytes.get(sid).b) + b.length > limit.blobs || used().blob + b.length > maxBlobBytes) return send(res, 507, { error: 'full' });
      // On the books (a pending row this relay owns) before the store call: two uploads at once can't both take the last
      // room, and a file whose share is deleted meanwhile is never lost track of. No other process reclaims it.
      const key = `${sid}/${m[3]}`;
      write(() => q.addBlob.run(sid, m[3], b.length, Date.now(), boot));
      uploading.add(key);
      let failed = null;
      try { await store.put(key, b); } catch (e) { failed = e; } finally { uploading.delete(key); }
      // After the wait, one transaction decides, and only while this relay still holds the lease and its own pending row
      // is still there. Anything else commits nothing: no row is kept or revived as stored.
      let outcome;
      try {
        outcome = write(() => {
          const mine = q.blob.get(sid, m[3]);
          if (!mine || mine.at === null || mine.owner !== boot) return 'lost';
          // Deleted while it uploaded (stored or not): never acknowledged; kept on the books as a deleted share's file,
          // which every sweep removes with whatever the store holds.
          if (q.get.get(sid)?.gone) { q.stored.run(sid, m[3]); return 'gone'; }
          if (failed) { q.dropBlob.run(sid, m[3]); q.doom.run(sid, m[3], b.length, Date.now(), Date.now() + STEPS[0]); return 'failed'; }
          q.stored.run(sid, m[3]);
          return 'stored';
        });
      } catch (e) { if (!e.fenced) throw e; outcome = 'fenced'; }
      if (outcome === 'stored') return send(res, 201, {});
      if (outcome === 'gone') { await removeFiles(); return send(res, 410, { error: 'gone' }); }
      // Not committed: the key is doomed whatever the put did (it may have landed even if it threw), so it's recorded
      // before any delete and deleted on the schedule by whichever relay holds the lease. A failed put's row went into
      // the doomed list above, with its room; a relay without the lease records the key without it.
      if (outcome === 'failed') { await store.del(key).catch((e) => console.error('relay: file store:', e.message)); throw failed; }
      await doom(sid, m[3], b.length);
      throw outcome === 'fenced' ? fenced() : Object.assign(new Error('upload lost'), { status: 409 });
    }
    if (kind === 'getBlob') {
      const meta = q.blob.get(sid, m[3]);
      if (!meta || meta.at !== null) return send(res, 404, { error: 'unknown' });
      if (!take(ip, 'down', meta.size)) return send(res, 429, { error: 'rate' });
      const data = await store.get(`${sid}/${m[3]}`);
      return data ? send(res, 200, data, 'application/octet-stream') : send(res, 404, { error: 'unknown' });
    }
    // expiry and delete: the creator's token, whose hash the session keeps
    const token = bytes(/^Bearer ([\w-]{43})$/.exec(req.headers.authorization || '')?.[1]);
    const hash = token && crypto.createHash('sha256').update(token).digest();
    if (!hash || !crypto.timingSafeEqual(hash, Buffer.from(row.del))) return send(res, 403, { error: 'token' });
    if (kind === 'expiry') {
      if (typeof b?.on !== 'boolean') return send(res, 400, { error: 'bad' });
      write(() => q.expiry.run(b.on ? 1 : 0, today(), sid));
      return send(res, 200, { expire: b.on });
    }
    remove(sid);
    return send(res, 204, '');
  };

  // A body over the cap is answered 413 and its connection closed, rather than read to the end. Every request's handler
  // is tracked until it ends, connection or not: an upload's clean-up (dooming its key) runs even after its connection
  // was closed, and the database stays open for it.
  const running = new Set();
  const server = http.createServer((req, res) => {
    const p = handle(req, res).catch((e) => {
      if (e.status === 413) res.once('finish', () => req.socket.destroy());
      if (res.destroyed) return;
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server' }); else res.destroy();
      if (!e.status) console.error('relay:', e.message);
    });
    running.add(p);
    p.finally(() => running.delete(p));
  });
  server.requestTimeout = 60e3;
  server.on('upgrade', upgrade);
  let closing = null;
  // gently: after losing the lease, requests already running get `drain` ms to finish with their answers; then their
  // connections are cut. Either way the database closes only once every handler has ended and the sweep has settled.
  const close = (gently = false) => (closing ||= new Promise((resolve) => {
    for (const t of timers) clearInterval(t);
    for (const sock of all) sock.destroy();
    server.close(async () => {
      while (running.size) await Promise.allSettled([...running]);
      await removing;
      if (serving) q.leaseFree.run(boot);
      serving = false;
      db.close();
      resolve();
    });
    if (!gently) server.closeAllConnections();
    else { server.closeIdleConnections(); setTimeout(() => server.closeAllConnections(), drain).unref(); }
  }));
  return {
    server, db, remove, expire, subs, boot,
    // Files a deletion started removing: waited for by --delete before it exits.
    flush: () => removing,
    // Serving: the lease first, then reclaiming and expiry, then the port.
    listen: async (port, host) => {
      await serve();
      return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
    },
    close,
  };
};

// A consistent copy of the database through SQLite's online backup, on a read-only connection: it changes nothing,
// and it can run beside a serving relay.
const backup = async (file, dest) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { await sqliteBackup(db, dest); } finally { db.close(); }
  // The copy doesn't keep the serving relay's lease, so a relay restored from it starts at once. Uploads that were
  // pending then belong to no relay alive after a restore, and the restored relay reclaims them.
  const copy = new DatabaseSync(dest);
  try { copy.exec('DELETE FROM lease'); } finally { copy.close(); }
};

const fromEnv = (env) => ({
  db: env.DB || 'share.db',
  ipHeader: (env.IP_HEADER || '').toLowerCase(),
  trustedProxies: env.TRUSTED_PROXIES || undefined,
  maxSessions: Number(env.MAX_SESSIONS) || undefined,
  maxBytes: Number(env.MAX_BYTES) || undefined,
  maxBlobBytes: Number(env.MAX_BLOB_BYTES) || undefined,
  store: env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
    ? s3Store({ endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, bucket: env.R2_BUCKET, keyId: env.R2_ACCESS_KEY_ID, secret: env.R2_SECRET_ACCESS_KEY })
    : diskStore(env.BLOBS || 'share-blobs'),
});

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const fail = (e) => { console.error('relay:', e.message); process.exit(1); };
  // --backup opens nothing but a read-only connection; --delete doesn't serve, so it reclaims nothing pending.
  if (cmd === '--backup' && arg) backup(process.env.DB || 'share.db', arg).then(() => console.log('backed up'), fail);
  else if (cmd === '--delete' && SID.test(arg || '')) {
    const r = relay(fromEnv(process.env));
    const done = r.remove(arg);
    r.flush().then(() => console.log(done ? 'deleted' : 'no such session')).finally(() => r.close());
  } else if (cmd) { console.error('usage: relay.js [--backup <file> | --delete <session id>]'); process.exitCode = 2; }
  else {
    const r = relay(fromEnv(process.env));
    r.listen(Number(process.env.PORT) || 8787, process.env.HOST || '127.0.0.1').then((a) => console.log(`Glaze share relay on ${a.address}:${a.port}`), fail);
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => r.close().then(() => process.exit(0)));
  }
}

module.exports = { relay, backup, LIMIT, RATE, sigv4, s3Store, diskStore, fromEnv };
