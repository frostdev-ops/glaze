// The Looks catalogue (lib/looks.js): built-in, saved and gallery Looks as one list with ids, and every reference to a Look by
// id (courses.looks, Look rotation), with old built-in names still read.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../defaults.js');
const C = require('../lib/looks.js');
const S = require('../lib/share.js');
const LX = require('../lib/lookx.js');
const H = require('../lib/history.js');

const look = (name) => G.GZ_LOOKS.find((L) => L.name === name);
const wear = (name, s = G.GZ_DEFAULTS) => G.GZ_SANITIZE({ ...s, ...G.GZ_LOOK_APPLY(s, look(name)) });
// A code as "Copy theme code" makes it, from settings and parts.
const code = (s, parts = null) => S.encode(s, {}, parts);
const fixtures = async () => {
  const mine = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Forest'), look: { radius: 3, font: 'inter' }, bg: { kind: 'gradient', colors: ['#112233', '#445566', '#778899'] } });
  const other = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Rose'), look: { radius: 18 }, bg: { kind: 'solid' } });
  const gallery = G.GZ_SANITIZE({ colors: G.GZ_PRESET('Ember'), look: { font: 'outfit', radius: 12 }, bg: { kind: 'gradient', style: 'mesh', colors: ['#f472b6', '#a78bfa', '#fb923c'] } });
  const animated = wear('Graveyard');
  return {
    settings: { mine, other, gallery, animated },
    favorites: [
      C.make(await code(mine), 'Study', '', 'saved'),
      // From before ids: no id, no from, no author (a pasted code).
      { code: await code(other), name: 'Library', author: '', at: 5 },
      C.make(await code(gallery), 'Sunset', 'mira', 'gallery'),
      // From before ids, from the gallery (it named an author): an animated background.
      { code: await code(animated, { x: { pointer: 'ghost' } }), name: 'Night walk', author: 'frostdev-ops', at: 4 },
      { code: 'glaze1:not-a-code', name: 'Broken', author: '', at: 3 },
    ],
  };
};

test('the catalogue: built-in, saved and gallery Looks and gallery backgrounds, each with an id, name, swatch and kind', async () => {
  const { favorites } = await fixtures();
  let decoded = 0;
  const decode = (c) => { decoded++; return S.decode(c); };
  const cat = await C.build(favorites, decode);
  assert.equal(cat.sig, C.sig(favorites));
  assert.deepEqual(cat.looks.map((E) => [E.name, E.kind]), [['Study', 'saved'], ['Library', 'saved'], ['Sunset', 'gallery'], ['Night walk', 'background']], 'a code that does not decode is left out');
  for (const E of cat.looks) assert.match(E.id, C.ID);
  assert.equal(cat.looks[1].id, C.idOf(favorites[1].code), 'one from before ids gets its id from its code');
  assert.equal(new Set(cat.looks.map((E) => E.id)).size, 4);
  assert.equal(cat.looks[2].author, 'mira');
  assert.deepEqual(cat.looks[0].colors, G.GZ_PRESET('Forest'));
  assert.deepEqual(C.tone(cat.looks[0]), ['#112233', '#445566', '#778899'], 'the swatch strip is its background\'s colors');
  assert.notEqual(cat.looks[3].px, '', 'parts are told apart by their hash');
  const all = C.list(cat);
  assert.equal(all.length, G.GZ_LOOKS.length + 4);
  assert.deepEqual(all.slice(0, G.GZ_LOOKS.length).map((E) => [E.id, E.kind]), G.GZ_LOOKS.map((L) => [L.name, 'builtin']), 'a built-in Look\'s id is its name');
  assert.deepEqual(C.groups(all).map(([g, l]) => [g, l.length]), [['builtin', G.GZ_LOOKS.length], ['saved', 2], ['gallery', 2]]);
  assert.deepEqual(C.groups(C.list(null)).map(([g]) => g), ['builtin'], 'no kept Looks: one group');
  // Rebuilt after a rename: the same ids, nothing decoded again.
  const was = decoded;
  const renamed = favorites.map((f, i) => (i === 0 ? { ...f, name: 'Finals' } : f));
  const again = await C.build(renamed, decode, cat);
  assert.equal(decoded - was, 1, 'only the code that never decoded is tried again');
  assert.equal(again.looks[0].name, 'Finals');
  assert.deepEqual(again.looks.map((E) => E.id), cat.looks.map((E) => E.id), 'a rename keeps the id');
  // The same code saved twice is one Look; a stored catalogue that isn't one reads as none.
  assert.equal((await C.build([...favorites, { ...favorites[0], name: 'Copy' }], S.decode)).looks.length, 4);
  for (const bad of [null, 'x', { looks: 'x' }, { looks: [{ id: 'Library', name: 'x', colors: {}, look: {}, bg: {} }] }]) assert.deepEqual(C.looks(bad), []);
});

