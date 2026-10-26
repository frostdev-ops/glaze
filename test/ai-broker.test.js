// The AI harness's broker (lib/ai/broker.js) on a stand-in port, storage and server: every check before anything is sent,
// one run at a time for a tab's feature, a rate limit, cancel and a closed port ending the request, and no address, model or
// key ever going to a page. The worker's own wiring and sender checks are test/ai-worker.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/ai/broker.js');
const T = require('../lib/ai/task.js');
require('../lib/ai/providers/openai.js');

const KEY = 'sk-live-ABCDEF0123456789';
const CFG = { base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY };
const echo = T.define({ id: 'example.echo', version: 1, input: (raw) => (typeof raw?.text === 'string' && raw.text.length < 1000 ? raw : null),
  build: (input, { text }) => text.request({ system: 'Repeat the text as {"text": ...}.', data: [{ label: 'text', text: input.text }] }),
  output: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, check: (o) => o });
const story = T.define({ ...echo, id: 'example.story', stream: true });
const TASKS = { 'example.echo': echo, 'example.story': story };
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(setImmediate); };
const port = () => {
  const on = { message: [], disconnect: [] };
  return { posted: [], hungUp: false, postMessage(m) { this.posted.push(JSON.parse(JSON.stringify(m))); }, disconnect() { this.hungUp = true; },
    onMessage: { addListener: (f) => on.message.push(f) }, onDisconnect: { addListener: (f) => on.disconnect.push(f) },
    say(m) { for (const f of on.message) f(m); }, close() { for (const f of on.disconnect) f(); } };
};
const answer = (body) => new Response(JSON.stringify({ model: 'gpt-x', choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { headers: { 'content-type': 'application/json' } });
const env = (over = {}) => {
  const vault = new Map([['connections', { openai: CFG }]]);
  const calls = [], log = [];
  return {
    calls, log, vaultData: vault, who: '7', allowed: Promise.resolve(true),
    settings: async () => ({ on: true, use: 'openai', features: { syllabus: true } }),
    enabled: async () => true,
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async (url) => url === 'https://api.example.com/',
    fetch: async (url, init) => { calls.push({ url, init }); return answer({ text: JSON.parse(init.body).messages[1].content.match(/>>\n([\s\S]*)\n<</)[1] }); },
    task: async (id) => TASKS[id] || null,
    activity: (a) => log.push(a),
    ...over,
  };
};
const open = (e) => { const p = port(); B.connect(p, e); return p; };
const run = (input = { text: 'hello' }, extra = {}) => ({ id: 1, op: 'run', feature: 'syllabus', task: 'example.echo', input, ...extra });
test.beforeEach(() => B._reset());

test('a run: progress, then the task\'s checked output and what it took; no address, model or key in anything a page gets', async () => {
  const e = env(), p = open(e);
  p.say(run());
  await flush();
  assert.deepEqual(p.posted, [
    { id: 1, type: 'progress', part: 0 },
    { id: 1, type: 'progress', part: 1, parts: 1 },
    { id: 1, type: 'result', output: { text: 'hello' }, meta: { task: 'example.echo', version: 1, provider: 'openai', finish: 'stop', usage: { input: 5, output: 2 }, steps: 1, parts: 1 } },
  ]);
  const page = JSON.stringify(p.posted);
  for (const secret of [KEY, 'api.example.com', 'gpt-x']) assert.ok(!page.includes(secret), secret);
  assert.equal(e.calls.length, 1);
  assert.equal(e.calls[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(e.log.length, 1);
  assert.deepEqual(Object.keys(e.log[0]).sort(), ['at', 'feature', 'ok', 'provider', 'size', 'task']);
});

test('nothing is sent until every check passes, and each refusal has its code', async () => {
  const cases = [
    ['off', { enabled: async () => false }],
    ['off', { settings: async () => ({ on: false, use: 'openai', features: { syllabus: true } }) }],
    ['feature', { settings: async () => ({ on: true, use: 'openai', features: { syllabus: false } }) }],
    ['setup', { settings: async () => ({ on: true, use: null, features: { syllabus: true } }) }],
    ['setup', { settings: async () => ({ on: true, use: 'mock', features: { syllabus: true } }) }],
    ['task', { task: async () => null }],
    ['setup', { vault: { get: async () => ({}) } }],
    ['setup', { vault: { get: async () => ({ openai: { ...CFG, base: 'http://lan.example.com/v1' } }) } }],
    ['permission', { reach: async () => false }],
  ];
  for (const [code, over] of cases) {
    const e = env(over), p = open(e);
    p.say(run());
    await flush();
    assert.deepEqual(p.posted, [{ id: 1, type: 'error', error: code }], JSON.stringify(Object.keys(over)));
    assert.equal(e.calls.length, 0);
  }
  const e = env(), p = open(e);
  p.say(run({ text: 'x'.repeat(B.LIMIT.message) }));
  p.say(run({ text: 5 }, { id: 2 }));
  p.say(run(undefined, { id: 3, feature: 'Bad Feature' }));
  p.say(run(undefined, { id: 4, extra: true }));
  p.say({ id: 5, op: 'delete' });
  p.say('run');
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'error').sort((x, y) => (x.id ?? 99) - (y.id ?? 99)), [{ id: 1, type: 'error', error: 'size' }, { id: 2, type: 'error', error: 'input' }, { id: 3, type: 'error', error: 'request' }, { id: 4, type: 'error', error: 'request' }, { id: 5, type: 'error', error: 'request' }, { id: null, type: 'error', error: 'request' }]);
  assert.equal(e.calls.length, 0);
});

test('a sender the worker refused gets nothing: its port is closed and no message is read', async () => {
  const e = env({ allowed: Promise.resolve(false) }), p = open(e);
  p.say(run());
  await flush();
  assert.equal(p.hungUp, true);
  assert.deepEqual(p.posted, []);
  assert.equal(e.calls.length, 0);
});

test('one run at a time for a tab\'s feature, and only so many a minute', async () => {
  const waiting = [];
  const slow = env({ fetch: (url, init) => new Promise((res) => { waiting.push(() => res(answer({ text: 'a' }))); }) });
  const p = open(slow);
  p.say(run());
  await flush();
  p.say(run(undefined, { id: 2 }));
  open({ ...slow, who: '8' }).say(run(undefined, { id: 3 }));
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'error'), [{ id: 2, type: 'error', error: 'busy' }]);
  assert.equal(waiting.length, 2, 'the other tab\'s run went ahead');
  for (const go of waiting) go();
  await flush();
  assert.equal(p.posted.at(-1).type, 'result');
  B._reset();
  let t = 0;
  const e = env({ now: () => t }), q = open(e);
  for (let i = 1; i <= B.LIMIT.perMinute + 1; i++) { q.say(run(undefined, { id: i })); await flush(); }
  assert.deepEqual(q.posted.filter((m) => m.type === 'error'), [{ id: B.LIMIT.perMinute + 1, type: 'error', error: 'often' }]);
  t = 61000;
  q.say(run(undefined, { id: 99 }));
  await flush();
  assert.equal(q.posted.at(-1).type, 'result', 'a minute later');
});

