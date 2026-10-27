const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./helpers/writer-submit-page.cjs');

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
  const make = require('./helpers/worker-env.cjs');
  const worker = (opts) => make({ ...opts, ...(process.env.WRITER_SUBMIT_WORKER_SOURCE && { background: require('node:fs').readFileSync(process.env.WRITER_SUBMIT_WORKER_SOURCE, 'utf8') }) });
  const store = { sync: { enabled: true, enhance: { writer: true } }, local: { ultra: [] }, session: {} };
  const w = worker({ store });
  const url = 'https://school.blackboard.com/ultra/courses/_101_1/assessment/_7_1/attempt/create';
  const sender = (id) => ({ id: 'glaze', url, frameId: 0, documentId: `doc-${id}`, tab: { id, url } });
  const m = { type: 'glaze:writerSubmit', op: 'claim', token: 'a'.repeat(36), user: '_900_1' };
  w.context.chrome.tabs.get = async (id) => sender(id).tab;
  w.context.chrome.scripting.executeScript = async ({ target }) => [{ documentId: `doc-${target.tabId}`, result: { href: url, origin: 'https://school.blackboard.com', ancestors: [] } }];
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
  const { El } = require('./stand-in-dom.js');
  const dialog = new El('div', p.doc), save = new El('button', p.doc);
  dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-labelledby', 'file-properties-dialog-title');
  save.setAttribute('data-analytics-id', 'editor.modelEditAttachment.dialogFooter.save.button');
  dialog.append(save); p.doc.body.append(dialog);
  await p.go();
  assert.equal(p.clicks.includes(save), false, 'a dialog from another attachment is not this run');
});
