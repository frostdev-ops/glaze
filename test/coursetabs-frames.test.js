// Course tabs' live frames (features/coursetabs.js): each picked tab runs as a page of its own in a frame named
// gz-ctab:<course>, hidden while another is shown; the strip in a frame sends its picks to the page around it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
const L = require(path.join(root, 'lib/coursetabs.js'));
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://bb.school.test';

const loadingFrame = () => {
  let now = 1000, doc = { location: { href: 'about:blank', pathname: 'blank' }, body: { childElementCount: 0 } };
  const timers = [], navigations = [], notices = [];
  const f = { url: '/ultra/courses/_2_1/grades', ready: false, dirty: false, el: { style: {}, get contentDocument() { return doc; }, set src(v) { navigations.push(v); } } };
  const frames = new Map([['_2_1', f]]);
  const c = vm.createContext({ L, ctx: { site: 'ultra' }, frames, showing: '_2_1', location: { origin }, performance: { now: () => now },
    MutationObserver: class { observe() {} disconnect() {} }, loading: () => false, shown: (el) => !!el,
    unpicture() {}, later() {}, clearSlow() {}, slowFrame: () => notices.push('slow'), t: (s) => s,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
  });
  const watch = vm.runInContext(part('  const watch = ', '  const open = ') + '\nwatch;', c);
  return { f, frames, navigations, notices, watch: () => watch('_2_1', f),
    step(ms) { now += ms; timers.shift()?.fn(); },
    document(d) { doc = d; },
    built() { return { location: { href: `${origin}${f.url}`, pathname: f.url }, body: { childElementCount: 1 }, documentElement: { matches: () => false }, querySelector: (s) => s === '.bb-course-navigation' ? {} : null, addEventListener() {} }; },
  };
};

test('a blank course frame is retried once and never declared ready by its timeout', () => {
  const p = loadingFrame(); p.watch(); p.step(8100);
  assert.equal(p.f.ready, false, 'elapsed time cannot turn about:blank into loaded course content');
  assert.deepEqual(p.navigations, [`${origin}${p.f.url}`], 'retry the initial blank document once');
  p.step(8100); p.step(8100);
  assert.equal(p.navigations.length, 1, 'a persistent failure must not cause a navigation loop');
  assert.equal(p.f.ready, false);
  assert.equal(p.f.slow, true);
  assert.equal(p.notices.length, 1, 'explain the slow load instead of silently presenting a blank page');
  p.document(p.built()); p.step(1000); p.step(301);
  assert.equal(p.f.ready, true, 'a late document can still become ready once it actually renders');
});

test('slow rendered course documents and edited frames are never automatically reloaded', () => {
  for (const edited of [false, true]) {
    const p = loadingFrame();
    if (edited) p.f.dirty = true;
    else { const d = p.built(); d.querySelector = () => null; p.document(d); }
    p.watch(); p.step(8100);
    assert.equal(p.f.ready, false);
    assert.deepEqual(p.navigations, [], 'preserve native loading state and any edits');
  }
});

test('selecting a timed-out course again retries only an untouched frame', () => {
  for (const dirty of [false, true]) {
    const dropped = [], shown = [];
    const c = vm.createContext({ framed: '', preview: false, tabs: [{ cid: '_2_1' }], save() {}, Date,
      frames: new Map([['_2_1', { slow: true, ready: false, dirty }]]), showing: '_2_1',
      drop: (...args) => dropped.push(args), show: (cid) => shown.push(cid), ctx: { courseId: () => '_1_1' },
    });
    vm.runInContext(part('  const visit = (cid) => {', "  if (!framed && !preview) addEventListener('message'") + "\nvisit('_2_1');", c);
    assert.equal(dropped.length, dirty ? 0 : 1);
    assert.equal(c.showing, dirty ? '_2_1' : '', 'an edited frame keeps its existing document');
    assert.deepEqual(shown, ['_2_1']);
  }
});

