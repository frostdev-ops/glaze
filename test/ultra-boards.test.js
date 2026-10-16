// Blackboard Ultra's boards (B7b): features/widgets.js and features/dashboard.js on synthetic Courses, Institution and
// course pages built from docs/spikes/B7.md and B8.md (and B0's anchors), in a VM with the stand-in DOM laying the page
// out like Ultra at 1280 px: a 200 px nav, the page from 200 to 1280, the To Do column its last 320 px, a course's 94 px
// top bar. The tiles float in the page's layer at the column's top, the column makes room for them; Edit layout lets
// them move (pointer and keys, snapped, kept across a reload); a narrow window stacks them and keeps the layout; a tile
// can float over every page, once. Layout changes go to the worker as patches (lib/widgets.js change, here the real
// one on a shared store). The Dashboard's tabs, its To Do, and the landing.
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
// A layout saved since the Courses page's To Do became a tile (todo: true), so only these tiles are on.
const ONLY = (ids) => ({ todo: true, tiles: W.TILES.map((id) => ({ id, on: ids.includes(id) })) });
const queues = new WeakMap(); // store -> the worker's queue for the tabs that share it
const later = () => { let done; const p = new Promise((res, rej) => { done = { res, rej }; }); return Object.assign(p, done); };

// at: 'courses', 'dash' or 'outline' (a course's page: its top bar); width: the window's (narrow: Ultra puts the To Do
// column under the courses). store: one shared by two tabs. hold: { file: promise } for need(). header: false for a
// Dashboard page without the header's anchors. landed: the worker's tabs that landed; tab: this one's id.
// Elements are compared with ===: an assertion message would print the whole stand-in document.
const page = ({ at = 'courses', width = 1280, local = {}, store: shared = null, sync = {}, nav = 'navigate', path: where, hold = {}, header = true, landed = new Set(), tab = 1, acted = 0, history = 1, enhance = {}, holdReplies = false } = {}) => {
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
  const navEl = el('nav', 'MuiDrawer-paper', navLink);
  if (!narrow) navEl.box = { left: 0, top: 0, width: 200, height: 900 };
  doc.body.append(navEl);
  let ip = null, h1 = null;
  if (at === 'courses') {
    doc.body.append(el('section', 'base-courses-container route-view-container', el('div', 'base-courses-header-container', el('h1', 'page-title')),
      el('div', 'base-courses-content', el('div', 'courses-panel', el('div', 'base-courses')), el('div', 'todo-panel js-todo-panel-skip-link-target', el('bb-todo', 'react-container')))));
  } else if (at === 'dash') {
    h1 = el('h1', 'page-title', 'Institution Page');
    h1.id = 'main-heading';
    ip = el('institution-page-home', '', el('div', 'ip-app'));
    doc.body.append(el('main', '', el('section', 'institution-page-container route-view-container', ...(header ? [el('div', 'black-panel-header base-header', h1, el('div', 'base-header-tools-transclude'))] : []), ip)));
  } else {
    const bar = el('div', 'bb-course-navigation');
    bar.box = { left: left0, top: 0, width: W0, height: 94 };
    doc.body.append(el('div', 'course-content-container', el('div', 'panel-wrap', bar, el('section', 'course-outline-content'))));
  }
  // Ultra's layout, as the stand-in's boxes: the page's layer, the column's grid (Glaze's panel, 16 px in), a tile by its
  // size (200 px high), the Dashboard's room.
  doc.boxOf = (e) => {
    if (e.id === 'gz-room') return { left: left0, top: 0, width: W0, height: 0 };
    if (e.className === 'gz-dash-grid' && at === 'courses') return narrow ? { left: 16, top: 900, width: W0 - 32, height: 0 } : { left: width - 320 + 16, top: 120, width: 288, height: 0 };
    if (e.className === 'gz-dash-grid') return { left: left0 + 24, top: 140, width: W0 - 48, height: 400 };
    if (e.className === 'gz-w') return { left: px(e.style.left) || 0, top: px(e.style.top) || 0, width: W.WIDTH[e.dataset.size] || 288, height: 200 };
    if (/route-view-container/.test(e.className)) return { left: left0, top: 0, width: W0, height: 1600 };
    return null;
  };
  doc.fire = (target, type, { trusted = true } = {}) => { for (let p = target; p; p = p.parentNode) for (const l of p.listeners.filter((x) => x.type === type)) l.f({ type, target, isTrusted: trusted, preventDefault() {}, stopPropagation() {} }); };
  Object.assign(doc, { createElement: make, createTextNode: (data) => ({ data, textContent: data }), getElementById: (x) => doc.root.all().find((e) => e.id === x) || null,
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
    documentElement: doc.root, referrer: '' });
  const wrote = [], sent = [], loads = [], replies = [], listeners = [];
  const changed = (ch) => { for (const f of [...listeners]) f(ch, 'local'); };
  const settings = D.GZ_SANITIZE({ ...sync, enhance: { notes: true, widgets: true, ...enhance } });
  const store = shared || { ...structuredClone(local) };
  // The worker's side, as lib/background.js runs it: the layout's changes on what is stored (lib/widgets.js change).
  const area = {
    get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
    set: async (v) => { wrote.push(structuredClone(v)); Object.assign(store, structuredClone(v)); return true; },
  };
  // One at a time, as the worker's queue runs them (shared by the tabs sharing a store).
  if (!queues.has(store)) queues.set(store, { p: Promise.resolve() });
  const queue = queues.get(store);
  const worker = (m) => (queue.p = queue.p.then(() => run(m)));
  const run = async (m) => {
    if (m.type === 'glaze:widgetLayout') return W.change(m, area);
    if (m.type === 'glaze:landed') { if (landed.has(tab)) return { first: false }; landed.add(tab); return { first: true }; }
    return { ok: true, timer: W.IDLE };
  };
  const c = {
    // No clocks: the quote and the timer would keep the test's process alive.
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, setTimeout: () => 0, clearTimeout() {},
    document: doc, location: { origin: 'https://school.blackboard.test', pathname: where || { courses: '/ultra/course', dash: '/ultra/institution-page', outline: '/ultra/courses/_1_1/outline' }[at], href: 'https://school.blackboard.test/ultra', assign: (u) => clicks.push(`assign ${u}`) },
    innerWidth: width, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance: { getEntriesByType: () => [{ type: nav }] },
    history: { length: history },
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W,
    GZ_CTX: {
      site: 'ultra', t: (k, v) => (v ? k.replace(/\{(\w+)\}/g, (_, n) => v[n]) : k), locale: () => 'en', settings: () => settings, acted: () => (typeof acted === 'function' ? acted() : acted),
      need: async (f) => { loads.push(f); if (hold[f]) await hold[f]; if (f === 'features/dashboard.js' && !c.GZ_DASH_UI) vm.runInContext(read(f), c); },
    },
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, getURL: (p) => p, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => { sent.push(m); worker(m).then((r) => { if (holdReplies && m.type === 'glaze:widgetLayout') replies.push(() => cb?.(r)); else cb?.(r); }); } },
      storage: {
        local: { get: (keys, cb) => area.get(keys).then(cb), set: (v) => { area.set(v); } },
        sync: { get: (k, cb) => cb(structuredClone(sync)) },
        onChanged: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) },
      },
    },
  };
  c.globalThis = c;
  c.window = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('features/widgets.js'), c);
  const tile = (id) => doc.querySelector(`section[data-tile="${id}"]`);
  const ev = (type, x = {}) => ({ type, target: null, button: 0, pointerId: 1, clientX: 0, clientY: 0, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...x });
  const tool = (id, name) => tile(id).querySelector('.gz-w-tools').children.find((x) => x.getAttribute('aria-label') === name);
  return { ui, doc, c, store, wrote, sent, loads, clicks, ip, h1, tile, tool, ev, settings, replies, changed, room: () => doc.getElementById('gz-room'), grid: () => doc.querySelector('#gz-dash .gz-dash-grid'), floats: () => doc.getElementById('gz-float') };
};
const px = (v) => Number(String(v ?? '').replace('px', ''));
const lay = (p) => W.layout(p.store.widgetLayout);
const on = (p, b, id) => lay(p).boards[b].find((x) => x.id === id);

