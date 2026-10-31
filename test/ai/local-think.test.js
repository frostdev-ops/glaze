// Think mode on Glaze's own model (glaze-plans/lfm-tune FORMAT-v2.md): the local provider (ai/providers/local.js) through
// the real link and engine host (ai/local/host.js) with a stub engine that reasons when its prompt ends in <think>\n. The
// reasoning ends at the model's own </think> or at the budget, where the host writes `\n</think>`; the grammar masks the
// answer only; no reasoning reaches a delta, a host message or the result; a cancel ends either phase; the provider thinks
// for the tasks its table names, on a Glaze-tuned model this computer decodes fast enough; a stock model never thinks.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../extension/ai/providers.js');
const T = require('../../extension/ai/task.js');
const S = require('../../extension/ai/schema.js');
const K = require('../../extension/ai/local/tokenizer.js');
const H = require('../../extension/ai/local/host.js');
const G = require('../../extension/ai/local/grammar.js');
const L = require('../../extension/ai/local/link.js');
const LOCAL = require('../../extension/ai/providers/local.js');

const BYTE = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  return Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++));
})();
const VOCAB = (() => {
  const tokens = [...BYTE], types = tokens.map(() => 1);
  for (const [t, ty] of [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['</think>', 4]]) { tokens.push(t); types.push(ty); }
  for (let i = 0; i < 20; i++) { tokens.push(`[PAD${i}]`); types.push(5); }
  return { tokens, types, merges: [], pre: 'lfm2', bos: tokens.indexOf('<|startoftext|>'), eos: tokens.indexOf('<|im_end|>') };
})();
const TOK = (() => { const t = K.load(VOCAB); for (const n of K.GLAZE_TOKENS) t.add(n); return t; })();
const ID = { think: TOK.id('<think>'), thought: TOK.id('</think>'), start: TOK.id('<|im_start|>'), eos: TOK.eos, nl: [...TOK.encode('\n')] };
const REASON = 'REASON: the draft repeats a word. ';
const allowed = (mask, id) => !!(mask[id >>> 5] & (1 << (id & 31)));

// ---- the stub engine: after a prompt ending in <think>\n it reasons (REASON, over and over), then </think> once `closes`
// tokens are out (never, without it); after </think> (its own or fed) or any other prompt, `reply`, then the end token. ----
const engine = ({ reply, closes = null, gate, context = 16000 } = {}) => {
  const log = { prefills: [], decodes: [], loads: 0 };
  const E = {
    load: async (g) => {
      log.loads++;
      const tok = K.load(g.kv), thoughts = [...tok.encode(REASON)], answer = [...tok.encode(reply)];
      let seq = [], phase = 'answer', i = 0;
      return {
        context,
        prefill: async (ids, { snapshot, signal } = {}) => {
          if (signal?.aborted) throw signal.reason;
          log.prefills.push([...ids]); seq.push(...ids);
          const tail = seq.slice(-1 - ID.nl.length);
          phase = tail[0] === ID.think && tail.slice(1).every((x, k) => x === ID.nl[k]) ? 'think' : 'answer';
          i = 0;
          return snapshot ? { pos: seq.length, drop() {} } : undefined;
        },
        decode: async ({ mask, signal } = {}) => {
          const n = log.decodes.length + 1;
          if (gate) await gate(signal, n, phase);
          if (signal?.aborted) throw signal.reason;
          let id;
          if (phase === 'think') {
            id = closes !== null && i >= closes ? ID.thought : thoughts[i % thoughts.length];
            i++;
            if (id === ID.thought) { phase = 'answer'; i = 0; }
          } else id = i < answer.length ? answer[i++] : tok.eos;
          log.decodes.push({ id, phase: id === ID.thought ? 'think' : phase, mask: mask || null });
          if (mask && !allowed(mask, id)) throw new Error(`stub: the mask refused ${id} in ${phase}`);
          seq.push(id);
          return id;
        },
        snapshot: async () => ({ pos: seq.length, drop() {} }),
        restore: async (s) => { seq = seq.slice(0, s.pos); },
        release: () => {},
      };
    },
  };
  return { E, log };
};

