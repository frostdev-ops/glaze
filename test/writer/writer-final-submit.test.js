// Writer's submit, final review: what a failed, cancelled or interrupted submit leaves behind (the worker's permit, the
// paper's versions, Ultra's own text box and buttons), and the paper's word count as the editor makes it.
const test = require('node:test');
const assert = require('node:assert/strict');

const BLOCK = { align: null, indent: 0, line: null, first: null };
const para = (...content) => ({ type: 'paragraph', attrs: BLOCK, content });
const text = (t, marks) => ({ type: 'text', text: t, ...(marks && { marks }) });

test('F5: a paper\'s words are counted as the status bar counts them, hard breaks and all', () => {
  const S = require('../../extension/writer/writer-schema.js'), E = require('../../extension/writer/writer-editor.js'), P = require('../../extension/writer/writer-papers.js');
  const docs = {
    hardBreak: [para(text('one'), { type: 'hard_break' }, text('two'))],
    marks: [para(text('alpha'), text('beta', [{ type: 'bold' }]))],
    blocks: [para(text('one two')), para(text('three'))],
    footnote: [para(text('word'), { type: 'footnote_ref', attrs: { content: 'a note of four words' } }, text('next'))],
    quote: [{ type: 'blockquote', content: [para(text('quoted words')), para(text('more'), { type: 'hard_break' }, text('lines'))] }],
  };
  for (const [name, content] of Object.entries(docs)) {
    const json = { type: 'doc', content };
    assert.equal(P.measure(json).words, E.words(S.text(S.paper.nodeFromJSON(json)).text), name);
  }
});

const page = require('../helpers/writer-submit-page.cjs');
const L = require('../../extension/writer/writer-submit.js');
const done = (p) => p.sent.filter((m) => m.type === 'submit:done').map((m) => (m.ok ? 'ok' : m.error));

test('D9: once Writer has clicked Ultra\'s Submit, Ultra\'s Save and Close works again (after the paper saves)', async () => {
  const p = page();
  await p.go();
  assert.deepEqual(done(p), ['ok']);
  // Ultra's confirmation, cancelled: the student is back on the attempt and presses Save and Close.
  const save = L.footer(p.box.editor).save;
  save.disabled = false; save.removeAttribute('disabled'); save.className = '';
  p.fire(save, 'click');
  const asked = p.sent.filter((m) => m.type === 'submit:save');
  assert.equal(asked.length, 1, 'the paper is saved first, as before any submit');
  p.hear({ type: 'submit:saved', request: asked[0].request, ok: true });
  assert.equal(p.clicks.filter((b) => b === save).length, 1, 'then Ultra\'s own Save and Close goes on');
});

test('Ultra\'s editor off while it saves the upload: the note waits for it rather than a write Quill drops, then Submit once', async () => {
  const p = page({ off: true });
  await p.go({ note: 'Hi Professor' });
  await p.tick(100);
  assert.deepEqual([done(p), p.clicks.length, p.uploads.length], [[], 0, 1], 'attached, then waiting for Ultra\'s editor');
  p.settle();
  for (let i = 0; i < 5 && !done(p).length; i++) await p.tick(100);
  assert.deepEqual(done(p), ['ok']);
  assert.equal(boxText(p), 'Hi Professor');
  assert.equal(p.clicks.filter((b) => b === p.button()).length, 1);
});

test('D13: an attempt that holds nothing yet is saved with text before any upload, so Ultra creates its draft in place', async () => {
  // Live Ultra 4001.4, 2026-11-14: a draft its first file creates redraws the whole submission editor, and Writer's frame
  // with it; one a text save creates doesn't.
  const p = page({ enabled: false });
  p.doc.querySelector('#bb-editorassignment-attempt-authoring-submission').replaceChildren();
  await p.go({ note: 'Hi Professor' });
  await p.tick(100);
  assert.equal(p.uploads[0]?.savesBefore, 1, 'the note saved before the upload');
  assert.equal(p.uploads[0].settled, true, 'once Ultra\'s footer says it saved, never while its spinner turns');
  p.setEnabled(true);
  for (let i = 0; i < 5 && !done(p).length; i++) await p.tick(100);
  assert.deepEqual(done(p), ['ok']);
  assert.equal(boxText(p), 'Hi Professor');
  const q = page({ enabled: false });
  q.doc.querySelector('#bb-editorassignment-attempt-authoring-submission').replaceChildren();
  await q.go();
  await q.tick(100);
  assert.equal(q.uploads[0]?.savesBefore, 1, 'with nothing to write, a placeholder saved first');
  q.setEnabled(true);
  for (let i = 0; i < 5 && !done(q).length; i++) await q.tick(100);
  assert.deepEqual(done(q), ['ok']);
  assert.equal(boxText(q), '', 'and taken out again before Submit');
});