test('Courses page: the To Do is a widget, on from the start (an older layout too), and Ultra\'s own steps aside', async () => {
  const old = { tiles: W.TILES.map((id) => ({ id, on: id === 'notes' })), boards: { courses: W.TILES.map((id) => ({ id, on: id === 'notes' })) } };
  assert.equal(W.layout(old).boards.courses.find((x) => x.id === 'todo').on, true, 'an older layout: never the student\'s choice there');
  assert.equal(W.layout({ ...old, todo: true }).boards.courses.find((x) => x.id === 'todo').on, false, 'one saved since: kept');
  assert.equal(W.layout(W.layout(old)).boards.courses.find((x) => x.id === 'todo').on, true, 'the mark comes with the layout');
  const p = page({ local: { widgetLayout: old }, enhance: { todo: true } });
  p.ui.sync(true);
  await settle();
  const todo = p.tile('todo');
  assert.ok(todo && todo.parentNode === p.room(), 'a tile in the page\'s layer, like the others');
  assert.ok(todo.querySelector('.gz-w-todo-spot'), 'with the spot Better To Do goes before');
  assert.equal(p.doc.documentElement.hasAttribute('data-gz-todo-tile'), true, 'Ultra\'s own To Do steps aside');
  const q = page({ local: { widgetLayout: old }, enhance: { todo: false } });
  q.ui.sync(true);
  await settle();
  assert.equal(q.tile('todo'), null, 'Better To Do off: no tile, and Ultra\'s own To Do stays');
  assert.equal(q.doc.documentElement.hasAttribute('data-gz-todo-tile'), false);
});

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
  assert.equal(p.tile('todo'), null, 'a To Do the student took away stays away');
  // Not editing: a press on a heading moves nothing.
  notes.querySelector('.gz-w-head').dispatchEvent(p.ev('pointerdown', { target: notes.querySelector('.gz-w-head'), clientX: 1000, clientY: 130 }));
  notes.querySelector('.gz-w-head').dispatchEvent(p.ev('pointermove', { clientX: 400, clientY: 500 }));
  notes.querySelector('.gz-w-head').dispatchEvent(p.ev('pointerup'));
  await settle();
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
  await settle();
  const b = Object.fromEntries(lay(p).boards.courses.map((x) => [x.id, x]));
  assert.deepEqual([b.notes.x, b.notes.y, b.notes.r], [W.EDGE, 400, false], 'kept from the left');
  assert.deepEqual([b.timer.x, b.timer.r], [16, true], 'the other is fixed where it showed, from the right');
  assert.ok(b.notes.z > b.timer.z, 'the moved one on top');
  assert.equal(lay(p).widths.courses, 1080, 'and the room it was placed in, so a narrower one can tell it no longer fits');
  assert.deepEqual(lay(p).tiles, W.layout({ tiles: ONLY(['notes', 'timer']).tiles }).tiles, "Canvas's layout untouched");
  assert.ok(p.sent.every((m) => m.type !== 'glaze:widgetLayout' || Array.isArray(m.ops)), 'only changes go, never a whole layout');
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
  await settle();
  assert.deepEqual([on(r, 'courses', 'notes').x, on(r, 'courses', 'notes').y], [53, 407]);
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
  await settle();
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'not while not editing');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  grip.focus();
  grip.dispatchEvent(p.ev('keydown', { key: 'ArrowLeft' }));
  await settle();
  assert.deepEqual([on(p, 'courses', 'notes').x, on(p, 'courses', 'notes').y, on(p, 'courses', 'notes').r], [16 + W.GRID, 120, true], 'one grid step left (kept from the right)');
  assert.equal(p.doc.querySelector('#gz-dash .gz-sr').textContent, `Moved Notes: ${776 - W.GRID} px from the left, 120 px from the top`);
  assert.ok(p.doc.activeElement === p.tile('notes').querySelector('.gz-w-grip'), 'the handle keeps the focus');
  p.doc.activeElement.dispatchEvent(p.ev('keydown', { key: 'ArrowDown', shiftKey: true }));
  await settle();
  assert.equal(on(p, 'courses', 'notes').y, 120 + 4 * W.GRID);
  // Reset layout: back where the panel was, said.
  p.doc.fire(p.doc.querySelector('.gz-dash-reset'), 'click');
  await settle();
  assert.ok(on(p, 'courses', 'notes').x === null && on(p, 'courses', 'timer').x === null);
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
  p.doc.fire(p.tool('timer', 'Remove Focus timer'), 'click');
  assert.ok(p.tile('timer') === null);
  const add = p.doc.querySelectorAll('#gz-dash .gz-dash-add button').find((x) => x.textContent === '+ Focus timer');
  assert.ok(add, 'offered back');
  p.doc.fire(add, 'click');
  assert.ok(p.tile('timer'));
  await settle();
  assert.equal(on(p, 'courses', 'timer').fold, true, 'still folded');
  assert.ok(on(p, 'dash', 'timer').on && !on(p, 'dash', 'timer').fold, 'the Dashboard is its own');
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
  await settle();
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'nothing moves while stacked');
  // Reading order, as they'd be laid out here: notes (kept at 400) before the timer (in free room at the column's top, under the courses).
  assert.deepEqual(p.grid().children.filter((x) => x.className === 'gz-w').map((x) => x.dataset.tile), ['notes', 'timer']);
  const q = page({ local: { widgetLayout: kept } });
  q.ui.sync(true);
  await settle();
  assert.ok(q.tile('notes').parentNode === q.room());
  assert.deepEqual([px(q.tile('notes').style.left), px(q.tile('notes').style.top)], [24, 400]);
});

