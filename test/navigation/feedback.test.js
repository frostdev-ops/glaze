// A click on Ultra answering within its frame (navigation/page/feedback.js, enhance.feedback): what a press is on looks current
// from the pointerdown (Glaze's bar, the course-tab strip, a course's own tabs, course cards) until the press is cancelled,
// the page doesn't change or the site's own mark takes over; the page a click opens shows a skeleton in Ultra's main area,
// in place of its spinners, until that page's view is ready, an instant copy takes over or 20 s pass. Never in the hidden
// standby; nothing with the switch off. The page script runs in a VM on the stand-in DOM, in the live pages' shapes
// (glaze-plans/perf-ultra/0b/live-shapes-2026-10-31.md), with a clock, frames and observers the test turns.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches } = require('../stand-in-dom.js');
const { cssRules, winner } = require('../helpers/css-cascade.cjs');
const D = require('../../extension/content/defaults.js');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const ORIGIN = 'https://school.blackboard.com', CDN = 'https://cdn.ultra.test';

// What the page script asks of an element beyond the stand-in: matches(), its root (a shadow root names its host), whether it
// is on screen and connected through a shadow host, as the DOM has them.
Object.defineProperties(El.prototype, {
  matches: { value(s) { return matches(this, s); }, configurable: true },
  getRootNode: { value() { let n = this; while (n.parentNode) n = n.parentNode; return n; }, configurable: true },
  getClientRects: { value() {
    for (let n = this; n; n = n.parentNode || n.host) if (n.hidden) return [];
    return [this.getBoundingClientRect()];
  }, configurable: true },
  isConnected: { get() { let n = this; for (;;) { if (n.parentNode) n = n.parentNode; else if (n.host) n = n.host; else break; } return n === this.doc.root; }, configurable: true },
});

const make = (doc) => (tag, attrs = {}, ...kids) => {
  const e = new El(tag, doc);
  for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val);
  e.append(...kids);
  return e;
};
const COURSE = '_101_1';
const TOOLS = [['outline', 'outline', 'Content'], ['calendar', 'calendar', 'Calendar'], ['announcement', 'announcements', 'Announcements'], ['discussion', 'engagement', 'Discussions'], ['grades', 'grades', 'Gradebook']];

