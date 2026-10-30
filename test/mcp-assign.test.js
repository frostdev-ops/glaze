// Assignments and rubrics for agent apps (lib/mcp/tools-assign.js, lib/mcp/tab.js assignment): the graded work on an account's
// planner, and one assignment read in its own tab from the LMS's own shapes (test/fixtures: Canvas's assignment API, Ultra's
// content item, gradebook rows and rubric column, a row never opened with no userId), its definition only, never the
// student's scores; kept with its time for when no tab is open, the 100 used last; fitted to an answer; and through the worker.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./helpers/mcp-caches.cjs');
const H = require('./helpers/mcp-tabs.cjs');
const T = require('../lib/ai/tools.js');
const TABS = require('../lib/mcp/tabs.js');
const AS = require('../lib/mcp/tools-assign.js');

const A = `${C.CANVAS}/5`, UL = `${C.ULTRA}/${C.ULTRA_UID}`;
const CANVAS_A = C.load('canvas-assignment-api.json');
const ULTRA_ROWS = C.load('ultra-writer-gradebook.json'), ULTRA_ITEM = C.load('ultra-writer-content.json'), ULTRA_RUBRIC = C.load('ultra-rubric-numeric.json');
const COLUMN = { ...ULTRA_RUBRIC.column, id: '_810_1', contentId: '_7_1', rubricAssociations: ULTRA_RUBRIC.column.rubricAssociations.map((a) => ({ ...a, entityId: '_810_1' })) };
// Ultra's planner as lib/ultra.js planner() makes it, To Do joined with each course's gradebook rows, kept as the list keeps it.
const ultraPlan = async () => {
  const U = require('../lib/ultra.js'), L = require('../lib/todo.js');
  const rows = { _101_1: C.ultraRows('grades'), _102_1: C.ultraRows('grades-status') };
  const at = C.NOW - 60e3, key = `todo:${UL}`, data = {};
  const cache = { key, at, start: new Date(at - 8 * 864e5).toISOString(), end: new Date(at + 30 * 864e5).toISOString(), teach: true, progress: true,
    items: U.due({ todo: [C.load('ultra-todo.json')], rows, names: { _101_1: 'BIO 1100', _102_1: 'ENG 1100' }, now: at }).map((i) => ({ ...i, url: C.ULTRA + i.url })), complete: true, grading: [], sums: {} };
  assert.ok((await L.change({ key, cache }, { local: H.writerArea(data) })).ok);
  return data.todoCache;
};
const reg = (deps) => { const r = T.registry(); AS.register(r, deps); return r; };
const store = (data = {}) => {
  const s = { ...data };
  const local = { ...C.area(s), set: async (p) => { Object.assign(s, structuredClone(p)); }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; } };
  local.get = C.area(s).get.bind({ reads: [] });
  return { s, local, ctx: (account, more = {}) => ({ account, local, keys: async () => Object.keys(s), now: () => C.NOW, ...more }) };
};
const tabsOf = (tabs) => { const b = H.browser(tabs); return { b, tabs: TABS.create({ tabs: b.tabs, scripting: b.scripting, quiet: H.quiet }) }; };
const canvasTab = (o = {}) => H.tab({ id: 1, url: `${C.CANVAS}/courses/25/assignments/171`, ...o, routes: { '/api/v1/courses/25/assignments/171': CANVAS_A, ...o.routes } });
const ultraTab = (rows = ULTRA_ROWS, o = {}) => H.tab({ id: 2, url: `${C.ULTRA}/ultra/courses/_101_1/outline`, site: 'ultra', uid: C.ULTRA_UID, memberships: C.load('ultra-memberships.json').results, ...o, routes: {
  '/learn/api/v1/courses/_101_1/gradebook/grades': rows, '/learn/api/v1/courses/_101_1/gradebook/columns/_810_1': COLUMN, '/learn/api/v1/courses/_101_1/contents/_7_1': ULTRA_ITEM, ...o.routes } });