test("Dashboard: its own board before Ultra's page, headed Dashboard, with tabs in the header that are a real tablist, the last one kept", async () => {
  const p = page({ at: 'dash' });
  p.ui.sync(true);
  await settle();
  const board = p.doc.getElementById('gz-dash');
  assert.ok(board.nextElementSibling === p.ip, "right before Ultra's own page");
  assert.equal(board.dataset.board, 'dash');
  // Canvas's Dashboard defaults with Better To Do's tile (Codex B7b 5), none over another.
  assert.deepEqual(board.querySelectorAll('section.gz-w').map((x) => x.dataset.tile).sort(), ['agenda', 'notes', 'quotes', 'timer', 'todo']);
  assert.ok(p.tile('todo').querySelector('.gz-w-todo-spot'), "the place features/todo.js puts Better To Do's list");
  const boxes = board.querySelectorAll('section.gz-w').map((x) => ({ left: px(x.style.left), top: px(x.style.top), w: W.WIDTH[x.dataset.size], h: 200 }));
  for (const a of boxes) for (const b of boxes) if (a !== b) assert.ok(!(a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h), 'no overlap');
  assert.ok(px(board.querySelector('.gz-dash-grid').style.height) >= 400, 'the room grows to hold them');
  const list = p.doc.querySelector('div.base-header-tools-transclude [role="tablist"]');
  assert.ok(list, "in the header's tools");
  const [dash, ip] = list.children;
  assert.deepEqual([dash.textContent, ip.textContent], ['Dashboard', 'Institution page']);
  assert.deepEqual([dash.getAttribute('role'), dash.getAttribute('aria-selected'), dash.tabIndex, ip.tabIndex], ['tab', 'true', 0, -1]);
  assert.equal(dash.getAttribute('aria-controls'), 'gz-dash');
  assert.equal(board.getAttribute('role'), 'tabpanel');
  assert.equal(p.doc.root.dataset.gzDash, 'dash', "Ultra's page hidden under it");
  // Codex B7b 8: the page's heading says what the tab shows.
  assert.equal(p.h1.textContent, 'Dashboard');
  // Arrow keys move and choose.
  list.dispatchEvent(p.ev('keydown', { key: 'ArrowRight' }));
  assert.equal(ip.getAttribute('aria-selected'), 'true');
  assert.ok(p.doc.activeElement === ip);
  assert.equal(board.hidden, true);
  assert.equal(p.doc.root.dataset.gzDash, 'ip', "Ultra's page shown, nothing over it");
  assert.equal(p.h1.textContent, 'Institution Page', "Ultra's own heading back");
  await settle();
  assert.equal(p.store.dashTab, 'ip', 'kept on this device');
  list.dispatchEvent(p.ev('keydown', { key: 'Home' }));
  assert.equal(board.hidden, false);
  p.doc.fire(ip, 'click');
  await settle();
  // The next visit opens on the last tab; the tabs are put back if Ultra redraws its header, once.
  const q = page({ at: 'dash', local: { dashTab: 'ip' } });
  q.ui.sync(true);
  await settle();
  assert.equal(q.doc.getElementById('gz-dash').hidden, true);
  q.doc.querySelector('[role="tablist"]').remove();
  q.ui.sync(true);
  q.ui.sync(true);
  assert.equal(q.doc.querySelectorAll('[role="tablist"]').length, 1);
  // Leaving the page takes the board and the tabs away, and gives the heading back.
  q.doc.fire(q.doc.querySelector('[role="tab"]'), 'click');
  assert.equal(q.h1.textContent, 'Dashboard');
  q.c.location.pathname = '/ultra/stream';
  q.ui.sync(true);
  assert.ok(q.doc.getElementById('gz-dash') === null);
  assert.equal(q.doc.querySelectorAll('[role="tablist"]').length, 0);
  assert.equal(q.h1.textContent, 'Institution Page');
});

