// The AI harness's `apple` provider (lib/ai/providers/apple.js): Apple's Foundation Models through Safari's native handler
// (safari/Glaze/Glaze Extension/GlazeAI.swift), here against a stand-in browser.runtime.sendNativeMessage. Only on Safari;
// one message, one reply (no streaming); the status words; the run's message; failures as categories; a cancel reaching
// the native side; and a connection kept by the broker with no host to hold.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

let native = async () => { throw new Error('no native handler'); };
const sent = [];
globalThis.chrome = { runtime: { getURL: (p = '') => `safari-web-extension://ABC/${p}` } };
globalThis.browser = { runtime: { sendNativeMessage: async (app, m) => { sent.push({ app, m: structuredClone(m) }); return native(m); } } };
const P = require('../lib/ai/providers.js');
const A = require('../lib/ai/providers/apple.js');
const B = require('../lib/ai/broker.js');
const T = require('../lib/ai/task.js');
const S = require('../lib/ai/schema.js');
test.beforeEach(() => { sent.length = 0; native = async () => { throw new Error('no native handler'); }; B._reset(); });

const SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const ask = (over = {}) => ({ messages: [{ role: 'system', content: 'Answer.' }, { role: 'user', content: 'Q' }], ...over });
const ok = (text, extra = {}) => ({ ok: true, text, model: 'AFM 3 Core Advanced', usage: { input: 12, cached: 0, output: 4 }, ...extra });

test('only on Safari: elsewhere the file adds no provider', () => {
  assert.equal(P.get('apple'), A, 'added on Safari');
  const out = execFileSync(process.execPath, ['-e', `
    globalThis.chrome = { runtime: { getURL: () => 'chrome-extension://abc/' } };
    const P = require('./lib/ai/providers.js'); require('./lib/ai/providers/apple.js');
    process.stdout.write(String(P.get('apple')));`], { cwd: path.join(__dirname, '..') }).toString();
  assert.equal(out, 'null');
});

test('config takes only the model on this device; caps say JSON and pictures, no tools, no streaming', () => {
  assert.deepEqual(A.config({ model: 'on-device', base: 'x', key: 'k' }), { model: 'on-device' });
  for (const bad of [null, {}, { model: 'gpt' }, { model: 1 }, { model: 'private-cloud' }]) assert.equal(A.config(bad), null);
  assert.deepEqual(P.caps(A, A.config({ model: 'on-device' })), { text: true, images: true, json: true, tools: false, stream: false, local: true, context: 8192 });
  assert.equal(A.origin, undefined, 'nothing goes over the network from the worker: no host to hold');
});

test('status: the native answer in the harness\'s words; no handler or a strange answer is unavailable', async () => {
  const cfg = A.config({ model: 'on-device' });
  native = async () => ({ ok: true, state: 'ready', context: 8192, images: true });
  assert.deepEqual(await A.status(cfg), { state: 'ready' });
  assert.deepEqual(sent.map((s) => s.m), [{ type: 'ai.status', model: 'on-device' }]);
  native = async () => ({ ok: true, state: 'downloading', reason: 'not-ready' });
  assert.deepEqual(await A.status(cfg), { state: 'downloading', reason: 'not-ready' });
  native = async () => ({ ok: true, state: 'unavailable', reason: 'off' });
  assert.deepEqual(await A.status(cfg), { state: 'unavailable', reason: 'off' });
  native = async () => ({ ok: true, state: 'unavailable', reason: 'quota', unverified: true });
  assert.deepEqual(await A.status(cfg), { state: 'unavailable', reason: 'native' }, 'a reason only the cloud model had is unknown now');
  native = async () => { throw new Error('Native messaging host not found'); };
  assert.deepEqual(await A.status(cfg), { state: 'unavailable', reason: 'native' });
  for (const odd of [null, 'ready', { ok: true, state: 'great' }, { ok: false }]) {
    native = async () => odd;
    assert.deepEqual(await A.status(cfg), { state: 'unavailable', reason: 'native' }, JSON.stringify(odd));
  }
});

