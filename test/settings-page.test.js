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
  assert.match(page, /\$\{chrome\.runtime\.getURL\(PAGES\.settings\)\}\?t=\$\{pass\}\$\{hash\}/);
  assert.match(page, /const PAGES = \{ settings: 'options\.html', papers: 'papers\.html' \};/);
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

// The tab's history as a browser keeps it: entries, the current one, popstate on traversal (at once, here).
const tabHistory = (on) => {
  const entries = [null];
  let at = 0;
  return {
    entries, get at() { return at; }, get state() { return entries[at]; },
    pushState(st) { entries.splice(at + 1); entries.push(structuredClone(st)); at++; },
    replaceState(st) { entries[at] = structuredClone(st); },
    go(n) { at = Math.max(0, Math.min(entries.length - 1, at + n)); on.popstate?.(); },
    back() { this.go(-1); },
  };
};
const tick = () => new Promise((r) => setTimeout(r, 5));

test("Documents opens beside the bar as Settings does: a pass for each document over a channel the page can't hear, its documents in the tab's history, and Back, Forward, Close, Escape and Settings", async () => {
  const { El } = require('./stand-in-dom.js');
  const doc = { activeElement: null };
  const html = new El('html', doc), body = new El('body', doc);
  doc.root = html; html.append(body);
  const bar = new El('div', doc); bar.id = 'gz-navbar'; bar.attachShadow({ mode: 'open' });
  const main = new El('main', doc);
  body.append(bar, main);
  Object.assign(doc, { documentElement: html, body, createElement: (tag) => new El(tag, doc), getElementById: (id) => (id === 'gz-navbar' ? bar : null) });
  const on = {}, sent = [], ports = [];
  let synced = 0;
  const history = tabHistory(on);
  const page = vm.runInContext(read('features/settingspage.js'), vm.createContext({ document: doc, matchMedia: () => ({ matches: true }), CSS: { escape: String }, crypto, MessageChannel, history,
    addEventListener: (type, f) => { on[type] = f; }, removeEventListener: (type) => { delete on[type]; },
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, sendMessage: (m, reply) => {
      sent.push(m);
      const r = m.type === 'glaze:settings-ticket' ? { ok: true, ticket: 'a'.repeat(32) } : { ok: true };
      if (reply) { reply(r); return undefined; }
      return Promise.resolve(r);
    } } },
    GZ_NAVBAR_UI: { sync: () => synced++ } }));
  const frameOf = () => body.querySelector('#gz-settings-page')?.shadowForTest.children[0] || null;
  // The frame's window: what Glaze's page posts it, and the frame's own end of each channel.
  const windowOf = (f) => { const got = []; f.contentWindow = { postMessage: (m, origin, transfer) => { got.push({ m, origin, transfer }); if (transfer?.[0]) ports.push(transfer[0]); } }; return got; };
  const heard = (port) => { const got = []; port.onmessage = ({ data }) => got.push(data); return got; };
  try {
    assert.equal(await page.open('', 'papers'), true);
    const jobs = () => sent.filter((m) => m.type === 'glaze:papers' && m.op === 'job');
    assert.equal(jobs().length, 1, 'a pass, before the frame opens');
    let f = frameOf();
    assert.equal(f.src, 'chrome-extension://glaze/papers.html', 'no pass or ticket in its address');
    assert.equal(page.showing(), 'papers');
    assert.equal(main.inert, true, 'the page it covers is out of reach');
    assert.deepEqual(history.state, { gzSettings: 1, gzPage: 'papers' });
    let posted = windowOf(f);
    // Only the frame's own hello, from Glaze's origin, gets the pass.
    on.message({ source: {}, origin: 'chrome-extension://glaze', data: { type: 'glaze:papers:hello' } });
    on.message({ source: f.contentWindow, origin: 'https://school.instructure.com', data: { type: 'glaze:papers:hello' } });
    await tick();
    assert.equal(posted.length, 0);
    on.message({ source: f.contentWindow, origin: 'chrome-extension://glaze', data: { type: 'glaze:papers:hello' } });
    await tick();
    assert.equal(posted.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify([posted[0].m, posted[0].origin, posted[0].transfer.length])), [{ type: 'glaze:papers', pass: jobs()[0].pass }, 'chrome-extension://glaze', 1]);
    let port = ports.at(-1), told = heard(port);
    port.postMessage({ type: 'opened', at: '' });
    await tick();
    assert.equal(history.entries.length, 2, 'the list it opened at adds nothing');
    // A document opened in place: the tab's entry, which names it only by its place here.
    port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' });
    await tick();
    assert.equal(history.entries.length, 3);
    assert.deepEqual(history.state, { gzSettings: 2, gzPage: 'papers', gzAt: 0 });
    history.back();
    await tick();
    assert.deepEqual(told.at(-1), { type: 'go', at: '' }, 'Back: the list');
    assert.equal(page.showing(), 'papers');
    history.go(1);
    await tick();
    assert.deepEqual(told.at(-1), { type: 'go', at: '?paper=doc%3Aabc' }, 'Forward: the document');
    // The frame's next document says hello, and gets a pass of its own.
    on.message({ source: f.contentWindow, origin: 'chrome-extension://glaze', data: { type: 'glaze:papers:hello' } });
    await tick();
    assert.equal(jobs().length, 2);
    assert.equal(posted.at(-1).m.pass, jobs()[1].pass);
    assert.notEqual(jobs()[1].pass, jobs()[0].pass);
    port = ports.at(-1); told = heard(port);
    port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' });
    await tick();
    assert.equal(history.entries.length, 3, 'where the entry says it is');
    // Back, then Forward before the list has loaded: the Forward goes to the document going away and is lost. The list
    // that loads isn't where history says, and no click took it there: it is sent on, and no entry is added.
    history.back();
    await tick();
    assert.deepEqual(told.at(-1), { type: 'go', at: '' });
    port.close();
    history.go(1);
    await tick();
    on.message({ source: f.contentWindow, origin: 'chrome-extension://glaze', data: { type: 'glaze:papers:hello' } });
    await tick();
    port = ports.at(-1); told = heard(port);
    port.postMessage({ type: 'opened', at: '' });
    await tick();
    assert.deepEqual(told, [{ type: 'go', at: '?paper=doc%3Aabc' }], 'sent on to the document');
    assert.equal(history.entries.length, 3, 'no entry for it');
    port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' });
    await tick();
    // A frame that can't get where it's sent (a document deleted since shows the list) is sent once more, then the entry
    // says where it is: nothing loops, nothing is added.
    history.back();
    await tick();
    for (let i = 0; i < 5; i++) { port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' }); await tick(); }
    assert.deepEqual(told.filter((m) => m.type === 'go'), [{ type: 'go', at: '?paper=doc%3Aabc' }, { type: 'go', at: '' }, { type: 'go', at: '' }]);
    assert.equal(history.entries.length, 3);
    assert.deepEqual([history.at, history.state.gzSettings, history.state.gzPage, typeof history.state.gzAt], [1, 1, 'papers', 'number']);
    history.go(1);
    await tick();
    port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' });
    await tick();
    // A link in the frame, after all that: an entry of its own.
    port.postMessage({ type: 'opened', at: '?paper=doc%3Adef' });
    await tick();
    assert.equal(history.entries.length, 4);
    history.back();
    await tick();
    port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' });
    await tick();
    assert.equal(history.entries.length, 4);
    // Close (the frame's leave): back past every entry it added, the page in reach again.
    port.postMessage({ type: 'leave' });
    await tick();
    assert.equal(page.showing(), '');
    assert.equal(history.at, 0, 'the tab is back where it was');
    assert.equal(main.inert, false);
    assert.equal(body.querySelector('#gz-settings-page'), null);

    // Settings, then Documents from the bar: one page in place of the other, as a page of its own in the tab's history.
    assert.equal(await page.open('navigation/bar'), true);
    assert.match(frameOf().src, /^chrome-extension:\/\/glaze\/options\.html\?t=a{32}#navigation\/bar$/);
    const entries = history.entries.length;
    assert.equal(await page.open('', 'papers'), true);
    assert.equal(page.showing(), 'papers');
    assert.equal(frameOf().src, 'chrome-extension://glaze/papers.html');
    assert.equal(history.entries.length, entries + 1);
    assert.deepEqual(history.state, { gzSettings: 2, gzPage: 'papers' });
    assert.equal(body.querySelectorAll('#gz-settings-page').length, 1);
    assert.equal(body.querySelector('#gz-settings-page').shadowForTest.children.length, 1, 'one frame');
    history.back();
    await tick();
    assert.equal(page.showing(), 'settings', 'Back: Settings again');
    assert.match(frameOf().src, /^chrome-extension:\/\/glaze\/options\.html\?t=a{32}$/);
    history.go(1);
    await tick();
    assert.equal(page.showing(), 'papers', 'Forward: Documents');
    // A document in it, then Settings from the bar; Back is that document again.
    f = frameOf(); posted = windowOf(f);
    on.message({ source: f.contentWindow, origin: 'chrome-extension://glaze', data: { type: 'glaze:papers:hello' } });
    await tick();
    port = ports.at(-1);
    port.postMessage({ type: 'opened', at: '?paper=doc%3Aabc' });
    await tick();
    assert.equal(history.state.gzSettings, 3);
    await page.open('');
    assert.deepEqual([page.showing(), history.state.gzSettings, history.state.gzPage, 'gzAt' in history.state], ['settings', 4, 'settings', false]);
    history.back();
    await tick();
    assert.equal(page.showing(), 'papers');
    assert.equal(frameOf().src, 'chrome-extension://glaze/papers.html?paper=doc%3Aabc');
    // Escape in the page leaves, back past every entry it added.
    on.keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(page.showing(), '');
    assert.equal(history.at, 0);
    // Back to before it opened leaves without going back further.
    await page.open('', 'papers');
    history.back();
    assert.equal(page.showing(), '');
    assert.equal(history.at, 0);
    assert.ok(synced > 0, "the bar draws where you are");
  } finally {
    for (const p of ports) p.close();
  }
});

test("a pass the worker refuses opens nothing in the page, so the bar and Ctrl+K open Documents' own tab", async () => {
  const { El } = require('./stand-in-dom.js');
  const doc = { activeElement: null };
  const html = new El('html', doc), body = new El('body', doc);
  doc.root = html; html.append(body);
  Object.assign(doc, { documentElement: html, body, createElement: (tag) => new El(tag, doc), getElementById: () => null });
  const page = vm.runInContext(read('features/settingspage.js'), vm.createContext({ document: doc, matchMedia: () => ({ matches: true }), CSS: { escape: String }, crypto, MessageChannel,
    history: tabHistory({}), addEventListener() {}, removeEventListener() {},
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, sendMessage: async () => ({ ok: false }) } } }));
  assert.equal(await page.open('', 'papers'), false);
  assert.equal(body.querySelector('#gz-settings-page'), null);
  assert.equal(await page.open('', 'nowhere'), false);
});
