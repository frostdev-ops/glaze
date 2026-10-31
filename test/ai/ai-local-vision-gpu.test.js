// The picture encoder on WebGPU (ai/local/vision.js), host side: sizes, uniforms, the RoPE table, the load's failure
// reasons, cancelling, releasing and the device's binding limits, on a recording WebGPU double. The kernels' numbers are
// checks/ai/local-vision-gpu-check.js's (small: each kernel against a CPU computation; model: the real projector).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projector, host, picture } = require('../fixtures/local-vision.js');
const V = require('../../extension/ai/local/vision.js');
const VR = require('../../extension/ai/local/vision-reference.js');
const EN = require('../../extension/ai/local/engine.js');

const reasonOf = (reason, message) => (e) => { assert.equal(e.reason, reason, `${e.message}`); if (message) assert.match(e.message, message); return true; };

test('prepare gives the reference\'s resized size and the tokens it makes, and checks the bytes', async () => {
  const h = host(), enc = await h.load();
  const c = enc.config;
  for (const [w, hh] of [[360, 240], [61, 47], [1, 1], [4000, 20], [1023, 769], [1920, 1080]]) {
    const t = VR.targetSize(c, w, hh), got = { ...enc.prepare({ width: w, height: hh }) };
    assert.deepEqual(got, { width: t.width, height: t.height, tokens: (t.width / 32) * (t.height / 32) }, `${w} × ${hh}`);
  }
  assert.deepEqual({ ...enc.prepare(picture(64, 64)) }, { width: 64, height: 64, tokens: 4 });
  assert.throws(() => enc.prepare({ width: 4, height: 4, data: new Uint8Array(15) }), /15 bytes/);
  assert.throws(() => enc.prepare({ width: 0, height: 4 }), /0 × 4/);
  assert.equal(enc.prepare({ width: 10, height: 10, data: new Uint8Array(300), channels: 3 }).tokens, 4);
  enc.release();
});

test('the RoPE table is the reference\'s 2-D angles: rows first, then columns, θ in double rounded to f32', () => {
  const px = 6, py = 4, hd = 64, base = 1e6, t = V.ropeTable(px, py, hd, base);
  assert.equal(t.length, px * py * hd);
  for (const [tt, j] of [[0, 0], [7, 3], [7, 16], [23, 31], [13, 20]]) {
    const yy = Math.floor(tt / px), xx = tt % px, q = hd / 4;
    const theta = (j < q ? yy : xx) * base ** ((-2 * (j % q)) / (hd / 2));
    assert.equal(t[(tt * 32 + j) * 2], Math.fround(Math.cos(theta)));
    assert.equal(t[(tt * 32 + j) * 2 + 1], Math.fround(Math.sin(theta)));
  }
});

