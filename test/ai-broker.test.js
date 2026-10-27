// The AI harness's broker (lib/ai/broker.js) on a stand-in port, storage and server: every check before anything is sent, the
// model checked against the connection's catalog, the run's events and its end, one run at a time for a tab's feature, a
// rate limit, cancel and a closed port ending the request, a connection changed mid-run sending nothing more, confirms
// claimed once, and no address, model or key ever going to a page; then the writer's modes: plain text streamed, supersede,
// messages in order, a task's own rate, tallied rows, the kept catalog, and per-message refusals. The worker's own wiring
// is test/ai-worker.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/ai/broker.js');
const T = require('../lib/ai/task.js');
const TL = require('../lib/ai/tools.js');
const S = require('../lib/ai/schema.js');
const M = require('../lib/ai/models.js');
require('../lib/ai/providers/openai.js');

const KEY = 'sk-live-ABCDEF0123456789';
const CONN = { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY, generation: 'gen-1' };
const echo = T.define({ id: 'example.echo', version: 1, input: (raw) => (typeof raw?.text === 'string' && raw.text.length < 1000 ? raw : null),
  build: (input, { text }) => text.request({ system: 'Repeat the text as {"text": ...}.', data: [{ label: 'text', text: input.text }] }),
  output: S.obj({ text: S.str('The text.') }, ['text']), check: (o) => o });
const story = T.define({ ...echo, id: 'example.story', stream: true });
const remind = TL.define({ name: 'reminder_add', kind: 'confirm', description: 'Add a reminder.', parameters: S.obj({ at: S.str('When.') }, ['at']),
  run: async ({ at }) => ({ kind: 'reminder', at }), summarize: ({ at }) => `Add a reminder at ${at}?` });
