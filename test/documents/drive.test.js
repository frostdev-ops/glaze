// Google Drive's files (documents/drive.js) against Drive v3's own shapes (test/fixtures/drive/v3.js): each request's exact
// address, headers and body, the kinds' size limits before and while bytes come, the one retry after a 401, Drive's
// errors as fixed reasons, a save that updates the file it made only while that file is still there, and the port that
// carries the bytes between a page and the worker.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../extension/documents/drive.js');
const K = require('../../extension/documents/doc-kinds.js');
const { MIME, FILES, SAVED, ERRORS } = require('../fixtures/drive/v3.js');

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

test('a Google file larger than Drive exports says so, as Drive answers it now (400) and did (403), not "try again"', async () => {
  for (const [code, body] of [[400, ERRORS.exportSize], [403, ERRORS.exportSizeLimitExceeded]]) {
    const h = harness([json(200, FILES.doc), json(code, body)]);
    await fails(h.drive.open(FILES.doc.id, ALL), 'export');
    assert.match(h.log.fetch[1].url, /\/export\?/, `${code}: the export itself refused`);
    const r = harness([json(200, FILES.sheet), json(code, body)]);
    await fails(r.drive.raw(FILES.sheet.id), 'export');
  }
  assert.ok(D.WHY.includes('export'), 'the port carries it');
  await fails(harness([json(400, ERRORS.exportSize)]).drive.meta(FILES.docx.id), 'export');
  await fails(harness([json(400, {})]).drive.meta(FILES.docx.id), 'bad');
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

test('the port: a page that sends more than it said, or goes away, uploads nothing', { timeout: 5000 }, async () => {
  const records = new Map([['doc:1', null]]);
  const record = { get: async (k) => (records.has(k) ? { drive: records.get(k) } : null), set: async () => true };
  const h = harness([]);
  let [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  const refused = new Promise((resolve) => page.onMessage.addListener((m) => {
    if (m.type === 'more') page.postMessage({ op: 'chunk', data: D.b64(new Uint8Array(20)) });
    if (m.type === 'fail') resolve(m);
  }));
  page.postMessage({ op: 'save', key: 'doc:1', name: 'a.pdf', mime: MIME.pdf, size: 10, as: 'file' });
  assert.equal((await refused).why, 'bad');
  page.disconnect();
  [page, worker] = ports();
  D.serve(worker, { drive: h.drive, record, allowed: async () => true });
  const disconnected = new Promise((resolve) => worker.onDisconnect.addListener(resolve));
  page.onMessage.addListener((m) => { if (m.type === 'more') page.disconnect(); });
  page.postMessage({ op: 'save', key: 'doc:1', name: 'a.pdf', mime: MIME.pdf, size: 10, as: 'file' });
  await disconnected;
  assert.equal(h.log.fetch.length, 0);
});

test('the worker\'s Drive forgets a refused token through the sign-in\'s drop, which covers both flows', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension/background/background.js'), 'utf8');
  const at = src.indexOf('drive: D.create({'), call = src.slice(at, src.indexOf('}),', at));
  assert.match(call, /drop: \(token\) => openGoogle\(\)\.drop\(token\)/);
  assert.doesNotMatch(call, /removeCachedAuthToken/);
});

test('concurrent saves of one document reuse the first saved Drive file', async () => {
  let rec = { drive: null }, made = 0;
  const targets = [];
  const record = { get: async () => structuredClone(rec), set: async (_k, drive) => { rec = { drive }; } };
  const drive = { save: async ({ id }) => {
    targets.push(id);
    // Both tabs finish collecting their bytes before the first upload answers.
    await new Promise((r) => setImmediate(r));
    return { id: id || `made-${++made}`, fresh: false };
  } };
  const save = () => {
    const [page, worker] = ports();
    D.serve(worker, { drive, record });
    return D.client(() => page).save({ key: 'doc:concurrent', name: 'Essay.docx', mime: MIME.docx, bytes: new Uint8Array([1]), as: 'file' });
  };
  const results = await Promise.all([save(), save()]);
  assert.equal(made, 1, 'two tabs must not create independent remote copies');
  assert.deepEqual(targets, [null, 'made-1']);
  assert.equal(results[0].id, results[1].id);
  assert.equal(rec.drive.id, results[0].id);
});

test('a sender revoked while uploading bytes cannot publish them to Drive', async () => {
  const [page, worker] = ports();
  let allowed = true, uploads = 0, recorded = false;
  D.serve(worker, {
    allowed: async () => allowed,
    record: { get: async () => ({ drive: null }), set: async () => { recorded = true; } },
    drive: { save: async () => { uploads++; return { id: 'unexpected', fresh: false }; } },
  });
  await fails(D.client(() => page).save({ key: 'doc:revoked', name: 'Essay.docx', mime: MIME.docx, bytes: new Uint8Array([1]), as: 'file' }, () => { allowed = false; }), 'sender');
  assert.equal(uploads, 0);
  assert.equal(recorded, false);
});

test('a sender revoked after a download chunk receives no further bytes', async () => {
  const n = D.CHUNK * 2, h = harness([json(200, { ...FILES.pdf, size: String(n) }), stream(n, D.CHUNK).res]);
  const [page, worker] = ports();
  let allowed = true, received = 0;
  D.serve(worker, { drive: h.drive, allowed: async () => allowed });
  await fails(D.client(() => page).open(FILES.pdf.id, ALL, ({ done }) => {
    received = done;
    if (done) allowed = false;
  }), 'sender');
  assert.equal(received, D.CHUNK);
});

test('a sender revoked during token acquisition sends no Drive request', async () => {
  const [page, worker] = ports();
  let allowed = true, sent = 0;
  const permitted = async () => allowed;
  const drive = D.create({
    allowed: permitted, account: async () => 'student@school.edu',
    token: async () => { allowed = false; return 'tok'; },
    fetch: async () => { sent++; return json(200, SAVED.file); },
  });
  D.serve(worker, { drive, allowed: permitted, record: { get: async () => ({ drive: null }), set: async () => {} } });
  await fails(D.client(() => page).save({ key: 'doc:auth', name: 'Essay.docx', mime: MIME.docx, bytes: new Uint8Array([1]), as: 'file' }), 'sender');
  assert.equal(sent, 0);
});

test('the worker cancels an upload when its page disconnects while the token is pending', async () => {
  let release, sent = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const key = 'doc:00000000-0000-4000-8000-000000000001';
  const w = require('../helpers/worker-env.cjs')({
    store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], [`writerPaper:${key}`]: { key, kind: 'paper' } }, session: {} },
    globals: {
      GZ_DRIVE: D, GZ_GOOGLE_CONFIG: {},
      GZ_GOOGLE: { ON: true, flowOf: () => 'chrome', create: () => ({ account: async () => 'student@school.edu', token: async () => pending }) },
      GZ_DOC_FILES: { idb: () => null, store: () => ({}) },
    },
    fetch: async () => { sent++; return json(200, SAVED.file); },
  });
  const c = w.connect(D.PORT, { id: 'glaze', url: 'chrome-extension://x/papers.html', frameId: 0, tab: { id: 7 } });
  c.say({ op: 'save', key, name: 'Essay.docx', mime: MIME.docx, size: 1, as: 'file' });
  await w.settle();
  assert.equal(c.port.posted.at(-1).type, 'more');
  c.say({ op: 'chunk', data: D.b64(new Uint8Array([1])) });
  await w.settle();
  c.say({ op: 'end' });
  await w.settle();
  c.close();
  release('tok');
  await w.settle();
  assert.equal(sent, 0, 'a port that went away cannot resume an upload after sign-in');
  assert.equal(w.store.local[`writerPaper:${key}`].drive, undefined);
});

