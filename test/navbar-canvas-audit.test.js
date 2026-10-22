const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El, matches } = require('./stand-in-dom.js');
const G = require('../defaults.js'), M = require('../lib/navbar.js');
const L = require('../lib/navlayout.js'), N = require('../lib/nav-items.js');
const read = (file) => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const origin = 'https://school.instructure.com';

// Run the whole adapter and renderer. Extend the existing stand-in only for the DOM
// APIs they use; boxes are deterministic, not a browser/CSS layout simulation.
class NavEl extends El {
  get localName() { return this.tagName.toLowerCase(); }
  get ownerDocument() { return this.doc; }
  get tabIndex() { return Number(this.getAttribute('tabindex') || 0); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.filter((e) => e instanceof El).length; }
  get classList() { return Object.assign(this.className.split(/\s+/).filter(Boolean), { contains: (c) => this.className.split(/\s+/).includes(c) }); }
  get dir() { return this.getAttribute('dir') || ''; }
  set dir(v) { this.setAttribute('dir', v); }
  get href() { return this._href ? new URL(this._href, this.doc.location.href).href : ''; }
  set href(v) { this._href = v; this.setAttribute('href', v); }
  get origin() { return this.href && new URL(this.href).origin; }
  get pathname() { return this.href && new URL(this.href).pathname; }
  get search() { return this.href && new URL(this.href).search; }
  get hash() { return this.href && new URL(this.href).hash; }
  get offsetLeft() { return this.box?.left || 0; }
  get offsetTop() { return this.box?.top || 0; }
  get scrollWidth() { return this.clientWidth; }
  get isConnected() {
    let p = this;
    while (p.parentNode || p.host) p = p.parentNode || p.host;
    return p === this.doc.root;
  }
  matches(selector) {
    return selector.split(',').some((s) => {
      const excluded = [...s.matchAll(/:not\(([^)]+)\)/g)].map((m) => m[1]);
      const includes = [...s.matchAll(/\[([\w-]+)\*="([^"]*)"\]/g)];
      const simple = s.replace(/:not\([^)]+\)/g, '').replace(/\[([\w-]+)\*="[^"]*"\]/g, '[$1]').trim();
      return matches(this, simple) && excluded.every((x) => !matches(this, x)) && includes.every(([, k, v]) => this.getAttribute(k)?.includes(v));
    });
  }
  querySelectorAll(selector) { return this.all().filter((e) => e.matches(selector)); }
  closest(selector) { for (let p = this; p?.tagName; p = p.parentNode) if (p.matches(selector)) return p; return null; }
  getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }
  attachShadow(options) {
    const r = new NavEl('shadow-root', this.doc); r.host = this;
    Object.defineProperty(r, 'activeElement', { get: () => this.doc.focused?.isConnected && r.contains(this.doc.focused) ? this.doc.focused : null });
    this.shadowRoot = r; return r;
  }
  focus() { this.doc.focused = this; }
  click() { this.clicks = (this.clicks || 0) + 1; }
}

