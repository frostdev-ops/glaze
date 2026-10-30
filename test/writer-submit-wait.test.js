// Ultra's Submit and Save and Close pressed while Writer's paper frame is slow, loading or reopening: never a press that
// does nothing. The full view's (features/writer-submit.js act): Save and Close waits for the frame's save however long,
// asks a frame that reopened again, presses Ultra's button once (found again if Ultra redrew it), and lets go when the
// box is no longer Writer's; Submit waits for a frame to open the sheet in. Before the frame is up (features/writer.js
// hold): the compact box's press waits for the frame and its view, then asks it to save; the full view's waits for the
// submit step. Ultra's button is marked busy meanwhile. In the browser: scripts/writer-submit-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const L = require('../lib/writer-submit.js');
const page = require('./helpers/writer-submit-page.cjs');
const content = require('./helpers/writer-content.cjs');

const SAVE = '[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]', SUBMIT = '[data-analytics-id="assignment.attempt.authoring.footer.submit"]';
const asks = (sent) => sent.filter((m) => m.type === 'submit:save');

test('full: Save and Close waits for the save however long it takes, then Ultra\'s own goes once', async () => {
  const p = page(), save = L.footer(p.box.editor).save;
  assert.equal(p.fire(save, 'click').stopped, true);
  const [ask] = asks(p.sent);
  assert.ok(ask, 'the frame is asked to save');
  assert.equal(save.getAttribute('aria-busy'), 'true', 'Ultra\'s button marked busy');
  for (const ms of [4000, 15000]) await p.tick(ms);
  assert.equal(p.clicks.length, 0, 'no give-up at 4 s (or any time) on the page\'s side');
  assert.equal(asks(p.sent).length, 1, 'asked once');
  assert.equal(p.fire(save, 'click').stopped, true);
  assert.equal(asks(p.sent).length, 1, 'a second press waits on the same save');
  p.hear({ type: 'submit:saved', request: ask.request, ok: true });
  assert.deepEqual(p.clicks, [save], 'saved: Ultra\'s Save and Close, once');
  assert.equal(save.hasAttribute('aria-busy'), false);
  p.hear({ type: 'submit:saved', request: ask.request, ok: true });
  assert.equal(p.clicks.length, 1, 'a repeated answer presses nothing');
});

test('full: Save and Close presses the footer Ultra drew meanwhile; a failed save presses nothing', async () => {
  const p = page(), old = L.footer(p.box.editor).save;
  p.fire(old, 'click');
  const fresh = new El('button', p.doc);
  fresh.setAttribute('type', 'button'); fresh.setAttribute('data-analytics-id', old.getAttribute('data-analytics-id'));
  fresh.getClientRects = () => [{}];
  old.replaceWith(fresh);
  p.hear({ type: 'submit:saved', request: asks(p.sent)[0].request, ok: true });
  assert.deepEqual(p.clicks, [fresh]);
  p.fire(fresh, 'click');
  p.hear({ type: 'submit:saved', request: asks(p.sent)[1].request, ok: false });
  assert.deepEqual(p.clicks, [fresh], 'not saved: Ultra\'s button stays (the frame says why)');
  assert.equal(fresh.hasAttribute('aria-busy'), false);
});

test('full: a frame that reopens before answering is asked again; a box no longer Writer\'s lets go', async () => {
  const p = page(), save = L.footer(p.box.editor).save, first = p.box.port, again = [];
  p.fire(save, 'click');
  const request = asks(p.sent)[0].request;
  // features/writer.js reopen: a new frame and port, not ready yet.
  p.box.ready = false; p.box.port = { postMessage: (m) => again.push(m) };
  await p.tick(100);
  assert.equal(asks(again).length, 0, 'not asked of a frame that isn\'t up');
  p.box.ready = true;
  await p.tick(100);
  assert.deepEqual(asks(again).map((m) => m.request), [request], 'asked again of the new frame, the same request');
  await p.tick(100);
  assert.equal(asks(again).length, 1, 'once');
  assert.notEqual(first, p.box.port);
  p.hear({ type: 'submit:saved', request, ok: true });
  assert.deepEqual(p.clicks, [save]);
  // Gone: Writer gave the box back (its frame, its armed state): nothing pressed, and a new press asks anew later.
  p.fire(save, 'click');
  p.own(false);
  await p.tick(100);
  assert.equal(p.clicks.length, 1);
  assert.equal(save.hasAttribute('aria-busy'), false, 'let go, unmarked');
});

