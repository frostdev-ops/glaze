// Mod tools (lib/modtools.js): mod.json's `tools`, checked as strictly as the rest of mod.json; each source's fields held to
// what lib/modbroker.js answers with; the declarative runner; the descriptors the tool registry lists; and the editor's
// consent lines for them (lib/editor-mods.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/modtools.js');
const B = require('../lib/modbroker.js');
const S = require('../lib/ai/schema.js');
const R = require('../lib/ai/request.js');
const E = require('../lib/editor-mods.js');

const ID = 'abcdefghijklmnop';
const SITE = 'https://school.instructure.com';
const P = (...ids) => ids.map((id) => ({ id, why: 'Answers the app.' }));
const DUE = { name: 'due_soon', title: 'Due soon', description: 'Open to-dos due in the next week, soonest first.', from: 'todo',
  select: ['title', 'course', 'due', 'url'], where: [{ field: 'done', eq: false }, { field: 'due', days: 7 }], sort: { field: 'due', order: 'asc' }, limit: 20, input: { course: true, days: true } };
const WEEK = { name: 'week', title: 'This week', description: 'Everything with a due date.', from: 'schedule', input: { days: true } };
const COURSES = { name: 'courses', title: 'Courses', description: 'Every course.', from: 'courses' };
const GRADES = { name: 'recent_grades', title: 'Recent grades', description: 'Grades read in the last month.', from: 'grades',
  where: [{ field: 'at', days: -30 }, { field: 'percent', eq: null }], sort: { field: 'percent', order: 'desc' }, input: {} };
const ASK = { name: 'ask_garden', title: 'Ask the garden', description: 'What the garden would say.', code: true,
  input: { type: 'object', properties: { question: { type: 'string', maxLength: 200 } }, required: ['question'], additionalProperties: false } };
const MANIFEST = { glaze: 1, name: 'Due Soon', version: '1.0.0', author: { name: 'Kai', key: 'k' }, permissions: P('agents', 'todo', 'courses', 'grades'), hooks: 'hooks.js' };
const said = (f) => (e) => e instanceof Error && e.why === "That mod's mod.json has a value Glaze can't use ({field})." && e.vars?.field === f
  && e.message === `That mod's mod.json has a value Glaze can't use (${f}).`;
const refuses = (tools, f, manifest = MANIFEST) => assert.throws(() => T.clean(tools, manifest), said(f), `${JSON.stringify(tools).slice(0, 160)} → ${f}`);

test('each source\'s fields are the keys lib/modbroker.js answers with, in its order', async () => {
  const data = {
    todoCache: { key: `todo:${SITE}/5`, items: [{ type: 'assignment', id: '9', cid: '42', course: 'Chem', title: 'Lab', at: 1700000000000, url: '/courses/42/assignments/9', sub: { submitted: true }, ov: { done: true } }] },
    seenCourses: { [`canvas:${SITE}/42`]: { name: 'Chem', code: 'CH', color: '#aabbcc' } },
    [`insights:${SITE}/5`]: { at: 10, courses: [{ id: '42', name: 'Chem', trend: [[1, 91.5]] }] },
  };
  const env = { site: SITE, account: async () => '5', keys: async () => Object.keys(data),
    local: { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, data[x]]))) } };
  const args = { todo: [], schedule: [1699999999000, 1700000001000], courses: [], grades: [] };
  assert.deepEqual(T.SOURCES, ['todo', 'schedule', 'courses', 'grades']);
  assert.deepEqual(Object.keys(T.FIELDS), T.SOURCES);
  for (const from of T.SOURCES) {
    const got = await B.CALLS[from].run(args[from], env);
    assert.equal(got.length, 1, from);
    assert.deepEqual(Object.keys(got[0]), Object.keys(T.FIELDS[from]), from);
  }
  assert.deepEqual(T.KEYS, { data: ['name', 'title', 'description', 'from', 'select', 'where', 'sort', 'limit', 'input'], code: ['name', 'title', 'description', 'code', 'input'] });
});

