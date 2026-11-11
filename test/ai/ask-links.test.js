// Ask's answer links: a link stays a link only to the page's own school site or to an address a tool of this turn
// returned; any other keeps its label as text. Invented content only; no LMS requests or model calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../extension/ai/ask.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const TL = require('../../extension/ai/tools.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const ACC = 'https://school.instructure.com/5', NOW = 1793653200000, PAGE = 'https://school.instructure.com/courses/25';
const NOTES = 'https://files.example.net/biology/lab-2-notes.pdf';
const said = (text) => ({ call: null, answer: { text, quotes: [] } });
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const settled = async (done) => { for (let i = 0; i < 500; i++) { if (done()) return; await pause(); } assert.fail('Ask did not settle'); };
const harness = (script, { counts, todo } = {}) => {
  const runs = [], registry = TL.registry();
  registry.add({ name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-dos', description: 'To-dos', parameters: A.SPECS.find((s) => s.name === 'todo_list').parameters,
    run: async (args, ctx) => todo ? todo(args, ctx) : ({ account: ctx.account, at: NOW, items: [{ title: 'Lab 2 notes', course: 'Biology', due: NOW + 86400000, url: NOTES }] }) });
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op === 'count') return port.postMessage({ id: m.id, type: 'end', ...(counts ? counts(m.input) : { used: 1000, window: 4096, reserve: 768, exact: true }) });
    if (m.op !== 'run') return;
    runs.push(m);
    const next = (script[m.task] || [])[runs.filter((r) => r.task === m.task).length - 1];
    port.postMessage(next ? { id: m.id, type: 'end', output: next } : { id: m.id, type: 'error', error: 'check' });
  });
  const local = { get: async () => ({}), set: async () => {} };
  const env = { allowed: async () => true, broker, settings: async () => ({ on: true, memory: false, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: (n) => registry.get(n), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}), refresh: async () => null,
    accounts: async () => [{ account: ACC, origin: 'https://school.instructure.com' }], local, keys: async () => [], now: () => NOW, turn: (f) => f(), zone: 'UTC', level: async () => 3,
    page: () => ({ url: PAGE }), counts: !!counts,
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

// Execute the production renderer's Markdown block with a minimal DOM so a bypass has to create a real anchor.
const renderedLinks = (text, links) => {
  const source = fs.readFileSync(path.join(__dirname, '../../extension/ai/page/ask-chat.js'), 'utf8');
  const start = source.indexOf('  const INLINE = '), end = source.indexOf('  // ---- a port ', start);
  assert.ok(start >= 0 && end > start);
  const doc = {}, make = (tag, props = {}, ...children) => {
    const element = Object.assign(new El(tag, doc), props); element.append(...children); return element;
  };
  const markdown = vm.runInNewContext(`(() => { ${source.slice(start, end)} return markdown; })()`, { make, URL });
  const root = make('div', {}, ...markdown(text, links));
  return root.querySelectorAll('a').map((a) => a.href);
};

for (const [name, text] of [
  ['nested labels', '[[open](https://evil.example/one)](https://evil.example/two)'],
  ['formatting across a code delimiter', '**literal `** [open](https://evil.example/one) `'],
  ['carriage returns inside an address', '[open](ht\rtps://evil.example/one)'],
]) test(`the link filter cannot leave a rendered unapproved anchor through ${name}`, () => {
  assert.ok(renderedLinks(text, ['https://evil.example/one', 'https://evil.example/two']).length > 0, 'the fixture is clickable when its address is allowed');
  const shown = A.linked(`${text}\n\n[course](${PAGE})`, { origin: 'https://school.instructure.com' });
  assert.deepEqual(renderedLinks(shown.text, shown.links), [PAGE]);
});

test('study follow-up questions apply the same link policy as the reply', async (t) => {
  const h = harness({ 'study.help': [{ kind: 'concept', step: null, reply: 'Think about how light reaches a leaf.',
    followUp: `Will you compare [the course](${PAGE}) with [this guide](https://evil.example/guide)?` }] });
  t.after(h.close);
  const end = await h.ask('Explain photosynthesis.');
  assert.equal(end.type, 'end', JSON.stringify(end));
  assert.equal(end.output.followUp, `Will you compare [the course](${PAGE}) with this guide?`);
});

test('a tool address in prose remains approved before sentence punctuation', () => {
  const text = `[notes](${NOTES})`;
  assert.equal(A.links(text, { results: [{ instructions: `Read ${NOTES}.` }] }), text);
});

test('links returned earlier in the turn remain approved after result compaction', async (t) => {
  const second = 'https://files.example.net/biology/lab-3-notes.pdf';
  const text = `Open [Lab 2 notes](${NOTES}) and [Lab 3 notes](${second}).`;
  const h = harness({ 'agent.tools': [
    { call: { name: 'todo_list', arguments: { account: ACC, days: 1 } }, answer: null },
    { call: { name: 'todo_list', arguments: { account: ACC, days: 2 } }, answer: null }, said(text),
  ] }, {
    counts: (input) => ({ used: input.steps?.length > 1 && input.steps[0].result.items ? 4000 : 1000, window: 4096, reserve: 768, exact: true }),
    todo: (args, ctx) => ({ account: ctx.account, at: NOW, items: [{ title: args.days === 1 ? 'Lab 2 notes' : 'Lab 3 notes', course: 'Biology',
      due: NOW + 86400000, url: args.days === 1 ? NOTES : second }] }),
  });
  t.after(h.close);
  const end = await h.ask('What is due this week?');
  assert.equal(end.type, 'end', JSON.stringify(end));
  assert.ok(h.runs.at(-1).input.steps[0].result.digest, 'the older result was compacted');
  assert.equal(end.answer.text, text);
});

test('the chat draws an anchor only for an address the worker allowed', () => {
  assert.deepEqual(renderedLinks(`[a](${PAGE}) [b](${NOTES})`, [NOTES]), [NOTES]);
  assert.deepEqual(renderedLinks(`[a](${PAGE})`), []);
});
