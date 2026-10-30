// The sidebar with course tabs: only the document on screen (the page, or the tab's frame over it) draws, watches or
// changes the sidebar; a frame's changes go through the page around it (features/coursetabs.js 'sidebar'), which sends
// them only for its frame on screen, signed in as the page is, and answers that frame alone. features/sidebar.js on the
// captured Canvas pages as stand-in DOM, the worker's real changes (lib/sidebar.js), one storage shared by every document.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const L = require('../lib/coursetabs.js');
const S = require('../lib/sidebar.js');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const source = read('features/coursetabs.js');
const part = (a, b) => { const i = source.indexOf(a); assert.ok(i >= 0, a); return source.slice(i, source.indexOf(b, i)); };
const O = 'https://board.instructure.com';
const KEY = S.key('canvas', O, '3');

// ---- the page around the frames: its relay and its message handler, as they are in features/coursetabs.js ----------
const RELAY = part('  let told = null;', '  let movedTimer = 0;');
const HANDLER = part("  if (!framed && !preview) addEventListener('message'", "  // In a tab's frame on Ultra");
const topPage = ({ site = 'canvas', who = '3', replies = [], lib = true } = {}) => {
  const posts = [], sent = [], held = [];
  let listen, watcher = null;
  const host = { id: 'gz-ctabs-frames' };
  const frameOf = (name, uid = who) => {
    const doc = { name, body: {}, location: { origin: site === 'canvas' ? O : 'https://bb.school.test', pathname: site === 'canvas' ? `/courses/${name}` : `/ultra/courses/${name}`, search: '' } };
    const win = { postMessage: (m, o) => posts.push({ to: name, m: structuredClone(m), o }) };
    const events = new Map();
    const el = { contentWindow: win, contentDocument: doc, parentNode: host, isConnected: true, inert: false, style: {},
      addEventListener: (type, f) => events.set(type, f), removeEventListener: (type, f) => { if (events.get(type) === f) events.delete(type); }, fire: (type) => events.get(type)?.() };
    return { el, uid, accountDoc: doc, ready: true, name };
  };
  const nav = { inert: false, tagName: 'NAV' }, app = { inert: false, tagName: 'DIV' }, script = { inert: false, tagName: 'SCRIPT' };
  const frames = new Map(site === 'canvas' ? [['25', frameOf('25')], ['26', frameOf('26')]] : [['_25_1', frameOf('_25_1')], ['_26_1', frameOf('_26_1')]]);
  const spare = new Map([['25', [frameOf('25-before')]]]);
  const next = new Map([['26', frameOf('26-next')]]);
  const c = {
    PAGE: 'page', L, framed: '', preview: false, on: true, signedOut: false, pic: null, who, showing: site === 'canvas' ? '25' : '_25_1', frames, spare, next, host, popping: false, keepPage() {},
    location: { origin: site === 'canvas' ? O : 'https://bb.school.test' }, ctx: { site, need: async () => { if (lib) c.GZ_SIDEBAR = S; } },
    GZ_SIDEBAR: lib ? S : undefined, Number, JSON, Promise, structuredClone, setTimeout, clearTimeout,
    document: { body: { children: [nav, app, host, script] } },
    MutationObserver: class { constructor(f) { this.f = f; watcher = this; } observe() { this.on = true; } disconnect() { this.on = false; } },
    addEventListener: (t, f) => { listen = f; },
    send() {}, revoke() {}, visit() {}, later() {}, watch() {},
    chrome: { runtime: { lastError: undefined, sendMessage: (m, cb) => { sent.push(structuredClone(m)); const r = replies.length ? replies.shift() : { ok: true, rec: S.clean({ mig: 1, open: false }) }; if (r === 'hold') held.push(cb); else cb(r); } } },
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(`${part("  const pageable = ", "  // Validate the page")}\n${RELAY}\n${HANDLER}`, c);
  const post = (f, data, origin = c.location.origin) => listen({ origin, source: f.el.contentWindow, data });
  const ask = (over = {}) => ({ gzCtab: 'sidebar', key: S.key(site === 'canvas' ? 'canvas' : 'ultra', c.location.origin, site === 'canvas' ? '3' : '_3_1'), ops: [{ op: 'open', v: false }], gen: 'doc.1', n: 1, ...over });
  return { c, posts, sent, held, frames, spare, next, post, ask, nav, app, script, watcher: () => watcher };
};
const acks = (p) => p.posts.filter((x) => x.m.gzCtab === 'sidebar:ack');

test('the page sends a frame\'s sidebar change only for its frame on screen, and answers that frame alone with the gen it asked with', async () => {
  const p = topPage();
  p.post(p.frames.get('25'), p.ask());
  await settle();
  assert.deepEqual(p.sent, [{ type: 'glaze:sidebar', key: KEY, ops: [{ op: 'open', v: false }] }], 'from the top frame, the key and ops only');
  assert.deepEqual(acks(p).map((x) => [x.to, x.m.n, x.m.gen, x.m.ok, x.o]), [['25', 1, 'doc.1', true, O]]);
  assert.equal(acks(p)[0].m.rec.open, false, 'the stored record goes back with it');
  assert.ok(p.posts.every((x) => x.to === '25'), 'no other frame hears of it');
});

test('a hidden, kept, loading or replaced frame, another account, origin or site, and bad or oversized ops send nothing', async (t) => {
  const cases = [
    ['hidden frame', (p) => p.post(p.frames.get('26'), p.ask())],
    ['kept earlier page (spare)', (p) => p.post(p.spare.get('25')[0], p.ask())],
    ['next page loading', (p) => p.post(p.next.get('26'), p.ask())],
    ['not ready', (p) => { p.frames.get('25').ready = false; p.post(p.frames.get('25'), p.ask()); }],
    ['inert frame', (p) => { p.frames.get('25').el.inert = true; p.post(p.frames.get('25'), p.ask()); }],
    ['invisible frame', (p) => { p.frames.get('25').el.style.visibility = 'hidden'; p.post(p.frames.get('25'), p.ask()); }],
    ['display-none frame', (p) => { p.frames.get('25').el.style.display = 'none'; p.post(p.frames.get('25'), p.ask()); }],
    ['detached frame', (p) => { p.frames.get('25').el.isConnected = false; p.post(p.frames.get('25'), p.ask()); }],
    ['frame outside host', (p) => { p.frames.get('25').el.parentNode = {}; p.post(p.frames.get('25'), p.ask()); }],
    ['login in page frame', (p) => { const f = p.frames.get('25'); p.frames.set('page', f); p.frames.delete('25'); p.c.showing = 'page'; f.el.contentDocument.location.pathname = '/login'; p.post(f, p.ask()); }],
    ['account page in same document', (p) => { p.frames.get('25').el.contentDocument.location.pathname = '/profile/settings'; p.post(p.frames.get('25'), p.ask()); }],
    ['frame signed in as someone else', (p) => { p.frames.get('25').uid = '4'; p.post(p.frames.get('25'), p.ask()); }],
    ['key for another account', (p) => p.post(p.frames.get('25'), p.ask({ key: S.key('canvas', O, '4') }))],
    ['key for another origin', (p) => p.post(p.frames.get('25'), p.ask({ key: S.key('canvas', 'https://other.instructure.com', '3') }))],
    ['key for another LMS', (p) => p.post(p.frames.get('25'), p.ask({ key: S.key('ultra', O, '_3_1') }))],
    ['unknown op', (p) => p.post(p.frames.get('25'), p.ask({ ops: [{ op: 'eval', code: '1' }] }))],
    ['no ops', (p) => p.post(p.frames.get('25'), p.ask({ ops: [] }))],
    ['too many ops', (p) => p.post(p.frames.get('25'), p.ask({ ops: Array.from({ length: S.OPS_MAX + 1 }, () => ({ op: 'open', v: true })) }))],
    ['oversized ops', (p) => p.post(p.frames.get('25'), p.ask({ ops: [{ op: 'open', v: true, pad: 'x'.repeat(9000) }] }))],
    ['oversized UTF-8 ops', (p) => p.post(p.frames.get('25'), p.ask({ ops: [{ op: 'open', v: true, pad: 'é'.repeat(4200) }] }))],
    ['bad gen', (p) => p.post(p.frames.get('25'), p.ask({ gen: 'x'.repeat(65) }))],
    ['replaced document', (p) => { p.frames.get('25').el.contentDocument = { name: 'new' }; p.post(p.frames.get('25'), p.ask()); }],
    ['hidden after asking, before the worker is asked', (p) => { p.c.GZ_SIDEBAR = undefined; p.post(p.frames.get('25'), p.ask()); p.c.showing = '26'; }],
  ];
  for (const [label, run] of cases) await t.test(label, async () => {
    const p = topPage();
    run(p);
    await settle();
    assert.deepEqual(p.sent, [], `${label}: nothing sent`);
    assert.ok(acks(p).every((x) => x.m.ok === false && !('rec' in x.m)), `${label}: refused, with no record`);
  });
  // Another origin's message, or one without a request number, is not answered at all.
  for (const run of [(p) => p.post(p.frames.get('25'), p.ask(), 'https://evil.test'), (p) => p.post(p.frames.get('25'), p.ask({ n: undefined }))]) {
    const p = topPage();
    run(p);
    await settle();
    assert.deepEqual([p.sent, p.posts], [[], []]);
  }
});

test('an account message cannot authorize a same-origin account page', async () => {
  const p = topPage(), f = p.frames.get('25');
  f.el.contentDocument = { body: {}, location: { origin: O, pathname: '/login', search: '' } };
  p.post(f, { gzCtab: 'account', uid: '3' });
  f.ready = true;
  p.post(f, p.ask()); await settle();
  assert.deepEqual(p.sent, [], 'a forged same-account message cannot make a login page an owned course');
});

test('a deferred relay request remains bound to the exact document that asked', async () => {
  const x = topPage(), g = x.frames.get('25');
  x.c.GZ_SIDEBAR = undefined;
  x.post(g, x.ask());
  const replacement = { body: {}, location: { origin: O, pathname: '/courses/25', search: '' } };
  g.el.contentDocument = replacement; g.accountDoc = replacement;
  await settle();
  assert.deepEqual(x.sent, [], 'an asynchronous request is bound to the document that asked');
});

test('Ultra: the same relay, its own key shape; the page\'s own account check still runs in the worker', async () => {
  const p = topPage({ site: 'ultra', who: '_3_1' });
  for (const f of p.frames.values()) f.uid = '_3_1';
  p.post(p.frames.get('_25_1'), p.ask());
  await settle();
  assert.equal(p.sent.length, 1);
  assert.equal(p.sent[0].key, S.key('ultra', 'https://bb.school.test', '_3_1'));
  assert.ok(!('gen' in p.sent[0]) && !('n' in p.sent[0]), 'the worker gets the change, nothing of the frame');
});

test('reset uses the same relay allowlist and account isolation on both sites', async () => {
  for (const site of ['canvas', 'ultra']) {
    const p = topPage({ site, who: site === 'canvas' ? '3' : '_3_1' });
    const visible = site === 'canvas' ? '25' : '_25_1', hidden = site === 'canvas' ? '26' : '_26_1';
    p.post(p.frames.get(hidden), p.ask({ ops: [{ op: 'reset' }] }));
    p.post(p.frames.get(visible), p.ask({ ops: [{ op: 'reset' }], key: S.key(site, p.c.location.origin, site === 'canvas' ? '4' : '_4_1') }));
    await settle();
    assert.equal(p.sent.length, 0, 'hidden and wrong-account resets are refused');
    p.post(p.frames.get(visible), p.ask({ ops: [{ op: 'reset' }] }));
    await settle();
    assert.deepEqual(p.sent, [{ type: 'glaze:sidebar', key: p.ask().key, ops: [{ op: 'reset' }] }]);
  }
});

test('an accepted change answered after the switch still reaches the frame that asked, never the one now on screen', async () => {
  const p = topPage({ replies: ['hold'] });
  p.post(p.frames.get('25'), p.ask({ n: 7, gen: 'a.3' }));
  await settle();
  p.c.showing = '26';
  p.held.shift()({ ok: true, rec: S.clean({ mig: 1 }) });
  await settle();
  assert.deepEqual(acks(p).map((x) => [x.to, x.m.n, x.m.gen, x.m.ok]), [['25', 7, 'a.3', true]]);
});

test('a frame\'s open drawer makes the page around it inert until it closes, or the frame is hidden or goes', () => {
  const p = topPage();
  p.post(p.frames.get('26'), { gzCtab: 'drawer', on: true });
  assert.equal(p.nav.inert || p.app.inert, false, 'a hidden frame cannot');
  p.post(p.frames.get('25'), { gzCtab: 'drawer', on: true });
  assert.deepEqual([p.nav.inert, p.app.inert, p.script.inert], [true, true, false], 'everything but the frames');
  p.post(p.frames.get('25'), { gzCtab: 'drawer', on: false });
  assert.deepEqual([p.nav.inert, p.app.inert], [false, false]);
  // Hidden by anything (another tab picked: made inert), the page comes back.
  p.post(p.frames.get('25'), { gzCtab: 'drawer', on: true });
  p.frames.get('25').el.inert = true;
  p.watcher().f([]);
  assert.deepEqual([p.nav.inert, p.app.inert, p.watcher().on], [false, false, false]);
});

test('a drawer lock releases when its visible iframe loads a replacement document', () => {
  const p = topPage(), f = p.frames.get('25');
  p.post(f, { gzCtab: 'drawer', on: true });
  assert.equal(p.nav.inert, true);
  f.el.contentDocument = { name: 'replacement' };
  f.el.fire('load');
  assert.deepEqual([p.nav.inert, p.app.inert], [false, false]);
});

test('a sidebar reply is dropped when the iframe now contains a replacement document', async () => {
  const p = topPage({ replies: ['hold'] }), f = p.frames.get('25');
  p.post(f, p.ask()); await settle();
  f.el.contentDocument = { name: 'replacement' };
  p.held.shift()({ ok: true, rec: S.clean({ mig: 1 }) });
  assert.deepEqual(acks(p), [], 'the new document never hears the old document response');
});

test('timer operations use the same visible owned-document boundary and fixed worker operation', async () => {
  const p = topPage({ replies: [{ ok: true, timer: { run: true, end: 2000 }, advanced: 1000 }] });
  const ask = { gzCtab: 'timer', op: 'advance', n: 8, gen: 'timer-document' };
  p.post(p.frames.get('25'), ask); await settle();
  assert.deepEqual(p.sent, [{ type: 'glaze:widgetTimer', op: 'advance' }]);
  assert.deepEqual(p.posts[0].m, { gzCtab: 'timer:ack', n: 8, gen: ask.gen, ok: true, timer: { run: true, end: 2000 }, advanced: 1000 });
  for (const mutate of [
    (x) => x.frames.get('25').ready = false,
    (x) => x.frames.get('25').el.inert = true,
    (x) => x.frames.get('25').uid = '4',
    (x) => x.frames.get('25').el.contentDocument.location.pathname = '/login',
    (x) => x.c.showing = '26',
  ]) { const x = topPage(); mutate(x); x.post(x.frames.get('25'), ask); await settle(); assert.deepEqual(x.sent, []); }
  for (const op of ['set', 'eval', null, {}, 'advance '.repeat(1000)]) { const x = topPage(); x.post(x.frames.get('25'), { ...ask, op }); await settle(); assert.deepEqual(x.sent, []); }
});

// ---- a frame's side: asking, and the answers it takes ----------------------------------------------------------------
const frameSide = () => {
  const out = [], timers = [];
  const c = { framed: '25', showing: '', toTop: (op, m) => out.push([op, structuredClone(m)]), Number, Promise, Map,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {} };
  vm.createContext(c);
  const f = vm.runInContext(`${RELAY}\n({ askSidebar, askTimer, acked, visible, tell: (v) => { told = v; } })`, c);
  return { ...f, out, timers };
};

test('a frame asks only while on screen, and takes only the answer to its own question with its own gen', async () => {
  const f = frameSide();
  assert.equal(await f.askSidebar(KEY, [{ op: 'open', v: true }], 'd.1'), null, 'not told it is on screen yet: hidden');
  assert.equal(f.visible(), false);
  f.tell(false);
  assert.equal(await f.askSidebar(KEY, [{ op: 'open', v: true }], 'd.1'), null);
  assert.deepEqual(f.out, []);
  f.tell(true);
  let got;
  f.askSidebar(KEY, [{ op: 'open', v: true }], 'd.1').then((r) => { got = r; });
  assert.deepEqual(f.out, [['sidebar', { key: KEY, ops: [{ op: 'open', v: true }], gen: 'd.1', n: 1 }]]);
  f.acked({ n: 2, gen: 'd.1', ok: true });
  f.acked({ n: 1, gen: 'd.0', ok: true, rec: { forged: true } });
  await settle();
  assert.equal(got, undefined, 'another question\'s, or a stale gen\'s, answer is dropped');
  f.acked({ n: 1, gen: 'd.1', ok: true, rec: { v: 1 } });
  await settle();
  assert.deepEqual({ ...got }, { ok: true, gen: 'd.1', rec: { v: 1 } });
  // A question never answered gives up (the worker or the page went).
  let late = 'pending';
  f.askSidebar(KEY, [{ op: 'open', v: false }], 'd.1').then((r) => { late = r; });
  f.timers.at(-1)();
  await settle();
  assert.equal(late, null);
  f.acked({ n: 2, gen: 'd.1', ok: true });
  assert.equal(late, null, 'and its answer, if it comes after, changes nothing');
});

test('a frame matches timer replies to the request kind and document generation', async () => {
  const f = frameSide(); f.tell(true);
  let got;
  f.askTimer('toggle').then((r) => { got = r; });
  const [op, ask] = f.out[0];
  assert.equal(op, 'timer');
  f.acked({ n: ask.n, gen: ask.gen, ok: true, rec: {} });
  f.acked({ n: ask.n, gen: 'previous-doc', ok: true, timer: {} }, 'timer');
  await settle(); assert.equal(got, undefined);
  f.acked({ n: ask.n, gen: ask.gen, ok: true, timer: { end: 2000 }, advanced: 1000 }, 'timer');
  await settle(); assert.deepEqual({ ...got, timer: { ...got.timer } }, { ok: true, timer: { end: 2000 }, advanced: 1000 });
  f.tell(false); assert.equal(await f.askTimer('reset'), null);
  f.tell(true); assert.equal(await f.askTimer('set'), null);
});

test('a fresh tab responds in its first 400ms; only a real drag briefly suppresses clicks', () => {
  const hits = [], el = { dataset: { courseId: '25' } };
  let now = 150;
  const c = { performance: { now: () => now }, tabOf: () => el, visit: (id) => hits.push(id), shut() {}, pinTab() {} };
  vm.createContext(c);
  const click = vm.runInContext(`${part('  let dragged = ', '  // A tablist:')}
({ onClick, draggedAt: (n) => { dragged = n; } })`, c);
  const e = { type: 'click', button: 0, target: { closest: () => false }, preventDefault() {}, stopPropagation() {} };
  click.onClick(e);
  assert.deepEqual(hits, ['25'], 'no drag occurred: the first click must open the tab');
  click.draggedAt(160); now = 170;
  click.onClick(e);
  assert.deepEqual(hits, ['25'], 'the click following a drag is suppressed');
  now = 600; click.onClick(e);
  assert.deepEqual(hits, ['25', '25']);
});

// ---- documents: the page and its tabs' frames, each running features/sidebar.js ----------------------------------------
// world(): one storage.local and one worker queue; doc({ frame }) a document; show(name) the course tabs' switch.
const world = () => {
  const store = {}, listeners = new Set(), docs = [];
  let queue = Promise.resolve();
  const fire = (v) => { for (const f of [...listeners]) f(Object.fromEntries(Object.keys(v).map((k) => [k, { newValue: structuredClone(v[k]) }])), 'local'); };
  const area = {
    get: async (ks) => Object.fromEntries([ks].flat().filter((k) => k in store).map((k) => [k, structuredClone(store[k])])),
    set: async (v) => { Object.assign(store, structuredClone(v)); setImmediate(() => fire(v)); return true; },
  };
  const settings = () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, todo: true, sidebar: true, drafts: true } });
  const sync = { get: async () => ({ enhance: settings().enhance }) };
  const worker = (m) => (queue = queue.then(() => S.change(structuredClone(m), area, sync)));
  let shown = 'top';
  const doc = ({ name = 'top', fixture = 'canvas-course-home.html', where = '/courses/25', hold = false } = {}) => {
    const d = { activeElement: null };
    d.root = new El('html', d);
    d.body = parse(read(`test/fixtures/${fixture}`), d);
    const framed = name !== 'top';
    const sent = [], asked = [], drawers = [], winListeners = [], observers = [], held = [];
    let frames = 0;
    const c = {
      console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, structuredClone,
      setTimeout: () => 0, clearTimeout() {}, setImmediate,
      addEventListener: (type, f) => winListeners.push({ type, f }), removeEventListener: (type, f) => { const i = winListeners.findIndex((l) => l.type === type && l.f === f); if (i >= 0) winListeners.splice(i, 1); },
      innerWidth: 1600, innerHeight: 900, location: { origin: O, pathname: where },
      document: d, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
      MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } },
      requestAnimationFrame: (f) => { frames++; f(); return 1; }, cancelAnimationFrame() {},
      GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: require('../lib/widgets.js'), GZ_SIDEBAR: S,
      // features/coursetabs.js's part: which document is on screen, and the relay a frame's changes go through.
      GZ_CTABS: {
        visible: () => shown === name,
        sidebar: (key, ops, gen) => { asked.push({ key, ops, gen }); if (shown !== name) return Promise.resolve(null); const p = worker({ key, ops }).then((r) => ({ ...r, gen })); return hold ? new Promise((res) => held.push(() => p.then(res))) : p; },
        drawer: (v) => drawers.push(v),
      },
      GZ_CTX: {
        site: 'canvas', tabFrame: framed ? name : '', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n]), locale: () => 'en', settings,
        account: async () => '3', canvasCourseId: () => c.location.pathname.match(/^\/courses\/(\d+)/)?.[1] || '', need: async () => {},
      },
      chrome: {
        runtime: { id: 'glaze', lastError: undefined, sendMessage: (m, cb) => { sent.push(structuredClone(m)); (m.type === 'glaze:sidebar' ? worker(m) : Promise.resolve({ ok: true })).then((r) => cb?.(structuredClone(r))); } },
        storage: { local: { get: (ks, cb) => area.get(ks).then(cb), set: (v, cb) => { area.set(v).then(() => cb?.()); } },
          sync: { get: (k, cb) => cb({}) }, onChanged: { addListener: (f) => listeners.add(f), removeListener: (f) => listeners.delete(f) } },
      },
    };
    if (framed) { c.top = {}; c.window = c; }
    d.boxOf = (e) => (e.id === 'main' || e.id === 'wrapper' ? { left: 84, top: 0, width: 1516, height: 900 } : e.id === 'right-side' ? { left: 1248, top: 0, width: 300, height: 300 } : null);
    Object.assign(d, {
      documentElement: d.root, visibilityState: 'visible', createElement: (tag) => new El(tag, d), createTextNode: (textContent) => ({ textContent }),
      querySelector: (s) => d.root.querySelector(s), querySelectorAll: (s) => d.root.querySelectorAll(s), getElementById: (id) => d.root.all().find((e) => e.id === id) || null,
      addEventListener() {}, removeEventListener() {},
    });
    c.globalThis = c; vm.createContext(c);
    const side = vm.runInContext(read('features/sidebar.js'), c);
    const x = { name, c, d, side, sent, asked, drawers, held, observers, winListeners,
      frames: () => frames,
      pass: async () => { side.sync(true); await settle(); },
      resize: async () => { for (const l of winListeners.filter((y) => y.type === 'resize')) l.f(); await settle(); },
      host: () => d.root.all().find((e) => e.dataset?.gzSidebarHost),
      awake: () => !side.asleep() && !!side.host(),
      watching: () => observers.some((o) => o.on),
    };
    docs.push(x);
    return x;
  };
  // The switch: the page's attribute and the frames' answers come in some order, each document told (cover).
  const show = (name, order = docs) => { shown = name; for (const x of order) { x.d.root.toggleAttribute?.('data-gz-ctab-framed', x.name !== name); x.side.cover(); } };
  return { store, docs, doc, show, shown: () => shown, record: (r) => { store[KEY] = S.clean({ mig: 1, ...r }); } };
};

