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
    prefs: { ahead: true, renew: 10 }, P: () => c.prefs, L, t: (s) => s, tabs: [{ cid: '_1_1', name: 'One' }, { cid: '_2_1', name: 'Two' }, { cid: '_3_1', name: 'Three' }],
    frames: new Map(), spare: new Map(), waiting: '', wait() {}, PAGE: 'page', LIVE: 4, showing: '', pic: null, drag: null, location: { origin }, Date, Element: class {},
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

test('a standby older than tabs.renew is never adopted: no older account check carries into a course', () => {
  for (const renew of [2, 10, 120]) for (const [age, ok] of [[renew * 60000 - 1000, true], [renew * 60000 + 1, false]]) {
    const p = run({ prefs: { ahead: true, renew } }), { s, el } = standbyOf({ at: Date.now() - age });
    p.api.standby = s;
    assert.equal(!!p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' }), ok, `${renew} min, ${age} ms old`);
    if (!ok) assert.ok(el.removed, 'the next course boots with a fresh account check');
  }
});

test('the course tab settings changed (ahead of time switched off) reach the standby at once, without waiting for a page pass', () => {
  assert.match(part('  const onStore = ', '  // Where the page frame is'), /if \(area === 'sync' && c\.tabs\) readPrefs\(\)\.then\(\(\) => \{ pass\(\); standbyLater\(\); \}\);/);
});

// ---- renewed once STALE ----
test('the whole page script parses: the sections run here alone share one scope there', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'navigation/page/coursetabs.js' }));
});

// The section on a clock of its own: its timers run as time passes (pass), in order, cleared as the page clears them. Each
// iframe made is a standby on Ultra's light page; one made while another standby is still in the page fails the test.
const STALE = 120000;
const clocked = (over = {}) => {
  let now = 1e6, wallOffset = 0, n = 0;
  const q = new Map(), made = [];
  const at = (fn, ms) => { q.set(++n, { fn, due: now + Math.max(0, ms || 0) }); return n; };
  const document = {
    visibilityState: 'visible', body: {},
    createElement: () => {
      assert.equal(made.filter((e) => e.isConnected && e.name === 'gz-ctab:standby').length, 0, 'never two standbys at once');
      const doc = { body: {}, location: { origin, pathname: '/ultra/profile', search: '' }, querySelector: () => null, querySelectorAll: () => [] };
      const attrs = new Set();
      const el = { style: {}, isConnected: false, contentDocument: doc, contentWindow: { postMessage() {} }, booted: now, removed: 0, addEventListener() {},
        removeAttribute: (k) => attrs.delete(k), toggleAttribute: (k, v) => (v ? attrs.add(k) : attrs.delete(k)), hasAttribute: (k) => attrs.has(k),
        remove() { this.removed++; this.isConnected = false; } };
      made.push(el);
      return el;
    },
  };
  const k = {};
  // Its Glaze says it is in, then who is signed in there: usable.
  k.ready = (el) => { for (const data of [{ gzCtab: 'loaded' }, { gzCtab: 'account', uid: '_42_1' }]) k.api.onAhead({ data, source: el.contentWindow, origin }); };
  Object.assign(k, run({ Date: { now: () => now + wallOffset }, performance: { now: () => now }, setTimeout: at, clearTimeout: (id) => q.delete(id),
    requestIdleCallback: (fn) => at(fn, 0), cancelIdleCallback: (id) => q.delete(id), document, nudge() {}, prefs: { ahead: true, renew: 2 },
    host: { prepend: (el) => { el.isConnected = true; if (k.auto) k.ready(el); } }, ...over }), { made });
  k.pass = (ms) => {
    const end = now + ms;
    for (let i = 0; ; i++) {
      assert.ok(i < 10000, 'no loop of timers');
      const [id, t] = [...q].filter(([, x]) => x.due <= end).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0] || [];
      if (!t) break;
      q.delete(id); now = t.due; t.fn();
    }
    now = end;
  };
  k.pending = () => q.size;
  k.adjustClock = (ms) => { wallOffset += ms; };
  let onVisibility;
  k.onVisibility = () => (onVisibility ||= vm.runInContext(part('  const onVisibility = ', '  const listen = ') + '\nonVisibility;', k.c))();
  return k;
};

