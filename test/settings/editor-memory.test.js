// Memory settings with a broker stand-in. Records never enter through a storage read; revisions and clear snapshots are
// exercised as user operations, including edits racing another device and newly saved memories racing a clear dialog.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const I = require('../../extension/core/i18n.js'), A = require('../../extension/ai/settings.js'), E = require('../../extension/settings/editor-memory.js');
const root = path.join(__dirname, '../../extension'), read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const M = 'm-' + 'a'.repeat(32), N = 'm-' + 'b'.repeat(32), S = 's-' + 'c'.repeat(32), R = '1'.repeat(32), R2 = '2'.repeat(32);
const memory = (more = {}) => ({ v: 1, id: M, account: 'https://courses.example.test/42', kind: 'memory', revision: R, createdAt: 1, updatedAt: 2, markdown: 'I prefer brief answers.', ...more });
const course = (more = {}) => ({ ...memory(), id: S, kind: 'course', markdown: '# Week 2\n\nField notes', source: { type: 'course-read', tool: 'course_content_read', title: 'Field observations', observedAt: 4, complete: false }, ...more });
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const t = (key, values) => I.t(key, values, 'en');
async function page({ items = [memory(), course()], enabled = true, embedded = false, fail = '', reply } = {}) {
  const ids = new Map(), sent = [], listeners = [], exports = [], urls = [], revoked = [], doc = { activeElement: null };
  const walk = (e) => [e, ...e.children.flatMap(walk)];
  const el = (tag = 'div') => {
    const e = { tagName: tag.toUpperCase(), id: '', children: [], textContent: '', className: '', value: '', disabled: false, hidden: false, checked: false, attrs: {}, on: {}, dataset: {},
      append(...children) { this.children.push(...children); }, replaceChildren(...children) {
        if (this.children.some((child) => walk(child).includes(doc.activeElement))) doc.activeElement = doc.body;
        this.children = children;
      },
      setAttribute(key, value) { this.attrs[key] = value; }, addEventListener(type, listener) { (this.on[type] ||= []).push(listener); },
      focus() { if (!this.disabled) doc.activeElement = this; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; },
      remove() {}, click() { exports.push({ href: this.href, download: this.download }); },
      returnValue: '', open: false, showModal() { this.open = true; }, close(value = '') { this.open = false; this.returnValue = value; for (const f of this.on.close || []) f(); } };
    let disabled = false;
    Object.defineProperty(e, 'disabled', { enumerable: true, get: () => disabled, set: (value) => {
      disabled = value; if (value && doc.activeElement === e) doc.activeElement = doc.body;
    } });
    return e;
  };
  for (const [, id] of read('options.html').matchAll(/\bid="(ai-memory|memory-[^"]+)"/g)) ids.set(id, Object.assign(el(), { id }));
  const $ = (id) => { for (const node of ids.values()) { const found = walk(node).find((n) => n.id === id); if (found) return found; } return null; };
  Object.assign(doc, { getElementById: $, createElement: el, body: el('body') });
  doc.activeElement = doc.body;
  const worker = { enabled, items: structuredClone(items) };
  const changed = async (keys) => { for (const f of listeners) f(Object.fromEntries(keys.map((key) => [key, { newValue: { markdown: 'untrusted event payload' } }])), 'local'); await settle(); };
  const config = async (m) => {
    if (m.op === fail) return { ok: false, error: 'write' };
    if (m.op === 'state') return { ok: true, enabled: worker.enabled };
    if (m.op === 'list') return { ok: true, records: structuredClone(worker.items.filter((r) => r.kind === m.kind)) };
    if (m.op === 'settings') { worker.enabled = m.enabled; return { ok: true, enabled: worker.enabled }; }
    if (m.op === 'export') return { ok: true, markdown: '# Saved memories\n\n' + worker.items.filter((r) => r.kind === 'memory').map((r) => r.markdown).join('\n\n') };
    if (m.op === 'clear') {
      const previous = worker.items.length;
      worker.items = worker.items.filter((r) => !m.records.some((s) => s.id === r.id && s.revision === r.revision && r.kind === m.kind));
      return { ok: true, conflicts: m.records.length - (previous - worker.items.length) };
    }
    const record = worker.items.find((r) => r.id === m.id);
    if (!record) return { ok: false, error: 'not-found' };
    if (record.revision !== m.revision) return { ok: false, error: 'conflict', current: record };
    if (m.op === 'update') Object.assign(record, { markdown: m.markdown, revision: R2, edited: true });
    if (m.op === 'forget') worker.items = worker.items.filter((r) => r.id !== m.id);
    return { ok: true, receipt: { id: m.id, revision: R2, operation: m.op === 'update' ? 'updated' : 'forgotten', persistence: 'device' } };
  };
  const chrome = { runtime: { sendMessage: async (m) => { sent.push(structuredClone(m)); return reply ? reply(m, () => config(m)) : config(m); } },
    storage: { local: { get() { throw new Error('memory UI read storage directly'); }, set() { throw new Error('memory UI wrote storage directly'); } }, onChanged: { addListener: (f) => listeners.push(f) } } };
  const URLStand = class extends URL { static createObjectURL(blob) { urls.push(blob); return 'blob:memory-export'; } static revokeObjectURL(url) { revoked.push(url); } };
  const window = {}; window.top = embedded ? {} : window;
  const ctx = vm.createContext({ document: doc, window, chrome, URL: URLStand, Blob, console, setTimeout: (f) => { f(); return 1; } });
  vm.runInContext(read('settings/editor-memory.js'), ctx); ctx.GZ_MEMORYEDIT.mount({ t, when: (at) => '@' + at });
  const fire = async (id, type = 'click') => { const target = typeof id === 'string' ? $(id) : id; for (const f of target.on[type] || []) await f({ target, currentTarget: target }); await settle(); };
  const all = (e) => [e.textContent, ...e.children.flatMap(all)].join(' ');
  const record = (id) => walk($('memory-memory-list')).concat(walk($('memory-course-list'))).find((n) => n.dataset.memoryId === id);
  const button = (id, words) => walk(record(id)).find((n) => n.tagName === 'BUTTON' && n.textContent === words);
  await settle();
  return { $, sent, worker, doc, changed, fire, record, button, all, urls, revoked, exports, edit: async (text) => { $('memory-edit-text').value = text; await fire('memory-edit-text', 'input'); } };
}

