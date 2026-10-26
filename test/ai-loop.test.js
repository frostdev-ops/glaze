// The AI harness's tools and agent loop (lib/ai/tools.js, lib/ai/loop.js) with the mock provider and mock tools: arguments
// checked against each tool's schema, a bad call or a failing tool told to the model rather than thrown, proposals instead
// of side effects, and the step, time and token limits and a cancel.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/ai/providers.js');
require('../lib/ai/providers/mock.js');
const TL = require('../lib/ai/tools.js');
const L = require('../lib/ai/loop.js');

const courses = TL.define({ name: 'courses_list', description: 'The student\'s courses.', params: { type: 'object', properties: { term: { type: 'string', enum: ['fall', 'spring'] } }, required: ['term'], additionalProperties: false },
  run: async ({ term }) => [{ id: 'c1', name: `Biology (${term})` }] });
const remind = TL.define({ name: 'reminder_propose', description: 'Propose a reminder.', params: { type: 'object', properties: { at: { type: 'string' } }, required: ['at'], additionalProperties: false },
  run: async ({ at }) => ({ proposal: { kind: 'reminder', at } }) });
const broken = TL.define({ name: 'broken', description: 'Fails.', run: async () => { throw new Error('internal path /secret/x'); } });
const request = { messages: [{ role: 'system', content: 'Help.' }, { role: 'user', content: 'What are my courses?' }] };
const mock = (replies) => ({ replies, seen: [] });
const go = (cfg, more = {}) => L.run({ request, tools: [courses, remind, broken], call: (r, o) => P.run('mock', r, cfg, o), ...more });
const toolText = (req) => req.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content[0].text));

test('the model calls a tool, gets its data, and answers', async () => {
  const cfg = mock([{ toolCalls: [{ id: 'c1', name: 'courses_list', args: { term: 'fall' } }], usage: { input: 10, output: 5 } }, { text: 'You take Biology.', usage: { input: 20, output: 4 } }]);
  const steps = [];
  const out = await go(cfg, { onStep: (s) => steps.push(s) });
  assert.equal(out.text, 'You take Biology.');
  assert.equal(out.steps, 2);
  assert.deepEqual(out.usage, { input: 30, output: 9 });
  assert.deepEqual(steps, [{ step: 1, calls: ['courses_list'] }, { step: 2, calls: [] }]);
  assert.deepEqual(cfg.seen[0].tools.map((t) => t.name), ['courses_list', 'reminder_propose', 'broken']);
  const second = cfg.seen[1];
  assert.deepEqual(second.messages.at(-2), { role: 'assistant', content: [], toolCalls: [{ id: 'c1', name: 'courses_list', args: { term: 'fall' } }] });
  assert.deepEqual(toolText(second), [{ data: [{ id: 'c1', name: 'Biology (fall)' }] }]);
  assert.equal(second.messages.at(-1).toolCallId, 'c1');
});

test('arguments that do not fit, an unknown tool and a failing tool go back to the model as errors, with no tool\'s own words', async () => {
  const ran = [];
  const watched = TL.define({ ...courses, run: async (a) => { ran.push(a); return []; } });
  const cfg = mock([{ toolCalls: [{ id: 'a', name: 'courses_list', args: { term: 'winter' } }, { id: 'b', name: 'courses_list', args: '{"term": fall' }, { id: 'c', name: 'delete_all', args: {} }, { id: 'd', name: 'broken', args: {} }] }, { text: 'Sorry.' }]);
  const out = await L.run({ request, tools: [watched, broken], call: (r, o) => P.run('mock', r, cfg, o) });
  assert.equal(out.text, 'Sorry.');
  assert.deepEqual(ran, [], 'a tool never runs on arguments that do not fit');
  const [a, b, c, d] = toolText(cfg.seen[1]);
  assert.match(a.error, /^invalid arguments: \$\.term: not one of the allowed values/);
  assert.match(b.error, /^invalid arguments: \$: expected object, got string/);
  assert.equal(c.error, 'no tool named delete_all');
  assert.equal(d.error, 'failed');
  assert.ok(!JSON.stringify(cfg.seen[1]).includes('/secret/'));
});

