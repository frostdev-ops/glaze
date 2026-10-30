// Course Looks on one sync account shared with Glaze 3.x: built-in names in courses.looks, which 3.x reads and keeps; saved
// and gallery Looks' ids in courseLooks, which 3.x never reads or writes (3.x keeps only built-in names in courses.looks and
// writes the rest away on its next course edit).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const G = require('../defaults.js');
const C = require('../lib/looks.js');

// Glaze 3.4.6's defaults.js as released (git show v3.4.6:defaults.js); its helpers are unchanged since.
const old = (() => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'fixtures/defaults-3.4.6.js.txt'), 'utf8'), {
    module, TextEncoder, console, GZ_COLOR: require('../lib/color.js'), GZ_SURFACES: require('../lib/surfaces.js'), GZ_FONTS: require('../lib/fonts.js') });
  return module.exports;
})();
// A 3.x course edit (its course menu, its Settings row, its worker's courseName): courses read, sanitized, edited, written back.
const edit3x = (sync, fn) => { const c = old.GZ_SANITIZE(sync).courses; fn(c); Object.assign(sync, structuredClone({ version: 2, courses: c })); };
// The most a 3.x device writes: every key its sanitize knows, as it leaves them (Reset everything, a restore).
const save3x = (sync) => Object.assign(sync, structuredClone(old.GZ_SANITIZE(sync)));

const K1 = 'c:0123456789abcd', K2 = 'c:zyxwvutsrqpon0', GONE = 'c:00000000000000';
const saved = [{ id: K1 }, { id: K2 }];
const canvas = 'canvas:https://school.instructure.com/42';
const pick = (s, cid, id) => G.GZ_COURSE_EDIT.look(s.courses, cid, id, s.courseLooks);

test('3.x keeps only built-in names in courses.looks: a kept Look stored there is lost on its next course edit', () => {
  const sync = { version: 2, courses: { ...G.GZ_DEFAULTS.courses, looks: { _1_1: 'Library', _2_1: K1 } } };
  edit3x(sync, (c) => old.GZ_COURSE_EDIT.color(c, '_3_1', '#ff0000'));
  assert.deepEqual(sync.courses.looks, { _1_1: 'Library' });
});

test('a 3.x device editing courses and saving everything it knows leaves 4.0\'s saved and gallery course Looks worn', () => {
  const s = G.GZ_SANITIZE({});
  pick(s, '_1_1', 'Library'); pick(s, '_2_1', K1); pick(s, canvas, K2);
  const sync = structuredClone(s);
  assert.deepEqual(sync.courses.looks, { _1_1: 'Library' }, 'only built-in names where 3.x reads');
  assert.deepEqual(sync.courseLooks, { _2_1: K1, [canvas]: K2 });
  edit3x(sync, (c) => old.GZ_COURSE_EDIT.color(c, '_3_1', '#ff0000'));
  edit3x(sync, (c) => old.GZ_COURSE_EDIT.look(c, '_4_1', 'Synthwave'));
  edit3x(sync, (c) => old.GZ_COURSE_EDIT.name(c, '_2_1', 'Bio'));
  const later = structuredClone(sync);
  save3x(sync);
  const back = G.GZ_SANITIZE(sync);
  assert.equal(G.GZ_COURSE_LOOK_ID(back, '_2_1', saved), K1);
  assert.equal(G.GZ_COURSE_LOOK_ID(back, canvas, saved), K2);
  assert.equal(G.GZ_COURSE_LOOK_ID(back, '_1_1', saved), 'Library');
  assert.equal(G.GZ_COURSE_LOOK_ID(back, '_4_1', saved), 'Synthwave', 'and what the 3.x device picked');
  assert.equal(back.courses.colors._3_1, '#ff0000');
  assert.equal(back.courses.names._2_1, 'Bio');
  assert.deepEqual(structuredClone(old.GZ_SANITIZE(sync).courses.looks), { _1_1: 'Library', _4_1: 'Synthwave' }, 'the 3.x device reads its built-in names');
  // The 3.x device then picks a built-in Look for a course wearing a kept one: every device wears its pick.
  edit3x(later, (c) => old.GZ_COURSE_EDIT.look(c, '_2_1', 'Terminal'));
  assert.equal(G.GZ_COURSE_LOOK_ID(G.GZ_SANITIZE(later), '_2_1', saved), 'Terminal');
});

