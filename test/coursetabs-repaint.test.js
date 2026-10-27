// Safari can leave a shown course tab's frame with its new content off screen after Ultra changes the frame's page in
// place, until something makes the page around it composite again. The page nudges the frame (a no-op translateZ(0), put
// back two animation frames later): once it shows drawn, and once its page has moved, then a second later. Nothing at rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const { page, glaze, settle, origin, L } = require('./helpers/coursetabs-page.cjs');

const A = '_53708_1', B = '_2_1';
const frameOf = (p, cid) => p.doc.querySelectorAll('iframe').find((e) => e.name === `gz-ctab:${cid}`);
// Every write of the frame's transform, as [value, time].
const watchTransform = (p, el) => {
  const writes = [];
  let v = el.style.transform ?? '';
  Object.defineProperty(el.style, 'transform', { get: () => v, set: (x) => { v = x; writes.push([x, p.clock.now()]); }, configurable: true });
  return writes;
};
// A drawn Ultra course page in the frame.
const drawn = (cid) => ({ body: { querySelectorAll: () => [] }, documentElement: { matches: () => false }, addEventListener() {}, querySelectorAll: () => [],
  location: { origin, href: `${origin}/ultra/courses/${cid}/outline`, pathname: `/ultra/courses/${cid}/outline` },
  querySelector: (s) => (s === '.bb-course-navigation' ? { getClientRects: () => [{}] } : null) });
const setup = async (configure) => {
  const p = page(), local = { [L.storeKey(origin, '_9_1')]: { tabs: [{ cid: '_1_1', at: 1 }, { cid: A, at: 2 }, { cid: B, at: 3 }] } };
  const g = glaze(p, local, configure);
  g.api.sync(true);
  await settle();
  return { p, g };
};
const rest = (p) => { for (let i = 0; i < 5; i++) { p.clock.tick(20000); p.clock.paint(); } };

const ready = async (configure) => {
  const x = await setup(configure);
  x.g.api.bar.visit(A);
  await settle();
  const el = frameOf(x.p, A);
  el.contentDocument = drawn(A);
  x.p.clock.tick(400);
  rest(x.p);
  return { ...x, el, writes: watchTransform(x.p, el) };
};
const move = (p, el) => {
  const d = el.contentDocument;
  d.location.pathname = `/ultra/courses/${A}/announcements`;
  d.location.href = origin + d.location.pathname;
  p.fire({ type: 'message', origin, source: el.contentWindow, data: { gzCtab: 'moved' } });
};

test('a route repaint waits for late DOM changes to settle and stops observing after its bounded follow-up', async () => {
  const { p, el, writes } = await ready();
  move(p, el);
  for (let i = 0; i < 12; i++) { p.clock.tick(200); p.mutate(el.contentDocument.body); }
  p.clock.tick(299);
  assert.equal(writes.length, 0, 'no repaint while the new page is still being built');
  p.clock.tick(1);
  assert.equal(el.style.transform, 'translateZ(0)', 'repaint after the last content change');
  p.clock.paint(); p.clock.paint();
  p.clock.tick(1000); p.clock.paint(); p.clock.paint();
  const count = writes.length;
  assert.equal(count, 4);
  assert.equal(p.observers.size, 0, 'no document observer at rest');
  p.mutate(el.contentDocument.body);
  rest(p);
  assert.equal(writes.length, count);
});

test('scroll reports at the same route cause no layer writes', async () => {
  const { p, el, writes } = await ready();
  for (let i = 0; i < 4; i++) p.fire({ type: 'message', origin, source: el.contentWindow, data: { gzCtab: 'moved' } });
  rest(p);
  assert.equal(writes.length, 0);
});

test('a continuously changing page cannot keep the repaint observer alive past eight seconds', async () => {
  const { p, el } = await ready();
  move(p, el);
  for (let i = 0; i < 40; i++) { p.clock.tick(200); p.mutate(el.contentDocument.body); }
  assert.equal(p.observers.size, 0);
  assert.equal(el.style.transform, 'translateZ(0)');
  rest(p);
  assert.equal(el.style.transform, '');
});

