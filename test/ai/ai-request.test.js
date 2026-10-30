// The AI harness's request model and JSON Schema subset (lib/ai/request.js, lib/ai/schema.js): one request and one result
// for every provider, cleaners that refuse rather than cut, and the check every model answer goes through.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/ai/request.js');
const S = require('../lib/ai/schema.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5d2a1e60000000049454e44ae426082', 'hex');
const user = (content) => ({ messages: [{ role: 'user', content }] });

test('a schema is taken only when every keyword is in the subset the validator reads', () => {
  const ok = { type: 'object', properties: { name: { type: 'string', minLength: 1, pattern: '^\\w' }, n: { type: ['integer', 'null'], minimum: 0 }, tags: { type: 'array', items: { enum: ['a', 'b'] }, maxItems: 3 } }, required: ['name'], additionalProperties: false, description: 'x' };
  assert.equal(S.clean(ok), ok);
  for (const bad of [
    { type: 'object', format: 'date' }, // a keyword it doesn't read
    { type: 'object', properties: { a: { $ref: '#/x' } } },
    { type: 'thing' },
    { type: 'string', pattern: '(' },
    { type: 'object', additionalProperties: { type: 'string' } },
    { type: 'object', required: ['a', 'a'] },
    'object', null, [],
  ]) assert.equal(S.clean(bad), null, JSON.stringify(bad));
  let deep = { type: 'string' };
  for (let i = 0; i < 20; i++) deep = { type: 'array', items: deep };
  assert.equal(S.clean(deep), null, 'too deep');
});

test('validate says what does not fit, with the path, and accepts what does', () => {
  const s = { type: 'object', properties: { name: { type: 'string', maxLength: 3 }, n: { type: 'integer', maximum: 5 }, list: { type: 'array', items: { type: 'number' } }, k: { anyOf: [{ type: 'string' }, { type: 'null' }] }, c: { const: 'x' } }, required: ['name'], additionalProperties: false };
  assert.deepEqual(S.validate({ name: 'ab', n: 5, list: [1, 2.5], k: null, c: 'x' }, s), []);
  const errors = S.validate({ n: 6.5, list: [1, 'two'], k: 3, extra: 1, c: 'y' }, s);
  for (const want of ['$: missing name', '$.n: expected integer, got number', '$.list[1]: expected number, got string', '$.k: fits none of anyOf', '$: unexpected extra', '$.c: not the constant']) assert.ok(errors.includes(want), `${want} in ${JSON.stringify(errors)}`);
  assert.deepEqual(S.validate('abcd', { type: 'string', maxLength: 3 }), ['$: longer than 3']);
  assert.deepEqual(S.validate('😀😀😀', { type: 'string', maxLength: 3 }), [], 'lengths are in characters, not UTF-16 units');
  assert.ok(S.validate(Array(100).fill('x'), { type: 'array', items: { type: 'number' } }).length <= S.LIMIT.errors);
});

test('strict() is true only for schemas OpenAI-style strict output can take as they are', () => {
  assert.equal(S.strict({ type: 'object', properties: { a: { type: 'string' }, b: { type: ['string', 'null'] } }, required: ['a', 'b'], additionalProperties: false }), true);
  assert.equal(S.strict({ type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false }), false);
  assert.equal(S.strict({ type: 'object', properties: { a: { type: 'object', properties: {} } }, required: ['a'], additionalProperties: false }), false, 'an inner object left open');
  assert.equal(S.strict({ type: 'array', items: { type: 'string' } }), false, 'the root is an object');
});

