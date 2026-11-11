// Writer's AI cleaners and checks stay linear on hostile text (audit K2–K4): ten times the input takes far less than a
// hundred times the time, whatever the machine's speed.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../extension/ai/tasks/writer-context.js');

// The best of three runs of f(n), in ms; at least a tenth of one, so a fast small case can't make the ratio huge.
const time = (f, n) => {
  let best = Infinity;
  for (let i = 0; i < 3; i++) { const at = process.hrtime.bigint(); f(n); best = Math.min(best, Number(process.hrtime.bigint() - at) / 1e6); }
  return Math.max(best, 0.1);
};
const linear = (name, f, n) => {
  f(n); // warm
  const small = time(f, n), big = time(f, n * 10);
  assert.ok(big < small * 30, `${name}: ${n} took ${small.toFixed(1)} ms, ${n * 10} took ${big.toFixed(1)} ms`);
};

test('W.plain is linear on unclosed tags: a run of <, "a < b", an open <br', () => {
  linear('<', (n) => W.plain('<'.repeat(n)), 5000);
  linear('a < b', (n) => W.plain('a < b '.repeat(n)), 2000);
  linear('<br', (n) => W.plain('<br'.repeat(n)), 2000);
  assert.equal(W.plain('a < b <i>c</i> <br>d < e'), 'a c\nd < e', 'a tag runs from a < to the next >, as before');
  assert.equal(W.plain('<p>x</p><'), 'x\n<');
});
