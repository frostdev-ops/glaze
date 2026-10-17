const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cp = require('node:child_process');
const source = (file) => process.env.GZ_NAV_REVIEW_BASE
  ? cp.execFileSync('git', ['show', `${process.env.GZ_NAV_REVIEW_BASE}:${file}`], { cwd: __dirname, encoding: 'utf8' })
  : fs.readFileSync(require.resolve(`../${file}`), 'utf8');

test('native hidden attribute values survive disabling the rail exactly', () => {
  const src = source('features/nav.js'), start = src.indexOf('  const restore ='), end = src.indexOf('  const loadLogo =', start);
  let hidden = 'hidden';
  const unit = { dataset: {}, isConnected: true, get hidden() { return hidden !== null; }, set hidden(v) { hidden = v ? '' : null; }, setAttribute(k, v) { if (k === 'hidden') hidden = v; }, removeAttribute(k) { if (k === 'hidden') hidden = null; } };
  const anchor = { contains: () => false }, mark = { isConnected: true, after() {}, remove() {} };
  const c = vm.createContext({ clock: 0, widgetNodes: new Map(), document: { activeElement: {}, documentElement: { style: { removeProperty() {} } } },
    captured: new Map([[anchor, { unit, mark, hidden: 'hidden' }]]), custom: new Map(), slots: new Map(), iconed: new Map(), shells: [], html: { removeAttribute() {} },
    sheet: null, watch: null, top: null, bottom: null, host: null, signature: '', logoId: '', logo: null, clearTimeout() {}, restoreMenu() {} });
  vm.runInContext(src.slice(start, end) + '\nrestore();', c);
  assert.equal(hidden, 'hidden');
});

test('a replacement Glaze settings item does not inherit a hidden native list item', () => {
  const src = source('content-ultra.js'), start = src.indexOf('  const glazeItem ='), end = src.indexOf('  const queueNav =', start);
  let inserted;
  const make = (tag) => ({ tagName: tag, hidden: true, classList: { contains: () => false, add() {}, remove() {} }, removeAttribute(k) { if (k === 'hidden') this.hidden = false; }, setAttribute() {}, querySelector: () => null, append() {}, addEventListener() {}, cloneNode() { return make(tag); } });
  const li = make('LI'), last = make('A'); last.parentElement = li; li.after = (n) => { inserted = n; };
  const root = { isConnected: true, querySelector: () => null, querySelectorAll: () => [last] }; last.getAttribute = () => '/ultra/course';
  const c = vm.createContext({ navRoots: new Set([root]), GZ_NAV: require('../lib/nav.js'), t: (s) => s, document: { createTreeWalker: () => ({ nextNode: () => ({}) }) }, NodeFilter: { SHOW_TEXT: 4 } });
  vm.runInContext(src.slice(start, end) + '\nglazeItem(true);', c);
  assert.equal(inserted.hidden, false);
});

test('bar placement only suppresses the native rail on wide viewports', () => {
  const src = source('features/nav.js'), expression = src.match(/placed: \(\) => (.*) };/)[1];
  for (const wide of [false, true]) {
    const placed = vm.runInNewContext(`() => ${expression}`, { html: { hasAttribute: () => true }, matchMedia: () => ({ matches: wide }) });
    assert.equal(placed(), wide);
  }
});

test('Moodle keyboard order and group descriptions follow visible items and restore native attributes', () => {
  const src = source('features/nav.js'), start = src.indexOf('  const menuItems ='), end = src.indexOf('  const icon =', start);
  assert.ok(start > 0, 'the rail must manage the worn menubar');
  const node = (attrs = {}) => ({ attrs: { ...attrs }, visible: true, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = String(v); }, removeAttribute(k) { delete this.attrs[k]; },
    get tabIndex() { return Number(this.attrs.tabindex ?? 0); }, set tabIndex(v) { this.setAttribute('tabindex', v); },
    closest() { return this.visible ? null : {}; }, getClientRects: () => [1], contains(a) { return a === this; }, focus() { c.document.activeElement = this; } });
  const current = node({ tabindex: '0', 'aria-current': 'page' }), course = node({ tabindex: '-1', 'aria-describedby': 'native-help' }), link = node();
  current.visible = false;
  const before = JSON.stringify([current.attrs, course.attrs, link.attrs]), label = { id: 'group-label' };
  const c = vm.createContext({ host: { querySelectorAll: () => [current, course, link] }, menuAttrs: new Map(), slots: new Map([['g:0', { querySelector: () => label }]]),
    X: { site: 'moodle' }, layout: {}, active: true, chrome: { runtime: { id: 'glaze' } }, document: { activeElement: {}, dir: 'ltr' } });
  const api = vm.runInContext(src.slice(start, end) + '\n({syncMenu, menuKey, menuFocus, restoreMenu});', c);
  api.syncMenu([{ key: 'g:0', kind: 'label' }, { key: 'course', kind: 'native' }], new Map([['course', course]]));
  assert.equal(course.tabIndex, 0); assert.equal(link.tabIndex, -1);
  assert.equal(course.attrs['aria-describedby'], 'native-help group-label');
  const key = (key) => api.menuKey({ key, target: c.document.activeElement, preventDefault() {}, stopImmediatePropagation() {} });
  course.focus(); key('ArrowRight'); assert.equal(c.document.activeElement, link);
  key('Home'); assert.equal(c.document.activeElement, course);
  key('ArrowLeft'); assert.equal(c.document.activeElement, link, 'wraps past the hidden native item');
  c.document.dir = 'rtl'; key('ArrowRight'); assert.equal(c.document.activeElement, course);
  api.restoreMenu();
  assert.equal(JSON.stringify([current.attrs, course.attrs, link.attrs]), before);
});
