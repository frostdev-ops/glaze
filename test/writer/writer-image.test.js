const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/ai/tasks/writer-image.js');
const T = require('../lib/ai/task.js');
const X = require('../lib/ai/text.js');
const P = require('../lib/ai/providers.js');
const V = require('../lib/ai/visual-cache.js');
const { webcrypto } = require('node:crypto');
require('../lib/ai/providers/mock.js');
const picture = () => ({ name: 'Task.png', mime: 'image/png', data: 'iVBORw0KGgo=' });
const raw = () => ({ name: 'Task.png', image: { mime: 'image/png', data: 'iVBORw0KGgo=' }, context: { kind: 'assignment', assignment: { title: 'Plant observations', instructions: 'Explain plant growth.', rubric: { criteria: [{ label: 'Evidence' }] } } } });
const reading = () => ({ description: 'A table has Evidence in the left column and 20 points in the right column. An arrow connects water to growth.', requirements: ['Explain plant growth.'], complete: true, reason: '', relevance: 'relevant' });
const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');

test('the shared reader task sends one image with compact explicitly incomplete task context', async () => {
  const input = raw(); input.context.assignment.instructions += ' A detailed task instruction.'.repeat(600);
  const clean = I.input(input);
  assert.ok(clean.context.length <= I.LIMIT.context);
  assert.equal(clean.contextComplete, false);
  const cfg = { caps: { context: 8192, images: true }, replies: [{ json: reading() }], seen: [] };
  assert.deepEqual((await T.run(I.task, input, { provider: 'mock', cfg })).output, reading());
  assert.equal(cfg.seen.length, 1);
  assert.equal(cfg.seen[0].maxTokens, I.LIMIT.tokens);
  assert.match(contents(cfg.seen[0]), /Incomplete task context/);
  assert.ok(!contents(cfg.seen[0]).includes(input.context.assignment.instructions));
  assert.ok(contents(cfg.seen[0]).includes('Instructions: Explain plant growth.'));
  assert.equal(cfg.seen[0].messages.flatMap((m) => m.content).filter((p) => p.type === 'image').length, 1);
  assert.doesNotMatch(cfg.seen[0].messages[0].content[0].text, /estimated tokens|UTF-?8 bytes|minified JSON/);
  assert.match(cfg.seen[0].messages[0].content[0].text, /complete false/);
});

const cutoff = () => ({ code: 'request-rejected', category: 'request-rejected', reason: 'response-limit', phase: 'response', actual: 2049, limit: 2048 });

test('a standalone measured cutoff regenerates once and persists only its completed reading', async () => {
  const store = storage(), cache = persistent(store), cfg = { caps: { context: 8192, images: true }, seen: [], replies: [{ error: cutoff() }, { json: reading() }] };
  const result = await T.run(I.task, raw(), { provider: 'mock', cfg, imageCache: cache, over: { maxTokens: 4096 } });
  assert.deepEqual(result.output, reading()); assert.equal(result.meta.parts, 2); assert.equal(cfg.seen.length, 2);
  for (const req of cfg.seen) assert.equal(req.maxTokens, 512);
  const repair = cfg.seen[1].messages[0].content[0].text;
  assert.match(repair, /Regenerate once/); assert.match(repair, /Shorten descriptions/); assert.match(repair, /exact requirements/);
  assert.match(repair, /complete false/);
  assert.equal(JSON.stringify(cfg.seen[0].messages[1].content).replace(/DATA-[a-f0-9]{12}/g, 'DATA'), JSON.stringify(cfg.seen[1].messages[1].content).replace(/DATA-[a-f0-9]{12}/g, 'DATA'), 'regeneration receives the original context and pixels');
  assert.equal(store.writes.length, 1);
  const hit = await T.run(I.task, raw(), { provider: 'mock', cfg, imageCache: persistent(store) });
  assert.equal(hit.meta.parts, 0); assert.equal(cfg.seen.length, 2);
  const failedStore = storage(), failed = { caps: cfg.caps, seen: [], replies: [{ error: cutoff() }, { error: cutoff() }, { json: reading() }] };
  const limited = await T.run(I.task, raw(), { provider: 'mock', cfg: failed, imageCache: persistent(failedStore) });
  assert.equal(limited.output.complete, false); assert.match(limited.output.reason, /response-size limit/);
  assert.equal(failed.seen.length, 2); assert.equal(failedStore.writes.length, 0);
});

