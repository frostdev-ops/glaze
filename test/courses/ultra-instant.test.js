// Instant copies of Ultra's Grades, Courses list and Activity (S, courses/instant.js, courses/page/instant.js,
// enhance.instant): the allowlist rebuild and its bounds against the real pages' shapes (test/fixtures/ultra-instant-*.html,
// synthetic text) on the stand-in DOM, each page's ready markers, the page script in a VM (painted only for the confirmed
// student, gone when Ultra's view is ready, kept again then, nothing with the switch off), content-ultra.js's hooks, and
// the worker's purges (sign-out, the switch off).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const L = require('../../extension/courses/instant.js');
const D = require('../../extension/content/defaults.js');
const workerEnv = require('../helpers/worker-env.cjs');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../fixtures', f), 'utf8');
const settle = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.blackboard.com', CDN = 'https://cdn.ultra.test';
const CTX = { origin: ORIGIN, cdn: CDN, base: `${CDN}/ultra/uiv4001.0.0-rel/` };

// What the walk reads of a node: its children as the DOM lists them, its kind and its own name.
Object.defineProperties(El.prototype, {
  childNodes: { get() { return this.children; }, configurable: true },
  nodeType: { get() { return 1; }, configurable: true },
  localName: { get() { return this.tagName.toLowerCase(); }, configurable: true },
});
const makeDoc = () => {
  const doc = {};
  doc.root = new El('#root', doc);
  doc.createElement = (t) => new El(t, doc);
  doc.createElementNS = (ns, t) => Object.assign(new El(t, doc), { namespaceURI: ns });
  return doc;
};
const page = (f) => { const doc = makeDoc(); const body = parse(fixture(f), doc); doc.root.append(body); return { doc, body, main: body.querySelector('main.bb-offcanvas-container') }; };
const flat = (nodes) => JSON.stringify(nodes);
const tags = (nodes, out = new Set()) => { for (const n of nodes) if (Array.isArray(n)) { out.add(n[0]); tags(n.slice(3), out); } return out; };

test('a copy keeps Ultra\'s classes, text and site links, and leaves out ids, Glaze\'s own parts and controls', () => {
  const { main } = page('ultra-instant-courses.html');
  const c = L.capture(main, CTX);
  const s = flat(c.nodes);
  for (const want of ['default-group term-_10_1', 'element-card course-element-card', 'js-course-title-element', 'Sample Course One', 'FIX-101-01', 'status-text', '"/ultra/courses/_101_1/outline"']) assert.ok(s.includes(want), want);
  assert.ok(!/course-list-course-|main-content|"id"/.test(s), 'no ids');
  assert.ok(!/gz-cm-btn|Course menu/.test(s), 'Glaze\'s course menu button stays out');
  assert.ok(!tags(c.nodes).has('button') && !tags(c.nodes).has('bb-base-course-card'), 'custom elements become spans; buttons go');
  assert.ok(s.includes(`"${CDN}/images/banner-1.png"`), 'a banner from Ultra\'s CDN');
  assert.equal(c.full, false);
});

