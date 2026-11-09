// Glaze Writer's hand in a Canvas page's own world (writer/writer-main-canvas.js), run in a vm against a stand-in TinyMCE:
// set puts Canvas's dialect into the box's own editor as an edit Canvas hears (its React state, the quiz's backup, its
// autosave), get reads it back, exec runs only Canvas's Insert tools, a box Canvas changes itself is announced, and the
// Inbox's plain textarea is written through the value setter React tracks. Then the worker: a writer pass injects each
// LMS's own page-world helper and nothing else.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const worker = require('../helpers/worker-env.cjs');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const pageWorld = ({ major = '5' } = {}) => {
  const doc = new EventTarget();
  const attrs = new Set(), calls = [];
  doc.documentElement = { hasAttribute: (k) => attrs.has(k), setAttribute: (k) => attrs.add(k) };
  // TinyMCE's editor as Canvas's RCE has it: its textarea (data-rich_text once Canvas's onInit ran), its frame body, its
  // events (on/fire, case as TinyMCE fires them), undo, selection and commands.
  const editor = (ta) => {
    const handlers = [];
    const body = { innerHTML: '<p><br data-mce-bogus="1"></p>', contentEditable: 'true', getAttribute(k) { return k === 'contenteditable' ? this.contentEditable : null; }, get textContent() { return this.innerHTML.replace(/<[^>]*>/g, ''); } };
    const ed = {
      id: ta.id, initialized: true, removed: false, hidden: false, body,
      getElement: () => ta, getBody: () => body, isHidden() { return this.hidden; },
      on: (names, fn) => { for (const n of names.split(' ')) handlers.push([n.toLowerCase(), fn]); },
      fire(name, args) { calls.push(['fire', ta.id, name]); for (const [n, fn] of handlers) if (n === name.toLowerCase()) fn(args || {}); },
      setContent(html) { calls.push(['setContent', ta.id, html]); body.innerHTML = html; this.fire('SetContent'); },
      undoManager: { add: () => calls.push(['undo.add', ta.id]) },
      focus: () => calls.push(['focus', ta.id]),
      selection: { select: (n, inner) => calls.push(['select', ta.id, inner]), collapse: (start) => calls.push(['collapse', ta.id, start]) },
      execCommand: (c) => calls.push(['exec', ta.id, c]),
    };
    return ed;
  };
  const textarea = (id, extra = {}) => ({ id, tagName: 'TEXTAREA', disabled: false, attrs: { 'data-rich_text': 'true', ...extra.attrs }, modal: !!extra.modal, getAttribute(k) { return this.attrs[k] ?? null; },
    closest(sel) { return sel === '#compose-message-modal' && this.modal ? {} : null; } });
  const areas = { 'gzw-1': textarea('submission_body'), 'gzw-2': textarea('question_input_0'), 'gzw-3': textarea('TextArea___0', { attrs: { 'data-rich_text': null, 'data-testid': 'message-body' }, modal: true }), 'gzw-4': textarea('elsewhere') };
  for (const [k, a] of Object.entries(areas)) a.attrs['data-gz-writer-id'] = k;
  const editors = { submission_body: editor(areas['gzw-1']), question_input_0: editor(areas['gzw-2']), elsewhere: editor(textarea('elsewhere')) };
  doc.querySelector = (sel) => { const m = /^textarea\[data-gz-writer-id="([^"]+)"\]$/.exec(sel); return m ? areas[m[1]] || null : null; };
  // The textarea's own value setter, as React's value tracker sees it; an input event the page hears.
  class HTMLTextAreaElement {}
  Object.defineProperty(HTMLTextAreaElement.prototype, 'value', { set(v) { calls.push(['value', this.id, v]); this._value = v; }, get() { return this._value ?? ''; }, configurable: true });
  for (const k of ['gzw-3']) Object.setPrototypeOf(areas[k], HTMLTextAreaElement.prototype);
  areas['gzw-3'].dispatchEvent = (e) => { calls.push(['event', 'TextArea___0', e.type, e.bubbles]); return true; };
  const changed = [];
  doc.addEventListener('gz-writer:canvas-changed', (e) => changed.push(JSON.parse(e.detail)));
  const tinymce = { majorVersion: major, minorVersion: '10.9', get: (id) => editors[id] || null };
  const ctx = vm.createContext({ document: doc, window: {}, CustomEvent, Event, JSON, HTMLTextAreaElement });
  ctx.window.tinymce = tinymce;
  const run = () => vm.runInContext(read('writer/writer-main-canvas.js'), ctx);
  const ask = (type, detail) => {
    const got = [];
    const hear = (e) => got.push(JSON.parse(e.detail));
    doc.addEventListener('gz-writer:done', hear);
    doc.dispatchEvent(new CustomEvent(`gz-writer:${type}`, { detail: typeof detail === 'string' ? detail : JSON.stringify(detail) }));
    doc.removeEventListener('gz-writer:done', hear);
    return got;
  };
  return { run, ask, calls, editors, areas, changed, tinymce };
};

