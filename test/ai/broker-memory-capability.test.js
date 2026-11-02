// The broker must check memory support on the exact weights its catalog pins, after Ask's background check. Stand-in
// tasks accept recall and memory tools so these tests isolate admission before any provider work, including counting.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../extension/ai/broker.js');
const P = require('../../extension/ai/providers.js');
const T = require('../../extension/ai/task.js');

const task = (id) => T.define({ id, version: 1, warm: true, input: (raw) => raw, output: 'text', check: (output) => output,
  build: (input, { text }) => text.request({ system: `Offered tools: ${(input.tools || []).join(', ')}`,
    data: [...(input.recall ? [{ label: 'recall', text: JSON.stringify(input.recall) }] : []), { label: 'question', text: input.question }] }) });
const tasks = Object.fromEntries(['study.help', 'agent.tools'].map((id) => [id, task(id)]));
const recall = { records: [], truncated: false };
const flush = async () => { for (let i = 0; i < 60; i++) await new Promise(setImmediate); };
const port = () => {
  const listeners = [], disconnect = [];
  return { posted: [], postMessage(message) { this.posted.push(message); }, onMessage: { addListener: (fn) => listeners.push(fn) },
    onDisconnect: { addListener: (fn) => disconnect.push(fn) }, say(message) { listeners.forEach((fn) => fn(message)); }, close() { disconnect.forEach((fn) => fn()); } };
};
const harness = ({ id = 'local', version = 0, memoryVersion = true } = {}) => {
  B._reset();
  const seen = { run: [], count: [], warm: [], versions: [] }, previous = globalThis.GZ_AI_PROVIDERS;
  const provider = {
    id, config: (raw) => ({ ...raw, model: 'glaze-local' }), caps: () => ({ text: true, json: true, tools: false, local: true, context: 4096 }),
    catalog: async () => ({ models: [{ id: 'glaze-local', json: true, tools: false, context: { window: 4096, inputLimit: 4096 }, weights: 'legacy-pinned' }] }),
    toolsLevel: async () => 3,
    ...(memoryVersion && { memoryVersion: async (cfg) => { seen.versions.push(cfg); return cfg.weights === 'legacy-pinned' ? version : 1; } }),
    count: async (req, cfg) => { seen.count.push({ req, cfg }); return 20; },
    warm: async (req, cfg) => { seen.warm.push({ req, cfg }); return true; },
    run: async (req, cfg) => { seen.run.push({ req, cfg }); return { text: 'Checked.', model: 'glaze-local', finish: 'stop' }; },
  };
  globalThis.GZ_AI_PROVIDERS = { ...P, get: (name) => name === id ? provider : P.get(name) };
  const env = { who: 'memory-pinned', allowed: Promise.resolve(true), enabled: async () => true,
    settings: async () => ({ on: true, model: { use: 'chosen', model: 'glaze-local' }, features: { ask: true } }),
    vault: { get: async () => ({ chosen: { provider: id, model: 'glaze-local', tier: 3 } }) }, task: async (name) => tasks[name] };
  const p = port(); B.connect(p, env);
  return { p, seen, send: async (input, { op = 'run', task = 'agent.tools', requestId = 1 } = {}) => {
    p.say({ id: requestId, op, feature: 'ask', task, input: { question: 'What should I consider?', ...input } }); await flush();
    return p.posted.findLast((message) => message.id === requestId && ['end', 'error', 'warmed'].includes(message.type));
  }, close: () => { p.close(); globalThis.GZ_AI_PROVIDERS = previous; B._reset(); } };
};

test('broker refuses recalled data and memory tool offers for unsupported pinned local weights', async () => {
  for (const [task, input] of [['study.help', { recall }], ['agent.tools', { recall }], ['agent.tools', { tools: ['memory_search'] }]]) {
    const h = harness();
    try {
      const result = await h.send(input, { task });
      assert.equal(result?.error, 'caps', `${task}: ${JSON.stringify(input)}`);
      assert.equal(h.seen.run.length, 0);
      assert.equal(h.seen.count.length, 0);
      assert.equal(h.seen.versions[0].weights, 'legacy-pinned', 'the catalog pin overrides the vault tier');
    } finally { h.close(); }
  }
});

test('counting and warm-up never send unsupported memory requests to the pinned local model', async () => {
  const h = harness();
  try {
    const counted = await h.send({ recall }, { op: 'count', task: 'study.help' });
    assert.deepEqual(counted, { id: 1, type: 'end' });
    assert.equal(h.seen.count.length, 0);
    const warmed = await h.send({ tools: ['memory_read'] }, { op: 'warm', requestId: 2 });
    assert.deepEqual(warmed, { id: 2, type: 'warmed', ok: false });
    assert.equal(h.seen.warm.length, 0);
  } finally { h.close(); }
});

test('a missing capability API or an unknown future memory version cannot admit a memory request', async () => {
  for (const options of [{ memoryVersion: false }, { version: 2 }]) {
    const h = harness(options);
    try { assert.equal((await h.send({ recall }))?.error, 'caps'); assert.equal(h.seen.run.length, 0); } finally { h.close(); }
  }
});

test('supported pinned weights admit memory; ordinary local and nonlocal requests keep their existing path', async () => {
  for (const [options, input] of [[{ version: 1 }, { recall, tools: ['memory_search'] }], [{}, { tools: ['run_js'] }], [{ id: 'openai' }, { recall, tools: ['memory_search'] }]]) {
    const h = harness(options);
    try {
      const result = await h.send(input);
      assert.equal(result?.type, 'end');
      assert.equal(result?.output, 'Checked.');
      assert.equal(h.seen.run.length, 1);
      assert.equal(h.seen.versions.length, options.version === 1 ? 1 : 0, 'ordinary and nonlocal requests do not need this local contract');
    } finally { h.close(); }
  }
});
