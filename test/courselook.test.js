const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../defaults.js');

test('a course wears its own look on its pages, and the student theme everywhere else', () => {
  const s = G.GZ_SANITIZE({ preset: 'Ember', colors: G.GZ_PRESET('Ember'), look: { tooltips: false }, courses: { looks: { _1_1: 'Library', _2_1: 'Nope', x: 'Library', '3': 'Terminal' } } });
  assert.deepEqual(s.courses.looks, { _1_1: 'Library' }, 'course ids and real looks only');
  const lib = G.GZ_LOOKS.find((L) => L.name === 'Library');
  const on = G.GZ_COURSE_LOOK(s, '_1_1');
  assert.ok(G.GZ_LOOK_ON(on, lib));
  assert.equal(on.look.tooltips, false, 'tooltips stay the student\'s');
  assert.deepEqual(on.courses, s.courses, 'only the theme changes');
  assert.equal(s.preset, 'Ember', 'the stored settings are untouched');
  for (const cid of ['_2_1', undefined]) assert.equal(G.GZ_COURSE_LOOK(s, cid), s);
  const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`_${i}_1`, 'Clear']));
  assert.equal(Object.keys(G.GZ_SANITIZE({ courses: { looks: many } }).courses.looks).length, 200);
});

test('a scoped course Look owns the shared surface model as well as its palette', () => {
  const s = G.GZ_SANITIZE({ look: { radius: 24, surfaceCustom: true, surfaceColor: '#ff0000', surfaceFrost: 40, shadowCustom: true, shadowColor: '#112233' }, courses: { looks: { _1_1: 'Terminal' } } });
  const course = G.GZ_COURSE_LOOK(s, '_1_1'), vars = G.GZ_SURFACE_VARS(course);
  assert.equal(course.look.radius, 2); assert.equal(course.look.glass, 0); assert.equal(course.look.depth, 0);
  assert.equal(vars['--gz-surface-color'], ''); assert.equal(vars['--gz-surface-grain'], 'none'); assert.equal(vars['--gz-shadow-color'], '');
  assert.equal(s.look.surfaceColor, '#ff0000', 'the global settings are unchanged');
});