function page(path = '/') {
  const document = { location: new URL(path, origin), focused: null, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  document.root = document.documentElement = new NavEl('html', document);
  document.body = new NavEl('body', document); document.root.append(document.body);
  document.createElement = (tag) => new NavEl(tag, document);
  document.createElementNS = (_, tag) => new NavEl(tag, document);
  document.querySelector = (s) => document.root.querySelector(s);
  document.querySelectorAll = (s) => document.root.querySelectorAll(s);
  document.getElementById = (id) => document.root.querySelector(`#${id}`);
  Object.defineProperty(document, 'activeElement', { get: () => document.focused?.isConnected ? document.focused : document.body });
  document.createTreeWalker = (el) => { let next = true; return { nextNode: () => next ? (next = false, { data: el.textContent }) : null }; };
  const main = document.createElement('main'); main.id = 'content'; document.body.append(main);
  return document;
}

function course(path = '/courses/12/modules') {
  const doc = page(path), id = doc.location.pathname.match(/\/courses\/(\d+)/)[1];
  const list = doc.createElement('ul'); list.id = 'section-tabs';
  for (const key of ['modules', 'assignments', 'grades']) {
    const a = doc.createElement('a'); a.href = `/courses/${id}/${key}`; a.textContent = key;
    a.className = `${key}${doc.location.pathname === `/courses/${id}/${key}` ? ' active' : ''}`; list.append(a);
  }
  const crumb = doc.createElement('div'); crumb.className = 'course-title'; crumb.textContent = `Course ${id}`;
  doc.body.append(list, crumb); return doc;
}

async function setup({ path = '/', shown = '', frameDoc = null, width = 1440, navbar = {}, prefs = {}, dir = 'ltr' } = {}) {
  const document = path.startsWith('/courses/') ? course(path) : page(path);
  document.documentElement.dir = dir;
  const menu = document.createElement('ul'); menu.id = 'menu';
  const native = [['dashboard', '/', 'Dashboard'], ['courses', '/courses', 'Courses'], ['calendar', '/calendar', 'Calendar'], ['conversations', '/conversations', 'Inbox'], ['profile', '/profile/settings', 'Account']];
  for (const [key, href, label] of native) {
    const a = document.createElement('a'); a.id = `global_nav_${key}_link`; a.href = href; a.textContent = label;
    if (href === path || key === 'courses' && path.startsWith('/courses/')) a.className = 'active';
    menu.append(a);
  }
  document.body.append(menu);
  const settings = G.GZ_SANITIZE({ navbar: { ...navbar }, enhance: { tabs: true } });
  const state = { shown, count: shown ? 1 : 0, accept: true }, routed = [], assigned = [], events = {}, animation = new Map();
  const frame = document.createElement('iframe'); document.body.append(frame);
  Object.defineProperty(state, 'frameDoc', { get: () => frame.contentDocument, set: (doc) => {
    frame.contentDocument = doc; if (doc) doc.defaultView = { frameElement: frame };
  } });
  state.frameDoc = frameDoc;
  let tick = 0, adapter;
  const bar = { rows: () => ['12', '34'].map((cid) => ({ cid, label: `Course ${cid}`, full: `Course ${cid}`, cur: state.shown === cid, pin: false, color: '' })),
    doc: () => state.shown ? state.frameDoc : null, open: (href) => { routed.push(href); return state.accept; }, leave() { state.leaves = (state.leaves || 0) + 1; }, place() {},
    signout() { state.signouts = (state.signouts || 0) + 1; } };
  document.location.assign = (href) => assigned.push(href);
  const window = {}; window.top = window;
  const context = vm.createContext({ document, location: document.location, window, URL, URLSearchParams, AbortSignal, Response,
    GZ_NAVBAR: M, GZ_NAV_LAYOUT: L, GZ_NAV_ITEMS: N, innerWidth: width, innerHeight: 900,
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} disconnect() {} },
    getComputedStyle: () => ({ backgroundImage: '' }), CSS: { escape: (s) => s },
    matchMedia: (q) => ({ matches: q === '(min-width: 900px)' ? context.innerWidth >= 900 : true }),
    requestAnimationFrame: (fn) => { animation.set(++tick, fn); return tick; }, cancelAnimationFrame: (id) => animation.delete(id),
    setTimeout: () => ++tick, clearTimeout() {}, addEventListener: (name, fn) => { events[name] = fn; },
    fetch: async () => new Response(JSON.stringify([{ id: 12, name: 'Course 12' }, { id: 34, name: 'Course 34' }])),
    GZ_CTABS: { showing: () => state.shown, frames: () => state.count, bar },
    chrome: { runtime: { id: 'glaze', getURL: (s) => `chrome-extension://glaze/${s}` },
      storage: { sync: { get: (_, cb) => cb({ navbarItems: prefs }) }, local: { get: (_, cb) => cb({}), set() {} }, onChanged: { addListener() {} } } },
    GZ_CTX: { site: 'canvas', t: (s) => s, settings: () => settings, on: () => true, parts: () => ({}), locale: () => 'en',
      setVar: (key, value) => document.documentElement.style.setProperty(key, value) },
  });
  const factory = vm.runInContext(read('features/navbar-canvas.js') + '\nGZ_NAVBAR_CANVAS;', context);
  context.GZ_NAVBAR_CANVAS = (x) => (adapter = factory(x));
  const ui = vm.runInContext(read('features/navbar.js') + '\nGZ_NAVBAR_UI;', context);
  ui.sync(); await Promise.resolve();
  const host = document.getElementById('gz-navbar'), root = host.shadowRoot;
  root.querySelector('link').dispatchEvent({ type: 'load' });
  const click = (target, extra = {}) => {
    const path = []; for (let e = target; e; e = e.parentNode) path.push(e);
    const event = { type: 'click', button: 0, ...extra, composedPath: () => path, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    root.dispatchEvent(event); return event;
  };
  const key = (value, extra = {}) => { const e = { type: 'keydown', key: value, ...extra, preventDefault() { this.defaultPrevented = true; } }; root.dispatchEvent(e); return e; };
  return { ui, state, settings, context, events, document, host, root, bar, adapter, routed, assigned, frame, click, key,
    room: () => ['--gz-navbar-left', '--gz-navbar-top'].map((k) => document.documentElement.style.getPropertyValue(k)) };
}