test('full: a save lost with its frame (no answer past the frame\'s own bound) lets a new press ask anew, once', async () => {
  const p = page(), save = L.footer(p.box.editor).save;
  p.fire(save, 'click');
  const lost = asks(p.sent)[0].request;
  await p.tick(51000);
  p.fire(save, 'click');
  const fresh = asks(p.sent)[1]?.request;
  assert.ok(fresh && fresh !== lost);
  p.hear({ type: 'submit:saved', request: lost, ok: true });
  assert.equal(p.clicks.length, 0, 'the lost one\'s late answer presses nothing');
  p.hear({ type: 'submit:saved', request: fresh, ok: true });
  assert.deepEqual(p.clicks, [save]);
});

test('full: Submit pressed while the frame reopens opens the sheet once the frame is up', async () => {
  const p = page(), submit = p.button();
  p.box.ready = false;
  assert.equal(p.fire(submit, 'click').stopped, true);
  assert.equal(p.fire(submit, 'click').stopped, true);
  await p.tick(100);
  assert.equal(p.sent.filter((m) => m.type === 'submit:open').length, 0);
  assert.equal(submit.getAttribute('aria-busy'), 'true');
  p.box.ready = true;
  await p.tick(100);
  await p.tick(100);
  assert.equal(p.sent.filter((m) => m.type === 'submit:open').length, 1, 'one sheet for two presses');
  assert.equal(submit.hasAttribute('aria-busy'), false);
});

// ---- before the frame is up (features/writer.js)
const attempt = async (full) => {
  const c = content({ fixture: 'attempt', writer: { full } });
  c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  c.ctx.GZ_WRITER_CONTEXT_ASSIGNMENT = { send: async () => {} };
  await c.start();
  await new Promise(setImmediate);
  const press = (sel) => { const target = c.doc.querySelector(sel), e = { type: 'click', target, preventDefault() { this.held = true; }, stopImmediatePropagation() {} }; c.doc.dispatchEvent(e); return e; };
  const frame = () => c.native().root.previousElementSibling;
  // features/writer.js reopen (its frame gone), then the new frame up: claimed, ready, its view said.
  const reopen = () => { frame().remove(); c.ctx.GZ_WRITER.pass(); };
  const up = async (i, full = false) => { await c.boot(frame()); c.ports[i].onmessage({ data: { type: 'ready' } }); c.emit({ type: 'view', full }, i); };
  return { c, press, frame, reopen, up };
};
const flushes = (port) => port.sent.filter((m) => m.type === 'compact:flush');
const ok = { ok: true, html: '<p>Last words.</p>', text: 'Last words.', delta: [{ insert: 'Last words.\n' }] };

test('compact: Submit pressed while the frame reopens waits, marked busy, and asks the new frame once it is up', async () => {
  const { c, press, reopen, up } = await attempt(false);
  c.emit({ type: 'view', full: false });
  reopen();
  const button = c.doc.querySelector(SUBMIT);
  assert.equal(press(SUBMIT).held, true, 'Ultra doesn\'t hear it');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  c.tick(100);
  assert.equal(flushes(c.ports[1]).length, 0, 'no frame up to ask');
  await c.boot(c.native().root.previousElementSibling);
  c.ports[1].onmessage({ data: { type: 'ready' } });
  c.tick(100);
  assert.equal(flushes(c.ports[1]).length, 0, 'not before the frame has said its view (which would end it)');
  c.emit({ type: 'view', full: false }, 1);
  c.tick(100);
  const [f] = flushes(c.ports[1]);
  assert.equal(f?.action, 'submit');
  assert.equal(c.clicks.length, 0);
  c.emit({ type: 'compact:flushed', request: f.request, ...ok }, 1);
  assert.deepEqual(c.clicks, [button], 'then Ultra\'s Submit once, with the frame\'s last words');
  assert.equal(c.native().editor.innerHTML, '<p>Last words.</p>');
  c.tick(100);
  assert.equal(button.hasAttribute('aria-busy'), false);
});