test('parse reads a JSON answer as Rimeward\'s askJson does: first { to last }, an object only', () => {
  assert.deepEqual(S.parse(' {"a":1} '), { a: 1 });
  assert.deepEqual(S.parse('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(S.parse('Sure! {"a":{"b":2}} Hope that helps.'), { a: { b: 2 } });
  assert.equal(S.parse('[1, 2]'), undefined);
  assert.equal(S.parse('no JSON'), undefined);
  assert.equal(S.parse(42), undefined);
  assert.deepEqual(S.obj({ a: S.str('A.') }, ['a']), { type: 'object', properties: { a: { type: 'string', description: 'A.' } }, required: ['a'], additionalProperties: false });
});

test('a request is cleaned to its one form: string content to a text part, bytes to base64 checked against the mime', () => {
  const r = R.clean({ messages: [{ role: 'system', content: 'Be brief.' }, { role: 'user', content: [{ type: 'text', text: 'What is this?' }, { type: 'image', mime: 'image/png', data: new Uint8Array(PNG) }] }], maxTokens: 100, temperature: 0 });
  assert.deepEqual(r.messages[0], { role: 'system', content: [{ type: 'text', text: 'Be brief.' }] });
  assert.deepEqual(r.messages[1].content[1], { type: 'image', mime: 'image/png', data: PNG.toString('base64') });
  assert.equal(R.images(r), 1);
  assert.equal(JSON.stringify(r).includes('"0":'), false, 'plain JSON: it crosses a port as it is');
  assert.deepEqual(R.clean(user([{ type: 'image', mime: 'image/png', data: PNG.toString('base64') }])).messages[0].content[0].data, PNG.toString('base64'));
});

test('a request refuses anything outside its limits or its shape, rather than cutting it', () => {
  const big = 'x'.repeat(R.LIMIT.text + 1);
  for (const [why, bad] of [
    ['no user message', { messages: [{ role: 'system', content: 'x' }] }],
    ['unknown key', { ...user('hi'), stream: true }],
    ['unknown message key', { messages: [{ role: 'user', content: 'hi', name: 'x' }] }],
    ['unknown role', { messages: [{ role: 'developer', content: 'hi' }, { role: 'user', content: 'hi' }] }],
    ['a part over its limit', user(big)],
    ['all text over its limit', { messages: Array.from({ length: 3 }, () => ({ role: 'user', content: 'x'.repeat(R.LIMIT.text) })) }],
    ['too many messages', { messages: Array.from({ length: R.LIMIT.messages + 1 }, () => ({ role: 'user', content: 'x' })) }],
    ['too many pictures', user(Array.from({ length: R.LIMIT.images + 1 }, () => ({ type: 'image', mime: 'image/png', data: PNG.toString('base64') })))],
    ['a picture whose bytes are not its mime', user([{ type: 'image', mime: 'image/jpeg', data: PNG.toString('base64') }])],
    ['a picture of another type', user([{ type: 'image', mime: 'image/svg+xml', data: PNG.toString('base64') }])],
    ['not base64', user([{ type: 'image', mime: 'image/png', data: 'not base64!' }])],
    ['a picture in a system message', { messages: [{ role: 'system', content: [{ type: 'image', mime: 'image/png', data: PNG.toString('base64') }] }, { role: 'user', content: 'x' }] }],
    ['a tool answer with no call before it', { messages: [{ role: 'user', content: 'x' }, { role: 'tool', toolCallId: 'c1', content: 'x' }] }],
    ['maxTokens over', { ...user('x'), maxTokens: R.LIMIT.maxTokens + 1 }],
    ['temperature out of range', { ...user('x'), temperature: 3 }],
    ['a timeout too short', { ...user('x'), timeoutMs: 10 }],
    ['an effort it does not know', { ...user('x'), effort: 'max' }],
    ['an effort that is not a word', { ...user('x'), effort: 1 }],
    ['a schema outside the subset', { ...user('x'), schema: { type: 'object', format: 'x' } }],
    ['a schema that is not an object at its root', { ...user('x'), schema: { type: 'array' } }],
    ['a tool name a server refuses', { ...user('x'), tools: [{ name: 'courses.list', description: 'd', parameters: { type: 'object' } }] }],
    ['two tools of one name', { ...user('x'), tools: [{ name: 'a', description: 'd', parameters: { type: 'object' } }, { name: 'a', description: 'd', parameters: { type: 'object' } }] }],
  ]) assert.equal(R.clean(bad), null, why);
});

test('an effort is one of EFFORTS, kept as it is; the mock provider runs with it and the request it sees holds it', async () => {
  for (const effort of R.EFFORTS) assert.equal(R.clean({ ...user('x'), effort }).effort, effort);
  assert.deepEqual(R.EFFORTS, ['none', 'minimal', 'low', 'medium', 'high']);
  const P = require('../lib/ai/providers.js');
  require('../lib/ai/providers/mock.js');
  const seen = [];
  assert.equal((await P.run('mock', { ...user('x'), effort: 'none' }, { replies: [{ text: 'ok' }], seen })).text, 'ok');
  assert.equal(seen[0].effort, 'none');
});

test('a conversation with tool calls keeps each answer after its call', () => {
  const r = R.clean({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: [], toolCalls: [{ id: 'c1', name: 'a', args: { q: 1 } }] }, { role: 'tool', toolCallId: 'c1', content: '{"data":1}' }],
    tools: [{ name: 'a', description: 'd', parameters: { type: 'object', properties: { q: { type: 'number' } } } }] });
  assert.deepEqual(r.messages[1].toolCalls, [{ id: 'c1', name: 'a', args: { q: 1 } }]);
  assert.equal(r.messages[2].toolCallId, 'c1');
  assert.equal(R.clean({ messages: [{ role: 'user', content: 'x' }, { role: 'user', content: [], toolCalls: [{ id: 'c1', name: 'a', args: {} }] }] }), null, 'only an assistant calls');
});