test('D14: a file of the same name already in Ultra\'s draft stops the run until the student asks to replace it', async () => {
  const p = page();
  p.addRow('Rivera_Essay2.docx', { removable: true });
  await p.go();
  const failed = p.sent.find((m) => m.type === 'submit:done');
  assert.deepEqual([failed.error, failed.file, p.uploads.length, p.deletes.length], ['exists', 'Rivera_Essay2.docx', 0, 0]);
  await p.go({ run: 2, replace: ['Rivera_Essay2.docx'] });
  for (let i = 0; i < 5 && done(p).length < 2; i++) await p.tick(100);
  assert.deepEqual(done(p), ['exists', 'ok']);
  assert.deepEqual([p.deletes, p.uploads.length, p.clicks.filter((b) => b === p.button()).length], [['Rivera_Essay2.docx'], 1, 1], 'Ultra\'s own delete, then the upload, then Submit once');
  const q = page();
  q.addRow('Rivera_Essay2.docx', { removable: true });
  await q.go({ replace: ['Notes.pdf'] });
  assert.deepEqual([done(q), q.deletes.length], [['exists'], 0], 'only the file the student named');
});

test('D14: the sheet offers Replace for a file Ultra already has, and sends that name with the next run', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const s = sheet();
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush();
  const go = s.messages.find((m) => m.type === 'submit:go');
  s.handles['submit:done']({ run: go.run, ok: false, error: 'exists', file: 'Rivera_Essay2.docx' }); await s.flush();
  const replace = s.doc.querySelector('.gs-replace');
  assert.ok(replace && !replace.hidden, 'Replace beside Blackboard editor');
  s.click('.gs-replace'); await s.flush();
  for (const b of s.builds) b.resolve(); await s.flush();
  const again = s.messages.filter((m) => m.type === 'submit:go');
  assert.equal(again.length, 2);
  assert.deepEqual([...again[1].replace], ['Rivera_Essay2.docx']);
  assert.equal(again[0].replace, undefined, 'never without the student\'s word');
});

test('review: cancelling Replace as Ultra opens its delete dialog never confirms the deletion', async () => {
  const p = page();
  p.addRow('Rivera_Essay2.docx', { removable: true });
  p.doc.addEventListener('click', (e) => {
    if (e.target.getAttribute('data-analytics-id')?.endsWith('.deleteFile')) queueMicrotask(() => p.hear({ type: 'submit:cancel', run: 1 }));
  });
  await p.go({ replace: ['Rivera_Essay2.docx'] });
  assert.equal(p.deletes.length, 0, 'the run lost permission before the destructive confirmation');
  assert.equal(p.uploads.length, 0);
  assert.deepEqual(done(p), ['page']);
});

test('review: Replace never confirms an already open delete dialog for another file', async () => {
  const p = page();
  p.addRow('Other.pdf', { removable: true });
  p.addRow('Rivera_Essay2.docx', { removable: true });
  const other = p.doc.querySelectorAll('button[data-analytics-id]').find((b) => b.getAttribute('data-analytics-id').endsWith('Other.pdf.deleteFile'));
  other.click();
  await p.go({ replace: ['Rivera_Essay2.docx'] });
  assert.deepEqual(p.deletes, [], 'the student only consented to replace the named paper');
  assert.equal(p.uploads.length, 0);
  assert.deepEqual(done(p), ['review']);
});

test('D15: bytes from another realm (Firefox hands a content script the port\'s data in the page\'s) still submit', async () => {
  const vm = require('node:vm');
  const foreign = (a) => vm.runInNewContext(`new Uint8Array(${JSON.stringify(a)}).buffer`);
  const p = page();
  await p.go({ bytes: foreign([1, 2, 3]) });
  assert.deepEqual(done(p), ['ok'], 'the attempt\'s own file');
  const q = page();
  await q.go({ files: [{ name: 'Notes.pdf', mime: 'application/pdf', size: 2 }], stream: true });
  const ask = q.sent.find((m) => m.type === 'submit:file' && m.index === 0);
  q.hear({ type: 'submit:file', run: 1, index: 0, ok: true, bytes: foreign([7, 8]) });
  for (let i = 0; i < 6 && !done(q).length; i++) { await q.tick(200); const last = q.sent.filter((m) => m.type === 'submit:file').at(-1); if (last && last.index === 1) q.hear({ type: 'submit:file', run: 1, index: 1, ok: true }); }
  assert.ok(ask, 'the attached file asked for');
  assert.deepEqual(done(q), ['ok'], 'and a streamed attachment');
  assert.equal(q.uploads.length, 2);
  const L = require('../../extension/writer/writer-submit.js');
  assert.equal(L.handInError({ name: 'a.pdf', mime: 'application/pdf', bytes: foreign([1]) }), null);
  assert.equal(L.fileBytes({ name: 'a.pdf', size: 1, type: 'application/pdf' }, foreign([1])), true);
});

// Ultra's confirmation of the Submit Writer pressed (live Ultra 4001.4, 2026-11-14): its Cancel and its own Submit.
const confirmation = (p) => {
  const { El } = require('../stand-in-dom.js');
  const d = new El('div', p.doc), cancel = new El('button', p.doc), submit = new El('button', p.doc);
  d.setAttribute('role', 'dialog');
  cancel.setAttribute('data-analytics-id', 'assignment.attempt.submit.confirmation.dialog.cancel.button');
  submit.setAttribute('data-analytics-id', 'course.content.assessment.test.modal.confirmSubmitAttemptAlert.submit');
  d.append(cancel, submit); p.doc.body.append(d);
  return { d, cancel, submit };
};

