// Hidden modules on Canvas: the folders feature on a synthetic Modules page, its keys and its hook. Inert DOM, no network.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const F = require('../lib/folders.js');
const ROW = '.context_module[data-module-id]';
class E {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this._text = ''; this.className = ''; }
  get nodeType() { return 1; }
  setOwner(doc) { this.ownerDocument = doc; for (const c of this.children) c.setOwner(doc); }
  append(...xs) { for (const x of xs) { x.remove(); this.children.push(x); x.parentElement = this; if (this.ownerDocument) x.setOwner(this.ownerDocument); } }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); this._text = String(v); }
  get childNodes() { return this._text ? [{ textContent: this._text }, ...this.children] : this.children; }
  replaceChildren(...xs) { for (const c of [...this.children]) c.remove(); this._text = ''; this.append(...xs); }
  contains(x) { return this === x || this.children.some((c) => c.contains(x)); }
  focus() { this.ownerDocument.activeElement = this; }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  before(x) { x.remove(); const p = this.parentElement; p.children.splice(p.children.indexOf(this), 0, x); x.parentElement = p; if (p.ownerDocument) x.setOwner(p.ownerDocument); }
  after(x) { x.remove(); const p = this.parentElement; p.children.splice(p.children.indexOf(this) + 1, 0, x); x.parentElement = p; if (p.ownerDocument) x.setOwner(p.ownerDocument); }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  get isConnected() { return this.tagName === 'html' || !!this.parentElement?.isConnected; }
  get previousElementSibling() { const a = this.parentElement?.children || []; return a[a.indexOf(this) - 1] || null; }
  get nextElementSibling() { const a = this.parentElement?.children || []; return a[a.indexOf(this) + 1] || null; }
  matches(s) {
    if (s.includes(', ')) return s.split(', ').some((x) => this.matches(x));
    return s === ROW ? !!this.dataset.moduleId : s === '[data-gz-folder-hidden]' ? this.getAttribute('data-gz-folder-hidden') !== null
      : s[0] === '#' ? this.id === s.slice(1) : s[0] === '.' ? this.className.split(' ').includes(s.slice(1)) : this.tagName === s;
  }
  querySelectorAll(sel) {
    if (sel === ':scope > .ig-header > .ig-header-title') return this.children.filter((c) => c.matches('.ig-header')).flatMap((h) => h.children.filter((c) => c.matches('.ig-header-title')));
    const all = this.children.flatMap((c) => [c, ...c.querySelectorAll('*')]);
    return sel === '*' ? all : all.filter((c) => c.matches(sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  closest(sel) { return this.matches(sel) ? this : this.parentElement?.closest(sel) || null; }
  addEventListener(ev, f) { this.listeners[ev] = f; }
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const fixture = () => {
  const html = new E('html'), head = new E('head'), body = new E('body'), list = new E(); list.id = 'context_modules';
  html.append(head, body); body.append(list);
  // A Canvas module: its header holds two titles (expanded and folded; one shows), then the module's items.
  const mod = (id, title) => {
    const m = new E(); m.className = 'item-group-condensed context_module'; m.dataset.moduleId = id; m.id = `context_module_${id}`;
    const header = new E(); header.className = 'ig-header header';
    for (const k of ['collapse_module_link', 'expand_module_link']) {
      const t = new E('span'); t.className = `ig-header-title ${k}`; t.setAttribute('aria-label', `${title} toggle module visibility`);
      const name = new E('span'); name.className = 'name'; name.textContent = title; t.append(name); header.append(t);
    }
    const admin = new E(); admin.className = 'module_header_items'; header.append(admin);
    m.append(header); return m;
  };
  const a = mod('96', 'Unit 1'), b = mod('97', 'Unit 2'), blank = new E(); blank.className = 'context_module'; blank.id = 'context_module_blank';
  list.append(a, b, blank);
  const location = { origin: 'https://school.instructure.com', pathname: '/courses/31/modules' };
  const store = {}, sent = [];
  const local = { get: async (keys) => structuredClone(keys === null ? store : typeof keys === 'string' ? { [keys]: store[keys] } : Object.fromEntries(keys.map((k) => [k, store[k]]))), set: async (p) => { Object.assign(store, structuredClone(p)); return true; } };
  const chrome = { storage: { local, onChanged: { addListener() {} } }, runtime: { sendMessage: async (m) => { sent.push(m); return F.change(m, { local }); } } };
  const document = { head, body, querySelectorAll: (s) => html.querySelectorAll(s), getElementById: (id) => html.querySelector(`#${id}`) };
  html.setOwner(document); document.createElement = (t) => { const e = new E(t); e.setOwner(document); return e; }; document.activeElement = body;
  let on = true;
  const ctx = { site: 'canvas', on: () => on, settings: () => ({ enhance: { hideFolders: true } }), courseId: () => undefined, toggleOf: () => null,
    canvasCourseId: () => location.pathname.match(/^\/courses\/(\d+)/)?.[1], t: (k, args) => k.replace(/\{(\w+)\}/g, (_, p) => args[p]) };
  const c = vm.createContext({ document, location, chrome, GZ_CTX: ctx, GZ_FOLDERS: F, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame() {}, setTimeout: () => 0, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(require.resolve('../features/folders.js'), 'utf8'), c);
  const click = async (el) => { el.listeners.click({ isTrusted: true, detail: 1, preventDefault() {}, stopPropagation() {} }); await settle(); };
  return { ui: c.GZ_FOLDER_UI, a, b, blank, list, document, store, sent, click, location, setOn: (v) => { on = v; } };
};
const eye = (m) => m.querySelector(`#gz-folder-eye-${m.dataset.moduleId}`);

test('Canvas modules get an eye after their titles, hide and show under their own words, keyed per account and course', async () => {
  const e = fixture(); e.ui.sync(true, Promise.resolve('42')); await settle();
  assert.ok(eye(e.a) && eye(e.b)); assert.equal(e.document.querySelectorAll('.gz-folder-eye').length, 2, "Canvas's blank template module gets none");
  const titles = e.a.querySelectorAll(':scope > .ig-header > .ig-header-title');
  assert.equal(eye(e.a).previousElementSibling, titles[1], 'after both titles, before the module\'s own icons');
  assert.equal(eye(e.a).getAttribute('aria-label'), 'Hide module: Unit 1');
  await e.click(eye(e.a));
  assert.equal(e.sent[0].key, 'hiddenFolders:https://school.instructure.com/42/31');
  assert.deepEqual(e.store[e.sent[0].key], { ids: ['96'], show: false });
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), 'hide'); assert.equal(e.b.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.document.getElementById('gz-folder-status').textContent, 'Module hidden.Undo');
  assert.equal(e.document.getElementById('gz-folder-status').nextElementSibling, e.list, 'feedback sits above the modules, not inside Canvas\'s list');
  const toggle = e.document.getElementById('gz-folders-toggle');
  assert.equal(toggle.textContent, 'Show hidden modules (1)');
  await e.click(toggle);
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), 'show');
  for (const t of titles) assert.equal(t.getAttribute('aria-label'), 'Unit 1 toggle module visibility · Hidden', 'both titles say Hidden');
  assert.equal(new Set(e.a.querySelectorAll('.gz-folder-badge').map((b) => b.id)).size, 2, 'each title its own badge id');
  assert.equal(e.document.getElementById('gz-folder-status').textContent, 'Showing 1 hidden module.');
  await e.click(eye(e.a));
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), null);
  for (const t of titles) assert.equal(t.getAttribute('aria-label'), 'Unit 1 toggle module visibility', 'native names come back');
  assert.equal(e.document.getElementById('gz-folders-toggle'), null);
});