test('only the document on screen has a working dock: a frame waits hidden until told, the page under it sleeps', async () => {
  const w = world();
  w.record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
  const top = w.doc(), a = w.doc({ name: '25' });
  await top.pass(); await a.pass();
  assert.equal(top.awake(), true);
  assert.equal(a.awake(), false, 'a frame not yet told it is on screen draws nothing');
  assert.equal(a.host(), undefined, 'and dresses no column');
  assert.equal(a.watching(), false);
  w.show('25'); await settle();
  assert.deepEqual([top.awake(), a.awake()], [false, true]);
  assert.equal(top.watching(), false, 'the covered page watches nothing');
  assert.equal(a.host().dataset.gzSidebarHost, 'native');
  w.show('top'); await settle();
  assert.deepEqual([top.awake(), a.awake()], [true, false]);
  assert.equal(a.watching(), false);
});

test('rapid switching and Back/Forward leave exactly one working dock, whatever order the documents hear it in', async () => {
  const w = world();
  w.record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
  const docs = [w.doc(), w.doc({ name: '25' }), w.doc({ name: '26', where: '/courses/26/assignments/9', fixture: 'canvas-assignment-submit.html' }), w.doc({ name: 'page', where: '/', fixture: 'canvas-dashboard-cards.html' })];
  for (const x of docs) await x.pass();
  const one = (label) => {
    const live = docs.filter((x) => x.awake()).map((x) => x.name);
    assert.deepEqual(live, [w.shown()], label);
    for (const x of docs) if (x.name !== w.shown()) assert.equal(x.watching(), false, `${label}: ${x.name} watches nothing`);
  };
  one('start');
  // Back and Forward through the tabs' history, settling each time.
  for (const to of ['25', '26', '25', 'top', '26', 'page', 'top']) { w.show(to); await settle(); one(`to ${to}`); }
  // Rapid: several picks before anything settles, heard in reverse and in shuffled orders.
  w.show('25', [...docs].reverse()); w.show('26'); w.show('page', [docs[2], docs[0], docs[3], docs[1]]); w.show('25');
  await settle(); one('after a burst');
  w.show('top', [...docs].reverse()); w.show('26', [docs[1], docs[3], docs[0], docs[2]]);
  await settle(); one('after another burst');
});

