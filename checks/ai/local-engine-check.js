// The local engine's WebGPU kernels (extension/ai/local/engine.js, kernels/*.wgsl) against its CPU reference
// (extension/ai/local/reference.js), in Chromium. Modes:
//   adapter                                   the WebGPU adapter Chromium gets with --flags
//   kernels <model.gguf> [--tokens a,b,..]    each kernel against the reference's same op on the model's real tensors:
//                                             dequantization bit for bit, the rest within the error bound below
//   model <model.gguf> <ref dir> [--only a,b] [--steps 64] [--summary]
//                                             the whole model on checks/ai/local-reference-prompts.json against the
//                                             reference's saved logits (local-reference-check.js's dumps, or `summarize`d)
//   model ... --api                           the same through the model interface (load, prefill, decode greedy)
//   warm <model.gguf> [ref dir] [--system 1500]   a system turn (long-1500's tokens) prefilled once with a snapshot, then
//                                             restore + a 64- or 256-token user turn + one token, timed; GPU memory
//                                             (nvidia-smi) before load, loaded, after release
//   speed <model.gguf> [--prompt 512] [--decode 128] [--profile]   prefill and decode tok/s (after a warm-up); --profile:
//                                             GPU ms per kernel (timestamp-query) for a decode step and a prompt chunk
//   bench <model.gguf>                        GEMV GB/s on a few of the model's matrices (200 dispatches in one pass)
//   small                                     a tiny random lfm3 with every quant type: the kernels, then the whole model
//                                             without subgroups, then the model interface (mask, snapshots, cancel) (SwiftShader, no model file: tools/dev/ci-browser-checks.js runs it)
//   summarize <ref dir> <out dir>             (Node only) per row the reference's top 32 (id, logit), for a machine
//                                             without the full dumps; `model` then compares top-1 and those logits
// Options: --out <dir> (results.json, the log), --flags nvidia | swiftshader | none (Chromium's GPU flags; default none,
// small: swiftshader), --precision auto | f32 | f16, --subgroups auto | off, --chunk n (session chunk, 128).
// Error bounds (u = 2⁻²⁴; each output's bound from the reference's own values, so a pass means |GPU − reference| ≤ the
// worst case of f32 rounding in the kernel's order, not a tuned tolerance; the reference sums in double):
//   matmul    (K + 16)·u·Σ|w·x| + u·|y|   (a K-term sum in any order: γ_K·Σ|terms|, Higham 3.1; +16 for the products and
//             the four-wide dots). f16 GEMM tiles: + 2⁻¹⁰·Σ|w·x| + 2⁻²⁵·(Σ|w| + Σ|x|) (both factors rounded to f16).
//   rmsnorm   (n/2 + 16)·u·|y|  (the sum of squares γ_n, halved by the square root, plus sqrt, divide, two products)
//   add+norm  x: u·|x| + (n/2 + 16)·u·|a′|; next norm: (n/2 + 16)·u·|y| + its scale × x's bound + |y|·‖Δx‖₂/‖x‖₂
//   swiglu    (2|g| + 16)·u·|y|  (WGSL's exp is within 3 + 2|x| ulp); GLU GEMV: + silu′ and silu × each dot's bound
//   shortconv (K + 5)·u·|C|·Σ|win·w| + u·|y|; the rolled state bit for bit (B·x is one f32 product either way)
//   rope      (D/2 + 19)·u·(|y₀ cos| + |y₁ sin|) + u·|r| (the table is the reference's own f32 cos and sin);
//             f16 cache: + 2⁻¹¹·|r| + 2⁻²⁵; values copied bit for bit (f16: rounded the same way)
//   attention σ(g)·Σp|v|·(2ε + (3 + 2R)·u + 2(N + 8)·u [+ 2⁻¹¹ f16]) + (2|g| + 17)·u·|o| with ε the scores' bound
//             ((D + 8)·u [+ 2⁻¹¹ f16] × max scale·Σ|q·k|), R the widest exponent used, N the keys seen
//   argmax, top-k   the same ids as the reference's greedy and top on the same logits
//   Every bound also allows 2⁻¹²⁰ absolute: WGSL lets a GPU flush f32 subnormals to zero, and NVIDIA's does (Q8_0, layer 2:
//   q·k·w = −7.5e-39 for a q norm weight of 3.2e-33, flushed, so a RoPE output of −3.4531e-35 came out −3.4524e-35).
// Whole model (compare as local-reference-check.js): top-1 at every prompt position, greedy tokens, max |Δlogit|. Passes
// on f32 with every top-1 and greedy token the reference's; on f16 with top-1 ≥ 99.5 % and greedy on ≥ 90 % of prompts.
//   NODE_PATH=<playwright> node checks/ai/local-engine-check.js <mode> ... --out <dir> --flags nvidia
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

// The extension's folder: the page loads its scripts and kernels from /ai/local/ as the extension does.
const EXTENSION = path.join(__dirname, '../../extension');
const PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'local-reference-prompts.json'), 'utf8')).prompts;
const FLAGS = {
  // Linux, NVIDIA's Vulkan driver (needs libEGL in the container); the first adapter request can come back null.
  nvidia: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface'],
  swiftshader: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
  none: [],
};

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const has = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const mode = args.shift();
const opt = {
  out: flag('--out', null), flags: flag('--flags', mode === 'small' ? 'swiftshader' : 'none'), precision: flag('--precision', 'auto'),
  subgroups: flag('--subgroups', 'auto'), chunk: +flag('--chunk', 128), only: flag('--only', null), steps: +flag('--steps', 64),
  prompt: +flag('--prompt', 512), decode: +flag('--decode', 128), tokens: flag('--tokens', null), summary: has('--summary'), profile: has('--profile'), api: has('--api'), system: +flag('--system', 1500),
};

// ---- Node: summaries of full dumps --------------------------------------------------------------------------------------
const top32 = (v) => {
  const best = [];
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (best.length === 32 && x <= best[31][1]) continue;
    let j = best.length < 32 ? best.length : 31;
    while (j > 0 && best[j - 1][1] < x) j--;
    best.splice(j, 0, [i, x]);
    if (best.length > 32) best.pop();
  }
  return best;
};
if (mode === 'summarize') {
  const [from, to] = args;
  fs.mkdirSync(to, { recursive: true });
  for (const p of PROMPTS) {
    const f = path.join(from, `${p.id}.json`);
    if (!fs.existsSync(f)) continue;
    const A = JSON.parse(fs.readFileSync(f, 'utf8')), V = A.vocab;
    const rowsOf = (file, n) => {
      const fd = fs.openSync(file, 'r'), out = [], b = Buffer.alloc(4 * V);
      for (let i = 0; i < n; i++) { fs.readSync(fd, b, 0, 4 * V, i * 4 * V); out.push(top32(new Float32Array(b.buffer, b.byteOffset, V))); }
      fs.closeSync(fd);
      return out;
    };
    const s = { id: p.id, vocab: V, prompt: A.prompt, gen: A.gen, prefill: rowsOf(path.join(from, `${p.id}.prefill.f32`), A.prompt.length), decode: rowsOf(path.join(from, `${p.id}.decode.f32`), A.gen.length - 1) };
    fs.writeFileSync(path.join(to, `${p.id}.summary.json`), JSON.stringify(s));
    console.log(`${p.id}: ${s.prefill.length} prefill rows, ${s.decode.length} decode rows`);
  }
  process.exit(0);
}

