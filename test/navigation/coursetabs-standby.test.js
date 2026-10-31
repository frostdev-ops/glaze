// Course tabs ahead of time on Ultra (navigation/page/coursetabs.js, tabs.ahead): a hidden standby Ultra booted at idle
// becomes the frame of the next course tab picked with no live frame, routed in place instead of booted afresh; a press or
// a resting pointer on a course's tab starts its frame before the click. The page itself: checks/navigation/ultra-standby-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const source = read('navigation/page/coursetabs.js');
const D = require(path.join(root, 'content/defaults.js'));
const L = require(path.join(root, 'navigation/coursetabs.js'));
const part = (a, b) => {
  const i = source.indexOf(a), j = source.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `${a} … ${b}`);
  return source.slice(i, j);
};
const origin = 'https://bb.school.test';
const SECTION = () => part('  const frameEl = ', '  // The stand-in over a frame');

// A standby whose Glaze has said it is loaded and who is signed in, on Ultra's light page.
const standbyOf = (over = {}) => {
  const doc = { body: {}, location: { origin, pathname: '/ultra/profile', search: '' }, querySelector: () => null, querySelectorAll: () => [] };
  const posted = [];
  const win = { name: 'gz-ctab:standby', postMessage: (m, o) => posted.push([structuredClone(m), o]) }; // (as posted: a copy)
  const attrs = new Set(['data-ready']);
  const el = { name: 'gz-ctab:standby', title: '', isConnected: true, contentDocument: doc, contentWindow: win, posted, removed: 0,
    removeAttribute: (k) => attrs.delete(k), toggleAttribute: (k, v) => (v ? attrs.add(k) : attrs.delete(k)), hasAttribute: (k) => attrs.has(k),
    remove() { this.removed++; this.isConnected = false; }, addEventListener() {} };
  return { el, doc, win, s: { el, loaded: doc, uid: '_42_1', accountDoc: doc, timer: 0, ...over } };
};
// The section run alone, with the page's state it reads.
const run = (over = {}) => {
  const timers = [], made = [], did = [];
  let now = 1000;
  const c = vm.createContext({
    ctx: { site: 'ultra', courseId: () => '_1_1' }, on: true, preview: false, signedOut: false, framed: '', who: '_42_1', loaded: true,
    prefs: { ahead: true }, P: () => c.prefs, L, t: (s) => s, tabs: [{ cid: '_1_1', name: 'One' }, { cid: '_2_1', name: 'Two' }, { cid: '_3_1', name: 'Three' }],
    frames: new Map(), PAGE: 'page', LIVE: 4, showing: '', pic: null, drag: null, location: { origin }, Date, Element: class {},
    performance: { now: () => now }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    requestIdleCallback: (fn) => { timers.push({ fn, idle: true }); return timers.length; },
    document: { visibilityState: 'visible', body: {}, createElement: () => { const el = { style: {}, addEventListener() {} }; made.push(el); return el; } },
    host: { prepend: (el) => did.push(['prepend', el.name]) }, hostIn() {}, loading: () => false, shown: (e) => !!e,
    guardFrame: (cid) => did.push(['guard', cid]), watch: (cid) => did.push(['watch', cid]), load: (cid, f, url) => did.push(['load', cid, url]),
    toTop: (op, m) => did.push(['toTop', op, structuredClone(m)]), open: (cid) => did.push(['open', cid]), send: () => Promise.resolve(null), revoke: () => did.push(['revoke']),
    ...over,
  });
  const api = vm.runInContext(part('  const acts = ', '  // A kept page') + SECTION() + `
;({ frameEl, ahead, standbyLater, bootStandby, usable, adopt, adopting, warmTab, pointed, onPoint, onAhead, adoptHere,
  get standby() { return standby; }, set standby(v) { standby = v; }, get miss() { return standbyMiss; } })`, c);
  return { c, api, timers, made, did, tick: (ms) => { now += ms; }, step: () => timers.shift()?.fn() };
};

