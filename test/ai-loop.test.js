// The AI harness's tools and agent loop (lib/ai/tools.js, lib/ai/loop.js), with the mock provider and mock tools, on the rules
// ported from Rimeward's runLoop (MIT): a batch triaged whole with every refusal answered as data, `reason` required, one
// approval waiting per batch, the policy re-read before a call and only narrowing, a stop answering every call { notRun },
// results in call order and within 12k characters, the round cap, and the conversation repaired before each request.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/ai/providers.js');
require('../lib/ai/providers/mock.js');
const TL = require('../lib/ai/tools.js');
const L = require('../lib/ai/loop.js');
const S = require('../lib/ai/schema.js');

const courses = TL.define({ name: 'courses_list', kind: 'read', description: 'The student\'s courses.', parameters: S.obj({ term: { type: 'string', enum: ['fall', 'spring'] } }, ['term']),
  run: async ({ term }) => [{ id: 'c1', name: `Biology (${term})` }] });
const remind = TL.define({ name: 'reminder_add', kind: 'confirm', description: 'Add a reminder.', parameters: S.obj({ at: S.str('When.') }, ['at']),
  run: async ({ at }) => ({ kind: 'reminder', at }), summarize: ({ at }) => `Add a reminder at ${at}?` });
const erase = TL.define({ name: 'notes_clear', kind: 'write', description: 'Clear notes.', run: async () => ({ ok: true }) });
const broken = TL.define({ name: 'broken', kind: 'read', description: 'Fails.', run: async () => { throw new Error('the course list is offline'); } });
const request = { messages: [{ role: 'system', content: 'Help.' }, { role: 'user', content: 'What are my courses?' }] };
const mock = (replies) => ({ replies, seen: [] });
const go = (cfg, more = {}) => L.run({ request, tools: [courses, remind, erase, broken], call: (r, o) => P.run('mock', r, cfg, o), ...more });
const answers = (req) => req.messages.filter((m) => m.role === 'tool').map((m) => ({ id: m.toolCallId, ...JSON.parse(m.content[0].text) }));
const call = (id, name, args) => ({ id, name, args });

test('the model calls a tool with its reason, gets the data, and answers; the events tell it as it happens', async () => {
  const cfg = mock([{ toolCalls: [call('c1', 'courses_list', { term: 'fall', reason: 'Listing your courses.' })], usage: { input: 10, output: 5 } }, { text: 'You take Biology.', usage: { input: 20, output: 4 } }]);
  const events = [];
  const out = await go(cfg, { emit: (e) => events.push(e) });
  assert.equal(out.reply, 'You take Biology.');
  assert.equal(out.rounds, 2);
  assert.deepEqual(out.usage, { input: 30, output: 9 });
  assert.deepEqual(out.steps.map(({ ms, ...s }) => s), [{ id: 'c1', round: 0, tool: 'courses_list', kind: 'read', args: { term: 'fall', reason: 'Listing your courses.' }, reason: 'Listing your courses.', result: [{ id: 'c1', name: 'Biology (fall)' }] }]);
  assert.deepEqual(events.map((e) => e.type), ['thinking', 'usage', 'step_start', 'step', 'thinking', 'usage', 'reply']);
  // Every tool offered carries a required reason; a write isn't offered on a read-only run.
  const offered = cfg.seen[0].tools;
  assert.deepEqual(offered.map((t) => t.name), ['broken', 'courses_list', 'notes_clear', 'reminder_add']);
  assert.deepEqual(offered.find((t) => t.name === 'courses_list').parameters.required, ['reason', 'term']);
  assert.deepEqual(TL.aiTools([courses, remind, erase], 'read-only').map((t) => t.name), ['courses_list']);
  assert.deepEqual(JSON.parse(cfg.seen[1].messages.at(-1).content[0].text), [{ id: 'c1', name: 'Biology (fall)' }], 'the tool\'s data as it gave it');
  assert.equal(cfg.seen[1].messages.at(-1).toolCallId, 'c1');
});

