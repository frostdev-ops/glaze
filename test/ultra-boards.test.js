// Blackboard Ultra's boards (B7b): features/widgets.js and features/dashboard.js on synthetic Courses and Institution
// pages built from parity/spikes/B7.md (and B0's anchors), in a VM with the stand-in DOM laying the page out like Ultra
// at 1280 px: a 200 px nav, the page from 200 to 1280, the To Do column its last 320 px. The tiles float in the page's
// layer at the column's top, the column makes room for them; Edit layout lets them move (pointer and keys, snapped, kept
// across a reload); a narrow window stacks them and keeps the layout. The Dashboard's tabs, and the landing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');
const { El } = require('./stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const ONLY = (ids) => ({ tiles: W.TILES.map((id) => ({ id, on: ids.includes(id) })) });

// page: 'courses' or 'dash'; width: the window's (narrow: Ultra puts the To Do column under the courses).
// Elements are compared with ===: an assertion message would print the whole stand-in document.
const page = ({ at = 'courses', width = 1280, local = {}, sync = {}, session = {}, blocked = false, nav = 'navigate', path: where } = {}) => {
  const doc = { activeElement: null, root: null };
  const make = (t) => new El(t, doc);
  doc.root = make('html');
  doc.body = make('body');
  doc.root.append(doc.body);
  const el = (tag, cls, ...kids) => { const e = make(tag); e.className = cls; e.append(...kids); return e; };
  const narrow = width < 900;
  const W0 = width - (narrow ? 0 : 200); // the page's width, right of the nav
  const left0 = narrow ? 0 : 200;
  const navLink = make('a');
  navLink.attrs.href = '/ultra/institution-page';
  const clicks = [];
  navLink.click = () => clicks.push('/ultra/institution-page');
  doc.body.append(el('nav', 'MuiDrawer-paper', navLink));
  let ip = null;
  if (at === 'courses') {
    doc.body.append(el('section', 'base-courses-container route-view-container', el('div', 'base-courses-header-container', el('h1', 'page-title')),
      el('div', 'base-courses-content', el('div', 'courses-panel', el('div', 'base-courses')), el('div', 'todo-panel js-todo-panel-skip-link-target', el('bb-todo', 'react-container')))));
  } else {
    const h1 = el('h1', 'page-title');
    h1.id = 'main-heading';
    ip = el('institution-page-home', '', el('div', 'ip-app'));
    doc.body.append(el('main', '', el('section', 'institution-page-container route-view-container', el('div', 'black-panel-header base-header', h1, el('div', 'base-header-tools-transclude')), ip)));
  }
  // Ultra's layout, as the stand-in's boxes: the page's layer, the column's grid (Glaze's panel, 16 px in), a tile by its
  // size (200 px high), the Dashboard's room.
  doc.boxOf = (e) => {
    if (e.id === 'gz-room') return { left: left0, top: 0, width: W0, height: 0 };
    if (e.className === 'gz-dash-grid' && at === 'courses') return narrow ? { left: 16, top: 900, width: W0 - 32, height: 0 } : { left: width - 320 + 16, top: 120, width: 288, height: 0 };
    if (e.className === 'gz-dash-grid') return { left: left0 + 24, top: 140, width: W0 - 48, height: 400 };
    if (e.className === 'gz-w') return { left: 0, top: 0, width: W.WIDTH[e.dataset.size] || 288, height: 200 };
    if (/route-view-container/.test(e.className)) return { left: left0, top: 0, width: W0, height: 1600 };
    return null;
  };
  doc.fire = (target, type, { trusted = true } = {}) => { for (let p = target; p; p = p.parentNode) for (const l of p.listeners.filter((x) => x.type === type)) l.f({ type, target, isTrusted: trusted, preventDefault() {}, stopPropagation() {} }); };
  Object.assign(doc, { createElement: make, createTextNode: (data) => ({ data, textContent: data }), getElementById: (x) => doc.root.all().find((e) => e.id === x) || null,
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
    documentElement: doc.root, referrer: '' });
  const wrote = [], sent = [], loads = [];
  const settings = D.GZ_SANITIZE({ enhance: { notes: true, widgets: true } });
  const store = { ...structuredClone(local) };
  const c = {
    // No clocks: the quote and the timer would keep the test's process alive.
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, setTimeout: () => 0, clearTimeout() {},
    document: doc, location: { origin: 'https://school.blackboard.test', pathname: where || (at === 'courses' ? '/ultra/course' : '/ultra/institution-page'), href: 'https://school.blackboard.test/ultra', assign: (u) => clicks.push(`assign ${u}`) },
    innerWidth: width, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    sessionStorage: blocked ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } : { getItem: (k) => session[k] ?? null, setItem: (k, v) => { session[k] = String(v); } },
    performance: { getEntriesByType: () => [{ type: nav }] },
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W,
    GZ_CTX: {
      site: 'ultra', t: (k, v) => (v ? k.replace(/\{(\w+)\}/g, (_, n) => v[n]) : k), locale: () => 'en', settings: () => settings,
      need: async (f) => { loads.push(f); if (f === 'features/dashboard.js' && !c.GZ_DASH_UI) vm.runInContext(read(f), c); },
    },
    chrome: {
      runtime: { lastError: undefined, getURL: (p) => p, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => { sent.push(m); cb?.({ ok: true, timer: W.IDLE }); } },
      storage: {
        local: { get: (keys, cb) => cb(Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])]))), set: (v) => { wrote.push(structuredClone(v)); Object.assign(store, structuredClone(v)); } },
        sync: { get: (k, cb) => cb(structuredClone(sync)) },
        onChanged: { addListener() {}, removeListener() {} },
      },
    },
  };
  c.globalThis = c;
  c.window = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('features/widgets.js'), c);
  const tile = (id) => doc.querySelector(`section[data-tile="${id}"]`);
  const ev = (type, x = {}) => ({ type, target: null, button: 0, pointerId: 1, clientX: 0, clientY: 0, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...x });
  return { ui, doc, c, store, wrote, sent, loads, clicks, session, ip, tile, ev, room: () => doc.getElementById('gz-room'), grid: () => doc.querySelector('#gz-dash .gz-dash-grid') };
};
const px = (v) => Number(String(v).replace('px', ''));

