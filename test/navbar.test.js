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

test('on by default: a floating rail, open on wide windows; Look codes carry how it looks, not whether it is on', async () => {
  assert.equal(M.railOpen('auto', 1280), true); assert.equal(M.railOpen('auto', 1279), false);
  assert.equal(M.railOpen('open', 900), true); assert.equal(M.railOpen('icons', 2000), false);
  const DEF = { on: true, place: 'rail', style: 'float', rail: 'auto', course: 'same', tabs: true, peek: true, badges: true, brand: 'glaze' };
  assert.deepEqual(G.GZ_SANITIZE({}).navbar, DEF);
  assert.deepEqual(G.GZ_SANITIZE({ navbar: { on: 1, place: 'side', style: 'glass', rail: 'wide', course: 'gone', brand: 'school' } }).navbar, { ...DEF, brand: 'school' });
  for (const icon of M.PICKS) assert.match(M.ICONS[icon], /^[Mm][\d.\s,a-zA-Z-]+$/, icon);
  assert.ok(NI.ICONS.every((i) => M.PICKS.includes(i)), "every link icon a Look may give is one of the bar's");
  const S = require('../lib/share.js');
  const s = G.GZ_SANITIZE({ navbar: { on: false, place: 'top', style: 'embed', course: 'icons', tabs: false } });
  const got = await S.decode(await S.encode(s, {}, null));
  assert.deepEqual(got.navbar, { place: 'top', style: 'embed', course: 'icons', tabs: false }, 'only what differs from the default, never on');
  assert.deepEqual((await S.decode(await S.encode(G.GZ_SANITIZE({}), {}, null))).navbar, {});
  const raw = (o) => S.PREFIX + Buffer.from(require('node:zlib').deflateRawSync(Buffer.from(JSON.stringify({ c: G.GZ_COLORS.map(([v]) => G.GZ_DEFAULTS.colors[v].slice(1)).join(''), ...o })))).toString('base64url');
  for (const v of [{ on: false }, { place: 'left' }, { style: 1 }, []]) await assert.rejects(S.decode(raw({ v })), JSON.stringify(v));
  assert.deepEqual((await S.decode(raw({ v: { place: 'top' } }))).navbar, { place: 'top' });
});

test('where the bar is: the placement, the course state, the style and the room it keeps', () => {
  const n = G.GZ_SANITIZE({}).navbar;
  const L1 = (o, ctx) => M.layout({ ...n, ...o }, ctx);
  assert.deepEqual(L1({}, { width: 1440 }), { place: 'rail', open: true, style: 'float', tabs: true, left: 272, top: 0, words: 'rail auto float tabs' });
  assert.deepEqual(L1({}, { width: 1100 }), { place: 'rail', open: false, style: 'float', tabs: true, left: 96, top: 0, words: 'rail auto float tabs' });
  assert.equal(L1({ style: 'embed' }, { width: 1440 }).left, 248);
  assert.equal(L1({ style: 'embed', rail: 'icons' }, { width: 1440 }).left, 72);
  assert.deepEqual(L1({ place: 'top' }, { width: 1440 }), { place: 'top', open: false, style: 'float', tabs: true, left: 0, top: 80, words: 'top float tabs' });
  assert.equal(L1({ place: 'top', style: 'embed' }).top, 56);
  assert.equal(L1({}, { width: 1440, rail: 'icons' }).left, 96, 'a pin just picked wins until storage says so');
  assert.deepEqual(L1({ course: 'icons' }, { width: 1440, course: true }), { place: 'rail', open: false, style: 'float', tabs: true, left: 96, top: 0, words: 'rail icons float tabs' });
  assert.equal(L1({ course: 'icons' }, { width: 1440, course: true, rail: 'open' }).open, false, 'icons inside a course whatever the pin');
  assert.equal(L1({ course: 'top' }, { course: true }).place, 'top');
  assert.deepEqual(L1({ course: 'hide' }, { course: true }), { place: 'none', open: false, style: 'float', tabs: false, left: 0, top: 0, words: 'none float' });
  assert.equal(L1({ course: 'hide' }, { course: false }).place, 'rail', 'only inside a course');
  assert.equal(L1({ tabs: true }, { tabs: false }).words, 'rail auto float', 'no course tabs to hold');
  assert.deepEqual([L1({}, { width: 800 }).left, L1({ place: 'top' }, { width: 800 }).top], [0, 0], 'a phone keeps no side or top room');
  // theme.css reserves the same room at first paint, from the same words.
  const css = read('theme.css');
  for (const [rule, px] of [['html[data-gz-navbar~="rail"] { --gz-navbar-left', 96], ['html[data-gz-navbar~="rail"][data-gz-navbar~="embed"] { --gz-navbar-left', 72], ['html[data-gz-navbar~="rail"][data-gz-navbar~="open"] { --gz-navbar-left', 272],
    ['html[data-gz-navbar~="rail"][data-gz-navbar~="open"][data-gz-navbar~="embed"] { --gz-navbar-left', 248], ['html[data-gz-navbar~="top"] { --gz-navbar-top', 80], ['html[data-gz-navbar~="top"][data-gz-navbar~="embed"] { --gz-navbar-top', 56],
    ['html[data-gz-navbar~="rail"][data-gz-navbar~="auto"] { --gz-navbar-left', 272], ['html[data-gz-navbar~="rail"][data-gz-navbar~="auto"][data-gz-navbar~="embed"] { --gz-navbar-left', 248]]) assert.ok(css.includes(`${rule}: ${px}px; }`), rule);
  for (const rule of ['#main-content-inner { padding-inline-start: var(--gz-navbar-left) !important; }', '#main-content { box-sizing: border-box; padding-top: var(--gz-navbar-top) !important; }',
    '.inner-wrap > :is(section.course, .routed-page) { box-sizing: border-box; padding-inline-start: var(--gz-navbar-left) !important; padding-top: var(--gz-navbar-top) !important; }',
    '#gz-ctabs-frames { inset-inline-start: var(--gz-navbar-left); top: var(--gz-navbar-top); }', 'html[data-gz-ctabs~="nav"] #gz-ctabs { display: none !important; }']) assert.ok(css.includes(rule), rule);
});

