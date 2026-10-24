// Where a framed Glaze page can't ask the browser for a host (Firefox gives an extension page framed in a web page no
// permissions API), the ask goes to a Glaze tab of its own: Download all's Allow frame has the worker open features/allow.html
// in a tab with the same one button, its click asks, and the answer goes back to that frame only; embedded Settings sends a
// control that needs a grant (Gradescope, a Look's pasted media) to Settings' own tab. Where the API is there (Chrome) the
// frame asks itself, as before. The real features/allow.js, lib/site.js, lib/background.js and options.js's embedded part,
// with the browser stood in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const ID = 'glaze', EXT = `chrome-extension://${ID}`, CDN = 'inst-fs-iad.example-cdn.net', PATTERN = `https://${CDN}/*`;
const ALLOW = `${EXT}/features/allow.html#${CDN}`;

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), listeners: {}, attrs: {}, textContent: '', hidden: false, focused: false }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  focus() { this.focused = true; }
}

// ---- the Allow page: framed in a school's page, or in its own tab --------------------------------------------------------
// `permissions`: whether the page has the API (Chrome's frame, any top-level tab) or not (Firefox's frame); `send`: the
// worker's answer to runtime.sendMessage.
const allowPage = ({ hash = `#${CDN}`, top = false, permissions = true, authorized = true, request = async () => true, send = async () => ({ ok: true }) } = {}) => {
  const button = new El('button'), html = new El('html'), asked = [], told = [], sent = [];
  let active = false, heard;
  const document = { getElementById: (id) => (id === 'allow' ? button : null), documentElement: html, body: { scrollWidth: 120, scrollHeight: 26 } };
  const chrome = { runtime: { getManifest: () => ({ host_permissions: [] }), sendMessage: (m) => { if (m.type === 'glaze:allow-init') return Promise.resolve({ ok: authorized }); sent.push([plain(m), active]); return send(m); } } };
  if (permissions) chrome.permissions = { request: (o) => { asked.push([[...o.origins], active]); return request(o); } };
  const g = { document, location: { hash }, console, Promise, URL, decodeURIComponent, navigator: { language: 'en' }, Intl, Object, Array, String, Number, JSON, Math, Error,
    parent: { postMessage: (m) => told.push(plain(m)) }, addEventListener(t, f) { if (t === 'message') heard = f; }, requestAnimationFrame: (f) => f(), chrome };
  g.globalThis = g; g.self = g; g.window = g; g.top = top ? g : { other: true };
  vm.createContext(g);
  for (const f of ['lib/i18n.js', 'features/allow.js']) vm.runInContext(read(f), g);
  // The school's page hands a framed one its reply port.
  if (!top) heard?.({ data: { gzAllow: decodeURIComponent(hash.slice(1)), ticket: 'page-ticket' }, ports: [{ postMessage: (m) => told.push(plain(m)) }] });
  const click = (isTrusted = true) => { active = true; for (const f of button.listeners.click || []) f({ isTrusted }); active = false; };
  const answers = () => told.filter((m) => 'ok' in m);
  return { button, html, asked, told, sent, click, answers };
};

test('Allow frame without the permissions API: its click has the worker open the own tab, in the click, and says what came back', async () => {
  for (const [reply, ok] of [[{ ok: true }, true], [{ ok: false }, false], [undefined, false]]) {
    const f = allowPage({ permissions: false, send: async () => reply }); await settle();
    assert.equal(f.button.textContent, `Allow ${CDN}`);
    f.click(false);
    assert.deepEqual(f.sent, [], 'a click the page made up sends nothing');
    f.click();
    f.click();
    await settle();
    assert.deepEqual(f.sent, [[{ type: 'glaze:allow-tab', host: CDN, ticket: 'page-ticket' }, true]], 'one word to the worker, in the click');
    assert.deepEqual(f.answers(), [{ gzAllow: CDN, ok }], `the worker's ${JSON.stringify(reply)} goes to the page`);
  }
  const lost = allowPage({ permissions: false, send: () => Promise.reject(new Error('Could not establish connection')) });
  await settle(); lost.click();
  await settle();
  assert.deepEqual(lost.answers(), [{ gzAllow: CDN, ok: false }], 'no worker: no');
});

