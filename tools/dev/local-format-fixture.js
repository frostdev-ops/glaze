#!/usr/bin/env node
// Writes test/fixtures/ai/local-format/cases.json and vocab.json for test/ai/local-format-ids.test.js: the token ids the
// Glaze fine-tune was trained to read (glaze-plans/lfm-tune FORMAT.md, made by its train/format.js), for requests Glaze's
// real tasks build from inputs.json, so the test can hold ai/local/format.js and ai/local/tokenizer.js to them id for id
// without either file or LFM3's 18 MB tokenizer.json at run time.
// Each run of inputs.json goes through ai/task.js run() with the `local` provider (a Glaze-tuned model, context 4096 as
// FORMAT.md's inference section says) whose host answers nothing, so every request a task makes before it gives up is
// caught, with the arguments ai/text.js request() was given (system, context, data) and any instruction a task appended
// to the system message afterwards (writer.feedback's repairs). Expected ids: train/format.js prompt() on those, each
// special by its id and each text run encoded on its own with specials off (train/tokens.js), by ai/local/tokenizer.js on
// LFM3's tokenizer.json with the model's 128,000 rows and GLAZE_TOKENS added. vocab.json is that tokenizer cut to the
// tokens and merges these prompts reach (the BPE merges that build each token they use, all their ancestors, in rank
// order; every byte; every added token), checked here to give exactly the full tokenizer's ids.
//   node tools/dev/local-format-fixture.js --format <lfm-tune/train/format.js> --hf <LFM3 tokenizer.json>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const FORMAT = arg('format'), HF = arg('hf');
if (!FORMAT || !HF) { console.error('usage: node tools/dev/local-format-fixture.js --format <train/format.js> --hf <tokenizer.json>'); process.exit(2); }
const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'test', 'fixtures', 'ai', 'local-format');
const E = (f) => require(path.join(ROOT, 'extension', f));
const TF = require(path.resolve(FORMAT));
const X = E('ai/text.js'), R = E('ai/request.js'), T = E('ai/task.js'), F = E('ai/local/format.js'), K = E('ai/local/tokenizer.js'), LOCAL = E('ai/providers/local.js');
for (const f of ['syllabus-read', 'writer-complete', 'writer-review', 'writer-feedback', 'writer-outline', 'writer-requirements', 'writer-cite', 'writer-decide']) E(`ai/tasks/${f}.js`);
const ROWS = 128000;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const hfText = fs.readFileSync(path.resolve(HF));
const hf = JSON.parse(hfText);
const full = K.fromHF(hf, { rows: ROWS });
for (const t of K.GLAZE_TOKENS) full.add(t);
K.GLAZE_TOKENS.forEach((t, i) => { if (full.id(t) !== TF.FIRST_ID + i) throw new Error(`${t}: id ${full.id(t)}`); });

// ---- the requests Glaze's tasks build ---------------------------------------------------------------------------------
const inputs = JSON.parse(fs.readFileSync(path.join(OUT, 'inputs.json'), 'utf8'));
const fill = (v) => (v === '$context' ? inputs.context : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
const userKey = (messages) => JSON.stringify(messages.slice(1).map((m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text))));
const sysText = (m) => (typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join(''));
let built = [];
const request = X.request;
X.request = (args) => {
  const req = request(args);
  built.push({ user: userKey(req.messages), rendered: sysText(req.messages[0]), system: args.system,
    context: (args.context || []).map(({ label, text, cache }) => ({ label, text, ...(cache === true && { cache }) })),
    data: (args.data || []).map(({ label, text, cache }) => ({ label, text, ...(cache === true && { cache }) })) });
  return req;
};
let seen = [];
LOCAL._env({
  store: { list: async () => [{ id: 'glaze-tuned', tier: 1, size: 1, state: 'ready' }] },
  link: { kind: 'worker', up: true, call: async (op) => (op === 'run' ? { text: '', finish: 'stop' } : {}) },
  gpu: () => ({}),
});
const provider = { ...LOCAL, run: (req, cfg, o) => { seen.push(req); return LOCAL.run(req, cfg, o); } };

