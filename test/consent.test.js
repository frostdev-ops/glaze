// WP-C2 (audit CORE-2, ULT-4, CORE-8): Glaze asks before it runs on a site it doesn't know, keeps each site's records
// apart, and takes a page's requests only from the sites it runs on. The real lib/background.js in a VM with Chrome
// stubbed; content.js, content-ultra.js's record(), features/consent.js and the popup's due list on stand-in pages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = require('../manifest.json');
const plain = (x) => JSON.parse(JSON.stringify(x));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = 'glaze';
const CANVAS_FIRST = manifest.content_scripts.find((c) => c.js.includes('content-canvas.js')).js;
const ULTRA_FIRST = manifest.content_scripts.find((c) => c.js.includes('content-ultra.js')).js;
// Safari's manifest, as scripts/safari-manifest.sh makes it.
const SAFARI = (() => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'glaze-consent-safari-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    require('node:child_process').execFileSync('sh', [path.join(root, 'scripts/safari-manifest.sh'), path.join(dir, 'manifest.json')]);
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
const ASK = ['lib/i18n.js', 'features/consent.js'];

// ---- the worker -----------------------------------------------------------------------------------------------------
// `granted`: the hosts Glaze holds (chrome.permissions), every one unless named; `m`: the manifest, Chrome's unless named.
const worker = ({ local = {}, sync = {}, granted = () => true, m = manifest } = {}) => {
  const store = { local: structuredClone(local), sync: structuredClone(sync) };
  const listeners = [], changed = [], installed = [], ran = [], opened = [], checked = [];
  const w = { store, ran, opened, installed, checked, registered: [] };
  w.local = { set: (v) => context.chrome.storage.local.set(v) };
  const pick = (s, k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])));
  const tell = (name, before) => {
    const c = {};
    for (const k of new Set([...Object.keys(before), ...Object.keys(store[name])])) if (JSON.stringify(before[k]) !== JSON.stringify(store[name][k])) c[k] = { oldValue: before[k], newValue: store[name][k] };
    if (Object.keys(c).length) for (const f of changed) f(structuredClone(c), name);
  };
  const area = (name) => ({
    get: async (k) => pick(store[name], k),
    getKeys: async () => Object.keys(store[name]),
    set: async (v) => { const before = structuredClone(store[name]); Object.assign(store[name], structuredClone(v)); tell(name, before); },
    remove: async (k) => { const before = structuredClone(store[name]); for (const x of [].concat(k)) delete store[name][x]; tell(name, before); },
  });
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), context, { filename: f }); },
    chrome: {
      runtime: {
        id: ID, getURL: (p = '') => `chrome-extension://${ID}/${p}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener: (f) => installed.push(f) }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
        openOptionsPage: () => { opened.push('options'); return Promise.resolve(); },
      },
      permissions: { contains: async ({ origins }) => { checked.push(...origins); return origins.every(granted); } },
      tabs: { query: async () => [], create: async (o) => { opened.push(o.url); }, onRemoved: { addListener() {} } },
      storage: { local: area('local'), sync: area('sync'), onChanged: { addListener: (f) => changed.push(f) } },
      scripting: {
        getRegisteredContentScripts: async () => w.registered.map((s) => ({ ...s })),
        registerContentScripts: async (list) => { w.registered.push(...plain(list)); },
        unregisterContentScripts: async (o) => { w.registered = o?.ids ? w.registered.filter((s) => !o.ids.includes(s.id)) : []; },
        executeScript: async (o) => {
          ran.push(o.files ? { target: plain(o.target), files: [...o.files] } : { target: plain(o.target), func: String(o.func), args: plain(o.args || []) });
          return [{ result: o.files ? {} : /typeof GZ_I18N|window\.__gzGlaze/.test(String(o.func)) ? false : true }];
        },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context, { filename: 'lib/background.js' });
  // A message as the browser hands it on: its reply, or 'ignored' once nothing has answered.
  w.send = (m, s) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(m, s, (r) => res(plain(r))) === true) kept = true;
    if (!kept) settle().then(() => res('ignored'));
  });
  w.files = () => ran.filter((r) => r.files).map((r) => r.files);
  w.hosts = () => w.registered.filter((s) => /^https:/.test(s.id)).map((s) => s.id).sort();
  w.ultra = () => w.registered.filter((s) => s.id.startsWith('ultra:')).map((s) => s.id).sort();
  return w;
};
// A content script in a tab's top frame (or `frameId`), on `url`, as Chrome names its sender.
const page = (url, more = {}) => ({ id: ID, tab: { id: 7, url }, frameId: 0, url, documentId: 'doc-1', ...more });
const editor = { id: ID, tab: { id: 9 }, frameId: 0, url: `chrome-extension://${ID}/options.html`, origin: `chrome-extension://${ID}` };
const popup = { id: ID, url: `chrome-extension://${ID}/popup.html`, origin: `chrome-extension://${ID}` };
const yes = (kind) => ({ type: 'glaze:consent', op: 'yes', kind });
const denied = { ok: false, error: 'sender' };

test('CORE-2: spoofed Canvas, Moodle and Ultra markup on an unknown site gets the question only: nothing registered, approved or trusted', async () => {
  const w = worker();
  await w.send('canvas', page('https://shop.test/products/1'));
  await w.send('moodle', page('https://blog.test/'));
  await w.send('ultra', page('https://evil.test/ultra/'));
  await settle();
  assert.deepEqual(w.registered, [], 'no host registered');
  assert.deepEqual(w.store.local, {}, 'no site on a list, nothing recorded');
  // On Chrome an Ultra page off Blackboard's hosts reports through lib/detect.js, which has none of Glaze's words.
  assert.deepEqual(w.files(), [ASK, ASK, ASK], 'the question in Glaze\'s words; nothing of Glaze itself');
  assert.deepEqual(w.ran.filter((r) => r.func?.includes('.show(')).map((r) => r.args[0]), ['canvas', 'moodle', 'ultra']);
  assert.ok(w.ran.every((r) => r.target.documentIds?.[0] === 'doc-1'), 'into the page that asked');
  // The spoofed Ultra site is no Ultra page to the broker: it can't write Glaze's records for its "own" accounts.
  const fake = page('https://evil.test/ultra/course');
  assert.deepEqual(await w.send({ type: 'glaze:notes', key: 'notes:https://evil.test/_5_1', text: 'x', at: 1 }, fake), denied);
  assert.deepEqual(await w.send({ type: 'glaze:todo', key: 'todo:https://evil.test/_1_1', edits: [] }, fake), denied);
  assert.equal(await w.send({ type: 'glaze:ultra' }, fake), 'ignored', 'and its own report approves nothing');
  // No question from a frame, an http page, another extension, or an "Ultra" page off /ultra.
  const n = w.ran.length;
  for (const s of [page('https://shop.test/', { frameId: 2 }), page('http://shop.test/'), { ...page('https://shop.test/'), id: 'other' }, { ...page('https://shop.test/'), tab: undefined }]) await w.send('canvas', s);
  await w.send('ultra', page('https://evil.test/webapps/portal'));
  await settle();
  assert.equal(w.ran.length, n);
  assert.deepEqual(w.store.local, {});
  // Safari's Ultra entry has content.js, and its words, in every /ultra page already.
  const safari = worker({ m: SAFARI });
  await safari.send('ultra', page('https://evil.test/ultra/'));
  await settle();
  assert.deepEqual(safari.files(), [['features/consent.js']]);
});

test('CORE-2: the student\'s yes approves the site, registers it and puts Glaze in that page; on Safari an Ultra page then starts by itself', async () => {
  const w = worker();
  const shop = page('https://shop.test/products/1');
  await w.send('canvas', shop);
  await settle();
  assert.deepEqual(await w.send(yes('canvas'), shop), { ok: true });
  await settle();
  assert.deepEqual(w.store.local.canvas, ['https://shop.test/*']);
  assert.deepEqual(w.hosts(), ['https://shop.test/*']);
  assert.deepEqual(w.registered.find((s) => s.id === 'https://shop.test/*').js, CANVAS_FIRST);
  assert.deepEqual(w.files().at(-1), CANVAS_FIRST.filter((f) => f !== 'lib/i18n.js'), 'Glaze into the page, but for the words the question brought');
  assert.deepEqual(w.ran.filter((r) => r.files).at(-1).target, { tabId: 7, documentIds: ['doc-1'] });
  // Ultra: on the list, and Ultra's first content script into that page (on Chrome nothing of Glaze waits there).
  const bb = page('https://bb.school.edu/ultra/course');
  const n = w.files().length;
  assert.deepEqual(await w.send(yes('ultra'), bb), { ok: true });
  await settle();
  assert.deepEqual(w.store.local.ultra, ['https://bb.school.edu']);
  assert.deepEqual(w.files().slice(n), [ULTRA_FIRST.filter((f) => f !== 'lib/i18n.js')]);
  // Safari: nothing injected (its content.js is in the page, waiting for the list).
  const safari = worker({ m: SAFARI });
  assert.deepEqual(await safari.send(yes('ultra'), bb), { ok: true });
  await settle();
  assert.deepEqual([safari.store.local.ultra, safari.files()], [['https://bb.school.edu'], []]);
  assert.equal((await w.send({ type: 'glaze:notes', key: 'notes:https://bb.school.edu/_5_1', text: 'hi', at: 1 }, bb)).ok, true, 'its pages now keep their own data');
  // A yes only counts from a page's top frame, over https, for an LMS Glaze knows (and Ultra's from /ultra).
  for (const [s, kind] of [[page('https://a.test/', { frameId: 1 }), 'canvas'], [page('http://a.test/'), 'canvas'], [page('https://a.test/webapps/x'), 'ultra'],
    [{ ...page('https://a.test/'), tab: undefined }, 'canvas'], [page('https://a.test/'), 'blackboard'], [{ ...page('https://a.test/'), id: 'other' }, 'moodle']]) {
    assert.deepEqual(await w.send(yes(kind), s), { ok: false }, `${s.url} ${kind}`);
  }
  assert.deepEqual(await w.send({ type: 'glaze:consent', op: 'always', kind: 'canvas' }, page('https://a.test/')), { ok: false });
  assert.deepEqual([w.store.local.canvas, w.store.local.moodle], [['https://shop.test/*'], undefined]);
});

test('CORE-2: nothing is asked or registered while Glaze is off', async () => {
  const w = worker({ sync: { enabled: false } });
  const shop = page('https://shop.test/');
  await w.send('canvas', shop);
  await w.send('ultra', page('https://evil.test/ultra/'));
  await settle();
  assert.deepEqual(w.ran, [], 'no question');
  assert.deepEqual(await w.send(yes('canvas'), shop), { ok: false }, 'a question left open from before is no yes now');
  assert.deepEqual(w.store.local, {});
  assert.deepEqual(w.registered, []);
});

test('review: approved detections and joins cannot register or inject while off', async () => {
  const w = worker({ local: { canvas: ['https://a.edu/*'] }, sync: { enabled: false } });
  await w.send('canvas', page('https://a.edu/'));
  await w.send('canvas', page('https://school.instructure.com/'));
  assert.deepEqual(await w.send({ type: 'glaze:consent', op: 'join', kind: 'canvas' }, page('https://a.edu/')), { ok: false });
  await settle();
  assert.deepEqual(w.ran, []);
  assert.deepEqual(w.registered, []);
  assert.deepEqual(w.store.local.canvas, ['https://a.edu/*']);
});

test('review: migration preserves a newer scoped list and ignores malformed legacy origins', async () => {
  const fresh = { at: 200, list: [{ title: 'New' }] };
  const w = worker({ local: { dueWeek: [{ title: 'Old' }], dueWeekAt: 100, dueWeekFrom: 'https://a.edu', 'dueWeek:https://a.edu': fresh } });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual(w.store.local['dueWeek:https://a.edu'], fresh);
  const bad = worker({ local: { dueWeek: [], dueWeekAt: 1, dueWeekFrom: 'https://a.edu:bad' } });
  bad.installed[0]({ reason: 'update' });
  await settle();
  assert.equal(bad.store.local['dueWeek:https://a.edu:bad'], undefined);
});

test('review: trust uses hostname suffix boundaries and HTTPS origin/port boundaries', async () => {
  const w = worker({ local: { canvas: ['https://a.edu/*'], ultra: ['https://bb.edu:8443'] } });
  for (const url of ['https://evil-blackboard.com/ultra/', 'https://blackboard.com.evil.test/ultra/', 'https://schοol.blackboard.cοm/ultra/', 'http://school.blackboard.com/ultra/',
    'http://a.edu/', 'https://a.edu:8443/', 'https://school.instructure.com:8443/', 'https://school.blackboard.com:8443/ultra/']) {
    assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page(url)), denied, url);
  }
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page('https://bb.edu:8443/ultra/')), { ok: true }, 'explicit Ultra origin keeps its port');
  assert.deepEqual(await w.send(yes('canvas'), page('https://a.edu:8443/')), { ok: true });
  assert.ok(w.store.local.canvas.includes('https://a.edu:8443/*'));
  assert.deepEqual(w.registered.find((s) => s.id === 'https://a.edu:8443/*').matches, ['https://a.edu/*']);
  assert.ok(w.registered.every((s) => s.matches.every((p) => !/:8443/.test(p))), 'browser match patterns never include a port');
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page('https://a.edu:9443/')), denied, 'approval still does not widen to another port');
});

