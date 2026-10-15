// The card editor's storage flows (features/cards.js, through the background worker's lib/cards.js change), run in
// VMs with a small stand-in DOM and storage: saving, closing after a failed save, local pictures (caps and clean-up),
// pictures that are ready only after the editor moved on or a newer one was picked, and two tabs saving at once.
// The page itself (painting, layout, focus) is checked in a browser, not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const K = require('../lib/cards.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const A = 'canvas:https://school.instructure.com/25';
const B = 'canvas:https://school.instructure.com/26';
const C = 'canvas:https://other.instructure.com/27';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const pics = (local) => Object.keys(local).filter((k) => k.startsWith('cardImg:'));

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
  // A canvas: draws a stand-in bitmap, and its picture is that bitmap's letter, `size` times.
  getContext() { return { drawImage: (b) => { this.letter = b.letter; }, getImageData: () => ({ data: new Uint8ClampedArray(256) }) }; }
  toDataURL() { return `data:image/webp;base64,${(this.letter || 'A').repeat(this.env.size)}`; }
}
const all = (el) => [el, ...el.children.flatMap(all)];

// One computer: the storage every tab shares, and the background worker's queue (lib/background.js).
const computer = () => {
  const env = { store: { sync: {}, local: {} }, size: 1000, failSync: false, failLocalRemove: false, peak: 0, turn: K.queue() };
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  const area = (name) => ({
    get: (keys) => later(() => { const s = env.store[name]; return structuredClone(Object.fromEntries((keys === null ? Object.keys(s) : [].concat(keys)).filter((k) => k in s).map((k) => [k, s[k]]))); }),
    set: (patch) => later(() => {
      if (name === 'sync' && env.failSync) return false;
      Object.assign(env.store[name], structuredClone(patch));
      env.peak = Math.max(env.peak, Object.entries(env.store.local).filter(([k]) => k.startsWith('cardImg:')).reduce((n, [, v]) => n + v.length, 0));
      return true;
    }),
    remove: (keys) => later(() => { if (name === 'sync' && env.failSync) return false; if (name === 'local' && env.failLocalRemove) return false; for (const k of [].concat(keys)) delete env.store[name][k]; return true; }),
  });
  env.worker = (m) => env.turn(() => K.change(m, { sync: area('sync'), local: area('local') }));
  return env;
};

// One tab on that computer, with the editor loaded.
const tab = (env, site = 'canvas') => {
  const bitmaps = [];
  const chrome = {
    runtime: { lastError: undefined, getURL: (p) => `chrome-extension://x/${p}`, sendMessage: (m, cb) => { env.worker(m).then(cb, () => cb({ ok: false, error: 'write' })); } },
    storage: {
      onChanged: { addListener() {} },
      ...Object.fromEntries(['sync', 'local'].map((name) => [name, {
        get(keys, cb) { const s = env.store[name]; const ks = keys === null ? Object.keys(s) : [].concat(keys); setTimeout(() => cb(structuredClone(Object.fromEntries(ks.filter((k) => k in s).map((k) => [k, s[k]]))))); },
        set(patch, cb) { setTimeout(() => { Object.assign(env.store[name], structuredClone(patch)); cb?.(); }); },
        remove(keys, cb) { for (const k of [].concat(keys)) delete env.store[name][k]; setTimeout(() => cb?.()); },
      }])),
    },
  };
  const body = new El('body');
  const document = {
    documentElement: new El('html'), body,
    createElement: (t) => { const e = new El(t); e.env = env; return e; },
    createElementNS: (ns, t) => new El(t),
    querySelectorAll: () => [], getElementById: () => null, addEventListener() {},
  };
  const context = vm.createContext({
    location: { origin: 'https://bb.school.edu', pathname: '/ultra/course' },
    chrome, document, window: { top: {} }, setTimeout, clearTimeout, crypto: globalThis.crypto, structuredClone, URL, TextEncoder, Promise,
    MutationObserver: class { observe() {} },
    Option: class extends El { constructor(text, value) { super('option'); Object.assign(this, { text, value }); } },
    createImageBitmap: (f) => new Promise((resolve) => bitmaps.push(() => resolve({ width: 4000, height: 2000, letter: f.letter || 'A', close() {} }))),
    GZ_I18N: { num: (n) => String(n) },
  });
  context.globalThis = context;
  context.GZ_CTX = { site, need: () => Promise.resolve(), t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]), capi: () => Promise.resolve({}), locale: () => 'en' };
  if (site === 'ultra') { context.window = context; context.top = context; }
  for (const f of ['lib/color.js', 'lib/cards.js', 'features/cards.js']) vm.runInContext(read(f), context, { filename: f });
  const ui = vm.runInContext('GZ_CARD_UI', context);
  const dialog = () => body.children.find((e) => e.tagName === 'DIALOG');
  const find = (pred) => all(dialog()).find(pred);
  const picture = (file = {}) => {
    const input = find((e) => e.type === 'file');
    input.files = [file];
    return input.fire('change');
  };
  return { ui, dialog, find, picture, bitmaps, document };
};
const load = () => { const env = computer(); return { env, store: env.store, ...tab(env) }; };