// The top page of an Ultra site: the base page (its main area with the Courses list), on a course's page the course over it
// (its tabs and tool area), Glaze's bar (an open shadow root) and the course-tab strip.
const site = ({ at = `/ultra/courses/${COURSE}/outline`, feedback = true, on = true, name = '', boot = false } = {}) => {
  const doc = {}, el = make(doc);
  doc.root = new El('#root', doc);
  const html = el('html'), body = el('body');
  doc.root.append(html); html.append(body);
  const location = { origin: ORIGIN, pathname: at.split('?')[0], search: '', href: ORIGIN + at };
  const go = (to) => Object.assign(location, { pathname: to.split('?')[0], search: to.includes('?') ? `?${to.split('?')[1]}` : '', href: ORIGIN + to });

  // The page's main area, its Courses list in it.
  const card = (cid, title) => el('bb-base-course-card', {}, el('article', { id: `course-list-course-${cid}`, class: 'element-card course-element-card' },
    el('div', { class: 'element-details summary' }, el('a', { class: 'course-title', href: `/ultra/courses/${cid}/outline` }, el('h4', { class: 'js-course-title-element' }, title))),
    el('button', { class: 'gz-cm-btn', type: 'button' })));
  const baseMain = el('main', { id: 'main-content', class: 'bb-offcanvas-container' },
    el('section', { class: 'base-courses-container route-view-container' }, el('div', { class: 'default-group' }, card(COURSE, 'Course One'), card('_102_1', 'Course Two'))));
  const inner = el('div', { class: 'inner-wrap' }, el('bb-base-layout', {}, el('div', { class: 'base' }, baseMain)));
  body.append(el('div', { id: 'site-wrap' }, inner));

  // A course over it: its tabs and its tool area, the tool's view in it.
  const course = { section: null, main: null, tools: null, links: {} };
  const openCourse = (tool, view) => {
    course.section?.remove();
    course.links = {};
    const list = el('ul', { class: 'MuiList-root bb-ui-navigation-list-horizontal' }, ...TOOLS.map(([id, p, label]) => {
      const a = el('a', { class: `MuiButtonBase-root MuiListItemButton-root js-course-${id}-tool`, href: `/ultra/courses/${COURSE}/${p}` }, label);
      if (id === tool) a.setAttribute('aria-current', 'page');
      course.links[id] = a;
      return el('li', {}, a);
    }));
    course.nav = el('div', { class: 'js-course-navigation' }, el('nav', {}, list));
    course.tools = el('div', { class: 'course-tool-content' }, ...(view ? [view] : []));
    course.main = el('main', { class: 'course-main-content' }, el('div', { class: 'bb-course-navigation' }, el('bb-course-navigation', {}, course.nav)), course.tools);
    course.section = el('section', { class: 'course bb-offcanvas-container route-view-container' },
      el('div', { class: 'course-content-container' }, el('div', { class: 'panel-wrap hide-in-background modern' }, course.main)));
    inner.append(course.section);
  };
  // Each tool's view as the live page has it, with synthetic text.
  const VIEW = {
    outline: () => el('section', { class: 'course-outline-content route-view-container' }, el('div', { class: 'js-content-outline course-outline-content-list' },
      ...[1, 2, 3].map((n) => el('div', { class: 'root content-list-item' }, el('div', { class: 'itemContainer' }, `Item ${n}`))))),
    announcement: () => el('section', { class: 'route-view-container' }, el('announcement-list', {}, el('table', { class: 'table-content sortable-table' },
      el('tbody', {}, el('tr', { class: 'announcement-item-row' }, el('td', {}, 'Week 7')))))),
    grades: () => el('section', { class: 'guidance-wrapper gradebook-panel route-view-container' }, el('course-student-grades', { id: 'student-tab-panel-grades' },
      el('table', { id: 'course-student-grades-sortable-table' }, el('tbody', {}, el('tr', { class: 'MuiTableRow-root' }, el('td', {}, 'Essay 1')))))),
    discussion: () => el('section', { class: 'route-view-container' }, el('h2', {}, 'Discussions'), el('div', {}, 'Introductions')),
  };
  const spinners = () => [1, 2, 3, 4].map(() => el('div', { class: 'spinner bb-secondary-color-2' }));
  if (at.startsWith('/ultra/courses/')) openCourse('outline', VIEW.outline());

  // Glaze's bar: links (one to Ultra's CDN, as a resolved href names it), an action, a course tab and its tools.
  const host = el('div', { id: 'gz-navbar' });
  const shadow = host.attachShadow({ mode: 'open' });
  const bar = {
    grades: el('a', { class: 'item', 'data-id': 'grades', href: `${CDN}/ultra/grades` }, el('span', { class: 'label' }, 'Grades')),
    courses: el('a', { class: 'item', 'data-id': 'course', href: `${ORIGIN}/ultra/course`, 'aria-current': 'page' }, 'Courses'),
    away: el('a', { class: 'item', 'data-id': 'mod:x.y', href: 'https://elsewhere.test/', target: '_blank' }, 'Elsewhere'),
    action: el('button', { class: 'item', 'data-id': 'glaze:settings', type: 'button' }, 'Glaze'),
    tab: el('button', { class: 'chip ctab-go', 'data-act': 'tab', 'data-cid': '_102_1', type: 'button' }, 'Course Two'),
    pin: el('button', { class: 'ctab-do', 'data-act': 'tab-pin', type: 'button' }),
  };
  shadow.append(el('nav', { class: 'rail' }, bar.grades, bar.courses, bar.away, bar.action, el('div', { class: 'ctab' }, bar.tab, el('span', { class: 'ctab-tools' }, bar.pin))));
  const strip = el('div', { id: 'gz-ctabs' });
  const stripTab = el('div', { class: 'gz-ctab', role: 'tab', 'aria-selected': 'false', 'data-course-id': '_102_1' }, el('span', { class: 'gz-ctab-name' }, 'Course Two'), el('span', { class: 'gz-ctab-x' }));
  strip.append(stripTab);
  body.prepend(host);
  body.append(strip);
  // A cold load (boot): Ultra's boot screen in the body and nothing of its app drawn yet; the test draws it (layout, openCourse).
  const layout = inner.firstElementChild;
  let ila = null;
  if (boot) {
    ila = el('div', { id: 'initial-load-area', class: 'mode-light' }, el('div', { class: 'spinner scale-bounce-in bb-secondary-color-2' }));
    layout.remove();
    course.section?.remove();
    body.prepend(ila);
  }

  // Boxes: the base page's main area and a course's tool area at their places; the skeleton where its transform puts it.
  doc.boxOf = (e) => {
    if (e.id === 'gz-skel') { const [, x = 0, y = 0] = String(e.style.transform || '').match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/) || []; return { left: +x, top: +y, width: 10, height: 10 }; }
    if (e === course.tools) return { left: 260, top: 180, width: 900, height: 500 };
    if (e.matches?.('main') || e.matches?.('div.bb-course-navigation')) return e.matches('div.bb-course-navigation') ? { left: 240, top: 80, width: 940, height: 96 } : { left: 240, top: 64, width: 940, height: 700 };
    return null;
  };

  // The clock, frames and observers, turned by the test.
  let now = 0, ids = 0;
  const timers = [], frames = [], observers = [], events = new Map();
  const settings = { enabled: true, enhance: { ...D.GZ_SANITIZE({}).enhance, feedback } };
  const state = { on };
  const document = {
    documentElement: html, body, baseURI: `${CDN}/ultra/uiv4001.0.0-rel/`,
    querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s),
    getElementById: (id) => html.querySelector(`#${id}`), createElement: (t) => new El(t, doc),
  };
  const c = vm.createContext({
    URL, Set, Map, Math, Object, Array, String, Number, RegExp, Promise, JSON, parseFloat,
    location, document, innerHeight: 800, name,
    performance: { now: () => now },
    setTimeout: (f, ms = 0) => { const id = ++ids; timers.push({ id, at: now + ms, f }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, cancelAnimationFrame: () => {},
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px' }),
    MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe(target) { this.target = target; this.on = true; } disconnect() { this.on = false; } },
    ResizeObserver: class { observe() {} disconnect() {} },
    addEventListener: (type, f) => events.set(type, [...(events.get(type) || []), f]),
    removeEventListener: (type, f) => events.set(type, (events.get(type) || []).filter((x) => x !== f)),
    GZ_CTX: { on: () => state.on, settings: () => settings },
  });
  c.globalThis = c; c.window = c;
  vm.runInContext(read('navigation/page/feedback.js'), c);

  // An event from `target`, its path through shadow hosts as composedPath() has it.
  const pathOf = (t) => { const out = []; for (let n = t; n; n = n.parentNode || n.host) out.push(n); return out; };
  const fire = (type, target, o = {}) => {
    const e = { type, button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o };
    e.composedPath = () => pathOf(o.at || target);
    for (const f of events.get(type) || []) f(e);
    return e;
  };
  const tap = (target, o = {}) => { fire('pointerdown', target, o); fire('pointerup', target, o); fire('click', target, o); };
  // The DOM changed: the observers hear it (an element's own attribute observers too), then the frames run.
  const mutated = () => { for (const o of observers.filter((x) => x.on)) o.f([]); };
  const frame = () => { for (const f of frames.splice(0)) f(); };
  const flush = () => { mutated(); frame(); };
  const tick = (ms) => {
    const end = now + ms;
    for (let t; (t = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]);) { now = t.at; timers.splice(timers.indexOf(t), 1); t.f(); }
    now = end;
  };
  const skel = () => html.querySelector('#gz-skel');
  return { c, doc, el, html, body, baseMain, inner, layout, ila, course, openCourse, VIEW, spinners, bar, host, strip, stripTab, location, go, settings, state, events,
    fire, tap, mutated, frame, flush, tick, skel, sync: () => c.GZ_FEEDBACK.sync(), pressed: (e) => e.hasAttribute('data-gz-press') };
};

