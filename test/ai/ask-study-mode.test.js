// Study mode (ai/ask.js study path, ai/tasks/study-help.js): the reader that looks up records before study help answers keeps
// what it read however it stops, never re-reads a list it already has, and study help may name what was read while still
// refusing to hand over work.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/ai/schema.js');
require('../../extension/ai/failure.js');
require('../../extension/ai/loop.js');
require('../../extension/agents/grants.js');
globalThis.GZ_MCP_CALLS = require('../../extension/agents/calls.js');
const R = require('../../extension/ai/request.js');
const SH = require('../../extension/ai/tasks/study-help.js');
const K = require('../../extension/ai/ask.js');

const TODO = { account: 'https://school.blackboard.com/_5_1', items: [{ id: '_1', type: 'assignment', courseId: '_25_1', course: 'MATH 1160', title: 'Quiz 3: Derivatives', due: 2 }] };
const said = (text) => ({ call: null, answer: { text, quotes: [] } });
const asks = (name, args = {}) => ({ call: { name, arguments: args, kind: 'read' }, answer: null });
const refused = (why) => () => { throw Object.assign(R.error('check'), { why }); };
const reader = (outs) => {
  const runs = [], calls = [];
  const run = async (task, input) => { runs.push(input); const o = outs[runs.length - 1]; if (!o) throw new Error('no more'); return typeof o === 'function' ? o(input) : o; };
  const call = async (c) => { calls.push(c); return { result: TODO }; };
  return { runs, calls, go: () => K.episode({ question: 'Help me study for my next test', tools: ['todo_list', 'assignments_list', 'assignment_read', 'accounts_list'],
    locale: 'en', now: 1e12, zone: 'UTC', run, call, first: true, help: 'other', reader: true }) };
};

test('reader: a seventh call ends reading with the six reads kept', async () => {
  const r = reader([...[1, 2, 3, 4, 5, 6].map((n) => asks('assignment_read', { assignment: `_${n}` })), asks('assignment_read', { assignment: '_7' })]);
  const out = await r.go();
  assert.equal(out.steps.length, 6);
  assert.equal(r.calls.length, 6);
});

test('reader: an answer that fails its check after a read ends reading with the read kept, no corrective turn', async () => {
  const r = reader([asks('todo_list'), refused('first')]);
  const out = await r.go();
  assert.equal(out.steps.length, 1);
  assert.equal(r.runs.length, 2);
});

test('reader: a list read again for the same target with new filters ends reading, unrun', async () => {
  const r = reader([asks('todo_list'), asks('todo_list', { days: 7 }), said('done')]);
  const out = await r.go();
  assert.deepEqual(r.calls.map((c) => c.name), ['todo_list']);
  assert.equal(out.steps.length, 1);
  const named = reader([asks('todo_list'), asks('todo_list', { account: TODO.account }), said('done')]);
  assert.equal((await named.go()).steps.length, 1, 'the account the first read used, named, is the same list');
  const other = reader([asks('todo_list'), asks('todo_list', { account: 'https://school.blackboard.com/_6_1' }), said('done')]);
  assert.equal((await other.go()).steps.length, 2, 'another account is another list');
  const two = reader([asks('assignment_read', { assignment: '_1' }), asks('assignment_read', { assignment: '_2' }), said('done')]);
  assert.equal((await two.go()).steps.length, 2, 'two different items are two reads');
});

test('reader: a refused first answer still gets its corrective turn', async () => {
  const r = reader([refused('first'), asks('todo_list'), said('done')]);
  const out = await r.go();
  assert.equal(out.steps.length, 1);
  assert.equal(r.runs[1].fix, 'first');
});

const records = JSON.stringify({ source: 'todo_list', text: JSON.stringify({ items: [{ course: 'MATH 1160', title: 'Quiz 3: Derivatives', due: 'Sunday, November 8, 11:59 PM' }] }) });
const input = (o) => SH.task.input({ question: 'please find what quiz or test is next and help me study for it', subject: 'other', locale: 'en', ...o }, {});

test('study help: records arrive as their own data block', () => {
  const inp = input({ records });
  assert.equal(inp.records, records);
  const built = SH.task.build(inp, { text: { request: (r) => r } });
  assert.ok(built.data.some((d) => d.label === 'records' && d.text === records));
  assert.equal(input({ records: 5 }), null);
});

test('study help: naming a record and helping prepare for it passes, in every kind', () => {
  const inp = input({ records });
  const reply = 'Quiz 3: Derivatives in MATH 1160 is due Sunday. Review the chain rule and the product rule first.';
  for (const kind of ['hint', 'concept']) assert.equal(SH.why({ kind, step: null, reply, followUp: 'Which rule feels shakiest?' }, inp), '', kind);
  assert.equal(SH.why({ kind: 'question', step: null, reply: 'Quiz 3: Derivatives in MATH 1160 is due Sunday. Which derivative rules can you already use?', followUp: null }, inp), '');
});

test('study help: records still hold the answer-giving rules', () => {
  const math = input({ subject: 'math', records: JSON.stringify({ source: 'assignment_read', text: 'Quiz 3 question 1: Solve 3x + 5 = 20' }) });
  assert.notEqual(SH.why({ kind: 'hint', step: null, reply: 'For question 1, x = 5.', followUp: null }, math), '');
  const essay = input({ subject: 'essay', question: 'help me with my essay', records: JSON.stringify({ source: 'assignment_read', text: 'Essay: the green light in The Great Gatsby' }) });
  assert.equal(SH.why({ kind: 'hint', step: null, reply: 'The green light in The Great Gatsby stands for the hope Gatsby can never reach.', followUp: null }, essay), 'speaks');
});

test('study help: a follow-up may repeat the question and report what the records cover (live reply, 2026-11-06)', () => {
  const schedule = [JSON.stringify({ today: 'Friday, November 6' }), JSON.stringify({ source: 'schedule_list', text: JSON.stringify({ covers: { from: 'Thursday, October 29, 12:00 AM', to: 'Sunday, November 15, 12:00 AM' }, items: [] }) })].join('\n');
  const history = [{ question: 'Help me study for my next test', answer: 'Which course or topic should we focus on?' }];
  const inp = input({ records: schedule, history });
  const reply = 'The schedule covers Thursday, October 29, 12:00 AM through Sunday, November 15, 12:00 AM, and it has no quiz or test items. The earlier chat asked which course or topic to focus on, but it didn’t name one. Which course or topic should we study first?';
  assert.equal(SH.why({ kind: 'concept', step: null, reply, followUp: null }, inp), '');
});

test('reader: a refused call after a read gets one corrective turn, then reading ends with what it read', async () => {
  const fixed = reader([asks('todo_list'), refused('id'), asks('assignments_list'), said('done')]);
  const out = await fixed.go();
  assert.equal(out.steps.length, 2);
  assert.equal(fixed.runs[2].fix, 'id');
  const twice = reader([asks('todo_list'), refused('id'), refused('id')]);
  assert.equal((await twice.go()).steps.length, 1);
});

test('study help: in a chat about a paper, a follow-up\'s own words stay guarded', () => {
  const inp = input({ question: 'What does the green light mean?', history: [{ question: 'Help me with my essay on The Great Gatsby', answer: 'What is your thesis so far?' }] });
  assert.equal(SH.why({ kind: 'concept', step: null, reply: 'The green light means hope and longing for the future.', followUp: null }, inp), 'speaks');
});
