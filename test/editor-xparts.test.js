// The editor's builders for a Look's nav layout and page tweaks (lib/editor-xparts.js): what they write is already what
// the parts' cleaners keep, so it round-trips through GZ_XPARTS and a glaze2 code; Glaze settings can't be hidden; and
// the options page and the preview are wired to them. The page itself is checked headless (scripts/xparts-editor-check.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../defaults.js');
const Parts = require('../lib/parts.js');
const L = require('../lib/navlayout.js');
const X = require('../lib/lookparts.js');
const S = require('../lib/share.js');
const E = require('../lib/editor-xparts.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const t = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k]);

test('builder redraw never passes absent optional hints as visible null text', () => {
  const source = read('lib/editor-xparts.js');
  const section = source.slice(source.indexOf('    const redraw ='), source.indexOf('    // A live region'));
  const seen = [];
  const redraw = vm.runInNewContext(`${section}\nredraw`, { document: {}, focusTo: '', CSS: {} });
  redraw({ replaceChildren: (...kids) => seen.push(...kids) }, ['Site', null, false, 'Tweaks']);
  assert.deepEqual(seen, ['Site', 'Tweaks']);
});
// The worker and the page clean rules with the registry loaded: so do these checks.
const withRegistry = async (f) => { const was = globalThis.GZ_PARTS; globalThis.GZ_PARTS = Parts; try { return await f(); } finally { if (was === undefined) delete globalThis.GZ_PARTS; else globalThis.GZ_PARTS = was; } };
const roundTrip = (P) => withRegistry(async () => {
  assert.ok(X.same(X.bundle(P), P), 'the cleaned bundle is the bundle');
  assert.ok(X.same(await X.unpack(await X.pack(P)), P), 'packed and unpacked');
  const got = await S.decode(await S.encode(G.GZ_SANITIZE(), undefined, P));
  assert.ok(X.same(got.parts, P), 'through a glaze2 code');
});
const MODS = [{ id: 'abcdefghijklmnop', h: 'A'.repeat(43), name: 'Garden' }];

test('put replaces one part, keeps the mods, and leaves no empty parts behind', () => {
  const nav = { place: 'top' };
  assert.deepEqual(E.put(null, 'nav', nav), { x: { nav } });
  assert.deepEqual(E.put({ x: { nav }, m: MODS }, 'rules', [{ p: 'ultra.courses.term', do: 'hide' }]).m, MODS);
  assert.equal(E.put({ x: { nav } }, 'nav', null), null);
  assert.deepEqual(E.put({ x: { nav }, m: MODS }, 'nav', null), { m: MODS });
  assert.deepEqual(E.put({ x: { nav, cursor: { kind: 'glow' } } }, 'nav', null), { x: { cursor: { kind: 'glow' } } });
});

test('start from my nav copies the student’s own items, and Glaze settings stay shown', async () => {
  const mine = {
    links: [{ id: 'library00000', n: 'Library', u: 'https://library.example.edu/', i: 'book', tab: true }],
    order: ['grades', 'library00000', 'calendar'], hidden: ['tools', 'glaze'],
    widgets: [{ id: 'clock', on: true, at: 'top' }, { id: 'timer', on: true, at: 'bottom' }, { id: 'pet', on: false, at: 'top' }],
  };
  const nav = E.fromMine(mine);
  assert.deepEqual(L.clean(nav), nav, 'already clean');
  assert.equal(nav.place, 'left');
  assert.deepEqual(nav.hidden, ['tools'], 'never glaze');
  assert.deepEqual(nav.links, [{ id: 'library00000', n: 'Library', u: 'https://library.example.edu/', i: 'book' }], 'no "new tab" in a layout');
  const items = nav.groups[0].items;
  assert.deepEqual(items.slice(0, 4), ['w:clock', 'grades', 'link:library00000', 'calendar']);
  assert.equal(items.at(-1), 'w:timer');
  assert.ok(items.includes('glaze') && !items.includes('tools') && !items.includes('w:pet'));
  // Placed in the student's order on Blackboard, glaze included.
  assert.ok(L.resolve(nav, L.NATIVE).some((e) => e.key === 'glaze'));
  await roundTrip({ x: { nav } });
  // Nothing of their own yet: the site's order.
  assert.deepEqual(E.fromMine(undefined).groups[0].items, L.NATIVE.filter((id) => L.NATIVE.indexOf(id) < 11));
});

test('the nav builder keeps the layout clean through every edit, and never hides Glaze settings', async () => {
  let n = L.clean(E.FRESH);
  assert.deepEqual(n, E.FRESH);
  assert.equal(E.nav.hide(n, 'glaze'), null, 'the settings item');
  assert.equal(E.nav.hide(n, 'w:clock'), null, 'only native items hide');
  n = E.nav.item(n, 'calendar', 0);
  n = E.nav.item(n, 'grades', 0);
  n = E.nav.item(n, 'w:clock', 0, 0);
  assert.deepEqual(n.groups[0].items, ['w:clock', 'calendar', 'grades']);
  n = E.nav.item(n, 'grades', 0, 0);
  assert.deepEqual(n.groups[0].items, ['grades', 'w:clock', 'calendar'], 'moved up to the top');
  n = E.nav.hide(n, 'calendar');
  assert.deepEqual(n.hidden, ['calendar']);
  assert.ok(!n.groups[0].items.includes('calendar'), 'a hidden item leaves its group');
  assert.equal(E.nav.item(n, 'calendar', 0).groups[0].items.includes('calendar'), false, 'and can’t join one while hidden');
  n = E.nav.show(n, 'calendar');
  assert.deepEqual(n.hidden, []);
  for (let i = 0; i < 5; i++) n = E.nav.group(n);
  assert.equal(n.groups.length, E.GROUPS_MAX);
  assert.equal(E.nav.group(n), null, 'six groups at most');
  n = E.nav.label(n, 1, '  Study   tools and more and more and more  ');
  assert.equal(n.groups[1].label, 'Study tools and more and');
  assert.equal(E.nav.label(n, 1, '  ').groups[1].label, undefined, 'a blank label is no label');
  n = E.nav.item(n, 'grades', 1);
  n = E.nav.moveGroup(n, 1, 0);
  assert.deepEqual(n.groups[0], { label: 'Study tools and more and', items: ['grades'] });
  n = E.nav.ungroup(n, 0);
  assert.ok(!n.groups.some((g) => g.items.includes('grades')), 'a removed group’s items follow in the site’s order');
  n = E.nav.place(n, 'dock');
  assert.equal(n.place, 'dock');
  n = E.nav.icon(n, 'grades', 'star');
  assert.deepEqual(n.icons, { grades: 'star' });
  assert.deepEqual(E.nav.icon(n, 'grades', '').icons, {});
  for (let i = 0; i < E.LINKS_MAX; i++) n = E.nav.link(n, { id: `link0000000${i}`, n: `Link ${i}`, u: `https://example.edu/${i}`, i: 'globe' });
  assert.equal(n.links.length, 8);
  assert.equal(E.nav.link(n, { id: 'link00000009', n: 'Ninth', u: 'https://example.edu/9' }), null, 'eight links at most');
  assert.equal(E.nav.link(n, { id: 'link00000000', n: 'Edited', u: 'https://example.edu/edited', i: 'book' }).links[0].n, 'Edited', 'editing one of eight');
  assert.equal(E.nav.link(L.clean(E.FRESH), { id: 'badlink00000', n: 'Bad', u: 'javascript:alert(1)' }), null, 'the cleaner’s URL check');
  assert.equal(E.nav.link(L.clean(E.FRESH), { id: 'badlink00000', n: '  ', u: 'https://example.edu/' }), null, 'a name');
  n = E.nav.item(n, 'link:link00000003', 0);
  n = E.nav.icon(n, 'link:link00000003', 'video');
  assert.equal(n.links[3].i, 'video', 'a link’s icon is its own');
  n = E.nav.unlink(n, 'link00000003');
  assert.ok(!n.groups[0].items.includes('link:link00000003') && n.links.length === 7);
  assert.deepEqual(L.clean(n), n);
  await roundTrip({ x: { nav: n }, m: MODS });
});

test('page tweaks are cleaned by the registry as they are added, 64 at most, and read in plain words', async () => {
  let list = [];
  list = E.rules.add(list, { p: 'ultra.course-card.status', do: 'hide' });
  list = E.rules.add(list, { p: 'canvas.dashboard-card.title', do: 'move', to: 'canvas.dashboard-card.subtitle', at: 'after' });
  list = E.rules.add(list, { p: 'canvas.dashboard-card', do: 'style', st: { bg: 'accent', r: 8, p: 3, sh: 2, o: 90, f: 'inter', bc: '#AABBCC' } });
  list = E.rules.add(list, { p: 'moodle.course-card.title', do: 'label', t: '  My   course  ' });
  list = E.rules.add(list, { p: 'ultra.course-card.status', do: 'show' });
  assert.equal(list.length, 5);
  assert.equal(list[2].st.bc, '#aabbcc');
  assert.equal(list[3].t, 'My course');
  assert.equal(E.rules.add(list, { p: 'ultra.nav', do: 'hide' }), null, 'the rail that holds Glaze settings can’t hide');
  assert.equal(E.rules.add(list, { p: 'ultra.course-card.title', do: 'style', st: { bw: 2 } }), null, 'only the part’s own style keys');
  assert.equal(E.rules.add(list, { p: 'canvas.dashboard-card.title', do: 'move', to: 'ultra.course-card.id', at: 'after' }), null, 'only beside a part in the same container');
  assert.equal(E.rules.add(list, { p: 'ultra.no-such-part', do: 'hide' }), null);
  assert.deepEqual(list.map((r) => E.describe(r, t)), [
    'Hide: Blackboard · Course card status',
    'Move: Canvas · Course card title, after Course card code',
    'Restyle: Canvas · Course card (Background Accent, Corner radius 8 px, Padding 8 px, Shadow Medium, Opacity 90%, Font Inter, Border colour #aabbcc)',
    'Rename: Moodle · Course card title to “My course”',
    'Show: Blackboard · Course card status',
  ]);
  assert.deepEqual(E.rules.move(list, 4, 0).map((r) => r.do), ['show', 'hide', 'move', 'style', 'label']);
  assert.deepEqual(E.rules.remove(list, 0).map((r) => r.do), ['move', 'style', 'label', 'show']);
  await roundTrip({ x: { rules: list } });
  let full = [];
  for (let i = 0; i < Parts.MAX; i++) full = E.rules.add(full, { p: 'ultra.courses.term', do: i % 2 ? 'show' : 'hide' });
  assert.equal(full.length, 64);
  assert.equal(E.rules.add(full, { p: 'ultra.courses.term', do: 'hide' }), null, '64 at most');
  await roundTrip({ x: { rules: full, nav: E.fromMine({}) } });
});

test('every part of each site is in one labelled group, and the builder offers only what a part takes', () => {
  for (const site of ['ultra', 'canvas', 'moodle']) {
    const groups = E.parts(site, (s) => `~${s}`);
    const names = groups.flatMap(([, l]) => l.map((p) => p.name));
    assert.deepEqual(names.sort(), Parts.list(site).map((p) => p.name).sort(), site);
    assert.ok(groups.every(([, l]) => l.every((p) => p.label.startsWith('~'))), 'labels through t()');
    assert.ok(groups.length >= 3, `${site} has groups`);
  }
  assert.equal(E.groupOf('ultra.course-card.title'), 'Cards');
  assert.equal(E.groupOf('canvas.global-nav.inbox'), 'Navigation');
  assert.equal(E.groupOf('moodle.page-header.title'), 'Headers');
  assert.equal(E.groupOf('canvas.sidebar.todo'), 'Sidebar and blocks');
  assert.equal(E.groupOf('moodle.footer'), 'Other parts');
  assert.deepEqual(E.can('ultra.nav'), { hide: false, show: false, move: false, style: true, label: false });
  assert.deepEqual(E.can('canvas.course-nav.grades'), { hide: true, show: true, move: true, style: true, label: true });
  assert.ok(E.beside('canvas.course-nav.grades', t).every((p) => p.name.startsWith('canvas.course-nav.') && p.name !== 'canvas.course-nav.grades'));
  assert.deepEqual(E.beside('canvas.footer', t), []);
  // Each style key's choices are values the registry keeps.
  for (const k of Parts.BOX) for (const [v] of E.choices(k, t)) assert.ok(Parts.clean({ p: 'canvas.dashboard-card', do: 'style', st: { [k]: v } }), `${k}: ${v}`);
});

test('the options page loads the builders in their own sections and redraws them with the rest', () => {
  const html = read('options.html'), js = read('options.js');
  for (const [route, id] of [['look/nav-layout', 'xnav'], ['look/rules', 'xrules']]) {
    const section = html.match(new RegExp(`<section[^>]*data-editor-section="${route}"[^>]*>([\\s\\S]*?)</section>`));
    assert.ok(section, route);
    assert.match(section[1], new RegExp(`<div id="${id}"></div>`));
  }
  assert.match(html, /<script src="lib\/parts\.js"><\/script>[\s\S]*<script src="lib\/editor-xparts\.js"><\/script>[\s\S]*<script src="options\.js"><\/script>/);
  assert.match(js, /GZ_XEDIT\.mount\(\{ s, t, save, refresh, frame, navItems: \(\) => navItems, preview: /);
  assert.match(js.slice(js.indexOf('  const refresh = () => {'), js.indexOf('  const fill = () => {')), /GZ_XEDIT\.render\(\);/);
  // Its strings are written by the module through t(), so the page holds no untranslated words of its own: only the path and
  // the Reset every section has, which the page's own translation (GZ_I18N.page) takes, and the headings are the module's.
  const own = html.slice(html.indexOf('<section id="look-nav-layout"'), html.indexOf('<section id="motion"'));
  const bare = own.replace(/<p class="site-scope" translate="no">[^<]*<\/p>/g, '').replace(/<p class="section-path"[^>]*><a [^>]*>[^<]*<\/a><\/p>/g, '').replace(/<button type="button" class="section-reset"[^>]*>Reset section<\/button>/g, '');
  assert.deepEqual([...bare.matchAll(/>([^<]*\p{L}[^<]*)</gu)], []);
});

test('the preview draws page tweaks: Ultra through its real runtime, Canvas and Moodle through the rules code on their mock', async () => {
  const source = read('lib/editor-preview.js');
  const ultra = source.split("if (site === 'ultra') {")[1].split('} else {')[0];
  assert.match(ultra, /'lib\/lookx\.js', 'features\/rules\.js'/);
  const other = source.split("document.getElementById('preview-menu').remove();")[1];
  assert.match(other, /for \(const file of \['lib\/lookx\.js', 'features\/rules\.js', 'features\/motionx\.js'\]\) await load\(file\);/);
  assert.ok(other.indexOf('globalThis.GZ_CTX ||=') < other.indexOf("'features/rules.js'"), 'rules.js reads GZ_CTX as it loads');
  assert.match(other, /globalThis\.GZ_RULES\?\.sync\(\);/);
  const getter = source.match(/globalThis\.GZ_CTX \|\|= Object\.freeze\(\{[\s\S]*?\}\);/)[0], loaded = [];
  const context = vm.createContext({ site: 'moodle', settings: { enabled: true }, context: { page: 'courses' }, GZ_XPARTS_PAGE: { now: () => null }, Promise, Error, CustomEvent: class {}, document: {}, load: async (file) => { loaded.push(file); } });
  vm.runInContext(getter, context);
  assert.equal(context.GZ_CTX.site, 'moodle');
  assert.equal(context.GZ_CTX.on(), true);
  context.settings.enabled = false;
  assert.equal(context.GZ_CTX.on(), false);
  // The preview loads what a page script asks for, as the page would.
  await context.GZ_CTX.need('lib/parts.js', () => true);
  await context.GZ_CTX.need('lib/parts.js', () => false);
  assert.deepEqual(loaded, ['lib/parts.js']);
});

test('editing an imported link icon replaces its effective override', async () => {
  const link = { id: 'library00000', n: 'Library', u: 'https://example.edu/', i: 'book' };
  const n = L.clean({ links: [link], icons: { 'link:library00000': 'star', grades: 'doc' } });
  assert.equal(L.rail(n).links[0].i, 'star');
  const changed = E.nav.icon(n, 'link:library00000', 'video');
  assert.equal(L.rail(changed).links[0].i, 'video');
  assert.equal(changed.icons.grades, 'doc');
  const edited = E.nav.link(n, { ...link, n: 'New name', i: 'globe' });
  assert.equal(L.rail(edited).links[0].i, 'globe');
  await roundTrip({ x: { nav: edited } });
});

test('the headless editor check fails when a saved-state predicate never becomes true', async () => {
  const script = read('scripts/xparts-editor-check.js');
  const helper = script.slice(script.indexOf('const until ='), script.indexOf('\n\n(async () =>'));
  const until = vm.runInNewContext(`${helper}\nuntil`, { setTimeout });
  await assert.rejects(until(async () => ({ stale: true }), (v) => v.saved === true, 1), /Timed out/);
});
