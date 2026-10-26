// The worker's part of a restore (lib/background.js 'glaze:backup', lib/backup.js apply): only Settings' own top frame
// writes a backup's records.
const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('./helpers/worker-env.cjs');

const EXT = 'chrome-extension://x', SITE = 'https://school.instructure.com';
const editor = { id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 2, url: `${EXT}/options.html` } };
const restore = {
  dashNotes: { [`notes:${SITE}/5`]: { text: 'MARK-DASHBOARD-NOTE', at: Date.now() - 1000 } },
  classes: { [`classes:${SITE}/5`]: { tz: 'America/New_York', courses: [{ id: '25', name: 'MARK-SCHEDULE', at: Date.now() - 1000, periods: [{ days: [1], start: 540, end: 600 }] }] } },
  gpa: { [`gpaTerms:${SITE}:5`]: { t: [{ id: 'termone', n: 'MARK-PAST-TERM', c: [], at: Date.now() - 1000 }] } },
  notes: [`notesIdx:${SITE}/5`],
};

test("Settings in its own tab restores a backup's records; its frame, a school page or another extension cannot", async () => {
  const w = worker();
  for (const s of [{ ...editor, origin: SITE }, { ...editor, url: `${EXT}/popup.html` }, { ...editor, frameId: 3 }, { ...editor, id: 'other' }, { id: 'glaze', frameId: 0, url: `${SITE}/`, origin: SITE, tab: { id: 7, url: `${SITE}/` } }]) {
    assert.deepEqual(await w.send({ type: 'glaze:backup', restore }, s), { ok: false, error: 'sender' }, JSON.stringify(s));
  }
  assert.equal(w.store.local[`notes:${SITE}/5`], undefined);
  assert.deepEqual(await w.send({ type: 'glaze:backup', restore }, editor), { ok: true });
  assert.equal(w.store.local[`notes:${SITE}/5`].text, 'MARK-DASHBOARD-NOTE');
  assert.equal(w.store.local[`classes:${SITE}/5`].courses[0].periods[0].tz, 'America/New_York');
  assert.equal(w.store.local[`gpaTerms:${SITE}:5`].t[0].n, 'MARK-PAST-TERM');
  assert.deepEqual(w.store.local[`notesIdx:${SITE}/5`], { notes: {}, folders: {}, gone: {} });
  assert.deepEqual(await w.send({ type: 'glaze:backup', restore: { other: 1 } }, editor), { ok: false, error: 'bad' });
});

test('the Firefox package loads the backup library with the worker', () => {
  const src = require('node:fs').readFileSync(require.resolve('../lib/background.js'), 'utf8');
  assert.match(src, /importScripts\('backup\.js'\)/);
});

test('staged restores belong to one Settings document and merge against commit-time data', { timeout: 3000 }, async () => {
  const w = worker(), values = new Map();
  await w.send({ type: 'glaze:backup', restore: {} }, editor);
  let closed = 0;
  w.context.GZ_BACKUP.scratch = async () => ({ get: async (k) => structuredClone(values.get(k)), put: async (k, v) => { values.set(k, structuredClone(v)); }, clear: async () => values.clear(), close: () => { closed++; } });
  const send = (r, s = editor) => w.send({ type: 'glaze:backup', restore: r }, s);
  const { token } = await send({ op: 'begin' });
  assert.ok(token);
  assert.equal((await send({ op: 'begin' })).error, 'busy');
  assert.equal((await send({ op: 'stage', token, action: 'own', value: restore }, { ...editor, tab: { id: 9 } })).error, 'bad');
  assert.equal((await send({ op: 'stage', token: 'wrong', action: 'own', value: restore })).error, 'bad');
  assert.equal((await send({ op: 'stage', token, action: 'own', value: restore })).ok, true);
  assert.equal(w.store.local[`notes:${SITE}/5`], undefined, 'staging writes no user records');
  const newer = { text: 'typed while picking the backup', at: Date.now() };
  w.context.writeFromSession = () => { w.store.local[`notes:${SITE}/5`] = newer; };
  require('node:vm').runInContext(`(sessionTurn ||= GZ_CARDS.queue())(async () => {
    await new Promise((resolve) => { globalThis.finishSession = resolve; });
    await (brokerTurn ||= GZ_CARDS.queue())(writeFromSession);
  });`, w.context);
  await w.settle();
  const committing = send({ op: 'commit', token });
  await w.settle();
  assert.equal(w.store.local[`notes:${SITE}/5`], undefined, 'commit waits outside the storage queue for the current session');
  w.context.finishSession();
  assert.equal((await committing).ok, true);
  assert.deepEqual(w.store.local[`notes:${SITE}/5`], newer);
  assert.equal(values.size, 0);
  assert.equal(closed, 1);
  assert.equal((await send({ op: 'commit', token })).error, 'sender');
});
