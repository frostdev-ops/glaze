// Glaze Writer's Ultra adapter (lib/writer-ultra.js) over the probed box shapes (test/fixtures/ultra-writer-*): which box
// is what, its send button, what a reply answers, and what stays Ultra's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');
const U = require('../lib/writer-ultra.js');

const raw = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const page = (f) => { const doc = { activeElement: null }; doc.root = new El('html', doc); doc.body = parse(raw(f), doc); return doc.body; };
const DISCUSSION = '/ultra/courses/_101_1/discussion/_9_1', MESSAGES = '/ultra/messages/create', ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';

test('every fixture says where its shape came from', () => {
  for (const f of ['ultra-writer-discussion.html', 'ultra-writer-messages.html', 'ultra-writer-attempt.html', 'ultra-writer-test.html']) assert.match(raw(f), /_note: shape from the owner's Ultra, 2026-10-27, synthetic values/, f);
  assert.match(JSON.parse(raw('ultra-writer-gradebook.json'))._note, /^Glaze test fixture: Blackboard Ultra .* synthetic values\. Shape from the owner's Ultra, 2026-10-27/);
});

test('a discussion: the new-post composer is a post, the open reply a reply to its post, read-only bodies nothing', () => {
  const body = page('ultra-writer-discussion.html');
  const boxes = U.boxes(body, { path: DISCUSSION });
  assert.deepEqual(boxes.map((b) => [b.kind, b.mode, b.editor.getAttribute('data-placeholder')]), [['post', 'compose', 'Type a post'], ['reply', 'compose', 'Type a reply']]);
  const [post, reply] = boxes;
  assert.equal(post.send.textContent, 'Post');
  assert.equal(reply.send.textContent, 'Reply');
  assert.equal(post.root.tagName, 'BB-RICH-TEXT-EDITOR', 'the whole editor, toolbar and word count with it, but not its buttons');
  assert.ok(!post.root.contains(post.send) && post.root.contains(post.editor) && post.root.contains(post.container));
  assert.ok(reply.container.className.includes('ql-container'));
  assert.deepEqual(post.context, {});
  assert.deepEqual(reply.context, { post: { id: '_201_1', author: 'Jordan Lee', text: "The river is where the past refuses to stay buried. Every time a character crosses it, they carry something they can't put down, and the novel keeps returning to the bank as if the water itself were keeping score." } });
  assert.equal(U.enabled(post.send), false, 'Ultra disables Post while the box is empty');
  post.send.removeAttribute('disabled');
  assert.equal(U.enabled(post.send), true);
  post.send.setAttribute('aria-disabled', 'true');
  assert.equal(U.enabled(post.send), false);
});

test('a discussion box off a discussion page, or editing a post in the thread, stays Ultra\'s', () => {
  const body = page('ultra-writer-discussion.html');
  assert.deepEqual(U.boxes(body, { path: '/ultra/courses/_101_1/outline' }), []);
  // An editor inside a thread but not in a reply's wrapper: Ultra's edit of a post.
  const reply = U.boxes(body, { path: DISCUSSION })[1];
  const wrapper = reply.editor.closest('.reply-input-wrapper');
  wrapper.className = 'row collapse';
  assert.deepEqual(U.boxes(body, { path: DISCUSSION }).map((b) => b.kind), ['post']);
});

test('messages compose is a message, sent by its Send', () => {
  const [box, ...rest] = U.boxes(page('ultra-writer-messages.html'), { path: MESSAGES });
  assert.equal(rest.length, 0);
  assert.equal(box.kind, 'message');
  assert.equal(box.root.tagName, 'REACT-EDITOR-WRAPPER');
  assert.equal(box.send.textContent, 'Send');
  assert.deepEqual(box.context, {});
});

test('an assignment attempt: paper mode in Ultra\'s authoring panel, its Submit, its instructions as the prompt', () => {
  const body = page('ultra-writer-attempt.html');
  const at = (attempt) => U.boxes(body, { path: ATTEMPT, attempt });
  const [box, ...rest] = at('');
  assert.equal(rest.length, 0, 'the read-only instructions are not a box');
  assert.deepEqual([box.kind, box.mode, box.send.textContent, box.send.getAttribute('data-analytics-id')], ['assignment', 'paper', 'Submit', 'assignment.attempt.authoring.footer.submit']);
  assert.ok(box.root.className.includes('bb-editor-root') && !box.root.querySelector('input[type="file"]'), 'its file area stays Ultra\'s, outside the box');
  assert.deepEqual(box.context, { prompt: 'Essay 2\nWrite 1,200 words on memory in Beloved, in MLA format, citing at least three sources.' });
  assert.deepEqual(at('test').map((b) => [b.kind, b.mode]), [['test', 'compose']], 'a gradebook that says test keeps the AI off');
  assert.deepEqual(U.boxes(body, { path: DISCUSSION }), [], 'off an attempt page it is nothing');
});

test('a test attempt: its Additional content box is a test in compose mode, sent by the footer\'s Submit', () => {
  const [box, ...rest] = U.boxes(page('ultra-writer-test.html'), { path: '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1' });
  assert.equal(rest.length, 0);
  assert.deepEqual([box.kind, box.mode, box.root.tagName, box.send.getAttribute('analytics-id')], ['test', 'compose', 'BB-RICH-TEXT-EDITOR', 'course.content.assessment.footer.buttons.submit']);
  assert.deepEqual(box.context, {});
  assert.deepEqual(U.attemptAt(ATTEMPT), { course: '_101_1', content: '_7_1' });
  assert.deepEqual(U.attemptAt('/ultra/courses/_101_1/outline/assessment/_8_1/attempt/_31_1'), { course: '_101_1', content: '_8_1' });
  assert.equal(U.attemptAt(DISCUSSION), null);
  assert.ok(U.KINDS.includes('comment') && U.KINDS.includes('journal'), 'kinds Ultra was not seen to have stay named');
});

test('an attempt\'s kind comes from its gradebook column, and is unknown without one', () => {
  const rows = JSON.parse(raw('ultra-writer-gradebook.json')).results;
  assert.equal(U.attemptKind(rows, '_7_1'), 'assignment');
  assert.equal(U.attemptKind(rows, '_8_1'), 'test');
  assert.equal(U.attemptKind(rows, '_9_1'), '');
  assert.equal(U.attemptKind(undefined, '_7_1'), '');
  assert.equal(U.attemptKind([{ column: { contentId: '_7_1' } }], '_7_1'), '', 'a column without a subtype names nothing');
});

test('conflicting gradebook rows can never turn a test into an assignment', () => {
  const col = (assessmentSubtype) => ({ column: { contentId: '_7_1', assessmentSubtype } });
  assert.equal(U.attemptKind([col('Assignment'), col('Test')], '_7_1'), 'test');
  assert.equal(U.attemptKind([col('Assignment'), col(undefined)], '_7_1'), '', 'incomplete conflicting evidence fails closed');
});

test('native attachments and formatting outside the frame schema are never taken over and discarded', () => {
  for (const make of [
    (doc) => new El('img', doc),
    (doc) => new El('table', doc),
    (doc) => { const p = new El('p', doc); p.className = 'ql-align-center'; p.textContent = 'Centered text'; return p; },
    (doc) => { const s = new El('span', doc); s.setAttribute('style', 'color: red'); s.textContent = 'Colored text'; return s; },
  ]) {
    const body = page('ultra-writer-discussion.html'), [post] = U.boxes(body, { path: DISCUSSION });
    post.editor.append(make(body.doc));
    assert.ok(!U.boxes(body, { path: DISCUSSION }).some((b) => b.editor === post.editor), 'unsupported content stays in Blackboard');
  }
});