// Codex B7b 6 (P2 4): a header without its anchors still gets the tabs, so Ultra's page is never out of reach.
test('Dashboard: without the header, the tabs go right above the board', async () => {
  const p = page({ at: 'dash', header: false });
  p.ui.sync(true);
  await settle();
  const list = p.doc.querySelector('[role="tablist"]');
  assert.ok(list?.isConnected, 'a tablist on the page');
  assert.ok(list.nextElementSibling === p.doc.getElementById('gz-dash'), 'right above the board');
  list.dispatchEvent(p.ev('keydown', { key: 'End' }));
  assert.equal(p.doc.root.dataset.gzDash, 'ip', "and Ultra's page can be shown");
});

// Codex B7b 3: a Dashboard load that fails after the student moved on touches nothing of the next page.
test('a stale Dashboard load never hides the Courses page that came after it', async () => {
  const slow = later();
  const p = page({ at: 'dash', hold: { 'features/dashboard.js': slow } });
  p.ui.sync(true);
  await settle();
  p.c.location.pathname = '/ultra/course';
  const col = p.doc.createElement('div');
  col.className = 'todo-panel';
  p.doc.body.append(p.doc.createElement('section'));
  p.doc.body.lastElementChild.className = 'base-courses-container route-view-container';
  p.doc.body.lastElementChild.append(col);
  p.ui.sync(true);
  await settle();
  const grid = p.doc.querySelector('#gz-panel #gz-dash');
  assert.ok(grid, "the Courses page's grid");
  slow.rej(new Error('not loaded'));
  await settle();
  assert.equal(grid.hidden, false, 'still shown');
  assert.notEqual(p.doc.root.dataset.gzDash, 'ip');
});

