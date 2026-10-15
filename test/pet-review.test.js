const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../lib/pet.js'), T = require('../lib/todo.js'), D = require('../defaults.js');
const now = Date.parse('2026-10-15T16:00:00Z'), tz = 'UTC', today = T.dayOf(now, tz);
const row = { type: 'assignment', id: '1', at: now - T.DAY, sub: { submitted: true }, ov: null };
const insights = { at: now, courses: [{ id: '1', items: [{ k: 'assignment:1', n: 'Work', a: now - 2 * T.DAY, d: now - T.DAY, s: 'on' }] }] };
const todo = { items: { 'assignment:1': { on: '2026-10-14' } } };
const run = (sources = {}, state) => P.reconcile(state, { now, tz, ...sources });
const view = (state) => P.view(state);

test('P1: default eight-day planner coverage does not block saved W11 streak XP', () => {
  const cache = { at: now, ...T.fetchRange(D.GZ_SANITIZE({}).todo, now, tz) };
  const state = run({ cache, streak: { start: today - 20, best: 900 }, planner: [] });
  assert.equal(view(state).streakXp, 100);
  assert.deepEqual(state.days, Array.from({ length: 20 }, (_, i) => today - 20 + i));
});
test('P2: saved W11 start is the single source, unaffected by hidden-course rows or cache availability', () => {
  const streak = { start: today - 10, best: 500 };
  const state = run({ streak, planner: [{ ...row, at: now - 5 * T.DAY, cid: 'hidden', sub: { submitted: false } }] });
  assert.equal(view(state).streakXp, 50);
  assert.deepEqual(run({ streak }, state), state);
  assert.equal(view(run({ streak: { start: today - 12, best: 500, ok: ['assignment:1'] } }, state)).streakXp, 60);
  assert.equal(view(run({ streak: { start: today - 2, best: 500 } }, state)).streakXp, 50);
});
test('saved streak absent or disabled grants no new days; disabling preserves settled rewards', () => {
  const saved = run({ streak: { start: today - 2, best: 50 } });
  assert.equal(view(run({ streak: { start: today - 10 }, streakOn: false }, saved)).streakXp, 10);
  assert.equal(view(run({ streakOn: false })).streakXp, 0);
  assert.equal(view(run({ streak: { start: today, best: 500 } })).streakXp, 0, 'today is not yet a closed day');
});
for (const [name, options, planner, data] of [
  ['synced planner untick', { sync: true, done: 'auto' }, [{ ...row, ov: { done: false } }], todo],
  ['manual unmarked work', { sync: false, done: 'manual' }, [row], todo],
]) test(`P2: ${name} revokes both work and plan XP`, () => {
  const first = run({ insights, todo });
  assert.equal(view(first).xp, 28);
  assert.equal(view(run({ insights, todo: data, planner, cache: { at: now + 1 }, todoO: options }, first)).xp, 0);
});
test('P2: clearing or rotating Insights does not revoke a settled plan whose completion time is no longer cached', () => {
  const first = run({ insights, todo });
  assert.equal(view(first).plans, 8);
  for (const record of [undefined, { cl: now + 1 }, { at: now + 1, courses: [] }]) {
    const next = run({ insights: record, todo, planner: [row], cache: { at: now + 2 } }, first);
    assert.equal(view(next).plans, 8);
    assert.equal(view(next).work, 20);
  }
});
test('P3: deleting finished task history preserves XP, but an explicit task undo revokes it', () => {
  const data = { tasks: [{ id: 'x', title: 'Work', done: now - T.DAY }], items: { 'task:x': { on: '2026-10-14' } } };
  const first = run({ todo: data });
  assert.equal(view(first).plans, 8);
  assert.equal(view(run({ todo: { tasks: [], items: {} } }, first)).plans, 8);
  assert.equal(view(run({ todo: { ...data, tasks: [{ ...data.tasks[0], done: 0 }] } }, first)).plans, 0);
});
test('P3: non-submission planner rows never grow reward metadata', () => {
  const planner = Array.from({ length: 3000 }, (_, i) => ({ type: i % 2 ? 'announcement' : 'calendar_event', id: String(i), at: now }));
  const state = run({ planner, cache: { at: now } });
  assert.deepEqual(state.earned, {}); assert.deepEqual(state.seen, {});
});
test('P3: duplicate planner rows without Insights are safe and counted once', () => {
  const state = run({ planner: [row, row], cache: { at: now } });
  assert.equal(view(state).work, 20);
});
test('P3: oversized state fails closed, including valid-looking large day lists', () => {
  assert.equal(P.clean({ days: Array.from({ length: 10000 }, (_, i) => today - i) }), null);
  assert.equal(P.view({ earned: Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`work:assignment:${i}`, 20])) }), null);
});
test('future day numbers cannot mint XP', () => {
  assert.equal(view({ days: [today + 100000] }).streakXp, 0);
});
test('an oversized stored record is neither replaced nor awarded XP by the broker', async () => {
  const key = 'pet:https://school.test/3', raw = { days: Array.from({ length: 10000 }, (_, i) => today - i) };
  let writes = 0;
  const result = await P.change({ key, op: 'read', tz }, { local: { get: async () => ({ [key]: raw }), set: async () => { writes++; return true; } } });
  assert.equal(result.ok, false); assert.equal(writes, 0);
});

