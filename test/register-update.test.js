// A school's own site stays registered while Glaze is installed or updated: the real lib/background.js in a VM, its
// registrations kept by a stand-in chrome.scripting that refuses what Chrome refuses and records the registered set after
// every call. A page can load between any two calls, so every approved site's registration is there at every step: changed
// ones are updated in place, missing ones added, obsolete ones removed. A browser without updateContentScripts replaces a
// changed one on its own, one at a time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = require('../manifest.json');
const plain = (x) => JSON.parse(JSON.stringify(x));
const settle = async (n = 80) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const CANVAS_FIRST = manifest.content_scripts.find((c) => c.js.includes('content-canvas.js')).js;
const C = 'https://canvas.school.edu', M = 'https://moodle.school.edu', B = 'https://bb.school.edu';
const SITES = [`${C}/*`, `${M}/*`, `ultra:${B}`];

const covers = (p, o) => {
  if (p === '<all_urls>') return true;
  const [, ps, ph] = /^(\*|https?):\/\/([^/]+)\//.exec(p) || [], [, os, oh] = /^(https?):\/\/([^/]+)\//.exec(o) || [];
  if (!ps || !os || (ps !== '*' && ps !== os)) return false;
  return ph === '*' || ph === oh || (ph.startsWith('*.') && (oh === ph.slice(2) || oh.endsWith(ph.slice(1))));
};

// `registered`: what the browser kept from the version before; `update: false`, a browser without updateContentScripts.
const worker = ({ registered = [], update = true, ignoreUpdate = [], local = {}, sync = {}, held = [`${C}/*`, `${M}/*`, `${B}/*`] } = {}) => {
  const store = { local: structuredClone(local), sync: structuredClone(sync), session: {} };
  const installed = [], startup = [], changed = [], added = [], removed = [];
  const listen = (list) => ({ addListener: (f) => list.push(f) });
  const w = { calls: [], steps: [], warnings: [], store, reg: new Map(plain(registered).map((s) => [s.id, s])) };
  const heldSet = new Set([...(manifest.host_permissions || []), ...held]);
  const pick = (s, k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])));
  const area = (name) => ({
    get: async (k) => pick(store[name], k),
    getKeys: async () => Object.keys(store[name]),
    set: async (v) => { Object.assign(store[name], structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete store[name][x]; },
  });
  const step = (name, ids) => { ids = plain(ids); w.calls.push([name, ids]); w.steps.push({ name, ids, have: new Map([...w.reg].map(([id, s]) => [id, structuredClone(s)])) }); };
  const scripting = {
    getRegisteredContentScripts: async () => { const list = [...w.reg.values()].map(plain); await w.read?.(); return list; },
    registerContentScripts: async (list) => {
      await w.write?.('register');
      for (const s of list) if (w.reg.has(s.id)) throw Error(`Duplicate script ID '${s.id}'`);
      for (const s of list) w.reg.set(s.id, plain(s));
      step('register', list.map((s) => s.id));
    },
    unregisterContentScripts: async (o) => {
      await w.write?.('unregister');
      for (const id of o?.ids || []) if (!w.reg.has(id)) throw Error(`Nonexistent script ID '${id}'`);
      const ids = o?.ids || [...w.reg.keys()];
      for (const id of ids) w.reg.delete(id);
      step('unregister', o?.ids ? ids : '*');
    },
    executeScript: async () => [{ result: false }],
  };
  if (update) scripting.updateContentScripts = async (list) => {
    await w.write?.('update');
    for (const s of list) if (!w.reg.has(s.id)) throw Error(`Nonexistent script ID '${s.id}'`);
    for (const s of list) w.reg.set(s.id, { ...w.reg.get(s.id), ...Object.fromEntries(Object.entries(plain(s)).filter(([k]) => !ignoreUpdate.includes(k))) });
    step('update', list.map((s) => s.id));
  };
  const context = vm.createContext({
    URL, console: { ...console, warn: (...args) => w.warnings.push(args.map(String).join(' ')) }, setTimeout, clearTimeout, TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, atob, btoa, navigator: {}, AbortSignal,
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), context, { filename: f }); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (p = '') => `chrome-extension://glaze/${p}`, getManifest: () => manifest,
        onMessage: { addListener() {} }, onInstalled: listen(installed), onStartup: listen(startup), onConnect: { addListener() {} },
        openOptionsPage: async () => {},
      },
      permissions: {
        contains: async ({ origins }) => origins.every((o) => [...heldSet].some((p) => covers(p, o))),
        onAdded: listen(added), onRemoved: listen(removed),
      },
      tabs: { query: async () => [], get: async () => { throw Error('No tab'); }, create: async (o) => o, onRemoved: { addListener() {} } },
      storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: listen(changed) },
      scripting,
      action: { setIcon: async () => {} },
    },
  });
  vm.runInContext(read('lib/background.js'), context, { filename: 'lib/background.js' });
  w.install = async (reason) => { for (const f of installed) f({ reason }); await settle(); };
  w.start = () => { for (const f of startup) f(); };
  w.change = (name, patch) => {
    const changes = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { oldValue: store[name][k], newValue: v }]));
    Object.assign(store[name], structuredClone(patch));
    for (const f of changed) f(changes, name);
  };
  w.permission = (origin, grant) => {
    if (grant) heldSet.add(origin); else heldSet.delete(origin);
    for (const f of grant ? added : removed) f({ origins: [origin] });
  };
  w.pass = () => vm.runInContext('serial(ensure)', context);
  w.ids = () => [...w.reg.keys()].sort();
  w.registered = () => [...w.reg.values()].map(plain);
  return w;
};

