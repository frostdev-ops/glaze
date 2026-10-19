// Frame ownership and Canvas card-menu saves, with the existing stand-in DOM. No browser or live server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');
const C = require('../lib/color.js');
const { El } = require('./stand-in-dom.js');
const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const origin = 'https://audit.instructure.com', cid = `canvas:${origin}/31`;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const only = (...ids) => ({ tiles: W.TILES.map((id) => ({ id, on: ids.includes(id) })) });

class E extends El {
  get href() { return new URL(this.getAttribute('href') || '', origin).href; }
  set href(v) { this.setAttribute('href', v); }
  get tabIndex() { return +(this.getAttribute('tabindex') ?? 0); }
  set tabIndex(v) { this.setAttribute('tabindex', v); }
  getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }
  querySelectorAll(sel) {
    if (sel === 'a[href*="/courses/"]') return this.all().filter((e) => e.tagName === 'A' && e.getAttribute('href')?.includes('/courses/'));
    if (sel === '.ic-DashboardCard:not([data-gz-tile-card])') return this.all().filter((e) => e.className === 'ic-DashboardCard' && !e.hasAttribute('data-gz-tile-card'));
    return super.querySelectorAll(sel);
  }
}
const environment = () => {
  const doc = {}, make = (tag, props = {}, ...kids) => { const e = Object.assign(new E(tag, doc), props); e.append(...kids); return e; };
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body);
  const events = new Map(), timers = new Map(); let serial = 0;
  const add = (type, fn) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); };
  Object.assign(doc, { documentElement: doc.root, activeElement: doc.body, visibilityState: 'visible', cookie: '_csrf_token=synthetic-audit-token',
    createElement: (tag) => make(tag), createTextNode: (textContent) => ({ textContent }),
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: (id) => doc.root.all().find((e) => e.id === id) || null,
    addEventListener() {}, removeEventListener() {} });
  const c = { document: doc, location: { origin, pathname: '/' }, URL, console, Intl, structuredClone, ...D, GZ_COLOR: C,
    innerWidth: 1280, innerHeight: 900, matchMedia: () => ({ matches: false }),
    addEventListener: add, removeEventListener: (type, fn) => events.get(type)?.delete(fn),
    setTimeout: (fn, ms = 0) => { const id = ++serial; timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timers.delete(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {}, Node: E,
  };
  c.window = c; c.top = c; c.globalThis = c;
  const context = vm.createContext(c);
  const runTimers = async () => { for (const [id, { fn }] of [...timers]) { timers.delete(id); fn(); } await settle(); };
  return { c, doc, make, context, timers, runTimers, fire: (type, extra = {}) => { for (const fn of [...events.get(type) || []]) fn({ type, ...extra }); },
    event: (el, type, extra = {}) => el.dispatchEvent({ type, target: el, isTrusted: true, preventDefault() {}, stopPropagation() {}, ...extra }) };
};

const widgets = ({ frame = false, raw = only('notes'), where = '/', pet = false } = {}) => {
  const p = environment(), { c, doc, make } = p;
  c.location.pathname = where; if (frame) c.top = {};
  doc.body.append(make('header', { id: 'dashboard_header_container' }));
  const loads = [], counts = { profile: 0, resume: 0 }, store = { widgetLayout: structuredClone(raw) };
  c.GZ_WIDGETS = W; c.GZ_I18N = { locale: () => 'en' }; c.GZ_PET_UI = { resume: () => counts.resume++ };
  c.GZ_CTX = { site: 'canvas', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v[n]), locale: () => 'en', settings: () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, pet } }),
    profile: async () => { counts.profile++; return { id: '42', time_zone: 'UTC' }; }, need: async (f) => loads.push(f) };
  c.chrome = { runtime: { id: 'audit', sendMessage: (m, cb) => cb({ ok: true, timer: W.IDLE }) }, storage: {
    local: { get: (keys, cb) => cb(Object.fromEntries([keys].flat().map((k) => [k, store[k]]))) }, sync: { get: (keys, cb) => cb({}) }, onChanged: { addListener() {}, removeListener() {} },
  } };
  doc.boxOf = (e) => e.className === 'gz-dash-grid' ? { left: 24, top: 140, width: 1232, height: parseFloat(e.style.height) || 0 }
    : e.className === 'gz-w-body' ? { left: 0, top: 0, width: 200, height: 150 } : null;
  const ui = vm.runInContext(read('features/widgets.js'), p.context); ui.sync(true);
  return { ...p, ui, loads, counts, tile: (id) => doc.querySelector(`section[data-tile="${id}"]`) };
};

test('top-page floating notes have one owner and one profile request across sync passes', async () => {
  const raw = only(); raw.tiles[0] = { id: 'notes', on: true, float: true };
  const p = widgets({ raw, where: '/courses/31' }); await settle(); const note = p.tile('notes');
  assert.ok(note); assert.equal(note.getAttribute('data-float'), ''); assert.equal(p.counts.profile, 1);
  for (let i = 0; i < 4; i++) p.ui.sync(true); await settle();
  assert.equal(p.tile('notes'), note); assert.equal(p.doc.querySelectorAll('section[data-tile="notes"]').length, 1); assert.equal(p.counts.profile, 1);
});

