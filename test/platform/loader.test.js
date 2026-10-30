// Code on demand: content.js need() asks background/background.js ('glaze:load'), which runs allowlisted files in the
// asking frame only. These tests hold the allowlist and the frame targeting, and check that what is loaded this way
// survives being loaded twice and isn't also in the first content script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = require('../../extension/manifest.json');
const settle = () => new Promise(setImmediate);
const ID = 'glaze-test-id';

// The worker with Chrome stubbed: every onMessage listener, and the executeScript calls it makes.
const worker = (execute = (o) => Promise.resolve([{ result: /typeof GZ_I18N|window\.__gzGlaze/.test(String(o.func)) ? false : true }]), protocol = 'chrome-extension:', local = {}) => {
  const listeners = [];
  const injected = [], asked = [];
  const none = { addListener() {} };
  const area = { get: (k) => Promise.resolve(Object.fromEntries([].concat(k ?? []).filter((x) => x in local).map((x) => [x, local[x]]))), set: () => Promise.resolve() };
  const context = vm.createContext({
    URL, console, setTimeout, clearTimeout, GZ_BUILT_IN: require('../../extension/content/defaults.js').GZ_BUILT_IN, GZ_LOCAL_DEV: require('../../extension/content/defaults.js').GZ_LOCAL_DEV, GZ_GCAL: { ON: false },
    importScripts: (file) => vm.runInContext(read(path.join('background', file)), context),
    chrome: {
      runtime: {
        id: ID, getURL: (p = '') => `${protocol}//${ID}/${p}`, getManifest: () => manifest,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none,
      },
      storage: { local: area, sync: area, onChanged: none },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {}, executeScript: (o) => { if (o.files) injected.push(JSON.parse(JSON.stringify(o))); else asked.push(JSON.parse(JSON.stringify({ ...o, func: String(o.func) }))); return execute(o); } },
    },
  });
  vm.runInContext(read('background/background.js'), context, { filename: 'background/background.js' });
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
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['core/zip.js'] }, tab(3)), { ok: true });
  assert.deepEqual(w.injected, [{ target: { tabId: 7, frameIds: [3] }, files: ['core/zip.js'], injectImmediately: true }]);
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['i18n/de.js'] }, tab(0)), { ok: true });
  assert.deepEqual(w.injected[1].target, { tabId: 7, frameIds: [0] });
});

test('both Activity Stream modules load through the real worker handler on an approved Ultra page', async () => {
  const w = worker(undefined, undefined, { ultra: ['https://bb.school.test'] });
  const sender = { ...tab(0), url: 'https://bb.school.test/ultra/stream', documentId: 'STREAM-DOC' };
  for (const file of ['courses/page/stream.js', 'courses/stream.js']) {
    assert.deepEqual(await w.send({ type: 'glaze:load', files: [file] }, sender), { ok: true });
    assert.deepEqual(w.injected.at(-1), { target: { tabId: 7, documentIds: ['STREAM-DOC'] }, files: [file], injectImmediately: true });
  }
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
  for (const files of [['content/content.js'], ['background/background.js'], ['../manifest.json'], ['core/zip.js', 'content/content.js'], ['https://example.com/x.js'],
    ['/core/zip.js'], ['core/zip.js?x'], [], 'core/zip.js', undefined, [{ toString: () => 'core/zip.js' }]]) {
    assert.deepEqual(await w.send({ type: 'glaze:load', files }, tab()), refuse, JSON.stringify(files));
  }
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['core/zip.js'] }, { ...tab(), id: 'another-extension' }), refuse);
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['core/zip.js'] }, { id: ID, url: `chrome-extension://${ID}/popup.html` }), refuse, 'no tab');
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['core/zip.js'] }, { ...tab(), frameId: undefined }), refuse, 'no frame');
  assert.deepEqual(w.injected, []);
});

test('the document that asked is the target where the browser names it, so a navigated frame gets nothing', async () => {
  const w = worker();
  assert.deepEqual(await w.send({ type: 'glaze:load', files: ['core/zip.js'] }, { ...tab(3), documentId: 'DOC-A' }), { ok: true });
  assert.deepEqual(w.injected[0].target, { tabId: 7, documentIds: ['DOC-A'] });
  const gone = worker(() => Promise.reject(new Error('No document with id DOC-A in tab 7.')));
  assert.deepEqual(await gone.send({ type: 'glaze:load', files: ['core/zip.js'] }, { ...tab(3), documentId: 'DOC-A' }), { ok: false, error: 'No document with id DOC-A in tab 7.' });
});

