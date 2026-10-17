// Blackboard Ultra's boards (B7b): features/widgets.js and features/dashboard.js on synthetic Courses, Institution and
// course pages built from the B7 and B8 spikes (and B0's anchors), in a VM with the stand-in DOM laying the page
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
const K = require('../lib/cards.js');
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
// courses: the student's courses ({ id, name, code, term, slot }), with the board's course cards, their dialog and the card
// painter and editor loaded for real (features/coursecards.js, features/cards.js, lib/cards.js), their styles saved by
// the worker's lib/cards.js ultraChange into `sync` and this computer's `local`.
// Elements are compared with ===: an assertion message would print the whole stand-in document.
const page = ({ at = 'courses', width = 1280, local = {}, store: shared = null, sync = {}, nav = 'navigate', path: where, hold = {}, header = true, landed = new Set(), tab = 1, acted = 0, history = 1, enhance = {}, holdReplies = false, courses = null } = {}) => {
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
    // The courses' own column, where a board's course cards go first (left of the To Do column; narrow, the page's width).
    if (e.className === 'base-courses') return narrow ? { left: 0, top: 120, width: W0, height: 600 } : { left: left0, top: 120, width: W0 - 320, height: 600 };
    return null;
  };
  doc.fire = (target, type, { trusted = true } = {}) => { for (let p = target; p; p = p.parentNode) for (const l of p.listeners.filter((x) => x.type === type)) l.f({ type, target, isTrusted: trusted, preventDefault() {}, stopPropagation() {} }); };
  Object.assign(doc, { createElement: make, createTextNode: (data) => ({ data, textContent: data }), getElementById: (x) => doc.root.all().find((e) => e.id === x) || null,
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
    documentElement: doc.root, referrer: '' });
  const wrote = [], sent = [], loads = [], replies = [], listeners = [];
  const changed = (ch, a = 'local') => { for (const f of [...listeners]) f(ch, a); };
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
  // The cards' items, as chrome.storage has them: a write is heard by every listener, as storage.onChanged does.
  const items = (s, a) => ({
    get: async (keys) => structuredClone(keys === null ? s : Object.fromEntries([keys].flat().filter((k) => k in s).map((k) => [k, s[k]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); changed(Object.fromEntries(Object.keys(v).map((k) => [k, { newValue: v[k] }])), a); return true; },
    remove: async (keys) => { for (const k of [keys].flat()) delete s[k]; return true; },
  });
  const cardArea = { sync: items(sync, 'sync'), local: items(store, 'local') };
  const run = async (m) => {
    if (m.type === 'glaze:widgetLayout') return W.change(m, area);
    if (m.type === 'glaze:cards') return K.ultraChange(m, cardArea);
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
      need: async (f) => {
        loads.push(f); if (hold[f]) await hold[f];
        const name = { 'features/dashboard.js': 'GZ_DASH_UI', ...(courses && { 'features/coursecards.js': 'GZ_COURSE_CARDS', 'features/cards.js': 'GZ_CARD_UI', 'lib/cards.js': 'GZ_CARDS' }) }[f];
        if (name && !c[name]) vm.runInContext(read(f), c);
      },
      ...(courses && {
        on: () => true, nickOf: () => '', courseColor: () => null, courseColors: () => ({}),
        courseList: () => Object.fromEntries(courses.map((x) => [x.id, { name: x.name, code: x.code, site: 'https://school.blackboard.test', slot: String(x.slot) }])),
        canvasPeek: () => ({ me: null, books: new Map(), courses: Promise.resolve(courses.map((x) => ({ courseId: x.id, courseCardColorIndex: x.slot - 1, course: { name: x.name, courseId: x.code, term: { name: x.term } } }))) }),
      }),
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
  if (courses) {
    // What the card painter and its editor use of the page; Glaze is on (data-gz-motion), so cards wear their styles.
    Object.assign(c, { top: c, GZ_COURSE_VARS: D.GZ_COURSE_VARS, MutationObserver: class { observe() {} }, TextEncoder, crypto, structuredClone,
      Option: class extends El { constructor(text, value) { super('option', doc); this.textContent = text; this.value = value; } } });
    c.GZ_I18N.num = (n) => String(n);
    doc.createElementNS = (ns, t) => make(t);
    // A picture: a file the browser can't read is refused; a readable one is drawn on a canvas and kept as a data URL.
    c.createImageBitmap = async (f) => { if (!f.picture) throw new Error('not a picture'); return { width: 3000, height: 1500, close() {} }; };
    doc.createElement = (t) => Object.assign(make(t), t === 'canvas' && { getContext: () => ({ drawImage() {} }), toDataURL: (type) => `data:${type};base64,${'A'.repeat(800)}` });
    doc.root.setAttribute('data-gz-motion', 'calm');
  }
  vm.createContext(c);
  if (courses) vm.runInContext(read('lib/color.js'), c);
  const ui = vm.runInContext(read('features/widgets.js'), c);
  const tile = (id) => doc.querySelector(`section[data-tile="${id}"]`);
  const ev = (type, x = {}) => ({ type, target: null, button: 0, pointerId: 1, clientX: 0, clientY: 0, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...x });
  const tool = (id, name) => tile(id).querySelector('.gz-w-tools').children.find((x) => x.getAttribute('aria-label') === name);
  return { ui, doc, c, store, syncStore: sync, wrote, sent, loads, clicks, ip, h1, tile, tool, ev, settings, replies, changed, room: () => doc.getElementById('gz-room'), grid: () => doc.querySelector('#gz-dash .gz-dash-grid'), floats: () => doc.getElementById('gz-float') };
};
const px = (v) => Number(String(v ?? '').replace('px', ''));
const lay = (p) => W.layout(p.store.widgetLayout);
const sync = (p) => p.syncStore;
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
  // Editing: each tile is a thing to move: no handle and no size picker, its content waiting, the tile itself in the Tab
  // order, and a corner to resize it by.
  const notes = p.tile('notes');
  assert.ok(!notes.querySelector('.gz-w-grip') && !notes.querySelector('.gz-w-size'), 'no handle, no size picker');
  assert.equal(notes.querySelector('.gz-w-body').inert, true, 'its content waits');
  assert.equal(notes.getAttribute('tabindex'), '0');
  assert.equal(notes.querySelector('.gz-w-resize').getAttribute('aria-label'), 'Resize Notes: arrow keys');
  // Drag notes anywhere on it (here its body): from (976+10, 130) to near the page's left edge and a grid line.
  notes.box = { left: 976, top: 120, width: 288, height: 200 };
  notes.dispatchEvent(p.ev('pointerdown', { target: notes.querySelector('.gz-w-body'), clientX: 986, clientY: 130 }));
  notes.dispatchEvent(p.ev('pointermove', { clientX: 200 + 20 + 10, clientY: 405 }));
  assert.deepEqual([px(notes.style.left), px(notes.style.top)], [W.EDGE, 400], 'onto the edge, and the grid');
  const guide = p.room().querySelector('.gz-guide');
  assert.ok(guide && !guide.hidden, 'a guide on the edge it met');
  notes.dispatchEvent(p.ev('pointerup'));
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
  n2.dispatchEvent(r.ev('pointerdown', { target: n2.querySelector('.gz-w-head'), clientX: 200 + W.EDGE + 5, clientY: 405 }));
  n2.dispatchEvent(r.ev('pointermove', { clientX: 200 + 53 + 5, clientY: 405 + 7, altKey: true }));
  n2.dispatchEvent(r.ev('pointerup'));
  await settle();
  assert.deepEqual([on(r, 'courses', 'notes').x, on(r, 'courses', 'notes').y], [53, 407]);
  // Done: said, and the controls go.
  r.doc.fire(r.doc.querySelector('.gz-dash-edit'), 'click');
  assert.equal(r.doc.querySelector('#gz-dash .gz-sr').textContent, 'Layout saved.');
  assert.equal(r.doc.querySelector('.gz-dash-reset').hidden, true);
});