test('the boards are separate: moving a tile on the Dashboard leaves the Courses page as it was', async () => {
  const p = page({ at: 'dash' });
  p.ui.sync(true);
  await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.tile('timer').querySelector('.gz-w-grip').dispatchEvent(p.ev('keydown', { key: 'ArrowRight' }));
  await settle();
  assert.ok(lay(p).boards.dash.every((x) => !x.on || x.x !== null), 'the Dashboard fixed');
  assert.ok(lay(p).boards.courses.every((x) => x.x === null), 'the Courses page untouched');
});

// Codex B7b 1: two tabs, each with the layout as it was when it started; neither undoes the other's change.
test('two tabs: a change in each, from the same stale layout, both kept', async () => {
  const store = { widgetLayout: W.layout(ONLY(['notes', 'timer'])) };
  const a = page({ store });
  const b = page({ at: 'dash', store });
  a.ui.sync(true);
  b.ui.sync(true);
  await settle();
  a.doc.fire(a.tile('notes').querySelector('.gz-w-fold'), 'click');
  await settle();
  // B hasn't heard of A's change (no storage event yet) when it folds its own timer.
  b.doc.fire(b.tile('timer').querySelector('.gz-w-fold'), 'click');
  await settle();
  const l = W.layout(store.widgetLayout);
  assert.equal(l.boards.courses.find((x) => x.id === 'notes').fold, true, "A's fold on the Courses page is kept");
  assert.equal(l.boards.dash.find((x) => x.id === 'timer').fold, true, "and B's on the Dashboard");
});

test('float on every page: one copy, clear of the nav and a course\'s top bar, kept apart from the page\'s layout, and back again', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.doc.fire(p.tool('notes', 'Float Notes on every Blackboard page'), 'click');
  await settle();
  assert.ok(p.tile('notes').parentNode === p.floats(), 'in the floating layer');
  assert.equal(p.doc.querySelectorAll('section[data-tile="notes"]').length, 1, 'once: not on the board too');
  assert.equal(on(p, 'pages', 'notes').on, true);
  assert.equal(on(p, 'courses', 'notes').on, true, 'its place on the Courses page kept for when it comes back');
  assert.match(p.doc.querySelector('#gz-dash .gz-sr').textContent, /Notes floats on every Blackboard page/);
  assert.ok(!p.doc.querySelectorAll('#gz-dash .gz-dash-add button').some((x) => x.textContent === '+ Notes'), 'not offered to the board while it floats');
  // Another Ultra page, a course's: it's there, right of the nav and below the course's top bar; the board isn't.
  const q = page({ at: 'outline', local: p.store });
  q.ui.sync(true);
  await settle();
  const n = q.tile('notes');
  assert.ok(n && n.parentNode === q.floats(), 'floating on a course page');
  assert.equal(q.tile('timer'), null, "the Courses page's tiles stay there");
  assert.ok(px(n.style.left) >= 200 + W.EDGE && px(n.style.top) >= 94 + W.EDGE, `clear of the nav and the top bar (${n.style.left}, ${n.style.top})`);
  assert.equal(px(n.style.left) + 288, 1280 - W.EDGE, 'at the right edge');
  // Moved by its handle: snapped, kept as where it is in the room, announced.
  n.querySelector('.gz-w-grip').focus();
  n.box = { left: px(n.style.left), top: px(n.style.top), width: 288, height: 200 };
  n.querySelector('.gz-w-grip').dispatchEvent(q.ev('keydown', { key: 'ArrowLeft' }));
  await settle();
  assert.ok(on(q, 'pages', 'notes').x < 1, 'kept as where in the room it is');
  assert.match(q.doc.querySelector('#gz-float .gz-sr').textContent, /^Moved Notes/);
  // Back: on a page without a board, to the Courses page's.
  q.doc.fire(q.tool('notes', 'Put Notes back on the Courses page'), 'click');
  await settle();
  assert.equal(q.tile('notes'), null);
  assert.equal(on(q, 'pages', 'notes').on, false);
  assert.equal(on(q, 'courses', 'notes').on, true);
  const r = page({ local: q.store });
  r.ui.sync(true);
  await settle();
  assert.ok(r.tile('notes').parentNode === r.room(), 'back on the Courses page');
});

test('migration: a tile that floated over every Ultra page before (B5) still does, at its place', async () => {
  const old = { tiles: ONLY(['timer']).tiles.map((x) => (x.id === 'music' ? { id: 'music', on: true, float: true, x: 0, y: 0 } : x)) };
  const p = page({ at: 'outline', local: { widgetLayout: old } });
  p.ui.sync(true);
  await settle();
  const m = p.tile('music');
  assert.ok(m && m.parentNode === p.floats(), 'floating');
  assert.deepEqual([px(m.style.left), px(m.style.top)], [200 + W.EDGE, 94 + W.EDGE], 'its old place, the top left of the room');
  assert.equal(p.tile('timer'), null);
});

