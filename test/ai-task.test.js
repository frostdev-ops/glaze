// The AI harness's tasks (lib/ai/task.js) with an example task that lives only here (the first real one is syllabus.read):
// definitions checked when added, the input cleaned, the request fenced, the answer checked against the schema and then
// grounded by the task's check, long inputs in parts, and the refusals each have their code.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/ai/task.js');
const X = require('../lib/ai/text.js');
require('../lib/ai/providers/mock.js');
const A = require('../lib/ai/settings.js');

// example.dates: the dated items in a text, each with the words it was read from; what isn't in the text is dropped.
const dates = {
  id: 'example.dates', version: 2, caps: {},
  input: (raw) => (typeof raw?.text === 'string' && raw.text.trim() && raw.text.length <= 200000 ? { text: raw.text } : null),
  build: (input, { text }) => text.request({ system: 'List each dated item in the syllabus with the exact words it is written in.', data: [{ label: 'syllabus', text: input.text }], maxTokens: 400 }),
  output: { type: 'object', properties: { items: { type: 'array', maxItems: 50, items: { type: 'object', properties: { title: { type: 'string', maxLength: 120 }, date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, quote: { type: 'string', maxLength: 300 } }, required: ['title', 'date', 'quote'], additionalProperties: false } } }, required: ['items'], additionalProperties: false },
  check: (output, input) => { const src = X.source(input.text); return { items: output.items.filter((i) => src.has(i.quote)) }; },
};
const SYLLABUS = 'BIO 101\nMidterm exam — Oct 12, 2026 (25%).\nFinal project due December 5, 2026.';
const answer = (items) => ({ json: { items } });

test('a task runs: input cleaned, request fenced with instructions only in system, answer checked and grounded', async () => {
  const task = T.define(dates);
  const cfg = { replies: [answer([{ title: 'Midterm', date: '2026-10-12', quote: 'Midterm exam - Oct 12, 2026' }, { title: 'Quiz 9', date: '2026-11-01', quote: 'Quiz 9 on Nov 1' }])], seen: [] };
  const out = await T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg });
  assert.deepEqual(out.output, { items: [{ title: 'Midterm', date: '2026-10-12', quote: 'Midterm exam - Oct 12, 2026' }] }, 'the item quoting words not in the text is dropped');
  const { usage, ...meta } = out.meta;
  assert.deepEqual(meta, { task: 'example.dates', version: 2, provider: 'mock', finish: 'stop', rounds: 1, parts: 1 });
  assert.ok(usage.input > 0 && usage.output > 0, 'counted from the text when a provider doesn\'t say');
  const [req] = cfg.seen;
  assert.deepEqual(req.schema, dates.output);
  assert.equal(req.maxTokens, 400);
  assert.equal(req.messages[0].role, 'system');
  assert.ok(!req.messages[0].content[0].text.includes('Midterm'));
  assert.ok(req.messages[1].content[0].text.includes('Midterm exam — Oct 12, 2026'));
});

test('each refusal has its code: input, an answer outside the schema, the task\'s check, caps, setup', async () => {
  const task = T.define(dates);
  await assert.rejects(T.run(task, { text: '   ' }, { provider: 'mock', cfg: { replies: [] } }), { code: 'input' });
  await assert.rejects(T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [answer([{ title: 'x', date: 'Oct 12', quote: 'Oct 12' }])] } }), (e) => e.code === 'invalid-response' && /date: does not match/.test(e.detail) && /Reference/.test(e.message));
  await assert.rejects(T.run(T.define({ ...dates, check: () => null }), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [answer([])] } }), { code: 'check' });
  await assert.rejects(T.run(T.define({ ...dates, caps: { images: true } }), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [], caps: { images: false } } }), { code: 'caps' });
  await assert.rejects(T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg: null }), { code: 'setup' });
  await assert.rejects(T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [{ error: { status: 429 } }] } }), (e) => e.code === 'request-rejected' && e.status === 429);
  await assert.rejects(T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [{ ...answer([]), finish: 'length' }] } }), { code: 'refusal' }, 'an answer cut off is never parsed');
  await assert.rejects(T.run(T.define({ ...dates, tools: ['nowhere'] }), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [] } }), { code: 'tool' });
});

