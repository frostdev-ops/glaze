// What a Look from someone else may do, and what its offer says (LOOK-1): describe() names every hidden item, every
// link with its host and every hidden or renamed part; a code from outside can't take away signing out or the account, nor
// link to a page without https; a worn Look's links say where they go; the Navigation editor shows what the Look hides.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');

// As the editor has them (options.html): the cleaners a code goes through, with the parts registry loaded.
Object.assign(globalThis, D);
globalThis.GZ_NAV = require('../lib/nav.js');
globalThis.GZ_NAV_ITEMS = require('../lib/nav-items.js');
globalThis.GZ_NAV_LAYOUT = require('../lib/navlayout.js');
globalThis.GZ_MX = require('../lib/motionx.js');
globalThis.GZ_PARTS = require('../lib/parts.js');
globalThis.GZ_GLSL = require('../lib/glsl.js');
const X = globalThis.GZ_XPARTS = require('../lib/lookparts.js');
globalThis.GZ_CARDS = require('../lib/cards.js');
const S = require('../lib/share.js');
const L = globalThis.GZ_NAV_LAYOUT;
const M = require('../lib/navbar.js');
const E = require('../lib/editor-navbar.js');
const F = require('../lib/fonts.js');

const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
// A sentence as the editor shows it in English: lists joined, everything else as it is.
const say = ({ why, vars = {} }) => why.replace(/\{(\w+)\}/g, (_, k) => (Array.isArray(vars[k]) ? vars[k].join(', ') : String(vars[k])));

// The audit's Look (audit/navphish.js): 741 characters that hide Grades and Sign out, add look-alike links, hide Canvas's
// announcements and assignments, write a fake sign-in notice into Moodle's page title and paint Ultra's rail one colour.
const PHISH = { x: {
  nav: { place: 'left', groups: [{ items: ['stream', 'course', 'link:abcdefghijkl', 'link:mnopqrstuvwx', 'glaze'] }], hidden: ['grades', 'logout'],
    links: [{ id: 'abcdefghijkl', n: 'Grades', u: 'http://grades-portal.example/login', i: 'star' }, { id: 'mnopqrstuvwx', n: 'Sign out', u: 'https://sso-signout.example/', i: 'link' }] },
  rules: [
    { p: 'canvas.course-nav.announcements', do: 'hide' },
    { p: 'canvas.course-nav.assignments', do: 'hide' },
    { p: 'moodle.page-header.title', do: 'label', t: 'Session expired: sign in again from the Grades link' },
    { p: 'ultra.nav', do: 'style', st: { fg: 'surface-2', bg: 'surface-2' } },
  ] } };
const phishCode = () => S.encode(D.GZ_SANITIZE({}), {}, PHISH);

test('outside rules cannot hide Canvas Account', () => {
  for (const rules of [[{ p: 'canvas.global-nav.account', do: 'hide' }], [{ p: 'canvas.global-nav.account', do: 'style', st: { o: 0 } }]]) {
    assert.ok(X.outside({ x: { rules } }).length, 'Account holds Canvas signing out');
  }
  assert.deepEqual(X.outside({ x: { rules: [{ p: 'canvas.global-nav.account', do: 'hide' }, { p: 'canvas.global-nav.account', do: 'show' }] } }), [], 'final shown account is safe');
});

test('replacement links cannot impersonate hidden native items', () => {
  for (const n of ['Grades', ' GRADES ', 'Noten', 'Notas', 'Notes', 'Cijfers', 'Calificaciones']) {
    assert.ok(X.outside({ x: { nav: { hidden: ['grades'], links: [{ n, u: 'https://fake.example/' }] } } }).length, n);
  }
});

