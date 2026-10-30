// A run's token budget (lib/ai/loop.js limits.tokens: the task's own, else the loop's default) next to the model's context
// window: lib/ai/task.js sizes requests by the smaller of the two, so a long paper on a model with a large window goes in
// parts or meets the task's own named reason, never the loop's bare `limit`. Text in a three-byte script (UTF-8) estimates
// at three times its English length, which is how an ordinary paper reaches the budget.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/ai/task.js');
const L = require('../lib/ai/loop.js');
const F = require('../lib/ai/failure.js');
require('../lib/ai/providers/mock.js');
const RV = require('../lib/ai/tasks/writer-review.js');
const O = require('../lib/ai/tasks/writer-outline.js');

const WIDE = { context: 400000 }; // a cloud model's window, far past the loop's default budget
const CJK = (n) => '記憶は川のように流れて町の忘れたものを運ぶ。'.repeat(Math.ceil(n / 21)).slice(0, n);
const budget = L.LIMIT.tokens[0];
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

test('writer.review: a long paper on a wide model goes in parts within the run\'s budget', async () => {
  const text = CJK(110000);
  const cfg = { caps: WIDE, seen: [], replies: () => ({ json: { issues: [] } }) };
  const { meta } = await T.run(RV.task, { text }, { provider: 'mock', cfg });
  assert.ok(meta.parts > 1, `parts: ${meta.parts}`);
  for (const req of cfg.seen) assert.ok(bytes(req) / 4 < budget, 'each request within the budget');
});

test('writer.outline: a section past the run\'s budget falls back to the local outline with its reason', async () => {
  const cfg = { caps: WIDE, seen: [], replies: () => ({ json: { heading: 'Memory', role: 'body' } }) };
  await assert.rejects(T.run(O.task, { blocks: [{ id: 'b0', kind: 'paragraph', text: CJK(100000) }], context: {} }, { provider: 'mock', cfg }),
    (e) => e.code !== 'limit' && e.reason === 'outline-section-context' && !!F.explain(e));
  assert.equal(cfg.seen.length, 0, 'nothing sent that the budget refuses');
});

// Feedback's and Outline's orchestrators split and refuse by the fits() they are given (writer-feedback.js room,
// writer-outline.js): a request the run's budget refuses never fits, and one that fits is never refused by the loop.
test('fits() and ask() agree with the run\'s token budget on a wide model', async () => {
  const X = require('../lib/ai/text.js');
  const ask = (n) => X.request({ system: 'Read the passage.', data: [{ label: 'passage', text: CJK(n) }], maxTokens: 256 });
  const seen = {};
  const task = T.define({ id: 'example.budget', version: 1, caps: {}, input: (raw) => raw, build: () => ({}), check: (out) => out, output: 'text',
    orchestrate: async (inp, { fits, ask: send }) => {
      seen.over = fits(ask(90000)); seen.under = fits(ask(20000));
      return send(ask(20000));
    } });
  const cfg = { caps: WIDE, replies: [{ text: 'Read.' }], seen: [] };
  await T.run(task, {}, { provider: 'mock', cfg });
  assert.deepEqual(seen, { over: false, under: true });
  assert.equal(cfg.seen.length, 1);
  assert.ok(bytes(cfg.seen[0]) / 4 < budget);
});