test('which Look is worn: a kept Look as its code wears it, parts and all; a built-in as before', async () => {
  const { favorites } = await fixtures();
  const cat = await C.build(favorites, S.decode), all = C.list(cat);
  const s = G.GZ_SANITIZE({ look: { tooltips: false } });
  const got = await S.decode(favorites[2].code);
  const worn = { ...G.GZ_SANITIZE({ ...s, ...LX.wearCode(s, got) }), parts: got.parts };
  assert.equal(C.worn(worn, all)?.id, cat.looks[2].id);
  // As Chrome hands the stored catalogue back: every object's keys sorted.
  const sorted = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v)));
  assert.notEqual(JSON.stringify(sorted(cat).looks[2].colors), JSON.stringify(cat.looks[2].colors));
  assert.equal(C.worn(worn, C.list(sorted(cat)))?.id, cat.looks[2].id, 'read back from storage, still the Look worn');
  assert.equal(worn.look.tooltips, false, 'tooltips stay the student\'s');
  assert.equal(C.worn({ ...worn, look: { ...worn.look, radius: 2 } }, all), null, 'changed since: none');
  assert.equal(C.worn({ ...worn, parts: { x: { pointer: 'ghost' } } }, all), null, 'other parts: another Look');
  const bg = await S.decode(favorites[3].code);
  assert.equal(C.worn({ ...G.GZ_SANITIZE({ ...s, ...LX.wearCode(s, bg) }), parts: bg.parts }, all)?.name, 'Night walk', 'the kept Look before the built-in it was made from');
  assert.equal(C.worn(wear('Terminal'), all)?.id, 'Terminal');
  assert.equal(C.find(all, 'Terminal').L, look('Terminal'));
  assert.equal(C.find(all, 'c:00000000000000'), null);
});

test('a course wears a kept Look by id; an old built-in name still reads; a missing Look falls back to the student\'s theme', async () => {
  const { favorites, settings } = await fixtures();
  const cat = await C.build(favorites, S.decode), saved = C.looks(cat);
  const study = cat.looks[0].id, lib = cat.looks[1].id;
  const s = G.GZ_SANITIZE({ preset: 'Ember', colors: G.GZ_PRESET('Ember'), look: { tooltips: false }, bg: { image: 'https://pics.school.test/a.png' }, courses: { looks: { _1_1: 'Library', _2_1: study, _3_1: lib, _4_1: 'c:00000000000000', _5_1: 'c:bad', _6_1: 'Nope' } } });
  assert.deepEqual(s.courses.looks, { _1_1: 'Library', _2_1: study, _3_1: lib, _4_1: 'c:00000000000000' }, 'built-in names and kept ids are kept, on every device; anything else goes');
  // A saved Look named like a built-in is still its own: the name maps to the built-in, the id to the saved one.
  assert.ok(G.GZ_LOOK_ON(G.GZ_COURSE_LOOK(s, '_1_1', saved), look('Library')));
  const mine = G.GZ_COURSE_LOOK(s, '_2_1', saved);
  assert.deepEqual(mine.colors, settings.mine.colors);
  assert.equal(mine.look.radius, 3);
  assert.equal(mine.bg.image, 'https://pics.school.test/a.png', 'what its code doesn\'t carry stays the student\'s');
  assert.equal(mine.look.tooltips, false);
  assert.deepEqual(mine.bg.colors, settings.mine.bg.colors);
  assert.equal(mine.preset, 'Forest');
  assert.equal(mine.auto.on, false);
  assert.ok(C.on(mine, cat.looks[0]));
  assert.deepEqual(G.GZ_COURSE_LOOK(s, '_3_1', saved).colors, settings.other.colors);
  // On a device without that Look (it lives in storage.local), or once it is removed: the student's theme.
  for (const cid of ['_4_1', '_2_1']) assert.equal(G.GZ_COURSE_LOOK(s, cid, cid === '_2_1' ? [] : saved), s);
  assert.equal(G.GZ_COURSE_LOOK(s, '_2_1'), s, 'no catalogue given: the student\'s theme');
  assert.equal(G.GZ_COURSE_LOOK(s, undefined, saved), s);
});