test('clean: declarative and code tools come back exactly as written, and checking them again changes nothing', () => {
  const tools = [DUE, COURSES, WEEK, GRADES, ASK];
  const copy = structuredClone(tools);
  assert.equal(T.clean(tools, MANIFEST), tools);
  assert.deepEqual(tools, copy);
  assert.equal(T.clean(structuredClone(tools), MANIFEST).length, 5);
  assert.deepEqual(T.clean([], { ...MANIFEST, permissions: [] }), [], 'no tools need nothing');
  assert.deepEqual(T.caps({ tools }), ['tool:due_soon@todo', 'tool:courses@courses', 'tool:week@schedule', 'tool:recent_grades@grades', 'tool:ask_garden@code']);
  assert.deepEqual(T.caps({}), []);
  assert.deepEqual(T.needs(tools), ['agents', 'courses', 'grades', 'todo']);
  assert.deepEqual(T.needs([WEEK]), ['agents', 'todo'], 'a schedule reads the plan');
  assert.deepEqual(T.needs([ASK]), ['agents']);
  assert.deepEqual(T.needs([]), []);
  // At the limits: eight tools, a 24-character name, a 60-character title, a 500-character description, 200 items, 8 tests.
  assert.equal(T.clean(Array.from({ length: 8 }, (_, i) => ({ ...DUE, name: `t${i}` })), MANIFEST).length, 8);
  assert.ok(T.clean([{ ...DUE, name: `a${'_1'.repeat(11)}b`, title: 'x'.repeat(60), description: 'y'.repeat(500), limit: 200, where: Array.from({ length: 8 }, () => ({ field: 'missing', eq: true })) }], MANIFEST));
  assert.ok(T.clean([{ ...DUE, where: [{ field: 'due', days: -366 }, { field: 'due', days: 366 }, { field: 'due', eq: 1700000000000 }, { field: 'title', eq: '' }] }], MANIFEST));
  assert.ok(T.clean([{ ...COURSES, where: [{ field: 'color', eq: null }, { field: 'color', eq: '#AABBCC' }], select: ['name', 'id'], input: { course: true } }], MANIFEST));
  assert.ok(T.clean([{ ...ASK, input: undefined }].map(({ input, ...t }) => t), MANIFEST), 'a code tool may take no arguments');
});

