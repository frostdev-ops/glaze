const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.env.PERF_ULTRA_SOURCE || require.resolve('../content-ultra.js'), 'utf8');
const settle = () => new Promise(setImmediate);
const light = vm.runInNewContext(fs.readFileSync(require.resolve('../features/light.js'), 'utf8'), { document: { addEventListener() {} } });
const covered = vm.runInNewContext(`(${source.match(/  const covered = ([^\n]+);/)[1]})`);
// bookFor's failure gate (WP-A1), and its reader: lib/ultra.js's, through the site's queue; here its get() alone.
const gate = source.match(/(?:  const route = [^\n]+\n)?  const failed = [^\n]+\n  const askAgain = [^\n]+\n/)[0];
const reader = (get) => async () => ({ get });

test('GZ-01: the one-page gradebook cache preserves coverage and redraws when only coverage changes', async () => {
  const start = source.indexOf('  const bookFor = '), end = source.indexOf('  // undefined until', start);
  let changed = 0, now = 100000, partial = true;
  const bookFor = vm.runInNewContext(`${gate}${source.slice(start, end)} bookFor`, {
    books: new Map(), covered, Date: { now: () => now }, me: async () => '_900_1', location: { pathname: '/ultra/courses/_101_1/outline' },
    reader: reader(async () => ({ results: [], ...(partial && { paging: { nextPage: '?offset=200' } }) })),
    GZ_PAGE: { gradesByContent: () => new Map(), overall: () => null }, locale: () => 'en', onBook: () => changed++,
  });
  bookFor('_101_1'); await settle();
  assert.equal(bookFor('_101_1').results.complete, false);
  partial = false; now += 60001;
  bookFor('_101_1'); await settle();
  assert.equal(bookFor('_101_1').results.complete, true);
  assert.equal(changed, 2);
});

test('an unchanged gradebook remembers a successful empty late-status answer', async () => {
  const start = source.indexOf('  const bookFor = '), end = source.indexOf('  // undefined until', start);
  let requests = 0, changed = 0, now = 100000, fail = false;
  const books = new Map();
  const bookFor = vm.runInNewContext(`${gate}${source.slice(start, end)} bookFor`, {
    books, covered, Date: { now: () => now }, me: async () => '_900_1', location: { pathname: '/ultra/courses/_101_1/outline' },
    reader: reader(async () => { requests++; if (fail) throw new Error('offline'); return { results: [] }; }), lateIn: async () => new Set(),
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
  assert.equal(requests, 2, 'a failed read waits a minute, lateness or not (WP-A1, ULT-1)');
  now += 60001;
  bookFor('_101_1', true); await settle();
  const book = bookFor('_101_1', true); await settle();
  assert.equal(requests, 3, 'then the failed read retries, and the empty success is reused on the next pass');
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
    chrome: { runtime: { id: 'glaze' } }, observer: {}, ultra: true, dirty, full: false, timer: 0, hid: () => false,
    X: { lift() {}, gate: (node) => added.push(node) }, flush: () => {}, setTimeout: (fn) => { pass = fn; return 1; },
  });
  const a = { nodeType: 1 }, b = { nodeType: 1 }, own = { closest: () => ({}) };
  schedule([{ type: 'childList', target: {}, addedNodes: [a] }, { type: 'childList', target: own, addedNodes: [{ nodeType: 1 }] }, { type: 'childList', target: {}, addedNodes: [b] }]);
  assert.deepEqual(added, [a, b], 'discovery happens in the observer callback, before its timer runs');
  assert.equal(typeof pass, 'function');
});

test('a course tab\'s hidden frame sweeps nothing and owes one full pass; the pointer light\'s writes are skipped', () => {
  const core = fs.readFileSync(process.env.PERF_CORE_SOURCE || require.resolve('../content.js'), 'utf8');
  const start = core.indexOf('  const schedule = '), end = core.indexOf('  const startSweep = ', start);
  let hidden = true, timers = 0;
  const context = vm.createContext({
    chrome: { runtime: { id: 'glaze' } }, observer: {}, ultra: true, dirty: new Set([{}]), full: false, timer: 0, hid: () => hidden, GZ_LIGHT: light,
    X: { lift() {}, gate() {} }, flush: () => {}, setTimeout: () => ++timers,
  });
  const schedule = vm.runInContext(`${core.slice(start, end)} schedule`, context);
  schedule([{ type: 'childList', target: {}, addedNodes: [{ nodeType: 1 }] }]);
  assert.equal(timers, 0);
  assert.equal(vm.runInContext('full && !dirty.size', context), true);
  hidden = false;
  const card = { closest: () => null, getAttribute: () => '--gz-mx: 3px; --gz-my: 4px;' };
  schedule([{ type: 'attributes', attributeName: 'style', target: card, oldValue: '--gz-mx: 1px; --gz-my: 2px;' }]);
  assert.equal(timers, 0, 'the light moving on a card is not a change to sweep');
});

