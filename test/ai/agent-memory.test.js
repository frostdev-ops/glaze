// The Ask-only memory wrapper: schemas, worker-owned account/permission, direct-user provenance and bounded conversion
// of school reads. Invented content only; no LMS requests, model calls or personal data.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/ai/schema.js');
const TL = require('../../extension/ai/tools.js');
const M = require('../../extension/ai/agent/memory.js');

const ACCOUNT = 'https://campus.example/5', OTHER = 'https://campus.example/6';
const ID = `m-${'1'.repeat(32)}`, SOURCE = `s-${'2'.repeat(32)}`, REV = 'a'.repeat(32);
const AT = Date.parse('2026-11-02T12:00:00Z');
const receipt = (operation, id = ID) => ({ ok: true, receipt: { operation, id, revision: REV, at: AT, persistence: 'device' } });
const fixture = (options = {}) => {
  const calls = [], current = { account: ACCOUNT, question: 'I prefer short answers.', lease: { generation: 1 }, ...options.current };
  let on = options.on !== false;
  const store = {
    search: async (...args) => { calls.push(['search', ...args]); return { ok: true, items: [], truncated: false }; },
    read: async (...args) => { calls.push(['read', ...args]); return { ok: true, id: ID, revision: REV, kind: 'memory', text: 'Short answers.', page: 1, pages: 1 }; },
    save: async (...args) => { calls.push(['save', ...args]); return receipt(args[1].id ? 'updated' : 'created'); },
    forget: async (...args) => { calls.push(['forget', ...args]); return receipt('forgotten', args[1].id); },
    ingest: async (...args) => { calls.push(['ingest', ...args]); return receipt('created', SOURCE); },
    ...options.store,
  };
  const env = { store, on: async () => on, context: async () => current, now: () => AT, ...options.env };
  const tools = M.tools(env);
  return { calls, current, env, on: (value) => { on = value; }, tool: (name) => tools.find((d) => d.name === name),
    run: (name, args, ctx = {}) => tools.find((d) => d.name === name).run(args, ctx) };
};

test('four strict specs define private Ask tools, with no model authority fields or external Agents group', () => {
  assert.deepEqual(M.SPECS.map((s) => [s.name, s.kind]), [['memory_search', 'read'], ['memory_read', 'read'], ['memory_save', 'write'], ['memory_forget', 'write']]);
  const f = fixture();
  for (const spec of M.SPECS) {
    assert.equal(S.clean(spec.parameters), spec.parameters);
    assert.equal(spec.parameters.additionalProperties, false);
    assert.equal(TL.define(f.tool(spec.name)).parameters, spec.parameters);
    assert.equal(f.tool(spec.name).group, undefined);
    for (const k of ['account', 'question', 'explicitCorrection', 'authorized', 'timestamp', 'source']) assert.equal(Object.hasOwn(spec.parameters.properties, k), false);
  }
  assert.equal(M.isWrite('memory_save'), true);
  assert.equal(M.isWrite('memory_forget'), true);
  assert.equal(M.isWrite('memory_search'), false);
  assert.equal(M.isWrite('todo_mark_done'), false);
});

test('reads use only the trusted active account, a fixed hit limit and explicit page', async () => {
  const f = fixture();
  await f.run('memory_search', { query: 'answer style', kind: 'memory' }, { account: OTHER });
  await f.run('memory_read', { id: SOURCE, page: 2 }, { account: OTHER });
  assert.deepEqual(f.calls, [['search', ACCOUNT, 'answer style', { kind: 'memory', limit: 5 }], ['read', ACCOUNT, SOURCE, { page: 2 }]]);
  assert.deepEqual(await f.run('memory_search', { query: 'style', account: OTHER }), { ok: false, error: 'scope' });
  assert.equal(f.calls.length, 2);
});