test('a definition is checked when it is made, and says what is wrong', () => {
  for (const [why, over] of [['id', { id: 'Example' }], ['version', { version: 0 }], ['input, build and check', { check: 'no' }], ['output', { output: { type: 'array' } }], ['output', { output: { type: 'object', format: 'x' } }],
    ['caps', { caps: { json: true } }], ['tools', { tools: ['a.b'] }], ['limits', { limits: { steps: -1 } }], ['split and merge', { split: () => [] }], ['unknown', { unknown: 1 }], ['stream', { stream: 'yes' }]]) {
    assert.throws(() => T.define({ ...dates, ...over }), (e) => e instanceof TypeError && e.message.includes(why === 'unknown' ? ': unknown' : why), why);
  }
  const t = T.define(dates);
  assert.ok(Object.isFrozen(t));
  assert.equal(T.add(t), t);
  assert.equal(T.get('example.dates'), t);
  assert.throws(() => T.add({ ...dates }), /already added/);
});

test('a cancel and a whole-run deadline end a task with their codes', async () => {
  const c = new AbortController();
  const p = T.run(T.define(dates), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [{ ...answer([]), wait: 5000 }] }, signal: c.signal });
  setTimeout(() => c.abort(), 5);
  await assert.rejects(p, { code: 'cancelled' });
  await assert.rejects(T.run(T.define({ ...dates, limits: { ms: 20 } }), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [{ ...answer([]), wait: 5000 }] } }), { code: 'timeout' });
});

test('the whole-run deadline settles while a tool is still pending', async (t) => {
  const TL = require('../lib/ai/tools.js');
  const tools = TL.registry();
  let started, release, outcome;
  const entered = new Promise((r) => { started = r; }), gate = new Promise((r) => { release = r; });
  tools.add({ name: 'slow_read', kind: 'read', description: 'Read.', run: async () => { started(); await gate; return null; } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const task = T.define({ ...dates, tools: ['slow_read'], limits: { ms: 5000 } });
  const cfg = { replies: [{ toolCalls: [{ id: 'r', name: 'slow_read', args: { reason: 'Read.' } }] }] };
  const running = T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg, tools }).then(() => { outcome = 'completed'; }, (e) => { outcome = e.code; });
  await entered;
  t.mock.timers.tick(5001);
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  const beforeRelease = outcome;
  release(); await running;
  assert.equal(beforeRelease, 'timeout', 'deadline must release the run without waiting for the tool');
});

test('a long input goes in parts within the provider\'s budget, and the parts\' answers are merged before the check', async () => {
  const long = Array.from({ length: 40 }, (_, i) => `Week ${i + 1}: Lab ${i + 1} due 2026-09-${String((i % 28) + 1).padStart(2, '0')}.`).join('\n\n');
  const task = T.define({ ...dates, id: 'example.long',
    split: (input, { budget, text }) => text.chunks(input.text, { size: budget, overlap: 0 }).map((c) => ({ text: c.text })),
    merge: (outs) => ({ items: outs.flatMap((o) => o.items) }) });
  const progress = [];
  const cfg = { caps: { context: 400 }, seen: [], replies: (req, n) => answer([{ title: `Lab ${n + 1}`, date: '2026-09-01', quote: req.messages[1].content[0].text.split('\n')[2] }]) };
  const out = await T.run(task, { text: long }, { provider: 'mock', cfg, emit: (e) => e.type === 'note' && progress.push(e) });
  assert.ok(cfg.seen.length > 1, `${cfg.seen.length} parts`);
  for (const req of cfg.seen) assert.ok(X.estimateTokens(req.messages[1].content[0].text) <= 400);
  assert.equal(out.meta.parts, cfg.seen.length);
  assert.equal(out.output.items.length, cfg.seen.length);
  assert.deepEqual(progress.map((p) => p.part), cfg.seen.map((_, i) => i + 1));
});

test('a task that streams lets the deltas through; one that doesn\'t, doesn\'t', async () => {
  const words = [];
  const cfg = () => ({ replies: [{ deltas: ['{"items"', ':[]}'] }] });
  const emit = (e) => e.type === 'text_delta' && words.push(e.delta);
  await T.run(T.define(dates), { text: SYLLABUS }, { provider: 'mock', cfg: cfg(), emit });
  assert.deepEqual(words, []);
  await T.run(T.define({ ...dates, stream: true }), { text: SYLLABUS }, { provider: 'mock', cfg: cfg(), emit });
  assert.deepEqual(words, ['{"items"', ':[]}']);
});

