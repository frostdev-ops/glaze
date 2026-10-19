const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const L = require('../lib/coursetabs.js');
const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://school.instructure.com';

function navigation({ site = 'canvas', framed = '', showing = '12' } = {}) {
  const calls = [];
  const bar = vm.runInNewContext(part('  const pageable = ', '  // A course page in its course')
    + part('  const bar = {', '  return { sync') + '\nbar;', {
    L, URL, PAGE: 'page', on: true, framed, showing, ctx: { site }, location: { origin },
    frames: new Map([['12', {}]]), here: () => '5',
    toTop: (op, m) => calls.push([op, m.url]),
    openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    show: (cid) => calls.push(['show', cid]), route: (url) => calls.push(['route', url]),
  });
  return { bar, calls };
}

test('scripted Canvas navigation leaves the page frame intact and asks its owner to open the course', () => {
  for (const [framed, href] of [['page', '/courses/12/grades'], ['12', '/courses/13/modules'], ['12', '/conversations']]) {
    const p = navigation({ framed });
    assert.equal(p.bar.open(href), true, `${framed}: the caller must not replace its own document`);
    assert.deepEqual(p.calls, [['open', href]]);
  }
  for (const [framed, href] of [['page', '/calendar'], ['12', '/courses/12/modules'], ['page', '/courses/12#unit'], ['12', '/logout'], ['12', '/api/v1/courses'], ['page', '/courses/12/files/8/download']]) {
    const p = navigation({ framed });
    assert.equal(p.bar.open(href), false, `${href} keeps native navigation in the frame`);
    assert.deepEqual(p.calls, []);
  }
  const ultra = navigation({ site: 'ultra', framed: '_12_1' });
  assert.equal(ultra.bar.open('/ultra/courses/_13_1/outline'), false, 'Ultra retains its existing frame navigation');
});

test('scripted course links preserve fragments and downloads instead of opening a loading course frame', () => {
  for (const href of ['/courses/12/pages/reading#part-2', '/courses/13/files/8/download?download_frd=1']) {
    const p = navigation();
    assert.equal(p.bar.open(href), true);
    assert.deepEqual(p.calls, [['show', ''], ['route', href]], href);
  }
});

test('the parent pet remains available over a ready Canvas page frame with the same account', () => {
  const doc = { body: {}, location: { origin, pathname: '/', search: '' } };
  const host = { hasAttribute: () => true };
  const el = { isConnected: true, parentElement: host, inert: false, style: {}, contentDocument: doc };
  const f = { el, ready: true, uid: '42', accountDoc: doc };
  const c = vm.createContext({ L, PAGE: 'page', on: true, signedOut: false, framed: '', preview: false,
    who: '42', showing: 'page', pic: null, host, location: { origin }, frames: new Map([['page', f]]),
    safePath: (path, search) => L.safe(path, search),
  });
  const petSurface = vm.runInContext(part('  const surface = ', '  let shooting = ') + '\npetSurface;', c);
  const surface = petSurface(`pet:${origin}/42`);
  assert.equal(surface?.doc, doc, 'the existing parent pet must not be hidden on the framed Dashboard');
  assert.equal(surface?.frame, el);
  assert.equal(petSurface(`pet:${origin}/43`), null);
  f.uid = '43'; assert.equal(petSurface(`pet:${origin}/42`), null);
  f.uid = '42'; f.accountDoc = {}; assert.equal(petSurface(`pet:${origin}/42`), null);
  f.accountDoc = doc; f.ready = false; assert.equal(petSurface(`pet:${origin}/42`), null);
  f.ready = true; el.inert = true; assert.equal(petSurface(`pet:${origin}/42`), null);
  el.inert = false; doc.location.origin = 'https://other.test'; assert.equal(petSurface(`pet:${origin}/42`), null);
  doc.location.origin = origin; doc.location.pathname = '/courses/12'; assert.equal(petSurface(`pet:${origin}/42`), null);
  c.showing = '12'; c.frames.set('12', f);
  assert.equal(petSurface(`pet:${origin}/42`)?.doc, doc, 'course surfaces still work');
  c.showing = '_12_1'; doc.location.pathname = '/ultra/courses/_12_1/outline'; c.frames.set('_12_1', f);
  assert.equal(petSurface(`pet:${origin}/42`)?.doc, doc, 'Ultra surfaces still work');
});

