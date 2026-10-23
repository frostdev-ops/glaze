// Adding a school's own site on a browser that asks for each one (Chrome, Edge, Firefox): the worker's side. The real
// lib/background.js in a VM with chrome.permissions, scripting, tabs, declarativeContent and action stubbed, and the
// schools' answers (lib/site.js probe) from a pretend network. Grants come from Glaze's first screen (glaze:allow 'ask', then
// 'yes' once its own check found the LMS), the popup ('ask' with the kind its tab showed), Chrome's own menus (onAdded with
// nothing asked) and All sites (the detector, then the in-page card). The first run opens once; the toolbar icon lights on
// pages that look like an LMS, and is Glaze's own on pages Glaze runs in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = require('../manifest.json');
const plain = (x) => JSON.parse(JSON.stringify(x));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ID = 'glaze';
const CANVAS_FIRST = manifest.content_scripts.find((c) => c.js.includes('content-canvas.js')).js;
const MOODLE_FIRST = CANVAS_FIRST.filter((f) => f !== 'content-canvas.js');
const ULTRA_FIRST = manifest.content_scripts.find((c) => c.js.includes('content-ultra.js')).js;
const BUILT_IN = ['https://*.blackboard.com/*', 'https://*.instructure.com/*', 'https://*.moodlecloud.com/*'];
const SAFARI = (() => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'glaze-allow-safari-'));
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    require('node:child_process').execFileSync('sh', [path.join(root, 'scripts/safari-manifest.sh'), path.join(dir, 'manifest.json')]);
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

// What each LMS answers (lib/site.js, test/site.test.js): anything else is a 404 page.
const BB = { status: 200, body: '{"learn":{"major":4001,"minor":2,"patch":0}}' };
const CANVAS = { status: 401, body: '{"status":"unauthenticated","errors":[{"message":"user authorization required"}]}' };
const MOODLE = { status: 200, body: '{"exception":"core\\\\exception\\\\moodle_exception","errorcode":"invalidtoken"}' };

// A match pattern's reach, as Chrome reads one: `*` any scheme of http(s) or the one named, `*.` a host and its subdomains.
const covers = (p, o) => {
  if (p === '<all_urls>') return true;
  const [, ps, ph] = /^(\*|https?):\/\/([^/]+)\//.exec(p) || [], [, os, oh] = /^(https?):\/\/([^/]+)\//.exec(o) || [];
  if (!ps || !os || (ps !== '*' && ps !== os)) return false;
  return ph === '*' || ph === oh || (ph.startsWith('*.') && (oh === ph.slice(2) || oh.endsWith(ph.slice(1))));
};

