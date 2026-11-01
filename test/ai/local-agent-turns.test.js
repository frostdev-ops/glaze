// agent.tools on Glaze's own model (ai/providers/local.js): the provider writes a run's request in the task's own turns
// (ai/local/format.js, FORMAT v2's prefills), holds the turn to the answer or one offered call (agent-tools.js constraint(),
// the host's grammar), thinks for THINK's budget on a Glaze-tuned model this computer decodes fast enough, and reads a native
// call back as the task's JSON. A stock model reads the harness's messages, held to the task's schema. The link to the host
// is a stand-in that records what each run sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../extension/ai/task.js');
const F = require('../../extension/ai/local/format.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const A = require('../../extension/ai/tasks/agent-tools.js');

const NOW = Date.UTC(2026, 9, 30, 19, 5);
const TODO = { account: 'https://canvas.northfield.edu/4821', at: NOW - 3600000, items: [{ id: '88121', type: 'assignment', courseId: '5521', course: 'BIO 101', title: 'Lab report 3', due: NOW + 86400000 }] };
const raw = (steps = []) => ({ question: 'What is due this week?', tools: ['todo_list', 'schedule_list', 'todo_mark_done'], steps, now: NOW, zone: 'America/Chicago' });
const MODELS = [
  { id: 'glaze-q4', tier: 1, size: 1, state: 'ready' },
  { id: 'lfm3-q4', tier: 3, size: 1, state: 'ready', stock: true },
];

const setup = ({ reply, rate = 100 } = {}) => {
  const runs = [];
  const link = { kind: 'offscreen', up: true, call: async (op, payload) => { if (op !== 'run') return {}; runs.push(payload); return { text: reply, finish: 'stop', usage: { input: 10, output: 5 } }; } };
  const session = { get: async () => ({ aiLocalRates: { 'glaze-q4': rate, 'lfm3-q4': rate }, aiLocalMeasured: [] }), set: async () => {} };
  LOCAL._env({ store: { list: async () => MODELS }, link, gpu: () => ({}), session });
  return runs;
};
const run = (weights, input = raw()) => T.run(A.task, input, { provider: LOCAL, cfg: { model: 'glaze-local', weights } });

test('a tuned model: the task\'s turns, the answer or one offered call, THINK\'s budget; a native call comes back as the task\'s JSON', async () => {
  const runs = setup({ reply: A.native.text({ name: 'todo_list', arguments: { days: 7 } }) });
  const out = await run('glaze-q4');
  assert.deepEqual(out.output, { call: { name: 'todo_list', arguments: { days: 7 }, kind: 'read' }, answer: null });
  const [sent] = runs, inp = A.task.input(raw());
  assert.deepEqual(sent.schema, A.ANSWER, 'the answer\'s schema, not the task\'s');
  assert.deepEqual(sent.tools, A.constraint(inp).tools, 'one call to an offered tool');
  assert.equal(sent.think.budget, LOCAL.THINK['agent.tools']);
  assert.equal(sent.think.budget, 256);
  assert.deepEqual(sent.parts.slice(0, sent.stable), A.layout(inp).slice(0, sent.stable));
  assert.ok(sent.parts.map((p) => p.special ?? p.text).join('').endsWith('<|im_start|>assistant\n<think>\n'), 'think mode\'s prefill');
  assert.deepEqual(sent.think.close, [...F.CLOSE]);
  assert.equal(sent.maxTokens, 768);
  assert.equal(sent.window, LOCAL.TUNED);
});

test('an answer in the task\'s JSON passes through; history steps are earlier calls; a slow computer answers directly', async () => {
  const runs = setup({ reply: '{"text":"Lab report 3 for BIO 101 is due Saturday.","quotes":["Lab report 3","BIO 101"]}', rate: 10 });
  const out = await run('glaze-q4', raw([{ call: { name: 'todo_list', arguments: { days: 7 } }, result: TODO }]));
  assert.deepEqual(out.output.answer, { text: 'Lab report 3 for BIO 101 is due Saturday.', quotes: ['Lab report 3', 'BIO 101'] });
  const [sent] = runs, text = sent.parts.map((p) => p.special ?? p.text).join('');
  assert.equal(sent.think, undefined, 'below THINK_TPS: direct');
  assert.ok(text.includes('<|im_start|>assistant\n<think></think><tool_call>'), 'the history\'s call opens with an empty think block');
  assert.ok(text.endsWith('<|im_start|>assistant\n<think></think>'));
});

test('words that are neither a call nor the answer are an invalid response, never guessed at', async () => {
  setup({ reply: 'Lab report 3 is due.' });
  await assert.rejects(run('glaze-q4'), (e) => e.code === 'invalid-response' || e.category === 'invalid-response');
});

test('a stock model reads the harness\'s messages in its own chat template, held to the task\'s schema, and never thinks', async () => {
  const runs = setup({ reply: '{"call":null,"answer":{"text":"Nothing is due.","quotes":[]}}' });
  const out = await run('lfm3-q4');
  assert.deepEqual(out.output.answer, { text: 'Nothing is due.', quotes: [] });
  const [sent] = runs;
  assert.deepEqual(sent.schema, A.OUTPUT);
  assert.equal(sent.tools, undefined);
  assert.equal(sent.think, undefined);
  assert.equal(sent.window, undefined);
  const text = sent.parts.map((p) => p.special ?? p.text).join('');
  assert.ok(text.startsWith('<|startoftext|><|im_start|>system\n') && !text.includes('<|gz_task:') && text.endsWith('<|im_start|>assistant\n<think></think>'), 'LFM3\'s template, thinking off');
});
