// The AI harness's `openai` provider (lib/ai/providers/openai.js) through the one way in (lib/ai/providers.js run), against a
// stand-in server: the Chat Completions request it sends, the steps down a server's 400 asks for, streamed answers and tool
// calls put back together, and errors as codes with no key in them, whatever the server echoes.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/ai/providers.js');
const O = require('../lib/ai/providers/openai.js');

const KEY = 'sk-test-0123456789abcdefSECRET';
const cfg = (over = {}) => ({ base: 'https://api.example.com/v1', model: 'm-1', key: KEY, ...over });
const SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const ask = (over = {}) => ({ messages: [{ role: 'system', content: 'Answer.' }, { role: 'user', content: 'Q' }], ...over });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const done = (content, extra = {}) => json({ model: 'm-1', choices: [{ index: 0, message: { role: 'assistant', content, ...extra.message }, finish_reason: extra.finish || 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } });
// A server: each call answers with the next reply (a Response or a function of the request); calls are kept.
const server = (...replies) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
    if (init.signal?.aborted) throw init.signal.reason;
    const r = replies[calls.length - 1];
    if (!r) throw new Error('no more replies');
    return typeof r === 'function' ? r(calls.at(-1)) : r;
  };
  return { fetch, calls };
};
// An event stream in pieces cut anywhere, as the network gives it.
const sse = (events, cut = 7) => {
  const text = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += cut) c.enqueue(bytes.slice(i, i + cut)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
};
const chunk = (delta, finish = null) => ({ model: 'm-1', choices: [{ index: 0, delta, finish_reason: finish }] });

test('config cleans an endpoint: https anywhere, http only on this computer, a bare address gets /v1, a key with no spaces', () => {
  assert.deepEqual(O.config(cfg()), { ...cfg(), images: false });
  assert.deepEqual(O.config(O.config(cfg())), O.config(cfg()), 'cleaning twice changes nothing');
  assert.deepEqual(O.config({ base: 'http://localhost:11434', model: 'llama3.2' }), { base: 'http://localhost:11434/v1', model: 'llama3.2', images: false });
  assert.equal(O.config({ base: 'https://openrouter.ai/api/v1/', model: 'a/b:free' }).base, 'https://openrouter.ai/api/v1');
  for (const bad of [{ base: 'http://192.168.1.5:1234/v1', model: 'm' }, { base: 'https://user:pw@x.com/v1', model: 'm' }, { base: 'https://x.com/v1?k=1', model: 'm' },
    { base: 'ftp://x.com', model: 'm' }, { base: 'https://x.com/v1', model: '' }, { base: 'https://x.com/v1', model: ' m' }, { base: 'https://x.com/v1', model: 'm', key: 'has space' },
    { base: 'https://x.com/v1', model: 'm', extra: 1 }, { base: 'https://x.com/v1', model: 'm', images: 'yes' }]) assert.equal(O.config(bad), null, JSON.stringify(bad));
  assert.equal(O.origin(O.config({ base: 'http://localhost:11434', model: 'x' })), 'http://localhost/*', 'the manifest\'s loopback host, any port');
  assert.equal(O.origin(O.config(cfg())), 'https://api.example.com/*');
  assert.deepEqual(P.caps(O, O.config(cfg({ images: true, context: 128000 }))), { text: true, images: true, json: true, tools: true, stream: true, context: 128000 });
});