test('review: Reset clears scoped records and planner cache while retaining notes and tasks', async () => {
  const A = 'https://a.edu';
  const task = { items: [] }, note = { text: 'mine' };
  const w = worker({ local: { ultra: [A], seenCourses: { _1_1: { site: A, name: 'A' } }, courseSlots: { _1_1: '2' }, [`dueWeek:${A}`]: { at: 1, list: [] },
    [`seenCoursesAt ${A}`]: 1, todoCache: { key: `todo:${A}/_1_1` }, [`todo:${A}/_1_1`]: task, [`notes:${A}/_1_1`]: note } });
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'reset' }, editor), { ok: true });
  for (const key of [`dueWeek:${A}`, `seenCoursesAt ${A}`, 'todoCache']) assert.equal(w.store.local[key], undefined, key);
  assert.deepEqual(w.store.local.seenCourses, {});
  assert.deepEqual(w.store.local[`todo:${A}/_1_1`], task);
  assert.deepEqual(w.store.local[`notes:${A}/_1_1`], note);
});

test('review: Glaze extension preview frames retain code-on-demand access', async () => {
  const w = worker();
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { ...editor, url: `chrome-extension://${ID}/preview.html`, frameId: 2 }), { ok: true });
});

test('Not now: no question on that site for a week; a yes clears it; kept for the 50 sites put off last', async () => {
  const w = worker();
  const shop = page('https://shop.test/');
  const t0 = Date.now();
  assert.deepEqual(await w.send({ type: 'glaze:consent', op: 'later', kind: 'canvas' }, shop), { ok: true });
  const until = w.store.local.askLater['https://shop.test'];
  assert.ok(until >= t0 + 7 * 864e5 && until <= Date.now() + 7 * 864e5, 'a week');
  await w.send('canvas', shop);
  await settle();
  assert.deepEqual(w.ran, [], 'not asked again within the week');
  assert.equal(w.store.local.canvas, undefined, 'and not approved either');
  w.store.local.askLater['https://shop.test'] = Date.now() - 1;
  await w.send('canvas', shop);
  await settle();
  assert.deepEqual(w.files(), [ASK], 'the week over: asked again');
  for (let i = 0; i < 60; i++) await w.send({ type: 'glaze:consent', op: 'later', kind: 'moodle' }, page(`https://s${i}.test/`));
  assert.equal(Object.keys(w.store.local.askLater).length, 50);
  assert.ok('https://s59.test' in w.store.local.askLater && !('https://s9.test' in w.store.local.askLater) && !('https://shop.test' in w.store.local.askLater));
  assert.deepEqual(await w.send(yes('moodle'), page('https://s59.test/')), { ok: true });
  assert.ok(!('https://s59.test' in w.store.local.askLater));
});