test('off, aborted and invalid/ambiguous account contexts cannot read or mutate', async () => {
  for (const f of [fixture({ on: false }), fixture({ current: { account: '' } }), fixture({ current: { account: 'https://campus.example/not-a-user' } })]) {
    const r = await f.run('memory_save', { text: 'Short answers.', evidence: 'I prefer short answers.' });
    assert.equal(r.ok, false);
    assert.ok(['off', 'scope'].includes(r.error));
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(), control = new AbortController();
  control.abort();
  assert.deepEqual(await f.run('memory_read', { id: ID }, { signal: control.signal }), { ok: false, error: 'off' });
  assert.equal(f.calls.length, 0);
});

test('changing Memory off while resolving active scope prevents the store call', async () => {
  const f = fixture();
  f.env.context = async () => { f.on(false); return f.current; };
  assert.deepEqual(await M.tools(f.env).find((t) => t.name === 'memory_forget').run({ id: ID, revision: REV }), { ok: false, error: 'off' });
  assert.equal(f.calls.length, 0);
});

test('save forwards category, exact user evidence and runtime correction/lease separately, without authority in its result', async () => {
  const f = fixture({ current: { explicitCorrection: true } });
  const args = { text: 'Prefers short answers.', evidence: 'I prefer short answers.', category: 'preference', id: ID, revision: REV };
  const before = structuredClone(args), out = await f.run('memory_save', args);
  assert.deepEqual(args, before);
  assert.deepEqual(f.calls[0], ['save', ACCOUNT, args, { question: f.current.question, explicitCorrection: true, lease: f.current.lease }]);
  assert.deepEqual(out, receipt('updated'));
  assert.equal(Object.hasOwn(out, 'authorized'), false);
  assert.equal(Object.hasOwn(out, 'asked'), false);
});

test('save requires current direct user evidence, paired exact id/revision and bounded input', async () => {
  const f = fixture();
  const good = { text: 'Short answers.', evidence: 'I prefer short answers.' };
  for (const patch of [{ id: ID }, { revision: REV }, { id: SOURCE, revision: REV }, { id: ID, revision: '2' }, { explicitCorrection: true }, { category: 'instruction' }]) {
    assert.deepEqual(await f.run('memory_save', { ...good, ...patch }), { ok: false, error: 'scope' });
  }
  assert.deepEqual(await f.run('memory_save', { ...good, evidence: 'From an older chat.' }), { ok: false, error: 'evidence' });
  assert.deepEqual(await f.run('memory_save', { ...good, evidence: ' ' }), { ok: false, error: 'evidence' });
  assert.deepEqual(await f.run('memory_save', { ...good, text: 'x'.repeat(601) }), { ok: false, error: 'limit' });
  f.current.question = undefined;
  assert.deepEqual(await f.run('memory_save', good, { question: good.evidence, history: [good.evidence] }), { ok: false, error: 'evidence' });
  assert.equal(f.calls.length, 0);
});

test('quoted/reference/code text cannot be evidence, while surrounding direct statements remain usable', async () => {
  const evidence = 'I prefer short answers.';
  for (const question of [
    `The source says "${evidence}"`, `"A quoted passage\n${evidence}"`, `'A quoted passage\n${evidence}'`, `“${evidence}”`, `‘${evidence}’`, `'${evidence}'`, `«${evidence}»`,
    `> ${evidence}`, `> A quoted passage\n${evidence}`, `\`\`\`text\n${evidence}\n\`\`\``, `~~~\n${evidence}\n~~~`, `\`${evidence}\``, `    ${evidence}`,
    `<document>${evidence}</document>`, `<tool_response>${evidence}</tool_response>`, `<blockquote>${evidence}</blockquote>`,
  ]) {
    const f = fixture({ current: { question } });
    assert.deepEqual(await f.run('memory_save', { text: 'Short answers.', evidence }), { ok: false, error: 'evidence' }, question);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture({ current: { question: `The page says "long answers". ${evidence} Don't use tables.` } });
  assert.equal((await f.run('memory_save', { text: 'Short answers.', evidence })).ok, true);
  assert.match(f.calls[0][3].question, /Don't use tables/);
  assert.doesNotMatch(f.calls[0][3].question, /long answers/);
  f.current.question = `> A quoted passage\n\n${evidence}`;
  assert.equal((await f.run('memory_save', { text: 'Short answers.', evidence })).ok, true, 'blank line ends a blockquote');
});

test('writes emit no success until committed, and preserve core conflict/error receipts', async () => {
  let resolve;
  const waiting = new Promise((r) => { resolve = r; });
  const f = fixture({ store: { save: async () => waiting } });
  let done = false;
  const saving = f.run('memory_save', { text: 'Short answers.', evidence: 'I prefer short answers.' }).then((r) => { done = true; return r; });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(done, false);
  resolve(receipt('created'));
  assert.deepEqual(await saving, receipt('created'));
  const conflict = { ok: false, error: 'conflict', current: { id: ID, revision: REV } };
  const g = fixture({ store: { forget: async () => conflict } });
  assert.deepEqual(await g.run('memory_forget', { id: SOURCE, revision: REV }), conflict);
  const bad = fixture({ store: { read: async () => { throw new Error('private error with account'); } } });
  assert.deepEqual(await bad.run('memory_read', { id: ID }), { ok: false, error: 'write' });
});

test('strict bounds reject invalid read/search/forget calls before reaching storage', async () => {
  const f = fixture();
  for (const [name, args, error] of [
    ['memory_search', { query: ' ' }, 'limit'], ['memory_search', { query: 'x'.repeat(241) }, 'limit'], ['memory_search', { query: 'x', limit: 99 }, 'scope'],
    ['memory_read', { id: ID, page: 0 }, 'limit'], ['memory_read', { id: ID, page: 1001 }, 'limit'], ['memory_read', { id: ID.toUpperCase() }, 'scope'],
    ['memory_forget', { id: ID }, 'scope'], ['memory_forget', { id: ID, revision: 1 }, 'scope'],
  ]) assert.deepEqual(await f.run(name, args), { ok: false, error }, `${name} ${JSON.stringify(args)}`);
  assert.equal(f.calls.length, 0);
});

const content = (overrides = {}) => ({ name: 'content_read', arguments: { course: '25', id: '70' }, result: { account: ACCOUNT, title: 'Cell membranes', text: 'The membrane is selectively permeable.', page: 1, pages: 1 }, ...overrides });

test('course conversion indexes known body text with runtime provenance and no arbitrary fields or account in Markdown', () => {
  const call = content();
  call.result.private = 'NEVER INDEX THIS';
  const out = M.material(call, ACCOUNT, AT);
  assert.deepEqual(out.source, { type: 'course-read', tool: 'content_read', course: '25', id: '70', page: 1, observedAt: AT, complete: true, title: 'Cell membranes' });
  assert.match(out.markdown, /# Cell membranes/);
  assert.match(out.markdown, /selectively permeable/);
  assert.doesNotMatch(out.markdown, /NEVER INDEX|campus\.example/);
});

test('course conversion refuses unknown tools, failures, cross-account results and invalid identities', () => {
  for (const call of [content({ name: 'document_read' }), content({ arguments: { course: '25' } }), content({ arguments: { course: 'wrong', id: '70' } }),
    content({ result: { ...content().result, account: OTHER } }), content({ arguments: { course: '25', id: '70', account: OTHER } }),
    ...[{ ok: false }, { error: 'locked' }, { missing: 'not read' }, { cancelled: true }].map((r) => content({ result: { ...content().result, ...r } })),
    content({ result: { ...content().result, page: 2 } }), content({ result: { title: 'A file', files: ['a.pdf'] } }),
  ]) assert.equal(M.material(call, ACCOUNT, AT), null);
  assert.equal(M.material(content(), 'not-an-account', AT), null);
  assert.equal(M.material(content(), ACCOUNT, 0), null);
  assert.equal(M.material(content({ arguments: { course: '_25_1', id: '_70_1' } }), ACCOUNT, AT), null, 'Canvas account cannot ingest Ultra identities');
  assert.equal(M.material(content(), 'https://campus.example/_5_1', AT), null, 'Ultra account cannot ingest Canvas identities');
});

test('course material and its metadata explicitly disclose pages and bounded truncation', () => {
  for (const partial of [{ pages: 2 }, { truncated: true }, { complete: false }, { cut: true }, { incomplete: true }, { more: 3 }]) {
    const out = M.material(content({ result: { ...content().result, ...partial } }), ACCOUNT, AT);
    assert.equal(out.source.complete, false);
    assert.match(out.markdown, /Partial source/);
  }
  const out = M.material(content({ result: { ...content().result, title: '😀'.repeat(200), text: '😀'.repeat(20000) } }), ACCOUNT, AT);
  assert.ok(out.markdown.length <= M.LIMIT.material);
  assert.ok(out.source.title.length <= 200);
  assert.equal(out.source.complete, false);
  assert.match(out.markdown, /Text shortened/);
  assert.doesNotMatch(out.markdown, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u);
});

test('discussion ingestion keeps the verified prompt, excluding student and classmate replies', () => {
  const out = M.material({ name: 'discussion_read', arguments: { course: '25', id: '70' }, result: { title: 'Cell questions', text: 'Explain one membrane function.',
    mine: [{ text: 'MY PRIVATE DRAFT' }], replies: [{ text: 'CLASSMATE PRIVATE WORDS' }], others: 7, at: AT - 1000 } }, ACCOUNT, AT);
  assert.match(out.markdown, /Discussion prompt/);
  assert.match(out.markdown, /Explain one membrane function/);
  assert.doesNotMatch(out.markdown, /PRIVATE|CLASSMATE|DRAFT|others|7/);
  assert.equal(out.source.observedAt, AT);
});

test('assignment ingestion preserves instructions and rubric definitions but not student grades/feedback or attachment URLs', () => {
  const call = { name: 'assignment_read', arguments: { course: '25', assignment: '80' }, result: { title: 'Membrane lab', instructions: 'Describe the membrane.', description: 'Use the readings.', points: 10,
    at: AT - 60000, due: AT + 86400000, score: 7, feedback: 'PRIVATE FEEDBACK', files: [{ name: 'Lab.pdf', url: 'https://secret.example/signed' }],
    rubric: { title: 'Lab rubric', total: 10, levels: [{ id: 'l1', label: 'Complete' }], criteria: [{ label: 'Evidence', detail: 'Support your claim.', points: 10, cells: [{ level: 'l1', detail: 'Uses observations.', value: 10 }] }] } } };
  const out = M.material(call, ACCOUNT, AT);
  assert.match(out.markdown, /Describe the membrane/);
  assert.match(out.markdown, /Support your claim/);
  assert.match(out.markdown, /Complete: Uses observations.: 10 points/);
  assert.doesNotMatch(out.markdown, /PRIVATE|secret\.example|score/);
  assert.equal(out.source.id, '80');
  assert.equal(out.source.observedAt, AT - 60000, 'reading a retained assignment does not make it fresh');
});

test('assignment Markdown keeps long rubric detail, exact percentage scales and unread attachment status', () => {
  const detail = 'Each observation needs evidence. '.repeat(50);
  const out = M.material({ name: 'assignment_read', arguments: { course: '25', assignment: '80' }, result: { title: 'Lab', instructions: 'Read the directions.', files: ['Directions.pdf', 'https://secret.example/signed'],
    rubric: { criteria: [{ label: 'Evidence', unscored: true, cells: [{ detail, percentage: 75 }, { detail: 'Mostly complete', percentageRange: { lo: 50, hi: 75, loExclusive: true } }] }] } } }, ACCOUNT, AT);
  assert.ok(out.markdown.includes(detail.trim()));
  assert.match(out.markdown, /75%/);
  assert.match(out.markdown, />50–75%/);
  assert.match(out.markdown, /Unscored/);
  assert.match(out.markdown, /Directions\.pdf/);
  assert.doesNotMatch(out.markdown, /secret\.example/);
  assert.equal(out.source.complete, false);
});

test('syllabus ingestion retains known imported fields and document text with the original import age', () => {
  const out = M.material({ name: 'syllabus_read', arguments: { course: '25' }, result: { at: AT - 86400000, instructor: { name: 'Dr. Example', note: 'By appointment' },
    hours: [{ label: 'Office hours', days: ['MO'], start: '10:00', end: '11:00', location: 'Room 2' }],
    dates: [{ title: 'Exam', day: '2026-12-01', kind: 'exam' }], scale: [['A', 90]], weights: [{ name: 'Labs', weight: 30 }],
    document: { title: 'Course syllabus', text: 'Bring goggles.', pages: 2, page: 1 } } }, ACCOUNT, AT);
  assert.match(out.markdown, /By appointment/);
  assert.match(out.markdown, /MO · 10:00 · 11:00 · Room 2/);
  assert.match(out.markdown, /Exam · 2026-12-01 · exam/);
  assert.match(out.markdown, /Labs: 30/);
  assert.match(out.markdown, /Bring goggles/);
  assert.equal(out.source.complete, false);
  assert.equal(out.source.observedAt, AT - 86400000);
});

test('ingest uses the same enabled/verified account and forwards only canonical material plus its invalidation lease', async () => {
  const f = fixture();
  assert.deepEqual(await M.ingest(f.env, content(), {}), receipt('created', SOURCE));
  const [op, account, record, options] = f.calls[0];
  assert.equal(op, 'ingest'); assert.equal(account, ACCOUNT);
  assert.deepEqual(record, M.material(content(), ACCOUNT, AT));
  assert.deepEqual(options, { lease: f.current.lease });
  f.on(false);
  assert.deepEqual(await M.ingest(f.env, content(), {}), { ok: false, error: 'off' });
  assert.equal(f.calls.length, 1);
});
