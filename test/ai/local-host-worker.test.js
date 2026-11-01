// The engine host's Worker (ai/local/host.js) as the browser starts it: host.js run in a Worker-like scope of its own, its
// importScripts reading the shipped files beside it in order, nothing from node's require. D4 (glaze-plans/lfm-tune/
// reports/d4-r1.md) found grammar.js failing in that Worker, silently, because ai/schema.js was never loaded, so no local
// run was held to its JSON schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('../../extension/ai/local/host.js');
const K = require('../../extension/ai/local/tokenizer.js');
const T = require('../../extension/ai/task.js');
for (const f of ['writer-review', 'syllabus-read', 'writer-requirements', 'writer-cite', 'writer-image']) require(`../../extension/ai/tasks/${f}.js`);

const HERE = path.join(__dirname, '../../extension/ai/local');
// A byte-level vocabulary with LFM3's control tokens (as test/ai/local-think.test.js builds it).
const VOCAB = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  const tokens = Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++)), types = tokens.map(() => 1);
  for (const [t, ty] of [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['</think>', 4]]) { tokens.push(t); types.push(ty); }
  return { tokens, types, merges: [], pre: 'lfm2', bos: tokens.indexOf('<|startoftext|>'), eos: tokens.indexOf('<|im_end|>') };
})();

// host.js in its own realm, as a dedicated Worker runs it: → { scope, imported, failed, listeners, posted }.
const boot = () => {
  const imported = [], failed = [], listeners = [], posted = [];
  const scope = {
    WorkerGlobalScope: class { static [Symbol.hasInstance]() { return true; } },
    importScripts: (...files) => {
      for (const f of files) {
        const file = path.join(HERE, f);
        imported.push(f);
        try { vm.runInContext(fs.readFileSync(file, 'utf8'), scope, { filename: file }); } catch (e) { failed.push(f); throw e; }
      }
    },
    postMessage: (m) => posted.push(structuredClone(m)), addEventListener: (type, f) => { if (type === 'message') listeners.push(f); },
    location: { href: 'chrome-extension://glaze/ai/local/host.js' }, navigator: {},
    TextEncoder, TextDecoder, URL, Blob, atob, btoa, console, performance, structuredClone, DOMException, AbortController, AbortSignal,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, clearTimeout, queueMicrotask, fetch: async () => { throw new Error('no network'); },
  };
  scope.globalThis = scope; scope.self = scope;
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(HERE, 'host.js'), 'utf8'), scope, { filename: path.join(HERE, 'host.js') });
  return { scope, imported, failed, listeners, posted };
};

test('the Worker loads the schema before the grammar, and the grammar it loads compiles every task\'s schema', () => {
  const w = boot();
  for (const f of H.IMPORTS.required) assert.ok(w.imported.includes(f) && !w.failed.includes(f), f);
  assert.ok(w.imported.indexOf('../schema.js') < w.imported.indexOf('grammar.js'), 'the schema first: grammar.js reads it as it loads');
  const G = w.scope.GZ_AI_GRAMMAR;
  assert.equal(typeof G?.compile, 'function', 'the Worker has the grammar');
  const tok = w.scope.GZ_AI_TOKENIZER.fromGGUF(VOCAB);
  const V = G.vocab(tok.byteStrings(), { eos: [tok.eos] });
  for (const id of ['writer.review', 'syllabus.read', 'writer.requirements', 'writer.cite', 'writer.image']) {
    const g = G.compile(T.get(id).output, V);
    assert.equal(Object.prototype.toString.call(g.matcher().mask()), '[object Uint32Array]', id);
  }
  // A whole answer to writer.review walks the mask to the end token.
  const m = G.compile(T.get('writer.review').output, V).matcher();
  for (const id of tok.encode('{"issues":[]}')) m.advance(id);
  assert.ok(m.complete);
});

