// The selected Rime window controls retained evidence, not just the engine's allocation.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../extension/ai/task.js');
const X = require('../../extension/ai/text.js');
const P = require('../../extension/ai/providers.js');
require('../../extension/ai/providers/mock.js');
const H = require('../../extension/ai/tasks/study-help.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const V = require('../../extension/ai/tasks/writer-review.js');
const caps = (context) => ({ context, local: true });

test('larger effective windows retain study material and local conversation; 4K keeps its established bounds', async () => {
  const raw = { question: 'Which idea should I examine?', subject: 'reading', material: 'An invented course reading. '.repeat(3000), history: [{ question: 'Explain the river metaphor.', answer: 'Look for a repeated image.' }] };
  assert.equal(H.task.input(raw, { caps: caps(4096) }), null);
  const cfg = { caps: caps(32768), seen: [], replies: [{ json: { kind: 'question', step: null, reply: 'Which image do you notice recurring?', followUp: null } }] };
  await T.run(H.task, raw, { provider: 'mock', cfg });
  const req = cfg.seen[0];
  assert.ok(JSON.stringify(req).includes(raw.material.trim()));
  assert.ok(JSON.stringify(req).includes('Explain the river metaphor.'));
  assert.ok(T.prepare(H.task, raw, { provider: 'mock', cfg }), 'warm/count and inference admit the same material');
});

test('agent results and conversation scale using trusted caps, while 4K remains bounded', () => {
  const title = 'Invented archive reading '.repeat(300);
  const raw = { question: 'What should I read?', tools: ['courses_list'], steps: [{ call: { name: 'courses_list', arguments: {} }, result: { courses: [{ id: 'course-one', name: title }] } }], now: 1793577600000, zone: 'UTC', first: true,
    history: Array.from({ length: 6 }, (_, i) => ({ question: `Earlier question ${i} ${'x'.repeat(600)}`, answer: 'Discuss the source.'.repeat(80) })) };
  const small = A.task.input(raw, { caps: caps(4096) });
  const large = A.task.input(raw, { caps: caps(32768) });
  assert.equal(small.history.length, 3);
  assert.equal(large.history.length, 6);
  assert.ok(small.steps[0].result.length < title.length);
  assert.ok(large.steps[0].result.includes(title));
  assert.ok(large.history[0].question.length > small.history[0].question.length);
});

test('split requests use exact prompt count and the actual output reserve at a larger window', async () => {
  const seen = [];
  const provider = { id: 'context-proof', config: (c) => c, caps: () => caps(32768), status: async () => ({}),
    // Deliberately unlike the UTF-8 estimate, as a real tokenizer can be for non-English material.
    count: async (req) => JSON.stringify(req).length,
    run: async (req) => { seen.push(req); return { text: '{"issues":[]}', finish: 'stop', usage: { input: JSON.stringify(req).length, output: 5 } }; } };
  const text = 'An invented draft paragraph with enough words to review.\n'.repeat(1600);
  const out = await T.run(V.task, { text }, { provider, cfg: {} });
  assert.ok(out.meta.parts > 1);
  assert.ok(seen.length <= 8);
  for (const req of seen) {
    assert.ok(JSON.stringify(req).length + req.maxTokens <= 32768, 'count plus answer fits the effective window');
    assert.ok(req.maxTokens === 4096, 'the answer budget is preserved');
  }
  assert.ok(JSON.stringify(seen[0]).length > 26000, 'large material uses the available prompt capacity');
  for (const line of text.trim().split('\n')) assert.ok(seen.some((req) => JSON.stringify(req).includes(line)));
});
