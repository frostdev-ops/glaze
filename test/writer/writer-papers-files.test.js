// A PDF's or deck's bytes in the worker's file store (lib/doc-files.js) as lib/writer-papers.js keeps them: records and
// versions point at a hash, the store owns each document's hashes, a file goes with the last document or version that
// points at it, versions keep at most CAP.files of files, and a record from before the store moves over (migrate).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PA = require('../lib/writer-papers.js');
const F = require('../lib/doc-files.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const local = () => {
  const data = {};
  const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return { data, get: async (k) => (k === null ? copy(data) : { [k]: copy(data[k]) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = copy(v); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const bytes = (n, seed = 1) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const make = () => {
  const { indexedDB, IDBKeyRange } = fakeIDB(), clock = { t: 1e12 };
  const files = F.store(F.idb(indexedDB, 'glaze-docs', IDBKeyRange), { now: () => clock.t });
  const store = local();
  const P = PA.open(store, () => clock.t, { versions: () => 40, files });
  const idb = () => indexedDB.dbs.get('glaze-docs').get('files');
  const kept = () => [...idb().keys()].filter((k) => k.startsWith('f:')).map((k) => k.slice(2)).sort();
  return { P, files, store, clock, kept, idb };
};
const key = () => PA.newKey();

test('a PDF record points at its file; Delete forever and purge let it go', async () => {
  const { P, files, store, clock, kept } = make();
  const b = bytes(5e5, 2), file = await files.put(b, 'application/pdf'), k = key();
  await P.save(k, { kind: 'pdf', file, size: file.size, pages: 1, title: 'Form', named: true }, { reason: 'import' });
  assert.deepEqual(store.data[`writerPaper:${k}`].file, file, 'the record holds the ref, not the bytes');
  assert.ok(JSON.stringify(store.data).length < 2000, 'no bytes in storage.local');
  assert.deepEqual(kept(), [file.hash]);
  clock.t += F.HOLD + 1;
  await P.remove(k);
  assert.deepEqual(kept(), [], 'Delete forever drops the file');
  // Trash, then 30 days on: purge.
  const k2 = key(), f2 = await files.put(bytes(1000, 3), 'application/pdf');
  await P.save(k2, { kind: 'pdf', file: f2, size: f2.size, pages: 1 }, { reason: 'import' });
  await P.trash(k2);
  clock.t += PA.CAP.trash + F.HOLD + 2;
  assert.deepEqual(await P.purge(), [k2]);
  assert.deepEqual(kept(), []);
});

test('a copy shares the file; it goes only with the last document pointing at it', async () => {
  const { P, files, clock, kept } = make();
  const file = await files.put(bytes(2000, 4), 'application/pdf'), a = key();
  const { paper } = await P.save(a, { kind: 'pdf', file, size: file.size, pages: 1, title: 'A', named: true }, { reason: 'import' });
  const c = PA.copyOf(paper, 'A copy', clock.t);
  await P.save(c.key, c, { reason: 'import' });
  clock.t += F.HOLD + 1;
  await P.remove(a);
  assert.deepEqual(kept(), [file.hash], 'the copy still holds it');
  await P.remove(c.key);
  assert.deepEqual(kept(), []);
});

test('a filled PDF saved over its file: the old file stays while a version points at it, then goes with it', async () => {
  const { P, files, clock, kept, store } = make();
  const k = key(), f1 = await files.put(bytes(3000, 5), 'application/pdf');
  await P.save(k, { kind: 'pdf', file: f1, size: f1.size, pages: 1 }, { reason: 'import' });
  // The submit's version holds f1.
  await P.save(k, {}, { reason: 'submit', expectedKind: 'pdf' });
  const f2 = await files.put(bytes(3000, 6), 'application/pdf');
  clock.t += F.HOLD + 1;
  await P.save(k, { file: f2, size: f2.size }, { expectedKind: 'pdf' });
  assert.deepEqual(kept(), [f1.hash, f2.hash].sort(), 'f1 is the submitted version\'s');
  const f3 = await files.put(bytes(3000, 7), 'application/pdf');
  clock.t += F.HOLD + 1;
  await P.save(k, { file: f3, size: f3.size }, { expectedKind: 'pdf' });
  assert.deepEqual(kept(), [f1.hash, f3.hash].sort(), 'f2: no version kept it (an autosave keeps none)');
  assert.ok(store.data[`writerVersions:${k}`].some((v) => v.reason === 'submit' && v.file.hash === f1.hash));
});

test('a save pointing at a file the store does not have is refused, and nothing is written', async () => {
  const { P, store } = make();
  const k = key();
  await assert.rejects(P.save(k, { kind: 'pdf', file: { hash: 'a'.repeat(64), size: 10, type: 'application/pdf' }, size: 10, pages: 1 }, { reason: 'import' }), /file missing/);
  assert.equal(store.data[`writerPaper:${k}`], undefined);
  // Without a store (a page's own open, or a worker that couldn't open it), a ref is refused too.
  const bare = PA.open(local(), () => 1);
  await assert.rejects(bare.save(k, { kind: 'pdf', file: { hash: 'a'.repeat(64), size: 10, type: 'application/pdf' } }, { reason: 'import' }), /file storage unavailable/);
});

test('a record whose file went missing can still take a new one (Re-import)', async () => {
  const { P, files, idb, clock } = make();
  const k = key(), f1 = await files.put(bytes(100, 8), 'application/pdf');
  await P.save(k, { kind: 'pdf', file: f1, size: f1.size, pages: 1 }, { reason: 'import' });
  for (const x of [...idb().keys()]) idb().delete(x); // the site's data cleared
  const f2 = await files.put(bytes(100, 9), 'application/pdf');
  clock.t += 1;
  const { paper } = await P.save(k, { kind: 'pdf', file: f2, size: f2.size, pages: 1 }, { reason: 'import', expectedKind: 'pdf' });
  assert.equal(paper.file.hash, f2.hash);
});

test('two PDF editors saving from the same revision keep the overwritten file as a conflict version', async () => {
  const { P, files, store, clock } = make(), k = key();
  const first = await files.put(bytes(100, 41), 'application/pdf');
  await P.save(k, { kind: 'pdf', doc: null, file: first, size: first.size, pages: 1 }, { reason: 'import' });
  const other = PA.open(store, () => clock.t, { files });
  await other.get(k);
  const a = await files.put(bytes(100, 42), 'application/pdf');
  const b = await files.put(bytes(100, 43), 'application/pdf');
  await P.save(k, { file: a }, { expectedKind: 'pdf' });
  clock.t++;
  await other.save(k, { file: b }, { expectedKind: 'pdf' });
  assert.equal(store.data[`writerPaper:${k}`].file.hash, b.hash);
  assert.ok(store.data[`writerVersions:${k}`].some((v) => v.reason === 'conflict' && v.file.hash === a.hash), 'the other editor did not lose its filled form');
});

test('versions keep at most CAP.files bytes of files, the submitted one and the newest always', async () => {
  const { P, files, clock, store } = make();
  assert.equal(PA.CAP.files, 200e6);
  const k = key(), big = 60e6;
  // Refs for files this size without making them: the store is asked only about the fresh one each save brings.
  const fake = (i) => ({ hash: sha(Buffer.from(String(i))), size: big, type: 'application/pdf' });
  const real = files.own;
  files.own = async (owner, hs, o) => ({ missing: [] });
  try {
    await P.save(k, { kind: 'pdf', file: fake(0), size: big, pages: 1 }, { reason: 'import' });
    await P.save(k, {}, { reason: 'submit', expectedKind: 'pdf' });
    for (let i = 1; i <= 6; i++) { clock.t += 1000; await P.save(k, { kind: 'pdf', file: fake(i), size: big, pages: 1 }, { reason: 'import', expectedKind: 'pdf' }); }
  } finally { files.own = real; }
  const list = store.data[`writerVersions:${k}`];
  const sizes = new Map(list.map((v) => [v.file.hash, v.file.size]));
  assert.ok([...sizes.values()].reduce((n, x) => n + x, 0) <= PA.CAP.files + big, `files in versions: ${[...sizes.values()].reduce((n, x) => n + x, 0)}`);
  assert.ok(list.some((v) => v.reason === 'submit' && v.file.hash === fake(0).hash), 'the submitted version stays');
  assert.equal(list.sort((a, b) => b.at - a.at)[0].file.hash, fake(5).hash, 'the newest stays');
});

test('migrate: a base64 record and its versions move to the store, the same document, once', async () => {
  const { P, store, kept, files } = make();
  const k = key(), pdf = bytes(2e6, 10), old = bytes(1e6, 11), b64 = (b) => Buffer.from(b).toString('base64');
  // As 4.0.0 before the store kept it: base64 in the record and in a version.
  store.data[`writerPaper:${k}`] = { key: k, kind: 'pdf', file: b64(pdf), size: pdf.length, pages: 2, title: 'Old', named: true, created: 5, updated: 7, revision: 3, edited: 3 };
  store.data[`writerVersions:${k}`] = [{ id: 'a-1', at: 6, reason: 'import', kind: 'pdf', file: b64(old), size: old.length, pages: 1, bytes: 1.4e6 }, { id: 'a-2', at: 5, reason: 'submit', kind: 'pdf', file: b64(pdf), size: pdf.length, pages: 2, bytes: 2.7e6 }];
  store.data.writerPapers = [{ key: k, kind: 'pdf', title: 'Old', updated: 7 }];
  assert.deepEqual(await P.migrate(k), { moved: 3 });
  const rec = store.data[`writerPaper:${k}`];
  assert.deepEqual(rec.file, { hash: sha(pdf), size: pdf.length, type: 'application/pdf' });
  assert.deepEqual([rec.revision, rec.updated, rec.title], [3, 7, 'Old'], 'revision and Last edited unchanged');
  const list = store.data[`writerVersions:${k}`];
  assert.deepEqual(list.map((v) => v.file.hash), [sha(old), sha(pdf)]);
  assert.ok(list.every((v) => v.bytes < 1000), 'a moved version counts what it holds now');
  assert.deepEqual(kept(), [sha(old), sha(pdf)].sort(), 'the same bytes kept once');
  assert.deepEqual(await P.migrate(k), { moved: 0 }, 'again: nothing left to move');
  const back = new Uint8Array(pdf.length);
  let at = 0;
  await files.read(rec.file.hash, (c) => { back.set(c, at); at += c.length; });
  assert.equal(sha(back), sha(pdf));
});

test('migrate: a store that refuses leaves the base64 record as it was, still readable', async () => {
  const { P, store, files } = make();
  const k = key(), pdf = bytes(1000, 12);
  const rec = { key: k, kind: 'slides', file: Buffer.from(pdf).toString('base64'), size: pdf.length, ext: '.pptx', slides: 1, created: 1, updated: 2, revision: 1 };
  store.data[`writerPaper:${k}`] = structuredClone(rec);
  files.put = async () => { throw F.fail('quota'); };
  await assert.rejects(P.migrate(k), (e) => e.why === 'quota');
  assert.deepEqual(store.data[`writerPaper:${k}`], rec);
  // A record with damaged base64 stays as it is.
  const k2 = key();
  store.data[`writerPaper:${k2}`] = { ...rec, key: k2, file: 'not base64!' };
  assert.deepEqual(await P.migrate(k2), { moved: 0 });
});

test('a page\'s papers proxy asks the worker to migrate', async () => {
  const sent = [];
  globalThis.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, value: { moved: 0 } }; } }, storage: { local: local() } };
  try {
    const P = PA.open();
    assert.deepEqual(await P.migrate('doc:x'), { moved: 0 });
    assert.deepEqual(sent.map((m) => [m.type, m.op, m.args]), [['glaze:writerPapers', 'migrate', ['doc:x']]]);
    assert.equal(P.reown, undefined, 'owners are the worker\'s');
  } finally { delete globalThis.chrome; }
});