test('a tool proposes, it never acts: proposals come back with the answer for the page to show', async () => {
  const cfg = mock([{ toolCalls: [{ id: 'r', name: 'reminder_propose', args: { at: '2026-11-02T09:00' } }] }, { text: 'Proposed.' }]);
  const out = await go(cfg);
  assert.deepEqual(out.proposals, [{ tool: 'reminder_propose', proposal: { kind: 'reminder', at: '2026-11-02T09:00' } }]);
  assert.deepEqual(toolText(cfg.seen[1]), [{ proposed: { kind: 'reminder', at: '2026-11-02T09:00' } }]);
  assert.throws(() => TL.define({ ...courses, kind: 'write' }), /kind/, 'only read tools exist');
  assert.throws(() => TL.define({ ...courses, name: 'courses.list' }), /name/);
  assert.throws(() => TL.define({ ...courses, params: { type: 'object', format: 'x' } }), /params/);
  assert.throws(() => TL.define({ ...courses, extra: true }), /unknown extra/);
});

test('a tool\'s answer is data within its limit, given a copy of its arguments and the run\'s signal', async () => {
  const huge = TL.define({ name: 'huge', description: 'd', run: async () => 'x'.repeat(TL.LIMIT.output + 1) });
  assert.deepEqual(await TL.call(huge, {}), { ok: false, error: 'size' });
  const cyclic = TL.define({ name: 'cyclic', description: 'd', run: async () => { const o = {}; o.o = o; return o; } });
  assert.deepEqual(await TL.call(cyclic, {}), { ok: false, error: 'failed' });
  const args = { term: 'fall' };
  const mutating = TL.define({ ...courses, run: async (a, { signal }) => { a.term = 'changed'; return signal instanceof AbortSignal; } });
  assert.deepEqual(await TL.call(mutating, args), { ok: true, data: true });
  assert.equal(args.term, 'fall');
  const r = TL.registry();
  r.add(courses);
  assert.equal(r.get('courses_list'), courses);
  assert.throws(() => r.add({ ...courses }), /already added/);
});

test('steps, tokens and time are limited, and each limit has its code', async () => {
  const forever = () => mock((req, n) => ({ toolCalls: [{ id: `c${n}`, name: 'courses_list', args: { term: 'fall' } }], usage: { input: 10, output: 10 } }));
  await assert.rejects(go(forever(), { limits: { steps: 3 } }), { code: 'steps' });
  await assert.rejects(go(forever(), { limits: { tokens: 50 } }), { code: 'limit' });
  let t = 0;
  await assert.rejects(go(forever(), { limits: { ms: 5000 }, now: () => (t += 3000) }), { code: 'timeout' });
  assert.equal(L.run.length, 1);
  // Over the most a limit may be, it is the most.
  const cfg = forever();
  await assert.rejects(go(cfg, { limits: { steps: 1e6 } }), (e) => ['steps', 'limit'].includes(e.code));
  assert.ok(cfg.seen.length <= L.LIMIT.steps[1]);
});

test('a cancel stops the loop inside a step and between steps', async () => {
  const c = new AbortController();
  const slow = mock([{ toolCalls: [{ id: 'a', name: 'courses_list', args: { term: 'fall' } }] }, { text: 'late', wait: 5000 }]);
  const p = go(slow, { signal: c.signal, onStep: () => setTimeout(() => c.abort(), 5) });
  await assert.rejects(p, { code: 'cancelled' });
  const hold = TL.define({ name: 'hold', description: 'd', run: (a, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
  const c2 = new AbortController();
  const p2 = L.run({ request, tools: [hold], call: (r, o) => P.run('mock', r, mock([{ toolCalls: [{ id: 'h', name: 'hold', args: {} }] }, { text: 'never' }]), o), signal: c2.signal });
  setTimeout(() => c2.abort(), 5);
  await assert.rejects(p2, { code: 'cancelled' });
});
