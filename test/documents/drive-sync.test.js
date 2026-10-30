// Sync Documents (extension/documents/drive-sync.js) against a stand-in Drive that keeps state across requests (test/helpers/drive-standin.cjs,
// Drive v3's shapes from test/fixtures/drive/v3.js), with the real paper store (extension/writer/writer-papers.js) on each device: the
// first upload, two devices editing the same document, Trash on each side, offline then online, a token that expires
// mid-sync, an account switch, Drive's rate limit and a full Drive, a file deleted in Drive for good, a file edited outside
// Glaze, the debounced push, and that nothing is ever deleted for good.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const D = require('../../extension/documents/drive.js');
const P = require('../../extension/writer/writer-papers.js');
const S = require('../../extension/documents/drive-sync.js');
const SD = require('../../extension/documents/sheets/sheet-data.js');
const M = require('../../extension/documents/sheets/sheet-model.js');
const { standin } = require('../helpers/drive-standin.cjs');
const { SYNC, ERRORS, MIME } = require('../fixtures/drive/v3.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const textOf = (d) => JSON.stringify(d).match(/"text":"([^"]*)"/)?.[1];

// chrome.storage.local, in memory: values copied in and out, as the browser does.
const memory = () => {
  const m = new Map();
  return {
    m,
    get: async (k) => { const ks = k == null ? [...m.keys()] : Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])); },
    set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    remove: async (k) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); },
    keys: async () => [...m.keys()],
  };
};
// The worker's file store (lib/doc-files.js), in memory, by SHA-256.
const fileStore = () => {
  const f = new Map(), owners = new Map();
  return {
    f,
    put: async (bytes, type) => { const hash = sha(bytes); f.set(hash, { bytes: new Uint8Array(bytes), type }); return { hash, size: bytes.length, type }; },
    stat: async (hash) => (f.has(hash) ? { hash, size: f.get(hash).bytes.length, type: f.get(hash).type } : null),
    read: async (hash) => f.get(hash)?.bytes || null,
    own: async (owner, hashes, { add = false } = {}) => { owners.set(owner, new Set([...(add ? owners.get(owner) || [] : []), ...hashes])); return { missing: hashes.filter((h) => !f.has(h)) }; },
  };
};

const EXT = { paper: '.docx', sheet: '.xlsx', pdf: '.pdf', slides: '.pptx' };
const TYPE = { paper: MIME.docx, sheet: MIME.xlsx, pdf: MIME.pdf, slides: MIME.pptx };
// One device: its own storage, paper store, file store and sync, all against the one stand-in Drive.
const device = (drive, { account = 'student@school.edu', tokens = ['tok-1', 'tok-2', 'tok-3'], clock = { t: Date.parse('2026-10-30T12:00:00Z') } } = {}) => {
  const store = memory(), files = fileStore();
  const now = () => clock.t;
  const papers = P.open(store, now, { versions: () => 40, files: { own: files.own } });
  const who = { account };
  const log = { sleep: [], drop: [], token: [] };
  let dropped = 0;
  const timers = [];
  const env = {
    drive: () => D.create({ fetch: drive.fetch, token: async (o) => { log.token.push(o); return tokens[Math.min(dropped, tokens.length - 1)]; }, drop: async (t) => { log.drop.push(t); dropped++; }, account: async () => who.account, interactive: false, boundary: () => 'B0und4ry' }),
    account: async () => who.account,
    store,
    papers: { get: papers.get, list: papers.list, save: papers.save, trash: papers.trash, untrash: papers.untrash, keep: papers.keep },
    parts: async (key, rec) => {
      const names = Object.keys(rec.parts || {}), got = await store.get(names.map((n) => `writerSheet:${key}:${n}`));
      return Object.fromEntries(names.map((n) => { const { rev, ...p } = got[`writerSheet:${key}:${n}`]; return [n, p]; }));
    },
    files: { has: async (h) => !!(await files.stat(h)), put: files.put },
    exportOf: async (key, rec, parts) => {
      const kind = rec.kind || 'paper', name = `${rec.title || 'Untitled'}${EXT[kind]}`;
      if (kind === 'pdf' || kind === 'slides') { const b = await files.read(rec.file?.hash); return b ? { name, mime: TYPE[kind], bytes: b } : null; }
      return { name, mime: TYPE[kind], bytes: enc(JSON.stringify(kind === 'sheet' ? parts : rec.doc)) };
    },
    pack: async (rec, parts) => SD.pack(SD.join(rec.book, new Map(Object.entries(parts).map(([n, p]) => [n, p.rows])))),
    hash: async (s) => sha(s),
    copyName: (title) => `${title} (Drive copy)`,
    now,
    sleep: async (ms) => { log.sleep.push(ms); },
    random: () => 0,
    locks: null,
    timer: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return () => { t.on = false; }; },
  };
  const sync = S.create(env);
  return { store, files, papers, sync, who, log, clock, timers, fire: async () => { for (const t of timers.splice(0)) if (t.on) await t.fn(); } };
};
const state = async (dev) => (await dev.store.get(S.STATE))[S.STATE];
const glazeFolder = (drive) => [...drive.files.values()].find((f) => f.meta.mimeType === drive.FOLDER && f.meta.name === 'Glaze');
const sidecarOf = (drive, key) => [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'doc' && f.meta.appProperties.key === sha(key).slice(0, 32));
const exportOf = (drive, key) => [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'file' && f.meta.appProperties.key === sha(key).slice(0, 32));
const sidecarJson = (drive, key) => JSON.parse(dec(sidecarOf(drive, key).bytes));
const noDeletes = (drive) => assert.equal(drive.log.filter((x) => x.method === 'DELETE').length, 0, 'nothing deleted for good');
const sheetBook = (cells) => {
  const wb = M.workbook();
  for (const [r, c, v] of cells) { if (!wb.sheets[0].rows.has(r)) wb.sheets[0].rows.set(r, new Map()); wb.sheets[0].rows.get(r).set(c, { v }); }
  const { book, parts } = SD.split(wb);
  return { book, parts: Object.fromEntries([...parts].map(([n, rows]) => [n, { rows }])) };
};
const sheetCells = async (dev, key) => { const rec = await dev.papers.get(key); return JSON.stringify((await dev.store.get(Object.keys(rec.parts).map((n) => `writerSheet:${key}:${n}`)))); };

