// Google Drive's files (lib/drive.js) against Drive v3's own shapes (test/fixtures/drive/v3.js): each request's exact
// address, headers and body, the kinds' size limits before and while bytes come, the one retry after a 401, Drive's
// errors as fixed reasons, a save that updates the file it made only while that file is still there, and the port that
// carries the bytes between a page and the worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../lib/drive.js');
const K = require('../lib/doc-kinds.js');
const { MIME, FILES, SAVED, ERRORS } = require('./fixtures/drive/v3.js');

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const META = 'id%2Cname%2CmimeType%2Csize%2Ctrashed%2Ccapabilities%28canEdit%2CcanDownload%29';
const ALL = ['paper', 'sheet', 'pdf', 'slides'];
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8', ...headers } });
// A body that streams n bytes in pieces, counting how much was read and whether it was cancelled.
const stream = (n, piece = 1 << 20, headers = {}) => {
  const seen = { read: 0, cancelled: false };
  let left = n;
  const body = new ReadableStream({
    pull(c) { if (left <= 0) { c.close(); return; } const k = Math.min(piece, left); left -= k; seen.read += k; c.enqueue(new Uint8Array(k).fill(7)); },
    cancel() { seen.cancelled = true; },
  }, { highWaterMark: 0 });
  return { res: new Response(body, { status: 200, headers }), seen };
};

// A worker's Drive: answers in order (a Response, an Error to throw, or fn(url, init)); the same token until one is dropped.
const harness = (answers = [], { tokens = ['tok-1', 'tok-2', 'tok-3'], fail = null } = {}) => {
  const log = { fetch: [], token: [], drop: [] };
  const queue = [...answers];
  const drive = D.create({
    fetch: async (url, init) => {
      log.fetch.push({ url, init });
      const a = queue.shift();
      if (!a) throw new Error(`unexpected request ${url}`);
      if (a instanceof Error) throw a;
      return typeof a === 'function' ? a(url, init) : a;
    },
    token: async (o) => { log.token.push(o); if (fail) throw Object.assign(new Error(fail), { why: fail }); return tokens[log.drop.length]; },
    drop: async (t) => { log.drop.push(t); },
    boundary: () => 'B0und4ry',
  });
  return { drive, log, left: () => queue.length };
};
const plain = (init) => ({ credentials: init.credentials, redirect: init.redirect, cache: init.cache });
const SAFE = { credentials: 'omit', redirect: 'error', cache: 'no-store' };
const fails = async (p, why) => { await assert.rejects(p, (e) => { assert.equal(e.why, why); return true; }); };
const opened = async (drive, id, takes = ALL) => {
  const got = { head: null, bytes: 0, pieces: 0 };
  const total = await drive.open(id, takes, { head: (h) => { got.head = h; }, bytes: (b) => { got.bytes += b.length; got.pieces++; } });
  return { ...got, total };
};

test('the fixtures are Drive\'s documented shapes, not yet seen live', () => {
  assert.equal(FILES.live, false); assert.equal(SAVED.live, false); assert.equal(ERRORS.live, false);
  for (const [k, e] of Object.entries(ERRORS)) if (k !== 'live') assert.ok(Number.isInteger(e.error.code) && typeof e.error.errors[0].reason === 'string' && typeof e.error.message === 'string', k);
  assert.equal(typeof FILES.pdf.size, 'string', 'File.size is an int64 string');
});

test('files.get asks for exactly the fields Glaze reads, with the token and no cookies, redirect or cache', async () => {
  const { drive, log } = harness([json(200, FILES.docx)]);
  const m = await drive.meta('1AbC_d-EfGh');
  assert.deepEqual(m, FILES.docx);
  assert.equal(log.fetch[0].url, `${API}/1AbC_d-EfGh?fields=${META}&supportsAllDrives=true`);
  assert.deepEqual(log.fetch[0].init.headers, { authorization: 'Bearer tok-1' });
  assert.deepEqual(plain(log.fetch[0].init), SAFE);
  assert.equal(log.fetch[0].init.method, undefined);
  assert.deepEqual(log.token, [{ interactive: true }]);
  await fails(harness().drive.meta('../x'), 'bad');
  await fails(harness([json(200, { ...FILES.docx, id: 'other' })]).drive.meta('1AbC_d-EfGh'), 'bad');
});

