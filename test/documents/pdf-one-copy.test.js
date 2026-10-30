// A PDF keeps one copy of its file, the latest (owner, 2026-10-30): writer/writer-papers.js keeps no version holding a PDF's
// file for any reason, lets go of the versions an earlier build kept on the next save, and holds the file before the pages
// panel's Done only for its Undo (the file store's undo owner), never as a version. Papers and decks keep theirs.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../../extension/writer/writer-papers.js');
const F = require('../../extension/documents/doc-files.js');
const { fakeIDB } = require('../helpers/fake-idb.cjs');
globalThis.GZ_WRITER_STYLES = require('../../extension/writer/writer-styles.js');

const local = () => {
  const data = {};
  const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  return { data, get: async (k) => (k === null ? copy(data) : { [k]: copy(data[k]) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = copy(v); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const bytes = (n, seed = 1) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };
const make = () => {
  const { indexedDB, IDBKeyRange } = fakeIDB(), clock = { t: 1e12 };
  const files = F.store(F.idb(indexedDB, 'glaze-docs', IDBKeyRange), { now: () => clock.t });
  const store = local();
  const P = PA.open(store, () => clock.t, { versions: () => 40, files });
  const idb = () => indexedDB.dbs.get('glaze-docs').get('files');
  const kept = () => [...idb().keys()].filter((k) => k.startsWith('f:')).map((k) => k.slice(2)).sort();
  let seed = 100;
  const put = () => files.put(bytes(300, seed++), 'application/pdf');
  return { P, files, store, clock, kept, put };
};
const withFile = (list) => (list || []).filter((v) => v?.file);

test('a PDF edited across three visits keeps no version and one file in the store', async () => {
  const { P, store, clock, kept, put } = make(), k = PA.newKey();
  const f0 = await put();
  await P.save(k, { kind: 'pdf', doc: null, file: f0, size: f0.size, pages: 1 }, { reason: 'import' });
  let last = f0;
  for (let visit = 0; visit < 3; visit++) {
    clock.t += 3600e3;
    // A visit: its first save, autosaves seconds apart, the pages panel's Done.
    for (const reason of ['edit', 'auto', 'auto', 'edit']) {
      clock.t += 2000;
      last = await put();
      const { version } = await P.save(k, { file: last, size: last.size, pages: 1 }, { reason, expectedKind: 'pdf' });
      assert.equal(version, null, `no version on '${reason}'`);
    }
  }
  // Open in Glaze again, and a restore from a backup: the file is replaced, not kept.
  for (const reason of ['import', 'restore']) {
    clock.t += 2000;
    last = await put();
    assert.equal((await P.save(k, { kind: 'pdf', doc: null, file: last, size: last.size, pages: 1 }, { reason, expectedKind: 'pdf' })).version, null, reason);
  }
  assert.deepEqual(store.data[`writerVersions:${k}`] || [], [], 'zero versions');
  clock.t += F.HOLD + 1;
  await P.save(k, { title: 'Form', named: true }, { rename: true });
  assert.deepEqual(kept(), [last.hash], 'one file: the latest');
});

test('a PDF submit keeps what was sent as metadata only, owning no file', async () => {
  const { P, store, clock, kept, put } = make(), k = PA.newKey();
  const f0 = await put();
  await P.save(k, { kind: 'pdf', doc: null, file: f0, size: f0.size, pages: 1, title: 'Form', named: true }, { reason: 'import' });
  const { version } = await P.save(k, {}, { reason: 'sending', expectedKind: 'pdf', attached: [{ name: 'a.txt', size: 3 }] });
  assert.ok(version?.id, 'the submit still has a version id to mark');
  assert.equal(version.file, undefined);
  assert.deepEqual(version.sent, { name: 'Form', size: f0.size, hash: f0.hash });
  const marked = await P.submitted(k, version.id);
  assert.equal(marked.reason, 'submit');
  assert.ok(store.data[`writerPaper:${k}`].submitted, 'the PDF is marked submitted');
  const f1 = await put();
  clock.t += F.HOLD + 1;
  await P.save(k, { file: f1, size: f1.size }, { reason: 'edit', expectedKind: 'pdf' });
  assert.deepEqual(withFile(store.data[`writerVersions:${k}`]), []);
  assert.deepEqual(kept(), [f1.hash], 'the sent file is not held');
});

test('versions an earlier build kept for a PDF go on its next save, their files let go; the current file stays', async () => {
  const { P, files, store, clock, kept, put } = make(), k = PA.newKey();
  const [f0, f1, cur] = [await put(), await put(), await put()];
  // As 4.0.0 left it: the record, an edit version, a submitted version of the current file, a base64 one.
  store.data[`writerPaper:${k}`] = { key: k, kind: 'pdf', doc: null, file: cur, size: cur.size, pages: 1, title: 'Old', named: true, created: 1, updated: 2, revision: 4, edited: 4 };
  store.data[`writerVersions:${k}`] = [
    { id: 'a-1', at: 3, reason: 'edit', kind: 'pdf', file: f0, size: f0.size, pages: 1, bytes: 200 },
    { id: 'a-2', at: 2, reason: 'submit', kind: 'pdf', file: cur, size: cur.size, pages: 1, bytes: 200 },
    { id: 'a-3', at: 1, reason: 'import', kind: 'pdf', file: f1, size: f1.size, pages: 1, bytes: 200 },
    { id: 'a-4', at: 0, reason: 'edit', kind: 'pdf', file: 'JVBERi0=', size: 5, pages: 1, bytes: 20 },
  ];
  store.data.writerPapers = [{ key: k, kind: 'pdf', title: 'Old', updated: 2 }];
  await files.own(k, [f0.hash, f1.hash, cur.hash]);
  clock.t += F.HOLD + 1;
  // A save that leaves the file as it is (a rename): the versions go, the record's own file stays.
  await P.save(k, { title: 'New', named: true }, { rename: true });
  assert.deepEqual(withFile(store.data[`writerVersions:${k}`]), [], 'no version holds a file');
  assert.deepEqual(kept(), [cur.hash], 'the old versions\' files are let go, never the record\'s');
  const back = [];
  await files.read(cur.hash, (c) => { back.push(c.length); });
  assert.equal(back.reduce((n, x) => n + x, 0), cur.size);
});

test('the pages panel\'s Done holds the file before it for Undo only; Undo takes it back and leaves one file', async () => {
  const { P, store, clock, kept, put } = make(), k = PA.newKey();
  const f0 = await put();
  await P.save(k, { kind: 'pdf', doc: null, file: f0, size: f0.size, pages: 3 }, { reason: 'import' });
  clock.t += F.HOLD + 1;
  const f1 = await put();
  const done = await P.save(k, { file: f1, size: f1.size, pages: 2 }, { reason: 'edit', expectedKind: 'pdf', expectedFile: f0, hold: true });
  assert.equal(done.version, null, 'not a version');
  assert.equal(done.held, true);
  assert.deepEqual(store.data[`writerVersions:${k}`] || [], []);
  clock.t += F.HOLD + 1;
  await P.save(k, { title: 'x' }, {}); // a rename is no edit save of the file: still held? it replaces nothing
  assert.deepEqual(kept(), [f0.hash, f1.hash].sort(), 'the file before Done is held');
  // Undo: the held file back as the record's.
  const undo = await P.save(k, { file: f0, size: f0.size, pages: 3 }, { reason: 'restore', expectedKind: 'pdf', expectedFile: f1 });
  assert.equal(undo.paper.file.hash, f0.hash);
  assert.equal(undo.version, null);
  clock.t += F.HOLD + 1;
  await P.save(k, { title: 'y' }, {});
  assert.deepEqual(kept(), [f0.hash], 'settled: one file');
});

test('at most one held copy per PDF: a second Done replaces it, an edit save, a new visit and Delete let it go', async () => {
  const { P, store, clock, kept, put } = make(), k = PA.newKey();
  const f0 = await put();
  await P.save(k, { kind: 'pdf', doc: null, file: f0, size: f0.size, pages: 1 }, { reason: 'import' });
  const done = async () => { clock.t += F.HOLD + 1; const f = await put(); await P.save(k, { file: f, size: f.size }, { reason: 'edit', expectedKind: 'pdf', hold: true }); return f; };
  const f1 = await done(), f2 = await done();
  clock.t += F.HOLD + 1;
  await P.save(k, { title: 'a' }, {});
  assert.deepEqual(kept(), [f1.hash, f2.hash].sort(), 'only the file before the last Done is held');
  // An edit save replaces it.
  clock.t += F.HOLD + 1;
  const f3 = await put();
  await P.save(k, { file: f3, size: f3.size }, { reason: 'auto', expectedKind: 'pdf' });
  clock.t += F.HOLD + 1;
  await P.save(k, { title: 'b' }, {});
  assert.deepEqual(kept(), [f3.hash], 'an edit save let it go');
  // A new visit (or the viewer closing) lets it go.
  const f4 = await done();
  assert.deepEqual(await P.migrate(k, { release: true }), { moved: 0 });
  clock.t += F.HOLD + 1;
  await P.save(k, { title: 'c' }, {});
  assert.deepEqual(kept(), [f4.hash], 'released at a new visit');
  // Delete forever lets go of a held copy with the record's.
  await done();
  clock.t += F.HOLD + 1;
  await P.remove(k);
  assert.deepEqual(kept(), [], 'nothing left');
  assert.equal(store.data[`writerPaper:${k}`], undefined);
});

test('a page\'s papers proxy asks the worker to let go of a held copy', async () => {
  const sent = [];
  globalThis.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, value: { moved: 0 } }; } }, storage: { local: local() } };
  try {
    const P = PA.open();
    await P.migrate('doc:x', { release: true });
    assert.deepEqual(sent.map((m) => [m.op, m.args]), [['migrate', ['doc:x', { release: true }]]]);
  } finally { delete globalThis.chrome; }
});

