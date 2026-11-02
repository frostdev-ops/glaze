// Real worker wiring: Settings remains local and available after logout; school controls reuse Ask's fresh account
// lease, and every publication path reaches the canonical memory queue rather than a separate adapter or authority.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const worker = require('../helpers/worker-env.cjs');
const { fakeIDB } = require('../helpers/fake-idb.cjs');

const SITE = 'https://school.instructure.com', OTHER = 'https://other.instructure.com', EXT = 'chrome-extension://x';
const A = `${SITE}/42`, B = `${SITE}/43`, C = `${OTHER}/42`;
const token = (n) => n.toString(16).padStart(32, '0');
const record = (account, n, kind = 'memory', extra = {}) => ({ v: 1, id: `${kind === 'memory' ? 'm' : 's'}-${token(n)}`, account, kind,
  markdown: kind === 'memory' ? `Preference ${n}.` : `Chapter ${n}.`, createdAt: 10, updatedAt: 10, revision: token(n + 100),
  source: kind === 'memory' ? { type: 'user-message', evidence: `Preference ${n}.` } : { type: 'course-read', tool: 'content_read', course: '25', id: String(n), observedAt: 10, complete: true }, ...extra });
const key = (r) => `${r.kind === 'memory' ? 'rimeMemory' : 'rimeMaterial'}:${r.account}|${r.id}`;
const editor = (extra = {}) => ({ id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 9, url: `${EXT}/options.html` }, ...extra });
const school = (extra = {}) => ({ id: 'glaze', frameId: 0, documentId: 'school-doc', url: `${SITE}/courses/25`, origin: SITE, tab: { id: 4, url: `${SITE}/courses/25` }, ...extra });
const request = (op, rest = {}) => ({ type: 'glaze:memory', op, ...rest });
const make = (rows = [record(A, 1), record(B, 2)]) => {
  const w = worker({ globals: fakeIDB(), fetch: async () => { throw Error('unexpected network'); }, store: {
    sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ai: { on: false, memory: false, features: { ask: false }, future: { preserve: true } }, ...Object.fromEntries(rows.map((r) => [key(r), r])) }, session: {},
  } });
  // Chrome constructs results in the worker's realm; the shared VM fixture uses a host structuredClone.
  const realm = (v) => v === undefined ? undefined : vm.runInContext('JSON.parse', w.context)(JSON.stringify(v));
  w.context.structuredClone = realm;
  const raw = w.context.chrome.storage.local, get = raw.get;
  raw.get = async (keys) => realm(await get(keys));
  return { ...w, raw, realm };
};
const live = (w, sender = school()) => {
  const state = { account: '42', href: sender.url, doc: sender.documentId, ancestors: [], reads: 0 };
  w.context.chrome.tabs.get = async () => ({ ...sender.tab, url: state.href });
  w.context.chrome.scripting.executeScript = async ({ func }) => {
    if (func?.name === 'rimeRead') state.reads++;
    return [{ frameId: sender.frameId, documentId: state.doc, result: w.realm({ href: state.href, origin: new URL(state.href).origin, ancestors: state.ancestors, ...(state.account && { account: state.account }) }) }];
  };
  return state;
};
const until = async (w, condition) => { const end = Date.now() + 5000; while (!condition() && Date.now() < end) await w.settle(); assert.ok(condition(), 'worker reached expected state'); };

test('top-level memory controls work with AI off, without loading a model or fetching an account', async () => {
  const w = make();
  w.context.chrome.scripting.executeScript = async () => { throw Error('unexpected account read'); };
  assert.equal(w.context.GZ_AI_BROKER, undefined);
  assert.deepEqual(await w.send(request('state'), editor()), { ok: true, enabled: false });
  const listed = await w.send(request('list', { kind: 'memory' }), editor());
  assert.equal(listed.ok, true); assert.deepEqual(new Set(listed.records.map((r) => r.account)), new Set([A, B]));
  const store = vm.runInContext('rimeMemory()', w.context), held = store.lease(A);
  assert.equal(store, vm.runInContext('rimeMemory()', w.context), 'one raw-local store per worker');
  assert.deepEqual(await w.send(request('settings', { enabled: true }), editor()), { ok: true, enabled: true });
  assert.deepEqual(w.store.local.ai, { on: false, memory: true, features: { ask: false }, future: { preserve: true } });
  assert.equal(store.validateLease(A, held), false);
  assert.equal(w.context.GZ_AI_BROKER, undefined, 'local controls never load the model harness');
  assert.equal((await w.send(request('export'), editor())).ok, true);
});

test('embedded settings, wrong origins and caller-provided authority never grant global memory controls', async () => {
  const w = make();
  for (const sender of [editor({ frameId: 2 }), editor({ origin: 'https://evil.example' }), editor({ id: 'another-extension' }), editor({ url: `${EXT}/popup.html` })]) {
    const result = await w.send(request('list', { kind: 'memory' }), sender);
    assert.equal(result.ok, false, JSON.stringify(sender));
  }
  for (const extra of [{ all: true }, { account: B }, { guard: true }]) assert.equal((await w.send(request('list', { kind: 'memory', ...extra }), editor())).ok, false);
});

