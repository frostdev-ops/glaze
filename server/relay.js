#!/usr/bin/env node
// Glaze's share relay (spike S6). It keeps share sessions as sealed batches and rings the devices that follow them. It
// can't read them: Glaze encrypts everything with a key from the share link's # part, which browsers never send. It
// checks each batch's signature against the session's public key, so only edit links can write. No accounts, no
// cookies, no request logs; client addresses live in memory only, for rate limits, and go once their limits refill.
// Node's built-ins only (node:sqlite: Node 22.13 or later). One command, behind a TLS reverse proxy:
//   node server/relay.js                   PORT (8787), HOST (127.0.0.1), DB (./share.db), TRUST_PROXY=1 behind a
//                                          proxy (the client is the last X-Forwarded-For entry), MAX_BYTES (5 GiB)
//   node server/relay.js --backup <file>   a consistent copy of the database, safe while the relay runs
//   node server/relay.js --delete <id>     delete a session (an abuse report)
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// A sealed batch, one session's batches and snapshot together, a request body, a catch-up page, sessions per socket,
// sockets per client address, a frame from a client.
const LIMIT = { op: 1 << 20, session: 50 << 20, body: 1500000, page: 4 << 20, sub: 200, sockets: 8, frame: 16384 };
// Per client address (an IPv6 /64): [burst, refilled over ms]. bytes counts what is written, down what is read.
const RATE = { create: [30, 3600e3], write: [240, 60e3], read: [600, 60e3], bytes: [100 << 20, 3600e3], down: [1 << 30, 3600e3] };
const SID = /^[\w-]{22}$/, KEY = /^[\w-]{43}$/, SIG = /^[\w-]{86}$/, B64 = /^[\w-]+$/;
const DAY = 864e5;
const PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Glaze share</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:34em;margin:3em auto;padding:0 1em;color:#222;background:#fff}@media(prefers-color-scheme:dark){body{color:#eee;background:#161616}}</style>
<h1>A Glaze share link</h1><p>Someone shared notes, a Look or a list with you through Glaze. To open it, copy this page's address and
paste it into Glaze under <b>Shared</b>. If Glaze is installed and set to use this server, it offers to open it here.</p>
<p>What's shared is encrypted. Its key is the part of the address after <b>#</b>, which your browser never sends to this server.</p>`;

