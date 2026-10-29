// The frame's side of the papers store (lib/writer-papers.js open() without a store): reads from storage.local, writes
// through the worker ('glaze:writerPapers'), each save carrying the revision it last saw so another editor's newer
// text is kept as a version. Here the worker is the same module over the same in-memory storage, answering late.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');

const memory = () => {
  const data = {};
  return { get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (o) => { Object.assign(data, structuredClone(o)); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY = 'bb.school.test|_900_1|_101_1|_7_1';

test('one editor\'s saves sent back to back never file its own text as another editor\'s draft', async (t) => {
  const local = memory();
  let clock = 1e12;
  const worker = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const was = globalThis.chrome;
  t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local }, runtime: { sendMessage: async (m) => { await new Promise((r) => setTimeout(r, 5)); return { ok: true, value: await worker[m.op](...m.args) }; } } };
  const store = PA.open();
  await store.save(KEY, { doc: doc('First words.') });
  await store.get(KEY);
  // Leaving the page with unsaved typing: visibilitychange then pagehide, each a save, the first not yet answered.
  await Promise.all([store.save(KEY, { doc: doc('First words. More.') }), store.save(KEY, { doc: doc('First words. More, and the end.') })]);
  const reasons = (await worker.versions(KEY)).map((v) => v.reason);
  assert.ok(!reasons.includes('conflict'), `versions: ${reasons.join(', ')}`);
  assert.equal((await worker.get(KEY)).doc.content[0].content[0].text, 'First words. More, and the end.');
});

test('a save that says which revision it builds on keeps a newer one it would replace as a version', async (t) => {
  const local = memory();
  let clock = 1e12;
  const worker = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const was = globalThis.chrome;
  t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local }, runtime: { sendMessage: async (m) => ({ ok: true, value: await worker[m.op](...m.args) }) } };
  const store = PA.open();
  const first = (await store.save(KEY, { doc: doc('Mine.') })).paper.revision;
  await worker.save(KEY, { doc: doc('Another tab’s.') });
  await store.get(KEY);
  await store.save(KEY, { doc: doc('Mine, brought back.') }, { base: first });
  const kept = await Promise.all((await worker.versions(KEY)).map((v) => worker.version(KEY, v.id)));
  assert.ok(kept.some((v) => v.reason === 'conflict' && v.doc.content[0].content[0].text === 'Another tab’s.'));
});

// The home page's delete-Undo puts back one key's paper and versions through the worker, from its own tab only.
test('the worker takes merge only from papers.html\'s top frame, for one key\'s two records', async () => {
  const w = require('./helpers/worker-env.cjs')(), EXT = 'chrome-extension://x';
  const home = { id: 'glaze', frameId: 0, url: `${EXT}/papers.html`, origin: EXT, tab: { id: 4, url: `${EXT}/papers.html` } };
  const send = (op, args, s = home) => w.send({ type: 'glaze:writerPapers', op, args }, s);
  for (const k of [PA.newKey(), KEY]) {
    assert.equal((await send('save', [k, { doc: doc('Kept words.'), title: 'Mine', named: true }])).ok, true);
    await send('save', [k, { doc: doc('Kept words, then many more words than before to make a version.') }, { reason: 'import' }]);
    const records = { [`writerPaper:${k}`]: w.store.local[`writerPaper:${k}`], [`writerVersions:${k}`]: w.store.local[`writerVersions:${k}`] };
    assert.equal((await send('remove', [k])).ok, true);
    for (const s of [{ ...home, frameId: 2 }, { ...home, tab: undefined }, { ...home, url: `${EXT}/writer.html` }, { ...home, url: `${EXT}/options.html` }, { ...home, origin: 'https://bb.school.test' }, { ...home, id: 'other' }]) {
      assert.deepEqual(await send('merge', [records], s), { ok: false, error: 'sender' }, JSON.stringify(s));
    }
    const other = PA.newKey();
    for (const bad of [{}, { ...records, [`writerPaper:${other}`]: { ...records[`writerPaper:${k}`], key: other } }, { [`writerPaper:${k}`]: { ...records[`writerPaper:${k}`], key: other } },
      { [`writerVersions:${k}`]: 'not a list' }, { writerPapers: [] }, { 'writerPaper:doc:nope': { key: 'doc:nope' } }, { [`writerPresets:${k}`]: [] }]) {
      assert.deepEqual(await send('merge', [bad]), { ok: false, error: 'bad' }, JSON.stringify(Object.keys(bad)));
    }
    assert.equal(w.store.local[`writerPaper:${k}`], undefined, 'nothing refused was written');
    assert.equal((await send('merge', [records])).ok, true);
    const back = w.store.local[`writerPaper:${k}`];
    assert.deepEqual([back.title, back.named, back.kind, back.doc.content[0].content[0].text], ['Mine', true, 'paper', 'Kept words, then many more words than before to make a version.']);
    assert.ok(w.store.local[`writerVersions:${k}`].some((v) => v.reason === 'import'), 'its versions are back');
    assert.ok(w.store.local.writerPapers.some((r) => r.key === k), 'and its row');
  }
});
