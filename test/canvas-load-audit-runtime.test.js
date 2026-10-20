// Canvas document-load audit: real manifest scripts in a VM, with storage, DOMContentLoaded,
// mutation deliveries and time controlled separately. No browser, server or wall-clock perf claims.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const manifest = require('../manifest.json');
const files = manifest.content_scripts.find((s) => s.matches.includes('https://*.instructure.com/*')).js;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const quiet = () => D.GZ_SANITIZE({
  enhance: Object.fromEntries(Object.keys(D.GZ_DEFAULTS.enhance).map((k) => [k, false])),
  extras: { stickers: false, cursor: 'off', rotate: 'off' },
  navbar: { on: false }, bg: { kind: 'solid' }, motion: { level: 'off' }, footer: false,
});

const page = ({ frame = '', body = false, marker = true, wrapper = true, cached = quiet(), raw = quiet(),
  session = new Map(), local = {}, getKeys = true, pathname = '/courses/27/pages/intro' } = {}) => {
  const events = [], queries = [], requests = [], sent = [], storage = [], changes = [], observers = [];
  const timeouts = new Map(), intervals = [], rafs = new Map();
  let clock = 0, serial = 0, pendingSync, hasMarker = marker;
  const listeners = new WeakMap();
  const listen = (o, type, f, opts) => {
    if (!listeners.has(o)) listeners.set(o, new Map());
    const m = listeners.get(o); if (!m.has(type)) m.set(type, []);
    m.get(type).push({ f, once: !!opts?.once });
  };
  const unlisten = (o, type, f) => {
    const m = listeners.get(o); if (m) m.set(type, (m.get(type) || []).filter((x) => x.f !== f));
  };
  const fire = (o, type, data = {}) => {
    for (const x of [...(listeners.get(o)?.get(type) || [])]) {
      if (x.once) unlisten(o, type, x.f);
      x.f({ type, ...data });
    }
  };
  class El {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = new Map(); this.children = [];
      this.childNodes = this.children; this.dataset = {}; this.textContent = ''; this.parentNode = null;
      const props = new Map();
      this.style = {
        setProperty: (k, v) => { props.set(k, String(v)); events.push(['write', this, k]); },
        removeProperty: (k) => { props.delete(k); events.push(['write', this, k]); },
        getPropertyValue: (k) => props.get(k) || '', get length() { return props.size; },
      };
      this.classList = {
        contains: (k) => (this.className || '').split(/\s+/).includes(k),
        add: (k) => { this.className = `${this.className || ''} ${k}`; }, remove() {}, toggle() {},
      };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this === html || !!this.parentNode?.isConnected; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); events.push(['write', this, k]); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    getAttributeNames() { return [...this.attrs.keys()]; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); events.push(['write', this, k]); }
    toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
    append(...nodes) { for (const n of nodes) { n.remove(); n.parentNode = this; this.children.push(n); } }
    appendChild(n) { this.append(n); return n; }
    remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
    before() {} after() {}
    addEventListener(t, f, o) { listen(this, t, f, o); }
    removeEventListener(t, f) { unlisten(this, t, f); }
    // Only the fixture selectors need answers; Canvas's unrelated features see an empty page.
    matches(s) { return s === 'input' ? this.tagName === 'INPUT' : s === '[id^="gz-"]' ? this.id?.startsWith('gz-') : false; }
    closest(s) { for (let p = this; p; p = p.parentElement) if (p.matches(s)) return p; return null; }
    contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
    querySelector() { return null; }
    querySelectorAll(s) {
      queries.push([this, s]);
      if (s !== '*') return [];
      const all = []; const visit = (n) => { for (const c of n.children) { all.push(c); visit(c); } }; visit(this); return all;
    }
    getAnimations() { return []; }
    getBoundingClientRect() { events.push(['layout', this]); return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; }
    getClientRects() { events.push(['layout', this]); return [this.getBoundingClientRect()]; }
  }
  const html = new El('html'), head = new El('head'), bodyEl = new El('body');
  html.lang = 'en'; html.append(head);
  if (body) html.append(bodyEl);
  const brand = 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]';
  head.querySelector = (s) => hasMarker && s.includes(brand) ? { matches: (k) => k === brand } : null;
  const doc = {
    contentType: 'text/html', documentElement: html, head, body: body ? bodyEl : null, readyState: 'loading', hidden: false,
    querySelector: (s) => s === '#application.ic-app' && wrapper && doc.body ? bodyEl : null,
    querySelectorAll: (s) => { queries.push([doc, s]); return []; },
    getElementById: (id) => {
      const find = (n) => n.id === id ? n : n.children.map(find).find(Boolean);
      return find(html) || null;
    },
    getElementsByTagName: () => [], createElement: (t) => new El(t), createElementNS: (_, t) => new El(t),
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    createTreeWalker: () => ({ nextNode: () => null }),
    addEventListener: (t, f, o) => listen(doc, t, f, o), removeEventListener: (t, f) => unlisten(doc, t, f),
    fonts: { load: async () => [], add() {} },
  };
  const pick = (keys) => keys === null ? structuredClone(local) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in local).map((k) => [k, structuredClone(local[k])]));
  const localArea = {
    get: (keys, cb) => {
      const value = pick(keys); storage.push({ area: 'local', keys, bytes: Buffer.byteLength(JSON.stringify(value)) });
      if (cb) { Promise.resolve().then(() => cb(value)); return; } return Promise.resolve(value);
    },
    set: (o, cb) => { Object.assign(local, structuredClone(o)); storage.push({ area: 'local', op: 'set', keys: Object.keys(o) }); Promise.resolve().then(() => cb?.()); return Promise.resolve(); },
    remove: () => Promise.resolve(),
    ...(getKeys && { getKeys: async () => Object.keys(local) }),
  };
  class AuditDate extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  const c = vm.createContext({
    document: doc, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone,
    crypto: require('node:crypto').webcrypto, Date: AuditDate,
    location: { protocol: 'https:', origin: 'https://school.instructure.com', pathname, href: `https://school.instructure.com${pathname}`, search: '', hash: '' },
    navigator: { language: 'en' }, Element: El, HTMLElement: El, Node: El, SVGElement: class {}, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: (el) => {
      events.push(['style', el]);
      return { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', backgroundImage: 'none',
        position: 'static', transitionDuration: '0s', getPropertyValue: () => '' };
    },
    CSS: { supports: () => false }, matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class {
      constructor(f) { this.f = f; this.active = false; observers.push(this); }
      observe(target, options) { this.target = target; this.options = options; this.active = true; }
      disconnect() { this.active = false; this.disconnected = true; }
      takeRecords() { return []; }
      deliver(records) { assert.ok(this.active, 'deliver only to an active observer'); this.f(records, this); }
    },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    setTimeout: (f, delay = 0) => { const id = ++serial; timeouts.set(id, { f, delay, at: clock + delay }); return id; },
    clearTimeout: (id) => timeouts.delete(id),
    setInterval: (f, delay) => { intervals.push({ f, delay }); return ++serial; }, clearInterval() {},
    requestAnimationFrame: (f) => { const id = ++serial; rafs.set(id, f); return id; }, cancelAnimationFrame: (id) => rafs.delete(id),
    performance: { now: () => clock }, innerHeight: 900, innerWidth: 1400,
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
    fetch: async (url) => {
      requests.push(url);
      const value = url.includes('/users/self/colors') ? { custom_colors: {} } : url.includes('/users/self/profile') ? { id: '42' } : [];
      return { ok: true, url, text: async () => JSON.stringify(value), headers: { get: () => null } };
    },
    chrome: {
      runtime: { id: 'glaze', getURL: (f) => `chrome-extension://glaze/${f}`, sendMessage: async (m) => { sent.push(m); return { ok: false, error: 'not loaded in audit' }; } },
      storage: { local: localArea, sync: { get: (keys, cb) => { storage.push({ area: 'sync', keys }); pendingSync = () => cb(structuredClone(raw)); } },
        onChanged: { addListener: (f) => changes.push(f) } },
    },
  });
  c.window = c; c.top = frame ? {} : c; c.name = frame;
  c.addEventListener = (t, f, o) => listen(c, t, f, o); c.removeEventListener = (t, f) => unlisten(c, t, f);
  c.open = () => {}; c.postMessage = () => {};
  if (cached !== null) session.set('gz-settings', JSON.stringify(cached));
  let done;
  for (const file of files) done = vm.runInContext(read(file), c, { filename: file });
  const addBody = () => { if (!doc.body) { doc.body = bodyEl; html.append(bodyEl); } };
  const loaded = async () => { addBody(); doc.readyState = 'interactive'; fire(doc, 'DOMContentLoaded'); await settle(); };
  const answer = async () => { assert.equal(typeof pendingSync, 'function', 'settings read has started'); const f = pendingSync; pendingSync = null; f(); await settle(); };
  const advance = async (ms) => {
    const until = clock + ms; let calls = 0;
    for (;;) {
      const next = [...timeouts.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      assert.ok(++calls < 1000, 'bounded fake timer queue'); clock = next[1].at; timeouts.delete(next[0]); next[1].f(); await settle();
    }
    clock = until;
  };
  return { c, doc, html, head, body: bodyEl, El, events, queries, requests, sent, storage, observers, timeouts, intervals, session, done,
    answer, loaded, advance, addBody, fire: (type, data) => fire(doc, type, data),
    detect: () => { hasMarker = true; observers.find((o) => o.active && o.target === doc).deliver([]); },
    change: async (settings) => { raw = settings; for (const f of changes) f({ enabled: { newValue: settings.enabled } }, 'sync'); await answer(); },
    sweep: () => observers.find((o) => o.active && o.target === bodyEl),
    sheets: () => head.children.filter((el) => el.tagName === 'LINK'),
  };
};
const boot = async (opts) => { const p = page(opts); await settle(); await p.loaded(); await p.answer(); await p.done; return p; };
const added = (p, nodes) => ({ type: 'childList', target: p.body, addedNodes: nodes, removedNodes: [] });
const courseRequests = (p) => p.requests.filter((u) => /\/api\/v1\/(courses\?|users\/self\/colors)/.test(u));