test('the rebuild strips handlers, ids, scripts, styles with addresses, forms, frames and cross-origin links', () => {
  const doc = makeDoc(), main = new El('main', doc);
  doc.root.append(main);
  const el = (tag, attrs = {}, ...kids) => { const e = new El(tag, doc); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };
  main.append(
    el('div', { class: 'element-card', id: 'card-1', onclick: 'steal()', onmouseover: 'x()', style: 'background-color: #123456; background-image: url(https://evil.test/x.png)' },
      el('a', { href: 'https://evil.test/phish', class: 'name' }, 'Cross-origin'),
      el('a', { href: 'javascript:alert(1)' }, 'Script link'),
      el('a', { href: '//evil.test/x' }, 'Protocol-relative'),
      el('a', { href: `${ORIGIN}/ultra/courses/_1_1/outline` }, 'Same origin'),
      el('script', {}, 'alert(1)'),
      el('form', { action: '/x' }, el('input', { name: 'q', value: 'secret' }), 'Form text'),
      el('iframe', { src: 'https://evil.test' }),
      el('button', { type: 'button' }, 'Press'),
      el('img', { src: `${CDN}/not-a-banner.png` }),
      el('div', { class: 'course-banner' }, el('img', { src: 'data:image/png;base64,AAAA' }), el('img', { src: 'https://evil.test/banner.png' }), el('img', { src: '/images/site-banner.png', onerror: 'x()' })),
      el('div', { id: 'gz-stream-settings' }, 'Glaze panel'),
      el('span', { class: 'gz-stream-date' }, 'Glaze date'),
      el('div', { class: 'peek' }, el('div', { class: 'peek-body' }, 'Peek text')),
      el('svg', { viewBox: '0 0 24 24', onload: 'x()' }, el('path', { d: 'M0 0h24v24H0z', fill: 'url(#evil)' }), el('use', { href: '#sprite' })),
      'Plain <img src=x onerror=alert(1)> text'));
  const c = L.capture(main, CTX), s = flat(c.nodes);
  for (const gone of ['onclick', 'steal', 'onmouseover', 'card-1', 'url(', 'evil.test', 'javascript', 'alert(1)"', 'secret', 'Form text', 'Press', 'not-a-banner', 'data:', 'Glaze panel', 'Glaze date', 'Peek text', '#sprite', '"onload"', '"onerror"', '"id"']) assert.ok(!s.includes(gone), gone);
  for (const kept of ['background-color: #123456', '"/ultra/courses/_1_1/outline"', `"${CDN}/images/site-banner.png"`, '"M0 0h24v24H0z"', 'Plain <img src=x onerror=alert(1)> text']) assert.ok(s.includes(kept), kept);
  assert.deepEqual([...tags(c.nodes)].sort(), ['a', 'div', 'img', 'path', 'svg']);

  // Built back: text stays text, and the stored record is checked again, so a changed one adds nothing either.
  const box = new El('div', doc);
  const evil = [['script', '', 0, 'alert(1)'], ['iframe', '', { src: 'https://evil.test' }], ['a', 'x', { href: 'https://evil.test/a', onclick: 'x()' }, 'link'],
    ['div', 'ok gz-own', { style: 'background: url(https://evil.test)', id: 'main-content', 'aria-hidden': 'true' }, '<b>bold</b>'], ['img', '', { src: `${CDN}/b.png` }],
    ['div', 'course-banner', 0, ['img', '', { src: 'https://evil.test/b.png' }], ['img', '', { src: `${CDN}/b.png`, onerror: 'x()' }]], { tag: 'div' }, 42];
  assert.equal(L.build(doc, box, [...c.nodes, ...evil], CTX) > 0, true);
  const all = box.all();
  assert.ok(all.every((e) => ['DIV', 'A', 'IMG', 'SVG', 'PATH'].includes(e.tagName)), 'only allowed tags');
  assert.ok(all.every((e) => !e.id && !Object.keys(e.attrs).some((k) => /^on/.test(k))), 'no ids or handlers');
  assert.deepEqual(all.filter((e) => e.tagName === 'A').map((e) => e.attrs.href).filter(Boolean), [`${ORIGIN}/ultra/courses/_1_1/outline`], 'site links only, made whole');
  assert.deepEqual(all.filter((e) => e.tagName === 'IMG').map((e) => e.attrs.src), [`${CDN}/images/site-banner.png`, `${CDN}/b.png`], 'banner pictures from the site or its CDN only');
  assert.equal(all.find((e) => e.className === 'ok').attrs['aria-hidden'], 'true');
  assert.ok(box.textContent.includes('<b>bold</b>') && !all.some((e) => e.tagName === 'B'), 'stored markup is only ever text');
  assert.ok(all.every((e) => !String(e.style['background-image'] || '').includes('url')), 'no style address');
  assert.equal(all[0].style['background-color'], '#123456');
});

test('a copy stays within its bounds in bytes and nodes, and says when it was cut short', () => {
  const doc = makeDoc(), main = new El('main', doc);
  for (let i = 0; i < 6000; i++) { const d = new El('div', doc); d.className = 'element-card'; d.append(`Row ${i}`); main.append(d); }
  const c = L.capture(main, CTX);
  assert.equal(c.full, true);
  assert.ok(c.nodes.length <= L.MAX_NODES, `${c.nodes.length} nodes`);
  assert.ok(JSON.stringify(c.nodes).length <= L.MAX_BYTES);
  const big = new El('main', doc);
  for (let i = 0; i < 400; i++) { const d = new El('div', doc); d.className = 'element-card'; d.append('x'.repeat(1900)); big.append(d); }
  const b = L.capture(big, CTX);
  assert.equal(b.full, true);
  assert.ok(JSON.stringify(b.nodes).length <= L.MAX_BYTES, 'bytes');
  // A stored record past the bounds builds no more than they allow.
  const box = new El('div', doc);
  assert.ok(L.build(doc, box, Array.from({ length: 9000 }, () => ['div', 'x', 0]), CTX) <= L.MAX_NODES);
});

test('each page\'s ready markers: every grades tile filled, a course card, a stream item; a copy of a ready page never counts', () => {
  for (const [f, kind] of [['ultra-instant-grades.html', 'grades'], ['ultra-instant-courses.html', 'courses'], ['ultra-instant-stream.html', 'stream']]) {
    const { doc, main } = page(f);
    assert.equal(L.ready(kind, main), true, `${kind} ready`);
    for (const other of ['grades', 'courses', 'stream'].filter((k) => k !== kind)) assert.equal(L.ready(other, main), false, `${kind} is not ${other}`);
    const c = L.capture(main, CTX);
    const fresh = new El('main', doc), box = new El('div', doc);
    box.id = 'gz-instant';
    fresh.append(box);
    doc.root.append(fresh);
    L.build(doc, box, c.nodes, CTX);
    assert.ok(box.all().length > 5);
    assert.equal(L.ready(kind, fresh), false, `${kind}: the copy alone isn't Ultra's view`);
  }
  const { main } = page('ultra-instant-grades.html');
  const rows = main.querySelectorAll('.recent-upcoming')[0];
  rows.replaceChildren();
  assert.equal(L.ready('grades', main), false, 'one tile still filling');
  const empty = new El('div', rows.doc); empty.className = 'base-grades-empty-state'; rows.append(empty);
  assert.equal(L.ready('grades', main), true);
  assert.equal(L.failed(main), false, 'a course\'s own empty state is not the page\'s');
  const { main: s } = page('ultra-instant-stream.html');
  for (const li of s.querySelectorAll('li.stream-item-container')) li.remove();
  assert.equal(L.ready('stream', s), false, 'groups without items');
  assert.equal(L.kindOf('/ultra/grades'), 'grades');
  assert.equal(L.kindOf('/ultra/course'), 'courses');
  assert.equal(L.kindOf('/ultra/stream'), 'stream');
  assert.equal(L.kindOf('/ultra/courses/_1_1/outline'), '');
});

