// The AI harness's `device` provider (lib/ai/providers/device.js): Chrome's Prompt API (LanguageModel, Gemini Nano) in the
// worker, against a stand-in LanguageModel: availability → status, a download with progress, a request mapped to a session
// (system prompt, history, pictures, a schema as responseConstraint, temperature only with topK), deltas streamed, a cancel,
// input over the context window refused before it is sent, every session destroyed, and the broker's prepare and test.
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
// chunks: the answer, streamed as deltas; legacy: Chrome 138's names (inputQuota, inputUsage, measureInputUsage).
const stub = ({ avail = 'available', imageAvail, window = 1000, used = 10, cost = () => 20, chunks = ['{"text":', '"ok"}'], legacy = false, params = { defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2 },
  promptError, overflow = false, gate, availabilityError, createError, progress = [0, 0.5, 1] } = {}) => {
  const log = { availability: [], create: [], prompts: [], measured: [], destroyed: 0, sessions: 0 };
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
        for (const loaded of avail === 'available' ? [] : progress) m.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded, total: 1 }));
      }
      log.sessions++;
      const s = new EventTarget();
      const measure = async (input, opts) => { log.measured.push({ input, opts }); return cost(input, opts); };
      Object.assign(s, legacy ? { inputQuota: window, inputUsage: used, measureInputUsage: measure } : { contextWindow: window, contextUsage: used, measureContextUsage: measure });
      s.destroy = () => { log.destroyed++; };
      const answer = async (input, opts = {}) => {
        log.prompts.push({ input, opts: { ...opts, signal: !!opts.signal } });
        if (overflow) s.dispatchEvent(new Event(legacy ? 'quotaoverflow' : 'contextoverflow'));
        if (promptError) throw promptError;
        if (gate) await gate(opts.signal);
        if (opts.signal?.aborted) throw opts.signal.reason;
      };
      s.prompt = async (input, opts) => { await answer(input, opts); return chunks.join(''); };
      s.promptStreaming = (input, opts = {}) => {
        let i = 0, started = null;
        return new ReadableStream({
          async pull(c) {
            started ||= answer(input, opts);
            await started;
            if (opts.signal?.aborted) return c.error(opts.signal.reason);
            if (i < chunks.length) c.enqueue(chunks[i++]); else c.close();
          },
        });
      };
      return s;
    },
    ...(params !== null && { params: async () => params }),
  };
  return { LM, log };
};
const install = (s) => { globalThis.LanguageModel = s.LM; return s; };
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
  for (const [avail, want] of [['unavailable', { state: 'unavailable', reason: 'device' }], ['downloadable', { state: 'download' }], ['downloading', { state: 'downloading' }], ['available', { state: 'ready' }]]) {
    install(stub({ avail }));
    assert.deepEqual(await D.status({}), want, avail);
  }
  install(stub({ availabilityError: new Error('boom') }));
  assert.deepEqual(await D.status({}), { state: 'unavailable', reason: 'failed' });
  install(stub({ avail: 'nonsense' }));
  assert.deepEqual(await D.status({}), { state: 'unavailable', reason: 'failed' });
});

test('caps: text, JSON and streaming; pictures and context only when known; tools never claimed', () => {
  assert.deepEqual(D.caps({ model: 'gemini-nano' }), { text: true, json: true, stream: true });
  assert.deepEqual(D.caps({ model: 'gemini-nano', images: true, context: 900 }), { text: true, json: true, stream: true, images: true, context: 900 });
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
  assert.deepEqual(log.prompts[0].input, [{ role: 'user', content: [{ type: 'text', value: 'hello' }] }]);
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

test('deltas stream to onDelta and make up the answer', async () => {
  const { log } = install(stub({ chunks: ['{"te', 'xt":"str', 'eamed"}'] }));
  const seen = [];
  const out = await P.run('device', req(), {}, { onDelta: (t) => seen.push(t) });
  assert.deepEqual(seen, ['{"te', 'xt":"str', 'eamed"}']);
  assert.deepEqual(out.json, { text: 'streamed' });
  assert.equal(log.destroyed, 1);
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
  assert.equal((await P.run('device', req(), {}).catch((x) => x)).code, 'request-rejected');
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
  assert.deepEqual(c.models, [{ id: 'gemini-nano', name: 'Gemini Nano', json: true, vision: true, context: { window: 4096, inputLimit: 3686 } }]);
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
  assert.deepEqual(c.models, [{ id: 'gemini-nano', name: 'Gemini Nano', json: true, vision: false, context: { window: 6144, inputLimit: 5529 } }]);
  assert.equal(s.log.destroyed, s.log.sessions);
  await D.catalog({});
  assert.equal(s.log.sessions, 1, 'kept');
  install(stub({ avail: 'downloadable' }));
  D._reset();
  assert.deepEqual((await D.catalog({})).models, [{ id: 'gemini-nano', name: 'Gemini Nano', json: true }], 'no session before the model is there');
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
  assert.deepEqual(posted[0], { id: 1, type: 'status', on: true, allowed: true, ready: true, provider: 'device', caps: { text: true, json: true, stream: true } });
  const end = posted.find((m) => m.type === 'end');
  assert.ok(end, JSON.stringify(posted));
  assert.deepEqual(end.output, { text: 'hello' });
  assert.equal(end.meta.unverified, undefined, 'the device names its own model');
  assert.equal(e.local.data.aiCalls[0].provider, 'device');
});
