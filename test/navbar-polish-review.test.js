const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../defaults.js');
require('../lib/nav.js');
const read = (file) => process.env.GZ_NAVBAR_POLISH_BASE
  ? require('node:child_process').execFileSync('git', ['show', `${process.env.GZ_NAVBAR_POLISH_BASE}:${file}`], { cwd: __dirname, encoding: 'utf8' })
  : fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const S = process.env.GZ_NAVBAR_POLISH_BASE
  ? vm.runInNewContext(read('lib/share.js') + '\nGZ_SHARE;', { require: require('node:module').createRequire(require.resolve('../lib/share.js')), TextEncoder, TextDecoder, module: { exports: {} } })
  : require('../lib/share.js');
const part = (src, a, b) => {
  const start = src.indexOf(a), end = src.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `${a} exists`);
  return src.slice(start, end);
};
const picture = 'data:image/png;base64,AAAA';

const logoFixture = () => {
  const src = read('features/navbar.js'), reads = [], blobs = new Map(), revoked = [];
  const state = { nav: { li: 'aaaaaaaaaaaa' }, navbar: { brand: 'custom' } };
  let serial = 0, changed;
  const c = vm.createContext({ X: { settings: () => state }, settings: () => state.navbar, on: () => true,
    chrome: { runtime: { id: 'glaze' }, storage: { local: { get: (key, cb) => reads.push({ key, cb }) }, onChanged: { addListener: (fn) => { changed = fn; } } } },
    Blob, Uint8Array, atob, URL: { createObjectURL: (blob) => { const url = `blob:${++serial}`; blobs.set(url, blob); return url; }, revokeObjectURL: (url) => { revoked.push(url); blobs.delete(url); } },
    host: { remove() {} }, root: {}, el: {}, sig: '', measured: '', model: {}, rows: [], lay: {}, peek: false, shown: false, rail: null,
    enter: 0, leave: 0, frame: 0, queued: 0, sheetOpen: false, words: '', clearTimeout() {}, cancelAnimationFrame() {},
    menuTo() {}, panelTo() {}, dockTo() {}, wx: null, panels: new Map(), skipMain: new Set(), site: { unobserve() {} }, sizes: null, html: { removeAttribute() {}, style: { removeProperty() {} } }, emit() {},
  });
  const api = vm.runInContext(part(src, "  // The student's own logo:", '  const brandInto =')
    + part(src, '  const stop =', '  const sync =')
    + '\n({ ownLogo, stop });', c);
  c.sync = () => api.ownLogo();
  vm.runInContext(part(src, '  chrome.storage.onChanged.addListener(', "  addEventListener('resize'"), c);
  return { ...api, state, blobs, revoked, c, reads,
    reply: (n, data = picture) => reads[n].cb({ [reads[n].key]: data }),
    change: () => changed({ 'navLogo:aaaaaaaaaaaa': { newValue: picture } }, 'local'),
  };
};

test('a newer read of the same logo wins over a delayed storage snapshot', async () => {
  const f = logoFixture(); f.ownLogo(); f.change();
  assert.equal(f.reads.length, 2);
  f.reply(1, 'data:image/png;base64,AQID');
  const current = f.ownLogo(); f.reply(0);
  assert.equal(f.ownLogo(), current, 'the older callback cannot replace the new logo');
  assert.equal(f.blobs.size, 1, 'no overwritten blob URL is left alive');
  assert.deepEqual([...new Uint8Array(await f.blobs.get(current).arrayBuffer())], [1, 2, 3]);
});

test('stopping the navigation releases its logo and allows a fresh read on remount', () => {
  const f = logoFixture(); f.ownLogo(); f.reply(0);
  const old = f.ownLogo(); f.stop();
  assert.deepEqual(f.revoked, [old]); assert.equal(f.blobs.size, 0);
  f.c.host = {}; f.ownLogo(); assert.equal(f.reads.length, 2);
});

test('a logo read completing after stop creates no blob', () => {
  const f = logoFixture(); f.ownLogo(); f.stop(); f.reply(0);
  assert.equal(f.blobs.size, 0);
});

