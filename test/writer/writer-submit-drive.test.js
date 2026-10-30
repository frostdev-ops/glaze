// The submit sheet's From Google Drive (writer/frame/writer-submit.js): the frame asks the worker for the Picker and reads
// each file over the worker's Drive port with documents/drive.js's own client, serve and create (raw: any type up to 50 MB,
// cancelled through its signal), the real protocol over paired stand-in ports, and a stand-in fetch answering for Drive v3
// (test/fixtures/drive/v3.js's shapes). Shown only while connected; the files staged beside the paper; limits, failures,
// a stalled read cancelled.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../extension/documents/drive.js'), K = require('../../extension/documents/doc-kinds.js');
const { ERRORS } = require('../fixtures/drive/v3.js');
const sheet = require('../helpers/writer-submit-sheet.cjs');

const MIME = { docx: K.KINDS.paper.mime, pdf: 'application/pdf', gdoc: 'application/vnd.google-apps.document', gform: 'application/vnd.google-apps.form',
  png: 'image/png', zip: 'application/zip' };

// Two ports joined: a message posted on one reaches the other's listeners a turn later; disconnect tells the other side only.
const pair = () => {
  const side = () => ({ on: [], off: [], gone: false });
  const a = side(), b = side();
  const port = (me, other) => ({
    postMessage(m) { if (me.gone) throw Error('disconnected'); const c = structuredClone(m); setImmediate(() => { if (!other.gone) for (const f of other.on) f(c); }); },
    disconnect() { if (me.gone) return; me.gone = true; other.gone = true; setImmediate(() => { for (const f of other.off) f(); }); },
    onMessage: { addListener: (f) => me.on.push(f) },
    onDisconnect: { addListener: (f) => me.off.push(f) },
  });
  return [port(a, b), port(b, a)];
};

// Drive as the stand-in holds it: id → { meta, bytes, hold (a promise the second piece waits on), stall (no piece after the
// first, ever), refuse (Drive's error body for its bytes) }. asked: each request, `${id} meta|media|export <type>`; ended: each body cancelled before its end.
const standIn = () => {
  const files = new Map(), asked = [], ended = [];
  const fetch = async (url) => {
    const u = new URL(url), m = /\/files\/([\w-]+)(\/export)?$/.exec(u.pathname), id = m[1], f = files.get(id);
    const what = m[2] ? `export ${u.searchParams.get('mimeType')}` : u.searchParams.get('alt') === 'media' ? 'media' : 'meta';
    asked.push(`${id} ${what}`);
    if (!f) return new Response(JSON.stringify(ERRORS[404]), { status: 404 });
    if (what === 'meta') return Response.json({ trashed: false, capabilities: { canEdit: true, canDownload: true }, ...f.meta });
    if (f.refuse) return Response.json(f.refuse, { status: f.refuse.error.code });
    let at = 0;
    const body = new ReadableStream({
      async pull(c) {
        if (at >= f.bytes.length) { c.close(); return; }
        if (at && f.hold) await f.hold;
        if (at && f.stall) await new Promise(() => {});
        c.enqueue(f.bytes.slice(at, at += 100e3));
      },
      cancel() { ended.push(id); },
    }, { highWaterMark: 0 });
    return new Response(body, { headers: { 'content-length': String(f.bytes.length) } });
  };
  return { files, asked, ended, drive: D.create({ fetch, token: async () => 'ya29.unit' }) };
};

