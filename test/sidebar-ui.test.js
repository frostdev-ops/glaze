// The sidebar on Canvas pages (features/sidebar.js, with features/widgets.js for the dock), on the captured Canvas pages
// (test/fixtures/canvas-*.html) as stand-in DOM: the column each kind of page has, Canvas's own nodes never moved or
// copied, late content, the modes by width, the drawer, section folds, and widgets moving between the dock, the board and
// floating through the worker's real changes (lib/sidebar.js, lib/widgets.js). Geometry and transport are supplied.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');
const S = require('../lib/sidebar.js');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const O = 'https://board.instructure.com';
const KEY = S.key('canvas', O, '3');

// opts: fixture, path, width (the window), left (where Canvas's #main starts), stored (storage.local), enhance, widgets
// (run features/widgets.js too), tall (the page's own column is long).
const page = ({ fixture = 'canvas-course-home.html', where = '/courses/25', width = 1440, left = 276, stored = {}, enhance = {}, widgets = false, tall = false } = {}) => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc);
  doc.body = parse(read(`test/fixtures/${fixture}`), doc);
  const store = structuredClone(stored), sent = [], loads = [], storeListeners = [], keyListeners = [], winListeners = [], observers = [];
  const net = { fail: false }, timers = new Map();
  let timerId = 0;
  let queue = Promise.resolve();
  const fire = (v, old) => { for (const f of [...storeListeners]) f(Object.fromEntries(Object.keys(v).map((k) => [k, { newValue: structuredClone(v[k]), oldValue: old[k] }])), 'local'); };
  const area = {
    get: async (ks) => Object.fromEntries([ks].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
    set: async (v) => { if (net.fail) return false; const old = structuredClone(store); Object.assign(store, structuredClone(v)); setImmediate(() => fire(v, old)); return true; },
  };
  const settings = () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, todo: true, sidebar: true, ...enhance }, sidebar: c.sidebarSettings || {}, navbar: c.navbarSettings || {} });
  const sync = { get: async () => ({ enhance: settings().enhance }) };
  const c = {
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, structuredClone,
    setTimeout: (f, ms) => { const id = ++timerId; timers.set(id, { f, ms }); return id; }, clearTimeout: (id) => timers.delete(id), setImmediate,
    addEventListener: (type, f) => winListeners.push({ type, f }), removeEventListener: (type, f) => { const i = winListeners.findIndex((l) => l.type === type && l.f === f); if (i >= 0) winListeners.splice(i, 1); },
    innerWidth: width, innerHeight: 900, location: { origin: O, pathname: where },
    document: doc, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe(target) { this.target = target; this.on = true; } disconnect() { this.on = false; } },
    requestAnimationFrame: (f) => { f(); return 1; }, cancelAnimationFrame() {},
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W, GZ_SIDEBAR: S,
    GZ_CTX: {
      site: 'canvas', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n]), locale: () => 'en', settings,
      account: async () => '3', profile: async () => ({ id: '3', time_zone: 'UTC' }), canvasCourseId: () => where.match(/^\/courses\/(\d+)/)?.[1] || '',
      need: async (f) => { loads.push(f); },
    },
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, getURL: (p) => p, getManifest: () => ({ version: '3' }), sendMessage: (m, cb) => {
        sent.push(structuredClone(m));
        const run = () => (net.failType === m.type ? { ok: false } : m.type === 'glaze:sidebar' ? S.change(structuredClone(m), area, sync) : m.type === 'glaze:widgetLayout' ? W.change(structuredClone(m), area) : { ok: true, timer: W.IDLE });
        queue = queue.then(run).then((r) => cb?.(structuredClone(r)), () => cb?.({ ok: false }));
      } },
      storage: { local: { get: (ks, cb) => area.get(ks).then(cb), set: (v, cb) => { area.set(v).then(() => cb?.()); }, remove: (k, cb) => { for (const x of [k].flat()) delete store[x]; cb?.(); } },
        sync: { get: (k, cb) => cb({}) }, onChanged: { addListener: (f) => storeListeners.push(f), removeListener: (f) => { const i = storeListeners.indexOf(f); if (i >= 0) storeListeners.splice(i, 1); } } },
    },
  };
  doc.boxOf = (e) => {
    if (e.id === 'main' || e.id === 'wrapper') return { left, top: 0, width: width - left, height: 900 };
    if (e.id === 'right-side') return { left: width - 352, top: 0, width: 300, height: tall ? 2000 : 300 };
    if (e.dataset?.gzSidebarHost) return { left: width - 352, top: 0, width: 352, height: 900 };
    return null;
  };
  doc.fire = (target, type, extra = {}) => { const ev = { type, target, key: extra.key, shiftKey: !!extra.shiftKey, button: 0, pointerId: 1, clientX: extra.clientX || 0, clientY: extra.clientY || 0, isTrusted: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (let e = target; e; e = e.parentNode) e.dispatchEvent(ev);
    if (type === 'keydown') for (const f of [...keyListeners]) f(ev);
    return ev; };
  Object.assign(doc, {
    documentElement: doc.root, visibilityState: 'visible', createElement: (tag) => new El(tag, doc), createTextNode: (textContent) => ({ textContent }),
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: (id) => doc.root.all().find((e) => e.id === id) || null,
    addEventListener: (type, f) => { if (type === 'keydown') keyListeners.push(f); }, removeEventListener: (type, f) => { if (type === 'keydown') { const i = keyListeners.indexOf(f); if (i >= 0) keyListeners.splice(i, 1); } },
  });
  c.globalThis = c; vm.createContext(c);
  const side = vm.runInContext(read('features/sidebar.js'), c);
  const ui = widgets ? vm.runInContext(read('features/widgets.js'), c) : null;
  const pass = async () => { side.sync(true); await settle(); ui?.sync(true); await settle(); };
  const resize = async (w) => { c.innerWidth = width = w; for (const l of winListeners.filter((x) => x.type === 'resize')) l.f(); await settle(); };
  const $ = (s) => doc.querySelector(s);
  const mode = () => doc.root.dataset.gzSidebar;
  const host = () => doc.root.all().find((e) => e.dataset?.gzSidebarHost);
  const ours = (e) => { for (let p = e; p && p.tagName; p = p.parentNode) if (/^gz-/.test(p.id) || /(^|\s)gz-/.test(String(p.className))) return true; return false; };
  return { c, doc, side, ui, store, sent, loads, net, timers, observers, storeListeners, winListeners, pass, resize, $, mode, host, ours, fire: doc.fire };
};
const record = (x = {}) => ({ [KEY]: { ...S.clean({ mig: 1, ...x }) } });

