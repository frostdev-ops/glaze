// Mods and Glaze's bar: the nav.read, nav.items and nav.layout permissions in the manifest checker, the broker, the item
// cleaner, the editor's words and the bar's model. The page side (features/mods.js) is in mods-runtime.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/modbundle.js');
const B = require('../lib/modbroker.js');
const A = require('../lib/modapi.js');
const E = require('../lib/editor-mods.js');
const NB = require('../lib/navbar.js');

const u8 = (s) => new TextEncoder().encode(s);
const BASE = { glaze: 1, name: 'Tiny', version: '1.0.0', author: { name: 'Kai', key: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' } };
const man = (patch, files = [['hooks.js', u8('1')]]) => M.bundle([['mod.json', u8(JSON.stringify({ ...BASE, hooks: 'hooks.js', ...patch }))], ...files]);
const perms = (...ids) => ids.map((id) => ({ id, why: 'x' }));

test('the manifest takes nav.read, nav.items and nav.layout; nav.read is personal data, with no page of its own', async () => {
  const got = await man({ permissions: perms('nav.read', 'nav.items', 'nav.layout') });
  assert.deepEqual(M.caps(got.manifest), ['nav.read', 'nav.items', 'nav.layout']);
  for (const id of ['nav', 'nav.write', 'nav.replace', 'NAV.READ']) await assert.rejects(man({ permissions: perms(id) }), /permissions\.0\.id/);
  await assert.rejects(man({ permissions: perms('nav.read', 'nav.read') }), /permissions\.1\.id/);
  const page = ['tile.html', u8('<p>')];
  await assert.rejects(man({ permissions: perms('nav.read') }, [['hooks.js', u8('1')], page]), /\(ui\)/, 'no HTML file with nav.read');
  assert.ok(await man({ permissions: perms('nav.items', 'nav.layout') }, [['hooks.js', u8('1')], page]), 'the other two are not personal data');
  assert.ok(M.DATA.includes('nav.read') && B.declares({ manifest: { permissions: perms('nav.read') } }, ['nav.read']));
});

const ID = 'abcdefghijklmnop', SITE = 'https://school.test';
const env = (manifest, grants, local = {}) => {
  const data = { [`mod:${ID}`]: { id: ID, enabled: true, manifest, grants }, mods: [ID], ...local };
  let turn = Promise.resolve();
  return { data, site: SITE, local: { get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])), set: async (p) => { Object.assign(data, p); return true; } },
    sync: { get: async () => ({}) }, queue: (f) => (turn = turn.then(f, f)), keys: async () => Object.keys(data), record: async (id) => data[`mod:${id}`], blocklist: async () => null };
};
const call = (e, name, args = [], via = 'worker') => B.handle({ mod: ID, call: name, args, via }, e);

test('each nav call needs its permission declared and granted; nav.read is for a Worker only, and stays so', async () => {
  const all = perms('nav.read', 'nav.items', 'nav.layout');
  const item = { id: 'due', label: 'Due', action: true };
  for (const [name, args, perm] of [['nav.model', [], 'nav.read'], ['nav.add', [item], 'nav.items'], ['nav.update', ['due', { label: 'X' }], 'nav.items'], ['nav.remove', ['due'], 'nav.items'], ['nav.layout', [{ hidden: ['calendar'] }], 'nav.layout']]) {
    assert.equal((await call(env({}, {}), name, args)).error, 'permission', `${name} undeclared`);
    assert.equal((await call(env({ permissions: all }, {}), name, args)).error, 'permission', `${name} not granted`);
    assert.equal((await call(env({ permissions: all }, { [perm]: true }), name, args)).ok, true, name);
  }
  const e = env({ permissions: all }, { 'nav.read': true, 'nav.items': true });
  assert.equal((await call(e, 'nav.model', [], 'frame:tile:x')).error, 'permission', 'a frame never reads the bar');
  assert.equal((await call(e, 'nav.add', [item], 'frame:tile:x')).error, 'permission', 'and a mod declaring it has no frames at all');
  await call(e, 'nav.model');
  assert.equal(e.data[`modPrivate:${ID}`], true, 'Worker-only through updates once it read the bar');
});

