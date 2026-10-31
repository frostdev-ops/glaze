// The picture encoder on WebGPU (extension/ai/local/vision.js, kernels/vision-*.wgsl) against its CPU reference
// (extension/ai/local/vision-reference.js), in Chromium. Modes:
//   small                                   a tiny random lfm3vl projector (no model file): each kernel against a CPU
//                                           computation within the error bounds below, then the whole encoder against
//                                           the reference (SwiftShader by default; tools/dev/ci-browser-checks.js runs it)
//   model <mmproj.gguf> <images> <ref dir>  the five pictures of local-vision-check.js (<images>/<id>-<w>x<h>.rgba) against
//                                           the reference's embeddings (<ref dir>/<id>.embd.f32): max |Δ| ≤ 1e-3 on f32
//                                           (reported on f16); --out gets the GPU's <id>.embd.f32 for `lm`
//   speed <mmproj.gguf> [--size 1024x1024]  encode time of a picture (after a warm-up, median of 3) and the CPU's share
//   prefill <model.gguf> <mmproj.gguf> <images> <ref dir>
//                                           end to end on the GPU: the VL model's text half in the engine
//                                           (GZ_AI_ENGINE.load), the pictures encoded on its device and fed as prefill
//                                           embeds; top-1 at every text position against <ref dir>/<id>.prefill.f32
//                                           (vision-reference.js and the reference text model): all must agree
//   lm <model.gguf> <gpu dir> <ref dir>     (Node only, an hour of CPU) the GPU's embeddings through the reference text
//                                           model in place of the reference's own: top-1 at every text position of the
//                                           prompt against <ref dir>/<id>.prefill.f32 (local-vision-check.js's dumps)
// Options: --out <dir> (results, the log), --flags nvidia | swiftshader | none (Chromium's GPU flags; small: swiftshader),
// --precision auto | f32 | f16, --jobs n (lm).
// Error bounds (u = 2⁻²⁴; each from the reference's own values, the reference summing in double):
//   matmul    (K + 16)·u·Σ|w·x| + u·|y| (ACC: + u·|Y|); f16 tiles: + 2⁻¹¹·Σ|w·x| + 2⁻²⁵·Σ|w| (x rounded to f16, w is
//             already f16); BIAS: + u·|y|; GELU: 1.13 × the input's bound + 4·10⁻⁷·|gelu|
//   rmsnorm   (n/2 + 16)·u·|y|;  layernorm (n + 32)·u·(|y − b| + |b|)
//   rope      (n/2 + 24)·u·(|y₀ cos| + |y₁ sin|) + u·|r| (norm and rotation)
//   attention Σp|v|·(2ε + (3 + 2R)·u + 2(N + 8)·u [+ 2⁻¹⁰ f16]) with ε the scores' bound ((D + 8)·u [+ 2⁻¹⁰ f16] ×
//             max scale·Σ|q·k|), R the widest exponent used, N the keys
//   conv      14·u·|C|·Σ|w·B·X| + u·|y|;  glu (2|g| + 16)·u·|y|;  im2col bit for bit
//   Every bound also allows 2⁻¹²⁰ absolute (GPUs may flush f32 subnormals).
// Whole encoder (small): max |Δ| ≤ 10⁻⁴ × the largest embedding on f32, 10⁻² on f16.
//   NODE_PATH=<playwright> node checks/ai/local-vision-gpu-check.js <mode> ... --out <dir> --flags nvidia
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const PICTURES = ['text', 'chart', 'table', 'diagram', 'photo'];
const EMBD_TOL = 1e-3;
const FLAGS = {
  nvidia: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-vulkan-surface'],
  swiftshader: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
  none: [],
};

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const mode = args.shift();
const opt = { out: flag('--out', null), flags: flag('--flags', mode === 'small' ? 'swiftshader' : 'none'), precision: flag('--precision', 'auto'), size: flag('--size', '1024x1024'), jobs: +flag('--jobs', 5) };

