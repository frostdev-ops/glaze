const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = () => process.env.GZ_B7C_REVIEW_BASE ? require('node:child_process').execFileSync('git', ['show', `${process.env.GZ_B7C_REVIEW_BASE}:features/nav.js`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }) : fs.readFileSync(require.resolve('../features/nav.js'), 'utf8');
const fixture = () => {
  const src = source(), a = src.indexOf('function GZ_ULTRA_OVERLAY('), b = src.indexOf('// The modern drawer', a);
  assert.ok(a > 0 && b > a, 'overlay behavior stays in the lazy module');
  const timers = new Map(), globalListeners = new Map(), listeners = new Map(), htmlAttrs = new Map(); let clock = 0, serial = 0, paints = 0, button;
  const el = () => { const attrs = new Map(); return { attrs, isConnected: true, setAttribute: (k, v) => attrs.set(k, v), getAttribute: (k) => attrs.get(k) ?? null, hasAttribute: (k) => attrs.has(k), removeAttribute: (k) => attrs.delete(k), closest: () => null, addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: (k) => listeners.delete(k), remove() { this.isConnected = false; }, focus() { document.activeElement = this; } }; };
  const anchor = el(); anchor.setAttribute('title', 'Full native name');
  const header = { append: (b) => { button = b; } };
  const paper = { contains: (n) => n === anchor || n === button, querySelectorAll: (s) => s === '[aria-describedby]' ? [] : [anchor], querySelector: (s) => s === 'header' ? header : anchor, addEventListener: (k, fn) => listeners.set(k, fn), removeEventListener: (k) => listeners.delete(k) };
  const document = { activeElement: null, head: { append() {} }, documentElement: { toggleAttribute: (k, on) => on ? htmlAttrs.set(k, '') : htmlAttrs.delete(k) }, querySelector: () => ({ closest: () => paper }), createElement: () => el(), addEventListener: (k, fn) => globalListeners.set(k, fn), removeEventListener: (k) => globalListeners.delete(k) };
  const nav = { collapsed: true, expandOnHover: true }, chrome = { runtime: { id: 'glaze' } }, X = { on: () => true, settings: () => ({ enabled: true }), nav: () => nav, t: (s) => s };
  const c = vm.createContext({ document, chrome, matchMedia: () => ({ matches: true }), addEventListener() {}, MutationObserver: class { observe() {} disconnect() {} }, setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: clock + ms }); return id; }, clearTimeout: (id) => timers.delete(id) });
  const make = vm.runInContext(src.slice(a, b) + '\nGZ_ULTRA_OVERLAY;', c), api = make(X, () => paints++); api.sync(true);
  const tick = (ms) => { clock += ms; for (const [id, t] of [...timers]) if (t.at <= clock) { timers.delete(id); t.fn(); } };
  return { api, nav, chrome, document, anchor, paper, listeners, globalListeners, htmlAttrs, tick, button: () => button, paints: () => paints };
};

test('hover opens after 150 ms and closes after 300 ms without changing the saved collapse preference', () => {
  const f = fixture(); f.listeners.get('pointerenter')({ pointerType: 'mouse' }); f.tick(149); assert.equal(f.api.open(), false); f.tick(1); assert.equal(f.api.open(), true);
  assert.equal(f.anchor.getAttribute('title'), ''); assert.equal(f.button().getAttribute('aria-expanded'), 'true');
  f.listeners.get('pointerleave')({ pointerType: 'mouse' }); f.tick(299); assert.equal(f.api.open(), true); f.tick(1); assert.equal(f.api.open(), false);
  assert.equal(f.anchor.getAttribute('title'), 'Full native name'); assert.equal(f.nav.collapsed, true); assert.ok(f.paints() > 0);
});

test('focus expands immediately, leaving focus collapses, and touch never invokes hover', () => {
  const f = fixture(); f.listeners.get('pointerenter')({ pointerType: 'touch' }); f.tick(1000); assert.equal(f.api.open(), false);
  f.document.activeElement = f.anchor; f.listeners.get('focusin')({ target: f.anchor }); assert.equal(f.api.open(), true);
  f.document.activeElement = null; f.listeners.get('focusout')({ relatedTarget: {} }); f.tick(300); assert.equal(f.api.open(), false);
  let prevented = 0; f.listeners.get('click')({ preventDefault: () => prevented++, stopPropagation() {} }); assert.equal(f.api.open(), true); assert.equal(prevented, 1);
  f.globalListeners.get('pointerdown')({ target: {} }); assert.equal(f.api.open(), false); assert.equal(f.nav.collapsed, true);
});

test('hover can be disabled live; Escape keeps focus in the rail and teardown removes the outside listener', () => {
  const f = fixture(); f.listeners.get('pointerenter')({ pointerType: 'mouse' }); f.tick(150); assert.equal(f.api.open(), true);
  f.nav.expandOnHover = false; f.api.sync(true); assert.equal(f.api.open(), false);
  f.listeners.get('pointerenter')({ pointerType: 'mouse' }); f.tick(1000); assert.equal(f.api.open(), false);
  f.document.activeElement = f.anchor; f.listeners.get('focusin')({ target: f.anchor });
  f.listeners.get('keydown')({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); assert.equal(f.api.open(), false); assert.equal(f.document.activeElement, f.button());
  f.nav.collapsed = false; f.api.sync(true); assert.equal(f.globalListeners.size, 0); assert.equal(f.document.activeElement, f.anchor);
});

test('invalidated contexts do not intercept the overlay button or pointer events', () => {
  const f = fixture(), click = f.listeners.get('click'), enter = f.listeners.get('pointerenter'); f.chrome.runtime.id = undefined; let intercepted = 0;
  click({ preventDefault: () => intercepted++, stopPropagation: () => intercepted++ });
  enter({ pointerType: 'mouse' }); f.tick(1000);
  assert.equal(f.globalListeners.size, 0); assert.equal(intercepted, 0); assert.equal(f.api.open(), false);
});
