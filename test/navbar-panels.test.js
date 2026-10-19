const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');

// Exercise the renderer's real asynchronous panel lifecycle with a deferred site response.
const panelHarness = () => {
  const doc = { activeElement: null, addEventListener() {}, removeEventListener() {} };
  const box = new El('div', doc), from = new El('button', doc);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(new El(tag, doc), props); e.append(...kids); return e; };
  const root = { querySelectorAll: () => [], get activeElement() { return doc.activeElement; } };
  let resolve;
  const context = vm.createContext({ document: doc, root, el: { panel: box }, host: {}, panel: '', panelTurn: 0, panelFrom: null, panels: new Map(),
    byId: () => ({ label: 'Messages' }), make, put: (e, ...kids) => { e.append(...kids); return e; }, part: (e) => e, icon: () => new El('svg', doc), t: (s) => s, emit() {},
    menuTo() {}, sheetTo() {}, placePanel() {}, outsidePanel() {}, URL, location: { href: 'https://school.test/', origin: 'https://school.test', protocol: 'https:', host: 'school.test' }, isPreview: false,
    M: { PICKS: ['bell'] }, site: { panel: () => new Promise((r) => { resolve = r; }) } });
  const src = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
  vm.runInContext(src.slice(src.indexOf('  const safeHref ='), src.indexOf('  // The open course')) + src.slice(src.indexOf('  const panelRow ='), src.indexOf('  const outsidePanel =')) + '\nglobalThis.open = panelTo;', context);
  return { doc, box, from, open: context.open, resolve: (v) => resolve(v) };
};

test('a panel response preserves focus after the user tabs back to the page', async () => {
  const h = panelHarness();
  const pending = h.open('messages', h.from);
  assert.ok(h.box.contains(h.doc.activeElement), 'loading panel receives initial focus');
  const main = new El('button', h.doc); main.focus();
  h.resolve({ sections: [] }); await pending;
  assert.ok(h.doc.activeElement === main, 'completion must leave page focus alone');
});

test('a response keeps focus in the panel if the user is still there; closing discards late responses', async () => {
  const h = panelHarness();
  let pending = h.open('messages', h.from);
  h.resolve({ sections: [] }); await pending;
  assert.ok(h.box.contains(h.doc.activeElement));
  pending = h.open('notifications', h.from);
  await h.open('', null, false);
  h.resolve({ title: 'Late', sections: [] }); await pending;
  assert.equal(h.box.hidden, true);
  assert.equal(h.box.textContent, '');
});

test('panel response labels and descriptions remain literal text', async () => {
  const h = panelHarness(), pending = h.open('notifications', h.from);
  const text = '<img src=x onerror=alert(1)>';
  h.resolve({ title: text, sections: [{ label: text, rows: [{ label: text, sub: text, href: 'https://school.test/mod/assign/view.php?id=8', icon: 'bell' }] }] });
  await pending;
  assert.equal(h.box.querySelector('img'), null);
  assert.ok(h.box.textContent.includes(text));
  assert.equal(h.box.querySelector('a').href, 'https://school.test/mod/assign/view.php?id=8');
});

test('turning the bar off restores tabindex added by Skip to content', () => {
  const src = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
  for (const tabindex of [null, '2']) {
    const doc = { activeElement: null }, main = new El('main', doc), skip = new El('a', doc), html = new El('html', doc);
    if (tabindex !== null) main.setAttribute('tabindex', tabindex);
    // Mirror the browser's reflected tabindex property in this small DOM stand-in.
    Object.defineProperty(main, 'tabIndex', { set(v) { this.setAttribute('tabindex', String(v)); } });
    const context = vm.createContext({ document: doc, html, el: { skip }, host: new El('div', doc), site: { main: () => main, unobserve() {} }, tabsApi: () => null,
      chrome: { runtime: { id: "glaze" } }, clearLogo() {},
      enter: 0, leave: 0, frame: 0, queued: 0, sheetOpen: false, sizes: null, words: '', panels: new Map(),
      clearTimeout() {}, cancelAnimationFrame() {}, menuTo() {}, panelTo() {}, dockTo() {}, emit() {} });
    const declarations = src.slice(src.indexOf('  let cmenu ='), src.indexOf('  const panels ='));
    vm.runInContext(declarations + src.slice(src.indexOf('  const click ='), src.indexOf('  const key =')) + src.slice(src.indexOf('  const stop ='), src.indexOf('  const sync =')) + '\nglobalThis.skip = click; globalThis.stop = stop;', context);
    context.skip({ type: 'click', composedPath: () => [skip], preventDefault() {} });
    assert.equal(doc.activeElement, main);
    context.stop();
    assert.equal(main.getAttribute('tabindex'), tabindex);
  }
});

const M = require('../lib/navbar.js');
const source = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const location = { href: 'https://school.test/courses/12', origin: 'https://school.test' };
const urls = () => between(source.includes('  const safeHref =') ? '  const safeHref =' : '  const sameSite =', '  // The open course');

test('course menus keep all native pages, including courses with more than 24 links', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ label: `Page ${i}`, href: `/courses/12/pages/${i}` }));
  items[0].tab = true;
  const read = vm.runInNewContext(urls() + between('  const readMenu =', '  // ---- drawing') + '\nreadMenu;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    URL, location, isPreview: false, M, settings: () => ({}), inCourse: () => true,
    site: { menu: () => ({ items }) }, tabsApi: () => null, document: {},
  });
  assert.equal(read().items.length, items.length, 'hiding the native sidebar must not strand later links');
  assert.equal(read().items[0].tab, true);
});