test('two tools in the assignments group, assignment_read needing a tab; a read is never a change', () => {
  const r = reg({});
  assert.deepEqual(r.list(), ['assignments_list', 'assignment_read']);
  for (const n of r.list()) assert.deepEqual([r.get(n).kind, r.get(n).group, r.get(n).scope], ['read', 'assignments', 'account']);
  assert.equal(r.get('assignment_read').needs, 'tab');
  assert.equal(r.get('assignments_list').needs, undefined, 'the call core refreshes its planner first');
});

test('assignments_list: graded work on the planner, with the id assignment_read takes', async () => {
  const raw = [
    C.planner({ id: 171, title: 'Lab report 2', at: '2026-10-23T03:59:00Z', sub: { submitted: true } }),
    { ...C.planner({ type: 'quiz', id: 12, course: 26, name: 'ENG 1100', title: 'Reading quiz', at: '2026-10-20T03:59:00Z' }), plannable: { title: 'Reading quiz', assignment_id: 512 } },
    { ...C.planner({ type: 'discussion_topic', id: 13, course: 26, name: 'ENG 1100', title: 'Graded thread', at: '2026-10-21T03:59:00Z' }), plannable: { title: 'Graded thread', assignment_id: 513 } },
    C.planner({ type: 'discussion_topic', id: 14, title: 'Ungraded thread', at: '2026-10-21T03:59:00Z' }),
    C.planner({ type: 'planner_note', id: 15, title: 'Buy goggles', at: '2026-10-19T03:59:00Z' }),
    C.planner({ type: 'wiki_page', id: 16, title: 'Read me', at: '2026-10-19T03:59:00Z' }),
  ];
  const { ctx } = store({ todoCache: await C.canvasPlan('5', raw) });
  const t = reg({}).get('assignments_list');
  const r = await t.run({}, ctx(A));
  assert.deepEqual(r.items.map((i) => [i.assignment, i.type, i.courseId, i.title]), [['171', 'assignment', '25', 'Lab report 2'], ['512', 'quiz', '26', 'Reading quiz'], ['513', 'discussion_topic', '26', 'Graded thread']]);
  assert.deepEqual(r.items[0], { assignment: '171', type: 'assignment', courseId: '25', course: 'BIO 1100', title: 'Lab report 2', due: Date.parse('2026-10-23T03:59:00Z'), url: `${C.CANVAS}/courses/25/assignments/171`, submitted: true, graded: false, late: false, missing: false });
  assert.equal(r.account, A);
  assert.ok(r.at && r.covers.complete === true);
  assert.deepEqual((await t.run({ course: '26' }, ctx(A))).items.map((i) => i.assignment), ['512', '513']);
  // Ultra's: by the content item of the gradebook column each To Do item names (lib/ultra.js due, as its planner joins them).
  const u = store({ todoCache: await ultraPlan() });
  const ul = await t.run({}, u.ctx(UL));
  assert.deepEqual(ul.items.map((i) => [i.assignment, i.courseId]).sort(), [['_703_1', '_101_1'], ['_706_1', '_101_1'], ['_713_1', '_102_1']]);
  assert.ok(ul.items.every((i) => i.url.startsWith(`${C.ULTRA}/ultra/redirect?`)), JSON.stringify(ul.items));
  // Another account's planner, or none.
  const none = await t.run({}, ctx(`${C.CANVAS}/6`));
  assert.deepEqual([none.at, none.items], [null, []]);
  assert.match(none.missing, /Open the Dashboard/);
  assert.deepEqual(await t.run({}, ctx('nope')), { ok: false, error: 'Unknown account.' });
});