test('copies are keyed by site, student and page, and only the right student\'s and page\'s is usable', () => {
  assert.equal(L.key(ORIGIN, '_900_1', 'grades'), `ultraCopy:${ORIGIN}/_900_1/grades`);
  const rec = { v: L.VERSION, uid: '_900_1', kind: 'grades', at: Date.now() - 1000, nodes: [] };
  assert.equal(L.usable(rec, '_900_1', 'grades'), true);
  assert.equal(L.usable(rec, '_800_1', 'grades'), false, 'another student');
  assert.equal(L.usable(rec, '_900_1', 'stream'), false, 'another page');
  assert.equal(L.usable({ ...rec, at: Date.now() - L.MAX_AGE - 1 }, '_900_1', 'grades'), false, 'too old');
  assert.equal(L.usable({ ...rec, nodes: '<div>' }, '_900_1', 'grades'), false, 'not the stored shape');
  assert.equal(L.usable(rec, '', 'grades'), false);
});

// ---- the page script ----
// The top page on Ultra, with the stand-in DOM: me() answers when told (who.answer), Ultra's view is put in by fill().
const site = ({ path = '/ultra/grades', local = {}, last = '_900_1', instant = true, enabled = true, frame = false, send, get } = {}) => {
  const doc = makeDoc(), html = new El('html', doc), body = new El('body', doc);
  doc.root.append(html); html.append(body);
  const main = new El('main', doc); main.className = 'bb-offcanvas-container'; body.append(main);
  const frames = [], observers = [], idle = [], sent = [], timers = [], events = new Map(), changes = [];
  let answer, fail;
  const who = new Promise((res, rej) => { answer = res; fail = rej; });
  const settings = { enabled, enhance: { ...D.GZ_SANITIZE({}).enhance, instant } };
  const location = { origin: ORIGIN, pathname: path, href: ORIGIN + path };
  const c = vm.createContext({
    URL, JSON, Promise, Map, Set, Object, Array, String, Number, RegExp, Math, Date, Error,
    location, document: { documentElement: html, body, baseURI: CTX.base, querySelector: (s) => html.querySelector(s), createElement: doc.createElement, createElementNS: doc.createElementNS },
    MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (f) => frames.push(f), cancelAnimationFrame() {},
    requestIdleCallback: (f) => idle.push(f),
    setTimeout: (f, ms) => timers.push({ f, ms }), clearTimeout() {},
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px' }),
    addEventListener: (type, fn) => events.set(type, [...events.get(type) || [], fn]), removeEventListener() {},
    chrome: { runtime: { sendMessage: (m) => {
      sent.push(m);
      if (send) return send(m);
      if (m.op === 'put') local[L.key(ORIGIN, m.record.uid, m.record.kind)] = structuredClone(m.record);
      return Promise.resolve(m.op === 'begin' ? { epoch: 'test' } : { ok: true });
    } }, storage: { local: { get: get || ((k, cb) => cb(structuredClone(Object.fromEntries([].concat(k).map((key) => [key, local[key]]))))), set: (o) => Object.assign(local, structuredClone(o)) },
      onChanged: { addListener: (f) => changes.push(f) } } },
    GZ_CTX: { settings: () => settings, need: async () => {} },
    GZ_ULTRA: { page: { known: async () => (last ? { id: last } : null) } },
  });
  c.globalThis = c; c.window = c; c.top = frame ? {} : c;
  vm.runInContext(read('courses/instant.js'), c);
  vm.runInContext(read('courses/page/instant.js'), c);
  // Ultra's view goes in, and the page looks at it in its next frame.
  const fill = (f) => { const p = parse(fixture(f), doc); main.replaceChildren(...p.querySelector('main').children); };
  const frame1 = async () => { for (const o of observers.filter((x) => x.on)) o.f([]); for (const f of frames.splice(0)) f(); await settle(); for (const f of frames.splice(0)) f(); await settle(); };
  const copy = () => main.querySelector('#gz-instant');
  return { c, doc, html, main, local, settings, location, sent, idle, timers, answer, fail, fill, frame1, copy, events,
    changed: (ch, area) => { for (const f of changes) f(ch, area); },
    sync: (on = instant, ready = Promise.resolve()) => c.GZ_INSTANT.sync(on, () => who, ready) };
};
const stored = (uid, kind, f, at = Date.now() - 60000) => {
  const { main } = page(f);
  return { [L.key(ORIGIN, uid, kind)]: { v: L.VERSION, uid, kind, at, full: false, nodes: L.capture(main, CTX).nodes } };
};