test('Edit layout: the arrow keys on a tile move it a grid step (Shift: four), say where, and keep the focus', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const grip = p.tile('notes');
  assert.equal(grip.getAttribute('tabindex'), null, 'not in the Tab order while not editing');
  grip.dispatchEvent(p.ev('keydown', { key: 'ArrowLeft', target: grip }));
  await settle();
  assert.ok(!p.wrote.some((w) => w.widgetLayout), 'not while not editing');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  assert.equal(grip.getAttribute('aria-description'), 'Drag to move, or use the arrow keys');
  grip.focus();
  grip.dispatchEvent(p.ev('keydown', { key: 'ArrowLeft', target: grip }));
  await settle();
  assert.deepEqual([on(p, 'courses', 'notes').x, on(p, 'courses', 'notes').y, on(p, 'courses', 'notes').r], [16 + W.GRID, 120, true], 'one grid step left (kept from the right)');
  assert.equal(p.doc.querySelector('#gz-dash .gz-sr').textContent, `Moved Notes: ${776 - W.GRID} px from the left, 120 px from the top`);
  assert.ok(p.doc.activeElement === p.tile('notes'), 'the tile keeps the focus');
  p.doc.activeElement.dispatchEvent(p.ev('keydown', { key: 'ArrowDown', shiftKey: true, target: p.tile('notes') }));
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

test('Edit layout: a tile resized by its corner (snapped, kept, its left edge where it was; arrow keys; a double-click undoes it)', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const notes = p.tile('notes'), corner = notes.querySelector('.gz-w-resize'), body = notes.querySelector('.gz-w-body');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  // Notes (Ultra's column: 776 in the room, 120 down) from 288 × 200, its heading and padding 50 of that, to near the
  // room's right edge and a grid line.
  notes.box = { left: 976, top: 120, width: 288, height: 200 };
  body.box = { left: 976, top: 160, width: 288, height: 150 };
  corner.dispatchEvent(p.ev('pointerdown', { target: corner, clientX: 1264, clientY: 320 }));
  corner.dispatchEvent(p.ev('pointermove', { clientX: 1270, clientY: 423 }));
  assert.deepEqual([notes.style.width, body.style.height], [`${1080 - W.EDGE - 776}px`, `${416 - 120 - 50}px`], 'onto the edge and the grid, as it goes');
  corner.dispatchEvent(p.ev('pointerup'));
  await settle();
  let n = on(p, 'courses', 'notes');
  assert.deepEqual([n.w, n.h, n.x, n.y, n.r], [292, 246, W.EDGE, 120, true], 'kept: its width, its body\'s height, and its spot');
  assert.ok(n.z > on(p, 'courses', 'timer').z, 'on top');
  assert.equal(notes.style.width, '292px');
  assert.equal(body.style.height, '246px');
  // The arrow keys on its corner: a grid step (Shift: four), its left edge where it was, said.
  notes.box = { left: 976 - 4, top: 120, width: 292, height: 296 };
  body.box = { left: 976 - 4, top: 160, width: 292, height: 246 };
  corner.focus();
  corner.dispatchEvent(p.ev('keydown', { key: 'ArrowLeft', shiftKey: true, target: corner }));
  await settle();
  n = on(p, 'courses', 'notes');
  assert.deepEqual([n.w, n.h, 1080 - n.x - n.w], [292 - 64, 246, 776], 'narrower, the left edge kept');
  assert.equal(p.doc.querySelector('#gz-dash .gz-sr').textContent, 'Resized Notes: 228 by 296 px');
  assert.ok(p.doc.activeElement === corner, 'the corner keeps the focus');
  // A double-click: its own size again.
  corner.dispatchEvent(p.ev('dblclick', { target: corner }));
  await settle();
  n = on(p, 'courses', 'notes');
  assert.ok(!('w' in n) && !('h' in n));
  assert.equal(body.style.height, '');
  assert.equal(p.doc.querySelector('#gz-dash .gz-sr').textContent, 'Notes is its own size again.');
});

test('Edit layout: the tile pressed comes to the front, moved or not; a press that wanders a pixel moves nothing', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } });
  p.ui.sync(true);
  await settle();
  const timer = p.tile('timer');
  const press = (el, wander = 0) => {
    el.dispatchEvent(p.ev('pointerdown', { target: el.querySelector('.gz-w-head'), clientX: 1000, clientY: 400 }));
    if (wander) el.dispatchEvent(p.ev('pointermove', { clientX: 1000 + wander, clientY: 400 }));
    el.dispatchEvent(p.ev('pointerup'));
  };
  press(timer);
  await settle();
  assert.ok(!p.sent.some((m) => m.type === 'glaze:widgetLayout'), 'not while not editing');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  press(timer, 2);
  await settle();
  assert.ok(on(p, 'courses', 'timer').z > on(p, 'courses', 'notes').z, 'on top');
  assert.equal(on(p, 'courses', 'timer').x, null, 'not moved');
  assert.ok(p.doc.activeElement === timer, 'and it has the focus, for the arrow keys');
  assert.ok(+timer.style.zIndex > +p.tile('notes').style.zIndex);
  const sent = p.sent.length;
  press(timer);
  await settle();
  assert.equal(p.sent.length, sent, 'on top already: nothing to change');
  press(p.tile('notes'));
  await settle();
  assert.ok(on(p, 'courses', 'notes').z > on(p, 'courses', 'timer').z, 'the other one, pressed, in front');
  // Its controls are its own: pressing Remove neither raises nor moves it.
  const z = on(p, 'courses', 'timer').z;
  timer.dispatchEvent(p.ev('pointerdown', { target: p.tool('timer', 'Remove Focus timer'), clientX: 1000, clientY: 400 }));
  assert.equal(on(p, 'courses', 'timer').z, z);
});