test('closing after a failed save keeps the editor and the draft, and says so', async () => {
  const { env, store, ui, dialog, find } = load();
  store.sync.cards = { [A]: { k: 'solid', c: '#111111' } };
  await ui.open(A);
  env.failSync = true;
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
  env.failSync = false;
  await done.fire('click');
  await tick(20);
  assert.equal(dialog(), undefined);
  assert.equal(store.sync.cards[A].c, '#ff0000');
});

test('a picture that is ready after the editor moved to another course is dropped, not given to it', async () => {
  const { store, ui, dialog, picture, bitmaps } = load();
  store.sync.cards = { [B]: { k: 'solid', c: '#222222' } };
  await ui.open(A);
  const pending = picture();
  await tick(5);
  await ui.open(B);
  bitmaps.shift()();
  await pending;
  await tick(20);
  assert.deepEqual(store.sync.cards, { [B]: { k: 'solid', c: '#222222' } });
  assert.deepEqual(pics(store.local), [], 'and nothing is kept for it');
  assert.ok(dialog()?.open);
});

test('of two picks in one editor, the later one wins, whichever finishes first', async () => {
  const { store, ui, picture, bitmaps } = load();
  await ui.open(A);
  const first = picture({ letter: 'F' });
  await tick(5);
  const second = picture({ letter: 'S' });
  await tick(5);
  bitmaps[1]();
  await second;
  await tick(20);
  bitmaps[0]();
  await first;
  await tick(20);
  assert.deepEqual(pics(store.local), [`cardImg:${store.sync.cards[A].i}`], 'one picture, the one the style uses');
  assert.match(store.local[`cardImg:${store.sync.cards[A].i}`], /base64,S+$/, 'the later pick');
});

test('a replaced picture is deleted once the new one is saved, and every stored picture counts toward the cap', async () => {
  const { store, ui, picture, bitmaps } = load();
  for (let n = 0; n < 3; n++) {
    await ui.open(A);
    const p = picture();
    await tick(5);
    bitmaps.shift()();
    await p;
    await tick(20);
  }
  assert.deepEqual(pics(store.local), [`cardImg:${store.sync.cards[A].i}`], 'one picture left');

  // Another course's picture that no index lists still counts.
  const { env, store: s2, ui: u2, find, picture: pick2, bitmaps: b2 } = load();
  s2.sync.cards = { [B]: { k: 'image', i: 'bbbbbbbbbbbb' } };
  s2.local['cardImg:bbbbbbbbbbbb'] = `data:image/webp;base64,${'B'.repeat(3800000)}`;
  env.size = 300000;
  await u2.open(A);
  const p = pick2();
  await tick(5);
  b2.shift()();
  await p;
  await tick(20);
  assert.equal(s2.sync.cards[A], undefined, 'over the total cap: refused');
  assert.match(find((e) => e.className === 'gz-ce-note').textContent, /too big/);
});

