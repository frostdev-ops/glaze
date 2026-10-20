// Absorbing an assignment's side panels into the sidebar's This page (features/sidebar.js absorbable / absorb /
// syncAbsorbed / restoreAbsorbed), on stand-in Ultra structures: an assignment's overview with
// Grades / Attempts as its grid's side column, an unverified attempt with details and its footer, and pages
// that don't match. Ultra's nodes are never moved, copied or listened to; what is put on them comes off exactly; nothing
// is ever started, answered, saved or submitted (the attempt's buttons here are stubs whose clicks are only counted).
const test = require('node:test');
const assert = require('node:assert/strict');
const { page, record, natives, unmoved } = require('./sidebar-ultra-page.js');

const docked = () => record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
const PROPS = ['--gz-sb-px-y', '--gz-sb-px-x', '--gz-sb-px-w', '--gz-sb-px-clip'];
const clean = (e) => { assert.equal(e.dataset.gzSbAbsorbed, undefined, 'mark gone'); for (const k of PROPS) assert.equal(e.style.getPropertyValue(k), '', `${k} gone`); };
// Everything a keyboard reaches, in document order.
const focusOrder = (p) => p.doc.body.all().filter((x) => ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(x.tagName) && !p.ours(x));
const snapshot = (e) => ({ className: e.className, attrs: { ...e.attrs }, dataset: { ...e.dataset }, style: Object.fromEntries(Object.entries(e.style).filter(([, v]) => typeof v === 'string')) });

test("an overview's Grades / Attempts shows in This page: never moved, its grid one column, its own listeners still answer", async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  const sec = p.$('div.overview-attempts-section');
  sec.style.setProperty('color', 'red');
  const was = snapshot(sec);
  let clicks = 0, keys = 0;
  const view = sec.querySelector('a.button-attempt');
  view.addEventListener('click', () => clicks++);
  view.addEventListener('keydown', () => keys++);
  const before = natives(p), order = focusOrder(p), listeners = sec.listeners.length;
  await p.pass();
  assert.equal(p.mode(), 'expanded');
  assert.ok(p.$('#gz-sb-absorb'), 'Glaze-owned stylesheet projects the panel');
  assert.match(p.$('#gz-sb-absorb').textContent, /grid-template-columns:minmax/);
  assert.equal(sec.dataset.gzSbAbsorbed, undefined, 'no native marker');
  assert.equal(sec.style.getPropertyValue('color'), 'red', 'the page\'s own inline style kept');
  assert.equal(p.host().querySelector('.gz-sb-pagehead').hidden, false, 'This page shows');
  assert.equal(p.$('.gz-sb-pagehead button').getAttribute('aria-describedby'), 'grades-attempts-header', 'This page names the native heading without reassigning ownership');
  assert.equal(p.$('.gz-sb-slot').getAttribute('aria-hidden'), 'true', 'the visual placeholder is not a second reading region');
  unmoved(p, before, 'absorbed');
  assert.deepEqual(focusOrder(p), order, 'focus order unchanged');
  assert.equal(sec.listeners.length, listeners, 'no listener on the panel');
  p.fire(view, 'click');
  p.fire(view, 'keydown', { key: 'Enter' });
  assert.deepEqual([clicks, keys], [1, 1], 'View instructions still answers');
  // Collapsed: back in the page.
  p.side.op([{ op: 'open', v: false }]);
  assert.equal(p.mode(), 'collapsed');
  clean(sec);
  assert.deepEqual(snapshot(sec), was, 'exactly as before');
  unmoved(p, before, 'collapsed');
});

test('an Angular re-render restores synchronously; a partial replacement never inherits projection', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  await p.pass();
  assert.ok(p.$('#gz-sb-absorb'));
  const old = p.$('div.overview-attempts-section'), grid = old.parentElement;
  const fresh = p.el('div', 'overview-section overview-attempts-section overview-attempts-section-container', Object.assign(p.el('h2', 'section-label', 'Grades / Attempts'), { id: 'grades-attempts-header' }));
  old.replaceWith(fresh);
  p.mutate(grid.parentElement, { type: 'childList', removedNodes: [old], addedNodes: [fresh] });
  assert.equal(projected(p), false, 'restore before the next site pass');
  await p.pass();
  assert.equal(projected(p), false, 'a title alone does not verify the new panel');
  clean(old); clean(fresh);
});

test('teardown, the sidebar off and the absorb setting off each put the panel back exactly', async () => {
  for (const how of ['teardown', 'sidebar', 'setting']) {
    const sw = {};
    const p = page({ at: 'assessment', width: 1800, stored: docked(), enhance: sw });
    const sec = p.$('div.overview-attempts-section');
    sec.style.setProperty('margin', '4px');
    sec.setAttribute('aria-labelledby', 'grades-attempts-header');
    const was = snapshot(sec), before = natives(p);
    await p.pass();
    assert.ok(p.$('#gz-sb-absorb'), how);
    if (how === 'teardown') p.side.sync(false);
    // enhance.sidebar off: the site's part's next pass turns the sidebar off.
    else if (how === 'sidebar') { sw.sidebar = false; await p.pass(); }
    else { p.c.sidebarSettings = { absorb: false }; await p.pass(); }
    assert.equal(sec.dataset.gzSbAbsorbed, undefined, `${how}: mark gone`);
    clean(sec);
    assert.deepEqual(snapshot(sec), was, `${how}: inline style, classes and attributes as before`);
    assert.equal(p.$('div.assessment-overview-grid').dataset.gzSbGrid, undefined, how);
    unmoved(p, before, how);
  }
});