test('set writes Canvas\'s dialect into the box\'s own editor as an edit Canvas hears, undoable, without touching focus', () => {
  const p = pageWorld();
  assert.equal(p.run(), true, 'ends on a value, as executeScript reports');
  const html = '<p style="text-align: center; padding-left: 40px;">Hi <strong>there</strong> <a href="https://e.com/a?b=1&amp;c=2">l</a></p><ul><li>a<ul><li>b</li></ul></li><li style="list-style-type: none;"><ol><li style="text-align: right;">c</li></ol></li></ul><blockquote><p>q</p></blockquote><pre>x &lt; 2</pre><h3>H</h3><h4>h</h4><p><em>i</em><u>u</u><s>s</s><sup>2</sup><sub>i</sub><br></p>';
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-1', html }), [{ id: 'gzw-1', ok: true, html, text: html.replace(/<[^>]*>/g, '') }]);
  assert.deepEqual(p.calls, [['setContent', 'submission_body', html], ['fire', 'submission_body', 'SetContent'], ['undo.add', 'submission_body'], ['fire', 'submission_body', 'change']]);
  assert.ok(!p.calls.some(([c]) => c === 'focus' || c === 'select'));
  assert.deepEqual(p.ask('canvas-get', { id: 'gzw-1' }), [{ id: 'gzw-1', ok: true, html, text: html.replace(/<[^>]*>/g, '') }]);
});

test('set refuses anything outside Canvas\'s dialect, and every box it can\'t be sure of', () => {
  const p = pageWorld();
  p.run();
  const bad = ['<script>x</script>', '<p><img src="x"></p>', '<p style="color: red;">c</p>', '<p class="x">c</p>', '<p><a href="javascript:alert(1)">x</a></p>',
    '<p><span style="text-decoration: underline;">u</span></p>', '<h2>h</h2>', '<p style="padding-left: 30px;">p</p>', '<li style="padding-left: 40px;">x</li>', '<!-- c --><p>x</p>',
    '<p onclick="x()">x</p>', '<iframe src="https://e.com"></iframe>', '<p>a</p><table><tr><td>x</td></tr></table>', `<p>${'x'.repeat(2e6)}</p>`, 42, null];
  for (const html of bad) assert.deepEqual(p.ask('canvas-set', { id: 'gzw-1', html }), [{ id: 'gzw-1', ok: false }], String(html).slice(0, 60));
  assert.deepEqual(p.calls, [], 'nothing reached the editor');
  for (const id of ['gzw-9', 'bad id!', 'gzw-4']) assert.deepEqual(p.ask('canvas-set', { id, html: '<p>x</p>' }), [{ id, ok: false }], id);
  p.editors.submission_body.hidden = true;
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-1', html: '<p>x</p>' }), [{ id: 'gzw-1', ok: false }], 'an HTML view hides TinyMCE');
  p.editors.submission_body.hidden = false;
  p.editors.submission_body.initialized = false;
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-1', html: '<p>x</p>' }), [{ id: 'gzw-1', ok: false }], 'not ready');
  p.editors.submission_body.initialized = true;
  p.areas['gzw-1'].attrs['data-rich_text'] = null;
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-1', html: '<p>x</p>' }), [{ id: 'gzw-1', ok: false }], 'Canvas hasn\'t marked it ready');
  assert.deepEqual(p.ask('canvas-set', 'not json'), [], 'not ours: no answer');
  assert.deepEqual(p.calls, []);
  for (const major of ['4', '8']) {
    const q = pageWorld({ major });
    q.run();
    assert.deepEqual(q.ask('canvas-set', { id: 'gzw-1', html: '<p>x</p>' }), [{ id: 'gzw-1', ok: false }], `TinyMCE ${major}`);
  }
});

