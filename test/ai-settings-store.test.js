// The AI harness's stored settings (lib/ai/settings.js): the shape clean() gives, a feature's model and tuning, and the
// migration of an older Settings' one endpoint connection into a provider's or an endpoint of its own.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/ai/settings.js');
const R = require('../lib/ai/request.js');

const KEY = 'sk-or-v1-0000synthetic0000000000000000000000000000000000000000000000';
const OFF = { syllabus: false, completion: false, writing: false };

test('clean gives every part at its default, and keeps only what fits', () => {
  assert.deepEqual(A.clean(), { on: false, mode: 'simple', model: { use: null, model: '' }, models: {}, tune: {}, features: OFF });
  assert.deepEqual(A.clean(undefined), A.DEFAULTS);
  const s = A.clean({ on: true, mode: 'advanced', model: { use: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', effort: 'low' },
    models: { completion: { use: 'groq', model: 'llama-3.3-70b-versatile', effort: 'none' }, writing: { use: 'Bad Id', model: 'x' }, notes: { use: 'openai', model: 'gpt-5' } },
    tune: { completion: { temperature: 0.2, maxTokens: 32, context: 2000, timeoutMs: 4000, pause: 350, top: 1 }, writing: { temperature: 3, pause: 350, maxTokens: 4096.5 } },
    features: { completion: true, writing: 'yes' } });
  assert.deepEqual(s, { on: true, mode: 'advanced', model: { use: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017', effort: 'low' },
    models: { completion: { use: 'groq', model: 'llama-3.3-70b-versatile', effort: 'none' } },
    tune: { completion: { temperature: 0.2, maxTokens: 32, context: 2000, timeoutMs: 4000, pause: 350 } },
    features: { syllabus: false, completion: true, writing: false } });
  assert.deepEqual(A.clean({ model: { use: 'openai', model: ' gpt-5', effort: 'max' } }).model, { use: 'openai', model: '' }, 'a model id as typed, an effort Glaze knows');
  assert.deepEqual(A.clean({ model: { use: 'apple' } }).model, { use: 'device', model: '' }, 'Apple Intelligence is On this device');
  assert.deepEqual(A.EFFORTS, R.EFFORTS);
});

test('an older Settings\' use is the overall model\'s connection, whatever else is stored', () => {
  assert.deepEqual(A.clean({ on: true, use: 'endpoint', features: { writing: true } }).model, { use: 'endpoint', model: '' });
  assert.deepEqual(A.clean({ use: 'apple' }).model, { use: 'device', model: '' });
  assert.deepEqual(A.clean({ use: 'endpoint', model: { use: 'groq', model: 'm' } }).model, { use: 'groq', model: 'm' }, 'a stored model wins');
});

test('a feature runs on its own model, else the overall one; a connection without a model has none chosen, but on this device', () => {
  const s = A.clean({ model: { use: 'openai', model: 'gpt-5', effort: 'medium' }, models: { completion: { use: 'groq', model: 'llama' } } });
  assert.deepEqual(A.resolve(s, 'completion'), { use: 'groq', model: 'llama' });
  assert.deepEqual(A.resolve(s, 'writing'), { use: 'openai', model: 'gpt-5', effort: 'medium' });
  assert.equal(A.chosen(A.resolve(A.clean({ model: { use: 'openai' } }), 'writing')), false);
  assert.equal(A.chosen(A.resolve(A.clean({ model: { use: 'openai', model: 'gpt-5' } }), 'writing')), true);
  assert.deepEqual(A.resolve(A.clean({ model: { use: 'device' } }), 'writing'), { use: 'device', model: '' });
  assert.equal(A.resolve(A.clean(), 'writing'), null);
  assert.equal(A.allowed(A.clean({ on: true, features: { writing: true } }), 'writing'), false, 'no model chosen');
  assert.equal(A.allowed(A.clean({ on: true, model: { use: 'device' }, features: { writing: true } }), 'writing'), true);
});

test('tuning applies in Advanced only, and the pause is the gray text\'s alone', () => {
  const tune = { completion: { pause: 350, temperature: 0.5 }, writing: { pause: 350, maxTokens: 2048 } };
  assert.deepEqual(A.tuning(A.clean({ mode: 'advanced', tune }), 'completion'), { temperature: 0.5, pause: 350 });
  assert.deepEqual(A.tuning(A.clean({ mode: 'advanced', tune }), 'writing'), { maxTokens: 2048 });
  assert.deepEqual(A.tuning(A.clean({ mode: 'simple', tune }), 'completion'), {});
  assert.deepEqual(A.clean({ mode: 'simple', tune }).tune, { completion: { temperature: 0.5, pause: 350 }, writing: { maxTokens: 2048 } }, 'kept for Advanced');
});

test('the owner\'s endpoint on OpenRouter becomes the OpenRouter provider with that key, its model the overall one', () => {
  const settings = { on: true, use: 'endpoint', features: { syllabus: true, completion: true, writing: true } };
  const connections = { endpoint: { provider: 'openai', base: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4.1-flash-1017', key: KEY, generation: 'g-1' },
    device: { provider: 'device', generation: 'g-2' } };
  const m = A.migrate(settings, connections);
  assert.deepEqual(m.connections, { openrouter: { provider: 'openai', base: 'https://openrouter.ai/api/v1', key: KEY, generation: 'g-1' }, device: { provider: 'device', generation: 'g-2' } });
  assert.deepEqual(m.settings, { on: true, mode: 'simple', model: { use: 'openrouter', model: 'deepseek/deepseek-v4.1-flash-1017' }, models: {}, tune: {},
    features: { syllabus: true, completion: true, writing: true } });
  assert.deepEqual(m.changed, { settings: true, connections: true });
  // Read again as written back: nothing more to do.
  const again = A.migrate(m.settings, m.connections);
  assert.deepEqual(again, { ...m, changed: { settings: false, connections: false } });
  assert.deepEqual(connections.endpoint.model, 'deepseek/deepseek-v4.1-flash-1017', 'the stored objects are not changed');
});

test('settings written back before the connections still find the model', () => {
  const first = A.migrate({ on: true, use: 'endpoint', features: {} }, { endpoint: { provider: 'openai', base: 'https://openrouter.ai/api/v1/', model: 'm/1', key: KEY, generation: 'g' } });
  const later = A.migrate(first.settings, { endpoint: { provider: 'openai', base: 'https://openrouter.ai/api/v1/', model: 'm/1', key: KEY, generation: 'g' } });
  assert.deepEqual(later.settings.model, { use: 'openrouter', model: 'm/1' });
  assert.deepEqual(Object.keys(later.connections), ['openrouter']);
});

test('an endpoint at no preset\'s address becomes an endpoint of its own, named by its host; On this device stays', () => {
  const m = A.migrate({ on: true, use: 'endpoint' }, { endpoint: { provider: 'openai', base: 'http://localhost:11434/v1', model: 'llama3.2', generation: 'g' } });
  assert.deepEqual(m.connections, { 'custom-1': { provider: 'openai', base: 'http://localhost:11434/v1', name: 'localhost:11434', generation: 'g' } });
  assert.deepEqual(m.settings.model, { use: 'custom-1', model: 'llama3.2' });
  const d = A.migrate({ on: true, use: 'device', features: { writing: true } }, { device: { provider: 'device', generation: 'g' }, endpoint: { provider: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama', key: KEY, generation: 'h' } });
  assert.deepEqual(d.settings.model, { use: 'device', model: '' });
  assert.deepEqual(d.connections, { device: { provider: 'device', generation: 'g' }, groq: { provider: 'openai', base: 'https://api.groq.com/openai/v1', key: KEY, generation: 'h' } });
  // The preset's id already taken: an endpoint of its own instead of writing over it.
  const t = A.migrate({ use: 'endpoint' }, { openrouter: { provider: 'openai', base: 'https://openrouter.ai/api/v1', key: 'other', generation: 'a' }, endpoint: { provider: 'openai', base: 'https://openrouter.ai/api/v1', model: 'x/y', key: KEY, generation: 'b' } });
  assert.equal(t.connections.openrouter.key, 'other');
  assert.equal(t.connections['custom-1'].key, KEY);
  assert.deepEqual(t.settings.model, { use: 'custom-1', model: 'x/y' });
});

test('every preset is https, at its own host, with a key page', () => {
  assert.deepEqual(Object.keys(A.PRESETS), ['openai', 'anthropic', 'gemini', 'openrouter', 'xai', 'mistral', 'groq', 'deepseek']);
  for (const [id, p] of Object.entries(A.PRESETS)) {
    assert.equal(new URL(p.base).protocol, 'https:', id);
    assert.equal(new URL(p.keys).protocol, 'https:', id);
    assert.equal(A.kind(id), 'preset');
  }
  assert.equal(A.kind('device'), 'device');
  assert.equal(A.kind('custom-1'), 'custom');
});
