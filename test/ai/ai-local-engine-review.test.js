const test = require('node:test');
const assert = require('node:assert/strict');
const { model, host } = require('../fixtures/local-engine.js');
const fs = require('node:fs');
const path = require('node:path');
const EN = require('../../extension/ai/local/engine.js');
const Q = require('../../extension/ai/local/quant.js');
const R = require('../../extension/ai/local/reference.js');

const kernel = (name, defines) => EN.preprocess(fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/${name}.wgsl`), 'utf8'), defines);

function functionBody(src, name) {
  const start = new RegExp(`fn ${name}\\([^)]*\\)[^{]*\\{`).exec(src);
  assert.ok(start, name);
  const from = start.index + start[0].length;
  let end = from, depth = 1;
  while (depth && end < src.length) { if (src[end] === '{') depth++; if (src[end] === '}') depth--; end++; }
  assert.equal(depth, 0, `${name}: closing brace`);
  return src.slice(from, end - 1);
}

// Execute the scalar address/scale functions from the shipped shader, with checked storage reads. Vector arithmetic
// below is a JS port; these functions only construct vectors, so stripping their WGSL types is sufficient.
const scalarJS = (s) => s.replace(/\b(\d+)u\b/g, '$1').replace(/vec[234]<(?:u32|f32)>/g, 'vec').replace(/bitcast<i32>/g, 'i32').replace(/\bf32\(/g, 'fr(');
function vec(...v) {
  if (!v.length) v = [0, 0, 0, 0];
  [v.x, v.y, v.z, v.w] = v;
  v.yzw = v.slice(1);
  return v;
}
function rowStream(type, bytes) {
  const src = kernel('quant', { [type]: true }), padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const words = new Uint32Array(padded.buffer);
  const W = new Proxy(words, { get(target, key) {
    if (typeof key === 'string' && /^\d+$/.test(key)) assert.ok(+key < target.length, `${type}: W[${key}] outside ${target.length} words`);
    return target[key];
  } });
  const names = ['hd', 'sc', 'qw', ...(type === 'Q4_K' || type === 'Q5_K' ? ['scmin'] : [])];
  const functions = names.map((name) => {
    const params = new RegExp(`fn ${name}\\(([^)]*)\\)`).exec(src)[1].split(',').map((p) => p.split(':')[0]);
    return `function ${name}(${params.join(',')}) { ${scalarJS(functionBody(src, name))} }`;
  }).join('\n');
  return new Function('W', 'vec', 'h2f', 'i32', 'fr', `${functions}; return { hd, sc, qw };`)(W, vec, (h) => Q.fp16(h & 65535), (x) => x | 0, Math.fround);
}

test('Q8_0 row streams read only words inside the weight binding', () => {
  // Two blocks end on a word boundary. The final vec4 is aligned and needs no following word.
  for (const cols of [32, 64, 256, 512]) {
    const q = rowStream('Q8_0', new Uint8Array(Q.bytes('Q8_0', cols)));
    for (let s = 0; s < cols / 32; s++) for (let w = 0; w < 8; w++) q.qw(0, s, w);
  }
});

// v4's vector arithmetic, with the shader's unsigned shifts and f32 products/difference.
function streamValues(type, q, k, rb, s, w) {
  const bytes = (x) => [0, 8, 16, 24].map((n) => (x >>> n) & 255);
  const join = (lo, hi) => ((lo >>> 16) | (hi << 16)) >>> 0;
  const f = Math.fround;
  if (type === 'Q8_0') {
    const x = (rb + s * 34 + 2) & 2 ? join(q[0], q[1]) : q[0];
    return bytes(x).map((v) => f(k[0] * ((v << 24) >> 24)));
  }
  if (type === 'Q4_K' || type === 'Q5_K') {
    const lo = bytes(q[0]), hi = bytes(q[1]);
    return lo.map((v, i) => f(f(k[0] * (((v >>> ((s & 1) * 4)) & 15) + (type === 'Q5_K' ? ((hi[i] >>> (s & 7)) & 1) * 16 : 0))) - k[1]));
  }
  const odd = (rb + (s >>> 3) * 210) & 2;
  const lo = bytes(odd ? join(q[0], q[1]) : q[0]), hi = bytes(odd ? join(q[2], q[3]) : q[2]);
  return lo.map((v, i) => f(k[w < 4 ? 0 : 1] * ((((v >>> (4 * ((s & 3) >>> 1))) & 15) | (((hi[i] >>> (2 * (s & 3))) & 3) << 4)) - 32)));
}

test('all four row streams equal quant.js bit for bit across rows and superblocks', () => {
  for (const type of Object.keys(EN.QUANT)) for (const cols of [256, 512, 768]) {
    const rowBytes = Q.bytes(type, cols), bytes = new Uint8Array(3 * rowBytes);
    let seed = 0x9e3779b9;
    for (let i = 0; i < bytes.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; bytes[i] = seed & 255; }
    // Exercise finite normal/subnormal scales, signs, every packed scale/min, and signed quant/scales.
    const [block, size] = EN.QUANT[type], half = [1, 0x3555, 0x8401, 0x3c00, 0xbc00, 0x7bff];
    for (let b = 0, o = 0; o < bytes.length; b++, o += size) {
      const scale = o + (type === 'Q6_K' ? 208 : 0), h = half[b % half.length];
      bytes[scale] = h & 255; bytes[scale + 1] = h >>> 8;
      if (type === 'Q4_K' || type === 'Q5_K') { const m = half[(b + 1) % half.length]; bytes[o + 2] = m & 255; bytes[o + 3] = m >>> 8; }
    }
    assert.equal(cols % block, 0);
    const q = rowStream(type, bytes), got = new Float32Array(3 * cols);
    for (let row = 0; row < 3; row++) for (let s = 0; s < cols / 32; s++) {
      const rb = row * rowBytes, k = q.sc(q.hd(rb, s), rb, s);
      for (let w = 0; w < 8; w++) got.set(streamValues(type, q.qw(rb, s, w), k, rb, s, w), row * cols + s * 32 + w * 4);
    }
    const expected = Q.dequantize(type, bytes, got.length);
    assert.deepEqual(new Uint32Array(got.buffer), new Uint32Array(expected.buffer), `${type}, ${cols} columns`);
  }
});

test('BIG primes no weight or activation reads for empty trailing splits', () => {
  const src = kernel('matmul', { BIG: true }), body = functionBody(src, 'main');
  const primer = scalarJS(body.slice(body.indexOf('var hw'), body.indexOf('  Ws[')));
  const prime = new Function('j0', 'j1', 'wok', 'rb', 'h', 't0', 'lt', 'lw', 'hd', 'qw', 'sc', 'ldX', 'vec', primer);
  const rows = 768, cols = 256, T = 1024, z = EN.splits(rows, cols, T);
  const per = 2 * Math.ceil((cols / 32) / z);
  assert.equal(z, 6); // The ceil-sized runs leave two of these splits empty.
  let empty = 0;
  for (let split = 0; split < z; split++) {
    const j0 = Math.min(split * per, cols / 16), j1 = Math.min(j0 + per, cols / 16);
    if (j0 !== j1) continue;
    empty++;
    let reads = 0;
    const read = () => { reads++; return vec(); };
    prime(j0, j1, true, 0, 0, 0, 0, 0, read, read, () => vec(0, 0), read, vec);
    assert.equal(reads, 0, `split ${split} has no k steps`);
  }
  assert.equal(empty, 2);
});

function attentionModel() {
  const g = model(), original = g.tensor, tensors = new Map();
  g.kv['lfm3.attention.head_count_kv'] = [1];
  const add = (name, dims, type) => {
    name = `blk.0.${name}.weight`;
    const count = dims.reduce((a, b) => a * b, 1);
    tensors.set(name, { name, dims, count, type, bytes: type === 'F32' ? count * 4 : Q.bytes(type, count) });
  };
  for (const [name, rows] of [['attn_q', 256], ['attn_k', 128], ['attn_v', 128], ['attn_output', 256], ['attn_gate', 2]]) add(name, [256, rows], 'Q8_0');
  for (const name of ['attn_q_norm', 'attn_k_norm']) add(name, [128], 'F32');
  g.tensor = (n) => tensors.get(n) || original(n);
  return g;
}

test('prefill attention fits every device accepted for the small GEMM path', async () => {
  for (const [f16, limit] of [[false, 18432], [true, 16384], [false, 26432], [true, 17984]]) {
    const h = host();
    if (f16) h.device.features.add('shader-f16');
    h.device.limits.maxComputeWorkgroupStorageSize = limit;
    const compile = h.device.createComputePipelineAsync;
    h.device.createComputePipelineAsync = async (desc) => {
      const src = desc.compute.module.code;
      let bytes = 0;
      for (const [, type, count] of src.matchAll(/var<workgroup>\s+\w+:\s*array<(vec4<(?:H|f32)>|f32),\s*(\d+)>/g)) bytes += +count * (type === 'f32' ? 4 : type === 'vec4<H>' && f16 ? 8 : 16);
      assert.ok(bytes <= limit, `${f16 ? 'f16' : 'f32'} kernel uses ${bytes} workgroup bytes, device allows ${limit}`);
      return compile(desc);
    };
    const m = await h.load(attentionModel(), { context: 128, chunk: 65 });
    try {
      await m.prefill([1, 2]);
      const att = h.dispatches.find((d) => d.pipeline.compute.module.code.includes('const D = 128u;'));
      assert.ok(att);
      assert.equal(att.dims[1], limit >= (f16 ? 17984 : 26432) ? 1 : 2);
      const snap = await m.snapshot();
      await m.decode({ sampler: { temperature: 0 } });
      await m.restore(snap);
      assert.equal(m.pos, 2);
      snap.drop();
    } finally { m.release(); }
    assert.ok(h.buffers.every((b) => b.destroyed));
  }
});

test('split GEMMs fit their scratch buffers and SUM writes only the destination run', async () => {
  for (const chunk of [65, 129, 512, 1024]) {
    const h = host();
    // An odd vocabulary also checks the unsplit, lazily bound all-logits destination.
    const e = await h.create(model({ vocab: 1025 }));
    const s = await e.session({ ctx: chunk + 2, chunk });
    try {
      await s.forward(Array(chunk).fill(1), { logits: 'all' });
      let parts = 0, sums = 0;
      for (const d of h.dispatches) {
        const src = d.pipeline.compute.module.code;
        if (!src.includes('struct P { rows: u32, K: u32, rowBytes: u32, T:')) continue;
        const binding = (n) => d.group.entries.find((e) => e.binding === n).resource;
        const u = binding(3), p = new Uint32Array(u.buffer.data.buffer, u.offset, 8);
        const [rows, K, , T, , , ldy, yOff] = p, output = binding(2).buffer;
        if (d.dims[2] > 1) {
          parts++;
          assert.equal(ldy, rows); assert.equal(yOff, 0);
          assert.ok(d.dims[2] * T * rows * 4 <= output.size);
          // Every 32-value sub-block belongs to exactly one split, including ceil-rounded empty trailing splits.
          const coverage = new Uint8Array(K / 32), per = Math.ceil(coverage.length / d.dims[2]);
          for (let z = 0; z < d.dims[2]; z++) for (let k = z * per; k < Math.min((z + 1) * per, coverage.length); k++) coverage[k]++;
          assert.ok(coverage.every((n) => n === 1));
        }
        if (src.includes('let n4 = p.rows / 4u;')) {
          sums++;
          assert.equal(rows % 4, 0);
          assert.ok(K * T * rows * 4 <= binding(1).buffer.size);
        }
        assert.ok(((T - 1) * ldy + yOff + rows) * 4 <= output.size);
      }
      assert.ok(parts > 0); assert.equal(parts, sums);
    } finally { s.destroy(); e.destroy(); }
    assert.ok(h.buffers.every((b) => b.destroyed));
  }
});

test('BLOCK masks match reference attention for causal, sliding, ring and partial query blocks', () => {
  const src = functionBody(kernel('attention', { BLOCK: true }), 'main');
  const bounds = new Function('p', 't0', 'BT', 'min', `${scalarJS(src.slice(src.indexOf('var first'), src.indexOf('// Invocation')))}; return { first, end };`);
  const mask = new Function('live', 'j', 'rp', 'end', 'p', `return ${scalarJS(/if \((live &&[^\n]+)\) \{/.exec(src)[1])};`);
  const f = Math.fround, NONE = f(-3.4028234663852886e38), D = 128, H = 4, Hkv = 2, width = Hkv * D;
  for (const [T, pos, window, ring] of [[2, 0, 0, 0], [15, 1, 0, 0], [16, 127, 0, 0], [17, 33, 0, 0], [33, 127, 5, 0], [17, 33, 1, 18], [31, 127, 5, 36], [17, 127, 17, 34]]) {
    const p = { T, pos, window, ring }, total = pos + T;
    const q = Float32Array.from({ length: T * H * D }, (_, i) => Math.sin(i * 0.17) * 0.3);
    const K = Float32Array.from({ length: total * width }, (_, i) => Math.cos(i * 0.23) * 0.4);
    const V = Float32Array.from({ length: K.length }, (_, i) => Math.sin(i * 0.31));
    const gate = Float32Array.from({ length: T * H }, (_, i) => Math.cos(i));
    const kc = new Float32Array((ring || total) * width), vc = new Float32Array(kc.length);
    for (let j = 0; j < total; j++) {
      const dst = (ring ? j % ring : j) * width;
      kc.set(K.subarray(j * width, (j + 1) * width), dst);
      vc.set(V.subarray(j * width, (j + 1) * width), dst);
    }
    const got = new Float32Array(q.length), reference = R._ops.attend(q, K, V, gate, { T, pos, H, Hkv, hd: D, window });
    // Port the BLOCK tile's per-row online softmax and value sum. Bounds and the actual mask come from the shader.
    for (let t0 = 0; t0 < T; t0 += 16) for (let h = 0; h < H; h++) {
      const { first, end } = bounds(p, t0, 16, Math.min), kh = Math.floor(h / (H / Hkv));
      assert.ok(end <= total);
      for (let r = 0; r < 16; r++) {
        const live = t0 + r < T, t = t0 + r, rp = pos + t, qo = (t * H + h) * D;
        let m = NONE, l = 0;
        const acc = new Float32Array(D);
        for (let j0 = first; j0 < end; j0 += 16) {
          const scores = new Float32Array(16).fill(NONE);
          for (let c = 0; c < 16; c++) {
            const j = j0 + c;
            if (!mask(live, j, rp, end, p)) continue;
            const ko = ((ring ? j % ring : j) * width + kh * D);
            assert.ok(ko >= 0 && ko + D <= kc.length);
            let d = 0;
            for (let i = 0; i < D; i += 4) {
              let dot = 0;
              for (let k = 0; k < 4; k++) dot += q[qo + i + k] * kc[ko + i + k];
              d = f(d + f(dot));
            }
            scores[c] = f(d * f(1 / Math.sqrt(D)));
          }
          const mx = Math.max(m, ...scores), weights = Float32Array.from(scores, (v) => v === NONE ? 0 : Math.exp(v - mx));
          let sum = 0;
          for (const w of weights) sum = f(sum + w);
          const correction = f(Math.exp(m - mx));
          l = f(f(l * correction) + sum); m = mx;
          for (let i = 0; i < D; i++) {
            acc[i] = f(acc[i] * correction);
            for (let c = 0; c < 16; c++) {
              const j = j0 + c;
              // The shader loads zero vectors for keys beyond this tile's end.
              const value = j < end ? vc[(ring ? j % ring : j) * width + kh * D + i] : 0;
              acc[i] = f(acc[i] + f(weights[c] * value));
            }
          }
        }
        if (!live) continue;
        assert.ok(l > 0);
        const g = f(1 / f(1 + f(Math.exp(-gate[t * H + h]))));
        for (let i = 0; i < D; i++) got[qo + i] = f(f(acc[i] / l) * g);
      }
    }
    for (let i = 0; i < got.length; i++) assert.ok(Math.abs(got[i] - reference[i]) < 2e-6, `${JSON.stringify(p)} output ${i}: ${got[i]} vs ${reference[i]}`);
  }
});

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