test('on by default, one switch in the course tabs section, said in every language', () => {
  assert.deepEqual(L.SPEC.ahead, [true, 'bool']);
  assert.equal(D.GZ_SANITIZE({}).tabs.ahead, true);
  assert.equal(D.GZ_SANITIZE({ tabs: { ahead: false } }).tabs.ahead, false);
  const html = read('options.html');
  const section = html.slice(html.indexOf('<section id="tabs"'), html.indexOf('</section>', html.indexOf('<section id="tabs"')));
  assert.match(section, /<input type="checkbox" data-key="tabs\.ahead"[^>]*><span[^>]*>Open course tabs ahead of time<\/span>/);
  for (const f of fs.readdirSync(path.join(root, 'i18n'))) assert.match(read(`i18n/${f}`), /"Open course tabs ahead of time": "[^"]+"/, f);
  assert.doesNotMatch(html, /never loads a course in the background/, 'the privacy note no longer says nothing loads ahead');
});

test('a frame named gz-ctab:standby is a course tab\'s frame to content.js, waiting for its course', () => {
  const line = read('content/content.js').match(/const tabFrame = [^\n]+/)[0];
  const tabFrame = (name) => vm.runInNewContext(`${line}\ntabFrame;`, { window: { top: {}, name } });
  assert.equal(tabFrame('gz-ctab:standby'), 'standby');
  assert.equal(tabFrame('gz-ctab:_2_1'), '_2_1');
  assert.equal(tabFrame('gz-ctab:standby2'), '');
  assert.equal(tabFrame('gz-ctab:'), '');
});

test('picked with no live frame, a course takes the standby as its frame: named for it and routed in place by its own Glaze', () => {
  const p = run();
  const { el, win, s } = standbyOf();
  p.api.standby = s;
  const f = p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1', name: 'Two' });
  assert.ok(f && f.el === el, 'the same iframe, its Ultra already running');
  assert.equal(p.c.frames.get('_2_1'), f, 'a live frame of its course, counted in LIVE');
  assert.equal(p.api.standby, null, 'no longer the standby');
  assert.equal(el.name, 'gz-ctab:_2_1');
  assert.equal(win.name, 'gz-ctab:_2_1', 'a later load of this frame boots as the course\'s');
  assert.equal(el.title, 'Two');
  assert.equal(el.hasAttribute('data-ready'), false);
  assert.deepEqual([f.url, f.ready, f.dirty, f.uid, f.accountDoc], ['/ultra/courses/_2_1/outline', false, false, '_42_1', s.accountDoc], 'its account and document carried over');
  assert.deepEqual(el.posted, [[{ gzCtab: 'adopt', cid: '_2_1', url: '/ultra/courses/_2_1/outline' }, origin]]);
  assert.deepEqual(p.did.filter(([k]) => k === 'guard' || k === 'watch'), [['guard', '_2_1'], ['watch', '_2_1']], 'guarded and watched as any frame');
  assert.equal(el.removed, 0);
});

