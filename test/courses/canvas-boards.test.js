// Canvas's board on the stand-in DOM: the real page code and worker patches, with only geometry and transport supplied.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../../extension/content/defaults.js');
const W = require('../../extension/core/widgets.js');
const { El } = require('../stand-in-dom.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const only = (...ids) => ({ tiles: W.TILES.map((id) => ({ id, on: ids.includes(id) })) });
const px = (s) => parseFloat(s) || 0;

// student: a Canvas student's own course cards, for the board's course tiles read for real (courses/page/coursecards.js):
// { uid, native (the card ids Canvas's Dashboard draws), rows (its course list, or a promise of it), list (seenCourses) }.
// store: storage.local, shared by the pages of two students on one browser profile.
const page = ({ raw = only('notes', 'timer'), width = 1280, where = '/', enhance = {}, sidebar = null, student = null, store: shared = null } = {}) => {
  const doc = { activeElement: null }, make = (tag) => new El(tag, doc);
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body);
  const header = make('header'); header.id = 'dashboard_header_container';
  const gpa = make('section'); gpa.id = 'gz-gpa';
  const cards = make('div'); cards.id = 'DashboardCard_Container';
  const todo = make('aside'); todo.id = 'gz-todo';
  doc.body.append(header, gpa, cards, todo);
  const sent = [], loads = [], store = shared || { widgetLayout: structuredClone(raw) };
  let queue = Promise.resolve();
  const area = { get: async (ks) => Object.fromEntries([ks].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])), set: async (v) => { Object.assign(store, structuredClone(v)); return true; } };
  const c = {
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String,
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, removeEventListener() {},
    innerWidth: width, innerHeight: 900, location: { origin: 'https://board.instructure.com', pathname: where },
    document: doc, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W,
    GZ_CTX: { site: 'canvas', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v[n]), locale: () => 'en', settings: () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, ...enhance } }),
      profile: async () => ({ id: student?.uid || '3', time_zone: 'UTC' }),
      need: async (f) => { loads.push(f); if (student && f === 'courses/page/coursecards.js' && !c.GZ_COURSE_CARDS) vm.runInContext(read(f), c); },
      ...(student && { on: () => true, nickOf: () => '', courseList: () => student.list || {}, canvasCourses: () => Promise.resolve(student.rows) }) },
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, sendMessage: (m, cb) => { sent.push(m); queue = queue.then(() => m.type === 'glaze:widgetLayout' ? W.change(m, area) : { ok: true, timer: W.IDLE }); queue.then(cb); } },
      storage: { local: { get: (ks, cb) => area.get(ks).then(cb) }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {}, removeListener() {} } },
    },
  };
  doc.boxOf = (e) => {
    if (e.className === 'gz-dash-grid') return { left: 24, top: 140, width: c.innerWidth - 48, height: px(e.style.height) };
    if (e.className === 'gz-w-body') return { left: 0, top: 0, width: 200, height: e.hidden ? 0 : px(e.style.height) || 150 };
    if (e.className === 'gz-w') {
      const body = e.querySelector('.gz-w-body'), floating = e.hasAttribute('data-float');
      return { left: px(e.style.left) + (floating ? 0 : 24), top: px(e.style.top) + (floating ? 0 : 140), width: px(e.style.width) || W.WIDTH[e.dataset.size], height: 50 + (body.hidden ? 0 : px(body.style.height) || 150) };
    }
    return null;
  };
  doc.fire = (target, type) => { for (let e = target; e; e = e.parentNode) e.dispatchEvent({ type, target, preventDefault() {}, stopPropagation() {} }); };
  Object.assign(doc, { documentElement: doc.root, visibilityState: 'visible', createElement: make, createTextNode: (textContent) => ({ textContent }),
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: (id) => doc.root.all().find((e) => e.id === id), addEventListener() {}, removeEventListener() {} });
  if (sidebar) c.GZ_SIDEBAR_UI = sidebar;
  if (student) {
    // Canvas's own cards on its Dashboard, each a link to its course (what coursecards.js reads of them).
    const natives = (student.native || []).map((id) => { const e = make('div'); e.className = 'ic-DashboardCard'; const a = make('a'); a.setAttribute('href', `/courses/${id}`); e.append(a); return e; });
    cards.append(...natives);
    const all = doc.querySelectorAll;
    doc.querySelectorAll = (s) => (s === '.ic-DashboardCard:not([data-gz-tile-card])' ? natives : all(s));
    Object.assign(c, { GZ_COURSE_VARS: D.GZ_COURSE_VARS, GZ_CARD_UI: { paint() {} }, GZ_TODO: require('../../extension/planner/todo.js') });
  }
  c.globalThis = c; vm.createContext(c);
  const ui = vm.runInContext(read('core/page/widgets.js'), c);
  const tile = (id) => doc.querySelector(`section[data-tile="${id}"]`);
  const tool = (id, label) => tile(id).querySelector('.gz-w-tools').children.find((e) => e.getAttribute('aria-label') === label);
  const ev = (el, type, extra = {}) => el.dispatchEvent({ type, target: el, button: 0, pointerId: 1, clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {}, ...extra });
  const board = (id) => W.layout(store.widgetLayout).boards.cdash.find((x) => x.id === id);
  const float = (id) => W.layout(store.widgetLayout).tiles.find((x) => x.id === id);
  const edit = () => doc.fire(doc.querySelector('.gz-dash-edit'), 'click');
  const grid = () => doc.querySelector('.gz-dash-grid');
  ui.sync(true);
  return { ui, c, doc, store, sent, loads, tile, tool, ev, board, float, edit, grid, header, gpa, cards, todo };
};

