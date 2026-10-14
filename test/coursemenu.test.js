const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../defaults.js');

// The menu on a course's card edits settings.courses through GZ_COURSE_EDIT; whatever it leaves must be what
// GZ_SANITIZE would keep, or the next read would undo it.
const C = (slot, org = false) => ({ name: `Course in ${slot}`, slot, org });
const list = { _9_1: C('3'), _10_1: C('3'), _11_1: C('3'), _1_1: C('2') };
const fresh = (courses = {}) => G.GZ_SANITIZE({ courses }).courses;
const kept = (c) => assert.deepEqual(G.GZ_SANITIZE({ courses: c }).courses, c);

test('a color is a pick, and reset gives Blackboard\'s back', () => {
  const c = fresh();
  G.GZ_COURSE_EDIT.color(c, '_10_1', '#ABCDEF', list);
  assert.deepEqual(c.colors, { _10_1: '#abcdef' });
  kept(c);
  G.GZ_COURSE_EDIT.color(c, '_10_1', null, list);
  assert.deepEqual(c.colors, {});
});

test('reset also lets go of a pre-2.1.3 pick by slot, but only the slot\'s own course\'s', () => {
  // _11_1 is the newest in slot 3, so it keeps Ultra's color for the slot, and the old pick by slot is its.
  assert.equal(G.GZ_COURSE_COLORS(list, {})._11_1.own, true);
  const a = fresh({ colors: { 3: '#123456', _10_1: '#654321' } });
  G.GZ_COURSE_EDIT.color(a, '_10_1', null, list);
  assert.deepEqual(a.colors, { 3: '#123456' }, 'another course in the slot: the slot\'s pick stays');
  G.GZ_COURSE_EDIT.color(a, '_11_1', null, list);
  assert.deepEqual(a.colors, {}, 'the slot\'s own course: its pick goes');
  kept(a);
});

test('ticking tint switches the master on; unticking leaves it', () => {
  const c = fresh();
  assert.equal(c.tint, false);
  assert.equal(G.GZ_COURSE_TINTED(c, '_1_1', list), false);
  G.GZ_COURSE_EDIT.tint(c, '_1_1', true, list);
  G.GZ_COURSE_EDIT.tint(c, '_1_1', true, list);
  assert.deepEqual([c.tint, c.tinted], [true, ['_1_1']], 'once');
  assert.equal(G.GZ_COURSE_TINTED(c, '_1_1', list), true);
  assert.equal(G.GZ_COURSE_TINTED(c, '_9_1', list), false);
  kept(c);
  G.GZ_COURSE_EDIT.tint(c, '_1_1', false, list);
  assert.deepEqual([c.tint, c.tinted], [true, []]);
});

test('a tick left over while the master was off does not count until it is on', () => {
  const c = fresh({ tint: false, tinted: ['_1_1'] });
  assert.equal(G.GZ_COURSE_TINTED(c, '_1_1', list), false);
  G.GZ_COURSE_EDIT.tint(c, '_1_1', true, list);
  assert.equal(G.GZ_COURSE_TINTED(c, '_1_1', list), true);
  assert.deepEqual(c.tinted, ['_1_1']);
});

test('a pre-2.1.3 tick by slot shows every course in it ticked; unticking one keeps the rest', () => {
  const c = fresh({ tint: true, tinted: ['3', '2'] });
  for (const id of ['_9_1', '_10_1', '_11_1']) assert.equal(G.GZ_COURSE_TINTED(c, id, list), true, id);
  G.GZ_COURSE_EDIT.tint(c, '_10_1', false, list);
  assert.deepEqual(c.tinted.sort(), ['2', '_11_1', '_9_1']);
  assert.equal(G.GZ_COURSE_TINTED(c, '_10_1', list), false);
  assert.equal(G.GZ_COURSE_TINTED(c, '_9_1', list), true);
  assert.equal(G.GZ_COURSE_TINTED(c, '_1_1', list), true, 'the other slot\'s tick is untouched');
  kept(c);
});

test('a look is a name, and \'\' is the student\'s theme', () => {
  const c = fresh();
  G.GZ_COURSE_EDIT.look(c, '_1_1', 'Library');
  assert.deepEqual(c.looks, { _1_1: 'Library' });
  kept(c);
  G.GZ_COURSE_EDIT.look(c, '_1_1', '');
  assert.deepEqual(c.looks, {});
});

test('a nickname is trimmed to one line, and clearing it lets it go', () => {
  const c = fresh();
  G.GZ_COURSE_EDIT.name(c, '_1_1', '  Bio\n lab ');
  assert.deepEqual(c.names, { _1_1: 'Bio lab' });
  kept(c);
  G.GZ_COURSE_EDIT.name(c, '_1_1', 'x'.repeat(100));
  assert.equal(c.names._1_1.length, G.GZ_NICK_MAX);
  G.GZ_COURSE_EDIT.name(c, '_1_1', '   ');
  assert.deepEqual(c.names, {});
});