test('a run is one message with the cleaned request and the schema; the JSON answer is read and checked', async () => {
  native = async () => ok('{"answer":"42"}');
  const deltas = [];
  const out = await P.run('apple', ask({ schema: SCHEMA, temperature: 0, maxTokens: 300 }), { model: 'on-device' }, { onDelta: (d) => deltas.push(d) });
  assert.deepEqual(out, { text: '{"answer":"42"}', json: { answer: '42' }, provider: 'apple', model: 'AFM 3 Core Advanced', finish: 'stop', usage: { input: 12, cached: 0, output: 4 } });
  assert.deepEqual(deltas, [], 'nothing streams');
  assert.equal(sent.length, 1);
  const { app, m } = sent[0];
  assert.equal(app, 'io.frostdev.Glaze');
  assert.match(m.id, /^[\w-]{8,64}$/);
  assert.deepEqual({ ...m, id: 'x' }, { type: 'ai.run', id: 'x', model: 'on-device', schema: SCHEMA, temperature: 0, maxTokens: 300,
    messages: [{ role: 'system', content: [{ type: 'text', text: 'Answer.' }] }, { role: 'user', content: [{ type: 'text', text: 'Q' }] }] });
});

test('an answer the native side cut at maxTokens is a refusal, never read, even when its JSON closes', async () => {
  // Guided generation closes the JSON when it reaches maximumResponseTokens (measured: 40 tokens of 30 asked-for rows came
  // back as valid JSON with 3), so the native side says finish: 'length'.
  native = async () => ok('{"answer":"4"}', { finish: 'length', usage: { input: 9, output: 300 } });
  await assert.rejects(P.run('apple', ask({ schema: SCHEMA, maxTokens: 300 }), { model: 'on-device' }), { code: 'refusal' });
  native = async () => ok('Four', { finish: 'length' });
  assert.equal((await P.run('apple', ask({ maxTokens: 300 }), { model: 'on-device' })).finish, 'length', 'plain text keeps what came, marked');
});

test('pictures go as base64 parts; a request with tools is refused before anything is sent', async () => {
  native = async () => ok('It says hi.');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  await P.run('apple', { messages: [{ role: 'user', content: [{ type: 'text', text: 'Read it.' }, { type: 'image', mime: 'image/png', data: png }] }] }, { model: 'on-device' });
  assert.deepEqual(sent[0].m.messages[0].content[1], { type: 'image', mime: 'image/png', data: png });
  sent.length = 0;
  await assert.rejects(P.run('apple', ask({ tools: [{ name: 'today', description: 'Date.', parameters: { type: 'object', properties: {} } }] }), { model: 'on-device' }), { code: 'caps' });
  assert.equal(sent.length, 0);
});

test('failures: a refusal is the harness\'s refusal; the rest are categories with a reference, never the native words', async () => {
  const cfg = { model: 'on-device' };
  native = async () => ({ ok: false, error: 'refusal', reason: 'guardrail' });
  await assert.rejects(P.run('apple', ask(), cfg), { code: 'refusal' });
  const cases = [
    [{ ok: false, error: 'provider-unavailable', reason: 'ModelManagerServices.ModelManagerError 1046' }, 'provider-unavailable'],
    [{ ok: false, error: 'request-rejected', reason: 'context', context: 8192, tokens: 9100 }, 'request-rejected'],
    [{ ok: false, error: 'timeout' }, 'timeout'],
    [{ ok: false, error: 'connection-lost', reason: 'network' }, 'connection-lost'],
    [{ ok: false, error: 'something new' }, 'invalid-response'],
    [{ ok: true }, 'invalid-response'],
    ['text', 'invalid-response'],
    [undefined, 'invalid-response'],
  ];
  for (const [reply, category] of cases) {
    native = async () => reply;
    const e = await P.run('apple', ask(), cfg).catch((x) => x);
    assert.equal(e.category, category, JSON.stringify(reply));
    assert.match(e.reference, /^[\w-]{36}$/);
    assert.ok(!e.message.includes('ModelManager'), 'the native reason stays out of the message');
  }
  native = async () => ({ ok: false, error: 'request-rejected', reason: 'rate', status: 429 });
  assert.equal((await P.run('apple', ask(), cfg).catch((x) => x)).status, 429);
  native = async () => { throw new Error('Native messaging host io.frostdev.Glaze is not available'); };
  assert.equal((await P.run('apple', ask(), cfg).catch((x) => x)).category, 'provider-unavailable', 'no handler: unavailable, not a lost connection');
  native = async () => ok('not json');
  assert.equal((await P.run('apple', ask({ schema: SCHEMA }), cfg).catch((x) => x)).category, 'invalid-response', 'the harness checks the answer');
});