test('pressing a course\'s tab marks it at once; a cancel, a drag or letting go off it unmarks it', () => {
  const s = site();
  s.sync();
  const a = s.course.links.announcement;
  s.fire('pointerdown', a);
  assert.ok(s.pressed(a), 'marked in the pointerdown itself, so it paints in the next frame');
  assert.ok(s.course.nav.hasAttribute('data-gz-pressing'), 'its list steps the current tab back');
  s.fire('pointercancel', a);
  assert.ok(!s.pressed(a) && !s.course.nav.hasAttribute('data-gz-pressing'), 'cancelled');
  s.fire('pointerdown', a, { clientX: 10 });
  s.fire('pointermove', a, { clientX: 30 });
  assert.ok(!s.pressed(a), 'dragged off');
  s.fire('pointerdown', a);
  s.fire('pointerup', a, { at: s.course.links.calendar });
  assert.ok(!s.pressed(a), 'let go on something else');
  s.fire('pointerdown', a);
  s.fire('pointerup', a);
  assert.ok(s.pressed(a), 'let go on it: its click follows');
  s.tick(400);
  assert.ok(!s.pressed(a), 'and no click came');
  assert.equal(s.skel(), null);
});

test('Glaze\'s bar\'s links and course tabs, the strip\'s tabs and course cards mark on press; their tools and other buttons don\'t', () => {
  const s = site({ at: '/ultra/course' });
  s.sync();
  const card = s.baseMain.querySelector('article.course-element-card');
  for (const [what, el, group] of [['a link in Glaze\'s bar', s.bar.grades, s.host], ['a course tab in the bar', s.bar.tab, s.host], ['a tab of the strip', s.stripTab, s.strip], ['a course card', card, null]]) {
    s.fire('pointerdown', el.firstElementChild || el, { at: el.firstElementChild || el });
    assert.ok(s.pressed(el), what);
    if (group) assert.ok(group.hasAttribute('data-gz-pressing'), `${what}: its group`);
    s.fire('pointercancel', el);
    assert.ok(!s.pressed(el) && !group?.hasAttribute('data-gz-pressing'), `${what}: unmarked`);
  }
  for (const [what, el] of [['a tab\'s pin', s.bar.pin], ['an action', s.bar.action], ['a link to another site in a new tab', s.bar.away], ['the strip tab\'s close', s.stripTab.querySelector('.gz-ctab-x')], ['a card\'s menu', card.querySelector('.gz-cm-btn')]]) {
    s.fire('pointerdown', el);
    assert.equal(s.html.querySelectorAll('[data-gz-press]').length + s.host.shadowRoot.querySelectorAll('[data-gz-press]').length, 0, what);
  }
  for (const o of [{ button: 2 }, { ctrlKey: true }, { metaKey: true }, { isPrimary: false }]) {
    s.fire('pointerdown', s.bar.grades, o);
    assert.ok(!s.pressed(s.bar.grades), JSON.stringify(o));
  }
});

test('links opening another window or downloading do not cover the current page', () => {
  for (const kind of ['course', 'bar', 'card']) for (const attrs of [{ target: '_blank' }, { target: '_BLANK' }, { target: 'other-window' }, { download: '' }]) {
    const s = site({ at: kind === 'course' ? `/ultra/courses/${COURSE}/outline` : '/ultra/course' });
    const a = kind === 'course' ? s.course.links.announcement : kind === 'bar' ? s.bar.grades : s.baseMain.querySelector('a.course-title');
    for (const [key, value] of Object.entries(attrs)) a.setAttribute(key, value);
    s.sync();
    s.tap(a.firstElementChild || a);
    assert.ok(!s.skel(), `${kind} ${JSON.stringify(attrs)} leaves this page visible`);
    assert.ok(!s.pressed(kind === 'card' ? a.closest('article') : a));
  }
});

test('a click on a course\'s tab shows a skeleton in its tool area from the click until the page\'s view is ready', () => {
  const s = site();
  s.sync();
  const a = s.course.links.announcement;
  s.tap(a);
  const box = s.skel();
  assert.ok(box, 'in the click itself');
  assert.equal(box.parentNode, s.course.tools, 'in the course\'s tool area, under its tabs');
  assert.equal(box.attrs['aria-hidden'], 'true');
  assert.equal(box.inert, true);
  assert.equal(box.dataset.shape, 'rows');
  assert.equal(s.html.dataset.gzSkel, 'rows');
  assert.ok(s.course.tools.hasAttribute('data-gz-skel-host'), 'what was there waits hidden under it');
  assert.equal(box.style.transform, 'translate(260px, 180px)', 'over the tool area');
  assert.equal(box.style.width, '900px');
  assert.equal(box.style.height, `${800 - 180}px`, 'to the window\'s foot');
  assert.ok(s.pressed(a), 'still pressed');
  // Ultra routes: its own mark moves to the tab, which takes over.
  s.go(`/ultra/courses/${COURSE}/announcements`);
  s.course.links.outline.removeAttribute('aria-current');
  a.setAttribute('aria-current', 'page');
  s.flush();
  assert.ok(!s.pressed(a) && !s.course.nav.hasAttribute('data-gz-pressing'), 'Ultra\'s own mark rules once it lands');
  // Ultra's spinners, then its view.
  s.course.tools.replaceChildren(...s.spinners());
  s.flush();
  assert.equal(s.skel()?.parentNode, s.course.tools, 'over the spinners');
  s.course.tools.replaceChildren(s.VIEW.announcement());
  s.flush();
  assert.equal(s.skel(), null, 'gone once the announcements are in');
  assert.equal(s.html.dataset.gzSkel, undefined);
  assert.ok(!s.course.tools.hasAttribute('data-gz-skel-host'));
});

