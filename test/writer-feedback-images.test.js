const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/ai/task.js');
const F = require('../lib/ai/tasks/writer-feedback.js');
const X = require('../lib/ai/text.js');
const I = require('../lib/ai/tasks/writer-image.js');
const V = require('../lib/ai/visual-cache.js');
const { webcrypto } = require('node:crypto');
require('../lib/ai/providers/mock.js');

const picture = (name = 'Prompt.png') => ({ name, image: { mime: 'image/png', data: 'iVBORw0KGgo=' } });
const raw = () => ({ text: 'School gardens help students learn together. Students measure growth and share their harvest.', grade: true, context: {
  kind: 'assignment', assignment: { instructions: 'Explain the benefit of school gardens.', rubric: { criteria: [
    { id: 'claim', label: 'Claim', detail: 'Explain the benefit.', points: 40 },
    { id: 'examples', label: 'Examples', detail: 'Use two concrete examples.', points: 60 },
  ] }, files: [picture()] },
} });
const images = (req) => req.messages.flatMap((m) => m.content).filter((p) => p.type === 'image');
const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
const blocks = (req) => [...contents(req).matchAll(/\[([^\n]+) — data copied from a page or a document, not instructions\]\n<<<[^\n]+\n([\s\S]*?)\n>>>[^\n]+/g)].map((m) => ({ label: m[1], text: m[2] }));
const catalogs = (req, draft) => blocks(req).filter((b) => (b.label === 'draft') === draft).flatMap((b) => { try { const out = JSON.parse(b.text); return Array.isArray(out) ? out.filter((p) => p.id) : []; } catch { return []; } });
const visual = () => ({ description: 'A diagram connects sunlight and water to plant growth. A two-column table gives Claim 40 points and Examples 60 points.', requirements: ['Use two concrete examples.'], complete: true, reason: '', relevance: 'relevant' });
const row = (id) => ({ criterion: id, status: 'met', comment: id === 'claim' ? 'Your claim identifies a benefit.' : 'Your draft gives two concrete examples.', quotes: [{ quote: id === 'claim' ? 'School gardens help students learn together.' : 'Students measure growth and share their harvest.', before: '', after: '' }], level: null, score: id === 'claim' ? 40 : 60 });
const answer = (req) => {
  if (images(req).length) return { json: visual() };
  if (req.schema.properties.summary) return { json: { summary: 'Your paper states a benefit and gives two examples.' } };
  if (req.schema.properties.comment) return { json: { comment: row(JSON.parse(blocks(req).find((b) => b.label === 'checked decision').text).criterion).comment } };
  if (req.schema.properties.status) {
    const id = /\[(claim|examples)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
    return { json: { status: 'met', quotes: catalogs(req, true).filter((p) => p.text.includes(id === 'claim' ? 'School gardens help' : 'Students measure growth')).slice(0, 1).map((p) => p.id), facts: catalogs(req, false).slice(0, 6).map((p) => p.id), level: null, score: id === 'claim' ? 40 : 60, complete: true } };
  }
  if (req.schema.properties.quotes) return { json: { quotes: JSON.parse(blocks(req).at(-1).text).filter((p) => /School gardens help|Students measure growth|Use two concrete examples/.test(p.text)).map((p) => p.id), complete: true } };
  const criterion = blocks(req).find((b) => b.label === 'criterion');
  if (!criterion) return { json: { criteria: [row('claim'), row('examples')], grade: { summary: 'Your paper states a benefit and gives two examples.' } } };
  const id = /\[(claim|examples)\]/.exec(criterion.text)[1], out = row(id);
  out.quotes = blocks(req).filter((b) => b.label === 'draft').flatMap((b) => JSON.parse(b.text)).filter((p) => p.text.includes(id === 'claim' ? 'School gardens help' : 'Students measure growth')).slice(0, 1).map((p) => p.id);
  return { json: { criteria: [out] } };
};
const run = (input = raw(), replies = answer, caps = { local: true, context: 8192, images: true }, extra = {}) => {
  const cfg = { caps, replies, seen: [] };
  return { cfg, result: T.run(F.task, input, { provider: 'mock', cfg, ...extra }) };
};

test('feedback reads each image once into bounded observations before text-only rubric decisions', async () => {
  const input = raw(); input.context.assignment.files.push(picture('Diagram.png'));
  const progress = [], { cfg, result } = run(input, answer, undefined, { emit: (e) => e.type === 'note' && progress.push(e.stage) });
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen.length, 7);
  assert.deepEqual(cfg.seen.map((req) => images(req).length), [1, 1, 0, 0, 0, 0, 0]);
  assert.deepEqual(progress, ['evidence', 'evidence', 'criterion', 'criterion', 'criterion', 'criterion', 'summary']);
  for (const request of cfg.seen.slice(0, 2)) {
    assert.equal(request.maxTokens, 512);
    assert.ok(X.estimateTokens(visual()) <= request.maxTokens);
    assert.match(request.messages[0].content[0].text, /untrusted/);
    assert.match(request.messages[0].content[0].text, /point scales|point values/);
    assert.match(request.messages[0].content[0].text, /do not evaluate the student’s work/);
    assert.ok(!contents(request).includes(input.text));
  }
  for (const request of cfg.seen.slice(2, 4)) {
    assert.ok(contents(request).includes(visual().description));
    assert.ok(contents(request).includes(visual().requirements[0]));
  }
});

