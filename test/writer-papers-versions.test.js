// Settings → Writer → Papers → Versions kept (writer.versions): lib/writer-papers.js caps each paper's versions at the count
// chosen, read from storage.sync `writer` where the worker runs it, keeping the newest and the last submitted.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');
const D = require('../defaults.js');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const store = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] === undefined ? undefined : JSON.parse(JSON.stringify(data[k])) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); }, remove: async (ks) => { for (const k of ks) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
const K = PA.keyOf({ school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' });
const fill = async (P, n, clock) => {
  await P.save(K, { doc: doc(words(10)) }, { reason: 'submit' });
  for (let i = 0; i < n; i++) { clock.t += 11 * 60e3; await P.save(K, { doc: doc(words(11 + i)) }); }
  return P.versions(K);
};

test('the count chosen caps each paper, the newest and the submitted kept', async () => {
  for (const n of [10, 25, 50, 100]) {
    const clock = { t: 0 }, P = PA.open(store(), () => clock.t, { versions: () => n });
    const list = await fill(P, n + 15, clock);
    assert.equal(list.length, n, `${n}`);
    assert.ok(list.some((v) => v.reason === 'submit'), `${n}: the submitted version stays`);
    assert.equal(list[0].at, clock.t, `${n}: the newest stays`);
  }
});

test('in the worker, storage.sync writer.versions is the cap; a value it does not take is today\'s 40', async () => {
  const prev = { chrome: globalThis.chrome, S: globalThis.GZ_SANITIZE };
  let writer = { versions: 10 };
  globalThis.chrome = { storage: { sync: { get: async () => ({ writer }) } } };
  globalThis.GZ_SANITIZE = D.GZ_SANITIZE;
  try {
    let clock = { t: 0 };
    assert.equal((await fill(PA.open(store(), () => clock.t), 20, clock)).length, 10);
    writer = { versions: 7 };
    clock = { t: 0 };
    assert.equal((await fill(PA.open(store(), () => clock.t), 50, clock)).length, 40);
  } finally { globalThis.chrome = prev.chrome; globalThis.GZ_SANITIZE = prev.S; }
});