// ---- Node: a tiny random lfm3vl projector GGUF ---------------------------------------------------------------------------
const f16bits = (x) => {
  const f = new Float32Array(1), u = new Uint32Array(f.buffer);
  f[0] = x;
  const b = u[0], sign = (b >>> 16) & 0x8000, e = ((b >>> 23) & 0xff) - 127 + 15;
  let m = b & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; m |= 0x800000; const s = 14 - e, r = (m >>> s) + (((m >>> (s - 1)) & 1) && ((m & ((1 << (s - 1)) - 1)) || ((m >>> s) & 1)) ? 1 : 0); return sign | r; }
  if (e >= 31) return sign | 0x7c00;
  const r = (e << 10) | (m >>> 13), rest = m & 0x1fff;
  return sign | (r + (rest > 0x1000 || (rest === 0x1000 && (r & 1)) ? 1 : 0));
};
const tinyProjector = () => {
  let seed = 11;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const C = { E: 128, H: 2, Hkv: 1, F: 256, mid: 512, out: 64, P: 16, kinds: ['conv', 'attn', 'conv', 'attn'] };
  const T = {};
  const f16 = (dims, s) => { const n = dims.reduce((a, b) => a * b, 1), u = new Uint16Array(n); for (let i = 0; i < n; i++) u[i] = f16bits(s * (2 * rnd() - 1)); return { id: 1, dims, data: new Uint8Array(u.buffer) }; };
  const f32 = (dims, s, base = 0) => ({ id: 0, dims, data: new Uint8Array(Float32Array.from({ length: dims.reduce((a, b) => a * b, 1) }, () => base + s * (2 * rnd() - 1)).buffer) });
  const mat = (cols, rows) => f16([cols, rows], 1.5 / Math.sqrt(cols));
  T['v.patch_embd.weight'] = f16([C.P, C.P, 3, C.E], 0.05); T['v.patch_embd.weight.1'] = f16([C.P, C.P, 3, C.E], 0.05);
  T['v.embedding_norm.weight'] = f32([C.E], 0.2, 1);
  C.kinds.forEach((k, i) => {
    const b = (n) => `v.blk.${i}.${n}.weight`;
    Object.assign(T, { [b('ln1')]: f32([C.E], 0.2, 1), [b('ln2')]: f32([C.E], 0.2, 1), [b('ffn_gate')]: mat(C.E, C.F), [b('ffn_up')]: mat(C.E, C.F), [b('ffn_down')]: mat(C.F, C.E) });
    if (k === 'conv') Object.assign(T, { [b('conv2d_in_proj')]: mat(C.E, 3 * C.E), [b('conv2d_out_proj')]: mat(C.E, C.E), [b('conv2d_spatial')]: f32([3, 3, 1, C.E], 0.5) });
    else Object.assign(T, { [b('attn_q')]: mat(C.E, C.H * 64), [b('attn_k')]: mat(C.E, C.Hkv * 64), [b('attn_v')]: mat(C.E, C.Hkv * 64), [b('attn_out')]: mat(C.H * 64, C.E), [b('attn_q_norm')]: f32([64], 0.5, 1.5), [b('attn_k_norm')]: f32([64], 0.5, 1.5) });
  });
  Object.assign(T, { 'mm.input_norm.weight': f32([C.E], 0.2, 1), 'mm.input_norm.bias': f32([C.E], 0.1), 'mm.0.weight': mat(4 * C.E, C.mid), 'mm.0.bias': f32([C.mid], 0.5), 'mm.2.bias': f32([C.out], 0.1) });
  // one F32 matrix, for the GEMM's F32 path
  T['mm.2.weight'] = f32([C.mid, C.out], 1.5 / Math.sqrt(C.mid));
  const parts = [], u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); parts.push(b); }, u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); parts.push(b); };
  const f32v = (v) => { const b = Buffer.alloc(4); b.writeFloatLE(v); parts.push(b); }, str = (s) => { const b = Buffer.from(s); u64(b.length); parts.push(b); };
  const len = () => parts.reduce((n, p) => n + p.length, 0);
  const kv = [
    ['general.architecture', 8, () => str('clip')], ['clip.vision.projector_type', 8, () => str('lfm3vl')], ['clip.vision.patch_size', 4, () => u32(C.P)],
    ['clip.vision.spatial_merge_size', 4, () => u32(2)], ['clip.vision.embedding_length', 4, () => u32(C.E)], ['clip.vision.feed_forward_length', 4, () => u32(C.F)],
    ['clip.vision.block_count', 4, () => u32(C.kinds.length)], ['clip.vision.attention.head_count', 4, () => u32(C.H)], ['clip.vision.attention.head_count_kv', 4, () => u32(C.Hkv)],
    ['clip.vision.attention.layer_norm_epsilon', 6, () => f32v(1e-5)], ['clip.vision.image_mean', 9, () => { u32(6); u64(3); for (let i = 0; i < 3; i++) f32v(0.5); }],
    ['clip.vision.image_std', 9, () => { u32(6); u64(3); for (let i = 0; i < 3; i++) f32v(0.5); }], ['clip.vision.image_min_pixels', 4, () => u32(4 * 1024)],
    ['clip.vision.image_max_pixels', 4, () => u32(64 * 1024)], ['clip.vision.image_resize_algo', 8, () => str('bicubic')],
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

// A picture for the speed run: smooth gradients, a disc and noise (the photo of local-vision-check.js, any size).
const photo = (w, h) => {
  const d = new Uint8Array(w * h * 4);
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) / 65536; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y / h, sky = t < 0.6, o = 4 * (y * w + x);
    let r = sky ? 90 + 120 * t : 60 + 40 * t, g = sky ? 150 + 80 * t : 120 + 50 * t, b = sky ? 230 - 30 * t : 50 + 20 * t;
    const dx = x - 0.75 * w, dy = y - 0.2 * h, sun = Math.max(0, Math.min(1, 0.08 * w - Math.sqrt(dx * dx + dy * dy)));
    r = r * (1 - sun) + 255 * sun; g = g * (1 - sun) + 230 * sun; b = b * (1 - sun) + 120 * sun;
    const n = (rnd() - 0.5) * 12;
    d[o] = Math.max(0, Math.min(255, Math.round(r + n))); d[o + 1] = Math.max(0, Math.min(255, Math.round(g + n))); d[o + 2] = Math.max(0, Math.min(255, Math.round(b + n))); d[o + 3] = 255;
  }
  return d;
};

// ---- Node: lm, the GPU's embeddings through the reference text model -----------------------------------------------------
const floats = (file, want) => {
  const b = fs.readFileSync(file);
  if (want !== undefined && b.length !== 4 * want) throw new Error(`${file}: ${b.length} bytes, ${want} floats expected`);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};
