// The notes app around lib/notes.js: who the service worker takes notes changes from, the rules the page keeps when it
// asks Canvas for links, and the whole view (features/notes.js) on a small stand-in page with the real lib/notes.js as
// its worker: faked events, export snapshots and settling, uploads, duplicate, and the course-home registration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test("the worker takes a page's notes changes for its own site's index only", async () => {
  const listeners = [];
  const store = { local: {}, sync: {} };
  const area = (s) => ({ get: async (k) => Object.fromEntries([].concat(k ?? Object.keys(s)).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])), set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async () => {} });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    navigator: {}, // no IndexedDB here: a change that gets past the sender check fails on the database, closed
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => { for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) return; res('ignored'); });
  const page = (url) => ({ id: 'glaze', tab: {}, url });
  const m = { type: 'glaze:notesapp', key: 'notesIdx:https://school.instructure.com/5', op: 'search', q: 'x' };
  for (const [sender, why] of [
    [page('https://other.instructure.com/courses/1'), "another site's page"],
    [{ id: 'other', tab: {}, url: 'https://school.instructure.com/' }, 'another extension'],
    [{ id: 'glaze', url: 'https://school.instructure.com/' }, 'not in a tab'],
    [page('https://evil.example/'), 'a site Glaze does not run on'],
  ]) assert.deepEqual(await send(m, sender), { ok: false, error: 'sender' }, why);
  assert.deepEqual(await send({ ...m, key: 'notesIdx:https://school.instructure.com/5/../6' }, page('https://school.instructure.com/')), { ok: false, error: 'sender' }, 'a key outside the pattern');
  assert.deepEqual(await send(m, page('https://school.instructure.com/courses/1')), { ok: false, error: 'db' }, 'its own site: past the check, and the database it lacks fails it');
  assert.deepEqual(store.local, {}, 'nothing written');
});