test('a binary file downloads with alt=media; a Google Doc, Sheet or Slides deck exports as .docx, .xlsx or .pptx', async () => {
  let h = harness([json(200, FILES.pdf), stream(1048576).res]);
  let r = await opened(h.drive, FILES.pdf.id);
  assert.equal(h.log.fetch[1].url, `${API}/1PdF_x?alt=media&supportsAllDrives=true`);
  assert.deepEqual(h.log.fetch[1].init.headers, { authorization: 'Bearer tok-1' });
  assert.deepEqual(plain(h.log.fetch[1].init), SAFE);
  assert.deepEqual(r.head, { kind: 'pdf', name: 'Reading.pdf', mime: MIME.pdf, size: 1048576 });
  assert.equal(r.bytes, 1048576); assert.equal(r.total, 1048576);
  for (const [f, kind, ext, mime] of [[FILES.doc, 'paper', '.docx', MIME.docx], [FILES.sheet, 'sheet', '.xlsx', MIME.xlsx], [FILES.slides, 'slides', '.pptx', MIME.pptx]]) {
    h = harness([json(200, f), stream(5000).res]);
    r = await opened(h.drive, f.id);
    assert.equal(h.log.fetch[1].url, `${API}/${f.id}/export?mimeType=${encodeURIComponent(mime)}`, kind);
    assert.deepEqual(plain(h.log.fetch[1].init), SAFE);
    // The metadata's size is the Google file's own, not its export's: no size until the bytes are in.
    assert.deepEqual(r.head, { kind, name: `${f.name}${ext}`, mime, size: null }, kind);
    assert.equal(r.total, 5000);
  }
  // A Word file whose name lost its extension opens by its type, named for it.
  h = harness([json(200, { ...FILES.docx, name: 'Essay' }), stream(10).res]);
  assert.deepEqual((await opened(h.drive, FILES.docx.id)).head, { kind: 'paper', name: 'Essay.docx', mime: MIME.docx, size: 24576 });
});

test('a file no switched-on kind takes, or larger than its kind opens, is refused before any byte is asked for', async () => {
  let h = harness([json(200, FILES.pdf)]);
  await fails(opened(h.drive, FILES.pdf.id, ['paper']), 'type');
  assert.equal(h.log.fetch.length, 1);
  h = harness([json(200, { ...FILES.docx, name: 'Song.mp3', mimeType: 'audio/mpeg' })]);
  await fails(opened(h.drive, FILES.docx.id), 'type');
  h = harness([json(200, { ...FILES.pdf, size: String(K.KINDS.pdf.max + 1) })]);
  await fails(opened(h.drive, FILES.pdf.id), 'size');
  assert.equal(h.log.fetch.length, 1, 'a PDF over 50 MB: no download');
  h = harness([json(200, { ...FILES.docx, size: String(K.KINDS.paper.max + 1) })]);
  await fails(opened(h.drive, FILES.docx.id), 'size');
  assert.equal(h.log.fetch.length, 1, 'a Word file over 15 MB: no download');
  // Exactly the limit opens.
  h = harness([json(200, { ...FILES.docx, size: String(K.KINDS.paper.max) }), stream(K.KINDS.paper.max).res]);
  assert.equal((await opened(h.drive, FILES.docx.id)).total, K.KINDS.paper.max);
});