test('removing a kept Look takes it off the courses that wore it, and nothing else', async () => {
  const { favorites } = await fixtures();
  const cat = await C.build(favorites, S.decode);
  const [study, lib] = cat.looks.map((E) => E.id);
  const courses = G.GZ_SANITIZE({ courses: { looks: { _1_1: study, _2_1: lib, _3_1: study, _4_1: 'Terminal' } } }).courses;
  assert.equal(C.unmap(courses, study), true);
  assert.deepEqual(courses.looks, { _2_1: lib, _4_1: 'Terminal' });
  assert.equal(C.unmap(courses, study), false, 'none left to take off');
  // Once its favorite is gone, the catalogue no longer has it, so a course still naming it wears the theme.
  const left = await C.build(favorites.slice(1), S.decode, cat);
  assert.equal(C.find(C.list(left), study), null);
});

test('Look rotation ticks by id: an old tick by code reads as its Look\'s id; a removed one is passed over', async () => {
  const { favorites } = await fixtures();
  const kept = C.keptAll(favorites);
  const chosen = ['Library', favorites[1].code, kept[0].id, 'glaze1:gone', 7];
  const ids = C.ids(chosen, favorites);
  assert.deepEqual(ids, ['Library', kept[1].id, kept[0].id, 'glaze1:gone', 7]);
  const names = G.GZ_LOOKS.map((L) => L.name);
  assert.deepEqual(LX.rotation(ids, names, kept.map((e) => e.id)), ['Library', kept[1].id, kept[0].id]);
  assert.deepEqual(LX.rotation([kept[0].id], names, []), names, 'its Look removed: every built-in Look');
});

test('a kept Look made now carries its id and where it came from, and favorites keep one per code', async () => {
  const { favorites } = await fixtures();
  const f = C.make(favorites[0].code, 'Again', 'x', 'gallery');
  assert.equal(f.id, C.idOf(f.code));
  assert.equal(f.from, 'gallery');
  assert.deepEqual(H.favor(favorites, f).filter((x) => x.code === f.code), [f]);
  assert.equal(C.kept({ ...favorites[1], id: 'nope' }).id, C.idOf(favorites[1].code), 'a stored id that isn\'t one is made again from the code');
  assert.equal(C.kept({ code: 'glaze1:a', name: 'n', from: 'saved', author: 'someone' }).from, 'saved');
  assert.equal(C.kept({ code: 1, name: 'n' }), null);
});

test('kept identity follows the code even when an old entry carries another valid id', async () => {
  const { favorites } = await fixtures();
  const first = favorites[0], second = favorites[2];
  assert.equal(C.kept({ ...first, id: second.id }).id, C.idOf(first.code));
  assert.equal(C.keptAll([first, { ...first, id: second.id, name: 'Alias' }]).length, 1, 'same code, two names and stored ids: one Look');
  assert.equal(C.keptAll([first, { ...second, id: first.id }]).length, 2, 'different codes never discard one another because of stored ids');
});

test('an ambiguous code hash is refused rather than wearing or removing another Look', () => {
  // Force the rare hash collision at the identity boundary; both original favorites must survive outside the catalogue.
  const context = vm.createContext({ GZ_LOOKS: G.GZ_LOOKS, GZ_LOOK_ON: G.GZ_LOOK_ON });
  vm.runInContext(read('lib/looks.js').replace('`c:${hash(code)}`', "'c:00000000000000'"), context);
  const favorites = [{ code: 'first', name: 'One' }, { code: 'second', name: 'Two' }];
  assert.equal(context.GZ_CATALOG.keptAll(favorites).length, 0, 'neither ambiguous id may be picked');
  assert.equal(favorites.length, 2, 'originals stay available for recovery');
});

