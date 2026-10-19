// Glaze's own navigation bar: the model (lib/navbar.js), its settings, the worker's pin write and the page hooks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const G = require('../defaults.js');
const L = require('../lib/navlayout.js');
const NI = require('../lib/nav-items.js');
const M = require('../lib/navbar.js');

const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const ULTRA = ['profile', 'institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools', 'logout', 'glaze']
  .map((id) => ({ id, label: id === 'profile' ? 'Alex Example' : id[0].toUpperCase() + id.slice(1), href: `https://school.test/ultra/${id}`, active: id === 'course', badge: id === 'messages' ? '3' : '' }));
const ids = (list) => list.map((i) => i.id);

test('the default bar: the places, a divider, the rest; the account and signing out at the foot; Glaze settings opt-in', () => {
  const m = M.build({ native: ULTRA });
  assert.deepEqual(m.groups.map((g) => [g.id, ids(g.items)]), [['main', ['institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades']], ['more', ['tools']]]);
  assert.equal(m.account.id, 'profile'); assert.equal(m.account.label, 'Alex Example'); assert.equal(m.signout.id, 'logout');
  assert.ok(!m.items.some((i) => i.id === 'glaze'), "Ultra's own Glaze settings item isn't the bar's");
  assert.equal(m.items.find((i) => i.id === 'messages').badge, '3');
  assert.equal(m.items.find((i) => i.id === 'messages').icon, 'inbox');
  assert.deepEqual(ids(m.tabs), ['institution-page', 'course', 'calendar', 'messages']);
  assert.deepEqual(m.sheet.map((g) => ids(g.items)), [['stream', 'organization', 'grades'], ['tools']]);
  assert.deepEqual(m.slots, { top: [], bottom: [] });
});

test('a site missing a tab fills mobile from what comes first; badges are short', () => {
  const m = M.build({ native: [{ id: 'dashboard', label: 'Dashboard' }, { id: 'calendar', label: 'Calendar' }, { id: 'grades', label: 'Grades', badge: 120 }, { id: 'help', label: 'Help' }] });
  assert.deepEqual(ids(m.tabs), ['dashboard', 'calendar', 'grades', 'help']);
  assert.equal(m.items.find((i) => i.id === 'grades').badge, '99+');
  assert.deepEqual(m.sheet, []);
});

test("a worn Look's layout orders, groups, hides and icons the bar; the student's own choices win where they set one", () => {
  const look = L.clean({ groups: [{ label: 'Study', items: ['calendar', 'course', 'w:clock'] }], hidden: ['stream', 'tools'], icons: { calendar: 'star' }, links: [{ id: 'library0000a', n: 'Library', u: 'https://library.test/', i: 'book' }] });
  let m = M.build({ native: ULTRA, look });
  assert.deepEqual(m.groups.map((g) => [g.label, ids(g.items)]), [['Study', ['calendar', 'course', 'institution-page', 'organization', 'messages', 'grades', 'link:library0000a']]]);
  assert.equal(m.items.find((i) => i.id === 'calendar').icon, 'star');
  assert.equal(m.items.find((i) => i.id === 'stream').hidden, true);
  const prefs = M.clean({ items: { stream: { hidden: false, label: 'Feed', icon: 'chat' }, calendar: { icon: 'calendar' } } });
  m = M.build({ native: ULTRA, look, prefs });
  const stream = m.items.find((i) => i.id === 'stream');
  assert.deepEqual([stream.hidden, stream.label, stream.icon], [false, 'Feed', 'chat']);
  assert.equal(m.items.find((i) => i.id === 'calendar').icon, 'calendar');
  assert.ok(ids(m.groups[0].items).includes('stream'));
});

test("the student's older rail items (navItems) still hide, order and add links while no layout groups the bar", () => {
  const legacy = NI.clean({ hidden: ['organization'], order: ['grades', 'course'], links: [{ id: 'aaaaaaaaaaaa', n: 'Wiki', u: 'https://wiki.test/', i: 'globe', tab: true }] });
  const m = M.build({ native: ULTRA, legacy });
  assert.deepEqual(ids(m.groups[0].items), ['grades', 'course', 'institution-page', 'stream', 'calendar', 'messages']);
  assert.deepEqual(ids(m.groups[1].items), ['tools', 'link:aaaaaaaaaaaa']);
  const wiki = m.items.find((i) => i.id === 'link:aaaaaaaaaaaa');
  assert.deepEqual([wiki.href, wiki.tab, wiki.icon], ['https://wiki.test/', true, 'globe']);
});