test('without a size, the bytes are counted as they stream and the download stops past the kind\'s limit', async () => {
  const big = stream(K.KINDS.paper.max + (2 << 20));
  let h = harness([json(200, FILES.doc), big.res]);
  await fails(opened(h.drive, FILES.doc.id), 'size');
  assert.ok(big.seen.cancelled, 'the download is cancelled');
  assert.ok(big.seen.read <= K.KINDS.paper.max + (1 << 20), `stopped at the limit (${big.seen.read})`);
  // A length Drive states past the limit stops it before the first byte.
  const said = stream(100, 100, { 'content-length': String(K.KINDS.slides.max + 1) });
  h = harness([json(200, FILES.slides), said.res]);
  await fails(opened(h.drive, FILES.slides.id), 'size');
  assert.equal(said.seen.read, 0);
  // A metadata size that lies is caught by the count too.
  const liar = stream(K.KINDS.pdf.max + (1 << 20));
  h = harness([json(200, { ...FILES.pdf, size: '10' }), liar.res]);
  await fails(opened(h.drive, FILES.pdf.id), 'size');
  assert.ok(liar.seen.cancelled);
  // A connection lost mid-download.
  const broken = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); c.error(new TypeError('network')); } });
  h = harness([json(200, FILES.pdf), new Response(broken)]);
  await fails(opened(h.drive, FILES.pdf.id), 'network');
});

const decode = (body) => new TextDecoder('latin1').decode(body);
const multipart = (meta, mime, bytes) => `--glaze-B0und4ry\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--glaze-B0und4ry\r\nContent-Type: ${mime}\r\n\r\n${decode(bytes)}\r\n--glaze-B0und4ry--`;

test('save: a multipart create into My Drive, as the file or as a Google Doc', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 13, 10]);
  let h = harness([json(200, SAVED.file)]);
  let r = await h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file' });
  assert.deepEqual(r, { id: SAVED.file.id, fresh: false });
  const c = h.log.fetch[0];
  assert.equal(c.url, `${UPLOAD}?uploadType=multipart&fields=id%2Cname%2CmimeType`);
  assert.equal(c.init.method, 'POST');
  assert.deepEqual(c.init.headers, { authorization: 'Bearer tok-1', 'content-type': 'multipart/related; boundary=glaze-B0und4ry' });
  assert.deepEqual(plain(c.init), SAFE);
  assert.equal(decode(c.init.body), multipart({ name: 'Essay.docx', mimeType: MIME.docx }, MIME.docx, bytes));
  // A Google Doc: the target type on create, the name without .docx; the media is the .docx Drive converts.
  h = harness([json(200, SAVED.doc)]);
  r = await h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'doc' });
  assert.deepEqual(r, { id: SAVED.doc.id, fresh: false });
  assert.equal(decode(h.log.fetch[0].init.body), multipart({ name: 'Essay', mimeType: MIME.doc }, MIME.docx, bytes));
  await fails(harness().drive.save({ name: 'Talk.pptx', mime: MIME.pptx, bytes, as: 'doc' }), 'bad');
  await fails(harness().drive.save({ name: 'x.pdf', mime: MIME.pdf, bytes: new Uint8Array(0), as: 'file' }), 'bad');
  await fails(harness([json(200, { name: 'no id' })]).drive.save({ name: 'x.pdf', mime: MIME.pdf, bytes, as: 'file' }), 'bad');
});

