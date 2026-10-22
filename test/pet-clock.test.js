process.env.TZ = 'UTC';
// WID-3, WID-4 (the record side) and WID-7: a wrong device clock must neither cost the pet earned history nor lock it, and
// reading the record must not rewrite it.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/pet.js'), T = require('../lib/todo.js');
const D = 864e5, now = Date.parse('2026-10-15T16:00:00Z'), today = T.dayOf(now, 'UTC');
const key = 'pet:https://x.test/1', sync = { get: async () => ({}) };
const store = (record, onSet = () => {}) => {
  const data = { [key]: record };
  return { data, local: { get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])), set: async (patch) => { onSet(patch); Object.assign(data, structuredClone(patch)); return true; } } };
};
const at = (ms) => { Date.now = () => ms; };
const real = Date.now;
test.afterEach(() => { Date.now = real; });

test('WID-3: streak days survive a write made while the clock is days behind', async () => {
  const rec = P.clean({ days: Array.from({ length: 10 }, (_, i) => today - 10 + i), earned: { 'work:assignment:1': 20 } }, now);
  const s = store(rec);
  at(now - 30 * D);
  assert.equal(P.clean(rec, now - 30 * D).days.length, 10, 'clean() keeps every stored day');
  const r = await P.change({ key, op: 'observe', action: 'rest', context: require('../lib/petbrain.js').vector({ needs: {} }), tz: 'UTC' }, { local: s.local, sync });
  assert.equal(r.ok, true);
  assert.equal(s.data[key].days.length, 10, 'the observe commit saved all ten days');
  at(now + 3600e3);
  const back = await P.change({ key, op: 'read', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(back.data.xp, 70); assert.equal(back.data.streakXp, 50);
});

test('WID-3: absurd day numbers still cannot mint XP', () => {
  assert.equal(P.view({ days: [today + 100000, today - 1] }).streakXp, 5);
});

test('WID-4: a read with nothing new does not rewrite the record, minutes apart', async () => {
  const s = store(P.clean({ earned: { 'work:assignment:1': 20 } }, now));
  let writes = 0; const counted = store(s.data[key], () => { writes++; });
  for (let i = 0; i < 5; i++) { at(now + i * 61000); const r = await P.change({ key, op: 'read', tz: 'UTC' }, { local: counted.local, sync }); assert.equal(r.ok, true); }
  assert.equal(writes, 0);
});

test('WID-4: the needs shown still decay with time even though the read stores nothing', async () => {
  const rec = P.clean({ needs: { mood: 100, playful: 100, energy: 100, bond: 100, curiosity: 100, comfort: 100, at: now } }, now);
  const s = store(rec);
  at(now); const first = await P.change({ key, op: 'read', tz: 'UTC' }, { local: s.local, sync });
  at(now + 6 * 3600e3); const later = await P.change({ key, op: 'read', tz: 'UTC' }, { local: s.local, sync });
  assert.ok(later.data.needs.mood < first.data.needs.mood, 'mood relaxes toward its base after hours');
  // An action applies on top of the decayed value, not the stale stored one.
  const pet = await P.change({ key, op: 'interact', event: 'pet', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(pet.interaction.accepted, true);
  assert.ok(Math.abs(pet.data.needs.mood - (later.data.needs.mood + 6)) < 1, `${pet.data.needs.mood} vs ${later.data.needs.mood}`);
  assert.ok(s.data[key].needs.at >= now + 6 * 3600e3 - 60000, 'the write stamps the moment of the action');
});

test('WID-7: bonding works again once a clock that was far ahead is corrected', async () => {
  const s = store(P.clean({}, now));
  at(now + 200 * D);
  const a = await P.change({ key, op: 'interact', event: 'pet', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(a.interaction.accepted, true);
  at(now + 2 * D);
  const b = await P.change({ key, op: 'interact', event: 'pet', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(b.interaction.accepted, true, `reason ${b.interaction.reason}`);
  const care = P.care(s.data[key].care, 'UTC', now + 2 * D);
  assert.ok(care.nextAt <= now + 2 * D + P.CARE_COOLDOWN, 'the next pat is at most a minute away');
  assert.ok(care.resetAt <= T.midnight(T.dayOf(now + 2 * D, 'UTC') + 2, 'UTC'), 'the allowance resets within about a day');
});

test('WID-7: a clock that was ahead does not leave the day allowance spent for months', () => {
  const spent = { day: today + 200, used: 5, at: now + 200 * D, zone: 'UTC' };
  const c = P.care(spent, 'UTC', now);
  assert.equal(c.remaining, 5);
  assert.ok(c.nextAt <= now + P.CARE_COOLDOWN);
});

test('WID-7: rolling the clock back a few hours still cannot refill a spent allowance', () => {
  const spent = { day: today, used: 5, at: now - 1000, zone: 'UTC' };
  assert.equal(P.care(spent, 'UTC', now - 4 * 3600e3).remaining, 0);
  const tomorrow = { day: today + 1, used: 5, at: now, zone: 'UTC' };
  assert.equal(P.care(tomorrow, 'UTC', now).remaining, 0);
});

test('a same-day clock correction unlocks remaining bonding moments without refilling the allowance', async () => {
  const s = store(P.clean({ care: { day: today, used: 2, at: now + 4 * 3600e3, zone: 'UTC' } }, now));
  at(now + 2 * 60000);
  const r = await P.change({ key, op: 'interact', event: 'pet', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(r.interaction.accepted, true, 'a future cooldown must not move forward on every check');
  assert.equal(s.data[key].care.used, 3, 'spent moments remain spent');
  assert.equal(r.data.xp, 0, 'clock correction and bonding award no academic XP');
  const again = await P.change({ key, op: 'interact', event: 'pet', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(again.interaction.accepted, false);
  assert.equal(s.data[key].care.used, 3);
  for (let i = 1; i <= 2; i++) {
    at(now + (2 + i * 2) * 60000);
    assert.equal((await P.change({ key, op: 'interact', event: 'play', tz: 'UTC' }, { local: s.local, sync })).interaction.accepted, true);
  }
  at(now - 4 * 3600e3);
  const spent = await P.change({ key, op: 'interact', event: 'pet', tz: 'UTC' }, { local: s.local, sync });
  assert.equal(spent.interaction.reason, 'daily');
  assert.equal(s.data[key].care.used, 5, 'another few-hour correction cannot refill the spent allowance');
  assert.equal(spent.data.xp, 0);
});