test('Canvas: another course\'s page, a non-module page and signing out leave modules untouched', async () => {
  const e = fixture(); e.ui.sync(true, Promise.resolve('42')); await settle();
  await e.click(eye(e.a));
  e.location.pathname = '/courses/31/assignments'; e.ui.sync(true, Promise.resolve('42')); await settle();
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), null); assert.equal(eye(e.a), null);
  e.location.pathname = '/courses/31'; const me = Promise.resolve('42'); e.ui.sync(true, me); await settle();
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), 'hide', 'a course home that lists its modules');
  e.location.pathname = '/logout'; e.ui.sync(true, me); await settle();
  e.location.pathname = '/courses/31/modules'; e.ui.sync(true, me); await settle();
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), null, 'the signed-out identity is not reused');
});

test('Canvas module keys: plain ids, any Canvas origin including a local http one, never mixed with Ultra\'s', async () => {
  assert.equal(F.key('https://school.instructure.com', '42', '31'), 'hiddenFolders:https://school.instructure.com/42/31');
  assert.ok(F.KEY.test(F.key('http://localhost:3000', '1', '2')));
  for (const [o, u, c] of [['https://x.edu', '_7_1', '31'], ['https://x.edu', '42', '_8_1'], ['https://x.edu', '4/2', '31'], ['https://x.edu/a', '42', '31'], ['ftp://x.edu', '42', '31']]) assert.equal(F.key(o, u, c), '', `${o} ${u} ${c}`);
  assert.equal(F.key('http://bb.example.edu', '_7_1', '_8_1'), '', 'Ultra keys stay https');
  const store = {}, local = { get: async () => structuredClone(store), set: async (p) => { Object.assign(store, p); return true; } };
  const k = F.key('https://school.instructure.com', '42', '31');
  assert.deepEqual(await F.change({ key: k, id: '96', hidden: true }, { local }), { ok: true, data: { ids: ['96'], show: false } });
  assert.equal((await F.change({ key: k, id: '9 6', hidden: true }, { local })).ok, false);
  assert.deepEqual(F.backup({ [k]: { ids: ['96'], show: true } }), { [k]: { ids: ['96'], show: true } });
});