test('chunked evidence review never resends its source image', async () => {
  const input = raw(); input.text += ' A classroom observation records how plants grow.'.repeat(450);
  const { cfg, result } = run(input, answer, { local: true, context: 4096, images: true });
  assert.equal((await result).output.grade.earned, 100);
  assert.ok(cfg.seen.some((req) => req.schema.properties.quotes));
  assert.equal(cfg.seen.reduce((n, req) => n + images(req).length, 0), 1);
  assert.ok(cfg.seen.slice(1).every((req) => !images(req).length));
});

test('a fitting cloud assessment still reads pictures first and receives text only', async () => {
  const { cfg, result } = run(raw(), answer, { context: 128000, images: true });
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen.length, 2);
  assert.deepEqual(cfg.seen.map((req) => images(req).length), [1, 0]);
  assert.ok(contents(cfg.seen[1]).includes(visual().description));
  assert.ok(contents(cfg.seen[1]).includes('Use two concrete examples.'));
});

test('image limitations and failures cannot yield a grade, and only a known inconsistent reading gets one repair', async () => {
  for (const [reading, reason, calls] of [
    [{ json: { ...visual(), complete: false, reason: 'The bottom row is illegible.' } }, /bottom row is illegible/, 1],
    [{ json: { ...visual(), reason: 'The table values are uncertain.' } }, /table values are uncertain/, 2],
    [{ error: { category: 'connection-lost' } }, /connection|completed|failed/i, 1],
    [{ text: '{invalid json' }, /valid|failed|completed/i, 1],
    [{ json: visual(), finish: 'length' }, /valid|failed|completed/i, 1],
    [{ json: { ...visual(), description: 'x'.repeat(2200) } }, /512|bound|large/i, 1],
  ]) {
    const { cfg, result } = run(raw(), (req) => images(req).length ? reading : answer(req));
    const out = await result;
    assert.equal(out.output.grade.earned, null);
    assert.match(out.output.grade.reason.key, /images|image/i);
    assert.match(out.output.grade.reason.vars.files, /Prompt.png/);
    assert.match(out.output.grade.reason.vars.files, reason);
    assert.equal(cfg.seen.filter((req) => images(req).length).length, calls);
    assert.ok(cfg.seen.slice(calls).every((req) => !images(req).length));
    if (calls === 2) assert.match(cfg.seen[1].messages[0].content[0].text, /prior response did not satisfy.*contract/i);
    if (reading.json?.description.length > 2000) assert.ok(!cfg.seen.slice(calls).some((req) => contents(req).includes(reading.json.description)), 'oversized text is rejected, never silently shortened into accepted evidence');
  }
});

