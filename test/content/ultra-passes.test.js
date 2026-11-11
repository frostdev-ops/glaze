// Glaze's own work on an Ultra page (content.js, the real file on a stand-in page): code on demand goes in one worker
// round trip per feature, a class or style change restyles its element rather than its whole subtree, a hidden tab
// puts its passes off until it is shown, the first storage reads go in one get, and a change is applied from its new
// values.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

test('a failed startup read still completes consumers when the direct fallback throws', async () => {
  const source = read('content/content.js');
  let gets = 0, answered = false;
  const c = vm.createContext({ window: {}, solo: true, ultra: true, isPreview: false, location: { origin: 'https://school.test' },
    chrome: { runtime: {}, storage: { local: { get: (_, cb) => {
      if (++gets > 1) throw new Error('Extension context invalidated');
      c.chrome.runtime.lastError = { message: 'read failed' }; cb({}); delete c.chrome.runtime.lastError;
    } }, onChanged: { addListener() {} } } } });
  c.window.top = c.window;
  const stored = vm.runInContext(`${source.slice(source.indexOf('  const topFrame ='), source.indexOf('  // ---- long tail'))}\nstored;`, c);
  stored('freshDefaults', () => { answered = true; });
  await settle();
  assert.equal(answered, true, 'settings readiness must settle even after extension reload');
});

