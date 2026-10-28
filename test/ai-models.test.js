// The AI harness's model catalog (lib/ai/models.js): a compat server's ids only (nothing about capabilities invented),
// OpenRouter's public catalog with its capabilities and context, the last good list served when a live one fails, and the
// selection rules ported from Rimeward's validateSelection (MIT): a live list must name the model, a missing list marks it
// unverified, a known lack refuses, nothing is substituted.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/ai/models.js');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const store = () => { const m = new Map(); return { m, get: async (k) => m.get(k), set: async (k, v) => { m.set(k, structuredClone(v)); return true; } }; };
test.beforeEach(() => M._reset());

test('a compat server\'s list: ids only, the key sent to it, cached an hour, and the last good list when it fails', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return json({ data: [{ id: 'llama3.2' }, { id: 'qwen3' }, { nope: 1 }] }); };
  const cache = store(), cfg = { base: 'http://localhost:11434/v1', key: 'k-1', generation: 'g1' };
  const live = await M.list(cfg, { fetch, cache, now: () => 1000 });
  assert.deepEqual(live, { models: [{ id: 'llama3.2', name: 'llama3.2' }, { id: 'qwen3', name: 'qwen3' }], source: 'live', at: 1000 });
  assert.equal(calls[0].url, 'http://localhost:11434/v1/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer k-1');
  assert.equal(calls[0].init.redirect, 'error');
  await M.list(cfg, { fetch, cache, now: () => 2000 });
  assert.equal(calls.length, 1, 'cached');
  M._reset();
  const down = async () => { throw new TypeError('down'); };
  assert.deepEqual(await M.list(cfg, { fetch: down, cache, now: () => 9e9 }), { ...live, source: 'cache' });
  M._reset();
  await assert.rejects(M.list({ ...cfg, generation: 'g2' }, { fetch: down, cache: store() }), { name: 'TypeError', message: 'Model request failed.' }, 'a new generation has no last good list of the old one');
  await assert.rejects(M.list(cfg, { fetch: async () => json({}, 401), cache: store() }), (e) => e.status === 401);
});

test('OpenRouter\'s public catalog: no key sent, capabilities and context from what it states, absent when it doesn\'t', async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return json({ data: [
    { id: 'a/vision', name: 'Vision', context_length: 128000, top_provider: { context_length: 100000, max_completion_tokens: 4096 }, supported_parameters: ['tools', 'response_format'], architecture: { input_modalities: ['text', 'image'] } },
    { id: 'b/text', name: 'Text', context_length: 8000, supported_parameters: ['temperature'], architecture: { input_modalities: ['text'] } },
    { id: 'c/bare' },
  ] }); };
  const out = await M.list({ base: 'https://openrouter.ai/api/v1', key: 'sk-or-SECRET' }, { fetch });
  assert.equal(seen.url, M.OPENROUTER);
  assert.equal(seen.init.headers.authorization, undefined, 'the catalog is public: no key goes to it');
  assert.deepEqual(out.models.find((m) => m.id === 'a/vision'), { id: 'a/vision', name: 'Vision', context: { window: 100000, inputLimit: 100000 - 4096 }, tools: true, json: true, efforts: [], vision: true });
  assert.deepEqual(out.models.find((m) => m.id === 'b/text'), { id: 'b/text', name: 'Text', context: { window: 8000, inputLimit: 7200 }, tools: false, json: false, efforts: [], vision: false });
  assert.deepEqual(out.models.find((m) => m.id === 'c/bare'), { id: 'c/bare', name: 'c/bare' }, 'unknown capabilities are absent, never false');
});

