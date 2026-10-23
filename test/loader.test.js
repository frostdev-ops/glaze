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
const worker = (execute = (o) => Promise.resolve([{ result: /typeof GZ_I18N|window\.__gzGlaze/.test(String(o.func)) ? false : true }]), protocol = 'chrome-extension:', local = {}) => {
  const listeners = [];
  const injected = [], asked = [];
  const none = { addListener() {} };
  const area = { get: (k) => Promise.resolve(Object.fromEntries([].concat(k ?? []).filter((x) => x in local).map((x) => [x, local[x]]))), set: () => Promise.resolve() };
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout,
    importScripts: (file) => vm.runInContext(read(path.join('lib', file)), context),
    chrome: {
      runtime: {
        id: ID, getURL: (p = '') => `${protocol}//${ID}/${p}`, getManifest: () => manifest,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none,
      },
      storage: { local: area, sync: area, onChanged: none },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: (o) => { if (o.files) injected.push(JSON.parse(JSON.stringify(o))); else asked.push(JSON.parse(JSON.stringify({ ...o, func: String(o.func) }))); return execute(o); } },
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

test('a Canvas page found by the detector gets Glaze in that page, not whatever its tab has gone on to', async () => {
  const w = worker(undefined, undefined, { canvas: ['https://canvas.school.edu/*'] }); // a site the student approved (WP-C2)
  w.send('canvas', { id: ID, tab: { id: 7 }, frameId: 0, url: 'https://canvas.school.edu/courses/1', documentId: 'doc-1' });
  await settle();
  assert.deepEqual(w.injected[0].target, { tabId: 7, documentIds: ['doc-1'] });
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
  const send = (execute, protocol) => worker(execute, protocol).send({ type: 'glaze:load', files: ['lib/drafts.js'] }, { ...tab(), documentId: 'A' });
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
const CTX = { placeAsked: () => 0, t: (k) => k, locale: () => 'en', capi() {}, canvasCourses() {}, canvasCourseId() {}, need() {}, settings: () => ({}), site: 'canvas', wordsIn: new Set() };
// What a feature file touches as it loads: the listeners it adds (features/keys.js, coursemenu.js, previews.js).
const page = () => ({ document: { addEventListener() {}, documentElement: {} }, location: { pathname: '/host' }, addEventListener() {}, GZ_COLOR: {}, IntersectionObserver: class {} });
// Moved out of the first content script in W0c: the palette, the keys, the course menu, the previews and Download all.
// W0d: the draft backup, the document buttons and your place in a course (Ultra's what-if is features/grades.js since B4).
const W0C = [['features/palette.js', 'GZ_CMD'], ['features/keys.js', 'GZ_KEYS'], ['features/coursemenu.js', 'GZ_COURSE_MENU'], ['features/previews.js', 'GZ_PEEK'], ['features/download.js', 'GZ_DOWNLOAD'],
  ['features/drafts.js', 'GZ_DRAFT_UI'], ['features/docs.js', 'GZ_DOCS'], ['features/place.js', 'GZ_PLACE'],
  ['lib/gpa.js', 'GZ_GPA'], ['features/gpaterms.js', 'GZ_GPA_TERMS'], ['lib/doctext.js', 'GZ_DOCTEXT']];
// Syllabus import (W15): its extractors and the page's part (lib/doctext.js is listed above).
const W15 = [['lib/syllabus.js', 'GZ_SYLLABUS'], ['features/syllabus.js', 'GZ_SYL_UI']];
// Insights (W17).
const W17 = [['lib/insights.js', 'GZ_INSIGHTS'], ['features/insights.js', 'GZ_INSIGHTS_UI']];
test('every loadable file ends on a value, which is how the worker knows it ran', () => {
  for (const f of ['lib/zip.js', 'lib/drafts.js', 'lib/gradecalc.js', 'features/grades.js', 'i18n/de.js', 'lib/cards.js', 'lib/seek.js', 'features/search.js', 'lib/widgets.js', 'features/widgets.js', ...W0C.map(([f]) => f), ...W15.map(([f]) => f), ...W17.map(([f]) => f), 'lib/classes.js', 'features/classes.js', 'lib/ics.js', 'lib/doctext.js', 'content-ultra.js', 'content-canvas.js']) {
    const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, Blob: class {}, btoa, atob, GZ_CTX: CTX, GZ_SPEC: {}, ...page() });
    assert.ok(vm.runInContext(read(f), context), `${f}: no last value`);
  }
});

// Each site's first content script: Ultra's and Canvas's from the manifest; Moodle's is Canvas's without its part, as
// lib/background.js registers it. A site's part is loadable too, for a page whose list lacks it, and only there.
const firstScripts = () => {
  const entry = (pattern) => manifest.content_scripts.find((c) => c.matches.includes(pattern)).js;
  const canvas = entry('https://*.instructure.com/*');
  return [entry('https://*/ultra'), canvas, canvas.filter((f) => f !== 'content-canvas.js')];
};
const PARTS = ['content-ultra.js', 'content-canvas.js', 'lib/nav.js']; // Ultra's first-paint schema travels with its part on other registered hosts.
test('every loadable file exists, is left out of the first content script, and is what content.js asks for', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  for (const f of list) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
    for (const first of firstScripts()) assert.ok(!first.includes(f) || PARTS.includes(f), `${f} is loaded on demand, not with every page`);
  }
  for (const f of PARTS) assert.ok(list.includes(f) && firstScripts().some((first) => !first.includes(f)), `${f}: loadable where its site's list lacks it`);
  const asked = [...read('content.js').matchAll(/\bneed\('([^']+)'/g), ...['content-ultra.js', 'content-canvas.js'].flatMap((p) => [...read(p).matchAll(/\bneed\('([^']+)'/g)])].map((m) => m[1]);
  assert.ok(asked.length >= 2);
  for (const f of asked) assert.ok(list.includes(f), `content.js needs ${f}, which LOADABLE doesn't list`);
  // content.js asks for a missing part by the site's name.
  assert.match(read('content.js'), /need\(`content-\$\{site\}\.js`/);
  // Only the Ultra preview loads its real runtime; Canvas/Moodle use the bootstrap's site-specific painters.
  for (const f of ['lib/zip.js', 'lib/drafts.js', 'lib/editor-preview.js']) assert.ok(read('preview.html').includes(`<script src="${f}"></script>`), `preview.html: ${f}`);
  const bootstrap = read('lib/editor-preview.js').split("if (site === 'ultra') {")[1]?.split('} else {')[0];
  const files = JSON.parse(bootstrap?.match(/for \(const file of (\[[^\]]+\])\) await load\(file\)/)?.[1].replace(/'/g, '"') || '[]');
  assert.ok(files.includes('content-ultra.js') && files.includes('content.js'), 'Ultra runtime is loaded');
  assert.ok(files.indexOf('content-ultra.js') < files.indexOf('content.js'), 'the part before content.js');
  // need() refuses in the preview, so every feature a Look's parts bring in must be loaded here (rules were missing once).
  for (const f of ['features/nav.js', 'features/motionx.js', 'features/rules.js']) assert.ok(files.includes(f), `the Ultra preview loads ${f}`);
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `preview runtime: ${f}`);
});

