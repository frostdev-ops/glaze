// The local engine's model interface (ai/local/engine.js load(), as ai/local/host.js drives it) on a recording WebGPU
// double: its contracts, cancellation, snapshots, release and load failure reasons, and the sampler's JavaScript end. What
// the kernels compute (a mask forcing a token, snapshot and restore giving the same greedy tokens) runs on a GPU in
// checks/ai/local-engine-check.js small, in the browser gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const { model, host } = require('../fixtures/local-engine.js');

const reason = (r) => (e) => e.reason === r;

test('the sampler: top-p keeps the smallest head reaching p, temperature sharpens, nothing allowed throws', () => {
  const { engine: E } = host();
  const top = [{ id: 7, logit: 2 }, { id: 3, logit: 1 }, { id: 9, logit: 0 }];
  // p(7) ≈ 0.665 at temperature 1: topP 0.6 keeps only 7, whatever the draw.
  for (const r of [0, 0.5, 0.999]) assert.equal(E.sample(top, { temperature: 1, topP: 0.6 }, () => r), 7);
  // topP 0.9 keeps 7 and 3 (0.665 + 0.245): a draw near 1 lands on 3, never 9.
  assert.equal(E.sample(top, { temperature: 1, topP: 0.9 }, () => 0.999), 3);
  assert.equal(E.sample(top, { temperature: 1 }, () => 0.999), 9);
  // A tiny temperature puts nearly all the weight on the highest.
  assert.equal(E.sample(top, { temperature: 0.01 }, () => 0.999), 7);
  assert.throws(() => E.sample([], {}), /no token is allowed/);
});

test('decode before anything is fed, with a bad sampler, or a mask of the wrong size, refuses before any GPU work', async () => {
  const h = host(), m = await h.load(model(), { context: 32, chunk: 4 });
  await assert.rejects(m.decode({ sampler: { temperature: 0 } }), /nothing fed/);
  await m.prefill([1, 2, 3]);
  const before = h.submissions.length;
  await assert.rejects(m.decode({ sampler: { temperature: -1 } }), /temperature/);
  await assert.rejects(m.decode({ sampler: { topP: 0 } }), /topP/);
  await assert.rejects(m.decode({ sampler: { topK: 1.5 } }), /topK/);
  await assert.rejects(m.decode({ sampler: { temperature: 0 }, mask: new Uint32Array(2) }), /mask: a Uint32Array of 1 words/);
  assert.equal(h.submissions.length, before);
  m.release();
});

test('a decoded token is part of the sequence: the next decode or prefill feeds it first', async () => {
  const h = host(), m = await h.load(model(), { context: 32, chunk: 4 });
  await m.prefill([1, 2, 3]);
  assert.equal(m.pos, 3);
  await m.decode({ sampler: { temperature: 0 } });
  assert.equal(m.pos, 4);
  await m.decode({ sampler: { temperature: 0, topK: 5 } });
  assert.equal(m.pos, 5);
  await m.prefill([4]);
  assert.equal(m.pos, 6);
  m.release();
});

test('cancel: an aborted signal rejects prefill and decode with its reason, before any GPU work', async () => {
  const h = host(), m = await h.load(model(), { context: 32, chunk: 4 });
  await m.prefill([1, 2]);
  const c = new AbortController(), why = new Error('stop');
  c.abort(why);
  const before = h.submissions.length;
  await assert.rejects(m.prefill([3, 4], { signal: c.signal }), (e) => e === why);
  await assert.rejects(m.decode({ sampler: { temperature: 0 }, signal: c.signal }), (e) => e === why);
  assert.equal(h.submissions.length, before);
  assert.equal(m.pos, 2);
  m.release();
});

test('cancel during a long prefill stops at the next chunk and keeps what was fed', async () => {
  const h = host(), m = await h.load(model(), { context: 64, chunk: 4 });
  // As in a browser, the GPU's work finishes in a later task.
  h.device.queue.onSubmittedWorkDone = () => new Promise((r) => setTimeout(r, 1));
  const c = new AbortController(), why = new Error('stop');
  const run = m.prefill(Array.from({ length: 20 }, (_, i) => i % 8), { signal: c.signal });
  setTimeout(() => c.abort(why), 0);
  await assert.rejects(run, (e) => e === why);
  assert.ok(m.pos > 0 && m.pos < 20 && m.pos % 4 === 0, `stopped at ${m.pos}`);
  m.release();
});

test('snapshots: restore brings back the position and the pending token; a dropped or foreign one is refused', async () => {
  const h = host(), m = await h.load(model(), { context: 32, chunk: 4 }), other = await h.load(model(), { context: 32, chunk: 4 });
  const base = await m.snapshot();
  const snap = await m.prefill([1, 2, 3], { snapshot: true });
  await m.decode({ sampler: { temperature: 0 } });
  await m.decode({ sampler: { temperature: 0 } });
  assert.equal(m.pos, 5);
  await m.restore(snap);
  assert.equal(m.pos, 3);
  await m.decode({ sampler: { temperature: 0 } });
  assert.equal(m.pos, 4);
  await m.restore(base);
  assert.equal(m.pos, 0);
  await assert.rejects(m.decode({ sampler: { temperature: 0 } }), /nothing fed/);
  snap.drop();
  await assert.rejects(m.restore(snap), /not a live snapshot/);
  await assert.rejects(other.restore(base), /not a live snapshot/);
  m.release(); other.release();
});

test('release frees every GPU buffer, snapshots included, and the device the engine made', async () => {
  const h = host();
  let gone = 0;
  h.device.destroy = () => { gone++; };
  const m = await h.load(model(), { context: 32, chunk: 4 });
  await m.prefill([1, 2, 3], { snapshot: true });
  await m.snapshot();
  m.release();
  assert.deepEqual(h.buffers.filter((b) => !b.destroyed).map((b) => b.size), []);
  assert.equal(gone, 1);
  await assert.rejects(m.decode({ sampler: {} }), /released/);
  m.release();
});

test('load failures say why: model, webgpu, memory; an abort rejects with its reason and leaves nothing', async () => {
  const bad = model();
  const tensor = bad.tensor;
  bad.tensor = (n) => (n === 'blk.0.ffn_down.weight' ? null : tensor(n));
  await assert.rejects(host().load(bad), reason('model'));
  await assert.rejects(host().load(model(), { adapter: undefined }), reason('webgpu'));
  const h = host();
  let once = true;
  h.device.pushErrorScope = () => {};
  h.device.popErrorScope = async () => (once ? ((once = false), { message: 'out of memory' }) : null);
  await assert.rejects(h.load(model()), reason('memory'));
  assert.deepEqual(h.buffers.filter((b) => !b.destroyed).length, 0);
  const a = host(), c = new AbortController(), why = new Error('stop');
  c.abort(why);
  await assert.rejects(a.load(model(), { signal: c.signal }), (e) => e === why);
  assert.equal(a.buffers.filter((b) => !b.destroyed).length, 0);
});