test('a second visit paints the copy once the student is confirmed, before Ultra\'s view, and swaps it out when that is ready', async () => {
  const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
  p.sync();
  await settle();
  assert.equal(p.copy(), null, 'nothing before /users/me confirms the student');
  p.answer('_900_1');
  await settle();
  const box = p.copy();
  assert.ok(box, 'painted');
  assert.equal(box.attrs['aria-hidden'], 'true');
  assert.equal(box.inert, true);
  assert.equal(p.html.dataset.gzInstant, 'grades', 'Ultra\'s own view waits hidden');
  assert.ok(box.textContent.includes('Sample Course One') && box.querySelector('.base-grades-course-tile'));
  assert.ok(String(box.style.transform).startsWith('translate('));
  const before = p.local[L.key(ORIGIN, '_900_1', 'grades')].at;
  p.fill('ultra-instant-grades.html');
  await p.frame1();
  assert.equal(p.copy(), null, 'gone once Ultra\'s view is ready');
  assert.equal(p.html.dataset.gzInstant, undefined);
  assert.equal(p.idle.length, 1);
  p.idle.shift()();
  const kept = p.local[L.key(ORIGIN, '_900_1', 'grades')];
  assert.ok(kept.at > before && kept.uid === '_900_1' && kept.kind === 'grades', 'kept again from Ultra\'s view');
  assert.ok(flat(kept.nodes).includes('base-grades-course-tile') && !flat(kept.nodes).includes('gz-instant'));
});

test('another student never sees a copy, nor a record under their key that names someone else', async () => {
  const p = site({ last: '_800_1', local: stored('_800_1', 'grades', 'ultra-instant-grades.html') });
  p.sync();
  p.answer('_900_1');
  await settle();
  assert.equal(p.copy(), null, 'the last student\'s copy stays out for the one signed in');
  const forged = stored('_800_1', 'grades', 'ultra-instant-grades.html');
  const q = site({ local: { [L.key(ORIGIN, '_900_1', 'grades')]: Object.values(forged)[0] } });
  q.sync();
  q.answer('_900_1');
  await settle();
  assert.equal(q.copy(), null, 'a record naming another student');
  // The page is ready: kept for the student signed in, under their own key.
  p.fill('ultra-instant-grades.html');
  await p.frame1();
  p.idle.shift()();
  assert.equal(p.local[L.key(ORIGIN, '_900_1', 'grades')].uid, '_900_1');
  assert.equal(p.local[L.key(ORIGIN, '_800_1', 'grades')].uid, '_800_1', 'the other student\'s stays theirs');
});

test('with the switch off nothing is shown or kept', async () => {
  const p = site({ instant: false, local: stored('_900_1', 'stream', 'ultra-instant-stream.html'), path: '/ultra/stream' });
  const before = JSON.stringify(p.local);
  p.sync(false);
  p.answer('_900_1');
  await settle();
  p.fill('ultra-instant-stream.html');
  await p.frame1();
  for (const f of p.idle.splice(0)) f();
  assert.equal(p.copy(), null);
  assert.equal(JSON.stringify(p.local), before, 'nothing kept');
  // Turned off while shown: gone at once, and not kept.
  const q = site({ local: stored('_900_1', 'stream', 'ultra-instant-stream.html'), path: '/ultra/stream' });
  q.sync();
  q.answer('_900_1');
  await settle();
  assert.ok(q.copy());
  q.settings.enhance.instant = false;
  q.sync(false);
  assert.equal(q.copy(), null);
  assert.equal(q.html.dataset.gzInstant, undefined);
});