test('the Canvas link picker: read-only GETs on this site, redirects refused, stopped when the picker or the view closes', () => {
  const src = read('features/notes.js');
  const fetches = [...src.matchAll(/\bfetch\(([^;]+)\);/g)].map((x) => x[1]);
  assert.equal(fetches.length, 1, 'one place asks Canvas for anything');
  assert.match(fetches[0], /^url, \{ credentials: 'same-origin', redirect: 'error', signal,/);
  assert.doesNotMatch(fetches[0], /method|body/);
  assert.match(src, /let url = `\$\{location\.origin\}\/api\/v1\$\{path\}`/, 'starts on this site');
  assert.match(src, /new URL\(next, location\.origin\)\.origin === location\.origin \?/, 'the next page only on this site');
  assert.match(src, /box\.addEventListener\('close', \(\) => \{[\s\S]{0,200}pick\?\.abort\(\);/, 'closing the view stops it');
  assert.match(src, /const done = \(\) => \{ ctl\.abort\(\);/, 'closing the picker stops it');
  // Nothing else leaves the page: no other request, no beacon, no remote picture.
  for (const word of ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) assert.ok(!src.includes(word), word);
});

// ---- the whole view on a stand-in page -----------------------------------------------------------------------------
const N = require('../lib/notes.js');
const SOURCE = read('features/notes.js');
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const later = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return Object.assign(p, { resolve }); };
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Simple selectors only: tag, #id, .class and [attr] or [attr="v"] compounds, joined by spaces or > (both as descendant).
const one = (el, part) => {
  const m = part.match(/^([a-z0-9]+|\*)?((?:[#.][\w-]+|\[[^\]]+\])*)$/i);
  if (!m || !el.tagName || (m[1] && m[1] !== '*' && el.tagName !== m[1].toUpperCase())) return false;
  return (m[2].match(/[#.][\w-]+|\[[^\]]+\]/g) || []).every((x) => {
    if (x[0] === '#') return el.id === x.slice(1);
    if (x[0] === '.') return String(el.className).split(/\s+/).includes(x.slice(1));
    const [, k, v] = x.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    const a = el.getAttribute(k);
    return a != null && (v == null || a === v);
  });
};
const matches = (el, sel) => sel.split(',').some((alt) => {
  const parts = alt.trim().split(/\s*>\s*|\s+/);
  if (!one(el, parts.at(-1))) return false;
  let i = parts.length - 2;
  for (let p = el.parentNode; i >= 0 && p; p = p.parentNode) if (one(p, parts[i])) i--;
  return i < 0;
});
const camel = (k) => k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
class El {
  constructor(tag, doc) { Object.assign(this, { tagName: tag.toUpperCase(), doc, children: [], parentNode: null, attrs: {}, dataset: {}, listeners: [], className: '', id: '', hidden: false, _html: '', style: { setProperty() {} } }); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.root; }
  kids(list) { return list.filter((k) => k != null && k !== false).map((k) => (k instanceof El ? k : { nodeType: 3, textContent: String(k) })); }
  adopt(k) { if (k instanceof El && k.parentNode) k.parentNode.children.splice(k.parentNode.children.indexOf(k), 1); k.parentNode = this; return k; }
  append(...k) { for (const x of this.kids(k)) this.children.push(this.adopt(x)); }
  prepend(...k) { this.children.unshift(...this.kids(k).map((x) => this.adopt(x))); }
  replaceChildren(...k) { for (const c of this.children) c.parentNode = null; this.children = []; this._html = ''; this.append(...k); }
  after(x) { const p = this.parentNode, k = this.kids([x])[0]; p.adopt(k); p.children.splice(p.children.indexOf(this) + 1, 0, k); }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  replaceWith(...k) { const p = this.parentNode, at = p.children.indexOf(this); this.remove(); p.children.splice(at, 0, ...this.kids(k).map((x) => p.adopt(x))); }
  get previousElementSibling() { const s = this.parentNode?.children || []; return s.slice(0, s.indexOf(this)).filter((x) => x instanceof El).at(-1) || null; }
  get lastChild() { return this.children.at(-1) || null; }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = String(v); else if (k.startsWith('data-')) this.dataset[camel(k)] = String(v); else this.attrs[k] = String(v); }
  getAttribute(k) { if (k === 'id') return this.id || null; if (k === 'class') return this.className || null; if (k === 'hidden') return this.hidden ? '' : null; if (k.startsWith('data-')) return this.dataset[camel(k)] ?? null; return this.attrs[k] ?? null; }
  hasAttribute(k) { return this.getAttribute(k) != null; }
  removeAttribute(k) { if (k.startsWith('data-')) delete this.dataset[camel(k)]; else delete this.attrs[k]; }
  get textContent() { return this._html ? this._html.replace(/<[^>]*>/g, '') : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(...(String(v) ? [String(v)] : [])); }
  get innerHTML() { return this._html || this.children.map((c) => (c instanceof El ? `<${c.tagName.toLowerCase()}>${c.innerHTML}</${c.tagName.toLowerCase()}>` : c.textContent)).join(''); }
  set innerHTML(v) { this.replaceChildren(); this._html = String(v); }
  get value() { return this.tagName === 'SELECT' ? (this._value ?? (this.children.find((o) => o.selected) || this.children[0])?.value ?? '') : this._value ?? ''; }
  set value(v) { this._value = v; }
  cloneNode() { const c = new El(this.tagName, this.doc); c._html = this.innerHTML; return c; }
  all() { return this.children.filter((c) => c instanceof El).flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((e) => matches(e, sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { for (let p = this; p && p.tagName; p = p.parentNode) if (matches(p, sel)) return p; return null; }
  contains(e) { for (let p = e; p; p = p.parentNode) if (p === this) return true; return false; }
  addEventListener(type, f, capture) { this.listeners.push({ type, f, capture: !!capture }); }
  removeEventListener(type, f) { this.listeners = this.listeners.filter((l) => l.type !== type || l.f !== f); }
  dispatchEvent(ev) { for (const l of this.listeners.filter((x) => x.type === ev.type)) l.f(ev); return true; }
  focus() { this.doc.activeElement = this; }
  scrollIntoView() {}
  click() { this.doc.fire(this, 'click', { trusted: false }); }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent({ type: 'close' }); }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 20 }; }
}
// A Canvas course home with Glaze and Notes on; the worker is lib/notes.js run over memory, its answers and storage's
// change events arriving later, as in a browser. env.activation: navigator.userActivation.isActive; env.hold(m): a
// promise the worker waits for before it runs m; env.zipHold: a promise loading lib/zip.js waits for. on: the page's own
// copy of the Notes switch; stored: the switch in storage.sync (the two differ just after it is turned on elsewhere);
// live: whether Glaze has finished starting on the page (GZ_CTX.on()); enabled: the page's own copy of the master switch.
// env.syncHold: a promise a storage.sync read answers after (with what was stored when it was asked);
// env.changeSync(patch): those items changed in storage.sync, reported as storage reports them (only what changed).
// env.syncFail: a storage.sync read throws (the extension reloaded, or storage failed).
const D = require('../defaults.js');
const page = ({ on = true, stored = on, live = true, enabled = true } = {}) => {
  const doc = { activeElement: null, root: null };
  const make = (t) => new El(t, doc);
  doc.root = make('html');
  doc.body = make('body');
  doc.root.append(doc.body);
  const side = make('div');
  side.id = 'course_show_secondary';
  doc.body.append(side);
  doc.activeElement = doc.body;
  // Events: capture from the top down to the target, then bubbling back up, as the DOM does.
  doc.fire = (target, type, { trusted = true, ...extra } = {}) => {
    const route = [];
    for (let p = target; p; p = p.parentNode) route.push(p);
    let stopped = false, now = false;
    const ev = { type, target, isTrusted: trusted, defaultPrevented: false, ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = now = true; } };
    const call = (el, capture) => { for (const l of el.listeners.filter((x) => x.type === type && x.capture === capture)) { if (now) return; l.f(ev); } };
    for (const el of [...route].reverse()) { call(el, true); if (stopped) return ev; }
    for (const el of route) { call(el, false); if (stopped) return ev; }
    return ev;
  };
  Object.assign(doc, {
    createElement: make, getElementById: (x) => doc.root.all().find((e) => e.id === x) || null, querySelector: (s) => doc.root.querySelector(s),
    addEventListener() {}, removeEventListener() {}, execCommand: () => true,
  });
  const store = {}, db = { bodies: new Map(), files: new Map(), blobs: new Map() };
  const changed = [];
  const local = {
    get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
    set: async (o) => { Object.assign(store, structuredClone(o)); setTimeout(() => { for (const f of changed) f(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: structuredClone(v) }])), 'local'); }, 5); return true; },
  };
  const idb = { get: async (s, k) => db[s].get(k), put: async (s, k, v) => { db[s].set(k, v); }, del: async (s, ks) => { for (const k of ks) db[s].delete(k); },
    scan: async (s, p) => [...db[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...db[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ usage: 1, quota: 1e9 }) };
  const sent = [], blobs = [];
  const env = { doc, sent, blobs, activation: true, hold: () => null, zipHold: null, live, syncHold: null, sync: { enabled: true, enhance: { notes: stored } } };
  env.changeSync = (patch) => {
    Object.assign(env.sync, structuredClone(patch));
    for (const f of changed) f(Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { newValue: structuredClone(v) }])), 'sync');
  };
  const URLs = Object.assign(function () {}, { createObjectURL: (b) => { blobs.push(b); return `blob:x/${blobs.length}`; }, revokeObjectURL() {} });
  const context = vm.createContext({
    document: doc, window: {}, location: { origin: 'https://school.instructure.com', pathname: '/courses/7', href: 'https://school.instructure.com/courses/7' },
    navigator: { platform: 'MacIntel', get userActivation() { return { isActive: env.activation }; } },
    getSelection: () => ({ rangeCount: 0, anchorNode: null, isCollapsed: true, removeAllRanges() {}, addRange() {} }),
    // The view's minute-long timers (revoking a download's address) mustn't keep the test process waiting.
    setTimeout: (f, ms) => { const h = setTimeout(f, ms); if (ms >= 1000) h.unref(); return h; },
    addEventListener() {}, URL: URLs, Blob, Date, clearTimeout, crypto: globalThis.crypto, Promise, JSON, structuredClone,
    GZ_NOTES: N, GZ_DOCTEXT: require('../lib/doctext.js'), GZ_ZIP: require('../lib/zip.js'), GZ_I18N: require('../lib/i18n.js'), GZ_PAGE: require('../lib/page.js'),
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_LOOKS: D.GZ_LOOKS, GZ_ALL_PRESETS: D.GZ_ALL_PRESETS, GZ_LOOK_ON: D.GZ_LOOK_ON, GZ_LOOK_APPLY: D.GZ_LOOK_APPLY,
    GZ_CTX: {
      t: (k, v) => k.replace(/\{(\w+)\}/g, (m, x) => v?.[x] ?? m), on: () => env.live, locale: () => 'en', settings: () => D.GZ_SANITIZE({ enabled, enhance: { notes: on, palette: true, search: false } }), wordsIn: new Set(),
      profile: async () => ({ id: 5 }), canvasCourses: async () => [{ id: 7, name: 'Biology' }, { id: 9, name: 'History' }],
      need: (file) => (file === 'lib/zip.js' && env.zipHold) || Promise.resolve(),
      // What the command palette (features/palette.js) asks of the page.
      site: 'canvas', capi: async () => [], canvasCourseId: () => '7', dueWeek: async () => [], nickOf: () => '', courseList: () => ({}),
    },
    chrome: {
      runtime: { sendMessage: (m, cb) => { sent.push(m); Promise.resolve(env.hold(m)).then(() => N.run(m, { local }, idb)).then((r) => cb(JSON.parse(JSON.stringify(r)))); } },
      storage: { local: { get: (k, cb) => local.get(k).then(cb) }, sync: { get: (k, cb) => { if (env.syncFail) throw new Error('Extension context invalidated.'); const r = structuredClone(env.sync); Promise.resolve(env.syncHold).then(() => cb(r)); } }, onChanged: { addListener: (f) => changed.push(f) } },
    },
  });
  context.window.top = context.window;
  env.ui = vm.runInContext(SOURCE, context);
  env.run = (src) => vm.runInContext(src, context);
  env.ops = () => sent.map((m) => m.op);
  env.box = () => doc.getElementById('gz-nt');
  env.button = (text) => env.box().querySelectorAll('button').find((b) => b.textContent === text);
  env.items = () => env.box().querySelectorAll('.gz-nt-item');
  env.say = () => env.box().querySelector('.gz-nt-say').textContent;
  env.fire = doc.fire;
  env.seed = async (list) => { for (const n of list) await N.run({ key: 'notesIdx:https://school.instructure.com/5', op: 'save', base: 0, sid: `s${n.id}`, copy: id(999), ...n }, { local }, idb); await wait(10); };
  env.openView = async () => { await env.ui.home(); env.fire(doc.getElementById('gz-nt-course'), 'click'); await settle(); };
  return env;
};
const zipNotes = async (blob) => JSON.parse(await require('../lib/doctext.js').unzip(new Uint8Array(await blob.arrayBuffer())).text('notes.json')).notes;

