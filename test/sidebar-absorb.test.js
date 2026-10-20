// Absorbing an assignment's side panels into the sidebar's This page (features/sidebar.js absorbable / absorb /
// syncAbsorbed / restoreAbsorbed), on stand-in Ultra pages built as Ultra builds them live: an assignment's overview with
// Grades / Attempts as its grid's side column, an attempt with its Details & Information panel and its footer, and pages
// that don't match. Ultra's nodes are never moved, copied or listened to; what is put on them comes off exactly; nothing
// is ever started, answered, saved or submitted (the attempt's buttons here are stubs whose clicks are only counted).
const test = require('node:test');
const assert = require('node:assert/strict');
const { page, record, natives, unmoved } = require('./sidebar-ultra-page.js');

const docked = () => record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
const PROPS = ['--gz-sb-px-y', '--gz-sb-px-x', '--gz-sb-px-w', '--gz-sb-px-clip'];
const marks = (e) => ({ absorbed: e.dataset.gzSbAbsorbed, props: PROPS.map((k) => e.style.getPropertyValue(k)) });
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
  assert.equal(sec.dataset.gzSbAbsorbed, '', 'absorbed');
  assert.equal(p.$('div.assessment-overview-grid').dataset.gzSbGrid, '');
  assert.ok(marks(sec).props.every(Boolean), 'placed by its custom properties only');
  assert.equal(sec.style.getPropertyValue('color'), 'red', 'the page\'s own inline style kept');
  assert.equal(p.host().querySelector('.gz-sb-pagehead').hidden, false, 'This page shows');
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

test('an Angular re-render (the node replaced, or its mark reset) is restored cleanly and dressed again; nothing is orphaned', async () => {
  const p = page({ at: 'assessment', width: 1800, stored: docked() });
  await p.pass();
  const old = p.$('div.overview-attempts-section');
  assert.equal(old.dataset.gzSbAbsorbed, '');
  // Ultra resets its attributes.
  delete old.dataset.gzSbAbsorbed;
  await p.pass();
  assert.equal(old.dataset.gzSbAbsorbed, '', 'dressed again');
  // Ultra replaces the section with a new one.
  const fresh = p.el('div', 'overview-section overview-attempts-section overview-attempts-section-container', Object.assign(p.el('h2', 'section-label', 'Grades / Attempts'), { id: 'grades-attempts-header' }));
  old.replaceWith(fresh);
  await p.pass();
  clean(old);
  assert.equal(fresh.dataset.gzSbAbsorbed, '', 'the new one takes its place');
  // The new one stops matching (its title gone): nothing absorbed, the grid as Ultra had it.
  fresh.children.splice(0, fresh.children.length);
  await p.pass();
  clean(fresh);
  assert.equal(p.$('div.assessment-overview-grid').dataset.gzSbGrid, undefined);
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
    assert.equal(sec.dataset.gzSbAbsorbed, '', how);
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

test("an attempt's Details & Information shows in This page; its footer (Save and Close, Submit) is never touched and still clicks", async () => {
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
  assert.equal(details.dataset.gzSbAbsorbed, '', 'the details panel, description with it');
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
