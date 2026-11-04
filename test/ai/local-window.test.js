// Glaze's own model plans a request for the window of the model that runs it (docs/ai-harness.md "Glaze's own model"):
// a Glaze-tuned model (no `stock`) for FORMAT.md's 4,096 tokens, so through the real broker writer.review and syllabus.read
// split and size their input as the fine-tune's training data was made (test/fixtures/ai/local-format/window.json, from
// lfm-tune's training items and examples by tools/dev/local-window-fixture.js); a stock model keeps its 128K window; the
// picture model (stock) its own; and a request runs on the model it was sized for.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../extension/ai/broker.js');
const T = require('../../extension/ai/task.js');
const P = require('../../extension/ai/providers.js');
const LOCAL = require('../../extension/ai/providers/local.js');
for (const f of ['syllabus-read', 'writer-review', 'writer-image', 'writer-complete']) require(`../../extension/ai/tasks/${f}.js`);
const W = require('../fixtures/ai/local-format/window.json');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const STOCK = { window: LOCAL.CONTEXT, input: Math.floor(LOCAL.CONTEXT * 0.9) };
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
// A v1 training prompt as FORMAT-v2 re-renders it for direct mode (train/format.js toDirect): LFM3's empty think block
// after the assistant header.
const direct = (prompt) => [...prompt, { s: '<think>' }, { s: '</think>' }];
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
const env = (more = {}) => {
  // The 4K training window, chosen: the default is 64K (test/ai/local-default-window.test.js).
  const vault = new Map([['connections', { local: { provider: 'local', window: 4096, generation: 'gen-1' } }]]), data = {};
  return { who: '7', allowed: Promise.resolve(true), local: { get: async (k) => ({ [k]: data[k] }), set: async (v) => { Object.assign(data, v); return true; } },
    settings: async () => ({ on: true, model: { use: 'local', model: '' }, features: { writing: true, syllabus: true }, ...more }), enabled: async () => true,
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
  try { await T.run(T.get(task), input, { provider, cfg: { context, reasoning: !here[0].stock } }); } finally { s.done(); }
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
      assert.deepEqual(segments(r.parts), direct(want.prompt), `${want.id}: the whole prompt`);
      assert.equal(r.maxTokens, want.maxTokens, `${want.id}: maxTokens`);
    });
  } finally { s.done(); }
});

test('a Glaze-tuned model: syllabus.read sizes its answer as training did and splits a long syllabus as a 4,096 window does', async () => {
  let s = setup([tuned()], W.syllabus.parts.map((p) => p.answer));
  try {
    assert.equal((await run('syllabus', 'syllabus.read', W.syllabus.input))?.type, 'end');
    assert.equal(s.runs.length, 1);
    assert.deepEqual(segments(s.runs[0].parts), direct(W.syllabus.parts[0].prompt));
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

// Advanced: a feature's own context (Settings → AI's tuning).
const advanced = (context) => ({ mode: 'advanced', tune: { writing: { context }, syllabus: { context } } });

test('Advanced can\'t raise a Glaze-tuned model past its trained window; a stock model takes the setting as before', async () => {
  let s = setup([tuned()], W.review.parts.map((p) => p.answer));
  try {
    assert.equal((await run('writing', 'writer.review', W.review.input, env(advanced(16000))))?.type, 'end');
    assert.ok(s.seen.length && s.seen.every((x) => x.context === 4096), JSON.stringify(s.seen.map((x) => x.context)));
    assert.equal(s.runs.length, W.review.parts.length, 'the draft in the parts its training window makes');
  } finally { s.done(); }
  s = setup([stock()], Array(8).fill('{"issues":[]}'));
  try {
    assert.equal((await run('writing', 'writer.review', W.review.input, env(advanced(8000))))?.type, 'end');
    assert.ok(s.seen.length && s.seen.every((x) => x.context === 8000));
    s.seen.length = 0;
    assert.equal((await run('writing', 'writer.review', W.review.input, env(advanced(16000))))?.type, 'end');
    assert.ok(s.seen.length && s.seen.every((x) => x.context === 16000), 'Advanced keeps a stock model at 16,000');
  } finally { s.done(); }
});

// One message to the broker → its answer.
const ask = async (msg, e = env()) => {
  const posted = [], on = [];
  B.connect({ postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), disconnect() {}, onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} } }, e);
  for (const f of on) f({ id: 1, ...msg });
  for (let i = 0; i < 50 && !posted.some((m) => m.id === 1); i++) await settle();
  return posted.find((m) => m.id === 1);
};

test('Writer\'s status says the window the model runs with: 4,096 for a Glaze-tuned model, Advanced\'s 16,000 included', async () => {
  for (const [here, more, want] of [[[tuned()], {}, 4096], [[tuned()], advanced(16000), 4096], [[tuned()], advanced(2000), 2000], [[stock()], {}, STOCK.input], [[stock()], advanced(8000), 8000]]) {
    const s = setup(here);
    try {
      const st = await ask({ op: 'status', feature: 'writing' }, env(more));
      assert.equal(st?.type, 'status', JSON.stringify(st));
      assert.equal(st.ready, true);
      assert.equal(st.caps.context, want, `${here[0].id} ${JSON.stringify(more)}`);
    } finally { s.done(); B._reset(); }
  }
});

test('a warm-up is built for the window and model the run will use', async () => {
  const plain = T.prepare;
  for (const [here, more, want, model] of [[[tuned(), stock()], {}, 4096, tuned().id], [[tuned()], advanced(16000), 4096, tuned().id], [[stock()], {}, STOCK.input, stock().id]]) {
    const warms = [], sized = [];
    LOCAL._env({ store: { list: async () => here },
      link: { kind: 'worker', up: true, call: async (op, m) => { if (op === 'warm') warms.push(m); return { ok: true }; } }, gpu: () => ({}) });
    T.prepare = (task, raw, o) => { sized.push(P.caps(o.provider, o.provider.config(o.cfg)).context); return plain(task, raw, o); };
    try {
      const e = env({ features: { completion: true }, ...(more.mode && { mode: more.mode, tune: { completion: more.tune.writing } }) });
      const said = await ask({ op: 'warm', feature: 'completion', task: 'writer.complete', input: { before: 'The essay begins with' } }, e);
      assert.deepEqual(said, { id: 1, type: 'warmed', ok: true });
      assert.deepEqual(sized, [want], `${model} ${JSON.stringify(more)}`);
      assert.deepEqual(warms.map((w) => w.model), [model]);
    } finally { T.prepare = plain; LOCAL._env(null); B._reset(); }
  }
});

test('a connection changed while a warm-up reads its catalog cannot start warming the old model', async () => {
  let resume, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { resume = resolve; });
  const warms = [];
  LOCAL._env({ store: { list: async () => { started(); await gate; return [tuned()]; } },
    link: { kind: 'worker', up: true, call: async (op, m) => { if (op === 'warm') warms.push(m); return { ok: true }; } }, gpu: () => ({}) });
  const e = env({ features: { completion: true } });
  let pending;
  try {
    pending = ask({ op: 'warm', feature: 'completion', task: 'writer.complete', input: { before: 'The essay begins with' } }, e);
    await waiting;
    assert.equal((await B.config({ op: 'remove', id: 'local' }, e)).ok, true);
    resume();
    assert.deepEqual(await pending, { id: 1, type: 'warmed', ok: false });
    assert.deepEqual(warms, [], 'releasing a connection must not be followed by an old warm-up');
  } finally { resume(); await pending; LOCAL._env(null); B._reset(); }
});