test('capacity exhaustion preserves every settled contribution and the original stored record', async () => {
  const key = 'pet:https://school.test/3', raw = { earned: Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`work:assignment:${i + 10}`, 20])) };
  const before = JSON.stringify(raw); let writes = 0;
  const result = await P.change({ key, op: 'read', tz }, { local: { get: async () => ({ [key]: raw, 'insights:https://school.test/3': insights }), set: async () => { writes++; return true; } } });
  assert.equal(result.ok, false); assert.equal(result.error, 'history'); assert.equal(writes, 0);
  assert.equal(result.data.work, 4096 * 20); assert.equal(JSON.stringify(raw), before);
});
test('unsubmitted work that has never earned XP does not create zero-credit history', () => {
  const state = run({ planner: [{ ...row, sub: { submitted: false } }], cache: { at: now } });
  assert.deepEqual(state.earned, {}); assert.deepEqual(state.seen, {});
});


test('NEW-1: stale W11 state credits only its calculated closed days before a later miss is reckoned', () => {
  const R = require('../lib/remind.js');
  const stale = { start: today - 20, best: 10, asOf: today - 10 };
  const missDay = today - 5;
  const planner = [{ ...row, at: T.midnight(missDay, tz) + 20 * 36e5, sub: { submitted: false, missing: true } }];
  const first = run({ streak: stale, planner });
  assert.equal(first.days.length, 10);
  const b = T.build({ items: planner, data: {}, o: { ...D.GZ_SANITIZE({}).todo, past: 'month', group: false }, now, tz });
  const saved = R.clean({ streak: R.streak(b, stale, today) }, now).streak;
  assert.equal(saved.start, today - 4);
  const after = run({ streak: saved }, first);
  assert.equal(after.days.length, 14);
  assert.equal(after.days.includes(missDay), false);
  assert.deepEqual(run({ streak: saved }, after), after);
});
test('NEW-1: legacy or invalid calculated day cannot mint streak XP; settled days remain', () => {
  for (const asOf of [undefined, null, 'today', NaN]) {
    const saved = { start: today - 20, best: 1000, asOf };
    assert.equal(view(run({ streak: saved })).streakXp, 0);
    assert.deepEqual(run({ streak: saved }, { days: [today - 30] }).days, [today - 30]);
  }
  assert.equal(view(run({ streak: { start: today - 2, asOf: today + 2 } })).streakXp, 10, 'never credit today');
});
for (const [done, tick, work, plans] of [['manual', true, 20, 8], ['auto', false, 0, 0]]) {
  test(`NEW-2: synced ${done} state survives a missing planner row`, () => {
    const todoO = { done, sync: true };
    const first = run({ insights, todo, todoO, planner: [{ ...row, ov: { done: tick } }], cache: { at: now - 1 } });
    assert.equal(view(first).work, work); assert.equal(view(first).plans, plans);
    const after = run({ insights: { ...insights, at: now + 2 }, todo, todoO, planner: [], cache: { at: now + 3 } }, first);
    assert.equal(view(after).work, work); assert.equal(view(after).plans, plans);
  });
}
