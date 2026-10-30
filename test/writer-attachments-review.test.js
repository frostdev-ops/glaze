const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('./helpers/writer-submit-sheet.cjs');
const page = require('./helpers/writer-submit-page.cjs');

const setup = () => {
  const s = sheet(), records = new Map(), kept = new Map(), exports = [], reads = [];
  let serial = 0;
  s.ctx.GZ_WRITER_PAPERS = { open: () => ({ get: async (key) => records.get(key) }), trashed: (p) => !!p.trashed };
  s.ctx.GZ_DOC_FILES = { client: () => ({ put: async (bytes, type) => { const hash = String(++serial); kept.set(hash, bytes); return { hash, size: bytes.length, type }; }, get: async (ref) => { reads.push(ref.hash); return kept.get(ref.hash).slice(); } }) };
  s.ctx.GZ_DOC_KINDS = { progress: () => Object.assign(() => {}, { end() {} }), said: () => null };
  s.ctx.GZ_WRITER_KINDS = { kind: async () => ({ file: (key) => new Promise((resolve) => exports.push({ key, resolve })) }) };
  const makeDoc = (key, extra = {}) => { const row = { key, kind: 'pdf', title: key, updated: 1, revision: 1, ...extra }; records.set(key, row); return row; };
  const add = async (row) => { await s.ctx.GZ_WRITER_SUBMIT_SHEET.open(s.api, null, { attach: row }); await s.flush(); };
  const finish = async (i = 0) => { exports[i].resolve({ name: `${exports[i].key}.pdf`, mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }); await s.flush(); };
  return { ...s, records, kept, exports, reads, makeDoc, add, finish };
};

test('picks export one at a time, stage bytes, and send only a manifest until requested', async () => {
  const s = setup(); await s.add(s.makeDoc('first')); await s.add(s.makeDoc('second'));
  assert.equal(s.exports.length, 1);
  await s.finish(); assert.equal(s.exports.length, 2); await s.finish(1);
  s.builds[0].resolve(); await s.flush(); s.click('.gs-primary'); await s.flush();
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(go.files.length, 2); assert.equal(go.stream, true);
  assert.ok(go.files.every((f) => f.size === 3 && !('bytes' in f)));
  assert.equal(s.reads.length, 0);
  await s.handles['submit:file']({ run: go.run, index: 0 });
  assert.equal(s.reads.length, 1);
  assert.equal(s.messages.at(-1).type, 'submit:file');
  assert.deepEqual([...new Uint8Array(s.messages.at(-1).bytes)], [1, 2, 3]);
  s.ctx.GZ_WRITER_SUBMIT_SHEET.close();
});

for (const change of ['deleted', 'trashed', 'edited']) test(`a picked document ${change} before Submit cannot upload`, async () => {
  const s = setup(), row = s.makeDoc('notes'); await s.add(row); await s.finish(); s.builds[0].resolve(); await s.flush();
  if (change === 'deleted') s.records.delete(row.key);
  else s.records.set(row.key, { ...row, ...(change === 'trashed' ? { trashed: 2 } : { revision: 2 }) });
  s.click('.gs-primary'); await s.flush();
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
  assert.match(s.doc.querySelector('.gs-err').textContent, /changed or was deleted/);
});

test('known oversized Documents files are refused before the kind reads any bytes', async () => {
  const s = setup(); await s.add(s.makeDoc('huge', { size: 50e6 + 1 }));
  assert.equal(s.exports.length, 0); assert.equal(s.kept.size, 0);
  assert.match(s.doc.querySelector('.gs-err').textContent, /larger than 50 MB/);
});

test('Cancel during export drops queued picks and never stages or uploads the late result', async () => {
  const s = setup(); await s.add(s.makeDoc('first')); await s.add(s.makeDoc('second'));
  s.click('.gs-foot .gs-btn'); await s.finish();
  assert.equal(s.exports.length, 1); assert.equal(s.kept.size, 0);
  assert.equal(s.messages.some((m) => m.type === 'submit:go'), false);
});

test('a change during hand-in is refused by the final document validation', async () => {
  const s = setup(), row = s.makeDoc('notes'); await s.add(row); await s.finish(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush(); const go = s.messages.find((m) => m.type === 'submit:go');
  s.records.set(row.key, { ...row, revision: 2 });
  await s.handles['submit:file']({ run: go.run, index: 1 });
  assert.equal(s.messages.at(-1).ok, false); assert.equal(s.messages.at(-1).error, 'changed');
});

test('streamed files are requested sequentially and final validation precedes the one native Submit', async () => {
  const p = page(); await p.go({ stream: true, files: [{ name: 'Notes.pdf', mime: 'application/pdf', size: 3 }] });
  assert.equal(p.uploads.length, 1); assert.equal(p.sent.at(-1).index, 0);
  p.hear({ type: 'submit:file', run: 99, index: 0, ok: true, bytes: new Uint8Array([9, 9, 9]).buffer });
  await p.tick(); assert.equal(p.uploads.length, 1, 'stale reply ignored');
  p.hear({ type: 'submit:file', run: 1, index: 0, ok: true, bytes: new Uint8Array([4, 5, 6]).buffer });
  await p.tick(); assert.equal(p.uploads.length, 2); assert.equal(p.clicks.length, 0);
  assert.equal(p.sent.at(-1).index, 1);
  p.hear({ type: 'submit:file', run: 1, index: 1, ok: true }); await p.tick();
  assert.equal(p.clicks.length, 1);
});

test('the actual workbook extension renames the preview and resolves a clash with an attachment', async () => {
  const s = setup(); let preview;
  s.api.kind = () => 'sheet'; s.api.ext = () => '.xlsx';
  s.api.file = () => new Promise((r) => { preview = r; });
  await s.open();
  const mime = 'application/vnd.ms-excel.sheet.macroEnabled.12';
  assert.equal(s.ctx.GZ_WRITER_SUBMIT_SHEET.add({ name: 'Essay2.xlsm', mime, bytes: new Uint16Array([0x1234]) }), true);
  await s.flush();
  preview({ name: 'Budget.xlsm', mime, bytes: new Uint8Array([1, 2]) }); await s.flush();
  assert.equal(s.doc.querySelector('.gs-file .gs-name').textContent, 'Essay2.xlsm');
  assert.equal(s.doc.querySelector('.gs-att .gs-name').textContent, 'Essay2_2.xlsm');
  s.click('.gs-primary'); await s.flush(); preview({ name: 'Budget.xlsm', mime, bytes: new Uint8Array([1, 2]) }); await s.flush();
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.equal(go.name, 'Essay2.xlsm'); assert.equal(go.files[0].name, 'Essay2_2.xlsm');
  assert.equal(go.files[0].mime, mime.toLowerCase(), 'metadata records the type File actually sends');
  await s.handles['submit:file']({ run: go.run, index: 0 });
  assert.deepEqual([...new Uint8Array(s.messages.at(-1).bytes)], [0x34, 0x12]);
});
