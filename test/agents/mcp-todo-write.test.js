// Marking a to-do done for agent apps (lib/mcp/tools-study.js todo_mark_done, lib/mcp/tab.js mark): Glaze's own sentence for
// the approval window from the cache alone; the same edit Glaze's list makes for a tick (lib/todo.js change), shown after as
// todo_list's marked; with Canvas sync on, Canvas's planner override through the account's tab with the page's CSRF token,
// shown after as done; no tab says so before anyone is asked; and through the worker, Allow and Don't allow.
process.env.TZ = 'UTC';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./helpers/mcp-caches.cjs');
const H = require('./helpers/mcp-tabs.cjs');
const T = require('../lib/ai/tools.js');
const R = require('../lib/mcp/registry.js');
const TABS = require('../lib/mcp/tabs.js');
const ST = require('../lib/mcp/tools-study.js');

const A = `${C.CANVAS}/5`, UL = `${C.ULTRA}/${C.ULTRA_UID}`;
const CSRF = 'abc+/=123';
const RAW = [
  C.planner({ id: 1, title: 'Lab report', at: '2026-10-16T03:59:00Z' }),
  { ...C.planner({ type: 'quiz', id: 2, course: 26, name: 'ENG 1100', title: 'Reading quiz', at: '2026-10-20T03:59:00Z' }), plannable: { title: 'Reading quiz', assignment_id: 502 } },
  C.planner({ id: 3, title: 'Handed in', at: '2026-10-17T03:59:00Z', sub: { submitted: true } }),
  C.planner({ id: 4, title: 'Marked before', at: '2026-10-18T03:59:00Z', ov: { id: 77, marked_complete: false, dismissed: false } }),
];
const SYNC = { todo: { sync: true } };
const area = (data) => ({ get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(data, x)).map((x) => [x, data[x]]))) });
const setup = async ({ sync = {}, tabs = [], raw = RAW, ultra = false, local = {} } = {}) => {
  const s = { todoCache: ultra ? await C.ultraPlan() : await C.canvasPlan('5', raw), ...local };
  const b = H.browser(tabs);
  const deps = { sync: area(sync), tabs: TABS.create({ tabs: b.tabs, scripting: b.scripting, quiet: H.quiet }) };
  const r = T.registry();
  ST.register(r, deps);
  const ctx = (account = ultra ? UL : A) => ({ account, local: { ...area(s), set: async (p) => { Object.assign(s, structuredClone(p)); } }, keys: async () => Object.keys(s), now: () => C.NOW });
  return { s, b, deps, r, ctx, t: r.get('todo_mark_done') };
};
const canvasTab = (o = {}) => H.tab({ id: 1, url: `${C.CANVAS}/`, cookie: `other=1; _csrf_token=${encodeURIComponent(CSRF)}`, ...o, routes: {
  '/api/v1/planner/overrides': (u, init) => ({ id: 901, marked_complete: JSON.parse(init.body).marked_complete, dismissed: false }),
  '^/api/v1/planner/overrides/\\d+$': (u, init) => ({ id: Number(u.pathname.split('/').pop()), marked_complete: JSON.parse(init.body).marked_complete, dismissed: false }), ...o.routes } });