test('Courses page: the tiles float in the page, where the panel was, and the column keeps room for them', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const notes = p.tile('notes'), timer = p.tile('timer');
  assert.ok(notes.parentNode === p.room(), "in the page's layer, not the panel");
  assert.ok(p.room().parentNode.firstElementChild === p.room(), "first in Ultra's page container");
  assert.equal(p.doc.querySelector('div.todo-panel').firstElementChild.id, 'gz-panel', 'the panel keeps its place and its bar');
  // Right-aligned with the panel's grid (1080 − 16 − 288 = 776 in the layer), one under the other from its top.
  assert.deepEqual([px(notes.style.left), px(notes.style.top)], [776, 120]);
  assert.equal(px(timer.style.left), 776);
  assert.ok(px(timer.style.top) >= 120 + 200 + W.GAP, 'below the first, a gap apart');
  // The column's own contents (Better To Do, Ultra's To Do) start below them.
  assert.equal(px(p.grid().style.height), px(timer.style.top) + 200 - 120);
  assert.equal(p.grid().getAttribute('data-stack'), null);
  // Not editing: a press on a heading moves nothing.
  notes.querySelector('.gz-w-head').dispatchEvent(p.ev('pointerdown', { target: notes.querySelector('.gz-w-head'), clientX: 1000, clientY: 130 }));
  notes.querySelector('.gz-w-head').dispatchEvent(p.ev('pointermove', { clientX: 400, clientY: 500 }));
  notes.querySelector('.gz-w-head').dispatchEvent(p.ev('pointerup'));
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'nothing kept');
});