test('compact: a frame that reopens while it saves is asked again; the old frame\'s late answer sends nothing', async () => {
  const { c, press, reopen, up } = await attempt(false);
  c.emit({ type: 'view', full: false });
  press(SAVE);
  const [old] = flushes(c.ports[0]);
  assert.equal(old?.action, 'save');
  reopen();
  await up(1);
  c.tick(100);
  const [again] = flushes(c.ports[1]);
  assert.ok(again && again.request !== old.request, 'asked of the new frame');
  c.ports[0].onmessage({ data: { type: 'compact:flushed', request: old.request, ...ok } });
  assert.equal(c.clicks.length, 0, 'the old frame\'s answer is heard by no one');
  c.emit({ type: 'compact:flushed', request: again.request, ...ok }, 1);
  assert.deepEqual(c.clicks, [c.doc.querySelector(SAVE)], 'Save and Close once');
  c.tick(100);
  assert.equal(flushes(c.ports[1]).length, 1, 'and never asked twice');
});

test('full: a press before the submit step has the box goes to it once armed, and never to Ultra without the paper', async () => {
  const { c, press } = await attempt(true);
  const button = c.doc.querySelector(SUBMIT);
  assert.equal(press(SUBMIT).held, true, 'Ultra doesn\'t hear it: its box doesn\'t hold the paper');
  c.tick(100);
  assert.equal(c.clicks.length, 0);
  c.ctx.GZ_WRITER_SUBMIT = { armed: () => true, passing: () => false, press: (_box, b) => c.clicks.push(b) };
  c.tick(100);
  assert.deepEqual(c.clicks, [button], 'pressed again, for the submit step (its sheet)');
  // A box the step never takes cannot submit Ultra's empty or stale text box.
  delete c.ctx.GZ_WRITER_SUBMIT;
  let now = 1e6;
  c.ctx.__now = () => now;
  vm.runInContext('Date.now = () => globalThis.__now()', c.ctx);
  press(SUBMIT);
  c.tick(100);
  now += 4000; c.tick(100);
  assert.equal(c.clicks.length, 1);
  now += 1500; c.tick(100);
  assert.equal(c.clicks.length, 1, 'a missing submit step never passes the press to Ultra');
  assert.equal(button.hasAttribute('aria-busy'), false);
});

test('full: a lost Save and Close clears its poll and busy state before a retry, ignoring late success', async () => {
  const p = page(), save = L.footer(p.box.editor).save;
  p.fire(save, 'click');
  const request = asks(p.sent)[0].request;
  await p.tick(51000);
  assert.equal(save.hasAttribute('aria-busy'), false, 'a quiet frame cannot leave the button busy forever');
  assert.equal(p.timers.size, 0, 'no poll remains after the deadline');
  p.hear({ type: 'submit:saved', request, ok: true });
  assert.equal(p.clicks.length, 0, 'a success after the deadline presses nothing');
  p.fire(save, 'click');
  const retry = asks(p.sent)[1].request;
  p.hear({ type: 'submit:saved', request: retry, ok: true });
  await p.tick(100);
  assert.deepEqual(p.clicks, [save]);
  assert.equal(p.timers.size, 0);
});

test('full: a Submit held for readiness cannot race Save and Close, and conversely', async () => {
  for (const first of ['submit', 'save']) {
    const p = page(), footer = L.footer(p.box.editor);
    p.box.ready = false;
    p.fire(footer[first], 'click');
    p.fire(footer[first === 'submit' ? 'save' : 'submit'], 'click');
    p.box.ready = true;
    await p.tick(100);
    assert.equal(asks(p.sent).length, first === 'save' ? 1 : 0);
    assert.equal(p.sent.filter((m) => m.type === 'submit:open').length, first === 'submit' ? 1 : 0, 'only the first action is dispatched');
  }
});

test('full: redraw transfers busy feedback and disconnected buttons are cleared when ownership ends', async () => {
  const p = page(), old = L.footer(p.box.editor).save;
  p.fire(old, 'click');
  const fresh = new El('button', p.doc);
  fresh.setAttribute('type', 'button'); fresh.setAttribute('data-analytics-id', old.getAttribute('data-analytics-id'));
  fresh.getClientRects = () => [{}];
  old.replaceWith(fresh);
  await p.tick(100);
  assert.equal(old.hasAttribute('aria-busy'), false, 'detached footer released');
  assert.equal(fresh.getAttribute('aria-busy'), 'true', 'the visible footer shows the outstanding save');
  p.own(false);
  await p.tick(100);
  assert.equal(fresh.hasAttribute('aria-busy'), false);
  assert.equal(p.timers.size, 0);
  assert.equal(p.clicks.length, 0);
});

