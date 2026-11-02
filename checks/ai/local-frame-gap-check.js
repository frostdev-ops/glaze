// Browser frame and cancellation check for the real host + engine on a synthetic WebGPU queue. No hardware GPU is used.
// Each token costs 2 ms of CPU work when the queue is awaited, on the page's own thread: this deliberately contends with
// requestAnimationFrame, unlike a timer-only GPU double. An unpaced control must stall frames, proving sensitivity.
// A preliminary system-only warm-up isolates inference scheduling from model initialization and shader loading.
// This verifies scheduling under synthetic contention, not GPU kernel correctness or real adapter frame latency.
// Run: glaze-remote -o <evidence> -- node checks/ai/local-frame-gap-check.js /out
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { model } = require('../../test/fixtures/local-engine.js');
const out = path.resolve(process.argv[2] || '/tmp/glaze-frame-gap');
fs.mkdirSync(out, { recursive: true });

// Browser-only recording device: validates buffer copies and executes no shaders. Reads return zero logits.
function fakeGPU(perToken) {
  Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
  const fed = [], busy = [], buffers = [];
  let pending = 0, queued = 0, cancel = null;
  class Buffer {
    constructor({ size, usage }) { Object.assign(this, { size, usage, destroyed: false }); buffers.push(this); }
    destroy() { this.destroyed = true; }
    async mapAsync() { await device.queue.onSubmittedWorkDone(); if (this.destroyed) throw Error('destroyed'); }
    getMappedRange() { return this.data ? this.data.buffer.slice(0) : new ArrayBuffer(this.size); }
    unmap() {}
  }
  Object.assign(globalThis, { GPUBuffer: Buffer, GPUBufferUsage: { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8, UNIFORM: 16 }, GPUMapMode: { READ: 1 } });
  const features = new Set(), limits = { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 128 * 2 ** 20, maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 };
  const device = {
    features, limits, lost: new Promise(() => {}), createBuffer: (d) => new Buffer(d), createShaderModule: (d) => d,
    createComputePipelineAsync: async (d) => ({ ...d, getBindGroupLayout: () => ({}) }), createBindGroup: (d) => d,
    createCommandEncoder: () => {
      const commands = [];
      return { beginComputePass: () => ({ setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }),
        copyBufferToBuffer(src, from, dst, to, size) { commands.push(() => {
          if (src.destroyed || dst.destroyed) throw Error('copy of destroyed buffer');
          dst.data ||= new Uint8Array(dst.size);
          dst.data.set(src.data ? src.data.subarray(from, from + size) : new Uint8Array(size), to);
        }); }, finish: () => commands };
    },
    queue: {
      writeBuffer(buffer, offset, data, byteOffset = 0, size = data.byteLength) {
        if (buffer.destroyed || offset + size > buffer.size) throw Error('invalid write');
        if (buffer.size === 512 * 4 && data instanceof Uint32Array) pending += data.length;
        if (buffer.size < 128 * 1024) {
          buffer.data ||= new Uint8Array(buffer.size);
          const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
          buffer.data.set(view.subarray(byteOffset, byteOffset + size), offset);
        }
      },
      submit(commands) {
        if (pending) { fed.push(pending); queued += pending; pending = 0; }
        for (const list of commands) for (const run of list) run();
      },
      async onSubmittedWorkDone() {
        if (!queued) return;
        const from = performance.now(), n = queued; queued = 0;
        while (performance.now() - from < n * perToken) { /* deterministic synthetic queue cost */ }
        busy.push({ tokens: n, ms: performance.now() - from });
        cancel?.(fed.length);
      },
    },
  };
  return { device, adapter: { features, limits, requestDevice: async () => device }, fed, busy, buffers, onStep: (f) => { cancel = f; } };
}