test('D12: Ultra\'s confirmation cancelled, its Submit pressed again goes to Ultra once the frame says the paper is as sent', async () => {
  const p = page();
  await p.go();
  const b = p.button(), opens = () => p.sent.filter((m) => m.type === 'submit:open').map((m) => m.again === true);
  let c = confirmation(p);
  await p.tick(200);
  p.fire(c.cancel, 'click'); c.d.remove();
  await p.tick(200);
  p.fire(b, 'click');
  assert.deepEqual(opens(), [true], 'the frame is asked whether the paper is still as it was sent');
  p.hear({ type: 'submit:pass' }); await p.flush();
  assert.equal(p.clicks.filter((x) => x === b).length, 2, 'Writer\'s press, then this one: Ultra\'s draft holds the file and text');
  c = confirmation(p);
  await p.tick(200);
  p.fire(c.submit, 'click'); c.d.remove();
  await p.tick(200);
  p.fire(b, 'click');
  p.hear({ type: 'submit:pass' }); await p.flush();
  assert.deepEqual(opens(), [true, false], 'confirmed: nothing to press again');
  assert.equal(p.clicks.filter((x) => x === b).length, 2);
});

test('D12: a cancelled confirmation frees the attempt Ultra numbered for the page after a reload', async () => {
  const u = ultra(), url = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1';
  const p = await u.visit('doc-1', {}, { url });
  p.ctx.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1';
  await p.go(); await p.flush();
  assert.deepEqual(done(p), ['ok']);
  const c = confirmation(p);
  await p.tick(200);
  p.fire(c.cancel, 'click'); c.d.remove();
  await p.tick(200); await p.flush();
  const q = await u.visit('doc-2', {}, { url });
  q.ctx.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1';
  await q.go();
  assert.deepEqual(done(q), ['ok'], 'nothing was submitted: the reloaded page may submit the attempt');
  const r = await u.visit('doc-3', {}, { url });
  r.ctx.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1';
  await r.go();
  assert.deepEqual(done(r), ['claimed'], 'a dispatch never cancelled stays fenced');
});

test('review: passing Submit after a cancelled confirmation restores the worker fence, and a second Cancel clears it', async () => {
  const u = ultra(), url = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1';
  const p = await u.visit('doc-1', {}, { url });
  p.ctx.location.pathname = new URL(url).pathname;
  await p.go();
  for (let i = 0; i < 2; i++) {
    const c = confirmation(p);
    await p.tick(200);
    p.fire(c.cancel, 'click'); c.d.remove();
    await p.tick(200);
    assert.equal(Object.values(u.store.local).some((v) => v?.sent?.length), false, 'Cancel frees the attempt');
    p.fire(p.button(), 'click'); p.hear({ type: 'submit:pass' }); await p.flush();
    assert.equal(p.clicks.filter((b) => b === p.button()).length, i + 2);
    assert.equal(Object.values(u.store.local).some((v) => v?.sent?.length), true, 'every passed Submit records its dispatch');
  }
  const c = confirmation(p);
  await p.tick(200); p.fire(c.submit, 'click'); c.d.remove(); await p.tick(200);
  const q = await u.visit('doc-2', {}, { url });
  q.ctx.location.pathname = new URL(url).pathname;
  await q.go();
  assert.deepEqual(done(q), ['claimed'], 'the confirmed retry stays fenced after reload');
});

test('review: a confirmation retry cannot pass Submit after another page has claimed the attempt', async () => {
  const u = ultra();
  const p = await u.visit('doc-1');
  await p.go();
  const c = confirmation(p);
  await p.tick(200); p.fire(c.cancel, 'click'); c.d.remove(); await p.tick(200);
  const q = await u.visit('doc-2', { listed: false }, { tab: 2 });
  await q.go();
  Object.assign(u.at, { doc: 'doc-1', tab: 1 });
  p.fire(p.button(), 'click'); p.hear({ type: 'submit:pass' }); await p.flush();
  assert.equal(p.clicks.filter((b) => b === p.button()).length, 1, 'the other page owns the attempt');
  assert.equal(p.sent.at(-1).type, 'submit:open', 'the sheet can explain the conflict');
});

test('D12: a cancelled confirmation, the paper edited since: the next run finds its own upload and offers Replace', async () => {
  const p = page();
  await p.go();
  const c = confirmation(p);
  await p.tick(200);
  p.fire(c.cancel, 'click'); c.d.remove();
  await p.tick(200);
  await p.go({ run: 2, bytes: new Uint8Array([4, 5, 6]).buffer });
  assert.deepEqual(done(p), ['ok', 'exists'], 'not "already being submitted": the edited paper meets its earlier upload');
});

