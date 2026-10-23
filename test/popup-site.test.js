// The popup's "Use Glaze on {host}" (popup.js): on a browser that asks for each site, the tab the popup opened over gets a
// one-click way in when it is an LMS Glaze can't run on yet. The real popup.js runs here against a stubbed chrome; its
// tiles never load (GZ_UI.load stays pending), so only the site row is exercised. The detector it runs in the tab is
// lib/detect.js's own (GZ_DETECT), loaded into the popup as the popup page loads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const { GZ_BUILT_IN } = require('../defaults.js');
const NARROW = ['https://*.instructure.com/*', 'https://*.blackboard.com/*', 'https://*.moodlecloud.com/*', 'https://frostdev.io/*', 'https://share.frostdev.io/*'];
// Objects made in the popup's context, as plain data.
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };

const popup = ({ url = 'https://bb.school.edu/ultra/stream', tabId = 7, hosts = NARROW, held = false, lists = {}, kind = 'ultra', enabled = true,
  hostAccess = true, granted = true, reply = { ok: true }, execFails = false } = {}) => {
  const elements = new Map();
  const el = (sel) => {
    if (!elements.has(sel)) elements.set(sel, {
      sel, textContent: '', hidden: true, dataset: {}, style: {}, handlers: {}, attributes: new Map(), classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      setAttribute(k, v) { this.attributes.set(k, String(v)); }, removeAttribute(k) { this.attributes.delete(k); }, getAttribute(k) { return this.attributes.get(k) ?? null; },
      toggleAttribute(k, on) { if (on) this.attributes.set(k, ''); else this.attributes.delete(k); },
      replaceChildren() {}, append() {}, focus() {}, querySelector: (s) => el(`${sel} ${s}`),
    });
    return elements.get(sel);
  };
  const calls = [], changed = new Set(), observed = [];
  let gesture = false, access = held;
  const local = { ...lists };
  const chrome = {
    runtime: {
      id: 'glaze', getManifest: () => ({ host_permissions: hosts, optional_host_permissions: ['https://*/*'] }), getURL: (p) => `chrome-extension://glaze/${p}`,
      sendMessage: (m) => { calls.push(['send', m, gesture]); return typeof reply === 'function' ? reply(m) : Promise.resolve(reply); }, lastError: null,
    },
    tabs: { query: async () => [{ id: tabId, url }], create() {} },
    permissions: {
      contains: async ({ origins }) => { calls.push(['contains', origins]); return access; },
      request: ({ origins }) => { calls.push(['request', origins, gesture]); if (granted) access = true; return Promise.resolve(granted); },
      ...(hostAccess ? { addHostAccessRequest: (o) => { calls.push(['hostAccess', o]); return Promise.resolve(); } } : {}),
    },
    scripting: { executeScript: (o) => { calls.push(['exec', o]); return execFails ? Promise.reject(new Error('Cannot access contents of the page')) : Promise.resolve([{ result: kind }]); } },
    storage: {
      local: { get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, local[k]])), getKeys: async () => Object.keys(local) },
      sync: { get: async () => (enabled === undefined ? {} : { enabled }) },
      onChanged: { addListener: (f) => changed.add(f) },
    },
  };
  const context = vm.createContext({
    chrome, URL, Promise, console, setTimeout, clearTimeout, matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: new URL('chrome-extension://glaze/popup.html'),
    MutationObserver: class { observe() { observed.push(true); } disconnect() {} },
    document: { contentType: 'text/html', querySelector: el, querySelectorAll: () => [], createElement: () => el(`new${elements.size}`), body: el('body'), documentElement: el('html'), addEventListener() {}, removeEventListener() {} },
    GZ_I18N: { page() {}, ui() {}, t: (k, vars = {}) => k.replace(/\{(\w+)\}/g, (_, v) => vars[v]) },
    GZ_UI: { load: () => new Promise(() => {}) },
    GZ_BUILT_IN,
  });
  context.window = context;
  context.globalThis = context;
  // As popup.html loads them.
  for (const f of ['lib/site.js', 'lib/detect.js', 'popup.js']) vm.runInContext(read(f), context, { filename: f });
  return {
    el, calls, observed, context, local,
    click: () => { gesture = true; try { el('#here').handlers.click?.({ isTrusted: true }); } finally { gesture = false; } },
    change: (c, area) => { for (const f of changed) f(c, area); },
    of: (type) => plain(calls.filter(([t]) => t === type)),
  };
};

