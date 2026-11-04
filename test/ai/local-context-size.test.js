// Rime's context size (Settings → AI → Rime, Advanced; docs/ai-harness.md "Glaze's own model"): 4K to 128K, 64K by default
// (test/ai/local-default-window.test.js).
// The ladder refuses a size this computer's memory can't hold (ai/local/ladder.js windows, from footprint); the size the
// student chose is kept on the local connection, as the tier is, and becomes the tuned model's window and input limit in
// the catalog and the window each run sends; a chosen 4K sends exactly what Glaze sent before the setting.
const test = require('node:test');
const assert = require('node:assert/strict');
const LADDER = require('../../extension/ai/local/ladder.js');
const X = require('../../extension/ai/text.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const B = require('../../extension/ai/broker.js');

const Q4 = { size: 1099627200 }, Q8 = { size: 1846237888 };

test('the sizes are 4K to 128K, and each is refused by the memory its footprint needs', () => {
  assert.deepEqual(LADDER.WINDOWS, [4096, 8192, 16384, 32768, 65536, 131072]);
  // ctx adds 12,288 bytes a token at f16 for the six full-attention layers, twice that at f32.
  assert.equal(LADDER.footprint(Q4, { ctx: 8192 }) - LADDER.footprint(Q4, { ctx: 4096 }), 4096 * 12288);
  assert.equal(LADDER.footprint(Q4, { ctx: 8192, f16: false }) - LADDER.footprint(Q4, { ctx: 4096, f16: false }), 4096 * 24576);
  const at = (model, o) => Object.fromEntries(LADDER.windows(model, o).map((w) => [w.size, w.refused || 'ok']));
  // No deviceMemory said (Firefox): nothing refused.
  assert.deepEqual(at(Q8, { f16: false }), { 4096: 'ok', 8192: 'ok', 16384: 'ok', 32768: 'ok', 65536: 'ok', 131072: 'ok' });
  // 4 GB: a 2 GiB budget.
  const budget = 2 * 2 ** 30;
  const w8 = at(Q4, { f16: true, deviceMemory: 4 });
  for (const size of LADDER.WINDOWS) assert.equal(w8[size], LADDER.footprint(Q4, { ctx: size }) > budget ? 'memory' : 'ok', String(size));
  assert.equal(w8[4096], 'ok');
  assert.equal(w8[131072], 'memory');
  // Without shader-f16 a size only f16 would fit is 'no-f16'.
  const nof16 = at(Q4, { f16: false, deviceMemory: 4 });
  const both = LADDER.WINDOWS.filter((size) => LADDER.footprint(Q4, { ctx: size, f16: false }) > budget && LADDER.footprint(Q4, { ctx: size }) <= budget);
  assert.ok(both.length > 0);
  for (const size of both) assert.equal(nof16[size], 'no-f16', String(size));
  // The tier pick stays as it was: the default window.
  assert.equal(LADDER.CTX, 4096);
});

// ---- the provider -------------------------------------------------------------------------------------------------------
const MODEL = { id: 'rime-q4', name: 'Rime Q4', size: Q4.size, quant: 'Q4_K_M', tier: 1, license: 'lfm1.0', tools: 3, state: 'ready' };
const setup = () => {
  const calls = [];
  const link = { kind: 'worker', up: true, call: async (op, args) => { calls.push({ op, args: structuredClone(args) }); return op === 'run' ? { text: 'done', finish: 'stop' } : {}; } };
  LOCAL._env({ store: { list: async () => [MODEL] }, link, gpu: () => ({}), session: null });
  return calls;
};
const R = require('../../extension/ai/request.js');
const req = () => ({ ...R.clean(X.request({ system: 'Copy the text.', data: [{ label: 'note', text: 'hello' }] })), task: { id: 'writer.complete', version: 1 } });

test('the size is kept on the local connection: 4K to 128K, none the default', () => {
  assert.equal(LOCAL.config({ window: 32768 }).window, 32768);
  assert.equal(LOCAL.config({ window: 4096 }).window, 4096, 'a chosen 4K is kept');
  assert.equal(LOCAL.config({}).window, undefined);
  for (const bad of [5000, 262144, '8192', 0]) assert.equal(LOCAL.config({ window: bad }), null, String(bad));
  assert.equal(LOCAL.windowOf(MODEL, { window: 65536 }).window, 65536);
  assert.deepEqual(LOCAL.windowOf(MODEL, {}), { window: 65536, inputLimit: 65536 });
  assert.deepEqual(LOCAL.windowOf({ ...MODEL, stock: true }, { window: 65536 }), { window: 131072, inputLimit: 117964 }, 'a stock model keeps its own');
});

test('the catalog\'s window and input limit follow the size, and caps hold it', async () => {
  setup();
  for (const size of [4096, 8192, 32768, 131072]) {
    const cfg = LOCAL.config({ window: size });
    const cat = await LOCAL.catalog(cfg);
    assert.deepEqual(cat.models[0].context, { window: size, inputLimit: size }, String(size));
    assert.equal(LOCAL.caps({ ...cfg, context: size }).context, size);
  }
  assert.deepEqual((await LOCAL.catalog(LOCAL.config({}))).models[0].context, { window: 65536, inputLimit: 65536 });
  assert.equal(LOCAL.caps(LOCAL.config({})).context, 131072);
});

test('a run sends the chosen size as its window; 4K sends exactly what it sent before', async () => {
  const calls = setup();
  await LOCAL.run(req(), LOCAL.config({ window: 32768, context: 32768 }), {});
  assert.equal(calls.at(-1).args.window, 32768);
  await LOCAL.run(req(), LOCAL.config({ context: 4096 }), {});
  const plain = calls.at(-1).args;
  await LOCAL.run(req(), LOCAL.config({ window: 4096, context: 4096 }), {});
  assert.deepEqual(calls.at(-1).args, plain);
  assert.equal(plain.window, 4096);
});

test('a warm-up sends the chosen window so the following large-context run reuses its session', async () => {
  const calls = setup();
  await LOCAL.warm(req(), LOCAL.config({ window: 32768, context: 32768 }), {});
  assert.equal(calls.at(-1).op, 'warm');
  assert.equal(calls.at(-1).args.window, 32768);
});

test('the host starts small and reserves the selected large room, reloading when its size changes', async () => {
  const H = require('../../extension/ai/local/host.js'), loads = [], reserves = [], posted = [];
  const tok = { eos: 0, id: () => undefined, encodeWith: (parts) => new Uint32Array(parts.reduce((n, p) => n + (p.text?.length || 1), 0)), decoder: () => ({ push: () => '', end: () => '' }) };
  const host = H.create({ store: { open: async () => ({}), status: async () => ({ state: 'ready' }) }, gguf: { open: async () => ({ kv: {} }) },
    tokenizer: { GLAZE_TOKENS: [], fromGGUF: () => tok }, grammar: () => null, gpu: () => ({}), ladder: () => null,
    setTimeout: (f, ms) => { const timer = setTimeout(f, ms); timer.unref(); return timer; }, post: (m) => posted.push(m),
    engine: () => ({ load: async (_g, { context }) => {
      loads.push(context);
      return { context, reserve: async (n, room) => { reserves.push({ n, room }); }, snapshot: async () => ({}), restore: async () => {}, prefill: async () => ({}), decode: async () => 0, release: () => {} };
    } }) });
  const run = (id, window, length) => host.handle({ id, op: 'run', model: 'rime-q4', parts: [{ text: 'x'.repeat(length) }], stable: 0, maxTokens: 32, sampler: {}, ...(window && { window }) });
  try {
    await host.handle({ id: 1, op: 'warm', model: 'rime-q4', parts: [{ text: 'system' }], window: 32768 });
    await run(2, 32768, 20000);
    assert.equal(posted.find((m) => m.id === 2 && ['done', 'error'].includes(m.type))?.type, 'done', JSON.stringify(posted));
    assert.deepEqual(loads, [H.LIMIT.first], 'the warm-up and run share the small initial allocation');
    assert.deepEqual(reserves, [{ n: 6, room: 32768 }, { n: 20032, room: 32768 }]);
    await run(3, 65536, 50000);
    assert.equal(posted.find((m) => m.id === 3 && ['done', 'error'].includes(m.type))?.type, 'done');
    assert.deepEqual(loads, [H.LIMIT.first, H.LIMIT.first]);
    assert.deepEqual(reserves.at(-1), { n: 50032, room: 65536 });
    await run(4, undefined, 100);
    assert.deepEqual(loads, [H.LIMIT.first, H.LIMIT.first, H.LIMIT.first], 'returning to the default releases the larger session');
    await run(5, 131072, 130000);
    assert.equal(posted.find((m) => m.id === 5 && ['done', 'error'].includes(m.type))?.type, 'done', 'a single 130K-token block fits the largest room');
    assert.deepEqual(reserves.at(-1), { n: 130032, room: 131072 });
  } finally { await host.release(); }
});

test('a changed size is a new connection generation: the broker\'s kept catalog and window go', async () => {
  const vault = new Map([['connections', { local: { provider: 'local', generation: 'g1' } }]]);
  const env = { vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    settings: async () => ({}), local: { set: async () => true }, reach: async () => true, fetch: async () => { throw new Error('none'); } };
  assert.equal((await B.config({ op: 'set', id: 'local', cfg: { provider: 'local', window: 32768 } }, env)).ok, true);
  const after = vault.get('connections').local;
  assert.equal(after.window, 32768);
  assert.notEqual(after.generation, 'g1');
  assert.equal((await B.config({ op: 'set', id: 'local', cfg: { provider: 'local', window: 32768 } }, env)).ok, true);
  assert.equal(vault.get('connections').local.generation, after.generation, 'the same size keeps it');
});
