// Sync to Google Drive in 4.0.1: an item whose file or JSON copy is past one request (documents/drive.js SMALL, 5 MB) never
// goes up or comes down; it stays on the device, marked too large (storage.local driveSyncLarge), and nothing is staged. A
// document that grows past it keeps its last synced copy in Drive untouched, and syncs again once it shrinks. Nothing is
// trashed or deleted for it. Staged transfers (test/documents/drive-transfers.test.js) come back in 4.0.2.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('../../extension/writer/writer-papers.js');
const { standin } = require('../helpers/drive-standin.cjs');
const { MIME, ERRORS } = require('../fixtures/drive/v3.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enc = (s) => new TextEncoder().encode(s);
const MiB = 1 << 20;
// Bytes that differ at every offset, so a chunk out of place shows.
const bytesOf = (n, seed) => { const b = new Uint8Array(n); let x = seed >>> 0 || 1; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = x >>> 24; } return b; };
const textOf = (d) => JSON.stringify(d || null).match(/"text":"([^"]*)"/)?.[1];
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

// chrome.storage.local, in memory.
const memory = () => {
  const m = new Map();
  return {
    m,
    get: async (k) => { const ks = k == null ? [...m.keys()] : Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])); },
    set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) m.delete(x); },
    keys: async () => [...m.keys()],
    replace: async (key, expected, value) => {
      if (JSON.stringify(m.get(key)) !== JSON.stringify(expected)) return false;
      if (value === undefined) m.delete(key); else m.set(key, structuredClone(value));
      return true;
    },
  };
};
// The worker's file store, by SHA-256.
const fileStore = () => {
  const f = new Map();
  return {
    f,
    put: async (bytes, type) => { const hash = sha(bytes); f.set(hash, { bytes: new Uint8Array(bytes), type }); return { hash, size: bytes.length, type }; },
    stat: async (hash) => (f.has(hash) ? { hash, size: f.get(hash).bytes.length, type: f.get(hash).type } : null),
    read: async (hash) => f.get(hash)?.bytes || null,
    own: async (owner, hashes) => ({ missing: hashes.filter((h) => !f.has(h)) }),
  };
};
// The transfer stage: IndexedDB's one object store with string keys, as documents/doc-files.js idb() gives it.
const stageOf = () => {
  const m = new Map(), sorted = (p) => [...m].filter(([k]) => k.startsWith(p)).sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    m,
    get: async (k) => m.get(k), many: async (ks) => ks.map((k) => m.get(k)),
    keys: async (p) => sorted(p).map(([k]) => k), entries: async (p) => sorted(p),
    write: async (puts = [], dels = []) => { for (const [k, v] of puts) m.set(k, v instanceof Uint8Array ? v.slice() : structuredClone(v)); for (const k of dels) m.delete(k); },
  };
};
// What a device keeps between workers: storage, files, the stage, its clock.
const disk = (clock = { t: Date.parse('2026-10-30T12:00:00Z') }) => ({ store: memory(), files: fileStore(), stage: stageOf(), clock });
// A fresh worker: the modules loaded again, over the device's storage.
const fresh = () => {
  for (const f of ['../../extension/documents/drive.js', '../../extension/documents/drive-sync.js', '../../extension/background/drive-store.js']) delete require.cache[require.resolve(f)];
  return { D: require('../../extension/documents/drive.js'), S: require('../../extension/documents/drive-sync.js'), ST: require('../../extension/background/drive-store.js') };
};
const EXT = { paper: '.docx', pdf: '.pdf' };
const worker = (drive, dk, { fetch = drive.fetch, account = 'student@school.edu', snapshot = null, records = false } = {}) => {
  const { D, S, ST } = fresh();
  const now = () => dk.clock.t;
  const papers = P.open(dk.store, now, { versions: () => 40, files: { own: dk.files.own } });
  const log = { alive: 0, stopped: 0 };
  const settings = memory();
  const more = snapshot || records ? ST.create({ area: (n) => (n === 'notes' ? null : n === 'sync' ? settings : dk.store), store: dk.store, hash: async (s) => sha(s), now, snapshot }) : null;
  const env = {
    drive: () => D.create({ fetch, token: async () => 'tok-1', account: async () => account, interactive: false }),
    account: async () => account, store: dk.store,
    papers: { get: papers.get, list: papers.list, save: papers.save, trash: papers.trash, untrash: papers.untrash, keep: papers.keep },
    parts: async () => ({}),
    files: { has: async (h) => !!(await dk.files.stat(h)), put: dk.files.put },
    exportOf: async (key, rec) => {
      const kind = rec.kind || 'paper', name = `${rec.title || 'Untitled'}${EXT[kind]}`;
      if (kind === 'pdf') { const b = await dk.files.read(rec.file?.hash); return b ? { name, mime: MIME.pdf, bytes: b } : null; }
      return { name, mime: MIME.docx, bytes: enc(JSON.stringify(rec.doc)) };
    },
    pack: async () => '', hash: async (s) => sha(s), copyName: (t) => `${t} (Drive copy)`, now,
    sleep: async () => {}, random: () => 0, locks: null, timer: () => () => {},
    stage: dk.stage, alive: () => { log.alive++; return () => { log.stopped++; }; }, more,
  };
  return { sync: S.create(env), papers, log, D, S, ST, more };
};
// A run that must be stopped at `at` (a cut or a hang reached), never ending first: the worker is gone from then on.
const stopped = async (run, at) => {
  const r = await Promise.race([run.then((v) => ({ ended: v }), (e) => ({ ended: e })), at.then(() => ({ stop: true }))]);
  assert.ok(r.stop, `the run ended before its worker stopped: ${JSON.stringify(r.ended)}`);
};
const chunks = (drive, from = 0) => drive.log.slice(from).filter((x) => x.chunk);
const tag = (key) => sha(key).slice(0, 32);
const fileOf = (drive, key, role) => [...drive.files.values()].find((f) => f.meta.appProperties.glaze === role && f.meta.appProperties.key === tag(key));
const moves = async (dk) => (await dk.store.get('driveSyncMoves')).driveSyncMoves || {};
const pdfOn = async (w, dk, key, bytes, title) => {
  const ref = await dk.files.put(bytes, MIME.pdf);
  await w.papers.save(key, { kind: 'pdf', file: ref, size: ref.size, title, named: true });
  return ref;
};
const SMALL = 5 << 20;
const marks = async (dk) => (await dk.store.get('driveSyncLarge')).driveSyncLarge || {};
const staged = (drive, dk, from = 0) => [drive.log.slice(from).filter((x) => x.query?.uploadType === 'resumable' || x.chunk || x.range).length, dk.stage.m.size];
const removals = (drive, from = 0) => drive.log.slice(from).filter((x) => x.method === 'DELETE' || x.patch?.trashed === true);
const of = (drive, key) => [...drive.files.values()].filter((f) => f.meta.appProperties?.key === tag(key));

