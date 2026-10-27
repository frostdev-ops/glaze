const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('./helpers/writer-content.cjs');

test('cancelling an empty post releases Writer so the next native activation remains reachable', async () => {
  const c = content(); await c.start();
  const b = c.native(), frame = b.root.previousElementSibling;
  const cancel = b.editor.closest('form').querySelector('button[ng-click="messageControl.onCancelClick()"]');
  c.doc.dispatchEvent({ type: 'click', target: cancel });
  assert.ok(!frame.isConnected, 'empty Cancel leaves no stale Writer frame over the collapsed native composer');
  assert.notEqual(b.root.style.display, 'none');
});

test('Ultra collapsing its empty post releases Writer even without a captured Cancel event', async () => {
  const c = content(); await c.start();
  const b = c.native(), frame = b.root.previousElementSibling;
  const controls = b.editor.closest('form').querySelector('.form-buttons');
  controls.className += ' panel-editor-controls ng-hide';
  controls.setAttribute('aria-hidden', 'true');
  c.ctx.GZ_WRITER.pass();
  assert.ok(!frame.isConnected);
  assert.notEqual(b.root.style.display, 'none');
});

test('a focused native caret is passed to Writer before hiding its editor', async () => {
  const c = content(), b = c.native();
  b.editor.innerHTML = '<p>A</p>';
  c.doc.activeElement = b.editor;
  c.doc.addEventListener('gz-writer:get', (e) => {
    const m = JSON.parse(e.detail);
    c.doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: true, html: b.editor.innerHTML, selection: { index: 1, length: 0 } }) }));
  });
  await c.start();
  assert.deepEqual(JSON.parse(JSON.stringify(c.ports[0].sent.find((m) => m.type === 'init').selection)), { index: 1, length: 0 });
});

test('mounting Writer while the native editor has typing focus does not animate', async () => {
  const c = content(), b = c.native(), animations = [];
  c.doc.documentElement.setAttribute('data-gz-motion', 'subtle');
  c.ctx.matchMedia = () => ({ matches: false });
  c.doc.activeElement = b.editor;
  c.ctx.GZ_WRITER.pass(); await new Promise(setImmediate);
  const frames = c.doc.querySelectorAll('iframe.gz-writer');
  for (const frame of frames) frame.animate = () => animations.push(frame);
  for (const port of c.ports) port.onmessage({ data: { type: 'ready' } });
  assert.ok(!animations.includes(frames[0]), 'the active typing surface appears immediately');
  assert.ok(animations.includes(frames[1]), 'an idle editor still follows the Look motion level');
});

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

test('a test-shaped attempt reports test even if its gradebook cache says assignment', async () => {
  const c = content({ fixture: 'test' }); await c.start();
  assert.deepEqual(c.messages.filter((m) => m.type === 'glaze:attempt-kind').map((m) => m.kind), ['test']);
});

test('an attempt report is revoked when its assignment classification becomes unknown', async () => {
  const c = content({ fixture: 'attempt' });
  c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  c.ctx.GZ_CTX.bookFor = () => ({ results: [{ column: { contentId: '_7_1', assessmentSubtype: 'Assignment' } }] });
  await c.start();
  c.ctx.GZ_CTX.bookFor = () => ({ results: [] }); c.ctx.GZ_WRITER.pass(); await new Promise(setImmediate);
  assert.deepEqual(c.messages.filter((m) => m.type === 'glaze:attempt-kind').map((m) => m.kind), ['assignment', 'unknown']);
});

test('unchanged Writer boxes do not rescan their document bodies on every page observer pass', async () => {
  const c = content(); await c.start();
  let walks = 0;
  for (const b of [c.native(), c.native(1)]) {
    const all = b.editor.querySelectorAll.bind(b.editor);
    b.editor.querySelectorAll = (s) => { if (s === '*') walks++; return all(s); };
  }
  for (let n = 0; n < 20; n++) c.ctx.GZ_WRITER.pass();
  assert.equal(walks, 0, 'unchanged editor subtrees are already classified');
});

test('a reloaded Writer frame reopens with its buffered HTML even when native sync is unavailable', async () => {
  const c = content({ helper: 'fail' }); await c.start(); const b = c.native();
  c.emit({ type: 'change', html: '<p>Short draft</p>', text: 'Short draft', words: 2 });
  const frame = b.root.previousElementSibling;
  frame.dispatchEvent({ type: 'load' }); await new Promise(setImmediate);
  assert.equal(c.ports[0].closed, true, 'retire the channel to the lost frame');
  const p = c.ports.at(-1); p.onmessage({ data: { type: 'ready' } });
  assert.equal(p.sent.find((m) => m.type === 'init')?.html, '<p>Short draft</p>', 'recovery uses the buffered Writer document');
  assert.equal(b.root.style.display, 'none');
});

