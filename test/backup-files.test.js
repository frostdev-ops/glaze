// Back up… and Restore with Documents' files in the worker's store (lib/doc-files.js): a record pointing at its file goes
// into the backup as filePapers with the file beside it (papers/<n>.bin), Restore puts the file back before its record,
// a backup made before the store (base64 in the record) still restores and then moves over, and what a reader from before
// the store sees of a new backup.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const B = require('../lib/backup.js');
const Z = require('../lib/zip.js');
const F = require('../lib/doc-files.js');
const PA = require('../lib/writer-papers.js');
const D = require('../defaults.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const NOW = Date.now() - 60000;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const bytes = (n, seed = 1) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const SETTINGS = { ...D.GZ_SANITIZE(), cards: {}, links: {}, folders: {} };
const device = () => {
  const store = {}, { indexedDB, IDBKeyRange } = fakeIDB();
  const local = {
    get: async (k) => structuredClone(k === null ? store : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]))),
    set: async (o) => { Object.assign(store, structuredClone(o)); return true; },
    remove: async (ks) => { for (const k of [].concat(ks)) delete store[k]; return true; },
  };
  const clock = { t: NOW };
  const files = F.store(F.idb(indexedDB, 'glaze-docs', IDBKeyRange), { now: () => clock.t });
  const P = PA.open(local, () => clock.t, { files });
  const get = async (f) => { const out = new Uint8Array(f.size); let at = 0; await files.read(f.hash, (c) => { out.set(c, at); at += c.length; }); return out; };
  return { store, local, files, P, get, clock };
};
const backUp = async (dev) => {
  const local = await dev.local.get(null);
  const files = await B.filesOf(local, dev.get);
  const entries = B.pack({ settings: SETTINGS, tasks: {}, local, version: '9.9.9', files });
  const zip = new Uint8Array(await new Blob(Z.zip(entries)).arrayBuffer());
  return { file: { name: 'glaze-backup-2026-10-30.zip', size: zip.length, type: 'application/zip', arrayBuffer: async () => zip.slice().buffer }, entries };
};
const ioFor = (dev, o = {}) => {
  const steps = [];
  const sync = { get: async () => ({}), set: async () => true, remove: async () => true };
  return {
    begin: async () => {}, abort: async () => {},
    own: async (value) => { steps.push({ action: 'own', value }); return { ok: true }; },
    settings: async () => ({ ok: true }), send: async () => ({ ok: true }),
    put: o.put || ((b, type) => dev.files.put(b, type)),
    finish: async () => {
      const out = await B.atomic(steps, { local: dev.local, sync, files: dev.files, sessions: () => ({ handle: async () => ({ ok: true }), stop() {} }), settings: async () => ({ ok: true }) });
      // As the worker does once a restore commits (lib/background.js): each document moved over and its files owned.
      if (out.ok) for (const k of new Set(steps.flatMap((s) => Object.keys(s.value.papers || {})).filter((n) => /^writer(?:Paper|Versions):/.test(n)).map((n) => n.replace(/^writer(?:Paper|Versions):/, '')))) { await dev.P.migrate(k); await dev.P.reown(k); }
      return out;
    },
  };
};
// A 12 MB PDF filled once (its first file a version), and a deck.
const seeded = async (a) => {
  const pdf = PA.newKey(), deck = PA.newKey();
  const first = bytes(12e6, 2), filled = bytes(12e6 + 500, 3), slides = bytes(8e6, 4);
  const f1 = await a.files.put(first, 'application/pdf');
  await a.P.save(pdf, { kind: 'pdf', doc: null, file: f1, size: f1.size, pages: 400, title: 'Big form', named: true }, { reason: 'import' });
  await a.P.save(pdf, {}, { reason: 'submit', expectedKind: 'pdf' });
  const f2 = await a.files.put(filled, 'application/pdf');
  await a.P.save(pdf, { file: f2, size: f2.size }, { expectedKind: 'pdf' });
  const f3 = await a.files.put(slides, F.TYPES['.pptx']);
  await a.P.save(deck, { kind: 'slides', doc: null, file: f3, size: f3.size, ext: '.pptx', slides: 3, text: 'MARK-DECK', words: 1, title: 'Deck', named: true }, { reason: 'import' });
  return { pdf, deck, first, filled, slides };
};