test('known LMS hosts and the sites approved before this version keep working, with no question', async () => {
  const w = worker({ local: { canvas: ['https://canvas.school.edu/*'], moodle: ['https://moodle.school.edu/*'], ultra: ['https://bb.school.edu'] } });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual(w.hosts(), ['https://canvas.school.edu/*', 'https://moodle.school.edu/*'], 'their registrations come back after the update');
  await w.send('canvas', page('https://canvas.school.edu/courses/1'));
  await settle();
  assert.deepEqual(w.files(), [CANVAS_FIRST], 'an approved site\'s page that lacks Glaze gets it at once');
  const note = (url, key) => w.send({ type: 'glaze:notes', key, text: 'hi', at: 1 }, page(url));
  assert.equal((await note('https://bb.school.edu/ultra/course', 'notes:https://bb.school.edu/_5_1')).ok, true, 'an Ultra site approved before');
  assert.equal((await note('https://school.blackboard.com/ultra/course', 'notes:https://school.blackboard.com/_5_1')).ok, true, 'Blackboard\'s own host');
  assert.equal((await note('https://school.instructure.com/courses/1', 'notes:https://school.instructure.com/42')).ok, true, 'Instructure\'s own host');
  assert.equal((await note('https://canvas.school.edu/courses/1', 'notes:https://canvas.school.edu/42')).ok, true, 'a Canvas approved before');
  assert.deepEqual(w.store.local.ultra, ['https://bb.school.edu'], 'Blackboard\'s own hosts never go on the list');
});

test('Settings\' Remove unregisters a site, takes it off its list and forgets what Glaze read there; Reset everything empties the lists', async () => {
  const A = 'https://canvas.school.edu', B = 'https://bb.school.edu', M = 'https://moodle.school.edu';
  const w = worker({ local: {
    canvas: [`${A}/*`], moodle: [`${M}/*`], ultra: [B], askLater: { 'https://x.test': Date.now() + 1e6 },
    seenCourses: { _5_1: { name: 'B course', site: B }, _6_1: { name: 'Another Ultra', site: 'https://bb.other.edu' }, [`canvas:${A}/12`]: { name: 'A course' }, [`moodle:${M}/moodle/3`]: { name: 'M course' } },
    courseSlots: { _5_1: '2', _6_1: '3' }, [`seenCoursesAt ${B}`]: 1, [`seenCoursesAt moodle:${M}/moodle/`]: 1,
    [`dueWeek:${B}`]: { at: 1, list: [] }, [`dueWeek:${A}`]: { at: 1, list: [] }, todoCache: { key: `todo:${B}/_9_1`, at: 1, items: [] }, [`notes:${B}/_9_1`]: { text: 'mine', at: 1 },
  } });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual(w.hosts(), [`${A}/*`, `${M}/*`]);
  const remove = (origin, s = editor) => w.send({ type: 'glaze:sites', op: 'remove', origin }, s);
  for (const [s, why] of [[page(`${A}/courses/1`), 'a page'], [{ ...editor, frameId: 3 }, 'Settings in a frame'], [popup, 'the popup']]) assert.deepEqual(await remove(B, s), denied, why);
  for (const bad of [`${B}/x`, 'bb.school.edu', 'javascript:alert(1)', 'http://bb.school.edu', null]) assert.deepEqual(await remove(bad), denied, String(bad));
  assert.deepEqual(await remove(B), { ok: true });
  const L = w.store.local;
  assert.deepEqual(L.ultra, []);
  assert.deepEqual(Object.keys(L.seenCourses).sort(), ['_6_1', `canvas:${A}/12`, `moodle:${M}/moodle/3`], 'its courses go; other sites\' stay');
  assert.deepEqual(L.courseSlots, { _6_1: '3' });
  for (const k of [`seenCoursesAt ${B}`, `dueWeek:${B}`, 'todoCache']) assert.ok(!(k in L), k);
  assert.deepEqual(L[`notes:${B}/_9_1`], { text: 'mine', at: 1 }, 'the student\'s own notes stay');
  assert.ok(`dueWeek:${A}` in L);
  assert.deepEqual(await w.send({ type: 'glaze:notes', key: `notes:${B}/_9_1`, text: 'x', at: 2 }, page(`${B}/ultra/course`)), denied, 'its pages are no longer trusted');
  assert.deepEqual(await remove(M), { ok: true });
  assert.ok(!(`seenCoursesAt moodle:${M}/moodle/` in L), 'a Moodle in a folder: its gate too');
  assert.deepEqual(w.hosts(), [`${A}/*`], 'unregistered');
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'reset' }, page(`${A}/courses/1`)), denied);
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'reset' }, editor), { ok: true });
  for (const k of ['canvas', 'moodle', 'ultra', 'askLater']) assert.ok(!(k in L), k);
  assert.deepEqual(w.hosts(), []);
});

// Chrome's manifest takes Ultra on Blackboard's hosts only: an Ultra site the student approved is registered as Canvas and
// Moodle sites are, with Ultra's first content script on its /ultra pages.
test('approved Ultra sites get Ultra\'s first content script on their /ultra pages; a site taken off loses it', async () => {
  const B = 'https://bb.school.edu', P = 'https://bb.port.edu:8443', A = 'https://canvas.school.edu';
  const w = worker({ local: { canvas: [`${A}/*`], ultra: [B, P, 'https://school.blackboard.com', B] } });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual(w.ultra(), ['ultra:https://bb.port.edu', `ultra:${B}`], 'once each; Blackboard\'s own host has the manifest\'s entry');
  assert.deepEqual(w.hosts(), [`${A}/*`], 'apart from Canvas\'s and Moodle\'s ids');
  const reg = w.registered.find((s) => s.id === `ultra:${B}`);
  assert.deepEqual(reg, { id: `ultra:${B}`, matches: [`${B}/ultra`, `${B}/ultra/*`], js: ULTRA_FIRST, runAt: 'document_start', allFrames: true, persistAcrossSessions: true });
  assert.deepEqual(w.registered.find((s) => s.id === 'ultra:https://bb.port.edu').matches, ['https://bb.port.edu/ultra', 'https://bb.port.edu/ultra/*'], 'no port in a match pattern');
  // A yes on another Ultra site registers it too; nothing is registered twice.
  const C = 'https://bb.other.edu';
  assert.deepEqual(await w.send(yes('ultra'), page(`${C}/ultra/course`)), { ok: true });
  assert.deepEqual(w.ultra(), [`ultra:${C}`, 'ultra:https://bb.port.edu', `ultra:${B}`].sort());
  assert.equal(w.registered.length, new Set(w.registered.map((s) => s.id)).size);
  // Settings' Remove unregisters that site's /ultra pages and keeps the rest.
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'remove', origin: B }, editor), { ok: true });
  assert.deepEqual(w.ultra(), [`ultra:${C}`, 'ultra:https://bb.port.edu']);
  assert.deepEqual(w.hosts(), [`${A}/*`]);
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'reset' }, editor), { ok: true });
  assert.deepEqual(w.registered.filter((s) => /^(https|ultra):/.test(s.id)), []);
});

test('approved Ultra sites stay registered while Glaze is off, as the manifest\'s Ultra entry does; Canvas and Moodle sites don\'t', async () => {
  const B = 'https://bb.school.edu';
  const w = worker({ local: { ultra: [B], canvas: ['https://canvas.school.edu/*'] }, sync: { enabled: false } });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual([w.ultra(), w.hosts()], [[`ultra:${B}`], []]);
});

