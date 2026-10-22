// The whole of features/coursetabs.js in a vm over a stand-in Ultra course page (test/coursetabs-takeover.test.js,
// test/coursetabs-repaint.test.js). Each glaze() is one copy of Glaze in its own world; copies share the page's document,
// sessionStorage, window events and clock. Timers and animation frames run only when a test ticks or paints.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { GZ_SANITIZE } = require('../../defaults.js');
const L = require('../../lib/coursetabs.js');
const { El } = require('../stand-in-dom.js');
const source = fs.readFileSync(path.join(__dirname, '../../features/coursetabs.js'), 'utf8');
const origin = 'https://bb.school.test';
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };

const page = () => {
  const doc = { activeElement: null, visibilityState: 'visible' };
  class E extends El { get localName() { return this.tagName.toLowerCase(); } getClientRects() { return this.isConnected && !this.hidden ? [{}] : []; } }
  const root = new E('#document', doc);
  doc.root = root;
  const html = new E('html', doc), head = new E('head', doc), body = new E('body', doc);
  root.append(html); html.append(head, body);
  const q = (s) => { try { return root.querySelectorAll(s); } catch { return []; } }; // (selectors the stand-in can't read: none)
  const bars = new Proxy([], { get: (_, k) => { const a = root.all().filter((e) => String(e.className).split(/\s+/).includes('bb-course-navigation')); return k === 'length' ? a.length : a[k]; } });
  const make = (t) => { const e = new E(t, doc); if (e.tagName === 'IFRAME') e.contentWindow = { postMessage() {} }; return e; };
  Object.assign(doc, { documentElement: html, head, body, scrollingElement: html,
    createElement: make, createElementNS: (_, t) => new E(t, doc),
    getElementById: (id) => root.all().find((e) => e.id === id) || null, querySelectorAll: q, querySelector: (s) => q(s)[0] || null,
    getElementsByClassName: () => bars,
    addEventListener: (type, f) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(f); },
    removeEventListener: (type, f) => events.get(type)?.delete(f) });
  const bar = new E('div', doc); bar.className = 'bb-course-navigation'; body.append(bar);
  const store = new Map();
  const events = new Map();
  let now = 0, ids = 0;
  const timers = new Map(), paints = new Map(), observers = new Set();
  const clock = {
    now: () => now,
    setTimeout: (fn, ms = 0) => { timers.set(++ids, { fn, at: now + (Number(ms) || 0) }); return ids; },
    clearTimeout: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => { paints.set(++ids, fn); return ids; },
    cancelAnimationFrame: (id) => paints.delete(id),
    tick(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]); now = due[1].at; due[1].fn();
      }
      now = end;
    },
    paint() { const batch = [...paints.values()]; paints.clear(); for (const fn of batch) fn(now); },
  };
  return { doc, html, body, bar, clock,
    observers,
    mutate: (target) => { for (const o of observers) if (o.target === target) o.fn(); },
    session: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    on: (type, f) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(f); },
    off: (type, f) => events.get(type)?.delete(f),
    fire: (e) => { for (const f of [...(events.get(e.type) || [])]) f(e); return !e.defaultPrevented; },
  };
};

const glaze = (p, local, configure = () => {}) => {
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
    performance: { now: p.clock.now, timeOrigin: 0 }, Element: El,
    Event: class { constructor(type, options) { this.type = type; this.cancelable = !!options?.cancelable; } preventDefault() { if (this.cancelable) this.defaultPrevented = true; } },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target) { this.target = target; p.observers.add(this); } disconnect() { p.observers.delete(this); this.target = null; } },
    setTimeout: p.clock.setTimeout, clearTimeout: p.clock.clearTimeout, requestAnimationFrame: p.clock.requestAnimationFrame, cancelAnimationFrame: p.clock.cancelAnimationFrame, innerWidth: 1280, innerHeight: 800,
    addEventListener: p.on, removeEventListener: p.off, dispatchEvent: p.fire };
  c.globalThis = c; c.window = c; c.top = c; c.parent = c;
  configure(c);
  vm.createContext(c);
  const api = vm.runInContext(source, c);
  return { api, c, sent, chrome };
};

module.exports = { page, glaze, settle, origin, L };