test('Back up writes each file once beside its record; Restore puts them back before the records', { timeout: 120000 }, async () => {
  const a = device(), b = device();
  const { pdf, deck, first, filled, slides } = await seeded(a);
  const { file, entries } = await backUp(a);
  const m = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === B.MANIFEST).data));
  assert.deepEqual(m.blobs.map((x) => x.hash).sort(), [sha(first), sha(filled), sha(slides)].sort(), 'each file once');
  assert.ok(m.blobs.every((x) => /^papers\/\d+\.bin$/.test(x.file) && entries.find((e) => e.name === x.file).data.length === x.size));
  assert.deepEqual(m.filePapers.map((r) => r.key).sort(), [`writerPaper:${pdf}`, `writerVersions:${pdf}`, `writerPaper:${deck}`].sort());
  assert.ok(!(m.papers || []).some((r) => [pdf, deck].some((k) => r.key.endsWith(k))), 'records pointing at files are not in papers');
  const plan = await B.read(file);
  const out = await B.restore(plan, new Set(['papers']), ioFor(b));
  assert.deepEqual(out.failed, []);
  assert.deepEqual(b.store[`writerPaper:${pdf}`], a.store[`writerPaper:${pdf}`]);
  assert.deepEqual(b.store[`writerVersions:${pdf}`].map((v) => v.file.hash), a.store[`writerVersions:${pdf}`].map((v) => v.file.hash));
  assert.equal(sha(await b.get(b.store[`writerPaper:${pdf}`].file)), sha(filled));
  assert.equal(sha(await b.get(b.store[`writerVersions:${pdf}`].find((v) => v.reason === 'submit').file)), sha(first), 'the submitted version\'s file');
  assert.equal(sha(await b.get(b.store[`writerPaper:${deck}`].file)), sha(slides));
  // Owned: deleting the deck there takes its file.
  b.clock.t += F.HOLD + 1;
  await b.P.remove(deck);
  await assert.rejects(b.get({ hash: sha(slides), size: slides.length }), (e) => e.why === 'missing');
});

test('a file whose bytes are not what the backup says refuses the papers, and writes no record', async () => {
  const a = device(), b = device();
  const { pdf } = await seeded(a);
  const { entries } = await backUp(a);
  const m = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === B.MANIFEST).data));
  const bin = entries.find((e) => e.name === m.blobs[0].file);
  bin.data = bin.data.slice(); bin.data[100] ^= 1;
  const zip = new Uint8Array(await new Blob(Z.zip(entries)).arrayBuffer());
  const plan = await B.read({ name: 'b.zip', size: zip.length, type: 'application/zip', arrayBuffer: async () => zip.slice().buffer });
  const out = await B.restore(plan, new Set(['papers']), ioFor(b));
  assert.deepEqual(out.failed, ['papers']);
  assert.equal(b.store[`writerPaper:${pdf}`], undefined);
});

test('a store that refuses (unavailable, quota) on the restoring device fails the papers plainly', async () => {
  const a = device(), b = device();
  await seeded(a);
  const plan = await B.read((await backUp(a)).file);
  const out = await B.restore(plan, new Set(['papers']), ioFor(b, { put: async () => { throw F.fail('quota'); } }));
  assert.deepEqual(out.failed, ['papers']);
  assert.equal(out.changed, false);
});

test('a file missing here at backup time leaves it out; its record restores, as missing', async () => {
  const a = device(), b = device();
  const { deck } = await seeded(a);
  const gone = a.store[`writerPaper:${deck}`].file.hash;
  const local = await a.local.get(null);
  const files = await B.filesOf(local, async (f) => { if (f.hash === gone) throw F.fail('missing'); return a.get(f); });
  assert.ok(!files.has(gone) && files.size === 2);
  const entries = B.pack({ settings: SETTINGS, tasks: {}, local, files });
  const zip = new Uint8Array(await new Blob(Z.zip(entries)).arrayBuffer());
  const plan = await B.read({ name: 'b.zip', size: zip.length, type: 'application/zip', arrayBuffer: async () => zip.slice().buffer });
  assert.deepEqual((await B.restore(plan, new Set(['papers']), ioFor(b))).failed, []);
  assert.equal(b.store[`writerPaper:${deck}`].file.hash, gone);
  await assert.rejects(b.get(b.store[`writerPaper:${deck}`].file), (e) => e.why === 'missing');
  // Any other refusal while reading the files is the backup's.
  await assert.rejects(B.filesOf(local, async () => { throw F.fail('unavailable'); }), (e) => e.why === 'unavailable');
});