test('Allow frame with the permissions API (Chrome): it asks the browser itself, never the worker for a tab', async () => {
  const f = allowPage(); await settle();
  f.click();
  await settle();
  assert.deepEqual(f.asked, [[[PATTERN], true]]);
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.answers(), [{ gzAllow: CDN, ok: true }]);
});

test('Allow in its own tab: the same button, focused; its click asks the browser in the click, then tells the worker; nothing to a page', async () => {
  for (const yes of [true, false]) {
    const t = allowPage({ top: true, request: async () => yes }); await settle();
    assert.equal(t.button.textContent, `Allow ${CDN}`);
    assert.equal(t.button.hidden, false);
    assert.equal(t.button.focused, true, 'Enter answers it');
    t.click(false);
    assert.deepEqual(t.asked, []);
    t.click();
    t.click();
    await settle();
    assert.deepEqual(t.asked, [[[PATTERN], true]], 'once, in the click');
    assert.deepEqual(t.sent.map(([m]) => m), [{ type: 'glaze:allow-answer', host: CDN }], 'the worker hears it was answered (it checks the grant itself)');
    assert.deepEqual(t.told, []);
  }
  const threw = allowPage({ top: true, request: () => Promise.reject(new Error('no')) });
  await settle(); threw.click();
  await settle();
  assert.deepEqual(threw.sent.map(([m]) => m), [{ type: 'glaze:allow-answer', host: CDN }], 'an ask that threw is an answer too');
  const bad = allowPage({ top: true, hash: '#https://x.example/' });
  assert.equal(bad.button.hidden, true);
});