// `held`: the optional hosts granted at the start; `net`: url (or prefix*) → answer; `tabs`: the open tabs.
const worker = ({ m = manifest, held = [], local = {}, sync = {}, net = {}, tabs = [], dc = true } = {}) => {
  const store = { local: structuredClone(local), sync: structuredClone(sync), session: {} };
  const listeners = [], changed = [], installed = [], added = [], removed = [];
  const w = { store, ran: [], opened: [], installed, registered: [], fetched: [], removedGrants: [], icons: [], rules: null, removedRules: 0, tabs, now: Date.now() };
  w.held = new Set([...(m.host_permissions || []), ...held]);
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
  const fetch = async (url) => {
    w.fetched.push(String(url));
    const hit = Object.entries(net).find(([k]) => url === k || (k.endsWith('*') && url.startsWith(k.slice(0, -1))))?.[1];
    if (hit === 'down') throw new TypeError('Failed to fetch');
    const r = hit || { status: 404, body: '<!doctype html><title>Not found</title>' };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, type: 'basic', headers: { get: () => 'application/json' }, text: async () => r.body, blob: async () => ({ url }) };
  };
  // The icon's pixels: what Glaze draws over them is recorded, not rendered.
  class OffscreenCanvas {
    constructor(width, height) { Object.assign(this, { width, height, drawn: [] }); }
    getContext() {
      const c = this, g = { drawn: c.drawn, fillStyle: '', strokeStyle: '', lineWidth: 1 };
      for (const f of ['drawImage', 'beginPath', 'arc', 'fill', 'stroke', 'clearRect', 'save', 'restore', 'closePath']) g[f] = (...a) => c.drawn.push([f, ...a.map((x) => (typeof x === 'object' ? 'image' : x))]);
      g.getImageData = (x, y, width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4), drawn: [...c.drawn] });
      return g;
    }
  }
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, atob, btoa, navigator: {}, AbortSignal, fetch,
    ...(dc && { OffscreenCanvas, createImageBitmap: async (b) => ({ from: b.url }) }),
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), context, { filename: f }); },
    chrome: {
      runtime: {
        id: ID, getURL: (p = '') => `chrome-extension://${ID}/${p}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener: (f) => installed.push(f) }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
        openOptionsPage: async () => { w.opened.push('options'); },
      },
      permissions: {
        contains: async ({ origins }) => origins.every((o) => [...w.held].some((p) => covers(p, o))),
        remove: async ({ origins }) => { w.removedGrants.push(...origins); return true; },
        onAdded: { addListener: (f) => added.push(f) },
        onRemoved: { addListener: (f) => removed.push(f) },
      },
      tabs: {
        query: async ({ url } = {}) => plain(tabs.filter((t) => !url || [].concat(url).some((p) => covers(p, t.url)))),
        get: async (id) => { const t = tabs.find((x) => x.id === id); if (!t) throw Error('No tab'); return plain(t); },
        create: async (o) => { w.opened.push(o.url); return { id: 99, ...o }; },
        onRemoved: { addListener() {} },
      },
      storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: { addListener: (f) => changed.push(f) } },
      scripting: {
        getRegisteredContentScripts: async () => w.registered.map((s) => ({ ...s })),
        registerContentScripts: async (list) => { w.registered.push(...plain(list)); },
        unregisterContentScripts: async (o) => { w.registered = o?.ids ? w.registered.filter((s) => !o.ids.includes(s.id)) : []; },
        executeScript: async (o) => {
          w.ran.push(o.files ? { target: plain(o.target), files: [...o.files] } : { target: plain(o.target), func: String(o.func), args: plain(o.args || []) });
          return [{ result: o.files ? {} : /typeof GZ_I18N|window\.__gzGlaze/.test(String(o.func)) ? false : true }];
        },
      },
      action: { setIcon: async (o) => { w.icons.push(plain(o)); } },
      ...(dc && {
        declarativeContent: {
          PageStateMatcher: class { constructor(o) { Object.assign(this, { matcher: plain(o) }); } },
          SetIcon: class { constructor(o) { Object.assign(this, { setIcon: o }); } },
          onPageChanged: {
            removeRules: (ids, done) => { w.removedRules++; w.rules = []; done?.(); },
            addRules: (rules, done) => { w.rules = [...(w.rules || []), ...rules]; done?.(rules); },
          },
        },
      }),
    },
  });
  vm.runInContext('Date.now = () => globalThis.__now();', context);
  context.__now = () => w.now;
  vm.runInContext(read('lib/background.js'), context, { filename: 'lib/background.js' });
  w.send = (msg, s) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, s, (r) => res(plain(r))) === true) kept = true;
    if (!kept) settle().then(() => res('ignored'));
  });
  // The browser's grant, or the student taking one back (chrome://extensions, the extensions menu, about:addons).
  w.grant = async (...origins) => { for (const o of origins) w.held.add(o); for (const f of added) f({ origins, permissions: [] }); await settle(); };
  w.revoke = async (...origins) => { for (const o of origins) w.held.delete(o); for (const f of removed) f({ origins, permissions: [] }); await settle(); };
  w.install = async (reason) => { for (const f of installed) f({ reason }); await settle(60); };
  w.files = () => w.ran.filter((r) => r.files);
  w.ids = () => w.registered.map((s) => s.id).sort();
  w.sites = () => w.ids().filter((i) => /^(https?:|ultra:)/.test(i));
  w.asked = () => w.ran.filter((r) => r.files?.includes('features/consent.js'));
  return w;
};
// Glaze's own pages, as the browser names their sender: the popup (no tab), the first screen and Settings in tabs of their own.
const ext = (p) => `chrome-extension://${ID}/${p}`;
const welcome = { id: ID, tab: { id: 3, url: ext('features/welcome.html') }, frameId: 0, url: ext('features/welcome.html'), origin: `chrome-extension://${ID}` };
const popup = { id: ID, url: ext('popup.html'), origin: `chrome-extension://${ID}` };
const settings = { id: ID, tab: { id: 4, url: ext('options.html') }, frameId: 0, url: ext('options.html'), origin: `chrome-extension://${ID}` };
const page = (url, more = {}) => ({ id: ID, tab: { id: 7, url }, frameId: 0, url, documentId: 'doc-1', ...more });
const allow = (op, more = {}) => ({ type: 'glaze:allow', op, ...more });
const BBS = 'https://bb.school.edu';

test('first screen: the grant waits for the page\'s own check; its yes is checked again, approves the site and registers it, and the first visit gets Glaze with no card', async () => {
  const w = worker({ net: { [`${BBS}/learn/api/public/v1/system/version`]: BB } });
  assert.deepEqual(await w.send(allow('ask', { origin: BBS }), welcome), { ok: true });
  assert.ok(Object.values(w.store.session).length === 1, 'what was asked is kept where a sleeping worker finds it');
  await w.grant(`${BBS}/*`);
  assert.deepEqual([w.store.local.ultra, w.fetched, w.sites()], [undefined, [], []], 'the grant alone takes nothing: the page is checking the site');
  assert.deepEqual(await w.send(allow('yes', { origin: BBS, kind: 'ultra', url: `${BBS}/` }), welcome), { ok: true });
  assert.ok(w.fetched.includes(`${BBS}/learn/api/public/v1/system/version`), 'the worker asks the site itself');
  assert.deepEqual(w.store.local.ultra, [BBS]);
  assert.deepEqual(w.sites(), [`ultra:${BBS}`]);
  assert.deepEqual(w.registered.find((s) => s.id === `ultra:${BBS}`).js, ULTRA_FIRST);
  assert.deepEqual(Object.values(w.store.session), [], 'and forgets what was asked');
  // The first page there: Glaze is registered on it; a report from its detector (All sites) is no question.
  await w.send('ultra', page(`${BBS}/ultra/course`));
  await settle();
  assert.deepEqual(w.asked(), [], 'no card');
});

test('first screen: a yes the site doesn\'t bear out, or for a host not held, approves nothing', async () => {
  const w = worker({ held: [`${BBS}/*`, 'https://www.school.edu/*', 'https://canvas.school.edu/*'], net: { [`${BBS}/learn/api/public/v1/system/version`]: BB, 'https://canvas.school.edu/api/v1/users/self': CANVAS } });
  assert.deepEqual(await w.send(allow('yes', { origin: BBS, kind: 'canvas', url: `${BBS}/` }), welcome), { ok: false }, 'Blackboard said to be Canvas');
  assert.deepEqual(await w.send(allow('yes', { origin: 'https://www.school.edu', kind: 'moodle', url: 'https://www.school.edu/' }), welcome), { ok: false }, 'a main website said to be Moodle');
  assert.deepEqual(await w.send(allow('yes', { origin: 'https://moodle.school.edu', kind: 'moodle', url: 'https://moodle.school.edu/' }), welcome), { ok: false }, 'not held');
  assert.ok(!w.fetched.some((u) => u.startsWith('https://moodle.school.edu')), 'a host not held is never fetched');
  assert.deepEqual([w.store.local.canvas, w.store.local.moodle, w.store.local.ultra, w.sites()], [undefined, undefined, undefined, []]);
  assert.deepEqual(await w.send(allow('yes', { origin: 'https://canvas.school.edu', kind: 'canvas', url: 'https://canvas.school.edu/' }), welcome), { ok: true });
  assert.deepEqual(w.store.local.canvas, ['https://canvas.school.edu/*']);
  assert.deepEqual(w.removedGrants, [], 'the worker hands nothing back: the page does, for what it turned down');
});

test('first screen: a Moodle in a folder is checked there', async () => {
  const w = worker({ held: ['https://school.edu/*'], net: { 'https://school.edu/moodle/webservice/*': MOODLE } });
  assert.deepEqual(await w.send(allow('yes', { origin: 'https://school.edu', kind: 'moodle', url: 'https://school.edu/moodle/' }), welcome), { ok: true });
  assert.deepEqual(w.store.local.moodle, ['https://school.edu/*']);
  assert.deepEqual(w.registered.find((s) => s.id === 'https://school.edu/*').js, MOODLE_FIRST);
});

test('popup: with the host already held, the site is approved and Glaze goes into that tab now', async () => {
  const C = 'https://canvas.school.edu';
  const w = worker({ held: [`${C}/*`], tabs: [{ id: 5, url: `${C}/courses/1` }] });
  assert.deepEqual(await w.send(allow('ask', { origin: C, kind: 'canvas', tabId: 5 }), popup), { ok: true });
  await settle();
  assert.deepEqual(w.store.local.canvas, [`${C}/*`]);
  assert.deepEqual(w.sites(), [`${C}/*`]);
  assert.deepEqual(w.files().map((r) => [r.target, r.files]), [[{ tabId: 5, frameIds: [0] }, CANVAS_FIRST]]);
});

test('popup: granted later, the grant finishes it (the popup may have closed under the prompt); an Ultra tab gets Ultra\'s script', async () => {
  const w = worker({ tabs: [{ id: 6, url: `${BBS}/ultra/stream` }] });
  assert.deepEqual(await w.send(allow('ask', { origin: BBS, kind: 'ultra', tabId: 6 }), popup), { ok: true });
  await settle();
  assert.deepEqual([w.store.local.ultra, w.files()], [undefined, []], 'nothing before the grant');
  await w.grant(`${BBS}/*`);
  assert.deepEqual(w.store.local.ultra, [BBS]);
  assert.deepEqual(w.sites(), [`ultra:${BBS}`]);
  assert.deepEqual(w.files().map((r) => [r.target, r.files]), [[{ tabId: 6, frameIds: [0] }, ULTRA_FIRST]]);
  assert.deepEqual(w.fetched, [], 'the popup read the kind from the tab itself');
});

test('popup: refused, nothing happens; once the ask has run out, a grant from the browser\'s menu goes through the check', async () => {
  const w = worker({ tabs: [{ id: 6, url: 'https://moodle.school.edu/my/' }], net: { 'https://moodle.school.edu/webservice/*': MOODLE } });
  await w.send(allow('ask', { origin: 'https://moodle.school.edu', kind: 'moodle', tabId: 6 }), popup);
  await settle();
  assert.deepEqual([w.store.local.moodle, w.sites(), w.files()], [undefined, [], []]);
  w.now += 30 * 60000;
  await w.grant('https://moodle.school.edu/*');
  await settle();
  assert.ok(w.fetched.some((u) => u.startsWith('https://moodle.school.edu/webservice/')), 'checked');
  assert.deepEqual(w.store.local.moodle, ['https://moodle.school.edu/*']);
  assert.deepEqual(w.files().map((r) => r.files), [MOODLE_FIRST]);
});

test('Chrome\'s own menus: a grant nobody asked for is checked; a course site is approved and Glaze goes into its open tabs; anything else is left alone', async () => {
  const C = 'https://canvas.school.edu';
  const w = worker({ net: { [`${C}/api/v1/users/self`]: CANVAS }, tabs: [{ id: 11, url: `${C}/courses/2` }, { id: 12, url: 'https://news.test/' }, { id: 13, url: `${C}/` }] });
  await w.grant(`${C}/*`);
  assert.deepEqual(w.store.local.canvas, [`${C}/*`]);
  assert.deepEqual(w.sites(), [`${C}/*`]);
  assert.deepEqual(w.files().map((r) => r.target.tabId).sort(), [11, 13]);
  await w.grant('https://news.test/*');
  assert.deepEqual([w.store.local.moodle, w.store.local.ultra, w.sites()], [undefined, undefined, [`${C}/*`]], 'Glaze takes nothing it can\'t name');
  assert.deepEqual(w.removedGrants, [], 'and doesn\'t take back what the student granted');
  // A grant that names no one site is no site.
  for (const o of ['https://*.school.edu/*', 'http://*/*', '<all_urls>', 'https://news.test/path/*']) await w.grant(o);
  assert.deepEqual(w.sites(), [`${C}/*`]);
});

test('All sites: the detector goes on every https page but the built-in hosts, the card asks there (Ultra too), and taking it back takes the detector away', async () => {
  const w = worker();
  await w.grant('https://*/*');
  const d = w.registered.find((s) => s.js?.length === 1 && s.js[0] === 'lib/detect.js');
  assert.ok(d, 'the detector is registered');
  assert.deepEqual([d.matches, [...d.excludeMatches].sort(), d.runAt, !!d.allFrames], [['https://*/*'], BUILT_IN, 'document_start', false]);
  await w.send('canvas', page('https://canvas.school.edu/'));
  await w.send('ultra', page(`${BBS}/ultra/course`));
  await settle();
  assert.deepEqual(w.asked().map((r) => r.files), [['lib/i18n.js', 'features/consent.js'], ['lib/i18n.js', 'features/consent.js']], 'the question, with its words, on both');
  // Yes on the Ultra page: approved, registered, and Ultra's own script into that page (but for the words the card brought).
  assert.deepEqual(await w.send({ type: 'glaze:consent', op: 'yes', kind: 'ultra' }, page(`${BBS}/ultra/course`)), { ok: true });
  await settle();
  assert.deepEqual(w.store.local.ultra, [BBS]);
  assert.deepEqual(w.files().at(-1).files, ULTRA_FIRST.filter((f) => f !== 'lib/i18n.js'));
  await w.revoke('https://*/*');
  assert.ok(!w.registered.some((s) => s.js?.includes('lib/detect.js')), 'the detector goes');
  assert.ok(!w.sites().includes(`ultra:${BBS}`), 'and the site held only through it');
  assert.deepEqual(w.store.local.ultra, [BBS], 'its approval stays');
});

test('All sites from the first screen, and an update keeping an all-site grant: the detector is registered; Safari keeps its own', async () => {
  const w = worker();
  w.held.add('https://*/*');
  assert.deepEqual(await w.send(allow('all'), welcome), { ok: true });
  await settle();
  assert.ok(w.registered.some((s) => s.js?.includes('lib/detect.js')));
  const kept = worker({ held: ['https://*/*'] });
  await kept.install('update');
  assert.ok(kept.registered.some((s) => s.js?.includes('lib/detect.js')), 'an existing student\'s all-site grant keeps the card');
  const safari = worker({ m: SAFARI, dc: false });
  await safari.install('update');
  assert.ok(!safari.registered.some((s) => s.js?.includes('lib/detect.js')), 'Safari\'s manifest runs its own');
  const none = worker();
  assert.deepEqual(await none.send(allow('all'), welcome), { ok: true });
  await settle();
  assert.ok(!none.registered.some((s) => s.js?.includes('lib/detect.js')), 'no grant, no detector, whatever the page says');
});

test('taken back: a site\'s registration goes while its host isn\'t held, its approval and the student\'s data stay, and a grant brings it back; no grant is ever removed', async () => {
  const C = 'https://canvas.school.edu', M = 'https://moodle.school.edu';
  const local = { canvas: [`${C}/*`], moodle: [`${M}/*`], ultra: [BBS], seenCourses: { [`canvas:${C}/1`]: { name: 'Bio' } }, [`dueWeek:${C}`]: { at: 1, list: [] } };
  const w = worker({ held: [`${C}/*`, `${M}/*`, `${BBS}/*`], local });
  await w.install('update');
  assert.deepEqual(w.sites(), [`${C}/*`, `${M}/*`, `ultra:${BBS}`]);
  await w.revoke(`${C}/*`, `${BBS}/*`);
  assert.deepEqual(w.sites(), [`${M}/*`]);
  for (const k of Object.keys(local)) assert.deepEqual(w.store.local[k], local[k], k);
  await w.grant(`${C}/*`, `${BBS}/*`);
  assert.deepEqual(w.sites(), [`${C}/*`, `${M}/*`, `ultra:${BBS}`]);
  // Firefox lets a student take back a built-in host too: Glaze stops asking its pages' frames for nothing, and removes nothing.
  await w.revoke('https://*.instructure.com/*');
  assert.deepEqual(w.removedGrants, []);
  assert.doesNotMatch(read('lib/background.js'), /permissions\.remove\(/, 'the worker never hands a grant back');
});

test('a listed site registers only while its host is held (every grant is checked, the built-in ones too); Safari\'s <all_urls> holds them all', async () => {
  const C = 'https://canvas.school.edu';
  const w = worker({ local: { canvas: [`${C}/*`], ultra: [BBS] } });
  await w.install('update');
  assert.deepEqual(w.sites(), []);
  const s = worker({ m: SAFARI, dc: false, local: { canvas: [`${C}/*`] } });
  await s.install('update');
  assert.deepEqual(s.sites(), [`${C}/*`]);
});

test('only Glaze\'s own pages, each in a page of its own, may add a site; never a content script or a frame inside a web page', async () => {
  const w = worker({ held: [`${BBS}/*`], net: { [`${BBS}/learn/api/public/v1/system/version`]: BB } });
  const no = { ok: false, error: 'sender' };
  const frame = { id: ID, tab: { id: 7, url: `${BBS}/ultra/course` }, frameId: 3, url: ext('options.html'), origin: `chrome-extension://${ID}` };
  for (const s of [page(`${BBS}/ultra/course`), page(`${BBS}/ultra/course`, { frameId: 2 }), frame, { ...welcome, id: 'other' }, { ...popup, url: ext('reader.html') }, { ...welcome, origin: 'https://evil.test' }]) {
    assert.deepEqual(await w.send(allow('yes', { origin: BBS, kind: 'ultra', url: `${BBS}/` }), s), no, s.url);
    assert.deepEqual(await w.send(allow('ask', { origin: BBS, kind: 'ultra', tabId: 7 }), s), no, s.url);
  }
  assert.deepEqual([w.store.local.ultra, w.sites(), w.fetched], [undefined, [], []]);
  for (const s of [welcome, popup, settings]) assert.deepEqual(await w.send(allow('ask', { origin: 'https://x.school.edu' }), s), { ok: true }, s.url);
  // Every origin through the shared parser: one https host, nothing else.
  for (const origin of ['https://*.school.edu', 'http://bb.school.edu', `${BBS}/ultra`, 'javascript:alert(1)', 'bb.school.edu', `${BBS}:8443`, 42, undefined]) {
    assert.deepEqual(await w.send(allow('ask', { origin }), welcome), { ok: false, error: 'site' }, String(origin));
  }
  for (const kind of ['blackboard', '', undefined]) assert.deepEqual(await w.send(allow('yes', { origin: BBS, kind, url: `${BBS}/` }), welcome), { ok: false, error: 'site' }, String(kind));
  assert.deepEqual(await w.send(allow('ask', { origin: BBS, kind: 'ultra', tabId: 'x' }), popup), { ok: false, error: 'site' });
  assert.deepEqual(await w.send(allow('drop', { origin: BBS }), welcome), { ok: false, error: 'site' });
});

test('Safari: a grant from its own settings adds no site by itself; its card still asks', async () => {
  const w = worker({ m: SAFARI, dc: false, net: { [`${BBS}/learn/api/public/v1/system/version`]: BB }, tabs: [{ id: 6, url: `${BBS}/ultra/stream` }] });
  await w.grant(`${BBS}/*`);
  assert.deepEqual([w.store.local.ultra, w.fetched, w.files()], [undefined, [], []]);
});

test('first run: Glaze\'s first screen opens once on install, never on an update, and never on Safari\'s manifest', async () => {
  const w = worker();
  await w.install('install');
  assert.deepEqual(w.opened, [ext('features/welcome.html')]);
  await w.install('update');
  await w.install('chrome_update');
  assert.deepEqual(w.opened, [ext('features/welcome.html')]);
  const safari = worker({ m: SAFARI, dc: false });
  await safari.install('install');
  assert.deepEqual(safari.opened, []);
});

test('the lit icon: on install and update Glaze\'s rules become three, each lighting the attention icon at 16 and 32; Firefox has none', async () => {
  for (const reason of ['install', 'update']) {
    const w = worker();
    await w.install(reason);
    assert.ok(w.removedRules >= 1, `${reason}: the old rules go first`);
    assert.equal(w.rules.length, 3, reason);
    assert.deepEqual(plain(w.rules.map((r) => r.conditions.map((c) => c.matcher))), [
      [{ css: ['div#application.ic-app'] }],
      [{ css: ['body[id^="page-"][class*="pagelayout-"][class*="path-"]'] }],
      [{ pageUrl: { pathPrefix: '/ultra', schemes: ['https'] }, css: ['div#site-wrap.off-canvas-wrap'] }],
    ]);
    for (const r of w.rules) {
      assert.equal(r.actions.length, 1);
      const { imageData } = r.actions[0].setIcon;
      assert.deepEqual(Object.keys(imageData).sort(), ['16', '32']);
      for (const n of [16, 32]) {
        assert.equal(imageData[n].width, n);
        assert.ok(imageData[n].drawn.some(([f]) => f === 'drawImage'), 'Glaze\'s icon');
        assert.ok(imageData[n].drawn.filter(([f]) => f === 'arc').length >= 1, 'and its dot');
      }
    }
    assert.ok(w.fetched.includes(ext('icons/icon16.png')) && w.fetched.includes(ext('icons/icon32.png')));
  }
  const ff = worker({ dc: false });
  await ff.install('install');
  assert.deepEqual(ff.icons, []);
});

test('the lit icon: a page Glaze runs in shows Glaze\'s own icon for its tab; nothing else changes it, and never without a tab', async () => {
  const w = worker({ local: { moodle: ['https://moodle.school.edu/*'] }, held: ['https://moodle.school.edu/*'] });
  const icons = manifest.action.default_icon;
  for (const url of ['https://school.instructure.com/courses/1', 'https://moodle.school.edu/my/', 'https://school.blackboard.com/ultra/stream']) await w.send({ type: 'glaze:here' }, page(url));
  await settle();
  assert.equal(w.icons.length, 3);
  for (const o of w.icons) {
    assert.equal(o.tabId, 7);
    assert.deepEqual(Object.keys(o.path).sort(), Object.keys(icons).sort());
    for (const k of Object.keys(icons)) assert.ok(o.path[k].endsWith(icons[k]), o.path[k]);
  }
  for (const s of [page('https://shop.test/'), page('https://school.instructure.com/courses/1', { frameId: 4 }), { ...page('https://school.instructure.com/'), id: 'other' }, popup]) await w.send({ type: 'glaze:here' }, s);
  await settle();
  assert.equal(w.icons.length, 3, 'a page Glaze isn\'t in, a frame, another extension, Glaze\'s own pages');
  const ff = worker({ dc: false });
  await ff.send({ type: 'glaze:here' }, page('https://school.instructure.com/courses/1'));
  await settle();
  assert.deepEqual(ff.icons, [], 'Firefox lights nothing, so there is nothing to put back');
  const src = read('lib/background.js');
  for (const call of src.match(/action\.setIcon\([^)]*\)/g) || []) assert.match(call, /tabId/, call);
});

test('content.js tells the worker each page Glaze starts in, from its top frame', () => {
  const js = read('content.js');
  assert.match(js, /if \(!site\) return;[\s\S]{0,400}window\.top === window && !isPreview[^\n]*sendMessage\(\{ type: 'glaze:here' \}\)/);
});

test('lib/detect.js reports Ultra on an /ultra page by its base, as content.js knows it', () => {
  const run = (url, head) => {
    const sent = [];
    const doc = {
      contentType: 'text/html', body: { matches: () => false },
      head: { querySelector: (sel) => (sel.includes('base[href*="/ultra/"]') && head === 'ultra' ? { matches: (s) => s.includes('base[href*="/ultra/"]') && !s.includes('brandable') } : null) },
      addEventListener() {}, removeEventListener() {},
    };
    vm.runInNewContext(read('lib/detect.js'), { document: doc, location: new URL(url), window: {}, MutationObserver: class { observe() {} disconnect() {} }, chrome: { runtime: { sendMessage: (m) => sent.push(m), lastError: null } } });
    return sent;
  };
  assert.deepEqual(run(`${BBS}/ultra/course`, 'ultra'), ['ultra']);
  assert.deepEqual(run(`${BBS}/webapps/portal`, 'ultra'), [], 'off /ultra, a base proves nothing');
  assert.deepEqual(run(`${BBS}/ultra/course`, null), []);
  assert.ok(fs.statSync(path.join(root, 'lib/detect.js')).size < 2048);
});
