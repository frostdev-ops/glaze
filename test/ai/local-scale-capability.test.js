// Context-size tokens and per-size answer lengths are a per-model training contract (`scale: 1` in a models.json entry,
// owner 2026-11-03: R9 trains with them, r5 and R8 keep reading what they were trained on). It follows the weights in use,
// including a signed update's pin, trial and rollback. A model without it sends exactly today's requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const LOCAL = require('../../extension/ai/providers/local.js');
const S = require('../../extension/ai/local/store.js');
const U = require('../../extension/ai/local/updates.js');
const T = require('../../extension/ai/task.js');
const X = require('../../extension/ai/text.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const C = require('../../extension/ai/tasks/chat-compact.js');
const Q = require('../../extension/ai/request.js');
const { fakeFs, fakeHf, fakeLocks, entry, bytes } = require('../helpers/model-store-fakes.cjs');

const WINDOWS = [[4096, '4k'], [8192, '8k'], [16384, '16k'], [32768, '32k'], [65536, '64k'], [131072, '128k']];
const ID = 'rime-r9-fixture';
const PLAIN = Object.freeze({ id: ID, tier: 1, size: 1, tools: 3, state: 'ready' });
const SCALED = Object.freeze({ ...PLAIN, scale: 1 });

const setup = (model, rate = 100) => {
  const calls = [];
  const session = { get: async () => ({ aiLocalRates: { [ID]: rate }, aiLocalMeasured: [] }), set: async () => {} };
  LOCAL._env({ store: { list: async () => [model] }, gpu: () => ({}), session, link: { kind: 'worker', up: true, call: async (op, args) => {
    calls.push({ op, args });
    if (op === 'count') return { tokens: args.parts.reduce((n, p) => n + (p.text?.length || 1), 0) };
    return op === 'warm' ? { ok: true } : { text: '{"text":"Checked.","quotes":[]}', finish: 'stop' };
  } } });
  return calls;
};
test.afterEach(() => LOCAL._env(null));

const NOW = Date.UTC(2026, 10, 3);
// A fixed data fence: the harness's own is random.
const FIXED = { ...X, request: (o) => X.request({ ...o, fence: X.fence('DATA-000000000000') }) };
const plainReq = (id, extra = {}) => ({ ...Q.clean(FIXED.request({ system: 'Help the student.', data: [{ label: 'history', text: 'Earlier question and answer.' }, { label: 'draft', text: 'Today' }] })), task: { id, version: 1 }, ...extra });
const agentReq = (cfg) => Q.clean({ ...T.prepare(A.task, { question: 'What is due this week?', tools: ['run_js'], now: NOW, zone: 'UTC' }, { provider: LOCAL, cfg }), task: { id: 'agent.tools', version: 1 } });
const COMPACT = Object.freeze({ ...Q.clean(C.task.build(C.task.input({ turns: [{ question: 'When is Lab 3 due?', answer: 'Lab 3 is due Monday.' }] }), { text: FIXED })), schema: C.OUTPUT, task: { id: 'chat.compact', version: 1 }, maxTokens: 777, temperature: 0.3 });
const compactReq = () => structuredClone(COMPACT);
const cfgs = () => [{}, ...WINDOWS.map(([w]) => ({ window: w, context: w })), { window: 65536, context: 65536, effort: 'none' }, { window: 32768, context: 32768, effort: 'medium' }];

// Every op's payload and the admission reserve for a matrix of tasks and windows.
const transcript = async (model) => {
  const out = [];
  for (const raw of cfgs()) {
    const cfg = LOCAL.config({ weights: ID, ...raw });
    for (const req of [plainReq('writer.complete'), plainReq('writer.review', { maxTokens: 4096 }), plainReq('study.help', { maxTokens: 300 }), plainReq('study.help'), agentReq(cfg), compactReq()]) {
      const calls = setup(model);
      await LOCAL.catalog(cfg);
      const tokens = await LOCAL.count(req, cfg);
      await LOCAL.warm(req, cfg);
      try { await LOCAL.run(req, cfg); } catch (e) { calls.push({ op: 'error', args: e.code || e.category }); }
      const reserve = T.reserved(LOCAL, req, cfg.context || LOCAL.TUNED, cfg, tokens);
      // think.ms is the deadline left when the run starts, a clock reading.
      for (const c of calls) if (c.args?.think) delete c.args.think.ms;
      out.push({ cfg: raw, task: req.task.id, calls, reserve });
    }
  }
  return out;
};
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const runOf = (calls) => calls.find((c) => c.op === 'run').args;
const text = (parts) => parts.map((p) => p.special ?? p.text).join('');

test('a model without scale: 1 sends exactly the requests Glaze sent before the capability existed', async () => {
  // The transcript's SHA-256 at main 391b39ddb, before `scale` was read.
  const BEFORE = 'cab799f31fe95329b6042b25fc9c49071c168a18f629954f1ceae09d72d7fe78';
  assert.equal(sha(await transcript(PLAIN)), BEFORE);
  for (const scale of [0, 2, '1', true, null, 1.5]) assert.equal(sha(await transcript({ ...PLAIN, scale })), BEFORE, String(scale));
  assert.ok(!JSON.stringify(await transcript(PLAIN)).includes('gz_ctx:'), 'no size token');
});

test('a scaled model sends its window\'s size token after the task token, at every size from 4K to 128K', async () => {
  for (const [w, s] of WINDOWS) {
    const cfg = LOCAL.config({ weights: ID, window: w, context: w });
    for (const req of [plainReq('writer.complete'), plainReq('study.help'), agentReq(cfg)]) {
      const calls = setup(SCALED);
      await LOCAL.count(req, cfg); await LOCAL.warm(req, cfg);
      try { await LOCAL.run(req, cfg); } catch { /* the payload is what matters */ }
      for (const op of ['count', 'warm', 'run']) {
        const parts = calls.find((c) => c.op === op).args.parts;
        assert.ok(text(parts).includes(`<|gz_task:${req.task.id}|><|gz_ctx:${s}|>`), `${req.task.id} ${op} ${w}`);
        assert.equal(parts.filter((p) => typeof p.special === 'string' && p.special.startsWith('<|gz_ctx:')).length, 1);
      }
      assert.equal(runOf(calls).window, w);
    }
  }
});

test('a scaled model caps every answer at its size\'s ANSWER reserve; a request asking less keeps its own', async () => {
  for (const [w, s] of WINDOWS) {
    const cfg = LOCAL.config({ weights: ID, window: w, context: w });
    for (const [req, want] of [[plainReq('writer.complete'), LOCAL.ANSWER[s]], [plainReq('writer.review', { maxTokens: 4096 }), LOCAL.ANSWER[s]],
      [plainReq('study.help', { maxTokens: 300 }), 300], [plainReq('writer.review', { maxTokens: 32768 }), LOCAL.ANSWER[s]]]) {
      const calls = setup(SCALED);
      await LOCAL.run(req, cfg);
      assert.equal(runOf(calls).maxTokens, want, `${req.task.id} ${w}`);
      await LOCAL.catalog(cfg);
      const think = LOCAL.limits(req.task, w, { maxTokens: req.maxTokens, ...cfg }).think;
      assert.equal(T.reserved(LOCAL, req, w, cfg, 100), want + think + (think || LOCAL.adaptive(req.task, w, cfg) ? LOCAL.CLOSE : 0), `reserve ${req.task.id} ${w}`);
    }
  }
});

test('chat.compact reads its own task token on a scaled model, and native ChatML on an unscaled one', async () => {
  const cfg = LOCAL.config({ weights: ID, window: 8192, context: 8192 });
  let calls = setup(SCALED);
  await LOCAL.count(compactReq(), cfg); await LOCAL.run(compactReq(), cfg);
  for (const op of ['count', 'run']) assert.ok(text(calls.find((c) => c.op === op).args.parts).includes('<|gz_task:chat.compact|><|gz_ctx:8k|>'), op);
  assert.equal(runOf(calls).maxTokens, 768, 'its 777 is held to the 8K reserve');
  calls = setup(PLAIN);
  await LOCAL.run(compactReq(), cfg);
  assert.ok(!text(runOf(calls).parts).includes('gz_'), 'unscaled: native template');
  assert.equal(runOf(calls).maxTokens, 777);
});

// The run's budget also leaves the deadline room for the whole answer (budget()), so a larger answer reserve may shorten it
// on a slow machine; a fast one shows the allowance itself.
test('scale leaves adaptive thinking budgets as they are and turns no legacy per-size think switch on', async () => {
  for (const [w] of WINDOWS) {
    for (const effort of [undefined, 'none', 'minimal', 'medium', 'high']) {
      const cfg = LOCAL.config({ weights: ID, window: w, context: w, ...(effort && { effort }) });
      for (const req of [plainReq('study.help'), agentReq(cfg), plainReq('writer.review')]) {
        const budgets = [];
        for (const model of [PLAIN, SCALED]) {
          const calls = setup(model, 1e6);
          try { await LOCAL.run(req, cfg); } catch { /* payload recorded */ }
          const { ms, ...think } = runOf(calls).think || {};
          budgets.push(think);
        }
        assert.deepEqual(budgets[1], budgets[0], `${req.task.id} ${w} ${effort}`);
        assert.equal(LOCAL.limits(req.task, w, { ...cfg, selected: SCALED }).think, LOCAL.limits(req.task, w, { ...cfg, selected: PLAIN }).think);
        const want = effort === 'none' || req.task.id === 'writer.review' || w <= 4096 ? 0 : Math.floor(Math.min(32768, w / 4) * ({ minimal: 0.125, medium: 0.5 }[effort] ?? 1));
        assert.equal(budgets[1].budget ?? 0, want, `${req.task.id} ${w} ${effort}`);
      }
    }
  }
});

test('scaleOf reads exactly scale: 1 on the model this cfg runs, never a stock or picture model', () => {
  assert.equal(LOCAL.scaleOf([PLAIN]), 0);
  for (const scale of [0, 2, '1', true, null, 1.5, NaN]) assert.equal(LOCAL.scaleOf([{ ...PLAIN, scale }]), 0, String(scale));
  assert.equal(LOCAL.scaleOf([SCALED]), 1);
  assert.equal(LOCAL.scaleOf([{ ...SCALED, stock: true }]), 0);
  assert.equal(LOCAL.scaleOf([{ ...SCALED, role: 'pictures' }]), 0);
  const list = [PLAIN, { ...SCALED, id: 'rime-r9-q8', tier: 2 }];
  assert.equal(LOCAL.scaleOf(list), 0);
  assert.equal(LOCAL.scaleOf(list, { tier: 2 }), 1);
  assert.equal(LOCAL.scaleOf(list, { tier: 2, weights: ID }), 0, 'pinned weights override the tier');
  assert.equal(LOCAL.scaleOf(list, { weights: 'gone' }), 0);
});

test('an older overlapping list read cannot replace the rollback snapshot used for admission', async () => {
  let finishOld;
  const older = new Promise((resolve) => { finishOld = resolve; });
  let reads = 0;
  LOCAL._env({ store: { list: () => ++reads === 1 ? older : Promise.resolve([PLAIN]) } });
  const cfg = LOCAL.config({ weights: ID, window: 4096, context: 4096 });
  const pending = LOCAL.scaleVersion(cfg);
  assert.equal(await LOCAL.scaleVersion(cfg), 0, 'the newer read sees the rolled-back weights');
  finishOld([SCALED]);
  assert.equal(await pending, 1, 'the older operation keeps its own snapshot');
  assert.equal(T.reserved(LOCAL, plainReq('writer.review', { maxTokens: 3000 }), 4096, cfg, 100), 3000,
    'admission must keep the newer unscaled answer reserve');
});

test('a status read refreshes the scale snapshot used by admission after rollback', async () => {
  let model = SCALED;
  LOCAL._env({ store: { list: async () => [model] }, gpu: () => ({}), link: { kind: 'worker' } });
  const cfg = LOCAL.config({ weights: ID });
  assert.equal(await LOCAL.scaleVersion(cfg), 1);
  model = PLAIN;
  assert.equal((await LOCAL.status(cfg)).state, 'ready');
  assert.equal(T.reserved(LOCAL, plainReq('writer.review', { maxTokens: 3000 }), 4096, cfg, 100), 3000);
});

test('a list read from a released environment cannot populate its replacement environment', async () => {
  let finish;
  const older = new Promise((resolve) => { finish = resolve; });
  LOCAL._env({ store: { list: () => older } });
  const pending = LOCAL.scaleVersion({ weights: ID });
  setup(PLAIN);
  finish([SCALED]);
  await pending;
  assert.equal(LOCAL.limits({ id: 'writer.review' }, 4096, { weights: ID, maxTokens: 3000 }).maxTokens, 3000);
});

// ---- the signed model list and the store ------------------------------------------------------------------------------
const OLD = bytes(1300, 7), NEW = bytes(1500, 9);
const old = entry(OLD, { tools: 3, memory: 1, version: 'r8', minGlaze: '4.0.1' });
const fresh = entry(NEW, { commit: 'b'.repeat(40), tools: 3, memory: 1, scale: 1, version: 'r9-fixture', minGlaze: '4.0.1' });
const listOf = (models = [fresh]) => ({ v: 1, serial: 3, issued: '2026-11-03T00:00:00Z', models });
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'jwk' }).x;
const sign = (list) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${U.canon(list)}`), privateKey).toString('base64url') });

test('signed lists keep scale, legacy entries stay byte-identical, and a tampered scale fails the signature', async () => {
  const legacy = listOf([old]);
  assert.equal(U.canon(U.clean(legacy)), U.canon(legacy));
  assert.equal(Object.hasOwn(U.clean(legacy).models[0], 'scale'), false);
  const doc = sign(listOf());
  assert.deepEqual(await U.verify(doc, { key }), { ok: true, list: doc.list });
  assert.equal(U.clean(doc.list).models[0].scale, 1);
  const tampered = structuredClone(doc);
  delete tampered.list.models[0].scale;
  assert.deepEqual(await U.verify(tampered, { key }), { ok: false, error: 'signature' });
});

test('malformed scale refuses a signed list and the store; a future scale version is skipped', async () => {
  for (const scale of [0, -1, '1', true, null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(S.valid({ ...fresh, scale }), false, String(scale));
    assert.deepEqual(await U.verify(sign(listOf([{ ...fresh, scale }])), { key }), { ok: false, error: 'shape' }, String(scale));
  }
  const later = { ...fresh, id: 'rime-q8', tier: 2, scale: 2 }, supported = { ...fresh, id: 'rime-q6', tier: 3 };
  const verified = await U.verify(sign(listOf([old, later, supported])), { key });
  assert.equal(verified.ok, true);
  assert.deepEqual(U.usable(verified.list, { glaze: '4.0.1' }).map((m) => m.id), [old.id, supported.id]);
});

test('scale follows the downloaded pin, a trial swap and rollback, and a rolled-back model loses it', async () => {
  const fs = fakeFs(), calls = [];
  const store = S.create({ models: [old], root: async () => fs.root, estimate: fs.estimate, locks: fakeLocks(), channel: null,
    fetch: fakeHf({ [old.url]: OLD, [fresh.url]: NEW }) });
  LOCAL._env({ store, gpu: () => ({}), link: { kind: 'worker', up: true, call: async (op, args) => { calls.push({ op, args }); return { text: 'ok', finish: 'stop' }; } } });
  const cfg = LOCAL.config({ weights: old.id, window: 16384, context: 16384 });
  const sent = async () => { calls.length = 0; await LOCAL.run(plainReq('writer.complete'), cfg); return runOf(calls); };
  try {
    await store.download(old.id);
    await store.edit(() => U.accept(null, listOf(), { glaze: '4.0.1', ready: [old] }));
    assert.equal((await store.catalog()).latest.get(old.id).scale, 1);
    assert.equal(Object.hasOwn((await store.list())[0], 'scale'), false, 'list describes the downloaded pin');
    assert.equal(await LOCAL.scaleVersion(cfg), 0, 'a newer catalog cannot scale old weights');
    assert.ok(!text((await sent()).parts).includes('gz_ctx:'));

    await store.edit((state) => U.begin(state, fresh));
    await store.download(old.id, { total: fresh.total, whole: true });
    assert.equal(await LOCAL.scaleVersion(cfg), 0, 'a completed spare is not the model in use');
    await store.edit((state) => U.swap(state, old.id, fresh, old));
    assert.equal((await store.list())[0].scale, 1);
    assert.equal(await LOCAL.scaleVersion(cfg), 1);
    let run = await sent();
    assert.ok(text(run.parts).includes('<|gz_ctx:16k|>'));
    assert.equal(run.maxTokens, LOCAL.ANSWER['16k']);

    await store.edit(U.rollback);
    assert.equal(await LOCAL.scaleVersion(cfg), 0);
    run = await sent();
    assert.ok(!text(run.parts).includes('gz_ctx:'), 'rolled back: no size token');
    assert.equal(run.maxTokens, 1024, 'rolled back: today\'s answer limit');
    assert.equal(await LOCAL.memoryVersion(cfg), 1, 'memory is untouched');
  } finally { LOCAL._env(null); }
});