test("an unverified attempt stays native; its footer and rubric remain untouched and still click", async () => {
  const p = page({ at: 'attempt', width: 1800, stored: docked() });
  const details = p.$('[class*="makeStylesdetails-"]'), save = p.$('button.save'), submit = p.$('button.submit');
  const footer = save.parentNode;
  let pressed = 0;
  for (const b of [save, submit]) b.addEventListener('click', () => pressed++);
  let rubricClicks = 0;
  details.querySelector('a').addEventListener('click', () => rubricClicks++);
  const before = natives(p), order = focusOrder(p);
  await p.pass();
  assert.equal(p.side.context().family, 'assessment');
  assert.equal(projected(p), false, 'attempt details are not projected');
  for (const b of [save, submit, footer]) { assert.equal(b.dataset.gzSbAbsorbed, undefined); assert.ok(!Object.keys(b.style).some((k) => k.startsWith('--gz')), 'nothing on the footer'); }
  assert.equal(save.parentNode, footer);
  assert.equal(submit.parentNode, footer);
  unmoved(p, before, 'attempt');
  assert.deepEqual(focusOrder(p), order);
  p.fire(save, 'click'); p.fire(submit, 'click'); p.fire(details.querySelector('a'), 'click');
  assert.deepEqual([pressed, rubricClicks], [2, 1], 'stubs only: their clicks still reach them');
});

test('a structure that does not match exactly absorbs nothing', async () => {
  const p = page({ at: 'mismatch', width: 1800, stored: docked() });
  const before = natives(p);
  await p.pass();
  for (const e of p.doc.body.all()) assert.equal(e.dataset.gzSbAbsorbed, undefined, `${e.tagName}.${e.className}`);
  assert.equal(p.$('div.assessment-overview-grid').dataset.gzSbGrid, undefined);
  unmoved(p, before, 'mismatch');
});

test('narrow (a drawer) or This page folded: nothing absorbed', async () => {
  const p = page({ at: 'assessment', width: 900, stored: docked() });
  await p.pass();
  assert.equal(p.mode(), 'drawer');
  clean(p.$('div.overview-attempts-section'));
  const q = page({ at: 'assessment', width: 1800, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' }, fold: { assessment: { page: true } } }) });
  await q.pass();
  clean(q.$('div.overview-attempts-section'));
});

// A serialization of the whole native subtree, including empty and pre-existing style attributes.
const bytes = (e) => JSON.stringify([e.tagName, e.id, e.className, e.attrs, e.dataset,
  Object.entries(e.style).filter(([, v]) => typeof v === 'string'), e.children.map((c) => c.tagName ? bytes(c) : c.textContent)]);
const projected = (p) => !!p.$('[data-gz-sb-absorbed]') || !!p.$('#gz-sb-absorb');

test('BUG: absorption never writes attributes or inline styles anywhere in the Blackboard subtree', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  const root = p.$('#site-wrap'), sec = p.$('.overview-attempts-section');
  sec.setAttribute('style', '');
  sec.style.setProperty('--gz-sb-px-y', '17px');
  const was = bytes(root);
  await p.pass();
  assert.ok(projected(p), 'starts absorbed');
  assert.equal(bytes(root), was, 'native bytes unchanged even while visually absorbed');
  p.side.sync(false);
  assert.equal(bytes(root), was, 'full absorb/restore cycle is byte-identical');
});

test('BUG: guessed attempt details stay entirely native even when absorption is enabled', async () => {
  const p = page({ at: 'attempt', width: 1800, stored: docked() });
  const was = bytes(p.$('#site-wrap'));
  await p.pass();
  assert.equal(projected(p), false);
  assert.equal(bytes(p.$('#site-wrap')), was);
  assert.equal(p.$('.gz-sb-pagehead').hidden, true, 'no empty This page section');
});

test('BUG: a partial overview structure or stale overview on another route never absorbs', async () => {
  for (const change of [
    (p) => { p.c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt'; },
    (p) => { p.$('.overview-attempts-section').children[0].id = 'unrelated-heading'; },
    (p) => { const sec = p.$('.overview-attempts-section'); const wrap = p.el('div', 'unknown'); sec.before(wrap); wrap.append(sec); },
    (p) => { p.$('.assessment-overview-grid').append(p.el('div', 'unexpected', 'New block')); },
  ]) {
    const p = page({ at: 'assessment', width: 1800, stored: docked() });
    change(p);
    await p.pass();
    assert.equal(projected(p), false, 'exact route, hierarchy, title and siblings required');
  }
});

test('BUG: focus-document mode restores absorption without waiting for a site pass', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  await p.pass();
  assert.ok(projected(p), 'starts absorbed');
  p.doc.root.setAttribute('data-gz-focus', '');
  p.mutate(p.doc.root, { type: 'attributes', attributeName: 'data-gz-focus' });
  assert.equal(projected(p), false);
});

test('BUG: printing restores native attributes synchronously', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  const was = bytes(p.$('#site-wrap'));
  await p.pass();
  assert.ok(projected(p), 'starts absorbed');
  p.event('beforeprint');
  assert.equal(projected(p), false);
  assert.equal(bytes(p.$('#site-wrap')), was);
});