test('a delayed snapshot cannot cover a stalled or replaced frame', async () => {
  for (const state of ['slow', 'replaced']) {
    let resolve, created = 0;
    const f = { url: '/ultra/courses/_2_1/outline', ready: false, el: { style: {} } };
    const frames = new Map([['_2_1', f]]);
    const c = vm.createContext({ showing: '_2_1', frames, pic: null, snaps: new Map(), unpicture() {}, keep() {},
      fits: () => true, send: () => new Promise((r) => { resolve = r; }),
      document: { createElement() { created++; throw new Error('stale snapshot'); } },
    });
    vm.runInContext(part('  const picture = ', '  const unpicture = ') + "\npicture('_2_1', f);", Object.assign(c, { f }));
    if (state === 'slow') f.slow = true; else frames.set('_2_1', {});
    resolve({ snap: { cid: '_2_1' } });
    await new Promise(setImmediate);
    assert.equal(created, 0, 'the recovery surface or new document must remain uncovered');
  }
});

test('the bridge takes picks only from this page\'s own frames, on this origin, and only Ultra addresses to go to', () => {
  let listen;
  const mine = {}, theirs = {}, did = [];
  vm.runInNewContext(part("  if (!framed && !preview) addEventListener('message'", '  // Ultra routes without reloading'), {
    L, ctx: { site: 'ultra' }, framed: '', preview: false, on: true, location: { origin }, addEventListener: (t, f) => { listen = f; },
    frames: new Map([['_2_1', { el: { contentWindow: mine } }]]), showing: '_2_1',
    visit: (c) => did.push(['visit', c]), shut: (c, k) => did.push(['shut', c, k]), later: () => did.push(['later']),
    drop: (c) => did.push(['drop', c]), show: (c) => did.push(['show', c]), route: (u) => did.push(['route', u]),
  });
  const post = (data, source = mine, from = origin) => listen({ data, source, origin: from });
  post({ gzCtab: 'visit', cid: '_3_1' }, theirs);
  post({ gzCtab: 'visit', cid: '_3_1' }, mine, 'https://other.test');
  post({ gzCtab: 'visit', cid: 'x' });
  post({ gzCtab: 'away', url: 'https://other.test/' });
  assert.deepEqual(did, [], 'another window, another origin, a malformed course or an address off Ultra do nothing');
  post({ gzCtab: 'visit', cid: '_3_1' });
  post({ gzCtab: 'shut', cid: '_3_1', keys: true });
  post({ gzCtab: 'moved' });
  post({ gzCtab: 'away', url: '/ultra/course' });
  assert.deepEqual(did, [['visit', '_3_1'], ['shut', '_3_1', true], ['later'], ['drop', '_2_1'], ['show', ''], ['route', '/ultra/course']]);
});

test('a pick in a tab\'s frame goes to the page around it; on the page, its own course shows the page itself', () => {
  const sent = [], shown = [];
  const run = (framed, courseId) => vm.runInNewContext(part('  const visit = (cid) => {', "  if (!framed && !preview) addEventListener('message'") + '\nvisit;', {
    framed, preview: false, tabs: [{ cid: '_1_1' }, { cid: '_2_1' }], save() {}, Date, frames: new Map(), showing: '',
    toTop: (op, m) => sent.push([op, m.cid]), show: (c) => shown.push(c), ctx: { courseId: () => courseId },
  });
  run('_2_1', '_2_1')('_1_1');
  assert.deepEqual(sent, [['visit', '_1_1']]);
  assert.deepEqual(shown, []);
  const visit = run('', '_1_1');
  visit('_2_1'); visit('_1_1'); visit('_9_1');
  assert.deepEqual(shown, ['_2_1', ''], 'another course: its frame; this page\'s course: this page; no tab: nothing');
});