test('the sync fixtures are the discovery document\'s shapes, not yet seen live', () => {
  assert.equal(SYNC.live, false);
  assert.deepEqual(Object.keys(SYNC.start), ['kind', 'startPageToken']);
  assert.equal(SYNC.changes.kind, 'drive#changeList');
  assert.ok(typeof SYNC.changes.nextPageToken === 'string' && SYNC.changes.newStartPageToken === undefined, 'a page with more: nextPageToken only');
  assert.ok(typeof SYNC.last.newStartPageToken === 'string' && SYNC.last.nextPageToken === undefined, 'the last page: newStartPageToken only');
  const removed = SYNC.last.changes.find((c) => c.removed);
  assert.ok(removed && removed.file === undefined && typeof removed.fileId === 'string', 'a removed file: its id, no file');
  for (const c of [...SYNC.changes.changes, ...SYNC.last.changes]) assert.ok(c.kind === 'drive#change' && c.changeType === 'file' && !Number.isNaN(Date.parse(c.time)));
  assert.equal(typeof SYNC.sidecar.version, 'string', 'File.version is an int64 string');
  assert.deepEqual(SYNC.fields, D.SYNC.split(','), 'what sync asks of a file is what the fixtures hold');
});

test('the sync client asks Drive exactly, never interactively', async () => {
  const drive = standin();
  const tokens = [];
  const c = D.create({ fetch: drive.fetch, token: async (o) => { tokens.push(o); return 'tok-1'; }, interactive: false, boundary: () => 'B0und4ry' });
  const t = await c.startToken();
  assert.equal(t, '1001');
  const f = await c.folder({ name: 'Glaze', mimeType: drive.FOLDER, appProperties: { glaze: 'root' } });
  const up = await c.put({ meta: { name: 'a.json', parents: [f.id], appProperties: { glaze: 'doc' } }, mime: 'application/json', bytes: enc('{}') });
  assert.ok(up.headRevisionId && up.version === '1' && up.parents[0] === f.id);
  const big = new Uint8Array(D.SMALL + 10).fill(1);
  const r = await c.put({ id: up.id, meta: {}, mime: 'application/json', bytes: big });
  assert.equal(r.id, up.id);
  const list = await c.find(`'${f.id}' in parents and appProperties has { key='glaze' and value='doc' } and trashed=false`);
  assert.deepEqual(list.files.map((x) => x.id), [up.id]);
  const ch = await c.changes(t);
  assert.deepEqual(ch.changes.map((x) => x.fileId), [f.id, up.id]);
  assert.equal(ch.newStartPageToken, '1004', 'the token after the last change');
  assert.deepEqual((await c.media(up.id, 1e9)).length, big.length);
  await assert.rejects(c.media(up.id, 10), (e) => e.why === 'size');
  await c.patch(up.id, { trashed: true });
  assert.equal(drive.view(up.id).trashed, true);
  assert.ok(tokens.every((o) => o.interactive === false), 'never asks the student to sign in');
  const asked = drive.log.map((x) => `${x.method} ${x.path} ${x.query.uploadType || ''}`.trim());
  assert.deepEqual(asked, ['GET /drive/v3/changes/startPageToken', 'POST /drive/v3/files', 'POST /upload/drive/v3/files multipart', `PATCH /upload/drive/v3/files/${up.id} resumable`, `PUT /upload/drive/v3/files/${up.id} resumable`,
    'GET /drive/v3/files', 'GET /drive/v3/changes', `GET /drive/v3/files/${up.id}`, `GET /drive/v3/files/${up.id}`, `PATCH /drive/v3/files/${up.id}`]);
  const changes = drive.log.find((x) => x.path === '/drive/v3/changes').query;
  assert.deepEqual(changes, { pageToken: '1001', pageSize: '100', spaces: 'drive', includeRemoved: 'true', fields: `nextPageToken,newStartPageToken,changes(changeType,removed,fileId,time,file(${D.SYNC}))` });
  assert.ok(drive.log.every((x) => x.auth === 'Bearer tok-1' && !x.cookie));
});

