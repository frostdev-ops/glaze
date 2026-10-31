// Glaze's own model plans a request for the window of the model that runs it (docs/ai-harness.md "Glaze's own model"):
// a Glaze-tuned model (no `stock`) for FORMAT.md's 4,096 tokens, so through the real broker writer.review and syllabus.read
// split and size their input as the fine-tune's training data was made (test/fixtures/ai/local-format/window.json, from
// lfm-tune's training items and examples by tools/dev/local-window-fixture.js); a stock model keeps its 16k window; the
// picture model (stock) its own; and a request runs on the model it was sized for.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../extension/ai/broker.js');
const T = require('../../extension/ai/task.js');
const P = require('../../extension/ai/providers.js');
const LOCAL = require('../../extension/ai/providers/local.js');
for (const f of ['syllabus-read', 'writer-review', 'writer-image']) require(`../../extension/ai/tasks/${f}.js`);
const W = require('../fixtures/ai/local-format/window.json');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const STOCK = { window: LOCAL.CONTEXT, input: LOCAL.CONTEXT - LOCAL.CONTEXT / 10 };
// A prompt as FORMAT.md's segments: specials by name, adjacent text runs joined (the fixture's form).
const segments = (parts) => {
  const out = [];
  for (const p of parts) {
    if (p.special !== undefined) out.push({ s: p.special });
    else if (out.length && out.at(-1).t !== undefined) out.at(-1).t += p.text;
    else out.push({ t: p.text });
  }
  return out;
};
// A stock model's chat template fences page text with a fresh marker per request.
const unfenced = (parts) => JSON.parse(JSON.stringify(segments(parts)).replace(/DATA-[0-9a-f]{12}/g, 'DATA-*'));
const data = (prompt) => prompt.flatMap((s, i) => (s.s === '<|gz_data|>' ? [prompt[i + 1].t] : []));
const longSyllabus = { text: [W.syllabus.input.text, ...W.syllabi].join('\n\n'), names: [] };
const IMAGE_ANSWER = JSON.stringify({ description: 'A chart.', requirements: [], complete: true, reason: '', relevance: 'relevant' });

const settle = async (n = 200) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
// The store's models (`here`: the list, or a function giving it per call) and a host that records each run and answers
// from `answers` (in turn), else `{}`. Each task run is recorded with its cfg and the window its provider's caps give it.
const setup = (here, answers = []) => {
  const runs = [], seen = [];
  LOCAL._env({ store: { list: async () => (typeof here === 'function' ? here() : here) },
    link: { kind: 'worker', up: true, call: async (op, m) => {
      if (op !== 'run') return {};
      runs.push(m);
      return { text: m.images ? IMAGE_ANSWER : answers[runs.filter((r) => !r.images).length - 1] ?? '{}', finish: 'stop' };
    } }, gpu: () => ({}) });
  const plain = T.run;
  T.run = (task, input, o) => { seen.push({ cfg: o.cfg, context: P.caps(o.provider, o.provider.config(o.cfg)).context }); return plain(task, input, o); };
  return { runs, seen, done: () => { T.run = plain; LOCAL._env(null); } };
};
const env = () => {
  const vault = new Map([['connections', { local: { provider: 'local', generation: 'gen-1' } }]]), data = {};
  return { who: '7', allowed: Promise.resolve(true), local: { get: async (k) => ({ [k]: data[k] }), set: async (v) => { Object.assign(data, v); return true; } },
    settings: async () => ({ on: true, model: { use: 'local', model: '' }, features: { writing: true, syllabus: true } }), enabled: async () => true,
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async () => false, fetch: async () => { throw new Error('nothing goes over the network'); }, task: async (id) => T.get(id), say() {} };
};
// One run through the broker → its end or error message.
const run = async (feature, task, input, e = env()) => {
  const posted = [], on = [];
  B.connect({ postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), disconnect() {}, onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} } }, e);
  for (const f of on) f({ id: 1, op: 'run', feature, task, input });
  for (let i = 0; i < 50 && !posted.some((m) => ['end', 'error'].includes(m.type)); i++) await settle();
  return posted.find((m) => ['end', 'error'].includes(m.type));
};
const tuned = (extra = {}) => ({ id: 'glaze-lfm3-1.7b-q4_k_m', tier: 1, size: 1, state: 'ready', ...extra });
const stock = (extra = {}) => ({ id: 'lfm3-1.7b-q4_k_m', tier: 1, size: 1, state: 'ready', stock: true, ...extra });
const pictures = [{ id: 'lfm3-vl', role: 'pictures', projector: 'lfm3-vl-mmproj', size: 1, state: 'ready', stock: true }, { id: 'lfm3-vl-mmproj', role: 'projector', size: 1, state: 'ready' }];
// What a task makes at a window, as lfm-tune's teacher made its training data (train/teacher.js: the provider's caps with
// local true and context 4096), the host recorded.
const at = async (context, task, input, here, answers) => {
  const s = setup(here, answers);
  const provider = { ...LOCAL, caps: (cfg) => ({ ...LOCAL.caps(cfg), local: true, context }) };
  try { await T.run(T.get(task), input, { provider, cfg: {} }); } finally { s.done(); }
  return s.runs;
};