const kit = TL.registry();
kit.add(remind);
const planner = T.define({ ...echo, id: 'example.plan', tools: ['reminder_add'] });
const TASKS = { 'example.echo': echo, 'example.story': story, 'example.plan': planner };
const flush = async () => { for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
const port = () => {
  const on = { message: [], disconnect: [] };
  return { posted: [], hungUp: false, postMessage(m) { this.posted.push(JSON.parse(JSON.stringify(m))); }, disconnect() { this.hungUp = true; },
    onMessage: { addListener: (f) => on.message.push(f) }, onDisconnect: { addListener: (f) => on.disconnect.push(f) },
    say(m) { for (const f of on.message) f(m); }, close() { for (const f of on.disconnect) f(); } };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (body) => json({ model: 'gpt-x', choices: [{ message: { content: JSON.stringify(body) }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
const models = (ids = ['gpt-x']) => json({ data: ids.map((id) => ({ id })) });
const area = () => { const data = {}; return { data, get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (v) => { Object.assign(data, structuredClone(v)); return true; } }; };
// The text the model was given, echoed back as the answer; /models lists gpt-x.
const echoFetch = (calls) => async (url, init) => {
  calls.push({ url, init });
  if (url.endsWith('/models')) return models();
  return answer({ text: JSON.parse(init.body).messages[1].content.match(/<<<DATA-\w+\n([\s\S]*)\n>>>/)[1] });
};
const env = (over = {}) => {
  const vault = new Map([['connections', { main: CONN }]]);
  const calls = [];
  return {
    calls, vaultData: vault, who: '7', allowed: Promise.resolve(true), local: area(),
    settings: async () => ({ on: true, use: 'main', features: { syllabus: true } }),
    enabled: async () => true,
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async (url) => url === 'https://api.example.com/',
    fetch: echoFetch(calls), task: async (id) => TASKS[id] || null, tools: kit,
    ...over,
  };
};
const open = (e) => { const p = port(); B.connect(p, e); return p; };
const run = (input = { text: 'hello' }, extra = {}) => ({ id: 1, op: 'run', feature: 'syllabus', task: 'example.echo', input, ...extra });
const types = (p) => p.posted.map((m) => m.type);
test.beforeEach(() => { B._reset(); M._reset(); });

test('a run: its events, then the end with the checked output; no address, model or key in anything a page gets; one metadata row kept', async () => {
  const e = env(), p = open(e);
  p.say(run());
  await flush();
  assert.deepEqual(types(p), ['thinking', 'usage', 'reply', 'end']);
  assert.ok(p.posted.every((m) => m.id === 1), 'every event carries the run\'s id');
  const end = p.posted.at(-1);
  assert.deepEqual(end, { id: 1, type: 'end', output: { text: 'hello' }, meta: { task: 'example.echo', version: 1, provider: 'openai', finish: 'stop', usage: { input: 5, output: 2 }, rounds: 1, parts: 1 } });
  const page = JSON.stringify(p.posted);
  for (const secret of [KEY, 'api.example.com', 'gpt-x']) assert.ok(!page.includes(secret), secret);
  assert.deepEqual(e.calls.map((c) => c.url), ['https://api.example.com/v1/models', 'https://api.example.com/v1/chat/completions'], 'the catalog, then the request');
  const [row] = e.local.data.aiCalls;
  assert.deepEqual(Object.keys(row).sort(), ['feature', 'id', 'ms', 'parts', 'provider', 'startedAt', 'state', 'steps', 'task', 'usage']);
  assert.equal(row.state, 'completed');
  assert.ok(!JSON.stringify(e.local.data).includes(KEY) && !JSON.stringify(e.local.data).includes('hello'));
});

test('nothing is sent until every check passes, and each refusal has its code', async () => {
  const cases = [
    ['off', { enabled: async () => false }],
    ['off', { settings: async () => ({ on: false, use: 'main', features: { syllabus: true } }) }],
    ['feature', { settings: async () => ({ on: true, use: 'main', features: { syllabus: false } }) }],
    ['setup', { settings: async () => ({ on: true, use: null, features: { syllabus: true } }) }],
    ['setup', { settings: async () => ({ on: true, use: 'other', features: { syllabus: true } }) }],
    ['task', { task: async () => null }],
    ['setup', { vault: { get: async () => ({ main: { ...CONN, provider: 'mock' } }) } }],
    ['setup', { vault: { get: async () => ({ main: { ...CONN, base: 'http://lan.example.com/v1' } }) } }],
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
  p.say(run(undefined, { id: 3, feature: 'Bad Feature' }));
  p.say(run(undefined, { id: 4, extra: true }));
  p.say({ id: 5, op: 'delete' });
  p.say('run');
  await flush();
  assert.deepEqual(p.posted.sort((x, y) => (x.id ?? 99) - (y.id ?? 99)), [{ id: 1, type: 'error', error: 'size' }, { id: 3, type: 'error', error: 'request' }, { id: 4, type: 'error', error: 'request' }, { id: 5, type: 'error', error: 'request' }, { id: null, type: 'error', error: 'request' }]);
  assert.equal(e.calls.length, 0);
});

test('the model must be one the connection lists; with no list it runs unverified; a model failure has its category and reference', async () => {
  const unlisted = env({ fetch: async (url) => (url.endsWith('/models') ? models(['other']) : answer({ text: 'x' })) });
  const p = open(unlisted);
  p.say(run());
  await flush();
  assert.deepEqual(p.posted, [{ id: 1, type: 'error', error: 'setup' }]);
  M._reset();
  const calls = [];
  const noList = env({ fetch: async (url, init) => (url.endsWith('/models') ? json({}, 404) : echoFetch(calls)(url, init)) });
  const q = open(noList);
  q.say(run());
  await flush();
  assert.equal(q.posted.at(-1).meta.unverified, true);
  M._reset();
  const failing = env({ fetch: async (url) => (url.endsWith('/models') ? models() : new Response('overloaded', { status: 503 })) });
  const r = open(failing);
  r.say(run());
  await flush();
  const err = r.posted.at(-1);
  assert.deepEqual([err.type, err.error, err.status], ['error', 'provider-unavailable', 503]);
  assert.match(err.reference, /^[0-9a-f-]{36}$/);
  assert.equal(failing.local.data.aiCalls[0].id, err.reference, 'the row the student can quote');
  assert.equal(failing.local.data.aiCalls[0].category, 'provider-unavailable');
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
  const slow = env({ fetch: (url, init) => (url.endsWith('/models') ? Promise.resolve(models()) : new Promise((res) => { waiting.push(() => res(answer({ text: 'a' }))); })) });
  const p = open(slow);
  p.say(run());
  await flush();
  p.say(run(undefined, { id: 2 }));
  open({ ...slow, who: '8' }).say(run(undefined, { id: 3 }));
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'error'), [{ id: 2, type: 'error', error: 'busy' }]);
  assert.equal(waiting.length, 2, 'the other tab\'s run went ahead');
  for (const w of waiting) w();
  await flush();
  assert.equal(p.posted.at(-1).type, 'end');
  B._reset();
  let t = 0;
  const e = env({ now: () => t }), q = open(e);
  for (let i = 1; i <= B.LIMIT.perMinute + 1; i++) { q.say(run(undefined, { id: i })); await flush(); }
  assert.deepEqual(q.posted.filter((m) => m.type === 'error'), [{ id: B.LIMIT.perMinute + 1, type: 'error', error: 'often' }]);
  t = 61000;
  q.say(run(undefined, { id: 99 }));
  await flush();
  assert.equal(q.posted.at(-1).type, 'end', 'a minute later');
});

test('cancel and a closed port abort the request to the server; nothing is posted after a close', async () => {
  const signals = [];
  const hang = env({ fetch: (url, init) => (url.endsWith('/models') ? Promise.resolve(models()) : (signals.push(init.signal), new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason))))) });
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
  const r = open(env());
  r.say(run(undefined, { id: 3 }));
  await flush();
  assert.equal(r.posted.at(-1).type, 'end', 'the tab\'s feature is free again');
});

test('a connection changed while a run waits sends nothing more to it', async () => {
  let e;
  const calls = [];
  e = env({ fetch: async (url, init) => {
    calls.push(url);
    if (url.endsWith('/models')) { e.vaultData.set('connections', { main: { ...CONN, key: 'sk-new-key-0000', generation: 'gen-2' } }); return models(); }
    return answer({ text: 'x' });
  } });
  const p = open(e);
  p.say(run());
  await flush();
  assert.deepEqual(p.posted.at(-1), { id: 1, type: 'error', error: 'changed' });
  assert.deepEqual(calls, ['https://api.example.com/v1/models'], 'the request itself never went out');
});

test('a task that streams sends the model\'s words as text_delta events', async () => {
  const sse = (parts) => new Response(parts.map((x) => `data: ${JSON.stringify({ choices: [{ delta: { content: x } }] })}\n\n`).join('') + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  const p = open(env({ fetch: async (url) => (url.endsWith('/models') ? models() : sse(['{"text":', '"hi"}'])) }));
  p.say(run(undefined, { task: 'example.story' }));
  await flush();
  const deltas = p.posted.filter((m) => m.type === 'text_delta');
  assert.deepEqual(deltas.map((m) => [m.delta, m.offset]), [['{"text":', 0], ['"hi"}', 8]]);
  assert.deepEqual(p.posted.at(-1).output, { text: 'hi' });
});

test('a confirm tool ends the run pending; the student\'s answer is claimed once on that port, then the tool runs or doesn\'t', async () => {
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Quiz soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  const e = env({ fetch }), p = open(e);
  p.say(run(undefined, { task: 'example.plan' }));
  await flush();
  const end = p.posted.at(-1);
  assert.equal(end.type, 'end');
  assert.equal(end.output, undefined);
  assert.deepEqual([end.pending.tool, end.pending.summary], ['reminder_add', 'Add a reminder at 2026-11-02?']);
  assert.ok(p.posted.some((m) => m.type === 'pending'));
  const other = open(e);
  other.say({ id: 7, op: 'confirm', confirmId: end.pending.confirmId, approve: true });
  await flush();
  assert.equal(other.posted[0].type, 'error', 'another port cannot claim it');
  p.say({ id: 8, op: 'confirm', confirmId: end.pending.confirmId, approve: true });
  await flush();
  assert.deepEqual(p.posted.at(-1), { id: 8, type: 'confirmed', result: { kind: 'reminder', at: '2026-11-02' } });
  p.say({ id: 9, op: 'confirm', confirmId: end.pending.confirmId, approve: true });
  await flush();
  assert.deepEqual([p.posted.at(-1).type, p.posted.at(-1).error], ['error', 'request'], 'once only');
});

test('status says whether a feature may ask and could start, with the provider\'s caps and the host an endpoint sends to, and nothing else about the connection or anything fetched', async () => {
  const ask = async (e) => { const p = open(e); p.say({ id: 4, op: 'status', feature: 'syllabus' }); await flush(); return p.posted[0]; };
  const e = env();
  assert.deepEqual(await ask(e), { id: 4, type: 'status', on: true, allowed: true, ready: true, provider: 'openai', caps: { text: true, json: true, stream: true }, to: 'api.example.com' });
  assert.equal(e.calls.length, 0);
  assert.deepEqual(await ask(env({ reach: async () => false })), { id: 4, type: 'status', on: true, allowed: true, ready: false, why: 'permission', provider: 'openai', caps: { text: true, json: true, stream: true }, to: 'api.example.com' });
  assert.deepEqual(await ask(env({ vault: { get: async () => undefined } })), { id: 4, type: 'status', on: true, allowed: true, ready: false, why: 'setup' });
  assert.deepEqual(await ask(env({ settings: async () => ({ on: true, use: 'main', features: {} }) })), { id: 4, type: 'status', on: true, allowed: false });
  assert.deepEqual(await ask(env({ enabled: async () => false })), { id: 4, type: 'status', on: false, allowed: false });
});

test('Settings keeps connections by name: the key comes back masked, follows the same address only, and a new key is a new generation', async () => {
  const e = env();
  e.vaultData.clear();
  assert.deepEqual(await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } }, e), { ok: true, origin: 'https://api.example.com/*' });
  const stored = e.vaultData.get('connections').main;
  assert.deepEqual({ ...stored, generation: typeof stored.generation }, { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY, generation: 'string' });
  const got = await B.config({ op: 'get' }, e);
  assert.deepEqual(got, { ok: true, providers: ['openai'], connections: { main: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: 'sk-l••••6789', origin: 'https://api.example.com/*' } } });
  assert.ok(!JSON.stringify(got).includes(KEY));
  const g1 = stored.generation;
  await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://API.example.com/v1/', model: 'gpt-y' } }, e);
  assert.deepEqual([e.vaultData.get('connections').main.key, e.vaultData.get('connections').main.generation], [KEY, g1], 'a new model on the same address keeps the key and the generation');
  await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-y', key: 'sk-other-000000' } }, e);
  assert.notEqual(e.vaultData.get('connections').main.generation, g1, 'a new key is a new generation');
  await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://elsewhere.example.net/v1', model: 'gpt-y' } }, e);
  assert.equal(e.vaultData.get('connections').main.key, undefined, 'a key never follows a changed address');
  assert.match((await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: 'http://192.168.0.2/v1', model: 'x' } }, e)).note, /must use https/);
  assert.equal((await B.config({ op: 'set', id: 'Main Thing', cfg: { provider: 'openai', base: 'https://x.com/v1', model: 'x' } }, e)).error, 'setup');
  assert.equal((await B.config({ op: 'set', id: 'm', cfg: { provider: 'mock', replies: [] } }, e)).error, 'setup');
  await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: CONN.base, model: 'gpt-x', key: KEY } }, e);
  assert.deepEqual(await B.config({ op: 'test', id: 'main' }, env({ vault: e.vault, reach: async () => false })), { ok: true, state: 'unavailable', reason: 'permission' });
  const t = env({ vault: e.vault, fetch: async (url, init) => { assert.equal(url, 'https://api.example.com/v1/models'); assert.equal(init.headers.authorization, `Bearer ${KEY}`); return models(['gpt-x', 'gpt-y']); } });
  assert.deepEqual(await B.config({ op: 'test', id: 'main' }, t), { ok: true, state: 'ready', source: 'live' });
  M._reset();
  assert.deepEqual((await B.config({ op: 'models', id: 'main' }, t)).models.map((m) => m.id), ['gpt-x', 'gpt-y']);
  assert.deepEqual(await B.config({ op: 'remove', id: 'main' }, e), { ok: true });
  assert.deepEqual(e.vaultData.get('connections'), {});
});

