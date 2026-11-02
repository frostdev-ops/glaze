// agent.tools under the local engine's grammar (ai/local/grammar.js with the task's constraint()): a turn is either a
// native call to one of the offered tools, its parameters each by its own schema, or the answer JSON at its limits, and
// nothing else. D4 (glaze-plans/lfm-tune runs/d4-p3/p3dpo) ran the turn with no grammar at all: quotes of 312 and 712
// characters, a call with a parameter its tool doesn't take, and JSON broken mid-array all reached the check.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const G = require('../../extension/ai/local/grammar.js');
const S = require('../../extension/ai/schema.js');
const K = require('../../extension/ai/local/tokenizer.js');
const H = require('../../extension/ai/local/host.js');
require('../../extension/ai/providers/mock.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const vocab = require('../helpers/local-vocab.cjs');

const TOK = vocab(require('../fixtures/ai/local-format/vocab.json'));
const MARKS = Object.fromEntries(G.TOOL_MARKS.map((n) => [n, TOK.id(n)]));
const EOS = TOK.id('<|im_end|>');
const V = G.vocab(TOK.byteStrings(), { eos: [EOS], marks: MARKS });
const NOW = Date.UTC(2026, 9, 30, 19, 5);
const ALL = A.task.input({ question: 'What is due?', tools: [...A.NAMES], now: NOW, zone: 'America/Chicago' });
const grammarFor = (inp) => { const c = A.constraint(inp); return G.compile(c.schema, V, { tools: c.tools }); };
const allowed = (mask, id) => !!(mask[id >>> 5] & (1 << (id & 31)));
// The model's words as ids: a native call's tags by id (as the model writes them), any other text through the tokenizer.
const ids = (out) => (typeof out === 'string' ? [...TOK.encode(out)] : [...TOK.encodeWith(out)]);
const native = (name, args) => A.native.parts({ name, arguments: args });
// → '' when every id fits and the end token may follow, else where it stopped.
const walk = (g, list) => {
  const m = g.matcher();
  for (const [i, id] of list.entries()) {
    if (!allowed(m.mask(), id)) return `refused at token ${i} (${JSON.stringify(TOK.decode([id], { specials: true }))})`;
    m.advance(id);
  }
  return m.complete && allowed(m.mask(), EOS) ? '' : 'not whole';
};

test('the turn grammar takes every valid answer and call, and is exact: no pattern left to validate()', () => {
  const g = grammarFor(ALL);
  assert.equal(g.exact, true);
  for (const out of [
    '{"text":"Nothing is due.","quotes":[]}',
    `{"text":"${'é'.repeat(A.LIMIT.text)}","quotes":[${Array.from({ length: A.LIMIT.quotes }, () => `"${'q'.repeat(A.LIMIT.quote)}"`).join(',')}]}`,
    native('accounts_list', {}), native('documents_list', { from: 0 }), native('todo_list', { course: '5521', days: 7, account: 'https://canvas.northfield.edu/4821' }),
    native('assignment_read', { course: '5521', assignment: '88121' }), native('schedule_list', { from: '2026-10-31', to: '2026-11-07T23:59:00-05:00' }),
    native('todo_mark_done', { type: 'assignment', id: '88121' }), native('todo_mark_done', { type: 'planner_note', id: '_123_456' }),
  ]) assert.equal(walk(g, ids(out)), '', typeof out === 'string' ? out.slice(0, 80) : A.native.text(out.length ? A.native.parse(out.map((p) => p.special ?? p.text).join('')) : {}));
});

test('D4\'s invalid turns can\'t be written: over-long quotes and replies, too many quotes, broken JSON, unknown tools and parameters', () => {
  const g = grammarFor(ALL);
  const p3dpo = '{"text":"Sí, aparece como entregado: no, según la lista, “Foro 6” (TYP-341 Tipografía y composición editorial) no está entregado y figura como faltante.","quotes":["Foro 6","TYP-341 Tipografía y composición editorial","submitted":false,"missing":true}]}';
  const bad = {
    'a 312-character quote (p3dpo Q4_K_M e2-024)': `{"text":"Quiz 5.","quotes":["${'x'.repeat(312)}"]}`,
    'a 712-character quote (p3dpo Q8_0 e2-008)': `{"text":"Discussion 6.","quotes":["${'x'.repeat(712)}"]}`,
    'a reply over 1,200 characters': `{"text":"${'x'.repeat(A.LIMIT.text + 1)}","quotes":[]}`,
    'thirteen quotes': `{"text":"x","quotes":[${Array.from({ length: A.LIMIT.quotes + 1 }, () => '"q"').join(',')}]}`,
    'JSON broken mid-array (p3dpo Q5_K_M think e2-018)': p3dpo,
    'an extra answer key': '{"text":"x","quotes":[],"note":"y"}',
    'a parameter documents_list doesn\'t take (p3dpo Q5_K_M e2-012)': [...native('documents_list', { from: 0 }).slice(0, -3), { special: '<parameter=' }, { text: 'page>\n0\n' }, { special: '</parameter>' }, { text: '\n' }, { special: '</function>' }, { text: '\n' }, { special: '</tool_call>' }],
    'a tool that isn\'t one': [{ special: '<tool_call>' }, { text: '\n' }, { special: '<function=' }, { text: 'fix_apply>\n' }, { special: '</function>' }, { text: '\n' }, { special: '</tool_call>' }],
    'a required parameter left out': native('assignment_read', { course: '5521' }),
    'an integer out of range': native('todo_list', { days: 61 }),
    'an integer as words': [...native('todo_list', {}).slice(0, 4), { special: '<parameter=' }, { text: 'days>\nseven\n' }, { special: '</parameter>' }, { text: '\n' }, ...native('todo_list', {}).slice(4)],
    'a date that isn\'t ISO': native('schedule_list', { from: 'tomorrow', to: '2026-11-07' }),
    'an id that isn\'t one': native('todo_mark_done', { type: 'assignment', id: 'abc' }),
    'a type in capitals': native('todo_mark_done', { type: 'Assignment', id: '88121' }),
    'a course id over 40 characters': native('assignment_read', { course: '1'.repeat(41), assignment: '1' }),
    'an empty course id': native('assignment_read', { course: '', assignment: '1' }),
    'a value over two lines': native('assignment_read', { course: '55\n21', assignment: '1' }),
    'words before the call': [{ text: 'Sure! ' }, ...native('grades_list', {})],
    'prose': 'Nothing is due this weekend.',
  };
  for (const [what, out] of Object.entries(bad)) assert.notEqual(walk(g, ids(out)), '', what);
  // A tool the turn didn't offer.
  const two = A.task.input({ question: 'What is due?', tools: ['todo_list', 'grades_list'], now: NOW, zone: 'UTC' });
  assert.notEqual(walk(grammarFor(two), ids(native('accounts_list', {}))), '');
  assert.equal(walk(grammarFor(two), ids(native('grades_list', {}))), '');
});

// Random walks: a seeded sampler picking among the tokens the mask allows, the end token as soon as it may, must end in a
// turn fromNative() reads, that validate() and why()'s own schema checks pass, every time.
test('whatever the mask lets the model write is a turn agent.tools takes: random walks over every tool', () => {
  let seed = 11;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const g = grammarFor(ALL), seen = new Set();
  for (let w = 0; w < 160; w++) {
    const m = g.matcher(), out = [];
    for (let n = 0; n < 4000 && !m.done; n++) {
      const mask = m.mask(), list = [];
      for (let i = 0; i < V.size; i++) if (allowed(mask, i)) list.push(i);
      assert.ok(list.length, 'never a dead end');
      const id = list.includes(EOS) && rnd() < 0.6 ? EOS : list[Math.floor(rnd() * list.length)];
      m.advance(id);
      if (id !== EOS) out.push(id);
    }
    assert.ok(m.done, `walk ${w} ended`);
    const text = TOK.decode(out, { specials: true }), turn = A.fromNative(text);
    assert.notEqual(turn, undefined, text.slice(0, 200));
    assert.deepEqual(S.validate(turn, A.OUTPUT), [], text.slice(0, 200));
    if (turn.call) { assert.deepEqual(S.validate(turn.call.arguments, A.SPECS.find((t) => t.name === turn.call.name).parameters), [], text); seen.add(turn.call.name); }
    else seen.add('answer');
    assert.ok(!['schema', 'tool', 'arguments'].includes(A.why(turn, ALL)), text.slice(0, 200));
  }
  assert.ok(seen.size >= 8, `walks reached ${[...seen].join(', ')}`);
});

test('the turn\'s mask is exactly the tokens that advance, in calls, raw values, patterns and the answer alike', () => {
  let seed = 5;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const text = [];
  for (let i = 0; i < V.size; i++) if (V.bytes[i]) text.push(i);
  // Walks along real turns, so the states checked sit inside each kind of value.
  const turns = [ids(native('todo_mark_done', { type: 'planner_note', id: '_12_34', account: 'https://canvas.northfield.edu/4821' })),
    ids(native('schedule_list', { from: '2026-10-31', to: '2026-11-07T23:59:00-05:00' })), ids(native('document_read', { page: 12, document: 'doc-0ad45655a1' })),
    ids(`{"text":"Due \\"Friday\\".","quotes":["Lab report 3","2026-10-31 23:59"]}`)];
  for (const turn of turns) {
    const m = grammarFor(ALL).matcher();
    for (const id of turn) {
      if (rnd() < 0.35) {
        const mask = m.mask(), some = new Set(text.filter((t) => allowed(mask, t)));
        while (some.size < 3000) some.add(text[Math.floor(rnd() * text.length)]);
        for (const t of some) {
          let ok = true;
          try { m.fork().advance(t); } catch { ok = false; }
          assert.equal(allowed(mask, t), ok, `token ${t} ${JSON.stringify(TOK.decode([t], { specials: true }))}`);
        }
      }
      m.advance(id);
    }
  }
});

test('a pattern the grammar can\'t hold leaves it inexact; the patterns Glaze writes are held exactly, in JSON strings too', () => {
  const plain = G.vocab(TOK.byteStrings(), { eos: [EOS] });
  assert.equal(G.compile({ type: 'string', pattern: '\\w+' }, plain).exact, false);
  assert.equal(G.compile({ type: 'string', pattern: 'abc' }, plain).exact, false, 'unanchored');
  const g = G.compile(S.obj({ id: { type: 'string', pattern: '^(\\d{1,20}|_\\d{1,20}_\\d{1,20})$' } }, ['id']), plain);
  assert.equal(g.exact, true);
  for (const [text, ok] of [['{"id":"88121"}', true], ['{"id":"_1_2"}', true], ['{"id":"_1"}', false], ['{"id":"a1"}', false], ['{"id":""}', false]]) assert.equal(walk(g, ids(text)) === '', ok, text);
  assert.throws(() => G.compile(A.constraint(ALL).schema, plain, { tools: A.constraint(ALL).tools }), /marks/, 'calls need the tool tags\' ids');
});

test('tool argument schemas with unsupported root constraints are refused instead of silently ignored', () => {
  const { schema, tools } = A.constraint(ALL), tool = tools.find((t) => t.name === 'assignment_read');
  for (const root of [
    { type: 'string' }, { type: ['array', 'null'] },
    { const: { course: '5521', assignment: '88121' } },
    { enum: [{ course: '5521', assignment: '88121' }] },
    { anyOf: [{ properties: { course: { const: '5521' } } }] },
  ]) {
    const parameters = { ...tool.parameters, ...root };
    assert.ok(S.clean(parameters));
    assert.throws(() => G.compile(schema, V, { tools: [{ ...tool, parameters }] }), /parameters|schema/, JSON.stringify(root));
  }
  // These roots still admit exactly the object arguments the grammar writes.
  for (const type of [undefined, 'object', ['object', 'null']]) {
    const parameters = { ...tool.parameters };
    if (type === undefined) delete parameters.type; else parameters.type = type;
    const g = G.compile(schema, V, { tools: [{ ...tool, parameters }] });
    assert.equal(walk(g, ids(native('assignment_read', { course: '5521', assignment: '88121' }))), '');
  }
});

test('native memory enum parameters keep only valid raw string choices', () => {
  const inp = A.task.input({ question: 'I prefer short paragraphs.', tools: ['memory_save', 'memory_search'], now: NOW, zone: 'UTC' });
  const alternatives = A.constraint(inp).tools;
  assert.equal(A.SPECS.filter((t) => t.name === 'memory_save').length, 1, 'the public tool spec stays singular');
  assert.equal(alternatives.filter((t) => t.name === 'memory_save').length, 2, 'create and replace are grammar alternatives');
  assert.equal(alternatives.filter((t) => t.name === 'memory_search').length, 1, 'ordinary schemas retain one entry');
  const g = grammarFor(inp);
  assert.equal(g.exact, true);
  const saving = { text: 'Short paragraphs', evidence: 'I prefer short paragraphs.' };
  for (const category of [undefined, 'fact', 'preference']) {
    assert.equal(walk(g, ids(native('memory_save', { ...saving, ...(category && { category }) }))), '');
  }
  for (const category of ['system', 'Fact', 'preference\nforged']) {
    assert.notEqual(walk(g, ids(native('memory_save', { ...saving, category }))), '');
  }
  const id = `m-${'a'.repeat(32)}`, revision = 'b'.repeat(32);
  assert.equal(walk(g, ids(native('memory_save', { ...saving, id, revision }))), '');
  for (const incomplete of [{ id }, { revision }]) {
    assert.notEqual(walk(g, ids(native('memory_save', { ...saving, ...incomplete }))), '', 'replacement identity is a pair');
  }
  for (const kind of [undefined, 'memory', 'course']) {
    assert.equal(walk(g, ids(native('memory_search', { query: 'paragraphs', ...(kind && { kind }) }))), '');
  }
  const { schema } = A.constraint(inp);
  for (const category of [{ type: 'string', const: 'fact' }, { type: 'string', anyOf: [{ enum: ['fact'] }] }, { type: 'integer', enum: [1] }]) {
    const parameters = S.obj({ category }, ['category']);
    assert.throws(() => G.compile(schema, V, { tools: [{ name: 'example', parameters }] }), /parameter/);
  }
});

// ---- the engine host takes the constraint ------------------------------------------------------------------------------
const HERE = path.join(__dirname, '../../extension/ai/local');
const BYTES = (() => {
  const keep = [];
  for (let b = 33; b <= 126; b++) keep.push(b);
  for (let b = 161; b <= 172; b++) keep.push(b);
  for (let b = 174; b <= 255; b++) keep.push(b);
  let n = 0;
  const tokens = Array.from({ length: 256 }, (_, b) => String.fromCharCode(keep.includes(b) ? b : 256 + n++)), types = tokens.map(() => 1);
  for (const [t, ty] of [['<|startoftext|>', 3], ['<|im_start|>', 3], ['<|im_end|>', 3], ['<think>', 4], ['</think>', 4], ...G.TOOL_MARKS.map((t) => [t, 4])]) { tokens.push(t); types.push(ty); }
  return { tokens, types, merges: [], pre: 'lfm2', bos: tokens.indexOf('<|startoftext|>'), eos: tokens.indexOf('<|im_end|>') };
})();

const fixedHost = (kv, reply) => {
  const posted = [], decodes = [];
  const host = H.create({
    store: { status: async () => ({ state: 'ready' }), open: async () => ({ size: 1 }) },
    gguf: { open: async () => ({ kv }) }, tokenizer: K, grammar: () => G, ladder: () => null,
    gpu: () => ({ requestAdapter: async () => ({}) }),
    engine: () => ({ load: async () => {
      const tok = K.load(kv), output = [...tok.encodeWith(reply)];
      let i = 0;
      return { context: 16000, release() {}, snapshot: async () => ({ pos: 0, drop() {} }), restore: async () => { i = 0; },
        prefill: async (list, { snapshot } = {}) => { i = 0; return snapshot ? { pos: list.length, drop() {} } : undefined; },
        decode: async ({ mask }) => { const id = output[i++] ?? tok.eos; assert.ok(allowed(mask, id)); decodes.push(id); return id; } };
    } }),
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, now: () => 0,
    post: (m) => posted.push(structuredClone(m)),
  });
  let id = 0;
  return { host, decodes, async run(constraint) {
    const request = ++id;
    await host.handle({ id: request, op: 'run', model: 'glaze-q4', parts: [{ text: 'Answer.' }], stable: 1,
      sampler: {}, maxTokens: 128, ...constraint });
    return posted.find((m) => m.id === request && ['done', 'error'].includes(m.type));
  } };
};

test('the host preserves native tool tags when the tokenizer marks them as control tokens', async (t) => {
  const kv = { ...BYTES, types: BYTES.types.map((ty, i) => G.TOOL_MARKS.includes(BYTES.tokens[i]) ? K.TYPES.control : ty) };
  const reply = native('assignment_read', { course: '5521', assignment: '88121' });
  const h = fixedHost(kv, reply);
  t.after(() => h.host.release());
  const end = await h.run(A.constraint(ALL));
  assert.equal(end?.type, 'done', JSON.stringify(end));
  assert.equal(end.result.text, reply.map((p) => p.special ?? p.text).join(''));
  assert.deepEqual(A.fromNative(end.result.text), { call: { name: 'assignment_read', arguments: { course: '5521', assignment: '88121' } }, answer: null });
});

for (const invalidFirst of [false, true]) test(`the host separates absent tools from null in its grammar cache (invalid first: ${invalidFirst})`, async (t) => {
  const h = fixedHost(BYTES, [{ text: '{"text":"x","quotes":[]}' }]);
  t.after(() => h.host.release());
  for (const invalid of invalidFirst ? [true, false] : [false, true]) {
    const before = h.decodes.length;
    const end = await h.run({ schema: A.ANSWER, ...(invalid && { tools: null }) });
    assert.equal(end?.type, invalid ? 'error' : 'done', JSON.stringify(end));
    if (invalid) {
      assert.equal(end.error.reason, 'unsupported');
      assert.equal(h.decodes.length, before, 'invalid tools refused before decoding');
    } else assert.deepEqual(JSON.parse(end.result.text), { text: 'x', quotes: [] });
  }
});

test('the host runs a turn under the constraint: the D4 call with a parameter its tool doesn\'t take comes out a call it does', async () => {
  const posted = [], decodes = [];
  const store = { list: async () => [{ id: 'glaze-q4', tier: 1, size: 1, state: 'ready' }], status: async () => ({ state: 'ready' }), open: async (id) => ({ id, size: 1, read: async () => new Uint8Array(0) }) };
  const E = { load: async (g) => {
    const tok = K.load(g.kv);
    // (A model without the tool tags has no such reply.)
    const reply = tok.id('<tool_call>') === undefined ? [] : [...tok.encodeWith([...native('documents_list', { from: 0 }).slice(0, -3), { special: '<parameter=' }, { text: 'page>\n0\n' }, { special: '</parameter>' }, { text: '\n' }, ...native('documents_list', {}).slice(-3)])];
    let i = 0;
    return { context: 16000, release() {}, snapshot: async () => ({ pos: 0, drop() {} }), restore: async () => {},
      prefill: async (list, { snapshot } = {}) => { i = 0; return snapshot ? { pos: list.length, drop() {} } : undefined; },
      decode: async ({ mask } = {}) => {
        // The stub writes D4's turn; where the mask refuses its token, it takes the lowest one the mask allows.
        let id = i < reply.length ? reply[i++] : tok.eos;
        if (mask && !allowed(mask, id)) { id = 0; while (!allowed(mask, id)) id++; }
        decodes.push({ id, masked: !!mask });
        return id;
      } };
  } };
  const host = H.create({ store, gguf: { open: async () => ({ kv: BYTES }) }, tokenizer: K, engine: () => E, grammar: () => G, ladder: () => null,
    gpu: () => ({ requestAdapter: async () => ({}) }), setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, now: () => 0, post: (m) => posted.push(structuredClone(m)) });
  const c = A.constraint(ALL);
  const parts = [{ special: '<|startoftext|>' }, { special: '<|im_start|>' }, { text: 'system\nAnswer.' }, { special: '<|im_end|>' }, { special: '<|im_start|>' }, { text: 'assistant\n' }];
  host.handle({ id: 1, op: 'run', model: 'glaze-q4', parts, stable: 4, schema: c.schema, tools: c.tools, sampler: {}, maxTokens: 64 });
  for (let n = 0; n < 400 && !posted.some((m) => m.id === 1 && ['done', 'error'].includes(m.type)); n++) await new Promise(setImmediate);
  const end = posted.find((m) => m.id === 1 && ['done', 'error'].includes(m.type));
  assert.equal(end?.type, 'done', JSON.stringify(end));
  assert.equal(end.result.finish, 'stop');
  assert.deepEqual(A.fromNative(end.result.text), { call: { name: 'documents_list', arguments: { from: 0 } }, answer: null }, end.result.text);
  assert.ok(decodes.every((d) => d.masked));
  // Without the tags' ids the host refuses a run with tools, as any schema its grammar can't take.
  posted.length = 0;
  const bare = { ...BYTES, tokens: BYTES.tokens.slice(0, -G.TOOL_MARKS.length), types: BYTES.types.slice(0, -G.TOOL_MARKS.length) };
  const plain = H.create({ store, gguf: { open: async () => ({ kv: bare }) }, tokenizer: K, engine: () => E, grammar: () => G, ladder: () => null,
    gpu: () => ({ requestAdapter: async () => ({}) }), setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref?.(); return t; }, now: () => 0, post: (m) => posted.push(structuredClone(m)) });
  plain.handle({ id: 2, op: 'run', model: 'glaze-q4', parts, stable: 4, schema: c.schema, tools: c.tools, sampler: {}, maxTokens: 64 });
  for (let n = 0; n < 400 && !posted.some((m) => m.id === 2 && ['done', 'error'].includes(m.type)); n++) await new Promise(setImmediate);
  const refused = posted.find((m) => m.id === 2 && ['done', 'error'].includes(m.type));
  assert.equal(refused?.type, 'error');
  assert.equal(refused.error.reason, 'unsupported');
});

test('constraint(): the answer\'s schema as OUTPUT holds it, and the offered tools as the layout lists them', () => {
  const two = A.task.input({ question: 'x', tools: ['todo_list', 'grades_list'], now: NOW, zone: 'UTC' });
  const c = A.constraint(two);
  assert.deepEqual(c.schema, A.OUTPUT.properties.answer.anyOf[1]);
  assert.deepEqual(c.tools.map((t) => t.name), ['grades_list', 'todo_list']);
  assert.deepEqual(c.tools[1].parameters, A.SPECS.find((t) => t.name === 'todo_list').parameters);
});
