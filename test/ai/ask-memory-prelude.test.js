// Independent synthetic controls for optional save recovery. No pilot questions, worlds, gold or model calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const Ask = require('../../extension/ai/ask.js');
const Core = require('../../extension/ai/memory.js');
const Agent = require('../../extension/ai/tasks/agent-tools.js');
const Tasks = require('../../extension/ai/task.js');
const Tools = require('../../extension/ai/tools.js');
const ACC = 'https://prelude.example.test/47', NOW = 1793653200000;
const QUESTION = 'Show my due dates for tomorrow.';
const REJECTED = 'SYNTHETIC_REJECTED_PERSONAL_FACT';
const said = (text = 'No memory change is useful.', quotes = []) => ({ call: null, answer: { text, quotes } });
const call = (name, args = {}) => ({ call: { name, arguments: args }, answer: null });
const rejected = () => ({ output: call('memory_save', { text: REJECTED, evidence: 'I collect synthetic amber stones.', category: 'fact' }) });
const waitFor = async (done) => { for (let n = 0; n < 1000; n++) { if (done()) return; await new Promise((r) => setTimeout(r, 0)); } assert.fail('Ask did not settle'); };
const gate = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };

function front({ prelude = () => rejected(), main, count, bind, rows = [] } = {}) {
  const data = {}, local = { get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(data) : [].concat(keys)).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))),
    set: async (patch) => Object.assign(data, structuredClone(patch)) };
  let random = 0;
  const store = Core.create({ local, keys: async () => Object.keys(data), now: () => NOW, random: () => (++random).toString(16).padStart(32, '0') });
  const state = { memory: true, capable: true, ai: true, ask: true, enabled: true, account: ACC, valid: true, context: 1,
    runs: [], counts: [], events: [], reads: [], checks: [], active: 0, cancelled: 0 };
  const registry = Tools.registry();
  for (const name of ['todo_list', 'schedule_list', 'accounts_list']) registry.add({ name, kind: 'read', group: 'courses', scope: 'account', title: name, description: name,
    parameters: Agent.SPECS.find((s) => s.name === name).parameters, run: async () => { state.reads.push(name); return { account: ACC, items: rows, at: NOW }; } });
  const isPrelude = (m) => m.task === 'agent.tools' && m.input.tools.length === 1 && m.input.tools[0] === 'memory_save';
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op === 'cancel') { state.cancelled++; return; }
    if (m.op === 'count') {
      state.counts.push(m);
      return port.postMessage({ id: m.id, type: 'end', ...(count ? await count(m, state) : { used: 1000, window: 4096, reserve: 768, exact: true }) });
    }
    if (m.op !== 'run') return;
    state.runs.push(m); state.active++;
    try {
      const automatic = isPrelude(m), index = state.runs.filter(isPrelude).length;
      const reply = automatic ? await prelude({ input: m.input, index, state, store }) : main ? await main({ message: m, state, store }) : undefined;
      if (reply?.error) return port.postMessage({ id: m.id, type: 'error', ...reply });
      if (m.task !== 'agent.tools') return port.postMessage({ id: m.id, type: 'end', output: { kind: 'concept', step: null, reply: 'Consider how energy passes between neighboring particles.', followUp: null } });
      const output = reply?.output || (!m.input.steps.length ? call('todo_list') : said('No matching records were found.'));
      const provider = { id: 'synthetic-prelude', config: () => ({}), caps: () => ({ text: true, json: true, tools: false, stream: false, local: true, context: 4096 }),
        run: async () => ({ text: reply?.raw ?? JSON.stringify(output), finish: reply?.finish || 'stop', model: 'synthetic' }) };
      try {
        const r = await Tasks.run(Agent.task, m.input, { provider, cfg: {} });
        port.postMessage({ id: m.id, type: 'end', output: r.output });
      } catch (e) {
        state.checks.push({ automatic, code: e.code, why: e.why });
        port.postMessage({ id: m.id, type: 'error', error: e.code, ...(e.why && { why: e.why }), ...(e.raw && { raw: e.raw }) });
      }
    } finally { state.active--; }
  });
  const env = { allowed: async () => true, broker, settings: async () => ({ on: state.ai, memory: state.memory, model: { use: 'openai', model: 'fixture' }, features: { ask: state.ask } }), enabled: async () => state.enabled,
    registry: { get: (name) => registry.get(name), describe: (tool) => ({ name: tool.name, inputSchema: tool.parameters }) },
    state: async () => ({}), refresh: async () => null, accounts: async () => [{ account: state.account, origin: 'https://prelude.example.test' }], local,
    keys: async () => Object.keys(data), now: () => NOW, turn: (f) => f(), zone: 'UTC', level: async () => 3, counts: !!count,
    page: () => ({ url: 'https://prelude.example.test/courses/6' }), current: async () => { const context = state.context; return { account: ACC, ...(bind && { bind }), valid: async () => {
      if (state.contextError) { const code = state.contextError; state.contextError = null; throw Object.assign(new Error('context validation failed'), { code }); }
      return state.valid && state.account === ACC && state.context === context;
    } }; },
    memory: { store, on: async () => state.memory, capable: async () => state.capable }, approve: { ask: async () => assert.fail('no generic approval') },
    own: { writer: async () => true, read: async () => ({ items: [] }), wakes: { on: async () => false, local, read: async () => null } } };
  const [page, worker] = Ask.channel(), connection = Ask.connect(worker, env);
  page.onMessage.addListener((m) => state.events.push(m));
  let id = 0;
  const start = (question = QUESTION, extra = {}) => { const next = ++id; page.postMessage({ id: next, op: 'ask', question, locale: 'en', site: 'canvas', ...extra }); return next; };
  const end = async (next) => { await waitFor(() => state.events.some((m) => m.id === next && ['end', 'error'].includes(m.type))); return state.events.find((m) => m.id === next && ['end', 'error'].includes(m.type)); };
  return { state, store, start, end, cancel: (next) => page.postMessage({ id: next, op: 'cancel' }), dispose: () => page.disconnect(), close: () => { connection.close(); page.disconnect(); },
    ask: async (...args) => end(start(...args)), mains: () => state.runs.filter((m) => !isPrelude(m)) };
}

