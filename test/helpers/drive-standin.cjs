// A stand-in for Google Drive v3 that keeps its state across requests, for Sync Documents' tests (test/drive-sync.test.js)
// and its browser check (scripts/drive-sync-check.js). Its shapes are test/fixtures/drive/v3.js's (the discovery document's,
// not seen live): files.get (fields masks, alt=media), files.list (the q terms Glaze sends), files.create and files.update
// (metadata, multipart and resumable), changes.getStartPageToken and changes.list (each file's latest change once, paged).
// version moves on every change to a file, headRevisionId on every new content; a trashed folder's files read as trashed.
// The student's own actions in Drive, or another app's: trash, untrash, remove (deleted for good), edit (new content, the
// app's properties kept). fail() queues an error answer for the next request that matches. A DELETE (files.delete) deletes
// a file Glaze made for good, a folder with everything in it, answered 204 as Drive does; each is logged with what it deleted
// (entry.deleted), so a test can say which came, or that none did.
// Transfers that span requests, as Drive's upload and download guides describe them: a resumable session's bytes sent in
// chunks (PUT with Content-Range: bytes a-b/N, each but the last a multiple of 256 KiB; 308 with Range: bytes=0-n until the
// last, then the file), its status asked with Content-Range: bytes */N (308 with the Range so far, none before any byte; the
// file once complete; 404 once expired), and alt=media read by Range: bytes=a-b (206 with Content-Range). expire() ends
// sessions; cut(keep) keeps the first keep bytes of the next chunk and never answers it (a worker stopped mid-request). A
// request without those headers is answered as before.
'use strict';
const { ERRORS } = require('../fixtures/drive/v3.js');

const FOLDER = 'application/vnd.google-apps.folder';
const json = (status, body, headers = {}) => ({ status, headers: { 'content-type': 'application/json; charset=UTF-8', ...headers }, body: Buffer.from(JSON.stringify(body)) });
const bad = (message = 'Bad Request') => json(400, { error: { errors: [{ domain: 'global', reason: 'badRequest', message }], code: 400, message } });

// fields: "a,b(c,d),e" → { a: true, b: { c: true, d: true }, e: true }
const parseFields = (s) => {
  let i = 0;
  const level = () => {
    const out = {};
    let name = '';
    for (; i < s.length; i++) {
      const c = s[i];
      if (c === ',') { if (name.trim()) out[name.trim()] = true; name = ''; }
      else if (c === '(') { i++; out[name.trim()] = level(); name = ''; }
      else if (c === ')') { if (name.trim()) out[name.trim()] = true; return out; }
      else name += c;
    }
    if (name.trim()) out[name.trim()] = true;
    return out;
  };
  return level();
};
const mask = (v, m) => {
  if (m === true || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => mask(x, m));
  const out = {};
  for (const [k, sub] of Object.entries(m)) if (v[k] !== undefined) out[k] = mask(v[k], sub);
  return out;
};
// A multipart/related body: its metadata and its media.
const multipart = (type, body) => {
  const b = /boundary=([^;]+)/.exec(type || '')?.[1];
  if (!b) return null;
  const s = body.toString('latin1'), head = `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`, mid = s.indexOf(`\r\n--${b}\r\n`), tail = `\r\n--${b}--`;
  if (!s.startsWith(head) || mid < 0 || !s.endsWith(tail)) return null;
  const media = s.slice(mid + `\r\n--${b}\r\n`.length, -tail.length), cut = media.indexOf('\r\n\r\n');
  return { meta: JSON.parse(Buffer.from(s.slice(head.length, mid), 'latin1').toString('utf8')), type: media.slice('Content-Type: '.length, cut), media: Buffer.from(media.slice(cut + 4), 'latin1') };
};
// The q terms Glaze sends, joined by "and": 'id' in parents, name='x', mimeType='x', trashed=false|true,
// appProperties has { key='k' and value='v' }.
const query = (q) => {
  const terms = [], re = /\s*(?:'([^']*)' in parents|(name|mimeType)\s*=\s*'([^']*)'|trashed\s*=\s*(true|false)|appProperties has \{ key='([^']*)' and value='([^']*)' \})\s*(?:and|$)/y;
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < q.length && (m = re.exec(q))) {
    const [, parent, field, value, trashed, key, is] = m;
    if (parent !== undefined) terms.push((f) => f.meta.parents.includes(parent));
    else if (field) terms.push((f) => f.meta[field] === value);
    else if (trashed) terms.push((f, t) => t === (trashed === 'true'));
    else terms.push((f) => f.meta.appProperties?.[key] === is);
  }
  if (re.lastIndex !== q.length && q.length) return null;
  return terms;
};

