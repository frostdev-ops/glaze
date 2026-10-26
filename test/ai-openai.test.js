// The AI harness's `openai` provider (lib/ai/providers/openai.js) through the one way in (lib/ai/providers.js run), against a
// stand-in server (globalThis.fetch-style stubs, as Rimeward's tests/agent-custom-tools.test.ts uses): the request it sends,
// the typed single steps down a server's refusal names (remembered per model), the one quiet retry for a 429 and no replay
// of inference that may have run, streamed answers, and failures as categories with a reference and no key.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/ai/providers.js');
const O = require('../lib/ai/providers/openai.js');

const KEY = 'sk-test-0123456789abcdefSECRET';
let n = 0;
// A fresh server address per test, so one test's remembered step down never meets another's.
const cfg = (over = {}) => ({ base: `https://api${n}.example.com/v1`, model: 'm-1', key: KEY, ...over });
test.beforeEach(() => { n++; });
const SCHEMA = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false };
const ask = (over = {}) => ({ messages: [{ role: 'system', content: 'Answer.' }, { role: 'user', content: 'Q' }], ...over });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const done = (content, extra = {}) => json({ model: 'm-1', choices: [{ index: 0, message: { role: 'assistant', content, ...extra.message }, finish_reason: extra.finish || 'stop' }],
  usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } });
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
const sse = (events, cut = 7) => {
  const bytes = new TextEncoder().encode(events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''));
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += cut) c.enqueue(bytes.slice(i, i + cut)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
};
const chunk = (delta, finish = null) => ({ model: 'm-1', choices: [{ index: 0, delta, finish_reason: finish }] });
const rejection = (param, message = 'unsupported') => json({ error: { message, type: 'invalid_request_error', param, code: 'unsupported_parameter' } }, 400);

test('config: the endpoint rules, a trimmed key (empty is none), and caps that leave the unknown absent', () => {
  assert.deepEqual(O.config(cfg()), cfg());
  assert.deepEqual(O.config(O.config(cfg())), O.config(cfg()), 'cleaning twice changes nothing');
  assert.deepEqual(O.config({ base: 'http://localhost:11434/v1', model: 'llama3.2', key: '  ' }), { base: 'http://localhost:11434/v1', model: 'llama3.2' });
  assert.equal(O.config({ ...cfg(), key: ' sk-a ' }).key, 'sk-a');
  for (const bad of [{ base: 'http://192.168.1.5:1234/v1', model: 'm' }, { base: 'https://u:p@x.com/v1', model: 'm' }, { base: 'https://x.com/v1', model: '' },
    { base: 'https://x.com/v1', model: ' m' }, { base: 'https://x.com/v1', model: 'm', key: 'has space' }, { base: 'https://x.com/v1', model: 'm', extra: 1 }]) assert.equal(O.config(bad), null, JSON.stringify(bad));
  assert.equal(O.origin(O.config({ base: 'http://localhost:11434/v1', model: 'x' })), 'http://localhost/*', 'the manifest\'s loopback host, any port');
  assert.deepEqual(P.caps(O, O.config(cfg())), { text: true, json: true, stream: true });
  assert.deepEqual(P.caps(O, O.config(cfg({ images: true, context: 128000 }))), { text: true, images: true, json: true, stream: true, context: 128000 });
});

test('a request goes as Chat Completions: the key to that server only, no cookies, referrer or redirect, json_schema, pictures as data: URLs, tools', async () => {
  const s = server(done('{"answer":"42"}'));
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const tools = [{ name: 'look_up', description: 'Look it up.', parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false } }];
  const out = await P.run('openai', ask({ schema: SCHEMA, maxTokens: 64, temperature: 0.2, tools, messages: [{ role: 'system', content: 'Answer.' }, { role: 'user', content: [{ type: 'text', text: 'Q' }, { type: 'image', mime: 'image/png', data: png }] }] }), cfg({ images: true }), { fetch: s.fetch });
  assert.deepEqual(out, { text: '{"answer":"42"}', json: { answer: '42' }, provider: 'openai', model: 'm-1', finish: 'stop', usage: { input: 7, cached: 2, output: 3 } });
  const [{ url, init, body }] = s.calls;
  assert.equal(url, `https://api${n}.example.com/v1/chat/completions`);
  assert.equal(init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error', 'a redirect would take the key elsewhere');
  assert.deepEqual(body.response_format, { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: SCHEMA } });
  assert.deepEqual([body.model, body.stream, body.max_tokens, body.temperature, body.tool_choice], ['m-1', false, 64, 0.2, 'auto']);
  assert.deepEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } });
  assert.deepEqual(body.tools, [{ type: 'function', function: tools[0] }]);
  const anon = server(done('hi'));
  await P.run('openai', ask(), cfg({ key: undefined }), { fetch: anon.fetch });
  assert.equal(anon.calls[0].init.headers.authorization, undefined, 'no key, no header');
});