test('nav.add: an item of the mod\'s own, its link only to this site, its icon one of the bar\'s', async () => {
  const e = env({ permissions: perms('nav.items') }, { 'nav.items': true });
  assert.deepEqual((await call(e, 'nav.add', [{ id: 'due', label: ' Due  soon ', icon: 'skull', href: '/calendar?x=1', badge: 3, group: 'Main' }])).value,
    { id: 'due', label: 'Due soon', icon: 'link', href: 'https://school.test/calendar?x=1', badge: 3, group: 'Main' });
  for (const bad of [{ id: 'a', label: 'x', href: 'https://evil.test/login' }, { id: 'a', label: 'x', href: '//evil.test/' }, { id: 'a', label: 'x', href: 'javascript:alert(1)' }, { id: 'a', label: 'x', href: 'https://u:p@school.test/' },
    { id: 'a', label: 'x' }, { id: 'a', label: 'x', href: '/a', action: true }, { id: 'a', label: 'x', action: false }, { id: 'a', label: 'x', action: true, group: 0, slot: 'top' }, { id: 'a', label: 'x'.repeat(41), action: true },
    { id: 'a', label: 'one\ntwo'.repeat(10), action: true }, { id: 'a', label: 'x', action: true, badge: 'toolong' }, { id: 'a', label: 'x', action: true, group: 8 }, { id: 'a', label: 'x', action: true, slot: 'side' },
    { id: 'Bad', label: 'x', action: true }, { id: 'a', label: 'x', action: true, owner: 'other' }, null]) assert.equal((await call(e, 'nav.add', [bad])).error, 'args', JSON.stringify(bad));
  assert.deepEqual((await call(e, 'nav.update', ['due', { badge: '' }])).value, { id: 'due', patch: { badge: '' } });
  assert.equal((await call(e, 'nav.update', ['due', { id: 'x' }])).error, 'args', 'a patch can\'t rename');
  // Every icon the bar draws, but the two only Glaze's own items wear (NAV-8).
  assert.deepEqual(A.NAV_ICONS, NB.PICKS.filter((k) => !['glaze', 'signout'].includes(k)), 'the bar\'s icons but Glaze\'s own');
  assert.deepEqual(A.NAV_ICONS, NB.MOD_PICKS, 'the worker and the bar agree');
});

// A layout from a mod's code (MOD-1, audit navexfil.js): a mod granted only grades put them in a link's address and sent
// the student off-site with them, with no network permission and no nav.layout.
const LINK = (u, id = 'gradesgrades') => ({ id, n: 'Grades', u, i: 'star' });
test('a layout from code needs nav.layout: glaze.nav.items\' answer and a nav in look.override, as glaze.nav.layout; withdrawing needs none', async () => {
  const layout = { hidden: ['grades'], links: [LINK(`${SITE}/grades`)] };
  for (const [manifest, grants] of [[{ permissions: perms('grades') }, { grades: true }], [{ permissions: perms('grades', 'nav.layout') }, { grades: true }]]) {
    const e = env(manifest, grants);
    assert.deepEqual(await call(e, 'nav.set', [layout]), { ok: false, error: 'permission' }, 'nav.set');
    assert.deepEqual(await call(e, 'look.override', [{ nav: layout }]), { ok: false, error: 'permission' }, 'look.override with a nav');
    assert.deepEqual(await call(e, 'look.override', [{ nav: layout, cursor: { kind: 'trail' } }]), { ok: false, error: 'permission' }, 'none of it applies');
    assert.deepEqual(await call(e, 'look.override', [{ cursor: { kind: 'trail' } }]), { ok: true, value: { cursor: { kind: 'trail' } } }, 'other parts need none');
    assert.deepEqual(await call(e, 'nav.set', [null]), { ok: true, value: null }, 'a transform that gives nothing withdraws, which needs none');
  }
  const e = env({ permissions: perms('grades', 'nav.layout') }, { grades: true, 'nav.layout': true });
  assert.deepEqual(await call(e, 'nav.set', [layout]), { ok: true, value: layout });
  assert.deepEqual(await call(e, 'look.override', [{ nav: layout }]), { ok: true, value: { nav: layout } });
});