// ---- the worker: the catalogue it keeps, wearing a kept Look by id, rotation by id ------------------------------------------
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const worker = (local = {}, syncStore = {}) => {
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  const changed = [], installed = [], messages = [];
  const area = (s, name) => ({
    get: (k) => later(() => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: (v) => later(() => { const was = structuredClone(s); Object.assign(s, structuredClone(v)); for (const f of changed) f(Object.fromEntries(Object.keys(v).map((k) => [k, { oldValue: was[k], newValue: s[k] }])), name); }),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete s[x]; }),
  });
  const context = vm.createContext({
    URL, console: { ...console, warn() {} }, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'),
        onMessage: { addListener: (f) => messages.push(f) }, onInstalled: { addListener: (f) => installed.push(f) }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(local, 'local'), sync: area(syncStore, 'sync'), onChanged: { addListener: (f) => changed.push(f) } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    let kept = false;
    for (const f of messages) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  const until = async (fn) => { for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); return fn(); };
  return { send, local, sync: syncStore, until, chrome: context.chrome, set: context.chrome.storage.local.set, install: () => { for (const f of installed) f({ reason: 'update' }); }, popup: { id: 'glaze', url: 'chrome-extension://x/popup.html' } };
};

test('the worker keeps the catalogue: built on update, again when a Look is saved, renamed or removed', async () => {
  const { favorites } = await fixtures();
  const w = worker({ lookFavorites: favorites.slice(0, 2) });
  w.install();
  assert.ok(await w.until(() => w.local.lookCatalog?.looks?.length === 2), 'built on update from what was kept before');
  const [study] = w.local.lookCatalog.looks.map((E) => E.id);
  // Saved, renamed, removed: each a write of lookFavorites, as Settings makes it.
  await w.set({ lookFavorites: favorites });
  assert.ok(await w.until(() => w.local.lookCatalog.looks.length === 4));
  await w.set({ lookFavorites: favorites.map((f, i) => (i === 0 ? { ...f, name: 'Finals' } : f)) });
  assert.ok(await w.until(() => w.local.lookCatalog.looks[0].name === 'Finals'));
  assert.equal(w.local.lookCatalog.looks[0].id, study, 'renamed, the same Look');
  await w.set({ lookFavorites: favorites.slice(1) });
  assert.ok(await w.until(() => w.local.lookCatalog.looks.length === 3 && !w.local.lookCatalog.looks.some((E) => E.id === study)));
});

test('Settings wakes the worker to build the catalogue where the storage change alone would not; a page cannot ask', async () => {
  const { favorites } = await fixtures();
  const w = worker();
  w.local.lookFavorites = favorites; // written as a browser that doesn't wake the worker for it: no change heard
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'build' }, { id: 'glaze', tab: {}, url: 'https://school.instructure.com/courses/1' }), { ok: false, error: 'sender' });
  assert.equal(w.local.lookCatalog, undefined);
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'build' }, { id: 'glaze', tab: {}, frameId: 0, url: 'chrome-extension://x/options.html' }), { ok: true });
  assert.equal(w.local.lookCatalog?.looks?.length, 4);
});

test('a kept Look put on by id from the popup wears its code as "Use this theme" does; a page elsewhere cannot', async () => {
  const { favorites, settings } = await fixtures();
  const w = worker({ lookFavorites: favorites }, structuredClone(G.GZ_SANITIZE({ look: { tooltips: false }, navbar: { on: false } })));
  const night = C.kept(favorites[3]);
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'wear', id: night.id }, { id: 'glaze', tab: {}, url: 'https://evil.example/' }), { ok: false, error: 'sender' });
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'wear', id: 'c:00000000000000' }, w.popup), { ok: false, error: 'gone' });
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'wear', id: night.id }, w.popup), { ok: true });
  const s = G.GZ_SANITIZE(w.sync);
  assert.deepEqual(s.colors, settings.animated.colors);
  assert.equal(s.bg.scene, 'graveyard');
  assert.equal(s.look.tooltips, false, 'tooltips stay the student\'s');
  assert.equal(s.navbar.on, false, 'whether the bar is on stays the student\'s');
  assert.ok(w.sync.lookX, 'its parts went with it');
  const got = await S.decode(favorites[3].code);
  const parts = await require('../lib/lookparts.js').fromStored(w.sync.lookX, { get: async () => ({}) });
  assert.deepEqual(parts, got.parts);
  const cat = await C.build(favorites, S.decode);
  assert.equal(C.worn({ ...s, parts }, C.list(cat))?.id, night.id, 'and it is the Look the picker shows pressed');
});

