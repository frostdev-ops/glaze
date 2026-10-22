// Glaze restarted under an open page (an update, Safari re-registering it): the browser runs Glaze's content scripts again
// in that page, in a world of their own, beside the old copy's. The whole of features/coursetabs.js twice over one stand-in
// page: the fresh copy takes the page over, as after a reload, and the old one lets go.
const test = require('node:test');
const assert = require('node:assert/strict');
const { page, glaze, settle, origin, L } = require('./helpers/coursetabs-page.cjs');

const course = '_53708_1';
const frames = (p) => p.doc.querySelectorAll('iframe').filter((e) => e.name === `gz-ctab:${course}`);

test('a page event cannot retire a working copy or discard its edited frame', async () => {
  const p = page(), local = { [L.storeKey(origin, '_9_1')]: { tabs: [{ cid: course, at: 1 }] } };
  const g = glaze(p, local);
  g.api.sync(true);
  await settle();
  g.api.bar.visit(course);
  await settle();
  const el = frames(p)[0];
  p.fire({ type: 'message', origin, source: el.contentWindow, data: { gzCtab: 'edited' } });
  p.fire(new g.c.Event('gz-ctabs-take', { cancelable: true }));
  assert.ok(el.isConnected, 'native work stays in its original frame');
  assert.equal(g.api.showing(), course);
  g.api.sync(true);
  assert.equal(frames(p)[0], el, 'the working copy still owns the page');
});

test('another live copy yields to the working copy and its edited frame', async () => {
  const p = page(), local = { [L.storeKey(origin, '_9_1')]: { tabs: [{ cid: course, at: 1 }] } };
  const old = glaze(p, local);
  old.api.sync(true);
  await settle();
  old.api.bar.visit(course);
  await settle();
  const el = frames(p)[0], strip = p.doc.getElementById('gz-ctabs');
  p.fire({ type: 'message', origin, source: el.contentWindow, data: { gzCtab: 'edited' } });
  const fresh = glaze(p, local);
  fresh.api.sync(true);
  await settle();
  assert.ok(el.isConnected, 'a second injection preserves the working frame');
  assert.equal(frames(p).length, 1);
  assert.equal(p.doc.getElementById('gz-ctabs'), strip);
  assert.equal(old.api.showing(), course);
});

test('a fresh copy of Glaze takes over the frames, strip and marks the old copy left on the page', async () => {
  const p = page(), local = {};
  local[L.storeKey(origin, '_9_1')] = { tabs: [{ cid: '_1_1', at: 1 }, { cid: course, at: 2 }] };
  const old = glaze(p, local);
  old.api.sync(true);
  await settle();
  old.api.bar.visit(course);
  await settle();
  assert.equal(old.api.showing(), course);
  assert.equal(frames(p).length, 1);
  assert.equal(p.session.getItem('gz-ctabs-shown'), course);
  p.html.setAttribute('data-gz-placing', '');

  // Glaze restarts: the old copy is cut off from the extension, and a new one runs in the same page.
  old.chrome.runtime.id = undefined;
  const fresh = glaze(p, local);
  fresh.api.sync(true);
  await settle();

  assert.equal(p.doc.querySelectorAll('#gz-ctabs-frames').length, 1, 'one place for the frames');
  assert.equal(frames(p).length, 1, 'one frame for the course');
  assert.equal(fresh.api.showing(), course, 'the course on screen before is on screen again');
  assert.equal(p.doc.querySelectorAll('#gz-ctabs').length, 1, 'one strip');
  assert.equal(p.doc.querySelectorAll('#gz-ctabs-say').length, 1, 'one word over the page');
  assert.ok(p.html.hasAttribute('data-gz-ctab-framed'));
  assert.equal(p.html.hasAttribute('data-gz-placing'), false);

  // The old copy keeps its own references, but no longer puts anything back.
  p.bar.replaceChildren();
  old.api.held();
  assert.equal(p.doc.querySelectorAll('#gz-ctabs').length, 0, 'the old copy\'s strip stays gone');
});

test('a fresh copy that opens no frame leaves the page uncovered, as after a reload', async () => {
  for (const was of ['hidden', 'closed']) {
    const p = page(), local = {};
    const k = L.storeKey(origin, '_9_1');
    local[k] = { tabs: [{ cid: '_1_1', at: 1 }, { cid: course, at: 2 }] };
    const old = glaze(p, local);
    old.api.sync(true);
    await settle();
    old.api.bar.visit(course);
    await settle();
    // Back on this page, the frame kept hidden; or its tab closed in another browser tab as Glaze restarted.
    if (was === 'hidden') old.api.bar.leave();
    else local[k] = { tabs: [{ cid: '_1_1', at: 1 }] };
    await settle();
    old.chrome.runtime.id = undefined;
    const fresh = glaze(p, local);
    fresh.api.sync(true);
    await settle();
    assert.equal(p.doc.querySelectorAll('#gz-ctabs-frames').length, 0, `${was}: no frames until a tab is picked`);
    assert.equal(frames(p).length, 0, was);
    assert.equal(fresh.api.showing(), '', was);
    assert.equal(p.html.hasAttribute('data-gz-ctab-framed'), false, `${was}: the page is not covered`);
    assert.equal(p.doc.querySelectorAll('#gz-ctabs').length, 1, was);
  }
});

test('a single copy keeps its own strip and frames across passes and toggles', async () => {
  const p = page(), local = {};
  local[L.storeKey(origin, '_9_1')] = { tabs: [{ cid: '_1_1', at: 1 }, { cid: course, at: 2 }] };
  const one = glaze(p, local);
  one.api.sync(true);
  await settle();
  const strip = p.doc.getElementById('gz-ctabs');
  assert.ok(strip?.isConnected);
  one.api.bar.visit(course);
  await settle();
  one.api.sync(true); one.api.held();
  await settle();
  assert.equal(p.doc.getElementById('gz-ctabs'), strip);
  assert.equal(frames(p).length, 1);
  assert.equal(one.api.showing(), course);
  one.api.sync(false);
  assert.equal(p.doc.querySelectorAll('#gz-ctabs-frames').length, 0);
  one.api.sync(true);
  await settle();
  assert.equal(p.doc.getElementById('gz-ctabs'), strip, 'switched back on, the same copy draws the same strip');
});