test('Canvas paints the cached light palette and render-blocking sheets before storage or DOMContentLoaded', async () => {
  const saved = quiet(); saved.colors = D.GZ_PRESET('Paper');
  const p = page({ raw: saved, cached: saved }); await settle();
  assert.equal(p.doc.readyState, 'loading'); assert.equal(p.doc.body, null);
  assert.equal(p.html.style.getPropertyValue('--gz-surface'), saved.colors['--gz-surface']);
  assert.equal(p.html.style.getPropertyValue('color-scheme'), 'light');
  assert.equal(p.html.hasAttribute('data-gz-dark-theme'), false);
  assert.deepEqual(p.sheets().map((l) => l.href.split('/').pop()), ['canvas.css', 'motion.css', 'apps.css', 'coursetabs.css', 'sidebar.css', 'surfaces.css']);
  assert.ok(p.sheets().every((l) => l.getAttribute('blocking') === 'render'));
  assert.equal(p.storage.filter((r) => r.area === 'sync').length, 1);
  assert.equal(p.sweep(), undefined); assert.deepEqual(p.requests, []);
  assert.ok(!p.events.some(([kind]) => kind === 'style' || kind === 'layout'), 'theme setup needs no computed style or geometry');
  await p.answer(); await p.loaded();
});

test('Canvas site detection disconnects its document observer when the head marker arrives', async () => {
  const p = page({ marker: false }); await settle();
  assert.equal(p.sheets().length, 0); assert.equal(p.storage.length, 0);
  const detector = p.observers.find((o) => o.target === p.doc); assert.equal(detector.active, true);
  p.detect(); await settle();
  assert.equal(detector.disconnected, true); assert.equal(p.sheets().length, 6);
  await p.answer(); await p.loaded();
});