const MODELS = [
  { id: 'glaze-q4', name: 'Glaze Q4', size: 1100000000, quant: 'Q4_K_M', tier: 1, license: 'lfm1.0' },
  { id: 'glaze-q8', name: 'Glaze Q8', size: 1800000000, quant: 'Q8_0', tier: 2, license: 'lfm1.0' },
  { id: 'lfm3-q4', name: 'LFM3 Q4', size: 1100000000, quant: 'Q4_K_M', tier: 3, license: 'lfm1.0', stock: true },
];
const unref = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; };
// ms: what the host's clock moves each time it is read, so each decode takes ms: 10 ms reads as 100 tokens a second.
const setup = ({ here = { 'glaze-q4': 'ready', 'glaze-q8': 'ready', 'lfm3-q4': 'ready' }, rates, reply = '{"text":"hello there"}', closes, gate, grammar = G, ms = 10, ladder = null, context } = {}) => {
  const eng = engine({ reply, closes, gate, context }), posted = [], runs = [], saved = [];
  let clock = 0;
  const st = {
    list: async () => MODELS.map((m) => ({ ...m, state: here[m.id] || 'missing' })),
    status: async (id) => ({ state: here[id] || 'missing' }),
    open: async (id) => ({ id, size: 1, read: async () => new Uint8Array(0) }),
    download: async (id, { onProgress }) => { here[id] = 'ready'; onProgress(1); return { state: 'ready' }; },
    remove: async (id) => { delete here[id]; },
  };
  class FakeWorker {
    constructor() {
      this.host = H.create({ store: st, gguf: { open: async () => ({ kv: VOCAB }) }, tokenizer: K, engine: () => eng.E, grammar: () => grammar,
        ladder: () => ladder, gpu: () => ({ requestAdapter: async () => ({}) }), setTimeout: unref, now: () => (clock += typeof ms === 'function' ? ms() : ms),
        post: (m) => { posted.push(structuredClone(m)); setImmediate(() => this.onmessage?.({ data: structuredClone(m) })); } });
    }
    postMessage(m) { const d = structuredClone(m); if (d.op === 'run') runs.push(d); setImmediate(() => this.host.handle(d)); }
    terminate() {}
  }
  const link = L.create({ runtime: { getURL: (f) => `moz-extension://x/${f}` }, Worker: FakeWorker, keep: () => {}, setTimeout: unref });
  const stored = rates ? { aiLocalRates: structuredClone(rates) } : {};
  const session = { get: async (keys) => Object.fromEntries([keys].flat().map((k) => [k, stored[k]])),
    set: async (o) => { Object.assign(stored, structuredClone(o)); saved.push(structuredClone(o)); } };
  const env = { store: st, link, gpu: () => ({}), session };
  LOCAL._env(env);
  return { eng, posted, runs, saved, env };
};
const SCHEMA = S.obj({ text: S.str('The text.') }, ['text']);
const task = (id) => T.define({ id, version: 1, input: (raw) => raw, check: (o) => o, output: SCHEMA,
  build: (input, { text }) => text.request({ system: 'Answer.', data: [{ label: 'text', text: input.text }], ...(input.maxTokens && { maxTokens: input.maxTokens }) }) });
const REVIEW = task('writer.review'), REQS = task('writer.requirements');
const request = (t, input) => ({ ...T.prepare(t, input, { provider: LOCAL, cfg: {} }), task: { id: t.id, version: t.version } });
const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const FAST = { 'glaze-q4': 100, 'glaze-q8': 100 };
const fed = (s) => TOK.decode(s.eng.log.prefills.flat(), { specials: true });
test.afterEach(() => LOCAL._env(null));