test('papers still keep versions, and a deck keeps the file before its edit', async () => {
  const { P, store, clock, put } = make();
  const k = PA.newKey(), words = (n) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: Array.from({ length: n }, (_, i) => `w${i}`).join(' ') }] }] });
  await P.save(k, { doc: words(5) });
  clock.t += 1000;
  await P.save(k, { doc: words(300) });
  await P.save(k, {}, { reason: 'submit' });
  assert.deepEqual(store.data[`writerVersions:${k}`].map((v) => v.reason), ['submit', 'edit', 'start']);
  const d = PA.newKey(), s0 = await put(), s1 = await put();
  await P.save(d, { kind: 'slides', doc: null, file: s0, size: s0.size, ext: '.pptx', slides: 1 }, { reason: 'import' });
  clock.t += 1000;
  const { version } = await P.save(d, { kind: 'slides', doc: null, file: s1, size: s1.size, ext: '.pptx', slides: 1 }, { reason: 'import', expectedKind: 'slides' });
  assert.equal(version?.file?.hash, s0.hash, 'a deck\'s re-import keeps its file before');
});

test('importing a PDF preserves deck versions and the deck it replaces', async () => {
  const { P, store, clock, kept, put } = make(), k = PA.newKey();
  const [s0, s1, pdf] = [await put(), await put(), await put()];
  await P.save(k, { kind: 'slides', doc: null, file: s0, size: s0.size, ext: '.pptx', slides: 1 }, { reason: 'import' });
  clock.t++;
  await P.save(k, { file: s1, size: s1.size }, { reason: 'edit' });
  clock.t += F.HOLD + 1;
  const { version } = await P.save(k, { kind: 'pdf', file: pdf, size: pdf.size, pages: 1 }, { reason: 'import' });
  assert.equal(version?.kind, 'slides');
  assert.deepEqual(store.data[`writerVersions:${k}`].map((v) => v.file.hash).sort(), [s0.hash, s1.hash].sort());
  assert.deepEqual(kept(), [s0.hash, s1.hash, pdf.hash].sort(), 'each retained deck version still owns its file');
});