test('a lit card still sweeps native style, class and child changes', () => {
  const core = fs.readFileSync(process.env.PERF_CORE_SOURCE || require.resolve('../content.js'), 'utf8');
  const start = core.indexOf('  const schedule = '), end = core.indexOf('  const startSweep = ', start);
  const dirty = new Set(), added = [];
  const schedule = vm.runInNewContext(`${core.slice(start, end)} schedule`, {
    chrome: { runtime: { id: 'glaze' } }, observer: {}, ultra: true, dirty, full: false, timer: 0, hid: () => false, GZ_LIGHT: light,
    X: { lift() {}, gate: (n) => added.push(n) }, flush() {}, setTimeout: () => 1,
  });
  const card = { closest: () => null, getAttribute: () => 'background: white; --gz-mx: 1px; --gz-my: 2px;' };
  schedule([{ type: 'attributes', attributeName: 'style', target: card, oldValue: '--gz-mx: 1px; --gz-my: 2px;' }]);
  assert.ok(dirty.has(card), 'native background changes on a lit card must be themed');
  dirty.clear();
  schedule([{ type: 'attributes', attributeName: 'class', target: card, oldValue: 'native --gz-mx-card' }]);
  assert.ok(dirty.has(card), 'only style records may be light-only writes');
  const child = { nodeType: 1 };
  schedule([{ type: 'childList', target: card, addedNodes: [child] }]);
  assert.deepEqual(added, [child]);
});

test('a queued flush stays paused while hidden and rediscovers native roots on reveal', () => {
  const core = fs.readFileSync(process.env.PERF_CORE_SOURCE || require.resolve('../content.js'), 'utf8');
  const start = core.indexOf('  const flush = '), end = core.indexOf('  // Throttle,', start);
  let hidden = true, sweeps = 0;
  const body = {}, gates = [], tags = [];
  const X = new Proxy({ gate: (n) => gates.push(n) }, { get: (o, k) => o[k] || (() => {}) });
  const context = vm.createContext({
    timer: 1, dirty: new Set([{}]), full: true, wordsLate: false, hid: () => hidden, ultra: true,
    outermost: () => [], words: () => true, sweepAll: () => sweeps++, sweepRoots() {},
    document: { body }, X, tagExtras: (r) => tags.push(r), themeEditors() {}, tip: null,
    tintKey: () => '', tinted: '', lookHere: () => '', looked: '', placeScene() {},
    surfaceCourse: () => '', html: { style: { getPropertyValue: () => '' } }, keepPlace() {}, watchDrafts() {}, syncDownloads() {}, syncDocTools() {}, syncCourseMenu() {}, syncRules() {},
  });
  const flush = vm.runInContext(`${core.slice(start, end)} flush`, context);
  flush();
  assert.equal(sweeps, 0, 'a timer armed before hide must not consume the reveal pass');
  assert.equal(context.full, true);
  hidden = false;
  flush();
  assert.equal(sweeps, 1);
  assert.equal(context.full, false);
  assert.deepEqual(gates, [body], 'headers replaced while paused must be discovered for nav styling');
  assert.equal(tags[0][0], body);
});

test('draft cleanup reads only listed drafts; without a key listing it reads everything at most once a day', async () => {
  const core = fs.readFileSync(process.env.PERF_CORE_SOURCE || require.resolve('../content.js'), 'utf8');
  const start = core.indexOf('  const tidyDrafts = '), end = core.indexOf('  // ---- download all', start);
  for (const mode of ['keys', 'absent', 'rejected']) {
    const read = [], removed = [], rejected = [];
    // A rejected read must be caught by the feature, rather than escaping into the content world.
    const promise = (value) => {
      const p = Promise.resolve(value);
      return { then(...args) { const next = p.then(...args); next.catch((e) => rejected.push(e)); return next; }, catch(fn) { return promise(p.catch(fn)); } };
    };
    const data = { 'draft:old': {}, 'other:large': {} };
    const area = {
      ...(mode !== 'absent' && { getKeys: () => mode === 'rejected' ? Promise.reject(new Error('unavailable')) : Promise.resolve(Object.keys(data)) }),
      get: (keys, cb) => { read.push(keys); cb(keys === null ? data : Object.fromEntries([keys].flat().filter((k) => k in data).map((k) => [k, data[k]]))); },
      set: (o) => Object.assign(data, o),
      remove: (keys) => removed.push(...keys),
    };
    const window = {};
    window.top = window;
    const tidy = vm.runInNewContext(`${core.slice(start, end)} tidyDrafts`, {
      window, local: (fn) => fn(area), Promise: { resolve: promise }, Date,
      need: async () => {}, GZ_DRAFTS: require('../lib/drafts.js'), settings: { enabled: true, enhance: { drafts: false } },
    });
    tidy();
    await new Promise(setImmediate);
    assert.equal(rejected.length, 0, mode + ': a failed key listing must not leak a rejected promise');
    assert.deepEqual(JSON.parse(JSON.stringify(read)), mode === 'keys' ? [['draft:old']] : ['draftsSwept', null], mode);
    assert.deepEqual(removed, ['draft:old'], mode);
    if (mode === 'keys') continue;
    // The same day: no second read of everything.
    read.length = 0; tidy(); await new Promise(setImmediate);
    assert.deepEqual(read, ['draftsSwept'], `${mode}: once a day`);
  }
});
