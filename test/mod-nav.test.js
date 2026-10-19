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
  assert.deepEqual(A.NAV_ICONS, NB.PICKS, 'the same icons as the bar');
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