test("the page's scripts can't open Notes or pick a note: a faked click, change or typing is ignored", async () => {
  const P = page();
  await P.seed([{ id: id(1), title: 'Biology notes', course: '7', html: '<p>bio</p>' }, { id: id(2), title: 'Secret history', course: '9', html: '<p>Previously closed private text</p>' }]);
  await P.ui.home();
  const button = P.doc.getElementById('gz-nt-course');
  assert.ok(button, 'the Course notes button is on the course home');
  P.fire(button, 'click', { trusted: false });
  await settle();
  assert.equal(P.box(), null, 'a faked click opens nothing');
  assert.deepEqual(P.ops(), []);
  P.activation = false;
  P.fire(button, 'click');
  await settle();
  assert.equal(P.box(), null, 'nor does a click without the user activation a real one has');
  P.activation = true;
  P.fire(button, 'click');
  await settle();
  assert.ok(P.box()?.open, "the student's own click opens it");
  const titles = () => P.items().map((b) => b.querySelector('strong').textContent);
  assert.deepEqual(titles(), ['Biology notes'], "this course's notes");
  // Faked: picking a note, the course filter, the trash.
  P.fire(P.items()[0], 'click', { trusted: false });
  const course = P.box().querySelector('.gz-nt-filters select');
  course.value = '';
  P.fire(course, 'change', { trusted: false });
  P.fire(P.box().querySelector('.gz-nt-lib button[aria-pressed]'), 'click', { trusted: false });
  await settle();
  assert.ok(!P.ops().includes('load'), 'no note was read');
  assert.deepEqual(titles(), ['Biology notes'], "no other course's notes listed");
  assert.ok(!P.box().innerHTML.includes('Previously closed private text'));
  // Typing a script makes the browser do (execCommand), without the student's own recent click or key: dropped too.
  P.activation = false;
  const search = P.box().querySelector('input');
  search.value = 'secret';
  P.fire(search, 'input');
  await wait(300);
  assert.ok(!P.ops().includes('search'));
  P.activation = true;
  P.fire(P.items()[0], 'click');
  await settle();
  assert.ok(P.ops().includes('load'), 'a real click on a note opens it');
});