test('prepared image regeneration counts both calls, prechecks both fits and never echoes rejected output', async () => {
  const seen = [], fit = []; let calls = 0, writes = 0;
  const result = await I.prepare([picture()], { context: raw().context, caps: { images: true }, onCall: () => calls++,
    fits: (req, options) => { fit.push({ req, options }); return true; }, cache: { set: async () => writes++ },
    ask: async (req, options) => { seen.push({ req, options }); if (seen.length === 1) throw { ...cutoff(), detail: 'PRIVATE PARTIAL ANSWER' }; return options.check(reading()); } });
  assert.deepEqual(result.limitations, []); assert.equal(result.readings[0].description, reading().description);
  assert.equal(calls, 2); assert.equal(writes, 1); assert.equal(fit.length, 2);
  for (const { options } of [...fit, ...seen]) assert.equal(options.maxTokensCap, 512);
  assert.ok(!JSON.stringify(seen).includes('PRIVATE PARTIAL ANSWER'));
  let attempts = 0, checks = 0;
  const noRoom = await I.prepare([picture()], { caps: { images: true }, fits: () => ++checks === 1, ask: async () => attempts++ });
  assert.equal(checks, 2); assert.equal(attempts, 0); assert.match(noRoom.limitations[0], /context limit/);
});

test('image length regeneration stops on repeated cutoff, cancellation, incomplete output and uncertain failures', async () => {
  for (const error of [cutoff(), { code: 'connection-lost' }, { ...cutoff(), reason: 'response-context' }, { ...cutoff(), phase: 'create' },
    { ...cutoff(), actual: 2048 }, { ...cutoff(), actual: 2048.5 }, { ...cutoff(), limit: 0 }, { code: 'refusal', detail: 'the answer was cut off at maxTokens' }]) {
    let calls = 0, writes = 0;
    const out = await I.prepare([picture()], { caps: { images: true }, fits: () => true, cache: { set: async () => writes++ }, onCall: () => calls++, ask: async () => { throw error; } });
    const known = error.reason === 'response-limit' && error.phase === 'response' && error.actual === 2049 && error.limit === 2048;
    assert.equal(calls, known ? 2 : 1);
    assert.equal(writes, 0); assert.equal(out.readings.length, 0); assert.equal(out.limitations.length, 1);
  }
  for (const cancelAt of [1, 2]) {
    const control = new AbortController(); let calls = 0, writes = 0;
    await assert.rejects(I.prepare([picture()], { caps: { images: true }, signal: control.signal, fits: () => true, onCall: () => calls++,
      cache: { set: async () => writes++, setFailure: async () => writes++ }, ask: async (_req, { check }) => {
        if (calls < cancelAt) throw cutoff();
        control.abort(Object.assign(new Error('cancelled'), { code: 'cancelled' })); return check(reading());
      } }), { code: 'cancelled' });
    assert.equal(calls, cancelAt); assert.equal(writes, 0);
  }
  let attempts = 0, saved = 0;
  const incomplete = await I.prepare([picture()], { caps: { images: true }, fits: () => true, cache: { set: async () => saved++ },
    ask: async (_req, { check }) => { if (!attempts++) throw cutoff(); return check({ ...reading(), complete: false, reason: 'The final table row did not fit.' }); } });
  assert.equal(attempts, 2); assert.equal(saved, 0); assert.match(incomplete.limitations[0], /final table row did not fit/);
});

test('accepted JSON is bounded by a UTF-8 token estimate, never silently truncated', () => {
  assert.deepEqual(I.check(reading()), reading());
  const oversized = { ...reading(), description: '🌻'.repeat(600) };
  assert.ok(X.estimateTokens(oversized) > I.LIMIT.tokens);
  assert.equal(I.check(oversized), null);
  assert.match(I.problem(oversized), /512-token estimated bound/);
  assert.equal(oversized.description.length, 1200, 'validation does not alter the supplied observation');
  assert.equal(I.check({ ...reading(), requirements: ['Explain plant growth.', 'Explain plant growth.'] }), null);
  assert.equal(I.check({ ...reading(), description: '' }), null);
});