test('compact: a footer redrawn during a flush carries busy state until its single native press', async () => {
  const { c, press } = await attempt(false);
  c.emit({ type: 'view', full: false });
  const old = c.doc.querySelector(SUBMIT), parent = old.parentElement;
  press(SUBMIT);
  const request = flushes(c.ports[0])[0].request;
  const fresh = c.doc.createElement('button');
  fresh.setAttribute('data-analytics-id', old.getAttribute('data-analytics-id'));
  old.remove(); parent.append(fresh);
  c.tick(100);
  assert.equal(old.hasAttribute('aria-busy'), false);
  assert.equal(fresh.getAttribute('aria-busy'), 'true');
  c.emit({ type: 'compact:flushed', request, ...ok });
  c.tick(100);
  assert.equal(c.clicks.length, 1);
  assert.equal(c.clicks[0], fresh);
  assert.equal(fresh.hasAttribute('aria-busy'), false);
  assert.equal(fresh.style.getPropertyValue('cursor'), '');
});

test('full: a save acknowledgement after the deadline cannot beat a throttled expiry poll', () => {
  const p = page(), save = L.footer(p.box.editor).save;
  p.fire(save, 'click');
  const request = asks(p.sent)[0].request;
  p.ctx.Date.now = () => p.now() + 51000;
  p.hear({ type: 'submit:saved', request, ok: true });
  assert.equal(p.clicks.length, 0);
  assert.equal(save.hasAttribute('aria-busy'), false);
});

test('full: a held click handed off after Ultra disables Submit still opens the sheet once', async () => {
  const { c, press } = await attempt(true);
  let box;
  c.ctx.GZ_WRITER_SUBMIT = { armed: (b) => { box = b; return false; } };
  press(SUBMIT);
  // Ultra disables its empty box's button before the submit module is armed. Native .click() now delivers no event.
  const b = c.doc.querySelector(SUBMIT); b.disabled = true; b.click = () => {};
  delete c.ctx.GZ_WRITER_SUBMIT;
  c.ctx.GZ_WRITER_SUBMIT_LIB = L;
  vm.runInContext(require('node:fs').readFileSync(require.resolve('../features/writer-submit.js'), 'utf8'), c.ctx);
  c.ctx.GZ_WRITER_SUBMIT.hear(box, { type: 'submit:arm' }, c.ctx.GZ_CTX, () => true);
  c.tick(100);
  assert.equal(c.clicks.length, 0);
  assert.equal(c.ports[0].sent.filter((m) => m.type === 'submit:open').length, 1);
});

test('compact: removal, navigation and a missing footer end their held poll without a native press', async () => {
  for (const why of ['removed', 'navigated', 'footer gone']) {
    const { c, press } = await attempt(false), button = c.doc.querySelector(SAVE);
    // Delay readiness, so this tests the hold rather than the flush deadline.
    press(SAVE);
    if (why === 'removed') c.native().editor.remove();
    if (why === 'navigated') c.location.pathname = '/ultra/courses/_101_1/outline';
    if (why === 'footer gone') {
      button.remove();
      c.ctx.__now = () => 1e15;
      vm.runInContext('Date.now = () => globalThis.__now()', c.ctx);
    }
    c.tick(100);
    assert.equal(button.hasAttribute('aria-busy'), false, why);
    assert.equal(c.clicks.length, 0, why);
    assert.equal([...c.timers.values()].filter((t) => t.ms === 100).length, 0, why);
  }
});

