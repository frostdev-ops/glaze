// Course tabs' place, tabs.at 'auto' (the default, the owner's call): only in Glaze's navigation where that is a top bar holding
// them on this page, else the strip above the course's bar. The first paint keeps no strip room on a top-bar page; a stored
// 'above' (the old default the editor saved whole) becomes 'auto' once, on the update, and a later chosen 'above' stays.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../lib/coursetabs.js');
const D = require('../defaults.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const between = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i); assert.ok(j > i, b); return src.slice(i, j); };
const S = (navbar = {}, enhance = {}, tabs = {}) => D.GZ_SANITIZE({ navbar: { on: true, ...navbar }, enhance: { tabs: true, ...enhance }, tabs });

test("'auto' is the default and a choice; the old places, Looks' and shared settings' values still sanitize", () => {
  assert.equal(D.GZ_DEFAULTS.tabs?.at ?? D.GZ_SANITIZE({}).tabs.at, 'auto');
  for (const at of ['auto', 'above', 'between', 'below', 'nav']) assert.equal(D.GZ_SANITIZE({ tabs: { at } }).tabs.at, at);
  assert.equal(D.GZ_SANITIZE({ tabs: { at: 'sideways' } }).tabs.at, 'auto');
  assert.equal(D.GZ_SANITIZE(D.GZ_SANITIZE({ tabs: { at: 'auto', size: 'large' } })).tabs.size, 'large', 'a saved theme with the new value round-trips');
});

test("the rule: 'nav' only where this page's bar is a top bar that holds the tabs", () => {
  const R = D.GZ_TABS_AUTO;
  assert.equal(R(S({ place: 'top' }), false), 'nav');
  assert.equal(R(S({ place: 'top' }), true), 'nav', "a course's page with navbar.course 'same'");
  assert.equal(R(S({ place: 'rail' }), false), 'above');
  assert.equal(R(S({ place: 'rail', course: 'top' }), true), 'nav', "navbar.course 'top' on a course's pages");
  assert.equal(R(S({ place: 'rail', course: 'top' }), false), 'above', 'and not elsewhere');
  for (const course of ['icons', 'hide']) assert.equal(R(S({ place: 'top', course }), true), 'above', course);
  assert.equal(R(S({ place: 'top', on: false }), false), 'above', 'Glaze navigation off');
  assert.equal(R(S({ place: 'top', tabs: false }), false), 'above', 'the bar not holding the tabs');
  assert.equal(R(S({ place: 'top' }, { tabs: false }), false), 'above', 'course tabs off');
  assert.equal(R(S({ place: 'none' }), false), 'above');
});

test("features/coursetabs.js resolves 'auto' from the bar on the page (the page around a tab's frame), beside 'nav'", () => {
  const src = read('features/coursetabs.js');
  const at = (stored, words, framed = false) => {
    const doc = (w) => ({ documentElement: { getAttribute: () => w } });
    const ctx = vm.createContext({ P: () => ({ at: stored }), framed, innerWidth: 1280, document: doc(framed ? 'rail open float' : words), parent: { innerWidth: 1280, document: doc(words) }, GZ_TABS_AUTO: D.GZ_TABS_AUTO });
    return vm.runInContext(`${between(src, '  const navHolds = ', '  const hosted = ')}\nat()`, ctx);
  };
  assert.equal(at('auto', 'top float tabs'), 'nav');
  assert.equal(at('auto', 'top float'), 'above', 'the bar not holding the tabs');
  assert.equal(at('auto', 'rail open float tabs'), 'above', 'a rail');
  assert.equal(at('auto', null), 'above', 'no bar');
  assert.equal(at('auto', 'top embed tabs menu', true), 'nav', "a tab's frame reads the page around it");
  assert.equal(at('nav', 'rail open float tabs'), 'nav');
  assert.equal(at('nav', 'top float'), 'above');
  assert.equal(at('below', 'top float tabs'), 'below');
});

test("auto keeps the strip on phones, where the navigation is a bottom bar", () => {
  const src = read('features/coursetabs.js');
  for (const innerWidth of [390, 899, 900, 1280]) {
    const ctx = vm.createContext({ P: () => ({ at: 'auto' }), framed: false, innerWidth,
      document: { documentElement: { getAttribute: () => 'top float tabs' } } });
    assert.equal(vm.runInContext(`${between(src, '  const navHolds = ', '  const hosted = ')}\nat()`, ctx), innerWidth < 900 ? 'above' : 'nav', `width ${innerWidth}`);
  }
  assert.equal(D.GZ_TABS_AUTO(S({ place: 'top' }), false, 390), 'above', 'first paint agrees');
});

test('changing a top bar to a rail repositions automatic tabs even when both bars hold tabs', () => {
  const placed = [];
  const ctx = vm.createContext({ words: 'top float tabs', lay: { words: 'rail open float tabs', tabs: true, left: 272, top: 0 },
    X: { setVar() {} }, html: { setAttribute() {} }, tabsApi: () => ({ place: () => placed.push(true) }) });
  vm.runInContext(`${between(read('features/navbar.js'), '  const room = () => {', '  const geometry = ')}\nroom();`, ctx);
  assert.equal(placed.length, 1, 'the old hidden strip must be restored immediately');
});

test('the first paint without a cached strip keeps no room for one on a top-bar page, on Canvas and on Ultra', () => {
  const attrs = {};
  const canvas = (navbar, pathname = '/courses/5') => {
    const ctx = vm.createContext({ sessionStorage: { getItem: () => null }, location: { pathname }, setAttr: (k, v) => { attrs[k] = v; }, GZ_TABS_AUTO: D.GZ_TABS_AUTO,
      I: { links: [1], solo: true, settings: S(navbar) } });
    vm.runInContext(`${between(read('content-canvas.js'), '  const paintTabs = () => {', '\n  const syncNav')}\npaintTabs();`, ctx);
    return attrs['data-gz-ctabs'];
  };
  assert.equal(canvas({ place: 'top' }), 'nav');
  assert.equal(canvas({ place: 'rail' }), 'above medium');
  assert.equal(canvas({ place: 'rail', course: 'top' }), 'nav');
  assert.equal(canvas({ place: 'rail', course: 'top' }, '/'), 'above medium');
  const ultra = (navbar, pathname = '/ultra/courses/_5_1/outline', tabFrame = false, parentWords = '') => {
    const ctx = vm.createContext({ sessionStorage: { getItem: () => null }, location: { pathname }, tabFrame, isPreview: true, GZ_TABS_AUTO: D.GZ_TABS_AUTO,
      parent: { innerWidth: 1280, document: { documentElement: { getAttribute: () => parentWords } } }, tabsOn: () => true,
      I: { settings: S(navbar), setAttr: (k, v) => { attrs[k] = v; } } });
    vm.runInContext(`${between(read('content-ultra.js'), '  const paintCourses = () => {', '    if (isPreview) return;')}}\npaintCourses();`, ctx);
    return attrs['data-gz-ctabs'];
  };
  assert.equal(ultra({ place: 'top' }), 'nav');
  assert.equal(ultra({ place: 'rail' }), 'above medium');
  assert.equal(ultra({ place: 'rail' }, '/ultra/courses/_5_1/outline', true, 'top float tabs'), 'nav', "a tab's frame under a top bar");
  assert.equal(ultra({ place: 'top' }, '/ultra/courses/_5_1/outline', true, 'rail open float tabs'), 'above medium', "a tab's frame under a rail");
});

const worker = (sync, local = {}) => {
  const listeners = { installed: [] };
  const area = (store) => ({ get: async (k) => (k == null ? { ...store } : Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, structuredClone(store[x])]))),
    set: async (o) => { Object.assign(store, structuredClone(o)); }, remove: async () => {}, clear: async () => {} });
  const none = { addListener() {} };
  const ctx = vm.createContext({ URL, TextEncoder, TextDecoder, structuredClone, console: { ...console, warn() {} }, crypto, atob, btoa, setTimeout, clearTimeout, Date, navigator: {},
    GZ_SESSIONS: { make: () => ({ handle: async () => ({ ok: true }), connect: () => () => {}, stop() {}, changed() {} }) },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), ctx); },
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: none, onConnect: none, onInstalled: { addListener: (f) => listeners.installed.push(f) }, onStartup: none },
    tabs: { onRemoved: none, query: async () => [] }, storage: { local: area(local), sync: area(sync), onChanged: none },
    scripting: { unregisterContentScripts: async () => {}, registerContentScripts: async () => {}, getRegisteredContentScripts: async () => [] },
    permissions: { contains: async () => false, getAll: async () => ({ origins: [] }) }, action: { setIcon: async () => {} }, declarativeContent: { onPageChanged: { removeRules: (a, f) => f?.(), addRules: (a, f) => f?.() } } } });
  vm.runInContext(read('lib/background.js'), ctx);
  return { install: async (reason) => { for (const f of listeners.installed) f({ reason }); for (let i = 0; i < 40; i++) await new Promise(setImmediate); } };
};

test("an update moves a stored 'above' to 'auto' once; a later chosen 'above' stays, and a fresh install is marked done", async () => {
  const sync = { tabs: { at: 'above', size: 'large' } }, local = {};
  const w = worker(sync, local);
  await w.install('update');
  assert.deepEqual([sync.tabs.at, sync.tabs.size], ['auto', 'large']);
  assert.ok(local.migrated?.includes('tabs-auto'));
  sync.tabs.at = 'above'; // chosen after
  await w.install('update');
  assert.equal(sync.tabs.at, 'above', 'not again');
  for (const at of ['below', 'nav']) {
    const s = { tabs: { at } }, l = {};
    await worker(s, l).install('update');
    assert.equal(s.tabs.at, at, `a chosen ${at} stays`);
    assert.ok(l.migrated?.includes('tabs-auto'));
  }
  const fresh = {}, freshLocal = {};
  await worker(fresh, freshLocal).install('install');
  assert.equal(fresh.tabs, undefined, 'nothing written for a fresh install');
  assert.ok(freshLocal.migrated?.includes('tabs-auto'), 'and a later update leaves its choice');
});
