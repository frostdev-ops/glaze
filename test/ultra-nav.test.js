const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const G = require('../defaults.js');
const N = require('../lib/nav-items.js');
const K = require('../lib/cards.js');
const Store = require('../lib/nav-store.js');

const memory = (start = {}, fail = false) => {
  const values = structuredClone(start);
  return { values, get: async (keys) => keys === null ? structuredClone(values) : Object.fromEntries(keys.filter((k) => k in values).map((k) => [k, structuredClone(values[k])])), set: async (patch) => { if (fail) return false; Object.assign(values, structuredClone(patch)); return true; }, remove: async (keys) => { for (const k of keys) delete values[k]; return true; } };
};

test('Ultra nav links reject executable URLs, credentials, unknown icons and unbounded input', () => {
  for (const u of ['javascript:alert(1)', 'data:text/html,hi', '//example.com', 'ftp://example.com', 'https://user:pass@example.com']) assert.equal(N.link({ id: 'aaaaaaaaaaaa', n: 'Name', u }), null, u);
  assert.equal(N.link({ id: 123456789012, n: 'Name', u: 'https://example.com' }), null);
  assert.equal(N.link({ id: 'organization', n: 'Name', u: 'https://example.com' }), null);
  const link = N.link({ id: 'aaaaaaaaaaaa', n: '  My   link  ', u: 'http://example.com/a"b', i: '__proto__', tab: true });
  assert.equal(link.n, 'My link'); assert.equal(link.u, 'http://example.com/a%22b'); assert.equal(link.i, 'link'); assert.equal(link.tab, true);
  const config = N.clean({ links: Array.from({ length: 100 }, (_, i) => ({ id: String(i).padStart(12, '0'), n: 'é'.repeat(500), u: `https://example.com/${'x'.repeat(450)}` })), hidden: ['course', 'logout', '__proto__'], order: ['course', 'course', 'unknown'], widgets: [{ id: 'timer', on: true, at: 'top' }, { id: 'timer', on: false }] });
  assert.ok(K.bytes('navItems', config) <= K.ITEM_MAX);
  assert.ok(config.links.length <= 8);
  assert.deepEqual(config.hidden, ['course', 'logout']);
  assert.equal(config.order.filter((id) => id === 'course').length, 1);
  assert.equal(config.widgets.filter((w) => w.id === 'timer').length, 1);
  assert.deepEqual(N.clean(config), config);
});

test('Ultra nav sizes and brand sanitize once, preserving Canvas nav defaults', () => {
  const n = G.GZ_SANITIZE({ nav: { width: 159, icon: 100, text: -1, height: 900, gap: 99, padding: 100, brand: 'script', li: '../../secret', labels: 'icons', collapsed: true } }).nav;
  for (const [key, [def]] of Object.entries(N.SPEC)) assert.equal(n[key], def, key);
  assert.equal(n.labels, 'icons'); assert.equal(n.collapsed, true);
  assert.equal(G.GZ_DEFAULTS.nav.logo, true); assert.equal(G.GZ_DEFAULTS.nav.size, 'medium');
  assert.equal(N.native('/ultra/institution-page'), 'institution-page'); assert.equal(N.native('/ultra/course'), 'course'); assert.equal(N.native('#'), 'logout'); assert.equal(N.native('/courses/1'), '');
  const c = N.clean({ hidden: ['course'], order: ['grades', 'course'], links: [{ id: 'aaaaaaaaaaaa', n: 'Docs', u: 'https://example.com', i: 'book' }] });
  assert.deepEqual(N.sequence(['profile', 'course', 'grades', 'calendar'], c), ['grades', 'course', 'profile', 'calendar', 'aaaaaaaaaaaa']);
  assert.deepEqual(N.clean().hidden, []); assert.deepEqual(N.clean().order, []);
});