test('a second click on the item while its page comes keeps the skeleton the first started', () => {
  const s = site();
  s.sync();
  const a = s.course.links.announcement;
  s.tap(a);
  const box = s.skel();
  s.fire('click', a);
  assert.equal(s.skel(), box, 'the same one, not drawn again');
  assert.ok(s.pressed(a));
});

test('on a page without its own markers it goes once Ultra\'s spinners have gone with content in, or a moment after a new view', () => {
  const s = site();
  s.sync();
  s.tap(s.course.links.discussion);
  assert.equal(s.skel()?.dataset.shape, 'generic');
  s.go(`/ultra/courses/${COURSE}/engagement`);
  s.flush();
  assert.ok(s.skel(), 'the old view is still there: not ready');
  s.course.tools.replaceChildren(...s.spinners());
  s.flush();
  assert.ok(s.skel());
  s.course.tools.replaceChildren(s.VIEW.discussion());
  s.flush();
  assert.equal(s.skel(), null, 'spinners gone, content in');

  const q = site();
  q.sync();
  q.tap(q.course.links.discussion);
  q.go(`/ultra/courses/${COURSE}/engagement`);
  q.course.tools.replaceChildren(q.VIEW.discussion());
  q.flush();
  assert.ok(q.skel(), 'no spinners yet: Ultra may still put them in');
  q.tick(200);
  q.flush();
  assert.equal(q.skel(), null, 'a new view a moment on');
});

test('readiness deadlines run without another DOM mutation, including a route-only change', () => {
  const s = site();
  s.sync();
  s.tap(s.course.links.discussion);
  s.go(`/ultra/courses/${COURSE}/engagement`);
  s.course.tools.replaceChildren(s.VIEW.discussion());
  s.flush();
  assert.ok(s.skel());
  s.tick(200);
  s.frame();
  assert.equal(s.skel(), null, 'the new view settles without a second mutation');

  const q = site();
  q.sync();
  q.tap(q.course.links.calendar);
  q.go(`/ultra/courses/${COURSE}/calendar`);
  q.tick(100);
  q.frame();
  q.tick(1100);
  q.frame();
  assert.equal(q.skel(), null, 'a URL-only transition also reaches its readiness deadline');
  q.tick(20000);
  q.frame();
  assert.equal(q.html.dataset.gzSkel, undefined, 'expired callbacks do not restore the skeleton');
});

test('spinners from the source page cannot declare the destination ready', () => {
  for (const routeFirst of [false, true]) {
    const s = site();
    const oldSpinners = s.spinners();
    s.course.tools.append(...oldSpinners);
    s.sync();
    s.tap(s.course.links.discussion);
    if (routeFirst) s.go(`/ultra/courses/${COURSE}/engagement`);
    s.flush();
    if (!routeFirst) s.go(`/ultra/courses/${COURSE}/engagement`);
    oldSpinners.forEach((e) => e.remove());
    s.flush();
    assert.ok(s.skel(), `the old view remains after its old spinners disappear (route first: ${routeFirst})`);
    s.course.tools.replaceChildren(...s.spinners());
    s.flush();
    s.course.tools.replaceChildren(s.VIEW.discussion());
    s.flush();
    assert.equal(s.skel(), null, 'the destination\'s own loading cycle completes');
  }
});

test('hidden destination views cannot declare readiness', () => {
  const s = site();
  s.sync();
  s.tap(s.course.links.announcement);
  s.go(`/ultra/courses/${COURSE}/announcements`);
  const view = s.VIEW.announcement();
  view.hidden = true;
  s.course.tools.replaceChildren(view);
  s.flush();
  assert.ok(s.skel(), 'a hidden ready marker is not a rendered destination');
  s.tick(1100);
  s.frame();
  assert.ok(s.skel(), 'hidden text cannot satisfy the fallback either');
  view.hidden = false;
  s.tick(100);
  s.frame();
  assert.equal(s.skel(), null, 'the displayed view takes over');
});

test('hidden spinners do not hold a ready destination under the skeleton', () => {
  const s = site();
  s.sync();
  s.tap(s.course.links.discussion);
  s.go(`/ultra/courses/${COURSE}/engagement`);
  const hidden = s.el('div', {}, ...s.spinners());
  hidden.hidden = true;
  s.course.tools.replaceChildren(s.VIEW.discussion(), hidden);
  s.flush();
  s.tick(200);
  s.frame();
  assert.equal(s.skel(), null, 'only rendered spinners count as loading');
});

test('the skeleton chooses a displayed base main instead of an earlier hidden one', () => {
  const s = site({ at: '/ultra/course' });
  s.baseMain.hidden = true;
  const main = s.el('main', { class: 'bb-offcanvas-container' }, s.el('section', {}, 'Visible page'));
  s.body.append(main);
  s.sync();
  s.tap(s.bar.grades);
  assert.ok(s.skel()?.parentNode === main, 'the loading indication belongs in the visible main');
  assert.ok(!s.baseMain.hasAttribute('data-gz-skel-host'));
});

test('it gives way at once to an instant copy, but not to one that was already there', () => {
  const s = site({ at: '/ultra/course' });
  s.sync();
  const old = s.el('div', { id: 'gz-instant' });
  s.baseMain.append(old);
  s.tap(s.bar.grades);
  assert.equal(s.skel()?.dataset.shape, 'tiles');
  s.mutated();
  assert.ok(s.skel(), 'the old page\'s copy');
  old.remove();
  s.go('/ultra/grades');
  s.flush();
  s.baseMain.append(s.el('div', { id: 'gz-instant' }));
  s.mutated();
  assert.equal(s.skel(), null, 'gone in the observer\'s callback, before the next frame');
  assert.equal(s.html.dataset.gzSkel, undefined);
});

