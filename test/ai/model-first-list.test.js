// Rime's first availability (ai/local/updates.js first, docs/ai-harness.md "Model updates"): 4.0.3 bundles no Rime text
// weights, so Rime is not available and nothing offers Download until Frostdev's signed list names a version this Glaze
// runs. Opening Settings → AI's Rime card (its 'updates' op) fetches that list at most once a day, never in Safari or with
// Data Saver on; a list that verifies is kept in the store's state, the catalog offers its tiers, and Download fetches the
// ladder's pick with the list's hashes. From then on the daily path (check) is as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../../extension/ai/local/store.js');
const U = require('../../extension/ai/local/updates.js');
const H = require('../../extension/ai/local/host.js');
const L = require('../../extension/ai/local/ladder.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const { fakeFs, fakeHf, fakeLocks, fakeBus, entry, bytes } = require('../helpers/model-store-fakes.cjs');

const ROOT = path.join(__dirname, '../..');
const SHIPPED = require('../../extension/ai/local/models.json').models;

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, key: publicKey.export({ format: 'jwk' }).x };
};
const OWNER = pair(), STRANGER = pair();
const sign = (list, k = OWNER) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${U.canon(list)}`), k.privateKey).toString('base64url') });

// R11's entries as the owner will publish them: the permanent ids at tiers 1 to 4, tools 3, memory 1, scale 1, minGlaze
// 4.0.3 (test/fixtures/ai/rime-list-entries.json has the ids, names and quants), over small files the fake Hugging Face serves.
const FIXTURE = require('../fixtures/ai/rime-list-entries.json').models;
const FILES = FIXTURE.map((_, i) => bytes(4 * 1024 + 100 + 200 * i, 11 + i));
const R11 = FIXTURE.map((m, i) => entry(FILES[i], { id: m.id, name: m.name, quant: m.quant, tier: m.tier, file: `r11/${m.quant}.gguf`,
  tools: 3, memory: 1, scale: 1, minGlaze: '4.0.3', version: 'r11' }));
const listOf = (serial, models = R11) => ({ v: 1, serial, issued: '2026-11-20T09:00:00Z', models });
const DAY = 864e5, NOW = Date.parse('2026-11-20T12:00:00Z');

const setup = (opts = {}) => {
  const disk = fakeFs();
  const hf = fakeHf(Object.fromEntries(R11.map((m, i) => [m.url, FILES[i]])), opts.hf || {});
  const store = S.create({ models: SHIPPED, fetch: hf, root: async () => disk.root, estimate: disk.estimate, locks: fakeLocks(), channel: fakeBus() });
  const calls = [], said = [], kept = {}, hosted = [];
  let now = opts.now ?? NOW, doc = opts.doc ?? sign(listOf(1));
  const env = {
    store, key: OWNER.key, glaze: '4.0.3', now: () => now, settings: async () => ({ updates: opts.updates ?? true }), tier: async () => 0,
    safari: !!opts.safari, saveData: () => !!opts.saveData,
    fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } }); },
    host: async (op, args) => { hosted.push({ op, args }); return { state: 'current' }; },
    local: { get: async (k) => ({ [k]: kept[k] }), set: async (o) => { Object.assign(kept, o); return true; } },
    say: (m) => said.push(m),
  };
  return { disk, hf, store, env, calls, said, kept, hosted, at: (t) => { now = t; }, serve: (d) => { doc = d; } };
};
// The provider over that store, a host link that is never started (status asks nothing of it), WebGPU present.
const provider = (store) => {
  LOCAL._env({ store, link: { kind: 'offscreen', up: false, call: async () => { throw new Error('no host in a status'); } }, gpu: () => ({}) });
  return LOCAL;
};
const textOf = async (store) => [...(await store.catalog()).entries.values()].filter((m) => !m.role);

test('4.0.3 ships no Rime text weights: models.json keeps only the picture model and its projector', () => {
  assert.deepEqual(SHIPPED.filter((m) => !m.role).map((m) => m.id), []);
  assert.deepEqual(SHIPPED.map((m) => m.role), ['pictures', 'projector']);
});

test('no Rime model: status is not available, one fixed reason, no tiers, no picture row, nothing to download', async () => {
  const t = setup();
  const P = provider(t.store);
  assert.deepEqual(await P.status(P.config({})), { state: 'unavailable', reason: 'pending' });
  assert.deepEqual(await P.status(P.config({ tier: 2 })), { state: 'unavailable', reason: 'pending' }, 'a saved tier changes nothing');
  assert.deepEqual(await P.prepare(P.config({})), { state: 'unavailable', reason: 'pending' }, 'Download has nothing to fetch');
  assert.equal(t.hf.log.length, 0);
  const cat = await P.catalog(P.config({}));
  assert.equal(cat.models[0].weights, undefined);
  assert.equal(P.levelOf([], {}), 1);
  assert.equal(P.memoryOf([], {}), 0);
});

test('opening Rime\'s card fetches the signed list once, without credentials, and then not again that day', async () => {
  const t = setup({ doc: sign(listOf(1), STRANGER) });
  assert.deepEqual(await U.first(t.env), { state: 'refused', reason: 'signature' });
  assert.equal(t.calls.length, 1);
  assert.equal(t.calls[0].url, U.URL);
  assert.equal(t.calls[0].init.credentials, 'omit');
  assert.equal(t.calls[0].init.cache, 'no-store');
  assert.equal(t.calls[0].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(Object.keys(t.calls[0].init).sort(), ['cache', 'credentials', 'mode', 'redirect', 'referrerPolicy', 'signal'], 'no headers, nothing about the student');
  assert.deepEqual(await U.first(t.env), { state: 'recent' });
  t.at(NOW + DAY - 1);
  assert.deepEqual(await U.first(t.env), { state: 'recent' });
  assert.equal(t.calls.length, 1, 'at most once a day');
  t.at(NOW + DAY);
  t.serve(sign(listOf(1)));
  assert.equal((await U.first(t.env)).state, 'listed');
  assert.equal(t.calls.length, 2, 'the next day it asks again');
  t.at(NOW + 3 * DAY);
  assert.deepEqual(await U.first(t.env), { state: 'here' }, 'once the catalog offers Rime, opening the card fetches nothing');
  assert.equal(t.calls.length, 2);
});

test('two opens at once share one fetch', async () => {
  const t = setup();
  const [a, b] = await Promise.all([U.first(t.env), U.first(t.env)]);
  assert.equal(a.state, 'listed');
  assert.deepEqual(b, a);
  assert.equal(t.calls.length, 1);
});

test('Data Saver or Safari: no fetch at all', async () => {
  for (const o of [{ saveData: true }, { safari: true }]) {
    const t = setup(o);
    const r = await U.first(t.env);
    assert.ok(['paused', 'off'].includes(r.state), JSON.stringify(o));
    assert.equal(t.calls.length, 0, JSON.stringify(o));
    assert.deepEqual(await textOf(t.store), [], JSON.stringify(o));
  }
});

test('a verified list: the catalog offers its tiers 1 to 4, the card is told, and status offers Download with the sizes', async () => {
  const t = setup();
  assert.deepEqual(await U.first(t.env), { state: 'listed' });
  const text = await textOf(t.store);
  assert.deepEqual(text.map((m) => [m.id, m.tier, m.total]), R11.map((m) => [m.id, m.tier, m.total]));
  const st = (await t.store.catalog()).state;
  assert.equal(st.serial, 1);
  assert.deepEqual(st.pins, {});
  assert.ok(t.said.some((m) => m.type === 'glaze:ai-config' && m.event === 'progress' && m.provider === 'local' && m.part === 'list'), JSON.stringify(t.said));
  const P = provider(t.store);
  const s = await P.status(P.config({}));
  assert.equal(s.state, 'download');
  assert.deepEqual(s.tiers, R11.map((m) => ({ tier: m.tier, size: m.size, name: m.name })));
  assert.equal(s.size, R11[0].size);
  assert.equal(s.pictures.state, 'download', 'the picture download is offered beside it again');
});

test('Download fetches the ladder\'s pick with the list\'s hashes', async () => {
  const t = setup();
  await U.first(t.env);
  const probe = { adapter: { isFallbackAdapter: false }, info: { vendor: 'apple', architecture: 'metal-3', device: '', description: '', isFallbackAdapter: false },
    features: ['shader-f16', 'subgroups'], limits: { maxBufferSize: 4294967292, maxStorageBufferBindingSize: 4294967292 }, deviceMemory: 16,
    storageEstimate: { quota: 1e12, usage: 0 }, bench: { bandwidth: 175.5e9, overheadMs: 1.2 } };
  const posted = [];
  const host = H.create({ store: t.store, gguf: {}, tokenizer: {}, engine: () => null, grammar: () => null, ladder: () => ({ probe: async () => probe, pick: L.pick }),
    gpu: () => ({}), updates: () => U, setTimeout: (f, ms) => { const x = setTimeout(f, ms); x.unref?.(); return x; }, post: (m) => posted.push(m) });
  await host.handle({ id: 1, op: 'prepare' });
  const done = posted.find((m) => m.id === 1 && m.type === 'done');
  assert.ok(done, JSON.stringify(posted));
  const want = L.pick({ ...probe, models: R11 }).id;
  assert.equal(want, R11[3].id, 'this computer is fast enough for the highest tier');
  assert.deepEqual([done.result.state, done.result.model], ['ready', want]);
  assert.deepEqual([...new Set(t.hf.log.map((l) => l.url))], [R11[3].url], 'only the pick\'s file, from the list\'s address');
  assert.deepEqual(await t.store.status(want), { state: 'ready' });

  // A file that doesn't match the list's hashes never becomes ready.
  const bad = setup({ hf: { corrupt: { [R11[0].url]: { 0: 2 } } } });
  await U.first(bad.env);
  await assert.rejects(bad.store.download(R11[0].id), (e) => e.reason === 'hash');
  assert.notEqual((await bad.store.status(R11[0].id)).state, 'ready');
});

test('a bad signature, a replay, or entries only for a newer Glaze or higher tools leave Rime not available', async () => {
  const cases = [
    ['signature', sign(listOf(1), STRANGER), { state: 'refused', reason: 'signature' }],
    ['tampered', (() => { const d = structuredClone(sign(listOf(1))); d.list.models[0].sha256[0] = '0'.repeat(64); return d; })(), { state: 'refused', reason: 'signature' }],
    ['newer Glaze', sign(listOf(1, R11.map((m) => ({ ...m, minGlaze: '4.0.4' })))), { state: 'none' }],
    ['higher tools', sign(listOf(1, R11.map((m) => ({ ...m, tools: U.TOOLS + 1 })))), { state: 'none' }],
    ['memory 2', sign(listOf(1, R11.map((m) => ({ ...m, memory: 2 })))), { state: 'none' }],
    ['not JSON of a list', { hello: 'world' }, { state: 'refused', reason: 'shape' }],
  ];
  for (const [name, doc, want] of cases) {
    const t = setup({ doc });
    assert.deepEqual(await U.first(t.env), want, name);
    assert.deepEqual(await textOf(t.store), [], name);
    const P = provider(t.store);
    assert.deepEqual(await P.status(P.config({})), { state: 'unavailable', reason: 'pending' }, name);
  }
  // A replay: the serial held (a list whose entries were all for a newer Glaze, kept by an earlier version) is not taken again.
  const t = setup({ doc: sign(listOf(3)) });
  await t.store.edit(() => ({ v: 1, serial: 3, issued: '2026-11-19T00:00:00Z', models: [], pins: {}, keep: {}, trial: null, failed: {} }));
  assert.deepEqual(await U.first(t.env), { state: 'refused', reason: 'replay' });
  assert.deepEqual(await textOf(t.store), []);
});

test('after a download the daily path runs as before: the alarm\'s mark is set and the check hands the next list to the host', async () => {
  const t = setup();
  await U.first(t.env);
  assert.equal(await U.present(async () => t.disk.root), false, 'a list alone wakes no daily check');
  assert.deepEqual(await U.check(t.env, { reason: 'daily' }), { state: 'none' });
  assert.equal(t.calls.length, 1);
  await t.store.download(R11[0].id);
  assert.equal(await U.present(async () => t.disk.root), true);
  const next = R11.map((m, i) => ({ ...m, version: 'r12' }));
  t.serve(sign(listOf(2, next)));
  t.at(NOW + 2 * 36e5);
  const r = await U.check(t.env, { reason: 'daily' });
  assert.deepEqual(r, { state: 'current' });
  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.hosted.map((h) => [h.op, h.args.model, h.args.glaze]), [['update', R11[0].id, '4.0.3']]);
  assert.equal(t.kept[U.KEPT].checked, NOW + 2 * 36e5);
  assert.deepEqual(await U.first(t.env), { state: 'here' }, 'the card\'s open no longer fetches');
  assert.equal(t.calls.length, 2);
});

// The worker's side (background/background.js): Settings' 'updates' op starts the first-availability check without waiting
// for it, and answers about() as before.
test('the worker starts the first-list check when Settings asks for Rime\'s version', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'extension/background/background.js'), 'utf8');
  const from = source.indexOf('chrome.runtime.onMessage.addListener((m, s, reply) => {\n  if (m?.type !== \'glaze:ai-config\') return;');
  const block = source.slice(from, source.indexOf('// ---- Agent apps (MCP)', from));
  assert.ok(from > 0 && block.length > 0);
  const firsts = [], listeners = [];
  const env = { marker: true };
  const ctx = {
    fromEditor: () => true, extensionOrigin: () => true, ai: () => ({ config: async () => ({ ok: true }) }), aiEnv: () => ({}), modelUpdatesEnv: () => env,
    GZ_AI_MODEL_UPDATES: { first: (e) => { firsts.push(e); return new Promise(() => {}); }, about: async () => ({ auto: true }) },
    chrome: { runtime: { onMessage: { addListener: (f) => listeners.push(f) } } }, Promise,
  };
  vm.createContext(ctx);
  vm.runInContext(block, ctx);
  const replies = [];
  assert.equal(listeners[0]({ type: 'glaze:ai-config', op: 'updates', provider: 'local' }, { frameId: 0 }, (r) => replies.push(r)), true);
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.deepEqual(firsts, [env], 'one check, with the update env');
  assert.deepEqual(replies.map((r) => JSON.parse(JSON.stringify(r))), [{ ok: true, auto: true }], 'answered without waiting for the list');
  listeners[0]({ type: 'glaze:ai-config', op: 'get' }, { frameId: 0 }, () => {});
  assert.equal(firsts.length, 1, 'other ops start nothing');
});
