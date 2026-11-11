// The setup wizard's AI step (settings/setup-ai.js) and what the worker lets the first screen do with AI's connections
// ('glaze:ai-config' from settings/welcome.html's own top frame: Settings' Simple mode, nothing more).
const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('../helpers/worker-env.cjs');
const { fakeIDB } = require('../helpers/fake-idb.cjs');

const EXT = 'chrome-extension://x';
const KEY = 'sk-proj-WIZARDKEY0123456789';
const welcome = (extra = {}) => ({ id: 'glaze', frameId: 0, url: `${EXT}/settings/welcome.html#/ai`, origin: EXT, tab: { id: 5, url: `${EXT}/settings/welcome.html#/ai` }, ...extra });
const editor = { id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 9, url: `${EXT}/options.html` } };
const make = () => worker({ globals: fakeIDB(), grants: new Set(['https://api.openai.com/*']) });
const ask = async (w, m, sender = welcome()) => JSON.parse(JSON.stringify(await w.send({ type: 'glaze:ai-config', ...m }, sender) ?? null));

test('the first screen reads the connections, keeps a named provider\'s key, and picks Rime or the browser\'s model', async () => {
  const w = make();
  assert.equal((await ask(w, { op: 'get' })).ok, true);
  assert.equal((await ask(w, { op: 'set', id: 'openai', cfg: { provider: 'openai', key: KEY } })).ok, true);
  const got = await ask(w, { op: 'get' });
  assert.equal(got.connections.openai.key, 'sk-p••••6789', 'the key comes back only masked');
  assert.ok(!JSON.stringify(got).includes(KEY));
  for (const id of ['local', 'device']) assert.equal((await ask(w, { op: 'set', id, cfg: { provider: id } })).ok, true, id);
  for (const m of [{ op: 'test', id: 'openai' }, { op: 'models', id: 'openai' }, { op: 'test', provider: 'device' }, { op: 'test', provider: 'local' }]) {
    assert.notEqual((await ask(w, m))?.error, 'sender', JSON.stringify(m));
  }
});

test('the first screen may not add an endpoint, move a provider\'s address, remove or delete anything, or tune Rime', async () => {
  const w = make();
  await ask(w, { op: 'set', id: 'openai', cfg: { provider: 'openai', key: KEY } }, editor);
  for (const m of [
    { op: 'set', id: 'custom-1', cfg: { provider: 'openai', name: 'Mine', base: 'https://llm.example.com/v1', key: KEY } },
    { op: 'set', id: 'openai', cfg: { provider: 'openai', key: KEY, base: 'https://llm.example.com/v1' } },
    { op: 'set', id: 'openai', cfg: { provider: 'openai' } },
    { op: 'set', id: 'openai', cfg: { provider: 'local' } },
    { op: 'set', id: 'local', cfg: { provider: 'local', tier: 2 } },
    { op: 'set', id: 'device', cfg: { provider: 'local' } },
    { op: 'remove', id: 'openai' },
    { op: 'delete', provider: 'local' },
    { op: 'prepare', provider: 'local', part: 'pictures' },
    { op: 'prepare', id: 'openai' },
    { op: 'models', id: 'custom-1' },
    { op: 'test', id: 'custom-1' },
  ]) assert.deepEqual(await ask(w, m), { ok: false, error: 'sender' }, JSON.stringify(m));
  assert.equal((await ask(w, { op: 'get' }, editor)).connections.openai.key, 'sk-p••••6789', 'the kept key is untouched');
});

test('keeping an existing Rime connection preserves its tuning', async () => {
  const w = make();
  assert.equal((await ask(w, { op: 'set', id: 'local', cfg: { provider: 'local', tier: 2, context: 8192 } }, editor)).ok, true);
  const before = (await ask(w, { op: 'get' }, editor)).connections.local;
  assert.equal(before.tier, 2);
  assert.equal((await ask(w, { op: 'set', id: 'local', cfg: { provider: 'local' } })).ok, true);
  assert.deepEqual((await ask(w, { op: 'get' }, editor)).connections.local, before);
});

test('only the first screen\'s own top frame: not a frame of it, another page, another extension or another origin', async () => {
  const w = make();
  for (const sender of [welcome({ frameId: 2 }), welcome({ tab: undefined }), welcome({ id: 'other' }), welcome({ origin: 'https://evil.example' }),
    welcome({ url: `${EXT}/popup.html` }), welcome({ url: 'https://school.instructure.com/settings/welcome.html', origin: 'https://school.instructure.com' })]) {
    assert.deepEqual(await ask(w, { op: 'get' }, sender), { ok: false, error: 'sender' }, JSON.stringify(sender));
  }
});

// The step's own rules (settings/setup-ai.js).
const G = require('../../extension/settings/setup-ai.js');
const S = require('../../extension/ai/settings.js');
const t = (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]);
const on = (raw) => S.clean({ ...raw, on: true });