test('Canvas migration: ordered board after the heading, before GPA/cards, with a Better To Do slot', async () => {
  const p = page({ raw: { tiles: [{ id: 'timer', on: true, size: 's' }, { id: 'notes', on: true, size: 'l' }, ...only().tiles.filter((x) => !['timer', 'notes'].includes(x.id))] } });
  await settle();
  assert.equal(p.header.nextElementSibling.id, 'gz-dash');
  assert.ok(p.cards.previousElementSibling === p.gpa && p.tile('todo').querySelector('.gz-w-todo-spot'));
  assert.equal(p.doc.querySelector('#gz-dash').dataset.board, 'cdash');
  assert.deepEqual(p.grid().children.map((x) => x.dataset.tile), ['timer', 'notes', 'todo']);
  assert.equal(p.tile('notes').style.width, '512px');
  assert.ok(px(p.grid().style.height) >= px(p.tile('notes').style.top) + 200 + W.GAP);
  assert.equal(p.doc.querySelector('#gz-room'), null);
  assert.ok(!p.loads.includes('courses/page/coursecards.js') && !p.loads.includes('courses/page/dashboard.js'));
  assert.equal(p.sent.filter((m) => m.type === 'glaze:widgetLayout').length, 0, 'reading does not rewrite storage');
  for (let i = 0; i < 3; i++) p.ui.sync(true);
  assert.equal(p.doc.querySelectorAll('#gz-dash').length, 1);
  const raw = only('notes', 'quotes', 'timer');
  for (const x of raw.tiles) if (['notes', 'quotes'].includes(x.id)) x.size = 'l';
  raw.tiles = ['notes', 'quotes', 'timer'].map((id) => raw.tiles.find((x) => x.id === id)).concat(raw.tiles.filter((x) => !['notes', 'quotes', 'timer'].includes(x.id)));
  const q = page({ raw, width: 948 }); await settle();
  assert.deepEqual(q.grid().children.map((x) => x.dataset.tile), ['notes', 'quotes', 'timer', 'todo'], 'migration follows the old stored order, including a later small tile');
});