test('a request goes as Chat Completions: the key to that server only, no cookies or referrer, json_schema, pictures as data: URLs, tools', async () => {
  const s = server(done('{"answer":"42"}'));
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const out = await P.run('openai', ask({ schema: SCHEMA, maxTokens: 64, temperature: 0.2, messages: [{ role: 'system', content: 'Answer.' }, { role: 'user', content: [{ type: 'text', text: 'Q' }, { type: 'image', mime: 'image/png', data: png }] }],
    tools: [{ name: 'look_up', description: 'Look it up.', params: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } }] }), cfg({ images: true }), { fetch: s.fetch });
  assert.deepEqual(out, { text: '{"answer":"42"}', json: { answer: '42' }, provider: 'openai', model: 'm-1', finish: 'stop', usage: { input: 7, output: 3 } });
  const [{ url, init, body }] = s.calls;
  assert.equal(url, 'https://api.example.com/v1/chat/completions');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error', 'a redirect would take the key elsewhere');
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: SCHEMA } });
  assert.equal(body.model, 'm-1');
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 64);
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.messages[0], { role: 'system', content: 'Answer.' });
  assert.deepEqual(body.messages[1].content, [{ type: 'text', text: 'Q' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }]);
  assert.deepEqual(body.tools, [{ type: 'function', function: { name: 'look_up', description: 'Look it up.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } } }]);
  const anon = server(done('hi'));
  await P.run('openai', ask(), cfg({ key: undefined, base: 'https://anon.example.com/v1' }), { fetch: anon.fetch });
  assert.equal(anon.calls[0].init.headers.authorization, undefined, 'no key, no header');
});

test('a server that refuses json_schema gets json_object with the schema in words; one that refuses that, words only; the answer is checked either way', async () => {
  const s = server(json({ error: { message: "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model." } }, 400),
    json({ error: { message: 'response_format json_object is not supported' } }, 400), done('```json\n{"answer":"x"}\n```'));
  const c = cfg({ base: 'https://steps.example.com/v1' });
  const out = await P.run('openai', ask({ schema: SCHEMA }), c, { fetch: s.fetch });
  assert.deepEqual(out.json, { answer: 'x' });
  assert.equal(s.calls[1].body.response_format.type, 'json_object');
  assert.match(s.calls[1].body.messages[0].content, /^Answer\.\n\nAnswer with one JSON object and nothing else\. It must match this JSON Schema:\n\{"type":"object"/);
  assert.equal(s.calls[2].body.response_format, undefined);
  // Remembered for that server and model while the worker runs: the next request starts where this one ended.
  const again = server(done('{"answer":"y"}'));
  await P.run('openai', ask({ schema: SCHEMA }), c, { fetch: again.fetch });
  assert.equal(again.calls.length, 1);
  assert.equal(again.calls[0].body.response_format, undefined);
  // An answer that doesn't fit is refused, never passed on.
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), c, { fetch: server(done('{"answer":5}')).fetch }), (e) => e.code === 'format' && /answer: expected string/.test(e.detail));
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), c, { fetch: server(done('no JSON here')).fetch }), { code: 'format' });
});

test('max_tokens, temperature and streamed usage step down when a server names them', async () => {
  const s = server(json({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." } }, 400),
    json({ error: { message: "Unsupported value: 'temperature' does not support 0.5 with this model." } }, 400), done('ok'));
  const out = await P.run('openai', ask({ maxTokens: 10, temperature: 0.5 }), cfg({ base: 'https://reason.example.com/v1' }), { fetch: s.fetch });
  assert.equal(out.text, 'ok');
  assert.equal(s.calls[1].body.max_completion_tokens, 10);
  assert.equal(s.calls[1].body.max_tokens, undefined);
  assert.equal(s.calls[2].body.temperature, undefined);
  // A 400 about anything else is the request's fault: no retry.
  const other = server(json({ error: { message: 'messages: too few' } }, 400));
  await assert.rejects(P.run('openai', ask(), cfg({ base: 'https://other.example.com/v1' }), { fetch: other.fetch }), { code: 'request' });
  assert.equal(other.calls.length, 1);
});

test('a streamed answer reaches onDelta piece by piece, and tool calls are put together from their pieces', async () => {
  const deltas = [];
  const text = await P.run('openai', ask(), cfg(), { fetch: server(sse([chunk({ role: 'assistant', content: '' }), chunk({ content: 'Hel' }), chunk({ content: 'lo' }), chunk({}, 'stop'),
    { model: 'm-1', choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } }, '[DONE]'])).fetch, onDelta: (d) => deltas.push(d) });
  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.deepEqual(text, { text: 'Hello', provider: 'openai', model: 'm-1', finish: 'stop', usage: { input: 4, output: 2 } });
  const s = server(sse([
    chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'look_up', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
    chunk({ tool_calls: [{ index: 1, id: 'call_b', type: 'function', function: { name: 'other', arguments: '{}' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }),
    chunk({}, 'tool_calls'), '[DONE]'], 5));
  const tools = await P.run('openai', ask({ tools: [{ name: 'look_up', description: 'd', params: { type: 'object' } }] }), cfg(), { fetch: s.fetch, onDelta: () => {} });
  assert.equal(s.calls[0].body.stream, true);
  assert.deepEqual(s.calls[0].body.stream_options, { include_usage: true });
  assert.equal(s.calls[0].init.headers.accept, 'text/event-stream');
  assert.deepEqual(tools.toolCalls, [{ id: 'call_a', name: 'look_up', args: { q: 'x' } }, { id: 'call_b', name: 'other', args: {} }]);
  assert.equal(tools.finish, 'tool');
  // A server that ignores stream and sends one body is read as one.
  assert.equal((await P.run('openai', ask(), cfg(), { fetch: server(done('whole')).fetch, onDelta: () => {} })).text, 'whole');
});

test('an error in the middle of a stream, and a refusal, are codes', async () => {
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(sse([chunk({ content: 'a' }), { error: { code: 429, message: `slow down ${KEY}` } }])).fetch, onDelta: () => {} }), (e) => e.code === 'rate' && !e.detail.includes(KEY));
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(sse(['{not json'])).fetch, onDelta: () => {} }), { code: 'format' });
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg(), { fetch: server(done(null, { message: { refusal: 'I can\'t help with that.' } })).fetch }), { code: 'refusal' });
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg(), { fetch: server(done('{"ans', { finish: 'length' })).fetch }), { code: 'size' });
});