// ---- Node: a tiny random lfm3 GGUF with every quantized type (the `small` mode) ------------------------------------------
const tinyModel = () => {
  let seed = 7;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const C = { E: 256, H: 2, Hkv: 1, hd: 128, ff: 512, V: 1000, window: 5, L: 3, kinds: ['conv', 'full', 'conv', 'swa', 'conv', 'full'], eps: 1e-5 };
  // A binary16 scale near 2^(e − 15), e in [lo, hi].
  const half = (lo, hi) => ((lo + Math.floor(rnd() * (hi - lo + 1))) << 10) | Math.floor(rnd() * 1024);
  const BLOCK = { Q8_0: [8, 32, 34], Q4_K: [12, 256, 144], Q5_K: [13, 256, 176], Q6_K: [14, 256, 210] };
  const quantized = (type, rows, cols) => {
    const [id, per, size] = BLOCK[type], n = (rows * cols) / per, b = new Uint8Array(n * size);
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(rnd() * 256);
    const dv = new DataView(b.buffer);
    for (let k = 0; k < n; k++) {
      const o = k * size;
      if (type === 'Q8_0') dv.setUint16(o, half(4, 7), true);
      else if (type === 'Q6_K') dv.setUint16(o + 208, half(1, 3), true);
      else { dv.setUint16(o, half(2, 5), true); dv.setUint16(o + 2, half(2, 5), true); }
    }
    return { id, dims: [cols, rows], data: b };
  };
  const f32 = (dims, s, base = 0) => ({ id: 0, dims, data: new Uint8Array(Float32Array.from({ length: dims.reduce((a, b) => a * b, 1) }, () => base + s * (2 * rnd() - 1)).buffer) });
  const types = ['Q4_K', 'Q5_K', 'Q6_K', 'Q8_0'];
  let ti = 0;
  const q = (rows, cols) => quantized(types[ti++ % 4], rows, cols);
  const T = { 'token_embd.weight': quantized('Q6_K', C.V, C.E), 'output_norm.weight': f32([C.E], 0.2, 1), 'rope_freqs.weight': { id: 0, dims: [C.hd / 2], data: new Uint8Array(Float32Array.from({ length: C.hd / 2 }, (_, i) => (i < C.hd / 4 ? 1 : 1e30)).buffer) } };
  C.kinds.forEach((k, i) => {
    const b = (n) => `blk.${i}.${n}.weight`;
    const gt = types[i % 4];
    Object.assign(T, {
      [b('attn_norm')]: f32([C.E], 0.2, 1), [b('ffn_norm')]: f32([C.E], 0.2, 1), [b('post_attention_norm')]: f32([C.E], 0.2, 1), [b('post_ffw_norm')]: f32([C.E], 0.2, 1),
      [b('ffn_gate')]: quantized(gt, C.ff, C.E), [b('ffn_up')]: quantized(gt, C.ff, C.E), [b('ffn_down')]: q(C.E, C.ff),
    });
    if (k === 'conv') Object.assign(T, { [b('shortconv.conv')]: f32([C.L, C.E], 0.6), [b('shortconv.in_proj')]: q(3 * C.E, C.E), [b('shortconv.out_proj')]: q(C.E, C.E) });
    else Object.assign(T, {
      [b('attn_q')]: q(C.H * C.hd, C.E), [b('attn_k')]: q(C.Hkv * C.hd, C.E), [b('attn_v')]: q(C.Hkv * C.hd, C.E), [b('attn_output')]: q(C.E, C.H * C.hd),
      [b('attn_gate')]: quantized('Q8_0', C.H, C.E), [b('attn_q_norm')]: f32([C.hd], 0.2, 1), [b('attn_k_norm')]: f32([C.hd], 0.2, 1),
    });
  });
  const parts = [], u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }, u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const f32v = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); parts.push(b); }, str = (s) => { const b = Buffer.from(s); u64(b.length); parts.push(b); };
  const len = () => parts.reduce((n, p) => n + p.length, 0);
  const kv = [
    ['general.architecture', 8, () => str('lfm3')], ['lfm3.block_count', 4, () => u32(C.kinds.length)], ['lfm3.embedding_length', 4, () => u32(C.E)],
    ['lfm3.feed_forward_length', 4, () => u32(C.ff)], ['lfm3.attention.head_count', 4, () => u32(C.H)],
    ['lfm3.attention.head_count_kv', 9, () => { u32(5); u64(C.kinds.length); for (const k of C.kinds) u32(k === 'conv' ? 0 : C.Hkv); }],
    ['lfm3.rope.freq_base', 6, () => f32v(1e6)], ['lfm3.rope.freq_base_swa', 6, () => f32v(1e4)], ['lfm3.attention.layer_norm_rms_epsilon', 6, () => f32v(C.eps)],
    ['lfm3.attention.key_length', 4, () => u32(C.hd)], ['lfm3.attention.value_length', 4, () => u32(C.hd)], ['lfm3.rope.dimension_count', 4, () => u32(C.hd)],
    ['lfm3.attention.sliding_window_pattern', 9, () => { u32(7); u64(C.kinds.length); for (const k of C.kinds) parts.push(Buffer.of(k === 'swa' ? 1 : 0)); }],
    ['lfm3.attention.sliding_window', 4, () => u32(C.window)], ['lfm3.shortconv.l_cache', 4, () => u32(C.L)],
  ];
  parts.push(Buffer.from('GGUF')); u32(3);
  const names = Object.keys(T);
  u64(names.length); u64(kv.length);
  for (const [k, ty, w] of kv) { str(k); u32(ty); w(); }
  let off = 0;
  for (const n of names) { const t = T[n]; str(n); u32(t.dims.length); for (const d of t.dims) u64(d); u32(t.id); u64(off); off += Math.ceil(t.data.length / 32) * 32; }
  parts.push(Buffer.alloc((32 - (len() % 32)) % 32));
  for (const n of names) { const d = T[n].data; parts.push(Buffer.from(d.buffer, d.byteOffset, d.length), Buffer.alloc((32 - (d.length % 32)) % 32)); }
  return Buffer.concat(parts);
};

