// Ask Glaze (ai/ask.js): the routing rule between study.help and agent.tools, the step loop over Agents' tools (six steps at
// most, the student's approval for the one write, a decline that stops), and the panel's port: model runs over the AI
// broker's own protocol (a stand-in broker here), tool calls through the real agents/calls.js with stand-in tools and
// approval window, and the study rule held on the agent path too.
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../../extension/ai/tools.js');
require('../../extension/ai/schema.js');
require('../../extension/ai/failure.js');
require('../../extension/ai/loop.js');
require('../../extension/agents/grants.js');
globalThis.GZ_MCP_CALLS = require('../../extension/agents/calls.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
require('../../extension/ai/tasks/study-help.js');
const K = require('../../extension/ai/ask.js');

// ---- the routing rule ---------------------------------------------------------------------------------------------------
const agent = (q, locale = 'en') => { const r = K.route(q, { locale }); assert.equal(r.task, 'agent.tools', `${locale}: ${q}`); return r.tools; };
const study = (q, subject, o = {}) => { const r = K.route(q, { locale: 'en', ...o }); assert.deepEqual(r, { task: 'study.help', subject }, q); };

test('route: the student\'s own records go to agent.tools with the tools their topic needs', () => {
  assert.deepEqual(agent('What do I have due this week?'), ['todo_list', 'schedule_list', 'accounts_list']);
  assert.deepEqual(agent('Mark Lab report 3 as done'), ['todo_list', 'schedule_list', 'todo_mark_done', 'accounts_list']);
  assert.deepEqual(agent('What are my grades?'), ['grades_list', 'course_grades', 'accounts_list']);
  assert.deepEqual(agent('Which Writer documents did I edit last?'), ['documents_list', 'document_read', 'document_assignment'], 'no account to choose for documents');
  assert.deepEqual(agent('What are the instructions for the lab report assignment?'), ['assignments_list', 'assignment_read', 'courses_list', 'accounts_list']);
  assert.deepEqual(agent('How many assignments are due this week?'), ['todo_list', 'schedule_list', 'assignments_list', 'assignment_read', 'courses_list', 'accounts_list'], '"how many" asks for records');
  const all = agent('Mark it done: my grades, my documents, what is due and the assignment rubric');
  assert.ok(all.length <= 6 && all.every((n) => A.NAMES.includes(n)), 'at most six, every one an agent.tools tool');
  assert.ok(all.includes('todo_mark_done'));
});

test('route: in each of Glaze\'s languages, as the student\'s locale says', () => {
  assert.ok(agent('¿Qué tengo que entregar esta semana?', 'es').includes('todo_list'));
  assert.ok(agent('Quais são minhas notas?', 'pt-BR').includes('grades_list'));
  assert.ok(agent('Qu\'est-ce que j\'ai à rendre cette semaine ?', 'fr').includes('todo_list'));
  assert.ok(agent('Was ist diese Woche fällig?', 'de').includes('todo_list'));
  assert.ok(agent('Wat moet ik deze week inleveren?', 'nl').includes('todo_list'));
  assert.ok(agent('Welche Noten habe ich?', 'de').includes('grades_list'));
  assert.deepEqual(K.route('Wie löse ich 2x = 8?', { locale: 'de' }), { task: 'study.help', subject: 'math' });
  assert.deepEqual(K.route('¿Cómo resuelvo 2x = 8 para mañana?', { locale: 'es' }), { task: 'study.help', subject: 'math' });
  assert.deepEqual(K.route('Mes notes de cours sur la cellule', { locale: 'en' }).task, 'study.help', 'a French word counts only in French');
});

test('route: help with work goes to study.help, whatever records it mentions, with its subject', () => {
  study('How do I solve 3x + 5 = 20?', 'math');
  study('Can you explain photosynthesis for my test tomorrow?', 'science');
  study('Help me with my essay thesis', 'essay');
  study('Why does my for loop never stop? ```for (i = 0;;) {}```', 'code');
  study('What is the theme of chapter 3 of the novel?', 'reading');
  study('Tell me about the French Revolution', 'other');
  study('What is the answer to question 4 of my assignment due Friday?', 'other');
  study('What is due this week?', 'other', { attempt: 'I think the answer is 4' });
});

// ---- the step loop --------------------------------------------------------------------------------------------------------
const TODO = { account: 'https://school.instructure.com/5', at: 1, items: [{ id: '1', type: 'assignment', courseId: '25', course: 'BIO 1100', title: 'Lab report', due: 2 }] };
const loop = ({ outs, results = {} } = {}) => {
  const runs = [], calls = [];
  const run = async (task, input) => { runs.push(structuredClone(input)); const o = outs[runs.length - 1]; if (!o) throw new Error('no more'); return typeof o === 'function' ? o(input) : o; };
  const call = async (c) => { calls.push(c); const r = results[c.name]; return typeof r === 'function' ? r(c) : r || { result: TODO }; };
  return { runs, calls, go: (o = {}) => K.episode({ question: 'What is due?', tools: ['todo_list', 'todo_mark_done'], locale: 'en', now: 1e12, zone: 'UTC', run, call, ...o }) };
};
const said = (text) => ({ call: null, answer: { text, quotes: [] } });
const asks = (name, args = {}, kind = 'read') => ({ call: { name, arguments: args, kind }, answer: null });

test('episode: an answer ends it; a read is run and appended, and the next run sees it', async () => {
  const one = loop({ outs: [said('Nothing is due.')] });
  assert.deepEqual(await one.go(), { answer: { text: 'Nothing is due.', quotes: [] }, steps: [] });
  assert.equal(one.runs.length, 1);
  const two = loop({ outs: [asks('todo_list', { days: 7 }), said('Lab report is due.')] });
  const r = await two.go();
  assert.equal(r.answer.text, 'Lab report is due.');
  assert.deepEqual(two.calls, [{ name: 'todo_list', arguments: { days: 7 }, kind: 'read' }]);
  assert.deepEqual(two.runs[1].steps, [{ call: { name: 'todo_list', arguments: { days: 7 } }, result: TODO }]);
  assert.deepEqual(two.runs[1].tools, ['todo_list', 'todo_mark_done']);
});

test('episode: six steps at most, then a call ends it as steps', async () => {
  const many = loop({ outs: Array.from({ length: 10 }, (_, i) => asks('todo_list', { days: i + 1 })) });
  await assert.rejects(many.go(), (e) => e.code === 'steps');
  assert.equal(many.calls.length, A.LIMIT.steps);
  assert.equal(many.runs.length, A.LIMIT.steps + 1);
  assert.equal(A.LIMIT.steps, 6);
});

test('episode: a write waits for the student; a yes runs on, anything else ends it with no further run', async () => {
  const yes = loop({ outs: [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Marked Lab report done.')],
    results: { todo_mark_done: { result: { ok: true }, asked: 'yes' } } });
  assert.equal((await yes.go()).answer.text, 'Marked Lab report done.');
  assert.equal(yes.calls[1].kind, 'write');
  for (const asked of ['no', 'timeout', 'cancelled', 'interrupted', undefined]) {
    const no = loop({ outs: [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Done!')],
      results: { todo_mark_done: { result: { ok: false, error: 'The student declined in Glaze. Nothing was done.' }, asked } } });
    const r = await no.go();
    assert.equal(r.declined, asked || 'refused', String(asked));
    assert.equal(no.runs.length, 2, 'no run after the decline, so nothing can say it was done');
  }
});

test('episode: a cancel ends it', async () => {
  const ac = new AbortController();
  const l = loop({ outs: [() => { ac.abort(); return asks('todo_list'); }, said('x')] });
  await assert.rejects(l.go({ signal: ac.signal }), (e) => e.code === 'cancelled');
  assert.equal(l.calls.length, 0);
});

// ---- the panel's port -----------------------------------------------------------------------------------------------------
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };
// A Chrome-like port pair: messages copied and delivered later; disconnect() tells the other end only.
const ports = () => {
  const side = () => ({ on: [], gone: [], closed: false });
  const a = side(), b = side();
  const end = (me, other) => ({
    postMessage: (m) => { if (me.closed) throw new Error('closed'); const c = structuredClone(m); setTimeout(() => { if (!other.closed) other.on.forEach((f) => f(c)); }, 0); },
    onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) },
    disconnect: () => { if (me.closed) return; me.closed = true; setTimeout(() => { if (!other.closed) { other.closed = true; other.gone.forEach((f) => f()); } }, 0); },
    get closed() { return me.closed; },
  });
  return [end(a, b), end(b, a)];
};
// Stand-in tools, as Agents registers them (agents/tools-study.js's shape): a read and the one write.
const tools = () => {
  const reg = TL.registry(), wrote = [];
  reg.add({ name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-do list', description: 'To-dos', parameters: A.SPECS.find((s) => s.name === 'todo_list').parameters,
    run: async (args, ctx) => ({ account: ctx.account, at: 5, items: TODO.items, note: 'a tool may not set this', source: 'tab' }) });
  reg.add({ name: 'todo_mark_done', kind: 'write', group: 'courses', scope: 'account', title: 'Mark a to-do done', description: 'Mark', parameters: A.SPECS.find((s) => s.name === 'todo_mark_done').parameters,
    summarize: async (args) => `Mark item ${args.id} done.`, run: async (args) => { wrote.push(args); return { ok: true, marked: args.id }; } });
  reg.add({ name: 'grades_list', kind: 'read', group: 'grades', scope: 'account', title: 'Grades', description: 'Grades', parameters: A.SPECS.find((s) => s.name === 'grades_list').parameters,
    run: async () => ({ ok: false, error: 'Glaze has no grades yet.' }) });
  return { reg, wrote };
};
// The worker's side as background/background.js builds it, with a stand-in broker that answers runs from a script.
const harness = ({ script = {}, approve = 'yes', allowed = true, ai = { on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } } } = {}) => {
  const { reg, wrote } = tools();
  const seen = { runs: [], asks: [], statuses: 0 }, st = { ai };
  const broker = (port) => {
    port.onMessage.addListener(async (m) => {
      if (m.op === 'status') { seen.statuses++; return port.postMessage({ id: m.id, type: 'status', on: true, allowed: true, ready: true, provider: 'openai' }); }
      if (m.op === 'cancel') return;
      seen.runs.push(m);
      const list = script[m.task] || [];
      const next = list[seen.runs.filter((r) => r.task === m.task).length - 1];
      if (!next) return port.postMessage({ id: m.id, type: 'error', error: 'check' });
      if (next.error) return port.postMessage({ id: m.id, type: 'error', error: next.error });
      port.postMessage({ id: m.id, type: 'end', output: typeof next === 'function' ? await next(m.input) : next });
    });
  };
  const env = {
    allowed: async () => (typeof allowed === 'function' ? allowed() : allowed), broker, settings: async () => st.ai, enabled: async () => true,
    registry: { get: (name) => reg.get(name), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}),
    approve: { ask: async (kind, view, o) => { seen.asks.push({ kind, view }); o?.progress?.(1, undefined, 'Waiting'); return typeof approve === 'function' ? approve() : approve; } },
    refresh: async () => null, accounts: async () => [{ account: TODO.account }], local: {}, keys: async () => [], now: () => 1e12, turn: (f) => f(), zone: 'UTC',
  };
  const [page, worker] = ports();
  K.connect(worker, env);
  const got = [];
  page.onMessage.addListener((m) => got.push(m));
  return { page, got, seen, wrote, st, say: (m) => page.postMessage(m), ends: () => got.filter((m) => ['end', 'error'].includes(m.type)) };
};

