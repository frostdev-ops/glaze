const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');
El.prototype.matches ||= function (sel) { return this.closest(sel) === this; };
const G = require('../defaults.js');
const R = require('../features/docreview.js');
const source = fs.readFileSync(path.join(__dirname, '../features/docreview.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/ultra-docreview.html'), 'utf8');
const origin = 'https://school.blackboard.com', route = '/ultra/courses/_1_1/assessment/_2_1/overview/student-submission-view';
const page = (raw = {}, html = fixture, site = 'ultra', pathname = route) => {
  const doc = { activeElement: null }; doc.root = new El('html', doc); doc.body = parse(html, doc); doc.head = new El('head', doc); doc.root.prepend(doc.head);
  const events = new Map(), observers = [], sent = [], store = new Map(), timers = new Map(); let timerId = 0;
  const setTimeout = (f, delay) => { timers.set(++timerId, { f, delay }); return timerId; }, clearTimeout = (id) => timers.delete(id);
  const location = new URL(origin + pathname); let settings = G.GZ_SANITIZE({ docreview: raw }), visible = true;
  Object.assign(doc, { documentElement: doc.root, location, createElement: (tag) => new El(tag, doc),
    getElementById: (id) => doc.root.all().find((e) => e.id === id) || null,
    querySelector: (sel) => doc.root.querySelector(sel), querySelectorAll: (sel) => doc.root.querySelectorAll(sel),
    addEventListener: (type, f) => { const a = events.get(type) || []; a.push(f); events.set(type, a); }, removeEventListener: (type, f) => events.set(type, (events.get(type) || []).filter((x) => x !== f)),
  });
  const top = { postMessage: (d, o) => sent.push([d, o]) };
  const c = { URL, console, module: { exports: {} }, document: doc, location, queueMicrotask, setTimeout, clearTimeout, Event: class {},
    GZ_CTABS: { visible: () => visible },
    chrome: { runtime: { getURL: (f) => f } },
    MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  };
  const win = { top, location, setTimeout, clearTimeout, sessionStorage: { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) },
    getComputedStyle: () => ({ transform: 'none', filter: 'none', perspective: 'none', contain: 'none', willChange: 'auto' }), addEventListener() {}, removeEventListener() {} };
  c.window = win; c.globalThis = c; vm.createContext(c); vm.runInContext(source, c);
  const ctx = { site, t: (k) => k, settings: () => settings, on: () => true, tabFrame: '_1_1' };
  const ui = c.module.exports.create(ctx, doc, win); const $ = (s) => doc.querySelector(s);
  return { api: c.module.exports, ui, doc, $, sent, observers, store, win, ctx, c, timers, fire: (type, e = {}) => { for (const f of events.get(type) || []) f(e); }, change: (s) => { settings = G.GZ_SANITIZE({ docreview: s }); ui.sync(); }, hide: () => { visible = false; ui.cover(); },
    key: (key, target = doc.body, extra = {}) => { doc.activeElement = target; const e = { key, target, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra }; for (const f of events.get('keydown') || []) f(e); return e; },
    mutate: async () => { for (const o of observers) o.f([]); await new Promise(setImmediate); } };
};

