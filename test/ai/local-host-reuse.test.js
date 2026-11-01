// The engine host keeps one sequence on the GPU between requests (ai/local/host.js with engine.js extend): a follow-up feeds
// only what it adds to the held prompt; a warm-up with `stable` reads the history while the student types and a run stops
// it, keeping what it read; the window grows the engine's room past 16,000 up to 131,072; a low-priority run (writer.complete)
// feeds in small steps with a yield after each and decode yields between tokens; after a think run the host reads the
// answer back as the next request holds it. The real engine.js on the recording WebGPU double (test/fixtures/local-engine.js).
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
const CHUNK = 16;

// script: decode's ids, in order (then the end token); the real model otherwise. → { h (the host), g (the GPU double),
// fed (token ids each forward wrote), extends (each extend call's ids and result), call(m) → the op's result }.
const setup = ({ script = null, chunk = CHUNK } = {}) => {
  const g = gpu(), fed = [], extends_ = [], posted = [];
  const write = g.device.queue.writeBuffer;
  g.device.queue.writeBuffer = function (b, off, data, ...rest) {
    if (b.size === chunk * 4 && ArrayBuffer.isView(data) && data.constructor.name === 'Uint32Array') fed.push(Array.from(data));
    return write.call(this, b, off, data, ...rest);
  };
  const E = {
    load: async (_g, opts) => {
      const m = await g.load(model({ vocab: TOK.size, kinds: ['conv', 'full', 'swa'] }), { ...opts, chunk });
      const extend = m.extend;
      m.extend = async (ids, o) => { const r = JSON.parse(JSON.stringify(await extend(ids, o))); extends_.push({ ids: Array.from(ids), at: o?.at, paced: typeof o?.pace === 'function', ...r }); return r; };
      if (script) { let i = 0; m.decode = async ({ signal } = {}) => { if (signal?.aborted) throw signal.reason; return i < script.length ? script[i++] : TOK.eos; }; }
      return m;
    },
  };
  const store = { list: async () => [{ id: 'm', tier: 1, state: 'ready' }], status: async () => ({ state: 'ready' }), open: async () => ({ size: 1, read: async () => new Uint8Array(0) }) };
  const h = H.create({ store, gguf: { open: async () => ({ kv: {} }) }, tokenizer: { ...K, fromGGUF: () => K.load(VOCAB) }, engine: () => E, grammar: () => null, ladder: () => null,
    gpu: () => ({}), setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, post: (m) => posted.push(m) });
  let id = 0;
  const call = (m) => new Promise((resolve, reject) => {
    const mine = ++id, from = posted.length;
    h.handle({ id: mine, ...m });
    const look = () => {
      const done = posted.slice(from).find((p) => p.id === mine && (p.type === 'done' || p.type === 'error'));
      if (!done) return setImmediate(look);
      if (done.type === 'done') resolve(done.result); else reject(Object.assign(new Error(JSON.stringify(done.error)), done.error));
    };
    look();
  });
  return { h, g, fed, extends: extends_, call, posted };
};
const SYS = [{ special: '<|startoftext|>' }, { special: '<|im_start|>' }, { text: 'system\nYou help a student with their courses. '.repeat(3) }, { special: '<|im_end|>' }, { text: '\n' }];
const user = (blocks, think = false) => [{ special: '<|im_start|>' }, { text: 'user\n' }, ...blocks.flatMap((b) => [{ special: '<|gz_data|>' }, { text: b }, { special: '<|/gz_data|>' }]),
  { special: '<|im_end|>' }, { text: '\n' }, { special: '<|im_start|>' }, { text: 'assistant\n' }, ...(think ? [{ special: '<think>' }, { text: '\n' }] : [{ special: '<think>' }, { special: '</think>' }])];
const req = (blocks, more = {}) => ({ op: 'run', model: 'm', parts: [...SYS, ...user(blocks)], stable: SYS.length, sampler: { temperature: 0 }, maxTokens: 2, ...more });
const count = (fed) => fed.flat().length;
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

test('a follow-up feeds only what it adds to the held prompt, and says how much it reused', async () => {
  const s = setup();
  const first = await s.call(req(['earlier\nStudent: what is due?', 'question\nWhat is due this week?']));
  const n1 = TOK.encodeWith([...SYS, ...user(['earlier\nStudent: what is due?', 'question\nWhat is due this week?'])]).length;
  assert.equal(first.usage.input, n1);
  assert.equal(first.usage.cached, 0);
  s.fed.length = 0;
  const parts = ['earlier\nStudent: what is due?', 'question\nWhat is due this week?', 'tool\n{"items":[]}'];
  const second = await s.call(req(parts));
  const n2 = TOK.encodeWith([...SYS, ...user(parts)]).length;
  // Shared: everything up to the end of the question block (its closing tag, then the new block's opening).
  assert.ok(second.usage.cached >= n1 - 16, `reused ${second.usage.cached} of ${n1}`);
  assert.ok(count(s.fed) <= n2 - second.usage.cached + 2, `fed ${count(s.fed)} for ${n2 - second.usage.cached} new`);
});

test('a history that differs inside a block rewinds to that block\'s opening, not the start', async () => {
  const s = setup();
  await s.call(req(['earlier\nStudent: q1\nRime: a1', 'now\n15:00', 'question\nq2']));
  s.fed.length = 0;
  const r = await s.call(req(['earlier\nStudent: q1\nRime: a1\nStudent: q2\nRime: a2', 'now\n15:02', 'question\nq3']));
  const sys = TOK.encodeWith(SYS).length;
  assert.ok(r.usage.cached > sys, `reused ${r.usage.cached}, the system turn is ${sys}`);
  assert.equal(count(s.fed) <= r.usage.input - r.usage.cached + 2, true);
});