test('the bar is first in the page, as the navigation it stands in for, so keyboard order meets it and its Skip link first', async () => {
  const h = await setup({ path: '/courses/12/modules' });
  assert.equal(h.document.body.children[0], h.host);
});

test('course frames override the covered page while the page frame stays outside a course', async () => {
  for (const path of ['/', '/courses/12/modules']) for (const shown of ['', '34', 'page']) {
    const frameDoc = shown === '34' ? course('/courses/34/grades') : page('/calendar');
    const h = await setup({ path, shown, frameDoc });
    assert.equal(h.ui.model().course, shown ? shown !== 'page' : path.startsWith('/courses/'));
    assert.equal(h.ui.model().active, shown === '34' ? 'course' : shown === 'page' ? 'calendar' : path === '/' ? 'dashboard' : 'course');
    assert.equal(!!h.ui.model().menu, shown === '34' || !shown && path.startsWith('/courses/'));
  }
});

test('the page frame path replaces stale native active classes on each navigation', async () => {
  const h = await setup({ path: '/courses/12/modules', shown: 'page', frameDoc: page('/calendar') });
  for (const [path, id] of [['/calendar', 'calendar'], ['/conversations/88', 'messages'], ['/profile/settings', 'profile'], ['/', 'dashboard'], ['/courses', 'course']]) {
    h.state.frameDoc.location = new URL(path, origin); h.ui.sync();
    assert.deepEqual(plain(h.ui.model().items.filter((i) => i.active).map((i) => i.id)), [id], path);
    assert.equal(h.ui.model().course, false, 'the Courses list is outside an individual course');
  }
});

test('leaving a frame restores the underlying course menu and layout', async () => {
  const h = await setup({ path: '/courses/12/modules', shown: 'page', frameDoc: page('/calendar'), navbar: { course: 'top' } });
  assert.equal(h.ui.model().place, 'rail');
  h.state.shown = ''; h.state.frameDoc = null; h.ui.sync();
  assert.equal(h.ui.model().course, true); assert.equal(h.ui.model().active, 'course');
  assert.equal(h.ui.model().place, 'top'); assert.equal(h.ui.model().menu.name, 'Course 12');
  assert.deepEqual(h.room(), ['0px', '124px']);
});

test('unchanged frame navigation preserves navbar nodes, focus and reserved room', async () => {
  const h = await setup({ shown: '12', frameDoc: course() });
  const link = h.root.querySelector('.rail [data-id="calendar"]'), list = h.root.querySelector('.list');
  link.focus(); const children = [...list.children], room = h.room(); let changes = 0;
  h.ui.on('change', () => changes++);
  for (const path of ['/courses/12/modules/7', '/courses/12/modules/8?module_item_id=9']) {
    h.state.frameDoc.location = new URL(path, origin); h.ui.sync();
  }
  assert.deepEqual(list.children, children); assert.equal(h.root.activeElement, link);
  assert.deepEqual(h.room(), room); assert.equal(changes, 0);
});

test('a changed frame course menu renders once and repeated syncs keep its new nodes', async () => {
  const h = await setup({ shown: '12', frameDoc: course() }); let changes = 0;
  h.ui.on('change', () => changes++);
  h.state.frameDoc = course('/courses/12/grades'); h.ui.sync();
  const item = h.root.querySelector('.cmenu [aria-current="page"]');
  assert.equal(item.href, origin + '/courses/12/grades');
  h.ui.sync(); h.ui.sync(); assert.equal(changes, 1);
  assert.equal(h.root.querySelector('.cmenu [aria-current="page"]'), item);
});

test('a rail course-menu re-render restores its focused link', async () => {
  const h = await setup({ shown: '12', frameDoc: course() });
  const old = h.root.querySelector('.cmenu [data-id="cm:1"]'); old.focus();
  h.state.frameDoc = course('/courses/12/grades'); h.ui.sync();
  assert.ok(h.root.activeElement === h.root.querySelector('.cmenu [data-id="cm:1"]'));
});

