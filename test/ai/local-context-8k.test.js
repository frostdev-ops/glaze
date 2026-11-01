// Rime at the 8K context size, end to end from the connection Settings keeps ({ provider: 'local', window: 8192 }) through
// the real broker and local provider to the engine host's link (a stub): the broker's count says the 8K window, the run
// sends window 8192 and, with the size token on, <|gz_ctx:8k|> after the task's; Ask Rime's context event carries 8192.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../extension/ai/broker.js');
const K = require('../../extension/ai/ask.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const AT = require('../../extension/ai/tasks/agent-tools.js');
const C = require('../helpers/mcp-caches.cjs');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 120) => { for (let i = 0; i < n; i++) await tick(); };
const ports = () => {
  const side = () => ({ on: [], gone: [], closed: false });
  const a = side(), b = side();
  const end = (me, other) => ({
    postMessage: (m) => { if (me.closed) throw new Error('closed'); const c = structuredClone(m); setTimeout(() => { if (!other.closed) other.on.forEach((f) => f(c)); }, 0); },
    onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) },
    disconnect: () => { if (me.closed) return; me.closed = true; setTimeout(() => { if (!other.closed) { other.closed = true; other.gone.forEach((f) => f()); } }, 0); },
  });
  return [end(a, b), end(b, a)];
};

const MODEL = { id: 'rime-q4', name: 'Rime Q4', size: 1099627200, quant: 'Q4_K_M', tier: 1, license: 'lfm1.0', tools: 3, version: 'r5', state: 'ready' };
const setup = (window = 8192) => {
  const calls = [];
  const link = { kind: 'worker', up: true, call: async (op, args) => {
    calls.push({ op, args: structuredClone(args) });
    if (op === 'count') return { tokens: 700 };
    if (op === 'run') return { text: '{"answer":"Nothing is due.","quotes":[]}', finish: 'stop' };
    return {};
  } };
  LOCAL._env({ store: { list: async () => [MODEL] }, link, gpu: () => ({}), session: null,
    scale: { token: true, answer: false, think: {} } });
  const vault = new Map([['connections', { local: { provider: 'local', window, generation: 'g8' } }]]);
  const env = { who: 'context-8k', allowed: Promise.resolve(true), enabled: async () => true,
    settings: async () => ({ on: true, model: { use: 'local', model: '' }, features: { ask: true } }),
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    local: { set: async () => true, get: async () => ({}) }, reach: async () => true, fetch: async () => { throw new Error('none'); },
    task: async (id) => require('../../extension/ai/task.js').get(id) };
  return { calls, env };
};

test('at 8K: the broker\'s count says the 8K window, the run sends window 8192 and the 8K size token', async () => {
  const { calls, env } = setup();
  const [page, worker] = ports(), got = [];
  B.connect(worker, env);
  page.onMessage.addListener((m) => got.push(m));
  try {
    const input = { question: 'What is due?', tools: ['todo_list'], now: C.NOW, zone: 'UTC', first: true };
    page.postMessage({ id: 1, op: 'count', feature: 'ask', task: 'agent.tools', input });
    await settle();
    const counted = got.find((m) => m.id === 1 && m.type === 'end');
    assert.equal(counted?.window, 8192, JSON.stringify(got));
    page.postMessage({ id: 2, op: 'run', feature: 'ask', task: 'agent.tools', input });
    await settle();
    const run = calls.find((c) => c.op === 'run');
    assert.ok(run, JSON.stringify(got.filter((m) => m.id === 2)));
    assert.equal(run.args.window, 8192);
    const specials = run.args.parts.filter((p) => p.special).map((p) => p.special);
    assert.ok(specials.includes('<|gz_ctx:8k|>'), JSON.stringify(specials));
    assert.equal(specials[specials.indexOf('<|gz_task:agent.tools|>') + 1], '<|gz_ctx:8k|>', 'right after the task\'s');
  } finally { page.disconnect(); B._reset(); LOCAL._env(null); }
});

test('at 8K: Ask Rime\'s context event carries the 8K window the provider runs with', async () => {
  const { env } = setup();
  const [askPage, askWorker] = ports(), got = [];
  K.connect(askWorker, {
    allowed: async () => true, broker: (port) => B.connect(port, env), counts: true, settings: env.settings, enabled: async () => true,
    registry: { get: () => null, describe: () => ({}) }, state: async () => ({}), refresh: async () => null, local: {}, keys: async () => [], turn: (f) => f(), zone: 'UTC', now: () => C.NOW,
    accounts: async () => [{ account: `${C.CANVAS}/5`, origin: C.CANVAS }], approve: { ask: async () => 'yes' }, level: async () => 3, page: () => ({ url: `${C.CANVAS}/courses/25/grades` }),
    own: { read: async () => ({ account: `${C.CANVAS}/5`, items: [] }), writer: async () => true, wakes: { local: { get: async () => ({}), set: async () => true } } },
  });
  askPage.onMessage.addListener((m) => got.push(m));
  try {
    askPage.postMessage({ id: 1, op: 'ask', question: "What's due this week?" });
    await settle(300);
    const ctx = got.find((m) => m.type === 'context');
    assert.ok(ctx, JSON.stringify(got.map((m) => m.type)));
    assert.equal(ctx.window, 8192);
    assert.equal(ctx.task, AT.task?.id || 'agent.tools');
  } finally { askPage.disconnect(); B._reset(); LOCAL._env(null); }
});

test('at 16K and up the broker\'s count gives Ask Rime that window (ai/ask.js offers the tool union from 16K)', async () => {
  for (const size of [16384, 131072]) {
    const { env } = setup(size);
    const [page, worker] = ports(), got = [];
    B.connect(worker, env);
    page.onMessage.addListener((m) => got.push(m));
    try {
      page.postMessage({ id: 1, op: 'count', feature: 'ask', task: 'agent.tools', input: { question: 'What is due?', tools: ['todo_list'], now: C.NOW, zone: 'UTC', first: true } });
      await settle();
      assert.equal(got.find((m) => m.id === 1 && m.type === 'end')?.window, size);
    } finally { page.disconnect(); B._reset(); LOCAL._env(null); }
  }
});
