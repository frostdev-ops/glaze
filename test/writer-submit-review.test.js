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
