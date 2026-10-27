const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('./helpers/writer-content.cjs');

test('Writer keeps the full draft and frame when native sync and browser insertion both fail', async () => {
  const c = content({ helper: 'fail' }); await c.start();
  const b = c.native(), frame = b.root.previousElementSibling;
  c.emit({ type: 'change', html: '<p>Keep every word.</p>', text: 'Keep every word.', words: 3 });
  assert.ok(frame.isConnected, 'the only copy is still editable in Writer');
  assert.equal(b.root.style.display, 'none', 'a failed native write cannot hand the box back');
  c.emit({ type: 'native' });
  assert.ok(frame.isConnected, 'hand-back also waits for a confirmed native write');
});

test('a forged page-world success cannot release Writer when the native editor did not change', async () => {
  const c = content({ helper: 'spoof' }); await c.start();
  const frame = c.native().root.previousElementSibling;
  c.emit({ type: 'change', html: '<p>Unsynced draft</p>', text: 'Unsynced draft', words: 2 });
  c.emit({ type: 'native' });
  assert.ok(frame.isConnected, 'forged gz-writer:done is not proof of native content');
  assert.equal(c.clicks.length, 0);
});

test('one Writer send stays single while Ultra enables its button asynchronously', async () => {
  const c = content(); await c.start();
  const b = c.native();
  c.emit({ type: 'change', html: '<p>Send once</p>', text: 'Send once', words: 2 });
  c.emit({ type: 'send' }); c.emit({ type: 'send' });
  b.send.removeAttribute('disabled');
  c.tick(60);
  assert.equal(c.clicks.length, 1, 'two pending shortcuts must not click twice');
  c.emit({ type: 'send' });
  assert.equal(c.clicks.length, 1, 'the same draft is already sending');
});

test('a reused native button cannot turn Writer\'s shortcut into an attempt Submit', async () => {
  const c = content(); await c.start();
  const b = c.native();
  c.emit({ type: 'change', html: '<p>Draft</p>', text: 'Draft', words: 1 });
  b.send.removeAttribute('disabled');
  b.send.textContent = 'Submit';
  c.location.pathname = '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1';
  c.emit({ type: 'send' }); c.tick(60);
  assert.equal(c.clicks.length, 0, 'kind and button must be resolved for the current route');
});