test('the vault is an IndexedDB store of the worker\'s own, read back as written', async () => {
  const { fakeIDB } = require('./helpers/fake-idb.cjs');
  const idb = fakeIDB().indexedDB;
  const v = B.vault(idb);
  assert.equal(await v.get('connections'), undefined);
  assert.equal(await v.set('connections', { main: CONN }), true);
  assert.deepEqual(await B.vault(idb).get('connections'), { main: CONN }, 'another worker start reads it');
  assert.equal(await v.remove('connections'), true);
  assert.equal(await v.get('connections'), undefined);
});

test('Settings\' Test of a failing endpoint gives its category, HTTP status and a reference, never the server\'s words', async () => {
  const e = env({ reach: async () => true, fetch: async () => json({ error: { message: `bad key ${KEY}` } }, 401) });
  const r = await B.config({ op: 'test', id: 'main' }, e);
  assert.deepEqual({ ...r, reference: typeof r.reference }, { ok: true, state: 'unavailable', reason: 'request-rejected', status: 401, reference: 'string' });
  assert.match(r.reference, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(r).includes('bad key'));
});

test('a pending confirmation rechecks feature, connection and tool authority before running', async () => {
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  for (const change of ['feature', 'connection', 'generation', 'permission', 'tool', 'task']) {
    B._reset(); M._reset();
    const e = env({ fetch }), p = open(e);
    p.say(run(undefined, { task: 'example.plan' }));
    await flush();
    const id = p.posted.at(-1).pending.confirmId;
    if (change === 'feature') e.settings = async () => ({ on: true, use: 'main', features: { syllabus: false } });
    if (change === 'connection') e.settings = async () => ({ on: true, use: 'other', features: { syllabus: true } });
    if (change === 'generation') e.vaultData.set('connections', { main: { ...CONN, generation: 'replacement' } });
    if (change === 'permission') e.reach = async () => false;
    if (change === 'tool') e.tools = TL.registry();
    if (change === 'task') e.task = async () => null;
    p.say({ id: 2, op: 'confirm', confirmId: id, approve: true });
    await flush();
    assert.equal(p.posted.at(-1).type, 'error', change);
  }
});