test('each failure is a code, and no error carries the key, even when the server echoes it', async () => {
  const echo = (status, extra = '') => json({ error: { message: `Incorrect API key provided: ${KEY}. Authorization: Bearer ${KEY} ${extra}` } }, status);
  for (const [status, code, extra] of [[401, 'auth'], [403, 'denied'], [404, 'model', 'The model `m-1` does not exist'], [404, 'endpoint'], [429, 'rate'], [500, 'server'], [503, 'server'], [413, 'size'], [400, 'size', 'maximum context length is 8192 tokens']]) {
    const e = await P.run('openai', ask(), cfg({ base: `https://e${status}.example.com/v1` }), { fetch: server(echo(status, extra)).fetch }).catch((x) => x);
    assert.equal(e.code, code, `${status} ${extra}`);
    for (const s of [e.message, e.detail, JSON.stringify(e), String(e.stack)]) assert.ok(!String(s).includes(KEY) && !String(s).includes('SECRET'), `${status}: ${s}`);
    assert.match(e.detail, /\[key\]/);
  }
  const net = await P.run('openai', ask(), cfg(), { fetch: async () => { throw new TypeError(`fetch failed for ${KEY}`); } }).catch((x) => x);
  assert.equal(net.code, 'network');
  assert.ok(!JSON.stringify(net).includes(KEY));
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(new Response('<html>oops</html>', { status: 200 })).fetch }), { code: 'format' });
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(json({ nothing: true })).fetch }), { code: 'format' });
});

test('a cancel and a timeout end the request with their own codes', async () => {
  const hang = (call) => new Promise((_, reject) => call.init.signal.addEventListener('abort', () => reject(call.init.signal.reason)));
  const c = new AbortController();
  const p = P.run('openai', ask(), cfg(), { fetch: server(hang).fetch, signal: c.signal });
  setTimeout(() => c.abort(), 10);
  await assert.rejects(p, { code: 'cancelled' });
  await assert.rejects(P.run('openai', ask({ timeoutMs: 1000 }), cfg(), { fetch: server(hang).fetch }), { code: 'timeout' });
  const gone = new AbortController();
  gone.abort();
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(done('x')).fetch, signal: gone.signal }), { code: 'cancelled' });
});

test('the run refuses what the provider cannot do before anything is sent', async () => {
  const s = server();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  await assert.rejects(P.run('openai', { messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: png }] }] }, cfg(), { fetch: s.fetch }), { code: 'caps' });
  await assert.rejects(P.run('openai', { messages: [] }, cfg(), { fetch: s.fetch }), { code: 'request' });
  await assert.rejects(P.run('openai', ask(), { base: 'http://lan.example.com', model: 'm' }, { fetch: s.fetch }), { code: 'setup' });
  await assert.rejects(P.run('nope', ask(), cfg(), { fetch: s.fetch }), { code: 'setup' });
  assert.equal(s.calls.length, 0);
});

test('status asks the server for its models: ready when it lists this one, why not otherwise', async () => {
  const list = (ids) => json({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) });
  const s = server(list(['m-0', 'm-1']));
  assert.deepEqual(await O.status(O.config(cfg()), { fetch: s.fetch }), { state: 'ready' });
  assert.equal(s.calls[0].url, 'https://api.example.com/v1/models');
  assert.equal(s.calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(await O.status(O.config(cfg()), { fetch: server(list(['other'])).fetch }), { state: 'unavailable', reason: 'model' });
  assert.deepEqual(await O.status(O.config(cfg()), { fetch: server(json({}, 401)).fetch }), { state: 'unavailable', reason: 'auth' });
  assert.deepEqual(await O.status(O.config(cfg()), { fetch: async () => { throw new TypeError('down'); } }), { state: 'unavailable', reason: 'network' });
});