test('save again: the same Drive file is updated once it is confirmed there, editable and still the same type', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  let h = harness([json(200, FILES.docx), json(200, { ...SAVED.file, id: FILES.docx.id })]);
  let r = await h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file', id: FILES.docx.id });
  assert.deepEqual(r, { id: FILES.docx.id, fresh: false });
  assert.equal(h.log.fetch[0].url, `${API}/${FILES.docx.id}?fields=${META}&supportsAllDrives=true`);
  const u = h.log.fetch[1];
  assert.equal(u.url, `${UPLOAD}/${FILES.docx.id}?uploadType=multipart&fields=id%2Cname%2CmimeType&supportsAllDrives=true`);
  assert.equal(u.init.method, 'PATCH');
  assert.deepEqual(plain(u.init), SAFE);
  assert.equal(decode(u.init.body), multipart({}, MIME.docx, bytes), 'the content only: a name given in Drive stays');
  h = harness([json(200, { ...FILES.doc, id: SAVED.doc.id }), json(200, SAVED.doc)]);
  r = await h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'doc', id: SAVED.doc.id });
  assert.deepEqual(r, { id: SAVED.doc.id, fresh: false });
  assert.equal(h.log.fetch[1].init.method, 'PATCH');
  // Not there any more, or not Glaze's to change: a new file, said as fresh.
  for (const [label, first] of [['deleted', json(404, ERRORS[404])], ['trashed', json(200, FILES.trashed)], ['read-only', json(200, FILES.readOnly)],
    ['no permission', json(403, ERRORS.insufficientFilePermissions)], ['not granted to Glaze', json(403, ERRORS.appNotAuthorizedToFile)],
    ['now a Google Doc', json(200, { ...FILES.docx, mimeType: MIME.doc })]]) {
    h = harness([first, json(200, SAVED.file)]);
    r = await h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file', id: FILES.docx.id });
    assert.deepEqual(r, { id: SAVED.file.id, fresh: true }, label);
    assert.equal(h.log.fetch[1].init.method, 'POST', label);
  }
  // Drive busy or the network down while checking: no copy made behind the student's back.
  h = harness([json(429, ERRORS[429])]);
  await fails(h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file', id: FILES.docx.id }), 'busy');
  assert.equal(h.left(), 0); assert.equal(h.log.fetch.length, 1);
  h = harness([new TypeError('Failed to fetch')]);
  await fails(h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file', id: FILES.docx.id }), 'network');
});

test('a 401 drops the token and asks once more with a fresh one', async () => {
  let h = harness([json(401, ERRORS[401]), json(200, FILES.docx)]);
  assert.deepEqual(await h.drive.meta(FILES.docx.id), FILES.docx);
  assert.deepEqual(h.log.drop, ['tok-1']);
  assert.deepEqual(h.log.fetch.map((f) => f.init.headers.authorization), ['Bearer tok-1', 'Bearer tok-2']);
  h = harness([json(401, ERRORS[401]), json(401, ERRORS[401])]);
  await fails(h.drive.meta(FILES.docx.id), 'auth');
  assert.equal(h.log.fetch.length, 2, 'once only');
  // An upload retried sends the same body again.
  const bytes = new Uint8Array([9, 9]);
  h = harness([json(401, ERRORS[401]), json(200, SAVED.file)]);
  await h.drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file' });
  assert.equal(decode(h.log.fetch[1].init.body), decode(h.log.fetch[0].init.body));
});

test('a request stops if Drive was connected to another account, or disconnected, since it began', async () => {
  const run = async (accounts) => {
    const log = [];
    let i = 0;
    const drive = D.create({ fetch: async (url) => { log.push(url); return json(200, FILES.docx); }, token: async () => 'tok', account: async () => accounts[Math.min(i++, accounts.length - 1)] });
    return { r: await drive.meta(FILES.docx.id).then(() => 'ok', (e) => e.why), log };
  };
  assert.deepEqual(await run(['a@school.edu', 'a@school.edu']), { r: 'ok', log: [`${API}/${FILES.docx.id}?fields=${META}&supportsAllDrives=true`] });
  assert.deepEqual(await run(['a@school.edu', 'b@school.edu']), { r: 'connect', log: [] });
  assert.deepEqual(await run(['a@school.edu', null]), { r: 'connect', log: [] });
  assert.deepEqual(await run([null]), { r: 'connect', log: [] });
  // Disconnected while the token was on its way: nothing sent.
  let gone = 'a@school.edu';
  const sent = [];
  const late = D.create({ fetch: async (url) => { sent.push(url); return json(200, FILES.docx); }, token: async () => { gone = null; return 'tok'; }, account: async () => gone });
  assert.equal(await late.meta(FILES.docx.id).then(() => 'ok', (e) => e.why), 'connect');
  assert.deepEqual(sent, []);
  // Mid-upload: the save's update finds another account and sends nothing.
  let who = 'a@school.edu';
  const log = [];
  const drive = D.create({ fetch: async (url, init) => { log.push(init.method || 'GET'); who = 'b@school.edu'; return json(200, FILES.docx); }, token: async () => 'tok', account: async () => who });
  await fails(drive.save({ name: 'Essay.docx', mime: MIME.docx, bytes: new Uint8Array([1]), as: 'file', id: FILES.docx.id }), 'connect');
  assert.deepEqual(log, ['GET']);
});