test('set accepts schema links whose escaped attribute is longer than their valid URL', () => {
  const S = require('../../extension/writer/writer-schema.js');
  const p = pageWorld();
  p.run();
  const href = `https://e.com/?${'a&'.repeat(800)}`;
  const doc = S.canvas.nodes.doc.create(null, S.canvas.nodes.paragraph.create(null,
    S.canvas.text('link', [S.canvas.marks.link.create({ href })])));
  const html = S.serialize(S.canvas, doc);
  assert.ok(href.length < 2048 && html.length > 2048);
  assert.equal(p.ask('canvas-set', { id: 'gzw-1', html })[0].ok, true);
  assert.equal(p.calls[0][2], html);
  const tooLong = `<p><a href="https://e.com/${'&amp;'.repeat(2048)}">link</a></p>`;
  assert.equal(p.ask('canvas-set', { id: 'gzw-1', html: tooLong })[0].ok, false);
});

test('exec runs only Canvas\'s Insert tools, with the caret at the end of the box', () => {
  const p = pageWorld();
  p.run();
  for (const command of ['instructureTrayForImages', 'mceInstructureImage', 'instructureRecord', 'instructureTrayForMedia', 'mceInstructureDocuments', 'instructureTrayForDocuments', 'instructureEquation', 'instructureTrayForCourseLinks', 'instructureLinkCreate']) {
    p.calls.length = 0;
    assert.equal(p.ask('canvas-exec', { id: 'gzw-1', command })[0].ok, true, command);
    assert.deepEqual(p.calls, [['focus', 'submission_body'], ['select', 'submission_body', true], ['collapse', 'submission_body', false], ['exec', 'submission_body', command]]);
  }
  p.calls.length = 0;
  for (const command of ['mceInsertContent', 'Delete', 'mceCodeEditor', 'instructure_html_view', '', 7]) assert.deepEqual(p.ask('canvas-exec', { id: 'gzw-1', command }), [{ id: 'gzw-1', ok: false }], String(command));
  assert.deepEqual(p.calls, []);
});

test('the helper cannot write or run tools in read-only Canvas editors', () => {
  const p = pageWorld();
  p.run();
  p.editors.submission_body.body.contentEditable = 'false';
  assert.equal(p.ask('canvas-set', { id: 'gzw-1', html: '<p>changed</p>' })[0].ok, false);
  assert.equal(p.ask('canvas-exec', { id: 'gzw-1', command: 'instructureEquation' })[0].ok, false);
  p.areas['gzw-3'].readOnly = true;
  assert.equal(p.ask('canvas-set', { id: 'gzw-3', text: 'changed' })[0].ok, false);
  assert.deepEqual(p.calls, []);
});

test('a box Canvas changes itself (its reset after Reply, its autosave restored, an undo) is announced; Writer\'s own writes are not', () => {
  const p = pageWorld();
  p.run();
  assert.equal(p.ask('canvas-watch', { id: 'gzw-1' })[0].ok, true);
  p.ask('canvas-watch', { id: 'gzw-1' });
  p.ask('canvas-set', { id: 'gzw-1', html: '<p>mine</p>' });
  assert.deepEqual(p.changed, [], 'Writer\'s set');
  const ed = p.editors.submission_body;
  for (const ev of ['SetContent', 'change', 'Undo', 'Redo']) ed.fire(ev);
  assert.deepEqual(p.changed, [{ id: 'gzw-1' }, { id: 'gzw-1' }, { id: 'gzw-1' }, { id: 'gzw-1' }], 'once each, though watched twice');
  ed.fire('keyup');
  assert.equal(p.changed.length, 4, 'typing in the hidden editor is not Canvas\'s change');
  p.areas['gzw-1'].attrs['data-gz-writer-id'] = null;
  ed.fire('SetContent');
  assert.equal(p.changed.length, 4, 'a box Writer gave back is no longer announced');
});

