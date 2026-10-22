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
const setup = async () => {
  const p = page(), local = { [L.storeKey(origin, '_9_1')]: { tabs: [{ cid: '_1_1', at: 1 }, { cid: A, at: 2 }, { cid: B, at: 3 }] } };
  const g = glaze(p, local);
  g.api.sync(true);
  await settle();
  return { p, g };
};
const rest = (p) => { for (let i = 0; i < 5; i++) { p.clock.tick(20000); p.clock.paint(); } };

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
  moved(a);
  assert.deepEqual(wa.map(([x]) => x), ['translateZ(0)']);
  p.clock.paint(); p.clock.paint();
  p.clock.tick(1000); p.clock.paint(); p.clock.paint();
  assert.deepEqual(wa.map(([x]) => x), ['translateZ(0)', '', 'translateZ(0)', '']);
  rest(p);
  assert.equal(wa.length, 4, 'nothing at rest');
  // Back to this page: the frame is hidden, so the second nudge of a move just before is not made.
  moved(a);
  g.api.bar.leave();
  await settle();
  p.clock.paint(); p.clock.paint();
  rest(p);
  assert.deepEqual(wa.slice(4).map(([x]) => x), ['translateZ(0)', '']);
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

test('with no animation frames (a background tab), no second nudge over a held one, and the frame is still put back', async () => {
  const { p, g } = await setup();
  g.api.bar.visit(A);
  await settle();
  const el = frameOf(p, A);
  const writes = watchTransform(p, el);
  el.contentDocument = drawn(A);
  p.clock.tick(400);
  p.clock.tick(5000);
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)'], 'not nudged again while the first is held');
  p.clock.paint(); p.clock.paint();
  rest(p);
  assert.deepEqual(writes.map(([x]) => x), ['translateZ(0)', '']);
  assert.equal(el.style.transform, '');
});
