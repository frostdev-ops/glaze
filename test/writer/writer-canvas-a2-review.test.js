const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('../helpers/writer-canvas-page.cjs');

test('Assignments 2: replacing a frame cancels its pending draft wait and allows a fresh flush', async () => {
  let saved = false;
  const c = await page({ fixture: 'a2', draft: () => saved });
  const button = c.box().send;
  button.removeAttribute('disabled'); button.disabled = false;
  c.press(button); c.flush('<p>Before the frame reopened.</p>');
  assert.equal(c.clicks.length, 0);
  c.doc.querySelector('iframe.gz-writer').dispatchEvent({ type: 'load' });
  await c.boot();
  saved = true;
  c.tick(100); c.tick(100);
  assert.equal(c.clicks.length, 0, 'the retired frame\'s Submit intent cannot press from its old snapshot');
  c.press(button); c.flush('<p>The replacement frame\'s document.</p>');
  c.tick(100); c.tick(100);
  assert.deepEqual(c.clicks, [button], 'a new press flushes the replacement frame and submits once');
});

test('Assignments 2: a suspended draft wait cannot replay Submit after its deadline', async () => {
  const c = await page({ fixture: 'a2', draft: () => true });
  const button = c.box().send;
  button.removeAttribute('disabled'); button.disabled = false;
  c.press(button); c.flush('<p>Saved before the page slept.</p>');
  assert.equal(c.clicks.length, 0, 'the first successful look waits for Canvas to draw');
  c.clock(115000); // The 100 ms callback runs only after the page resumes, at the 15 s deadline.
  c.tick(100);
  assert.equal(c.clicks.length, 0, 'an expired Submit intent must not become a delayed submission');
  assert.equal(c.ports.at(-1).sent.at(-1).type, 'held');
  c.press(button); c.flush('<p>Explicitly sent after the page woke.</p>');
  c.tick(100);
  assert.deepEqual(c.clicks, [button], 'expiry releases the wait so an explicit retry can submit');
});

test('Assignments 2: repeated presses wait for the latest edited content and replay once', async () => {
  let saved = '', c;
  c = await page({ fixture: 'a2', draft: () => saved === c.ctx.GZ_WRITER_CANVAS.read(c.box().editor).html });
  const button = c.box().send, port = c.ports.at(-1);
  button.removeAttribute('disabled'); button.disabled = false;
  c.press(button); c.press(button); c.flush('<p>First words.</p>');
  c.emit({ type: 'change', html: '<p>Last words.</p>', text: 'Last words.' });
  saved = '<p>First words.</p>';
  c.tick(100); c.tick(100);
  assert.equal(c.clicks.length, 0, 'the earlier saved draft cannot send the newer document');
  saved = '<p>Last words.</p>';
  c.tick(100); c.press(button); c.tick(100);
  assert.deepEqual(c.clicks, [button]);
  assert.equal(port.sent.filter((m) => m.type === 'flush').length, 1, 'repeat presses share the original flush');
});

test('Assignments 2: an unsaved draft times out visibly, releases its timer, and can be retried', async () => {
  let saved = false;
  const c = await page({ fixture: 'a2', draft: () => saved }), button = c.box().send;
  button.removeAttribute('disabled'); button.disabled = false;
  c.press(button); c.flush('<p>Still unsaved.</p>');
  c.clock(115000); c.tick(100);
  assert.equal(c.clicks.length, 0);
  assert.equal(c.ports.at(-1).sent.at(-1).type, 'held');
  assert.equal([...c.timers.values()].some((t) => t.ms === 100), false);
  saved = true;
  c.press(button); c.flush('<p>Still unsaved.</p>'); c.tick(100);
  assert.deepEqual(c.clicks, [button]);
});

for (const fixture of ['assignment', 'discussion', 'inbox']) test(`Canvas ${fixture}: holds still flush the frame once without waiting for an A2 draft`, async () => {
  let draftAsks = 0;
  const c = await page({ fixture, draft: () => { draftAsks++; return false; } });
  const button = c.box().send;
  c.press(button); c.press(button);
  assert.equal(c.clicks.length, 0);
  c.flush('<p>Current words.</p>');
  assert.deepEqual(c.clicks, [button]);
  assert.equal(c.ctx.GZ_WRITER_CANVAS.read(c.box().editor).text, 'Current words.');
  assert.equal(draftAsks, 0);
});

test('Canvas quiz: a shared submit waits for every essay and rechecks an earlier essay\'s current words', async () => {
  let draftAsks = 0;
  const c = await page({ fixture: 'quiz', draft: () => { draftAsks++; return false; } });
  const button = c.doc.querySelector('#submit_quiz_button'), [first, second] = c.ports;
  const answer = (port, html) => c.emit({ type: 'flushed', request: port.sent.find((m) => m.type === 'flush').request, html }, port);
  c.press(button); c.press(button);
  answer(first, '<p>First answer.</p>');
  assert.equal(c.clicks.length, 0);
  c.emit({ type: 'change', html: '<p>First answer revised.</p>', text: 'First answer revised.' }, first);
  answer(second, '<p>Second answer.</p>');
  assert.deepEqual(c.clicks, [button]);
  assert.equal(c.doc.querySelector('#question_input_0_ifr').contentDocument.body.textContent, 'First answer revised.');
  assert.equal(c.doc.querySelector('#question_input_4_ifr').contentDocument.body.textContent, 'Second answer.');
  assert.equal(draftAsks, 0);
});
