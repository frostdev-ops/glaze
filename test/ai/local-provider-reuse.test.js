// The provider keeps the host's context, warm-history and cache contracts intact across the worker boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const LOCAL = require('../../extension/ai/providers/local.js');
const P = require('../../extension/ai/providers.js');
const R = require('../../extension/ai/request.js');
const X = require('../../extension/ai/text.js');
const F = require('../../extension/ai/local/format.js');
const MODEL = { id: 'rime-q4', tier: 1, state: 'ready' };
const setup = (model = MODEL, usage = { input: 100, output: 2, cached: 64 }) => {
  const calls = [];
  LOCAL._env({ store: { list: async () => [model] }, gpu: () => ({}),
    link: { kind: 'worker', up: true, call: async (op, args) => { calls.push({ op, args }); return op === 'warm' ? { ok: true } : { text: 'ok', finish: 'stop', usage }; } } });
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
