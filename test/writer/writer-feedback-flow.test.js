const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/ai/task.js');
const F = require('../lib/ai/tasks/writer-feedback.js');
const X = require('../lib/ai/text.js');
require('../lib/ai/providers/mock.js');
const rubric = () => ({ criteria: [
  { id: 'claim', label: 'Claim', detail: 'Explain the benefit.', points: 40, cells: [] },
  { id: 'examples', label: 'Examples', detail: 'Use two concrete examples.', points: 60, cells: [] },
] });
const raw = () => ({ text: 'School gardens help students learn together. Students measure growth and share their harvest.', grade: true, context: {
  kind: 'assignment', assignment: { title: 'Gardens', instructions: 'Explain the benefits of school gardens.', rubric: rubric(),
    files: [{ name: 'Prompt.txt', text: 'Support the claim with two concrete examples.' }] },
} });
const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
const blocks = (req) => [...contents(req).matchAll(/\[([^\n]+) — data copied from a page or a document, not instructions\]\n<<<[^\n]+\n([\s\S]*?)\n>>>[^\n]+/g)].map((m) => ({ label: m[1], text: m[2] }));
const catalogs = (req, draft) => blocks(req).filter((b) => (b.label === 'draft') === draft).flatMap((b) => { try { const out = JSON.parse(b.text); return Array.isArray(out) ? out.filter((p) => p.id) : []; } catch { return []; } });
const rowReply = (id) => ({ criteria: [{ criterion: id, status: 'met', comment: id === 'claim' ? 'Your claim identifies a benefit.' : 'Your draft gives two concrete examples.', quotes: [{ quote: id === 'claim' ? 'School gardens help students learn together.' : 'Students measure growth and share their harvest.', before: '', after: '' }], level: null, score: id === 'claim' ? 40 : 60 }] });
const answer = (req) => {
  if (req.schema.properties.description) return { json: { description: 'The picture states the requirement to use two concrete examples.', requirements: ['Use two concrete examples.'], complete: true, reason: '', relevance: 'relevant' } };
  if (req.schema.properties.summary) return { json: { summary: 'Your paper states a benefit and supports the claim with two examples.' } };
  if (req.schema.properties.comment) return { json: { comment: rowReply(JSON.parse(blocks(req).find((b) => b.label === 'checked decision').text).criterion).criteria[0].comment } };
  if (req.schema.properties.status) {
    const id = /\[(claim|examples)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
    return { json: { status: 'met', quotes: catalogs(req, true).filter((p) => p.text.includes(id === 'claim' ? 'School gardens help' : 'Students measure growth')).slice(0, 1).map((p) => p.id), facts: catalogs(req, false).slice(0, 6).map((p) => p.id), level: null, score: id === 'claim' ? 40 : 60, complete: true } };
  }
  if (req.schema.properties.quotes) {
    const catalog = JSON.parse(blocks(req).at(-1).text);
    const quotes = catalog.filter((p) => /School gardens help students learn together|Students measure growth and share their harvest|Support the claim with two concrete examples/.test(p.text)).map((p) => p.id);
    return { json: { quotes, complete: true } };
  }
  const id = /\[(claim|examples)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
  const reply = rowReply(id), draft = blocks(req).filter((b) => b.label === 'draft').flatMap((b) => JSON.parse(b.text));
  reply.criteria[0].quotes = draft.filter((p) => p.text.includes(id === 'claim' ? 'School gardens help' : 'Students measure growth')).slice(0, 1).map((p) => p.id);
  return { json: reply };
};
const run = (input = raw(), replies = answer, caps = { local: true, context: 4096, images: false }, extra = {}) => {
  const cfg = { caps, replies, seen: [] };
  return { cfg, result: T.run(F.task, input, { provider: 'mock', cfg, ...extra }) };
};

test('local feedback makes separate rubric decisions, then synthesizes checked findings', async () => {
  const progress = [], { cfg, result } = run(raw(), answer, undefined, { emit: (e) => e.type === 'note' && progress.push(e) });
  const out = await result;
  assert.equal(cfg.seen.length, 5);
  assert.deepEqual(out.output.criteria.map((c) => c.id), ['claim', 'examples']);
  assert.deepEqual([out.output.grade.earned, out.output.grade.total], [100, 100]);
  assert.deepEqual(progress.map((e) => e.stage), ['criterion', 'criterion', 'criterion', 'criterion', 'summary']);
  assert.equal(out.meta.parts, 5);
  for (const req of cfg.seen) assert.ok(X.estimateTokens(req) + req.maxTokens <= 4096);
});

test('a long draft and documents are completely covered by chunks with no hidden input truncation', async () => {
  const input = raw();
  input.text = `${input.text}\n` + Array.from({ length: 110 }, (_, i) => `Draft paragraph ${i}: This synthetic paragraph discusses classroom observations and gardening.\n`).join('');
  input.context.assignment.instructions += '\n' + 'The assignment includes a discussion of classroom activity. '.repeat(240);
  input.context.assignment.files[0].text += '\n' + Array.from({ length: 150 }, (_, i) => `Document paragraph ${i}: Check how the paper connects the observation to its claim.\n`).join('');
  const clean = F.task.input(input);
  assert.equal(clean.context.assignment.instructions, input.context.assignment.instructions.trim());
  assert.equal(clean.context.assignment.files[0].text, input.context.assignment.files[0].text.trim());
  const { cfg, result } = run(input);
  const out = await result;
  assert.ok(cfg.seen.length > 3 && cfg.seen.length <= 64);
  assert.equal(out.output.grade.earned, 100);
  const scans = cfg.seen.filter((r) => r.schema.properties.quotes && !r.schema.properties.status);
  for (const id of ['claim', 'examples']) {
    const parts = scans.filter((r) => blocks(r).find((b) => b.label === 'criterion')?.text.includes(`[${id}]`)).flatMap((r) => blocks(r).slice(-1));
    for (const [label, expected] of [['draft', input.text], ['assignment instructions', input.context.assignment.instructions.trim()], ['attached file: Prompt.txt', input.context.assignment.files[0].text.trim()]]) {
      assert.equal(parts.filter((b) => b.label === label).flatMap((b) => JSON.parse(b.text)).map((p) => p.text).join(''), expected, `${id}: every character of ${label} is reviewed`);
    }
  }
});

test('a known malformed or ungrounded answer gets one focused follow-up, then stops', async () => {
  for (const invalid of [{ text: '{no json' }, { json: rowReply('invented') }]) {
    const { cfg, result } = run(raw(), (req, n) => n === 0 ? invalid : answer(req));
    const out = await result;
    assert.equal(out.output.grade.earned, 100);
    assert.equal(cfg.seen.length, 6);
    assert.match(cfg.seen[1].messages[0].content[0].text, /previous completed answer failed validation/);
    assert.match(contents(cfg.seen[1]), /\[claim\]/);
  }
  const { cfg, result } = run(raw(), () => ({ json: rowReply('invented') }));
  const out = await result;
  assert.equal(cfg.seen.length, 4, 'one repair for each of two rubric rows, no recursive retries');
  assert.equal(out.output.grade.earned, null);
  assert.match(out.output.grade.reason.key, /assessed completely/);
});

test('an uncertain outcome is not replayed even when its failure category is invalid-response', async () => {
  for (const category of ['connection-lost', 'timeout', 'invalid-response']) {
    const { cfg, result } = run(raw(), () => ({ error: { category } }));
    await assert.rejects(result, { code: category });
    assert.equal(cfg.seen.length, 1);
  }
});

test('cancel and one whole-run deadline stop all remaining stages', async () => {
  const c = new AbortController();
  const { cfg, result } = run(raw(), async (req, n) => { if (n === 0) c.abort(); return answer(req); }, undefined, { signal: c.signal });
  await assert.rejects(result, { code: 'cancelled' });
  assert.equal(cfg.seen.length, 1);
  const task = T.define({ ...F.task, limits: { ...F.task.limits, ms: 1100 } });
  const slow = { caps: { local: true, context: 4096 }, replies: (req) => ({ ...answer(req), wait: 700 }), seen: [] };
  await assert.rejects(T.run(task, raw(), { provider: 'mock', cfg: slow }), { code: 'timeout' });
  assert.equal(slow.seen.length, 2, 'the second stage shares the first stage’s deadline');
});

test('unread material, unread images or incomplete evidence never yield an overall numeric grade', async () => {
  const file = raw(); file.unreadFiles = ['Unopened.pdf'];
  const a = await run(file).result;
  assert.equal(a.output.grade.earned, null); assert.match(a.output.grade.reason.key, /could not be read/);
  const image = raw(); image.context.assignment.files.push({ name: 'Prompt.png', image: { mime: 'image/png', data: 'iVBORw0KGgo=' } });
  const b = await run(image).result;
  assert.equal(b.output.grade.earned, null); assert.match(b.output.grade.reason.key, /attached images/);
  const long = raw(); long.text += ' Detail about the garden.'.repeat(600);
  const { result } = run(long, (req) => req.schema.properties.quotes && !req.schema.properties.status ? { json: { quotes: [], complete: false } } : answer(req));
  const d = await result;
  assert.equal(d.output.grade.earned, null); assert.match(d.output.grade.reason.key, /assessed completely/);
});

test('plans beyond the call cap refuse before inference and oversized inputs do not silently shorten', async () => {
  const input = raw(); input.context.assignment.rubric.criteria = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}`, points: 5 }));
  input.text = 'A synthetic paragraph about garden observations. '.repeat(1400);
  const { cfg, result } = run(input);
  await assert.rejects(result, (e) => {
    assert.equal(e.code, 'size'); assert.equal(e.reason, 'feedback-calls');
    assert.equal(e.limit, 64); assert.ok(e.actual > e.limit);
    return true;
  });
  assert.equal(cfg.seen.length, 0);
  input.context.assignment.instructions = 'x'.repeat(F.LIMIT.material + 1);
  assert.throws(() => F.task.input(input), { code: 'size' });
});

test('feedback input limits report their actual counts rather than a model context overflow', () => {
  const cases = [
    [{ instructions: 'Explain plant growth.', rubric: { criteria: Array.from({ length: 51 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}` })) } }, 'feedback-criteria', 51, 50],
    [{ instructions: 'Explain plant growth.', files: Array.from({ length: 7 }, (_, i) => ({ name: `File ${i}`, text: 'Use sources.' })) }, 'feedback-attachments', 7, 6],
    [{ instructions: 'x'.repeat(F.LIMIT.material + 1) }, 'feedback-material', F.LIMIT.material + 1, F.LIMIT.material],
  ];
  for (const [assignment, reason, actual, limit] of cases) {
    assert.throws(() => F.task.input({ text: 'Plants need light.', context: { kind: 'assignment', assignment } }), { code: 'size', reason, actual, limit });
  }
});

