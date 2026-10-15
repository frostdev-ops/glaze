const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deflateRawSync } = require('node:zlib');
const G = require('../defaults.js');
const K = require('../lib/cards.js');
const S = require('../lib/share.js');

test('nav imports keep bounded styles and https links, never executable values', () => {
  const d = G.GZ_DEFAULTS.nav;
  const nav = G.GZ_SANITIZE({ nav: { k: 'gradient', c: '#ABCDEF', d: 'red; color:black', a: 361, u: 'javascript:alert(1)', i: '../../secret', o: -1, ink: '#000000', labels: 'icons', size: 'huge', collapsed: 1, f: 'constructor' } }).nav;
  assert.deepEqual(nav, { ...d, k: 'gradient', c: '#abcdef', ink: '#000000', labels: 'icons' });
  for (const u of ['http://example.com/x', 'data:image/png;base64,AAAA', '//example.com/x']) assert.equal(G.GZ_SANITIZE({ nav: { u } }).nav.u, '');
  const clean = G.GZ_SANITIZE({ nav: { k: 'image', u: 'https://example.com/a"b.png', o: 0, i: 'abcdefghijkl' } }).nav;
  assert.equal(clean.u, 'https://example.com/a%22b.png');
  assert.deepEqual(G.GZ_SANITIZE({ nav: clean }).nav, clean);
  assert.ok(K.bytes('nav', clean) < K.ITEM_MAX);
});

test('nav codes share appearance, preserving layout and excluding local pictures', async () => {
  const nav = { ...G.GZ_DEFAULTS.nav, k: 'image', u: 'https://example.com/sidebar.webp', c: '#112233', ink: '#eeeeee', o: 35, f: 'mono', labels: 'icons', logo: false, size: 'small', collapsed: true };
  const code = await S.encode(G.GZ_SANITIZE({ nav }));
  const got = await S.decode(code);
  assert.deepEqual(G.GZ_SANITIZE({ nav: got.nav }).nav, { ...nav, labels: 'normal', logo: true, size: 'medium', collapsed: false });
  assert.deepEqual((await S.decode(await S.encode(G.GZ_SANITIZE({ nav: { collapsed: true, labels: 'icons', size: 'large', logo: false } })))).nav, {});
  assert.ok(!('i' in got.nav));
  const local = await S.decode(await S.encode(G.GZ_SANITIZE({ nav: { ...nav, u: '', i: 'abcdefghijkl' } })));
  assert.ok(!('i' in local.nav));
  assert.equal(G.GZ_SANITIZE({ nav: local.nav }).nav.k, 'default');
  const raw = { c: G.GZ_COLORS.map(([v]) => G.GZ_DEFAULTS.colors[v].slice(1)).join('') };
  const pack = (n) => 'glaze1:' + deflateRawSync(JSON.stringify({ ...raw, n })).toString('base64url');
  for (const n of [null, [], { i: 'abcdefghijkl' }, { u: 'javascript:alert(1)' }, { labels: 'hidden' }, { k: 'image' }, { k: 'solid', c: 'red' }]) await assert.rejects(S.decode(pack(n)), JSON.stringify(n));

});

test('local nav picture callbacks cannot repaint after disable or a later selection', () => {
  let nav = { ...G.GZ_DEFAULTS.nav, i: 'aaaaaaaaaaaa', collapsed: true }, on = true;
  const calls = [], painted = [], revoked = [], attrs = new Map([['aria-label', 'Native toggle']]);
  const button = { getAttribute: (k) => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
  const context = vm.createContext({
    GZ_CTX: { nav: () => nav, on: () => on, settings: () => ({ enabled: on }), t: (k) => k, local: (f) => f({ get: (k, cb) => calls.push([k, cb]) }), repaintNav: (s) => painted.push(s) },
    document: { getElementById: () => button, querySelectorAll: () => [], addEventListener() {} },
    Blob, Uint8Array, atob, URL: { createObjectURL: () => 'blob:http://localhost/local-picture', revokeObjectURL: (u) => revoked.push(u) },
    chrome: { storage: { onChanged: { addListener() {} } } },
  });
  const ui = vm.runInContext(fs.readFileSync(require.resolve('../features/nav.js'), 'utf8'), context);
  ui.sync();
  assert.equal(attrs.get('aria-label'), 'Expand global navigation');
  nav = { ...nav, i: 'bbbbbbbbbbbb' };
  ui.sync();
  calls[0][1]({ 'cardImg:aaaaaaaaaaaa': 'data:image/png;base64,AAAA' });
  assert.deepEqual(painted, []);
  assert.doesNotThrow(() => calls[1][1]({ 'cardImg:bbbbbbbbbbbb': 'data:image/png;base64,B' }), 'damaged local data stays on the fill');
  assert.deepEqual(painted, []);
  calls[1][1]({ 'cardImg:bbbbbbbbbbbb': 'data:image/png;base64,BBBB' });
  assert.deepEqual(painted, ['blob:http://localhost/local-picture']);
  ui.sync();
  assert.equal(painted.length, 2, 'loaded picture reuses its blob URL');
  on = false;
  ui.sync();
  calls[1][1]({ 'cardImg:bbbbbbbbbbbb': 'data:image/png;base64,BBBB' });
  assert.equal(painted.length, 2);
  assert.deepEqual(revoked, ['blob:http://localhost/local-picture']);
  assert.equal(attrs.get('aria-label'), 'Native toggle');
  assert.equal(attrs.has('title'), false);
});

test('the shared image contrast reader measures pixels with the selected filter', async () => {
  let filter;
  const context = vm.createContext({
    Image: class { set src(v) { this.onload(); } },
    document: { createElement: () => ({ getContext: () => ({ set filter(v) { filter = v; }, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(Array(64).fill([128, 128, 128, 255]).flat()) }) }) }) },
  });
  for (const f of ['lib/color.js', 'lib/fonts.js', 'defaults.js', 'lib/cards.js']) vm.runInContext(fs.readFileSync(require.resolve('../' + f), 'utf8'), context);
  assert.equal(await vm.runInContext('GZ_CARDS.average("data:image/png;base64,AAAA", "mono")', context), '#808080');
  assert.equal(filter, 'grayscale(1)');
});