test('review gates on the exact submitted route, native anchors and verified viewer origin', () => {
  const p = page(); assert.ok(R.recognize(p.doc, 'ultra', route));
  for (const where of ['/ultra/courses/_1_1/assessment/_2_1', route + '/edit', '/courses/1/assignments/2', route.replace('student-submission-view', 'attempt')]) assert.equal(R.recognize(p.doc, 'ultra', where), null);
  for (const [before, after] of [['rubric-inline-container', 'other'], ['js-overall-feedback', 'other'], ['role="tabpanel"', 'role="region"'], ['annotate-us.foundations.blackboard.com', 'evil.example'], ['role="tablist"', 'role="list"']]) {
    const bad = page({}, fixture.replaceAll(before, after)); bad.ui.sync(); assert.equal(bad.doc.root.hasAttribute('data-gz-review'), false); assert.equal(bad.$('[data-gz-review-ui]'), null);
  }
});
test('course tabs in the submission header preserve document review and its native close control', async () => {
  const p = page(), close = p.$('.review-title button'), frame = p.$('iframe');
  p.ui.sync();
  const strip = p.doc.createElement('div'); strip.id = 'gz-ctabs';
  for (const text of ['Course one', 'Course two']) { const b = p.doc.createElement('button'); b.textContent = text; strip.append(b); }
  p.$('.review-title').append(strip); await p.mutate();
  assert.ok(p.doc.root.hasAttribute('data-gz-review'), 'the integrated course strip does not make the native close ambiguous');
  assert.equal(close.getAttribute('data-gz-review-part'), 'close');
  p.ui.enter(); assert.ok(p.doc.root.hasAttribute('data-gz-review-focus'));
  assert.equal(p.$('iframe'), frame); assert.equal(strip.parentNode, p.$('.review-title'));
  p.ui.leave(); p.$('.review-title').append(p.doc.createElement('button')); await p.mutate();
  assert.equal(p.doc.root.hasAttribute('data-gz-review'), false, 'a second native button still fails the strict close gate');
});
test('compact chrome folds and expands feedback in place and preserves the native close button', () => {
  const p = page(); const close = p.$('.review-title button'), feedback = p.$('.feedback-text'); p.ui.sync();
  assert.ok(p.doc.root.hasAttribute('data-gz-review-compact')); const toggle = p.$('#gz-review-feedback');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false'); toggle.dispatchEvent({ type: 'click' });
  assert.ok(p.doc.root.hasAttribute('data-gz-review-feedback')); assert.equal(toggle.textContent, 'Hide feedback');
  toggle.dispatchEvent({ type: 'click' }); assert.equal(p.doc.root.hasAttribute('data-gz-review-feedback'), false);
  assert.equal(p.$('.feedback-text'), feedback); assert.equal(p.$('.review-title button'), close); assert.equal(close.listeners.length, 0);
});
test('focus entry and exit resize by attributes without changing iframe identity, parent or src', () => {
  const p = page(); p.ui.sync(); const frame = p.$('iframe'), parent = frame.parentNode, src = frame.getAttribute('src'), button = p.$('#gz-review-focus'); button.focus();
  p.ui.enter(); assert.ok(p.doc.root.hasAttribute('data-gz-review-focus')); assert.equal(p.doc.activeElement.id, 'gz-review-exit');
  assert.deepEqual(JSON.parse(JSON.stringify(p.sent.at(-1))), [{ gzCtab: 'review', on: true }, origin]);
  p.$('#gz-review-rubric').dispatchEvent({ type: 'click' }); assert.ok(p.doc.root.hasAttribute('data-gz-review-rubric'));
  p.$('#gz-review-details').dispatchEvent({ type: 'click' }); assert.ok(p.doc.root.hasAttribute('data-gz-review-details'));
  p.ui.leave(); assert.equal(p.doc.activeElement, button); assert.equal(p.$('iframe'), frame); assert.equal(frame.parentNode, parent); assert.equal(frame.getAttribute('src'), src);
  assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false); assert.equal(p.sent.at(-1)[0].on, false);
});
test('keyboard ignores editable areas, native buttons, modifiers and the cross-origin iframe; owned Escape exits', () => {
  const p = page(); p.ui.sync();
  for (const tag of ['input', 'textarea', 'select', 'iframe', 'button']) { const el = new El(tag, p.doc); assert.equal(p.key('f', el).prevented, undefined); }
  const edit = new El('div', p.doc); edit.setAttribute('contenteditable', 'true'); assert.equal(p.key('f', edit).prevented, undefined);
  assert.equal(p.key('f', p.doc.body, { ctrlKey: true }).prevented, undefined);
  p.key('f'); assert.ok(p.doc.root.hasAttribute('data-gz-review-focus')); p.key('Escape', p.$('#gz-review-exit')); assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false);
});
test('fullscreen calls the existing iframe and leaves its src alone, with failure announced', async () => {
  const p = page(); p.ui.sync(); const frame = p.$('iframe'), src = frame.getAttribute('src'); let called = 0;
  frame.requestFullscreen = () => { called++; return Promise.resolve(); }; p.$('#gz-review-fullscreen').dispatchEvent({ type: 'click' }); await new Promise(setImmediate); assert.equal(called, 1);
  frame.requestFullscreen = () => Promise.reject(Error('denied')); p.$('#gz-review-fullscreen').dispatchEvent({ type: 'click' }); await new Promise(setImmediate);
  assert.equal(p.$('#gz-review-status').textContent, 'Full screen is unavailable here'); assert.equal(frame.getAttribute('src'), src);
});
test('relay accepts only a boolean review operation from the showing owned frame at the same origin', () => {
  const source = {}, good = { origin, source, data: { gzCtab: 'review', on: true } };
  assert.ok(R.relayable(good, origin, source, true)); assert.ok(R.relayable({ ...good, data: { gzCtab: 'review', on: false } }, origin, source, true));
  for (const e of [{ ...good, origin: 'https://evil.example' }, { ...good, source: {} }, { ...good, data: { gzCtab: 'review', on: 1 } }, { ...good, data: { gzCtab: 'review', on: true, url: '/' } }, { ...good, data: { gzCtab: 'sidebar', on: true } }]) assert.equal(R.relayable(e, origin, source, true), false);
  assert.equal(R.relayable(good, origin, source, false), false);
  const tabs = fs.readFileSync(path.join(__dirname, '../features/coursetabs.js'), 'utf8');
  assert.match(tabs, /const current = \(\) => currentFrame\(from, src\) && src.el.contentDocument === doc/); assert.ok(tabs.includes("el.allow = 'fullscreen;"));
});
test('teardown, all settings off, frame hide, and structure mismatch restore native layout', async () => {
  for (const action of [(p) => p.ui.teardown(), (p) => p.change({ compact: false, fullscreen: false, focus: false }), (p) => p.hide(), async (p) => { p.$('.js-overall-feedback').className = 'changed'; await p.mutate(); }]) {
    const p = page(); p.ui.sync(); const frame = p.$('iframe'), parent = frame.parentNode; p.ui.enter(); await action(p);
    assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false); assert.equal(p.doc.root.hasAttribute('data-gz-review'), false);
    assert.equal(p.$('[data-gz-review-part]'), null); assert.equal(p.$('[data-gz-review-ui]'), null); assert.equal(frame.parentNode, parent); assert.equal(p.sent.at(-1)[0].on, false);
  }
});
test('React replacement exits focus and reapplies only after the entire recognized structure is back', async () => {
  const p = page(); p.ui.sync(); p.ui.enter(); const prior = p.$('iframe'); p.$('student-view-submission').remove(); await p.mutate();
  assert.equal(p.doc.root.hasAttribute('data-gz-review'), false);
  const tmp = { root: new El('div', p.doc) }; const body = parse(fixture, tmp); p.doc.body.append(...body.children); await p.mutate();
  assert.ok(p.doc.root.hasAttribute('data-gz-review')); assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false); assert.notEqual(p.$('iframe'), prior);
});
test('Submit, Save, attempts, grading and editable controls cause no changes or native listeners', () => {
  for (const markup of ['<button type="submit">Submit</button>', '<button>Save</button>', '<button>New attempt</button>', '<input>', '<div contenteditable="true">Work</div>']) {
    const p = page({}, fixture.replace('</main>', markup + '</main>')); const frame = p.$('iframe'), before = frame.parentNode; p.ui.sync(); p.ui.enter();
    assert.equal(p.doc.root.hasAttribute('data-gz-review'), false); assert.equal(frame.parentNode, before); assert.ok(p.doc.body.all().every((e) => !e.listeners.length));
  }
});
test('each setting survives sanitize / JSON round trip and has an editor checkbox', () => {
  assert.deepEqual(G.GZ_DEFAULTS.docreview, { compact: true, fullscreen: true, focus: true, hideBars: true, remember: false });
  const want = { compact: false, fullscreen: false, focus: true, hideBars: false, remember: true };
  assert.deepEqual(G.GZ_SANITIZE(JSON.parse(JSON.stringify(G.GZ_SANITIZE({ docreview: want })))).docreview, want);
  assert.deepEqual(G.GZ_SANITIZE({ docreview: { compact: 'no', unknown: true } }).docreview, G.GZ_DEFAULTS.docreview);
  const options = fs.readFileSync(path.join(__dirname, '../options.html'), 'utf8');
  for (const key of Object.keys(want)) assert.match(options, new RegExp(`type="checkbox" data-key="docreview.${key}"`));
});
test('focus memory is session-scoped, opt-in, and the hide-bars preference updates while focused', () => {
  const p = page({ remember: true }); p.ui.sync(); p.ui.enter(); assert.equal(p.store.get(`gz-review:${route}`), '1');
  p.change({ remember: true, hideBars: false }); assert.equal(p.sent.at(-1)[0].on, false); p.ui.leave(); assert.equal(p.store.get(`gz-review:${route}`), '0');
  const q = page(); q.ui.sync(); q.ui.enter(); assert.equal(q.store.size, 0);
});
test('print restores the native layout and no feature code reparents, clones or reloads the viewer', () => {
  const css = fs.readFileSync(path.join(__dirname, '../features/docreview.css'), 'utf8');
  assert.match(css, /@media screen/); assert.match(css, /@media print \{ \[data-gz-review-ui\]/);
  assert.doesNotMatch(source, /cloneNode|\.src\s*=|append\(a\.|append\(active\.|replaceWith/);
});

test('the actual course-tab relay rechecks document ownership after lazy loading', async () => {
  const tabs = fs.readFileSync(path.join(__dirname, '../features/coursetabs.js'), 'utf8');
  const code = tabs.slice(tabs.indexOf('  const relayReview = '), tabs.indexOf('  const relayTimer = '));
  const doc = { location: { pathname: route }, documentElement: { hasAttribute: () => true } }, source = {}, src = { el: { contentWindow: source, contentDocument: doc } }, calls = [];
  let current = true, release;
  const c = { location: { origin }, ctx: { on: () => true, site: 'ultra', need: () => new Promise((r) => { release = r; }) }, currentFrame: () => current, GZ_DOCREVIEW: { pathOK: R.pathOK, relayable: R.relayable, chrome: (...args) => calls.push(args) } };
  vm.createContext(c); vm.runInContext(code + '\nglobalThis.relayReview = relayReview;', c);
  const event = (on = true) => ({ origin, source, data: { gzCtab: 'review', on } });
  c.relayReview('_1_1', src, event()); release(); await new Promise(setImmediate); assert.equal(calls.length, 1);
  calls.length = 0; c.relayReview('_1_1', src, event()); current = false; release(); await new Promise(setImmediate); assert.equal(calls.length, 0);
  current = true; c.relayReview('_1_1', src, event()); src.el.contentDocument = {}; release(); await new Promise(setImmediate); assert.equal(calls.length, 0);
  src.el.contentDocument = doc; c.relayReview('_1_1', src, { ...event(), origin: 'https://evil.example' }); release(); await new Promise(setImmediate); assert.equal(calls.length, 0);
  c.relayReview('_1_1', src, event('yes')); assert.equal(calls.length, 0);
});
test('source replacement and removal of owned controls exit focus without touching the viewer', async () => {
  for (const change of [(p) => p.$('iframe').setAttribute('src', 'https://annotate-us.foundations.blackboard.com/ui/pdf-viewer/2/index.html'), (p) => p.$('#gz-review-strip').remove()]) {
    const p = page(); p.ui.sync(); p.ui.enter(); const frame = p.$('iframe'); change(p); await p.mutate();
    assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false); assert.equal(p.$('iframe'), frame);
  }
});
test('all five translated catalogues include the new review settings and actions', () => {
  require('../lib/i18n.js');
  for (const code of ['de', 'es', 'fr', 'nl', 'pt-BR']) for (const key of ['Document review', 'Compact submission header', 'Full-screen document button', 'Focus document button', 'Hide Glaze bars in focus', 'Remember document focus for this session', 'Grade and feedback', 'Exit focus']) assert.equal(typeof globalThis.GZ_LANGS[code][key], 'string', `${code}: ${key}`);
});

test('Canvas canvadocs with comment controls stays entirely native; a read-only preview offers review tools', () => {
  const canvas = '<body><div id="content"><div class="submission-details-header"><h1>Submission Details</h1><span class="submission-details-header__grade-summary">5/5</span><span class="submission-details-header__time">Submitted today</span></div><div class="submission-details-container"><div class="submission-details-frame"><iframe id="preview_frame" src="https://canvadocs.instructure.com/1/sessions/abc/view"></iframe></div></div>FORM</div></body>';
  for (const form of ['', '<form><textarea></textarea><button type="submit">Submit comment</button></form>']) {
    const p = page({}, canvas.replace('FORM', form), 'canvas', '/courses/1/assignments/2/submissions/3'); p.ui.sync();
    if (form) { assert.equal(p.doc.root.hasAttribute('data-gz-review'), false); assert.equal(p.$('[data-gz-review-ui]'), null); continue; }
    assert.ok(p.doc.root.hasAttribute('data-gz-review')); assert.equal(p.$('#gz-review-fullscreen').hidden, false);
    assert.equal(p.$('#gz-review-focus').hidden, !!form); assert.equal(p.doc.root.hasAttribute('data-gz-review-compact'), !form);
    p.ui.enter(); assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), !form);
    const submit = p.$('button[type="submit"]'); if (submit) { assert.equal(submit.listeners.length, 0); assert.equal(submit.parentNode.tagName, 'FORM'); }
  }
  const bad = page({}, canvas.replace('FORM', '').replace('canvadocs.instructure.com', 'evil.example'), 'canvas', '/courses/1/assignments/2/submissions/3'); bad.ui.sync(); assert.equal(bad.doc.root.hasAttribute('data-gz-review'), false);
});