test('memory defaults on independently of AI/Ask; false survives all settings changes', () => {
  assert.equal(A.clean().memory, true); assert.equal(A.clean({ memory: false }).memory, false);
  assert.equal(A.clean({ memory: 'false' }).memory, true);
  assert.equal(A.clean({ on: true, features: { ask: true }, memory: false }).memory, false);
});

test('controls initialize with broker reads only and remain available with Memory off', async () => {
  const p = await page({ enabled: false });
  assert.deepEqual(p.sent.map((m) => m.op), ['state', 'list', 'list']);
  assert.ok(p.sent.every((m) => m.type === 'glaze:memory' && !('account' in m)));
  assert.equal(p.$('memory-on').checked, false); assert.equal(p.$('memory-on').disabled, false);
  assert.equal(p.$('memory-export').disabled, false); assert.equal(p.$('memory-memory-clear').disabled, false);
  assert.match(p.all(p.$('memory-memory-list')), /brief answers/); assert.match(p.all(p.$('memory-course-list')), /Field notes/);
  p.$('memory-on').checked = true; await p.fire('memory-on', 'change');
  assert.equal(p.worker.enabled, true);
  assert.deepEqual(p.sent.find((m) => m.op === 'settings'), { type: 'glaze:memory', op: 'settings', enabled: true });
});

test('plain Markdown is text, grouped by account, and cached reads retain provenance/partial status', async () => {
  const p = await page({ items: [memory({ markdown: '<img src=x onerror=alert(1)> **brief**' }), memory({ id: N, account: 'https://courses.example.test/73' }), course()] });
  assert.match(p.all(p.$('memory-memory-list')), /<img src=x onerror=alert\(1\)> \*\*brief\*\*/);
  assert.equal(p.$('memory-memory-list').children.length, 2);
  assert.match(p.all(p.$('memory-memory-list')), /courses.example.test · 42/);
  assert.match(p.all(p.$('memory-memory-list')), /courses.example.test · 73/);
  assert.match(p.all(p.record(S)), /Field observations @4 · Partial/);
  assert.equal(p.button(S, 'Edit'), undefined);
});

test('editing sends only the current id/revision and text; broker refresh preserves draft and caret', async () => {
  const p = await page(); await p.fire(p.button(M, 'Edit'));
  assert.equal(p.$('memory-edit-text').attrs.writingsuggestions, 'false');
  await p.edit('Use concise bullet points.'); p.$('memory-edit-text').setSelectionRange(4, 7);
  await p.changed(['rimeMemory:synthetic']);
  assert.equal(p.$('memory-edit-text').value, 'Use concise bullet points.');
  assert.equal(p.doc.activeElement, p.$('memory-edit-text')); assert.equal(p.$('memory-edit-text').selectionStart, 4);
  await p.fire(p.button(M, 'Save'));
  assert.deepEqual(p.sent.find((m) => m.op === 'update'), { type: 'glaze:memory', op: 'update', id: M, revision: R, markdown: 'Use concise bullet points.' });
  assert.equal(p.worker.items.find((r) => r.id === M).edited, true);
  assert.equal(p.button(M, 'Save'), undefined);
});