test("a control a page script moves out of the view and fakes an event on does nothing (Codex W19a fix verification)", async () => {
  const P = page();
  // The list shows each listed note's first line; the rest of a note's text only comes with opening it.
  await P.seed([{ id: id(1), title: 'Opened', course: '7', html: '<p>seen</p>' }, { id: id(2), title: 'Never opened', course: '7', html: `<p>${'first line '.repeat(15)}</p><p>Deep private text</p>` },
    { id: id(3), title: 'Other course', course: '9', html: '<p>Other course secret</p>' }]);
  await P.openView();
  // Out of the dialog, past its capture filter: the course filter, a note's button, the trash and New note.
  const course = P.box().querySelector('.gz-nt-filters select');
  P.doc.body.append(course);
  course.value = '';
  P.fire(course, 'change', { trusted: false });
  const unopened = P.items().find((b) => b.textContent.startsWith('Never opened'));
  P.doc.body.append(unopened);
  P.fire(unopened, 'click', { trusted: false });
  const trash = P.box().querySelector('.gz-nt-lib button[aria-pressed]');
  P.doc.body.append(trash);
  P.fire(trash, 'click', { trusted: false });
  await settle();
  assert.ok(!P.ops().includes('load'), 'no note was read');
  assert.ok(!P.doc.root.innerHTML.includes('Deep private text'));
  assert.ok(!P.doc.root.innerHTML.includes('Other course secret'), "no other course's notes listed");
});