const boot = async ({ pathname = '/ultra/stream', localGet, byId = false, store, locks } = {}) => {
  let now = 0;
  const timers = [], styleReads = [], radiusReads = [], loads = [], localGets = [], syncGets = [], changed = [], listeners = {}, observers = [];
  class El {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.kids = []; this.parentElement = null; this.dataset = {}; this.childNodes = []; this.nodeType = 1;
      const props = new Map();
      this.style = { setProperty: (k, v) => props.set(k, String(v)), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => { if (this.tagName === 'HTML' && k === '--gz-radius') radiusReads.push(now); return props.get(k) || ''; }, length: 0 };
      this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} }; }
    get children() { return this.kids; }
    get isConnected() { let e = this; while (e.parentElement) e = e.parentElement; return !!e.root; }
    get className() { return this.attrs.get('class') || ''; }
    all() { return this.kids.flatMap((k) => [k, ...k.all()]); }
    setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); } toggleAttribute(k, on) { if (on) this.attrs.set(k, ''); else this.attrs.delete(k); }
    getAttributeNames() { return [...this.attrs.keys()]; } addEventListener(type, f) { ((this.heard ||= {})[type] ||= []).push(f); } removeEventListener() {}
    querySelector() { return null; } querySelectorAll(sel) { return sel === '*' ? this.all() : []; } getElementsByTagName(t) { return t === '*' ? this.all() : []; }
    getElementsByClassName() { return []; } closest() { return null; } matches() { return false; } contains() { return false; }
    append(...n) { for (const k of n) { k.parentElement = this; this.kids.push(k); } } appendChild(n) { this.append(n); return n; } prepend(...n) { this.append(...n); } before() {} after() {} remove() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; } getClientRects() { return []; } getAnimations() { return []; }
  }
  const tree = (n) => { const e = new El('div'); for (let i = 0; i < n; i++) e.append(new El('span')); return e; };
  const html = new El('html'); html.lang = 'en'; html.root = true;
  const head = new El('head'); head.querySelector = (sel) => (sel.includes('base[href*="/ultra/"]') ? { matches: () => true } : null);
  const body = new El('body'); body.contains = () => true;
  html.append(head, body);
  const big = tree(100), small = tree(3);
  body.append(big, small);
  const document = { contentType: 'text/html', documentElement: html, head, body, readyState: 'interactive', hidden: false, visibilityState: 'visible',
    querySelector: () => null, querySelectorAll: (sel) => (sel === '*' ? html.all() : []), getElementById: (id) => (byId ? html.all().find((e) => e.id === id) || null : null), getElementsByTagName: () => [], getElementsByClassName: () => [],
    createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: () => new El('#text'),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener: (type, f) => (listeners[type] ||= []).push(f), removeEventListener() {}, fonts: { load: () => Promise.resolve([]), add() {} } };
  const local = { get: (k, cb) => { localGets.push(k); if (localGet?.(k, cb)) return; if (store) return store.get(k, cb); const r = k === 'ultra' || (Array.isArray(k) && k.includes('ultra')) ? { ultra: ['https://school.test'] } : {}; return cb ? cb(r) : Promise.resolve(r); },
    set: (o, cb) => { if (store) return store.set(o, cb); cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } };
  const location = { protocol: 'https:', origin: 'https://school.test', pathname, href: `https://school.test${pathname}`, search: '', hash: '' };
  const c = vm.createContext({ document, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto, location,
    navigator: { language: 'en', ...(locks && { locks }) }, Element: El, HTMLElement: El, SVGElement: class {}, Node: El, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (e) => { styleReads.push(e); return { getPropertyValue: () => '', color: 'rgb(0, 0, 0)', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', position: 'static', transitionDuration: '0s' }; },
    CSS: { supports: () => false, escape: (s) => s }, matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class { constructor(f) { this.f = f; } observe(target, o) { observers.push({ f: this.f, target, o }); } disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, PerformanceObserver: class { observe() {} },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    setTimeout: (f, ms = 0) => { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => now }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerHeight: 900, innerWidth: 1400,
    fetch: () => Promise.reject(new Error('offline')),
    chrome: { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, lastError: undefined, getManifest: () => ({}),
      sendMessage: (m) => { if (m?.type === 'glaze:load') { loads.push(m.files); return Promise.resolve({ ok: false, error: 'not loadable' }); } return Promise.resolve({ ok: false }); } },
      storage: { sync: { get: (k, cb) => { syncGets.push(k); cb({}); } }, local, onChanged: { addListener: (f) => changed.push(f) } } } });
  c.window = c; c.top = c; c.globalThis = c;
  for (const f of ['core/color.js', 'core/i18n.js', 'core/page.js', 'planner/grades.js', 'looks/fonts.js', 'looks/surfaces.js', 'content/defaults.js', 'navigation/nav.js', 'content/content-ultra.js']) vm.runInContext(read(f).replace('  const shown = new Map();', '  globalThis.__seen = () => ({ seen, seenItems }); globalThis.__loadSeen = () => loadSeen();\n  globalThis.__site = { keepSeen: (...a) => keepSeen(...a), record: () => record(), openNew: (e) => openNew(e), renderNew: () => renderNew(), books: () => books, contents: () => contents };\n  const shown = new Map();').replace('  const myCourses = () => {', '  const myCourses = () => { if (globalThis.__courses) return Promise.resolve(globalThis.__courses);'), c, { filename: f });
  vm.runInContext(read('content/content.js').replace('  const courseSlots = {};', '  const courseSlots = {}; globalThis.__slots = courseSlots;').replace('  let lookX;', '  let lookX; globalThis.__look = () => lookX;'), c, { filename: 'content/content.js' });
  await settle();
  const wait = async (ms) => {
    const end = now + ms;
    for (;;) {
      await settle();
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      now = Math.max(now, due.at);
      due.f();
    }
    now = end;
    await settle();
  };
  await wait(1000);
  const sweeper = () => observers.find((o) => o.target === body && o.o.attributeFilter?.includes('aria-checked'));
  const mutate = (records) => sweeper().f(records);
  const change = (changes, area) => { for (const f of changed) f(changes, area); };
  const fire = (type) => { for (const f of listeners[type] || []) f({ type }); };
  return { c, El, tree, html, body, big, small, document, styleReads, radiusReads, loads, localGets, syncGets, wait, sweeper, mutate, change, fire };
};

test('a group of files a feature needs goes to the worker in one glaze:load, and files it already ran are left out', async () => {
  const p = await boot();
  const sent = [];
  p.c.chrome.runtime.sendMessage = (m) => { sent.push(m.files); for (const f of m.files) p.c[`GZ_${f.replace(/\W/g, '_')}`] = {}; return Promise.resolve({ ok: true }); };
  const has = (...fs) => () => fs.every((f) => p.c[`GZ_${f.replace(/\W/g, '_')}`]);
  await p.c.GZ_CTX.need(['x/lib.js', 'x/page/ui.js'], has('x/lib.js', 'x/page/ui.js'));
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['x/lib.js', 'x/page/ui.js']], 'one round trip for the pair');
  await p.c.GZ_CTX.need('x/lib.js', has('x/lib.js'));
  assert.equal(sent.length, 1, 'a file of the group is already here');
  await p.c.GZ_CTX.need(['x/lib.js', 'x/page/more.js'], has('x/lib.js', 'x/page/more.js'));
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1])), ['x/page/more.js'], 'what already ran is not sent again');
});

