// Live refresh for agent apps (lib/mcp/tabs.js, lib/mcp/tab.js): the account's own tab found by its origin and the account
// Glaze's content script there reads, never a quiet page or a discarded or frozen tab; the planner and Insights read afresh
// in it and kept through the page's own publish paths; nothing kept past its time; and the worker wiring for lib/background.js
// mcpRefresh, with a tools/call that answers from the tab.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const C = require('./helpers/mcp-caches.cjs');
const H = require('./helpers/mcp-tabs.cjs');
const TABS = require('../lib/mcp/tabs.js');

const A = `${C.CANVAS}/5`, UL = `${C.ULTRA}/${C.ULTRA_UID}`;
const RAW = [
  C.planner({ id: 1, title: 'Lab report', at: '2026-10-16T03:59:00Z' }),
  C.planner({ type: 'quiz', id: 2, course: 26, name: 'ENG 1100', title: 'Reading quiz', at: '2026-10-20T03:59:00Z' }),
];
const make = (tabs, o = {}) => { const b = H.browser(tabs); return { b, t: TABS.create({ tabs: b.tabs, scripting: b.scripting, quiet: H.quiet, ...o }) }; };
const probed = (b) => [...new Set(b.calls.filter((c) => c.func).map((c) => c.target.tabId))];
const canvasTab = (o = {}) => H.tab({ url: `${C.CANVAS}/`, ...o, routes: { '/api/v1/planner/items': RAW, ...o.routes } });
// Canvas's courses as /api/v1/courses?include[]=term… gives them to Insights (lib/insights.js term): this term's, as a student.
const TERM = { id: 5, name: 'Fall 2026', start_at: '2026-08-24T04:00:00Z', end_at: '2026-12-19T05:00:00Z' };
const insightsCourses = () => C.canvasGrades().map(({ course }) => ({ ...course, name: course.course_code, term: TERM, enrollments: [{ type: 'student', ...course.enrollment }] }));
const gradeRoutes = () => Object.fromEntries(C.canvasGrades().map((x) => [`/api/v1/courses/${x.course.id}/assignment_groups`, x.groups]));

test('find takes the account\'s own tab: its school\'s origin, its account in Glaze there, never a quiet page, a discarded or frozen tab', async () => {
  const tabs = [
    H.tab({ id: 1, url: 'https://other.instructure.com/', active: true }),
    H.tab({ id: 2, url: `${C.CANVAS}/courses/25/quizzes/3`, active: true }),
    H.tab({ id: 3, url: `${C.CANVAS}/courses/25/external_tools/9`, active: true }),
    H.tab({ id: 4, url: `${C.CANVAS}/`, discarded: true, status: 'unloaded', active: true }),
    H.tab({ id: 5, url: `${C.CANVAS}/`, frozen: true, active: true }),
    H.tab({ id: 6, url: `${C.CANVAS}/`, uid: '6', active: true }),
    H.tab({ id: 7 }),
    H.tab({ id: 8, url: `${C.CANVAS}/`, on: false, active: true }),
    H.tab({ id: 9, url: `${C.CANVAS}/courses/25`, lastAccessed: 50 }),
    H.tab({ id: 10, url: `${C.CANVAS}/`, lastAccessed: 10, active: true }),
  ];
  const { b, t } = make(tabs);
  assert.deepEqual(await t.find(A), { tabId: 10, documentId: 'doc-10' }, 'the active one first');
  assert.deepEqual(probed(b).sort((x, y) => x - y), [6, 8, 9, 10], 'only same-origin, live, non-quiet tabs are asked');
  assert.ok(b.calls.every((c) => c.target.frameIds?.length === 1 && c.target.frameIds[0] === 0), 'the top frame only');
  tabs[9].page.gone = true;
  assert.deepEqual(await t.find(A), { tabId: 9, documentId: 'doc-9' }, 'then the one used last');
  tabs[8].page.gone = true;
  assert.equal(await t.find(A), null);
  for (const bad of ['', 'nope', `${C.CANVAS}/x`, `${C.CANVAS}`, 42, null]) {
    const n = b.calls.length;
    assert.equal(await t.find(bad), null, String(bad));
    assert.equal(b.calls.length, n);
  }
});

test('a tab that does not answer the account in time is no tab', async () => {
  const { t } = make([canvasTab({ id: 1, hang: true })], { limit: { probe: 40 } });
  const at = Date.now();
  assert.equal(await t.find(A), null);
  assert.ok(Date.now() - at < 1000);
});