test('assignment_read on Canvas: the assignment through its tab, its text, its files\' names and its rubric, never a submission', async () => {
  const tab = canvasTab();
  const { tabs } = tabsOf([tab]);
  const { s, ctx } = store();
  const r = await reg({ tabs }).get('assignment_read').run({ course: '25', assignment: '171' }, ctx(A));
  assert.equal(r.source, 'tab');
  assert.equal(r.at, C.NOW);
  assert.deepEqual([r.account, r.course, r.assignment, r.title, r.due, r.points], [A, '25', '171', 'Lab report 2: Enzyme activity', Date.parse('2026-10-23T03:59:00Z'), 20]);
  assert.match(r.instructions, /^Instructions for Lab report 2: Enzyme activity\. Follow the rubric & cite the lab manual\.\nLab manual\.pdf/);
  assert.ok(!/<|&amp;|&nbsp;/.test(r.instructions), 'text, not HTML');
  assert.deepEqual(r.files, ['Lab manual.pdf', 'Data sheet.xlsx'], 'files on the school\'s site, by their names; a page and another site\'s link are not');
  assert.equal(r.rubric.title, 'Lab report rubric');
  assert.equal(r.rubric.total, 20);
  assert.deepEqual(r.rubric.criteria.map((c) => [c.label, c.points, c.cells.map((x) => x.value)]), [['Method', 10, [10, 5, 0]], ['Analysis', 10, [10, 5, 0]]]);
  assert.equal(r.rubric.criteria[0].cells[0].detail, 'Every step and amount.');
  assert.ok(!/"(score|result|comment|possible)":/.test(JSON.stringify(r)), 'no result');
  assert.deepEqual(tab.page.asked.map((x) => new URL(x.url).pathname), ['/api/v1/users/self/profile', '/api/v1/courses/25/assignments/171'], 'identity and assignment only, no submission is read');
  // Kept, with its time, under its own key, and first in the index.
  const key = `mcpRubric:${A}/25/171`;
  assert.equal(s[key].at, C.NOW);
  assert.equal(s[key].rubric.title, 'Lab report rubric');
  assert.deepEqual(s.mcpRubrics, [key]);
  // A teacher showing letters only: no points anywhere.
  const q = canvasTab({ id: 3, routes: { '/api/v1/courses/25/assignments/171': { ...CANVAS_A, restrict_quantitative_data: true } } });
  const qr = await reg({ tabs: tabsOf([q]).tabs }).get('assignment_read').run({ course: '25', assignment: '171' }, store().ctx(A));
  assert.equal(qr.points, null);
  assert.ok(qr.rubric.criteria.every((c) => c.points === null && c.cells.every((x) => x.value === null)));
});

test('assignment_read on Ultra: as Writer reads it, the rubric of an item never opened (its row has no userId) too, and no attempt', async () => {
  const tab = ultraTab();
  const r = await reg({ tabs: tabsOf([tab]).tabs }).get('assignment_read').run({ course: '_101_1', assignment: '_7_1' }, store().ctx(UL));
  assert.equal(r.source, 'tab', JSON.stringify(r));
  assert.deepEqual([r.title, r.due, r.points], ['Essay 2: Memory in Beloved', Date.parse('2026-09-21T03:59:00.000Z'), 100]);
  assert.equal(r.instructions, 'Essay 2 Write 1,200 words on memory in Beloved. Submit a Word document.');
  assert.equal(r.description, 'A 1,200-word close reading.\nCite at least two critics in MLA style.');
  assert.equal(r.rubric.title, 'Synthetic points rubric');
  assert.ok(!tab.page.asked.some((x) => x.url.includes('/gradebook/attempts/')), 'no attempt, so no evaluation');
  // Ultra's row for an item never opened (live, 2026-10-27): no userId, an UNOPENED status.
  const KEEP = ['columnId', 'courseId', 'averageScore', 'submissionStatus', 'column', 'isCorrupt', 'columnUrl'];
  const rows = { ...ULTRA_ROWS, results: ULTRA_ROWS.results.map((x) => (x.column?.contentId === '_7_1' ? { ...Object.fromEntries(Object.entries(x).filter(([k]) => KEEP.includes(k))), submissionStatus: { actionCount: null, status: 'UNOPENED' } } : x)) };
  const fresh = await reg({ tabs: tabsOf([ultraTab(rows, { id: 4 })]).tabs }).get('assignment_read').run({ course: '_101_1', assignment: '_7_1' }, store().ctx(UL));
  assert.equal(fresh.rubric?.title, 'Synthetic points rubric');
  assert.equal(fresh.rubric.detail, 'Synthetic guidance.', 'Ultra\'s rich text as text');
  // Ultra's files, by name (test/fixtures/ultra-writer-attach-content.json, on its own school's site).
  const SCHOOL = 'https://bb.school.example.edu', att = C.load('ultra-writer-attach-content.json');
  const withFiles = ultraTab(ULTRA_ROWS, { id: 5, url: `${SCHOOL}/ultra/courses/_101_1/outline`, routes: { '/learn/api/v1/courses/_101_1/contents/_7_1': { ...att, id: '_7_1', courseId: '_101_1' } } });
  const f = await reg({ tabs: tabsOf([withFiles]).tabs }).get('assignment_read').run({ course: '_101_1', assignment: '_7_1' }, store().ctx(`${SCHOOL}/${C.ULTRA_UID}`));
  assert.ok(f.files.length > 0 && f.files.every((n) => typeof n === 'string' && !n.includes('/')), JSON.stringify(f));
});