test('rotation turns to a kept Look ticked by id, and one ticked by its code before ids', async () => {
  const { favorites, settings } = await fixtures();
  for (const tick of [C.kept(favorites[0]).id, favorites[0].code]) {
    const w = worker({ lookFavorites: favorites, rotateLooks: [tick], rotateState: { mode: '6h 08:00', at: 1, i: -1 } }, G.GZ_SANITIZE({ extras: { rotate: '6h' } }));
    assert.deepEqual(await w.send({ type: 'glaze:rotate' }, w.popup), { ok: true });
    assert.deepEqual(G.GZ_SANITIZE(w.sync).colors, settings.mine.colors, tick.slice(0, 8));
  }
});

test('lib/looks.js loads on demand as the worker injects it: it ends on a value, and a second injection keeps the first', () => {
  const context = vm.createContext({ GZ_LOOKS: G.GZ_LOOKS, GZ_LOOK_ON: G.GZ_LOOK_ON });
  const first = vm.runInContext(read('lib/looks.js'), context);
  assert.ok(first, 'no last value: the worker would answer "did not finish"');
  assert.equal(vm.runInContext(read('lib/looks.js'), context), first);
  assert.equal(vm.runInContext('GZ_CATALOG', context).list().length, G.GZ_LOOKS.length);
});

test('a course page asks the worker for its Look\'s parts by id: a kept Look\'s from its code, a built-in\'s own', async () => {
  const { favorites } = await fixtures();
  const shader = fs.readFileSync(path.join(__dirname, '..', 'assets/shaders/aurora.glsl'), 'utf8');
  const gallery = C.make(await S.encode(G.GZ_SANITIZE({ colors: G.GZ_PRESET('Midnight'), bg: { kind: 'shader' } }), {}, { x: { bg: { shader: { src: shader } }, pointer: 'lava' } }), 'Shader night', 'mira', 'gallery');
  const w = worker({ lookFavorites: [gallery, ...favorites] });
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'parts', id: gallery.id }, { id: 'glaze', tab: {}, url: 'https://evil.example/' }), { ok: false, error: 'sender' });
  // The page in this harness isn't a registered LMS page either: Glaze's own pages ask the same way.
  const got = await w.send({ type: 'glaze:looks', op: 'parts', id: gallery.id }, w.popup);
  assert.equal(got.ok, true);
  assert.deepEqual(got.parts, (await S.decode(gallery.code)).parts);
  assert.equal(got.parts.x.pointer, 'lava');
  assert.ok(got.parts.x.bg.shader.src.length > 100, 'the shader comes with it');
  assert.deepEqual((await w.send({ type: 'glaze:looks', op: 'parts', id: 'Graveyard' }, w.popup)).parts, require('../lib/lookset.js')(look('Graveyard')));
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'parts', id: 'c:00000000000000' }, w.popup), { ok: false, error: 'gone' });
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'parts', id: 'Nope' }, w.popup), { ok: false, error: 'sender' });
});

test('two Settings tabs keep and remove Looks through one worker turn without losing another tab’s changes', async () => {
  const { favorites } = await fixtures();
  const w = worker({}, G.GZ_SANITIZE({ courses: { looks: { _1_1: favorites[0].id, _2_1: favorites[2].id } } }));
  const editor = { id: 'glaze', frameId: 0, url: 'chrome-extension://x/options.html' };
  const [a, b] = await Promise.all(favorites.slice(0, 2).map((favorite) => w.send({ type: 'glaze:looks', op: 'keep', favorite }, editor)));
  assert.deepEqual([a, b], [{ ok: true }, { ok: true }]);
  assert.equal(w.local.lookFavorites.length, 2, 'both tabs survive');
  const renamed = { ...favorites[0], name: 'Finals' };
  await w.send({ type: 'glaze:looks', op: 'keep', favorite: renamed }, editor);
  assert.equal(w.local.lookFavorites.filter((f) => f.code === renamed.code).length, 1, 'Use then Save, or two names: one code');
  w.local.rotateLooks = [favorites[0].code, favorites[1].code, 'Library'];
  const [removed, added] = await Promise.all([
    w.send({ type: 'glaze:looks', op: 'remove', id: favorites[0].id }, editor),
    w.send({ type: 'glaze:looks', op: 'keep', favorite: favorites[2] }, editor),
  ]);
  assert.deepEqual([removed, added], [{ ok: true }, { ok: true }]);
  assert.deepEqual(w.local.lookFavorites.map((f) => f.code).sort(), [favorites[1].code, favorites[2].code].sort());
  assert.deepEqual(w.local.rotateLooks, [C.idOf(favorites[1].code), 'Library']);
  assert.deepEqual(w.sync.courses.looks, { _2_1: favorites[2].id });
  assert.equal(w.local.lookCatalog.sig, C.sig(w.local.lookFavorites), 'reply waits for the final catalogue');
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'remove', id: favorites[2].id }, w.popup), { ok: false, error: 'sender' });
});

