const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../scripts/media-cost-check.js'), 'utf8');
const start = source.indexOf('    const opts =');
const end = source.indexOf('    // CPU seconds', start);

test('media cost measurements set preferences without opening a second animated preview', async () => {
  let pages = 0, writes = 0;
  const page = { goto: async () => {}, evaluate: async () => { writes++; } };
  const context = { serviceWorkers: () => [page], newPage: async () => { pages++; return page; } };
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const store = await new AsyncFunction('context', 'D', 'id', source.slice(start, end) + '\nreturn store;')(context, { GZ_DEFAULTS: { bg: {} } }, 'test');
  await store({ kind: 'solid' }, '', 'off');
  assert.equal(writes, 1);
  assert.equal(pages, 0, 'an options preview would keep animating while the measured tab is hidden');
});
