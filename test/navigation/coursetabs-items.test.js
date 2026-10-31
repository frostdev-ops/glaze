// Course Content kept ready on Ultra (navigation/page/coursetabs.js, tabs.keep): an item opened from the outline opens in an
// item frame over it, the outline kept live and scrolled as it was; Back shows it again at once, and the freed item frame,
// routed to the outline, takes its place once drawn, at the same scroll, while the student is still.
// The page itself: checks/navigation/ultra-keep-content-check.js.
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
const origin = 'https://bb.school.test', C = '/ultra/courses/_2_1', OUT = `${C}/outline`, DOC = `${C}/document/_8_1?view=content`;

// A frame's element and document, as the page around reads them.
const frame = (where, over = {}) => {
  const posted = [];
  const [pathname, search = ''] = where.split('?');
  const scroller = { t: 0, max: 5000, get scrollTop() { return Math.min(this.t, this.max); }, set scrollTop(v) { this.t = v; } };
  const doc = { body: {}, location: { origin, pathname, search: search ? `?${search}` : '' }, querySelectorAll: () => [], querySelector: () => null,
    addEventListener() {}, removeEventListener() {}, scrollingElement: scroller, defaultView: { getComputedStyle: () => ({ overflowY: 'visible' }) } };
  const el = { style: {}, inert: false, isConnected: true, name: '', contentDocument: doc, focus() {}, remove() { this.isConnected = false; },
    contentWindow: { name: '', postMessage: (m) => posted.push(structuredClone(m)) } };
  return { el, doc, posted, scroller, ready: true, dirty: false, uid: '_42_1', ...over };
};
const run = (over = {}) => {
  const timers = [], did = [];
  let now = 1000, key = 1;
  const c = vm.createContext({
    ctx: { site: 'ultra', courseId: () => '', scene() {} }, on: true, preview: false, signedOut: false, framed: '', who: '_42_1', loaded: true,
    prefs: { ahead: true, keep: true }, P: () => c.prefs, L, t: (s) => s, tabs: [{ cid: '_2_1', name: 'Two' }, { cid: '_3_1', name: 'Three' }],
    frames: new Map(), spare: new Map(), waiting: '', PAGE: 'page', LIVE: 4, showing: '', pic: null, drag: null, standby: undefined,
    location: { origin, pathname: '/ultra/course', search: '' }, Date, URL, URLSearchParams, structuredClone, Element: class {},
    performance: { now: () => now }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    document: { visibilityState: 'visible', body: {}, activeElement: null, addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    host: { prepend() {} }, hostIn() {}, loading: () => false, shown: (e) => !!e, room: () => true, guardFrame() {}, watch() {}, load() {},
    anchorOf: (e) => e.anchor, pathOf: (f) => f.el.contentDocument.location.pathname + f.el.contentDocument.location.search,
    entry: () => `k${key}`, history: { pushState: () => { key++; did.push(['push']); }, back: () => did.push(['back']) },
    wait: (cid) => { c.waiting = cid; }, show: (cid) => { did.push(['show', cid]); c.showing = cid; },
    open: (cid, url) => { const f = frame(url, { ready: false }); c.frames.set(cid, f); did.push(['open', cid, url]); return f; },
    toTop: (op, m) => did.push(['toTop', op, structuredClone(m)]), send: () => Promise.resolve(null), revoke() {},
    ...over,
  });
  const api = vm.runInContext(part('  const frameEl = ', '  // The stand-in over a frame') + `
;({ onItemClick, openItem, closeItem, onItemPop, onAhead, freshen, finishFresh, routeHere, demoteHere, onItemNav,
  get items() { return items; }, get standby() { return standby; }, set standby(v) { standby = v; }, get itemMode() { return itemMode; }, set itemMode(v) { itemMode = v; } })`, c);
  return { c, api, did, timers, tick: (ms) => { now += ms; }, step: () => timers.shift()?.fn(), key: () => `k${key}`, setKey: (k) => { key = k; } };
};
const click = (href, more = {}) => {
  const anchor = { target: '', hasAttribute: () => false, getAttribute: () => href };
  const e = { isTrusted: true, button: 0, anchor, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...more };
  return e;
};
const msg = (p, f, data) => p.api.onAhead({ data, source: f.el.contentWindow, origin });

test('a link on Course Content is an item when Ultra would build it in the outline\'s place; panels over the outline, attempts, tools, downloads and other courses are not', () => {
  assert.equal(L.outlineOf(OUT), '_2_1');
  assert.equal(L.outlineOf(`${OUT}/`), '_2_1');
  for (const p of [`${OUT}/edit/document/_8_1`, `${C}/grades`, '/ultra/course', `${C}`]) assert.equal(L.outlineOf(p), null, p);
  const kind = (p, q = '') => L.itemOf(p, q, '_2_1');
  for (const p of [`${C}/document/_8_1`, `${C}/assessment/_8_1/overview`, `${C}/discussion/_8_1`, `${C}/learning-module/_8_1`, `${C}/learning-module/_8_1/document/_9_1`, `${C}/file/_8_1`]) assert.equal(kind(p, 'view=content'), 'item', p);
  assert.equal(kind(`${C}/assessment/_8_1/overview`, 'courseId=_2_1'), 'item');
  for (const p of [`${OUT}/edit/document/_8_1`, `${OUT}/assessment/_8_1/overview`, `${OUT}/discussion/_8_1`]) assert.equal(kind(p), 'peek', p);
  for (const [p, q] of [[`${C}/assessment/_8_1/attempt/create`, ''], [`${C}/assessment/_8_1/attempt/_9_1`, ''], [`${C}/outline/lti/launchFrame/_8_1`, ''], [`${C}/assessment/_8_1/overview`, 'courseId=_3_1'],
    [`${C}/document/_8_1`, 'download=1'], ['/ultra/courses/_3_1/document/_8_1', ''], [`${C}/grades`, ''], [`${C}/assessment/_8_1/overview/rubric-view`, ''], ['/webapps/blackboard/execute/launcher', ''], [`${C}/document/../x`, '']]) assert.equal(kind(p, q), null, `${p}?${q}`);
  assert.equal(L.itemOf(`${C}/document/_8_1`, '', 'bad'), null);
});

test('on by default, one switch beside the other course tab options, said in every language', () => {
  assert.deepEqual(L.SPEC.keep, [true, 'bool']);
  assert.equal(D.GZ_SANITIZE({}).tabs.keep, true);
  assert.equal(D.GZ_SANITIZE({ tabs: { keep: false } }).tabs.keep, false);
  const html = read('options.html'), section = html.slice(html.indexOf('<section id="tabs"'), html.indexOf('</section>', html.indexOf('<section id="tabs"')));
  assert.match(section, /<input type="checkbox" data-key="tabs\.keep"><span>Keep Course Content ready<\/span>/);
  for (const f of fs.readdirSync(path.join(root, 'i18n'))) assert.match(read(`i18n/${f}`), /"Keep Course Content ready": "[^"]+"/, f);
});

test('in a tab\'s frame on Course Content, a click on an item goes to the page around it; nothing else is taken', () => {
  const p = run({ framed: '_2_1', location: { origin, pathname: OUT, search: '' } });
  let e = click(DOC);
  p.api.onItemClick(e);
  assert.ok(e.prevented && e.stopped, 'Ultra never sees it');
  assert.deepEqual(p.did, [['toTop', 'item', { url: DOC }]]);
  for (const [why, href, more] of [['a panel over the outline', `${OUT}/edit/document/_8_1?courseId=_2_1`], ['an attempt', `${C}/assessment/_8_1/attempt/create`], ['a tool', `${C}/outline/lti/launchFrame/_8_1`],
    ['another course', '/ultra/courses/_3_1/document/_8_1'], ['another site', 'https://other.test/ultra/courses/_2_1/document/_8_1'], ['with Ctrl', DOC, { ctrlKey: true }], ['a middle click', DOC, { button: 1 }],
    ['a script\'s click', DOC, { isTrusted: false }], ['handled already', DOC, { defaultPrevented: true }]]) {
    const q = run({ framed: '_2_1', location: { origin, pathname: OUT, search: '' } });
    e = click(href, more); q.api.onItemClick(e);
    assert.ok(!e.prevented && !q.did.length, why);
  }
  for (const [why, over] of [['not on Course Content', { location: { origin, pathname: `${C}/grades`, search: '' } }], ['switched off', { prefs: { keep: false } }], ['the standby', { framed: 'standby' }]]) {
    const q = run({ framed: '_2_1', location: { origin, pathname: OUT, search: '' }, ...over });
    e = click(DOC); q.api.onItemClick(e);
    assert.ok(!e.prevented && !q.did.length, why);
  }
  // In an item frame, its link back to Course Content closes it.
  const r = run({ framed: '_2_1', location: { origin, pathname: `${C}/document/_8_1`, search: '' } });
  r.api.itemMode = true;
  e = click(OUT); r.api.onItemClick(e);
  assert.ok(e.prevented);
  assert.deepEqual(r.did, [['toTop', 'itemback', undefined]]);
});

// A tab's frame on its outline, on screen, with an item opened from it.
const opened = (over = {}) => {
  const p = run({ showing: '_2_1', ...over });
  const base = frame(OUT);
  p.c.frames.set('_2_1', base);
  msg(p, base, { gzCtab: 'item', url: DOC });
  return { p, base, it: p.c.frames.get('_2_1') };
};

test('an item from a tab\'s outline opens in an item frame over it, with an entry of its own; the outline hides once the item is drawn', () => {
  const { p, base, it } = opened();
  assert.notEqual(it, base);
  assert.deepEqual(p.did.filter(([k]) => k === 'open' || k === 'push'), [['open', '_2_1', DOC], ['push']]);
  assert.deepEqual([...(p.c.spare.get('_2_1') || [])], [base], 'the outline kept live beside it, still the tab\'s');
  assert.equal(p.c.frames.size, 1, 'one live frame for the tab: LIVE unchanged');
  assert.deepEqual([it.item, it.url, it.el.style.zIndex], ['_2_1', DOC, '1']);
  assert.deepEqual(it.posted.at(-1), { gzCtab: 'item', on: true });
  assert.deepEqual([base.el.style.visibility, base.el.inert], [undefined, false], 'still on screen while the item loads');
  assert.deepEqual([p.api.items.get('_2_1').open, p.api.items.get('_2_1').from, p.api.items.get('_2_1').key], [true, 'k1', 'k2']);
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.deepEqual([base.el.style.visibility, base.el.inert], ['hidden', true]);
  assert.deepEqual(base.posted.at(-1), { gzCtab: 'visible', on: false });
  // Refused (an address that isn't an item, or not on its outline): the frame goes there itself.
  const q = run({ showing: '_2_1' });
  const b = frame(`${C}/grades`);
  q.c.frames.set('_2_1', b);
  msg(q, b, { gzCtab: 'item', url: DOC });
  assert.deepEqual(b.posted, [{ gzCtab: 'route', url: DOC, push: true }]);
  assert.equal(q.c.frames.get('_2_1'), b);
});

test('Back shows the kept outline at once, as it was; the freed item frame goes to the outline, hidden', () => {
  const { p, base, it } = opened();
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  base.scroller.scrollTop = 1234;
  p.setKey(1);
  const pop = { stopped: false, stopImmediatePropagation() { this.stopped = true; } };
  p.api.onItemPop(pop);
  assert.ok(pop.stopped, 'Ultra\'s router never hears its own address again');
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.deepEqual([base.el.style.visibility, base.el.inert, base.scroller.scrollTop], ['', false, 1234], 'the same document at the same scroll');
  assert.deepEqual(base.posted.at(-1), { gzCtab: 'visible', on: true });
  assert.deepEqual([it.el.style.visibility, it.el.inert, it.el.style.zIndex], ['hidden', true, '']);
  assert.deepEqual(it.posted.slice(-3), [{ gzCtab: 'item', on: false }, { gzCtab: 'visible', on: false }, { gzCtab: 'route', url: OUT }]);
  assert.deepEqual([...(p.c.spare.get('_2_1') || [])], [it]);
  assert.equal(p.api.items.get('_2_1').open, false);
  // Forward: the item again, through its entry, with no new one.
  p.setKey(2);
  const fwd = { stopImmediatePropagation() { this.stopped = true; } };
  p.api.onItemPop(fwd);
  assert.ok(fwd.stopped);
  assert.equal(p.api.items.get('_2_1').open, true);
  assert.equal(p.did.filter(([k]) => k === 'push').length, 1);
});

test('Ultra\'s own way back in the item closes it, and its entry is gone back over', () => {
  const { p, base, it } = opened();
  msg(p, it, { gzCtab: 'itemback' });
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.deepEqual(p.did.filter(([k]) => k === 'back'), [['back']]);
  p.setKey(1);
  const pop = { stopImmediatePropagation() { this.stopped = true; } };
  p.api.onItemPop(pop);
  assert.ok(pop.stopped);
  assert.equal(p.api.items.get('_2_1').open, false, 'that pop closes nothing more');
  // Seen late, as the item frame's own route to the outline.
  const q = opened();
  q.it.doc.location.pathname = OUT;
  msg(q.p, q.it, { gzCtab: 'moved' });
  assert.equal(q.p.c.frames.get('_2_1'), q.base);
});

test('an item frame holding unsaved work is kept as it is, and shown again by Forward', () => {
  const { p, base, it } = opened();
  it.dirty = true;
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.ok(!it.posted.some((m) => m.gzCtab === 'route'), 'never routed away');
  assert.equal(it.el.isConnected, true);
  p.setKey(2);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(p.c.frames.get('_2_1'), it, 'the same frame, its work there');
  assert.equal(p.did.filter(([k]) => k === 'open').length, 1);
});

test('the fresh outline takes the kept one\'s place only with the student still and at the same scroll', () => {
  const { p, base, it } = opened();
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  base.scroller.scrollTop = 1234;
  const fr = it.fresh;
  assert.ok(fr, 'freshening');
  // Drawn anew: a new outline element, settled.
  it.doc.location.pathname = OUT;
  it.doc.querySelectorAll = () => [{ fresh: true }];
  fr.acted = 1000; // the student scrolled as it closed
  const asks = () => it.posted.filter((m) => m.gzCtab === 'visible' && m.on === true).length;
  const step = () => { p.tick(100); p.step(); };
  for (let i = 0; i < 8; i++) step();
  assert.equal(asks(), 0, 'not while the student acts');
  for (let i = 0; i < 4; i++) step();
  assert.equal(asks(), 1, 'still: asked to ready itself as shown');
  // Not at the same place (its content shorter): hidden again, not swapped.
  it.scroller.max = 100;
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.deepEqual(it.posted.at(-1), { gzCtab: 'visible', on: false });
  // Acted again while it readied itself: not swapped either.
  it.scroller.max = 5000;
  fr.asked = 1; fr.acted = 1e9;
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), base);
  // At the same place, still: in one frame, the old one let go (the next standby).
  fr.asked = 1; fr.acted = -Infinity;
  p.api.standby = null;
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), it);
  assert.equal(it.scroller.scrollTop, 1234);
  assert.deepEqual([it.el.style.visibility, it.el.inert, base.el.style.visibility, base.el.inert], ['', false, 'hidden', true]);
  assert.deepEqual([...(p.c.spare.get('_2_1') || [])], []);
  assert.equal(it.item, null);
  assert.equal(it.fresh, null);
  assert.equal(p.api.standby?.el, base.el, 'the old outline frame waits as the standby');
  assert.equal(base.el.name, 'gz-ctab:standby');
  assert.deepEqual(base.posted.at(-1), { gzCtab: 'demote' });
});