test('a late instant copy of the source page cannot end the destination skeleton', () => {
  const s = site({ at: '/ultra/course' });
  s.sync();
  s.tap(s.bar.grades);
  const sourceCopy = s.el('div', { id: 'gz-instant' });
  s.baseMain.append(sourceCopy);
  s.mutated();
  assert.ok(s.skel(), 'the source page\'s pending cache read is unrelated to the clicked destination');
  sourceCopy.remove();
  s.go('/ultra/grades');
  s.baseMain.append(s.el('div', { id: 'gz-instant' }));
  s.mutated();
  assert.equal(s.skel(), null, 'the destination copy still takes over immediately');
});

test('Ultra\'s spinners are hidden while it shows, and what was there waits hidden, keeping its layout', () => {
  const rules = cssRules('content/extras.css');
  const node = (tag, cls = [], attrs = {}, parent = null, id = '') => ({ tag, id, cls, attrs, parent });
  const html = node('html', [], { 'data-gz-skel': 'rows' }), site = node('div', [], {}, node('body', [], {}, html), 'site-wrap');
  const main = node('main', ['course-main-content'], {}, site), tools = node('div', ['course-tool-content'], { 'data-gz-skel-host': '' }, main);
  assert.equal(winner(rules, node('div', ['spinner', 'bb-secondary-color-2'], {}, node('section', ['route-view-container'], {}, tools)), 'visibility')[0], 'hidden');
  assert.equal(winner(rules, node('div', ['spinner', 'bb-secondary-color-2'], {}, main), 'visibility')[0], 'hidden', 'anywhere in the main area');
  assert.equal(winner(rules, node('section', ['route-view-container'], {}, tools), 'visibility')[0], 'hidden', 'by visibility, never display: its layout stays');
  assert.equal(winner(rules, node('div', ['bb-course-navigation'], {}, tools), 'visibility'), null, 'a course\'s tabs stay');
  const box = node('div', [], {}, tools, 'gz-skel');
  assert.equal(winner(rules, box, 'visibility'), null, 'the skeleton shows');
  for (const [prop, want] of [['position', 'absolute'], ['top', '0'], ['left', '0'], ['pointer-events', 'none'], ['overflow', 'hidden']]) assert.equal(winner(rules, box, prop)?.[0], want, prop);
  const spinner = node('div', ['spinner', 'bb-secondary-color-2'], {}, node('main', [], {}, node('html')));
  assert.equal(winner(rules, spinner, 'visibility'), null, 'Ultra\'s spinners as they are without a skeleton');
});