test('each refusal in a batch is answered as data, and a tool\'s error is data too; answers land in call order', async () => {
  const ran = [];
  const slow = TL.define({ ...courses, run: async (a) => { await new Promise((r) => setTimeout(r, 30)); ran.push('slow'); return 'slow'; } });
  const fast = TL.define({ ...courses, name: 'fast', run: async () => { ran.push('fast'); return 'fast'; } });
  const cfg = mock([{ toolCalls: [
    call('a', 'courses_list', { term: 'fall', reason: 'Slow first.' }),
    call('b', 'fast', { term: 'fall', reason: 'Fast second.' }),
    call('c', 'delete_all', { reason: 'x' }),
    call('d', 'courses_list', '{"term": fall'),
    call('e', 'courses_list', { term: 'fall' }),
    call('f', 'courses_list', { term: 'winter', reason: 'Bad term.' }),
    call('g', 'broken', { reason: 'Try it.' }),
  ] }, { text: 'Done.' }]);
  await L.run({ request, tools: [slow, fast, broken], call: (r, o) => P.run('mock', r, cfg, o) });
  assert.deepEqual(ran, ['fast', 'slow'], 'run together');
  assert.deepEqual(answers(cfg.seen[1]).map((a) => a.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'answered in call order');
  const [a, b, c, d, e, f, g] = cfg.seen[1].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content[0].text));
  assert.deepEqual([a, b], ['slow', 'fast']);
  assert.deepEqual(c, { error: 'no such tool: delete_all' });
  assert.deepEqual(d, { error: 'Tool arguments must be a JSON object. Retry with the tool’s schema.' });
  assert.match(e.error, /^Rejected: every tool call requires a `reason`/);
  assert.match(f.error, /^invalid arguments: \$\.term: not one of the allowed values/);
  assert.deepEqual(g, { error: 'the course list is offline' });
});

test('one approval waits per batch: the first confirm parks with a summary from data, others wait, reads still run', async () => {
  const confirms = new Map();
  const cfg = mock([{ text: 'Proposing.', toolCalls: [call('r1', 'reminder_add', { at: '2026-11-02T09:00', reason: 'Remind you of the quiz.' }), call('r2', 'reminder_add', { at: '2026-11-03T09:00', reason: 'Another.' }), call('c1', 'courses_list', { term: 'fall', reason: 'Check.' })] }]);
  const events = [];
  const out = await go(cfg, { confirms, emit: (e) => events.push(e) });
  assert.deepEqual(Object.keys(out.pending).sort(), ['confirmId', 'summary', 'tool']);
  assert.equal(out.pending.summary, 'Add a reminder at 2026-11-02T09:00?', 'built from the tool\'s data, not the model\'s reason');
  assert.equal(out.pending.tool, 'reminder_add');
  assert.deepEqual(events.filter((e) => e.type === 'pending'), [{ type: 'pending', pending: out.pending }]);
  assert.deepEqual(out.steps.map((s) => s.tool), ['courses_list'], 'the read ran');
  // The student's answer: single use, echo-checked, expiring.
  assert.throws(() => L.claimConfirm(confirms, 'x'.repeat(32)), /no longer current/);
  const parked = L.claimConfirm(confirms, out.pending.confirmId);
  assert.deepEqual(parked.args, { at: '2026-11-02T09:00' });
  assert.equal(parked.tool, remind);
  assert.throws(() => L.claimConfirm(confirms, out.pending.confirmId), /no longer current/, 'taken once');
  const late = new Map();
  const p2 = await L.parkConfirm(late, { call: { id: 'z' }, tool: remind, args: { at: 'x', reason: 'y' }, now: () => 0 });
  assert.throws(() => L.claimConfirm(late, p2.confirmId, () => L.LIMIT.confirm + 1), /expired/);
  assert.throws(() => L.claimConfirm(late, '../etc'), /not valid/);
});

