// Exercise the head script with navigation events and a controlled animation clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const { El } = require('./stand-in-dom.js');
const source = fs.readFileSync(process.env.PAPERS_MOTION_SOURCE || require.resolve('../papers-motion.js'), 'utf8');
const KEY = 'gz-documents-route';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const page = ({ raw, anim = 'genie', ready = true, failAnimation = false, name = '' } = {}) => {
  const listeners = new Map(), observers = [], raf = new Map(), animations = [], data = new Map(raw ? [[KEY, JSON.stringify(raw)]] : []);
  let clock = 0, frame = 0, changed;
  const doc = { hidden: false };
  const html = doc.root = doc.documentElement = new El('html', doc);
  html.setAttribute('data-gz-motion', 'expressive');
  doc.body = new El('body', doc); html.append(doc.body);
  doc.querySelector = (s) => html.querySelector(s); doc.getElementById = (id) => html.querySelector(`#${id}`);
  doc.addEventListener = (t, f) => { const all = listeners.get(t) || []; all.push(f); listeners.set(t, all); };
  const animate = function (frames, options) {
    if (failAnimation) throw Error('unsupported pseudo-element');
    let resolve, reject;
    const a = { frames, options, playState: 'running', finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
      cancel() { this.playState = 'idle'; reject(Error('cancelled')); }, finish() { this.playState = 'finished'; resolve(); }, reverse() {} };
    a.finished.catch(() => {}); animations.push(a); return a;
  };
  html.animate = animate;
  const media = { matches: false, addEventListener(t, f) { this.change = f; } };
  const ctx = vm.createContext({ document: doc, innerWidth: 1280, innerHeight: 900, scrollY: 0, name,
    location: new URL('https://extension.test/papers.html?paper=doc:a'), history: {}, URL, URLSearchParams, CSS: { escape: (x) => x },
    GZ_POPUP_LIB: require('../lib/popup.js'), GZ_MOTION: { enter: (e) => e.animate([], {}), exit: (e) => { e.remove(); return Promise.resolve(); } },
    chrome: { storage: { sync: { get: async () => ({ popup: { anim } }) }, onChanged: { addListener: (f) => { changed = f; } } } },
    matchMedia: () => media, sessionStorage: { getItem: (k) => data.get(k) || null, removeItem: (k) => data.delete(k), setItem: (k, v) => data.set(k, v) },
    performance: { now: () => clock }, Date, requestAnimationFrame: (f) => { raf.set(++frame, f); return frame; }, cancelAnimationFrame: (id) => raf.delete(id),
    MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe() {} disconnect() {} },
    addEventListener: doc.addEventListener, scrollTo() {} });
  vm.runInContext(source, ctx);
  let skipped = 0, finish;
  const vt = { ready: ready ? Promise.resolve() : new Promise(() => {}), finished: new Promise((r) => { finish = r; }), skipTransition() { skipped++; finish(); } };
  const event = (type, more = {}) => { for (const f of listeners.get(type) || []) f({ type, ...more }); };
  const record = { at: ctx.location.search, kind: 'genie', context: name, time: Date.now(), from: 'https://extension.test/papers.html', view: { width: 1280, height: 900 }, ...raw };
  return { ctx, doc, html, data, animations, vt, media, event, skipped: () => skipped,
    reveal: () => event('pagereveal', { viewTransition: vt }), record,
    tick: (t) => { clock = t; const all = [...raf.values()]; raf.clear(); for (const f of all) f(t); },
    change: (value) => changed({ popup: { newValue: { anim: value } } }, 'sync'),
    mutate: () => observers.forEach((o) => o.f([])),
    menu: () => { const el = new El('div', doc); el.className = 'gd-menu'; el.classList = { contains: (x) => x === 'gd-menu' }; el.animate = animate; el.box = { left: 100, top: 100, width: 200, height: 200 };
      el.cloneNode = () => { const copy = new El('div', doc); copy.className = 'gd-menu'; copy.animate = animate; return copy; };
      doc.body.append(el); return el; } };
};
const pending = async (options) => {
  const p = page(options); p.data.set(KEY, JSON.stringify(p.record));
  // New documents consume at initialization; use a second page with the stored handoff.
  const q = page({ ...options, raw: p.record }); await flush(); q.reveal(); await flush(); return q;
};