test.beforeEach(() => { B._reset(); });

test('a Glaze-tuned model: writer.review sends a long draft in the parts the fine-tune trained on, id for id as its training prompts', async () => {
  const s = setup([tuned()], W.review.parts.map((p) => p.answer));
  try {
    const end = await run('writing', 'writer.review', W.review.input);
    assert.equal(end?.type, 'end', JSON.stringify(end));
    assert.deepEqual(s.seen.map((x) => x.context), s.seen.map(() => 4096), 'the task plans for 4,096 tokens');
    assert.equal(s.runs.length, W.review.parts.length);
    s.runs.forEach((r, i) => {
      const want = W.review.parts[i];
      assert.equal(r.model, tuned().id);
      assert.deepEqual(data(segments(r.parts)), data(want.prompt), `${want.id}: its data block`);
      assert.match(data(want.prompt)[0], new RegExp(`^draft part ${i + 1} of 2\\n`));
      assert.deepEqual(segments(r.parts), want.prompt, `${want.id}: the whole prompt`);
      assert.equal(r.maxTokens, want.maxTokens, `${want.id}: maxTokens`);
    });
  } finally { s.done(); }
});

test('a Glaze-tuned model: syllabus.read sizes its answer as training did and splits a long syllabus as a 4,096 window does', async () => {
  let s = setup([tuned()], W.syllabus.parts.map((p) => p.answer));
  try {
    assert.equal((await run('syllabus', 'syllabus.read', W.syllabus.input))?.type, 'end');
    assert.equal(s.runs.length, 1);
    assert.deepEqual(segments(s.runs[0].parts), W.syllabus.parts[0].prompt);
    assert.equal(s.runs[0].maxTokens, W.syllabus.parts[0].maxTokens);
  } finally { s.done(); }
  const want = await at(4096, 'syllabus.read', longSyllabus, [tuned()], [W.syllabus.parts[0].answer, W.syllabus.parts[0].answer, W.syllabus.parts[0].answer]);
  assert.ok(want.length > 1, 'the long syllabus goes in parts at 4,096');
  s = setup([tuned()], want.map(() => W.syllabus.parts[0].answer));
  try {
    assert.equal((await run('syllabus', 'syllabus.read', longSyllabus))?.type, 'end');
    assert.deepEqual(s.runs.map((r) => [segments(r.parts), r.maxTokens]), want.map((r) => [segments(r.parts), r.maxTokens]));
  } finally { s.done(); }
});

