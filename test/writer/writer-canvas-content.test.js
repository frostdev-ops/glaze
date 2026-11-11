const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('../helpers/writer-canvas-page.cjs');

test('Canvas: repeated Send clicks cannot replay the same document while its send is in flight', async () => {
  const c = await page();
  c.emit({ type: 'change', html: '<p>Send this reply once.</p>', text: 'Send this reply once.' });
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1);
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1, 'Canvas may leave Reply enabled until its network request finishes');
});

// Canvas refuses a send and leaves the box as it was: the Inbox with no recipient ("Please select a recipient"), a reply whose
// request failed (Reply on again). A send in flight shows on Canvas's side within a render (Reply disabled while it submits,
// DiscussionEdit.tsx; the Inbox's "Sending Message" spinner over the dialog, ComposeModalContainer.tsx).
for (const fixture of ['discussion', 'inbox']) test(`Canvas: ${fixture}: after Canvas refuses a send, the next press with the same text sends`, async () => {
  const c = await page({ fixture });
  c.emit({ type: 'change', html: '<p>Send this reply once.</p>', text: 'Send this reply once.' });
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1);
  c.clock(105000);
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 2, 'Send/Reply goes again');
  c.clock(110000);
  c.emit({ type: 'send' }); c.flush();
  assert.equal(c.clicks.length, 3, 'and Ctrl/Cmd+Enter');
});

test('Canvas: a shortcut can retry after the frame flush times out', async () => {
  const c = await page();
  c.emit({ type: 'change', html: '<p>Send this reply once.</p>', text: 'Send this reply once.' });
  c.emit({ type: 'send' }); c.tick(3000);
  assert.equal(c.clicks.length, 0);
  c.emit({ type: 'send' }); c.flush();
  assert.equal(c.clicks.length, 1, 'a held shortcut has not sent the document');
});

test('Canvas: an overdue flush reply cannot send before the timeout callback runs', async () => {
  const c = await page();
  c.press(c.box().send);
  c.clock(103000); // The page was suspended; its timeout task has not run yet.
  c.flush();
  assert.equal(c.clicks.length, 0, 'the request deadline applies even when timer tasks are delayed');
  assert.equal(c.ports.at(-1).sent.at(-1).type, 'held');
});

test('Canvas: replacing the frame retires its outstanding send request', async () => {
  const c = await page();
  c.press(c.box().send);
  const old = c.ports.at(-1), request = old.sent.find((m) => m.type === 'flush').request;
  c.doc.querySelector('iframe.gz-writer').dispatchEvent({ type: 'load' });
  await c.boot();
  c.emit({ type: 'flushed', request, html: '<p>Stale reply</p>' }, old);
  assert.equal(c.clicks.length, 0);
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1, 'a new press asks the replacement frame, without waiting on the retired frame');
});

for (const fixture of ['assignment', 'inbox']) test(`Canvas: ${fixture} carry-over cannot fill another destination with the same editor id`, async () => {
  const c = await page({ fixture, helper: 'fail' });
  c.emit({ type: 'change', html: '<p>Private unsynced words.</p>', text: 'Private unsynced words.' });
  c.doc.body.remove(); c.ctx.GZ_WRITER.pass(); // Keep the orphan before navigation.
  if (fixture === 'assignment') c.location.pathname = '/courses/34/assignments/239';
  else c.destination.to = ['address-book-label-9-user'];
  c.doc.body = c.load(); c.prepare(c.doc.body);
  await c.boot();
  assert.equal(c.ports.at(-1).sent.find((m) => m.type === 'init').html, '<p><br></p>', 'the editor id alone does not identify its destination');
});

test('Canvas: a remount at the same destination keeps its unsynced words', async () => {
  const c = await page({ fixture: 'assignment', helper: 'fail' });
  c.emit({ type: 'change', html: '<p>Private unsynced words.</p>', text: 'Private unsynced words.' });
  c.doc.body.remove(); c.ctx.GZ_WRITER.pass();
  c.doc.body = c.load(); c.prepare(c.doc.body); c.helper('ok');
  await c.boot();
  assert.equal(c.ports.at(-1).sent.find((m) => m.type === 'init').html, '<p>Private unsynced words.</p>');
  assert.equal(c.ctx.GZ_WRITER_CANVAS.read(c.box().editor).text, 'Private unsynced words.');
});

test('Canvas: changing Inbox recipients while a send is held requires a new press', async () => {
  const c = await page({ fixture: 'inbox' });
  c.emit({ type: 'change', html: '<p>Private message.</p>', text: 'Private message.' });
  c.press(c.box().send);
  c.destination.to = ['address-book-label-9-user'];
  c.flush('<p>Private message.</p>');
  assert.equal(c.clicks.length, 0, 'a press addressed to one recipient cannot send to another after the asynchronous flush');
  c.press(c.box().send); c.flush('<p>Private message.</p>');
  assert.equal(c.clicks.length, 1, 'the student can explicitly send to the new destination');
});

