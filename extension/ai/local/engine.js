// The local engine's GPU forward pass of LFM3 (GGUF architecture `lfm3`) in WebGPU, with Glaze's own kernels
// (ai/local/kernels/*.wgsl, shipped in the package). The graph and its numerics are ai/local/reference.js's;
// checks/ai/local-engine-check.js holds each kernel and the whole model to it.
// Weights stay in the GGUF's quantized blocks (Q4_K, Q5_K, Q6_K, Q8_0; F32 vectors) and are dequantized inside the
// kernels, bit for bit as ai/local/quant.js. They are packed into buffers of at most 1 GiB (Firefox allows 2), each
// tensor at a 256-byte boundary; a tensor larger than the device's binding limit is split into runs of whole rows.
// Paths: f16 (`shader-f16`): the key/value caches and the GEMM tiles in f16, sums in f32; f32 otherwise. Subgroups
// (`subgroups`, checked on the device first) for the GEMV's row sums; workgroup memory otherwise (Firefox).
// One token: GEMV per matrix (ffn_gate and ffn_up together, SwiGLU applied); several: tiled GEMM. Sliding layers keep
// a ring of window + chunk positions; full layers every position up to the session's context.
// Classic script; node exports (the pure parts run in Node: plan, preprocess, grid, splits, ropeTable).
var GZ_AI_ENGINE = globalThis.GZ_AI_ENGINE || (() => {
  let reference = null;
  const REF = () => reference || (reference = typeof GZ_AI_REFERENCE !== 'undefined' ? GZ_AI_REFERENCE : require('./reference.js'));
  // reason (a load's failure): 'webgpu' (no adapter or device, or a kernel it refuses), 'memory', 'lost' (the device), 'model'.
  const fail = (what, reason) => { throw Object.assign(new Error(`engine: ${what}`), reason ? { reason } : {}); };
  // Values and bytes per block of the types with kernels.
  const QUANT = { Q4_K: [256, 144], Q5_K: [256, 176], Q6_K: [256, 210], Q8_0: [32, 34] };
  const KERNELS = ['quant', 'matvec', 'matmul', 'embed', 'norm', 'swiglu', 'shortconv', 'rope', 'attention', 'argmax', 'topk', 'penalty', 'probe'];
  const QUANTIZED = new Set(['matvec', 'matmul', 'embed']);
  const SLOT = 256; // bytes per op's uniforms (minUniformBufferOffsetAlignment)
  const CAP = 2 ** 30; // bytes per weight buffer
  const up = (n, a) => Math.ceil(n / a) * a;

  // ---- pure parts --------------------------------------------------------------------------------------------------------
  // `//#if A || B && !C`, `//#else`, `//#endif` lines keep or drop the lines between them.
  const test = (expr, d) => expr.split('||').some((alt) => alt.split('&&').every((t) => { t = t.trim(); return t[0] === '!' ? !d[t.slice(1)] : !!d[t]; }));
  const preprocess = (src, defines = {}) => {
    const out = [], stack = [];
    let on = true;
    for (const line of src.split('\n')) {
      const m = /^\s*\/\/#(if|else|endif)\b(.*)$/.exec(line);
      if (!m) { if (on) out.push(line); continue; }
      if (m[1] === 'if') { const v = test(m[2], defines); stack.push({ parent: on, v }); on = on && v; }
      else if (m[1] === 'else') { const top = stack[stack.length - 1]; if (!top) fail('#else without #if'); on = top.parent && !top.v; }
      else { const top = stack.pop(); if (!top) fail('#endif without #if'); on = top.parent; }
    }
    if (stack.length) fail('#if without #endif');
    return out.join('\n');
  };

  // Where each tensor goes. tensors: [{ name, bytes, rows, rowBytes, pair? }] in order; `pair` names the next tensor to
  // place right after this one so both bind as one range (ffn_gate then ffn_up) when that fits the binding limit.
  // → { buffers: [bytes], at: { name: [{ buffer, offset, size, row, rows, pairOff? }] } }: each run of rows at a
  // 256-aligned offset (sizes rounded up to 4), runs never larger than the binding limit or a buffer.
  const plan = (tensors, { maxBuffer, maxBinding, align = 256, cap = CAP }) => {
    const limit = Math.min(maxBuffer, cap), bind = Math.min(maxBinding, limit);
    const buffers = [], at = {};
    const put = (size) => {
      size = up(size, 4);
      if (size > limit) fail(`a run of ${size} bytes is larger than a buffer`);
      let b = buffers.length - 1;
      if (b < 0 || up(buffers[b], align) + size > limit) { buffers.push(0); b++; }
      const offset = up(buffers[b], align);
      buffers[b] = offset + size;
      return { buffer: b, offset, size };
    };
    const byName = new Map(tensors.map((t) => [t.name, t]));
    for (const t of tensors) {
      if (at[t.name]) continue;
      const mate = t.pair && byName.get(t.pair);
      if (mate && !at[mate.name]) {
        const off = up(t.bytes, align), span = off + mate.bytes;
        if (span <= bind) {
          const p = put(span);
          at[t.name] = [{ ...p, size: up(span, 4), row: 0, rows: t.rows, pairOff: off }];
          at[mate.name] = [{ buffer: p.buffer, offset: p.offset + off, size: up(mate.bytes, 4), row: 0, rows: mate.rows }];
          continue;
        }
      }
      const per = t.bytes <= bind ? t.rows : Math.floor(bind / t.rowBytes);
      if (per < 1) fail(`${t.name}: a row of ${t.rowBytes} bytes is over the binding limit`);
      const runs = [];
      for (let r = 0; r < t.rows; r += per) {
        const rows = Math.min(per, t.rows - r);
        runs.push({ ...put(rows * t.rowBytes), row: r, rows });
      }
      at[t.name] = runs;
    }
    return { buffers, at };
  };

  // Workgroups for n on a grid no side of which passes max: [x, y], x · y ≥ n (the kernels skip the excess).
  const grid = (n, max = 65535) => {
    if (n <= max) return [Math.max(1, n), 1];
    const y = Math.ceil(n / max);
    if (y > max) fail(`${n} workgroups`);
    return [Math.ceil(n / y), y];
  };

  // How many ways a big-tile GEMM of rows × cols for T tokens splits along k (each split's sums added in order after),
  // so a matrix with few tiles still fills a GPU: about 320 workgroups (an 80-SM GPU's 4 waves; more splits measured
  // slower on a 3080 Ti), at most 8, whole sub-blocks of 32 each; rows a multiple of 4 (the sum reads vec4).
  const splits = (rows, cols, T) => (rows % 4 ? 1 : Math.max(1, Math.min(8, cols / 32, Math.floor(320 / (Math.ceil(rows / 128) * Math.ceil(T / 128))))));

  // cos and sin of NeoX RoPE for positions from..from + count − 1, as the reference computes them (θ in double, then
  // rounded to f32): rows of n / 2 (cos, sin) pairs.
  const ropeTable = (from, count, n, base, factors) => {
    const half = n / 2, out = new Float32Array(count * half * 2);
    for (let t = 0; t < count; t++) {
      for (let i = 0; i < half; i++) {
        const theta = ((from + t) * base ** (-2 * i / n)) / (factors ? factors[i] : 1);
        out[(t * half + i) * 2] = Math.cos(theta);
        out[(t * half + i) * 2 + 1] = Math.sin(theta);
      }
    }
    return out;
  };

  // Each kernel's uniforms (32 bytes): a function of its fields → the words to write.
  const u32 = (...v) => Uint32Array.from(v.map((x) => x >>> 0));
  const f32bits = (x) => new Uint32Array(Float32Array.of(x).buffer)[0];
  const PARAMS = {
    matvec: ({ rows, K, rowBytes, xOff = 0, yOff = 0, upOff = 0 }) => u32(rows, K, rowBytes, xOff, yOff, upOff, 0, 0),
    matmul: ({ rows, K, rowBytes, T, xStride, xOff = 0, ldy, yOff = 0 }) => u32(rows, K, rowBytes, T, xStride, xOff, ldy, yOff),
    embed: ({ n, E, rowBytes, row0 = 0, rows }) => u32(n, E, rowBytes, row0, rows, 0, 0, 0),
    norm: ({ n, eps }) => u32(n, f32bits(eps), 0, 0),
    swiglu: ({ n }) => u32(n / 4, 0, 0, 0),
    shortconv: ({ T, E, K }) => u32(T, E, K, 0),
    rope: ({ T, pos, H, Hkv, D, ring = 0, eps }) => u32(T, pos, H, Hkv, D, ring, f32bits(eps), 0),
    attention: ({ T, pos, H, Hkv, window = 0, ring = 0, scale, splits = 1 }) => u32(T, pos, H, Hkv, window, ring, f32bits(scale), splits),
    argmax: ({ n, chunks }) => u32(n, chunks, 0, 0),
    topk: ({ n, k, chunks }) => u32(n, k, chunks, 0),
    penalty: ({ count, r }) => u32(count, f32bits(r), 0, 0),
  };

  // ---- the engine --------------------------------------------------------------------------------------------------------
  const defaultSource = (base) => async (name) => {
    // An extension page has chrome.runtime; the engine host's dedicated Worker has no chrome.* but the extension's origin.
    const url = base ? new URL(`${name}.wgsl`, base).href
      : typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(`ai/local/kernels/${name}.wgsl`)
        : typeof location !== 'undefined' && /^(chrome|moz|safari-web)-extension:$/.test(new URL(location.origin).protocol) ? new URL(`/ai/local/kernels/${name}.wgsl`, location.origin).href
          : fail('no kernel source');
    const r = await fetch(url);
    if (!r.ok) fail(`kernel ${name}: ${r.status}`);
    return r.text();
  };

  // A device for the engine: the adapter's limits, shader-f16 and subgroups when it has them.
  const requestDevice = async (adapter, { f16, subgroups, profile }) => {
    const L = adapter.limits, requiredFeatures = [];
    if (f16) requiredFeatures.push('shader-f16');
    if (subgroups) requiredFeatures.push('subgroups');
    if (profile && adapter.features.has('timestamp-query')) requiredFeatures.push('timestamp-query');
    return adapter.requestDevice({
      requiredFeatures,
      requiredLimits: {
        maxBufferSize: L.maxBufferSize, maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
        maxStorageBuffersPerShaderStage: Math.min(L.maxStorageBuffersPerShaderStage, 10),
        maxComputeWorkgroupStorageSize: Math.min(L.maxComputeWorkgroupStorageSize, 32768),
      },
    });
  };

  // gguf: an open GGUF (ai/local/gguf.js). opts: { adapter, device (made from adapter if absent), precision 'auto' |
  // 'f32' | 'f16', subgroups 'auto' | false, kernels (name → source, or a base URL; the package's by default), onProgress,
  // profile (timestamp-query, for forward's profile option) }.
  const create = async (gguf, opts = {}) => {
    const halt = () => { if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError'); };
    halt();
    let c;
    try { c = REF().config(gguf); } catch (e) { fail(e.message, 'model'); }
    if (typeof navigator === 'undefined' || !navigator.gpu) fail('no WebGPU', 'webgpu');
    let adapter = opts.adapter;
    // Chrome on Linux with NVIDIA's Vulkan driver answers null until its GPU process is up: a few more tries.
    for (let i = 0; !adapter && i < 4; i++) {
      if (i) { await new Promise((r) => setTimeout(r, 500 * i)); halt(); }
      try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch { adapter = null; }
    }
    halt();
    if (!adapter) fail('no WebGPU adapter', 'webgpu');
    const precision = opts.precision || 'auto';
    const f16 = precision === 'f16' || (precision === 'auto' && adapter.features.has('shader-f16'));
    if (f16 && !adapter.features.has('shader-f16')) fail('this adapter has no shader-f16', 'webgpu');
    let sg = opts.subgroups !== false && adapter.features.has('subgroups');
    let device;
    try { device = opts.device || await requestDevice(adapter, { f16, subgroups: sg, profile: opts.profile }); } catch (e) { halt(); fail(`no device: ${e.message}`, 'webgpu'); }
    // A device the engine made is the engine's to destroy (all its memory with it).
    const own = !opts.device;
    const bail = (e) => { if (own) device.destroy?.(); throw e; };
    if (sg && !device.features.has('subgroups')) sg = false;
    if (f16 && !device.features.has('shader-f16')) bail(Object.assign(new Error('engine: the device has no shader-f16'), { reason: 'webgpu' }));
    // The GEMM's tiles: 2 × 576 vec4 of H.
    if (device.limits.maxComputeWorkgroupStorageSize < 2 * 576 * (f16 ? 8 : 16)) bail(Object.assign(new Error('engine: the device allows too little workgroup storage'), { reason: 'webgpu' }));
    // The big GEMM tile (2 × 1024 vec4: f32, or H on the f16 path unless tf32) where the device allows it: opts.gemm
    // 'auto', 'big' or 'small'. A prompt step of more than 64 tokens takes the big tiles.
    // Measured per GPU (prefill of 512 tokens): on a 3080 Ti the f16 path's big tiles are faster in f32 (2,802 tok/s
    // against 2,603 in f16) and a split along k fills its 80 SMs; on an M5 Pro f16 tiles and no split are (its few cores
    // fill without, and the splits' sum costs more than it gains). opts.tiles 'auto' | 'f32' | 'h'; opts.split false
    // turns the split off.
    const apple = adapter.info?.vendor === 'apple';
    const tf32 = f16 && device.limits.maxComputeWorkgroupStorageSize >= 2 * 1024 * 16 && (opts.tiles === 'f32' || (opts.tiles !== 'h' && !apple));
    const split = opts.split ?? !apple;
    const bigTile = device.limits.maxComputeWorkgroupStorageSize >= 2 * 1024 * (f16 && !tf32 ? 8 : 16) && opts.gemm !== 'small';
    // Without the split, matrices of under 1024 rows take the 64 × 64 tiles, for more workgroups.
    const bigRows = opts.gemm === 'big' || split ? 1 : 1024;
    let lost = null;
    device.lost.then((info) => { lost = info; });
    try {
    halt();

    const src = typeof opts.kernels === 'function' ? opts.kernels : typeof opts.kernels === 'object' && opts.kernels ? (n) => opts.kernels[n] : defaultSource(opts.kernels);
    const sources = {};
    for (const k of KERNELS) sources[k] = await src(k);

    // ---- pipelines ----
    const pipes = new Map();
    let tpr = 32;
    const code = (kernel, defines = {}) => {
      const d = { ...defines, F16: f16, SUBGROUPS: sg && kernel !== 'probe' ? true : defines.SUBGROUPS };
      const head = [d.F16 && 'enable f16;', (d.SUBGROUPS || kernel === 'probe') && 'enable subgroups;', `alias H = ${d.F16 ? 'f16' : 'f32'};`, `const TPR: u32 = ${tpr}u;`];
      return [...head.filter(Boolean), QUANTIZED.has(kernel) ? preprocess(sources.quant, d) : '', preprocess(sources[kernel], d)].join('\n');
    };
    const pipe = async (kernel, defines = {}) => {
      const key = `${kernel} ${JSON.stringify(defines)}`;
      if (!pipes.has(key)) {
        pipes.set(key, (async () => {
          const module = device.createShaderModule({ code: code(kernel, defines) });
          try { return await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'main' } }); } catch (e) {
            const info = await module.getCompilationInfo?.();
            const msgs = info ? info.messages.filter((m) => m.type === 'error').map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ') : '';
            throw new Error(`engine: kernel ${key}: ${e.message}${msgs ? ` (${msgs})` : ''}`);
          }
        })());
      }
      return pipes.get(key);
    };

    // ---- buffers ----
    const S = GPUBufferUsage;
    const fits = (size, limit) => { if (!Number.isSafeInteger(size) || size < 0 || up(Math.max(size, 4), 4) > limit) fail(`buffer of ${size} bytes exceeds device limit ${limit}`, 'memory'); };
    const buffer = (size, usage = S.STORAGE | S.COPY_SRC | S.COPY_DST) => {
      fits(size, device.limits.maxBufferSize);
      return device.createBuffer({ size: up(Math.max(size, 4), 4), usage });
    };
    const upload = (data, usage) => {
      const b = buffer(data.byteLength, usage);
      device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, up(data.byteLength, 4) === data.byteLength ? data.byteLength : fail('upload: not whole words'));
      return b;
    };
    const read = async (b, offset = 0, size = b.size - offset) => {
      const r = device.createBuffer({ size, usage: S.MAP_READ | S.COPY_DST });
      try {
        const enc = device.createCommandEncoder();
        enc.copyBufferToBuffer(b, offset, r, 0, size);
        device.queue.submit([enc.finish()]);
        await r.mapAsync(GPUMapMode.READ);
        const out = r.getMappedRange().slice(0);
        r.unmap();
        return out;
      } finally { r.destroy(); }
    };
    // Uniforms for one dispatch outside a session (the checks).
    const uniform = (words) => { const b = buffer(SLOT, S.UNIFORM | S.COPY_DST); device.queue.writeBuffer(b, 0, words); return b; };
    // A whole buffer, or a run of one, as a binding.
    const ref = (b) => (b instanceof GPUBuffer ? { buffer: b } : b);

    // Encodes one dispatch: entries { binding: buffer or { buffer, offset, size } }.
    const group = (p, entries, what = '') => device.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: Object.entries(entries).map(([k, v]) => ({ binding: +k, resource: v && (v instanceof GPUBuffer || v.buffer) ? ref(v) : fail(`${what}: binding ${k} has no buffer (${Object.prototype.toString.call(v)} ${JSON.stringify(v)})`) })),
    });
    const dispatch = async (kernel, defines, entries, words, dims) => {
      const p = await pipe(kernel, defines), u = uniform(words);
      const g = group(p, { ...entries, [paramBinding[kernel]]: u });
      const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
      pass.setPipeline(p); pass.setBindGroup(0, g); pass.dispatchWorkgroups(...dims); pass.end();
      device.queue.submit([enc.finish()]);
      u.destroy();
    };
    const paramBinding = { matvec: 3, matmul: 3, embed: 3, norm: 5, swiglu: 2, shortconv: 4, rope: 8, attention: 5, argmax: 3, topk: 3, penalty: 2 };

    // Subgroups: the kernels assume invocation li is lane li mod size, and need TPR ≤ the size; else the plain path.
    let sgWhy = null;
    if (sg) {
      tpr = Math.min(32, adapter.info?.subgroupMinSize || 32);
      try {
        const o = buffer(512 * 4), p = await pipe('probe');
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(p); pass.setBindGroup(0, group(p, { 0: o })); pass.dispatchWorkgroups(1); pass.end();
        device.queue.submit([enc.finish()]);
        const v = new Uint32Array(await read(o));
        o.destroy();
        for (let i = 0; i < 256 && sg; i++) {
          const size = v[i] >>> 16, lane = v[i] & 0xffff;
          const xor = v[256 + i];
          if (size < tpr || lane !== i % size || xor !== (i ^ 1)) { sg = false; sgWhy = `invocation ${i}: lane ${lane} of ${size}, its xor-1 neighbour ${xor}`; }
        }
      } catch (e) { sg = false; sgWhy = e.message; }
      if (!sg) { tpr = 32; pipes.clear(); }
    }

    // ---- weights ----
    const E = c.nEmbd, hd = c.headDim, F = c.nFf;
    const infos = [], need = (name) => gguf.tensor(name) || fail(`no ${name}`);
    const matrix = (name, cols, rows, pair) => {
      const t = need(name);
      if (t.dims.length !== 2 || t.dims[0] !== cols || t.dims[1] !== rows) fail(`${name}: shape [${t.dims}], [${cols},${rows}] expected`);
      if (!QUANT[t.type]) fail(`${name}: ${t.type} has no kernel`);
      const rowBytes = (t.dims[0] / QUANT[t.type][0]) * QUANT[t.type][1];
      if (t.dims[0] % 32) fail(`${name}: rows of ${t.dims[0]}`);
      infos.push({ name, info: t, bytes: t.bytes, rows: t.dims[1] || 1, rowBytes, cols: t.dims[0], type: t.type, pair });
    };
    const vector = (name, n) => {
      const t = need(name);
      if (t.type !== 'F32' || t.count !== n) fail(`${name}: ${t.type} [${t.dims}], F32 × ${n} expected`);
      infos.push({ name, info: t, bytes: t.bytes, rows: 1, rowBytes: t.bytes, cols: n, type: 'F32' });
    };
    if (gguf.tensor('output.weight')) matrix('output.weight', E, c.vocab);
    matrix('token_embd.weight', E, c.vocab);
    vector('output_norm.weight', E);
    for (let i = 0; i < c.nLayer; i++) {
      const b = (n) => `blk.${i}.${n}.weight`;
      for (const n of ['attn_norm', 'ffn_norm', 'post_attention_norm', 'post_ffw_norm']) if (n.startsWith('post') ? gguf.tensor(b(n)) : true) vector(b(n), E);
      const g = need(b('ffn_gate')), u = need(b('ffn_up'));
      matrix(b('ffn_gate'), E, F, g.type === u.type ? b('ffn_up') : undefined); matrix(b('ffn_up'), E, F); matrix(b('ffn_down'), F, E);
      if (c.layers[i] === 'conv') {
        vector(b('shortconv.conv'), c.lCache * E); matrix(b('shortconv.in_proj'), E, 3 * E); matrix(b('shortconv.out_proj'), E, E);
      } else {
        matrix(b('attn_q'), E, c.nHead * hd); matrix(b('attn_k'), E, c.nHeadKv[i] * hd); matrix(b('attn_v'), E, c.nHeadKv[i] * hd);
        matrix(b('attn_output'), c.nHead * hd, E); matrix(b('attn_gate'), E, c.nHead);
        vector(b('attn_q_norm'), hd); vector(b('attn_k_norm'), hd);
        if (c.nRot !== hd || c.nRotSwa !== hd) fail('partial rotary dimensions');
      }
    }
    if (c.lCache > 8) fail('shortconv.l_cache over 8');
    if (hd !== 128) fail(`head_dim ${hd}: the attention kernel is for 128`);
    const freqs = gguf.tensor('rope_freqs.weight');
    const ropeFreqs = freqs ? new Float32Array((await gguf.read(freqs)).slice().buffer) : null;
    if (ropeFreqs && ropeFreqs.length !== c.nRot / 2) fail('rope_freqs length');

    const lim = device.limits;
    const layout = plan(infos, { maxBuffer: lim.maxBufferSize, maxBinding: lim.maxStorageBufferBindingSize });
    const wbufs = [];
    const total = infos.reduce((n, t) => n + t.bytes, 0);
    let done = 0;
    const scope = () => device.pushErrorScope?.('out-of-memory');
    const unscoped = async (what) => { const e = await device.popErrorScope?.(); if (e) fail(`out of memory for ${what}`, 'memory'); };
    try {
      scope();
      try { for (const size of layout.buffers) wbufs.push(buffer(size, S.STORAGE | S.COPY_DST)); }
      finally { await unscoped('the weights'); }
      for (const t of infos) {
        halt();
        for (const run of layout.at[t.name]) {
          const from = run.row * t.rowBytes, bytes = run.rows * t.rowBytes;
          // Reads may end inside a quantized row; queue.writeBuffer offsets must stay word aligned.
          const step = 32 << 20;
          for (let o = 0; o < bytes; o += step) {
            let chunk = await gguf.read(t.info, from + o, Math.min(step, bytes - o));
            halt();
            if (chunk.byteLength % 4) { const p = new Uint8Array(up(chunk.byteLength, 4)); p.set(chunk); chunk = p; }
            device.queue.writeBuffer(wbufs[run.buffer], run.offset + o, chunk.buffer, chunk.byteOffset, chunk.byteLength);
            done += Math.min(step, bytes - o);
            opts.onProgress?.(done, total);
          }
        }
      }
      await device.queue.onSubmittedWorkDone();
      halt();
      if (lost) fail(`device lost: ${lost.message}`, 'lost');
    } catch (e) {
      for (const b of wbufs) b.destroy();
      throw e;
    }
    const byName = new Map(infos.map((t) => [t.name, t]));
    // A tensor: its info and its runs as bindings.
    const tensor = (name) => {
      const t = byName.get(name) || fail(`no ${name}`);
      return { ...t, runs: layout.at[name].map((r) => ({ ...r, bind: { buffer: wbufs[r.buffer], offset: r.offset, size: r.size } })) };
    };

    // ---- a session -------------------------------------------------------------------------------------------------------
    let destroyed = false;
    const sessions = new Set();
    const session = async (opts) => {
      if (destroyed) fail('engine destroyed');
      const owned = [];
      let closed = false;
      // destroy may be widened by the session (its snapshots); the engine calls whatever it is at the time.
      const life = {
        own: (b) => { if (closed) { b.destroy(); fail('session destroyed'); } owned.push(b); return b; },
        closed: () => closed,
        destroy: () => { closed = true; for (const b of owned) b.destroy(); owned.length = 0; sessions.delete(close); },
      };
      const close = () => life.destroy();
      sessions.add(close);
      try {
        device.pushErrorScope?.('out-of-memory');
        let s, oom;
        try { s = await createSession(opts, life); }
        finally { oom = await device.popErrorScope?.(); }
        if (oom) fail('out of memory for the session', 'memory');
        if (closed) fail('session destroyed');
        if (lost) fail(`device lost: ${lost.message}`, 'lost');
        return s;
      } catch (e) { life.destroy(); throw e; }
    };
    // ctx: positions it can hold; chunk: tokens per forward step (a longer feed goes in chunks).
    const createSession = async ({ ctx = 4096, chunk = 128 } = {}, life) => {
      if (lost) fail(`device lost: ${lost.message}`);
      for (const [name, n] of Object.entries({ ctx, chunk })) {
        if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) fail(`${name}: a positive u32 expected`);
      }
      const H = c.nHead, V = c.vocab, K = c.lCache - 1, hidden = Math.max(3 * E, F), kvHeads = Math.max(...c.nHeadKv);
      const kvb = f16 ? 2 : 4;
      // Session storage is bound whole. Reject limits before WebGPU can return a validation-only invalid buffer,
      // and before allocating the host-side RoPE tables for an impossible context.
      const storage = (bytes) => { fits(bytes, device.limits.maxStorageBufferBindingSize); return life.own(buffer(bytes)); };
      const mk = (n) => storage(n * 4);
      fits(ctx * c.nRot * 4, device.limits.maxStorageBufferBindingSize);
      fits(ctx * c.nRotSwa * 4, device.limits.maxStorageBufferBindingSize);
      const B = {
        ids: mk(chunk), x: mk(chunk * E), n: mk(chunk * E), a: mk(chunk * E), y: mk(chunk * E),
        big: mk(chunk * hidden), up: mk(chunk * F), q: mk(chunk * H * hd), k: mk(chunk * kvHeads * hd), v: mk(chunk * kvHeads * hd), g: mk(chunk * H),
        last: mk(V), raw: mk(V), lastIds: mk(1), mask: mk(Math.ceil(V / 32)), pen: mk(64), apart: mk(H * Math.ceil(ctx / 128) * (hd + 2)), part: mk(Math.ceil(V / 4096) * 2 * chunk), cand: mk(Math.ceil(V / 2048) * 64 * 2), top: mk(64 * 2),
      };
      // The splits' sums of a big-tile GEMM split along k.
      if (bigTile && chunk > 64 && split) {
        let most = 0;
        for (const t of infos) if (t.type !== 'F32') for (const r of layout.at[t.name]) if (r.rows >= bigRows) { const z = splits(r.rows, t.cols, chunk); if (z > 1) most = Math.max(most, z * r.rows); }
        if (most) B.split = mk(chunk * most);
      }
      let all = null; // chunk × V logits, made on first use
      const state = c.layers.map((kind, i) => {
        if (kind === 'conv') return { conv: mk(K * E) };
        const width = c.nHeadKv[i] * hd, ring = kind === 'swa' && c.window + chunk < ctx ? c.window + chunk : 0;
        const slots = ring || ctx;
        return { ring, K: storage(slots * width * kvb), V: storage(slots * width * kvb) };
      });
      const ropeFull = life.own(upload(ropeTable(0, ctx, c.nRot, c.ropeBase, ropeFreqs), S.STORAGE | S.COPY_DST));
      const ropeSwa = life.own(upload(ropeTable(0, ctx, c.nRotSwa, c.ropeBaseSwa, null), S.STORAGE | S.COPY_DST));

      // Every dispatch of a forward step owns a uniform slot; a step rewrites them all, then runs its list.
      const slots = [];
      const P = { one: [], many: [], manyBig: [], lastOne: [], lastMany: [], allMany: [], argmax: [], topk: [] };
      let params = null;
      const op = async (list, kernel, defines, entries, words, dims) => {
        const p = await pipe(kernel, defines), slot = slots.length;
        slots.push(words);
        list.push({ p, slot, entries, words, dims, kernel, name: `${kernel}${Object.keys(defines).filter((d) => defines[d]).map((d) => ` ${d}`).join('')}` });
      };
      const W = (name) => tensor(name);
      const blk = (i, n) => `blk.${i}.${n}.weight`;

      // y = W · x for each run of W's rows. GEMV (one token) or GEMM (T tokens, T filled per step).
      const mm = async (list, name, xOff, X, Y, yOff, { one, ldy, big: bigList = false }) => {
        const t = W(name);
        for (const r of t.runs) {
          if (one) await op(list, 'matvec', { [t.type]: true }, { 0: r.bind, 1: X, 2: Y }, () => PARAMS.matvec({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, xOff: xOff(), yOff: yOff + r.row }), () => grid(Math.ceil(r.rows / (256 / tpr))));
          else {
            const big = bigList && bigTile && r.rows >= bigRows, tile = big ? 128 : 64, z = big && Y && split ? splits(r.rows, t.cols, chunk) : 1;
            const into = z > 1 ? B.split : Y;
            await op(list, 'matmul', { [t.type]: true, BIG: big, TF32: big && tf32 }, { 0: r.bind, 1: X, 2: into }, (T) => PARAMS.matmul({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, T, xStride: t.cols, xOff: xOff(), ldy: z > 1 ? r.rows : ldy, yOff: z > 1 ? 0 : yOff + r.row }), (T) => [Math.ceil(r.rows / tile), Math.ceil(T / tile), z]);
            if (z > 1) await op(list, 'matmul', { SUM: true }, { 1: B.split, 2: Y }, (T) => PARAMS.matmul({ rows: r.rows, K: z, rowBytes: 0, T, xStride: 0, ldy, yOff: yOff + r.row }), (T) => grid(Math.ceil((T * r.rows) / 4 / 256)));
          }
        }
      };
      const vec = (name) => W(name).runs[0].bind;

      const build = async (list, one, big = false) => {
        const zero = () => 0;
        const at = (n) => ({ one, ldy: n, big });
        const embd = W('token_embd.weight');
        for (const r of embd.runs) await op(list, 'embed', { [embd.type]: true }, { 0: r.bind, 1: B.ids, 2: B.x }, (T) => PARAMS.embed({ n: T, E, rowBytes: embd.rowBytes, row0: r.row, rows: r.rows }), (T) => grid(Math.ceil((T * E) / 32 / 64)));
        await op(list, 'norm', {}, { 1: B.x, 2: B.n, 3: vec(blk(0, 'attn_norm')) }, () => PARAMS.norm({ n: E, eps: c.eps }), (T) => [T]);
        for (let i = 0; i < c.nLayer; i++) {
          const kind = c.layers[i], s = state[i];
          if (kind === 'conv') {
            await mm(list, blk(i, 'shortconv.in_proj'), zero, B.n, B.big, 0, at(3 * E));
            await op(list, 'shortconv', {}, { 0: B.big, 1: s.conv, 2: vec(blk(i, 'shortconv.conv')), 3: B.y }, (T) => PARAMS.shortconv({ T, E, K }), (T) => grid(Math.ceil((T * E) / 256)));
            await op(list, 'shortconv', { ROLL: true }, { 0: B.big, 1: s.conv }, (T) => PARAMS.shortconv({ T, E, K }), () => [Math.ceil(E / 256)]);
            await mm(list, blk(i, 'shortconv.out_proj'), zero, B.y, B.a, 0, at(E));
          } else {
            const Hkv = c.nHeadKv[i], swa = kind === 'swa';
            await mm(list, blk(i, 'attn_q'), zero, B.n, B.q, 0, at(H * hd));
            await mm(list, blk(i, 'attn_k'), zero, B.n, B.k, 0, at(Hkv * hd));
            await mm(list, blk(i, 'attn_v'), zero, B.n, B.v, 0, at(Hkv * hd));
            await mm(list, blk(i, 'attn_gate'), zero, B.n, B.g, 0, at(H));
            await op(list, 'rope', {}, { 0: B.q, 1: B.k, 2: B.v, 3: s.K, 4: s.V, 5: vec(blk(i, 'attn_q_norm')), 6: vec(blk(i, 'attn_k_norm')), 7: swa ? ropeSwa : ropeFull },
              (T, pos) => PARAMS.rope({ T, pos, H, Hkv, D: hd, ring: s.ring, eps: c.eps }), (T) => [H + Hkv, T]);
            const att = (T, pos, splits) => PARAMS.attention({ T, pos, H, Hkv, window: swa ? c.window : 0, ring: s.ring, scale: 1 / Math.sqrt(hd), splits });
            if (one) {
              // One query: a workgroup per head and tile of 128 keys, then the tiles merged.
              const tiles = (pos) => Math.ceil((swa ? Math.min(c.window, pos + 1) : pos + 1) / 128);
              await op(list, 'attention', { SPLIT: true }, { 0: B.q, 1: s.K, 2: s.V, 6: B.apart }, (T, pos) => att(T, pos, tiles(pos)), (T, pos) => [H, 1, tiles(pos)]);
              await op(list, 'attention', { COMBINE: true }, { 3: B.g, 4: B.y, 6: B.apart }, (T, pos) => att(T, pos, tiles(pos)), () => [H, 1]);
            } else await op(list, 'attention', { BLOCK: true }, { 0: B.q, 1: s.K, 2: s.V, 3: B.g, 4: B.y }, (T, pos) => att(T, pos, 1), (T) => [H, Math.ceil(T / 16)]);
            await mm(list, blk(i, 'attn_output'), zero, B.y, B.a, 0, at(E));
          }
          const post = byName.has(blk(i, 'post_attention_norm'));
          await op(list, 'norm', { ADD: true, POST: post }, { 0: B.a, 1: B.x, 2: B.n, ...(post && { 3: vec(blk(i, 'post_attention_norm')) }), 4: vec(blk(i, 'ffn_norm')) }, () => PARAMS.norm({ n: E, eps: c.eps }), (T) => [T]);
          const gate = W(blk(i, 'ffn_gate'));
          if (one && gate.runs.length === 1 && gate.runs[0].pairOff !== undefined) {
            await op(list, 'matvec', { [gate.type]: true, GLU: true }, { 0: gate.runs[0].bind, 1: B.n, 2: B.big }, () => PARAMS.matvec({ rows: F, K: E, rowBytes: gate.rowBytes, upOff: gate.runs[0].pairOff }), () => grid(Math.ceil(F / (256 / tpr))));
          } else {
            await mm(list, blk(i, 'ffn_gate'), zero, B.n, B.big, 0, at(F));
            await mm(list, blk(i, 'ffn_up'), zero, B.n, B.up, 0, at(F));
            await op(list, 'swiglu', {}, { 0: B.big, 1: B.up }, (T) => PARAMS.swiglu({ n: T * F }), (T) => grid(Math.ceil((T * F) / 4 / 256)));
          }
          await mm(list, blk(i, 'ffn_down'), zero, B.big, B.a, 0, at(E));
          const postF = byName.has(blk(i, 'post_ffw_norm')), next = i + 1 < c.nLayer ? blk(i + 1, 'attn_norm') : 'output_norm.weight';
          await op(list, 'norm', { ADD: true, POST: postF }, { 0: B.a, 1: B.x, 2: B.n, ...(postF && { 3: vec(blk(i, 'post_ffw_norm')) }), 4: vec(next) }, () => PARAMS.norm({ n: E, eps: c.eps }), (T) => [T]);
        }
      };
      const out = gguf.tensor('output.weight') ? 'output.weight' : 'token_embd.weight';
      await build(P.one, true);
      await build(P.many, false);
      if (bigTile && chunk > 64) await build(P.manyBig, false, true);
      let lastT = 1;
      await mm(P.lastOne, out, () => 0, B.n, B.last, 0, { one: true });
      await mm(P.lastMany, out, () => (lastT - 1) * E, B.n, B.last, 0, { one: true });
      const chunks = Math.ceil(V / 4096), tchunks = Math.ceil(V / 2048);
      let topK = 1, penCount = 0, penR = 1, stage = 0;
      // The pick from B.last: argmax, or the top k; with the grammar's mask (B.mask) when masked.
      const picks = async (argList, topList, masked) => {
        const M = masked ? { MASK: true } : {}, Me = masked ? { 4: B.mask } : {};
        await op(argList, 'argmax', { PART: true, ...M }, { 0: B.last, 1: B.part, ...Me }, () => PARAMS.argmax({ n: V, chunks }), () => [chunks, 1]);
        await op(argList, 'argmax', {}, { 1: B.part, 2: B.lastIds }, () => PARAMS.argmax({ n: V, chunks }), () => [1]);
        await op(topList, 'topk', { PART: true, ...M }, { 0: B.last, 1: B.cand, ...Me }, () => PARAMS.topk({ n: V, k: topK, chunks: tchunks }), () => [tchunks]);
        // A merge workgroup holds 256 × 16 candidates. Larger vocabularies need intermediate merges.
        let candidates = B.cand, maxChunks = tchunks, chunkCount = () => tchunks;
        for (;;) {
          const inputCount = chunkCount, maxGroups = Math.ceil(maxChunks * 64 / 4096);
          const groups = () => Math.ceil(inputCount() * topK / 4096);
          const output = maxGroups === 1 ? B.top : (B[`topStage${stage++}`] = mk(maxGroups * 64 * 2));
          await op(topList, 'topk', {}, { 1: candidates, 2: output }, () => PARAMS.topk({ n: V, k: topK, chunks: inputCount() }), () => [groups()]);
          if (maxGroups === 1) break;
          candidates = output; maxChunks = maxGroups; chunkCount = groups;
        }
      };
      Object.assign(P, { argmaxMask: [], topkMask: [], penalty: [] });
      await picks(P.argmax, P.topk, false);
      await picks(P.argmaxMask, P.topkMask, true);
      await op(P.penalty, 'penalty', {}, { 0: B.last, 1: B.pen }, () => PARAMS.penalty({ count: penCount, r: penR }), () => [1]);
      // Every row's logits: its buffer (chunk × vocab) is made on first use.
      await mm(P.allMany, out, () => 0, B.n, null, 0, { one: false, ldy: V, big: bigTile && chunk > 64 });
      params = life.own(buffer(slots.length * SLOT, S.UNIFORM | S.COPY_DST));
      const host = new Uint32Array((slots.length * SLOT) / 4);
      const bindAll = (list) => { for (const d of list) d.group = group(d.p, { ...d.entries, [paramBinding[d.kernel]]: { buffer: params, offset: d.slot * SLOT, size: 32 } }, d.kernel); };
      for (const [name, list] of Object.entries(P)) if (name !== 'allMany') bindAll(list);
      const allMany = () => {
        if (all) return;
        all = mk(chunk * V);
        for (const d of P.allMany) d.entries[2] = all;
        bindAll(P.allMany);
      };

      let pos = 0, busy = false;
      const encode = (pass, list, T) => {
        for (const d of list) {
          pass.setPipeline(d.p); pass.setBindGroup(0, d.group);
          pass.dispatchWorkgroups(...d.dims(T, pos));
        }
      };
      // Each dispatch in its own pass between two timestamps. → [{ name, ms }] in order.
      const timed = async (enc, lists, T) => {
        const ds = lists.flat(), qs = device.createQuerySet({ type: 'timestamp', count: 2 * ds.length });
        ds.forEach((d, i) => { const pass = enc.beginComputePass({ timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 2 * i, endOfPassWriteIndex: 2 * i + 1 } }); encode(pass, [d], T); pass.end(); });
        const qb = buffer(16 * ds.length, S.QUERY_RESOLVE | S.COPY_SRC);
        enc.resolveQuerySet(qs, 0, 2 * ds.length, qb, 0);
        return async () => { const t = new BigUint64Array(await read(qb)); qs.destroy(); qb.destroy(); return ds.map((d, i) => ({ name: d.name, ms: Number(t[2 * i + 1] - t[2 * i]) / 1e6 })); };
      };
      const fill = (lists, T) => {
        for (const list of lists) for (const d of list) host.set(d.words(T, pos), (d.slot * SLOT) / 4);
        device.queue.writeBuffer(params, 0, host);
      };
      // Feeds tokens at the next positions. logits: 'none' | 'last' | 'all' (rows to onRows(first row, Float32Array,
      // count) a chunk at a time, or returned whole); argmax: the last row's id by the GPU; topK: k (≤ 64) best of the last
      // row, by the GPU. → { logits, id, top }.
      // 'keep': the last row's logits stay on the GPU (B.last) for pick(). signal: checked before each chunk; an abort leaves
      // the chunks already fed in the caches.
      // embeds: [{ at, tokens, buffer }]: the rows at positions at .. at + tokens − 1 of this feed come from buffer (a
      // GPUBuffer on this device with COPY_SRC, tokens × embedding_length f32, as a vision encoder writes them) instead of the
      // token embedding: one ordinary position each, causal.
      const forward = async (tokens, { logits = 'last', argmax = false, topK: k = 0, onRows, profile = false, signal, embeds = [] } = {}) => {
        if (life.closed()) fail('session destroyed');
        if (lost) fail(`device lost: ${lost.message}`);
        if (busy) fail('a forward step is running');
        if (!tokens.length) fail('no tokens');
        if (pos + tokens.length > ctx) fail(`context of ${ctx} positions is full`);
        for (const id of tokens) if (!Number.isInteger(id) || id < 0 || id >= V) fail(`token ${id}`);
        if (!Number.isInteger(k) || k < 0 || k > 64) fail('topK: 0 or an integer from 1 to 64');
        for (const e of embeds) {
          if (!Number.isInteger(e?.at) || !Number.isInteger(e.tokens) || e.at < 0 || e.tokens < 1 || e.at + e.tokens > tokens.length) fail('embeds: at and tokens inside the feed');
          if (!(e.buffer instanceof GPUBuffer) || e.buffer.size < e.tokens * E * 4 || !(e.buffer.usage & S.COPY_SRC)) fail(`embeds: a GPUBuffer with COPY_SRC of at least ${E * 4} bytes a token`);
        }
        if (logits === 'all') allMany();
        busy = true;
        try {
          const rows = logits === 'all' && !onRows ? new Float32Array(tokens.length * V) : null;
          let res = { logits: null, id: null, top: null };
          for (let i = 0; i < tokens.length; i += chunk) {
            if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
            if (lost) fail(`device lost: ${lost.message}`, 'lost');
            const part = tokens.slice(i, i + chunk), T = part.length, lastChunk = i + chunk >= tokens.length;
            device.queue.writeBuffer(B.ids, 0, Uint32Array.from(part));
            lastT = T; topK = k || 1;
            const body = T === 1 ? P.one : T > 64 && P.manyBig.length ? P.manyBig : P.many;
            const tail = [];
            if (lastChunk && (logits !== 'none' || argmax || k)) tail.push(T === 1 ? P.lastOne : P.lastMany);
            if (lastChunk && argmax) tail.push(P.argmax);
            if (lastChunk && k) tail.push(P.topk);
            if (logits === 'all') tail.push(P.allMany);
            fill([body, ...tail], T);
            const enc = device.createCommandEncoder();
            let times = null;
            // Rows from embeds overwrite the lookup's, between it and the first layer.
            const copies = embeds.flatMap((e) => {
              const lo = Math.max(e.at, i), hi = Math.min(e.at + e.tokens, i + T);
              return lo < hi ? [{ buffer: e.buffer, from: (lo - e.at) * E * 4, to: (lo - i) * E * 4, size: (hi - lo) * E * 4 }] : [];
            });
            if (profile && device.features.has('timestamp-query') && !copies.length) times = await timed(enc, [body, ...tail], T);
            else {
              const lookup = copies.length ? body.filter((d) => d.kernel === 'embed') : [];
              let pass = enc.beginComputePass();
              if (lookup.length) {
                encode(pass, lookup, T);
                pass.end();
                for (const r of copies) enc.copyBufferToBuffer(r.buffer, r.from, B.x, r.to, r.size);
                pass = enc.beginComputePass();
              }
              encode(pass, lookup.length ? body.filter((d) => d.kernel !== 'embed') : body, T);
              for (const l of tail) encode(pass, l, T);
              pass.end();
            }
            device.queue.submit([enc.finish()]);
            pos += T;
            if (times) (res.profile ||= []).push(...await times());
            // With a signal, each chunk's work finishes before the next is checked: a cancel takes effect within a chunk.
            if (signal && !lastChunk) await device.queue.onSubmittedWorkDone();
            if (logits === 'all') {
              const got = new Float32Array(await read(all, 0, T * V * 4));
              if (onRows) onRows(i, got, T); else rows.set(got, i * V);
            }
            if (lastChunk) {
              if (logits === 'last') res.logits = new Float32Array(await read(B.last, 0, V * 4));
              if (argmax) res.id = new Uint32Array(await read(B.lastIds, 0, 4))[0];
              if (k) {
                const t = new Uint32Array(await read(B.top, 0, k * 8)), f = new Float32Array(t.buffer);
                res.top = Array.from({ length: k }, (_, j) => ({ id: t[2 * j + 1], logit: f[2 * j] })).filter((e) => e.id !== 0xffffffff);
              }
            }
          }
          if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
          if (rows) res.logits = rows;
          return res;
        } finally { busy = false; }
      };
      // A token from the logits in B.last (a forward with logits 'keep' made them), on the GPU: penalty { ids, r } first
      // (each id once, in place), then with mask (Uint32Array, ceil(vocab / 32) words; id i at bit i & 31 of word i >> 5)
      // only allowed ids: k 1 → { id } (argmax), else → { top: [{ id, logit }] } (k ≤ 64, highest first).
      const pick = async ({ k = 1, mask = null, penalty = null } = {}) => {
        if (life.closed()) fail('session destroyed');
        if (lost) fail(`device lost: ${lost.message}`, 'lost');
        if (busy) fail('a forward step is running');
        if (!Number.isInteger(k) || k < 1 || k > 64) fail('k: an integer from 1 to 64');
        if (mask && !(mask instanceof Uint32Array && mask.length === Math.ceil(V / 32))) fail(`mask: a Uint32Array of ${Math.ceil(V / 32)} words`);
        busy = true;
        try {
          const lists = [];
          if (penalty?.ids?.length && penalty.r !== 1) {
            const ids = [...new Set(penalty.ids)].filter((id) => Number.isInteger(id) && id >= 0 && id < V).slice(-64);
            if (!(penalty.r > 0)) fail('repetition penalty: a positive number');
            device.queue.writeBuffer(B.pen, 0, Uint32Array.from(ids));
            penCount = ids.length; penR = penalty.r;
            lists.push(P.penalty);
          }
          if (mask) device.queue.writeBuffer(B.mask, 0, mask);
          topK = k;
          lists.push(k === 1 ? (mask ? P.argmaxMask : P.argmax) : (mask ? P.topkMask : P.topk));
          fill(lists, 1);
          const enc = device.createCommandEncoder();
          // Penalties are per draw. Preserve raw logits even if the mask is empty or readback/cancellation fails, so
          // a retry or a snapshot does not apply the penalty a second time.
          const penalized = lists.includes(P.penalty);
          if (penalized) enc.copyBufferToBuffer(B.last, 0, B.raw, 0, V * 4);
          const pass = enc.beginComputePass();
          for (const l of lists) encode(pass, l, 1);
          pass.end();
          if (penalized) enc.copyBufferToBuffer(B.raw, 0, B.last, 0, V * 4);
          device.queue.submit([enc.finish()]);
          if (k === 1) {
            const id = new Uint32Array(await read(B.lastIds, 0, 4))[0];
            return { id: id === 0xffffffff ? null : id };
          }
          const t = new Uint32Array(await read(B.top, 0, k * 8)), f = new Float32Array(t.buffer);
          return { top: Array.from({ length: k }, (_, j) => ({ id: t[2 * j + 1], logit: f[2 * j] })).filter((e) => e.id !== 0xffffffff && Number.isFinite(e.logit)) };
        } finally { busy = false; }
      };

      // The sequence's state as GPU copies: the conv states, the sliding rings whole, the full layers' keys and values up
      // to the position, and (logits) B.last. → { pos, logits, bufs, drop() }; restore(snap) puts it all back.
      const snaps = new Set();
      const snapshot = async ({ logits = false } = {}) => {
        if (life.closed()) fail('session destroyed');
        if (lost) fail(`device lost: ${lost.message}`, 'lost');
        if (busy) fail('a forward step is running');
        busy = true;
        const bufs = [];
        const copy = (src, size) => { const b = buffer(size); bufs.push([src, b, size]); return b; };
        try {
          device.pushErrorScope?.('out-of-memory');
          let oom;
          try {
            state.forEach((st, i) => {
              if (c.layers[i] === 'conv') return copy(st.conv, st.conv.size);
              const rows = st.ring ? st.K.size : pos * c.nHeadKv[i] * hd * kvb;
              if (rows) { copy(st.K, rows); copy(st.V, rows); }
            });
            if (logits) copy(B.last, V * 4);
          } finally { oom = await device.popErrorScope?.(); }
          if (life.closed()) fail('session destroyed');
          if (lost) fail(`device lost: ${lost.message}`, 'lost');
          if (oom) fail('out of memory for a snapshot', 'memory');
          const enc = device.createCommandEncoder();
          for (const [src, b, size] of bufs) enc.copyBufferToBuffer(src, 0, b, 0, size);
          device.queue.submit([enc.finish()]);
          const snap = {
            pos, logits, bufs,
            drop() { if (!snaps.delete(snap)) return; for (const [, b] of bufs) b.destroy(); },
          };
          snaps.add(snap);
          return snap;
        } catch (e) { for (const [, b] of bufs) b.destroy(); throw e; }
        finally { busy = false; }
      };
      const restore = async (snap) => {
        if (life.closed()) fail('session destroyed');
        if (busy) fail('a forward step is running');
        if (!snaps.has(snap)) fail('restore: not a live snapshot of this session');
        const enc = device.createCommandEncoder();
        for (const [dst, b, size] of snap.bufs) enc.copyBufferToBuffer(b, 0, dst, 0, size);
        // The conv states at the start are zeros; a snapshot at 0 copied them, so every conv layer is restored.
        device.queue.submit([enc.finish()]);
        pos = snap.pos;
      };
      const close = life.destroy;
      life.destroy = () => { for (const snap of [...snaps]) snap.drop(); close(); };

      return {
        forward, pick, snapshot, restore,
        // The greedy next token after feeding tokens.
        greedy: async (tokens) => (await forward(tokens, { logits: 'none', argmax: true })).id,
        get pos() { return pos; },
        ctx, chunk, destroy: () => life.destroy(),
      };
    };

    return {
      config: c, device, adapter, f16, tf32, split, subgroups: sg, subgroupsOff: sgWhy, tpr, layout, session,
      get lost() { return lost; },
      destroy: () => { destroyed = true; for (const close of sessions) close(); for (const b of wbufs) b.destroy(); if (own) device.destroy?.(); },
      // For the checks: the kernels one dispatch at a time, on the engine's own pipelines and weights.
      _k: { pipe, dispatch, upload, read, buffer, tensor, PARAMS, grid, tf32, get tpr() { return tpr; } },
    };
    } catch (e) {
      if (!e?.reason && !opts.signal?.aborted) e = Object.assign(e instanceof Error ? e : new Error(String(e)), { reason: lost ? 'lost' : /kernel /.test(e?.message) ? 'webgpu' : 'model' });
      bail(e);
    }
  };


  // ---- sampling (llama.cpp's order after the GPU's penalty and top-k: top-p at temperature 1, then temperature) -----------
  // top: [{ id, logit }] highest first. → an id; random() in [0, 1).
  const sample = (top, { temperature = 1, topP = 1 } = {}, random = Math.random) => {
    if (!top.length) fail('no token is allowed');
    let keep = top.length;
    if (topP < 1) {
      const m = top[0].logit, p = top.map((e) => Math.exp(e.logit - m)), z = p.reduce((a, b) => a + b, 0);
      for (let i = 0, acc = 0; i < p.length; i++) { acc += p[i] / z; if (acc >= topP) { keep = i + 1; break; } }
    }
    const m = top[0].logit, w = top.slice(0, keep).map((e) => Math.exp((e.logit - m) / temperature));
    let r = random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return top[i].id; }
    return top[keep - 1].id;
  };
  const checkSampler = ({ temperature = 1, topK = 0, topP = 1, repetitionPenalty = 1 } = {}) => {
    if (!Number.isFinite(temperature) || temperature < 0) fail('sampler.temperature: a finite number ≥ 0');
    if (!Number.isInteger(topK) || topK < 0) fail('sampler.topK: an integer ≥ 0');
    if (!Number.isFinite(topP) || !(topP > 0 && topP <= 1)) fail('sampler.topP: a finite number in (0, 1]');
    if (!Number.isFinite(repetitionPenalty) || repetitionPenalty <= 0) fail('sampler.repetitionPenalty: a finite number > 0');
    return { temperature, topK, topP, repetitionPenalty };
  };

  // ---- the model a host drives (ai/local/host.js): one sequence on the GPU ------------------------------------------------
  // load(gguf, { context, chunk, signal, onProgress, ...create's options }) → { context, prefill, decode, snapshot, restore,
  // release }. Load errors carry .reason: 'webgpu', 'memory', 'lost' or 'model'; an abort rejects with the signal's reason.
  //   prefill(ids, { snapshot, signal, embeds }): feeds ids (after the token decode last chose, which is part of the sequence);
  //     embeds [{ at, tokens, buffer }]: ids[at .. at + tokens − 1] take their rows from buffer (on model.device, COPY_SRC,
  //     tokens × embedding_length f32: a picture's embeddings) instead of the token embedding;
  //     → a snapshot of the state after them when snapshot is set, else undefined. The signal is checked before each chunk.
  //   decode({ sampler: { temperature, topK, topP, repetitionPenalty }, mask, signal, random }) → the next token's id,
  //     from the last fed position's logits: penalty (the last 64 tokens), then mask (a Uint32Array of ceil(vocab / 32)
  //     words, id i allowed when bit i & 31 of word i >> 5 is set), then temperature 0 or topK 1: the highest; else the
  //     topK (at most 64; 0: 64) highest, top-p, temperature, a draw. The id is fed by the next decode or prefill.
  //   snapshot() → snap (snap.drop() frees it); restore(snap): the sequence as it was. release(): all GPU memory goes.
  const load = async (gguf, { context = 4096, chunk = 512, signal, onProgress, ...opts } = {}) => {
    const engine = await create(gguf, { ...opts, onProgress, signal });
    let s;
    try {
      s = await engine.session({ ctx: context, chunk });
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    } catch (e) {
      engine.destroy();
      if (!signal?.aborted && e && !e.reason) e.reason = engine.lost ? 'lost' : 'webgpu';
      throw e;
    }
    let pending = null, ready = false, released = false, running = false, recent = [];
    const snaps = new Map(); // model snap → { inner, pending, ready, recent }
    const live = () => {
      if (released) fail('the model was released');
      if (engine.lost) fail(`device lost: ${engine.lost.message}`, 'lost');
    };
    const remember = (ids) => { recent = recent.concat(ids).slice(-64); };
    const halt = (sig) => { if (sig?.aborted) throw sig.reason ?? new DOMException('Aborted', 'AbortError'); };
    const feed = async (ids, opt) => {
      const t = pending === null ? ids : [pending, ...ids];
      if (!t.length) return;
      const start = s.pos;
      try { await s.forward(t, opt); }
      finally {
        // Validation can reject before any work, and cancellation can stop between chunks. Only submitted tokens
        // became part of the caches; retain the pending token and old logits when nothing was consumed.
        const consumed = s.pos - start;
        if (consumed) {
          pending = null; ready = consumed === t.length;
          remember(t.slice(0, consumed));
        }
      }
    };
    const snapshot = async () => {
      live();
      const inner = await s.snapshot({ logits: ready });
      if (released) { inner.drop(); live(); }
      const snap = { drop() { const v = snaps.get(snap); if (!v) return; snaps.delete(snap); v.inner.drop(); } };
      snaps.set(snap, { inner, pending, ready, recent });
      return snap;
    };
    const model = {
      context,
      engine,
      // The device embeds buffers must be made on.
      get device() { return engine.device; },
      async prefill(ids, { snapshot: snap = false, signal: sig, onRows, embeds } = {}) {
        live(); halt(sig);
        if (!Array.isArray(ids) && !ArrayBuffer.isView(ids)) fail('prefill: token ids');
        // embeds index ids; the pending token, fed first, moves them one along.
        const shifted = embeds?.length ? embeds.map((e) => ({ ...e, at: e.at + (pending === null ? 0 : 1) })) : undefined;
        await feed(Array.from(ids), { ...(onRows ? { logits: 'all', onRows } : { logits: 'keep' }), signal: sig, embeds: shifted });
        halt(sig);
        if (!snap) return undefined;
        try {
          const result = await snapshot();
          if (sig?.aborted) { result.drop(); halt(sig); }
          return result;
        } catch (e) { halt(sig); if (e?.reason === 'memory') return null; throw e; }
      },
      async decode({ sampler, mask = null, signal: sig, random = Math.random } = {}) {
        live(); halt(sig);
        const sp = checkSampler(sampler);
        if (mask !== null && !(mask instanceof Uint32Array && mask.length === Math.ceil(engine.config.vocab / 32))) fail(`mask: a Uint32Array of ${Math.ceil(engine.config.vocab / 32)} words`);
        if (model.pos >= context) fail(`context of ${context} positions is full`);
        if (pending !== null) await feed([], { logits: 'keep', signal: sig });
        if (!ready) fail('decode: nothing fed to decode from');
        halt(sig);
        const penalty = sp.repetitionPenalty !== 1 ? { ids: recent, r: sp.repetitionPenalty } : null;
        const k = sp.temperature === 0 || sp.topK === 1 ? 1 : Math.min(sp.topK || 64, 64);
        const r = await s.pick({ k, mask, penalty });
        halt(sig);
        const id = k === 1 ? r.id : sample(r.top, sp, random);
        if (id === null) fail('decode: the mask allows no token');
        pending = id; ready = false;
        return id;
      },
      snapshot,
      async restore(snap) {
        live();
        const v = snaps.get(snap);
        if (!v) fail('restore: not a live snapshot of this model');
        await s.restore(v.inner);
        ({ pending, ready, recent } = v);
      },
      release() {
        if (released) return;
        released = true;
        for (const snap of [...snaps.keys()]) snap.drop();
        s.destroy(); engine.destroy();
      },
      get pos() { return s.pos + (pending === null ? 0 : 1); },
    };
    // A model operation spans several session calls and awaits. Lock the whole transaction, including its host state.
    for (const name of ['prefill', 'decode', 'snapshot', 'restore']) {
      const action = model[name];
      model[name] = async (...args) => {
        live();
        if (running) fail('a model operation is running');
        running = true;
        try { const result = await action(...args); live(); return result; }
        finally { running = false; }
      };
    }
    return model;
  };

  return { create, load, sample, plan, preprocess, grid, splits, ropeTable, PARAMS, QUANT, KERNELS };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_ENGINE; else GZ_AI_ENGINE;