test('if a lost frame cannot get a new pass, its draft stays in a plain recovery editor', async () => {
  const c = content({ helper: 'fail' }); await c.start(); const b = c.native();
  c.emit({ type: 'change', html: '<p>Keep me</p>', text: 'Keep me', words: 2 });
  c.ctx.chrome.runtime.sendMessage = async () => ({ ok: false });
  b.root.previousElementSibling.dispatchEvent({ type: 'load' }); await new Promise(setImmediate);
  assert.equal(c.doc.querySelector('textarea[data-gz-writer-recovery]')?.value, 'Keep me');
});

test('an invalidated extension throwing before a new frame pass still exposes the buffered text', async () => {
  const c = content({ helper: 'fail' }); await c.start(); const b = c.native();
  c.emit({ type: 'change', html: '<p>Keep me</p>', text: 'Keep me', words: 2 });
  c.ctx.chrome.runtime.sendMessage = () => { throw Error('Extension context invalidated.'); };
  b.root.previousElementSibling.dispatchEvent({ type: 'load' }); await new Promise(setImmediate);
  assert.equal(c.doc.querySelector('textarea[data-gz-writer-recovery]')?.value, 'Keep me');
});

test('a box the frame refuses (content Writer can\'t keep) stays Blackboard\'s exactly as it was, with nothing written', async () => {
  const c = content(); await c.start();
  const b = c.native(), before = b.editor.innerHTML, frame = b.root.previousElementSibling;
  c.emit({ type: 'native', reason: 'attachment format' });
  assert.ok(!frame.isConnected, 'the frame goes');
  assert.notEqual(b.root.style.display, 'none', 'Ultra\'s editor is back in view');
  assert.ok(!b.root.hasAttribute('data-gz-writer'));
  assert.equal(b.editor.innerHTML, before, 'its HTML is untouched');
  assert.equal(c.sets.length, 0, 'nothing was ever written into it');
  const opened = c.ports.length;
  c.ctx.GZ_WRITER.pass(); await new Promise(setImmediate);
  assert.equal(c.ports.length, opened, 'and it isn\'t taken over again on later passes');
});

test('a refusal after the student wrote in Writer still hands their words back first', async () => {
  const c = content(); await c.start();
  const b = c.native();
  c.emit({ type: 'change', html: '<p>Written first</p>', text: 'Written first', words: 2 });
  c.emit({ type: 'native', reason: 'limit' });
  assert.equal(b.editor.textContent, 'Written first');
  assert.ok(!b.root.previousElementSibling?.matches?.('iframe.gz-writer'));
});

test('a page answering after the real write, with a wrong claim, can\'t make a confirmed write look failed', async () => {
  const c = content(); await c.start();
  const b = c.native(), frame = b.root.previousElementSibling;
  c.doc.addEventListener('gz-writer:set', (e) => { const m = JSON.parse(e.detail); c.doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: false }) })); });
  c.emit({ type: 'change', html: '<p>Written for real</p>', text: 'Written for real', words: 3 });
  c.emit({ type: 'native' });
  assert.ok(!frame.isConnected, 'the box goes back: the native editor holds the words');
  assert.equal(b.editor.textContent, 'Written for real');
});

test('send waits beyond one enable tick without rewriting the same native document', async () => {
  const c = content(); await c.start(); const b = c.native(1);
  c.emit({ type: 'change', html: '<p>Reply after rendering</p>', text: 'Reply after rendering', words: 3 }, 1);
  const written = c.sets.length;
  c.emit({ type: 'send' }, 1); c.tick(60);
  b.send.removeAttribute('disabled');
  c.tick(60);
  assert.equal(c.clicks.length, 1, 'an asynchronous native enable must not lose the shortcut');
  assert.equal(c.sets.length, written, 'polling must not reset native enablement by rewriting Quill');
  c.emit({ type: 'send' }, 1);
  assert.equal(c.clicks.length, 1);
});

test('editing cancels a pending send rather than posting the newer draft', async () => {
  const c = content(); await c.start(); const b = c.native(1);
  c.emit({ type: 'change', html: '<p>First draft</p>', text: 'First draft', words: 2 }, 1);
  c.emit({ type: 'send' }, 1);
  c.emit({ type: 'change', html: '<p>Still editing</p>', text: 'Still editing', words: 2 }, 1);
  b.send.removeAttribute('disabled'); c.tick(60);
  assert.equal(c.clicks.length, 0, 'new text requires a new send gesture');
});

test('a pending send expires and is cancelled when its box closes', async () => {
  const c = content(); await c.start(); const b = c.native(1);
  let now = 10000;
  c.ctx.Date = class extends Date { static now() { return now; } };
  c.emit({ type: 'change', html: '<p>Wait briefly</p>', text: 'Wait briefly', words: 2 }, 1);
  c.emit({ type: 'send' }, 1);
  now += 1001; b.send.removeAttribute('disabled'); c.tick(60);
  assert.equal(c.clicks.length, 0, 'a stale shortcut cannot send later');
  b.send.setAttribute('disabled', ''); c.emit({ type: 'send' }, 1);
  c.emit({ type: 'native' }, 1);
  assert.equal([...c.timers.values()].filter((t) => t.ms === 60).length, 0);
});
