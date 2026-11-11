// Ask's answer links: a link stays a link only to the page's own school site or to an address a tool of this turn
// returned; any other keeps its label as text. Invented content only; no LMS requests or model calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../extension/ai/ask.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const TL = require('../../extension/ai/tools.js');
const ACC = 'https://school.instructure.com/5', NOW = 1793653200000, PAGE = 'https://school.instructure.com/courses/25';
const NOTES = 'https://files.example.net/biology/lab-2-notes.pdf';
const said = (text) => ({ call: null, answer: { text, quotes: [] } });
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async (done) => { for (let i = 0; i < 500; i++) { if (done()) return; await pause(); } assert.fail('Ask did not settle'); };
const harness = (script) => {
  const runs = [], registry = TL.registry();
  registry.add({ name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-dos', description: 'To-dos', parameters: A.SPECS.find((s) => s.name === 'todo_list').parameters,
    run: async (_, ctx) => ({ account: ctx.account, at: NOW, items: [{ title: 'Lab 2 notes', course: 'Biology', due: NOW + 86400000, url: NOTES }] }) });
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op === 'count') return port.postMessage({ id: m.id, type: 'end', used: 1000, window: 4096, reserve: 768, exact: true });
    if (m.op !== 'run') return;
    runs.push(m);
    const next = (script[m.task] || [])[runs.filter((r) => r.task === m.task).length - 1];
    port.postMessage(next ? { id: m.id, type: 'end', output: next } : { id: m.id, type: 'error', error: 'check' });
  });
  const local = { get: async () => ({}), set: async () => {} };
  const env = { allowed: async () => true, broker, settings: async () => ({ on: true, memory: false, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: (n) => registry.get(n), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}), refresh: async () => null,
    accounts: async () => [{ account: ACC, origin: 'https://school.instructure.com' }], local, keys: async () => [], now: () => NOW, turn: (f) => f(), zone: 'UTC', level: async () => 3,
    page: () => ({ url: PAGE }),
    current: async () => ({ account: ACC, page: { site: 'canvas', url: PAGE }, valid: async () => true, bind: (c) => c }),
    approve: { ask: async () => 'yes' },
    own: { writer: async () => true, read: async () => ({ items: [] }), wakes: { on: async () => false, local, read: async () => null } },
  };
  const [page, worker] = K.channel(), got = [];
  const connected = K.connect(worker, env);
  page.onMessage.addListener((m) => got.push(m));
  return { runs, got, close: () => { connected.close(); page.disconnect(); },
    ask: async (question) => { page.postMessage({ id: 1, op: 'ask', question, locale: 'en', site: 'canvas' }); await settled(() => got.some((m) => m.id === 1 && ['end', 'error'].includes(m.type))); return got.find((m) => m.id === 1 && ['end', 'error'].includes(m.type)); } };
};

test('an answer keeps links to the school site and to addresses a tool returned; any other link keeps only its label', async (t) => {
  const h = harness({ 'agent.tools': [{ call: { name: 'todo_list', arguments: { account: ACC } }, answer: null },
    said(`Lab 2 notes is due tomorrow. Open [the course](${PAGE}/assignments/41), [the notes](${NOTES}), [a copy](${NOTES}.zip) or [sign in here](https://login.example.org/verify).`)] });
  t.after(h.close);
  const end = await h.ask('What is due this week?');
  assert.equal(end.type, 'end', JSON.stringify(end));
  assert.equal(end.answer.text, `Lab 2 notes is due tomorrow. Open [the course](${PAGE}/assignments/41), [the notes](${NOTES}), a copy or sign in here.`);
});

test('study help keeps links to the school site only', async (t) => {
  const h = harness({ 'study.help': [{ kind: 'concept', step: null, reply: 'Review [the module](https://school.instructure.com/courses/25/modules) and [this summary](https://notes.example.org/cheat).', followUp: null }] });
  t.after(h.close);
  const end = await h.ask('Explain photosynthesis.');
  assert.equal(end.type, 'end', JSON.stringify(end));
  assert.equal(end.output.reply, 'Review [the module](https://school.instructure.com/courses/25/modules) and this summary.');
});

test('links inside code and escaped brackets are left as written', () => {
  const text = 'Use `[x](https://a.example/b)` literally.\n```\n[y](https://c.example/d)\n```\n\\[z](https://e.example/f) and [w](https://g.example/h).';
  assert.equal(A.links(text, { origin: 'https://school.instructure.com' }), text.replace('[w](https://g.example/h)', 'w'));
});
