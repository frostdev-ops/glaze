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

test('an unsolicited native clear cannot erase what the student wrote in Writer', async () => {
  const c = content(); await c.start(); const b = c.native();
  c.emit({ type: 'change', html: '<p>Still writing</p>', text: 'Still writing', words: 2 });
  c.ports[0].sent.length = 0;
  b.editor.innerHTML = '<p><br></p>'; c.mutate(b.editor);
  assert.equal(c.ports[0].sent.filter((m) => m.type === 'html').length, 0, 'only a clear after sending may clear Writer');
  c.emit({ type: 'native' });
  assert.equal(b.editor.textContent, 'Still writing', 'hand-back restores the retained draft');
});

test('a reply node reused for another post never receives the previous post\'s Writer draft', async () => {
  const c = content(); await c.start(); const b = c.native(1);
  c.emit({ type: 'change', html: '<p>For the original post</p>', text: 'For the original post', words: 4 }, 1);
  b.editor.closest('.comment-and-reply').querySelector('[message-id]').setAttribute('message-id', '_999_1');
  b.editor.innerHTML = '<p>New destination</p>';
  c.emit({ type: 'change', html: '<p>Original draft plus one</p>', text: 'Original draft plus one', words: 4 }, 1);
  assert.equal(b.editor.textContent, 'New destination', 'stale frame cannot write into a reused node');
  c.ctx.GZ_WRITER.pass();
  assert.ok(c.kept.some((s) => s.near === '_201_1' && s.text === 'Original draft plus one'), 'backup uses the original destination');
});

test('losing a failed-sync frame journals its complete text before releasing the box', async () => {
  const c = content({ helper: 'fail' }); await c.start(); const b = c.native();
  c.emit({ type: 'change', html: '<p>Recover after a crash</p>', text: 'Recover after a crash', words: 4 });
  b.root.previousElementSibling.remove(); c.ctx.GZ_WRITER.pass();
  assert.ok(c.kept.some((s) => s.html === '<p>Recover after a crash</p>'), 'draft backup receives the frame\'s text, not the stale native text');
});

test('an empty editor with a recovery copy stays native so draft recovery is available', async () => {
  const c = content({ recovery: true }); await c.start();
  assert.equal(c.doc.querySelectorAll('iframe.gz-writer').length, 0, 'Writer must not hide the recovery offer');
  assert.equal(c.doc.querySelectorAll('[data-gz-writer]').length, 0);
});
