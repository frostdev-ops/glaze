// The local model's hardware ladder: which LFM3 1.7B quant (ai/local/models.json, tiers 1–4) this machine downloads
// and runs. pick() is the decision, pure; probe() gathers its input in a page with WebGPU, bench() included.
//
// Refused, the whole machine: no WebGPU adapter; a fallback adapter (isFallbackAdapter, or SwiftShader by name: a CPU
// emulation); maxBufferSize or maxStorageBufferBindingSize below need(). The engine keeps every buffer under 2 GiB and
// splits a tensor into runs of whole rows (the largest row is 2,176 bytes), so weights fit any limit; what it binds
// whole is a prefill chunk's logits, CHUNK × vocab f32.
// Refused, one quant: its footprint() over half of navigator.deviceMemory (the OS, the browser and, on integrated GPUs,
// the GPU share the rest; not checked when the browser doesn't say, as Firefox doesn't): 'memory', or 'no-f16' when
// only the f16 path would fit (without shader-f16 the engine runs f32: its key/value cache doubles); free storage under
// the file's size plus 20%, unless it is already stored: 'storage'.
// Chosen: the highest tier whose decodeSpeed() is at least MIN_TPS ('fastest'); none is: the smallest allowed
// ('slow'); no bench: the smallest allowed ('unmeasured'). `choice` (a model id) overrides when that quant is allowed;
// a refused choice leaves the pick and says why in `refused`.
//
// Decode cost model. A decode step reads every weight once (token_embd too: it is the tied output head), so its time is
// a fixed part (dispatches, small kernels, the token's readback) plus the file's bytes over the rate the GPU streams
// them: t = K_OVER · overheadMs + size / (K_BW · bandwidth). bench() measures both on the machine: `bandwidth`, bytes a
// second through its GEMV over packed 8-bit weights; `overheadMs`, a chain of DISPATCHES tiny dispatches with a readback.
// K_OVER and K_BW relate those to the engine's own decode, fitted to its measured speeds (C3, decode 128 tokens with
// readback): RTX 3080 Ti Q4_K_M 133.2 / Q8_0 100.0 tok/s; M5 Pro Q4_K_M 103.3 / Q8_0 78.9 tok/s. Assumed, not measured:
// Q5_K and Q6_K cost what their bytes say; f32 vs f16 is ignored (Q4_K_M on the M5 Pro: 101.4 vs 103.3 tok/s); the
// engine without subgroups (Firefox) is no slower than with them.
// Classic script; node exports.
var GZ_AI_LADDER = globalThis.GZ_AI_LADDER || (() => {
  const MIN_TPS = 15;
  const HEADROOM = 1.2;
  // LFM3 1.7B (C0 §6) and the engine's default session (C3's createSession: ctx 4096, chunk 128).
  const SHAPE = { vocab: 128000, embed: 2048, ffn: 7680, heads: 16, kvWidth: 4 * 128, headDim: 128, full: 6, sliding: 5, window: 256 };
  const CTX = 4096, CHUNK = 128;
  // Least squares over the four C3 speeds, with the C7 bench medians (M5 Pro 175.5 GB/s, 1.2 ms; RTX 3080 Ti 410.4 GB/s,
  // 2.5 ms): predicted 113 / 76 (M5 Pro) and 126 / 102 tok/s (3080 Ti), within 10% of the measured.
  const K_OVER = 2.08, K_BW = 0.985;
  const DISPATCHES = 256; // about a decode step's: 24 layers of 9 to 13 dispatches, then the head
  const fail = (what) => { throw new Error(`ladder: ${what}`); };

  // Bytes the engine must bind as one range.
  const need = () => CHUNK * SHAPE.vocab * 4;

  // Bytes of GPU memory a quant takes in a session: weights, key/value caches, activations and logits.
  const footprint = (model, { f16 = true, ctx = CTX } = {}) => {
    const s = SHAPE, kv = (f16 ? 2 : 4) * 2 * s.kvWidth * (s.full * ctx + s.sliding * (s.window + CHUNK));
    const act = 4 * (CHUNK * (s.vocab + 4 * s.embed + 3 * s.embed + s.ffn + s.heads * s.headDim + 2 * s.kvWidth + s.heads) + s.vocab);
    return model.size + kv + act;
  };

  // Estimated decode tokens a second for a quant, from a bench result.
  const decodeSpeed = (model, bench) => {
    if (!bench || !Number.isFinite(bench.bandwidth) || !(bench.bandwidth > 0)
      || !Number.isFinite(bench.overheadMs) || !(bench.overheadMs >= 0)) return 0;
    return 1000 / (K_OVER * bench.overheadMs + 1000 * model.size / (K_BW * bench.bandwidth));
  };

  const has = (features, f) => (features instanceof Set ? features.has(f) : Array.isArray(features) && features.includes(f));
  const fallback = (adapter, info) => !!(info?.isFallbackAdapter || adapter?.isFallbackAdapter
    || ['vendor', 'architecture', 'device', 'description'].some((k) => /swiftshader/i.test(info?.[k] || '')));
  // Why the adapter itself can't run the engine, or null.
  const refusal = ({ adapter, info, limits }) => {
    if (adapter === null || !info || !limits) return 'no-webgpu';
    if (fallback(adapter, info)) return 'fallback';
    if (!(Math.min(limits.maxBufferSize, limits.maxStorageBufferBindingSize) >= need())) return 'limits';
    return null;
  };

  const defaults = () => (typeof require === 'function' ? require('./models.json').models : fail('models expected'));

  const pick = (input = {}) => {
    const no = refusal(input);
    if (no) return { tier: null, reason: no, quants: [] };
    const { features, deviceMemory, storageEstimate, bench } = input;
    const f16 = has(features, 'shader-f16');
    const budget = deviceMemory > 0 ? deviceMemory * 2 ** 30 / 2 : Infinity;
    const est = storageEstimate;
    const free = est && Number.isFinite(est.quota) ? est.quota - (est.usage || 0) : Infinity;
    const stored = new Set(input.stored || []);
    const quants = [...(input.models || defaults())].sort((a, b) => a.tier - b.tier).map((m) => {
      const q = { id: m.id, tier: m.tier, size: m.size, tps: decodeSpeed(m, bench) };
      if (footprint(m, { f16 }) > budget) q.refused = !f16 && footprint(m, { f16: true }) <= budget ? 'no-f16' : 'memory';
      else if (!stored.has(m.id) && m.size * HEADROOM > free) q.refused = 'storage';
      return q;
    });
    const ok = quants.filter((q) => !q.refused);
    if (!ok.length) return { tier: null, reason: quants[0]?.refused || 'no-model', quants };
    const fast = ok.filter((q) => q.tps >= MIN_TPS).pop();
    const auto = fast ? { q: fast, reason: 'fastest' } : { q: ok[0], reason: decodeSpeed(ok[0], bench) ? 'slow' : 'unmeasured' };
    const chosen = input.choice != null && quants.find((q) => q.id === input.choice);
    if (chosen && !chosen.refused) return { tier: chosen.tier, id: chosen.id, reason: 'chosen', quants };
    const out = { tier: auto.q.tier, id: auto.q.id, reason: auto.reason, quants };
    if (chosen) out.refused = chosen.refused;
    return out;
  };

  // ---- WebGPU --------------------------------------------------------------------------------------------------------
  const COLS = 2048; // u32 words a bench row: 8 KiB
  const kernel = async (source) => {
    if (source) return source;
    const url = typeof chrome !== 'undefined' && chrome.runtime?.getURL ? chrome.runtime.getURL('ai/local/kernels/bench.wgsl') : fail('no bench source');
    const r = await fetch(url);
    if (!r.ok) fail(`bench.wgsl: ${r.status}`);
    return r.text();
  };
  const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };

  // { bandwidth (bytes/s), overheadMs } on `device` in about `ms` milliseconds.
  const bench = async (device, { source, ms = 2000, now = () => performance.now() } = {}) => {
    const start = now();
    const S = GPUBufferUsage;
    const lim = device.limits;
    const rowBytes = COLS * 4;
    const rows = Math.floor(Math.min(128 << 20, lim.maxStorageBufferBindingSize, lim.maxBufferSize) / rowBytes);
    const made = [];
    const buf = (size, usage) => { const b = device.createBuffer({ size, usage }); made.push(b); return b; };
    const filters = ['internal', 'out-of-memory', 'validation'], checks = [];
    // Close each scope before yielding: another user of this device must not pop our scopes.
    const checked = (fn) => {
      for (const filter of filters) device.pushErrorScope(filter);
      try { return fn(); } finally { for (const _ of filters) checks.push(device.popErrorScope()); }
    };
    const checkErrors = async () => {
      const errors = await Promise.all(checks.splice(0));
      const error = errors.find(Boolean);
      if (error) fail(error.message);
    };
    try {
      const module = device.createShaderModule({ code: await kernel(source) });
      const [gemv, tick, fill] = await Promise.all(['gemv', 'tick', 'fill'].map((entryPoint) =>
        device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint } })));
      const group = (pipe, entries) => device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: entries.map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
      const { Y, R, gFill, gGemv, gTick } = checked(() => {
        const P = buf(16, S.UNIFORM | S.COPY_DST);
        device.queue.writeBuffer(P, 0, new Uint32Array([COLS, rows, 0x9e3779b9, 0]));
        const W = buf(rows * rowBytes, S.STORAGE);
        const X = buf(COLS * 16, S.STORAGE | S.COPY_DST);
        device.queue.writeBuffer(X, 0, Float32Array.from({ length: COLS * 4 }, (_, i) => ((i * 37) % 17) / 64 - 0.125));
        const Y = buf(rows * 4, S.STORAGE | S.COPY_SRC);
        const R = buf(4, S.MAP_READ | S.COPY_DST);
        return { Y, R, gFill: group(fill, [[0, P], [4, W]]), gGemv: group(gemv, [[0, P], [1, W], [2, X], [3, Y]]), gTick: group(tick, [[3, Y]]) };
      });
      await checkErrors();
      const grid = (n) => { const x = Math.min(n, 32768); return [x, Math.ceil(n / x)]; };
      const run = (pipe, bg, [x, y], times = 1) => checked(() => {
        const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
        pass.setPipeline(pipe);
        for (let i = 0; i < times; i++) { pass.setBindGroup(0, bg); pass.dispatchWorkgroups(x, y); }
        pass.end();
        return enc;
      });
      const timed = async (enc) => {
        const t = now();
        checked(() => device.queue.submit([enc.finish()]));
        await device.queue.onSubmittedWorkDone();
        const elapsed = now() - t;
        await checkErrors();
        return elapsed;
      };

      await timed(run(fill, gFill, grid(Math.ceil(rows * COLS / 256))));
      await timed(run(gemv, gGemv, grid(rows))); // warm-up
      // Enough passes a submit that its own latency (and a coarse clock) stays small beside them: about 20 ms.
      const four = await timed(run(gemv, gGemv, grid(rows), 4));
      const reps = Math.max(1, Math.min(256, Math.ceil(20 / Math.max(four / 4, 0.05))));
      const rates = [];
      while (now() - start < ms * 0.7 || rates.length < 3) rates.push(reps * rows * rowBytes / (await timed(run(gemv, gGemv, grid(rows), reps)) / 1000));
      const steps = [];
      while (now() - start < ms || steps.length < 3) {
        const t = now();
        const enc = run(tick, gTick, [1, 1], DISPATCHES);
        checked(() => { enc.copyBufferToBuffer(Y, 0, R, 0, 4); device.queue.submit([enc.finish()]); });
        await R.mapAsync(GPUMapMode.READ);
        R.unmap();
        steps.push(now() - t);
        await checkErrors();
      }
      const bandwidth = median(rates), overheadMs = median(steps);
      if (!Number.isFinite(bandwidth) || bandwidth <= 0 || !Number.isFinite(overheadMs) || overheadMs < 0) fail('bench clock did not resolve timings');
      return { bandwidth, overheadMs, bytes: rows * rowBytes, reps, rounds: rates.length, steps: steps.length };
    } finally {
      for (const b of made) b.destroy();
      await checkErrors();
    }
  };

  // pick()'s input on this machine: the adapter's facts, navigator.deviceMemory, the storage estimate, and the bench
  // when nothing refuses the adapter first. opts: { gpu, navigator, source, ms }.
  const probe = async (opts = {}) => {
    const nav = opts.navigator || globalThis.navigator;
    const gpu = opts.gpu || nav?.gpu;
    let adapter = null;
    // Chromium over NVIDIA's Vulkan answers null until its GPU process is up (C3).
    for (let i = 0; gpu && !adapter && i < 3; i++) {
      adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
      if (!adapter && i < 2) await new Promise((r) => setTimeout(r, 500));
    }
    let storageEstimate = null;
    try { storageEstimate = await nav?.storage?.estimate?.() || null; } catch { storageEstimate = null; }
    const base = { deviceMemory: nav?.deviceMemory, storageEstimate };
    if (!adapter) return { ...base, adapter: null, info: null, features: [], limits: null, bench: null };
    const i = adapter.info || {};
    const info = { vendor: i.vendor || '', architecture: i.architecture || '', device: i.device || '', description: i.description || '', isFallbackAdapter: !!(i.isFallbackAdapter ?? adapter.isFallbackAdapter) };
    const features = [...adapter.features];
    const limits = { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
    const out = { ...base, adapter: { isFallbackAdapter: info.isFallbackAdapter }, info, features, limits, bench: null };
    if (refusal(out)) return out;
    let device;
    try {
      device = await adapter.requestDevice({ requiredLimits: limits });
      out.bench = await bench(device, opts);
    } catch (e) { out.benchError = String(e?.message || e); } finally { device?.destroy(); }
    return out;
  };

  return { MIN_TPS, HEADROOM, CTX, CHUNK, need, footprint, decodeSpeed, pick, bench, probe };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LADDER; else GZ_AI_LADDER;
