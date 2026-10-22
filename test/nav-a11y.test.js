// WP-N2: accessibility and keyboard in Glaze's navigation, keys, palette and search. The bar's own rendering tests that need a
// page (focus after a redraw, tooltips) are in navbar-canvas-audit.test.js; the course menu's in canvas-coursemenu.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const M = require('../lib/navbar.js');
const L = require('../lib/navlayout.js');
const E = require('../lib/editor-navbar.js');

const read = (file) => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

// ---- a stylesheet's rules, and which of them hide an element for a page's attributes ------------------------------------
const rulesOf = (css) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
const topLevel = (s) => { // a selector list split at its own commas, not those inside :is( ) or [ ]
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if ('(['.includes(ch)) depth++; else if (')]'.includes(ch)) depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim()); return out;
};
// Whether a rule that sets `display: none` reaches `target` under `html` with these attributes. Understands the shape
// canvas.css uses for the bar's words: html[attr], html[attr~="word"], html:not([attr~="word"]) …, then the target(s).
const hiddenFor = (css, target, attrs) => rulesOf(css).filter((r) => /display:\s*none/.test(r.body)).some((r) => topLevel(r.sel).some((s) => {
  const m = s.match(/^html((?:\[[^\]]+\]|:not\(\[[^\]]+\]\))*)\s+(.+)$/);
  if (!m) return false;
  if (!topLevel(m[2].replace(/^:is\((.*)\)$/, '$1')).includes(target)) return false;
  return (m[1].match(/:not\(\[[^\]]+\]\)|\[[^\]]+\]/g) || []).every((c) => {
    const [, not, name, op, word] = c.match(/^(:not\()?\[([\w-]+)(?:(~?=)"([^"]*)")?\]\)?$/);
    const have = attrs[name];
    const hit = have !== undefined && (!op || (op === '=' ? have === word : have.split(/\s+/).includes(word)));
    return not ? !hit : hit;
  });
}));

// ---- NAV-2: compact top-bar items keep an accessible name ------------------------------------------------------------------
test('compact top-bar items hide their labels visually, never from the accessibility tree', () => {
  const rules = rulesOf(read('features/navbar.css')).filter((r) => /\[data-compact\]/.test(r.sel) && /\.label/.test(r.sel));
  assert.ok(rules.length, 'a rule for the labels of a compact top bar');
  for (const r of rules) {
    // display: none and visibility: hidden take the label out of the name; an icon's name is its label.
    assert.doesNotMatch(r.body, /display:\s*none|visibility:\s*hidden/, r.sel);
    assert.match(r.body, /position:\s*absolute/);
    assert.match(r.body, /clip-path:\s*inset\(50%\)/);
    assert.match(r.body, /(?:width|height):\s*1px/);
  }
});