test('cancel and a closed port abort the request to the server; nothing is posted after a close', async () => {
  const signals = [];
  const hang = env({ fetch: (url, init) => { signals.push(init.signal); return new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))); } });
  const p = open(hang);
  p.say(run());
  await flush();
  p.say({ id: 1, op: 'cancel' });
  await flush();
  assert.equal(signals[0].aborted, true);
  assert.deepEqual(p.posted.at(-1), { id: 1, type: 'error', error: 'cancelled' });
  const q = open(hang);
  q.say(run(undefined, { id: 2 }));
  await flush();
  const before = q.posted.length;
  q.close();
  await flush();
  assert.equal(signals[1].aborted, true);
  assert.equal(q.posted.length, before);
  // The tab's feature is free again.
  const r = open(env());
  r.say(run(undefined, { id: 3 }));
  await flush();
  assert.equal(r.posted.at(-1).type, 'result');
});

test('a task that streams sends the model\'s words as deltas', async () => {
  const sse = (parts) => new Response(parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  const p = open(env({ fetch: async () => sse(['{"text":', '"hi"}']) }));
  p.say(run(undefined, { task: 'example.story' }));
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'delta').map((m) => m.text), ['{"text":', '"hi"}']);
  assert.deepEqual(p.posted.at(-1).output, { text: 'hi' });
});