test('course menu destinations reject blob and credential URLs', () => {
  const items = ['blob:https://school.test/id', 'https://user:pass@school.test/courses/12', '/courses/12/modules'].map((href) => ({ label: 'Page', href }));
  const read = vm.runInNewContext(urls() + between('  const readMenu =', '  // ---- drawing') + '\nreadMenu;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    URL, location, isPreview: false, M, settings: () => ({}), inCourse: () => true,
    site: { menu: () => ({ items }) }, tabsApi: () => null, document: {},
  });
  assert.deepEqual(JSON.parse(JSON.stringify(read().items.map((i) => i.href))), ['/courses/12/modules']);
});

test('panel and course links navigate when the course-tab controller declines them', () => {
  const assigned = [];
  const open = vm.runInNewContext(between('  const openHere =', '  const sameSite =') + '\nopenHere;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    tabsApi: () => ({ open: () => false }), location: { assign: (href) => assigned.push(href) },
  });
  open('/profile');
  assert.deepEqual(assigned, ['/profile']);
});

test('inactive course tabs explicitly decline navigation', () => {
  const src = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
  const open = vm.runInNewContext('({' + src.slice(src.lastIndexOf('    open: (href) => {'), src.indexOf('\n  };', src.lastIndexOf('    open: (href) => {'))) + '\n}).open;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    URL, location, on: false, framed: false,
  });
  assert.equal(open('/profile'), false);
});

test('a delayed panel response preserves focus after the user tabs into page content', async () => {
  let resolve, focused = 0;
  const close = { focus: () => focused++ }, outside = {};
  const root = { activeElement: close, querySelectorAll: () => [] };
  const el = { panel: { hidden: true, replaceChildren() {}, querySelector: () => close, contains: (e) => e === close } };
  const open = vm.runInNewContext(between('  const panelTo =', '  const outsidePanel =') + '\npanelTo;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    host: {}, panel: '', panelTurn: 0, panelFrom: null, panels: new Map(), root, el,
    site: { panel: () => new Promise((r) => { resolve = r; }) },
    drawPanel() {}, menuTo() {}, sheetTo() {}, placePanel() {}, emit() {}, outsidePanel() {},
    document: { addEventListener() {}, removeEventListener() {} },
  });
  const pending = open('course');
  assert.equal(focused, 1);
  root.activeElement = outside;
  resolve({ sections: [] });
  await pending;
  assert.equal(focused, 1, 'loading completion must not take focus back from the page');
});

test('a settled Canvas frame refreshes the shared course menu after navigation', () => {
  const src = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
  let now = 0, next, synced = 0;
  const doc = { body: {}, location: { origin: location.origin, pathname: '/courses/12/modules' }, querySelector: () => ({}), documentElement: { matches: () => false }, addEventListener() {} };
  const f = { el: { contentDocument: doc, style: {} } };
  const watch = vm.runInNewContext(src.slice(src.indexOf('  const watch = (cid, f)'), src.indexOf('  const open = (cid, url)')) + '\nwatch;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    performance: { now: () => now }, frames: new Map([['12', f]]), ctx: { site: 'canvas' }, location,
    L: { owns: () => true }, shown: () => true, loading: () => false,
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout: (fn) => { next = fn; },
    waiting: '', showing: '12', clearSlow() {}, unpicture() {}, later() {},
    GZ_NAVBAR_UI: { sync: () => synced++ },
  });
  watch('12', f);
  now = 400; next();
  assert.equal(f.ready, true);
  assert.equal(synced, 1, 'frame readiness changes the menu even when course-tab rows stay identical');
});

test('shared panel rendering drops malformed rows and unsafe URLs before drawing text', () => {
  const make = (tag, props = {}, ...children) => ({ tag, ...props, children, dataset: {}, style: { setProperty() {} },
    append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
    setAttribute() {}, addEventListener() {},
  });
  const panel = make('div');
  const draw = vm.runInNewContext(urls() + between('  const panelRow =', '  const panelTo =') + '\ndrawPanel;', { PAGE: 'page', keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    URL, location, isPreview: false, M, make, put: (e, ...kids) => { e.append(...kids); return e; }, part: (e) => e, icon: () => make('svg'), badge: () => make('b'), mark: () => 'AB',
    byId: () => ({ label: 'Courses' }), t: (s) => s, el: { panel }, site: {},
  });
  const title = '<img src=x onerror=alert(1)>';
  draw('course', { title, sections: [{ rows: [null, { label: 'Bad', href: 'javascript:alert(1)' }, { label: 'Blob', href: 'blob:https://school.test/id' }, { label: title, href: '/courses/12' }, { label: 'Help', href: 'https://help.test/' }] }], foot: [{ label: 'Sign out', run: 'logout' }] });
  const rows = panel.children.find((e) => e.className === 'body').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[1].children[0].textContent, title);
  assert.equal(rows[1].target, '_blank');
  assert.equal(rows[1].rel, 'noopener noreferrer');
  assert.equal(panel.children.find((e) => e.className === 'foot').children[0].dataset.run, 'logout');
});