test('a concurrent edit conflicts without losing the draft; Reload accepts the newer revision', async () => {
  const p = await page(); await p.fire(p.button(M, 'Edit')); await p.edit('My draft');
  Object.assign(p.worker.items[0], { markdown: 'Other device edit', revision: R2 });
  await p.fire(p.button(M, 'Save'));
  assert.equal(p.$('memory-edit-text').value, 'My draft'); assert.match(p.$('memory-said').textContent, /changed/);
  assert.equal(p.worker.items[0].markdown, 'Other device edit');
  await p.fire(p.button(M, 'Reload')); assert.equal(p.$('memory-edit-text').value, 'Other device edit');
  await p.edit('Final edit'); await p.fire(p.button(M, 'Save'));
  assert.equal(p.sent.filter((m) => m.op === 'update').at(-1).revision, R2);
});

test('broker refresh preserves keyboard focus on record buttons and course summaries', async () => {
  const p = await page(); p.button(M, 'Edit').focus();
  await p.changed(['rimeMaterial:synthetic']);
  assert.equal(p.doc.activeElement, p.button(M, 'Edit'));
  p.button(M, 'Delete').focus(); await p.changed(['rimeMemory:synthetic']);
  assert.equal(p.doc.activeElement, p.button(M, 'Delete'));
  p.record(S).children[0].children[0].focus(); await p.changed(['ai']);
  assert.equal(p.doc.activeElement, p.record(S).children[0].children[0]);
});

test('Cancel and successful Save return keyboard focus to Edit; deletion has a reachable fallback', async () => {
  const p = await page(); await p.fire(p.button(M, 'Edit'));
  p.button(M, 'Cancel').focus(); await p.fire(p.button(M, 'Cancel'));
  assert.equal(p.doc.activeElement, p.button(M, 'Edit'));
  await p.fire(p.button(M, 'Edit')); await p.edit('Updated preference');
  p.button(M, 'Save').focus(); await p.fire(p.button(M, 'Save'));
  assert.equal(p.doc.activeElement, p.button(M, 'Edit'));
  p.button(M, 'Delete').focus(); await p.fire(p.button(M, 'Delete'));
  assert.equal(p.doc.activeElement, p.$('memory-refresh'));
});

test('failed Save restores keyboard focus without stealing it from another control during the request', async () => {
  const p = await page({ fail: 'update' }); await p.fire(p.button(M, 'Edit'));
  p.button(M, 'Save').focus(); await p.fire(p.button(M, 'Save'));
  assert.equal(p.doc.activeElement, p.button(M, 'Save'));
  let release;
  const slow = await page({ reply: (m, next) => m.op === 'update' ? new Promise((resolve) => { release = () => resolve(next()); }) : next() });
  await slow.fire(slow.button(M, 'Edit')); slow.button(M, 'Save').focus();
  const saving = slow.fire(slow.button(M, 'Save')); await settle();
  const elsewhere = slow.doc.createElement('button'); slow.doc.body.append(elsewhere); elsewhere.focus();
  release(); await saving;
  assert.equal(slow.doc.activeElement, elsewhere);
});

test('delete failure remains visible and keeps the record; successful delete is scoped to id/revision', async () => {
  const failed = await page({ fail: 'forget' }); await failed.fire(failed.button(M, 'Delete'));
  assert.ok(failed.record(M)); assert.equal(failed.$('memory-said').textContent, 'Could not save. Try again.');
  const p = await page(); await p.fire(p.button(M, 'Delete'));
  assert.equal(p.record(M), undefined); assert.ok(p.record(S));
  assert.deepEqual(p.sent.find((m) => m.op === 'forget'), { type: 'glaze:memory', op: 'forget', id: M, revision: R });
});

test('clear asks with Cancel focused and snapshots only its kind; later saves survive confirmation', async () => {
  const p = await page(); await p.fire('memory-memory-clear');
  assert.equal(p.$('memory-clear-ask').open, true); assert.equal(p.doc.activeElement, p.$('memory-clear-cancel'));
  p.$('memory-clear-ask').close('cancel'); await settle(); assert.equal(p.sent.some((m) => m.op === 'clear'), false);
  await p.fire('memory-memory-clear');
  p.worker.items.push(memory({ id: N })); await p.changed(['rimeMemory:new']);
  p.$('memory-clear-ask').close('ok'); await settle();
  assert.deepEqual(p.sent.find((m) => m.op === 'clear'), { type: 'glaze:memory', op: 'clear', kind: 'memory', records: [{ id: M, revision: R }] });
  assert.ok(p.record(N)); assert.ok(p.record(S)); assert.equal(p.record(M), undefined);
  await p.fire('memory-course-clear'); p.$('memory-clear-ask').close('ok'); await settle();
  assert.equal(p.record(S), undefined); assert.ok(p.record(N));
});

