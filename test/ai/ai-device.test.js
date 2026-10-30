// The AI harness's `device` provider (lib/ai/providers/device.js): Chrome's Prompt API (LanguageModel, Chrome on-device AI) in the
// worker, against a stand-in LanguageModel: availability → status, a download with progress, a request mapped to a session
// (system prompt, history, pictures, a schema as responseConstraint, temperature only with topK), deltas streamed, a cancel,
// input over the context window refused before it is sent, every session destroyed, the broker's prepare and test, and
// warm sessions prompted through clone().
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/ai/providers.js');
const B = require('../lib/ai/broker.js');
const T = require('../lib/ai/task.js');
const S = require('../lib/ai/schema.js');
const A = require('../lib/ai/settings.js');
const D = require('../lib/ai/providers/device.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
const SCHEMA = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const req = (extra = {}) => ({ messages: [{ role: 'system', content: 'Answer as {"text": ...}.' }, { role: 'user', content: 'hello' }], schema: SCHEMA, ...extra });
const quotaError = () => Object.assign(new Error('too large'), { name: 'QuotaExceededError' });

// A stand-in for Chrome's LanguageModel. avail: what availability() says (by 'text' or 'image' when they differ); window,
// used: the session's context window and what its initial prompts took; cost(input): tokens measured for an input;
// chunks: the answer, streamed as deltas; legacy: Chrome 138's names (inputQuota, inputUsage, measureInputUsage); clone:
// sessions have clone() (a create logged with cloned: true, and the signal it was given).
const stub = ({ avail = 'available', imageAvail, window = 1000, used = 10, cost = () => 20, chunks = ['{"text":', '"ok"}'], legacy = false, params = { defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2 },
  promptError, overflow = false, gate, availabilityError, createError, progress = [0, 0.5, 1], clone = false, streaming = true } = {}) => {
  const log = { availability: [], create: [], prompts: [], measured: [], destroyed: 0, sessions: 0, streams: [], streamReads: 0, streamCancels: 0, bases: () => log.create.filter((c) => !c.cloned) };
  const LM = {
    availability: async (o = {}) => {
      log.availability.push(structuredClone(o));
      if (availabilityError) throw availabilityError;
      return o.expectedInputs?.some((i) => i.type === 'image') && imageAvail ? imageAvail : avail;
    },
    create: async (o = {}) => {
      const { monitor, signal, ...rest } = o;
      log.create.push({ ...rest, monitor: typeof monitor, signal: !!signal });
      if (signal?.aborted) throw signal.reason;
      if (createError) throw createError;
      if (monitor) {
        const m = new EventTarget();
        monitor(m);
        await new Promise(setImmediate); // Chrome reports progress after create() returns its promise
        for (const loaded of avail === 'available' ? [] : progress) m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 }));
      }
      log.sessions++;
      const s = new EventTarget();
      const measure = async (input, opts) => { log.measured.push({ input, opts }); return cost(input, opts); };
      Object.assign(s, legacy ? { inputQuota: window, inputUsage: used, measureInputUsage: measure } : { contextWindow: window, contextUsage: used, measureContextUsage: measure });
      s.destroy = () => { log.destroyed++; s.gone = true; };
      if (clone) s.clone = async (o = {}) => { if (s.gone) throw new DOMException('destroyed', 'InvalidStateError'); return LM.create({ ...rest, cloned: true, ...(o.signal && { signal: o.signal }) }); };
      const answer = async (input, opts = {}) => {
        log.prompts.push({ input, opts: { ...opts, signal: !!opts.signal } });
        if (overflow) s.dispatchEvent(new Event(legacy ? 'quotaoverflow' : 'contextoverflow'));
        if (promptError) throw promptError;
        if (gate) await gate(opts.signal);
        if (opts.signal?.aborted) throw opts.signal.reason;
      };
      s.prompt = async (input, opts) => { await answer(input, opts); return chunks.join(''); };
      if (streaming) s.promptStreaming = (input, opts = {}) => {
        let i = 0, started = null;
        const stream = new ReadableStream({
          async pull(c) {
            log.streamReads++;
            started ||= answer(input, opts);
            await started;
            if (opts.signal?.aborted) return c.error(opts.signal.reason);
            if (i < chunks.length) c.enqueue(chunks[i++]); else c.close();
          },
          cancel() { log.streamCancels++; },
        }, { highWaterMark: 0 });
        log.streams.push(stream); return stream;
      };
      return s;
    },
    ...(params !== null && { params: async () => params }),
    ...(clone && { prototype: { clone() {} } }),
  };
  return { LM, log };
};
const install = (s) => { globalThis.LanguageModel = s.LM; return s; };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
test.beforeEach(() => { delete globalThis.LanguageModel; D._reset(); B._reset(); });
test.after(() => { delete globalThis.LanguageModel; });

test('the device provider is registered, and a connection may use it', () => {
  assert.equal(P.get('device'), D);
  assert.ok(A.PROVIDERS.includes('device'));
  assert.deepEqual(D.config({}), { model: 'gemini-nano' });
  assert.deepEqual(D.config({ generation: 'gen-1' }), { model: 'gemini-nano', generation: 'gen-1' });
  assert.equal(D.config({ base: 'https://x.example/v1' }), null, 'nothing an endpoint has');
  assert.equal(D.config({ key: 'sk-x' }), null, 'never a key');
  assert.equal(D.origin, undefined, 'it sends nothing over the network');
});

test('status: no Prompt API, an unsupported device, a model to download, downloading, ready', async () => {
  assert.deepEqual(await D.status({}), { state: 'unavailable', reason: 'browser' }, 'Firefox, Safari, Chrome before 138');
  for (const [avail, want] of [['unavailable', { state: 'unavailable', reason: 'device' }], ['downloadable', { state: 'download' }], ['downloading', { state: 'downloading' }], ['available', { state: 'ready', caps: { images: true } }]]) {
    install(stub({ avail }));
    assert.deepEqual(await D.status({}), want, avail);
  }
  install(stub({ availabilityError: new Error('boom') }));
  assert.deepEqual(await D.status({}), { state: 'unavailable', reason: 'failed' });
  install(stub({ avail: 'nonsense' }));
  assert.deepEqual(await D.status({}), { state: 'unavailable', reason: 'failed' });
});

test('caps: text, JSON and streaming; pictures and context only when known; tools never claimed', () => {
  assert.deepEqual(D.caps({ model: 'gemini-nano' }), { text: true, json: true, stream: true, local: true });
  assert.deepEqual(D.caps({ model: 'gemini-nano', images: true, context: 900 }), { text: true, json: true, stream: true, local: true, images: true, context: 900 });
  assert.equal('tools' in D.caps({}), false);
});

