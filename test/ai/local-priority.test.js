// A low-priority run (writer.complete) on a weak GPU never holds the GPU long enough to stall the page's painting: the host
// feeds the prompt in steps sized to about LIMIT.busy ms each from what the last one took, waits for each to finish and
// yields, so the longest stretch the GPU stays busy, the gap a frame waits, stays under 50 ms; a cancel lands within one
// step; a fast GPU's steps grow, so the cost of yielding stays small. The real host and engine on the recording WebGPU
// double, its queue finishing each submission after ms per token fed (a simulated GPU).
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../extension/ai/local/host.js');
const K = require('../../extension/ai/local/tokenizer.js');
const { model, host: gpu } = require('../fixtures/local-engine.js');

const VOCAB = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  const tokens = Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++)), types = tokens.map(() => 1);
  for (const [t, ty] of [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['</think>', 4]]) { tokens.push(t); types.push(ty); }
  for (let i = 0; i < 24; i++) { tokens.push(`[PAD${i}]`); types.push(5); }
  return { tokens, types, merges: [], pre: 'lfm2', bos: tokens.indexOf('<|startoftext|>'), eos: tokens.indexOf('<|im_end|>') };
})();
const TOK = (() => { const t = K.load(VOCAB); for (const n of K.GLAZE_TOKENS) t.add(n); return t; })();

// perToken: the simulated GPU's ms per token fed (a decode step counts one). → { call, busy (each submission's [start,
// end] ms), fed (tokens per submission), h }.
const setup = (perToken, { virtual = false } = {}) => {
  const g = gpu(), busy = [], fed = [], posted = [];
  let pending = 0, until = 0, clock = 0;
  const now = virtual ? () => clock : () => performance.now();
  if (virtual) g.context.performance = { now };
  const write = g.device.queue.writeBuffer;
  g.device.queue.writeBuffer = function (b, off, data, ...rest) {
    if (b.size === 512 * 4 && ArrayBuffer.isView(data) && data.constructor.name === 'Uint32Array') pending += data.length;
    return write.call(this, b, off, data, ...rest);
  };
  const submit = g.device.queue.submit;
  g.device.queue.submit = function (commands) {
    if (pending) {
      const at = now(), start = Math.max(at, until);
      until = start + (typeof perToken === 'function' ? perToken(pending) : pending * perToken);
      // queued: submitted while the GPU was still busy, so nothing else (the page's frame) could run between.
      busy.push([start, until, at < start]); fed.push(pending); pending = 0;
    }
    return submit.call(this, commands);
  };
  // Resolves once the simulated GPU is idle (a timer can fire a fraction of a ms early: wait again).
  const idle = (r) => { const left = until - now(); if (left <= 0) r(); else setTimeout(() => idle(r), Math.ceil(left)); };
  g.device.queue.onSubmittedWorkDone = virtual ? async () => { clock = Math.max(clock, until); } : () => new Promise(idle);
  // A readback waits for the GPU too, as mapAsync does.
  const map = g.context.GPUBuffer.prototype.mapAsync;
  g.context.GPUBuffer.prototype.mapAsync = async function (...a) { await g.device.queue.onSubmittedWorkDone(); return map.apply(this, a); };
  const E = { load: async (_g, opts) => g.load(model({ vocab: TOK.size, kinds: ['conv', 'full', 'swa'] }), { ...opts, chunk: 512 }) };
  const store = { list: async () => [{ id: 'm', tier: 1, state: 'ready' }], status: async () => ({ state: 'ready' }), open: async () => ({ size: 1, read: async () => new Uint8Array(0) }) };
  const h = H.create({ store, gguf: { open: async () => ({ kv: {} }) }, tokenizer: { ...K, fromGGUF: () => K.load(VOCAB) }, engine: () => E, grammar: () => null, ladder: () => null,
    gpu: () => ({}), setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, post: (m) => posted.push(m) });
  const call = (id, m) => new Promise((resolve, reject) => {
    h.handle({ id, ...m });
    const look = () => {
      const done = posted.find((p) => p.id === id && (p.type === 'done' || p.type === 'error'));
      if (!done) return setTimeout(look, 1);
      if (done.type === 'done') resolve(done.result); else reject(Object.assign(new Error(JSON.stringify(done.error)), done.error));
    };
    look();
  });
  return { h, g, call, busy, fed, posted };
};
const SYS = [{ special: '<|startoftext|>' }, { special: '<|im_start|>' }, { text: 'system\n' }, { special: '<|gz_task:writer.complete|>' }, { text: 'Continue the student\'s text.' }, { special: '<|im_end|>' }, { text: '\n' }];
const doc = (n) => [{ special: '<|im_start|>' }, { text: 'user\n' }, { special: '<|gz_ctx|>' }, { text: `document\n${'Cells turn food into energy in the mitochondria. '.repeat(n)}` }, { special: '<|/gz_ctx|>' },
  { special: '<|im_end|>' }, { text: '\n' }, { special: '<|im_start|>' }, { text: 'assistant\n' }, { special: '<think>' }, { special: '</think>' }];
