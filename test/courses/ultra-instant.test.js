// Instant copies of Ultra's Grades, Courses list and Activity, and of a course's Course Content, Announcements and
// Gradebook (courses/instant.js, courses/page/instant.js, enhance.instant): the allowlist rebuild and its bounds against the
// real pages' shapes (test/fixtures/ultra-instant-*.html, synthetic text) on the stand-in DOM, each page's ready markers,
// the page script in a VM (painted only for the confirmed student, gone when Ultra's view is ready, kept again then,
// nothing with the switch off; in a course tab's frame only while it is the one on screen), content-ultra.js's hooks, and
// the worker's saves and purges (sign-out, the switch off).
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
  for (const gone of ['onclick', 'steal', 'onmouseover', 'card-1', 'url(', 'evil.test', 'javascript', 'alert(1)"', 'secret', 'Form text', 'not-a-banner', 'data:', 'Glaze panel', 'Glaze date', 'Peek text', '#sprite', '"onload"', '"onerror"', '"id"', '"type"']) assert.ok(!s.includes(gone), gone);
  for (const kept of ['background-color: #123456', '"/ultra/courses/_1_1/outline"', `"${CDN}/images/site-banner.png"`, '"M0 0h24v24H0z"', 'Plain <img src=x onerror=alert(1)> text', '"Press"']) assert.ok(s.includes(kept), kept);
  assert.deepEqual([...tags(c.nodes)].sort(), ['a', 'div', 'img', 'path', 'span', 'svg'], 'a button is its label, as text');

  // Built back: text stays text, and the stored record is checked again, so a changed one adds nothing either.
  const box = new El('div', doc);
  const evil = [['script', '', 0, 'alert(1)'], ['iframe', '', { src: 'https://evil.test' }], ['a', 'x', { href: 'https://evil.test/a', onclick: 'x()' }, 'link'],
    ['div', 'ok gz-own', { style: 'background: url(https://evil.test)', id: 'main-content', 'aria-hidden': 'true' }, '<b>bold</b>'], ['img', '', { src: `${CDN}/b.png` }],
    ['div', 'course-banner', 0, ['img', '', { src: 'https://evil.test/b.png' }], ['img', '', { src: `${CDN}/b.png`, onerror: 'x()' }]], { tag: 'div' }, 42];
  assert.equal(L.build(doc, box, [...c.nodes, ...evil], CTX) > 0, true);
  const all = box.all();
  assert.ok(all.every((e) => ['DIV', 'SPAN', 'A', 'IMG', 'SVG', 'PATH'].includes(e.tagName)), 'only allowed tags');
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
  assert.equal(L.kindOf('/ultra/calendar'), '');
});