test("the palette's Notes rows open Notes only for a real click or Enter, carried through loading the notes code", async () => {
  const P = page();
  await P.seed([{ id: id(2), title: 'Never opened', course: '7', html: '<p>Previously closed private text</p>' }]);
  const cmd = P.run(read('features/palette.js'));
  const row = async () => {
    cmd.open();
    await settle();
    const input = P.doc.getElementById('gz-cmd').querySelector('input');
    input.value = 'Notes';
    P.fire(input, 'input', { trusted: false });
    await settle();
    const li = P.doc.getElementById('gz-cmd').querySelectorAll('li').find((x) => x.children[0]?.textContent === 'Notes');
    assert.ok(li, 'the palette lists Notes');
    return { input, li };
  };
  // Recent activation (the student opened the palette) is not the choice of Notes: faked click, faked Enter.
  let { li } = await row();
  P.fire(li, 'click', { trusted: false });
  await settle();
  assert.equal(P.box(), null, 'a faked click on the Notes row opens nothing');
  const { input } = await row();
  for (let i = 0; i < 20 && P.doc.getElementById('gz-cmd').querySelector('[aria-selected="true"]')?.children[0]?.textContent !== 'Notes'; i++) P.fire(input, 'keydown', { trusted: false, key: 'ArrowDown' });
  P.fire(input, 'keydown', { trusted: false, key: 'Enter' });
  await settle();
  assert.equal(P.box(), null, 'a faked Enter on it opens nothing');
  assert.ok(!P.ops().includes('load'));
  ({ li } = await row());
  P.fire(li, 'click');
  await settle();
  assert.ok(P.box()?.open, "the student's own click opens it");
});

test('restoring a deleted note from a backup keeps the files staged for it, whatever another tab cleans up meanwhile', async () => {
  const store = {}, db = { bodies: new Map(), files: new Map(), blobs: new Map() };
  const local = { get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}), set: async (o) => { Object.assign(store, structuredClone(o)); return true; } };
  const idb = { get: async (s, k) => db[s].get(k), put: async (s, k, v) => { db[s].set(k, v); }, del: async (s, ks) => { for (const k of ks) db[s].delete(k); },
    scan: async (s, p) => [...db[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...db[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => null };
  const run = (m, at) => N.run({ key: 'notesIdx:https://school.instructure.com/5', ...m }, { local }, idb, at);
  const png = N.b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  const t = Date.UTC(2026, 9, 1), A = id(1), F = id(20);
  await run({ op: 'file', id: F, kind: 'image', name: 'a.png', data: png, note: A }, t);
  await run({ op: 'save', id: A, base: 0, sid: 'a', html: `<p><img data-gz-file="${F}"></p>`, title: 'A', copy: id(90) }, t + 1);
  await run({ op: 'trash', ids: [A] }, t + 2);
  await run({ op: 'purge', ids: [A] }, t + 3);
  assert.equal((await run({ op: 'getFile', id: F }, t + 4)).ok, false, 'deleted with its note');
  // The backup: its picture staged, another tab's clean-up, then the note.
  assert.equal((await run({ op: 'file', id: F, kind: 'image', name: 'a.png', data: png, note: A }, t + 10)).ok, true);
  assert.equal((await run({ op: 'tidy' }, t + 11)).freed, 0);
  assert.deepEqual(await run({ op: 'import', notes: [{ id: A, title: 'A', created: t, at: t + 1, html: `<p><img data-gz-file="${F}"></p>` }] }, t + 12), { ok: true, done: 1, skipped: 0 });
  assert.equal((await run({ op: 'getFile', id: F }, t + 13)).ok, true);
});

test('turning Notes on puts the Course notes hook into course homes already open, and into a newly found Canvas site', async () => {
  const changed = [], listeners = [], injected = [];
  let registered = [];
  const store = { local: { canvas: ['https://canvas.school.edu/*'] }, sync: { enhance: { notes: false } } };
  const area = (s) => ({ get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])), set: async (v) => { Object.assign(s, structuredClone(v)); } });
  const tabs = [{ id: 4, url: 'https://school.instructure.com/courses/7' }, { id: 5, url: 'https://canvadocs.instructure.com/courses/1/x' }];
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener: (f) => changed.push(f) } },
      tabs: { query: async ({ url }) => tabs.filter((t) => url.some((p) => new RegExp(`^${p.replace(/[.?]/g, '\\$&').replace(/\*/g, '.*')}$`).test(t.url))) },
      scripting: {
        getRegisteredContentScripts: async () => registered,
        registerContentScripts: async (l) => { registered.push(...l); },
        unregisterContentScripts: async ({ ids }) => { registered = registered.filter((s) => !ids.includes(s.id)); },
        executeScript: async (o) => { injected.push([o.target.tabId, [...o.target.frameIds], [...o.files].join()]); return [{ result: true }]; },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const toggle = async (enhance) => { store.sync.enhance = enhance; for (const f of changed) f({ enhance: {} }, 'sync'); await wait(10); };
  await toggle({ notes: true });
  assert.deepEqual(injected, [[4, [0], 'features/notes-home.js']], 'the open course home, top frame; never the document viewer');
  await toggle({ notes: true, todo: true });
  assert.equal(injected.length, 1, 'only when it is turned on');
  await toggle({ notes: false });
  await toggle({ notes: true });
  assert.equal(injected.length, 2, 'on again: again');
  // A Canvas site found on a page (lib/detect.js): Glaze first, then the hook, and the site's pages registered for it.
  injected.length = 0;
  for (const f of listeners) f('canvas', { tab: { id: 8 }, frameId: 0, url: 'https://canvas.new.edu/courses/3' }, () => {});
  await wait(20);
  const canvasFirst = require('../manifest.json').content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*')).js; // Canvas's first script (B0b)
  assert.deepEqual(injected.map(([tab, , files]) => [tab, files]), [[8, canvasFirst.join()], [8, 'features/notes-home.js']]);
  assert.ok(registered.find((s) => s.id === 'gz-notes-home').matches.includes('https://canvas.new.edu/courses/*'));
});