test('at most four frames stay running: the least recently shown go, never the one shown', async () => {
  const frame = (at) => ({ at, ready: true, el: { style: {}, inert: false, focus() {} } });
  const frames = new Map([['_1_1', frame(1)], ['_2_1', frame(5)], ['_4_1', frame(4)], ['_5_1', frame(2)]]);
  const dropped = [];
  const show = vm.runInNewContext(part('  const show = async (cid) => {', '  // A tab: its frame') + '\nshow;', {
    showTurn: 0, showing: '_2_1', shownFrom: '', shooting: null, on: true, frames, host: { toggleAttribute() {} }, strip: null, list: null,
    LIVE: 4, Date, Promise, setTimeout() {}, clearTimeout() {}, location: { pathname: '/ultra/course', search: '' }, document: { activeElement: null },
    html: { toggleAttribute() {} }, ctx: { scene() {} }, sessionStorage: { setItem() {}, removeItem() {} },
    open: (cid) => { const f = frame(6); frames.set(cid, f); return f; }, lay() {}, unpicture() {}, clearSlow() {}, slowFrame() {}, picture() {}, draw() {}, later() {}, drop: (k) => { dropped.push(k); frames.delete(k); },
  });
  await show('_3_1');
  assert.deepEqual(dropped, ['_1_1'], 'five frames, four kept: the one shown longest ago goes');
  assert.deepEqual([...frames.keys()].sort(), ['_2_1', '_3_1', '_4_1', '_5_1']);
  assert.equal(frames.get('_3_1').el.style.visibility, '', 'the shown frame is visible');
  assert.equal(frames.get('_2_1').el.style.visibility, 'hidden');
  assert.equal(frames.get('_2_1').el.inert, true, 'a hidden frame takes no input');
});

test('a hidden frame stays live however long it is hidden: no timer closes it', async () => {
  const frame = (at) => ({ at, ready: true, el: { style: {}, inert: false, focus() {} } });
  const frames = new Map([['_1_1', frame(1)], ['_2_1', frame(2)], ['_3_1', frame(3)]]);
  const timers = [];
  const show = vm.runInNewContext(part('  const show = async (cid) => {', '  // A tab: its frame') + '\nshow;', {
    showTurn: 0, showing: '', shownFrom: '', shooting: null, on: true, frames, host: { toggleAttribute() {} }, strip: null, list: null,
    LIVE: 4, Date, Promise, location: { pathname: '/ultra/course', search: '' }, document: { activeElement: null },
    setTimeout: (fn, ms) => timers.push(ms), clearTimeout() {},
    html: { toggleAttribute() {} }, ctx: { scene() {} }, sessionStorage: { setItem() {}, removeItem() {} },
    lay() {}, unpicture() {}, clearSlow() {}, slowFrame() {}, picture() {}, draw() {}, later() {}, drop() { throw new Error('nothing is dropped under the cap'); },
  });
  await show('_1_1');
  await show('_3_1');
  assert.deepEqual(timers, [], 'switching sets no timer on the hidden frames');
  assert.deepEqual([...frames.keys()], ['_1_1', '_2_1', '_3_1']);
});

// Exercise the real drop/show pair: a stubbed drop would hide a nested asynchronous show('').
const switching = () => {
  const frame = (dirty = false) => ({ at: 1, dirty, ready: true, el: { style: {}, focus() {}, remove() {} } });
  const frames = new Map([['_1_1', frame()], ['_2_1', frame(true)]]), timers = new Map();
  let n = 0;
  const context = vm.createContext({
    showTurn: 0, showing: '_1_1', shownFrom: '', shooting: null, on: true, frames,
    host: { toggleAttribute() {} }, strip: null, list: null, LIVE: 2, Date, Promise,
    location: { pathname: '/ultra/course', search: '' }, document: { activeElement: null },
    setTimeout: (fn, ms) => { timers.set(++n, { fn, ms }); return n; }, clearTimeout: (id) => timers.delete(id),
    html: { toggleAttribute() {} }, ctx: { scene() {} }, sessionStorage: { setItem() {}, removeItem() {} },
    open: (cid) => { const f = frame(); frames.set(cid, f); return f; },
    lay() {}, unpicture() {}, clearSlow() {}, slowFrame() {}, picture() {}, draw() {}, later() {},
  });
  const show = vm.runInContext(part('  const drop = ', '  // A frame is shown once')
    + part('  const show = async (cid) => {', '  // A tab: its frame') + '\nshow;', context);
  const fire = (id) => { const t = timers.get(id); timers.delete(id); t?.fn(); };
  return { frames, timers, context, show, fire };
};