test('restoring older papers and decks into a PDF preserves their versions', async () => {
  const { P, store, put } = make(), k = PA.newKey();
  const [pdf, deck, deckVersion] = [await put(), await put(), await put()];
  await P.save(k, { kind: 'pdf', doc: null, file: pdf, size: pdf.size, pages: 1 }, { reason: 'import' });
  await P.merge({ [`writerPaper:${k}`]: { key: k, kind: 'slides', doc: null, file: deck, size: deck.size, ext: '.pptx', slides: 1, updated: 1 },
    [`writerVersions:${k}`]: [{ id: 'deck-version', kind: 'slides', file: deckVersion, size: deckVersion.size, at: 1, bytes: 200 }] });
  assert.equal((await P.get(k)).file.hash, pdf.hash);
  assert.deepEqual(store.data[`writerVersions:${k}`].map((v) => v.file.hash).sort(), [deck.hash, deckVersion.hash].sort());
  await P.merge({ [`writerPaper:${k}`]: { key: k, kind: 'paper', doc: { type: 'doc', content: [] }, updated: 1 } });
  assert.ok(store.data[`writerVersions:${k}`].some((v) => v.kind === 'paper'), 'an older paper is retained too');
});

test('changing a PDF to a paper releases the separate Done undo hold', async () => {
  const { P, clock, kept, put } = make(), k = PA.newKey();
  const [before, after] = [await put(), await put()];
  await P.save(k, { kind: 'pdf', doc: null, file: before, size: before.size, pages: 2 }, { reason: 'import' });
  await P.save(k, { file: after, size: after.size, pages: 1 }, { reason: 'edit', hold: true });
  clock.t += F.HOLD + 1;
  await P.save(k, { kind: 'paper', doc: { type: 'doc', content: [] } }, { reason: 'import' });
  assert.deepEqual(kept(), [after.hash], 'the replaced PDF may be a paper version; its obsolete Undo is released');
});

test('closing an old viewer cannot release a newer Done hold from another tab', async () => {
  const { P, files, clock, kept, put } = make(), k = PA.newKey();
  const [before, middle, latest] = [await put(), await put(), await put()];
  await P.save(k, { kind: 'pdf', doc: null, file: before, size: before.size, pages: 3 }, { reason: 'import' });
  await P.save(k, { file: middle }, { reason: 'edit', hold: true });
  await P.save(k, { file: latest }, { reason: 'edit', hold: true });
  clock.t += F.HOLD + 1;
  await P.migrate(k, { release: true, file: before });
  await files.sweep();
  assert.deepEqual(kept(), [middle.hash, latest.hash].sort(), 'the newer tab\'s Undo is still owned');
  await P.migrate(k, { release: true, file: middle });
  assert.deepEqual(kept(), [latest.hash], 'its own close releases the hold');
});