test('a run in that Worker with a schema is held to it: every answer token masked, the JSON whole', async () => {
  const w = boot();
  // Only the GPU and the disk are stubbed: the store's files, the GGUF reader's answer and the engine.
  const decodes = [];
  Object.assign(w.scope.GZ_AI_STORE, { list: async () => [{ id: 'glaze-q4', tier: 1, size: 1, state: 'ready' }], status: async () => ({ state: 'ready' }),
    open: async (id) => ({ id, size: 1, read: async () => new Uint8Array(0) }) });
  w.scope.GZ_AI_GGUF.open = async () => ({ kv: VOCAB });
  w.scope.GZ_AI_ENGINE = { load: async (g) => {
    const tok = K.load(g.kv), reply = [...tok.encode('{"issues":[]} trailing words')];
    let i = 0;
    return { context: 16000, release() {}, snapshot: async () => ({ pos: 0, drop() {} }), restore: async () => {},
      prefill: async (ids, { snapshot } = {}) => { i = 0; return snapshot ? { pos: ids.length, drop() {} } : undefined; },
      decode: async ({ mask } = {}) => {
        const ok = (id) => !mask || !!(mask[id >>> 5] & (1 << (id & 31)));
        // The stub would go on past the JSON; the mask steers it to the end token.
        const id = i < reply.length && ok(reply[i]) ? reply[i++] : tok.eos;
        decodes.push({ id, masked: !!mask, ok: ok(id) });
        return id;
      } };
  } };
  const parts = [{ special: '<|startoftext|>' }, { special: '<|im_start|>' }, { text: 'system\nAnswer.' }, { special: '<|im_end|>' },
    { special: '<|im_start|>' }, { text: 'user\nthe the cat' }, { special: '<|im_end|>' }, { special: '<|im_start|>' }, { text: 'assistant\n' }];
  for (const f of w.listeners) f({ data: { id: 1, op: 'run', model: 'glaze-q4', parts, stable: 4, schema: T.get('writer.review').output, sampler: {}, maxTokens: 64 } });
  for (let n = 0; n < 200 && !w.posted.some((m) => m.id === 1 && ['done', 'error'].includes(m.type)); n++) await new Promise(setImmediate);
  const end = w.posted.find((m) => m.id === 1 && ['done', 'error'].includes(m.type));
  assert.equal(end?.type, 'done', JSON.stringify(end));
  assert.deepEqual(JSON.parse(end.result.text), { issues: [] });
  assert.equal(end.result.finish, 'stop');
  assert.ok(decodes.length > 0 && decodes.every((d) => d.masked && d.ok), 'every token under the grammar\'s mask');
});

test('the Worker can enforce normalization-sensitive spans using the shared text folding', () => {
  const w = boot(), G = w.scope.GZ_AI_GRAMMAR;
  const tok = w.scope.GZ_AI_TOKENIZER.fromGGUF(VOCAB), V = G.vocab(tok.byteStrings(), { eos: [tok.eos] });
  const schema = { type: 'object', properties: { q: { type: 'string', maxLength: 3, span: { source: 'draft', min: 1 } } }, required: ['q'], additionalProperties: false };
  const g = G.compile(schema, V, { sources: { draft: 'ΑΣΑ ok' } });
  const good = g.matcher();
  for (const id of tok.encode('{"q":"ΑΣΑ"}')) good.advance(id);
  assert.ok(good.complete);
  const bad = g.matcher();
  assert.throws(() => { for (const id of tok.encode('{"q":"ΑΣ"}')) bad.advance(id); }, /doesn't fit/);
});

test('the Worker hands op update to the model updates it loaded (ai/local/updates.js), never refusing it as unavailable', async () => {
  const w = boot();
  assert.equal(typeof w.scope.GZ_AI_MODEL_UPDATES?.update, 'function');
  w.scope.GZ_AI_STORE.catalog = async () => ({ state: null, entries: new Map(), spares: new Map(), latest: new Map() });
  w.listeners[0]({ data: { id: 1, op: 'update', doc: { list: {} }, model: 'glaze-q4', glaze: '4.0.1' } });
  for (let i = 0; i < 50 && !w.posted.some((m) => m.id === 1 && m.type === 'done'); i++) await new Promise((r) => setTimeout(r, 2));
  assert.deepEqual(w.posted.find((m) => m.id === 1 && m.type === 'done')?.result, { state: 'refused', reason: 'shape' });
});