test('a request becomes a session: the system prompt first, the student\'s message prompted with the schema, the session destroyed', async () => {
  const { log } = install(stub());
  const out = await P.run('device', req({ temperature: 0.2 }), {});
  assert.deepEqual(out.json, { text: 'ok' });
  assert.equal(out.model, 'gemini-nano');
  assert.equal(out.provider, 'device');
  assert.equal(out.finish, 'stop');
  assert.deepEqual(out.usage, { input: 30 }, 'what the initial prompts took plus the measured prompt');
  assert.deepEqual(log.create[0].initialPrompts, [{ role: 'system', content: 'Answer as {"text": ...}.' }]);
  assert.equal(log.create[0].temperature, 0.2);
  assert.equal(log.create[0].topK, 3, 'temperature only with topK (extensions take both or neither)');
  assert.equal(log.prompts[0].input[0].role, 'user');
  assert.deepEqual(log.prompts[0].input[0].content[0], { type: 'text', value: 'hello' });
  assert.equal(log.prompts[0].input[0].content.length, 2, 'the schema guidance accompanies the original user content');
  assert.equal(log.prompts[0].opts.omitResponseConstraintInput, true);
  assert.deepEqual(log.prompts[0].opts.responseConstraint, SCHEMA);
  assert.equal(log.prompts[0].opts.signal, true);
  assert.deepEqual(log.measured[0].opts.responseConstraint, SCHEMA, 'measured with the schema it will carry');
  assert.equal(log.destroyed, log.sessions);
  assert.deepEqual(log.availability.at(-1).expectedInputs, [{ type: 'text' }]);
});

test('without params() no sampling settings are sent; a temperature over the maximum is held to it', async () => {
  let s = install(stub({ params: null }));
  await P.run('device', req({ temperature: 0.5 }), {});
  assert.ok(!('temperature' in s.log.create[0]) && !('topK' in s.log.create[0]));
  s = install(stub({ params: { defaultTopK: 3, maxTopK: 8, defaultTemperature: 1, maxTemperature: 1.5 } }));
  await P.run('device', req({ temperature: 2 }), {});
  assert.equal(s.log.create[0].temperature, 1.5);
  s = install(stub());
  await P.run('device', req(), {});
  assert.ok(!('temperature' in s.log.create[0]), 'none asked, none sent');
});

test('a reasoning effort is not the Prompt API\'s: nothing of it reaches the session', async () => {
  const s = install(stub());
  assert.deepEqual((await P.run('device', req({ effort: 'none' }), {})).json, { text: 'ok' });
  assert.equal(JSON.stringify([s.log.create, s.log.prompts, s.log.measured]).includes('effort'), false);
});

test('deltas stream to onDelta and make up the answer', async () => {
  const { log } = install(stub({ chunks: ['{"te', 'xt":"str', 'eamed"}'] }));
  const seen = [];
  const out = await P.run('device', req(), {}, { onDelta: (t) => seen.push(t) });
  assert.deepEqual(seen, ['{"te', 'xt":"str', 'eamed"}']);
  assert.deepEqual(out.json, { text: 'streamed' });
  assert.equal(log.destroyed, 1);
});

test('schema output has an internal UTF-8 byte cutoff that discards partial JSON, cancels and never replays', async () => {
  for (const chunks of [['{"text":"', 'é'.repeat(28), 'unread tail', '"}'], ['{"text":"ok"}', ' '.repeat(52), 'unread tail']]) for (const external of [false, true]) {
    const s = install(stub({ chunks })), seen = [];
    const failure = await P.run('device', req({ maxTokens: 16 }), {}, external ? { onDelta: (delta) => seen.push(delta) } : {}).catch((e) => e);
    assert.equal(failure.code, 'request-rejected');
    assert.equal(failure.reason, 'response-limit');
    assert.equal(failure.phase, 'response');
    assert.deepEqual([failure.actual, failure.limit], [65, 64], 'the cutoff counts UTF-8 bytes, not JavaScript characters or native output tokens');
    assert.deepEqual([failure.tokens, failure.context], [30, 1000]);
    assert.equal('text' in failure, false);
    assert.deepEqual(seen, [], 'bounded schema output is held until the completed response fits');
    assert.equal(s.log.streams.length, 1, 'schema tasks stream internally even without a UI delta callback');
    assert.equal(s.log.streamReads, 2, 'nothing after the over-budget chunk is requested');
    assert.equal(s.log.streamCancels, 1);
    assert.equal(s.log.streams[0].locked, false);
    assert.equal(s.log.prompts.length, 1, 'the provider does not replay the failed request');
    assert.equal(s.log.destroyed, 1);
  }
});

test('schema byte accounting joins split UTF-16 surrogate pairs before encoding the output', async () => {
  const s = install(stub({ chunks: ['{"text":"', '\ud83d', '\ude00', '"}'] })), seen = [];
  const out = await P.run('device', req({ maxTokens: 4 }), {}, { onDelta: (delta) => seen.push(delta) });
  assert.deepEqual(out.json, { text: '😀' });
  assert.equal(Buffer.byteLength(out.text), 15, 'joined output fits the 16-byte estimate; separately encoded surrogate chunks would falsely exceed it');
  assert.equal(seen.join(''), out.text);
  assert.equal(s.log.streams.length, 1);
  assert.equal(s.log.destroyed, 1);
});

test('the exact sent compact JSON schema guidance is measured, with hidden schema input omitted', async () => {
  const schema = { ...SCHEMA, properties: { text: { type: 'string', maxLength: 32 }, tags: { type: 'array', maxItems: 1, items: { enum: ['known'] } } } };
  const input = req({ schema, maxTokens: 64 }), before = structuredClone(input);
  const s = install(stub({ window: 4096, cost: (prompt) => Math.ceil(Buffer.byteLength(JSON.stringify(prompt)) / 4) }));
  const out = await P.run('device', input, {}), sent = s.log.prompts[0], measured = s.log.measured[0];
  assert.equal(sent.opts.omitResponseConstraintInput, true);
  assert.equal(measured.opts.omitResponseConstraintInput, true);
  assert.deepEqual(sent.input, measured.input, 'the measurement includes every byte of the actual user prompt');
  assert.deepEqual(sent.opts.responseConstraint, schema);
  const text = sent.input[0].content.filter((part) => part.type === 'text').map((part) => part.value).join('\n');
  assert.equal(text.split(JSON.stringify(schema)).length - 1, 1, 'the full minified schema is explicit exactly once');
  assert.match(text, /compact JSON/);
  assert.match(text, /maxItems/);
  assert.match(text, /256.*UTF-8/);
  assert.equal(out.usage.input, 10 + Math.ceil(Buffer.byteLength(JSON.stringify(measured.input)) / 4));
  assert.deepEqual(input, before, 'provider guidance never mutates the task request');
});

test('without native streaming the completed schema answer is post-checked without claiming an inference cutoff', async () => {
  for (const length of [26, 27]) {
    const text = 'é'.repeat(length), answer = JSON.stringify({ text }), seen = [];
    const s = install(stub({ streaming: false, chunks: [answer] }));
    const result = await P.run('device', req({ maxTokens: 16 }), {}, { onDelta: (delta) => seen.push(delta) }).catch((e) => e);
    if (length === 26) {
      assert.deepEqual(result.json, { text });
      assert.deepEqual(seen, [answer]);
    } else {
      assert.equal(result.reason, 'response-limit');
      assert.equal(result.phase, 'response');
      assert.deepEqual([result.actual, result.limit], [65, 64]);
      assert.deepEqual([result.tokens, result.context], [30, 1000]);
      assert.deepEqual(seen, []);
    }
    assert.equal(s.log.streams.length, 0);
    assert.equal(s.log.prompts.length, 1, 'the fallback returns its whole answer before the app can check it');
    assert.equal(s.log.destroyed, 1);
  }
});