test('custom logos share image caps and keep the previous image when sync fails', async () => {
  const old = 'aaaaaaaaaaaa', data = 'data:image/png;base64,AAAA';
  const area = { sync: memory({ nav: G.GZ_SANITIZE({ nav: { brand: 'custom', li: old } }).nav }), local: memory({ [`navLogo:${old}`]: data, 'cardImg:bbbbbbbbbbbb': data }) };
  const saved = await Store.change({ nav: {}, logoImage: data }, area);
  assert.equal(saved.ok, true); assert.match(saved.id, /^[a-z0-9]{12}$/);
  assert.equal(area.sync.values.nav.brand, 'custom'); assert.equal(area.sync.values.nav.li, saved.id);
  assert.equal(area.local.values[`navLogo:${old}`], undefined); assert.equal(area.local.values['cardImg:bbbbbbbbbbbb'], data);
  const broken = { sync: memory({ nav: area.sync.values.nav }, true), local: memory({ [`navLogo:${saved.id}`]: data }) };
  const failed = await Store.change({ nav: {}, logoImage: data }, broken);
  assert.equal(failed.ok, false); assert.deepEqual(Object.keys(broken.local.values), [`navLogo:${saved.id}`]);
  assert.equal((await Store.change({ nav: {}, logoImage: data }, { sync: memory(), local: memory({ 'ultraCardImg:cccccccccccc': 'x'.repeat(K.IMG_TOTAL) }) })).error, 'cap');
  await Store.change({ nav: { li: '', brand: 'glaze' } }, area);
  assert.equal(area.local.values[`navLogo:${saved.id}`], undefined);
});