test('outside paths reject executable URLs, foreign URLs and encoded traversal without losing normal Canvas pages', () => {
  for (const path of ['/', '/calendar', '/conversations', '/courses', '/profile/settings', '/eportfolios/42/caf%C3%A9']) {
    assert.equal(L.outside(path, '?view=month'), `${path}?view=month`);
  }
  for (const path of ['javascript:alert(1)', 'https://other.test/calendar', '//other.test/calendar', '/\\other.test/calendar',
    '/calendar/../logout', '/calendar/./today', '/calendar//today', '/calendar/%2e%2e/logout', '/calendar/.%2E/logout',
    '/calendar/%2F%2Fevil.test', '/calendar/%5ctoday', '/calendar/%252e%252e/logout', '/courses/12', '/courses/12/grades']) {
    assert.equal(L.outside(path), null, path);
  }
  for (const framed of ['', 'page', '12']) {
    const p = navigation({ framed });
    for (const href of ['javascript:alert(1)', 'https://other.test/calendar', '//other.test/calendar']) assert.equal(p.bar.open(href), false, href);
    assert.deepEqual(p.calls, []);
  }
});

function pages({ saved = new Map(), shooting = null } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), focused = [], frames = new Map(), notices = [];
  const host = { prepend() {}, toggleAttribute() {} };
  const document = { activeElement: null, createElement: () => ({
    style: {}, contentDocument: { location: { origin: 'null', href: 'about:blank', pathname: 'blank' }, body: { childElementCount: 0 } },
    contentWindow: { location: { assign() {} }, postMessage() {} }, addEventListener() {},
    focus() { document.activeElement = this; focused.push(this.name); }, remove() {},
  }) };
  const c = vm.createContext({ L, PAGE: 'page', LIVE: 4, frames, host, document, shooting, showTurn: 0, showing: '', shownFrom: '',
    on: true, signedOut: false, framed: '', preview: false, closedCourse: '', tabs: [{ cid: '12' }], who: '42', loaded: true, last: undefined,
    ctx: { site: 'canvas', courseId: () => '5', me: async () => '42', scene() {} }, location: { origin, pathname: '/courses/5', search: '' },
    performance: { now: () => now }, MutationObserver: class { observe() {} disconnect() {} },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
    shown: () => true, loading: () => false, list: null, strip: null, snaps: new Map(),
    html: { toggleAttribute() {} }, sessionStorage: { getItem: (k) => saved.get(k), setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) },
    split: (url) => { const i = url.indexOf('?'); return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i + 1)]; },
    readPrefs: async () => {}, hello: async () => {}, pass() {}, key: () => 'key', local: (fn) => fn({ get: (k, cb) => cb({}) }),
    t: (s) => s, P: () => ({ place: true }), save() {}, draw() {}, lay() {}, unpicture() {}, picture() {}, clearSlow() {}, later() {},
    send: async () => null, say: (s) => notices.push(s),
  });
  const api = vm.runInContext(part('  const drop = ', '  // Canvas loads a whole page')
    + part('  const openPage = ', '  // Canvas: a frame still loading')
    + part("  let waiting = '', primed = '';", '  // A frame is shown once')
    + part('  const watch = ', '  // The picture over a frame')
    + part('  const show = async (cid) => {', '  // A tab: its frame')
    + part('  const onStore = ', '  const onResize = ')
    + part('  const start = ', "  let awayFrom = '';")
    + '\n({openPage,reveal,show,onStore,start,room,waiting: () => waiting});', c);
  const advance = (ms) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  };
  const load = (cid, path) => {
    frames.get(cid).el.contentDocument = { location: new URL(path, origin), body: {}, documentElement: { matches: () => false }, querySelector: () => ({}), addEventListener() {} };
    advance(50); advance(351);
  };
  return { api, c, frames, focused, saved, notices, advance, load };
}