const relay = ({ db: file = 'share.db', trustProxy = false, maxBytes = 5 * 2 ** 30, rate = RATE, limit = LIMIT } = {}) => {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
    CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, pub BLOB, del BLOB, day INTEGER NOT NULL, head INTEGER NOT NULL DEFAULT 0,
      base INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0, snap BLOB, snap_sig BLOB, gone INTEGER) STRICT;
    CREATE TABLE IF NOT EXISTS ops (sid TEXT NOT NULL, n INTEGER NOT NULL, op BLOB NOT NULL, sig BLOB NOT NULL, PRIMARY KEY (sid, n)) STRICT, WITHOUT ROWID;`);
  const q = Object.fromEntries(Object.entries({
    get: 'SELECT * FROM sessions WHERE sid = ?',
    make: 'INSERT INTO sessions (sid, pub, del, day) VALUES (?, ?, ?, ?)',
    add: 'INSERT INTO ops (sid, n, op, sig) VALUES (?, ?, ?, ?)',
    grow: 'UPDATE sessions SET head = ?, bytes = bytes + ? WHERE sid = ?',
    page: 'SELECT n, op, sig FROM ops WHERE sid = ? AND n > ? ORDER BY n LIMIT 1000',
    at: 'SELECT sig FROM ops WHERE sid = ? AND n = ?',
    upto: 'SELECT coalesce(sum(length(op)), 0) AS b FROM ops WHERE sid = ? AND n <= ?',
    drop: 'DELETE FROM ops WHERE sid = ? AND n <= ?',
    snap: 'UPDATE sessions SET snap = ?, snap_sig = ?, base = ?, bytes = ? WHERE sid = ?',
    gone: 'UPDATE sessions SET pub = NULL, del = NULL, snap = NULL, snap_sig = NULL, bytes = 0, gone = ? WHERE sid = ?',
    total: 'SELECT coalesce(sum(bytes), 0) AS b FROM sessions',
  }).map(([k, sql]) => [k, db.prepare(sql)]));
  const tx = (f) => { db.exec('BEGIN IMMEDIATE'); try { const out = f(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  let total = Number(q.total.get().b);
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
  // Forget an address once every one of its buckets would be full again.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of buckets) if (Object.entries(b).every(([k, [, at]]) => now - at >= rate[k][1])) buckets.delete(ip);
  }, 600e3);
  sweep.unref();
  // IPv4 as is; IPv6 by its /64, which one subscriber usually holds whole.
  const keyOf = (ip) => {
    ip = ip.replace(/^::ffff:(?=\d+\.)/, '');
    if (!ip.includes(':')) return ip;
    const [a, b = ''] = ip.split('%')[0].split('::');
    const head = a ? a.split(':') : [], tail = b ? b.split(':') : [];
    const all = ip.includes('::') ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
    return all.slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(':') + '::/64';
  };
  const clientOf = (req) => {
    const fwd = trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim();
    return keyOf(fwd || req.socket.remoteAddress || '');
  };

  // ---- the live doorbell: a minimal WebSocket server (RFC 6455, text frames) --------------------------------------
  const subs = new Map(); // sid -> Set of sockets
  const perIp = new Map();
  const frame = (op, data) => {
    const n = data.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
    return head ? Buffer.concat([head, data]) : null; // nothing sent here is near 64 KB
  };
  const say = (sock, m) => { if (!sock.destroyed) sock.write(frame(1, Buffer.from(JSON.stringify(m)))); };
  const ring = (sid, m) => { for (const sock of subs.get(sid) || []) say(sock, { s: sid, ...m }); };
  const heads = (sid) => { const r = q.get.get(sid); return !r ? null : r.gone ? { gone: 1 } : { n: r.head }; };
  // A heartbeat to every socket: a dead connection shows itself, and it keeps a Chrome service worker awake while open.
  const all = new Set();
  const heart = setInterval(() => { for (const sock of all) say(sock, {}); }, 25e3);
  heart.unref();
  const upgrade = (req, sock, early) => {
    const ip = clientOf(req);
    const key = req.headers['sec-websocket-key'];
    if (new URL(req.url, 'http://x').pathname !== '/live' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || typeof key !== 'string') return sock.end('HTTP/1.1 400 Bad Request\r\n\r\n');
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
      for (const sid of sock.subs) { subs.get(sid)?.delete(sock); if (!subs.get(sid)?.size) subs.delete(sid); }
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
      for (const sid of sock.subs) subs.get(sid)?.delete(sock);
      sock.subs = new Set(m.sub);
      for (const sid of sock.subs) {
        (subs.get(sid) || subs.set(sid, new Set()).get(sid)).add(sock);
        const h = heads(sid);
        if (h) say(sock, { s: sid, ...h });
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
        else if (op === 9) sock.write(frame(10, data));
        else if (op !== 10) bye(1003);
      }
    };
    sock.on('data', onData);
    if (early?.length) onData(early); // bytes that came with the handshake
    sock.on('error', () => bye(1011));
    sock.on('close', () => bye());
  };

  // ---- HTTP ---------------------------------------------------------------------------------------------------------
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, {
      'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      ...(type.startsWith('text/html') && { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" }),
      ...(status === 429 && { 'retry-after': '60' }),
    });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const read = (req) => new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (d) => { size += d.length; if (size > limit.body) { req.pause(); reject(Object.assign(new Error('big'), { status: 413 })); } else parts.push(d); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(parts).toString() || 'null')); } catch { reject(Object.assign(new Error('bad'), { status: 400 })); } });
    req.on('error', reject);
  });
  const bytes = (s) => (typeof s === 'string' && B64.test(s) ? Buffer.from(s, 'base64url') : null);
  const sealed = (b) => { const op = bytes(b?.op), sig = SIG.test(b?.sig) ? Buffer.from(b.sig, 'base64url') : null; return op && sig && op.length >= 29 ? { op, sig } : null; };
  const signed = (pub, sid, kind, extra, blob, sig) => {
    try {
      const key = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub).toString('base64url') }, format: 'jwk' });
      return crypto.verify(null, Buffer.concat([Buffer.from(`gzs1|${sid}|${kind}|${extra}`), blob]), key, sig);
    } catch { return false; }
  };
  const handle = async (req, res) => {
    const ip = clientOf(req);
    const url = new URL(req.url, 'http://x');
    const m = /^\/s\/([\w-]{22})(\/snap)?$/.exec(url.pathname);
    const look = req.method === 'GET' || req.method === 'HEAD';
    if (look && (url.pathname === '/' || url.pathname === '/j')) return send(res, 200, PAGE, 'text/html; charset=utf-8');
    if (look && url.pathname === '/health') return send(res, 200, { ok: true });
    if (req.method === 'POST' && url.pathname === '/s') {
      if (!take(ip, 'create')) return send(res, 429, { error: 'rate' });
      const b = await read(req);
      if (!SID.test(b?.sid) || !KEY.test(b.pub) || !KEY.test(b.del)) return send(res, 400, { error: 'bad' });
      if (total >= maxBytes) return send(res, 507, { error: 'full' });
      if (q.get.get(b.sid)) return send(res, 409, { error: 'exists' });
      q.make.run(b.sid, Buffer.from(b.pub, 'base64url'), Buffer.from(b.del, 'base64url'), today());
      return send(res, 201, {});
    }
    const kind = !m ? null : req.method === 'GET' && !m[2] ? 'read' : req.method === 'POST' && !m[2] ? 'append' : req.method === 'PUT' && m[2] ? 'snap' : req.method === 'DELETE' && !m[2] ? 'delete' : null;
    if (!kind) return send(res, m ? 405 : 404, { error: m ? 'method' : 'unknown' });
    if (!take(ip, kind === 'read' ? 'read' : 'write')) return send(res, 429, { error: 'rate' });
    // The body first, then the session as it is once the body is in: other requests may have changed it meanwhile.
    const b = kind === 'append' || kind === 'snap' ? await read(req) : null;
    const sid = m[1];
    const row = q.get.get(sid);
    if (!row) return send(res, 404, { error: 'unknown' });
    if (row.gone) return send(res, 410, { error: 'gone' });

    if (kind === 'read') {
      const after = Number(url.searchParams.get('after') || 0);
      if (!Number.isSafeInteger(after) || after < 0) return send(res, 400, { error: 'bad' });
      // at: the signature of the batch the device read last, so it can tell a server restored from an older backup.
      const at = after > row.base ? q.at.get(sid, after) : null;
      const out = { head: row.head, base: row.base, at: at ? Buffer.from(at.sig).toString('base64url') : null, ops: [], more: false };
      let size = 0;
      if (after < row.base && row.snap) { out.snap = { op: Buffer.from(row.snap).toString('base64url'), sig: Buffer.from(row.snap_sig).toString('base64url') }; size += row.snap.length; }
      const rows = q.page.all(sid, Math.max(after, row.base));
      for (const o of rows) {
        if (size + o.op.length > limit.page && out.ops.length) { out.more = true; break; }
        out.ops.push({ n: o.n, op: Buffer.from(o.op).toString('base64url'), sig: Buffer.from(o.sig).toString('base64url') });
        size += o.op.length;
      }
      if (!out.more && rows.length === 1000 && out.ops.length === rows.length) out.more = true;
      if (!take(ip, 'down', size)) return send(res, 429, { error: 'rate' });
      return send(res, 200, out);
    }
    if (kind === 'append') {
      const s = sealed(b);
      if (!s) return send(res, 400, { error: 'bad' });
      if (s.op.length > limit.op) return send(res, 413, { error: 'big' });
      if (!signed(row.pub, sid, 'op', '', s.op, s.sig)) return send(res, 403, { error: 'signature' });
      if (!take(ip, 'bytes', s.op.length)) return send(res, 429, { error: 'rate' });
      if (row.bytes + s.op.length > limit.session || total + s.op.length > maxBytes) return send(res, 507, { error: 'full' });
      const n = row.head + 1;
      tx(() => { q.add.run(sid, n, s.op, s.sig); q.grow.run(n, s.op.length, sid); });
      total += s.op.length;
      ring(sid, { n });
      return send(res, 201, { n });
    }
    if (kind === 'snap') {
      const s = sealed(b);
      if (!s || !Number.isSafeInteger(b.upto)) return send(res, 400, { error: 'bad' });
      if (b.upto <= row.base || b.upto > row.head) return send(res, 409, { error: 'stale' });
      if (!signed(row.pub, sid, 'snap', String(b.upto), s.op, s.sig)) return send(res, 403, { error: 'signature' });
      if (!take(ip, 'bytes', s.op.length)) return send(res, 429, { error: 'rate' });
      const freed = Number(q.upto.get(sid, b.upto).b) + (row.snap?.length || 0);
      const next = row.bytes - freed + s.op.length;
      if (next > limit.session || total - row.bytes + next > maxBytes) return send(res, 507, { error: 'full' });
      tx(() => { q.drop.run(sid, b.upto); q.snap.run(s.op, s.sig, b.upto, next, sid); });
      total += next - row.bytes;
      return send(res, 200, { base: b.upto });
    }
    // delete: the creator's token, whose hash the session keeps
    const token = bytes(/^Bearer ([\w-]{43})$/.exec(req.headers.authorization || '')?.[1]);
    const hash = token && crypto.createHash('sha256').update(token).digest();
    if (!hash || !crypto.timingSafeEqual(hash, Buffer.from(row.del))) return send(res, 403, { error: 'token' });
    remove(sid);
    return send(res, 204, '');
  };
  // Deleted for good: its batches and snapshot go; its id stays (with the day) so it can't be made again.
  const remove = (sid) => {
    const row = q.get.get(sid);
    if (!row || row.gone) return false;
    tx(() => { q.drop.run(sid, Number.MAX_SAFE_INTEGER); q.gone.run(today(), sid); });
    total -= row.bytes;
    ring(sid, { gone: 1 });
    return true;
  };

  // A body over the cap is answered 413 and its connection closed, rather than read to the end.
  const server = http.createServer((req, res) => handle(req, res).catch((e) => {
    if (e.status === 413) res.once('finish', () => req.socket.destroy());
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'server' }); else res.destroy();
    if (!e.status) console.error('relay:', e.message);
  }));
  server.requestTimeout = 30e3;
  server.on('upgrade', upgrade);
  return {
    server, db, remove,
    listen: (port, host) => new Promise((resolve) => server.listen(port, host, () => resolve(server.address()))),
    close: () => new Promise((resolve) => {
      clearInterval(sweep); clearInterval(heart);
      for (const sock of all) sock.destroy();
      server.close(() => { db.close(); resolve(); });
      server.closeAllConnections();
    }),
  };
};

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  const r = relay({ db: process.env.DB || 'share.db', trustProxy: process.env.TRUST_PROXY === '1', maxBytes: Number(process.env.MAX_BYTES) || undefined });
  if (cmd === '--backup' && arg) { r.db.exec(`VACUUM INTO '${arg.replace(/'/g, "''")}'`); r.close(); }
  else if (cmd === '--delete' && SID.test(arg || '')) { console.log(r.remove(arg) ? 'deleted' : 'no such session'); r.close(); }
  else if (cmd) { console.error('usage: relay.js [--backup <file> | --delete <session id>]'); process.exitCode = 2; r.close(); }
  else {
    r.listen(Number(process.env.PORT) || 8787, process.env.HOST || '127.0.0.1').then((a) => console.log(`Glaze share relay on ${a.address}:${a.port}`));
    for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => r.close().then(() => process.exit(0)));
  }
}

module.exports = { relay, LIMIT, RATE };