test('a floating tile resizes by its corner at any time, kept as floating', async () => {
  const q = page({ at: 'outline', local: { widgetLayout: { tiles: [{ id: 'notes', on: true, float: true, x: 0, y: 0 }] } } });
  q.ui.sync(true);
  await settle();
  const n = q.tile('notes'), corner = n.querySelector('.gz-w-resize');
  assert.ok(corner, 'its corner');
  assert.equal(n.querySelector('.gz-w-body').inert, false, 'its content works');
  n.box = { left: 212, top: 106, width: 384, height: 200 };
  n.querySelector('.gz-w-body').box = { left: 212, top: 146, width: 384, height: 150 };
  corner.dispatchEvent(q.ev('pointerdown', { target: corner, clientX: 596, clientY: 306 }));
  corner.dispatchEvent(q.ev('pointermove', { clientX: 496, clientY: 356 }));
  corner.dispatchEvent(q.ev('pointerup'));
  await settle();
  const x = on(q, 'pages', 'notes');
  assert.deepEqual([x.w, x.h], [304 - W.EDGE, 256 - W.EDGE - 50]);
  assert.equal(n.style.width, `${304 - W.EDGE}px`);
});

test('a corner resize at fractional page coordinates keeps a whole-pixel size across reload', async () => {
  const p = page({ local: { widgetLayout: ONLY(['notes']) } });
  p.ui.sync(true); await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  const n = p.tile('notes'), body = n.querySelector('.gz-w-body'), corner = n.querySelector('.gz-w-resize');
  n.box = { left: 976.5, top: 120.25, width: 288, height: 200 };
  body.box = { left: 976.5, top: 160.25, width: 288, height: 150 };
  corner.dispatchEvent(p.ev('pointerdown', { target: corner, clientX: 1264.5, clientY: 320.25 }));
  corner.dispatchEvent(p.ev('pointermove', { clientX: 1200, clientY: 423 }));
  corner.dispatchEvent(p.ev('pointerup'));
  await settle();
  assert.deepEqual([on(p, 'courses', 'notes').w, on(p, 'courses', 'notes').h], [232, 246]);
  const q = page({ local: p.store }); q.ui.sync(true); await settle();
  assert.equal(q.tile('notes').style.width, '232px');
  assert.equal(q.tile('notes').querySelector('.gz-w-body').style.height, '246px');
});

test('a keyboard resize at the stored size limits keeps the limits instead of resetting its size', async () => {
  const kept = W.bset(W.layout(ONLY(['notes'])), 'courses', 'notes', { h: 3000 });
  const p = page({ local: { widgetLayout: kept } }); p.ui.sync(true); await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  const n = p.tile('notes'), body = n.querySelector('.gz-w-body'), corner = n.querySelector('.gz-w-resize');
  n.box = { left: 976, top: 120, width: 288, height: 3050 };
  body.box = { left: 976, top: 160, width: 288, height: 3000 };
  corner.dispatchEvent(p.ev('keydown', { key: 'ArrowDown', target: corner }));
  await settle();
  assert.equal(on(p, 'courses', 'notes').h, 3000);
  assert.equal(body.style.height, '3000px');
  const wide = W.bset(W.layout(ONLY(['notes'])), 'courses', 'notes', { w: 4000 });
  const q = page({ width: 6000, local: { widgetLayout: wide } }); q.ui.sync(true); await settle();
  q.doc.fire(q.doc.querySelector('.gz-dash-edit'), 'click');
  const n2 = q.tile('notes'), c2 = n2.querySelector('.gz-w-resize');
  n2.box = { left: 976, top: 120, width: 4000, height: 200 };
  c2.dispatchEvent(q.ev('keydown', { key: 'ArrowRight', shiftKey: true, target: c2 }));
  await settle();
  assert.equal(on(q, 'courses', 'notes').w, 4000, 'width limit kept too');
});

test('resizing a folded floating tile changes its width without moving it vertically', async () => {
  const kept = W.layout({ boards: { pages: [{ id: 'notes', on: true, x: 0.3, y: 0.4, fold: true, h: 240 }] } });
  const p = page({ at: 'outline', local: { widgetLayout: kept } }); p.ui.sync(true); await settle();
  const n = p.tile('notes'), corner = n.querySelector('.gz-w-resize');
  n.box = { left: px(n.style.left), top: px(n.style.top), width: 384, height: 50 };
  p.ui.sync(true);
  const top = px(n.style.top), r = n.getBoundingClientRect();
  n.box = { ...n.box, top };
  corner.dispatchEvent(p.ev('pointerdown', { target: corner, clientX: r.right, clientY: top + 50 }));
  corner.dispatchEvent(p.ev('pointermove', { clientX: r.right + 32, clientY: top + 50, altKey: true }));
  corner.dispatchEvent(p.ev('pointerup')); await settle();
  assert.ok(Math.abs(px(n.style.top) - top) < 1, `top ${top} became ${n.style.top}`);
  assert.ok(on(p, 'pages', 'notes').w > 384, 'width changed');
  assert.equal(on(p, 'pages', 'notes').h, 240, 'unfolded height kept');
});

test('a press without a move applies another tab\'s size once the gesture ends', async () => {
  for (const resize of [false, true]) {
    const kept = W.bset(W.layout(ONLY(['notes'])), 'courses', 'notes', { z: 99 });
    const p = page({ local: { widgetLayout: kept } }); p.ui.sync(true); await settle();
    p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
    const n = p.tile('notes');
    const surface = resize ? n.querySelector('.gz-w-resize') : n;
    surface.dispatchEvent(p.ev('pointerdown', { target: resize ? surface : n.querySelector('.gz-w-head'), clientX: 980, clientY: 130 }));
    p.store.widgetLayout = W.bset(p.store.widgetLayout, 'courses', 'notes', { w: 240, h: 180 });
    p.changed({ widgetLayout: { newValue: p.store.widgetLayout } });
    surface.dispatchEvent(p.ev('pointerup')); await settle();
    assert.equal(n.style.width, '240px');
    assert.equal(n.querySelector('.gz-w-body').style.height, '180px');
    assert.equal(p.sent.filter((m) => m.type === 'glaze:widgetLayout').length, 0, 'no local change needed');
  }
});

test('leaving a board during a gesture does not freeze the next board layout', async () => {
  for (const resize of [false, true]) {
    const p = page({ local: { widgetLayout: ONLY(['notes']) } }); p.ui.sync(true); await settle();
    p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
    const n = p.tile('notes'), surface = resize ? n.querySelector('.gz-w-resize') : n;
    surface.dispatchEvent(p.ev('pointerdown', { target: resize ? surface : n.querySelector('.gz-w-head'), clientX: 1000, clientY: 130 }));
    p.c.location.pathname = '/ultra/stream'; p.ui.sync(true);
    p.c.location.pathname = '/ultra/course'; p.ui.sync(true); await settle();
    assert.ok(p.tile('notes')?.isConnected, resize ? 'resize released on departure' : 'drag released on departure');
    assert.equal(p.tile('notes').style.width, '288px');
    assert.equal(p.sent.filter((m) => m.type === 'glaze:widgetLayout').length, 0);
  }
});