test('D12: a cancelled confirmation whose upload Ultra no longer lists goes nowhere near Ultra\'s Submit', async () => {
  const p = page();
  await p.go();
  const b = p.button(), c = confirmation(p);
  await p.tick(200);
  p.fire(c.cancel, 'click'); c.d.remove();
  await p.tick(200);
  for (const row of p.doc.querySelectorAll('span')) if (row.textContent === 'Rivera_Essay2.docx') row.remove();
  p.fire(b, 'click');
  p.hear({ type: 'submit:pass' }); await p.flush();
  assert.equal(p.clicks.filter((x) => x === b).length, 1);
  assert.equal(p.sent.filter((m) => m.type === 'submit:open').length, 2, 'the sheet opens instead');
});

test('D12: the frame sends Ultra\'s Submit back only for the paper exactly as it was sent', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const s = sheet();
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush();
  const go = s.messages.find((m) => m.type === 'submit:go');
  s.handles['submit:done']({ run: go.run, ok: true }); await s.flush();
  assert.equal(s.doc.querySelector('.gs-sheet'), null);
  await s.handles['submit:open']({ again: true }); await s.flush();
  assert.equal(s.messages.at(-1).type, 'submit:pass');
  assert.equal(s.doc.querySelector('.gs-sheet'), null);
  s.edit();
  await s.handles['submit:open']({ again: true }); await s.flush();
  assert.ok(s.doc.querySelector('.gs-sheet'), 'edited since: the sheet');
});

// The frame between its ready (the page is armed and catches Ultra's file area and Submit) and the paper's mount.
const early = (file) => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { El } = require('../stand-in-dom.js'), I = require('../../extension/core/i18n.js');
  const doc = { activeElement: null }, handles = {}, hooks = {}, opened = [], timers = [];
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = new El('body', doc); doc.root.append(doc.body); doc.body.append(new El('main', doc));
  for (const n of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[n] = El.prototype[n].bind(doc.root);
  doc.createElement = (tag) => new El(tag, doc);
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  let current = null;
  const ctx = vm.createContext({ document: doc, console, Intl, File, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    GZ_WRITER_FRAME: { t: (k, v) => I.t(k, v, 'en'), mode: () => 'paper', kind: () => 'assignment', say: () => {}, handle: (k, f) => { handles[k] = f; }, on: (k, f) => { hooks[k] = f; } },
    GZ_WRITER_PAPER: { current: () => current, need: async () => {} }, GZ_WRITER_SUBMIT_LIB: L });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8'), ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
  const later = async () => { for (const f of timers.splice(0)) f(); await flush(); };
  return { ctx, doc, handles, opened, flush, later, mount: (api) => { current = api; } };
};

test('D8: a file handed over from Ultra\'s file area before the paper has mounted waits for it, never dropped', async () => {
  const f = early('writer/frame/writer-import.js');
  const opened = [];
  f.ctx.GZ_WRITER_SUBMIT_SHEET = { open: (api, file) => opened.push(file), close: () => {}, busy: () => false };
  f.handles['import:file']({ name: 'Rivera_Essay2.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]).buffer });
  await f.flush(); await f.later();
  f.mount({ notify: () => {}, blank: () => true, importing: () => false });
  await f.later(); await f.later();
  assert.deepEqual(opened.map((x) => x.name), ['Rivera_Essay2.pdf'], 'the file taken from Ultra reaches the submit sheet once the paper is there');
});

test('D8: Ultra\'s Submit pressed before the paper has mounted opens the sheet once it has', async () => {
  const f = early('writer/frame/writer-submit.js');
  f.handles['submit:open']({});
  await f.flush(); await f.later();
  assert.equal(f.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), false);
  const view = { state: { doc: { label: 'x' } } };
  f.mount({ context: () => ({ assignment: { title: 'Essay 2' } }), paper: () => ({}), key: () => 'k', pages: () => 1, format: () => ({ id: 'mla9' }), editor: { view, text: () => '' },
    file: () => new Promise(() => {}), version: async () => true, save: async () => true });
  await f.later(); await f.later();
  assert.equal(f.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), true, 'the press was caught from Ultra: the sheet answers it');
});

