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