test("the student's own groups, tabs and Glaze items", () => {
  const prefs = M.clean({ groups: [{ label: 'Daily', items: ['messages', 'glaze:notes', 'calendar'] }, { items: ['grades', 'profile'] }], tabs: ['grades', 'messages', 'logout'], glaze: ['notes', 'search', 'bogus'] });
  assert.deepEqual(prefs.groups, [{ label: 'Daily', items: ['messages', 'glaze:notes', 'calendar'] }, { items: ['grades'] }], 'the foot is not placeable');
  assert.deepEqual(prefs.tabs, ['grades', 'messages']);
  assert.deepEqual(prefs.glaze, ['notes', 'search']);
  const m = M.build({ native: ULTRA, prefs, names: { notes: 'Notizen' } });
  assert.deepEqual(m.groups.map((g) => ids(g.items)), [['messages', 'glaze:notes', 'calendar', 'institution-page', 'stream', 'course', 'organization', 'tools'], ['grades', 'glaze:search']]);
  const notes = m.items.find((i) => i.id === 'glaze:notes');
  assert.deepEqual([notes.label, notes.action, notes.href], ['Notizen', 'notes', undefined]);
  assert.equal(m.items.find((i) => i.id === 'glaze:search').label, 'Search');
  assert.deepEqual(ids(m.tabs).slice(0, 2), ['grades', 'messages']);
  assert.equal(M.build({ native: ULTRA }).items.some((i) => i.id.startsWith('glaze:')), false, 'none by default');
});

test("navbarItems cleaning drops what doesn't fit and is idempotent", () => {
  const raw = {
    items: { course: { label: `  ${'x'.repeat(80)}‮ `, icon: 'nope', hidden: 'yes' }, 'link:bad': { hidden: true }, __proto__: { hidden: true }, 'mod:countdown.next': { hidden: true }, calendar: { icon: 'star', hidden: true } },
    groups: [...Array(12)].map((_, i) => ({ label: 'g'.repeat(40), items: ['course', 'calendar', 'nonsense', i] })),
    tabs: 'course', glaze: 'notes', links: [{ id: 'aaaaaaaaaaaa', n: 'A', u: 'javascript:alert(1)' }, { id: 'bbbbbbbbbbbb', n: 'B', u: 'https://b.test/' }],
  };
  const c = M.clean(raw);
  assert.equal(c.items.course.label.length, 40); assert.ok(!('icon' in c.items.course) && !('hidden' in c.items.course));
  assert.deepEqual(c.items.calendar, { icon: 'star', hidden: true });
  assert.deepEqual(c.items['mod:countdown.next'], { hidden: true });
  assert.ok(!('link:bad' in c.items));
  assert.equal(c.groups.length, 8); assert.deepEqual(c.groups[0].items, ['course', 'calendar']); assert.deepEqual(c.groups[1].items, []);
  assert.equal(c.groups[0].label.length, 24);
  assert.deepEqual([c.tabs, c.glaze, ids(c.links)], [[], [], ['bbbbbbbbbbbb']]);
  assert.deepEqual(M.clean(c), c);
  assert.deepEqual(M.clean(null), M.clean());
});

test("mods' items go to their slot or the group they name, else the last group", () => {
  const mods = [{ owner: 'a', id: 'mod:a.top', label: 'Top', slot: 'top' }, { owner: 'a', id: 'mod:a.main', label: 'Main', group: 'main', icon: 'star', badge: 2 }, { owner: 'a', id: 'mod:a.any', label: 'Any', icon: 'bogus' }, { owner: 'b', id: 'nope', label: 'Bad id' }];
  const m = M.build({ native: ULTRA, mods });
  assert.deepEqual(ids(m.slots.top), ['mod:a.top']);
  assert.equal(m.groups[0].items.at(-1).id, 'mod:a.main');
  assert.equal(m.groups.at(-1).items.at(-1).id, 'mod:a.any');
  assert.equal(m.items.find((i) => i.id === 'mod:a.any').icon, 'link');
  assert.equal(m.items.find((i) => i.id === 'mod:a.main').badge, '2');
  assert.ok(!m.items.some((i) => i.id === 'nope'));
  assert.equal(M.build({ native: ULTRA, mods, prefs: M.clean({ items: { 'mod:a.top': { hidden: true } } }) }).slots.top.length, 0, 'the student can hide a mod item');
});

test('the model accepts the longest mod API id', () => {
  const id = `mod:${'a'.repeat(48)}.${'b'.repeat(32)}`;
  const m = M.build({ mods: [{ owner: 'a', id, label: 'Longest' }] });
  assert.ok(m.items.some((i) => i.id === id));
});

test('mobile keeps mod slot items reachable', () => {
  const m = M.build({ native: ULTRA, mods: [{ owner: 'a', id: 'mod:a.top', label: 'Top', slot: 'top' }, { owner: 'a', id: 'mod:a.bottom', label: 'Bottom', slot: 'bottom' }] });
  const mobile = [...m.tabs, ...m.sheet.flatMap((g) => g.items)];
  for (const key of ['mod:a.top', 'mod:a.bottom']) assert.equal(mobile.filter((i) => i.id === key).length, 1, key);
});