test('Canvas Edit layout: body drag, threshold, guides, Alt, arrow keys, focus and every spot saved together', async () => {
  const p = page(); await settle();
  const n = p.tile('notes'), body = n.querySelector('.gz-w-body');
  p.edit();
  assert.equal(body.inert, true); assert.equal(n.getAttribute('tabindex'), '0');
  assert.ok(!n.querySelector('.gz-w-grip') && !n.querySelector('select') && !n.draggable);
  assert.equal(p.doc.querySelector('.gz-dash-edit').textContent, 'Done');
  const b = n.getBoundingClientRect();
  p.ev(n, 'pointerdown', { target: body, clientX: b.left + 10, clientY: b.top + 10 });
  p.ev(n, 'pointermove', { clientX: b.left + 12, clientY: b.top + 10 });
  assert.equal(n.dataset.dragging, undefined);
  p.ev(n, 'pointermove', { clientX: 24 + 22, clientY: 140 + 405 });
  assert.deepEqual([px(n.style.left), px(n.style.top)], [12, 400]);
  assert.ok(p.grid().querySelector('.gz-guide'));
  p.ev(n, 'pointerup'); await settle();
  assert.equal(p.board('notes').y, 400);
  assert.ok(p.board('timer').x !== null);
  assert.equal(p.store.widgetLayout.widths.cdash, 1232);
  assert.equal(p.grid().querySelector('.gz-guide'), null);
  p.ev(n, 'keydown', { key: 'ArrowDown', shiftKey: true }); await settle();
  assert.equal(p.board('notes').y, 464); assert.ok(p.doc.activeElement === n);
  assert.match(p.doc.querySelector('.gz-sr').textContent, /Moved Notes.*464 px/);
  const now = n.getBoundingClientRect();
  p.ev(n, 'pointerdown', { target: body, clientX: now.left + 5, clientY: now.top + 5 });
  p.ev(n, 'pointermove', { clientX: 24 + 58, clientY: 140 + 482, altKey: true });
  p.ev(n, 'pointerup'); await settle();
  assert.deepEqual([p.board('notes').x, p.board('notes').y], [53, 477]);
  const q = page({ raw: p.store.widgetLayout }); await settle();
  assert.deepEqual([q.tile('notes').style.left, q.tile('notes').style.top], ['53px', '477px']);
});

test('Canvas Reset layout resets saved courses before the card reader loads', async () => {
  const id = 'course:https://board.instructure.com/27';
  const p = page({ raw: { todo: true, canvasTodo: true, filled: ['cdash'], boards: { cdash: [...only().tiles, { id, on: true, x: 300, y: 120, w: 420, h: 220 }] } } });
  await settle();
  assert.equal(p.c.GZ_COURSE_CARDS, undefined, 'the lazy card reader has not loaded');
  p.edit();
  p.doc.fire(p.doc.querySelector('.gz-dash-reset'), 'click'); await settle();
  assert.deepEqual([p.board(id).x, p.board(id).y, p.board(id).w, p.board(id).h], [null, null, undefined, undefined]);
});

test('Canvas corner: pointer and keys resize, folded width resize keeps height, double-click restores own size', async () => {
  const p = page(); await settle(); p.edit();
  const n = p.tile('notes'), body = n.querySelector('.gz-w-body'), corner = n.querySelector('.gz-w-resize'), b = n.getBoundingClientRect();
  p.ev(corner, 'pointerdown', { clientX: b.right, clientY: b.bottom });
  p.ev(corner, 'pointermove', { clientX: b.right + 53, clientY: b.bottom + 97, altKey: true });
  p.ev(corner, 'pointerup'); await settle();
  assert.deepEqual([p.board('notes').w, p.board('notes').h], [437, 247]);
  assert.equal(body.style.height, '247px');
  p.ev(corner, 'keydown', { key: 'ArrowRight', shiftKey: true }); await settle();
  assert.equal(p.board('notes').w, 501);
  p.doc.fire(p.tool('notes', 'Fold Notes'), 'click'); await settle();
  assert.equal(body.hidden, true);
  p.ev(corner, 'keydown', { key: 'ArrowLeft' }); await settle();
  assert.deepEqual([p.board('notes').w, p.board('notes').h], [485, 247]);
  p.ev(corner, 'dblclick'); await settle();
  assert.equal(p.board('notes').w, undefined); assert.equal(p.board('notes').h, undefined);
  p.edit(); assert.equal(body.inert, false);
  p.doc.fire(p.tool('notes', 'Unfold Notes'), 'click'); await settle();
  assert.equal(body.hidden, false, 'Fold also works outside editing');
});

test('Canvas press raises without moving; Done, route change and disabling cancel pending gestures', async () => {
  const p = page(); await settle(); p.edit();
  const n = p.tile('notes'), t = p.tile('timer');
  p.ev(n, 'pointerdown'); p.ev(n, 'pointerup'); await settle();
  p.ev(t, 'pointerdown'); p.ev(t, 'pointerup'); await settle();
  assert.ok(p.board('timer').z > p.board('notes').z); assert.equal(p.board('timer').x, null);
  const saved = structuredClone(p.store.widgetLayout);
  p.ev(n, 'pointerdown'); p.ev(n, 'pointermove', { clientX: 40, clientY: 80 });
  p.edit(); p.ev(n, 'pointerup'); await settle();
  assert.deepEqual(p.store.widgetLayout, saved);
  assert.equal(p.grid().querySelector('.gz-guide'), null);
  p.edit();
  const corner = n.querySelector('.gz-w-resize');
  p.ev(corner, 'pointerdown'); p.ev(corner, 'pointermove', { clientX: 600, clientY: 400 });
  p.c.location.pathname = '/courses/1'; p.ui.sync(true); p.ev(corner, 'pointerup'); await settle();
  assert.deepEqual(p.store.widgetLayout, saved); assert.equal(p.doc.querySelector('#gz-dash'), null);
  p.c.location.pathname = '/'; p.ui.sync(true); await settle(); p.edit();
  const n2 = p.tile('notes');
  p.ev(n2, 'pointerdown'); p.ev(n2, 'pointermove', { clientX: 40, clientY: 80 });
  p.ui.sync(false); p.ev(n2, 'pointerup'); await settle();
  assert.deepEqual(p.store.widgetLayout, saved);
});