test('a schema cutoff disposes only its warm request generation and a later manual call gets a fresh base', async () => {
  const s = install(stub({ clone: true }));
  await assert.rejects(P.run('device', req({ maxTokens: 2 }), {}), { reason: 'response-limit' });
  await settle();
  assert.equal(s.log.bases().length, 1);
  assert.equal(s.log.prompts.length, 1);
  assert.equal(s.log.destroyed, 2, 'the failed clone and its own warm base are disposed');
  assert.deepEqual(s.log.bases()[0].initialPrompts, [{ role: 'system', content: 'Answer as {"text": ...}.' }], 'schema guidance stays on each request, outside the reusable base');
  assert.deepEqual((await P.run('device', req({ maxTokens: 16 }), {})).json, { text: 'ok' });
  assert.equal(s.log.bases().length, 2);
  assert.equal(s.log.prompts.length, 2, 'only the caller starts a second inference');
  D.release(); await settle();
  assert.equal(s.log.destroyed, s.log.sessions);
});

test('history goes in as initial prompts; pictures go as Blobs of their type, asked for in availability and create', async () => {
  const { log } = install(stub());
  const msgs = [{ role: 'system', content: 'Read it.' }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'noted' },
    { role: 'user', content: [{ type: 'text', text: 'this one' }, { type: 'image', mime: 'image/png', data: PNG }] }];
  await P.run('device', { messages: msgs }, { images: true });
  assert.deepEqual(log.create[0].initialPrompts, [{ role: 'system', content: 'Read it.' }, { role: 'user', content: [{ type: 'text', value: 'first' }] }, { role: 'assistant', content: [{ type: 'text', value: 'noted' }] }]);
  const [text, image] = log.prompts[0].input[0].content;
  assert.deepEqual(text, { type: 'text', value: 'this one' });
  assert.equal(image.type, 'image');
  assert.ok(image.value instanceof Blob);
  assert.equal(image.value.type, 'image/png');
  assert.deepEqual(Buffer.from(await image.value.arrayBuffer()).toString('base64'), PNG);
  assert.deepEqual(log.create[0].expectedInputs, [{ type: 'text' }, { type: 'image' }]);
  assert.ok(log.availability.some((o) => o.expectedInputs?.some((i) => i.type === 'image')));
});

test('a picture on a device that can\'t take one is refused as caps, before a session', async () => {
  const { log } = install(stub({ imageAvail: 'unavailable' }));
  const msgs = [{ role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image', mime: 'image/png', data: PNG }] }];
  await assert.rejects(P.run('device', { messages: msgs }, {}), { code: 'caps' });
  assert.equal(log.sessions, 0);
});

test('tools are not faked: a request with tools or tool turns is refused as caps; one that ends on the model\'s turn, as request', async () => {
  install(stub());
  const tools = [{ name: 'courses_list', description: 'List.', parameters: { type: 'object', properties: {}, additionalProperties: false } }];
  await assert.rejects(P.run('device', req({ tools }), {}), { code: 'caps' });
  const turns = [{ role: 'user', content: 'go' }, { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'courses_list', args: {} }] }, { role: 'tool', toolCallId: 'c1', content: '[]' }];
  await assert.rejects(P.run('device', { messages: turns }, {}), { code: 'caps' });
  await assert.rejects(P.run('device', { messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'so' }] }, {}), { code: 'request' });
});

test('input over the context window is refused before it is sent, never cut; the session is destroyed', async () => {
  let s = install(stub({ window: 100, used: 40, cost: () => 61 }));
  const e = await P.run('device', req(), {}).catch((x) => x);
  assert.equal(e.code, 'request-rejected');
  assert.equal(e.reason, 'context');
  assert.equal(e.phase, 'measure');
  assert.deepEqual([e.tokens, e.context], [101, 100]);
  assert.ok(e.reference);
  assert.equal(s.log.prompts.length, 0, 'nothing prompted');
  assert.equal(s.log.destroyed, 1);
  // Chrome 138's names.
  s = install(stub({ legacy: true, window: 100, used: 40, cost: () => 61 }));
  assert.equal((await P.run('device', req(), {}).catch((x) => x)).code, 'request-rejected');
  assert.equal(s.log.prompts.length, 0);
  s = install(stub({ legacy: true, window: 100, used: 40, cost: () => 50 }));
  assert.deepEqual((await P.run('device', req(), {})).json, { text: 'ok' });
  // Initial prompts that don't fit, and the API's own refusal.
  s = install(stub({ createError: quotaError() }));
  const initial = await P.run('device', req(), {}).catch((x) => x);
  assert.equal(initial.code, 'request-rejected');
  assert.equal(initial.reason, 'context');
  assert.equal(initial.phase, 'create');
  assert.equal(initial.tokens, undefined, 'a failed create supplied no native input measurement');
  assert.equal(initial.context, undefined, 'a failed create supplied no native session window');
  s = install(stub({ promptError: quotaError() }));
  assert.equal((await P.run('device', req(), {}).catch((x) => x)).code, 'request-rejected');
  assert.equal(s.log.destroyed, 1);
});

test('a session that drops earlier turns to fit is a refusal, not an answer', async () => {
  const s = install(stub({ overflow: true }));
  assert.equal((await P.run('device', req(), {}).catch((x) => x)).code, 'request-rejected');
  assert.equal(s.log.destroyed, 1);
  const l = install(stub({ overflow: true, legacy: true }));
  assert.equal((await P.run('device', req(), {}, { onDelta: () => {} }).catch((x) => x)).code, 'request-rejected');
  assert.equal(l.log.destroyed, 1);
});

test('native context overflow after fitting input measurement reports response phase without inventing output counts', async () => {
  for (const legacy of [false, true]) for (const streaming of [false, true]) {
    const s = install(stub({ legacy, window: 100, used: 40, cost: () => 50, overflow: true }));
    const failure = await P.run('device', req(), {}, streaming ? { onDelta() {} } : {}).catch((e) => e);
    assert.equal(failure.category, 'request-rejected');
    assert.equal(failure.reason, 'response-context');
    assert.equal(failure.phase, 'response');
    assert.equal(failure.tokens, 90, 'only the measured input count is reported');
    assert.equal(failure.context, 100);
    assert.equal('output' in failure, false);
    assert.equal(s.log.measured.length, 1);
    assert.equal(s.log.prompts.length, 1, 'the failed native request is never replayed');
    assert.equal(s.log.sessions, 1);
    assert.equal(s.log.destroyed, 1);
  }
});

test('a native quota exception after fitting input measurement retains response-phase diagnostics without replay', async () => {
  for (const streaming of [false, true]) {
    const s = install(stub({ window: 100, used: 40, cost: () => 50, promptError: quotaError() }));
    const failure = await P.run('device', req(), {}, streaming ? { onDelta() {} } : {}).catch((e) => e);
    assert.equal(failure.reason, 'response-context');
    assert.equal(failure.phase, 'response');
    assert.deepEqual([failure.tokens, failure.context], [90, 100]);
    assert.equal('output' in failure, false);
    assert.equal(s.log.measured.length, 1);
    assert.equal(s.log.prompts.length, 1);
    assert.equal(s.log.destroyed, s.log.sessions);
  }
});