test("Ultra's first paint words the bar as the model does, for each setting, in and out of a course", () => {
  const src = read('content-ultra.js');
  const line = src.match(/ {4}const b = I\.settings\.navbar, c = [^\n]+\n[^\n]+/)[0];
  const first = (navbar, path, tabs = true) => {
    const attrs = {};
    vm.runInNewContext(line, { I: { settings: { navbar, enhance: { tabs } }, setAttr: (k, v) => { attrs[k] = v; } }, location: { pathname: path }, globalThis: {} });
    return attrs['data-gz-navbar'];
  };
  const n = G.GZ_SANITIZE({}).navbar;
  for (const o of [{}, { style: 'embed' }, { rail: 'icons' }, { place: 'top' }, { course: 'icons' }, { course: 'top' }, { course: 'hide' }, { tabs: false }]) {
    for (const path of ['/ultra/course', '/ultra/courses/_1_1/outline']) {
      const s = { ...n, ...o }, want = M.layout(s, { course: path.startsWith('/ultra/courses/'), width: 1440 }).words.split(' ');
      const got = first(s, path).split(' ');
      // The first paint may name the rail state of a top bar; theme.css only reads it beside `rail`.
      assert.deepEqual(got.filter((w) => !(want[0] === 'top' && ['auto', 'open', 'icons'].includes(w))), want, JSON.stringify([o, path]));
    }
  }
  assert.equal(first({ ...n, on: false }, '/ultra/course'), false);
  assert.equal(first(n, '/ultra/course', false), 'rail auto float', 'without course tabs, nothing to hold');
});

test('the editor may change navbar fields; an Ultra top frame may only pin its rail', async () => {
  const source = read('lib/background.js');
  const DEF = G.GZ_SANITIZE({}).navbar;
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
  assert.deepEqual(store.navbar, { ...DEF, rail: 'icons', brand: 'school' });
  await h.run({ patch: { badges: false } }, { sync });
  assert.deepEqual(store.navbar, { ...DEF, rail: 'icons', badges: false, brand: 'school' });
  assert.match(source, /'features\/navbar\.js'\) \? \['lib\/nav\.js', 'lib\/nav-items\.js', 'lib\/navlayout\.js', 'lib\/navbar\.js'\]/, 'the model loads with the bar');
  assert.ok(require('../manifest.json').web_accessible_resources.some((w) => w.resources.includes('features/navbar.css')), 'the shadow root can load its sheet');
});