const FAMILIES = [
  ['canvas-dashboard-cards.html', '/', 'dashboard', 'native'],
  ['canvas-course-home.html', '/courses/25', 'course-home', 'native'],
  ['canvas-assignment-submit.html', '/courses/26/assignments/9', 'assignment', 'native'],
  ['canvas-course-grades.html', '/courses/25/grades', 'grades', 'native'],
  ['canvas-calendar.html', '/calendar', 'calendar', 'native'],
  ['canvas-syllabus.html', '/courses/25/assignments/syllabus', 'syllabus', 'native'],
  ['canvas-quiz-take.html', '/courses/25/quizzes/4/take', 'quiz', 'native'],
  ['canvas-quiz-results.html', '/courses/25/quizzes/4', 'quiz', 'native'],
  ['canvas-dashboard-planner.html', '/', 'dashboard', 'glaze'], // the planner Dashboard hides Canvas's column inline
  ['canvas-modules.html', '/courses/25/modules', 'other', 'glaze'], // no column on this page
];

test('each kind of Canvas page: its own column dressed in place, or Glaze\'s beside the content where it has none', async () => {
  for (const [fixture, where, family, kind] of FAMILIES) {
    const p = page({ fixture, where, width: 1700, left: 84, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    const nativeEls = p.doc.body.all().map((e) => [e, e.parentNode]);
    await p.pass();
    assert.equal(p.side.context().family, family, fixture);
    const h = p.host();
    assert.equal(h.dataset.gzSidebarHost, kind, fixture);
    if (kind === 'native') {
      assert.equal(h.id, 'right-side-wrapper', fixture);
      assert.ok(h.children[0].className === 'gz-sb-resize' && h.children[1].className === 'gz-sb-head', `${fixture}: Glaze's header first`);
      assert.equal(h.lastElementChild.id, 'gz-sb-widgets', `${fixture}: the widgets last`);
      assert.equal(p.$('#right-side').previousElementSibling.className, 'gz-sb-sec gz-sb-pagehead', `${fixture}: This page right before the column's content`);
      assert.equal(h.getAttribute('role'), 'complementary');
      assert.equal(h.getAttribute('aria-labelledby'), 'gz-sb-title');
    } else {
      assert.equal(h.id, 'gz-sidebar', fixture);
      assert.equal(h.parentNode.id, 'not_right_side', `${fixture}: beside the content, where Canvas's column would be`);
      assert.equal(p.$('#right-side-wrapper').dataset.gzSidebarHost, undefined, `${fixture}: Canvas's own hidden column is left alone`);
    }
    // Canvas's own nodes: every one where it was, none copied.
    for (const [e, parent] of nativeEls) assert.equal(e.parentNode, parent, `${fixture}: ${e.tagName}#${e.id} moved`);
    assert.equal(p.doc.body.all().filter((e) => !p.ours(e)).length, nativeEls.length, `${fixture}: no copies of Canvas's nodes`);
  }
});

test('quiz, grades and calendar controls stay where Canvas put them, in its column', async () => {
  for (const [fixture, where, ids] of [['canvas-quiz-take.html', '/courses/25/quizzes/4/take', ['question_list', 'quiz-time-elapsed']], ['canvas-course-grades.html', '/courses/25/grades', ['student-grades-whatif']], ['canvas-calendar.html', '/calendar', ['minical']]]) {
    const p = page({ fixture, where });
    const before = ids.map((id) => [p.doc.getElementById(id), p.doc.getElementById(id).parentNode]);
    await p.pass();
    for (const [e, parent] of before) { assert.equal(e.parentNode, parent); assert.ok(p.$('#right-side').contains(e), `${e.id} in the column`); }
  }
});

test('an empty page with nothing docked keeps no room, only the edge button; a late section shows the column without rebuilding the dock', async () => {
  const p = page({ fixture: 'canvas-course-home.html', stored: record() });
  const rs = p.$('#right-side');
  rs.replaceChildren();
  await p.pass();
  assert.equal(p.mode(), 'none');
  const edge = p.$('#gz-sb-edge');
  assert.equal(edge.hidden, false);
  assert.equal(edge.parentNode, p.doc.body);
  const dock = p.$('#gz-sb-widgets'), list = p.$('.gz-sb-dock');
  // Canvas fills its column later (its Dashboard does): looked at again, not rebuilt.
  const late = p.doc.createElement('div'); late.append('Recent feedback'); rs.append(late);
  for (const o of p.observers.filter((x) => x.on && x.target === rs)) o.f([]);
  assert.equal(p.mode(), 'expanded');
  assert.equal(edge.hidden, true);
  assert.ok(p.$('#gz-sb-widgets') === dock && p.$('.gz-sb-dock') === list, 'the same dock');
  assert.equal(late.parentNode, rs);
});

test('a column Glaze doesn\'t recognize is left as Canvas has it; one that goes away gets its attributes back', async () => {
  const p = page({ fixture: 'canvas-course-home.html' });
  const wrap = p.$('#right-side-wrapper'), rs = p.$('#right-side');
  wrap.setAttribute('role', 'region');
  p.doc.getElementById('content').append(rs); // its content elsewhere: not a column Glaze knows
  await p.pass();
  assert.equal(p.host().id, 'gz-sidebar');
  assert.equal(p.mode(), 'drawer', 'unsupported native columns keep their layout beside a standalone drawer');
  assert.equal(wrap.dataset.gzSidebarHost, undefined);
  assert.ok(!wrap.all().some(p.ours), 'nothing of Glaze\'s inside it');
  assert.equal(wrap.getAttribute('role'), 'region');

  const q = page({ fixture: 'canvas-course-home.html' });
  const w2 = q.$('#right-side-wrapper');
  await q.pass();
  assert.equal(w2.getAttribute('role'), 'complementary');
  w2.remove(); // Canvas replaced its page
  await q.pass();
  assert.equal(q.host().id, 'gz-sidebar');
  assert.equal(q.mode(), 'drawer', 'host loss uses the standalone drawer');
  assert.equal(w2.getAttribute('role'), null, 'its own attributes back');
  assert.equal(w2.dataset.gzSidebarHost, undefined);
});

test('switching the sidebar off takes every Glaze part away and gives Canvas its column back', async () => {
  const p = page({ stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }), widgets: true });
  const nativeEls = p.doc.body.all().map((e) => [e, e.parentNode]);
  await p.pass();
  assert.ok(p.$('#gz-sb-widgets section[data-tile="notes"]'), 'the docked note');
  p.side.sync(false); p.ui.sync(true); await settle();
  assert.equal(p.doc.root.all().filter(p.ours).length, 0, 'no Glaze node left');
  assert.equal(p.mode(), undefined);
  assert.equal(p.$('#right-side-wrapper').getAttribute('role'), null);
  for (const [e, parent] of nativeEls) assert.equal(e.parentNode, parent);
});

test('turning off during startup cannot leave a storage listener or reactivate the sidebar', async () => {
  const p = page();
  let release;
  p.c.GZ_CTX.need = () => new Promise((r) => { release = r; });
  p.side.sync(true);
  p.side.sync(false);
  release(); await settle();
  // A later loader must not be awaited after teardown either.
  release(); await settle();
  assert.equal(p.storeListeners.length, 0);
  assert.equal(p.side.active(), false);
  assert.equal(p.side.rec(), null);
});

