process.env.TZ = 'UTC'; // a few calls leave the zone to the machine, and the fixtures' days are UTC days
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/pet.js'), T = require('../lib/todo.js');
const now = Date.parse('2026-10-15T16:00:00Z'), today = T.dayOf(now, 'UTC');
const item = (patch = {}) => ({ k: 'assignment:1', n: 'One', a: now - T.DAY * 2, d: now - T.DAY, s: 'on', ...patch });
const insight = (items) => ({ at: now, courses: [{ id: '1', items }] });
const run = (sources = {}, raw) => P.reconcile(raw, { now, tz: 'UTC', ...sources });
const xp = (s) => P.view(s).xp;
for (const [name, patch, expected] of [
  ['on time', {}, 20], ['late', { s: 'late' }, 10], ['late by timestamp', { a: now }, 10],
  ['no due date', { d: 0 }, 15], ['excused', { s: 'excused' }, 0], ['missing', { a: 0, s: 'missing' }, 0],
  ['graded without handing in', { a: 0, s: 'on' }, 0],
]) test(`handed-in XP: ${name}`, () => assert.equal(xp(run({ insights: insight([item(patch)]) })), expected));

test('repeated reads, duplicate rows and both source caches never double-count', () => {
  const sources = { insights: insight([item(), item()]), planner: [{ type: 'assignment', id: '1', at: now, sub: { submitted: true } }] };
  const first = run(sources);
  assert.equal(xp(first), 20);
  assert.deepEqual(run(sources, first), first);
});

test('source eviction and a missed week preserve earned XP; explicit undo removes it', () => {
  const first = run({ insights: insight([item()]) });
  assert.equal(xp(run({ now: now + 7 * T.DAY }, first)), 20);
  assert.equal(xp(run({ todo: { items: { 'assignment:1': { done: false } } } }, first)), 0);
  assert.equal(xp(run({ insights: insight([item({ a: 0, s: 'open' })]) }, first)), 0);
});

test('the newer source wins, including resubmission and incomplete corrections', () => {
  const first = run({ insights: insight([item()]) });
  const planner = [{ type: 'assignment', id: '1', sub: { submitted: true, redo: true } }];
  assert.equal(xp(run({ insights: insight([item()]), planner, cache: { at: now + 1 } }, first)), 0);
  assert.equal(xp(run({ insights: insight([item()]), planner, cache: { at: now - 1 } }, first)), 20);
});

for (const [name, on, done, expected] of [
  ['kept yesterday', '2026-10-14', now - T.DAY, 8], ['late completion', '2026-10-13', now - T.DAY, 0],
  ['today is not over', '2026-10-15', now, 0], ['undone task', '2026-10-14', 0, 0],
]) test(`do-on plans use W17: ${name}`, () => {
  const todo = { tasks: [{ id: 'x', title: 'Own work', done }], items: { 'task:x': { on, sessions: [{ at: now - T.DAY * 2, min: 25 }] } } };
  assert.equal(xp(run({ todo })), expected);
});

test('known handed-in timestamp counts a plan once; manual ticks without a timestamp and focus sessions give no plan XP', () => {
  const insights = insight([item()]);
  assert.equal(xp(run({ insights, todo: { items: { 'assignment:1': { on: '2026-10-14' } } } })), 28);
  const manual = { items: { 'assignment:1': { on: '2026-10-14', done: true } } };
  assert.equal(xp(run({ todo: manual })), 0);
  assert.equal(xp(run({ insights, todo: { items: { 'assignment:1': { sessions: [{ at: now - T.DAY, min: 25 }] } } } })), 20);
});

test('unticking removes plan XP and reticking recomputes without accumulating', () => {
  const todo = { tasks: [{ id: 'x', title: 'Own work', done: now - T.DAY }], items: { 'task:x': { on: '2026-10-14' } } };
  const first = run({ todo });
  assert.equal(xp(first), 8);
  const undone = run({ todo: { ...todo, tasks: [{ ...todo.tasks[0], done: 0 }] } }, first);
  assert.equal(xp(undone), 0);
  assert.equal(xp(run({ todo }, undone)), 8);
});

