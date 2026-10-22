const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const L = require('../lib/coursetabs.js'), M = require('../lib/navbar.js');
const G = require('../defaults.js');
const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const origin = 'https://school.instructure.com';
const part = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `${a} exists`);
  return source.slice(start, end);
};

function reservation(framed = '12', site = 'canvas') {
  const parentValues = new Map(), ownValues = new Map(), writes = [], observers = [];
  const html = { style: { getPropertyValue: (k) => ownValues.get(k) || '',
    setProperty: (k, v) => { ownValues.set(k, v); writes.push([k, v]); },
    removeProperty: (k) => { ownValues.delete(k); writes.push([k, null]); } } };
  const parentHtml = {}, parent = { document: { documentElement: parentHtml },
    getComputedStyle: (el) => { assert.equal(el, parentHtml); return { getPropertyValue: (k) => parentValues.get(k) || '' }; } };
  const context = vm.createContext({ framed, ctx: { site }, html, parent, navWatch: null,
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(node, options) { this.node = node; this.options = options; this.active = true; } disconnect() { this.active = false; } },
    document: { addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {},
    onScroll() {}, onLeave() {}, onCourseLink() {}, onPress() {}, onPop() {}, onHide() {}, onShow() {}, onResize() {}, onStore() {}, bar: { place() {} }, chrome: { runtime: {} },
  });
  const api = vm.runInContext(part('  const navRoom =', '  const start =') + '\n({ navRoom, listen });', context);
  return { ...api, parentValues, ownValues, writes, observers, parentHtml };
}

test('course and page frames copy the parent room across placement and width changes', () => {
  for (const framed of ['12', 'page']) {
    const h = reservation(framed), settings = G.GZ_SANITIZE().navbar;
    for (const width of [390, 899, 900, 1279, 1280, 1440]) for (const style of ['float', 'embed']) for (const course of ['same', 'icons', 'top', 'hide']) {
      const lay = M.layout({ ...settings, style, course }, { width, course: true, menu: true });
      h.parentValues.set('--gz-navbar-left', ` ${lay.left}px `); h.parentValues.set('--gz-navbar-top', ` ${lay.top}px `);
      h.navRoom();
      assert.equal(h.ownValues.get('--gz-navbar-left'), `${lay.left}px`);
      assert.equal(h.ownValues.get('--gz-navbar-top'), `${lay.top}px`);
      const count = h.writes.length; h.navRoom(); assert.equal(h.writes.length, count, 'same geometry causes no frame style mutation');
    }
  }
});

test('clearing parent reservations clears frame overrides; top pages and other sites do not copy them', () => {
  const h = reservation(); h.parentValues.set('--gz-navbar-left', '272px'); h.navRoom();
  assert.equal(h.ownValues.get('--gz-navbar-left'), '272px');
  h.parentValues.clear(); h.navRoom(); assert.equal(h.ownValues.has('--gz-navbar-left'), false);
  for (const [framed, site] of [['', 'canvas'], ['12', 'ultra']]) {
    const other = reservation(framed, site); other.parentValues.set('--gz-navbar-left', '272px'); other.navRoom();
    assert.deepEqual(other.writes, []);
  }
});

test('frame room observes parent style and navbar words and disconnects on disable', () => {
  const h = reservation('page'); h.parentValues.set('--gz-navbar-left', '96px'); h.listen(true);
  const observer = h.observers[0];
  assert.equal(observer.node, h.parentHtml);
  assert.deepEqual(Array.from(observer.options.attributeFilter), ['data-gz-navbar', 'style']);
  h.parentValues.set('--gz-navbar-left', '0px'); h.parentValues.set('--gz-navbar-top', '124px'); observer.fn();
  assert.equal(h.ownValues.get('--gz-navbar-left'), '0px'); assert.equal(h.ownValues.get('--gz-navbar-top'), '124px');
  h.listen(false); assert.equal(observer.active, false);
});

function navigation({ showing = '12', here = '5', count = 1, framed = '' } = {}) {
  const calls = [], frames = new Map(Array.from({ length: count }, (_, i) => [String(i + 12), {}]));
  const context = vm.createContext({ L, URL, PAGE: 'page', requestAnimationFrame() {}, nudge() {}, on: true, framed, showing, frames,
    ctx: { site: 'canvas' }, location: { origin }, here: () => here,
    openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    route: (url) => calls.push(['route', url]), show: (cid) => calls.push(['show', cid]), toTop: (op, value) => calls.push([op, value.url]),
  });
  const bar = vm.runInContext(part('  const pageable =', '  // A course page in its course')
    + part('  const bar = {', '  return { sync') + '\nbar;', context);
  return { bar, calls, frames, context };
}

