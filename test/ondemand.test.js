// What content.js does while a file it loads on demand is on its way: blocks of content.js run in a VM with stand-ins,
// as test/head.test.js does for the head gate. Sliced between section markers, so they track the real code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const block = (from, to) => {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a > 0 && b > a, `markers ${from} … ${to}`);
  return source.slice(a, b);
};
// A promise the test settles by hand.
const later = () => { let resolve, reject; const p = new Promise((y, n) => { resolve = y; reject = n; }); return Object.assign(p, { resolve, reject }); };
const settle = () => new Promise(setImmediate);
// Timers the test runs by hand.
const clock = () => {
  const due = [];
  return { setTimeout: (f, ms) => { due.push({ f, ms }); return due.length; }, clearTimeout: () => {}, run: () => { while (due.length) due.shift().f(); }, due };
};

// The loader and the page-language gate, with the worker answering when the test says.
const loader = ({ lang = 'de' } = {}) => {
  const replies = [];
  const t = clock();
  const ctx = vm.createContext({
    isPreview: false, observer: {}, timer: 0, wordsArrived: 0, flush() {},
    locale: () => lang,
    GZ_I18N: require('../lib/i18n.js'),
    chrome: { runtime: { sendMessage: (m) => { const r = later(); replies.push({ m, r }); return r; } } },
    setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, Promise, crypto: require('node:crypto').webcrypto,
  });
  vm.runInContext(`globalThis.GZ_LANGS = undefined; ${block('  // ---- code on demand', '  // ---- the gradebook')}; globalThis.api = { words, wordsIn, need, loading };`, ctx);
  return { api: ctx.api, replies, ctx, clock: t };
};

test('things drawn before the page\'s words arrived are redrawn when they do', async () => {
  const { api, replies, ctx } = loader();
  const redraw = [];
  api.wordsIn.add(() => redraw.push('keys'));
  assert.equal(api.words(), false);
  assert.deepEqual(JSON.parse(JSON.stringify(replies.map((x) => [x.m.type, x.m.files]))), [['glaze:load', ['i18n/de.js']]]);
  assert.equal(replies[0].m.doc, ctx.__gzDoc, 'names this document');
  vm.runInContext("globalThis.GZ_LANGS = { de: require_de }", Object.assign(ctx, { require_de: { Restore: 'Wiederherstellen' } }));
  replies[0].r.resolve({ ok: true });
  await settle();
  assert.equal(api.words(), true);
  assert.deepEqual(redraw, ['keys']);
});

test('a catalogue that fails to load leaves the page in English for good: no second request, no late switch', async () => {
  const { api, replies, clock: c } = loader();
  const redraw = [];
  api.wordsIn.add(() => redraw.push('keys'));
  api.words();
  replies[0].r.resolve({ ok: false, error: 'Frame was removed' });
  await settle();
  assert.equal(api.words(), true, 'the extras draw, in English');
  c.run(); // the minute after which need() would let the file be asked for again
  for (let i = 0; i < 3; i++) assert.equal(api.words(), true);
  assert.equal(replies.length, 1, 'asked once');
  assert.deepEqual(redraw, [], 'nothing switches language later');
});

test('an English page asks for nothing and never waits', () => {
  const { api, replies } = loader({ lang: 'en-GB' });
  assert.equal(api.words(), true);
  assert.equal(replies.length, 0);
});

// The keyboard help, built with a small stand-in DOM.
const dom = () => {
  const el = (tag) => ({
    tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, textContent: '', isConnected: true,
    setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); }, addEventListener() {},
    remove() { this.isConnected = false; }, focus() { doc.activeElement = this; },
    querySelector(sel) { const walk = (e) => e.children.flatMap((c) => [c, ...walk(c)]); return walk(this).find((c) => c.tagName === sel.toUpperCase()) || null; },
  });
  const doc = { createElement: el, body: el('body'), activeElement: null, addEventListener() {} };
  doc.activeElement = doc.body;
  return doc;
};