test('a covered or hidden document does no sidebar work: no layout on resize, no reaction to its page changing, no changes', async () => {
  const w = world();
  w.record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
  const top = w.doc(), a = w.doc({ name: '25' });
  await top.pass(); await a.pass();
  w.show('25'); await settle();
  const before = { frames: top.frames(), mode: top.d.root.dataset.gzSidebar, w: top.d.root.style.getPropertyValue('--gz-sidebar-w') };
  top.c.innerWidth = 700;
  await top.resize();
  for (const o of top.observers) o.f([{ target: top.d.getElementById('right-side'), addedNodes: [{}], removedNodes: [] }]);
  await top.pass();
  assert.equal(top.frames(), before.frames, 'no frame asked for');
  assert.equal(top.d.root.dataset.gzSidebar, before.mode, 'the layout left as it was');
  assert.equal(await top.side.op([{ op: 'open', v: false }]), false, 'a covered document changes nothing');
  assert.equal(top.sent.filter((m) => m.type === 'glaze:sidebar').length, 0);
  // A hidden frame neither.
  w.show('top'); await settle();
  assert.equal(await a.side.op([{ op: 'open', v: false }]), false);
  assert.deepEqual(a.asked, []);
  // Back on screen: laid out for the window it has now.
  w.show('25'); w.show('top'); await settle();
  assert.equal(top.d.root.dataset.gzSidebar, 'drawer', 'the narrow window seen once awake');
});