test('landing: opt-in, once in a tab (the worker remembers it, not the page), never on a reload, never after the student moved', async () => {
  const go = async (o) => { const p = page({ at: 'courses', ...o }); vm.runInContext(read('features/dashboard.js'), p.c); await p.c.GZ_DASH_UI.land(o.from); await settle(); return p; };
  assert.deepEqual((await go({ from: '/ultra', path: '/ultra/stream' })).clicks, [], 'off by default');
  const opt = { sync: { widgets: { land: true } } };
  const landed = new Set();
  const p = await go({ ...opt, from: '/ultra', path: '/ultra/stream', landed });
  assert.deepEqual(p.clicks, ["/ultra/institution-page"], "on to the Dashboard, by Ultra's nav link");
  assert.ok(p.sent.some((m) => m.type === 'glaze:landed'), 'asked of the worker');
  assert.ok(!('sessionStorage' in p.c), 'nothing on the page');
  assert.equal(p.store.dashTab, 'dash', 'on its Dashboard tab');
  assert.equal(p.doc.root.dataset.gzDash, undefined, 'and nothing changed on this page');
  assert.deepEqual((await go({ ...opt, from: '/ultra', path: '/ultra/stream', landed })).clicks, [], 'once in this tab');
  assert.deepEqual((await go({ ...opt, from: '/ultra', path: '/ultra/stream', tab: 2, landed })).clicks, ['/ultra/institution-page'], 'another tab: its own once');
  assert.deepEqual((await go({ ...opt, from: '/ultra', path: '/ultra/stream', nav: 'reload' })).clicks, [], 'not on a reload');
  assert.deepEqual((await go({ ...opt, from: '/ultra', path: '/ultra/stream', nav: 'back_forward' })).clicks, [], 'nor Back');
  assert.deepEqual((await go({ ...opt, from: '/ultra/calendar', path: '/ultra/calendar' })).clicks, [], 'a page asked for');
  assert.deepEqual((await go({ ...opt, from: '/ultra', path: '/ultra/institution-page' })).clicks, [], 'there already');
  // Codex B7b 2: the landing waited for its library; meanwhile the student chose Courses (a click, a new history entry).
  const lib = later();
  const q = page({ at: 'courses', ...opt, path: '/ultra/stream', hold: { 'lib/widgets.js': lib } });
  vm.runInContext(read('features/dashboard.js'), q.c);
  const going = q.c.GZ_DASH_UI.land('/ultra');
  await settle();
  q.c.GZ_CTX.acted = () => 1;
  q.c.history.length = 2;
  q.c.location.pathname = '/ultra/course';
  lib.res();
  await going;
  await settle();
  assert.deepEqual(q.clicks, [], 'the page the student chose stays');
});

// The coordinator's decision: the Dashboard is on by default, its own switch (enhance.dashboard), whatever the widgets'.
test('the Dashboard is on by default with its own switch: its widgets and To Do with the others off, empty but for Add widget, or Ultra\'s page when off', async () => {
  const off = { notes: false, widgets: false, pet: false };
  assert.equal(D.GZ_DEFAULTS.enhance.dashboard, true, 'on by default');
  const p = page({ at: 'dash', enhance: off });
  p.ui.sync(true);
  await settle();
  assert.deepEqual(p.doc.querySelectorAll('#gz-dash section.gz-w').map((x) => x.dataset.tile).sort(), ['agenda', 'quotes', 'timer', 'todo'], "Canvas's defaults but the notes (their own switch, off)");
  // Every widget off: an empty board that says how to fill it, and Edit layout offers them.
  const none = { widgetLayout: { boards: { dash: W.TILES.map((id) => ({ id, on: false })) } } };
  const q = page({ at: 'dash', enhance: off, local: none });
  q.ui.sync(true);
  await settle();
  assert.equal(q.doc.querySelectorAll('#gz-dash section.gz-w').length, 0);
  assert.equal(q.doc.querySelector('#gz-dash .gz-dash-add').textContent, 'Nothing here yet. Edit layout adds widgets.');
  assert.equal(q.doc.root.dataset.gzDash, 'dash', "the Dashboard, not Ultra's page");
  assert.ok(q.doc.querySelector('[role="tablist"]'), 'with the Institution page one click away');
  q.doc.fire(q.doc.querySelector('.gz-dash-edit'), 'click');
  assert.deepEqual(q.doc.querySelectorAll('#gz-dash .gz-dash-add button').map((x) => x.textContent), ['+ Agenda', '+ Focus timer', '+ Quote', '+ Music', '+ Breathe', '+ Study buddy', '+ To Do']);
  // Switched off: no board, Ultra's page as it is (content-ultra.js doesn't ask for the board there either).
  const r = page({ at: 'dash', enhance: { ...off, dashboard: false, widgets: true } });
  r.ui.sync(true);
  await settle();
  assert.equal(r.doc.getElementById('gz-dash'), null);
  assert.equal(r.doc.querySelector('[role="tablist"]'), null);
});