test('json_schema refused by name steps down once to json_object (schema in words), then to words only, remembered for that model', async () => {
  const c = cfg();
  const s = server(rejection('response_format'), rejection('response_format'), done('Sure! ```json\n{"answer":"x"}\n```'));
  assert.deepEqual((await P.run('openai', ask({ schema: SCHEMA }), c, { fetch: s.fetch })).json, { answer: 'x' }, 'read as askJson reads an answer');
  assert.equal(s.calls[1].body.response_format.type, 'json_object');
  assert.match(s.calls[1].body.messages[0].content, /^Answer\.\n\nAnswer with one JSON object and nothing else\. It must match this JSON Schema:\n\{"type":"object"/);
  assert.equal(s.calls[2].body.response_format, undefined);
  const again = server(done('{"answer":"y"}'));
  await P.run('openai', ask({ schema: SCHEMA }), c, { fetch: again.fetch });
  assert.equal(again.calls.length, 1);
  assert.equal(again.calls[0].body.response_format, undefined, 'remembered for this server and model');
  const other = server(done('{"answer":"z"}'));
  await P.run('openai', ask({ schema: SCHEMA }), { ...c, model: 'm-2' }, { fetch: other.fetch });
  assert.equal(other.calls[0].body.response_format.type, 'json_schema', 'another model starts from the top');
  // A typed error about another parameter is not a reason to drop the schema.
  const typed = server(rejection('tools[0].function.parameters', 'Invalid schema for function'));
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg({ base: 'https://typed.example.com/v1' }), { fetch: typed.fetch }), (e) => e.code === 'request-rejected' && e.status === 400);
  assert.equal(typed.calls.length, 1);
});

test('max_tokens and temperature step down when a refusal names them', async () => {
  const s = server(rejection('max_tokens', "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."), rejection('temperature'), done('ok'));
  assert.equal((await P.run('openai', ask({ maxTokens: 10, temperature: 0.5 }), cfg(), { fetch: s.fetch })).text, 'ok');
  assert.equal(s.calls[1].body.max_completion_tokens, 10);
  assert.equal(s.calls[1].body.max_tokens, undefined);
  assert.equal(s.calls[2].body.temperature, undefined);
  // A server without typed errors that names the parameter in its message (ponytail).
  const prose = server(json({ error: { message: 'response_format json_schema is not supported' } }, 400), done('{"answer":"a"}'));
  await P.run('openai', ask({ schema: SCHEMA }), cfg({ base: 'https://prose.example.com/v1' }), { fetch: prose.fetch });
  assert.equal(prose.calls[1].body.response_format.type, 'json_object');
});

test('a 429 is retried once after a pause; network loss, a 5xx and a cut stream never replay inference', async () => {
  const rate = server(json({ error: { message: 'slow down' } }, 429), done('ok'));
  const t = Date.now();
  assert.equal((await P.run('openai', ask(), cfg(), { fetch: rate.fetch })).text, 'ok');
  assert.ok(Date.now() - t >= 1100, 'after 1.2 s');
  const twice = server(json({}, 429), json({}, 429));
  await assert.rejects(P.run('openai', ask(), cfg({ base: 'https://r2.example.com/v1' }), { fetch: twice.fetch }), (e) => e.code === 'request-rejected' && e.status === 429);
  assert.equal(twice.calls.length, 2);
  for (const [fixture, category] of [['network', 'connection-lost'], ['server', 'provider-unavailable'], ['stream', 'invalid-response']]) {
    let requests = 0;
    const fetch = async () => {
      requests++;
      if (fixture === 'network') throw Error('ECONNRESET');
      if (fixture === 'server') return new Response('server failed', { status: 500 });
      return sse([chunk({ content: 'half' })]);
    };
    await assert.rejects(P.run('openai', ask(), cfg({ base: `https://${fixture}.example.com/v1` }), { fetch, onDelta: () => {} }), (e) => e.code === category && /No uncertain inference request was automatically replayed/.test(e.message));
    assert.equal(requests, 1, fixture);
  }
});

