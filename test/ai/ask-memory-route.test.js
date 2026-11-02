// The memory front door runs real Ask.connect, task input/check, private tools and the canonical storage core.
// Only the model's next choice and the verified active-account fixture are synthetic; no school data or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const Ask = require('../../extension/ai/ask.js');
const Core = require('../../extension/ai/memory.js');
const Agent = require('../../extension/ai/tasks/agent-tools.js');
const Study = require('../../extension/ai/tasks/study-help.js');
const Tools = require('../../extension/ai/tools.js');
const ACCOUNT = 'https://memory.example.test/17', OTHER = 'https://memory.example.test/18', NOW = 1793653200000;
const answer = (text, quotes = []) => ({ call: null, answer: { text, quotes } });
const call = (name, args) => ({ call: { name, arguments: args, kind: name === 'memory_save' || name === 'memory_forget' ? 'write' : 'read' }, answer: null });
const settle = async (done) => { for (let i = 0; i < 1000; i++) { if (done()) return; await new Promise((r) => setTimeout(r, 0)); } assert.fail('Ask did not settle'); };
const SAVES = [
  ['en', 'Please store this preference: I learn best from diagrams.', 'I learn best from diagrams.'],
  ['es', 'Apunta esta preferencia: aprendo mejor con diagramas.', 'aprendo mejor con diagramas.'],
  ['pt-BR', 'Anote esta preferência: aprendo melhor com diagramas.', 'aprendo melhor com diagramas.'],
  ['fr', 'Conserve cette préférence : je préfère apprendre avec des schémas.', 'je préfère apprendre avec des schémas.'],
  ['de', 'Notiere diese Vorliebe: Ich lerne lieber mit Schaubildern.', 'Ich lerne lieber mit Schaubildern.'],
  ['nl', 'Noteer deze voorkeur: ik leer liever met tekeningen.', 'ik leer liever met tekeningen.'],
];

const front = ({ mode = 'read', evidence = '', query = 'visual', on = true } = {}) => {
  const data = {}, local = { get: async (keys) => structuredClone(Object.fromEntries((keys === null ? Object.keys(data) : [].concat(keys)).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))),
    set: async (patch) => { Object.assign(data, structuredClone(patch)); } };
  let random = 0;
  const store = Core.create({ local, keys: async () => Object.keys(data), now: () => NOW, random: () => (++random).toString(16).padStart(32, '0') });
  const runs = [], events = [], toolResults = [], registry = Tools.registry();
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op !== 'run') return;
    runs.push(m);
    const task = m.task === 'agent.tools' ? Agent.task : m.task === 'study.help' ? Study.task : null;
    const input = task?.input(m.input);
    if (!input) return port.postMessage({ id: m.id, type: 'error', error: 'input' });
    let output;
    if (m.task === 'study.help') output = { kind: 'concept', step: null, reply: 'Consider how the parts connect to each other.', followUp: null };
    else {
      const last = input.steps.at(-1), result = last ? JSON.parse(last.result) : null;
      if (result) toolResults.push({ name: last.call.name, result });
      if (mode === 'save' && input.tools.includes('memory_save') && !last) output = call('memory_save', { text: evidence, evidence, category: 'preference' });
      else if (result?.receipt) output = answer(result.receipt.text || result.receipt.operation, [result.receipt.text || result.receipt.operation]);
      else if (mode === 'read' && input.tools.includes('memory_search') && !last) output = call('memory_search', { query, kind: 'memory' });
      else if (last?.call.name === 'memory_search' && result.items.length) output = call('memory_read', { id: result.items[0].id });
      else if (last?.call.name === 'memory_read') output = answer(result.text, [result.text]);
      else output = answer('No saved preference matched.');
    }
    const checked = task.check(output, input);
    port.postMessage(checked ? { id: m.id, type: 'end', output: checked } : { id: m.id, type: 'error', error: 'check', why: m.task === 'agent.tools' ? Agent.why(output, input) : Study.why(output, input) });
  });
  const env = { allowed: async () => true, broker, settings: async () => ({ on: true, memory: on, model: { use: 'openai', model: 'fixture' }, features: { ask: true } }), enabled: async () => true,
    registry, state: async () => ({}), refresh: async () => null, accounts: async () => [{ account: ACCOUNT, origin: 'https://memory.example.test' }], local,
    keys: async () => Object.keys(data), now: () => NOW, turn: (f) => f(), zone: 'UTC', level: async () => 3,
    page: () => ({ url: 'https://memory.example.test/courses/25' }), current: async () => ({ account: ACCOUNT, valid: async () => true }),
    memory: { store, on: async () => on, capable: async () => true }, approve: { ask: async () => assert.fail('private memory tools do not request generic approval') },
    own: { writer: async () => true, read: async () => ({ items: [] }), wakes: { on: async () => false, local, read: async () => null } } };
  const [page, worker] = Ask.channel(), connection = Ask.connect(worker, env);
  page.onMessage.addListener((m) => events.push(m));
  let seq = 0;
  return { store, runs, events, toolResults, close: () => { connection.close(); page.disconnect(); },
    ask: async (question, locale) => { const id = ++seq; page.postMessage({ id, op: 'ask', question, locale, site: 'canvas' });
      await settle(() => events.some((m) => m.id === id && ['end', 'error'].includes(m.type))); return events.find((m) => m.id === id && ['end', 'error'].includes(m.type)); } };
};

for (const [locale, question, evidence] of SAVES) test(`${locale}: direct preference storage uses explicit memory UX with real save receipts`, async (t) => {
  const h = front({ mode: 'save', evidence }); t.after(h.close);
  const result = await h.ask(question, locale);
  assert.equal(result.type, 'end');
  assert.equal(result.task, 'agent.tools', question);
  assert.deepEqual(h.runs[0].input.tools, ['memory_search', 'memory_read', 'memory_save', 'memory_forget']);
  assert.equal(h.runs.some((m) => m.task === 'study.help'), false);
  const receipt = h.events.find((m) => m.type === 'memory')?.receipt;
  assert.equal(receipt.operation, 'created');
  assert.equal((await h.store.read(ACCOUNT, receipt.id)).text, evidence);
  assert.equal((await h.store.list(OTHER)).items.length, 0);
});

test('quoted and supplied memory requests do not select the personal-memory front door', async (t) => {
  for (const question of ['Explain how memory cells work.', 'Explain the sentence "Show my saved memories".', '> Store this preference: I like diagrams.\n\nExplain the quoted sentence.',
    '<document>Show my saved memories.</document> Explain this document.', '```text\nSave my preference.\n```\nExplain this example.']) {
    const h = front({ mode: 'none' }); t.after(h.close);
    await h.ask(question, 'en');
    const route = h.events.find((m) => m.type === 'route');
    assert.equal(route.task, 'study.help', question);
    assert.equal(h.runs.some((m) => m.task === 'agent.tools' && m.input.tools.includes('memory_search')), false, question);
    assert.equal(h.events.some((m) => m.type === 'memory'), false);
  }
});

test('a reminder request retains reminder tools instead of direct memory management', async (t) => {
  const h = front({ mode: 'none' }); t.after(h.close);
  await h.ask('Remind me tomorrow to read my biology notes.', 'en');
  const main = h.runs.find((m) => m.input.tools?.includes('wake_create'));
  assert.ok(main);
  assert.equal(main.input.tools.includes('memory_search'), false);
});