test('first paint covers MUI and legacy nav, owns the logo image without replacing its link', () => {
  const css = fs.readFileSync(require.resolve('../theme.css'), 'utf8');
  assert.match(css, /makeStylesnavigation/); assert.match(css, /nav#base_tools/);
  // The Glaze logos are inlined: a page can't load them by the extension's fixed address (use_dynamic_url), and a
  // file it could load would tell a site Glaze is installed.
  const logos = css.match(/url\("data:image\/svg\+xml,[^"]+"\)/g) || [];
  assert.ok(logos.length >= 3, 'the logo, its dark version and the mark are inlined');
  assert.doesNotMatch(css, /url\("(?:assets|icons)\/[^"]+\.svg"\)/, 'no logo by the extension address');
  assert.match(css, /data-gz-nav-brand/);
  const manifest = require('../manifest.json');
  const ultra = manifest.content_scripts.find((c) => c.matches.includes('https://*/ultra')).js;
  const canvas = manifest.content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*')).js;
  assert.ok(ultra.includes('lib/nav.js')); assert.ok(!canvas.includes('lib/nav.js'));
});


test('timer actions apply to fresh shared widgetTimer state in the existing queue and fail closed', async () => {
  const area = { sync: memory({ widgets: { work: 25, rest: 5 } }), local: memory() };
  const serial = K.queue();
  const results = await Promise.all([serial(() => Store.timer('toggle', area, 1000)), serial(() => Store.timer('toggle', area, 2000))]);
  assert.equal(results[0].timer.end, 1501000); assert.equal(results[1].timer.end, 0); assert.equal(results[1].timer.left, 1499000);
  assert.equal((await Store.timer('garbage', area)).error, 'bad');
  assert.equal((await Store.timer('reset', { ...area, local: memory({ widgetTimer: { phase: 'work', end: 9000, left: 0 } }, true) }, 3000)).error, 'write');
});

test('logo cleanup failure leaves the committed logo and reports an orphan for the next retry', async () => {
  const data = 'data:image/png;base64,AAAA', local = memory({ 'navLogo:aaaaaaaaaaaa': data });
  local.remove = async () => false;
  const area = { sync: memory({ nav: G.GZ_SANITIZE({ nav: { li: 'aaaaaaaaaaaa' } }).nav }), local };
  const r = await Store.change({ nav: {}, logoImage: data }, area);
  assert.equal(r.ok, true); assert.equal(r.cleanup, false);
  assert.equal(local.values[`navLogo:${r.id}`], data); assert.equal(local.values['navLogo:aaaaaaaaaaaa'], data);
});

test('Look codes exclude Ultra personal navigation fields while backups explicitly include the capped items', async () => {
  const S = require('../lib/share.js');
  const settings = G.GZ_SANITIZE({ nav: { k: 'solid', c: '#112233', brand: 'custom', li: 'aaaaaaaaaaaa', width: 300 } });
  const shared = await S.decode(await S.encode(settings));
  assert.ok(!('brand' in shared.nav)); assert.ok(!('li' in shared.nav)); assert.ok(!('width' in shared.nav));
  const src = fs.readFileSync(require.resolve('../options.js'), 'utf8');
  assert.match(src, /navItems: N.clean\(r\?\.navItems\)/);
  assert.match(src, /next.nav.li = ''/);
});

test('worker timer/nav message allow rules reject unknown actions, untrusted senders and image uploads from Canvas', async () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  let enabled = true;
  // ultraPage: the top frame, or a course tab's frame on the same Ultra site as its tab (lib/background.js).
  const ctx = vm.createContext({ fromEditor: (s) => s.editor === true, fromCanvas: async (s) => s.canvas === true, fromUltra: async (s) => s.ultra === true, ultraPage: (s) => s.frameId === 0 || s.sameSite === true, chrome: { storage: { sync: { get: async () => ({ enabled }) } } } });
  const h = (name) => vm.runInContext(`({${source.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))[1]}})`, ctx);
  const timer = h('widgetTimer'), nav = h('nav');
  assert.equal(await timer.allow({ op: 'toggle' }, { ultra: true, frameId: 0 }), true);
  assert.equal(await timer.allow({ op: 'reset' }, { canvas: true, frameId: 0 }), true);
  for (const sender of [{}, { ultra: true, frameId: 1 }, { canvas: true, frameId: 1, sameSite: true }]) assert.equal(await timer.allow({ op: 'toggle' }, sender), false);
  assert.equal(await timer.allow({ op: 'toggle' }, { ultra: true, frameId: 1, sameSite: true }), true, 'a course tab\'s frame is its page');
  assert.equal(await timer.allow({ op: 'snapshot', timer: {} }, { editor: true }), false);
  enabled = false; assert.equal(await timer.allow({ op: 'toggle' }, { ultra: true, frameId: 0 }), false);
  assert.equal(await nav.allow({ nav: {}, items: {} }, { editor: true }), true);
  assert.equal(await nav.allow({ nav: {}, items: {} }, { canvas: true }), false);
  assert.equal(await nav.allow({ nav: {}, logoImage: 'data:image/png;base64,AAAA' }, { canvas: true }), false);
  assert.equal(await nav.allow({ nav: { collapsed: false } }, { canvas: true }), true);
});

test('presets and precise Ultra sizes stay separate from Canvas preferences', () => {
  const n = G.GZ_SANITIZE({ nav: { size: 'small', width: 310, text: 18 } }).nav;
  assert.equal(N.dimensions(n).width, 176);
  assert.equal(N.dimensions({ ...n, detailed: true }).width, 310);
  assert.equal(N.dimensions({ ...n, detailed: true }).text, 18);
  assert.equal(n.size, 'small');
});


test('the Ultra first-paint helper is idempotent and native MUI colors stay scoped to the rail', () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ GZ_SPEC: { nav: {} }, GZ_DEFAULTS: { nav: {} } });
  const source = fs.readFileSync(require.resolve('../lib/nav.js'), 'utf8');
  const first = vm.runInContext(source, ctx); assert.equal(vm.runInContext(source, ctx), first);
  const css = fs.readFileSync(require.resolve('../theme.css'), 'utf8');
  assert.match(css, /nav\[class\*="makeStylesnavigation"\] a\.MuiListItemButton-root \{ color: var\(--gz-ink-muted\) !important/);
  assert.match(css, /gz-nav-pet-level \{ display: inline/);
});

test('Canvas picture writes count protected nav logos without collecting them as card orphans', async () => {
  const data = 'data:image/png;base64,AAAA';
  const area = { sync: memory(), local: memory({ 'navLogo:aaaaaaaaaaaa': 'x'.repeat(K.IMG_TOTAL) }) };
  assert.equal((await K.change({ key: 'canvas:https://school.test/1', style: { k: 'image' }, image: data }, area)).error, 'cap');
  await K.change({ key: 'canvas:https://school.test/1', style: null }, area);
  assert.equal(area.local.values['navLogo:aaaaaaaaaaaa'].length, K.IMG_TOTAL);
});

test('the wrong-LMS-host fallback injects the nav schema before Ultra once with the same target', async () => {
  const vm = require('node:vm'), source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  const start = source.indexOf('const SAFARI = new URL'), end = source.indexOf('// Canvas page reads', start);
  let listener, scripts = [];
  const ctx = vm.createContext({ URL, chrome: { runtime: { id: 'glaze', getURL: () => 'chrome-extension://glaze/', onMessage: { addListener: (f) => { listener ||= f; } } }, scripting: { executeScript: async (v) => { scripts.push(v); return [{ result: {} }]; } } } });
  // Stop after the load handler; the neighboring reader handler belongs to a separate feature.
  const loadEnd = source.indexOf('return true; // the reply comes once the files have run', start);
  vm.runInContext(source.slice(start, source.indexOf('\n});', loadEnd) + 4), ctx);
  const request = (files, sender = { id: 'glaze', tab: { id: 8 }, frameId: 0, documentId: 'doc-1' }) => new Promise((r) => listener({ type: 'glaze:load', files }, sender, r));
  assert.equal((await request(['content-ultra.js', 'lib/nav.js', 'content-ultra.js'])).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(scripts[0].files)), ['lib/nav.js', 'content-ultra.js']);
  assert.deepEqual(JSON.parse(JSON.stringify(scripts[0].target)), { tabId: 8, documentIds: ['doc-1'] });
  assert.equal((await request(['features/nav.js', 'lib/nav-items.js'])).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(scripts[1].files)), ['lib/nav.js', 'lib/nav-items.js', 'features/nav.js']);
  assert.deepEqual(JSON.parse(JSON.stringify(scripts[1].target)), { tabId: 8, documentIds: ['doc-1'] });
  const before = scripts.length;
  assert.equal((await request(['../../secret'])).ok, false); assert.equal(scripts.length, before);
  assert.equal((await request(['content-ultra.js'], { id: 'other', tab: { id: 8 }, frameId: 0 })).ok, false);
});

