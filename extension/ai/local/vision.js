// Glaze's own engine for pictures: LFM3-VL's vision encoder and projector (the graph and numerics of
// ai/local/vision-reference.js) in WebGPU, with Glaze's kernels/vision-*.wgsl. A picture becomes its embeddings, tokens ×
// the text model's width in f32, in a GPUBuffer on the given device (the text engine's), for the language model's
// prefill between <|vision_start|> and <|vision_end|>. checks/ai/local-vision-gpu-check.js holds it to the reference.
// Preprocessing (the bicubic resize and normalization) runs on the CPU as the reference's own code, so it matches bit
// for bit. Weights: each F16 (or F32) matrix and F32 vector in a buffer of its own, matrices read two values a word in
// the GEMM. Paths: f16 (`shader-f16`): the GEMM's and attention's workgroup tiles in f16, sums in f32; f32 otherwise.
// No subgroups. Every binding stays within the device's maxStorageBufferBindingSize: the FFN runs in chunks of tokens
// when its tokens × feed_forward_length buffers would pass it.
// Classic script; node exports.
var GZ_AI_VISION = globalThis.GZ_AI_VISION || (() => {
  let vref = null, eng = null;
  const VR = () => vref || (vref = typeof GZ_AI_VISION_REFERENCE !== 'undefined' ? GZ_AI_VISION_REFERENCE : require('./vision-reference.js'));
  const EN = () => eng || (eng = typeof GZ_AI_ENGINE !== 'undefined' ? GZ_AI_ENGINE : require('./engine.js'));
  // reason: 'webgpu' (no adapter or device, or a kernel it refuses), 'memory', 'lost' (the device), 'model'.
  const fail = (what, reason) => { throw Object.assign(new Error(`vision: ${what}`), reason ? { reason } : {}); };
  const KERNELS = ['matmul', 'attention', 'rope', 'conv', 'norm', 'patch', 'glu'];
  const MATRIX = { F16: 2, F32: 4 }; // bytes per value of the matrix types the GEMM reads
  const HEAD = 64; // the attention and RoPE kernels' head size
  const SLOT = 256; // bytes per dispatch's uniforms (minUniformBufferOffsetAlignment)
  const STEP = 32 << 20; // bytes per weight upload
  const up = (n, a) => Math.ceil(n / a) * a;

  // ---- pure parts --------------------------------------------------------------------------------------------------------
  const u32 = (...v) => Uint32Array.from(v.map((x) => x >>> 0));
  const f32bits = (x) => new Uint32Array(Float32Array.of(x).buffer)[0];
  // Each kernel's uniforms: four words in its struct's field order.
  const PARAMS = {
    matmul: ({ rows, K, T }) => u32(rows, K, T, 0),
    attention: ({ T, H, Hkv, scale }) => u32(T, H, Hkv, f32bits(scale)),
    rope: ({ H, Hkv, eps }) => u32(H, Hkv, f32bits(eps), 0),
    conv: ({ px, py, E }) => u32(px, py, E, 0),
    norm: ({ n, eps, px = 0 }) => u32(n, f32bits(eps), px, 0),
    patch: ({ n, px, P }) => u32(n, px, P, 0),
    glu: ({ n }) => u32(n, 0, 0, 0),
  };
  const BINDING = { matmul: 4, attention: 4, rope: 5, conv: 5, norm: 4, patch: 2, glu: 2 };

  // The 2-D RoPE table of a px × py patch grid, as the reference computes it (θ in double, then f32): per patch, hd / 2
  // (cos, sin) pairs; pairs j < hd / 4 turn by the patch's row, the rest by its column.
  const ropeTable = (px, py, hd, base) => {
    const half = hd / 2, quarter = hd / 4, out = new Float32Array(px * py * half * 2);
    for (let t = 0; t < px * py; t++) {
      const yy = Math.floor(t / px), xx = t % px;
      for (let j = 0; j < half; j++) {
        const theta = (j < quarter ? yy : xx) * base ** ((-2 * (j % quarter)) / half);
        out[(t * half + j) * 2] = Math.cos(theta);
        out[(t * half + j) * 2 + 1] = Math.sin(theta);
      }
    }
    return out;
  };

  // Tokens per FFN pass: T, or fewer (a multiple of 64, so each pass's offsets stay 256-byte aligned) when a tokens × F
  // f32 buffer would pass the binding limit.
  const ffnChunk = (T, F, limit) => {
    if (T * F * 4 <= limit) return T;
    const n = Math.floor(limit / (F * 4) / 64) * 64;
    if (n < 64) fail(`64 tokens of the FFN (${F} wide) are over the binding limit`, 'memory');
    return n;
  };

  // ---- the encoder -------------------------------------------------------------------------------------------------------
  const defaultSource = (base) => async (name) => {
    const url = base ? new URL(`vision-${name}.wgsl`, base).href
      : typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(`ai/local/kernels/vision-${name}.wgsl`) : fail('no kernel source', 'webgpu');
    const r = await fetch(url);
    if (!r.ok) fail(`kernel ${name}: ${r.status}`, 'webgpu');
    return r.text();
  };
  const aborted = (signal) => signal.reason ?? new DOMException('Aborted', 'AbortError');

  // gguf: the projector's open GGUF (ai/local/gguf.js). opts: { device (the text engine's; else one from adapter or
  // navigator.gpu, the encoder's own), adapter, signal, precision 'auto' | 'f32' | 'f16', kernels (name → source, or a
  // base URL; the package's by default) }.
  const load = async (gguf, opts = {}) => {
    const signal = opts.signal;
    const halt = () => { if (signal?.aborted) throw aborted(signal); };
    let c;
    try { c = VR().config(gguf); } catch (e) { fail(e.message.replace(/^vision: /, ''), 'model'); }
    if (c.headDim !== HEAD) fail(`head size ${c.headDim}: the kernels are for ${HEAD}`, 'model');
    if (c.patch % 4) fail(`patch size ${c.patch}`, 'model');
    halt();

    let device = opts.device, own = false;
    if (!device) {
      let adapter = opts.adapter;
      if (!adapter) {
        if (typeof navigator === 'undefined' || !navigator.gpu) fail('no WebGPU', 'webgpu');
        try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { adapter = null; }
      }
      if (!adapter) fail('no WebGPU adapter', 'webgpu');
      const L = adapter.limits, half = opts.precision !== 'f32' && adapter.features.has('shader-f16');
      try {
        device = await adapter.requestDevice({ requiredFeatures: half ? ['shader-f16'] : [], requiredLimits: { maxBufferSize: L.maxBufferSize, maxStorageBufferBindingSize: L.maxStorageBufferBindingSize } });
      } catch (e) { fail(`no device: ${e.message}`, 'webgpu'); }
      own = true;
    }
    const precision = opts.precision || 'auto';
    const f16 = precision === 'f16' || (precision === 'auto' && device.features.has('shader-f16'));
    const owned = new Set();
    const free = () => { for (const b of owned) b.destroy(); owned.clear(); if (own) device.destroy?.(); };
    let lost = null;
    device.lost.then((info) => { lost = info; });
    const check = () => { halt(); if (lost) fail(`device lost: ${lost.message}`, 'lost'); };
    try {
      if (f16 && !device.features.has('shader-f16')) fail('the device has no shader-f16', 'webgpu');
      const lim = device.limits, bind = Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize);

      // ---- tensors ----
      const E = c.nEmbd, F = c.nFf, P = c.patch, H = c.nHead, Hkv = c.nHeadKv;
      const infos = [];
      const need = (name) => gguf.tensor(name) || fail(`no ${name}`, 'model');
      // rows of cols (ggml's last dim; the product of the others, the patch kernels' 16 × 16 × 3)
      const matrix = (name, cols, rows) => {
        const t = need(name);
        if (t.dims[t.dims.length - 1] !== rows || t.count !== rows * cols) fail(`${name}: shape [${t.dims}], ${cols} × ${rows} expected`, 'model');
        if (!MATRIX[t.type]) fail(`${name}: ${t.type} has no kernel`, 'model');
        if (cols % 16 || rows % 4) fail(`${name}: ${rows} rows of ${cols}`, 'model');
        const info = { name, info: t, kind: 'matrix', type: t.type, rows, cols, bytes: t.bytes };
        infos.push(info);
        return info;
      };
      const vector = (name, n, transpose) => {
        const t = need(name);
        if (t.type !== 'F32' || t.count !== n) fail(`${name}: ${t.type} [${t.dims}], F32 × ${n} expected`, 'model');
        const info = { name, info: t, kind: 'vector', bytes: t.bytes, transpose };
        infos.push(info);
        return info;
      };
      if (gguf.tensor('v.patch_embd.bias')) fail('a patch bias: not lfm3vl', 'model');
      const w = {
        patch0: matrix('v.patch_embd.weight', 3 * P * P, E), patch1: gguf.tensor('v.patch_embd.weight.1') ? matrix('v.patch_embd.weight.1', 3 * P * P, E) : null,
        embNorm: vector('v.embedding_norm.weight', E), layers: [],
      };
      for (let i = 0; i < c.nLayer; i++) {
        const b = (n) => `v.blk.${i}.${n}.weight`;
        const L = { ln1: vector(b('ln1'), E), ln2: vector(b('ln2'), E), gate: matrix(b('ffn_gate'), E, F), up: matrix(b('ffn_up'), E, F), down: matrix(b('ffn_down'), F, E) };
        for (const n of ['attn_q', 'attn_k', 'attn_v', 'attn_out', 'ffn_up', 'ffn_down', 'ffn_gate']) if (gguf.tensor(`v.blk.${i}.${n}.bias`)) fail(`layer ${i}: ${n} bias`, 'model');
        if (gguf.tensor(b('conv2d_in_proj'))) {
          L.kind = 'conv';
          L.inProj = matrix(b('conv2d_in_proj'), E, 3 * E); L.outProj = matrix(b('conv2d_out_proj'), E, E);
          const sp = need(b('conv2d_spatial'));
          if (sp.dims[0] !== 3 || sp.dims[1] !== 3) fail(`layer ${i}: spatial kernel [${sp.dims}]`, 'model');
          L.spatial = vector(b('conv2d_spatial'), 9 * E, true);
          if ((E * L.inProj.cols * MATRIX[L.inProj.type]) % lim.minStorageBufferOffsetAlignment) fail(`layer ${i}: in_proj thirds are not aligned`, 'model');
        } else {
          L.kind = 'attn';
          L.wq = matrix(b('attn_q'), E, H * HEAD); L.wk = matrix(b('attn_k'), E, Hkv * HEAD); L.wv = matrix(b('attn_v'), E, Hkv * HEAD); L.wo = matrix(b('attn_out'), H * HEAD, E);
          L.qNorm = vector(b('attn_q_norm'), HEAD); L.kNorm = vector(b('attn_k_norm'), HEAD);
        }
        w.layers.push(L);
      }
      const mid = need('mm.0.weight').dims[1];
      w.inNormW = vector('mm.input_norm.weight', E); w.inNormB = vector('mm.input_norm.bias', E);
      w.mm0 = matrix('mm.0.weight', 4 * E, mid); w.mm0b = vector('mm.0.bias', mid);
      w.mm2 = matrix('mm.2.weight', mid, c.outEmbd); w.mm2b = vector('mm.2.bias', c.outEmbd);
      for (const t of infos) if (up(t.bytes, 4) > bind) fail(`${t.name}: ${t.bytes} bytes are over the device's binding limit`, 'memory');

      // ---- kernels ----
      const src = typeof opts.kernels === 'function' ? opts.kernels : typeof opts.kernels === 'object' && opts.kernels ? (n) => opts.kernels[n] : defaultSource(opts.kernels);
      const sources = {};
      for (const k of KERNELS) { halt(); sources[k] = await src(k); }
      const pipes = new Map();
      const code = (kernel, defines) => [f16 && 'enable f16;', `alias H = ${f16 ? 'f16' : 'f32'};`, EN().preprocess(sources[kernel], defines)].filter(Boolean).join('\n');
      const pipe = (kernel, defines = {}) => {
        const key = `${kernel} ${JSON.stringify(defines)}`;
        if (!pipes.has(key)) {
          pipes.set(key, (async () => {
            const module = device.createShaderModule({ code: code(kernel, defines) });
            try { return await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }); } catch (e) {
              const info = await module.getCompilationInfo?.();
              const msgs = info ? info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ') : '';
              fail(`kernel ${key}: ${e.message}${msgs ? ` (${msgs})` : ''}`, 'webgpu');
            }
          })());
        }
        return pipes.get(key);
      };
      const mmDefines = (type, o = {}) => ({ WF32: type === 'F32', ACC: !!o.acc, BIAS: !!o.bias, GELU: !!o.gelu });
      const variants = [['norm', {}], ['norm', { LAYER: true }], ['rope', {}], ['attention', {}], ['conv', {}], ['patch', {}], ['glu', {}]];
      for (const type of new Set(infos.filter((t) => t.kind === 'matrix').map((t) => t.type))) {
        for (const o of [{}, { acc: true }, { bias: true }, { bias: true, gelu: true }]) variants.push(['matmul', mmDefines(type, o)]);
      }
      await Promise.all(variants.map(([k, d]) => pipe(k, d)));
      halt();

      // ---- weights ----
      const S = GPUBufferUsage;
      const buffer = (size, usage = S.STORAGE | S.COPY_SRC | S.COPY_DST) => device.createBuffer({ size: up(Math.max(size, 4), 4), usage });
      device.pushErrorScope?.('out-of-memory');
      for (const t of infos) { t.buf = buffer(t.bytes, S.STORAGE | S.COPY_DST); owned.add(t.buf); }
      if (await device.popErrorScope?.()) fail('out of memory for the weights', 'memory');
      for (const t of infos) {
        check();
        if (t.transpose) {
          // conv2d_spatial: [channel][3 × 3] in the file, [3 × 3][channel] for the kernel's vec4 reads
          const bytes = await gguf.read(t.info);
          check();
          const v = new Float32Array(Uint8Array.from(bytes).buffer), n = v.length / 9, o = new Float32Array(v.length);
          for (let e = 0; e < n; e++) for (let k = 0; k < 9; k++) o[k * n + e] = v[e * 9 + k];
          device.queue.writeBuffer(t.buf, 0, o);
          continue;
        }
        for (let o = 0; o < t.bytes; o += STEP) {
          check();
          let chunk = await gguf.read(t.info, o, Math.min(STEP, t.bytes - o));
          check();
          if (chunk.byteLength % 4) { const p = new Uint8Array(up(chunk.byteLength, 4)); p.set(chunk); chunk = p; }
          device.queue.writeBuffer(t.buf, o, chunk.buffer, chunk.byteOffset, chunk.byteLength);
        }
      }
      await device.queue.onSubmittedWorkDone();
      halt();
      if (lost) fail(`device lost: ${lost.message}`, 'lost');
      return encoder({ c, w, device, f16, lost: () => lost, pipe, mmDefines, buffer, owned, free, infos });
    } catch (e) {
      free();
      throw e;
    }
  };

  const encoder = ({ c, w, device, f16, lost, pipe, mmDefines, buffer, owned, free, infos }) => {
    const S = GPUBufferUsage, lim = device.limits, bind = Math.min(lim.maxStorageBufferBindingSize, lim.maxBufferSize);
    const E = c.nEmbd, F = c.nFf, P = c.patch, H = c.nHead, Hkv = c.nHeadKv, f = c.patch * c.merge;
    let released = false;
    const outputs = new Set();
    const check = (signal) => {
      if (released) fail('the encoder was released');
      if (lost()) fail(`device lost: ${lost().message}`, 'lost');
      if (signal?.aborted) throw aborted(signal);
    };
    const ref = (b) => (b && b.buffer ? b : { buffer: b });

    // The resized size and tokens of a picture ({ width, height, data: RGBA bytes, channels 4 or 3 }).
    const prepare = ({ width, height, data, channels = 4 }) => {
      if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)) fail(`a picture of ${width} × ${height}`);
      if (data && data.length !== width * height * channels) fail(`${data.length} bytes are not ${width} × ${height} × ${channels}`);
      const t = VR().targetSize(c, width, height);
      return { width: t.width, height: t.height, tokens: (t.width / f) * (t.height / f) };
    };

    // → { tokens, width, height, buffer: tokens × out embd f32 (STORAGE | COPY_SRC | COPY_DST), drop() }.
    const encode = async (image, { signal } = {}) => {
      check(signal);
      const size = prepare(image), px = size.width / P, py = size.height / P, T = px * py, N = T / 4, mid = w.mm0.rows;
      const chunk = ffnChunk(T, F, bind);
      const sizes = { x: T * E, n: T * E, y: T * E, s1: T * E, s2: T * E, s3: T * E, g: chunk * F, u: chunk * F, pix: size.width * size.height * 3, cols: T * 3 * P * P, rope: T * HEAD, hmid: N * mid, out: N * c.outEmbd };
      for (const [k, n] of Object.entries(sizes)) if (n * 4 > bind) fail(`a picture of ${T} patches needs ${k} of ${n * 4} bytes, over the device's binding limit`, 'memory');
      const scratch = [];
      let out = null;
      try {
        // ---- buffers ----
        device.pushErrorScope?.('out-of-memory');
        const B = {};
        for (const [k, n] of Object.entries(sizes)) { B[k] = buffer(n * 4); if (k !== 'out') scratch.push(B[k]); }
        out = B.out;
        if (await device.popErrorScope?.()) fail(`out of memory for a picture of ${T} patches`, 'memory');
        check(signal);
        const pre = VR().preprocess(c, image.data, image.width, image.height, { channels: image.channels || 4 });
        check(signal);
        device.queue.writeBuffer(B.pix, 0, pre.pixels);
        device.queue.writeBuffer(B.rope, 0, ropeTable(px, py, HEAD, c.ropeTheta));

        // ---- the graph: stages of dispatches, each submitted and waited for before the next ----
        const stages = [];
        let stage = [];
        const op = (kernel, defines, entries, words, dims) => stage.push({ kernel, defines, entries, words, dims });
        const cut = () => { stages.push(stage); stage = []; };
        const grid = (n) => EN().grid(Math.ceil(n / 256));
        const mm = (W, X, Y, rows, T_, o = {}) => op('matmul', mmDefines(W.type, o), { 0: W.bind || W.buf, 1: X, 2: Y, ...(o.bias && { 3: o.bias.buf }) }, PARAMS.matmul({ rows, K: W.cols, T: T_ }), [Math.ceil(rows / 128), Math.ceil(T_ / 64)]);
        const norm = (X, N_, wt, rows) => op('norm', {}, { 0: X, 1: N_, 2: wt.buf }, PARAMS.norm({ n: E, eps: c.eps }), [rows]);
        const third = (W, i) => { const size = (W.rows / 3) * W.cols * MATRIX[W.type]; return { type: W.type, cols: W.cols, bind: { buffer: W.buf, offset: i * size, size } }; };
        let x = B.x, n = B.n;
        op('patch', {}, { 0: B.pix, 1: B.cols }, PARAMS.patch({ n: (T * 3 * P * P) / 4, px, P }), grid((T * 3 * P * P) / 4));
        mm(w.patch0, B.cols, n, E, T);
        if (w.patch1) mm(w.patch1, B.cols, n, E, T, { acc: true });
        norm(n, x, w.embNorm, T);
        cut();
        for (const L of w.layers) {
          norm(x, n, L.ln1, T);
          if (L.kind === 'conv') {
            for (const [i, s] of [B.s1, B.s2, B.s3].entries()) mm(third(L.inProj, i), n, s, E, T);
            op('conv', {}, { 0: B.s1, 1: B.s2, 2: B.s3, 3: L.spatial.buf, 4: B.y }, PARAMS.conv({ px, py, E }), grid((T * E) / 4));
            mm(L.outProj, B.y, x, E, T, { acc: true });
          } else {
            mm(L.wq, n, B.s1, H * HEAD, T); mm(L.wk, n, B.s2, Hkv * HEAD, T); mm(L.wv, n, B.s3, Hkv * HEAD, T);
            op('rope', {}, { 0: B.s1, 1: B.s2, 2: L.qNorm.buf, 3: L.kNorm.buf, 4: B.rope }, PARAMS.rope({ H, Hkv, eps: c.eps }), [H + Hkv, T]);
            op('attention', {}, { 0: B.s1, 1: B.s2, 2: B.s3, 3: B.y }, PARAMS.attention({ T, H, Hkv, scale: 1 / Math.sqrt(HEAD) }), [Math.ceil(T / 64), H]);
            mm(L.wo, B.y, x, E, T, { acc: true });
          }
          norm(x, n, L.ln2, T);
          for (let t0 = 0; t0 < T; t0 += chunk) {
            const tc = Math.min(chunk, T - t0), rows = { offset: t0 * E * 4, size: tc * E * 4 };
            mm(L.gate, { buffer: n, ...rows }, B.g, F, tc); mm(L.up, { buffer: n, ...rows }, B.u, F, tc);
            op('glu', {}, { 0: B.g, 1: B.u }, PARAMS.glu({ n: (tc * F) / 4 }), grid((tc * F) / 4));
            mm(L.down, B.g, { buffer: x, ...rows }, E, tc, { acc: true });
          }
          cut();
        }
        op('norm', { LAYER: true }, { 0: x, 1: n, 2: w.inNormW.buf, 3: w.inNormB.buf }, PARAMS.norm({ n: E, eps: c.projEps, px }), [T]);
        mm(w.mm0, n, B.hmid, mid, N, { bias: w.mm0b, gelu: true });
        mm(w.mm2, B.hmid, out, c.outEmbd, N, { bias: w.mm2b });
        cut();

        // ---- uniforms and bind groups ----
        const all = stages.flat(), params = buffer(all.length * SLOT, S.UNIFORM | S.COPY_DST);
        scratch.push(params);
        const host = new Uint32Array((all.length * SLOT) / 4);
        all.forEach((d, i) => host.set(d.words, (i * SLOT) / 4));
        device.queue.writeBuffer(params, 0, host);
        for (const [i, d] of all.entries()) {
          d.p = await pipe(d.kernel, d.defines);
          d.group = device.createBindGroup({
            layout: d.p.getBindGroupLayout(0),
            entries: [...Object.entries(d.entries).map(([k, v]) => ({ binding: +k, resource: ref(v) })), { binding: BINDING[d.kernel], resource: { buffer: params, offset: i * SLOT, size: 16 } }],
          });
        }
        for (const list of stages) {
          check(signal);
          const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
          for (const d of list) { pass.setPipeline(d.p); pass.setBindGroup(0, d.group); pass.dispatchWorkgroups(...d.dims); }
          pass.end();
          device.queue.submit([enc.finish()]);
          await device.queue.onSubmittedWorkDone();
        }
        check(signal);
        const result = out;
        outputs.add(result);
        out = null;
        return {
          tokens: N, width: size.width, height: size.height, buffer: result,
          drop: () => { if (outputs.delete(result)) result.destroy(); },
        };
      } finally {
        for (const b of scratch) b.destroy();
        out?.destroy();
      }
    };

    return {
      config: c, device, f16, prepare, encode,
      // Weights and every output not yet dropped; the device too when the encoder made it.
      release: () => { released = true; for (const b of outputs) b.destroy(); outputs.clear(); free(); },
      // For the checks: one kernel at a time on the encoder's own pipelines.
      _k: {
        pipe, buffer, PARAMS, BINDING, weight: (name) => infos.find((t) => t.name === name),
        dispatch: async (kernel, defines, entries, words, dims) => {
          const p = await pipe(kernel, defines), u = buffer(SLOT, S.UNIFORM | S.COPY_DST);
          device.queue.writeBuffer(u, 0, words);
          const g = device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [...Object.entries(entries).map(([k, v]) => ({ binding: +k, resource: ref(v) })), { binding: BINDING[kernel], resource: { buffer: u, size: 16 } }] });
          const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
          pass.setPipeline(p); pass.setBindGroup(0, g); pass.dispatchWorkgroups(...dims); pass.end();
          device.queue.submit([enc.finish()]);
          await device.queue.onSubmittedWorkDone();
          u.destroy();
        },
      },
    };
  };

  return { load, PARAMS, KERNELS, ropeTable, ffnChunk };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_VISION; else GZ_AI_VISION;