const argmax = (v) => { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; };
const fileSource = (file) => {
  const fd = fs.openSync(file, 'r');
  return { size: fs.fstatSync(fd).size, read(o, n) { const b = Buffer.allocUnsafe(n); let got = 0; while (got < n) { const r = fs.readSync(fd, b, got, n - got, o + got); if (!r) break; got += r; } return new Uint8Array(b.buffer, b.byteOffset, got); } };
};
if (mode === 'lm-worker') {
  const [model, gpuDir, refDir, outDir] = args;
  const G = require('../../extension/ai/local/gguf.js'), R = require('../../extension/ai/local/reference.js'), VR = require('../../extension/ai/local/vision-reference.js');
  (async () => {
    const text = await R.load(await G.open(fileSource(model)));
    process.send({ ready: true });
    process.on('message', (id) => {
      if (id === null) process.exit(0);
      const want = JSON.parse(fs.readFileSync(path.join(refDir, `${id}.json`), 'utf8')), E = text.config.nEmbd, Vc = text.config.vocab;
      const n = want.chunks.find((c) => c.image).image, embd = floats(path.join(gpuDir, `${id}.embd.f32`), n * E);
      const t0 = performance.now();
      const rows = VR.feed(R.session(text), want.chunks.map((c) => (c.text ? c.text : Float32Array.from(embd))), { logits: 'text' });
      fs.writeFileSync(path.join(outDir, `${id}.prefill.f32`), new Uint8Array(rows.buffer));
      const ref = floats(path.join(refDir, `${id}.prefill.f32`), rows.length);
      let same = 0, dmax = 0;
      const misses = [];
      for (let i = 0; i < rows.length / Vc; i++) {
        const a = rows.subarray(i * Vc, (i + 1) * Vc), b = ref.subarray(i * Vc, (i + 1) * Vc);
        for (let k = 0; k < Vc; k++) dmax = Math.max(dmax, Math.abs(a[k] - b[k]));
        const ta = argmax(a), tb = argmax(b);
        if (ta === tb) same++; else misses.push({ pos: i, gpu: ta, ref: tb, gap: b[tb] - b[ta] });
      }
      process.send({ id, positions: rows.length / Vc, same, prefillMaxAbs: dmax, misses, ms: performance.now() - t0 });
    });
  })().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === 'lm') {
  const [model, gpuDir, refDir] = args;
  if (!refDir) { console.error('usage: lm <model.gguf> <gpu dir> <ref dir> [--out dir] [--jobs n]'); process.exit(2); }
  const out = path.resolve(opt.out || gpuDir);
  fs.mkdirSync(out, { recursive: true });
  const queue = PICTURES.filter((id) => fs.existsSync(path.join(gpuDir, `${id}.embd.f32`))), results = [];
  let live = Math.min(opt.jobs, queue.length);
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };
  for (let j = 0; j < live; j++) {
    const child = fork(__filename, ['lm-worker', model, gpuDir, refDir, out]);
    const next = () => child.send(queue.length ? queue.shift() : null);
    child.on('message', (m) => {
      if (!m.ready) { results.push(m); say(`${m.id}: top-1 ${m.same}/${m.positions} text positions, max |Δlogit| ${m.prefillMaxAbs.toExponential(3)} (${(m.ms / 1000).toFixed(0)} s)${m.misses.length ? ` misses ${JSON.stringify(m.misses)}` : ''}`); }
      next();
    });
    child.on('exit', (code) => {
      if (code !== 0) process.exitCode = 1;
      if (--live) return;
      const same = results.reduce((n, r) => n + r.same, 0), total = results.reduce((n, r) => n + r.positions, 0);
      const pass = !process.exitCode && results.length === PICTURES.length && same === total;
      say(`all: top-1 ${same}/${total}, max |Δlogit| ${Math.max(...results.map((r) => r.prefillMaxAbs)).toExponential(3)}\n${pass ? 'PASS' : 'FAIL'}`);
      fs.writeFileSync(path.join(out, 'lm.json'), JSON.stringify({ model, gpuDir, refDir, same, total, pass, results }, null, 1));
      fs.writeFileSync(path.join(out, 'lm.log'), lines.join('\n') + '\n');
      process.exitCode = pass ? 0 : 1;
    });
  }
}