test('Canvas: a held send cannot replay a connected button that is no longer this box\'s send', async () => {
  const c = await page({ fixture: 'inbox' }), button = c.box().send;
  c.press(button);
  button.removeAttribute('data-testid');
  c.flush();
  assert.equal(c.clicks.length, 0, 'being connected and enabled does not establish the button\'s current action');
});

test('Canvas: disabling an Inbox field cannot discard Writer\'s only unsynced copy', async () => {
  const c = await page({ fixture: 'inbox', helper: 'fail' });
  c.emit({ type: 'change', html: '<p>These words exist only in Writer.</p>', text: 'These words exist only in Writer.' });
  c.box().editor.disabled = true; // Canvas disables this field while translating.
  c.tick(500);
  assert.equal(c.doc.querySelector('[data-gz-writer-recovery]')?.value, 'These words exist only in Writer.', 'failed synchronization must leave the text available even when draft backup is off');
});

// A classic quiz: an essay per RCE Canvas has drawn, all sent by one Submit Quiz (and, one question at a time, by Next and
// Previous), which the timer may also press with no click. Every essay's last words go in before Canvas's button does.
const quizFrames = (c) => c.ports.filter((p) => p.started && !p.closed);
const flushAll = (c, html = (i) => `<p>Essay ${i + 1}, last words.</p>`) => quizFrames(c).forEach((p, i) => {
  const request = p.sent.filter((m) => m.type === 'flush').at(-1)?.request;
  assert.ok(request, `essay ${i + 1} asked for its document`);
  c.emit({ type: 'flushed', request, html: html(i) }, p);
});
test('Canvas quiz: Writer opens on each drawn essay as a test, and Ctrl/Cmd+Enter never submits the quiz', async () => {
  const c = await page({ fixture: 'quiz' });
  const frames = c.doc.querySelectorAll('iframe.gz-writer');
  assert.deepEqual(frames.map((f) => f.getAttribute('data-gz-writer-frame')), ['test', 'test']);
  assert.deepEqual(quizFrames(c).map((p) => [p.sent.find((m) => m.type === 'init')?.kind, p.sent.find((m) => m.type === 'init')?.site]), [['test', 'canvas'], ['test', 'canvas']]);
  c.emit({ type: 'change', html: '<p>An answer.</p>', text: 'An answer.' }, quizFrames(c)[0]);
  assert.equal(c.ctx.GZ_WRITER_CANVAS.read(c.doc.querySelector('#question_input_0')).text, 'An answer.', 'each change goes into Canvas\'s editor at once');
  c.emit({ type: 'send' }, quizFrames(c)[0]);
  assert.equal(c.clicks.length, 0);
  assert.ok(!quizFrames(c)[0].sent.some((m) => m.type === 'flush'), 'the keys ask nothing of the frame');
});
test('Canvas quiz: submitting while Writer loads preserves edits made in Canvas after mount', async () => {
  const c = await page({ fixture: 'quiz', ready: () => false });
  const native = c.doc.querySelector('#question_input_0_ifr').contentDocument.body;
  native.innerHTML = '<p>Typed in Canvas while Writer loads.</p>';
  const submit = c.doc.querySelector('#submit_quiz_button');
  c.press(submit);
  assert.deepEqual(c.clicks, [submit]);
  assert.equal(native.textContent, 'Typed in Canvas while Writer loads.', 'an unready frame does not own the visible native editor');
});
test('Canvas quiz: a native essay can keep changing while a ready essay flushes', async () => {
  const c = await page({ fixture: 'quiz', ready: (frame) => !!frame.nextElementSibling.querySelector('#question_input_0') });
  const native = c.doc.querySelector('#question_input_4_ifr').contentDocument.body;
  native.innerHTML = '<p>Native answer.</p>';
  const submit = c.doc.querySelector('#submit_quiz_button');
  c.press(submit);
  native.innerHTML = '<p>Native answer, revised while waiting.</p>';
  flushAll(c);
  assert.deepEqual(c.clicks, [submit]);
  assert.equal(native.textContent, 'Native answer, revised while waiting.', 'the final check must use the visible native editor until Writer is ready');
});
test('Canvas quiz: Submit Quiz waits for every essay\'s frame, then goes once with all their words', async () => {
  const c = await page({ fixture: 'quiz' });
  const submit = c.doc.querySelector('#submit_quiz_button');
  c.press(submit);
  assert.equal(c.clicks.length, 0, 'held');
  const [first, second] = quizFrames(c);
  c.emit({ type: 'flushed', request: first.sent.filter((m) => m.type === 'flush').at(-1).request, html: '<p>Essay 1, last words.</p>' }, first);
  assert.equal(c.clicks.length, 0, 'one essay in: still waiting for the other');
  c.emit({ type: 'flushed', request: second.sent.filter((m) => m.type === 'flush').at(-1).request, html: '<p>Essay 2, last words.</p>' }, second);
  assert.deepEqual(c.clicks, [submit], 'both in: Submit Quiz goes once');
  assert.deepEqual(['#question_input_0', '#question_input_4'].map((id) => c.ctx.GZ_WRITER_CANVAS.read(c.doc.querySelector(id)).text), ['Essay 1, last words.', 'Essay 2, last words.']);
  c.press(submit); flushAll(c);
  assert.equal(c.clicks.length, 2, 'a quiz stays on its page after a refused submit: a second press goes again');
});
test('Canvas quiz: an earlier essay must still be synced when the last frame answers', async () => {
  const c = await page({ fixture: 'quiz' });
  const submit = c.doc.querySelector('#submit_quiz_button'), [first, second] = quizFrames(c);
  c.press(submit);
  c.emit({ type: 'flushed', request: first.sent.find((m) => m.type === 'flush').request, html: '<p>First answer.</p>' }, first);
  // The first frame can keep editing while the other frame is busy. A failed native write must not make the original
  // successful flush authoritative for that essay's newer document.
  c.helper('fail');
  c.emit({ type: 'change', html: '<p>First answer, revised.</p>', text: 'First answer, revised.' }, first);
  assert.equal(c.ctx.GZ_WRITER_CANVAS.read(c.doc.querySelector('#question_input_0')).text, 'First answer.');
  c.helper('ok');
  c.emit({ type: 'flushed', request: second.sent.find((m) => m.type === 'flush').request, html: '<p>Second answer.</p>' }, second);
  assert.deepEqual(c.clicks, [submit]);
  assert.equal(c.ctx.GZ_WRITER_CANVAS.read(c.doc.querySelector('#question_input_0')).text, 'First answer, revised.', 'the final replay must carry every current answer');
});
test('Canvas quiz: a newer unsynced edit in an already-flushed essay holds the whole send', async () => {
  const c = await page({ fixture: 'quiz' });
  const submit = c.doc.querySelector('#submit_quiz_button'), [first, second] = quizFrames(c);
  c.press(submit);
  c.emit({ type: 'flushed', request: first.sent.find((m) => m.type === 'flush').request, html: '<p>First answer.</p>' }, first);
  c.helper((ed) => ed.id === 'question_input_0' ? 'fail' : 'ok');
  c.emit({ type: 'change', html: '<p>First answer, revised.</p>', text: 'First answer, revised.' }, first);
  c.emit({ type: 'flushed', request: second.sent.find((m) => m.type === 'flush').request, html: '<p>Second answer.</p>' }, second);
  assert.equal(c.clicks.length, 0, 'the first essay still has words Canvas has not taken');
  assert.equal(first.sent.at(-1).type, 'held');
  c.helper('ok');
  c.press(submit); flushAll(c);
  assert.deepEqual(c.clicks, [submit], 'a fresh press can retry');
});
test('Canvas quiz: an essay Canvas\'s editor won\'t take holds Submit Quiz, and that frame says so', async () => {
  const c = await page({ fixture: 'quiz' });
  c.press(c.doc.querySelector('#submit_quiz_button'));
  c.helper('fail'); flushAll(c);
  assert.equal(c.clicks.length, 0);
  assert.ok(quizFrames(c).every((p) => p.sent.at(-1).type === 'held'));
  c.helper('ok');
  const [first] = quizFrames(c);
  c.press(c.doc.querySelector('#submit_quiz_button'));
  first.onmessage({ data: { type: 'flushed', request: first.sent.filter((m) => m.type === 'flush').at(-1).request, html: '<p>One.</p>' } });
  c.tick(3000);
  assert.equal(c.clicks.length, 0, 'a frame that never answers holds it too');
});
test('Canvas quiz, one question at a time: Next records the answer, so it waits for the essay\'s last words too', async () => {
  const c = await page({ fixture: 'quiz' });
  const submit = c.doc.querySelector('#submit_quiz_button'), next = c.doc.createElement('button');
  next.setAttribute('type', 'submit'); next.className = 'Button submit_button next-question btn-secondary';
  next.setAttribute('data-action', '/courses/36/quizzes/57/submissions/133/record_answer?next_question_path=%2Fcourses%2F36%2Fquizzes%2F57%2Ftake%2Fquestions%2F449&user_id=3');
  next.setAttribute('aria-label', 'Next Question');
  submit.before(next);
  c.press(next);
  assert.equal(c.clicks.length, 0);
  flushAll(c);
  assert.deepEqual(c.clicks, [next]);
});