test('the Inbox: its lines through the textarea\'s own value setter and a bubbling input event; never a disabled field', () => {
  const p = pageWorld();
  p.run();
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-3', text: 'Hi\n\nthere\tfriend' }), [{ id: 'gzw-3', ok: true, text: 'Hi\n\nthere\tfriend' }]);
  assert.deepEqual(p.calls, [['value', 'TextArea___0', 'Hi\n\nthere\tfriend'], ['event', 'TextArea___0', 'input', true]]);
  assert.deepEqual(p.ask('canvas-get', { id: 'gzw-3' }), [{ id: 'gzw-3', ok: true, text: 'Hi\n\nthere\tfriend' }]);
  p.calls.length = 0;
  for (const text of ['a\u0000b', 'x'.repeat(200001), 42]) assert.deepEqual(p.ask('canvas-set', { id: 'gzw-3', text }), [{ id: 'gzw-3', ok: false }]);
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-3', html: '<p>x</p>' }), [{ id: 'gzw-3', ok: false }], 'the Inbox takes text, never HTML');
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-1', text: 'x' }), [{ id: 'gzw-1', ok: false }], 'an RCE takes HTML, never text');
  p.areas['gzw-3'].disabled = true;
  assert.deepEqual(p.ask('canvas-set', { id: 'gzw-3', text: 'x' }), [{ id: 'gzw-3', ok: false }], 'translating');
  assert.deepEqual(p.calls, []);
});

test('it runs once per document', () => {
  const p = pageWorld();
  p.run();
  p.run();
  assert.equal(p.ask('canvas-get', { id: 'gzw-1' }).length, 1);
});

// ---- the worker ---------------------------------------------------------------------------------------------------------
test('a writer pass injects each LMS\'s own page-world helper into the document that asked, and nothing else', async () => {
  const w = worker();
  const injected = [];
  w.context.chrome.scripting.executeScript = async (x) => { injected.push(x); return [{}]; };
  const canvas = { id: 'glaze', tab: { id: 7 }, frameId: 0, documentId: 'doc-c', url: 'https://school.instructure.com/courses/1/assignments/2' };
  const ultra = { id: 'glaze', tab: { id: 7 }, frameId: 0, documentId: 'doc-u', url: 'https://school.blackboard.com/ultra/courses/_1_1/discussion/_2_1' };
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, canvas), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, ultra), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(injected)), [
    { target: { tabId: 7, documentIds: ['doc-c'] }, files: ['writer/writer-main-canvas.js'], world: 'MAIN', injectImmediately: true },
    { target: { tabId: 7, documentIds: ['doc-u'] }, files: ['writer/writer-main.js'], world: 'MAIN', injectImmediately: true },
  ]);
  for (const s of [{ ...canvas, url: 'https://evil.example.com/courses/1/assignments/2' }, { ...canvas, url: 'http://school.instructure.com/courses/1' }, { ...canvas, url: 'https://school.moodlecloud.com/mod/forum/view.php' }]) {
    assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, s), { ok: false }, s.url);
  }
  assert.equal(injected.length, 2);
  await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, { ...canvas, documentId: undefined, frameId: 3 });
  assert.deepEqual(JSON.parse(JSON.stringify(injected[2])), { target: { tabId: 7, frameIds: [3] }, files: ['writer/writer-main-canvas.js'], world: 'MAIN', injectImmediately: true }, 'without a documentId, the frame that asked');
  w.context.chrome.scripting.executeScript = async () => { throw new Error('no access'); };
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, canvas), { ok: false }, 'no helper, no pass');
});

test('the Canvas adapter loads on demand; its page-world helper goes in only with a pass', () => {
  const list = JSON.parse(read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('writer/writer-canvas.js'));
  assert.ok(!list.includes('writer/writer-main-canvas.js'));
});
