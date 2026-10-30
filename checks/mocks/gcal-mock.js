// A local stand-in for the parts of Google's Calendar API and token revocation that Glaze uses (lib/gcal.js), for the
// node tests (test/gcal.test.js) and headless runs of the extension. It listens on 127.0.0.1 only and reaches nothing.
// Modeled on Google's documented behavior: client-chosen event ids (base32hex, 5–1024 characters, 409 when taken, even by
// a deleted event), etags, syncToken listing that includes deletions (410 once a token has expired), 404 for an unknown
// calendar, 403 for one the app didn't make (the calendar.app.created scope), and the revoke endpoint. Not shipped.
//
//   const mock = await require('./scripts/gcal-mock.js').start();   // { api, revoke, port, ... }; mock.stop() when done
//   node scripts/gcal-mock.js [port]                                  // runs until stopped; prints its addresses
//
// mock.tokens: access tokens it accepts ('tok-1' to start); mock.fail(n, status, { headers, reason }): the next n
// requests answer that; mock.edit(cal, id, patch) and mock.del(cal, id): what the student does in Google Calendar;
// mock.expire(): every sync token so far stops working; mock.log: [method, path] of each request; mock.revoked: tokens.
const http = require('node:http');
const crypto = require('node:crypto');

const start = (port = 0) => new Promise((resolve) => {
  const calendars = new Map(); // id -> { id, summary, timeZone, dataOwner, app, events: Map }
  const mock = { calendars, tokens: new Set(['tok-1']), revoked: [], log: [], owner: 'student@example.edu', faults: [], seq: 1, oldest: 0 };
  const tag = () => `"${mock.seq}"`;
  const stamp = (e) => { e.seq = ++mock.seq; e.etag = tag(); e.updated = new Date().toISOString(); return e; };
  mock.fail = (n, status, { headers = {}, reason = '' } = {}) => { for (let i = 0; i < n; i++) mock.faults.push({ status, headers, reason }); };
  mock.edit = (cal, id, patch) => stamp(Object.assign(calendars.get(cal).events.get(id), patch));
  mock.del = (cal, id) => stamp(Object.assign(calendars.get(cal).events.get(id), { status: 'cancelled' }));
  mock.expire = () => { mock.oldest = mock.seq + 1; };
  mock.foreign = (id) => calendars.set(id, { id, summary: 'Not Glaze', app: false, events: new Map() });
  mock.live = (cal) => [...calendars.get(cal).events.values()].filter((e) => e.status !== 'cancelled');

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', ...headers });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const error = (res, status, reason, headers) => send(res, status, { error: { code: status, message: reason, errors: [{ reason }] } }, headers);
  const out = (e) => { const { seq, ...rest } = e; return rest; };
  const valid = (e) => {
    const at = (t) => (t?.date ? Date.parse(t.date) : Date.parse(t?.dateTime));
    return !!e && Number.isFinite(at(e.start)) && Number.isFinite(at(e.end)) && at(e.end) > at(e.start) && !e.start.date === !e.end.date;
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      mock.log.push([req.method, url.pathname + url.search]);
      if (req.method === 'OPTIONS') return send(res, 204, undefined, { 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE' });
      if (mock.faults.length) { const f = mock.faults.shift(); return error(res, f.status, f.reason || 'injected', f.headers); }
      if (url.pathname === '/revoke' && req.method === 'POST') {
        const token = new URLSearchParams(raw).get('token');
        if (!mock.tokens.delete(token)) return send(res, 400, { error: 'invalid_token' });
        mock.revoked.push(token);
        return send(res, 200, {});
      }
      const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      if (!mock.tokens.has(token)) return error(res, 401, 'authError');
      const p = url.pathname.replace(/^\/calendar\/v3/, '').split('/').filter(Boolean).map(decodeURIComponent);
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { return error(res, 400, 'parseError'); }
      if (p[0] !== 'calendars') return error(res, 404, 'notFound');
      if (p.length === 1 && req.method === 'POST') {
        const id = `c_${crypto.randomBytes(16).toString('hex')}@group.calendar.google.com`;
        const c = { id, summary: body?.summary || '', timeZone: body?.timeZone || 'UTC', dataOwner: mock.owner, app: true, events: new Map(), etag: tag() };
        calendars.set(id, c);
        return send(res, 200, { kind: 'calendar#calendar', id, summary: c.summary, timeZone: c.timeZone, dataOwner: c.dataOwner, etag: c.etag });
      }
      const c = calendars.get(p[1]);
      if (!c) return error(res, 404, 'notFound');
      if (!c.app) return error(res, 403, 'forbidden');
      if (p.length === 2) {
        if (req.method === 'GET') return send(res, 200, { kind: 'calendar#calendar', id: c.id, summary: c.summary, timeZone: c.timeZone, dataOwner: c.dataOwner, etag: c.etag });
        if (req.method === 'DELETE') { calendars.delete(c.id); return send(res, 204); }
        return error(res, 405, 'notAllowed');
      }
      if (p[2] !== 'events') return error(res, 404, 'notFound');
      if (p.length === 3 && req.method === 'GET') {
        const st = url.searchParams.get('syncToken');
        const since = st === null ? null : Number(/^s(\d+)$/.exec(st)?.[1]);
        if (since !== null && !(since >= mock.oldest)) return error(res, 410, 'fullSyncRequired');
        const all = [...c.events.values()].filter((e) => (since === null ? e.status !== 'cancelled' : e.seq > since)).sort((a, b) => a.seq - b.seq);
        const from = Number(url.searchParams.get('pageToken') || 0), max = Math.min(Number(url.searchParams.get('maxResults') || 250), 2500);
        const items = all.slice(from, from + max).map(out);
        const more = from + max < all.length;
        return send(res, 200, { kind: 'calendar#events', items, ...(more ? { nextPageToken: String(from + max) } : { nextSyncToken: `s${mock.seq}` }) });
      }
      if (p.length === 3 && req.method === 'POST') {
        if (!/^[a-v0-9]{5,1024}$/.test(body?.id || '')) return error(res, 400, 'invalid');
        if (c.events.has(body.id)) return error(res, 409, 'duplicate');
        if (!valid(body)) return error(res, 400, 'timeRangeEmpty');
        const e = stamp({ kind: 'calendar#event', ...body, status: body.status || 'confirmed' });
        c.events.set(e.id, e);
        return send(res, 200, out(e));
      }
      const e = c.events.get(p[3]);
      if (!e) return error(res, 404, 'notFound');
      if (req.method === 'PUT') {
        if (!valid(body)) return error(res, 400, 'timeRangeEmpty');
        const next = stamp({ kind: 'calendar#event', ...body, id: e.id, status: body.status || 'confirmed' });
        c.events.set(e.id, next);
        return send(res, 200, out(next));
      }
      if (req.method === 'DELETE') {
        if (e.status === 'cancelled') return error(res, 410, 'deleted');
        stamp(Object.assign(e, { status: 'cancelled' }));
        return send(res, 204);
      }
      return error(res, 405, 'notAllowed');
    });
  });
  server.listen(port, '127.0.0.1', () => {
    mock.port = server.address().port;
    mock.api = `http://127.0.0.1:${mock.port}/calendar/v3`;
    mock.revoke = `http://127.0.0.1:${mock.port}/revoke`;
    mock.stop = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
    resolve(mock);
  });
});

module.exports = { start };

if (require.main === module) {
  start(Number(process.argv[2]) || 0).then((m) => {
    console.log(JSON.stringify({ api: m.api, revoke: m.revoke }));
    process.on('SIGTERM', () => m.stop().then(() => process.exit(0)));
    process.on('SIGINT', () => m.stop().then(() => process.exit(0)));
  });
}