test('a group retries its missing dependency when the worker succeeds but readiness fails', async () => {
  const p = await boot();
  const sent = [];
  p.c.chrome.runtime.sendMessage = (m) => {
    sent.push([...m.files]);
    // Injection can finish its last file even if an earlier library threw.
    if (sent.length > 1 && m.files.includes('x/lib.js')) p.c.library = {};
    p.c.page = {};
    return Promise.resolve({ ok: true });
  };
  await assert.rejects(p.c.GZ_CTX.need(['x/lib.js', 'x/page.js'], () => p.c.library && p.c.page), /not ready/);
  await p.wait(1100);
  assert.ok(p.c.library, 'the automatic retry loads the failed library again');
  assert.deepEqual(sent[1], ['x/lib.js', 'x/page.js']);
});

test('course tabs ask once, without a separate trip for their library, and the sidebar brings its libraries in its load', async () => {
  const p = await boot({ pathname: '/ultra/course' });
  const added = p.tree(1);
  p.body.append(added);
  p.mutate([{ type: 'childList', target: p.body, addedNodes: [added], removedNodes: [] }]);
  await p.wait(500);
  const loads = JSON.parse(JSON.stringify(p.loads));
  assert.ok(loads.some((f) => f.includes('navigation/page/coursetabs.js')), `course tabs asked for (${JSON.stringify(loads)})`);
  assert.ok(!loads.some((f) => f.length === 1 && f[0] === 'navigation/coursetabs.js'), 'no round trip for the library alone');
  const side = loads.find((f) => f.includes('navigation/page/sidebar.js'));
  assert.ok(side, 'the sidebar asked for');
  assert.ok(side.includes('core/widgets.js') && side.includes('navigation/sidebar.js'), `its libraries with it (${JSON.stringify(side)})`);
});

test('a class or style change sweeps its element, not a big subtree; a small one goes with it; added nodes sweep their subtree', async () => {
  const p = await boot();
  p.styleReads.length = 0;
  p.mutate([{ type: 'attributes', attributeName: 'class', target: p.big, oldValue: '' }]);
  await p.wait(200);
  assert.ok(p.styleReads.includes(p.big), 'the element itself is read again');
  assert.equal(p.styleReads.filter((e) => p.big.kids.includes(e)).length, 0, 'its hundred children are not');
  p.styleReads.length = 0;
  p.mutate([{ type: 'attributes', attributeName: 'class', target: p.small, oldValue: '' }]);
  await p.wait(200);
  assert.deepEqual(p.small.kids.map((k) => p.styleReads.includes(k)), [true, true, true], 'a button-sized subtree is restyled with it');
  p.styleReads.length = 0;
  const added = p.tree(5);
  p.big.append(added);
  p.mutate([{ type: 'childList', target: p.big, addedNodes: [added], removedNodes: [] }, { type: 'attributes', attributeName: 'style', target: p.big, oldValue: '' }]);
  await p.wait(200);
  assert.ok([added, ...added.kids].every((e) => p.styleReads.includes(e)), 'an added subtree is swept whole');
  assert.equal(p.styleReads.filter((e) => p.big.kids.includes(e) && e !== added).length, 0, 'the rest of the container is not');
});

test('a hidden tab puts its passes off, and sweeps everything once when it is shown', async () => {
  const p = await boot();
  p.document.hidden = true;
  p.styleReads.length = 0;
  const added = p.tree(2);
  p.body.append(added);
  p.mutate([{ type: 'childList', target: p.body, addedNodes: [added], removedNodes: [] }, { type: 'attributes', attributeName: 'class', target: p.big, oldValue: '' }]);
  await p.wait(5000);
  assert.equal(p.styleReads.length, 0, 'nothing swept while hidden');
  p.document.hidden = false;
  p.fire('visibilitychange');
  await p.wait(200);
  assert.ok(p.body.all().every((e) => p.styleReads.includes(e)), 'one full pass once shown');
  const n = p.styleReads.length;
  await p.wait(5000);
  assert.equal(p.styleReads.length, n, 'and only one');
});

test('a burst of attribute changes cannot crowd newly added content out of the pass', async () => {
  const p = await boot();
  const changed = p.tree(20001), added = p.tree(0);
  p.body.append(changed, added);
  p.styleReads.length = 0;
  p.mutate([
    ...changed.kids.map((target) => ({ type: 'attributes', attributeName: 'class', target, oldValue: '' })),
    { type: 'childList', target: p.body, addedNodes: [added], removedNodes: [] },
  ]);
  await p.wait(500);
  assert.ok(p.styleReads.includes(added), 'new content is swept even when attribute changes fill a pass');
  assert.ok(changed.kids.every((el) => p.styleReads.includes(el)), 'the overflow is eventually swept too');
});