test('in forced colours the bar still shows where you are and what is pressed', () => {
  const css = read('features/navbar.css'), at = css.indexOf('@media screen and (forced-colors: active)');
  assert.ok(at > 0, 'a forced-colours block');
  const fc = css.slice(at, css.indexOf('\n}\n', at));
  // The markers and the current rows are fills and shadows, which forced colours drop; Pinned is a fill too.
  for (const sel of ['.ind', '.tind', '.pill', ':is(.chip, .row, .tsub .item)[aria-current="page"]', '.pin[aria-pressed="true"]']) assert.ok(fc.includes(sel), sel);
  assert.match(fc, /\{ border: 2px solid Highlight; \}/);
  assert.match(fc, /\.ind::before, \.tind::after \{ forced-color-adjust: none; background: Highlight; \}/);
});

test('rail and top room follow width boundaries and float or embed dimensions', async () => {
  const css = read('features/navbar.css');
  const open = Number(css.match(/--open: (\d+)px/)[1]), shut = Number(css.match(/--shut: (\d+)px/)[1]);
  const gutter = Number(css.match(/--gutter: (\d+)px/)[1]);
  for (const style of ['float', 'embed']) for (const place of ['rail', 'top']) {
    const h = await setup({ navbar: { style, place } }), gap = style === 'float' ? 2 * gutter : 0;
    for (const width of [1280, 1279, 900, 899, 390, 1440]) {
      h.context.innerWidth = width; h.events.resize();
      assert.deepEqual(h.room(), [place === 'rail' && width >= 900 ? `${(width >= 1280 ? open : shut) + gap}px` : '0px',
        place === 'top' && width >= 900 ? `${M.BAR.top + gap}px` : '0px'], `${style} ${place} ${width}`);
    }
  }
});

test('native destinations use live course and page frames without clicking the outer links', async () => {
  for (const shown of ['12', 'page']) {
    const h = await setup({ shown, frameDoc: shown === 'page' ? page('/calendar') : course() });
    const e = h.click(h.root.querySelector('.rail [data-id="messages"]'));
    assert.equal(e.defaultPrevented, true); assert.deepEqual(h.routed, [origin + '/conversations']);
    assert.deepEqual(h.assigned, []); assert.equal(h.document.getElementById('global_nav_conversations_link').clicks, undefined);
    assert.equal(h.state.leaves, undefined);
  }
});

test('native routing falls back to its outer link when frames are absent or decline', async () => {
  for (const count of [0, 1]) {
    const h = await setup(); h.state.count = count; h.state.accept = false;
    h.ui.go('calendar');
    assert.equal(h.document.getElementById('global_nav_calendar_link').clicks, 1);
    assert.equal(h.routed.length, count); assert.equal(h.state.leaves, 1); assert.deepEqual(h.assigned, []);
  }
});

test('course-menu links use the frame controller and retain modifier-click behavior', async () => {
  const h = await setup({ shown: '12', frameDoc: course() });
  const link = h.root.querySelector('.cmenu [data-id="cm:1"]');
  assert.equal(h.click(link, { ctrlKey: true }).defaultPrevented, false); assert.deepEqual(h.routed, []);
  assert.equal(h.click(link).defaultPrevented, true); assert.deepEqual(h.routed, [origin + '/courses/12/assignments']);
  h.state.accept = false; h.click(link); assert.deepEqual(h.assigned, [link.href]);
});

test('RTL top-bar arrows reverse direction without changing the reserved room', async () => {
  for (const dir of ['ltr', 'rtl']) {
    const h = await setup({ dir, navbar: { place: 'top' } });
    const calendar = h.root.querySelector('.topbar [data-id="calendar"]'); calendar.focus();
    const e = h.key('ArrowRight');
    assert.equal(e.defaultPrevented, true); assert.equal(h.root.activeElement.dataset.id, dir === 'rtl' ? 'course' : 'messages');
    assert.equal(h.host.dir, dir); assert.deepEqual(h.room(), ['0px', '80px']);
  }
});

test('the mobile More sheet traps Tab in both directions and Escape returns focus', async () => {
  const h = await setup({ width: 390 }), more = h.root.querySelector('.more.tab');
  h.click(more);
  const sheet = h.root.querySelector('.sheet'), items = sheet.querySelectorAll('a, button');
  assert.equal(sheet.open, true); assert.equal(h.root.activeElement, items[0]);
  items.at(-1).focus(); assert.equal(h.key('Tab').defaultPrevented, true); assert.equal(h.root.activeElement, items[0]);
  assert.equal(h.key('Tab', { shiftKey: true }).defaultPrevented, true); assert.equal(h.root.activeElement, items.at(-1));
  h.key('Escape'); assert.equal(sheet.open, false); assert.equal(h.root.activeElement, more);
  assert.deepEqual(h.room(), ['0px', '0px']);
});

