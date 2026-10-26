// The AI harness in the real worker (lib/background.js in a vm, test/helpers/worker-env.cjs): who may open the 'glaze:ai' port
// and who may keep connections, where the key is kept (the worker's own IndexedDB: not storage.local, which any page's script
// can read, nor sync), and that neither a Back up file nor a shared Look carries AI's settings or a key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const worker = require('./helpers/worker-env.cjs');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

const CANVAS = 'https://school.instructure.com', EXT = 'chrome-extension://x';
const KEY = 'sk-proj-WORKERKEY0123456789';
const lms = (p = '/courses/1', extra = {}) => ({ id: 'glaze', frameId: 0, url: `${CANVAS}${p}`, origin: CANVAS, tab: { id: 4, url: `${CANVAS}${p}` }, ...extra });
const editor = (extra = {}) => ({ id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 9, url: `${EXT}/options.html` }, ...extra });
const make = (fetch) => worker({ globals: fakeIDB(), fetch, grants: new Set(['https://api.example.com/*']),
  store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ai: { on: true, use: 'main', features: { syllabus: true } } }, session: {} } });
const status = async (w, sender) => {
  const { port, say } = w.connect('glaze:ai', sender);
  say({ id: 1, op: 'status', feature: 'syllabus' });
  await w.settle();
  return { port, reply: port.posted[0] && JSON.parse(JSON.stringify(port.posted[0])) };
};

test('Glaze in a page of a site it runs on, and Glaze\'s own pages, may open the AI port; a quiz, a tool, another site may not', async () => {
  const w = make();
  for (const sender of [lms(), lms('/courses/1/assignments/syllabus'), editor(), lms('/courses/1', { frameId: 2, tab: { id: 4, url: `${CANVAS}/courses/1` } })]) {
    const { port, reply } = await status(w, sender);
    assert.equal(port.hungUp, false, sender.url);
    assert.equal(reply.type, 'status', sender.url);
  }
  for (const sender of [lms('/courses/1/quizzes/3'), lms('/courses/1/external_tools/9'), lms('/courses/1/assignments/2/lti'),
    { ...lms(), url: 'https://evil.example.com/', origin: 'https://evil.example.com', tab: { id: 4, url: 'https://evil.example.com/' } },
    { ...lms(), id: 'another-extension' }]) {
    const { port, reply } = await status(w, sender);
    assert.equal(port.hungUp, true, sender.url);
    assert.equal(reply, undefined, `${sender.url}: nothing read, nothing said`);
  }
});

test('only Settings\' own top frame keeps connections, and the key never leaves the worker\'s own store', async () => {
  const w = make();
  const set = { type: 'glaze:ai-config', op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } };
  for (const sender of [lms(), editor({ frameId: 3 }), { ...editor(), url: `${EXT}/popup.html` }, { ...editor(), origin: 'https://evil.example.com' }]) {
    assert.deepEqual(await w.send(set, sender), { ok: false, error: 'sender' }, sender.url);
  }
  assert.deepEqual(await w.send(set, editor()), { ok: true, origin: 'https://api.example.com/*' });
  const got = await w.send({ type: 'glaze:ai-config', op: 'get' }, editor());
  assert.deepEqual(JSON.parse(JSON.stringify(got.connections.main)), { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: 'sk-p••••6789', origin: 'https://api.example.com/*' });
  const kept = JSON.stringify([w.store.local, w.store.sync, w.store.session, got]);
  assert.ok(!kept.includes(KEY), 'not in storage.local, sync or session, nor read back');
  // The page asks; the worker answers with what it may know.
  const { reply } = await status(w, lms());
  assert.deepEqual(reply, { id: 1, type: 'status', on: true, allowed: true, ready: true, provider: 'openai', caps: { text: true, json: true, stream: true } });
  assert.ok(!JSON.stringify(reply).includes('api.example.com'));
});