test('policy: a read-only run refuses writes, an unattended one declines what would wait, and a narrowed policy stops a call before it runs', async () => {
  const ro = mock([{ toolCalls: [call('w', 'notes_clear', { reason: 'Tidy up.' })] }, { text: 'ok' }]);
  await go(ro, { policy: { tools: 'read-only', approvals: 'all' } });
  assert.deepEqual(answers(ro.seen[1]), [{ id: 'w', error: 'This run is read-only; only read tools may run.' }]);
  const unattended = mock([{ toolCalls: [call('r', 'reminder_add', { at: 'x', reason: 'y' })] }, { text: 'ok' }]);
  await go(unattended, { headless: true });
  assert.deepEqual(answers(unattended.seen[1]), [{ id: 'r', declined: true, note: "This needs the student's confirmation and nobody is watching. Nothing was run." }]);
  // A policy narrowing while the model answers prevents the proposed write.
  let ran = false, current = { tools: 'all', approvals: 'off' };
  const w = TL.define({ ...erase, run: async () => { ran = true; } });
  const later = mock([{ toolCalls: [call('w', 'notes_clear', { reason: 'Tidy up.' })] }, { text: 'ok' }]);
  const out = await L.run({ request, tools: [w], call: async (r, o) => { const result = await P.run('mock', r, later, o); current = { tools: 'read-only', approvals: 'off' }; return result; }, policy: () => current });
  assert.equal(ran, false);
  assert.equal(out.steps[0].error, 'read-only');
  assert.equal(L.narrow({ tools: 'read-only', approvals: 'off' }, { tools: 'all', approvals: 'off' }).tools, 'read-only', 'a policy only narrows');
  assert.equal(L.narrow({ tools: 'all', approvals: 'outbound' }, { tools: 'all', approvals: 'off' }).approvals, 'outbound');
  assert.ok(L.pauses('all', 'write') && L.pauses('outbound', 'confirm') && L.pauses('outbound', 'write') && L.pauses('off', 'confirm') && !L.pauses('all', 'read'));
});

test('every write and confirm waits for approval even when the requested approval policy is off or outbound', async () => {
  for (const approvals of ['off', 'outbound', 'all']) for (const kind of ['write', 'confirm']) {
    let ran = false;
    const tool = TL.define({ name: 'change_it', kind, description: 'Change something.', run: async () => { ran = true; } });
    const cfg = mock([{ toolCalls: [call('w', 'change_it', { reason: 'Change it.' })] }, { text: 'Done.' }]);
    const out = await L.run({ request, tools: [tool], policy: { tools: 'all', approvals }, call: (r, o) => P.run('mock', r, cfg, o) });
    assert.equal(ran, false, `${approvals}/${kind}`);
    assert.equal(out.pending?.tool, 'change_it');
  }
});

test('a policy restriction observed during a round remains in later rounds', async () => {
  let policy = { tools: 'all', approvals: 'all' }, n = 0;
  const read = TL.define({ name: 'read_it', kind: 'read', description: 'Read.', run: async () => { policy = { tools: 'all', approvals: 'all' }; return null; } });
  const requests = [];
  const out = await L.run({ request, tools: [read, erase], policy: () => policy, call: async (r) => {
    requests.push(r);
    if (n++ === 0) { policy = { tools: 'read-only', approvals: 'all' }; return { text: '', toolCalls: [call('r', 'read_it', { reason: 'Read.' })] }; }
    if (n === 2) return { text: '', toolCalls: [call('w', 'notes_clear', { reason: 'Clear.' })] };
    return { text: 'Done.' };
  } });
  assert.deepEqual(requests[1].tools.map((t) => t.name), ['read_it']);
  assert.equal(out.pending, undefined);
  assert.equal(out.steps.at(-1).error, 'read-only');
});

test('mutating the original policy object cannot restore write authority', async () => {
  const policy = { tools: 'read-only', approvals: 'all' };
  let n = 0; const requests = [];
  const out = await L.run({ request, tools: [courses, erase], policy: () => policy, call: async (r) => {
    requests.push(r);
    policy.tools = 'all';
    if (n++ === 0) return { text: '', toolCalls: [call('r', 'courses_list', { term: 'fall', reason: 'Read.' })] };
    return n === 2 ? { text: '', toolCalls: [call('w', 'notes_clear', { reason: 'Clear.' })] } : { text: 'Done.' };
  } });
  assert.deepEqual(requests[1].tools.map((t) => t.name), ['courses_list']);
  assert.equal(out.pending, undefined);
  assert.equal(out.steps.at(-1).error, 'read-only');
});