// ---- the page's side (serialized into the page) --------------------------------------------------------------------------
function pageLib() {
  const G = GZ_AI_GGUF, Q = GZ_AI_QUANT, VR = GZ_AI_VISION_REFERENCE, V = GZ_AI_VISION, R = GZ_AI_REFERENCE;
  const u = 2 ** -24, FTZ = 2 ** -120;
  const log = (...a) => console.log(a.join(' '));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const source = (url, size) => ({ size, read: async (o, n) => { const r = await fetch(url, { headers: { Range: `bytes=${o}-${o + n - 1}` } }); if (r.status !== 206) throw new Error(`${url}: ${r.status}`); return new Uint8Array(await r.arrayBuffer()); } });
  const head = async (key) => { const r = await fetch(`/f/${key}`, { method: 'HEAD' }); if (!r.ok) throw new Error(`/f/${key}: ${r.status}`); return +r.headers.get('content-length'); };
  const open = async (key) => G.open(source(`/f/${key}`, await head(key)), { chunk: 8 << 20 });
  const bytes = async (key) => new Uint8Array(await (await fetch(`/f/${key}`)).arrayBuffer());
  const adapter = async () => {
    for (let i = 0; i < 8; i++) { const a = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }); if (a) return a; await sleep(1000); }
    throw new Error('no WebGPU adapter');
  };
  const describe = (a) => ({ vendor: a.info.vendor, architecture: a.info.architecture, description: a.info.description, isFallbackAdapter: a.info.isFallbackAdapter, features: [...a.features].sort(), limits: Object.fromEntries(['maxBufferSize', 'maxStorageBufferBindingSize', 'maxComputeWorkgroupStorageSize'].map((k) => [k, a.limits[k]])) });
  const loadEncoder = async (g, o) => {
    const a = await adapter(), L = a.limits, f16 = o.precision === 'f16' && a.features.has('shader-f16');
    const device = await a.requestDevice({ requiredFeatures: f16 ? ['shader-f16'] : [], requiredLimits: { maxBufferSize: L.maxBufferSize, maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize } });
    const errors = [];
    device.onuncapturederror = (e) => errors.push(e.error.message);
    const t0 = performance.now();
    const enc = await V.load(g, { device, precision: o.precision, kernels: new URL('/ai/local/kernels/', location.href).href });
    log(`encoder: ${a.info.vendor} ${a.info.architecture}${a.info.isFallbackAdapter ? ' (fallback)' : ''}, ${enc.f16 ? 'f16' : 'f32'}, loaded in ${Math.round(performance.now() - t0)} ms`);
    return { enc, device, errors, adapter: describe(a) };
  };
  const read = async (device, b, size = b.size) => {
    const r = device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }), enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(b, 0, r, 0, size); device.queue.submit([enc.finish()]);
    await r.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(r.getMappedRange().slice(0));
    r.unmap(); r.destroy();
    return out;
  };
  const b64 = (f) => { const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768)); return btoa(s); };

  // ---- small: each kernel, then the whole encoder ----
  const small = async (o) => {
    const g = await open('tiny'), { enc, device, errors, adapter: ad } = await loadEncoder(g, o), k = enc._k, c = enc.config, f16 = enc.f16;
    const model = await VR.load(g);
    const S = GPUBufferUsage, table = [];
    const up = (a) => { const b = k.buffer(a.byteLength); device.queue.writeBuffer(b, 0, a); return b; };
    const rd = (b, n) => read(device, b, n * 4);
    let seed = 5;
    const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rand = (n, s = 1, base = 0) => Float32Array.from({ length: n }, () => base + s * (2 * rnd() - 1));
    const record = (op, what, got, ref, bound) => {
      let maxAbs = 0, maxRef = 0, worst = 0, over = 0, bad = 0, at = -1;
      for (let i = 0; i < ref.length; i++) {
        if (!Number.isFinite(got[i])) { bad++; continue; }
        const d = Math.abs(got[i] - ref[i]);
        maxAbs = Math.max(maxAbs, d); maxRef = Math.max(maxRef, Math.abs(ref[i]));
        const r = bound ? d / (bound[i] + FTZ) : d === 0 ? 0 : Infinity;
        if (r > worst) { worst = r; at = i; }
        if (r > 1) over++;
      }
      const row = { op, what, n: ref.length, maxAbs, rel: maxRef ? maxAbs / maxRef : 0, worst, over, nonFinite: bad, pass: !over && !bad && ref.length > 0 };
      if (over) row.worstAt = { i: at, got: got[at], ref: ref[at], bound: bound?.[at] };
      table.push(row);
      log(`${row.pass ? 'ok  ' : 'FAIL'} ${op.padEnd(10)} ${what.padEnd(44)} max|Δ| ${maxAbs.toExponential(2)}  rel ${row.rel.toExponential(2)}  ${bound ? `worst ${worst.toFixed(3)} of bound` : 'bit for bit'}${over ? `  ${over} over (at ${at}: ${got[at]} for ${ref[at]})` : ''}${bad ? `  ${bad} non-finite` : ''}`);
    };
    const mat = (name) => model.weights.mm0.name === name ? model.weights.mm0 : model.weights.mm2.name === name ? model.weights.mm2 : name === 'v.patch_embd.weight' ? model.weights.patch0 : model.weights.layers[+name.split('.')[2]][{ ffn_gate: 'gate', ffn_up: 'up', ffn_down: 'down', conv2d_in_proj: 'inProj', conv2d_out_proj: 'outProj', attn_q: 'wq', attn_k: 'wk', attn_v: 'wv', attn_out: 'wo' }[name.split('.')[3]]];
    const rowsOf = (W) => { const out = new Float32Array(W.rows * W.cols), r = new Float32Array(W.cols); for (let i = 0; i < W.rows; i++) out.set(R._ops.row(W, i, r), i * W.cols); return out; };

    // matmul: plain, ACC, BIAS, BIAS + GELU; F16 and F32 weights; T not a multiple of 64, a partial row tile
    const gemm = async (name, T, { acc, bias, gelu } = {}) => {
      const W = mat(name), wt = k.weight(name), K = W.cols, rows = W.rows, Wf = rowsOf(W);
      const X = rand(T * K, 1), Y0 = acc ? rand(T * rows, 2) : null, b = bias ? (name === 'mm.0.weight' ? model.weights.mm0b : model.weights.mm2b) : null;
      const xb = up(X), yb = acc ? up(Y0) : k.buffer(T * rows * 4);
      await k.dispatch('matmul', { WF32: wt.type === 'F32', ACC: !!acc, BIAS: !!bias, GELU: !!gelu }, { 0: wt.buf, 1: xb, 2: yb, ...(bias && { 3: k.weight(name === 'mm.0.weight' ? 'mm.0.bias' : 'mm.2.bias').buf }) }, k.PARAMS.matmul({ rows, K, T }), [Math.ceil(rows / 128), Math.ceil(T / 64)]);
      const got = await rd(yb, T * rows);
      xb.destroy(); yb.destroy();
      const ref = new Float32Array(T * rows), bound = new Float64Array(T * rows);
      for (let t = 0; t < T; t++) for (let r = 0; r < rows; r++) {
        let s = 0, m = 0, sw = 0;
        for (let i = 0; i < K; i++) { const p = Wf[r * K + i] * X[t * K + i]; s += p; m += Math.abs(p); sw += Math.abs(Wf[r * K + i]); }
        let y = Math.fround(s), e = (K + 16) * u * m + u * Math.abs(y) + (f16 ? 2 ** -11 * m + 2 ** -25 * sw : 0);
        if (bias) { y = Math.fround(y + b[r]); e += u * Math.abs(y); }
        if (gelu) { const gy = VR._ops.geluErf(y); e = 1.13 * e + 4e-7 * Math.abs(gy); y = gy; }
        if (acc) { y = Y0[t * rows + r] + y; e += u * Math.abs(y); }
        ref[t * rows + r] = y; bound[t * rows + r] = e;
      }
      record('matmul', `${name} ${wt.type} ${rows}×${K} T=${T}${acc ? ' acc' : ''}${bias ? ' bias' : ''}${gelu ? ' gelu' : ''}`, got, ref, bound);
    };
    await gemm('v.patch_embd.weight', 70);
    await gemm('v.blk.0.ffn_down.weight', 129, { acc: true });
    await gemm('v.blk.1.attn_k.weight', 5);
    await gemm('mm.0.weight', 33, { bias: true, gelu: true });
    await gemm('mm.2.weight', 66, { bias: true });
    await gemm('mm.2.weight', 7);

    // norms
    const E = c.nEmbd;
    {
      const T = 37, X = rand(T * E, 3), w = model.weights.layers[0].ln1, xb = up(X), nb = k.buffer(T * E * 4);
      await k.dispatch('norm', {}, { 0: xb, 1: nb, 2: k.weight('v.blk.0.ln1.weight').buf }, k.PARAMS.norm({ n: E, eps: c.eps }), [T]);
      const ref = R._ops.rmsnorm(X, T, E, w, c.eps);
      record('rmsnorm', `${T} rows of ${E}`, await rd(nb, T * E), ref, Float64Array.from(ref, (y) => (E / 2 + 16) * u * Math.abs(y)));
      xb.destroy(); nb.destroy();
    }
    {
      const px = 6, py = 4, T = px * py, X = rand(T * E, 3, 0.7), xb = up(X), nb = k.buffer(T * E * 4), w = model.weights;
      await k.dispatch('norm', { LAYER: true }, { 0: xb, 1: nb, 2: k.weight('mm.input_norm.weight').buf, 3: k.weight('mm.input_norm.bias').buf }, k.PARAMS.norm({ n: E, eps: c.projEps, px }), [T]);
      const ln = VR._ops.layernorm(X, T, E, w.inNormW, w.inNormB, c.projEps), ref = new Float32Array(T * E), bound = new Float64Array(T * E);
      for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) {
        const to = ((y >> 1) * (px / 2) + (x >> 1)) * 4 + 2 * (y % 2) + (x % 2);
        for (let i = 0; i < E; i++) { const v = ln[(y * px + x) * E + i]; ref[to * E + i] = v; bound[to * E + i] = (E + 32) * u * (Math.abs(v - w.inNormB[i]) + Math.abs(w.inNormB[i])); }
      }
      record('layernorm', `${px}×${py} patches merged 2×2`, await rd(nb, T * E), ref, bound);
      xb.destroy(); nb.destroy();
    }

    // rope: q and k RMS-normed per head, then 2-D RoPE
    const H = c.nHead, Hkv = c.nHeadKv, hd = 64, L1 = model.weights.layers[1];
    {
      const px = 10, py = 7, T = px * py, q = rand(T * H * hd, 2), kk = rand(T * Hkv * hd, 2), table2 = V.ropeTable(px, py, hd, c.ropeTheta);
      const qb = up(q), kb = up(kk), rb = up(table2);
      await k.dispatch('rope', {}, { 0: qb, 1: kb, 2: k.weight('v.blk.1.attn_q_norm.weight').buf, 3: k.weight('v.blk.1.attn_k_norm.weight').buf, 4: rb }, k.PARAMS.rope({ H, Hkv, eps: c.eps }), [H + Hkv, T]);
      for (const [name, X, heads, wt, b] of [['q', q, H, L1.qNorm, qb], ['k', kk, Hkv, L1.kNorm, kb]]) {
        const n = R._ops.rmsnorm(X, T * heads, hd, wt, c.eps), ref = new Float32Array(n.length), bound = new Float64Array(n.length);
        for (let t = 0; t < T; t++) for (let h = 0; h < heads; h++) for (let j = 0; j < 32; j++) {
          const o = (t * heads + h) * hd, cs = table2[(t * 32 + j) * 2], sn = table2[(t * 32 + j) * 2 + 1], x0 = n[o + j], x1 = n[o + j + 32];
          ref[o + j] = x0 * cs - x1 * sn; ref[o + j + 32] = x0 * sn + x1 * cs;
          const e = (hd / 2 + 24) * u * (Math.abs(x0 * cs) + Math.abs(x1 * sn) + Math.abs(x0 * sn) + Math.abs(x1 * cs));
          bound[o + j] = e + u * Math.abs(ref[o + j]); bound[o + j + 32] = e + u * Math.abs(ref[o + j + 32]);
        }
        record('rope', `${name}: ${T} patches × ${heads} heads (${px}×${py})`, await rd(b, n.length), ref, bound);
      }
      qb.destroy(); kb.destroy(); rb.destroy();
    }

    // attention: bidirectional GQA over T keys (several tiles, the last partial)
    for (const T of [5, 77]) {
      const q = rand(T * H * hd, 3), kk = rand(T * Hkv * hd, 3), v = rand(T * Hkv * hd, 2), scale = 1 / Math.sqrt(hd);
      const qb = up(q), kb = up(kk), vb = up(v), ob = k.buffer(T * H * hd * 4);
      await k.dispatch('attention', {}, { 0: qb, 1: kb, 2: vb, 3: ob }, k.PARAMS.attention({ T, H, Hkv, scale }), [Math.ceil(T / 64), H]);
      const ref = new Float32Array(T * H * hd), bound = new Float64Array(T * H * hd), s = new Float64Array(T);
      for (let t = 0; t < T; t++) for (let h = 0; h < H; h++) {
        const qo = (t * H + h) * hd, kh = Math.floor(h / (H / Hkv)) * hd;
        let mx = -Infinity, eps = 0;
        for (let j = 0; j < T; j++) {
          let d = 0, m = 0;
          for (let i = 0; i < hd; i++) { const p = q[qo + i] * kk[j * Hkv * hd + kh + i]; d += p; m += Math.abs(p); }
          s[j] = d * scale; mx = Math.max(mx, s[j]); eps = Math.max(eps, ((hd + 8) * u + (f16 ? 2 ** -10 : 0)) * scale * m);
        }
        let z = 0, R2 = 0;
        for (let j = 0; j < T; j++) { R2 = Math.max(R2, mx - s[j]); s[j] = Math.exp(s[j] - mx); z += s[j]; }
        for (let i = 0; i < hd; i++) {
          let a = 0, pv = 0;
          for (let j = 0; j < T; j++) { const p = s[j] / z, x = v[j * Hkv * hd + kh + i]; a += p * x; pv += p * Math.abs(x); }
          ref[qo + i] = a;
          bound[qo + i] = pv * (2 * eps + (3 + 2 * R2) * u + 2 * (T + 8) * u + (f16 ? 2 ** -10 : 0)) + u * Math.abs(a);
        }
      }
      record('attention', `${T} patches, ${H} heads over ${Hkv}`, await rd(ob, T * H * hd), ref, bound);
      for (const b of [qb, kb, vb, ob]) b.destroy();
    }

    // conv: the gated 3 × 3 depthwise conv
    {
      const px = 7, py = 5, T = px * py, Bv = rand(T * E, 1), Cv = rand(T * E, 1), Xv = rand(T * E, 1), sp = model.weights.layers[0].spatial;
      const bb = up(Bv), cb = up(Cv), xb = up(Xv), yb = k.buffer(T * E * 4);
      await k.dispatch('conv', {}, { 0: bb, 1: cb, 2: xb, 3: k.weight('v.blk.0.conv2d_spatial.weight').buf, 4: yb }, k.PARAMS.conv({ px, py, E }), [Math.ceil((T * E) / 4 / 256), 1]);
      const ref = new Float32Array(T * E), bound = new Float64Array(T * E);
      for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) for (let e = 0; e < E; e++) {
        let s = 0, m = 0;
        for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
          const sy = y + ky - 1, sx = x + kx - 1;
          if (sy < 0 || sy >= py || sx < 0 || sx >= px) continue;
          const o = (sy * px + sx) * E + e, p = sp[e * 9 + ky * 3 + kx] * Math.fround(Bv[o] * Xv[o]);
          s += p; m += Math.abs(p);
        }
        const t = y * px + x, r = Cv[t * E + e] * Math.fround(s);
        ref[t * E + e] = r; bound[t * E + e] = 14 * u * Math.abs(Cv[t * E + e]) * m + u * Math.abs(r);
      }
      record('conv', `${px}×${py} patches of ${E}`, await rd(yb, T * E), ref, bound);
      for (const b of [bb, cb, xb, yb]) b.destroy();
    }

    // glu, im2col
    {
      const n = 4 * 999, gv = rand(n, 6), uv = rand(n, 2), gb = up(gv), ub = up(uv);
      await k.dispatch('glu', {}, { 0: gb, 1: ub }, k.PARAMS.glu({ n: n / 4 }), [Math.ceil(n / 4 / 256), 1]);
      const ref = Float32Array.from(gv, (x, i) => Math.fround(R._ops.silu(x)) * uv[i]);
      record('glu', `${n} values`, await rd(gb, n), ref, Float64Array.from(ref, (y, i) => (2 * Math.abs(gv[i]) + 16) * u * Math.abs(y)));
      gb.destroy(); ub.destroy();
    }
    {
      const P = c.patch, px = 3, py = 2, W = px * P, Hh = py * P, pix = rand(W * Hh * 3, 1), T = px * py, n = T * 3 * P * P;
      const pb = up(pix), cb = k.buffer(n * 4);
      await k.dispatch('patch', {}, { 0: pb, 1: cb }, k.PARAMS.patch({ n: n / 4, px, P }), [Math.ceil(n / 4 / 256), 1]);
      const ref = new Float32Array(n);
      for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) for (let ch = 0; ch < 3; ch++) for (let ky = 0; ky < P; ky++) for (let kx = 0; kx < P; kx++) ref[(y * px + x) * 3 * P * P + ch * P * P + ky * P + kx] = pix[((y * P + ky) * W + x * P + kx) * 3 + ch];
      record('im2col', `${px}×${py} patches of ${P}`, await rd(cb, n), ref, null);
      pb.destroy(); cb.destroy();
    }

    // the whole encoder against the reference
    const whole = [];
    for (const [w, h] of [[100, 70], [300, 200]]) {
      const data = new Uint8Array(w * h * 4);
      for (let i = 0; i < data.length; i++) data[i] = (i % 4 === 3) ? 255 : Math.floor(rnd() * 256);
      const pre = VR.preprocess(c, data, w, h), want = VR.encode(model, pre);
      const r = await enc.encode({ width: w, height: h, data }), got = await rd(r.buffer, r.tokens * c.outEmbd);
      r.drop();
      let maxAbs = 0, maxRef = 0;
      for (let i = 0; i < want.embeddings.length; i++) { maxAbs = Math.max(maxAbs, Math.abs(got[i] - want.embeddings[i])); maxRef = Math.max(maxRef, Math.abs(want.embeddings[i])); }
      const tol = (f16 ? 1e-2 : 1e-4) * maxRef, pass = r.tokens === want.n && got.every(Number.isFinite) && maxAbs <= tol;
      whole.push({ size: [w, h], tokens: r.tokens, maxAbs, maxRef, pass });
      table.push({ op: 'encoder', what: `${w}×${h}`, pass, maxAbs, rel: maxAbs / maxRef });
      log(`${pass ? 'ok  ' : 'FAIL'} encoder    ${w}×${h} → ${pre.width}×${pre.height}, ${r.tokens} tokens: max|Δ| ${maxAbs.toExponential(2)} of embeddings up to ${maxRef.toFixed(3)} (rel ${(maxAbs / maxRef).toExponential(2)}, limit ${(f16 ? 1e-2 : 1e-4).toExponential(0)})`);
    }
    enc.release();
    if (errors.length) log(`FAIL WebGPU errors: ${errors.slice(0, 5).join(' | ')}`);
    const pass = table.every((r) => r.pass) && !errors.length;
    return { adapter: ad, f16, table, whole, errors, pass };
  };

  // ---- model: the five pictures against the reference's embeddings ----
  const modelMode = async (o) => {
    const g = await open('mmproj'), { enc, device, errors, adapter: ad } = await loadEncoder(g, o), c = enc.config, rows = [];
    for (const { id, w, h } of o.pictures) {
      const data = await bytes(`img/${id}`), want = new Float32Array((await bytes(`ref/${id}.embd.f32`)).buffer);
      const t0 = performance.now(), r = await enc.encode({ width: w, height: h, data });
      const got = await read(device, r.buffer, r.tokens * c.outEmbd * 4), ms = performance.now() - t0;
      r.drop();
      let maxAbs = 0, sum = 0, maxRef = 0;
      if (got.length !== want.length) throw new Error(`${id}: ${got.length} values, ${want.length} in the reference`);
      for (let i = 0; i < got.length; i++) { const d = Math.abs(got[i] - want[i]); sum += d; if (!(d <= maxAbs)) maxAbs = d; maxRef = Math.max(maxRef, Math.abs(want[i])); }
      const row = { id, size: [w, h], resized: [r.width, r.height], tokens: r.tokens, maxAbs, meanAbs: sum / got.length, maxRef, ms, pass: enc.f16 ? Number.isFinite(maxAbs) : maxAbs <= o.tol, embd: o.keep ? b64(got) : undefined };
      rows.push(row);
      log(`${row.pass ? 'ok  ' : 'FAIL'} ${id}: ${w}×${h} → ${r.width}×${r.height}, ${r.tokens} tokens, max|Δ| ${maxAbs.toExponential(3)} (mean ${row.meanAbs.toExponential(2)}, values up to ${maxRef.toFixed(2)}), ${Math.round(ms)} ms`);
    }
    enc.release();
    if (errors.length) log(`FAIL WebGPU errors: ${errors.slice(0, 5).join(' | ')}`);
    return { adapter: ad, f16: enc.f16, rows, errors, maxAbs: Math.max(...rows.map((r) => r.maxAbs)), pass: rows.every((r) => r.pass) && !errors.length };
  };

  // ---- speed ----
  const speed = async (o) => {
    const g = await open('mmproj'), { enc, device, errors, adapter: ad } = await loadEncoder(g, o), [w, h] = o.size;
    const data = await bytes('picture'), size = enc.prepare({ width: w, height: h, data });
    const once = async () => { const t0 = performance.now(), r = await enc.encode({ width: w, height: h, data }); const ms = performance.now() - t0; r.drop(); return ms; };
    await once();
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await once());
    const p0 = performance.now();
    VR.preprocess(enc.config, data, w, h);
    const cpuMs = performance.now() - p0, ms = [...runs].sort((a, b) => a - b)[1];
    log(`speed: ${w}×${h} → ${size.width}×${size.height}, ${size.tokens} tokens: ${ms.toFixed(0)} ms an encode (median of ${runs.map((r) => r.toFixed(0)).join(', ')}), of which ${cpuMs.toFixed(0)} ms the CPU's resize, ${enc.f16 ? 'f16' : 'f32'}`);
    enc.release();
    return { adapter: ad, f16: enc.f16, size: [w, h], resized: [size.width, size.height], tokens: size.tokens, runs, ms, cpuMs, errors, pass: !errors.length };
  };

  // ---- prefill: the engine's text model fed the encoder's embeddings, end to end on the GPU ----
  const prefill = async (o) => {
    const a = await adapter(), kernels = new URL('/ai/local/kernels/', location.href).href;
    const t0 = performance.now();
    const model = await GZ_AI_ENGINE.load(await open('model'), { adapter: a, context: 4096, chunk: 512, kernels });
    const enc = await V.load(await open('mmproj'), { device: model.device, precision: o.precision, kernels });
    const errors = [];
    model.device.addEventListener?.('uncapturederror', (e) => errors.push(e.error.message));
    const E = model.engine.config.nEmbd, Vc = model.engine.config.vocab;
    log(`engine: ${a.info.vendor} ${a.info.architecture}, ${model.engine.f16 ? 'f16' : 'f32'}, subgroups ${model.engine.subgroups ? 'on' : 'off'}; encoder ${enc.f16 ? 'f16' : 'f32'}; loaded in ${Math.round(performance.now() - t0)} ms`);
    if (enc.config.outEmbd !== E) throw new Error(`the projector writes ${enc.config.outEmbd} wide, the text model is ${E}`);
    const start = await model.snapshot(), rows = [];
    for (const { id, w, h } of o.pictures) {
      const want = JSON.parse(new TextDecoder().decode(await bytes(`ref/${id}.json`)));
      const ref = new Float32Array((await bytes(`ref/${id}.prefill.f32`)).buffer);
      const ids = [], text = [], embeds = [], p0 = performance.now();
      for (const ch of want.chunks) {
        if (ch.text) { for (const t of ch.text) { text.push(ids.length); ids.push(t); } continue; }
        const r = await enc.encode({ width: w, height: h, data: await bytes(`img/${id}`) });
        if (r.tokens !== ch.image) throw new Error(`${id}: ${r.tokens} picture tokens, the reference has ${ch.image}`);
        embeds.push({ at: ids.length, tokens: r.tokens, buffer: r.buffer, drop: r.drop });
        for (let i = 0; i < r.tokens; i++) ids.push(0);
      }
      const isText = new Set(text), got = [];
      let n = 0, same = 0, dmax = 0;
      const misses = [];
      await model.prefill(ids, {
        embeds: embeds.map(({ at, tokens, buffer }) => ({ at, tokens, buffer })),
        onRows: (first, block, count) => {
          for (let r = 0; r < count; r++) {
            if (!isText.has(first + r)) continue;
            const x = block.subarray(r * Vc, (r + 1) * Vc), y = ref.subarray(n * Vc, (n + 1) * Vc);
            let ta = 0, tb = 0;
            for (let k = 0; k < Vc; k++) { if (x[k] > x[ta]) ta = k; if (y[k] > y[tb]) tb = k; dmax = Math.max(dmax, Math.abs(x[k] - y[k])); }
            if (ta === tb) same++; else misses.push({ pos: n, gpu: ta, ref: tb, gap: y[tb] - y[ta] });
            got.push(ta); n++;
          }
        },
      });
      const ms = performance.now() - p0;
      for (const e of embeds) e.drop();
      await model.restore(start);
      const row = { id, positions: n, of: text.length, same, prefillMaxAbs: dmax, misses, imageTokens: embeds.reduce((k, e) => k + e.tokens, 0), prompt: ids.length, ms, pass: n === text.length && same === n };
      rows.push(row);
      log(`${row.pass ? 'ok  ' : 'FAIL'} ${id}: ${row.imageTokens} picture tokens in a prompt of ${row.prompt}, top-1 ${same}/${n} text positions, max |Δlogit| ${dmax.toExponential(3)} (encode + prefill ${Math.round(ms)} ms)${misses.length ? ` misses ${JSON.stringify(misses)}` : ''}`);
    }
    start.drop(); enc.release(); model.release();
    const same = rows.reduce((k, r) => k + r.same, 0), total = rows.reduce((k, r) => k + r.of, 0);
    log(`all: top-1 ${same}/${total}`);
    if (errors.length) log(`FAIL WebGPU errors: ${errors.slice(0, 5).join(' | ')}`);
    return { rows, same, total, errors, pass: rows.every((r) => r.pass) && !errors.length };
  };

  window.CK = { small, model: modelMode, speed, prefill };
}

