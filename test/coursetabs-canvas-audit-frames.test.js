// Canvas audit: deterministic timers, document replacements and decoded-picture races, without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const L = require('../lib/coursetabs.js');
const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `production section: ${a}`);
  return source.slice(start, end);
};
const origin = 'https://school.instructure.com';
const flush = () => new Promise(setImmediate);

function events(object = {}) {
  const listeners = new Map();
  return Object.assign(object, {
    listeners,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) { for (const fn of [...listeners.get(type) || []]) fn(event); },
  });
}

function node(tag = 'div') {
  const attrs = new Map();
  return events({ localName: tag, style: {}, children: [], isConnected: true, parentElement: null,
    setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k) ?? null,
    hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k),
    toggleAttribute(k, yes) { if (yes) attrs.set(k, ''); else attrs.delete(k); },
    append(...els) { for (const el of els) { el.parentElement = this; this.children.push(el); } },
    prepend(...els) { for (const el of els) { el.parentElement = this; this.children.unshift(el); } },
    remove() { this.isConnected = false; if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((el) => el !== this); this.parentElement = null; },
    attachShadow() { return this.shadow = node('shadow'); },
    getBoundingClientRect: () => ({ x: 0, y: 0 }), decode: () => Promise.resolve(),
  });
}

function canvasDocument(path, { busy = false, placing = false, empty = false } = {}) {
  const content = Object.assign(node('main'), { childElementCount: empty ? 0 : 1, textContent: empty ? '' : 'Course reading' });
  const body = Object.assign(node('body'), { childElementCount: 1, busy });
  const html = Object.assign(node('html'), { matches: () => placing });
  return events({ location: new URL(path, origin), body, documentElement: html, content,
    readyState: 'complete', scrollingElement: { scrollTop: 0, scrollLeft: 0 }, activeElement: null,
    querySelectorAll: () => [],
    querySelector: (selector) => selector === '#content, #main' ? content : null,
  });
}