test('cancellation during a read cannot leave the same batch with a claimable approval', async () => {
  const controller = new AbortController(), confirms = new Map(), events = [];
  const read = TL.define({ name: 'cancel_read', kind: 'read', description: 'Read.', run: async () => { controller.abort(); return null; } });
  const outcome = await L.run({ request, tools: [read, erase], signal: controller.signal, confirms, emit: (e) => events.push(e),
    call: async () => ({ text: '', toolCalls: [call('w', 'notes_clear', { reason: 'Clear.' }), call('r', 'cancel_read', { reason: 'Read.' })] }),
  }).then(() => 'completed', (e) => e.code);
  assert.equal(outcome, 'cancelled');
  assert.equal(confirms.size, 0);
  assert.ok(!events.some((e) => e.type === 'pending'));
});

test('cancellation during an approval summary cannot insert or emit a late approval', async () => {
  const controller = new AbortController(), confirms = new Map(), events = [];
  let started, release;
  const entered = new Promise((r) => { started = r; }), gate = new Promise((r) => { release = r; });
  const tool = TL.define({ ...erase, summarize: async () => { started(); await gate; return 'Clear notes?'; } });
  const running = L.run({ request, tools: [tool], signal: controller.signal, confirms, emit: (e) => events.push(e),
    call: async () => ({ text: '', toolCalls: [call('w', 'notes_clear', { reason: 'Clear.' })] }),
  }).then(() => 'completed', (e) => e.code);
  await entered;
  controller.abort(); release();
  assert.equal(await running, 'cancelled');
  assert.equal(confirms.size, 0);
  assert.ok(!events.some((e) => e.type === 'pending'));
});

test('cancellation settles without waiting for a tool and suppresses its late events', async () => {
  const controller = new AbortController(), events = [];
  let started, release, outcome;
  const entered = new Promise((r) => { started = r; }), gate = new Promise((r) => { release = r; });
  const tool = TL.define({ name: 'slow_read', kind: 'read', description: 'Read.', run: async () => { started(); await gate; return { ok: true }; } });
  const running = L.run({ request, tools: [tool], signal: controller.signal, emit: (e) => events.push(e),
    call: async () => ({ text: '', toolCalls: [call('r', 'slow_read', { reason: 'Read.' })] }),
  }).then(() => { outcome = 'completed'; }, (e) => { outcome = e.code; });
  await entered; controller.abort();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  const beforeRelease = outcome, count = events.length;
  release(); await running;
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.equal(beforeRelease, 'cancelled', 'the cancelled run must settle while the tool is still pending');
  assert.equal(events.length, count, 'a late tool completion cannot emit after cancellation');
});

test('a stop while the model answers runs nothing: every call is answered { notRun }', async () => {
  const c = new AbortController();
  let ran = false;
  const w = TL.define({ ...courses, run: async () => { ran = true; } });
  const steps = [];
  const p = L.run({ request, tools: [w], signal: c.signal, emit: (e) => e.type === 'step' && steps.push(e.step),
    call: async () => { c.abort(); return { text: '', toolCalls: [call('a', 'courses_list', { term: 'fall', reason: 'x' })], provider: 'mock', model: '', finish: 'tool' }; } });
  await assert.rejects(p, { code: 'cancelled' });
  assert.equal(ran, false);
  assert.deepEqual(steps.map((s) => s.error), ['not run — the run was stopped']);
  const hold = TL.define({ name: 'hold', kind: 'read', description: 'd', run: (a, { signal }) => new Promise((res, rej) => signal.addEventListener('abort', () => rej(signal.reason))) });
  const c2 = new AbortController();
  const p2 = L.run({ request, tools: [hold], call: (r, o) => P.run('mock', r, mock([{ toolCalls: [call('h', 'hold', { reason: 'wait' })] }, { text: 'never' }]), o), signal: c2.signal });
  setTimeout(() => c2.abort(), 5);
  await assert.rejects(p2, { code: 'cancelled' });
});