test('a standby that isn\'t ready, is another account\'s or has left its light page is let go, and the course loads afresh', () => {
  for (const [why, over, change] of [['no Glaze yet', { loaded: null }], ['another account', { uid: '_7_1' }], ['account unknown', { accountDoc: null }],
    ['gone into a course', {}, (d) => { d.location.pathname = '/ultra/courses/_3_1/outline'; }], ['off Ultra', {}, (d) => { d.location.pathname = '/webapps/login/'; }],
    ['detached', {}, (d, el) => { el.isConnected = false; }], ['switched off', {}, (d, el, p) => { p.c.prefs = { ahead: false }; }]]) {
    const p = run();
    const { el, doc, s } = standbyOf(over);
    change?.(doc, el, p);
    p.api.standby = s;
    assert.equal(p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' }), null, why);
    assert.equal(p.api.standby, null, why);
    assert.equal(p.c.frames.size, 0, why);
    assert.equal(el.posted.length, 0, why);
    assert.ok(el.removed >= 1 || !el.isConnected, why);
  }
  const p = run();
  assert.equal(p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' }), null, 'no standby: the cold load');
  const q = run(); q.api.standby = standbyOf().s;
  assert.equal(q.api.adopt('_2_1', '/ultra/courses/_3_1/outline', { cid: '_2_1' }), null, 'never routed to another course\'s page');
});

test('open() takes the standby when there is one, and otherwise makes a frame that loads the course', () => {
  const cold = [];
  const runOpen = (standby) => {
    const p = run({ host: { prepend: (el) => cold.push(el.src) } });
    const open = vm.runInContext(part('  const open = ', '  const guardFrame = ') + '\nopen;', p.c);
    if (standby) p.api.standby = standby;
    return { p, f: open('_2_1') };
  };
  const { el, s } = standbyOf();
  const a = runOpen(s);
  assert.equal(a.f.el, el);
  assert.deepEqual(cold, []);
  const b = runOpen(null);
  assert.deepEqual(cold, [`${origin}/ultra/courses/_2_1/outline`], 'today\'s cold load');
  assert.equal(b.f.el.name, 'gz-ctab:_2_1');
});

test('an adopted frame is watched by state: no answer, or no course drawn, in time loads the course afresh in it', () => {
  const adopted = () => {
    const p = run();
    const { doc, s } = standbyOf();
    p.api.standby = s;
    const f = p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' });
    p.timers.length = 0; p.api.adopting('_2_1', f);
    return { p, f, doc, loads: () => p.did.filter(([k]) => k === 'load') };
  };
  // Its Glaze never answers.
  let x = adopted();
  for (let i = 0; i < 39; i++) { x.p.tick(50); x.p.step(); }
  assert.deepEqual(x.loads(), [], 'still waiting for the answer');
  x.p.tick(100); x.p.step();
  assert.deepEqual(x.loads(), [['load', '_2_1', '/ultra/courses/_2_1/outline']]);
  assert.equal(x.p.timers.length, 0, 'the watch ends');
  // It answers that it couldn't route.
  x = adopted(); x.f.adopting.failed = true; x.p.tick(50); x.p.step();
  assert.equal(x.loads().length, 1);
  // It answers, but Ultra never draws the course.
  x = adopted(); x.f.adopting.ok = true; x.doc.location.pathname = '/ultra/courses/_2_1/outline';
  for (let i = 0; i < 99; i++) { x.p.tick(50); x.p.step(); }
  assert.equal(x.loads().length, 0, 'answered: the route has longer');
  x.p.tick(100); x.p.step();
  assert.equal(x.loads().length, 1);
  // It answers and Ultra draws the course: nothing more to do.
  x = adopted(); x.f.adopting.ok = true; x.doc.location.pathname = '/ultra/courses/_2_1/outline'; x.doc.querySelector = (q) => (q === '.bb-course-navigation' ? {} : null);
  x.p.tick(50); x.p.step();
  assert.equal(x.f.adopting, null);
  assert.equal(x.loads().length, 0);
  assert.equal(x.p.timers.length, 0);
  // Typed into while waiting: never reloaded.
  x = adopted(); x.f.dirty = true; x.p.tick(5000); x.p.step();
  assert.equal(x.loads().length, 0);
  // Another document came (a load of its own): watch's alone.
  x = adopted(); x.f.el.contentDocument = { location: { pathname: '/ultra/courses/_2_1/outline' } }; x.p.tick(5000); x.p.step();
  assert.equal(x.loads().length, 0);
  // Closed meanwhile.
  x = adopted(); x.p.c.frames.delete('_2_1'); x.p.tick(5000); x.p.step();
  assert.equal(x.loads().length, 0);
});

test('in the standby, its Glaze becomes the course\'s frame, then routes there in place of the standby\'s page in history', () => {
  const routed = [], events = [];
  const p = run({ framed: 'standby', awayFrom: '/ultra/profile', last: '', lastPath: '/ultra/profile', restored: false, window: { name: 'gz-ctab:standby' },
    history: { replaceState: (s, t, u) => routed.push([s, u]), pushState: () => routed.push('push') }, dispatchEvent: (e) => events.push(e.type),
    PopStateEvent: class { constructor(type, o) { this.type = type; this.state = o?.state; } }, pass: () => events.push('pass') });
  p.api.adoptHere('_2_1', '/ultra/courses/_2_1/outline?x=1');
  assert.equal(p.c.framed, '_2_1');
  assert.equal(p.c.window.name, 'gz-ctab:_2_1');
  assert.deepEqual(routed, [[null, `${origin}/ultra/courses/_2_1/outline?x=1`]], 'absolute: Ultra\'s <base href> is its CDN; no new history entry');
  assert.deepEqual(events, ['popstate', 'pass']);
  assert.deepEqual([p.c.awayFrom, p.c.last, p.c.lastPath, p.c.restored], ['', undefined, '', false], 'its course\'s state starts as a new frame\'s');
  assert.deepEqual(p.did.filter(([k]) => k === 'toTop'), [['toTop', 'adopted', { cid: '_2_1', ok: true }]]);
  p.api.adoptHere('_3_1', '/ultra/courses/_3_1/outline');
  assert.equal(p.c.framed, '_2_1', 'only once: a course\'s frame stays that course\'s');
  assert.equal(routed.length, 1);
  for (const [cid, url] of [['_2_1', '/ultra/courses/_3_1/outline'], ['x', '/ultra/courses/x/outline'], ['_2_1', 'https://evil.test/ultra/courses/_2_1/outline'], ['_2_1', 42]]) {
    const q = run({ framed: 'standby', history: { replaceState: () => routed.push('bad') }, dispatchEvent() {}, PopStateEvent: class {}, pass() {}, window: {} });
    q.api.adoptHere(cid, url);
    assert.equal(q.c.framed, 'standby', String(url));
    assert.deepEqual(q.did.filter(([k]) => k === 'toTop'), [['toTop', 'adopted', { cid, ok: false }]], String(url));
  }
  assert.equal(routed.length, 1);
});

test('adoption restores a remembered scroll only after the destination view arrives', () => {
  const url = '/ultra/courses/_2_1/document/_8_1', scrolls = [];
  const p = run({ framed: 'standby', restored: false, under: '', awayFrom: '', lastPath: '/ultra/profile', last: '',
    location: { origin, pathname: '/ultra/profile', search: '' },
    tabs: [{ cid: '_2_1', path: url, top: 430 }], prefs: { ahead: true, place: true }, nativeReady: false,
    here: () => '_2_1', observeView() {}, atView: () => p.c.nativeReady, notePlace() {}, visitTab() {},
    flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved() {}, scrollBack: (top) => scrolls.push(top),
    window: {}, history: { replaceState: () => { p.c.location.pathname = url; } }, dispatchEvent() {}, PopStateEvent: class {} });
  const pass = vm.runInContext(part('  const pass = ', '  let under = ') + '\npass;', p.c);
  p.api.adoptHere('_2_1', url);
  assert.equal(p.c.restored, false, 'the profile or an empty destination cannot consume restoration');
  assert.deepEqual(scrolls, []);
  p.c.nativeReady = true;
  pass();
  assert.equal(p.c.restored, true);
  assert.deepEqual(scrolls, [430], 'the destination gets its saved scroll once it can hold it');
  pass();
  assert.deepEqual(scrolls, [430], 'restoration runs once');
});

test('the page hears the standby\'s Glaze (loaded, signed in) and the adopted frame\'s answer; nothing from elsewhere', () => {
  const p = run();
  const { el, win, doc, s } = standbyOf({ loaded: null, uid: '', accountDoc: null });
  p.api.standby = s;
  const msg = (data, source = win, from = origin) => p.api.onAhead({ data, source, origin: from });
  msg({ gzCtab: 'loaded' }, {}); msg({ gzCtab: 'loaded' }, win, 'https://other.test');
  assert.equal(s.loaded, null);
  msg({ gzCtab: 'loaded' });
  assert.equal(s.loaded, doc);
  assert.deepEqual(el.posted, [[{ gzCtab: 'visible', on: false }, origin]], 'hidden: its Glaze rests as a hidden frame\'s');
  assert.equal(el.hasAttribute('data-ready'), false);
  msg({ gzCtab: 'account', uid: '_42_1' });
  assert.deepEqual([s.uid, s.accountDoc], ['_42_1', doc]);
  assert.equal(el.hasAttribute('data-ready'), true, 'ready to be adopted');
  msg({ gzCtab: 'account', uid: '_7_1' });
  assert.deepEqual(p.did.filter(([k]) => k === 'revoke'), [['revoke']], 'another account signed in there: as from any frame');
  // The adopted frame's answer, and an Ultra press in the frame on screen.
  const q = run();
  const t = standbyOf();
  q.api.standby = t.s;
  const f = q.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' });
  q.api.onAhead({ data: { gzCtab: 'adopted', cid: '_3_1', ok: true }, source: t.win, origin });
  assert.equal(f.adopting.ok, false, 'an answer for another course isn\'t this one\'s');
  q.api.onAhead({ data: { gzCtab: 'adopted', cid: '_2_1', ok: true }, source: t.win, origin });
  assert.equal(f.adopting.ok, true);
  q.c.showing = '_2_1';
  q.api.onAhead({ data: { gzCtab: 'warm', cid: '_3_1' }, source: t.win, origin });
  assert.deepEqual(q.did.filter(([k]) => k === 'open'), [['open', '_3_1']]);
});

test('a press or a resting pointer on a course\'s tab starts its frame; never a live one, this page\'s, the one shown, or past LIVE', () => {
  const p = run();
  p.api.warmTab('_2_1');
  assert.deepEqual(p.did.filter(([k]) => k === 'open'), [['open', '_2_1']]);
  for (const [why, over] of [['no tab', { tabs: [] }], ['this page\'s course', { ctx: { site: 'ultra', courseId: () => '_2_1' } }], ['on screen', { showing: '_2_1' }],
    ['live', { frames: new Map([['_2_1', {}]]) }], ['LIVE frames already', { frames: new Map([['_4_1', {}], ['_5_1', {}], ['_6_1', {}], ['_7_1', {}]]) }],
    ['switched off', { prefs: { ahead: false } }], ['Canvas', { ctx: { site: 'canvas', courseId: () => '' } }], ['signed out', { who: null }]]) {
    const q = run(over);
    q.api.warmTab('_2_1');
    assert.deepEqual(q.did.filter(([k]) => k === 'open'), [], why);
  }
  const r = run({ framed: '_2_1' });
  r.api.warmTab('_3_1'); r.api.warmTab('_2_1');
  assert.deepEqual(r.did.filter(([k]) => k === 'toTop'), [['toTop', 'warm', { cid: '_3_1' }]], 'from a frame\'s strip: through the page around it');
  const st = run({ framed: 'standby' });
  st.api.warmTab('_3_1');
  assert.deepEqual(st.did, [], 'the standby itself has no tabs to warm');
});

test('warming never opens a remembered assessment attempt or tool launch before a click', () => {
  for (const tail of ['assessment/_8_1/attempt', 'assessment/_8_1/attempt/create', 'assessment/_8_1/attempt/_9_1',
    'outline/assessment/_8_1/attempt/create?courseId=_2_1', 'outline/lti/launchFrame/_8_1', 'submissions/_8_1']) {
    const p = run({ tabs: [{ cid: '_2_1', path: `/ultra/courses/_2_1/${tail}` }] });
    p.api.warmTab('_2_1');
    assert.deepEqual(p.did.filter(([k]) => k === 'open'), [], tail);
  }
  for (const tail of ['outline', 'document/_8_1', 'assessment/_8_1/overview']) {
    const p = run({ tabs: [{ cid: '_2_1', path: `/ultra/courses/_2_1/${tail}` }] });
    p.api.warmTab('_2_1');
    assert.deepEqual(p.did.filter(([k]) => k === 'open'), [['open', '_2_1']], tail);
  }
  const p = run({ prefs: { place: false }, tabs: [{ cid: '_2_1', path: '/ultra/courses/_2_1/assessment/_8_1/attempt/create' }] });
  p.api.warmTab('_2_1');
  assert.deepEqual(p.did.filter(([k]) => k === 'open'), [['open', '_2_1']], 'without remembered places the outline can warm');
});

test('a clicked attempt or tool launch loads cold so adoption cannot replay it on a route timeout', () => {
  for (const tail of ['assessment/_8_1/attempt/create', 'outline/lti/launchFrame/_8_1', 'submissions/_8_1']) {
    const url = `/ultra/courses/_2_1/${tail}`, p = run();
    const { s, el } = standbyOf();
    p.api.standby = s;
    assert.equal(p.api.adopt('_2_1', url, { cid: '_2_1' }), null, tail);
    assert.equal(el.posted.length, 0, 'no in-place action followed by a possible automatic cold retry');
  }
});

test('only a course tab\'s own button warms: the strip\'s tab or Glaze\'s bar\'s, never their pin or close', () => {
  class El {
    constructor(cls, data = {}, parent = null) { this.cls = cls; this.dataset = data; this.parent = parent; }
    matches(q) { return q.split(',').map((x) => x.trim().slice(1)).includes(this.cls); }
    get classList() { return { contains: (c) => c === this.cls }; }
    closest(q) { for (let e = this; e; e = e.parent) if (q === '#gz-ctabs' ? e.cls === 'strip' : e.matches(q)) return e; return null; }
  }
  const p = run({ Element: El });
  const strip = new El('strip'), tab = new El('gz-ctab', { courseId: '_2_1' }, strip), x = new El('gz-ctab-x', {}, tab), name = new El('gz-ctab-name', {}, tab);
  const path = (n) => { const a = []; for (let e = n; e; e = e.parent) a.push(e); return { composedPath: () => a }; };
  assert.equal(p.api.pointed(path(name)), '_2_1');
  assert.equal(p.api.pointed(path(x)), '');
  const go = new El('ctab-go', { act: 'tab', cid: '_3_1' }), close = new El('ctab-do', { act: 'tab-close', cid: '_3_1' });
  assert.equal(p.api.pointed(path(go)), '_3_1');
  assert.equal(p.api.pointed(path(close)), '');
  assert.equal(p.api.pointed(path(new El('gz-ctab', { courseId: '_2_1' }))), '', 'a tab outside the strip is not one');
  // About 150 ms of rest, or a press.
  const ev = (type, n, more = {}) => ({ type, isTrusted: true, pointerType: 'mouse', button: 0, ...path(n), ...more });
  p.api.onPoint(ev('pointerover', name));
  assert.deepEqual(p.timers.map((t) => t.ms), [150]);
  p.api.onPoint(ev('pointerover', tab));
  assert.equal(p.timers.length, 1, 'moving within the tab keeps its wait');
  p.step();
  assert.deepEqual(p.did.filter(([k]) => k === 'open'), [['open', '_2_1']]);
  const q = run({ Element: El });
  q.api.onPoint(ev('pointerover', name)); q.api.onPoint(ev('pointerover', strip)); q.step();
  assert.deepEqual(q.did.filter(([k]) => k === 'open'), [], 'passing over it is no intent');
  q.api.onPoint(ev('pointerdown', name, { pointerType: 'touch' }));
  q.api.onPoint(ev('pointerdown', name, { isTrusted: false }));
  q.api.onPoint(ev('pointerdown', name, { button: 2 }));
  assert.deepEqual(q.did.filter(([k]) => k === 'open'), [], 'a touch (maybe a scroll), a script\'s press, another button');
  q.api.onPoint(ev('pointerdown', name));
  assert.deepEqual(q.did.filter(([k]) => k === 'open'), [['open', '_2_1']]);
  const r = run({ Element: El, framed: '_1_1' });
  r.api.onPoint(ev('pointerover', name)); r.api.standbyLater(); r.step();
  assert.deepEqual(r.did.filter(([k]) => k === 'toTop'), [['toTop', 'warm', { cid: '_2_1' }]], 'a frame sync preserves its hover intent');
});

test('the standby boots at idle once the page has settled, only while a tab could use it, and goes when switched off', () => {
  const p = run();
  p.api.standbyLater();
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, 2500);
  p.api.standbyLater();
  assert.equal(p.timers.length, 1, 'one wait at a time');
  p.step(); assert.equal(p.timers[0].idle, true, 'then at idle');
  p.step();
  assert.ok(p.api.standby, 'booted');
  assert.equal(p.made.length, 1);
  assert.deepEqual([p.made[0].name, p.made[0].src, p.made[0].inert, p.made[0].style.visibility], ['gz-ctab:standby', `${origin}/ultra/profile`, true, 'hidden']);
  assert.deepEqual(p.did.filter(([k]) => k === 'prepend'), [['prepend', 'gz-ctab:standby']]);
  // Unsettled: it waits.
  const q = run({ loading: () => true });
  q.api.standbyLater(); q.step(); q.step();
  assert.equal(q.api.standby, null);
  assert.equal(q.timers.length, 1, 'tried again later');
  const r = run({ frames: new Map([['_2_1', { ready: false }]]) });
  r.api.standbyLater(); r.step(); r.step();
  assert.equal(r.api.standby, null, 'a frame still loading comes first');
  // Of no use: every other tab is live, or none.
  for (const over of [{ tabs: [{ cid: '_1_1' }] }, { frames: new Map([['_2_1', { ready: true }], ['_3_1', { ready: true }]]) }, { framed: '_2_1' }, { prefs: { ahead: false } }, { ctx: { site: 'canvas', courseId: () => '' } }, { loaded: false }]) {
    const s = run(over); s.api.standbyLater();
    assert.equal(s.timers.length, 0, JSON.stringify(Object.keys(over)));
  }
  // Switched off: the standby goes.
  const { el, s } = standbyOf();
  p.api.standby = s; p.c.prefs = { ahead: false };
  p.api.standbyLater();
  assert.equal(p.api.standby, null);
  assert.equal(el.removed, 1);
});

test('disabling course tabs releases the standby document and cancels pending preloads', () => {
  const cancelled = [];
  const p = run({
    requestIdleCallback: () => 77, cancelIdleCallback: (id) => cancelled.push(id), clearTimeout: (id) => cancelled.push(id),
    nudge() {}, html: { removeAttribute() {} }, keepClear() {}, measureRow() {}, listen() {}, capTimer: 0, sayTimer: 0,
    saveNow() {}, strip: null, aside: null, sizes: null, sized: [], lastBar: null, unpicture() {}, clearSlow() {},
    sessionStorage: { removeItem() {} }, snaps: new Map(), ctx: { site: 'ultra', courseId: () => '_1_1', scene() {} },
    host: { remove() {} }, gone: false,
  });
  p.api.standbyLater(); p.step(); // waiting for idle
  const { s, el } = standbyOf({ timer: 78 });
  p.api.standby = s;
  const sync = vm.runInContext(part('  const sync = ', '  const revoke = ') + '\nsync;', p.c);
  sync(false);
  assert.equal(p.api.standby, null, 'no reference retains the detached Ultra document');
  assert.equal(el.removed, 1);
  assert.ok(cancelled.includes(78), 'the standby timeout is cancelled');
  assert.ok(cancelled.includes(77), 'the pending idle preload is cancelled');
});

test('the page hooks: listeners on Ultra only, a sync schedules the standby, and the bar\'s warm reaches Ultra', () => {
  const listen = part('  const listen = ', '  const start = ');
  assert.ok(listen.includes("if (ctx.site !== 'canvas') { for (const t of ['pointerdown', 'pointerover', 'pointerout']) document[f](t, onPoint, { capture: true, passive: true }); globalThis[f]('message', onAhead); }"));
  assert.match(part('  const sync = (want) => {', '  const revoke = '), /pass\(\);\s*standbyLater\(\);\s*\};\s*$/);
  const warmed = [];
  const bar = vm.runInNewContext(part('  const bar = {', '  return { sync') + '\nbar;', { on: true, ctx: { site: 'ultra' }, location: { origin }, L, URL, warm: () => warmed.push('canvas'), warmTab: (cid) => warmed.push(cid) });
  bar.warm(`${origin}/ultra/courses/_2_1/outline`); bar.warm(`${origin}/ultra/stream`); bar.warm('https://other.test/ultra/courses/_3_1/outline');
  assert.deepEqual(warmed, ['_2_1']);
});