const complete = (n, maxTokens = 4) => ({ op: 'run', model: 'm', parts: [...SYS, ...doc(n)], stable: SYS.length, sampler: { temperature: 0 }, maxTokens });
// The longest stretch the simulated GPU stays busy without an idle moment (a frame's wait): submissions queued behind
// running work join its stretch.
const stall = (busy) => {
  let most = 0, from = null, to = null;
  for (const [a, b, queued] of busy) { if (to === null || !queued) { from = a; to = b; } else to = Math.max(to, b); most = Math.max(most, to - from); }
  return most;
};

test('a weak GPU (5 ms a token): no stretch of GPU work over 50 ms while a completion feeds 600 tokens', async () => {
  const s = setup(5);
  const r = await s.call('a', complete(12));
  assert.ok(r.usage.input > 500, `input ${r.usage.input}`);
  assert.ok(stall(s.busy) <= 50, `the GPU stayed busy ${stall(s.busy).toFixed(1)} ms; steps ${s.fed.join(',')}`);
});

test('a fast GPU (0.05 ms a token): the steps grow, so yielding costs little', async () => {
  const s = setup(0.05);
  await s.call('a', complete(30));
  const prompt = s.fed.slice(0, -4);
  assert.ok(Math.max(...prompt) >= 128, `steps ${prompt.join(',')}`);
});

test('a cancel lands within one step of a low-priority prefill', async () => {
  const s = setup(5);
  const run = s.call('a', complete(12, 64));
  await new Promise((r) => setTimeout(r, 120));
  const before = s.fed.length;
  s.h.handle({ id: 'a', op: 'cancel' });
  await assert.rejects(run, (e) => e.category === 'cancelled');
  assert.ok(s.fed.length - before <= 1, `${s.fed.length - before} submissions after the cancel`);
});

// Loaded-model launch cliff: decode is fast, every GEMM has a large fixed cost, shared by larger batches. Virtual GPU
// time makes the old minutes-long oscillation a fast regression; waits, yields, host, engine and cache reuse are real.
const launchCost = (tokens) => tokens === 1 ? 8 : 60 + tokens * 0.16;
test('history warm-up learns a GEMM launch floor instead of oscillating between one and two tokens', async () => {
  const s = setup(launchCost, { virtual: true });
  try {
    const parts = [...SYS, ...doc(96)], input = TOK.encodeWith(parts).length;
    assert.ok(input > 4500 && input < 5000);
    assert.deepEqual(await s.call('warm', { op: 'warm', model: 'm', parts, stable: SYS.length }), { ok: true });
    const cost = s.busy.reduce((sum, [a, b]) => sum + b - a, 0);
    assert.ok(s.fed.filter((n) => n <= 2).length <= 4, `tiny submissions: ${s.fed.filter((n) => n <= 2).length}`);
    assert.ok(s.fed.length < 100 && cost < 6000, `${s.fed.length} submissions, ${cost} ms of GPU work`);
    assert.ok(Math.max(...s.fed) >= 128, 'bulk batches amortize the launch cost');
    assert.ok(stall(s.busy) < 100, `bounded learned steps: ${stall(s.busy)} ms`);
    s.fed.length = 0;
    assert.deepEqual(await s.call('again', { op: 'warm', model: 'm', parts, stable: SYS.length }), { ok: true });
    assert.deepEqual(s.fed, [], 'repeated history is already held');
  } finally { await s.h.release(); }
});

test('a launch-floor bulk warm-up still cancels between completed submissions and retains consumed history', async () => {
  const s = setup(launchCost, { virtual: true });
  const done = s.g.device.queue.onSubmittedWorkDone;
  let submitted = null;
  s.g.device.queue.onSubmittedWorkDone = async () => {
    await done();
    if (submitted === null && s.fed.at(-1) >= 128) {
      submitted = s.fed.length;
      s.h.handle({ id: 'cancel', op: 'cancel' });
    }
  };
  try {
    const parts = [...SYS, ...doc(96)];
    await assert.rejects(s.call('cancel', { op: 'warm', model: 'm', parts, stable: SYS.length }), (e) => e.category === 'cancelled');
    assert.equal(s.fed.length, submitted, 'no submission follows cancellation');
    const consumed = s.fed.reduce((sum, n) => sum + n, 0);
    s.fed.length = 0;
    const result = await s.call('resume', { ...complete(96), priority: 'low' });
    assert.ok(result.usage.cached >= consumed, `retained ${result.usage.cached} of ${consumed} consumed tokens`);
  } finally { await s.h.release(); }
});