test('two tabs picking at once can never pass the cap together, and neither loses the other’s course', async () => {
  const env = computer();
  env.store.sync.cards = { [C]: { k: 'image', i: 'cccccccccccc' } };
  env.store.local['cardImg:cccccccccccc'] = `data:image/webp;base64,${'C'.repeat(3491977)}`; // 3,492,000 characters
  env.size = 300000; // 300,023 characters each
  const one = tab(env), two = tab(env);
  await one.ui.open(A);
  await two.ui.open(B);
  const p1 = one.picture({ letter: 'O' }), p2 = two.picture({ letter: 'T' });
  await tick(5);
  one.bitmaps.shift()();
  two.bitmaps.shift()();
  await Promise.all([p1, p2]);
  await tick(30);
  assert.ok(env.peak <= K.IMG_TOTAL, `peaked at ${env.peak}`);
  assert.equal(pics(env.store.local).length, 2, 'the old picture and one new one');
  assert.equal([env.store.sync.cards[A], env.store.sync.cards[B]].filter(Boolean).length, 1, 'one tab got its picture; the other was told it was too big');
  // Every stored style's picture is still there.
  for (const s of Object.values(env.store.sync.cards)) if (s.i) assert.ok(`cardImg:${s.i}` in env.store.local, s.i);
});