test('the rail’s Pin open keeps its name pinned or not; pressed says which', async () => {
  for (const [rail, pressed] of [['open', 'true'], ['icons', 'false']]) {
    const pin = (await setup({ navbar: { rail } })).root.querySelector('.rail .pin');
    assert.equal(pin.textContent, 'Pin open', rail);
    assert.equal(pin.getAttribute('aria-pressed'), pressed, rail);
  }
});

test('Escape folds the icons-only rail’s peek and leaves focus on the item that had it', async () => {
  const h = await setup({ navbar: { rail: 'icons' } }), rail = h.root.querySelector('.rail'), calendar = rail.querySelector('[data-id="calendar"]');
  calendar.focus(); rail.dispatchEvent({ type: 'focusin', target: calendar, composedPath: () => [calendar, rail] });
  assert.equal(rail.hasAttribute('data-peek'), true);
  assert.equal(h.key('Escape').defaultPrevented, true);
  assert.equal(rail.hasAttribute('data-peek'), false);
  assert.equal(h.root.activeElement?.dataset.id, 'calendar');
});

test('Skip to content focuses the visible Canvas frame instead of the covered page', async () => {
  const focused = [];
  for (const shown of ['12', 'page']) {
    const frameDoc = shown === '12' ? course() : page('/calendar'), h = await setup({ shown, frameDoc });
    h.click(h.root.querySelector('.skip'));
    focused.push(frameDoc.activeElement === frameDoc.getElementById('content'));
  }
  assert.deepEqual(focused, [true, true], 'the visible course or page content must receive focus');
});

test('same-site custom navbar links preserve running Canvas frames', async () => {
  const h = await setup({ shown: '12', frameDoc: course(), prefs: { links: [{ id: 'aaaaaaaaaaaa', n: 'Calendar shortcut', u: origin + '/calendar', i: 'calendar', tab: false }] } });
  const link = h.root.querySelector('.rail [data-id="link:aaaaaaaaaaaa"]'), event = h.click(link);
  // The document's Canvas link handler sees the shadow host as event.target.
  // Exercise that real fallback too: it cannot rescue a shadow-root anchor.
  const source = read('features/coursetabs.js');
  const outerClick = vm.runInNewContext(source.slice(source.indexOf('  const onCourseLink ='), source.indexOf('  // A course page in its course')) + '\nonCourseLink;', {
    L: require('../lib/coursetabs.js'), Element: NavEl, on: true, preview: false, framed: '', PAGE: 'page', showing: '',
    document: h.document, location: h.document.location, frames: new Map([['12', {}]]), here: () => '',
    openPage: (url) => h.routed.push(origin + url), openAt: (_, url) => h.routed.push(origin + url),
  });
  event.target = h.host; event.isTrusted = true; outerClick(event);
  assert.equal(event.defaultPrevented, true, 'prevent the anchor default from replacing the top document');
  assert.deepEqual(h.routed, [origin + '/calendar']);
});

test('re-rendering the top course menu preserves its focused link', async () => {
  const h = await setup({ shown: '12', frameDoc: course(), navbar: { place: 'top' } });
  const old = h.root.querySelector('.tsub [data-id="cm:1"]'); old.focus();
  assert.equal(h.root.activeElement, old);
  h.state.frameDoc = course('/courses/12/grades'); h.ui.sync();
  const current = h.root.querySelector('.tsub [data-id="cm:1"]');
  assert.notEqual(current, old, 'the menu actually re-rendered'); assert.equal(current.isConnected, true);
  assert.ok(h.root.activeElement === current, 'keyboard focus must survive the frame menu update');
});

test('the Courses panel marks the visible framed course as current', async () => {
  const h = await setup({ path: '/courses/12', shown: '34', frameDoc: course('/courses/34') });
  assert.equal(h.ui.model().course, true); assert.equal(h.ui.model().menu.name, 'Course 34');
  const data = await h.adapter.panel('course');
  assert.deepEqual(plain(data.sections[0].rows.filter((r) => r.current).map((r) => r.href)), [origin + '/courses/34']);
});

test('Skip to content handles the outer page and unreadable frame documents', async () => {
  for (const shown of ['', '12']) {
    const h = await setup({ shown, frameDoc: null });
    h.click(h.root.querySelector('.skip'));
    assert.ok(h.document.activeElement === h.document.getElementById('content'));
  }
  const h = await setup(); h.bar.doc = () => { throw Error('gone'); };
  h.click(h.root.querySelector('.skip'));
  assert.ok(h.document.activeElement === h.document.getElementById('content'));
});

