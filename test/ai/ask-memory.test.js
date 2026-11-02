// Ask's memory integration: verified scope, bounded recall, trusted mutations, visible receipts and stale-answer guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../extension/ai/ask.js');
const M = require('../../extension/ai/memory.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const TL = require('../../extension/ai/tools.js');
const ACC = 'https://school.instructure.com/5', NOW = 1793653200000;
const said = (text = 'No memory change is useful.') => ({ call: null, answer: { text, quotes: [] } });
const call = (name, arguments_ = {}, kind = 'read') => ({ call: { name, arguments: arguments_, kind }, answer: null });
const study = { kind: 'concept', step: null, reply: 'Think about how each part depends on the whole.', followUp: null };
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async (done) => { for (let i = 0; i < 500; i++) { if (done()) return; await pause(); } assert.fail('Ask did not settle'); };
const harness = ({ script = {}, counts, verified = true } = {}) => {
  const data = {}, local = { get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(data) : [].concat(keys)).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))),
    set: async (patch) => { Object.assign(data, structuredClone(patch)); } };
  let random = 0;
  const store = M.create({ local, keys: async () => Object.keys(data), now: () => NOW, random: () => (++random).toString(16).padStart(32, '0') });
  const state = { on: true, valid: true, account: ACC, runs: [], counts: [], approvals: [], searches: [] };
  const original = store.search;
  store.search = async (...args) => { state.searches.push(structuredClone(args)); return original(...args); };
  const registry = TL.registry();
  registry.add({ name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-dos', description: 'To-dos', parameters: A.SPECS.find((s) => s.name === 'todo_list').parameters,
    run: async (_, ctx) => ({ account: ctx.account, at: NOW, items: [] }) });
  registry.add({ name: 'assignment_read', kind: 'read', group: 'assignments', scope: 'account', title: 'Assignment', description: 'Assignment', parameters: A.SPECS.find((s) => s.name === 'assignment_read').parameters,
    run: async (_, ctx) => ({ account: ctx.account, title: 'Invented lab', instructions: 'Compare two invented samples.', at: NOW }) });
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op === 'count') { state.counts.push(m); const fit = counts ? counts(m.input, m.task) : { used: 1000, window: 4096, reserve: 768, exact: true }; return port.postMessage({ id: m.id, type: 'end', ...fit }); }
    if (m.op !== 'run') return;
    state.runs.push(m);
    const next = (script[m.task] || [])[state.runs.filter((r) => r.task === m.task).length - 1];
    try { const output = typeof next === 'function' ? await next(m.input, state, store) : next; port.postMessage(output ? { id: m.id, type: 'end', output } : { id: m.id, type: 'error', error: 'check' }); }
    catch { port.postMessage({ id: m.id, type: 'error', error: 'check' }); }
  });
  const env = { allowed: async () => true, broker, settings: async () => ({ on: true, memory: state.on, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: (n) => registry.get(n), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}), refresh: async () => null,
    accounts: async () => [{ account: state.account, origin: 'https://school.instructure.com' }], local, keys: async () => Object.keys(data), now: () => NOW, turn: (f) => f(), zone: 'UTC', level: async () => 3,
    page: () => ({ url: 'https://school.instructure.com/courses/25' }), counts: counts ? true : false,
    current: async () => ({ ...(verified && { account: state.account }), page: { site: 'canvas', url: 'https://school.instructure.com/courses/25' },
      valid: async () => state.valid && state.account === ACC, bind: async (c, input) => input }),
    memory: { store, on: async () => state.on },
    approve: { ask: async (...args) => { state.approvals.push(args); return 'yes'; } },
    own: { writer: async () => true, read: async () => ({ items: [] }), wakes: { on: async () => false, local, read: async () => null } },
  };
  const [page, worker] = K.channel(), got = [];
  const connected = K.connect(worker, env);
  page.onMessage.addListener((m) => got.push(m));
  let id = 0;
  return { store, state, got, env, close: () => { connected.close(); page.disconnect(); }, ask: async (question) => { const next = ++id; page.postMessage({ id: next, op: 'ask', question, locale: 'en', site: 'canvas' }); await settled(() => got.some((m) => m.id === next && ['end', 'error'].includes(m.type))); return got.find((m) => m.id === next && ['end', 'error'].includes(m.type)); } };
};
const preference = (store, text = 'I prefer short bullet points.') => store.save(ACC, { text, evidence: text, category: 'preference' }, { question: text });