test('cancelled gestures restore the saved layout, remove guides and release layout updates', async () => {
  for (const resize of [false, true]) for (const end of ['pointercancel', 'lostpointercapture', 'Escape', 'remove']) {
    const p = page({ local: { widgetLayout: ONLY(['notes', 'timer']) } }); p.ui.sync(true); await settle();
    p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
    const n = p.tile('notes'), body = n.querySelector('.gz-w-body');
    n.box = { left: 976, top: 120, width: 288, height: 200 };
    body.box = { left: 976, top: 160, width: 288, height: 150 };
    const surface = resize ? n.querySelector('.gz-w-resize') : n;
    surface.dispatchEvent(p.ev('pointerdown', { target: resize ? surface : n.querySelector('.gz-w-head'), clientX: 1260, clientY: 315 }));
    surface.dispatchEvent(p.ev('pointermove', { clientX: 1000, clientY: 420 }));
    if (end === 'Escape') p.doc.getElementById('gz-dash').dispatchEvent(p.ev('keydown', { key: 'Escape' }));
    else if (end === 'remove') {
      p.store.widgetLayout = W.bset(lay(p), 'courses', 'notes', { on: false });
      p.changed({ widgetLayout: { newValue: p.store.widgetLayout } });
    } else surface.dispatchEvent(p.ev(end));
    await settle();
    assert.equal(p.sent.filter((m) => m.type === 'glaze:widgetLayout').length, 0, `${resize ? 'resize' : 'drag'} ${end}: no cancelled change saved`);
    assert.ok(!p.room().querySelector('.gz-guide'), `${end}: guides removed`);
    if (end !== 'remove') {
      assert.equal(n.style.width, '288px', `${end}: width restored`);
      assert.equal(n.style.left, '776px', `${end}: spot restored`);
      assert.equal(body.style.height, '', `${end}: height restored`);
    }
    const timer = p.tile('timer');
    timer.dispatchEvent(p.ev('pointerdown', { target: timer.querySelector('.gz-w-head') }));
    timer.dispatchEvent(p.ev('pointerup'));
    await settle();
    p.store.widgetLayout = W.bset(lay(p), 'courses', 'timer', { w: 240 });
    p.changed({ widgetLayout: { newValue: p.store.widgetLayout } });
    assert.equal(timer.style.width, '240px', `${end}: layout runs again`);
  }
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
  p.tile('notes').dispatchEvent(p.ev('keydown', { key: 'ArrowUp', target: p.tile('notes') }));
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
  p.tile('timer').dispatchEvent(p.ev('keydown', { key: 'ArrowRight', target: p.tile('timer') }));
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
  n.focus();
  n.box = { left: px(n.style.left), top: px(n.style.top), width: 288, height: 200 };
  n.dispatchEvent(q.ev('keydown', { key: 'ArrowLeft', target: n }));
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
  p.tile('notes').dispatchEvent(p.ev('keydown', { key: 'ArrowLeft', target: p.tile('notes') }));
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


test('Ultra edit controls stay below the room on both boards and keep the toolbar width', async () => {
  for (const at of ['courses', 'dash']) {
    const p = page({ at }); p.ui.sync(true); await settle();
    const grid = p.grid(), add = p.doc.querySelector('.gz-dash-add'), edit = p.doc.querySelector('.gz-dash-edit');
    edit.box = { left: 0, top: 0, width: 104.5, height: 28 };
    Object.defineProperty(edit, 'offsetWidth', { value: 104 });
    assert.ok(grid.nextElementSibling === add, `${at}: Add cannot push the room down`);
    p.doc.fire(edit, 'click');
    assert.equal(edit.style.minWidth, '104.5px', `${at}: Done keeps the Edit layout width`);
    p.doc.fire(edit, 'click');
    assert.equal(edit.style.minWidth, '104.5px');
  }
});


// ---- the boards' Course cards dialog (features/coursecards.js, opened from widgets.js's Add row) -----------------
const COURSES = [
  { id: '_101_1', name: 'Biology', code: 'BIO-101', term: 'Fall 2026', slot: 3 },
  { id: '_102_1', name: 'Chemistry', code: 'CHEM-110', term: 'Fall 2026', slot: 5 },
  { id: '_103_1', name: 'History', code: 'HIST-200', term: 'Spring 2027', slot: 8 },
];
const ckey = (id) => `course:https://school.blackboard.test/${id}`;
const ukey = (id) => `ultra:https://school.blackboard.test/${id}`;
const cardsPage = (o = {}) => page({ courses: COURSES, enhance: { coursemenu: true }, ...o });
const openCards = async (p) => {
  p.ui.sync(true);
  await settle();
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  await settle();
  const btn = p.doc.querySelector('.gz-dash-add .gz-course-open');
  p.doc.fire(btn, 'click');
  await settle();
  return { btn, dlg: p.doc.getElementById('gz-ccm') };
};
const itemOf = (dlg, id) => dlg.querySelectorAll('li.gz-ccm-item').find((li) => li.querySelector('article').dataset.courseId === id);
const tick = (box, on) => { box.checked = on; box.dispatchEvent({ type: 'change', target: box }); };
const layoutSends = (p) => JSON.parse(JSON.stringify(p.sent.filter((m) => m.type === 'glaze:widgetLayout'))); // out of the page's realm
const buttonIn = (el, text) => el.querySelectorAll('button').find((x) => x.textContent === text);
// The stand-in keeps an input's type as a property (as make() sets it), not an attribute.
const input = (el, type, v) => el.querySelectorAll('input').filter((x) => x.type === type).find((x) => v === undefined || x.value === v) || null;

test('Course cards: one button opens a labelled dialog of every course by term, as small cards; Esc, × and Done close it and the focus goes back', async () => {
  const p = cardsPage();
  const { btn, dlg } = await openCards(p);
  assert.ok(!p.doc.querySelector('.gz-course-pick') && !p.doc.querySelector('.gz-course-add'), 'the old select and its button are gone');
  assert.equal(btn.textContent, '+ Course cards');
  assert.equal(btn.getAttribute('aria-haspopup'), 'dialog');
  assert.ok(dlg?.open, 'a modal dialog');
  assert.equal(p.doc.getElementById(dlg.getAttribute('aria-labelledby')).textContent, 'Course cards');
  assert.ok(p.doc.activeElement === input(dlg, 'search'), 'the focus starts in it, on the search');
  assert.equal(input(dlg, 'search').getAttribute('aria-label'), 'Find a course');
  const terms = dlg.querySelectorAll('section.gz-ccm-term');
  assert.deepEqual(terms.map((x) => x.querySelector('h3').textContent), ['Fall 2026', 'Spring 2027']);
  assert.deepEqual(terms.map((x) => x.querySelectorAll('article').map((a) => a.querySelector('.course-title').textContent)), [['Biology', 'Chemistry'], ['History']]);
  assert.equal(terms[0].getAttribute('role'), 'group');
  const bio = itemOf(dlg, '_101_1');
  const card = bio.querySelector('article');
  assert.ok(card.hasAttribute('data-gz-card-preview') && /course-color-3/.test(card.className), 'a preview in its course color');
  assert.equal(card.querySelector('.course-id').textContent, 'BIO-101');
  assert.ok(bio.querySelector('label').contains(input(bio, 'checkbox')), 'the card is the label of its tick');
  assert.equal(dlg.querySelector('.gz-ccm-count').getAttribute('role'), 'status');
  assert.equal(dlg.querySelector('.gz-ccm-count').textContent, 'On this board: 0. Room for 48 more.');
  assert.match(buttonIn(dlg.querySelector('.gz-ccm-tools'), 'Select all').className, /gz-w-main/, 'the first time on the Courses page, all of them is one click');
  p.doc.fire(dlg.querySelector('header button'), 'click');
  assert.equal(p.doc.getElementById('gz-ccm'), null, '× closes it');
  assert.ok(p.doc.activeElement === p.doc.querySelector('.gz-course-open'), 'and the focus is back on its button');
  p.doc.fire(p.doc.querySelector('.gz-course-open'), 'click');
  p.doc.getElementById('gz-ccm').close(); // Esc: the dialog's own cancel closes it
  assert.equal(p.doc.getElementById('gz-ccm'), null, 'Esc closes it');
  p.doc.fire(p.doc.querySelector('.gz-course-open'), 'click');
  p.doc.fire(buttonIn(p.doc.querySelector('#gz-ccm footer'), 'Done'), 'click');
  assert.equal(p.doc.getElementById('gz-ccm'), null, 'Done closes it');
  p.doc.fire(p.doc.querySelector('.gz-course-open'), 'click');
  p.doc.fire(p.doc.querySelector('.gz-dash-edit'), 'click');
  assert.equal(p.doc.getElementById('gz-ccm'), null, 'and it goes with Edit layout');
});

test('Course cards: a tick, Select all and Select none are one layout change each, on this board only, within its room; search filters', async () => {
  const p = cardsPage();
  const { dlg } = await openCards(p);
  const before = layoutSends(p).length;
  tick(input(itemOf(dlg, '_103_1'), 'checkbox'), true);
  await settle();
  let sent = layoutSends(p).slice(before);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].ops, [{ s: 'courses', id: ckey('_103_1'), set: { on: true, size: 's', term: 'Spring 2027' } }], 'placed by the board (no spot)');
  assert.ok(p.tile(ckey('_103_1')), 'on the board');
  assert.equal(itemOf(dlg, '_103_1').getAttribute('data-on'), '');
  assert.equal(dlg.querySelector('.gz-ccm-count').textContent, 'On this board: 1. Room for 47 more.');
  assert.doesNotMatch(buttonIn(dlg.querySelector('.gz-ccm-tools'), 'Select all').className, /gz-w-main/);
  tick(input(itemOf(dlg, '_103_1'), 'checkbox'), false);
  await settle();
  assert.deepEqual(layoutSends(p).at(-1).ops, [{ s: 'courses', id: ckey('_103_1'), remove: true }]);
  assert.equal(p.tile(ckey('_103_1')), null);
  // Search: by name, code or term; a term with none left hides; Select all takes only what shows.
  const q = input(dlg, 'search');
  q.value = 'chem';
  q.dispatchEvent({ type: 'input' });
  assert.deepEqual(dlg.querySelectorAll('li.gz-ccm-item').filter((li) => !li.hidden).map((li) => li.querySelector('article').dataset.courseId), ['_102_1']);
  assert.equal(dlg.querySelectorAll('section.gz-ccm-term')[1].hidden, true);
  q.value = 'fall';
  q.dispatchEvent({ type: 'input' });
  let n = layoutSends(p).length;
  p.doc.fire(buttonIn(dlg.querySelector('.gz-ccm-tools'), 'Select all'), 'click');
  await settle();
  assert.equal(layoutSends(p).length, n + 1, 'one change');
  assert.deepEqual(layoutSends(p).at(-1).ops.map((x) => x.id), [ckey('_101_1'), ckey('_102_1')]);
  q.value = 'zzz';
  q.dispatchEvent({ type: 'input' });
  assert.equal(dlg.querySelector('.gz-ccm-empty').hidden, false);
  assert.equal(dlg.querySelector('.gz-ccm-empty').textContent, 'No courses match.');
  q.value = '';
  q.dispatchEvent({ type: 'input' });
  // Per term: Select none for Fall 2026, in one change.
  n = layoutSends(p).length;
  const fall = dlg.querySelectorAll('section.gz-ccm-term')[0];
  const none = fall.querySelector('.gz-ccm-termhead').querySelectorAll('button').find((x) => x.getAttribute('aria-label') === 'Select none in Fall 2026');
  p.doc.fire(none, 'click');
  await settle();
  assert.equal(layoutSends(p).length, n + 1);
  assert.deepEqual(layoutSends(p).at(-1).ops, [{ s: 'courses', id: ckey('_101_1'), remove: true }, { s: 'courses', id: ckey('_102_1'), remove: true }]);
  assert.deepEqual(lay(p).boards.dash.filter((x) => W.course(x.id)), [], "the Dashboard's board untouched");
  // A board with room for one more: Select all adds one, the rest can't be ticked, and it says so.
  const full = W.layout({ todo: true, boards: { courses: Array.from({ length: W.COURSE_MAX - 1 }, (_, i) => ({ id: ckey(`_${500 + i}_1`), on: true })) } });
  const r = cardsPage({ local: { widgetLayout: full } });
  const { dlg: d2 } = await openCards(r);
  assert.equal(d2.querySelector('.gz-ccm-count').textContent, `On this board: 47. Room for 1 more.`);
  r.doc.fire(buttonIn(d2.querySelector('.gz-ccm-tools'), 'Select all'), 'click');
  await settle();
  assert.equal(layoutSends(r).at(-1).ops.length, 1, 'only what fits');
  assert.equal(d2.querySelector('.gz-ccm-count').textContent, 'On this board: 48. Room for 0 more.');
  assert.deepEqual(['_102_1', '_103_1'].map((id) => input(itemOf(d2, id), 'checkbox').disabled), [true, true]);
  assert.equal(input(itemOf(d2, '_102_1'), 'checkbox').title, `Up to ${W.COURSE_MAX} course cards per board.`);
  assert.equal(buttonIn(d2.querySelector('.gz-ccm-tools'), 'Select all').disabled, true);
});

