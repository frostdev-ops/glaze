// Glaze Writer's assignment context (lib/writer-context-assignment.js build), from the fixtures' Ultra shapes: the paper's
// key, the student's and course's names, the assignment's title, due date and instructions, and its rubric for the AI.
// Each read that fails leaves its part empty; the instructor is always left for the student.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/writer-context-assignment.js');
const R = require('../lib/rubric.js');
const grades = require('./fixtures/ultra-writer-gradebook.json');
const members = require('./fixtures/ultra-memberships.json');
const rubric = require('./fixtures/ultra-rubric-numeric.json');

const path = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const column = { ...rubric.column, id: '_810_1', contentId: '_7_1', rubricAssociations: rubric.column.rubricAssociations.map((a) => ({ ...a, entityId: '_810_1' })) };
const base = (o = {}) => ({
  school: 'BB.school.test', path, url: `https://bb.school.test${path}`,
  uid: async () => '_900_1', me: async () => ({ id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' }),
  courses: async () => members.results, rows: async () => grades.results,
  get: async (u) => { if (u === '/learn/api/v1/courses/_101_1/gradebook/columns/_810_1?expand=associatedRubrics') return column; throw new Error(`unexpected ${u}`); },
  instructions: async () => 'Essay 2\nWrite 1,200 words on memory in Beloved.', R, ...o,
});

test('everything Ultra says about the paper', async () => {
  const c = await C.build(base());
  assert.deepEqual(c.paper, { school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1', url: `https://bb.school.test${path}` });
  assert.deepEqual(c.user, { name: 'Alex Rivera', given: 'Alex', family: 'Rivera' });
  assert.deepEqual(c.course, { id: '_101_1', name: 'BIO 1100: Biology I' });
  assert.equal(c.instructor, '', 'no read-only source for instructors was seen: left to the student');
  assert.deepEqual([c.assignment.title, c.assignment.due], ['Essay 2: Memory in Beloved', '2026-09-21T03:59:00.000Z']);
  assert.equal(c.assignment.instructions, 'Essay 2 Write 1,200 words on memory in Beloved.');
  assert.equal(c.prompt.text, c.assignment.instructions);
  assert.equal(c.kind, 'assignment');
  assert.equal(c.assignment.rubric.title, 'Synthetic points rubric');
  assert.ok(c.assignment.rubric.criteria.length >= 2 && c.assignment.rubric.criteria[0].levels.length === 5);
  assert.deepEqual(Object.keys(c.assignment.rubric.criteria[0].levels[0]), ['level', 'detail', 'value']);
});

test('what fails stays empty; without the student\'s id there is no key, so nothing is saved under a guess', async () => {
  const c = await C.build(base({ me: async () => { throw new Error('401'); }, courses: async () => { throw new Error('x'); }, rows: async () => null, instructions: async () => '' }));
  assert.deepEqual([c.user.name, c.course.name, c.assignment.title, c.assignment.due, c.assignment.rubric, c.prompt.text], ['', '', '', null, null, '']);
  assert.ok(c.paper);
  const none = await C.build(base({ uid: async () => { throw new Error('no user'); } }));
  assert.equal(none.paper, null);
  assert.equal(none.assignment.rubric, null, 'no rubric read without the student');
  assert.equal(await C.build(base({ path: '/ultra/courses/_101_1/discussion/_9_1' })), null, 'only on an attempt');
});

test('the rubric is read only for the student\'s own row and a single association', async () => {
  const asked = [];
  const c = await C.build(base({ uid: async () => '_901_1', get: async (u) => { asked.push(u); return column; } }));
  assert.equal(c.assignment.rubric, null);
  assert.deepEqual(asked, []);
  const two = await C.build(base({ get: async () => ({ ...column, rubricAssociations: [...column.rubricAssociations, ...column.rubricAssociations] }) }));
  assert.equal(two.assignment.rubric, null);
});
