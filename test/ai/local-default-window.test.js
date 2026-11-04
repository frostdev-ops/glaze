// Rime's default context size (owner, 2026-11-04: "Make 64k default"): a Glaze-tuned model with no saved size runs at
// 64K, or the largest size the ladder admits on this computer; a saved size, 4K included, is kept exactly; a stock
// model keeps its own window. The default runs exactly as a saved 64K does.
const test = require('node:test');
const assert = require('node:assert/strict');
const LADDER = require('../../extension/ai/local/ladder.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const R = require('../../extension/ai/request.js');
const X = require('../../extension/ai/text.js');
const T = require('../../extension/ai/task.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');

const Q4 = { id: 'rime-q4', tier: 1, size: 1099627232, tools: 3, memory: 1, state: 'ready' };
const Q8 = { id: 'rime-q8', tier: 4, size: 1846237920, tools: 3, memory: 1, state: 'ready' };
const R9 = { ...Q4, id: 'rime-r9-q4', scale: 1 };
const setup = (model, machine) => {
  const calls = [];
  const session = { get: async () => ({ aiLocalRates: { [model.id]: 100 }, aiLocalMeasured: [] }), set: async () => {} };
  LOCAL._env({ store: { list: async () => [model] }, gpu: () => ({}), session, ...(machine && { machine: async () => machine }),
    link: { kind: 'worker', up: true, call: async (op, args) => { calls.push({ op, args: structuredClone(args) }); return op === 'warm' ? { ok: true } : { text: 'done', finish: 'stop' }; } } });
  return calls;
};
test.afterEach(() => LOCAL._env(null));
const FIXED = { ...X, request: (o) => X.request({ ...o, fence: X.fence('DATA-000000000000') }) };
const req = (id) => ({ ...R.clean(FIXED.request({ system: 'Help the student.', data: [{ label: 'note', text: 'hello' }] })), task: { id, version: 1 } });
const agentReq = (cfg) => R.clean({ ...T.prepare(A.task, { question: 'What is due this week?', tools: ['run_js'], now: Date.UTC(2026, 10, 3), zone: 'UTC' }, { provider: LOCAL, cfg }), task: { id: 'agent.tools', version: 1 } });
const runOf = (calls) => calls.filter((c) => c.op === 'run').at(-1).args;
const window = async (model, machine, raw = {}) => {
  setup(model, machine);
  return (await LOCAL.catalog(LOCAL.config(raw))).models[0].context.window;
};

test('the default is 64K, kept apart from the 4K the training data was planned for', () => {
  assert.equal(LADDER.DEFAULT_WINDOW, 65536);
  assert.equal(LOCAL.DEFAULT_WINDOW, 65536);
  assert.equal(LOCAL.TUNED, 4096);
  assert.equal(LOCAL.config({}).window, undefined, 'nothing saved stays unsaved');
});

test('the ladder steps the default down to the largest size this computer admits, never below 4K', () => {
  assert.equal(LADDER.defaultWindow(Q4, {}), 65536, 'no deviceMemory said: 64K');
  assert.equal(LADDER.defaultWindow(Q4, { f16: true, deviceMemory: 8 }), 65536);
  for (const [model, o] of [[Q4, { f16: false, deviceMemory: 4 }], [Q8, { f16: true, deviceMemory: 4 }], [Q8, { f16: false, deviceMemory: 4 }], [Q8, { f16: true, deviceMemory: 2 }]]) {
    const ok = LADDER.windows(model, o).filter((w) => !w.refused && w.size <= 65536).map((w) => w.size);
    assert.equal(LADDER.defaultWindow(model, o), ok.length ? Math.max(...ok) : 4096, JSON.stringify(o));
  }
  assert.ok(LADDER.defaultWindow(Q8, { f16: false, deviceMemory: 4 }) < 65536, 'a 4 GB machine without f16 steps down');
  assert.equal(LADDER.defaultWindow(Q8, { f16: true, deviceMemory: 0.5 }), 4096);
});

test('with nothing saved, a tuned model runs at the default, stepped down by this computer\'s memory', async () => {
  assert.equal(await window(Q4), 65536);
  assert.deepEqual((await LOCAL.catalog(LOCAL.config({}))).models[0].context, { window: 65536, inputLimit: 65536 });
  const small = { f16: false, deviceMemory: 4 };
  assert.equal(await window(Q8, small), LADDER.defaultWindow(Q8, small));
  const calls = setup(Q8, small);
  await LOCAL.run(req('writer.complete'), LOCAL.config({}), {});
  assert.equal(runOf(calls).window, LADDER.defaultWindow(Q8, small), 'a run never asks for more than the machine admits');
});

test('a saved size is kept exactly, 4K included, whatever the machine', async () => {
  assert.equal(LOCAL.config({ window: 4096 }).window, 4096, '4K is stored once chosen');
  for (const size of [4096, 8192, 65536, 131072]) {
    assert.equal(await window(Q4, undefined, { window: size }), size, String(size));
    assert.equal(await window(Q8, { f16: false, deviceMemory: 4 }, { window: size }), size, `${size}, small machine`);
  }
  const calls = setup(Q4);
  await LOCAL.run(req('study.help'), LOCAL.config({ window: 4096, context: 4096 }), {});
  const run = runOf(calls);
  assert.equal(run.window, 4096);
  assert.equal(run.think, undefined, '4K stays the direct profile');
});

test('a stock model keeps its own window', async () => {
  assert.equal(await window({ ...Q4, stock: true }), LOCAL.CONTEXT);
  assert.equal(await window({ ...Q4, stock: true }, { f16: false, deviceMemory: 2 }), LOCAL.CONTEXT);
});

test('the default plans and runs exactly as a saved 64K', async () => {
  assert.equal(LOCAL.profileWindow(LOCAL.CONTEXT, LOCAL.config({})), 65536);
  assert.equal(LOCAL.adaptive({ id: 'study.help' }, 65536), 16384);
  for (const id of ['study.help', 'agent.tools', 'writer.complete']) {
    const ran = [];
    for (const raw of [{}, { window: 65536 }]) {
      const calls = setup(Q4);
      const cat = await LOCAL.catalog(LOCAL.config(raw));
      const cfg = LOCAL.config({ ...raw, context: cat.models[0].context.window });
      try { await LOCAL.run(id === 'agent.tools' ? agentReq(cfg) : req(id), cfg, {}); } catch { /* the payload is what matters */ }
      const run = runOf(calls);
      if (run.think) delete run.think.ms;
      ran.push(run);
    }
    assert.deepEqual(ran[0], ran[1], id);
    assert.equal(ran[0].window, 65536, id);
    if (id !== 'writer.complete') assert.ok(ran[0].think?.budget > 0, `${id} reasons adaptively at the default`);
  }
});

test('a scale: 1 model sends the 64K size token at the default', async () => {
  const calls = setup(R9);
  await LOCAL.run(req('writer.complete'), LOCAL.config({}), {});
  const run = runOf(calls);
  assert.equal(run.window, 65536);
  assert.ok(run.parts.some((p) => p.special === '<|gz_ctx:64k|>'), JSON.stringify(run.parts.slice(0, 6)));
  const plain = setup(Q4);
  await LOCAL.run(req('writer.complete'), LOCAL.config({}), {});
  assert.ok(!JSON.stringify(runOf(plain).parts).includes('gz_ctx:'), 'a model without scale: 1 sends none');
});

test('browser smoke checks keep context sizing when they replace the hardware probe', async (t) => {
  const root = path.join(__dirname, '../../extension');
  const provider = path.join(root, 'ai/providers/local.js');
  for (const check of ['local-provider-check.js', 'model-updates-check.js']) await t.test(check, async () => {
    const source = fs.readFileSync(path.join(__dirname, '../../checks/ai', check), 'utf8');
    const start = source.indexOf('const LADDER =');
    assert.ok(start >= 0, 'the check stages its ladder');
    const staged = vm.runInNewContext(`${source.slice(start, source.indexOf('\n\n', start))}\nLADDER`, { fs, path, root });
    const local = vm.runInNewContext(`${staged}\n${fs.readFileSync(provider, 'utf8')}`, {
      require: createRequire(provider), GZ_AI_PROVIDERS: { add: (p) => p }, GZ_AI_REQUEST: R, navigator: { deviceMemory: 4 },
    });
    const calls = [];
    local._env({ store: { list: async () => [Q4] }, gpu: () => ({ requestAdapter: async () => ({ features: new Set() }) }),
      link: { kind: 'worker', call: async (op, args) => {
        calls.push({ op, args });
        return op === 'count' ? { tokens: 100 } : op === 'warm' ? { ok: true } : { text: 'done', finish: 'stop' };
      } } });
    const cfg = local.config({});
    const expected = LADDER.defaultWindow(Q4, { f16: false, deviceMemory: 4 });
    assert.equal((await local.catalog(cfg)).models[0].context.window, expected);
    assert.equal(await local.count(req('writer.complete'), cfg), 100);
    assert.equal(await local.warm(req('writer.complete'), cfg), true);
    await local.run(req('writer.complete'), cfg);
    assert.equal(calls.find((c) => c.op === 'warm').args.window, expected);
    assert.equal(runOf(calls).window, expected);
  });
});