test('cancelling a pending run invalidates its confirmation', async () => {
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  const p = open(env({ fetch }));
  p.say(run(undefined, { task: 'example.plan' }));
  await flush();
  const id = p.posted.at(-1).pending.confirmId;
  p.say({ id: 1, op: 'cancel' });
  p.say({ id: 2, op: 'confirm', confirmId: id, approve: true });
  await flush();
  assert.equal(p.posted.at(-1).type, 'error');
});

test('closing a port while confirmation admission waits prevents the tool from running', async () => {
  let ran = 0, release;
  const tool = TL.define({ ...remind, run: async () => { ran++; return { ok: true }; } });
  const tools = TL.registry(); tools.add(tool);
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  const e = env({ fetch, tools }), p = open(e);
  p.say(run(undefined, { task: 'example.plan' }));
  await flush();
  const id = p.posted.at(-1).pending.confirmId;
  e.enabled = () => new Promise((r) => { release = r; });
  p.say({ id: 2, op: 'confirm', confirmId: id, approve: true });
  await flush();
  p.close(); release(true);
  await flush();
  assert.equal(ran, 0);
});

test('a changed credential invalidates an inference already in flight', async () => {
  let finish;
  const e = env({ fetch: async (url) => url.endsWith('/models') ? models() : new Promise((r) => { finish = r; }) }), p = open(e);
  p.say(run());
  await flush();
  e.vaultData.set('connections', { main: { ...CONN, generation: 'replacement', key: 'new-key' } });
  finish(answer({ text: 'obsolete' }));
  await flush();
  assert.equal(p.posted.at(-1).error, 'changed');
  assert.ok(!JSON.stringify(p.posted).includes('obsolete'));
});