// ---- Node: serve, launch, run ---------------------------------------------------------------------------------------------
if (require.main === module && ['small', 'model', 'speed', 'prefill'].includes(mode)) (async () => {
  const { serve } = require('./local-engine-check.js');
  const files = {};
  const o = { precision: opt.precision };
  if (mode === 'small') files.tiny = tinyProjector();
  else if (mode === 'prefill') {
    files.model = path.resolve(args.shift() || '');
    if (!fs.existsSync(files.model)) throw new Error('no text model');
    files.mmproj = path.resolve(args[0] || '');
  } else {
    files.mmproj = path.resolve(args[0] || '');
    if (!fs.existsSync(files.mmproj)) throw new Error(`no projector ${args[0]}`);
  }
  if (mode === 'model' || mode === 'prefill') {
    const [, images, ref] = args;
    files.ref = path.resolve(ref);
    o.tol = EMBD_TOL; o.keep = !!opt.out;
    o.pictures = PICTURES.map((id) => {
      const f = fs.readdirSync(images).find((n) => n.startsWith(`${id}-`) && n.endsWith('.rgba'));
      const [, w, h] = f.match(/-(\d+)x(\d+)\.rgba$/);
      files[`img/${id}`] = path.join(path.resolve(images), f);
      return { id, w: +w, h: +h };
    });
  }
  if (mode === 'speed') { o.size = opt.size.split('x').map(Number); files.picture = Buffer.from(photo(...o.size)); }
  const out = opt.out ? path.resolve(opt.out) : null;
  if (out) fs.mkdirSync(out, { recursive: true });
  const logLines = [];
  const say = (line) => { console.log(line); logLines.push(line); };
  const { chromium } = require('playwright');
  const lock = require('../../tools/dev/check-env.js').lockPath();
  let held = false, browser = null, result = null;
  const server = serve(files).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; break; } catch (e) { if (e.code !== 'EEXIST' || i > 600) throw e; await new Promise((r) => setTimeout(r, 1000)); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nlocal-vision-gpu-check\n`);
    for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { fs.rmSync(lock, { recursive: true, force: true }); process.exit(sig === 'SIGINT' ? 130 : 143); });
    await require('../../tools/dev/wait-for-browser.js')();
    browser = await chromium.launch({ ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, args: FLAGS[opt.flags] || opt.flags.split(' ') });
    const page = await browser.newPage();
    const origin = `http://127.0.0.1:${server.address().port}`;
    // Nothing but the check's own server; the page itself is this script's.
    await page.route('**/*', (r) => {
      const url = r.request().url();
      if (url === `${origin}/vision`) return r.fulfill({ contentType: 'text/html', body: `<!doctype html><title>vision</title>${['gguf', 'quant', 'reference', 'vision-reference', 'engine', 'vision'].map((n) => `<script src="/ai/local/${n}.js"></script>`).join('')}<script>(${pageLib})()</script>` });
      return url.startsWith(`${origin}/`) ? r.continue() : r.abort();
    });
    page.on('console', (m) => say(m.text()));
    page.on('pageerror', (e) => say(`page error: ${e.message}`));
    await page.goto(`${origin}/vision`);
    result = await page.evaluate(([m, a]) => window.CK[m](a), [mode, o]);
    if (mode === 'model' && out) for (const r of result.rows) { fs.writeFileSync(path.join(out, `${r.id}.embd.f32`), Buffer.from(r.embd, 'base64')); delete r.embd; }
  } finally {
    await browser?.close().catch(() => {});
    server.close();
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) {
      if (result) fs.writeFileSync(path.join(out, `${mode}${opt.precision === 'auto' ? '' : `-${opt.precision}`}.json`), JSON.stringify({ mode, flags: opt.flags, args, opt, result }, null, 1));
      fs.writeFileSync(path.join(out, `${mode}${opt.precision === 'auto' ? '' : `-${opt.precision}`}.log`), logLines.join('\n') + '\n');
    }
  }
  const pass = !!result && result.pass !== false;
  say(pass ? 'PASS' : 'FAIL');
  process.exitCode = pass ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
else if (require.main === module && !['lm', 'lm-worker'].includes(mode)) {
  console.error('usage: node checks/ai/local-vision-gpu-check.js small | model <mmproj> <images> <ref dir> | speed <mmproj> | prefill <model> <mmproj> <images> <ref dir> | lm <model> <gpu dir> <ref dir>  (see the top of this file)');
  process.exit(2);
}

module.exports = { tinyProjector, f16bits, photo };
