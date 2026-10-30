const test = require('node:test');
const assert = require('node:assert/strict');
const { model, host } = require('../fixtures/local-engine.js');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('rejected prefill preserves ready logits', async () => {
  const h = host(), m = await h.load(model(), { context: 8, chunk: 2 });
  await m.prefill([1, 2]);
  await assert.rejects(m.prefill([99]), /token/);
  await m.decode({ sampler: { temperature: 0 } });
  assert.equal(m.pos, 3);
  m.release();
});

test('rejected prefill preserves a pending decoded token', async () => {
  const h = host(), m = await h.load(model(), { context: 8, chunk: 2 });
  await m.prefill([1, 2]);
  await m.decode({ sampler: { temperature: 0 } });
  await assert.rejects(m.prefill(Array(8).fill(1)), /context/);
  assert.equal(m.pos, 3);
  await m.prefill([4]);
  assert.equal(m.pos, 4);
  m.release();
});

test('overlapping model calls cannot feed the pending token twice', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  await m.prefill([1]);
  await m.decode({ sampler: { temperature: 0 } });
  const results = await Promise.allSettled([m.decode({ sampler: { temperature: 0 } }), m.prefill([2])]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.match(results[1].reason.message, /running/);
  assert.equal(m.pos, 3);
  m.release();
});

test('a snapshot holds the session lock while allocation is checked', async () => {
  const h = host(), e = await h.create(), s = await e.session({ ctx: 16, chunk: 2 });
  const gate = deferred();
  h.device.popErrorScope = () => gate.promise;
  const pending = s.snapshot();
  try {
    await assert.rejects(s.forward([1], { logits: 'keep' }), /running/);
    await assert.rejects(s.snapshot(), /running/);
  } finally { gate.resolve(null); (await pending).drop(); e.destroy(); }
});

test('release during snapshot allocation rejects the snapshot and frees its buffers', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  await m.prefill([1]);
  const gate = deferred();
  h.device.popErrorScope = () => gate.promise;
  const pending = m.snapshot();
  m.release(); gate.resolve(null);
  await assert.rejects(pending, /destroyed|released/);
  assert.ok(h.buffers.every((b) => b.destroyed));
});

test('cancelled prefill remembers the tokens actually submitted for repetition penalties', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  const c = new AbortController(), why = new Error('stop');
  h.device.queue.onSubmittedWorkDone = async () => { c.abort(why); };
  await assert.rejects(m.prefill([1, 2, 3, 4], { signal: c.signal }), (e) => e === why);
  assert.equal(m.pos, 2);
  await m.prefill([5]);
  await m.decode({ sampler: { temperature: 0, repetitionPenalty: 2 } });
  const d = h.dispatches.find((d) => d.pipeline.compute.module.code.includes('L[id] ='));
  const ids = d.group.entries.find((e) => e.binding === 1).resource.buffer;
  assert.deepEqual([...new Uint32Array(ids.data.buffer).slice(0, 3)], [1, 2, 5]);
  m.release();
});

test('decode validates masks before feeding a pending token', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  await m.prefill([1]);
  await m.decode({ sampler: { temperature: 0 } });
  const before = h.submissions.length;
  await assert.rejects(m.decode({ sampler: { temperature: 0 }, mask: new Uint32Array(2) }), /mask/);
  assert.equal(h.submissions.length, before);
  assert.equal(m.pos, 2);
  m.release();
});

test('decode rejects non-finite and non-numeric sampler values', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  await m.prefill([1]);
  const before = h.submissions.length;
  for (const [key, value] of [['temperature', Infinity], ['temperature', '1'], ['topP', '0.5'], ['repetitionPenalty', Infinity], ['repetitionPenalty', '2']]) {
    await assert.rejects(m.decode({ sampler: { temperature: 0, [key]: value } }), new RegExp(key));
  }
  assert.equal(h.submissions.length, before);
  m.release();
});

test('decode cannot produce a sequence longer than its context', async () => {
  const h = host(), m = await h.load(model(), { context: 2, chunk: 2 });
  await m.prefill([1]);
  await m.decode({ sampler: { temperature: 0 } });
  const before = h.submissions.length;
  await assert.rejects(m.decode({ sampler: { temperature: 0 } }), /context/);
  assert.equal(m.pos, 2);
  assert.equal(h.submissions.length, before);
  m.release();
});

test('cancellation during the final prefill chunk rejects with its reason', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  const c = new AbortController(), why = new Error('stop at submit');
  const submit = h.device.queue.submit;
  h.device.queue.submit = (commands) => { submit(commands); c.abort(why); };
  await assert.rejects(m.prefill([1], { signal: c.signal }), (e) => e === why);
  assert.equal(m.pos, 1);
  m.release();
});

