// Code on demand (content.js need()) recovers by itself: a 'glaze:load' that fails (the worker not answering yet, a lost
// reply, Safari's undefined) is asked again with backoff, and once it is in, the sync that wanted it runs, with no page
// event in between. A refusal that won't change ('not loadable', 'sender') or an extension that is gone isn't asked again,
// and a retry never loads a file twice when a sync asks for it meanwhile. The real content.js on a stand-in Ultra page.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
class El {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.kids = []; this.dataset = {}; this.childNodes = []; this.children = []; this.nodeType = 1;
    const props = new Map(); this.style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '', length: 0 };
    this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} }; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); } toggleAttribute(k, on) { if (on) this.attrs.set(k, ''); else this.attrs.delete(k); }
  getAttributeNames() { return [...this.attrs.keys()]; } addEventListener() {} removeEventListener() {}
  querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; } matches() { return false; } contains() { return false; }
  append(...n) { this.kids.push(...n); } appendChild(n) { this.kids.push(n); return n; } before() {} after() {} remove() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; } getClientRects() { return []; }
}

// An Ultra page with Glaze navigation on (its default), so syncNav needs features/navbar.js. `answer(n)` is the worker's
// reply to the n-th ask for it (a value, or a promise); every other file is refused for good.
const boot = async (answer) => {
  let now = 0;
  const timers = [];
  const html = new El('html'); html.lang = 'en';
  const head = new El('head'); head.querySelector = (sel) => (sel.includes('base[href*="/ultra/"]') ? { matches: () => true } : null);
  const body = new El('body'); body.contains = () => true;
  const document = { contentType: 'text/html', documentElement: html, head, body, readyState: 'interactive', hidden: false,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [],
    createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), createTextNode: () => new El('#text'),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener() {}, removeEventListener() {}, fonts: { load: () => Promise.resolve([]), add() {} } };
  const area = () => ({ get: (k, cb) => (cb ? cb({ ultra: ['https://school.test'] }) : Promise.resolve({})), set: (o, cb) => { cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } });
  const location = { protocol: 'https:', origin: 'https://school.test', pathname: '/ultra/stream', href: 'https://school.test/ultra/stream', search: '', hash: '' };
  const asks = [], syncs = [], changed = [];
  const c = vm.createContext({ document, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto, location,
    navigator: { language: 'en' }, Element: El, HTMLElement: El, SVGElement: class {}, Node: El, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ getPropertyValue: () => '', color: '', backgroundColor: '' }), CSS: { supports: () => false },
    matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    setTimeout: (f, ms = 0) => { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => now }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerHeight: 900, innerWidth: 1400,
    fetch: () => Promise.resolve({ ok: true, url: 'https://school.test/', text: () => Promise.resolve('[]'), json: () => Promise.resolve([]), headers: { get: () => null } }),
    chrome: { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, lastError: undefined,
      sendMessage: (m) => {
        if (m?.type !== 'glaze:load') return Promise.resolve({ ok: false });
        if (!m.files.includes('features/navbar.js')) return Promise.resolve({ ok: false, error: 'not loadable' });
        asks.push(now);
        return Promise.resolve(answer(asks.length, c)).then((r) => {
          if (r?.ok) c.GZ_NAVBAR_UI ||= { sync: () => syncs.push(now), live: () => false };
          return r;
        });
      } },
      storage: { sync: { get: (k, cb) => cb({}) }, local: area(), onChanged: { addListener: (f) => changed.push(f) } } } });
  c.window = c; c.top = c; c.globalThis = c;
  for (const f of ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/nav.js', 'content-ultra.js']) vm.runInContext(read(f), c, { filename: f });
  vm.runInContext(read('content.js'), c, { filename: 'content.js' });
  await settle();
  // Time passes, and nothing else happens on the page: only timers that come due run.
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
  await wait(500); // the first pass: the bar is asked for
  // A settings change, which syncs everything again.
  const change = () => { for (const f of changed) f({ motion: { newValue: { level: 'subtle' } } }, 'sync'); };
  return { c, asks, syncs, wait, change };
};

test('a failed load is asked again by itself, and the bar comes in and syncs with no page event in between', async () => {
  // A lost reply, then Safari's undefined (no worker answer), then the worker loads it.
  const p = await boot((n) => (n === 1 ? Promise.reject(new Error('Could not establish connection. Receiving end does not exist.')) : n === 2 ? undefined : { ok: true }));
  assert.equal(p.asks.length, 1, 'asked once at first');
  await p.wait(60000);
  assert.equal(p.asks.length, 3, `asked again with backoff until it came (${p.asks.join(', ')})`);
  assert.ok(p.asks[1] - p.asks[0] >= 1000 && p.asks[2] - p.asks[1] > p.asks[1] - p.asks[0], 'each wait longer than the last');
  assert.ok(p.syncs.length >= 1, 'the bar synced once it was in');
  await p.wait(10 * 60000);
  assert.equal(p.asks.length, 3, 'nothing asked again once it is in');
});

test('a retry gives up after a few minutes, and refusals and a removed extension are not asked again', async () => {
  const p = await boot(() => ({ ok: false, error: 'the frame holds another document now' }));
  await p.wait(30 * 60000);
  const n = p.asks.length;
  assert.ok(n > 3 && n < 20, `a bounded number of retries (${n})`);
  assert.ok(p.asks.at(-1) <= 6 * 60000, `given up within a few minutes (last at ${p.asks.at(-1)} ms)`);
  for (const error of ['not loadable', 'sender']) {
    const q = await boot(() => ({ ok: false, error }));
    await q.wait(10 * 60000);
    assert.equal(q.asks.length, 1, `${error}: not asked again`);
  }
  const r = await boot((n, c) => { delete c.chrome.runtime.id; return { ok: false, error: 'reloaded' }; });
  await r.wait(10 * 60000);
  assert.equal(r.asks.length, 1, 'the extension gone: not asked again');
});

test('a retry in flight is the one a sync gets: no file is loaded twice', async () => {
  let release;
  const p = await boot((n) => (n === 1 ? undefined : new Promise((res) => { release = () => res({ ok: true }); })));
  await p.wait(1500); // the retry is out, its answer not back yet
  assert.equal(p.asks.length, 2);
  for (let i = 0; i < 3; i++) { p.change(); await p.wait(10); }
  assert.equal(p.asks.length, 2, 'syncs meanwhile share the retry');
  release();
  await p.wait(100);
  assert.equal(p.asks.length, 2);
  assert.ok(p.syncs.length >= 1);
});
