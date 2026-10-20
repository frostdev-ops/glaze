// The stand-in Ultra pages the sidebar's Ultra tests run features/sidebar.js (and features/widgets.js) on: test/
// sidebar-ultra.test.js and test/sidebar-absorb.test.js. No tests here.
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

// Pages as Ultra builds them live (captured 2026-10-20, structure only): a discussion, whose details column is a column of
// its grid beside the thread; an assignment's overview, scrolling inside its own panel, with Grades / Attempts as its
// grid's side column; an attempt (its details panel and its footer; structure from the owner's screenshot); the
// Gradebook, a course tool page in an absolute panel the course's whole width. A mismatch: an overview whose attempts
// section has no title, and an attempt whose details hold a button.
const LIVE_PATHS = { discussion: '/ultra/courses/_101_1/discussion/_9_1', assessment: '/ultra/courses/_101_1/assessment/_7_1/overview',
  attempt: '/ultra/courses/_101_1/assessment/_7_1/attempt', gradebook: '/ultra/courses/_101_1/grades', mismatch: '/ultra/courses/_101_1/assessment/_7_1/overview' };
const panel = (el, inside) => el('section', 'assessment-overview-modern-panel routed-page route-view-container', el('learning-module-panel-view', 'routed-page-body',
  el('div', 'table-of-contents-disabled', el('div', 'panel-content-body', el('div', 'root-learning-module-panel', Object.assign(el('div', 'content-item-container', inside), { id: 'learningModulePanelContainerId' }))))));
const overview = (el, titled = true) => {
  const view = el('a', 'button button-attempt js-multiple', 'View instructions');
  view.setAttribute('href', '#instructions');
  const attempts = el('div', 'overview-section overview-attempts-section overview-attempts-section-container', ...(titled ? [Object.assign(el('h2', 'section-label', 'Grades / Attempts'), { id: 'grades-attempts-header' })] : []), el('div', 'attempts', 'Attempts: Unlimited'), view);
  return el('div', 'content-item-container-children', el('content-body', '', el('div', 'base-body', el('div', 'content-root', el('div', 'standard-content-body',
    el('div', 'assessment-overview-grid', el('div', 'overview-section overview-description-section main-section-container', 'Description'),
      el('div', 'overview-section overview-due-date-section main-section-container', 'Due date'), attempts,
      el('div', 'overview-section assessment-details-section main-section-container', 'Details')))))));
};
const attemptView = (el, extra = []) => {
  const rubric = el('a', '', 'This item is graded with a rubric');
  rubric.setAttribute('href', '#rubric');
  return el('bb-assignment-attempt-authoring-panel', '', el('div', 'makeStylesdetails-12', el('h2', '', 'Details & Information'), el('div', '', 'Assessment due date'), el('div', '', 'Attempts'), rubric, el('div', '', 'Grading'), el('div', '', 'Description'), ...extra),
    el('div', 'answer', el('div', 'editor', 'Your answer')), el('div', 'makeStylesfooter-3', Object.assign(el('button', 'save', 'Save and Close'), { type: 'button' }), Object.assign(el('button', 'submit', 'Submit'), { type: 'button' })));
};
const LIVE = {
  discussion: (inner, el) => inner.append(el('section', 'routed-page route-view-container', el('content-page-header', '', 'A discussion'), el('div', 'routed-page-body',
    el('div', 'students-infinite-scroll-wrap in-view-container-for-large', el('section', 'panel-content in-view-container-for-small-medium js-skip-link-target', Object.assign(el('div', '',
      el('div', 'panel-content-inner', Object.assign(el('div', 'full course-discussion js-course-skip-link-target', el('div', 'course-main-container',
        el('div', 'discussion-thread', 'The thread'),
        el('div', 'layer-details', el('div', '', el('bb-discussion-settings', '', el('div', 'full-panel-details', el('div', 'discussion-settings student-details', 'Details & Information')))),
          Object.assign(el('div', '', el('div', 'discussion-participants show-for-large-up', 'Participation')), { id: 'full-panel-details' })))), { id: 'full-discussions' }))), { id: 'discussions-tabpanel' })))))),
  assessment: (inner, el) => inner.append(panel(el, overview(el))),
  mismatch: (inner, el) => inner.append(panel(el, overview(el, false)), panel(el, attemptView(el, [el('button', 'more', 'More')]))),
  attempt: (inner, el) => inner.append(panel(el, attemptView(el))),
  gradebook: (inner, el) => inner.append(el('section', 'course route-view-container', el('div', 'course-content-container', el('div', 'panel-wrap hide-in-background grades',
    el('main', 'course-main-content', el('div', 'course-tool-content', el('section', 'guidance-wrapper gradebook-panel route-view-container', el('table', 'grades', 'Grades')))))))),
};

