// The AI harness's failures, call record and connections (lib/ai/failure.js, lib/ai/endpoint.js), with cases ported from
// Rimeward's tests/agent-diagnostics.test.ts and accounts rules (MIT): a failure is a category with a reference and no
// payload; the record keeps the last 40 calls, metadata only; a key goes only over https or to this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/ai/failure.js');
const E = require('../lib/ai/endpoint.js');

test('model failures distinguish causes, keep a reference and carry no payload', () => {
  for (const [error, aborted, category] of [
    [Object.assign(new Error('secret payload'), { status: 503 }), false, 'provider-unavailable'],
    [Object.assign(new Error('secret payload'), { status: 401 }), false, 'request-rejected'],
    [Object.assign(new Error('secret payload'), { name: 'TimeoutError' }), false, 'timeout'],
    [new SyntaxError('secret payload'), false, 'invalid-response'],
    [{ category: 'invalid-response' }, false, 'invalid-response'],
    [new Error('secret payload'), false, 'connection-lost'],
    [Object.assign(new Error('secret payload'), { status: 503 }), true, 'cancelled'],
  ]) {
    const failure = F.modelFailure(error, { id: 'test-reference', aborted });
    assert.equal(failure.category, category);
    assert.equal(failure.code, category);
    assert.equal(failure.reference, 'test-reference');
    assert.match(failure.message, /test-reference/);
    assert.doesNotMatch(JSON.stringify({ ...failure, message: failure.message }), /secret payload/);
  }
  assert.equal(F.modelFailure(Object.assign(new Error('x'), { status: 503 })).status, 503);
  assert.match(F.modelFailure(new Error('x')).reference, /^[0-9a-f-]{36}$/);
  assert.ok(F.transient(429) && !F.transient(500) && !F.transient(503), 'only a rate limit is retried: a 5xx may have run the request');
});

test('the call record keeps the last 40 calls, metadata only', async () => {
  const data = {};
  const area = { get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (v) => Object.assign(data, structuredClone(v)) };
  for (let i = 0; i < 45; i++) await F.record(area, 'aiCalls', { id: `r${i}`, task: 't', state: 'completed', prompt: 'secret payload', key: 'sk-x', base: 'https://x' });
  assert.equal(data.aiCalls.length, 40);
  assert.equal(data.aiCalls[0].id, 'r5');
  assert.doesNotMatch(JSON.stringify(data.aiCalls), /secret payload|sk-x|https/);
  await F.record(area, 'aiCalls', { id: 'r44', state: 'failed' });
  assert.equal(data.aiCalls.filter((r) => r.id === 'r44').length, 1, 'a row is replaced by its id');
  await F.record({ get: async () => { throw new Error('down'); } }, 'aiCalls', { id: 'x' }); // never throws
});

test('bounded refuses a body past its limit; anySignal aborts with the first reason', async () => {
  assert.equal(await F.bounded(new Response('hello')), 'hello');
  await assert.rejects(F.bounded(new Response('x'.repeat(100)), 10), /exceeds/);
  const a = new AbortController(), b = new AbortController();
  const both = F.anySignal([a.signal, undefined, b.signal]);
  b.abort('second');
  assert.equal(both.signal.reason, 'second');
  both.done();
  const t = F.deadline(5);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(t.signal.reason.name, 'TimeoutError');
});

test('an endpoint address: https, or http only to this computer; no credentials, query or fragment; one sentence why not', () => {
  assert.equal(E.parse(' https://api.example.com/v1/ '), 'https://api.example.com/v1');
  assert.equal(E.parse('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(E.parse('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1');
  for (const [raw, why] of [['api.example.com', /full address/], ['ftp://x.com', /https/], ['http://192.168.1.5:1234/v1', /must use https/], ['http://evil.example.com', /must use https/],
    ['https://u:p@x.com/v1', /key field/], ['https://x.com/v1?k=1', /\? or #/], ['https://x.com/v1#a', /\? or #/]]) assert.throws(() => E.parse(raw), why, raw);
  assert.equal(E.clean('http://192.168.1.5/v1'), null);
  assert.equal(E.normalize('HTTPS://API.Example.com:443/v1/'), 'https://api.example.com/v1');
  assert.equal(E.normalize('http://localhost:11434/v1'), 'http://localhost:11434/v1');
  assert.equal(E.mask('sk-1234567890abcdef'), 'sk-1••••cdef');
  assert.equal(E.mask('short'), '••••');
  assert.ok(E.ID.test('my-ollama') && !E.ID.test('My Ollama') && !E.ID.test('-x') && !E.ID.test('x'.repeat(41)));
  assert.notEqual(E.generation(), E.generation());
});

test('waiting races cancellation, skips already-cancelled work and handles late failures', async () => {
  const c = new AbortController();
  let rejectLate, started = 0;
  const pending = F.wait(() => { started++; return new Promise((_, reject) => { rejectLate = reject; }); }, c.signal);
  c.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(pending, { name: 'AbortError' });
  rejectLate(new Error('late failure'));
  await assert.rejects(F.wait(() => { started++; }, c.signal), { name: 'AbortError' });
  await assert.rejects(F.wait(Promise.reject(new Error('already started')), c.signal), { name: 'AbortError' });
  await new Promise(setImmediate);
  assert.equal(started, 1);
  assert.equal(await F.wait(() => 42), 42);
});