test('Drive\'s errors and the sign-in\'s become fixed reasons', async () => {
  for (const [res, why] of [[json(403, ERRORS.insufficientFilePermissions), 'denied'], [json(403, ERRORS.appNotAuthorizedToFile), 'denied'], [json(404, ERRORS[404]), 'missing'],
    [json(429, ERRORS[429]), 'busy'], [json(403, ERRORS.userRateLimitExceeded), 'busy'], [json(403, ERRORS.storageQuotaExceeded), 'quota'],
    [json(500, {}), 'busy'], [json(400, {}), 'bad'], [new Response('<html>', { status: 403 }), 'denied'], [new TypeError('Failed to fetch'), 'network']]) {
    await fails(harness([res]).drive.meta(FILES.docx.id), why);
  }
  await fails(harness([], { fail: 'connect' }).drive.meta(FILES.docx.id), 'connect');
  await fails(harness([], { fail: 'account' }).drive.meta(FILES.docx.id), 'account');
  await fails(harness([], { fail: 'something new' }).drive.meta(FILES.docx.id), 'auth');
  assert.equal(D.WHY.includes('network') && D.WHY.includes('size'), true);
});

// A runtime port pair, as chrome.runtime.connect gives each side: messages cloned and delivered later, in order.
const ports = () => {
  const side = () => ({ msg: [], gone: [], peer: null, closed: false,
    onMessage: { addListener(f) { this.owner.msg.push(f); } }, onDisconnect: { addListener(f) { this.owner.gone.push(f); } },
    postMessage(m) { if (this.closed) throw new Error('closed'); const c = structuredClone(m), p = this.peer; setImmediate(() => { if (!p.closed) for (const f of p.msg) f(c, p); }); },
    disconnect() { if (this.closed) return; this.closed = true; const p = this.peer; setImmediate(() => { if (p.closed) return; p.closed = true; for (const f of p.gone) f(p); }); } });
  const a = side(), b = side();
  a.peer = b; b.peer = a;
  for (const s of [a, b]) { s.onMessage.owner = s; s.onDisconnect.owner = s; }
  return [a, b];
};

test('the port: a page opens a picked file in chunks, each acknowledged, and gets a File', async () => {
  const n = D.CHUNK * 2 + 5;
  const h = harness([json(200, { ...FILES.pdf, size: String(n) }), stream(n, 100000).res]);
  const [page, worker] = ports();
  let posted = 0;
  const post = worker.postMessage.bind(worker);
  worker.postMessage = (m) => { if (m.type === 'chunk') { posted++; assert.ok(m.data.length <= 4 * Math.ceil(D.CHUNK / 3)); } post(m); };
  D.serve(worker, { drive: h.drive, allowed: async () => true });
  const seen = [];
  const f = await D.client(() => page).open(FILES.pdf.id, ALL, (p) => seen.push(p));
  assert.equal(f.name, 'Reading.pdf'); assert.equal(f.type, MIME.pdf); assert.equal(f.size, n);
  assert.deepEqual(new Uint8Array(await f.arrayBuffer()).slice(0, 3), new Uint8Array([7, 7, 7]));
  assert.equal(posted, 3);
  assert.deepEqual(seen.at(-1), { done: n, total: n });
  assert.ok(page.closed, 'the page lets the port go');
});