test('a cancel ends the prompt, nothing late comes through, and the session is destroyed', async () => {
  let release;
  const s = install(stub({ gate: (signal) => new Promise((resolve, reject) => { release = resolve; signal?.addEventListener('abort', () => reject(signal.reason), { once: true }); }) }));
  const c = new AbortController(), seen = [];
  const running = P.run('device', req(), {}, { signal: c.signal, onDelta: (t) => seen.push(t) });
  for (let i = 0; i < 20 && !release; i++) await new Promise(setImmediate);
  c.abort(new DOMException('Cancelled', 'AbortError'));
  assert.equal((await running.catch((x) => x)).code, 'cancelled');
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  assert.deepEqual(seen, []);
  assert.equal(s.log.destroyed, 1);
  // Cancelled before the session existed: none made.
  const t = install(stub());
  const c2 = new AbortController();
  c2.abort(new DOMException('Cancelled', 'AbortError'));
  assert.equal((await P.run('device', req(), {}, { signal: c2.signal }).catch((x) => x)).code, 'cancelled');
  assert.equal(t.log.sessions, 0);
});

test('no Prompt API, or no model yet: a run is provider-unavailable, and makes no session', async () => {
  assert.equal((await P.run('device', req(), {}).catch((x) => x)).code, 'provider-unavailable');
  for (const avail of ['unavailable', 'downloadable', 'downloading']) {
    const s = install(stub({ avail }));
    assert.equal((await P.run('device', req(), {}).catch((x) => x)).code, 'provider-unavailable', avail);
    assert.equal(s.log.sessions, 0, avail);
  }
});

test('native model execution failures retain fixed local reasons instead of reporting a lost connection', async () => {
  const privateText = 'private document text from the browser exception';
  for (const [name, code, reason] of [['OperationError', 'provider-unavailable', 'unknown'], ['UnknownError', 'provider-unavailable', 'unknown'],
    ['AbortError', 'provider-unavailable', 'unknown'], ['NotReadableError', 'request-rejected', 'guardrail'], ['QuotaExceededError', 'request-rejected', 'context']]) {
    for (const phase of ['create', 'measure', 'prompt', 'stream']) {
      const error = new DOMException(privateText, name);
      const s = install(stub({ ...(phase === 'create' ? { createError: error } : phase === 'measure' ? { cost: () => { throw error; } } : { promptError: error }) }));
      const failure = await P.run('device', req(), {}, phase === 'stream' ? { onDelta() {} } : {}).catch((e) => e);
      assert.equal(failure.code, code, `${name} during ${phase}`);
      assert.equal(failure.reason, name === 'QuotaExceededError' && ['prompt', 'stream'].includes(phase) ? 'response-context' : reason, `${name} during ${phase}`);
      if (name === 'QuotaExceededError') {
        assert.equal(failure.phase, ['prompt', 'stream'].includes(phase) ? 'response' : phase);
        assert.equal(failure.context, phase === 'create' ? undefined : 1000);
        assert.equal(failure.tokens, ['prompt', 'stream'].includes(phase) ? 30 : undefined);
      }
      assert.ok(failure.reference);
      assert.equal(JSON.stringify(failure).includes(privateText), false, 'native descriptions never enter a page response or Activity');
      assert.equal(s.log.destroyed, s.log.sessions, `${name} during ${phase}: every created session is destroyed`);
    }
  }
});

test('prepare downloads with progress, once for callers that ask together; the window learnt goes in the catalog', async () => {
  const s = install(stub({ avail: 'downloadable', window: 4096 }));
  const a = [], b = [];
  const [x, y] = await Promise.all([D.prepare({}, { onProgress: (p) => a.push(p) }), D.prepare({}, { onProgress: (p) => b.push(p) })]);
  assert.deepEqual(x, { state: 'ready' });
  assert.deepEqual(y, { state: 'ready' });
  assert.equal(s.log.create.length, 1, 'one download');
  assert.equal(s.log.create[0].monitor, 'function');
  assert.deepEqual(a, [0, 0.5, 1]);
  assert.deepEqual(b, [0, 0.5, 1]);
  assert.equal(s.log.destroyed, 1);
  s.LM.availability = async () => 'available';
  const c = await D.catalog({});
  assert.deepEqual(c.models, [{ id: 'gemini-nano', name: 'Chrome on-device AI', json: true, vision: true, context: { window: 4096, inputLimit: 3686 } }]);
  assert.equal(c.source, 'live');
  install(stub({ avail: 'unavailable' }));
  assert.deepEqual(await D.prepare({}), { state: 'unavailable', reason: 'device' });
  delete globalThis.LanguageModel;
  assert.deepEqual(await D.prepare({}), { state: 'unavailable', reason: 'browser' });
  install(stub({ avail: 'downloadable', createError: Object.assign(new Error('needs a click'), { name: 'NotAllowedError' }) }));
  assert.deepEqual(await D.prepare({}), { state: 'download', reason: 'activation' });
});

test('the catalog reads the window from a session when it isn\'t known yet, and says nothing it doesn\'t know', async () => {
  const s = install(stub({ window: 6144, imageAvail: 'unavailable' }));
  const c = await D.catalog({});
  assert.deepEqual(c.models, [{ id: 'gemini-nano', name: 'Chrome on-device AI', json: true, vision: false, context: { window: 6144, inputLimit: 5529 } }]);
  assert.equal(s.log.destroyed, s.log.sessions);
  await D.catalog({});
  assert.equal(s.log.sessions, 1, 'kept');
  install(stub({ avail: 'downloadable' }));
  D._reset();
  assert.deepEqual((await D.catalog({})).models, [{ id: 'gemini-nano', name: 'Chrome on-device AI', json: true, vision: true }], 'no window, and no session, before the model is there');
});

// ---- the broker -----------------------------------------------------------------------------------------------------------
const area = () => { const data = {}; return { data, get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (v) => { Object.assign(data, structuredClone(v)); return true; } }; };
const echo = T.define({ id: 'example.echo', version: 1, input: (raw) => raw, check: (o) => o,
  build: (input, { text }) => text.request({ system: 'Repeat the text as {"text": ...}.', data: [{ label: 'text', text: input.text }] }),
  output: S.obj({ text: S.str('The text.') }, ['text']) });
const env = (over = {}) => {
  const vault = new Map([['connections', { here: { provider: 'device', generation: 'gen-1' } }]]);
  return { said: [], who: '7', allowed: Promise.resolve(true), local: area(), settings: async () => ({ on: true, use: 'here', features: { syllabus: true } }), enabled: async () => true,
    vault: { get: async (k) => structuredClone(vault.get(k)), set: async (k, v) => { vault.set(k, structuredClone(v)); return true; }, remove: async (k) => vault.delete(k) },
    reach: async () => false, fetch: async () => { throw new Error('nothing goes over the network'); }, task: async (id) => (id === 'example.echo' ? echo : null),
    say(m) { this.said.push(structuredClone(m)); }, ...over };
};

