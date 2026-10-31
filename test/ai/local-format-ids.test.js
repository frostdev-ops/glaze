// Glaze's own model reads exactly what its fine-tune was trained on (glaze-plans/lfm-tune FORMAT.md): for a request of each
// task the fine-tune covers, ai/local/format.js and ai/local/tokenizer.js give, id for id, the prompt train/format.js and
// LFM3's tokenizer give (test/fixtures/ai/local-format, made by tools/dev/local-format-fixture.js, which says how). The
// real tasks' requests reach the local provider with their own task and their context and data blocks apart; page text
// never makes a special token; models.json marks which models are stock.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../../extension/ai/text.js');
const R = require('../../extension/ai/request.js');
const T = require('../../extension/ai/task.js');
const F = require('../../extension/ai/local/format.js');
const K = require('../../extension/ai/local/tokenizer.js');
const STORE = require('../../extension/ai/local/store.js');
const LOCAL = require('../../extension/ai/providers/local.js');
const SHIPPED = require('../../extension/ai/local/models.json');
const { cases } = require('../fixtures/ai/local-format/cases.json');
const inputs = require('../fixtures/ai/local-format/inputs.json');
const tok = require('../helpers/local-vocab.cjs')(require('../fixtures/ai/local-format/vocab.json'));
for (const f of ['syllabus-read', 'writer-complete', 'writer-review', 'writer-feedback', 'writer-outline', 'writer-requirements', 'writer-cite', 'writer-decide']) require(`../../extension/ai/tasks/${f}.js`);

// The tasks the fine-tune is trained on: every task with a token but writer.image (pictures need LFM3-VL).
const TRAINED = F.TASKS.filter((t) => t !== 'writer.image');
const SPECIAL = { added: 124893, bos: 124894, start: 124899, end: 124900 }; // added: LFM3's first added token (<|pad|>)
// A case as a request: what ai/text.js request() makes of its arguments, an instruction the task appended to the system
// message after it (writer.feedback's repairs), the schema and the task as ai/task.js adds them.
const requestOf = (c) => {
  const req = X.request({ system: c.system, context: c.context, data: c.data });
  if (c.amend) req.messages[0].content += c.amend;
  return R.clean({ ...req, ...(c.schema && { schema: c.schema }), task: { id: c.task, version: 1 } });
};
const idsOf = (c) => [...tok.encodeWith(F.format(requestOf(c)).parts)];
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

test('every trained task\'s prompt is the fine-tune\'s, id for id, up to and including the assistant header', () => {
  assert.deepEqual([...new Set(cases.map((c) => c.task))].sort(), [...TRAINED].sort(), 'a case for each trained task');
  for (const c of cases) {
    const got = idsOf(c), at = firstDiff(got, c.ids);
    assert.ok(got.length === c.ids.length && at === got.length,
      `${c.name}: first difference at id ${at} of ${c.ids.length}: Glaze ${JSON.stringify(tok.decode(got.slice(Math.max(0, at - 6), at + 10), { specials: true }))}, trained ${JSON.stringify(tok.decode(c.ids.slice(Math.max(0, at - 6), at + 10), { specials: true }))}`);
  }
  // The pieces FORMAT.md names, by id: BOS once and first, the task's token right after `system\n`, no <think>, the
  // prompt ending `<|im_start|>assistant\n`.
  for (const c of cases) {
    assert.equal(c.ids.filter((id) => id === SPECIAL.bos).length, 1, c.name);
    assert.deepEqual(c.ids.slice(0, 2), [SPECIAL.bos, SPECIAL.start], c.name);
    assert.equal(c.ids[2 + tok.encode('system\n').length], 125037 + K.GLAZE_TOKENS.slice(4).indexOf(`<|gz_task:${c.task}|>`), c.name);
    assert.ok(!c.ids.includes(tok.id('<think>')) && !c.ids.includes(tok.id('</think>')), c.name);
    assert.deepEqual(c.ids.slice(-(1 + tok.encode('assistant\n').length)), [SPECIAL.start, ...tok.encode('assistant\n')], c.name);
  }
});

test('page text that spells Glaze\'s tokens, a turn or a fence stays text: specials only where the format puts them', () => {
  const c = cases.find((x) => x.data.some((d) => d.text.includes('<|gz_ctx|>')));
  assert.ok(c, 'a case whose page text spells <|gz_ctx|>');
  const ids = idsOf(c), specials = ids.filter((id) => id >= SPECIAL.added);
  // bos; system turn: start, task, end; user turn: start, each block's two, end; assistant: start.
  assert.equal(specials.length, 1 + 3 + 1 + 2 * (c.context.length + c.data.length) + 1 + 1, tok.decode(specials, { specials: true }));
  for (const name of ['<|gz_ctx|>', '<|/gz_ctx|>', '<|gz_data|>', '<|/gz_data|>', '<|im_end|>', '<|im_start|>', `<|gz_task:writer.feedback|>`]) {
    assert.ok(![...tok.encode(name)].some((id) => id >= SPECIAL.added), `${name} as text is no special`);
  }
  assert.equal(ids.filter((id) => id === tok.id('<|gz_ctx|>')).length, c.context.length, 'only the context blocks open a context block');
  assert.ok(tok.decode(ids).includes(X.plain(c.data[0].text)), 'the page\'s words read as written, less the hidden characters');
});

