// Run the browser checks' assertions against saved layouts without needing Chrome.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const W = require('../lib/widgets.js');
const file = (name) => path.join(__dirname, '..', 'scripts', `${name}-boards-check.js`);
const canvas = fs.readFileSync(file('canvas'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

test('Canvas check waits for the raise and compares z values from the same saved layout', async () => {
  const before = W.apply(W.layout({}), { ops: [{ s: 'cdash', id: 'timer', front: true }] });
  const after = W.apply(before, { ops: [{ s: 'cdash', id: 'notes', front: true }] });
  let reads = 0;
  const layout = async () => (++reads === 1 ? before : after);
  const until = async (read, check) => {
    for (let i = 0; i < 3; i++) { const l = await read(); if (check(l)) return l; }
    assert.fail('raise was not awaited');
  };
  const code = canvas.slice(canvas.indexOf("    await press('notes');"), canvas.indexOf('    const beforeDone'));
  await new AsyncFunction('press', 'layout', 'until', 'ok', 'resized', `let saved; ${code}`)(async () => {}, layout, until, assert.ok, before.boards.cdash.find((x) => x.id === 'timer'));
  assert.ok(reads >= 2, 'the first storage read was still the old layout');
});

test('Canvas width check accepts the same saved object with storage key order changed', async () => {
  const block = W.layout({});
  const reordered = JSON.parse(JSON.stringify(block), (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  const code = canvas.split('\n').find((s) => s.includes("'width changes preserve stored layout'"));
  await new AsyncFunction('layout', 'block', 'ok', 'isDeepStrictEqual', code)(async () => reordered, block, assert.ok, require('node:util').isDeepStrictEqual);
});

test('Ultra check removes its temporary profile even when Chrome cannot launch', async () => {
  const script = file('ultra'), req = createRequire(script), removed = [];
  const blocked = new Error('launch blocked');
  let waited = false;
  const result = vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    __dirname: path.dirname(script), console: { log() {} },
    process: { env: {}, argv: ['node', script, '/tmp/board-check-output'] },
    require: (id) => id === './wait-for-browser.js' ? async () => { waited = true; }
      : id === 'playwright' ? { chromium: { launchPersistentContext: async () => { assert.equal(waited, true); throw blocked; } } }
      : id === 'fs' ? { ...fs, mkdirSync() {}, mkdtempSync: () => '/tmp/board-check-profile', rmSync: (p) => removed.push(p) } : req(id),
  });
  await assert.rejects(result, (e) => e === blocked);
  assert.deepEqual(removed, ['/tmp/board-check-profile']);
});


test('Canvas float raise check waits for one saved layout instead of racing two reads', async () => {
  const before = W.apply(W.layout({}), { ops: [{ s: 'canvas', id: 'quotes', set: { float: true }, front: true }, { s: 'canvas', id: 'timer', set: { float: true } }] });
  const after = W.apply(before, { ops: [{ s: 'canvas', id: 'timer', front: true }] });
  let reads = 0;
  const layout = async () => (++reads === 1 ? before : after);
  const until = async (read, check) => {
    for (let i = 0; i < 3; i++) { const l = await read(); if (check(l)) return l; }
    assert.fail('float raise was not awaited');
  };
  const start = canvas.indexOf("    await press('timer');");
  const code = canvas.slice(start, canvas.indexOf('    await page.locator', start));
  await new AsyncFunction('press', 'layout', 'until', 'ok', `let saved; ${code}`)(async () => {}, layout, until, assert.ok);
});