test('switching away from a custom brand releases the logo and ignores pending reads', () => {
  const f = logoFixture(); f.ownLogo(); f.reply(0);
  f.state.navbar.brand = 'glaze'; assert.equal(f.ownLogo(), ''); assert.equal(f.blobs.size, 0);
  f.state.navbar.brand = 'custom'; f.ownLogo();
  f.state.navbar.brand = 'none'; f.ownLogo(); f.reply(1);
  assert.equal(f.blobs.size, 0);
});

test('malformed base64 is a missing logo, without an uncaught callback error', () => {
  const f = logoFixture(); f.ownLogo();
  assert.doesNotThrow(() => f.reply(0, 'data:image/png;base64,A'));
  assert.equal(f.blobs.size, 0);
});

test('the logo reader refuses non-raster types, non-strings and oversized data', () => {
  for (const data of ['data:image/svg+xml;base64,AAAA', 'https://school.test/logo.png', {}, null, `data:image/png;base64,${'A'.repeat(400000)}`]) {
    const f = logoFixture(); f.ownLogo(); assert.doesNotThrow(() => f.reply(0, data)); assert.equal(f.blobs.size, 0);
  }
});

test('shared custom-logo Looks explicitly select Glaze even on a device with its own logo', async () => {
  const s = G.GZ_SANITIZE({ navbar: { brand: 'custom' }, nav: { li: 'aaaaaaaaaaaa' } });
  const got = await S.decode(await S.encode(s, {}, null));
  assert.equal(got.navbar.brand, 'glaze');
  assert.equal(G.GZ_SANITIZE({ ...s, navbar: { ...s.navbar, ...got.navbar } }).navbar.brand, 'glaze');
  assert.ok(!JSON.stringify(got).includes('aaaaaaaaaaaa'));
});

test('existing Look codes with a custom brand import as Glaze', async () => {
  const raw = { c: G.GZ_COLORS.map(([k]) => G.GZ_DEFAULTS.colors[k].slice(1)).join(''), v: { brand: 'custom' } };
  const code = S.PREFIX + require('node:zlib').deflateRawSync(Buffer.from(JSON.stringify(raw))).toString('base64url');
  assert.equal((await S.decode(code)).navbar.brand, 'glaze');
});

const backupFixture = () => {
  const elements = {}, writes = [], downloads = [];
  const s = G.GZ_SANITIZE({ navbar: { brand: 'custom' }, nav: { brand: 'custom', li: 'aaaaaaaaaaaa' } });
  const c = { s, navigator: {}, GZ_SANITIZE: G.GZ_SANITIZE, GZ_CARDS: require('../lib/cards.js'), GZ_XPARTS: require('../lib/lookparts.js'),
    GZ_NAVBAR: require('../lib/navbar.js'), GZ_TODO: { STORE_KEY: /^todo:/ }, GZ_PET: { KEY: /^pet:/, backup: () => ({}) }, GZ_FOLDERS: { backup: () => ({}) },
    N: { clean: () => ({}) }, Blob, URL: { createObjectURL: (blob) => { downloads.push(blob); return 'blob:backup'; }, revokeObjectURL() {} }, setTimeout() {},
    document: { createElement: () => ({ click() {} }) },
    $: (id) => (elements[id] ||= { addEventListener: (type, fn) => { elements[id][type] = fn; } }),
    flush() {}, fill() {}, renderNavItems() {}, showNavPreview() {}, cardsOp: async () => true, hint() {}, t: (s) => s,
    chrome: { storage: { sync: { get: async () => ({}) }, local: { get: async () => ({}) } }, runtime: { sendMessage: (m, cb) => { writes.push(m); const r = { ok: true, keys: [] }; cb?.(r); return Promise.resolve(r); } } },
  };
  const src = read('options.js'); vm.runInNewContext(part(src, '  // ---- backup ----', '  // Two clicks, so a stray'), c);
  return { s, elements, writes, downloads };
};

test('a settings backup exports Glaze in place of the device-only navigation logo', async () => {
  const f = backupFixture(); await f.elements['#export'].click({ isTrusted: true });
  const saved = JSON.parse(await f.downloads[0].text());
  assert.equal(saved.navbar.brand, 'glaze'); assert.equal(saved.nav.li, '');
});