test('school memory controls use Ask current account lease and cannot switch or export global state', async () => {
  const w = make(), state = live(w);
  const out = await w.send(request('list', { kind: 'memory' }), school());
  assert.equal(out.ok, true); assert.deepEqual(out.records.map((r) => r.account), [A]);
  assert.ok(state.reads >= 2, 'the account lease is refreshed before the response');
  for (const m of [request('state'), request('settings', { enabled: true }), request('export'), request('forget', { id: record(B, 2).id, revision: record(B, 2).revision })]) {
    assert.equal((await w.send(m, school())).ok, false);
  }
  state.account = '';
  assert.equal((await w.send(request('list', { kind: 'memory' }), school())).ok, false);
});

test('school edits waiting on memory queue are refused after an account switch', async () => {
  const w = make(), state = live(w), row = record(A, 1);
  await w.send(request('list', { kind: 'memory' }), editor());
  let release, started;
  const ready = new Promise((done) => { started = done; });
  const blocked = w.context.GZ_MEMORY.queued({}, () => { started(); return new Promise((done) => { release = done; }); });
  await ready;
  const pending = w.send(request('update', { id: row.id, revision: row.revision, markdown: 'Stale edit.' }), school());
  try { await until(w, () => state.reads >= 3); await w.settle(); state.account = '43'; }
  finally { release(); await blocked; }
  assert.deepEqual(await pending, { ok: false, error: 'scope' });
  assert.equal(w.store.local[key(row)].markdown, row.markdown);
});

test('school reads revalidate after reading storage and never return an expired account record', async () => {
  const w = make(), state = live(w), get = w.raw.get;
  w.raw.get = async (keys) => { const out = await get(keys); if ([].concat(keys).some((k) => k?.startsWith('rimeMemory:'))) state.account = '43'; return out; };
  assert.deepEqual(await w.send(request('read', { id: record(A, 1).id }), school()), { ok: false, error: 'scope' });
});

test('Ask receives the same singleton memory store with separate switch and model capability checks', async () => {
  const w = make(); live(w);
  vm.runInContext('ai()', w.context);
  let env;
  w.context.GZ_AI_ASK.connect = (_port, value) => { env = value; };
  w.connect('glaze:ask', school());
  assert.ok(env?.memory?.store);
  assert.equal(env.memory.store, vm.runInContext('rimeMemory()', w.context));
  assert.equal(await env.memory.on(), false);
  w.store.local.ai = { on: true, model: { use: 'main', model: 'cloud' }, features: { ask: true }, memory: true };
  assert.equal(await env.memory.on(), true);
  assert.equal(await env.memory.capable(), true, 'cloud models use the normal tools capability');
  w.store.local.ai.model = { use: 'local', model: '' };
  w.context.GZ_AI_LOCAL.config = () => ({ model: 'rime', tier: 1 });
  w.context.GZ_AI_LOCAL.catalog = async () => ({ models: [{ id: 'rime', weights: 'downloaded-rime' }] });
  let checked;
  w.context.GZ_AI_LOCAL.memoryVersion = async (cfg) => { checked = cfg; return 1; };
  assert.equal(await env.memory.capable(), true);
  assert.equal(checked.weights, 'downloaded-rime', 'capability is checked against the selected catalog weights');
  w.context.GZ_AI_LOCAL.memoryVersion = async () => 2;
  assert.equal(await env.memory.capable(), false, 'unknown memory contracts are not supported');
  w.store.local.ai.memory = false; assert.equal(await env.memory.on(), false);
  w.store.local.ai.memory = true; w.store.local.ai.features.ask = false; assert.equal(await env.memory.on(), false);
  w.store.local.ai.features.ask = true; w.store.sync.enabled = false; assert.equal(await env.memory.on(), false);
});

test('Drive memory CAS uses raw local core queue and deletion dominance', async () => {
  const w = make(), row = record(A, 1);
  let storeEnv;
  w.context.GZ_DRIVE = {};
  w.context.GZ_DRIVE_SYNC = { create: () => ({}) };
  w.context.GZ_DRIVE_STORE = { canon: JSON.stringify, notesArea: () => ({}), create: (env) => { storeEnv = env; return {}; } };
  vm.runInContext('openDriveSync()', w.context);
  const store = vm.runInContext('rimeMemory()', w.context), held = store.lease(A);
  const deleted = { v: 1, id: row.id, account: A, kind: 'memory', createdAt: 10, updatedAt: 11, revision: token(400), deleted: true };
  const local = storeEnv.area('local');
  assert.equal(await local.replace(key(row), w.realm(row), w.realm(deleted)), true);
  assert.equal(store.validateLease(A, held), false);
  assert.equal(await local.replace(key(row), w.realm(deleted), w.realm({ ...row, updatedAt: 100, revision: token(401) })), false);
  assert.equal(w.store.local[key(row)].deleted, true);
});

test('site removal purges its cached sources and source tombstones while retaining saved memories', async () => {
  const a = record(A, 3, 'course'), b = record(C, 4, 'course'), tomb = { ...record(A, 5, 'course'), deleted: true };
  delete tomb.markdown; delete tomb.source;
  const w = make([record(A, 1), a, b, tomb]);
  assert.equal(await vm.runInContext('forget', w.context)(SITE), true);
  assert.equal(w.store.local[key(a)], undefined); assert.equal(w.store.local[key(tomb)], undefined);
  assert.ok(w.store.local[key(b)]); assert.ok(w.store.local[key(record(A, 1))]);
  assert.equal(await vm.runInContext('forgetAll()', w.context), true);
  assert.equal(w.store.local[key(b)], undefined); assert.ok(w.store.local[key(record(A, 1))]);
});