// ---- the worker ----------------------------------------------------------------------------------------------------------
// `held`: the hosts the browser holds (a Set the test changes); `session`: storage.session as the worker left it.
const worker = ({ held = new Set(), session = {} } = {}) => {
  const listeners = [], connects = [], updated = [], replaced = [], removedListeners = [], created = [], removed = [], store = { local: {}, sync: {}, session: structuredClone(session) };
  let nextTab = 50;
  const area = (name) => ({
    get: async (k) => structuredClone(k == null ? store[name] : Object.fromEntries([].concat(k).filter((x) => x in store[name]).map((x) => [x, store[name][x]]))),
    set: async (v) => { Object.assign(store[name], structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete store[name][x]; },
  });
  const manifest = require('../manifest.json');
  const context = vm.createContext({
    URL, AbortController, console, setTimeout, clearTimeout, TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), context, { filename: f }); },
    chrome: {
      runtime: {
        id: ID, getURL: (p = '') => `${EXT}/${p}`, getManifest: () => manifest,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener: (f) => connects.push(f) },
        openOptionsPage: () => Promise.resolve(),
      },
      permissions: { contains: async ({ origins }) => origins.every((o) => held.has(o)), onAdded: { addListener() {} }, onRemoved: { addListener() {} } },
      tabs: {
        query: async () => [], get: async () => ({}),
        create: async (o) => { const tab = { id: nextTab++, ...plain(o) }; created.push(tab); return tab; },
        update: async (id, o) => Object.assign(created.find((t) => t.id === id), plain(o)),
        remove: async (id) => { removed.push(id); for (const f of removedListeners) f(id, {}); },
        onRemoved: { addListener: (f) => removedListeners.push(f) },
        onUpdated: { addListener: (f) => updated.push(f) }, onReplaced: { addListener: (f) => replaced.push(f) },
      },
      storage: { local: area('local'), sync: area('sync'), session: area('session'), onChanged: { addListener() {} } },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: async () => [] },
    },
  });
  vm.runInContext(read('lib/background.js'), context, { filename: 'lib/background.js' });
  // A message as the browser hands it on: a promise of its reply ('ignored' once nothing has kept the channel), and
  // `replied()` to look without waiting.
  const send = (m, s) => {
    let got, done = false;
    const p = new Promise((res) => {
      let kept = false;
      for (const f of listeners) if (f(m, s, (r) => { done = true; got = plain(r); res(got); }) === true) kept = true;
      if (!kept) settle().then(() => { if (!done) { done = true; got = 'ignored'; res(got); } });
    });
    p.replied = () => (done ? got : 'pending');
    return p;
  };
  const closeTab = (id) => { for (const f of removedListeners) f(id, {}); };
  const download = async (tab = 7, host = CDN) => {
    const incoming = [], gone = [], posted = [];
    const p = { name: 'canvas-zip', sender: { id: ID, url: 'https://school.instructure.com/courses/1/modules', frameId: 0, tab: { id: tab } },
      onMessage: { addListener: (f) => incoming.push(f) }, onDisconnect: { addListener: (f) => gone.push(f) }, postMessage: (m) => posted.push(plain(m)), disconnect() {} };
    for (const f of connects) f(p);
    for (const f of incoming) f({ type: 'file', url: `https://${host}/file.pdf` });
    await settle();
    return { ticket: posted.find((m) => m.type === 'ask')?.ticket, close: () => gone.forEach((f) => f()), posted };
  };
  return { send, created, removed, closeTab, store, held, download, updated, replaced };
};
// The Allow frame in tab 7's school page, and the tab the worker opens (id 50).
const frameSender = (more = {}) => ({ id: ID, url: ALLOW, origin: EXT, frameId: 3, tab: { id: 7, index: 2, url: 'https://school.instructure.com/courses/1/modules' }, ...more });
const tabSender = (more = {}) => ({ id: ID, url: ALLOW, origin: EXT, frameId: 0, tab: { id: 50, index: 3, url: ALLOW }, ...more });
// What Download all leaves when the worker meets a host it doesn't hold (lib/background.js asking): the worker's own ask.
const askedByDownload = () => ({ [`allow ${PATTERN}`]: { until: Date.now() + 60000 } });
const ask = { type: 'glaze:allow-tab', host: CDN };
const answer = { type: 'glaze:allow-answer', host: CDN };
const startAsk = async (w, sender = frameSender()) => {
  const d = await w.download();
  assert.equal((await w.send({ type: 'glaze:allow-init', host: CDN, ticket: d.ticket }, sender)).ok, true);
  return { ...ask, ticket: d.ticket };
};
const initTab = (w) => w.send({ type: 'glaze:allow-init', host: CDN }, tabSender());

test('worker: the frame\'s ask opens features/allow.html for that host in a tab beside the school\'s; granted there, the frame hears yes and the tab closes', async () => {
  const w = worker({ session: askedByDownload() });
  const r = w.send(await startAsk(w), frameSender());
  await settle();
  assert.equal(r.replied(), 'pending', 'the frame waits for the answer');
  assert.deepEqual(w.created.map(({ url, openerTabId, index }) => ({ url, openerTabId, index })), [{ url: ALLOW, openerTabId: 7, index: 3 }]);
  await initTab(w);
  w.held.add(PATTERN);
  assert.deepEqual(await w.send(answer, tabSender()), { ok: true });
  assert.deepEqual(await r, { ok: true });
  assert.deepEqual(w.removed, [50], 'the tab closes');
});

test('worker: refused in the tab, the frame hears no, whatever the tab says; the tab closes', async () => {
  const w = worker({ session: askedByDownload() });
  const r = w.send(await startAsk(w), frameSender());
  await settle();
  await initTab(w);
  assert.deepEqual(await w.send({ ...answer, ok: true }, tabSender()), { ok: true });
  assert.deepEqual(await r, { ok: false }, 'the worker checks the grant itself');
  assert.deepEqual(w.removed, [50]);
});

