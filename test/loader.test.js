// Code on demand: content.js need() asks lib/background.js ('glaze:load'), which runs allowlisted files in the
// asking frame only. These tests hold the allowlist and the frame targeting, and check that what is loaded this way
// survives being loaded twice and isn't also in the first content script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = require('../manifest.json');
const settle = () => new Promise(setImmediate);
const ID = 'glaze-test-id';

// The worker with Chrome stubbed: every onMessage listener, and the executeScript calls it makes.
const worker = (execute = () => Promise.resolve([{ result: {} }]), protocol = 'chrome-extension:') => {
  const listeners = [];
  const injected = [], asked = [];
  const none = { addListener() {} };
  const area = { get: () => Promise.resolve({}), set: () => Promise.resolve() };
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    importScripts: (file) => vm.runInContext(read(path.join('lib', file)), context),
    chrome: {
      runtime: {
        id: ID, getURL: (p = '') => `${protocol}//${ID}/${p}`, getManifest: () => manifest,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none,
      },
      storage: { local: area, sync: area, onChanged: none },
      scripting: { executeScript: (o) => { if (o.files) injected.push(JSON.parse(JSON.stringify(o))); else asked.push(JSON.parse(JSON.stringify({ ...o, func: String(o.func) }))); return execute(o); } },
    },
  });
  vm.runInContext(read('lib/background.js'), context, { filename: 'lib/background.js' });
  const send = async (message, sender) => {
    let reply;
    for (const f of listeners) f(message, sender, (r) => { reply = JSON.parse(JSON.stringify(r)); });
    await settle();
    return reply;
  };
  return { send, injected, asked };
};
const tab = (frameId = 3) => ({ id: ID, tab: { id: 7 }, frameId, url: 'https://school.instructure.com/courses/1' });

test('an allowlisted file runs in the asking frame only, and the reply waits for it', async () => {
  const w = worker();
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, tab(3)), { ok: true });
  assert.deepEqual(w.injected, [{ target: { tabId: 7, frameIds: [3] }, files: ['lib/zip.js'], injectImmediately: true }]);
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['i18n/de.js'] }, tab(0)), { ok: true });
  assert.deepEqual(w.injected[1].target, { tabId: 7, frameIds: [0] });
});

test('anything off the list, or from outside a tab of this extension, runs nothing', async () => {
  const w = worker();
  const refuse = { ok: false, error: 'not loadable' };
  for (const files of [['content.js'], ['lib/background.js'], ['../manifest.json'], ['lib/zip.js', 'content.js'], ['https://example.com/x.js'],
    ['/lib/zip.js'], ['lib/zip.js?x'], [], 'lib/zip.js', undefined, [{ toString: () => 'lib/zip.js' }]]) {
    assert.deepEqual(await w.send({ type: 'glaze:load', files }, tab()), refuse, JSON.stringify(files));
  }
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { ...tab(), id: 'another-extension' }), refuse);
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { id: ID, url: `chrome-extension://${ID}/popup.html` }), refuse, 'no tab');
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { ...tab(), frameId: undefined }), refuse, 'no frame');
  assert.deepEqual(w.injected, []);
});

test('the document that asked is the target where the browser names it, so a navigated frame gets nothing', async () => {
  const w = worker();
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { ...tab(3), documentId: 'DOC-A' }), { ok: true });
  assert.deepEqual(w.injected[0].target, { tabId: 7, documentIds: ['DOC-A'] });
  const gone = worker(() => Promise.reject(new Error('No document with id DOC-A in tab 7.')));
  assert.deepEqual(await gone.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { ...tab(3), documentId: 'DOC-A' }), { ok: false, error: 'No document with id DOC-A in tab 7.' });
});

test('without a document id, a frame that now holds another document gets nothing', async () => {
  // The frame's own answer: is content.js's docId for this document the one in the request?
  const frame = (doc) => (o) => Promise.resolve([{ result: o.func ? o.args[0] === doc : {} }]);
  const moved = worker(frame('DOC-B'));
  assert.deepEqual(await moved.send({ type: 'glaze:load', files: ['lib/zip.js'], doc: 'DOC-A' }, tab(3)), { ok: false, error: 'the frame holds another document now' });
  assert.deepEqual(moved.injected, []);
  assert.deepEqual(moved.asked.map((a) => [a.target, a.args]), [[{ tabId: 7, frameIds: [3] }, ['DOC-A']]]);
  const stayed = worker(frame('DOC-A'));
  assert.deepEqual(await stayed.send({ type: 'glaze:load', files: ['lib/zip.js'], doc: 'DOC-A' }, tab(3)), { ok: true });
  assert.equal(stayed.injected.length, 1);
  // With a document id there is nothing to ask.
  const named = worker(frame('DOC-A'));
  await named.send({ type: 'glaze:load', files: ['lib/zip.js'] }, { ...tab(3), documentId: 'D1' });
  assert.deepEqual(named.asked, []);
});

