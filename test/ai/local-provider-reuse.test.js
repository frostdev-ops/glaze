// The provider keeps the host's context, warm-history and cache contracts intact across the worker boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const LOCAL = require('../../extension/ai/providers/local.js');
const P = require('../../extension/ai/providers.js');
const R = require('../../extension/ai/request.js');
const X = require('../../extension/ai/text.js');
const F = require('../../extension/ai/local/format.js');
const MODEL = { id: 'rime-q4', tier: 1, state: 'ready' };
const setup = (model = MODEL, usage = { input: 100, output: 2, cached: 64 }, scale = null) => {
  const calls = [];
  LOCAL._env({ store: { list: async () => [model] }, gpu: () => ({}), ...(scale && { scale }),
    link: { kind: 'worker', up: true, call: async (op, args) => {
      calls.push({ op, args });
      if (op === 'count') return { tokens: args.parts.reduce((n, p) => n + (p.text?.length || 1), 0) };
      return op === 'warm' ? { ok: true } : { text: 'ok', finish: 'stop', usage };
    } } });
  return calls;
};
const req = (id = 'writer.complete') => ({ ...R.clean(X.request({ system: 'Help the student.', data: [{ label: 'history', text: 'Earlier question and answer.' }, { label: 'draft', text: 'Today' }] })), task: { id, version: 1 } });
test.afterEach(() => LOCAL._env(null));

test('the provider cap admits the full 128K window and keeps stock input limits integral', async () => {
  const calls = setup();
  assert.equal(LOCAL.CONTEXT, 131072);
  assert.equal(LOCAL.limits({ id: 'writer.review' }, 131072, { maxTokens: 32768 }).maxTokens, 32768);
  await LOCAL.run(req(), { window: 131072, context: 131072 });
  assert.equal(calls.at(-1).args.window, 131072);
  assert.deepEqual(LOCAL.windowOf({ stock: true }), { window: 131072, inputLimit: 117964 });
});

test('warm sends the complete formatted prompt, stable boundary and selected room, so the host reads history', async () => {
  const calls = setup(), input = req(), formatted = F.format(input);
  assert.equal(await LOCAL.warm(input, { window: 65536, context: 65536 }), true);
  assert.deepEqual(calls[0], { op: 'warm', args: { model: MODEL.id, parts: formatted.parts, stable: formatted.stable, window: 65536 } });
});

test('completion requests set low priority for stock templates too, other tasks keep foreground priority', async () => {
  const calls = setup({ ...MODEL, stock: true });
  await LOCAL.run(req(), {});
  assert.equal(calls.at(-1).args.priority, 'low');
  assert.equal(calls.at(-1).args.window, 131072, 'the stock catalog and physical room agree');
  await LOCAL.run(req('writer.review'), {});
  assert.equal(calls.at(-1).args.priority, undefined);
});

test('cached prompt usage survives the provider and public harness, including a cold zero', async () => {
  setup();
  assert.deepEqual((await P.run('local', req(), {})).usage, { input: 100, output: 2, cached: 64 });
  setup(MODEL, { input: 100, output: 2, cached: 0 });
  assert.equal((await P.run('local', req(), {})).usage.cached, 0);
  for (const cached of [-1, 1.5, 101]) {
    setup(MODEL, { input: 100, output: 2, cached });
    assert.equal((await P.run('local', req(), {})).usage.cached, undefined, String(cached));
  }
});

const compact = () => {
  const C = require('../../extension/ai/tasks/chat-compact.js');
  const input = C.task.input({ turns: [{ question: 'When is Lab 3 due?', answer: 'Lab 3 is due Monday.' }] });
  return { ...R.clean(C.task.build(input, { text: X })), schema: C.OUTPUT, task: { id: 'chat.compact', version: 1 }, maxTokens: 777, temperature: 0.3 };
};
for (const enabled of [false, true]) test(`compact token gate ${enabled ? 'enabled for evaluation' : 'off for shipped r5'} keeps model, window, counts and sampler`, async () => {
  const model = { ...MODEL, id: 'rime-q8', tier: 2 }, calls = setup(model, undefined, enabled ? { compact: true } : null);
  const input = compact(), cfg = { weights: model.id, window: 8192, context: 8192 };
  const expected = F.format(input, { dialect: enabled ? 'glaze' : 'chatml' });
  const count = await LOCAL.count(input, cfg);
  await LOCAL.run(input, cfg);
  const counted = calls.find((c) => c.op === 'count').args, run = calls.find((c) => c.op === 'run').args;
  assert.deepEqual(run.parts, expected.parts, 'only trained compact dialects reach the model');
  assert.deepEqual(counted.parts, run.parts, 'count measures exactly the prompt run sends');
  assert.equal(count, counted.parts.reduce((n, p) => n + (p.text?.length || 1), 0));
  assert.equal(counted.model, model.id);
  assert.equal(run.model, model.id);
  assert.equal(run.window, 8192);
  assert.equal(run.maxTokens, 777, 'native formatting keeps the tuned model budget');
  assert.deepEqual(run.sampler, { temperature: 0.3 });
  assert.equal(run.think, undefined);
  assert.equal(run.parts.some((p) => p.special === '<|gz_task:chat.compact|>'), enabled);
  assert.equal(LOCAL.SCALE.compact, false);
});

test('the compact gate leaves existing trained tasks in the Glaze dialect', async () => {
  const calls = setup();
  await LOCAL.run(req(), {});
  assert.ok(calls.at(-1).args.parts.some((p) => p.special === '<|gz_task:writer.complete|>'));
});