test('popup: an LMS tab Glaze holds nothing for gets one button, and the request rides the click right after the worker hears', async () => {
  const p = popup();
  await tick();
  const row = p.el('#here');
  assert.equal(row.hidden, false, 'the row shows');
  assert.equal(row.textContent, 'Use Glaze on bb.school.edu');
  const [[, ran]] = p.calls.filter(([t]) => t === 'exec');
  assert.deepEqual(plain(ran.target), { tabId: 7 }, 'the detector runs in that tab, top frame only');
  assert.equal(ran.func, p.context.GZ_DETECT, 'the detector is lib/detect.js\'s own');
  assert.deepEqual(p.of('hostAccess').map(([, o]) => o), [{ tabId: 7 }], 'Chrome keeps an Allow entry for the tab in its menu');
  p.calls.length = 0;
  p.click();
  assert.deepEqual(p.calls.map(([t]) => t), ['send', 'request'], 'the worker first, then the browser\'s prompt, nothing between');
  assert.deepEqual(plain(p.calls[0][1]), { type: 'glaze:allow', op: 'ask', origin: 'https://bb.school.edu', kind: 'ultra', tabId: 7 });
  assert.deepEqual(plain(p.calls[1][1]), ['https://bb.school.edu/*']);
  assert.equal(p.calls[1][2], true, 'the request is made inside the click itself');
  await tick();
  assert.equal(row.hidden, false, 'the row stays until the worker has the site');
  p.local.ultra = ['https://bb.school.edu'];
  p.change({ ultra: { newValue: p.local.ultra } }, 'local');
  await tick();
  assert.equal(row.hidden, true, 'once the site is on its list, the popup is as normal');
});

test('popup: a dismissed prompt leaves the button ready to try again, and a second click while asking does nothing', async () => {
  const p = popup({ granted: false, url: 'https://canvas.school.edu/courses/3', kind: 'canvas' });
  await tick();
  p.calls.length = 0;
  p.click();
  p.click();
  assert.deepEqual(p.calls.map(([t]) => t), ['send', 'request']);
  await tick();
  p.calls.length = 0;
  p.click();
  assert.deepEqual(p.calls.map(([t]) => t), ['send', 'request'], 'refused, the student can ask again');
  assert.equal(p.calls[0][1].kind, 'canvas');
});

test('popup: a host already held but not on its LMS\'s list asks the worker only, with no browser prompt and no menu entry', async () => {
  const p = popup({ held: true, url: 'https://moodle.school.edu/my/', kind: 'moodle' });
  await tick();
  assert.equal(p.el('#here').hidden, false);
  assert.deepEqual(p.of('hostAccess'), []);
  p.calls.length = 0;
  p.click();
  await tick();
  assert.deepEqual(p.calls.map(([t]) => t), ['send']);
  assert.deepEqual(plain(p.calls[0][1]), { type: 'glaze:allow', op: 'ask', origin: 'https://moodle.school.edu', kind: 'moodle', tabId: 7 });
});

