// The submit sheet's From Google Drive (writer/frame/writer-submit.js): the frame asks the worker for the Picker and reads each file over
// the worker's Drive port (documents/drive.js client and serve, the real protocol over paired stand-in ports), a stand-in Drive
// behind it. Shown only while connected; the files staged beside the paper; limits, failures and Cancel.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../extension/documents/drive.js'), K = require('../../extension/documents/doc-kinds.js');
const sheet = require('../helpers/writer-submit-sheet.cjs');

const MIME = { docx: K.KINDS.paper.mime, pdf: 'application/pdf', gdoc: 'application/vnd.google-apps.document', png: 'image/png' };

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

// Drive as the stand-in holds it: id → { meta, bytes, hold (a promise the bytes wait on) }. Its open is documents/drive.js's in
// shape: the plan, head, then the bytes in pieces, each awaited.
const standIn = () => {
  const files = new Map(), asked = [], ended = [];
  const drive = {
    async open(id, takes, on) {
      asked.push(id);
      const f = files.get(id);
      if (!f) throw new D.Fail('missing');
      const p = D.plan(f.meta, takes);
      await on.head({ kind: p.kind, name: p.name, mime: p.mime, size: p.size });
      try {
        for (let i = 0; i < f.bytes.length; i += 100e3) {
          if (i && f.hold) await f.hold;
          await on.bytes(f.bytes.subarray(i, i + 100e3), i);
        }
      } catch (e) { ended.push({ id, why: e.why }); throw e; }
      return f.bytes.length;
    },
  };
  return { files, asked, ended, drive };
};

const setup = ({ connected = true, picked = [], pick = null } = {}) => {
  const s = sheet(), d = standIn(), store = new Map(), ports = [];
  let n = 0;
  s.picks = [];
  s.ctx.GZ_DRIVE = { ...D, page: { connected: () => connected } };
  s.ctx.GZ_DOC_KINDS = K;
  s.ctx.GZ_DOC_FILES = { client: () => ({ put: async (b) => { store.set(++n, b); return n; }, get: async (r) => store.get(r) }) };
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
  assert.deepEqual(rows(s).map((r) => r.name), ['Field trip.pdf', 'Lab notes.docx'], 'listed at once, the Google Doc named as its export');
  assert.ok(submitOff(s), 'Submit waits while files are read');
  await settle(s, 20);
  assert.ok(submitOff(s), 'still reading');
  release(); await settle(s, 20);
  assert.equal(JSON.stringify(s.picks), JSON.stringify([{ type: 'glaze:google', op: 'pick' }]), 'the Picker is the worker\'s');
  assert.deepEqual(s.d.asked, ['1Pdf', '1GDoc'], 'one at a time, in order');
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

test('a file over 50 MB is refused with the sheet\'s words, and Drive\'s own cap names the file', async () => {
  const s = setup({ picked: [file('1Big', 'Scan.pdf', MIME.pdf), file('1Doc', 'Long.docx', MIME.docx)] });
  s.d.files.set('1Big', { meta: file('1Big', 'Scan.pdf', MIME.pdf, 60e6), bytes: bytes(1) });
  s.d.files.set('1Doc', { meta: file('1Doc', 'Long.docx', MIME.docx, 20e6), bytes: bytes(1) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.equal(rows(s).length, 0);
  assert.equal(err(s), 'Scan.pdf is larger than 50 MB. Long.docx: That file is too large.');
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

test('Cancel mid-download closes the sheet and ends the worker\'s read; Remove ends just that one', async () => {
  let release;
  const s = setup({ picked: [file('1Slow', 'Slow.pdf', MIME.pdf)] });
  s.d.files.set('1Slow', { meta: file('1Slow', 'Slow.pdf', MIME.pdf, 900e3), bytes: bytes(900e3), hold: new Promise((r) => { release = r; }) });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s, 20);
  assert.equal(rows(s)[0].size, 'Reading…', 'progress in its row');
  assert.ok(submitOff(s));
  s.doc.fire(s.doc.querySelector('.gs-foot .gs-btn'), 'click');
  assert.equal(s.doc.querySelector('.gs-layer'), null, 'Cancel closes the sheet at once');
  release(); await settle(s, 20);
  assert.deepEqual(s.d.ended, [{ id: '1Slow', why: 'cancel' }], 'the worker stopped reading');
  assert.equal(s.store.size, 0, 'nothing staged');

  let again;
  const r = setup({ picked: [file('1Slow', 'Slow.pdf', MIME.pdf)] });
  r.d.files.set('1Slow', { meta: file('1Slow', 'Slow.pdf', MIME.pdf, 900e3), bytes: bytes(900e3), hold: new Promise((x) => { again = x; }) });
  await r.open(); r.builds[0].resolve(); await r.flush();
  r.click('.gs-drive'); await settle(r, 20);
  r.click('.gs-att-x');
  again(); await settle(r, 20);
  assert.deepEqual(r.d.ended, [{ id: '1Slow', why: 'cancel' }]);
  assert.equal(rows(r).length, 0); assert.equal(err(r), ''); assert.equal(submitOff(r), false);
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

test('a type Glaze can\'t take, a closed Picker and a sign-in to redo each say so (or nothing) without a request', async () => {
  const s = setup({ picked: [file('1Png', 'Photo.png', MIME.png)] });
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-drive'); await settle(s);
  assert.equal(err(s), 'Photo.png: That file could not be read.');
  assert.deepEqual(s.d.asked, []);
  const closed = setup({ picked: [] });
  await closed.open(); closed.builds[0].resolve(); await closed.flush();
  closed.click('.gs-drive'); await settle(closed);
  assert.equal(err(closed), ''); assert.equal(rows(closed).length, 0);
  const setupFail = setup({ pick: { ok: false, why: 'auth' } });
  await setupFail.open(); setupFail.builds[0].resolve(); await setupFail.flush();
  setupFail.click('.gs-drive'); await settle(setupFail);
  assert.equal(err(setupFail), 'Connect Google Drive again in Settings.');
});