test('a route change, Ultra\'s error, or 20 s without a ready view takes the copy away at once', async () => {
  const p = site({ path: '/ultra/course', local: stored('_900_1', 'courses', 'ultra-instant-courses.html') });
  p.sync();
  p.answer('_900_1');
  await settle();
  assert.ok(p.copy());
  p.location.pathname = '/ultra/courses/_101_1/outline';
  await p.frame1();
  assert.equal(p.copy(), null, 'route change');
  const q = site({ path: '/ultra/course', local: stored('_900_1', 'courses', 'ultra-instant-courses.html') });
  q.sync();
  q.answer('_900_1');
  await settle();
  const alert = new El('div', q.doc); alert.setAttribute('role', 'alert'); alert.append('Something went wrong'); q.main.append(alert);
  await q.frame1();
  assert.equal(q.copy(), null, 'Ultra\'s error');
  const r = site({ path: '/ultra/course', local: stored('_900_1', 'courses', 'ultra-instant-courses.html') });
  r.sync();
  r.answer('_900_1');
  await settle();
  const last = r.timers.find((t) => t.ms === 20000);
  assert.ok(last && r.copy());
  last.f();
  assert.equal(r.copy(), null, 'last resort');
  const s = site({ frame: true, local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
  s.sync();
  s.answer('_900_1');
  await settle();
  assert.equal(s.copy(), null, 'never in a frame');
});

test('signed out (/users/me answers 401): this site\'s copies are dropped', async () => {
  const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
  p.sync();
  p.fail(new Error('HTTP 401'));
  await settle();
  assert.equal(p.copy(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(p.sent.filter((m) => m.op === 'drop'))), [{ type: 'glaze:ultraCopy', op: 'drop' }]);
});

test('late identity or settings cannot paint after the last-resort timeout', async (t) => {
  for (const slow of ['identity', 'settings']) await t.test(slow, async () => {
    const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
    let resolve;
    const ready = new Promise((res) => { resolve = res; });
    p.sync(true, slow === 'settings' ? ready : Promise.resolve());
    if (slow === 'settings') p.answer('_900_1');
    await settle();
    p.timers.find((timer) => timer.ms === 20000).f();
    p.answer('_900_1');
    resolve();
    await settle();
    assert.equal(!!p.copy(), false, 'expired work must leave Ultra visible');
    assert.equal(p.html.dataset.gzInstant, undefined);
    assert.ok(!p.idle.length, 'no save scheduled by expired work');
  });
});

test('a route change or switch off removes a copy that is still fading', async (t) => {
  for (const action of ['route', 'off']) await t.test(action, async () => {
    const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
    p.sync();
    p.answer('_900_1');
    await settle();
    const box = p.copy();
    let finish;
    const finished = new Promise((res) => { finish = res; });
    box.getAnimations = () => [{ finished }];
    p.fill('ultra-instant-grades.html');
    p.main.append(box);
    await p.frame1();
    assert.equal(box.hasAttribute('data-out'), true, 'fade started');
    assert.equal(!!p.copy(), true, 'the fade is still visible');
    if (action === 'route') p.location.pathname = '/ultra/calendar';
    else p.settings.enhance.instant = false;
    p.sync(action !== 'off');
    assert.equal(!!p.copy(), false, 'the old visit must disappear immediately');
    finish();
    await settle();
  });
});

test('a late copy never covers a new route or an existing error', async (t) => {
  for (const state of ['route', 'error']) await t.test(state, async () => {
    const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
    p.sync();
    await settle();
    if (state === 'route') p.location.pathname = '/ultra/calendar';
    else {
      const alert = new El('div', p.doc);
      alert.setAttribute('role', 'alert'); alert.append('Grades could not be loaded'); p.main.append(alert);
    }
    p.answer('_900_1');
    await settle();
    assert.equal(!!p.copy(), false, 'the pending frame must not reveal an obsolete copy');
    assert.equal(p.html.dataset.gzInstant, undefined);
  });
});

// ---- content-ultra.js's hooks ----
const ultraPart = ({ path: route = '/ultra/grades', instant = true, top = true, instantUI = null } = {}) => {
  const listeners = [], asked = [], sent = [], calls = [];
  const El0 = class { constructor() { this.attrs = new Map(); this.dataset = {}; } setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.get(k) ?? null; } hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); } querySelector() { return null; } querySelectorAll() { return []; } addEventListener() {} append() {} };
  const html = new El0();
  const document = { documentElement: html, body: new El0(), contentType: 'text/html', querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    addEventListener: (t, f, cap) => listeners.push({ t, f, cap }), createTreeWalker: () => ({ nextNode: () => null }), createElement: () => new El0() };
  const location = { origin: ORIGIN, protocol: 'https:', hostname: 'school.blackboard.com', port: '', pathname: route, href: ORIGIN + route };
  const ctx = vm.createContext({
    document, location, console, Promise, Date, setTimeout, clearTimeout() {}, queueMicrotask, JSON, Map, Set, Object, Array, String, Number, RegExp, Math, Intl, URL, structuredClone,
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    chrome: { runtime: { id: 'x', sendMessage: (m) => { sent.push(m); return Promise.resolve(); } }, storage: { local: { get: (k, cb) => cb({}), set() {} }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {} } } },
    GZ_GRADES: require(path.join(root, 'planner/grades.js')), GZ_PAGE: require(path.join(root, 'core/page.js')), GZ_COURSES: D.GZ_COURSES,
    ...(instantUI && { GZ_INSTANT: instantUI(calls) }),
  });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.top = top ? ctx : {};
  vm.runInContext(read('content/content-ultra.js'), ctx);
  const need = (files, ready) => { asked.push([].concat(files)); if (!ctx.GZ_INSTANT && [].concat(files).includes('courses/page/instant.js')) ctx.GZ_INSTANT = { sync: (...a) => calls.push(a) }; return ready() ? Promise.resolve() : Promise.reject(new Error('not ready')); };
  const I = { C: {}, html, isPreview: false, solo: true, tabFrame: '', need, t: (x) => x, locale: () => 'en', api: async () => ({}),
    courseId: () => null, markDue() {}, drawProgress() {}, cardBadge() {}, cardsInView: { observe() {}, unobserve() {} }, inView: new Set(), tagCards() {}, tagExtras() {}, courseSlots: {},
    courseColors: () => ({}), varText: () => '', CARD: 'article', dueLabelled: () => false, links: [1], ready: Promise.resolve(),
    settings: { enabled: true, enhance: { ...D.GZ_SANITIZE({}).enhance, instant }, nav: { brand: 'x' }, courses: { names: {}, tint: false, tinted: [] }, sidebar: {}, navbar: {} },
    observer: {}, worn: { nav: {} }, courseList: {} };
  const X = ctx.GZ_SITE_ULTRA(I);
  return { X, I, asked, sent, calls, listeners, location };
};