test('Course cards on the Dashboard: its own board, the Courses page left as it is', async () => {
  const p = cardsPage({ at: 'dash' });
  const { dlg } = await openCards(p);
  assert.doesNotMatch(buttonIn(dlg.querySelector('.gz-ccm-tools'), 'Select all').className, /gz-w-main/);
  tick(input(itemOf(dlg, '_101_1'), 'checkbox'), true);
  await settle();
  assert.deepEqual(layoutSends(p).at(-1).ops, [{ s: 'dash', id: ckey('_101_1'), set: { on: true, size: 's', term: 'Fall 2026' } }]);
  assert.ok(p.tile(ckey('_101_1')));
  assert.deepEqual(lay(p).boards.courses.filter((x) => W.course(x.id)), []);
});

test("Course cards: a course's look changes from the dialog, saved as the card editor saves it; pictures are checked; the full editor opens over it", async () => {
  const p = cardsPage();
  const { dlg } = await openCards(p);
  const bio = itemOf(dlg, '_101_1');
  const style = bio.querySelector('.gz-ccm-style');
  assert.equal(style.getAttribute('aria-label'), 'Style of Biology');
  assert.equal(style.getAttribute('aria-expanded'), 'false');
  p.doc.fire(style, 'click');
  await settle();
  assert.equal(style.getAttribute('aria-expanded'), 'true');
  const look = p.doc.getElementById(style.getAttribute('aria-controls'));
  assert.ok(look && !look.hidden && bio.contains(look), 'its looks, under it');
  const radio = (v) => input(look, 'radio', v);
  assert.equal(radio('').checked, true, 'the course color, to begin with');
  assert.ok(p.doc.activeElement === radio(''), 'the focus on the chosen kind');
  assert.equal(look.querySelector('[role="radiogroup"]').getAttribute('aria-label'), 'Card for Biology');
  const pick = async (v) => { radio(v).checked = true; radio(v).dispatchEvent({ type: 'change' }); await settle(); };
  await pick('gradient');
  assert.deepEqual(Object.keys(sync(p)), ['ucards'], 'kept in Ultra\'s own item');
  assert.equal(sync(p).ucards[ukey('_101_1')].k, 'gradient');
  assert.equal(bio.querySelector('article').dataset.gzCard, 'gradient', 'the preview wears it');
  assert.equal(input(look, 'color').parentNode.hidden, false, 'a color to change it by');
  const color = input(look, 'color');
  color.value = '#123456';
  color.dispatchEvent({ type: 'change' });
  await settle();
  assert.deepEqual([sync(p).ucards[ukey('_101_1')].k, sync(p).ucards[ukey('_101_1')].c], ['gradient', '#123456']);
  // A picture: a link must be https; a file must be a picture; one that is goes on this computer, scaled down.
  await pick('image');
  const url = input(look, 'url');
  assert.equal(url.parentNode.parentNode.hidden, false);
  url.value = 'http://example.test/a.png';
  url.dispatchEvent({ type: 'change' });
  await settle();
  const note = look.querySelector('.gz-ccm-note');
  assert.deepEqual([note.hidden, note.textContent], [false, 'Use an https:// link to an image.']);
  assert.equal(sync(p).ucards[ukey('_101_1')].k, 'gradient', 'nothing saved');
  url.value = 'https://example.test/a.png';
  url.dispatchEvent({ type: 'change' });
  await settle();
  assert.equal(sync(p).ucards[ukey('_101_1')].u, 'https://example.test/a.png');
  assert.equal(note.hidden, true);
  const file = input(look, 'file');
  file.files = [{ name: 'notes.txt' }];
  file.dispatchEvent({ type: 'change' });
  await settle();
  assert.equal(note.textContent, "That file isn't a picture Glaze can read.");
  file.files = [{ name: 'lab.png', picture: true }];
  file.dispatchEvent({ type: 'change' });
  await settle();
  const s = sync(p).ucards[ukey('_101_1')];
  assert.ok(s.k === 'image' && /^[a-z0-9]{12}$/.test(s.i) && !s.u, 'its own picture');
  assert.match(p.store[`ultraCardImg:${s.i}`], /^data:image\/webp;base64,/, 'kept on this computer');
  assert.equal(bio.querySelector('article').dataset.gzCard, 'image');
  // Too big to keep: said, and the picture before stays.
  p.doc.createElement = ((make) => (t) => Object.assign(make(t), t === 'canvas' && { getContext: () => ({ drawImage() {} }), toDataURL: () => `data:image/webp;base64,${'A'.repeat(K.IMG_MAX)}` }))(p.doc.createElement);
  file.files = [{ name: 'huge.png', picture: true }];
  file.dispatchEvent({ type: 'change' });
  await settle();
  assert.equal(note.textContent, "That picture is too big to keep. Try a smaller one, or remove another card's picture.");
  assert.equal(sync(p).ucards[ukey('_101_1')].i, s.i);
  await pick('');
  assert.equal(sync(p).ucards?.[ukey('_101_1')], undefined, 'back to the course color');
  assert.equal(p.store[`ultraCardImg:${s.i}`], undefined, 'and its picture is let go');
  // Everything else: the card editor, over the dialog; closing it gives the focus back to Style.
  p.doc.fire(buttonIn(look, 'Card style and bookmarks'), 'click');
  await settle();
  const ce = p.doc.getElementById('gz-ce');
  assert.ok(ce?.open && p.doc.getElementById('gz-ccm').open, 'both dialogs open, the editor on top');
  assert.equal(ce.querySelector('h2').textContent, 'Card for Biology');
  p.doc.fire(ce.querySelector('.gz-ce-done'), 'click');
  await settle();
  assert.ok(!p.doc.getElementById('gz-ce'));
  assert.ok(p.doc.activeElement === style, 'back on the course\'s Style');
  assert.ok(p.doc.getElementById('gz-ccm').open);
});