// The worker's permits under the submit page: one assignment, pages opened in turn (a reload is a new document, a re-render
// a new box in the same one). The worker's clock is the test's.
const ultra = () => {
  const make = require('../helpers/worker-env.cjs');
  const store = { sync: { enabled: true, enhance: { writer: true } }, local: { ultra: [] }, session: {} };
  let clock = Date.now();
  class Clock extends Date { static now() { return clock; } }
  const w = make({ store, globals: { Date: Clock } });
  // from: the address Chrome's sender still names (the page the document loaded at) once Ultra has opened the attempt in-app.
  const at = { url: 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/create', doc: 'doc-1', tab: 1, from: null };
  const sender = () => ({ id: 'glaze', url: at.from || at.url, frameId: 0, documentId: at.doc, tab: { id: at.tab, url: at.url } });
  w.context.chrome.tabs.get = async () => sender().tab;
  w.context.chrome.scripting.executeScript = async () => [{ frameId: 0, documentId: at.doc, result: { href: at.url, origin: 'https://school.blackboard.com', ancestors: [] } }];
  const ops = [], hooks = {};
  const worker = async (m) => { ops.push(m.op); hooks[m.op]?.(m); return w.send(m, sender()); };
  const visit = async (doc, opts = {}, { url = at.url, tab = at.tab, from = null } = {}) => {
    Object.assign(at, { doc, url, tab, from });
    await w.send({ type: 'glaze:attempt-kind', kind: 'assignment', page: url }, sender());
    return page({ ...opts, worker });
  };
  return { w, store, at, ops, hooks, visit, sender, later: (ms) => { clock += ms; } };
};

for (const why of ['a same-named file already listed', 'a Cancel heard while the permit was claimed']) {
  for (const next of ['a reload', 'a re-render']) {
    test(`D1: a run stopped by ${why}, having attached nothing, frees the attempt for ${next}`, async () => {
      const u = ultra();
      const p = await u.visit('doc-1');
      if (why.startsWith('a same')) p.addRow('Rivera_Essay2.docx');
      else u.hooks.claim = () => p.hear({ type: 'submit:cancel', run: 1 });
      await p.go(); await p.flush();
      assert.equal(p.uploads.length + p.clicks.length, 0);
      delete u.hooks.claim;
      const q = await u.visit(next === 'a reload' ? 'doc-2' : 'doc-1');
      await q.go();
      assert.deepEqual(done(q), ['ok'], `the student's next Submit after ${next} goes through`);
      assert.equal(q.clicks.length, 1);
    });
  }
}

test('D11: an attempt Ultra opened in-app, its sender still naming the course page it loaded at, claims and submits', async () => {
  // Live Ultra, 2026-11-14: the overview's "View instructions" opens /attempt/create without a new document, and Chrome's
  // sender.url stays at /overview.
  const u = ultra(), from = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/overview?courseId=_101_1';
  const p = await u.visit('doc-1', {}, { from });
  await p.go();
  assert.deepEqual(done(p), ['ok']);
  assert.equal(p.clicks.length, 1);
  const q = await u.visit('doc-2', {}, { from });
  await q.go();
  assert.deepEqual(done(q), ['ok'], 'the dispatch was recorded under the attempt: the next attempt is free');
  const other = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_9_1/attempt/create';
  const r = await u.w.send({ type: 'glaze:writerSubmit', op: 'claim', token: crypto.randomUUID(), user: '_900_1', page: other }, u.sender());
  assert.equal(r.ok, false, 'an address the worker never saw this document at claims nothing');
  const x = await u.w.send({ type: 'glaze:writerSubmit', op: 'claim', token: crypto.randomUUID(), user: '_900_1', page: 'https://elsewhere.test/ultra/courses/_101_1/assessment/_7_1/attempt/create' }, u.sender());
  assert.equal(x.ok, false, 'another origin claims nothing');
});

test('D1: a run that may have uploaded keeps the attempt fenced until the student reviews it in Blackboard\'s editor', async () => {
  const u = ultra();
  const p = await u.visit('doc-1', { listed: false });
  await p.go(); await p.tick(31000);
  assert.deepEqual(done(p), ['attach']);
  assert.equal(p.uploads.length, 1, 'Ultra may still finish this upload');
  const q = await u.visit('doc-2');
  await q.go();
  assert.deepEqual(done(q), ['claimed'], 'after a reload the upload is unknown: no second copy');
  assert.equal(q.uploads.length, 0);
  q.hear({ type: 'submit:review' }); await q.flush();
  const r = await u.visit('doc-3');
  await r.go();
  assert.deepEqual(done(r), ['claimed'], 'a review while the earlier run could still be running clears nothing');
  u.later(91000);
  r.hear({ type: 'submit:review' }); await r.flush();
  const s = await u.visit('doc-4');
  await s.go();
  assert.deepEqual(done(s), ['ok'], 'once the student has opened Blackboard\'s editor on it, the attempt is theirs to submit again');
});

test('D1: the page that ran the upload clears its own fence when the student opens Blackboard\'s editor from the sheet', async () => {
  const u = ultra();
  const p = await u.visit('doc-1', { listed: false });
  await p.go(); await p.tick(31000);
  p.hear({ type: 'submit:review' }); await p.flush();
  const q = await u.visit('doc-2');
  await q.go();
  assert.deepEqual(done(q), ['ok']);
});

test('D1: a review never takes the permit from another tab\'s run under way', async () => {
  const u = ultra();
  const p = await u.visit('doc-1', { listed: false });
  await p.go();
  const q = await u.visit('doc-2', {}, { tab: 2 });
  q.hear({ type: 'submit:review' }); await q.flush();
  await q.go();
  assert.deepEqual(done(q), ['claimed']);
  assert.equal(q.uploads.length, 0);
});

test('D1: the sheet\'s Blackboard editor says the student is reviewing before it hands the box back', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const s = sheet(); await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush();
  const go = s.messages.find((m) => m.type === 'submit:go');
  s.handles['submit:done']({ run: go.run, ok: false, error: 'attach' }); await s.flush();
  s.click('.gs-native'); await s.flush();
  const said = s.messages.map((m) => m.type);
  assert.ok(said.includes('submit:review') && said.indexOf('submit:review') < said.indexOf('native'), said.join());
});