test('a document whose file or JSON copy is past one request is never sent: it stays here, marked, nothing staged', async () => {
  const drive = standin(), dk = disk(), a = worker(drive, dk);
  const pdf = 'doc:00000000-0000-4000-8000-00000000d001', paper = 'doc:00000000-0000-4000-8000-00000000d002', small = 'doc:00000000-0000-4000-8000-00000000d003';
  await pdfOn(a, dk, pdf, bytesOf(6 * MiB, 3), 'Reader');
  await a.papers.save(paper, { doc: doc(`L${'l'.repeat(6 * MiB)}`), title: 'Long', named: true });
  await a.papers.save(small, { doc: doc('Short'), title: 'Short', named: true });
  assert.ok((await a.sync.set(true)).ok);
  assert.deepEqual(of(drive, pdf), [], 'nothing of the PDF in Drive');
  assert.deepEqual(of(drive, paper), [], 'nothing of the long paper in Drive');
  assert.ok(fileOf(drive, small, 'doc') && fileOf(drive, small, 'file'), 'the rest syncs');
  assert.ok(drive.log.every((x) => !(x.size > SMALL)), 'no request carried more than one request\'s bytes');
  assert.deepEqual(staged(drive, dk), [0, 0], 'nothing staged');
  assert.deepEqual(await moves(dk), {});
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}).sort(), [pdf, paper]);
  assert.ok(P.trashed(await a.papers.get(pdf)) === false && !!await a.papers.get(paper), 'both still here, live');
  assert.ok((await a.sync.run()).ok, 'a later run: still nothing, no error');
  assert.deepEqual(of(drive, pdf), []);
});