test('evicting the current clean frame during a slow snapshot cannot later hide the replacement', async () => {
  const p = switching();
  p.context.shooting = new Promise(() => {});
  const shown = p.show('_3_1');
  p.fire([...p.timers].find(([, t]) => t.ms === 200)[0]);
  await shown;
  for (const [id, t] of [...p.timers]) if (t.ms === 200) p.fire(id);
  await new Promise(setImmediate);
  assert.equal(p.context.showing, '_3_1', 'eviction must not schedule a second show that uncovers the page');
  assert.ok(p.frames.has('_2_1'), 'the edited frame stays protected');
});

test('the 15-second guard counts successful pictures and follows the frame address', async () => {
  let current = '/ultra/courses/_2_1/outline', success = false, pictures = 0, n = 0;
  const timers = new Map();
  const later = vm.runInNewContext(part('  let capTimer = ', '  // Leaving through Ultra') + '\nlater;', {
    showing: '_2_1', framed: '', surface: () => ({ path: current }), location: { href: origin + '/ultra/course' },
    Date: { now: () => 100000 }, requestIdleCallback: (fn) => fn(),
    setTimeout: (fn) => { timers.set(++n, fn); return n; },
    shoot: async () => { pictures++; return success ? { path: current } : null; },
  });
  const fire = async () => { const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); await new Promise(setImmediate); };
  later(700); await fire(); // The native page is still loading: no picture was taken.
  success = true;
  later(700);
  assert.equal(timers.size, 1, 'a skipped capture must not suppress the first ready picture for 15 seconds');
  await fire();
  later(700);
  assert.equal(timers.size, 0, 'the short-delay path obeys the guard after success');
  current = '/ultra/courses/_2_1/grades';
  later(700); await fire();
  assert.equal(pictures, 3, 'navigation inside the same course frame gets a new picture');
});

test('an already queued idle capture rechecks the 15-second guard before taking another picture', async () => {
  const timers = [], idle = [];
  let pictures = 0;
  const later = vm.runInNewContext(part('  let capTimer = ', '  // Leaving through Ultra') + '\nlater;', {
    showing: '_2_1', framed: '', surface: () => ({ path: '/ultra/courses/_2_1/outline' }), location: {},
    Date: { now: () => 100000 }, requestIdleCallback: (fn) => idle.push(fn),
    setTimeout: (fn) => { timers.push(fn); return 1; }, shoot: async () => { pictures++; return {}; },
  });
  later(700); timers.shift()();
  later(700); timers.shift()();
  idle.shift()(); await new Promise(setImmediate);
  idle.shift()(); await new Promise(setImmediate);
  assert.equal(pictures, 1, 'a successful capture must suppress callbacks that were queued before it');
});

test('same-course frame navigation reports a move without needing a scroll', () => {
  let moves = 0;
  const location = { pathname: '/ultra/courses/_2_1/outline', search: '' };
  const context = vm.createContext({
    on: true, framed: '_2_1', preview: false, showing: '', loaded: true, restored: true,
    last: '_2_1', lastPath: location.pathname, location, frames: new Map(), tabs: [{ cid: '_2_1' }],
    here: () => '_2_1', observeView() {}, notePlace() {}, flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved: () => moves++,
  });
  const pass = vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass;', context);
  pass();
  assert.equal(moves, 0);
  location.pathname = '/ultra/courses/_2_1/grades';
  pass();
  assert.equal(moves, 1, 'a new frame page must reach the owner snapshot scheduler');
  pass();
  assert.equal(moves, 1, 'unchanged passes must not restart the move debounce');
});

test('covered-page CSS restores visibility for its strip, footer, native dialogs and notifications', () => {
  const css = fs.readFileSync(path.join(root, 'extras.css'), 'utf8');
  // Visibility inherits through #site-wrap even into high-z-index and top-layer descendants.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*\bvisibility\s*:\s*visible[^{}]*)\}/g)];
  for (const selector of ['#gz-ctabs', '#gz-footer', 'dialog[open]', '[role="dialog"]', '[role="alertdialog"]', '[role="alert"]', '[role="status"]', '.MuiModal-root', '.MuiSnackbar-root']) {
    assert.ok(rules.some(([, head]) => head.includes('html[data-gz-ctab-framed] #site-wrap ') && head.includes(selector)), `${selector} must escape the covered page's inherited hidden visibility`);
  }
});

