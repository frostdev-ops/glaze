// Synthetic Ultra outline: real B9 module, inert DOM and extension storage, no network surface.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const F = require(process.env.GZ_B9_LIB || '../lib/folders.js');
const ROW = '.content-list-item[data-content-id]';
class E {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.textContent = ''; }
  append(...xs) { for (const x of xs) { x.remove(); this.children.push(x); x.parentElement = this; } }
  remove() { if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
  before(x) { x.remove(); const p = this.parentElement; p.children.splice(p.children.indexOf(this), 0, x); x.parentElement = p; }
  after(x) { x.remove(); const p = this.parentElement; p.children.splice(p.children.indexOf(this) + 1, 0, x); x.parentElement = p; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; } removeAttribute(k) { delete this.attrs[k]; }
  get isConnected() { return !!this.parentElement; }
  get nextElementSibling() { const a = this.parentElement?.children || []; return a[a.indexOf(this) + 1] || null; }
  matches(s) { return s === ROW ? !!this.dataset.contentId : s === '[data-gz-folder-hidden]' ? this.getAttribute('data-gz-folder-hidden') !== null : s[0] === '#' ? this.id === s.slice(1) : s[0] === '.' ? this.className === s.slice(1) : this.tagName === s; }
  querySelectorAll(sel) { const all = this.children.flatMap((c) => [c, ...c.querySelectorAll('*')]); if (sel === '*') return all; return all.filter((c) => sel.split(', ').some((s) => c.matches(s))); }
  querySelector(sel) { return sel.startsWith(':scope > ') ? this.children.find((c) => c.matches(sel.slice(9))) || null : this.querySelectorAll(sel)[0] || null; }
  closest(sel) { return this.matches(sel) ? this : this.parentElement?.closest(sel) || null; }
  addEventListener(ev, f) { this.listeners[ev] = f; }
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const fixture = () => {
  const html = new E('html'), head = new E('head'), body = new E('body'), outline = new E(); html.append(head, body); body.append(outline);
  const row = (id, title, module = false) => {
    const r = new E(); r.className = 'content-list-item'; r.dataset.contentId = id;
    const h = new E('h3'), toggle = new E('button'); toggle.textContent = title; toggle.id = `${module ? 'learning-module' : 'folder'}-title-${id}`; h.append(toggle); const content = new E(); content.append(h); r.append(content); return r;
  };
  const parent = row('_101_1', 'Parent'), child = row('_102_1', 'Nested'), module = row('_104_1', 'Module', true), plain = new E(); plain.dataset.contentId = '_103_1'; plain.className = 'content-list-item';
  parent.append(child, plain); outline.append(parent, module);
  let on = true, enabled = true, cid = '_800_1', mutations, failed = false, held = null;
  const location = { origin: 'https://bb.example.edu', pathname: '/ultra/courses/_800_1/outline' };
  const store = {}, sent = [], changed = [], frames = [], watched = { on: false };
  const local = { get: async (keys) => { if (failed) throw Error('storage'); if (held) return held; return structuredClone(keys === null ? store : typeof keys === 'string' ? { [keys]: store[keys] } : Object.fromEntries(keys.map((k) => [k, store[k]]))); }, set: async (p) => { if (failed) return false; Object.assign(store, structuredClone(p)); return true; } };
  const chrome = { storage: { local, onChanged: { addListener: (f) => changed.push(f) } }, runtime: { sendMessage: async (m) => { sent.push(m); return F.change(m, { local }); } } };
  const document = { head, body, createElement: (t) => new E(t), querySelectorAll: (s) => html.querySelectorAll(s), getElementById: (id) => html.querySelector(`#${id}`) };
  const ctx = { on: () => on, settings: () => ({ enhance: { hideFolders: enabled } }), courseId: () => cid,
    toggleOf: (r) => r.querySelector(`#folder-title-${r.dataset.contentId}`) || r.querySelector(`#learning-module-title-${r.dataset.contentId}`), t: (k, args) => k.replace(/\{(\w+)\}/g, (_, p) => args[p]) };
  const c = vm.createContext({ document, location, chrome, GZ_CTX: ctx, GZ_FOLDERS: F, MutationObserver: class { constructor(f) { mutations = f; } observe() { watched.on = true; } disconnect() { watched.on = false; } }, requestAnimationFrame: (f) => frames.push(f) });
  vm.runInContext(fs.readFileSync(process.env.GZ_B9_FEATURE || require.resolve('../features/folders.js'), 'utf8'), c);
  const ui = c.GZ_FOLDER_UI;
  const click = async (el, type = 'click', isTrusted = true) => { const e = { isTrusted, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; el.listeners[type](e); await settle(); return e; };
  return { ui, parent, child, module, plain, outline, document, store, sent, click, redraw: () => { mutations(); while (frames.length) frames.shift()(); }, mutate: () => mutations(), watched, frames,
    identity: Promise.resolve('_900_1'), setOn: (v) => { on = v; }, setEnabled: (v) => { enabled = v; }, fail: (v) => { failed = v; }, hold: (v) => { held = v; }, change: (v) => { cid = v; location.pathname = `/ultra/courses/${v}/outline`; }, path: (v) => { location.pathname = v; }, changed: () => changed.forEach((f) => f({ [F.key(location.origin, '_900_1', cid)]: {} }, 'local')) };
};
const eye = (row) => row.querySelector(`#gz-folder-eye-${row.dataset.contentId}`);
test('nested folder and learning module controls hide, show, unhide and reapply after redraw', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  assert.ok(eye(e.parent)); assert.ok(eye(e.child)); assert.ok(eye(e.module)); assert.equal(eye(e.plain), null);
  e.redraw(); e.redraw(); assert.equal(e.document.querySelectorAll('.gz-folder-eye').length, 3, 'wrapped Ultra headings do not accumulate duplicate buttons');
  assert.equal(eye(e.parent).getAttribute('aria-label'), 'Hide folder: Parent');
  assert.equal((await e.click(eye(e.child), 'keydown')).stopped, true);
  assert.equal((await e.click(eye(e.child))).stopped, true);
  await e.click(eye(e.parent));
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'hide');
  assert.equal(e.child.getAttribute('data-gz-folder-hidden'), 'hide');
  await e.click(e.document.getElementById('gz-folders-toggle'));
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'show');
  assert.equal(e.child.getAttribute('data-gz-folder-hidden'), 'show');
  await e.click(eye(e.parent));
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.child.getAttribute('data-gz-folder-hidden'), 'show');
  eye(e.child).remove(); e.child.removeAttribute('data-gz-folder-hidden'); e.redraw();
  assert.ok(eye(e.child)); assert.equal(e.child.getAttribute('data-gz-folder-hidden'), 'show');
  assert.equal(e.document.getElementById('gz-folders-toggle').textContent, 'Show hidden folders (1)');
  await e.click(eye(e.child)); assert.equal(e.document.getElementById('gz-folders-toggle'), null);
});
test('setting, master/site stop and navigation restore native nodes; stale buttons cannot write', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  const old = eye(e.parent); await e.click(old);
  e.setEnabled(false); e.ui.sync(false, e.identity);
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null); assert.equal(eye(e.parent), null);
  await e.click(old); assert.equal(e.sent.length, 1);
  e.setEnabled(true); e.ui.sync(true, e.identity); await settle(); assert.ok(eye(e.parent));
  e.setOn(false); e.ui.sync(false); assert.equal(eye(e.parent), null);
  e.setOn(true); e.ui.sync(true, e.identity); await settle();
  e.path('/ultra/stream'); e.redraw(); assert.equal(eye(e.parent), null);
  assert.ok(e.parent.isConnected && e.child.isConnected, 'native nodes are preserved');
});
test('unknown identity, course/account changes, profile handoff and failed storage stay isolated', async () => {
  const e = fixture(); e.ui.sync(true, null); await settle(); assert.equal(eye(e.parent), null); assert.deepEqual(e.store, {});
  e.ui.sync(true, e.identity); await settle(); await e.click(eye(e.parent));
  e.change('_801_1'); e.ui.sync(true, e.identity); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  const other = Promise.resolve('_901_1'); e.ui.sync(true, other); await settle(); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  e.path('/ultra/profile'); e.ui.sync(false, other); e.change('_800_1'); e.ui.sync(true, other); await settle(); assert.equal(eye(e.parent), null);
  e.ui.sync(true, Promise.resolve('_900_1')); await settle(); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'hide');
  e.fail(true); e.changed(); await settle(); assert.equal(eye(e.parent), null); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.sent.length, 1);
});
test('a storage result arriving after course navigation cannot hide the new outline', async () => {
  const e = fixture(); let release; e.hold(new Promise((r) => { release = r; }));
  e.ui.sync(true, e.identity); await settle();
  e.change('_801_1'); e.hold(null); e.ui.sync(true, e.identity); await settle();
  release({ [F.key('https://bb.example.edu', '_900_1', '_800_1')]: { ids: ['_101_1'], show: false } }); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.ok(eye(e.parent)); assert.equal(e.sent.length, 0);
});
test('a cross-tab storage change invalidates an older in-flight read', async () => {
  const e = fixture(); let release; e.hold(new Promise((r) => { release = r; }));
  e.ui.sync(true, e.identity); await settle();
  const key = F.key('https://bb.example.edu', '_900_1', '_800_1');
  e.store[key] = { ids: ['_102_1'], show: true };
  e.hold(null); e.changed(); await settle();
  release({ [key]: { ids: ['_101_1'], show: false } }); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.child.getAttribute('data-gz-folder-hidden'), 'show');
});
test('page-generated eye and show-toggle clicks cannot save folder choices', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  await e.click(eye(e.parent), 'click', false);
  assert.equal(e.sent.length, 0);
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  await e.click(eye(e.parent));
  await e.click(e.document.getElementById('gz-folders-toggle'), 'click', false);
  assert.equal(e.sent.length, 1);
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'hide');
});
test('reused native rows discard old controls and hidden attributes when their identity or type changes', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  await e.click(eye(e.parent));
  const toggle = e.parent.querySelector('#folder-title-_101_1');
  e.parent.dataset.contentId = '_201_1'; toggle.id = 'folder-title-_201_1'; toggle.textContent = 'Replacement';
  e.redraw(); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.document.getElementById('gz-folder-eye-_101_1'), null);
  assert.ok(eye(e.parent)); assert.ok(eye(e.child));
  await e.click(eye(e.parent));
  assert.deepEqual(e.store[F.key('https://bb.example.edu', '_900_1', '_800_1')].ids, ['_101_1', '_201_1']);
  toggle.id = 'document-title-_201_1'; e.redraw(); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(eye(e.parent), null); assert.ok(eye(e.child));
});
test('malformed cached identities cannot bind another account through string coercion', async () => {
  const e = fixture();
  e.ui.sync(true, Promise.resolve(['_900_1'])); await settle();
  assert.equal(eye(e.parent), null); assert.deepEqual(e.sent, []);
});

test('the page is watched only on a course outline, and a burst of changes costs one pass', async () => {
  const p = fixture();
  p.ui.sync(true, p.identity);
  await settle();
  assert.equal(p.watched.on, true, 'on the outline');
  for (let i = 0; i < 100; i++) p.mutate();
  assert.equal(p.frames.length, 1, 'a mutation burst schedules one frame');
  p.redraw(); assert.equal(p.frames.length, 0);
  p.path('/ultra/course');
  p.ui.sync(true, p.identity);
  assert.equal(p.watched.on, false, 'off the outline, nothing watches the page');
});
