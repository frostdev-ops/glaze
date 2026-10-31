// Course data ahead of time on Blackboard Ultra (D, courses/page/ahead.js, enhance.prefetch): once the page has settled,
// at low priority and only where what's kept is stale, the To Do copy and the gradebooks of courses with work due; a
// course's content once a course has been pointed at for 150 ms. Run in a VM over courses/ultra.js's page stores as
// stand-ins that record what they're asked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../../extension/content/defaults.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const NOW = Date.now();
const item = (cid, at, sub = null) => ({ id: `_9${cid.slice(1)}`, cid, at, sub });

// stored: storage.local; items: what planned answers; fresh: courses whose gradebook the store has fresh; saved: cid → at.
const page = ({ stored = {}, items = [], fresh = [], saved = {}, ready = 'complete' } = {}) => {
  const asked = [], doc = [], idle = [], timers = [];
  const store = {
    profile: async () => ({ id: '_900_1' }),
    planned: async (from, to, cache, uid, prio) => { asked.push(['planned', uid, prio, cache?.key || null]); return { key: `todo:o/${uid}`, items }; },
    fresh: { book: (cid) => fresh.includes(cid) },
    saved: async (cid) => (cid in saved ? { at: saved[cid], rows: [] } : null),
    book: async (cid, uid, o) => { asked.push(['book', cid, uid, o.prio]); return []; },
    outline: async (cid, o) => { asked.push(['outline', cid, o.prio, o.body]); return { items: [] }; },
  };
  const c = {
    Date, Set, Map, Promise, Error, JSON, Number, String, Object, Array, RegExp,
    GZ_CTX: { need: async () => {} }, GZ_ULTRA: { page: store }, GZ_LMSQ: {},
    document: { readyState: ready, visibilityState: 'visible', addEventListener: (t, f, cap) => doc.push({ t, f, cap }), removeEventListener: (t, f) => { const i = doc.findIndex((x) => x.t === t && x.f === f); if (i >= 0) doc.splice(i, 1); } },
    addEventListener: (t, f) => doc.push({ t, f, win: true }),
    requestIdleCallback: (f) => { idle.push(f); return idle.length; },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].f = null; },
    chrome: { runtime: {}, storage: { local: { get: (k, cb) => cb(structuredClone(stored)) } } },
  };
  c.globalThis = c;
  vm.createContext(c);
  const A = vm.runInContext(read('courses/page/ahead.js'), c);
  const fire = (type, target, relatedTarget = null) => { for (const l of doc.filter((x) => x.t === type)) l.f({ target, relatedTarget }); };
  const el = (attrs) => ({ dataset: attrs.cid ? { courseId: attrs.cid } : {}, getAttribute: (k) => (k === 'href' ? attrs.href || null : null), closest(sel) { return sel.includes('data-course-id') && (attrs.cid || attrs.href) ? this : null; } });
  return { A, asked, doc, idle, timers, fire, el, c };
};

test('once the page has settled: the To Do copy at low priority, then each course with work due whose kept gradebook is stale', async () => {
  const p = page({
    items: [item('_101_1', NOW + 864e5), item('_102_1', NOW + 2 * 864e5), item('_103_1', NOW + 864e5, { submitted: true }), item('_104_1', NOW - 864e5), item('_105_1', NOW + 864e5), item('_106_1', NOW + 864e5)],
    fresh: ['_105_1'], saved: { _102_1: NOW - 60000, _106_1: NOW - 11 * 60000 },
    stored: { todoCache: { key: 'todo:o/_900_1', at: NOW } },
  });
  p.A.sync(true);
  assert.equal(p.asked.length, 0, 'nothing while the page is still busy');
  assert.equal(p.idle.length, 1);
  p.idle.shift()();
  await settle();
  assert.deepEqual(p.asked[0], ['planned', '_900_1', 1, 'todo:o/_900_1'], 'the kept copy is handed over: a fresh one answers without asking');
  assert.deepEqual(p.asked.slice(1), [['book', '_101_1', '_900_1', 1], ['book', '_106_1', '_900_1', 1]],
    'work still due only, not handed in, not past; none fresh in memory or kept less than ten minutes ago');
  // Once a document.
  p.A.sync(false); p.A.sync(true);
  assert.equal(p.idle.length, 0);
});