test('Skip and Canvas panels ignore hidden, inert, detached and replaced frame documents', async () => {
  for (const invalidate of [
    (h) => { h.frame.style.visibility = 'hidden'; },
    (h) => { h.frame.inert = true; },
    (h) => h.frame.remove(),
    (h) => { h.frame.contentDocument = page('/calendar'); },
    (h) => { h.state.frameDoc.defaultView = null; },
    (h) => { h.state.frameDoc.location = new URL('https://other.test/courses/34'); },
    (h) => { Object.defineProperty(h.state.frameDoc, 'location', { get() { throw Error('gone'); } }); },
  ]) {
    const h = await setup({ path: '/courses/12', shown: '34', frameDoc: course('/courses/34') }), doc = h.state.frameDoc;
    // Like bar.doc(), return the selected same-origin document even while its frame is hidden.
    h.bar.doc = () => doc; invalidate(h);
    h.click(h.root.querySelector('.skip'));
    assert.ok(h.document.activeElement === h.document.getElementById('content'));
    assert.equal(doc.focused, null, 'unavailable frame content must not receive focus');
    const data = await h.adapter.panel('course');
    assert.deepEqual(plain(data.sections[0].rows.filter((r) => r.current).map((r) => r.href)), [origin + '/courses/12']);
  }
});

test('Skip releases frame tabindex on surface changes and preserves authored values on stop', async () => {
  for (const change of ['leave', 'replace', 'detach', 'stop']) for (const tabindex of [null, '2']) {
    const h = await setup({ shown: '12', frameDoc: course() }), main = h.state.frameDoc.getElementById('content');
    if (tabindex !== null) main.setAttribute('tabindex', tabindex);
    h.click(h.root.querySelector('.skip'));
    assert.equal(main.getAttribute('tabindex'), tabindex || '-1');
    if (change === 'leave') h.state.shown = '';
    if (change === 'replace') h.state.frameDoc = course('/courses/12/grades');
    if (change === 'detach') h.frame.remove();
    if (change === 'stop') h.settings.navbar.on = false;
    h.ui.sync();
    assert.equal(main.getAttribute('tabindex'), tabindex, change);
  }
  const h = await setup({ shown: '12', frameDoc: course() }), main = h.state.frameDoc.getElementById('content');
  h.click(h.root.querySelector('.skip')); main.setAttribute('tabindex', '3');
  h.settings.navbar.on = false; h.ui.sync();
  assert.equal(main.getAttribute('tabindex'), '3', 'a later site-authored value survives cleanup');
});

test('top course-menu focus follows the destination across reordering and removal', async () => {
  for (const change of ['reorder', 'remove', 'course']) {
    const h = await setup({ shown: '12', frameDoc: course(), navbar: { place: 'top' } });
    h.root.querySelector('.tsub [data-id="cm:1"]').focus();
    const doc = course(change === 'course' ? '/courses/34/grades' : '/courses/12/grades'), list = doc.getElementById('section-tabs');
    if (change === 'reorder') list.prepend(list.children[1]);
    if (change === 'remove') list.children[1].remove();
    h.state.frameDoc = doc; h.ui.sync();
    if (change === 'reorder') assert.equal(h.root.activeElement?.href, origin + '/courses/12/assignments');
    else assert.equal(h.root.activeElement, null, 'a missing destination must not focus an unrelated course link');
  }
});

test('signing out from the bar\'s account panel tells the course tabs first, so their pictures go', async () => {
  const h = await setup({ path: '/courses/12' });
  h.click(h.root.querySelector('[data-id="profile"]'));
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  const out = h.root.querySelector('.panel [data-run="logout"]');
  assert.ok(out, 'the panel offers Sign out');
  h.click(out);
  assert.equal(h.state.signouts, 1);
});

test('cached Canvas panel rows follow the course and outer page on reopening', async () => {
  const h = await setup({ path: '/courses/12', shown: '34', frameDoc: course('/courses/34') });
  let requests = 0;
  h.context.fetch = async () => { requests++; return new Response(JSON.stringify([{ id: 12, name: 'Course 12' }, { id: 34, name: 'Course 34' }])); };
  const open = async () => {
    h.click(h.root.querySelector('.rail [data-id="course"]'));
    await new Promise(setImmediate);
    return h.root.querySelector('.panel [aria-current="page"]')?.href;
  };
  assert.equal(await open(), origin + '/courses/34');
  for (const shown of ['12', '']) {
    h.click(h.root.querySelector('.panel .close'));
    h.state.shown = shown; h.state.frameDoc = course('/courses/12'); h.ui.sync();
    assert.equal(await open(), origin + '/courses/12');
  }
  assert.equal(requests, 1, 'the cached response was reused');
});