test('Settings asks the device\'s state and starts its download through glaze:ai-config; progress comes as events', async () => {
  const e = env();
  assert.deepEqual(await B.config({ op: 'test', provider: 'device' }, e), { ok: true, state: 'unavailable', reason: 'browser' });
  install(stub({ avail: 'downloadable' }));
  assert.deepEqual(await B.config({ op: 'test', provider: 'device' }, e), { ok: true, state: 'download' });
  assert.deepEqual(await B.config({ op: 'prepare', provider: 'device' }, e), { ok: true, state: 'ready' });
  assert.deepEqual(e.said, [0, 0.5, 1].map((loaded) => ({ type: 'glaze:ai-config', event: 'progress', provider: 'device', loaded })));
  assert.deepEqual(await B.config({ op: 'prepare', provider: 'openai' }, e), { ok: false, error: 'setup' }, 'nothing to download');
  assert.deepEqual(await B.config({ op: 'prepare', provider: 'nope' }, e), { ok: false, error: 'setup' });
  assert.deepEqual(await B.config({ op: 'test', provider: 'openai' }, e), { ok: false, error: 'setup' }, 'an endpoint is tested by its connection');
  // A device connection is kept like any other, with nothing to mask and no host to hold.
  assert.deepEqual(await B.config({ op: 'set', id: 'here', cfg: { provider: 'device' } }, e), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify((await B.config({ op: 'get' }, e)).connections.here)), { provider: 'device', model: 'gemini-nano', key: '' });
});

test('a run on the device connection goes through the broker to the model in the worker and back as checked output', async () => {
  install(stub({ chunks: ['{"text":"hello"}'] }));
  const e = env();
  const posted = [];
  const on = [];
  B.connect({ postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))), disconnect() {}, onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener() {} } }, e);
  for (const f of on) f({ id: 1, op: 'status', feature: 'syllabus' });
  for (const f of on) f({ id: 2, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hello' } });
  for (let i = 0; i < 60; i++) await new Promise(setImmediate);
  assert.deepEqual(posted[0], { id: 1, type: 'status', on: true, allowed: true, ready: true, provider: 'device', caps: { text: true, json: true, stream: true, local: true, images: true } });
  const end = posted.find((m) => m.type === 'end');
  assert.ok(end, JSON.stringify(posted));
  assert.deepEqual(end.output, { text: 'hello' });
  assert.equal(end.meta.unverified, undefined, 'the device names its own model');
  assert.equal(e.local.data.aiCalls[0].provider, 'device');
});

const devicePort = (e, sent = () => {}) => {
  const on = { message: [], disconnect: [] }, posted = [];
  const p = { posted, postMessage(m) { posted.push(JSON.parse(JSON.stringify(m))); sent(m); }, disconnect() {},
    onMessage: { addListener: (f) => on.message.push(f) }, onDisconnect: { addListener: (f) => on.disconnect.push(f) },
    say(m) { for (const f of on.message) f(m); }, close() { for (const f of on.disconnect) f(); } };
  B.connect(p, e); return p;
};

test('silent device inference survives a simulated worker idle cutoff without replaying inference', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, idle, expired = false;
  const s = install(stub({ gate: () => new Promise((resolve) => { release = resolve; }) }));
  // Chrome resets its 30-second idle timer for port messages, not an unresolved Prompt API promise.
  const active = () => { clearTimeout(idle); idle = setTimeout(() => { expired = true; p.close(); }, 30000); };
  const p = devicePort(env(), active);
  try {
    active(); p.say({ id: 1, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hello' } });
    await settle();
    assert.equal(typeof release, 'function');
    for (let i = 0; i < 3; i++) { t.mock.timers.tick(20000); await settle(); assert.equal(expired, false, 'an active local inference must not become idle'); }
    assert.deepEqual(p.posted.filter((m) => m.type === 'keepalive'), Array.from({ length: 3 }, () => ({ id: 1, type: 'keepalive' })), 'only the run id and event type are sent');
    release(); await settle();
    assert.equal(p.posted.at(-1).type, 'end');
    assert.equal(s.log.prompts.length, 1, 'inference is never replayed');
    clearTimeout(idle); idle = null;
    const count = p.posted.length;
    t.mock.timers.tick(60000); await settle();
    assert.equal(p.posted.length, count, 'completion stops the keepalive');
  } finally { clearTimeout(idle); p.close(); release?.(); await settle(); }
});

for (const outcome of ['completed', 'failed', 'cancelled', 'disconnected', 'timed out', 'revoked']) test(`device keepalive stops when its run is ${outcome}`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release, fail;
  const s = install(stub({ gate: () => new Promise((resolve, reject) => { release = resolve; fail = reject; }) }));
  const e = env(), p = devicePort(e);
  try {
    p.say({ id: 1, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hello' } }); await settle();
    assert.equal(typeof release, 'function');
    t.mock.timers.tick(20000); await settle();
    assert.equal(p.posted.filter((m) => m.type === 'keepalive').length, 1);
    if (outcome === 'completed') release();
    else if (outcome === 'failed') fail(new DOMException('native failure', 'OperationError'));
    else if (outcome === 'cancelled') p.say({ id: 1, op: 'cancel' });
    else if (outcome === 'timed out') t.mock.timers.tick(120000);
    else if (outcome === 'revoked') await B.config({ op: 'remove', id: 'here' }, e);
    else p.close();
    await settle();
    const count = p.posted.length;
    t.mock.timers.tick(60000); await settle();
    assert.equal(p.posted.length, count, 'nothing is posted after a terminal outcome');
    assert.equal(s.log.destroyed, s.log.sessions, 'every session is destroyed');
    if (outcome !== 'disconnected') assert.equal(p.posted.at(-1).type, outcome === 'completed' ? 'end' : 'error');
    if (outcome === 'timed out') assert.equal(p.posted.at(-1).error, 'timeout');
    if (outcome === 'revoked') assert.equal(p.posted.at(-1).error, 'changed');
  } finally { p.close(); release?.(); await settle(); }
});

test('in the real worker: Settings\' top frame asks for the device and starts its download; nothing else may', async () => {
  const worker = require('./helpers/worker-env.cjs');
  const { fakeIDB } = require('./helpers/fake-idb.cjs');
  const s = stub({ avail: 'downloadable' });
  const w = worker({ globals: { ...fakeIDB(), LanguageModel: s.LM, EventTarget, Event } });
  const EXT = 'chrome-extension://x';
  const editor = { id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 9, url: `${EXT}/options.html` } };
  const page = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', origin: 'https://school.instructure.com', tab: { id: 4, url: 'https://school.instructure.com/courses/1' } };
  for (const sender of [page, { ...editor, frameId: 1 }, { ...editor, id: 'other' }, { ...editor, url: `${EXT}/popup.html` }, { ...editor, origin: 'https://evil.example' }]) {
    for (const op of ['test', 'prepare', 'run']) assert.deepEqual(await w.send({ type: 'glaze:ai-config', op, provider: 'device' }, sender), { ok: false, error: 'sender' });
  }
  assert.equal(s.log.create.length, 0);
  const events = [];
  w.context.chrome.runtime.sendMessage = async (m) => { events.push(JSON.parse(JSON.stringify(m))); };
  assert.deepEqual(JSON.parse(JSON.stringify(await w.send({ type: 'glaze:ai-config', op: 'test', provider: 'device' }, editor))), { ok: true, state: 'download' });
  assert.deepEqual(JSON.parse(JSON.stringify(await w.send({ type: 'glaze:ai-config', op: 'prepare', provider: 'device' }, editor))), { ok: true, state: 'ready' });
  assert.equal(s.log.create.length, 1);
  assert.deepEqual(events, [0, 0.5, 1].map((loaded) => ({ type: 'glaze:ai-config', event: 'progress', provider: 'device', loaded })));
  assert.ok(w.context.GZ_AI_DEVICE, 'the worker imported the provider with the harness');
});

test('broker readiness follows the device model state without creating a session or downloading', async () => {
  const e = env();
  for (const [avail, why] of [['downloadable', 'download'], ['downloading', 'downloading'], ['unavailable', 'unavailable'], ['available', undefined]]) {
    const s = install(stub({ avail }));
    const out = await B.status({ feature: 'syllabus' }, e);
    assert.equal(out.ready, avail === 'available', avail);
    assert.equal(out.why, why, avail);
    assert.equal(s.log.create.length, 0, 'status never downloads');
  }
  delete globalThis.LanguageModel;
  assert.equal((await B.status({ feature: 'syllabus' }, e)).ready, false, 'Firefox and Safari');
});

test('fresh device writing readiness exposes already available image input before any session or catalog lookup', async () => {
  const s = install(stub({ avail: 'available', imageAvail: 'available' }));
  const e = env({ settings: async () => ({ on: true, model: { use: 'device' }, features: { writing: true } }) });
  const out = await B.status({ feature: 'writing' }, e);
  assert.equal(out.ready, true);
  assert.equal(out.caps.images, true, 'the frame can prepare assignment images before the first Feedback run');
  assert.deepEqual(s.log.availability.map((o) => o.expectedInputs), [[{ type: 'text' }], [{ type: 'text' }, { type: 'image' }]]);
  assert.equal(s.log.create.length, 0, 'capability discovery must not create a session or start a download');
  assert.equal(s.log.prompts.length, 0);
});

test('image readiness failures preserve ready text and the configured context without starting a download', async () => {
  for (const imageAvail of ['unavailable', 'downloadable', 'downloading', 'nonsense', new Error('image probe failed')]) {
    const s = install(stub({ avail: 'available' })), availability = s.LM.availability;
    s.LM.availability = async (options) => {
      if (!options.expectedInputs.some((i) => i.type === 'image')) return availability(options);
      s.log.availability.push(structuredClone(options));
      if (imageAvail instanceof Error) throw imageAvail;
      return imageAvail;
    };
    const e = env();
    await e.vault.set('connections', { here: { provider: 'device', generation: 'gen-1', context: 8192 } });
    const out = await B.status({ feature: 'syllabus' }, e);
    assert.equal(out.ready, true, String(imageAvail));
    assert.equal(out.why, undefined);
    assert.equal(out.caps.images, false);
    assert.equal(out.caps.context, 8192, 'availability discovery must preserve the configured context window');
    assert.equal(s.log.create.length, 0);
    assert.equal(s.log.prompts.length, 0);
  }
});

test('a stalled image availability probe is bounded without taking available text offline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = install(stub()), availability = s.LM.availability;
  let release, result;
  s.LM.availability = (options) => options.expectedInputs.some((i) => i.type === 'image')
    ? new Promise((resolve) => { release = resolve; }) : availability(options);
  const job = B.status({ feature: 'syllabus' }, env()).then((out) => { result = out; });
  try {
    await settle(); assert.equal(typeof release, 'function');
    t.mock.timers.tick(20001); await settle();
    assert.equal(result?.ready, true);
    assert.equal(result?.caps.images, false);
    assert.equal(s.log.create.length, 0);
  } finally { release?.('available'); await job; }
  assert.equal(result.caps.images, false, 'a late image probe cannot change the completed readiness result');
});