// 4.0 clears one map as it writes the other: only a 3.x device leaves a built-in beside a kept Look, and its pick is the newer.
test('a course wears its built-in Look, else its kept one where this device has it, else the theme', () => {
  const s = G.GZ_SANITIZE({ courses: { looks: { _1_1: 'Library', _2_1: 'Terminal', _5_1: K1, _6_1: K1 } }, courseLooks: { _2_1: K1, _3_1: GONE, _4_1: K2, _6_1: K2 } });
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_2_1', saved), 'Terminal', 'a built-in a 3.x device picked over the kept Look before it');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_2_1', []), 'Terminal');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_2_1'), 'Terminal', 'no catalogue given: the same');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_4_1', []), '', 'a kept Look this device hasn\'t: the theme');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_6_1', saved), K2, 'courseLooks over a kept id still in courses.looks');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_1_1', saved), 'Library');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_3_1', saved), '', 'a kept Look gone everywhere, and no built-in: the theme');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_4_1', saved), K2);
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_5_1', saved), K1, 'a kept id still in courses.looks, until it moves');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_5_1', []), '');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, '_9_1', saved), '');
  assert.equal(G.GZ_COURSE_LOOK_ID(s, undefined, saved), '');
  // GZ_COURSE_LOOK wears what the resolver names.
  const entries = [{ id: K2, colors: G.GZ_PRESET('Forest'), look: { radius: 3 }, bg: { kind: 'solid' } }];
  assert.deepEqual(G.GZ_COURSE_LOOK(s, '_4_1', entries).colors, G.GZ_PRESET('Forest'));
  assert.ok(G.GZ_LOOK_ON(G.GZ_COURSE_LOOK(s, '_2_1', entries), G.GZ_LOOKS.find((L) => L.name === 'Terminal')));
  assert.equal(G.GZ_COURSE_LOOK(s, '_3_1', entries), s);
});

test('picking a built-in Look writes courses.looks, a kept one courseLooks, each clearing the other; the theme clears both', () => {
  const s = G.GZ_SANITIZE({});
  pick(s, '_1_1', K1);
  assert.deepEqual([s.courses.looks, s.courseLooks], [{}, { _1_1: K1 }]);
  pick(s, '_1_1', 'Library');
  assert.deepEqual([s.courses.looks, s.courseLooks], [{ _1_1: 'Library' }, {}]);
  pick(s, '_1_1', K2);
  assert.deepEqual([s.courses.looks, s.courseLooks], [{}, { _1_1: K2 }]);
  s.courses.looks._1_1 = 'Library'; // as a 3.x device leaves it
  pick(s, '_1_1', '');
  assert.deepEqual([s.courses.looks, s.courseLooks], [{}, {}]);
});

test('courseLooks keeps kept ids by course id, within one sync item; anything else goes', () => {
  assert.deepEqual(G.GZ_DEFAULTS.courseLooks, {});
  for (const bad of [undefined, null, 'x', [K1], 7]) assert.deepEqual(G.GZ_SANITIZE({ courseLooks: bad }).courseLooks, {});
  const s = G.GZ_SANITIZE({ courseLooks: { _1_1: K1, [canvas]: K2, nope: K1, '': K1, _2_1: 'Library', _3_1: 'c:bad', _4_1: 7, _5_1: GONE, ...JSON.parse(`{"__proto__":"${K1}"}`) } });
  assert.deepEqual(s.courseLooks, { _1_1: K1, [canvas]: K2, _5_1: GONE });
  const many = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`canvas:https://a-long-school-name.instructure.com/${100000 + i}`, K1]));
  const capped = G.GZ_SANITIZE({ courseLooks: many }).courseLooks;
  assert.ok(G.GZ_SYNC_BYTES('courseLooks', capped) <= G.GZ_SYNC_ITEM_MAX, 'fits one sync item');
  assert.ok(Object.keys(capped).length >= 50 && Object.keys(capped).length <= 200);
  assert.deepEqual(Object.keys(capped), Object.keys(many).slice(0, Object.keys(capped).length), 'first come, first kept');
});

