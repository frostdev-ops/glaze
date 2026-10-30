const test = require('node:test');
const assert = require('node:assert/strict');
const { model, host } = require('../fixtures/local-engine.js');

test('Q6_K uploads crossing 32 MiB keep every write word aligned and cover the whole tensor', async () => {
  const h = host(), g = model({ vocab: 180001 });
  const e = await h.create(g);
  const t = e._k.tensor('token_embd.weight'), r = t.runs[0];
  const writes = h.writes.filter((w) => w.buffer === r.bind.buffer && w.offset >= r.offset && w.offset < r.offset + t.bytes);
  assert.ok(writes.length > 1);
  assert.equal(writes[0].offset, r.offset);
  for (let i = 1; i < writes.length; i++) assert.equal(writes[i].offset, writes[i - 1].offset + writes[i - 1].size);
  assert.equal(writes.reduce((n, w) => n + w.size, 0), Math.ceil(t.bytes / 4) * 4);
  e.destroy();
});

test('session rejects invalid context and chunk sizes before allocating GPU resources', async () => {
  const h = host(), e = await h.create();
  const before = h.buffers.length;
  for (const key of ['ctx', 'chunk']) for (const value of [0, -1, 1.5, NaN, Infinity, 2 ** 32]) {
    await assert.rejects(e.session({ ctx: 8, chunk: 2, [key]: value }), new RegExp(key));
    assert.equal(h.buffers.length, before);
  }
  const s = await e.session({ ctx: 8, chunk: 2 });
  await s.forward([1, 2, 3], { logits: 'none' });
  assert.equal(s.pos, 3);
  s.destroy(); e.destroy();
});

test('forward rejects noninteger topK before consuming tokens', async () => {
  const h = host(), e = await h.create(), s = await e.session({ ctx: 8, chunk: 2 });
  for (const k of [1.5, NaN, -1, 65]) {
    await assert.rejects(s.forward([1], { logits: 'none', topK: k }), /topK/);
    assert.equal(s.pos, 0);
  }
  await s.forward([1], { logits: 'none', topK: 0 });
  assert.equal(s.pos, 1);
  s.destroy(); e.destroy();
});

test('topK merges every candidate for vocabularies larger than 131072 without exceeding a workgroup capacity', async () => {
  const h = host(), e = await h.create(model({ vocab: 140000 })), s = await e.session({ ctx: 8, chunk: 1 });
  for (const k of [64, 1, 50]) {
    h.dispatches.length = 0;
    await s.forward([1], { logits: 'none', topK: k });
    const merges = h.dispatches.filter((d) => d.pipeline.compute.module.code.includes('var picked') && !d.pipeline.compute.module.code.includes('var<storage, read> L:'));
    assert.ok(merges.length > 0);
    let candidates = Math.ceil(140000 / 2048) * k;
    for (const d of merges) {
      const u = d.group.entries.find((e) => e.binding === 3).resource;
      const p = new Uint32Array(u.buffer.data.buffer, u.offset, 4), groups = d.dims[0];
      assert.equal(p[2] * p[1], candidates);
      assert.ok(Math.ceil(candidates / groups) <= 4096, `${candidates} candidates need more than ${groups} workgroup(s)`);
      candidates = groups * k;
    }
    assert.equal(candidates, k);
  }
  s.destroy(); e.destroy();
});

test('failed weight reads release every weight buffer before a retry', async () => {
  const h = host(), g = model(), read = g.read;
  let reads = 0;
  g.read = async (...a) => { if (++reads === 2) throw new Error('read failed'); return read(...a); };
  await assert.rejects(h.create(g), /read failed/);
  assert.ok(h.buffers.length > 0);
  assert.ok(h.buffers.every((b) => b.destroyed));
  const e = await h.create(); e.destroy();
});

test('matrix shapes are checked against the graph before uploading weights', async () => {
  for (const name of ['token_embd.weight', 'blk.0.ffn_gate.weight', 'blk.0.ffn_up.weight', 'blk.0.ffn_down.weight', 'blk.0.shortconv.in_proj.weight', 'blk.0.shortconv.out_proj.weight']) {
    const h = host(), g = model(), t = g.tensor(name);
    t.dims = [t.dims[0] * 2, t.dims[1]];
    t.count *= 2; t.bytes *= 2;
    await assert.rejects(h.create(g), /shape|expected/, name);
    assert.equal(h.writes.length, 0);
  }
});

test('failed session compilation releases its allocations', async () => {
  const h = host(), e = await h.create(), before = h.buffers.length;
  h.device.createComputePipelineAsync = async () => { throw new Error('compile failed'); };
  await assert.rejects(e.session({ ctx: 8, chunk: 2 }), /compile failed/);
  assert.ok(h.buffers.length > before);
  assert.ok(h.buffers.slice(before).every((b) => b.destroyed));
  e.destroy();
});

test('engine destruction releases live sessions and prevents use after destruction', async () => {
  const h = host(), e = await h.create(), s = await e.session({ ctx: 8, chunk: 2 });
  e.destroy();
  assert.ok(h.buffers.every((b) => b.destroyed));
  await assert.rejects(s.forward([1], { logits: 'none' }), /destroyed/);
  await assert.rejects(e.session({ ctx: 8, chunk: 2 }), /destroyed/);
});

test('destroying the engine during asynchronous compilation cancels the unfinished session', async () => {
  const h = host(), e = await h.create(), compile = h.device.createComputePipelineAsync;
  let entered, resume;
  const started = new Promise((r) => { entered = r; }), pause = new Promise((r) => { resume = r; });
  h.device.createComputePipelineAsync = async (d) => { entered(); await pause; return compile(d); };
  const pending = e.session({ ctx: 8, chunk: 2 });
  await started;
  e.destroy(); resume();
  await assert.rejects(pending, /destroyed/);
  assert.ok(h.buffers.every((b) => b.destroyed));
});