test('content-ultra.js loads the copy\'s page script on the three pages with the switch on, and tells it when it turns off', async () => {
  const want = ['courses/instant.js', 'courses/page/instant.js'];
  for (const p of ['/ultra/grades', '/ultra/course', '/ultra/stream']) {
    const u = ultraPart({ path: p });
    u.X.syncWidgets();
    await settle();
    assert.ok(u.asked.some((a) => JSON.stringify(a) === JSON.stringify(want)), p);
    assert.equal(u.calls.at(-1)?.[0], true, p);
    assert.equal(typeof u.calls.at(-1)[1], 'function', 'with the shared confirmed student');
  }
  const off = ultraPart({ instant: false });
  off.X.syncWidgets();
  await settle();
  assert.ok(!off.asked.some((a) => a.includes('courses/page/instant.js')), 'off: nothing loaded');
  const elsewhere = ultraPart({ path: '/ultra/courses/_1_1/outline' });
  elsewhere.X.syncWidgets();
  await settle();
  assert.ok(!elsewhere.asked.some((a) => a.includes('courses/page/instant.js')), 'another page');
  const framed = ultraPart({ top: false });
  framed.X.syncWidgets();
  await settle();
  assert.ok(!framed.asked.some((a) => a.includes('courses/page/instant.js')), 'a frame');
  const loaded = ultraPart({ instant: false, instantUI: (calls) => ({ sync: (...a) => calls.push(a) }) });
  loaded.X.syncWidgets();
  await settle();
  assert.equal(loaded.calls.at(-1)?.[0], false, 'already loaded: told the switch is off');
});

test('signing out through Ultra\'s menu (or Glaze\'s bar, which clicks it) drops this site\'s copies', () => {
  const u = ultraPart({ path: '/ultra/course' });
  const link = (href, inMenu = true) => ({ getAttribute: (k) => (k === 'href' ? href : null), closest: (s) => (inMenu && /MuiDrawer-paper a\[href\]|base_tools a\[href\]/.test(s) ? link(href, inMenu) : null) });
  const click = (target) => { for (const l of u.listeners.filter((x) => x.t === 'click' && x.cap)) l.f({ type: 'click', target: { closest: (s) => target.closest(s) }, isTrusted: false, button: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} }); };
  click(link('/ultra/course'));
  click(link('#', false));
  assert.deepEqual(u.sent.filter((m) => m.type === 'glaze:ultraCopy'), [], 'other links');
  click(link('#'));
  assert.deepEqual(JSON.parse(JSON.stringify(u.sent.filter((m) => m.type === 'glaze:ultraCopy'))), [{ type: 'glaze:ultraCopy', op: 'drop' }]);
});

test('sign-out retires pending paints and saves before pagehide or another sync', async (t) => {
  for (const phase of ['pending', 'ready']) await t.test(phase, async () => {
    const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
    p.sync();
    await settle();
    if (phase === 'ready') {
      p.answer('_900_1');
      await settle();
      p.fill('ultra-instant-grades.html');
      await p.frame1();
    }
    const u = ultraPart({ instantUI: () => p.c.GZ_INSTANT });
    const anchor = { getAttribute: () => '#' };
    for (const l of u.listeners.filter((x) => x.t === 'click' && x.cap)) l.f({ target: { closest: (s) => /MuiDrawer-paper a\[href\]|base_tools a\[href\]/.test(s) ? anchor : null } });
    for (const key of Object.keys(p.local)) if (key.startsWith('ultraCopy:')) delete p.local[key];
    p.answer('_900_1');
    u.X.syncWidgets();
    await settle();
    for (const f of p.events.get('pagehide') || []) f();
    for (const f of p.idle.splice(0)) f();
    await settle();
    assert.equal(!!p.copy(), false, 'no paint after sign-out');
    assert.deepEqual(Object.keys(p.local).filter((key) => key.startsWith('ultraCopy:')), [], 'no save after the purge');
  });
});

test('a purge cannot be undone by a delayed save in another tab, even after a worker restart', async (t) => {
  for (const reason of ['sign-out', 'switch', 'reset', 'empty-reset']) await t.test(reason, async () => {
    const local = { ultra: [], ...(reason === 'empty-reset' ? {} : stored('_900_1', 'grades', 'ultra-instant-grades.html')) };
    let w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: { instant: true } }, local, session: {} } });
    const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/grades` }, frameId: 0, url: `${ORIGIN}/ultra/grades` };
    const otherTab = { ...from, tab: { ...from.tab, id: 4 } };
    const p = site({ local, send: (m) => w.send(m, otherTab) });
    p.sync(); p.answer('_900_1'); await settle();
    p.fill('ultra-instant-grades.html'); await p.frame1();
    if (reason === 'sign-out') await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from);
    else if (reason === 'switch') {
      await w.context.chrome.storage.sync.set({ enhance: { instant: false } }); await w.settle();
      await w.context.chrome.storage.sync.set({ enhance: { instant: true } }); await w.settle();
    } else await w.send({ type: 'glaze:sites', op: 'reset' }, { id: 'glaze', tab: { id: 5, url: 'chrome-extension://x/options.html' }, frameId: 0, url: 'chrome-extension://x/options.html' });
    w = workerEnv({ store: w.store });
    for (const f of p.events.get('pagehide') || []) f();
    for (const f of p.idle.splice(0)) f();
    await w.settle();
    assert.equal(local[L.key(ORIGIN, '_900_1', 'grades')] !== undefined, false, 'the old tab must not recreate purged grades');
    const fresh = site({ local, send: (m) => w.send(m, from) });
    fresh.sync(); fresh.answer('_900_1'); await settle();
    fresh.fill('ultra-instant-grades.html'); await fresh.frame1();
    for (const f of fresh.idle.splice(0)) f();
    await w.settle();
    assert.ok(local[L.key(ORIGIN, '_900_1', 'grades')], 'a fresh visit can save again');
  });
});

test('snapshot saves require a trusted top page, current visit and bounded record', async () => {
  const w = workerEnv();
  const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/grades` }, frameId: 0, url: `${ORIGIN}/ultra/grades` };
  const record = Object.values(stored('_900_1', 'grades', 'ultra-instant-grades.html'))[0];
  const { epoch } = await w.send({ type: 'glaze:ultraCopy', op: 'begin' }, from);
  const message = { type: 'glaze:ultraCopy', op: 'put', epoch, record };
  for (const sender of [{ ...from, url: 'https://evil.test/ultra/grades' }, { ...from, frameId: 2 }, { ...from, id: 'another-extension' }]) {
    assert.equal(await w.send(message, sender), null);
  }
  for (const bad of [{ ...message, epoch: 'stale' }, { ...message, record: { ...record, uid: '../_900_1' } },
    { ...message, record: { ...record, nodes: ['x'.repeat(201025)] } }]) {
    assert.equal((await w.send(bad, from)).ok, false);
  }
  assert.equal(Object.keys(w.store.local).some((key) => key.startsWith('ultraCopy:')), false);
  assert.equal((await w.send(message, from)).ok, true);
  assert.deepEqual(w.store.local[L.key(ORIGIN, record.uid, record.kind)], record);
});