test('an unmatched native transition is skipped instead of using the UA crossfade', async () => {
  const p = page(); await flush(); p.reveal(); await flush(); assert.equal(p.skipped(), 1);
});
test('a stale record is consumed even in a browser without pagereveal', () => {
  const p = page({ raw: { at: '?paper=old', kind: 'genie' } }); assert.equal(p.data.has(KEY), false);
});
test('the hold deadline releases a failed editor and a transition whose ready never resolves', async () => {
  for (const ready of [true, false]) {
    const p = await pending({ ready }); p.tick(1201); await flush();
    assert.equal(p.skipped(), 1); assert.equal(p.html.hasAttribute('data-gd-route'), false);
  }
});
test('Off on the arriving page skips the native transition before starting any animations', async () => {
  const p = page(); p.record.kind = 'genie';
  const q = page({ raw: p.record }); q.html.setAttribute('data-gz-motion', 'off'); await flush(); q.reveal(); await flush();
  assert.equal(q.skipped(), 1); assert.equal(q.animations.length, 0);
});
test('popup None is instant for menus and immediately stops a pending native transition', async () => {
  const p = page({ anim: 'none' }); await flush(); const menu = p.menu(); p.ctx.GZ_PAPERS_MOTION.open(menu);
  assert.equal(p.animations.length, 0); p.ctx.GZ_PAPERS_MOTION.leave(menu); assert.equal(menu.isConnected, false);
  const q = await pending(); q.change('none'); await flush(); assert.equal(q.skipped(), 1);
});
test('expired and other-frame handoffs are skipped and consumed', async () => {
  for (const raw of [{ time: Date.now() - 60000 }, { context: 'removed-frame' }]) {
    const p = await pending({ raw }); assert.equal(p.skipped(), 1); assert.equal(p.data.has(KEY), false);
  }
});
test('pagehide and a persisted pageshow release a pending transition', async () => {
  const p = await pending(); p.event('pagehide'); p.event('pageshow', { persisted: true }); await flush();
  assert.ok(p.skipped()); assert.equal(p.html.hasAttribute('data-gd-route'), false);
});
test('a failure to animate the held picture skips cleanly', async () => {
  const p = await pending({ failAnimation: true }); assert.equal(p.skipped(), 1); assert.equal(p.html.hasAttribute('data-gd-route'), false);
});

// The menu's source is smaller and wholly visible so these cases take the genie path.
const button = (p) => { const b = new El('button', p.doc); b.box = { left: 100, top: 60, width: 32, height: 32 }; p.doc.body.append(b); return b; };
test('menu copies are inaccessible, and detaching the real menu or leaving removes them', async () => {
  for (const exit of ['detach', 'pagehide', 'none']) {
    const p = page(); await flush(); const menu = p.menu(); p.ctx.GZ_PAPERS_MOTION.open(menu, button(p));
    const copy = p.doc.body.children.find((e) => e !== menu && e.className === 'gd-menu');
    assert.ok(copy); assert.equal(copy.inert, true); assert.equal(copy.getAttribute('aria-hidden'), 'true');
    if (exit === 'detach') { menu.remove(); p.mutate(); } else if (exit === 'none') p.change('none'); else p.event('pagehide');
    await flush(); assert.equal(copy.isConnected, false);
    assert.equal(p.animations.filter((a) => a.playState === 'running').length, 0);
  }
});
test('a partially created menu animation removes its copy when the second animate throws', async () => {
  const p = page(); await flush(); const menu = p.menu(); menu.animate = () => { throw Error('no animation'); };
  p.ctx.GZ_PAPERS_MOTION.open(menu, button(p)); await flush();
  assert.equal(p.doc.body.children.filter((e) => e.className === 'gd-menu').length, 1);
});
test('a live Fade entrance is cancelled when Pop-up animation becomes None', async () => {
  const p = page({ anim: 'fade' }); await flush(); p.ctx.GZ_PAPERS_MOTION.open(p.menu()); p.change('none'); await flush();
  assert.equal(p.animations.filter((a) => a.playState === 'running').length, 0);
});