async function noRejectedState(h) {
  assert.equal((await h.store.list(ACC)).items.length, 0);
  assert.equal(h.state.events.some((m) => m.type === 'memory'), false);
  assert.equal(JSON.stringify(h.mains()).includes(REJECTED), false);
  assert.equal(JSON.stringify(h.state.events).includes(REJECTED), false);
}

for (const question of [QUESTION, 'Explain thermal conduction.']) test(`invalid optional save preserves the main task: ${question}`, async (t) => {
  const h = front(); t.after(h.close);
  const history = [{ question: 'I am reviewing laboratory safety.', answer: 'Consider how each precaution protects the reader.' }];
  const result = await h.ask(question, { history });
  assert.equal(result.type, 'end', JSON.stringify(result));
  assert.equal(h.state.checks[0].code, 'check'); assert.equal(h.state.checks[0].why, 'text');
  assert.deepEqual(h.mains()[0].input.history, history);
  assert.equal(h.mains()[0].input.tools?.includes('memory_save') || false, false);
  await noRejectedState(h);
});

for (const [label, response, code] of [
  ['malformed task JSON', { raw: '{broken' }, 'invalid-response'],
  ['truncated task output', { output: said(), finish: 'length' }, 'refusal'],
]) test(`${label} in the optional pass permits the main school task`, async (t) => {
  const h = front({ prelude: () => response }); t.after(h.close);
  const result = await h.ask(); assert.equal(result.type, 'end', JSON.stringify({ result, checks: h.state.checks, reads: h.state.reads }));
  assert.equal(h.state.checks[0].code, code);
  assert.ok(h.state.reads.includes('todo_list'));
  await noRejectedState(h);
});