test('think mode: the prompt ends <think>\\n, the model reasons until its own </think>, and the answer follows with nothing fed between', async () => {
  const s = setup({ rates: FAST, closes: 12 });
  const deltas = [];
  const r = await P.run('local', request(REVIEW, { text: 'the the cat' }), LOCAL.config({}), { onDelta: (d) => deltas.push(d) });
  assert.deepEqual(r.json, { text: 'hello there' });
  assert.ok(fed(s).endsWith('<|im_start|>assistant\n<think>\n'), fed(s).slice(-60));
  assert.deepEqual(s.runs[0].think, { budget: LOCAL.THINK['writer.review'], close: [{ text: '\n' }, { special: '</think>' }], after: [] });
  assert.equal(s.runs[0].window, LOCAL.TUNED);
  const think = s.eng.log.decodes.filter((d) => d.phase === 'think');
  assert.equal(think.length, 13, 'twelve reasoning tokens and the model\'s </think>');
  assert.equal(think.at(-1).id, ID.thought);
  assert.equal(s.eng.log.prefills.length, 2, 'the system turn and the rest; nothing fed after the model\'s own </think>');
  assert.equal(r.usage.output, s.eng.log.decodes.length, 'the reasoning counts as output');
  assert.equal(deltas.join(''), '{"text":"hello there"}');
});

test('at the budget the host writes \\n</think> itself and the model answers after it', async () => {
  const s = setup({ rates: FAST });
  const r = await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  assert.deepEqual(r.json, { text: 'hello there' });
  const think = s.eng.log.decodes.filter((d) => d.phase === 'think');
  assert.equal(think.length, 256, 'the budget, then no more reasoning');
  assert.ok(!think.some((d) => d.id === ID.thought));
  assert.deepEqual(s.eng.log.prefills.at(-1), [...ID.nl, ID.thought], 'the force-close: a line break, then </think>');
  // A large maxTokens no longer starves the reasoning: the answer gives way to it.
  const t = setup({ rates: FAST });
  await P.run('local', request(REVIEW, { text: 'y', maxTokens: 3400 }), LOCAL.config({}));
  assert.equal(t.eng.log.decodes.filter((d) => d.phase === 'think').length, 256);
  // A prompt near the window leaves the reasoning less: it gives way only where the answer would get under H.LIMIT.answer.
  const close = ID.nl.length + 1, overhead = t.eng.log.prefills[0].length + t.eng.log.prefills[1].length - 1;
  const u = setup({ rates: FAST });
  await P.run('local', request(REVIEW, { text: 'y'.repeat(LOCAL.TUNED - close - H.LIMIT.answer - 100 - overhead) }), LOCAL.config({}));
  assert.equal(u.eng.log.prefills[0].length + u.eng.log.prefills[1].length, LOCAL.TUNED - close - H.LIMIT.answer - 100);
  assert.equal(u.eng.log.decodes.filter((d) => d.phase === 'think').length, 100);
});

// D4 (glaze-plans/lfm-tune/reports/d4-r1.md): writer.review asks 4,096 tokens of answer, the tuned model's whole window, so
// the host cut its reasoning to nothing. FORMAT-v2: the reasoning has its budget beside the answer, all in the window.
test('writer.review thinks at its budget on a Glaze-tuned model, and the prompt, reasoning and answer never pass the window', async () => {
  const RV = require('../../extension/ai/tasks/writer-review.js'), X = require('../../extension/ai/text.js');
  const real = RV.task.build(RV.task.input({ text: 'The the cat sat on the mat. It were happy.', context: {} }), { text: X, caps: LOCAL.caps({}) });
  assert.equal(real.maxTokens, 4096);
  const s = setup({ rates: FAST, reply: '{"issues":[]}' });
  const r = await P.run('local', { ...real, schema: RV.OUTPUT, task: { id: 'writer.review', version: RV.task.version } }, LOCAL.config({}));
  assert.deepEqual(r.json, { issues: [] });
  assert.equal(s.runs[0].think.budget, 256);
  assert.equal(s.runs[0].window, LOCAL.TUNED);
  assert.equal(s.eng.log.decodes.filter((d) => d.phase === 'think').length, 256, 'the whole budget');
  // An answer that would run on: the window holds the prompt, the close, the reasoning and the answer, and no more.
  const LONG = T.define({ id: 'writer.review', version: 9, input: (raw) => raw, check: (o) => o, output: 'text',
    build: (input, { text }) => text.request({ system: 'Answer.', data: [{ label: 'text', text: input.text }], maxTokens: 4096 }) });
  for (const text of ['x', 'x'.repeat(2500)]) {
    const t = setup({ rates: FAST, reply: 'a'.repeat(5000) });
    const out = await P.run('local', request(LONG, { text }), LOCAL.config({}));
    const fed = t.eng.log.prefills.flat().length, thought = t.eng.log.decodes.filter((d) => d.phase === 'think').length;
    assert.equal(thought, 256);
    assert.equal(out.finish, 'length');
    assert.equal(fed + t.eng.log.decodes.length, LOCAL.TUNED, `${text.length}: exactly the window`);
  }
  // A stock model has no trained window to share: its answer keeps the whole maxTokens.
  const st = setup({ here: { 'lfm3-q4': 'ready' }, rates: FAST, reply: 'a'.repeat(5000) });
  await P.run('local', request(LONG, { text: 'x' }), LOCAL.config({}));
  assert.equal(st.eng.log.decodes.length, 4096);
});

