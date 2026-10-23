// Blackboard Ultra with Glaze turned off (WP-C1: CORE-1, CORE-3, CORE-4): the manifest's real Ultra scripts in a VM, with
// the settings read, DOMContentLoaded and this tab's sessionStorage copy controlled separately. No browser or LMS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const manifest = require('../manifest.json');
const files = manifest.content_scripts.find((s) => s.js.includes('content-ultra.js')).js;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
// A Blackboard host, approved without asking (WP-C2): these tests are about Glaze's switch, not consent.
const ORIGIN = 'https://school.blackboard.com';
const OWN = ['theme.css', 'motion.css', 'extras.css', 'apps.css', 'coursetabs.css', 'sidebar.css', 'surfaces.css'];

// cached: this tab's sessionStorage copy (null: a fresh tab). raw: what storage.sync answers when asked.
const page = ({ cached = null, raw = {}, local = {}, pathname = '/ultra/course', getKeys = true } = {}) => {
  const requests = [], sent = [], writes = [], observers = [], session = new Map(), changes = [];
  const listeners = new Map();
  let pendingSync = null;
  class El {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = new Map(); this.children = []; this.childNodes = this.children;
      this.dataset = {}; this.textContent = ''; this.parentNode = null;
      const props = new Map();
      this.style = { setProperty: (k, v) => props.set(k, String(v)), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '', get length() { return props.size; } };
      this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
    }
    get parentElement() { return this.parentNode; }
    get isConnected() { return this === html || !!this.parentNode?.isConnected; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    getAttributeNames() { return [...this.attrs.keys()]; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
    append(...nodes) { for (const n of nodes) { n.remove?.(); n.parentNode = this; this.children.push(n); } }
    appendChild(n) { this.append(n); return n; }
    remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
    before() {} after() {} addEventListener() {} removeEventListener() {}
    matches() { return false; } closest() { return null; } contains() { return false; }
    querySelector() { return null; } querySelectorAll() { return []; } getElementsByClassName() { return []; } getElementsByTagName() { return []; }
    getAnimations() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; } getClientRects() { return []; }
  }
  const html = new El('html'), head = new El('head'), bodyEl = new El('body');
  html.lang = 'en'; html.append(head);
  const ULTRA = 'base[href*="/ultra/"]';
  head.querySelector = (s) => (s.includes(ULTRA) ? { matches: (k) => k === ULTRA } : null);
  const doc = {
    contentType: 'text/html', documentElement: html, head, body: null, readyState: 'loading', hidden: false, visibilityState: 'visible',
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [], getElementsByClassName: () => [],
    createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: (text) => ({ nodeType: 3, textContent: text }),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(f); },
    removeEventListener: (t, f) => listeners.set(t, (listeners.get(t) || []).filter((x) => x !== f)),
    fonts: { load: async () => [], add() {} },
  };
  const area = (name, store) => ({
    get: (keys, cb) => {
      const pick = () => (keys === null ? structuredClone(store) : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])));
      // The settings read waits for answer(); anything else answers at once.
      if (name === 'sync' && Array.isArray(keys) && keys.includes('enabled')) { pendingSync = () => cb(pick()); return; }
      if (cb) { Promise.resolve().then(() => cb(pick())); return; }
      return Promise.resolve(pick());
    },
    set: (o, cb) => { writes.push([name, Object.keys(o)]); Object.assign(store, structuredClone(o)); Promise.resolve().then(() => cb?.()); return Promise.resolve(); },
    remove: (k, cb) => { Promise.resolve().then(() => cb?.()); return Promise.resolve(); },
    getKeys: getKeys ? async () => Object.keys(store) : undefined,
  });
  const c = vm.createContext({
    document: doc, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto,
    location: { protocol: 'https:', origin: ORIGIN, hostname: new URL(ORIGIN).hostname, pathname, href: `${ORIGIN}${pathname}`, search: '', hash: '' },
    navigator: { language: 'en' }, Element: El, HTMLElement: El, Node: El, SVGElement: class {}, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', backgroundImage: 'none', position: 'static', transitionDuration: '0s', getPropertyValue: () => '' }),
    CSS: { supports: () => false }, matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class {
      constructor(f) { this.f = f; observers.push(this); }
      observe(target) { this.target = target; this.active = true; }
      disconnect() { this.active = false; }
      takeRecords() { return []; }
    },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    PerformanceObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance: { now: () => 0 }, innerHeight: 900, innerWidth: 1400,
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)), removeItem: (k) => session.delete(k) },
    fetch: async (url) => { requests.push(url); return { ok: true, url, text: async () => '{"results":[]}', headers: { get: () => null } }; },
    chrome: {
      runtime: { id: 'glaze', getURL: (f) => `chrome-extension://glaze/${f}`, getManifest: () => ({}), sendMessage: async (m) => { sent.push(m); return { ok: false, error: 'not loaded here' }; } },
      storage: { sync: area('sync', raw), local: area('local', local), onChanged: { addListener: (f) => changes.push(f) } },
    },
  });
  c.window = c; c.top = c; c.name = ''; c.globalThis = c;
  if (cached !== null) session.set('gz-settings', JSON.stringify(cached));
  let done;
  for (const file of files) done = vm.runInContext(read(file), c, { filename: file });
  return {
    c, html, head, session, requests, sent, writes, done,
    sheets: () => head.children.filter((e) => e.tagName === 'LINK').map((l) => l.href.split('/').pop()),
    sweeping: () => observers.some((o) => o.active && o.target === bodyEl),
    loaded: async () => { doc.body = bodyEl; html.append(bodyEl); doc.readyState = 'interactive'; for (const f of listeners.get('DOMContentLoaded') || []) f({ type: 'DOMContentLoaded' }); await settle(); },
    answer: async () => { assert.equal(typeof pendingSync, 'function', 'the settings read has started'); const f = pendingSync; pendingSync = null; f(); await settle(); },
    // Glaze's switch changed elsewhere (the popup): storage.onChanged, then the settings read it starts.
    change: async (next) => { Object.assign(raw, next); for (const f of changes) f(Object.fromEntries(Object.keys(next).map((k) => [k, { newValue: next[k] }])), 'sync'); await settle(); },
    localChange: async (next) => { for (const f of changes) f(Object.fromEntries(Object.keys(next).map((k) => [k, { newValue: next[k] }])), 'local'); await settle(); },
    kept: () => JSON.parse(session.get('gz-settings') || 'null'),
  };
};
// Work Glaze must not do while it is off: Ultra's API, the course list, the due list, registering the site, and loading
// the features that do those (the sidebar's To Do, the widgets, the Dashboard's landing).
const traces = (p) => ({
  requests: p.requests,
  loads: p.sent.filter((m) => m?.type === 'glaze:load').flatMap((m) => m.files),
  messages: p.sent.filter((m) => m?.type !== 'glaze:load').map((m) => m.type),
  local: p.writes.filter(([area]) => area === 'local').flatMap(([, keys]) => keys).filter((k) => /^(dueWeek|dueWeekAt|dueWeekFrom|seenCourses|seenCoursesAt|courseSlots|ultra)$/.test(k)),
  sweeping: p.sweeping(),
});
const idle = { requests: [], loads: [], messages: [], local: [], sweeping: false };