test('worker: the tab closed without an answer is a no', async () => {
  const w = worker({ session: askedByDownload() });
  const r = w.send(await startAsk(w), frameSender());
  await settle();
  w.closeTab(50);
  assert.deepEqual(await r, { ok: false });
  // The school's tab closing doesn't answer for the Allow tab.
  const v = worker({ session: askedByDownload() });
  const s = v.send(await startAsk(v), frameSender());
  await settle();
  v.closeTab(8);
  await settle();
  assert.equal(s.replied(), 'pending');
});

test('worker: an answer from any page but the tab it opened is refused, and the frame keeps waiting for the real one', async () => {
  const w = worker({ session: askedByDownload() });
  const r = w.send(await startAsk(w), frameSender());
  await settle();
  await initTab(w);
  w.held.add(PATTERN);
  for (const forged of [
    tabSender({ tab: { id: 51, url: ALLOW } }), // another tab showing the same page
    frameSender(), // the frame itself
    tabSender({ frameId: 2 }), // a frame inside the tab
    tabSender({ url: `${EXT}/options.html` }), // another of Glaze's pages in it
    tabSender({ url: `${EXT}/features/allow.html#other.example.com` }), // the page for another host
    tabSender({ id: 'other' }), // another extension
    tabSender({ origin: 'https://evil.example' }),
  ]) assert.deepEqual(await w.send(answer, forged), { ok: false, error: 'sender' }, JSON.stringify(forged));
  assert.deepEqual(await w.send({ ...answer, host: 'other.example.com' }, tabSender()), { ok: false, error: 'sender' }, 'another host');
  await settle();
  assert.equal(r.replied(), 'pending');
  assert.deepEqual(w.removed, []);
  assert.deepEqual(await w.send(answer, tabSender()), { ok: true });
  assert.deepEqual(await r, { ok: true });
});

test('worker: only Glaze\'s Allow frame, in a tab, for the host it shows and the worker itself is waiting for, opens a tab', async () => {
  const w = worker({ session: askedByDownload() });
  for (const [m, s, why] of [
    [ask, frameSender({ frameId: 0 }), 'the page in a tab of its own'],
    [ask, frameSender({ tab: undefined }), 'no tab'],
    [ask, frameSender({ id: 'other' }), 'another extension'],
    [ask, frameSender({ url: 'https://school.instructure.com/x' }), 'a web page'],
    [ask, frameSender({ url: `${EXT}/options.html#${CDN}` }), 'another of Glaze\'s pages'],
    [ask, frameSender({ origin: 'https://evil.example' }), 'another origin'],
    [{ ...ask, host: 'other.example.com' }, frameSender(), 'a host the frame doesn\'t show'],
    [{ ...ask, host: 'other.example.com' }, frameSender({ url: `${EXT}/features/allow.html#other.example.com` }), 'a host the worker isn\'t waiting for'],
    [{ ...ask, host: 42 }, frameSender(), 'no host'],
  ]) assert.deepEqual(await w.send(m, s), { ok: false }, why);
  assert.deepEqual(w.created, []);
  // A held host still cannot authorize an unrelated frame.
  w.held.add(PATTERN);
  assert.deepEqual(await w.send(ask, frameSender()), { ok: false });
  assert.deepEqual(w.created, []);
});