test('a streamed answer reaches onDelta piece by piece; tool calls are put together; a server that ignores stream is read whole', async () => {
  const deltas = [];
  const text = await P.run('openai', ask(), cfg(), { fetch: server(sse([chunk({ role: 'assistant', content: '' }), chunk({ content: 'Hel' }), chunk({ content: 'lo' }), chunk({}, 'stop'),
    { model: 'm-1', choices: [], usage: { prompt_tokens: 4, completion_tokens: 2 } }, '[DONE]'])).fetch, onDelta: (d) => deltas.push(d) });
  assert.deepEqual(deltas, ['Hel', 'lo']);
  assert.deepEqual(text, { text: 'Hello', provider: 'openai', model: 'm-1', finish: 'stop', usage: { input: 4, output: 2 } });
  const s = server(sse([chunk({ tool_calls: [{ index: 0, id: 'call_a', type: 'function', function: { name: 'look_up', arguments: '' } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }),
    chunk({ tool_calls: [{ index: 1, id: 'call_b', function: { name: 'other', arguments: '{}' } }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }), chunk({}, 'tool_calls'), '[DONE]'], 5));
  const tools = await P.run('openai', ask({ tools: [{ name: 'look_up', description: 'd', parameters: { type: 'object' } }] }), cfg(), { fetch: s.fetch, onDelta: () => {} });
  assert.deepEqual([s.calls[0].body.stream, s.calls[0].body.stream_options, s.calls[0].init.headers.accept], [true, { include_usage: true }, 'text/event-stream']);
  assert.deepEqual(tools.toolCalls, [{ id: 'call_a', name: 'look_up', args: { q: 'x' } }, { id: 'call_b', name: 'other', args: {} }]);
  assert.equal(tools.finish, 'tool');
  assert.equal((await P.run('openai', ask(), cfg(), { fetch: server(done('whole')).fetch, onDelta: () => {} })).text, 'whole');
});

test('an answer cut off on a schema task is a refusal, never parsed; a declined answer is a refusal; one outside the schema is invalid', async () => {
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg(), { fetch: server(done('{"answer":"cut', { finish: 'length' })).fetch }), { code: 'refusal' });
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg(), { fetch: server(done(null, { message: { refusal: 'I can\'t help with that.' } })).fetch }), { code: 'refusal' });
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg(), { fetch: server(done('{"answer":5}')).fetch }), (e) => e.code === 'invalid-response' && /answer: expected string/.test(e.detail));
  await assert.rejects(P.run('openai', ask({ schema: SCHEMA }), cfg(), { fetch: server(done('no JSON here')).fetch }), { code: 'invalid-response' });
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(json({ nothing: true })).fetch }), { code: 'invalid-response' });
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(new Response('<html>oops</html>')).fetch }), { code: 'invalid-response' });
  await assert.rejects(P.run('openai', ask(), cfg(), { fetch: server(done('x', { finish: 'content_filter' })).fetch }), { code: 'invalid-response' });
});

