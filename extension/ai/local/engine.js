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
// Classic script; node exports (the pure parts run in Node: plan, preprocess, grid, ropeTable).
var GZ_AI_ENGINE = globalThis.GZ_AI_ENGINE || (() => {
  let reference = null;
  const REF = () => reference || (reference = typeof GZ_AI_REFERENCE !== 'undefined' ? GZ_AI_REFERENCE : require('./reference.js'));
  const fail = (what) => { throw new Error(`engine: ${what}`); };
  // Values and bytes per block of the types with kernels.
  const QUANT = { Q4_K: [256, 144], Q5_K: [256, 176], Q6_K: [256, 210], Q8_0: [32, 34] };
  const KERNELS = ['quant', 'matvec', 'matmul', 'embed', 'norm', 'swiglu', 'shortconv', 'rope', 'attention', 'argmax', 'topk', 'probe'];
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
  };

  // ---- the engine --------------------------------------------------------------------------------------------------------
  const defaultSource = (base) => async (name) => {
    const url = base ? new URL(`${name}.wgsl`, base).href
      : typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL(`ai/local/kernels/${name}.wgsl`) : fail('no kernel source');
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
    const c = REF().config(gguf);
    if (typeof navigator === 'undefined' || !navigator.gpu) fail('no WebGPU');
    const adapter = opts.adapter || await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) fail('no WebGPU adapter');
    const precision = opts.precision || 'auto';
    const f16 = precision === 'f16' || (precision === 'auto' && adapter.features.has('shader-f16'));
    if (f16 && !adapter.features.has('shader-f16')) fail('this adapter has no shader-f16');
    let sg = opts.subgroups !== false && adapter.features.has('subgroups');
    const device = opts.device || await requestDevice(adapter, { f16, subgroups: sg, profile: opts.profile });
    if (sg && !device.features.has('subgroups')) sg = false;
    if (f16 && !device.features.has('shader-f16')) fail('the device has no shader-f16');
    // The GEMM's tiles: 2 × 576 vec4 of H.
    if (device.limits.maxComputeWorkgroupStorageSize < 2 * 576 * (f16 ? 8 : 16)) fail('the device allows too little workgroup storage');
    let lost = null;
    device.lost.then((info) => { lost = info; });

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
    const buffer = (size, usage = S.STORAGE | S.COPY_SRC | S.COPY_DST) => device.createBuffer({ size: up(Math.max(size, 4), 4), usage });
    const upload = (data, usage) => {
      const b = buffer(data.byteLength, usage);
      device.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, up(data.byteLength, 4) === data.byteLength ? data.byteLength : fail('upload: not whole words'));
      return b;
    };
    const read = async (b, offset = 0, size = b.size - offset) => {
      const r = device.createBuffer({ size, usage: S.MAP_READ | S.COPY_DST });
      const enc = device.createCommandEncoder();
      enc.copyBufferToBuffer(b, offset, r, 0, size);
      device.queue.submit([enc.finish()]);
      await r.mapAsync(GPUMapMode.READ);
      const out = r.getMappedRange().slice(0);
      r.unmap(); r.destroy();
      return out;
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
    const paramBinding = { matvec: 3, matmul: 3, embed: 3, norm: 5, swiglu: 2, shortconv: 4, rope: 8, attention: 5, argmax: 3, topk: 3 };

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
    try {
      for (const size of layout.buffers) wbufs.push(buffer(size, S.STORAGE | S.COPY_DST));
      for (const t of infos) {
        for (const run of layout.at[t.name]) {
          const from = run.row * t.rowBytes, bytes = run.rows * t.rowBytes;
          // Reads may end inside a quantized row; queue.writeBuffer offsets must stay word aligned.
          const step = 32 << 20;
          for (let o = 0; o < bytes; o += step) {
            let chunk = await gguf.read(t.info, from + o, Math.min(step, bytes - o));
            if (chunk.byteLength % 4) { const p = new Uint8Array(up(chunk.byteLength, 4)); p.set(chunk); chunk = p; }
            device.queue.writeBuffer(wbufs[run.buffer], run.offset + o, chunk.buffer, chunk.byteOffset, chunk.byteLength);
            done += Math.min(step, bytes - o);
            opts.onProgress?.(done, total);
          }
        }
      }
      await device.queue.onSubmittedWorkDone();
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
      const destroy = () => { closed = true; for (const b of owned) b.destroy(); owned.length = 0; sessions.delete(destroy); };
      const own = (b) => { if (closed) { b.destroy(); fail('session destroyed'); } owned.push(b); return b; };
      sessions.add(destroy);
      try {
        const s = await createSession(opts, { own, destroy, closed: () => closed });
        if (closed) fail('session destroyed');
        return s;
      } catch (e) { destroy(); throw e; }
    };
    // ctx: positions it can hold; chunk: tokens per forward step (a longer feed goes in chunks).
    const createSession = async ({ ctx = 4096, chunk = 128 } = {}, life) => {
      if (lost) fail(`device lost: ${lost.message}`);
      for (const [name, n] of Object.entries({ ctx, chunk })) {
        if (!Number.isInteger(n) || n < 1 || n > 0xffffffff) fail(`${name}: a positive u32 expected`);
      }
      const H = c.nHead, V = c.vocab, K = c.lCache - 1, hidden = Math.max(3 * E, F), kvHeads = Math.max(...c.nHeadKv);
      const kvb = f16 ? 2 : 4;
      const mk = (n) => life.own(buffer(n * 4));
      const B = {
        ids: mk(chunk), x: mk(chunk * E), n: mk(chunk * E), a: mk(chunk * E), y: mk(chunk * E),
        big: mk(chunk * hidden), up: mk(chunk * F), q: mk(chunk * H * hd), k: mk(chunk * kvHeads * hd), v: mk(chunk * kvHeads * hd), g: mk(chunk * H),
        last: mk(V), lastIds: mk(1), apart: mk(H * Math.ceil(ctx / 128) * (hd + 2)), part: mk(Math.ceil(V / 4096) * 2 * chunk), cand: mk(Math.ceil(V / 2048) * 64 * 2), top: mk(64 * 2),
      };
      let all = null; // chunk × V logits, made on first use
      const state = c.layers.map((kind, i) => {
        if (kind === 'conv') return { conv: mk(K * E) };
        const width = c.nHeadKv[i] * hd, ring = kind === 'swa' && c.window + chunk < ctx ? c.window + chunk : 0;
        const slots = ring || ctx;
        return { ring, K: life.own(buffer(slots * width * kvb)), V: life.own(buffer(slots * width * kvb)) };
      });
      const ropeFull = life.own(upload(ropeTable(0, ctx, c.nRot, c.ropeBase, ropeFreqs), S.STORAGE | S.COPY_DST));
      const ropeSwa = life.own(upload(ropeTable(0, ctx, c.nRotSwa, c.ropeBaseSwa, null), S.STORAGE | S.COPY_DST));

      // Every dispatch of a forward step owns a uniform slot; a step rewrites them all, then runs its list.
      const slots = [];
      const P = { one: [], many: [], lastOne: [], lastMany: [], allMany: [], argmax: [], topk: [] };
      let params = null;
      const op = async (list, kernel, defines, entries, words, dims) => {
        const p = await pipe(kernel, defines), slot = slots.length;
        slots.push(words);
        list.push({ p, slot, entries, words, dims, kernel, name: `${kernel}${Object.keys(defines).filter((d) => defines[d]).map((d) => ` ${d}`).join('')}` });
      };
      const W = (name) => tensor(name);
      const blk = (i, n) => `blk.${i}.${n}.weight`;

      // y = W · x for each run of W's rows. GEMV (one token) or GEMM (T tokens, T filled per step).
      const mm = async (list, name, xOff, X, Y, yOff, { one, ldy }) => {
        const t = W(name);
        for (const r of t.runs) {
          if (one) await op(list, 'matvec', { [t.type]: true }, { 0: r.bind, 1: X, 2: Y }, () => PARAMS.matvec({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, xOff: xOff(), yOff: yOff + r.row }), () => grid(Math.ceil(r.rows / (256 / tpr))));
          else await op(list, 'matmul', { [t.type]: true }, { 0: r.bind, 1: X, 2: Y }, (T) => PARAMS.matmul({ rows: r.rows, K: t.cols, rowBytes: t.rowBytes, T, xStride: t.cols, xOff: xOff(), ldy, yOff: yOff + r.row }), (T) => [Math.ceil(r.rows / 64), Math.ceil(T / 64)]);
        }
      };
      const vec = (name) => W(name).runs[0].bind;

      const build = async (list, one) => {
        const zero = () => 0;
        const at = (n) => ({ one, ldy: n });
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
            } else await op(list, 'attention', {}, { 0: B.q, 1: s.K, 2: s.V, 3: B.g, 4: B.y }, (T, pos) => att(T, pos, 1), (T) => [H, T]);
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
      let lastT = 1;
      await mm(P.lastOne, out, () => 0, B.n, B.last, 0, { one: true });
      await mm(P.lastMany, out, () => (lastT - 1) * E, B.n, B.last, 0, { one: true });
      const chunks = Math.ceil(V / 4096);
      await op(P.argmax, 'argmax', { PART: true }, { 0: B.last, 1: B.part }, () => PARAMS.argmax({ n: V, chunks }), () => [chunks, 1]);
      await op(P.argmax, 'argmax', {}, { 1: B.part, 2: B.lastIds }, () => PARAMS.argmax({ n: V, chunks }), () => [1]);
      const tchunks = Math.ceil(V / 2048);
      let topK = 1;
      await op(P.topk, 'topk', { PART: true }, { 0: B.last, 1: B.cand }, () => PARAMS.topk({ n: V, k: topK, chunks: tchunks }), () => [tchunks]);
      // A merge workgroup holds 256 × 16 candidates. Larger vocabularies need intermediate merges.
      let candidates = B.cand, maxChunks = tchunks, chunkCount = () => tchunks, stage = 0;
      for (;;) {
        const inputCount = chunkCount, maxGroups = Math.ceil(maxChunks * 64 / 4096);
        const groups = () => Math.ceil(inputCount() * topK / 4096);
        const output = maxGroups === 1 ? B.top : (B[`topStage${stage++}`] = mk(maxGroups * 64 * 2));
        await op(P.topk, 'topk', {}, { 1: candidates, 2: output }, () => PARAMS.topk({ n: V, k: topK, chunks: inputCount() }), () => [groups()]);
        if (maxGroups === 1) break;
        candidates = output; maxChunks = maxGroups; chunkCount = groups;
      }
      // Every row's logits: its buffer (chunk × vocab) is made on first use.
      await mm(P.allMany, out, () => 0, B.n, null, 0, { one: false, ldy: V });
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
      const forward = async (tokens, { logits = 'last', argmax = false, topK: k = 0, onRows, profile = false } = {}) => {
        if (life.closed()) fail('session destroyed');
        if (lost) fail(`device lost: ${lost.message}`);
        if (busy) fail('a forward step is running');
        if (!tokens.length) fail('no tokens');
        if (pos + tokens.length > ctx) fail(`context of ${ctx} positions is full`);
        for (const id of tokens) if (!Number.isInteger(id) || id < 0 || id >= V) fail(`token ${id}`);
        if (!Number.isInteger(k) || k < 0 || k > 64) fail('topK: 0 or an integer from 1 to 64');
        if (logits === 'all') allMany();
        busy = true;
        try {
          const rows = logits === 'all' && !onRows ? new Float32Array(tokens.length * V) : null;
          let res = { logits: null, id: null, top: null };
          for (let i = 0; i < tokens.length; i += chunk) {
            const part = tokens.slice(i, i + chunk), T = part.length, lastChunk = i + chunk >= tokens.length;
            device.queue.writeBuffer(B.ids, 0, Uint32Array.from(part));
            lastT = T; topK = k || 1;
            const body = T === 1 ? P.one : P.many;
            const tail = [];
            if (lastChunk && (logits === 'last' || argmax || k)) tail.push(T === 1 ? P.lastOne : P.lastMany);
            if (lastChunk && argmax) tail.push(P.argmax);
            if (lastChunk && k) tail.push(P.topk);
            if (logits === 'all') tail.unshift(P.allMany);
            fill([body, ...tail], T);
            const enc = device.createCommandEncoder();
            let times = null;
            if (profile && device.features.has('timestamp-query')) times = await timed(enc, [body, ...tail], T);
            else {
              const pass = enc.beginComputePass();
              encode(pass, body, T);
              for (const l of tail) encode(pass, l, T);
              pass.end();
            }
            device.queue.submit([enc.finish()]);
            if (times) (res.profile ||= []).push(...await times());
            pos += T;
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
          if (rows) res.logits = rows;
          return res;
        } finally { busy = false; }
      };
      return {
        forward,
        // The greedy next token after feeding tokens.
        greedy: async (tokens) => (await forward(tokens, { logits: 'none', argmax: true })).id,
        get pos() { return pos; },
        ctx, chunk, destroy: life.destroy,
      };
    };

    return {
      config: c, device, adapter, f16, subgroups: sg, subgroupsOff: sgWhy, tpr, layout, session,
      destroy: () => { destroyed = true; for (const close of sessions) close(); for (const b of wbufs) b.destroy(); },
      // For the checks: the kernels one dispatch at a time, on the engine's own pipelines and weights.
      _k: { pipe, dispatch, upload, read, buffer, tensor, PARAMS, grid, get tpr() { return tpr; } },
    };
  };

  return { create, plan, preprocess, grid, ropeTable, PARAMS, QUANT, KERNELS };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_ENGINE; else GZ_AI_ENGINE;