test('no tab: Glaze\'s last read, dated; none kept, or an assignment the site doesn\'t have, says so', async () => {
  const { s, ctx } = store();
  const run = (tabs, args = { course: '25', assignment: '171' }, c = ctx(A)) => reg({ tabs }).get('assignment_read').run(args, c);
  assert.deepEqual(await run(tabsOf([]).tabs), { ok: false, error: 'Open school.instructure.com in this browser, signed in as this account, so Glaze can read this assignment there.' });
  await run(tabsOf([canvasTab()]).tabs, undefined, ctx(A, { now: () => C.NOW - 5000 }));
  const kept = await run(tabsOf([]).tabs);
  assert.deepEqual([kept.source, kept.at, kept.title, kept.rubric.title], ['cache', C.NOW - 5000, 'Lab report 2: Enzyme activity', 'Lab report rubric']);
  // A tab whose read fails answers from the kept read; one where the site has no such assignment says so.
  const broken = canvasTab({ id: 6, routes: { '/api/v1/courses/25/assignments/171': () => H.json({}, 500) } });
  assert.equal((await run(tabsOf([broken]).tabs)).source, 'cache');
  const gone = canvasTab({ id: 7, routes: { '/api/v1/courses/25/assignments/171': () => H.json({ errors: [] }, 404) } });
  assert.deepEqual(await run(tabsOf([gone]).tabs), { ok: false, error: 'school.instructure.com has no such assignment for this account; assignments_list names them.' });
  // Ids of the other LMS, or none, ask nothing.
  for (const args of [{ course: '_101_1', assignment: '171' }, { course: '25', assignment: '../x' }, {}]) {
    assert.deepEqual(await run(tabsOf([canvasTab({ id: 8 })]).tabs, args), { ok: false, error: 'course and assignment are ids from assignments_list.' });
  }
  assert.ok(Object.keys(s).every((k) => k === 'mcpRubrics' || k.startsWith('mcpRubric:')));
});

