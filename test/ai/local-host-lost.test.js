// The engine host after its GPU device is lost or runs out of memory mid-run (ai/local/host.js, engine.js's sticky
// `lost` and its 'memory' reason): the dead engine is let go at once, so the next run loads afresh rather than failing
// until five idle minutes pass, and the failure carries its own reason (ai/failure.js). A stub engine, never a GPU.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../../extension/ai/local/host.js');
const K = require('../../extension/ai/local/tokenizer.js');
const F = require('../../extension/ai/failure.js');

const VOCAB = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  const tokens = Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++)), types = tokens.map(() => 1);
  for (const [t, ty] of [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['</think>', 4]]) { tokens.push(t); types.push(ty); }
  for (let i = 0; i < 32; i++) { tokens.push(`[PAD${i}]`); types.push(5); }
  return { tokens, types, merges: [], pre: 'lfm2', bos: tokens.indexOf('<|startoftext|>'), eos: tokens.indexOf('<|im_end|>') };
})();
const TOK = (() => { const t = K.load(VOCAB); for (const n of K.GLAZE_TOKENS) t.add(n); return t; })();

// fault: what the next engine's decode throws from now on ('lost' stays, as engine.js's flag does), or null.
const setup = ({ reserve = false, reuse = false } = {}) => {
  const log = { loads: 0, released: 0 };
  const state = { fault: null, onFault: null, aheadFault: null };
  const E = {
    load: async () => {
      log.loads++;
      const ids = [...TOK.encode('ok')];
      let i = 0, dead = null, extensions = 0;
      return {
        context: 16000,
        ...(reserve && { reserve: async () => {
          if (state.fault) { const reason = state.fault; state.fault = null; throw Object.assign(new Error('context growth failed'), { reason }); }
        } }),
        ...(reuse && { reserve: async () => {}, common: () => 0, extend: async (ids) => {
          if (++extensions === 2 && state.aheadFault) { const reason = state.aheadFault; state.aheadFault = null; throw Object.assign(new Error('read-ahead failed'), { reason }); }
          return { fed: ids.length };
        } }),
        prefill: async () => { i = 0; }, snapshot: async () => ({ drop() {} }), restore: async () => {},
        decode: async () => {
          if (!dead && state.fault) { dead = state.fault; if (dead === 'memory') state.fault = null; }
          if (dead) { state.onFault?.(); const e = Object.assign(new Error(dead === 'lost' ? 'engine: device lost: gone' : 'engine: out of memory'), { reason: dead }); if (dead === 'memory') dead = null; throw e; }
          return i < ids.length ? ids[i++] : TOK.eos;
        },
        release: () => { log.released++; },
      };
    },
  };
  const store = { list: async () => [{ id: 'm', tier: 1, state: 'ready' }], status: async () => ({ state: 'ready' }), open: async () => ({ size: 1, read: async () => new Uint8Array(0) }) };
  const posted = [], waiters = new Map();
  const host = H.create({ store, gguf: { open: async () => ({ kv: {} }) }, tokenizer: { ...K, fromGGUF: () => K.load(VOCAB) }, engine: () => E, grammar: () => null, ladder: () => null,
    gpu: () => ({}), setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; },
    post: (m) => { posted.push(m); if (m.type === 'done' || m.type === 'error') waiters.get(m.id)?.(m); } });
  let seq = 0;
  const run = (op = 'run', more = {}) => { const id = ++seq; const p = new Promise((r) => waiters.set(id, r)); host.handle({ id, op, model: 'm', parts: [{ text: 'hi' }], stable: 0, sampler: {}, maxTokens: 8, ...more }); return p; };
  return { host, log, state, run };
};

for (const reason of ['lost', 'memory']) {
  test(`a run whose engine reports '${reason}' lets the engine go at once, and the next run loads afresh`, async () => {
    const t = setup();
    assert.equal((await t.run()).type, 'done');
    assert.equal(t.log.loads, 1);
    t.state.fault = reason;
    const failed = await t.run();
    assert.equal(failed.type, 'error');
    assert.deepEqual(failed.error, { category: 'provider-unavailable', reason }, JSON.stringify(failed));
    assert.equal(t.log.released, 1, 'the dead engine is released now, not after five idle minutes');
    assert.equal(t.host.loaded, null);
    if (reason === 'lost') t.state.fault = null; // a fresh device
    const next = await t.run();
    assert.equal(next.type, 'done', JSON.stringify(next));
    assert.equal(t.log.loads, 2, 'loaded again');
  });
}

for (const op of ['run', 'warm']) {
  test(`${op}: an out-of-memory context growth releases the loaded engine and keeps the memory reason`, async () => {
    const t = setup({ reserve: true });
    assert.equal((await t.run()).type, 'done');
    t.state.fault = 'memory';
    const failed = await t.run(op);
    assert.deepEqual(failed.error, { category: 'provider-unavailable', reason: 'memory' });
    assert.equal(t.log.released, 1);
    assert.equal(t.host.loaded, null);
    assert.equal((await t.run()).type, 'done');
    assert.equal(t.log.loads, 2);
  });
}

for (const reason of ['lost', 'memory']) {
  test(`a cancellation during a '${reason}' failure still releases the dead engine`, async () => {
    const t = setup();
    assert.equal((await t.run()).type, 'done');
    t.state.fault = reason;
    t.state.onFault = () => t.host.handle({ id: 2, op: 'cancel' });
    assert.deepEqual((await t.run()).error, { category: 'cancelled' });
    assert.equal(t.log.released, 1);
    assert.equal(t.host.loaded, null);
    t.state.fault = null;
    t.state.onFault = null;
    assert.equal((await t.run()).type, 'done');
    assert.equal(t.log.loads, 2);
  });

  test(`a '${reason}' failure in background read-ahead releases the engine before the next run`, async () => {
    const t = setup({ reuse: true });
    t.state.aheadFault = reason;
    assert.equal((await t.run('run', { parts: [{ text: 'hi' }, { special: '<think>' }], think: { budget: 0, close: [{ special: '</think>' }], after: [] } })).type, 'done');
    await new Promise(setImmediate);
    assert.equal(t.log.released, 1);
    assert.equal(t.host.loaded, null);
    assert.equal((await t.run()).type, 'done');
    assert.equal(t.log.loads, 2);
  });
}

test('a lost device and an out-of-memory run each say what happened', () => {
  for (const reason of ['lost', 'memory']) {
    const f = F.modelFailure({ category: 'provider-unavailable', reason });
    assert.equal(f.reason, reason);
    assert.ok(F.explain(f) && F.explain(f) !== F.explain({ category: 'provider-unavailable' }), reason);
  }
});

test('every device-lost failure in the engine names its reason, so the host knows to let it go', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension/ai/local/engine.js'), 'utf8');
  const lost = src.split('\n').filter((l) => /fail\(`device lost/.test(l));
  assert.ok(lost.length > 3);
  for (const l of lost) assert.match(l, /, 'lost'\)/, l.trim());
});