test("the hook in a page whose own settings haven't caught up reads the switch from storage", async () => {
  const P = page({ on: false, stored: true });
  P.run(read('features/notes-home.js'));
  await settle();
  assert.ok(P.doc.getElementById('gz-nt-course'), 'Course notes is there at once');
  const Q = page({ on: true, stored: false });
  Q.run(read('features/notes-home.js'));
  await settle();
  assert.equal(Q.doc.getElementById('gz-nt-course'), null, 'and not when storage says it is off');
});

test('Export all stores the open note first and exports the index as stored then; a file that can\'t be read fails it', async () => {
  const P = page();
  await P.openView();
  P.fire(P.button('New note'), 'click');
  await settle();
  const body = P.box().querySelector('.gz-nt-body');
  body.innerHTML = '<p>Typed just now</p>';
  P.fire(body, 'input');
  let release = null;
  P.hold = (m) => (m.op === 'save' && !release ? (release = later()) : null);
  P.fire(P.button('Export all'), 'click');
  await settle();
  assert.equal(P.blobs.length, 0, 'nothing downloaded while the save is on its way');
  release.resolve();
  await settle(60);
  assert.equal(P.blobs.length, 1);
  assert.deepEqual((await zipNotes(P.blobs[0])).map((n) => n.html), ['<p>Typed just now</p>']);
  // A note whose picture can't be read: no archive, and the student is told.
  const Q = page();
  await Q.seed([{ id: id(3), title: 'With a picture', html: `<p>x<img data-gz-file="${id(30)}"></p>` }]);
  await Q.openView();
  Q.fire(Q.button('Export all'), 'click');
  await settle(60);
  assert.equal(Q.blobs.length, 0);
  assert.match(Q.say(), /Couldn't export “With a picture”/);
});

test('Export as HTML exports the note it was pressed in, whatever is opened meanwhile', async () => {
  const P = page();
  await P.seed([{ id: id(1), title: 'Note A', course: '7', html: `<p>A text<img data-gz-file="${id(30)}"></p>` }, { id: id(2), title: 'Note B', course: '7', html: '<p>B text</p>' }]);
  await P.openView();
  const item = (t) => P.items().find((b) => b.textContent.startsWith(t));
  P.fire(item('Note A'), 'click');
  await settle();
  P.zipHold = later();
  let pictures = null;
  P.hold = (m) => (m.op === 'getFile' && !pictures ? (pictures = later()) : null);
  P.fire(P.button('Export as HTML'), 'click');
  await settle();
  P.fire(item('Note B'), 'click');
  await settle();
  P.zipHold.resolve();
  pictures?.resolve();
  await settle(40);
  const html = await P.blobs.at(-1).text();
  assert.match(html, /<title>Note A<\/title>/);
  assert.match(html, /A text/);
  assert.doesNotMatch(html, /B text/);
});

test('uploads: a file over the limit is refused before it is read, and nothing is sent once the view has closed', async () => {
  const P = page();
  await P.openView();
  P.fire(P.button('New note'), 'click');
  await settle();
  const input = P.box().querySelectorAll('input').find((i) => i.type === 'file' && !i.accept);
  let read = false;
  input.files = [{ name: 'huge.bin', size: 20 * 2 ** 30, type: 'application/octet-stream', arrayBuffer: async () => { read = true; throw new Error('read'); } }];
  P.fire(input, 'change');
  await settle();
  assert.equal(read, false, 'not read');
  assert.match(P.say(), /Attachments can be up to 20 MB/);
  // Closed while a file is read: it never reaches the worker.
  const bytes = later();
  input.files = [{ name: 'lab.csv', size: 10, type: 'text/csv', arrayBuffer: () => bytes }];
  P.fire(input, 'change');
  await settle();
  P.fire(P.button('Close'), 'click');
  bytes.resolve(new ArrayBuffer(10));
  await settle();
  assert.ok(!P.ops().includes('file'));
});

test('Duplicate makes "<title> (copy)" and opens it', async () => {
  const P = page();
  await P.seed([{ id: id(1), title: 'Week 3', course: '7', html: '<p>cells</p>' }]);
  await P.openView();
  P.fire(P.items()[0], 'click');
  await settle();
  P.fire(P.button('Duplicate'), 'click');
  await settle(40);
  const copy = P.sent.find((m) => m.op === 'save' && m.base === 0);
  assert.equal(copy.title, 'Week 3 (copy)');
  assert.equal(P.box().querySelector('.gz-nt-title').value, 'Week 3 (copy)', 'the copy is what opens');
});

test('the Course notes button costs the first script nothing: the worker registers it only while Notes is on', async () => {
  const changed = [];
  let registered = [];
  const store = { local: { canvas: ['https://canvas.school.edu/*'] }, sync: { enhance: { notes: false } } };
  const area = (s) => ({ get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, structuredClone(s[x])])), set: async (v) => { Object.assign(s, structuredClone(v)); } });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto, atob, btoa, navigator: {},
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener() {} },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener: (f) => changed.push(f) } },
      scripting: {
        getRegisteredContentScripts: async () => registered,
        registerContentScripts: async (l) => { registered.push(...l); },
        unregisterContentScripts: async ({ ids }) => { registered = registered.filter((s) => !ids.includes(s.id)); },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const toggle = async (on) => { store.sync.enhance = { notes: on }; for (const f of changed) f({ enhance: {} }, 'sync'); await wait(10); };
  await toggle(true);
  const s = registered.find((x) => x.id === 'gz-notes-home');
  assert.deepEqual([...s.js], ['features/notes-home.js']);
  assert.deepEqual([...s.matches].sort(), ['https://*.instructure.com/courses/*', 'https://canvas.school.edu/courses/*']);
  assert.deepEqual([...s.excludeMatches], ['https://canvadocs.instructure.com/*']);
  await toggle(false);
  assert.equal(registered.find((x) => x.id === 'gz-notes-home'), undefined);
  // The script loads the notes code on a course's home only.
  for (const [pathname, want] of [['/courses/7', true], ['/courses/7/', true], ['/courses/7/modules', false], ['/', false]]) {
    const asked = [];
    const ctx = vm.createContext({ window: {}, location: { pathname }, GZ_CTX: { need: (f) => { asked.push(f); return Promise.resolve(); } }, GZ_NOTES_UI: { home() {} } });
    ctx.window.top = ctx.window;
    vm.runInContext(read('features/notes-home.js'), ctx);
    assert.deepEqual(asked, want ? ['features/notes.js'] : [], pathname);
  }
  assert.ok(!read('content.js').includes('notes.js'), 'content.js has no notes hook');
});