test('moved on before it is drawn (another tab shown): the fresh outline goes', () => {
  const { p, base, it } = opened();
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  p.api.standby = { el: {} };
  p.c.showing = '_3_1';
  p.tick(100); p.step();
  assert.equal(it.fresh, null);
  assert.equal(it.el.isConnected, false, 'a standby waits already: let go');
  assert.deepEqual([...(p.c.spare.get('_2_1') || [])], []);
  assert.equal(p.c.frames.get('_2_1'), base);
});

test('on this page\'s own Course Content, an item shows as the course\'s frame over the page; Back shows the page again', () => {
  const p = run({ ctx: { site: 'ultra', courseId: () => '_2_1', scene() {} }, location: { origin, pathname: OUT, search: '' } });
  const e = click(DOC);
  p.api.onItemClick(e);
  assert.ok(e.prevented);
  const it = p.c.frames.get('_2_1');
  assert.deepEqual(p.did, [['open', '_2_1', DOC], ['push']]);
  assert.equal(p.c.waiting, '_2_1', 'this page stays until the item is drawn (watch shows it)');
  assert.equal(it.item, '_2_1');
  p.c.showing = '_2_1';
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.deepEqual(p.did.at(-1), ['show', '']);
  assert.equal(p.c.frames.get('_2_1'), it, 'kept, hidden, until it is the fresh outline');
  assert.deepEqual(it.posted.at(-1), { gzCtab: 'route', url: OUT });
  assert.match(part('  const pass = ', '  const sync = '), /frames\.has\(cid\) && waiting !== cid && !frames\.get\(cid\)\.item\)/, 'this page doesn\'t let go of its own course\'s item frame');
});