test('Canvas floats: legacy normalized spots, heading drag, body press raises, resize without editing and return off Dashboard', async () => {
  const raw = only(); raw.tiles[0] = { id: 'notes', on: true, float: true, x: 0.25, y: 0.5, w: 320, h: 180 };
  raw.tiles[2] = { id: 'timer', on: true, float: true, x: 0, y: 0 };
  const p = page({ raw, where: '/courses/1' }); await settle();
  const n = p.tile('notes'), body = n.querySelector('.gz-w-body'), b = n.getBoundingClientRect();
  assert.equal(b.left, W.spot(0.25, 0.5, 320, 230, 1280, 900).left);
  assert.equal(body.inert, false);
  p.ev(n, 'pointerdown', { target: body }); await settle();
  assert.ok(p.float('notes').z > p.float('timer').z);
  p.ev(n, 'pointermove', { clientX: 100, clientY: 100 });
  assert.equal(n.style.left, `${b.left}px`, 'body press raises but never drags');
  const corner = n.querySelector('.gz-w-resize');
  p.ev(corner, 'keydown', { key: 'ArrowRight' }); await settle();
  assert.equal(p.float('notes').w, 336);
  const now = n.getBoundingClientRect();
  p.ev(n, 'pointerdown', { target: n.querySelector('.gz-w-head'), clientX: now.left + 5, clientY: now.top + 5 });
  p.ev(n, 'pointermove', { clientX: 105, clientY: 205, altKey: true });
  p.ev(n, 'pointerup'); await settle();
  assert.equal(p.float('notes').x, W.place(100, 200, 336, 230, 1280, 900, true).x);
  assert.equal(p.store.widgetLayout.widths.canvas, 1280);
  const q = page({ raw: p.store.widgetLayout, where: '/courses/2' }); await settle();
  assert.equal(q.tile('notes').style.left, '100px');
  q.doc.fire(q.tool('notes', 'Put Notes back on the Dashboard'), 'click'); await settle();
  assert.equal(q.float('notes').float, false); assert.equal(q.board('notes').on, true);
  q.c.location.pathname = '/'; q.ui.sync(true); await settle();
  assert.ok(q.tile('notes').parentNode === q.grid());
});

test('Canvas floats carry the board size, keep the board spot, and Remove/Add/Reset touch only cdash', async () => {
  const p = page(); await settle(); p.edit();
  p.ev(p.tile('notes').querySelector('.gz-w-resize'), 'keydown', { key: 'ArrowRight' }); await settle();
  const kept = p.board('notes');
  p.doc.fire(p.tool('notes', 'Float Notes over every page'), 'click'); await settle();
  assert.equal(p.float('notes').w, kept.w); assert.equal(p.float('notes').h, kept.h);
  assert.equal(p.doc.querySelectorAll('section[data-tile="notes"]').length, 1);
  assert.ok(p.tile('notes').parentNode === p.doc.getElementById('gz-float'));
  p.doc.fire(p.tool('notes', 'Put Notes back on this page'), 'click'); await settle();
  assert.deepEqual(p.board('notes'), kept);
  p.doc.fire(p.tool('notes', 'Remove Notes'), 'click'); await settle(); assert.equal(p.tile('notes'), null);
  p.doc.fire(p.doc.querySelector('.gz-dash-add').children.find((x) => x.textContent === '+ Notes'), 'click'); await settle(); assert.ok(p.tile('notes'));
  const ultra = structuredClone(p.store.widgetLayout.boards.dash);
  p.doc.fire(p.doc.querySelector('.gz-dash-reset'), 'click'); await settle();
  assert.ok(p.store.widgetLayout.boards.cdash.every((x) => x.x === null && x.y === null && !x.w && !x.h && !x.fold && !x.z));
  assert.equal(p.store.widgetLayout.widths.cdash, 0); assert.deepEqual(p.store.widgetLayout.boards.dash, ultra);
});