test('Course notes appears even when the hook runs before Glaze has finished starting on the page', async () => {
  const P = page({ on: false, stored: true, live: false });
  P.run(read('features/notes-home.js'));
  await settle();
  assert.ok(P.doc.getElementById('gz-nt-course'), 'there before the page is live');
  // Opening still waits for Glaze to be running on the page.
  P.fire(P.doc.getElementById('gz-nt-course'), 'click');
  await settle();
  assert.equal(P.box(), null);
  P.live = true;
  P.fire(P.doc.getElementById('gz-nt-course'), 'click');
  await settle();
  assert.equal(P.box(), null, "and for the page's own copy of the switch");
});

test('an older read of the switch, answered after Notes was turned off, does not bring the button back', async () => {
  const P = page();
  await P.ui.home();
  assert.ok(P.doc.getElementById('gz-nt-course'));
  const late = later();
  P.syncHold = late;
  const asked = P.ui.home(); // reads Notes on, held
  P.changeSync({ enhance: { notes: false } }); // turned off meanwhile
  late.resolve();
  await asked;
  await settle();
  assert.equal(P.doc.getElementById('gz-nt-course'), null, 'the older answer is dropped');
  P.syncHold = null;
  await P.ui.home();
  assert.equal(P.doc.getElementById('gz-nt-course'), null);
  P.changeSync({ enhance: { notes: true } });
  await settle();
  assert.ok(P.doc.getElementById('gz-nt-course'), 'and back when it is turned on');
});