// ---- NAV-3, NAV-6 (keys): the "g then a letter" shortcuts --------------------------------------------------------------------
// content.js's own typing/keyOn and the real keys.js, with an element that answers closest() by role.
class Node_ {
  constructor(role, tag = 'div') { Object.assign(this, { role, tag, isContentEditable: false }); }
  closest(sel) { return topLevel(sel).some((s) => { const m = s.match(/^\[role="(\w+)"\]/); return m ? m[1] === this.role : s === this.tag; }) ? this : null; }
}
const keys = (site, { lazy = false } = {}) => {
  const src = read('content.js');
  const block = src.slice(src.indexOf('  const typing = '), src.indexOf('  let keysWaiting'));
  const assigned = [];
  const sandbox = { Element: Node_, chrome: { runtime: { id: 'x' } }, settings: { enhance: { keys: true } }, observer: {}, ultra: site === 'ultra', moodle: false,
    GZ_PAGE: { canvasKeys: () => true }, location: { origin: 'https://lms.test', pathname: '/', assign: (u) => assigned.push(u) },
    document: { activeElement: null, body: { id: '' } }, navigator: { platform: 'Linux' } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${block}\nglobalThis.GZ_CTX = { site: '${site}', t: (s) => s, typing, keyOn, settings: () => settings, wordsIn: new Set() };`, sandbox);
  let listener, release;
  if (lazy) {
    sandbox.solo = true;
    sandbox.document.addEventListener = (_, f) => { listener = f; };
    sandbox.need = () => new Promise((r) => { release = r; });
    vm.runInContext(src.slice(src.indexOf('  let keysWaiting ='), src.indexOf('  // ---- command palette')), sandbox);
  } else vm.runInContext(read('features/keys.js'), sandbox);
  const ev = (key, target, at, extra = {}) => ({ key, at, target, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  // "g" then "a" (Calendar), 300 ms apart, with focus on `at` and the key's target `target`.
  const goTo = (at, { target = at, ...extra } = {}) => {
    assigned.length = 0;
    sandbox.document.activeElement = at;
    const t0 = Date.now();
    sandbox.GZ_KEYS.key(ev('g', target, t0, extra)); sandbox.GZ_KEYS.key(ev('a', target, t0 + 300, extra));
    return [...assigned];
  };
  return { goTo, assigned, press: (key, extra = {}) => listener(ev(key, new Node_(''), Date.now(), extra)),
    load: async () => { vm.runInContext(read('features/keys.js'), sandbox); release(); for (let i = 0; i < 4; i++) await new Promise(setImmediate); } };
};

test('IME flags survive shortcut module loading, and Safari keyCode 229 is never a shortcut', async () => {
  const u = keys('ultra', { lazy: true });
  u.press('g'); u.press('a', { isComposing: true, keyCode: 229 }); await u.load();
  assert.deepEqual(u.assigned, [], 'queued composition cannot become g+a after the module arrives');
  assert.deepEqual(keys('ultra').goTo(new Node_(''), { keyCode: 229 }), [], 'Safari compositionend key');
});

test('type-ahead suppression crosses nested shadow hosts', () => {
  const host = new Node_(''), menu = new Node_('menu'), innerHost = new Node_(''), leaf = new Node_('');
  host.shadowRoot = { activeElement: innerHost }; innerHost.shadowRoot = { activeElement: leaf };
  leaf.getRootNode = () => ({ host: innerHost }); innerHost.getRootNode = () => ({ host: menu });
  assert.deepEqual(keys('ultra').goTo(host), [], 'the leaf belongs to the outer shadow menu');
});

test('queued keys keep the original composed path after dispatch ends', async () => {
  const u = keys('ultra', { lazy: true }), path = [new Node_('listbox'), new Node_('')];
  u.press('g'); u.press('a', { composedPath: () => [...path] }); path.length = 0;
  await u.load();
  assert.deepEqual(u.assigned, [], 'the original role stays with the deferred event even after dispatch');
});

test('Ultra: g + letter does not fire inside menus, listboxes, grids, trees or comboboxes (type-ahead), but still inside a course dialog', () => {
  const u = keys('ultra');
  assert.deepEqual(u.goTo(new Node_('')), ['https://lms.test/ultra/calendar'], 'on the page itself');
  assert.deepEqual(u.goTo(new Node_('dialog')), ['https://lms.test/ultra/calendar'], "Ultra's courses are dialogs: shortcuts work in them");
  for (const role of ['menu', 'menubar', 'listbox', 'grid', 'tree', 'combobox']) assert.deepEqual(u.goTo(new Node_(role)), [], `${role}: "ga" is type-ahead`);
});

test('Canvas keeps ignoring dialogs too, as before', () => {
  const c = keys('canvas');
  assert.deepEqual(c.goTo(new Node_('')), ['https://lms.test/calendar']);
  for (const role of ['dialog', 'menu', 'listbox', 'grid']) assert.deepEqual(c.goTo(new Node_(role)), [], role);
});

test("Ultra: focus inside Glaze's bar (the document sees the host) follows the same roles", () => {
  const u = keys('ultra'), host = new Node_('');
  for (const [role, expected] of [['listbox', []], ['menu', []], ['dialog', ['https://lms.test/ultra/calendar']], ['', ['https://lms.test/ultra/calendar']]]) {
    host.shadowRoot = { activeElement: new Node_(role) };
    assert.deepEqual(u.goTo(host), expected, `in the bar: ${role || 'a link'}`);
  }
});

test('an Enter or letter that confirms an IME composition is not a shortcut', () => {
  for (const site of ['ultra', 'canvas']) assert.deepEqual(keys(site).goTo(new Node_(''), { isComposing: true }), [], site);
});

// ---- NAV-4: the Navigation items editor lists every LMS's items ----------------------------------------------------------
test('the editor lists Canvas and Moodle items, and says which LMS each belongs to', () => {
  const items = E.rows({}).flatMap((g) => g.items);
  const ids = items.map((i) => i.id);
  for (const id of ['dashboard', 'groups', 'history', 'help', 'admin']) assert.ok(ids.includes(id), `Canvas: ${id}`);
  for (const id of ['dashboard', 'home', 'notifications', 'grades']) assert.ok(ids.includes(id), `Moodle: ${id}`);
  for (const id of ['institution-page', 'stream', 'course', 'organization', 'calendar', 'messages', 'grades', 'tools']) assert.ok(ids.includes(id), `Ultra: ${id}`);
  const sites = (id) => items.find((i) => i.id === id).sites;
  assert.deepEqual(sites('history'), ['canvas']);
  assert.deepEqual(sites('notifications'), ['moodle']);
  assert.deepEqual(sites('dashboard'), ['canvas', 'moodle']);
  assert.deepEqual(sites('tools'), ['ultra']);
  assert.deepEqual(sites('calendar'), ['ultra', 'canvas', 'moodle']);
  // Every id the bars read off a site's own nav is one the editor can list.
  assert.deepEqual(L.NATIVE.filter((id) => !['glaze', 'profile', 'logout'].includes(id) && !ids.includes(id)), [], 'none of the shared vocabulary is out of reach (the foot is not placeable)');
});

test("every LMS's phone tabs show as the bar picks them, not only Ultra's", () => {
  const tabs = E.rows({}).flatMap((g) => g.items).filter((i) => i.tab).map((i) => i.id);
  assert.deepEqual(tabs.sort(), ['calendar', 'course', 'dashboard', 'institution-page', 'messages']);
});

test('explicit editor phone preferences do not re-check per-site fallback slots', () => {
  const ids = ['institution-page', 'dashboard', 'course', 'calendar'];
  const checked = E.rows({ tabs: ids }).flatMap((g) => g.items).filter((i) => i.tab).map((i) => i.id);
  assert.deepEqual(checked.sort(), ids.sort(), 'four stored preferences stay four; auto-filled Messages is not another preference');
});

test("a layout the editor writes keeps Canvas's Dashboard where the student put it", () => {
  const canvas = ['profile', 'dashboard', 'course', 'groups', 'calendar', 'messages', 'history', 'help', 'admin'].map((id) => ({ id, label: id, href: `https://c.test/${id}` }));
  const gs = E.rows({});
  const prefs = M.clean({ groups: gs.map((g) => ({ label: g.label, items: g.items.map((i) => i.id) })) });
  const bar = M.build({ native: canvas, prefs });
  assert.deepEqual(bar.groups.map((g) => g.items.map((i) => i.id)), [['dashboard', 'course', 'groups', 'calendar', 'messages'], ['history', 'help', 'admin']],
    "Canvas's items in the editor's order; with Ultra-only ids it put the Dashboard after Messages");
});

