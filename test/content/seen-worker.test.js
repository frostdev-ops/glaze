// The keys every site's tabs share (storage.local seenCourses, courseSlots, seenGrades, seenContent): pages send their patch to
// the worker ('glaze:seen', background/background.js), which merges one at a time, so tabs of two sites, whose Web Locks never
// meet, keep each other's entries; a page sets and drops only its own site's, and a merge whose read failed writes nothing
// (audit 2026-11-11 N5). The real worker in a vm (test/helpers/worker-env.cjs), and the real page writers cut out of their files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const env = require('../helpers/worker-env.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const part = (file, from, to) => { const src = read(file), a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return src.slice(a, b); };
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const plain = (v) => JSON.parse(JSON.stringify(v));
const CANVAS = 'https://school.instructure.com', ULTRA = 'https://school.blackboard.com', MOODLE = 'https://school.moodlecloud.com';
const sender = (url) => ({ id: 'glaze', tab: { id: 1, url }, frameId: 0, url });
const AT = { canvas: sender(`${CANVAS}/`), ultra: sender(`${ULTRA}/ultra/course`), moodle: sender(`${MOODLE}/my/`) };
const worker = (local = {}) => env({ store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ...local }, session: {} } });
const seen = (w, at, m) => w.send({ type: 'glaze:seen', ...m }, AT[at]);

test("pages of three sites patching the course list in the same instant keep every site's courses", async () => {
  const w = worker({ seenCourses: {
    'canvas:https://other.instructure.com/9': { name: 'Other school', canvas: true },
    _5_1: { name: 'Left', site: ULTRA }, _6_1: { name: 'Other Ultra', site: 'https://bb.other.edu' },
    [`moodle:${MOODLE}/15`]: { name: 'Dropped', moodle: true }, [`moodle:${MOODLE}/archive/3`]: { name: 'Folder', moodle: true },
  } });
  const r = await Promise.all([
    seen(w, 'canvas', { key: 'seenCourses', set: { [`canvas:${CANVAS}/5`]: { name: 'Calculus', canvas: true } } }),
    seen(w, 'ultra', { key: 'seenCourses', set: { _1_1: { name: 'Biology', slot: '3', site: ULTRA } }, drop: true, stamp: true }),
    seen(w, 'moodle', { key: 'seenCourses', root: `moodle:${MOODLE}/`, set: { [`moodle:${MOODLE}/16`]: { name: 'BIO', moodle: true } }, drop: true, stamp: true }),
    seen(w, 'ultra', { key: 'courseSlots', set: { _1_1: '3' } }),
  ]);
  assert.deepEqual(r.map((x) => x?.ok), [true, true, true, true]);
  assert.deepEqual(Object.keys(w.store.local.seenCourses).sort(), [`canvas:${CANVAS}/5`, 'canvas:https://other.instructure.com/9', `moodle:${MOODLE}/16`, `moodle:${MOODLE}/archive/3`, '_1_1', '_6_1'].sort());
  assert.ok(w.store.local[`seenCoursesAt ${ULTRA}`] > 0 && w.store.local[`seenCoursesAt moodle:${MOODLE}/`] > 0, 'each gate stamped by the worker');
  assert.deepEqual(plain(w.store.local.courseSlots), { _1_1: '3' });
});

test("a page sets and drops only its own site's entries", async () => {
  const before = { 'canvas:https://other.instructure.com/9': { name: 'Other school', canvas: true }, _6_1: { name: 'Other Ultra', site: 'https://bb.other.edu' } };
  const w = worker({ seenCourses: structuredClone(before) });
  for (const [at, m] of [
    ['canvas', { key: 'seenCourses', set: { 'canvas:https://other.instructure.com/9': { name: 'Overwritten' } } }],
    ['canvas', { key: 'seenCourses', set: { _6_1: { name: 'Overwritten', site: 'https://bb.other.edu' } } }],
    ['canvas', { key: 'seenGrades', set: { _6_1: {} } }],
    ['ultra', { key: 'seenCourses', set: { _6_1: { name: 'Overwritten', site: 'https://bb.other.edu' } } }],
    ['moodle', { key: 'seenCourses', root: 'moodle:https://other.instructure.com/', set: { 'moodle:https://other.instructure.com/1': { name: 'x' } }, drop: true }],
    ['ultra', { key: 'courseSlots', set: { _1_1: 'red' } }],
    ['ultra', { key: 'widgetLayout', set: {} }],
  ]) assert.equal((await seen(w, at, m))?.ok, false, JSON.stringify(m));
  // Another site's page, or a page Glaze doesn't run on, is refused outright.
  assert.equal((await w.send({ type: 'glaze:seen', key: 'seenCourses', set: {} }, sender('https://example.com/')))?.ok, false);
  assert.deepEqual(plain(w.store.local.seenCourses), before);
  assert.equal(w.store.local.seenGrades, undefined);
});

