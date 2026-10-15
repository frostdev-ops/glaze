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
  const state = run({ cache, streak: { start: today - 20, asOf: today, best: 900 }, planner: [] });
  assert.equal(view(state).streakXp, 100);
  assert.deepEqual(state.days, Array.from({ length: 20 }, (_, i) => today - 20 + i));
});
test('P2: saved W11 start is the single source, unaffected by hidden-course rows or cache availability', () => {
  const streak = { start: today - 10, asOf: today, best: 500 };
  const state = run({ streak, planner: [{ ...row, at: now - 5 * T.DAY, cid: 'hidden', sub: { submitted: false } }] });
  assert.equal(view(state).streakXp, 50);
  assert.deepEqual(run({ streak }, state), state);
  assert.equal(view(run({ streak: { start: today - 12, asOf: today, best: 500, ok: ['assignment:1'] } }, state)).streakXp, 60);
  assert.equal(view(run({ streak: { start: today - 2, asOf: today, best: 500 } }, state)).streakXp, 50);
});
test('saved streak absent or disabled grants no new days; disabling preserves settled rewards', () => {
  const saved = run({ streak: { start: today - 2, asOf: today, best: 50 } });
  assert.equal(view(run({ streak: { start: today - 10 }, streakOn: false }, saved)).streakXp, 10);
  assert.equal(view(run({ streakOn: false })).streakXp, 0);
  assert.equal(view(run({ streak: { start: today, asOf: today, best: 500 } })).streakXp, 0, 'today is not yet a closed day');
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


test('NEW-2: Ultra uses local ticks even when Canvas tick sync is on', async () => {
  const key = 'pet:https://school.test/_3_1';
  const stored = { 'todo:https://school.test/_3_1': { items: { 'assignment:1': { done: false, on: '2026-10-14' } } },
    'insights:https://school.test/_3_1': insights, todoCache: { key: 'todo:https://school.test/_3_1', at: now, items: [row] } };
  const result = await P.change({ key, op: 'read', tz }, {
    local: { get: async () => stored, set: async () => true },
    sync: { get: async () => ({ todo: { sync: true } }) },
  });
  assert.equal(result.data.work, 0); assert.equal(result.data.plans, 0);
});


for (const done of ['auto', 'manual']) test(`R2-1: synced ${done} first read rewards submitted history outside the planner window`, () => {
  const old = { at: now, courses: [{ id: '1', items: [1, 2, 3].map((i) => ({
    k: `assignment:${i}`, n: 'Historical work', d: now - 20 * T.DAY, a: now - 21 * T.DAY, s: 'on',
  })) }] };
  const sources = { insights: old, planner: [], cache: { at: now }, todoO: { sync: true, done } };
  const first = run(sources);
  assert.equal(view(first).work, 60);
  assert.deepEqual(run(sources, first), first, 'backfill is idempotent');
  const settled = { earned: { 'work:assignment:1': 20, 'work:assignment:2': 0 } };
  const mixed = run(sources, settled);
  assert.deepEqual(mixed.earned, { 'work:assignment:1': 20, 'work:assignment:2': 0, 'work:assignment:3': 20 });
});
test('R2-1: a returning synced planner row resumes authoritative tick corrections after history backfill', () => {
  const todoO = { sync: true, done: 'auto' };
  const first = run({ insights, todo, todoO });
  assert.equal(view(first).work, 20);
  const undone = run({ insights, todo, todoO, planner: [{ ...row, ov: { done: false } }], cache: { at: now + 1 } }, first);
  assert.equal(view(undone).work, 0);
  const missing = run({ insights: { ...insights, at: now + 2 }, todo, todoO }, undone);
  assert.equal(view(missing).work, 0);
  const reticked = run({ insights, todo, todoO, planner: [{ ...row, ov: { done: true } }], cache: { at: now + 3 } }, missing);
  assert.equal(view(reticked).work, 20);
});


test('R2-1: a first-read visible synced untick stores zero without growing history for ordinary unsubmitted work', () => {
  const todoO = { sync: true, done: 'auto' };
  const sources = { insights, todoO, planner: [{ ...row, ov: { done: false } }], cache: { at: now + 1 } };
  const first = run(sources);
  assert.equal(first.earned['work:assignment:1'], 0, 'the visible native untick is settled evidence');
  assert.equal(view(run({ insights: { ...insights, at: now + 2 }, todoO }, first)).work, 0);
  const open = run({ todoO, planner: [{ ...row, sub: { submitted: false } }], cache: { at: now + 1 } });
  assert.deepEqual(open.earned, {}); assert.deepEqual(open.seen, {});
});


const syncAuto = { sync: true, done: 'auto' };
for (const [name, state] of [['new work', undefined], ['settled work', { earned: { 'work:assignment:1': 20 }, seen: { 'assignment:1': now } }]]) {
  test(`R3-1: historical kept plan gets its first reward with ${name} and no native row`, () => {
    const old = { at: now, courses: [{ id: '1', items: [{ k: 'assignment:1', n: 'Old', a: now - 21 * T.DAY, d: now - 20 * T.DAY, s: 'on' }] }] };
    const data = { items: { 'assignment:1': { on: T.dayKey(today - 21) } } };
    const sources = { insights: old, todo: data, todoO: syncAuto };
    const first = run(sources, state);
    assert.equal(view(first).plans, 8);
    assert.equal(view(run({ ...sources, todoO: { ...syncAuto, sync: false } }, state)).plans, 8);
    assert.deepEqual(run(sources, first), first);
  });
}
test('R3-1: missing native row preserves settled plan values including explicit zero', () => {
  for (const points of [0, 8]) {
    const state = { earned: { 'work:assignment:1': 20, 'plan:assignment:1': points }, seen: { 'assignment:1': now } };
    const after = run({ insights: { ...insights, at: now + 1000 }, todo, todoO: syncAuto }, state);
    assert.equal(view(after).plans, points);
  }
});
test('R3-1: a first visible native plan untick is settled zero, then row return resumes plan corrections', () => {
  const sources = { insights, todo, todoO: syncAuto };
  const first = run({ ...sources, planner: [{ ...row, ov: { done: false } }], cache: { at: now + 1 } });
  assert.equal(first.earned['plan:assignment:1'], 0);
  assert.equal(view(run(sources, first)).plans, 0);
  const ticked = run({ ...sources, planner: [{ ...row, ov: { done: true } }], cache: { at: now + 2 } }, first);
  assert.equal(view(ticked).plans, 8);
  const undone = run({ ...sources, planner: [{ ...row, ov: { done: false } }], cache: { at: now + 3 } }, ticked);
  assert.equal(view(undone).plans, 0);
  const moved = run({ ...sources, todo: { items: { 'assignment:1': { on: T.dayKey(today + 1) } } }, planner: [{ ...row, ov: { done: true } }], cache: { at: now + 4 } }, undone);
  assert.equal(view(moved).plans, 0, 'a known future plan remains a correction');
  assert.equal(view(run({ ...sources, planner: [{ ...row, ov: { done: true } }], cache: { at: now + 5 } }, moved)).plans, 8);
});
test('R3-2: new late hand-in after visible redo can replace settled zero outside native window', () => {
  const sources = { insights, todoO: syncAuto };
  const first = run({ ...sources, planner: [row], cache: { at: now } });
  const redo = run({ ...sources, planner: [{ ...row, sub: { submitted: true, redo: true } }], cache: { at: now + 1 } }, first);
  const newer = { at: now + 900000, courses: [{ id: '1', items: [{ ...insights.courses[0].items[0], a: now + 800000, s: 'late' }] }] };
  const fresh = { insights: newer, todoO: syncAuto, now: now + 1000000 };
  const after = run(fresh, redo);
  assert.deepEqual([view(first).work, view(redo).work, view(after).work], [20, 0, 10]);
  assert.equal(view(run({ ...fresh, todoO: { ...syncAuto, sync: false } }, redo)).work, 10);
  assert.deepEqual(run(fresh, after), after);
});
test('R3-2: refreshed, same, older or unproven hand-in timestamps preserve a native untick zero', () => {
  const zero = run({ insights, todoO: syncAuto, planner: [{ ...row, ov: { done: false } }], cache: { at: now + 1 } });
  for (const [at, a] of [[now + 1000, now - 2 * T.DAY], [now + 1000, now - 3 * T.DAY], [now + 1000, 0], [now, now + 500], [now + 1, now + 500]]) {
    const record = { at, courses: [{ id: '1', items: [{ ...insights.courses[0].items[0], a, s: 'late' }] }] };
    assert.equal(view(run({ insights: record, todoO: syncAuto, now: now + 2000 }, zero)).work, 0);
  }
  const newer = { at: now + 1000, courses: [{ id: '1', items: [{ ...insights.courses[0].items[0], a: now + 500, s: 'late' }] }] };
  const after = run({ insights: newer, todoO: syncAuto, now: now + 2000 }, zero);
  assert.equal(view(after).work, 10, 'a genuinely new submitted hand-in can replace native zero');
  assert.deepEqual(run({ insights: { ...newer, at: now + 3000 }, todoO: syncAuto, now: now + 4000 }, after), after, 'cache refresh alone leaves settled history unchanged');
});


const serverA = Date.parse('2026-10-15T10:00:00Z');
const clockInsight = (at, a = serverA, status = 'on') => ({ at, courses: [{ id: '1', items: [{ k: 'assignment:1', n: 'Clock', d: serverA + T.DAY, a, s: status }] }] });
const clockRow = { ...row, at: serverA + T.DAY };
test('R4-1: slow device clock does not turn the same provider hand-in into a new reward after untick', () => {
  const observed = serverA - 8 * 60000;
  const zero = run({ now: observed, insights: clockInsight(observed - 1), planner: [{ ...clockRow, ov: { done: false } }], cache: { at: observed }, todoO: syncAuto });
  const later = { now: observed + T.DAY, insights: clockInsight(observed + T.DAY), todoO: syncAuto };
  assert.equal(view(zero).work, 0);
  assert.equal(view(run(later, zero)).work, 0);
});
for (const [label, zero] of [['positive', false], ['native zero', true], ['redo zero', 'redo']]) {
  test(`R4-1: fast device accepts a provider-newer hand-in after ${label}`, () => {
    const observed = serverA + 12 * 60000;
    const initial = run({ now: observed, insights: clockInsight(observed - 1), planner: [{ ...clockRow, ov: { done: zero === true ? false : true } }], cache: { at: observed }, todoO: syncAuto });
    const settled = zero === 'redo' ? run({ now: observed + 1, insights: clockInsight(observed - 1), planner: [{ ...clockRow, sub: { submitted: true, redo: true } }], cache: { at: observed + 1 }, todoO: syncAuto }, initial) : initial;
    const fresh = { now: observed + 60000, insights: clockInsight(observed + 60000, serverA + 5 * 60000, 'late'), todoO: syncAuto };
    const after = run(fresh, settled);
    assert.equal(view(settled).work, zero ? 0 : 20);
    assert.equal(view(after).work, 10, 'new provider timestamp precedes fast device observation but is a new hand-in');
    assert.deepEqual(run(fresh, after), after);
  });
}
test('R4-1: provider baseline is retained across zero, clean and JSON view round trips without device-time clamping', () => {
  const observed = serverA - 8 * 60000;
  const first = run({ now: observed, insights: clockInsight(observed - 1), planner: [clockRow], cache: { at: observed }, todoO: syncAuto });
  assert.equal(first.sub['assignment:1'], serverA);
  const redo = run({ now: observed + 1, insights: clockInsight(observed - 1), planner: [{ ...clockRow, sub: { submitted: true, redo: true } }], cache: { at: observed + 1 }, todoO: syncAuto }, first);
  assert.equal(redo.sub['assignment:1'], serverA);
  assert.equal(P.clean(JSON.parse(JSON.stringify(redo)), observed).sub['assignment:1'], serverA);
  assert.equal(P.view(redo).sub['assignment:1'], serverA);
});
test('R4-1: missing legacy provider baseline stays conservative and is not fabricated from a refresh', () => {
  const legacy = { earned: { 'work:assignment:1': 0 }, seen: { 'assignment:1': serverA - 8 * 60000 } };
  const after = run({ now: serverA + T.DAY, insights: clockInsight(serverA + T.DAY), todoO: syncAuto }, legacy);
  assert.equal(view(after).work, 0);
  assert.deepEqual(after.sub, {});
});
test('R4-1: malformed or oversized provider metadata fails closed without replacing stored history', async () => {
  const key = 'pet:https://school.test/3';
  for (const sub of [[], 'bad', null, { 'assignment:1': 'bad' }, { 'assignment:1': -1 }, { bad: serverA }, Object.fromEntries(Array.from({ length: P.MAX + 1 }, (_, i) => [`assignment:${i}`, serverA]))]) {
    const raw = { earned: { 'work:assignment:1': 20 }, sub }, before = JSON.stringify(raw); let writes = 0;
    assert.equal(P.clean(raw), null);
    const r = await P.change({ key, op: 'read', tz }, { local: { get: async () => ({ [key]: raw }), set: async () => { writes++; return true; } } });
    assert.equal(r.error, 'history'); assert.equal(writes, 0); assert.equal(JSON.stringify(raw), before);
  }
});
test('R4-1: provider metadata capacity exhaustion preserves the original store and settled XP', async () => {
  const key = 'pet:https://school.test/3';
  const raw = { earned: { 'work:assignment:2': 20 }, sub: Object.fromEntries(Array.from({ length: P.MAX }, (_, i) => [`assignment:${i + 10}`, serverA])) };
  const before = JSON.stringify(raw); let writes = 0;
  const r = await P.change({ key, op: 'read', tz }, { local: { get: async () => ({ [key]: raw, 'insights:https://school.test/3': insights }), set: async () => { writes++; return true; } } });
  assert.equal(r.error, 'history'); assert.equal(writes, 0); assert.equal(JSON.stringify(raw), before); assert.equal(r.data.work, 20);
});