const setup = ({ connected = true, picked = [], pick = null } = {}) => {
  const s = sheet(), d = standIn(), store = new Map(), ports = [];
  let n = 0;
  s.picks = [];
  s.ctx.chrome = { runtime: {
    sendMessage: async (m) => { s.picks.push(m); return pick || { ok: true, files: picked }; },
    connect: ({ name }) => {
      assert.equal(name, D.PORT);
      const [page, worker] = pair();
      ports.push(page);
      D.serve(worker, { drive: d.drive });
      return page;
    },
  } };
  // The page's client connects as the frame's chrome does (drive.js runs in this realm, the sheet in its own).
  s.ctx.GZ_DRIVE = { ...D, client: () => D.client(() => s.ctx.chrome.runtime.connect({ name: D.PORT })), page: { connected: () => connected } };
  s.ctx.GZ_DOC_KINDS = K;
  s.ctx.AbortController = AbortController; // a frame has it; the helper's context doesn't
  s.ctx.GZ_DOC_FILES = { client: () => ({ put: async (b) => { store.set(++n, b); return n; }, get: async (r) => store.get(r) }) };
  return Object.assign(s, { d, store, ports });
};
const rows = (s) => s.doc.querySelectorAll('.gs-att').map((r) => ({ name: r.querySelector('.gs-name').textContent, size: r.querySelector('small').textContent }));
const err = (s) => s.doc.querySelector('.gs-err').textContent;
const submitOff = (s) => s.doc.querySelector('.gs-primary').disabled === true;
const settle = async (s, n = 6) => { for (let i = 0; i < n; i++) await s.flush(); };
const bytes = (n, b = 7) => new Uint8Array(n).fill(b);
const file = (id, name, mimeType, size) => ({ id, name, mimeType, ...(size != null && { size: String(size) }) });

test('From Google Drive shows only while Drive is connected', async () => {
  const off = setup({ connected: false });
  await off.open();
  assert.equal(off.doc.querySelector('.gs-drive'), null);
  const on = setup();
  await on.open();
  assert.equal(on.doc.querySelector('.gs-drive').textContent, 'From Google Drive');
  const none = sheet();
  await none.open();
  assert.equal(none.doc.querySelector('.gs-drive'), null, 'no Drive script: no button');
});