test('compact: a disabled Ultra Submit pressed before readiness is held until the paper enables it', async () => {
  const { c } = await attempt(false), b = c.doc.querySelector(SUBMIT);
  b.disabled = true; b.setAttribute('disabled', '');
  b.getBoundingClientRect = () => ({ left: 10, right: 90, top: 20, bottom: 50 });
  for (const type of ['pointerdown', 'pointerup']) c.doc.dispatchEvent({ type, target: b, button: 0, clientX: 40, clientY: 30, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(b.getAttribute('aria-busy'), 'true');
  c.emit({ type: 'view', full: false });
  c.tick(100);
  const request = flushes(c.ports[0])[0]?.request;
  assert.ok(request, 'a disabled button emits no click: the pointer press must still ask for the paper');
  b.disabled = false; b.removeAttribute('disabled');
  c.emit({ type: 'compact:flushed', request, ...ok });
  c.tick(100);
  assert.equal(c.clicks.length, 1);
  assert.equal(c.clicks[0], b);
});

test('compact: a footer returning just after a flush times out can retry before the next poll', async () => {
  const { c, press } = await attempt(false);
  c.emit({ type: 'view', full: false });
  const old = c.doc.querySelector(SUBMIT), parent = old.parentElement;
  press(SUBMIT);
  old.remove(); c.tick(100);
  c.tick(60000);
  const fresh = c.doc.createElement('button');
  fresh.setAttribute('data-analytics-id', old.getAttribute('data-analytics-id')); parent.append(fresh);
  assert.doesNotThrow(() => press(SUBMIT));
  assert.equal(flushes(c.ports[0]).length, 2);
  c.emit({ type: 'compact:flushed', request: flushes(c.ports[0])[1].request, ...ok });
  c.tick(100);
  assert.equal(c.clicks.length, 1);
  assert.equal(c.clicks[0], fresh);
  assert.equal(fresh.hasAttribute('aria-busy'), false);
});

for (const first of ['reply', 'retry']) test(`compact: an expired flush ${first} cannot beat its throttled deadline timer`, async () => {
  const { c, press } = await attempt(false);
  let now = 1e6; c.ctx.__now = () => now;
  vm.runInContext('Date.now = () => globalThis.__now()', c.ctx);
  c.emit({ type: 'view', full: false }); press(SUBMIT);
  const request = flushes(c.ports[0])[0].request;
  now += 61000; // neither the 60 s timer nor the 100 ms poll has run
  if (first === 'reply') {
    c.emit({ type: 'compact:flushed', request, ...ok });
    assert.equal(c.clicks.length, 0, 'an expired save never presses Ultra');
    assert.equal(c.ports[0].sent.at(-1).reason, 'save');
  }
  press(SUBMIT);
  assert.equal(flushes(c.ports[0]).length, 2, 'the first explicit retry starts a new save');
  const retry = flushes(c.ports[0])[1].request;
  c.emit({ type: 'compact:flushed', request, ...ok });
  assert.equal(c.clicks.length, 0);
  c.emit({ type: 'compact:flushed', request: retry, ...ok });
  c.tick(100);
  assert.equal(c.clicks.length, 1);
  assert.equal(c.doc.querySelector(SUBMIT).hasAttribute('aria-busy'), false);
});

test('full: the first explicit retry expires an old save even when its poll was throttled', () => {
  const p = page(), save = L.footer(p.box.editor).save;
  p.fire(save, 'click');
  const request = asks(p.sent)[0].request;
  p.ctx.Date.now = () => p.now() + 51000;
  p.fire(save, 'click');
  assert.equal(asks(p.sent).length, 2);
  p.hear({ type: 'submit:saved', request, ok: true });
  assert.equal(p.clicks.length, 0);
  p.hear({ type: 'submit:saved', request: asks(p.sent)[1].request, ok: true });
  assert.equal(p.clicks.length, 1);
});

test('full: the arm deadline belongs to the current port even if a reopen finishes between polls', async () => {
  const { c, press } = await attempt(true);
  let now = 1e6, box;
  c.ctx.__now = () => now; vm.runInContext('Date.now = () => globalThis.__now()', c.ctx);
  c.ctx.GZ_WRITER_SUBMIT = { armed: (b) => { box = b; return false; } };
  press(SUBMIT);
  now += 4900; c.tick(100);
  const sent = []; box.port = { postMessage: (m) => sent.push(m) }; // already ready again at the next poll
  c.tick(100);
  now += 200; c.tick(100);
  assert.equal(c.doc.querySelector(SUBMIT).getAttribute('aria-busy'), 'true', 'the new frame gets its own arm window');
  assert.equal(sent.length, 0);
  now += 5000; c.tick(100);
  assert.equal(c.doc.querySelector(SUBMIT).hasAttribute('aria-busy'), false);
  assert.equal(sent.filter((m) => m.type === 'submit:unavailable').length, 1);
  assert.equal(c.clicks.length, 0);
});