test('uniforms are four words in each kernel\'s field order, floats as their bits', () => {
  const bits = (x) => new Uint32Array(Float32Array.of(x).buffer)[0];
  assert.deepEqual([...V.PARAMS.matmul({ rows: 1024, K: 768, T: 77 })], [1024, 768, 77, 0]);
  assert.deepEqual([...V.PARAMS.attention({ T: 9, H: 16, Hkv: 8, scale: 0.125 })], [9, 16, 8, bits(0.125)]);
  assert.deepEqual([...V.PARAMS.rope({ H: 16, Hkv: 8, eps: 1e-5 })], [16, 8, bits(1e-5), 0]);
  assert.deepEqual([...V.PARAMS.conv({ px: 6, py: 4, E: 1024 })], [6, 4, 1024, 0]);
  assert.deepEqual([...V.PARAMS.norm({ n: 1024, eps: 1e-6, px: 6 })], [1024, bits(1e-6), 6, 0]);
  assert.deepEqual([...V.PARAMS.patch({ n: 100, px: 6, P: 16 })], [100, 6, 16, 0]);
  assert.deepEqual([...V.PARAMS.glu({ n: 5 })], [5, 0, 0, 0]);
  for (const k of V.KERNELS) {
    const src = fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/vision-${k}.wgsl`), 'utf8');
    assert.match(src, /struct P \{ \w+: \w+, \w+: \w+, \w+: \w+, \w+: \w+ \}/, `${k}: four words`);
  }
});

test('every vision kernel is shipped and balanced under every define it uses', () => {
  for (const k of V.KERNELS) {
    const src = fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/vision-${k}.wgsl`), 'utf8');
    const list = [...new Set([...src.matchAll(/^\s*\/\/#if (.*)$/gm)].flatMap((m) => m[1].split(/\|\||&&/).map((s) => s.trim().replace(/^!/, ''))))];
    for (let mask = 0; mask < 2 ** list.length; mask++) {
      const d = Object.fromEntries(list.map((n, i) => [n, !!(mask & (1 << i))]));
      assert.doesNotMatch(EN.preprocess(src, d), /\/\/#/, `${k} ${JSON.stringify(d)}`);
    }
  }
});

test('GEMM workgroup vectors are stored whole: concurrent component writes can overwrite other lanes', () => {
  // WGSL permits a vector-component store to read/write the whole vector, even when other invocations write
  // different components. A barrier after those writes cannot repair the race. Each tile vector needs one writer.
  const src = fs.readFileSync(path.join(__dirname, '../../extension/ai/local/kernels/vision-matmul.wgsl'), 'utf8');
  const tiles = [...src.matchAll(/var<workgroup> (\w+): array<vec4<H>,/g)].map((m) => m[1]);
  assert.equal(tiles.length, 2);
  for (const tile of tiles) assert.doesNotMatch(src, new RegExp(`\\b${tile}\\[[^;\\n]+\\]\\[[^;\\n]+\\]\\s*=`), `${tile}: write a complete vector per invocation`);
});

test('the FFN runs whole, or in chunks of 64 tokens under the binding limit', () => {
  assert.equal(V.ffnChunk(4096, 2560, 2 ** 31), 4096);
  assert.equal(V.ffnChunk(16384, 2560, 128 * 2 ** 20), 13056);
  assert.equal(V.ffnChunk(16384, 2560, 128 * 2 ** 20) * 2560 * 4 <= 128 * 2 ** 20, true);
  assert.throws(() => V.ffnChunk(100, 2560, 64 * 2560 * 4 - 1), (e) => e.reason === 'memory');
});

test('load errors carry a reason: webgpu, model, memory, lost', async () => {
  // no WebGPU
  {
    const h = host();
    h.context.navigator = {};
    await assert.rejects(h.V.load(projector(), { kernels: () => '' }), reasonOf('webgpu', /no WebGPU/));
    h.context.navigator = { gpu: { requestAdapter: async () => null } };
    await assert.rejects(h.V.load(projector(), { kernels: () => '' }), reasonOf('webgpu', /adapter/));
    h.context.navigator = { gpu: { requestAdapter: async () => ({ ...h.adapter, requestDevice: async () => { throw new Error('nope'); } }) } };
    await assert.rejects(h.V.load(projector(), { kernels: () => '' }), reasonOf('webgpu', /no device/));
  }
  // f16 asked of a device without it; a kernel the device refuses
  {
    const h = host();
    await assert.rejects(h.load(projector(), { precision: 'f16' }), reasonOf('webgpu', /shader-f16/));
    h.device.createComputePipelineAsync = async () => { throw new Error('bad shader'); };
    await assert.rejects(h.load(), reasonOf('webgpu', /bad shader/));
    assert.deepEqual(h.live(), []);
  }
  // the model: another projector, a missing tensor, a shape, a type without a kernel, a bias lfm3vl doesn't have
  {
    const h = host();
    await assert.rejects(h.load(projector({ kv: { 'clip.vision.projector_type': 'qwen3vl' } })), reasonOf('model', /lfm3vl/));
    await assert.rejects(h.load(projector({ drop: ['v.blk.1.attn_k.weight'] })), reasonOf('model', /no v\.blk\.1\.attn_k\.weight/));
    await assert.rejects(h.load(projector({ H: 4, Hkv: 2, E: 128 })), reasonOf('model', /head size 32/));
    await assert.rejects(h.load(projector({ matrixType: 'Q8_0' })), reasonOf('model', /Q8_0 has no kernel/));
    await assert.rejects(h.load(projector({ extra: { 'v.blk.0.ffn_up.bias': { dims: [256] } } })), reasonOf('model', /bias/));
    assert.deepEqual(h.buffers, [], 'nothing allocated before the model is checked');
  }
  // memory: a tensor over the binding limit, or the weights out of memory (every buffer given back)
  {
    const h = host({ limits: { maxStorageBufferBindingSize: 256 * 1024 } });
    await assert.rejects(h.load(), reasonOf('memory', /mm\.0\.weight/));
    const h2 = host({ oom: (made) => made.length > 10 });
    await assert.rejects(h2.load(), reasonOf('memory', /weights/));
    assert.ok(h2.buffers.length > 10);
    assert.deepEqual(h2.live(), []);
  }
  // the device lost while the weights go up
  {
    const h = host();
    const g = projector(), read = g.read;
    g.read = async (...a) => { if (g.reads.length === 3) h.lose('reset'); await null; return read(...a); };
    await assert.rejects(h.load(g), reasonOf('lost', /reset/));
    assert.deepEqual(h.live(), []);
  }
});

test('a cancelled load stops reading weights and gives back what it made', async () => {
  const h = host(), ac = new AbortController(), g = projector(), read = g.read;
  g.read = async (...a) => { if (g.reads.length === 5) ac.abort(new Error('stop')); return read(...a); };
  await assert.rejects(h.load(g, { signal: ac.signal }), /stop/);
  assert.ok(g.reads.length <= 7, `${g.reads.length} reads`);
  assert.deepEqual(h.live(), []);
  // already aborted: nothing is made
  const h2 = host(), ac2 = new AbortController();
  ac2.abort();
  await assert.rejects(h2.load(projector(), { signal: ac2.signal }), (e) => e.name === 'AbortError');
  assert.deepEqual(h2.buffers, []);
});

test('load uses a supplied adapter without navigator.gpu', async () => {
  const h = host();
  delete h.context.navigator;
  const enc = await h.load(projector(), { device: null, adapter: h.adapter });
  assert.equal(enc.device, h.device);
  enc.release();
  assert.equal(h.device.destroyed, true);
  assert.deepEqual(h.live(), []);
});

test('a cancelled load stops within a multi-chunk weight before reading or uploading more', async () => {
  const h = host(), ac = new AbortController();
  const g = projector({ E: 1024, H: 16, Hkv: 8, mid: 8192, layers: [] }), read = g.read;
  let chunks = 0, writesAtCancel;
  g.read = async (...a) => {
    const bytes = await read(...a);
    if (a[0].name === 'mm.0.weight') { chunks++; writesAtCancel ??= h.writes.length; ac.abort(new Error('stop chunk')); }
    return bytes;
  };
  await assert.rejects(h.load(g, { signal: ac.signal }), /stop chunk/);
  assert.equal(chunks, 1, 'no next chunk after cancellation');
  assert.equal(h.writes.length, writesAtCancel, 'the cancelled read is not uploaded');
  assert.deepEqual(h.live(), []);
});

test('spatial weights from a Buffer range upload only that view, transposed channel by channel', async () => {
  const h = host(), g = projector({ layers: ['conv'] }), read = g.read;
  const name = 'v.blk.0.conv2d_spatial.weight', t = g.tensor(name), E = t.count / 9;
  const slab = Buffer.alloc(t.bytes + 8, 0x7f), bytes = slab.subarray(4, 4 + t.bytes);
  for (let e = 0; e < E; e++) for (let k = 0; k < 9; k++) bytes.writeFloatLE(e * 9 + k + 0.25, (e * 9 + k) * 4);
  g.read = async (...a) => a[0].name === name ? bytes : read(...a);
  const write = h.device.queue.writeBuffer, uploads = new Map();
  h.device.queue.writeBuffer = (b, offset, data, ...rest) => {
    if (data instanceof Float32Array || Object.prototype.toString.call(data) === '[object Float32Array]') uploads.set(b, Array.from(data));
    return write(b, offset, data, ...rest);
  };
  const enc = await h.load(g), uploaded = uploads.get(enc._k.weight(name).buf);
  assert.equal(uploaded.length, t.count);
  for (let k = 0; k < 9; k++) for (let e = 0; e < E; e++) assert.equal(uploaded[k * E + e], e * 9 + k + 0.25);
  enc.release();
  assert.deepEqual(h.live(), []);
});

test('a load that made its own device destroys it on failure and on release', async () => {
  const h = host();
  const enc = await h.V.load(projector(), { kernels: (n) => fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/vision-${n}.wgsl`), 'utf8') });
  assert.equal(enc.device, h.device);
  enc.release();
  assert.equal(h.device.destroyed, true);
  const h2 = host();
  await assert.rejects(h2.V.load(projector({ drop: ['mm.2.bias'] }), { kernels: () => '' }), reasonOf('model'));
  const h3 = host({ oom: () => true });
  await assert.rejects(h3.V.load(projector(), { kernels: () => '' }), reasonOf('memory'));
  assert.equal(h3.device.destroyed, true);
  // the text engine's device is never the encoder's to destroy
  const h4 = host(), e4 = await h4.load();
  e4.release();
  assert.equal(h4.device.destroyed, false);
});

test('encode: a buffer of tokens × the text width, every scratch buffer given back, drop frees the result', async () => {
  const h = host(), enc = await h.load(projector({ out: 64 }));
  const weights = h.live().length;
  const r = await enc.encode(picture(96, 64));
  assert.deepEqual([r.tokens, r.width, r.height], [6, 96, 64]);
  assert.equal(r.buffer.size, 6 * 64 * 4);
  assert.equal(r.buffer.destroyed, false);
  assert.equal(h.live().length, weights + 1, 'only the result stays');
  // one stage for the patches, one per layer, one for the projector, each waited for
  assert.equal(h.submissions.length, 1 + 2 + 1);
  r.drop(); r.drop();
  assert.equal(r.buffer.destroyed, true);
  assert.equal(h.live().length, weights);
  enc.release();
  assert.deepEqual(h.live(), []);
});

test('encode follows the graph: the patch kernels summed, conv and attention blocks, the projector with bias and GELU', async () => {
  const h = host(), enc = await h.load(projector({ layers: ['conv', 'attn', 'conv'] }));
  h.dispatches.length = 0;
  (await enc.encode(picture(64, 64))).drop();
  const kinds = h.dispatches.map((d) => {
    const code = d.pipeline.compute.module.code, k = code.match(/picture encoder's (\S+)/)[1];
    return k + (code.includes('Y[o] += v') ? '+' : '') + (/^\s*v = vec4<f32>\(gelu/m.test(code) ? ' gelu' : '');
  });
  assert.deepEqual(kinds.slice(0, 5), ['im2col:', 'tiled', 'tiled+', 'norms', 'norms']);
  assert.equal(kinds.filter((k) => k === "gated").length, 2);
  assert.equal(kinds.filter((k) => k === 'bidirectional').length, 1);
  assert.equal(kinds.filter((k) => k === 'q').length, 1);
  assert.deepEqual(kinds.slice(-3), ['norms', 'tiled gelu', 'tiled']);
  enc.release();
});

test('a cancelled encode stops between layers and gives back every buffer it made, the result too', async () => {
  const ac = new AbortController();
  let at = Infinity;
  const h = host({ onWork: (n) => { if (n === at) ac.abort(new Error('stop')); } });
  const enc = await h.load(projector({ layers: ['conv', 'attn', 'conv', 'attn'] }));
  const weights = h.live().length, before = h.submissions.length;
  at = before + 2;
  await assert.rejects(enc.encode(picture(64, 64), { signal: ac.signal }), /stop/);
  assert.equal(h.submissions.length, before + 2, 'no layer after the cancel');
  assert.equal(h.live().length, weights);
  // the encoder still works afterwards
  const r = await enc.encode(picture(64, 64));
  assert.equal(r.tokens, 4);
  r.drop();
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(enc.encode(picture(64, 64), { signal: pre.signal }), (e) => e.name === 'AbortError');
  assert.equal(h.live().length, weights);
  enc.release();
});

test('release frees the weights and every result not dropped, stops an encode under way, and refuses new ones', async () => {
  let enc = null;
  const h = host({ onWork: (n) => { if (n === 2 && enc) enc.release(); } });
  enc = await h.load();
  const first = h.submissions.length;
  assert.equal(first, 0);
  const pending = enc.encode(picture(64, 64));
  await assert.rejects(pending, /released/);
  assert.deepEqual(h.live(), []);
  const h2 = host(), e2 = await h2.load();
  const a = await e2.encode(picture(64, 64)), b = await e2.encode(picture(96, 96));
  b.drop();
  e2.release();
  assert.equal(a.buffer.destroyed, true);
  assert.deepEqual(h2.live(), []);
  await assert.rejects(e2.encode(picture(64, 64)), /released/);
});

test('encode out of memory, or with the device lost, says so and gives its buffers back', async () => {
  let oom = false;
  const h = host({ oom: () => oom }), enc = await h.load();
  const weights = h.live().length;
  oom = true;
  await assert.rejects(enc.encode(picture(64, 64)), reasonOf('memory'));
  assert.equal(h.live().length, weights);
  oom = false;
  h.lose('reset');
  await new Promise(setImmediate);
  await assert.rejects(enc.encode(picture(64, 64)), reasonOf('lost', /reset/));
  enc.release();
});

test('every binding stays within the device\'s limit: the FFN in chunks when its buffers would pass it', async () => {
  const F = 1024, limit = 3.5 * 2 ** 20; // 896 tokens of the FFN
  const h = host({ limits: { maxStorageBufferBindingSize: limit } }), enc = await h.load(projector({ F, E: 128, layers: ['conv'] }));
  h.dispatches.length = 0;
  const r = await enc.encode(picture(512, 512)); // 32 × 32 = 1024 patches
  assert.equal(r.tokens, 256);
  for (const d of h.dispatches) for (const e of d.group.entries) assert.ok((e.resource.size ?? e.resource.buffer.size) <= limit);
  const glu = h.dispatches.filter((d) => d.pipeline.compute.module.code.includes('SwiGLU'));
  assert.deepEqual(glu.map((d) => d.dims[0] * 256 * 4 / F), [896, 128], 'the FFN of 1024 patches in chunks of 896 and 128');
  r.drop(); enc.release();
  // a picture whose activations can't be bound at all
  const h2 = host({ limits: { maxStorageBufferBindingSize: 8 * 2 ** 20 } }), e2 = await h2.load();
  const weights = h2.live().length;
  await assert.rejects(e2.encode({ width: 2048, height: 2048, data: new Uint8Array(2048 * 2048 * 4) }), reasonOf('memory', /binding limit/));
  assert.equal(h2.live().length, weights);
  e2.release();
});

test('precision auto is f32 even where shader-f16 exists; f16 only when asked', async () => {
  const h = host({ features: ['shader-f16'] });
  const a = await h.load(projector());
  assert.equal(a.f16, false);
  a.release();
  const b = await h.load(projector(), { precision: 'f16' });
  assert.equal(b.f16, true);
  b.release();
  // an encoder that makes its own device asks for shader-f16 only for f16
  const asked = [];
  const h2 = host({ features: ['shader-f16'] });
  const requestDevice = h2.adapter.requestDevice;
  h2.adapter.requestDevice = async (d) => { asked.push(d.requiredFeatures); return requestDevice(d); };
  const kernels = (n) => fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/vision-${n}.wgsl`), 'utf8');
  (await h2.V.load(projector(), { kernels })).release();
  (await h2.V.load(projector(), { kernels, precision: 'f16' })).release();
  assert.deepEqual(asked.map((f) => [...f]), [[], ['shader-f16']]);
});

test('the result buffer can be copied from, as the engine\'s prefill embeds need', async () => {
  const h = host(), enc = await h.load(), r = await enc.encode(picture(64, 64));
  const U = h.context.GPUBufferUsage;
  assert.ok(r.buffer.usage & U.COPY_SRC);
  assert.ok(r.buffer.usage & U.STORAGE);
  r.drop(); enc.release();
});