test('think mode holds the forced close inside the engine\'s room before any prefill; the trained window is shared by the reasoning and the answer', async () => {
  const req = request(REVIEW, { text: 'x' });
  const F = require('../../extension/ai/local/format.js');
  const clean = require('../../extension/ai/request.js').clean(req);
  const prompt = TOK.encodeWith(F.format(clean, { think: true }).parts).length;
  const close = ID.nl.length + 1;
  // An engine room smaller than the trained window: a close that would pass it is refused, the model untouched.
  for (const maxTokens of [1024 - prompt + 1, 1024 - prompt - close + 1]) {
    const s = setup({ rates: FAST, context: 1024 });
    await assert.rejects(P.run('local', { ...req, maxTokens }, LOCAL.config({})),
      (e) => e.code === 'request-rejected' && e.reason === 'context' && e.context === 1024);
    assert.equal(s.eng.log.prefills.length, 0, 'an oversized run never mutates the model');
    assert.equal(s.eng.log.decodes.length, 0);
  }
  // A maxTokens that fills the window: the reasoning keeps its budget, and the answer gives way to it.
  for (const context of [16000, 1024]) {
    const window = Math.min(context, LOCAL.TUNED), s = setup({ rates: FAST, context, reply: `{"text":"${'a'.repeat(5000)}` }), maxTokens = window - prompt - close;
    await assert.rejects(P.run('local', { ...req, maxTokens }, LOCAL.config({})));
    assert.equal(s.eng.log.decodes.filter((d) => d.phase === 'think').length, Math.min(256, maxTokens - H.LIMIT.answer), `${context}`);
    assert.deepEqual(s.eng.log.prefills.at(-1), [...ID.nl, ID.thought]);
    assert.equal(s.eng.log.prefills.flat().length + s.eng.log.decodes.length, window, 'the answer cut where the window ends');
  }
  // A request planned up to the trained window still runs in think mode, the close inside it.
  const s = setup({ rates: FAST });
  assert.deepEqual((await P.run('local', { ...req, maxTokens: LOCAL.TUNED - prompt }, LOCAL.config({}))).json, { text: 'hello there' });
  assert.equal(s.eng.log.decodes.filter((d) => d.phase === 'think').length, 256);
});