test("Ultra's part marks first paint from the setting and loads the bar only when it is on; the old rail steps aside", () => {
  const ultra = read('content-ultra.js');
  assert.match(ultra, /if \(!globalThis\.GZ_NAVBAR_UI\?\.live\(\)\) I\.setAttr\('data-gz-navbar', !!b\?\.on && /);
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

test("the editor lists every item where the bar puts it, hidden ones too, with the phone's tabs", () => {
  const E = require('../lib/editor-navbar.js');
  const ids = (gs) => gs.map((g) => g.items.map((i) => i.id));
  assert.deepEqual(ids(E.rows({})), [['institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades'], ['tools']]);
  assert.deepEqual(E.rows({}).flatMap((g) => g.items).filter((i) => i.tab).map((i) => i.id), ['institution-page', 'course', 'calendar', 'messages']);
  const prefs = { items: { stream: { hidden: true, label: 'Feed' }, tools: { icon: 'star' } }, groups: [{ label: 'Daily', items: ['calendar', 'stream'] }, { items: [] }, { items: ['tools'] }], tabs: ['calendar'], glaze: ['notes'], links: [{ id: 'aaaaaaaaaaaa', n: 'Wiki', u: 'https://wiki.test/' }] };
  const gs = E.rows(prefs);
  assert.deepEqual(gs.map((g) => g.label), ['Daily', '', '']);
  assert.deepEqual(ids(gs), [['calendar', 'stream', 'institution-page', 'course', 'organization', 'messages', 'grades'], [], ['tools', 'link:aaaaaaaaaaaa', 'glaze:notes']], 'an empty group stays to drop into');
  const stream = gs[0].items[1];
  assert.deepEqual([stream.hidden, stream.name], [true, 'Feed'], 'hidden, still listed in its place');
  assert.equal(gs[2].items[0].icon, 'star');
  assert.equal(gs[2].items[1].own, true, "the student's own link can be removed here");
  assert.equal(gs.flatMap((g) => g.items).filter((i) => i.tab)[0].id, 'calendar');
  assert.equal(E.rows({ glaze: ['todo'] }, { names: (id) => id === 'glaze:todo' ? 'Tareas' : id }).flatMap((g) => g.items).find((i) => i.id === 'glaze:todo').name, 'Tareas');
  assert.match(read('options.html'), /<script src="lib\/navbar\.js"><\/script>\s*<script src="lib\/editor-navbar\.js"><\/script>/);
});

test('course tabs show in the bar when it holds them, and at "only in the navigation" their strip steps aside', () => {
  const src = read('features/coursetabs.js');
  assert.deepEqual(require('../lib/coursetabs.js') && require('../defaults.js').GZ_SPEC.tabs.at, ['above', ['above', 'between', 'below', 'nav']]);
  assert.match(src, /\(framed \? parent\.document : document\)\.documentElement\.getAttribute\('data-gz-navbar'\)/, "a tab's frame asks the page around it");
  assert.match(src, /const at = \(\) => \(P\(\)\.at !== 'nav' \? P\(\)\.at : navHolds\(\) \? 'nav' : 'above'\);/, "'nav' is the strip's 'above' where no bar holds the tabs");
  assert.match(src, /const hosted = \(\) => at\(\) === 'nav';/);
  assert.match(src, /if \(hosted\(\)\) \{ keepClear\(null\); strip\.remove\(\); return; \}/);
  assert.match(src, /v = a === 'nav' \? a : /, 'the first paint keeps no room for a strip');
  assert.match(src, /if \(!framed\) globalThis\.GZ_NAVBAR_UI\?\.sync\(\);/, 'the bar redraws when the tabs change');
  for (const k of ['rows', 'visit', 'shut', 'pin', 'move', 'leave', 'place']) assert.match(src, new RegExp(`\\n    ${k}[:,]`), k);
  assert.match(read('theme.css'), /html\[data-gz-ctabs~="nav"\] \{ --gz-ctabs-h: 0px !important; \}/, "and the strip's room with it");
});

const itemEditor = (set) => {
  const source = read('lib/editor-navbar.js');
  const status = { textContent: '' };
  const ctx = vm.createContext({ GZ_NAVBAR: M, TextEncoder, MAX_BYTES: 8000, M: () => M, $: () => status,
    t: (s) => s, hint() {}, render() {}, load() {}, chrome: { storage: { sync: { set } } } });
  vm.runInContext(source.slice(source.indexOf('    let prefs ='), source.indexOf('    // The order of every group'))
    + '\nglobalThis.edit = write; globalThis.current = () => prefs;', ctx);
  return { edit: ctx.edit, current: () => JSON.parse(JSON.stringify(ctx.current())), status };
};

test('navigation item writes count UTF-8 bytes before attempting sync', async () => {
  let calls = 0;
  const editor = itemEditor(async () => { calls++; });
  const next = M.clean({ items: Object.fromEntries(Array.from({ length: 44 }, (_, i) => [`mod:unicode.item${i}`, { label: '🦊'.repeat(40) }])) });
  assert.ok(JSON.stringify({ navbarItems: next }).length < 8000);
  assert.ok(new TextEncoder().encode(JSON.stringify({ navbarItems: next })).length > 8192);
  assert.equal(await editor.edit(next), false);
  assert.equal(calls, 0);
  assert.deepEqual(editor.current(), M.clean(), 'an oversize edit leaves the stored model alone');
});

test('a failed navigation item write restores the last saved choices', async () => {
  const editor = itemEditor(async () => { throw Error('quota'); });
  assert.equal(await editor.edit({ items: { course: { label: 'Unsaved' } } }), false);
  assert.deepEqual(editor.current(), M.clean());
  assert.equal(editor.status.textContent, 'Not saved. Try again in a moment.');
});

test('queued navigation item writes restore the last successful edit if the next fails', async () => {
  let calls = 0;
  const editor = itemEditor(async () => { if (++calls === 2) throw Error('quota'); });
  const kept = M.clean({ items: { course: { label: 'Saved name' } } });
  const first = editor.edit(kept), second = editor.edit({ ...kept, glaze: ['notes'] });
  assert.deepEqual(await Promise.all([first, second]), [true, false]);
  assert.deepEqual(editor.current(), kept);
});