function fixture({ nativePath = '/', saved = new Map(), stored, manualDecode = false } = {}) {
  let now = 1000, timerId = 0;
  const timers = new Map(), observers = [], decodes = [], navigations = [], focused = [], notices = [], sent = [];
  const frames = new Map(), html = node('html'), host = node('div');
  const location = new URL(nativePath, origin);
  let entryKey = 0;
  const navigation = { get currentEntry() { return { key: `entry-${entryKey}` }; } };
  const history = { state: null, pushState(s) { this.state = s; entryKey++; }, replaceState(s) { this.state = s; } };
  const document = { activeElement: { localName: 'button' }, body: node('body'), createElement(tag) {
    const el = node(tag);
    if (tag !== 'iframe') return el;
    el.contentDocument = events({ location: { origin: 'null', href: 'about:blank', pathname: 'blank', search: '' }, body: { childElementCount: 0 } });
    const frameLocation = { assign: (url) => navigations.push({ name: el.name, type: 'assign', url }) };
    Object.defineProperties(frameLocation, {
      href: { get: () => el.contentDocument.location.href }, origin: { get: () => el.contentDocument.location.origin },
    });
    el.contentWindow = { location: frameLocation, postMessage() {} };
    Object.defineProperty(el, 'src', { set: (url) => navigations.push({ name: el.name, type: 'src', url }) });
    el.focus = () => { document.activeElement = el; focused.push(el.name); };
    return el;
  } };
  class MutationObserver {
    constructor(fn) { this.fn = fn; this.target = null; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.target = null; }
  }
  const tabs = L.clean(['12', '13', '14', '15', '16'].map((cid) => ({ cid, name: `Course ${cid}`, path: `/courses/${cid}` })), 'canvas');
  const c = vm.createContext({ L, URL, PAGE: 'page', LIVE: 4, frames, host, html, document, location, history, navigation,
    on: true, signedOut: false, framed: '', preview: false, showing: '', shownFrom: '', shooting: null, pic: null, showTurn: 0,
    closedCourse: '', navWatch: null, tabs, snaps: new Map(), strip: null, list: null, who: '42', loaded: true, last: undefined,
    ctx: { site: 'canvas', courseId: () => location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1] || '', me: async () => '42', scene() {} },
    here: () => location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1] || '',
    innerWidth: 1200, innerHeight: 800, performance: { now: () => now }, Date: { now: () => now }, MutationObserver,
    setTimeout: (fn, ms = 0) => { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
    clearTimeout: (id) => timers.delete(id),
    sessionStorage: { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) },
    shown: (el) => !!el && el.isConnected !== false && el.visible !== false, loading: (el) => !!el?.busy,
    safePath: (...args) => args.length ? L.safe(...args) : L.safe(location.pathname, location.search),
    Image: class { decode() { return manualDecode ? new Promise((resolve, reject) => decodes.push({ resolve, reject })) : Promise.resolve(); } },
    send: async (m) => { sent.push(m); return null; }, t: (s) => s, P: () => ({ place: true }),
    visitTab(cid) { if (!tabs.some((x) => x.cid === cid)) tabs.push(L.clean([{ cid }], 'canvas')[0]); },
    labelFor: (cid, name) => name, say: (msg) => notices.push(msg),
    readPrefs: async () => {}, hello: async () => {}, pass() {}, key: () => 'key',
    local: (fn) => fn({ get: (k, cb) => cb({ key: { tabs: stored || tabs } }) }),
    save() {}, draw() {}, lay() {}, clearSlow() {}, slowFrame() {}, later() {},
  });
  const api = vm.runInContext(part('  const KEEP = ', '  let showing = ')
    + part('  const pageable = ', '  // A press on a link')
    + part('  const split = ', '  // What is on screen')
    + part('  const keep = ', '  let capTimer = ')
    + part('  const drop = ', '  // Canvas loads a whole page')
    + part('  const openAt = ', '  // A tab: its frame')
    + part('  const visit = (cid) => {', "  if (!framed && !preview) addEventListener('message'")
    + part('  const onStore = ', '  const onResize = ')
    + part('  const start = ', "  let awayFrom = '';")
    + '\n({openAt,openPage,reveal,show,visit,watch,drop,room,start,onStore,onHide,next,spare,onPop,turns,waiting: () => waiting});', c);
  const tick = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  };
  const load = (cid, path, options, frame = frames.get(cid)) => {
    const doc = canvasDocument(path, options);
    frame.el.contentDocument = doc;
    tick(50);
    return doc;
  };
  const ready = (cid, path = `/courses/${cid}`, frame) => { const doc = load(cid, path, undefined, frame); tick(351); return doc; };
  const snap = (cid, path = `/courses/${cid}`) => ({ cid, path, size: [1200, 800], shot: `data:image/jpeg;base64,${cid}`, n: 40, at: now });
  return { api, c, frames, saved, focused, navigations, observers, notices, sent, decodes, document, tick, load, ready, snap };
}

test('a cold Canvas course waits for settled content before it changes the visible page or focus', async () => {
  const p = fixture(), focus = p.document.activeElement;
  p.api.reveal('12'); await flush();
  assert.equal(p.c.showing, ''); assert.equal(p.api.waiting(), '12');
  assert.equal(p.document.activeElement, focus);
  assert.equal(p.frames.get('12').el.style.visibility, 'hidden');
  assert.equal(p.frames.get('12').el.inert, true);
  p.load('12', '/courses/12'); p.tick(299);
  assert.equal(p.c.showing, '');
  p.tick(51);
  assert.equal(p.c.showing, '12'); assert.equal(p.api.waiting(), '');
  assert.equal(p.frames.get('12').el.style.visibility, '');
  assert.equal(p.frames.get('12').el.inert, false);
  assert.deepEqual(p.focused, ['gz-ctab:12']);
  assert.equal(p.saved.get('gz-ctabs-shown'), '12');
});

test('Canvas readiness waits through native loading indicators and scroll restoration', () => {
  for (const options of [{ busy: true }, { placing: true }]) {
    const p = fixture(); p.api.reveal('12'); p.load('12', '/courses/12', options); p.tick(351);
    assert.equal(p.frames.get('12').ready, false);
    assert.equal(p.c.showing, ''); assert.deepEqual(p.focused, []);
    const doc = p.frames.get('12').el.contentDocument;
    doc.body.busy = false; doc.documentElement.matches = () => false;
    p.tick(50);
    assert.equal(p.frames.get('12').ready, true);
  }
});

test('Canvas child mutations restart the settling window before revealing a course', () => {
  const p = fixture(); p.api.reveal('12'); const doc = p.load('12', '/courses/12');
  p.tick(250); p.observers.find((o) => o.target === doc.body).fn();
  p.tick(100); assert.equal(p.frames.get('12').ready, false);
  p.tick(250); assert.equal(p.frames.get('12').ready, true);
});