test('the worker takes a course tab\'s frame as its Ultra page: its origin stands in for the about:blank it reports', () => {
  const bg = fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8');
  const block = bg.slice(bg.indexOf('const addressOf = '), bg.indexOf('const fromUltra = '));
  const { ultraAt, ultraPage } = vm.runInNewContext(`${block}\n({ ultraAt, ultraPage });`, { chrome: { runtime: { id: 'glaze' } }, URL });
  const tab = { id: 1, url: `${origin}/ultra/courses/_1_1/outline` };
  const frame = { id: 'glaze', tab, frameId: 7, url: 'about:blank', origin };
  assert.equal(ultraAt(frame), origin);
  assert.equal(ultraPage(frame), true);
  assert.equal(ultraAt({ ...frame, origin: 'https://other.test' }), null, 'a frame of another origin is not this tab\'s page');
  assert.equal(ultraPage({ ...frame, origin: 'https://other.test' }), false);
  for (const url of ['data:text/html,fixture', 'blob:https://bb.school.test/id', 'about:srcdoc', '', undefined]) assert.equal(ultraAt({ ...frame, url }), null, 'only the observed about:blank sender can use the origin fallback');
  assert.equal(ultraAt({ ...frame, origin: 'null' }), null, 'an opaque frame never stands in');
  assert.equal(ultraAt({ id: 'glaze', tab, frameId: 0, url: 'about:blank', origin }), null, 'the top frame is taken by its own address');
  assert.equal(ultraPage({ id: 'glaze', tab: { id: 1, url: 'https://other.test/x' }, frameId: 7, url: `${origin}/ultra/course`, origin }), false, 'an Ultra frame in another site\'s tab is not its page');
});


test('a live frame saves only its own place through the owner, never a stale whole tab list', () => {
  const sent = [], writes = [];
  const saveNow = vm.runInNewContext(part('  let saveTimer = ', '  const framed = ') + '\nsaveNow;', {
    clearTimeout() {}, setTimeout() {}, who: '_42_1', loaded: true, preview: false, framed: '_2_1',
    tabs: [{ cid: '_1_1', pin: false }, { cid: '_2_1', path: '/ultra/courses/_2_1/grades', top: 200 }],
    toTop: (op, value) => sent.push({ op, ...value }), local: (f) => f({ set: (v) => writes.push(v) }), key: () => 'key',
  });
  saveNow();
  assert.equal(writes.length, 0, 'a late child save cannot restore a closed course or undo a newer pin/order');
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ op: 'place', uid: '_42_1', path: '/ultra/courses/_2_1/grades', top: 200 }]);
});

test('a saved-list close destroys its live frame and a metadata change preserves only local place', () => {
  const dropped = [];
  const context = vm.createContext({
    L, readPrefs() {}, pass() {}, who: '_42_1', preview: false, key: () => 'key',
    tabs: [{ cid: '_1_1', path: '/ultra/courses/_1_1/grades', top: 220, pin: false }],
    ctx: { courseId: () => '_1_1' }, frames: new Map([['_2_1', {}]]), drop: (cid) => dropped.push(cid),
  });
  const store = vm.runInContext(part('  const onStore = ', '  const onHide = ') + '\nonStore;', context);
  store({ key: { newValue: { tabs: [{ cid: '_1_1', path: '/ultra/courses/_1_1/outline', top: 0, pin: true }] } } }, 'local');
  assert.deepEqual(dropped, ['_2_1']);
  assert.equal(vm.runInContext('tabs[0].pin', context), true, 'another strip can pin this document\'s own course');
  assert.equal(vm.runInContext('tabs[0].top', context), 220);
});