test('an open Canvas panel updates its current row without replacing focused controls', async () => {
  const h = await setup({ shown: '34', frameDoc: course('/courses/34') });
  h.click(h.root.querySelector('.rail [data-id="course"]')); await new Promise(setImmediate);
  const link = h.root.querySelector('.panel [aria-current="page"]'); link.focus();
  h.state.shown = '12'; h.state.frameDoc = course('/courses/12'); h.ui.sync();
  assert.equal(h.root.querySelector('.panel [aria-current="page"]')?.href, origin + '/courses/12');
  assert.ok(h.root.activeElement === link, 'updating current state preserves panel focus');
  assert.equal(link.getAttribute('part'), 'panel-row');
});

test("Canvas's footer is in its page, above the bar's room: the bar isn't raised for it, and Previous and Next stand on the bar", async () => {
  const h = await setup({ width: 390 });
  h.document.documentElement.setAttribute('data-gz-footer', '');
  h.ui.sync();
  assert.equal(h.host.hasAttribute('data-footer'), false, 'raised for a footer that is not under it, the bar covered Canvas\'s Previous and Next');
  // Canvas fixes its Previous and Next bar to the window's bottom (inline, z-index 100), under the phone bar.
  const css = read('canvas.css');
  const rule = 'html[data-gz-navbar]:not([data-gz-navbar~="none"]) #module_sequence_footer:is([style*="fixed"], [data-gz-fixed-bottom]) { bottom: calc(96px + env(safe-area-inset-bottom, 0px)) !important; }';
  assert.ok(css.match(/@media \(max-width: 899\.98px\) \{[\s\S]*?\n\}/g).some((block) => block.includes(rule)), 'lifted only where the bar runs along the bottom');
});