test('static preview arrival starts nav despite an earlier cached rejected injection', async () => {
  const vm = require('node:vm'), source = fs.readFileSync(require.resolve('../content-ultra.js'), 'utf8');
  const a = source.indexOf('  const syncNav = () =>'), b = source.indexOf('\n  chrome.storage.onChanged', a);
  let starts = 0, asks = 0;
  const failed = Promise.reject(new Error('not in the preview')); failed.catch(() => {});
  const ctx = vm.createContext({ isPreview: true, I: { links: [1], worn: { nav: {} } }, navItems: { links: [1], order: [], hidden: [], widgets: [] }, syncDashboard() {}, glazeItem() {}, need: (file) => { if (file === 'features/nav.js') asks++; return failed; }, location: { pathname: '/preview.html' }, window: {} });
  const sync = vm.runInContext(source.slice(a, b) + '\nsyncNav;', ctx);
  sync(); await new Promise(setImmediate);
  ctx.GZ_NAV_UI = { sync: () => starts++ };
  sync(); assert.equal(starts, 1); assert.equal(asks, 1, 'present nav skips its stale rejected injection promise');
});

test('the nav logo goes home in this tab: the Dashboard when it is on, else Courses', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'content-ultra.js'), 'utf8');
  const block = src.slice(src.indexOf("  // The nav's logo goes home"), src.indexOf('  let navRead = false'));
  const run = (dashboard, ev = {}, found = true) => {
    let handler; const clicked = [], assigned = [];
    const link = (id) => ({ click: () => clicked.push(id) });
    const document = {
      addEventListener: (type, fn) => { if (type === 'click') handler = fn; },
      querySelector: (sel) => (found ? link(sel.match(/ultra\/([\w-]+)/)[1]) : null),
    };
    const I = { links: [1], settings: { enabled: true, enhance: { dashboard } } };
    require('node:vm').runInNewContext(block, { document, I, location: { assign: (u) => assigned.push(u) } });
    const e = { button: 0, target: { closest: () => ({}) }, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...ev };
    handler(e);
    return { clicked, assigned, prevented: !!e.prevented };
  };
  assert.deepEqual(run(true), { clicked: ['institution-page'], assigned: [], prevented: true });
  assert.deepEqual(run(false), { clicked: ['course'], assigned: [], prevented: true });
  assert.deepEqual(run(false, {}, false), { clicked: [], assigned: ['/ultra/course'], prevented: true });
  assert.deepEqual(run(true, { metaKey: true }), { clicked: [], assigned: [], prevented: false }, 'a modified click is the browser\'s');
  assert.deepEqual(run(true, { target: { closest: () => null } }), { clicked: [], assigned: [], prevented: false }, 'only the logo');
});