test('the real provider boundary rejects a cutoff reading even when its JSON claims complete', async () => {
  const cfg = { caps: { context: 8192, images: true }, replies: [{ json: reading(), finish: 'length' }], seen: [] };
  await assert.rejects(P.run(P.get('mock'), { ...I.build(I.input(raw())), schema: I.SCHEMA }, cfg), { code: 'refusal', detail: 'the answer was cut off at maxTokens' });
  assert.equal(cfg.seen.length, 1);
  const run = { ...cfg, replies: [{ json: reading(), finish: 'length' }], seen: [] };
  const out = await T.run(I.task, raw(), { provider: 'mock', cfg: run });
  assert.equal(out.output.complete, false); assert.match(out.output.reason, /cut off/);
  assert.equal(run.seen.length, 1);
});

test('visual uncertainty overrides complete claims, while relevance remains advisory', () => {
  const uncertain = I.check({ ...reading(), reason: 'The final table row is unreadable.' });
  assert.equal(uncertain.complete, false);
  assert.equal(uncertain.reason, 'The final table row is unreadable.');
  const noReason = I.check({ ...reading(), complete: false });
  assert.equal(noReason.complete, false); assert.match(noReason.reason, /incomplete or uncertain/);
  assert.equal(I.check({ ...reading(), relevance: 'uncertain' }).complete, true);
  assert.equal(I.check({ ...reading(), relevance: 'irrelevant' }).description, reading().description);
});

test('a completed image with a positive reason regenerates its inconsistent pair once before caching', async () => {
  const positive = { ...reading(), reason: 'The image is fully readable and contains all relevant observations.' };
  const store = storage(), cfg = { caps: { context: 8192, images: true }, seen: [], replies: [{ json: positive }, { json: reading() }] };
  const result = await T.run(I.task, raw(), { provider: 'mock', cfg, imageCache: persistent(store) });
  assert.deepEqual(result.output, reading()); assert.equal(cfg.seen.length, 2); assert.equal(result.meta.parts, 2);
  const repair = cfg.seen[1].messages[0].content[0].text;
  assert.match(repair, /complete\/reason pair/); assert.match(repair, /complete is true, reason must be ""/);
  assert.match(repair, /actual unreadable, uncertain, or omitted/);
  assert.ok(!JSON.stringify(cfg.seen[1]).includes(positive.reason), 'correction never echoes the rejected reading');
  assert.equal(store.writes.length, 1);
  const hit = await T.run(I.task, raw(), { provider: 'mock', cfg, imageCache: persistent(store) });
  assert.equal(hit.output.complete, true); assert.equal(hit.meta.parts, 0); assert.equal(cfg.seen.length, 2);
});

test('repeated contradictory image pairs remain incomplete and share the same two-call budget with length repair', async () => {
  for (const reason of ['The image is fully readable and contains all relevant observations.', 'The final table row is blurred.']) {
    const store = storage(), invalid = { ...reading(), reason }, cfg = { caps: { context: 8192, images: true }, seen: [], replies: [{ json: invalid }, { json: invalid }, { json: reading() }] };
    const result = await T.run(I.task, raw(), { provider: 'mock', cfg, imageCache: persistent(store) });
    assert.equal(result.output.complete, false); assert.equal(result.output.reason, reason); assert.equal(result.output.description, reading().description);
    assert.equal(cfg.seen.length, 2); assert.equal(store.writes.length, 0);
  }
  const invalid = { ...reading(), reason: 'The image is fully readable.' }, cfg = { caps: { context: 8192, images: true }, seen: [], replies: [{ error: cutoff() }, { json: invalid }, { json: reading() }] };
  assert.equal((await T.run(I.task, raw(), { provider: 'mock', cfg })).output.complete, false);
  assert.equal(cfg.seen.length, 2, 'a length regeneration cannot add another consistency correction');
});