test('success means the file ran to its end: an injection that fails, throws or stops short is reported', async () => {
  const send = (execute, protocol) => worker(execute, protocol).send({ type: 'glaze:load', files: ['lib/drafts.js'] }, tab());
  assert.deepEqual(await send(() => Promise.reject(new Error('Frame with ID 3 was removed.'))), { ok: false, error: 'Frame with ID 3 was removed.' });
  // Chrome: a file that throws leaves no last value. Firefox reports the error.
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3, result: null }])), { ok: false, error: 'did not finish' });
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3 }])), { ok: false, error: 'did not finish' });
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3, error: new Error('boom') }])), { ok: false, error: 'boom' });
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3, result: { worth() {} } }])), { ok: true });
  // Safari: its results for files aren't relied on; content.js checks the module itself.
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3 }]), 'safari-web-extension:'), { ok: true });
});

// What a feature file reads from content.js when it loads (features/*.js).
const CTX = { t: (k) => k, locale: () => 'en', capi() {}, canvasCourses() {}, canvasCourseId() {}, need() {}, settings: () => ({}), site: 'canvas', wordsIn: new Set() };
// What a feature file touches as it loads: the listeners it adds (features/keys.js, coursemenu.js, previews.js).
const page = () => ({ document: { addEventListener() {} }, addEventListener() {}, GZ_COLOR: {} });
// Moved out of the first content script in W0c: the palette, the keys, the course menu, the previews and Download all.
const W0C = [['features/palette.js', 'GZ_CMD'], ['features/keys.js', 'GZ_KEYS'], ['features/coursemenu.js', 'GZ_COURSE_MENU'], ['features/previews.js', 'GZ_PEEK'], ['features/download.js', 'GZ_DOWNLOAD']];
test('every loadable file ends on a value, which is how the worker knows it ran', () => {
  for (const f of ['lib/zip.js', 'lib/drafts.js', 'lib/gradecalc.js', 'features/grades.js', 'i18n/de.js', 'lib/cards.js', 'lib/seek.js', 'features/search.js', ...W0C.map(([f]) => f)]) {
    const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, Blob: class {}, btoa, atob, GZ_CTX: CTX, ...page() });
    assert.ok(vm.runInContext(read(f), context), `${f}: no last value`);
  }
});

test('every loadable file exists, is left out of the first content script, and is what content.js asks for', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const first = manifest.content_scripts[0].js;
  for (const f of list) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
    assert.ok(!first.includes(f), `${f} is loaded on demand, not with every page`);
  }
  const asked = [...read('content.js').matchAll(/\bneed\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(asked.length >= 2);
  for (const f of asked) assert.ok(list.includes(f), `content.js needs ${f}, which LOADABLE doesn't list`);
  // The options preview runs content.js from a page, not as a content script: it has them as <script> tags.
  for (const f of ['lib/zip.js', 'lib/drafts.js']) assert.ok(read('preview.html').includes(`<script src="${f}"></script>`), `preview.html: ${f}`);
});

// A loaded file's `var GZ_X` shares the frame's global scope with the first script's `const`s: the same name there
// (defaults.js has GZ_PALETTE) makes the file throw as it loads.
test('no loadable file declares a name the first content script already declares', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const names = (src) => [...src.matchAll(/^(?:const|let|var|function|class)\s+([\w$]+)/gm)].map((m) => m[1]);
  const first = new Set(manifest.content_scripts[0].js.flatMap((f) => names(read(f))));
  for (const f of list) for (const n of names(read(f))) assert.ok(!first.has(n), `${f} declares ${n}, which the first content script has`);
});

test('a file loaded twice into one frame keeps the first', () => {
  for (const [file, name] of [['lib/zip.js', 'GZ_ZIP'], ['lib/drafts.js', 'GZ_DRAFTS'], ['lib/gradecalc.js', 'GZ_GRADECALC'], ['features/grades.js', 'GZ_GRADES_UI'], ['lib/cards.js', 'GZ_CARDS'], ['lib/seek.js', 'GZ_SEEK'], ['features/search.js', 'GZ_SEARCH'], ...W0C]) {
    const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, Blob: class {}, btoa, atob, GZ_CTX: CTX, ...page() });
    vm.runInContext('globalThis.globalThis = this;', context);
    vm.runInContext(read(file), context);
    const first = vm.runInContext(name, context);
    vm.runInContext(read(file), context);
    assert.equal(vm.runInContext(name, context), first, file);
  }
});

test('words asked for in a language still loading are not remembered as English', () => {
  const context = vm.createContext({ Intl, chrome: undefined, navigator: { language: 'en' } });
  vm.runInContext(read('lib/i18n.js'), context);
  const t = (tag) => vm.runInContext(`GZ_I18N.t('Restore', {}, ${JSON.stringify(tag)})`, context);
  assert.equal(t('de'), 'Restore');
  vm.runInContext(read('i18n/de.js'), context);
  assert.equal(t('de'), vm.runInContext('GZ_LANGS.de.Restore', context));
  assert.notEqual(t('de'), 'Restore');
});