test('Ultra approvals on two ports share one script and removing either keeps the other working', async () => {
  const host = 'https://bb.ports.edu', port = `${host}:8443`;
  const w = worker({ local: { ultra: [port, host] } });
  w.installed[0]({ reason: 'update' });
  await settle();
  const scripts = () => w.registered.filter((s) => s.id.startsWith('ultra:'));
  assert.equal(scripts().length, 1, 'portless browser matches must not inject the same bundle twice');
  assert.deepEqual(scripts()[0].matches, [`${host}/ultra`, `${host}/ultra/*`]);
  for (const origin of [port, host]) assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page(`${origin}/ultra/course`)), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'remove', origin: host }, editor), { ok: true });
  assert.equal(scripts().length, 1);
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page(`${port}/ultra/course`)), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page(`${host}/ultra/course`)), denied);
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'remove', origin: port }, editor), { ok: true });
  assert.deepEqual(scripts(), []);
});

test('a list changed in storage registers what it now holds', async () => {
  const w = worker();
  const area = w.store.local;
  assert.deepEqual(await w.send(yes('ultra'), page('https://bb.school.edu/ultra/course')), { ok: true });
  assert.deepEqual(w.ultra(), ['ultra:https://bb.school.edu']);
  // Written to storage directly.
  await w.local.set({ ultra: [...area.ultra, 'https://bb.two.edu'] });
  await settle();
  assert.deepEqual(w.ultra(), ['ultra:https://bb.school.edu', 'ultra:https://bb.two.edu']);
  await w.local.set({ ultra: [] });
  await settle();
  assert.deepEqual(w.ultra(), []);
});

test('Safari (Ultra on /ultra anywhere) registers no Ultra site, and its yes needs no grant', async () => {
  const B = 'https://bb.school.edu';
  const w = worker({ m: SAFARI, local: { ultra: [B] }, granted: () => false });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual(w.ultra(), [], 'its manifest entry is in the page already: registering would run Glaze twice');
  const shop = page('https://shop.test/');
  await w.send('canvas', shop);
  await settle();
  assert.deepEqual(await w.send(yes('canvas'), shop), { ok: true });
  assert.deepEqual(w.store.local.canvas, ['https://shop.test/*']);
  assert.deepEqual(w.hosts(), ['https://shop.test/*']);
  assert.deepEqual(w.checked, [], '<all_urls> holds every site');
});

test('on Chrome a yes approves nothing on a site whose host Glaze doesn\'t hold', async () => {
  let held = [];
  const w = worker({ granted: (o) => held.includes(o) });
  const shop = page('https://shop.test/'), bb = page('https://bb.school.edu/ultra/course');
  await w.send('canvas', shop);
  await settle();
  assert.deepEqual(await w.send(yes('canvas'), shop), { ok: false });
  assert.deepEqual(await w.send(yes('ultra'), bb), { ok: false });
  assert.deepEqual([w.store.local.canvas, w.store.local.ultra], [undefined, undefined]);
  assert.deepEqual(w.registered, []);
  assert.deepEqual([...new Set(w.checked)].sort(), ['https://bb.school.edu/*', 'https://shop.test/*'], 'asked by each site\'s origin');
  held = ['https://shop.test/*', 'https://bb.school.edu/*'];
  assert.deepEqual(await w.send(yes('canvas'), shop), { ok: true });
  assert.deepEqual(await w.send(yes('ultra'), bb), { ok: true });
  assert.deepEqual([w.hosts(), w.ultra()], [['https://shop.test/*'], ['ultra:https://bb.school.edu']]);
});

test('MoodleCloud is built in: trusted with no yes, and an approval from before is never registered over the manifest\'s entry', async () => {
  const M = 'https://school.moodlecloud.com', O = 'https://moodle.school.edu';
  const w = worker({ local: { moodle: [`${M}/*`, `${O}/*`] } });
  w.registered.push({ id: `${M}/*`, matches: [`${M}/*`], js: CANVAS_FIRST.filter((f) => f !== 'content-canvas.js') }, { id: `ultra:https://gone.edu`, matches: ['https://gone.edu/ultra'], js: ULTRA_FIRST });
  assert.deepEqual(await w.send({ type: 'glaze:sites', op: 'remove', origin: 'https://other.edu' }, editor), { ok: true });
  assert.deepEqual(w.hosts(), [`${O}/*`], 'the old registration goes: the manifest\'s entry runs there');
  assert.deepEqual(w.ultra(), [], 'and an Ultra site no longer listed');
  const fresh = worker();
  assert.deepEqual(await fresh.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page('https://other.moodlecloud.com/my/')), { ok: true });
  for (const url of ['https://other.moodlecloud.com:8443/my/', 'http://other.moodlecloud.com/my/', 'https://moodlecloud.com.evil.test/my/']) {
    assert.deepEqual(await fresh.send({ type: 'glaze:load', files: ['lib/zip.js'] }, page(url)), denied, url);
  }
});

test('local Canvas (http://localhost) is Glaze\'s where the manifest lists it or its optional grant is held; Safari unchanged', async () => {
  const local = page('http://localhost:3000/courses/1');
  const load = (w) => w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, local);
  assert.deepEqual(await load(worker({ granted: () => false })), denied, 'not granted');
  assert.deepEqual(await load(worker({ granted: (o) => o === 'http://localhost/*' })), { ok: true }, 'granted');
  assert.deepEqual(await load(worker({ m: { ...manifest, host_permissions: [...manifest.host_permissions, 'http://localhost/*'] }, granted: () => false })), { ok: true }, 'a dev build that lists it');
  assert.deepEqual(await load(worker({ m: SAFARI })), denied, 'Safari\'s <all_urls> is no dev build');
});

test('CORE-8: a Look, a rotation turn, Settings and code on demand are refused to a tab where only lib/detect.js runs', async () => {
  const w = worker({ local: { moodle: ['https://moodle.school.edu/*'] } });
  const look = { type: 'glaze:look', parts: null, patch: { version: 2, colors: { '--gz-accent': '#123456' } } };
  for (const s of [page('https://shop.test/'), page('https://evil.test/ultra/course')]) {
    assert.deepEqual(await w.send(look, s), denied, s.url);
    assert.deepEqual(await w.send({ type: 'glaze:rotate', now: true }, s), denied, s.url);
    assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, s), denied, s.url);
    await w.send('options', s);
  }
  await settle();
  assert.deepEqual(w.opened, [], 'no Settings opened');
  assert.deepEqual(w.ran, [], 'nothing injected');
  assert.equal(w.store.sync.colors, undefined, 'the Look as it was');
  // A site Glaze runs on, in any frame it is in, and Glaze's own pages: as before.
  const canvas = page('https://school.instructure.com/courses/1');
  for (const s of [canvas, page('https://moodle.school.edu/course/view.php?id=2', { frameId: 4 }), page('https://school.blackboard.com/ultra/course')]) {
    assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, s), { ok: true }, s.url);
  }
  assert.deepEqual(await w.send(look, canvas), { ok: true });
  assert.deepEqual(await w.send(look, popup), { ok: true });
  for (const s of [canvas, popup]) assert.notDeepEqual(await w.send({ type: 'glaze:rotate' }, s), denied);
  await w.send('options', page('https://moodle.school.edu/my/'));
  await w.send('options', editor);
  await settle();
  assert.deepEqual(w.opened, ['options', 'options']);
  // Gradescope's own pages load their catalogue, and nothing else.
  const gs = page('https://www.gradescope.com/courses/1');
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['i18n/de.js'] }, gs), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, gs), denied);
});