for (const [key, value] of [
  ['seenCourses', { name: 'Claimed by sender', site: ULTRA }],
  ['courseSlots', '2'], ['seenGrades', { _9_1: 'B' }], ['seenContent', ['_8_1', '+']],
]) test(`an Ultra sender cannot overwrite another site's ${key} by naming its stored course id`, async () => {
  const before = {
    seenCourses: { _1_1: { name: 'Own', site: ULTRA }, _6_1: { name: 'Other school', site: 'https://other.blackboard.com' } },
    courseSlots: { _6_1: '7' }, seenGrades: { _6_1: { _9_1: 'A' } }, seenContent: { _6_1: ['_9_1', '+'] },
  };
  const w = worker(structuredClone(before));
  const r = await seen(w, 'ultra', { key, set: { _6_1: value }, drop: true, stamp: true });
  assert.equal(r?.ok, false, 'a sender-supplied site or bare id cannot override the stored owner');
  assert.deepEqual(plain(w.store.local[key]), before[key]);
  assert.deepEqual(plain(w.store.local.seenCourses), before.seenCourses);
  assert.equal(w.store.local[`seenCoursesAt ${ULTRA}`], undefined, 'a refused claim cannot stamp the course-list gate');
  assert.equal((await seen(w, 'ultra', { key, set: { _1_1: value } }))?.ok, true, 'the stored owner still writes its course');
  assert.deepEqual(plain(w.store.local[key]._6_1), before[key]._6_1);
});

test('a merge whose read failed writes nothing', async () => {
  const w = worker({ seenGrades: { _1_1: { _9_1: 'A' } } });
  const get = w.context.chrome.storage.local.get;
  w.context.chrome.storage.local.get = async (k) => ([].concat(k).includes('seenGrades') ? Promise.reject(new Error('read failed')) : get(k));
  const r = await seen(w, 'ultra', { key: 'seenGrades', set: { _2_1: { _8_1: 'B' } } });
  assert.notEqual(r?.ok, true);
  assert.deepEqual(plain(w.store.local.seenGrades), { _1_1: { _9_1: 'A' } });
});

test('an empty answer drops nothing, and still stamps the gate', async () => {
  const w = worker({ seenCourses: { _5_1: { name: 'Kept', site: ULTRA } } });
  assert.equal((await seen(w, 'ultra', { key: 'seenCourses', set: {}, drop: true, stamp: true }))?.ok, true);
  assert.deepEqual(Object.keys(w.store.local.seenCourses), ['_5_1']);
  assert.ok(w.store.local[`seenCoursesAt ${ULTRA}`] > 0);
});

// The page writers as they ship, over storage that answers a few turns later (as chrome.storage does), each site with its
// own Web Locks (one origin's): a Canvas tab and an Ultra tab recording their course lists in the same instant.
const slow = (data) => ({
  get: (k, cb) => { const r = Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])); let n = 5; const go = () => (--n ? setImmediate(go) : cb(r)); setImmediate(go); },
  set: (o, cb) => { let n = 5; const go = () => (--n ? setImmediate(go) : (Object.assign(data, structuredClone(o)), cb?.())); setImmediate(go); },
});
const locks = () => { const tails = new Map(); return { request: (name, cb) => { const run = (tails.get(name) || Promise.resolve()).then(() => cb()); tails.set(name, run.catch(() => {})); return run; } }; };
const page = (w, at, scope) => {
  const local = slow(w.store.local);
  const chrome = { storage: { local }, runtime: { id: 'glaze', sendMessage: (m) => w.send(m, AT[at]) } };
  return { chrome, navigator: { locks: locks() }, stored: (k, cb) => local.get(k, cb), Date, Object, Promise, JSON, setTimeout: () => 1, ...scope };
};

test('a Canvas tab and an Ultra tab recording their course lists in the same instant both keep their courses', async () => {
  const w = worker({ seenCourses: { 'canvas:https://other.instructure.com/9': { name: 'Other school', canvas: true } } });
  const ultra = vm.runInNewContext(`${part('content/content-ultra.js', '  const record = ', '  // ---- the gradebook')}\nrecord;`, page(w, 'ultra', {
    location: { origin: ULTRA }, GZ_COURSES: require('../../extension/content/defaults.js').GZ_COURSES, courseSlots: {},
    myCourses: async () => [{ courseId: '_1_1', courseCardColorIndex: 2, course: { name: 'Biology', displayId: 'BIO' } }],
  }));
  const canvas = vm.runInNewContext(`${part('content/content-canvas.js', '  const COURSE_CACHE = ', '  // ---- code on demand')}\nrecord;`, page(w, 'canvas', {
    URL, I: { settings: {}, setCourseList: () => {} }, location: { origin: CANVAS }, sessionStorage: { getItem: () => null, setItem: () => {} },
    canvasCourseKey: (id) => `canvas:${CANVAS}/${id}`,
    capi: async (p) => (p.startsWith('/courses?') ? [{ id: '5', name: 'Calculus', course_code: 'MATH' }] : p === '/users/self/profile' ? { id: '77' } : { custom_colors: {} }),
  }));
  ultra(); canvas();
  await settle(200);
  assert.deepEqual(Object.keys(w.store.local.seenCourses).sort(), ['_1_1', `canvas:${CANVAS}/5`, 'canvas:https://other.instructure.com/9'].sort());
  assert.deepEqual(plain(w.store.local.courseSlots), { _1_1: '3' });
});
