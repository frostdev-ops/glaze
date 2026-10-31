// Sync to Google Drive's transfers that outlive one worker (extension/documents/drive.js put and part, extension/documents/
// drive-sync.js, extension/background/drive-store.js): Safari unloads the worker about 30 s after its last event and Chrome
// stops one whose fetch waits 30 s, so a large upload goes in chunks through a resumable session whose address, offset and
// content hash stay in storage, a large download comes by ranges into a stage that outlives the worker, and neither holds
// back the rest of a run. Each "worker" here is a fresh load of the modules over the same storage and stage; a stopped
// one is a request that never answers (test/helpers/drive-standin.cjs cut, or a fetch that hangs).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const P = require('../../extension/writer/writer-papers.js');
const { standin } = require('../helpers/drive-standin.cjs');
const { MIME } = require('../fixtures/drive/v3.js');

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
const worker = (drive, dk, { fetch = drive.fetch, account = 'student@school.edu', snapshot = null } = {}) => {
  const { D, S, ST } = fresh();
  const now = () => dk.clock.t;
  const papers = P.open(dk.store, now, { versions: () => 40, files: { own: dk.files.own } });
  const log = { alive: 0, stopped: 0 };
  const settings = memory();
  const more = snapshot ? ST.create({ area: (n) => (n === 'notes' ? null : n === 'sync' ? settings : dk.store), store: dk.store, hash: async (s) => sha(s), now, snapshot }) : null;
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
  return { sync: S.create(env), papers, log, D, S, ST };
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

test('a worker stopped mid-chunk: the next one asks Drive where the session stands and goes on from there', async () => {
  const drive = standin(), dk = disk(), key = 'doc:00000000-0000-4000-8000-00000000a001', big = bytesOf(20 * MiB, 7);
  const a = worker(drive, dk);
  await pdfOn(a, dk, key, big, 'Reader');
  // The second chunk: Drive keeps 3 MiB of it, and the worker is gone before it answers.
  const second = drive.cut(3 * MiB, (e) => e.chunk && !e.chunk.status && e.chunk.from > 0);
  await stopped(a.sync.set(true), second);
  const first = chunks(drive);
  assert.equal(first[0].chunk.from, 0);
  assert.ok(first[0].chunk.to + 1 >= 256 << 10 && (first[0].chunk.to + 1) % (256 << 10) === 0, 'chunks are multiples of 256 KiB');
  const kept = first[1].chunk.from + 3 * MiB;
  assert.ok(Object.values(await moves(dk)).some((t) => t.session?.uri && t.session.at === first[1].chunk.from), 'the session and its confirmed offset are in storage');
  const sessions = drive.log.filter((x) => x.query.uploadType === 'resumable' && x.method !== 'PUT').length;

  const n = drive.log.length, b = worker(drive, dk);
  assert.ok((await b.sync.run()).ok);
  const next = chunks(drive, n);
  assert.equal(next[0].chunk.status, true, 'it asks first: Content-Range bytes */N');
  assert.equal(next[1].chunk.from, kept, 'and sends from the byte Drive says it has');
  assert.equal(drive.log.filter((x) => x.query.uploadType === 'resumable' && x.method !== 'PUT').length, sessions, 'the same session, no new one');
  const sent = next.filter((x) => !x.chunk.status).reduce((s, x) => s + x.chunk.to - x.chunk.from + 1, 0);
  assert.equal(sent, big.length - kept, 'no byte Drive had is sent again');
  const file = fileOf(drive, key, 'file');
  assert.equal(sha(file.bytes), sha(big), 'the file in Drive is the PDF, whole');
  assert.equal(JSON.parse(fileOf(drive, key, 'doc').bytes).file, file.meta.id, 'and its JSON copy names it');
  assert.deepEqual(await moves(dk), {}, 'nothing left on its way');
  assert.deepEqual([...dk.stage.m.keys()], [], 'the stage emptied');
  assert.ok(b.log.alive >= 1 && b.log.alive === b.log.stopped, 'kept alive while it sent, and let go after');
});

test('a download stopped part way goes on by range in the next worker; a file replaced meanwhile starts over', async () => {
  for (const replaced of [false, true]) {
    const drive = standin(), da = disk(), db = disk(da.clock), key = 'doc:00000000-0000-4000-8000-00000000a002', big = bytesOf(20 * MiB, 11);
    const a = worker(drive, da);
    await pdfOn(a, da, key, big, 'Reader');
    assert.ok((await a.sync.set(true)).ok);
    const id = fileOf(drive, key, 'file').meta.id;
    // B joins; its worker stops while the second range is on its way.
    let ranges = 0, hang, cut = null;
    const reached = new Promise((r) => { hang = r; });
    const fetch = (u, init = {}) => (init.headers?.range && ++ranges === 2 ? (cut = init.headers.range, hang(), new Promise(() => {})) : drive.fetch(u, init));
    await stopped(worker(drive, db, { fetch }).sync.set(true), reached);
    const got = drive.log.filter((x) => x.range);
    assert.equal(got.length, 1, 'one range came before the worker stopped');
    assert.equal(got[0].range.from, 0);
    const at = Number(/^bytes=(\d+)-/.exec(cut)[1]);
    assert.equal(at, got[0].range.to + 1, 'the first range kept: the next asked from its end');
    const edited = bytesOf(20 * MiB, 13);
    if (replaced) drive.edit(id, edited);
    const n = drive.log.length, b = worker(drive, db);
    assert.ok((await b.sync.run()).ok);
    const more = drive.log.slice(n).filter((x) => x.range);
    assert.equal(more[0].range.from, replaced ? 0 : at, replaced ? 'a new revision: from the start' : 'from where the stage stopped');
    const rec = await b.papers.get(key);
    assert.equal(rec?.file?.hash, sha(replaced ? edited : big), 'the PDF whole, as Drive holds it');
    assert.equal(sha(await db.files.read(rec.file.hash)), sha(replaced ? edited : big));
    assert.deepEqual(await moves(db), {});
    assert.deepEqual([...db.stage.m.keys()], [], 'the stage emptied');
  }
});

test('an expired session starts over; a stored session address that isn\'t Drive\'s upload address is never used', async () => {
  for (const how of ['expired', 'elsewhere']) {
    const drive = standin(), dk = disk(), key = 'doc:00000000-0000-4000-8000-00000000a003', big = bytesOf(12 * MiB, 17);
    const a = worker(drive, dk);
    await pdfOn(a, dk, key, big, 'Reader');
    await stopped(a.sync.set(true), drive.cut(0, (e) => e.chunk && !e.chunk.status && e.chunk.from > 0));
    if (how === 'expired') drive.expire();
    else {
      const m = await moves(dk), slot = Object.keys(m).find((k) => m[k].session);
      m[slot].session.uri = m[slot].session.uri.replace('https://www.googleapis.com/', 'https://uploads.example.com/');
      await dk.store.set({ driveSyncMoves: m });
    }
    const urls = [], n = drive.log.length;
    const b = worker(drive, dk, { fetch: (u, init) => { urls.push(String(u)); return drive.fetch(u, init); } });
    assert.ok((await b.sync.run()).ok);
    assert.ok(urls.every((u) => u.startsWith('https://www.googleapis.com/')), `nothing sent anywhere else: ${urls.filter((u) => !u.startsWith('https://www.googleapis.com/'))}`);
    const after = drive.log.slice(n);
    assert.equal(after.filter((x) => x.query.uploadType === 'resumable' && x.method !== 'PUT').length, 1, `${how}: a new session`);
    assert.equal(after.filter((x) => x.chunk && !x.chunk.status)[0].chunk.from, 0, 'from the first byte');
    assert.equal(sha(fileOf(drive, key, 'file').bytes), sha(big));
    assert.equal(drive.log.filter((x) => x.upload?.size === big.length).length, 1, 'landed once');
  }
});

test('a big transfer on its way holds back neither a small document nor the change token', async () => {
  const drive = standin(), da = disk(), db = disk(da.clock);
  const big = 'doc:00000000-0000-4000-8000-00000000a004', small = 'doc:00000000-0000-4000-8000-00000000a005';
  const big2 = 'doc:00000000-0000-4000-8000-00000000a006', small2 = 'doc:00000000-0000-4000-8000-00000000a007';
  // Uploads: A's worker stops in its big PDF's second chunk; the small paper went up all the same.
  const a = worker(drive, da);
  await pdfOn(a, da, big, bytesOf(20 * MiB, 19), 'Reader');
  await a.papers.save(small, { doc: doc('A small paper'), title: 'Small', named: true });
  await stopped(a.sync.set(true), drive.cut(0, (e) => e.chunk && !e.chunk.status && e.chunk.from > 0));
  assert.ok(fileOf(drive, small, 'file') && fileOf(drive, small, 'doc'), 'the small paper is in Drive');
  assert.ok(!fileOf(drive, big, 'file'), 'the PDF still on its way');
  assert.ok((await worker(drive, da).sync.run()).ok);
  assert.ok(fileOf(drive, big, 'file') && fileOf(drive, big, 'doc'), 'the next worker lands it');
  // Downloads: B, already joined, hears of another big PDF and a small paper through the change list; its worker stops in
  // the PDF's first range, after the change token has moved past both.
  assert.ok((await worker(drive, db).sync.set(true)).ok);
  const a2 = worker(drive, da);
  await pdfOn(a2, da, big2, bytesOf(20 * MiB, 29), 'Second reader');
  await a2.papers.save(small2, { doc: doc('Another small paper'), title: 'Small 2', named: true });
  await a2.sync.touched(big2); await a2.sync.touched(small2);
  assert.ok((await a2.sync.run({ push: true })).ok);
  assert.ok(fileOf(drive, big2, 'doc') && fileOf(drive, small2, 'doc'));
  const before = (await db.store.get('driveSync')).driveSync.token;
  let hang;
  const reached = new Promise((r) => { hang = r; });
  const fetch = (u, init = {}) => (init.headers?.range ? (hang(), new Promise(() => {})) : drive.fetch(u, init));
  await stopped(worker(drive, db, { fetch }).sync.run(), reached);
  const b1 = worker(drive, db);
  assert.equal(textOf((await b1.papers.get(small2))?.doc), 'Another small paper', 'the small paper came in');
  assert.notEqual((await db.store.get('driveSync')).driveSync.token, before, 'the change token moved past both');
  assert.ok(Object.values(await moves(db)).some((t) => t.dir === 'down'), 'the PDF remembered as on its way');
  assert.equal(await b1.papers.get(big2), null, 'not yet here');
  assert.ok((await b1.sync.run()).ok);
  const rec = await b1.papers.get(big2);
  assert.equal(sha(await db.files.read(rec.file.hash)), sha(bytesOf(20 * MiB, 29)), 'the next worker brings it in whole');
  assert.deepEqual(await moves(db), {});
});

test('a daily snapshot too big for one worker lands over three runs, built once', async () => {
  const drive = standin(), dk = disk(), zip = bytesOf(20 * MiB, 23);
  let made = 0;
  const snapshot = async () => { made++; return { name: 'glaze-backup-2026-10-30.zip', bytes: zip }; };
  const cutSecond = () => { let n = 0; return drive.cut(0, (e) => e.chunk && !e.chunk.status && ++n === 2); };
  await stopped(worker(drive, dk, { snapshot }).sync.set(true), cutSecond());
  const sessions = () => drive.log.filter((x) => x.query.uploadType === 'resumable' && x.method === 'POST').length;
  assert.equal(sessions(), 1);
  let n = drive.log.length;
  await stopped(worker(drive, dk, { snapshot }).sync.run(), cutSecond());
  assert.equal(chunks(drive, n)[0].chunk.status, true, 'the second run asks where it stands');
  assert.ok(chunks(drive, n).some((x) => !x.chunk.status && x.chunk.from > 0), 'and sends more');
  n = drive.log.length;
  assert.ok((await worker(drive, dk, { snapshot }).sync.run()).ok, 'the third run lands it');
  assert.equal(made, 1, 'the zip was built once');
  assert.equal(sessions(), 1, 'over one session');
  const zips = [...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'snapshot');
  assert.equal(zips.length, 1);
  assert.equal(sha(zips[0].bytes), sha(zip), 'the zip whole');
  assert.equal(zips[0].meta.name, 'glaze-backup-2026-10-30.zip');
  assert.deepEqual(await moves(dk), {});
  assert.deepEqual([...dk.stage.m.keys()], [], 'the stage emptied');
});

test('an upload whose Drive file is gone: a snapshot goes on into a new file in the next worker; a document goes to Trash, no stray file', async () => {
  // The day's zip was to replace another device's of the same day, which is gone by the time it is sent.
  const drive = standin(), dk = disk(), zip = bytesOf(20 * MiB, 41);
  const folder = drive.seed({ name: 'Glaze', mimeType: drive.FOLDER, appProperties: { glaze: 'root' } });
  const backups = drive.seed({ name: 'Backups', mimeType: drive.FOLDER, parents: [folder.meta.id], appProperties: { glaze: 'backups' } });
  const theirs = drive.seed({ name: 'glaze-backup-2026-10-30.zip', mimeType: 'application/zip', parents: [backups.meta.id], appProperties: { glaze: 'snapshot' } }, 'PK theirs').meta.id;
  const snapshot = async () => ({ name: 'glaze-backup-2026-10-30.zip', bytes: zip });
  const gone = (u, init = {}) => { if (String(u).includes(`/upload/drive/v3/files/${theirs}?`) && init.method === 'PATCH') drive.files.delete(theirs); return drive.fetch(u, init); };
  await stopped(worker(drive, dk, { snapshot, fetch: gone }).sync.set(true), drive.cut(MiB, (e) => e.chunk && !e.chunk.status && e.chunk.from > 0));
  const sessions = () => drive.log.filter((x) => x.query.uploadType === 'resumable' && x.method !== 'PUT').length, n = drive.log.length, s0 = sessions();
  assert.ok((await worker(drive, dk, { snapshot }).sync.run()).ok);
  assert.equal(sessions(), s0, 'the new file\'s session goes on: none begun again');
  assert.equal(chunks(drive, n)[0].chunk.status, true);
  assert.ok(chunks(drive, n)[1].chunk.from > 0, 'from where Drive says it stands');
  const zips = [...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'snapshot');
  assert.equal(zips.length, 1);
  assert.equal(sha(zips[0].bytes), sha(zip), 'the zip whole, in a new file');
  // A PDF's new bytes, its file deleted for good in Drive as they begin to go: the document goes to Trash, as one whose file
  // was deleted for good in Drive does, and no new file is left in the folder.
  const drive2 = standin(), dk2 = disk(), key = 'doc:00000000-0000-4000-8000-00000000a008';
  const a = worker(drive2, dk2);
  await pdfOn(a, dk2, key, bytesOf(6 * MiB, 31), 'Reader');
  assert.ok((await a.sync.set(true)).ok);
  const old = fileOf(drive2, key, 'file').meta.id, ref = await dk2.files.put(bytesOf(20 * MiB, 37), MIME.pdf);
  await a.papers.save(key, { file: ref, size: ref.size });
  await a.sync.touched(key);
  const fetch = (u, init = {}) => { if (String(u).includes(`/upload/drive/v3/files/${old}?`) && init.method === 'PATCH') drive2.files.delete(old); return drive2.fetch(u, init); };
  const b = worker(drive2, dk2, { fetch });
  assert.ok((await b.sync.run({ push: true })).ok);
  assert.ok(P.trashed(await b.papers.get(key)), 'the document in Trash here');
  assert.ok(![...drive2.files.values()].some((f) => f.meta.appProperties.glaze === 'file' && f.meta.appProperties.key === tag(key)), 'no stray file in its place');
  assert.deepEqual(await moves(dk2), {});
});