test('broker readiness accepts only a boolean image capability from provider status', async () => {
  const before = globalThis.GZ_AI_PROVIDERS;
  try {
    for (const images of [true, false, 'true', 1, null]) {
      const provider = { ...D, status: async () => ({ state: 'ready', caps: { images, context: 999999, key: 'private-value' } }) };
      globalThis.GZ_AI_PROVIDERS = { ...P, get: (id) => id === 'device' ? provider : P.get(id) };
      const e = env();
      await e.vault.set('connections', { here: { provider: 'device', generation: 'gen-1', context: 8192 } });
      const out = await B.status({ feature: 'syllabus' }, e);
      assert.equal(out.ready, true);
      assert.equal(out.caps.images, typeof images === 'boolean' ? images : undefined);
      assert.equal(out.caps.context, 8192);
      assert.equal('key' in out.caps, false);
    }
  } finally { if (before === undefined) delete globalThis.GZ_AI_PROVIDERS; else globalThis.GZ_AI_PROVIDERS = before; }
});

test('writing readiness exposes a stable identity for model, connection generation, tuning and effort without connection secrets', async () => {
  require('../lib/ai/providers/openai.js');
  const settings = { on: true, mode: 'advanced', model: { use: 'alpha', model: 'model-a', effort: 'low' },
    tune: { writing: { temperature: 0.5, context: 8192 } }, features: { writing: true, completion: true } };
  const e = env({ settings: async () => structuredClone(settings), reach: async () => true });
  const connections = { alpha: { provider: 'openai', base: 'https://private.example/v1', key: 'secret-credential', generation: 'gen-1' },
    beta: { provider: 'openai', base: 'https://second.example/v1', key: 'second-credential', generation: 'gen-1' } };
  await e.vault.set('connections', connections);
  const read = async () => (await B.status({ feature: 'writing' }, e)).identity;
  const first = await read();
  assert.deepEqual(JSON.parse(first), ['openai', 'alpha', 'model-a', 'gen-1', [['context', 8192], ['temperature', 0.5]], 'low']);
  assert.equal(await read(), first);
  assert.equal((await B.status({ feature: 'completion' }, e)).identity, undefined, 'only writing needs the cache identity');
  settings.features.completion = false;
  assert.equal(await read(), first, 'an unrelated feature does not invalidate writing results');
  let previous = first;
  for (const change of [() => { settings.model.model = 'model-b'; }, () => { settings.model.effort = 'high'; },
    () => { settings.tune.writing.context = 16384; }, async () => { connections.alpha.generation = 'gen-2'; await e.vault.set('connections', connections); },
    () => { settings.model.use = 'beta'; }]) {
    await change(); const next = await read();
    assert.notEqual(next, previous); previous = next;
    assert.doesNotMatch(next, /private\.example|second\.example|credential|https:|base|key/);
  }
});

test('a stalled shared download times out, detaches progress, and permits a retry without leaking its late session', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = install(stub({ avail: 'downloadable' }));
  const create = s.LM.create;
  const monitor = new EventTarget();
  let finish, signal, calls = 0, destroyed = 0;
  s.LM.create = (o) => {
    calls++;
    signal = o.signal;
    o.monitor(monitor);
    return new Promise((resolve) => { finish = () => resolve({ contextWindow: 1000, destroy() { destroyed++; } }); });
  };
  const seen = [], results = [];
  const jobs = [D.prepare({}, { onProgress: (n) => seen.push(n) }).then((r) => { results[0] = r; }), D.prepare({}, { onProgress: (n) => seen.push(n) }).then((r) => { results[1] = r; })];
  try {
    await settle();
    assert.equal(calls, 1);
    monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.25 }));
    assert.deepEqual(seen, [0.25, 0.25]);
    t.mock.timers.tick(240001);
    await settle();
    assert.deepEqual(results, [{ state: 'unavailable', reason: 'timeout' }, { state: 'unavailable', reason: 'timeout' }]);
    assert.equal(signal.aborted, true);
    monitor.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.75 }));
    assert.deepEqual(seen, [0.25, 0.25], 'no progress after timeout');
    s.LM.create = create;
    s.LM.availability = async () => 'available';
    assert.deepEqual(await D.prepare({}), { state: 'ready' }, 'a new attempt does not join the expired job');
  } finally {
    finish?.();
    await Promise.all(jobs);
    await settle();
  }
  assert.equal(destroyed, 1, 'a session arriving after timeout is destroyed');
});

