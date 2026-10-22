// Glaze restarted under an open page (an update, Safari re-registering it): the browser runs Glaze's content scripts again
// in that page, in a world of their own, beside the old copy's. The whole of features/coursetabs.js twice over one stand-in
// page: the fresh copy takes the page over, as after a reload, and the old one lets go.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { GZ_SANITIZE } = require('../defaults.js');
const L = require('../lib/coursetabs.js');
const { El } = require('./stand-in-dom.js');
const source = fs.readFileSync(path.join(__dirname, '../features/coursetabs.js'), 'utf8');
const origin = 'https://bb.school.test';
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };

// The page both copies share: its document, its sessionStorage, the window's events (they reach every world).
const page = () => {
  const doc = { activeElement: null, visibilityState: 'visible' };
  class E extends El { get localName() { return this.tagName.toLowerCase(); } getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; } }
  const root = new E('#document', doc);
  doc.root = root;
  const html = new E('html', doc), head = new E('head', doc), body = new E('body', doc);
  root.append(html); html.append(head, body);
  const q = (s) => { try { return root.querySelectorAll(s); } catch { return []; } }; // (selectors the stand-in can't read: none)
  const bars = new Proxy([], { get: (_, k) => { const a = root.all().filter((e) => String(e.className).split(/\s+/).includes('bb-course-navigation')); return k === 'length' ? a.length : a[k]; } });
  Object.assign(doc, { documentElement: html, head, body, scrollingElement: html,
    createElement: (t) => new E(t, doc), createElementNS: (_, t) => new E(t, doc),
    getElementById: (id) => root.all().find((e) => e.id === id) || null, querySelectorAll: q, querySelector: (s) => q(s)[0] || null,
    getElementsByClassName: () => bars, addEventListener() {}, removeEventListener() {} });
  const bar = new E('div', doc); bar.className = 'bb-course-navigation'; body.append(bar);
  const store = new Map();
  const events = new Map();
  return { doc, html, body, bar,
    session: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    on: (type, f) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(f); },
    off: (type, f) => events.get(type)?.delete(f),
    fire: (e) => { for (const f of [...(events.get(e.type) || [])]) f(e); return true; },
  };
};

// One copy of Glaze in that page: its own globals and extension context, the page's document.
const glaze = (p, local) => {
  const sent = [];
  const chrome = {
    runtime: { id: 'glaze', getURL: (f) => `safari-web-extension://glaze/${f}`, onMessage: { addListener() {} },
      sendMessage: (m) => { sent.push(m); return Promise.resolve(m.op === 'hello' ? { ok: true, epoch: 1 } : null); } },
    storage: { sync: { get: (k, cb) => cb({}) }, local: { get: (k, cb) => cb({ [k]: local[k] }), set: (o) => Object.assign(local, o) }, onChanged: { addListener() {}, removeListener() {} } },
  };
  const ctx = { site: 'ultra', tabFrame: '', t: (s) => s, locale: () => 'en', courseId: () => '_1_1', courseList: () => ({}), courseColors: () => ({}), nickOf: () => '',
    me: async () => '_9_1', settings: () => ({ tabs: GZ_SANITIZE({}).tabs }), scene() {}, holding: () => false, acted: () => 0, on: () => true };
  const c = { GZ_CTX: ctx, GZ_CTABS_LIB: L, GZ_SANITIZE, chrome, document: p.doc, sessionStorage: p.session,
    location: { origin, protocol: 'https:', pathname: '/ultra/courses/_1_1/outline', search: '', href: `${origin}/ultra/courses/_1_1/outline` },
    performance: { now: () => 0, timeOrigin: 0 }, Element: El, Event: class { constructor(type) { this.type = type; } },
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, innerWidth: 1280, innerHeight: 800,
    addEventListener: p.on, removeEventListener: p.off, dispatchEvent: p.fire };
  c.globalThis = c; c.window = c; c.top = c; c.parent = c;
  vm.createContext(c);
  const api = vm.runInContext(source, c);
  return { api, c, sent, chrome };
};

const course = '_53708_1';
const frames = (p) => p.doc.querySelectorAll('iframe').filter((e) => e.name === `gz-ctab:${course}`);