// Remove unmaps the courses that wore the Look (sync) before it forgets the Look (local): a sync write refused (quota, rate)
// leaves both as they were and says so, rather than a course still wearing a Look that is gone everywhere else.
test('remove fails closed when the courses that wore the Look cannot be written', async () => {
  const { favorites } = await fixtures();
  const w = worker({ lookFavorites: favorites.slice(0, 2), rotateLooks: [favorites[0].id] }, G.GZ_SANITIZE({ courses: { looks: { _1_1: favorites[0].id } } }));
  const editor = { id: 'glaze', frameId: 0, url: 'chrome-extension://x/options.html' };
  w.chrome.storage.sync.set = () => Promise.reject(new Error('QUOTA_BYTES_PER_ITEM quota exceeded'));
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'remove', id: favorites[0].id }, editor), { ok: false, error: 'write' });
  assert.equal(w.local.lookFavorites.length, 2, 'the Look is still kept');
  assert.deepEqual(w.local.rotateLooks, [favorites[0].id]);
  assert.deepEqual(w.sync.courses.looks, { _1_1: favorites[0].id });
});

test('catalogue rebuilds settle on the latest of consecutive favorites writes', async () => {
  const { favorites } = await fixtures();
  const w = worker();
  await Promise.all([w.set({ lookFavorites: favorites }), w.set({ lookFavorites: favorites.slice(1, 3) })]);
  assert.ok(await w.until(() => w.local.lookCatalog?.sig === C.sig(w.local.lookFavorites)));
  assert.deepEqual(w.local.lookCatalog.looks.map((e) => e.id), favorites.slice(1, 3).map((f) => C.idOf(f.code)));
});

test('a device with no favorites needs no empty catalogue write', async () => {
  const w = worker();
  assert.deepEqual(await w.send({ type: 'glaze:looks', op: 'build' }, w.popup), { ok: true });
  assert.equal(w.local.lookCatalog, undefined, 'fresh install readiness must not be followed by an unnecessary local write');
});

test('parts reads accept approved LMS documents, reject mod origins, and refuse Looks Glaze will not wear', async () => {
  const { favorites } = await fixtures();
  const blocked = C.make(await code(wear('Graveyard'), { x: { nav: { hidden: ['logout'] } } }), 'Hidden logout', '', 'saved');
  const w = worker({ lookFavorites: [blocked, ...favorites] });
  const url = 'https://school.blackboard.com/ultra/courses/_101_1/outline';
  const sender = { id: 'glaze', frameId: 0, tab: { id: 1, url }, url, origin: 'https://school.blackboard.com' };
  const request = { type: 'glaze:looks', op: 'parts', id: 'Graveyard' };
  for (const frameId of [0, 7]) assert.equal((await w.send(request, { ...sender, frameId })).ok, true);
  for (const untrusted of [{ ...sender, url: 'https://unapproved.example/ultra/courses/_101_1/outline' },
    { ...sender, frameId: 8, url: 'chrome-extension://x/mods/frame.html', origin: 'null' },
    { ...w.popup, origin: 'null' }, { ...sender, id: 'another-extension' }]) {
    assert.deepEqual(await w.send(request, untrusted), { ok: false, error: 'sender' });
  }
  assert.deepEqual(await w.send({ ...request, id: blocked.id }, sender), { ok: false, error: 'gone' });
  assert.deepEqual(w.sync, {}, 'parts reads grant no settings writes or frame passes');
});
