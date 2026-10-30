const test = require('node:test');
const assert = require('node:assert/strict');
const probe = require('../scripts/pointer-probe.cjs');

test('the pointer probe ignores a stale canvas until the requested preview state arrives', async () => {
  const states = [
    { ready: true, enabled: false, drawn: true },
    { ready: false, enabled: true, drawn: true },
    { ready: true, enabled: true, drawn: false },
    { ready: true, enabled: true, drawn: true },
  ];
  let reads = 0;
  assert.equal(await probe(async () => { reads++; return states.shift(); }, true, { interval: 1 }), true);
  assert.equal(reads, 4);
});

test('the pointer probe waits for an old animation to drain and verifies it stays off across inputs', async () => {
  const states = [
    { ready: true, enabled: true, drawn: true },
    { ready: true, enabled: false, drawn: true },
    { ready: true, enabled: false, drawn: false },
    { ready: true, enabled: false, drawn: true },
    ...Array(3).fill({ ready: true, enabled: false, drawn: false }),
  ];
  let reads = 0;
  assert.equal(await probe(async () => { reads++; return states.shift(); }, false, { interval: 1 }), true);
  assert.equal(reads, 7);
});

test('a missing animation fails with a bounded deadline', async () => {
  assert.equal(await probe(async () => ({ ready: true, enabled: true, drawn: false }), true, { timeout: 20, interval: 1 }), false);
});
