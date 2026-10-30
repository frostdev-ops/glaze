// A discussion's, a journal's and a new message's Cite sources are kept (lib/writer-sources.js keyOf) under what their
// frame's context names, as lib/writer-ultra.js finds the boxes on the probed pages (test/fixtures/ultra-writer-*) and
// lib/writer-context-discussion.js composes their context: one store a discussion, shared by its post and every reply;
// one a journal; one a course's new message; none for a test. The page is scripts/writer-compose-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const S = require('../lib/writer-sources.js'), U = require('../lib/writer-ultra.js');
const W = require('../lib/ai/tasks/writer-context.js'), CO = require('../lib/ai/tasks/writer-complete.js');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');
const source = fs.readFileSync(require.resolve('../lib/writer-context-discussion.js'), 'utf8');

const DISCUSSION = '/ultra/courses/_101_1/discussion/_9_1', JOURNAL = '/ultra/courses/_101_1/journal/_12_1', MESSAGES = '/ultra/messages/create';
const TEST = '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1';
const fixture = (f) => { const doc = { activeElement: null }; doc.root = new El('html', doc); doc.body = parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'), doc); return doc.body; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };

// One tab at host + pathname + search, its users/me answering me(): lib/writer-context-discussion.js loaded as content.js
// loads it, and watch() given each box as features/writer.js swap gives it (its frame up, its port open). A box's
// context() is what its frame holds: the last context sent, else its init context.
const tab = ({ host = 'bb.school.test', pathname, search = '', me = async () => '_42_1' }) => {
  const X = { on: () => true, settings: () => ({ enabled: true, enhance: { writer: true } }), need: async (p, f) => f(), me, myCourses: async () => [], bookFor: () => null };
  const sandbox = { URLSearchParams, AbortController, setTimeout: () => 0, clearTimeout: () => {},
    location: { host, pathname, search, origin: `https://${host.toLowerCase()}` },
    GZ_ULTRA: { read: () => ({ list: async () => ({ items: [{ id: '_1101_1', title: 'Topic', topic: { body: 'Prompt' } }] }), all: async () => [] }) },
    GZ_LMSQ: {}, GZ_WRITER_ULTRA: U, GZ_WRITER_TARGET: { parse: () => ({}), forKind: () => ({}) },
    MutationObserver: class { observe() {} disconnect() {} },
    document: { body: {}, querySelectorAll: (sel) => (sel === 'h1' ? [{ textContent: 'Topic' }] : []) },
    DOMParser: class { parseFromString() { return { body: { querySelectorAll: () => [], textContent: 'Prompt' } }; } } };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const watch = (b) => {
    const sent = [];
    const box = { ...b, ready: true, frame: { isConnected: true }, port: { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) } };
    sandbox.GZ_WRITER_CONTEXT_DISCUSSION.watch(box, X);
    return { kind: b.kind, sent, context: () => sent.filter((m) => m.type === 'context').at(-1)?.context ?? b.context };
  };
  return { watch, boxes: (f, at = { path: pathname }) => U.boxes(fixture(f), at).map(watch) };
};
const keyOf = (box) => S.keyOf(box.context());

test('a post and every reply in one discussion share one store, under the school\'s host and URI-encoded parts', async () => {
  const t = tab({ host: 'BB.School.test:8443', pathname: DISCUSSION, search: '?view=discussions' });
  const [post, reply] = t.boxes('ultra-writer-discussion.html');
  assert.deepEqual([post.kind, reply.kind], ['post', 'reply']);
  await flush();
  assert.equal(keyOf(post), 'writer:sources:bb.school.test%3A8443|_42_1|_101_1|_9_1', 'the discussion\'s content id, as its route has it');
  assert.equal(keyOf(reply), keyOf(post), 'the reply cites from the post\'s store');
  assert.equal(reply.context().replyTo.id, '_201_1', 'the reply keeps what it answers');
  const other = tab({ pathname: '/ultra/courses/_101_1/outline/discussion/_11_1' }), [elsewhere] = other.boxes('ultra-writer-discussion.html', { path: '/ultra/courses/_101_1/outline/discussion/_11_1' });
  await flush();
  assert.equal(keyOf(elsewhere), 'writer:sources:bb.school.test|_42_1|_101_1|_11_1', 'another discussion has its own');
});