test('BUG: scrolling restores instead of leaving clipped keyboard controls in a separate scroller', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  await p.pass();
  assert.ok(projected(p), 'starts absorbed');
  p.event('scroll', { target: p.host() });
  assert.equal(projected(p), false);
  assert.equal(p.docListeners.filter((l) => l.type === 'scroll').length, 0);
  await p.pass();
  assert.equal(projected(p), false, 'a site pass must not start a scroll/restore loop');
});


test('native grid placement, visibility, stacking and hit-testing must all match before projection', async () => {
  for (const patch of [
    { gridTemplateColumns: '900px' }, { gridTemplateColumns: '600px 200px 392px' }, { gridColumnStart: '1' }, { gridRowStart: '2' }, { transform: 'matrix(1,0,0,1,0,0)' },
    { zIndex: '50', position: 'relative' }, { contain: 'paint' }, { visibility: 'hidden' },
  ]) {
    const p = page({ at: 'assessment', width: 1800, stored: docked() });
    const css = p.c.getComputedStyle;
    p.c.getComputedStyle = (e) => ({ ...css(e), ...patch });
    await p.pass();
    assert.equal(projected(p), false, JSON.stringify(patch));
  }
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  p.doc.elementFromPoint = () => p.doc.body;
  await p.pass();
  assert.equal(projected(p), false, 'an obstruction fails closed');
  assert.equal(p.$('.gz-sb-pagehead').hidden, true);
});

test('overflowing or changed panel geometry restores without a resize-observer loop', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  await p.pass();
  assert.ok(projected(p));
  const sec = p.$('.overview-attempts-section'), observer = p.sizes.find((o) => o.targets.includes(sec));
  sec.box = { left: 1464, top: 160, width: 320, height: 950 };
  observer.f();
  assert.equal(projected(p), false);
  for (let i = 0; i < 4; i++) { observer.f(); await p.pass(); }
  assert.equal(projected(p), false);
  assert.equal(p.sizes.filter((o) => o.targets.length).length, 0);
  assert.equal(p.docListeners.length, 1, 'only the sidebar visibility listener remains');
});

test('route change, drawer resize, fold, hidden page and covered document restore all native bytes', async () => {
  for (const how of ['route', 'drawer', 'fold', 'hidden', 'covered']) {
    const p = page({ at: 'assessment', width: 1800, stored: docked() });
    const was = bytes(p.$('#site-wrap'));
    await p.pass(); assert.ok(projected(p), how);
    if (how === 'route') { p.c.location.pathname = '/ultra/courses/_101_1/assessment/_8_1/overview'; p.event('popstate'); }
    if (how === 'drawer') await p.resize(900);
    if (how === 'fold') { p.c.sidebarSettings = { page: 'folded' }; await p.pass(); }
    if (how === 'hidden') { p.c.sidebarSettings = { page: 'hidden' }; await p.pass(); }
    if (how === 'covered') { p.doc.visibilityState = 'hidden'; p.side.cover(); }
    assert.equal(projected(p), false, how);
    assert.equal(bytes(p.$('#site-wrap')), was, how);
  }
});

test('absorption off has no observers, listeners, timers or stale callbacks affecting a newer projection', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  p.c.sidebarSettings = { absorb: false };
  await p.pass();
  assert.equal(p.observers.filter((o) => o.on).length, 0);
  assert.equal(p.sizes.length, 0);
  assert.equal(p.docListeners.some((l) => l.type === 'scroll'), false);
  p.c.sidebarSettings = { absorb: true }; await p.pass();
  assert.ok(projected(p));
  const old = p.observers.find((o) => o.on);
  p.side.sync(false);
  assert.equal(p.observers.filter((o) => o.on).length, 0);
  assert.equal(p.docListeners.length, 0);
  await p.pass(); assert.ok(projected(p));
  old.f();
  assert.ok(projected(p), 'old generation cannot invalidate the new projection');
  p.side.sync(false);
});


test('BUG: This page has explicit heading and button labels independent of visual chevrons and casing', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  await p.pass();
  const h = p.$('.gz-sb-pagehead'), b = h.querySelector('button');
  assert.equal(b.getAttribute('aria-label'), 'This page');
  assert.equal(h.getAttribute('aria-labelledby'), b.id);
  assert.equal(b.getAttribute('aria-describedby'), 'grades-attempts-header');
  assert.equal(p.host().getAttribute('role'), 'complementary');
  assert.equal(p.host().getAttribute('aria-labelledby'), 'gz-sb-title');
});