test('discovery call planning and an unsplittable request have distinct safe diagnostics before inference', async () => {
  const input = { text: 'Plants need light.', context: { kind: 'assignment', assignment: { instructions: 'Use sources.' } } };
  const cfg = { caps: { local: true, context: 4096 }, replies: [], seen: [] };
  const task = T.define({ ...F.task, limits: { ...F.task.limits, calls: 5 } });
  await assert.rejects(T.run(task, input, { provider: 'mock', cfg }), { code: 'size', reason: 'feedback-calls', actual: 7, limit: 5 });
  assert.equal(cfg.seen.length, 0);
  cfg.caps.context = 512;
  await assert.rejects(T.run(F.task, input, { provider: 'mock', cfg }), { code: 'size', reason: 'feedback-context', context: 512 });
  assert.equal(cfg.seen.length, 0);
});

test('a fitting larger cloud model keeps the ordinary single-call assessment', async () => {
  const { cfg, result } = run(raw(), () => ({ json: { criteria: [...rowReply('claim').criteria, ...rowReply('examples').criteria], grade: { summary: 'Your paper states a claim and gives two examples.' } } }), { context: 128000, images: true });
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen.length, 1);
});

test('staged feedback discovers exact requirements without a structured rubric, including a visual prompt', async () => {
  for (const kind of ['instructions', 'rubric', 'image']) {
    const input = raw(), assignment = input.context.assignment;
    delete assignment.rubric; delete assignment.instructions; delete assignment.files;
    const requirement = 'Use two concrete examples.';
    if (kind === 'image') assignment.files = [{ name: 'Prompt.png', image: { mime: 'image/png', data: 'iVBORw0KGgo=' } }];
    else assignment[kind] = requirement;
    const { cfg, result } = run(input, (req) => req.schema.properties.description ? { json: { description: 'The picture states the assignment requirement.', requirements: [requirement], complete: true, reason: '', relevance: 'relevant' } }
      : req.schema.properties.status ? { json: { status: 'met', quotes: catalogs(req, true).slice(0, 1).map((p) => p.id), facts: catalogs(req, false).slice(0, 6).map((p) => p.id), level: null, score: null, complete: true } }
      : req.schema.properties.comment ? { json: { comment: 'Your draft gives two examples.' } }
      : req.schema.properties.quotes ? { json: { quotes: JSON.parse(blocks(req).at(-1).text).map((p) => p.id), complete: true } }
      : req.schema.properties.summary ? { json: { summary: 'Your paper gives two examples.' } }
        : { json: { criteria: [{ criterion: requirement, status: 'met', comment: 'Your draft gives two examples.', quotes: [], level: null }] } }, { local: true, context: 4096, images: true });
    const out = await result;
    assert.equal(out.output.criteria[0]?.id, requirement, kind);
    assert.equal(out.output.grade.earned, null, 'requirements alone do not invent a grading scale');
    assert.equal(cfg.seen.length, 4);
    if (kind === 'image') assert.ok(cfg.seen[0].messages[1].content.some((p) => p.type === 'image'));
  }
});