test('AI is off until the student picks, and the choice shown is what storage says', () => {
  assert.equal(G.choiceOf(S.clean()), 'off');
  assert.equal(G.choiceOf(S.clean({ model: { use: 'local', model: '' } })), 'off', 'a model kept while AI is off is still off');
  assert.equal(G.choiceOf(on({ model: { use: 'local', model: '' } })), 'local');
  assert.equal(G.choiceOf(on({ model: { use: 'device', model: '' } })), 'device');
  assert.equal(G.choiceOf(on({ model: { use: 'openai', model: 'gpt-5' } })), 'key');
  assert.equal(G.choiceOf(on({})), 'key', 'on with no model: a key not yet connected');
  assert.equal(G.providerOf(on({ model: { use: 'anthropic', model: 'x' } })), 'anthropic');
  assert.equal(G.providerOf(on({ model: { use: 'custom-1', model: 'x' } })), null, 'an endpoint of the student\'s own is no named provider');
  assert.deepEqual(G.CHOICES, ['off', 'local', 'device', 'key']);
});

test('a choice writes what Settings would, and turns no feature on', () => {
  const fresh = S.clean();
  assert.deepEqual(G.choose(fresh, 'off'), { on: false });
  assert.deepEqual(G.choose(fresh, 'local'), { on: true, model: { use: 'local', model: '' } });
  assert.deepEqual(G.choose(fresh, 'device'), { on: true, model: { use: 'device', model: '' } });
  assert.deepEqual(G.choose(fresh, 'key'), { on: false, model: { use: null, model: '' } }, 'a key turns AI on only once it works');
  assert.deepEqual(G.choose(on({ model: { use: 'local', model: '' } }), 'key'), { on: false, model: { use: null, model: '' } }, 'a key leaves Rime, AI off until it works');
  assert.deepEqual(G.choose(on({ model: { use: 'openai', model: 'gpt-5' } }), 'key'), { on: true }, 'a provider already chosen stays');
  for (const c of G.CHOICES) {
    const s = S.clean({ ...fresh, ...G.choose(fresh, c) });
    assert.deepEqual(s.features, { syllabus: false, completion: false, writing: false, ask: false }, `${c}: Settings turns no feature on with AI (docs/ai-harness.md)`);
  }
  assert.deepEqual(G.feature(fresh, 'ask', true).features, { ...fresh.features, ask: true });
  assert.deepEqual([...G.FEATURES].sort(), [...S.FEATURES].sort(), 'every feature Settings has, and no other');
});

test('a provider connected becomes the model as Settings suggests it while the key choice is current', () => {
  const ids = ['gpt-5', 'gpt-5-mini', 'gpt-4.1'];
  const p = G.keyed(on({}), 'openai', ids);
  assert.equal(p.on, true);
  assert.deepEqual(p.model, { use: 'openai', model: 'gpt-5' });
  assert.deepEqual(p.models.completion, { use: 'openai', model: 'gpt-5-mini' });
  assert.deepEqual(G.keyed(on({ model: { use: 'openai', model: 'gpt-4.1' } }), 'openai', ids), { on: true }, 'one of its own already chosen stays');
  assert.deepEqual(G.keyed(on({}), 'openai', ['nothing-known']), { on: true, model: { use: 'openai', model: '' } }, 'no suggestion: the provider, its model to choose in Settings');
  // Your key picked on this page (AI still off until now): the key that works turns it on.
  const picked = S.clean({ ...S.clean(), ...G.choose(S.clean(), 'key') });
  assert.deepEqual(G.keyed(picked, 'openai', ids, true).model, { use: 'openai', model: 'gpt-5' });
  assert.equal(G.keyed(picked, 'openai', ids, true).on, true);
});

test('a provider whose key is kept but whose host the browser refused is not connected', () => {
  assert.equal(G.connected({ key: 'sk-p••••6789' }), true);
  assert.equal(G.connected({ key: 'sk-p••••6789', reach: false }), false, 'the worker says its host is not held');
  assert.equal(G.connected({ key: 'sk-p••••6789' }, { state: 'unavailable', reason: 'permission' }), false, 'refused this session');
  assert.equal(G.connected({ key: 'sk-p••••6789', reach: false }, { state: 'ready' }), true, 'allowed since');
  assert.equal(G.connected(undefined), false);
});

test('a delayed provider catalog cannot replace a newer local or off choice', () => {
  for (const cur of [S.clean(), on({ model: { use: 'local', model: '' } }), on({ model: { use: 'device', model: '' } })]) {
    assert.deepEqual(G.keyed(cur, 'openai', ['gpt-5']), {});
  }
});