test('D2: an attempt submitted at /attempt/create leaves the next attempt at /attempt/create free', async () => {
  const u = ultra();
  const p = await u.visit('doc-1');
  await p.go();
  assert.deepEqual(done(p), ['ok']);
  const q = await u.visit('doc-2');
  await q.go();
  assert.deepEqual(done(q), ['ok'], 'an assignment that allows several attempts takes the next one');
  assert.equal(q.clicks.length, 1);
});

test('D2: the page that submitted, and one already open on the assignment then, stay fenced', async () => {
  const u = ultra();
  const other = await u.visit('doc-9', {}, { tab: 2 });
  const p = await u.visit('doc-1', {}, { tab: 1 });
  await p.go();
  assert.deepEqual(done(p), ['ok']);
  const again = await u.visit('doc-1', {}, { tab: 1 });
  await again.go();
  assert.deepEqual(done(again), ['claimed'], 'a re-render of the page Ultra is submitting');
  u.at.tab = 2; u.at.doc = 'doc-9';
  await other.go();
  assert.deepEqual(done(other), ['claimed'], 'a tab that was showing the assignment when it was sent');
});

test('D3: an attempt Ultra numbers while the run is under way (/attempt/create → /attempt/_31_1) still records its Submit', async () => {
  const u = ultra(), m = { type: 'glaze:writerSubmit', token: 'a'.repeat(36), user: '_900_1' };
  await u.visit('doc-1');
  assert.equal((await u.w.send({ ...m, op: 'claim' }, u.sender())).ok, true);
  u.at.url = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1';
  assert.equal((await u.w.send({ ...m, op: 'commit' }, u.sender())).ok, true, 'the same run, under the attempt\'s new address');
  await u.visit('doc-2');
  assert.equal((await u.w.send({ ...m, token: 'b'.repeat(36), op: 'claim' }, u.sender())).ok, false, 'that numbered attempt was sent');
  await u.visit('doc-3', {}, { url: 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/create' });
  assert.equal((await u.w.send({ ...m, token: 'c'.repeat(36), op: 'claim' }, u.sender())).ok, true, 'a new attempt is free');
});

test('D3: a claim at /attempt/create fences the same assignment at /attempt/_N_1 while it runs', async () => {
  const u = ultra(), m = { type: 'glaze:writerSubmit', token: 'a'.repeat(36), user: '_900_1' };
  await u.visit('doc-1');
  assert.equal((await u.w.send({ ...m, op: 'claim' }, u.sender())).ok, true);
  await u.visit('doc-2', {}, { tab: 2, url: 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/_31_1' });
  assert.equal((await u.w.send({ ...m, token: 'b'.repeat(36), op: 'claim' }, u.sender())).ok, false);
});

test('D7: a Cancel heard while the worker records the Submit never leaves the attempt fenced with nothing sent', async () => {
  const u = ultra();
  const p = await u.visit('doc-1');
  u.hooks.commit = () => p.hear({ type: 'submit:cancel', run: 1 });
  await p.go(); await p.flush();
  const sent = Object.values(u.store.local).filter((v) => v?.sent?.length).length;
  assert.equal(sent, p.clicks.length, 'a recorded Submit is a clicked one');
  const q = await u.visit('doc-2');
  await q.go();
  assert.equal(q.clicks.length, 1, 'and a reload submits if nothing was');
});

test('D7: the Submit is recorded in the very turn Ultra\'s Submit is clicked, never ahead of a check that can still fail', async () => {
  const u = ultra();
  const p = await u.visit('doc-1');
  let at = null;
  u.hooks.commit = () => { at = p.clicks.length; queueMicrotask(() => { at = at === 0 && p.clicks.length === 1 ? 'same turn' : at; }); };
  await p.go(); await p.flush();
  assert.equal(at, 'same turn');
  const stuck = await u.visit('doc-2', { enabled: false });
  await stuck.go(); await stuck.tick(16000);
  assert.deepEqual(done(stuck), ['submit']);
  assert.equal(u.ops.filter((o) => o === 'commit').length, 1, 'a run that never clicks records nothing');
});

// writer/writer-papers.js over a plain object (the worker's storage.local in ultra()).
const PA = require('../../extension/writer/writer-papers.js');
const over = (data = {}) => ({ data, get: async (k) => ({ [k]: data[k] === undefined ? undefined : structuredClone(data[k]) }),
  set: async (o) => { Object.assign(data, structuredClone(o)); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } });
const paperDoc = (t) => ({ type: 'doc', content: [para(text(t))] });
const KEY = PA.keyOf({ school: 'school.blackboard.com', user: '_900_1', course: '_101_1', content: '_7_1' });

test('D5: a submit that fails or is cancelled records no submission and no Submitted version', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const P = PA.open(over());
  await P.save(KEY, { doc: paperDoc('A first draft.') });
  for (const how of ['docx', 'attach', 'cancel']) {
    const s = sheet();
    s.api.version = (reason) => P.save(KEY, { doc: paperDoc('The paper.') }, { reason });
    if (how === 'docx') s.api.file = async () => { throw new Error('document build failed'); };
    await s.open(); for (const b of s.builds) b.resolve(); await s.flush();
    s.click('.gs-primary'); await s.flush();
    const go = s.messages.find((m) => m.type === 'submit:go');
    if (how === 'attach') s.handles['submit:done']({ run: go.run, ok: false, error: 'attach' });
    if (how === 'cancel') s.click('.gs-foot .gs-btn');
    await s.flush();
  }
  assert.equal((await P.list()).find((r) => r.key === KEY).submitted, null, 'the Papers page shows no Submitted badge');
  assert.equal((await P.get(KEY)).submitted, undefined);
  assert.equal((await P.versions(KEY)).some((v) => v.reason === 'submit'), false, 'no version says Submitted');
});

test('D5: the sheet hands the page the version its .docx was built from', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const P = PA.open(over());
  const s = sheet();
  let saved = null;
  s.api.version = async (reason) => (saved = await P.save(KEY, { doc: paperDoc('The paper.') }, { reason }));
  await s.open(); s.builds[0].resolve(); await s.flush();
  s.click('.gs-primary'); await s.flush();
  const go = s.messages.find((m) => m.type === 'submit:go');
  assert.ok(saved?.version?.id && go.version === saved.version.id, 'the page is told which version this is');
});

test('D5: Ultra\'s Submit click marks that version Submitted from the worker, with no frame left to do it', async () => {
  const u = ultra(), P = PA.open(over(u.store.local));
  await P.save(KEY, { doc: paperDoc('A first draft.') });
  const { version } = await P.save(KEY, { doc: paperDoc('The paper as submitted.') }, { reason: 'sending' });
  const p = await u.visit('doc-1');
  await p.go({ version: version.id }); await u.w.settle();
  assert.equal(p.clicks.length, 1);
  assert.equal((await P.versions(KEY)).find((v) => v.id === version.id)?.reason, 'submit');
  assert.ok((await P.get(KEY)).submitted, 'the paper is submitted');
  assert.ok((await P.list()).find((r) => r.key === KEY).submitted, 'and the Papers page says so');
});

test('D5: a page run that stops before the click marks nothing', async () => {
  const u = ultra(), P = PA.open(over(u.store.local));
  await P.save(KEY, { doc: paperDoc('A first draft.') });
  const { version } = await P.save(KEY, { doc: paperDoc('The paper.') }, { reason: 'sending' });
  const p = await u.visit('doc-1', { enabled: false });
  await p.go({ version: version.id }); await p.tick(16000); await u.w.settle();
  assert.deepEqual(done(p), ['submit']);
  assert.equal((await P.get(KEY)).submitted, undefined);
});

test('D5: the version actually submitted stays however many submits fail after it', async () => {
  const clock = { t: 0 }, P = PA.open(over(), () => clock.t, { versions: () => 10 });
  await P.save(KEY, { doc: paperDoc('A first draft.') });
  clock.t += 1000;
  const { version } = await P.save(KEY, { doc: paperDoc('The paper as submitted.') }, { reason: 'sending' });
  await P.submitted(KEY, version.id);
  for (let i = 0; i < 30; i++) {
    clock.t += 11 * 60e3;
    await P.save(KEY, { doc: paperDoc(`Revision ${i}.`) }, { reason: i % 3 ? 'auto' : 'sending' });
  }
  const list = await P.versions(KEY);
  assert.equal(list.length, 10);
  assert.ok(list.some((v) => v.id === version.id && v.reason === 'submit'), 'the submitted version is kept');
});

// The fixture's attempt: Ultra's own text box already holds a line the student typed in Blackboard's editor.
const NATIVE = 'Toni Morrison\'s Beloved treats memory less as a record than as a debt.';
const boxText = (p) => [...p.box.editor.children].map((c) => c.textContent).join('\n');

test('D4: the page tells the sheet what Ultra\'s text box holds', async () => {
  const p = page();
  p.hear({ type: 'submit:held' });
  assert.deepEqual(p.sent.filter((m) => m.type === 'submit:held').map((m) => m.text), [NATIVE]);
});

for (const shown of [true, false]) {
  test(`D4: with Keep off, what Ultra's text box held never goes with the paper (${shown ? 'shown on the sheet' : 'a sheet that did not say'})`, async () => {
    const p = page();
    await p.go({ note: '', text: null, ...(shown && { held: NATIVE, keep: false }) });
    assert.deepEqual(done(p), ['ok']);
    assert.equal(boxText(p), '', 'emptied before Ultra\'s Submit');
    const q = page();
    await q.go({ note: 'Hi Professor', text: null, ...(shown && { held: NATIVE, keep: false }) });
    assert.equal(boxText(q), 'Hi Professor', 'the note in its place');
  });
}

test('D4: with Keep on, Ultra\'s text box goes as the sheet showed it, the note after it', async () => {
  const p = page();
  const before = p.box.editor.innerHTML;
  await p.go({ note: '', text: null, held: NATIVE, keep: true });
  assert.deepEqual(done(p), ['ok']);
  assert.equal(p.box.editor.innerHTML, before, 'left as it was, its own formatting too');
  const q = page();
  await q.go({ note: 'Hi Professor', text: null, held: NATIVE, keep: true });
  assert.equal(boxText(q), `${NATIVE}\n\nHi Professor`);
});

test('D4: Keep on for text Ultra\'s box no longer holds stops before anything is attached', async () => {
  const p = page();
  p.setText('A different draft\n');
  await p.go({ note: '', text: null, held: NATIVE, keep: true });
  assert.deepEqual(done(p), ['page']);
  assert.equal(p.uploads.length + p.clicks.length, 0);
});

test('D4: the sheet shows what Ultra\'s text box holds, with Keep off, and sends the student\'s choice', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const s = sheet(); await s.open(); s.builds[0].resolve(); await s.flush();
  assert.ok(s.messages.some((m) => m.type === 'submit:held'), 'the sheet asks the page');
  s.handles['submit:held']({ text: NATIVE }); await s.flush();
  const keep = s.doc.querySelector('#gs-keep');
  assert.ok(keep, 'a Keep switch');
  assert.equal(keep.getAttribute('aria-checked'), 'false');
  assert.equal(s.doc.querySelector('#gs-held').value, NATIVE, 'the text itself, to read');
  s.click('.gs-primary'); await s.flush();
  let go = s.messages.filter((m) => m.type === 'submit:go').at(-1);
  assert.equal(go.held, NATIVE);
  assert.equal(go.keep, false);
  s.handles['submit:done']({ run: go.run, ok: false, error: 'submit' }); await s.flush();
  assert.equal(s.messages.filter((m) => m.type === 'submit:held').length, 2, 'asked again after a failure');
  s.click('#gs-keep');
  s.click('.gs-primary'); await s.flush();
  // The first hand-in transfers its buffer; an explicit retry builds fresh bytes.
  s.builds.at(-1).resolve(); await s.flush();
  go = s.messages.filter((m) => m.type === 'submit:go').at(-1);
  assert.equal(go.keep, true);
});

test('D4: an empty text box shows no Keep switch', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const s = sheet(); await s.open();
  s.handles['submit:held']({ text: '' }); await s.flush();
  assert.equal(s.doc.querySelector('#gs-keep'), null);
});

