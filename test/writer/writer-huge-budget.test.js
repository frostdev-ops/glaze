const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

// Exercise the check's actual budget calculation without launching Chromium. The observations are synthetic, but
// their times and state deliberately include long tasks unrelated to the switch.
const budget = (w) => {
  const source = fs.readFileSync(require.resolve('../scripts/writer-huge-check.js'), 'utf8');
  const from = source.indexOf('    const own ='), to = source.indexOf('    check(w.keys.length', from);
  assert.ok(from >= 0 && to > from);
  return vm.runInNewContext(source.slice(from, to) + '\n({ late, during });', { w, KEY_MS: 300 });
};

test('huge check: a long task after the switch cannot waive a later key\'s budget', () => {
  const w = { long: [{ at: 4, ms: 1000 }], switchTask: null, keys: [{ at: 400, drawn: 700 }] };
  assert.equal(budget(w).late.length, 1);
  assert.equal(budget(w).during.length, 0);
});

test('huge check: only a key pressed within the measured switch task gets its remaining time', () => {
  const w = { long: [{ at: -2, ms: 502 }], switchTask: { at: -2, ms: 502 }, keys: [
    { at: -10, drawn: 600 }, // before the switch: no exception
    { at: 200, drawn: 550 }, // during it: 300 ms remaining plus 300 ms allowed
    { at: 501, drawn: 301 }, // after it: the ordinary budget
    { at: 3, drawn: 798 }, // during it but beyond even the adjusted budget
  ] };
  assert.equal(budget(w).late.length, 3);
  assert.equal(budget(w).during.length, 2);
});