test('kept ids in courses.looks move to courseLooks once; one courseLooks has for the course stays', () => {
  const s = G.GZ_SANITIZE({ courses: { looks: { _1_1: 'Library', _2_1: K1, _3_1: K2 } }, courseLooks: { _3_1: K1 } });
  assert.equal(C.move(s), true);
  assert.deepEqual(s.courses.looks, { _1_1: 'Library' });
  assert.deepEqual(s.courseLooks, { _3_1: K1, _2_1: K1 });
  assert.equal(C.move(s), false, 'nothing left to move');
  assert.equal(C.move(G.GZ_SANITIZE({})), false);
  // One that would take courseLooks past what it keeps stays where it is.
  const full = G.GZ_SANITIZE({ courseLooks: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`_${1000 + i}_1`, K1])), courses: { looks: { _7_1: K2 } } });
  assert.equal(Object.keys(full.courseLooks).length, 200);
  C.move(full);
  assert.deepEqual(full.courses.looks, { _7_1: K2 });
  assert.ok(G.GZ_SYNC_BYTES('courseLooks', full.courseLooks) <= G.GZ_SYNC_ITEM_MAX);
});

test('removing a kept Look takes it off every course, in both maps', () => {
  const s = G.GZ_SANITIZE({ courses: { looks: { _1_1: K1, _4_1: 'Terminal' } }, courseLooks: { _2_1: K1, _3_1: K2 } });
  assert.equal(C.unmap(s.courses, K1, s.courseLooks), true);
  assert.deepEqual([s.courses.looks, s.courseLooks], [{ _4_1: 'Terminal' }, { _3_1: K2 }]);
  assert.equal(C.unmap(s.courses, K1, s.courseLooks), false, 'none left to take off');
});

// The real 4.0 worker (lib/background.js) over `sync`: its writes of course Looks, and `arrive` for a change another device
// synced (in storage and heard, not written here).
const worker4 = (sync) => {
  const env = require('./helpers/worker-env.cjs')({ store: { sync, local: { ultra: [] }, session: {} } });
  const writes = [], set = env.context.chrome.storage.sync.set;
  env.context.chrome.storage.sync.set = (v) => { if ('courses' in v || 'courseLooks' in v) writes.push(structuredClone(v)); return set(v); };
  const arrive = (fn) => {
    const was = structuredClone(sync);
    fn(sync);
    const ch = Object.fromEntries(Object.keys(sync).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(sync[k])).map((k) => [k, { oldValue: was[k], newValue: sync[k] }]));
    for (const f of env.changed) f(ch, 'sync');
  };
  return { writes, arrive, settle: env.settle };
};
const wears = (sync, cid) => G.GZ_COURSE_LOOK_ID(G.GZ_SANITIZE(sync), cid, saved);

test('a built-in Look a 3.x device picks over a kept one clears the kept one, so its "Your theme" after is the theme on 4.0', async () => {
  const s = G.GZ_SANITIZE({});
  pick(s, '_1_1', 'Library'); pick(s, '_2_1', K1); pick(s, '_3_1', K2);
  const sync = structuredClone(s);
  const w = worker4(sync);
  await w.settle();
  assert.deepEqual(w.writes, [], 'nothing to clear: no write');
  w.arrive((x) => edit3x(x, (c) => old.GZ_COURSE_EDIT.look(c, '_2_1', 'Terminal')));
  assert.equal(wears(sync, '_2_1'), 'Terminal', 'every device wears the 3.x pick');
  await w.settle();
  assert.equal(wears(sync, '_2_1'), 'Terminal', 'and still does');
  assert.deepEqual(sync.courseLooks, { _3_1: K2 }, 'the kept Look it replaced goes; one with no built-in beside it stays');
  assert.deepEqual(sync.courses.looks, { _1_1: 'Library', _2_1: 'Terminal' });
  assert.equal(w.writes.length, 1, 'one write');
  assert.ok(!('courses' in w.writes[0]), 'courses stay as the 3.x device wrote them');
  w.arrive((x) => edit3x(x, (c) => old.GZ_COURSE_EDIT.look(c, '_2_1', '')));
  await w.settle();
  assert.equal(wears(sync, '_2_1'), '', '"Your theme" on 3.x: the theme on 4.0 too');
  assert.equal(wears(sync, '_3_1'), K2);
  assert.equal(wears(sync, '_1_1'), 'Library');
  assert.equal(w.writes.length, 1, 'nothing more to clear: no write');
});

// What a 4.0 device's pick writes, in one set (GZ_COURSE_EDIT.look): sync may hand another device its keys one at a time.
const pick4 = (sync, cid, id) => { const s = G.GZ_SANITIZE(sync); pick(s, cid, id); return { courses: s.courses, courseLooks: s.courseLooks }; };