test('a purge retires painted and pending copies in other tabs, including an empty reset', async (t) => {
  for (const reason of ['sign-out', 'reset', 'empty-reset', 'remove', 'switch']) await t.test(reason, async () => {
    const local = { ultra: [], ...(reason === 'empty-reset' ? {} : stored('_900_1', 'grades', 'ultra-instant-grades.html')) };
    const w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: { instant: true } }, local, session: {} } });
    const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/grades` }, frameId: 0, url: `${ORIGIN}/ultra/grades` };
    const editor = { id: 'glaze', tab: { id: 5 }, frameId: 0, url: 'chrome-extension://x/options.html' };
    const p = site({ local, send: (m) => w.send(m, from) });
    let deliver;
    const q = site({ local, send: (m) => w.send(m, from), get: (k, cb) => {
      const result = structuredClone(Object.fromEntries([].concat(k).map((key) => [key, local[key]])));
      if (typeof k === 'string' && k.startsWith('ultraCopy:')) deliver = () => cb(result);
      else cb(result);
    } });
    for (const tab of [p, q]) { w.context.chrome.storage.onChanged.addListener(tab.changed); tab.sync(); tab.answer('_900_1'); }
    await settle();
    if (reason !== 'empty-reset') assert.ok(p.copy(), 'the other tab has painted');
    assert.ok(deliver, 'the second tab has a local read in flight');
    if (reason === 'sign-out') await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from);
    else if (reason === 'switch') await w.context.chrome.storage.sync.set({ enhance: { instant: false } });
    else await w.send({ type: 'glaze:sites', op: reason === 'remove' ? 'remove' : 'reset', origin: ORIGIN }, editor);
    await w.settle();
    deliver(); await settle();
    for (const tab of [p, q]) {
      assert.equal(!!tab.copy(), false, 'the purge removes visible copies and cancels old reads');
      assert.equal(tab.c.GZ_INSTANT.now(), null, 'even a visit with no saved copy is retired');
      assert.equal(tab.html.dataset.gzInstant, undefined, 'Ultra is visible');
      tab.fill('ultra-instant-grades.html'); await tab.frame1();
      for (const f of tab.events.get('pagehide') || []) f();
      for (const f of tab.idle.splice(0)) f();
    }
    await w.settle();
    assert.equal(Object.keys(local).some((k) => k.startsWith('ultraCopy:')), false, 'no stale save after the purge');
    if (reason === 'switch') {
      p.settings.enhance.instant = false; p.sync(false);
      await w.context.chrome.storage.sync.set({ enhance: { instant: true } });
      p.settings.enhance.instant = true; p.sync(); await settle();
      for (const f of p.idle.splice(0)) f();
      await w.settle();
      assert.ok(local[L.key(ORIGIN, '_900_1', 'grades')], 'the switch can be turned on again in this document');
    } else {
      p.sync(); await settle();
      for (const f of p.events.get('pagehide') || []) f();
      await w.settle();
      assert.equal(Object.keys(local).some((k) => k.startsWith('ultraCopy:')), false, 'an old document cannot acquire a new lease on another sync');
    }
  });
});

test('another site signing out does not retire this site\'s painted copy', async () => {
  const local = { ultra: [], ...stored('_900_1', 'grades', 'ultra-instant-grades.html') };
  const w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: {} }, local, session: {} } });
  const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/grades` }, frameId: 0, url: `${ORIGIN}/ultra/grades` };
  const p = site({ local, send: (m) => w.send(m, from) });
  w.context.chrome.storage.onChanged.addListener(p.changed);
  p.sync(); p.answer('_900_1'); await settle();
  const other = 'https://other.blackboard.com/ultra/grades';
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, { ...from, url: other, tab: { id: 4, url: other } });
  assert.equal(!!p.copy(), true, 'a different site\'s purge has no effect here');
  p.fill('ultra-instant-grades.html'); await p.frame1();
  for (const f of p.idle.splice(0)) f();
  await w.settle();
  assert.ok(local[L.key(ORIGIN, '_900_1', 'grades')], 'its lease is still valid');
});