test('without a document id, a frame that now holds another document gets nothing', async () => {
  // The frame's own answer: is content.js's docId for this document the one in the request?
  const frame = (doc) => (o) => Promise.resolve([{ result: o.func ? o.args[0] === doc : {} }]);
  const moved = worker(frame('DOC-B'));
  assert.deepEqual(await moved.send({ type: 'glaze:load', files: ['core/zip.js'], doc: 'DOC-A' }, tab(3)), { ok: false, error: 'the frame holds another document now' });
  assert.deepEqual(moved.injected, []);
  assert.deepEqual(moved.asked.map((a) => [a.target, a.args]), [[{ tabId: 7, frameIds: [3] }, ['DOC-A']]]);
  const stayed = worker(frame('DOC-A'));
  assert.deepEqual(await stayed.send({ type: 'glaze:load', files: ['core/zip.js'], doc: 'DOC-A' }, tab(3)), { ok: true });
  assert.equal(stayed.injected.length, 1);
  // With a document id there is nothing to ask.
  const named = worker(frame('DOC-A'));
  await named.send({ type: 'glaze:load', files: ['core/zip.js'] }, { ...tab(3), documentId: 'D1' });
  assert.deepEqual(named.asked, []);
});

test('success means the file ran to its end: an injection that fails, throws or stops short is reported', async () => {
  const send = (execute, protocol) => worker(execute, protocol).send({ type: 'glaze:load', files: ['writer/drafts.js'] }, { ...tab(), documentId: 'A' });
  assert.deepEqual(await send(() => Promise.reject(new Error('Frame with ID 3 was removed.'))), { ok: false, error: 'Frame with ID 3 was removed.' });
  // Firefox, the site's grant taken back: a refusal content.js doesn't ask again.
  assert.deepEqual(await send(() => Promise.reject(new Error('Missing host permission for the tab or frames'))), { ok: false, error: 'sender' });
  // Chrome: a file that throws leaves no last value. Firefox reports the error.
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3, result: null }])), { ok: false, error: 'did not finish' });
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3 }])), { ok: false, error: 'did not finish' });
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3, error: new Error('boom') }])), { ok: false, error: 'boom' });
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3, result: { worth() {} } }])), { ok: true });
  // Safari: its results for files aren't relied on; content.js checks the module itself.
  assert.deepEqual(await send(() => Promise.resolve([{ frameId: 3 }]), 'safari-web-extension:'), { ok: true });
});

test('only the browser host-permission refusal is final, not a script exception or a similar message', async () => {
  const missing = 'Missing host permission for the tab or frames';
  const similar = 'Missing host permission data; try again';
  const message = { type: 'glaze:load', files: ['writer/drafts.js'], doc: 'A' };
  for (const sender of [tab(), { ...tab(), documentId: 'A' }]) {
    const refused = worker(() => Promise.reject(new Error(missing)));
    assert.deepEqual(await refused.send(message, sender), { ok: false, error: 'sender' }, 'the document probe or injection is refused');
    const retryable = worker(() => Promise.reject(new Error(similar)));
    assert.deepEqual(await retryable.send(message, sender), { ok: false, error: similar }, 'a shared prefix does not prove a revoked grant');
  }
  const script = worker(() => Promise.resolve([{ frameId: 3, error: new Error(missing) }]));
  assert.deepEqual(await script.send(message, { ...tab(), documentId: 'A' }), { ok: false, error: missing }, 'a script exception is still retryable');
  const afterProbe = worker((o) => o.func ? Promise.resolve([{ result: true }]) : Promise.reject(new Error(missing)));
  assert.deepEqual(await afterProbe.send(message, tab()), { ok: false, error: 'sender' }, 'a successful probe does not hide an injection refusal');
});