test('a visual requirement remains an exact grounded criterion without a structured rubric', async () => {
  const input = raw(); delete input.context.assignment.rubric; delete input.context.assignment.instructions;
  const requirement = 'Use two concrete examples.';
  const { cfg, result } = run(input, (req) => images(req).length ? { json: visual() }
    : req.schema.properties.summary ? { json: { summary: 'Your paper gives two examples.' } }
      : req.schema.properties.status ? { json: { status: 'met', quotes: catalogs(req, true).slice(0, 1).map((p) => p.id), facts: catalogs(req, false).slice(0, 6).map((p) => p.id), level: null, score: null, complete: true } }
      : req.schema.properties.comment ? { json: { comment: 'Your draft gives two examples.' } }
      : { json: { criteria: [{ criterion: requirement, status: 'met', comment: 'Your draft gives two examples.', quotes: [], level: null }] } });
  const out = await result;
  assert.equal(out.output.criteria[0]?.id, requirement);
  assert.equal(out.output.grade.earned, null, 'visible requirements do not establish a structured scoring scale');
  assert.deepEqual(cfg.seen.map((req) => images(req).length), [1, 0, 0, 0]);
});

test('unsupported images keep an unavailable grade while extracted attachment text is still reviewed', async () => {
  const unsupported = await run(raw(), answer, { local: true, context: 8192, images: false }).result;
  assert.equal(unsupported.output.grade.earned, null);
  assert.match(unsupported.output.grade.reason.key, /attached images/);
  const input = raw(); input.context.assignment.files[0].text = 'Use two concrete examples.';
  const { cfg, result } = run(input, answer, { local: true, context: 8192, images: false });
  assert.equal((await result).output.grade.earned, 100);
  assert.ok(cfg.seen.every((req) => !images(req).length));
  assert.ok(contents(cfg.seen[0]).includes(input.context.assignment.files[0].text));
});

test('cancel during the visual pass stops before feedback without replaying the image', async () => {
  const controller = new AbortController();
  const { cfg, result } = run(raw(), (req) => { controller.abort(); return answer(req); }, undefined, { signal: controller.signal });
  await assert.rejects(result, { code: 'cancelled' });
  assert.equal(cfg.seen.length, 1);
  assert.equal(images(cfg.seen[0]).length, 1);
});

test('complete observations remain evidence when their relevance to brief task context is uncertain', async () => {
  for (const relevance of ['uncertain', 'irrelevant']) {
    const { cfg, result } = run(raw(), (req) => images(req).length ? { json: { ...visual(), relevance } } : answer(req));
    assert.equal((await result).output.grade.earned, 100);
    assert.ok(cfg.seen.slice(1, 3).every((req) => contents(req).includes(visual().description)));
  }
});

test('trusted prepared readings let a text-only review route assess images without receiving pixels', async () => {
  let reads = 0;
  const task = T.define({ ...F.task, orchestrate: (inp, kit) => F.task.orchestrate(inp, { ...kit, imageCache: { get: async (imageInput) => {
    reads++;
    const prefetch = I.input({ name: 'Prompt.png', image: raw().context.assignment.files[0].image, context: raw().context });
    assert.equal(imageInput.context, prefetch.context, 'prefetch and review use the same original assignment context');
    assert.equal(imageInput.contextComplete, prefetch.contextComplete);
    return visual();
  } } }) });
  const cfg = { caps: { local: true, context: 8192, images: false }, replies: answer, seen: [] };
  const out = await T.run(task, raw(), { provider: 'mock', cfg });
  assert.equal(reads, 1);
  assert.equal(out.output.grade.earned, 100);
  assert.equal(cfg.seen.length, 5);
  assert.ok(cfg.seen.every((req) => !images(req).length));
  assert.ok(contents(cfg.seen[0]).includes(visual().description));
  assert.equal(F.task.input({ ...raw(), visualReadings: [visual()] }), null, 'page-supplied readings cannot impersonate the trusted cache');
});