test('a long assignment is fitted to an answer, cut and marked; the 100 used last are kept', async () => {
  const long = { ...CANVAS_A, description: `<p>${'Read the whole lab manual before you start. '.repeat(1500)}</p>`,
    rubric: CANVAS_A.rubric.map((c) => ({ ...c, long_description: 'Criterion detail. '.repeat(200), ratings: c.ratings.map((x) => ({ ...x, long_description: 'Level detail. '.repeat(200) })) })) };
  const { s, ctx } = store();
  const r = await reg({ tabs: tabsOf([canvasTab({ routes: { '/api/v1/courses/25/assignments/171': long } })]).tabs }).get('assignment_read').run({ course: '25', assignment: '171' }, ctx(A));
  assert.equal(r.cut, true);
  assert.ok(JSON.stringify(r).length <= AS.LIMIT.answer + 200, String(JSON.stringify(r).length));
  assert.ok(r.instructions.length > 1000 && r.instructions.endsWith('…'));
  assert.equal(r.rubric.criteria.length, 2);
  // The index: the latest first, at most LIMIT.keep; the one used longest ago goes, and a read used again moves up.
  const many = store();
  const fake = { run: async (a, op, args) => ({ ok: true, title: `A${args.assignment}`, instructions: '', description: '', files: [], rubric: null }) };
  const t = reg({ tabs: fake }).get('assignment_read');
  for (let i = 1; i <= AS.LIMIT.keep; i++) await t.run({ course: '25', assignment: String(i) }, many.ctx(A));
  await reg({ tabs: { run: async () => null } }).get('assignment_read').run({ course: '25', assignment: '1' }, many.ctx(A));
  await t.run({ course: '25', assignment: '101' }, many.ctx(A));
  const kept = Object.keys(many.s).filter((k) => k.startsWith('mcpRubric:'));
  assert.equal(kept.length, AS.LIMIT.keep);
  assert.ok(!kept.includes(`mcpRubric:${A}/25/2`), 'the one used longest ago is gone');
  assert.ok(kept.includes(`mcpRubric:${A}/25/1`), 'the one used again stays');
  assert.deepEqual(many.s.mcpRubrics.slice(0, 2), [`mcpRubric:${A}/25/101`, `mcpRubric:${A}/25/1`]);
  assert.ok(s.mcpRubrics.length === 1);
});