test('a hanging catalog cannot hold the configuration queue after its deadline', async () => {
  const before = B.LIMIT.catalog; B.LIMIT.catalog = 20;
  try {
    const e = env({ fetch: async () => new Promise(() => {}) });
    let timeout;
    const result = await Promise.race([
      B.config({ op: 'models', id: 'main' }, e),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ stuck: true }), 150); }),
    ]);
    clearTimeout(timeout);
    assert.equal(result.stuck, undefined);
    assert.equal(result.ok, false);
    assert.equal((await B.config({ op: 'get' }, e)).ok, true);
  } finally { B.LIMIT.catalog = before; }
});

test('feature revocation while a confirmation waits for its live sender check prevents execution', async () => {
  let ran = 0, release, checks = 0;
  const tools = TL.registry(); tools.add(TL.define({ ...remind, run: async () => { ran++; return { ok: true }; } }));
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  const e = env({ fetch, tools }), p = open(e);
  p.say(run(undefined, { task: 'example.plan' }));
  await flush();
  const id = p.posted.at(-1).pending.confirmId;
  e.allowed = () => ++checks === 2 ? new Promise((r) => { release = r; }) : true;
  p.say({ id: 2, op: 'confirm', confirmId: id, approve: true });
  await flush();
  e.settings = async () => ({ on: true, use: 'main', features: { syllabus: false } });
  release?.(true);
  await flush();
  assert.equal(ran, 0);
  assert.equal(p.posted.at(-1).error, 'feature');
});

test('an authority revision changed during the final connection read refuses confirmation', async () => {
  let ran = 0, revision = 0, release, reads = 0;
  const tools = TL.registry(); tools.add(TL.define({ ...remind, run: async () => { ran++; return { ok: true }; } }));
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  const e = env({ fetch, tools, revision: () => revision }), p = open(e);
  p.say(run(undefined, { task: 'example.plan' }));
  await flush();
  const id = p.posted.at(-1).pending.confirmId, get = e.vault.get;
  e.vault.get = (k) => k === 'connections' && ++reads === 2 ? new Promise((r) => { release = () => r(get(k)); }) : get(k);
  p.say({ id: 2, op: 'confirm', confirmId: id, approve: true });
  await flush();
  revision++;
  release?.();
  await flush();
  assert.equal(ran, 0);
  assert.equal(p.posted.at(-1).type, 'error');
});

test('cancelling while the vault is pending releases admission without a late request', async () => {
  let release;
  const e = env(), get = e.vault.get;
  e.vault.get = () => new Promise((r) => { release = () => r({ main: CONN }); });
  const p = open(e);
  p.say(run());
  await flush();
  p.say({ id: 1, op: 'cancel' });
  await flush();
  assert.equal(p.posted.at(-1)?.error, 'cancelled');
  e.vault.get = get;
  p.say(run(undefined, { id: 2 }));
  await flush();
  assert.equal(p.posted.at(-1).type, 'end');
  release();
  await flush();
  assert.equal(e.calls.filter((c) => c.url.endsWith('/chat/completions')).length, 1);
});

test('Settings lists only shipped providers registered in this browser', async () => {
  const settings = require('../lib/ai/settings.js'), providers = require('../lib/ai/providers.js');
  settings.PROVIDERS.push('apple'); // Safari's package can ship a provider that does not register elsewhere.
  try {
    assert.equal(providers.get('apple'), null);
    assert.deepEqual((await B.config({ op: 'get' }, env())).providers, ['openai']);
  } finally { settings.PROVIDERS.pop(); }
});

test('syllabus admission requires the disclosed destination before even fetching the catalog', async () => {
  const task = require('../lib/ai/tasks/syllabus-read.js').task;
  for (const to of [undefined, '', 'previous.example.test']) {
    const e = env({ task: async () => task }), p = open(e);
    p.say(run({ text: 'Instructor: Dr. Ada Example' }, { task: task.id, ...(to !== undefined && { to }) }));
    await flush();
    assert.equal(e.calls.length, 0, `undisclosed host: ${String(to)}`);
    assert.equal(p.posted.at(-1)?.error, 'changed');
    p.close();
  }
});