test('a restored page frame waits for its document, then restores the path, focus and accessible title', async () => {
  const saved = new Map([['gz-ctabs-shown', 'page'], ['gz-ctabs-page', '/calendar?view=month']]);
  const p = pages({ saved }); p.api.start(); await new Promise(setImmediate);
  assert.equal(p.frames.get('page')?.url, '/calendar?view=month');
  assert.equal(p.api.waiting(), 'page'); assert.equal(p.c.showing, '');
  assert.deepEqual(p.focused, [], 'a pending frame must not take focus from the page');
  p.load('page', '/calendar?view=month');
  assert.equal(p.c.showing, 'page'); assert.equal(p.frames.get('page').el.inert, false);
  assert.equal(p.frames.get('page').el.title, 'Canvas');
  assert.deepEqual(p.focused, ['gz-ctab:page']);
  assert.equal(saved.get('gz-ctabs-shown'), 'page'); assert.equal(saved.get('gz-ctabs-page'), '/calendar?view=month');
});

test('a page becoming ready after another selection cannot replace the selected course', async () => {
  const p = pages(); p.api.openPage('/calendar');
  p.c.tabs.push({ cid: '13' }); p.api.reveal('13');
  p.load('13', '/courses/13');
  assert.equal(p.c.showing, '13');
  p.load('page', '/calendar');
  assert.equal(p.c.showing, '13'); assert.equal(p.frames.get('page').el.inert, true);
  assert.deepEqual(p.focused, ['gz-ctab:13']);
  await p.api.show('page'); assert.equal(p.saved.get('gz-ctabs-page'), '/calendar');
});

test('the page frame survives list changes and is outside the four-course frame limit', () => {
  const p = pages(); p.api.openPage('/calendar'); p.load('page', '/calendar');
  for (const cid of ['12', '13', '14', '15']) {
    p.c.tabs.push({ cid }); p.api.reveal(cid); p.load(cid, `/courses/${cid}`);
  }
  assert.equal(p.frames.size, 5); assert.ok(p.frames.has('page'));
  p.c.tabs.push({ cid: '16' }); p.api.reveal('16'); p.load('16', '/courses/16');
  assert.equal(p.frames.size, 5); assert.ok(p.frames.has('page')); assert.equal(p.frames.has('12'), false);
  for (const [cid, f] of p.frames) if (cid !== 'page') f.dirty = true;
  assert.equal(p.api.room(), false); assert.equal(p.frames.size, 5); assert.ok(p.frames.has('page'));
  p.api.onStore({ key: { newValue: { tabs: [{ cid: '16' }] } } }, 'local');
  assert.deepEqual([...p.frames.keys()], ['page', '16']);
});

test('a delayed restore cannot override a course selected while account storage was loading', async () => {
  for (const stored of ['page', '12']) for (const ready of [false, true]) {
    const saved = new Map([['gz-ctabs-shown', stored], ['gz-ctabs-page', '/calendar']]);
    const p = pages({ saved }); let finishRead;
    p.c.local = (fn) => fn({ get: (key, cb) => { finishRead = cb; } });
    p.api.start(); await new Promise(setImmediate);
    assert.equal(typeof finishRead, 'function');
    p.c.tabs.push({ cid: '13' }); p.api.reveal('13');
    if (ready) p.load('13', '/courses/13');
    finishRead({});
    assert.equal(p.c.showing, ready ? '13' : '');
    assert.equal(p.api.waiting(), ready ? '' : '13', 'the old page must not be queued over the new selection');
    assert.equal(p.frames.has(stored), false);
  }
});