test('the update from 3.3.4 files the one due list under its site and drops the shared Ultra gate; a Canvas planner list lands per site', async () => {
  const now = Date.now();
  const w = worker({ local: { dueWeek: [{ title: 'Essay', due: now + 1 }], dueWeekAt: 123, dueWeekFrom: 'https://a.edu', seenCoursesAt: 5, seenCourses: { _1_1: { name: 'kept', site: 'https://a.edu' } } } });
  w.installed[0]({ reason: 'update' });
  await settle();
  assert.deepEqual(w.store.local['dueWeek:https://a.edu'], { at: 123, list: [{ title: 'Essay', due: now + 1 }] });
  for (const k of ['dueWeek', 'dueWeekAt', 'dueWeekFrom', 'seenCoursesAt']) assert.ok(!(k in w.store.local), k);
  assert.deepEqual(w.store.local.seenCourses, { _1_1: { name: 'kept', site: 'https://a.edu' } });
  // lib/todo.js still hands a planner's due list over the old way: the worker keeps it per site.
  const key = 'todo:https://school.instructure.com/42';
  const r = await w.send({ type: 'glaze:todo', key, cache: { key, at: now, items: [] }, due: [{ title: 'Lab', due: now + 5 }] }, page('https://school.instructure.com/'));
  assert.equal(r.ok, true);
  assert.deepEqual(w.store.local['dueWeek:https://school.instructure.com'], { at: now, list: [{ title: 'Lab', due: now + 5 }] });
  for (const k of ['dueWeek', 'dueWeekAt', 'dueWeekFrom']) assert.ok(!(k in w.store.local), k);
});

// ---- Ultra's course records (content-ultra.js record) -----------------------------------------------------------------
// content-ultra.js's GZ_SITE_ULTRA on an inert page at `origin`, made as content.js makes it, over a shared storage.local.
const ultraPart = ({ origin, local, courses }) => {
  const calls = [], sent = [];
  const El = class {
    constructor() { this.attrs = new Map(); this.dataset = {}; this.style = { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.get(k) ?? null; } hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); }
    querySelector() { return null; } querySelectorAll() { return []; } addEventListener() {} append() {}
  };
  const document = { documentElement: new El(), body: new El(), contentType: 'text/html', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    getElementsByClassName: () => [], addEventListener() {}, createTreeWalker: () => ({ nextNode: () => null }), createElement: () => new El() };
  const ctx = vm.createContext({
    document, location: { origin, pathname: '/ultra/course', href: `${origin}/ultra/course` },
    console, Promise, setTimeout, clearTimeout, queueMicrotask, Date, JSON, Map, Set, Object, Array, String, Number, RegExp, Math, Intl, structuredClone,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} }, PerformanceObserver: class { observe() {} },
    addEventListener() {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: { runtime: { id: ID, sendMessage: (m) => { sent.push(m); return Promise.resolve(); } },
      storage: { local: { get: (k, cb) => cb(structuredClone(local)), set: (o) => { Object.assign(local, structuredClone(o)); calls.push(['set', Object.keys(o)]); } }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {} } } },
    GZ_NAV: { native: () => null }, GZ_GRADES: require('../lib/grades.js'), GZ_PAGE: require('../lib/page.js'), GZ_COURSES: require('../defaults.js').GZ_COURSES,
  });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.top = ctx; ctx.self = ctx;
  vm.runInContext(read('content-ultra.js'), ctx, { filename: 'content-ultra.js' });
  const api = (p) => {
    calls.push(['api', p]);
    if (/users\/me$/.test(p)) return Promise.resolve({ id: '_9_1' });
    if (/memberships/.test(p)) return Promise.resolve({ results: courses.map(([courseId, name], i) => ({ courseId, courseCardColorIndex: i, course: { name, displayId: name.slice(0, 3) } })), paging: {} });
    return Promise.reject(404);
  };
  const I = { C: {}, html: new El(), isPreview: false, solo: true, tabFrame: '', need: () => Promise.reject(new Error('no')), t: (s) => s, locale: () => 'en', api,
    courseId: () => null, markDue() {}, drawProgress() {}, cardBadge() {}, cardsInView: { observe() {}, unobserve() {} }, inView: new Set(),
    tagCards() {}, tagExtras() {}, courseSlots: {}, courseColors: () => ({}), varText: () => '', CARD: 'article', dueLabelled: () => false,
    links: [1], settings: { enabled: true, enhance: {}, nav: { brand: 'x' }, courses: { names: {}, tint: false, tinted: [] }, sidebar: {} },
    observer: {}, setAttr() {}, setVar() {}, worn: { nav: {} }, courseList: {} };
  return { X: ctx.GZ_SITE_ULTRA(I), calls, sent };
};

test('ULT-4: two Ultra schools keep their own course records, each with its own ten-minute gate', async () => {
  const local = { seenCourses: { _5_1: { name: 'Chemistry', slot: '3', site: 'https://a.edu' }, 'canvas:https://c.edu/12': { name: 'Canvas course' }, _3_1: { name: 'From before records named their site' } } };
  const b = ultraPart({ origin: 'https://b.edu', local, courses: [['_7_1', 'History']] });
  b.X.record();
  await settle();
  assert.deepEqual(Object.keys(local.seenCourses).sort(), ['_5_1', '_7_1', 'canvas:https://c.edu/12'], 'school A\'s course stays beside B\'s');
  assert.equal(local.seenCourses._7_1.site, 'https://b.edu');
  assert.ok(local['seenCoursesAt https://b.edu'] > 0, 'B\'s own gate');
  assert.equal(local.seenCoursesAt, undefined, 'no gate shared by every Ultra site');
  const asked = b.calls.length;
  b.X.record();
  await settle();
  assert.equal(b.calls.length, asked, 'B again within ten minutes: nothing asked');
  const a = ultraPart({ origin: 'https://a.edu', local, courses: [['_5_1', 'Chemistry II']] });
  a.X.record();
  await settle();
  assert.ok(a.calls.some(([k, p]) => k === 'api' && /memberships/.test(p)), 'A right after B: its own gate, so its list is read');
  assert.deepEqual(Object.keys(local.seenCourses).sort(), ['_5_1', '_7_1', 'canvas:https://c.edu/12']);
  assert.equal(local.seenCourses._5_1.name, 'Chemistry II');
  assert.ok(![...a.sent, ...b.sent].some((m) => m?.type === 'glaze:ultra'), 'no page reports its site as Ultra');
});

// ---- the due list: content.js keeps it per site, the popup shows the right site's ---------------------------------------
const dueBlock = () => { const src = read('content.js'); const at = src.indexOf('  const DUE ='); return src.slice(at, src.indexOf('  }));\n', at) + 6); };
const dueWeekAt = (origin, stored, items) => {
  const asked = [];
  const ctx = vm.createContext({ ultra: true, moodle: false, location: { origin }, Date, Promise, Array,
    chrome: { storage: { local: { get: (k, cb) => cb(Object.fromEntries([k].flat().filter((x) => x in stored).map((x) => [x, structuredClone(stored[x])]))), set: (o) => Object.assign(stored, structuredClone(o)) } } },
    api: (p) => { asked.push(p); return Promise.resolve({ items }); }, GZ_DUE_WEEK: (j) => j.items, capi() {}, moodleIn() {} });
  vm.runInContext(`let dueSoon = null; ${dueBlock()} this.dueWeek = dueWeek;`, ctx);
  return { list: ctx.dueWeek(), asked };
};

test('ULT-4: due this week is kept per site; one site\'s list is never read as another\'s', async () => {
  const now = Date.now();
  const essay = { title: 'A essay', due: now + 1e6 }, quiz = { title: 'B quiz', due: now + 2e6 };
  const stored = { 'dueWeek:https://a.edu': { at: now, list: [essay] } };
  const b = dueWeekAt('https://b.edu', stored, [quiz]);
  assert.deepEqual(plain(await b.list), [quiz]);
  assert.equal(b.asked.length, 1, 'A\'s fresh list doesn\'t stand in for B\'s');
  assert.deepEqual(stored['dueWeek:https://a.edu'].list, [essay], 'and B\'s answer doesn\'t replace A\'s');
  assert.deepEqual(stored['dueWeek:https://b.edu'].list, [quiz]);
  const a = dueWeekAt('https://a.edu', stored, []);
  assert.deepEqual(plain(await a.list), [essay]);
  assert.equal(a.asked.length, 0, 'A\'s own list, fresh');
  assert.equal(stored.dueWeek, undefined);
});