test('port: a study question runs study.help through the broker, as the feature ask, with its subject and locale', async () => {
  const h = harness({ script: { 'study.help': [{ kind: 'hint', step: null, reply: 'What could you do to both sides?', followUp: null }] } });
  h.say({ id: 1, op: 'ask', question: 'How do I solve 3x + 5 = 20?', locale: 'de' });
  await settle();
  assert.deepEqual(h.seen.runs.map((r) => [r.op, r.feature, r.task, r.input]), [['run', 'ask', 'study.help', { question: 'How do I solve 3x + 5 = 20?', subject: 'math', locale: 'de' }]]);
  assert.deepEqual(h.got.map((m) => m.type), ['route', 'end']);
  assert.deepEqual(h.got[1], { id: 1, type: 'end', task: 'study.help', output: { kind: 'hint', step: null, reply: 'What could you do to both sides?', followUp: null } });
});

test('port: an agent question runs its steps through agents/calls.js; results as the tool gave them; the write waits for the student', async () => {
  const h = harness({ script: { 'agent.tools': [asks('todo_list', { days: 7 }), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Marked Lab report done.')] } });
  h.say({ id: 3, op: 'ask', question: 'Mark my Lab report done', locale: 'en' });
  await settle(60);
  assert.deepEqual(h.got.map((m) => m.type).filter((t) => t !== 'keepalive'), ['route', 'look', 'approve', 'end']);
  assert.deepEqual(h.ends(), [{ id: 3, type: 'end', task: 'agent.tools', answer: { text: 'Marked Lab report done.' } }]);
  const [, second, third] = h.seen.runs;
  assert.deepEqual(second.input.steps[0].result, { account: TODO.account, at: 5, items: TODO.items }, 'the tool\'s own answer, as training saw it: none of the wrapper\'s note, source or age');
  assert.deepEqual(third.input.steps[1].result, { account: TODO.account, at: null, ok: true, marked: '1' });
  assert.equal(second.input.zone, 'UTC');
  assert.equal(second.input.now, 1e12);
  assert.deepEqual(h.seen.asks.map((a) => [a.kind, a.view.summary, a.view.app.name]), [['action', 'Mark item 1 done.', 'Ask Glaze']]);
  assert.deepEqual(h.wrote, [{ type: 'assignment', id: '1' }], 'run once, after the yes');
});

test('port: a declined write runs nothing and asks the model nothing more', async () => {
  const h = harness({ approve: 'no', script: { 'agent.tools': [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Done!')] } });
  h.say({ id: 4, op: 'ask', question: 'Mark my Lab report done', locale: 'en' });
  await settle(60);
  assert.deepEqual(h.ends(), [{ id: 4, type: 'end', task: 'agent.tools', declined: true }]);
  assert.deepEqual(h.wrote, []);
  assert.equal(h.seen.runs.length, 2);
});

test('port: a tool\'s failure is the model\'s to read; an answer that hands over work is refused on this path too', async () => {
  const h = harness({ script: { 'agent.tools': [asks('grades_list'), said('The answer is x = 5.')] } });
  h.say({ id: 5, op: 'ask', question: 'What are my grades?', locale: 'en' });
  await settle(60);
  assert.deepEqual(h.seen.runs[1].input.steps[0].result, { ok: false, error: 'Glaze has no grades yet.' });
  assert.deepEqual(h.ends(), [{ id: 5, type: 'error', error: 'check' }]);
});

test('port: Ask turned off, a sender refused, a second question while one runs, a cancel, a bad message', async () => {
  const off = harness({ script: { 'agent.tools': [(inp) => { off.st.ai = { ...off.st.ai, features: { ask: false } }; return asks('todo_list'); }, said('x')] } });
  off.say({ id: 6, op: 'ask', question: 'What is due this week?', locale: 'en' });
  await settle(60);
  assert.deepEqual(off.ends(), [{ id: 6, type: 'error', error: 'off' }]);

  const refused = harness({ allowed: false });
  refused.say({ id: 7, op: 'ask', question: 'What is due?', locale: 'en' });
  await settle();
  assert.equal(refused.page.closed, true, 'the port is closed');
  assert.deepEqual(refused.seen.runs, []);

  const busy = harness({ script: { 'study.help': [() => new Promise(() => {})] } });
  busy.say({ id: 8, op: 'ask', question: 'Explain mitosis', locale: 'en' });
  busy.say({ id: 9, op: 'ask', question: 'Explain meiosis', locale: 'en' });
  await settle();
  assert.deepEqual(busy.ends(), [{ id: 9, type: 'error', error: 'busy' }]);
  busy.say({ id: 8, op: 'cancel' });
  await settle();
  assert.deepEqual(busy.ends().at(-1), { id: 8, type: 'error', error: 'cancelled' });

  const bad = harness();
  for (const m of [{ id: 10, op: 'ask', question: '' }, { id: 11, op: 'ask', question: 'x'.repeat(2001) }, { id: 12, op: 'ask', question: 'Explain', attempt: 3 }, { id: 13, op: 'nope' }]) bad.say(m);
  await settle();
  assert.deepEqual(bad.ends().map((m) => [m.id, m.error]), [[10, 'request'], [11, 'size'], [12, 'request'], [13, 'request']]);
  bad.say({ id: 14, op: 'status' });
  await settle();
  assert.deepEqual(bad.got.at(-1), { id: 14, type: 'status', on: true, allowed: true, ready: true, provider: 'openai' });
});

test('an episode\'s seven runs fit agent.tools\' own rate: six questions a minute in a tab', () => {
  assert.deepEqual(A.task.rate, { perMinute: 6 * (A.LIMIT.steps + 1) });
  assert.equal(A.task.rate.supersede, undefined, 'a newer question never cancels a step in flight');
});
