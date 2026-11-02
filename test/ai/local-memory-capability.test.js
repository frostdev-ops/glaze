// Memory is a separately trained local-model capability. It follows the weights in use, including a signed update's
// pin, trial and rollback; a tools level alone never enables it. No shipped model manifest opts in here.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const LOCAL = require('../../extension/ai/providers/local.js');
const S = require('../../extension/ai/local/store.js');
const U = require('../../extension/ai/local/updates.js');
const { fakeFs, fakeHf, fakeLocks, entry, bytes } = require('../helpers/model-store-fakes.cjs');

const OLD = bytes(1300, 7), NEW = bytes(1500, 9);
const old = entry(OLD, { tools: 3, version: 'r5', minGlaze: '4.0.1' });
const fresh = entry(NEW, { commit: 'b'.repeat(40), tools: 3, memory: 1, version: 'future-memory', minGlaze: '4.0.1' });
const listOf = (models = [fresh]) => ({ v: 1, serial: 3, issued: '2026-11-02T00:00:00Z', models });
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const key = publicKey.export({ format: 'jwk' }).x;
const sign = (list) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${U.canon(list)}`), privateKey).toString('base64url') });

test('local memory requires exactly the supported explicit capability, independently of tools', () => {
  assert.equal(LOCAL.memoryOf([{ ...old, state: 'ready' }]), 0, 'tools 3 does not declare memory training');
  for (const memory of [0, 2, 100, '1', true, null, 1.5, NaN]) {
    assert.equal(LOCAL.memoryOf([{ ...old, memory, state: 'ready' }]), 0, String(memory));
  }
  assert.equal(LOCAL.memoryOf([{ ...fresh, state: 'ready' }]), 1);
  assert.equal(LOCAL.memoryOf([]), 0);
});

test('memory selects the same explicit weights, tier and ready fallback as tools', () => {
  const list = [{ ...old, state: 'ready' }, { ...fresh, id: 'rime-q8', tier: 2, state: 'ready' }];
  assert.equal(LOCAL.memoryOf(list), 0);
  assert.equal(LOCAL.memoryOf(list, { tier: 2 }), 1);
  assert.equal(LOCAL.memoryOf(list, { tier: 2, weights: old.id }), 0, 'pinned weights override the selected tier');
  assert.equal(LOCAL.memoryOf(list, { weights: 'rime-q8' }), 1);
  assert.equal(LOCAL.memoryOf(list, { tier: 2, weights: 'gone' }), 0, 'missing weights never fall through');
  assert.equal(LOCAL.memoryOf(list, { tier: 9 }), 0, 'a removed tier follows the ready fallback');
  assert.equal(LOCAL.memoryOf([{ ...fresh, state: 'partial' }]), 1);
  assert.equal(LOCAL.memoryOf([{ ...fresh, role: 'pictures', state: 'ready' }]), 0);
  assert.equal(LOCAL.levelOf(list, { tier: 2, weights: old.id }), 3, 'the legacy tools capability remains available');
});

test('signed lists preserve memory versions, while legacy signed bytes and entries stay unchanged', async () => {
  const legacy = listOf([old]);
  assert.equal(U.canon(U.clean(legacy)), U.canon(legacy));
  assert.deepEqual(await U.verify(sign(legacy), { key }), { ok: true, list: legacy });
  assert.equal(Object.hasOwn(U.clean(legacy).models[0], 'memory'), false);

  const doc = sign(listOf());
  assert.deepEqual(await U.verify(doc, { key }), { ok: true, list: doc.list });
  assert.equal(U.clean(doc.list).models[0].memory, 1);
  const tampered = structuredClone(doc);
  tampered.list.models[0].memory = 2;
  assert.deepEqual(await U.verify(tampered, { key }), { ok: false, error: 'signature' });
});

test('malformed memory declarations refuse a signed list and cannot enter the store catalog', async () => {
  for (const memory of [0, -1, '1', true, null, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const model = { ...fresh, memory };
    assert.equal(S.valid(model), false, String(memory));
    assert.deepEqual(await U.verify(sign(listOf([model])), { key }), { ok: false, error: 'shape' }, String(memory));
  }
});

test('unknown future memory versions verify but are skipped without withdrawing legacy models', async () => {
  const later = { ...fresh, id: 'rime-q8', tier: 2, memory: 2 };
  const supported = { ...fresh, id: 'rime-q6', tier: 3 };
  const doc = sign(listOf([old, later, supported]));
  const verified = await U.verify(doc, { key });
  assert.equal(verified.ok, true);
  assert.equal(verified.list.models[1].memory, 2);
  assert.deepEqual(U.usable(verified.list, { glaze: '4.0.1' }).map((m) => m.id), [old.id, supported.id]);
  assert.deepEqual(U.accept(null, verified.list, { glaze: '4.0.1' }).models.map((m) => m.id), [old.id, supported.id]);
});

test('memoryVersion follows downloaded pins, trial swaps and rollback rather than a newer catalog', async () => {
  const fs = fakeFs();
  const store = S.create({ models: [old], root: async () => fs.root, estimate: fs.estimate, locks: fakeLocks(), channel: null,
    fetch: fakeHf({ [old.url]: OLD, [fresh.url]: NEW }) });
  LOCAL._env({ store });
  try {
    await store.download(old.id);
    await store.edit(() => U.accept(null, listOf(), { glaze: '4.0.1', ready: [old] }));
    assert.equal((await store.catalog()).latest.get(old.id).memory, 1);
    assert.equal(Object.hasOwn((await store.list())[0], 'memory'), false, 'list describes the downloaded pin');
    assert.equal(await LOCAL.memoryVersion(), 0, 'the newer catalog cannot enable memory on old weights');
    assert.equal(await LOCAL.memoryVersion({ weights: old.id }), 0);

    await store.edit((state) => U.begin(state, fresh));
    await store.download(old.id, { total: fresh.total, whole: true });
    assert.equal(await LOCAL.memoryVersion(), 0, 'a completed spare still is not the model in use');
    await store.edit((state) => U.swap(state, old.id, fresh, old));
    assert.equal((await store.list())[0].memory, 1);
    assert.equal(await LOCAL.memoryVersion({ weights: old.id }), 1);
    assert.equal(await LOCAL.toolsLevel({ weights: old.id }), 3);

    await store.edit(U.rollback);
    assert.equal(await LOCAL.memoryVersion({ weights: old.id }), 0);
    assert.equal(await LOCAL.toolsLevel({ weights: old.id }), 3);
  } finally { LOCAL._env(null); }
});
