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
const V = G.vocab(TOK.byteStrings(), { eos: [TOK.eos], marks: MARKS });
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
  return m.complete && allowed(m.mask(), TOK.eos) ? '' : 'not whole';
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
      const id = list.includes(TOK.eos) && rnd() < 0.6 ? TOK.eos : list[Math.floor(rnd() * list.length)];
      m.advance(id);
      if (id !== TOK.eos) out.push(id);
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

test('a pattern the grammar can\'t hold leaves it inexact; the patterns Glaze writes are held exactly, in JSON strings too', () => {
  const plain = G.vocab(TOK.byteStrings(), { eos: [TOK.eos] });
  assert.equal(G.compile({ type: 'string', pattern: '\\w+' }, plain).exact, false);
  assert.equal(G.compile({ type: 'string', pattern: 'abc' }, plain).exact, false, 'unanchored');
  const g = G.compile(S.obj({ id: { type: 'string', pattern: '^(\\d{1,20}|_\\d{1,20}_\\d{1,20})$' } }, ['id']), plain);
  assert.equal(g.exact, true);
  for (const [text, ok] of [['{"id":"88121"}', true], ['{"id":"_1_2"}', true], ['{"id":"_1"}', false], ['{"id":"a1"}', false], ['{"id":""}', false]]) assert.equal(walk(g, ids(text)) === '', ok, text);
  assert.throws(() => G.compile(A.constraint(ALL).schema, plain, { tools: A.constraint(ALL).tools }), /marks/, 'calls need the tool tags\' ids');
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

test('the host runs a turn under the constraint: the D4 call with a parameter its tool doesn\'t take comes out a call it does', async () => {
  const posted = [], decodes = [];
  const store = { list: async () => [{ id: 'glaze-q4', tier: 1, size: 1, state: 'ready' }], status: async () => ({ state: 'ready' }), open: async (id) => ({ id, size: 1, read: async () => new Uint8Array(0) }) };
  const E = { load: async (g) => {
    const tok = K.load(g.kv);
    const reply = [...tok.encodeWith([...native('documents_list', { from: 0 }).slice(0, -3), { special: '<parameter=' }, { text: 'page>\n0\n' }, { special: '</parameter>' }, { text: '\n' }, ...native('documents_list', {}).slice(-3)])];
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
