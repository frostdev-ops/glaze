// Reading a long prompt (the 2026-11-04 evaluations: 128K, reasoning off, ~98K tokens to prefill) took longer than Glaze's
// 60 s direct deadline on slower GPUs (A6000 12 of 12, RTX PRO 4500 1 of 12 timed out) before the first token. The run's
// deadline now grows by the time this computer takes to read the counted prompt, from the prefill rate the host measures
// (a cautious default before one is measured); short prompts keep the deadline they had. While the host reads a long
// prompt it says so, and the panel shows Reading… then Thinking… instead of one still line.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../extension/ai/task.js');
const LOCAL = require('../../extension/ai/providers/local.js');
require('../../extension/ai/providers.js');
const SH = require('../../extension/ai/tasks/study-help.js');

const REPLY = JSON.stringify({ kind: 'hint', step: null, reply: 'Which step comes first?', followUp: null });
// The provider over a stand-in link: count answers `tokens`, run answers REPLY with the host's fields in `result`.
const setup = ({ tokens, result = {}, events = [] }) => {
  const seen = { timeouts: [], runs: 0 }, session = new Map();
  LOCAL._env({ store: { list: async () => [{ id: 'rime-q4', tier: 1, state: 'ready', tools: 3 }] }, gpu: () => ({}),
    session: { get: async (keys) => Object.fromEntries(keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)])), set: async (v) => { for (const [k, x] of Object.entries(v)) session.set(k, x); } },
    link: { kind: 'worker', up: true, call: async (op, _args, { onEvent } = {}) => {
      const n = typeof tokens === 'function' ? tokens() : tokens;
      if (op === 'count') return { tokens: n };
      seen.runs++;
      for (const e of events) onEvent?.(e);
      return { text: REPLY, finish: 'stop', usage: { input: n, output: 10 }, ...(typeof result === 'function' ? result() : result) };
    } } });
  // The provider as registered, its run watched for the deadline each request carries.
  const provider = { ...LOCAL, run: async (req, cfg, o) => { seen.timeouts.push(req.timeoutMs); return LOCAL.run(req, cfg, o); } };
  return { seen, session, provider, restore: () => { LOCAL._env(null); } };
};
let current;
const ask = (emit, over) => T.run(SH.task, { question: 'How do I start this proof?', subject: 'math' }, { provider: current.provider, cfg: { window: 131072, reasoning: false }, emit, over });

test('a short prompt keeps the 60 s deadline; a long one gets the time to read it, from a cautious default and then the measured rate', async () => {
  let tokens = 2000, result = {};
  const s = current = setup({ tokens: () => tokens, result: () => result });
  try {
    await ask();
    assert.ok(s.seen.timeouts[0] <= 60000 && s.seen.timeouts[0] > 59000, `short: ${s.seen.timeouts[0]}`);
    tokens = 98000;
    await ask();
    assert.ok(s.seen.timeouts[1] > 120000 && s.seen.timeouts[1] <= 300000, `long, nothing measured: ${s.seen.timeouts[1]}`);
    // The host measured this computer reading 98K tokens in 120 s: the next long prompt gets that and a margin.
    result = { prefill: 98000 / 120 };
    await ask();
    result = {};
    await ask();
    assert.ok(s.seen.timeouts[3] >= 60000 + 120000 && s.seen.timeouts[3] <= 300000, `long, measured slow: ${s.seen.timeouts[3]}`);
    assert.ok(s.session.has('aiLocalPrefill'), 'the rate lasts across the worker\'s restarts, as the decode rate does');
    // A fast computer (98K in 12 s) keeps nearly the plain deadline; a short prompt is unchanged whatever was measured.
    result = { prefill: 98000 / 12 };
    await ask(); await ask(); await ask();
    result = {};
    await ask();
    assert.ok(s.seen.timeouts.at(-1) < 90000, `long, measured fast: ${s.seen.timeouts.at(-1)}`);
    tokens = 2000;
    await ask();
    assert.ok(s.seen.timeouts.at(-1) <= 60000, `short again: ${s.seen.timeouts.at(-1)}`);
  } finally { s.restore(); }
});

test('the student\'s own timeout in Settings stays authoritative', async () => {
  const s = current = setup({ tokens: 98000 });
  try {
    await ask(undefined, { timeoutMs: 45000 });
    assert.ok(s.seen.timeouts[0] <= 45000, `${s.seen.timeouts[0]}`);
  } finally { s.restore(); }
});

test('the host\'s reading and thinking phases reach the run\'s events', async () => {
  const s = current = setup({ tokens: 98000, events: [{ type: 'phase', phase: 'reading' }, { type: 'phase', phase: 'thinking' }, { type: 'phase', phase: 'bogus' }] });
  try {
    const seen = [];
    await ask((e) => { if (e.type === 'thinking' && e.phase) seen.push(e.phase); });
    assert.deepEqual(seen, ['reading', 'thinking']);
  } finally { s.restore(); }
});