test('a stock model keeps its window: one draft block, the stock answer size', async () => {
  const whole = await at(STOCK.input, 'writer.review', W.review.input, [stock()], ['{"issues":[]}']);
  assert.equal(whole.length, 1);
  let s = setup([stock()], ['{"issues":[]}']);
  try {
    assert.equal((await run('writing', 'writer.review', W.review.input))?.type, 'end');
    assert.deepEqual(s.seen.map((x) => x.context), s.seen.map(() => STOCK.input));
    assert.deepEqual(s.runs.map((r) => [r.model, unfenced(r.parts), r.maxTokens]), whole.map((r) => [stock().id, unfenced(r.parts), r.maxTokens]));
    assert.ok(!JSON.stringify(s.runs[0].parts).includes('draft part'), 'the whole draft in one block');
  } finally { s.done(); }
  const syl = await at(STOCK.input, 'syllabus.read', longSyllabus, [stock()], [W.syllabus.parts[0].answer]);
  s = setup([stock()], syl.map(() => W.syllabus.parts[0].answer));
  try {
    await run('syllabus', 'syllabus.read', longSyllabus);
    assert.deepEqual(s.runs.map((r) => [unfenced(r.parts), r.maxTokens]), syl.map((r) => [unfenced(r.parts), r.maxTokens]));
    assert.equal(s.runs.length, 1);
  } finally { s.done(); }
});

test('the picture model (stock) plans for its own window beside a tuned text model; text tasks keep the tuned one', async () => {
  const s = setup([tuned(), ...pictures], W.review.parts.map((p) => p.answer));
  try {
    const end = await run('writing', 'writer.image', { name: 'chart.png', image: { mime: 'image/png', data: PNG }, context: 'Lab 3: plot the data.' });
    assert.equal(end?.type, 'end', JSON.stringify(end));
    assert.deepEqual(s.runs.map((r) => r.model), ['lfm3-vl']);
    assert.ok(s.seen.length && s.seen.every((x) => x.context === STOCK.input), JSON.stringify(s.seen.map((x) => x.context)));
    s.seen.length = 0;
    assert.equal((await run('writing', 'writer.review', W.review.input))?.type, 'end');
    assert.ok(s.seen.length && s.seen.every((x) => x.context === 4096));
    assert.deepEqual(s.runs.slice(1).map((r) => r.model), W.review.parts.map(() => tuned().id));
  } finally { s.done(); }
});

test('a request runs on the model it was sized for, even when the store would now choose another', async () => {
  // Sized while only the stock model is here; a tuned one listed first is ready by the time the request goes.
  const s = setup(() => (s.seen.length ? [tuned(), stock()] : [tuned({ state: 'missing' }), stock()]), ['{"issues":[]}']);
  try {
    assert.equal((await run('writing', 'writer.review', W.review.input))?.type, 'end');
    assert.deepEqual(s.runs.map((r) => r.model), [stock().id]);
    assert.ok(s.seen.every((x) => x.context === STOCK.input));
  } finally { s.done(); }
});

test('a failed catalog read cannot send a stock-sized request to a tuned model; the next run rediscovers it', async () => {
  let reads = 0;
  const s = setup(() => { if (reads++ === 0) throw new Error('store temporarily unavailable'); return [tuned()]; }, W.review.parts.map((p) => p.answer));
  const e = env();
  try {
    const end = await run('writing', 'writer.review', W.review.input, e);
    assert.equal(end?.error, 'provider-unavailable', JSON.stringify(end));
    assert.equal(end.reason, 'assets');
    assert.equal(s.runs.length, 0, 'no request without a discovered text model');
    assert.equal((await run('writing', 'writer.review', W.review.input, e))?.type, 'end');
    assert.deepEqual(s.runs.map((r) => r.model), W.review.parts.map(() => tuned().id));
    assert.ok(s.seen.length && s.seen.every((x) => x.context === 4096));
  } finally { s.done(); }
});

test('a catalog with no selected text model is not reused after a download becomes ready', async () => {
  let ready = false;
  const s = setup(() => [tuned({ state: ready ? 'ready' : 'missing' })], W.review.parts.map((p) => p.answer));
  const e = env();
  try {
    assert.equal((await run('writing', 'writer.review', W.review.input, e))?.error, 'provider-unavailable');
    assert.equal(s.runs.length, 0);
    s.seen.length = 0;
    ready = true;
    assert.equal((await run('writing', 'writer.review', W.review.input, e))?.type, 'end');
    assert.deepEqual(s.runs.map((r) => r.model), W.review.parts.map(() => tuned().id));
    assert.ok(s.seen.length && s.seen.every((x) => x.context === 4096), JSON.stringify(s.seen));
  } finally { s.done(); }
});
