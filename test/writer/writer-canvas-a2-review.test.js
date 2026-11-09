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
