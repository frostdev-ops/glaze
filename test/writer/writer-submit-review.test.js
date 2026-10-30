const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('../helpers/writer-submit-page.cjs');

test('review: replayed or renewed sheet runs cannot click Ultra Submit twice, even after footer remount', async () => {
  const p = page();
  await p.go();
  assert.equal(p.clicks.length, 1);
  const old = p.button(), fresh = old.cloneNode(true);
  fresh.setAttribute('data-analytics-id', old.getAttribute('data-analytics-id'));
  fresh.getClientRects = () => [{}]; old.replaceWith(fresh);
  await p.go();
  await p.go({ run: 2 });
  assert.equal(p.clicks.length, 1, 'the native submit was already dispatched for this attempt');
});

test('review: worker serializes a durable attempt claim across tabs and worker restarts', async () => {
  const make = require('../helpers/worker-env.cjs');
  const worker = (opts) => make({ ...opts, ...(process.env.WRITER_SUBMIT_WORKER_SOURCE && { background: require('node:fs').readFileSync(process.env.WRITER_SUBMIT_WORKER_SOURCE, 'utf8') }) });
  const store = { sync: { enabled: true, enhance: { writer: true } }, local: { ultra: [] }, session: {} };
  const w = worker({ store });
  const url = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  const sender = (id) => ({ id: 'glaze', url, frameId: 0, documentId: `doc-${id}`, tab: { id, url } });
  const m = { type: 'glaze:writerSubmit', op: 'claim', token: 'a'.repeat(36), user: '_900_1' };
  w.context.chrome.tabs.get = async (id) => sender(id).tab;
  w.context.chrome.scripting.executeScript = async ({ target }) => [{ frameId: 0, documentId: `doc-${target.tabId}`, result: { href: url, origin: 'https://school.blackboard.com', ancestors: [] } }];
  assert.equal((await w.send({ type: 'glaze:attempt-kind', kind: 'assignment' }, sender(1))).ok, true);
  await w.send({ type: 'glaze:attempt-kind', kind: 'assignment' }, sender(2));
  const both = await Promise.all([w.send(m, sender(1)), w.send({ ...m, token: 'b'.repeat(36) }, sender(2))]);
  assert.equal(both.filter((r) => r?.ok).length, 1, 'only one tab may attach and submit');
  const winner = both[0]?.ok ? 1 : 2, token = winner === 1 ? m.token : 'b'.repeat(36);
  assert.equal((await w.send({ ...m, op: 'commit', token }, sender(winner))).ok, true);
  const restarted = worker({ store });
  assert.equal((await restarted.send({ ...m, token: 'c'.repeat(36) }, sender(2))).ok, false, 'a dispatched attempt stays fenced after MV3 restart');
  assert.equal((await restarted.send(m, { ...sender(4), id: 'other' })).ok, false);
});

test('review: an edited retry never submits cached bytes or uploads a second copy', async () => {
  const p = page({ enabled: false });
  await p.go();
  await p.tick(16000);
  assert.equal(p.uploads.length, 1);
  p.setEnabled(true);
  await p.go({ run: 2, bytes: new Uint8Array([9, 8, 7]).buffer });
  assert.equal(p.clicks.length, 0, 'the listed bytes belong to the earlier paper');
  assert.equal(p.uploads.length, 1, 'changed bytes require review in Blackboard, never a second attachment');
});

test('review: a timed-out upload is not repeated when the student retries', async () => {
  const p = page({ listed: false });
  await p.go(); await p.tick(31000);
  await p.go({ run: 2 });
  assert.equal(p.uploads.length, 1, 'the first upload may still finish in Ultra');
  assert.equal(p.clicks.length, 0);
});

test('review: a pre-existing filename is a conflict', async () => {
  const existing = page(); existing.addRow('Rivera_Essay2.docx');
  await existing.go();
  assert.equal(existing.uploads.length, 0, 'do not add a second same-named attachment');
  assert.equal(existing.clicks.length, 0);
});