test('switched off, nothing is taken: Ultra opens items as it always has', () => {
  const p = run({ prefs: { keep: false }, ctx: { site: 'ultra', courseId: () => '_2_1', scene() {} }, location: { origin, pathname: OUT, search: '' } });
  const e = click(DOC);
  p.api.onItemClick(e);
  assert.ok(!e.prevented);
  assert.equal(p.api.openItem('_2_1', DOC), false);
  assert.deepEqual(p.did, []);
});

test('in its frame, Glaze routes in place within its own course only, goes back to standing by, and stops Ultra\'s way back to the outline', () => {
  const routed = [], events = [];
  const p = run({ framed: '_2_1', window: { name: 'gz-ctab:_2_1' }, awayFrom: 'x', last: '_2_1', lastPath: OUT, restored: true, html: { toggleAttribute: (k, v) => events.push([k, v]) },
    history: { replaceState: (s, t, u) => routed.push(['replace', u]), pushState: (s, t, u) => routed.push(['push', u]) }, dispatchEvent: (e) => events.push(e.type), PopStateEvent: class { constructor(t) { this.type = t; } } });
  p.api.routeHere(OUT); p.api.routeHere(DOC, true); p.api.routeHere('/ultra/courses/_3_1/outline'); p.api.routeHere('https://evil.test/x');
  assert.deepEqual(routed, [['replace', `${origin}${OUT}`], ['push', `${origin}${DOC}`]]);
  p.api.itemMode = true;
  const nav = (url, type = 'push') => { const e = { navigationType: type, destination: { url }, cancelable: true, preventDefault() { this.stopped = true; } }; p.api.onItemNav(e); return e; };
  assert.ok(!nav(`${origin}${C}/document/_9_1`).stopped, 'another item: Ultra\'s own');
  assert.ok(nav(`${origin}${OUT}`).stopped);
  assert.equal(p.api.itemMode, false);
  assert.deepEqual(p.did.at(-1), ['toTop', 'itemback', undefined]);
  assert.ok(events.some(([k, v]) => k === 'data-gz-ctab-framed' && v === true), 'hidden at once: the rebuilt outline never shows');
  p.api.demoteHere();
  assert.equal(p.c.framed, 'standby');
  assert.equal(p.c.window.name, 'gz-ctab:standby');
  assert.deepEqual(routed.at(-1), ['replace', `${origin}/ultra/profile`]);
  assert.deepEqual([p.c.awayFrom, p.c.lastPath, p.c.restored], ['', '', false]);
});
