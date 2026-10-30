// Synthetic Ultra outline: real B9 module, inert DOM and extension storage, no network surface.
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs');
const F = require(process.env.GZ_B9_LIB || '../lib/folders.js');
const ROW = '.content-list-item[data-content-id]';
class E {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this._text = ''; }
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
  matches(s) { if (s.includes(', ')) return s.split(', ').some((x) => this.matches(x)); return s === ROW ? !!this.dataset.contentId : s === '[data-gz-folder-hidden]' ? this.getAttribute('data-gz-folder-hidden') !== null : s[0] === '#' ? this.id === s.slice(1) : s[0] === '.' ? this.className === s.slice(1) : this.tagName === s; }
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
  let on = true, enabled = true, cid = '_800_1', mutations, failed = false, held = null, reply = null, emit = false, timerId = 0;
  const location = { origin: 'https://bb.example.edu', pathname: '/ultra/courses/_800_1/outline' };
  const store = {}, sent = [], changed = [], frames = [], timers = new Map(), watched = { on: false };
  const local = { get: async (keys) => { if (failed) throw Error('storage'); if (held) return held; return structuredClone(keys === null ? store : typeof keys === 'string' ? { [keys]: store[keys] } : Object.fromEntries(keys.map((k) => [k, store[k]]))); }, set: async (p) => { if (failed) return false; Object.assign(store, structuredClone(p)); if (emit) changed.forEach((f) => f(Object.fromEntries(Object.keys(p).map((k) => [k, {}])), 'local')); return true; } };
  const chrome = { storage: { local, onChanged: { addListener: (f) => changed.push(f) } }, runtime: { sendMessage: async (m) => { sent.push(m); const r = await F.change(m, { local }); if (reply) await reply; return r; } } };
  const document = { head, body, createElement: (t) => new E(t), querySelectorAll: (s) => html.querySelectorAll(s), getElementById: (id) => html.querySelector(`#${id}`) };
  html.setOwner(document); document.createElement = (t) => { const e = new E(t); e.setOwner(document); return e; }; document.activeElement = body;
  const ctx = { on: () => on, settings: () => ({ enhance: { hideFolders: enabled } }), courseId: () => cid,
    toggleOf: (r) => r.querySelector(`#folder-title-${r.dataset.contentId}`) || r.querySelector(`#learning-module-title-${r.dataset.contentId}`), t: (k, args) => k.replace(/\{(\w+)\}/g, (_, p) => args[p]) };
  const c = vm.createContext({ document, location, chrome, GZ_CTX: ctx, GZ_FOLDERS: F, MutationObserver: class { constructor(f) { mutations = f; } observe() { watched.on = true; } disconnect() { watched.on = false; } }, requestAnimationFrame: (f) => frames.push(f), setTimeout: (f) => { timers.set(++timerId, f); return timerId; }, clearTimeout: (id) => timers.delete(id) });
  vm.runInContext(fs.readFileSync(process.env.GZ_B9_FEATURE || require.resolve('../features/folders.js'), 'utf8'), c);
  const ui = c.GZ_FOLDER_UI;
  const click = async (el, type = 'click', isTrusted = true, detail = 0) => { const e = { isTrusted, detail, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; el.listeners[type](e); await settle(); return e; };
  return { ui, parent, child, module, plain, outline, document, store, sent, click, redraw: () => { mutations([{ type: 'attributes', target: outline }]); while (frames.length) frames.shift()(); }, mutate: (records = [{ type: 'attributes', target: outline }]) => mutations(records), watched, frames,
    timers, expire: () => { const [id, f] = timers.entries().next().value; timers.delete(id); f(); }, emitWrites: () => { emit = true; }, holdReply: (v) => { reply = v; }, identity: Promise.resolve('_900_1'), setOn: (v) => { on = v; }, setEnabled: (v) => { enabled = v; }, fail: (v) => { failed = v; }, hold: (v) => { held = v; }, change: (v) => { cid = v; location.pathname = `/ultra/courses/${v}/outline`; }, path: (v) => { location.pathname = v; }, changed: () => changed.forEach((f) => f({ [F.key(location.origin, '_900_1', cid)]: {} }, 'local')) };
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
  assert.equal(e.document.getElementById('gz-folders-toggle').textContent, 'Hide them again (1)');
  await e.click(eye(e.child)); assert.equal(e.document.getElementById('gz-folders-toggle'), null);
});
test('the eye sits beside its folder\'s title: after a heading, or after a nested folder\'s title, never at the row\'s end', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  const h = e.parent.querySelector('h3');
  assert.equal(eye(e.parent).previousElementSibling, h, 'after the heading');
  // Ultra's nested folders have no heading: the title button sits in the row's title line.
  const toggle = e.child.querySelector('#folder-title-_102_1'), line = e.child.children[0], ch = e.child.querySelector('h3');
  const placed = eye(e.child);
  line.append(toggle); ch.remove(); e.child.append(placed); // where it used to land: the row's end, below the folder
  e.redraw();
  assert.equal(eye(e.child).previousElementSibling, toggle, 'right after the title');
  assert.equal(eye(e.child).parentElement, line);
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
test('unknown identity, course/account changes, sign-out handoff and failed storage stay isolated', async () => {
  const e = fixture(); e.ui.sync(true, null); await settle(); assert.equal(eye(e.parent), null); assert.deepEqual(e.store, {});
  e.ui.sync(true, e.identity); await settle(); await e.click(eye(e.parent));
  e.change('_801_1'); e.ui.sync(true, e.identity); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  const other = Promise.resolve('_901_1'); e.ui.sync(true, other); await settle(); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  e.path('/ultra/logout'); e.ui.sync(false, other); e.change('_800_1'); e.ui.sync(true, other); await settle(); assert.equal(eye(e.parent), null);
  e.ui.sync(true, Promise.resolve('_900_1')); await settle(); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'hide');
  e.fail(true); e.changed(); await settle(); assert.equal(eye(e.parent), null); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.sent.length, 1);
});
test('visiting the profile page keeps hidden folders hidden: content-ultra.js passes one identity promise for the page\'s life', async () => {
  const e = fixture(); const meId = e.identity;
  e.ui.sync(true, meId); await settle(); await e.click(eye(e.parent));
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'hide');
  e.path('/ultra/profile'); e.ui.sync(true, meId); await settle();
  e.path('/ultra/courses/_800_1/outline'); e.ui.sync(true, meId); await settle();
  assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), 'hide');
  assert.ok(eye(e.parent), 'the eye buttons are back');
  assert.ok(e.document.getElementById('gz-folders-toggle'), 'and the show toggle');
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
  // A button's ripple: nothing paint reads. No frame, and the page's own passes leave the outline as it is.
  const ripple = new E('span'); ripple.className = 'MuiTouchRipple-root';
  p.mutate([{ type: 'childList', target: eye(p.parent), addedNodes: [ripple], removedNodes: [] }]);
  assert.equal(p.frames.length, 0, 'a ripple schedules no pass');
  const label = eye(p.parent).getAttribute('aria-label');
  eye(p.parent).setAttribute('aria-label', 'stale'); p.ui.sync(true, p.identity);
  assert.equal(eye(p.parent).getAttribute('aria-label'), 'stale', 'a pass with nothing new does not repaint');
  eye(p.parent).setAttribute('aria-label', label);
  const row = new E(); row.className = 'content-list-item'; row.dataset.contentId = '_105_1';
  p.mutate([{ type: 'childList', target: p.outline, addedNodes: [row], removedNodes: [] }]);
  assert.equal(p.frames.length, 1, 'an added row schedules one');
  p.path('/ultra/course');
  p.ui.sync(true, p.identity);
  assert.equal(p.watched.on, false, 'off the outline, nothing watches the page');
});
test('feedback toggles its action and restores live native accessible names without replacing title wrappers', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  const parent = e.parent.querySelector('#folder-title-_101_1'), child = e.child.querySelector('#folder-title-_102_1'), module = e.module.querySelector('#learning-module-title-_104_1');
  const wrapper = e.document.createElement('span'); wrapper.textContent = parent.textContent; parent.replaceChildren(wrapper);
  const heading = e.parent.querySelector('h3'); parent.setAttribute('aria-label', 'Native parent'); child.setAttribute('aria-labelledby', '  native-title native-detail  ');
  for (const row of [e.parent, e.child, e.module]) await e.click(eye(row));
  const toggle = e.document.getElementById('gz-folders-toggle');
  assert.equal(toggle.textContent, 'Show hidden folders (3)'); assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  await e.click(toggle);
  assert.equal(toggle.textContent, 'Hide them again (3)'); assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.match(toggle.querySelector('.gz-folders-toggle-icon').innerHTML, /m3 3 18 18/);
  assert.equal(parent.getAttribute('aria-label'), 'Native parent · Hidden');
  assert.equal(child.getAttribute('aria-labelledby'), '  native-title native-detail   gz-folder-badge-_102_1');
  assert.equal(module.textContent, 'Module Hidden'); assert.equal(e.parent.querySelector('h3'), heading);
  assert.equal(parent.children[0], wrapper, 'the native title wrapper is preserved');
  wrapper.append(parent.querySelector('.gz-folder-badge')); e.redraw();
  assert.equal(wrapper.textContent, 'Parent', 'a wrapped owned badge is moved back beside the title');
  for (let i = 0; i < 10; i++) e.redraw();
  assert.equal(e.document.querySelectorAll('.gz-folder-badge').length, 3);
  assert.equal(eye(e.parent).getAttribute('aria-label'), 'Unhide folder: Parent'); assert.equal(eye(e.parent).title, 'Unhide folder: Parent');
  parent.setAttribute('aria-label', 'React renamed parent'); child.setAttribute('aria-labelledby', 'new-title'); e.redraw();
  assert.equal(parent.getAttribute('aria-label'), 'React renamed parent · Hidden');
  await e.click(toggle);
  assert.equal(parent.getAttribute('aria-label'), 'React renamed parent'); assert.equal(child.getAttribute('aria-labelledby'), 'new-title');
  assert.equal(module.textContent, 'Module'); assert.equal(e.document.querySelectorAll('.gz-folder-badge').length, 0);
  assert.equal(e.document.getElementById('gz-folder-status').textContent, 'Hiding 3 folders.');
  await e.click(toggle); await e.click(eye(e.module));
  assert.equal(module.textContent, 'Module'); assert.equal(e.document.getElementById('gz-folder-status').textContent, 'Folder shown.');
  e.setEnabled(false); e.ui.sync(false, e.identity);
  assert.equal(parent.getAttribute('aria-label'), 'React renamed parent'); assert.equal(child.getAttribute('aria-labelledby'), 'new-title');
  assert.equal(e.document.querySelectorAll('.gz-folder-badge').length, 0);
});
test('feedback restores native names and badges on a recycled shown row', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  const native = e.parent.querySelector('#folder-title-_101_1'); native.setAttribute('aria-label', 'Original name');
  await e.click(eye(e.parent)); await e.click(e.document.getElementById('gz-folders-toggle'));
  assert.equal(native.getAttribute('aria-label'), 'Original name · Hidden');
  e.parent.dataset.contentId = '_201_1'; native.id = 'folder-title-_201_1'; e.redraw();
  assert.equal(native.getAttribute('aria-label'), 'Original name');
  assert.equal(native.querySelector('.gz-folder-badge'), null); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  await e.click(eye(e.parent));
  assert.ok(native.querySelector('.gz-folder-badge'));
  native.removeAttribute('aria-label'); e.redraw();
  assert.equal(native.getAttribute('aria-label'), null, 'React removing an explicit name is preserved');
  e.setEnabled(false); e.ui.sync(false, e.identity);
  assert.equal(native.textContent, 'Parent'); assert.equal(native.getAttribute('aria-label'), null);
});
test('feedback success and trusted Undo follow the save and share one cleared expiry timer', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  await e.click(eye(e.parent));
  const status = e.document.getElementById('gz-folder-status'), undo = e.document.getElementById('gz-folder-undo');
  assert.equal(status.getAttribute('aria-live'), 'polite'); assert.equal(status.textContent, 'Folder hidden.Undo'); assert.equal(e.timers.size, 1);
  await e.click(undo, 'click', false); assert.equal(e.sent.length, 1);
  await e.click(undo); assert.equal(status.textContent, 'Folder shown.'); assert.equal(e.parent.getAttribute('data-gz-folder-hidden'), null);
  assert.equal(e.timers.size, 1); assert.equal(e.document.getElementById('gz-folder-undo'), null);
  e.expire(); assert.equal(status.textContent, ''); assert.equal(e.timers.size, 0);
  e.fail(true); await e.click(eye(e.parent));
  assert.equal(e.document.getElementById('gz-folder-status'), null); assert.equal(e.timers.size, 0);
});
test('feedback keyboard hiding retains useful focus and Undo returns it only while still focused', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle();
  eye(e.parent).focus(); await e.click(eye(e.parent));
  assert.equal(e.document.activeElement, e.document.getElementById('gz-folders-toggle'));
  const undo = e.document.getElementById('gz-folder-undo'); undo.focus(); e.expire();
  assert.equal(e.timers.size, 1, 'a focused Undo is not removed by expiry');
  await e.click(undo); assert.equal(e.document.activeElement, eye(e.parent));
  const elsewhere = e.module.querySelector('#learning-module-title-_104_1'); elsewhere.focus();
  await e.click(eye(e.parent), 'click', true, 1); assert.equal(e.document.activeElement, elsewhere, 'mouse action does not steal focus');
});
test('feedback Undo cannot cross route, account, disable or re-enable generations', async () => {
  for (const boundary of ['route', 'outline-route', 'account', 'disable', 'master']) {
    const e = fixture(); e.ui.sync(true, e.identity); await settle(); await e.click(eye(e.parent));
    const undo = e.document.getElementById('gz-folder-undo');
    if (boundary === 'route') { e.change('_801_1'); e.ui.sync(true, e.identity); }
    if (boundary === 'outline-route') { e.path('/ultra/courses/_800_1/outline/item'); e.ui.sync(true, e.identity); }
    if (boundary === 'account') e.ui.sync(true, Promise.resolve('_901_1'));
    if (boundary === 'disable') { e.setEnabled(false); e.ui.sync(false, e.identity); e.setEnabled(true); e.ui.sync(true, e.identity); }
    if (boundary === 'master') { e.setOn(false); e.ui.sync(false); e.setOn(true); e.ui.sync(true, e.identity); }
    await settle(); await e.click(undo);
    assert.equal(e.sent.length, 1, boundary); assert.equal(e.document.getElementById('gz-folder-undo'), null);
    assert.equal(e.timers.size, 0);
  }
});
test('feedback survives its own storage event but drops late success after a lifecycle change', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle(); e.emitWrites();
  await e.click(eye(e.parent));
  assert.equal(e.document.getElementById('gz-folder-status').textContent, 'Folder hidden.Undo');
  await e.click(eye(e.module));
  await e.click(e.document.getElementById('gz-folder-undo'));
  assert.deepEqual(e.store[F.key('https://bb.example.edu', '_900_1', '_800_1')].ids, ['_101_1'], 'Undo changes one ID and preserves the other hidden folder');
  let release; e.holdReply(new Promise((r) => { release = r; }));
  await e.click(eye(e.module));
  e.path('/ultra/profile'); e.ui.sync(false, e.identity); release(); await settle();
  assert.equal(e.document.getElementById('gz-folder-status'), null); assert.equal(e.timers.size, 0);
});
test('feedback counts use singular wording for one hidden folder', async () => {
  const e = fixture(); e.ui.sync(true, e.identity); await settle(); await e.click(eye(e.parent));
  const toggle = e.document.getElementById('gz-folders-toggle'), status = e.document.getElementById('gz-folder-status');
  await e.click(toggle); assert.equal(status.textContent, 'Showing 1 hidden folder.');
  await e.click(toggle); assert.equal(status.textContent, 'Hiding 1 folder.');
});