test('Edit layout: announced, keyboard reachable; a drag snaps, fixes the others where they are and is kept across a reload', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const edit = p.doc.querySelector('#gz-dash .gz-dash-edit');
  assert.equal(edit.tagName, 'BUTTON');
  assert.equal(edit.textContent, 'Edit layout');
  p.doc.fire(edit, 'click');
  assert.equal(edit.getAttribute('aria-pressed'), 'true');
  assert.equal(edit.textContent, 'Done');
  assert.equal(p.doc.querySelector('.gz-dash-reset').hidden, false, 'Reset layout');
  assert.match(p.doc.querySelector('#gz-dash .gz-sr').textContent, /^Editing the layout/, 'said to a screen reader');
  assert.equal(p.doc.querySelector('.gz-sr').getAttribute('role'), 'status');
  // Drag notes by its heading: from (976+10, 130) to near the page's left edge and a grid line.
  const notes = p.tile('notes');
  notes.box = { left: 976, top: 120, width: 288, height: 200 };
  const head = notes.querySelector('.gz-w-head');
  head.dispatchEvent(p.ev('pointerdown', { target: head, clientX: 986, clientY: 130 }));
  head.dispatchEvent(p.ev('pointermove', { clientX: 200 + 20 + 10, clientY: 405 }));
  assert.deepEqual([px(notes.style.left), px(notes.style.top)], [W.EDGE, 400], 'onto the edge, and the grid');
  const guide = p.room().querySelector('.gz-guide');
  assert.ok(guide && !guide.hidden, 'a guide on the edge it met');
  head.dispatchEvent(p.ev('pointerup'));
  delete notes.box;
  const lay = W.layout(p.store.widgetLayout);
  const b = Object.fromEntries(lay.boards.courses.map((x) => [x.id, x]));
  assert.deepEqual([b.notes.x, b.notes.y, b.notes.r], [W.EDGE, 400, false], 'kept from the left');
  assert.deepEqual([b.timer.x, b.timer.r], [16, true], 'the other is fixed where it showed, from the right');
  assert.ok(b.notes.z > b.timer.z, 'the moved one on top');
  assert.equal(lay.widths.courses, 1080, 'and the room it was placed in, so a narrower one can tell it no longer fits');
  assert.deepEqual(lay.tiles, W.layout({ tiles: ONLY(['notes', 'timer']).tiles }).tiles, "Canvas's layout untouched");
  assert.ok(!p.room().querySelector('.gz-guide'), 'the guide goes when it lands');
  // A new page load: the same spots.
  const q = page({ local: p.store });
  q.ui.sync(true);
  await settle();
  assert.deepEqual([px(q.tile('notes').style.left), px(q.tile('notes').style.top)], [W.EDGE, 400]);
  assert.equal(px(q.tile('timer').style.left), 1080 - 16 - 288);
  // Alt: exactly where it is let go.
  const r = page({ local: p.store });
  r.ui.sync(true);
  await settle();
  r.doc.fire(r.doc.querySelector('.gz-dash-edit'), 'click');
  const n2 = r.tile('notes');
  n2.box = { left: 200 + W.EDGE, top: 400, width: 288, height: 200 };
  n2.querySelector('.gz-w-head').dispatchEvent(r.ev('pointerdown', { target: n2.querySelector('.gz-w-head'), clientX: 200 + W.EDGE + 5, clientY: 405 }));
  n2.querySelector('.gz-w-head').dispatchEvent(r.ev('pointermove', { clientX: 200 + 53 + 5, clientY: 405 + 7, altKey: true }));
  n2.querySelector('.gz-w-head').dispatchEvent(r.ev('pointerup'));
  assert.deepEqual([W.layout(r.store.widgetLayout).boards.courses[0].x, W.layout(r.store.widgetLayout).boards.courses[0].y], [53, 407]);
  // Done: said, and the controls go.
  r.doc.fire(r.doc.querySelector('.gz-dash-edit'), 'click');
  assert.equal(r.doc.querySelector('#gz-dash .gz-sr').textContent, 'Layout saved.');
  assert.equal(r.doc.querySelector('.gz-dash-reset').hidden, true);
});

test('Edit layout: the arrow keys on a handle move a grid step (Shift: four), say where, and keep the focus', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const grip = p.tile('notes').querySelector('.gz-w-grip');
  assert.equal(grip.getAttribute('aria-label'), 'Move Notes: arrow keys');
  grip.dispatchEvent(p.ev('keydown', { key: 'ArrowLeft' }));
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'not while not editing');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  grip.focus();
  grip.dispatchEvent(p.ev('keydown', { key: 'ArrowLeft' }));
  const after = () => Object.fromEntries(W.layout(p.store.widgetLayout).boards.courses.map((x) => [x.id, x]));
  assert.deepEqual([after().notes.x, after().notes.y, after().notes.r], [16 + W.GRID, 120, true], 'one grid step left (kept from the right)');
  assert.equal(p.doc.querySelector('#gz-dash .gz-sr').textContent, `Moved Notes: ${776 - W.GRID} px from the left, 120 px from the top`);
  assert.ok(p.doc.activeElement === p.tile('notes').querySelector('.gz-w-grip'), 'the handle keeps the focus');
  p.doc.activeElement.dispatchEvent(p.ev('keydown', { key: 'ArrowDown', shiftKey: true }));
  assert.equal(after().notes.y, 120 + 4 * W.GRID);
  // Reset layout: back where the panel was, said.
  p.doc.fire(p.doc.querySelector('.gz-dash-reset'), 'click');
  assert.ok(after().notes.x === null && after().timer.x === null);
  assert.equal(p.doc.querySelector('#gz-dash .gz-sr').textContent, 'Layout reset.');
  assert.equal(px(p.tile('notes').style.left), 776);
  // Esc ends editing.
  p.doc.getElementById('gz-dash').dispatchEvent(p.ev('keydown', { key: 'Escape' }));
  assert.equal(p.doc.querySelector('.gz-dash-edit').getAttribute('aria-pressed'), 'false');
});