test('the settings model is off by default, local, and lets a feature ask only when AI is on, a model chosen and it is allowed', () => {
  assert.deepEqual(A.clean(undefined), { on: false, mode: 'simple', model: { use: null, model: '' }, models: {}, tune: {}, features: { syllabus: false, completion: false, writing: false } });
  assert.deepEqual(A.clean({ on: 'yes', use: 'Bad Name', features: { syllabus: 1, other: true } }).model, { use: null, model: '' });
  const s = A.clean({ on: true, model: { use: 'my-ollama', model: 'llama3.2' }, features: { syllabus: true } });
  assert.equal(s.model.use, 'my-ollama');
  assert.equal(A.allowed(s, 'syllabus'), true);
  assert.equal(A.allowed({ ...s, on: false }, 'syllabus'), false);
  assert.equal(A.allowed({ ...s, model: { use: 'my-ollama', model: '' } }, 'syllabus'), false);
  assert.equal(A.allowed(s, 'grades'), false);
});

test('what the student set goes on every request over the task\'s own, and a longer timeout lengthens the run', async (t) => {
  // The loop subtracts elapsed wall time from the provider budget. Pin Date for the exact override assertion;
  // native timers still verify that the 120ms response survives the task's original 50ms deadline.
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  const task = T.define({ ...dates, limits: { ms: 50 } });
  const over = { effort: 'low', temperature: 0.4, maxTokens: 900, timeoutMs: 2000 };
  const cfg = { replies: [{ ...answer([]), wait: 120 }], seen: [] };
  await T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg, over });
  const [req] = cfg.seen;
  assert.deepEqual({ effort: req.effort, temperature: req.temperature, maxTokens: req.maxTokens, timeoutMs: req.timeoutMs }, over);
  const kept = { replies: [answer([])], seen: [] };
  await T.run(T.define({ ...dates, build: (input, { text }) => text.request({ system: 'x', data: [{ label: 'd', text: input.text }], maxTokens: 400, temperature: 0, effort: 'none' }) }), { text: SYLLABUS }, { provider: 'mock', cfg: kept, over: { maxTokens: 64 } });
  assert.deepEqual([kept.seen[0].effort, kept.seen[0].temperature, kept.seen[0].maxTokens], ['none', 0, 64], 'the task\'s own where the student set nothing');
  assert.equal(T.prepare(T.define(dates), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [] }, over: { temperature: 1 } }).temperature, 1, 'a warm-up readies the session the run will use');
});

test('an effort the student sets above its task\'s own gets room to think beside the answer\'s own output, unless the student set the output', async () => {
  // writer.complete's way: no reasoning, 64 tokens for the rest of a sentence. Reasoning counts against max_tokens, so a
  // student's Low would spend all 64 thinking (OpenRouter, 2026-10-27: 23 thinking events, then no text).
  const quick = T.define({ ...dates, build: (input, { text }) => text.request({ system: 'x', data: [{ label: 'd', text: input.text }], maxTokens: 64, effort: 'none' }) });
  const sent = async (task, over) => { const cfg = { replies: [answer([])], seen: [] }; await T.run(task, { text: SYLLABUS }, { provider: 'mock', cfg, over }); return [cfg.seen[0].effort, cfg.seen[0].maxTokens]; };
  assert.deepEqual(await sent(quick, { effort: 'low' }), ['low', 64 + 2048]);
  assert.deepEqual(await sent(quick, { effort: 'high' }), ['high', 64 + 8192]);
  assert.deepEqual(await sent(quick, { effort: 'low', maxTokens: 100 }), ['low', 100], 'the output the student set');
  assert.deepEqual(await sent(quick, { effort: 'none' }), ['none', 64]);
  assert.deepEqual(await sent(quick, {}), ['none', 64]);
  // A task that already thinks keeps its room, and gets more only for a higher effort.
  const deep = T.define({ ...dates, build: (input, { text }) => text.request({ system: 'x', data: [{ label: 'd', text: input.text }], maxTokens: 5000, effort: 'medium' }) });
  assert.deepEqual(await sent(deep, { effort: 'high' }), ['high', 5000 + 8192 - 4096]);
  assert.deepEqual(await sent(deep, { effort: 'low' }), ['low', 5000]);
  // Never past what a request may ask (lib/ai/request.js LIMIT.maxTokens).
  const big = T.define({ ...dates, build: (input, { text }) => text.request({ system: 'x', data: [{ label: 'd', text: input.text }], maxTokens: 30000, effort: 'none' }) });
  assert.deepEqual(await sent(big, { effort: 'high' }), ['high', 32768]);
  assert.equal(T.prepare(quick, { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [] }, over: { effort: 'low' } }).maxTokens, 64 + 2048, 'a warm-up asks as the run will');
});