// Every step of the install or update: each id in `kept` is registered, and none has more than one missing at a time.
const neverGone = (w, kept, { oneAtATime = false } = {}) => {
  for (const [i, s] of w.steps.entries()) {
    const missing = kept.filter((id) => !s.have.has(id));
    if (oneAtATime) assert.ok(missing.length <= 1, `step ${i} (${s.name} ${s.ids}): ${missing} missing at once`);
    else assert.deepEqual(missing, [], `step ${i} (${s.name} ${s.ids}): a page loading now gets no Glaze`);
  }
};
const local = { canvas: [`${C}/*`], moodle: [`${M}/*`], ultra: [B] };
const sync = { enhance: { notes: true } };
// What the version before registered for these lists: the same worker, run once on an empty browser.
const before = async (o = {}) => {
  const w = worker({ local, sync, ...o });
  await w.install('update');
  return w.registered();
};

test('first install: the approved sites register, and nothing is taken away first', async () => {
  const w = worker({ local, sync });
  await w.install('install');
  assert.deepEqual(w.ids(), [...SITES, 'gz-notes-home'].sort());
  assert.ok(!w.calls.some(([name]) => name === 'unregister'), JSON.stringify(w.calls));
  assert.deepEqual(w.reg.get(`${C}/*`).js, CANVAS_FIRST);
});

test('update with the same sites: every registration stays through it, and nothing changes', async () => {
  const was = await before();
  assert.deepEqual(was.map((s) => s.id).sort(), [...SITES, 'gz-notes-home'].sort());
  const w = worker({ registered: was, local, sync });
  await w.install('update');
  neverGone(w, was.map((s) => s.id));
  assert.deepEqual(w.calls, [], 'what is registered already is left alone');
  assert.deepEqual(w.registered(), was);
});

test('update after a site was taken off in Settings: the others stay through it, and its registration goes', async () => {
  const was = await before();
  const w = worker({ registered: was, local: { ...local, moodle: [] }, sync });
  await w.install('update');
  neverGone(w, [`${C}/*`, `ultra:${B}`, 'gz-notes-home']);
  assert.deepEqual(w.ids(), [`${C}/*`, `ultra:${B}`, 'gz-notes-home'].sort());
  assert.deepEqual(w.calls, [['unregister', [`${M}/*`]]]);
});

test('update where a registration changed (an older file list, older matches): it is updated in place, never missing', async () => {
  const was = await before();
  const old = was.map((s) => (s.id === `${C}/*` ? { ...s, js: s.js.filter((f) => f !== 'content-canvas.js') }
    : s.id === `ultra:${B}` ? { ...s, matches: [`${B}/ultra/*`] } : s));
  old.push({ id: 'gz-retired', matches: [`${C}/*`], js: ['features/retired.js'], runAt: 'document_idle', persistAcrossSessions: true });
  const w = worker({ registered: old, local, sync });
  await w.install('update');
  neverGone(w, was.map((s) => s.id));
  assert.deepEqual(w.registered().sort((a, b) => a.id.localeCompare(b.id)), [...was].sort((a, b) => a.id.localeCompare(b.id)), 'each is the new version\'s');
  assert.deepEqual(w.calls.find(([name]) => name === 'update')?.[1].sort(), [`${C}/*`, `ultra:${B}`].sort());
  assert.deepEqual(w.calls.find(([name]) => name === 'unregister')?.[1], ['gz-retired'], 'a script the new version no longer has goes');
  assert.ok(!w.calls.some(([name]) => name === 'register'), JSON.stringify(w.calls));
});

