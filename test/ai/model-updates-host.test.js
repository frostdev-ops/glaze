// The engine host's side of background model updates (ai/local/host.js op 'update', ai/local/updates.js update/settle):
// the real store over a fake OPFS and a fake Hugging Face, a stub engine. A signed list's newer version of the model in use
// downloads beside it, waiting while the model runs; the swap waits for the model to be idle and lets the engine go; the old
// version goes only after the new one has answered once; a new version that fails to load rolls back to the old one, the
// run still answered, and isn't tried again for that serial; a hash failure or too little room never swaps; Delete stops it.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('../../extension/ai/local/store.js');
const U = require('../../extension/ai/local/updates.js');
const H = require('../../extension/ai/local/host.js');
const K = require('../../extension/ai/local/tokenizer.js');
const { fakeFs, fakeHf, fakeLocks, fakeBus, entry, bytes } = require('../helpers/model-store-fakes.cjs');

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const KEY = publicKey.export({ format: 'jwk' }).x;
const sign = (list) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${U.canon(list)}`), privateKey).toString('base64url') });

// Two versions of one model: their first four bytes say which; BAD! is a file the engine can't load.
const file = (tag, n, seed) => { const b = bytes(n, seed); b.set(Buffer.from(tag), 0); return b; };
const OLD = file('OLD!', 4 * 1024 + 300, 7), NEW = file('NEW!', 4 * 1024 + 500, 9), BAD = file('BAD!', 4 * 1024 + 100, 11);
const old = entry(OLD, { version: 'r5', tools: 3 });
const fresh = entry(NEW, { commit: 'b'.repeat(40), version: 'r6', tools: 3, minGlaze: '4.0.1' });
const broken = entry(BAD, { commit: 'c'.repeat(40), version: 'r6', tools: 3, minGlaze: '4.0.1' });
const listOf = (serial, models) => ({ v: 1, serial, issued: '2026-11-01T00:00:00Z', models });

const BYTE = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  return Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++));
})();
const VOCAB = (() => {
  const tokens = [...BYTE], types = tokens.map(() => 1);
  for (const [t, ty] of [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['</think>', 4]]) { tokens.push(t); types.push(ty); }
  for (let i = 0; i < 32; i++) { tokens.push(`[PAD${i}]`); types.push(5); }
  return { tokens, types, merges: [], pre: 'lfm2', bos: tokens.indexOf('<|startoftext|>'), eos: tokens.indexOf('<|im_end|>') };
})();
const TOK = (() => { const t = K.load(VOCAB); for (const n of K.GLAZE_TOKENS) t.add(n); return t; })();
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms));
const unref = (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; };

const setup = (opts = {}) => {
  const fs = opts.fs || fakeFs(opts);
  const hf = fakeHf({ [old.url]: OLD, [fresh.url]: NEW, [broken.url]: BAD }, opts);
  const store = S.create({ models: opts.models || [old], fetch: hf, root: async () => fs.root, estimate: fs.estimate, locks: fakeLocks(), channel: fakeBus() });
  const log = { loads: [], released: [], order: [], tokenized: [] };
  let gate = null; // while set, decode waits on it
  const E = {
    load: async (g) => {
      log.loads.push(g.version);
      if (opts.onLoad) await opts.onLoad(g.version);
      if (g.version === 'BAD!') throw Object.assign(new Error('not a model'), { reason: 'model' });
      const ids = [...TOK.encode(`answer from ${g.version}`)];
      let i = 0;
      return {
        context: 16000,
        prefill: async () => { i = 0; }, snapshot: async () => ({ drop() {} }), restore: async () => {},
        decode: async ({ signal } = {}) => { if (gate) await gate; if (signal?.aborted) throw signal.reason; return i < ids.length ? ids[i++] : TOK.eos; },
        release: () => { log.released.push(g.version); log.order.push(`release ${g.version}`); },
      };
    },
  };
  const posted = [];
  const waiters = new Map();
  const host = H.create({ store, gguf: { open: async (f) => { const version = Buffer.from(await f.read(0, 4)).toString(); log.tokenized.push(version); return { version, kv: VOCAB }; } }, tokenizer: K, engine: () => E,
    grammar: () => null, ladder: () => null, gpu: () => ({}), updates: () => U, key: KEY, setTimeout: unref, saveData: () => !!opts.saveData,
    post: (m) => { posted.push(m); if (m.type === 'done' || m.type === 'error') waiters.get(m.id)?.(m); } });
  let seq = 0;
  const call = (op, args = {}) => { const id = ++seq; const p = new Promise((r) => waiters.set(id, r)); host.handle({ id, op, ...args }); return { id, done: p }; };
  const run = (extra = {}) => call('run', { model: 'rime-q4', parts: [{ text: 'hi' }], stable: 0, sampler: {}, maxTokens: 32, ...extra });
  const text = (id) => posted.filter((m) => m.id === id && m.type === 'delta').map((m) => m.text).join('');
  return { fs, hf, store, host, log, posted, call, run, text, hold: () => { let open; gate = new Promise((r) => { open = r; }); return () => { gate = null; open(); }; } };
};
const ready = async (t) => { assert.equal((await t.store.download('rime-q4')).state, 'ready'); };
const update = (t, doc, glaze = '4.0.1') => t.call('update', { doc, model: 'rime-q4', glaze });
const tags = (fs) => [...fs.root.kids.get('glaze-models').kids.get('rime-q4').kids.keys()].sort();

test('a newer version downloads beside the one in use, verified, and swaps in: the engine let go, the next run on it, the old version kept until it answers', async () => {
  const t = setup();
  await ready(t);
  const first = t.run();
  assert.equal((await first.done).type, 'done');
  assert.equal(t.text(first.id), 'answer from OLD!');
  const u = update(t, sign(listOf(3, [fresh])));
  const r = await u.done;
  assert.equal(r.type, 'done', JSON.stringify(r));
  assert.deepEqual(r.result, { state: 'swapped', version: 'r6' });
  assert.ok(t.posted.some((m) => m.id === u.id && m.type === 'progress' && m.loaded > 0 && m.loaded < 1), 'progress');
  assert.ok(t.log.released.includes('OLD!'), 'the engine let the old version go');
  const st = (await t.store.catalog()).state;
  assert.equal(st.serial, 3);
  assert.equal(st.pins['rime-q4'].total, fresh.total);
  assert.deepEqual(st.trial, { id: 'rime-q4', from: old.total, to: fresh.total });
  assert.equal(tags(t.fs).length, 2, 'the old version is still here');
  const second = t.run();
  assert.equal((await second.done).type, 'done');
  assert.equal(t.text(second.id), 'answer from NEW!');
  await settle();
  const after = (await t.store.catalog()).state;
  assert.equal(after.trial, null);
  assert.deepEqual(after.keep, {});
  assert.equal(tags(t.fs).length, 1, 'deleted only after a good first run');
  assert.equal((await t.store.list())[0].version, 'r6');
});

test('the download waits while the model runs, and the swap never lands mid-run', async () => {
  const t = setup();
  await ready(t);
  const open = t.hold();
  const busy = t.run();
  await settle(20);
  const u = update(t, sign(listOf(3, [fresh])));
  await settle(40);
  assert.equal(t.hf.log.filter((l) => l.url === fresh.url).length, 0, 'no chunk while the model runs');
  assert.equal((await t.store.catalog()).entries.get('rime-q4').total, old.total);
  open();
  assert.equal((await busy.done).type, 'done');
  assert.equal(t.text(busy.id), 'answer from OLD!', 'the run finished on the version it started with');
  assert.deepEqual((await u.done).result, { state: 'swapped', version: 'r6' });
});

test('a run queued while the swap waits runs first, on the old version; the one after, on the new', async () => {
  const t = setup();
  await ready(t);
  await t.store.edit(() => U.begin(U.accept(null, listOf(3, [fresh]), { glaze: '4.0.1', ready: [old] }), fresh));
  await t.store.download('rime-q4', { total: fresh.total }); // already here: only the swap is left
  const open = t.hold();
  const a = t.run();
  await settle(20);
  const u = update(t, sign(listOf(3, [fresh])));
  await settle(20);
  assert.equal((await t.store.catalog()).state.trial, null, 'no swap while a run is in flight');
  open();
  assert.equal(t.text((await a.done).id), 'answer from OLD!');
  assert.equal((await u.done).result.state, 'swapped');
  const b = t.run();
  await b.done;
  assert.equal(t.text(b.id), 'answer from NEW!');
});

test('a new version that fails to load rolls back to the old one: the run still answers, the new one goes and is not tried again for that serial', async () => {
  const t = setup();
  await ready(t);
  const doc = sign(listOf(3, [broken]));
  assert.equal((await update(t, doc).done).result.state, 'swapped');
  const r = t.run();
  const done = await r.done;
  assert.equal(done.type, 'done', JSON.stringify(done));
  assert.equal(t.text(r.id), 'answer from OLD!', 'answered by the old version');
  assert.ok(t.log.loads.includes('BAD!'));
  const st = (await t.store.catalog()).state;
  assert.equal(st.pins['rime-q4'].total, old.total);
  assert.equal(st.trial, null);
  assert.deepEqual(st.failed, { [broken.total]: 3 });
  assert.equal(tags(t.fs).length, 1);
  const before = t.hf.log.length;
  assert.equal((await update(t, doc).done).result.state, 'current', 'the same list again does nothing');
  assert.equal(t.hf.log.length, before);
  // A newer serial with the same entry: the owner published again, so it is tried again.
  assert.equal((await update(t, sign(listOf(4, [broken]))).done).result.state, 'swapped');
});

test('a failed memory-capable trial never replays a memory prompt on legacy rollback weights', async () => {
  const t = setup();
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [{ ...broken, memory: 1 }]))).done).result.state, 'swapped');
  const request = t.run({ memory: 1 });
  const result = await request.done;
  assert.equal(result.type, 'error', JSON.stringify(result));
  assert.equal(result.error.code, 'caps');
  assert.deepEqual(t.log.loads, ['BAD!'], 'the legacy model never loads the memory prompt');
  assert.deepEqual(t.log.tokenized, ['BAD!'], 'legacy weights are rejected before tokenizing the prompt');
  assert.equal(t.text(request.id), '');
  assert.equal((await t.store.catalog()).entries.get(old.id).memory, undefined);
});

test('a failed scaled trial never replays new task or size tokens on legacy rollback weights', async () => {
  const t = setup();
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [{ ...broken, scale: 1 }]))).done).result.state, 'swapped');
  const request = t.run({ scale: 1, parts: [{ special: '<|gz_task:chat.compact|>' }, { special: '<|gz_ctx:4k|>' }] });
  const result = await request.done;
  assert.equal(result.type, 'error', JSON.stringify(result));
  assert.equal(result.error.code, 'caps');
  assert.deepEqual(t.log.loads, ['BAD!'], 'legacy weights never load the scaled prompt');
  assert.deepEqual(t.log.tokenized, ['BAD!']);
  assert.equal(t.text(request.id), '');
  assert.equal((await t.store.catalog()).entries.get(old.id).scale, undefined);
});

test('the host rechecks scale before count, warm or a queued run tokenizes the prompt', async () => {
  for (const model of [old, { ...old, scale: 2 }, { ...old, stock: true, scale: 1 }]) {
    const t = setup({ models: [model] });
    await ready(t);
    for (const op of ['count', 'warm', 'run']) {
      const result = await t.call(op, { model: old.id, scale: 1, parts: [{ special: '<|gz_ctx:4k|>' }], stable: 0, sampler: {}, maxTokens: 32 }).done;
      assert.equal(result.type, 'error', `${op}: ${JSON.stringify(result)}`);
      assert.equal(result.error.code, 'caps', op);
    }
    assert.deepEqual(t.log.loads, []);
    assert.deepEqual(t.log.tokenized, []);
  }
});

test('a scaled prompt can retry a failed trial when the rollback weights also declare scale', async () => {
  const t = setup({ models: [{ ...old, scale: 1 }] });
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [{ ...broken, scale: 1 }]))).done).result.state, 'swapped');
  const request = t.run({ scale: 1, parts: [{ special: '<|gz_ctx:4k|>' }] });
  assert.equal((await request.done).type, 'done');
  assert.equal(t.text(request.id), 'answer from OLD!');
  assert.deepEqual(t.log.loads, ['BAD!', 'OLD!']);
});

test('a scaled count waits for trial rollback and checks the resulting weights', async () => {
  let reached, release;
  const loading = new Promise((resolve) => { reached = resolve; }), held = new Promise((resolve) => { release = resolve; });
  const t = setup({ onLoad: async (version) => { if (version === 'BAD!') { reached(); await held; } } });
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [{ ...broken, scale: 1 }]))).done).result.state, 'swapped');
  const request = t.run({ scale: 1 });
  await loading;
  const counted = t.call('count', { model: old.id, scale: 1, parts: [{ special: '<|gz_ctx:4k|>' }] });
  await new Promise(setImmediate);
  release();
  assert.equal((await request.done).error.code, 'caps');
  const result = await counted.done;
  assert.equal(result.type, 'error', JSON.stringify(result));
  assert.equal(result.error.code, 'caps');
  assert.deepEqual(t.log.tokenized, ['BAD!']);
});

test('host rechecks memory support before count, warm-up or a queued run consumes the prompt', async () => {
  const t = setup();
  await ready(t);
  for (const op of ['count', 'warm', 'run']) {
    const result = await t.call(op, { model: old.id, memory: 1, parts: [{ text: 'saved personal preference' }], stable: 0, sampler: {}, maxTokens: 32 }).done;
    assert.equal(result.type, 'error', `${op}: ${JSON.stringify(result)}`);
    assert.equal(result.error.code, 'caps', op);
  }
  assert.deepEqual(t.log.loads, []);
  assert.deepEqual(t.log.tokenized, []);
});

test('a memory request can retry after rollback when the previous weights also support memory', async () => {
  const t = setup({ models: [{ ...old, memory: 1 }] });
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [{ ...broken, memory: 1 }]))).done).result.state, 'swapped');
  const request = t.run({ memory: 1 });
  assert.equal((await request.done).type, 'done');
  assert.equal(t.text(request.id), 'answer from OLD!');
  assert.deepEqual(t.log.loads, ['BAD!', 'OLD!']);
});

test('a memory count waits for an in-flight trial rollback and checks the resulting weights', async () => {
  let reached, release;
  const loading = new Promise((resolve) => { reached = resolve; }), held = new Promise((resolve) => { release = resolve; });
  const t = setup({ onLoad: async (version) => { if (version === 'BAD!') { reached(); await held; } } });
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [{ ...broken, memory: 1 }]))).done).result.state, 'swapped');
  const request = t.run({ memory: 1 });
  await loading;
  const counted = t.call('count', { model: old.id, memory: 1, parts: [{ text: 'saved preference' }] });
  await new Promise(setImmediate);
  release();
  assert.equal((await request.done).error.code, 'caps');
  const result = await counted.done;
  assert.equal(result.type, 'error', JSON.stringify(result));
  assert.equal(result.error.code, 'caps');
  assert.deepEqual(t.log.tokenized, ['BAD!']);
});

test('a chunk failing its hash twice never swaps; that version is not kept or tried again for the serial', async () => {
  const t = setup({ corrupt: { [fresh.url]: { 2: 2 } } });
  await ready(t);
  const doc = sign(listOf(3, [fresh]));
  assert.deepEqual((await update(t, doc).done).result, { state: 'failed', reason: 'hash' });
  const st = (await t.store.catalog()).state;
  assert.equal(st.pins['rime-q4'].total, old.total);
  assert.deepEqual(st.failed, { [fresh.total]: 3 });
  assert.deepEqual(st.keep, {});
  assert.equal(tags(t.fs).length, 1);
  assert.equal((await update(t, doc).done).result.state, 'current');
});

test('too little room refuses cleanly: the model in use stays, and the next check tries again', async () => {
  const t = setup({ quota: OLD.length + 6000 });
  await ready(t);
  assert.deepEqual((await update(t, sign(listOf(3, [fresh]))).done).result, { state: 'download', reason: 'quota' });
  assert.deepEqual(await t.store.status('rime-q4'), { state: 'ready' });
  const r = t.run();
  await r.done;
  assert.equal(t.text(r.id), 'answer from OLD!');
});

test('Data Saver turned on stops the download between chunks', async () => {
  const t = setup({ saveData: true });
  await ready(t);
  assert.deepEqual((await update(t, sign(listOf(3, [fresh]))).done).result, { state: 'download', reason: 'saveData' });
});

test('a list needing a newer Glaze, or signed by another key, changes nothing', async () => {
  const t = setup();
  await ready(t);
  assert.equal((await update(t, sign(listOf(3, [fresh])), '4.0.0').done).result.state, 'current');
  const forged = { ...sign(listOf(5, [fresh])), list: listOf(5, [{ ...fresh, version: 'r7' }]) };
  assert.deepEqual((await update(t, forged).done).result, { state: 'refused', reason: 'signature' });
  assert.equal((await t.store.catalog()).entries.get('rime-q4').total, old.total);
});

test('Delete during an update stops it and forgets the update\'s state for that model', async () => {
  const t = setup({ onChunk: async (url) => { if (url === fresh.url) await settle(10); } });
  await ready(t);
  const u = update(t, sign(listOf(3, [fresh])));
  await settle(15);
  const del = t.call('remove');
  assert.equal((await del.done).type, 'done');
  const r = await u.done;
  assert.ok(r.type === 'error' ? r.error.category === 'cancelled' : r.result.state === 'download', JSON.stringify(r));
  const st = (await t.store.catalog()).state;
  assert.deepEqual(st.pins, {});
  assert.deepEqual(st.keep, {});
  assert.equal(st.serial, 3);
});

test('a run queued during a swap settles the version it actually runs', async () => {
  for (const next of [fresh, broken]) {
    const t = setup();
    await ready(t);
    const edit = t.store.edit;
    let entered, proceed;
    const swapping = new Promise((r) => { entered = r; });
    const gate = new Promise((r) => { proceed = r; });
    t.store.edit = (fn) => edit(async (st) => {
      const out = await fn(st);
      if (out?.trial && !st?.trial) { entered(); await gate; }
      return out;
    });
    const u = update(t, sign(listOf(3, [next])));
    await swapping;
    const r = t.run();
    await settle();
    proceed();
    assert.equal((await u.done).result.state, 'swapped');
    assert.equal((await r.done).type, 'done', 'a broken trial rolls back and answers');
    assert.equal(t.text(r.id), next === fresh ? 'answer from NEW!' : 'answer from OLD!');
    assert.equal((await t.store.catalog()).state.trial, null, 'the version that answered was settled');
  }
});

test('Delete before list acceptance cannot be undone by the cancelled update', async () => {
  const t = setup();
  await ready(t);
  const edit = t.store.edit;
  let entered, proceed, first = true;
  const accepting = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { proceed = r; });
  t.store.edit = async (fn) => {
    if (first) { first = false; entered(); await gate; }
    return edit(fn);
  };
  const u = update(t, sign(listOf(3, [fresh])));
  await accepting;
  assert.equal((await t.call('remove').done).type, 'done');
  proceed();
  await u.done;
  const st = (await t.store.catalog()).state;
  assert.equal(st?.pins?.['rime-q4'], undefined, 'a cancelled acceptance must not resurrect the deleted pin');
  assert.equal(st?.keep?.['rime-q4'], undefined);
  assert.ok(!t.fs.root.kids.get('glaze-models').kids.has('rime-q4'));
});

test('a newer list withdrawing a pending version frees its partially downloaded files', async () => {
  const t = setup();
  await ready(t);
  await t.store.edit(() => U.begin(U.accept(null, listOf(3, [fresh]), { glaze: '4.0.1', ready: [old] }), fresh));
  const ctl = new AbortController();
  await assert.rejects(t.store.download('rime-q4', { total: fresh.total, signal: ctl.signal,
    onProgress: (p) => { if (p > 0) ctl.abort(); } }), (e) => e.reason === 'aborted');
  await settle();
  assert.equal((await t.store.status('rime-q4', { total: fresh.total })).state, 'partial');
  assert.equal((await update(t, sign(listOf(4, [{ ...fresh, minGlaze: '99.0.0' }]))).done).result.state, 'current');
  assert.deepEqual((await t.store.catalog()).state.keep, {}, 'the obsolete download is no longer pending');
  assert.equal(tags(t.fs).length, 1, 'the obsolete partial version is deleted');
  assert.equal((await t.store.status('rime-q4')).state, 'ready');
});

test('an overlapping update cannot overwrite a trial or delete its rollback version', async () => {
  let entered, release;
  const downloading = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  const t = setup({ onChunk: async (url, n) => { if (url === broken.url && n === 0) { entered(); await gate; } } });
  await ready(t);
  const edit = t.store.edit;
  let edits = 0, first;
  t.store.edit = async (fn) => {
    // Let the first swap finish after the second request has inspected the old pin, before its begin edit acquires the lock.
    if (++edits === 3) { release(); await first.done; }
    return edit(fn);
  };
  first = update(t, sign(listOf(3, [broken])));
  await downloading;
  const second = update(t, sign(listOf(3, [broken])));
  assert.equal((await first.done).result.state, 'swapped');
  await second.done;
  const r = t.run();
  assert.equal((await r.done).type, 'done', 'the failed trial can still roll back');
  assert.equal(t.text(r.id), 'answer from OLD!');
  assert.equal((await t.store.catalog()).entries.get('rime-q4').total, old.total);
});