test('the cards\' words and the done step\'s row', () => {
  assert.equal(G.ownText({ state: 'download', size: 1.1e9 }, t), '1.1 GB');
  assert.equal(G.ownText({ state: 'download', size: 1.1e9 }, t, true), 'Download · 1.1 GB', 'chosen but not coming: its card starts it');
  assert.equal(G.ownText({ state: 'downloading', progress: 0.42, size: 1.1e9 }, t), '42%');
  assert.equal(G.ownText({ state: 'downloading' }, t), 'Downloading…');
  assert.equal(G.ownText({ state: 'ready' }, t), 'Ready');
  assert.equal(G.ownText({ state: 'unavailable', reason: 'pending' }, t), 'Not available yet');
  assert.equal(G.ownText(null, t), '');
  assert.equal(G.deviceText({ state: 'download', reason: 'activation' }, t), 'Needs a download');
  assert.equal(G.deviceText({ state: 'download' }, t), 'Needs a download');
  assert.equal(G.offered({ state: 'unavailable', reason: 'browser' }), false);
  assert.equal(G.offered({ state: 'download' }), true);
  assert.equal(G.offered(null), false);
  assert.deepEqual(G.summary(S.clean(), t), [['AI', 'Off', false]]);
  assert.deepEqual(G.summary(on({ model: { use: 'local', model: '' } }), t), [['AI', 'Rime', false]]);
  assert.deepEqual(G.summary(on({ model: { use: 'device', model: '' } }), t), [['AI', 'Chrome on-device AI', false]]);
  assert.deepEqual(G.summary(on({ model: { use: 'openai', model: 'gpt-5' } }), t), [['AI', 'OpenAI', true]]);
  assert.deepEqual(G.summary(S.clean({ ...S.clean(), ...G.choose(S.clean(), 'key') }), t), [['AI', 'Off', false]], 'Your key picked, none connected: AI is off');
  assert.deepEqual(G.summary(on({}), t), [['AI', 'Choose a model', false]], 'on with no model: nothing runs yet');
});

test('the done step asks for a model when a named provider has no selected model', () => {
  const patch = G.keyed(on({}), 'openai', ['unknown-model']);
  const selected = S.clean({ ...on({}), ...patch });
  assert.equal(selected.on, true);
  assert.equal(selected.model.model, '');
  assert.deepEqual(G.summary(selected, t), [['AI', 'Choose a model', false]]);
});

test('a delayed setup catalog cannot turn AI back on after another settings page turns it off', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '../../extension/settings/setup-ai.js'), 'utf8');
  const listeners = [], ctx = { G, S, KEY: S.KEY, KEYED: 'key', render() {}, c: { storage: { onChanged: { addListener: (f) => listeners.push(f) } } } };
  let resolve;
  ctx.send = () => new Promise((r) => { resolve = r; });
  vm.runInNewContext(`
    let s = S.clean({ on: true, model: { use: 'openai', model: 'gpt-5' } }), picked = KEYED, want = 'openai';
    ${source.slice(source.indexOf('const current = '), source.indexOf('const tested = '))}
    const write = async (patch) => { s = S.clean({ ...s, ...patch(s) }); };
    ${source.slice(source.indexOf('const use = async'), source.indexOf('const say = '))}
    ${source.slice(source.indexOf('c.storage.onChanged.addListener'), source.indexOf('store.get(KEY).then', source.indexOf('c.storage.onChanged.addListener')))}
    globalThis.start = () => use('openai');
    globalThis.settings = () => s;
  `, ctx);
  const pending = ctx.start();
  const before = ctx.settings(), off = { ...before, on: false };
  listeners[0]({ [S.KEY]: { oldValue: before, newValue: off } }, 'local');
  resolve({ ok: true, models: [{ id: 'gpt-5' }] });
  await pending;
  assert.equal(ctx.settings().on, false, 'the latest Off choice wins over the earlier key choice');
});

test('the page loads what the step needs before it, fetches nothing itself, and asks for a host only from Connect', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension/settings', f), 'utf8');
  const html = read('welcome.html'), js = read('setup-ai.js');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  for (const src of ['../ai/endpoint.js', '../ai/settings.js', '../ai/failure.js', 'editor-ai.js', '../core/site.js']) assert.ok(at(src) >= 0 && at(src) < at('setup-ai.js'), src);
  assert.ok(at('setup-ai.js') < at('setup.js'));
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|WebSocket|innerHTML|insertAdjacentHTML/);
  assert.doesNotMatch(js, /chrome\.storage\.sync|storage\.sync/, 'AI is never synced');
  assert.doesNotMatch(js, /chrome\.permissions\./, 'hosts through core/site.js reach');
  const connect = js.slice(js.indexOf('const connect = '), js.indexOf('const connections = '));
  assert.ok(connect.indexOf('GZ_SITE.reach(') > 0 && connect.indexOf('GZ_SITE.reach(') < connect.indexOf('await'), 'the host is asked for before anything is awaited');
  assert.doesNotMatch(js, /console\.|textContent = key|value = conns/, 'a key is never logged or shown back but masked');
});