test('a superseded course load stays hidden when it becomes ready after the selected course', async () => {
  const p = fixture(); p.api.reveal('12'); p.api.reveal('13'); p.ready('13'); p.ready('12'); await flush();
  assert.equal(p.c.showing, '13');
  assert.equal(p.frames.get('12').el.inert, true);
  assert.equal(p.frames.get('12').el.style.visibility, 'hidden');
  assert.deepEqual(p.focused, ['gz-ctab:13']);
});

test('switching back to a ready Canvas course reuses its document, scroll and focused editor', () => {
  const p = fixture(); p.api.reveal('12'); const doc = p.ready('12');
  const editor = { value: 'Draft answer' }; doc.activeElement = editor; doc.scrollingElement.scrollTop = 730;
  p.api.reveal('13'); p.ready('13'); p.api.visit('12');
  assert.equal(p.c.showing, '12');
  assert.equal(p.frames.get('12').el.contentDocument, doc);
  assert.equal(doc.scrollingElement.scrollTop, 730); assert.equal(doc.activeElement, editor);
  assert.equal(p.navigations.filter((n) => n.name === 'gz-ctab:12').length, 1);
});

test('reselecting a pending Canvas course does not create or navigate a second frame', () => {
  const p = fixture(); p.api.reveal('12'); const first = p.frames.get('12');
  p.api.visit('12'); p.api.visit('12');
  assert.equal(p.frames.size, 1); assert.equal(p.frames.get('12'), first);
  assert.equal(p.navigations.length, 1); assert.equal(p.api.waiting(), '12');
  p.ready('12'); assert.equal(p.c.showing, '12');
});

test('Canvas scroll restoration retries a clamped position until content can hold it, then releases readiness', () => {
  let now = 1000, height = 100, top = 0;
  const timers = [], html = node('html');
  const scroller = { get scrollTop() { return top; }, set scrollTop(value) { top = Math.min(height, value); } };
  const scrollBack = vm.runInNewContext(part('  const scrollBack = ', '  // ---- closing, pinning, moving') + '\nscrollBack;', {
    location: { pathname: '/courses/12/pages/reading' }, ctx: { on: () => true, acted: () => 0 },
    html, Date: { now: () => now }, pageScroller: () => scroller, setTimeout: (fn) => timers.push(fn),
  });
  scrollBack(730);
  assert.equal(top, 100); assert.equal(html.hasAttribute('data-gz-placing'), true);
  const step = () => { now += 100; timers.shift()?.(); };
  step(); height = 1000; step(); assert.equal(top, 730);
  step(); step(); step(); step();
  assert.equal(html.hasAttribute('data-gz-placing'), false);
  assert.equal(timers.length, 0);
});

test('a Canvas user action stops delayed scroll restoration before it overwrites the user position', () => {
  let now = 1000, acted = 0;
  const timers = [], html = node('html'), scroller = { scrollTop: 0 };
  const scrollBack = vm.runInNewContext(part('  const scrollBack = ', '  // ---- closing, pinning, moving') + '\nscrollBack;', {
    location: { pathname: '/courses/12/pages/reading' }, ctx: { on: () => true, acted: () => acted },
    html, Date: { now: () => now }, pageScroller: () => scroller, setTimeout: (fn) => timers.push(fn),
  });
  scrollBack(730); assert.equal(scroller.scrollTop, 730);
  now += 100; acted = now; scroller.scrollTop = 280; timers.shift()();
  assert.equal(scroller.scrollTop, 280); assert.equal(html.hasAttribute('data-gz-placing'), false);
  assert.equal(timers.length, 0);
});

test('a cached Canvas picture decoding after readiness cannot cover the ready document', async () => {
  const p = fixture({ manualDecode: true }); p.c.snaps.set('12', p.snap('12'));
  p.api.reveal('12'); assert.equal(p.decodes.length, 1);
  p.ready('12'); p.decodes[0].resolve(); await flush();
  assert.equal(p.c.showing, '12'); assert.equal(p.c.pic, null);
  assert.equal(p.frames.get('12').el.style.visibility, '');
  assert.deepEqual(p.focused, ['gz-ctab:12']);
});

