// Submit from Drive's download (extension/documents/drive.js raw): any file Blackboard takes, as it is, up to 50 MB (Google's own files
// exported as Open from Drive exports them), and a cancel that stops the fetch at once, even mid-stall, through the
// caller's AbortSignal (fetch's and the body reader's), over the worker's port as well. Open from Drive keeps its kinds
// and their limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../extension/documents/drive.js');
const K = require('../../extension/documents/doc-kinds.js');
const { MIME, FILES } = require('../fixtures/drive/v3.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=UTF-8' } });
const bytes = (n, headers = {}) => new Response(new Uint8Array(n).fill(3), { status: 200, headers });
// A body that sends one piece and then never another: a stalled network.
const stalled = () => {
  const seen = { cancelled: false };
  const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); }, pull() { return new Promise(() => {}); }, cancel() { seen.cancelled = true; } });
  return { res: new Response(body, { status: 200 }), seen };
};
const drive = (answers, log = []) => D.create({ token: async () => 'tok', fetch: async (url, init) => { log.push({ url, init }); const a = answers.shift(); return typeof a === 'function' ? a(url, init) : a; } });
const fails = async (p, why) => { await assert.rejects(p, (e) => { assert.equal(e.why, why); return true; }); };
const PNG = { ...FILES.pdf, id: '1PnG_a', name: 'Lab photo.png', mimeType: 'image/png', size: '2048' };

test('raw: an image, a zip, anything, as it is, by alt=media', async () => {
  for (const f of [PNG, { ...PNG, id: '1ZiP_b', name: 'Code.zip', mimeType: 'application/zip' }, { ...PNG, id: '1NoN_c', name: 'notes', mimeType: 'application/octet-stream' }]) {
    const log = [], heads = [];
    let got = 0;
    const n = await drive([json(200, f), bytes(2048)], log).raw(f.id, { head: (h) => heads.push(h), bytes: (b) => { got += b.length; } });
    assert.equal(n, 2048); assert.equal(got, 2048);
    assert.deepEqual(heads, [{ name: f.name, mime: f.mimeType, size: 2048 }], 'its own name and type');
    assert.match(log[1].url, new RegExp(`/files/${f.id}\\?alt=media`));
  }
});

test('raw: past the 15 MB a paper opens with, up to 50 MB; larger refused before a byte', async () => {
  const big = { ...FILES.docx, size: String(20e6) };
  await fails(drive([json(200, big)]).open(big.id, ['paper']), 'size');
  assert.equal(await drive([json(200, big), bytes(20e6)]).raw(big.id), 20e6, 'Submit takes a 20 MB Word file Open refuses');
  const log = [];
  await fails(drive([json(200, { ...big, size: String(K.FILE + 1) })], log).raw(big.id), 'size');
  assert.equal(log.length, 1, 'no download asked for');
  // No size from Drive: counted as it comes.
  await fails(drive([json(200, { ...PNG, size: undefined }), bytes(K.FILE + 1)]).raw(PNG.id), 'size');
});

test('raw: Google\'s own files export as Open exports them; ones that can\'t download are refused', async () => {
  const log = [], heads = [];
  await drive([json(200, FILES.doc), bytes(100)], log).raw(FILES.doc.id, { head: (h) => heads.push(h) });
  assert.deepEqual(heads, [{ name: 'Lab notes.docx', mime: MIME.docx, size: null }]);
  assert.match(log[1].url, new RegExp(`/files/${FILES.doc.id}/export\\?mimeType=`));
  await fails(drive([json(200, { ...PNG, mimeType: 'application/vnd.google-apps.form' })]).raw(PNG.id), 'type');
  await fails(drive([json(200, { ...PNG, capabilities: { canEdit: false, canDownload: false } })]).raw(PNG.id), 'denied');
});