test('popup: nothing is added where Glaze already runs or where the tab is no LMS', async () => {
  const cases = [
    ['a held site on its LMS\'s list', { held: true, lists: { ultra: ['https://bb.school.edu'] } }, false],
    ['a held Canvas site on its list', { held: true, url: 'https://canvas.school.edu/courses/1', lists: { canvas: ['https://canvas.school.edu/*'] } }, false],
    ['a built-in host it holds', { held: true, url: 'https://school.instructure.com/courses/1' }, false],
    ['a page that is no LMS', { kind: null, url: 'https://www.school.edu/' }, true],
    ['a page the detector can\'t reach', { execFails: true }, true],
    ['an answer that is no LMS name', { kind: 'blackboard' }, true],
    ['a browser page', { url: 'chrome://extensions/' }, false],
    ['a plain http school page', { url: 'http://www.school.edu/' }, false],
    ['no address at all', { url: '' }, false],
    ['Safari\'s manifest, which holds every site', { hosts: ['<all_urls>'] }, false],
  ];
  for (const [why, o, detects] of cases) {
    const p = popup(o);
    await tick();
    assert.equal(p.el('#here').hidden, true, why);
    assert.equal(p.of('exec').length > 0, detects, `${why}: detector ${detects ? 'runs' : 'does not run'}`);
    assert.deepEqual(p.of('hostAccess'), [], `${why}: no menu entry`);
    assert.deepEqual(p.of('request'), [], why);
  }
});

test('popup: a list entry under another site, or an approval for another kind, does not hide the row', async () => {
  const p = popup({ held: true, lists: { ultra: ['https://other.school.edu'], canvas: ['https://bb.school.edu.evil.test/*'] } });
  await tick();
  assert.equal(p.el('#here').hidden, false);
});

test('popup: local Canvas on this computer is offered by its own origin', async () => {
  const p = popup({ url: 'http://localhost:3000/courses/1', kind: 'canvas' });
  await tick();
  assert.equal(p.el('#here').textContent, 'Use Glaze on localhost');
  p.calls.length = 0;
  p.click();
  assert.equal(p.calls[0][1].origin, 'http://localhost:3000');
  assert.deepEqual(plain(p.calls[1][1]), ['http://localhost/*']);
});

test('popup: Firefox has no addHostAccessRequest, and the row works without it', async () => {
  const p = popup({ hostAccess: false });
  await tick();
  assert.equal(p.el('#here').hidden, false);
  p.calls.length = 0;
  p.click();
  assert.deepEqual(p.calls.map(([t]) => t), ['send', 'request']);
});

test('popup: with Glaze off the row waits, and shows once Glaze is on', async () => {
  const p = popup({ enabled: false });
  await tick();
  assert.equal(p.el('#here').hidden, true);
  assert.deepEqual(p.of('hostAccess'), [], 'no menu entry while Glaze is off');
  p.change({ enabled: { newValue: true } }, 'sync');
  await tick();
  assert.equal(p.el('#here').hidden, false);
  assert.deepEqual(p.of('hostAccess').map(([, o]) => o), [{ tabId: 7 }]);
});

test('popup: the detector in the popup page itself watches nothing (lib/detect.js runs its watcher on web pages only)', async () => {
  const p = popup();
  await tick();
  assert.deepEqual(p.observed, []);
  assert.deepEqual(p.of('send').filter(([, m]) => typeof m === 'string'), [], 'and reports nothing');
});

