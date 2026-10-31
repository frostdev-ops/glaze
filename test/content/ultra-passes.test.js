// Glaze's own work on an Ultra page (content.js, the real file on a stand-in page): code on demand goes in one worker
// round trip per feature, a class or style change restyles its element rather than its whole subtree, a hidden tab
// puts its passes off until it is shown, the first storage reads go in one get, and a change is applied from its new
// values.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

const boot = async ({ pathname = '/ultra/stream' } = {}) => {
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
    getAttributeNames() { return [...this.attrs.keys()]; } addEventListener() {} removeEventListener() {}
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
    querySelector: () => null, querySelectorAll: (sel) => (sel === '*' ? html.all() : []), getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
    createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: () => new El('#text'),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener: (type, f) => (listeners[type] ||= []).push(f), removeEventListener() {}, fonts: { load: () => Promise.resolve([]), add() {} } };
  const local = { get: (k, cb) => { localGets.push(k); const r = k === 'ultra' || (Array.isArray(k) && k.includes('ultra')) ? { ultra: ['https://school.test'] } : {}; return cb ? cb(r) : Promise.resolve(r); },
    set: (o, cb) => { cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } };
  const location = { protocol: 'https:', origin: 'https://school.test', pathname, href: `https://school.test${pathname}`, search: '', hash: '' };
  const c = vm.createContext({ document, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto, location,
    navigator: { language: 'en' }, Element: El, HTMLElement: El, SVGElement: class {}, Node: El, NodeFilter: { SHOW_TEXT: 4 },
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
  for (const f of ['core/color.js', 'core/i18n.js', 'core/page.js', 'planner/grades.js', 'looks/fonts.js', 'looks/surfaces.js', 'content/defaults.js', 'navigation/nav.js', 'content/content-ultra.js']) vm.runInContext(read(f), c, { filename: f });
  vm.runInContext(read('content/content.js'), c, { filename: 'content/content.js' });
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
