// Glaze's own model reads exactly what its fine-tune was trained on (glaze-plans/lfm-tune FORMAT-v2.md): for a request of each
// task the fine-tune covers, ai/local/format.js and ai/local/tokenizer.js give, id for id, the prompt train/format.js and
// LFM3's tokenizer give, in direct mode and, for a think task, in think mode; the host's force-close is the trained one, and
// the provider thinks for the tasks and budget training did (test/fixtures/ai/local-format, made by
// tools/dev/local-format-fixture.js, which says how). The
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
const { cases, think: THINK } = require('../fixtures/ai/local-format/cases.json');
const inputs = require('../fixtures/ai/local-format/inputs.json');
const tok = require('../helpers/local-vocab.cjs')(require('../fixtures/ai/local-format/vocab.json'));
for (const f of ['syllabus-read', 'writer-complete', 'writer-review', 'writer-feedback', 'writer-outline', 'writer-requirements', 'writer-cite', 'writer-decide']) require(`../../extension/ai/tasks/${f}.js`);

// The tasks FORMAT.md v1 trains: every task with a token but writer.image (pictures need LFM3-VL) and the two its addendum
// adds (FORMAT-new-tasks.md: study.help, agent.tools), whose cases come once train/format.js has their tokens; until then
// ai-study-help.test.js and ai-agent-tools.test.js hold their layouts.
const TRAINED = F.TASKS.filter((t) => !['writer.image', 'study.help', 'agent.tools'].includes(t));
const SPECIAL = { added: 124893, bos: 124894, start: 124899, end: 124900 }; // added: LFM3's first added token (<|pad|>)
// A case as a request: what ai/text.js request() makes of its arguments, an instruction the task appended to the system
// message after it (writer.feedback's repairs), the schema and the task as ai/task.js adds them.
const requestOf = (c) => {
  const req = X.request({ system: c.system, context: c.context, data: c.data });
  if (c.amend) req.messages[0].content += c.amend;
  return R.clean({ ...req, ...(c.schema && { schema: c.schema }), task: { id: c.task, version: 1 } });
};
const idsOf = (c, think = false) => [...tok.encodeWith(F.format(requestOf(c), { think }).parts)];
const firstDiff = (a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return i; };

test('every trained task\'s prompt is the fine-tune\'s, id for id, through its mode\'s prefill: direct, and think for a think task', () => {
  assert.deepEqual([...new Set(cases.map((c) => c.task))].sort(), [...TRAINED].sort(), 'a case for each trained task');
  assert.deepEqual([...new Set(cases.filter((c) => c.think).map((c) => c.task))].sort(), TRAINED.filter((t) => THINK.tasks.includes(t)).sort(), 'think cases for each trained think task');
  const same = (name, got, want) => {
    const at = firstDiff(got, want);
    assert.ok(got.length === want.length && at === got.length,
      `${name}: first difference at id ${at} of ${want.length}: Glaze ${JSON.stringify(tok.decode(got.slice(Math.max(0, at - 6), at + 10), { specials: true }))}, trained ${JSON.stringify(tok.decode(want.slice(Math.max(0, at - 6), at + 10), { specials: true }))}`);
  };
  for (const c of cases) {
    same(c.name, idsOf(c), c.ids);
    if (c.think) same(`${c.name} (think)`, idsOf(c, true), c.think);
  }
  // The pieces FORMAT-v2 names, by id: BOS once and first, the task's token right after `system\n`, the prompt ending
  // `<|im_start|>assistant\n` and then <think></think> (direct) or <think>\n (think); both modes alike up to the header.
  const header = [SPECIAL.start, ...tok.encode('assistant\n')], think = [tok.id('<think>'), tok.id('</think>')];
  assert.deepEqual(think, [124901, 124902]);
  for (const c of cases) {
    assert.equal(c.ids.filter((id) => id === SPECIAL.bos).length, 1, c.name);
    assert.deepEqual(c.ids.slice(0, 2), [SPECIAL.bos, SPECIAL.start], c.name);
    assert.equal(c.ids[2 + tok.encode('system\n').length], 125037 + K.GLAZE_TOKENS.slice(4).indexOf(`<|gz_task:${c.task}|>`), c.name);
    assert.deepEqual(c.ids.slice(-(header.length + 2)), [...header, ...think], c.name);
    if (!c.think) continue;
    assert.deepEqual(c.think.slice(-(header.length + 1 + tok.encode('\n').length)), [...header, think[0], ...tok.encode('\n')], c.name);
    assert.deepEqual(c.think.slice(0, c.ids.length - 2), c.ids.slice(0, -2), `${c.name}: one prompt up to the prefill`);
  }
});

