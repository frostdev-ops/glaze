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
const { El } = require('./stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const O = 'https://school.blackboard.test';
const KEY = S.key('ultra', O, '_3_1');
const CARD = `course:${O}/_101_1`;

// at: 'courses' | 'outline' | 'detail' | 'stream' (no column); width: the window; stored: storage.local; enhance;
// widgets: run features/widgets.js too; todo: a stand-in Better To Do (features/todo.js) that mounts a list.
const page = ({ at = 'outline', width = 1600, stored = {}, enhance = {}, widgets = false, todo = false } = {}) => {
  const doc = { activeElement: null };
  const make = (t) => new El(t, doc);
  const el = (tag, cls, ...kids) => { const e = make(tag); e.className = cls; e.append(...kids); return e; };
  doc.root = make('html');
  doc.body = make('body');
  doc.root.append(doc.body);
  const inner = el('div', '');
  inner.id = 'main-content-inner';
  const wrap = el('div', '', el('nav', 'MuiDrawer-paper'), el('main', '', inner));
  wrap.id = 'site-wrap';
  doc.body.append(wrap);
  const where = { courses: '/ultra/course', outline: '/ultra/courses/_101_1/outline', detail: '/ultra/courses/_101_1/outline/discussion/_9_1', stream: '/ultra/stream' }[at];
  if (at === 'courses') {
    inner.append(el('section', 'base-courses-container route-view-container', el('div', 'base-courses-header-container', el('h1', 'page-title', 'Courses'), el('div', 'base-header-tools')),
      el('div', 'base-courses-content', el('div', 'courses-panel', el('div', 'base-courses')), el('div', 'todo-panel js-todo-panel-skip-link-target', el('bb-todo', 'react-container', 'Due soon: Essay')))));
  } else if (at !== 'stream') {
    const faculty = el('bb-course-instructors', '', 'Course Faculty');
    const details = el('div', 'js-details-and-actions outline-action-block', 'Details & Actions');
    const sched = el('div', 'conditional-block', 'Schedule');
    inner.append(el('div', 'course-content-container', el('div', 'panel-wrap', el('div', 'bb-course-navigation', 'Course'), el('section', 'course-outline-content', 'Week 1'), el('aside', 'outline-actions', faculty, details, sched))));
    if (at === 'detail') inner.append(el('div', 'layer-content', 'A discussion'), el('div', 'layer-details', el('div', 'discussion-settings', 'Details & Information'), el('div', 'discussion-participants', 'Participation')));
  }
  const store = structuredClone(stored), sent = [], loads = [], storeListeners = [], winListeners = [], observers = [], todoCalls = [];
  let queue = Promise.resolve();
  const fire = (v, old) => { for (const f of [...storeListeners]) f(Object.fromEntries(Object.keys(v).map((k) => [k, { newValue: structuredClone(v[k]), oldValue: old[k] }])), 'local'); };
  const area = {
    get: async (ks) => Object.fromEntries([ks].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
    set: async (v) => { const old = structuredClone(store); Object.assign(store, structuredClone(v)); setImmediate(() => fire(v, old)); return true; },
  };
  const settings = () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, todo: true, sidebar: true, dashboard: true, ...enhance } });
  const sync = { get: async () => ({ enhance: settings().enhance }) };
  const c = {
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, structuredClone,
    setTimeout: () => 0, clearTimeout() {}, setImmediate,
    addEventListener: (type, f) => winListeners.push({ type, f }), removeEventListener: (type, f) => { const i = winListeners.findIndex((l) => l.type === type && l.f === f); if (i >= 0) winListeners.splice(i, 1); },
    innerWidth: width, innerHeight: 900, location: { origin: O, pathname: where, href: `${O}${where}` },
    document: doc, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(f) { this.f = f; this.targets = []; observers.push(this); } observe(target) { this.targets.push(target); this.on = true; } disconnect() { this.on = false; this.targets = []; } },
    requestAnimationFrame: (f) => { f(); return 1; }, cancelAnimationFrame() {},
    performance: { getEntriesByType: () => [{ type: 'navigate' }] }, history: { length: 1 },
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W, GZ_SIDEBAR: S,
    GZ_CTX: {
      site: 'ultra', solo: true, t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n]), locale: () => 'en', settings, acted: () => 0,
      account: async () => '_3_1', profile: async () => ({ id: '_3_1', time_zone: 'UTC' }),
      courseId: () => c.location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1],
      need: async (f) => { loads.push(f); },
    },
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, getURL: (p) => p, getManifest: () => ({ version: '3' }), sendMessage: (m, cb) => {
        sent.push(structuredClone(m));
        const run = () => (m.type === 'glaze:sidebar' ? S.change(structuredClone(m), area, sync) : m.type === 'glaze:widgetLayout' ? W.change(structuredClone(m), area) : { ok: true, timer: W.IDLE });
        queue = queue.then(run).then((r) => cb?.(structuredClone(r)), () => cb?.({ ok: false }));
      } },
      storage: { local: { get: (ks, cb) => area.get(ks).then(cb), set: (v, cb) => { area.set(v).then(() => cb?.()); }, remove: (k, cb) => { for (const x of [k].flat()) delete store[x]; cb?.(); } },
        sync: { get: (k, cb) => cb({}) }, onChanged: { addListener: (f) => storeListeners.push(f), removeListener: (f) => { const i = storeListeners.indexOf(f); if (i >= 0) storeListeners.splice(i, 1); } } },
    },
  };
  // Ultra at this width: its nav 200px, the page from there; a course's top bar 60px high.
  doc.boxOf = (e) => {
    if (e.id === 'main-content-inner' || e.className === 'course-content-container') return { left: 200, top: 0, width: c.innerWidth - 200, height: 900 };
    if (e.className === 'bb-course-navigation') return { left: 200, top: 0, width: c.innerWidth - 200, height: 60 };
    if (e.dataset?.gzSidebarHost) return { left: c.innerWidth - 352, top: 60, width: 352, height: 800 };
    if (/route-view-container/.test(e.className)) return { left: 200, top: 0, width: c.innerWidth - 200, height: 1600 };
    if (e.id === 'gz-room') return { left: 200, top: 0, width: c.innerWidth - 200, height: 0 };
    if (e.className === 'gz-dash-grid') return { left: c.innerWidth - 320 + 16, top: 120, width: 288, height: 0 };
    if (e.className === 'base-courses') return { left: 200, top: 120, width: c.innerWidth - 600, height: 600 };
    if (e.className === 'gz-w') return { left: Number(String(e.style.left || '0').replace('px', '')), top: 0, width: 288, height: 200 };
    return null;
  };
  doc.fire = (target, type, extra = {}) => { const ev = { type, target, key: extra.key, shiftKey: false, button: 0, pointerId: 1, clientX: 0, clientY: 0, isTrusted: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (let x = target; x; x = x.parentNode) x.dispatchEvent?.(ev);
    return ev; };
  Object.assign(doc, {
    documentElement: doc.root, visibilityState: 'visible', createElement: make, createTextNode: (textContent) => ({ textContent }),
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: (id) => doc.root.all().find((x) => x.id === id) || null,
    addEventListener() {}, removeEventListener() {},
  });
  c.globalThis = c; c.window = c; c.top = c;
  // Better To Do, as far as the dock needs it: mount puts its one list in the tile, unmount takes it away; sync is the
  // legacy path (the site's own places), which must not run while the dock has it.
  if (todo) {
    let box = null;
    c.GZ_TODO_UI = {
      mount: (target, x) => { todoCalls.push(['mount', x.courseId, x.scope]); box ||= Object.assign(make('section'), { id: 'gz-todo' }); target.append(box); return true; },
      unmount: () => { todoCalls.push(['unmount']); box?.remove(); },
      sync: (on) => todoCalls.push(['sync', on]),
    };
  }
  // Course cards, as far as a board needs them: a tile's body.
  c.GZ_COURSE_CARDS = { fill: (body) => { body.append('A course'); return {}; }, sync() {}, picker: { close() {} }, title: () => 'A course' };
  vm.createContext(c);
  const side = vm.runInContext(read('features/sidebar.js'), c);
  const ui = widgets ? vm.runInContext(read('features/widgets.js'), c) : null;
  // A pass of the site's part (content-ultra.js syncWidgets): the sidebar as its switch says, then the widgets.
  const pass = async () => { const on = settings().enhance.sidebar; side.sync(on); await settle(); ui?.sync(true); await settle(); side.sync(on); await settle(); };
  const resize = async (w) => { c.innerWidth = w; for (const l of winListeners.filter((x) => x.type === 'resize')) l.f(); await settle(); };
  const $ = (s) => doc.querySelector(s);
  const mode = () => doc.root.dataset.gzSidebar;
  const host = () => doc.root.all().find((x) => x.dataset?.gzSidebarHost);
  const ours = (x) => { for (let p = x; p && p.tagName; p = p.parentNode) if (/^gz-/.test(p.id) || /(^|\s)gz-/.test(String(p.className))) return true; return false; };
  const mutate = (target) => { for (const o of observers.filter((x) => x.on && x.targets.includes(target))) o.f([{ target, addedNodes: [], removedNodes: [] }]); };
  return { c, doc, side, ui, store, sent, loads, observers, todoCalls, pass, resize, $, mode, host, ours, mutate, el, fire: doc.fire };
};
const record = (x = {}) => ({ [KEY]: S.clean({ mig: 1, ...x }) });
const natives = (p) => p.doc.body.all().filter((x) => !p.ours(x)).map((x) => [x, x.parentNode, x.parentNode.children.filter((k) => !p.ours(k)).indexOf(x)]);
const unmoved = (p, before, what) => {
  for (const [x, parent, i] of before) {
    assert.equal(x.parentNode, parent, `${what}: ${x.tagName}.${x.className} moved`);
    assert.equal(parent.children.filter((k) => !p.ours(k)).indexOf(x), i, `${what}: ${x.tagName}.${x.className} out of its place`);
  }
  assert.equal(p.doc.body.all().filter((x) => !p.ours(x)).length, before.length, `${what}: no copies of Ultra's nodes`);
};