// What a feature file reads from content.js when it loads (<area>/page/*.js).
const CTX = { placeAsked: () => 0, t: (k) => k, locale: () => 'en', capi() {}, canvasCourses() {}, canvasCourseId() {}, need() {}, settings: () => ({}), site: 'canvas', wordsIn: new Set() };
// What a feature file touches as it loads: the listeners it adds (navigation/page/keys.js, coursemenu.js, previews.js).
const page = () => ({ document: { addEventListener() {}, documentElement: {} }, location: { pathname: '/host' }, addEventListener() {}, GZ_COLOR: {}, IntersectionObserver: class {} });
// Moved out of the first content script in W0c: the palette, the keys, the course menu, the previews and Download all.
// W0d: the draft backup, the document buttons and your place in a course (Ultra's what-if is planner/page/grades.js since B4).
const W0C = [['navigation/page/palette.js', 'GZ_CMD'], ['navigation/page/keys.js', 'GZ_KEYS'], ['navigation/page/coursemenu.js', 'GZ_COURSE_MENU'], ['courses/page/previews.js', 'GZ_PEEK'], ['courses/page/download.js', 'GZ_DOWNLOAD'],
  ['writer/page/drafts.js', 'GZ_DRAFT_UI'], ['courses/page/docs.js', 'GZ_DOCS'], ['navigation/page/place.js', 'GZ_PLACE'],
  ['planner/gpa.js', 'GZ_GPA'], ['planner/page/gpaterms.js', 'GZ_GPA_TERMS'], ['core/doctext.js', 'GZ_DOCTEXT']];
// Syllabus import (W15): its extractors and the page's part (core/doctext.js is listed above).
const W15 = [['planner/syllabus.js', 'GZ_SYLLABUS'], ['planner/page/syllabus.js', 'GZ_SYL_UI']];
// Insights (W17).
const W17 = [['planner/insights.js', 'GZ_INSIGHTS'], ['planner/page/insights.js', 'GZ_INSIGHTS_UI']];
test('every loadable file ends on a value, which is how the worker knows it ran', () => {
  for (const f of ['core/zip.js', 'writer/drafts.js', 'planner/gradecalc.js', 'planner/page/grades.js', 'i18n/de.js', 'courses/cards.js', 'navigation/seek.js', 'navigation/page/search.js', 'core/widgets.js', 'core/page/widgets.js', ...W0C.map(([f]) => f), ...W15.map(([f]) => f), ...W17.map(([f]) => f), 'planner/classes.js', 'planner/page/classes.js', 'planner/ics.js', 'core/doctext.js', 'content/content-ultra.js', 'content/content-canvas.js']) {
    const context = vm.createContext({ TextEncoder, Uint8Array, Uint32Array, DataView, Blob: class {}, btoa, atob, GZ_CTX: CTX, GZ_SPEC: {}, ...page() });
    assert.ok(vm.runInContext(read(f), context), `${f}: no last value`);
  }
});

// Each site's first content script, from the manifest: Ultra's, Canvas's and MoodleCloud's (Canvas's without its part, as
// background/background.js registers it for other Moodle hosts). A site's part is loadable too, for a page whose list lacks it, and only there.
const firstScripts = () => {
  const entry = (has) => manifest.content_scripts.find(has).js;
  return [entry((c) => c.js.includes('content/content-ultra.js')), entry((c) => c.js.includes('content/content-canvas.js')), entry((c) => c.matches.includes('https://*.moodlecloud.com/*'))];
};
const PARTS = ['content/content-ultra.js', 'content/content-canvas.js', 'navigation/nav.js']; // Ultra's first-paint schema travels with its part on other registered hosts.
test('every loadable file exists, is left out of the first content script, and is what content.js asks for', () => {
  const list = JSON.parse(read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  for (const f of list) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
    for (const first of firstScripts()) assert.ok(!first.includes(f) || PARTS.includes(f), `${f} is loaded on demand, not with every page`);
  }
  for (const f of PARTS) assert.ok(list.includes(f) && firstScripts().some((first) => !first.includes(f)), `${f}: loadable where its site's list lacks it`);
  const asked = [...read('content/content.js').matchAll(/\bneed\('([^']+)'/g), ...['content/content-ultra.js', 'content/content-canvas.js'].flatMap((p) => [...read(p).matchAll(/\bneed\('([^']+)'/g)])].map((m) => m[1]);
  assert.ok(asked.length >= 2);
  for (const f of asked) assert.ok(list.includes(f), `content.js needs ${f}, which LOADABLE doesn't list`);
  // content.js asks for a missing part by the site's name.
  assert.match(read('content/content.js'), /need\(`content\/content-\$\{site\}\.js`/);
  // Only the Ultra preview loads its real runtime; Canvas/Moodle use the bootstrap's site-specific painters.
  for (const f of ['core/zip.js', 'writer/drafts.js', 'settings/editor-preview.js']) assert.ok(read('preview.html').includes(`<script src="${f}"></script>`), `preview.html: ${f}`);
  const bootstrap = read('settings/editor-preview.js').split("if (site === 'ultra') {")[1]?.split('} else {')[0];
  const files = JSON.parse(bootstrap?.match(/for \(const file of (\[[^\]]+\])\) await load\(file\)/)?.[1].replace(/'/g, '"') || '[]');
  assert.ok(files.includes('content/content-ultra.js') && files.includes('content/content.js'), 'Ultra runtime is loaded');
  assert.ok(files.indexOf('content/content-ultra.js') < files.indexOf('content/content.js'), 'the part before content.js');
  // need() refuses in the preview, so every feature a Look's parts bring in must be loaded here (rules were missing once).
  for (const f of ['navigation/page/nav.js', 'looks/page/motionx.js', 'looks/page/rules.js']) assert.ok(files.includes(f), `the Ultra preview loads ${f}`);
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `preview runtime: ${f}`);
});