const el = () => ({ children: [], textContent: '', title: '', className: '', append(...k) { this.children.push(...k); }, replaceChildren(...k) { this.children = k; } });
const popupDue = async (here, stored) => {
  const els = { '#due-n': el(), '#due-list': el() };
  const src = read('popup.js');
  const ctx = vm.createContext({ URL, Date, Promise, Object, Array, els, document: { createElement: el },
    chrome: { tabs: { query: async () => [{ url: here }] }, storage: { local: { getKeys: async () => Object.keys(stored), get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in stored).map((x) => [x, stored[x]]))) } } },
    GZ_UI: { load: async () => require('../defaults.js').GZ_SANITIZE({}) }, GZ_PAGE: require('../lib/page.js'), GZ_I18N: require('../lib/i18n.js') });
  vm.runInContext(`const $ = (s) => els[s]; const t = (k, v) => GZ_I18N.t(k, v, 'en'); ${src.slice(src.indexOf('// Due this week'))}`, ctx);
  await settle();
  return els;
};

test('ULT-4: the popup shows the active tab\'s site\'s due list, or every site\'s with each item\'s site', async () => {
  const now = Date.now();
  const stored = {
    'dueWeek:https://a.edu': { at: now, list: [{ title: 'A essay', due: now + 3600e3 }] },
    'dueWeek:https://bb.other.edu': { at: now, list: [{ title: 'Read chapter 4', due: now + 7200e3 }] },
    'dueWeek:https://old.edu': { at: now - 2 * 864e5, list: [{ title: 'Stale', due: now + 100 }] },
    seenCourses: { _1_1: { name: 'Not this one', site: 'https://a.edu' } },
  };
  const onA = await popupDue('https://a.edu/ultra/course', stored);
  assert.equal(onA['#due-n'].textContent, 1);
  assert.deepEqual(onA['#due-list'].children.map((li) => li.children[0].textContent), ['A essay'], 'only this tab\'s site');
  assert.ok(!onA['#due-list'].children[0].children[1].textContent.includes('a.edu'));
  const elsewhere = await popupDue('https://news.example/', stored);
  assert.equal(elsewhere['#due-n'].textContent, 2, 'a day-old list is left out');
  const items = elsewhere['#due-list'].children;
  assert.deepEqual(items.map((li) => li.children[0].textContent), ['A essay', 'Read chapter 4']);
  assert.match(items[0].children[1].textContent, / · a\.edu$/);
  assert.match(items[1].children[1].textContent, / · bb\.other\.edu$/);
  assert.match(items[1].title, /bb\.other\.edu/);
  const cid = await popupDue('https://news.example/', { 'dueWeek:https://bb.other.edu': { at: now, list: [{ title: 'Quiz', due: now + 1e6, cid: '_1_1' }] }, seenCourses: stored.seenCourses });
  assert.doesNotMatch(cid['#due-list'].children[0].title, /Not this one/, 'another site\'s course of the same id isn\'t this item\'s');
});

// ---- Settings: Backup and privacy → Sites (options.js), on a stand-in page ----------------------------------------------
test('Settings lists the sites said yes to, with their LMS and a Remove only the worker carries out; Reset everything clears them', async () => {
  const html = read('options.html');
  assert.match(html, /<section id="sites" data-editor-section="backup\/sites"[\s\S]*?<ul class="courses sites" id="site-list"><\/ul>[\s\S]*?id="site-empty"[\s\S]*?id="site-status" role="status" aria-live="polite"[\s\S]*?<\/section>/);
  assert.match(html, /<a href="#backup\/sites" data-editor-alias>Sites<\/a>/, 'in the panel\'s section links');
  const src = read('options.js');
  const reset = src.slice(src.indexOf("$('#reset-all').addEventListener"), src.indexOf('// ---- Sites:'));
  assert.match(reset, /chrome\.runtime\.sendMessage\(\{ type: 'glaze:sites', op: 'reset' \}\)/, 'Reset everything clears the list');
  const block = src.slice(src.indexOf('  // ---- Sites:'), src.indexOf('\n', src.indexOf('  const readSites')));
  const nodes = {}, sent = [];
  const mk = (tag) => Object.assign(el(), { tagName: tag.toUpperCase(), attrs: {}, on: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.on[t] = f; }, focus() { this.focused = true; } });
  for (const id of ['#site-list', '#site-empty', '#site-status', '#heading-backup-sites']) nodes[id] = mk('x');
  const lists = { canvas: ['https://canvas.school.edu/*', 'https://school.instructure.com/*', 'https://both.school.edu/*'], moodle: ['https://moodle.school.edu/*', 'https://both.school.edu/*'], ultra: ['https://bb.school.edu', 'https://school.blackboard.com', 'nonsense'] };
  const ctx = vm.createContext({ URL, Object, Array, Set, Map, document: { createElement: mk }, $: (s) => nodes[s], t: (k, v) => require('../lib/i18n.js').t(k, v, 'en'), GZ_BUILT_IN: require('../defaults.js').GZ_BUILT_IN,
    chrome: { storage: { local: { get: (k, cb) => cb(structuredClone(lists)) } }, runtime: { sendMessage: async (m) => { sent.push(plain(m)); return { ok: true }; } } } });
  vm.runInContext(`${block}; this.readSites = readSites;`, ctx);
  ctx.readSites();
  const rows = nodes['#site-list'].children;
  assert.deepEqual(rows.map((li) => [li.children[0].children[0].textContent, li.children[0].children[1].textContent]),
    [['bb.school.edu', 'Blackboard Ultra'], ['both.school.edu', 'Canvas · Moodle'], ['canvas.school.edu', 'Canvas'], ['moodle.school.edu', 'Moodle']], 'Instructure\'s and Blackboard\'s own hosts aren\'t listed');
  assert.equal(nodes['#site-empty'].hidden, true);
  const remove = rows[0].children[1];
  assert.equal(remove.attrs['aria-label'], 'Remove bb.school.edu');
  await remove.on.click({ isTrusted: false });
  assert.deepEqual(sent, [], 'a script\'s click');
  await remove.on.click({ isTrusted: true });
  assert.deepEqual(sent, [{ type: 'glaze:sites', op: 'remove', origin: 'https://bb.school.edu' }]);
  assert.equal(nodes['#site-status'].textContent, 'Removed bb.school.edu. Glaze no longer runs there.');
  assert.ok(nodes['#heading-backup-sites'].focused, 'focus goes to the section, not lost with the row');
  lists.canvas = ['https://school.instructure.com:8443/*']; lists.moodle = ['https://school.blackboard.com/*']; lists.ultra = [];
  ctx.readSites();
  assert.deepEqual(nodes['#site-list'].children.map((li) => li.children[0].children[0].textContent), ['school.blackboard.com', 'school.instructure.com:8443'], 'explicit nondefault origins and different LMS kinds remain removable');
  lists.canvas = []; lists.moodle = []; lists.ultra = [];
  ctx.readSites();
  assert.deepEqual(nodes['#site-list'].children, []);
  assert.equal(nodes['#site-empty'].hidden, false);
});