test('a student can hide, rename and move a Canvas item from the editor, and the bar follows', () => {
  const canvas = ['dashboard', 'course', 'groups', 'history'].map((id) => ({ id, label: id, href: `https://c.test/${id}` }));
  const prefs = { items: { history: { hidden: true }, groups: { label: 'Teams' } }, groups: [{ items: ['groups', 'dashboard'] }, { items: ['course', 'history'] }] };
  const gs = E.rows(prefs);
  assert.equal(gs.flatMap((g) => g.items).find((i) => i.id === 'history').hidden, true);
  assert.equal(gs.flatMap((g) => g.items).find((i) => i.id === 'groups').name, 'Teams');
  const bar = M.build({ native: canvas, prefs: M.clean(prefs) });
  assert.deepEqual(bar.groups.map((g) => g.items.map((i) => i.label)), [['Teams', 'dashboard'], ['course']]);
});

test('the editor draws the LMS an item is for beside it, but not for items every LMS has', async () => {
  const doc = { activeElement: null }, elements = {};
  const stored = {};
  for (const id of ['nbar-items', 'nbar-glaze', 'nbar-widgets', 'nbar-links', 'nbar-status', 'nbar-link-form', 'nbar-reset']) elements[id] = Object.assign(new El('div', doc), { id });
  doc.querySelector = (s) => elements[s.slice(1)]; doc.createElement = (s) => new El(s, doc); doc.createElementNS = (_, s) => new El(s, doc);
  const ctx = vm.createContext({ document: doc, TextEncoder, URL, GZ_NAVBAR: M, GZ_NAV_ITEMS: require('../lib/nav-items.js'),
    chrome: { storage: { sync: { get: async () => stored, set: async (v) => { Object.assign(stored, plain(v)); } }, onChanged: { addListener() {} } } } });
  vm.runInContext(read('lib/editor-navbar.js'), ctx);
  ctx.GZ_NAVBAREDIT.mount({ t: (s) => ({ Blackboard: 'Blackboard', Canvas: 'Canvas', Moodle: 'Moodle' }[s] || s), settings: () => ({ enhance: {} }) });
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  const row = (id) => elements['nbar-items'].querySelector(`li[data-id="${id}"]`);
  const note = (id) => row(id).querySelector('.nb-sites')?.textContent;
  assert.ok(row('history'), 'Canvas History is listed');
  assert.equal(note('history'), 'Canvas');
  assert.equal(note('dashboard'), 'Canvas, Moodle');
  assert.equal(note('institution-page'), 'Blackboard');
  assert.equal(note('calendar'), undefined, 'every LMS has it');
  const phone = row('messages').querySelector('[data-nb="tab"]');
  phone.checked = false; phone.dispatchEvent({ type: 'change' });
  for (let i = 0; i < 8; i++) await new Promise(setImmediate);
  assert.deepEqual(stored.navbarItems.tabs.sort(), ['calendar', 'course', 'dashboard', 'institution-page'], 'only the deliberately unchecked default is removed, with no fifth entry silently truncated');
  assert.equal(row('messages').querySelector('[data-nb="tab"]').checked, false, 'the automatic fallback is not re-checked as a preference');
});