test('Canvas releases a stalled stylesheet render blocker after one second', async () => {
  const p = page(); await settle(); await p.advance(999);
  assert.ok(p.sheets().every((l) => l.hasAttribute('blocking')));
  await p.advance(1); assert.ok(p.sheets().every((l) => !l.hasAttribute('blocking')));
  await p.answer(); await p.loaded();
});

test('Canvas reinjection does not duplicate storage reads, sheets or observers', async () => {
  const p = await boot();
  const before = [p.storage.length, p.sheets().length, p.observers.length];
  await vm.runInContext(read('content.js'), p.c); await settle();
  assert.deepEqual([p.storage.length, p.sheets().length, p.observers.length], before);
});

test('a same-host tool iframe without the Canvas wrapper performs no theme, storage or sweep work', async () => {
  const p = page({ frame: 'external-tool', wrapper: false }); await settle(); await p.loaded(); await p.done;
  assert.equal(p.sheets().length, 0); assert.equal(p.storage.length, 0); assert.equal(p.sweep(), undefined);
});

test('a Canvas course-tab frame gates the footer, nav renderer, widgets, reminders, syllabus and draft cleanup', async () => {
  const raw = quiet(); Object.assign(raw.enhance, { widgets: true, notes: true, pet: true, remind: true, syllabus: true });
  raw.navbar.on = true; raw.footer = true;
  const p = await boot({ frame: 'gz-ctab:27', pathname: '/courses/27/', cached: raw, raw });
  assert.equal(p.c.GZ_CTX.tabFrame, '27'); assert.equal(p.c.GZ_CTX.solo, true);
  assert.equal(p.doc.getElementById('gz-footer'), null); assert.equal(p.html.hasAttribute('data-gz-navbar'), false);
  assert.equal(p.html.getAttribute('data-gz-navbar-frame'), 'menu');
  assert.ok(!p.sent.some((m) => m.files?.some((f) => /\/(navbar(?:-canvas)?|widgets|reminders|syllabus)\.js$/.test(f))));
  assert.ok(!p.storage.some((r) => r.keys === null || Array.isArray(r.keys) && r.keys.length === 0), 'no top-page draft enumeration');
});