// at: 'courses' | 'outline' | 'detail' | 'stream' (no column), or a LIVE page; width: the window; stored: storage.local; enhance;
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
  const where = { courses: '/ultra/course', outline: '/ultra/courses/_101_1/outline', detail: '/ultra/courses/_101_1/outline/discussion/_9_1', stream: '/ultra/stream',
    ...LIVE_PATHS }[at];
  if (LIVE[at]) LIVE[at](inner, el);
  if (at === 'courses') {
    inner.append(el('section', 'base-courses-container route-view-container', el('div', 'base-courses-header-container', el('h1', 'page-title', 'Courses'), el('div', 'base-header-tools')),
      el('div', 'base-courses-content', el('div', 'courses-panel', el('div', 'base-courses')), el('div', 'todo-panel js-todo-panel-skip-link-target', el('bb-todo', 'react-container', 'Due soon: Essay')))));
  } else if (at !== 'stream' && !LIVE[at]) {
    const faculty = el('bb-course-instructors', '', 'Course Faculty');
    const details = el('div', 'js-details-and-actions outline-action-block', 'Details & Actions');
    const sched = el('div', 'conditional-block', 'Schedule');
    inner.append(el('div', 'course-content-container', el('div', 'panel-wrap', el('div', 'bb-course-navigation', 'Course'), el('section', 'course-outline-content', 'Week 1'), el('aside', 'outline-actions', faculty, details, sched))));
    if (at === 'detail') inner.append(el('div', 'layer-content', 'A discussion'), el('div', 'layer-details', el('div', 'discussion-settings', 'Details & Information'), el('div', 'discussion-participants', 'Participation')));
  }
  const store = structuredClone(stored), sent = [], loads = [], storeListeners = [], winListeners = [], observers = [], sizes = [], docListeners = [], todoCalls = [];
  let queue = Promise.resolve();
  const fire = (v, old) => { for (const f of [...storeListeners]) f(Object.fromEntries(Object.keys(v).map((k) => [k, { newValue: structuredClone(v[k]), oldValue: old[k] }])), 'local'); };
  const area = {
    get: async (ks) => Object.fromEntries([ks].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
    set: async (v) => { const old = structuredClone(store); Object.assign(store, structuredClone(v)); setImmediate(() => fire(v, old)); return true; },
  };
  const settings = () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, todo: true, sidebar: true, dashboard: true, ...enhance }, sidebar: c.sidebarSettings || {} });
  const sync = { get: async () => ({ enhance: settings().enhance }) };
  const c = {
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, structuredClone,
    setTimeout: () => 0, clearTimeout() {}, setImmediate,
    addEventListener: (type, f) => winListeners.push({ type, f }), removeEventListener: (type, f) => { const i = winListeners.findIndex((l) => l.type === type && l.f === f); if (i >= 0) winListeners.splice(i, 1); },
    innerWidth: width, innerHeight: 900, location: { origin: O, pathname: where, href: `${O}${where}` },
    document: doc, ResizeObserver: class { constructor(f) { this.f = f; this.targets = []; sizes.push(this); } observe(e) { this.targets.push(e); } disconnect() { this.targets = []; } },
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
    if (e.id === 'main-content-inner' || e.className === 'course-content-container' || e.className === 'course-outline-content') return { left: 200, top: 0, width: c.innerWidth - 200, height: 900 };
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
    addEventListener(type, f) { if (!docListeners.some((l) => l.type === type && l.f === f)) docListeners.push({ type, f }); },
    removeEventListener(type, f) { const i = docListeners.findIndex((l) => l.type === type && l.f === f); if (i >= 0) docListeners.splice(i, 1); },
  });
  // Geometry used only by absorption's conservative checks. The browser check supplies real layout and hit-testing.
  const nativeBox = doc.boxOf;
  doc.boxOf = (e) => {
    const x = c.innerWidth - 336;
    if (e.className === 'gz-sb-slot') return { left: x, top: 160, width: 320, height: parseFloat(e.style.getPropertyValue('height')) || 0 };
    if (e.className === 'gz-sb-head') return { left: x, top: 60, width: 320, height: 50 };
    if (e.className.includes('gz-sb-pagehead')) return { left: x, top: 120, width: 320, height: 30 };
    if (e.id === 'gz-sb-widgets') return { left: x, top: 380, width: 320, height: 100 };
    if (e.className === 'gz-sb-resize') return { left: x - 16, top: 60, width: 8, height: 800 };
    if (e.className.includes('overview-attempts-section')) return { left: doc.getElementById('gz-sb-absorb') ? x : 900, top: 160, width: 320, height: 200 };
    if (e.className.includes('button-attempt')) return { left: doc.getElementById('gz-sb-absorb') ? x + 10 : 910, top: 290, width: 290, height: 40 };
    return nativeBox(e);
  };
  c.getComputedStyle = (e) => ({ display: e.className === 'assessment-overview-grid' ? 'grid' : 'block', visibility: 'visible',
    gridTemplateColumns: '600px 0px 392px', gridColumnStart: '3', gridColumnEnd: 'span 1', gridRowStart: '1', gridRowEnd: 'span 2',
    transform: 'none', perspective: 'none', filter: 'none', backdropFilter: 'none', clipPath: 'none', opacity: '1', isolation: 'auto',
    contain: 'none', containerType: 'normal', willChange: 'auto', position: 'static', zIndex: 'auto', getPropertyValue: () => '' });
  doc.elementFromPoint = (x, y) => {
    const sec = doc.querySelector('.overview-attempts-section'), view = sec?.querySelector('a');
    return view && y > 290 && y < 330 ? view : sec;
  };
  c.globalThis = c; c.window = c; c.top = c;
  // Better To Do, as far as the dock needs it: mount puts its one list in the tile, unmount takes it away; sync is the
  // legacy path (the site's own places), which must not run while the dock has it.
  if (todo) {
    let box = null;
    c.GZ_TODO_UI = {
      mount: (target, x) => { todoCalls.push(['mount', x.courseId, x.scope]); if (!box) { box = Object.assign(make('section'), { id: 'gz-todo' }); box.setAttribute('data-ready', ''); } target.append(box); return true; },
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
  const mutate = (target, change = {}) => { for (const o of observers.filter((x) => x.on && x.targets.includes(target))) o.f([{ target, addedNodes: [], removedNodes: [], ...change }]); };
  const event = (type, extra = {}) => { for (const l of [...docListeners, ...winListeners].filter((l) => l.type === type)) l.f({ type, ...extra }); };
  return { c, doc, side, ui, store, sent, loads, observers, sizes, docListeners, winListeners, event, todoCalls, pass, resize, $, mode, host, ours, mutate, el, fire: doc.fire };
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

module.exports = { page, record, natives, unmoved, settle, read, KEY, O, CARD, LIVE_PATHS };