test('the mode follows the room: expanded, collapsed by choice, a drawer when narrow, grades keep 900px', async () => {
  const p = page({ width: 1440, left: 276 });
  await p.pass();
  assert.equal(p.mode(), 'expanded');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sidebar-w'), '352px');
  await p.resize(1280); // 1004 left for the content and the column: under 720 + 16 + 352
  assert.equal(p.mode(), 'drawer');
  assert.equal(p.$('#gz-sb-launch').hidden, false);
  await p.resize(1600);
  assert.equal(p.mode(), 'expanded');
  p.fire(p.$('.gz-sb-toggle'), 'click'); await settle();
  assert.equal(p.mode(), 'collapsed');
  assert.equal(p.store[KEY].open, false, 'the desktop preference is kept');
  await p.resize(1000); await p.resize(1600);
  assert.equal(p.mode(), 'collapsed', 'the drawer never changed it');
  // Grades: the same width keeps 900px for Canvas's table.
  const g = page({ fixture: 'canvas-course-grades.html', where: '/courses/25/grades', width: 1440, left: 276 });
  await g.pass();
  assert.equal(g.mode(), 'drawer');
  const h = page({ fixture: 'canvas-course-home.html', width: 1440, left: 276 });
  await h.pass();
  assert.equal(h.mode(), 'expanded');
});

test('the width: the inner edge by keys, clamped and saved; responsive clamping never writes it', async () => {
  const p = page({ width: 1700, left: 84 });
  await p.pass();
  const grip = p.$('.gz-sb-resize');
  assert.equal(grip.getAttribute('role'), 'separator');
  p.fire(grip, 'keydown', { key: 'ArrowLeft' }); await settle();
  assert.equal(p.store[KEY].width, 368);
  p.fire(grip, 'keydown', { key: 'End' }); await settle();
  assert.equal(p.store[KEY].width, 480);
  await p.resize(1200);
  assert.equal(p.mode(), 'drawer');
  assert.equal(p.store[KEY].width, 480, 'narrow windows show less, but keep the choice');
});

test('teardown cancels an unfinished width drag without changing the saved width', async () => {
  const p = page({ width: 1700, left: 84, stored: record() });
  await p.pass();
  const grip = p.$('.gz-sb-resize');
  p.fire(grip, 'pointerdown', { clientX: 100 });
  p.fire(grip, 'pointermove', { clientX: 50 });
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sidebar-w'), '402px');
  p.side.sync(false);
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sidebar-w'), '352px');
  assert.equal(p.store[KEY].width, 352);
  p.fire(grip, 'pointermove', { clientX: 10 });
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sidebar-w'), '352px');
});

test('the drawer is a dialog: the page behind it inert, Escape closes it, the focus comes back', async () => {
  const p = page({ width: 1000, left: 84 });
  await p.pass();
  assert.equal(p.mode(), 'drawer');
  const launch = p.$('#gz-sb-launch'), h = p.host();
  launch.focus();
  p.fire(launch, 'click'); await settle();
  assert.equal(p.doc.root.dataset.gzSidebarOpen, '');
  assert.equal(h.getAttribute('role'), 'dialog');
  assert.equal(h.getAttribute('aria-modal'), 'true');
  assert.equal(p.$('#content-wrapper').inert, true, 'the content beside it');
  assert.equal(p.doc.getElementById('header').inert, true);
  assert.notEqual(h.inert, true);
  assert.equal(p.doc.activeElement, p.$('.gz-sb-toggle'));
  // An LMS dialog opened from inside it after it opened stays reachable.
  const dialog = p.doc.createElement('div'); dialog.setAttribute('role', 'dialog'); p.doc.body.append(dialog);
  assert.notEqual(dialog.inert, true);
  p.fire(p.$('.gz-sb-title'), 'keydown', { key: 'Escape' }); await settle();
  assert.equal(p.doc.root.dataset.gzSidebarOpen, undefined);
  assert.equal(p.$('#content-wrapper').inert, false);
  assert.equal(p.doc.activeElement, launch);
  assert.equal(launch.hidden, false);
});

test('This page and My widgets fold per kind of page, and Jump to widgets reaches the dock', async () => {
  const stored = record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
  const p = page({ stored, widgets: true, tall: true });
  await p.pass();
  const jump = p.$('.gz-sb-jump');
  assert.equal(jump.hidden, false, 'long page content and docked widgets');
  p.fire(jump, 'click');
  assert.equal(p.doc.activeElement, p.$('#gz-sb-wh'));
  const btn = p.$('.gz-sb-pagehead button');
  p.fire(btn, 'click'); await settle();
  assert.equal(p.host().dataset.gzSbFoldPage, '');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(p.store[KEY].fold, { 'course-home': { page: true } });
  p.fire(p.$('#gz-sb-wh'), 'click'); await settle();
  assert.equal(p.$('.gz-sb-dock').hidden, true);
  // Another kind of page keeps its own.
  const q = page({ fixture: 'canvas-syllabus.html', where: '/courses/25/assignments/syllabus', stored: structuredClone(p.store), widgets: true });
  await q.pass();
  assert.equal(q.host().dataset.gzSbFoldPage, undefined);
  assert.equal(q.$('.gz-sb-dock').hidden, false);
});

test('losing an open drawer host restores the page before using a replacement host', async () => {
  const p = page({ width: 1000, left: 84 });
  await p.pass();
  p.fire(p.$('#gz-sb-launch'), 'click');
  const old = p.host();
  old.remove();
  await p.pass();
  assert.equal(p.doc.root.dataset.gzSidebarOpen, undefined);
  assert.equal(p.$('#content-wrapper').inert, false);
  assert.equal(p.doc.getElementById('header').inert, false);
  assert.equal(old.getAttribute('aria-modal'), null);
  p.fire(p.$('#gz-sb-launch'), 'click');
  assert.equal(p.host().getAttribute('role'), 'dialog');
  p.side.sync(false);
  assert.equal(p.$('#content-wrapper').inert, false);
});

test('document focus suspends an open drawer and releases its inert locks before restoring the sidebar', async () => {
  const p = page({ width: 1000, left: 84 }); await p.pass();
  p.fire(p.$('#gz-sb-launch'), 'click'); assert.equal(p.$('#content-wrapper').inert, true);
  p.doc.root.setAttribute('data-gz-review-focus', ''); p.side.cover();
  assert.equal(p.side.asleep(), true); assert.equal(p.doc.root.hasAttribute('data-gz-sidebar-open'), false);
  assert.equal(p.$('#content-wrapper').inert, false); assert.equal(p.doc.getElementById('header').inert, false);
  p.doc.root.removeAttribute('data-gz-review-focus'); p.side.cover(); await settle();
  assert.equal(p.side.asleep(), false); p.fire(p.$('#gz-sb-launch'), 'click'); assert.equal(p.$('#content-wrapper').inert, true);
});