test('a tool answer over 12k characters becomes an omission receipt, never torn JSON', () => {
  assert.equal(L.output({ a: 1 }), '{"a":1}');
  const big = JSON.parse(L.output({ ok: true, rows: 'x'.repeat(20000) }));
  assert.deepEqual(Object.keys(big), ['resultOmitted', 'outcome', 'note']);
  assert.equal(big.outcome, 'succeeded');
  assert.equal(JSON.parse(L.output({ error: 'boom', rows: 'x'.repeat(20000) })).outcome, 'failed');
  assert.equal(JSON.parse(L.output({ notRun: true, rows: 'x'.repeat(20000) })).outcome, 'not-run');
  assert.equal(JSON.parse(L.output('x'.repeat(20000))).outcome, 'unknown');
});

test('rounds are capped (24 by default, never uncapped), and tokens and time too', async () => {
  const forever = () => mock((req, n) => ({ toolCalls: [call(`c${n}`, 'courses_list', { term: 'fall', reason: 'Again.' })], usage: { input: 10, output: 10 } }));
  const out = await go(forever(), { rounds: 3 });
  assert.deepEqual([out.paused, out.rounds, out.reply], [true, 3, '(paused after 3 tool rounds)']);
  assert.equal((await go(forever(), { rounds: 0 })).rounds, 24, '0 is not "no cap" here');
  assert.equal((await go(forever(), { rounds: 99 })).rounds, 24);
  assert.deepEqual([L.parseRounds(''), L.parseRounds(' 3 '), L.parseRounds('x'), L.parseRounds(-1), L.parseRounds(0)], [null, 3, null, null, 0]);
  await assert.rejects(go(forever(), { limits: { tokens: 50 } }), { code: 'limit' });
  let t = 0;
  await assert.rejects(go(forever(), { limits: { ms: 5000 }, now: () => (t += 3000) }), { code: 'timeout' });
});

test('the conversation is repaired before each request: an unanswered call is answered interrupted, an orphan answer dropped, a parked call kept open', () => {
  const text = (m) => JSON.parse(m.content[0].text);
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'q' }] }, { role: 'tool', toolCallId: 'orphan', content: [{ type: 'text', text: '{}' }] },
    { role: 'assistant', content: [], toolCalls: [{ id: 'a', name: 'x', args: {} }, { id: 'parked', name: 'y', args: {} }] }];
  const fixed = L.repair(msgs, new Set(['parked']));
  assert.deepEqual(fixed.map((m) => m.toolCallId || m.role), ['user', 'assistant', 'a']);
  assert.equal(text(fixed[2]).interrupted, true);
  assert.deepEqual(L.repair(fixed, new Set(['parked'])), fixed, 'repairing twice changes nothing');
});

test('tools: defined with a kind, a snake_case name and no reason of their own; a sandbox reaches read tools only', async () => {
  assert.throws(() => TL.define({ ...courses, kind: 'admin' }), /kind/);
  assert.throws(() => TL.define({ ...courses, name: 'courses.list' }), /name/);
  assert.throws(() => TL.define({ ...courses, parameters: S.obj({ reason: S.str('x') }) }), /parameters/);
  assert.throws(() => TL.define({ ...courses, extra: 1 }), /unknown extra/);
  const r = TL.registry();
  r.add(courses); r.add(remind);
  assert.equal(await TL.invokeReadTool(r, 'courses_list', '{"term":"spring"}'), '[{"id":"c1","name":"Biology (spring)"}]');
  await assert.rejects(TL.invokeReadTool(r, 'reminder_add', '{"at":"x"}'), /not a read-only tool/);
  await assert.rejects(TL.invokeReadTool(r, 'courses_list', '{"term":"winter"}'), /invalid arguments/);
  assert.throws(() => r.add({ ...courses }), /already added/);
  assert.equal(TL.toolFailure({ error: 'x' }), 'x');
  assert.equal(TL.toolFailure({ ok: false }), 'Tool reported failure.');
  assert.equal(TL.toolFailure({ ok: true }), null);
});