test('the first storage.local reads go in one get', async () => {
  const p = await boot();
  const gets = JSON.parse(JSON.stringify(p.localGets)).map((k) => [].concat(k));
  const first = gets.find((k) => k.includes('courseSlots'));
  assert.ok(first, 'course slots read');
  for (const k of ['freshDefaults', 'seenCourses', 'mods', 'dueWeek:https://school.test', 'seenCoursesAt https://school.test', 'widgetLayout'])
    assert.ok(first.includes(k), `${k} in the one get (${JSON.stringify(gets)})`);
  for (const k of ['freshDefaults', 'courseSlots', 'seenCourses', 'mods', 'dueWeek:https://school.test', 'widgetLayout'])
    assert.equal(gets.filter((g) => g.includes(k)).length, 1, `${k} read once (${JSON.stringify(gets)})`);
});

test('a startup snapshot cannot overwrite a course-list change that arrived while it was pending', async () => {
  let answer;
  const p = await boot({ localGet: (keys, cb) => {
    if (!Array.isArray(keys) || !keys.includes('courseSlots')) return false;
    answer = cb;
    return true;
  } });
  const seenCourses = { _1_1: { name: 'Biology', slot: 3 } };
  p.change({ seenCourses: { newValue: seenCourses } }, 'local');
  answer({ seenCourses: {} });
  await p.wait(200);
  assert.deepEqual(JSON.parse(JSON.stringify(p.c.GZ_CTX.courseList())), seenCourses);
});

test('a settings change is applied from its new values, and a new course list alone does not repaint the palette', async () => {
  const p = await boot();
  const reads = p.syncGets.length;
  p.change({ motion: { newValue: { level: 'expressive', followSystem: false, transitions: true, enter: true, hover: true } } }, 'sync');
  await p.wait(100);
  assert.equal(p.syncGets.length, reads, 'no second read of every setting');
  assert.equal(p.html.getAttribute('data-gz-motion'), 'expressive', 'the change is painted');
  const painted = p.radiusReads.length;
  p.change({ motion: { newValue: { level: 'expressive', followSystem: false, transitions: true, enter: true, hover: true } } }, 'sync');
  await p.wait(100);
  assert.equal(p.radiusReads.length, painted, 'a write that changes nothing paints nothing');
  p.change({ seenCourses: { newValue: { _1_1: { name: 'Biology', slot: 3 } } } }, 'local');
  await p.wait(500);
  assert.equal(p.radiusReads.length, painted, 'the course list alone leaves the palette');
});


test('startup consumers follow due-list and course-slot changes, including removal', async () => {
  const p = await boot();
  await p.c.GZ_CTX.dueWeek();
  const key = 'dueWeek:https://school.test', list = [{ title: 'New work', cid: '_1_1' }];
  p.change({ [key]: { newValue: { at: Date.now(), list } }, courseSlots: { newValue: { _1_1: 7 } } }, 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(await p.c.GZ_CTX.dueWeek())), list);
  assert.equal(p.c.__slots._1_1, 7);
  p.change({ [key]: {}, courseSlots: {} }, 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(await p.c.GZ_CTX.dueWeek())), []);
  assert.deepEqual(Object.keys(p.c.__slots), []);
});

test('seen grades and content follow another tab after their startup read', async () => {
  const p = await boot();
  await p.c.__loadSeen();
  const seenGrades = { _1_1: { _9_1: 'A' } }, seenContent = { _1_1: ['_9_1', '+'] };
  p.change({ seenGrades: { newValue: seenGrades }, seenContent: { newValue: seenContent } }, 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(p.c.__seen())), { seen: seenGrades, seenItems: seenContent });
  p.change({ seenGrades: {}, seenContent: {} }, 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(p.c.__seen())), { seen: {}, seenItems: {} });
});


test('a Look parts change is retained when a later settings patch is applied', async () => {
  const p = await boot(), lookX = { bg: { kind: 'color' } };
  p.change({ lookX: { newValue: lookX } }, 'sync'); await p.wait(100);
  p.change({ motion: { newValue: { level: 'off' } } }, 'sync'); await p.wait(100);
  assert.deepEqual(JSON.parse(JSON.stringify(p.c.__look())), lookX);
});