const cache = { at: now, start: new Date(now - 33 * T.DAY).toISOString(), end: new Date(now + 8 * T.DAY).toISOString() };
test('streak XP is a union of W11 verified days, never its historical best', () => {
  const streak = { start: today - 2, asOf: today, best: 100, keys: [], ok: [] };
  const first = run({ streak, cache, planner: [] });
  assert.deepEqual(first.days, [today - 2, today - 1]);
  assert.equal(xp(first), 10);
  assert.deepEqual(run({ streak, cache, planner: [] }, first), first);
  assert.equal(xp(run({ streak: { ...streak, start: today + 7 }, now: now + 7 * T.DAY }, first)), 10);
});
for (const [name, c] of [['missing', undefined], ['stale', { ...cache, at: now - 6e5 }], ['future', { ...cache, at: now + 1 }], ['partial', { ...cache, start: new Date(now - T.DAY).toISOString() }]]) {
  test(`saved W11 streak does not depend on ${name} cache`, () => assert.equal(xp(run({ streak: { start: today - 10, asOf: today, best: 100 }, cache: c, planner: [] })), 50));
}
test('only the saved W11 start and restores determine credited closed days', () => {
  const planner = [{ type: 'assignment', id: '3', title: 'Missed', at: now - T.DAY, sub: { submitted: false }, cid: '1' }];
  const streak = { start: today - 2, asOf: today, best: 100, keys: [], ok: [] };
  assert.deepEqual(run({ streak, cache, planner }).days, [today - 2, today - 1]);
  assert.deepEqual(run({ streak: { ...streak, start: today - 4, asOf: today, ok: ['assignment:3'] }, cache, planner }).days, [today - 4, today - 3, today - 2, today - 1]);
});

test('levels and equipment validate stored values and keep rewards local', () => {
  for (const [points, level] of [[0, 1], [60, 2], [160, 3], [320, 4], [600, 5]]) {
    const earned = Object.fromEntries(Array.from({ length: points / 20 }, (_, i) => [`work:assignment:${i}`, 20]));
    assert.equal(P.view({ earned }).level, level);
  }
  const v = P.view({ earned: { 'work:assignment:1': 99999, '__proto__': 20 }, days: [today, today, 'bad'], wear: 'happy', decor: { books: 8, stars: 0, bad: 2, plant: 99 } });
  assert.equal(v.xp, 5); assert.equal(v.wear, 'plain'); assert.deepEqual(v.decor, { books: 8 });
  assert.ok(P.KEY.test(P.storeKey('https://school.test', '_4_1')));
  assert.ok(!P.KEY.test('pet:https://school.test/../3'));
});

test('the broker reads only this confirmed account and ignores another account’s cache', async () => {
  const key = 'pet:https://school.test/3', tk = 'todo:https://school.test/3';
  const stored = { todoCache: { key: 'todo:https://school.test/4', at: now, items: [{ type: 'assignment', id: '1', at: now, sub: { submitted: true } }] }, [tk]: { tasks: [], items: {} } };
  let reads, writes = 0;
  const area = { local: { get: async (keys) => { reads = keys; return Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]])); }, set: async (patch) => { writes++; Object.assign(stored, patch); return true; } } };
  const result = await P.change({ key, op: 'read', xp: 9000, tz: 'UTC' }, area);
  assert.equal(result.data.xp, 0);
  assert.deepEqual(reads, [key, tk, 'insights:https://school.test/3', 'remind:https://school.test/3', 'todoCache', 'petCharacter', 'widgetTimer']);
  assert.equal(writes, 0);
  assert.equal((await P.change({ key, op: 'wear', wear: 'bandana' }, area)).error, 'locked');
  assert.equal((await P.change({ key, op: 'decor', item: 'books', cell: 8 }, area)).ok, true);
  assert.equal((await P.change({ key, op: 'decor', item: 'books', cell: -1 }, area)).ok, false);
  assert.equal((await P.change({ key, op: 'decor', item: 'books', cell: null }, area)).ok, true);
  assert.equal((await P.change({ key, op: 'read' }, { local: { ...area.local, set: async () => false } })).ok, true);
  stored[tk] = { tasks: [{ id: 'x', title: 'A', done: now - T.DAY }], items: { 'task:x': { on: '2026-10-14' } } };
  assert.equal((await P.change({ key, op: 'read' }, { local: { ...area.local, set: async () => false } })).error, 'write');
});

test('an older retained cache cannot resurrect XP after a newer submission correction', () => {
  const insights = insight([item()]);
  const first = run({ insights, todo: { items: { 'assignment:1': { on: '2026-10-14' } } } });
  const planner = [{ type: 'assignment', id: '1', at: now - T.DAY, sub: { submitted: false } }];
  const next = run({ insights, planner, cache: { at: now + 1 }, todo: { items: { 'assignment:1': { on: '2026-10-14' } } } }, first);
  assert.equal(xp(next), 0);
  assert.equal(xp(run({ insights, todo: { items: { 'assignment:1': { on: '2026-10-14' } } } }, next)), 0);
});

test('unknown Ultra submission timing earns only neutral hand-in XP, never the on-time bonus', () => {
  assert.equal(xp(run({ planner: [{ type: 'assignment', id: '_2_1', at: now - T.DAY, state: 'unknown', sub: { submitted: true } }] })), 15);
  assert.equal(xp(run({ insights: insight([item({ s: '', a: now, d: now - T.DAY })]) })), 15);
  assert.equal(xp(run({ planner: [{ type: 'assignment', id: '_2_1', sub: { submitted: 'true' } }] })), 0);
});