test('select: a live list must name the model; no list leaves it unverified; a known lack refuses; nothing is substituted', () => {
  const live = { source: 'live', models: [{ id: 'm1', name: 'm1', tools: false, vision: false, context: { window: 1000, inputLimit: 900 } }, { id: 'm2', name: 'm2' }] };
  assert.deepEqual(M.select('m2', live), { model: 'm2', caps: {} });
  assert.deepEqual(M.select('m1', live), { model: 'm1', caps: { tools: false, images: false, context: 900 } });
  assert.throws(() => M.select('m9', live), (e) => e.code === 'setup' && /does not list a model "m9"/.test(e.message));
  assert.deepEqual(M.select('m9', { ...live, source: 'cache' }), { model: 'm9', unverified: true, caps: {} });
  assert.deepEqual(M.select('m9', null), { model: 'm9', unverified: true, caps: {} });
  assert.throws(() => M.select('m1', live, { tools: true }), (e) => e.code === 'caps' && /tool calls/.test(e.message));
  assert.throws(() => M.select('m1', live, { images: true }), (e) => e.code === 'caps' && /vision model/.test(e.message));
  assert.throws(() => M.select('', live), { code: 'setup' });
});

test('a credential echoed in a catalog is refused before it is returned or cached', async () => {
  const key = 'localserver-SECRET-9876', cache = store();
  await assert.rejects(M.list({ base: 'https://echo.example.com/v1', key, generation: 'echo' }, {
    fetch: async () => json({ data: [{ id: key }] }), cache,
  }), (e) => e.category === 'invalid-response' || e.code === 'invalid-response');
  assert.ok(!JSON.stringify([...cache.m]).includes(key));
});

test('catalog cancellation settles even when fetch ignores abort and does not cache its late answer', async () => {
  const c = new AbortController(), cache = store();
  let release;
  const pending = M.list({ base: 'https://late.example.com/v1', generation: 'late' }, {
    signal: c.signal, cache, fetch: () => new Promise((resolve) => { release = resolve; }),
  }).then(() => 'resolved', (e) => e.name);
  c.abort(new DOMException('cancelled', 'AbortError'));
  const observed = await Promise.race([pending, new Promise((resolve) => setTimeout(() => resolve('still pending'), 50))]);
  release(json({ data: [{ id: 'late-model' }] }));
  await pending;
  assert.equal(observed, 'AbortError');
  assert.equal(cache.m.size, 0, 'late answers cannot update the catalog after cancellation');
});

// OpenRouter's catalog as it answered on 2026-10-27 (test/fixtures/openrouter-models.json: a few models, descriptions,
// prices and benchmarks left out).
const routed = require('./fixtures/openrouter-models.json');

test('a model\'s efforts as OpenRouter states them: its supported_efforts Glaze knows, no none where reasoning is mandatory, none when it states none', async () => {
  const out = await M.list({ base: 'https://openrouter.ai/api/v1' }, { fetch: async () => json(routed) });
  const efforts = Object.fromEntries(out.models.map((m) => [m.id, m.efforts]));
  assert.deepEqual(efforts, {
    'anthropic/claude-sonnet-4.5': [], 'deepseek/deepseek-v4.1-flash-1017': ['none', 'low', 'high'], 'google/gemini-2.5-flash': [],
    'meta-llama/llama-3.3-70b-instruct': [], 'openai/gpt-5': ['minimal', 'low', 'medium', 'high'], 'openai/gpt-5.1': ['none', 'low', 'medium', 'high'], 'recursive/flint-v1.0:free': [],
  });
  M._reset();
  const every = await M.list({ base: 'https://openrouter.ai/api/v1' }, { fetch: async () => json({ data: [{ id: 'x/any', supported_parameters: ['reasoning'], reasoning: { mandatory: true, supported_efforts: null } }] }), cache: store() });
  assert.deepEqual(every.models[0].efforts, ['minimal', 'low', 'medium', 'high']);
  for (const m of out.models) assert.equal(M.efforts('https://openrouter.ai/api/v1', m.id, m), m.efforts);
});