test('the port: a refusal comes back as its reason; a sender the worker no longer trusts gets none of it', async () => {
  let h = harness([json(200, { ...FILES.pdf, size: String(60e6) })]);
  let [page, worker] = ports();
  D.serve(worker, { drive: h.drive, allowed: async () => true });
  await fails(D.client(() => page).open(FILES.pdf.id, ALL), 'size');
  h = harness([]);
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, allowed: async () => false });
  await fails(D.client(() => page).open(FILES.pdf.id, ALL), 'sender');
  assert.equal(h.log.fetch.length + h.log.token.length, 0);
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, allowed: async () => true });
  await fails(D.client(() => page).open(FILES.pdf.id, ['nonsense']), 'bad');
});

test('the port: a page saves a document, the worker remembers its Drive file and updates it the next time', async () => {
  const bytes = new Uint8Array(D.CHUNK + 10).fill(3);
  const records = new Map([['doc:1', null]]);
  const record = { get: async (k) => (records.has(k) ? { drive: records.get(k) } : null), set: async (k, d) => { records.set(k, d); return true; } };
  let uploaded = null;
  let h = harness([async (url, init) => { uploaded = init.body; return json(200, SAVED.file); }]);
  let [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  const r = await D.client(() => page).save({ key: 'doc:1', name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file' });
  assert.deepEqual(r, { type: 'saved', id: SAVED.file.id, fresh: false });
  assert.ok(decode(uploaded).includes(decode(bytes)), 'every chunk arrived, in order');
  assert.deepEqual(records.get('doc:1'), { id: SAVED.file.id, as: 'file' });
  // Next time: the check, then the update of that file.
  h = harness([json(200, { ...FILES.docx, id: SAVED.file.id }), json(200, SAVED.file)]);
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  await D.client(() => page).save({ key: 'doc:1', name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file' });
  assert.equal(h.log.fetch[1].init.method, 'PATCH');
  assert.ok(h.log.fetch[1].url.startsWith(`${UPLOAD}/${SAVED.file.id}?`));
  // Saved as a Google Doc instead: a new one, remembered in its place.
  h = harness([json(200, SAVED.doc)]);
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  await D.client(() => page).save({ key: 'doc:1', name: 'Essay.docx', mime: MIME.docx, bytes, as: 'doc' });
  assert.equal(h.log.fetch[0].init.method, 'POST');
  assert.deepEqual(records.get('doc:1'), { id: SAVED.doc.id, as: 'doc' });
  // No such document: nothing uploaded.
  h = harness([]);
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  await fails(D.client(() => page).save({ key: 'doc:gone', name: 'Essay.docx', mime: MIME.docx, bytes, as: 'file' }), 'missing');
  assert.equal(h.log.fetch.length, 0);
});

test('the port: a page that sends more than it said, or goes away, uploads nothing', async () => {
  const records = new Map([['doc:1', null]]);
  const record = { get: async (k) => (records.has(k) ? { drive: records.get(k) } : null), set: async () => true };
  const h = harness([]);
  let [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  const got = [];
  page.onMessage.addListener((m) => { got.push(m); if (m.type === 'more') page.postMessage({ op: 'chunk', data: D.b64(new Uint8Array(20)) }); });
  page.postMessage({ op: 'save', key: 'doc:1', name: 'a.pdf', mime: MIME.pdf, size: 10, as: 'file' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(got.at(-1).type, 'fail'); assert.equal(got.at(-1).why, 'bad');
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  page.onMessage.addListener((m) => { if (m.type === 'more') page.disconnect(); });
  page.postMessage({ op: 'save', key: 'doc:1', name: 'a.pdf', mime: MIME.pdf, size: 10, as: 'file' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(h.log.fetch.length, 0);
});

test('the worker\'s Drive forgets a refused token through the sign-in\'s drop, which covers both flows', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../lib/background.js'), 'utf8');
  const at = src.indexOf('drive: D.create({'), call = src.slice(at, src.indexOf('}),', at));
  assert.match(call, /drop: \(token\) => openGoogle\(\)\.drop\(token\)/);
  assert.doesNotMatch(call, /removeCachedAuthToken/);
});