test('a native dialog in an existing portal stays reachable while the drawer is open', async () => {
  const p = page({ width: 1000, left: 84 });
  const portal = p.doc.createElement('div'); p.doc.body.append(portal);
  await p.pass();
  p.fire(p.$('#gz-sb-launch'), 'click');
  assert.equal(portal.inert, true);
  const dialog = p.doc.createElement('div'); dialog.setAttribute('role', 'dialog'); portal.append(dialog);
  for (const o of p.observers.filter((x) => x.on && x.target === p.doc.body)) o.f([]);
  assert.equal(portal.inert, false, 'the native modal owns focus and inertness now');
  assert.notEqual(p.host().getAttribute('aria-modal'), 'true');
  dialog.remove();
  for (const o of p.observers.filter((x) => x.on && x.target === p.doc.body)) o.f([]);
  assert.equal(portal.inert, true);
  assert.equal(p.host().getAttribute('aria-modal'), 'true');
  p.side.sync(false);
  assert.equal(portal.inert, false);
});

test('a change that couldn\'t be saved is put back as stored, and said so briefly', async () => {
  const p = page({ stored: record() });
  await p.pass();
  p.net.fail = true;
  p.fire(p.$('.gz-sb-pagehead button'), 'click'); await settle();
  assert.equal(p.host().dataset.gzSbFoldPage, undefined, 'back as stored');
  assert.equal(p.$('.gz-sb-note').textContent, "Couldn't save. Try again.");
});

test('the first visit migrates To Do into the dock before showing it; the native list steps aside only once Better To Do is there', async () => {
  const p = page({ stored: { widgetLayout: { tiles: W.TILES.map((id) => ({ id, on: false })), canvasTodo: true, boards: { cdash: [{ id: 'todo', on: true }] } } }, widgets: true });
  await p.pass();
  assert.equal(p.store[KEY].mig, 1);
  assert.equal(p.store[KEY].dest.todo, 'dock');
  const tile = p.$('#gz-sb-widgets section[data-tile="todo"]');
  assert.ok(tile, 'To Do docked');
  assert.ok(p.loads.includes('features/todo.js'));
  // features/todo.js isn't in this stand-in: until its list is there, Canvas's own stays.
  assert.equal(p.doc.root.dataset.gzSidebarTodo, undefined);
});

// ---- the dock and the other places --------------------------------------------------------------------------------
const dash = (x = {}) => page({ fixture: 'canvas-dashboard-cards.html', where: '/', widgets: true, width: 1600, left: 84, ...x });
const lay0 = () => ({ tiles: W.TILES.map((id) => ({ id, on: id === 'notes', size: id === 'notes' ? 'l' : 's' })), canvasTodo: true, filled: ['cdash'],
  boards: { cdash: W.TILES.map((id) => ({ id, on: id === 'notes', size: 'l', ...(id === 'notes' && { x: 40, y: 80, w: 420, h: 220 }) })) } });
const menuItem = (p, id, label) => {
  p.fire(p.$(`section[data-tile="${id}"] .gz-w-dest`), 'click');
  const item = p.$('#gz-sb-menu').children.find((b) => b.textContent === label);
  assert.ok(item, `${id}: ${label} in ${p.$('#gz-sb-menu').children.map((b) => b.textContent)}`);
  p.fire(item, 'click');
};

test('an incidental dock redraw preserves a focused control and its node', async () => {
  const p = dash({ stored: { widgetLayout: lay0(), ...record({ dock: [{ id: 'notes' }, { id: 'timer' }], dest: { notes: 'dock', timer: 'dock' } }) } });
  await p.pass();
  const handle = p.$('section[data-tile="notes"] .gz-w-handle');
  handle.focus();
  await p.side.op([{ op: 'fold', id: 'timer', v: true }]); await settle();
  assert.ok(p.$('section[data-tile="notes"] .gz-w-handle') === handle, 'the focused handle is kept');
  assert.ok(handle.isConnected);
  assert.equal(p.doc.activeElement, handle);
});

test('a saved floating spot survives returning to the board and floating again', async () => {
  const lay = lay0();
  Object.assign(lay.tiles.find((x) => x.id === 'notes'), { float: true, x: 0.2, y: 0.3, w: 333, h: 177 });
  const p = dash({ stored: { widgetLayout: lay, ...record({ dest: { notes: 'float' } }) } });
  await p.pass();
  const spot = () => W.layout(p.store.widgetLayout).tiles.find((x) => x.id === 'notes');
  const before = spot();
  menuItem(p, 'notes', 'Move to Dashboard'); await settle();
  p.fire(p.$('#gz-dash .gz-dash-edit'), 'click');
  menuItem(p, 'notes', 'Float'); await settle();
  const after = spot();
  assert.deepEqual([after.x, after.y, after.w, after.h], [before.x, before.y, before.w, before.h]);
});

test('board → dock → float → board: one instance throughout, and the board and float spots kept', async () => {
  const p = dash({ stored: { widgetLayout: lay0(), ...record() } });
  await p.pass();
  const on = () => p.doc.querySelectorAll('section[data-tile="notes"]');
  assert.equal(on().length, 1);
  const el = on()[0];
  assert.ok(p.$('#gz-dash').contains(el), 'on the board');
  p.fire(p.$('#gz-dash .gz-dash-edit'), 'click');
  menuItem(p, 'notes', 'Move to sidebar'); await settle();
  assert.equal(on().length, 1);
  assert.equal(on()[0], el, 'the same tile, moved');
  assert.ok(p.$('.gz-sb-dock').contains(el), 'docked');
  const kept = W.layout(p.store.widgetLayout).boards.cdash.find((x) => x.id === 'notes');
  assert.deepEqual([kept.on, kept.x, kept.y, kept.w, kept.h], [true, 40, 80, 420, 220], 'the board spot stays in the layout');
  assert.equal(p.store[KEY].dest.notes, 'dock');
  menuItem(p, 'notes', 'Float'); await settle();
  assert.equal(on().length, 1);
  assert.ok(p.$('#gz-float').contains(on()[0]), 'floating');
  assert.equal(p.store[KEY].dest.notes, 'float');
  const floated = W.layout(p.store.widgetLayout).tiles.find((x) => x.id === 'notes');
  assert.ok(floated.float && floated.on);
  menuItem(p, 'notes', 'Move to Dashboard'); await settle();
  assert.equal(on().length, 1);
  assert.ok(p.$('#gz-dash').contains(on()[0]), 'back on the board');
  const back = W.layout(p.store.widgetLayout).boards.cdash.find((x) => x.id === 'notes');
  assert.deepEqual([back.x, back.y, back.w, back.h], [40, 80, 420, 220], 'at its old spot and size');
  // A refresh shows the same.
  const q = dash({ stored: structuredClone(p.store) });
  await q.pass();
  assert.equal(q.doc.querySelectorAll('section[data-tile="notes"]').length, 1);
  assert.ok(q.$('#gz-dash').contains(q.$('section[data-tile="notes"]')));
});