test('a cancel ends the run at once and asks the native side to stop the same run', async () => {
  let release;
  native = (m) => (m.type === 'ai.cancel' ? Promise.resolve({ ok: true, cancelled: true }) : new Promise((r) => { release = r; }));
  const c = new AbortController();
  const running = P.run('apple', ask(), { model: 'on-device' }, { signal: c.signal });
  await new Promise(setImmediate);
  c.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(running, { category: 'cancelled' });
  await new Promise(setImmediate);
  assert.deepEqual(sent.map((s) => s.m.type), ['ai.run', 'ai.cancel']);
  assert.equal(sent[1].m.id, sent[0].m.id);
  release(ok('late'));
});

test('the broker keeps an apple connection, tests it and runs a task on it, with no host permission involved', async () => {
  const vault = new Map();
  const env = {
    who: '3', allowed: Promise.resolve(true), enabled: async () => true,
    settings: async () => ({ on: true, use: 'mac', features: { syllabus: true } }),
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async () => { throw new Error('an apple connection never asks for a host'); },
    fetch: async () => { throw new Error('nothing is fetched'); },
    task: async () => echo,
  };
  const echo = T.define({ id: 'example.echo', version: 1, input: (raw) => raw, build: (input, { text }) => text.request({ system: 'Repeat.', data: [{ label: 'text', text: input.text }] }),
    output: S.obj({ text: S.str('The text.') }, ['text']), check: (o) => o });
  assert.deepEqual(await B.config({ op: 'set', id: 'mac', cfg: { provider: 'apple', model: 'on-device' } }, env), { ok: true });
  assert.deepEqual((await B.config({ op: 'get' }, env)).connections, { mac: { provider: 'apple', model: 'on-device', key: '' } });
  native = async (m) => (m.type === 'ai.status' ? { ok: true, state: 'ready', context: 8192 } : ok('{"text":"hello"}'));
  assert.deepEqual(await B.config({ op: 'test', id: 'mac' }, env), { ok: true, state: 'ready' });
  const posted = [];
  const on = [];
  B.connect({ postMessage: (m) => posted.push(m), disconnect() {}, onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} } }, env);
  on.forEach((f) => f({ id: 1, op: 'status', feature: 'syllabus' }));
  on.forEach((f) => f({ id: 2, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hello' } }));
  for (let i = 0; i < 40; i++) await new Promise(setImmediate);
  assert.deepEqual(posted.find((m) => m.id === 1), { id: 1, type: 'status', on: true, allowed: true, ready: true, provider: 'apple', caps: { text: true, images: true, json: true, tools: false, stream: false, local: true, context: 8192 } });
  const end = posted.find((m) => m.id === 2 && m.type === 'end');
  assert.deepEqual(end.output, { text: 'hello' });
  assert.equal(end.meta.provider, 'apple');
});

test('Settings offers Apple only on Safari, including when only the browser namespace exists', () => {
  for (const [scheme, namespace, want] of [['chrome-extension:', 'chrome', false], ['moz-extension:', 'browser', false], ['safari-web-extension:', 'chrome', true], ['safari-web-extension:', 'browser', true]]) {
    const out = execFileSync(process.execPath, ['-e', `
      globalThis.${namespace} = { runtime: { getURL: () => '${scheme}//abc/' } };
      const P = require('./lib/ai/providers.js'); require('./lib/ai/providers/apple.js');
      const A = require('./lib/ai/settings.js');
      process.stdout.write(JSON.stringify([!!P.get('apple'), A.PROVIDERS.includes('apple')]));`], { cwd: path.join(__dirname, '..') }).toString();
    assert.deepEqual(JSON.parse(out), [want, want], `${namespace} ${scheme}`);
  }
});

test('native diagnostics never leave the Apple adapter, including status and nested causes', async () => {
  const secret = 'PRIVATE SYLLABUS TEXT';
  native = async () => ({ ok: true, state: 'unavailable', reason: secret });
  assert.deepEqual(await A.status({ model: 'on-device' }), { state: 'unavailable', reason: 'native' });
  native = async () => ({ ok: false, error: 'provider-unavailable', reason: secret });
  const direct = await A.run(ask(), { model: 'on-device' }).catch((e) => e);
  assert.ok(!require('node:util').inspect(direct, { depth: 10 }).includes(secret));
  native = async () => { throw new Error(secret); };
  const thrown = await A.run(ask(), { model: 'on-device' }).catch((e) => e);
  assert.ok(!require('node:util').inspect(thrown, { depth: 10 }).includes(secret));
});

test('a native cancellation stays cancelled without a worker abort', async () => {
  native = async () => ({ ok: false, error: 'cancelled' });
  await assert.rejects(P.run('apple', ask(), { model: 'on-device' }), { category: 'cancelled' });
});

test('an already cancelled adapter call sends no text and timeout cancels a pending native run', async () => {
  const stopped = new AbortController(); stopped.abort(new DOMException('Cancelled', 'AbortError'));
  native = async () => ok('late');
  await assert.rejects(A.run(ask(), { model: 'on-device' }, { signal: stopped.signal }));
  assert.equal(sent.length, 0);
  native = async (m) => m.type === 'ai.cancel' ? { ok: true, cancelled: false } : new Promise(() => {});
  await assert.rejects(P.run('apple', ask({ timeoutMs: require('../lib/ai/request.js').LIMIT.timeout[0] }), { model: 'on-device' }), { category: 'timeout' });
  assert.deepEqual(sent.map((s) => s.m.type), ['ai.run', 'ai.cancel']);
  assert.equal(sent[0].m.id, sent[1].m.id);
});

test('the catalog offers only the model on this device, and nothing names Private Cloud Compute', async () => {
  const list = await A.catalog();
  assert.deepEqual(list.models.map((m) => m.id), ['on-device']);
  assert.match(list.models[0].name, /on this device/i);
  const fs = require('node:fs');
  for (const f of ['lib/ai/providers/apple.js', 'safari/Glaze/Glaze Extension/GlazeAI.swift', 'docs/ai-harness.md'])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), /private.?cloud|PrivateCloudCompute|\bPCC\b/i, f);
});