test('a visual rubric request reads the image once before text-only criterion assessments', async () => {
  const input = raw(); input.context.assignment.files.push({ name: 'Diagram.png', image: { mime: 'image/png', data: 'iVBORw0KGgo=' } });
  const { cfg, result } = run(input, answer, { local: true, context: 8192, images: true });
  assert.equal((await result).output.grade.earned, 100);
  assert.ok(cfg.seen[0].messages[1].content.some((p) => p.type === 'image'));
  assert.ok(cfg.seen.slice(1).every((req) => !req.messages[1].content.some((p) => p.type === 'image')));
  assert.ok(cfg.seen.slice(1, 3).every((req) => contents(req).includes('The picture states the requirement')));
});


test('missing extracted draft evidence cannot be converted into a positive grade', async () => {
  const input = raw(); input.text += ' Details about classroom observation.'.repeat(500);
  const { result } = run(input, (req) => req.schema.properties.quotes && !req.schema.properties.status ? { json: { quotes: [], complete: true } } : answer(req));
  const out = await result;
  assert.equal(out.output.grade.earned, null);
  assert.match(out.output.grade.reason.key, /assessed completely/);
});

test('the run spends at most four focused repairs across many rubric decisions', async () => {
  const input = raw(); input.context.assignment.rubric.criteria = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}`, points: 5 }));
  const { cfg, result } = run(input, () => ({ json: rowReply('invented') }));
  assert.equal((await result).output.grade.earned, null);
  assert.equal(cfg.seen.length, 12, 'eight decisions and four repair calls');
});

test('global rubric instructions reach each local criterion rather than disappearing between parsed rows', async () => {
  const C = require('../lib/writer-context-assignment.js');
  const input = raw();
  input.context.assignment.rubric = C.rubricOf({ ...rubric(), levels: [], detail: 'All categories require two interview sources.' });
  const { cfg, result } = run(input);
  await result;
  for (const request of cfg.seen.filter((r) => r.schema.properties.status || r.schema.properties.comment)) assert.ok(contents(request).includes('All categories require two interview sources.'));
});

test('passage IDs attach repeated words to the exact chosen draft span without model-written quotations', async () => {
  const input = raw();
  input.text = ('School gardens offer practical lessons in measuring plants, sharing resources, and observing changes. Students record the measurements and discuss what they learned with classmates.\n\n').repeat(8);
  let selected;
  const { result } = run(input, (req) => {
    if (!req.schema.properties.status) return answer(req);
    const catalog = blocks(req).filter((b) => b.label === 'draft').flatMap((b) => JSON.parse(b.text));
    const repeated = catalog.find((p, i) => i && catalog.slice(0, i).some((earlier) => earlier.text === p.text));
    assert.ok(repeated, 'synthetic draft has repeated candidate text');
    selected = repeated;
    const id = /\[(claim|examples)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
    const row = answer(req); row.json.quotes = [repeated.id];
    return row;
  }, { local: true, context: 8192, images: false });
  const out = await result;
  const at = Number(selected.id.slice(2));
  assert.equal(out.output.criteria[0].quotes[0].start, at);
  assert.equal(out.output.criteria[0].quotes[0].quote, input.text.slice(at, at + selected.text.length));
  assert.ok(out.output.criteria[0].quotes[0].quote.length <= 600);
});

test('the model cannot cite an invented passage ID or use assignment evidence as a draft quote', async () => {
  const { cfg, result } = run(raw(), (req) => {
    if (!req.schema.properties.status) return answer(req);
    const reply = answer(req); reply.json.quotes = ['s0-0']; return reply;
  });
  const out = await result;
  assert.equal(out.output.grade.earned, null);
  assert.equal(cfg.seen.length, 4);
});