test('a cached Canvas picture decoding after a newer selection cannot steal the screen', async () => {
  const p = fixture({ manualDecode: true }); p.c.snaps.set('12', p.snap('12'));
  p.api.reveal('12'); p.api.reveal('13'); p.ready('13');
  p.decodes[0].resolve(); await flush();
  assert.equal(p.c.showing, '13'); assert.equal(p.c.pic, null);
  assert.equal(p.frames.get('12').el.inert, true);
  assert.deepEqual(p.focused, ['gz-ctab:13']);
});

test('a decoded Canvas picture is removed when its loading document becomes ready', async () => {
  const p = fixture({ manualDecode: true }); p.c.snaps.set('12', p.snap('12'));
  p.api.reveal('12'); p.decodes[0].resolve(); await flush();
  assert.equal(p.c.showing, '12'); assert.ok(p.c.pic?.isConnected);
  const picture = p.c.pic;
  assert.equal(p.frames.get('12').ready, false);
  assert.equal(p.frames.get('12').el.style.visibility, 'hidden');
  p.ready('12'); p.tick(301);
  assert.equal(p.c.pic, null); assert.equal(picture.isConnected, false);
  assert.equal(p.frames.get('12').el.style.visibility, '');
});

// Ready Canvas documents are never loaded in place: the equivalent stale-document guarantee is a separate next frame.
test('Canvas keeps the outgoing ready document separate from a hidden pending replacement', () => {
  const p = fixture(); p.api.reveal('12'); const old = p.ready('12'), first = p.frames.get('12');
  p.api.openAt('12', '/courses/12/grades'); p.tick(500);
  const pending = p.api.next.get('12');
  assert.equal(p.frames.get('12'), first); assert.equal(first.ready, true);
  assert.equal(first.el.contentDocument, old); assert.equal(pending.ready, false);
  assert.equal(pending.el.style.visibility, 'hidden'); assert.equal(pending.el.inert, true);
  p.ready('12', '/courses/12/grades', pending);
  assert.equal(p.frames.get('12'), pending); assert.equal(pending.ready, true);
  assert.ok(p.api.spare.get('12').includes(first));
});

test('dropping a pending Canvas course cancels its selection and disconnects its mutation observer', async () => {
  const p = fixture(); p.api.reveal('12'); const doc = p.load('12', '/courses/12');
  const observer = p.observers.find((o) => o.target === doc.body);
  p.api.drop('12'); p.tick(500); await flush();
  assert.equal(p.api.waiting(), ''); assert.equal(p.c.showing, '');
  assert.equal(p.frames.has('12'), false); assert.equal(observer.target, null);
  assert.deepEqual(p.focused, []);
});

// Unsaved work can now be left live in a kept page instead of refusing all navigation.
test('Canvas dirty course and page documents stay live with their scroll when another page opens', () => {
  for (const cid of ['12', 'page']) {
    const p = fixture();
    if (cid === 'page') p.api.openPage('/calendar'); else p.api.reveal(cid);
    const doc = p.ready(cid, cid === 'page' ? '/calendar' : '/courses/12'), first = p.frames.get(cid);
    first.dirty = true; doc.scrollingElement.scrollTop = 430;
    const url = cid === 'page' ? '/conversations' : '/courses/12/grades';
    if (cid === 'page') p.api.openPage(url); else p.api.openAt(cid, url);
    const pending = p.api.next.get(cid);
    assert.equal(p.frames.get(cid), first); assert.equal(doc.scrollingElement.scrollTop, 430);
    p.ready(cid, url, pending);
    assert.equal(p.frames.get(cid), pending); assert.ok(p.api.spare.get(cid).includes(first));
    assert.equal(first.el.contentDocument, doc); assert.equal(doc.scrollingElement.scrollTop, 430);
    assert.equal(first.el.style.visibility, 'hidden'); assert.equal(first.el.inert, true);
    p.tick(3001); assert.equal(first.el.style.display, 'none');
    assert.equal(p.notices.length, 0);
  }
});

test('restoring a Canvas course without a cached picture must wait before covering the top page', async () => {
  const p = fixture({ saved: new Map([['gz-ctabs-shown', '12']]) });
  p.api.start(); await flush();
  assert.ok(p.frames.has('12'), 'restore creates the saved course frame');
  assert.equal(p.frames.get('12').ready, false);
  assert.equal(p.c.showing, '', 'about:blank must not replace the native page during course restore');
  assert.equal(p.api.waiting(), '12');
  assert.equal(p.frames.get('12').el.style.visibility, 'hidden');
  assert.deepEqual(p.focused, []);
});