test('Canvas zoom widths: relative block stays fixed, then flows, stacks only under a tile width, and restores', async () => {
  let raw = W.layout(only('notes', 'timer'));
  raw = W.apply(raw, { ops: [{ s: 'cdash', id: 'notes', set: { x: 80, y: 32 } }, { s: 'cdash', id: 'timer', set: { x: 240, y: 320 } }], widths: { cdash: 1232 } });
  const p = page({ raw }); await settle();
  const at = () => [p.tile('timer'), p.tile('notes')].map((e) => e.getBoundingClientRect());
  const original = at();
  p.c.innerWidth = 1000; p.edit();
  const block = at(); assert.equal(block[0].left - block[1].left, original[0].left - original[1].left);
  p.c.innerWidth = 500; p.edit();
  assert.equal(p.grid().hasAttribute('data-stack'), false, 'room 452: each tile fits, so flow');
  p.c.innerWidth = 375; p.edit(); assert.equal(p.grid().hasAttribute('data-stack'), true);
  assert.deepEqual(p.store.widgetLayout, raw, 'zoom never rewrites saved spots');
  p.c.innerWidth = 1280; p.edit(); assert.equal(p.grid().hasAttribute('data-stack'), false);
  assert.deepEqual(at(), original);
});

test('Canvas notes-only floats keep the widgets loader on course pages, without loading in child frames', async () => {
  const calls = [], loads = [];
  const c = { document: { addEventListener() {} }, addEventListener() {}, location: { pathname: '/courses/25' },
    GZ_WIDGETS_UI: { sync: (v) => calls.push(v) } };
  c.globalThis = c; c.window = c; c.top = c;
  vm.createContext(c);
  const factory = vm.runInContext(read('content/content-canvas.js'), c);
  const I = { settings: { enhance: { notes: true, widgets: false, pet: false } }, links: [1], need: async (file) => loads.push(file) };
  const site = factory(I);
  site.syncWidgets(); await settle();
  assert.deepEqual(calls, [true]); assert.deepEqual(loads, ['core/page/widgets.js']);
  c.top = {}; site.syncWidgets(); await settle(); assert.equal(calls.at(-1), false);
  c.top = c; I.settings.enhance.notes = false; site.syncWidgets(); await settle(); assert.equal(calls.at(-1), false);
});


test('Canvas edit controls stay below the room and reserve the toolbar width', async () => {
  const p = page(); await settle();
  const grid = p.grid(), add = p.doc.querySelector('.gz-dash-add'), edit = p.doc.querySelector('.gz-dash-edit');
  edit.box = { left: 0, top: 0, width: 104.5, height: 28 };
  Object.defineProperty(edit, 'offsetWidth', { value: 104 });
  assert.ok(grid.nextElementSibling === add, 'Add cannot push the room down');
  p.edit();
  assert.ok(add.children.length, 'the Add row is populated while editing');
  assert.equal(edit.style.minWidth, '104.5px', 'Done keeps the Edit layout width');
  p.edit();
  assert.equal(edit.style.minWidth, '104.5px');
  assert.match(read('core/page/apps.css'), /\.gz-dash-reset\[hidden\]\s*\{[^}]*visibility:\s*hidden[^}]*display:\s*inline-flex\s*!important/, 'Reset keeps its space without remaining interactive');
});

test('with the sidebar switched off, the Dashboard board is as it was, even with the sidebar\'s code in the page', async () => {
  const sidebar = { active: () => true, failed: () => false, ready: async () => true, on() {}, rec: () => ({ dest: { notes: 'dock' }, dock: [{ id: 'notes' }], fold: {}, ret: {} }), host: () => null, drawn() {}, op() { throw new Error('no sidebar op'); } };
  const p = page({ enhance: { sidebar: false }, sidebar });
  await settle();
  assert.deepEqual(p.grid().children.map((x) => x.dataset.tile), ['notes', 'timer', 'todo'], 'the docked note stays on the board');
  p.edit();
  assert.ok(p.tool('notes', 'Float Notes over every page') && p.tool('notes', 'Remove Notes'), 'the board\'s own Float and Remove');
  assert.equal(p.tile('notes').querySelector('.gz-w-dest'), null, 'no destination menu');
  assert.equal(p.doc.root.hasAttribute('data-gz-sidebar-todo'), false);
});

