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
