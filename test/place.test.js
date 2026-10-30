// Your place in a course (features/place.js): where its changes are written (the worker's one queue, 'glaze:place', which
// applies only the fields a tab sends to what is stored then), and who the worker takes them from.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// features/place.js on a Canvas course's Modules page (or an item opened from it), with the page's storage, messages, scroll
// and timers faked. env.sent: the messages it sent; env.writes: what it wrote to storage.local itself.
const canvasPage = ({ search = '', stored = {} } = {}) => {
  const env = { sent: [], writes: [], timers: [], scroll: [], session: {}, settings: { enhance: { place: true } } };
  const list = { id: 'context_modules_sortable_container', getBoundingClientRect: () => ({ top: -300 }), parentElement: null };
  const scroller = { scrollTop: 0 };
  const local = {
    get: (k, cb) => cb(Object.fromEntries([].concat(k).filter((x) => x in stored).map((x) => [x, structuredClone(stored[x])]))),
    set: (v, cb) => { env.writes.push(structuredClone(v)); Object.assign(stored, structuredClone(v)); cb?.(); },
  };
  const context = vm.createContext({
    JSON, Math, Number, Date, Set, Map, Object, Array, String, URLSearchParams, console,
    GZ_PAGE: require('../lib/page.js'),
    GZ_CTX: {
      site: 'canvas', local: (fn) => fn(local), courseId: () => undefined, toggleOf: () => null, ROWS: '.row', placeAsked: () => 0,
      canvasCourseKey: () => 'canvas:https://school.instructure.com/25', settings: () => env.settings, solo: true, on: () => true,
      acted: () => 0, holding: () => false, tapped: () => null,
    },
    location: { pathname: '/courses/25/modules', search, origin: 'https://school.instructure.com' },
    sessionStorage: { getItem: (k) => env.session[k] ?? null, setItem: (k, v) => { env.session[k] = v; } },
    document: { scrollingElement: scroller, body: {}, getElementById: (id) => (id === list.id ? list : null), querySelectorAll: () => [], documentElement: { toggleAttribute() {} },
      addEventListener: (type, f) => { if (type === 'scroll') env.scroll.push(f); } },
    getComputedStyle: () => ({ overflowY: 'visible' }),
    clearTimeout: (id) => { if (env.timers[id - 1]) env.timers[id - 1].cancelled = true; },
    setTimeout: (f, ms) => { env.timers.push({ f, ms }); return env.timers.length; },
    chrome: { runtime: { sendMessage: (m, cb) => { env.sent.push(JSON.parse(JSON.stringify(m))); cb?.({ ok: true }); } }, storage: { local } },
  });
  env.local = local;
  env.scroller = scroller;
  env.stored = stored;
  env.sendFails = () => { context.chrome.runtime.sendMessage = () => { throw new Error('Extension context invalidated.'); }; };
  env.ui = vm.runInContext(read('features/place.js'), context);
  return env;
};

// WID-15: savePlace read coursePlace and wrote it back whole, at up to two writes a second while scrolling, so two tabs
// scrolling different courses could write each other's older copy back.
test('scrolling a Modules list sends the worker only this course\'s place, and the page writes no coursePlace itself', async () => {
  const stored = { coursePlace: { _101_1: { open: ['_8130_1'], top: 40, at: 5 } } };
  const env = canvasPage({ stored });
  env.ui.sync(); await settle();
  assert.equal(env.scroll.length, 1, 'the page watches its scroll');
  env.scroller.scrollTop = 640;
  env.scroll[0]();
  assert.equal(env.timers.length, 1);
  env.timers[0].f(); await settle();
  assert.deepEqual(env.sent, [{ type: 'glaze:place', cid: 'canvas:https://school.instructure.com/25', open: [], top: 300 }]);
  assert.deepEqual(env.writes, [], 'nothing read-modified-written from the page');
  assert.deepEqual(env.stored.coursePlace, { _101_1: { open: ['_8130_1'], top: 40, at: 5 } }, "another course's place is exactly as it was");
  assert.equal(JSON.parse(env.session['gz-place:canvas:https://school.instructure.com/25']).top, 300, "and this tab's own copy is still kept");
});

test('opening a module item sends only the item, so the worker keeps the scroll it has', async () => {
  const env = canvasPage({ search: '?module_item_id=271' });
  env.ui.sync(); await settle();
  assert.deepEqual(env.sent, [{ type: 'glaze:place', cid: 'canvas:https://school.instructure.com/25', item: '271' }]);
  assert.deepEqual(env.writes, []);
});

test('a page whose extension was reloaded under it keeps its own tab copy and fails quietly', async () => {
  const env = canvasPage({ stored: {}, search: '' });
  env.ui.sync(); await settle();
  env.sendFails();
  env.scroller.scrollTop = 500;
  env.scroll[0]();
  assert.doesNotThrow(() => env.timers[0].f());
  assert.equal(JSON.parse(env.session['gz-place:canvas:https://school.instructure.com/25']).top, 300);
  assert.deepEqual(env.writes, []);
});

test('disabling place cancels restoration and ignores its outstanding storage reply', async () => {
  const env = canvasPage({ stored: { coursePlace: { 'canvas:https://school.instructure.com/25': { top: 900 } } } });
  const get = env.local.get; let answer;
  env.local.get = (k, cb) => { answer = () => get(k, cb); };
  env.ui.sync();
  env.settings.enhance.place = false; env.ui.stop(true);
  answer();
  assert.equal(env.scroller.scrollTop, 0);
  assert.equal(env.timers.length, 0, 'a late read cannot restart a cancelled restore');
  env.settings.enhance.place = true; env.local.get = get; env.ui.sync();
  assert.ok(env.timers.some((t) => t.ms === 200), 'enabling again starts a fresh place lifecycle');
  env.ui.stop(true);
  assert.ok(env.timers.every((t) => t.cancelled));
});