test('the rail is open on wide windows by default, and the page keeps its room', () => {
  assert.equal(M.railOpen('auto', 1280), true); assert.equal(M.railOpen('auto', 1279), false);
  assert.equal(M.railOpen('open', 900), true); assert.equal(M.railOpen('icons', 2000), false);
  assert.deepEqual(G.GZ_SANITIZE({}).navbar, { on: false, rail: 'auto', peek: true, badges: true, brand: 'glaze' });
  assert.deepEqual(G.GZ_SANITIZE({ navbar: { on: 1, rail: 'wide', brand: 'school' } }).navbar, { on: false, rail: 'auto', peek: true, badges: true, brand: 'school' });
  const css = read('theme.css');
  for (const [px, rule] of [[M.SPACE.icons, 'html[data-gz-navbar] {'], [M.SPACE.open, 'html[data-gz-navbar="open"] {'], [M.SPACE.open, 'html[data-gz-navbar="auto"] {']]) {
    assert.ok(css.includes(`${rule} --gz-navbar-space: ${px}px; }`), rule);
  }
  for (const icon of M.PICKS) assert.match(M.ICONS[icon], /^[Mm][\d.\s,a-zA-Z-]+$/, icon);
  assert.ok(NI.ICONS.every((i) => M.PICKS.includes(i)), "every link icon a Look may give is one of the bar's");
});

test('the editor may change navbar fields; an Ultra top frame may only pin its rail', async () => {
  const source = read('lib/background.js');
  const store = { navbar: { on: true, rail: 'auto', brand: 'school' } };
  const ctx = vm.createContext({ GZ_SANITIZE: G.GZ_SANITIZE, fromEditor: (s) => s.editor === true, fromUltra: async (s) => s.ultra === true });
  const h = vm.runInContext(`({${source.match(/\n {2}navbar: \{([\s\S]*?)\n {2}\},/)[1]}})`, ctx);
  assert.equal(await h.allow({ patch: { rail: 'open' } }, { ultra: true, frameId: 0 }), true);
  assert.equal(await h.allow({ patch: { rail: 'icons' } }, { editor: true }), true);
  for (const [m, s] of [[{ patch: { rail: 'open' } }, { ultra: true, frameId: 2 }], [{ patch: { rail: 'open' } }, { frameId: 0 }], [{ patch: { on: false } }, { ultra: true, frameId: 0 }],
    [{ patch: { rail: 'open', on: false } }, { ultra: true, frameId: 0 }], [{ patch: { rail: 'auto' } }, { ultra: true, frameId: 0 }], [{ patch: ['open'] }, { editor: true }], [{}, { editor: true }],
    [{ patch: {} }, { editor: true }], [{ patch: { badges: 'false' } }, { editor: true }], [{ patch: { unknown: true } }, { editor: true }]]) assert.equal(await h.allow(m, s), false, JSON.stringify([m, s]));
  assert.equal(await h.allow({ patch: { rail: 'auto', badges: false } }, { editor: true }), true);
  const sync = { get: async () => structuredClone(store), set: async (p) => { Object.assign(store, p); return true; } };
  assert.equal((await h.run({ patch: { rail: 'icons' } }, { sync })).ok, true);
  assert.deepEqual(store.navbar, { on: true, rail: 'icons', peek: true, badges: true, brand: 'school' });
  await h.run({ patch: { badges: false } }, { sync });
  assert.deepEqual(store.navbar, { on: true, rail: 'icons', peek: true, badges: false, brand: 'school' });
  assert.match(source, /'features\/navbar\.js'\) \? \['lib\/nav\.js', 'lib\/nav-items\.js', 'lib\/navlayout\.js', 'lib\/navbar\.js'\]/, 'the model loads with the bar');
  assert.ok(require('../manifest.json').web_accessible_resources.some((w) => w.resources.includes('features/navbar.css')), 'the shadow root can load its sheet');
});