// A loaded file's `var GZ_X` shares the frame's global scope with the first script's `const`s: the same name there
// (defaults.js has GZ_PALETTE) makes the file throw as it loads.
test('no loadable file declares a name the first content script already declares', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const names = (src) => [...src.matchAll(/^(?:const|let|var|function|class)\s+([\w$]+)/gm)].map((m) => m[1]);
  for (const files of firstScripts()) {
    const first = new Set(files.flatMap((f) => names(read(f))));
    for (const f of list.filter((x) => !files.includes(x))) for (const n of names(read(f))) assert.ok(!first.has(n), `${f} declares ${n}, which the first content script has`);
  }
});

// B0b: a site's part (content-ultra.js, content-canvas.js) returns what it does over content.js's defaults (X). A name
// content.js has no default for would never be called; a default content.js never calls is dead.
test('each site\'s part returns only what content.js calls, and content.js calls every default it has', () => {
  const src = read('content.js');
  const X = vm.runInNewContext(`${src.match(/^ {2}const no = .*\n {2}const X = \{[\s\S]*?\};$/m)[0]} X`, {});
  for (const k of Object.keys(X).filter((x) => x !== 'ctx')) assert.match(src, new RegExp(`\\bX\\.${k}\\b`), `content.js never calls X.${k}`);
  // The part's own helpers are in GZ_CTX on every site, asked of the part when called (it may come late).
  const forwarded = src.match(/\.\.\.Object\.fromEntries\((\[[^\]]*\])\.map\(\(k\) => \[k, \(\.\.\.a\) => X\.ctx\[k\]\(\.\.\.a\)\]\)\) \}\);/);
  assert.ok(forwarded, 'GZ_CTX forwards the part\'s helpers');
  const keys = JSON.parse(forwarded[1].replace(/'/g, '"'));
  for (const [file, name] of [['content-ultra.js', 'GZ_SITE_ULTRA'], ['content-canvas.js', 'GZ_SITE_CANVAS']]) {
    const context = vm.createContext({ document: { addEventListener() {}, querySelectorAll: () => [] }, addEventListener() {}, IntersectionObserver: class { observe() {} }, MutationObserver: class { observe() {} }, chrome: { storage: { onChanged: { addListener() {} } } }, window: {}, location: { origin: 'https://school.test' } });
    context.globalThis = context;
    const make = vm.runInContext(read(file), context);
    assert.equal(make, vm.runInContext(name, context));
    // content.js's helpers and state, as the part reads them as it is made: nothing is called yet.
    const I = new Proxy({}, { get: (_, k) => (k === 'settings' ? { nav: { brand: 'glaze' }, enhance: {}, courses: { names: {} } } : () => {}) });
    const part = make(I);
    for (const k of Object.keys(part)) assert.ok(k in X, `${file} returns ${k}, which content.js has no default for`);
    for (const k of Object.keys(part.ctx)) assert.ok(keys.includes(k), `${file}'s ${k} isn't in GZ_CTX`);
  }
});