test('refresh reads the planner afresh in the tab and keeps it through glaze:todo, for the courses and assignments groups', async () => {
  const store = { todoCache: await C.canvasPlan('5', [C.planner({ id: 9, title: 'Old', at: '2026-10-16T03:59:00Z' })], Date.now() - 600e3) };
  const was = store.todoCache.at;
  const tab = canvasTab({ id: 3, store });
  const { b, t } = make([tab]);
  assert.deepEqual(await t.refresh(A, 'courses', { tool: 'todo_list' }), { ok: true, source: 'tab' });
  assert.equal(store.todoCache.key, `todo:${A}`);
  assert.ok(store.todoCache.at > was);
  assert.deepEqual(store.todoCache.items.map((i) => i.title), ['Lab report', 'Reading quiz']);
  const asked = tab.page.asked.find((r) => r.url.includes('/planner/items'));
  assert.match(asked.url, /^https:\/\/school\.instructure\.com\/api\/v1\/planner\/items\?start_date=.+&end_date=.+&per_page=100$/);
  assert.deepEqual([asked.method, asked.credentials], ['GET', 'same-origin']);
  assert.deepEqual(tab.page.sent.map((m) => [m.type, m.key]), [['glaze:todo', `todo:${A}`]], 'the page\'s own publish path');
  assert.ok(b.calls.some((c) => c.files?.[0] === 'lib/mcp/tab.js' && c.target.documentIds?.[0] === 'doc-3'), 'the tab side goes into the document that answered');
  assert.deepEqual(await t.refresh(A, 'assignments', { tool: 'assignments_list' }), { ok: true, source: 'tab' });
  assert.equal(tab.page.sent.length, 2);
});

test('refresh with no tab, or for a group no tab refreshes, is null; asked of no tab', async () => {
  const { b, t } = make([canvasTab({ id: 1, uid: '6' })]);
  assert.equal(await t.refresh(A, 'courses', {}), null);
  const n = b.calls.length;
  for (const g of ['writer', 'mod:abcdefghijklmnop', 'nope']) assert.equal(await t.refresh(A, g, {}), null, g);
  assert.equal(b.calls.length, n);
});