test('episode accepts only the trusted private memory policy for memory mutations', async () => {
  for (const [name, authorization, accepted] of [['memory_save', 'memory-policy', true], ['memory_forget', 'memory-policy', true], ['todo_mark_done', 'memory-policy', false], ['memory_save', true, false]]) {
    let runs = 0;
    const out = await K.episode({ question: 'Remember my preference.', tools: [name], now: NOW, zone: 'UTC', locale: 'en',
      run: async () => ++runs === 1 ? call(name, {}, 'write') : said('Saved.'), call: async () => ({ result: { ok: true }, authorization }) });
    assert.equal(!!out.answer, accepted, `${name}/${authorization}`);
    assert.equal(runs, accepted ? 2 : 1);
  }
});

test('study.help receives unrelated saved preferences from a verified account and an optional save pass', async (t) => {
  const h = harness({ script: { 'agent.tools': [said()], 'study.help': [study] } }); t.after(h.close);
  const saved = await preference(h.store);
  const end = await h.ask('Explain photosynthesis.');
  assert.equal(end.type, 'end');
  assert.deepEqual(h.state.runs.map((r) => r.task), ['agent.tools', 'study.help']);
  assert.deepEqual(h.state.runs[0].input.tools, ['memory_save']);
  assert.equal(h.state.runs[0].input.first, undefined, 'an optional save is allowed to do nothing');
  assert.equal(h.state.runs[1].input.recall.records[0].id, saved.receipt.id);
  assert.equal(h.state.runs[1].input.recall.records[0].category, 'preference');
  assert.equal(JSON.stringify(h.state.runs[1].input.recall).includes(ACC), false);
  assert.deepEqual(h.state.searches[0].slice(0, 2), [ACC, 'Explain photosynthesis.']);
  assert.equal(h.state.searches[0][2].includePreferences, true);
  assert.equal(h.state.searches[0][2].limit, 3);
  assert.ok(h.got.some((m) => m.type === 'recall' && m.records[0].id === saved.receipt.id));
});

test('unverified scope supplies no memories and cannot make an automatic write', async (t) => {
  const h = harness({ verified: false, script: { 'study.help': [study] } }); t.after(h.close);
  await preference(h.store);
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'end');
  assert.equal(h.state.searches.length, 0);
  assert.equal(h.state.runs[0].task, 'study.help');
  assert.equal(h.state.runs[0].input.recall, undefined);
});

test('automatic saves emit their device receipt before a later model failure and never ask approval', async (t) => {
  const text = 'I prefer short bullet points.';
  const h = harness({ script: { 'agent.tools': [call('memory_save', { text, evidence: text, category: 'preference' }, 'write')], 'study.help': [study] } }); t.after(h.close);
  assert.equal((await h.ask(`${text} Explain photosynthesis.`)).type, 'error');
  const receipt = h.got.find((m) => m.type === 'memory')?.receipt;
  assert.equal(receipt.operation, 'created');
  assert.equal(receipt.persistence, 'device');
  assert.equal(h.state.approvals.length, 0);
  assert.equal((await h.store.read(ACC, receipt.id)).text, text);
});

test('recall cannot publish after a memory is deleted or the setting/account changes during generation', async (t) => {
  for (const change of ['deleted', 'off', 'account']) {
    let saved;
    const h = harness({ script: { 'agent.tools': [said()], 'study.help': [async (_, state, store) => { if (change === 'deleted') await store.forget(ACC, { id: saved.receipt.id, revision: saved.receipt.revision }); else if (change === 'off') state.on = false; else state.account = 'https://school.instructure.com/6'; return study; }] } }); t.after(h.close);
    saved = await preference(h.store);
    assert.equal((await h.ask('Explain photosynthesis.')).type, 'error', change);
  }
});

test('exact request counts include recall and drop lower ranked records until the request fits', async (t) => {
  const h = harness({ counts: (input) => ({ used: 3200 + (input.recall?.records.length || 0) * 180, window: 4096, reserve: 768, exact: true }), script: { 'agent.tools': [said()], 'study.help': [study] } }); t.after(h.close);
  for (const text of ['Photosynthesis needs light.', 'Photosynthesis uses water.', 'Photosynthesis occurs in cells.']) await h.store.save(ACC, { text, evidence: text }, { question: text });
  assert.equal((await h.ask('Explain photosynthesis.')).type, 'end');
  assert.ok(h.state.counts.some((c) => c.input.recall?.records.length), 'recall reached the exact count path');
  for (const run of h.state.runs) assert.ok(!run.input.recall?.records.length, 'recall is removed if even one record would overflow');
});