test("the offer for the audit's Look names both hidden items, both links with their hosts, and every hidden or renamed part", async () => {
  const code = await phishCode();
  // Deflate output differs by a few bytes between platform zlib builds (741 on Linux CI, 727 on macOS arm64).
  assert.ok(code.length >= 700 && code.length <= 760, `the code the audit decoded (${code.length})`);
  const said = X.describe((await S.decode(code)).parts).map(say);
  assert.ok(said.includes('Hides Grades, Sign out in the navigation.'), said.join('\n'));
  assert.ok(said.includes('Adds a link: Grades → grades-portal.example.'), said.join('\n'));
  assert.ok(said.includes('Adds a link: Sign out → sso-signout.example.'), said.join('\n'));
  assert.ok(said.includes('Hides 2 parts of your school pages: Announcements in the course menu, Assignments in the course menu.'), said.join('\n'));
  assert.ok(said.includes('Changes the text of Page title to “Session expired: sign in again from the Grades link”.'), said.join('\n'));
  assert.ok(said.includes('Changes how 1 parts of your school pages look: Navigation.'), said.join('\n'));
  assert.ok(said.includes('Rearranges the navigation.'), said.join('\n'));
  assert.ok(!said.some((s) => /sidebar/.test(s)), 'the navigation is not the sidebar');
});

test('every group a code can carry is described, or deliberately silent', () => {
  const said = (x, m) => X.describe({ ...(x && { x }), ...(m && { m }) });
  // One of each, as a code carries them. Each must say something; `silent` are the only exceptions, each for a reason.
  const groups = {
    bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(uv, 0.0, 1.0); }' } },
    anim: { 'card.enter': { s: [{ at: 0, o: 0 }, { at: 1, o: 1 }] } },
    fx: { complete: { kind: 'confetti' } },
    cursor: { kind: 'glow' },
    pointer: 'ghost',
    type: { kind: 'embers' },
    nav: { place: 'top' },
    rules: [{ p: 'canvas.footer', do: 'hide' }],
  };
  assert.deepEqual(Object.keys(groups).sort(), [...X.GROUPS].sort(), 'a new group of Look parts needs a sentence here');
  for (const [k, v] of Object.entries(groups)) assert.ok(said({ [k]: v }).length, `x.${k} says nothing`);
  assert.ok(said(null, [{ id: 'abcdefghijklmnop', h: 'A'.repeat(43), name: 'Clock' }]).some((n) => /mods/.test(n.why)), 'm says nothing');
  for (const media of [{ type: 'video', src: 'https://cdn.example.com/a.webm' }, { type: 'image', src: `file:${'A'.repeat(43)}` }]) assert.ok(said({ bg: { media } }).length);
  assert.ok(said({ bg: { layers: [{ k: 'noise' }] } }).length);
  // The student's own pointer picture is theirs, and never comes in a code (lib/share.js): nothing to say about it.
  assert.equal(said({ pointer: 'own' }).length, 0);
  // The nav layout, key by key.
  const nav = { place: { place: 'dock' }, groups: { groups: [{ items: ['grades'] }] }, hidden: { hidden: ['calendar'] }, links: { links: [{ id: 'abcdefghij12', n: 'Library', u: 'https://library.example/', i: 'book' }] }, icons: { icons: { grades: 'star' } } };
  assert.deepEqual(Object.keys(nav).sort(), [...L.KEYS].sort(), 'a new key of a nav layout needs a sentence here');
  for (const [k, v] of Object.entries(nav)) assert.ok(said({ nav: L.clean(v) }).length, `x.nav.${k} says nothing`);
  // Rules, by what they do and by each style key. A show rule alone changes nothing: it only undoes a hide before it.
  const rules = { hide: { p: 'canvas.footer', do: 'hide' }, show: { p: 'canvas.footer', do: 'show' }, move: { p: 'canvas.course-nav.grades', do: 'move', to: 'canvas.course-nav.home', at: 'before' }, style: { p: 'canvas.footer', do: 'style', st: { r: 4 } }, label: { p: 'moodle.page-header.title', do: 'label', t: 'Hi' } };
  const silent = ['show'];
  assert.deepEqual(Object.keys(rules).sort(), [...X.RULE_DO].sort(), 'a new kind of rule needs a sentence here');
  for (const [k, r] of Object.entries(rules)) assert.equal(said({ rules: [r] }).length > 0, !silent.includes(k), `a ${k} rule`);
  assert.deepEqual(said({ rules: [rules.hide, rules.show] }), [], 'a hide undone says nothing');
  for (const k of GZ_PARTS.BOX) {
    const v = { bg: 'accent', fg: 'ink', bc: 'line', bw: 2, r: 4, p: 2, g: 2, sh: 1, o: 50, f: F.LIST[0].id }[k];
    assert.ok(said({ rules: [{ p: 'canvas.footer', do: 'style', st: { [k]: v } }] }).some((n) => n.vars?.parts?.includes('Footer')), `style ${k}`);
  }
  // Fading a part is said as such, whatever else the rule does to it.
  assert.deepEqual(said({ rules: [{ p: 'canvas.footer', do: 'style', st: { o: 0 } }] }).map(say), ['Makes 1 parts of your school pages see-through: Footer.']);
  // The account item has no name of Glaze's (it is the student's): it is named as the account.
  assert.ok(said({ nav: { hidden: ['profile', 'calendar'] } }).map(say).includes('Hides Your account, Calendar in the navigation.'));
});