test('a connection changed after syllabus status cannot send to a host the dialog did not disclose', async () => {
  const task = require('../lib/ai/tasks/syllabus-read.js').task;
  const e = env({ task: async () => task, reach: async () => true }), p = open(e);
  p.say({ id: 10, op: 'status', feature: 'syllabus' });
  await flush();
  const shown = p.posted.at(-1).to;
  assert.equal(shown, 'api.example.com');
  e.vaultData.set('connections', { main: { ...CONN, base: 'https://changed.example.test/v1', generation: 'gen-2' } });
  p.say(run({ text: 'Instructor: Dr. Ada Example' }, { task: task.id, to: shown }));
  await flush();
  assert.equal(e.calls.length, 0);
  assert.equal(p.posted.at(-1)?.error, 'changed');
  p.close();
});

test('syllabus admission accepts the exact disclosed host and port without revealing a path or key', async () => {
  const task = require('../lib/ai/tasks/syllabus-read.js').task;
  const none = { text: null, quote: null };
  const output = { prof: { name: none, email: none, office: none, note: none }, hours: [], meetings: [], scale: [], weights: [], dates: [], week1: none };
  const calls = [];
  const e = env({ task: async () => task, reach: async () => true, fetch: async (url) => { calls.push(url); return url.endsWith('/models') ? models() : answer(output); } });
  e.vaultData.set('connections', { main: { ...CONN, base: 'https://api.example.com:8443/private/v1' } });
  const p = open(e);
  p.say({ id: 10, op: 'status', feature: 'syllabus' });
  await flush();
  const shown = p.posted.at(-1).to;
  assert.equal(shown, 'api.example.com:8443');
  assert.ok(!JSON.stringify(p.posted).includes('/private') && !JSON.stringify(p.posted).includes(KEY));
  p.say(run({ text: 'Instructor: Dr. Ada Example' }, { task: task.id, to: shown }));
  await flush();
  assert.equal(p.posted.at(-1)?.type, 'end');
  assert.equal(calls.length, 2);
  p.close();
});

test('a disclosed task retains its admitted destination when a pending tool is confirmed', async () => {
  const task = T.define({ ...planner, id: 'example.disclosed-plan', disclose: true });
  const fetch = async (url) => (url.endsWith('/models') ? models() : json({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'reminder_add', arguments: '{"at":"2026-11-02","reason":"Soon."}' } }] }, finish_reason: 'tool_calls' }] }));
  for (const changed of [false, true]) {
    B._reset(); M._reset();
    const e = env({ fetch, task: async () => task, reach: async () => true }), p = open(e);
    try {
      p.say(run(undefined, { task: task.id, to: 'api.example.com' }));
      await flush();
      const pending = p.posted.at(-1)?.pending;
      assert.ok(pending, 'the run was admitted and proposed a tool');
      if (changed) e.vaultData.set('connections', { main: { ...CONN, base: 'https://changed.example.test/v1', generation: 'gen-2' } });
      p.say({ id: 2, op: 'confirm', confirmId: pending.confirmId, approve: true, to: 'changed.example.test' });
      await flush();
      assert.deepEqual(p.posted.at(-1), changed
        ? { id: 2, type: 'error', error: 'changed' }
        : { id: 2, type: 'confirmed', result: { kind: 'reminder', at: '2026-11-02' } }, 'confirmation uses the parked destination, never a new caller-supplied one');
    } finally { p.close(); }
  }
});

// ---- the writer's harness modes ---------------------------------------------------------------------------------------
const P = require('../lib/ai/providers.js');
const finish = T.define({ id: 'example.finish', version: 1, output: 'text', stream: true, rate: { supersede: true, perMinute: 30 },
  input: (raw) => (typeof raw?.text === 'string' ? raw : null), check: (text) => text,
  build: (input, { text }) => text.request({ system: 'Finish the sentence.', context: [{ label: 'prompt', text: 'Rivers' }], data: [{ label: 'before', text: input.text }] }) });
const quick = T.define({ ...echo, id: 'example.quick', rate: { perMinute: 8 } });
Object.assign(TASKS, { 'example.finish': finish, 'example.quick': quick });
const writer = (over = {}) => env({ settings: async () => ({ on: true, use: 'main', features: { syllabus: true, completion: true, writing: true } }), ...over });
const complete = (id, text = 'The river', extra = {}) => ({ id, op: 'run', feature: 'completion', task: 'example.finish', input: { text }, ...extra });
// A server-sent stream the test writes as it goes.
const sse = () => {
  let ctl;
  const enc = new TextEncoder(), body = new ReadableStream({ start(c) { ctl = c; } });
  const frame = (o) => ctl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
  return { response: new Response(body, { headers: { 'content-type': 'text/event-stream' } }), push: (content) => frame({ choices: [{ delta: { content } }] }),
    end: () => { frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }); ctl.enqueue(enc.encode('data: [DONE]\n\n')); ctl.close(); } };
};
const deltas = (p) => p.posted.filter((m) => m.type === 'text_delta').map((m) => m.delta);