test('a file loaded twice into one frame keeps the first', () => {
  for (const [file, name] of [['lib/zip.js', 'GZ_ZIP'], ['lib/drafts.js', 'GZ_DRAFTS'], ['lib/gradecalc.js', 'GZ_GRADECALC'], ['features/grades.js', 'GZ_GRADES_UI'], ['lib/cards.js', 'GZ_CARDS'], ['lib/seek.js', 'GZ_SEEK'], ['features/search.js', 'GZ_SEARCH'], ['lib/widgets.js', 'GZ_WIDGETS'], ['features/widgets.js', 'GZ_WIDGETS_UI'], ...W0C, ...W15, ['content-ultra.js', 'GZ_SITE_ULTRA'], ['content-canvas.js', 'GZ_SITE_CANVAS']]) {
    const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, Blob: class {}, btoa, atob, GZ_CTX: CTX, GZ_SPEC: {}, ...page() });
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

test('a fallback probe must positively identify the document and pins its returned document id', async () => {
  for (const result of [[], [{}], [{ result: undefined }], [{ result: null }]]) {
    const w = worker(() => Promise.resolve(result));
    assert.equal((await w.send({ type: 'glaze:load', files: ['lib/widgets.js'], doc: 'A' }, tab())).ok, false);
    assert.deepEqual(w.injected, []);
  }
  const w = worker((o) => Promise.resolve([{ result: o.func ? true : {}, documentId: 'A' }]));
  assert.equal((await w.send({ type: 'glaze:load', files: ['lib/widgets.js'], doc: 'A' }, tab())).ok, true);
  assert.deepEqual(w.injected[0].target, { tabId: 7, documentIds: ['A'] });
});

test('a navigation between a frame probe and injection cannot initialize orphan widget or tab modules', async () => {
  // Browsers without document targeting can replace the frame after the probe. It has no bootstrap or dependencies yet.
  for (const file of ['lib/widgets.js', 'lib/coursetabs.js', 'features/coursetabs.js']) {
    const fresh = vm.createContext({}), errors = [];
    const w = worker((o) => {
      if (o.files) for (const f of o.files) try { vm.runInContext(read(f), fresh); } catch (e) { errors.push(e.message); }
      return Promise.resolve([{ result: o.func ? true : null }]);
    });
    assert.equal((await w.send({ type: 'glaze:load', files: [file], doc: 'OLD' }, tab())).ok, false);
    assert.deepEqual(errors, [], file);
    for (const name of ['GZ_WIDGETS', 'GZ_CTABS_LIB', 'GZ_CTABS']) assert.ok(!fresh[name], name);
    // A normal request after the new bootstrap must still initialize; an orphan injection must not poison the guard.
    if (file.startsWith('lib/')) {
      vm.runInContext('var GZ_SPEC = {};', fresh);
      assert.ok(vm.runInContext(read(file), fresh));
    }
  }
});

// Pinning the document is not enough either: Chrome can run files asked for by a page that is navigating away in the
// frame's next document, before that document's first content script, so before its GZ_CTX. A feature that reads
// GZ_CTX as it loads must then keep nothing: the next document's content.js would find the module already there and
// never load it again, and the kept copy has no helpers (features/pet.js's resume() threw on every widgets pass).
test('a feature that reads GZ_CTX as it loads keeps nothing when it lands before its bootstrap', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  // The page's globals, whatever a file touches: each property, call and construction gives the same stand-in back.
  // The language's own (Map, JSON…) are real; no GZ_ global is there, and no node module.
  const JS = new Set(vm.runInNewContext('Object.getOwnPropertyNames(globalThis)'));
  const any = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : any), apply: () => any, construct: () => any });
  const readers = [];
  for (const f of list) {
    const name = read(f).match(/^var (GZ_\w+) = globalThis\.\1 \|\|/m)?.[1];
    if (!name) continue;
    let asked = false;
    const own = {};
    const context = vm.createContext(new Proxy(own, { has: () => true, get: (t, k) => {
      if (k === 'GZ_CTX') { asked = true; return undefined; }
      if (Object.hasOwn(t, k)) return t[k];
      if (typeof k !== 'string' || /^(GZ_|__gz|module$|exports$|require$)/.test(k)) return undefined;
      return JS.has(k) ? globalThis[k] : any;
    } }));
    own.globalThis = own.window = own.self = vm.runInContext('this', context);
    try { vm.runInContext(read(f), context); } catch { /* it threw as it loaded: nothing kept, so it is asked for again */ }
    if (!asked) continue;
    readers.push(f);
    assert.ok(!vm.runInContext(name, context), `${f} keeps ${name} without GZ_CTX`);
  }
  for (const f of ['features/pet.js', 'features/widgets.js', 'features/coursetabs.js']) assert.ok(readers.includes(f), `${f} reads GZ_CTX as it loads`);
});

test('a course-tab feature request includes its library in the same injection', async () => {
  const w = worker();
  await w.send({ type: 'glaze:load', files: ['features/coursetabs.js'] }, { ...tab(), documentId: 'A' });
  assert.deepEqual(w.injected[0].files, ['lib/coursetabs.js', 'lib/motion.js', 'features/coursetabs.js']);
});

test('a feature that moves gets lib/motion.js ahead of it in the same injection, and only those do', async () => {
  for (const f of ['features/widgets.js', 'features/todo.js', 'features/reminders.js', 'features/coursemenu.js', 'features/folders.js', 'features/sidebar.js']) {
    const w = worker();
    await w.send({ type: 'glaze:load', files: [f] }, { ...tab(), documentId: 'A' });
    const files = w.injected[0].files;
    assert.ok(files.indexOf('lib/motion.js') >= 0 && files.indexOf('lib/motion.js') < files.indexOf(f), `${f}: ${files}`);
  }
  const w = worker();
  await w.send({ type: 'glaze:load', files: ['lib/folders.js'] }, { ...tab(), documentId: 'A' });
  assert.deepEqual(w.injected[0].files, ['lib/folders.js']);
});