test('turning Sync on uploads every document: its file and a JSON copy in a Glaze folder', async () => {
  const drive = standin(), a = device(drive);
  const paper = 'doc:00000000-0000-4000-8000-000000000001', sheet = 'doc:00000000-0000-4000-8000-000000000002', pdf = 'doc:00000000-0000-4000-8000-000000000003';
  await a.papers.save(paper, { doc: doc('First words'), title: 'Essay', named: true });
  const sb = sheetBook([[0, 0, 'Rent'], [0, 1, 400]]);
  await a.papers.save(sheet, { kind: 'sheet', book: sb.book, title: 'Budget', named: true, cells: 2 }, { parts: sb.parts });
  const ref = await a.files.put(enc('%PDF-1.7 reading'), MIME.pdf);
  await a.papers.save(pdf, { kind: 'pdf', file: ref, size: ref.size, title: 'Reading', named: true });
  await a.papers.save('recovery:abc', { doc: doc('stand-in'), title: 'Recovered' });
  assert.equal((await a.sync.status()).on, false, 'off by default');
  assert.equal(drive.log.length, 0, 'nothing reaches Drive while off');
  const r = await a.sync.set(true);
  assert.ok(r.ok, JSON.stringify(r));
  const folder = glazeFolder(drive);
  assert.ok(folder && folder.meta.appProperties.glaze === 'root' && folder.meta.parents[0] === '0AroOt', 'a folder named Glaze in My Drive');
  for (const [key, name, mime] of [[paper, 'Essay.docx', MIME.docx], [sheet, 'Budget.xlsx', MIME.xlsx], [pdf, 'Reading.pdf', MIME.pdf]]) {
    const e = exportOf(drive, key), j = sidecarOf(drive, key);
    assert.ok(e && e.meta.name === name && e.meta.mimeType === mime && e.meta.parents[0] === folder.meta.id, `${name}: its kind's file in the folder`);
    assert.ok(j && j.meta.name === name.replace(/\.\w+$/, '.glaze.json') && j.meta.mimeType === 'application/json' && j.meta.parents[0] === folder.meta.id, `${name}: its JSON copy`);
    const body = JSON.parse(dec(j.bytes));
    assert.equal(body.glaze, 'document'); assert.equal(body.v, 1); assert.equal(body.key, key); assert.equal(body.file, e.meta.id); assert.equal(body.fileRev, e.meta.headRevisionId);
    assert.equal(j.meta.appProperties.sum, e.meta.appProperties.sum, 'the file carries the sum of the copy it was written with');
    assert.equal(body.record.revision, undefined, 'device-only fields stay out');
  }
  assert.equal(sidecarJson(drive, paper).record.title, 'Essay');
  assert.deepEqual(sidecarJson(drive, sheet).parts, sb.parts, 'a spreadsheet\'s cells go in its JSON copy');
  assert.equal(dec(exportOf(drive, pdf).bytes), '%PDF-1.7 reading', 'a PDF\'s file is its own bytes');
  assert.equal(sidecarOf(drive, 'recovery:abc'), undefined, 'a stand-in for a lost key stays on this device');
  const st = await state(a);
  assert.ok(st.on && st.folder === folder.meta.id && typeof st.token === 'string' && st.account === 'student@school.edu' && !st.problem && st.last, JSON.stringify(st));
  // A run with nothing changed asks Drive only for its folder and its changes: Glaze's own uploads are no news.
  const n = drive.log.length;
  assert.ok((await a.sync.run()).ok);
  assert.deepEqual(drive.log.slice(n).map((x) => `${x.method} ${x.path}`), [`GET /drive/v3/files/${folder.meta.id}`, 'GET /drive/v3/changes']);
  noDeletes(drive);
});