test('a Look from someone else may not hide signing out or the account, link without https, or name a link as Glaze\'s own', () => {
  assert.deepEqual(X.outside(null), []);
  assert.deepEqual(X.outside({ x: { nav: { hidden: ['grades', 'calendar'], links: [{ id: 'abcdefghij12', n: 'Library', u: 'https://library.example/', i: 'book' }] } } }), [], 'what is disclosed may be offered');
  const why = (P) => X.outside(P).map(say);
  assert.deepEqual(why(PHISH), [
    'It hides Sign out, which only you can hide.',
    'Its link Grades goes to grades-portal.example without https.',
    'Its link Grades could pass for a navigation item it hides.',
    'Its link Sign out could pass for signing out or Glaze settings.',
  ]);
  assert.deepEqual(why({ x: { nav: { hidden: ['profile', 'logout'] } } }), ['It hides Your account, Sign out, which only you can hide.']);
  for (const n of ['Abmelden', 'Glaze settings', ' LOG out ']) assert.equal(why({ x: { nav: { links: [{ id: 'abcdefghij12', n, u: 'https://a.example/', i: 'link' }] } } }).length, 1, n);
  // The student's own Look may do either: it is stored and worn as before.
  const own = { x: { nav: { hidden: ['logout', 'profile'], links: [{ id: 'abcdefghij12', n: 'Old intranet', u: 'http://intranet.example/', i: 'link' }] } } };
  assert.ok(X.same(X.bundle(own), own));
});

// The editor's offer (options.js tryCode), run over the code as a gallery Look, a Look share or a pasted code reaches it.
const offer = async (code) => {
  const source = read('options.js');
  const section = source.slice(source.indexOf('  const tryCode ='), source.indexOf("  $('#share-try').addEventListener"));
  const notes = [], paints = [], hints = [];
  const controls = {
    '#share-code': { value: code }, '#share-offer': {},
    '#share-what': { replaceChildren() {}, append: (...xs) => notes.push(...xs.map((x) => x.textContent ?? x)) },
  };
  const context = vm.createContext({
    GZ_SHARE: S, GZ_XPARTS: X, GZ_PARTS, GZ_SANITIZE: D.GZ_SANITIZE, GZ_MATCH_PRESET: D.GZ_MATCH_PRESET,
    GZ_CARDS, GZ_FONTS: F, GZ_I18N: { ui: () => 'en', locale: () => 'en' },
    s: D.GZ_SANITIZE(), offer: null, from: null, offerFile: '', offerGeneration: 0, letGo() {}, URL, Intl,
    $: (id) => controls[id], document: { createElement: () => ({}) }, fontName: (f) => f.name,
    t: (s, vars = {}) => s.replace(/\{(\w+)(?:\|\w+)?\}/g, (_, k) => vars[k]),
    endOffer() {}, hint: (...xs) => hints.push(xs), preview() {}, GZ_UI: { paint: (s) => paints.push(s) },
  });
  await vm.runInContext(section + '\ntryCode();', context);
  return { text: notes.join(' '), paints, hints, offer: context.offer };
};