test('clean: every refusal names its field', () => {
  const with_ = (base, patch) => { const t = { ...base, ...patch }; for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k]; return [t]; };
  const d = (patch) => with_(DUE, patch), c = (patch) => with_(ASK, patch);
  refuses({}, 'tools');
  refuses('due_soon', 'tools');
  refuses(Array.from({ length: 9 }, (_, i) => ({ ...DUE, name: `t${i}` })), 'tools');
  for (const t of [7, null, [], 'x']) refuses([t], 'tools.0');
  refuses(JSON.parse(`[${JSON.stringify(DUE).replace('{', '{"__proto__":{"x":1},')}]`), 'tools.0');
  const cases = [
    [d({ extra: 1 }), 'tools.0'], [d({ name: undefined }), 'tools.0'], [d({ title: undefined }), 'tools.0'], [d({ description: undefined }), 'tools.0'],
    [d({ from: undefined }), 'tools.0'], [d({ code: true }), 'tools.0'], [c({ from: 'todo' }), 'tools.0'], [c({ select: ['title'] }), 'tools.0'], [c({ code: undefined }), 'tools.0'],
    ...['Due', '1due', '_due', 'due-soon', 'due soon', 'a'.repeat(25), 'é', '', 7, null].map((name) => [d({ name }), 'tools.0.name']),
    [[DUE, { ...WEEK, name: 'due_soon' }], 'tools.1.name'],
    ...['', ' Due', 'Due ', 'Du  e', 'x'.repeat(61), 'two\nlines', 'a‮b', 'a\u0007b', 3, null].map((title) => [d({ title }), 'tools.0.title']),
    ...['', 'x'.repeat(501), 'a\u0000b', 'tab\there', ['x'], 5].map((description) => [d({ description }), 'tools.0.description']),
    ...['plan', 'nav.read', 'Todo', '__proto__', 'toString', 7, null].map((from) => [d({ from }), 'tools.0.from']),
    [d({ select: [] }), 'tools.0.select'], [d({ select: 'title' }), 'tools.0.select'], [d({ select: {} }), 'tools.0.select'],
    [d({ select: ['title', 'note'] }), 'tools.0.select.1'], [d({ select: ['title', 'title'] }), 'tools.0.select.1'], [d({ select: ['percent'] }), 'tools.0.select.0'],
    [d({ select: ['name'] }), 'tools.0.select.0'], [d({ select: [7] }), 'tools.0.select.0'], [d({ select: ['__proto__'] }), 'tools.0.select.0'],
    [with_(COURSES, { select: ['courseId'] }), 'tools.0.select.0'], [with_(GRADES, { select: ['code'] }), 'tools.0.select.0'],
    [d({ where: {} }), 'tools.0.where'], [d({ where: Array.from({ length: 9 }, () => ({ field: 'done', eq: false })) }), 'tools.0.where'],
    [d({ where: [7] }), 'tools.0.where.0'], [d({ where: [{ field: 'done' }] }), 'tools.0.where.0'], [d({ where: [{ eq: false }] }), 'tools.0.where.0'],
    [d({ where: [{ field: 'done', eq: false, days: 1 }] }), 'tools.0.where.0'], [d({ where: [{ field: 'done', eq: false, x: 1 }] }), 'tools.0.where.0'],
    [d({ where: [{ field: 'done', eq: false }, { field: 'note', eq: 'x' }] }), 'tools.0.where.1.field'], [d({ where: [{ field: 7, eq: 'x' }] }), 'tools.0.where.0.field'],
    ...[['done', 'false'], ['done', null], ['done', 0], ['title', 3], ['title', null], ['title', 'x'.repeat(301)], ['title', {}], ['due', 1.5], ['due', 'soon'], ['due', -1], ['due', true],
      ['url', ['x']]].map(([field, eq]) => [d({ where: [{ field, eq }] }), 'tools.0.where.0.eq']),
    [with_(COURSES, { where: [{ field: 'color', eq: 'red' }] }), 'tools.0.where.0.eq'], [with_(GRADES, { where: [{ field: 'percent', eq: Infinity }] }), 'tools.0.where.0.eq'],
    [with_(GRADES, { where: [{ field: 'percent', eq: '90' }] }), 'tools.0.where.0.eq'],
    ...[['title', 7], ['done', 7], ['due', 0], ['due', 1.5], ['due', 367], ['due', -367], ['due', '7'], ['due', null]].map(([field, days]) => [d({ where: [{ field, days }] }), 'tools.0.where.0.days']),
    [with_(GRADES, { where: [{ field: 'percent', days: 7 }] }), 'tools.0.where.0.days'],
    [d({ sort: 'due' }), 'tools.0.sort'], [d({ sort: { field: 'due' } }), 'tools.0.sort'], [d({ sort: { order: 'asc' } }), 'tools.0.sort'], [d({ sort: { field: 'due', order: 'asc', x: 1 } }), 'tools.0.sort'],
    [d({ sort: { field: 'note', order: 'asc' } }), 'tools.0.sort.field'], [d({ sort: { field: 'due', order: 'up' } }), 'tools.0.sort.order'], [d({ sort: { field: 'due', order: 'ASC' } }), 'tools.0.sort.order'],
    ...[0, 201, 1.5, '20', null, -1].map((limit) => [d({ limit }), 'tools.0.limit']),
    [d({ input: [] }), 'tools.0.input'], [d({ input: { page: true } }), 'tools.0.input'], [d({ input: null }), 'tools.0.input'],
    [d({ input: { course: false } }), 'tools.0.input.course'], [d({ input: { course: 1 } }), 'tools.0.input.course'], [d({ input: { days: 'yes' } }), 'tools.0.input.days'],
    [with_(COURSES, { input: { days: true } }), 'tools.0.input.days'],
    ...[1, false, 'true'].map((code) => [c({ code }), 'tools.0.code']),
    ...[{ type: 'string' }, { type: ['object'] }, { properties: {} }, { type: 'object', properties: { reason: { type: 'string' } } }, { type: 'object', $ref: '#' },
      { type: 'object', properties: { q: { type: 'string', format: 'email' } } }, 'object', null, []].map((input) => [c({ input }), 'tools.0.input']),
  ];
  for (const [tools, f] of cases) refuses(tools, f);
  // What the rest of mod.json must give the tools.
  refuses([ASK], 'tools.0.code', { ...MANIFEST, hooks: undefined });
  refuses([ASK], 'permissions', { ...MANIFEST, permissions: P('todo') });
  refuses([ASK], 'permissions', { ...MANIFEST, permissions: undefined });
  for (const [tool, perms] of [[DUE, ['agents', 'courses', 'grades']], [WEEK, ['agents', 'courses']], [COURSES, ['agents', 'todo']], [GRADES, ['agents', 'todo', 'courses']]]) {
    refuses([tool], 'tools.0.from', { ...MANIFEST, permissions: P(...perms) });
  }
  assert.ok(T.clean([DUE], { ...MANIFEST, permissions: P('todo', 'agents'), hooks: undefined }), 'a declarative tool needs no code');
});