// ---- embedded Settings ---------------------------------------------------------------------------------------------------
// Settings framed in a school's tab, claimed with its ticket (restored from session storage, as after the worker slept).
const settingsFrame = (more = {}) => ({ id: ID, url: `${EXT}/options.html#study/todo`, origin: EXT, frameId: 4, documentId: 'doc-s', tab: { id: 7, index: 2 }, ...more });
test('worker: claimed embedded Settings opens Settings\' own tab at a section, beside its tab; nothing else does', async () => {
  const w = worker({ session: { 'settingsFrame:7': { frameId: 4, documentId: 'doc-s' } } });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(await w.send({ type: 'glaze:settings-tab', hash: '#study/todo' }, settingsFrame()), { ok: true });
  assert.deepEqual(w.created.map(({ url, openerTabId, index }) => ({ url, openerTabId, index })), [{ url: `${EXT}/options.html#study/todo`, openerTabId: 7, index: 3 }]);
  for (const [m, s] of [
    [{ type: 'glaze:settings-tab', hash: '#study/todo' }, settingsFrame({ frameId: 5 })], // a frame that never claimed
    [{ type: 'glaze:settings-tab', hash: '#study/todo' }, settingsFrame({ documentId: 'doc-other' })],
    [{ type: 'glaze:settings-tab', hash: '#study/todo' }, settingsFrame({ url: 'https://school.instructure.com/' })],
    [{ type: 'glaze:settings-tab', hash: '#study/todo' }, settingsFrame({ id: 'other' })],
    [{ type: 'glaze:settings-tab', hash: 'javascript:alert(1)' }, settingsFrame()],
    [{ type: 'glaze:settings-tab', hash: '#a?b=c' }, settingsFrame()],
  ]) assert.deepEqual(await w.send(m, s), { ok: false }, JSON.stringify([m, s]));
  assert.equal(w.created.length, 1);
});

// lib/site.js reach in a page that can't ask: the page's own way out (`elsewhere`), with the control that wanted the grant.
const sitePage = ({ permissions, elsewhere } = {}) => {
  const asked = [], sent = [], went = [];
  const chrome = { runtime: { getManifest: () => ({ host_permissions: [] }), sendMessage: async (m) => { sent.push(m); return { ok: true }; } } };
  if (permissions) chrome.permissions = { request: async (o) => { asked.push([...o.origins]); return true; } };
  const g = vm.createContext({ chrome, URL, Promise, console });
  vm.runInContext(read('lib/site.js'), g);
  if (elsewhere) g.GZ_SITE.elsewhere = (from) => { went.push(from); };
  return { S: g.GZ_SITE, asked, sent, went };
};
test('reach without the permissions API: where the page set a way out, the control goes there and nothing is asked (null); with the API, asks as before', async () => {
  const control = { id: 'gradescope' };
  const ff = sitePage({ permissions: false, elsewhere: true });
  assert.equal(await ff.S.reach(['https://www.gradescope.com'], control), null);
  assert.deepEqual(ff.went, [control]);
  assert.deepEqual(ff.sent, [], 'nothing noted as asked');
  assert.equal(await ff.S.reach(['not a link'], control), false, 'an address that is no host is still no');
  assert.deepEqual(ff.went, [control]);
  const chromeFrame = sitePage({ permissions: true, elsewhere: true });
  assert.equal(await chromeFrame.S.reach(['https://www.gradescope.com'], control), true);
  assert.deepEqual(chromeFrame.asked, [['https://www.gradescope.com/*']]);
  assert.deepEqual(chromeFrame.went, [], 'Chrome asks from the frame');
  const none = sitePage({ permissions: false });
  assert.equal(await none.S.reach(['https://www.gradescope.com'], control), false, 'no API and no way out: no');
});