test('a layout from code links only to pages of this school\'s site, or the whole call is refused; a bundle\'s static parts.nav may link anywhere', async () => {
  const e = env({ permissions: perms('grades', 'nav.layout') }, { grades: true, 'nav.layout': true });
  const own = LINK(`${SITE}/ultra/grades?view=all`);
  const away = (u) => ({ hidden: ['grades'], links: [own, LINK(u, 'elsewhere000')] });
  for (const u of ['https://evil.example/r?d=%5B%7B%22percent%22%3A91.5%7D%5D', 'http://school.test/grades', 'https://school.test:8443/grades', 'https://school.test.evil.example/', 'https://evil.example/@school.test/']) {
    for (const [name, args] of [['nav.set', [away(u)]], ['nav.layout', [away(u)]], ['look.override', [{ nav: away(u), cursor: { kind: 'trail' } }]]]) {
      assert.deepEqual(await call(e, name, args), { ok: false, error: 'args' }, `${name} ${u}`);
    }
  }
  assert.deepEqual((await call(e, 'nav.set', [{ links: [own] }])).value, { links: [own] }, 'a page of this site is fine');
  assert.deepEqual((await call(e, 'nav.layout', [{ links: [own] }])).value, { links: [own] });
  assert.deepEqual((await call(e, 'look.override', [{ nav: { links: [own] } }])).value, { nav: { links: [own] } });
  // A bundle's own parts.nav is fixed in its signed files, so it carries nothing of the student's.
  const parts = { nav: { hidden: ['calendar'], links: [LINK('https://library.example/', 'libraryaaaaa')] } };
  assert.deepEqual((await B.page({ op: 'parts' }, env({ parts }, {}))).parts, [parts], 'static parts.nav is as it was');
});

// NAV-8 (audit repro1.js): a mod's item drawn exactly as Glaze's own "Glaze settings" or "Sign out".
const RESERVED = ['Glaze settings', 'Sign out'];
test('reserved names reject Latin-looking Cyrillic and Greek letters through the broker and bar', async () => {
  const e = env({ permissions: perms('nav.items') }, { 'nav.items': true });
  for (const label of ['Glаze settings', 'Glaze settіngs', 'Sіgn оut', 'Lοg out', 'Ｇlаze settings']) {
    assert.equal((await call(e, 'nav.add', [{ id: 'fake', label, action: true }])).error, 'args', label);
    assert.equal((await call(e, 'nav.update', ['fake', { label }])).error, 'args', `update ${label}`);
    assert.equal(NB.build({ native: [], mods: [{ owner: ID, id: `mod:${ID}.fake`, label, icon: 'settings' }] }).items.length, 0, `bar ${label}`);
  }
  assert.equal((await call(e, 'nav.add', [{ id: 'study', label: 'Моя учёба', action: true }])).ok, true, 'other-script names remain usable');
});
const translations = () => RESERVED.flatMap((k) => ['de', 'es', 'fr', 'nl', 'pt-BR'].map((lang) => { require(`../i18n/${lang}.js`); return globalThis.GZ_LANGS[lang][k]; }));
test('a mod\'s item can\'t pass for Glaze\'s own: not their icons, nor the names of Glaze settings or Sign out in any of Glaze\'s languages', async () => {
  const e = env({ permissions: perms('nav.items') }, { 'nav.items': true });
  for (const label of [...RESERVED, ...translations(), ' glaze   SETTINGS ', 'Sign-Out', 'signout', 'Log out', 'Logout', 'Glaze​settings', 'ＧＬＡＺＥ settings']) {
    assert.equal((await call(e, 'nav.add', [{ id: 'fake', label, action: true }])).error, 'args', label);
    assert.equal((await call(e, 'nav.update', ['fake', { label }])).error, 'args', `update: ${label}`);
  }
  for (const icon of ['glaze', 'signout']) assert.equal((await call(e, 'nav.add', [{ id: 'due', label: 'Due', icon, action: true }])).value.icon, 'link', icon);
  assert.deepEqual((await call(e, 'nav.add', [{ id: 'due', label: 'Settings', icon: 'gear', action: true }])).value, { id: 'due', label: 'Settings', icon: 'gear', action: true }, 'a word of its own is fine');
});

test('the bar leaves out a mod\'s item named as Glaze\'s own, as this page and the student name them too, and gives none their icons', () => {
  const m = (id, label, icon) => ({ owner: 'abcdefghijklmnop', id: `mod:abcdefghijklmnop.${id}`, label, icon, action: true, by: 'Evil' });
  // repro1.js: two identical items, Glaze's and the mod's.
  const spoof = NB.build({ native: [], prefs: NB.clean({ glaze: ['settings'] }), mods: [{ ...m('x', 'Glaze settings', 'glaze'), slot: 'top' }], names: { settings: 'Glaze settings' } });
  assert.deepEqual(spoof.items.map((i) => [i.id, i.label, i.icon]), [['glaze:settings', 'Glaze settings', 'glaze']]);
  const native = [{ id: 'course', label: 'Courses' }, { id: 'logout', label: 'Déconnexion' }];
  const prefs = NB.clean({ glaze: ['settings'], items: { 'glaze:settings': { label: 'My Glaze' } } });
  const bar = NB.build({ native, prefs, names: { settings: 'Réglages de Glaze' }, mods: [m('a', 'Sign out', 'star'), m('b', 'déconnexion', 'star'), m('c', 'my  glaze', 'star'), m('d', 'Réglages de Glaze', 'star'), m('e', 'Due', 'glaze'), m('f', 'Due soon', 'signout')] });
  assert.deepEqual(bar.items.filter((i) => i.owner).map((i) => [i.label, i.icon]), [['Due', 'link'], ['Due soon', 'link']]);
});