// ---- NAV-5: Skip to content on Ultra with a course tab showing ---------------------------------------------------------------
test("Ultra's Skip to content aims at the course tab's frame when one shows", () => {
  const src = read('features/navbar.js');
  const doc = (name) => ({ name, getElementById: (id) => (id === 'main-content' ? { in: name } : null), querySelector: () => null });
  const page = doc('page'), frame = doc('frame');
  const ctx = vm.createContext({ document: page, location: { origin: 'https://bb.test', pathname: '/ultra/courses/_1_1/outline' }, URL,
    chrome: { storage: { local: { get() {}, set() {} } } }, MutationObserver: class { observe() {} disconnect() {} }, NodeFilter: {}, GZ_NAV: require('../lib/nav.js') });
  const Ultra = vm.runInContext(src.slice(src.indexOf('function GZ_NAVBAR_ULTRA(X) {'), src.indexOf('if (typeof module')) + '\nGZ_NAVBAR_ULTRA;', ctx);
  const site = Ultra({ t: (s) => s, settings: () => ({ enhance: {} }) });
  assert.deepEqual(plain(site.main()), { in: 'page' });
  assert.deepEqual(plain(site.main(frame)), { in: 'frame' }, "the frame's own main, as Canvas's adapter finds it");
  // And the renderer hands it that frame: mainAt asks the course tabs for the document on screen.
  const mainAt = vm.runInContext(src.slice(src.indexOf('  const mainAt ='), src.indexOf('  const panels = new Map')) + '\nmainAt;',
    vm.createContext({ site, document: page, tabsApi: () => ({ doc: () => frame }) }));
  assert.deepEqual(plain(mainAt()), { in: 'frame' });
});

