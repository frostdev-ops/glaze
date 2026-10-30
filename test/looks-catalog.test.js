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
  const s = G.GZ_SANITIZE({ preset: 'Ember', colors: G.GZ_PRESET('Ember'), look: { tooltips: false, scale: 1.1 }, courses: { looks: { _1_1: 'Library', _2_1: study, _3_1: lib, _4_1: 'c:00000000000000', _5_1: 'c:bad', _6_1: 'Nope' } } });
  assert.deepEqual(s.courses.looks, { _1_1: 'Library', _2_1: study, _3_1: lib, _4_1: 'c:00000000000000' }, 'built-in names and kept ids are kept, on every device; anything else goes');
  // A saved Look named like a built-in is still its own: the name maps to the built-in, the id to the saved one.
  assert.ok(G.GZ_LOOK_ON(G.GZ_COURSE_LOOK(s, '_1_1', saved), look('Library')));
  const mine = G.GZ_COURSE_LOOK(s, '_2_1', saved);
  assert.deepEqual(mine.colors, settings.mine.colors);
  assert.equal(mine.look.radius, 3);
  assert.equal(mine.look.scale, 1.1, 'what its code doesn\'t carry stays the student\'s');
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