test('a browser without updateContentScripts (older Firefox, Safari): a changed registration is replaced on its own, the rest stay', async () => {
  const was = await before({ update: false });
  const old = was.map((s) => (s.id === `${C}/*` ? { ...s, js: s.js.filter((f) => f !== 'content-canvas.js') }
    : s.id === `ultra:${B}` ? { ...s, matches: [`${B}/ultra/*`] } : s));
  const w = worker({ registered: old, local, sync, update: false });
  await w.install('update');
  neverGone(w, was.map((s) => s.id), { oneAtATime: true });
  for (const id of [`${M}/*`, 'gz-notes-home']) assert.ok(w.steps.every((s) => s.have.has(id)), `${id}, unchanged, never goes`);
  assert.deepEqual(w.registered().sort((a, b) => a.id.localeCompare(b.id)), [...was].sort((a, b) => a.id.localeCompare(b.id)));
  // Same again: nothing is replaced when nothing changed, as Firefox hands registrations back without Chrome's defaults.
  const bare = worker({ registered: was.map(({ id, matches, js, excludeMatches }) => ({ id, matches, js, ...excludeMatches && { excludeMatches }, runAt: was.find((s) => s.id === id).runAt, ...was.find((s) => s.id === id).allFrames && { allFrames: true } })), local, sync, update: false });
  await bare.install('update');
  assert.deepEqual(bare.calls, []);
});

test('a site added: it registers, the others stay through it, and Notes\' hook takes it in place', async () => {
  const was = await before();
  const w = worker({ registered: was, local: { ...local, canvas: [`${C}/*`, 'https://canvas.other.edu/*'] }, sync, held: [`${C}/*`, `${M}/*`, `${B}/*`, 'https://canvas.other.edu/*'] });
  await w.install('update');
  neverGone(w, was.map((s) => s.id));
  assert.ok(w.reg.get('gz-notes-home').matches.includes('https://canvas.other.edu/courses/*'));
  assert.ok(w.ids().includes('https://canvas.other.edu/*'));
});


for (const [id, key, value, expected] of [
  [`${C}/*`, 'matchOriginAsFallback', true, false],
  ['gz-notes-home', 'allFrames', true, false],
  [`${C}/*`, 'world', 'MAIN', 'ISOLATED'],
  [`${C}/*`, 'css', ['canvas.css'], []],
  [`${C}/*`, 'excludeMatches', [`${C}/excluded/*`], []],
  [`${C}/*`, 'runAt', 'document_end', 'document_start'],
  [`${C}/*`, 'allFrames', false, true],
  [`${C}/*`, 'persistAcrossSessions', false, true],
]) test(`update restores ${id} ${key} to its declared value or default`, async () => {
  const was = await before();
  const w = worker({ registered: was.map((s) => s.id === id ? { ...s, [key]: value } : s), local, sync });
  await w.install('update');
  neverGone(w, was.map((s) => s.id));
  assert.deepEqual(w.reg.get(id)[key] ?? { allFrames: false, matchOriginAsFallback: false, world: 'ISOLATED', css: [], excludeMatches: [] }[key], expected);
  assert.deepEqual(w.warnings, []);
  w.calls.length = 0;
  await w.pass();
  assert.deepEqual(w.calls, [], 'a second pass has no stale fields left to update');
});

test('browser defaults and full extension file URLs leave equivalent registrations alone', async () => {
  const was = (await before()).map((s) => ({ allFrames: false, matchOriginAsFallback: false, world: 'ISOLATED', css: [], excludeMatches: [], ...s,
    js: s.js.map((f) => `chrome-extension://glaze/${f}`) }));
  const w = worker({ registered: was, local, sync });
  await w.install('update');
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.warnings, []);
});