test('the due-list memo expires in an open document', async () => {
  const p = await boot();
  let now = Date.now(), calls = 0;
  p.c.Date = class extends Date { static now() { return now; } };
  p.c.fetch = async () => { calls++; throw Error('offline'); };
  await p.c.GZ_CTX.dueWeek();
  const n = calls; now += 120001;
  await p.c.GZ_CTX.dueWeek();
  assert.ok(calls > n, 'a failed or cached answer does not live forever');
});

test("Glaze's footer waits for its stylesheet: in before it, it sat after the page and then jumped into view", async () => {
  const p = await boot({ byId: true });
  const footers = () => p.body.kids.filter((e) => e.id === 'gz-footer');
  const theme = p.html.all().find((e) => e.tagName === 'LINK' && e.href.endsWith('content/theme.css'));
  assert.ok(theme, 'the theme sheet is on the page');
  assert.equal(footers().length, 0, 'no footer while its sheet is still loading');
  theme.sheet = {};
  for (const f of theme.heard?.load || []) f({ type: 'load' });
  await p.wait(200);
  assert.equal(footers().length, 1, 'the footer once its sheet is in');
});

test("Ultra's own additions reach the Courses page panel's held() in the mutation callback, before the frame paints", async () => {
  const p = await boot({ pathname: '/ultra/course' });
  let held = 0;
  p.c.GZ_WIDGETS_UI = { held: () => held++, sync() {} };
  const added = p.tree(1);
  p.body.append(added);
  p.mutate([{ type: 'childList', target: p.body, addedNodes: [added], removedNodes: [] }]);
  assert.ok(held > 0, 'held at once, not at the next pass');
});

// Audit 2026-11-11 A2: Ultra changes page by pushState (no popstate), and a browser without window.navigation (Firefox before
// 147) has no other notice: content.js's pass is the notice, and it tells the Look's page modules (looks/page/motionx.js and
// lookx.js, loaded on demand) to look at the route.
test('every pass on Ultra tells the Look animations and stickers to look at the route, with or without them loaded', async () => {
  const p = await boot({ pathname: '/ultra/courses/_1_1/outline' });
  assert.equal(p.c.navigation, undefined, 'a browser without the Navigation API');
  const heard = [];
  const pass = async () => {
    const added = p.tree(1);
    p.body.append(added);
    p.mutate([{ type: 'childList', target: p.body, addedNodes: [added], removedNodes: [] }]);
    await p.wait(500);
  };
  await pass();
  assert.deepEqual(heard, [], 'nothing loaded, nothing asked');
  p.c.GZ_MOTIONX = { route: () => heard.push('motionx') };
  await pass();
  assert.deepEqual(heard, ['motionx']);
  p.c.GZ_LOOKX = { route: () => heard.push('lookx') };
  p.c.location.pathname = '/ultra/courses/_1_1/assessment/_2_1/attempt/_3_1';
  await pass();
  assert.deepEqual(heard, ['motionx', 'motionx', 'lookx'], 'both, each pass');
});

// ---- storage that several tabs share (audit 2026-11-11 A4) ----
// Every get and set answers a turn later, as chrome.storage does, so two tabs' read-modify-writes can interleave. Web Locks as
// one origin's tabs share them: one holder at a time per name, until the callback's promise settles.
const sharedStorage = () => {
  const data = { ultra: ['https://school.test'] };
  return { data,
    get: (k, cb) => setImmediate(() => cb(Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])))),
    set: (o, cb) => setImmediate(() => { Object.assign(data, structuredClone(o)); cb?.(); }) };
};
const originLocks = () => {
  const tails = new Map(), asked = [];
  return { asked, request: (name, cb) => { asked.push(name); const run = (tails.get(name) || Promise.resolve()).then(() => cb()); tails.set(name, run.catch(() => {})); return run; } };
};