test('a run from a page reaches only the connection\'s server, with the key, and the page gets the checked output', async () => {
  const calls = [];
  const w = make(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"ok"}' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  });
  await w.send({ type: 'glaze:ai-config', op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } }, editor());
  const { port, say } = w.connect('glaze:ai', lms());
  await w.settle();
  // A task the worker would import with the harness (lib/background.js aiFiles); here added in its realm.
  require('node:vm').runInContext(`GZ_AI_TASKS.add({ id: 'example.echo', version: 1, input: (r) => r, check: (o) => o,
    build: (i, { text }) => text.request({ system: 'Echo.', data: [{ label: 'text', text: i.text }] }),
    output: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } })`, w.context);
  say({ id: 2, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hi' } });
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(port.posted.at(-1).output)), { text: 'ok' });
  assert.deepEqual(calls.map((c) => c.url), ['https://api.example.com/v1/models', 'https://api.example.com/v1/chat/completions']);
  assert.equal(calls[1].init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(port.posted).includes(KEY));
  // The run's row: metadata only, in storage.local aiCalls.
  assert.equal(w.store.local.aiCalls.length, 1);
  assert.ok(!JSON.stringify(w.store.local.aiCalls).includes(KEY) && !JSON.stringify(w.store.local.aiCalls).includes('api.example.com'));
  // The host taken back: refused before anything is sent.
  w.grants.delete('https://api.example.com/*');
  say({ id: 3, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hi' } });
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(port.posted.at(-1))), { id: 3, type: 'error', error: 'permission' });
  assert.equal(calls.length, 2);
});

test('AI is off by default: a fresh worker has no settings for it, and a page is told it may not ask', async () => {
  const w = worker({ globals: fakeIDB() });
  const { reply } = await status(w, lms());
  assert.deepEqual(reply, { id: 1, type: 'status', on: false, allowed: false });
  assert.equal(w.store.local.ai, undefined);
});

test('a Back up file and a shared Look carry none of AI\'s settings, its connections or a key', async () => {
  const G = require('../defaults.js');
  const BK = require('../lib/backup.js');
  const SH = require('../lib/share.js');
  const local = { ai: { on: true, use: 'main', features: { syllabus: true } }, aiCalls: [{ id: 'r', task: 't', state: 'completed' }], connections: { main: { key: KEY } }, aiKey: KEY };
  const settings = G.GZ_SANITIZE({ ...G.GZ_DEFAULTS, ai: { on: true }, aiKey: KEY });
  assert.equal(settings.ai, undefined, 'not a synced setting');
  const entries = BK.pack({ settings, tasks: { tasks: {} }, local });
  const text = entries.map((e) => Buffer.from(e.data).toString()).join('\n');
  assert.ok(!text.includes(KEY));
  assert.ok(!/"ai"\s*:|aiCalls/.test(text), 'storage.local ai and the call record are not in the file');
  const code = await SH.encode({ ...settings, ai: { on: true }, aiKey: KEY }, {}, null);
  const look = JSON.stringify(await SH.decode(code));
  assert.match(look, /"colors"/, 'a Look, read back');
  assert.ok(!code.includes(KEY) && !look.includes(KEY) && !/"ai"/.test(look));
});

test('nothing of AI is in a page\'s first script, and the worker loads it only when a port opens', () => {
  const m = require('../manifest.json');
  for (const c of m.content_scripts) for (const f of c.js) assert.ok(!f.startsWith('lib/ai/'), f);
  const bg = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
  assert.ok(!/^importScripts\([^)]*ai\//m.test(bg), 'not in the worker\'s first imports');
  const w = worker();
  assert.equal(w.context.GZ_AI_BROKER, undefined);
});

test('Firefox\'s event page loads every file of the harness the worker would import, by name', () => {
  // scripts/package-firefox.sh: the files named in the worker's importScripts calls, as it reads them.
  const bg = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
  const named = new Set([...bg.matchAll(/importScripts\(([^)]*)\)/g)].flatMap(([, a]) => [...a.matchAll(/'([^']+)'/g)].map(([, f]) => `lib/${f}`)));
  const shipped = fs.readdirSync(path.join(__dirname, '..', 'lib/ai'), { recursive: true }).filter((f) => f.endsWith('.js') && f !== 'providers/mock.js').map((f) => `lib/ai/${f}`);
  assert.ok(shipped.length >= 14);
  for (const f of shipped) assert.ok(named.has(f), `${f} is named in an importScripts call`);
  assert.ok(!named.has('lib/ai/providers/mock.js'), 'the mock is for tests and the eval');
});