test('a provider\'s own list where it says more: DeepSeek\'s effort levels, xAI\'s, Anthropic\'s names and headers', async () => {
  const seen = [];
  const fetch = (body) => async (url, init) => { seen.push({ url, init }); return json(body); };
  // DeepSeek's GET /models (api-docs.deepseek.com/api/list-models): effort.supported_levels, never 'none', which is thinking off.
  const ds = await M.list({ base: 'https://api.deepseek.com', key: 'sk-ds', generation: 'd' }, { fetch: fetch({ object: 'list', data: [
    { id: 'deepseek-flash', object: 'model', owned_by: 'deepseek', effort: { supported_levels: ['low', 'high', 'max'], default_level: 'high' } }, { id: 'deepseek-old', object: 'model', owned_by: 'deepseek' }] }) });
  assert.deepEqual(ds.models, [{ id: 'deepseek-flash', name: 'deepseek-flash', efforts: ['none', 'low', 'high'] }, { id: 'deepseek-old', name: 'deepseek-old' }]);
  assert.equal(seen[0].init.headers.authorization, 'Bearer sk-ds');
  // xAI's GET /v1/models (docs.x.ai rest-api-reference): capabilities.reasoning_effort.
  const x = await M.list({ base: 'https://api.x.ai/v1', key: 'xai-k', generation: 'x' }, { fetch: fetch({ data: [{ id: 'grok-4.7', capabilities: { reasoning_effort: ['low', 'medium', 'high', 'xhigh'], default_reasoning_effort: 'high' } }] }) });
  assert.deepEqual(x.models[0].efforts, ['low', 'medium', 'high']);
  // Anthropic's GET /v1/models: x-api-key and anthropic-version, every model on one page, its display name.
  const a = await M.list({ base: 'https://api.anthropic.com/v1', key: 'sk-ant-k', generation: 'a' }, { fetch: fetch({ data: [{ id: 'claude-sonnet-4-5', display_name: 'Claude Sonnet 4.5', type: 'model' }], has_more: false }) });
  assert.deepEqual(a.models, [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' }]);
  const last = seen.at(-1);
  assert.equal(last.url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.deepEqual(last.init.headers, { accept: 'application/json', 'x-api-key': 'sk-ant-k', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
});

test('a model\'s efforts by name where its provider\'s list says nothing; none for any other', () => {
  const e = (base, id) => M.efforts(base, id);
  assert.deepEqual(e('https://api.openai.com/v1', 'gpt-5-mini'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(e('https://api.openai.com/v1', 'gpt-5-2025-08-07'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(e('https://api.openai.com/v1', 'gpt-5.1'), ['none', 'low', 'medium', 'high']);
  assert.deepEqual(e('https://api.openai.com/v1', 'o4-mini'), ['low', 'medium', 'high']);
  assert.deepEqual(e('https://api.openai.com/v1', 'gpt-5-chat-latest'), []);
  assert.deepEqual(e('https://api.openai.com/v1', 'gpt-4.1'), []);
  assert.deepEqual(e('https://generativelanguage.googleapis.com/v1beta/openai', 'models/gemini-2.5-flash'), ['none', 'minimal', 'low', 'medium', 'high']);
  assert.deepEqual(e('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.5-pro'), ['minimal', 'low', 'medium', 'high']);
  assert.deepEqual(e('https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-2.0-flash'), []);
  assert.deepEqual(e('https://api.groq.com/openai/v1', 'openai/gpt-oss-120b'), ['low', 'medium', 'high']);
  assert.deepEqual(e('https://api.groq.com/openai/v1', 'llama-3.3-70b-versatile'), []);
  assert.deepEqual(e('https://api.x.ai/v1', 'grok-4.6'), ['low', 'medium', 'high']);
  assert.deepEqual(e('https://api.anthropic.com/v1', 'claude-sonnet-4-5'), []);
  assert.deepEqual(e('https://api.mistral.ai/v1', 'mistral-medium-3-5'), []);
  assert.deepEqual(e('http://localhost:11434/v1', 'gpt-5'), [], 'an endpoint of the student\'s own: unknown');
  assert.deepEqual(M.efforts('https://api.openai.com/v1', 'gpt-5', { efforts: [] }), [], 'a list that says none wins');
});