test("the editor refuses the audit's Look and says why; a Look that may be offered shows everything it does", async () => {
  const refused = await offer(await phishCode());
  assert.equal(refused.paints.length, 0, 'nothing previewed');
  assert.equal(refused.hints.length, 1);
  assert.equal(refused.hints[0][1], true, 'said as a refusal');
  assert.match(refused.hints[0][0], /^Glaze won't use this Look\. It hides Sign out, /);
  for (const s of ['Its link Grades goes to grades-portal.example without https.', 'Its link Sign out could pass']) assert.ok(refused.hints[0][0].includes(s), s);
  // The same Look without what it may not do: offered, and every hidden item, link host and part named.
  const safe = structuredClone(PHISH);
  safe.x.nav.hidden = ['grades'];
  safe.x.nav.links = [{ id: 'abcdefghijkl', n: 'Library', u: 'https://grades-portal.example/login', i: 'star' }];
  safe.x.nav.groups[0].items = safe.x.nav.groups[0].items.filter((id) => id !== 'link:mnopqrstuvwx');
  const shown = await offer(await S.encode(D.GZ_SANITIZE({}), {}, safe));
  assert.equal(shown.hints.length, 0);
  assert.equal(shown.paints.length, 1);
  for (const s of ['Hides Grades in the navigation.', 'Adds a link: Library → grades-portal.example.', 'Announcements in the course menu', 'Assignments in the course menu', '“Session expired: sign in again from the Grades link”']) assert.ok(shown.text.includes(s), s);
});

test('hidden-native name matching follows every shipped catalogue', () => {
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) require(`../i18n/${lang}.js`);
  for (const [id, name] of Object.entries({ ...L.NAMES, profile: 'Your account' })) {
    for (const c of Object.values(GZ_LANGS)) assert.ok(L.mimics(c[name] || name, [id]), `${id}: ${c[name] || name}`);
  }
});

test("a worn Look's links say which site they go to; the student's own links and the school's pages don't", () => {
  const ULTRA = ['institution-page', 'course', 'grades', 'logout'].map((id) => ({ id, label: id, href: `https://school.test/ultra/${id}` }));
  const look = L.clean({ hidden: ['grades'], links: [{ id: 'aaaaaaaaaaaa', n: 'Grades', u: 'https://grades-portal.example/login', i: 'star' }, { id: 'bbbbbbbbbbbb', n: 'Calendar', u: 'https://school.test/ultra/calendar', i: 'calendar' }] });
  const prefs = M.clean({ links: [{ id: 'cccccccccccc', n: 'Wiki', u: 'https://wiki.example/', i: 'globe' }] });
  const m = M.build({ native: ULTRA, look, prefs, origin: 'https://school.test' });
  const item = (id) => m.items.find((i) => i.id === id);
  assert.equal(item('link:aaaaaaaaaaaa').from, 'grades-portal.example');
  assert.equal(item('link:bbbbbbbbbbbb').from, undefined, "a page of the school's site needs no word");
  assert.equal(item('link:cccccccccccc').from, undefined, "the student's own link is theirs");
  // Without a site to compare (the editor), every Look link says where it goes.
  assert.equal(M.build({ native: ULTRA, look }).items.find((i) => i.id === 'link:bbbbbbbbbbbb').from, 'school.test');
  // The older rail without a layout (the student's own Ultra links) says nothing.
  assert.equal(M.build({ native: ULTRA, legacy: { links: [{ id: 'dddddddddddd', n: 'Docs', u: 'https://docs.example/', i: 'doc' }], order: [], hidden: [], widgets: [] } }).items.find((i) => i.id === 'link:dddddddddddd').from, undefined);
});

