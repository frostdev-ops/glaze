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
    frames: new Map(), spare: new Map(), waiting: '', showTurn: 0, PAGE: 'page', LIVE: 4, KEEP: 3, KEPT: 8, showing: '', pic: null, drag: null, standby: undefined,
    location: { origin, pathname: '/ultra/course', search: '' }, Date, URL, URLSearchParams, structuredClone, Element: class {},
    performance: { now: () => now }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    document: { createElement: () => { const f = frame(OUT); f.el.addEventListener = () => {}; return f.el; }, visibilityState: 'visible', body: {}, activeElement: null, addEventListener() {}, removeEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    host: { prepend() {} }, hostIn() {}, loading: () => false, shown: (e) => !!e, acts: () => false, room: () => true, guardFrame() {}, watch() {}, load() {},
    anchorOf: (e) => e.anchor, pathOf: (f) => f.el.contentDocument.location.pathname + f.el.contentDocument.location.search,
    entry: () => `k${key}`, history: { pushState: () => { key++; did.push(['push']); }, back: () => did.push(['back']) },
    wait: (cid) => { c.waiting = cid; }, show: (cid) => { did.push(['show', cid]); c.showing = cid; },
    open: (cid, url) => { const f = frame(url, { ready: false }); c.frames.set(cid, f); did.push(['open', cid, url]); return f; },
    toTop: (op, m) => did.push(['toTop', op, structuredClone(m)]), send: () => Promise.resolve(null), revoke() {}, say() {},
    ...over,
  });
  const api = vm.runInContext(part('  const frameEl = ', '  // The stand-in over a frame') + `
;({ onItemClick, openItem, closeItem, onItemPop, onAhead, stopKeeping, freshen, finishFresh, routeHere, demoteHere, onItemNav, standbyLater, staleCheck,
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

test('turning ahead off preserves the open item and its Back entry', () => {
  const { p, base } = opened();
  p.c.prefs.ahead = false;
  p.api.standbyLater(); // sync calls this even while ahead is off
  assert.equal(p.api.items.get('_2_1')?.open, true);
  p.setKey(1);
  const pop = { stopImmediatePropagation() { this.stopped = true; } };
  p.api.onItemPop(pop);
  assert.equal(pop.stopped, true);
  assert.equal(p.c.frames.get('_2_1'), base);
  const fresh = p.c.spare.get('_2_1')[0].fresh;
  p.api.standbyLater();
  assert.equal(p.c.spare.get('_2_1')[0].fresh, fresh, 'freshening does not depend on ahead either');
});

test('an item over a framed outline accepts input when it is drawn', () => {
  // frameEl starts both cold and standby frames inert; watch reveals the content without changing inert.
  const p = run({ showing: '_2_1' });
  p.c.open = (cid, url) => {
    const f = frame(url, { ready: false });
    f.el.inert = true;
    p.c.frames.set(cid, f);
    return f;
  };
  p.c.frames.set('_2_1', frame(OUT));
  msg(p, p.c.frames.get('_2_1'), { gzCtab: 'item', url: DOC });
  const it = p.c.frames.get('_2_1');
  it.ready = true;
  it.el.style.visibility = ''; // watch's on-screen reveal
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(it.el.inert, false, 'the document and its close link must be usable');
});

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

for (const changed of ['tab', 'base', 'document']) test(`a fresh outline reply after changing ${changed} cannot swap into view`, () => {
  const { p, base, it } = opened();
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  it.doc.location.pathname = OUT;
  it.fresh.asked = 1000;
  p.api.standby = { el: {} }; // discard the stale copy instead of recycling it
  const replacement = frame(OUT);
  if (changed === 'tab') p.c.showing = '_3_1';
  if (changed === 'base') p.c.frames.set('_2_1', replacement);
  if (changed === 'document') it.el.contentDocument = frame(OUT).doc;
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), changed === 'base' ? replacement : base);
  assert.equal(it.el.style.visibility, 'hidden');
  assert.equal(it.el.isConnected, false);
  assert.equal(base.el.isConnected, true, 'the kept outline remains available');
});

for (const edited of ['base', 'fresh']) test(`a fresh swap preserves unsaved work in the ${edited} frame`, () => {
  const { p, base, it } = opened();
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  it.doc.location.pathname = OUT;
  it.fresh.asked = 1000;
  (edited === 'base' ? base : it).dirty = true;
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.equal(base.el.isConnected, true);
  if (edited === 'fresh') assert.equal(it.el.isConnected, true);
});

test('editing the page outline prevents its replacement even after the student goes still', () => {
  const listeners = new Map();
  const p = run({ ctx: { site: 'ultra', courseId: () => '_2_1', scene() {} }, location: { origin, pathname: OUT, search: '' } });
  Object.assign(p.c.document, { location: p.c.location, scrollingElement: frame(OUT).scroller,
    querySelector: () => null, addEventListener: (ev, fn) => listeners.set(ev, fn) });
  p.api.openItem('_2_1', DOC);
  const it = p.c.frames.get('_2_1');
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  it.doc.location.pathname = OUT;
  it.fresh.asked = 1000;
  listeners.get('input')?.({ isTrusted: true });
  p.tick(2000);
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.showing, '', 'an edited native outline must stay on screen');
  assert.equal(it.fresh, null, 'the unsafe replacement stops');
});

test('a renewed stale outline keeps the frame navigation guard and completes its adoption', () => {
  const guarded = [];
  const p = run({ showing: '_2_1', guardFrame: (cid, f) => guarded.push(f) });
  const base = frame(OUT), s = frame('/ultra/profile');
  s.el.removeAttribute = () => {};
  p.c.frames.set('_2_1', base);
  p.api.standby = { el: s.el, loaded: s.doc, accountDoc: s.doc, uid: '_42_1', timer: 0 };
  p.api.staleCheck('_2_1', base);
  const fresh = p.c.spare.get('_2_1')[0];
  s.doc.location.pathname = OUT;
  fresh.fresh.asked = 1000;
  msg(p, fresh, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), fresh);
  assert.equal(guarded.includes(fresh), true, 'later cross-origin loads get the normal frame guard');
  assert.equal(fresh.adopting, null, 'a later native load must not wait forever for the old adoption');
});

test('an intercepted Ultra close waits for new outline content after its route changes', () => {
  const { p, it } = opened();
  const old = {};
  it.doc.querySelectorAll = (q) => q === 'iframe' ? [] : [old];
  msg(p, it, { gzCtab: 'itemback' }); // the close was intercepted before Ultra routed
  it.doc.location.pathname = OUT; // route changes before the outgoing DOM is replaced
  const asks = () => it.posted.filter((m) => m.gzCtab === 'visible' && m.on).length;
  for (let i = 0; i < 5; i++) { p.tick(100); p.step(); }
  assert.equal(asks(), 0, 'the item DOM cannot pass as the fresh outline');
  it.doc.querySelectorAll = (q) => q === 'iframe' ? [] : [{}];
  p.tick(100); p.step();
  assert.equal(asks(), 1, 'new outline nodes can be readied');
});

test('a fresh outline carries keyboard focus out of the retired frame', () => {
  const { p, base, it } = opened();
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  p.c.document.activeElement = base.el;
  let focused = false;
  it.el.focus = () => { focused = true; };
  it.doc.location.pathname = OUT;
  it.fresh.asked = 1000;
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(focused, true, 'keyboard focus follows the visible outline');
});

test('Back preserves an item with an embedded editor whose input cannot bubble to its document', () => {
  const { p, it } = opened();
  it.doc.querySelectorAll = (q) => q === 'iframe' ? [{}] : [];
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(it.posted.some((m) => m.gzCtab === 'route'), false, 'never route away from unobservable embedded work');
  assert.equal(it.dirty, true, 'the normal eviction guards protect that work too');
  p.setKey(2);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(p.c.frames.get('_2_1'), it);
});

test('edited item frames cannot grow past the per-course or overall retention bounds', () => {
  const { p } = opened();
  for (let i = 0; i < 3; i++) {
    if (i) assert.equal(p.api.openItem('_2_1', `${C}/document/_${20 + i}_1`), true);
    p.c.frames.get('_2_1').dirty = true;
    p.api.closeItem('_2_1', 'back');
  }
  assert.equal(p.api.openItem('_2_1', `${C}/document/_30_1`), null, 'a fourth edited item cannot be retained');
  const q = run({ showing: '_2_1' });
  q.c.frames.set('_2_1', frame(OUT));
  q.c.spare.set('_3_1', Array.from({ length: 8 }, () => frame(DOC, { dirty: true })));
  assert.equal(q.api.openItem('_2_1', DOC), null, 'eight edited earlier pages also exhaust the overall bound');
});

test('a full item cache consumes the click without routing away from the kept outline', () => {
  const p = run({ showing: '_2_1' }), base = frame(OUT, { dirty: true });
  p.c.frames.set('_2_1', base);
  p.c.spare.set('_2_1', Array.from({ length: 3 }, () => frame(DOC, { dirty: true })));
  msg(p, base, { gzCtab: 'item', url: `${C}/document/_30_1` });
  assert.equal(base.posted.some((m) => m.gzCtab === 'route'), false, 'the refusal must not destroy unsaved outline work');
  assert.equal(p.c.frames.get('_2_1'), base);
});

test('clean closed items do not accumulate when an edited outline cannot be replaced', () => {
  const p = run({ showing: '_2_1' }), base = frame(OUT, { dirty: true });
  p.c.frames.set('_2_1', base);
  for (let i = 0; i < 5; i++) {
    p.api.openItem('_2_1', `${C}/document/_${20 + i}_1`);
    p.api.closeItem('_2_1', 'back');
  }
  assert.equal(p.c.spare.get('_2_1').length, 1, 'only the most recent clean item needs to remain');
});

for (const closed of [false, true]) test(`dropping a course releases its ${closed ? 'closed' : 'open'} item state and refresh listeners`, () => {
  const { p, it } = opened();
  if (closed) p.api.closeItem('_2_1', 'back');
  Object.assign(p.c, { dropNext() {}, nudge() {}, drawerFrom: null });
  const drop = vm.runInContext(part('  const drop = ', '  const dropNext = ') + '\ndrop;', p.c);
  drop('_2_1');
  assert.equal(p.api.items.has('_2_1'), false, 'no map entry retains the detached outline document');
  assert.equal(it.fresh || null, null, 'refresh listeners end with the dropped frames');
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

test('Back before a page item is ready cancels its pending reveal', () => {
  const p = run({ ctx: { site: 'ultra', courseId: () => '_2_1', scene() {} }, location: { origin, pathname: OUT, search: '' } });
  p.api.openItem('_2_1', DOC);
  assert.equal(p.c.waiting, '_2_1');
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(p.c.waiting, '', 'watch must not show the closed item as it finishes loading');
  assert.equal(p.c.showing, '');
});

test('returning to the page course tab keeps its open item visible', () => {
  const p = run({ ctx: { site: 'ultra', courseId: () => '_2_1', scene() {} }, location: { origin, pathname: OUT, search: '' },
    save() {}, next: new Map(), reveal: (cid) => p.did.push(['reveal', cid]) });
  p.api.openItem('_2_1', DOC);
  p.c.showing = '_3_1';
  const visit = vm.runInContext(part('  const visit = (cid) => {', "  if (!framed && !preview) addEventListener('message'") + '\nvisit;', p.c);
  visit('_2_1');
  assert.deepEqual(p.did.at(-1), ['reveal', '_2_1'], 'select the open item, with the outline still underneath');
});

test('item Back, Forward and Ultra close work without Navigation API entry keys', () => {
  const h = { state: { native: 'kept' }, entries: [], backs: 0,
    replaceState(s) { this.state = structuredClone(s); },
    pushState(s) { this.entries.push(this.state); this.state = structuredClone(s); },
    back() { this.backs++; } };
  const { p, base } = opened({ entry: () => '', history: h });
  const itemState = structuredClone(h.state), baseState = h.entries[0];
  assert.equal(baseState.native, 'kept');
  h.state = baseState;
  const back = { state: baseState, stopImmediatePropagation() { this.stopped = true; } };
  p.api.onItemPop(back);
  assert.equal(back.stopped, true, 'Ultra must not rebuild the kept outline');
  assert.equal(p.c.frames.get('_2_1'), base);
  h.state = itemState;
  const forward = { state: itemState, stopImmediatePropagation() { this.stopped = true; } };
  p.api.onItemPop(forward);
  assert.equal(forward.stopped, true);
  assert.equal(p.api.items.get('_2_1').open, true);
  msg(p, p.c.frames.get('_2_1'), { gzCtab: 'itemback' });
  assert.equal(h.backs, 1, 'Ultra close traverses the item entry too');
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

test('another tab shown before the item is drawn hides the kept outline too; a tab closed with its item open leaves no item state behind', () => {
  assert.match(part('  const show = async (cid) => {', '  // A tab: its frame'), /for \(const \[k, a\] of spare\) if \(k !== cid\) for \(const g of a\) \{ g\.el\.style\.visibility = 'hidden'; g\.el\.inert = true; \}/,
    'no frame kept beside another course stays on screen');
  const { p, base, it } = opened();
  // The tab let go of (its frames gone), then its course's outline shown again in a new frame.
  p.c.frames.delete('_2_1'); p.c.spare.delete('_2_1');
  const fresh = frame(OUT);
  p.c.frames.set('_2_1', fresh);
  msg(p, fresh, { gzCtab: 'item', url: DOC });
  assert.notEqual(p.c.frames.get('_2_1'), fresh, 'an item opens again');
  assert.deepEqual([...p.c.spare.get('_2_1')], [fresh]);
  assert.ok(base && it);
  // A popstate with no live item of that course stops nothing of Ultra's.
  const q = opened();
  q.p.c.frames.delete('_2_1'); q.p.c.spare.delete('_2_1');
  q.p.setKey(1);
  const pop = { stopped: false, stopImmediatePropagation() { this.stopped = true; } };
  q.p.api.onItemPop(pop);
  assert.equal(pop.stopped, false);
});

test('Forward while the freed item frame is on its way to the outline: that frame is let go (the next standby) and the item opens afresh', () => {
  const { p, base, it } = opened();
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.ok(it.fresh);
  p.api.standby = null;
  p.setKey(2);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(it.fresh, null, 'its fresh outline given up');
  assert.notEqual(p.c.frames.get('_2_1'), it, 'never shown as the item: it is the outline by now');
  assert.equal(p.api.standby?.el, it.el, 'it waits as the standby');
  assert.deepEqual([...p.c.spare.get('_2_1')], [base]);
  assert.equal(p.did.filter(([k]) => k === 'open').length, 2);
});

test('an item kept for its unsaved work still leaves a renewed outline: the standby is routed there instead', () => {
  const { p, base, it } = opened();
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  it.dirty = true;
  const sb = frame('/ultra/profile');
  sb.el.removeAttribute = () => {};
  p.api.standby = { el: sb.el, loaded: sb.doc, uid: '_42_1', accountDoc: sb.doc, timer: 0 };
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.ok(!it.posted.some((m) => m.gzCtab === 'route'), 'the item, with its work, stays as it is');
  const spare = [...p.c.spare.get('_2_1')];
  assert.ok(spare.includes(it), 'kept');
  const fresh = spare.find((g) => g.el === sb.el);
  assert.ok(fresh?.fresh, 'the standby renews the outline beside it');
  assert.deepEqual(sb.posted.at(-1), { gzCtab: 'adopt', cid: '_2_1', url: OUT });
});

test('a stale outline is renewed even when ahead is off and no standby exists', () => {
  const p = run({ showing: '_2_1', prefs: { keep: true, ahead: false } }), base = frame(OUT), made = [];
  p.c.frames.set('_2_1', base);
  p.c.document.createElement = () => {
    const f = frame(OUT, { ready: false });
    f.el.addEventListener = (type, fn) => { if (type === 'load') f.loaded = fn; };
    made.push(f); return f.el;
  };
  p.api.staleCheck('_2_1', base);
  assert.equal(made.length, 1, 'a cold replacement is allowed when no standby can answer');
  assert.equal(p.c.frames.get('_2_1'), base, 'the current outline and scroll stay visible');
  made[0].loaded();
  assert.ok(p.c.spare.get('_2_1')[0].fresh, 'the replacement uses the guarded quiet swap');
});

test('stale gradebook frames renew at the same URL without replacing unsaved work', () => {
  const p = run({ showing: '_2_1' }), base = frame(`${C}/grades`), made = [];
  p.c.frames.set('_2_1', base);
  p.c.document.createElement = () => { const f = frame(`${C}/grades`); f.el.addEventListener = (t, fn) => { if (t === 'load') f.loaded = fn; }; made.push(f); return f.el; };
  p.api.staleCheck('_2_1', base);
  assert.equal(made.length, 1);
  assert.equal(made[0].el.src, origin + C + '/grades');
  made[0].loaded();
  assert.equal(p.c.spare.get('_2_1')[0].fresh.url, `${C}/grades`);
  const q = run({ showing: '_2_1' }), dirty = frame(`${C}/grades`, { dirty: true });
  q.c.frames.set('_2_1', dirty); q.c.document.createElement = () => { throw Error('unsaved work must stay'); };
  q.api.staleCheck('_2_1', dirty);
  assert.equal(q.c.frames.get('_2_1'), dirty);
});

test('an item kept for its work also renews the top page outline beneath it', () => {
  const p = run({ ctx: { site: 'ultra', courseId: () => '_2_1' }, location: { origin, pathname: OUT, search: '' } }), made = [];
  p.c.document.querySelector = () => null;
  p.c.document.createElement = () => { const f = frame(OUT); f.el.addEventListener = (t, fn) => { if (t === 'load') f.loaded = fn; }; made.push(f); return f.el; };
  p.api.openItem('_2_1', DOC);
  const it = p.c.frames.get('_2_1'); it.dirty = true;
  p.api.closeItem('_2_1', 'back');
  assert.equal(made.length, 1, 'the page outline gets a replacement while the item is retained');
  assert.equal(p.c.frames.get('_2_1'), it);
  made[0].loaded();
  assert.ok(p.c.spare.get('_2_1')[0].fresh);
});


test('turning Keep Course Content off releases hidden refresh copies', () => {
  const { p, base, it } = opened();
  p.setKey(1); p.api.onItemPop({ stopImmediatePropagation() {} });
  assert.ok(it.fresh);
  p.c.prefs.keep = false; p.api.stopKeeping();
  assert.equal(it.el.isConnected, false);
  assert.equal(p.c.frames.get('_2_1'), base);
  assert.equal(p.c.spare.get('_2_1')?.includes(it), false);
});

test('the fresh outline swaps in only once its own page has stopped changing since it was told it shows (Glaze\'s marks on it in)', () => {
  const { p, base, it } = opened();
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  p.setKey(1);
  p.api.onItemPop({ stopImmediatePropagation() {} });
  const fr = it.fresh;
  it.doc.location.pathname = OUT;
  p.api.standby = null;
  fr.asked = 2000; p.tick(1050); // asked at 2000; now 2050
  fr.changed = 2040; // its page changed just after being told
  msg(p, it, { gzCtab: 'drawn', hid: 0 });
  assert.equal(p.c.frames.get('_2_1'), base, 'not while it changes');
  assert.ok(p.timers.length, 'tried again shortly');
  p.tick(400);
  while (p.timers.length && p.c.frames.get('_2_1') === base) p.step();
  assert.equal(p.c.frames.get('_2_1'), it, 'swapped once quiet');
});
