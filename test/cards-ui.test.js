// The card editor's storage flows (features/cards.js), run in a VM with a small stand-in DOM and storage: saving,
// closing after a failed save, local pictures (caps and clean-up), and a picture that is ready only after the editor
// has moved on. The page itself (painting, layout, focus) is checked in a browser, not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const A = 'canvas:https://school.instructure.com/25';
const B = 'canvas:https://school.instructure.com/26';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, listeners: {}, dataset: {}, hidden: false, parent: null, textContent: '' }); }
  get style() { return (this._style ||= { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }); }
  get classList() { return { toggle() {}, contains: () => false, add() {}, remove() {} }; }
  append(...kids) { for (const k of kids) if (k instanceof El) { k.parent = this; this.children.push(k); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  fire(type) { return Promise.all((this.listeners[type] || []).map((f) => f({ type, target: this, preventDefault() {}, stopPropagation() {} }))); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  get lastElementChild() { return this.children.at(-1) || null; }
  getContext() { return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(256) }) }; }
  toDataURL() { return `data:image/webp;base64,${'A'.repeat(this.ctx.size)}`; }
}
const all = (el) => [el, ...el.children.flatMap(all)];

const load = () => {
  const store = { sync: {}, local: {} };
  const ctx = { size: 1000, failSync: false, bitmaps: [] };
  const chrome = {
    runtime: { lastError: undefined, getURL: (p) => `chrome-extension://x/${p}` },
    storage: {
      onChanged: { addListener() {} },
      ...Object.fromEntries(['sync', 'local'].map((area) => [area, {
        get(keys, cb) {
          const s = store[area];
          const ks = keys === null ? Object.keys(s) : [].concat(keys);
          setTimeout(() => cb(structuredClone(Object.fromEntries(ks.filter((k) => k in s).map((k) => [k, s[k]])))));
        },
        set(patch, cb) {
          setTimeout(() => {
            if (area === 'sync' && ctx.failSync) chrome.runtime.lastError = { message: 'QUOTA_BYTES_PER_ITEM quota exceeded' };
            else Object.assign(store[area], structuredClone(patch));
            cb?.();
            chrome.runtime.lastError = undefined;
          });
        },
        remove(keys, cb) { for (const k of [].concat(keys)) delete store[area][k]; setTimeout(() => cb?.()); },
      }])),
    },
  };
  const body = new El('body');
  const document = {
    documentElement: new El('html'), body,
    createElement: (t) => { const e = new El(t); if (t === 'canvas') e.ctx = ctx; return e; },
    createElementNS: (ns, t) => new El(t),
    querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
  };
  const context = vm.createContext({
    chrome, document, window: { top: {} }, setTimeout, clearTimeout, crypto: globalThis.crypto, structuredClone, URL, TextEncoder, Promise,
    MutationObserver: class { observe() {} },
    Option: class extends El { constructor(text, value) { super('option'); Object.assign(this, { text, value }); } },
    createImageBitmap: () => new Promise((resolve) => ctx.bitmaps.push(() => resolve({ width: 4000, height: 2000, close() {} }))),
    GZ_I18N: { num: (n) => String(n) },
  });
  context.globalThis = context;
  context.GZ_CTX = { need: () => Promise.resolve(), t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]), capi: () => Promise.resolve({}), locale: () => 'en' };
  for (const f of ['lib/color.js', 'lib/cards.js', 'features/cards.js']) vm.runInContext(read(f), context, { filename: f });
  const ui = vm.runInContext('GZ_CARD_UI', context);
  const dialog = () => body.children.find((e) => e.tagName === 'DIALOG');
  const find = (pred) => all(dialog()).find(pred);
  const picture = async (file = {}) => {
    const input = find((e) => e.type === 'file');
    input.files = [file];
    return input.fire('change');
  };
  return { store, ctx, ui, dialog, find, picture };
};

test('closing after a failed save keeps the editor and the draft, and says so', async () => {
  const { store, ctx, ui, dialog, find } = load();
  store.sync.cards = { [A]: { k: 'solid', c: '#111111' } };
  await ui.open(A);
  ctx.failSync = true;
  const solid = find((e) => e.type === 'color');
  solid.value = '#ff0000';
  await solid.fire('input');
  const done = find((e) => e.className === 'gz-ce-done');
  await done.fire('click');
  await tick(20);
  assert.ok(dialog()?.open, 'the editor stays open after a failed save');
  assert.match(find((e) => e.className === 'gz-ce-note').textContent, /Close again/);
  assert.equal(store.sync.cards[A].c, '#111111', 'nothing was saved');
  // Storage works again: closing saves the draft that was kept.
  ctx.failSync = false;
  await done.fire('click');
  await tick(20);
  assert.equal(dialog(), undefined);
  assert.equal(store.sync.cards[A].c, '#ff0000');
});

test('a picture that is ready after the editor moved to another course is dropped, not given to it', async () => {
  const { store, ctx, ui, dialog, picture } = load();
  store.sync.cards = { [B]: { k: 'solid', c: '#222222' } };
  await ui.open(A);
  const pending = picture();
  await tick(5);
  await ui.open(B);
  ctx.bitmaps.shift()();
  await pending;
  await tick(20);
  assert.deepEqual(store.sync.cards, { [B]: { k: 'solid', c: '#222222' } });
  assert.deepEqual(Object.keys(store.local).filter((k) => k.startsWith('cardImg:')), [], 'and nothing is kept for it');
  assert.ok(dialog()?.open);
});

test('a replaced picture is deleted once the new one is saved, and every stored picture counts toward the cap', async () => {
  const { store, ctx, ui, picture } = load();
  for (let n = 0; n < 3; n++) {
    await ui.open(A);
    const p = picture();
    await tick(5);
    ctx.bitmaps.shift()();
    await p;
    await tick(20);
  }
  const imgs = Object.keys(store.local).filter((k) => k.startsWith('cardImg:'));
  assert.equal(imgs.length, 1, `one picture left, not ${imgs.length}`);
  assert.equal(`cardImg:${store.sync.cards[A].i}`, imgs[0]);

  // Another course's picture that no index lists still counts.
  const { store: s2, ctx: c2, ui: u2, find } = load();
  s2.sync.cards = { [B]: { k: 'image', i: 'bbbbbbbbbbbb' } };
  s2.local['cardImg:bbbbbbbbbbbb'] = `data:image/webp;base64,${'B'.repeat(3800000)}`;
  c2.size = 300000;
  await u2.open(A);
  const input = find((e) => e.type === 'file');
  input.files = [{}];
  const p = input.fire('change');
  await tick(5);
  c2.bitmaps.shift()();
  await p;
  await tick(20);
  assert.equal(s2.sync.cards[A], undefined, 'over the total cap: refused');
  assert.match(find((e) => e.className === 'gz-ce-note').textContent, /too big/);
});