test('Chrome and Firefox do not pay for the Safari repaint workaround', async () => {
  for (const protocol of ['chrome-extension:', 'moz-extension:']) {
    const { p, el, writes, g } = await ready((c) => { c.chrome.runtime.getURL = (f) => `${protocol}//glaze/${f}`; });
    move(p, el);
    g.api.bar.leave();
    await settle();
    g.api.bar.visit(A);
    await settle();
    rest(p);
    assert.equal(writes.length, 0, protocol);
  }
});

test('frame messages and visibility changes survive an extension reload', async () => {
  for (const protocol of ['chrome-extension:', 'moz-extension:', 'safari-web-extension:']) {
    const { p, g, el, writes } = await ready((c) => { c.chrome.runtime.getURL = (f) => `${protocol}//glaze/${f}`; });
    delete g.chrome.runtime.id;
    let calls = 0;
    g.chrome.runtime.getURL = () => { calls++; throw new Error('Extension context invalidated.'); };
    assert.doesNotThrow(() => move(p, el), `${protocol}: a live frame can still report a route change`);
    p.doc.visibilityState = 'hidden';
    assert.doesNotThrow(() => p.fire({ type: 'visibilitychange' }));
    p.doc.visibilityState = 'visible';
    assert.doesNotThrow(() => p.fire({ type: 'visibilitychange' }));
    rest(p);
    assert.equal(calls, 0, `${protocol}: repaint callbacks no longer consult the extension runtime`);
    assert.equal(g.api.showing(), A, 'the existing frame stays open');
    assert.equal(frameOf(p, A), el, 'the frame and its native work are preserved');
    if (protocol !== 'safari-web-extension:') assert.equal(writes.length, 0, protocol);
    assert.equal(el.style.transform || '', '', 'a pending Safari transform is restored');
    assert.equal(p.observers.size, 0, 'no repaint observer is left running');
  }
});

test('a background tab never starts a layer change and hiding or disabling restores a held transform', async () => {
  for (const action of ['hidden', 'off']) {
    const { p, g, el } = await ready();
    g.api.bar.leave();
    await settle();
    g.api.bar.visit(A);
    await settle();
    assert.equal(el.style.transform, 'translateZ(0)');
    if (action === 'hidden') { p.doc.visibilityState = 'hidden'; p.fire({ type: 'visibilitychange' }); }
    else g.api.sync(false);
    assert.equal(el.style.transform, '', action);
  }
  const { p, el, writes } = await ready();
  p.doc.visibilityState = 'hidden';
  move(p, el);
  rest(p);
  assert.equal(writes.length, 0, 'no compositing while hidden');
});

test('a repaint preserves an existing frame transform', async () => {
  const { p, g, el } = await ready();
  g.api.bar.leave();
  await settle();
  el.style.transform = 'scale(0.9)';
  g.api.bar.visit(A);
  await settle();
  assert.equal(el.style.transform, 'scale(0.9) translateZ(0)', 'the nudge does not change frame geometry');
  p.clock.paint(); p.clock.paint();
  assert.equal(el.style.transform, 'scale(0.9)');
});

test('a browser-normalized transform is still restored after the repaint', async () => {
  const { p, g, el } = await ready();
  g.api.bar.leave();
  await settle();
  let value = '';
  Object.defineProperty(el.style, 'transform', { get: () => value, set: (x) => { value = x.replace(/translateZ\(0\)/g, 'translateZ(0px)'); }, configurable: true });
  g.api.bar.visit(A);
  await settle();
  assert.equal(el.style.transform, 'translateZ(0px)', 'CSSOM serializes zero lengths with px');
  p.clock.paint(); p.clock.paint();
  assert.equal(el.style.transform, '', 'restore the canonicalized value too');
});