// ---- content.js: Ultra on a site the student hasn't approved stays out ---------------------------------------------------
class Node {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.kids = []; this.dataset = {}; this.childNodes = []; this.children = []; this.removed = false;
    const props = new Map();
    this.style = { setProperty: (k, v) => props.set(k, v), removeProperty: (k) => props.delete(k), getPropertyValue: (k) => props.get(k) || '', length: 0 };
    this.classList = { contains: () => false, add() {}, remove() {}, toggle() {} };
  }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; } hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); } toggleAttribute(k, on) { if (on) this.attrs.set(k, ''); else this.attrs.delete(k); } getAttributeNames() { return [...this.attrs.keys()]; }
  addEventListener() {} removeEventListener() {} querySelector() { return null; } querySelectorAll() { return []; } closest() { return null; } matches() { return false; } contains() { return false; }
  append(...n) { this.kids.push(...n); } appendChild(n) { this.kids.push(n); return n; } before() {} after() {} remove() { this.removed = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; } getClientRects() { return []; }
}
const ultraPage = ({ origin = 'https://evil.test', local = {}, frame = false, kind = 'ultra' } = {}) => {
  const sent = [], swept = [], fetched = [], writes = [], storeListeners = [];
  const html = new Node('html'); html.lang = 'en';
  const selector = kind === 'ultra' ? 'base[href*="/ultra/"]' : kind === 'moodle' ? 'meta[name="keywords"][content^="moodle,"]' : 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]';
  const head = new Node('head'); head.querySelector = (sel) => (sel.includes(selector) ? { matches: (s) => s === selector } : null);
  const body = new Node('body');
  const document = { contentType: 'text/html', documentElement: html, head, body, readyState: 'interactive', hidden: false,
    querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByTagName: () => [],
    createElement: (t) => new Node(t), createElementNS: (_, t) => new Node(t), createTextNode: () => new Node('#text'),
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({}) }),
    addEventListener() {}, removeEventListener() {}, fonts: { load: () => Promise.resolve([]), add() {} } };
  const u = new URL(`${origin}/ultra/course`);
  const c = vm.createContext({ document, console, Intl, URL, URLSearchParams, TextEncoder, structuredClone, crypto: require('node:crypto').webcrypto,
    location: { protocol: u.protocol, origin: u.origin, hostname: u.hostname, host: u.host, pathname: u.pathname, href: u.href, search: '', hash: '' },
    navigator: { language: 'en' }, Element: Node, HTMLElement: Node, SVGElement: class {}, Node, NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: () => ({ getPropertyValue: () => '', color: '', backgroundColor: '' }), CSS: { supports: () => false },
    matchMedia: () => ({ matches: false, addEventListener() {} }), Image: class {},
    MutationObserver: class { observe(t) { if (t === body) swept.push(t); } disconnect() {} takeRecords() { return []; } },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {}, postMessage() {}, open() {},
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => 0 }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, innerHeight: 900, innerWidth: 1400,
    fetch: (url) => { fetched.push(String(url)); return Promise.resolve({ ok: true, url: origin, json: () => Promise.resolve({}), text: () => Promise.resolve(''), headers: { get: () => null } }); },
    chrome: {
      runtime: { id: ID, getURL: (p) => `chrome-extension://${ID}/${p}`, lastError: undefined, sendMessage: (m) => { sent.push(m); return Promise.resolve({ ok: false }); } },
      storage: {
        sync: { get: (k, cb) => cb({}) },
        local: { get: (k, cb) => (cb ? cb(structuredClone(local)) : Promise.resolve(structuredClone(local))), set: (o, cb) => { writes.push(o); cb?.(); return Promise.resolve(); }, remove: (k, cb) => { cb?.(); return Promise.resolve(); } },
        onChanged: { addListener: (f) => storeListeners.push(f), removeListener: (f) => storeListeners.splice(storeListeners.indexOf(f), 1) },
      },
    },
  });
  c.window = c; c.top = frame ? {} : c; c.globalThis = c;
  for (const f of ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/nav.js', 'content-ultra.js']) vm.runInContext(read(f), c, { filename: f });
  // content-ultra.js's early sheets, as it puts them in before <body> (here, after: the test puts them in by hand).
  const early = ['theme.css', 'motion.css', 'extras.css', 'features/apps.css'].map((f) => Object.assign(new Node('link'), { href: `chrome-extension://${ID}/${f}` }));
  c.GZ_SITE_ULTRA.sheets = [...early];
  vm.runInContext(read('content.js'), c, { filename: 'content.js' });
  const sheets = () => head.kids.map((l) => String(l.href || '').split('/').pop()).filter((f) => f.endsWith('.css'));
  const approve = (list) => { for (const f of [...storeListeners]) f({ ultra: { newValue: list } }, 'local'); };
  return { c, sent, swept, fetched, writes, sheets, early, approve };
};

test('CORE-2: Ultra on a site the student hasn\'t approved stays out (no theme, sweep, API, records, report) and asks once, from its top frame', async () => {
  const p = ultraPage();
  await settle();
  assert.ok(p.early.every((l) => l.removed), 'its early sheets go');
  assert.deepEqual(p.sheets(), [], 'no theme');
  assert.deepEqual(p.swept, [], 'no sweep');
  assert.deepEqual(p.fetched, [], 'no request to the site');
  assert.deepEqual(p.writes, [], 'nothing recorded');
  assert.deepEqual(p.sent, ['ultra'], 'one ask for the question, and nothing else');
  assert.equal(p.c.GZ_CTX, undefined, 'no Glaze context for features to use');
  // Another site's yes changes nothing here; this site's starts Glaze.
  p.approve(['https://other.test']);
  await settle();
  assert.deepEqual(p.sheets(), []);
  p.approve(['https://other.test', 'https://evil.test']);
  await settle();
  assert.ok(p.sheets().includes('theme.css'), 'approved: the theme');
  assert.equal(p.swept.length, 1, 'and the sweep');
  const frame = ultraPage({ frame: true });
  await settle();
  assert.deepEqual(frame.sent, [], 'a frame waits without asking');
});

test('CORE-2: Ultra on Blackboard\'s own host, or on a site approved before, starts at once without asking', async () => {
  for (const p of [ultraPage({ origin: 'https://school.blackboard.com' }), ultraPage({ origin: 'https://bb.school.edu', local: { ultra: ['https://bb.school.edu'] } })]) {
    await settle();
    assert.ok(p.sheets().includes('theme.css'));
    assert.equal(p.swept.length, 1);
    assert.ok(!p.sent.includes('ultra'));
  }
});

test('review: unknown /ultra pages claiming Canvas or Moodle also remain passive', async () => {
  for (const kind of ['canvas', 'moodle']) {
    const p = ultraPage({ kind });
    await settle();
    assert.deepEqual(p.sheets(), [], kind);
    assert.deepEqual(p.swept, [], kind);
    assert.deepEqual(p.fetched, [], kind);
    assert.deepEqual(p.writes, [], kind);
    assert.equal(p.c.GZ_CTX, undefined, kind);
  }
});

test('review: unknown Ultra has no early render-blocking theme before storage answers', () => {
  const src = read('content-ultra.js');
  const inserted = [];
  const context = vm.createContext({ document: { contentType: 'text/html', body: null, head: { appendChild: (l) => inserted.push(l) }, createElement: () => ({ setAttribute() {} }) },
    location: new URL('https://evil.test/ultra/'), GZ_SITE_ULTRA: {}, GZ_BUILT_IN: require('../defaults.js').GZ_BUILT_IN, chrome: { runtime: { getURL: (s) => s } }, setTimeout() {} });
  vm.runInContext(src.slice(src.indexOf('// Known Ultra entry:')), context);
  assert.deepEqual(inserted, []);
});