test('CORE-4: widget changes during the first storage read wait for the enabled decision', async () => {
  const p = page({ raw: { enabled: false } }); await settle();
  await p.localChange({ widgetLayout: { boards: { pages: [{ on: true }] } } });
  assert.deepEqual(traces(p), idle, 'a concurrent widget edit cannot start widgets or redirect the fresh tab');
  await p.answer(); await p.loaded();
  assert.deepEqual(traces(p), idle);
});

test('CORE-4: off does not write draft cleanup metadata on browsers without getKeys', async () => {
  const p = page({ raw: { enabled: false }, getKeys: false }); await settle();
  await p.answer(); await p.loaded();
  assert.deepEqual(p.writes, [], 'draft maintenance must respect the off state too');
});

test('CORE-1: with this tab\'s copy saying off, no Glaze stylesheet stays on an Ultra page', async () => {
  const off = D.GZ_SANITIZE({ enabled: false });
  const p = page({ cached: off, raw: { enabled: false } }); await settle();
  assert.deepEqual(p.sheets(), [], 'the early sheets content-ultra.js put in are gone once the first decision is off');
  await p.answer();
  assert.deepEqual(p.sheets(), []);
  await p.loaded();
  assert.deepEqual(p.sheets(), [], 'not after the body either');
  assert.deepEqual(traces(p), idle);
});

test('CORE-1: turning Glaze off takes the early Ultra sheets off too, and turning it on again puts them back', async () => {
  const p = page({ cached: D.GZ_SANITIZE({}), raw: {} }); await settle();
  await p.answer(); await p.loaded();
  assert.deepEqual(p.sheets(), ['theme.css', 'motion.css', 'extras.css', 'apps.css', 'coursetabs.css', 'sidebar.css', 'surfaces.css']);
  await p.change({ enabled: false }); await p.answer();
  assert.deepEqual(p.sheets(), []);
  await p.change({ enabled: true }); await p.answer();
  assert.deepEqual(p.sheets(), OWN, 'on again without a reload');
});