// features/keys.js on Canvas, as content.js hands it keys, with the stand-in DOM.
const keys = (words = { de: false }, site = 'canvas') => {
  const document = dom();
  const wordsIn = new Set();
  const ctx = vm.createContext({
    document, location: { pathname: '/' }, navigator: { platform: 'MacIntel' }, Date, GZ_PAGE: require('../lib/page.js'),
    GZ_CTX: { site, settings: () => ({ enhance: { keys: true, palette: true } }), on: () => true, typing: () => false, keyOn: () => true, wordsIn,
      t: (k) => (words.de && k === 'Keyboard shortcuts' ? 'Tastenkürzel' : k) },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../features/keys.js'), 'utf8'), ctx);
  const press = (key) => ctx.GZ_KEYS.key({ key, target: document.body, preventDefault() {}, stopImmediatePropagation() {} });
  const shown = () => document.body.children.filter((c) => c.isConnected);
  return { document, wordsIn, press, shown };
};

test('the keyboard help, opened before the page\'s words arrived, is redrawn in them', () => {
  const words = { de: false };
  const k = keys(words);
  const back = { focus() {}, isConnected: true };
  k.document.activeElement = back;
  k.press('g');
  k.press('?');
  assert.equal(k.shown().length, 1);
  assert.equal(k.shown()[0].attrs['aria-label'], 'Keyboard shortcuts');
  words.de = true;
  for (const f of k.wordsIn) f();
  assert.equal(k.shown()[0].attrs['aria-label'], 'Tastenkürzel');
  assert.equal(k.shown().length, 1, 'one dialog, the old one gone');
});

test('on Ultra, "?" alone shows and hides the keyboard help, which has no Dismiss button', () => {
  const k = keys(undefined, 'ultra');
  k.press('?');
  assert.equal(k.shown().length, 1);
  assert.equal(k.shown()[0].querySelector('button'), null);
  k.press('?');
  assert.equal(k.shown().length, 0);
});

test('a closed keyboard help stays closed when the words arrive', () => {
  const k = keys();
  for (const f of k.wordsIn) f();
  assert.equal(k.document.body.children.length, 0);
});

// The draft backup on Ultra, while lib/drafts.js and features/drafts.js are on their way: the editor still there when
// they arrive, or gone by then (the reply closed, the page changed), when what was read as it was written is kept.
// Or Ultra put the same editor and wrapper to another post (post_12_3/ed1 → post_99_1/ed2), off the page or still on it:
// the paste stays under the post it was written for.
const AFTER = { '': '', gone: ', even with its editor gone by then', 'reused, gone': ', even with its editor and wrapper reused for another post and gone',
  reused: ', even with its editor and wrapper reused for another post' };
for (const gone of Object.keys(AFTER)) {
  test(`a first and only input while the draft backup loads is still backed up once it arrives${AFTER[gone]}`, async () => {
    const saved = [];
    const t = clock();
    const loads = [];
    class Element {}
    const text = 'A pasted paragraph that is long enough to keep.';
    const editor = Object.assign(new Element(), {
      id: 'ed1', isConnected: true, textContent: '', innerHTML: '',
      parentElement: { attributes: [{ name: 'data-post-id', value: 'post_12_3' }], parentElement: null },
      attributes: [], matches: () => true, closest(sel) { return sel.includes('ql-editor') ? this : null; },
    });
    const listeners = {};
    const ctx = vm.createContext({
      ultra: true, observer: {}, settings: { enhance: { drafts: true } }, Element, location: { pathname: '/ultra/courses/_1_1/outline' },
      document: { addEventListener: (type, f) => { (listeners[type] ||= []).push(f); }, querySelector: () => null, querySelectorAll: () => [],
        body: {}, createTreeWalker: () => ({ nextNode: () => null }) }, // the page's text, where a sent post would show: none here
      NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
      chrome: { storage: { local: { set: (v) => saved.push(v), get() {}, remove() {} } } },
      need: (file) => (loads.find((l) => l.file === file) || loads[loads.push({ file, p: later() }) - 1]).p, // one request a file, as need() does
      setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, addEventListener() {}, Date, window: {}, globalThis: null,
    });
    ctx.globalThis = ctx;
    vm.runInContext(`${block('  // ---- draft backup (Extras)', '  // ---- download all (Extras)')}
      globalThis.api = { watchDrafts, local, draftAt: typeof draftAt === 'undefined' ? undefined : draftAt };`, ctx);
    ctx.api.watchDrafts();
    assert.deepEqual(loads, [], 'no editor on the page: nothing loads');
    for (const f of listeners.paste || []) f({ type: 'paste', target: editor });
    // Quill puts the paste in after its event; a pass sees it.
    Object.assign(editor, { textContent: text, innerHTML: `<p>${text}</p>` });
    ctx.document.querySelector = () => editor;
    ctx.api.watchDrafts();
    t.run();
    assert.deepEqual(saved, [], 'nothing kept before the module is in');
    assert.deepEqual(loads.map((l) => l.file), ['lib/drafts.js']);
    if (gone.startsWith('reused')) {
      Object.assign(editor, { id: 'ed2', textContent: '', innerHTML: '' });
      editor.parentElement.attributes[0].value = 'post_99_1';
      if (gone === 'reused') ctx.api.watchDrafts(); // a pass while the files load
    }
    if (gone === 'gone' || gone === 'reused, gone') { editor.isConnected = false; ctx.document.querySelector = () => null; ctx.location.pathname = '/ultra/stream'; }
    ctx.GZ_DRAFTS = require('../lib/drafts.js');
    loads[0].p.resolve();
    await settle();
    assert.deepEqual(loads.map((l) => l.file), ['lib/drafts.js', 'features/drafts.js'], 'then the backup itself');
    ctx.GZ_CTX = { site: 'ultra', t: (k) => k, locale: () => 'en', settings: () => ctx.settings, on: () => !!ctx.observer, local: ctx.api.local,
      draftEditor: '.ql-editor[contenteditable="true"]', draftAt: ctx.api.draftAt };
    vm.runInContext(fs.readFileSync(require.resolve('../features/drafts.js'), 'utf8'), ctx);
    loads[1].p.resolve();
    await settle();
    t.run();
    assert.equal(saved.length, 1, 'the paste is kept once the module arrives, without another input');
    assert.deepEqual(Object.keys(saved[0]), ['draft:/ultra/courses/_1_1/outline#_12_3/ed1'], 'under the page and post it was written on');
    assert.equal(Object.values(saved[0])[0].text, text);
  });
}

// ---- the hooks that load a feature on first use (W0c), while its file is on its way ----
// The first-use hooks of content.js, with document listeners kept, the loader answering when the test says, and
// what Glaze's settings and observer say set by the test.
const hooks = (from, to, extra = {}) => {
  const listeners = {};
  const loads = [];
  class Element {}
  const ctx = vm.createContext({
    Element, Date, Promise, GZ_PAGE: require('../lib/page.js'), isPreview: false, ultra: false, moodle: false, observer: {},
    settings: { enhance: { keys: true, palette: true, coursemenu: true, download: true, previews: true } },
    document: { addEventListener: (type, f) => { (listeners[type] ||= []).push(f); }, querySelector: () => ({}) },
    location: { pathname: '/', origin: 'https://school.test', assign(u) { ctx.went.push(u); } }, went: [],
    need: (file) => { const p = later(); loads.push({ file, p }); return p; },
    ...extra,
  });
  ctx.window = { top: null };
  ctx.window.top = ctx.window;
  vm.runInContext(`${block(from, to)}; globalThis.api = { ${extra.api || ''} };`, ctx);
  const fire = (type, e) => { for (const f of listeners[type] || []) f(e); };
  return { ctx, loads, fire, Element };
};
const key = (k, more = {}) => ({ key: k, target: {}, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false,
  prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; }, stopImmediatePropagation() { this.stopped++; }, ...more });

for (const [site, ultra, to] of [['canvas', false, '/courses'], ['ultra', true, '/ultra/course']]) {
  test(`keys pressed while features/keys.js loads are handed over in order: g then c still goes to Courses (${site})`, async () => {
    const h = hooks('  // ---- keyboard shortcuts (Extras)', '  // ---- command palette', { ultra, api: 'keyOn, typing' });
    h.fire('keydown', key('g'));
    h.fire('keydown', key('c'));
    assert.deepEqual(h.loads.map((l) => l.file), ['features/keys.js'], 'asked for once');
    h.ctx.GZ_CTX = { site, t: (k) => k, settings: () => h.ctx.settings, on: () => true, wordsIn: new Set(), typing: h.ctx.api.typing, keyOn: h.ctx.api.keyOn };
    vm.runInContext(fs.readFileSync(require.resolve('../features/keys.js'), 'utf8'), h.ctx);
    h.loads[0].p.resolve();
    await settle();
    assert.deepEqual(h.ctx.went, [`https://school.test${to}`]);
  });
}

test('on Canvas, g then ? while features/keys.js loads keeps Canvas\'s own help shut, and opens Glaze\'s', async () => {
  const h = hooks('  // ---- keyboard shortcuts (Extras)', '  // ---- command palette', { api: 'keyOn' });
  h.fire('keydown', key('g'));
  h.fire('keydown', key('Shift'));
  const q = key('?');
  h.fire('keydown', q);
  assert.deepEqual([q.prevented, q.stopped], [1, 1], 'taken from Canvas at once');
  // Not after another key: then the "?" is Canvas's.
  const x = hooks('  // ---- keyboard shortcuts (Extras)', '  // ---- command palette', { api: 'keyOn' });
  x.fire('keydown', key('g'));
  x.fire('keydown', key('x'));
  const q2 = key('?');
  x.fire('keydown', q2);
  assert.deepEqual([q2.prevented, q2.stopped], [0, 0]);
});

test('Ctrl+K twice while features/palette.js loads leaves it closed; once opens it, once', async () => {
  for (const [presses, opened] of [[2, 0], [1, 1], [3, 1]]) {
    const h = hooks('  // ---- keyboard shortcuts (Extras)', '  // ---- page changes');
    for (let i = 0; i < presses; i++) h.fire('keydown', key('k', { ctrlKey: true }));
    assert.equal(h.loads.filter((l) => l.file === 'features/palette.js').length, 1, 'asked for once');
    let n = 0;
    h.ctx.GZ_CMD = { open: () => n++, isOpen: () => false, close() {} };
    h.loads[0].p.resolve();
    await settle();
    assert.equal(n, opened, `${presses} press(es)`);
  }
});

test('a course menu pressed while its file loads opens only if the menu and its button are still there when it arrives', async () => {
  for (const [why, change, opens] of [['nothing changed', () => {}, true], ['Glaze turned off', (h) => { h.ctx.observer = null; }, false],
    ['the extra turned off', (h) => { h.ctx.settings.enhance.coursemenu = false; }, false], ['the card redrawn', (h, b) => { b.isConnected = false; }, false]]) {
    const h = hooks('  const menuOn = () =>', '  // ---- settings → <html>');
    const b = Object.assign(new h.Element(), { isConnected: true, getClientRects: () => [{}] });
    b.closest = () => b;
    h.fire('click', key('', { type: 'click', target: b }));
    let toggled = 0;
    h.ctx.GZ_COURSE_MENU = { toggle: () => toggled++ };
    change(h, b);
    h.loads.find((l) => l.file === 'features/coursemenu.js').p.resolve();
    await settle();
    assert.equal(toggled, opens ? 1 : 0, why);
  }
});

test('Download all\'s buttons aren\'t drawn by a file that arrives after Glaze, the switch or the page changed', async () => {
  for (const [why, change, syncs] of [['nothing changed', () => {}, 1], ['Glaze turned off', (h) => { h.ctx.observer = null; }, 0],
    ['the switch turned off', (h) => { h.ctx.settings.enhance.download = false; }, 0], ['another page', (h) => { h.ctx.courseId = () => undefined; }, 0]]) {
    const h = hooks('  // ---- download all (Extras)', '  // ---- document buttons', { ultra: true, courseId: () => '_1_1', api: 'syncDownloads' });
    h.ctx.api.syncDownloads();
    let n = 0;
    h.ctx.GZ_DOWNLOAD = { sync: () => n++ };
    change(h);
    h.loads[0].p.resolve();
    await settle();
    assert.equal(n, syncs, why);
  }
});

// ---- W0d: the draft backup, Ultra's what-if calculator, the document buttons and your place load where they're used ----
test('Ultra\'s what-if calculator loads on a course\'s Grades with its grades in, and nowhere else', async () => {
  const grades = { pathname: '/ultra/courses/_1_1/grades' };
  for (const [why, change, files] of [['grades in', () => {}, ['lib/gradecalc.js', 'features/whatif.js']],
    ['switched off', (c) => { c.settings.enhance.calc = false; }, []], ['the outline', (c) => { c.location.pathname = '/ultra/courses/_1_1/outline'; }, []],
    ['grades not in yet', (c) => { c.bookFor = () => ({}); }, []], ['Glaze off', (c) => { c.observer = null; }, []]]) {
    const h = hooks('  // ---- what-if calculator (Extras)', '  // ---- draft backup (Extras)', { ultra: true, courseId: () => '_1_1', bookFor: () => ({ results: [] }), location: { ...grades }, api: 'renderCalc' });
    h.ctx.settings.enhance.calc = true;
    change(h.ctx);
    h.ctx.api.renderCalc();
    let rendered = 0;
    if (h.loads.length) {
      h.ctx.GZ_GRADECALC = {};
      h.loads[0].p.resolve();
      await settle();
      h.ctx.GZ_WHATIF = { render: () => rendered++ };
      h.loads[1].p.resolve();
      await settle();
    }
    assert.deepEqual(h.loads.map((l) => l.file), files, why);
    assert.equal(rendered, files.length ? 1 : 0, why);
  }
});

test('the document buttons load on a course document or a file preview, with the switch on', () => {
  for (const [why, ultra, toggles, has, loads] of [['a document', false, true, ['doc'], 1], ['switched off', false, false, ['doc'], 0],
    ['a Canvas file preview', false, true, ['preview'], 1], ['nothing there', false, true, [], 0],
    ['an Ultra preview, switched off (its images are turned back)', true, false, ['preview'], 1]]) {
    const h = hooks('  // ---- document buttons (Extras)', '  // ---- keyboard shortcuts (Extras)', { ultra, addEventListener() {}, api: 'syncDocTools' });
    h.ctx.settings.enhance.toggles = toggles;
    h.ctx.document.querySelector = (sel) => (has.some((k) => (k === 'doc' ? /document-content-root|show-content/ : /iframe/).test(sel)) ? {} : null);
    h.ctx.api.syncDocTools();
    assert.equal(h.loads.length, loads, why);
  }
});

test('your place loads on a course\'s Modules or an item opened from it (Canvas), or a course outline (Ultra)', () => {
  for (const [why, ultra, pathname, search, rows, loads] of [['Modules', false, '/courses/5/modules', '', true, 1], ['course home without modules', false, '/courses/5', '', false, 0],
    ['an item from Modules', false, '/courses/5/assignments/9', '?module_item_id=3', false, 1], ['another course page', false, '/courses/5/assignments/9', '', true, 0],
    ['an outline', true, '/ultra/courses/_1_1/outline', '', true, 1], ['an outline still empty', true, '/ultra/courses/_1_1/outline', '', false, 0]]) {
    const h = hooks('  // ---- your place in a course (Extras)', '  // ---- what-if calculator (Extras)', {
      ultra, URLSearchParams, courseId: () => '_1_1', canvasCourseKey: () => 'canvas:x/5', location: { pathname, search }, api: 'keepPlace' });
    h.ctx.settings.enhance.place = true;
    h.ctx.document.querySelector = () => (rows ? {} : null);
    h.ctx.document.getElementById = () => (rows ? {} : null);
    h.ctx.api.keepPlace();
    assert.equal(h.loads.length, loads, why);
  }
});

// ---- W0d review: what happens while those files are on their way ----
// Ultra: an outline whose kept place has a folder to unfold, and features/place.js arriving after the hook asked for it.
const ultraPlace = async (touch) => {
  const listeners = {};
  const loads = [];
  const t = clock();
  let clicks = 0;
  class Element {}
  const toggle = { getAttribute: () => 'false', click: () => clicks++ };
  const row = { dataset: { contentId: '_9_1' } };
  const ctx = vm.createContext({
    Element, Date, Promise, URLSearchParams, GZ_PAGE: require('../lib/page.js'), ultra: true, observer: {}, settings: { enhance: { place: true } },
    document: { addEventListener: (type, f) => { (listeners[type] ||= []).push(f); }, querySelector: () => row, querySelectorAll: () => [row], scrollingElement: { scrollTop: 0 }, body: {} },
    location: { pathname: '/ultra/courses/_1_1/outline', search: '' }, courseId: () => '_1_1', canvasCourseKey: () => null,
    need: (file) => { const p = later(); loads.push({ file, p }); return p; },
    sessionStorage: { getItem: () => null, setItem() {} }, getComputedStyle: () => ({ overflowY: 'visible' }),
    chrome: { storage: { local: { get: (k, f) => f({ coursePlace: { _1_1: { open: ['_9_1'], top: 300, at: 1 } } }), set() {} } } },
    setTimeout: t.setTimeout, clearTimeout: t.clearTimeout,
  });
  ctx.window = { top: null };
  ctx.window.top = ctx.window;
  vm.runInContext(`${block('  // ---- your place in a course (Extras)', '  // ---- what-if calculator (Extras)')}
    globalThis.api = { keepPlace, tapped: () => tapped, acted: () => acted, placeAsked: () => typeof placeAsked === 'undefined' ? 0 : placeAsked };`, ctx);
  ctx.api.keepPlace();
  assert.deepEqual(loads.map((l) => l.file), ['features/place.js']);
  if (touch) for (const f of listeners.wheel) f({ isTrusted: true });
  ctx.GZ_CTX = { site: 'ultra', settings: () => ctx.settings, on: () => true, local: (fn) => fn(ctx.chrome.storage.local), courseId: ctx.courseId, canvasCourseKey: ctx.canvasCourseKey,
    toggleOf: () => toggle, ROWS: '.content-list-item[data-content-id]', holding: () => false, tapped: ctx.api.tapped, acted: ctx.api.acted, placeAsked: ctx.api.placeAsked };
  vm.runInContext(fs.readFileSync(require.resolve('../features/place.js'), 'utf8'), ctx);
  loads[0].p.resolve();
  await settle();
  for (let i = 0; i < 5 && t.due.length; i++) t.due.shift().f(); // a few of the restore's 200 ms steps
  return clicks;
};

test('Ultra: a place is put back when the outline loads, but not if you did something while place.js was on its way', async () => {
  assert.equal(await ultraPlace(false), 1, 'nothing done: its folder unfolds again');
  assert.equal(await ultraPlace(true), 0, 'a wheel while the file loaded: left as you have it');
});

// Canvas: the first input in Inbox compose while the backup loads. Kept once the account is in, whether compose is still
// open then, closed before the files arrived, or closed while the account was being asked for.
for (const gone of ['never', 'before the files arrive', 'while the account is asked for']) {
  test(`Canvas: the first input in Inbox compose, while the backup loads, is kept once the account is in (compose closed: ${gone})`, async () => {
    const saved = [];
    const t = clock();
    const loads = [];
    class Element {}
    const SEL = '#compose-message-modal textarea[data-testid="message-body"]';
    const fields = { 'input[data-testid="subject-input"]': { value: 'Lab question' }, 'input[data-testid="course-select-modal"]': { value: 'BIO 1100' } };
    const modal = { querySelector: (s) => fields[s] || null, querySelectorAll: () => [{ id: 'address-book-label-2-user' }] };
    const text = 'A first and only paste, long enough to be worth keeping.';
    const editor = Object.assign(new Element(), { isConnected: true, value: text, parentElement: null,
      closest: (s) => (s === SEL ? editor : s === '#compose-message-modal' && editor.isConnected ? modal : null) });
    // Closing compose takes the dialog, its fields and the editor off the page.
    const close = () => { editor.isConnected = false; ctx.document.querySelector = () => null; };
    const listeners = {};
    let account;
    const ctx = vm.createContext({
      ultra: false, observer: {}, settings: { enhance: { drafts: true } }, Element, location: { pathname: '/conversations', origin: 'https://school.test' },
      document: { addEventListener: (type, f) => { (listeners[type] ||= []).push(f); }, querySelector: (s) => (s === SEL ? editor : null), querySelectorAll: () => [] },
      chrome: { storage: { local: { set: (v) => saved.push(v), get() {}, remove() {} } } },
      need: (file) => { const p = later(); loads.push({ file, p }); return p; },
      setTimeout: t.setTimeout, clearTimeout: t.clearTimeout, addEventListener() {}, Date, Promise, window: {}, globalThis: null,
    });
    ctx.globalThis = ctx;
    vm.runInContext(`${block('  // ---- draft backup (Extras)', '  // ---- download all (Extras)')}
      globalThis.api = { local, draftAt: typeof draftAt === 'undefined' ? undefined : draftAt };`, ctx);
    for (const f of listeners.input) f({ type: 'input', target: editor });
    if (gone === 'before the files arrive') close();
    ctx.GZ_DRAFTS = require('../lib/drafts.js');
    loads[0].p.resolve();
    await settle();
    ctx.GZ_CTX = { site: 'canvas', t: (k) => k, locale: () => 'en', settings: () => ctx.settings, on: () => !!ctx.observer, local: ctx.api.local, draftEditor: SEL,
      draftAt: ctx.api.draftAt, profile: () => (account ||= later()), canvasCourses: () => Promise.resolve([{ id: 5, name: 'BIO 1100' }]),
      capi: () => Promise.reject(new Error('offline')) };
    vm.runInContext(fs.readFileSync(require.resolve('../features/drafts.js'), 'utf8'), ctx);
    loads[1].p.resolve();
    await settle();
    t.run();
    assert.deepEqual(saved, [], 'nothing kept before the account is in');
    if (gone === 'while the account is asked for') close();
    assert.ok(account, 'the account is asked for');
    account.resolve({ id: 7 });
    await settle();
    t.run();
    assert.equal(saved.length, 1, 'the input is kept once the account arrives, without another');
    assert.deepEqual(Object.keys(saved[0]), ['draft:canvas:["https://school.test","7","5",["2"],"Lab question"]']);
    assert.equal(Object.values(saved[0])[0].text, text);
  });
}