// test/fixtures/canvas-submission.html is a real Canvas submission page. Like every student's, it carries the comment box
// (a textarea, Save, Attach File) and a Re-submit link, which review's rule keeps native; docs/features.md says so.
test('a real Canvas submission page stays native for its comment box and Re-submit link, and its header and grade are recognised without them', () => {
  const real = fs.readFileSync(path.join(__dirname, 'fixtures/canvas-submission.html'), 'utf8');
  const where = '/courses/31/assignments/213/submissions/3';
  // The docs make no promise the page can't keep: they say a comment box and a Re-submit link keep Canvas's page native.
  const promise = fs.readFileSync(path.join(__dirname, '../docs/features.md'), 'utf8').split('\n').find((l) => l.startsWith('- **Document review**'));
  assert.match(promise, /Canvas's usual submission page has a comment box and a Re-submit link, so it stays native/);
  assert.doesNotMatch(promise, /read-only Canvas canvadocs previews also qualify/);
  const p = page({}, real, 'canvas', where);
  const frame = p.doc.getElementById('preview_frame');
  assert.equal(p.api.recognize(p.doc, 'canvas', where), null, 'as captured: a text entry, not a document');
  // The preview of a file submission is a same-origin page that frames canvadocs; stand that in.
  frame.contentDocument = { querySelector: () => ({ getAttribute: () => '/api/v1/canvadoc_session?blob=x' }) };
  assert.equal(p.api.recognize(p.doc, 'canvas', where), null, 'a canvadocs preview, but beside the comment box and Re-submit link');
  p.ui.sync();
  assert.equal(p.doc.root.hasAttribute('data-gz-review'), false);
  assert.equal(p.$('[data-gz-review-ui]'), null, 'nothing of Glaze\'s is added');
  // The same page without them (what a read-only variant looks like) is the page the tools are for.
  p.$('.submission-details-comments').remove();
  p.$('.ic-Action-header__Secondary').remove();
  const found = p.api.recognize(p.doc, 'canvas', where);
  assert.ok(found?.canvas && found.frame === frame && found.heading.textContent.includes('Submission Details'), 'recognised');
  p.ui.sync();
  assert.equal(p.doc.root.getAttribute('data-gz-review'), 'canvas');
  assert.equal(p.$('#gz-review-fullscreen').hidden, false);
});

test('composition and retargeted editable events never activate the shortcut', () => {
  const p = page(); p.ui.sync();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { metaKey: true }, { shiftKey: true }]) assert.equal(p.key('f', p.doc.body, extra).prevented, undefined);
  for (const value of ['', 'true', 'plaintext-only']) {
    const el = new El('div', p.doc); el.setAttribute('contenteditable', value);
    assert.equal(p.key('f', p.doc.body, { target: el }).prevented, undefined);
  }
  p.fire('compositionstart'); assert.equal(p.key('f').prevented, undefined); p.fire('compositionend');
  assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false);
});