test('prepared consistency correction counts both calls, preserves real limitations, and cannot cache cancelled output', async () => {
  let calls = 0, writes = 0;
  const positive = { ...reading(), reason: 'The image is fully readable.' };
  const result = await I.prepare([picture()], { caps: { images: true }, fits: () => true, onCall: () => calls++, cache: { set: async () => writes++ },
    ask: async (_req, { check }) => check(calls === 1 ? positive : reading()) });
  assert.equal(calls, 2); assert.equal(writes, 1); assert.deepEqual(result.limitations, []);
  calls = writes = 0;
  const incomplete = await I.prepare([picture()], { caps: { images: true }, fits: () => true, onCall: () => calls++, cache: { set: async () => writes++ },
    ask: async (_req, { check }) => check(calls === 1 ? positive : { ...reading(), complete: false, reason: 'A table row is unreadable.' }) });
  assert.equal(calls, 2); assert.equal(writes, 0); assert.match(incomplete.limitations[0], /table row is unreadable/);
  for (const cancelAt of [1, 2]) {
    const control = new AbortController(); calls = writes = 0;
    await assert.rejects(I.prepare([picture()], { caps: { images: true }, signal: control.signal, fits: () => true, onCall: () => calls++,
      cache: { set: async () => writes++, setFailure: async () => writes++ }, ask: async (_req, { check }) => {
        if (calls === cancelAt) control.abort(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
        return check(calls === 1 ? positive : reading());
      } }), { code: 'cancelled' });
    assert.equal(calls, cancelAt); assert.equal(writes, 0);
  }
});

test('prepared cached readings are validated and reused even when the current model cannot take images', async () => {
  let calls = 0, gets = 0;
  const cache = { get: async (inp) => { gets++; assert.equal(inp.image.data, picture().data); assert.ok(inp.context.includes('Plant observations')); return reading(); } };
  const out = await I.prepare([picture()], { context: raw().context, caps: { images: false }, cache, ask: async () => { calls++; }, fits: () => true });
  assert.equal(gets, 1); assert.equal(calls, 0);
  assert.equal(out.readings[0].description, reading().description);
  assert.deepEqual(out.limitations, []);
  const invalid = await I.prepare([picture()], { context: raw().context, caps: { images: false }, cache: { get: async () => ({ ...reading(), description: 'x'.repeat(2400) }) }, ask: async () => { calls++; }, fits: () => true });
  assert.equal(calls, 0);
  assert.equal(invalid.readings.length, 0);
  assert.match(invalid.limitations[0], /cannot read images/);
});

test('reading cache failures fall back once, while incomplete readings are not persisted', async () => {
  let calls = 0, writes = 0;
  const cache = { get: async () => { throw new Error('unavailable'); }, set: async () => { writes++; } };
  const options = { context: raw().context, caps: { images: true }, cache, fits: () => true, onCall: () => calls++ };
  const complete = await I.prepare([picture()], { ...options, ask: async (_req, { check }) => check(reading()) });
  assert.equal(calls, 1); assert.equal(writes, 1); assert.deepEqual(complete.limitations, []);
  const incomplete = await I.prepare([picture()], { ...options, ask: async (_req, { check }) => check({ ...reading(), complete: false, reason: 'The diagram labels are blurred.' }) });
  assert.equal(calls, 2); assert.equal(writes, 1);
  assert.match(incomplete.limitations[0], /Task.png: The diagram labels are blurred/);
  const stale = await I.prepare([picture()], { ...options, cache: { get: async () => ({ ...reading(), complete: false }) }, ask: async (_req, { check }) => check(reading()) });
  assert.equal(calls, 3, 'an incomplete cache entry cannot stand in for a prepared image reading');
  assert.deepEqual(stale.limitations, []);
});

test('context refusal and cancellation stop image work without inference or retry', async () => {
  let calls = 0;
  const limited = await I.prepare([picture()], { caps: { images: true }, fits: () => false, ask: async () => calls++ });
  assert.equal(calls, 0); assert.match(limited.limitations[0], /context limit/);
  const controller = new AbortController(); controller.abort(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
  await assert.rejects(I.prepare([picture()], { caps: { images: true }, signal: controller.signal, fits: () => true, ask: async () => calls++ }), { code: 'cancelled' });
  assert.equal(calls, 0);
});

const storage = () => {
  const data = {}, writes = [];
  return { writes, async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(patch) { writes.push(patch); Object.assign(data, structuredClone(patch)); return true; } };
};
const persistent = (store, context = raw().context) => V.create({ store, context, scope: { school: 'https://school.example', account: 'student-1', assignment: 'assignment-1' }, crypto: webcrypto, locks: null });

test('separate standalone image runs reuse persistent readings and miss when image or assignment context changes', async () => {
  let sets = 0;
  const store = storage(), cfg = { caps: { context: 8192, images: true }, replies: () => ({ json: reading() }), seen: [] };
  const run = (input = raw()) => {
    const cache = persistent(store, input.context);
    return T.run(I.task, input, { provider: 'mock', cfg, imageCache: { get: cache.get, set: async (...args) => { sets++; return cache.set(...args); } } });
  };
  assert.equal((await run()).output.complete, true);
  const cached = await run();
  assert.equal(cached.output.complete, true); assert.equal(cached.meta.parts, 0);
  assert.equal(cfg.seen.length, 1, 'a fresh run reads the persisted description without a second visual inference');
  assert.equal(sets, 1, 'the task does not rewrite a completed cache hit');
  const changedImage = raw(); changedImage.image.data = Buffer.from([137, 80, 78, 71, 13, 10, 26, 11]).toString('base64');
  await run(changedImage); assert.equal(cfg.seen.length, 2);
  const changedContext = raw(); changedContext.context.assignment.instructions = 'Compare plant heights.';
  await run(changedContext); assert.equal(cfg.seen.length, 3);
});

test('standalone incomplete and failed readings return a concrete limitation without persisting or retrying', async () => {
  for (const reply of [{ json: { ...reading(), complete: false, reason: 'The diagram is blurred.' } }, { error: { category: 'connection-lost' } }, { json: { ...reading(), description: 'x'.repeat(2200) } }]) {
    const store = storage(), cfg = { caps: { context: 8192, images: true }, replies: [reply], seen: [] };
    const out = await T.run(I.task, raw(), { provider: 'mock', cfg, imageCache: persistent(store) });
    assert.equal(out.output.complete, false); assert.ok(out.output.reason);
    assert.equal(store.writes.length, 0); assert.equal(cfg.seen.length, 1);
  }
  assert.deepEqual(I.task.rate, { perMinute: 30, supersede: true });
  assert.equal(I.task.limits.calls, 2);
});

test('standalone cancellation cannot write a late visual reading or use a late cache hit', async () => {
  const controller = new AbortController(), store = storage();
  const cfg = { caps: { context: 8192, images: true }, replies: () => { controller.abort(); return { json: reading() }; }, seen: [] };
  await assert.rejects(T.run(I.task, raw(), { provider: 'mock', cfg, signal: controller.signal, imageCache: persistent(store) }), { code: 'cancelled' });
  assert.equal(cfg.seen.length, 1); assert.equal(store.writes.length, 0);
  assert.equal(await persistent(store).getFailure(I.input(raw())), null, 'cancelled inference creates no transient failure entry');
  const other = new AbortController(), seen = [];
  await assert.rejects(T.run(I.task, raw(), { provider: 'mock', cfg: { ...cfg, seen }, signal: other.signal, imageCache: { get: async () => { other.abort(); return reading(); }, set: async () => { throw new Error('must not write'); } } }), { code: 'cancelled' });
  assert.equal(seen.length, 0);
});

test('the standalone visual request stays within 512 tokens despite a larger Advanced output setting', async () => {
  for (const maxTokens of [4096, 128]) {
    const cfg = { caps: { context: 8192, images: true }, replies: [{ json: reading() }], seen: [] };
    assert.equal((await T.run(I.task, raw(), { provider: 'mock', cfg, over: { maxTokens } })).output.complete, true);
    assert.equal(cfg.seen[0].maxTokens, Math.min(maxTokens, I.LIMIT.tokens));
  }
});
