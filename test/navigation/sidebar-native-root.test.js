const test = require('node:test');
const assert = require('node:assert/strict');
const { page, record, natives, unmoved } = require('../sidebar-ultra-page.js');

test('native discussion scrolling is observed only while that document owns the sidebar', async () => {
  const p = page({ at: 'discussion', stored: record() });
  const root = p.$('#full-discussions'), scroller = root.parentElement;
  root.setAttribute('bb-intersection-observer-root', '');
  const style = p.c.getComputedStyle;
  p.c.getComputedStyle = (e) => ({ ...style(e), overflowY: e === scroller ? 'auto' : 'visible' });
  const before = natives(p);
  await p.pass();
  const host = p.host();
  assert.equal(scroller.listeners.filter((l) => l.type === 'scroll').length, 1);
  await p.pass();
  assert.equal(scroller.listeners.filter((l) => l.type === 'scroll').length, 1, 'passes do not accumulate listeners');
  p.doc.visibilityState = 'hidden';
  p.side.cover();
  assert.equal(scroller.listeners.filter((l) => l.type === 'scroll').length, 0, 'covered course frames stop watching the page');
  p.doc.visibilityState = 'visible';
  p.side.cover();
  await p.pass();
  assert.equal(p.host(), host, 'resuming keeps the native column');
  assert.equal(scroller.listeners.filter((l) => l.type === 'scroll').length, 1);
  unmoved(p, before, 'native observer root');
  p.side.sync(false);
  assert.equal(scroller.listeners.filter((l) => l.type === 'scroll').length, 0, 'disabling removes the scroll listener');
  assert.equal(p.doc.root.hasAttribute('data-gz-sb-native-root'), false);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-top'), '');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-offset'), '');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-end'), '');
  unmoved(p, before, 'disabled');
});

test('a discussion without an explicit native observer root keeps the ordinary sidebar behavior', async () => {
  const p = page({ at: 'discussion', stored: record() });
  await p.pass();
  assert.equal(p.doc.root.hasAttribute('data-gz-sb-native-root'), false);
  assert.equal(p.docListeners.some((l) => l.type === 'scroll'), false);
  assert.equal(p.doc.body.all().some((e) => e.listeners.some((l) => l.type === 'scroll')), false);
});

test('a shrinking discussion header measures the native top after updating its sticky offset', async () => {
  const p = page({ at: 'discussion', stored: record() });
  const root = p.$('#full-discussions'), scroller = root.parentElement, header = p.$('content-page-header');
  root.setAttribute('bb-intersection-observer-root', '');
  scroller.box = { left: 200, top: 0, width: 1400, height: 900 };
  header.box = { left: 200, top: 0, width: 1400, height: 100 };
  const style = p.c.getComputedStyle, boxOf = p.doc.boxOf;
  p.c.getComputedStyle = (e) => ({ ...style(e), overflowY: e === scroller ? 'auto' : 'visible' });
  p.doc.boxOf = (e) => e.dataset?.gzSidebarHost
    ? { left: 1248, top: parseFloat(p.doc.root.style.getPropertyValue('--gz-sb-native-offset')) || 0, width: 352, height: 800 }
    : boxOf(e);
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-top'), '100px');
  header.box.height = 47;
  await p.resize(1600);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-offset'), '47px');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-top'), '47px', 'the old sticky top cannot shorten the column after the header shrinks');
});

test('a native column updates Jump to widgets after its re-measured sticky top changes', async () => {
  const p = page({ at: 'discussion', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const root = p.$('#full-discussions'), scroller = root.parentElement, header = p.$('content-page-header');
  root.setAttribute('bb-intersection-observer-root', '');
  scroller.box = { left: 200, top: 0, width: 1400, height: 600 };
  header.box = { left: 200, top: 0, width: 1400, height: 100 };
  const style = p.c.getComputedStyle, boxOf = p.doc.boxOf;
  p.c.getComputedStyle = (e) => ({ ...style(e), overflowY: e === scroller ? 'auto' : 'visible' });
  p.doc.boxOf = (e) => e.dataset?.gzSidebarHost ? {
    left: 1248, top: parseFloat(p.doc.root.style.getPropertyValue('--gz-sb-native-offset')) || 0, width: 352,
    height: 600 - (parseFloat(p.doc.root.style.getPropertyValue('--gz-sb-native-top')) || 0),
  } : boxOf(e);
  await p.pass();
  assert.equal(p.$('.gz-sb-jump').hidden, true, '500px is below the shortcut threshold');
  header.box.height = 47;
  await p.resize(1600);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-native-top'), '47px');
  assert.equal(p.$('.gz-sb-jump').hidden, false, 'the final 553px height is above the threshold in the same layout');
});