test('todo_mark_done: a write in the courses group, the student\'s to allow, offered only with its settings and tabs', () => {
  const plain = T.registry();
  ST.register(plain);
  assert.deepEqual(plain.list(), ['accounts_list', 'courses_list', 'todo_list', 'schedule_list']);
  const r = T.registry();
  ST.register(r, { sync: area({}), tabs: { find: async () => null, run: async () => null } });
  const t = r.get('todo_mark_done');
  assert.deepEqual([t.kind, t.group, t.scope, t.needs, t.title], ['write', 'courses', 'account', undefined, 'Mark a to-do done']);
  const d = R.describe(t);
  assert.deepEqual(d.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.equal(d._meta['io.frostdev.glaze/approval'], 'student');
  assert.deepEqual(d.inputSchema.required, ['type', 'id']);
});

test('summarize: Glaze\'s sentence from the cache alone, naming Canvas\'s planner when the mark goes there', async () => {
  const { t, ctx, b } = await setup();
  assert.equal(await t.summarize({ type: 'assignment', id: '1' }, ctx()), 'Mark “Lab report” (BIO 1100, due Oct 16, 3:59 AM) as done in Glaze\'s to-do list.');
  assert.equal(b.calls.length, 0, 'nothing asked of any tab');
  const on = await setup({ sync: SYNC, tabs: [canvasTab()] });
  assert.equal(await on.t.summarize({ type: 'quiz', id: '2' }, on.ctx()), 'Mark “Reading quiz” (ENG 1100, due Oct 20, 3:59 AM) as done in Glaze\'s to-do list and in Canvas\'s planner.');
  // Ultra has no planner to mark: its marks stay Glaze's, sync or not.
  const u = await setup({ ultra: true, sync: SYNC });
  const item = u.s.todoCache.items.find((i) => !i.sub?.submitted && !i.sub?.graded);
  assert.match(await u.t.summarize({ type: item.type, id: item.id }, u.ctx()), /as done in Glaze's to-do list\.$/);
});

test('what can\'t be marked is said before anyone is asked: no tab to sync through, done already, not on the list', async () => {
  const none = await setup({ sync: SYNC, tabs: [canvasTab({ uid: '6' })] });
  await assert.rejects(none.t.summarize({ type: 'assignment', id: '1' }, none.ctx()), { message: 'Open school.instructure.com in this browser, signed in as this account, to sync it. Nothing was done.' });
  const { t, ctx } = await setup();
  await assert.rejects(t.summarize({ type: 'assignment', id: '3' }, ctx()), { message: '“Handed in” is already done in Glaze\'s to-do list. Nothing was done.' });
  await assert.rejects(t.summarize({ type: 'quiz', id: '1' }, ctx()), /not on this account's to-do list/);
  await assert.rejects(t.summarize({ type: 'assignment', id: '1' }, ctx(`${C.CANVAS}/6`)), /Open the Dashboard at https:\/\/school\.instructure\.com, signed in as this account/);
  // Done by hand only (the list's manual setting): handed in is not done.
  const manual = await setup({ sync: { todo: { done: 'manual' } } });
  assert.match(await manual.t.summarize({ type: 'assignment', id: '3' }, manual.ctx()), /^Mark “Handed in”/);
});

test('without sync: Glaze\'s own mark, the list\'s edit, shown after as todo_list\'s marked', async () => {
  const { t, ctx, s, r, b } = await setup();
  const out = await t.run({ type: 'assignment', id: '1' }, ctx());
  assert.deepEqual(out, { account: A, at: C.NOW, item: { type: 'assignment', id: '1', title: 'Lab report', done: false, marked: true }, where: 'glaze' });
  assert.deepEqual(s[`todo:${A}`], { tasks: [], items: { 'assignment:1': { done: true } } });
  assert.equal(b.calls.length, 0);
  const listed = (await r.get('todo_list').run({}, ctx())).items;
  assert.deepEqual(listed.map((i) => [i.id, i.done, i.marked, i.complete]), [['1', false, true, true], ['2', false, null, false], ['3', false, null, true], ['4', false, null, false]]); // 3 was handed in: Glaze's list shows it done
  assert.deepEqual(Object.keys(listed[0]), ['id', 'type', 'courseId', 'course', 'title', 'due', 'url', 'done', 'submitted', 'graded', 'late', 'missing', 'marked', 'complete']);
  // An item the student unticked that Canvas calls done: marking it done drops the mark, so it follows Canvas again.
  const back = await setup({ local: { [`todo:${A}`]: { tasks: [], items: { 'assignment:3': { done: false } } } } });
  await back.t.run({ type: 'assignment', id: '3' }, back.ctx());
  assert.deepEqual(back.s[`todo:${A}`].items, {});
  // A write storage refuses.
  const full = await setup();
  const c = full.ctx();
  c.local.set = async () => { throw new Error('quota'); };
  assert.deepEqual(await full.t.run({ type: 'assignment', id: '1' }, c), { ok: false, error: "Glaze couldn't save that on this device. Nothing was done." });
});

test('with Canvas sync: Canvas\'s planner override through the tab, as the list\'s checkbox sends it, then the kept planner', async () => {
  const tab = canvasTab();
  const { t, ctx, s, r } = await setup({ sync: SYNC, tabs: [tab] });
  const out = await t.run({ type: 'quiz', id: '2' }, ctx());
  assert.deepEqual(out, { account: A, at: C.NOW, item: { type: 'quiz', id: '2', title: 'Reading quiz', done: true, marked: null }, where: 'canvas' });
  const post = tab.page.asked.find((x) => x.method === 'POST');
  assert.equal(post.url, `${C.CANVAS}/api/v1/planner/overrides`);
  assert.deepEqual(JSON.parse(post.body), { plannable_id: '502', plannable_type: 'assignment', user_id: '5', marked_complete: true }, 'a quiz is marked as its assignment');
  assert.equal(post.headers['x-csrf-token'], CSRF);
  assert.equal(post.headers['x-requested-with'], 'XMLHttpRequest');
  assert.equal(post.credentials, 'same-origin');
  assert.deepEqual(s.todoCache.items.find((i) => i.id === '2').ov, { id: '901', done: true, dismissed: false });
  assert.equal(s[`todo:${A}`], undefined, 'nothing of Glaze\'s own');
  assert.equal((await r.get('todo_list').run({}, ctx())).items.find((i) => i.id === '2').done, true);
  // An override Canvas keeps already: PUT to it.
  await t.run({ type: 'assignment', id: '4' }, ctx());
  const put = tab.page.asked.find((x) => x.method === 'PUT');
  assert.equal(put.url, `${C.CANVAS}/api/v1/planner/overrides/77`);
  assert.deepEqual(JSON.parse(put.body), { id: '77', plannable_id: '4', plannable_type: 'assignment', user_id: '5', marked_complete: true });
});

test('with Canvas sync, a refusal or no tab changes nothing', async () => {
  const refused = canvasTab({ routes: { '/api/v1/planner/overrides': () => H.json({ errors: [] }, 422) } });
  const a = await setup({ sync: SYNC, tabs: [refused] });
  const before = structuredClone(a.s.todoCache);
  assert.deepEqual(await a.t.run({ type: 'assignment', id: '1' }, a.ctx()), { ok: false, error: "Canvas didn't confirm the mark. Nothing was done." });
  assert.deepEqual(a.s.todoCache, before);
  const b = await setup({ sync: SYNC });
  assert.deepEqual(await b.t.run({ type: 'assignment', id: '1' }, b.ctx()), { ok: false, error: 'Open school.instructure.com in this browser, signed in as this account, to sync it. Nothing was done.' });
  assert.deepEqual(b.s.todoCache, before);
});

test('through the worker: the approval window shows Glaze\'s sentence; Don\'t allow changes nothing, Allow marks it', async () => {
  const env = await H.boot({ local: { todoCache: await C.canvasPlan('5', RAW) } });
  try {
    const a = await H.conn(env.w);
    const tools = (await a.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
    assert.equal(tools.find((x) => x.name === 'todo_mark_done')._meta['io.frostdev.glaze/approval'], 'student');
    const no = a.call(2, 'todo_mark_done', { type: 'assignment', id: '1' });
    const rec = await H.answer(env, 'no');
    assert.equal(rec.summary, 'Mark “Lab report” (BIO 1100, due Oct 16, 3:59 AM) as done in Glaze\'s to-do list.');
    const declined = await no;
    assert.equal(declined.result.isError, true);
    assert.equal(env.store.local[`todo:${A}`], undefined);
    const yes = a.call(3, 'todo_mark_done', { type: 'assignment', id: '1' });
    await H.answer(env, 'yes');
    const done = await yes;
    assert.equal(done.result.isError, undefined, JSON.stringify(done));
    assert.deepEqual(done.result.structuredContent.item, { type: 'assignment', id: '1', title: 'Lab report', done: false, marked: true });
    assert.deepEqual(env.store.local[`todo:${A}`].items, { 'assignment:1': { done: true } });
    const listed = await a.call(4, 'todo_list');
    assert.equal(listed.result.structuredContent.items.find((i) => i.id === '1').marked, true);
    for (let i = 0; i < 200 && !(env.store.local.mcpCalls?.length >= 2); i++) await H.pause(5);
    assert.deepEqual(env.store.local.mcpCalls.filter((x) => x.tool === 'todo_mark_done').map((x) => [x.kind, x.outcome]), [['write', 'declined'], ['write', 'ok']]);
  } finally { await H.off(env); }
});

test('a pending approval cannot change its title, Canvas target or sync destination', async () => {
  for (const change of ['title', 'aid', 'override', 'sync']) {
    const sync = { todo: { sync: change !== 'sync' } }, tab = canvasTab();
    const { t, ctx, s } = await setup({ sync, tabs: [tab] });
    const c = ctx(), args = { type: 'quiz', id: '2' };
    await t.summarize(args, c);
    const item = s.todoCache.items.find((i) => i.id === '2');
    if (change === 'title') item.title = 'Different work';
    if (change === 'aid') item.aid = '999';
    if (change === 'override') item.ov = { id: '999', done: false };
    if (change === 'sync') sync.todo.sync = true;
    const out = await t.run(args, c);
    assert.equal(out.ok, false, change);
    assert.match(out.error, /changed|again/i);
    assert.equal(tab.page.asked.filter((x) => x.method !== 'GET').length, 0, change);
    assert.equal(s[`todo:${A}`], undefined);
  }
});

test('Canvas must confirm a completed mark, and a lost write response reports uncertainty', async () => {
  for (const lost of [false, true]) {
    const tab = canvasTab({ routes: { '/api/v1/planner/overrides': () => {
      if (lost) throw new TypeError('Failed to fetch');
      return { id: 901, marked_complete: false, dismissed: false };
    } } });
    const { t, ctx, s } = await setup({ sync: SYNC, tabs: [tab] }), before = structuredClone(s.todoCache);
    const r = await t.run({ type: 'assignment', id: '1' }, ctx());
    assert.equal(r.ok, false);
    if (lost) { assert.match(r.error, /may or may not/); assert.ok(!r.error.includes('Nothing was done')); }
    assert.deepEqual(s.todoCache, before);
  }
});