test('apply: filters, sorts, limits and selects, with the app\'s course and days', () => {
  const NOW = Date.UTC(2026, 9, 29, 12), DAY = 864e5;
  const item = (id, o = {}) => ({ id, type: 'assignment', courseId: '42', course: 'Chem', title: `Item ${id}`, due: null, url: '', done: false, submitted: false, graded: false, late: false, missing: false, ...o });
  const items = [item('a', { due: NOW + 2 * DAY }), item('b', { due: NOW + 9 * DAY }), item('c', { due: NOW - DAY, missing: true }), item('d'),
    item('e', { due: NOW + DAY, done: true }), item('f', { due: NOW + 3 * DAY, courseId: '7', course: 'Art' }), item('g', { due: NOW + 2 * DAY, title: 'Item 0' })];
  const before = structuredClone(items);
  const run = (tool, args = {}, list = items) => T.apply({ name: 'x', title: 'X', description: 'X.', from: 'todo', ...tool }, list, args, NOW);
  const ids = (tool, args, list) => run({ select: ['id'], ...tool }, args, list).map((x) => x.id);

  // Nothing but the source: every item, every field, in the source's order; new objects, the items untouched.
  const all = run({});
  assert.deepEqual(all, items);
  assert.notEqual(all[0], items[0]);
  assert.deepEqual(Object.keys(all[0]), Object.keys(T.FIELDS.todo));
  // where: every test passes; days ahead and behind now, inclusive; eq exactly, null for no date.
  assert.deepEqual(ids({ where: [{ field: 'done', eq: false }, { field: 'due', days: 7 }], sort: { field: 'due', order: 'asc' } }), ['a', 'g', 'f']);
  assert.deepEqual(ids({ where: [{ field: 'due', days: -7 }] }), ['c']);
  assert.deepEqual(ids({ where: [{ field: 'due', days: 1 }] }), ['e']);
  assert.deepEqual(ids({ where: [{ field: 'due', eq: null }] }), ['d']);
  assert.deepEqual(ids({ where: [{ field: 'courseId', eq: '7' }] }), ['f']);
  assert.deepEqual(ids({ where: [{ field: 'courseId', eq: 7 }] }), [], 'eq is exact');
  // A schedule is the dated items.
  assert.deepEqual(ids({ from: 'schedule' }), ['a', 'b', 'c', 'e', 'f', 'g']);
  // The app's days: due from now to that many days ahead, only when the tool takes it, and only 1 to 60.
  assert.deepEqual(ids({ input: { days: true } }, { days: 3 }), ['a', 'e', 'f', 'g']);
  assert.deepEqual(ids({ from: 'schedule', input: { days: true } }, { days: 1 }), ['e']);
  assert.deepEqual(ids({}, { days: 3 }), ['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'a tool without input.days ignores days');
  for (const days of [0, 61, 2.5, '3', -3, null]) assert.equal(ids({ input: { days: true } }, { days }).length, 7, String(days));
  // The app's course: one course's items by id, only when the tool takes it.
  assert.deepEqual(ids({ input: { course: true } }, { course: '7' }), ['f']);
  assert.deepEqual(ids({ input: { course: true } }, { course: 7 }).length, 7, 'a course is an id string');
  assert.deepEqual(ids({ input: { course: true } }, { course: '' }).length, 7);
  assert.deepEqual(ids({}, { course: '7' }).length, 7, 'a tool without input.course ignores course');
  assert.deepEqual(ids({ input: { course: true, days: true } }, { course: '42', days: 2 }), ['a', 'e', 'g']);
  // sort: either way, empty values last, ties in the source's order, numbers in titles by value.
  assert.deepEqual(ids({ sort: { field: 'due', order: 'desc' } }), ['b', 'f', 'a', 'g', 'e', 'c', 'd']);
  assert.deepEqual(ids({ sort: { field: 'due', order: 'asc' } }), ['c', 'e', 'a', 'g', 'f', 'b', 'd']);
  assert.deepEqual(ids({ sort: { field: 'title', order: 'asc' } }), ['g', 'a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(ids({ sort: { field: 'missing', order: 'desc' } }), ['c', 'a', 'b', 'd', 'e', 'f', 'g']);
  assert.deepEqual(ids({ sort: { field: 'title', order: 'asc' } }, {}, [item('x', { title: 'Quiz 10' }), item('y', { title: 'Quiz 2' })]), ['y', 'x']);
  // limit after sorting; 200 at most, whatever the tool says.
  assert.deepEqual(ids({ sort: { field: 'due', order: 'desc' }, limit: 2 }), ['b', 'f']);
  const many = Array.from({ length: 250 }, (_, i) => item(String(i)));
  assert.equal(run({}, {}, many).length, 200);
  assert.equal(run({ limit: 500 }, {}, many).length, 200);
  // select: those fields, in that order; the sort field need not be one of them.
  assert.deepEqual(run({ select: ['due', 'id'], sort: { field: 'title', order: 'desc' }, limit: 1 }), [{ due: NOW + 3 * DAY, id: 'f' }]);
  // Only items that are objects, and only the source's fields.
  assert.deepEqual(ids({}, {}, [null, 7, 'x', item('z', { note: 'private words' })]), ['z']);
  assert.equal('note' in run({}, {}, [item('z', { note: 'private words' })])[0], false);
  assert.deepEqual(items, before);
  assert.deepEqual(T.apply({ from: 'todo' }, null, {}, NOW), [], 'no items');

  // Grades look back: read within the last days; courses by their own id.
  const grades = [{ courseId: '42', name: 'Chem', percent: 91, at: NOW - 2 * DAY }, { courseId: '7', name: 'Art', percent: null, at: NOW - 40 * DAY }];
  assert.deepEqual(run({ from: 'grades', input: { days: true }, select: ['name'] }, { days: 30 }, grades), [{ name: 'Chem' }]);
  assert.deepEqual(run({ from: 'grades', sort: { field: 'percent', order: 'asc' }, select: ['name'] }, {}, grades), [{ name: 'Chem' }, { name: 'Art' }], 'no grade sorts last');
  assert.deepEqual(run({ from: 'grades', where: [{ field: 'at', days: -7 }] }, {}, grades), [grades[0]]);
  const courses = [{ id: '42', name: 'Chem', code: 'CH', color: '#aabbcc' }, { id: '7', name: 'Art', code: 'AR', color: null }];
  assert.deepEqual(run({ from: 'courses', input: { course: true } }, { course: '7' }, courses), [courses[1]]);
  assert.deepEqual(run({ from: 'courses', where: [{ field: 'color', eq: null }], select: ['code'] }, {}, courses), [{ code: 'AR' }]);
});

test('defs: what the registry lists for a mod, named, grouped and marked as its author\'s', () => {
  const rec = (over = {}) => ({ id: ID, manifest: { ...MANIFEST, permissions: P('agents', 'todo', 'grades', 'network:api.example.com'), tools: [DUE, ASK, GRADES, WEEK] },
    grants: { agents: true, todo: true, 'network:api.example.com': true }, ...over });
  const got = T.defs(rec());
  // A tool whose data the student hasn't granted isn't listed.
  assert.deepEqual(got.map((x) => x.name), [`mod_${ID}_due_soon`, `mod_${ID}_ask_garden`, `mod_${ID}_week`]);
  const [due, ask, week] = got;
  assert.deepEqual(Object.keys(due), ['name', 'owner', 'group', 'kind', 'scope', 'title', 'description', 'parameters']);
  assert.deepEqual([due.owner, due.group, due.kind, due.scope], [`mod:${ID}`, `mod:${ID}`, 'read', 'account']);
  assert.equal(due.title, 'Due Soon (mod): Due soon');
  assert.equal(due.description, "Written by the mod's author, not Glaze. Open to-dos due in the next week, soonest first.");
  assert.deepEqual(Object.keys(due.parameters.properties), ['course', 'days']);
  assert.deepEqual([due.parameters.type, due.parameters.additionalProperties, due.parameters.required], ['object', false, undefined]);
  assert.deepEqual([due.parameters.properties.course.type, due.parameters.properties.course.minLength, due.parameters.properties.course.maxLength], ['string', 1, 40]);
  assert.deepEqual([due.parameters.properties.days.type, due.parameters.properties.days.minimum, due.parameters.properties.days.maximum], ['integer', 1, 60]);
  assert.deepEqual(Object.keys(week.parameters.properties), ['days']);
  // A code tool takes its own input, needs an open school page, and reaches the open world when the mod may use a network host.
  assert.deepEqual(ask.parameters, ASK.input);
  assert.notEqual(ask.parameters, ASK.input, 'a copy, never the stored manifest');
  assert.equal(ask.needs, 'tab');
  assert.deepEqual(ask.hints, { openWorld: true });
  assert.equal(due.needs, undefined);
  assert.equal(due.hints, undefined);
  const offline = T.defs(rec({ grants: { agents: true, todo: true } }))[1];
  assert.equal(offline.hints, undefined, 'no host granted');
  const bare = T.defs(rec({ manifest: { ...rec().manifest, tools: [{ name: 'ping', title: 'Ping', description: 'Pings.', code: true }] } }))[0];
  assert.deepEqual(bare.parameters, { type: 'object', properties: {}, additionalProperties: false });
  // Every descriptor is one the registry can take: its name rules, its limits and the schema subset, no `reason`.
  for (const x of [...got, bare]) {
    assert.match(x.name, /^mod_[a-z2-7]{16}_[a-z][a-z0-9_]{0,23}$/);
    assert.ok(R.NAME.test(x.name));
    assert.ok(x.title.length <= 120 && x.description.length <= 1024);
    assert.equal(S.clean(x.parameters), x.parameters);
    assert.equal(Object.hasOwn(x.parameters.properties, 'reason'), false);
  }
  // Nothing without the agents grant, or without tools.
  assert.deepEqual(T.defs(rec({ grants: { todo: true, grades: true } })), []);
  assert.deepEqual(T.defs(rec({ grants: undefined })), []);
  assert.deepEqual(T.defs(rec({ manifest: { ...MANIFEST } })), []);
  assert.deepEqual(T.defs(null), []);
  // A long title fits the registry's 120 after the mod's name and "(mod)" (a name is cut only past 40 UTF-16 units);
  // format and direction characters go.
  const long = T.defs(rec({ manifest: { ...rec().manifest, name: 'M'.repeat(40), tools: [{ ...ASK, title: 'T'.repeat(60) }] } }))[0];
  assert.equal(long.title, `${'M'.repeat(40)} (mod): ${'T'.repeat(60)}`);
  assert.ok(long.title.startsWith(`${'M'.repeat(40)} (mod): TTT`) && long.title.endsWith('T'.repeat(60)));
  const wide = T.defs(rec({ manifest: { ...rec().manifest, name: '🌱'.repeat(40), tools: [{ ...ASK, title: '🌿'.repeat(60), description: '🍃'.repeat(500) }] } }))[0];
  assert.ok(wide.title.length <= 120 && wide.description.length <= 1024, `${wide.title.length} ${wide.description.length}`);
  assert.ok(wide.title.includes(' (mod): ') && wide.description.startsWith("Written by the mod's author, not Glaze. 🍃"));
  assert.ok(wide.title.isWellFormed() && wide.description.isWellFormed(), 'no half a character');
  const hidden = T.defs(rec({ manifest: { ...rec().manifest, name: 'Due​Soon', tools: [{ ...ASK, title: 'Ask⁦ me', description: 'Hi‍ there.' }] } }))[0];
  assert.equal(hidden.title, 'DueSoon (mod): Ask me');
  assert.equal(hidden.description, "Written by the mod's author, not Glaze. Hi there.");
});

test('editor: the agents permission, one line per tool saying where its data comes from, and the code-tools warning', () => {
  const t = (k, vars = {}) => k.replace(/\{(\w+)\}/g, (s, n) => (n in vars ? String(vars[n]) : s));
  const and = (a) => a.join(' and ');
  const view = { ...MANIFEST, permissions: P('agents', 'todo', 'courses', 'grades'), tools: [DUE, WEEK, COURSES, GRADES, ASK] };
  const ls = E.lines(view, t);
  assert.deepEqual(ls.map((l) => [l.id, l.text]), [
    ['agents', 'Agent apps you connect in Settings → Agents can use this mod’s tools.'],
    ['todo', 'To Do — reads your to-dos, due dates and schedule.'],
    ['courses', 'Courses — reads the names and details of your courses.'],
    ['grades', 'Grades — reads your grades and GPA in every course.'],
    ['code', 'Runs its author’s code — Glaze doesn’t draw it itself.'],
    ['tool:due_soon@todo', 'Tool “Due soon” — gives agent apps your to-dos, as Glaze last read them.'],
    ['tool:week@schedule', 'Tool “This week” — gives agent apps your to-dos with due dates, as Glaze last read them.'],
    ['tool:courses@courses', 'Tool “Courses” — gives agent apps your courses, as Glaze last read them.'],
    ['tool:recent_grades@grades', 'Tool “Recent grades” — gives agent apps your grades, as Glaze last read them.'],
    ['tool:ask_garden@code', 'Tool “Ask the garden” — its author’s code answers, with what this mod may use.'],
  ]);
  assert.equal(ls[0].why, 'Answers the app.');
  assert.ok(ls.filter((l) => l.id.startsWith('tool:')).every((l) => l.why === '' && !l.fresh));
  assert.deepEqual(E.lines(view, t, ['tool:ask_garden@code']).filter((l) => l.fresh).map((l) => l.id), ['tool:ask_garden@code']);
  // Tool lines are told, never switched: only declared permissions have a grant to give or take back.
  for (const id of ['agents', 'todo', 'grades', 'network:a.example', 'nav.items']) assert.equal(E.grantable(id), true, id);
  for (const id of ['tool:due_soon@todo', 'tool:ask_garden@code', 'code', 'frame', 'bgfile', 'media:cdn.example']) assert.equal(E.grantable(id), false, id);
  // Code tools with network hosts: what an app asks for can leave with them. Declarative tools run none of the mod's code.
  const hosts = P('network:a.example', 'network:b.example');
  const warn = (v) => E.warnings(v, { t, and, signed: true, source: 'gallery', runs: true }).filter((w) => w.kind === 'tools').map((w) => w.text);
  assert.deepEqual(warn({ ...view, permissions: [...P('agents'), ...hosts], tools: [ASK] }), ['Its tools run its own code and can send what an app asks for to a.example and b.example.']);
  assert.deepEqual(warn({ ...view, permissions: [...P('agents', 'todo'), ...hosts], tools: [DUE] }), []);
  assert.deepEqual(warn({ ...view, permissions: P('agents'), tools: [ASK] }), []);
  // A widget Glaze draws, with tools: what it shows stays on the device, but the tools' answers don't, so it isn't worded as plain.
  const widget = { ...MANIFEST, hooks: undefined, permissions: P('todo'), ui: { tiles: [{ id: 'a', name: 'A', sizes: ['m'], blocks: [{ type: 'text', text: 'hi' }] }] } };
  assert.equal(E.plain(widget), true);
  assert.equal(E.plain({ ...widget, permissions: P('agents', 'todo'), tools: [DUE] }), false);
  assert.equal(E.lines({ ...widget, permissions: P('agents', 'todo'), tools: [DUE] }, t)[1].text, 'To Do — reads your to-dos, due dates and schedule.');
  assert.equal(E.plain({ ...widget, tools: [] }), true);
});

test('the editor loads the schema subset and lib/modtools.js before lib/modbundle.js, which work there as classic scripts', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('options.html');
  const at = ['lib/ai/schema.js', 'lib/modtools.js', 'lib/modbundle.js', 'lib/editor-mods.js'].map((f) => html.indexOf(`<script src="${f}"></script>`));
  assert.ok(at.every((x, i) => x > 0 && (i === 0 || x > at[i - 1])), String(at));
  // No require on a page: each finds the others as globals.
  const ctx = vm.createContext({ crypto: globalThis.crypto, TextEncoder, TextDecoder, btoa, atob, URL });
  for (const f of ['lib/ai/schema.js', 'lib/modtools.js', 'lib/modbundle.js']) vm.runInContext(read(f), ctx, { filename: f });
  const manifest = { ...MANIFEST, author: { name: 'Kai', key: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' }, tools: [DUE, ASK] };
  const got = vm.runInContext('(m) => { const c = GZ_MODBUNDLE.clean(m, { "hooks.js": new Uint8Array([49]) }); return JSON.stringify([c === m, GZ_MODBUNDLE.caps(m)]); }', ctx)(manifest);
  assert.deepEqual(JSON.parse(got), [true, ['agents', 'todo', 'courses', 'grades', 'code', 'tool:due_soon@todo', 'tool:ask_garden@code']]);
});
