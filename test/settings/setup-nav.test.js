// The setup wizard's Navigation step (settings/setup-nav.js): what the first screen may change of Glaze's own bar through the
// worker (background/background.js 'glaze:navbar' and 'glaze:navbarItems'), and the step's own rules.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// The real worker in a VM, with stand-in storage.
const worker = (local = {}, syncStore = {}) => {
  const m = require('../../extension/manifest.json');
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  const area = (s) => ({
    get: (k) => later(() => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: (v) => later(() => { Object.assign(s, structuredClone(v)); }),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete s[x]; }),
  });
  const listeners = [];
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`background/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(local), sync: area(syncStore), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('background/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  return { send, local, sync: syncStore };
};
const welcome = { id: 'glaze', url: 'chrome-extension://x/settings/welcome.html#/nav', frameId: 0, tab: { id: 12 } };
const canvas = { id: 'glaze', url: 'https://school.instructure.com/courses/1', frameId: 0, tab: { id: 3 } };
const denied = { ok: false, error: 'sender' };

test('the first screen sets the bar on or off, its place, its rail and its style, one at a time', async () => {
  const w = worker({}, { navbar: { place: 'rail', course: 'icons', brand: 'school' } });
  const nav = (patch, sender = welcome) => w.send({ type: 'glaze:navbar', patch }, sender);
  for (const [k, v] of [['place', 'top'], ['rail', 'icons'], ['rail', 'open'], ['style', 'embed'], ['on', false], ['on', true], ['place', 'rail'], ['rail', 'auto'], ['style', 'float']]) {
    assert.deepEqual(await nav({ [k]: v }), { ok: true }, `${k}: ${v}`);
    assert.equal(w.sync.navbar[k], v, `${k}: ${v}`);
  }
  assert.equal(w.sync.navbar.course, 'icons', 'the rest of the bar is kept');
  assert.equal(w.sync.navbar.brand, 'school');
  for (const patch of [{ place: 'none' }, { rail: 'peek' }, { style: 'glass' }, { on: 'false' }, { place: 'top', rail: 'open' }, { on: true, style: 'embed' },
    { course: 'hide' }, { tabs: false }, { brand: 'glaze' }, { cmenu: false }, { peek: false }, { badges: false }, { __proto__: null, constructor: 'x' }, {}, ['top']]) {
    assert.deepEqual(await nav(patch), denied, JSON.stringify(patch));
  }
  assert.deepEqual(await nav({ place: 'top' }, { ...welcome, frameId: 1 }), denied, 'not from a frame');
  assert.deepEqual(await nav({ place: 'top' }, { ...welcome, url: 'chrome-extension://x/settings/welcome.html.evil' }), denied);
  assert.deepEqual(await nav({ place: 'top' }, canvas), denied, 'a page may only pin its rail');
  assert.equal(w.sync.navbar.place, 'rail');
});

test('the first screen picks Glaze\'s own items in the bar, merged into the latest stored items', async () => {
  const kept = { items: { calendar: { label: 'Dates', hidden: true } }, groups: [{ label: 'Main', items: ['course', 'calendar'] }], tabs: ['course'], glaze: ['settings'],
    links: [{ id: 'abcdefghijkl', n: 'Library', u: 'https://library.school.edu/', i: 'link', tab: false }], widgets: [{ id: 'clock', at: 'top' }] };
  const w = worker({ freshDefaults: { fresh: false, pending: false } }, { navbarItems: structuredClone(kept) });
  const items = (glaze, sender = welcome) => w.send({ type: 'glaze:navbarItems', glaze }, sender);
  assert.deepEqual(await items(['notes', 'settings', 'todo']), { ok: true });
  assert.deepEqual(w.sync.navbarItems.glaze, ['notes', 'todo', 'settings'], 'in the bar\'s own order');
  for (const k of ['items', 'groups', 'tabs', 'links', 'widgets']) assert.deepEqual(w.sync.navbarItems[k], kept[k], `${k} kept`);
  assert.deepEqual(await items([]), { ok: true });
  assert.deepEqual(w.sync.navbarItems.glaze, []);
  for (const bad of [['notes', 'notes'], ['notes', 'mail'], ['__proto__'], 'notes', null, [1], ['notes', 'documents', 'todo', 'search', 'settings', 'notes'], { 0: 'notes', length: 1 }]) {
    assert.deepEqual(await items(bad), denied, JSON.stringify(bad));
  }
  assert.deepEqual(await items(['notes'], canvas), denied, 'only the first screen');
  assert.deepEqual(await items(['notes'], { ...welcome, frameId: 2 }), denied, 'not from a frame');
  assert.deepEqual(await items(['notes'], { id: 'glaze', url: 'chrome-extension://x/options.html', frameId: 0, tab: { id: 4 } }), denied, 'Settings writes the whole record itself');
  assert.deepEqual(w.sync.navbarItems.glaze, []);
});

test('on a fresh install with nothing stored, the items picked are the whole record', async () => {
  const w = worker({}, {});
  assert.deepEqual(await w.send({ type: 'glaze:navbarItems', glaze: ['search'] }, welcome), { ok: true });
  assert.deepEqual(w.sync.navbarItems, { items: {}, groups: [], tabs: [], glaze: ['search'], links: [] });
  assert.equal('navItems' in w.sync, false, 'the older rail\'s record is not written');
});

// The step's own rules (settings/setup-nav.js).
const S = require('../../extension/settings/setup-nav.js');
const G = require('../../extension/content/defaults.js');
const M = require('../../extension/navigation/navbar.js');

test('every choice the step shows is a value of the bar\'s setting, and its icons are the bar\'s own', () => {
  for (const [key, table] of [['place', S.PLACES], ['rail', S.RAILS], ['style', S.STYLES]]) {
    assert.deepEqual(table.map(([v]) => v), G.GZ_SPEC.navbar[key][1], key);
    for (const [, label] of table) assert.match(label, /^\p{Lu}/u, `${key}: a label`);
  }
  assert.deepEqual(Object.keys(S.NAMES), M.GLAZE, 'one name for each of Glaze\'s own items, in the bar\'s order');
  for (const g of M.GLAZE) assert.ok(M.ICONS[S.iconOf(g)], g);
  assert.equal(S.iconOf('settings'), 'glaze', 'the settings item wears the bar\'s drop, as navbar.js build gives it');
  for (const name of S.NATIVE) assert.ok(M.ICONS[name], name);
});

test('Glaze\'s items are read as the bar reads them, and one turns on or off in the bar\'s order', () => {
  assert.deepEqual(S.items({}, true), ['settings'], 'a fresh install has the settings item');
  assert.deepEqual(S.items({}, false), [], 'a device joining an account waits for sync');
  assert.deepEqual(S.items({ navbarItems: { glaze: ['todo', 'notes', 'mail'] } }, true), ['notes', 'todo']);
  assert.deepEqual(S.items({ navItems: { order: [] } }, true), [], 'an older rail\'s student is not given the item');
  assert.deepEqual(S.flip(['settings'], 'notes'), ['notes', 'settings']);
  assert.deepEqual(S.flip(['notes', 'settings'], 'settings'), ['notes']);
  assert.deepEqual(S.flip([], 'search'), ['search']);
});

test('the done step names the bar as Settings does', () => {
  const n = G.GZ_SANITIZE({}).navbar;
  assert.equal(S.summary(n), 'Side rail');
  assert.equal(S.summary({ ...n, place: 'top' }), 'Top bar');
  assert.equal(S.summary({ ...n, place: 'top', on: false }), 'Off');
});

test('the step saves through the worker\'s first-screen messages only, fetches nothing, and writes text as text', () => {
  const js = read('settings/setup-nav.js');
  assert.match(js, /api\.save\(`navbar\.\$\{key\}`, value, \{ type: 'glaze:navbar', patch: \{ \[key\]: value \} \}\)/);
  assert.match(js, /api\.save\('navbarItems\.glaze', list, \{ type: 'glaze:navbarItems', glaze: list \}\)/);
  assert.doesNotMatch(js, /chrome\.storage\.\w+\.set|\bfetch\(|XMLHttpRequest|innerHTML|insertAdjacentHTML|chrome\.permissions\./);
  const html = read('settings/welcome.html');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  for (const f of ['../navigation/nav.js', '../navigation/nav-items.js', '../navigation/navlayout.js', '../navigation/navbar.js']) assert.ok(at(f) > 0 && at(f) < at('setup-nav.js'), `${f} loads before the step`);
  assert.ok(at('setup-nav.js') < at('setup.js'), 'the step registers before the wizard mounts its parts');
});