test('the speed gate keeps measured versus estimated rates across worker restarts', async () => {
  // A measured rate is smoothed with the next measurement, even after the worker restarts.
  let ms = 10;
  const s = setup({ rates: null, ms: () => ms });
  await P.run('local', request(REQS, { text: 'x' }), LOCAL.config({}));
  assert.equal(s.saved.at(-1).aiLocalRates['glaze-q4'], 100);
  LOCAL._env(s.env);
  ms = 50;
  await P.run('local', request(REQS, { text: 'x' }), LOCAL.config({}));
  assert.equal(s.saved.at(-1).aiLocalRates['glaze-q4'], 60, 'the saved measurement still participates in smoothing');
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  assert.ok(s.runs.at(-1).think, 'one slow sample does not discard the earlier measured speed');

  // A saved ladder estimate is replaced outright by the first real measurement after a restart.
  const t = setup({ here: {}, rates: null, ladder: { probe: async () => ({ adapter: {} }),
    pick: ({ models }) => ({ id: models[0].id, quants: [{ id: models[0].id, tps: 120 }] }) }, ms: 50 });
  await LOCAL.prepare(LOCAL.config({}));
  LOCAL._env(t.env);
  await P.run('local', request(REQS, { text: 'x' }), LOCAL.config({}));
  assert.equal(t.saved.at(-1).aiLocalRates['glaze-q4'], 20, 'a ladder estimate is not an earlier measurement');
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  assert.equal(t.runs.at(-1).think, undefined);
});

test('the grammar masks the answer only: the reasoning is free text and </think>, never the end token or another control token', async () => {
  const masks = [], advanced = [];
  const grammar = { vocab: (bytes) => ({ n: bytes.length }), compile: (schema, V) => ({ matcher: () => ({
    mask: () => { const m = new Uint32Array(Math.ceil(V.n / 32)).fill(0xffffffff); masks.push(m); return m; }, advance: (id) => advanced.push(id), complete: false, done: false }) }) };
  const s = setup({ rates: FAST, closes: 5, grammar });
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  const think = s.eng.log.decodes.filter((d) => d.phase === 'think'), answer = s.eng.log.decodes.filter((d) => d.phase === 'answer');
  assert.ok(think.every((d) => d.mask && !masks.includes(d.mask)), 'reasoning tokens are not the grammar\'s');
  assert.ok(answer.every((d) => masks.includes(d.mask)), 'every answer token is');
  assert.equal(masks.length, answer.length);
  assert.ok(!advanced.includes(ID.thought), 'the matcher never sees </think>');
  assert.equal(advanced.length, answer.length - 1, 'each answer token but the end token advances the matcher');
  const m = think[0].mask;
  assert.ok(allowed(m, ID.thought) && allowed(m, TOK.encode('R')[0]) && !allowed(m, ID.eos) && !allowed(m, ID.start) && !allowed(m, ID.think));
});

test('the reasoning never reaches a delta, a host message or the result', async () => {
  for (const closes of [7, null]) {
    const s = setup({ rates: FAST, closes, reply: '{"text":"fine"}' });
    const deltas = [];
    const r = await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}), { onDelta: (d) => deltas.push(d) });
    assert.equal(deltas.join(''), '{"text":"fine"}');
    assert.equal(r.text, '{"text":"fine"}');
    const words = JSON.stringify(s.posted);
    assert.ok(!words.includes('REASON') && !words.includes('</think>'), words.slice(0, 300));
  }
});

test('a cancel ends the reasoning or the answer: nothing after it, and the next run goes', async () => {
  for (const at of ['think', 'answer']) {
    let release;
    const gate = (signal, n, phase) => (phase === at && !release && (at === 'think' ? n === 4 : true) ? new Promise((r) => { release = r; signal?.addEventListener('abort', r); }) : null);
    const s = setup({ rates: FAST, closes: 8, gate, reply: '{"text":"a long answer"}' });
    const c = new AbortController(), deltas = [];
    const run = P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}), { signal: c.signal, onDelta: (d) => deltas.push(d) });
    await settle();
    assert.equal(typeof release, 'function', at);
    const n = s.eng.log.decodes.length, before = deltas.length;
    c.abort();
    await assert.rejects(run, (e) => e.code === 'cancelled' || e.category === 'cancelled');
    await settle();
    assert.equal(s.eng.log.decodes.length, n, `${at}: no decode after the cancel`);
    assert.equal(deltas.length, before, `${at}: no delta after the cancel`);
    if (at === 'think') assert.equal(deltas.length, 0);
    assert.ok(s.posted.some((m) => m.type === 'error' && m.error.category === 'cancelled'));
    assert.equal((await P.run('local', request(REQS, { text: 'x' }), LOCAL.config({}))).finish, 'stop');
  }
});