const standin = ({ tokens = null, owner = 'student@school.edu' } = {}) => {
  const files = new Map(); // id → { meta, bytes, app: whether Glaze made it (drive.file sees only those) }
  const feed = []; // { n, fileId, time }
  const log = [];
  const faults = [];
  const uploads = new Map();
  const cuts = []; // { keep, match, done }: the next chunk that matches keeps keep bytes and hangs
  const QUANTUM = 256 << 10;
  let seq = 1000, ids = 0, revs = 0, clock = Date.parse('2026-10-30T12:00:00.000Z');
  const valid = tokens || new Set(['tok-1', 'tok-2', 'tok-3', 'ya29.check-drive-token']);
  const time = () => new Date(clock += 1000).toISOString();
  const changed = (id) => feed.push({ n: ++seq, fileId: id, time: time() });
  const trashedOf = (f) => !!f && (f.meta.explicitlyTrashed || f.meta.parents.some((p) => trashedOf(files.get(p))));
  const view = (f) => ({ kind: 'drive#file', ...f.meta, trashed: trashedOf(f), ...(f.bytes && { size: String(f.bytes.length) }) });
  const bump = (f, content) => {
    f.meta.version = String(Number(f.meta.version) + 1);
    if (content) f.meta.headRevisionId = `0B${(++revs).toString(36)}Rev`;
    f.meta.modifiedTime = time();
    changed(f.meta.id);
  };
  const props = (was, next) => {
    const out = { ...was };
    for (const [k, v] of Object.entries(next || {})) { if (v === null) delete out[k]; else out[k] = String(v); }
    return out;
  };
  const make = (meta, bytes, app = true) => {
    const id = `1Sb${(++ids).toString(36).padStart(3, '0')}_${'x'.repeat(8)}`;
    const f = { app, bytes: bytes || null, meta: { id, name: meta.name || 'Untitled', mimeType: meta.mimeType || 'application/octet-stream', parents: Array.isArray(meta.parents) && meta.parents.length ? [...meta.parents] : ['0AroOt'],
      explicitlyTrashed: false, appProperties: props({}, meta.appProperties), version: '1', createdTime: time(), modifiedTime: time() } };
    if (bytes) f.meta.headRevisionId = `0B${(++revs).toString(36)}Rev`;
    files.set(id, f);
    changed(id);
    return f;
  };
  const update = (f, meta = {}, bytes = null) => {
    if (typeof meta.name === 'string') f.meta.name = meta.name;
    if (typeof meta.mimeType === 'string' && !bytes) f.meta.mimeType = meta.mimeType;
    if (typeof meta.trashed === 'boolean') f.meta.explicitlyTrashed = meta.trashed;
    if (meta.appProperties) f.meta.appProperties = props(f.meta.appProperties, meta.appProperties);
    if (bytes) f.bytes = bytes;
    bump(f, !!bytes);
  };
  const fields = (u) => (u.searchParams.get('fields') ? parseFields(u.searchParams.get('fields')) : { kind: true, id: true, name: true, mimeType: true });

  const handle = ({ method, url, headers = {}, body = Buffer.alloc(0) }) => {
    const u = new URL(url);
    const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    const entry = { method, path: u.pathname, query: Object.fromEntries(u.searchParams), auth: h.authorization || null, cookie: h.cookie || null, type: h['content-type'] || null, size: body.length };
    log.push(entry);
    const f0 = faults.findIndex((x) => !x.match || x.match(entry));
    if (f0 >= 0) { const x = faults.splice(f0, 1)[0]; entry.fault = x.status; if (x.status === 0) return null; return json(x.status, x.body); }
    if (u.origin !== 'https://www.googleapis.com') return null;
    if (!valid.has(String(h.authorization || '').replace(/^Bearer /, ''))) return json(401, ERRORS[401]);
    if (method === 'DELETE') {
      const d = /^\/drive\/v3\/files\/([\w-]+)$/.exec(u.pathname), f = d && files.get(d[1]);
      if (!f || !f.app) return json(404, ERRORS[404]);
      const gone = (x) => { files.delete(x.meta.id); changed(x.meta.id); for (const k of [...files.values()].filter((c) => c.meta.parents.includes(x.meta.id))) gone(k); };
      entry.deleted = { id: f.meta.id, name: f.meta.name, mimeType: f.meta.mimeType, parents: [...f.meta.parents], appProperties: { ...f.meta.appProperties } };
      gone(f);
      return { status: 204, headers: {}, body: Buffer.alloc(0) };
    }
    let m;
    // changes
    if (method === 'GET' && u.pathname === '/drive/v3/changes/startPageToken') return json(200, { kind: 'drive#startPageToken', startPageToken: String(seq + 1) });
    if (method === 'GET' && u.pathname === '/drive/v3/changes') {
      const from = Number(u.searchParams.get('pageToken')), size = Math.min(1000, Number(u.searchParams.get('pageSize') || 100));
      if (!Number.isSafeInteger(from) || from < 1) return bad('Invalid Value');
      const latest = new Map();
      for (const c of feed) if (c.n >= from) latest.set(c.fileId, c);
      const all = [...latest.values()].filter((c) => { const f = files.get(c.fileId); return !f || f.app; }).sort((a, b) => a.n - b.n);
      const page = all.slice(0, size), more = all.length > size;
      const changes = page.map((c) => {
        const f = files.get(c.fileId);
        return f ? { kind: 'drive#change', changeType: 'file', time: c.time, removed: false, fileId: c.fileId, file: view(f) } : { kind: 'drive#change', changeType: 'file', time: c.time, removed: true, fileId: c.fileId };
      });
      const out = { kind: 'drive#changeList', changes, ...(more ? { nextPageToken: String(all[size].n) } : { newStartPageToken: String(seq + 1) }) };
      return json(200, mask(out, fields(u)));
    }
    // files.list
    if (method === 'GET' && u.pathname === '/drive/v3/files') {
      const terms = query(u.searchParams.get('q') || '');
      if (!terms) return bad('Invalid Value');
      const size = Math.min(1000, Number(u.searchParams.get('pageSize') || 100)), at = Number(u.searchParams.get('pageToken') || 0);
      const hits = [...files.values()].filter((f) => f.app && terms.every((t) => t(f, trashedOf(f))));
      const page = hits.slice(at, at + size);
      return json(200, mask({ kind: 'drive#fileList', incompleteSearch: false, files: page.map(view), ...(hits.length > at + size && { nextPageToken: String(at + size) }) }, fields(u)));
    }
    // files.get, alt=media
    if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(u.pathname)) && method === 'GET') {
      const f = files.get(m[1]);
      if (!f || !f.app) return json(404, ERRORS[404]);
      // A range of the bytes: 206 with where they sit in the whole; one past the end, 416.
      const want = u.searchParams.get('alt') === 'media' && f.bytes && /^bytes=(\d+)-(\d+)$/.exec(h.range || '');
      if (want) {
        const from = Number(want[1]), to = Math.min(Number(want[2]), f.bytes.length - 1);
        entry.range = { from, to: Number(want[2]) };
        if (from > to) return json(416, { error: { code: 416, message: 'Request range not satisfiable' } }, { 'content-range': `bytes */${f.bytes.length}` });
        return { status: 206, headers: { 'content-type': f.meta.mimeType, 'content-length': String(to - from + 1), 'content-range': `bytes ${from}-${to}/${f.bytes.length}` }, body: f.bytes.subarray(from, to + 1) };
      }
      if (u.searchParams.get('alt') === 'media') return f.bytes ? { status: 200, headers: { 'content-type': f.meta.mimeType, 'content-length': String(f.bytes.length) }, body: f.bytes } : bad();
      return json(200, mask(view(f), fields(u)));
    }
    // files.create (metadata only) and files.update (metadata only)
    if (method === 'POST' && u.pathname === '/drive/v3/files') {
      let meta;
      try { meta = JSON.parse(body.toString('utf8')); } catch { return bad(); }
      return json(200, mask(view(make(meta, null)), fields(u)));
    }
    if ((m = /^\/drive\/v3\/files\/([\w-]+)$/.exec(u.pathname)) && method === 'PATCH') {
      const f = files.get(m[1]);
      if (!f || !f.app) return json(404, ERRORS[404]);
      let meta;
      try { meta = JSON.parse(body.toString('utf8')); } catch { return bad(); }
      // A move: addParents and removeParents (comma-separated ids), as files.update takes them.
      const add = u.searchParams.get('addParents'), remove = u.searchParams.get('removeParents');
      if (add || remove) {
        const next = [...f.meta.parents.filter((p) => !(remove || '').split(',').includes(p)), ...(add ? add.split(',') : [])];
        if ((add && add.split(',').some((p) => !files.has(p))) || !next.length) return bad('Invalid parents');
        f.meta.parents = [...new Set(next)];
      }
      update(f, meta);
      return json(200, mask(view(f), fields(u)));
    }
    // uploads: multipart, and resumable (a session, then its bytes)
    if ((m = /^\/upload\/drive\/v3\/files(?:\/([\w-]+))?$/.exec(u.pathname))) {
      const kind = u.searchParams.get('uploadType');
      const f = m[1] ? files.get(m[1]) : null;
      if (m[1] && (!f || !f.app)) return json(404, ERRORS[404]);
      if (kind === 'multipart' && (method === 'POST' || method === 'PATCH') && (method === 'POST') === !m[1]) {
        const p = multipart(h['content-type'], body);
        if (!p) return bad();
        entry.upload = { meta: p.meta, type: p.type, size: p.media.length };
        if (f) { update(f, p.meta, p.media); return json(200, mask(view(f), fields(u))); }
        return json(200, mask(view(make({ ...p.meta, mimeType: p.meta.mimeType || p.type }, p.media)), fields(u)));
      }
      if (kind === 'resumable' && (method === 'POST' || method === 'PATCH') && !u.searchParams.get('upload_id')) {
        let meta;
        try { meta = body.length ? JSON.parse(body.toString('utf8')) : {}; } catch { return bad(); }
        let sid = `up${uploads.size + 1}x`;
        for (let n = uploads.size + 2; uploads.has(sid); n++) sid = `up${n}x`; // a finished chunked session stays to answer its status
        uploads.set(sid, { id: m[1] || null, meta, type: h['x-upload-content-type'] || meta.mimeType, size: Number(h['x-upload-content-length']), fields: u.searchParams.get('fields') });
        const at = new URL(`https://www.googleapis.com/upload/drive/v3/files${m[1] ? `/${m[1]}` : ''}`);
        at.searchParams.set('uploadType', 'resumable'); at.searchParams.set('upload_id', sid);
        return { status: 200, headers: { location: at.href, 'access-control-expose-headers': 'location', 'content-length': '0' }, body: Buffer.alloc(0) };
      }
      // A session's chunk, or its status: Content-Range bytes a-b/N or bytes */N.
      const range = kind === 'resumable' && method === 'PUT' && /^bytes (?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(h['content-range'] || '');
      if (range) {
        const s = uploads.get(u.searchParams.get('upload_id'));
        if (!s || s.expired) return json(404, ERRORS[404]);
        s.got ||= [];
        const have = s.got.reduce((n, b) => n + b.length, 0), total = Number(range[3]);
        const answer = () => {
          if (s.done) { const f = files.get(s.done); return f ? json(200, mask(view(f), s.fields ? parseFields(s.fields) : { id: true })) : json(404, ERRORS[404]); }
          const n = s.got.reduce((m, b) => m + b.length, 0);
          return { status: 308, headers: { ...(n && { range: `bytes=0-${n - 1}` }), 'content-length': '0' }, body: Buffer.alloc(0) };
        };
        if (range[1] === undefined) { entry.chunk = { status: true, total }; return answer(); }
        const from = Number(range[1]), to = Number(range[2]);
        entry.chunk = { from, to, total };
        if (Number.isFinite(s.size) && s.size !== total) return bad('Size mismatch');
        if (to - from + 1 !== body.length || from > have || to >= total || (to !== total - 1 && body.length % QUANTUM)) return bad('Invalid chunk');
        if (s.done) return answer();
        let part = body.subarray(have - from);
        const c = cuts.findIndex((x) => !x.match || x.match(entry));
        const cut = c >= 0 ? cuts.splice(c, 1)[0] : null;
        if (cut) part = part.subarray(0, Math.max(0, cut.keep - (have - from)));
        if (part.length) s.got.push(Buffer.from(part));
        if (cut) { entry.cut = part.length; cut.done(); return { hang: true }; }
        if (have + part.length < total) return answer();
        const bytes = Buffer.concat(s.got);
        entry.upload = { meta: s.meta, type: s.type, size: bytes.length, resumable: true, chunked: true };
        const into = s.id ? files.get(s.id) : null;
        if (s.id && !into) return json(404, ERRORS[404]);
        if (into) update(into, s.meta, bytes); else s.done = make({ ...s.meta, mimeType: s.meta.mimeType || s.type }, bytes).meta.id;
        s.done ||= s.id;
        return answer();
      }
      if (kind === 'resumable' && method === 'PUT' && uploads.has(u.searchParams.get('upload_id'))) {
        const s = uploads.get(u.searchParams.get('upload_id'));
        uploads.delete(u.searchParams.get('upload_id'));
        if (Number.isFinite(s.size) && s.size !== body.length) return bad('Size mismatch');
        entry.upload = { meta: s.meta, type: s.type, size: body.length, resumable: true };
        const into = s.id ? files.get(s.id) : null;
        if (into) { update(into, s.meta, Buffer.from(body)); return json(200, mask(view(into), s.fields ? parseFields(s.fields) : { id: true })); }
        return json(200, mask(view(make({ ...s.meta, mimeType: s.meta.mimeType || s.type }, Buffer.from(body))), s.fields ? parseFields(s.fields) : { id: true }));
      }
      return bad();
    }
    return bad();
  };

  // For node: a fetch over handle(). A null answer is a network failure.
  const fetch = async (url, init = {}) => {
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : { ...(init.headers || {}) };
    const body = init.body == null ? Buffer.alloc(0) : Buffer.from(typeof init.body === 'string' ? Buffer.from(init.body) : init.body instanceof Uint8Array ? init.body : Buffer.from(String(init.body)));
    const a = handle({ method: init.method || 'GET', url, headers, body });
    if (!a) throw new TypeError('Failed to fetch');
    if (a.hang) return new Promise(() => {}); // cut(): the worker is gone before Drive answers
    return new Response(a.status === 204 || a.status === 304 ? null : a.body, { status: a.status, headers: a.headers });
  };

  return {
    files, log, handle, fetch, owner,
    // What the student or another app does in Drive.
    trash: (id, on = true) => { const f = files.get(id); f.meta.explicitlyTrashed = on; bump(f, false); },
    remove: (id) => { files.delete(id); changed(id); },
    edit: (id, bytes) => { const f = files.get(id); f.bytes = Buffer.from(bytes); bump(f, true); },
    // A file Glaze made, as another device of the student's left it.
    seed: (meta, bytes = null) => make(meta, bytes ? Buffer.from(bytes) : null),
    // A file Glaze can't see (drive.file): made by another app.
    foreign: (meta, bytes) => make(meta, bytes, false),
    fail: (status, body, match = null, times = 1) => { for (let i = 0; i < times; i++) faults.push({ status, body, match }); },
    offline: (match = null, times = 1) => { for (let i = 0; i < times; i++) faults.push({ status: 0, match }); },
    clearFaults: () => { faults.length = 0; },
    // Resumable sessions: expire(id) ends one (all without an id), as a week's wait does; cut(keep, match) has the next
    // chunk that matches keep its first keep bytes and never answer, resolving once it has. sessions: what each holds.
    expire: (sid = null) => { for (const [k, s] of uploads) if (!sid || k === sid) s.expired = true; },
    cut: (keep = 0, match = null) => new Promise((done) => { cuts.push({ keep, match, done }); }),
    sessions: uploads,
    byName: (name) => [...files.values()].filter((f) => f.meta.name === name),
    inFolder: (folder) => [...files.values()].filter((f) => f.meta.parents.includes(folder)),
    view: (id) => (files.has(id) ? view(files.get(id)) : null),
    FOLDER,
  };
};

module.exports = { standin, parseFields, mask, multipart };