// A loaded file's `var GZ_X` shares the frame's global scope with the first script's `const`s: the same name there
// (defaults.js has GZ_PALETTE) makes the file throw as it loads.
test('no loadable file declares a name the first content script already declares', () => {
  const list = JSON.parse(read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const names = (src) => [...src.matchAll(/^(?:const|let|var|function|class)\s+([\w$]+)/gm)].map((m) => m[1]);
  for (const files of firstScripts()) {
    const first = new Set(files.flatMap((f) => names(read(f))));
    for (const f of list.filter((x) => !files.includes(x))) for (const n of names(read(f))) assert.ok(!first.has(n), `${f} declares ${n}, which the first content script has`);
  }
});

// B0b: a site's part (content-ultra.js, content-canvas.js) returns what it does over content.js's defaults (X). A name
// content.js has no default for would never be called; a default content.js never calls is dead.
test('each site\'s part returns only what content.js calls, and content.js calls every default it has', () => {
  const src = read('content/content.js');
  const X = vm.runInNewContext(`${src.match(/^ {2}const no = .*\n {2}const X = \{[\s\S]*?\};$/m)[0]} X`, {});
  for (const k of Object.keys(X).filter((x) => x !== 'ctx')) assert.match(src, new RegExp(`\\bX\\.${k}\\b`), `content.js never calls X.${k}`);
  // The part's own helpers are in GZ_CTX on every site, asked of the part when called (it may come late).
  const forwarded = src.match(/\.\.\.Object\.fromEntries\((\[[^\]]*\])\.map\(\(k\) => \[k, \(\.\.\.a\) => X\.ctx\[k\]\(\.\.\.a\)\]\)\) \}\);/);
  assert.ok(forwarded, 'GZ_CTX forwards the part\'s helpers');
  const keys = JSON.parse(forwarded[1].replace(/'/g, '"'));
  for (const [file, name] of [['content/content-ultra.js', 'GZ_SITE_ULTRA'], ['content/content-canvas.js', 'GZ_SITE_CANVAS']]) {
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
  for (const [file, name] of [['core/zip.js', 'GZ_ZIP'], ['writer/drafts.js', 'GZ_DRAFTS'], ['planner/gradecalc.js', 'GZ_GRADECALC'], ['planner/page/grades.js', 'GZ_GRADES_UI'], ['courses/cards.js', 'GZ_CARDS'], ['navigation/seek.js', 'GZ_SEEK'], ['navigation/page/search.js', 'GZ_SEARCH'], ['core/widgets.js', 'GZ_WIDGETS'], ['core/page/widgets.js', 'GZ_WIDGETS_UI'], ...W0C, ...W15, ['content/content-ultra.js', 'GZ_SITE_ULTRA'], ['content/content-canvas.js', 'GZ_SITE_CANVAS']]) {
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
  vm.runInContext(read('core/i18n.js'), context);
  const t = (tag) => vm.runInContext(`GZ_I18N.t('Restore', {}, ${JSON.stringify(tag)})`, context);
  assert.equal(t('de'), 'Restore');
  vm.runInContext(read('i18n/de.js'), context);
  assert.equal(t('de'), vm.runInContext('GZ_LANGS.de.Restore', context));
  assert.notEqual(t('de'), 'Restore');
});

test('a fallback probe must positively identify the document and pins its returned document id', async () => {
  for (const result of [[], [{}], [{ result: undefined }], [{ result: null }]]) {
    const w = worker(() => Promise.resolve(result));
    assert.equal((await w.send({ type: 'glaze:load', files: ['core/widgets.js'], doc: 'A' }, tab())).ok, false);
    assert.deepEqual(w.injected, []);
  }
  const w = worker((o) => Promise.resolve([{ result: o.func ? true : {}, documentId: 'A' }]));
  assert.equal((await w.send({ type: 'glaze:load', files: ['core/widgets.js'], doc: 'A' }, tab())).ok, true);
  assert.deepEqual(w.injected[0].target, { tabId: 7, documentIds: ['A'] });
});

test('a navigation between a frame probe and injection cannot initialize orphan widget or tab modules', async () => {
  // Browsers without document targeting can replace the frame after the probe. It has no bootstrap or dependencies yet.
  for (const file of ['core/widgets.js', 'navigation/coursetabs.js', 'navigation/page/coursetabs.js']) {
    const fresh = vm.createContext({}), errors = [];
    const w = worker((o) => {
      if (o.files) for (const f of o.files) try { vm.runInContext(read(f), fresh); } catch (e) { errors.push(e.message); }
      return Promise.resolve([{ result: o.func ? true : null }]);
    });
    assert.equal((await w.send({ type: 'glaze:load', files: [file], doc: 'OLD' }, tab())).ok, false);
    assert.deepEqual(errors, [], file);
    for (const name of ['GZ_WIDGETS', 'GZ_CTABS_LIB', 'GZ_CTABS']) assert.ok(!fresh[name], name);
    // A normal request after the new bootstrap must still initialize; an orphan injection must not poison the guard.
    if (!file.includes('/page/')) {
      vm.runInContext('var GZ_SPEC = {};', fresh);
      assert.ok(vm.runInContext(read(file), fresh));
    }
  }
});

// Pinning the document is not enough either: Chrome can run files asked for by a page that is navigating away in the
// frame's next document, before that document's first content script, so before its GZ_CTX. A feature that reads
// GZ_CTX as it loads must then keep nothing: the next document's content.js would find the module already there and
// never load it again, and the kept copy has no helpers (pet/page/pet.js's resume() threw on every widgets pass).
test('a feature that reads GZ_CTX as it loads keeps nothing when it lands before its bootstrap', () => {
  const list = JSON.parse(read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
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
  for (const f of ['pet/page/pet.js', 'core/page/widgets.js', 'navigation/page/coursetabs.js']) assert.ok(readers.includes(f), `${f} reads GZ_CTX as it loads`);
});

test('a course-tab feature request includes its library in the same injection', async () => {
  const w = worker();
  await w.send({ type: 'glaze:load', files: ['navigation/page/coursetabs.js'] }, { ...tab(), documentId: 'A' });
  assert.deepEqual(w.injected[0].files, ['navigation/coursetabs.js', 'core/motion.js', 'navigation/page/coursetabs.js']);
});

test('a feature that moves gets core/motion.js ahead of it in the same injection, and only those do', async () => {
  for (const f of ['core/page/widgets.js', 'planner/page/todo.js', 'planner/page/reminders.js', 'navigation/page/coursemenu.js', 'courses/page/folders.js', 'navigation/page/sidebar.js']) {
    const w = worker();
    await w.send({ type: 'glaze:load', files: [f] }, { ...tab(), documentId: 'A' });
    const files = w.injected[0].files;
    assert.ok(files.indexOf('core/motion.js') >= 0 && files.indexOf('core/motion.js') < files.indexOf(f), `${f}: ${files}`);
  }
  const w = worker();
  await w.send({ type: 'glaze:load', files: ['courses/folders.js'] }, { ...tab(), documentId: 'A' });
  assert.deepEqual(w.injected[0].files, ['courses/folders.js']);
});