// ---- the host: phases around a long prompt's prefill, and the prefill rate it measured ------------------------------------
test('the host says reading before a long prompt\'s prefill and thinking after it, and reports the prefill rate; a short prompt says nothing new', async () => {
  const H = require('../../extension/ai/local/host.js'), K = require('../../extension/ai/local/tokenizer.js');
  // The 256 bytes as byte-level BPE writes them (local-provider.test.js's vocabulary, without merges).
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  const tokens = Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++));
  const vocab = { tokens: [...tokens, '<|startoftext|>', '<|im_start|>', '<|im_end|>', '<think>', '</think>', ...Array.from({ length: 32 }, (_, i) => `[PAD${i}]`)],
    types: [...tokens.map(() => 1), 3, 3, 3, 4, 4, ...Array(32).fill(5)], merges: [], pre: 'lfm2' };
  vocab.bos = 256; vocab.eos = 258;
  let clock = 0;
  const engine = { load: async (g) => {
    const tok = K.load(g.kv);
    return { context: 131072,
      prefill: async (seq, { snapshot } = {}) => { clock += seq.length / 2; return snapshot ? { drop: () => {} } : undefined; },
      decode: async () => { clock += 10; return tok.eos; }, snapshot: async () => ({ drop: () => {} }), restore: async () => {}, release: () => {} };
  } };
  const posted = [];
  const host = H.create({ store: { list: async () => [{ id: 'm', tier: 1, state: 'ready' }], open: async (id) => ({ id, size: 1, read: async () => new Uint8Array(0) }) },
    gguf: { open: async () => ({ kv: vocab }) }, tokenizer: K, engine: () => engine, grammar: () => null, gpu: () => ({}), now: () => clock,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, post: (m) => posted.push(structuredClone(m)) });
  const run = async (id, text) => {
    host.handle({ id, op: 'run', model: 'm', parts: [{ text }], stable: 0, window: 131072, maxTokens: 8, sampler: {} });
    for (let i = 0; i < 400 && !posted.some((m) => m.id === id && ['done', 'error'].includes(m.type)); i++) await new Promise(setImmediate);
    return posted.filter((m) => m.id === id);
  };
  const long = await run(1, 'x'.repeat(20000));
  assert.deepEqual(long.filter((m) => m.type === 'phase').map((m) => m.phase), ['reading', 'thinking'], JSON.stringify(long.at(-1)));
  const done = long.find((m) => m.type === 'done');
  assert.ok(done, JSON.stringify(long.at(-1)));
  assert.equal(done.result.prefill, 2000, 'tokens a second over the prefill: two tokens a millisecond here');
  const short = await run(2, 'hello');
  assert.deepEqual(short.filter((m) => m.type === 'phase'), []);
  assert.equal(short.find((m) => m.type === 'done').result.prefill, undefined);
});

// ---- the worker forwards the phase; the panel's thinking line says it ------------------------------------------------------
test('the panel\'s busy line says Reading… while the model reads a long prompt, then Thinking…', async () => {
  const { El } = require('../stand-in-dom.js'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  const doc = { activeElement: null };
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  doc.createElement = (tag) => new El(tag, doc);
  doc.createElementNS = (_ns, tag) => doc.createElement(tag);
  doc.getElementById = (id) => doc.root.all().find((el) => el.id === id) || null;
  doc.querySelector = (s) => doc.root.querySelector(s);
  const ai = { on: true, features: { ask: true } }, listeners = [];
  let asked, finish;
  const port = { onMessage: { addListener: (f) => listeners.push(f) }, onDisconnect: { addListener: () => {} }, disconnect: () => {}, postMessage: (m) => {
    if (m.op === 'status') return setTimeout(() => listeners.forEach((f) => f({ id: m.id, type: 'status', on: true, allowed: true, ready: true })), 0);
    if (m.op !== 'ask') return;
    asked = m.id;
    finish = () => listeners.forEach((f) => f({ id: m.id, type: 'end', task: 'study.help', output: { kind: 'hint', step: null, reply: 'Which step comes first?', followUp: null } }));
  } };
  const send = (ev) => listeners.forEach((f) => f({ id: asked, ...ev }));
  const context = vm.createContext({
    document: doc, window: {}, navigator: { userActivation: { isActive: true } }, setTimeout, clearTimeout, URL, structuredClone,
    GZ_CTX: { t: (k) => k, on: () => true, locale: () => 'en', settings: () => ({ enabled: true }) },
    chrome: { runtime: { connect: () => port }, storage: { local: { get: (_k, cb) => cb({ ai }) }, onChanged: { addListener: () => {} } } },
  });
  const file = (f) => fs.readFileSync(path.join(__dirname, '../../extension/ai/page', f), 'utf8');
  vm.runInContext(file('ask-chat.js'), context);
  const ui = vm.runInContext(file('ask.js'), context);
  const words = () => doc.querySelector('.gz-ask-busy-words')?.textContent;
  const until = async (f) => { for (let n = 0; n < 50 && !f(); n++) await new Promise((r) => setTimeout(r, 2)); return f(); };
  try {
    const done = ui.run({ event: { isTrusted: true }, question: 'How do I start this proof?' });
    assert.ok(await until(() => asked && words()));
    assert.equal(words(), 'Thinking…');
    send({ type: 'phase', phase: 'reading' });
    assert.equal(await until(() => words() === 'Reading…' && words()), 'Reading…');
    send({ type: 'phase', phase: 'thinking' });
    assert.equal(await until(() => words() === 'Thinking…' && words()), 'Thinking…');
    send({ type: 'phase', phase: '<b>x</b>' });
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(words(), 'Thinking…', 'an unknown phase changes nothing');
    finish();
    await done;
    assert.ok(await until(() => doc.querySelector('.gz-ask-a')));
  } finally { doc.getElementById('gz-ask')?.close(); }
});