test('a valid optional no-save answer remains invisible and permits the main task', async (t) => {
  const hidden = 'SYNTHETIC_PRIVATE_NO_SAVE_PROSE';
  const h = front({ prelude: () => ({ output: said(hidden) }) }); t.after(h.close);
  const result = await h.ask(); assert.equal(result.type, 'end', JSON.stringify({ result, checks: h.state.checks, reads: h.state.reads }));
  assert.equal(h.state.checks.length, 0);
  assert.equal(JSON.stringify(h.mains()).includes(hidden), false);
  assert.equal(JSON.stringify(h.state.events).includes(hidden), false);
  await noRejectedState(h);
});

test('a durable automatic receipt survives a later invalid prelude output while the school task proceeds', async (t) => {
  const fact = 'I prefer labeled diagrams.';
  const h = front({ prelude: ({ index }) => index === 1 ? { output: call('memory_save', { text: fact, evidence: fact, category: 'preference' }) } : rejected() }); t.after(h.close);
  const result = await h.ask(`${fact} ${QUESTION}`); assert.equal(result.type, 'end', JSON.stringify({ result, checks: h.state.checks, reads: h.state.reads }));
  const receipts = h.state.events.filter((m) => m.type === 'memory');
  assert.equal(receipts.length, 1); assert.equal(receipts[0].receipt.operation, 'created');
  assert.equal((await h.store.read(ACC, receipts[0].receipt.id)).text, fact);
  assert.equal(JSON.stringify(h.mains()).includes(REJECTED), false);
  assert.ok(h.state.events.indexOf(receipts[0]) < h.state.events.findIndex((m) => m.type === 'end'));
});

for (const code of ['size', 'limit', 'steps', 'timeout', 'changed', 'off', 'permission', 'connection-lost']) test(`optional pass does not recover ${code}`, async (t) => {
  const h = front({ prelude: () => ({ error: code }) }); t.after(h.close);
  const result = await h.ask();
  assert.equal(result.type, 'error'); assert.equal(result.error, code);
  assert.equal(h.mains().length, 0);
  await noRejectedState(h);
});

for (const change of ['account', 'context', 'memory', 'capable', 'ai', 'ask', 'enabled', 'epoch']) test(`a rejected save cannot cross ${change} invalidation`, async (t) => {
  const h = front({ prelude: async ({ state, store }) => {
    if (change === 'account') state.account = 'https://prelude.example.test/48';
    else if (change === 'context') state.context++;
    else if (change === 'epoch') await store.invalidate(ACC);
    else state[change] = false;
    return rejected();
  } }); t.after(h.close);
  const result = await h.ask();
  assert.equal(result.type, 'error'); assert.equal(result.error, 'changed');
  assert.equal(h.mains().length, 0);
  assert.equal((await h.store.list(ACC)).items.length, 0);
  assert.equal(h.state.events.some((m) => m.type === 'memory'), false);
});

test('cancellation while a rejected optional response is pending remains terminal', async (t) => {
  const held = gate(), h = front({ prelude: async () => { await held.promise; return rejected(); } });
  t.after(() => { held.release(); h.close(); });
  const id = h.start(); await waitFor(() => h.state.runs.length === 1);
  h.cancel(id);
  assert.equal((await h.end(id)).error, 'cancelled');
  held.release(); await waitFor(() => h.state.active === 0);
  assert.equal(h.mains().length, 0);
  await noRejectedState(h);
});

test('port disposal prevents a late rejected response from starting any main task or event', async (t) => {
  const held = gate(), h = front({ prelude: async () => { await held.promise; return rejected(); } });
  t.after(() => { held.release(); h.close(); });
  h.start(); await waitFor(() => h.state.runs.length === 1);
  h.dispose(); const before = h.state.events.length;
  held.release(); await waitFor(() => h.state.active === 0);
  assert.equal(h.mains().length, 0); assert.equal(h.state.events.length, before);
  await noRejectedState(h);
});

