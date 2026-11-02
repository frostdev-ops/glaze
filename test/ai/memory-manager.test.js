const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../extension/ai/memory.js');
const UI = require('../../extension/ai/memory-manager.js');
const A = 'https://school.example/42', B = 'https://school.example/43';
const setup = async () => {
  const values = {}, local = { get: async (k) => Object.fromEntries((k == null ? Object.keys(values) : [].concat(k)).filter((x) => x in values).map((x) => [x, structuredClone(values[x])])), set: async (o) => Object.assign(values, structuredClone(o)) };
  let time = 1000, serial = 0, enabled = false;
  const store = M.open({ local, now: () => ++time, random: () => (++serial).toString(16).padStart(32, '0') });
  const a = await store.save(A, { text: 'Use short paragraphs.', evidence: 'Use short paragraphs.', category: 'preference' });
  const b = await store.save(B, { text: 'I study biology.', evidence: 'I study biology.' });
  const env = { store, state: async () => enabled, setEnabled: async (v) => { enabled = v; return true; } };
  return { env, store, a: a.receipt, b: b.receipt, values };
};
const request = (op, rest = {}) => ({ type: 'glaze:memory', op, ...rest });

test('trusted settings manage stored accounts even when memory is off', async () => {
  const { env } = await setup();
  assert.deepEqual(await UI.run(request('state'), { ...env, all: true }), { ok: true, enabled: false });
  const listed = await UI.run(request('list', { kind: 'memory' }), { ...env, all: true });
  assert.equal(listed.ok, true); assert.equal(listed.records.length, 2);
  assert.deepEqual(new Set(listed.records.map((r) => r.account)), new Set([A, B]));
});
test('page management stays within the verified account and rejects claimed authority', async () => {
  const { env, b } = await setup();
  const scope = { ...env, account: A };
  const list = await UI.run(request('list', { kind: 'memory' }), scope);
  assert.equal(list.records.length, 1); assert.equal(list.records[0].account, A);
  assert.equal((await UI.run(request('forget', { id: b.id, revision: b.revision }), scope)).ok, false);
  for (const extra of [{ account: B }, { all: true }, { store: {} }]) assert.equal((await UI.run(request('list', { kind: 'memory', ...extra }), scope)).ok, false);
  assert.equal((await UI.run(request('settings', { enabled: true }), scope)).ok, false);
  assert.equal((await UI.run(request('export'), scope)).ok, false);
});
test('editor updates use current revisions and return conflicts without replacing newer text', async () => {
  const { env, a } = await setup(), scope = { ...env, all: true };
  const saved = await UI.run(request('update', { id: a.id, revision: a.revision, markdown: 'Use examples.' }), scope);
  assert.equal(saved.ok, true); assert.equal(saved.receipt.operation, 'updated');
  const conflict = await UI.run(request('update', { id: a.id, revision: a.revision, markdown: 'Old edit.' }), scope);
  assert.equal(conflict.error, 'conflict'); assert.equal(conflict.current.markdown, 'Use examples.');
});
test('snapshot clear preserves newly created memories and export omits forgotten text', async () => {
  const { env, store, a, b } = await setup(), scope = { ...env, all: true };
  await store.save(A, { text: 'I take chemistry.', evidence: 'I take chemistry.' });
  const cleared = await UI.run(request('clear', { kind: 'memory', records: [a, b].map(({ id, revision }) => ({ id, revision })) }), scope);
  assert.equal(cleared.ok, true); assert.equal(cleared.receipts.length, 2);
  const out = await UI.run(request('export'), scope);
  assert.match(out.markdown, /I take chemistry/); assert.doesNotMatch(out.markdown, /short paragraphs|study biology/);
});
test('malformed messages and unscoped access change nothing', async () => {
  const { env } = await setup();
  for (const m of [null, {}, request('clear', { kind: 'memory' }), request('settings', { enabled: 'yes' }), request('update', { id: 'm-bad', revision: 'bad', markdown: 'x' }), request('unknown')]) {
    assert.equal((await UI.run(m, { ...env, all: true })).ok, false);
  }
  assert.equal((await UI.run(request('list', { kind: 'memory' }), env)).ok, false);
  assert.equal((await env.store.listAll()).items.length, 2);
});
test('failed switch persistence reports failure and leaves durable memory untouched', async () => {
  const { env } = await setup();
  const r = await UI.run(request('settings', { enabled: true }), { ...env, all: true, setEnabled: async () => false });
  assert.equal(r.ok, false); assert.equal((await env.store.listAll()).items.length, 2);
});