test('two devices edit the same paper: both versions kept, the other side as a version', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') };
  const a = device(drive, { clock }), b = device(drive, { clock });
  const key = 'doc:00000000-0000-4000-8000-0000000000aa';
  await a.papers.save(key, { doc: doc('Draft one'), title: 'Essay', named: true });
  await a.sync.set(true);
  await b.sync.set(true);
  assert.equal(textOf((await b.papers.get(key)).doc), 'Draft one', 'the second device gets the document, same key');
  assert.equal((await b.papers.get(key)).title, 'Essay');
  // A edits and syncs; B edits the same paper before it hears of A's edit.
  clock.t += 60e3;
  await a.papers.save(key, { doc: doc('A wrote this') });
  await a.sync.touched(key); await a.fire();
  await b.papers.save(key, { doc: doc('B wrote that') });
  await b.sync.touched(key);
  assert.ok((await b.sync.run()).ok);
  const here = await b.papers.get(key);
  assert.equal(textOf(here.doc), 'B wrote that', 'what B wrote stays current on B');
  const kept = (await b.papers.versions(key)).filter((v) => v.reason === 'conflict');
  assert.equal(kept.length, 1, 'Drive\'s side is one version');
  assert.equal(textOf((await b.papers.version(key, kept[0].id)).doc), 'A wrote this', 'and it is what A wrote');
  assert.equal(textOf(sidecarJson(drive, key).record.doc), 'B wrote that', 'Drive now holds B\'s, its earlier revision in Drive\'s own history');
  // A, unchanged since, takes B's.
  assert.ok((await a.sync.run()).ok);
  assert.equal(textOf((await a.papers.get(key)).doc), 'B wrote that');
  assert.equal((await a.papers.versions(key)).filter((v) => v.reason === 'conflict').length, 0, 'no conflict where only one side changed');
  // Settled: another run on each changes nothing.
  const n = drive.log.filter((x) => x.upload).length;
  await a.sync.run(); await b.sync.run();
  assert.equal(drive.log.filter((x) => x.upload).length, n, 'no upload once both agree');
  noDeletes(drive);
});

test('two devices edit the same spreadsheet: Drive\'s workbook kept as a packed version', async () => {
  const drive = standin(), a = device(drive), b = device(drive);
  const key = 'doc:00000000-0000-4000-8000-0000000000bb';
  const v1 = sheetBook([[0, 0, 'Rent'], [0, 1, 400]]);
  await a.papers.save(key, { kind: 'sheet', book: v1.book, title: 'Budget', named: true }, { parts: v1.parts });
  await a.sync.set(true); await b.sync.set(true);
  assert.match(await sheetCells(b, key), /Rent/, 'B has the cells');
  const va = sheetBook([[0, 0, 'Rent'], [0, 1, 450]]), vb = sheetBook([[0, 0, 'Rent'], [0, 1, 500]]);
  const ra = await a.papers.get(key), rb = await b.papers.get(key);
  await a.papers.save(key, { kind: 'sheet', book: va.book }, { parts: va.parts, base: ra.revision });
  await a.sync.touched(key); await a.fire();
  await b.papers.save(key, { kind: 'sheet', book: vb.book }, { parts: vb.parts, base: rb.revision });
  await b.sync.touched(key);
  assert.ok((await b.sync.run()).ok);
  assert.match(await sheetCells(b, key), /500/, 'B\'s cells stay current');
  const v = (await b.papers.versions(key)).find((x) => x.reason === 'conflict');
  assert.ok(v && v.kind === 'sheet', 'a packed spreadsheet version');
  const wb = await SD.unpack((await b.papers.version(key, v.id)).gz);
  assert.equal(wb.sheets[0].rows.get(0).get(1).v, 450, 'holding A\'s workbook');
});

