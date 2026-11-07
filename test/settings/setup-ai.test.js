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

test('only the first screen\'s own top frame: not a frame of it, another page, another extension or another origin', async () => {
  const w = make();
  for (const sender of [welcome({ frameId: 2 }), welcome({ tab: undefined }), welcome({ id: 'other' }), welcome({ origin: 'https://evil.example' }),
    welcome({ url: `${EXT}/popup.html` }), welcome({ url: 'https://school.instructure.com/settings/welcome.html', origin: 'https://school.instructure.com' })]) {
    assert.deepEqual(await ask(w, { op: 'get' }, sender), { ok: false, error: 'sender' }, JSON.stringify(sender));
  }
});