test('comment controls and actions outside the recognized panel prevent all enhancement', () => {
  for (const control of ['<button>Save and Close</button>', '<button>Submit</button>', '<button>New attempt</button>', '<button aria-label="Add comment">Reply</button>', '<div role="textbox"></div>', '<div contenteditable="plaintext-only"></div>']) {
    for (const html of [fixture.replace('</main>', control + '</main>'), fixture.replace('</body>', control + '</body>')]) {
      const p = page({}, html); p.ui.sync(); p.ui.enter();
      assert.equal(p.doc.root.hasAttribute('data-gz-review'), false, control); assert.equal(p.$('[data-gz-review-ui]'), null);
    }
  }
});

test('focus suspends sidebar and dock through their cover hooks and restores them on exit', () => {
  const p = page(), calls = [];
  p.c.GZ_SIDEBAR_UI = { cover: () => calls.push(['sidebar', p.doc.root.hasAttribute('data-gz-review-focus')]) };
  p.c.GZ_WIDGETS_UI = { cover: () => calls.push(['widgets', p.doc.root.hasAttribute('data-gz-review-focus')]) };
  p.ui.sync(); p.ui.enter(); p.ui.leave();
  assert.deepEqual(calls, [['sidebar', true], ['widgets', true], ['sidebar', false], ['widgets', false]]);
});