test('lib/detect.js\'s check is self-contained, so the popup can hand it to executeScript', () => {
  const sandbox = { location: new URL('chrome-extension://glaze/popup.html'), document: { contentType: 'text/html' }, MutationObserver: class { observe() {} disconnect() {} } };
  vm.runInNewContext(read('lib/detect.js'), sandbox);
  const src = sandbox.GZ_DETECT.toString();
  const el = (hit) => ({ matches: (s) => s.split(', ').some((x) => x === hit) });
  const CANVAS = 'link[rel~="stylesheet"][href*="/dist/brandable_css/"]', ULTRA = 'base[href*="/ultra/"]', MOODLE = 'meta[name="keywords"][content^="moodle,"]';
  const page = (url, hit, body = { matches: () => false }, glazed = false) => vm.runInNewContext(`(${src})()`, {
    location: new URL(url), window: { __gzGlaze: glazed },
    document: { head: { querySelector: () => (hit ? el(hit) : null) }, body },
  });
  assert.equal(page('https://canvas.school.edu/', CANVAS), 'canvas');
  assert.equal(page('https://bb.school.edu/ultra/stream', ULTRA), 'ultra');
  assert.equal(page('https://bb.school.edu/webapps/login', ULTRA), null, 'Ultra only on an /ultra page');
  assert.equal(page('https://moodle.school.edu/my/', MOODLE, { matches: (s) => s.includes('pagelayout-') }), 'moodle');
  assert.equal(page('https://www.school.edu/', MOODLE), null, 'Moodle\'s meta alone is not Moodle');
  assert.equal(page('https://www.school.edu/', null), null);
  assert.equal(page('https://canvas.school.edu/', CANVAS, undefined, true), null, 'Glaze already in the page');
  assert.ok(fs.statSync(path.join(root, 'lib/detect.js')).size < 2048);
});

test('popup.html loads the site parser and the detector before popup.js, and has the row at the top', () => {
  const html = read('popup.html');
  const at = (s) => html.indexOf(s);
  assert.ok(at('<script src="lib/site.js"></script>') > 0 && at('<script src="lib/detect.js"></script>') > 0);
  assert.ok(at('<script src="lib/site.js"></script>') < at('<script src="popup.js"></script>'));
  assert.ok(at('<script src="lib/detect.js"></script>') < at('<script src="popup.js"></script>'));
  assert.match(html, /<header class="top">[\s\S]*?<\/header>\s*<button type="button" id="here" class="primary here" hidden><\/button>\s*<main class="tiles">/);
});


test('popup: a late failed worker reply or lost channel leaves a granted button ready to retry', async () => {
  for (const rejected of [false, true]) {
    let answer, fail;
    const reply = new Promise((resolve, reject) => { answer = resolve; fail = reject; });
    const p = popup({ reply });
    await tick();
    p.click();
    await tick();
    assert.equal(p.el('#here').getAttribute('aria-disabled'), 'true', 'wait for the worker while the popup remains open');
    if (rejected) fail(Error('Message port closed')); else answer({ ok: false });
    await tick();
    assert.equal(p.el('#here').getAttribute('aria-disabled'), null);
    assert.equal(p.el('#here').hidden, false);
    p.calls.length = 0;
    p.click();
    assert.deepEqual(p.calls.map(([t]) => t), ['send', 'request']);
  }
});

test('popup: regranting a listed site hides the row without needing a storage change', async () => {
  let answer;
  const p = popup({ lists: { ultra: ['https://bb.school.edu'] }, reply: new Promise((resolve) => { answer = resolve; }) });
  await tick();
  assert.equal(p.el('#here').hidden, false, 'listed but no host permission');
  p.click();
  await tick();
  assert.equal(p.el('#here').hidden, false, 'the worker has not answered yet');
  answer({ ok: true });
  await tick();
  assert.equal(p.el('#here').hidden, true, 'already listed, so approve writes no list change');
});

test('popup: approval may arrive before a late worker reply', async () => {
  let answer;
  const p = popup({ reply: new Promise((resolve) => { answer = resolve; }) });
  await tick();
  p.click();
  p.local.ultra = ['https://bb.school.edu'];
  p.change({ ultra: { newValue: p.local.ultra } }, 'local');
  await tick();
  assert.equal(p.el('#here').hidden, true);
  answer({ ok: true });
  await tick();
  assert.equal(p.el('#here').hidden, true);
});

test('popup: dismissing the prompt readies the button even while the worker is still answering', async () => {
  const p = popup({ granted: false, reply: new Promise(() => {}) });
  await tick();
  p.click();
  await tick();
  assert.equal(p.el('#here').getAttribute('aria-disabled'), null);
  p.calls.length = 0;
  p.click();
  assert.deepEqual(p.calls.map(([t]) => t), ['send', 'request']);
});