test('prepare also bounds a stalled availability check and never creates a session when it returns late', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = install(stub());
  let release, result;
  s.LM.availability = () => new Promise((resolve) => { release = resolve; });
  const job = D.prepare({}).then((r) => { result = r; });
  try {
    await settle();
    t.mock.timers.tick(240001);
    await settle();
    assert.deepEqual(result, { state: 'unavailable', reason: 'timeout' });
  } finally {
    release('downloadable');
    await job;
    await settle();
  }
  assert.equal(s.log.create.length, 0, 'late availability must not start a download');
});

test('a stalled device status check returns unavailable so neither Settings nor feature readiness hangs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = install(stub());
  const releases = [], results = [];
  s.LM.availability = () => new Promise((resolve) => releases.push(resolve));
  const jobs = [B.config({ op: 'test', provider: 'device' }, env()).then((r) => { results[0] = r; }), B.status({ feature: 'syllabus' }, env()).then((r) => { results[1] = r; })];
  try {
    await settle();
    t.mock.timers.tick(20001);
    await settle();
    assert.deepEqual(results[0], { ok: true, state: 'unavailable', reason: 'timeout' });
    assert.equal(results[1]?.ready, false);
    assert.equal(results[1]?.why, 'unavailable');
  } finally {
    for (const release of releases) release('available');
    await Promise.all(jobs);
  }
  assert.equal(s.log.create.length, 0);
});

for (const legacy of [false, true]) test(`cancel during ${legacy ? 'measureInputUsage' : 'measureContextUsage'} destroys the session before measurement returns`, async () => {
  let release;
  const s = install(stub({ legacy, cost: () => new Promise((resolve) => { release = resolve; }) }));
  const c = new AbortController();
  const job = P.run('device', req(), {}, { signal: c.signal }).catch((e) => e);
  try {
    await settle();
    assert.equal(typeof release, 'function');
    c.abort(new DOMException('Cancelled', 'AbortError'));
    assert.equal((await job).code, 'cancelled');
    await settle();
    assert.equal(s.log.destroyed, 1, 'cleanup cannot wait for a stalled measurement');
  } finally {
    release?.(20);
    await job;
    await settle();
  }
  assert.equal(s.log.prompts.length, 0, 'no inference after cancellation');
});

test('a throwing stream consumer cancels and unlocks the stream and destroys the session', async () => {
  const s = install(stub());
  const create = s.LM.create;
  let stream;
  s.LM.create = async (o) => {
    const session = await create(o), streaming = session.promptStreaming;
    session.promptStreaming = (...args) => (stream = streaming(...args));
    return session;
  };
  await assert.rejects(P.run('device', req(), {}, { onDelta: () => { throw new Error('consumer failed'); } }), { code: 'connection-lost' });
  assert.equal(s.log.destroyed, 1);
  assert.equal(stream.locked, false);
});

test('cancelling a pending stream read unlocks it and destroys the session without waiting for more output', async () => {
  for (const bounded of [false, true]) {
    const s = install(stub());
    const create = s.LM.create;
    let stream, controller, cancelled = false;
    s.LM.create = async (o) => {
      const session = await create(o);
      session.promptStreaming = () => (stream = new ReadableStream({ start(c) { controller = c; }, cancel() { cancelled = true; } }));
      return session;
    };
    const c = new AbortController();
    const job = P.run('device', bounded ? req({ maxTokens: 16 }) : req(), {}, { signal: c.signal, ...(!bounded && { onDelta: () => {} }) }).catch((e) => e);
    try {
      await settle();
      c.abort(new DOMException('Cancelled', 'AbortError'));
      assert.equal((await job).code, 'cancelled');
      await settle();
      assert.equal(cancelled, true);
      assert.equal(stream.locked, false);
      assert.equal(s.log.destroyed, 1);
    } finally {
      // Release the stub's pending read even against the unfixed provider.
      if (!cancelled) controller?.close();
      await settle();
    }
  }
});

test('responseConstraint never replaces validation of the returned JSON', async () => {
  for (const answer of ['not JSON', '{"text":42}', '{"other":"value"}']) {
    const s = install(stub({ chunks: [answer] }));
    await assert.rejects(P.run('device', req(), {}), { code: 'invalid-response' });
    assert.equal(s.log.destroyed, 1);
  }
});

test('a restarted worker reads current download state and never replays a session', async () => {
  const worker = require('./helpers/worker-env.cjs');
  const { fakeIDB } = require('./helpers/fake-idb.cjs');
  const s = stub({ avail: 'downloading' });
  const globals = { ...fakeIDB(), LanguageModel: s.LM, EventTarget, Event };
  const editor = { id: 'glaze', frameId: 0, url: 'chrome-extension://x/options.html', origin: 'chrome-extension://x' };
  const w = worker({ globals });
  assert.deepEqual(await w.send({ type: 'glaze:ai-config', op: 'test', provider: 'device' }, editor), { ok: true, state: 'downloading' });
  const restarted = worker({ globals, store: w.store });
  s.LM.availability = async () => 'downloadable';
  assert.deepEqual(await restarted.send({ type: 'glaze:ai-config', op: 'test', provider: 'device' }, editor), { ok: true, state: 'download' });
  s.LM.availability = async () => 'available';
  assert.deepEqual(await restarted.send({ type: 'glaze:ai-config', op: 'test', provider: 'device' }, editor), { ok: true, state: 'ready' });
  assert.equal(s.log.create.length, 0);
});

test('requests with one system prompt prompt clones of one warm session, which read it once; other prompts and earlier turns get their own', async () => {
  const { log } = install(stub({ clone: true, chunks: ['ok'] }));
  const text = (system, more = []) => ({ messages: [{ role: 'system', content: system }, ...more, { role: 'user', content: 'go' }] });
  await P.run('device', text('Finish it.'), {});
  await P.run('device', text('Finish it.'), {});
  assert.equal(log.bases().length, 1, 'one session read the instructions');
  assert.deepEqual(log.bases()[0].initialPrompts, [{ role: 'system', content: 'Finish it.' }]);
  assert.equal(log.create.filter((c) => c.cloned).length, 2, 'each request on a clone');
  assert.equal(log.prompts.length, 2);
  assert.equal(log.destroyed, 2, 'the clones, not the warm session');
  await P.run('device', text('Review it.'), {});
  assert.equal(log.bases().length, 2, 'another system prompt, another warm session');
  await P.run('device', text('Finish it.', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), {});
  assert.equal(log.bases().length, 3, 'earlier turns: a session of its own');
  assert.equal(log.bases()[2].initialPrompts.length, 3);
  assert.equal(log.destroyed, 4, 'and it is destroyed after its request');
  D.release();
  await settle();
  assert.equal(log.destroyed, log.sessions, 'release destroys the warm sessions');
  await P.run('device', text('Finish it.'), {});
  assert.equal(log.bases().length, 4, 'made again after release');
});