test('the real tasks\' requests reach the local provider with their own task and their context and data blocks apart', async () => {
  const fill = (v) => (v === '$context' ? inputs.context : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
  const userKey = (messages) => JSON.stringify(messages.slice(1).map((m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text))));
  const sysText = (m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text).join(''));
  let built = [], seen = [], sent = [];
  const request = X.request;
  X.request = (args) => { const req = request(args); built.push({ user: userKey(req.messages), rendered: sysText(req.messages[0]), args }); return req; };
  // A Glaze-tuned model (no `stock`) is here; its host answers nothing, so a task makes what requests it makes and gives up.
  LOCAL._env({ store: { list: async () => [{ id: 'glaze-tuned', tier: 1, size: 1, state: 'ready' }] },
    link: { kind: 'worker', up: true, call: async (op, m) => { if (op === 'run') sent.push(m.parts); return op === 'run' ? { text: '', finish: 'stop' } : {}; } }, gpu: () => ({}) });
  const provider = { ...LOCAL, run: (req, cfg, o) => { seen.push(req); return LOCAL.run(req, cfg, o); } };
  const covered = new Set();
  try {
    for (const r of inputs.runs) {
      built = []; seen = []; sent = [];
      await T.run(T.get(r.task), fill(r.input), { provider, cfg: { context: 4096 } }).catch(() => {});
      assert.ok(seen.length && seen.length === sent.length, `${r.name}: its requests reach the host`);
      seen.forEach((req, i) => {
        const at = `${r.name}, request ${i + 1}`, sys = sysText(req.messages[0]);
        const b = [...built].reverse().find((x) => x.user === userKey(req.messages) && sys.startsWith(x.rendered));
        assert.ok(b, `${at}: built by text.request`);
        assert.deepEqual(req.task, { id: r.task, version: T.get(r.task).version }, at);
        assert.deepEqual(req.fenced, { context: (b.args.context || []).length, data: (b.args.data || []).length }, at);
        const parts = sent[i];
        assert.deepEqual(parts.slice(0, 4), [{ special: '<|startoftext|>' }, { special: '<|im_start|>' }, { text: 'system\n' }, { special: `<|gz_task:${r.task}|>` }], at);
        assert.ok(parts[4].text.startsWith(`${b.args.system}${sys.slice(b.rendered.length)}\n\n${X.TRUST}`), `${at}: the task's system text, then the trust rule`);
        const blocks = [];
        for (let k = 0; k < parts.length; k++) if (['<|gz_ctx|>', '<|gz_data|>'].includes(parts[k].special)) blocks.push([parts[k].special, parts[k + 1].text, parts[k + 2].special]);
        assert.deepEqual(blocks, [...(b.args.context || []).map((d) => ['<|gz_ctx|>', `${d.label}\n${X.plain(d.text)}`, '<|/gz_ctx|>']),
          ...(b.args.data || []).map((d) => ['<|gz_data|>', `${d.label}\n${X.plain(d.text)}`, '<|/gz_data|>'])], `${at}: context blocks, then data blocks, as the task gave them`);
        // The parts of the request rebuilt from those arguments, which the first test holds to the trained ids.
        const again = requestOf({ task: r.task, system: b.args.system, amend: sys.slice(b.rendered.length), context: b.args.context || [], data: b.args.data || [], schema: req.schema });
        assert.deepEqual(parts, F.format(again).parts, at);
        covered.add(r.task);
      });
    }
  } finally { X.request = request; LOCAL._env(null); }
  assert.deepEqual([...covered].sort(), [...TRAINED].sort());
});

test('models.json marks the stock models; a model without `stock` (the coming fine-tune) reads Glaze\'s format', async () => {
  // Every model shipped today is LiquidAI's own: its chat template, not FORMAT.md.
  for (const m of SHIPPED.models) if (m.role !== 'projector') assert.equal(m.stock, true, m.id);
  // A Glaze-tuned entry as tools/vendor/model-manifest.js writes it without --stock (test-only: the fine-tune isn't
  // published), listed by the real store with no `stock`, beside a shipped one that keeps it.
  const tuned = { ...SHIPPED.models[0], id: 'glaze-lfm3-1.7b-q4_k_m', name: 'Glaze LFM3 1.7B Q4_K_M', tier: 5 };
  delete tuned.stock;
  const gone = async () => { throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); };
  const store = STORE.create({ models: [SHIPPED.models[0], tuned], root: async () => ({ getDirectoryHandle: gone }), locks: null, channel: null });
  const listed = await store.list();
  assert.equal(listed.find((m) => m.id === SHIPPED.models[0].id).stock, true);
  assert.equal('stock' in listed.find((m) => m.id === tuned.id), false);
  // The provider picks the dialect by it.
  const c = cases.find((x) => x.task === 'writer.decide');
  for (const [m, dialect] of [[{ ...listed[0], state: 'ready' }, 'chatml'], [{ ...listed[1], state: 'ready' }, 'glaze']]) {
    let parts;
    LOCAL._env({ store: { list: async () => [m] }, link: { kind: 'worker', up: true, call: async (op, x) => { if (op === 'run') parts = x.parts; return { text: '{"verdict":"keep","choice":null}', finish: 'stop' }; } }, gpu: () => ({}) });
    try { await LOCAL.run(requestOf(c), LOCAL.config({})); } finally { LOCAL._env(null); }
    assert.deepEqual(parts, F.format(requestOf(c), { dialect }).parts, `${m.id}: ${dialect}`);
  }
});