test('a document that grows past the limit stops syncing, its last copy in Drive untouched; shrunk, it syncs again', async () => {
  const drive = standin(), dk = disk(), a = worker(drive, dk), key = 'doc:00000000-0000-4000-8000-00000000d004';
  await a.papers.save(key, { doc: doc('Draft'), title: 'Essay', named: true });
  assert.ok((await a.sync.set(true)).ok);
  const was = of(drive, key).map((f) => [f.meta.id, f.meta.headRevisionId, sha(f.bytes)]).sort();
  await a.papers.save(key, { doc: doc(`G${'g'.repeat(6 * MiB)}`) });
  await a.sync.touched(key);
  let n = drive.log.length;
  assert.ok((await a.sync.run()).ok);
  assert.deepEqual(of(drive, key).map((f) => [f.meta.id, f.meta.headRevisionId, sha(f.bytes)]).sort(), was, 'Drive\'s copy as it was');
  assert.deepEqual(staged(drive, dk, n), [0, 0]);
  assert.deepEqual(removals(drive, n), [], 'nothing trashed or deleted');
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}), [key]);
  await a.papers.save(key, { doc: doc('Trimmed') });
  await a.sync.touched(key);
  n = drive.log.length;
  assert.ok((await a.sync.run()).ok);
  assert.equal(textOf(JSON.parse(fileOf(drive, key, 'doc').bytes).record.doc), 'Trimmed', 'up again once it fits');
  assert.equal(fileOf(drive, key, 'file').meta.id, was.find(([id]) => id === fileOf(drive, key, 'file').meta.id)?.[0], 'into its own file');
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}), [], 'no longer marked');
  assert.deepEqual(removals(drive, n), []);
});

test('Drive\'s side past the limit is never brought: the document here stays live, marked, nothing trashed', async () => {
  const drive = standin(), dk = disk(), a = worker(drive, dk), key = 'doc:00000000-0000-4000-8000-00000000d005';
  await pdfOn(a, dk, key, bytesOf(MiB, 5), 'Reader');
  assert.ok((await a.sync.set(true)).ok);
  // Replaced outside Glaze with a file past one request.
  const file = fileOf(drive, key, 'file').meta.id;
  drive.edit(file, bytesOf(6 * MiB, 6));
  let n = drive.log.length;
  assert.ok((await a.sync.run()).ok);
  assert.ok(!drive.log.slice(n).some((x) => x.query?.alt === 'media' && x.path.endsWith(file)), 'its bytes never asked for');
  assert.equal((await a.papers.get(key)).file.size, MiB, 'this device\'s PDF stays');
  assert.ok(!P.trashed(await a.papers.get(key)));
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}), [key]);
  assert.deepEqual(removals(drive, n), []);
  // A second device meeting a document whose JSON copy is past the limit takes nothing and asks for nothing of it.
  const other = 'doc:00000000-0000-4000-8000-00000000d006', folder = [...drive.files.values()].find((f) => f.meta.appProperties?.glaze === 'root').meta.id;
  const copy = drive.seed({ name: 'Huge.glaze.json', mimeType: 'application/json', parents: [folder], appProperties: { glaze: 'doc', key: tag(other), sum: 'e'.repeat(64), rev: '1' } },
    JSON.stringify({ glaze: 'document', v: 1, key: other, kind: 'paper', record: { kind: 'paper', title: 'Huge', doc: doc('h'.repeat(6 * MiB)) }, file: null, fileRev: null, updated: 1 })).meta.id;
  const dk2 = disk(), b = worker(drive, dk2);
  n = drive.log.length;
  assert.ok((await b.sync.set(true)).ok);
  assert.ok(!drive.log.slice(n).some((x) => x.query?.alt === 'media' && x.path.endsWith(copy)), 'the copy never read');
  assert.equal(await b.papers.get(other), null);
  assert.deepEqual(staged(drive, dk2, n), [0, 0]);
  assert.deepEqual(removals(drive, n), []);
});

test('a record past the limit is never sent and one in Drive never brought; the rest sync', async () => {
  const drive = standin(), dk = disk(), a = worker(drive, dk, { records: true });
  const big = 'writer:sources:big|x|y|z', small = 'writer:sources:small|x|y|z';
  const sources = (n, w) => ({ sources: [...Array(n)].map((_, i) => ({ id: `s${i}`, title: w.repeat(3000) })), at: 1 });
  await dk.store.set({ [big]: sources(2000, 'b'), [small]: sources(2, 's') });
  assert.ok((await a.sync.set(true)).ok);
  const recs = [...drive.files.values()].filter((f) => f.meta.appProperties?.glaze === 'rec');
  assert.ok(recs.some((f) => f.meta.appProperties.key === sha(`local\n${small}`).slice(0, 32)), 'the small record went up');
  assert.ok(!recs.some((f) => f.meta.appProperties.key === sha(`local\n${big}`).slice(0, 32)), 'the large one did not');
  assert.ok(drive.log.every((x) => !(x.size > SMALL)));
  assert.deepEqual(Object.keys((await marks(dk)).recs || {}), [`local:${big}`]);
  // Another device's record past the limit, for a key this device lacks: never read.
  const data = [...drive.files.values()].find((f) => f.meta.appProperties?.glaze === 'data').meta.id, theirs = 'writer:sources:theirs|x|y|z', th = sha(`local\n${theirs}`).slice(0, 32);
  const value = sources(2000, 't'), sum = sha(JSON.stringify({ area: 'local', key: theirs, value }));
  const rec = drive.seed({ name: `sources-${th.slice(0, 12)}.json`, mimeType: 'application/json', parents: [data], appProperties: { glaze: 'rec', cat: 'sources', key: th, sum, at: '5' } },
    JSON.stringify({ glaze: 'record', v: 1, cat: 'sources', area: 'local', key: theirs, at: 5, value })).meta.id;
  const n = drive.log.length;
  assert.ok((await worker(drive, dk, { records: true }).sync.run({ full: true })).ok);
  assert.ok(!drive.log.slice(n).some((x) => x.query?.alt === 'media' && x.path.endsWith(rec)), 'never read');
  assert.equal((await dk.store.get(theirs))[theirs], undefined);
  assert.deepEqual(staged(drive, dk), [0, 0]);
});