test('a download stops delivering bytes when its Google account changes mid-stream', async () => {
  for (const next of [null, 'other@school.edu']) {
    let who = 'student@school.edu', calls = 0, received = 0;
    const body = stream(8, 4);
    const drive = D.create({
      account: async () => who, token: async () => 'tok',
      fetch: async () => ++calls === 1 ? json(200, { ...FILES.pdf, size: '8' }) : body.res,
    });
    await fails(drive.open(FILES.pdf.id, ALL, { bytes: (b) => { received += b.length; who = next; } }), 'connect');
    assert.equal(received, 4, 'no further bytes reach the page after Disconnect or an account switch');
    assert.equal(body.seen.cancelled, true);
  }
});

test('Disconnect stops a download even inside a large network chunk', async () => {
  let who = 'student@school.edu', calls = 0, received = 0;
  const n = 2 * D.CHUNK, body = stream(n, n);
  const drive = D.create({
    account: async () => who, token: async () => 'tok',
    fetch: async () => ++calls === 1 ? json(200, { ...FILES.pdf, size: String(n) }) : body.res,
  });
  const [page, worker] = ports();
  D.serve(worker, { drive });
  await fails(D.client(() => page).open(FILES.pdf.id, ALL, ({ done }) => {
    received = done;
    if (done) who = null;
  }), 'connect');
  assert.equal(received, D.CHUNK, 'only the chunk acknowledged before Disconnect was delivered');
});