// ---- the page's side (serialized into the page) --------------------------------------------------------------------------
function pageLib() {
  const G = GZ_AI_GGUF, Q = GZ_AI_QUANT, R = GZ_AI_REFERENCE, EN = GZ_AI_ENGINE;
  // FTZ: WGSL lets a GPU flush f32 subnormals (< 2⁻¹²⁶) to zero, as NVIDIA's does; a few such terms per output.
  const u = 2 ** -24, h11 = 2 ** -11, h25 = 2 ** -25, FTZ = 2 ** -120;
  const log = (...a) => console.log(a.join(' '));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const source = (url, size) => ({
    size,
    read: async (o, n) => {
      const r = await fetch(url, { headers: { Range: `bytes=${o}-${o + n - 1}` } });
      if (r.status !== 206) throw new Error(`${url}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  });
  const open = async (key) => {
    const r = await fetch(`/f/${key}`, { method: 'HEAD' });
    if (!r.ok) throw new Error(`/f/${key}: ${r.status}`);
    return G.open(source(`/f/${key}`, +r.headers.get('content-length')), { chunk: 8 << 20 });
  };
  const adapter = async () => {
    // Chromium on Linux with NVIDIA's Vulkan answers null until its GPU process is up.
    for (let i = 0; i < 8; i++) {
      const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (a) return a;
      await sleep(1000);
    }
    throw new Error('no WebGPU adapter');
  };
  const describe = (a) => {
    const L = a.limits;
    return {
      vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description, isFallbackAdapter: a.info.isFallbackAdapter,
      subgroupMinSize: a.info.subgroupMinSize, subgroupMaxSize: a.info.subgroupMaxSize, features: [...a.features].sort(),
      limits: Object.fromEntries(['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize', 'maxComputeInvocationsPerWorkgroup', 'maxStorageBuffersPerShaderStage'].map((k) => [k, L[k]])),
    };
  };
  const engine = async (g, o) => {
    const a = await adapter();
    const e = await EN.create(g, { adapter: a, precision: o.precision, profile: !!o.profile, subgroups: o.subgroups === 'off' ? false : 'auto', kernels: new URL('/ai/local/kernels/', location.href).href });
    log(`engine: ${a.info.vendor} ${a.info.architecture}${a.info.isFallbackAdapter ? ' (fallback)' : ''}, ${e.f16 ? 'f16' : 'f32'}, subgroups ${e.subgroups ? `on (${e._k.tpr} lanes a row)` : `off${e.subgroupsOff ? ` (${e.subgroupsOff})` : ''}`}, ${e.layout.buffers.length} weight buffers`);
    return { e, adapter: describe(a) };
  };

  // The same bounded merges as the session, checked here on known logits.
  const topCandidates = async (k, logits, n, count) => {
    const owned = [], alloc = (size) => { const b = k.buffer(size); owned.push(b); return b; };
    try {
      let chunks = Math.ceil(n / 2048), input = alloc(chunks * count * 8);
      await k.dispatch('topk', { PART: true }, { 0: logits, 1: input }, k.PARAMS.topk({ n, k: count, chunks }), [chunks]);
      do {
        const groups = Math.ceil(chunks * count / 4096), output = alloc(groups * count * 8);
        await k.dispatch('topk', {}, { 1: input, 2: output }, k.PARAMS.topk({ n, k: count, chunks }), [groups]);
        input = output; chunks = groups;
      } while (chunks > 1);
      const ids = new Uint32Array(await k.read(input, 0, count * 8)), values = new Float32Array(ids.buffer);
      return Array.from({ length: count }, (_, i) => [ids[2 * i + 1], values[2 * i]]);
    } finally { for (const b of owned) b.destroy(); }
  };

  // ---- the per-kernel checks ----
  const kernels = async (o) => {
    const g = await open(o.model), { e, adapter: ad } = await engine(g, o), k = e._k, c = e.config, f16 = e.f16;
    const table = [];
    const S = GPUBufferUsage;
    const rd = async (b, n) => new Float32Array(await k.read(b, 0, n * 4));
    const up = (a) => k.upload(a);
    const mat = async (name) => { const t = g.tensor(name); return { name, type: t.type, rows: t.dims[1] || 1, cols: t.dims[0], bytes: await g.read(t), rowBytes: Q.bytes(t.type, t.dims[0]) }; };
    const vec = async (name) => { const t = g.tensor(name); return Q.dequantize(t.type, await g.read(t), t.count); };
    const record = (op, what, got, ref, bound, extra = {}) => {
      let maxAbs = 0, maxRef = 0, worst = 0, over = 0, bad = 0, at = -1;
      for (let i = 0; i < ref.length; i++) {
        const d = Math.abs(got[i] - ref[i]);
        if (!Number.isFinite(got[i])) { bad++; continue; }
        if (d > maxAbs) maxAbs = d;
        if (Math.abs(ref[i]) > maxRef) maxRef = Math.abs(ref[i]);
        const r = bound ? d / (bound[i] + FTZ) : d === 0 ? 0 : Infinity;
        if (r > worst) { worst = r; at = i; }
        if (r > 1) over++;
      }
      const row = { op, what, n: ref.length, maxAbs, rel: maxRef ? maxAbs / maxRef : 0, worst, over, nonFinite: bad, pass: !over && !bad, ...extra };
      if (over) row.worstAt = { i: at, got: got[at], ref: ref[at], bound: bound[at] };
      table.push(row);
      log(`${row.pass ? 'ok  ' : 'FAIL'} ${op.padEnd(10)} ${what.padEnd(46)} max|Δ| ${maxAbs.toExponential(2)}  rel ${row.rel.toExponential(2)}  worst ${worst.toFixed(3)} of bound${over ? `  ${over} over (at ${at}: ${got[at]} for ${ref[at]}, bound ${(bound[at] + FTZ).toExponential(2)})` : ''}${bad ? `  ${bad} non-finite` : ''}`);
    };
    const bits = (op, what, got, ref) => {
      const a = new Uint32Array(got.buffer, got.byteOffset, got.length), b = new Uint32Array(ref.buffer, ref.byteOffset, ref.length);
      let diff = 0;
      for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) diff++;
      table.push({ op, what, n: b.length, differ: diff, pass: diff === 0 });
      log(`${diff ? 'FAIL' : 'ok  '} ${op.padEnd(10)} ${what.padEnd(46)} ${b.length} values, ${diff} differ`);
    };
    const same = (op, what, got, ref) => {
      const pass = JSON.stringify(got) === JSON.stringify(ref);
      table.push({ op, what, pass, got: pass ? undefined : got, ref: pass ? undefined : ref });
      log(`${pass ? 'ok  ' : 'FAIL'} ${op.padEnd(10)} ${what}${pass ? '' : ` got ${JSON.stringify(got).slice(0, 200)} want ${JSON.stringify(ref).slice(0, 200)}`}`);
    };

    // Real activations: token rows of the embedding, RMS-normed with layer 0's attn_norm.
    const embd = await mat('token_embd.weight'), E = c.nEmbd, V = c.vocab;
    const ids = (o.tokens || [124894, 597, 5205, 302, 3980, 355]).filter((t) => t < V);
    const emb = (list) => { const x = new Float32Array(list.length * E), r = new Float32Array(E); list.forEach((t, i) => x.set(R._ops.row(embd, t, r), i * E)); return x; };
    const n0 = await vec('blk.0.attn_norm.weight');
    const T = ids.length, X0 = R._ops.rmsnorm(emb(ids), T, E, n0, c.eps);
    const many = Array.from({ length: 70 }, (_, i) => (i * 1777 + 11) % V), X70 = R._ops.rmsnorm(emb(many), 70, E, n0, c.eps);

    // dequantization, bit for bit
    // Both of the kernels' dequantizers: deq32 (GEMM loads, the embedding) and grp (GEMV reads).
    const dq = async (name, rows) => {
      const t = k.tensor(name), W = await mat(name), idb = up(Uint32Array.from(rows));
      const ref = new Float32Array(rows.length * t.cols), tmp = new Float32Array(t.cols);
      rows.forEach((r, i) => ref.set(R._ops.row(W, r, tmp), i * t.cols));
      for (const grp of [false, true]) {
        const out = k.buffer(rows.length * t.cols * 4);
        for (const r of t.runs) await k.dispatch('embed', { [t.type]: true, GRP: grp }, { 0: r.bind, 1: idb, 2: out }, k.PARAMS.embed({ n: rows.length, E: t.cols, rowBytes: t.rowBytes, row0: r.row, rows: r.rows }), k.grid(Math.ceil((rows.length * t.cols) / 32 / 64)));
        bits('dequant', `${name} ${t.type} ${rows.length}×${t.cols} ${grp ? 'grp' : 'deq32'}`, await rd(out, rows.length * t.cols), ref);
        out.destroy();
      }
      idb.destroy();
    };
    const all = (n) => Array.from({ length: n }, (_, i) => i);
    const spread = (n, m) => Array.from({ length: m }, (_, i) => Math.floor((i * (n - 1)) / (m - 1)));
    const firstConv = c.layers.indexOf('conv'), firstFull = c.layers.indexOf('full'), firstSwa = c.layers.indexOf('swa');
    const b = (i, n) => `blk.${i}.${n}.weight`;
    for (const name of [b(firstConv, 'ffn_gate'), b(firstConv, 'ffn_down'), b(firstFull, 'attn_v'), b(firstFull, 'attn_gate'), b(firstConv, 'shortconv.in_proj')]) await dq(name, all(g.tensor(name).dims[1]));
    await dq('token_embd.weight', spread(V, Math.min(V, 4096)));

    // matmul: GEMV a token at a time, and the tiled GEMM
    const absDot = (W, X, T) => {
      const n = W.cols, M = new Float64Array(T * W.rows), sw = new Float64Array(W.rows), wr = new Float32Array(n);
      for (let r = 0; r < W.rows; r++) {
        R._ops.row(W, r, wr);
        let s = 0;
        for (let i = 0; i < n; i++) s += Math.abs(wr[i]);
        sw[r] = s;
        for (let t = 0; t < T; t++) { let m = 0; for (let i = 0; i < n; i++) m += Math.abs(wr[i] * X[t * n + i]); M[t * W.rows + r] = m; }
      }
      return { M, sw };
    };
    const sumAbs = (X, T, n) => Float64Array.from({ length: T }, (_, t) => { let s = 0; for (let i = 0; i < n; i++) s += Math.abs(X[t * n + i]); return s; });
    const gpuMm = async (name, X, T, gemm) => {
      const t = k.tensor(name), xb = up(X), yb = k.buffer(T * t.rows * 4);
      for (const r of t.runs) {
        if (gemm) await k.dispatch('matmul', { [t.type]: true }, { 0: r.bind, 1: xb, 2: yb }, k.PARAMS.matmul({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, T, xStride: t.cols, ldy: t.rows, yOff: r.row }), [Math.ceil(r.rows / 64), Math.ceil(T / 64)]);
        else for (let i = 0; i < T; i++) await k.dispatch('matvec', { [t.type]: true }, { 0: r.bind, 1: xb, 2: yb }, k.PARAMS.matvec({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, xOff: i * t.cols, yOff: i * t.rows + r.row }), k.grid(Math.ceil(r.rows / (256 / k.tpr))));
      }
      const y = await rd(yb, T * t.rows);
      xb.destroy(); yb.destroy();
      return y;
    };
    const mmCheck = async (name, X, T, gemm) => {
      const W = await mat(name), ref = R._ops.matmul(W, X, T), { M, sw } = absDot(W, X, T), sx = sumAbs(X, T, W.cols);
      const got = await gpuMm(name, X, T, gemm);
      const half = gemm && f16;
      const bound = Float64Array.from(ref, (y, i) => {
        const t = Math.floor(i / W.rows), r = i % W.rows;
        return (W.cols + 16) * u * M[i] + u * Math.abs(y) + (half ? 2 ** -10 * M[i] + h25 * (sw[r] + sx[t]) : 0);
      });
      record(gemm ? 'gemm' : 'gemv', `${name} ${W.type} ${W.rows}×${W.cols} T=${T}`, got, ref, bound);
      return ref;
    };
    const G0 = b(firstConv, 'ffn_gate'), U0 = b(firstConv, 'ffn_up'), D0 = b(firstConv, 'ffn_down');
    const gate = await mmCheck(G0, X0, T, false), upv = await mmCheck(U0, X0, T, false);
    const Hff = Float32Array.from(gate, (x, i) => R._ops.silu(x) * upv[i]);
    await mmCheck(D0, Hff, T, false);
    await mmCheck(D0, Hff, T, true);
    for (const n of [b(firstConv, 'shortconv.in_proj'), b(firstFull, 'attn_v'), b(firstFull, 'attn_gate'), b(firstFull, 'attn_k')]) { await mmCheck(n, X0, 1, false); await mmCheck(n, X0, T, true); }
    await mmCheck(b(firstConv, 'shortconv.in_proj'), X70, 70, true);
    await mmCheck(b(firstConv, 'ffn_gate'), X70, 70, true);
    const hN = R._ops.rmsnorm(X0, T, E, await vec('output_norm.weight'), c.eps);
    const lm = await mmCheck('token_embd.weight', hN.subarray((T - 1) * E), 1, false);
    await mmCheck('token_embd.weight', hN, Math.min(T, 4), true);

    // GLU GEMV: silu(gate · x) · (up · x), both from one binding
    {
      const t = k.tensor(G0), F = t.rows;
      if (t.runs.length === 1 && t.runs[0].pairOff !== undefined) {
        const Wg = await mat(G0), Wu = await mat(U0), x = X0.subarray(0, E);
        const g1 = R._ops.matmul(Wg, x, 1), u1 = R._ops.matmul(Wu, x, 1), Mg = absDot(Wg, x, 1).M, Mu = absDot(Wu, x, 1).M;
        const ref = Float32Array.from(g1, (gv, i) => R._ops.silu(gv) * u1[i]);
        const xb = up(x), yb = k.buffer(F * 4);
        await k.dispatch('matvec', { [t.type]: true, GLU: true }, { 0: t.runs[0].bind, 1: xb, 2: yb }, k.PARAMS.matvec({ rows: F, K: E, rowBytes: t.rowBytes, upOff: t.runs[0].pairOff }), k.grid(Math.ceil(F / (256 / k.tpr))));
        const got = await rd(yb, F);
        const bound = Float64Array.from(ref, (y, i) => 1.1 * Math.abs(u1[i]) * ((E + 16) * u * Mg[i] + u * Math.abs(g1[i])) + Math.abs(R._ops.silu(g1[i])) * ((E + 16) * u * Mu[i] + u * Math.abs(u1[i])) + (2 * Math.abs(g1[i]) + 16) * u * Math.abs(y));
        record('glu', `${G0} + ffn_up ${t.type} ${F}×${E}`, got, ref, bound);
        xb.destroy(); yb.destroy();
      }
    }

    // swiglu, elementwise
    {
      const gb = up(gate), ub = up(upv), n = gate.length;
      await k.dispatch('swiglu', {}, { 0: gb, 1: ub }, k.PARAMS.swiglu({ n }), k.grid(Math.ceil(n / 4 / 256)));
      const got = await rd(gb, n);
      record('swiglu', `${G0} outputs, T=${T}`, got, Hff, Float64Array.from(Hff, (y, i) => (2 * Math.abs(gate[i]) + 16) * u * Math.abs(y)));
      gb.destroy(); ub.destroy();
    }

    // rmsnorm, and the residual step (post norm, add, next norm)
    {
      const xb = up(emb(ids)), nb = k.buffer(T * E * 4), wb = up(n0);
      await k.dispatch('norm', {}, { 1: xb, 2: nb, 3: wb }, k.PARAMS.norm({ n: E, eps: c.eps }), [T]);
      const got = await rd(nb, T * E);
      record('rmsnorm', `token_embd rows · blk.0.attn_norm, T=${T}`, got, X0, Float64Array.from(X0, (y) => (E / 2 + 16) * u * Math.abs(y)));
      const pw = await vec(b(firstConv, 'post_attention_norm')), nw = await vec(b(firstConv, 'ffn_norm'));
      const A = R._ops.matmul(await mat(b(firstConv, 'shortconv.out_proj')), X0, T), x0 = emb(ids);
      const a2 = R._ops.rmsnorm(A, T, E, pw, c.eps), x1 = Float32Array.from(x0, (v, i) => v + a2[i]), n1 = R._ops.rmsnorm(x1, T, E, nw, c.eps);
      const ab = up(A), x0b = up(x0), pwb = up(pw), nwb = up(nw);
      await k.dispatch('norm', { ADD: true, POST: true }, { 0: ab, 1: x0b, 2: nb, 3: pwb, 4: nwb }, k.PARAMS.norm({ n: E, eps: c.eps }), [T]);
      const gx = await rd(x0b, T * E), gn = await rd(nb, T * E);
      const bx = Float64Array.from(x1, (v, i) => u * Math.abs(v) + (E / 2 + 16) * u * Math.abs(a2[i]));
      const bn = new Float64Array(T * E);
      for (let t = 0; t < T; t++) {
        let ss = 0, sb = 0;
        for (let i = 0; i < E; i++) { ss += x1[t * E + i] ** 2; sb += bx[t * E + i] ** 2; }
        const kx = 1 / Math.sqrt(ss / E + c.eps), rel = Math.sqrt(sb / ss);
        for (let i = 0; i < E; i++) { const j = t * E + i; bn[j] = (E / 2 + 16) * u * Math.abs(n1[j]) + kx * Math.abs(nw[i]) * bx[j] + Math.abs(n1[j]) * rel; }
      }
      record('add+norm', `residual x (out_proj output, post norm)`, gx, x1, bx);
      record('add+norm', `next norm (ffn_norm)`, gn, n1, bn);
      for (const q of [xb, nb, wb, ab, x0b, pwb, nwb]) q.destroy();
    }

    // shortconv: two prompt chunks then a decode step, the state rolling across them
    {
      const L = firstConv, conv = await vec(b(L, 'shortconv.conv')), Kc = c.lCache - 1;
      const bcxAll = R._ops.matmul(await mat(b(L, 'shortconv.in_proj')), X0, T);
      let state = Float32Array.from({ length: Kc * E }, (_, i) => Math.sin(i * 0.37) * 0.5);
      const sb = up(state), wb = up(conv);
      const steps = [[0, Math.min(4, T)], [Math.min(4, T), T - 1], [T - 1, T]].filter(([a, z]) => z > a);
      for (const [a, z] of steps) {
        const Tn = z - a, bcx = bcxAll.subarray(a * 3 * E, z * 3 * E);
        const ref = R._ops.shortconv(bcx, state, conv, Tn, E, Kc);
        const bb = up(Float32Array.from(bcx)), yb = k.buffer(Tn * E * 4);
        await k.dispatch('shortconv', {}, { 0: bb, 1: sb, 2: wb, 3: yb }, k.PARAMS.shortconv({ T: Tn, E, K: Kc }), k.grid(Math.ceil((Tn * E) / 256)));
        await k.dispatch('shortconv', { ROLL: true }, { 0: bb, 1: sb }, k.PARAMS.shortconv({ T: Tn, E, K: Kc }), [Math.ceil(E / 256)]);
        const got = await rd(yb, Tn * E), gs = await rd(sb, Kc * E);
        const bound = new Float64Array(Tn * E);
        for (let t = 0; t < Tn; t++) for (let i = 0; i < E; i++) {
          let m = 0;
          for (let j = 0; j <= Kc; j++) { const src = t + j < Kc ? state[(t + j) * E + i] : bcx[(t + j - Kc) * 3 * E + i] * bcx[(t + j - Kc) * 3 * E + 2 * E + i]; m += Math.abs(src * conv[i * (Kc + 1) + j]); }
          bound[t * E + i] = (Kc + 5) * u * Math.abs(bcx[t * 3 * E + E + i]) * m + u * Math.abs(ref.y[t * E + i]);
        }
        record('shortconv', `layer ${L} conv, T=${Tn}`, got, ref.y, bound);
        bits('shortconv', `layer ${L} rolled state after T=${Tn}`, gs, ref.state);
        state = ref.state;
        bb.destroy(); yb.destroy();
      }
      sb.destroy(); wb.destroy();
    }

    // q/k RMS norm + RoPE + the cache write, on real projections at the start and deep into the context
    const D = c.headDim, H = c.nHead;
    for (const layer of [firstFull, firstSwa].filter((l) => l >= 0)) {
      const swa = c.layers[layer] === 'swa', Hkv = c.nHeadKv[layer], width = Hkv * D;
      const q = R._ops.matmul(await mat(b(layer, 'attn_q')), X0, T), kk = R._ops.matmul(await mat(b(layer, 'attn_k')), X0, T), v = R._ops.matmul(await mat(b(layer, 'attn_v')), X0, T);
      const qn = await vec(b(layer, 'attn_q_norm')), kn = await vec(b(layer, 'attn_k_norm'));
      const freqs = g.tensor('rope_freqs.weight') ? await vec('rope_freqs.weight') : null;
      for (const pos of [0, 1500]) {
        const ctx = pos + T, ring = swa ? 256 + 128 : 0, slots = ring || ctx;
        const table = swa ? EN.ropeTable(0, ctx, c.nRotSwa, c.ropeBaseSwa, null) : EN.ropeTable(0, ctx, c.nRot, c.ropeBase, freqs);
        const qr = R._ops.rmsnorm(q, T * H, D, qn, c.eps), kr = R._ops.rmsnorm(kk, T * Hkv, D, kn, c.eps);
        const qy = Float32Array.from(qr), ky = Float32Array.from(kr);
        const ps = Array.from({ length: T }, (_, t) => pos + t);
        if (swa) { R._ops.rope(qr, T, H, D, ps, c.nRotSwa, c.ropeBaseSwa, null); R._ops.rope(kr, T, Hkv, D, ps, c.nRotSwa, c.ropeBaseSwa, null); }
        else { R._ops.rope(qr, T, H, D, ps, c.nRot, c.ropeBase, freqs); R._ops.rope(kr, T, Hkv, D, ps, c.nRot, c.ropeBase, freqs); }
        const ql = up(Float32Array.from(q)), kl = up(kk), vl = up(v), Kb = k.buffer(slots * width * (f16 ? 2 : 4)), Vb = k.buffer(slots * width * (f16 ? 2 : 4));
        const qnb = up(qn), knb = up(kn), tb = up(table);
        await k.dispatch('rope', {}, { 0: ql, 1: kl, 2: vl, 3: Kb, 4: Vb, 5: qnb, 6: knb, 7: tb }, k.PARAMS.rope({ T, pos, H, Hkv, D, ring, eps: c.eps }), [H + Hkv, T]);
        const half = D / 2;
        const bnd = (y, r, heads) => {
          const out = new Float64Array(r.length);
          for (let t = 0; t < T; t++) for (let h = 0; h < heads; h++) for (let i = 0; i < half; i++) {
            const o = (t * heads + h) * D, cs = table[((pos + t) * half + i) * 2], sn = table[((pos + t) * half + i) * 2 + 1];
            const m0 = Math.abs(y[o + i] * cs) + Math.abs(y[o + i + half] * sn), m1 = Math.abs(y[o + i] * sn) + Math.abs(y[o + i + half] * cs);
            out[o + i] = (D / 2 + 19) * u * m0 + u * Math.abs(r[o + i]);
            out[o + i + half] = (D / 2 + 19) * u * m1 + u * Math.abs(r[o + i + half]);
          }
          return out;
        };
        record('rope', `layer ${layer} ${swa ? 'sliding' : 'full'} q, pos ${pos}..${pos + T - 1}`, await rd(ql, T * H * D), qr, bnd(qy, qr, H));
        // The caches: rows at slot (pos + t) mod ring, as f32 or f16.
        const readCache = async (buf) => {
          if (!f16) return new Float32Array(await k.read(buf));
          const h = new Uint16Array(await k.read(buf)), out = new Float32Array(h.length);
          for (let i = 0; i < h.length; i++) out[i] = Q.fp16(h[i]);
          return out;
        };
        const Kc = await readCache(Kb), Vc = await readCache(Vb);
        const gk = new Float32Array(T * width), gv = new Float32Array(T * width);
        for (let t = 0; t < T; t++) { const s = ring ? (pos + t) % ring : pos + t; gk.set(Kc.subarray(s * width, (s + 1) * width), t * width); gv.set(Vc.subarray(s * width, (s + 1) * width), t * width); }
        const kb = bnd(ky, kr, Hkv);
        record('rope', `layer ${layer} k → ${f16 ? 'f16 ' : ''}cache, pos ${pos}`, gk, kr, f16 ? Float64Array.from(kb, (x, i) => x + h11 * Math.abs(kr[i]) + h25) : kb);
        if (f16) record('rope', `layer ${layer} v → f16 cache`, gv, v, Float64Array.from(v, (x) => h11 * Math.abs(x) + h25));
        else bits('rope', `layer ${layer} v → cache`, gv, v);
        for (const q2 of [ql, kl, vl, Kb, Vb, qnb, knb, tb]) q2.destroy();
      }
    }

    // attention: synthetic keys and values of a real head's scale, decode and prefill, full and sliding (ring)
    {
      let s = 99;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const normal = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
      // LFM3's shape whatever the model: 16 query heads over 4 KV heads.
      const H = 16, Hkv = 4, width = Hkv * D;
      const kn = await vec(b(firstFull, 'attn_k_norm')), qn = await vec(b(firstFull, 'attn_q_norm'));
      const N = 600;
      const Kf = Float32Array.from({ length: N * width }, (_, i) => normal() * kn[i % D]), Vf = Float32Array.from({ length: N * width }, () => normal());
      if (f16) for (const A of [Kf, Vf]) for (let i = 0; i < A.length; i++) A[i] = Q.fp16(f32ToHalf(A[i]));
      for (const [T2, window] of [[1, 0], [1, 256], [37, 0], [37, 256]]) {
        const pos = N - T2, ring = window ? 256 + 128 : 0, slots = ring || N;
        const q = Float32Array.from({ length: T2 * H * D }, (_, i) => normal() * qn[i % D]), gt = Float32Array.from({ length: T2 * H }, () => 2 * normal());
        const ref = R._ops.attend(q, Kf, Vf, gt, { T: T2, pos, H, Hkv, hd: D, window });
        const toCache = (A) => {
          const c2 = new Float32Array(slots * width);
          for (let j = 0; j < N; j++) { const sl = ring ? j % ring : j; c2.set(A.subarray(j * width, (j + 1) * width), sl * width); }
          return f16 ? Uint16Array.from(c2, f32ToHalf) : c2;
        };
        const qb = up(q), Kb = up(toCache(Kf)), Vb = up(toCache(Vf)), gb = up(gt), ob = k.buffer(T2 * H * D * 4);
        const runs = [];
        await k.dispatch('attention', {}, { 0: qb, 1: Kb, 2: Vb, 3: gb, 4: ob }, k.PARAMS.attention({ T: T2, pos, H, Hkv, window, ring, scale: 1 / Math.sqrt(D) }), [H, T2]);
        runs.push(['', await rd(ob, T2 * H * D)]);
        if (T2 === 1) {
          // The decode path: a workgroup per head and tile of keys, then merged.
          const tiles = Math.ceil((window ? Math.min(window, pos + 1) : pos + 1) / 128), part = k.buffer(H * tiles * (D + 2) * 4);
          const w = k.PARAMS.attention({ T: 1, pos, H, Hkv, window, ring, scale: 1 / Math.sqrt(D), splits: tiles });
          await k.dispatch('attention', { SPLIT: true }, { 0: qb, 1: Kb, 2: Vb, 6: part }, w, [H, 1, tiles]);
          await k.dispatch('attention', { COMBINE: true }, { 3: gb, 4: ob, 6: part }, w, [H, 1]);
          runs.push([`, ${tiles} tiles split`, await rd(ob, T2 * H * D)]);
          part.destroy();
        }
        const bound = new Float64Array(T2 * H * D), sc = 1 / Math.sqrt(D);
        for (let t = 0; t < T2; t++) for (let h = 0; h < H; h++) {
          const p = pos + t, from = window ? Math.max(0, p - window + 1) : 0, kh = Math.floor(h / (H / Hkv)) * D, qo = (t * H + h) * D;
          const sv = [], sa = [];
          for (let j = from; j <= p; j++) { let d = 0, a = 0; for (let i = 0; i < D; i++) { d += q[qo + i] * Kf[j * width + kh + i]; a += Math.abs(q[qo + i] * Kf[j * width + kh + i]); } sv.push(d * sc); sa.push(a * sc); }
          const m = Math.max(...sv), z = sv.reduce((acc, x) => acc + Math.exp(x - m), 0), Rr = Math.min(88, m - Math.min(...sv));
          const eps = ((D + 8) * u + (f16 ? h11 : 0)) * Math.max(...sa), sig = 1 / (1 + Math.exp(-gt[t * H + h]));
          const relP = 2 * eps + (3 + 2 * Rr) * u + 2 * (sv.length + 8) * u + (f16 ? h11 : 0);
          for (let i = 0; i < D; i++) {
            let M = 0;
            for (let j = from; j <= p; j++) M += (Math.exp(sv[j - from] - m) / z) * Math.abs(Vf[j * width + kh + i]);
            bound[qo + i] = sig * M * relP + (2 * Math.abs(gt[t * H + h]) + 17) * u * Math.abs(ref[qo + i]);
          }
        }
        for (const [how, got] of runs) record('attention', `${window ? `sliding ${window}, ring ${ring}` : 'full'}, T=${T2} at ${pos}${how}${f16 ? ', f16 cache' : ''}`, got, ref, bound);
        for (const q2 of [qb, Kb, Vb, gb, ob]) q2.destroy();
      }
    }

    // argmax and top-k on real logits (the LM head's), and on ties
    {
      const lb = up(lm), part = k.buffer(Math.ceil(V / 4096) * 8), idb = k.buffer(4), chunks = Math.ceil(V / 4096);
      await k.dispatch('argmax', { PART: true }, { 0: lb, 1: part }, k.PARAMS.argmax({ n: V, chunks }), [chunks, 1]);
      await k.dispatch('argmax', {}, { 1: part, 2: idb }, k.PARAMS.argmax({ n: V, chunks }), [1]);
      same('argmax', `LM head logits (${V})`, new Uint32Array(await k.read(idb))[0], R.greedy(lm));
      for (const kk of [1, 50, 64]) {
        same('topk', `k=${kk} of the LM head logits`, await topCandidates(k, lb, V, kk), R.top(lm, kk).map((x) => [x.id, x.logit]));
      }
      const ties = Float32Array.from({ length: V }, (_, i) => (i % 997 === 3 ? 5 : i % 13 === 0 ? 4 : -1));
      const tb = up(ties);
      await k.dispatch('argmax', { PART: true }, { 0: tb, 1: part }, k.PARAMS.argmax({ n: V, chunks }), [chunks, 1]);
      await k.dispatch('argmax', {}, { 1: part, 2: idb }, k.PARAMS.argmax({ n: V, chunks }), [1]);
      same('argmax', 'ties: the lowest id', new Uint32Array(await k.read(idb))[0], R.greedy(ties));
      same('topk', 'ties: k=64, lower id first', await topCandidates(k, tb, V, 64), R.top(ties, 64).map((x) => [x.id, x.logit]));
      const large = Float32Array.from({ length: 140000 }, (_, i) => i), largeb = up(large);
      same('topk', 'k=64 over 140000 logits, winners beyond the first 4096 candidates', await topCandidates(k, largeb, large.length, 64), R.top(large, 64).map((x) => [x.id, x.logit]));
      for (const q2 of [lb, part, idb, tb, largeb]) q2.destroy();
    }
    e.destroy();
    return { adapter: ad, engine: { f16: e.f16, subgroups: e.subgroups, tpr: e._k.tpr, buffers: e.layout.buffers }, table, pass: table.every((r) => r.pass) };
  };

  // binary16 bits of a float, round to nearest even (for the f16 caches the reference side builds).
  const f32ToHalf = (() => {
    const f = new Float32Array(1), i = new Uint32Array(f.buffer);
    return (x) => {
      f[0] = x;
      const b = i[0], s = (b >>> 16) & 0x8000, e = (b >>> 23) & 255, m = b & 0x7fffff;
      if (e === 255) return s | 0x7c00 | (m ? 0x200 : 0);
      const ue = e - 127 + 15;
      if (ue >= 31) return s | 0x7c00;
      if (ue <= 0) {
        if (ue < -10) return s;
        const mm = m | 0x800000, shift = 14 - ue, r = mm >>> shift, rem = mm & ((1 << shift) - 1), hb = 1 << (shift - 1);
        return s | (r + (rem > hb || (rem === hb && r & 1) ? 1 : 0));
      }
      let r = (ue << 10) | (m >>> 13);
      const rem = m & 0x1fff;
      if (rem > 0x1000 || (rem === 0x1000 && r & 1)) r++;
      return s | r;
    };
  })();

  // ---- the whole model ----
  const argmax = (v) => { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; };
  const model = async (o) => {
    if (!o.ids?.length) throw new Error('no reference prompts to validate');
    if (o.api) return modelApi(o);
    const g = await open(o.model), { e, adapter: ad } = await engine(g, o), V = e.config.vocab;
    const results = { adapter: ad, engine: { f16: e.f16, subgroups: e.subgroups, tpr: e._k.tpr }, prompts: [] };
    let agree = 0, total = 0, maxPrefill = 0, maxDecode = 0;
    for (const id of o.ids) {
      const summary = o.summary;
      const ref = await (await fetch(`/f/ref/${id}.${summary ? 'summary.json' : 'json'}`)).json();
      const n = ref.prompt.length;
      const refRows = async (kind, from, count) => {
        if (summary) return null;
        const r = await fetch(`/f/ref/${id}.${kind}.f32`, { headers: { Range: `bytes=${from * 4 * V}-${(from + count) * 4 * V - 1}` } });
        return new Float32Array(await r.arrayBuffer());
      };
      // Against a full row, or the summary's top 32 (max |Δ| over those ids only).
      const cmp = (x, kind, row, full) => {
        const top = summary ? ref[kind][row] : null;
        let d = 0;
        if (summary) for (const [i, l] of top) d = Math.max(d, Math.abs(x[i] - l));
        else for (let i = 0; i < V; i++) d = Math.max(d, Math.abs(x[i] - full[i]));
        const want = summary ? top[0][0] : argmax(full), got = argmax(x);
        // A miss's margin in the reference: its top logit over the logit it gives the GPU's choice (≥ the 32nd's in a summary).
        const refGot = summary ? (top.find(([i]) => i === got) || top[top.length - 1])[1] : full[got];
        return { d, want, got, gap: (summary ? top[0][1] : full[want]) - refGot, finite: x.every(Number.isFinite) };
      };
      const s = await e.session({ ctx: n + o.steps + 8, chunk: o.chunk });
      let same = 0, dmax = 0, nonFinite = 0;
      const misses = [];
      let last = null;
      const pending = [];
      const t0 = performance.now();
      await s.forward(ref.prompt, {
        logits: 'all',
        onRows: (first, rows, count) => { pending.push((async () => {
          const full = await refRows('prefill', first, count);
          for (let r = 0; r < count; r++) {
            const x = rows.subarray(r * V, (r + 1) * V), res = cmp(x, 'prefill', first + r, full && full.subarray(r * V, (r + 1) * V));
            if (!res.finite) nonFinite++;
            dmax = Math.max(dmax, res.d);
            if (res.got === res.want) same++; else misses.push({ pos: first + r, got: res.got, want: res.want, refGap: +res.gap.toExponential(3) });
            if (first + r === n - 1) last = Float32Array.from(x);
          }
        })()); },
      });
      await Promise.all(pending);
      const prefillMs = performance.now() - t0;
      const gen = [argmax(last)];
      let ddmax = 0, compared = 0, idMismatch = 0;
      const full = await refRows('decode', 0, ref.gen.length - 1);
      const d0 = performance.now();
      for (let st = 0; st < o.steps; st++) {
        const r = await s.forward([gen[gen.length - 1]], { logits: 'last', argmax: true });
        if (r.id !== argmax(r.logits)) idMismatch++;
        const agreeSoFar = gen.every((t, i) => t === ref.gen[i]);
        if (agreeSoFar && st < ref.gen.length - 1) {
          const res = cmp(r.logits, 'decode', st, full && full.subarray(st * V, (st + 1) * V));
          ddmax = Math.max(ddmax, res.d); compared++;
          if (!res.finite) nonFinite++;
        }
        gen.push(r.id);
      }
      const decodeMs = performance.now() - d0;
      s.destroy();
      let firstDiff = 0;
      while (firstDiff < gen.length && firstDiff < ref.gen.length && gen[firstDiff] === ref.gen[firstDiff]) firstDiff++;
      const genSame = gen.length === ref.gen.length && firstDiff === gen.length && !nonFinite;
      const row = { id, tokens: n, top1: same, of: n, misses, nonFinite, prefillMaxAbs: dmax, gen: gen.length, genAgree: firstDiff, genSame, decodeCompared: compared, decodeMaxAbs: ddmax, gpuArgmaxMismatch: idMismatch, prefillMs, decodeMs, firstDiff: firstDiff < gen.length ? { step: firstDiff, got: gen[firstDiff], want: ref.gen[firstDiff] } : null };
      results.prompts.push(row);
      agree += same; total += n; maxPrefill = Math.max(maxPrefill, dmax); maxDecode = Math.max(maxDecode, ddmax);
      log(`${id}: top-1 ${same}/${n}, max |Δ| ${dmax.toExponential(3)}; greedy ${firstDiff}/${gen.length} agree, decode max |Δ| ${ddmax.toExponential(3)} over ${compared} steps${misses.length ? `; misses ${JSON.stringify(misses.slice(0, 5))}` : ''}${idMismatch ? `; GPU argmax ≠ logits argmax ${idMismatch}×` : ''}`);
    }
    e.destroy();
    const greedySame = results.prompts.filter((r) => r.genSame).length, n = results.prompts.length;
    // f32: every top-1 and every greedy token; f16 (looser): top-1 ≥ 99.5 %, greedy identical on ≥ 90 % of the prompts.
    const pass = e.f16 ? agree >= 0.995 * total && greedySame >= Math.ceil(0.9 * n) : agree === total && greedySame === n;
    Object.assign(results, { top1: agree, of: total, top1Pct: (100 * agree) / total, greedySame, prefillMaxAbs: maxPrefill, decodeMaxAbs: maxDecode, summary: !!o.summary, criterion: e.f16 ? 'f16' : 'f32', pass });
    log(`all: top-1 ${agree}/${total} (${results.top1Pct.toFixed(2)}%), greedy identical on ${results.greedySame}/${results.prompts.length}, max |Δ| prefill ${maxPrefill.toExponential(3)}, decode ${maxDecode.toExponential(3)}${o.summary ? ' (over the reference top 32)' : ''}`);
    return results;
  };

  // ---- speed ----
  const speed = async (o) => {
    const g = await open(o.model), { e, adapter: ad } = await engine(g, o), V = e.config.vocab;
    let s0 = 12345;
    const tok = () => { s0 = (s0 * 48271) % 2147483647; return 1000 + (s0 % 100000); };
    const prompt = Array.from({ length: o.prompt }, tok);
    const runOnce = async (n, m) => {
      const s = await e.session({ ctx: n + m + 8, chunk: o.chunk });
      const t0 = performance.now();
      let id = await s.greedy(prompt.slice(0, n));
      const t1 = performance.now();
      for (let i = 0; i < m; i++) id = await s.greedy([id]);
      const t2 = performance.now();
      s.destroy();
      return { prefillTokS: n / ((t1 - t0) / 1000), decodeTokS: m / ((t2 - t1) / 1000), prefillMs: t1 - t0, decodeMs: t2 - t1 };
    };
    await runOnce(Math.min(64, o.prompt), 8);
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await runOnce(o.prompt, o.decode));
    // Decode with no readback between steps (the same token fed, waiting once at the end): the GPU's and the encoder's
    // rate without the round trip a sampled token needs.
    {
      const s = await e.session({ ctx: o.prompt + o.decode + 8, chunk: o.chunk });
      await s.forward(prompt, { logits: 'none' });
      await e.device.queue.onSubmittedWorkDone();
      const t0 = performance.now();
      for (let i = 0; i < o.decode; i++) await s.forward([prompt[i]], { logits: 'none' });
      const t1 = performance.now();
      await e.device.queue.onSubmittedWorkDone();
      const t2 = performance.now();
      s.destroy();
      runs.pipelined = { decodeTokS: o.decode / ((t2 - t0) / 1000), encodeMsPerToken: (t1 - t0) / o.decode };
      log(`pipelined decode (no readback): ${runs.pipelined.decodeTokS.toFixed(1)} tok/s, ${runs.pipelined.encodeMsPerToken.toFixed(2)} ms to encode a step`);
      if (o.profile) {
        // GPU time per kernel (timestamp-query): one decode step at the end of the prompt, and one prompt chunk.
        const sum = (list) => { const m = {}; for (const x of list) m[x.name] = (m[x.name] || 0) + x.ms; return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', '); };
        // The GPU may be shared (a desktop): each kernel's least time over 5 steps (prompt chunks: 3).
        const least = (steps) => { const m = new Map(); for (const st of steps) { const per = new Map(); for (const x of st) per.set(x.name, (per.get(x.name) || 0) + x.ms); for (const [k2, v] of per) m.set(k2, Math.min(m.get(k2) ?? Infinity, v)); } return [...m].map(([name, ms]) => ({ name, ms })); };
        const s2 = await e.session({ ctx: o.prompt + 16, chunk: o.chunk });
        const preSteps = [];
        for (let i = 0; i < 3; i++) preSteps.push((await s2.forward(prompt.slice(i * o.chunk, (i + 1) * o.chunk), { logits: 'none', profile: true })).profile);
        await s2.forward(prompt.slice(3 * o.chunk, o.prompt), { logits: 'none' });
        const decSteps = [];
        for (let i = 0; i < 5; i++) decSteps.push((await s2.forward([prompt[i]], { logits: 'last', argmax: true, profile: true })).profile);
        s2.destroy();
        const pre = least(preSteps), dec = least(decSteps);
        runs.profile = { decode: dec, prefill: pre };
        log(`profile, decode step at ${o.prompt} (least ms of 5): total ${dec.reduce((a, x) => a + x.ms, 0).toFixed(3)}: ${sum(dec)}`);
        log(`profile, prefill chunk of ${o.chunk} (least ms of 3): total ${pre.reduce((a, x) => a + x.ms, 0).toFixed(3)}: ${sum(pre)}`);
      }
    }
    const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
    const out = { adapter: ad, engine: { f16: e.f16, subgroups: e.subgroups, tpr: e._k.tpr }, prompt: o.prompt, decode: o.decode, chunk: o.chunk, runs, pipelined: runs.pipelined, prefillTokS: med('prefillTokS'), decodeTokS: med('decodeTokS') };
    log(`speed: prefill ${o.prompt} tokens ${out.prefillTokS.toFixed(1)} tok/s, decode ${o.decode} tokens ${out.decodeTokS.toFixed(1)} tok/s (median of 3, chunk ${o.chunk})`);
    e.destroy();
    return out;
  };

  // ---- bench: one GEMV, 200 times in one pass ----
  const bench = async (o) => {
    const g = await open(o.model), { e } = await engine(g, o), k = e._k, c = e.config, out = [];
    const names = ['blk.0.ffn_gate.weight', 'blk.0.shortconv.in_proj.weight', 'blk.0.ffn_down.weight', 'token_embd.weight'];
    for (const name of names) {
      const t = k.tensor(name), r = t.runs[0], glu = name.includes('ffn_gate') && r.pairOff !== undefined;
      const xb = k.upload(Float32Array.from({ length: t.cols }, (_, i) => Math.sin(i))), yb = k.buffer(t.rows * 4);
      const p = await k.pipe('matvec', { [t.type]: true, GLU: glu }), u = k.upload(k.PARAMS.matvec({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, upOff: glu ? r.pairOff : 0 }), GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const bg = e.device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: r.bind }, { binding: 1, resource: { buffer: xb } }, { binding: 2, resource: { buffer: yb } }, { binding: 3, resource: { buffer: u } }] });
      const run = async (n) => {
        const enc = e.device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(p); pass.setBindGroup(0, bg);
        for (let i = 0; i < n; i++) pass.dispatchWorkgroups(...k.grid(Math.ceil(r.rows / (256 / k.tpr))));
        pass.end(); e.device.queue.submit([enc.finish()]);
        await e.device.queue.onSubmittedWorkDone();
      };
      await run(5);
      let best = Infinity;
      for (let i = 0; i < 3; i++) { const t0 = performance.now(); await run(200); best = Math.min(best, (performance.now() - t0) / 200); }
      const bytes = r.size;
      out.push({ name, type: t.type, glu, us: best * 1000, GBs: bytes / (best / 1000) / 1e9 });
      log(`bench ${name}${glu ? ' + ffn_up (GLU)' : ''} ${t.type}: ${(best * 1000).toFixed(1)} µs, ${(bytes / (best / 1000) / 1e9).toFixed(0)} GB/s`);
    }
    e.destroy();
    return { bench: out };
  };

  // ---- small: the tiny random model ----
  const small = async (o) => {
    const k = await kernels({ ...o, model: 'tiny', tokens: [1, 77, 300, 999, 512, 4] });
    // The whole model on the plain path (Firefox's: no subgroups); the kernels above took subgroups where the adapter has them.
    const g = await open('tiny'), { e } = await engine(g, { ...o, subgroups: 'off' }), m = await R.load(g), V = e.config.vocab;
    const prompt = Array.from({ length: 20 }, (_, i) => (i * 37 + 5) % V);
    const ref = R.session(m), gpu = await e.session({ ctx: 64, chunk: 8 });
    const rows = [];
    const want = ref.forward(prompt, { logits: 'all' });
    const got = (await gpu.forward(prompt, { logits: 'all' })).logits;
    rows.push(['prefill', got, want, prompt.length]);
    let next = R.greedy(want.subarray((prompt.length - 1) * V));
    for (let s = 0; s < 12; s++) {
      const w = ref.forward([next]), r = await gpu.forward([next], { logits: 'last', argmax: true });
      rows.push([`decode ${s}`, r.logits, w, 1, r.id]);
      next = R.greedy(w);
    }
    let maxAbs = 0, maxRef = 0, top1 = 0, decided = 0, argOk = 0;
    for (const [, gv, wv, n, id] of rows) {
      for (let i = 0; i < gv.length; i++) { maxAbs = Math.max(maxAbs, Math.abs(gv[i] - wv[i])); maxRef = Math.max(maxRef, Math.abs(wv[i])); }
      for (let r = 0; r < n; r++) {
        const a = wv.subarray(r * V, (r + 1) * V), b2 = gv.subarray(r * V, (r + 1) * V), best = R.top(a, 2);
        if (best[0].logit - best[1].logit > 1e-3 * Math.max(1, Math.abs(best[0].logit))) { decided++; if (argmax(b2) === best[0].id) top1++; }
      }
      if (id !== undefined && id === argmax(gv)) argOk++;
    }
    const rel = maxAbs / maxRef;
    const pass = k.pass && rel < 1e-4 && top1 === decided && argOk === 12;
    log(`${pass ? 'ok  ' : 'FAIL'} tiny model: 20-token prompt in chunks of 8 and 12 decode steps, logits max|Δ| ${maxAbs.toExponential(2)} (rel ${rel.toExponential(2)}), top-1 ${top1}/${decided} where the reference's top two differ, GPU argmax ${argOk}/12`);
    gpu.destroy(); e.destroy();
    const api = await apiChecks(o, await open('tiny'));
    return { ...k, model: { maxAbs, rel, top1, decided, argOk }, api, pass: pass && api.every((r) => r.pass) };
  };

  // The model interface (EN.load) on a GPU: a mask forcing a token, a masked pick against the reference's logits, snapshot
  // and restore giving the same tokens, a cancel inside a long prefill, release.
  const loadModel = async (g, o, extra) => EN.load(g, { adapter: await adapter(), precision: o.precision, subgroups: o.subgroups === 'off' ? false : 'auto', kernels: new URL('/ai/local/kernels/', location.href).href, ...extra });
  const apiChecks = async (o, g) => {
    const out = [], say = (pass, what) => { out.push({ pass, what }); log(`${pass ? 'ok  ' : 'FAIL'} api        ${what}`); };
    const m = await loadModel(g, o, { context: 64, chunk: 8 }), V = m.engine.config.vocab, W = Math.ceil(V / 32);
    const ref = R.session(await R.load(g));
    const prompt = Array.from({ length: 20 }, (_, i) => (i * 37 + 5) % V);
    const logits = ref.forward(prompt);
    const snap = await m.prefill(prompt, { snapshot: true });
    const only = (ids) => { const w = new Uint32Array(W); for (const i of ids) w[i >> 5] |= 1 << (i & 31); return w; };
    // Hot sampling (the tiny random model's greedy choice is nearly always the same id) makes runs differ when state does.
    const greedy = { temperature: 0 }, sampled = { temperature: 5, topK: 64 };
    // One id allowed: decode gives it, greedy or sampled, however low its logit.
    const order = R.top(logits, V).map((x) => x.id), low = order[V - 1], mid = order[Math.floor(V / 2)];
    let forced = true;
    for (const id of [order[0], mid, low]) for (const sp of [greedy, sampled]) {
      await m.restore(snap);
      forced &&= (await m.decode({ sampler: sp, mask: only([id]) })) === id;
    }
    say(forced, `a mask allowing one id forces it (the highest, a middle and the lowest logit; greedy and hot top-k)`);
    // The highest cleared, and half the vocabulary at random: the pick is the reference's best among the allowed.
    let seed = 5;
    const half = Array.from({ length: V }, (_, i) => i).filter(() => ((seed = (seed * 16807) % 2147483647) & 1) === 0);
    let masked = true;
    for (const allowed of [order.slice(1), half.filter((i) => i !== order[0])]) {
      await m.restore(snap);
      const id = await m.decode({ sampler: greedy, mask: only(allowed) });
      const best = allowed.slice().sort((a, b) => logits[b] - logits[a] || a - b);
      masked &&= allowed.includes(id) && (id === best[0] || logits[best[0]] - logits[best[1]] < 1e-3);
    }
    say(masked, 'a masked argmax never picks a cleared id, and picks the best allowed');
    // Snapshot → decode → restore → decode: the same tokens.
    const run = async (n, sp, random) => { const ids = []; for (let i = 0; i < n; i++) ids.push(await m.decode({ sampler: sp, random })); return ids; };
    await m.restore(snap);
    const a = await run(8, greedy);
    await m.restore(snap);
    const b = await run(8, greedy);
    const draw = () => { let x = 1; return () => ((x = (x * 48271) % 2147483647) / 2147483647); };
    await m.restore(snap);
    const c = await run(8, sampled, draw());
    await m.restore(snap);
    const d = await run(8, sampled, draw());
    // And the same as the prompt fed afresh from the empty state (restore(base) then prefill), so no state leaked.
    const base = await m.snapshot();
    await m.restore(base);
    await m.restore(snap);
    await m.decode({ sampler: greedy });
    const e0 = await m.snapshot();
    await m.restore(e0);
    e0.drop();
    const fresh = await loadModel(g, o, { context: 64, chunk: 8 });
    await fresh.prefill(prompt);
    const f = []; const fd = draw();
    for (let i = 0; i < 8; i++) f.push(await fresh.decode({ sampler: sampled, random: fd }));
    fresh.release(); base.drop();
    say(a.join() === b.join() && c.join() === d.join() && c.join() === f.join(), `snapshot, decode 8, restore, decode 8: the same tokens as each other and as a fresh model, greedy (${a.join(' ')}) and seeded hot top-k (${c.join(' ')})`);
    // Cancel inside a long prefill: it stops at a chunk boundary with the reason given.
    await m.restore(snap);
    const ctl = new AbortController(), why = new Error('cancelled by the check');
    const long = Array.from({ length: 40 }, (_, i) => (i * 13 + 1) % V), start = m.pos;
    const p = m.prefill(long, { signal: ctl.signal });
    setTimeout(() => ctl.abort(why), 0);
    const rej = await p.then(() => null, (e) => e);
    say(rej === why && m.pos - start < long.length && (m.pos - start) % 8 === 0, `cancel inside a 40-token prefill (chunks of 8) rejects with its reason after ${m.pos - start} tokens`);
    m.release();
    say(await m.decode({ sampler: greedy }).then(() => false, (e) => /released/.test(e.message)), 'after release the model refuses');
    return out;
  };

  // The whole model through the interface (load, prefill, decode): top-1 at every prompt position and greedy tokens.
  const modelApi = async (o) => {
    const g = await open(o.model), refs = [];
    for (const id of o.ids) refs.push(await (await fetch(`/f/ref/${id}.${o.summary ? 'summary.json' : 'json'}`)).json());
    const m = await loadModel(g, o, { context: Math.max(...refs.map((r) => r.prompt.length)) + o.steps + 8, chunk: o.chunk });
    const V = m.engine.config.vocab, base = await m.snapshot();
    const results = { engine: { f16: m.engine.f16, subgroups: m.engine.subgroups }, prompts: [], api: true };
    let agree = 0, total = 0;
    for (const [n, ref] of refs.entries()) {
      await m.restore(base);
      let same = 0;
      const misses = [];
      const want = (row) => (o.summary ? ref.prefill[row][0][0] : null);
      const pending = [];
      const after = await m.prefill(ref.prompt, { snapshot: true, onRows: (first, rows, count) => pending.push((async () => {
        const full = o.summary ? null : new Float32Array(await (await fetch(`/f/ref/${ref.id}.prefill.f32`, { headers: { Range: `bytes=${first * 4 * V}-${(first + count) * 4 * V - 1}` } })).arrayBuffer());
        for (let r = 0; r < count; r++) {
          const got = argmax(rows.subarray(r * V, (r + 1) * V)), w = full ? argmax(full.subarray(r * V, (r + 1) * V)) : want(first + r);
          if (got === w) same++; else misses.push({ pos: first + r, got, want: w });
        }
      })()) });
      await Promise.all(pending);
      const gen = [];
      for (let st = 0; st <= o.steps; st++) gen.push(await m.decode({ sampler: { temperature: 0 } }));
      // Restore the state after the prompt and generate again: the same tokens.
      await m.restore(after);
      const again = [];
      for (let st = 0; st <= o.steps; st++) again.push(await m.decode({ sampler: { temperature: 0 } }));
      after.drop();
      const restored = again.join() === gen.join();
      let firstDiff = 0;
      while (firstDiff < gen.length && gen[firstDiff] === ref.gen[firstDiff]) firstDiff++;
      const genSame = firstDiff === ref.gen.length && gen.length === ref.gen.length;
      results.prompts.push({ id: o.ids[n], top1: same, of: ref.prompt.length, misses, genAgree: firstDiff, genSame, restored });
      agree += same; total += ref.prompt.length;
      log(`${o.ids[n]} (api): top-1 ${same}/${ref.prompt.length}; greedy ${firstDiff}/${gen.length} agree; after restore ${restored ? 'the same' : 'DIFFERENT'}${misses.length ? `; misses ${JSON.stringify(misses.slice(0, 5))}` : ''}`);
    }
    m.release();
    const greedySame = results.prompts.filter((r) => r.genSame).length, n = results.prompts.length;
    const restoredAll = results.prompts.every((r) => r.restored);
    const pass = restoredAll && (m.engine.f16 ? agree >= 0.995 * total && greedySame >= Math.ceil(0.9 * n) : agree === total && greedySame === n);
    Object.assign(results, { top1: agree, of: total, greedySame, restoredAll, pass });
    log(`all (api): top-1 ${agree}/${total} (${((100 * agree) / total).toFixed(2)}%), greedy identical on ${greedySame}/${n}`);
    return results;
  };

  // A warm system turn: prefill it once with a snapshot, then (5 times) restore, prefill a user turn, decode one token.
  // window.nodeMem(label) (the check's Node side) reads the GPU's memory before the load, loaded, and after release.
  const warm = async (o) => {
    const g = await open(o.model), mem = [];
    const note = async (label) => { if (window.nodeMem) mem.push({ label, mib: await window.nodeMem(label) }); };
    let sys = null;
    try { sys = (await (await fetch('/f/ref/long-1500.json')).json()).prompt; } catch { /* synthetic */ }
    const V0 = 128000;
    let s0 = 777;
    const tok = () => { s0 = (s0 * 48271) % 2147483647; return 1000 + (s0 % 100000); };
    sys = (sys || Array.from({ length: 1500 }, tok)).slice(0, o.system);
    await adapter();
    await note('before load');
    const t0 = performance.now();
    const m = await loadModel(g, o, { context: 16000, chunk: o.chunk });
    const loadMs = performance.now() - t0;
    const base = await m.snapshot();
    const c0 = performance.now();
    const snap = await m.prefill(sys, { snapshot: true });
    await m.decode({ sampler: { temperature: 0 } });
    const coldMs = performance.now() - c0;
    await note('loaded');
    const rows = [];
    for (const user of [64, 256]) {
      const turn = Array.from({ length: user }, tok).map((x) => x % V0), times = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        await m.restore(snap);
        await m.prefill(turn);
        await m.decode({ sampler: { temperature: 0.1, topK: 50 } });
        times.push(performance.now() - t);
      }
      const med = times.sort((a, b) => a - b)[2];
      rows.push({ user, firstTokenMs: med, times });
      log(`warm: a ${sys.length}-token system turn restored, a ${user}-token user turn, first token in ${med.toFixed(1)} ms (median of 5)`);
    }
    base.drop(); snap.drop();
    m.release();
    await new Promise((r) => setTimeout(r, 1500));
    await note('after release');
    log(`warm: load ${loadMs.toFixed(0)} ms, cold system turn + first token ${coldMs.toFixed(0)} ms; GPU memory ${mem.map((x) => `${x.label} ${x.mib} MiB`).join(', ')}`);
    return { system: sys.length, loadMs, coldMs, rows, mem };
  };

  window.CK = { kernels, model, speed, small, bench, warm, adapter: async () => describe(await adapter()) };
}

// ---- Node: serve, launch, run ---------------------------------------------------------------------------------------------
const MIME = { '.js': 'text/javascript', '.wgsl': 'text/plain', '.json': 'application/json', '.html': 'text/html' };
const containedFile = (root, name) => {
  try {
    const base = fs.realpathSync(root), file = fs.realpathSync(path.resolve(base, name));
    const rel = path.relative(base, file);
    return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel) ? file : null;
  } catch { return null; }
};
const serve = (files) => http.createServer((req, res) => {
  // The check navigates only to this loopback address. Reject DNS-rebinding origins before exposing local files.
  if (!/^127\.0\.0\.1(?::\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (url.includes('\0')) throw new Error('NUL');
  } catch { res.writeHead(400); return res.end(); }
  if (url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<!doctype html><title>engine</title>${['gguf', 'quant', 'reference', 'engine'].map((n) => `<script src="/ai/local/${n}.js"></script>`).join('')}<script>(${pageLib})()</script>`);
  }
  let file = null, body = null;
  if (url.startsWith('/ai/local/')) file = containedFile(path.join(EXTENSION, 'ai/local'), url.slice('/ai/local/'.length));
  else if (url.startsWith('/f/')) {
    const key = url.slice(3);
    const hit = Object.hasOwn(files, key) ? files[key] : key.startsWith('ref/') && files.ref ? containedFile(files.ref, key.slice(4)) : null;
    if (Buffer.isBuffer(hit)) body = hit; else if (typeof hit === 'string') file = hit;
  }
  if (!body && (!file || !fs.existsSync(file) || !fs.statSync(file).isFile())) { res.writeHead(404); return res.end(); }
  const size = body ? body.length : fs.statSync(file).size, type = MIME[path.extname(url)] || 'application/octet-stream';
  const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
  if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': size, 'content-type': type, 'accept-ranges': 'bytes' }); return res.end(); }
  if (!m) { res.writeHead(200, { 'content-length': size, 'content-type': type }); return body ? res.end(body) : fs.createReadStream(file).pipe(res); }
  const from = +m[1], to = Math.min(+m[2], size - 1);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(+m[2]) || from > to || from >= size) {
    res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end();
  }
  res.writeHead(206, { 'content-length': to - from + 1, 'content-range': `bytes ${from}-${to}/${size}`, 'content-type': type });
  if (body) return res.end(body.subarray(from, to + 1));
  fs.createReadStream(file, { start: from, end: to }).pipe(res);
});

module.exports = { serve, tinyModel, pageLib };

if (require.main === module) (async () => {
  if (!['adapter', 'kernels', 'model', 'speed', 'small', 'bench', 'warm'].includes(mode)) {
    console.error('usage: node checks/ai/local-engine-check.js adapter | kernels <gguf> | model <gguf> <ref dir> | speed <gguf> | small | summarize <ref dir> <out dir>  (see the top of this file)');
    process.exit(2);
  }
  const files = {};
  if (mode === 'small') files.tiny = tinyModel();
  else if (mode !== 'adapter') { files.model = path.resolve(args[0] || ''); if (!fs.existsSync(files.model)) throw new Error(`no model ${args[0]}`); }
  if (mode === 'model' || (mode === 'warm' && args[1])) files.ref = path.resolve(args[1]);
  const out = opt.out ? path.resolve(opt.out) : null;
  if (out) fs.mkdirSync(out, { recursive: true });
  const logLines = [];
  const say = (line) => { console.log(line); logLines.push(line); };
  const { chromium } = require('playwright');
  // The heavy-run lock (tools/dev/check-env.js), every mode: one browser at a time on a shared machine.
  const lock = require('../../tools/dev/check-env.js').lockPath();
  let held = false, browser = null;
  const server = serve(files).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-engine-'));
  let result = null;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; break; } catch (e) { if (e.code !== 'EEXIST' || i > 600) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nlocal-engine-check\n`);
    // Stopped by a signal: give the lock back (the browser goes with the process).
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { fs.rmSync(lock, { recursive: true, force: true }); process.exit(sig === 'SIGINT' ? 130 : 143); });
    const flags = FLAGS[opt.flags] || opt.flags.split(' ');
    await require('../../tools/dev/wait-for-browser.js')();
    browser = await chromium.launch({ ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, args: flags });
    const page = await browser.newPage();
    // Nothing but the check's own server: no network.
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', (r) => (r.request().url().startsWith(`${origin}/`) ? r.continue() : r.abort()));
    page.on('console', (m) => say(m.text()));
    page.on('pageerror', (e) => say(`page error: ${e.message}`));
    await page.goto(`${origin}/`);
    const o = { ...opt, model: 'model' };
    if (opt.tokens) o.tokens = opt.tokens.split(',').map(Number);
    // GPU memory in use (MiB) for warm, from nvidia-smi where there is one.
    await page.exposeFunction('nodeMem', () => { try { return +require('node:child_process').execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split('\n')[0]; } catch { return null; } });
    if (mode === 'model') o.ids = PROMPTS.map((p) => p.id).filter((id) => (!opt.only || opt.only.split(',').includes(id)) && fs.existsSync(path.join(files.ref, `${id}.${opt.summary ? 'summary.json' : 'json'}`)));
    result = await page.evaluate(([m, a]) => window.CK[m](a), [mode, o]);
    if (mode === 'adapter') say(JSON.stringify(result, null, 1));
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) {
      if (result) fs.writeFileSync(path.join(out, `${mode}.json`), JSON.stringify({ mode, flags: opt.flags, args, opt, result }, null, 1));
      fs.writeFileSync(path.join(out, `${mode}.log`), logLines.join('\n') + '\n');
    }
  }
  const pass = !!result && result.pass !== false;
  if (!['adapter', 'speed', 'bench', 'warm'].includes(mode)) say(pass ? 'PASS' : 'FAIL');
  process.exitCode = pass ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
