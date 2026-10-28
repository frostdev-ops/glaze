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