test('a containing-block change while focused immediately restores native mode', async () => {
  const p = page(); p.ui.sync(); p.ui.enter();
  p.win.getComputedStyle = () => ({ transform: 'matrix(1,0,0,1,0,0)', filter: 'none', perspective: 'none', contain: 'none', willChange: 'auto' });
  await p.mutate(); assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false);
});

test('an additional native feedback block invalidates the exact structure and exits focus', async () => {
  const p = page(); p.ui.sync(); p.ui.enter(); const frame = p.$('iframe'), extra = new El('div', p.doc);
  extra.textContent = 'Unexpected native content'; p.$('.review-feedback').append(extra); await p.mutate();
  assert.equal(p.doc.root.hasAttribute('data-gz-review'), false); assert.equal(p.$('iframe'), frame); assert.equal(p.sent.at(-1)[0].on, false);
});

test('immersive lease expires without child renewal and renewal does not rebuild its exit button', () => {
  const p = page(), frame = p.$('iframe'), guard = { el: frame, current: () => true };
  p.api.chrome(true, guard); const button = p.$('#gz-review-bars');
  p.api.chrome(true, guard); assert.equal(p.$('#gz-review-bars'), button);
  const lease = [...p.timers.values()].find((x) => x.delay === 4000); assert.ok(lease);
  lease.f(); assert.equal(p.doc.root.hasAttribute('data-gz-review-immersive'), false); assert.equal(p.timers.size, 0);
});

