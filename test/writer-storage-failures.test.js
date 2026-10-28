const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');
const S = require('../lib/writer-schema.js');
const doc = (text) => S.parse(S.paper, `<p>${text}</p>`).toJSON();
const storage = () => {
  const data = {};
  let fail = false;
  return { data, exhaust: () => { fail = true; }, recover: () => { fail = false; },
    get: async (k) => ({ [k]: structuredClone(data[k]) }),
    set: async (p) => { if (fail && Object.keys(p).some((k) => k.startsWith('writerPaper:'))) throw new Error('QUOTA_BYTES'); Object.assign(data, structuredClone(p)); },
    remove: async () => {} };
};
for (const reason of ['import', 'restore', 'format', 'submit', 'auto']) test(`quota refusal during ${reason} leaves the paper, index and version history intact`, async () => {
  const s = storage(), papers = PA.open(s, () => Date.now(), { versions: () => 1 });
  await papers.save('key', { doc: doc('Submitted draft'), format: 'mla9', keep: true }, { reason: 'submit' });
  const before = structuredClone(s.data);
  s.exhaust();
  await assert.rejects(papers.save('key', { doc: doc('A different draft with many extra words'), format: 'apa7', keep: false }, { reason }), /QUOTA_BYTES/);
  assert.deepEqual(s.data, before, 'a rejected save must not evict the last submitted version or publish any partial change');
  s.recover();
  const saved = await papers.save('key', { doc: doc('Retry after capacity returns') });
  assert.equal(saved.paper.revision, 2);
});