test('review: unrelated properties dialogs are never saved', async () => {
  const p = page({ listed: false });
  const { El } = require('../stand-in-dom.js');
  const dialog = new El('div', p.doc), save = new El('button', p.doc);
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-labelledby', 'file-properties-dialog-title');
  save.setAttribute('data-analytics-id', 'editor.modelEditAttachment.dialogFooter.save.button');
  dialog.append(save); p.doc.body.append(dialog);
  await p.go();
  assert.equal(p.clicks.includes(save), false, 'a dialog from another attachment is not this run');
});

test('review: hand-back while the React input mounts stops every later upload', async () => {
  const p = page(); const area = p.input.parentElement;
  p.input.remove(); await p.go();
  p.own(false); area.append(p.input); await p.tick(2000);
  assert.equal(p.uploads.length, 0, 'ownership must be rechecked after waiting for the input');
  assert.equal(p.clicks.length, 0);
});

test('review: changed native text while Submit enables never sends a partial note', async () => {
  const p = page({ enabled: false });
  await p.go({ note: 'The whole note.' });
  p.setText('The whole'); p.setEnabled(true); await p.tick();
  assert.equal(p.clicks.length, 0, 'verify the native text again immediately before Submit');
});

test('review: Save and Close replies are correlated, including timers and double clicks', async () => {
  const p = page(); const L = require('../../extension/lib/writer-submit.js'), b = L.footer(p.box.editor).save;
  b.disabled = false; b.removeAttribute('disabled'); b.className = '';
  p.fire(b, 'click'); p.fire(b, 'click');
  const saves = p.sent.filter((m) => m.type === 'submit:save');
  assert.equal(saves.length, 1, 'coalesce a second Save and Close while saving');
  p.hear({ type: 'submit:saved', request: 'stale', ok: true });
  assert.equal(p.clicks.length, 0, 'an earlier save reply must not release this close');
  p.hear({ type: 'submit:saved', request: saves[0].request, ok: true });
  assert.equal(p.clicks.length, 1);
  assert.equal(p.uploads.length, 0);
});

test('review: cancelling the sheet while upload runs prevents the final native click', async () => {
  const p = page({ listed: false });
  await p.go(); p.hear({ type: 'submit:cancel', run: 1 });
  p.addRow('Rivera_Essay2.docx'); await p.tick();
  assert.equal(p.clicks.length, 0);
});

test('review: replacing a listed row with the same name does not prove the original upload', async () => {
  const p = page({ enabled: false }); await p.go(); await p.tick(16000);
  const L = require('../../extension/lib/writer-submit.js');
  L.listings(L.areaOf(p.box.editor), 'Rivera_Essay2.docx')[0].remove();
  p.addRow('Rivera_Essay2.docx'); p.setEnabled(true); await p.go({ run: 2 });
  assert.equal(p.clicks.length, 0, 'a replacement same-named file has unknown bytes');
});

test('review: an empty note selection on retry cannot submit the previous note', async () => {
  const p = page({ enabled: false }); await p.go({ note: 'An earlier note.' }); await p.tick(16000);
  p.setEnabled(true); await p.go({ run: 2, note: '' });
  assert.equal(p.clicks.length, 0, 'the stale note must be reviewed or removed first');
});

test('review: changing the paper identity during upload cannot submit the earlier paper', async () => {
  const p = page({ listed: false }); await p.go();
  p.box.context.paper = { ...p.box.context.paper, user: '_901_1' };
  p.addRow('Rivera_Essay2.docx'); await p.tick();
  assert.equal(p.clicks.length, 0, 'the transaction belongs to the original student and paper');
});

test('review: a frame for a different paper cannot upload into this attempt', async () => {
  const p = page(); await p.go({ key: 'school.blackboard.com|_900_1|_101_1|_99_1' });
  assert.equal(p.uploads.length, 0);
  assert.equal(p.clicks.length, 0);
});

test('review: a cancellation arriving before a delayed go still revokes that run', async () => {
  const p = page(); p.hear({ type: 'submit:cancel', run: 1 }); await p.go();
  assert.equal(p.uploads.length, 0);
  assert.equal(p.clicks.length, 0);
});