test('feature status checks Apple readiness even though it has no model download operation', async () => {
  const env = { enabled: async () => true, settings: async () => ({ on: true, use: 'mac', features: { syllabus: true } }),
    vault: { get: async () => ({ mac: { provider: 'apple', model: 'on-device' } }) } };
  native = async () => ({ ok: true, state: 'downloading', reason: 'not-ready' });
  assert.equal((await B.status({ feature: 'syllabus' }, env)).ready, false);
  assert.equal(sent.length, 1);
});

test('Apple status stops waiting when its caller cancels', async () => {
  native = async () => new Promise(() => {});
  const c = new AbortController();
  const result = A.status({ model: 'on-device' }, { signal: c.signal });
  c.abort();
  const out = await Promise.race([result, new Promise((resolve) => setTimeout(() => resolve('hung'), 50))]);
  assert.notEqual(out, 'hung');
  assert.equal(out.state, 'unavailable');
});

test('a text task on Apple sends no schema and gives the words back, cut ones marked truncated', async () => {
  const finish = T.define({ id: 'example.finish', version: 1, output: 'text', input: (raw) => raw, check: (text) => text,
    build: (input, { text }) => text.request({ system: 'Finish it.', data: [{ label: 'before', text: input.text }], maxTokens: 20 }) });
  native = async () => ok(' runs to the', { finish: 'length' });
  const out = await T.run(finish, { text: 'The river' }, { provider: 'apple', cfg: { model: 'on-device' } });
  assert.equal(out.output, ' runs to the');
  assert.equal(out.meta.truncated, true);
  assert.equal('schema' in sent[0].m, false);
  assert.equal(sent[0].m.maxTokens, 20);
});