test('in the dock: reorder by buttons and handle keys, fold, height and Auto height; remove then re-add restores them', async () => {
  const stored = { widgetLayout: lay0(), ...record({ dock: [{ id: 'timer' }, { id: 'quotes' }, { id: 'notes' }], dest: { timer: 'dock', quotes: 'dock', notes: 'dock' } }) };
  const p = page({ stored, widgets: true });
  await p.pass();
  const order = () => p.$('.gz-sb-dock').children.map((e) => e.dataset.tile);
  assert.deepEqual(order(), ['timer', 'quotes', 'notes']);
  const t = (id) => p.$(`section[data-tile="${id}"]`);
  assert.equal(t('timer').querySelector('.gz-w-up').disabled, true);
  p.fire(t('notes').querySelector('.gz-w-up'), 'click'); await settle();
  assert.deepEqual(order(), ['timer', 'notes', 'quotes']);
  assert.match(p.$('#gz-sb-title').parentNode.querySelector('.gz-sr').textContent, /Notes moved to 2 of 3/);
  p.fire(t('timer').querySelector('.gz-w-handle'), 'keydown', { key: 'ArrowDown' }); await settle();
  assert.deepEqual(order(), ['notes', 'timer', 'quotes']);
  assert.deepEqual(p.store[KEY].dock.map((x) => x.id), ['notes', 'timer', 'quotes']);
  p.fire(t('quotes').querySelector('.gz-w-fold'), 'click'); await settle();
  assert.equal(t('quotes').querySelector('.gz-w-body').hidden, true);
  p.fire(t('notes').querySelector('.gz-w-vsize'), 'keydown', { key: 'ArrowDown', shiftKey: true }); await settle();
  const h = p.store[KEY].dock.find((x) => x.id === 'notes').h;
  assert.ok(Number.isInteger(h) && h >= W.MIN_H, `a height kept: ${h}`);
  assert.equal(t('notes').querySelector('.gz-w-body').style.height, `${h}px`);
  assert.equal(t('notes').querySelector('.gz-w-vsize').getAttribute('aria-valuenow'), String(h));
  menuItem(p, 'notes', 'Auto height'); await settle();
  assert.equal(p.store[KEY].dock.find((x) => x.id === 'notes').h, undefined);
  assert.equal(t('notes').querySelector('.gz-w-body').style.height, '');
  menuItem(p, 'quotes', 'Remove'); await settle();
  assert.equal(t('quotes'), null);
  assert.equal(p.store[KEY].dest.quotes, 'off');
  // Re-added from Add widgets: back with its fold, in its old place.
  p.fire(p.$('.gz-sb-add'), 'click');
  const row = p.$('.gz-sb-adding').querySelectorAll('li').find((li) => li.children[0].textContent === 'Quote');
  assert.equal(row.children[1].textContent, 'Not shown');
  p.fire(row.children[2], 'click'); await settle();
  assert.deepEqual(order(), ['notes', 'timer', 'quotes']);
  assert.equal(t('quotes').querySelector('.gz-w-body').hidden, true, 'still folded');
});

test('resizing a removed widget never brings it back; course cards never dock', async () => {
  const p = page({ stored: { widgetLayout: lay0(), ...record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) }, widgets: true });
  await p.pass();
  p.side.op([{ op: 'remove', id: 'notes' }, { op: 'height', id: 'notes', h: 300 }]); await settle();
  assert.equal(p.$('section[data-tile="notes"]'), null);
  assert.equal(p.store[KEY].dest.notes, 'off');
  assert.ok(!p.ui.catalog().some((x) => W.course(x.id)));
});

test('floats keep clear of the expanded sidebar', async () => {
  const lay = lay0();
  lay.tiles.find((x) => x.id === 'timer').on = true; lay.tiles.find((x) => x.id === 'timer').float = true;
  const p = page({ stored: { widgetLayout: lay, ...record() }, widgets: true, width: 1600, left: 84 });
  await p.pass();
  assert.equal(p.mode(), 'expanded');
  assert.equal(p.$('#gz-float').style.getPropertyValue('--gz-float-right'), `${352 + W.EDGE}px`);
});

test('a failed dock move is rolled back to what is stored', async () => {
  const p = dash({ stored: { widgetLayout: lay0(), ...record() } });
  await p.pass();
  p.net.fail = true;
  p.fire(p.$('#gz-dash .gz-dash-edit'), 'click');
  menuItem(p, 'notes', 'Move to sidebar'); await settle();
  assert.ok(p.$('#gz-dash').contains(p.$('section[data-tile="notes"]')), 'back on the board');
  assert.equal(p.$('.gz-sb-note').textContent, "Couldn't save. Try again.");
});

test('a failed destination preparation keeps the widget docked and offers retry', async () => {
  for (const label of ['Move to Dashboard', 'Float']) {
    const lay = lay0();
    lay.boards.cdash.find((x) => x.id === 'notes').on = false;
    const p = dash({ stored: { widgetLayout: lay, ...record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) } });
    await p.pass();
    p.net.failType = 'glaze:widgetLayout';
    menuItem(p, 'notes', label); await settle();
    assert.equal(p.store[KEY].dest.notes, 'dock');
    assert.ok(p.$('.gz-sb-dock section[data-tile="notes"]'), 'still docked');
    assert.equal(p.$('.gz-sb-note').textContent, "Couldn't save. Try again.");
  }
});

test('a refused sidebar destination write leaves the existing float reachable', async () => {
  const lay = lay0();
  Object.assign(lay.tiles.find((x) => x.id === 'notes'), { float: true, x: 0.2, y: 0.3 });
  const p = dash({ stored: { widgetLayout: lay, ...record({ dest: { notes: 'float' } }) } });
  await p.pass();
  p.net.failType = 'glaze:sidebar';
  menuItem(p, 'notes', 'Move to Dashboard'); await settle();
  assert.equal(p.store[KEY].dest.notes, 'float');
  assert.ok(p.$('#gz-float section[data-tile="notes"]'), 'the last committed float stays reachable');
  assert.equal(p.$('.gz-sb-note').textContent, "Couldn't save. Try again.");
});

test('mods get where their widget shows, and nothing of the page', async () => {
  const p = page({ stored: { widgetLayout: lay0(), ...record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) }, widgets: true });
  let api = null;
  await p.pass();
  p.ui.declare({ mabcdefghijklmn0: { name: 'Mod', size: 's', fill: (body, a) => { api = a; return {}; } } });
  p.side.op([{ op: 'dock', id: 'mabcdefghijklmn0' }]); await settle();
  p.ui.sync(true); await settle();
  assert.ok(api, 'drawn in the dock');
  assert.equal(api.surface(), 'dock');
  assert.deepEqual(Object.keys(api).sort(), ['id', 'site', 'size', 'surface', 'term', 'who']);
});

// ---- Phase 6: settings, styles, the switch -------------------------------------------------------------------------
const rootMarks = (p) => Object.keys(p.doc.root.dataset).filter((k) => /^gzS(idebar|b)/.test(k));