test('Glaze settings: last in the nav, a copy of its last item, hidden and moved like Ultra\'s own; gone when Glaze is off', () => {
  const N = require('../lib/nav.js');
  assert.equal(N.native('#glaze'), 'glaze');
  assert.equal(N.NATIVE.at(-1), 'glaze', 'last by default');
  const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'content-ultra.js'), 'utf8');
  const block = src.slice(src.indexOf("  // Glaze settings, last in Ultra's nav"), src.indexOf('  const queueNav = '));
  // A small DOM: a nav with two items in li, the last Ultra's Sign out (#).
  const mk = (tag) => { const e = { tagName: tag.toUpperCase(), children: [], attrs: {}, classList: null, parentElement: null, listeners: {} };
    e.classList = { set: new Set(), add: (c) => e.classList.set.add(c), remove: (...cs) => cs.forEach((c) => e.classList.set.delete(c)), contains: (c) => e.classList.set.has(c) };
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); }; e.getAttribute = (k) => e.attrs[k] ?? null; e.removeAttribute = (k) => { delete e.attrs[k]; };
    e.append = (...k) => k.forEach((x) => { if (typeof x === 'object') { x.parentElement = e; e.children.push(x); } else e.text = x; });
    e.after = (x) => { const p = e.parentElement; x.parentElement = p; p.children.splice(p.children.indexOf(e) + 1, 0, x); };
    e.remove = () => { const p = e.parentElement; if (p) p.children.splice(p.children.indexOf(e), 1); e.parentElement = null; };
    e.addEventListener = (t, f) => { e.listeners[t] = f; };
    e.replaceWith = (x) => { const p = e.parentElement; x.parentElement = p; p.children[p.children.indexOf(e)] = x; };
    e.querySelector = (sel) => { const all = []; const walk = (n) => n.children.forEach((k) => { all.push(k); walk(k); }); walk(e); return all.find((k) => (sel === 'a[href="#glaze"]' ? k.attrs.href === '#glaze' : sel === 'svg' ? k.tagName === 'SVG' : k.tagName === 'SPAN' && k.className !== 'gz-nav-glaze-icon')) || null; };
    e.querySelectorAll = () => { const all = []; const walk = (n) => n.children.forEach((k) => { all.push(k); walk(k); }); walk(e); return all.filter((k) => k.tagName === 'A'); };
    e.cloneNode = (deep) => { const c = mk(tag); c.attrs = { ...e.attrs }; e.classList.set.forEach((x) => c.classList.add(x)); if (deep) e.children.forEach((k) => c.append(k.cloneNode(true))); return c; };
    Object.defineProperty(e, 'href', { set: (v) => { e.attrs.href = v; }, get: () => e.attrs.href });
    return e; };
  const root = mk('nav'); root.isConnected = true;
  const item = (href, label) => { const li = mk('li'), a = mk('a'), svg = mk('svg'), span = mk('span'); a.attrs.href = href; a.classList.add('MuiListItemButton-root'); span.text = label; a.append(svg, span); li.append(a); root.append(li); return a; };
  item('/ultra/course', 'Courses'); item('#', 'Sign out');
  const sent = [];
  const ctx = { navRoots: new Set([root]), GZ_NAV: N, t: (k) => k, chrome: { runtime: { sendMessage: (m) => sent.push(m) } },
    document: { createElement: (t) => mk(t), createTreeWalker: (n) => ({ nextNode: () => (n.text !== undefined ? { set data(v) { n.text = v; }, get data() { return n.text; } } : null) }) }, NodeFilter: { SHOW_TEXT: 4 } };
  const glazeItem = require('node:vm').runInNewContext(block + '\nglazeItem;', ctx);
  glazeItem(true);
  const lis = root.children, g = lis.at(-1).children[0];
  assert.equal(lis.length, 3, 'one more item');
  assert.ok(lis.at(-1).classList.contains('gz-nav-glaze'), 'last, in its own li');
  assert.equal(g.attrs.href, '#glaze');
  assert.equal(g.attrs['aria-label'], 'Glaze settings');
  assert.ok(g.classList.contains('MuiListItemButton-root'), 'Ultra\'s classes: every nav setting styles it');
  assert.equal(g.children[0].className, 'gz-nav-glaze-icon', 'the drop for its icon');
  assert.equal(g.children[1].text, 'Glaze settings');
  let stopped = 0;
  g.listeners.click({ preventDefault() {}, stopPropagation() { stopped++; } });
  assert.deepEqual(sent, ['options'], 'opens the editor');
  glazeItem(true);
  assert.equal(root.children.length, 3, 'once, however often the pass runs');
  glazeItem(false);
  assert.equal(root.children.length, 2, 'Glaze off: gone');
});