// example.finish: plain text, streamed, the rest of the sentence at the caret.
const finish = {
  id: 'example.finish', version: 1, output: 'text', stream: true, rate: { perMinute: 60, supersede: true }, limits: { maxTokens: 40 },
  input: (raw) => (typeof raw?.before === 'string' && raw.before.length <= 2000 ? { before: raw.before } : null),
  build: (input, { text }) => text.request({ system: 'Finish the sentence. Answer with the words only.', context: [{ label: 'prompt', text: 'Rivers' }], data: [{ label: 'before', text: input.before }] }),
  check: (text, input, { truncated }) => { const cut = text.split(/(?<=[.!?])\s/)[0]; return cut.trim() && !cut.startsWith(input.before) ? (truncated ? cut.trimEnd() : cut) : null; },
};

test('a text task: no schema, its words streamed as they come, check given the text; a provider without JSON may run it', async () => {
  const task = T.define(finish);
  assert.equal(task.output, 'text');
  assert.deepEqual(task.rate, { perMinute: 60, supersede: true });
  assert.ok(Object.isFrozen(task.rate));
  const words = [], seen = [];
  const out = await T.run(task, { before: 'The river' }, { provider: 'mock', cfg: { replies: [{ deltas: [' runs to', ' the sea.', ' Then more.'] }], seen, caps: { json: false } },
    emit: (e) => e.type === 'text_delta' && words.push([e.delta, e.offset]) });
  assert.deepEqual(words, [[' runs to', 0], [' the sea.', 8], [' Then more.', 17]], 'every delta, live, with its offset');
  assert.equal(out.output, ' runs to the sea.', 'the task\'s check cut it at the sentence end');
  assert.equal(out.meta.finish, 'stop');
  assert.equal('truncated' in out.meta, false);
  assert.equal(seen[0].schema, undefined, 'no schema asked for');
  assert.equal(seen[0].maxTokens, 40);
  await assert.rejects(T.run(task, { before: 'The river' }, { provider: 'mock', cfg: { replies: [{ text: 'The river' }] } }), { code: 'check' }, 'check still refuses');
});

test('a text task cut off at maxTokens gives the words so far, marked truncated; a JSON task cut off is still a refusal', async () => {
  const out = await T.run(T.define(finish), { before: 'The river' }, { provider: 'mock', cfg: { replies: [{ text: ' runs to the ', finish: 'length' }] } });
  assert.equal(out.output, ' runs to the');
  assert.equal(out.meta.truncated, true);
  assert.equal(out.meta.finish, 'length');
  await assert.rejects(T.run(T.define(dates), { text: SYLLABUS }, { provider: 'mock', cfg: { replies: [{ ...answer([]), finish: 'length' }] } }), { code: 'refusal' });
});

test('a definition\'s rate and text output are checked', () => {
  for (const rate of [{}, { perMinute: 0 }, { perMinute: 121 }, { perMinute: 1.5 }, { supersede: 'yes' }, { other: true }, 'fast']) {
    assert.throws(() => T.define({ ...finish, rate }), /: rate$/, JSON.stringify(rate));
  }
  assert.throws(() => T.define({ ...finish, output: 'words' }), /: output$/);
  assert.equal(T.define({ ...finish, rate: { supersede: true } }).rate.perMinute, undefined);
  assert.equal(T.define(dates).rate, undefined, 'a task without one keeps the broker\'s limits');
});
