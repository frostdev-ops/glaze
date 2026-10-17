const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../features/nav.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

const node = (tag = 'div') => ({
  tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, style: { removeProperty() {} },
  get isConnected() { return this.connected || this.parentNode?.isConnected || false; },
  append(...children) { for (const child of children) { child.remove(); child.parentNode = this; this.children.push(child); } },
  before(...children) { for (const child of children) { child.remove(); const parent = this.parentNode; child.parentNode = parent; parent.children.splice(parent.children.indexOf(this), 0, child); } },
  after(...children) { for (const child of children.reverse()) { child.remove(); const parent = this.parentNode; child.parentNode = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, child); } },
  remove() { if (this.parentNode) { const children = this.parentNode.children; children.splice(children.indexOf(this), 1); this.parentNode = null; } },
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); },
  setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; }, removeAttribute(k) { delete this.attrs[k]; },
  querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {},
  contains(child) { return this === child || this.children.some((c) => c.contains(child)); },
});

for (const site of ['canvas', 'moodle']) for (const layout of [null, { place: 'left' }]) {
  test(`${site} connects both mod rail producers ${layout ? 'with' : 'without'} a Look layout and removes them when stopped`, () => {
    const html = node('html'), list = node('ul'), head = node('head'); html.connected = true; html.append(head, list);
    const scripted = node(), declarative = node();
    let mods = [{ key: 'scripted', el: scripted }], widgets = [{ key: 'declarative', el: declarative }];
    const N = require('../lib/nav-items.js'), EMPTY = N.clean();
    const context = vm.createContext({
      X: { site, parts: () => layout && { nav: layout } }, N, L: require('../lib/navlayout.js'), EMPTY, stored: EMPTY, roots: '', items: '',
      GZ_MODS: { rail: () => mods }, GZ_MODWIDGETS: { rail: () => widgets },
      document: { documentElement: html, head, activeElement: {}, querySelector: () => list }, html,
      make: (tag, props = {}, ...children) => { const el = Object.assign(node(tag), props); el.append(...children); return el; },
      captured: new Map(), custom: new Map(), slots: new Map(), iconed: new Map(), widgetNodes: new Map(), shells: [],
      active: false, config: EMPTY, layout: null, host: null, top: null, bottom: null, signature: '', rev: 0, clock: 0,
      sheet: null, watch: null, logo: null, logoId: '', iconRead: null,
      MutationObserver: class { observe() {} disconnect() {} takeRecords() {} },
      chrome: { runtime: { getURL: (f) => f } }, clearTimeout() {}, restoreMenu() {}, menuKey() {}, menuFocus() {},
      readLocal() {}, drawWidgets() {}, syncMenu() {}, place() {},
    });
    const sync = vm.runInContext(section('  const restore =', '  const loadLogo =')
      + section('  const mountWidgets =', '  // A bar along the top or bottom') + '\nsync;', context);
    sync(true);
    assert.equal(scripted.isConnected, true, 'scripted rail widget is attached');
    assert.equal(declarative.isConnected, true, 'declarative rail widget is attached');
    assert.equal(scripted.parentNode, declarative.parentNode);
    assert.notEqual(scripted.parentNode, list, 'widget groups stay outside the native list/menubar');
    assert.ok(head.children.some((el) => el.href === 'features/navlayout.css'), 'the existing widget styles are loaded');
    sync(true);
    assert.equal(scripted.isConnected && declarative.isConnected, true, 'repeated sync keeps the mounts');
    mods = []; widgets = []; sync(true);
    assert.equal(scripted.isConnected || declarative.isConnected, false, 'removed mods leave no attached widgets');
    mods = [{ key: 'scripted', el: scripted }]; sync(true);
    assert.equal(scripted.isConnected, true);
    sync(false);
    assert.equal(scripted.isConnected, false, 'turning Glaze off removes the mount');
    assert.equal(list.isConnected, true, 'the native navigation remains');
  });
}