test('a page still loading waits for its load event; turned off before it settles, nothing is asked', async () => {
  const p = page({ ready: 'loading', items: [item('_101_1', NOW + 864e5)] });
  p.A.sync(true);
  const load = p.doc.find((x) => x.win && x.t === 'load');
  assert.ok(load, 'waits for load');
  load.f();
  assert.equal(p.idle.length, 1);
  p.A.sync(false);
  p.idle.shift()();
  await settle();
  assert.deepEqual(p.asked, []);
});

test('a course pointed at for 150 ms has its content read at low priority, with bodies for search; passing over it reads nothing', async () => {
  const p = page();
  p.A.sync(true);
  const card = p.el({ cid: '_101_1' }), link = p.el({ href: '/ultra/courses/_102_1/outline' }), other = p.el({});
  p.fire('pointerover', card);
  assert.equal(p.timers.at(-1).ms, 150);
  p.fire('pointerout', card, other);
  p.timers.forEach((t) => t.f?.());
  await settle();
  assert.deepEqual(p.asked, [], 'left before the intent');
  p.fire('pointerover', link);
  p.fire('pointerover', link);
  p.timers.forEach((t) => t.f?.());
  await settle();
  assert.deepEqual(p.asked, [['outline', '_102_1', 1, true]], 'a link to a course counts; once');
  // Off: no more listening.
  p.A.sync(false);
  assert.equal(p.doc.filter((x) => !x.win).length, 0);
});

test('the setting: on by default, in Course tabs\' options, and the file loads on the top page only while it is on', () => {
  assert.equal(D.GZ_DEFAULTS.enhance.prefetch, true);
  assert.equal(D.GZ_SANITIZE({ enhance: { prefetch: false } }).enhance.prefetch, false);
  const html = read('options.html'), tabs = html.slice(html.indexOf('<section id="tabs"'), html.indexOf('</section>', html.indexOf('<section id="tabs"')));
  assert.match(tabs, /data-key="enhance\.prefetch"/);
  assert.match(read('content/content-ultra.js'), /const syncAhead = \(\) => load\(\(\) => !tabFrame && top\(\)\?\.prefetch, 'courses\/page\/ahead\.js', 'GZ_AHEAD'\);/);
  assert.match(read('content/content-ultra.js'), /syncRemind: \(\) => \(syncRemind\(\), syncAhead\(\)\)/);
  assert.match(read('background/background.js'), /'courses\/page\/ahead\.js'/);
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) assert.match(read(`i18n/${lang}.js`), /"Load course data ahead of time":/, lang);
});

test('prefetch turned off while its library loads starts no identity or content reads', async (t) => {
  for (const kind of ['idle', 'pointer']) await t.test(kind, async () => {
    const p = page();
    let release;
    p.c.GZ_CTX.need = () => new Promise((r) => { release = r; });
    p.c.GZ_ULTRA.page.profile = async () => { p.asked.push(['profile']); return { id: '_900_1' }; };
    p.A.sync(true);
    if (kind === 'idle') p.idle.shift()();
    else { p.fire('pointerover', p.el({ cid: '_101_1' })); p.timers.at(-1).f(); }
    await settle();
    p.A.sync(false);
    p.c.GZ_CTX.need = async () => {};
    release();
    await settle();
    assert.deepEqual(p.asked, [], kind);
  });
});

test('prefetch turned off while saved gradebooks are read starts no later gradebook request', async () => {
  const p = page({ items: [item('_101_1', NOW + 864e5)] });
  let release;
  p.c.GZ_ULTRA.page.saved = () => new Promise((r) => { release = r; });
  p.A.sync(true); p.idle.shift()();
  await settle();
  p.A.sync(false);
  release(null);
  await settle();
  assert.deepEqual(p.asked.filter((a) => a[0] === 'book'), []);
});

test('a tab that settles while hidden prefetches once it becomes visible', async () => {
  const p = page();
  p.c.document.visibilityState = 'hidden';
  p.A.sync(true); p.idle.shift()();
  await settle();
  assert.deepEqual(p.asked, []);
  p.c.document.visibilityState = 'visible';
  p.fire('visibilitychange');
  assert.equal(p.idle.length, 1);
  p.idle.shift()();
  await settle();
  assert.equal(p.asked.filter((a) => a[0] === 'planned').length, 1);
  p.A.sync(false);
});