test('Canvas loads hidden modules on demand where a course lists its modules, as who is signed in', () => {
  const part = fs.readFileSync(require.resolve('../content-canvas.js'), 'utf8');
  assert.match(part, /I\.settings\.enhance\.hideFolders && document\.getElementById\('context_modules'\)/);
  assert.match(part, /need\('lib\/folders\.js'[^\n]*need\('features\/folders\.js'[^\n]*GZ_FOLDER_UI\.sync\(true, me\(\)\)/);
  const worker = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  assert.match(worker, /m\.key\.startsWith\(`hiddenFolders:\$\{await fromUltra\(s\)\}\/_`\)/, 'an Ultra page writes only Ultra keys');
  assert.match(worker, /m\.key\.startsWith\(`hiddenFolders:\$\{await fromCanvas\(s\)\}\/`\) && \/\\\/\\d\+\\\/\\d\+\$\/\.test\(m\.key\)/, 'a Canvas page only its own site\'s module keys');
});

test('the Canvas stop hook restores hidden modules even when the native page makes no further mutations', async () => {
  const e = fixture(); e.ui.sync(true, Promise.resolve('42')); await settle();
  await e.click(eye(e.a));
  const part = fs.readFileSync(require.resolve('../content-canvas.js'), 'utf8');
  const start = part.indexOf('stop: () => '), end = part.indexOf(', planner:', start);
  const stop = vm.runInNewContext(`(${part.slice(start + 6, end)})`, { GZ_FOLDER_UI: e.ui });
  e.setOn(false); stop();
  assert.equal(e.a.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.document.getElementById('gz-folder-style'), null);
  assert.equal(e.document.querySelectorAll('.gz-folder-eye, #gz-folders-toggle').length, 0);
});

test('the folders worker isolates Canvas and Ultra origins, including same-origin course-tab frames and switch revocation', async () => {
  const listeners = [], store = { local: { ultra: ['https://bb.example.edu'], canvas: ['https://campus.test/*'] }, sync: {} };
  const area = (s) => ({
    get: async (k) => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter(x => x in s).map(x => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async () => {},
  });
  const c = vm.createContext({ URL, TextEncoder, structuredClone, console, setTimeout, clearTimeout, crypto,
    importScripts: (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(require.resolve(`../lib/${f}`), 'utf8'), c)),
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: { addListener: (f) => listeners.push(f) }, onConnect: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      tabs: { onRemoved: { addListener() {} } }, storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/background.js'), 'utf8'), c);
  const send = (m, s) => new Promise(resolve => { for (const f of listeners) if (f(m, s, r => resolve(structuredClone(r))) === true) return; resolve(null); });
  const canvas = { id: 'glaze', tab: { id: 9, url: 'https://school.instructure.com/courses/31/modules' }, frameId: 0, url: 'https://school.instructure.com/courses/31/modules' };
  const ultra = { ...canvas, url: 'https://bb.example.edu/ultra/courses/_8_1/outline', tab: { id: 10, url: 'https://bb.example.edu/ultra/courses/_8_1/outline' } };
  const msg = (origin, user = '42', course = '31', id = '96') => ({ type: 'glaze:folders', key: F.key(origin, user, course), id, hidden: true });
  for (const [sender, m] of [[canvas, msg('https://school.instructure.com')], [ultra, msg('https://bb.example.edu', '_7_1', '_8_1', '_9_1')],
    [{ ...canvas, frameId: 7, url: 'about:blank', origin: 'https://school.instructure.com' }, msg('https://school.instructure.com')],
    [{ ...ultra, frameId: 7, url: 'about:blank', origin: 'https://bb.example.edu' }, msg('https://bb.example.edu', '_7_1', '_8_1', '_9_1')],
    [{ ...canvas, url: 'https://campus.test/courses/31/modules' }, msg('https://campus.test')]]) assert.equal((await send(m, sender)).ok, true);
  const before = structuredClone(store.local), m = msg('https://school.instructure.com');
  for (const [sender, request] of [[canvas, msg('https://other.instructure.com')], [canvas, msg('https://school.instructure.com', '_7_1', '_8_1', '_9_1')],
    [ultra, msg('https://bb.example.edu')], [{ ...canvas, id: 'other' }, m], [{ ...canvas, tab: undefined }, m],
    [{ ...canvas, url: 'https://unknown.test/courses/31/modules' }, msg('https://unknown.test')],
    [{ ...canvas, frameId: 7, url: 'about:blank', origin: 'https://other.instructure.com' }, m]]) assert.equal((await send(request, sender)).ok, false);
  store.sync.enabled = false; assert.equal((await send(m, canvas)).ok, false);
  store.sync.enabled = true; store.sync.enhance = { hideFolders: false }; assert.equal((await send(m, canvas)).ok, false);
  assert.deepEqual(store.local, before, 'refused writes preserve both sites\' records');
});