test('four edited live frames refuse a fifth without opening or destroying a document', async () => {
  const frames = new Map(Array.from({ length: 4 }, (_, i) => [`_${i + 1}_1`, { at: i, dirty: true, ready: true }]));
  const shown = [], closed = [], notes = [];
  const show = vm.runInNewContext(part('  const show = async (cid) => {', '  // A tab: its frame') + '\nshow;', {
    showTurn: 0, showing: '_2_1', shownFrom: '', shooting: null, on: true, frames, LIVE: 4,
    host: {}, strip: null, list: null, document: { activeElement: null }, location: {},
    say: (m) => notes.push(m), t: (s) => s,
    open: (c) => { shown.push(c); return null; }, drop: (c) => closed.push(c),
  });
  await show('_5_1');
  assert.deepEqual(shown, []);
  assert.deepEqual(closed, []);
  assert.equal(frames.size, 4);
  assert.equal(notes.length, 1);
});

test('automatic list eviction preserves edited live courses and still enforces the hard bound', () => {
  const tabs = [{ cid: '_1_1', at: 0 }, { cid: '_2_1', at: 1 }];
  const r = L.open(tabs, { cid: '_3_1', at: 2 }, 2, (cid) => cid === '_1_1');
  assert.deepEqual(r.gone.map((x) => x.cid), ['_2_1']);
  const full = Array.from({ length: L.MAX }, (_, i) => ({ cid: `_${i + 1}_1`, at: i, pin: i > 0 }));
  assert.equal(L.open(full, { cid: '_99_1' }, L.MAX, () => true).tabs.length, L.MAX);
});

test('a hidden frame pauses its scene only for messages from its owner on the same origin', () => {
  const top = {}, stranger = {}, states = []; let listen, scenes = 0;
  if (source.includes('  if (framed && !preview) {')) vm.runInNewContext(part('  if (framed && !preview) {', '  // Ultra routes without reloading'), {
    framed: '_2_1', preview: false, location: { origin }, window: { top },
    addEventListener: (event, fn) => { listen = fn; }, toTop() {},
    document: { addEventListener() {} }, html: { toggleAttribute: (k, v) => states.push([k, v]) }, ctx: { scene: () => scenes++ }, say() {},
  });
  assert.equal(typeof listen, 'function', 'live frames receive visibility from their owner');
  listen({ source: stranger, origin, data: { gzCtab: 'visible', on: false } });
  listen({ source: top, origin: 'https://other.test', data: { gzCtab: 'visible', on: false } });
  assert.equal(states.length, 0);
  listen({ source: top, origin, data: { gzCtab: 'visible', on: false } });
  listen({ source: top, origin, data: { gzCtab: 'visible', on: true } });
  assert.deepEqual(states, [['data-gz-ctab-framed', true], ['data-gz-ctab-framed', false]]);
  assert.equal(scenes, 2);
});

test('a new account discovered in a live frame revokes the owner and clears its cached pictures', () => {
  let listener, revoked = 0; const sent = [], mine = {};
  vm.runInNewContext(part("  if (!framed && !preview) addEventListener('message'", '  // Ultra routes without reloading'), {
    L, ctx: { site: 'ultra' }, framed: '', preview: false, on: true, location: { origin }, who: '_42_1',
    addEventListener: (t, fn) => { listener = fn; }, frames: new Map([['_2_1', { el: { contentWindow: mine } }]]),
    send: (m) => sent.push(m), revoke: () => revoked++,
  });
  listener({ origin, source: mine, data: { gzCtab: 'account', uid: '_43_1' } });
  assert.equal(revoked, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ op: 'drop', signout: true }]);
});