test("a Canvas jQuery UI dialog showing takes Glaze's layers under it with the page, and Canvas keeps its own order", () => {
  const css = read('canvas.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = 'body:has(> .ui-widget-overlay:not([style*="display: none"]), > .ui-dialog:not([style*="display: none"])) :is(#gz-navbar, #gz-sb-launch, #gz-sb-edge, #gz-ctabs-frames, #gz-float .gz-w, #gz-float[data-stack]) { z-index: 998 !important; }';
  assert.ok(css.includes(rule), 'while a dialog or its backdrop shows (jQuery hides them with an inline display: none)');
  // jQuery UI starts its dialogs at z-index 1000, inline; each of these layers stands over that otherwise.
  const z = (file, start) => { const src = read(file), at = src.indexOf(start); return Number(src.slice(at, src.indexOf('}', at)).match(/z-index: (\d+)/)[1]); };
  for (const [file, start] of [['features/navbar.css', ':host {'], ['features/sidebar.css', '.gz-sb-edge, .gz-sb-launch {'], ['features/coursetabs.css', '#gz-ctabs-frames {']]) assert.ok(z(file, start) > 1000, `${file} ${start}`);
  // Canvas's own stacking among its dialogs, their backdrops and what they open is never overridden.
  assert.doesNotMatch(css, /\.ui-(dialog|widget-overlay)[^{,]*\{[^}]*z-index/);
});

test("on a short window the rail's list keeps the open course's tab in view, and fades at the edge it goes on past", async () => {
  const h = await setup({ shown: '12', frameDoc: page('/courses/12') });
  const list = h.root.querySelector('.rail .list'), tab = list.querySelector('.ctab-go[aria-current="page"]');
  assert.ok(tab, 'the open course\'s tab is in the rail');
  // The list 300px tall from y 80, 900px of it; the open course's tab far below the fold.
  let height = 900;
  Object.defineProperty(list, 'scrollHeight', { get: () => height });
  Object.defineProperty(list, 'clientHeight', { get: () => 300 });
  list.box = { left: 12, top: 80, width: 248, height: 300 }; list.scrollTop = 0;
  tab.box = { left: 20, top: 640, width: 230, height: 44 };
  h.context.innerHeight = 420; h.events.resize();
  assert.equal(list.scrollTop, 640 + 44 - (380 - 28), 'scrolled until the tab clears the fade');
  assert.equal(list.getAttribute('data-scroll'), 'start end');
  // Scrolled by the student: the fade follows; at the end, only the top fades.
  list.scrollTop = 600; list.dispatchEvent({ type: 'scroll' });
  assert.equal(list.getAttribute('data-scroll'), 'start');
  // Room for all of it: no fade.
  height = 300; h.events.resize();
  assert.equal(list.getAttribute('data-scroll'), null);
  const css = read('features/navbar.css');
  for (const at of ['end', 'start']) assert.match(css, new RegExp(`\\.list\\[data-scroll~="${at}"\\] \\{ -webkit-mask-image: linear-gradient\\(to ${at === 'end' ? 'bottom' : 'top'}, #000 calc\\(100% - 28px\\), transparent\\);`));
});

// ---- WP-N2 (NAV-9, NAV-12): focus after a redraw, and tooltips ----------------------------------------------------------------
test('closing a panel puts focus back on its item even when the bar was redrawn while the panel was open', async () => {
  const h = await setup({ shown: '34', frameDoc: course('/courses/34') });
  const opener = h.root.querySelector('.rail [data-id="course"]');
  h.click(opener); await new Promise(setImmediate);
  assert.equal(h.root.querySelector('.panel').hidden, false);
  assert.ok(h.root.querySelector('.panel').contains(h.root.activeElement), 'focus went into the panel');
  // Another course tab on screen: the bar is drawn again, and the button the panel came from is a new element.
  h.state.shown = '12'; h.state.frameDoc = course('/courses/12'); h.ui.sync();
  const again = h.root.querySelector('.rail [data-id="course"]');
  assert.ok(again && again !== opener, 'a new element'); assert.equal(opener.isConnected, false);
  assert.equal(h.key('Escape').defaultPrevented, true);
  assert.equal(h.root.querySelector('.panel').hidden, true);
  assert.ok(h.root.activeElement === again, 'back on the item that opened it, not lost to the page');
  // The panel's own Close button does the same.
  h.click(again); await new Promise(setImmediate);
  h.state.shown = '34'; h.state.frameDoc = course('/courses/34'); h.ui.sync();
  h.click(h.root.querySelector('.panel .close'));
  assert.ok(h.root.activeElement === h.root.querySelector('.rail [data-id="course"]'));
});

test('a bar tooltip goes away on Escape, wherever focus is, without moving the pointer', async () => {
  const h = await setup({ navbar: { rail: 'icons' } });
  const heard = new Map();
  h.document.addEventListener = (type, f) => heard.set(`${type}`, f);
  h.document.removeEventListener = (type, f) => { if (heard.get(type) === f) heard.delete(type); };
  const rail = h.root.querySelector('.rail'), item = rail.querySelector('[data-id="calendar"]'), tip = h.root.querySelector('.tip');
  rail.dispatchEvent({ type: 'pointerover', composedPath: () => [item, rail] });
  assert.equal(tip.hasAttribute('data-on'), true, 'the tip shows on hover');
  assert.equal(tip.textContent, 'Calendar');
  heard.get('keydown')({ key: 'ArrowDown' });
  assert.equal(tip.hasAttribute('data-on'), true, 'other keys leave it');
  heard.get('keydown')({ key: 'Escape' });
  assert.equal(tip.hasAttribute('data-on'), false, 'Escape dismisses it (WCAG 1.4.13)');
  assert.equal(heard.has('keydown'), false, 'and the page-level listener goes with it');
  // Turning the bar off takes the listener away too.
  rail.dispatchEvent({ type: 'pointerover', composedPath: () => [item, rail] });
  h.ui.sync(); h.settings.navbar.on = false; h.ui.sync();
  assert.equal(heard.has('keydown'), false);
});

test('closing a phone panel returns to More when its still-connected opener is in the closed sheet', async () => {
  const h = await setup({ width: 390 });
  h.click(h.root.querySelector('.tab.more'));
  const opener = h.root.querySelector('.sheet [data-id="profile"]');
  h.click(opener); await new Promise(setImmediate);
  assert.equal(h.root.querySelector('.panel').hidden, false);
  assert.equal(opener.isConnected, true);
  // Browser getClientRects is empty for descendants of the now-closed modal sheet.
  for (const e of h.root.querySelectorAll('[data-id="profile"]')) e.getClientRects = () => [];
  h.key('Escape');
  assert.ok(h.root.activeElement === h.root.querySelector('.tab.more'), 'return to the visible More button, not the hidden account row');
});
