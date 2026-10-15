const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.env.PERF_ULTRA_SOURCE || require.resolve('../content-ultra.js'), 'utf8');
const settle = () => new Promise(setImmediate);

test('an unchanged gradebook remembers a successful empty late-status answer', async () => {
  const start = source.indexOf('  const bookFor = '), end = source.indexOf('  // undefined until', start);
  let requests = 0, changed = 0, now = 100000, fail = false;
  const books = new Map();
  const bookFor = vm.runInNewContext(`${source.slice(start, end)} bookFor`, {
    books, Date: { now: () => now }, me: async () => '_900_1',
    api: async () => { requests++; if (fail) throw new Error('offline'); return { results: [] }; }, lateIn: async () => new Set(),
    GZ_PAGE: { gradesByContent: () => new Map(), overall: () => null }, locale: () => 'en', onBook: () => changed++,
  });
  bookFor('_101_1'); await settle();
  assert.equal(requests, 1);
  fail = true;
  bookFor('_101_1', true); await settle();
  assert.equal(books.get('_101_1').pending, false);
  assert.equal(books.get('_101_1').late, undefined, 'a failed read is not cached as an empty success');
  fail = false;
  bookFor('_101_1', true); await settle();
  const book = bookFor('_101_1', true); await settle();
  assert.equal(requests, 3, 'the failed read retries, then the empty success is reused on the next pass');
  assert.equal(book.late.size, 0);
  assert.equal(changed, 1, 'unchanged grades do not redraw');
  now += 60001;
  bookFor('_101_1', true); await settle();
  assert.equal(requests, 4, 'the normal one-minute grade refresh remains');
});

test('Ultra native-added-subtree hooks run synchronously before the batched pass', () => {
  const core = fs.readFileSync(process.env.PERF_CORE_SOURCE || require.resolve('../content.js'), 'utf8');
  const start = core.indexOf('  const schedule = '), end = core.indexOf('  const startSweep = ', start);
  const added = [], dirty = new Set(); let pass;
  const schedule = vm.runInNewContext(`${core.slice(start, end)} schedule`, {
    chrome: { runtime: { id: 'glaze' } }, observer: {}, ultra: true, dirty, full: false, timer: 0,
    X: { lift() {}, gate: (node) => added.push(node) }, flush: () => {}, setTimeout: (fn) => { pass = fn; return 1; },
  });
  const a = { nodeType: 1 }, b = { nodeType: 1 }, own = { closest: () => ({}) };
  schedule([{ type: 'childList', target: {}, addedNodes: [a] }, { type: 'childList', target: own, addedNodes: [{ nodeType: 1 }] }, { type: 'childList', target: {}, addedNodes: [b] }]);
  assert.deepEqual(added, [a, b], 'discovery happens in the observer callback, before its timer runs');
  assert.equal(typeof pass, 'function');
});