test('cancel: the caller\'s signal reaches fetch, and stops a stalled body at once', async () => {
  const s = stalled(), log = [], ctl = new AbortController();
  let got = 0;
  const p = drive([json(200, PNG), s.res], log).raw(PNG.id, { signal: ctl.signal, bytes: (b) => { got += b.length; } });
  for (let i = 0; i < 20 && got === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(got, 10, 'the first piece came');
  const t = Date.now();
  ctl.abort();
  await fails(p, 'cancel');
  assert.ok(Date.now() - t < 200, 'at once, not at the next piece');
  assert.equal(s.seen.cancelled, true, 'the body cancelled');
  assert.ok(log.every((x) => x.init.signal === ctl.signal), 'each fetch carries the signal');
  // Open from Drive takes the same signal.
  const s2 = stalled(), c2 = new AbortController();
  const q = drive([json(200, FILES.pdf), s2.res]).open(FILES.pdf.id, ['pdf'], { signal: c2.signal });
  setTimeout(() => c2.abort(), 20);
  await fails(q, 'cancel');
  assert.equal(s2.seen.cancelled, true);
});

test('cancel before the answer: a fetch the network holds is aborted, and nothing more is asked', async () => {
  const ctl = new AbortController(), log = [];
  const hang = (url, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError'))));
  const p = drive([json(200, PNG), hang], log).raw(PNG.id, { signal: ctl.signal });
  setTimeout(() => ctl.abort(), 20);
  await fails(p, 'cancel');
  assert.equal(log.length, 2);
  const c2 = new AbortController();
  c2.abort();
  const l2 = [];
  await fails(drive([json(200, PNG)], l2).raw(PNG.id, { signal: c2.signal }), 'cancel');
  assert.equal(l2.length, 0, 'an aborted signal asks nothing');
});

// A runtime port pair, as chrome.runtime.connect gives each side (test/drive.test.js's).
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

test('the port: a page gets a raw file whole; its cancel aborts the worker\'s fetch mid-stall', async () => {
  const [page, worker] = ports();
  D.serve(worker, { drive: drive([json(200, PNG), bytes(2048)]), allowed: async () => true });
  const f = await D.client(() => page).raw(PNG.id);
  assert.equal(f.name, 'Lab photo.png'); assert.equal(f.type, 'image/png'); assert.equal(f.size, 2048);
  const [p2, w2] = ports(), s = stalled(), log = [], ctl = new AbortController();
  D.serve(w2, { drive: drive([json(200, PNG), s.res], log), allowed: async () => true });
  const q = D.client(() => p2).raw(PNG.id, null, ctl.signal);
  for (let i = 0; i < 40 && log.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  ctl.abort();
  await fails(q, 'cancel');
  for (let i = 0; i < 40 && !s.seen.cancelled; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(s.seen.cancelled, true, 'the worker\'s body cancelled when the page let go');
  assert.ok(log[1].init.signal.aborted, 'and its fetch\'s signal aborted');
});

// Drive lets a name hold what a file's can't: a slash ("Lab 10/30", a date in a title), a control character, a thousand
// characters. Submit from Drive hands the file to Blackboard's upload, which takes only names a file can have
// (writer/writer-submit.js asIsName): such a file was refused as "That file could not be read.".
test('raw: a Drive name a file can\'t have comes as one it can, its extension kept', async () => {
  const L = require('../../extension/writer/writer-submit.js');
  const long = `${'Ünïcode '.repeat(40)}notes.pdf`;
  for (const [meta, name] of [
    [{ ...FILES.doc, name: 'Lab report 10/30' }, 'Lab report 10_30.docx'],
    [{ ...PNG, name: 'Scan 10\\30\u0007\n.png' }, 'Scan 10_30__.png'],
    [{ ...PNG, name: '...' }, '_...'],
    [{ ...PNG, name: long, mimeType: MIME.pdf }, null],
    [PNG, 'Lab photo.png'],
  ]) {
    const heads = [];
    await drive([json(200, meta), bytes(10)]).raw(meta.id, { head: (h) => heads.push(h) });
    const got = heads[0].name;
    assert.ok(L.asIsName(got), `${JSON.stringify(meta.name)} → ${JSON.stringify(got)} is a name a file can have`);
    if (name) assert.equal(got, name);
    else { assert.equal([...got].length, 255); assert.ok(got.endsWith(' notes.pdf') || got.endsWith('.pdf')); assert.ok(got.startsWith('Ünïcode Ünïcode')); }
  }
  // Over the port, the File the page gets carries it.
  const [page, worker] = ports();
  D.serve(worker, { drive: drive([json(200, { ...FILES.doc, name: 'Lab report 10/30' }), bytes(10)]), allowed: async () => true });
  const f = await D.client(() => page).raw(FILES.doc.id);
  assert.equal(f.name, 'Lab report 10_30.docx');
  assert.equal(L.fileError(f), null, 'Writer\'s import takes it');
});