test('a PDF changed on both sides: Drive\'s becomes a document of its own, "(Drive copy)"', async () => {
  const drive = standin(), a = device(drive), b = device(drive);
  const key = 'doc:00000000-0000-4000-8000-0000000000cc';
  const r1 = await a.files.put(enc('%PDF one'), MIME.pdf);
  await a.papers.save(key, { kind: 'pdf', file: r1, size: r1.size, title: 'Reading', named: true });
  await a.sync.set(true); await b.sync.set(true);
  assert.equal((await b.papers.get(key)).file.hash, r1.hash, 'B has the PDF, its bytes in its own store');
  assert.ok(await b.files.stat(r1.hash));
  const ra = await a.files.put(enc('%PDF A marked'), MIME.pdf), rb = await b.files.put(enc('%PDF B marked'), MIME.pdf);
  await a.papers.save(key, { file: ra, size: ra.size }, { reason: 'edit' });
  await a.sync.touched(key); await a.fire();
  await b.papers.save(key, { file: rb, size: rb.size }, { reason: 'edit' });
  await b.sync.touched(key);
  assert.ok((await b.sync.run()).ok);
  assert.equal((await b.papers.get(key)).file.hash, rb.hash, 'B\'s marked-up PDF stays');
  const copy = (await b.papers.list()).find((x) => x.title === 'Reading (Drive copy)');
  assert.ok(copy && copy.kind === 'pdf' && copy.key !== key, 'Drive\'s is a separate document');
  assert.equal((await b.papers.get(copy.key)).file.hash, ra.hash, 'holding A\'s PDF');
  assert.equal((await b.papers.versions(key)).filter((v) => v.reason === 'conflict').length, 0, 'not a version');
  assert.ok((await b.sync.run()).ok);
  assert.ok(sidecarOf(drive, copy.key), 'the copy syncs as a document of its own');
  assert.ok((await a.sync.run()).ok);
  assert.ok((await a.papers.list()).some((x) => x.title === 'Reading (Drive copy)'), 'and reaches the other device');
});

test('Trash follows Glaze\'s 30 days on each side, and nothing is deleted for good', async () => {
  const drive = standin(), a = device(drive), b = device(drive);
  const key = 'doc:00000000-0000-4000-8000-0000000000dd', two = 'doc:00000000-0000-4000-8000-0000000000de';
  await a.papers.save(key, { doc: doc('Keep me'), title: 'Notes', named: true });
  await a.papers.save(two, { doc: doc('Second'), title: 'Second', named: true });
  await a.sync.set(true); await b.sync.set(true);
  // Trashed in Glaze: Drive's files go to Drive's trash, and the other device's copy to its Trash.
  await a.papers.trash(key);
  await a.sync.touched(key); await a.fire();
  assert.ok(sidecarOf(drive, key).meta.explicitlyTrashed && exportOf(drive, key).meta.explicitlyTrashed, 'both Drive files in Drive\'s trash');
  assert.ok((await b.sync.run()).ok);
  assert.ok(P.trashed(await b.papers.get(key)), 'the other device\'s copy in Trash');
  // Restored on B: out of Drive's trash, and out of A's Trash.
  await b.papers.untrash(key);
  await b.sync.touched(key); await b.fire();
  assert.ok(!sidecarOf(drive, key).meta.explicitlyTrashed && !exportOf(drive, key).meta.explicitlyTrashed);
  assert.ok((await a.sync.run()).ok);
  assert.ok(!P.trashed(await a.papers.get(key)), 'restored on A too');
  // Trashed in Drive by the student (the .docx): Glaze's document goes to Trash, the JSON copy with it.
  drive.trash(exportOf(drive, two).meta.id);
  assert.ok((await a.sync.run()).ok);
  assert.ok(P.trashed(await a.papers.get(two)), 'a file trashed in Drive puts the document in Trash');
  assert.equal(textOf((await a.papers.get(two)).doc), 'Second', 'kept whole');
  assert.ok(sidecarOf(drive, two).meta.explicitlyTrashed, 'its JSON copy follows');
  // Deleted here straight from a live document (Settings' Clear): Drive's two files go to Drive's trash.
  const three = 'doc:00000000-0000-4000-8000-0000000000df';
  await a.papers.save(three, { doc: doc('Third'), title: 'Third', named: true });
  await a.sync.touched(three); await a.fire();
  assert.ok(sidecarOf(drive, three) && !sidecarOf(drive, three).meta.explicitlyTrashed);
  await a.papers.remove(three);
  await a.sync.touched(three); await a.fire();
  assert.ok(sidecarOf(drive, three).meta.explicitlyTrashed && exportOf(drive, three).meta.explicitlyTrashed, 'a cleared document\'s files in Drive\'s trash');
  // Deleted for good in Glaze (Delete forever, or Trash's 30 days): Drive's files go to Drive's trash, never further.
  await a.papers.remove(two);
  await a.sync.touched(two); await a.fire();
  assert.ok(sidecarOf(drive, two) && exportOf(drive, two), 'still in Drive');
  assert.ok(sidecarOf(drive, two).meta.explicitlyTrashed && exportOf(drive, two).meta.explicitlyTrashed);
  noDeletes(drive);
});