// ---- who the worker takes them from ------------------------------------------------------------------------------------
test("the worker takes a page's place changes for its own site's courses only, and applies them to what is stored", async () => {
  const listeners = [];
  const store = { local: { canvas: ['https://canvas.school.edu/*'] }, sync: {} };
  const area = (s) => ({ get: async (k) => Object.fromEntries([].concat(k ?? Object.keys(s)).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])), set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async () => {} });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => { for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) return; res('ignored'); });
  const page = (url, extra = {}) => ({ id: 'glaze', tab: {}, frameId: 0, url, ...extra });
  const cid = 'canvas:https://canvas.school.edu/25';
  const m = { type: 'glaze:place', cid, top: 300 };
  const course = 'https://canvas.school.edu/courses/25/modules';
  for (const [sender, why] of [
    [page('https://other.school.edu/courses/25/modules'), "another site's page"],
    [page('https://evil.example/courses/25/modules'), 'a site Glaze does not run on'],
    [{ id: 'other', tab: {}, frameId: 0, url: course }, 'another extension'],
    [{ id: 'glaze', frameId: 0, url: course }, 'not in a tab'],
    [page(course, { frameId: 4 }), "a frame (Canvas's pages outside a course, a course tab's) is not the page"],
  ]) assert.deepEqual(await send(m, sender), { ok: false, error: 'sender' }, why);
  for (const [bad, why] of [
    [{ ...m, cid: 'canvas:https://other.school.edu/25' }, "another site's course"],
    [{ ...m, cid: 'canvas:https://canvas.school.edu/25/../26' }, 'a key outside the pattern'],
    [{ ...m, cid: '_101_1' }, "an Ultra course from a Canvas site's page"],
    [{ ...m, cid: 7 }, 'not a string'],
  ]) assert.deepEqual(await send(bad, page(course)), { ok: false, error: 'sender' }, why);
  assert.deepEqual(store.local.coursePlace, undefined, 'nothing written for any of them');
  assert.deepEqual(await send(m, page(course)), { ok: true });
  const first = JSON.parse(JSON.stringify(store.local.coursePlace));
  assert.deepEqual(Object.keys(first), [cid]);
  assert.equal(first[cid].top, 300);
  // Two tabs' changes, each from its own page, both land; the second sends only a field and keeps the first's others.
  await send({ type: 'glaze:place', cid: 'canvas:https://canvas.school.edu/31', item: '99' }, page('https://canvas.school.edu/courses/31/modules'));
  await send({ type: 'glaze:place', cid, item: '271' }, page(course));
  const got = JSON.parse(JSON.stringify(store.local.coursePlace));
  assert.equal(got[cid].top, 300);
  assert.equal(got[cid].item, '271');
  assert.equal(got['canvas:https://canvas.school.edu/31'].item, '99');
  // Blackboard Ultra: a page under /ultra on a site Glaze has found to be Ultra, for its own course ids (_N_N).
  const ultra = 'https://school.blackboard.test/ultra/courses/_101_1/outline', u = { type: 'glaze:place', cid: '_101_1', open: ['_8130_1'], top: 640 };
  assert.deepEqual(await send(u, page(ultra)), { ok: false, error: 'sender' }, 'not yet found to be Ultra');
  store.local.ultra = ['https://school.blackboard.test'];
  assert.deepEqual(await send({ ...u, cid: 'canvas:https://school.blackboard.test/101' }, page(ultra)), { ok: false, error: 'sender' }, "a Canvas course id from an Ultra page");
  assert.deepEqual(await send({ ...u, cid: '_101_1/../x' }, page(ultra)), { ok: false, error: 'sender' });
  assert.deepEqual(await send(u, page('https://other.blackboard.test/ultra/courses/_101_1/outline')), { ok: false, error: 'sender' });
  assert.deepEqual(await send(u, page(ultra)), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(store.local.coursePlace))._101_1.open, ['_8130_1']);
  assert.equal(JSON.parse(JSON.stringify(store.local.coursePlace))[cid].top, 300, "the Canvas course is as it was");
  assert.deepEqual(await send(u, page(ultra, { frameId: 2, tab: { url: 'https://evil.example/' } })), { ok: false, error: 'sender' }, 'an approved Ultra frame under a foreign tab has no page privilege');
  assert.deepEqual(await send(u, page('about:blank', { frameId: 2, origin: 'https://school.blackboard.test', tab: { url: ultra } })), { ok: true }, 'the same-site Ultra live course frame remains supported');
  const concurrent = await Promise.all(Array.from({ length: 12 }, (_, i) => send({ type: 'glaze:place', cid: `canvas:https://canvas.school.edu/${100 + i}`, top: i + 1 }, page(course))));
  assert.ok(concurrent.every((r) => r.ok), 'all concurrent tabs commit through the broker');
  for (let i = 0; i < 12; i++) assert.equal(store.local.coursePlace[`canvas:https://canvas.school.edu/${100 + i}`].top, i + 1, 'no concurrent course place dropped');
  await Promise.all([send({ ...m, top: 777 }, page(course)), send({ type: 'glaze:place', cid, item: '999' }, page(course))]);
  assert.equal(store.local.coursePlace[cid].top, 777);
  assert.equal(store.local.coursePlace[cid].item, '999');
  // The Place switch is the page's own; with it off the worker takes nothing.
  store.sync.enhance = { place: false };
  assert.deepEqual(await send({ ...m, top: 1 }, page(course)), { ok: false, error: 'sender' });
  assert.equal(JSON.parse(JSON.stringify(store.local.coursePlace))[cid].top, 777);
});
