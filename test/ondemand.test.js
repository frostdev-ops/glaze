// What content.js does while a file it loads on demand is on its way: blocks of content.js run in a VM with stand-ins,
// as test/head.test.js does for the head gate. Sliced between section markers, so they track the real code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const block = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a > 0 && b > a, `markers ${from} … ${to}`);
  return source.slice(a, b);
};
// A promise the test settles by hand.
const later = () => { let resolve, reject; const p = new Promise((y, n) => { resolve = y; reject = n; }); return Object.assign(p, { resolve, reject }); };
const settle = () => new Promise(setImmediate);
// Timers the test runs by hand.
const clock = () => {
  const due = [];
  return { setTimeout: (f, ms) => { due.push({ f, ms }); return due.length; }, clearTimeout: () => {}, run: () => { while (due.length) due.shift().f(); }, due };
};

// The loader and the page-language gate, with the worker answering when the test says.
const loader = ({ lang = 'de' } = {}) => {
  const replies = [];
  const t = clock();
  const ctx = vm.createContext({
    isPreview: false, observer: {}, timer: 0, wordsArrived: 0, flush() {},
    locale: () => lang,
    GZ_I18N: require('../lib/i18n.js'),
    chrome: { runtime: { sendMessage: (m) => { const r = later(); replies.push({ m, r }); return r; } } },
    setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, Promise, crypto: require('node:crypto').webcrypto,
  });
  vm.runInContext(`globalThis.GZ_LANGS = undefined; ${block('  // ---- code on demand', '  // ---- the gradebook')}; globalThis.api = { words, wordsIn, need, loading };`, ctx);
  return { api: ctx.api, replies, ctx, clock: t };
};

test('things drawn before the page\'s words arrived are redrawn when they do', async () => {
  const { api, replies, ctx } = loader();
  const redraw = [];
  api.wordsIn.add(() => redraw.push('keys'));
  assert.equal(api.words(), false);
  assert.deepEqual(JSON.parse(JSON.stringify(replies.map((x) => [x.m.type, x.m.files]))), [['glaze:load', ['i18n/de.js']]]);
  assert.equal(replies[0].m.doc, ctx.__gzDoc, 'names this document');
  vm.runInContext("globalThis.GZ_LANGS = { de: require_de }", Object.assign(ctx, { require_de: { Restore: 'Wiederherstellen' } }));
  replies[0].r.resolve({ ok: true });
  await settle();
  assert.equal(api.words(), true);
  assert.deepEqual(redraw, ['keys']);
});

test('a catalogue that fails to load leaves the page in English for good: no second request, no late switch', async () => {
  const { api, replies, clock: c } = loader();
  const redraw = [];
  api.wordsIn.add(() => redraw.push('keys'));
  api.words();
  replies[0].r.resolve({ ok: false, error: 'Frame was removed' });
  await settle();
  assert.equal(api.words(), true, 'the extras draw, in English');
  c.run(); // the minute after which need() would let the file be asked for again
  for (let i = 0; i < 3; i++) assert.equal(api.words(), true);
  assert.equal(replies.length, 1, 'asked once');
  assert.deepEqual(redraw, [], 'nothing switches language later');
});

test('an English page asks for nothing and never waits', () => {
  const { api, replies } = loader({ lang: 'en-GB' });
  assert.equal(api.words(), true);
  assert.equal(replies.length, 0);
});

// The keyboard help, built with a small stand-in DOM.
const dom = () => {
  const el = (tag) => ({
    tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, textContent: '', isConnected: true,
    setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); }, addEventListener() {},
    remove() { this.isConnected = false; }, focus() { doc.activeElement = this; },
    querySelector(sel) { const walk = (e) => e.children.flatMap((c) => [c, ...walk(c)]); return walk(this).find((c) => c.tagName === sel.toUpperCase()) || null; },
  });
  const doc = { createElement: el, body: el('body'), activeElement: null, addEventListener() {} };
  doc.activeElement = doc.body;
  return doc;
};

test('the keyboard help, opened before the page\'s words arrived, is redrawn in them', () => {
  const document = dom();
  const words = { de: false };
  const ctx = vm.createContext({
    ultra: false, document, location: { pathname: '/' }, navigator: { platform: 'MacIntel' }, settings: { enhance: { palette: true } },
    window: {}, Element: class {}, wordsIn: new Set(),
    t: (k) => (words.de && k === 'Keyboard shortcuts' ? 'Tastenkürzel' : k),
  });
  ctx.window.top = {};
  vm.runInContext(`${block('  // ---- keyboard shortcuts (Extras)', '  const typing = ')}; globalThis.api = { openKeys, get box() { return keysBox; } };`, ctx);
  const back = { focus() {}, isConnected: true };
  document.activeElement = back;
  ctx.api.openKeys();
  assert.equal(ctx.api.box.attrs['aria-label'], 'Keyboard shortcuts');
  words.de = true;
  for (const f of ctx.wordsIn) f();
  assert.equal(ctx.api.box.attrs['aria-label'], 'Tastenkürzel');
  assert.equal(document.body.children.filter((c) => c.isConnected).length, 1, 'one dialog, the old one gone');
});

test('a closed keyboard help stays closed when the words arrive', () => {
  const document = dom();
  const ctx = vm.createContext({ ultra: false, document, location: { pathname: '/' }, navigator: { platform: '' }, settings: { enhance: {} }, window: {}, Element: class {}, wordsIn: new Set(), t: (k) => k });
  ctx.window.top = {};
  vm.runInContext(`${block('  // ---- keyboard shortcuts (Extras)', '  const typing = ')}; globalThis.api = { get box() { return keysBox; } };`, ctx);
  for (const f of ctx.wordsIn) f();
  assert.equal(ctx.api.box, null);
  assert.equal(document.body.children.length, 0);
});

// The draft backup on Ultra, while lib/drafts.js is on its way.
test('a first and only input while lib/drafts.js loads is still backed up once it arrives', async () => {
  const saved = [];
  const t = clock();
  const loading = later();
  class Element {}
  const editor = Object.assign(new Element(), {
    id: 'ed1', isConnected: true, textContent: 'A pasted paragraph that is long enough to keep.', innerHTML: '<p>A pasted paragraph that is long enough to keep.</p>',
    parentElement: null, attributes: [], matches: () => true, closest(sel) { return sel.includes('ql-editor') ? this : null; },
  });
  const listeners = {};
  const ctx = vm.createContext({
    ultra: true, observer: {}, settings: { enhance: { drafts: true } }, Element, location: { pathname: '/ultra/courses/_1_1/outline' },
    document: { addEventListener: (type, f) => { (listeners[type] ||= []).push(f); }, querySelector: () => null, querySelectorAll: () => [] },
    chrome: { storage: { local: { set: (v) => saved.push(v), get() {}, remove() {} } } },
    need: () => loading, setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, addEventListener() {}, Date, window: {}, globalThis: null,
  });
  ctx.globalThis = ctx;
  vm.runInContext(block('  // ---- draft backup (Extras)', '  // ---- download all (Extras)'), ctx);
  for (const f of listeners.paste || []) f({ type: 'paste', target: editor });
  t.run();
  assert.deepEqual(saved, [], 'nothing kept before the module is in');
  ctx.GZ_DRAFTS = require('../lib/drafts.js');
  loading.resolve();
  await settle();
  t.run();
  assert.equal(saved.length, 1, 'the paste is kept once the module arrives, without another input');
  assert.match(Object.keys(saved[0])[0], /^draft:\/ultra\/courses\/_1_1\/outline#\/ed1$/);
});