test("Glaze's bar draws a Look's link with its host in the tooltip and the accessible name", () => {
  const src = read('features/navbar.js');
  const el = (tag) => ({ tag, attrs: {}, dataset: {}, kids: [], style: { setProperty() {} }, setAttribute(k, v) { this.attrs[k] = String(v); }, append(...k) { this.kids.push(...k); } });
  const ctx = vm.createContext({
    make: (tag, props = {}, ...kids) => { const e = Object.assign(el(tag), props); e.append(...kids.filter((k) => k != null)); return e; },
    part: (e, name) => { e.setAttribute('part', name); return e; }, put: (e, ...kids) => { e.append(...kids.filter((k) => k != null)); return e; },
    icon: () => null, settings: () => ({ badges: true }), t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]),
  });
  const api = vm.runInContext(`${src.slice(src.indexOf('  const badge = (text) =>'), src.indexOf('  const initials ='))}\n({ node, barItem });`, ctx);
  const look = api.barItem({ id: 'link:aaaaaaaaaaaa', label: 'Grades', icon: 'star', href: 'https://grades-portal.example/login', from: 'grades-portal.example' }, 0);
  assert.equal(look.attrs['aria-label'], 'Grades · From grades-portal.example');
  assert.equal(look.attrs.title, 'From grades-portal.example');
  assert.equal(look.dataset.tip, 'Grades · From grades-portal.example');
  const own = api.barItem({ id: 'grades', label: 'Grades', icon: 'grades', href: 'https://school.test/ultra/grades' }, 0);
  assert.deepEqual([own.attrs['aria-label'], own.attrs.title, own.dataset.tip], [undefined, undefined, 'Grades']);
  // The phone's tabs, the More sheet and menus draw through the same node().
  assert.equal(api.node({ id: 'link:aaaaaaaaaaaa', label: 'Grades', href: 'https://grades-portal.example/login', from: 'grades-portal.example' }, 'tab', 'tab').attrs['aria-label'], 'Grades · From grades-portal.example');
  // The bar passes the page's site, so a Look's link back to the school's own pages isn't marked.
  assert.match(src, /model = M\.build\(\{[^;]*, origin: location\.origin \}\);/);
});

test("the older rail names a worn Look's link with its host, and leaves the student's own links as they are", () => {
  const src = read('features/nav.js');
  const line = src.slice(src.indexOf('  const linkName = '), src.indexOf('\n', src.indexOf('  const linkName = ')));
  const run = (layout) => vm.runInContext(`${line}\nlinkName`, vm.createContext({ layout, L, location: { origin: 'https://school.test' }, X: { t: (k, v) => k.replace('{name}', v.name) } }));
  const away = { id: 'aaaaaaaaaaaa', n: 'Grades', u: 'https://grades-portal.example/login', i: 'star' }, home = { id: 'bbbbbbbbbbbb', n: 'Calendar', u: 'https://school.test/calendar', i: 'calendar' };
  assert.equal(run({ links: [away, home] })(away), 'Grades · From grades-portal.example');
  assert.equal(run({ links: [away, home] })(home), 'Calendar');
  assert.equal(run(null)(away), 'Grades', "the student's own Ultra links are theirs");
  assert.match(src, /a\.title = name; a\.setAttribute\('aria-label', name\);/);
});

test('the Navigation editor shows what the worn Look hides as hidden, and its links with their hosts', () => {
  const look = L.clean({ hidden: ['grades', 'stream'], links: [{ id: 'aaaaaaaaaaaa', n: 'Grades', u: 'https://grades-portal.example/login', i: 'star' }] });
  const items = (prefs, o) => E.rows(prefs, o).flatMap((g) => g.items);
  const worn = items({}, { look });
  assert.deepEqual(worn.filter((i) => i.hidden).map((i) => i.id), ['stream', 'grades']);
  const link = worn.find((i) => i.id === 'link:aaaaaaaaaaaa');
  assert.deepEqual([link.name, link.from, link.own], ['Grades', 'grades-portal.example', false]);
  // The student's own choice still wins.
  assert.equal(items({ items: { grades: { hidden: false } } }, { look }).find((i) => i.id === 'grades').hidden, false);
  assert.equal(items({}).find((i) => i.id === 'grades').hidden, false, 'no Look, nothing hidden');
  // The editor hands it the Look being worn, while Glaze is on.
  const src = read('lib/editor-navbar.js');
  assert.match(src, /const worn = \(\) => \(settings\(\)\.enabled !== false \? settings\(\)\.parts\?\.x\?\.nav \|\| null : null\);/);
  assert.equal((src.match(/rows\(prefs, \{ legacy, look: worn\(\), names \}\)/g) || []).length, 2, 'the list and the link form');
});
