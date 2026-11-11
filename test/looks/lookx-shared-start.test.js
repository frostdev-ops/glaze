const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../extension/looks/lookx.js');

test('a newly started device adopts the last shared turn even when its local clock started later', () => {
  const x = { rotate: '6h', at: '08:00' }, list = ['Library', 'Terminal', 'Clear'];
  const H = 36e5, at = 1e12;
  const started = L.turn(undefined, at + H, x, list).state;
  const shared = { mode: '6h 08:00', at, i: 1 };
  assert.deepEqual(L.turn(started, at + 2 * H, x, list, false, shared), { state: shared, wear: -1 });
  assert.equal(L.turn(started, at + 6 * H, x, list, false, shared).wear, 2, 'the account turns from its shared place at its due time');
  assert.equal(L.turn(started, at + 2 * H, x, list, true, shared).wear, 2, 'a forced turn also uses the shared place');
  const own = { mode: shared.mode, at: at + H, i: 2, turned: true };
  assert.equal(L.turn(own, at + 2 * H, x, list, false, shared).state, own, 'a newer actual turn still wins');
});