test('install, Settings and permission events share one registration queue and converge on the latest sites', async () => {
  const w = worker({ local, sync });
  let release, entered, reads = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  w.read = async () => { reads++; entered(); await gate; };
  const installing = w.install('update');
  await started;
  const other = 'https://canvas.other.edu/*';
  w.change('local', { canvas: [...local.canvas, other] });
  w.permission(other, true);
  w.permission(`${M}/*`, false);
  w.change('sync', { enhance: { notes: false } });
  w.start();
  await settle();
  assert.equal(reads, 1, 'no second run may read registrations while the first is pending');
  release();
  await installing;
  await settle();
  assert.deepEqual(w.ids(), [`${C}/*`, other, `ultra:${B}`].sort());
  assert.deepEqual(w.warnings, [], 'no duplicate registrations or failed queue turns');
  w.calls.length = 0;
  await w.pass();
  assert.deepEqual(w.calls, []);
});

for (const failed of ['update', 'register', 'unregister']) test(`a failed ${failed} preserves existing sites and the next event recovers`, async () => {
  const was = await before();
  const other = 'https://canvas.other.edu/*';
  const old = was.map((s) => s.id === `${C}/*` ? { ...s, runAt: 'document_end' } : s);
  old.push({ id: 'gz-retired', matches: [`${C}/*`], js: ['lib/detect.js'] });
  const w = worker({ registered: old, local: { ...local, canvas: [...local.canvas, other] }, sync, held: [...SITES.slice(0, 2), `${B}/*`, other] });
  w.write = async (op) => { if (op === failed) throw Error(`injected ${failed} failure`); };
  await w.install('update');
  neverGone(w, was.map((s) => s.id));
  assert.deepEqual(w.warnings, [`Error: injected ${failed} failure`]);
  w.write = null;
  w.start();
  await settle();
  assert.deepEqual(w.ids(), [...was.map((s) => s.id), other].sort());
  assert.equal(w.reg.get(`${C}/*`).runAt, 'document_start');
  assert.ok(w.reg.get('gz-notes-home').matches.includes('https://canvas.other.edu/courses/*'));
});

test('a failed fallback replacement removes at most one site and startup restores it', async () => {
  const was = await before();
  const old = was.map((s) => s.id === `${C}/*` ? { ...s, runAt: 'document_end' } : s);
  const w = worker({ registered: old, local, sync, update: false });
  w.write = async (op) => { if (op === 'register') throw Error('injected register failure'); };
  await w.install('update');
  neverGone(w, was.map((s) => s.id), { oneAtATime: true });
  assert.deepEqual(w.ids(), was.map((s) => s.id).filter((id) => id !== `${C}/*`).sort());
  assert.deepEqual(w.warnings, ['Error: injected register failure']);
  w.write = null;
  w.start();
  await settle();
  assert.deepEqual(w.ids(), was.map((s) => s.id).sort());
  assert.equal(w.reg.get(`${C}/*`).runAt, 'document_start');
});

test('startup restores registrations that a browser did not keep across restart', async () => {
  const was = await before();
  const w = worker({ registered: [], local, sync });
  w.start();
  await settle();
  assert.deepEqual(w.registered(), was);
  assert.deepEqual(w.warnings, []);
});


test('a browser that retains an updated field replaces only that registration and then converges', async () => {
  const was = await before();
  const old = was.map((s) => s.id === `${C}/*` ? { ...s, world: 'MAIN' } : s.id === `ultra:${B}` ? { ...s, runAt: 'document_end' } : s);
  const w = worker({ registered: old, local, sync, ignoreUpdate: ['world'] });
  await w.install('update');
  assert.equal(w.reg.get(`${C}/*`).world || 'ISOLATED', 'ISOLATED');
  neverGone(w, was.map((s) => s.id), { oneAtATime: true });
  neverGone(w, was.map((s) => s.id).filter((id) => id !== `${C}/*`));
  assert.equal(w.reg.get(`ultra:${B}`).runAt, 'document_start');
  assert.deepEqual(w.calls, [['update', [`${C}/*`, `ultra:${B}`]], ['unregister', [`${C}/*`]], ['register', [`${C}/*`]]]);
  assert.deepEqual(w.warnings, []);
  w.calls.length = 0;
  await w.pass();
  assert.deepEqual(w.calls, []);
});