test('a standby past STALE is renewed while the page shows, so a tab picked minutes later adopts instead of loading cold', () => {
  const p = clocked();
  p.api.standbyLater(); p.pass(5000);
  assert.equal(p.made.length, 1, 'booted at idle');
  p.ready(p.made[0]);
  p.pass(110000); p.api.standbyLater();
  assert.equal(p.api.standby?.el, p.made[0], 'kept while it may still be adopted');
  p.pass(15000);
  assert.equal(p.made.length, 2, 'renewed at the next idle once STALE');
  assert.equal(p.made[0].removed, 1, 'the stale one let go of');
  assert.equal(p.api.standby?.el, p.made[1]);
  p.ready(p.made[1]);
  const f = p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1', name: 'Two' });
  assert.equal(f?.el, p.made[1], 'adopted: routed in place');
  assert.deepEqual(p.did.filter(([k]) => k === 'load'), [], 'no cold load');
  assert.equal(p.api.miss, 0, 'a renewal is no miss');
});

test('never two standbys: a stale one goes before its renewal boots, and syncs meanwhile boot no other', () => {
  const p = clocked();
  p.auto = true;
  p.api.standbyLater();
  for (let i = 0; i < 600; i++) { p.pass(1000); p.api.standbyLater(); } // ten minutes, a sync each second
  assert.equal(p.made.length, 5, 'one each STALE, after its 2.5 s wait');
  assert.deepEqual(p.made.map((e) => e.isConnected), [false, false, false, false, true]);
  assert.equal(p.api.standby?.el, p.made[4]);
  assert.equal(p.api.miss, 0);
});

test('a clock correction cannot disarm standby renewal when its expiry timer fires before STALE', () => {
  const p = clocked();
  p.auto = true;
  p.api.standbyLater(); p.pass(35000);
  p.adjustClock(-60000);
  p.pass(90000);
  assert.equal(p.api.standby?.el, p.made[0], 'kept until its wall-clock age reaches STALE');
  p.pass(60000);
  assert.equal(p.made.length, 2, 'the remaining lifetime is checked again without another page sync');
  assert.equal(p.made[0].removed, 1);
  assert.equal(p.api.standby?.el, p.made[1]);
  assert.equal(p.api.miss, 0, 'a clock correction is no failed boot');
  p.pass(125000);
  assert.equal(p.made.length, 3, 'later renewals stay armed');
});