test('reload must restore a course frame even when the underlying top page has the same course ID', async () => {
  const stored = [{ cid: '12', path: '/courses/12/pages/reading', top: 730 }];
  const p = fixture({ nativePath: '/courses/12', stored, saved: new Map([['gz-ctabs-shown', '12']]) });
  p.api.start(); await flush();
  assert.ok(p.frames.has('12'), 'the visible reading frame differs from the underlying course home despite sharing its ID');
  assert.equal(p.frames.get('12').url, '/courses/12/pages/reading');
});

for (const cid of ['12', 'page']) test(`repeated ${cid === 'page' ? 'page' : 'course'} opens must not reload an identical Canvas destination`, () => {
  const outcomes = [];
  for (const ready of [false, true]) {
    const p = fixture(), url = cid === 'page' ? '/calendar?view=month' : '/courses/12/pages/reading?module_item_id=7';
    const open = () => cid === 'page' ? p.api.openPage(url) : p.api.openAt(cid, url);
    open(); const first = p.frames.get(cid);
    if (ready) {
      p.ready(cid, url).scrollingElement.scrollTop = 730;
      if (cid !== 'page') p.c.tabs.find((x) => x.cid === cid).top = 730;
    }
    open(); assert.equal(p.frames.get(cid), first, 'reuse the same frame');
    outcomes.push({ state: ready ? 'ready' : 'pending', loads: p.navigations.length, ready: first.ready,
      top: cid === 'page' ? first.el.contentDocument.scrollingElement?.scrollTop || 0 : p.c.tabs.find((x) => x.cid === cid).top });
  }
  assert.deepEqual(outcomes, [
    { state: 'pending', loads: 1, ready: false, top: 0 }, { state: 'ready', loads: 1, ready: true, top: 730 },
  ], 'identical pending destinations must not restart loading; ready destinations must retain readiness and scroll');
});

// No replacement is loaded in the shown iframe now: keep it visible and the next frame hidden until drawn.
test('navigating inside the shown Canvas frame keeps the old page visible until its replacement is drawn', () => {
  const p = fixture(); p.api.reveal('12'); const old = p.ready('12'), first = p.frames.get('12');
  p.api.openAt('12', '/courses/12/grades');
  const pending = p.api.next.get('12');
  p.load('12', '/courses/12/grades', { busy: true }, pending);
  assert.equal(p.frames.get('12'), first); assert.equal(first.el.contentDocument, old);
  assert.equal(first.el.style.visibility, ''); assert.equal(first.el.inert, false);
  assert.equal(pending.el.style.visibility, 'hidden'); assert.equal(pending.el.inert, true);
  p.tick(351); assert.equal(p.frames.get('12'), first, 'a loading indicator still prevents the swap');
  pending.el.contentDocument.body.busy = false; p.tick(50);
  assert.equal(p.frames.get('12'), pending);
  assert.equal(first.el.style.visibility, 'hidden'); assert.equal(first.el.inert, true);
});

test('an empty Canvas content shell must not become a ready course frame', () => {
  const p = fixture(); p.api.reveal('12'); const doc = p.load('12', '/courses/12', { empty: true }); p.tick(351);
  assert.equal(p.frames.get('12').ready, false, 'a visible but empty #content/#main is not rendered course content');
  assert.equal(p.c.showing, '');
  doc.content.textContent = 'Course reading'; p.tick(50);
  assert.equal(p.frames.get('12').ready, true, 'direct text also counts as rendered content');
  const first = p.frames.get('12');
  p.api.openAt('12', '/courses/12/grades'); const pending = p.api.next.get('12');
  const replacement = p.load('12', '/courses/12/grades', { empty: true }, pending); p.tick(351);
  assert.equal(p.frames.get('12'), first); assert.equal(pending.ready, false);
  assert.equal(pending.el.style.visibility, 'hidden'); assert.equal(pending.el.inert, true);
  replacement.content.childElementCount = 1; p.tick(50);
  assert.equal(p.frames.get('12'), pending); assert.equal(pending.ready, true);
});