test('a result is one shape whatever the provider, and errors are codes', () => {
  assert.deepEqual(R.result({ text: 'hi', provider: 'p', model: 'm', finish: 'stop', usage: { input: 3, cached: 1, output: 1, junk: 5 } }), { text: 'hi', provider: 'p', model: 'm', finish: 'stop', usage: { input: 3, cached: 1, output: 1 } });
  assert.equal(R.result({ text: 'hi', provider: 'p', finish: 'done' }), null);
  assert.equal(R.result({ text: 5, provider: 'p', finish: 'stop' }), null);
  const e = R.error('setup', 'why');
  assert.equal(e.code, 'setup');
  assert.equal(R.code({ category: 'provider-unavailable' }), 'provider-unavailable');
  assert.equal(R.error('whatever').code, 'failed');
  assert.equal(R.code(new DOMException('x', 'TimeoutError')), 'timeout');
  assert.equal(R.code(new DOMException('x', 'AbortError')), 'cancelled');
  assert.equal(R.code(new Error('boom')), 'failed');
});

test('an image within the base64 limit is accepted without exhausting the regex stack', () => {
  const bytes = Buffer.alloc(R.LIMIT.image * 3 / 4);
  PNG.copy(bytes);
  const data = bytes.toString('base64');
  assert.equal(data.length, R.LIMIT.image);
  const cleaned = R.clean(user([{ type: 'image', mime: 'image/png', data }]));
  assert.ok(cleaned);
  assert.equal(cleaned.messages[0].content[0].data, data);
  for (const bad of [data.slice(0, -1), data.slice(0, -4) + '=AAA', data.slice(0, -4) + 'A===']) {
    assert.equal(R.clean(user([{ type: 'image', mime: 'image/png', data: bad }])), null);
  }
});

test('request and result tool-call IDs must be strings, never coerced values', () => {
  for (const id of [undefined, null, 123, true]) {
    const toolCalls = [{ id, name: 'a', args: {} }];
    assert.equal(R.clean({ messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: [], toolCalls }] }), null, `request ID ${String(id)}`);
    assert.equal(R.result({ provider: 'p', finish: 'tool', toolCalls }), null, `result ID ${String(id)}`);
  }
});


test('only a boolean cache marker is accepted on neutral text parts', () => {
  const marked = { type: 'text', text: 'stable', cache: true };
  assert.deepEqual(R.clean(user([marked])).messages[0].content, [marked]);
  for (const cache of [false, 'ephemeral', {}, null]) assert.equal(R.clean(user([{ ...marked, cache }])), null);
  assert.equal(R.clean(user([{ ...marked, extra: 1 }])), null);
});