test('a debounced sidebar color edit sends only its field, never an old picture or kind', () => {
  const sent = [], writes = [];
  const context = vm.createContext({
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(structuredClone(m)); cb({ ok: true }); } }, storage: { sync: { set: (p, cb) => { writes.push(p); cb(); } } } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../ui.js'), 'utf8') + '\nglobalThis.UI = GZ_UI;', context);
  const old = G.GZ_SANITIZE({ nav: { k: 'gradient', i: 'aaaaaaaaaaaa' } });
  context.UI.save(old, ['nav'], () => {}, { c: '#123456' });
  assert.deepEqual(sent[0], { type: 'glaze:nav', nav: { c: '#123456' } });
  assert.deepEqual(writes, []);
});

test('appearance-only theme patches keep a recipient’s local picture', () => {
  const current = G.GZ_SANITIZE({ nav: { k: 'image', i: 'abcdefghijkl' } }).nav;
  const patched = S.nav(current, { ink: '#000000' });
  assert.equal(patched.i, current.i);
  assert.equal(patched.k, 'image');
  assert.equal(patched.ink, '#000000');
  assert.equal(S.nav(current, { k: 'solid' }).i, '');
  assert.equal(S.nav(current, { u: 'https://example.com/new.webp' }).i, '');
});

test('Canvas keeps ownership of native collapsed-label overflow and rail positioning', () => {
  const css = fs.readFileSync(require.resolve('../canvas.css'), 'utf8');
  assert.doesNotMatch(css, /html\[data-gz-nav-size\][^{]*#header\s*\{[^}]*overflow/);
  assert.doesNotMatch(css, /html\[data-gz-nav-size\][^{]*\.ic-app-header__(main|secondary)-navigation\s*\{/);
});

test('native collapsed labels use text on accent, even on a custom rail', () => {
  const css = fs.readFileSync(require.resolve('../canvas.css'), 'utf8');
  assert.match(css, /body:not\(\.primary-nav-expanded\) #header \.ic-app-header__menu-list-link \.menu-item__text\s*\{\s*color:\s*var\(--gz-accent-ink\) !important;/);
  const C = require('../lib/color.js');
  for (const name of ['Frost', 'Paper']) {
    const colors = G.GZ_PRESET(name);
    assert.ok(C.contrast(colors['--gz-accent-ink'], colors['--gz-accent']) >= 4.5, name);
  }
});

test('CSS sidebar filters stay equal to the shared on-demand image filters', () => {
  const css = fs.readFileSync(require.resolve('../canvas.css'), 'utf8');
  for (const [key, value] of Object.entries(K.FILTERS)) if (key !== 'none') {
    const body = css.match(new RegExp(`html\\[data-gz-nav-f="${key}"\\] #header::before \\{([^}]+)\\}`))?.[1];
    assert.ok(body, key);
    assert.equal(body.match(/filter:\s*([^;]+);/)?.[1], value, key);
  }
});

test('late words start the sidebar once; ordinary mutation passes do not repeat it', () => {
  const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const chunk = source.slice(source.indexOf('  const flush = () => {'), source.indexOf('  // ---- page loads'));
  let ready = false, calls = 0;
  const ctx = { timer: 1, dirty: new Set(), full: false, wordsLate: true, document: { body: {} }, tip: null, tinted: null, looked: null, words: () => ready, outermost: () => [], tintKey: () => null, lookHere: () => null, syncNav: () => calls++ };
  for (const name of ['sweepAll','sweepRoots','tagExtras','themeEditors','paintCourses','applySettings','placeScene','renderProgress','renderNew','keepPlace','renderCalc','watchDrafts','syncDownloads','syncDocTools','syncCourseMenu','syncTodo','syncCardTasks','syncRemind','syncWidgets','syncInsights']) ctx[name] = () => {};
  const c = vm.createContext(ctx);
  vm.runInContext(chunk + '\nglobalThis.flushNow = flush;', c);
  c.flushNow(); assert.equal(calls, 0);
  ready = true;
  c.flushNow(); assert.equal(calls, 1);
  c.flushNow(); assert.equal(calls, 1);
  c.full = true;
  c.flushNow(); assert.equal(calls, 2);
});