test('restarting a Canvas readiness watch must remove the old document scroll listener', () => {
  const p = fixture(); p.api.reveal('12'); const doc = p.load('12', '/courses/12', { busy: true });
  assert.equal(doc.listeners.get('scroll').size, 1);
  p.api.watch('12', p.frames.get('12')); p.tick(50);
  assert.equal(p.observers.filter((o) => o.target === doc.body).length, 1, 'the old mutation observer is disconnected');
  assert.equal(doc.listeners.get('scroll').size, 1, 'superseding a watch must also detach its scroll callback');
  const replacement = p.load('12', '/courses/12', { busy: true });
  assert.equal(doc.listeners.get('scroll').size, 0, 'document replacement detaches the outgoing scroll callback');
  assert.equal(replacement.listeners.get('scroll').size, 1);
  replacement.body.busy = false; p.tick(351);
  assert.equal(replacement.listeners.get('scroll').size, 0, 'readiness also releases its listeners');
  assert.equal(p.observers.filter((o) => o.target).length, 0);
});

test('a storage metadata update must preserve the shown Canvas frame place and scroll', () => {
  const p = fixture(); p.api.reveal('12'); p.ready('12', '/courses/12/pages/reading');
  const live = p.frames.get('12');
  Object.assign(p.c.tabs.find((x) => x.cid === '12'), { path: '/courses/12/pages/reading', top: 730 });
  const incoming = p.c.tabs.map((x) => ({ ...x, ...(x.cid === '12' ? { path: '/courses/12', top: 0, pin: true } : {}) }));
  p.api.onStore({ key: { newValue: { tabs: incoming } } }, 'local');
  const tab = p.c.tabs.find((x) => x.cid === '12');
  assert.equal(p.frames.get('12'), live); assert.equal(tab.pin, true);
  assert.equal(tab.path, '/courses/12/pages/reading', 'pinning from another browser tab must not replace this live frame\'s place');
  assert.equal(tab.top, 730);
});

test('Canvas keeps course-root queries and fragments through landing and Navigation API Back and Forward', () => {
  const p = fixture(); p.api.openAt('12', '/courses/12'); p.ready('12');
  const first = p.frames.get('12'), url = '/courses/12?view=all#unit';
  p.api.openAt('12', url); const pending = p.api.next.get('12');
  p.ready('12', url, pending);
  assert.equal(p.frames.get('12'), pending, 'a course-root anchor still belongs to its course');
  assert.equal(p.api.turns.get('entry-2').url, url);
  assert.equal(p.c.tabs.find((x) => x.cid === '12').path, '/courses/12?view=all');
  p.c.navigation = { currentEntry: { key: 'entry-1' } }; p.api.onPop();
  assert.equal(p.frames.get('12'), first);
  p.c.navigation.currentEntry.key = 'entry-2'; p.api.onPop();
  assert.equal(p.frames.get('12'), pending, 'Forward reuses the live page with its anchor');
  assert.equal(pending.el.contentDocument.location.hash, '#unit');
  assert.equal(p.api.turns.size, 3, 'Back and Forward do not create entries');
});

test('a pending Canvas page redirected to another course retains its anchor and every outgoing live document', () => {
  const p = fixture(); p.api.openAt('12', '/courses/12'); const doc = p.ready('12'), first = p.frames.get('12');
  p.api.openAt('12', '/courses/12/modules/items/7'); const pending = p.api.next.get('12');
  const url = '/courses/13#unit'; p.ready('12', url, pending);
  assert.equal(p.frames.get('12'), first); assert.equal(first.el.contentDocument, doc);
  assert.equal(p.frames.get('13').url, url);
  assert.equal(p.api.turns.get('entry-2').url, url); assert.equal(p.api.turns.get('entry-2').cid, '13');
  p.ready('13', url); assert.equal(p.c.showing, '13');
  assert.equal(first.el.style.visibility, 'hidden'); assert.equal(first.el.inert, true);
});