(async () => {
  let browser;
  const report = { backend: 'CPU WebGPU double; no shaders or hardware GPU', perTokenMs: 2, limitMs: 50, results: [] };
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    browser = await chromium.launch({ ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, args: ['--disable-background-networking', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><title>Glaze frame scheduling</title><textarea autofocus></textarea>');
    for (const f of ['tokenizer.js', 'quant.js', 'reference.js', 'engine.js', 'host.js']) await page.addScriptTag({ path: path.join(__dirname, '../../extension/ai/local', f) });
    await page.addScriptTag({ content: `globalThis.tinyModel = ${model.toString()}; globalThis.fakeGPU = ${fakeGPU.toString()};` });
    const kernels = Object.fromEntries(fs.readdirSync(path.join(__dirname, '../../extension/ai/local/kernels')).filter((f) => f.endsWith('.wgsl')).map((f) => [f.slice(0, -5), fs.readFileSync(path.join(__dirname, '../../extension/ai/local/kernels', f), 'utf8')]));
    report.results = await page.evaluate(async ({ kernels, perToken }) => {
      const K = GZ_AI_TOKENIZER, H = GZ_AI_LOCAL_HOST;
      const keep = [];
      for (let b = 33; b <= 126; b++) keep.push(b);
      for (let b = 161; b <= 172; b++) keep.push(b);
      for (let b = 174; b <= 255; b++) keep.push(b);
      let n = 0;
      const tokens = Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++)), types = tokens.map(() => 1);
      for (const name of ['<|startoftext|>', '<|im_start|>', '<|im_end|>', '<think>', '</think>']) { tokens.push(name); types.push(3); }
      for (let i = 0; i < 24; i++) { tokens.push(`[PAD${i}]`); types.push(5); }
      const vocab = { tokens, types, merges: [], pre: 'lfm2', eos: tokens.indexOf('<|im_end|>') };
      const frame = () => new Promise(requestAnimationFrame);
      const run = async (name, priority, cancelAfter = null, warm = false) => {
        const gpu = fakeGPU(perToken), posted = [];
        const engine = { load: async (_g, opts) => {
          const t = K.load(vocab); for (const name of K.GLAZE_TOKENS) t.add(name);
          return GZ_AI_ENGINE.load(tinyModel({ vocab: t.size, kinds: ['conv', 'full', 'swa'] }), { ...opts, chunk: 512, adapter: gpu.adapter, kernels: (key) => kernels[key] });
        } };
        const host = H.create({ store: { open: async () => ({}), status: async () => ({ state: 'ready' }) }, gguf: { open: async () => ({ kv: {} }) },
          tokenizer: { ...K, fromGGUF: () => K.load(vocab) }, engine: () => engine, gpu: () => ({}), grammar: () => null, ladder: () => null, post: (m) => posted.push(m) });
        const parts = [{ text: 'system\nHelp the student.' }, { text: 'user\n' + 'Cells turn food into energy. '.repeat(22) }];
        await host.handle({ id: 'prepare', op: 'warm', model: 'm', parts: parts.slice(0, 1) });
        if (posted.some((m) => m.type === 'error')) throw Error(JSON.stringify(posted));
        posted.length = 0; gpu.fed.length = 0; gpu.busy.length = 0;
        const gaps = [], frames = [], start = performance.now();
        let previous = null, active = true, cancelAt = null, cancelFed = null;
        const paint = () => { if (!active) return; const t = performance.now(); if (previous !== null) gaps.push(t - previous); previous = t; frames.push(t - start); requestAnimationFrame(paint); };
        requestAnimationFrame(paint);
        await frame(); await frame();
        if (cancelAfter !== null) gpu.onStep((count) => { if (count >= cancelAfter && cancelAt === null) {
          cancelAt = performance.now(); cancelFed = gpu.fed.length; host.handle({ id: 'run', op: 'cancel' });
        } });
        try {
          await host.handle({ id: 'run', op: warm ? 'warm' : 'run', model: 'm', parts, stable: 1, maxTokens: 4, sampler: { temperature: 0 }, ...(priority && { priority }) });
          const doneAt = performance.now();
          await frame(); await frame(); active = false;
          const done = posted.find((m) => m.id === 'run' && ['done', 'error'].includes(m.type));
          return { name, frames: frames.length, maxFrameGapMs: Math.max(...gaps), gaps, elapsedMs: doneAt - start, input: done?.result?.usage?.input,
            error: done?.error, completed: done?.type === 'done', steps: gpu.fed, maxStepMs: Math.max(...gpu.busy.map((s) => s.ms)),
            ...(cancelAt !== null && { cancellationMs: doneAt - cancelAt, submissionsAfterCancel: gpu.fed.length - cancelFed }) };
        } finally { active = false; await host.release(); if (gpu.buffers.some((b) => !b.destroyed)) throw Error('leaked fake GPU buffers'); }
      };
      return [await run('unpaced control'), await run('low priority completion', 'low'), await run('cancel low priority', 'low', 3), await run('background history warm-up', null, null, true)];
    }, { kernels, perToken: report.perTokenMs });
    const [control, low, cancelled, warm] = report.results;
    assert.ok(control.completed && control.maxFrameGapMs > 50, `unpaced control must expose stalls: ${JSON.stringify(control)}`);
    for (const row of [low, cancelled, warm]) {
      assert.ok(row.frames >= 4, `${row.name}: too few frames`);
      assert.ok(row.maxFrameGapMs < 50, `${row.name}: ${row.maxFrameGapMs.toFixed(1)} ms frame gap`);
    }
    assert.ok(low.completed && low.input > 500, 'the completion prefills a nontrivial prompt');
    assert.ok(warm.completed, 'warm-up completes');
    assert.equal(cancelled.error?.category, 'cancelled');
    assert.ok(cancelled.cancellationMs < 50 && cancelled.submissionsAfterCancel <= 1, 'cancel completes within a single bounded step');
    assert.deepEqual(errors, []);
    report.ok = true;
  } catch (e) { report.ok = false; report.error = e.stack; process.exitCode = 1; }
  finally {
    await browser?.close();
    fs.writeFileSync(path.join(out, 'local-frame-gap.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: report.ok, error: report.error, results: report.results.map(({ name, maxFrameGapMs, maxStepMs, elapsedMs, cancellationMs }) => ({ name, maxFrameGapMs, maxStepMs, elapsedMs, cancellationMs })) }, null, 2));
  }
})();