test('a warm-up makes the warm session a later run with the same instructions clones, and asks the model nothing', async () => {
  const { log } = install(stub({ clone: true, chunks: ['ok'] }));
  const text = (system) => ({ messages: [{ role: 'system', content: system }, { role: 'user', content: 'go' }], temperature: 0.2 });
  assert.equal(await P.warm('device', text('Finish it.'), {}), true);
  assert.equal(log.bases().length, 1, 'the instructions read once, now');
  assert.equal(log.prompts.length, 0, 'nothing asked of the model');
  assert.equal(await P.warm('device', text('Finish it.'), {}), true);
  assert.equal(log.bases().length, 1, 'already warm: nothing new');
  await P.run('device', text('Finish it.'), {});
  assert.equal(log.bases().length, 1, 'the run clones the session the warm-up made');
  assert.equal(log.create.filter((c) => c.cloned).length, 1);
});

test('a warm-up never starts a download, and needs clone()', async () => {
  const text = { messages: [{ role: 'system', content: 'Finish it.' }, { role: 'user', content: 'go' }] };
  let s = install(stub({ avail: 'downloadable', clone: true }));
  assert.equal(await P.warm('device', text, {}), false);
  assert.equal(s.log.create.length, 0);
  s = install(stub({ clone: false }));
  assert.equal(await P.warm('device', text, {}), false, 'no warm session to keep');
  assert.equal(s.log.create.length, 0);
});

test('a warm session goes after WARM.ms unused, after its call fails or times out, but not when the caller cancels', async () => {
  const ms = D.WARM.ms;
  try {
    D.WARM.ms = 5;
    const { log } = install(stub({ clone: true, chunks: ['ok'] }));
    await P.run('device', req({ schema: undefined }), {});
    assert.equal(log.destroyed, 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(log.destroyed, 2, 'idle: destroyed');
  } finally { D.WARM.ms = ms; }
  let release;
  const s = install(stub({ clone: true, gate: (signal) => new Promise((resolve, reject) => { release = resolve; signal?.addEventListener('abort', () => reject(signal.reason), { once: true }); }) }));
  const c = new AbortController();
  const running = P.run('device', req(), {}, { signal: c.signal });
  for (let i = 0; i < 20 && !release; i++) await new Promise(setImmediate);
  c.abort(new DOMException('Cancelled', 'AbortError'));
  assert.equal((await running.catch((x) => x)).code, 'cancelled');
  await settle();
  assert.equal(s.log.destroyed, 1, 'the clone only: the warm session outlives a cancel');
  const late = P.run('device', req(), {});
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  release();
  assert.deepEqual((await late).json, { text: 'ok' });
  assert.equal(s.log.bases().length, 1, 'and the next request uses it');
  D._reset();
  const f = install(stub({ clone: true, promptError: new Error('broken') }));
  await assert.rejects(P.run('device', req(), {}));
  await settle();
  assert.equal(f.log.destroyed, f.log.sessions, 'a failed call takes its warm session with it');
});

test('a session without clone() is each request\'s own, as before', async () => {
  const { log } = install(stub());
  await P.run('device', req(), {});
  await P.run('device', req(), {});
  assert.equal(log.sessions, 2);
  assert.equal(log.destroyed, 2);
});

test('plain text streams from the device with no response constraint', async () => {
  const s = install(stub({ clone: true, chunks: [' runs', ' to the sea.'] }));
  const seen = [];
  const out = await P.run('device', { messages: [{ role: 'system', content: 'Finish it.' }, { role: 'user', content: 'The river' }], maxTokens: 1 }, {}, { onDelta: (t) => seen.push(t) });
  assert.deepEqual(seen, [' runs', ' to the sea.']);
  assert.equal(out.text, ' runs to the sea.');
  assert.equal(out.json, undefined);
  assert.deepEqual(s.log.prompts[0].input[0].content, [{ type: 'text', value: 'The river' }], 'plain completion receives no schema guidance or schema byte cutoff');
  assert.equal(s.log.prompts[0].opts.omitResponseConstraintInput, undefined);
});


test('a warm create ignoring abort expires at its own deadline and destroys its late session once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const s = install(stub({ clone: true }));
  const create = s.LM.create;
  let finish, result;
  s.LM.create = (o) => o.cloned ? create(o) : new Promise((resolve) => { finish = async () => resolve(await create({ ...o, signal: undefined })); });
  const job = P.run('device', req(), {}).then((r) => { result = r; }, (e) => { result = e; });
  try {
    await settle();
    t.mock.timers.tick(20001); await settle();
    assert.equal(result?.code, 'timeout', 'the shared create has its own 20-second deadline');
  } finally {
    await finish(); await job; await settle(); D.release(); await settle();
  }
  assert.equal(s.log.destroyed, 1, 'late base destroyed exactly once');
  s.LM.create = create;
  assert.deepEqual((await P.run('device', req(), {})).json, { text: 'ok' }, 'retry creates a fresh base');
});

test('release during a warm create destroys its late base exactly once', async () => {
  const s = install(stub({ clone: true })), create = s.LM.create;
  let finish;
  s.LM.create = (o) => o.cloned ? create(o) : new Promise((resolve) => { finish = async () => resolve(await create({ ...o, signal: undefined })); });
  const job = P.run('device', req(), {}).catch((e) => e);
  await settle(); D.release(); await finish(); await job; await settle();
  assert.equal(s.log.destroyed, s.log.sessions, 'a released base must have one owner for destruction');
});


test('an older clone failure cannot evict the replacement warm session', async () => {
  const s = install(stub({ clone: true })), create = s.LM.create;
  let rejectClone, bases = 0;
  s.LM.create = async (o) => {
    const session = await create(o);
    if (!o.cloned && ++bases === 1) session.clone = () => new Promise((_, reject) => { rejectClone = reject; });
    return session;
  };
  const old = P.run('device', req(), {}).catch((e) => e);
  await settle(); D.release();
  await P.run('device', req(), {});
  rejectClone(new Error('old clone failed')); await old; await settle();
  await P.run('device', req(), {});
  assert.equal(bases, 2, 'a stale failure must not discard the new base');
});

test('throwing clone cleans its base; concurrent clones never prompt the shared base', async () => {
  const s = install(stub({ clone: true })), create = s.LM.create;
  let failClone = true;
  s.LM.create = async (o) => {
    const session = await create(o);
    if (!o.cloned && failClone) session.clone = () => { throw new Error('clone failed'); };
    return session;
  };
  await assert.rejects(P.run('device', req(), {})); await settle();
  assert.equal(s.log.destroyed, s.log.sessions);
  failClone = false;
  await Promise.all([P.run('device', req(), {}), P.run('device', req({ messages: [{ role: 'system', content: 'Answer as {"text": ...}.' }, { role: 'user', content: 'another document' }] }), {})]);
  assert.equal(s.log.create.filter((c) => c.cloned).length, 2);
  assert.equal(s.log.bases().length, 2, 'one failed base, one shared clean base');
  assert.deepEqual(s.log.prompts.map((p) => p.input[0].content[0].value).sort(), ['another document', 'hello']);
  D.release(); await settle(); assert.equal(s.log.destroyed, s.log.sessions);
});