test('nav.go: only with the student\'s nav replacement switch on', async () => {
  const manifest = { ui: { nav: {} }, replaces: ['nav'] };
  assert.equal((await call(env(manifest, {}), 'nav.go', ['calendar'])).error, 'permission');
  assert.equal((await call(env(manifest, {}, { [`modReplace:${ID}`]: { nav: false } }), 'nav.go', ['calendar'])).error, 'permission');
  assert.deepEqual((await call(env(manifest, {}, { [`modReplace:${ID}`]: { nav: true } }), 'nav.go', ['calendar'])).value, { id: 'calendar' });
});

test('the runnable list says which mods the student told "Use my own"', async () => {
  const e = env({ hooks: 'hooks.js' }, {}, { [`modNavLayout:${ID}`]: false });
  e.data[`mod:${ID}`].files = { 'hooks.js': Buffer.from('1').toString('base64') };
  assert.equal((await B.page({ op: 'list' }, e)).mods[0].arranges, false);
  delete e.data[`modNavLayout:${ID}`];
  assert.equal((await B.page({ op: 'list' }, e)).mods[0].arranges, true);
});

test('Use my own also removes manifest navigation parts, leaving other parts intact', async () => {
  const parts = { nav: { hidden: ['calendar'] }, cursor: { kind: 'trail' } };
  const e = env({ parts }, {}, { [`modNavLayout:${ID}`]: false });
  assert.deepEqual((await B.page({ op: 'parts' }, e)).parts, [{ cursor: parts.cursor }]);
  assert.deepEqual(e.data[`mod:${ID}`].manifest.parts, parts, 'the installed manifest is unchanged');
  e.data[`modNavLayout:${ID}`] = true;
  assert.deepEqual((await B.page({ op: 'parts' }, e)).parts, [parts]);
});

test('the page refreshes installed parts when a navigation layout opt-out changes', () => {
  const fs = require('node:fs'), vm = require('node:vm'), source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const from = source.indexOf('    if (changes.lookX && area'), to = source.indexOf('    if (isPreview ||', from);
  let reads = 0;
  const changed = vm.runInNewContext(`(changes, area) => { ${source.slice(from, to)} }`, { modsIn: () => reads++, partsIn() {} });
  changed({ [`modNavLayout:${ID}`]: { newValue: false } }, 'local');
  assert.equal(reads, 1);
});

test('the prompt names each nav permission, and reading the bar counts as data a network host could get', () => {
  const t = (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]);
  for (const id of ['nav.read', 'nav.items', 'nav.layout']) assert.match(E.permText(id, t), /^Navigation/);
  const ws = E.warnings({ permissions: perms('nav.read', 'network:a.example') }, { t, signed: true, source: 'gallery', runs: true });
  assert.equal(ws[0].text, 'This mod could send your navigation to a.example.');
});

test('a mod\'s item goes to the group it names by id, label or place, or to a slot', () => {
  const prefs = NB.clean({ groups: [{ label: 'Study', items: ['course'] }, { label: 'Life', items: ['calendar'] }] });
  const native = [{ id: 'course', label: 'Courses' }, { id: 'calendar', label: 'Calendar' }];
  const m = (id, more) => ({ owner: 'abcdefghijklmnop', id: `mod:abcdefghijklmnop.${id}`, label: id, by: 'Garden', ...more });
  const bar = NB.build({ native, prefs, mods: [m('a', { group: 'Life' }), m('b', { group: 0 }), m('c', { slot: 'top' }), m('d', { group: 'g1' })] });
  assert.deepEqual(bar.groups.map((g) => g.items.map((i) => i.id.replace('mod:abcdefghijklmnop.', ''))), [['course', 'b'], ['calendar', 'a', 'd']]);
  assert.deepEqual(bar.slots.top.map((i) => i.by), ['Garden']);
});
