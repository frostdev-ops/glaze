// Settings as a page of an LMS tab (features/settingspage.js): the worker's one-use tickets decide which frames may show it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const worker = () => {
  const listeners = [];
  const area = { get: async () => ({}), set: async () => {}, remove: async () => {} };
  const ctx = vm.createContext({ URL, TextEncoder, TextDecoder, structuredClone, console, crypto, atob, btoa, setTimeout, clearTimeout, Date, navigator: {},
    GZ_SESSIONS: { make: () => ({ handle: async () => ({ ok: true }), connect: () => () => {}, stop() {}, changed() {} }) },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), ctx); },
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: { addListener: (f) => listeners.push(f) }, onConnect: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      tabs: { onRemoved: { addListener() {} } }, storage: { local: area, sync: area, onChanged: { addListener() {} } } } });
  vm.runInContext(read('lib/background.js'), ctx);
  return (m, s) => new Promise((resolve) => { for (const f of listeners) if (f(m, s, (r) => resolve(structuredClone(r))) === true) return; resolve(null); });
};

test("Settings shows in a school page's frame only with a ticket Glaze's navigation got for that tab, once", async () => {
  const send = worker();
  const lms = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', tab: { id: 9 } };
  const frame = { id: 'glaze', frameId: 7, url: 'chrome-extension://glaze/options.html?t=x', tab: { id: 9 } };
  const nope = { ok: false };
  assert.deepEqual(await send({ type: 'glaze:settings-ticket' }, { ...lms, url: 'https://evil.example/' }), nope, 'a site Glaze does not run on');
  assert.deepEqual(await send({ type: 'glaze:settings-ticket' }, { ...lms, frameId: 3 }), nope, 'a frame of the page');
  assert.deepEqual(await send({ type: 'glaze:settings-ticket' }, { ...lms, id: 'other' }), nope, 'another extension');
  const { ok, ticket } = await send({ type: 'glaze:settings-ticket' }, lms);
  assert.equal(ok, true); assert.match(ticket, /^[0-9a-f]{32}$/);
  assert.deepEqual(await send({ type: 'glaze:settings-claim', ticket }, { ...frame, tab: { id: 10 } }), nope, 'another tab');
  assert.deepEqual(await send({ type: 'glaze:settings-claim', ticket }, { ...frame, url: 'https://evil.example/' }), nope, 'not Settings');
  assert.deepEqual(await send({ type: 'glaze:settings-claim', ticket }, { ...frame, frameId: 0 }), nope, 'a Settings tab needs none');
  assert.deepEqual(await send({ type: 'glaze:settings-claim', ticket: 'f'.repeat(32) }, frame), nope, 'a made-up ticket');
  assert.deepEqual(await send({ type: 'glaze:settings-claim', ticket }, frame), { ok: true });
  assert.deepEqual(await send({ type: 'glaze:settings-claim', ticket }, frame), nope, 'used once');
});

test('the page opens Settings with its ticket in a closed shadow root, and Settings hides until it claims it', () => {
  const page = read('features/settingspage.js'), options = read('options.js'), html = read('options.html');
  assert.match(page, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.match(page, /\$\{chrome\.runtime\.getURL\('options\.html'\)\}\?t=\$\{t\}/);
  assert.match(options, /type: 'glaze:settings-claim', ticket/);
  assert.match(html, /html\[data-embedded\]:not\(\[data-embed-ok\]\) body \{ visibility: hidden; \}/);
  for (const panel of ['sharing', 'mods', 'backup']) assert.ok(options.includes(`['${panel}',`), `${panel} opens in its own tab`);
});

test("Settings over the page leaves only it and Glaze's bar in reach, and gives focus back to what opened it", async () => {
  const { El } = require('./stand-in-dom.js');
  const doc = { activeElement: null };
  const html = new El('html', doc), body = new El('body', doc);
  doc.root = html; html.append(body);
  // The bar, in its open shadow root, draws its items again as Settings opens and closes (a hidden copy for phones).
  const bar = new El('div', doc), shadow = bar.attachShadow({ mode: 'open' });
  bar.id = 'gz-navbar';
  const item = (shown) => { const b = new El('button', doc); b.dataset.id = 'glaze:settings'; b.getClientRects = () => (shown ? [{}] : []); return b; };
  const draw = () => shadow.replaceChildren(item(false), item(true));
  draw();
  const main = new El('main', doc), own = new El('div', doc);
  own.inert = true;
  body.append(bar, main, own);
  doc.activeElement = bar; shadow.activeElement = shadow.children[1];
  Object.assign(doc, { documentElement: html, body, createElement: (tag) => new El(tag, doc), getElementById: (id) => (id === 'gz-navbar' ? bar : null) });
  const on = {};
  const page = vm.runInContext(read('features/settingspage.js'), vm.createContext({ document: doc, matchMedia: () => ({ matches: true }), CSS: { escape: String },
    history: { state: null, pushState(s) { this.state = s; }, back() {} }, addEventListener: (type, f) => { on[type] = f; }, removeEventListener: (type) => { delete on[type]; },
    chrome: { runtime: { id: 'glaze', getURL: (f) => `chrome-extension://glaze/${f}`, sendMessage: (m, reply) => reply({ ok: true, ticket: 'a'.repeat(32) }) } },
    GZ_NAVBAR_UI: { sync: draw } }));
  assert.equal(await page.open(), true);
  const settings = body.querySelector('#gz-settings-page');
  assert.equal(main.inert, true, 'the page it covers is out of Tab and screen-reader reach');
  assert.ok(!bar.inert && !settings.inert, "Settings and Glaze's bar stay in use");
  doc.activeElement = settings; // focus in its frame, as the document sees it
  on.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(main.inert, false);
  assert.equal(own.inert, true, 'what the page made inert itself stays so');
  assert.equal(doc.activeElement, shadow.children[1], "focus goes back to the bar's Settings item, drawn again");
  await page.open();
  doc.activeElement = bar; shadow.activeElement = new El('a', doc); // a place picked in the bar
  page.close();
  assert.equal(doc.activeElement, bar, 'leaving for a place in the bar keeps focus there');
});
