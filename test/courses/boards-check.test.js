// The geometry check must measure Edit layout, with the rotating quote held still for that comparison.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Ultra geometry check pauses a cycling quote and restores it after comparing', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts/ultra-boards-check.js'), 'utf8');
  const start = source.indexOf('    const editingStill = '), end = source.indexOf('    const notes = ', start);
  let paused = false, height = 100, passes = 0;
  const checks = [];
  const button = { click: () => { paused = !paused; } };
  const document = {
    querySelector: (s) => s.includes(`aria-pressed="${paused}"`) ? button : null,
    querySelectorAll: () => [{ dataset: { tile: 'quotes' }, getBoundingClientRect: () => ({ left: 17, top: 200, width: 342, height }) }],
  };
  const page = {
    evaluate: async (fn) => vm.runInNewContext(`(${fn})()`, { document, scrollY: 0 }),
    click: async () => {},
  };
  const compare = vm.runInNewContext(source.slice(start, end) + '\neditingStill;', {
    page, stable: async () => { if (++passes > 1 && !paused) height = 125; },
    ok: (value) => checks.push(value), console,
  });
  await compare('Courses 375');
  assert.deepEqual(checks, [true, true], 'a scheduled quote cannot change the geometry under comparison');
  assert.equal(paused, false, 'the original cycling state is restored');
});