test('a Dashboard page frame keeps its board but does not duplicate top-page floats or pet resume', async () => {
  let raw = W.layout(only('timer')); raw = W.apply(raw, { ops: [{ s: 'canvas', id: 'notes', set: { on: true, float: true } }] });
  const p = widgets({ frame: true, raw, pet: true }); await settle();
  assert.ok(p.tile('timer'), 'the frame still owns its Dashboard board'); assert.equal(p.tile('notes'), null);
  assert.equal(p.doc.querySelector('#gz-floats'), null); assert.equal(p.counts.profile, 0); assert.equal(p.counts.resume, 0);
  assert.ok(!p.loads.includes('features/pet.js'));
});

test('a course frame creates no floating widgets and asks for no identity', async () => {
  const raw = only(); raw.tiles[0] = { id: 'notes', on: true, float: true };
  const p = widgets({ frame: true, raw, where: '/courses/31' }); await settle();
  assert.equal(p.doc.querySelector('.gz-w'), null); assert.equal(p.counts.profile, 0); assert.equal(p.counts.resume, 0);
});

test('the Canvas widgets loader permits Dashboard page frames and rejects course frames', async () => {
  const p = environment(), calls = [], loads = []; p.c.top = {}; p.c.location.pathname = '/';
  p.c.GZ_WIDGETS_UI = { sync: (on) => calls.push(on) };
  const input = { links: [{}], tabFrame: '31', settings: { enhance: { widgets: true } }, need: async (f) => loads.push(f) };
  const site = vm.runInContext(read('content-canvas.js'), p.context)(input);
  site.syncWidgets(); await settle(); assert.deepEqual(calls, [false]); assert.deepEqual(loads, []);
  input.tabFrame = 'page'; site.syncWidgets(); await settle(); assert.deepEqual(calls, [false, true]); assert.deepEqual(loads, ['features/widgets.js']);
});

const courseWidget = () => {
  const p = environment(), { c, doc, make } = p;
  const hero = make('div', { className: 'ic-DashboardCard__header_hero' }); hero.style.backgroundColor = '#123456';
  const image = make('div', { className: 'ic-DashboardCard__header_image' }, hero); image.style.backgroundImage = 'url("https://audit.instructure.com/course-picture.png")';
  const native = make('div', { className: 'ic-DashboardCard' }, image, make('a', { href: '/courses/31' },
    make('h2', { className: 'ic-DashboardCard__header-title', textContent: 'My course' }), make('div', { className: 'ic-DashboardCard__header-subtitle', textContent: 'CODE' })));
  doc.body.append(native); let reads = 0;
  c.GZ_WIDGETS = W; c.GZ_CARD_UI = { paint() {} };
  c.chrome = { runtime: { id: 'audit' }, storage: { onChanged: { addListener() {} } } };
  c.GZ_CTX = { site: 'canvas', on: () => true, t: (k) => k, nickOf: () => '', courseList: () => ({ [cid]: { name: 'API course', code: 'CODE', color: '#123456' } }),
    settings: () => D.GZ_SANITIZE({}), canvasCourses: async () => { reads++; return [{ id: '31', name: 'API course' }]; }, need: async () => {} };
  const ui = vm.runInContext(read('features/coursecards.js'), p.context); ui.sync();
  const body = make('div'); doc.body.append(body); const tile = ui.fill(body, { id: `course:${origin}/31`, term: () => '' });
  return { ...p, ui, body, native, tile, reads: () => reads };
};

test('course widgets keep their Canvas DOM and share metadata across repeated refreshes', async () => {
  const p = courseWidget(); await settle(); const card = p.body.querySelector('.ic-DashboardCard'), image = card.querySelector('.ic-DashboardCard__header_image');
  assert.equal(card.getAttribute('aria-label'), 'My course'); assert.equal(image.style.backgroundImage, 'url("https://audit.instructure.com/course-picture.png")');
  for (let i = 0; i < 4; i++) { p.ui.sync(); p.tile.update(); } await settle();
  assert.equal(p.body.querySelector('.ic-DashboardCard'), card); assert.equal(p.body.querySelector('.ic-DashboardCard__header_image'), image); assert.equal(p.reads(), 1);
});

test('BUG: course widgets retain their image while Canvas replaces its native cards', async () => {
  const p = courseWidget(); await settle(); const image = p.body.querySelector('.ic-DashboardCard__header_image'), before = image.style.backgroundImage;
  assert.ok(before, 'the widget has the native course picture before the redraw');
  p.native.remove(); p.ui.sync(); p.tile.update();
  const during = image.style.backgroundImage;
  p.doc.body.append(p.native); p.ui.sync(); p.tile.update(); assert.equal(image.style.backgroundImage, before);
  assert.equal(during, before, 'a missing native card during a re-render must not blank the already-mounted widget picture');
});