// ---- the question (features/consent.js) ----------------------------------------------------------------------------
class Dom {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.attrs = {}; this.on = {}; this.text = ''; this.props = {}; this.style = { setProperty: (k, v) => { this.props[k] = v; } }; }
  get textContent() { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.text = String(v); this.children = []; }
  append(...n) { for (const c of n) { if (c === false || c == null) continue; c.remove(); c.parent = this; this.children.push(c); } }
  prepend(c) { c.remove(); c.parent = this; this.children.unshift(c); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
  fire(type, init = {}) { for (const f of this.on[type] || []) f({ type, isTrusted: true, currentTarget: this, target: this, stopPropagation() {}, preventDefault() {}, ...init }); }
  attachShadow({ mode }) { this.shadow = new Dom('#shadow'); this.shadow.mode = mode; return this.shadow; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 80, bottom: 30 }; }
  all() { return [this, ...(this.shadow ? this.shadow.all() : []), ...this.children.flatMap((c) => c.all())]; }
}
const consentPage = ({ lang = 'en', frame = false, io = false, reply = { ok: true } } = {}) => {
  const sent = [], heard = [], observed = [];
  let clock = 0, watcher = null;
  const doc = { documentElement: Object.assign(new Dom('html'), { lang }), body: new Dom('body'), createElement: (t) => new Dom(t) };
  const ctx = vm.createContext({
    document: doc, location: { hostname: 'shop.test', origin: 'https://shop.test', protocol: 'https:' }, navigator: { language: 'en', userActivation: { isActive: true } },
    Intl, Object, Date, setTimeout, performance: { now: () => clock }, matchMedia: () => ({ matches: true }),
    CSSStyleSheet: class { replaceSync(css) { this.css = css; } },
    ...(io && { IntersectionObserver: class { constructor(f, o) { this.f = f; this.trackVisibility = o.trackVisibility; watcher = this; } observe(e) { observed.push(e); } unobserve() {} disconnect() {} } }),
    GZ_I18N: require('../lib/i18n.js'),
    chrome: { runtime: { sendMessage: async (m) => { sent.push(plain(m)); return reply; } }, storage: { onChanged: { addListener: (f) => heard.push(f), removeListener: (f) => heard.splice(heard.indexOf(f), 1) } } },
  });
  ctx.window = ctx; ctx.top = frame ? {} : ctx; ctx.globalThis = ctx;
  const C = vm.runInContext(read('features/consent.js'), ctx, { filename: 'features/consent.js' });
  const host = () => doc.body.children.find((n) => n.tagName === 'GLAZE-CONSENT');
  const button = (label) => host()?.all().find((n) => n.tagName === 'BUTTON' && n.textContent === label);
  const tell = (c, area = 'local') => { for (const f of [...heard]) f(c, area); };
  const see = (visible) => watcher.f(observed.map((target) => ({ target, isVisible: visible, isIntersecting: visible, intersectionRatio: visible ? 1 : 0, boundingClientRect: target.getBoundingClientRect() })));
  return { C, doc, sent, host, button, tell, see, tick: (ms) => { clock += ms; } };
};

test('the question names the site and what it looks like, in the page\'s language, as a landmark in a live region the page can\'t reach', async () => {
  const p = consentPage();
  assert.equal(typeof p.C.show, 'function', 'the file ends on its module');
  p.C.show('canvas',{ dark: { '--gz-accent': '#ff8800', '--gz-ink': 'red; background: url(//x)' }, light: {} });
  await wait(80);
  const h = p.host();
  assert.equal(p.doc.body.children[0], h, 'first in the page, so first in its tab order');
  assert.equal(h.shadow.mode, 'closed');
  const text = h.shadow.textContent;
  assert.match(text, /Use Glaze on shop\.test\?/);
  assert.match(text, /This looks like Canvas\. Glaze changes nothing here until you say yes\./);
  assert.ok(p.button('Yes') && p.button('Not now'));
  const bar = h.all().find((n) => n.tagName === 'SECTION');
  assert.equal(bar.getAttribute('role'), 'region');
  assert.match(h.all().find((n) => n.id && n.id === bar.getAttribute('aria-labelledby'))?.textContent || '', /^Use Glaze on shop\.test\?$/, 'named by its question');
  assert.equal(bar.parent.getAttribute('aria-live'), 'polite', 'heard as it comes, without taking focus');
  assert.equal(bar.props['--gz-accent'], '#ff8800', 'the student\'s palette');
  assert.equal(bar.props['--gz-ink'], undefined, 'colours only');
  const de = consentPage({ lang: 'de' });
  assert.equal(de.C.words(), 'i18n/de.js', 'the catalogue the worker puts in first');
  de.C.show('moodle', {});
  await wait(80);
  assert.match(de.host().shadow.textContent, /Glaze auf shop\.test verwenden\?.*Das sieht nach Moodle aus/);
  assert.ok(de.button('Ja') && de.button('Nicht jetzt'));
  const framed = consentPage({ frame: true });
  framed.C.show('canvas', {});
  await wait(80);
  assert.equal(framed.host(), undefined, 'never in a frame');
});

test('only the student\'s own click answers: Yes approves, Not now puts it off, Escape just closes it', async () => {
  const p = consentPage();
  p.C.show('ultra', {});
  await wait(80);
  p.button('Yes').fire('click', { isTrusted: false });
  await settle();
  assert.deepEqual(p.sent, [], 'a script\'s click');
  assert.match(p.host().shadow.textContent, /Click this button directly to continue\./);
  p.button('Yes').fire('click');
  await settle();
  assert.deepEqual(p.sent, [{ type: 'glaze:consent', op: 'yes', kind: 'ultra' }]);
  assert.equal(p.host(), undefined, 'answered: gone');
  const q = consentPage();
  q.C.show('canvas', {});
  await wait(80);
  q.button('Not now').fire('click', { isTrusted: false });
  q.button('Not now').fire('click');
  await settle();
  assert.deepEqual(q.sent, [{ type: 'glaze:consent', op: 'later', kind: 'canvas' }]);
  assert.equal(q.host(), undefined);
  const r = consentPage();
  r.C.show('canvas', {});
  await wait(80);
  r.host().all().find((n) => n.tagName === 'SECTION').fire('keydown', { key: 'Escape' });
  assert.equal(r.host(), undefined);
  assert.deepEqual(r.sent, []);
  const failed = consentPage({ reply: { ok: false } });
  failed.C.show('canvas', {});
  await wait(80);
  failed.button('Yes').fire('click');
  await settle();
  assert.ok(failed.host(), 'kept to try again');
  assert.match(failed.host().shadow.textContent, /Not saved\. Try again in a moment\./);
});

test('where the browser can tell, Yes counts only after half a second in full view', async () => {
  const p = consentPage({ io: true });
  p.C.show('canvas', {});
  await wait(80);
  p.button('Yes').fire('click');
  await settle();
  assert.deepEqual(p.sent, [], 'not yet seen');
  p.see(true);
  p.tick(200);
  p.button('Yes').fire('click');
  await settle();
  assert.deepEqual(p.sent, [], 'seen too briefly');
  assert.match(p.host().shadow.textContent, /Wait a moment with this button fully visible, then click again\./);
  p.tick(400);
  p.button('Yes').fire('click');
  await settle();
  assert.deepEqual(p.sent, [{ type: 'glaze:consent', op: 'yes', kind: 'canvas' }]);
});

test('answered elsewhere, or Glaze switched off: the question goes; a yes in another tab puts Glaze in this page too', async () => {
  const p = consentPage();
  p.C.show('canvas', {});
  await wait(80);
  p.tell({ canvas: { newValue: ['https://other.test/*'] } });
  assert.ok(p.host(), 'another site\'s yes');
  p.tell({ canvas: { newValue: ['https://shop.test/*'] } });
  assert.equal(p.host(), undefined);
  await settle();
  assert.deepEqual(p.sent, [{ type: 'glaze:consent', op: 'join', kind: 'canvas' }]);
  const q = consentPage();
  q.C.show('moodle', {});
  await wait(80);
  q.tell({ askLater: { newValue: { 'https://shop.test': Date.now() + 1e6 } } });
  assert.equal(q.host(), undefined, 'Not now in another tab');
  const r = consentPage();
  r.C.show('ultra', {});
  await wait(80);
  r.tell({ enabled: { newValue: false } }, 'sync');
  assert.equal(r.host(), undefined, 'Glaze off');
  await settle();
  assert.deepEqual([...q.sent, ...r.sent], []);
});

test('review: switching off dismisses consent even while Yes is awaiting its reply', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const p = consentPage({ reply: pending });
  p.C.show('canvas', {});
  await wait(80);
  p.button('Yes').fire('click');
  await settle();
  p.tell({ enabled: { newValue: false } }, 'sync');
  assert.equal(p.host(), undefined);
  finish({ ok: false });
  await settle();
});