test('a file deleted for good in Drive (404, or removed from changes) puts the document in Trash here', async () => {
  const drive = standin(), a = device(drive);
  const one = 'doc:00000000-0000-4000-8000-0000000000e1', two = 'doc:00000000-0000-4000-8000-0000000000e2';
  await a.papers.save(one, { doc: doc('One'), title: 'One', named: true });
  await a.papers.save(two, { doc: doc('Two'), title: 'Two', named: true });
  await a.sync.set(true);
  // removed: true in the changes list
  drive.remove(sidecarOf(drive, one).meta.id);
  assert.ok((await a.sync.run()).ok);
  assert.ok(P.trashed(await a.papers.get(one)), 'in Trash, not deleted');
  assert.equal(textOf((await a.papers.get(one)).doc), 'One');
  // a 404 met while pushing a change (Drive's change not heard yet)
  const id = exportOf(drive, two).meta.id;
  drive.files.delete(id);
  await a.papers.save(two, { doc: doc('Two, edited') });
  await a.sync.touched(two);
  assert.ok((await a.sync.run({ push: true })).ok);
  assert.ok(P.trashed(await a.papers.get(two)), 'a 404 puts it in Trash');
  assert.equal(textOf((await a.papers.get(two)).doc), 'Two, edited', 'with the edit kept');
  assert.ok(sidecarOf(drive, two).meta.explicitlyTrashed, 'its other file in Drive\'s trash');
  // Restored here: it goes up again as new files.
  await a.papers.untrash(two);
  await a.sync.touched(two);
  assert.ok((await a.sync.run({ push: true })).ok);
  assert.ok(exportOf(drive, two) && !exportOf(drive, two).meta.explicitlyTrashed && exportOf(drive, two).meta.id !== id);
  noDeletes(drive);
});

test('offline, then online: what changed on both sides meanwhile is kept', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const key = 'doc:00000000-0000-4000-8000-0000000000f1';
  await a.papers.save(key, { doc: doc('Before'), title: 'Trip', named: true });
  await a.sync.set(true); await b.sync.set(true);
  drive.offline(null, 1);
  await a.papers.save(key, { doc: doc('Offline edit') });
  await a.sync.touched(key);
  const r = await a.sync.run();
  assert.deepEqual(r, { ok: false, why: 'network' });
  const st = await state(a);
  assert.equal(st.problem, 'network');
  assert.ok(st.wait > clock.t, 'a wait before the next try');
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'later' }, 'not before the wait');
  await b.papers.save(key, { doc: doc('Edited elsewhere') });
  await b.sync.touched(key); await b.fire();
  clock.t = st.wait + 1;
  assert.ok((await a.sync.run()).ok, 'online again');
  assert.equal(textOf((await a.papers.get(key)).doc), 'Offline edit');
  const v = (await a.papers.versions(key)).find((x) => x.reason === 'conflict');
  assert.equal(textOf((await a.papers.version(key, v.id)).doc), 'Edited elsewhere');
  assert.equal((await state(a)).problem, null);
});

test('a token that expires mid-sync is dropped and replaced once, and the sync goes on', async () => {
  const drive = standin(), a = device(drive);
  const keys = ['doc:00000000-0000-4000-8000-000000000101', 'doc:00000000-0000-4000-8000-000000000102'];
  for (const k of keys) await a.papers.save(k, { doc: doc(k), title: k.slice(-3), named: true });
  let n = 0;
  drive.fail(401, ERRORS[401], (x) => x.path.startsWith('/upload/') && ++n === 3);
  assert.ok((await a.sync.set(true)).ok);
  assert.deepEqual(a.log.drop, ['tok-1'], 'the refused token dropped once');
  assert.ok(drive.log.some((x) => x.auth === 'Bearer tok-2'), 'a fresh one used');
  for (const k of keys) assert.ok(sidecarOf(drive, k) && exportOf(drive, k), `${k} synced`);
  assert.ok(a.log.token.every((o) => o.interactive === false));
  // A token Google refuses again: the run stops, the problem says to connect again.
  drive.fail(401, ERRORS[401], null, 2);
  await a.papers.save(keys[0], { doc: doc('again') });
  await a.sync.touched(keys[0]);
  assert.deepEqual(await a.sync.run({ push: true }), { ok: false, why: 'auth' });
  assert.equal((await state(a)).problem, 'auth');
});