// ---- NAV-6: an Enter that confirms an IME composition -----------------------------------------------------------------------
test('the palette runs nothing on the Enter that commits an IME composition', () => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  doc.createElement = (tag) => new El(tag, doc);
  const assigned = [];
  const ctx = vm.createContext({ document: doc, location: { origin: 'https://bb.school.test', pathname: '/ultra/stream', assign: (u) => assigned.push(u) }, GZ_PAGE: require('../lib/page.js'), URL,
    GZ_CTX: { site: 'ultra', t: (k) => k, locale: () => 'en', settings: () => ({ enhance: {} }), need: () => new Promise(() => {}), courseId: () => '' } });
  const cmd = vm.runInContext(read('features/palette.js'), ctx);
  cmd.open();
  const input = doc.body.querySelector('input');
  input.value = 'Calendar';
  input.dispatchEvent({ type: 'input' });
  const press = (extra) => { const e = { type: 'keydown', key: 'Enter', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra }; input.dispatchEvent(e); return e; };
  // The browser's keydown for the Enter that picks a candidate: isComposing, or (Safari) keyCode 229 after compositionend.
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    const e = press(extra);
    assert.deepEqual(assigned, [], JSON.stringify(extra));
    assert.equal(cmd.isOpen(), true, 'the palette stays open for the next key');
    assert.equal(e.defaultPrevented, false, "the composition's own key is left to the browser");
  }
  press({ keyCode: 13 });
  assert.deepEqual(assigned, ['https://bb.school.test/ultra/calendar'], 'a real Enter goes');
});

// ---- NAV-7: Canvas on a phone, Inside a course: Hide ---------------------------------------------------------------------------
test("hiding Glaze's bar inside a course leaves Canvas's own phone header (its menu and global navigation)", () => {
  const css = read('canvas.css');
  const attr = 'data-gz-navbar';
  assert.equal(hiddenFor(css, '#mobile-header', { [attr]: 'rail open float' }), true, "with the bar drawn, Canvas's header is replaced");
  assert.equal(hiddenFor(css, '#mobile-header', { [attr]: 'top float menu' }), true);
  assert.equal(hiddenFor(css, '#mobile-header', { [attr]: 'none float' }), false, 'with no bar there is no other way to the menus on a phone');
  assert.equal(hiddenFor(css, '#header', { [attr]: 'none float' }), true, 'the desktop header stays hidden, as before');
  assert.equal(hiddenFor(css, '#mobile-header', {}), false, 'with the bar off, nothing of Canvas is hidden');
});

test('Canvas course frames distinguish a hidden bar from a disabled course menu and keep the phone header', () => {
  const src = read('content-canvas.js'), at = src.indexOf('  const paintNav = ');
  const paint = src.slice(at, src.indexOf('  // Course tabs', at));
  for (const [course, cmenu, word] of [['hide', true, 'none'], ['hide', false, 'none'], ['same', false, ''], ['same', true, 'menu']]) {
    const attrs = {};
    const window = { top: {} };
    vm.runInNewContext(paint + '\npaintNav({});', { window, I: { tabFrame: '12', settings: { navbar: { on: true, course, cmenu } } }, setAttr: (k,v) => { attrs[k] = v; } });
    assert.equal(attrs['data-gz-navbar-frame'], word, `${course}/${cmenu}`);
    assert.equal(hiddenFor(read('canvas.css'), '#mobile-header', attrs), course !== 'hide', 'only a replacement bar hides the native mobile header');
  }
});

// ---- NAV-11: the search status is hidden visually on every site that has search ----------------------------------------------------
test('the search status line uses a class Glaze defines on Ultra and Canvas', () => {
  const search = read('features/search.js');
  assert.match(search, /live\.className = 'gz-sr';/);
  assert.doesNotMatch(search, /screenreader-only/, "Canvas's own class; Ultra has none");
  assert.match(rulesOf(read('features/apps.css')).find((r) => r.sel === '.gz-sr').body, /clip-path:\s*inset\(50%\)/);
  // apps.css is among the sheets of Ultra and Canvas (Moodle has no search: palette.js searchHere).
  assert.match(read('content.js'), /moodle \? \[\] : \['features\/apps\.css'/);
  assert.match(read('features/palette.js'), /const searchHere = \(\) => !moodle && /);
});