test('Canvas mutation delivery performs no computed-style or geometry reads and coalesces a burst into one 150ms pass', async () => {
  const p = await boot(), el = new p.El(); p.body.append(el); p.events.length = 0;
  for (let i = 0; i < 50; i++) p.sweep().deliver([added(p, [el])]);
  assert.equal(p.events.filter(([kind]) => kind === 'style' || kind === 'layout').length, 0);
  assert.equal([...p.timeouts.values()].filter((t) => t.delay === 150).length, 1);
  await p.advance(150);
  assert.equal(p.events.filter(([kind, node]) => kind === 'style' && node === el).length, 1);
  assert.equal(p.events.filter(([kind, node]) => kind === 'layout' && node === el).length, 1);
});

test('Canvas sweep writes its new repair tags after reading all dirty elements', async () => {
  const p = await boot(), a = new p.El(), b = new p.El(); p.body.append(a, b); p.events.length = 0;
  p.sweep().deliver([added(p, [a, b])]); await p.advance(150);
  const positions = p.events.map(([kind], i) => kind === 'style' || kind === 'layout' ? i : -1);
  const lastRead = Math.max(...positions);
  const tagWrites = p.events.map(([kind, , key], i) => kind === 'write' && key === 'data-gz-light' ? i : -1).filter((i) => i >= 0);
  assert.equal(tagWrites.length, 2); assert.ok(tagWrites.every((i) => i > lastRead));
});

test('Canvas disconnects the body observer and cancels pending sweep work when disabled', async () => {
  const p = await boot(), observer = p.sweep(), el = new p.El(); p.body.append(el);
  observer.deliver([added(p, [el])]); assert.ok([...p.timeouts.values()].some((t) => t.delay === 150));
  const off = quiet(); off.enabled = false; await p.change(off);
  assert.equal(observer.disconnected, true); assert.equal(p.sweep(), undefined); assert.equal(p.sheets().length, 0);
  assert.ok(![...p.timeouts.values()].some((t) => t.delay === 150));
});

test('Canvas disconnects the body observer when the extension runtime disappears', async () => {
  const p = await boot(), observer = p.sweep(); p.c.chrome.runtime.id = undefined;
  observer.deliver([added(p, [])]); assert.equal(observer.disconnected, true); assert.equal(p.c.GZ_CTX.on(), false);
});

test('a hidden course-tab frame does no mutation sweep until it becomes visible', async () => {
  const p = await boot({ frame: 'gz-ctab:27' }), el = new p.El(); p.body.append(el);
  p.html.setAttribute('data-gz-ctab-framed', ''); p.events.length = 0; p.queries.length = 0;
  p.sweep().deliver([added(p, [el])]);
  assert.equal(p.events.length, 0); assert.equal(p.queries.length, 0);
  assert.ok(![...p.timeouts.values()].some((t) => t.delay === 150));
  p.html.removeAttribute('data-gz-ctab-framed'); p.c.GZ_CTX.scene(); await p.advance(0);
  assert.ok(p.events.some(([kind, node]) => kind === 'style' && node === el));
});

test('Canvas has no recurring idle poll; completion polling is user-triggered, at least 150ms apart and ends within 5.1s', async () => {
  const p = await boot(); assert.deepEqual(p.intervals, []);
  assert.ok(![...p.timeouts.values()].some((t) => t.delay < 1000));
  const button = new p.El('button'); p.body.append(button);
  button.closest = (s) => s.includes('#mark-as-done-checkbox') ? button : null;
  p.fire('click', { isTrusted: true, target: button });
  const pending = () => [...p.timeouts.values()].filter((t) => t.delay < 1000);
  assert.equal(pending().length, 1); assert.equal(pending()[0].delay, 150);
  await p.advance(4950); assert.equal(pending().length, 1); assert.equal(pending()[0].delay, 150);
  await p.advance(150); assert.equal(pending().length, 0);
});