for (const wait of ['picker', 'attachment support']) test(`Submit waits for Drive's ${wait} before taking the attachment list`, async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const picked = [file('1Pdf', 'Notes.pdf', MIME.pdf)];
  const s = setup({ picked, ...(wait === 'picker' && { pick: held }) });
  s.d.files.set('1Pdf', { meta: { ...picked[0], size: '10' }, bytes: bytes(10) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  if (wait === 'attachment support') s.ctx.GZ_WRITER_PAPER.need = (names) => names.includes('documents/doc-kinds.js') ? held : Promise.resolve();
  s.click('.gs-drive'); await s.flush();
  // Dispatch explicitly too: the click handler must enforce the same gate as the button.
  s.click('.gs-primary'); await s.flush();
  const off = submitOff(s), started = s.saved.length;
  release({ ok: true, files: picked }); await settle(s, 20);
  assert.equal(started, 0, 'a pending Drive choice cannot start submission');
  assert.equal(off, true, 'Submit is disabled throughout the choice');
  assert.equal(rows(s).length, 1, 'the selected attachment reaches the sheet');
  assert.equal(submitOff(s), false, 'the student can submit once the file is staged');
  s.click('.gs-primary'); await settle(s);
  assert.equal(s.messages.find((m) => m.type === 'submit:go').files.length, 1);
});

test('attachment support failing to load reports the failure and lets the student retry Drive', async () => {
  const picked = [file('1Pdf', 'Notes.pdf', MIME.pdf)];
  const s = setup({ picked });
  s.d.files.set('1Pdf', { meta: { ...picked[0], size: '10' }, bytes: bytes(10) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  const need = s.ctx.GZ_WRITER_PAPER.need;
  s.ctx.GZ_WRITER_PAPER.need = async () => { throw Error('documents/doc-kinds.js did not load'); };
  const choose = () => s.doc.querySelector('.gs-drive').listeners.find((l) => l.type === 'click').f();
  await assert.doesNotReject(choose(), 'the event handler handles a failed script load');
  assert.equal(err(s), 'That file could not be read.');
  assert.equal(rows(s).length, 0);
  assert.deepEqual(s.d.asked, []);
  assert.equal(submitOff(s), false);
  assert.equal(s.doc.querySelector('.gs-drive').disabled, false);
  assert.equal(s.saved.length, 0);
  s.ctx.GZ_WRITER_PAPER.need = need;
  await choose(); await settle(s, 20);
  assert.equal(rows(s).length, 1, 'retry stages the file');
  assert.equal(err(s), '');
});

test('two Drive files, one a Google Doc exported as .docx, are staged beside the paper; Submit stays the student\'s', async () => {
  const s = setup({ picked: [file('1Pdf', 'Field trip.pdf', MIME.pdf), file('1GDoc', 'Lab notes', MIME.gdoc)] });
  let release;
  s.d.files.set('1Pdf', { meta: file('1Pdf', 'Field trip.pdf', MIME.pdf, 450e3), bytes: bytes(450e3, 1), hold: new Promise((r) => { release = r; }) });
  s.d.files.set('1GDoc', { meta: file('1GDoc', 'Lab notes', MIME.gdoc), bytes: bytes(30e3, 2) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive');
  await s.flush();
  assert.deepEqual(rows(s).map((r) => r.name), ['Field trip.pdf', 'Lab notes'], 'listed at once, by the names picked');
  assert.ok(submitOff(s), 'Submit waits while files are read');
  await settle(s, 20);
  assert.ok(submitOff(s), 'still reading');
  release(); await settle(s, 20);
  assert.equal(JSON.stringify(s.picks), JSON.stringify([{ type: 'glaze:google', op: 'pick' }]), 'the Picker is the worker\'s');
  assert.deepEqual(s.d.asked, ['1Pdf meta', '1Pdf media', '1GDoc meta', `1GDoc export ${MIME.docx}`], 'one at a time, in order, the Google Doc exported as .docx');
  const r = rows(s);
  assert.equal(r.length, 2);
  assert.ok(r.every((x) => / KB$/.test(x.size)), JSON.stringify(r));
  assert.match(r[0].name, /\.pdf$/); assert.match(r[1].name, /\.docx$/);
  assert.equal(err(s), '');
  assert.equal(submitOff(s), false);
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false, 'nothing is submitted for the student');
  assert.deepEqual([...s.store.values()].map((b) => [b.length, b[0]]), [[450e3, 1], [30e3, 2]], 'the bytes as Drive gave them');
  s.click('.gs-primary'); await settle(s);
  for (const b of s.builds.slice(1)) b.resolve(); await settle(s);
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(JSON.stringify(go.files.map((f) => [f.name, f.mime, f.size])), JSON.stringify([[r[0].name, MIME.pdf, 450e3], [r[1].name, MIME.docx, 30e3]]));
});

for (const [mime, title, expected] of [
  [MIME.gdoc, 'Lab notes v1.2', 'LabNotesV12.docx'],
  ['application/vnd.google-apps.spreadsheet', 'Budget.FY26', 'BudgetFY26.xlsx'],
  ['application/vnd.google-apps.presentation', '.Final slides', 'FinalSlides.pptx'],
]) test(`a Google export preserves the full dotted title: ${title}`, async () => {
  const picked = file('1Dotted', title, mime), s = setup({ picked: [picked] });
  s.d.files.set(picked.id, { meta: picked, bytes: bytes(1000) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.equal(err(s), '');
  assert.deepEqual(rows(s).map((r) => r.name), [expected], 'strip only the export extension, not part of the Google title');
  s.click('.gs-primary'); await settle(s);
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(go.files[0].name, expected, 'the reviewed name is submitted');
  assert.equal(go.note, `Attached: ${expected}`);
});

test('any type comes as it is, and a file over 15 MB under Blackboard\'s 50 MB is taken', async () => {
  const s = setup({ picked: [file('1Png', 'Photo.png', MIME.png), file('1Zip', 'Data.zip', MIME.zip), file('1Long', 'Long.docx', MIME.docx)] });
  s.d.files.set('1Png', { meta: file('1Png', 'Photo.png', MIME.png, 2000), bytes: bytes(2000, 3) });
  s.d.files.set('1Zip', { meta: file('1Zip', 'Data.zip', MIME.zip, 3000), bytes: bytes(3000, 4) });
  s.d.files.set('1Long', { meta: file('1Long', 'Long.docx', MIME.docx, 20e6), bytes: bytes(20e6, 5) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive');
  for (let i = 0; i < 100 && s.store.size < 3 && !err(s); i++) await settle(s, 20);
  const r = rows(s);
  assert.equal(err(s), '');
  assert.equal(r.length, 3);
  assert.match(r[0].name, /\.png$/); assert.match(r[1].name, /\.zip$/); assert.match(r[2].name, /Long\.docx$/);
  assert.ok(r.every((x) => / KB$/.test(x.size)), JSON.stringify(r));
  assert.deepEqual([...s.store.values()].map((b) => [b.length, b[0]]), [[2000, 3], [3000, 4], [20e6, 5]], 'the bytes as Drive gave them');
  s.click('.gs-primary'); await settle(s);
  for (const b of s.builds.slice(1)) b.resolve(); await settle(s);
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(JSON.stringify(go.files.map((f) => [f.mime, f.size])), JSON.stringify([[MIME.png, 2000], [MIME.zip, 3000], [MIME.docx, 20e6]]));
});

test('a file over 50 MB is refused by its size before its bytes; a Google type with no export says it can\'t be read', async () => {
  const s = setup({ picked: [file('1Big', 'Scan.pdf', MIME.pdf), file('1Form', 'Quiz', MIME.gform)] });
  s.d.files.set('1Big', { meta: file('1Big', 'Scan.pdf', MIME.pdf, 60e6), bytes: bytes(1) });
  s.d.files.set('1Form', { meta: file('1Form', 'Quiz', MIME.gform), bytes: bytes(1) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.equal(rows(s).length, 0);
  assert.equal(err(s), 'Scan.pdf is larger than 50 MB. Quiz: That file could not be read.');
  assert.deepEqual(s.d.asked, ['1Big meta', '1Form meta'], 'no bytes asked for');
  assert.equal(submitOff(s), false);
});

test('a file gone from Drive names itself and leaves the list; the others still come, nothing is submitted', async () => {
  const s = setup({ picked: [file('1Gone', 'Old.docx', MIME.docx), file('1Pdf', 'Notes.pdf', MIME.pdf)] });
  s.d.files.set('1Pdf', { meta: file('1Pdf', 'Notes.pdf', MIME.pdf, 1000), bytes: bytes(1000) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.equal(err(s), "Old.docx: Glaze can't reach this file in Google Drive.");
  assert.deepEqual(rows(s).map((r) => r.name.slice(-4)), ['.pdf']);
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
});

test('Cancel mid-stall closes the sheet and aborts the read where it stands; Remove aborts just that one', async () => {
  const s = setup({ picked: [file('1Slow', 'Slow.pdf', MIME.pdf)] });
  s.d.files.set('1Slow', { meta: file('1Slow', 'Slow.pdf', MIME.pdf, 900e3), bytes: bytes(900e3), stall: true });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.equal(rows(s)[0].size, 'Reading…', 'progress in its row');
  assert.ok(submitOff(s));
  assert.deepEqual(s.d.ended, [], 'stalled, not ended');
  s.doc.fire(s.doc.querySelector('.gs-foot .gs-btn'), 'click');
  assert.equal(s.doc.querySelector('.gs-layer'), null, 'Cancel closes the sheet at once');
  await settle(s, 20);
  assert.deepEqual(s.d.ended, ['1Slow'], 'the stalled body was cancelled, no more bytes needed');
  assert.equal(s.store.size, 0, 'nothing staged');

  const r = setup({ picked: [file('1Slow', 'Slow.pdf', MIME.pdf), file('1Pdf', 'Notes.pdf', MIME.pdf)] });
  r.d.files.set('1Slow', { meta: file('1Slow', 'Slow.pdf', MIME.pdf, 900e3), bytes: bytes(900e3), stall: true });
  r.d.files.set('1Pdf', { meta: file('1Pdf', 'Notes.pdf', MIME.pdf, 1000), bytes: bytes(1000) });
  await r.open(); r.builds[0].resolve(); await r.flush();
  r.click('.gs-drive'); await settle(r, 20);
  r.click('.gs-att-x'); await settle(r, 20);
  assert.deepEqual(r.d.ended, ['1Slow']);
  assert.deepEqual(rows(r).map((x) => x.name.slice(-4)), ['.pdf'], 'the next file still comes');
  assert.equal(err(r), ''); assert.equal(submitOff(r), false);
  assert.ok(r.doc.querySelector('.gs-layer'), 'the sheet stays');
});

test('at most ten attachments: the rest are left with the sheet\'s words', async () => {
  const picked = Array.from({ length: 12 }, (_, i) => file(`1F${i}`, `Part ${i}.pdf`, MIME.pdf));
  const s = setup({ picked });
  for (const f of picked) s.d.files.set(f.id, { meta: { ...f, size: '10' }, bytes: bytes(10) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 60);
  assert.equal(rows(s).length, 10);
  assert.equal(err(s), 'Attach up to 10 documents.');
  assert.equal(s.doc.querySelector('.gs-drive').disabled, true, 'full: the button is off');
});

test('a closed Picker says nothing and a sign-in to redo says so, without a request', async () => {
  const closed = setup({ picked: [] });
  await closed.open(); closed.builds[0].resolve(); await closed.flush();
  closed.click('.gs-drive'); await settle(closed);
  assert.equal(err(closed), ''); assert.equal(rows(closed).length, 0); assert.deepEqual(closed.d.asked, []);
  const setupFail = setup({ pick: { ok: false, why: 'auth' } });
  await setupFail.open(); setupFail.builds[0].resolve(); await setupFail.flush();
  setupFail.click('.gs-drive'); await settle(setupFail);
  assert.equal(err(setupFail), 'Connect Google Drive again in Settings.'); assert.deepEqual(setupFail.d.asked, []);
});

test('a Drive title with a slash (a date) or a control character is attached, under a name a file can have', async () => {
  const doc = file('1Slash', 'Lab report 10/30', MIME.gdoc), heic = file('1Heic', 'Scan 10/30\u0007.heic', 'image/heic', 900);
  const s = setup({ picked: [doc, heic] });
  s.d.files.set(doc.id, { meta: doc, bytes: bytes(1000, 1) });
  s.d.files.set(heic.id, { meta: heic, bytes: bytes(900, 2) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 30);
  assert.equal(err(s), '', 'neither is refused as unreadable');
  const r = rows(s).map((x) => x.name);
  assert.equal(r.length, 2);
  assert.match(r[0], /LabReport1030\.docx$/);
  assert.equal(r[1], 'Scan 10_30_.heic');
  s.click('.gs-primary'); await settle(s);
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(JSON.stringify(go.files.map((f) => f.name)), JSON.stringify(r));
});

test('a Google file larger than Drive exports names itself as too large, not as unreadable', async () => {
  const big = file('1BigDoc', 'Lab notes', MIME.gdoc), s = setup({ picked: [big] });
  s.d.files.set(big.id, { meta: big, bytes: bytes(10), refuse: ERRORS.exportSize });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.deepEqual(s.d.asked, [`1BigDoc meta`, `1BigDoc export ${MIME.docx}`]);
  assert.equal(rows(s).length, 0);
  assert.equal(err(s), 'Lab notes: That file is too large.');
  assert.equal(submitOff(s), false);
});
