// A save that records something about a document without changing it (Save to Google Drive's drive: { id, as },
// lib/drive.js): touch: false keeps its Last edited, and so its place in Documents' list; the revision still moves on.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const store = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] === undefined ? undefined : JSON.parse(JSON.stringify(data[k])) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); }, remove: async (ks) => { for (const k of ks) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

test('touch: false records a field without moving Last edited; a save without it still does', async () => {
  const clock = { t: 1000 }, s = store(), P = PA.open(s, () => clock.t);
  const k = 'doc:00000000-0000-4000-8000-000000000001';
  await P.save(k, { doc: doc('An essay.') });
  clock.t = 5000;
  const { paper, version } = await P.save(k, { drive: { id: '1NeW_f1', as: 'file' } }, { changed: false, touch: false });
  assert.equal(paper.updated, 1000);
  assert.equal(paper.revision, 2);
  assert.deepEqual(paper.drive, { id: '1NeW_f1', as: 'file' });
  assert.equal(version, null);
  assert.equal(s.data.writerPapers.find((r) => r.key === k).updated, 1000, 'the index row keeps its place');
  clock.t = 9000;
  assert.equal((await P.save(k, { doc: doc('An essay, longer.') })).paper.updated, 9000);
  assert.deepEqual((await P.get(k)).drive, { id: '1NeW_f1', as: 'file' }, 'an edit keeps the Drive file');
});