test('through the worker: assignments_list and assignment_read in the assignments group, read in the account\'s tab', async () => {
  const tab = canvasTab({ id: 9 });
  const env = await H.boot({ local: { todoCache: await C.canvasPlan('5', [C.planner({ id: 171, title: 'Lab report 2', at: '2026-10-23T03:59:00Z' })]) }, tabs: [tab] });
  try {
    const a = await H.conn(env.w);
    const list = (await a.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
    const read = list.find((t) => t.name === 'assignment_read');
    assert.deepEqual([read._meta['io.frostdev.glaze/group'], read._meta['io.frostdev.glaze/needs'], read.annotations.readOnlyHint], ['assignments', 'tab', true]);
    const l = await a.call(2, 'assignments_list');
    assert.deepEqual(l.result.structuredContent.items.map((i) => i.assignment), ['171']);
    const r = await a.call(3, 'assignment_read', { course: '25', assignment: '171' });
    assert.equal(r.result.isError, undefined, JSON.stringify(r));
    assert.deepEqual([r.result.structuredContent.source, r.result.structuredContent.rubric.title], ['tab', 'Lab report rubric']);
    assert.ok(r.result.structuredContent.ageSeconds <= 1);
    assert.ok(env.store.local[`mcpRubric:${A}/25/171`]);
  } finally { await H.off(env); }
});

test('assignment_read accepts only bounded rubric definition fields from tabs and storage', async () => {
  const rubric = { title: 'Definition', total: 10, kind: 'points', score: 8, feedback: 'Private feedback', levels: [{ id: 'l', label: 'Good', selected: true }],
    criteria: [{ id: 'c', label: 'Method', detail: 'Explain', points: 10, score: 8, comment: 'Private comment', cells: [{ level: 'l', detail: 'Complete', value: 10, selected: true, result: 8 }] }] };
  const { s, ctx } = store(), key = `mcpRubric:${A}/25/171`;
  const t = reg({ tabs: { run: async () => ({ ok: true, title: 'Assignment', rubric }) } }).get('assignment_read');
  const r = await t.run({ course: '25', assignment: '171' }, ctx(A));
  assert.ok(!/"(score|feedback|comment|selected|result)":/.test(JSON.stringify(r)));
  s[key].rubric = rubric;
  const cached = await reg({}).get('assignment_read').run({ course: '25', assignment: '171' }, ctx(A));
  assert.ok(!/"(score|feedback|comment|selected|result)":/.test(JSON.stringify(cached)));
  const huge = { ...rubric, criteria: Array.from({ length: 200 }, (_, i) => ({ ...rubric.criteria[0], id: String(i), label: 'Label'.repeat(100), cells: Array(100).fill(rubric.criteria[0].cells[0]) })) };
  const large = await reg({ tabs: { run: async () => ({ ok: true, rubric: huge }) } }).get('assignment_read').run({ course: '25', assignment: '171' }, ctx(A));
  assert.ok(JSON.stringify(s[key]).length <= AS.LIMIT.answer);
  assert.equal(large.cut, true);
});

test('cancelling an assignment read before delivery keeps nothing', async () => {
  const ac = new AbortController(), { s, ctx } = store();
  const t = reg({ tabs: { run: async () => { ac.abort(); return { ok: true, title: 'Late' }; } } }).get('assignment_read');
  await assert.rejects(t.run({ course: '25', assignment: '171' }, ctx(A, { signal: ac.signal })));
  assert.deepEqual(s, {});
});

test('rubric purge clears its index and blocks a read already in flight from restoring private data', async () => {
  const one = `mcpRubric:${A}/25/171`, other = `mcpRubric:${C.CANVAS}/6/25/171`;
  const { s, local, ctx } = store({ [one]: { at: C.NOW }, [other]: { at: C.NOW }, mcpRubrics: [one, other], unrelated: true });
  assert.equal(typeof AS.clear, 'function');
  await AS.clear({ local }, A);
  assert.equal(s[one], undefined);
  assert.deepEqual(s.mcpRubrics, [other]);
  let deliver, started;
  const begun = new Promise((res) => { started = res; });
  const t = reg({ tabs: { run: () => new Promise((res) => { deliver = res; started(); }) } }).get('assignment_read');
  const pending = t.run({ course: '25', assignment: '171' }, ctx(A));
  await begun;
  await AS.clear({ local });
  deliver({ ok: true, title: 'Private' });
  await pending;
  assert.deepEqual(s, { unrelated: true });
});

test('worker wiring purges rubric data on agent off, Forget all apps and site removal', async () => {
  for (const message of [{ type: 'glaze:mcp-config', op: 'set', on: false }, { type: 'glaze:mcp-config', op: 'forget' }, { type: 'glaze:sites', op: 'remove', origin: C.CANVAS }]) {
    const key = `mcpRubric:${A}/25/171`, env = await H.boot({ local: { [key]: { at: C.NOW }, mcpRubrics: [key] } });
    try {
      const r = await env.w.send(message, { id: 'glaze', tab: { id: 11 }, frameId: 0, url: 'chrome-extension://x/options.html' });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(env.store.local[key], undefined, JSON.stringify(message));
      assert.ok(!env.store.local.mcpRubrics?.includes(key));
    } finally { await H.off(env); }
  }
});

test('a read begun during a rubric purge cannot recreate the cleared index', async () => {
  const key = `mcpRubric:${A}/25/171`, { s, local, ctx } = store({ [key]: { at: C.NOW, title: 'Private' }, mcpRubrics: [key] });
  let release, started;
  const gate = new Promise((res) => { release = res; }), removing = new Promise((res) => { started = res; }), remove = local.remove;
  local.remove = async (keys) => { started(); await gate; return remove(keys); };
  const clearing = AS.clear({ local });
  await removing;
  const reading = reg({}).get('assignment_read').run({ course: '25', assignment: '171' }, ctx(A));
  await H.pause(5);
  release();
  await clearing;
  await reading;
  assert.deepEqual(s, {});
});

test('rubric numbers come back as the site means them, not with float noise (live Ultra, 2026-10-30: 0.7000000000000001)', () => {
  const r = require('../lib/mcp/tools-assign.js').clean({ title: 'T', points: 5.000000000000001,
    rubric: { title: 'R', total: 5, levels: [{ id: 'a', label: 'Proficient' }], criteria: [{ id: 'c', label: 'Create the first table', points: 0.14 * 5, weight: 14.000000000000002,
      cells: [{ level: 'a', detail: '', value: 0.1 + 0.2 }] }] } });
  assert.equal(r.points, 5);
  assert.deepEqual([r.rubric.criteria[0].points, r.rubric.criteria[0].weight, r.rubric.criteria[0].cells[0].value], [0.7, 14, 0.3]);
});