test('a screenshot delayed across an in-page course switch is forgotten instead of cached under the old course', async () => {
  const doc = { body: {}, querySelectorAll: () => [] }; const sent = [], kept = [];
  let current = { cid: '_2_1', path: '/ultra/courses/_2_1/outline', doc, frame: {} }, resolve;
  const shoot = vm.runInNewContext(part('  let shooting = ', '  const keep = ') + '\nshoot;', {
    surface: () => current, on: true, signedOut: false, framed: '', preview: false,
    ctx: { holding: () => false }, document: { visibilityState: 'visible', querySelectorAll: () => [] },
    performance: { now: () => 1000 }, safePath: (p) => p, split: (s) => [s, ''], loading: () => false, pic: null,
    innerWidth: 1000, innerHeight: 800, requestAnimationFrame: (fn) => fn(), setTimeout: (fn) => fn(),
    send: (m) => { sent.push(m); return m.op === 'shot' ? new Promise((r) => { resolve = r; }) : Promise.resolve(); },
    keep: (s) => kept.push(s),
  });
  const result = shoot(); await Promise.resolve(); await Promise.resolve();
  current = { ...current, cid: '_3_1', path: '/ultra/courses/_3_1/outline' };
  resolve({ snap: { cid: '_2_1', path: '/ultra/courses/_2_1/outline' } });
  assert.equal(await result, null);
  assert.equal(kept.length, 0);
  assert.equal(sent.at(-1).op, 'forget');
});

test('closing the surrounding course keeps the next course’s existing edited frame', () => {
  const drops = [], routes = [], visits = [];
  const shut = vm.runInNewContext(part('  const shut = ', '  const pinTab = ') + '\nshut;', {
    framed: '', showing: '', here: () => '_1_1', tabs: [{ cid: '_1_1' }, { cid: '_2_1' }], L,
    snaps: new Map(), frames: new Map([['_2_1', { dirty: true }]]), ctx: { courseId: () => '_1_1' },
    preview: false, save() {}, send() {}, draw() {}, flag() {}, P: () => ({ place: true }),
    drop: (cid) => drops.push(cid), route: (url) => routes.push(url), visit: (cid) => visits.push(cid),
  });
  shut('_1_1');
  assert.deepEqual(drops, ['_1_1'], 'the next live document must not be destroyed as a side effect of closing another tab');
  assert.deepEqual(visits, ['_2_1']);
  assert.deepEqual(routes, ['/ultra/course']);
});


test('native edits protect a live frame before window load and after a new document starts', () => {
  const handlers = {}, sent = [];
  const block = source.includes('  if (framed && !preview) {') ? part('  if (framed && !preview) {', '  // Ultra routes without reloading') : '';
  vm.runInNewContext(block, {
    framed: '_2_1', preview: false, on: true, document: { addEventListener: (event, fn) => { handlers[event] = fn; } },
    addEventListener() {}, toTop: (op) => sent.push(op),
  });
  assert.equal(typeof handlers.input, 'function', 'protection is installed by the content module without waiting for window load');
  handlers.input({ isTrusted: false });
  handlers.input({ isTrusted: true });
  handlers.change({ isTrusted: true });
  handlers.submit({ isTrusted: true });
  assert.deepEqual(sent, ['loaded', 'edited', 'edited', 'edited']);
});

test('the strip check in the mutation callback reads no layout until the bar, the strip\'s place or a size changes', () => {
  let reads = 0, visible = true, placed = 0, ro = null;
  const box = (name) => ({ name, getClientRects: () => { reads++; return visible ? [{}] : []; }, contains: () => true });
  let bar = box('bar');
  const strip = { isConnected: true, parentElement: bar };
  const held = vm.runInNewContext(part('  const shown = (e)', '  const safePath') + part('  let seenBar = null', "  // The first paint's reservation") + '\nheld;', {
    on: true, strip, courseBar: () => bar, routed: () => null, place: () => { placed++; strip.parentElement = bar; },
    ResizeObserver: class { constructor(cb) { ro = this; this.cb = cb; this.seen = []; } observe(e) { this.seen.push(e); } disconnect() { this.seen = []; } },
  });
  held();
  assert.equal(placed, 1, 'the first check places the strip in the bar');
  assert.deepEqual(ro.seen.map((e) => e.name), ['bar'], 'and watches the bar\'s size');
  const before = reads;
  for (let i = 0; i < 30; i++) held();
  assert.equal(reads, before, 'thirty unrelated changes read no layout');
  visible = false; ro.cb();
  assert.equal(placed, 2, 'the bar hidden without a node added: seen by its size, and the strip placed again');
  visible = true; bar = box('new bar'); held();
  assert.equal(placed, 3, 'a new bar: checked at once');
  assert.deepEqual(ro.seen.map((e) => e.name), ['new bar']);
});
