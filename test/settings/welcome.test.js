// Glaze's first screen (settings/welcome.js): what a student types becomes the one site Glaze asks for.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../extension/settings/welcome.js');

test('the button says what it will do', () => {
  const s = require('../../extension/core/site.js').address('bb.school.edu');
  assert.equal(W.act(null, false), 'none');
  assert.equal(W.act(null, true), 'none');
  assert.equal(W.act(s, false), 'allow');
  assert.equal(W.act(s, true), 'open');
});

test('the page wears each Look from its definition, and asks only from a click', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension/settings', f), 'utf8');
  const js = read('welcome.js'), wizard = read('setup.js');
  assert.match(wizard, /GZ_LOOKS\.find\(\(l\) => l\.name === 'Frostdev'\)/, 'the splash wears Frostdev as defaults.js defines it');
  assert.match(wizard, /GZ_LOOK_PARTS\(L\)/, 'a Look\'s pointers and effects from its own parts');
  // Every request sits in a click or submit handler, before any await: All sites here, a school through core/site.js allow
  // (shared with Settings → Sites), which asks first thing.
  const requests = [...js.matchAll(/chrome\.permissions\.request\(/g)].length;
  assert.equal(requests, 1);
  assert.doesNotMatch(js, /await[^;\n]*\n?[^;\n]*chrome\.permissions\.request/);
  assert.match(js, /\ballow\(s, \{ checking: /, 'a school goes through core/site.js allow');
  assert.doesNotMatch(js, /chrome\.permissions\.remove\(/, 'core/site.js hands a grant back, not the page');
  for (const src of [js, wizard]) assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|WebSocket|GZ_FONTS\.load/, 'the page itself fetches nothing: only core/site.js, at the sites the student names');
  assert.doesNotMatch(wizard, /chrome\.permissions\./, 'the wizard asks for no site');
});

// The wizard's own rules (settings/setup.js).
const G = require('../../extension/content/defaults.js');
const S = require('../../extension/settings/setup.js');

test('every switch in the wizard is a setting, and a fresh install shows what it will get', () => {
  const fresh = G.GZ_SANITIZE({}, true);
  for (const [key, label, needs] of S.FEATURES.flatMap((f) => f.keys)) {
    const [g, k] = key.split('.');
    assert.equal(G.GZ_SPEC[g]?.[k]?.[1], 'bool', key);
    assert.ok(label && typeof S.get(fresh, key) === 'boolean', key);
    if (needs) assert.ok(S.FEATURES.some((f) => f.keys.some(([x]) => x === needs)), `${key} waits on a switch the wizard shows`);
  }
  assert.equal(new Set(S.FEATURES.map((f) => f.id)).size, S.FEATURES.length);
  assert.equal(S.get(fresh, 'enhance.notes'), true, 'notes start on for a fresh install');
  assert.equal(S.get(fresh, 'enhance.remind'), false, 'reminders start off');
  assert.equal(S.count(fresh), S.FEATURES.flatMap((f) => f.keys).filter(([k]) => S.get(fresh, k)).length);
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension/settings/welcome.html'), 'utf8');
  for (const f of S.FEATURES) assert.match(html, new RegExp(`data-art="${f.id}"`), `${f.id} has a picture`);
});

test('a switch writes its whole group with the one value changed', () => {
  const s = G.GZ_SANITIZE({}, true);
  const patch = S.change(s, 'enhance.notes', false);
  assert.deepEqual(Object.keys(patch), ['enhance']);
  assert.deepEqual(patch.enhance, { ...s.enhance, notes: false });
  assert.equal(s.enhance.notes, true, 'the settings themselves are untouched');
});

test('a Look is put on as Settings puts it on, and Glaze\'s own theme leaves light and dark alone', () => {
  const s = G.GZ_SANITIZE({ auto: { on: true }, look: { tooltips: false }, bg: { image: 'https://pics.example/a.jpg' } });
  const L = G.GZ_LOOKS.find((l) => l.name === 'Library');
  assert.deepEqual(S.theme(s, L), G.GZ_LOOK_APPLY(s, L));
  const own = S.theme(s, S.OWN);
  assert.equal('auto' in own, false);
  assert.deepEqual(own.colors, G.GZ_DEFAULTS.colors);
  assert.equal(own.preset, G.GZ_DEFAULTS.preset);
  assert.equal(own.look.tooltips, false, 'the student\'s tooltips kept');
  assert.equal(own.bg.image, 'https://pics.example/a.jpg', 'and their picture');
  assert.equal(S.worn(G.GZ_SANITIZE({})), S.OWN, 'a fresh install wears Glaze\'s own theme');
  assert.equal(S.worn({ ...G.GZ_SANITIZE({}), ...G.GZ_LOOK_APPLY(G.GZ_SANITIZE({}), L) }), L);
  assert.equal(S.worn(G.GZ_SANITIZE({ colors: { '--gz-accent': '#123456' } })), null, 'a palette of their own is no Look');
  assert.equal(S.LOOKS.length, G.GZ_LOOKS.length + 1);
});

test('the page shows the motion chosen, off where the system asks and the student follows it', () => {
  const s = G.GZ_SANITIZE({});
  assert.equal(S.level(s, false), 'expressive');
  assert.equal(S.level(s, true), 'off');
  assert.equal(S.level({ ...s, motion: { ...s.motion, followSystem: false } }, true), 'expressive');
  assert.equal(S.level({ ...s, motion: { ...s.motion, level: 'subtle' } }, false), 'subtle');
});

test('each step is an address, and Next and Back walk the feature slides', () => {
  const last = S.FEATURES.length - 1;
  assert.deepEqual(S.at(''), { step: 'start', slide: 0 });
  assert.deepEqual(S.at('#nope'), { step: 'start', slide: 0 });
  assert.deepEqual(S.at('#/features/notes'), { step: 'features', slide: S.FEATURES.findIndex((f) => f.id === 'notes') });
  assert.deepEqual(S.at('#/features/nope'), { step: 'features', slide: 0 });
  for (const step of S.STEPS) assert.deepEqual(S.at(S.hashOf({ step, slide: 0 })), { step, slide: 0 });
  assert.equal(S.hashOf({ step: 'features', slide: last }), `#/features/${S.FEATURES[last].id}`);
  assert.deepEqual(S.at('#school'), { step: 'school', slide: 0 }, 'a hash without its slash still finds its step');
  assert.deepEqual(S.move({ step: 'start', slide: 0 }, -1), { step: 'start', slide: 0 });
  assert.deepEqual(S.move({ step: 'motion', slide: 0 }, 1), { step: 'features', slide: 0 });
  assert.deepEqual(S.move({ step: 'features', slide: 0 }, 1), { step: 'features', slide: 1 });
  assert.deepEqual(S.move({ step: 'features', slide: last }, 1), { step: 'school', slide: 0 });
  assert.deepEqual(S.move({ step: 'school', slide: 0 }, -1), { step: 'features', slide: last });
  assert.deepEqual(S.move({ step: 'features', slide: 0 }, -1), { step: 'motion', slide: 0 });
  assert.deepEqual(S.move({ step: 'done', slide: 0 }, 1), { step: 'done', slide: 0 });
});

// Run the shipped page while the worker's second check is pending: a quick Open must never race registration.
const screen = ({ granted = true, found = { kind: 'ultra', url: 'https://bb.school.edu/' }, patterns = [] } = {}) => {
  const vm = require('node:vm');
  const elements = new Map();
  const element = (name) => {
    if (!elements.has(name)) elements.set(name, {
      value: '', dataset: {}, hidden: true, handlers: {}, attributes: new Map(),
      addEventListener(type, fn) { this.handlers[type] = fn; },
      querySelector: (s) => element(`${name} ${s}`),
      setAttribute(k, v) { this.attributes.set(k, v); },
      removeAttribute(k) { this.attributes.delete(k); },
      toggleAttribute(k, on) { if (on) this.attributes.set(k, ''); else this.attributes.delete(k); },
      replaceChildren() {}, append() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
      style: { setProperty() {} }, classList: { remove() {} },
    });
    return elements.get(name);
  };
  const messages = [], removed = [], held = new Set();
  let answer;
  const context = vm.createContext({
    document: { querySelector: element, documentElement: element('html'), body: element('body'), createElement: element, dispatchEvent() {} },
    URL,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    GZ_I18N: { t: (s) => s, ui() {}, page() {} },
    GZ_LOOKS: [{ name: 'Frostdev', colors: {}, bg: {} }], GZ_LOOK_PARTS: () => ({}),
    setTimeout() {}, clearTimeout() {}, CustomEvent: class {},
    chrome: {
      runtime: { id: 'glaze', getManifest: () => ({ host_permissions: patterns }), getURL: (p) => `chrome-extension://glaze/${p}`, sendMessage: (m) => {
        messages.push(m);
        return m.op === 'yes' ? new Promise((r) => { answer = r; }) : Promise.resolve({ ok: true });
      } },
      permissions: {
        contains: async () => false, getAll: async () => ({ origins: [...held] }),
        request: async ({ origins }) => { if (granted) origins.forEach((o) => held.add(o)); return granted; },
        remove: async (p) => { removed.push(...p.origins); p.origins.forEach((o) => held.delete(o)); },
      },
    },
  });
  const read = (f) => require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension', f), 'utf8');
  // As welcome.html loads it, with the school's answers the test's.
  vm.runInContext(read('core/site.js'), context);
  Object.assign(context.GZ_SITE, { probe: async () => found, nearby: async () => [] });
  vm.runInContext(read('settings/welcome.js'), context);
  return { element, messages, removed, reply: (r) => answer(r) };
};
const tick = () => new Promise(setImmediate);

test('first screen waits for the worker to approve and register before offering Open', async () => {
  const s = screen(), bar = s.element('.bar'), go = s.element('#go');
  await tick();
  s.element('#address').value = 'bb.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(s.messages.at(-1).op, 'yes', 'the page found the LMS and asked for the worker check');
  assert.equal(go.attributes.has('data-busy'), true, 'Open stays blocked during the worker check');
  assert.notEqual(bar.dataset.state, 'done', 'no success before registration');
  s.reply({ ok: true });
  await tick();
  assert.equal(go.attributes.has('data-busy'), false);
  assert.equal(bar.dataset.state, 'done');
});

test('first screen does not report success when the worker rejects the second check', async () => {
  const s = screen();
  await tick();
  s.element('#address').value = 'bb.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  s.reply({ ok: false });
  await tick();
  assert.notEqual(s.element('.bar').dataset.state, 'done');
  assert.equal(s.element('#go').attributes.has('data-busy'), false, 'the student can retry');
  assert.equal(s.element('#note').hidden, false, 'a failed approval is visible');
});


test('a dismissed first-run prompt tells the worker to stop waiting for its page', async () => {
  const s = screen({ granted: false });
  await tick();
  s.element('#address').value = 'bb.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  assert.deepEqual(s.messages.map((m) => m.op), ['ask', 'cancel']);
  assert.equal(s.element('#go').attributes.has('data-busy'), false);
});


test('a failed first-run probe never hands back a required host, including a Firefox re-grant', async () => {
  for (const patterns of [['https://*.instructure.com/*'], ['https://school.instructure.com/*'], ['<all_urls>']]) {
    const s = screen({ found: 'none', patterns });
    await tick();
    s.element('#address').value = 'school.instructure.com';
    s.element('#site').handlers.submit({ preventDefault() {} });
    await tick();
    assert.deepEqual(s.removed, [], patterns.join(', '));
  }
});

test('a failed first-run probe still hands back an optional host', async () => {
  const s = screen({ found: 'none', patterns: ['https://*.instructure.com/*'] });
  await tick();
  s.element('#address').value = 'www.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  assert.deepEqual(s.removed, ['https://www.school.edu/*']);
});

// Run the wizard itself with controllable storage reads and broker replies.
const wizardScreen = () => {
  const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
  class Element {
    constructor(tag = '') { this.tag = tag; this.dataset = {}; this.style = { setProperty() {} }; this.classList = { add() {}, remove() {} }; this.attrs = {}; this.children = []; this.handlers = {}; this.hidden = true; this.textContent = ''; this.isConnected = true; this.offsetTop = 0; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { if (this.children.includes(document.activeElement)) document.activeElement = document.body; this.children = children; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return this.attrs[k]; }
    removeAttribute(k) { delete this.attrs[k]; }
    addEventListener(k, fn) { this.handlers[k] = fn; }
    focus() { document.activeElement = this; }
    closest() { return this; }
    contains(e) { return this.children.includes(e); }
    querySelector(q) { if (!this.sub) this.sub = {}; return this.sub[q] ||= new Element(q); }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1, height: 1 }; }
  }
  const elements = new Map(), get = (key) => { if (!elements.has(key)) elements.set(key, new Element(key)); return elements.get(key); };
  const document = { documentElement: get('html'), body: get('body'), activeElement: null, querySelector: get, getElementById: (id) => get(`#${id}`), querySelectorAll: () => [], createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag), addEventListener() {}, dispatchEvent() {} };
  document.activeElement = document.body;
  const reads = [], replies = [], events = {};
  const looks = G.GZ_LOOKS.map((l) => l.name === 'Frostdev' ? { ...l, bg: { kind: 'solid' } } : l);
  const context = vm.createContext({ document, ...G, GZ_LOOKS: looks, GZ_I18N: { t: (s) => s, ui() {} }, GZ_LOOK_PARTS: () => null, GZ_LX: { CURSORS: {} }, GZ_COLOR: { brightness: () => 0, parse: () => ({}) }, CSS: { supports: () => false }, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { hash: '#/motion', assign() {} }, navigator: { platform: 'Mac' }, getComputedStyle: () => ({ direction: 'ltr' }), addEventListener: (name, fn) => { events[name] = fn; }, scrollTo() {}, requestAnimationFrame() {}, setTimeout() { return 1; }, clearTimeout() {}, CustomEvent: class {}, chrome: { runtime: { id: 'glaze', getURL: (p) => p, sendMessage: () => new Promise((resolve) => replies.push(resolve)) }, storage: { sync: { get: () => new Promise((resolve) => reads.push(resolve)) }, local: { get: async () => ({ freshDefaults: { fresh: true } }) }, onChanged: { addListener: (fn) => { events.changed = fn; } } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/settings/setup.js'), 'utf8'), context);
  return { get, reads, replies, events, document, location: context.location };
};

test('wizard keeps a chosen motion through late reads and applies later synced motion', async () => {
  const w = wizardScreen(), levels = w.get('#levels').children;
  levels[0].handlers.click();
  w.reads[0]({ motion: { level: 'expressive' } });
  await tick();
  assert.equal(levels[0].attrs['aria-checked'], 'true', 'an old read cannot undo the pending choice');
  assert.equal(w.get('html').attrs['data-gz-motion'], 'off');
  w.replies[0]({ ok: true });
  await tick();
  w.reads.at(-1)({ motion: { level: 'off' } });
  await tick();
  w.events.changed({ motion: {} }, 'sync');
  w.reads.at(-1)({ motion: { level: 'subtle' } });
  await tick();
  assert.equal(levels[1].attrs['aria-checked'], 'true');
  assert.equal(w.get('html').attrs['data-gz-motion'], 'subtle', 'the page follows synced motion too');
});

test('wizard preserves a pending theme and ignores storage reads answered out of order', async () => {
  const w = wizardScreen(), cards = w.get('#looks').children;
  const library = cards.find((card) => card.dataset.look === 'Library');
  library.handlers.click();
  w.reads[0]({});
  await tick();
  assert.equal(library.attrs['aria-checked'], 'true', 'a read during the debounce keeps the chosen Look');
  w.events.changed({ motion: {} }, 'sync');
  w.events.changed({ motion: {} }, 'sync');
  w.reads[2]({ motion: { level: 'off' } });
  await tick();
  w.reads[1]({ motion: { level: 'expressive' } });
  await tick();
  assert.equal(w.get('html').attrs['data-gz-motion'], 'off', 'an older read cannot overwrite the latest');
});

test('motion off stops the motion previews and transitions as well as feature art', () => {
  const fs = require('node:fs'), path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '../../extension/settings/welcome.css'), 'utf8');
  assert.match(css, /html\[data-gz-motion="off"\]\s+\*[^{}]*\{[^}]*animation:\s*none\s*!important[^}]*transition:\s*none\s*!important/s);
});


test('browser history keeps focus when it replaces a feature slide', async () => {
  const w = wizardScreen();
  w.location.hash = '#/features/sidebar';
  w.events.hashchange();
  w.get('#feature-switches').children[0].focus();
  w.location.hash = '#/features/notes';
  w.events.hashchange();
  assert.equal(w.document.activeElement, w.get('#feature-title'));
});

test('summary keeps its labels accessible', () => {
  const w = wizardScreen();
  w.location.hash = '#/done';
  w.events.hashchange();
  const terms = w.get('#summary').children.filter((e) => e.tag === 'dt');
  assert.ok(terms.length > 0);
  assert.ok(terms.every((e) => e.className === 'sr-only'), 'summary terms remain available to assistive technology');
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension/settings/welcome.css'), 'utf8');
  assert.doesNotMatch(css, /\.summary\s+dt\s*\{[^}]*display:\s*none/);
});

test('save errors remain visible on the last step', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension/settings/welcome.css'), 'utf8');
  assert.match(css, /\.toast:not\(\[hidden\]\)\s*\{[^}]*visibility:\s*visible/);
});

test('the worker takes from the first screen exactly the switches the wizard shows', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../extension/background/background.js'), 'utf8');
  const listed = JSON.parse(src.match(/\n {2}setup: \{[\s\S]*?const switches = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
  const shown = [...S.FEATURES.flatMap((f) => f.keys.map(([k]) => k)).filter((k) => k !== 'navbar.on'), 'motion.followSystem', 'extras.pointerAnim'];
  assert.deepEqual([...listed].sort(), [...shown].sort());
});