test('picked and on screen, an adopted standby stays hidden on its own page until routed (or loading afresh), then shows as any frame', () => {
  for (const [why, setup, shown] of [['still on its page', () => {}, 'hidden'],
    ['routed', (x) => { x.f.adopting.ok = true; x.doc.location.pathname = '/ultra/courses/_2_1/outline'; x.doc.querySelector = (q) => (q === '.routed-page' ? {} : null); }, ''],
    ['loading afresh', (x) => { x.f.adopting.failed = true; }, ''], ['under its stand-in', (x) => { x.f.adopting.failed = true; x.p.c.pic = {}; }, 'hidden']]) {
    const p = run({ showing: '_2_1' });
    const { doc, s } = standbyOf();
    s.el.style = { visibility: 'hidden' };
    p.api.standby = s;
    const f = p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' });
    p.timers.length = 0; p.api.adopting('_2_1', f);
    setup({ p, f, doc });
    p.tick(50); p.step();
    assert.equal(f.el.style.visibility, shown, why);
  }
  assert.match(part('  const picture = ', '  const unpicture = '), /if \(showing === cid && !f\.ready && !pic && !f\.adopting\) f\.el\.style\.visibility = ''/, 'with no sketch, not shown while it adopts');
});

test('only a course drawn after the adoption counts as routed: the light page\'s own panel never does, nor does watch settle first', () => {
  const p = run();
  const { doc, s } = standbyOf();
  const old = {};
  doc.querySelectorAll = () => [old];
  doc.querySelector = (q) => (q === '.routed-page' ? old : null);
  p.api.standby = s;
  const f = p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' });
  p.timers.length = 0; p.api.adopting('_2_1', f);
  f.adopting.ok = true; doc.location.pathname = '/ultra/courses/_2_1/outline';
  for (let i = 0; i < 101; i++) { p.tick(50); p.step(); }
  assert.deepEqual(p.did.filter(([k]) => k === 'load'), [['load', '_2_1', '/ultra/courses/_2_1/outline']], 'the page it had, still there: not routed');
  assert.match(part('  const watch = ', '  const open = '), /&& !f\.adopting/, 'watch waits for the route to be confirmed');
});