test('CORE-1: a page that loaded with Glaze off themes again when it is turned on', async () => {
  const p = page({ cached: D.GZ_SANITIZE({ enabled: false }), raw: { enabled: false } }); await settle();
  await p.answer(); await p.loaded();
  assert.deepEqual(p.sheets(), []);
  await p.change({ enabled: true }); await p.answer();
  assert.deepEqual(p.sheets(), OWN);
  assert.ok(p.html.style.getPropertyValue('--gz-surface'), 'the palette is on <html> again');
});

test('CORE-4: in a fresh tab with Glaze off, nothing runs before or after storage answers', async () => {
  const p = page({ raw: { enabled: false } }); await settle();
  // The body arrives before storage answers: Ultra must not start on the defaults.
  await p.loaded();
  assert.deepEqual(traces(p), idle, 'no sweep, API call, registration or storage write before the settings are known');
  await p.answer();
  assert.deepEqual(traces(p), idle, 'nor after');
  assert.deepEqual(p.sheets(), []);
  assert.equal(p.kept().enabled, false);
});

test('CORE-4: with Glaze on, the theme goes on from the cached copy at once and the sweep starts once storage answers', async () => {
  const saved = D.GZ_SANITIZE({ colors: D.GZ_PRESET('Paper') });
  const p = page({ cached: saved, raw: { colors: D.GZ_PRESET('Paper') } }); await settle();
  assert.deepEqual(p.sheets(), OWN);
  assert.equal(p.html.style.getPropertyValue('--gz-surface'), saved.colors['--gz-surface'], 'first paint has the palette before storage answers');
  await p.loaded();
  assert.equal(p.sweeping(), false, 'the sweep waits for storage');
  assert.deepEqual(p.requests, []);
  await p.answer();
  assert.equal(p.sweeping(), true);
  assert.ok(traces(p).loads.includes('features/sidebar.js'), 'the sidebar starts as soon as the settings are in, without waiting for a pass');
});

test('CORE-3: the copy in the page\'s sessionStorage holds what first paint needs and nothing else', async () => {
  const mine = { name: 'Alice night', colors: D.GZ_PRESET('Midnight') };
  const raw = {
    colors: D.GZ_PRESET('Ember'), preset: 'Alice night', presets: [mine, { name: 'Alice day', colors: D.GZ_PRESET('Paper') }],
    auto: { on: true, mode: 'device', light: 'Alice day', dark: 'Alice night' },
    look: { radius: 18, scale: 1.1, font: 'outfit' },
    bg: { kind: 'image', image: 'https://photos.example.com/alice-private.jpg', dim: 40 },
    nav: { k: 'image', u: 'https://pics.example.net/nav.png', i: 'abcdefabcdef' },
    sidebar: { title: 'Alice\'s planner' },
    declutter: { banner: true },
    courses: { colors: { 'canvas:https://canvas.otherschool.edu/4521': '#ff0000', _77_1: '#00ff00' }, tint: true, tinted: ['moodle:https://moodle.college.ac.uk/77'], looks: { _77_1: 'Library' }, strength: 70 },
  };
  const p = page({ raw }); await settle(); await p.answer();
  const text = p.session.get('gz-settings');
  for (const secret of ['photos.example.com', 'pics.example.net', 'abcdefabcdef', 'otherschool', 'college.ac.uk', '_77_1', 'Library', 'Alice']) {
    assert.ok(!text.includes(secret), `the copy leaks ${secret}`);
  }
  // What it keeps paints the same first frame: the palette in light and dark, the Look's numbers, the background's kind.
  const s = D.GZ_SANITIZE(raw), first = D.GZ_SANITIZE(p.kept());
  for (const dark of [false, true]) assert.deepEqual(D.GZ_ACTIVE_COLORS(first, dark), D.GZ_ACTIVE_COLORS(s, dark));
  assert.deepEqual(first.look, s.look);
  assert.equal(first.bg.kind, 'image'); assert.equal(first.bg.dim, 40);
  assert.equal(first.nav.k, 'image');
  assert.deepEqual(first.declutter, s.declutter);
  assert.equal(first.courses.tint, true); assert.equal(first.courses.strength, 70);
  assert.equal(first.enabled, true);
});