test('a snapshot finishing after two frame switches cannot reveal the older page', async () => {
  let finishShot;
  const p = pages({ shooting: new Promise((r) => { finishShot = r; }) });
  p.api.openPage('/calendar'); p.load('page', '/calendar');
  p.c.tabs.push({ cid: '13' }); p.api.reveal('13'); p.load('13', '/courses/13');
  finishShot(null); await new Promise(setImmediate);
  assert.equal(p.c.showing, '13');
  assert.equal(p.frames.get('page').el.inert, true);
  assert.deepEqual(p.focused, ['gz-ctab:13']);
});

test('the page frame copies and clears navbar room without adding a polling loop', () => {
  const parentVars = new Map([['--gz-navbar-left', '96px'], ['--gz-navbar-top', '44px']]), frameVars = new Map();
  let reads = 0;
  const navRoom = vm.runInNewContext(part('  const navRoom = ', '  const listen = ') + '\nnavRoom;', {
    framed: 'page', ctx: { site: 'canvas' }, html: { style: { getPropertyValue: (k) => frameVars.get(k) || '', setProperty: (k, v) => frameVars.set(k, v), removeProperty: (k) => frameVars.delete(k) } },
    parent: { document: { documentElement: {} }, getComputedStyle: () => { reads++; return { getPropertyValue: (k) => parentVars.get(k) || '' }; } },
  });
  navRoom(); assert.deepEqual([...frameVars], [...parentVars]);
  parentVars.set('--gz-navbar-left', '0px'); parentVars.set('--gz-navbar-top', '72px');
  navRoom(); assert.deepEqual([...frameVars], [...parentVars]);
  parentVars.clear(); navRoom(); assert.equal(frameVars.size, 0); assert.equal(reads, 3);
});

test('page-frame passes retain outside pages and report a course navigation once', () => {
  const sent = [], moves = [];
  const c = vm.createContext({ on: true, framed: 'page', PAGE: 'page', preview: false, showing: '', loaded: true,
    last: '', lastPath: '/', awayFrom: '', location: { pathname: '/', search: '' }, here: () => '',
    observeView() {}, flag() {}, place() {}, draw() {}, lay() {}, moved: () => moves.push('moved'), toTop: (op, m) => sent.push([op, m.url]),
  });
  const pass = vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass;', c);
  pass(); c.location.pathname = '/calendar'; pass();
  assert.deepEqual(sent, []); assert.deepEqual(moves, ['moved']);
  c.location.pathname = '/courses/12'; c.here = () => '12'; pass(); pass();
  assert.deepEqual(sent, [['away', '/courses/12']]);
});

test('Canvas navigation messages require the visible owned frame and validate non-course URLs', () => {
  for (const from of ['page', '12']) {
    const own = {}, calls = [], f = { el: { contentWindow: own } }; let listener;
    const c = vm.createContext({ L, PAGE: 'page', ctx: { site: 'canvas' }, framed: '', preview: false, on: true, showing: from,
      location: { origin }, frames: new Map([[from, f]]), addEventListener: (event, fn) => { listener = fn; },
      split: (url) => { const i = url.indexOf('?'); return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i + 1)]; },
      pageable: (path) => !/^\/(?:login|logout|api)(?:\/|$)/.test(path),
      openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    });
    vm.runInContext(part("  if (!framed && !preview) addEventListener('message'", '  // In a tab\'s frame on Ultra'), c);
    const post = (op, url, source = own, site = origin) => listener({ source, origin: site, data: { gzCtab: op, url } });
    for (const op of ['open', 'away']) {
      post(op, '/courses/13', {}, origin); post(op, '/courses/13', own, 'https://other.test');
      for (const url of ['javascript:alert(1)', '//other.test/calendar', 'https://other.test/calendar']) post(op, url);
    }
    for (const url of ['/calendar/%2e%2e/logout', '/calendar/%252fother.test', '/calendar/%5cother.test', '/login', '/api/v1/courses']) post('open', url);
    assert.deepEqual(calls, []);
    c.showing = ''; post('open', '/courses/13'); assert.deepEqual(calls, []);
    c.showing = from; post('open', '/courses/13?view=1');
    assert.deepEqual(calls, [['course', '13', '/courses/13?view=1']]);
    if (from === '12') { post('away', '/calendar?view=month'); assert.equal(f.away, true); assert.deepEqual(calls.at(-1), ['page', '/calendar?view=month']); }
    else { post('away', '/courses/13'); assert.equal(f.away, true); assert.deepEqual(calls.at(-1), ['course', '13', '/courses/13']); }
  }
});