test('an account switch stops Sync: nothing reaches the other account, nothing here or there is touched', async () => {
  const drive = standin(), a = device(drive);
  const key = 'doc:00000000-0000-4000-8000-000000000201';
  await a.papers.save(key, { doc: doc('Mine'), title: 'Mine', named: true });
  await a.sync.set(true);
  const n = drive.log.length;
  a.who.account = 'other@school.edu';
  await a.papers.save(key, { doc: doc('Mine, edited') });
  await a.sync.touched(key);
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'account' });
  assert.equal(drive.log.length, n, 'no request with the other account');
  const st = await state(a);
  assert.ok(!st.on && !st.folder && !st.token && !st.account, `off, its state for the first account gone: ${JSON.stringify(st)}`);
  assert.deepEqual((await a.store.keys()).filter((k) => k.startsWith(S.DOC) || k.startsWith(S.FILE)), []);
  assert.equal(textOf((await a.papers.get(key)).doc), 'Mine, edited', 'the document untouched');
  assert.ok(!sidecarOf(drive, key).meta.explicitlyTrashed, 'the first account\'s files untouched');
  // Mid-run: the account changes while Drive answers busy; the client bound to the first account makes no further request.
  const b = device(drive);
  await b.papers.save('doc:00000000-0000-4000-8000-000000000202', { doc: doc('x'), title: 'x', named: true });
  await b.papers.save('doc:00000000-0000-4000-8000-000000000203', { doc: doc('y'), title: 'y', named: true });
  let at = -1;
  drive.fail(503, ERRORS[429], (x) => { if (!x.path.startsWith('/upload/')) return false; b.who.account = 'other@school.edu'; at = drive.log.length; return true; });
  const r = await b.sync.set(true);
  assert.deepEqual(r, { ok: false, why: 'connect' });
  assert.equal(drive.log.length, at, 'no request after the switch');
  assert.equal((await state(b)).problem, 'connect');
  assert.deepEqual(await b.sync.run(), { ok: false, why: 'account' }, 'the next run forgets the first account and stops');
  assert.equal((await state(b)).on, false);
  assert.equal(drive.log.length, at);
});

test('Drive\'s rate limit (403) backs off and retries; a full Drive stops with its own problem', async () => {
  const drive = standin(), a = device(drive);
  const key = 'doc:00000000-0000-4000-8000-000000000301';
  await a.papers.save(key, { doc: doc('Hello'), title: 'Hello', named: true });
  drive.fail(403, ERRORS.userRateLimitExceeded, null, 2);
  assert.ok((await a.sync.set(true)).ok);
  assert.deepEqual(a.log.sleep, [1000, 2000], 'exponential backoff');
  assert.ok(sidecarOf(drive, key));
  // Busy every time: the run gives up after its tries and waits, longer each time.
  await a.papers.save(key, { doc: doc('Hello again') });
  await a.sync.touched(key);
  drive.fail(429, ERRORS[429], null, 50);
  const t1 = a.clock.t;
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'busy' });
  const s1 = await state(a);
  assert.equal(s1.problem, 'busy');
  assert.equal(s1.wait - t1, 60e3, 'a minute before the next run');
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'later' });
  a.clock.t = s1.wait + 1;
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'busy' });
  const s2 = await state(a);
  assert.equal(s2.wait - a.clock.t, 120e3, 'then two');
  drive.clearFaults();
  a.clock.t = s2.wait + 1;
  assert.ok((await a.sync.run()).ok);
  assert.equal((await state(a)).problem, null);
  // A full Drive: no endless retry, its own problem.
  await a.papers.save(key, { doc: doc('Full') });
  await a.sync.touched(key);
  drive.fail(403, ERRORS.storageQuotaExceeded, (x) => x.path.startsWith('/upload/'));
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'quota' });
  assert.equal((await state(a)).problem, 'quota');
});