test('Grades tiles keep their Looks part and theme surfaces in the live shape and the instant copy', () => {
  const P = require('../../extension/looks/parts.js');
  const { cssRules, winner } = require('../helpers/css-cascade.cjs');
  const theme = cssRules('content/theme.css');
  const { doc, main } = page('ultra-instant-grades.html');
  const box = new El('div', doc);
  box.id = 'gz-instant';
  L.build(doc, box, L.capture(main, CTX).nodes, CTX);
  main.append(box);
  const node = (e) => e && ({ tag: e.tagName.toLowerCase(), id: e.id, cls: e.className.split(/\s+/), attrs: e.attrs, parent: node(e.parentElement) });
  const background = (e) => winner(theme, node(e), 'background(?:-color)?')?.[0];
  for (const scope of [main, box]) {
    const tiles = scope.querySelectorAll(P.get('ultra.grades-tile').s).filter((e) => scope === box || !e.closest('#gz-instant'));
    assert.equal(tiles.length, 2, 'Looks finds both course tiles');
    for (const tile of tiles) {
      if (scope === main) assert.equal(tile.parentElement.tagName, 'BB-BASE-GRADES-STUDENT', 'the native tile is a direct child');
      assert.match(background(tile), /var\(--gz-surface-(paint|fill)/, 'the tile keeps the Look surface');
      assert.equal(background(tile.querySelector('.grades-header')), 'transparent', 'the title band shares the tile surface');
    }
    assert.match(background(tiles[1].querySelector('.base-grades-empty-state')), /var\(--gz-ground\)/, 'an empty course remains styled');
  }
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
// In a frame (frame: its window.name), the page around it is `around`: what the page script posts it lands in toTop, and
// tell() posts the page script a message from it.
const site = ({ path = '/ultra/grades', local = {}, last = '_900_1', instant = true, enabled = true, frame = false, send, get } = {}) => {
  const doc = makeDoc(), html = new El('html', doc), body = new El('body', doc);
  doc.root.append(html); html.append(body);
  // A course page's main area is the course's, in the section that is .bb-offcanvas-container, over the base page's.
  const base = new El('main', doc); base.className = 'bb-offcanvas-container'; body.append(base);
  let main = base;
  if (/^\/ultra\/courses\//.test(path)) {
    const section = new El('section', doc); section.className = 'course bb-offcanvas-container route-view-container'; body.append(section);
    main = new El('main', doc); main.className = 'course-main-content'; section.append(main);
  }
  const toTop = [], around = { postMessage: (m, o) => { assert.equal(o, ORIGIN); toTop.push(structuredClone(m)); } };
  const frames = [], observers = [], idle = [], sent = [], timers = [], events = new Map(), changes = [];
  let answer, fail;
  const who = new Promise((res, rej) => { answer = res; fail = rej; });
  const settings = { enabled, enhance: { ...D.GZ_SANITIZE({}).enhance, instant } };
  const location = { origin: ORIGIN, pathname: path, href: ORIGIN + path };
  const c = vm.createContext({
    URL, JSON, Promise, Map, Set, Object, Array, String, Number, RegExp, Math, Date, Error,
    location, document: { documentElement: html, body, baseURI: CTX.base, querySelector: (s) => html.querySelector(s), querySelectorAll: (s) => html.querySelectorAll(s), createElement: doc.createElement, createElementNS: doc.createElementNS },
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
      if (m.op === 'put') local[L.key(ORIGIN, m.record.uid, m.record.kind, m.record.course)] = structuredClone(m.record);
      return Promise.resolve(m.op === 'begin' ? { epoch: 'test' } : { ok: true });
    } }, storage: { local: { get: get || ((k, cb) => cb(structuredClone(Object.fromEntries([].concat(k).map((key) => [key, local[key]]))))), set: (o) => Object.assign(local, structuredClone(o)) },
      onChanged: { addListener: (f) => changes.push(f) } } },
    GZ_CTX: { settings: () => settings, need: async () => {} },
    GZ_ULTRA: { page: { known: async () => (last ? { id: last } : null) } },
  });
  c.globalThis = c; c.window = c; c.top = frame === false ? c : around; c.name = typeof frame === 'string' ? frame : '';
  vm.runInContext(read('courses/instant.js'), c);
  vm.runInContext(read('courses/page/instant.js'), c);
  // Ultra's view goes in, and the page looks at it in its next frame.
  const fill = (f) => { const p = parse(fixture(f), doc); main.replaceChildren(...p.querySelector('main').children); };
  const frame1 = async () => { for (const o of observers.filter((x) => x.on)) o.f([]); for (const f of frames.splice(0)) f(); await settle(); for (const f of frames.splice(0)) f(); await settle(); };
  const mutated = () => { for (const o of observers.filter((x) => x.on)) o.f([]); };
  const frameOnce = () => { for (const f of frames.splice(0)) f(); };
  const copy = () => main.querySelector('#gz-instant');
  return { c, doc, html, main, base, local, settings, location, sent, idle, timers, answer, fail, fill, frame1, mutated, frameOnce, copy, events, toTop, around,
    changed: (ch, area) => { for (const f of changes) f(ch, area); },
    tell: (data, source = around) => { for (const f of events.get('message') || []) f({ source, origin: ORIGIN, data }); },
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
const ultraPart = ({ path: route = '/ultra/grades', instant = true, top = true, tabFrame = '', instantUI = null } = {}) => {
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
  const I = { C: {}, html, isPreview: false, solo: top || !!tabFrame, tabFrame, need, t: (x) => x, locale: () => 'en', api: async () => ({}),
    courseId: () => null, markDue() {}, drawProgress() {}, cardBadge() {}, cardsInView: { observe() {}, unobserve() {} }, inView: new Set(), tagCards() {}, tagExtras() {}, courseSlots: {},
    courseColors: () => ({}), varText: () => '', CARD: 'article', dueLabelled: () => false, links: [1], ready: Promise.resolve(),
    settings: { enabled: true, enhance: { ...D.GZ_SANITIZE({}).enhance, instant }, nav: { brand: 'x' }, courses: { names: {}, tint: false, tinted: [] }, sidebar: {}, navbar: {} },
    observer: {}, worn: { nav: {} }, courseList: {} };
  const X = ctx.GZ_SITE_ULTRA(I);
  return { X, I, asked, sent, calls, listeners, location };
};

test('content-ultra.js loads the copy\'s page script on its pages with the switch on, and tells it when it turns off', async () => {
  const want = ['courses/instant.js', 'courses/page/instant.js'];
  for (const p of ['/ultra/grades', '/ultra/course', '/ultra/stream', '/ultra/courses/_1_1/outline', '/ultra/courses/_1_1/announcements', '/ultra/courses/_1_1/grades']) {
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
  for (const p of ['/ultra/calendar', '/ultra/courses/_1_1/discussions', '/ultra/courses/_1_1/outline/edit/document/_9_1']) {
    const elsewhere = ultraPart({ path: p });
    elsewhere.X.syncWidgets();
    await settle();
    assert.ok(!elsewhere.asked.some((a) => a.includes('courses/page/instant.js')), `another page: ${p}`);
  }
  const framed = ultraPart({ top: false });
  framed.X.syncWidgets();
  await settle();
  assert.ok(!framed.asked.some((a) => a.includes('courses/page/instant.js')), 'a frame that isn\'t a course tab\'s');
  const tab = ultraPart({ top: false, tabFrame: '_1_1', path: '/ultra/courses/_1_1/outline' });
  tab.X.syncWidgets();
  await settle();
  assert.ok(tab.asked.some((a) => JSON.stringify(a) === JSON.stringify(want)), 'a course tab\'s frame on its course page');
  const standby = ultraPart({ top: false, tabFrame: 'standby', path: '/ultra/profile' });
  standby.X.syncWidgets();
  await settle();
  assert.ok(standby.asked.some((a) => JSON.stringify(a) === JSON.stringify(want)), 'the standby, ahead of the route it is adopted with');
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

test('a first lease delayed across Reset, site removal or switch-off cannot save an old visit', async (t) => {
  for (const reason of ['reset', 'remove', 'switch']) await t.test(reason, async () => {
    const local = { ultra: [] }, w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: { instant: true } }, local, session: {} } });
    const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/grades` }, frameId: 0, url: `${ORIGIN}/ultra/grades` };
    w.context.chrome.tabs.query = async () => [from.tab];
    let deliver;
    const p = site({ local, send: (m) => m.op === 'begin' ? new Promise((resolve) => { deliver = () => w.send(m, from).then(resolve); }) : w.send(m, from) });
    p.sync(); p.answer('_900_1'); await settle();
    p.fill('ultra-instant-grades.html'); await p.frame1();
    assert.ok(deliver, 'the open tab has not delivered its first lease request');
    assert.equal(w.store.session.ultraCopyEpochs, undefined, 'no lease has reached the worker yet');
    if (reason === 'switch') {
      await w.context.chrome.storage.sync.set({ enhance: { instant: false } }); await w.settle();
      await w.context.chrome.storage.sync.set({ enhance: { instant: true } }); await w.settle();
    } else {
      await w.send({ type: 'glaze:sites', op: reason, origin: ORIGIN }, { id: 'glaze', tab: { id: 5 }, frameId: 0, url: 'chrome-extension://x/options.html' });
    }
    // A suspended tab may receive storage notifications only after its pending message is delivered.
    await deliver(); await settle();
    for (const f of p.idle.splice(0)) f();
    for (const f of p.events.get('pagehide') || []) f();
    await w.settle();
    assert.equal(Object.keys(local).some((k) => k.startsWith('ultraCopy:')), false, 'the old visit cannot recreate cleared data');
  });
});

test('removing an approved custom Ultra site fences its open page before deleting the approval', async () => {
  const origin = 'https://bb.school.test', local = { ultra: [origin] };
  const w = workerEnv({ store: { sync: { version: 2, enabled: true }, local, session: {} } });
  w.context.chrome.tabs.query = async () => [{ id: 3, url: `${origin}/ultra/grades` }];
  await w.send({ type: 'glaze:sites', op: 'remove', origin }, { id: 'glaze', tab: { id: 5 }, frameId: 0, url: 'chrome-extension://x/options.html' });
  assert.deepEqual(local.ultra, []);
  assert.equal(local[`ultraCopyFence:${origin}`]?.retire, true, 'the first lease may still be in flight');
});

test('unused Ultra purges add no fences for Canvas or an unapproved /ultra page', async (t) => {
  for (const reason of ['reset', 'remove', 'switch']) await t.test(reason, async () => {
    const local = { canvas: ['https://canvas.school.test/*'] };
    const w = workerEnv({ store: { sync: { version: 2, enabled: true }, local, session: {} } });
    w.context.chrome.tabs.query = async () => [{ id: 3, url: 'https://canvas.school.test/courses/1' }, { id: 4, url: 'https://unapproved.test/ultra/grades' }];
    if (reason === 'switch') {
      await w.context.chrome.storage.sync.set({ enhance: { instant: false } }); await w.settle();
    } else {
      await w.send({ type: 'glaze:sites', op: reason, origin: 'https://canvas.school.test' }, { id: 'glaze', tab: { id: 5 }, frameId: 0, url: 'chrome-extension://x/options.html' });
    }
    assert.equal(Object.keys(local).some((k) => k.startsWith('ultraCopyFence')), false);
    assert.equal(w.store.session.ultraCopyEpochs, undefined);
  });
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

// ---- a course's pages: Course Content, Announcements and the Gradebook, kept per course ----
const COURSE = { outline: ['/ultra/courses/_101_1/outline', 'ultra-instant-outline.html'], announcements: ['/ultra/courses/_101_1/announcements', 'ultra-instant-announcements.html'], gradebook: ['/ultra/courses/_101_1/grades', 'ultra-instant-gradebook.html'] };
const coursePage = (f) => { const doc = makeDoc(); const body = parse(fixture(f), doc); doc.root.append(body); return { doc, body, main: body.querySelector('main.course-main-content') }; };
const courseStored = (uid, kind, course, at = Date.now() - 60000) => {
  const { main } = coursePage(COURSE[kind][1]);
  return { [L.key(ORIGIN, uid, kind, course)]: { v: L.VERSION, uid, kind, course, at, full: false, nodes: L.capture(main, CTX).nodes } };
};

test('a course\'s Course Content, Announcements and Gradebook are kinds of their own, by address; Calendar and other tools aren\'t', () => {
  for (const [kind, [route]] of Object.entries(COURSE)) {
    assert.equal(L.kindOf(route), kind, route);
    assert.equal(L.kindOf(`${route}/`), kind, `${route}/`);
    assert.equal(L.courseOf(route), '_101_1', route);
  }
  for (const p of ['/ultra/grades', '/ultra/course', '/ultra/stream']) assert.equal(L.courseOf(p), '', `${p} is no course's`);
  for (const p of ['/ultra/calendar', '/ultra/courses/_101_1/calendar', '/ultra/courses/_101_1/discussions', '/ultra/courses/_101_1/outline/edit/document/_9_1',
    '/ultra/courses/_101_1/document/_8_1', '/ultra/courses/_101_1/outline/roster', '/ultra/courses/101/outline', '/ultra/courses/_101_1/gradebook']) {
    assert.equal(L.kindOf(p), '', p);
    assert.equal(L.courseOf(p), '', p);
  }
});

test('each course page\'s ready markers, from the live shapes; a copy of a ready course page never counts as ready', () => {
  const all = [...Object.keys(COURSE), 'grades', 'courses', 'stream'];
  for (const [kind, [, f]] of Object.entries(COURSE)) {
    const { doc, main } = coursePage(f);
    assert.equal(L.ready(kind, main), true, `${kind} ready`);
    for (const other of all.filter((k) => k !== kind)) assert.equal(L.ready(other, main), false, `${kind} is not ${other}`);
    const fresh = new El('main', doc), box = new El('div', doc);
    fresh.className = 'course-main-content';
    box.id = 'gz-instant';
    fresh.append(box);
    doc.root.append(fresh);
    L.build(doc, box, L.capture(main, CTX).nodes, CTX);
    assert.ok(box.all().length > 20, kind);
    assert.equal(L.ready(kind, fresh), false, `${kind}: the copy alone isn't Ultra's view`);
  }
  for (const f of ['ultra-instant-grades.html', 'ultra-instant-courses.html', 'ultra-instant-stream.html']) {
    const { main } = page(f);
    for (const kind of Object.keys(COURSE)) assert.equal(L.ready(kind, main), false, `${f} is not ${kind}`);
  }
  // Still loading: the outline with no items yet, the announcements' table with no rows, the gradebook's head row alone.
  const outline = coursePage(COURSE.outline[1]).main;
  for (const item of outline.querySelectorAll('div.root.content-list-item')) item.remove();
  assert.equal(L.ready('outline', outline), false, 'an outline with no items');
  const news = coursePage(COURSE.announcements[1]).main;
  for (const row of news.querySelectorAll('tr.announcement-item-row')) row.remove();
  assert.equal(L.ready('announcements', news), false, 'no rows yet');
  const book = coursePage(COURSE.gradebook[1]).main;
  for (const row of book.querySelectorAll('tbody tr')) row.remove();
  assert.equal(L.ready('gradebook', book), false, 'the head row alone');
});

test('a course page\'s copy keeps its items, titles, links and tables, and leaves out ids, Glaze\'s own parts and controls\' state', () => {
  const o = flat(L.capture(coursePage(COURSE.outline[1]).main, CTX).nodes);
  for (const want of ['content-list-item', 'itemContainer', 'click-to-invoke-container', 'Week 1 folder', 'Notes 1', 'Reading 2', 'Practice check 4',
    '"/ultra/courses/_101_1/document/_8202_1?view=content', '"/ultra/courses/_101_1/outline/roster"', 'course-outline-content', 'bb-course-navigation']) assert.ok(o.includes(want), `outline: ${want}`);
  for (const gone of ['data-content-id', 'folder-title-', '"aria-expanded"', '"role"', '"type"', '"id"']) assert.ok(!o.includes(gone), `outline: ${gone}`);
  const a = L.capture(coursePage(COURSE.announcements[1]).main, CTX);
  for (const t of ['table', 'thead', 'tbody', 'tr', 'td', 'th']) assert.ok(tags(a.nodes).has(t), `announcements: a ${t} stays one`);
  const as = flat(a.nodes);
  for (const want of ['announcement-item-row', 'list-item-title', 'Week 6 update', '"/ultra/stream/announcement-detail?courseId=_101_1']) assert.ok(as.includes(want), `announcements: ${want}`);
  for (const gone of ['list-item-title-_', 'aria-checked', 'data-analytics-id', '"role"']) assert.ok(!as.includes(gone), `announcements: ${gone}`);
  const g = L.capture(coursePage(COURSE.gradebook[1]).main, CTX), gs = flat(g.nodes);
  assert.equal((gs.match(/MuiTableRow-root/g) || []).length, 26, 'the head row and 25 rows');
  for (const gone of ['gz-calc', 'What if', 'course-student-grades-item-name-', 'student-tab-panel-grades', 'course-student-grades-sortable-table']) assert.ok(!gs.includes(gone), `gradebook: ${gone}`);
  assert.ok(gs.includes('Practice item 25') && gs.includes('MuiTableCell-body'));
  // Built back: a table's parts stay a table's; a button is its label, never a control.
  const doc = makeDoc(), box = new El('div', doc);
  L.build(doc, box, a.nodes, CTX);
  const all = box.all();
  assert.equal(all.filter((e) => e.tagName === 'TR' && e.className.includes('announcement-item-row')).length, 6);
  assert.ok(all.every((e) => !['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FORM'].includes(e.tagName)));
  const bad = new El('div', doc);
  L.build(doc, bad, [['button', 'x', { type: 'submit', onclick: 'x()' }, 'Press'], ['table', '', 0, ['tr', '', { onclick: 'x()' }, ['td', '', { colspan: '2' }, 'cell']]]], CTX);
  assert.ok(bad.all().every((e) => !['BUTTON'].includes(e.tagName) && !Object.keys(e.attrs).length), 'a stored button or table carries nothing else');
});

test('copies of a course\'s pages are keyed by site, student, page and course', () => {
  assert.equal(L.key(ORIGIN, '_900_1', 'outline', '_101_1'), `ultraCopy:${ORIGIN}/_900_1/outline/_101_1`);
  assert.equal(L.key(ORIGIN, '_900_1', 'grades'), `ultraCopy:${ORIGIN}/_900_1/grades`, 'the global pages\' keys are as they were');
  const rec = { v: L.VERSION, uid: '_900_1', kind: 'outline', course: '_101_1', at: Date.now() - 1000, nodes: [] };
  assert.equal(L.usable(rec, '_900_1', 'outline', '_101_1'), true);
  assert.equal(L.usable(rec, '_900_1', 'outline', '_102_1'), false, 'another course');
  assert.equal(L.usable(rec, '_900_1', 'outline'), false, 'no course');
  assert.equal(L.usable(rec, '_900_1', 'gradebook', '_101_1'), false, 'another page of the course');
  assert.equal(L.usable({ ...rec, course: '../_101_1' }, '_900_1', 'outline', '../_101_1'), false, 'not a course id');
  assert.equal(L.usable({ v: L.VERSION, uid: '_900_1', kind: 'grades', course: '_101_1', at: Date.now(), nodes: [] }, '_900_1', 'grades'), false, 'a global page names no course');
});

test('on a course page the copy paints over the course\'s main area, not the base page beneath, goes when Ultra\'s view is ready and is kept for that course', async () => {
  for (const [kind, [route, f]] of Object.entries(COURSE)) {
    const p = site({ path: route, local: courseStored('_900_1', kind, '_101_1') });
    const before = p.local[L.key(ORIGIN, '_900_1', kind, '_101_1')].at;
    p.sync();
    await settle();
    assert.equal(p.copy(), null, `${kind}: nothing before the student is confirmed`);
    p.answer('_900_1');
    await settle();
    const box = p.copy();
    assert.ok(box, `${kind}: painted`);
    assert.equal(box.parentElement, p.main, `${kind}: in main.course-main-content`);
    assert.equal(p.base.querySelector('#gz-instant'), null, `${kind}: not in the base page's main`);
    assert.equal(box.attrs['aria-hidden'], 'true');
    assert.equal(box.inert, true);
    assert.equal(p.html.dataset.gzInstant, kind);
    p.fill(f);
    await p.frame1();
    assert.equal(p.copy(), null, `${kind}: gone once Ultra's view is ready`);
    assert.equal(p.idle.length, 1);
    p.idle.shift()();
    const kept = p.local[L.key(ORIGIN, '_900_1', kind, '_101_1')];
    assert.ok(kept.at > before && kept.course === '_101_1' && kept.kind === kind && kept.uid === '_900_1', `${kind}: kept again for its course`);
    assert.ok(!flat(kept.nodes).includes('gz-instant'));
  }
  // Another course's page never shows it.
  const q = site({ path: '/ultra/courses/_102_1/outline', local: courseStored('_900_1', 'outline', '_101_1') });
  q.sync(); q.answer('_900_1'); await settle();
  assert.equal(q.copy(), null, 'another course');
});

test('a route changed ahead of Ultra\'s DOM cannot save the previous course under the new course', async () => {
  const p = site({ path: COURSE.outline[0] });
  p.sync(); p.answer('_900_1'); await settle();
  p.fill(COURSE.outline[1]); await p.frame1();
  for (const f of p.idle.splice(0)) f();
  assert.ok(p.local[L.key(ORIGIN, '_900_1', 'outline', '_101_1')]);
  // Ultra changes the address before its replacement view lands; its old ready outline is still attached.
  p.location.pathname = '/ultra/courses/_102_1/outline';
  p.sync(); await settle();
  for (const f of p.idle.splice(0)) f();
  const key = L.key(ORIGIN, '_900_1', 'outline', '_102_1');
  assert.equal(p.local[key], undefined, 'the old course must not be captured for the new address');
  const next = parse(fixture(COURSE.outline[1]).replaceAll('_101_1', '_102_1').replaceAll('Sample Course One', 'Sample Course Two'), p.doc);
  p.main.replaceChildren(...next.querySelector('main').children);
  await p.frame1();
  for (const f of p.idle.splice(0)) f();
  assert.ok(flat(p.local[key]?.nodes).includes('Sample Course Two'), 'the new course is saved when its own view arrives');
});

test('a course page too large for a copy\'s bounds is not kept cut short', async () => {
  const p = site({ path: COURSE.outline[0] });
  p.sync(); p.answer('_900_1'); await settle();
  p.fill(COURSE.outline[1]);
  const list = p.main.querySelectorAll('div.root.content-list-item')[0].parentElement;
  for (let i = 0; i < 4500; i++) { const d = new El('div', p.doc); d.className = 'root content-list-item'; d.append(`Item ${i}`); list.append(d); }
  await p.frame1();
  for (const f of p.idle.splice(0)) f();
  for (const f of p.events.get('pagehide') || []) f();
  assert.ok(!p.sent.some((m) => m.op === 'put'), 'within the bounds or not at all');
  const q = site({ path: COURSE.outline[0] });
  q.sync(); q.answer('_900_1'); await settle();
  q.fill(COURSE.outline[1]); await q.frame1();
  q.idle.shift()();
  assert.ok(q.sent.some((m) => m.op === 'put' && m.record.full === false), 'a real outline fits');
});

test('a course copy cut short by the depth bound is not saved as a whole page; a long text is clipped and kept', async (t) => {
  for (const bound of ['text', 'depth']) await t.test(bound, async () => {
    const p = site({ path: COURSE.outline[0] });
    p.sync(); p.answer('_900_1'); await settle();
    p.fill(COURSE.outline[1]);
    const item = p.main.querySelector('div.root.content-list-item');
    if (bound === 'text') item.append('x'.repeat(2001));
    else {
      let into = item;
      for (let i = 0; i < 125; i++) { const child = new El('div', p.doc); into.append(child); into = child; }
      into.append('Deep course content');
    }
    p.main.append('After bounded content');
    const captured = L.capture(p.main, CTX);
    assert.equal(captured.full, bound === 'depth', 'left out below the depth bound: cut short; a clipped text is still the whole page');
    assert.ok(flat(captured.nodes).includes('After bounded content'), 'text and depth clipping still allow later siblings in global copies');
    await p.frame1();
    for (const f of p.idle.splice(0)) f();
    for (const f of p.events.get('pagehide') || []) f();
    const put = p.sent.find((m) => m.op === 'put');
    if (bound === 'depth') assert.equal(put, undefined, 'no partial course page is saved');
    else assert.ok(put && flat(put.record.nodes).includes('x'.repeat(2000)) && !flat(put.record.nodes).includes('x'.repeat(2001)), 'kept, its long text clipped');
  });
});

test('in a course tab\'s frame a copy paints only while that frame is on screen loading; never in the standby or another course\'s frame', async () => {
  const [route, f] = COURSE.outline, key = L.key(ORIGIN, '_900_1', 'outline', '_101_1');
  for (const [why, name] of [['the standby', 'gz-ctab:standby'], ['another course\'s frame', 'gz-ctab:_102_1'], ['Canvas\'s page frame', 'gz-ctab:page'], ['an unnamed frame', '']]) {
    const s = site({ path: route, frame: name, local: courseStored('_900_1', 'outline', '_101_1') });
    s.sync(); s.answer('_900_1'); await settle();
    s.tell({ gzCtab: 'copy', picked: true }); await settle();
    assert.equal(s.copy(), null, why);
    assert.equal(s.c.GZ_INSTANT.now(), null, `${why}: no visit`);
    assert.deepEqual(s.toTop, [], `${why}: nothing asked`);
  }
  // A frame kept hidden (warming ahead, a fresh outline under Keep Course Content): it asks, is told no, paints nothing,
  // and still keeps Ultra's view once ready.
  const h = site({ path: route, frame: 'gz-ctab:_101_1', local: courseStored('_900_1', 'outline', '_101_1') });
  const before = h.local[key].at;
  h.sync(); h.answer('_900_1'); await settle();
  assert.deepEqual(h.toTop, [{ gzCtab: 'copy', on: false }], 'asks the page around whether it is on screen');
  h.tell({ gzCtab: 'copy', picked: false }); await settle();
  assert.equal(h.copy(), null, 'hidden: nothing painted');
  h.tell({ gzCtab: 'visible', on: true }); await settle();
  assert.equal(h.copy(), null, 'the page around readying it (Keep Course Content\'s fresh outline) paints nothing');
  h.fill(f); await h.frame1();
  h.idle.shift()();
  assert.ok(h.local[key].at > before, 'kept from a frame too');
  // The frame on screen as it loads: told so, it paints, says so, and shows its page under the copy until Ultra's is ready.
  const p = site({ path: route, frame: 'gz-ctab:_101_1', local: courseStored('_900_1', 'outline', '_101_1') });
  p.tell({ gzCtab: 'copy', picked: true }, {}); // not from the page around
  p.sync(); p.answer('_900_1'); await settle();
  assert.equal(p.copy(), null, 'not before the page around says it is the one on screen');
  p.tell({ gzCtab: 'copy', picked: true }); await settle();
  const box = p.copy();
  assert.ok(box && box.inert === true && box.attrs['aria-hidden'] === 'true', 'painted, inert');
  assert.deepEqual(p.toTop.at(-1), { gzCtab: 'copy', on: true }, 'says it has a copy up');
  assert.ok('gzInstantFrame' in p.html.dataset, 'its page shows under the copy, even while the page around has it as hidden');
  p.tell({ gzCtab: 'visible', on: false });
  assert.deepEqual(p.toTop.at(-1), { gzCtab: 'copy', on: true }, 'hidden or shown again, it says what it has');
  assert.ok(!('gzInstantFrame' in p.html.dataset), 'hidden: its page hides again as the page around has it');
  p.tell({ gzCtab: 'copy', picked: true }); await settle();
  assert.ok('gzInstantFrame' in p.html.dataset);
  // Drawn, as the page around has it: shown as Ultra's, and the copy goes.
  p.tell({ gzCtab: 'visible', on: true }); await p.frame1();
  assert.equal(p.copy(), null, 'drawn: the copy goes');
  assert.deepEqual(p.toTop.at(-1), { gzCtab: 'copy', on: false });
  assert.ok(!('gzInstantFrame' in p.html.dataset));
  // Told first, the copy read after: it paints as the read lands.
  let deliver;
  const q = site({ path: route, frame: 'gz-ctab:_101_1', local: courseStored('_900_1', 'outline', '_101_1'), get: (k, cb) => {
    const r = structuredClone(Object.fromEntries([].concat(k).map((x) => [x, q.local[x]])));
    if (typeof k === 'string' && k.startsWith('ultraCopy:')) deliver = () => cb(r); else cb(r);
  } });
  q.sync(); q.answer('_900_1'); await settle();
  q.tell({ gzCtab: 'copy', picked: true }); await settle();
  assert.equal(q.copy(), null);
  deliver(); await settle();
  assert.ok(q.copy(), 'painted once its copy is read');
});

test('a standby adopted for a course is that course\'s frame from then on, its route in place seen with no page pass', async () => {
  const [route] = COURSE.gradebook;
  const p = site({ path: '/ultra/profile', frame: 'gz-ctab:standby', local: courseStored('_900_1', 'gradebook', '_101_1') });
  p.sync(); await settle();
  assert.equal(p.c.GZ_INSTANT.now(), null);
  // Adopted (coursetabs.js adoptHere): named for the course, routed in place, popstate; told hidden, no page pass follows.
  p.c.name = 'gz-ctab:_101_1'; p.location.pathname = route;
  for (const f of p.events.get('popstate') || []) f({});
  p.answer('_900_1'); await settle();
  assert.deepEqual(p.toTop, [{ gzCtab: 'copy', on: false }]);
  p.tell({ gzCtab: 'copy', picked: true }); await settle();
  // Ultra routed in place puts the course's main area in.
  const section = new El('section', p.doc), main = new El('main', p.doc);
  section.className = 'course bb-offcanvas-container route-view-container'; main.className = 'course-main-content';
  section.append(main); p.html.children[0].append(section);
  await p.frame1();
  assert.ok(main.querySelector('#gz-instant'), 'the adopted frame on screen paints its course\'s copy');
});

test('a frame\'s copy goes with the switch off, on a route change and on sign-out, and says so', async (t) => {
  for (const how of ['off', 'route', 'signout']) await t.test(how, async () => {
    const p = site({ path: COURSE.outline[0], frame: 'gz-ctab:_101_1', local: courseStored('_900_1', 'outline', '_101_1') });
    p.sync(); p.answer('_900_1'); await settle();
    p.tell({ gzCtab: 'copy', picked: true }); await settle();
    assert.ok(p.copy());
    if (how === 'off') { p.settings.enhance.instant = false; p.sync(false); }
    else if (how === 'route') { p.location.pathname = '/ultra/courses/_101_1/outline/edit/document/_9_1'; await p.frame1(); }
    else p.c.GZ_INSTANT.signout();
    assert.equal(p.copy(), null);
    assert.deepEqual(p.toTop.at(-1), { gzCtab: 'copy', on: false });
    assert.equal(p.html.dataset.gzInstant, undefined);
  });
});

test('the worker keeps a course page\'s copy from the top page or a course tab\'s frame, per course and bounded', async () => {
  const w = workerEnv();
  const top = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/courses/_101_1/outline` }, frameId: 0, url: `${ORIGIN}/ultra/courses/_101_1/outline` };
  const frame = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/course` }, frameId: 7, url: `${ORIGIN}/ultra/courses/_102_1/announcements` };
  const record = (kind, course, at = Date.now() - 1000) => ({ ...Object.values(courseStored('_900_1', kind, course, at))[0] });
  const put = async (sender, rec) => { const { epoch } = await w.send({ type: 'glaze:ultraCopy', op: 'begin' }, sender) || {}; return w.send({ type: 'glaze:ultraCopy', op: 'put', epoch, record: rec }, sender); };
  assert.equal((await put(top, record('outline', '_101_1'))).ok, true);
  assert.equal((await put(frame, record('announcements', '_102_1'))).ok, true, 'from a course tab\'s frame');
  assert.deepEqual(w.store.local[L.key(ORIGIN, '_900_1', 'outline', '_101_1')], record('outline', '_101_1', w.store.local[L.key(ORIGIN, '_900_1', 'outline', '_101_1')].at));
  assert.ok(w.store.local[L.key(ORIGIN, '_900_1', 'announcements', '_102_1')]);
  // Not from a frame of another site's tab, and never a global page from a frame.
  const foreign = { ...frame, tab: { id: 4, url: 'https://other.blackboard.com/ultra/course' } };
  assert.equal(await put(foreign, record('outline', '_103_1')), null);
  assert.equal(await put({ ...frame, url: `${ORIGIN}/ultra/grades` }, Object.values(stored('_900_1', 'grades', 'ultra-instant-grades.html'))[0]), null, 'a global page only from the top page');
  for (const bad of [{ course: undefined }, { course: '../_101_1' }, { course: '_101_1/x' }]) assert.equal((await put(top, { ...record('gradebook', '_101_1'), ...bad })).ok, false, JSON.stringify(bad));
  assert.equal((await put(top, { ...Object.values(stored('_900_1', 'grades', 'ultra-instant-grades.html'))[0], course: '_101_1' })).ok, false, 'a global page names no course');
  assert.equal(w.store.local[L.key(ORIGIN, '_900_1', 'gradebook', '_101_1')], undefined);
  // Bounded: the newest course copies a student has on a site stay; the oldest go.
  const now = Date.now();
  for (let i = 0; i < 60; i++) assert.equal((await put(top, { v: 1, uid: '_900_1', kind: 'outline', course: `_${200 + i}_1`, at: now - 600000 + i * 1000, full: false, nodes: [['div', 'x', 0, `Course ${i}`]] })).ok, true);
  const kept = Object.keys(w.store.local).filter((k) => k.startsWith(`ultraCopy:${ORIGIN}/_900_1/`) && !k.endsWith('/index'));
  assert.ok(kept.length <= 48 && kept.length >= 40, `${kept.length} course copies kept`);
  assert.ok(kept.includes(L.key(ORIGIN, '_900_1', 'outline', '_259_1')), 'the newest stays');
  assert.ok(!kept.includes(L.key(ORIGIN, '_900_1', 'outline', '_200_1')), 'the oldest goes');
});

test('delayed course saves older than the retained copies cannot escape the eviction index', async () => {
  const at = Date.now(), local = {}, index = {};
  for (let i = 0; i < 48; i++) {
    const course = `_${100 + i}_1`, key = L.key(ORIGIN, '_900_1', 'outline', course);
    local[key] = { v: 1, uid: '_900_1', kind: 'outline', course, at, full: false, nodes: [['div', '', 0, 'Current']] };
    index[key] = at;
  }
  const ik = `ultraCopy:${ORIGIN}/_900_1/index`;
  local[ik] = index;
  const w = workerEnv({ store: { sync: { version: 2, enabled: true }, local, session: {} } });
  const from = { id: 'glaze', frameId: 7, tab: { id: 3, url: `${ORIGIN}/ultra/course` }, url: `${ORIGIN}/ultra/courses/_999_1/outline` };
  const { epoch } = await w.send({ type: 'glaze:ultraCopy', op: 'begin' }, from);
  for (let i = 0; i < 3; i++) {
    const course = `_${900 + i}_1`;
    await w.send({ type: 'glaze:ultraCopy', op: 'put', epoch,
      record: { v: 1, uid: '_900_1', kind: 'outline', course, at: at - 60000, full: false, nodes: [['div', '', 0, 'Delayed']] } }, from);
    assert.equal(local[L.key(ORIGIN, '_900_1', 'outline', course)], undefined, 'an evicted incoming copy must not be written back');
  }
  const copies = Object.keys(local).filter((k) => k.startsWith('ultraCopy:') && k !== ik);
  assert.equal(copies.length, 48);
  assert.deepEqual(Object.keys(local[ik]).sort(), copies.sort());
});

test('purges cover the course pages\' copies: sign-out, the switch off, Reset and the site removed', async (t) => {
  for (const reason of ['sign-out', 'switch', 'reset', 'remove']) await t.test(reason, async () => {
    const local = { ultra: [], ...courseStored('_900_1', 'outline', '_101_1'), ...courseStored('_800_1', 'gradebook', '_102_1'), [`ultraCopy:${ORIGIN}/_900_1/index`]: { [L.key(ORIGIN, '_900_1', 'outline', '_101_1')]: 1 } };
    const w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: { instant: true } }, local, session: {} } });
    const from = { id: 'glaze', tab: { id: 3, url: `${ORIGIN}/ultra/courses/_101_1/outline` }, frameId: 0, url: `${ORIGIN}/ultra/courses/_101_1/outline` };
    if (reason === 'sign-out') await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from);
    else if (reason === 'switch') await w.context.chrome.storage.sync.set({ enhance: { instant: false } });
    else await w.send({ type: 'glaze:sites', op: reason, origin: ORIGIN }, { id: 'glaze', tab: { id: 5 }, frameId: 0, url: 'chrome-extension://x/options.html' });
    await w.settle();
    assert.deepEqual(Object.keys(w.store.local).filter((k) => k.startsWith('ultraCopy:')), [], 'every course copy and its index');
  });
});

