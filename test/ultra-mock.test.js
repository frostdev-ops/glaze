// The practice Ultra's server side (scripts/ultra-mock.js), without a browser: what Glaze reads, what a post, a reply, an
// upload and a submission leave in the thread and the received folder, and Reset. In a browser: scripts/writer-practice.js --smoke.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const M = require('../scripts/ultra-mock.js');

// A stand-in for Playwright's route: the request in, what the mock fulfils with out.
const call = async (mock, { method = 'GET', url, body, headers = {}, nav = false }) => {
  let got;
  const req = {
    url: () => new URL(url, M.SITE).href, method: () => method, headers: () => headers, isNavigationRequest: () => nav,
    postData: () => (body === undefined || Buffer.isBuffer(body) ? null : JSON.stringify(body)), postDataBuffer: () => (Buffer.isBuffer(body) ? body : null),
  };
  await mock.handle({ request: () => req, fulfill: async (r) => { got = r; }, abort: async () => { got = { aborted: true }; }, continue: async () => { got = { continued: true }; } });
  const text = Buffer.isBuffer(got.body) ? got.body.toString() : String(got.body ?? '');
  return { ...got, text, json: () => JSON.parse(text) };
};
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-mock-'));

test('an interrupted first Quill download releases the fetch without writing a cache file', async (t) => {
  const out = scratch(), controller = new AbortController();
  t.mock.method(globalThis, 'fetch', (url, { signal } = {}) => new Promise((resolve, reject) => {
    if (!signal) { reject(Error('missing cancellation signal')); return; }
    signal.addEventListener('abort', () => reject(Error('synthetic download interrupted')), { once: true });
  }));
  try {
    const download = M.quill(out, controller.signal);
    controller.abort();
    await assert.rejects(download, /synthetic download interrupted/);
    assert.deepEqual(fs.readdirSync(out), []);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('practice blocks every non-mock origin, including literal IPs and mock lookalikes', async () => {
  const out = scratch();
  try {
    const mock = M.create({ quill: Buffer.alloc(0), out });
    for (const url of ['https://example.com/', 'http://127.0.0.1/', 'https://bb.school.test.evil.test/', 'http://bb.school.test/', 'https://bb.school.test:444/']) {
      assert.equal((await call(mock, { url, nav: true })).aborted, true, url);
      assert.equal((await call(mock, { url, method: 'POST', body: {} })).aborted, true, url);
    }
    assert.equal((await call(mock, { url: 'chrome-extension://abcdefghijklmnop/popup.html' })).continued, true);
    assert.equal(mock.received.length, 0);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('two same-kind receives in the same millisecond cannot overwrite each other', async () => {
  const out = scratch(), iso = Date.prototype.toISOString;
  try {
    Date.prototype.toISOString = () => '2026-10-27T00:00:00.000Z';
    const mock = M.create({ quill: Buffer.alloc(0), out });
    for (const html of ['<p>First synthetic sample</p>', '<p>Second synthetic sample</p>']) await call(mock, { method: 'POST', url: M.BOARD, body: { body: { rawText: html } } });
    assert.notEqual(mock.received[0].dir, mock.received[1].dir);
    assert.equal(fs.readFileSync(path.join(mock.received[0].dir, 'message.html'), 'utf8'), '<p>First synthetic sample</p>\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(mock.received[0].dir, 'practice.json'), 'utf8')).synthetic, true);
  } finally { Date.prototype.toISOString = iso; fs.rmSync(out, { recursive: true, force: true }); }
});

test('the practice Ultra answers what Glaze reads, from the writer fixtures', async () => {
  const out = scratch();
  try {
    const mock = M.create({ quill: Buffer.from('/* quill */'), out });
    assert.equal((await call(mock, { url: '/learn/api/v1/users/me' })).json().id, M.ME.id);
    const members = (await call(mock, { url: `/learn/api/v1/users/${M.ME.id}/memberships` })).json();
    assert.equal(members.results.find((m) => m.courseId === '_101_1').course.name, 'ENGL 2110: American Literature II');
    const grades = (await call(mock, { url: '/learn/api/v1/courses/_101_1/gradebook/grades' })).json().results;
    assert.deepEqual(grades.map((r) => [r.column.contentId, r.column.assessmentSubtype ?? null]), [['_7_1', null], ['_8_1', null], ['_9_1', null]]);
    const first = (await call(mock, { url: `${M.BOARD}?limit=2&offset=0` })).json();
    assert.equal(first.results.length, 2);
    assert.match(first.paging.nextPage, /offset=2$/);
    assert.equal((await call(mock, { url: `${M.BOARD}/_201_1/replies` })).json().results.length, 2);
    assert.deepEqual((await call(mock, { url: '/learn/api/v1/courses/_101_1/announcements' })).json(), { results: [] });
    const page = (await call(mock, { url: M.ROUTES.discussion, nav: true })).text;
    assert.match(page, /window\.__practice = \{"page":"discussion"/);
    assert.match(page, /<script src="\/gz-practice\/quill\.js"><\/script><script src="\/gz-practice\/world\.js"><\/script><\/body>/);
    const world = (await call(mock, { url: '/gz-practice/world.js' })).text;
    assert.doesNotThrow(() => new Function(world));
    assert.match((await call(mock, { url: '/practice', nav: true })).text, /<h1>Writer practice<\/h1>/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('a post and a reply join the thread and are kept in the received folder; Reset takes them back out', async () => {
  const out = scratch();
  try {
    const mock = M.create({ quill: Buffer.alloc(0), out });
    const p = (await call(mock, { method: 'POST', url: M.BOARD, body: { body: { rawText: '<p>A <strong>post</strong>.</p>' }, parentId: null, draft: false } })).json();
    assert.equal(p.userId, M.ME.id);
    assert.equal(p.postedName, 'Alex Rivera');
    assert.equal(p.body.displayText, '<p>A <strong>post</strong>.</p>');
    const r = (await call(mock, { method: 'POST', url: M.BOARD, body: { body: { rawText: '<p>A reply.</p>' }, parentId: '_201_1', draft: false } })).json();
    assert.equal(r.parentId, '_201_1');
    const all = (await call(mock, { url: `${M.BOARD}?limit=10` })).json().results;
    assert.equal(all.at(-1).id, p.id);
    assert.equal(all.find((m) => m.id === '_201_1').messageStatus.numberOfChildren, 3);
    assert.equal((await call(mock, { url: `${M.BOARD}/_201_1/replies` })).json().results[0].id, r.id, 'newest first, as the API sorts');
    assert.deepEqual(mock.received.map((x) => x.kind), ['post', 'reply']);
    assert.equal(fs.readFileSync(path.join(mock.received[0].dir, 'message.html'), 'utf8'), '<p>A <strong>post</strong>.</p>\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(mock.received[1].dir, 'request.json'), 'utf8')).body.parentId, '_201_1');
    assert.deepEqual((await call(mock, { url: '/practice/api/log' })).json().items.map((l) => l.kind), ['post', 'reply']);
    const reset = [];
    const again = M.create({ quill: Buffer.alloc(0), out, onReset: async (s) => { reset.push(s); } });
    await call(again, { method: 'POST', url: M.BOARD, body: { body: { rawText: '<p>Gone soon.</p>' } } });
    await call(again, { method: 'POST', url: '/practice/api/reset', body: { scenario: 'discussion' } });
    assert.deepEqual(reset, ['discussion']);
    assert.equal((await call(again, { url: `${M.BOARD}?limit=10` })).json().results.length, 3);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('an upload and a submission: the file, the text box and the request kept; the attempt stays submitted until Reset', async () => {
  const out = scratch();
  try {
    const mock = M.create({ quill: Buffer.alloc(0), out });
    const bytes = Buffer.from('not really a paper');
    const f = (await call(mock, { method: 'POST', url: M.UPLOAD, body: bytes, headers: { 'content-type': 'text/plain', 'x-file-name': encodeURIComponent('Rivera Notes.txt') } })).json();
    assert.deepEqual([f.name, f.size], ['Rivera Notes.txt', bytes.length]);
    const saved = (await call(mock, { method: 'POST', url: M.ATTEMPT, body: { draft: true, studentSubmission: '<p>Draft</p>', files: [f.id] } })).json();
    assert.equal(saved.draft, true);
    assert.equal(mock.state.draft.html, '<p>Draft</p>');
    assert.match((await call(mock, { url: M.ROUTES.attempt, nav: true })).text, /"draft":\{"html":"\\u003cp>Draft\\u003c\/p>"/);
    const done = (await call(mock, { method: 'POST', url: M.ATTEMPT, body: { draft: false, studentSubmission: '<p>Note</p>', files: [f.id] } })).json();
    assert.deepEqual(done.files.map((x) => [x.name, x.type, x.size]), [['Rivera Notes.txt', 'text/plain', bytes.length]]);
    const sub = mock.received.find((x) => x.kind === 'submission');
    assert.deepEqual(fs.readFileSync(path.join(sub.dir, 'Rivera Notes.txt')), bytes);
    assert.equal(fs.readFileSync(path.join(sub.dir, 'text.html'), 'utf8'), '<p>Note</p>\n');
    assert.equal(JSON.parse(fs.readFileSync(path.join(sub.dir, 'submission.json'), 'utf8')).files[0].sha256.length, 64);
    assert.equal((await call(mock, { url: done.files[0].url })).text, 'not really a paper');
    assert.match((await call(mock, { url: M.ROUTES.attempt, nav: true })).text, /"submission":\{/);
    mock.reset('assignment');
    assert.equal(mock.state.submission, null);
    assert.equal(mock.state.uploads.size, 0);
    assert.equal((await call(mock, { url: done.files[0].url })).status, 404);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});


test('the practice rubric reaches Feedback as parsed criteria and level cells, not only a title', async () => {
  const out = scratch();
  try {
    const mock = M.create({ quill: Buffer.alloc(0), out });
    const get = async (url) => (await call(mock, { url })).json();
    const context = await require('../lib/writer-context-assignment.js').build({
      school: new URL(M.SITE).host, path: M.ROUTES.attempt, uid: async () => M.ME.id,
      me: async () => M.ME, courses: async () => (await get(`/learn/api/v1/users/${M.ME.id}/memberships`)).results,
      rows: async () => (await get('/learn/api/v1/courses/_101_1/gradebook/grades')).results,
      get, R: require('../lib/rubric.js'), instructions: async () => 'Write 1,200 words on memory in Beloved.',
    });
    const original = require('./fixtures/ultra-rubric-numeric.json').column.rubricAssociations[0].rubricDefinition;
    const rubric = require('../lib/ai/tasks/writer-context.js').rubric(context.assignment.rubric);
    assert.deepEqual(rubric.ids.map(({ id, label }) => ({ id, label })), original.rows.map((r) => ({ id: r.id, label: r.header })));
    assert.ok(rubric.ids.every((c) => c.levels.length && c.levels[0].label === 'Level A'), 'each criterion keeps its named levels');
    assert.match(rubric.text, /Level A: One A/);
    const T = require('../lib/ai/task.js'); require('../lib/ai/tasks/writer-feedback.js');
    const task = T.get('writer.feedback');
    const input = task.input({ text: 'A synthetic draft about memory.', context });
    const request = task.build(input, { text: require('../lib/ai/text.js') });
    const answer = JSON.parse(require('../scripts/practice-ai.js').answer({ messages: request.messages }));
    const checked = task.check(answer, input).criteria;
    assert.deepEqual(checked.map((c) => [c.id, c.label]), rubric.ids.map((c) => [c.id, c.label]));
    assert.ok(checked.some((c) => c.level?.label), 'the stand-in names a level the rubric has');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('the practice assignment attaches a Word prompt and a picture, which Feedback reads and the stand-in names', async () => {
  const out = scratch();
  try {
    const mock = M.create({ quill: Buffer.alloc(0), out });
    const get = async (url) => (await call(mock, { url })).json();
    const C = require('../lib/writer-context-assignment.js'), D = require('../lib/doctext.js');
    const context = await C.build({ school: new URL(M.SITE).host, path: M.ROUTES.attempt, origin: M.SITE, uid: async () => M.ME.id, me: async () => M.ME, courses: async () => [], rows: async () => [], get, instructions: async () => '' });
    assert.deepEqual(context.assignment.files.map((f) => [f.name, f.image, new URL(f.url).origin]), [['Essay 2 prompt.docx', false, M.SITE], ['explore3.png', true, M.SITE]]);
    const files = await C.read(context.assignment.files, { D, get: async (url) => { const r = await call(mock, { url }); return r.status === 200 ? new Uint8Array(r.body) : null; }, text: ({ bytes }) => D.docx(bytes) });
    assert.deepEqual(files.map((f) => [f.name, f.text ?? f.image.mime]), [['Essay 2 prompt.docx', M.PROMPT], ['explore3.png', 'image/png']]);
    const T = require('../lib/ai/task.js'); require('../lib/ai/tasks/writer-feedback.js');
    const task = T.get('writer.feedback');
    const input = task.input({ text: 'A synthetic draft about memory.', context: { ...context, assignment: { ...context.assignment, files } } });
    const request = task.build(input, { text: require('../lib/ai/text.js') });
    const answer = JSON.parse(require('../scripts/practice-ai.js').answer({ messages: request.messages }));
    assert.match(answer.criteria[0].comment, /read against the attached Essay 2 prompt\.docx, with no picture shown\.$/);
    assert.ok(task.check(answer, input).criteria[0].comment, 'a comment Feedback keeps');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
