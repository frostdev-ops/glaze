// Context-size tokens on Glaze's own model (owner, 2026-11-01: the model learns its window from a special token, which scales
// its thinking and its answer): <|gz_ctx:4k|> … <|gz_ctx:128k|> on LFM3's reserved rows, never made from text; the token
// right after the task's in the glaze dialect (format.js, agent-tools.js turns), none for a stock model; and the provider's
// per-size think and answer tables (ai/providers/local.js), off by default so Rime r5 runs as it was gated.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../../extension/ai/text.js');
const R = require('../../extension/ai/request.js');
const T = require('../../extension/ai/task.js');
const K = require('../../extension/ai/local/tokenizer.js');
const F = require('../../extension/ai/local/format.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const vocab = require('../helpers/local-vocab.cjs');

const SIZES = ['4k', '8k', '16k', '32k', '64k', '128k'].map((s) => `<|gz_ctx:${s}|>`);
const lfm = () => vocab(require('../fixtures/ai/local-format/vocab.json'));

// ---- the tokens --------------------------------------------------------------------------------------------------------
test('the size tokens and chat.compact\'s are appended to the Glaze table, on LFM3\'s next reserved rows', () => {
  assert.deepEqual(K.GLAZE_TOKENS.slice(16), [...SIZES, '<|gz_task:chat.compact|>']);
  const tok = lfm();
  assert.deepEqual(SIZES.map((t) => tok.id(t)), [125049, 125050, 125051, 125052, 125053, 125054]);
  assert.equal(tok.id('<|gz_task:chat.compact|>'), 125055);
  assert.equal(tok.id('<|gz_task:agent.tools|>'), 125048, 'the earlier ids keep theirs');
  assert.equal(tok.size, 128000, 'the embedding is never resized');
});

test('text never makes a size token or chat.compact\'s, with or without the model\'s specials read', () => {
  const tok = lfm(), mine = [...SIZES, '<|gz_task:chat.compact|>'];
  for (const name of mine) {
    const id = tok.id(name), text = `a ${name} b${name}`;
    for (const specials of [false, true]) {
      const ids = [...tok.encode(text, { specials })];
      assert.ok(ids.every((x) => x < 125033), `${name}, specials ${specials}: no reserved row`);
      assert.equal(tok.decode(ids), text);
    }
    assert.deepEqual([...tok.encodeWith([{ special: name }])], [id]);
    assert.deepEqual([...tok.encodeWith([{ text: name }])], [...tok.encode(name)], 'a text part spelling it stays text');
  }
});

test('a window maps to the largest size token at or under it', () => {
  assert.deepEqual(F.SIZES, [['4k', 4096], ['8k', 8192], ['16k', 16384], ['32k', 32768], ['64k', 65536], ['128k', 131072]]);
  const cases = [[4096, '4k'], [6000, '4k'], [8192, '8k'], [16000, '8k'], [16384, '16k'], [32768, '32k'], [65535, '32k'], [65536, '64k'], [131072, '128k'], [262144, '128k']];
  for (const [w, s] of cases) assert.equal(F.sizeOf(w), `<|gz_ctx:${s}|>`, String(w));
  for (const w of [0, 4095, undefined, NaN, -1]) assert.equal(F.sizeOf(w), null, String(w));
});

// ---- placement ---------------------------------------------------------------------------------------------------------
const SCHEMA = { type: 'object', properties: { minWords: { type: ['integer', 'null'] } }, required: ['minWords'], additionalProperties: false };
const built = () => R.clean({ ...X.request({ system: 'Read the requirements.', context: [{ label: 'course', text: 'Biology 101' }], data: [{ label: 'instructions', text: 'Write 300 words.' }] }),
  schema: SCHEMA, task: { id: 'writer.requirements', version: 1 } });

test('glaze dialect: the size token right after the task token, in the warm prefix; nothing else moves', () => {
  const plain = F.format(built());
  for (const [w, s] of [[4096, '4k'], [16384, '16k']]) {
    for (const think of [false, true]) {
      const base = F.format(built(), { think }), sized = F.format(built(), { think, window: w });
      const at = sized.parts.findIndex((p) => p.special === '<|gz_task:writer.requirements|>');
      assert.deepEqual(sized.parts[at + 1], { special: `<|gz_ctx:${s}|>` });
      assert.deepEqual([...sized.parts.slice(0, at + 1), ...sized.parts.slice(at + 2)], base.parts);
      assert.equal(sized.stable, base.stable + 1, 'the token is in the system turn');
    }
  }
  assert.ok(!JSON.stringify(plain.parts).includes('gz_ctx:'), 'no window, no size token');
});

test('stock models and cloud requests carry no size token', () => {
  assert.throws(() => F.format(built(), { dialect: 'chatml', window: 4096 }), (e) => e.code === 'request', 'a stock model never reads one');
  assert.ok(!JSON.stringify(F.format(built(), { dialect: 'chatml' }).parts).includes('gz_ctx:'));
  // A cloud provider reads the harness's request itself, which never names one.
  assert.ok(!JSON.stringify(built()).includes('gz_ctx:'));
});

const NOW = Date.UTC(2026, 9, 30, 19, 5);
const TODO = { account: 'https://canvas.northfield.edu/4821', at: NOW - 3600000, items: [{ id: '88121', type: 'assignment', courseId: '5521', course: 'BIO 101', title: 'Lab report 3', due: NOW + 86400000 }] };
const raw = (steps = []) => ({ question: 'What is due this week?', tools: ['todo_list', 'schedule_list', 'todo_mark_done'], steps, now: NOW, zone: 'America/Chicago' });
const agentReq = (inp) => R.clean({ ...A.task.build(inp, { text: X }), schema: A.OUTPUT, task: { id: 'agent.tools', version: 1 } });

test('agent.tools\' own turns: layout() and fromRequest() put the size token after the task token, and still round-trip', () => {
  const inp = A.task.input(raw([{ call: { name: 'todo_list', arguments: { days: 7 } }, result: TODO }]));
  const base = A.layout(inp);
  for (const [w, s] of [[4096, '4k'], [16384, '16k']]) {
    const sized = A.layout(inp, { window: w });
    const at = sized.findIndex((p) => p.special === '<|gz_task:agent.tools|>');
    assert.deepEqual(sized[at + 1], { special: `<|gz_ctx:${s}|>` });
    assert.deepEqual([...sized.slice(0, at + 1), ...sized.slice(at + 2)], base);
    assert.deepEqual(A.fromRequest(agentReq(inp), { window: w }), { parts: sized, tools: inp.tools });
    // format.js writes the same turns.
    const f = F.format(agentReq(inp), { window: w });
    assert.deepEqual(f.parts.slice(0, f.stable), sized.slice(0, f.stable));
    assert.equal(f.parts.filter((p) => p.special === `<|gz_ctx:${s}|>`).length, 1);
  }
  assert.deepEqual(A.fromRequest(agentReq(inp)), { parts: base, tools: inp.tools }, 'no window: as before');
  assert.ok(!JSON.stringify(base).includes('gz_ctx:'));
});

// ---- the provider's tables ---------------------------------------------------------------------------------------------
test('the think table per task and size, and the answer reserve per size', () => {
  const think = { '4k': 128, '8k': 256, '16k': 512, '32k': 1024, '64k': 1024, '128k': 1024 };
  assert.deepEqual(LOCAL.THINK_SIZED, { 'agent.tools': think, 'study.help': think });
  assert.deepEqual(LOCAL.ANSWER, { '4k': 512, '8k': 768, '16k': 1024, '32k': 1536, '64k': 2048, '128k': 2048 });
  const on = { token: true, answer: true, think: { 'agent.tools': Object.fromEntries(Object.keys(think).map((s) => [s, true])), 'study.help': Object.fromEntries(Object.keys(think).map((s) => [s, true])) } };
  const at = (id, window, extra = {}) => LOCAL.limits({ id }, window, { scale: on, ...extra });
  assert.deepEqual(at('agent.tools', 4096), { size: '<|gz_ctx:4k|>', think: 128, maxTokens: 512 });
  assert.deepEqual(at('agent.tools', 8192), { size: '<|gz_ctx:8k|>', think: 2048, maxTokens: 768 });
  assert.deepEqual(at('study.help', 16384), { size: '<|gz_ctx:16k|>', think: 4096, maxTokens: 1024 });
  assert.deepEqual(at('study.help', 32768), { size: '<|gz_ctx:32k|>', think: 8192, maxTokens: 1536 });
  assert.deepEqual(at('agent.tools', 131072), { size: '<|gz_ctx:128k|>', think: 32768, maxTokens: 2048 });
  // JSON tasks answer directly at every size.
  for (const w of [4096, 16384, 131072]) assert.equal(at('writer.requirements', w).think, 0);
  // A request asking less keeps its own; one asking more is held to the size's reserve.
  assert.equal(at('agent.tools', 4096, { maxTokens: 300 }).maxTokens, 300);
  assert.equal(at('writer.review', 4096, { maxTokens: 4096 }).maxTokens, 512);
  // Experimental size gates cannot disable the independent adaptive allowance.
  const gated = { ...on, think: { ...on.think, 'study.help': { ...on.think['study.help'], '16k': false } } };
  assert.equal(LOCAL.limits({ id: 'study.help' }, 16384, { scale: gated }).think, 4096);
  assert.equal(LOCAL.limits({ id: 'study.help' }, 8192, { scale: gated }).think, 2048);
});

test('adaptive reasoning grows independently of the size switches, with explicit effort and full answer reserves', () => {
  assert.equal(LOCAL.SCALE.token, false);
  assert.equal(LOCAL.SCALE.answer, false);
  assert.equal(LOCAL.profileWindow(16000, { context: 16000, window: 8192 }), 8192);
  assert.equal(LOCAL.profileWindow(16000, { context: 16000 }), 16000, 'nothing saved: the 64K default, narrowed by the context');
  assert.equal(LOCAL.profileWindow(131072, {}), LOCAL.DEFAULT_WINDOW);
  assert.equal(LOCAL.profileWindow(16000, { context: 16000, window: 8192, reasoning: false }), 16000);
  assert.equal(T.reserved(LOCAL, agentReq(A.task.input(raw())), 16000, { context: 16000, window: 4096 }, 100), 768, 'admission keeps the selected direct window and its direct prelude');
  assert.equal(T.reserved(LOCAL, agentReq(A.task.input(raw())), 16000, { context: 16000, window: 8192 }, 100), 768 + 2048 + 2, 'context cannot enlarge the selected adaptive profile');
  for (const t of ['agent.tools', 'study.help']) assert.ok(Object.values(LOCAL.SCALE.think[t]).every((v) => v === false), t);
  for (const w of [4096, 8192, 16384, 32768, 65536, 131072]) {
    for (const id of ['agent.tools', 'study.help', 'writer.review']) {
      const think = id !== 'writer.review' && w > 4096 ? Math.min(32768, w / 4) : 0;
      assert.deepEqual(LOCAL.limits({ id }, w), { size: null, think, maxTokens: 1024 }, `${id} ${w}`);
      assert.deepEqual(LOCAL.limits({ id }, w, { maxTokens: 768 }), { size: null, think, maxTokens: 768 });
      assert.equal(LOCAL.limits({ id }, w, { effort: 'none' }).think, 0);
      assert.equal(LOCAL.limits({ id }, w, { reasoning: false }).think, 0);
      assert.equal(LOCAL.limits({ id }, w, { effort: 'medium' }).think, think / 2);
      const promptTokens = w - 800;
      assert.deepEqual(LOCAL.limits({ id }, w, { maxTokens: 768, promptTokens }), { size: null, think: Math.min(think, think ? 30 : 0), maxTokens: 768 });
      assert.equal(T.reserved(LOCAL, agentReq(A.task.input(raw())), w, { context: w, effort: 'none' }, 100), 768);
    }
  }
});

// The provider end to end, with a link that records what each run sends.
const MODELS = [{ id: 'glaze-q4', tier: 1, size: 1, state: 'ready' }, { id: 'lfm3-q4', tier: 3, size: 1, state: 'ready', stock: true }];
const setup = (scale) => {
  const runs = [];
  const link = { kind: 'offscreen', up: true, call: async (op, payload) => { if (op !== 'run') return {}; runs.push(payload);
    return { text: payload.tools ? A.native.text({ name: 'todo_list', arguments: { days: 7 } }) : '{"call":{"name":"todo_list","arguments":{"days":7}},"answer":null}', finish: 'stop' }; } };
  const session = { get: async () => ({ aiLocalRates: { 'glaze-q4': 100, 'lfm3-q4': 100 }, aiLocalMeasured: [] }), set: async () => {} };
  LOCAL._env({ store: { list: async () => MODELS }, link, gpu: () => ({}), session, ...(scale && { scale }) });
  return runs;
};
test.afterEach(() => LOCAL._env(null));
// The 4K profile, chosen: the default is 64K (test/ai/local-default-window.test.js).
const agentRun = (weights) => T.run(A.task, raw(), { provider: LOCAL, cfg: { model: 'glaze-local', weights, window: LOCAL.TUNED } });

test('as shipped, the provider sends Rime r5\'s requests unchanged: no size token, direct, the task\'s maxTokens', async () => {
  const runs = setup(null);
  await agentRun('glaze-q4');
  const [sent] = runs;
  assert.ok(!JSON.stringify(sent.parts).includes('gz_ctx:'));
  assert.equal(sent.think, undefined);
  assert.equal(sent.maxTokens, 768);
  assert.equal(sent.window, LOCAL.TUNED);
  await T.run(A.task, raw(), { provider: LOCAL, cfg: { weights: 'glaze-q4', window: 65536 } });
  assert.equal(runs.at(-1).think.budget, 16384, 'the task uses the selected adaptive profile');
  assert.ok(runs.at(-1).think.ms > 299000 && runs.at(-1).think.ms <= 300000, 'the whole task and provider get the larger deadline');
  await T.run(A.task, raw(), { provider: LOCAL, cfg: { weights: 'glaze-q4', window: 65536 }, over: { effort: 'high', maxTokens: 900, timeoutMs: 1000 } });
  assert.equal(runs.at(-1).think.budget, 0, 'the explicit shorter deadline remains authoritative');
  assert.equal(runs.at(-1).maxTokens, 900, 'local effort does not inflate or consume the configured answer reserve');
  await T.run(A.task, raw(), { provider: LOCAL, cfg: { weights: 'glaze-q4', window: 65536 }, over: { effort: 'none' } });
  assert.equal(runs.at(-1).think, undefined, 'a task override can explicitly disable local reasoning');
});

test('switched on, a tuned model gets its window\'s size token (TUNED: 4k), the 4k think budget and answer reserve; a stock model none', async () => {
  const all = (v) => ({ '4k': v, '8k': v, '16k': v, '32k': v, '64k': v, '128k': v });
  const runs = setup({ token: true, answer: true, think: { 'agent.tools': all(true), 'study.help': all(true) } });
  await agentRun('glaze-q4');
  const [sent] = runs, text = sent.parts.map((p) => p.special ?? p.text).join('');
  assert.ok(text.includes('<|gz_task:agent.tools|><|gz_ctx:4k|>'), text.slice(0, 80));
  assert.equal(sent.think.budget, 128);
  assert.equal(sent.maxTokens, 512);
  assert.equal(sent.window, 4096);
  await agentRun('lfm3-q4');
  assert.ok(!JSON.stringify(runs[1].parts).includes('gz_'), 'the stock model reads its own template');
  assert.equal(runs[1].think, undefined);
});

test('size tokens and reasoning follow the configured provider window below the model ceiling', async () => {
  const runs = setup({ token: true, answer: true, think: { 'agent.tools': { '4k': true } } });
  await T.run(A.task, raw(), { provider: LOCAL, cfg: { model: 'glaze-local', weights: 'glaze-q4', context: 2000 } });
  const [sent] = runs;
  assert.equal(sent.window, 2000);
  assert.ok(!JSON.stringify(sent.parts).includes('gz_ctx:'), 'a sub-4K window cannot claim 4K');
  assert.equal(sent.think, undefined, 'the 4K reasoning gate does not apply to a smaller window');
});