test('Canvas frame pagehide must detach its observer from the surviving parent document', () => {
  const observers = [], parentRoot = {}, handlers = events(), document = events();
  const c = vm.createContext({ framed: '12', preview: false, onPress() {}, onPop() {}, onStore() {}, ctx: { site: 'canvas' }, on: true, showing: '', PAGE: 'page', frames: new Map(),
    parent: { document: { documentElement: parentRoot } }, navRoom() {}, bar: { place() {} },
    chrome: { runtime: { id: 'glaze' }, storage: { onChanged: { addListener() {}, removeListener() {} } } },
    document, location: { origin }, sessionStorage: { setItem() {} }, saveNow() {},
    onScroll() {}, onLeave() {}, onCourseLink() {}, onResize() {},
    addEventListener: handlers.addEventListener, removeEventListener: handlers.removeEventListener,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() { this.target = null; }
    },
  });
  vm.runInContext(part('  const keepPage = ', '  const onResize = ')
    + part('  let navWatch = ', '  // In a Canvas tab\'s frame')
    + part('  const listen = ', '  const start = ') + '\nlisten(true);', c);
  assert.equal(observers.length, 1); assert.equal(observers[0].target, parentRoot);
  handlers.dispatch('pagehide', { persisted: true });
  assert.equal(observers[0].target, null, 'the parent survives frame navigation and must not retain the outgoing frame closure');
  handlers.dispatch('pageshow', { persisted: true });
  assert.equal(observers.length, 2); assert.equal(observers[1].target, parentRoot);
  handlers.dispatch('pagehide', { persisted: false });
  assert.equal(observers[1].target, null);
});

test('a deferred Canvas landing cannot replace a newer course or underlying-page selection', () => {
  for (const destination of ['13', '']) {
    const p = fixture(); p.api.openAt('12', '/courses/12'); p.ready('12');
    p.api.openAt('13', '/courses/13'); p.ready('13');
    p.api.openAt('12', '/courses/12/grades');
    const pending = p.api.next.get('12');
    assert.equal(p.api.waiting(), '12');
    p.api.visit(destination || '13');
    if (!destination) p.api.openPage('/');
    const focused = p.document.activeElement;
    p.ready('12', '/courses/12/grades', pending);
    assert.equal(p.c.showing, destination, 'the last selection owns the screen');
    assert.equal(p.document.activeElement, focused, 'a stale landing must not steal focus');
    for (const frame of [pending, ...p.api.spare.get('12')]) {
      assert.equal(frame.el.style.visibility, 'hidden'); assert.equal(frame.el.inert, true);
    }
    assert.equal(p.api.turns.get(p.c.navigation.currentEntry.key).cid, destination, 'screen and current history entry agree');
  }
});

test('Back to an evicted Canvas page keeps another course visible until the destination is drawn', () => {
  const p = fixture(); p.api.openAt('12', '/courses/12'); p.ready('12');
  p.api.openAt('13', '/courses/13'); p.ready('13');
  const focused = p.document.activeElement;
  p.api.turns.set('back-entry', { cid: '12', url: '/courses/12/pages/evicted' });
  p.c.navigation = { currentEntry: { key: 'back-entry' } };
  p.api.onPop();
  const pending = p.api.next.get('12');
  assert.ok(pending);
  assert.equal(p.c.showing, '13', 'Back must not briefly expose the wrong retained page');
  assert.equal(p.frames.get('12').el.style.visibility, 'hidden');
  assert.equal(p.frames.get('12').el.inert, true);
  assert.equal(p.document.activeElement, focused);
  p.ready('12', '/courses/12/pages/evicted', pending);
  assert.equal(p.c.showing, '12'); assert.equal(p.frames.get('12'), pending);
  assert.equal(p.api.turns.size, 4, 'traversal creates no new history entry');
});

test('reselecting the visible Canvas course records cancellation of a pending history destination', () => {
  const p = fixture(); p.api.openAt('12', '/courses/12'); p.ready('12');
  p.api.openAt('13', '/courses/13'); p.ready('13');
  p.api.openAt('12', '/courses/12/grades');
  p.api.visit('13');
  assert.equal(p.c.showing, '13');
  assert.equal(p.api.turns.get(p.c.navigation.currentEntry.key).cid, '13', 'a click on the visible course supersedes the pending entry');
});

test('selecting a Canvas tab with a pending page keeps that destination in history and waits for it', () => {
  for (const visible of [true, false]) {
    const p = fixture(); p.api.openAt('12', '/courses/12'); p.ready('12');
    if (!visible) { p.api.openAt('13', '/courses/13'); p.ready('13'); }
    p.api.openAt('12', '/courses/12/grades'); const pending = p.api.next.get('12');
    p.api.visit('12');
    assert.equal(p.api.turns.get(p.c.navigation.currentEntry.key).url, '/courses/12/grades', 'the tab selects its pending destination, not the outgoing document');
    assert.equal(p.c.showing, visible ? '12' : '13');
    p.ready('12', '/courses/12/grades', pending);
    assert.equal(p.c.showing, '12'); assert.equal(p.frames.get('12'), pending);
  }
});