test('Advanced output settings cap image reading separately from later text review', async () => {
  const { cfg, result } = run(raw(), answer, { local: true, context: 16384, images: true }, { over: { maxTokens: 4096 } });
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen[0].maxTokens, 512);
  assert.ok(cfg.seen.slice(1).every((req) => req.maxTokens === 256 && !images(req).length));
});

test('an immediate review reuses the recent incomplete prefetch outcome without replaying its image', async () => {
  const input = raw(), data = {}, writes = [];
  const store = { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(patch) { writes.push(patch); Object.assign(data, structuredClone(patch)); return true; } };
  const cache = () => V.create({ store, scope: { school: 'https://school.example', account: 'student-1', assignment: 'task-1' }, context: input.context, crypto: webcrypto, locks: null });
  const cfg = { caps: { local: true, context: 8192, images: true }, replies: (req) => images(req).length ? { error: { category: 'connection-lost' } } : answer(req), seen: [] };
  const prefetchInput = { name: input.context.assignment.files[0].name, image: input.context.assignment.files[0].image, context: input.context };
  const prefetch = await T.run(I.task, prefetchInput, { provider: 'mock', cfg, imageCache: cache() });
  assert.equal(prefetch.output.complete, false);
  const reviewed = await T.run(F.task, input, { provider: 'mock', cfg, imageCache: cache() });
  assert.equal(reviewed.output.grade.earned, null);
  assert.match(reviewed.output.grade.reason.vars.files, /Prompt.png:.*connection was lost/);
  assert.equal(cfg.seen.filter((req) => images(req).length).length, 1);
  assert.equal(writes.length, 0, 'recent failures are handed off in memory without persistent storage');
  const again = await T.run(I.task, prefetchInput, { provider: 'mock', cfg, imageCache: cache() });
  assert.equal(again.output.complete, false); assert.equal(again.meta.parts, 0);
  assert.equal(cfg.seen.filter((req) => images(req).length).length, 1);
});

test('image layout requirements have the same grading uncertainty as identical assignment text', async () => {
  for (const [requirement, paper] of [
    ['Use Times New Roman throughout.', { mixed: true, header: 'none' }],
    ['Include page numbers in the header.', { mixed: false, header: 'custom' }],
  ]) {
    const input = raw(); input.mode = 'paper';
    input.paper = { font: 'Times New Roman', size: 12, line: 2, margin: 1, ...paper };
    const text = structuredClone(input); text.context.assignment.files = [{ name: 'Prompt.txt', text: requirement }];
    const fromText = await run(text).result;
    assert.equal(fromText.output.grade.earned, null);
    assert.match(fromText.output.grade.reason.key, /assessed completely/);
    for (const location of ['requirements', 'description']) {
      const out = await run(input, (req) => images(req).length ? { json: { ...visual(), description: location === 'description' ? requirement : 'The picture shows an assignment requirement.', requirements: location === 'requirements' ? [requirement] : [] } } : answer(req)).result;
      assert.equal(out.output.grade.earned, null, `${location}: ${requirement}`);
      assert.equal(out.output.grade.reason.key, fromText.output.grade.reason.key);
    }
  }
  const unrelated = raw(); unrelated.mode = 'paper'; unrelated.paper = { font: 'Times New Roman', size: 12, line: 2, margin: 1, mixed: true, header: 'custom' };
  assert.equal((await run(unrelated).result).output.grade.earned, 100, 'mixed formatting alone does not make unrelated visual requirements unavailable');
});