test('a page URL that redirects off-site cannot repeatedly reload its own redirect', () => {
  const srcs = [], shown = [], notices = [], handlers = {};
  const window = { location: { origin: 'null', href: 'about:blank' } };
  const el = { style: {}, contentWindow: window, addEventListener: (event, fn) => { handlers[event] = fn; },
    set src(url) { srcs.push(url); }, remove() { this.removed = true; },
  };
  const frames = new Map([['12', {}]]);
  const c = vm.createContext({ PAGE: 'page', frames, tabs: [], location: { origin }, document: { createElement: () => el },
    showing: 'page', waiting: '', showTurn: 0, host: { prepend() {} }, watch() {}, t: (s) => s,
    show: (cid) => shown.push(cid), wait() {}, say: (s) => notices.push(s),
  });
  vm.runInContext(part('  const drop = ', '  // Canvas loads a whole page')
    + part('  const open = ', '  // The picture over a frame') + "\nopen(PAGE, '/external_tools/9');", c);
  handlers.load(); assert.ok(frames.has('page'), 'the initial blank document is handled by the bounded load watcher');
  window.location = { get href() { throw new Error('cross-origin frame'); } };
  handlers.load(); handlers.load(); handlers.load();
  assert.deepEqual(srcs, [`${origin}/external_tools/9`], 'a redirect URL must not be assigned again after each foreign load');
  assert.equal(frames.has('page'), false); assert.ok(frames.has('12'));
  assert.equal(el.removed, true); assert.deepEqual(shown, ['']); assert.equal(notices.length, 1);
});

test('course frames still recover to their course root after an off-site load on Canvas and Ultra', () => {
  for (const cid of ['12', '_12_1']) {
    const srcs = [], frames = new Map(); let load;
    const el = { style: {}, contentWindow: { location: { origin: 'https://other.test' } },
      addEventListener: (event, fn) => { load = fn; }, set src(url) { srcs.push(url); },
    };
    const open = vm.runInNewContext(part('  const open = ', '  // The picture over a frame') + '\nopen;', {
      L, PAGE: 'page', tabs: [{ cid }], location: { origin }, document: { createElement: () => el }, frames,
      showing: cid, waiting: '', host: { prepend() {} }, watch() {}, say() {}, t: (s) => s,
    });
    open(cid, L.homeOf(cid) + '?view=1'); load();
    assert.deepEqual(srcs, [origin + L.homeOf(cid) + '?view=1', origin + L.homeOf(cid)]);
    assert.ok(frames.has(cid));
  }
});

test('a malformed saved page cannot create a restored iframe', async () => {
  for (const url of ['javascript:alert(1)', '//other.test/calendar', 'https://other.test/calendar', '/calendar/%2e%2e/logout']) {
    const saved = new Map([['gz-ctabs-shown', 'page'], ['gz-ctabs-page', url]]);
    const p = pages({ saved }); p.api.start(); await new Promise(setImmediate);
    assert.equal(p.frames.size, 0, url); assert.equal(p.api.waiting(), '');
  }
});