// options.js's embedded part, run on a stand-in page: what it sets up for a frame with and without the APIs.
const embeddedSettings = ({ permissions, tabs }) => {
  const src = read('options.js');
  const from = src.indexOf('const embedded = window.top !== window;'), to = src.indexOf('const filter = () =>');
  assert.ok(from > 0 && to > from, 'options.js has its embedded part');
  const sent = [], created = [], posted = [];
  const el = () => Object.assign(new El('div'), { hidden: true, prepend() {}, append() {}, closest: () => null });
  const els = {};
  const $ = (s) => (els[s] ||= el());
  const chrome = { runtime: { getURL: (p = '') => `${EXT}/${p}`, sendMessage: (m) => { if (m.type === 'glaze:allow-init') return Promise.resolve({ ok: authorized }); sent.push(plain(m)); return Promise.resolve({ ok: true }); } } };
  if (permissions) chrome.permissions = { request: async () => true };
  if (tabs) chrome.tabs = { create: (o) => { created.push(plain(o)); return Promise.resolve({ id: 1 }); } };
  const g = { $, t: (k) => k, chrome, console, Promise, URLSearchParams, location: { search: '?t=abc', pathname: '/options.html', hash: '#look/palette' },
    history: { replaceState() {} }, addEventListener() {}, document: { documentElement: new El('html'), querySelector: () => null, createElement: () => el() },
    GZ_SITE: {} };
  g.window = g; g.top = { other: true }; g.parent = { postMessage: (m) => posted.push(plain(m)) };
  vm.createContext(g);
  vm.runInContext(src.slice(from, to), g);
  return { g, sent, created, posted };
};
// A control inside a section of Settings.
const inSection = (section) => ({ closest: (sel) => (sel === '[data-editor-section]' ? { dataset: { editorSection: section } } : null) });

test('embedded Settings without the permissions API (Firefox): a control that needs a grant opens Settings\' own tab at its section, through the worker, and closes', async () => {
  const s = embeddedSettings({ permissions: false, tabs: false });
  assert.equal(typeof s.g.GZ_SITE.elsewhere, 'function', 'reach has a way out');
  s.g.GZ_SITE.elsewhere(inSection('study/todo'));
  await settle();
  assert.deepEqual(s.sent.filter((m) => m.type === 'glaze:settings-tab'), [{ type: 'glaze:settings-tab', hash: '#study/todo' }]);
  assert.deepEqual(s.posted, [{ gzSettings: 'close' }], 'the framed Settings closes once its tab is open');
  // Its own "Open in a new tab" goes the same way where the frame has no tabs API.
  s.sent.length = 0; s.posted.length = 0;
  for (const f of s.g.$('#embed-tab').listeners.click || []) f({ isTrusted: true });
  await settle();
  assert.deepEqual(s.sent.filter((m) => m.type === 'glaze:settings-tab'), [{ type: 'glaze:settings-tab', hash: '#look/palette' }]);
  assert.deepEqual(s.posted, [{ gzSettings: 'close' }]);
});

test('embedded Settings with the APIs (Chrome): reach asks from the frame (no way out), and its own tab opens as before', async () => {
  const s = embeddedSettings({ permissions: true, tabs: true });
  assert.equal(s.g.GZ_SITE.elsewhere, undefined);
  for (const f of s.g.$('#embed-tab').listeners.click || []) f({ isTrusted: true });
  await settle();
  assert.deepEqual(s.created, [{ url: `${EXT}/options.html#look/palette` }]);
  assert.deepEqual(s.sent.filter((m) => m.type === 'glaze:settings-tab'), []);
  assert.deepEqual(s.posted, [{ gzSettings: 'close' }]);
});

test('Settings\' grant-needing controls hand reach the control, and a control sent elsewhere says nothing', () => {
  const src = read('options.js');
  const line = (needle) => { const at = src.indexOf(needle); assert.ok(at > 0, needle); return src.slice(at, src.indexOf('\n', at)); };
  assert.match(line("if (key === 'enhance.gradescope'"), /GZ_SITE\.reach\(\[GZ_GRADESCOPE\.HOST\], el\)/);
  const apply = src.slice(src.indexOf("$('#share-apply').addEventListener"), src.indexOf('// ---- gallery, favorites and history'));
  assert.match(apply, /GZ_SITE\.reach\(\[src\], \$\('#share-apply'\)\)/);
  assert.match(apply, /if \(held === null\) return;/);
  const xbg = read('lib/editor-xbg.js');
  assert.match(xbg, /GZ_SITE\.reach\(\[url\], input\)/);
  assert.match(xbg.slice(xbg.indexOf('GZ_SITE.reach([url], input)')), /^[^]*?if \(held === null\) return;/);
});