test('each failure is a category with a reference, and nothing a page or the error carries holds the key, whatever the server echoes', async () => {
  const echo = (status) => json({ error: { message: `Incorrect API key provided: ${KEY}. Authorization: Bearer ${KEY}` } }, status);
  for (const [status, category] of [[401, 'request-rejected'], [403, 'request-rejected'], [404, 'request-rejected'], [413, 'request-rejected'], [500, 'provider-unavailable'], [503, 'provider-unavailable']]) {
    const e = await P.run('openai', ask(), cfg({ base: `https://e${status}.example.com/v1` }), { fetch: server(echo(status)).fetch }).catch((x) => x);
    assert.equal(e.code, category, String(status));
    assert.equal(e.status, status);
    assert.match(e.reference, /^[0-9a-f-]{36}$/);
    for (const s of [e.message, JSON.stringify(e), e.cause?.message]) assert.ok(!String(s).includes(KEY) && !String(s).includes('SECRET'), `${status}: ${s}`);
  }
  // A key with no recognisable shape is taken out by its exact text.
  const plainKey = 'localserver-SECRET-9876';
  const odd = await P.run('openai', ask(), cfg({ key: plainKey, base: 'https://odd.example.com/v1' }), { fetch: server(json({ error: { message: `bad key ${plainKey}` } }, 401)).fetch }).catch((x) => x);
  assert.ok(odd.cause?.message.includes('[key]') && !odd.cause.message.includes(plainKey), odd.cause?.message);
  const net = await P.run('openai', ask(), cfg(), { fetch: async () => { throw new TypeError(`fetch failed for ${KEY}`); } }).catch((x) => x);
  assert.equal(net.code, 'connection-lost');
  assert.ok(!JSON.stringify(net).includes(KEY) && !net.message.includes(KEY));
  // A text-only model asked about a picture: the one failure the student fixes by picking a model.
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  await assert.rejects(P.run('openai', { messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: png }] }] }, cfg(), { fetch: server(json({ error: { message: 'This model does not support image input' } }, 400)).fetch }),
    (e) => e.code === 'caps' && /vision model/.test(e.detail));
});

test('a cancel and a timeout end the request with their categories; a known lack refuses before anything is sent', async () => {
  const hang = (call) => new Promise((_, reject) => call.init.signal.addEventListener('abort', () => reject(call.init.signal.reason)));
  const c = new AbortController();
  const p = P.run('openai', ask(), cfg(), { fetch: server(hang).fetch, signal: c.signal });
  setTimeout(() => c.abort(), 10);
  await assert.rejects(p, { code: 'cancelled' });
  await assert.rejects(P.run('openai', ask({ timeoutMs: 1000 }), cfg(), { fetch: server(hang).fetch }), { code: 'timeout' });
  // A provider that ignores the signal: the deadline still ends the call, and its late answer never comes back.
  const deaf = server(() => new Promise((r) => setTimeout(() => r(done('late')), 1500)));
  await assert.rejects(P.run('openai', ask({ timeoutMs: 1000 }), cfg(), { fetch: deaf.fetch }), { code: 'timeout' });
  const s = server();
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  await assert.rejects(P.run('openai', { messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/png', data: png }] }] }, cfg({ images: false }), { fetch: s.fetch }), { code: 'caps' });
  await assert.rejects(P.run('openai', { messages: [] }, cfg(), { fetch: s.fetch }), { code: 'request' });
  await assert.rejects(P.run('openai', ask(), { base: 'http://lan.example.com', model: 'm' }, { fetch: s.fetch }), { code: 'setup' });
  assert.equal(s.calls.length, 0);
});

test('status asks the catalog: ready when it lists the model, why not otherwise', async () => {
  const list = (ids) => json({ object: 'list', data: ids.map((id) => ({ id })) });
  const s = server(list(['m-0', 'm-1']));
  assert.deepEqual(await O.status(O.config(cfg()), { fetch: s.fetch }), { state: 'ready', source: 'live' });
  assert.equal(s.calls[0].url, `https://api${n}.example.com/v1/models`);
  assert.equal(s.calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(await O.status(O.config(cfg({ base: 'https://other.example.com/v1' })), { fetch: server(list(['other'])).fetch }), { state: 'unavailable', reason: 'model', source: 'live' });
  // A failure: its category, HTTP status and a reference the student can quote.
  const refused = await O.status(O.config(cfg({ base: 'https://auth.example.com/v1' })), { fetch: server(json({}, 401)).fetch });
  assert.deepEqual({ ...refused, reference: typeof refused.reference }, { state: 'unavailable', reason: 'request-rejected', status: 401, reference: 'string' });
  const down = await O.status(O.config(cfg({ base: 'https://down.example.com/v1' })), { fetch: async () => { throw new TypeError('down'); } });
  assert.deepEqual({ ...down, reference: typeof down.reference }, { state: 'unavailable', reason: 'connection-lost', reference: 'string' });
});