test('a warm-up with stable reads the history after the system turn; the run then feeds only the question', async () => {
  const s = setup();
  const history = ['earlier\nStudent: q1\nRime: a1'];
  const warm = [...SYS, { special: '<|im_start|>' }, { text: 'user\n' }, { special: '<|gz_data|>' }, { text: history[0] }, { special: '<|/gz_data|>' }];
  assert.deepEqual(await s.call({ op: 'warm', model: 'm', parts: warm, stable: SYS.length }), { ok: true });
  const read = TOK.encodeWith(warm).length;
  assert.equal(s.extends.at(-1).ids.length, read);
  s.fed.length = 0;
  const r = await s.call(req([...history, 'question\nAnd next week?']));
  assert.ok(r.usage.cached >= read, `reused ${r.usage.cached} of the ${read} warmed`);
});

test('a run stops a warm-up between steps and keeps what it read', async () => {
  const s = setup();
  s.g.device.queue.onSubmittedWorkDone = () => new Promise((r) => setTimeout(r, 2));
  const long = 'earlier\n' + 'Student: what about the lab?\nRime: it is due Monday.\n'.repeat(40);
  const warm = s.call({ op: 'warm', model: 'm', parts: [...SYS, { special: '<|im_start|>' }, { text: 'user\n' }, { special: '<|gz_data|>' }, { text: long }, { special: '<|/gz_data|>' }], stable: SYS.length });
  const head = TOK.encodeWith(SYS).length;
  while (count(s.fed) < head + 64) await new Promise((r) => setTimeout(r, 1));
  const run = s.call(req([long, 'question\nok?']));
  await assert.rejects(warm, (e) => e.category === 'cancelled');
  const r = await run;
  assert.ok(r.usage.cached >= head + 64, `the run reused the warm-up's ${r.usage.cached}`);
});

test('the window grows the engine\'s room past 16,000, up to 131,072', async () => {
  const s = setup({ chunk: 512 });
  const big = 'x '.repeat(4600);
  const r = await s.call(req([big, big], { window: 32768 }));
  assert.ok(r.usage.input > 16000, `input ${r.usage.input}`);
  await assert.rejects(s.call(req([big, big])), (e) => e.reason === 'context' && e.context === 16000);
  await assert.rejects(s.call(req([big], { window: 1e9, maxTokens: 131072 })), (e) => e.reason === 'context' && e.context === 131072);
});

test('writer.complete runs at low priority: small steps with a yield after each, a cancel within a step', async () => {
  const s = setup();
  const parts = [...SYS.slice(0, 2), { text: 'system\n' }, { special: '<|gz_task:writer.complete|>' }, { text: 'Complete the text.' }, { special: '<|im_end|>' }, { text: '\n' }];
  const r = await s.call({ op: 'run', model: 'm', parts: [...parts, ...user(['document\n' + 'The mitochondria is the powerhouse of the cell. '.repeat(6)])], stable: parts.length, sampler: { temperature: 0 }, maxTokens: 2 });
  assert.ok(r.usage.input > 100);
  const paced = s.extends.map((e) => e.paced);
  assert.ok(paced.length && paced.every(Boolean), `paced ${paced}`);
  assert.ok(s.fed[0].length <= H.LIMIT.step, 'the first submission feeds a small step');
  // priority 'low' does the same for any task.
  s.extends.length = 0;
  await s.call(req(['question\nhello there, how are you doing today?'], { priority: 'low' }));
  assert.ok(s.extends.every((e) => e.paced));
  // A cancel lands within one step.
  s.g.device.queue.onSubmittedWorkDone = () => new Promise((res) => setTimeout(res, 1));
  s.fed.length = 0;
  const id = 'c';
  s.h.handle({ id, ...req(['question\n' + 'please write a very long answer about cells and energy. '.repeat(20)], { priority: 'low' }) });
  await new Promise((res) => setTimeout(res, 15));
  const before = count(s.fed);
  s.h.handle({ id, op: 'cancel' });
  await settle(200);
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(s.fed.length && count(s.fed) - before <= Math.max(...s.fed.map((f) => f.length)), `fed ${count(s.fed) - before} after the cancel`);
  assert.ok(s.posted.some((p) => p.id === id && p.type === 'error' && p.error.category === 'cancelled'));
});

test('after a think run the host reads the answer back as the next request holds it, and a run stops that', async () => {
  const thought = TOK.id('</think>'), answer = [...TOK.encode('{"text":"hi"}')];
  const s = setup({ script: [...TOK.encode('reason'), thought, ...answer] });
  const think = { budget: 16, close: [{ text: '\n' }, { special: '</think>' }], after: [] };
  const parts = [...SYS, ...user(['question\nhello?'], true)];
  await s.call({ op: 'run', model: 'm', parts, stable: SYS.length, think, sampler: { temperature: 0 }, maxTokens: 32 });
  await settle(100);
  const ids = TOK.encodeWith(parts), open = ids.lastIndexOf(TOK.id('<think>'));
  const back = s.extends.at(-1).ids;
  assert.deepEqual(back, [...ids.slice(0, open), TOK.id('<think>'), thought, ...answer, TOK.eos]);
  // The next turn holds it: only what follows is fed.
  const next = [...parts.slice(0, -2), { special: '<think>' }, { special: '</think>' }, { text: '{"text":"hi"}' }, { special: '<|im_end|>' }, { text: '\n' }, ...user(['question\nthanks!'])];
  const r = await s.call({ op: 'run', model: 'm', parts: next, stable: SYS.length, sampler: { temperature: 0 }, maxTokens: 2 });
  assert.ok(r.usage.cached >= back.length, `reused ${r.usage.cached} of ${back.length}`);
});