test('D8: while a paper\'s frame reopens, Ultra\'s Submit still waits for Writer, and the new frame opens the sheet', async () => {
  const p = page();
  // writer/page/writer.js reopen(): the old frame and port gone, a new pass asked for.
  p.box.reopening = true; p.box.ready = false; p.box.frame.remove(); p.box.frame = null; const port = p.box.port; p.box.port = null;
  const during = p.fire(p.button(), 'click');
  assert.ok(during.stopped, 'Ultra never hears a Submit pressed while the frame reopens');
  assert.ok(!p.clicks.includes(p.button()));
  // open(): the new frame is in the page, its port made, not ready yet.
  p.box.reopening = false; p.box.frame = new (require('../stand-in-dom.js').El)('iframe', p.doc); p.doc.body.append(p.box.frame); p.box.port = port; p.sent.length = 0;
  const after = p.fire(p.button(), 'click');
  assert.ok(after.stopped);
  await p.tick(100);
  assert.deepEqual(p.sent, [], 'nothing asked of a frame not up yet (its port may yet be dropped)');
  p.box.ready = true;
  await p.tick(100);
  assert.deepEqual(p.sent.map((m) => m.type), ['submit:open'], 'the new frame opens the submit sheet once it is up, once for both presses');
});

test('D2: a page opened after a Writer submit went out is free, however late the worker gets to recording it', async () => {
  const u = ultra(), m = { type: 'glaze:writerSubmit', token: 'a'.repeat(36), user: '_900_1' };
  await u.visit('doc-1', {}, { tab: 1 });
  assert.equal((await u.w.send({ ...m, op: 'claim' }, u.sender())).ok, true);
  const committing = u.w.send({ ...m, op: 'commit' }, u.sender());
  // A new tab opens the assignment while the commit still waits its turn in the worker.
  Object.assign(u.at, { doc: 'doc-5', tab: 3 });
  await u.w.send({ type: 'glaze:attempt-kind', kind: 'assignment', page: u.at.url }, u.sender());
  assert.equal((await committing).ok, true);
  assert.equal((await u.w.send({ ...m, token: 'e'.repeat(36), op: 'claim' }, u.sender())).ok, true, 'the new page is the next attempt');
});

test('a Submit pressed before the page has said which assignment this is waits for it, so the sheet and its .docx name it', async () => {
  const sheet = require('../helpers/writer-submit-sheet.cjs');
  const s = sheet();
  let context = {};
  s.api.context = () => context;
  const opening = s.open(); await s.flush();
  assert.ok(!s.doc.querySelector('.gs-layer'), 'no sheet yet: it would name no assignment');
  context = { assignment: { title: 'Essay 2: Memory in Beloved' } };
  for (const [n, f] of [...s.timers]) { s.timers.delete(n); f(); }
  await opening; await s.flush();
  assert.equal(s.doc.querySelector('.gs-layer h2')?.textContent, 'Submit Essay 2');
});