test('a text task streams live from a keyed endpoint, held back only where a key could begin, and ends with the text', async () => {
  const s = sse(), sent = [];
  const p = open(writer({ fetch: async (url, init) => { if (url.endsWith('/models')) return models(); sent.push(JSON.parse(init.body)); return s.response; } }));
  p.say(complete(1));
  await flush();
  s.push(' runs to'); await flush();
  assert.deepEqual(deltas(p), [' runs to'], 'on the page before the answer ends');
  s.push(' the s'); await flush();
  assert.deepEqual(deltas(p), [' runs to', ' the '], 'an s could begin the key: held');
  s.push('ea.'); s.end(); await flush();
  assert.deepEqual(deltas(p), [' runs to', ' the ', 'sea.']);
  assert.deepEqual(p.posted.at(-1).output, ' runs to the sea.');
  assert.equal(sent[0].response_format, undefined, 'no JSON asked for');
  assert.equal(sent[0].stream, true);
});

test('a key in a streamed text answer is refused before any of it reaches the page; a keyless endpoint streams it all', async () => {
  const s = sse();
  const p = open(writer({ fetch: async (url) => (url.endsWith('/models') ? models() : s.response) }));
  p.say(complete(1));
  await flush();
  s.push('ok '); s.push(KEY.slice(0, 8)); await flush();
  s.push(KEY.slice(8)); s.end(); await flush();
  assert.equal(p.posted.at(-1).error, 'invalid-response');
  assert.ok(!JSON.stringify(p.posted).includes(KEY.slice(0, 8)), 'not even its start');
  const t = sse(), e = writer({ fetch: async (url) => (url.endsWith('/models') ? models() : t.response) });
  e.vaultData.set('connections', { main: { ...CONN, key: undefined } });
  const q = open(e);
  q.say(complete(2));
  await flush();
  t.push(' the s'); await flush();
  assert.deepEqual(deltas(q), [' the s'], 'nothing to hold back without a key');
  t.push('ea.'); t.end(); await flush();
  assert.equal(q.posted.at(-1).output, ' the sea.');
});

test('a supersede task\'s new run cancels the one in flight instead of being busy; completion and writing never block each other', async () => {
  const waiting = [];
  const slow = writer({ fetch: (url, init) => (url.endsWith('/models') ? Promise.resolve(models()) : new Promise((res, rej) => {
    init.signal.addEventListener('abort', () => rej(init.signal.reason));
    waiting.push(() => res(json({ choices: [{ message: { content: '{"text":"done."}' }, finish_reason: 'stop' }] })));
  })) });
  const p = open(slow);
  p.say(complete(1));
  p.say({ id: 2, op: 'run', feature: 'writing', task: 'example.echo', input: { text: 'x' } });
  await flush();
  p.say(complete(3, 'The river runs'));
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'error'), [{ id: 1, type: 'error', error: 'cancelled' }], 'the old completion ended; nothing busy');
  assert.equal(waiting.length, 3, 'the writing run and both completions reached the server');
  for (const w of waiting) w();
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'end').map((m) => m.id).sort(), [2, 3]);
  // Another tab's completion is its own.
  const q = open({ ...slow, who: '8' });
  p.say(complete(4)); q.say(complete(5));
  await flush();
  assert.equal(p.posted.concat(q.posted).filter((m) => m.type === 'error').length, 1, 'neither cancelled the other');
});

test('a cancel frees the run\'s place at once: a run sent right after it is not busy', async () => {
  const hang = writer({ fetch: (url, init) => (url.endsWith('/models') ? Promise.resolve(models()) : new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))) });
  const p = open(hang);
  p.say(run());
  await flush();
  p.say({ id: 1, op: 'cancel' });
  p.say(run(undefined, { id: 2 }));
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'error'), [{ id: 1, type: 'error', error: 'cancelled' }]);
});

test('a port\'s messages are taken in the order sent, however long each sender check takes', async () => {
  let n = 0;
  const waiting = [];
  const e = writer({ allowed: () => new Promise((res) => setTimeout(() => res(true), ++n === 1 ? 30 : 0)),
    fetch: (url, init) => (url.endsWith('/models') ? Promise.resolve(models()) : new Promise((res, rej) => {
      init.signal.addEventListener('abort', () => rej(init.signal.reason));
      waiting.push(() => res(json({ choices: [{ message: { content: 'done.' }, finish_reason: 'stop' }] })));
    })) });
  const p = open(e);
  p.say(complete(1, 'first')); p.say(complete(2, 'second'));
  await new Promise((r) => setTimeout(r, 60)); await flush();
  for (const w of waiting) w();
  await flush();
  assert.deepEqual(p.posted.filter((m) => m.type === 'error'), [{ id: 1, type: 'error', error: 'cancelled' }], 'the later run is the one that stays');
  assert.equal(p.posted.find((m) => m.type === 'end').id, 2);
});

