// Glaze Writer's content side with an assignment's paper (features/writer.js, paper mode). Full (Settings → Writer → Full
// writer): the frame is a page of its own, nothing it says is written into Ultra's editor or draft backup, Focus fills the
// window, and the assignment's context builder is asked once the frame is up. Compact (the default): the frame grows with
// its box, the paper's projection goes into Ultra's editor (never the draft backup), a switch resizes it and keeps the
// caret's line on screen, a sheet takes the paper's height, and Ultra's Submit sends the last edit first.
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('./helpers/writer-content.cjs');

const paper = async (full = true) => {
  const c = content({ fixture: 'attempt', writer: { full } });
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

// ---- the compact box ----------------------------------------------------------------------------------------------------
const PAPER = 'max(640px, calc(100vh - 120px))';
const ops = (text) => [{ insert: `${text}\n` }];
// The frame's height as last set: its style's own (the stand-in keeps it apart from cssText), else the one it opened with.
const height = (f) => f.style.height || /height:([^;]+)/.exec(f.style.cssText)?.[1];

test('an assignment opens compact by default: a box as tall as Ultra\'s, then as tall as the frame says', async () => {
  const { c, frame } = await paper(false);
  assert.equal(c.ports[0].sent[0].mode, 'paper', 'still the paper');
  assert.notEqual(height(frame), PAPER);
  c.emit({ type: 'view', full: false });
  c.emit({ type: 'height', px: 318 });
  assert.equal(height(frame), '318px');
});

test('compact: the paper\'s projection goes into Ultra\'s editor as a post\'s does, never into the draft backup', async () => {
  const { c, box } = await paper(false);
  c.emit({ type: 'view', full: false });
  c.emit({ type: 'change', html: '<p>Memory is a debt.</p>', text: 'Memory is a debt.', delta: ops('Memory is a debt.') });
  assert.equal(c.sets.length, 1);
  assert.equal(box.editor.innerHTML, '<p>Memory is a debt.</p>');
  c.tick(1000);
  assert.equal(c.kept.length, 0, 'the paper is in Writer\'s storage');
});

test('a switch to the full view takes the paper\'s height and writes nothing more; back, the box\'s height and its text again', async () => {
  const { c, box, frame } = await paper(false);
  c.emit({ type: 'view', full: false });
  c.emit({ type: 'change', html: '<p>One.</p>', text: 'One.', delta: ops('One.') });
  c.emit({ type: 'view', full: true, from: 400, to: 200 });
  assert.equal(height(frame), PAPER);
  c.emit({ type: 'height', px: 6 });
  assert.equal(height(frame), PAPER, 'a full paper\'s height reports don\'t shrink it');
  c.emit({ type: 'change', html: '<p>Two.</p>', text: 'Two.', delta: ops('Two.') });
  assert.equal(box.editor.innerHTML, '<p>One.</p>', 'the pages never write into Ultra\'s editor');
  c.emit({ type: 'view', full: false, px: 260, from: 120, to: 480 });
  assert.equal(height(frame), '260px');
  c.emit({ type: 'change', html: '<p>Three.</p>', text: 'Three.', delta: ops('Three.') });
  assert.equal(box.editor.innerHTML, '<p>Three.</p>');
});

test('compact: a sheet over the box takes the paper\'s height while it is open', async () => {
  const { c, frame } = await paper(false);
  c.emit({ type: 'view', full: false });
  c.emit({ type: 'height', px: 280 });
  c.emit({ type: 'room', on: true });
  assert.equal(height(frame), PAPER);
  c.emit({ type: 'height', px: 300 });
  assert.equal(height(frame), PAPER, 'the box growing meanwhile waits');
  c.emit({ type: 'room', on: false });
  assert.equal(height(frame), '300px');
});

test('compact: Submit and Save and Close wait for a fresh, saved frame snapshot, however slow, and say why one didn\'t go', async () => {
  for (const action of ['submit', 'save']) {
    const { c, box } = await paper(false);
    const button = c.doc.querySelector(`[data-analytics-id="assignment.attempt.authoring.footer.${action === 'save' ? 'saveAndClose' : action}"]`) || c.doc.querySelector('[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]');
    assert.ok(button, action);
    const click = () => { const e = { type: 'click', target: button, preventDefault() { this.held = true; }, stopImmediatePropagation() {} }; c.doc.dispatchEvent(e); return e; };
    const flushes = () => c.ports[0].sent.filter((m) => m.type === 'compact:flush').length;
    c.emit({ type: 'change', html: '<p>Earlier.</p>', text: 'Earlier.', delta: ops('Earlier.') });
    assert.equal(click().held, true, 'native action waits even when the previous projection synced');
    const request = c.ports[0].sent.at(-1).request;
    assert.equal(c.ports[0].sent.at(-1).type, 'compact:flush');
    assert.equal(c.ports[0].sent.at(-1).action, action, 'the frame is told which of Ultra\'s buttons waits');
    c.emit({ type: 'compact:flushed', request: 'stale', ok: true, html: '<p>Wrong.</p>', text: 'Wrong.', delta: ops('Wrong.') });
    assert.equal(c.clicks.length, 0);
    c.emit({ type: 'compact:flushed', request, ok: true, html: '<p>Last keystroke.</p>', text: 'Last keystroke.', delta: ops('Last keystroke.') });
    assert.equal(box.editor.innerHTML, '<p>Last keystroke.</p>');
    assert.deepEqual(c.clicks, [button]);
    assert.deepEqual({ ...c.ports[0].sent.at(-1) }, { type: 'compact:resume', request });
    click();
    const failed = c.ports[0].sent.at(-1).request;
    c.helper('fail');
    c.emit({ type: 'compact:flushed', request: failed, ok: true, html: '<p>Unsynced.</p>', text: 'Unsynced.', delta: ops('Unsynced.') });
    assert.equal(c.clicks.length, 1, 'failed native sync never clicks');
    assert.deepEqual({ ...c.ports[0].sent.at(-1) }, { type: 'compact:resume', request: failed, reason: 'text' }, 'and the frame is told why');
    c.helper('ok');
    // A slow save: Ultra's button stays held past what was once a 4 s bound, a second press waits on the same save, and the
    // reply, whenever it comes, sends Ultra's button once.
    click();
    const slow = c.ports[0].sent.at(-1).request, asked = flushes();
    for (const ms of [4000, 15000]) c.tick(ms);
    assert.equal(click().held, true);
    assert.equal(flushes(), asked, 'no second save is asked for while one runs');
    assert.equal(c.clicks.length, 1);
    c.emit({ type: 'compact:flushed', request: slow, ok: true, html: '<p>After a slow save.</p>', text: 'After a slow save.', delta: ops('After a slow save.') });
    assert.equal(box.editor.innerHTML, '<p>After a slow save.</p>');
    assert.deepEqual(c.clicks, [button, button], 'the slow save still sends Ultra\'s button, once');
    // The frame's own refusal (too long for Ultra's box, or not saved): nothing clicked, the frame says it in its bar.
    click();
    const long = c.ports[0].sent.at(-1).request;
    c.emit({ type: 'compact:flushed', request: long, ok: false, reason: 'long' });
    assert.equal(c.clicks.length, 2);
    assert.deepEqual({ ...c.ports[0].sent.at(-1) }, { type: 'compact:resume', request: long });
  }
});

test('compact: a reformatted Ultra echo never writes HTML back into the paper; a crashed frame reopens from storage', async () => {
  const { c, box, frame } = await paper(false);
  c.emit({ type: 'change', html: '<p>Projected.</p>', text: 'Projected.', delta: ops('Projected.') });
  box.editor.innerHTML = '<div><span>Projected.</span></div>';
  c.mutate(box.editor);
  assert.ok(!c.ports[0].sent.some((m) => m.type === 'html'));
  frame.remove(); c.ctx.GZ_WRITER.pass();
  const fresh = box.root.previousElementSibling;
  await c.boot(fresh); c.emit({ type: 'ready' }, 1);
  assert.equal(c.ports[1].sent[0].mode, 'paper');
  assert.ok(!c.ports[1].sent.some((m) => m.type === 'html'), 'only the paper store supplies the authoritative document');
});

test('compact: Blackboard editor gives the box back holding the paper\'s text', async () => {
  const { c, box, frame } = await paper(false);
  c.emit({ type: 'view', full: false });
  c.emit({ type: 'change', html: '<p>Kept.</p>', text: 'Kept.', delta: ops('Kept.') });
  c.emit({ type: 'native' });
  assert.ok(!frame.isConnected);
  assert.equal(box.editor.innerHTML, '<p>Kept.</p>');
});


test('compact: the file sheet owns its native click and text, without a second compact flush', async () => {
  const { c, box } = await paper(false);
  const button = c.doc.querySelector('[data-analytics-id="assignment.attempt.authoring.footer.submit"]');
  c.ctx.GZ_WRITER_SUBMIT = { passing: (b) => b === button };
  box.editor.innerHTML = '<p>Explicit submission note.</p>';
  const e = { type: 'click', target: button, preventDefault() { this.held = true; }, stopImmediatePropagation() {} };
  c.doc.dispatchEvent(e);
  assert.equal(!!e.held, false);
  assert.equal(box.editor.innerHTML, '<p>Explicit submission note.</p>');
  assert.ok(!c.ports[0].sent.some((m) => m.type === 'compact:flush'));
});

test('compact: native Submit cannot bypass the flush while a crashed frame is reopening', async () => {
  const { c, box, frame } = await paper(false);
  c.emit({ type: 'change', html: '<p>Earlier projection.</p>', text: 'Earlier projection.', delta: ops('Earlier projection.') });
  frame.remove(); c.ctx.GZ_WRITER.pass();
  const button = c.doc.querySelector('[data-analytics-id="assignment.attempt.authoring.footer.submit"]');
  const e = { type: 'click', target: button, preventDefault() { this.held = true; }, stopImmediatePropagation() {} };
  c.doc.dispatchEvent(e);
  assert.equal(e.held, true, 'the replacement must load the saved paper before native submission is available');
  assert.equal(box.editor.innerHTML, '<p>Earlier projection.</p>');
  assert.ok(!c.ports[1].sent.some((m) => m.type === 'compact:flush'), 'never ask an uninitialized frame to flush');
});