test('fullscreen is rejected on stale structure and settings off exits only owned fullscreen', async () => {
  const p = page(); p.ui.sync(); const frame = p.$('iframe'); let requests = 0, exits = 0;
  frame.requestFullscreen = async () => { requests++; p.doc.fullscreenElement = frame; };
  p.doc.exitFullscreen = async () => { exits++; p.doc.fullscreenElement = null; };
  p.$('#gz-review-fullscreen').dispatchEvent({ type: 'click' }); await new Promise(setImmediate);
  p.change({ compact: false, fullscreen: false, focus: false }); await new Promise(setImmediate); assert.equal(exits, 1);
  const q = page(); q.ui.sync(); const button = q.$('#gz-review-fullscreen'); q.$('iframe').requestFullscreen = async () => requests++;
  q.$('.js-overall-feedback').className = 'changed'; button.dispatchEvent({ type: 'click' }); await new Promise(setImmediate); assert.equal(requests, 1);
});

test('a pending fullscreen request cannot outlive teardown', async () => {
  const p = page(); p.ui.sync(); const frame = p.$('iframe'); let resolve, exits = 0;
  frame.requestFullscreen = () => new Promise((r) => { resolve = () => { p.doc.fullscreenElement = frame; r(); }; });
  p.doc.exitFullscreen = async () => { exits++; p.doc.fullscreenElement = null; };
  p.$('#gz-review-fullscreen').dispatchEvent({ type: 'click' }); p.ui.teardown(); resolve(); await new Promise(setImmediate);
  assert.equal(exits, 1); assert.equal(p.doc.fullscreenElement, null);
});