test('a fresh copy of Glaze takes over the frames, strip and marks the old copy left on the page', async () => {
  const p = page(), local = {};
  local[L.storeKey(origin, '_9_1')] = { tabs: [{ cid: '_1_1', at: 1 }, { cid: course, at: 2 }] };
  const old = glaze(p, local);
  old.api.sync(true);
  await settle();
  old.api.bar.visit(course);
  await settle();
  assert.equal(old.api.showing(), course);
  assert.equal(frames(p).length, 1);
  assert.equal(p.session.getItem('gz-ctabs-shown'), course);
  p.html.setAttribute('data-gz-placing', '');

  // Glaze restarts: the old copy is cut off from the extension, and a new one runs in the same page.
  old.chrome.runtime.id = undefined;
  const fresh = glaze(p, local);
  fresh.api.sync(true);
  await settle();

  assert.equal(p.doc.querySelectorAll('#gz-ctabs-frames').length, 1, 'one place for the frames');
  assert.equal(frames(p).length, 1, 'one frame for the course');
  assert.equal(fresh.api.showing(), course, 'the course on screen before is on screen again');
  assert.equal(p.doc.querySelectorAll('#gz-ctabs').length, 1, 'one strip');
  assert.equal(p.doc.querySelectorAll('#gz-ctabs-say').length, 1, 'one word over the page');
  assert.ok(p.html.hasAttribute('data-gz-ctab-framed'));
  assert.equal(p.html.hasAttribute('data-gz-placing'), false);

  // The old copy keeps its own references, but no longer puts anything back.
  p.bar.replaceChildren();
  old.api.held();
  assert.equal(p.doc.querySelectorAll('#gz-ctabs').length, 0, 'the old copy\'s strip stays gone');
});

test('a fresh copy that opens no frame leaves the page uncovered, as after a reload', async () => {
  for (const was of ['hidden', 'closed']) {
    const p = page(), local = {};
    const k = L.storeKey(origin, '_9_1');
    local[k] = { tabs: [{ cid: '_1_1', at: 1 }, { cid: course, at: 2 }] };
    const old = glaze(p, local);
    old.api.sync(true);
    await settle();
    old.api.bar.visit(course);
    await settle();
    // Back on this page, the frame kept hidden; or its tab closed in another browser tab as Glaze restarted.
    if (was === 'hidden') old.api.bar.leave();
    else local[k] = { tabs: [{ cid: '_1_1', at: 1 }] };
    await settle();
    old.chrome.runtime.id = undefined;
    const fresh = glaze(p, local);
    fresh.api.sync(true);
    await settle();
    assert.equal(p.doc.querySelectorAll('#gz-ctabs-frames').length, 0, `${was}: no frames until a tab is picked`);
    assert.equal(frames(p).length, 0, was);
    assert.equal(fresh.api.showing(), '', was);
    assert.equal(p.html.hasAttribute('data-gz-ctab-framed'), false, `${was}: the page is not covered`);
    assert.equal(p.doc.querySelectorAll('#gz-ctabs').length, 1, was);
  }
});

test('a single copy keeps its own strip and frames across passes and toggles', async () => {
  const p = page(), local = {};
  local[L.storeKey(origin, '_9_1')] = { tabs: [{ cid: '_1_1', at: 1 }, { cid: course, at: 2 }] };
  const one = glaze(p, local);
  one.api.sync(true);
  await settle();
  const strip = p.doc.getElementById('gz-ctabs');
  assert.ok(strip?.isConnected);
  one.api.bar.visit(course);
  await settle();
  one.api.sync(true); one.api.held();
  await settle();
  assert.equal(p.doc.getElementById('gz-ctabs'), strip);
  assert.equal(frames(p).length, 1);
  assert.equal(one.api.showing(), course);
  one.api.sync(false);
  assert.equal(p.doc.querySelectorAll('#gz-ctabs-frames').length, 0);
  one.api.sync(true);
  await settle();
  assert.equal(p.doc.getElementById('gz-ctabs'), strip, 'switched back on, the same copy draws the same strip');
});