test('the background worker takes card writes from this extension only, one at a time', async () => {
  const m = require('../manifest.json');
  // bb.school.edu is a site Glaze has found to be Ultra (content-ultra.js reported it; lib/background.js fromUltra).
  const store = { sync: {}, local: { 'cardImg:cccccccccccc': `data:image/webp;base64,${'C'.repeat(3491977)}`, ultra: ['https://bb.school.edu'] } };
  store.sync.cards = { [C]: { k: 'image', i: 'cccccccccccc' } };
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  const area = (s) => ({
    get: (k) => later(() => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: (v) => later(() => { Object.assign(s, structuredClone(v)); }),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete s[x]; }),
  });
  const listeners = [];
  const context = vm.createContext({
    URL, console, TextEncoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  // Replies come out of the worker's VM: compared as plain JSON.
  const send = (msg, sender = { id: 'glaze', tab: {}, url: 'https://school.instructure.com/' }) => new Promise((res) => {
    let kept = false;
    const back = (r) => res(JSON.parse(JSON.stringify(r)));
    for (const f of listeners) if (f(msg, sender, back) === true) kept = true;
    if (!kept) res('ignored');
  });
  // Who may ask: a Canvas page for its own site's courses, and the editor page for anything; no one else.
  const editor = { id: 'glaze', tab: {}, url: 'chrome-extension://x/options.html#cards' };
  const nope = { ok: false, error: 'sender' };
  const solid = { type: 'glaze:cards', key: A, style: { k: 'solid', c: '#123456' } };
  for (const [sender, why] of [
    [{ id: 'other', tab: {}, url: 'https://school.instructure.com/' }, 'another extension'],
    [{ id: 'glaze', url: 'chrome-extension://x/popup.html' }, "another of Glaze's pages"],
    [{ id: 'glaze', tab: {}, url: 'chrome-extension://x/preview.html' }, 'the preview frame'],
    [{ id: 'glaze', url: 'https://school.instructure.com/' }, 'not in a tab'],
    [{ id: 'glaze', tab: {}, url: 'https://other.instructure.com/' }, "another site's course"],
    [{ id: 'glaze', tab: {}, url: 'https://evil.example/' }, 'a site Glaze does not run on'],
  ]) assert.deepEqual(await send(solid, sender), nope, why);
  const ultra = { id: 'glaze', tab: {}, frameId: 0, url: 'https://bb.school.edu/ultra/course' };
  const ultraStyle = { ...solid, key: 'ultra:https://bb.school.edu/_25_1' };
  assert.deepEqual(await send(ultraStyle, ultra), { ok: true, id: null }, 'Ultra saves only its own origin course key');
  for (const sender of [{ ...ultra, frameId: 1 }, { ...ultra, url: 'https://bb.other.edu/ultra/course' }, { ...ultra, url: 'https://bb.school.edu/login' }, { ...ultra, id: 'other' }]) assert.deepEqual(await send(ultraStyle, sender), nope);
  for (const op of [{ ultra: true }, { reset: true }, { set: [] }, { replace: {} }, { nav: { collapsed: true } }]) assert.deepEqual(await send({ ...ultraStyle, ...op }, ultra), nope);
  assert.deepEqual(await send(solid, ultra), nope, 'Ultra cannot edit Canvas styles');
  assert.equal(store.sync.ucards[ultraStyle.key].c, '#123456');
  assert.equal(store.sync.cards[ultraStyle.key], undefined, 'Ultra does not enter the old Canvas sync item');
  assert.deepEqual(await send({ type: 'glaze:cards', ultra: true, reset: true }, editor), { ok: true }, 'the editor can reset the Ultra namespace');
  assert.equal(store.sync.ucards, undefined);
  assert.ok(store.sync.cards[C], 'an Ultra reset preserves Canvas pictures and styles');
  assert.deepEqual(await send({ type: 'glaze:cards', reset: true }), nope, 'a Canvas page cannot reset');
  assert.deepEqual(await send({ type: 'glaze:cards', set: [] }), nope, "or change a theme's set");
  assert.equal(await send({ type: 'glaze:toString', key: A }), 'ignored', 'only the kinds of write it names');
  assert.equal(store.sync.cards[A], undefined);
  const navMessage = { type: 'glaze:nav', nav: { k: 'solid', c: '#112233' } };
  for (const sender of [{ id: 'other', tab: {}, url: 'https://school.instructure.com/' }, { id: 'glaze', tab: {}, url: 'https://evil.example/' }, { id: 'glaze', url: 'chrome-extension://x/preview.html' }]) assert.deepEqual(await send(navMessage, sender), nope);
  assert.deepEqual(await send({ ...navMessage, image: 'data:image/png;base64,AAAA' }), nope, 'only the editor uploads');
  assert.deepEqual(await send({ type: 'glaze:cards', key: A, nav: navMessage.nav }), nope, 'a card request cannot change the global rail');
  assert.ok((await send(navMessage)).ok, 'a Canvas command can style the rail');
  assert.equal(store.sync.nav.c, '#112233');
  const popup = { id: 'glaze', url: 'chrome-extension://x/popup.html' };
  assert.deepEqual(await send(navMessage, popup), nope, 'the popup has no sidebar writer');
  assert.deepEqual(await send({ ...navMessage, image: 'data:image/png;base64,AAAA' }, popup), nope, 'the popup cannot upload');
  assert.deepEqual(await send({ type: 'glaze:cards', key: B, style: null }, editor), { ok: true, id: null }, 'the editor page');
  const image = `data:image/webp;base64,${'N'.repeat(300000)}`;
  const [a, b] = await Promise.all([send({ type: 'glaze:cards', key: A, style: {}, image }), send({ type: 'glaze:cards', key: B, style: {}, image })]);
  assert.deepEqual([a.ok, b.ok, b.error], [true, false, 'cap']);
  assert.equal(store.sync.cards[A].i, a.id);
  assert.equal(pics(store.local).length, 2);
});

test('a reset whose styles could not be removed keeps the pictures they use, and says it failed', async () => {
  const env = computer();
  env.store.sync.cards = { [A]: { k: 'image', i: 'aaaaaaaaaaaa' } };
  env.store.local['cardImg:aaaaaaaaaaaa'] = 'data:image/webp;base64,AAAA';
  env.failSync = true;
  assert.deepEqual(await env.worker({ reset: true }), { ok: false, error: 'write' });
  assert.ok('cardImg:aaaaaaaaaaaa' in env.store.local, 'the saved style still has its picture');
  env.failSync = false;
  assert.deepEqual(await env.worker({ reset: true }), { ok: true });
  assert.deepEqual([env.store.sync, pics(env.store.local)], [{}, []]);
});

test('a reset whose pictures could not be deleted says so, and a retry finishes it', async () => {
  const env = computer();
  env.store.sync.cards = { [A]: { k: 'image', i: 'aaaaaaaaaaaa' } };
  env.store.local['cardImg:aaaaaaaaaaaa'] = 'data:image/webp;base64,AAAA';
  env.failLocalRemove = true;
  assert.deepEqual(await env.worker({ reset: true }), { ok: false, error: 'write' });
  env.failLocalRemove = false;
  assert.deepEqual(await env.worker({ reset: true }), { ok: true });
  assert.deepEqual([env.store.sync, pics(env.store.local)], [{}, []]);
});

test('two tabs saving different courses at the same moment keep both', async () => {
  const env = computer();
  const one = tab(env), two = tab(env);
  await one.ui.open(A);
  await two.ui.open(B);
  for (const [t, c] of [[one, '#aa0000'], [two, '#00aa00']]) {
    const i = t.find((e) => e.type === 'color');
    i.value = c;
    await i.fire('input');
  }
  await Promise.all([one.find((e) => e.className === 'gz-ce-done').fire('click'), two.find((e) => e.className === 'gz-ce-done').fire('click')]);
  await tick(30);
  assert.deepEqual(env.store.sync.cards, { [A]: { k: 'solid', c: '#aa0000' }, [B]: { k: 'solid', c: '#00aa00' } });
});

test('card and nav pictures share one cap and queue, retain each other, and roll back failed uploads', async () => {
  const env = computer(), image = 'data:image/webp;base64,AAAA';
  const card = await env.worker({ key: A, style: {}, image });
  const nav = await env.worker({ nav: { k: 'image' }, image });
  assert.ok(card.ok && nav.ok);
  assert.equal(pics(env.store.local).length, 2);
  await env.worker({ key: B, style: { k: 'solid', c: '#112233' } });
  assert.ok(env.store.local[`cardImg:${nav.id}`], 'editing cards retains the rail picture');
  await env.worker({ nav: { ink: '#cccccc' } });
  assert.ok(env.store.local[`cardImg:${card.id}`], 'editing the rail retains course pictures');
  assert.equal(env.store.sync.nav.i, nav.id);
  env.failSync = true;
  assert.equal((await env.worker({ nav: { k: 'image' }, image })).ok, false);
  assert.equal(pics(env.store.local).length, 2, 'failed upload rolled back');
  env.failSync = false;
  await env.worker({ reset: true });
  assert.deepEqual(pics(env.store.local), [`cardImg:${nav.id}`], 'card-only reset retains the rail picture');
  env.failLocalRemove = true;
  assert.deepEqual((({ ok, cleanup }) => ({ ok, cleanup }))(await env.worker({ nav: { k: 'solid' } })), { ok: true, cleanup: false }, 'a successful style save is not reported as failed cleanup');
  env.failLocalRemove = false;
  await env.worker({ nav: { k: 'default' } });
  assert.deepEqual(pics(env.store.local), []);
});


test('Ultra paints its isolated styles on new cards and opens the same editor from a raw course id', async () => {
  const env = computer();
  const key = 'ultra:https://bb.school.edu/_25_1';
  env.store.sync.ucards = { [key]: { k: 'gradient', c: '#123456', d: '#654321' } };
  env.store.sync.card = { width: 262, height: 146, gap: -1 };
  const { ui, document, dialog, find } = tab(env, 'ultra');
  let cards = [];
  document.documentElement.setAttribute('data-gz-motion', 'off');
  document.querySelectorAll = () => cards;
  await ui.paint();
  const card = new El('article'); card.dataset.courseId = '_25_1'; card.className = 'course-element-card course-color-2';
  const props = new Map(); card._style = { getPropertyValue: (k) => props.get(k) || '', setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k) };
  const title = new El('h4'); title.textContent = 'Synthetic course';
  card.querySelector = (s) => s === '.course-title' ? title : s === '.course-banner' ? { offsetHeight: 160 } : null;
  cards = [card]; await ui.paint();
  assert.equal(card.getAttribute('data-gz-card'), 'gradient');
  assert.match(props.get('--gz-card-grad'), /#123456/);
  for (const k of ['width', 'gap', 'height']) assert.equal(document.documentElement.hasAttribute('data-gz-card-' + k), false, 'untouched geometry is native');
  await ui.open('_25_1'); assert.ok(dialog().open);
  assert.equal(find((e) => e.type === 'radio' && e.value === 'gradient').checked, true);
  document.documentElement.removeAttribute('data-gz-motion'); await ui.paint();
  assert.equal(card.hasAttribute('data-gz-card'), false);
});