// The pages' part (page), run as a page runs it: drive.js in a realm with a document, the runtime's messages and ports.
const pageOf = ({ files, drive, path = '/writer.html' }) => {
  const vm = require('node:vm'), fs = require('node:fs');
  const notes = [];
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, TextEncoder, File, atob, btoa, crypto, document: {}, location: { pathname: path },
    GZ_I18N: { t: (k) => k },
    chrome: {
      runtime: {
        sendMessage: async (m) => (m.type === 'glaze:drive' ? { ok: true, connected: true } : { ok: true, files }),
        connect: () => { const [page, worker] = ports(); D.serve(worker, { drive, allowed: async () => true }); return page; },
      },
      storage: { onChanged: { addListener() {} } }, i18n: { getUILanguage: () => 'en' },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../../extension/documents/drive.js'), 'utf8'), ctx);
  return { page: ctx.GZ_DRIVE.page, api: { notify: (m) => notes.push(m) }, notes };
};

test('the paper\'s From Google Drive brings a file under a name a file can have, which Writer\'s import takes', async () => {
  const L = require('../../extension/writer/writer-submit.js');
  const meta = { ...FILES.doc, name: 'Lab report 10/30' };
  const h = harness([json(200, meta), stream(2048).res]);
  const p = pageOf({ files: [{ id: meta.id, name: meta.name, mimeType: meta.mimeType }], drive: h.drive });
  for (let i = 0; i < 10 && !p.page.connected(); i++) await new Promise((r) => setImmediate(r));
  let brought = null;
  const [item] = p.page.items(p.api, (f) => { brought = f; });
  assert.equal(item.label, 'From Google Drive');
  await item.run();
  assert.ok(brought, JSON.stringify(p.notes));
  assert.equal(brought.name, 'Lab report 10_30.docx');
  assert.equal(brought.size, 2048);
  assert.equal(L.fileError(brought), null, 'on an assignment, writer-import.js takes it rather than saying it could not be read');
});

// Save to Drive above Drive's multipart size (SMALL, 5 MB) goes resumable through Sync's own path (put): a session, its
// address only ever Drive's upload address, then one PUT of the bytes; at or below, one multipart request. Against the
// stand-in Drive that keeps state (test/helpers/drive-standin.cjs).
test('save: a 6 MB PDF goes resumable, through the same Location check Sync\'s uploads have; 5 MB stays multipart', async () => {
  const { standin } = require('../helpers/drive-standin.cjs');
  const sd = standin(), elsewhere = [];
  let move = false;
  const fetch = async (url, init) => {
    if (!url.startsWith('https://www.googleapis.com/')) { elsewhere.push(url); throw new TypeError('Failed to fetch'); }
    const r = await sd.fetch(url, init);
    if (!move || !r.headers.get('location')) return r;
    return new Response(null, { status: 200, headers: { location: r.headers.get('location').replace('https://www.googleapis.com/', 'https://uploads.example/') } });
  };
  const drive = D.create({ fetch, token: async () => 'tok-1', boundary: () => 'B0und4ry' });
  const asked = () => sd.log.map((x) => [x.method, x.path, x.query.uploadType, x.query.supportsAllDrives && 'all'].filter(Boolean).join(' '));
  const pdf = new Uint8Array(6e6).fill(5);

  const made = await drive.save({ name: 'Reading.pdf', mime: MIME.pdf, bytes: pdf });
  assert.deepEqual(asked(), ['POST /upload/drive/v3/files resumable', 'PUT /upload/drive/v3/files resumable'], 'a session, then its bytes; no multipart');
  assert.equal(made.fresh, false);
  const f = sd.files.get(made.id);
  assert.equal(f.bytes.length, 6e6); assert.equal(f.meta.name, 'Reading.pdf'); assert.equal(f.meta.mimeType, MIME.pdf);
  assert.equal(sd.log[0].type, 'application/json; charset=UTF-8');

  sd.log.length = 0;
  const again = await drive.save({ name: 'Reading.pdf', mime: MIME.pdf, bytes: pdf, id: made.id });
  assert.deepEqual(again, { id: made.id, fresh: false }, 'the same file updated');
  assert.deepEqual(asked(), [`GET /drive/v3/files/${made.id} all`, `PATCH /upload/drive/v3/files/${made.id} resumable all`, `PUT /upload/drive/v3/files/${made.id} resumable`], 'the session\'s own address takes the bytes');
  assert.equal(sd.files.get(made.id).meta.version, '2', 'one new revision');

  sd.log.length = 0;
  await drive.save({ name: 'Small.pdf', mime: MIME.pdf, bytes: new Uint8Array(D.SMALL).fill(1) });
  assert.deepEqual(asked(), ['POST /upload/drive/v3/files multipart'], 'at 5 MB, one multipart request');

  // A session whose address isn't Drive's upload address: refused, the bytes and the token go nowhere else.
  sd.log.length = 0; move = true;
  await fails(drive.save({ name: 'Reading.pdf', mime: MIME.pdf, bytes: pdf }), 'bad');
  assert.deepEqual(asked(), ['POST /upload/drive/v3/files resumable']);
  assert.deepEqual(elsewhere, []);
});
