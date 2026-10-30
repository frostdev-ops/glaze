// The AI harness's stream primitives (lib/ai/stream.js) and the openai provider's stream assembly (chatStream), with the
// cases ported from Rimeward's tests/agent-providers.test.ts (MIT): framing across chunk boundaries, multi-line data,
// comments, a final flush; a tool call rebuilt from its pieces; a stream that ends before it finishes.
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../lib/ai/stream.js');
const O = require('../lib/ai/providers/openai.js');

test('sseParser frames across chunk boundaries, joins multi-line data, skips comments, flushes on finish', () => {
  const got = [];
  const p = ST.sseParser((d) => got.push(d));
  p.push('data: {"a":1}\r');
  p.push('\n\r\ndata: x\ndata: y\n\n: keepalive\n\ndata: [DONE]\n\n');
  assert.deepEqual(got, ['{"a":1}', 'x\ny', '[DONE]']);
  p.push('data: tail');
  p.finish();
  assert.deepEqual(got.at(-1), 'tail');
  assert.throws(() => ST.sseParser(() => {}).push('x'.repeat(16000001)), /too large/);
});

test('readSse reads a body to its end in any pieces, and a cancel stops it', async () => {
  const body = (text, cut) => { const b = new TextEncoder().encode(text); return new ReadableStream({ start(c) { for (let i = 0; i < b.length; i += cut) c.enqueue(b.slice(i, i + cut)); c.close(); } }); };
  for (const cut of [1, 3, 64]) {
    const got = [];
    let ticks = 0;
    await ST.readSse(body('data: é1\r\n\r\ndata: 2\n\ndata: 3', cut), (d) => got.push(d), () => ticks++);
    assert.deepEqual(got, ['é1', '2', '3'], `cut ${cut}`);
    assert.ok(ticks > 0);
  }
  const c = new AbortController();
  const hang = new ReadableStream({ pull() { return new Promise(() => {}); } });
  const p = ST.readSse(hang, () => {}, undefined, c.signal);
  c.abort(new DOMException('stop', 'AbortError'));
  await assert.rejects(p, { name: 'AbortError' });
});

test('thinkingCounter counts plain reasoning at four bytes a token, and a provider\'s count replaces it', () => {
  const seen = [];
  const t = ST.thinkingCounter((x) => seen.push(x));
  t.text('abcdefgh');
  t.text('', true);
  t.usage(42);
  t.usage(-1);
  assert.deepEqual(seen, [{ tokens: 2, estimated: true }, { tokens: 42, estimated: false }]);
});

test('chatStream rebuilds a streamed tool call and refuses an unfinished stream', () => {
  const seen = [];
  const s = O.chatStream((d) => seen.push(d));
  s.push({ choices: [{ delta: { content: 'Hel' } }] });
  s.push({ choices: [{ delta: { content: 'lo', tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_layout', arguments: '{"wa' } }] } }] });
  // Some servers repeat the whole name on every chunk; only the arguments accumulate.
  s.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'get_layout', arguments: 'rd":"w1"}' } }] } }] });
  assert.throws(() => s.result(), /ended before completion/);
  s.push({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 3 } });
  const r = s.result();
  assert.deepEqual(seen, ['Hel', 'lo']);
  assert.equal(r.choices[0].message.content, 'Hello');
  assert.deepEqual(r.choices[0].message.tool_calls, [{ id: 'c1', type: 'function', function: { name: 'get_layout', arguments: '{"ward":"w1"}' } }]);
  assert.equal(r.usage.prompt_tokens, 3);
  // Glaze returns `length` as the finish instead of throwing (a schema task treats it as a refusal); anything else unknown throws.
  const cut = O.chatStream();
  cut.push({ choices: [{ delta: { content: 'x' }, finish_reason: 'length' }] });
  assert.equal(cut.result().choices[0].finish_reason, 'length');
  assert.throws(() => O.chatStream().push({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }), /Incomplete response/);
  // A call missing its id, arguments that are not JSON, a bad index, an error chunk.
  const noId = O.chatStream();
  noId.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'x', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] });
  assert.throws(() => noId.result(), /Incomplete streamed tool call/);
  const badArgs = O.chatStream();
  badArgs.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'x', arguments: '{"a":' } }] }, finish_reason: 'tool_calls' }] });
  assert.throws(() => badArgs.result(), SyntaxError);
  assert.throws(() => O.chatStream().push({ choices: [{ delta: { tool_calls: [{ index: -1 }] } }] }), /Invalid streamed tool index/);
  assert.throws(() => O.chatStream().push({ error: { message: 'upstream overloaded', code: 503 } }), (e) => e.status === 503);
});

test('the wire converters: neutral messages to Chat Completions and back', () => {
  assert.deepEqual(O.toWire({ role: 'assistant', content: [], toolCalls: [{ id: 'c1', name: 'a', args: { q: 1 } }] }), { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'a', arguments: '{"q":1}' } }] });
  assert.deepEqual(O.toWire({ role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '{"data":1}' }] }), { role: 'tool', tool_call_id: 'c1', content: '{"data":1}' });
  assert.deepEqual(O.fromWire({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], tool_calls: [{ id: 'x', function: { name: 'n', arguments: '{bad' } }, { function: { name: 'no-id' } }] }),
    { text: 'ab', calls: [{ id: 'x', name: 'n', args: '{bad' }], refusal: '' });
});

test('the SSE frame cap includes accumulated data lines and terminated oversized lines', () => {
  const parser = ST.sseParser(() => {});
  assert.throws(() => {
    for (let i = 0; i < 17; i++) parser.push('data: ' + 'x'.repeat(1_000_000) + '\n');
    parser.push('\n');
  }, /too large|exceeds/i);
  assert.throws(() => ST.sseParser(() => {}).push('data: ' + 'x'.repeat(16_000_001) + '\n\n'), /too large|exceeds/i);
});

test('an SSE response made of many small frames has a cumulative byte bound', async () => {
  let cancelled = false, chunks = 0;
  const bytes = new TextEncoder().encode('data: ' + 'x'.repeat(1 << 20) + '\n\n');
  const body = new ReadableStream({
    pull(c) { if (++chunks <= 20) c.enqueue(bytes); else c.close(); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(ST.readSse(body, () => {}), /too large|exceeds/i);
  assert.ok(cancelled, 'the transport is cancelled as soon as the byte limit is hit');
});