test('a Word file edited outside Glaze is never overwritten: Glaze writes a new file beside it', async () => {
  const drive = standin(), a = device(drive);
  const key = 'doc:00000000-0000-4000-8000-000000000401', pdf = 'doc:00000000-0000-4000-8000-000000000402';
  await a.papers.save(key, { doc: doc('Glaze text'), title: 'Essay', named: true });
  const ref = await a.files.put(enc('%PDF one'), MIME.pdf);
  await a.papers.save(pdf, { kind: 'pdf', file: ref, size: ref.size, title: 'Scan', named: true });
  await a.sync.set(true);
  const word = exportOf(drive, key).meta.id;
  drive.edit(word, enc('edited in Word'));
  await a.papers.save(key, { doc: doc('Glaze text, more') });
  await a.sync.touched(key);
  assert.ok((await a.sync.run()).ok);
  assert.equal(dec(drive.files.get(word).bytes), 'edited in Word', 'the edited file kept as it is');
  assert.equal(drive.files.get(word).meta.appProperties.glaze, 'kept', 'and no longer Glaze\'s copy');
  assert.notEqual(exportOf(drive, key).meta.id, word, 'a new file for the document');
  assert.equal(sidecarJson(drive, key).file, exportOf(drive, key).meta.id);
  // A PDF replaced in Drive (an annotator saving over it): its bytes come into Glaze.
  drive.edit(exportOf(drive, pdf).meta.id, enc('%PDF annotated'));
  assert.ok((await a.sync.run()).ok);
  const got = await a.papers.get(pdf);
  assert.equal(dec(await a.files.read(got.file.hash)), '%PDF annotated');
  assert.equal(sidecarJson(drive, pdf).record.file.hash, got.file.hash, 'its JSON copy follows');
});

test('a write that changes nothing synced (Save to Drive\'s note on the record) sends nothing', async () => {
  const drive = standin(), a = device(drive);
  const key = 'doc:00000000-0000-4000-8000-000000000701';
  await a.papers.save(key, { doc: doc('Same'), title: 'Same', named: true });
  await a.sync.set(true);
  const n = drive.log.filter((x) => x.upload).length;
  await a.papers.save(key, { drive: { id: '1SaVe_d', as: 'file' } }, { changed: false, touch: false });
  await a.sync.touched(key); await a.fire();
  assert.equal(drive.log.filter((x) => x.upload).length, n, 'a revision with the same content is no change');
  await a.papers.save(key, { title: 'Renamed' });
  await a.sync.touched(key); await a.fire();
  assert.equal(drive.log.filter((x) => x.upload).length, n + 2, 'a rename is');
  assert.equal(sidecarJson(drive, key).record.title, 'Renamed');
  assert.equal(exportOf(drive, key).meta.name, 'Renamed.docx', 'the file renamed with it');
});

test('pushes wait for a pause in saving; Sync off sends nothing; locks keep runs apart', async () => {
  const drive = standin(), a = device(drive);
  const key = 'doc:00000000-0000-4000-8000-000000000501';
  await a.papers.save(key, { doc: doc('One'), title: 'One', named: true });
  await a.sync.touched(key);
  assert.equal(a.timers.length, 0, 'off: no push scheduled');
  await a.sync.set(true);
  const n = drive.log.filter((x) => x.upload).length;
  for (const w of ['Two', 'Three', 'Four']) { await a.papers.save(key, { doc: doc(w) }); await a.sync.touched(key); }
  assert.equal(drive.log.filter((x) => x.upload).length, n, 'nothing yet');
  assert.ok(a.timers.length >= 1 && a.timers.every((t) => t.ms === S.WAIT.push));
  await a.fire();
  assert.equal(drive.log.filter((x) => x.upload).length, n + 2, 'one push (the file and its copy) for three saves');
  assert.equal(textOf(sidecarJson(drive, key).record.doc), 'Four');
  const [r1, r2] = await Promise.all([a.sync.run(), a.sync.run()]);
  assert.ok(r1.ok && r2.ok);
  await a.sync.set(false);
  const m = drive.log.length;
  await a.papers.save(key, { doc: doc('Five') });
  await a.sync.touched(key); await a.fire();
  assert.deepEqual(await a.sync.run(), { ok: false, why: 'off' });
  assert.equal(drive.log.length, m, 'off: nothing reaches Drive');
});

test('a JSON copy that isn\'t Glaze\'s, or names another document, is left alone', async () => {
  const drive = standin(), a = device(drive), b = device(drive);
  const key = 'doc:00000000-0000-4000-8000-000000000601';
  await a.papers.save(key, { doc: doc('Real'), title: 'Real', named: true });
  await a.sync.set(true);
  const j = sidecarOf(drive, key);
  const body = JSON.parse(dec(j.bytes));
  drive.edit(j.meta.id, enc(JSON.stringify({ ...body, key: 'doc:00000000-0000-4000-8000-000000000999' })));
  drive.files.get(j.meta.id).meta.appProperties.sum = 'f'.repeat(64);
  assert.ok((await b.sync.set(true)).ok);
  assert.equal(await b.papers.get('doc:00000000-0000-4000-8000-000000000999'), null, 'a copy whose key doesn\'t match its tag isn\'t taken');
  assert.equal(await b.papers.get(key), null);
});
