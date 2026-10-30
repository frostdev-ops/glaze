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
const item = require('./fixtures/ultra-writer-content.json');

const path = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const column = { ...rubric.column, id: '_810_1', contentId: '_7_1', rubricAssociations: rubric.column.rubricAssociations.map((a) => ({ ...a, entityId: '_810_1' })) };
const base = (o = {}) => ({
  school: 'BB.school.test', path, url: `https://bb.school.test${path}`,
  uid: async () => '_900_1', me: async () => ({ id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' }),
  courses: async () => members.results, rows: async () => grades.results,
  get: async (u) => { if (u === '/learn/api/v1/courses/_101_1/gradebook/columns/_810_1?expand=associatedRubrics') return column; if (u === '/learn/api/v1/courses/_101_1/contents/_7_1') return item; throw new Error(`unexpected ${u}`); },
  instructions: async () => 'Essay 2\nWrite 1,200 words on memory in Beloved.', R, ...o,
});

test('everything Ultra says about the paper', async () => {
  const c = await C.build(base());
  assert.deepEqual(c.paper, { school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1', url: `https://bb.school.test${path}` });
  assert.deepEqual(c.user, { name: 'Alex Rivera', given: 'Alex', family: 'Rivera' });
  assert.deepEqual(c.course, { id: '_101_1', name: 'BIO 1100: Biology I' });
  assert.equal(c.instructor, '', 'no read-only source for instructors was seen: left to the student');
  assert.deepEqual([c.assignment.title, c.assignment.due], ['Essay 2: Memory in Beloved', '2026-09-21T03:59:00.000Z']);
  assert.equal(c.assignment.instructions, 'Essay 2 Write 1,200 words on memory in Beloved. Submit a Word document.', 'the complete API instruction extends the page prefix');
  assert.equal(c.assignment.description, 'A 1,200-word close reading.\nCite at least two critics in MLA style.', 'the item\'s and its assessment\'s, as text');
  assert.equal(c.prompt.text, c.assignment.instructions);
  assert.equal(c.kind, 'assignment');
  assert.equal(c.assignment.rubric.title, 'Synthetic points rubric');
  assert.ok(c.assignment.rubric.criteria.length >= 2 && c.assignment.rubric.criteria[0].cells.length === 5);
  assert.deepEqual(Object.keys(c.assignment.rubric.criteria[0].cells[0]), ['level', 'detail', 'value']);
});

test('what fails stays empty; without the student\'s id there is no key, so nothing is saved under a guess', async () => {
  const c = await C.build(base({ me: async () => { throw new Error('401'); }, courses: async () => { throw new Error('x'); }, rows: async () => null, instructions: async () => '', get: async () => { throw new Error('500'); } }));
  assert.deepEqual([c.user.name, c.course.name, c.assignment.title, c.assignment.due, c.assignment.rubric, c.prompt.text, c.assignment.description], ['', '', '', null, null, '', '']);
  assert.ok(c.paper);
  const none = await C.build(base({ uid: async () => { throw new Error('no user'); } }));
  assert.equal(none.paper, null);
  assert.equal(none.assignment.rubric, null, 'no rubric read without the student');
  assert.equal(await C.build(base({ path: '/ultra/courses/_101_1/discussion/_9_1' })), null, 'only on an attempt');
});

test('an item not yet opened: Ultra\'s row has no userId and its rubric is still read', async () => {
  // The keys Ultra sends for a row never opened (live, 2026-10-27; test/rubric-ultra-state.test.js has the same).
  const KEEP = ['columnId', 'courseId', 'averageScore', 'submissionStatus', 'column', 'isCorrupt', 'columnUrl'];
  const rows = grades.results.map((r) => (r.column?.contentId === '_7_1' ? { ...Object.fromEntries(Object.entries(r).filter(([k]) => KEEP.includes(k))), submissionStatus: { actionCount: null, status: 'UNOPENED' } } : r));
  assert.equal(rows.find((r) => r.column?.contentId === '_7_1').userId, undefined);
  const c = await C.build(base({ rows: async () => rows }));
  assert.equal(c.assignment.rubric?.title, 'Synthetic points rubric');
  const two = await C.build(base({ rows: async () => [...rows, ...rows.filter((r) => r.column?.contentId === '_7_1')] }));
  assert.equal(two.assignment.rubric, null, 'two rows for one item: neither is surely the student\'s');
});

test('instructions the page doesn\'t show come from the content item; the description never repeats them', async () => {
  const c = await C.build(base({ instructions: async () => '' }));
  assert.equal(c.assignment.instructions, 'Essay 2 Write 1,200 words on memory in Beloved. Submit a Word document.');
  const same = { ...item, description: '', contentDetail: { 'resource/x-bb-asmt-test-link': { test: { assessment: { ...item.contentDetail['resource/x-bb-asmt-test-link'].test.assessment, description: { rawText: 'Essay 2 Write 1,200 words on memory in Beloved.' } } } } } };
  const d = await C.build(base({ get: async (u) => (u.includes('/contents/') ? same : column) }));
  assert.equal(d.assignment.description, '');
  const other = await C.build(base({ get: async (u) => (u.includes('/contents/') ? { ...item, id: '_8_1' } : column) }));
  assert.equal(other.assignment.description, '', 'another item\'s text is never this one\'s');
});

test('the rubric is read only for the student\'s own row and a single association', async () => {
  const asked = [];
  const c = await C.build(base({ uid: async () => '_901_1', get: async (u) => { asked.push(u); return column; } }));
  assert.equal(c.assignment.rubric, null);
  assert.deepEqual(asked.filter((u) => u.includes('/gradebook/')), []);
  const two = await C.build(base({ get: async () => ({ ...column, rubricAssociations: [...column.rubricAssociations, ...column.rubricAssociations] }) }));
  assert.equal(two.assignment.rubric, null);
});
test('the production worker allows the assignment context builder', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const src = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const list = vm.runInNewContext(src.match(/const LOADABLE = (new Set\([^;]+\));/)[1]);
  assert.ok(list.has('lib/writer-context-assignment.js'));
  const check = fs.readFileSync(path.join(__dirname, '../scripts/writer-paper-check.js'), 'utf8');
  assert.doesNotMatch(check, /fs\.writeFileSync\(bg,/);
});

test('assignment requirements and rubric details are preserved beyond former display-length cutoffs', async () => {
  const instruction = 'Instruction material. '.repeat(1100) + 'Include two interviews.';
  const description = 'Description material. '.repeat(400) + 'Discuss the counterargument.';
  const source = structuredClone(item);
  source.description = description;
  source.contentDetail['resource/x-bb-asmt-test-link'].test.assessment.instructions.rawText = instruction;
  const context = await C.build(base({ instructions: async () => instruction, get: async (url) => url.includes('/contents/') ? source : column }));
  assert.equal(context.assignment.instructions, instruction);
  assert.ok(context.assignment.description.includes('Discuss the counterargument.'));
  const model = { title: 'Rubric', levels: [{ id: 'full', label: 'Full' }], criteria: [{ id: 'claim', label: 'Claim', detail: 'Detail. '.repeat(80) + 'Required ending.', cells: [{ level: 'full', detail: 'Level description. '.repeat(150) + 'Required level ending.', value: { n: 10 } }] }] };
  const rubric = C.rubricOf(model);
  assert.equal(rubric.criteria[0].detail, model.criteria[0].detail);
  assert.equal(rubric.criteria[0].cells[0].detail, model.criteria[0].cells[0].detail);
});

test('distinct page and API instruction requirements are both retained', async () => {
  const context = await C.build(base({ instructions: async () => 'The page requires one interview.' }));
  assert.ok(context.assignment.instructions.includes('The page requires one interview.'));
  assert.ok(context.assignment.instructions.includes('Submit a Word document.'));
});

const weightedColumn = (possible = 100) => {
  const out = structuredClone(column), definition = out.rubricAssociations[0].rubricDefinition;
  out.possible = possible; definition.rubricType = 'PERCENTAGE';
  definition.columnHeaders = ['Excellent', 'Satisfactory', 'Unsatisfactory', 'Poor'].map((header, position) => ({ id: `_${200 + position}_1`, header, position }));
  definition.rows = [25, 25, 50].map((percentage, position) => ({ id: `_${300 + position}_1`, header: `Criterion ${position + 1}`, percentage, position,
    cells: definition.columnHeaders.map((level, j) => ({ id: `_${400 + position * 4 + j}_1`, rubricRowId: `_${300 + position}_1`, rubricColumnId: level.id, position: j, percentage: [100, 75, 50, 25][j], description: 'Synthetic criterion descriptor.' })) }));
  return out;
};
const weightedModel = (possible = 100) => {
  const col = weightedColumn(possible), association = col.rubricAssociations[0];
  return R.parse.ultra(association.rubricDefinition, association, null, { courseId: '_101_1', contentId: '_7_1', columnId: '_810_1', columnBound: true, userId: '_900_1', state: 'before', pointsPossible: col.possible });
};

test('a verified 100-point assignment exports weighted percentage rubric levels as actual row points', async () => {
  const col = weightedColumn(), context = await C.build(base({ get: async (url) => url.includes('/contents/') ? item : col }));
  const rubric = context.assignment.rubric;
  assert.equal(rubric.kind, 'points');
  assert.equal(rubric.total, 100);
  assert.deepEqual(rubric.criteria.map((row) => [row.points, row.weight, row.unscored]), [[25, 25, false], [25, 25, false], [50, 50, false]]);
  assert.deepEqual(rubric.criteria.map((row) => row.cells.map((cell) => cell.value)), [[25, 18.75, 12.5, 6.25], [25, 18.75, 12.5, 6.25], [50, 37.5, 25, 12.5]]);
});

test('weighted conversion uses the explicit assignment total and never changes the native rubric model', () => {
  const model = weightedModel(20), before = structuredClone(model), rubric = C.rubricOf(model);
  assert.equal(rubric.kind, 'points');
  assert.deepEqual(rubric.criteria.map((row) => row.points), [5, 5, 10]);
  assert.deepEqual(rubric.criteria[0].cells.map((cell) => cell.value), [5, 3.75, 2.5, 1.25]);
  assert.deepEqual(model, before);
  assert.equal(model.kind, 'percent');
  assert.equal(model.criteria[0].points, null);
  assert.deepEqual(model.criteria[0].cells.map((cell) => cell.value.n), [100, 75, 50, 25]);
});

test('a percentage rubric without an explicit positive point total keeps percentages without inventing points', () => {
  for (const total of [null, undefined, 0, -1, NaN, Infinity, '100']) {
    const model = weightedModel(); model.total = total;
    const rubric = C.rubricOf(model);
    assert.equal(rubric.kind, 'percent');
    assert.ok(rubric.criteria.every((row) => row.points === null));
    assert.deepEqual(rubric.criteria[0].cells.map((cell) => [cell.value, cell.percentage]), [[null, 100], [null, 75], [null, 50], [null, 25]]);
  }
});

test('weighted scaling requires every scored weight and complete scalar percentage cell to be valid', () => {
  for (const change of [
    (m) => { m.criteria[0].weight = 20; }, (m) => { m.criteria[0].weight = -1; }, (m) => { m.criteria[0].weight = NaN; }, (m) => { delete m.criteria[0].weight; },
    (m) => { m.criteria[0].unscored = true; }, (m) => { m.criteria[0].id = m.criteria[1].id; }, (m) => { m.hideTotal = true; }, (m) => { m.hidePoints = true; },
    (m) => { m.criteria[0].cells.pop(); }, (m) => { m.criteria[0].cells[0].value = { n: 101 }; }, (m) => { m.criteria[0].cells[0].value = { n: '100' }; },
    (m) => { m.criteria[0].cells[0].value = { lo: 75, hi: 100, loExclusive: false }; }, (m) => { m.criteria[0].cells[0].level = 'unknown'; },
    (m) => { m.criteria[0].cells[0].level = m.criteria[0].cells[1].level; }, (m) => { m.levels.push({ ...m.levels[0] }); },
  ]) {
    const model = weightedModel(); change(model);
    const rubric = C.rubricOf(model);
    assert.equal(rubric.kind, 'percent');
    assert.ok(rubric.criteria.every((row) => row.points === null && row.cells.every((cell) => cell.value === null)));
  }
});

test('percentage ranges preserve their unit and endpoints without selecting a point value', () => {
  const model = weightedModel(); model.kind = 'percent-range';
  for (const row of model.criteria) for (const cell of row.cells) cell.value = { lo: 50, hi: 100, loExclusive: false };
  const rubric = C.rubricOf(model);
  assert.equal(rubric.kind, 'percent-range');
  assert.ok(rubric.criteria.every((row) => row.points === null));
  assert.deepEqual(rubric.criteria[0].cells[0], { level: model.levels[0].id, detail: 'Synthetic criterion descriptor.', value: null, percentageRange: { lo: 50, hi: 100, loExclusive: false } });
});

test('unscored and hidden rubric definitions never acquire row or rating point scores', () => {
  const source = { kind: 'points', title: 'Unscored feedback', total: 25, levels: [{ id: 'full', label: 'Full' }],
    criteria: [{ id: 'one', label: 'One', points: 25, unscored: true, cells: [{ level: 'full', value: { n: 25 }, detail: 'Descriptor.' }] }] };
  const rubric = C.rubricOf(source);
  assert.equal(rubric.criteria[0].unscored, true);
  assert.equal(rubric.criteria[0].points, null);
  assert.equal(rubric.criteria[0].cells[0].value, null);
  const hidden = weightedModel(); hidden.hidePoints = true;
  const hiddenRubric = C.rubricOf(hidden);
  assert.equal(hiddenRubric.total, null);
  assert.ok(hiddenRubric.criteria.every((row) => row.points === null && row.weight === null && row.cells.every((cell) => cell.value === null && cell.percentage === undefined)));
});