test('a task\'s own rate replaces the broker\'s per-feature limit and counts apart from every other task\'s', async () => {
  let t = 0;
  const e = writer({ now: () => t }), p = open(e);
  for (let i = 1; i <= 9; i++) { p.say({ ...run(undefined, { id: i }), task: 'example.quick' }); await flush(); }
  assert.deepEqual(p.posted.filter((m) => m.type === 'error'), [{ id: 9, type: 'error', error: 'often' }], 'eight a minute, not six');
  for (let i = 10; i < 10 + B.LIMIT.perMinute; i++) { p.say(run(undefined, { id: i })); await flush(); }
  assert.equal(p.posted.filter((m) => m.type === 'error').length, 1, 'the feature\'s own six still run');
  t = 61000;
  p.say({ ...run(undefined, { id: 99 }), task: 'example.quick' }); await flush();
  assert.equal(p.posted.at(-1).type, 'end');
});

test('a supersede task\'s runs make one call-record row a minute per tab and feature, with their count, total time and last state', async () => {
  let t = 1000;
  const fail = { on: false };
  const e = writer({ now: () => t, fetch: async (url) => (url.endsWith('/models') ? models() : fail.on ? new Response('no', { status: 503 })
    : json({ choices: [{ message: { content: 'ok.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 1 } })) });
  const p = open(e);
  for (const [i, at] of [[1, 1000], [2, 11000], [3, 21000]]) { t = at; p.say(complete(i)); await flush(); }
  p.say(run(undefined, { id: 4 })); await flush();
  const rows = e.local.data.aiCalls;
  assert.equal(rows.length, 2, 'the completions\' one row, and the syllabus run\'s own');
  const [row] = rows;
  assert.deepEqual({ ...row, id: typeof row.id }, { id: 'string', feature: 'completion', task: 'example.finish', provider: 'openai', state: 'completed', startedAt: 1000, count: 3, ms: 0, usage: { input: 12, output: 3 } });
  fail.on = true; t = 30000; p.say(complete(5)); await flush();
  const after = e.local.data.aiCalls.filter((r) => r.feature === 'completion');
  assert.equal(after.length, 1, 'still one row');
  assert.deepEqual([after[0].count, after[0].state, after[0].category, after[0].status], [4, 'provider-unavailable', 'provider-unavailable', 503]);
  assert.equal(after[0].id, p.posted.at(-1).reference, 'named by the failure the student can quote');
  fail.on = false; t = 62000; p.say(complete(6)); await flush();
  const later = e.local.data.aiCalls.filter((r) => r.feature === 'completion');
  assert.deepEqual(later.map((r) => [r.count, r.state]), [[4, 'provider-unavailable'], [1, 'completed']], 'a new minute, a new row');
});

test('a connection\'s catalog is asked for once per generation, not every run; a changed connection asks again', async () => {
  const e = writer();
  const p = open(e);
  p.say(run()); await flush();
  p.say(run(undefined, { id: 2 })); await flush();
  assert.deepEqual(e.calls.map((c) => c.url.split('/').pop()), ['models', 'completions', 'completions']);
  let released = 0;
  P.add({ id: 'warm-test', config: (c) => c, caps: () => ({}), status: async () => ({ state: 'ready' }), run: async () => ({ text: '', finish: 'stop' }), release: () => { released++; } });
  assert.deepEqual(await B.config({ op: 'set', id: 'main', cfg: { provider: 'openai', base: CONN.base, model: 'gpt-x', key: 'sk-live-ANOTHERKEY000000' } }, e), { ok: true, origin: 'https://api.example.com/*' });
  assert.equal(released, 1, 'warm sessions dropped with the old connection');
  p.say(run(undefined, { id: 3 })); await flush();
  assert.deepEqual(e.calls.map((c) => c.url.split('/').pop()), ['models', 'completions', 'completions', 'models', 'completions']);
  assert.equal(p.posted.at(-1).type, 'end');
});

test('the sender check may refuse one message with a code and keep the port; it is told the feature, a confirm\'s too', async () => {
  const asked = [];
  const e = writer({ allowed: (what) => { asked.push(what); return what.feature === 'completion' ? 'attempt' : true; } });
  const p = open(e);
  p.say({ id: 1, op: 'status', feature: 'completion' });
  p.say(complete(2));
  p.say({ id: 3, op: 'cancel' });
  p.say(run(undefined, { id: 4 }));
  await flush();
  assert.equal(p.hungUp, false);
  assert.deepEqual(p.posted.filter((m) => m.id !== 4), [{ id: 1, type: 'status', on: true, allowed: false, why: 'attempt' }, { id: 2, type: 'error', error: 'attempt' }]);
  assert.equal(p.posted.at(-1).type, 'end', 'the other feature ran');
  assert.deepEqual(asked, [{ op: 'status', feature: 'completion' }, { op: 'run', feature: 'completion' }, { op: 'cancel' }, { op: 'run', feature: 'syllabus' }]);
  assert.equal(e.calls.filter((c) => c.url.endsWith('/completions')).length, 1);
});