(async () => {
  const cases = [], keys = new Set();
  for (const r of inputs.runs) {
    built = []; seen = [];
    try { await T.run(T.get(r.task), fill(r.input), { provider, cfg: { context: 4096 } }); } catch { /* the host answered nothing */ }
    if (!seen.length) throw new Error(`${r.name}: no request reached the provider`);
    seen.forEach((req, i) => {
      if (req.task?.id !== r.task) throw new Error(`${r.name}: the request's task is ${req.task?.id}`);
      const sys = sysText(req.messages[0]), args = [...built].reverse().find((b) => b.user === userKey(req.messages) && sys.startsWith(b.rendered));
      if (!args) throw new Error(`${r.name}: call ${i} was not built by text.request`);
      const amend = sys.slice(args.rendered.length);
      const c = { name: seen.length > 1 ? `${r.name} #${i + 1}` : r.name, task: r.task, system: args.system, ...(amend && { amend }), context: args.context, data: args.data, ...(req.schema && { schema: req.schema }) };
      const key = JSON.stringify([c.task, c.system, c.amend, c.context, c.data, c.schema]);
      if (!keys.has(key)) { keys.add(key); cases.push(c); }
    });
  }

  // ---- expected ids: train/format.js and LFM3's tokenizer ------------------------------------------------------------
  const strip = (blocks) => blocks.map(({ label, text }) => ({ label, text }));
  const segments = (c) => TF.runs(TF.prompt({ task: c.task, system: c.system + (c.amend || ''), context: strip(c.context), data: strip(c.data), schema: c.schema || null }));
  const idsOf = (tok, segs) => segs.flatMap((s) => (s.s !== undefined ? [tok.id(s.s)] : [...tok.encode(s.t)]));
  for (const c of cases) c.ids = idsOf(full, segments(c));

  // ---- the tokenizer cut to what these prompts reach --------------------------------------------------------------------
  const m = hf.model, byId = [];
  for (const [t, id] of Object.entries(m.vocab)) byId[id] = t;
  const pairs = m.merges.map((x) => (Array.isArray(x) ? x : x.split(' ')));
  const makes = new Map(); // token → indices of the merges that make it
  pairs.forEach(([a, b], i) => { const t = a + b; if (!makes.has(t)) makes.set(t, []); makes.get(t).push(i); });
  const keep = new Set(), merges = new Set();
  const reach = (t) => {
    if (keep.has(t)) return;
    keep.add(t);
    for (const i of makes.get(t) || []) { merges.add(i); reach(pairs[i][0]); reach(pairs[i][1]); }
  };
  for (const c of cases) for (const id of c.ids) if (byId[id] !== undefined) reach(byId[id]);
  // Every byte's own token (the tokenizer refuses a vocabulary without them).
  for (let b = 0, n = 0; b < 256; b++) reach(String.fromCharCode((b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174 ? b : 256 + n++));
  const tokens = {};
  for (const t of keep) { const id = m.vocab[t]; if (id === undefined) throw new Error(`no id for ${JSON.stringify(t)}`); tokens[id] = t; }
  const pre = Object.keys(K.PRE).find((k) => K.PRE[k].hf === hf.pre_tokenizer.pretokenizers[0].pattern.Regex);
  const vocab = { size: byId.length + hf.added_tokens.length, rows: ROWS, pre, ignoreMerges: !!m.ignore_merges, tokens,
    added: hf.added_tokens.map((a) => [a.id, a.content, a.special ? 1 : 0]), merges: [...merges].sort((a, b) => a - b).map((i) => pairs[i].join(' ')) };

  // The cut tokenizer, as the test loads it, gives the full one's ids for every prompt.
  const cut = require(path.join(ROOT, 'test', 'helpers', 'local-vocab.cjs'))(vocab);
  for (const c of cases) {
    const got = idsOf(cut, segments(c));
    if (JSON.stringify(got) !== JSON.stringify(c.ids)) throw new Error(`${c.name}: the cut tokenizer differs`);
  }
  // And Glaze's own path, for the record (the test is what holds it).
  let same = 0;
  for (const c of cases) {
    const req = X.request({ system: c.system, context: c.context, data: c.data });
    if (c.amend) req.messages[0].content += c.amend;
    const got = [...cut.encodeWith(F.format(R.clean({ ...req, ...(c.schema && { schema: c.schema }), task: { id: c.task, version: 1 } })).parts)];
    if (JSON.stringify(got) === JSON.stringify(c.ids)) same++; else console.log(`differs: ${c.name}`);
  }

  const commit = (() => { try { return execFileSync('git', ['-C', ROOT, 'rev-parse', '--short=8', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } })();
  const made = { by: 'node tools/dev/local-format-fixture.js --format <glaze-plans/lfm-tune/train/format.js> --hf <LiquidAI/LFM3-1.7B tokenizer.json>',
    format: `train/format.js sha256 ${sha(fs.readFileSync(path.resolve(FORMAT)))}`, tokenizer: `tokenizer.json sha256 ${sha(hfText)}, ${ROWS} rows, GLAZE_TOKENS added`, glaze: commit };
  fs.writeFileSync(path.join(OUT, 'cases.json'), `${JSON.stringify({ made, cases }, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT, 'vocab.json'), `${JSON.stringify({ made, ...vocab })}\n`);
  console.log(`${cases.length} cases (${[...new Set(cases.map((c) => c.task))].length} tasks), ${Object.keys(tokens).length} tokens, ${vocab.merges.length} merges; Glaze's formatter matches ${same}/${cases.length}`);
})().catch((e) => { console.error(e); process.exit(1); });