test('no layout shift: laid over by transform, and nothing of Ultra\'s restyled or moved', () => {
  const s = site();
  s.sync();
  // Ultra's elements with a style of Glaze's on them.
  const restyled = () => s.html.querySelectorAll('*').filter((e) => !e.closest('#gz-skel') && Object.values(e.style).some((x) => typeof x !== 'function'));
  assert.deepEqual(restyled(), []);
  s.tap(s.course.links.grades);
  const box = s.skel();
  assert.ok(box);
  assert.ok(!('top' in box.style) && !('left' in box.style) && /^translate\(/.test(box.style.transform), 'moved only by transform');
  assert.deepEqual(restyled(), [], 'Ultra\'s elements only carry data attributes');
  s.go(`/ultra/courses/${COURSE}/grades`);
  s.course.tools.replaceChildren(...s.spinners());
  s.flush();
  s.course.tools.replaceChildren(s.VIEW.grades());
  s.flush();
  assert.equal(s.skel(), null);
  assert.deepEqual(restyled(), []);
});

test('a click that doesn\'t change the page, a page that never gets ready, or the page already open shows nothing for long', () => {
  const s = site();
  s.sync();
  const a = s.course.links.calendar;
  s.tap(a);
  assert.ok(s.skel() && s.pressed(a));
  s.tick(1500);
  assert.equal(s.skel(), null, 'the page didn\'t change');
  assert.ok(!s.pressed(a));

  s.tap(a);
  s.go(`/ultra/courses/${COURSE}/calendar`);
  s.course.tools.replaceChildren(...s.spinners());
  s.flush();
  s.tick(19000);
  assert.ok(s.skel(), 'still waiting');
  s.tick(1000);
  assert.equal(s.skel(), null, 'gone at 20 s');
  assert.ok(!s.pressed(a));

  s.go(`/ultra/courses/${COURSE}/outline`);
  const cur = s.course.links.outline;
  s.tap(cur);
  assert.equal(s.skel(), null, 'the page already open');
  assert.ok(!s.pressed(cur), 'already current');
});

test('another page opened meanwhile takes it away, and a page with no spinners where Glaze looks is taken as ready a second on', () => {
  const s = site();
  s.sync();
  s.tap(s.course.links.announcement);
  s.go(`/ultra/courses/${COURSE}/announcements`);
  s.flush();
  assert.ok(s.skel());
  s.go('/ultra/course');
  s.flush();
  assert.equal(s.skel(), null, 'not the click\'s page any more');
  assert.ok(!s.baseMain.hasAttribute('data-gz-skel-host') && !s.course.tools.hasAttribute('data-gz-skel-host'));

  const q = site();
  q.sync();
  q.tap(q.course.links.calendar);
  q.go(`/ultra/courses/${COURSE}/calendar`);
  q.flush();
  q.tick(900);
  q.flush();
  assert.ok(q.skel(), 'Ultra may still be on its way');
  q.tick(200);
  q.flush();
  assert.equal(q.skel(), null, 'no spinners and the area filled a second after the address changed');
});

test('an unrelated route arriving before the first check cannot adopt a pending skeleton', () => {
  const s = site();
  s.sync();
  s.tap(s.course.links.announcement);
  s.go(`/ultra/courses/${COURSE}/calendar`);
  s.flush();
  assert.equal(s.skel(), null, 'only the clicked destination owns this skeleton');
  assert.ok(!s.course.tools.hasAttribute('data-gz-skel-host'));
  assert.ok(!s.pressed(s.course.links.announcement));
});

test('each page\'s skeleton has its shape: rows, tiles, else generic', () => {
  for (const [at, target, shape] of [
    [`/ultra/courses/${COURSE}/announcements`, (s) => s.course.links.outline, 'rows'],
    [`/ultra/courses/${COURSE}/outline`, (s) => s.course.links.announcement, 'rows'],
    [`/ultra/courses/${COURSE}/outline`, (s) => s.course.links.grades, 'rows'],
    [`/ultra/courses/${COURSE}/outline`, (s) => s.course.links.calendar, 'generic'],
    ['/ultra/course', (s) => s.bar.grades, 'tiles'],
    ['/ultra/grades', (s) => s.bar.courses, 'tiles'],
    ['/ultra/course', (s) => s.baseMain.querySelector('article.course-element-card'), 'rows'],
  ]) {
    const s = site({ at });
    for (const l of Object.values(s.course.links)) { if (l.getAttribute('href') === at) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current'); }
    s.sync();
    s.tap(target(s));
    assert.equal(s.skel()?.dataset.shape, shape, `${at} → ${shape}`);
  }
});

test('a course card opens its course with a skeleton that moves into the course\'s area as it comes in', () => {
  const s = site({ at: '/ultra/course' });
  s.sync();
  const card = s.baseMain.querySelector('article.course-element-card');
  s.tap(card.querySelector('h4'));
  assert.equal(s.skel()?.parentNode, s.baseMain, 'over the Courses list');
  assert.ok(s.pressed(card));
  s.go(`/ultra/courses/${COURSE}/outline`);
  s.openCourse('outline', null);
  s.course.tools.append(...s.spinners());
  s.flush();
  assert.equal(s.skel()?.parentNode, s.course.tools, 'into the course\'s tool area');
  assert.ok(!s.baseMain.hasAttribute('data-gz-skel-host'));
  s.course.tools.replaceChildren(s.VIEW.outline());
  s.flush();
  assert.equal(s.skel(), null);
  assert.ok(!s.pressed(card), 'the card lets go with it');
});

test('a link in Glaze\'s bar keeps its press until its own marker has glided there', () => {
  const s = site({ at: '/ultra/course' });
  s.sync();
  s.tap(s.bar.grades);
  assert.ok(s.pressed(s.bar.grades) && s.host.hasAttribute('data-gz-pressing'));
  s.go('/ultra/grades');
  s.bar.courses.removeAttribute('aria-current');
  s.bar.grades.setAttribute('aria-current', 'page');
  s.flush();
  assert.ok(!s.host.hasAttribute('data-gz-pressing'), 'the bar\'s marker back at full strength');
  assert.ok(s.pressed(s.bar.grades), 'the item until the marker is there');
  s.tick(500);
  assert.ok(!s.pressed(s.bar.grades));
});

test('a course tab answers with its press only: its frame is its own loading', () => {
  const s = site();
  s.sync();
  s.tap(s.stripTab);
  assert.ok(s.pressed(s.stripTab));
  assert.equal(s.skel(), null);
  s.stripTab.setAttribute('aria-selected', 'true');
  s.mutated();
  assert.ok(!s.pressed(s.stripTab), 'the strip\'s own mark');
});

test('none in the hidden standby', () => {
  const s = site({ name: 'gz-ctab:standby' });
  s.sync();
  assert.equal([...s.events.values()].flat().length, 0, 'not listening');
  s.tap(s.course.links.announcement);
  assert.ok(!s.pressed(s.course.links.announcement));
  assert.equal(s.skel(), null);
  // Adopted as a course's frame, it is a page like any other.
  s.c.name = 'gz-ctab:_101_1';
  s.sync();
  s.tap(s.course.links.announcement);
  assert.ok(s.skel());
});

test('with the switch off, or Glaze off, Ultra answers as it does without Glaze', () => {
  const s = site({ feedback: false });
  s.sync();
  assert.equal([...s.events.values()].flat().length, 0);
  s.tap(s.course.links.announcement);
  assert.ok(!s.pressed(s.course.links.announcement));
  assert.equal(s.skel(), null);
  const g = site({ on: false });
  g.sync();
  g.tap(g.course.links.announcement);
  assert.equal(g.skel(), null);
  // Turned off while one shows: it goes at the next look, and stops listening at the next pass.
  const q = site();
  q.sync();
  q.tap(q.course.links.announcement);
  assert.ok(q.skel());
  q.settings.enhance.feedback = false;
  q.mutated();
  q.frame();
  assert.equal(q.skel(), null);
  assert.ok(!q.pressed(q.course.links.announcement));
  q.sync();
  assert.equal([...q.events.values()].flat().length, 0);
});

test('routed on Ultra\'s pages and course tabs\' frames, never the standby, and loadable', () => {
  const need = [];
  const c = { location: { pathname: '' }, window: { name: '' }, GZ_CTX: { site: 'ultra', solo: true, need: (f) => { need.push(f); return new Promise(() => {}); } }, sessionStorage: { getItem: () => null } };
  c.globalThis = c;
  vm.createContext(c);
  const routes = vm.runInContext(read('content/routes.js'), c);
  const asks = (p, name = '', site = 'ultra', solo = true) => { need.length = 0; Object.assign(c.location, { pathname: p }); c.window.name = name; c.GZ_CTX.site = site; c.GZ_CTX.solo = solo; routes.sync(); return need.includes('navigation/page/feedback.js'); };
  for (const p of ['/ultra/course', '/ultra/grades', '/ultra/stream', '/ultra/calendar', `/ultra/courses/${COURSE}/outline`, `/ultra/courses/${COURSE}/announcements`]) assert.ok(asks(p), p);
  assert.ok(asks(`/ultra/courses/${COURSE}/outline`, 'gz-ctab:_101_1'), 'a course tab\'s frame');
  assert.ok(!asks('/ultra/profile', 'gz-ctab:standby'), 'the standby');
  assert.ok(!asks('/ultra/course', '', 'ultra', false), 'a frame of the page\'s own');
  assert.ok(!asks('/courses/1', '', 'canvas'), 'Canvas');
  const list = JSON.parse(read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('navigation/page/feedback.js'));
});

test('its switch: on by default, in Blackboard\'s Dashboard section, short and translated', () => {
  assert.equal(D.GZ_DEFAULTS.enhance.feedback, true);
  assert.equal(D.GZ_SANITIZE({ enhance: { feedback: false } }).enhance.feedback, false);
  const opts = read('options.html');
  const section = opts.slice(opts.indexOf('<section id="bb-dashboard"'), opts.indexOf('</section>', opts.indexOf('<section id="bb-dashboard"')));
  assert.match(section, /<label class="check"><input type="checkbox" data-key="enhance\.feedback"><span>Show pages loading at once<\/span><\/label>/);
  for (const l of ['de', 'es', 'fr', 'nl', 'pt-BR']) assert.match(read(`i18n/${l}.js`), /^ {2}"Show pages loading at once": "[^"]+",$/m, l);
});

test('still under reduced motion', () => {
  const css = read('content/extras.css');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ #gz-skel > \*, #gz-boot > div \{ animation: none; \} \}/);
  assert.match(css, /html\[data-gz-motion="off"\] #gz-skel > \*, html\[data-gz-motion="off"\] #gz-boot > div \{ animation: none; \}/);
});

test('pressed indicators remain visible when forced colors remove fills and shadows', () => {
  const node = (tag, cls = [], attrs = {}, parent = null, id = '') => ({ tag, cls, attrs, parent, id });
  const pressed = { 'data-gz-press': '' };
  const item = node('a', ['item'], pressed);
  assert.equal(winner(cssRules('navigation/page/navbar.css'), item, 'outline')?.[0], '2px solid Highlight');
  const tab = node('div', ['gz-ctab'], pressed, node('div', [], {}, null, 'gz-ctabs'));
  const rules = cssRules('navigation/page/coursetabs.css');
  assert.equal(winner(rules, tab, 'outline')?.[0], '2px solid Highlight');
  const after = (rules) => rules.filter(([sel]) => sel.endsWith('::after')).map(([sel, body]) => [sel.replace(/::after/g, ''), body]);
  assert.equal(winner(after(rules), tab, 'forced-color-adjust')?.[0], 'none');
  assert.equal(winner(after(rules), tab, 'background')?.[0], 'Highlight');
  const link = node('a', [], pressed, node('div', ['js-course-navigation'], {}, node('div', [], {}, null, 'site-wrap')));
  const native = after(cssRules('content/extras.css'));
  assert.equal(winner(native, link, 'forced-color-adjust')?.[0], 'none');
  assert.equal(winner(native, link, 'background')?.[0], 'Highlight');
});

// ---- a cold load ----
const GRADES_VIEW = (s) => s.el('section', { class: 'route-view-container' }, s.el('bb-base-grades-student', {}, s.el('div', { class: 'element-card tile base-grades-course-tile active-course' }, 'Course One')));
const IP_VIEW = (s) => s.el('section', { class: 'institution-page-container route-view-container' }, s.el('section', { id: 'gz-dash' }, s.el('div', { class: 'gz-dash-grid' }, 'Widgets')));
const booted = (s) => ({ attr: s.html.hasAttribute('data-gz-boot'), box: !!s.html.querySelector('#gz-boot') });

test('a cold load shows one skeleton from its first sync until the page\'s own view is ready, Ultra\'s first view of another page included', () => {
  const s = site({ at: '/ultra/grades', boot: true });
  s.sync();
  const box = s.html.querySelector('#gz-boot');
  assert.ok(box, 'drawn at the first sync');
  assert.equal(box.parentNode, s.body);
  assert.equal(box.attrs['aria-hidden'], 'true');
  assert.equal(box.inert, true);
  assert.equal(box.dataset.shape, 'tiles', 'the page\'s shape');
  assert.ok(s.html.hasAttribute('data-gz-boot'), 'Ultra\'s app waits hidden under it');
  assert.equal(s.skel(), null, 'not a click\'s skeleton');
  // Ultra boots: its boot screen fades, its shell comes in with the Institution page first, no spinners, content in.
  s.ila.setAttribute('class', 'mode-light fade-out');
  s.baseMain.replaceChildren(IP_VIEW(s));
  s.inner.append(s.layout);
  s.flush();
  s.tick(5000);
  s.flush();
  assert.deepEqual(booted(s), { attr: true, box: true }, 'another page\'s view is not this page\'s');
  // Its route: spinners, then the Grades tiles.
  s.ila.remove();
  s.baseMain.replaceChildren(...s.spinners());
  s.flush();
  assert.deepEqual(booted(s), { attr: true, box: true });
  s.baseMain.replaceChildren(GRADES_VIEW(s));
  s.mutated();
  s.frame();
  assert.deepEqual(booted(s), { attr: false, box: false }, 'one swap: the page and its view at once');
});

test('a cold course page waits for its own view; a generic page for its spinners to come and go, or 3 s of content', () => {
  const s = site({ boot: true });
  s.sync();
  assert.equal(s.html.querySelector('#gz-boot').dataset.shape, 'rows');
  s.ila.remove();
  s.inner.append(s.layout);
  s.openCourse('outline', null);
  s.course.tools.append(...s.spinners());
  s.flush();
  s.tick(5000);
  s.flush();
  assert.equal(booted(s).attr, true, 'spinners hold it');
  s.course.tools.replaceChildren(s.VIEW.outline());
  s.flush();
  assert.equal(booted(s).attr, false, 'Course Content\'s items');
  for (const spun of [true, false]) {
    const g = site({ at: '/ultra/calendar', boot: true });
    g.sync();
    assert.equal(g.html.querySelector('#gz-boot').dataset.shape, 'generic');
    g.ila.remove();
    g.inner.append(g.layout);
    if (spun) { g.baseMain.replaceChildren(...g.spinners()); g.flush(); }
    g.baseMain.replaceChildren(g.el('section', { class: 'route-view-container' }, g.el('h1', {}, 'Calendar')));
    g.flush();
    if (spun) { assert.equal(booted(g).attr, false, 'its spinners came and went'); continue; }
    assert.equal(booted(g).attr, true, 'content with no spinners seen yet: not yet');
    g.tick(3100);
    g.flush();
    assert.equal(booted(g).attr, false, '3 s on');
  }
});

test('the page\'s instant copy takes the skeleton\'s place, and the boot goes with the copy, in the same frame', () => {
  const s = site({ at: '/ultra/grades', boot: true });
  s.sync();
  s.ila.remove();
  s.inner.append(s.layout);
  const copy = s.el('div', { id: 'gz-instant' });
  s.baseMain.append(copy);
  s.html.setAttribute('data-gz-instant', 'grades');
  s.mutated();
  assert.deepEqual(booted(s), { attr: true, box: true }, 'the copy shows in the boot (extras.css hides the skeleton under it)');
  // Ultra's view is in under the copy: the copy decides when it goes.
  s.baseMain.append(GRADES_VIEW(s));
  s.flush();
  s.tick(5000);
  s.flush();
  assert.equal(booted(s).attr, true, 'never Ultra\'s view beside the copy');
  s.html.removeAttribute('data-gz-instant');
  copy.remove();
  s.mutated();
  assert.deepEqual(booted(s), { attr: false, box: false }, 'in the copy\'s own mutation, before the next frame');
});

test('no boot on a page already built, an old document, the standby, or with the switch or Glaze off; a click or 20 s end it', () => {
  const built = site({ at: '/ultra/course' });
  built.sync();
  assert.deepEqual(booted(built), { attr: false, box: false }, 'no boot screen and a main area: built');
  const old = site({ at: '/ultra/grades', boot: true });
  old.tick(16000);
  old.sync();
  assert.deepEqual(booted(old), { attr: false, box: false }, 'a document 16 s old');
  for (const o of [{ name: 'gz-ctab:standby' }, { feedback: false }, { on: false }]) {
    const s = site({ at: '/ultra/grades', boot: true, ...o });
    s.sync();
    assert.deepEqual(booted(s), { attr: false, box: false }, JSON.stringify(o));
  }
  const capped = site({ at: '/ultra/grades', boot: true });
  capped.sync();
  capped.tick(20000);
  assert.deepEqual(booted(capped), { attr: false, box: false }, '20 s at most');
  const off = site({ at: '/ultra/grades', boot: true });
  off.sync();
  off.settings.enhance.feedback = false;
  off.tick(100);
  assert.deepEqual(booted(off), { attr: false, box: false }, 'the switch turned off: gone at the next look');
  const once = site({ at: '/ultra/grades', boot: true });
  once.sync();
  once.tick(20000);
  once.sync();
  assert.deepEqual(booted(once), { attr: false, box: false }, 'once a document');
  const clicked = site({ boot: true });
  clicked.sync();
  clicked.ila.remove();
  clicked.inner.append(clicked.layout);
  clicked.openCourse('outline', clicked.VIEW.outline());
  clicked.tap(clicked.course.links.announcement);
  assert.deepEqual(booted(clicked), { attr: false, box: false }, 'a click on the way: its own skeleton');
  assert.ok(clicked.skel());
});

test('a cold load hides Ultra\'s boot screen and its app, never Glaze\'s bar or the copy; the copy goes at once', () => {
  const rules = cssRules('content/extras.css');
  const node = (tag, cls = [], attrs = {}, parent = null, id = '') => ({ tag, id, cls, attrs, parent });
  const on = node('html', [], { 'data-gz-enhance-feedback': '' }), off = node('html');
  for (const [html, want] of [[on, 'hidden'], [off, null]]) {
    const ila = node('div', ['mode-light'], {}, node('body', [], {}, html), 'initial-load-area');
    assert.equal(winner(rules, ila, 'visibility')?.[0] ?? null, want, `Ultra's boot screen, the switch ${want ? 'on' : 'off'}`);
    assert.equal(winner(rules, ila, 'display'), null, 'by visibility: its own fade and removal still run');
  }
  const html = node('html', [], { 'data-gz-boot': '', 'data-gz-enhance-feedback': '' }), body = node('body', [], {}, html), wrap = node('div', [], {}, body, 'site-wrap');
  assert.equal(winner(rules, wrap, 'visibility')[0], 'hidden', 'Ultra\'s app waits hidden, keeping its layout');
  assert.equal(winner(rules, node('div', ['bb-offcanvas-container'], {}, node('main', [], {}, wrap), 'gz-instant'), 'visibility')[0], 'visible', 'the copy shows');
  const frameHtml = node('html', [], { 'data-gz-boot': '', 'data-gz-instant-frame': '' });
  assert.equal(winner(rules, node('div', [], {}, node('body', [], {}, frameHtml), 'site-wrap'), 'visibility')[0], 'hidden', 'in a tab\'s frame too');
  for (const id of ['gz-navbar', 'gz-sidebar', 'gz-ctabs-frames']) assert.equal(winner(rules, node('div', [], {}, body, id), 'visibility'), null, id);
  const box = node('div', [], {}, body, 'gz-boot');
  for (const [prop, want] of [['position', 'fixed'], ['pointer-events', 'none'], ['display', 'flex']]) assert.equal(winner(rules, box, prop)?.[0], want, prop);
  assert.match(winner(rules, box, 'top')[0], /var\(--gz-navbar-top/, 'below Glaze\'s bar');
  assert.match(winner(rules, box, 'right')[0], /var\(--gz-sb-room/, 'beside the sidebar');
  for (const a of ['data-gz-instant', 'data-gz-ctab-framed']) assert.equal(winner(rules, node('div', [], {}, node('body', [], {}, node('html', [], { 'data-gz-boot': '', [a]: '' })), 'gz-boot'), 'display')[0], 'none', `under ${a}`);
  const copy = node('div', [], { 'data-out': '' }, node('main', [], {}, node('html')), 'gz-instant');
  assert.equal(winner(rules, copy, 'opacity')[0], '0');
  assert.equal(winner(rules, copy, 'transition')?.[0] ?? 'none', 'none', 'no cross-fade over Ultra\'s view');
});