test('Course cards: distinct Ultra ids keep distinct style panels and radio groups', async () => {
  const p = cardsPage({ courses: [{ ...COURSES[0], id: '_1_11' }, { ...COURSES[1], id: '_11_1' }] });
  const { dlg } = await openCards(p);
  for (const btn of dlg.querySelectorAll('.gz-ccm-style')) p.doc.fire(btn, 'click');
  await settle();
  const panels = dlg.querySelectorAll('.gz-ccm-look');
  assert.equal(new Set(panels.map((x) => x.id)).size, 2);
  assert.equal(new Set(panels.map((x) => input(x, 'radio').name)).size, 2);
});

test('Course cards: clicking dialog padding keeps it open; only the backdrop closes it', async () => {
  const p = cardsPage();
  const { dlg } = await openCards(p);
  dlg.box = { left: 20, top: 20, width: 320, height: 500 };
  dlg.dispatchEvent({ type: 'click', target: dlg, clientX: 25, clientY: 25 });
  assert.ok(dlg.isConnected && dlg.open, 'padding is inside the dialog');
  dlg.dispatchEvent({ type: 'click', target: dlg, clientX: 5, clientY: 5 });
  assert.equal(dlg.isConnected, false, 'outside its bounds is the backdrop');
});

test('Course cards: late course metadata updates names, code and terms without replacing the active controls', async () => {
  const courses = structuredClone(COURSES);
  const p = cardsPage({ courses });
  const { dlg } = await openCards(p);
  const bio = itemOf(dlg, '_101_1'), style = bio.querySelector('.gz-ccm-style');
  p.doc.fire(style, 'click');
  await settle();
  const color = input(bio, 'radio', 'solid'); color.focus();
  Object.assign(courses[0], { name: 'Biology II', code: 'BIO-202', term: 'Summer 2027' });
  p.c.GZ_COURSE_CARDS.sync();
  await settle();
  assert.equal(itemOf(dlg, '_101_1').querySelector('.course-title').textContent, 'Biology II');
  assert.equal(itemOf(dlg, '_101_1').querySelector('.course-id').textContent, 'BIO-202');
  assert.equal(itemOf(dlg, '_101_1').closest('section').querySelector('h3').textContent, 'Summer 2027');
  courses.push({ ...COURSES[0], id: '_104_1', name: 'Physics' });
  p.c.GZ_COURSE_CARDS.sync();
  await settle();
  assert.equal(dlg.querySelectorAll('.gz-ccm-item').length, 4);
  assert.ok(p.doc.activeElement === color && color.isConnected, 'late courses keep focus and the open panel');
  assert.ok(itemOf(dlg, '_101_1') === bio);
});