test('the copy\'s styles cover a course page\'s main area, and a frame\'s page shows under its copy', () => {
  const css = read('content/extras.css');
  assert.match(css, /html\[data-gz-instant\] main\.bb-offcanvas-container > :not\(\[id\^="gz-"\]\),\nhtml\[data-gz-instant\] main\.course-main-content > :not\(\[id\^="gz-"\]\) \{ visibility: hidden !important; \}/);
  assert.match(css, /html\[data-gz-instant-frame\] #site-wrap \{ visibility: visible !important; \}/);
});

test('one switch for every copy: "Open pages instantly", said in every language', () => {
  const html = read('options.html');
  assert.match(html, /<input type="checkbox" data-key="enhance\.instant"><span>Open pages instantly<\/span>/);
  assert.doesNotMatch(html, /Open Grades, Courses and Activity instantly/);
  for (const f of fs.readdirSync(path.join(root, 'i18n'))) {
    assert.match(read(`i18n/${f}`), /"Open pages instantly": "[^"]+"/, f);
    assert.doesNotMatch(read(`i18n/${f}`), /Open Grades, Courses and Activity instantly/, f);
  }
  assert.equal(D.GZ_SANITIZE({}).enhance.instant, true, 'the same key, on by default');
});

test('Ultra putting its ready view in place of the copy swaps it out in that frame, never a frame of neither', async () => {
  const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
  p.sync();
  p.answer('_900_1');
  await settle();
  const box = p.copy();
  assert.ok(box, 'painted');
  // Ultra replaces its main area's children, the copy with them, by its ready view.
  p.fill('ultra-instant-grades.html');
  assert.equal(box.isConnected, false);
  p.mutated();
  p.frameOnce();
  await settle();
  assert.equal(p.html.dataset.gzInstant, undefined, 'its view shows in the frame it came in, as the copy already went with the old view');
  // Still in place (Ultra's view in beside it): it waits for the view's layout, a frame on.
  const q = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
  q.sync();
  q.answer('_900_1');
  await settle();
  const kept = q.copy();
  const view = parse(fixture('ultra-instant-grades.html'), q.doc).querySelector('main');
  q.main.append(...view.children);
  q.mutated();
  q.frameOnce();
  await settle();
  assert.equal(q.html.dataset.gzInstant, 'grades', 'the copy over it until the view has laid out');
  assert.equal(kept.isConnected, true);
  q.frameOnce();
  await settle();
  assert.equal(q.html.dataset.gzInstant, undefined);
});

test('what shows in the copy\'s place is there at once: Glaze\'s finite entrances in the main area end', async () => {
  const p = site({ local: stored('_900_1', 'grades', 'ultra-instant-grades.html') });
  p.sync();
  p.answer('_900_1');
  await settle();
  const anims = [['gz-in', 300], ['gz-drift', Infinity], ['ultra-own', 300]].map(([animationName, endTime]) => ({ animationName, done: false,
    effect: { getComputedTiming: () => ({ endTime }) }, finish() { if (!Number.isFinite(endTime)) throw Error('InvalidStateError'); this.done = true; } }));
  p.main.getAnimations = (o) => (o?.subtree ? anims : []);
  p.fill('ultra-instant-grades.html');
  await p.frame1();
  assert.equal(p.html.dataset.gzInstant, undefined);
  assert.deepEqual(anims.map((a) => [a.animationName, a.done]), [['gz-in', true], ['gz-drift', false], ['ultra-own', false]]);
});

test('a course copy also finishes the entrance on the course container surrounding its main area', async () => {
  for (const replaced of [true, false]) {
    const p = site({ path: COURSE.outline[0], local: courseStored('_900_1', 'outline', '_101_1') });
    p.sync();
    p.answer('_900_1');
    await settle();
    assert.ok(p.copy());
    const container = p.main.parentElement;
    assert.match(container.className, /route-view-container/, 'motion.css animates this ancestor');
    const entrance = { animationName: 'gz-in', done: false, effect: { getComputedTiming: () => ({ endTime: 450 }) }, finish() { this.done = true; } };
    container.getAnimations = () => [entrance];
    p.base.getAnimations = () => { throw Error('the unrelated base page must keep its animations'); };
    if (replaced) p.fill(COURSE.outline[1]);
    else p.main.append(...parse(fixture(COURSE.outline[1]), p.doc).querySelector('main').children);
    await p.frame1();
    assert.equal(p.copy(), null);
    assert.equal(entrance.done, true, `the course is fully visible when its ${replaced ? 'replaced' : 'connected'} copy goes`);
  }
});