test("Glaze turned off and then another setting change: the button follows both stored switches, not the page's stale copy", async () => {
  const P = page();
  await P.ui.home();
  assert.ok(P.doc.getElementById('gz-nt-course'));
  P.changeSync({ enabled: false });
  await settle();
  assert.equal(P.doc.getElementById('gz-nt-course'), null, 'Glaze off');
  P.changeSync({ enhance: { notes: true, todo: true } });
  await settle();
  assert.equal(P.doc.getElementById('gz-nt-course'), null, 'still off after another setting changed');
});

test("Glaze turned on and then another setting change, while the page's copy still says off: the button stays", async () => {
  const Q = page({ enabled: false });
  Q.sync.enabled = false;
  await Q.ui.home();
  assert.equal(Q.doc.getElementById('gz-nt-course'), null);
  Q.changeSync({ enabled: true });
  await settle();
  assert.ok(Q.doc.getElementById('gz-nt-course'), 'Glaze on');
  Q.changeSync({ enhance: { notes: true, todo: true } });
  await settle();
  assert.ok(Q.doc.getElementById('gz-nt-course'), 'still there after another setting changed');
});

test("restoring a deleted note whose deletion's clean-up failed keeps the file staged for it", async () => {
  const store = {}, db = { bodies: new Map(), files: new Map(), blobs: new Map() };
  const local = { get: async (k) => (k in store ? { [k]: structuredClone(store[k]) } : {}), set: async (o) => { Object.assign(store, structuredClone(o)); return true; } };
  const idb = { get: async (s, k) => db[s].get(k), put: async (s, k, v) => { db[s].set(k, v); }, del: async (s, ks) => { for (const k of ks) db[s].delete(k); },
    scan: async (s, p) => [...db[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...db[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => null };
  const run = (m, at, d = idb) => N.run({ key: 'notesIdx:https://school.instructure.com/5', ...m }, { local }, d, at);
  const png = N.b64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  const t = Date.UTC(2026, 9, 1), A = id(1), F = id(20);
  await run({ op: 'file', id: F, kind: 'image', name: 'a.png', data: png, note: A }, t);
  await run({ op: 'save', id: A, base: 0, sid: 'a', html: `<p><img data-gz-file="${F}"></p>`, title: 'A', copy: id(90) }, t + 1);
  await run({ op: 'trash', ids: [A] }, t + 2);
  assert.equal((await run({ op: 'purge', ids: [A] }, t + 3, { ...idb, del: async () => { throw new Error('io'); } })).ok, true, "committed; its clean-up didn't finish");
  assert.equal((await run({ op: 'file', id: F, kind: 'image', name: 'a.png', data: png, note: A }, t + 10)).ok, true, 'the backup stages it again');
  await run({ op: 'tidy' }, t + 11);
  assert.deepEqual(await run({ op: 'import', notes: [{ id: A, title: 'A', created: t, at: t + 1, html: `<p><img data-gz-file="${F}"></p>` }] }, t + 12), { ok: true, done: 1, skipped: 0 });
  assert.equal((await run({ op: 'getFile', id: F }, t + 13)).ok, true);
  assert.equal(db.files.size, 1, 'one file, the same id');
});

test("a switch change whose read fails takes the button away and closes the view: Notes fails closed", async () => {
  const P = page();
  await P.seed([{ id: id(1), title: 'Biology notes', course: '7', html: '<p>bio</p>' }]);
  await P.openView();
  assert.ok(P.box(), 'open');
  P.syncFail = true;
  P.changeSync({ enabled: false });
  await settle();
  assert.equal(P.doc.getElementById('gz-nt-course'), null, 'no button');
  assert.equal(P.box(), null, 'the view is closed');
});