test('cancellation during decode readback rejects without adding a token', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  await m.prefill([1]);
  const d = new AbortController(), stop = new Error('stop at readback');
  const allocate = h.device.createBuffer;
  h.device.createBuffer = (desc) => {
    const b = allocate(desc);
    if (desc.usage & 8) b.mapAsync = async () => { d.abort(stop); };
    return b;
  };
  await assert.rejects(m.decode({ sampler: { temperature: 0 }, signal: d.signal }), (e) => e === stop);
  assert.equal(m.pos, 1);
  await m.decode({ sampler: { temperature: 0 } });
  assert.equal(m.pos, 2);
  m.release();
});

test('a failed GPU readback always destroys its staging buffer', async () => {
  const h = host(), m = await h.load(model(), { context: 16, chunk: 2 });
  await m.prefill([1]);
  const allocate = h.device.createBuffer, why = new Error('mapping failed');
  h.device.createBuffer = (desc) => {
    const b = allocate(desc);
    if (desc.usage & 8) b.mapAsync = async () => { throw why; };
    return b;
  };
  await assert.rejects(m.decode({ sampler: { temperature: 0 } }), (e) => e === why);
  m.release();
  assert.ok(h.buffers.every((b) => b.destroyed));
});

test('load checks cancellation before adapter work', async () => {
  const h = host(), c = new AbortController(), why = new Error('stop');
  c.abort(why);
  await assert.rejects(h.load(model(), { signal: c.signal, adapter: undefined }), (e) => e === why);
});

test('load checks cancellation after asynchronous weight reads', async () => {
  const why = new Error('stop');
  const a = host(), g = model(), d = new AbortController(), read = g.read;
  g.read = async (...args) => { const bytes = await read(...args); d.abort(why); return bytes; };
  await assert.rejects(a.load(g, { signal: d.signal }), (e) => e === why);
  assert.equal(a.writes.length, 0);
  assert.ok(a.buffers.every((b) => b.destroyed));
});

test('device loss during session compilation makes load reject with reason lost', async () => {
  const h = host(), gone = deferred(), compile = h.device.createComputePipelineAsync;
  h.device.lost = gone.promise;
  h.device.createComputePipelineAsync = async (desc) => { gone.resolve({ message: 'device disappeared' }); return compile(desc); };
  await assert.rejects(h.load(model(), { context: 16, chunk: 2 }), (e) => e.reason === 'lost');
  assert.ok(h.buffers.every((b) => b.destroyed));
});

test('a failed penalized pick leaves raw logits intact for retries and snapshots', async () => {
  const h = host(), e = await h.create(), s = await e.session({ ctx: 16, chunk: 2 });
  // Execute only the penalty shader on the recording device. The graph and argmax are irrelevant to this assertion.
  h.device.execute = (d) => {
    if (!d.pipeline.compute.module.code.includes('L[id] =')) return;
    const binding = (n) => d.group.entries.find((e) => e.binding === n).resource;
    const logits = binding(0).buffer, ids = new Uint32Array(binding(1).buffer.data.buffer);
    const u = binding(2), words = new Uint32Array(u.buffer.data.buffer, u.offset, 4);
    const r = new Float32Array(words.buffer, words.byteOffset, 4)[1];
    logits.data ||= new Uint8Array(logits.size);
    const values = new Float32Array(logits.data.buffer);
    for (let i = 0; i < words[0]; i++) values[ids[i]] = values[ids[i]] > 0 ? values[ids[i]] / r : values[ids[i]] * r;
  };
  await s.forward([1], { logits: 'keep' });
  const last = h.dispatches.at(-1).group.entries.find((e) => e.binding === 2).resource.buffer;
  last.data = new Uint8Array(Float32Array.of(8, -4, 1, 0, 0, 0, 0, 0).buffer);
  const expected = [...new Float32Array(last.data.buffer)];
  const allocate = h.device.createBuffer;
  h.device.createBuffer = (desc) => {
    const b = allocate(desc);
    if (desc.usage & 8) b.mapAsync = async () => { throw new Error('readback failed'); };
    return b;
  };
  await assert.rejects(s.pick({ penalty: { ids: [0, 1], r: 2 } }), /readback failed/);
  assert.deepEqual([...new Float32Array(last.data.buffer)], expected);
  e.destroy();
});

test('failed session compilation balances device error scopes', async () => {
  const h = host(), e = await h.create();
  let depth = 0;
  h.device.pushErrorScope = () => { depth++; };
  h.device.popErrorScope = async () => { depth--; return null; };
  h.device.createComputePipelineAsync = async () => { throw new Error('compile failed'); };
  await assert.rejects(e.session({ ctx: 16, chunk: 2 }), /compile failed/);
  assert.equal(depth, 0);
  e.destroy();
});

test('session rejects buffers beyond device limits with reason memory', async () => {
  for (const limit of ['maxBufferSize', 'maxStorageBufferBindingSize']) {
    const h = host(), e = await h.create();
    h.device.limits[limit] = 2048;
    await assert.rejects(e.session({ ctx: 16, chunk: 4 }), (error) => error.reason === 'memory');
    e.destroy();
    assert.ok(h.buffers.every((b) => b.destroyed));
  }
});