test('clear preserves revised records and tells the user why', async () => {
  const p = await page(); await p.fire('memory-memory-clear'); p.worker.items[0].revision = R2;
  p.$('memory-clear-ask').close('ok'); await settle();
  assert.ok(p.record(M)); assert.match(p.$('memory-said').textContent, /Some records changed/);
});

test('clearing the last record returns focus to Refresh when its trigger becomes disabled', async () => {
  const p = await page(); await p.fire('memory-memory-clear');
  p.$('memory-clear-ask').close('ok'); await settle();
  assert.equal(p.$('memory-memory-clear').disabled, true);
  assert.equal(p.doc.activeElement, p.$('memory-refresh'));
  p.$('memory-on').focus(); p.$('memory-on').checked = false; await p.fire('memory-on', 'change');
  assert.equal(p.doc.activeElement, p.$('memory-on'));
});

test('export downloads the broker Markdown without course content and releases its object URL', async () => {
  const p = await page({ enabled: false }); await p.fire('memory-export');
  assert.deepEqual(p.exports, [{ href: 'blob:memory-export', download: 'glaze-memories.md' }]);
  assert.match(await p.urls[0].text(), /brief answers/); assert.doesNotMatch(await p.urls[0].text(), /Field notes/);
  assert.deepEqual(p.revoked, ['blob:memory-export']);
});

test('failed loads offer Refresh, while late initialization cannot overwrite a changed switch', async () => {
  const failed = await page({ fail: 'list' }); assert.equal(failed.$('memory-export').disabled, true);
  assert.equal(failed.$('memory-refresh').disabled, false); assert.match(failed.$('memory-said').textContent, /Could not load/);
  let release; let states = 0;
  const p = await page({ reply: (m, next) => m.op === 'state' && ++states === 2 ? new Promise((r) => { release = r; }) : next() });
  await p.changed(['ai']);
  p.$('memory-on').checked = false; await p.fire('memory-on', 'change');
  release({ ok: true, enabled: true }); await settle(); assert.equal(p.$('memory-on').checked, false);
});

test('a late switch acknowledgement rechecks a newer choice made in another Settings page', async () => {
  let release;
  const p = await page({ reply: async (m, next) => { const r = await next(); return m.op === 'settings' ? new Promise((resolve) => { release = resolve; }) : r; } });
  p.$('memory-on').checked = false; const saving = p.fire('memory-on', 'change'); await settle();
  p.worker.enabled = true; await p.changed(['ai']);
  release({ ok: true, enabled: false }); await saving;
  assert.equal(p.$('memory-on').checked, true, 'the worker’s latest switch wins');
});

test('frameable Settings mounts no memory access; invalid/deleted records are not displayed', async () => {
  const p = await page({ embedded: true }); assert.deepEqual(p.sent, []);
  assert.deepEqual(E.rows([memory(), memory({ deleted: true }), memory({ id: 'bad' }), memory({ markdown: 'x'.repeat(601) }), course()], 'memory').map((r) => r.id), [M]);
});

test('page wiring keeps Memory outside AI enablement and every new label is translated', () => {
  const html = read('options.html'), js = read('settings/editor-memory.js'), opts = read('settings/options.js');
  const section = html.slice(html.indexOf('<section id="ai-memory"'), html.indexOf('<section id="ai-activity"'));
  assert.match(section, /data-editor-section="ai\/memory" data-sites="Extension only"/);
  assert.match(html, /href="#ai\/memory" data-editor-jump>Memory<\/a>/);
  assert.match(opts, /GZ_MEMORYEDIT\.mount\(/); assert.match(opts, /memories: t\('Saved memories'\)/);
  assert.ok(html.indexOf('settings/editor-memory.js') < html.indexOf('settings/options.js'));
  assert.doesNotMatch(read('settings/editor-ai.js'), /\$\('ai-memory'\)\.hidden/);
  assert.ok(html.indexOf('<dialog id="memory-clear-ask"') > html.indexOf('<div id="panel-backup"'));
  assert.doesNotMatch(js, /\bconfirm\(/);
  const words = new Set([...js.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]).concat([...section.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter((w) => /\p{L}/u.test(w))));
  for (const [lang, cat] of Object.entries(globalThis.GZ_LANGS)) for (const word of words) assert.ok(word in cat, lang + ': ' + word);
});
