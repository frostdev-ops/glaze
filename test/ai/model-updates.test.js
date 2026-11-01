// ai/local/updates.js (docs/ai-harness.md "Model updates"): the signed model list (Ed25519 over the canonical list, a
// serial that only rises, every entry in the schema, entries for a newer Glaze or a higher tools level skipped), the state
// changes (accept, begin, swap, confirm, rollback), and the worker's side: the daily and start-up alarms, and a check
// that asks nothing of the network unless this browser has a Rime model downloaded and the switch is on.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const S = require('../../extension/ai/local/store.js');
const U = require('../../extension/ai/local/updates.js');
const { fakeFs, fakeHf, fakeLocks, fakeBus, entry, bytes } = require('../helpers/model-store-fakes.cjs');

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { privateKey, key: publicKey.export({ format: 'jwk' }).x };
};
const OWNER = pair(), STRANGER = pair();
const sign = (list, k = OWNER) => ({ list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${U.canon(list)}`), k.privateKey).toString('base64url') });

const OLD = bytes(4 * 1024 + 300, 7), NEW = bytes(4 * 1024 + 500, 9);
const old = entry(OLD, { version: 'r5', tools: 3 });
const fresh = entry(NEW, { commit: 'b'.repeat(40), version: 'r6', tools: 3, minGlaze: '4.0.1' });
const listOf = (serial, models = [fresh]) => ({ v: 1, serial, issued: '2026-11-01T00:00:00Z', models });

test('the bundled public key is a raw Ed25519 key, and its fingerprint is its SHA-256', async () => {
  assert.match(U.KEY, /^[\w-]{43}$/);
  assert.equal(await U.fingerprint(), crypto.createHash('sha256').update(Buffer.from(U.KEY, 'base64url')).digest('hex'));
  assert.equal(U.URL, 'https://huggingface.co/frostdev-ops/Rime-1.7B-GGUF/resolve/main/glaze-models.json');
});

test('a list signed by the bundled key\'s owner verifies; tampered, wrong-key, older or equal serials do not', async () => {
  const doc = sign(listOf(3));
  const good = await U.verify(doc, { key: OWNER.key, serial: 2 });
  assert.equal(good.ok, true);
  assert.equal(good.list.serial, 3);
  assert.equal(good.list.models[0].total, fresh.total);

  const tampered = structuredClone(doc);
  tampered.list.models[0].sha256[0] = '0'.repeat(64);
  assert.deepEqual(await U.verify(tampered, { key: OWNER.key, serial: 2 }), { ok: false, error: 'signature' });
  assert.deepEqual(await U.verify({ ...doc, list: { ...doc.list, serial: 4 } }, { key: OWNER.key, serial: 2 }), { ok: false, error: 'signature' });
  assert.deepEqual(await U.verify(sign(listOf(3), STRANGER), { key: OWNER.key, serial: 2 }), { ok: false, error: 'signature' });
  assert.deepEqual(await U.verify(doc, { key: OWNER.key, serial: 3 }), { ok: false, error: 'replay' }, 'equal serial');
  assert.deepEqual(await U.verify(doc, { key: OWNER.key, serial: 9 }), { ok: false, error: 'replay' }, 'older serial');
  assert.deepEqual(await U.verify(doc, { key: 'not-a-key', serial: 0 }), { ok: false, error: 'key' });
  assert.deepEqual(await U.verify(doc, { serial: 0 }), { ok: false, error: 'signature' }, 'the bundled key never signed a test list');
});

test('one entry out of the schema refuses the whole list', async () => {
  const bad = [
    { ...fresh, url: 'https://evil.example/x.gguf' },
    { ...fresh, tools: 0 },
    { ...fresh, minGlaze: 'soon' },
    { ...fresh, version: '' },
    { ...fresh, role: 'pictures', projector: 'x' },
    { ...fresh, sha256: fresh.sha256.slice(1) },
  ];
  for (const m of bad) assert.deepEqual(await U.verify(sign(listOf(3, [m])), { key: OWNER.key, serial: 0 }), { ok: false, error: 'shape' }, JSON.stringify(Object.keys(m)));
  assert.deepEqual(await U.verify(sign(listOf(3, [fresh, fresh])), { key: OWNER.key }), { ok: false, error: 'shape' }, 'an id twice');
  assert.deepEqual(await U.verify(sign({ ...listOf(3), serial: 0 }), { key: OWNER.key }), { ok: false, error: 'shape' });
  assert.deepEqual(await U.verify({ list: listOf(3) }, { key: OWNER.key }), { ok: false, error: 'shape' }, 'no signature');
});

test('entries needing a newer Glaze, or a tools level above this harness\'s, are skipped', () => {
  const later = { ...fresh, id: 'rime-q6', tier: 3, minGlaze: '4.1.0' };
  const smarter = { ...fresh, id: 'rime-q8', tier: 4, tools: U.TOOLS + 1 };
  const exact = { ...fresh, id: 'rime-q5', tier: 2, minGlaze: '4.0.1' };
  const got = U.usable(listOf(3, [fresh, later, smarter, exact]), { glaze: '4.0.1' }).map((m) => m.id);
  assert.deepEqual(got, ['rime-q4', 'rime-q5']);
  assert.deepEqual(U.usable(listOf(3, [later]), { glaze: '4.1' }).map((m) => m.id), ['rime-q6']);
  assert.equal(U.compare('4.0.10', '4.0.9'), 1);
  assert.equal(U.compare('4.0', '4.0.0'), 0);
});

test('accept pins every downloaded model to its version; swap, confirm and rollback move the state', () => {
  const accepted = U.accept(null, listOf(3), { glaze: '4.0.1', ready: [old] });
  assert.equal(accepted.serial, 3);
  assert.deepEqual(accepted.pins, { 'rime-q4': old });
  assert.deepEqual(accepted.models.map((m) => m.id), ['rime-q4']);
  const begun = U.begin(accepted, fresh);
  assert.deepEqual(begun.keep['rime-q4'].map((m) => m.total), [fresh.total]);
  const swapped = U.swap(begun, 'rime-q4', fresh, old);
  assert.equal(swapped.pins['rime-q4'].total, fresh.total);
  assert.deepEqual(swapped.keep['rime-q4'].map((m) => m.total), [old.total]);
  assert.deepEqual(swapped.trial, { id: 'rime-q4', from: old.total, to: fresh.total });
  const confirmed = U.confirm(swapped);
  assert.equal(confirmed.trial, null);
  assert.equal(confirmed.keep['rime-q4'], undefined);
  const rolled = U.rollback(swapped);
  assert.equal(rolled.pins['rime-q4'].total, old.total);
  assert.equal(rolled.trial, null);
  assert.equal(rolled.keep['rime-q4'], undefined);
  assert.deepEqual(rolled.failed, { [fresh.total]: 3 });
  // A newer serial lifts nothing that failed for an older one by itself, but a newer list's own entries are offered again.
  const again = U.accept(rolled, listOf(4, [{ ...fresh }]), { glaze: '4.0.1', ready: [old] });
  assert.deepEqual(again.failed, {}, 'a newer serial clears the failures: the owner published again');
});

// ---- the worker's check ------------------------------------------------------------------------------------------------
const worker = (opts = {}) => {
  const fs = opts.fs || fakeFs();
  const files = { [old.url]: OLD, [fresh.url]: NEW };
  const models = fakeHf(files);
  const store = S.create({ models: [old], fetch: models, root: async () => fs.root, estimate: fs.estimate, locks: fakeLocks(), channel: fakeBus() });
  const calls = [], hosted = [], said = [], kept = {};
  const doc = opts.doc ?? sign(listOf(3));
  const env = {
    store, key: OWNER.key, glaze: '4.0.1', now: () => opts.now ?? Date.parse('2026-11-01T12:00:00Z'),
    settings: async () => ({ updates: opts.updates ?? true }), tier: async () => opts.tier || 0, safari: !!opts.safari, saveData: () => !!opts.saveData,
    fetch: async (url, init) => { calls.push({ url, init }); if (opts.offline) throw new TypeError('Failed to fetch'); return new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json' } }); },
    host: async (op, args, { onEvent } = {}) => { hosted.push({ op, args }); onEvent?.({ type: 'progress', loaded: 0.5 }); return opts.hostResult || { state: 'swapped', version: 'r6' }; },
    local: { get: async (k) => ({ [k]: kept[k] }), set: async (o) => { Object.assign(kept, o); return true; } },
    say: (m) => said.push(m),
  };
  return { env, store, fs, calls, hosted, said, kept };
};

test('no Rime model downloaded: the check asks nothing of the network', async () => {
  const w = worker();
  assert.deepEqual(await U.check(w.env, { reason: 'daily' }), { state: 'none' });
  assert.equal(w.calls.length, 0);
  assert.equal(w.hosted.length, 0);
});

test('the switch off, Safari, or Data Saver: no request either', async () => {
  for (const o of [{ updates: false }, { safari: true }, { saveData: true }]) {
    const w = worker(o);
    await w.store.download('rime-q4');
    const r = await U.check(w.env, { reason: 'daily' });
    assert.ok(['off', 'paused'].includes(r.state), JSON.stringify(o));
    assert.equal(w.calls.length, 0, JSON.stringify(o));
  }
});

test('with a model downloaded, the check fetches the signed list without credentials and hands it to the host for the model in use', async () => {
  const w = worker();
  await w.store.download('rime-q4');
  const r = await U.check(w.env, { reason: 'daily' });
  assert.equal(r.state, 'swapped');
  assert.equal(w.calls.length, 1);
  assert.equal(w.calls[0].url, U.URL);
  assert.equal(w.calls[0].init.credentials, 'omit');
  assert.equal(w.calls[0].init.cache, 'no-store');
  assert.equal(w.hosted.length, 1);
  assert.equal(w.hosted[0].op, 'update');
  assert.equal(w.hosted[0].args.id, 'rime-q4');
  assert.equal(w.hosted[0].args.glaze, '4.0.1');
  assert.deepEqual(w.hosted[0].args.doc, sign(listOf(3)));
  assert.ok(w.said.some((m) => m.part === 'update' && m.loaded === 0.5), 'progress reaches Settings');
  assert.equal(w.kept[U.KEPT].checked, w.env.now());
});

test('a list that fails its signature never reaches the host', async () => {
  const w = worker({ doc: sign(listOf(3), STRANGER) });
  await w.store.download('rime-q4');
  assert.deepEqual(await U.check(w.env, { reason: 'daily' }), { state: 'refused', reason: 'signature' });
  assert.equal(w.hosted.length, 0);
});

test('a replayed list with nothing left to do starts no host; offline changes nothing', async () => {
  const w = worker();
  await w.store.download('rime-q4');
  await w.store.edit(() => U.accept(null, listOf(3, [{ ...old, minGlaze: '4.0.1' }]), { glaze: '4.0.1', ready: [old] }));
  assert.equal((await U.check(w.env, { reason: 'daily' })).state, 'current');
  assert.equal(w.hosted.length, 0);
  const off = worker({ offline: true });
  await off.store.download('rime-q4');
  assert.deepEqual(await U.check(off.env, { reason: 'daily' }), { state: 'offline' });
  assert.equal(off.hosted.length, 0);
});

test('at browser start a check within the last day is not repeated, unless a download waits to resume', async () => {
  const w = worker();
  await w.store.download('rime-q4');
  w.kept[U.KEPT] = { checked: w.env.now() - 3600e3 };
  assert.equal((await U.check(w.env, { reason: 'start' })).state, 'recent');
  assert.equal(w.calls.length, 0);
  await w.store.edit(() => U.begin(U.accept(null, listOf(3), { glaze: '4.0.1', ready: [old] }), fresh));
  assert.equal((await U.check(w.env, { reason: 'start' })).state, 'swapped', 'a pending download resumes at start');
});

test('the daily alarm is made once, a day apart; browser start adds a check a few minutes later with jitter', async () => {
  const made = new Map();
  const alarms = { get: async (n) => made.get(n), create: (n, o) => { made.set(n, { name: n, ...o }); } };
  await U.schedule({ alarms, random: () => 0.5 }, { startup: false });
  assert.equal(made.get(U.DAILY).periodInMinutes, 1440);
  assert.ok(!made.has(U.START));
  const first = made.get(U.DAILY);
  await U.schedule({ alarms, random: () => 0 }, { startup: true });
  assert.equal(made.get(U.DAILY), first, 'an existing daily alarm keeps its time');
  assert.ok(made.get(U.START).delayInMinutes >= 2 && made.get(U.START).delayInMinutes <= 10);
  await U.schedule({ alarms, random: () => 0.999 }, { startup: true });
  assert.ok(made.get(U.START).delayInMinutes > 9 && made.get(U.START).delayInMinutes <= 10);
  assert.equal(U.alarm({}, { name: 'gz-rime:x' }), null, 'another feature\'s alarm is not ours');
});

test('about says the version in use, the update downloading and whether it is on', async () => {
  const w = worker();
  await w.store.download('rime-q4');
  let release;
  w.env.host = (op, args, { onEvent }) => { onEvent({ type: 'progress', loaded: 0.25 }); return new Promise((r) => { release = r; }); };
  const running = U.check(w.env, { reason: 'daily' });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await U.about(w.env), { auto: true, version: 'r5', update: { version: 'r6', progress: 0.25 } });
  release({ state: 'swapped', version: 'r6' });
  await running;
  const after = await U.about(w.env);
  assert.equal(after.update, undefined);
});

test('turning the switch off stops a running update', async () => {
  const w = worker();
  await w.store.download('rime-q4');
  let signal;
  w.env.host = (op, args, opts) => { signal = opts.signal; return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(opts.signal.reason))); };
  const running = U.check(w.env, { reason: 'daily' });
  await new Promise((r) => setTimeout(r, 20));
  U.stop();
  assert.equal(signal.aborted, true);
  assert.equal((await running).state, 'stopped');
});