test('a frame\'s changes go through the page around it with its gen, and land in the one stored record', async () => {
  const w = world();
  w.record({});
  const top = w.doc(), a = w.doc({ name: '25' });
  await top.pass(); await a.pass();
  w.show('25'); await settle();
  assert.equal(await a.side.op([{ op: 'dock', id: 'timer' }]), true);
  await settle();
  assert.equal(a.sent.filter((m) => m.type === 'glaze:sidebar').length, 0, 'never to the worker from the frame');
  assert.equal(a.asked.length, 1);
  assert.equal(a.asked[0].gen, a.side.context().gen);
  assert.notEqual(a.side.context().gen.split('.')[0], top.side.context().gen.split('.')[0], 'each document its own gen');
  assert.equal(w.store[KEY].dest.timer, 'dock');
  // The page, asleep under the frame, still keeps the record (storage), and shows it once on screen.
  assert.equal(top.side.rec().dest.timer, 'dock');
});

test('a stale answer says nothing on the page it no longer belongs to; answers out of order still end at what is stored', async () => {
  const w = world();
  w.record({});
  const a = w.doc({ name: '25', hold: true });
  w.show('25');
  await a.pass();
  // An answer that comes back after the route moved on: no word of it here, but what is stored is adopted.
  const first = a.side.op([{ op: 'width', px: 400 }]);
  const g = a.side.context().gen;
  a.c.location.pathname = '/courses/26';
  await a.pass();
  assert.equal(a.side.context().courseId, '26');
  assert.notEqual(a.side.context().gen, g);
  a.held.shift()();
  assert.equal(await first, true);
  await settle();
  assert.equal(a.side.rec().width, 400, 'the committed record adopted');
  // Two in flight, answered in reverse: the record shown is the stored one after both.
  const one = a.side.op([{ op: 'width', px: 300 }]), two = a.side.op([{ op: 'open', v: false }]);
  const [h1, h2] = a.held.splice(0);
  h2(); await settle();
  h1(); await Promise.all([one, two]); await settle();
  assert.deepEqual([a.side.rec().width, a.side.rec().open], [300, false]);
  assert.deepEqual([w.store[KEY].width, w.store[KEY].open], [300, false]);
  // A refusal after the page moved on is not reported on the new page.
  const note = () => a.d.root.all().find((e) => e.className === 'gz-sb-note');
  a.c.GZ_CTABS.sidebar = () => new Promise((res) => a.held.push(() => res({ ok: false })));
  const third = a.side.op([{ op: 'open', v: true }]);
  a.c.location.pathname = '/courses/25';
  await a.pass();
  a.held.shift()();
  assert.equal(await third, false);
  await settle();
  assert.equal(note().textContent, '', 'no "Couldn\'t save" on the page that did not ask');
  assert.equal(a.side.rec().open, false, 'what is stored shows');
});

test('a drawer in a frame tells the page around it, and closes (telling it) when the frame is hidden', async () => {
  const w = world();
  w.record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
  const top = w.doc(), a = w.doc({ name: '25' });
  await top.pass(); await a.pass();
  w.show('25'); await settle();
  a.c.innerWidth = 700;
  await a.resize();
  assert.equal(a.d.root.dataset.gzSidebar, 'drawer');
  const launch = a.d.getElementById('gz-sb-launch');
  launch.dispatchEvent({ type: 'click', target: launch });
  assert.equal(a.drawers.at(-1), true, 'opened: the page around it is inert');
  w.show('top'); await settle();
  assert.equal(a.drawers.at(-1), false, 'hidden: closed, and the page around it told');
  assert.equal(top.drawers.length, 0, 'the page itself never asks itself');
});
