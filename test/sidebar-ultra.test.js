// The sidebar on Blackboard Ultra (features/sidebar.js's Ultra adapter, with features/widgets.js for the dock), on
// synthetic Ultra pages in the stand-in DOM: the Courses page's column with Ultra's To Do, a course outline's column
// (Faculty, Details & Actions, the schedule, and Glaze's own blocks there), a discussion's details layer, and a page
// without a column. Ultra's own nodes are never moved or copied; late blocks and a column Angular swaps are taken as
// they come; the Courses page's column board gives way to the dock while course cards stay on the board; one To Do;
// the offer when Ultra's boards disagreed about To Do. Changes go through the worker's real code (lib/sidebar.js,
// lib/widgets.js). Geometry and transport are supplied.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');
const S = require('../lib/sidebar.js');
const { page, record, natives, unmoved, settle, read, KEY, O, CARD } = require('./sidebar-ultra-page.js');

test('each kind of Ultra page: its own column dressed in place, or Glaze\'s own where there is none or only a layer', async () => {
  for (const [at, family, host, cls] of [['courses', 'courses', 'native', 'todo-panel'], ['outline', 'outline', 'native', 'outline-actions'], ['detail', 'detail', 'native', 'outline-actions'], ['stream', 'other', 'glaze', null]]) {
    const p = page({ at, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    const before = natives(p);
    await p.pass();
    assert.equal(p.side.context().family, family, at);
    const h = p.host();
    assert.equal(h.dataset.gzSidebarHost, host, at);
    if (cls) {
      assert.ok(String(h.className).includes(cls), `${at}: ${h.className}`);
      assert.equal(h.children[0].className, 'gz-sb-resize', `${at}: Glaze's header first`);
      assert.equal(h.children[1].className, 'gz-sb-head');
      assert.equal(h.children[2].className, 'gz-sb-sec gz-sb-pagehead', `${at}: This page right after it`);
      assert.equal(h.lastElementChild.id, 'gz-sb-widgets', `${at}: the widgets last`);
      assert.equal(h.dataset.gzSbSelf, '', `${at}: the column is its own content`);
      assert.equal(h.getAttribute('role'), at === 'detail' ? null : 'complementary');
      assert.equal(p.doc.root.dataset.gzSbFixed, undefined, `${at}: in the page's own flow`);
    } else {
      assert.equal(h.id, 'gz-sidebar', at);
      assert.ok(String(h.className).includes('gz-sb-fixed'), `${at}: fixed at the window's edge`);
      assert.equal(h.parentNode, p.doc.body);
      assert.equal(p.doc.root.dataset.gzSbFixed, '', `${at}: the page keeps clear of it`);
    }
    unmoved(p, before, at);
  }
});

test('a discussion\'s details layer stays as Ultra has it: the existing column presents only the dock as a drawer over it', async () => {
  const p = page({ at: 'detail', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  assert.equal(p.mode(), 'drawer', 'wide, but a layer: a drawer');
  assert.equal(p.$('#gz-sb-launch').hidden, false);
  const details = p.$('.layer-details');
  assert.ok(!details.all().some(p.ours) && details.dataset.gzSidebarHost === undefined, 'nothing of Glaze\'s in the layer');
  assert.equal(p.$('aside.outline-actions').dataset.gzSbOverlay, '', 'outline blocks stay below the layer');
  // The layer closes: the outline's own column is the sidebar again, with the same dock.
  const dock = p.$('#gz-sb-widgets'), parent = dock.parentNode;
  p.$('.layer-details').remove();
  await p.pass();
  assert.equal(p.side.context().family, 'outline');
  assert.equal(p.$('aside.outline-actions').dataset.gzSidebarHost, 'native');
  assert.equal(p.$('#gz-sb-widgets'), dock, 'not rebuilt');
  assert.equal(p.mode(), 'expanded');
  assert.ok(dock.parentNode === parent, 'the same live mounting hierarchy');
  assert.equal(parent.dataset.gzSbOverlay, undefined);
});

test('offsets: Ultra\'s nav and Glaze\'s bar from the page\'s start, a course\'s top bar for the fixed column', async () => {
  const p = page({ at: 'stream', width: 1300, stored: record() });
  p.c.getComputedStyle = () => ({ paddingInlineStart: '0px', getPropertyValue: () => '' });
  await p.pass();
  // 1300 - 200 (nav) = 1100 >= 352 + 16 + 720: expanded
  assert.equal(p.mode(), 'none', 'nothing to show: no room kept');
  const q = page({ at: 'stream', width: 1300, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  q.c.getComputedStyle = () => ({ paddingInlineStart: '0px', getPropertyValue: () => '' });
  await q.pass();
  assert.equal(q.mode(), 'expanded');
  // Glaze's bar adds its room as #main-content-inner's start padding: 1300 - 200 - 96 = 1004 < 1088.
  q.c.getComputedStyle = () => ({ paddingInlineStart: '96px', getPropertyValue: () => '' });
  await q.resize(1300);
  assert.equal(q.mode(), 'drawer');
  // A course's top bar: the fixed column starts under it.
  const r = page({ at: 'outline', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await r.pass();
  assert.equal(r.doc.root.style.getPropertyValue('--gz-sb-top'), '60px');
});

test('routed Ultra pages keep the sidebar below their breadcrumb header, including inside course tabs', async () => {
  for (const at of ['discussion', 'assessment', 'attempt', 'gradebook']) for (const nav of [0, 80]) {
    const p = page({ at, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    const route = p.$('.routed-page') || p.$('.route-view-container');
    const header = p.$('content-page-header') || p.el('content-page-header', '', 'Course / Tool');
    if (!header.parentNode) route.prepend(header);
    header.box = { left: 0, top: nav, width: 1800, height: 47 };
    const style = p.c.getComputedStyle;
    p.c.getComputedStyle = (e) => ({ ...style(e), getPropertyValue: (k) => k === '--gz-navbar-top' ? `${nav}px` : '' });
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), `${nav + 47}px`, `${at}, navigation ${nav}: below the breadcrumb, counted once`);
    header.box.height = 71; // Wrapped breadcrumbs after a resize.
    await p.resize(900);
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), `${nav + 71}px`, `${at}: drawer follows the resized header`);
  }
});

test('Ultra sidebar ignores hidden and offscreen outgoing headers during navigation', async () => {
  const p = page({ at: 'discussion', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const header = p.$('content-page-header');
  header.box = { left: 0, top: 0, width: 1800, height: 47 };
  const stale = p.el('div', 'bb-course-navigation', 'Previous course');
  stale.box = { left: 0, top: 0, width: 1800, height: 120 };
  p.doc.body.prepend(stale);
  const style = p.c.getComputedStyle;
  p.c.getComputedStyle = (e) => ({ ...style(e), visibility: e === stale ? 'hidden' : 'visible' });
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '47px', 'a hidden outgoing navigation does not override the current page');
  p.c.getComputedStyle = style;
  stale.box.left = -1800;
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '47px', 'an outgoing header outside the viewport does not reserve room');
});

test('Ultra header offsets use the visible bottom of stacked bars and never undercut Glaze navigation', async () => {
  for (const at of ['courses', 'outline', 'stream', 'discussion', 'assessment', 'attempt', 'gradebook']) {
    const p = page({ at, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    const style = p.c.getComputedStyle;
    p.c.getComputedStyle = (e) => ({ ...style(e), getPropertyValue: (k) => ({ '--gz-navbar-top': '64px', '--gz-ctabs-row': '36px' })[k] || '' });
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '100px', `${at}: the global navigation and tab row are a floor`);
  }
  const p = page({ at: 'discussion', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const nav = p.el('div', 'bb-course-navigation', 'Course tabs');
  nav.box = { left: 200, top: 0, width: 1400, height: 60 };
  p.doc.body.prepend(nav);
  const header = p.$('content-page-header');
  header.box = { left: 200, top: 60, width: 1400, height: 47 };
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '107px', 'stacked bars reserve their bottom, not their summed viewport bottoms');
  p.c.sidebarSettings = { open: 'collapsed' };
  await p.pass();
  assert.equal(p.mode(), 'collapsed');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '107px', 'collapsed controls stay below the same bars');
  header.box.top = -20;
  nav.box.top = -60;
  await p.resize(900);
  assert.equal(p.mode(), 'drawer');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '27px', 'a partially scrolled header reserves only its visible bottom');
  header.box.top = -47;
  await p.resize(900);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '0px', 'fully scrolled headers reserve no room');
});

test('Ultra header candidates exclude hidden routes, zero-size bars and headers beyond any viewport edge', async () => {
  const p = page({ at: 'discussion', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const header = p.$('content-page-header');
  header.box = { left: 200, top: 0, width: 1400, height: 47 };
  const route = p.el('section', 'routed-page');
  const stale = p.el('content-page-header', '', 'Outgoing page');
  route.append(stale);
  p.doc.body.prepend(route);
  const box = { left: 200, top: 0, width: 1400, height: 120 };
  const style = p.c.getComputedStyle;
  for (const [why, change, css] of [
    ['hidden ancestor', {}, { display: 'none' }], ['invisible ancestor', {}, { visibility: 'hidden' }],
    ['transparent ancestor', {}, { opacity: '0' }], ['zero width', { width: 0 }], ['zero height', { height: 0 }],
    ['left of viewport', { left: -1400 }], ['right of viewport', { left: 1600 }], ['above viewport', { top: -120 }], ['below viewport', { top: 900 }],
  ]) {
    stale.box = { ...box, ...change };
    p.c.getComputedStyle = (e) => ({ ...style(e), ...(e === route ? css : {}) });
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '47px', why);
  }
  p.c.getComputedStyle = style;
  stale.box = box;
  route.hidden = true;
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '47px', 'the hidden attribute on an outgoing route');
});

test('Ultra header wrapping updates the offset without a window resize and stops observing while covered or disabled', async () => {
  const p = page({ at: 'discussion', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const header = p.$('content-page-header');
  header.box = { left: 200, top: 0, width: 1400, height: 47 };
  await p.pass();
  const observer = p.sizes.find((o) => o.targets.includes(header));
  assert.ok(observer, 'the breadcrumb size is observed');
  header.box.height = 94;
  observer.f();
  await settle();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '94px', 'wrapping changes the reserved top');
  p.doc.visibilityState = 'hidden';
  p.side.cover();
  assert.equal(observer.targets.length, 0, 'covered frames do not watch headers');
  p.doc.visibilityState = 'visible';
  p.side.cover();
  await settle();
  assert.ok(observer.targets.includes(header), 'the visible frame resumes observing');
  p.side.sync(false);
  assert.equal(observer.targets.length, 0, 'disabling releases header observations');
});

test('the header observer initial notification preserves an unchanged assignment projection', async () => {
  const p = page({ at: 'assessment', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const header = p.el('content-page-header', '', 'Course / Assignment');
  header.box = { left: 200, top: 0, width: 1400, height: 47 };
  p.$('.routed-page').prepend(header);
  await p.pass();
  const sheet = p.$('#gz-sb-absorb');
  assert.ok(sheet, 'the overview side panel is projected');
  p.sizes.find((o) => o.targets.includes(header)).f();
  await settle();
  assert.equal(p.$('#gz-sb-absorb'), sheet, 'the first ResizeObserver notification is not a window resize or an invalidation');
});

test('standalone routed documents and assessments reserve their actual panel header shells', async (t) => {
  for (const shape of ['panelHeaderContainerRoot', 'panel-header', 'header', 'headerRoot']) await t.test(shape, async () => {
    const p = page({ at: 'stream', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    p.c.location.pathname = '/ultra/courses/_101_1/document/_8110_1';
    const route = p.el('section', 'routed-page route-view-container bb-offcanvas-container');
    const shell = p.el('section', 'makeStylespanelRoot-b8b route-view-container');
    const base = p.el('div', 'makeStylesbaseBody-b8b');
    const wrapper = p.el('div', 'makeStylesheaderRoot-b8b');
    const header = shape === 'headerRoot' ? wrapper : p.el(shape === 'header' ? 'header' : 'div', shape === 'panelHeaderContainerRoot' ? 'makeStylespanelHeaderContainerRoot-b8b' : shape === 'panel-header' ? shape : '', p.el('h1', '', 'Routed reading'));
    header.box = { left: 200, top: 64, width: 1400, height: 47 };
    wrapper.box = { left: 200, top: 64, width: 1400, height: 83 };
    if (header !== wrapper) wrapper.append(header);
    // Course tabs live beside the inner header, inside headerRoot. The whole shell must clear the sidebar.
    wrapper.append(p.el('nav', '', 'Course tabs'));
    const prose = p.el('main', 'makeStylescontentGridArea-b8b', p.el('h1', '', 'A document heading'), p.el('header', '', 'Article header'));
    for (const e of prose.children) e.box = { left: 200, top: 350, width: 1400, height: 70 };
    base.append(wrapper, p.el('div', 'routed-scroll', prose)); shell.append(base); route.append(shell); p.doc.body.append(route);
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '147px', 'include the header wrapper and its tab row; ignore document headings');
    const observer = p.sizes.find((o) => o.targets.includes(wrapper));
    assert.ok(observer, 'observe the shell that changes when its title or tabs wrap');
    const replacement = p.el('header', '', 'Next document');
    replacement.box = { left: 200, top: 64, width: 1400, height: 60 };
    wrapper.replaceWith(replacement);
    await p.pass();
    assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '124px', 'plain route header without a generated wrapper');
    assert.ok(!observer.targets.includes(wrapper) && observer.targets.includes(replacement), 'release the replaced header and watch its successor');
    p.side.sync(false);
    let reads = 0;
    replacement.getBoundingClientRect = () => { reads++; return {}; };
    observer.f();
    await settle();
    assert.equal(reads, 0, 'a queued header notification after teardown performs no geometry reads');
  });
});

test('drawer threshold uses the course content after navigation, rather than its full-window shell', async () => {
  const p = page({ width: 1280, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const boxes = p.doc.boxOf;
  p.doc.boxOf = (e) => e.className === 'course-content-container' ? { left: 0, top: 0, width: 1280, height: 900 }
    : e.className === 'course-outline-content' ? { left: 220, top: 60, width: 1060, height: 840 } : boxes(e);
  await p.pass();
  assert.equal(p.mode(), 'drawer', '1060px after navigation cannot hold 720 + 352 + 16');
});

test('late Angular blocks join This page in place; CSS keeps the widgets visually last without reinserting the dock', async () => {
  const p = page({ at: 'outline', stored: record() });
  const aside = p.$('aside.outline-actions');
  for (const k of [...aside.children]) k.remove();
  await p.pass();
  assert.equal(p.mode(), 'none', 'an empty column with nothing docked keeps no room');
  assert.equal(p.$('#gz-sb-edge').hidden, false);
  const dock = p.$('#gz-sb-widgets'), head = p.$('.gz-sb-head');
  const late = p.el('div', 'js-details-and-actions outline-action-block', 'Details & Actions');
  aside.append(late); // Angular renders the block after Glaze's widgets
  p.mutate(aside);
  assert.equal(p.mode(), 'expanded');
  assert.equal(late.parentNode, aside);
  assert.ok(aside.lastElementChild === late, 'native insertion order is untouched');
  assert.ok(read('features/sidebar.css').includes('[data-gz-sb-self] > #gz-sb-widgets { order: 1; }'));
  assert.ok(p.$('#gz-sb-widgets') === dock && p.$('.gz-sb-head') === head, 'the same parts');
  // A change inside Glaze's own parts says nothing of the page's.
  const calls = p.observers.filter((o) => o.on).length;
  for (const o of p.observers.filter((x) => x.on)) o.f([{ target: dock, addedNodes: [], removedNodes: [] }]);
  assert.equal(p.observers.filter((o) => o.on).length, calls);
});

test('Angular swaps the column: the new one is dressed with the same header and dock, the old one gets its own back', async () => {
  const p = page({ at: 'outline', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  const old = p.$('aside.outline-actions'), dock = p.$('#gz-sb-widgets'), head = p.$('.gz-sb-head');
  const parent = old.parentNode;
  assert.ok(p.observers.some((o) => o.on && o.targets.includes(parent)), 'the column\'s parent is watched for a swap');
  const fresh = p.el('aside', 'outline-actions', p.el('div', 'js-details-and-actions', 'Details & Actions'));
  old.replaceWith(fresh);
  p.mutate(parent);
  await settle();
  assert.equal(fresh.dataset.gzSidebarHost, 'native');
  assert.equal(p.$('#gz-sb-widgets'), dock);
  assert.equal(p.$('.gz-sb-head'), head);
  assert.ok(fresh.contains(dock) && !old.contains(dock));
  assert.equal(old.dataset.gzSidebarHost, undefined);
  assert.equal(old.getAttribute('role'), null);
});

test('opening and closing a details layer never detaches the live dock or changes its mounting parent', async () => {
  const p = page({ stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  const dock = p.$('#gz-sb-widgets'), parent = dock.parentNode;
  let removes = 0;
  const remove = dock.remove.bind(dock);
  dock.remove = () => { removes++; remove(); };
  const draft = p.el('textarea', 'draft');
  dock.append(draft); draft.focus();
  const layer = p.el('div', 'layer-details', 'Participation');
  p.$('#main-content-inner').append(layer);
  await p.pass();
  assert.equal(removes, 0, 'no disconnect: iframe documents and focused drafts survive');
  assert.equal(dock.parentNode, parent);
  assert.equal(p.doc.activeElement, draft);
  assert.equal(p.mode(), 'drawer');
  layer.remove(); await p.pass();
  assert.equal(removes, 0);
  assert.equal(dock.parentNode, parent);
  assert.equal(p.mode(), 'expanded');
});

test('late native blocks never reinsert a live dock, even when focus is elsewhere', async () => {
  const p = page({ stored: record() });
  await p.pass();
  const dock = p.$('#gz-sb-widgets'), aside = p.$('aside.outline-actions');
  let reinserts = 0;
  const append = aside.append.bind(aside);
  aside.append = (...nodes) => { if (nodes.includes(dock)) reinserts++; append(...nodes); };
  aside.append(p.el('button', 'late-native', 'Schedule'));
  p.mutate(aside); await settle();
  assert.equal(reinserts, 0, 'CSS orders the dock after native blocks without reloading media');
});

test('Angular removing only the sidebar controls re-dresses the host without a site pass', async () => {
  const p = page({ stored: record() });
  await p.pass();
  const dock = p.$('#gz-sb-widgets'), aside = p.$('aside.outline-actions');
  dock.remove();
  p.mutate(aside, { removedNodes: [dock] }); await settle();
  assert.ok(dock.parentNode === aside, 'native host restored by its observer');
});

test('folding This page hides every block but Glaze\'s parts; Course notes and the syllabus stay among the page\'s blocks, above the widgets', async () => {
  const p = page({ at: 'outline', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  const aside = p.$('aside.outline-actions');
  // Course notes' block (features/notes.js) and the syllabus's (features/syllabus.js) go above the widgets, not after.
  assert.match(read('features/notes.js'), /const end = \[\.\.\.side\.children\]\.find\(\(c\) => c\.id === 'gz-sb-widgets'\);\n.*if \(end\) end\.before\(block\); else side\.append\(block\);/);
  assert.match(read('features/syllabus.js'), /d \? d\.after\(b\) : end \? end\.before\(b\) : aside\.append\(b\)/);
  p.fire(p.$('.gz-sb-pagehead .gz-sb-sec-btn'), 'click'); await settle();
  assert.equal(aside.dataset.gzSbFoldPage, '');
  assert.equal(p.store[KEY].fold.outline.page, true, 'kept for outlines');
  const css = read('features/sidebar.css');
  assert.ok(css.includes('[data-gz-sb-fold-page][data-gz-sb-self] > :not(.gz-sb-resize, .gz-sb-head, .gz-sb-pagehead, #gz-sb-widgets)'));
});

test('an Ultra column that goes away gives the page back: unsupported means native', async () => {
  const p = page({ at: 'courses', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  const col = p.$('div.todo-panel');
  assert.equal(col.dataset.gzSidebarHost, 'native');
  col.remove();
  await p.pass();
  assert.equal(col.dataset.gzSidebarHost, undefined);
  assert.ok(!col.all().some(p.ours), 'nothing of Glaze\'s left in it');
  assert.equal(p.host().id, 'gz-sidebar', 'the dock on its own');
  p.side.sync(false); await settle();
  assert.equal(p.doc.root.all().filter(p.ours).length, 0, 'switched off: no Glaze node left');
  for (const k of ['gzSidebar', 'gzSbFixed', 'gzSidebarTodo']) assert.equal(p.doc.root.dataset[k], undefined, k);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-top'), '');
});

// ---- the Courses page's board and the dock ------------------------------------------------------------------------
const courses = (x = {}) => page({ at: 'courses', widgets: true, todo: true, ...x });
// A layout with only these tiles on (each board lists every built-in, off unless given).
const all = (rows) => [...rows, ...W.TILES.filter((id) => !rows.some((x) => x.id === id)).map((id) => ({ id, on: false }))];
const lay = (boards) => ({ todo: true, filled: ['courses', 'dash'], tiles: W.TILES.map((id) => ({ id, on: false })), boards: Object.fromEntries(Object.entries(boards).map(([b, rows]) => [b, all(rows)])) });

test('Courses page, sidebar on: the column board is gone, its widgets docked in their order and fold, course cards still on the board', async () => {
  const p = courses({ stored: { widgetLayout: lay({ courses: [{ id: 'notes', on: true, fold: true }, { id: 'timer', on: true }, { id: CARD, on: true, x: 0, y: 0 }], dash: [] }) } });
  const before = natives(p);
  await p.pass();
  assert.equal(p.store[KEY].mig, 1);
  assert.deepEqual(S.docked(p.store[KEY]).map((x) => x.id), ['notes', 'timer'], 'the column\'s widgets, docked in its order');
  assert.equal(p.store[KEY].dock.find((x) => x.id === 'notes').fold, true, 'with their fold');
  const dockEl = p.$('.gz-sb-dock');
  assert.ok(dockEl.contains(p.$('section[data-tile="notes"]')) && dockEl.contains(p.$('section[data-tile="timer"]')));
  assert.equal(p.doc.querySelectorAll('section[data-tile="notes"]').length, 1, 'one note');
  const card = p.$(`section[data-tile="${CARD}"]`);
  assert.ok(card && p.$('#gz-room').contains(card), 'the course card on the board, in the page\'s room');
  assert.equal(p.$('div.todo-panel #gz-panel'), null, 'no board in the column');
  assert.ok(p.$('div.courses-panel').firstElementChild.id === 'gz-panel', 'the board\'s panel above the courses');
  assert.ok(p.$('div.todo-panel').dataset.gzSidebarHost === 'native', 'the column is the sidebar');
  // The layout keeps every spot: the board entries stay as they were.
  const kept = W.layout(p.store.widgetLayout).boards.courses;
  assert.deepEqual(kept.filter((x) => x.on).map((x) => x.id).sort(), [CARD, 'notes', 'timer'].sort());
  unmoved(p, before, 'courses');
});

test('Courses page, sidebar off: the column board as before, and back to the dock when it is on again', async () => {
  const stored = { widgetLayout: lay({ courses: [{ id: 'notes', on: true }, { id: CARD, on: true, x: 0, y: 0 }], dash: [] }) };
  const p = courses({ stored, enhance: { sidebar: false } });
  await p.pass();
  assert.ok(p.$('div.todo-panel').firstElementChild.id === 'gz-panel', 'the panel first in the column');
  assert.ok(p.$('#gz-room').contains(p.$('section[data-tile="notes"]')), 'the note on the board');
  assert.ok(p.$('#gz-sb-widgets') === null, 'no dock');
  // On (the same page, its switch flipped).
  const q = courses({ stored });
  await q.pass();
  assert.ok(q.$('.gz-sb-dock').contains(q.$('section[data-tile="notes"]')), 'docked');
  assert.equal(q.$('div.todo-panel #gz-panel'), null);
  // And off again: the board is a board in the column once more; the dock's choices stay saved.
  q.side.sync(false); q.ui.sync(true); await settle();
  assert.ok(q.$('div.todo-panel').firstElementChild.id === 'gz-panel', 'the column board back');
  assert.ok(q.$('#gz-room').contains(q.$('section[data-tile="notes"]')), 'the note back on its board spot');
  assert.equal(q.store[KEY].dest.notes, 'dock', 'kept for when the sidebar comes back');
});

test('one To Do: docked, Ultra\'s own steps aside only once Better To Do is in the dock, never twice, never through the old places', async () => {
  const p = courses({ stored: { widgetLayout: lay({ courses: [{ id: 'todo', on: true }], dash: [{ id: 'todo', on: true }] }) } });
  await p.pass();
  assert.equal(p.store[KEY].dest.todo, 'dock', 'both boards had it: docked');
  assert.equal(p.doc.querySelectorAll('#gz-todo').length, 1, 'one list');
  assert.ok(p.$('.gz-sb-dock').contains(p.$('#gz-todo')));
  assert.equal(p.doc.root.dataset.gzSidebarTodo, '', 'Ultra\'s own To Do steps aside (apps.css)');
  assert.equal(p.doc.root.dataset.gzTodoTile, undefined, 'not the board\'s mark: the board has no To Do');
  assert.ok(!p.todoCalls.some(([k, on]) => k === 'sync' && on), 'the legacy places never asked');
  assert.deepEqual(p.todoCalls.find(([k]) => k === 'mount'), ['mount', '', 'follow'], 'all courses on the Courses page');
  assert.ok(read('features/apps.css').includes('html[data-gz-sidebar-todo] div.todo-panel > bb-todo { display: none !important; }'));
  // The page's own column is empty without its To Do: This page doesn't show.
  assert.equal(p.$('.gz-sb-pagehead').hidden, true);
});

test('To Do follows the page: an outline\'s course, all courses elsewhere; All courses is kept', async () => {
  const p = page({ at: 'outline', widgets: true, todo: true, stored: record({ dock: [{ id: 'todo' }], dest: { todo: 'dock' } }) });
  await p.pass();
  assert.deepEqual(p.todoCalls.filter(([k]) => k === 'mount').at(-1), ['mount', '_101_1', 'follow']);
  await p.side.op([{ op: 'todoScope', v: 'all' }]); await settle();
  assert.deepEqual(p.todoCalls.filter(([k]) => k === 'mount').at(-1), ['mount', '_101_1', 'all'], 'the page\'s course, with All courses (features/todo.js shows them all)');
  const q = page({ at: 'stream', widgets: true, todo: true, stored: record({ dock: [{ id: 'todo' }], dest: { todo: 'dock' } }) });
  await q.pass();
  assert.deepEqual(q.todoCalls.filter(([k]) => k === 'mount').at(-1), ['mount', '', 'follow']);
});

test('Ultra\'s To Do stays when the dock doesn\'t own it; a deliberate removal hides it', async () => {
  const p = courses({ stored: record({ dest: {} }) });
  await p.pass();
  assert.equal(p.doc.root.dataset.gzSidebarTodo, undefined, 'nothing replaces it: Ultra\'s own stays');
  assert.equal(p.$('bb-todo').parentNode, p.$('div.todo-panel'));
  assert.equal(p.$('.gz-sb-pagehead').hidden, false, 'Ultra\'s To Do is This page');
  const q = courses({ stored: record({ dest: { todo: 'off' } }) });
  await q.pass();
  assert.equal(q.doc.root.dataset.gzSidebarTodo, '', 'removed on purpose with the sidebar on');
});

test('the boards disagreed: the offer to move To Do, nonblocking; Move docks it, Dismiss keeps the boards as they are', async () => {
  const stored = { widgetLayout: lay({ courses: [{ id: 'todo', on: true }], dash: [{ id: 'todo', on: false }] }) };
  const p = courses({ stored });
  await p.pass();
  assert.equal(p.store[KEY].offer.todo, 'pending');
  assert.equal(p.store[KEY].dest.todo, undefined, 'no guess');
  const offer = p.$('.gz-sb-offer');
  assert.equal(offer.hidden, false, 'offered');
  assert.equal(p.doc.querySelectorAll('#gz-todo').length, 0, 'no Better To Do beside Ultra\'s meanwhile');
  assert.equal(p.doc.root.dataset.gzSidebarTodo, undefined, 'Ultra\'s own To Do stays');
  assert.equal(p.mode(), 'expanded', 'nothing waits on it');
  p.fire(offer.children.find((b) => b.textContent === 'Move To Do to sidebar'), 'click'); await settle();
  assert.equal(p.store[KEY].dest.todo, 'dock');
  assert.equal(p.store[KEY].offer.todo, undefined);
  assert.equal(offer.hidden, true);
  assert.equal(p.doc.querySelectorAll('#gz-todo').length, 1);
  assert.equal(S.docked(p.store[KEY])[0].id, 'todo', 'first in the dock');

  const q = courses({ stored });
  await q.pass();
  q.fire(q.$('.gz-sb-offer').children.find((b) => b.textContent === 'Dismiss'), 'click'); await settle();
  assert.equal(q.store[KEY].offer.todo, 'dismissed');
  assert.equal(q.$('.gz-sb-offer').hidden, true);
  assert.equal(q.store[KEY].dest.todo, undefined);
  assert.deepEqual(W.layout(q.store.widgetLayout).boards.courses.find((x) => x.id === 'todo').on, true, 'the boards as they were');
});

test('Ultra\'s Dashboard stays a board; Move to Dashboard sends a docked widget there, not to the Courses page', async () => {
  const p = page({ at: 'stream', widgets: true, stored: { widgetLayout: lay({ courses: [], dash: [] }), ...record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) } });
  await p.pass();
  p.fire(p.$('section[data-tile="notes"] .gz-w-dest'), 'click');
  const items = p.$('#gz-sb-menu').children.map((b) => b.textContent);
  assert.ok(items.includes('Move to Dashboard'), items.join());
  p.fire(p.$('#gz-sb-menu').children.find((b) => b.textContent === 'Move to Dashboard'), 'click'); await settle();
  assert.equal(p.store[KEY].dest.notes, 'board');
  assert.deepEqual(p.store[KEY].ret.notes, { to: 'board', board: 'dash' });
  assert.equal(W.layout(p.store.widgetLayout).boards.dash.find((x) => x.id === 'notes').on, true);
  // Without Ultra's Dashboard, there is no board to move to.
  const q = page({ at: 'stream', widgets: true, enhance: { dashboard: false }, stored: { widgetLayout: lay({ courses: [], dash: [] }), ...record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) } });
  await q.pass();
  q.fire(q.$('section[data-tile="notes"] .gz-w-dest'), 'click');
  assert.ok(!q.$('#gz-sb-menu').children.some((b) => b.textContent === 'Move to Dashboard'));
});

test('content-ultra.js: the sidebar on the page and in a course tab\'s frame (dock widgets only there), with Better To Do\'s old places off while it runs', () => {
  const src = read('content-ultra.js');
  assert.match(src, /const sidebarHere = \(\) => !!top\(\)\?\.sidebar && I\.settings\.sidebar\?\.ultra !== false && \/\^/);
  assert.match(src, /if \(e && tabFrame\) return sidebarOn\(\) && /);
  assert.match(src, /const syncSidebar = \(\) => load\(sidebarHere, 'features\/sidebar\.js', 'GZ_SIDEBAR_UI'\);/);
  assert.match(src, /\(e\.todo && sidebarOn\(\)\)/);
  assert.ok(src.includes("sidebarOn() && !globalThis.GZ_SIDEBAR_UI?.failed()"));
  assert.match(src, /const syncWidgets = \(\) => \{\n {4}syncSidebar\(\);/);
});

test('a slow Ultra route never relabels the outgoing column on a timeout', async () => {
  const p = page({ stored: record() });
  let now = 10000, timers = [];
  p.c.Date = class extends Date { static now() { return now; } };
  p.c.setTimeout = (f) => { timers.push(f); return timers.length; };
  await p.pass();
  p.c.location.pathname = '/ultra/courses/_102_1/outline';
  await p.pass();
  now += 10000;
  for (const f of timers.splice(0)) f();
  await p.pass();
  assert.equal(p.side.context().courseId, '_101_1', 'elapsed time does not establish a new native view');
  const old = p.$('aside.outline-actions');
  old.append(p.el('section', 'gz-course-notes', 'Glaze helper loaded for the new address'));
  await p.pass();
  assert.equal(p.side.context().courseId, '_101_1', 'Glaze helpers do not establish a new native view');
  const fresh = p.el('aside', 'outline-actions', p.el('div', 'spinner', 'Loading'));
  old.replaceWith(fresh);
  await p.pass();
  assert.equal(p.side.context().courseId, '_101_1', 'a replacement that is still loading is not ready');
  fresh.replaceChildren(p.el('div', 'js-details-and-actions', 'New course details'));
  await p.pass();
  assert.equal(p.side.context().courseId, '_102_1');
});

test('a route change invalidates callbacks even while its native view is still outgoing', async () => {
  const p = page({ stored: record() });
  await p.pass();
  const before = p.side.context();
  p.c.location.pathname = '/ultra/courses/_102_1/outline';
  assert.notEqual(p.side.context().gen, before.gen, 'callbacks can arrive before the site schedules its next pass');
  await p.pass();
  assert.notEqual(p.side.context().gen, before.gen);
  assert.equal(p.side.context().courseId, before.courseId);
});

test('an outgoing details layer cannot establish a different course from its address alone', async () => {
  const p = page({ at: 'detail', stored: record() });
  await p.pass();
  p.c.location.pathname = '/ultra/courses/_102_1/outline';
  await p.pass();
  assert.equal(p.side.context().courseId, '_101_1', 'the outgoing layer and column are still the old course');
  p.$('.layer-details').remove();
  await p.pass();
  assert.equal(p.side.context().courseId, '_101_1', 'closing the old layer still does not establish the new course');
  p.$('aside.outline-actions').replaceWith(p.el('aside', 'outline-actions', p.el('div', 'js-details-and-actions', 'New course details')));
  await p.pass();
  assert.equal(p.side.context().courseId, '_102_1');
});

test('a new native course body establishes context even when Ultra keeps identical column blocks', async () => {
  const p = page({ stored: record() });
  const panel = p.$('.course-content-container');
  panel.setAttribute('bb-course-membership-markups', '_101_1');
  await p.pass();
  p.c.location.pathname = '/ultra/courses/_102_1/outline';
  await p.pass();
  assert.equal(p.side.context().courseId, '_101_1');
  panel.setAttribute('bb-course-membership-markups', '_102_1');
  p.$('.course-outline-content').replaceWith(p.el('section', 'course-outline-content', 'New course content'));
  await p.pass();
  assert.equal(p.side.context().courseId, '_102_1', 'identical faculty and details do not hold the new course back');
});

test('a hidden browser document closes the drawer and suspends observation until visible again', async () => {
  const p = page({ width: 900, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const events = new Map();
  p.doc.addEventListener = (name, f) => { events.set(name, f); };
  p.doc.removeEventListener = (name) => { events.delete(name); };
  await p.pass();
  p.fire(p.$('#gz-sb-launch'), 'click');
  assert.equal(p.doc.root.dataset.gzSidebarOpen, '');
  p.doc.visibilityState = 'hidden';
  events.get('visibilitychange')?.();
  assert.equal(p.side.asleep(), true);
  assert.equal(p.side.host(), null);
  assert.ok(p.observers.every((o) => !o.on));
  assert.ok(!p.doc.body.all().some((e) => e.inert), 'drawer inertness released');
  p.doc.visibilityState = 'visible';
  events.get('visibilitychange')?.();
  await settle();
  assert.equal(p.side.asleep(), false);
  assert.ok(p.side.host());
  assert.ok(p.observers.some((o) => o.on));
});

test('covering an Ultra drawer releases its top-layer popover as well as its inert lock', async () => {
  const p = page({ width: 900, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  let visible = true, lifted = false;
  p.c.GZ_CTABS = { visible: () => visible };
  await p.pass();
  const host = p.host();
  host.showPopover = () => { lifted = true; };
  host.hidePopover = () => { lifted = false; };
  p.fire(p.$('#gz-sb-launch'), 'click');
  assert.equal(lifted, true);
  visible = false; p.side.cover();
  assert.equal(lifted, false, 'a hidden drawer cannot cover the next course frame from the top layer');
  assert.equal(host.getAttribute('popover'), null);
});

test('an account change resets the sidebar record and generation before its next render', async () => {
  const other = S.key('ultra', O, '_4_1');
  const p = page({ stored: { ...record({ open: false }), [other]: S.clean({ mig: 1, open: true }) } });
  await p.pass();
  const before = p.side.context().gen;
  p.c.GZ_CTX.account = async () => '_4_1';
  await p.pass();
  assert.equal(p.side.context().accountId, '_4_1');
  assert.notEqual(p.side.context().gen, before);
  assert.equal(p.side.rec().open, true, 'new account record');
  await p.side.op([{ op: 'open', v: false }]);
  assert.equal(p.sent.at(-1).key, other, 'new writes use the new account');
});

test('a failed write waiting on another callback cannot show its error after navigation', async () => {
  const p = page({ stored: record() });
  await p.pass();
  const held = [];
  p.c.chrome.runtime.sendMessage = (m, cb) => { if (m.type === 'glaze:sidebar') held.push(cb); else cb?.({ ok: true }); };
  const a = p.side.op([{ op: 'open', v: false }]);
  const b = p.side.op([{ op: 'width', px: 400 }]);
  held.shift()({ ok: false });
  await a;
  p.c.location.pathname = '/ultra/courses/_101_1/outline/discussion/_9_1';
  p.$('#main-content-inner').append(p.el('div', 'layer-details', 'Participation'));
  await p.pass();
  held.shift()({ ok: true });
  await b; await settle();
  assert.equal(p.$('.gz-sb-note').textContent, '', 'the old route owns the failed save');
});

test('Add widgets opened before the widget renderer finishes fills when its catalog arrives', async () => {
  const p = page({ stored: record() });
  await p.pass();
  p.fire(p.$('.gz-sb-add'), 'click');
  assert.equal(p.$('#gz-sb-adding').hidden, false);
  assert.equal(p.$('.gz-sb-row'), null, 'the renderer has not loaded yet');
  p.c.GZ_WIDGETS_UI = { catalog: () => [{ id: 'timer', name: 'Focus timer', where: 'off' }] };
  p.side.drawn(0);
  assert.ok(p.$('.gz-sb-row')?.textContent.includes('Focus timer'), 'the open chooser learns the loaded catalog');
});

test('a frame hidden before its first mount keeps committed sidebar changes for its first show', async () => {
  const p = page({ stored: record() }), listeners = [];
  let visible = false;
  p.c.GZ_CTABS = { visible: () => visible };
  p.c.chrome.storage.onChanged.addListener = (f) => listeners.push(f);
  await p.pass();
  assert.equal(p.side.active(), false);
  const next = S.clean({ mig: 1, dock: [{ id: 'timer' }], dest: { timer: 'dock' } });
  p.store[KEY] = next;
  for (const f of listeners) f({ [KEY]: { newValue: next } }, 'local');
  visible = true; p.side.cover(); await settle();
  assert.equal(p.side.rec().dest.timer, 'dock', 'first show uses the record committed while waiting');
});

// ---- live structures (2026-10-20) ------------------------------------------------------------------------------------
test("a discussion's details column (a column of its grid, not a layer) is the sidebar in place: This page, expanded, the dock under it", async () => {
  const p = page({ at: 'discussion', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const before = natives(p);
  await p.pass();
  const details = p.$('.layer-details');
  assert.equal(p.side.context().family, 'discussion');
  assert.equal(p.host(), details, 'Ultra\'s own column is dressed');
  assert.equal(details.dataset.gzSidebarHost, 'native');
  assert.equal(p.mode(), 'expanded', 'room enough: never a forced drawer');
  assert.equal(details.getAttribute('role'), 'complementary');
  assert.equal(details.dataset.gzSbOverlay, undefined);
  assert.equal(p.doc.root.dataset.gzSbFamily, 'discussion');
  assert.equal(details.lastElementChild.id, 'gz-sb-widgets');
  assert.equal(p.side.context().courseId, '_101_1', 'Follow page: the discussion\'s course');
  unmoved(p, before, 'discussion');
  // Ultra hides its participants below its large breakpoint itself: nothing of Glaze's says otherwise.
  assert.equal(p.$('.discussion-participants').hidden, false);
  // No room: a drawer, with the same column.
  await p.resize(900);
  assert.equal(p.mode(), 'drawer');
  assert.equal(p.host(), details);
  unmoved(p, before, 'discussion, narrow');
});

test('an assignment overview gets the assignment family and Glaze\'s own column; the Gradebook keeps the grades minimum, else a drawer', async () => {
  const a = page({ at: 'assessment', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await a.pass();
  assert.equal(a.side.context().family, 'assessment');
  assert.equal(a.host().id, 'gz-sidebar');
  assert.equal(a.doc.root.dataset.gzSbFixed, '');
  for (const [w, want] of [[1800, 'expanded'], [1440, 'drawer'], [1280, 'drawer']]) {
    const g = page({ at: 'gradebook', width: w, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    await g.pass();
    assert.equal(g.side.context().family, 'grades', `${w}`);
    assert.equal(g.mode(), want, `${w}: 900px for the table beside 352 (the nav takes 200)`);
    // At the widest width the student can drag (480) the table still keeps 900px, else a drawer.
    const wide = page({ at: 'gradebook', width: w, stored: record({ width: 480, chose: { width: true }, dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    await wide.pass();
    assert.equal(wide.mode(), w - 200 - 480 - 16 >= 900 ? 'expanded' : 'drawer', `${w} at 480`);
  }
  // The course's absolute tool panel ends at the column's edge and the gap (features/sidebar.css).
  const css = read('features/sidebar.css');
  assert.match(css, /html\[data-gz-sb-fixed\]:is\(\[data-gz-sidebar="expanded"\], \[data-gz-sidebar="collapsed"\]\) \.course-content-container > \.panel-wrap \{[^}]*inset-inline-end: var\(--gz-sb-room\) !important/);
  assert.match(css, /html\[data-gz-sidebar="expanded"\] \{ --gz-sb-room: calc\(var\(--gz-sidebar-w\) \+ 16px \+ var\(--gz-sb-inset, 0px\) \+ var\(--gz-sb-safe, 0px\)\); \}/);
});

test("a pinned column's height is its top and bottom's, whatever height the site gives it", () => {
  // Ultra gives a course outline's column a height of its own (in sheets the page can't read): left alone, the pinned
  // column ran past the window's bottom with nothing to scroll. Expanded, the drawer and Glaze's own column alike.
  const css = read('features/sidebar.css');
  const rule = (head) => { const i = css.indexOf(head); assert.ok(i >= 0, head); return css.slice(i, css.indexOf('}', i)); };
  for (const head of ['html:is([data-gz-sidebar="expanded"], [data-gz-sidebar="collapsed"]) [data-gz-sidebar-host] {',
    'html[data-gz-sidebar="drawer"][data-gz-sidebar-open] [data-gz-sidebar-host] {',
    'html:is([data-gz-sidebar="expanded"], [data-gz-sidebar="collapsed"]) #gz-sidebar.gz-sb-fixed {']) {
    const r = rule(head);
    assert.match(r, /position: fixed !important; [^}]*top: var\(--gz-sb-top/, head);
    assert.match(r, /bottom: var\(--gz-sb-end\)/, head);
    assert.match(r, /height: auto !important/, head);
  }
});

test('Ultra page switches restore the legacy To Do hook when that page kind is disabled', async () => {
  const p = page({ at: 'courses' });
  const calls = [];
  p.c.sidebarSettings = { off: ['dashboard'] };
  await p.pass();
  p.c.I = { links: [1], get settings() { return p.c.GZ_CTX.settings(); } };
  p.c.solo = true;
  p.c.need = async () => {};
  p.c.GZ_TODO_UI = { sync: (v) => calls.push(v) };
  const src = read('content-ultra.js');
  const hooks = ['load', 'top', 'sidebarHere', 'sidebarOn', 'syncTodo'].map((n) => src.match(new RegExp(` {2}const ${n} = .*\\n`))[0]).join('');
  await vm.runInContext(`${hooks}\nsyncTodo();`, p.c);
  assert.equal(calls.at(-1), true, 'legacy To Do runs on a disabled Courses page');
  p.c.GZ_SIDEBAR_UI = undefined;
  await vm.runInContext('syncTodo();', p.c);
  assert.equal(calls.at(-1), true, 'legacy To Do also runs before the disabled sidebar file arrives');
});

test('Ultra off matches the frozen pre-sidebar Courses board DOM and html attributes', async () => {
  const baseline = require('./fixtures/sidebar-legacy.json').ultra;
  const snapshot = require('./sidebar-snapshot.js');
  for (const kindOff of [false, true]) {
    const sw = { sidebar: false, widgets: false, notes: false, pet: false, todo: true };
    const p = page({ at: 'courses', widgets: true, todo: true, enhance: sw,
      stored: { widgetLayout: W.layout({ todo: true, tiles: [{ id: 'todo', on: true }, { id: 'notes', on: false }] }) } });
    await p.pass();
    assert.deepEqual(snapshot(p, ['#site-wrap']), baseline, 'off from startup');
    sw.sidebar = true;
    await p.pass();
    if (kindOff) p.c.sidebarSettings = { off: ['dashboard'] }; else sw.sidebar = false;
    await p.pass();
    assert.deepEqual(snapshot(p, ['#site-wrap']), baseline, `off after on, page switch: ${kindOff}`);
    assert.equal(p.$('.gz-sb-head'), null);
  }
});

test('a hidden outgoing outline cannot erase the Gradebook navigation allowance', async () => {
  const p = page({ at: 'gradebook', width: 1400, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const outgoing = p.el('section', 'course-outline-content');
  outgoing.box = { left: 0, top: 0, width: 0, height: 0 };
  p.$('#main-content-inner').prepend(outgoing);
  await p.pass();
  assert.equal(p.mode(), 'drawer', 'the Gradebook still needs 900px after the visible navigation');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-left'), '200px');
});

test('a disabled Ultra page kind keeps the legacy widget-loader boundary in course frames', async () => {
  const p = page({ at: 'courses' });
  p.c.sidebarSettings = { off: ['dashboard'] };
  p.c.I = { links: [1], get settings() { return p.c.GZ_CTX.settings(); } };
  p.c.solo = true; p.c.tabFrame = 'course';
  const src = read('content-ultra.js');
  const hooks = ['top', 'sidebarHere', 'sidebarOn', 'widgetsHere'].map((n) => src.match(new RegExp(` {2}const ${n} = .*\\n`))?.[0] || '').join('');
  assert.equal(vm.runInContext(`${hooks}\n!!widgetsHere();`, p.c), false);
  p.c.sidebarSettings = {};
  assert.equal(vm.runInContext('!!widgetsHere();', p.c), true);
});