test('status says whether a feature may ask and could start, with the provider\'s caps, and nothing about the connection', async () => {
  const ask = async (e) => { const p = open(e); p.say({ id: 4, op: 'status', feature: 'syllabus' }); await flush(); return p.posted[0]; };
  assert.deepEqual(await ask(env()), { id: 4, type: 'status', on: true, allowed: true, ready: true, provider: 'openai', caps: { text: true, images: false, json: true, tools: true, stream: true } });
  assert.deepEqual(await ask(env({ reach: async () => false })), { id: 4, type: 'status', on: true, allowed: true, ready: false, why: 'permission', provider: 'openai', caps: { text: true, images: false, json: true, tools: true, stream: true } });
  assert.deepEqual(await ask(env({ vault: { get: async () => undefined } })), { id: 4, type: 'status', on: true, allowed: true, ready: false, why: 'setup' });
  assert.deepEqual(await ask(env({ settings: async () => ({ on: true, use: 'openai', features: {} }) })), { id: 4, type: 'status', on: true, allowed: false });
  assert.deepEqual(await ask(env({ enabled: async () => false })), { id: 4, type: 'status', on: false, allowed: false });
});

test('Settings keeps connections: the key is never read back, kept only for the same host, and Test checks the host first', async () => {
  const e = env();
  e.vaultData.clear();
  assert.deepEqual(await B.config({ op: 'set', provider: 'openai', cfg: { base: 'https://api.example.com', model: 'gpt-x', key: KEY } }, e), { ok: true, origin: 'https://api.example.com/*' });
  assert.deepEqual(e.vaultData.get('connections'), { openai: { base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY, images: false } });
  const got = await B.config({ op: 'get' }, e);
  assert.deepEqual(got, { ok: true, connections: { openai: { base: 'https://api.example.com/v1', model: 'gpt-x', images: false, key: true, origin: 'https://api.example.com/*' } } });
  assert.ok(!JSON.stringify(got).includes(KEY));
  // A new model on the same server keeps the key; a new server does not get it.
  await B.config({ op: 'set', provider: 'openai', cfg: { base: 'https://api.example.com/v1', model: 'gpt-y' } }, e);
  assert.equal(e.vaultData.get('connections').openai.key, KEY);
  await B.config({ op: 'set', provider: 'openai', cfg: { base: 'https://elsewhere.example.net/v1', model: 'gpt-y' } }, e);
  assert.equal(e.vaultData.get('connections').openai.key, undefined);
  assert.deepEqual(await B.config({ op: 'set', provider: 'openai', cfg: { base: 'http://192.168.0.2/v1', model: 'x' } }, e), { ok: false, error: 'setup' });
  assert.deepEqual(await B.config({ op: 'set', provider: 'mock', cfg: { replies: [] } }, e), { ok: false, error: 'setup' });
  assert.deepEqual(await B.config({ op: 'test', provider: 'openai' }, e), { ok: true, state: 'unavailable', reason: 'permission' });
  await B.config({ op: 'set', provider: 'openai', cfg: CFG }, e);
  const list = new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { headers: { 'content-type': 'application/json' } });
  const t = env({ vault: e.vault, fetch: async (url, init) => { assert.equal(url, 'https://api.example.com/v1/models'); assert.equal(init.headers.authorization, `Bearer ${KEY}`); return list; } });
  assert.deepEqual(await B.config({ op: 'test', provider: 'openai' }, t), { ok: true, state: 'ready' });
  assert.deepEqual(await B.config({ op: 'remove', provider: 'openai' }, e), { ok: true });
  assert.deepEqual(e.vaultData.get('connections'), {});
});

test('the vault is an IndexedDB store of the worker\'s own, read back as written', async () => {
  const { fakeIDB } = require('./helpers/fake-idb.cjs');
  const idb = fakeIDB().indexedDB;
  const v = B.vault(idb);
  assert.equal(await v.get('connections'), undefined);
  assert.equal(await v.set('connections', { openai: CFG }), true);
  assert.deepEqual(await B.vault(idb).get('connections'), { openai: CFG }, 'another worker start reads it');
  assert.equal(await v.remove('connections'), true);
  assert.equal(await v.get('connections'), undefined);
});