test('the policy: a task the table names thinks on a fast enough tier; other tasks, slow or unmeasured tiers answer directly', async () => {
  const mode = (s) => (s.runs.at(-1).think ? 'think' : 'direct');
  // Per task.
  let s = setup({ rates: FAST });
  await P.run('local', request(REQS, { text: 'x' }), LOCAL.config({}));
  assert.equal(mode(s), 'direct');
  assert.ok(fed(s).endsWith('<|im_start|>assistant\n<think></think>'), 'direct: LFM3\'s empty think block');
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  assert.equal(mode(s), 'think');
  // Per tier: the slower tier's own rate.
  s = setup({ rates: { 'glaze-q4': 100, 'glaze-q8': LOCAL.THINK_TPS - 1 } });
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({ tier: 1 }));
  assert.equal(mode(s), 'think');
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({ tier: 2 }));
  assert.equal(mode(s), 'direct');
  // Unmeasured: direct; the run's measure (100 tokens a second) is kept, in storage.session too, and the next run thinks.
  s = setup({ rates: null });
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({ tier: 1 }));
  assert.equal(mode(s), 'direct');
  assert.equal(s.saved.at(-1).aiLocalRates['glaze-q4'], 100);
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({ tier: 1 }));
  assert.equal(mode(s), 'think');
  // A slow computer's measure: direct from then on.
  s = setup({ rates: null, ms: 100 });
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({ tier: 1 }));
  assert.equal(s.saved.at(-1).aiLocalRates['glaze-q4'], 10);
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({ tier: 1 }));
  assert.equal(mode(s), 'direct');
  // The ladder's estimate at download stands until a run measures.
  s = setup({ here: {}, rates: null, ladder: { probe: async () => ({ adapter: {} }), pick: ({ models }) => ({ id: models[0].id, reason: 'fastest', quants: [{ id: models[0].id, tps: 120 }] }) } });
  assert.equal((await LOCAL.prepare(LOCAL.config({}))).state, 'ready');
  assert.deepEqual(s.saved.at(-1).aiLocalRates, { 'glaze-q4': 120 });
  await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  assert.equal(mode(s), 'think');
});

test('writer.feedback thinks per call: decide, explain and summary; scan and a request without a call answer directly; other tasks as before', async () => {
  const FEEDBACK = task('writer.feedback');
  const s = setup({ rates: FAST });
  const asked = async (t, call) => {
    const req = request(t, { text: 'x' });
    await P.run('local', { ...req, task: { ...req.task, ...(call && { call }) } }, LOCAL.config({}));
    return s.runs.at(-1).think ? 'think' : 'direct';
  };
  for (const call of ['decide', 'explain', 'summary']) {
    assert.equal(await asked(FEEDBACK, call), 'think', call);
    assert.equal(s.runs.at(-1).think.budget, 256, call);
  }
  for (const call of ['scan', undefined, 'constructor']) assert.equal(await asked(FEEDBACK, call), 'direct', String(call));
  assert.equal(await asked(REVIEW), 'think');
  assert.equal(await asked(REVIEW, 'decide'), 'think', 'a task without calls keeps its own budget');
  assert.equal(await asked(REQS), 'direct');
  assert.deepEqual(LOCAL.THINK['writer.feedback'], { decide: 256, explain: 256, summary: 256, scan: 0 });
});

test('a stock model never thinks: its own template\'s <think></think>, however fast', async () => {
  const s = setup({ here: { 'lfm3-q4': 'ready' }, rates: { 'lfm3-q4': 500 }, reply: '{"text":"ok"}' });
  const r = await P.run('local', request(REVIEW, { text: 'x' }), LOCAL.config({}));
  assert.deepEqual(r.json, { text: 'ok' });
  assert.equal(s.runs[0].think, undefined);
  assert.equal(s.runs[0].window, undefined);
  assert.ok(!fed(s).includes('gz_') && fed(s).endsWith('<|im_start|>assistant\n<think></think>'));
  assert.ok(s.eng.log.decodes.every((d) => d.phase === 'answer'));
});