test('a tile folds to its heading and is removed or added back while editing, on this board only', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const fold = p.tile('timer').querySelector('.gz-w-fold');
  assert.equal(fold.getAttribute('aria-expanded'), 'true');
  assert.equal(fold.getAttribute('aria-label'), 'Fold Focus timer');
  p.doc.fire(fold, 'click');
  assert.equal(p.tile('timer').querySelector('.gz-w-body').hidden, true);
  assert.equal(p.tile('timer').querySelector('.gz-w-fold').getAttribute('aria-expanded'), 'false');
  assert.ok(p.doc.activeElement === p.tile('timer').querySelector('.gz-w-fold'), 'the focus stays on it');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.doc.fire(p.tile('timer').querySelector('.gz-w-tools').children.find((x) => x.getAttribute('aria-label') === 'Remove Focus timer'), 'click');
  assert.ok(p.tile('timer') === null);
  const add = p.doc.querySelectorAll('#gz-dash .gz-dash-add button').find((x) => x.textContent === '+ Focus timer');
  assert.ok(add, 'offered back');
  p.doc.fire(add, 'click');
  assert.ok(p.tile('timer'));
  const lay = W.layout(p.store.widgetLayout);
  assert.equal(lay.boards.courses.find((x) => x.id === 'timer').fold, true, 'still folded');
  assert.ok(lay.boards.dash.find((x) => x.id === 'timer').on && !lay.boards.dash.find((x) => x.id === 'timer').fold, 'the Dashboard is its own');
});

test('a narrow window stacks the tiles in the panel, without touching the layout; a wide one puts them back', async () => {
  const kept = W.bset(W.layout(ONLY(['notes', 'timer'])), 'courses', 'notes', { x: 24, y: 400, r: false });
  const p = page({ width: 375, local: { widgetLayout: kept } });
  p.ui.sync(true);
  await settle();
  assert.ok(p.tile('notes').parentNode === p.grid(), 'in the panel, one under another');
  assert.equal(p.grid().getAttribute('data-stack'), '');
  assert.equal(p.tile('notes').style.left, undefined);
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'the layout is kept as it was');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.tile('notes').querySelector('.gz-w-grip').dispatchEvent(p.ev('keydown', { key: 'ArrowUp' }));
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'nothing moves while stacked');
  // Reading order, as they'd be laid out here: notes (kept at 400) before the timer (in free room at the column's top, under the courses).
  assert.deepEqual(p.grid().children.filter((x) => x.className === 'gz-w').map((x) => x.dataset.tile), ['notes', 'timer']);
  const q = page({ local: { widgetLayout: kept } });
  q.ui.sync(true);
  await settle();
  assert.ok(q.tile('notes').parentNode === q.room());
  assert.deepEqual([px(q.tile('notes').style.left), px(q.tile('notes').style.top)], [24, 400]);
});