test('the real bar controller sends navbar destinations to course or page frames with queries intact', () => {
  for (const showing of ['12', 'page']) {
    const h = navigation({ showing });
    for (const href of ['/courses/34/assignments?module_item_id=9', '/calendar?view=month', '/conversations/42']) assert.equal(h.bar.open(origin + href), true);
    assert.deepEqual(h.calls, [['course', '34', '/courses/34/assignments?module_item_id=9'], ['page', '/calendar?view=month'], ['page', '/conversations/42']]);
  }
  const h = navigation({ showing: '', count: 0, here: '' });
  h.bar.open('/courses/12/modules'); assert.deepEqual(h.calls, [['course', '12', '/courses/12/modules']], 'a dashboard course link can start its first frame');
});

test('the navbar reads only the shown same-origin frame document and tolerates a navigating frame', () => {
  const h = navigation(), doc = { location: { origin, pathname: '/courses/12/modules' } };
  const el = { contentDocument: doc }; h.frames.set('12', { el });
  assert.equal(h.bar.doc(), doc);
  h.context.showing = 'page'; assert.equal(h.bar.doc(), null);
  h.frames.set('page', { el }); assert.equal(h.bar.doc(), doc);
  doc.location.origin = 'https://other.test'; assert.equal(h.bar.doc(), null);
  Object.defineProperty(el, 'contentDocument', { get() { throw Error('navigating'); } });
  assert.equal(h.bar.doc(), null);
});

function messages(shown = 'page') {
  const posted = [], frameWindow = { postMessage: (m) => posted.push(m) }, doc = { location: new URL(shown === 'page' ? '/calendar' : `/courses/${shown}/modules`, origin) };
  const f = { el: { contentWindow: frameWindow, contentDocument: doc, style: {} }, ready: true, accountDoc: doc };
  let listener, synced = 0, watched = 0, kept = 0;
  vm.runInNewContext(part('  let drawerFrom = ', '  const drawerOn = ') + part("  if (!framed && !preview) addEventListener('message'", '  // In a tab\'s frame on Ultra'), {
    L, PAGE: 'page', requestAnimationFrame() {}, nudge() {}, framed: '', preview: false, showing: shown, on: true, ctx: { site: 'canvas' }, location: { origin },
    frames: new Map([[shown, f]]), spare: new Map(), next: new Map(), who: '42',
    addEventListener: (_, fn) => { listener = fn; },
    GZ_NAVBAR_UI: { sync: () => synced++ }, watch: () => watched++, later() {}, keepPage: () => kept++,
  });
  const send = (op, source = frameWindow, fromOrigin = origin) => listener({ origin: fromOrigin, source, data: { gzCtab: op, uid: '42' } });
  return { send, doc, f, posted, counts: () => ({ synced, watched, kept }) };
}

test('page-frame route notifications refresh the bar and reject unowned senders', () => {
  const h = messages();
  h.send('moved', {}); h.send('moved', undefined, 'https://other.test');
  assert.deepEqual(h.counts(), { synced: 0, watched: 0, kept: 0 });
  h.doc.location = new URL('/conversations', origin); h.send('moved');
  assert.deepEqual(h.counts(), { synced: 1, watched: 0, kept: 1 });
});

test('a replaced course-frame document schedules readiness before the navbar menu refresh', () => {
  const h = messages('12'); h.f.el.contentDocument = { location: new URL('/courses/12/grades', origin) };
  h.send('account'); assert.deepEqual(h.counts(), { synced: 0, watched: 1, kept: 0 }); assert.equal(h.f.ready, false);
  let now = 0, next, synced = 0;
  const doc = h.f.el.contentDocument;
  Object.assign(doc, { body: {}, querySelector: () => ({ childElementCount: 1 }), documentElement: { matches: () => false }, addEventListener() {}, removeEventListener() {} });
  const watch = vm.runInNewContext(part('  const canvasContent = ', '  let showing = ') + part('  const watch = (cid, f)', '  const open = (cid, url)') + '\nwatch;', {
    L, PAGE: 'page', requestAnimationFrame() {}, nudge() {}, frames: new Map([['12', h.f]]), location: { origin }, ctx: { site: 'canvas' },
    showing: '12', waiting: '', performance: { now: () => now }, MutationObserver: class { observe() {} disconnect() {} },
    shown: () => true, loading: () => false, clearTimeout() {}, setTimeout: (fn) => { next = fn; },
    clearSlow() {}, unpicture() {}, later() {}, GZ_NAVBAR_UI: { sync: () => synced++ },
  });
  watch('12', h.f); assert.equal(synced, 0); now = 301; next();
  assert.equal(h.f.ready, true); assert.equal(synced, 1);
  assert.deepEqual(h.posted.map((m) => ({ ...m })), [{ gzCtab: 'visible', on: true }], 'sidebar ownership begins once the replacement is ready');
});

test('same-document course-frame navigation refreshes the navbar course menu', () => {
  const h = messages('12');
  // A same-document Canvas route retains accountDoc, so the account handshake does
  // not start a new readiness watch. pass() sends moved for the new route instead.
  h.doc.location = new URL('/courses/12/grades', origin); h.send('account');
  assert.equal(h.counts().watched, 0);
  h.send('moved'); assert.equal(h.counts().kept, 1, 'the owned frame notification was handled');
  assert.equal(h.counts().synced, 1, 'the visible course menu must follow the frame route');
});