const menu = ({ answer = async () => ({ ok: true, json: async () => ({}) }) } = {}) => {
  const p = environment(), { c, doc, make } = p, calls = [], edits = [];
  const hero = make('div', { className: 'ic-DashboardCard__header_hero' }); hero.style.backgroundColor = '#123456';
  const title = make('h2', { className: 'ic-DashboardCard__header-title' }, make('span', { textContent: 'Original course' }));
  const native = make('button', { className: 'ic-DashboardCard__header-button' }); native.click = () => edits.push('native-menu');
  const button = make('button', { className: 'gz-cm-btn' }); button.dataset.cid = cid;
  const card = make('div', { className: 'ic-DashboardCard' }, hero, make('a', { href: '/courses/31' }, title), native, button); doc.body.append(card);
  const settings = D.GZ_SANITIZE({ enhance: { coursemenu: true } });
  c.chrome = { runtime: { id: 'audit' }, storage: { sync: { set: (v, cb) => cb?.() } } };
  c.GZ_CTX = { site: 'canvas', t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v[n]), make,
    settings: () => settings, nickOf: () => '', courseList: () => ({ [cid]: { name: 'Original course' } }), courseColors: () => ({}),
    canvasCourses: async () => [{ id: '31', name: 'Original course' }], setCourses: (courses) => { settings.courses = courses; }, cardUI() {} };
  c.GZ_COURSE_CARDS = { canvasEdit: (id, patch) => edits.push([id, patch]) };
  c.fetch = async (url, options) => { calls.push({ url, options }); return answer(url, options); };
  const ui = vm.runInContext(read('features/coursemenu.js'), p.context); ui.toggle(button);
  return { ...p, ui, calls, edits, hero, title, button, custom: () => doc.querySelector('.gz-cm-custom'), note: () => doc.querySelector('.gz-cm-note') };
};

test('Canvas menu restores the last confirmed color and reports API failure', async () => {
  const p = menu({ answer: async () => ({ ok: false, status: 503 }) }); await settle();
  p.custom().value = '#abcdef'; p.event(p.custom(), 'input'); assert.equal(p.hero.style.backgroundColor, '#abcdef');
  await p.runTimers(); assert.equal(p.calls.length, 1); assert.equal(p.hero.style.backgroundColor, '#123456');
  assert.equal(p.note().textContent, 'Not saved. Try again in a moment.'); assert.equal(p.note().hidden, false);
});

test('Canvas menu coalesces color drags and saves with same-origin credentials and CSRF', async () => {
  const p = menu(); await settle();
  for (const hex of ['#abcdef', '#112233', '#445566']) { p.custom().value = hex; p.event(p.custom(), 'input'); }
  assert.equal(p.calls.length, 0); await p.runTimers(); assert.equal(p.calls.length, 1);
  const { url, options } = p.calls[0]; assert.equal(url, `${origin}/api/v1/users/self/colors/course_31`);
  assert.equal(options.credentials, 'same-origin'); assert.equal(options.redirect, 'error'); assert.equal(options.headers['x-csrf-token'], 'synthetic-audit-token');
  assert.deepEqual(JSON.parse(options.body), { hexcode: '#445566' });
});

test('Canvas menu fails closed without a CSRF token and restores the color', async () => {
  const p = menu(); await settle(); p.doc.cookie = '';
  p.custom().value = '#abcdef'; p.event(p.custom(), 'input'); await p.runTimers();
  assert.equal(p.calls.length, 0); assert.equal(p.hero.style.backgroundColor, '#123456'); assert.equal(p.note().hidden, false);
});

test('Canvas menu nickname failures restore both native and widget card names', async () => {
  const p = menu({ answer: async () => { throw new Error('offline'); } }); await settle();
  const nick = p.doc.getElementById('gz-cm-nick'); assert.equal(nick.disabled, false);
  nick.value = 'My nickname'; p.event(nick, 'input'); p.event(nick, 'change'); await settle();
  assert.equal(p.calls.length, 1); assert.equal(p.title.textContent, 'Original course');
  assert.deepEqual(structuredClone(p.edits.at(-1)), ['31', { name: 'Original course' }]); assert.equal(p.note().hidden, false);
});

test('BUG: Canvas color edits flush before a persisted pagehide freezes their debounce', async () => {
  const p = menu(); await settle(); p.custom().value = '#abcdef'; p.event(p.custom(), 'input');
  assert.equal(p.calls.length, 0, 'the 500ms debounce has not elapsed');
  p.fire('pagehide', { persisted: true }); await settle();
  assert.equal(p.calls.length, 1, 'navigation within 500ms must save the optimistic Canvas color before the page enters BFCache');
  assert.deepEqual(JSON.parse(p.calls[0].options.body), { hexcode: '#abcdef' });
});