test('handIn honours here even when an identical file was already listed', async () => {
  const p = page(), file = { name: 'one.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) };
  assert.equal(await p.ctx.GZ_WRITER_SUBMIT.handIn(p.box, file), null);
  assert.equal(await p.ctx.GZ_WRITER_SUBMIT.handIn(p.box, file, () => false), 'page');
  assert.equal(p.uploads.length, 1);
});

test('handIn accepts byte views and returns codes for unreadable or failed dispatches', async () => {
  const p = page(), file = { name: 'one.pdf', mime: 'application/pdf', bytes: new Uint16Array(new Uint8Array([8, 9, 10, 11, 12, 13]).buffer, 2, 2) };
  assert.equal(await p.ctx.GZ_WRITER_SUBMIT.handIn(p.box, file), null);
  assert.deepEqual([...new Uint8Array(await p.uploads[0].arrayBuffer())], [10, 11, 12, 13]);
  assert.equal(await p.ctx.GZ_WRITER_SUBMIT.handIn(p.box, null), 'file');
  const bytes = new ArrayBuffer(3); structuredClone(bytes, { transfer: [bytes] });
  assert.equal(await p.ctx.GZ_WRITER_SUBMIT.handIn(p.box, { ...file, bytes }), 'file');
  const q = page(); q.input.dispatchEvent = () => { throw new Error('input gone'); };
  assert.equal(await q.ctx.GZ_WRITER_SUBMIT.handIn(q.box, file), 'review');
  assert.equal(q.clicks.length, 0);
});

test('a partial attachment failure names the failed file and every possible retained upload', async () => {
  const p = page({ listed: false });
  p.input.addEventListener('change', () => { if (p.uploads.length === 1) p.addRow(p.uploads[0].name); });
  await p.go({ files: [{ name: 'Notes.pdf', mime: 'application/pdf', bytes: new Uint8Array([4]).buffer }] });
  await p.tick(31000);
  assert.equal(p.clicks.length, 0);
  const failure = p.sent.filter((m) => m.type === 'submit:done').at(-1);
  assert.equal(failure.error, 'attach');
  assert.equal(failure.file, 'Notes.pdf');
  assert.deepEqual([...failure.retained], ['Rivera_Essay2.docx', 'Notes.pdf']);
});

test('replacing an earlier attachment while the last file uploads never proves the original bytes', async () => {
  const p = page({ listed: false });
  p.input.addEventListener('change', () => { if (p.uploads.length === 1) p.addRow(p.uploads[0].name); });
  await p.go({ files: [{ name: 'Notes.pdf', mime: 'application/pdf', bytes: new Uint8Array([4]).buffer }] });
  require('../../extension/lib/writer-submit.js').listings(require('../../extension/lib/writer-submit.js').areaOf(p.box.editor), 'Rivera_Essay2.docx')[0].remove();
  p.addRow('Rivera_Essay2.docx'); p.addRow('Notes.pdf'); await p.tick();
  assert.equal(p.clicks.length, 0);
});

test('compact attachment retries reuse the note once and reject earlier text changes', async () => {
  const p = page({ enabled: false }); let writes = 0;
  p.doc.addEventListener('gz-writer:append', (e) => {
    const m = JSON.parse(e.detail); writes++;
    p.setText(p.box.editor.textContent + '\n\n' + m.text + '\n');
    p.doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: true }) }));
  });
  p.setText('Original draft\n');
  const message = { name: null, bytes: null, append: true, note: 'Attached: Notes.pdf', files: [{ name: 'Notes.pdf', mime: 'application/pdf', bytes: new Uint8Array([4]).buffer }] };
  await p.go(structuredClone(message)); await p.tick(16000);
  await p.go({ ...structuredClone(message), run: 2 }); await p.tick(16000);
  assert.equal(writes, 1);
  p.setText('Changed draft\n\nAttached: Notes.pdf\n'); p.setEnabled(true);
  await p.go({ ...structuredClone(message), run: 3 });
  assert.equal(p.clicks.length, 0);
});

test('the page harness waits for an actual asynchronous digest before asserting native effects', async () => {
  let release, settled = false;
  const p = page({ hash: async (...args) => { await new Promise((r) => { release = r; }); return crypto.subtle.digest(...args); } });
  const going = p.go().then(() => { settled = true; });
  while (!release) await new Promise(setImmediate);
  assert.equal(settled, false);
  release(); await going;
  assert.equal(p.clicks.length, 1);
});