test('a changed connection asks the native side to drop its warm sessions', async () => {
  const vault = new Map();
  const env = { vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async () => true } };
  native = async () => ({ ok: true });
  assert.deepEqual(await B.config({ op: 'set', id: 'mac', cfg: { provider: 'apple', model: 'on-device' } }, env), { ok: true });
  await new Promise(setImmediate);
  assert.deepEqual(sent.map((s) => s.m), [{ type: 'ai.release' }]);
  assert.deepEqual(await B.config({ op: 'remove', id: 'mac' }, env), { ok: true });
  await new Promise(setImmediate);
  assert.equal(sent.length, 2);
});

// "On this device" (connection id 'device') is one choice: Apple Intelligence where Safari offers it and this Mac can run
// it, else the browser's own model. A stand-in for that model (lib/ai/providers/device.js isn't loaded here).
let browserModel = { state: 'unavailable', reason: 'browser' };
P.add({ id: 'device', config: () => ({}), caps: () => ({ text: true, json: true, stream: true, local: true }), status: async () => browserModel,
  run: async () => ({ text: 'from the browser', model: 'gemini-nano', finish: 'stop' }) });
const here = (stored = {}) => ({ enabled: async () => true, settings: async () => ({ on: true, use: 'device', features: { syllabus: true } }),
  vault: { get: async () => structuredClone(stored), set: async () => true } });

test('On this device runs on Apple Intelligence when this Mac has it, with no connection of its own to choose', async () => {
  browserModel = { state: 'unavailable', reason: 'browser' };
  native = async () => ({ ok: true, state: 'ready' });
  const st = await B.status({ feature: 'syllabus' }, here());
  assert.equal(st.provider, 'apple');
  assert.equal(st.ready, true);
  assert.equal(st.caps.local, true);
  native = async () => ({ ok: true, state: 'downloading', reason: 'not-ready' });
  const dl = await B.status({ feature: 'syllabus' }, here({ device: { provider: 'device' } }));
  assert.deepEqual([dl.provider, dl.ready, dl.why], ['apple', false, 'downloading'], 'still Apple while its model downloads');
  assert.deepEqual(await B.config({ op: 'test', id: 'device' }, here()), { ok: true, state: 'downloading', reason: 'not-ready', provider: 'apple' });
});

test('On this device says Apple Intelligence is off when neither model can run, and uses the browser\'s model when only it can', async () => {
  native = async () => ({ ok: true, state: 'unavailable', reason: 'off' });
  browserModel = { state: 'unavailable', reason: 'browser' };
  const off = await B.status({ feature: 'syllabus' }, here());
  assert.deepEqual([off.provider, off.ready, off.why, off.reason], ['apple', false, 'unavailable', 'off'], 'the reason the student can fix');
  browserModel = { state: 'ready' };
  for (const reason of ['off', 'os', 'device']) {
    native = async () => ({ ok: true, state: 'unavailable', reason });
    const st = await B.status({ feature: 'syllabus' }, here());
    assert.deepEqual([st.provider, st.ready], ['device', true], reason);
  }
  native = async () => ({ ok: true, state: 'ready' });
  assert.equal((await B.status({ feature: 'syllabus' }, here())).provider, 'apple', 'Apple first whenever it can run');
});

test('On this device is the browser\'s model outside Safari, and Apple is never asked', () => {
  const out = execFileSync(process.execPath, ['-e', `
    globalThis.chrome = { runtime: { getURL: () => 'chrome-extension://abc/' } };
    const P = require('./lib/ai/providers.js'); require('./lib/ai/providers/apple.js');
    P.add({ id: 'device', config: () => ({}), caps: () => ({ text: true, local: true }), status: async () => ({ state: 'ready' }), run: async () => ({ text: '', finish: 'stop' }) });
    const B = require('./lib/ai/broker.js');
    const env = { enabled: async () => true, settings: async () => ({ on: true, use: 'device', features: { syllabus: true } }), vault: { get: async () => ({}) } };
    B.status({ feature: 'syllabus' }, env).then((st) => process.stdout.write(JSON.stringify([st.provider, st.ready])));`], { cwd: path.join(__dirname, '..') }).toString();
  assert.deepEqual(JSON.parse(out), ['device', true]);
});