test('hidden, a stale standby is let go of and renewed on the page\'s next visibilitychange, never on a timer', () => {
  const p = clocked({ ctx: { site: 'ultra', courseId: () => '' } });
  p.api.standbyLater(); p.pass(5000); p.ready(p.made[0]);
  p.pass(60000);
  p.c.document.visibilityState = 'hidden'; p.onVisibility();
  p.pass(30 * 60000);
  p.api.standbyLater(); // a route in the background tab
  p.pass(60000);
  assert.equal(p.made.length, 1, 'no boot while hidden');
  assert.equal(p.made[0].isConnected, false, 'past STALE it would never be adopted');
  assert.equal(p.pending(), 0, 'nothing waiting on a timer');
  p.c.document.visibilityState = 'visible'; p.onVisibility();
  p.pass(5000);
  assert.equal(p.made.length, 2, 'renewed once on screen');
  p.ready(p.made[1]);
  assert.equal(p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' })?.el, p.made[1]);
});

test('a page hidden before its first standby boots it on its next visibilitychange, with no timer meanwhile', () => {
  const p = clocked({ ctx: { site: 'ultra', courseId: () => '' } });
  p.c.document.visibilityState = 'hidden';
  p.api.standbyLater(); p.pass(10 * 60000);
  assert.equal(p.made.length, 0);
  assert.equal(p.pending(), 0);
  p.c.document.visibilityState = 'visible'; p.onVisibility(); p.pass(5000);
  assert.equal(p.made.length, 1);
});

test('renewal boots that never get ready back off as any boot: a longer wait each time, none after three', () => {
  const p = clocked();
  p.api.standbyLater(); p.pass(5000); p.ready(p.made[0]);
  p.pass(2 * 3600000);
  assert.equal(p.made.length, 4, 'the renewal and two more tries');
  const [, b, c, d] = p.made.map((e) => e.booted);
  assert.deepEqual([c - (b + 30000), d - (c + 30000)], [10000, 40000], 'each let go of after 30 s, the next wait four times longer');
  assert.equal(p.api.miss, 3);
  assert.equal(p.api.standby, null);
  assert.equal(p.pending(), 0, 'no loop');
});

// ---- how long a standby is kept (tabs.renew) ----
test('how long a standby is kept: tabs.renew, 10 minutes by default, one of the offered 2 to 120, chosen under the switch and off with it', () => {
  assert.deepEqual(L.SPEC.renew, [10, [2, 5, 10, 30, 60, 120]], 'as writer.versions: a select\'s numbers are its choices');
  assert.equal(D.GZ_SANITIZE({}).tabs.renew, 10);
  for (const [v, want] of [[2, 2], [30, 30], [120, 120], [1, 10], [121, 10], [0, 10], [7, 10], [45, 10], ['30', 10], [null, 10], [NaN, 10]]) {
    assert.equal(D.GZ_SANITIZE({ tabs: { renew: v } }).tabs.renew, want, String(v));
  }
  const html = read('options.html');
  const row = html.match(/<label class="check"><input type="checkbox" data-key="tabs\.ahead">[^\n]*\n([^\n]*)/)?.[1] || '';
  assert.match(row, /^<label class="field"><span>Renew the waiting page after<\/span><select data-key="tabs\.renew" data-number>/, 'directly under the switch');
  const offered = [...row.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)].map((m) => [+m[1], m[2]]);
  assert.deepEqual(offered, [[2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours']]);
  for (const [v] of offered) assert.equal(D.GZ_SANITIZE({ tabs: { renew: v } }).tabs.renew, v, `${v} is kept as offered`);
  assert.deepEqual(offered.map(([v]) => v), L.SPEC.renew[1], 'every choice offered, and only those');
  for (const f of fs.readdirSync(path.join(root, 'i18n'))) for (const k of ['Renew the waiting page after', '2 minutes', '2 hours']) {
    assert.match(read(`i18n/${f}`), new RegExp(`"${k}": "[^"]+"`), `${f}: ${k}`);
  }
  assert.match(read('settings/options.js'), /\$\('\[data-key="tabs\.renew"\]'\)\.disabled = !s\.tabs\.ahead;/, 'off with ahead of time');
});

test('the standby is renewed at tabs.renew: at 2 minutes after 2, at 60 kept past 2 and renewed after 60', () => {
  for (const renew of [2, 60]) {
    const p = clocked({ prefs: { ahead: true, renew } });
    p.auto = true;
    p.api.standbyLater(); p.pass(5000); // booted 2.5 s in
    p.pass(renew * 60000 - 6000);
    assert.equal(p.made.length, 1, `${renew}: kept until its limit`);
    assert.equal(p.api.standby?.el, p.made[0]);
    if (renew === 60) { p.ready(p.made[0]); assert.equal(p.api.adopt('_2_1', '/ultra/courses/_2_1/outline', { cid: '_2_1' })?.el, p.made[0], 'adopted at 59 minutes'); continue; }
    p.pass(10000);
    assert.equal(p.made.length, 2, `${renew}: renewed at its limit`);
  }
  const p = clocked({ prefs: { ahead: true, renew: 60 } });
  p.auto = true;
  p.api.standbyLater(); p.pass(3600000 + 10000);
  assert.equal(p.made.length, 2, '60: renewed at its limit');
});

test('a changed tabs.renew reaches the standby at once: shorter renews it if past or re-arms, longer keeps it to the new limit', () => {
  const at = (renew) => { const p = clocked({ prefs: { ahead: true, renew } }); p.auto = true; p.api.standbyLater(); p.pass(5000); return p; };
  const change = (p, renew) => { p.c.prefs = { ahead: true, renew }; p.api.standbyLater(); }; // (onStore: readPrefs, then standbyLater)
  // Shorter, and past it: renewed at the change.
  let p = at(60); p.pass(180000);
  assert.equal(p.made.length, 1, 'kept at 3 minutes under 60');
  change(p, 2); p.pass(5000);
  assert.equal(p.made.length, 2, 'renewed at once');
  // Shorter, not yet past it: renewed at the new limit.
  p = at(60); p.pass(180000);
  change(p, 5); p.pass(110000);
  assert.equal(p.made.length, 1, 'still under 5 minutes');
  p.pass(15000);
  assert.equal(p.made.length, 2, 'renewed at 5 minutes, not 60');
  // Longer: kept past the old limit, renewed at the new one.
  p = at(5); p.pass(55000);
  change(p, 30); p.pass(25 * 60000);
  assert.equal(p.made.length, 1, 'kept past the old 5 minutes');
  p.pass(5 * 60000);
  assert.equal(p.made.length, 2, 'renewed at 30 minutes');
  assert.equal(p.api.miss, 0);
});