test('Course cards: leaving the board closes its stacked editor and a pending open cannot revive it', async () => {
  const p = cardsPage();
  const { dlg } = await openCards(p);
  p.doc.fire(itemOf(dlg, '_101_1').querySelector('.gz-ccm-style'), 'click');
  await settle();
  const more = buttonIn(dlg, 'Card style and bookmarks');
  p.doc.fire(more, 'click'); await settle();
  assert.ok(p.doc.getElementById('gz-ce')?.open);
  p.ui.sync(false); await settle();
  assert.ok(!p.doc.getElementById('gz-ce'));
  assert.equal(p.doc.getElementById('gz-ccm'), null);
  const q = cardsPage(); const { dlg: d2 } = await openCards(q);
  q.doc.fire(itemOf(d2, '_101_1').querySelector('.gz-ccm-style'), 'click'); await settle();
  q.doc.fire(buttonIn(d2, 'Card style and bookmarks'), 'click');
  q.ui.sync(false); await settle();
  assert.ok(!q.doc.getElementById('gz-ce'), 'an async open rechecks its parent');
});

test('Course cards: the count includes saved courses not yet listed, and another tab updates ticks', async () => {
  const layout = W.layout({ todo: true, boards: { courses: [{ id: ckey('_999_1'), on: true }] } });
  const p = cardsPage({ local: { widgetLayout: layout } });
  const { dlg } = await openCards(p);
  assert.equal(dlg.querySelector('.gz-ccm-count').textContent, 'On this board: 1. Room for 47 more.');
  p.store.widgetLayout = W.apply(layout, { ops: [{ s: 'courses', id: ckey('_101_1'), set: { on: true } }] });
  p.changed({ widgetLayout: { newValue: p.store.widgetLayout } }); await settle();
  assert.equal(input(itemOf(dlg, '_101_1'), 'checkbox').checked, true);
  assert.equal(dlg.querySelector('.gz-ccm-count').textContent, 'On this board: 2. Room for 46 more.');
});

test('Course cards: an older picture cannot replace a newer picture or kind', async () => {
  const p = cardsPage(); await openCards(p);
  const ui = p.c.GZ_CARD_UI, key = ukey('_101_1'), decoded = [];
  p.c.createImageBitmap = () => new Promise((resolve) => decoded.push(() => resolve({ width: 100, height: 100, close() {} })));
  const first = ui.setPicture(key, {}); await settle();
  const second = ui.setPicture(key, {}); await settle();
  decoded.pop()(); await second;
  const id = sync(p).ucards[key].i;
  decoded.pop()(); await first;
  assert.equal(sync(p).ucards[key].i, id, 'the later picture stays');
  const third = ui.setPicture(key, {}); await settle();
  await ui.setKind(key, 'solid', '#112233');
  decoded.pop()(); await third;
  assert.equal(sync(p).ucards[key].k, 'solid', 'a later kind also stays');
  assert.equal(Object.keys(p.store).filter((k) => k.startsWith('ultraCardImg:')).length, 0);
});

test('Course cards: quick color previews each input, coalesces writes and flushes on Done', async () => {
  const p = cardsPage(); const { dlg } = await openCards(p);
  const bio = itemOf(dlg, '_101_1'); p.doc.fire(bio.querySelector('.gz-ccm-style'), 'click'); await settle();
  tick(input(bio, 'radio', 'solid'), true); await settle();
  const timers = new Map(); let timerId = 0;
  p.c.setTimeout = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
  p.c.clearTimeout = (id) => timers.delete(id);
  const count = () => p.sent.filter((m) => m.type === 'glaze:cards').length;
  const before = count(), color = input(bio, 'color');
  for (const v of ['#123456', '#234567', '#345678']) { color.value = v; color.dispatchEvent({ type: 'input' }); await settle(); }
  assert.equal(bio.querySelector('article').style.getPropertyValue('--gz-card-c'), '#345678', 'the preview is live');
  assert.equal(count(), before, 'no sync write during the drag');
  p.doc.fire(buttonIn(dlg.querySelector('footer'), 'Done'), 'click'); await settle();
  assert.equal(count(), before + 1, 'Done flushes one final write');
  assert.equal(sync(p).ucards[ukey('_101_1')].c, '#345678');
  assert.ok(!p.doc.getElementById('gz-ccm'));
});

test('Course cards: pending pictures are discarded when their modal closes', async () => {
  const p = cardsPage(); const { dlg } = await openCards(p);
  const bio = itemOf(dlg, '_101_1'); p.doc.fire(bio.querySelector('.gz-ccm-style'), 'click'); await settle();
  const ready = later(); p.c.createImageBitmap = () => ready;
  const file = input(bio, 'file'); file.files = [{}]; file.dispatchEvent({ type: 'change' }); await settle();
  p.doc.fire(buttonIn(dlg.querySelector('footer'), 'Done'), 'click');
  ready.res({ width: 10, height: 10, close() {} }); await settle();
  assert.ok(!sync(p).ucards?.[ukey('_101_1')]);
});

test('Course cards: style controls form one card cell and their panel spans the shared row', async () => {
  const p = cardsPage(); const { dlg } = await openCards(p);
  const bio = itemOf(dlg, '_101_1'), style = bio.querySelector('.gz-ccm-style');
  assert.ok(style.parentNode === bio.querySelector('.gz-ccm-card'), 'preview and Style share a grid cell');
  p.doc.fire(style, 'click'); await settle();
  assert.ok(bio.querySelector('.gz-ccm-look').parentNode === bio, 'the panel is outside that cell');
});

test('Course cards: concurrent full-editor opens leave one dialog with unique ids', async () => {
  const p = cardsPage(); const { dlg } = await openCards(p);
  const back = itemOf(dlg, '_101_1').querySelector('.gz-ccm-style');
  await Promise.all([p.c.GZ_CARD_UI.open(ukey('_101_1'), back), p.c.GZ_CARD_UI.open(ukey('_102_1'), back)]);
  assert.equal(p.doc.querySelectorAll('#gz-ce').length, 1);
  assert.equal(p.doc.getElementById('gz-ce').querySelector('h2').textContent, 'Card for Chemistry');
});