test('each kind of Ultra page: its own column dressed in place, or Glaze\'s own where there is none or only a layer', async () => {
  for (const [at, family, host, cls] of [['courses', 'courses', 'native', 'todo-panel'], ['outline', 'outline', 'native', 'outline-actions'], ['detail', 'detail', 'glaze', null], ['stream', 'other', 'glaze', null]]) {
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
      assert.equal(h.getAttribute('role'), 'complementary');
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

test('a discussion\'s details layer stays as Ultra has it: the sidebar is a drawer over it, and the outline\'s column below is left alone', async () => {
  const p = page({ at: 'detail', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  assert.equal(p.mode(), 'drawer', 'wide, but a layer: a drawer');
  assert.equal(p.$('#gz-sb-launch').hidden, false);
  const details = p.$('.layer-details');
  assert.ok(!details.all().some(p.ours) && details.dataset.gzSidebarHost === undefined, 'nothing of Glaze\'s in the layer');
  assert.equal(p.$('aside.outline-actions').dataset.gzSidebarHost, undefined, 'the outline\'s column under the layer: native');
  // The layer closes: the outline's own column is the sidebar again, with the same dock.
  const dock = p.$('#gz-sb-widgets'), own = p.$('#gz-sidebar');
  p.$('.layer-details').remove();
  await p.pass();
  assert.equal(p.side.context().family, 'outline');
  assert.equal(p.$('aside.outline-actions').dataset.gzSidebarHost, 'native');
  assert.equal(p.$('#gz-sb-widgets'), dock, 'not rebuilt');
  assert.equal(p.mode(), 'expanded');
  assert.equal(own.isConnected, false, 'Glaze\'s own column gone');
});

test('offsets: Ultra\'s nav and Glaze\'s bar from the page\'s start, a course\'s top bar for the fixed column', async () => {
  const p = page({ at: 'stream', width: 1300, stored: record() });
  p.c.getComputedStyle = (e) => ({ paddingInlineStart: e.id === 'main-content-inner' ? '0px' : '0px' });
  await p.pass();
  // 1300 - 200 (nav) = 1100 >= 352 + 16 + 720: expanded
  assert.equal(p.mode(), 'none', 'nothing to show: no room kept');
  const q = page({ at: 'stream', width: 1300, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  q.c.getComputedStyle = () => ({ paddingInlineStart: '0px' });
  await q.pass();
  assert.equal(q.mode(), 'expanded');
  // Glaze's bar adds its room as #main-content-inner's start padding: 1300 - 200 - 96 = 1004 < 1088.
  q.c.getComputedStyle = () => ({ paddingInlineStart: '96px' });
  await q.resize(1300);
  assert.equal(q.mode(), 'drawer');
  // A course's top bar: the fixed column starts under it.
  const r = page({ at: 'outline', stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await r.pass();
  assert.equal(r.doc.root.style.getPropertyValue('--gz-sb-top'), '60px');
});

test('late Angular blocks join This page in place; a block added after the widgets puts them last again; the dock is never rebuilt', async () => {
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
  assert.equal(aside.lastElementChild, dock, 'the widgets last again');
  assert.equal(late.nextElementSibling, dock);
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

test('content-ultra.js: the sidebar on the top page only, with the widgets for its To Do and Better To Do\'s old places off while it runs', () => {
  const src = read('content-ultra.js');
  assert.match(src, /const sidebarHere = \(\) => !!top\(\)\?\.sidebar && !tabFrame && /);
  assert.match(src, /const syncSidebar = \(\) => load\(sidebarHere, 'features\/sidebar\.js', 'GZ_SIDEBAR_UI'\);/);
  assert.match(src, /\(e\.todo && sidebarHere\(\)\)/);
  assert.match(src, /!\(sidebarHere\(\) && !globalThis\.GZ_SIDEBAR_UI\?\.failed\(\)\)/);
  assert.match(src, /const syncWidgets = \(\) => \{\n {4}syncSidebar\(\);/);
});