test('a course\'s new message and a journal each have their own store', async () => {
  const m = tab({ pathname: MESSAGES, search: '?courseId=_101_1' }), [message] = m.boxes('ultra-writer-messages.html');
  const j = tab({ pathname: JOURNAL }), [journal] = j.boxes('ultra-writer-journal.html');
  assert.deepEqual([message.kind, journal.kind], ['message', 'journal']);
  await flush();
  assert.equal(keyOf(message), 'writer:sources:bb.school.test|_42_1|_101_1|new-message');
  assert.equal(keyOf(journal), 'writer:sources:bb.school.test|_42_1|_101_1|_12_1', 'the journal\'s content id, as its route has it');
  assert.equal(journal.context().prompt, 'Reading Journal\nAfter each chapter, write a short entry on one image that stayed with you and why.', 'the journal keeps the prompt read off its page');
  const d = tab({ pathname: DISCUSSION }), [post] = d.boxes('ultra-writer-discussion.html');
  await flush();
  assert.equal(new Set([keyOf(message), keyOf(journal), keyOf(post)]).size, 3);
});

test('a test, a box whose student is unknown, and a message off its composer keep nothing in storage', async () => {
  const [attempt] = U.boxes(fixture('ultra-writer-test.html'), { path: TEST });
  assert.equal(attempt.kind, 'test');
  const t = tab({ pathname: TEST }), watched = t.watch(attempt);
  await flush();
  assert.deepEqual(watched.sent, [], 'a test\'s frame is sent no context');
  assert.equal(keyOf(watched), null);
  const out = tab({ pathname: DISCUSSION, me: async () => { throw Error('HTTP 401'); } }), [post] = out.boxes('ultra-writer-discussion.html');
  await flush();
  assert.equal(keyOf(post), null, 'never under a guessed student');
  const over = tab({ pathname: DISCUSSION }), [message] = over.boxes('ultra-writer-messages.html', { path: DISCUSSION });
  await flush();
  assert.equal(message.kind, 'message');
  assert.equal(keyOf(message), null, 'a message box on a discussion page never takes the discussion\'s store');
});

test('the store\'s parts never reach the AI', async () => {
  const d = tab({ pathname: DISCUSSION }), boxes = d.boxes('ultra-writer-discussion.html');
  boxes.push(...tab({ pathname: MESSAGES, search: '?courseId=_101_1' }).boxes('ultra-writer-messages.html'), ...tab({ pathname: JOURNAL }).boxes('ultra-writer-journal.html'));
  await flush();
  for (const box of boxes) {
    const ctx = box.context();
    assert.ok(S.keyOf(ctx), box.kind);
    const input = CO.task.input({ before: 'When memory returns it', mode: 'compose', kind: box.kind, context: ctx });
    assert.ok(input, box.kind);
    assert.doesNotMatch(JSON.stringify([W.clean(ctx), input.context]), /bb\.school|_42_1|_101_1|_9_1|_12_1|new-message/, box.kind);
  }
});

test('a journal prompt reaches the AI review context from its native box', async () => {
  const [journal] = tab({ pathname: JOURNAL }).boxes('ultra-writer-journal.html');
  await flush();
  const review = require('../lib/ai/tasks/writer-review.js');
  const input = review.task.input({ text: 'The river image stayed with me.', mode: 'compose', kind: 'journal', context: journal.context() });
  assert.equal(input.context.prompt, journal.context().prompt);
  const request = review.task.build(input, { text: { request: (r) => r } });
  assert.ok(request.context.some((b) => b.text === journal.context().prompt));
  assert.doesNotMatch(JSON.stringify(request.context), /bb\.school|_42_1|_101_1|_12_1/);
  assert.equal(W.clean({ prompt: { text: '<p>Read carefully.</p>' } }).prompt, 'Read carefully.');
});

test('a second student in the same browser gets a separate discussion store', async () => {
  const [a] = tab({ pathname: DISCUSSION }).boxes('ultra-writer-discussion.html');
  const [b] = tab({ pathname: DISCUSSION, me: async () => '_43_1' }).boxes('ultra-writer-discussion.html');
  await flush();
  assert.equal(keyOf(b), 'writer:sources:bb.school.test|_43_1|_101_1|_9_1');
  assert.notEqual(keyOf(a), keyOf(b));
});
