// Glaze Writer's content side with an assignment's paper (features/writer.js, paper mode): the frame is a page of its
// own, nothing it says is written into Ultra's editor or draft backup, Focus fills the window, and the assignment's
// context builder is asked once the frame is up.
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('./helpers/writer-content.cjs');

const paper = async () => {
  const c = content({ fixture: 'attempt' });
  c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  const sent = [];
  c.ctx.GZ_WRITER_CONTEXT_ASSIGNMENT = { send: async (X, box, alive) => { sent.push({ box, alive: alive() }); } };
  await c.start();
  await new Promise(setImmediate);
  return { c, sent, box: c.native(), frame: c.native().root.previousElementSibling };
};

test('an assignment mounts in paper mode, as tall as the window allows, and asks for its context', async () => {
  const { c, sent, frame } = await paper();
  assert.equal(frame.getAttribute('data-gz-writer-frame'), 'assignment');
  assert.equal(c.ports[0].sent[0].mode, 'paper');
  assert.match(frame.style.cssText, /height:\s*max\(640px, calc\(100vh - 120px\)\)/);
  c.emit({ type: 'height', px: 200 });
  assert.match(frame.style.cssText, /max\(640px/, 'its own height reports don\'t shrink it');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].alive, true);
});

test('a paper never goes into Ultra\'s editor or draft backup', async () => {
  const { c, box } = await paper();
  const before = box.editor.innerHTML;
  c.emit({ type: 'change', html: '<p>Alex Rivera</p><p>A whole paper.</p>', text: 'Alex Rivera\nA whole paper.', words: 5, delta: null });
  c.tick(1000);
  assert.equal(box.editor.innerHTML, before);
  assert.equal(c.sets.length, 0, 'no page-world write');
  assert.equal(c.kept.length, 0, 'no draft copy');
  c.mutate(box.editor);
  assert.ok(!c.ports[0].sent.some((m) => m.type === 'html'), 'Ultra\'s editor changing doesn\'t overwrite the paper');
});

test('Focus: the frame fills the window over a dim until the frame ends it', async () => {
  const { c, frame } = await paper();
  const was = frame.style.cssText;
  c.emit({ type: 'focus-mode', on: true });
  assert.match(frame.style.cssText, /position:\s*fixed/);
  assert.match(frame.style.cssText, /z-index:\s*2147483647/);
  const dim = c.doc.body.children.at(-1);
  assert.match(dim.style.cssText, /position:\s*fixed/);
  c.emit({ type: 'focus-mode', on: false });
  assert.equal(frame.style.cssText, was);
  assert.ok(!dim.isConnected);
});

test('"Blackboard editor" from a paper gives the box back as it was, writing nothing', async () => {
  const { c, box, frame } = await paper();
  const before = box.editor.innerHTML;
  c.emit({ type: 'native' });
  assert.ok(!frame.isConnected);
  assert.ok(!box.root.hasAttribute('data-gz-writer') && !box.container.hasAttribute('data-gz-writer-id'));
  assert.equal(box.editor.innerHTML, before);
  assert.equal(c.sets.length, 0);
});