test('restoring a backup with a custom navigation brand selects Glaze without a picture reference', async () => {
  const f = backupFixture();
  await f.elements['#import'].change({ isTrusted: true, target: { files: [{ name: 'settings.json', text: async () => JSON.stringify(f.s) }] } });
  assert.equal(f.writes[0].restore.settings.navbar.brand, 'glaze');
  assert.equal(f.s.navbar.brand, 'glaze'); assert.equal(f.s.nav.li, '');
});

test('a course frame follows the parent navigation placement and disconnects when disabled', () => {
  const src = read('features/coursetabs.js'); let words = 'rail tabs', observer, connected = false, flag;
  const strip = { remove() { connected = false; }, contains: () => false, dataset: {} };
  const c = vm.createContext({ framed: '_2_1', on: true, strip, navWatch: null, P: () => ({ at: 'nav', size: 'large' }), loaded: true, tabs: [{}],
    parent: { document: { documentElement: { getAttribute: () => words } } },
    html: { getAttribute: () => flag, setAttribute: (_, v) => { flag = v; } }, sessionStorage: { getItem: () => null, setItem() {} },
    keepClear() {}, home: () => ({ at: 'above', ok: false, put: () => { connected = true; } }),
    MutationObserver: class { constructor(fn) { this.fn = fn; observer = this; } observe() { this.active = true; } disconnect() { this.active = false; } },
    document: { addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {},
    onScroll() {}, onLeave() {}, onHide() {}, lay() {}, onResize() {}, measureRow() {}, navRoom() {}, ctx: { site: 'ultra' }, chrome: { runtime: {} },
  });
  const api = vm.runInContext(part(src, '  const navHolds =', '  // From content-ultra.js')
    + part(src, '  const flag =', '  // ---- the strip')
    + part(src, '  const listen =', '  const start =')
    + '\n({ listen, place, flag });', c);
  c.bar = { place: () => { api.flag(); api.place(); } };
  api.listen(true); c.bar.place(); assert.equal(flag, 'nav'); assert.equal(connected, false);
  const change = (next) => { words = next; if (observer?.active) observer.fn(); };
  change('none'); assert.equal(flag, 'above large page'); assert.equal(connected, true);
  change('top tabs'); assert.equal(flag, 'nav'); assert.equal(connected, false);
  api.listen(false); assert.equal(observer.active, false);
});

test('the moved course tabs settings name the sites that actually load the feature', () => {
  assert.match(read('content-ultra.js'), /need\('features\/coursetabs.js'/);
  assert.match(read('content-canvas.js'), /features\/coursetabs.js/);
  const section = read('options.html').match(/<section id="tabs"[\s\S]*?<\/section>/)[0];
  assert.match(section, /data-sites="Canvas · Blackboard Ultra"/);
});

test('first paint reserves the fallback strip when cached nav placement no longer has a host', () => {
  const src = read('content-ultra.js');
  const paint = part(src, '  const paintCourses =', '    const colors =') + '\n}; paintCourses;';
  for (const [navbar, path, framed, parentWords, expected] of [
    [{ on: false, tabs: true }, '/ultra/course', '', '', 'above medium'],
    [{ on: true, tabs: false }, '/ultra/course', '', '', 'above medium'],
    [{ on: true, tabs: true, course: 'hide' }, '/ultra/courses/_1_1/outline', '', '', 'above medium'],
    [{ on: true, tabs: true, course: 'same' }, '/ultra/courses/_1_1/outline', '', '', 'nav'],
    [{ on: true, tabs: true }, '/ultra/courses/_1_1/outline', '_1_1', 'none', 'above medium'],
    [{ on: true, tabs: true }, '/ultra/courses/_1_1/outline', '_1_1', 'rail tabs', 'nav'],
  ]) {
    let word;
    const run = vm.runInNewContext(paint, { I: { settings: { navbar }, setAttr: (_, v) => { word = v; } },
      sessionStorage: { getItem: () => 'nav' }, tabsOn: () => true, isPreview: true, tabFrame: framed,
      parent: { document: { documentElement: { getAttribute: () => parentWords } } }, location: { pathname: path } });
    run(); assert.equal(word, expected, JSON.stringify({ navbar, path, framed, parentWords }));
  }
});