test('Canvas memoizes repeated course-list requests within one document', async () => {
  const p = await boot(), count = courseRequests(p).length;
  assert.equal(count, 2);
  const first = p.c.GZ_CTX.canvasCourses();
  assert.equal(p.c.GZ_CTX.canvasCourses(), first); await first;
  assert.equal(courseRequests(p).length, count);
});

test('Canvas skips the initial full-page sweep when the document exceeds 20000 elements', async () => {
  const p = page();
  for (let i = 0; i < 20001; i++) p.body.append(new p.El());
  await settle(); await p.answer(); await p.loaded();
  assert.ok(p.sweep(), 'the observer still starts');
  assert.equal(p.events.filter(([kind]) => kind === 'style' || kind === 'layout').length, 0);
});

test('Canvas course-tab themes and render blockers are installed before DOMContentLoaded', async () => {
  // Real subframes can paint during parsing; the theme must arrive before the body.
  const p = page({ frame: 'gz-ctab:27' }); await settle();
  assert.equal(p.doc.body, null, 'started early enough to install render blockers');
  p.addBody(); await settle(); // A parser-created body may paint before DOMContentLoaded.
  const earlySheets = p.sheets().length, earlySurface = p.html.style.getPropertyValue('--gz-surface');
  await p.loaded(); await p.answer();
  assert.equal(p.sheets().length, 6, 'the same fixture does eventually theme');
  assert.equal(earlySheets, 6, `only ${earlySheets} sheets before DOMContentLoaded: native Canvas can paint first`);
  assert.ok(earlySurface, 'cached palette must be present while parsing');
});

test('Canvas course-tab navigation leaves course-list and color recording to the top page', async () => {
  const p = await boot({ frame: 'gz-ctab:27' });
  assert.equal(courseRequests(p).length, 0, `course-tab document made ${courseRequests(p).length} redundant account-wide requests`);
});

test('Canvas reuses a fresh course/color snapshot across same-tab document loads', async () => {
  const session = new Map(), local = {};
  const first = await boot({ session, local, cached: null });
  const second = await boot({ session, local, cached: null, pathname: '/courses/27/pages/next' });
  assert.equal(courseRequests(first).length, 2, 'one initial course/color refresh is allowed');
  assert.equal(courseRequests(second).length, 0, 'immediate next document should reuse that fresh account-wide snapshot');
});

test('an unrelated Canvas mutation does not rescan every dashboard card and planner group', async () => {
  const p = await boot(), widget = new p.El(); widget.id = 'gz-widget'; p.body.append(widget); p.queries.length = 0;
  p.sweep().deliver([{ type: 'attributes', target: widget, attributeName: 'style', oldValue: '' }]);
  const scans = p.queries.filter(([node, sel]) => node === p.doc && ['.ic-DashboardCard', '.planner-grouping'].includes(sel));
  assert.equal(scans.length, 0, `${scans.length} whole-document color scans for a Glaze widget style mutation`);
});

test('Canvas applies the 20000-element sweep cap to an added subtree', async () => {
  const p = await boot(), root = new p.El(); p.body.append(root);
  for (let i = 0; i < 20001; i++) root.append(new p.El());
  p.events.length = 0; p.sweep().deliver([added(p, [root])]); await p.advance(150);
  const styles = p.events.filter(([kind]) => kind === 'style').length;
  const geometry = p.events.filter(([kind]) => kind === 'layout').length;
  assert.ok(styles <= 20000 && geometry <= 20000, `added subtree bypassed MAX_FULL: ${styles} style reads and ${geometry} geometry reads`);
});

test('Canvas skips sticker storage when stickers, rotation and custom cursor are all off', async () => {
  const p = await boot();
  const reads = p.storage.filter((r) => r.area === 'local' && typeof r.keys === 'string' && r.keys.startsWith('stk:'));
  assert.equal(reads.length, 0, `${reads.length} route-specific sticker storage reads with every Look extra off`);
});

test('Canvas startup without storage.getKeys reads all local storage for draft cleanup at most once a day', async () => {
  const local = { unrelatedArtwork: 'x'.repeat(1024 * 1024) };
  const bulk = (p) => p.storage.filter((r) => r.area === 'local' && r.keys === null);
  const first = await boot({ getKeys: false, local });
  assert.equal(bulk(first).length, 1, 'old and switched-off copies still go where keys cannot be listed');
  assert.ok('draftsSwept' in local, 'the sweep is noted');
  const again = await boot({ getKeys: false, local });
  assert.equal(bulk(again).length, 0, `read all local storage again (${bulk(again).reduce((n, r) => n + r.bytes, 0)} bytes) the same day`);
});