test('a daily snapshot past the limit is skipped for the day, said so, with nothing staged or sent', async () => {
  const drive = standin(), dk = disk();
  const snapshot = async () => ({ name: 'glaze-backup-2026-10-30.zip', bytes: bytesOf(6 * MiB, 9) });
  const a = worker(drive, dk, { snapshot });
  assert.ok((await a.sync.set(true)).ok);
  assert.ok(![...drive.files.values()].some((f) => f.meta.appProperties?.glaze === 'snapshot'), 'no zip in Backups');
  assert.ok(drive.log.every((x) => !(x.size > SMALL)));
  assert.deepEqual(staged(drive, dk), [0, 0]);
  const st = (await dk.store.get('driveSync')).driveSync;
  assert.equal(st.snapSkip, 'large');
  assert.ok(st.snap > 0, 'tried once today');
  const small = worker(drive, disk(), { snapshot: async () => ({ name: 'glaze-backup-2026-10-30.zip', bytes: bytesOf(MiB, 9) }) });
  assert.ok((await small.sync.set(true)).ok);
  assert.ok([...drive.files.values()].some((f) => f.meta.appProperties?.glaze === 'snapshot'), 'one that fits goes up');
});

test('large-item marks clear when unsynced documents and records are deleted while Sync is off', async () => {
  const drive = standin(), dk = disk(), a = worker(drive, dk, { records: true });
  const key = 'doc:00000000-0000-4000-8000-00000000d007', source = 'writer:sources:gone|x|y|z';
  await pdfOn(a, dk, key, bytesOf(6 * MiB, 7), 'Local reader');
  await dk.store.set({ [source]: { sources: [{ id: 's1', title: 's'.repeat(6 * MiB) }], at: 1 } });
  assert.ok((await a.sync.set(true)).ok);
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}), [key]);
  assert.deepEqual(Object.keys((await marks(dk)).recs || {}), [`local:${source}`]);
  await a.sync.set(false);
  await a.papers.remove(key);
  await dk.store.remove(source);
  // No dirty mark or record link exists for either item. A restarted worker must still discard their size marks.
  const b = worker(drive, dk, { records: true }), n = drive.log.length;
  assert.ok((await b.sync.set(true)).ok);
  assert.deepEqual(await marks(dk), { docs: {}, recs: {} }, 'Settings must not count items no longer on this device');
  assert.deepEqual(removals(drive, n), [], 'size-mark cleanup never deletes anything in Drive');
});

test('a remote deletion clears a linked document size mark after its sync link is removed', async () => {
  const drive = standin(), dk = disk(), a = worker(drive, dk);
  const key = 'doc:00000000-0000-4000-8000-00000000d008';
  await pdfOn(a, dk, key, bytesOf(MiB, 8), 'Reader');
  assert.ok((await a.sync.set(true)).ok);
  await pdfOn(a, dk, key, bytesOf(6 * MiB, 9), 'Reader');
  await a.sync.touched(key);
  assert.ok((await a.sync.run()).ok);
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}), [key]);
  // The user deletes the local document while off, and its JSON copy is independently deleted in Drive.
  await a.sync.set(false);
  await a.papers.remove(key);
  drive.remove(fileOf(drive, key, 'doc').meta.id);
  await dk.store.set({ driveSync: { ...(await dk.store.get('driveSync')).driveSync, on: true } });
  assert.ok((await worker(drive, dk).sync.run()).ok);
  assert.deepEqual(Object.keys((await marks(dk)).docs || {}), [], 'the mark cannot outlive the document and its link');
});