test('off returns exactly to before (Canvas\'s column, the Dashboard\'s To Do tile and its hiding rule), the dock record kept; on again restores the dock', async () => {
  const lay = W.layout({ canvasTodo: true, boards: { cdash: [{ id: 'todo', on: true }] } });
  const stored = { widgetLayout: lay, ...record({ dock: [{ id: 'todo' }, { id: 'notes' }], dest: { todo: 'dock', notes: 'dock' } }) };
  const sw = {};
  const p = page({ fixture: 'canvas-dashboard-cards.html', where: '/', width: 1700, left: 84, stored, enhance: sw, widgets: true });
  p.c.GZ_TODO = require('../lib/todo.js');
  p.c.GZ_TODO_UI = { mount: (target) => { target.append(Object.assign(p.doc.createElement('section'), { id: 'gz-todo' })); return true; }, unmount() {}, sync() {} };
  const wrapper = p.$('#right-side-wrapper'), attrs = { ...wrapper.attrs }, data = { ...wrapper.dataset };
  // Before the sidebar: the legacy page, as with the switch off from the start.
  sw.sidebar = false;
  p.ui.sync(true); await settle();
  const legacy = { canvasTodo: p.doc.root.hasAttribute('data-gz-canvas-todo'), board: !!p.$('#gz-dash section[data-tile="todo"]') };
  assert.ok(legacy.board, 'the Dashboard\'s To Do tile');
  // On: docked.
  sw.sidebar = true;
  await p.pass();
  assert.ok(p.$('#gz-sb-widgets section[data-tile="todo"]'), 'To Do in the dock');
  assert.ok(!p.$('#gz-dash section[data-tile="todo"]'), 'not on the board too');
  // Off: as the site's part does it (content-canvas.js syncSidebar, then the widgets).
  sw.sidebar = false;
  p.side.sync(false); p.ui.sync(true); await settle();
  assert.deepEqual(rootMarks(p), [], 'no sidebar attribute on <html>');
  for (const k of ['--gz-sidebar-w', '--gz-sb-top', '--gz-sb-foot', '--gz-sb-blur', '--gz-sb-alpha']) assert.equal(p.doc.root.style.getPropertyValue(k), '', k);
  assert.deepEqual({ ...wrapper.attrs }, attrs, 'Canvas\'s column as it was');
  assert.deepEqual({ ...wrapper.dataset }, data);
  assert.deepEqual({ canvasTodo: p.doc.root.hasAttribute('data-gz-canvas-todo'), board: !!p.$('#gz-dash section[data-tile="todo"]') }, legacy, 'the legacy To Do and its hiding rule back');
  assert.ok(!p.$('#gz-sidebar') && !p.$('.gz-sb-head'), 'no Glaze column');
  assert.deepEqual(S.clean(p.store[KEY]).dock.map((x) => x.id), ['todo', 'notes'], 'the dock record survives');
  // The CSS hooks the legacy page relies on are still there.
  assert.match(read('features/apps.css'), /html\[data-gz-canvas-todo\] #right-side :is\(\.Sidebar__TodoListContainer, \.todo-list-header, ul\.to-do-list\) \{ display: none !important; \}/);
  // On again: the same dock.
  sw.sidebar = true;
  await p.pass();
  assert.deepEqual(p.$('#gz-sb-widgets .gz-sb-dock').children.filter((e) => e.dataset?.tile).map((e) => e.dataset.tile), ['todo', 'notes']);
});

test('style: Floating by default, Embedded or like the navigation when chosen; surface, corners, density, order and the header from the settings', async () => {
  const p = page({ stored: record() });
  await p.pass();
  const r = p.doc.root.dataset;
  assert.equal(r.gzSbStyle, 'float', 'Floating by default (owner, 2026-10-20)');
  assert.equal(r.gzSbSurface, 'glass');
  assert.equal(r.gzSbRadius, undefined, 'the Look\'s corners');
  p.c.navbarSettings = { style: 'embed' };
  await p.pass();
  assert.equal(r.gzSbStyle, 'float', 'never chosen: still Floating, whatever the navigation\'s');
  p.c.sidebarSettings = { style: 'auto' };
  await p.pass();
  assert.equal(r.gzSbStyle, 'embed', 'Like the navigation follows it');
  p.c.sidebarSettings = { style: 'embed' };
  p.c.navbarSettings = {};
  await p.pass();
  assert.equal(r.gzSbStyle, 'embed', 'an explicit Embedded is kept');
  assert.equal(D.GZ_SANITIZE({ sidebar: { style: 'embed' } }).sidebar.style, 'embed');
  assert.equal(D.GZ_SANITIZE({}).sidebar.style, 'float');
  p.c.sidebarSettings = { style: 'float', surface: 'solid', radius: 'large', density: 'compact', order: 'widgets', heading: false, blur: 30, opacity: 60, title: 'My stuff' };
  await p.pass();
  assert.deepEqual([r.gzSbStyle, r.gzSbSurface, r.gzSbRadius, r.gzSbDensity, r.gzSbOrder, r.gzSbNotitle], ['float', 'solid', 'large', 'compact', 'widgets', '']);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-blur'), '30px');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-alpha'), '60%');
  assert.equal(p.$('#gz-sb-title').textContent, 'My stuff', 'the name the student gave it, still the landmark\'s label');
  assert.equal(p.host().getAttribute('aria-labelledby'), 'gz-sb-title');
  assert.equal(p.$('#gz-sb-launch').textContent, 'My stuff');
  p.side.sync(false);
  assert.deepEqual(rootMarks(p), [], 'all gone when off');
  // The sheet has a rule set for each style and surface.
  const css = read('features/sidebar.css');
  for (const sel of ['html[data-gz-sb-style="float"]', 'html[data-gz-sb-style="embed"]', 'html[data-gz-sb-surface="solid"]', 'html[data-gz-sb-surface="clear"]', 'html[data-gz-sb-order="widgets"]', '[data-gz-sb-page-hidden]'])
    assert.ok(css.includes(sel), sel);
  // Canvas's ground rule (an id) never wins over the column's surface: the column's selectors carry the ids too.
  assert.match(css, /:is\(#right-side-wrapper, #gz-sidebar, \[data-gz-sidebar-host\]\)\[data-gz-sidebar-host\] \{\s*background: var\(--gz-surface-grain, none\), var\(--gz-sb-fill\) !important/);
  assert.match(css, /html\[data-gz-sidebar\] #right-side-wrapper\[data-gz-sidebar-host\] > #right-side \{\s*background: none !important; border: 0 !important; border-radius: 0 !important/);
});

test('open behaviour, width, room for the page, This page and Jump to widgets follow the settings', async () => {
  const p = page({ stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }), width: 1440, tall: true });
  p.c.sidebarSettings = { open: 'collapsed', width: 400 };
  await p.pass();
  assert.equal(p.mode(), 'collapsed', 'starts collapsed');
  p.$('.gz-sb-toggle').click(); await settle();
  assert.equal(p.mode(), 'expanded', 'expanded on this page');
  assert.equal(S.clean(p.store[KEY]).open, true, 'the account\'s own preference untouched');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sidebar-w'), '400px', 'the settings\' width until one is dragged');
  p.c.sidebarSettings = { open: 'drawer' };
  await p.pass();
  assert.equal(p.mode(), 'drawer', 'drawer only');
  p.c.sidebarSettings = { min: 1200 };
  await p.pass();
  assert.equal(p.mode(), 'drawer', '1440 - 276 - 352 - 16 < 1200');
  p.c.sidebarSettings = { page: 'hidden' };
  await p.pass();
  assert.equal(p.host().dataset.gzSbPageHidden, '');
  assert.equal(p.$('.gz-sb-pagehead').hidden, true);
  p.c.sidebarSettings = { page: 'folded' };
  await p.pass();
  assert.equal(p.host().dataset.gzSbPageHidden, undefined);
  assert.equal(p.host().dataset.gzSbFoldPage, '', 'folded at first');
  p.$('.gz-sb-pagehead button').click(); await settle();
  assert.equal(p.host().dataset.gzSbFoldPage, undefined, 'unfolded: kept for this kind of page');
  p.c.sidebarSettings = { jump: false };
  await p.pass();
  assert.equal(p.$('.gz-sb-jump').hidden, true);
});