test('an optional pass that cannot fit is skipped before the main request', async (t) => {
  const h = front({ count: (m) => ({ used: m.input.tools?.length === 1 && m.input.tools[0] === 'memory_save' ? 4000 : 1000, window: 4096, reserve: 768, exact: true }) }); t.after(h.close);
  const result = await h.ask(); assert.equal(result.type, 'end', JSON.stringify({ result, checks: h.state.checks, reads: h.state.reads }));
  assert.equal(h.state.runs.some((m) => m.input.tools?.includes('memory_save')), false);
  await noRejectedState(h);
});

test('a size barrier discovered at the actual prelude request remains terminal', async (t) => {
  let optionalCounts = 0;
  const h = front({ count: (m) => ({ used: m.input.tools?.length === 1 && m.input.tools[0] === 'memory_save' && ++optionalCounts > 1 ? 4000 : 1000,
    window: 4096, reserve: 768, exact: true }) }); t.after(h.close);
  const result = await h.ask();
  assert.equal(result.type, 'error'); assert.equal(result.error, 'size');
  assert.equal(h.state.runs.length, 0);
  await noRejectedState(h);
});

test('a check thrown while binding a save tool is not a recoverable model rejection', async (t) => {
  const fact = 'I prefer wide margins.';
  const h = front({ prelude: () => ({ output: call('memory_save', { text: fact, evidence: fact, category: 'preference' }) }),
    bind: () => { throw Object.assign(new Error('binding refused'), { code: 'check' }); } }); t.after(h.close);
  const result = await h.ask(`${fact} ${QUESTION}`);
  assert.equal(result.type, 'error'); assert.equal(result.error, 'check');
  assert.equal(h.mains().length, 0);
  await noRejectedState(h);
});

test('a validation-coded context failure after a valid prelude response remains terminal', async (t) => {
  const h = front({ prelude: ({ state }) => { state.contextError = 'check'; return { output: said() }; } }); t.after(h.close);
  const result = await h.ask();
  assert.equal(result.type, 'error'); assert.equal(result.error, 'check');
  assert.equal(h.mains().length, 0);
  await noRejectedState(h);
});

test('a main-task validation error after a skipped save stays terminal', async (t) => {
  const h = front({ main: () => ({ output: said('No matching records were found.') }) }); t.after(h.close);
  const result = await h.ask();
  assert.equal(result.type, 'error'); assert.equal(result.error, 'check'); assert.equal(result.why, 'first');
  assert.equal(h.mains().length, 2, 'one corrective turn, then the error');
  assert.equal(h.mains()[1].input.fix, 'first');
});

test('the existing main-task corrective turn still runs after optional rejection', async (t) => {
  const h = front({ rows: [{ id: '21', title: 'Optics lab', type: 'assignment' }], main: ({ message: m }) => !m.input.steps.length ? { output: call('todo_list') }
    : { output: m.input.fix ? said('Optics lab', ['Optics lab']) : said('Review the listed work.') } }); t.after(h.close);
  const result = await h.ask();
  assert.equal(result.type, 'end', JSON.stringify(result));
  assert.equal(result.answer.text, 'Optics lab');
  assert.ok(h.state.checks.some((c) => !c.automatic && c.why === 'ground'));
  assert.ok(h.mains().some((m) => m.input.fix === 'ground'));
});

test('explicit memory action validation failures are never treated as optional', async (t) => {
  const h = front({ main: () => rejected() }); t.after(h.close);
  const result = await h.ask('Save this preference: I like wide margins.');
  assert.equal(result.type, 'error'); assert.equal(result.error, 'check'); assert.equal(result.why, 'text');
  assert.equal(h.state.runs.length, 2, 'one corrective turn, then the error'); assert.ok(h.state.runs[0].input.tools.includes('memory_forget'));
  assert.equal(h.state.runs[1].input.fix, 'text');
  assert.equal((await h.store.list(ACC)).items.length, 0);
  assert.equal(h.state.events.some((m) => m.type === 'memory'), false);
});