test('a planner read that fails, or outlives its time, keeps nothing', async () => {
  const store = { todoCache: await C.canvasPlan('5', RAW, Date.now() - 600e3) };
  const before = structuredClone(store.todoCache);
  const failing = canvasTab({ id: 1, store, routes: { '/api/v1/planner/items': () => H.json({}, 500) } });
  assert.deepEqual(await make([failing]).t.refresh(A, 'courses', {}), { ok: false, source: 'tab' });
  assert.deepEqual(store.todoCache, before);
  // The tab answers past the worker's wait: the worker stops waiting, and the tab keeps nothing it read after its time.
  const slow = canvasTab({ id: 2, store, routes: { '/api/v1/planner/items': async () => { await H.pause(150); return RAW; } } });
  const at = Date.now();
  assert.deepEqual(await make([slow], { limit: { read: 60 } }).t.refresh(A, 'courses', {}), { ok: false, source: 'tab' });
  assert.ok(Date.now() - at < 140, 'the worker waits no longer than its limit');
  await H.pause(250);
  assert.deepEqual(store.todoCache, before, 'nothing kept past its time');
  assert.equal(slow.page.sent.length, 0);
  // A signal that ends the wait.
  const ac = new AbortController();
  const p = make([canvasTab({ id: 3, store, routes: { '/api/v1/planner/items': async () => { await H.pause(150); return RAW; } } })]).t.refresh(A, 'courses', { signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p);
});

test('Ultra: the planner read through lib/ultra.js in the tab, from Ultra\'s own answers', async () => {
  const store = {};
  const fx = (n) => C.load(`ultra-${n}.json`);
  const tab = H.tab({ id: 4, url: `${C.ULTRA}/ultra/course`, site: 'ultra', uid: C.ULTRA_UID, store, routes: {
    '/learn/api/v1/users/me': { id: C.ULTRA_UID },
    [`/learn/api/v1/users/${C.ULTRA_UID}/memberships`]: fx('memberships'),
    '/learn/api/v1/calendars/todo/studentItems': fx('todo'),
    '/learn/api/v1/calendars/calendarItems': fx('calendar-items'),
    '^/learn/api/v1/courses/_\\d+_\\d+/gradebook/grades': fx('grades-status'),
  } });
  const { t } = make([tab]);
  assert.deepEqual(await t.refresh(UL, 'courses', {}), { ok: true, source: 'tab' });
  assert.equal(store.todoCache.key, `todo:${UL}`);
  const want = [...fx('todo').overdueItems, ...fx('todo').dueTodayItems, ...fx('todo').futureDueItems].map((i) => i.column.id);
  assert.ok(want.length && want.every((id) => store.todoCache.items.some((i) => i.id === id)), 'To Do\'s items, by their columns');
  assert.ok(tab.page.loaded.includes('lib/ultra.js'));
});

test('grades: Insights read afresh only while it is on and the account keeps a record; a cleared record stays cleared', async () => {
  const store = {};
  const old = Date.now() - 864e5;
  await C.keepInsights(store, C.CANVAS, '5', C.canvasGrades().slice(0, 1).map((x) => C.canvasCourse(x, old)), old);
  const routes = gradeRoutes();
  const on = { enhance: { insights: true } };
  const tab = canvasTab({ id: 1, store, settings: on, courses: insightsCourses(), routes });
  assert.deepEqual(await make([tab]).t.refresh(A, 'grades', { tool: 'grades_list' }), { ok: true, source: 'tab' });
  const rec = store[`insights:${A}`];
  assert.ok(rec.at > old);
  assert.deepEqual(rec.courses.map((c) => c.name).sort(), ['BIO 1100', 'ENG 1100', 'HIST 2010', 'MATH 1350']);
  assert.deepEqual(tab.page.sent.map((m) => [m.type, m.op]), [['glaze:insights', 'put']]);
  // Off: nothing asked of the site.
  const off = canvasTab({ id: 2, store, courses: insightsCourses(), routes });
  assert.deepEqual(await make([off]).t.refresh(A, 'grades', {}), { ok: false, source: 'tab' });
  assert.equal(off.page.asked.length, 0);
  // Cleared by the student, or never made: Insights makes it when the student opens it.
  await C.clearInsights(store, C.CANVAS, '5', Date.now());
  const cleared = canvasTab({ id: 3, store, settings: on, courses: insightsCourses(), routes });
  assert.deepEqual(await make([cleared]).t.refresh(A, 'grades', {}), { ok: false, source: 'tab' });
  assert.deepEqual(Object.keys(store[`insights:${A}`]), ['cl']);
  assert.ok(!cleared.page.asked.some((r) => r.url.includes('assignment_groups')));
  // One course that can't be read keeps the record as it was.
  const kept = {};
  await C.keepInsights(kept, C.CANVAS, '5', C.canvasGrades().slice(0, 1).map((x) => C.canvasCourse(x, old)), old);
  const one = canvasTab({ id: 4, store: kept, settings: on, courses: insightsCourses(), routes: { ...routes, '/api/v1/courses/26/assignment_groups': () => H.json({}, 403) } });
  assert.deepEqual(await make([one]).t.refresh(A, 'grades', {}), { ok: false, source: 'tab' });
  assert.equal(kept[`insights:${A}`].at, old);
});

test('the worker wiring: mcpRefresh reads through the account\'s tab, and todo_list answers from it with source tab', async () => {
  const local = { todoCache: await C.canvasPlan('5', [C.planner({ id: 9, title: 'Old', at: '2026-10-16T03:59:00Z' })], Date.now() - 600e3) };
  const tab = canvasTab({ id: 5 });
  const env = await H.boot({ local, tabs: [tab] });
  try {
    const { ask } = await H.conn(env.w);
    const r = await ask({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'todo_list', arguments: {} } });
    assert.equal(r.result.isError, undefined, JSON.stringify(r));
    assert.equal(r.result.structuredContent.source, 'tab');
    assert.deepEqual(r.result.structuredContent.items.map((i) => i.title), ['Lab report', 'Reading quiz']);
    assert.ok(env.b.calls.some((c) => c.files?.[0] === 'lib/mcp/tab.js'));
    // Within a minute the same account and group answer from the cache.
    const again = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'todo_list', arguments: {} } });
    assert.equal(again.result.structuredContent.source, 'cache');
    assert.equal(await vm.runInContext(`mcpRefresh(${JSON.stringify(A)}, 'writer', {})`, env.w.context), null);
  } finally { await H.off(env); }
});