test('a kind of page turned off shows the page as Canvas has it, with no dock; others keep the sidebar', async () => {
  const p = page({ stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const wrapper = p.$('#right-side-wrapper'), attrs = { ...wrapper.attrs };
  p.c.sidebarSettings = { off: ['course'] };
  await p.pass();
  assert.deepEqual(rootMarks(p), []);
  assert.equal(p.side.host(), null);
  assert.deepEqual({ ...wrapper.attrs }, attrs);
  assert.equal(wrapper.dataset.gzSidebarHost, undefined);
  p.c.sidebarSettings = { off: ['quiz'] };
  await p.pass();
  assert.equal(p.mode(), 'expanded');
  assert.equal(wrapper.dataset.gzSidebarHost, 'native');
});

test('Canvas discussion topics and assignment pages each get their family', async () => {
  for (const [fixture, where, family, kind] of [['canvas-discussion-topic.html', '/courses/2/discussion_topics/5', 'discussion', 'glaze'], ['canvas-assignment.html', '/courses/25/assignments/171', 'assignment', 'native'], ['canvas-submission.html', '/courses/2/assignments/7/submissions/3', 'assignment', 'glaze']]) {
    const p = page({ fixture, where, width: 1700, left: 84, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    const nativeEls = p.doc.body.all().map((e) => [e, e.parentNode]);
    await p.pass();
    assert.equal(p.side.context().family, family, fixture);
    assert.equal(p.host().dataset.gzSidebarHost, kind, fixture);
    for (const [e, parent] of nativeEls) assert.equal(e.parentNode, parent, `${fixture}: ${e.tagName}#${e.id} moved`);
  }
});

test('Add widgets opened before the renderer loads receives its catalog without another click', async () => {
  const p = page({ widgets: true, stored: record() });
  p.side.sync(true); await settle();
  p.$('.gz-sb-add').click();
  assert.equal(p.$('.gz-sb-row'), null, 'the renderer has not loaded yet');
  p.ui.sync(true); await settle();
  const row = p.$('#gz-sb-adding').querySelectorAll('.gz-sb-row').find((x) => x.textContent.includes('Focus timer'));
  assert.ok(row?.querySelector('button'), 'the open chooser receives the timer when the renderer is ready');
  row.querySelector('button').click(); await settle();
  assert.equal(p.store[KEY].dest.timer, 'dock');
});

test('destination menus near the window edges remain reachable, including in RTL', async () => {
  const p = page(); await p.pass();
  const boxOf = p.doc.boxOf;
  p.doc.boxOf = (e) => e.id === 'gz-sb-menu' ? { left: 0, top: 0, width: 240, height: 160 } : boxOf(e);
  const btn = p.$('.gz-sb-more');
  for (const dir of ['ltr', 'rtl']) {
    p.doc.root.dir = dir;
    btn.box = { left: 0, top: 870, width: 32, height: 30 };
    p.side.menu(btn, [{ label: 'Move to sidebar', run() {} }]);
    const menu = p.$('#gz-sb-menu');
    assert.ok(parseFloat(menu.style.top) + 160 <= p.c.innerHeight - 8, 'the menu fits above the bottom edge');
    const edge = parseFloat(menu.style[dir === 'rtl' ? 'left' : 'right']);
    assert.ok(edge >= 8 && edge + 240 <= p.c.innerWidth - 8, 'the menu fits horizontally');
    p.fire(menu.children[0], 'keydown', { key: 'Escape' });
  }
});

test('Canvas reserves the footer height before it scrolls into view, without measuring on scroll', async () => {
  const p = page();
  const footer = p.doc.createElement('footer'); footer.id = 'gz-footer';
  footer.box = { left: 0, top: 1000, width: 1440, height: 32 };
  footer.getClientRects = () => [footer.getBoundingClientRect()];
  p.doc.body.append(footer);
  await p.pass();
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-foot'), '32px', 'reserve space before the footer enters the window');
  footer.box.top = 868;
  await p.resize(1440);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-foot'), '32px', 'scrolling the page cannot shrink the column under the pointer');
  assert.equal(p.winListeners.some((x) => x.type === 'scroll'), false, 'no per-scroll layout reads');
  p.side.sync(false);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-foot'), '', 'teardown restores the page');
});

test('a disabled page never starts the sidebar runtime, and disabling an active page removes its listeners', async () => {
  const p = page({ stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  p.c.sidebarSettings = { off: ['course'] };
  await p.pass();
  assert.equal(p.storeListeners.length, 0, 'no storage observer while off');
  assert.equal(p.winListeners.filter((x) => x.type === 'resize').length, 0, 'no resize listener while off');
  assert.equal(p.loads.length, 0, 'no state or migration work on a disabled page');
  p.c.sidebarSettings = {};
  await p.pass();
  assert.equal(p.side.active(), true);
  p.c.sidebarSettings = { off: ['course'] };
  await p.pass();
  assert.equal(p.storeListeners.length, 0);
  assert.equal(p.winListeners.filter((x) => x.type === 'resize').length, 0);
  assert.ok(p.observers.every((x) => !x.on));
});

test('resizing begins at the displayed settings width, with keyboard and pointer in either direction', async () => {
  for (const dir of ['ltr', 'rtl']) {
    const p = page({ width: 1800, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
    p.doc.root.dir = dir;
    p.c.sidebarSettings = { width: 416 };
    await p.pass();
    p.fire(p.$('.gz-sb-resize'), 'keydown', { key: dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft' });
    await settle();
    assert.equal(p.side.rec().width, 432, `${dir}: one keyboard step from the visible width`);
    await p.side.op([{ op: 'reset' }]); await settle();
    const grip = p.$('.gz-sb-resize');
    p.fire(grip, 'pointerdown', { clientX: 1200 });
    p.fire(grip, 'pointermove', { clientX: dir === 'rtl' ? 1220 : 1180 });
    p.fire(grip, 'pointerup', { clientX: dir === 'rtl' ? 1220 : 1180 });
    await settle();
    assert.equal(p.side.rec().width, 436, `${dir}: drag from the visible width`);
    p.side.sync(false);
  }
});

test('each new route starts at the configured expansion without forgetting a choice during the same route', async () => {
  const p = page({ width: 1800, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  p.c.sidebarSettings = { open: 'expanded' };
  await p.pass();
  p.$('.gz-sb-toggle').click(); await settle();
  assert.equal(p.mode(), 'collapsed');
  await p.pass();
  assert.equal(p.mode(), 'collapsed');
  p.c.location.pathname = '/courses/25/assignments/9';
  await p.pass();
  assert.equal(p.mode(), 'expanded', 'the next route starts expanded');
});

test('a floating card counts its outside inset when keeping the main content minimum', async () => {
  const p = page({ fixture: 'canvas-course-grades.html', where: '/courses/25/grades', width: 1352, left: 84,
    stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  await p.pass();
  assert.equal(p.mode(), 'drawer', '900 + 352 + 16 leaves no room for the floating inset');
  p.c.sidebarSettings = { style: 'embed' };
  await p.pass();
  assert.equal(p.mode(), 'expanded', 'the flush column fits at the exact threshold');
  p.c.sidebarSettings = { style: 'float' };
  await p.resize(1364);
  assert.equal(p.mode(), 'expanded', 'the floating card fits with its inset');
});

test('Canvas page switches restore the legacy To Do hook when that page kind is disabled', async () => {
  const p = page();
  const calls = [];
  p.c.sidebarSettings = { off: ['course'] };
  await p.pass();
  p.c.window = p.c; p.c.top = p.c;
  p.c.I = { links: [1], get settings() { return p.c.GZ_CTX.settings(); } };
  p.c.need = async () => {};
  p.c.GZ_TODO_UI = { sync: (v) => calls.push(v) };
  const hooks = read('content-canvas.js').match(/ {2}const sidebarHere = .*\n(?: {2}const \w+ = .*\n)*? {2}const syncTodo = .*\n/)[0];
  await vm.runInContext(`${hooks}\nsyncTodo();`, p.c);
  assert.equal(calls.at(-1), true, 'legacy To Do runs on a disabled course page');
  p.c.GZ_SIDEBAR_UI = undefined;
  await vm.runInContext('syncTodo();', p.c);
  assert.equal(calls.at(-1), true, 'legacy To Do also runs before the disabled sidebar file arrives');
});

test('Canvas off matches the frozen pre-sidebar DOM and html attributes, including the Dashboard and To Do board tile', async () => {
  const baseline = require('./fixtures/sidebar-legacy.json').canvas;
  const snapshot = require('./sidebar-snapshot.js');
  for (const kindOff of [false, true]) {
    const sw = { sidebar: false, widgets: false, notes: false, pet: false, todo: true };
    const p = page({ fixture: 'canvas-dashboard-cards.html', where: '/', width: 1700, left: 84, widgets: true, enhance: sw,
      stored: { widgetLayout: W.layout({ canvasTodo: true, boards: { cdash: [{ id: 'todo', on: true }, { id: 'notes', on: false }] } }) } });
    p.c.GZ_TODO = require('../lib/todo.js');
    p.c.GZ_TODO_UI = { sync() {}, mount() {}, unmount() {} };
    p.ui.sync(true); await settle();
    assert.deepEqual(snapshot(p, ['#right-side-wrapper', '#gz-dash']), baseline, 'off from startup');
    const native = p.$('#right-side').children.map((e) => [e, e.parentNode]);
    sw.sidebar = true;
    await p.pass();
    if (kindOff) p.c.sidebarSettings = { off: ['dashboard'] }; else sw.sidebar = false;
    p.side.sync(!kindOff ? false : true); p.ui.sync(true); await settle();
    assert.deepEqual(snapshot(p, ['#right-side-wrapper', '#gz-dash']), baseline, `off after on, page switch: ${kindOff}`);
    for (const [e, parent] of native) assert.equal(e.parentNode, parent);
    assert.equal(p.$('.gz-sb-head'), null);
  }
});

test('turning off cancels the failed-start retry timer', async () => {
  const p = page();
  p.c.GZ_CTX.account = async () => '';
  await p.pass();
  assert.equal([...p.timers.values()].filter((x) => x.ms === 60000).length, 1);
  p.side.sync(false);
  assert.equal(p.timers.size, 0, 'no startup retry or status timer survives off');
});

test('a renamed sidebar renders a sanitized length-limited title as text in its labelled landmark', async () => {
  const p = page({ width: 1800, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  const raw = ' \u202e<img src=x onerror=alert(1)> ' + '💠'.repeat(50);
  p.c.sidebarSettings = { title: raw };
  await p.pass();
  assert.equal(p.$('#gz-sb-title').textContent, D.GZ_SANITIZE({ sidebar: { title: raw } }).sidebar.title);
  assert.equal([...p.$('#gz-sb-title').textContent].length, 40);
  assert.equal(p.$('#gz-sb-title img'), null);
  assert.equal(p.host().getAttribute('aria-labelledby'), 'gz-sb-title');
  assert.equal(p.host().getAttribute('role'), 'complementary');
});

test('a disabled Canvas page kind keeps the legacy widget-loader boundary in course frames', async () => {
  const p = page();
  p.c.sidebarSettings = { off: ['course'] };
  p.c.window = p.c; p.c.top = {};
  p.c.I = { links: [1], tabFrame: 'course', get settings() { return p.c.GZ_CTX.settings(); } };
  const src = read('content-canvas.js');
  const hooks = ['sidebarHere', 'sidebarOn', 'widgetsHere'].map((n) => src.match(new RegExp(` {2}const ${n} = .*\\n`))?.[0] || '').join('');
  assert.equal(vm.runInContext(`${hooks}\n!!widgetsHere();`, p.c), false);
  p.c.sidebarSettings = {};
  assert.equal(vm.runInContext('!!widgetsHere();', p.c), true);
});

test('a late site registration or cleared test-copy storage retries an unfinished migration', async () => {
  const p = page(); p.net.failType = 'glaze:sidebar';
  await p.pass();
  assert.equal(p.side.rec().mig, 0);
  p.net.failType = '';
  for (const fn of [...p.storeListeners]) fn({ ultra: { newValue: ['https://school.test'] } }, 'local');
  await settle();
  assert.equal(p.side.rec().mig, 1, 'registration finishing after the first migration request recovers without a reload');
  delete p.store[KEY];
  for (const fn of [...p.storeListeners]) fn({ [KEY]: { newValue: undefined } }, 'local');
  for (const fn of [...p.storeListeners]) fn({ freshDefaults: { newValue: { fresh: true, pending: false } } }, 'local');
  await settle();
  assert.equal(p.store[KEY].mig, 1, 'the localhost clear/install sequence recreates the current account record');
});