test('Course cards: invalid quick kinds and colors cannot erase a saved style', async () => {
  const p = cardsPage({ sync: { ucards: { [ukey('_101_1')]: { k: 'solid', c: '#123456' } } } });
  await openCards(p);
  for (const [kind, color] of [['bogus', undefined], ['solid', 'bad']]) {
    const result = await p.c.GZ_CARD_UI.setKind(ukey('_101_1'), kind, color);
    assert.equal(result.ok, false);
    assert.equal(sync(p).ucards[ukey('_101_1')].c, '#123456');
  }
});

test('Course cards: quick looks preserve bookmarks and other schools, respect both picture caps and sync item size', async () => {
  const key = ukey('_101_1'), other = 'ultra:https://other.blackboard.test/_101_1';
  const links = { [key]: [{ n: 'Lab', u: '/lab', i: 'book' }] };
  const p = cardsPage({ sync: { ucards: { [other]: { k: 'solid', c: '#445566' } }, ulinks: structuredClone(links) } });
  await openCards(p); const ui = p.c.GZ_CARD_UI;
  await ui.setKind(key, 'gradient', '#112233');
  assert.deepEqual(sync(p).ulinks, links);
  assert.equal(sync(p).ucards[other].c, '#445566');
  // Pictures of the other site and Canvas count too.
  for (let i = 0; i < 10; i++) p.store[`cardImg:${String(i).padStart(12, 'a')}`] = 'A'.repeat(K.IMG_MAX);
  const result = await ui.setPicture(key, { picture: true });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, error: 'cap' });
  assert.equal(sync(p).ucards[key].k, 'gradient');
  for (const k of Object.keys(p.store).filter((k) => k.startsWith('cardImg:'))) delete p.store[k];
  const large = {};
  for (let i = 0; ; i++) {
    const k = ukey(`_${500 + i}_1`), s = { k: 'image', u: `https://images.test/${'x'.repeat(700)}` };
    if (K.bytes('ucards', { ...large, [k]: s }) > K.ITEM_MAX) break;
    large[k] = s;
  }
  sync(p).ucards = large; p.changed({ ucards: { newValue: large } }, 'sync'); await settle();
  const before = structuredClone(large);
  const tooMuch = await ui.setLink(key, `https://images.test/${'y'.repeat(2000)}`);
  assert.equal(tooMuch.ok, false);
  assert.deepEqual(sync(p).ucards, before, 'a rejected save drops no other style');
  assert.deepEqual(sync(p).ulinks, links);
});

test('Course cards: opening the full editor cancels a quick picture still decoding', async () => {
  const p = cardsPage(); const { dlg } = await openCards(p);
  const ready = later(); p.c.createImageBitmap = () => ready;
  const ui = p.c.GZ_CARD_UI, key = ukey('_101_1');
  const picture = ui.setPicture(key, {}); await settle();
  await ui.open(key, itemOf(dlg, '_101_1').querySelector('.gz-ccm-style'));
  ready.res({ width: 10, height: 10, close() {} }); await picture; await settle();
  assert.ok(!sync(p).ucards?.[key], 'the older quick choice cannot land under the full editor');
});

test('Course cards: Style waits for the shared card editor to load', async () => {
  const loaded = later(), p = cardsPage({ hold: { 'features/cards.js': loaded } });
  const { dlg } = await openCards(p);
  const style = itemOf(dlg, '_101_1').querySelector('.gz-ccm-style');
  assert.equal(style.disabled, true, 'choices cannot be silently dropped during loading');
  loaded.res(); await settle();
  assert.equal(style.disabled, false);
  p.doc.fire(style, 'click'); await settle();
  tick(input(itemOf(dlg, '_101_1'), 'radio', 'solid'), true); await settle();
  assert.equal(sync(p).ucards[ukey('_101_1')].k, 'solid');
});

test('Course cards: an existing disabled course can be re-enabled at the saved-record limit', async () => {
  const board = [{ id: ckey('_101_1'), on: false }, ...Array.from({ length: 47 }, (_, i) => ({ id: ckey(`_${500 + i}_1`), on: true }))];
  const p = cardsPage({ local: { widgetLayout: { todo: true, boards: { courses: board } } } });
  const { dlg } = await openCards(p);
  assert.equal(input(itemOf(dlg, '_101_1'), 'checkbox').disabled, false, 'this record already fits');
  assert.equal(input(itemOf(dlg, '_102_1'), 'checkbox').disabled, true, 'a new record does not fit');
  p.doc.fire(buttonIn(dlg.querySelector('.gz-ccm-tools'), 'Select all'), 'click'); await settle();
  assert.equal(on(p, 'courses', ckey('_101_1')).on, true);
  assert.equal(lay(p).boards.courses.filter((x) => W.course(x.id)).length, 48);
});

test('Course cards: the full editor waits for a quick style write already in flight', async () => {
  const p = cardsPage(); const { dlg } = await openCards(p);
  const ui = p.c.GZ_CARD_UI, send = p.c.chrome.runtime.sendMessage, pending = [];
  p.c.chrome.runtime.sendMessage = (m, cb) => m.type === 'glaze:cards' ? pending.push(() => send(m, cb)) : send(m, cb);
  const saving = ui.setKind(ukey('_101_1'), 'solid', '#123456'); await settle();
  const opening = ui.open(ukey('_101_1'), itemOf(dlg, '_101_1').querySelector('.gz-ccm-style')); await settle();
  assert.ok(!p.doc.getElementById('gz-ce'), 'the draft must start from the completed quick choice');
  pending.shift()(); await saving; await opening;
  assert.equal(input(p.doc.getElementById('gz-ce'), 'color').value, '#123456');
});

test('Course cards: Esc flushes pending color before the native dialog closes, while leaving a board detaches it immediately', async () => {
  for (const leave of [true, false]) {
    const p = cardsPage(); const { dlg } = await openCards(p);
    const bio = itemOf(dlg, '_101_1'); p.doc.fire(bio.querySelector('.gz-ccm-style'), 'click'); await settle();
    tick(input(bio, 'radio', 'solid'), true); await settle();
    const color = input(bio, 'color'); color.value = '#123456'; color.dispatchEvent({ type: 'input' }); await settle();
    if (leave) {
      p.ui.sync(false);
      assert.equal(dlg.isConnected, false, 'route changes cannot leave an inert modal over the next page');
    } else {
      let prevented = false;
      dlg.dispatchEvent({ type: 'cancel', preventDefault: () => { prevented = true; } });
      assert.equal(prevented, true, 'the dialog waits for the same flush as Done');
    }
    await settle();
    assert.ok(!p.doc.getElementById('gz-ccm'));
    assert.equal(sync(p).ucards[ukey('_101_1')].c, '#123456');
  }
});