test('layout callbacks arriving backwards cannot redraw an older fold or overwrite a newer storage event', async () => {
  const p = page({ holdReplies: true });
  p.ui.sync(true);
  await settle();
  p.doc.fire(p.tile('notes').querySelector('.gz-w-fold'), 'click');
  await settle();
  p.doc.fire(p.tile('notes').querySelector('.gz-w-fold'), 'click');
  await settle();
  assert.equal(on(p, 'courses', 'notes').fold, false);
  p.replies.pop()();
  p.replies.pop()();
  await settle();
  assert.equal(p.tile('notes').querySelector('.gz-w-fold').getAttribute('aria-expanded'), 'true', 'newest saved fold, not the last callback');
  // Another tab changes the layout while this one waits for its reply.
  p.doc.fire(p.tile('notes').querySelector('.gz-w-fold'), 'click');
  await settle();
  p.store.widgetLayout = W.apply(p.store.widgetLayout, { ops: [{ s: 'courses', id: 'notes', set: { fold: false } }] });
  p.changed({ widgetLayout: { newValue: p.store.widgetLayout } });
  p.replies.pop()();
  await settle();
  assert.equal(p.tile('notes').querySelector('.gz-w-fold').getAttribute('aria-expanded'), 'true', "the other tab's newer change is kept on screen too");
  p.doc.fire(p.tile('notes').querySelector('.gz-w-fold'), 'click');
  await settle();
  const get = p.c.chrome.storage.local.get;
  p.c.chrome.storage.local.get = (keys, cb) => { p.c.chrome.runtime.lastError = { message: 'unavailable' }; cb({}); p.c.chrome.runtime.lastError = undefined; };
  p.replies.pop()();
  await settle();
  assert.equal(p.tile('notes').querySelector('.gz-w-fold').getAttribute('aria-expanded'), 'false', 'a failed reread does not replace known state with defaults');
  p.c.chrome.storage.local.get = get;
  p.ui.sync(false);
  p.changed({ widgetLayout: { newValue: p.store.widgetLayout } });
  assert.equal(p.doc.getElementById('gz-dash'), null, 'a late layout never reopens a disabled UI');
});

test('landing rechecks current master and Dashboard settings after a delayed library or worker reply', async () => {
  for (const key of ['enabled', 'dashboard', 'land']) {
    const lib = later();
    const p = page({ sync: { widgets: { land: true } }, path: '/ultra/stream', hold: { 'lib/widgets.js': lib } });
    vm.runInContext(read('features/dashboard.js'), p.c);
    const going = p.c.GZ_DASH_UI.land('/ultra');
    await settle();
    if (key === 'enabled') p.settings.enabled = false;
    else if (key === 'dashboard') p.settings.enhance.dashboard = false;
    else p.settings.widgets.land = false;
    lib.res();
    await going;
    assert.deepEqual(p.clicks, [], key);
    assert.equal(p.store.dashTab, undefined, 'no stale preference write');
  }
});

test('leaving Dashboard preserves a heading Ultra has already repainted for the next route', async () => {
  const p = page({ at: 'dash' });
  p.ui.sync(true);
  await settle();
  assert.equal(p.h1.textContent, 'Dashboard');
  p.h1.textContent = 'Courses';
  p.c.location.pathname = '/ultra/course';
  p.ui.sync(false);
  assert.equal(p.h1.textContent, 'Courses', 'do not restore Institution Page over the new route');
});

test('global floats keep clear of an RTL right nav and B8 top strip without changing their saved placement', async () => {
  const p = page({ at: 'outline', local: { widgetLayout: { tiles: [{ id: 'notes', on: true, float: true, x: 1, y: 0 }] } } });
  p.doc.querySelector('.MuiDrawer-paper').box = { left: 1080, top: 0, width: 200, height: 900 };
  const tabs = p.doc.createElement('div');
  tabs.setAttribute('data-gz-keep-clear', '');
  tabs.box = { left: 0, top: 94, width: 1080, height: 48 };
  p.doc.body.append(tabs);
  p.ui.sync(true);
  await settle();
  assert.ok(px(p.tile('notes').style.left) + W.WIDTH.m <= 1080 - W.EDGE, 'right nav stays clear');
  assert.ok(px(p.tile('notes').style.top) >= 142 + W.EDGE, 'B8 strip stays clear');
  assert.equal(p.wrote.length, 0, 'no geometry saved just to fit');
});