test('a frame shown once its page is drawn is nudged, put back two frames later, again a second later, then left alone', async () => {
  const { p, g } = await setup();
  g.api.bar.visit(A);
  await settle();
  const el = frameOf(p, A);
  const writes = watchTransform(p, el);
  el.contentDocument = drawn(A);
  p.clock.tick(400);
  assert.equal(g.api.showing(), A);
  assert.equal(el.style.visibility, '');
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)'], 'nudged as it becomes ready on screen');
  p.clock.paint();
  assert.equal(el.style.transform, 'translateZ(0)', 'held through the next frame');
  p.clock.paint();
  assert.equal(el.style.transform, '', 'then put back');
  p.clock.tick(1000);
  assert.equal(el.style.transform, 'translateZ(0)', 'again a second later');
  p.clock.paint(); p.clock.paint();
  assert.equal(writes.length, 4);
  rest(p);
  assert.equal(writes.length, 4, 'nothing at rest');
  assert.equal(el.style.transform, '');
});

test('a shown frame whose page moved in place is nudged; a hidden one, or the page itself, is not', async () => {
  const { p, g } = await setup();
  g.api.bar.visit(B);
  await settle();
  frameOf(p, B).contentDocument = drawn(B);
  g.api.bar.visit(A);
  await settle();
  const a = frameOf(p, A), b = frameOf(p, B);
  a.contentDocument = drawn(A);
  rest(p);
  const wa = watchTransform(p, a), wb = watchTransform(p, b);
  const moved = (el) => p.fire({ type: 'message', origin, source: el.contentWindow, data: { gzCtab: 'moved' } });
  moved(b);
  rest(p);
  assert.deepEqual([wa.length, wb.length], [0, 0], 'a hidden frame moving is not on screen');
  move(p, a);
  p.clock.tick(300);
  assert.deepEqual(wa.map(([x]) => x), ['translateZ(0)']);
  p.clock.paint(); p.clock.paint();
  p.clock.tick(1000); p.clock.paint(); p.clock.paint();
  assert.deepEqual(wa.map(([x]) => x), ['translateZ(0)', '', 'translateZ(0)', '']);
  rest(p);
  assert.equal(wa.length, 4, 'nothing at rest');
  // Back to this page: the frame is hidden, so the second nudge of a move just before is not made.
  a.contentDocument.location.pathname = `/ultra/courses/${A}/grades`;
  moved(a);
  g.api.bar.leave();
  await settle();
  p.clock.paint(); p.clock.paint();
  rest(p);
  assert.deepEqual(wa.slice(4).map(([x]) => x), [], 'leaving cancels the pending repaint');
  assert.equal(wb.length, 0);
});

test('picking a ready frame again nudges it as it shows', async () => {
  const { p, g } = await setup();
  g.api.bar.visit(A);
  await settle();
  const el = frameOf(p, A);
  el.contentDocument = drawn(A);
  p.clock.tick(400);
  rest(p);
  g.api.bar.leave();
  await settle();
  const writes = watchTransform(p, el);
  rest(p);
  assert.equal(writes.length, 0);
  g.api.bar.visit(A);
  await settle();
  assert.equal(g.api.showing(), A);
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)']);
  p.clock.paint(); p.clock.paint();
  rest(p);
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)', '', 'translateZ(0)', '']);
});

test('without animation frames each transform is restored within a bounded timeout', async () => {
  const { p, g } = await setup();
  g.api.bar.visit(A);
  await settle();
  const el = frameOf(p, A);
  const writes = watchTransform(p, el);
  el.contentDocument = drawn(A);
  p.clock.tick(400);
  p.clock.tick(5000);
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)', '', 'translateZ(0)', ''], 'a stopped animation clock cannot leave a layer behind');
  p.clock.paint(); p.clock.paint();
  rest(p);
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)', '', 'translateZ(0)', '']);
  assert.equal(el.style.transform, '');
});