test("Ultra's part marks first paint from the setting and loads the bar only when it is on; the old rail steps aside", () => {
  const ultra = read('content-ultra.js');
  assert.match(ultra, /I\.setAttr\('data-gz-navbar', !!I\.settings\.navbar\?\.on && I\.settings\.navbar\.rail\);/);
  assert.match(ultra, /if \(globalThis\.GZ_NAVBAR_UI \|\| \(I\.links\.length && I\.settings\?\.navbar\?\.on\)\) need\('features\/navbar\.js'/);
  assert.match(read('features/nav.js'), /const on = X\.on\(\) && X\.settings\(\)\.enabled && !\(X\.site === 'ultra' && X\.settings\(\)\.navbar\?\.on\);/);
});

// The renderer's API: mods add, change and remove only their own items, and nothing unsafe gets through.
test("a mod's items are checked: name, icon, address, badge, place; one owner can't touch another's", () => {
  const noop = () => {};
  const ctx = vm.createContext({ GZ_NAV_LAYOUT: L, GZ_NAV_ITEMS: NI, GZ_NAVBAR: M, GZ_NAV: require('../lib/nav.js'), URL,
    location: { href: 'https://school.test/ultra/course', origin: 'https://school.test' }, addEventListener: noop, document: { addEventListener: noop }, requestAnimationFrame: noop,
    chrome: { runtime: { id: 'x' }, storage: { onChanged: { addListener: noop } } },
    GZ_CTX: { site: 'ultra', t: (k) => k, locale: () => 'en', on: () => false, settings: () => ({ enabled: true, navbar: { on: false } }), parts: () => null, setVar: noop } });
  const ui = vm.runInContext(read('features/navbar.js'), ctx);
  assert.equal(ui.add('countdown', { id: 'next', label: 'Next due', icon: 'star', href: 'https://due.test/', badge: 3, group: 'main' }), true);
  for (const bad of [{ id: 'Next', label: 'x' }, { id: 'a', label: '' }, { id: 'a', label: 'x'.repeat(41) }, { id: 'a', label: 'x', href: 'javascript:alert(1)' }, { id: 'a', label: 'x', href: 'http://plain.test/' },
    ...['blob:https://school.test/id', 'https://user:pass@due.test/', null, 1, {}].map((href) => ({ id: 'a', label: 'x', href })),
    { id: 'a', label: 'x', icon: 'skull' }, { id: 'a', label: 'x', badge: 'toolong' }, { id: 'a', label: 'x', slot: 'side' }, null]) assert.equal(ui.add('countdown', bad), false, JSON.stringify(bad));
  assert.equal(ui.add('Bad Owner', { id: 'a', label: 'x' }), false);
  assert.equal(ui.update('other', 'next', { label: 'Hijack' }), false);
  assert.equal(ui.remove('other', 'next'), false);
  assert.equal(ui.update('countdown', 'next', { label: 'Due soon', href: 'javascript:1' }), false);
  assert.equal(ui.update('countdown', 'next', { label: 'Due soon' }), true);
  for (let i = 0; i < 8; i++) ui.add('many', { id: `i${i}`, label: `Item ${i}` });
  assert.equal(ui.add('many', { id: 'i8', label: 'Ninth' }), false, 'at most eight a mod');
  assert.equal(ui.remove('countdown', 'next'), true);
});

test('a navbar control saves only its edit, preserving a pin from another tab', () => {
  const stored = { navbar: { ...G.GZ_SANITIZE().navbar, rail: 'open' } }, sent = [];
  const ctx = vm.createContext({ s: G.GZ_SANITIZE(), clearTimeout() {}, addEventListener() {}, hint() {}, syncSettings() {}, t: (k) => k, chrome: {
    runtime: { sendMessage: (m, cb) => { sent.push(m); Object.assign(stored.navbar, m.patch); cb({ ok: true }); } },
    storage: { sync: { set: (patch, cb) => { Object.assign(stored, patch); cb(); } } },
  } });
  vm.runInContext(read('ui.js') + '\nglobalThis.UI = GZ_UI;', ctx);
  const editor = read('options.js');
  vm.runInContext(editor.slice(editor.indexOf('  const pending = new Set()'), editor.indexOf('  // Relay preference')) + "\nset('navbar.badges', false); save(['navbar']);", ctx);
  assert.equal(stored.navbar.rail, 'open');
  assert.equal(stored.navbar.badges, false);
  assert.equal(JSON.stringify(sent), JSON.stringify([{ type: 'glaze:navbar', patch: { badges: false } }]));
});

test('a navbar edit batched with Look parts merges in the worker queue too', async () => {
  const stored = { navbar: { ...G.GZ_SANITIZE().navbar, rail: 'icons' } };
  const ctx = vm.createContext({ GZ_SANITIZE: G.GZ_SANITIZE, GZ_XPARTS: { write: async (_area, _parts, patch) => { Object.assign(stored, patch); return true; } } });
  const source = read('lib/background.js');
  const h = vm.runInContext(`({${source.match(/\n {2}look: \{([\s\S]*?)\n {2}\},/)[1]}})`, ctx);
  assert.equal((await h.run({ patch: { navbar: { badges: false } } }, { sync: { get: async () => structuredClone(stored) } })).ok, true);
  assert.equal(stored.navbar.rail, 'icons');
  assert.equal(stored.navbar.badges, false);
});