// ---- two students on one browser profile (audit 2026-11-11 N1) ----
const HOST = 'https://board.instructure.com', key = (id) => `course:${HOST}/${id}`;
const courses = (lay) => W.layout(lay).boards.cdash.filter((x) => W.course(x.id)).map((x) => W.course(x.id).id);
const row = (id, name) => ({ id, name, course_code: name.slice(0, 4) });

test("Canvas's Dashboard never draws another student's course cards on a shared profile, and the next student gets their own first cards once", async () => {
  const store = { widgetLayout: W.fresh() };
  // Student A fills the Dashboard first.
  const a = page({ store, student: { uid: '3', native: ['5', '6'], rows: [row('5', 'Art A'), row('6', 'Bio A')] } });
  await settle(); a.ui.sync(true); await settle();
  assert.deepEqual(courses(store.widgetLayout), ['5', '6']);
  assert.ok(store.widgetLayout.filled.includes(`cdash ${HOST}/3`), "A's own fill mark");
  // Student B signs in on the same profile: A's courses are still in the device's course list.
  const list = { [`canvas:${HOST}/5`]: { name: 'Art A', canvas: true }, [`canvas:${HOST}/6`]: { name: 'Bio A', canvas: true } };
  const b = page({ store, student: { uid: '4', native: ['7'], rows: [row('7', 'Chem B')], list } });
  await settle(); b.ui.sync(true); await settle(); b.ui.sync(true); await settle();
  assert.equal(b.tile(key('5')), null, "A's card is not drawn for B");
  assert.equal(b.tile(key('6')), null);
  assert.ok(b.tile(key('7')), "B's first card");
  assert.deepEqual(courses(store.widgetLayout), ['5', '6', '7'], "A's cards stay in the layout for A");
  assert.ok(store.widgetLayout.filled.includes(`cdash ${HOST}/4`), "B's own fill mark");
  // The Course cards dialog lists only B's courses.
  assert.deepEqual(JSON.parse(JSON.stringify(b.c.GZ_COURSE_CARDS.list().map((x) => x.id))), ['7']);
  // A comes back: A's cards, never B's.
  const again = page({ store, student: { uid: '3', native: ['5', '6'], rows: [row('5', 'Art A'), row('6', 'Bio A')] } });
  await settle(); again.ui.sync(true); await settle();
  assert.ok(again.tile(key('5')) && again.tile(key('6')));
  assert.equal(again.tile(key('7')), null);
});

test("while a Canvas student's course list is on its way, their own cards draw at once; a failed list hides nothing", async () => {
  const store = { widgetLayout: { todo: true, canvasTodo: true, filled: ['cdash'], boards: { cdash: [{ id: key('5'), on: true }, { id: key('7'), on: true }] } } };
  const list = { [`canvas:${HOST}/5`]: { name: 'Art', canvas: true }, [`canvas:${HOST}/7`]: { name: 'Chem', canvas: true } };
  let answer;
  const p = page({ store, student: { uid: '4', native: [], rows: new Promise((r) => { answer = r; }), list } });
  await settle(); p.ui.sync(true); await settle();
  assert.ok(p.tile(key('5')) && p.tile(key('7')), 'no wait for the list');
  assert.equal(p.c.GZ_COURSE_CARDS.own(key('7')), undefined);
  answer(Object.assign([], { complete: false })); await settle(); p.ui.sync(true); await settle();
  assert.ok(p.tile(key('5')) && p.tile(key('7')), 'a failed read says nothing about whose a course is');
});

test("a complete Canvas course list removes another student's drawn card even when no course metadata changes", async () => {
  const store = { widgetLayout: { todo: true, canvasTodo: true, filled: ['cdash'], boards: { cdash: [{ id: key('5'), on: true }] } } };
  let answer;
  const p = page({ store, student: { uid: '4', native: [], rows: new Promise((r) => { answer = r; }), list: { [`canvas:${HOST}/5`]: { name: 'Previous student', canvas: true } } } });
  await settle();
  assert.ok(p.tile(key('5')), 'the kept card draws while ownership is unknown');
  answer([]);
  await settle();
  assert.equal(p.c.GZ_COURSE_CARDS.own(key('5')), false, 'the completed list rejects the old course');
  assert.equal(p.tile(key('5')), null, 'ownership alone redraws the board without a later page or storage event');
});