test('Dashboard: its own board before Ultra\'s page, with tabs in the header that are a real tablist, the last one kept', async () => {
  const p = page({ at: 'dash' });
  p.ui.sync(true);
  await settle();
  const board = p.doc.getElementById('gz-dash');
  assert.ok(board.nextElementSibling === p.ip, "right before Ultra's own page");
  assert.equal(board.dataset.board, 'dash');
  // Canvas's Dashboard defaults, in rows from the top left.
  assert.deepEqual(board.querySelectorAll('section.gz-w').map((x) => x.dataset.tile), ['notes', 'agenda', 'timer', 'quotes']);
  assert.deepEqual([px(p.tile('notes').style.left), px(p.tile('notes').style.top)], [0, 0]);
  assert.ok(px(board.querySelector('.gz-dash-grid').style.height) >= 400, 'the room grows to hold them');
  const list = p.doc.querySelector('div.base-header-tools-transclude [role="tablist"]');
  assert.ok(list, "in the header's tools");
  const [dash, ip] = list.children;
  assert.deepEqual([dash.textContent, ip.textContent], ['Dashboard', 'Institution page']);
  assert.deepEqual([dash.getAttribute('role'), dash.getAttribute('aria-selected'), dash.tabIndex, ip.tabIndex], ['tab', 'true', 0, -1]);
  assert.equal(dash.getAttribute('aria-controls'), 'gz-dash');
  assert.equal(board.getAttribute('role'), 'tabpanel');
  assert.equal(p.doc.root.dataset.gzDash, 'dash', "Ultra's page hidden under it");
  // Arrow keys move and choose.
  list.dispatchEvent(p.ev('keydown', { key: 'ArrowRight' }));
  assert.equal(ip.getAttribute('aria-selected'), 'true');
  assert.ok(p.doc.activeElement === ip);
  assert.equal(board.hidden, true);
  assert.equal(p.doc.root.dataset.gzDash, 'ip', "Ultra's page shown, nothing over it");
  assert.equal(p.store.dashTab, 'ip', 'kept on this device');
  list.dispatchEvent(p.ev('keydown', { key: 'Home' }));
  assert.equal(board.hidden, false);
  p.doc.fire(ip, 'click');
  // The next visit opens on the last tab; the tabs are put back if Ultra redraws its header, once.
  const q = page({ at: 'dash', local: { dashTab: 'ip' } });
  q.ui.sync(true);
  await settle();
  assert.equal(q.doc.getElementById('gz-dash').hidden, true);
  q.doc.querySelector('[role="tablist"]').remove();
  q.ui.sync(true);
  q.ui.sync(true);
  assert.equal(q.doc.querySelectorAll('[role="tablist"]').length, 1);
  // Leaving the page takes the board and the tabs away.
  q.c.location.pathname = '/ultra/stream';
  q.ui.sync(true);
  assert.ok(q.doc.getElementById('gz-dash') === null);
  assert.equal(q.doc.querySelectorAll('[role="tablist"]').length, 0);
});

test('the boards are separate: moving a tile on the Dashboard leaves the Courses page as it was', async () => {
  const p = page({ at: 'dash' });
  p.ui.sync(true);
  await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.tile('timer').querySelector('.gz-w-grip').dispatchEvent(p.ev('keydown', { key: 'ArrowRight' }));
  const lay = W.layout(p.store.widgetLayout);
  assert.ok(lay.boards.dash.every((x) => !x.on || x.x !== null), 'the Dashboard fixed');
  assert.ok(lay.boards.courses.every((x) => x.x === null), 'the Courses page untouched');
});

test('landing: opt-in, from the start page once in a tab, never on a reload, never twice, through Ultra\'s own link', async () => {
  const go = async (o) => { const p = page({ at: 'courses', ...o }); vm.runInContext(read('features/dashboard.js'), p.c); await p.c.GZ_DASH_UI.land(o.from); await settle(); return p; };
  assert.deepEqual((await go({ from: '/ultra', path: '/ultra/stream' })).clicks, [], 'off by default');
  const on = { sync: { widgets: { land: true } } };
  const session = {};
  const p = await go({ ...on, from: '/ultra', path: '/ultra/stream', session });
  assert.deepEqual(p.clicks, ['/ultra/institution-page'], "on to the Dashboard, by Ultra's nav link");
  assert.equal(session['gz-landed'], '1');
  assert.equal(p.store.dashTab, 'dash', 'on its Dashboard tab');
  assert.deepEqual((await go({ ...on, from: '/ultra', path: '/ultra/stream', session })).clicks, [], 'once in this tab');
  assert.deepEqual((await go({ ...on, from: '/ultra', path: '/ultra/stream', nav: 'reload' })).clicks, [], 'not on a reload');
  assert.deepEqual((await go({ ...on, from: '/ultra', path: '/ultra/stream', nav: 'back_forward' })).clicks, [], 'nor Back');
  assert.deepEqual((await go({ ...on, from: '/ultra/calendar', path: '/ultra/calendar' })).clicks, [], 'a page asked for');
  assert.deepEqual((await go({ ...on, from: '/ultra', path: '/ultra/institution-page' })).clicks, [], 'there already');
  const blocked = await go({ ...on, from: '/ultra', path: '/ultra/stream', blocked: true });
  assert.deepEqual(blocked.clicks, [], "where it can't remember, it doesn't go");
});
