// The Documents index holds at most CAP.rows rows (audit 2026-11-11 A8 #4): the one document past it is refused, never taken in
// by letting the oldest drop out of the list while its record, versions and files stay in storage where nothing can reach them.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../../extension/writer/writer-papers.js');

const memory = () => {
  const data = {};
  return { data, get: async (k) => (typeof k === 'string' ? { [k]: structuredClone(data[k]) } : Object.fromEntries([].concat(k).map((x) => [x, structuredClone(data[x])]))),
    set: async (o) => { Object.assign(data, structuredClone(o)); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const recordsOf = (data) => Object.keys(data).filter((k) => k.startsWith('writerPaper:')).map((k) => k.slice(12));
const titled = (i) => ({ kind: 'paper', title: `t${i}`, named: true, format: 'plain' });

test('2,003 saves: the first 2,000 are listed and kept, the last three are refused, and nothing is stored that is not listed', async () => {
  const store = memory(), keys = [], refused = [];
  let t = 0;
  const P = PA.open(store, () => 1e12 + ++t);
  for (let i = 0; i < 2003; i++) {
    const k = PA.newKey();
    try { await P.save(k, titled(i)); keys.push(k); } catch (e) { refused.push([i, e.message]); }
  }
  assert.deepEqual(refused, [[2000, 'too many documents'], [2001, 'too many documents'], [2002, 'too many documents']]);
  const list = await P.list();
  assert.equal(PA.CAP.rows, 2000);
  assert.equal(list.length, 2000);
  assert.deepEqual(recordsOf(store.data).sort(), keys.slice().sort(), 'every stored document is a listed one');
  assert.deepEqual(list.map((r) => r.key).sort(), keys.slice().sort());
  assert.ok(list.some((r) => r.key === keys[0]), 'the oldest is still listed');
  assert.equal(Object.keys(store.data).filter((k) => k.startsWith('writerVersions:')).length, 0, 'the refused three left no versions either');
});

test('at the cap a document already listed still saves, goes to Trash and comes back; a new one fits once one is deleted', async () => {
  const store = memory();
  let t = 0;
  const P = PA.open(store, () => 1e12 + ++t);
  const keys = [];
  // The index written as 2,000 saves leave it, without 2,000 round trips.
  for (let i = 0; i < 3; i++) { const k = PA.newKey(); keys.push(k); await P.save(k, titled(i)); }
  const rows = Array.from({ length: 2000 }, (_, i) => ({ key: i < 3 ? keys[i] : `doc:filler-${i}`, kind: 'paper', named: true, title: `r${i}`, updated: 1 }));
  store.data.writerPapers = rows;
  const fresh = PA.newKey();
  await assert.rejects(P.save(fresh, titled(9)), /too many documents/);
  assert.equal(store.data[`writerPaper:${fresh}`], undefined);
  assert.equal(store.data.writerPapers.length, 2000);
  assert.equal((await P.save(keys[1], { title: 'Renamed', named: true }, { rename: true })).paper.title, 'Renamed');
  assert.equal(store.data.writerPapers.length, 2000, 'a save of a listed one keeps the count');
  assert.deepEqual(await P.trash(keys[2]), { key: keys[2], trashed: 1e12 + t });
  await P.untrash(keys[2]);
  await assert.rejects(P.save(fresh, titled(9)), /too many documents/, 'Trash still counts: it is in the list');
  await P.remove(keys[0]);
  await P.save(fresh, titled(9));
  assert.equal(store.data.writerPapers.length, 2000);
  assert.equal(store.data.writerPapers[0].key, fresh);
});

test('a refused document claims nothing in the file store, and a backup replay past the cap is refused before it claims', async () => {
  const store = memory(), owned = [];
  let t = 0;
  const files = { own: async (owner, hashes) => { owned.push([owner, hashes]); return { missing: [] }; } };
  const P = PA.open(store, () => 1e12 + ++t, { files });
  store.data.writerPapers = Array.from({ length: 2000 }, (_, i) => ({ key: `doc:filler-${i}`, kind: 'paper', named: true, title: `r${i}`, updated: 1 }));
  const file = { hash: 'a'.repeat(64), size: 10, type: 'application/pdf' };
  const k = PA.newKey();
  await assert.rejects(P.save(k, { kind: 'pdf', file, size: 10, pages: 1, title: 'Scan', named: true }), /too many documents/);
  const backed = PA.newKey();
  await assert.rejects(P.merge({ [`writerPaper:${backed}`]: { key: backed, kind: 'pdf', file, size: 10, pages: 1, title: 'Back', named: true, updated: 5, revision: 1 } }), /too many documents/);
  assert.deepEqual(owned, [], 'the file store was never told about either');
  assert.deepEqual(recordsOf(store.data), []);
  assert.equal(store.data.writerPapers.length, 2000);
});