test('a backup from before the store (base64 in the record) restores, and its file moves into the store', async () => {
  const a = device(), b = device();
  const k = PA.newKey(), pdf = bytes(2e6, 9);
  a.store[`writerPaper:${k}`] = { key: k, kind: 'pdf', doc: null, file: Buffer.from(pdf).toString('base64'), size: pdf.length, pages: 2, title: 'Old', named: true, created: NOW, updated: NOW, revision: 1 };
  a.store.writerPapers = [{ key: k, kind: 'pdf', title: 'Old', named: true, updated: NOW }];
  const { file, entries } = await backUp(a);
  const m = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === B.MANIFEST).data));
  assert.equal(m.filePapers, undefined, 'nothing points at the store');
  assert.ok(m.papers.some((r) => r.key === `writerPaper:${k}`));
  const out = await B.restore(await B.read(file), new Set(['papers']), ioFor(b));
  assert.deepEqual(out.failed, []);
  assert.deepEqual(b.store[`writerPaper:${k}`].file, { hash: sha(pdf), size: pdf.length, type: 'application/pdf' });
  assert.equal(sha(await b.get(b.store[`writerPaper:${k}`].file)), sha(pdf));
});

test('a reader from before the store sees only base64 records in papers, and no file in them', async () => {
  const a = device();
  await seeded(a);
  const legacy = PA.newKey();
  a.store[`writerPaper:${legacy}`] = { key: legacy, kind: 'pdf', doc: null, file: 'JVBERi0xLjQK', size: 9, pages: 1, created: NOW, updated: NOW, revision: 1 };
  const { entries } = await backUp(a);
  const m = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === B.MANIFEST).data));
  for (const row of m.papers) {
    const v = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === row.file).data));
    for (const x of Array.isArray(v) ? v : [v]) assert.ok(x.file === undefined || typeof x.file === 'string', `${row.key} holds no ref`);
  }
  assert.ok(m.papers.some((r) => r.key === `writerPaper:${legacy}`));
  assert.ok(entries.filter((e) => e.name.endsWith('.bin')).every((e) => e.data.length <= 64 << 20), 'every file within what any reader takes per entry');
});

test('a reader from before the store refuses a backup whose documents it would silently omit', async () => {
  const a = device();
  await seeded(a);
  // The immutable main revision merged into this lane: the 4.0.0 reader before the file store.
  const oldSource = execFileSync('git', ['show', '8434813b:lib/backup.js'], { cwd: __dirname, encoding: 'utf8' });
  const old = { exports: {} };
  vm.runInNewContext(oldSource, { module: old, require: (p) => require(`../lib/${p}`), Blob, TextEncoder, TextDecoder, Uint8Array, DataView, URL });
  const { file } = await backUp(a);
  await assert.rejects(old.exports.read(file), (e) => e.why === 'newer');
  assert.ok((await B.read(file)).cats.papers, 'the store-aware reader still takes every document');
  const options = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  assert.match(options, /newer:.*Update Glaze to restore it\./, 'the old reader gives its existing update instruction');
});

test('files that cannot fit one backup are refused before any is read', async () => {
  const local = {};
  for (let i = 0; i < 11; i++) local[`writerPaper:${PA.newKey()}`] = { kind: 'pdf', file: { hash: sha(Buffer.from([i])), size: 50e6, type: 'application/pdf' } };
  let reads = 0;
  await assert.rejects(B.filesOf(local, async () => { reads++; return new Uint8Array(0); }), (e) => e.why === 'big');
  assert.equal(reads, 0);
});

test('a refused restore cannot delete a live version file while replaying overlays', async () => {
  const a = device(), k = PA.newKey();
  const old = await a.files.put(bytes(100, 71), 'application/pdf');
  const current = await a.files.put(bytes(100, 72), 'application/pdf');
  const incoming = await a.files.put(bytes(100, 73), 'application/pdf');
  const { paper } = await a.P.save(k, { kind: 'pdf', doc: null, file: current, size: current.size, pages: 1 }, { reason: 'import' });
  const history = Array.from({ length: 40 }, (_, i) => ({ id: `v-${i}`, at: NOW - i - 1, reason: 'import', kind: 'pdf', doc: null,
    file: i === 39 ? old : current, size: 100, pages: 1, bytes: 200 }));
  a.store[`writerVersions:${k}`] = history;
  await a.P.reown(k);
  a.clock.t += F.HOLD + 1;
  const before = structuredClone(a.store);
  const steps = [{ action: 'own', value: { papers: { [`writerPaper:${k}`]: { ...paper, file: incoming, updated: NOW - 100 } } } },
    { action: 'settings', value: {} }];
  const out = await B.atomic(steps, { local: a.local, sync: a.local, files: a.files, settings: async () => ({ ok: false, error: 'write' }) });
  assert.equal(out.ok, false);
  assert.deepEqual(a.store, before, 'the live records and versions did not change');
  assert.equal(sha(await a.get(old)), old.hash, 'the live version still has its bytes');
});