test('think mode as trained: the host\'s force-close is FORMAT-v2\'s `\\n</think>`, nothing follows the model\'s own </think>, and the provider thinks for training\'s tasks and budget', () => {
  const c = cases.find((x) => x.think);
  const { think } = F.format(requestOf(c), { think: true });
  assert.deepEqual([...tok.encodeWith(think.close)], THINK.close);
  assert.deepEqual(THINK.close, [...tok.encode('\n'), tok.id('</think>')]);
  assert.deepEqual(think.after, [], 'the answer right after </think>');
  // A task's budget, or each of its calls' (writer.feedback's): only tasks training thought may think, at its budget; D4
  // picks which of them do.
  const budgets = (t) => (typeof LOCAL.THINK[t] === 'number' ? [LOCAL.THINK[t]] : Object.values(LOCAL.THINK[t]));
  for (const t of Object.keys(LOCAL.THINK).filter((x) => budgets(x).some((b) => b > 0))) assert.ok(THINK.tasks.includes(t), `${t} thinks untrained`);
  for (const t of THINK.tasks) assert.ok(budgets(t).every((b) => b === 0 || b === THINK.budget), t);
  assert.deepEqual(Object.keys(LOCAL.THINK).sort(), [...F.TASKS].sort(), 'one row for each task');
  assert.throws(() => F.format(requestOf(c), { dialect: 'chatml', think: true }), /think/, 'a stock model never thinks');
});

test('page text that spells Glaze\'s tokens, a turn or a fence stays text: specials only where the format puts them', () => {
  const c = cases.find((x) => x.data.some((d) => d.text.includes('<|gz_ctx|>')));
  assert.ok(c, 'a case whose page text spells <|gz_ctx|>');
  const ids = idsOf(c), specials = ids.filter((id) => id >= SPECIAL.added);
  // bos; system turn: start, task, end; user turn: start, each block's two, end; assistant: start, <think>, </think>.
  assert.equal(specials.length, 1 + 3 + 1 + 2 * (c.context.length + c.data.length) + 1 + 1 + 2, tok.decode(specials, { specials: true }));
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
  const covered = new Set(), calls = new Set();
  // writer.feedback's kinds of request, by the system text each was trained on (lfm-tune FORMAT-v2's think data).
  const KINDS = [['decide', 'Decide only the supplied criterion'], ['explain', 'Explain only this checked criterion decision'],
    ['summary', 'Summarize only the checked assessments'], ['scan', 'Read this entire source chunk']];
  try {
    for (const r of inputs.runs) {
      built = []; seen = []; sent = [];
      await T.run(T.get(r.task), fill(r.input), { provider, cfg: { context: 4096 } }).catch(() => {});
      assert.ok(seen.length && seen.length === sent.length, `${r.name}: its requests reach the host`);
      seen.forEach((req, i) => {
        const at = `${r.name}, request ${i + 1}`, sys = sysText(req.messages[0]);
        const b = [...built].reverse().find((x) => x.user === userKey(req.messages) && sys.startsWith(x.rendered));
        assert.ok(b, `${at}: built by text.request`);
        const call = r.task === 'writer.feedback' ? KINDS.find(([, start]) => b.args.system.startsWith(start))?.[0] : undefined;
        assert.deepEqual(req.task, { id: r.task, version: T.get(r.task).version, ...(call && { call }) }, at);
        if (r.task === 'writer.feedback') { assert.ok(call, `${at}: a Feedback request of a known kind`); calls.add(call); }
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
  assert.ok(calls.size, 'Feedback\'s requests name their kind (writer-feedback-flow.test.js runs every kind)');
});

test('models.json: the text models are Rime, read in Glaze\'s format (no `stock`); the picture model stays stock', async () => {
  const text = SHIPPED.models.filter((m) => !m.role);
  assert.deepEqual(text.map((m) => m.id), ['rime-1.7b-q4_k_m', 'rime-1.7b-q6_k', 'rime-1.7b-q8_0']);
  for (const m of text) assert.equal('stock' in m, false, m.id);
  assert.equal(SHIPPED.models.find((m) => m.role === 'pictures').stock, true);
  // A stock text entry as tools/vendor/model-manifest.js writes it with --stock, listed by the real store beside Rime:
  // it keeps `stock`, Rime has none.
  const stock = { ...text[0], id: 'lfm3-1.7b-q4_k_m', name: 'LFM3 1.7B Q4_K_M', stock: true };
  const gone = async () => { throw Object.assign(new Error('missing'), { name: 'NotFoundError' }); };
  const store = STORE.create({ models: [stock, text[0]], root: async () => ({ getDirectoryHandle: gone }), locks: null, channel: null });
  const listed = await store.list();
  assert.equal(listed.find((m) => m.id === stock.id).stock, true);
  assert.equal('stock' in listed.find((m) => m.id === text[0].id), false);
  // The provider picks the dialect by it.
  const c = cases.find((x) => x.task === 'writer.decide');
  for (const [m, dialect] of [[{ ...listed[0], state: 'ready' }, 'chatml'], [{ ...listed[1], state: 'ready' }, 'glaze']]) {
    let parts;
    LOCAL._env({ store: { list: async () => [m] }, link: { kind: 'worker', up: true, call: async (op, x) => { if (op === 'run') parts = x.parts; return { text: '{"verdict":"keep","choice":null}', finish: 'stop' }; } }, gpu: () => ({}) });
    try { await LOCAL.run(requestOf(c), LOCAL.config({})); } finally { LOCAL._env(null); }
    assert.deepEqual(parts, F.format(requestOf(c), { dialect }).parts, `${m.id}: ${dialect}`);
  }
});