test('overlapping fullscreen clicks cannot erase ownership of a successful request', async () => {
  const p = page(); p.ui.sync(); const frame = p.$('iframe'), pending = []; let exits = 0;
  frame.requestFullscreen = () => new Promise((resolve, reject) => pending.push({ resolve: () => { p.doc.fullscreenElement = frame; resolve(); }, reject }));
  p.doc.exitFullscreen = async () => { exits++; p.doc.fullscreenElement = null; };
  const button = p.$('#gz-review-fullscreen'); button.dispatchEvent({ type: 'click' }); button.dispatchEvent({ type: 'click' });
  pending[0].resolve(); await new Promise(setImmediate); pending[1]?.reject(Error('already requested')); await new Promise(setImmediate);
  p.change({ fullscreen: false }); await new Promise(setImmediate); assert.equal(exits, 1); assert.equal(p.doc.fullscreenElement, null);
});

test('native inline styles, classes and pre-existing part markers survive teardown exactly', () => {
  const p = page(); const frame = p.$('iframe'); frame.setAttribute('style', 'height: 81%; border: 2px solid red'); frame.className = 'native viewer'; frame.setAttribute('data-gz-review-part', 'prior');
  const before = [frame.getAttribute('style'), frame.className, frame.getAttribute('data-gz-review-part')];
  p.ui.sync(); p.ui.enter(); p.ui.teardown(); assert.deepEqual([frame.getAttribute('style'), frame.className, frame.getAttribute('data-gz-review-part')], before);
});

test('a lost extension context ends focus and stops lease renewal', () => {
  const p = page(); p.ui.sync(); p.ui.enter(); p.ctx.on = () => false;
  const pulse = [...p.timers.values()].find((x) => x.delay === 1000); pulse.f();
  assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false); assert.equal(p.timers.size, 0); assert.equal(p.sent.at(-1)[0].on, false);
});

test('immersive chrome restores on a hidden/replaced frame, frame load and explicit exit', () => {
  for (const action of ['hidden', 'load', 'exit']) {
    const p = page(); const frame = p.$('iframe'); let current = true;
    p.api.chrome(true, { el: frame, current: () => current }); assert.ok(p.doc.root.hasAttribute('data-gz-review-immersive')); assert.ok(p.$('#gz-review-bars'));
    if (action === 'hidden') { current = false; p.observers.at(-1).f([]); }
    else if (action === 'load') frame.dispatchEvent({ type: 'load' });
    else p.api.restoreChrome();
    assert.equal(p.doc.root.hasAttribute('data-gz-review-immersive'), false); assert.equal(p.$('#gz-review-bars'), null);
  }
});
test('a transformed ancestor prevents focus without changing the iframe or entering immersive mode', () => {
  const p = page(); p.ui.sync(); p.win.getComputedStyle = () => ({ transform: 'matrix(1,0,0,1,0,0)', filter: 'none', perspective: 'none', contain: 'none', willChange: 'auto' });
  const frame = p.$('iframe'); p.ui.enter(); assert.equal(p.doc.root.hasAttribute('data-gz-review-focus'), false); assert.equal(p.$('iframe'), frame); assert.equal(p.sent.length, 0);
});