test('Dashboard widgets floated explicitly remain available with legacy Widgets off, including the native tab', async () => {
  const p = page({ at: 'dash', enhance: { notes: false, widgets: false, pet: false } });
  p.ui.sync(true);
  await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.doc.fire(p.tool('timer', 'Float Focus timer on every Blackboard page'), 'click');
  await settle();
  p.doc.fire(p.doc.querySelectorAll('[role="tab"]')[1], 'click');
  assert.ok(p.tile('timer')?.parentNode === p.floats(), 'global tile remains on native Institution tab');
  assert.equal(p.doc.getElementById('gz-dash').hidden, true, 'only its Dashboard surface hides');
  const q = page({ at: 'outline', enhance: { notes: false, widgets: false, pet: false }, local: p.store });
  q.ui.sync(true);
  await settle();
  assert.ok(q.tile('timer')?.parentNode === q.floats(), 'explicit global timer remains on a course route');
  assert.equal(q.doc.querySelectorAll('section[data-tile="timer"]').length, 1);
});

test('an unavailable widget library fails open to the native Institution page', async () => {
  const lib = later();
  const p = page({ at: 'dash', hold: { 'lib/widgets.js': lib } });
  p.doc.root.setAttribute('data-gz-dash', '');
  p.ui.sync(true);
  lib.rej(Error('unavailable'));
  await settle();
  assert.equal(p.doc.root.dataset.gzDash, 'ip', 'native content is reachable after an inner lazy-load failure');
});

test('a keep-clear strip inserted after floats mount is measured on the next content pass', async () => {
  const p = page({ at: 'outline', local: { widgetLayout: { tiles: [{ id: 'notes', on: true, float: true, x: 0, y: 0 }] } } });
  p.ui.sync(true);
  await settle();
  const tabs = p.doc.createElement('div');
  tabs.setAttribute('data-gz-keep-clear', '');
  tabs.box = { left: 200, top: 94, width: 1080, height: 48 };
  p.doc.body.append(tabs);
  p.ui.sync(true);
  assert.ok(px(p.tile('notes').style.top) >= 142 + W.EDGE, 'new B8 strip is clear without a resize');
  tabs.remove();
  p.ui.sync(true);
  assert.equal(px(p.tile('notes').style.top), 94 + W.EDGE, 'removed strip releases its room without saving the layout');
});


test('landing works before the lazy widgets schema reaches content settings, and only follows a same-origin nav link', async () => {
  const p = page({ sync: { widgets: { land: true } }, path: '/ultra/stream' });
  delete p.settings.widgets;
  p.doc.querySelector('a').attrs.href = 'https://other.test/ultra/institution-page';
  vm.runInContext(read('features/dashboard.js'), p.c);
  await p.c.GZ_DASH_UI.land('/ultra');
  await settle();
  assert.deepEqual(p.clicks, ['assign https://school.blackboard.test/ultra/institution-page']);
});


test('a global widget returns to the enabled Dashboard when its Courses grid is disabled', async () => {
  const p = page({ at: 'outline', enhance: { notes: false, widgets: false, pet: false }, local: { widgetLayout: { boards: { pages: [{ id: 'timer', on: true }] } } } });
  p.ui.sync(true);
  await settle();
  const back = p.tool('timer', 'Put Focus timer back on the Dashboard');
  assert.ok(back, 'back control names the enabled destination');
  p.doc.fire(back, 'click');
  await settle();
  assert.equal(on(p, 'pages', 'timer').on, false);
  assert.equal(on(p, 'dash', 'timer').on, true);
  assert.equal(p.tile('timer'), null, 'left this course route');
  assert.match(p.doc.querySelector('#gz-float .gz-sr').textContent, /back on the Dashboard/);
  const q = page({ at: 'dash', enhance: { notes: false, widgets: false, pet: false }, local: p.store });
  q.ui.sync(true);
  await settle();
  assert.ok(q.tile('timer'), 'reachable at its named destination');
});


test('a global tile keyboard announcement uses its clamped margin, matching its visible position', async () => {
  const p = page({ at: 'outline', local: { widgetLayout: { tiles: [{ id: 'notes', on: true, float: true, x: 0, y: 0 }] } } });
  p.ui.sync(true);
  await settle();
  p.tile('notes').querySelector('.gz-w-grip').dispatchEvent(p.ev('keydown', { key: 'ArrowLeft' }));
  await settle();
  assert.equal(px(p.tile('notes').style.left), 200 + W.EDGE);
  assert.match(p.doc.querySelector('#gz-float .gz-sr').textContent, /12 px from the left, 12 px from the top/);
});

test('Reset layout never sends another school’s course tiles to this school’s broker', async () => {
  const old = ONLY(['notes']);
  old.boards = { courses: [{ id: 'course:https://other.test/_101_1', on: true, x: 320, y: 80 }] };
  const p = page({ local: { widgetLayout: old } }); p.ui.sync(true); await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  p.doc.fire(p.doc.querySelector('.gz-dash-reset'), 'click'); await settle();
  const reset = p.sent.filter((m) => m.type === 'glaze:widgetLayout').at(-1);
  assert.ok(reset.ops.every((x) => !W.course(x.id)), 'only this site’s tiles are changed');
  assert.equal(lay(p).boards.courses.find((x) => W.course(x.id)).x, 320, 'other school’s placement stays');
});