test('a lease request delayed across sign-out cannot authorize a stale visit', async () => {
  const local = { ultra: [] }, w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: {} }, local, session: {} } });
  const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/grades` }, frameId: 0, url: `${ORIGIN}/ultra/grades` };
  let deliver;
  const p = site({ local, send: (m) => m.op === 'begin' ? new Promise((resolve) => { deliver = () => w.send(m, from).then(resolve); }) : w.send(m, from) });
  p.sync(); p.answer('_900_1'); await settle();
  p.fill('ultra-instant-grades.html'); await p.frame1();
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from);
  await deliver(); await settle();
  for (const f of p.idle.splice(0)) f();
  for (const f of p.events.get('pagehide') || []) f();
  await w.settle();
  assert.equal(Object.keys(local).some((k) => k.startsWith('ultraCopy:')), false, 'the delayed begin must not return a current lease');
});

// ---- the worker ----
test('the worker drops a site\'s copies on its sign-out, all of them with the switch off, and only for Ultra\'s own pages', async () => {
  const other = 'https://other.blackboard.com';
  const local = { ultra: [], [L.key(ORIGIN, '_900_1', 'grades')]: { v: 1 }, [L.key(ORIGIN, '_800_1', 'stream')]: { v: 1 }, [L.key(other, '_9_1', 'courses')]: { v: 1 }, [`ultraMe:${ORIGIN}`]: { uid: '_900_1' } };
  const w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: {} }, local, session: {} } });
  const from = (url, frameId = 0) => ({ id: 'glaze', tab: { id: 3, url }, frameId, url });
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from('https://evil.test/ultra/course'));
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from(`${ORIGIN}/ultra/course`, 2));
  await w.settle();
  assert.equal(Object.keys(w.store.local).filter((k) => k.startsWith('ultraCopy:')).length, 3, 'not from another site or a frame');
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from(`${ORIGIN}/ultra/course`));
  await w.settle();
  assert.deepEqual(Object.keys(w.store.local).filter((k) => k.startsWith('ultraCopy:')), [L.key(other, '_9_1', 'courses')], 'this site\'s, every student\'s');
  assert.equal(w.store.local[`ultraMe:${ORIGIN}`], undefined, "sign-out clears the last identity too");
  await w.context.chrome.storage.sync.set({ enhance: { instant: false } });
  await w.settle();
  assert.deepEqual(Object.keys(w.store.local).filter((k) => k.startsWith('ultraCopy:')), [], 'the switch off: every copy');
});

test('the copy paints without waiting for the worker\'s save lease; the save waits for it', async () => {
  let lease;
  const leased = new Promise((res) => { lease = res; });
  const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html'),
    send: (m) => (m.op === 'begin' ? leased : Promise.resolve(m.op === 'put' ? { ok: true } : null)) });
  p.sync();
  p.answer('_900_1');
  await settle();
  assert.ok(p.copy(), 'painted while the worker is still waking');
  p.fill('ultra-instant-grades.html');
  await p.frame1();
  for (const f of p.idle.splice(0)) f();
  assert.ok(!p.sent.some((m) => m.op === 'put'), 'no save without a lease');
  lease({ epoch: 'e1' });
  await settle();
  for (const f of p.idle.splice(0)) f();
  const put = p.sent.find((m) => m.op === 'put');
  assert.ok(put && put.epoch === 'e1' && put.record.uid === '_900_1' && put.record.kind === 'grades', 'saved under the lease once it answers');
});

test('painting with the real identity store does not wait for the worker membership cache', async () => {
  const U = require('../../extension/courses/ultra.js');
  const local = stored('_900_1', 'grades', 'ultra-instant-grades.html'), sent = [], asked = [];
  let release;
  const worker = new Promise((resolve) => { release = resolve; });
  const p = site({ local, send: () => worker });
  const shared = U.makePage({
    origin: () => ORIGIN, now: () => Date.now(), live: () => true,
    local: { get: async (k) => ({ [k]: local[k] }), set: async (v) => Object.assign(local, v) },
    send: (m) => { sent.push(m); return worker; },
    fetch: async (url) => { asked.push(url); return { ok: true, text: async () => JSON.stringify({ id: '_900_1' }) }; },
  });
  p.c.GZ_ULTRA.page = shared;
  p.c.GZ_INSTANT.sync(true, shared.me, Promise.resolve());
  await settle();
  assert.ok(asked.some((url) => url.endsWith('/users/me')), 'the site confirmed the student');
  assert.ok(sent.some((m) => m.type === 'glaze:ultraMine' && m.op === 'get'), 'the worker cache is still pending');
  assert.equal(!!p.copy(), true, 'neither the membership cache nor the save lease can hold up painting');
  release(null);
  await settle();
});

test('a delayed pagehide copy keeps its visit time rather than claiming to be newer', async () => {
  const p = site();
  let now = Date.now();
  p.c.Date = class extends Date { static now() { return now; } };
  const start = now;
  p.sync(); p.answer('_900_1'); await settle();
  p.fill('ultra-instant-grades.html'); await p.frame1();
  now += 600000;
  for (const f of p.events.get('pagehide') || []) f();
  assert.equal(p.sent.filter((m) => m.op === 'put').at(-1).record.at, start);
});