test('the clear goes with the kept ids the worker moves, in one write; a 3.x edit of anything else or a restart writes nothing', async () => {
  const sync = { version: 2, courses: { ...G.GZ_DEFAULTS.courses, looks: { _1_1: 'Library' } }, courseLooks: { _2_1: K1, _3_1: K2 } };
  const w = worker4(sync);
  await w.settle();
  assert.deepEqual(w.writes, []);
  // A restore of a backup from an earlier 4.0, with a 3.x device's pick in it.
  w.arrive((x) => { x.courses = { ...x.courses, looks: { _1_1: 'Library', _2_1: 'Terminal', _4_1: K2 } }; });
  await w.settle();
  assert.deepEqual(sync.courses.looks, { _1_1: 'Library', _2_1: 'Terminal' });
  assert.deepEqual(sync.courseLooks, { _3_1: K2, _4_1: K2 });
  assert.equal(w.writes.length, 1, 'one write');
  for (const [cid, id] of [['_1_1', 'Library'], ['_2_1', 'Terminal'], ['_3_1', K2], ['_4_1', K2]]) assert.equal(wears(sync, cid), id);
  w.arrive((x) => edit3x(x, (c) => old.GZ_COURSE_EDIT.color(c, '_2_1', '#ff0000')));
  w.arrive((x) => edit3x(x, (c) => old.GZ_COURSE_EDIT.name(c, '_3_1', 'Bio')));
  await w.settle();
  const again = worker4(sync);
  await again.settle();
  assert.equal(w.writes.length, 1, 'none for an edit that picks no built-in');
  assert.deepEqual(again.writes, [], 'none on a restart');
  assert.deepEqual(sync.courseLooks, { _3_1: K2, _4_1: K2 });
});

test('a start over a built-in beside a kept Look writes nothing: it can be a 4.0 pick half delivered', async () => {
  const sync = { version: 2, courses: { ...G.GZ_DEFAULTS.courses, looks: { _2_1: 'Terminal' } }, courseLooks: { _2_1: K1, _3_1: K2 } };
  const w = worker4(sync);
  await w.settle();
  assert.deepEqual(w.writes, []);
  assert.deepEqual([sync.courses.looks, sync.courseLooks], [{ _2_1: 'Terminal' }, { _2_1: K1, _3_1: K2 }]);
});

test('a 4.0 device\'s pick of a kept Look over a built-in survives its keys arriving one at a time, a worker start between', async () => {
  const sync = structuredClone(G.GZ_SANITIZE({ courses: { looks: { _2_1: 'Terminal' } } }));
  const mine = pick4(sync, '_2_1', K1);
  sync.courseLooks = structuredClone(mine.courseLooks); // courseLooks first, while this device's worker is off
  const w = worker4(sync); // it starts
  await w.settle();
  w.arrive((x) => { x.courses = structuredClone(mine.courses); }); // then courses, the built-in gone
  await w.settle();
  assert.deepEqual(w.writes, []);
  assert.deepEqual(sync.courseLooks, { _2_1: K1 });
  assert.equal(wears(sync, '_2_1'), K1, 'the 4.0 pick, everywhere');
});

test('a 4.0 pick of a kept Look landing before the worker gets to a 3.x pick for the course survives, whichever key comes first', async () => {
  for (const first of ['courseLooks', 'courses']) {
    const s = G.GZ_SANITIZE({}); pick(s, '_2_1', K2);
    const sync = structuredClone(s);
    const w = worker4(sync);
    await w.settle();
    w.arrive((x) => edit3x(x, (c) => old.GZ_COURSE_EDIT.look(c, '_2_1', 'Terminal')));
    const mine = pick4(sync, '_2_1', K1);
    const second = first === 'courses' ? 'courseLooks' : 'courses';
    w.arrive((x) => { x[first] = structuredClone(mine[first]); }); // all in this turn: the worker hasn't read yet
    await w.settle();
    w.arrive((x) => { x[second] = structuredClone(mine[second]); });
    await w.settle();
    assert.deepEqual(sync.courseLooks, { _2_1: K1 }, `${first} first`);
    assert.equal(wears(sync, '_2_1'), K1, `${first} first: the 4.0 pick`);
  }
});