test('review: a public Allow tab cannot ask for a host planted in its hash', async () => {
  const p = allowPage({ top: true, authorized: false });
  await settle(); p.click(); await settle();
  assert.deepEqual(p.asked, [], 'unopened by the worker: no browser prompt');
});

test('review: an arbitrary Allow frame cannot ask on the strength of another tab or feature asking', async () => {
  const w = worker({ session: askedByDownload() });
  const r = w.send(ask, frameSender());
  await settle();
  assert.deepEqual(w.created, [], 'a global asked-host entry does not authorize a download frame');
  assert.deepEqual(await r, { ok: false });
});

test('review: Allow authority belongs to one download, tab and frame; navigation and replacement end it', async () => {
  for (const end of ['navigate', 'replace', 'source-close', 'download-close']) {
    const w = worker(), a = await w.download(), b = await w.download(8, 'second.example.net');
    assert.equal(typeof a.ticket, 'string', 'worker issues a private ticket for its own wait');
    assert.notEqual(a.ticket, b.ticket);
    const init = { type: 'glaze:allow-init', host: CDN, ticket: a.ticket };
    assert.equal((await w.send(init, frameSender({ tab: { id: 8 } }))).ok, false);
    assert.equal((await w.send(init, frameSender())).ok, true);
    assert.equal((await w.send(init, frameSender({ frameId: 5 }))).ok, false, 'the ticket is consumed');
    const pending = w.send({ ...ask, ticket: a.ticket }, frameSender());
    await settle();
    assert.equal(w.created.length, 1);
    assert.equal((await w.send({ type: 'glaze:allow-init', host: CDN }, tabSender({ documentId: 'allow-doc' }))).ok, true);
    if (end === 'navigate') w.updated.forEach((f) => f(50, { status: 'loading' }, {}));
    if (end === 'replace') w.replaced.forEach((f) => f(51, 50));
    if (end === 'source-close') w.closeTab(7);
    if (end === 'download-close') a.close();
    await settle();
    assert.deepEqual(await pending, { ok: false }, end);
    assert.equal((await w.send(answer, tabSender())).ok, false, 'a replacement document cannot answer');
    assert.ok(w.removed.includes(50), 'no orphan Allow tab');
  }
});


test('review: Settings carries an action privately to exactly the tab it opens, once', async () => {
  const w = worker({ session: { 'settingsFrame:7': { frameId: 4, documentId: 'doc-s' } } });
  const action = { kind: 'media', src: 'https://media.example.net/loop.webm', mediaKind: 'video' };
  const msg = { type: 'glaze:settings-tab', hash: '#look/background', action };
  assert.equal((await w.send(msg, settingsFrame({ documentId: 'forged' }))).ok, false);
  assert.equal((await w.send(msg, settingsFrame())).ok, true);
  const opened = { id: ID, origin: EXT, url: `${EXT}/options.html#look/background`, frameId: 0, tab: { id: 50 } };
  assert.ok(!w.created[0].url.includes('media.example.net'), 'the payload never enters an address');
  assert.equal((await w.send({ type: 'glaze:settings-action' }, { ...opened, tab: { id: 51 } })).action, undefined);
  assert.deepEqual((await w.send({ type: 'glaze:settings-action' }, opened)).action, action);
  assert.equal((await w.send({ type: 'glaze:settings-action' }, opened)).action, undefined, 'consumed');
  const second = worker({ session: { 'settingsFrame:7': { frameId: 4, documentId: 'doc-s' } } });
  const code = { kind: 'code', code: 'gz1:pending-look' };
  assert.equal((await second.send({ ...msg, hash: '#look/palette', action: code }, settingsFrame())).ok, true);
  assert.deepEqual((await second.send({ type: 'glaze:settings-action' }, opened)).action, code);
});