test('two tabs of a school recording seen grades and content at the same instant both keep their entries', async () => {
  const store = sharedStorage(), locks = originLocks();
  const a = await boot({ store, locks }), b = await boot({ store, locks });
  a.c.__site.keepSeen('seenGrades', '_1_1', { _9_1: 'A' }); b.c.__site.keepSeen('seenGrades', '_2_1', { _8_1: 'B' });
  a.c.__site.keepSeen('seenContent', '_1_1', ['_3_1', '+']); b.c.__site.keepSeen('seenContent', '_2_1', ['_4_1', '+']);
  await settle(30);
  assert.deepEqual(JSON.parse(JSON.stringify(store.data.seenGrades)), { _1_1: { _9_1: 'A' }, _2_1: { _8_1: 'B' } });
  assert.deepEqual(JSON.parse(JSON.stringify(store.data.seenContent)), { _1_1: ['_3_1', '+'], _2_1: ['_4_1', '+'] });
  assert.deepEqual([...new Set(locks.asked)].sort(), ['glaze:seenContent', 'glaze:seenGrades']);
});

test('without Web Locks a tab still orders its own writes to a shared key', async () => {
  const store = sharedStorage();
  const a = await boot({ store });
  assert.equal(a.c.navigator.locks, undefined);
  a.c.__site.keepSeen('seenGrades', '_1_1', { _9_1: 'A' }); a.c.__site.keepSeen('seenGrades', '_2_1', { _8_1: 'B' });
  await settle(30);
  assert.deepEqual(JSON.parse(JSON.stringify(store.data.seenGrades)), { _1_1: { _9_1: 'A' }, _2_1: { _8_1: 'B' } });
});

test("an Ultra site's course list is written under the lock too, keeping other sites' courses and replacing its own", async () => {
  const store = sharedStorage(), locks = originLocks();
  store.data.seenCourses = { 'canvas:https://c.example/1': { name: 'Canvas' }, _5_1: { name: 'Gone', site: 'https://school.test' }, _6_1: { name: 'Other school', site: 'https://other.test' } };
  const p = await boot({ store, locks });
  vm.runInContext('globalThis.__courses = [{ courseId: "_1_1", courseCardColorIndex: 2, course: { name: "Biology", displayId: "BIO" } }]', p.c);
  delete store.data.seenCoursesAt;
  await p.c.__site.record();
  await settle(30);
  assert.deepEqual(Object.keys(store.data.seenCourses).sort(), ['_1_1', '_6_1', 'canvas:https://c.example/1']);
  assert.ok(locks.asked.includes('glaze:seenCourses'));
});

// Audit 2026-11-11 A5: sessionStorage throws when storage is off, in a sandboxed or partitioned frame, or full.
test("a sessionStorage that throws neither stops a new-count's click nor the rest of a pass", async () => {
  const p = await boot({ pathname: '/ultra/courses/_1_1/grades' });
  const calls = [];
  const boom = (k) => () => { calls.push(k); throw new Error('The operation is insecure.'); };
  p.c.sessionStorage = { getItem: boom('get'), setItem: boom('set'), removeItem: boom('remove') };
  // The "N new" count on a card: the click still opens the page it names.
  const assigned = [];
  p.c.location.assign = (url) => assigned.push(url);
  const pill = { dataset: { kind: 'grades', cid: '_1_1' }, closest: () => null };
  const target = new p.El('span');
  target.closest = () => pill;
  let stopped = 0;
  p.c.__site.openNew({ type: 'click', target, preventDefault: () => { stopped++; }, stopPropagation() {} });
  assert.equal(stopped, 1);
  assert.deepEqual(assigned, ['https://school.test/ultra/courses/_1_1/grades']);
  // A grades page with a gradebook read, and an outline with rows: the badges are drawn, nothing throws.
  p.c.__loadSeen();
  await p.wait(100);
  p.c.__site.books().set('_1_1', { key: '', at: Date.now(), pending: false, results: [] });
  p.c.__site.renderNew();
  assert.deepEqual(calls, ['set', 'get'], 'the click kept its jump, the grades page looked for one');
  p.c.location.pathname = '/ultra/courses/_1_1/outline';
  const row = new p.El('li');
  row.dataset = { contentId: '_5_1' };
  const everything = p.document.querySelectorAll;
  p.document.querySelectorAll = (sel) => (sel === '.content-list-item[data-content-id]' ? [row] : []);
  p.c.__site.contents().set('_1_1', { at: Date.now(), items: [{ id: '_5_1' }] });
  p.c.__site.renderNew();
  assert.deepEqual(calls, ['set', 'get', 'get'], 'and the outline looked for one');
  p.document.querySelectorAll = everything;
  // And a whole pass runs through.
  const added = p.tree(1);
  p.body.append(added);
  p.mutate([{ type: 'childList', target: p.body, addedNodes: [added], removedNodes: [] }]);
  await p.wait(500);
});
