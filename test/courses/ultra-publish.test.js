const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('../helpers/worker-env.cjs');
const O = 'https://school.blackboard.com', uid = '_900_1';
const from = (id = 1) => ({ id: 'glaze', frameId: 0, tab: { id }, url: `${O}/ultra/course` });
const begin = async (w) => (await w.send({ type: 'glaze:ultraMine', op: 'begin', fence: '/' }, from()))?.epoch;
const save = (w, epoch, key, value, at) => w.send({ type: 'glaze:ultraMine', op: 'save', epoch, key, value, at }, from());

test('gradebook publishes merge courses across frames and reject late older rows', async () => {
  const w = worker(), epoch = await begin(w), key = `ultraBooks:${O}/${uid}`, now = Date.now();
  await save(w, epoch, key, { _101_1: { at: now, rows: [{ status: 'Graded' }] } }, now);
  await save(w, epoch, key, { _102_1: { at: now, rows: [] } }, now);
  await save(w, epoch, key, { _101_1: { at: now - 1, rows: [{ status: 'NeedsGrading' }] } }, now - 1);
  assert.deepEqual(Object.keys(w.store.local[key]).sort(), ['_101_1', '_102_1']);
  assert.equal(w.store.local[key]._101_1.rows[0].status, 'Graded');
});

test('identity and membership publishes use request order, not arrival order', async () => {
  const w = worker(), epoch = await begin(w), now = Date.now(), key = `ultraMe:${O}`;
  await save(w, epoch, key, { uid, courses: [{ id: '_101_1', name: 'New' }] }, now);
  await save(w, epoch, key, { uid, courses: [{ id: '_101_1', name: 'Old' }] }, now - 1);
  await w.send({ type: 'glaze:ultraMine', op: 'put', epoch, mine: { uid, mem: [{ courseId: '_101_1' }], read: now } }, from());
  await w.send({ type: 'glaze:ultraMine', op: 'put', epoch, mine: { uid, mem: [], read: now - 1 } }, from(2));
  assert.equal(w.store.local[key].courses[0].name, 'New');
  assert.equal(w.store.session[`ultraMine:${O}`].mem.length, 1);
  assert.equal(w.store.session[`ultraMine:${O}`].read, now);
});

test('sign-out and disable purge all Ultra data and reject delayed publishes', async (t) => {
  for (const reason of ['sign-out', 'disable', 'reset']) await t.test(reason, async () => {
    const w = worker(), epoch = await begin(w), now = Date.now(), key = `ultraBooks:${O}/${uid}`;
    Object.assign(w.store.local, { [key]: { _101_1: { at: now, rows: [] } }, [`ultraMe:${O}`]: { uid }, todoCache: { key: `todo:${O}/${uid}` } });
    w.store.session[`ultraMine:${O}`] = { uid, mem: [], read: now };
    if (reason === 'sign-out') await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from());
    else if (reason === 'disable') { await w.context.chrome.storage.sync.set({ enabled: false }); await w.settle(); }
    else await w.send({ type: 'glaze:sites', op: 'reset' }, { id: 'glaze', frameId: 0, url: 'chrome-extension://x/options.html' });
    await save(w, epoch, key, { _101_1: { at: now, rows: [] } }, now);
    await w.send({ type: 'glaze:ultraMine', op: 'put', epoch, mine: { uid, mem: [], read: now } }, from());
    assert.equal(w.store.local[key], undefined);
    assert.equal(w.store.local[`ultraMe:${O}`], undefined);
    assert.equal(w.store.local.todoCache, undefined);
    assert.equal(w.store.session[`ultraMine:${O}`], undefined);
  });
});

test('an older instant copy cannot overwrite a newer visit', async () => {
  const w = worker(), { epoch } = await w.send({ type: 'glaze:ultraCopy', op: 'begin' }, from()), now = Date.now();
  const record = { v: 1, uid, kind: 'grades', at: now, nodes: ['New'] };
  await w.send({ type: 'glaze:ultraCopy', op: 'put', epoch, record }, from());
  await w.send({ type: 'glaze:ultraCopy', op: 'put', epoch, record: { ...record, at: now - 1, nodes: ['Old'] } }, from(2));
  assert.deepEqual(w.store.local[`ultraCopy:${O}/${uid}/grades`].nodes, ['New']);
});

test('an Ultra planner reply issued before sign-out cannot recreate the To Do cache', async () => {
  const w = worker(), epoch = await begin(w), now = Date.now(), key = `todo:${O}/${uid}`;
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from());
  await w.send({ type: 'glaze:todo', key, cache: { key, at: now, epoch, items: [] } }, from());
  assert.equal(w.store.local.todoCache, undefined);
});

test('local Ultra copies still save when session storage is unavailable', async () => {
  const w = worker({ session: false }), epoch = await begin(w), now = Date.now(), key = `ultraBooks:${O}/${uid}`;
  await save(w, epoch, key, { _101_1: { at: now, rows: [] } }, now);
  await save(w, epoch, `ultraMe:${O}`, { uid }, now);
  assert.ok(w.store.local[key]?._101_1);
  assert.equal(w.store.local[`ultraMe:${O}`]?.uid, uid);
});

test('due-week publishes cannot replace a newer list or recreate one after sign-out', async () => {
  const w = worker(), at = Date.now() - 10, key = `dueWeek:${O}`;
  const put = (time, title) => w.send({ type: 'glaze:ultraMine', op: 'week', at: time, list: [{ title }] }, from());
  await put(at + 1, 'New'); await put(at, 'Old');
  assert.equal(w.store.local[key]?.list[0].title, 'New');
  await w.send({ type: 'glaze:ultraCopy', op: 'drop' }, from());
  await put(at, 'Old');
  assert.equal(w.store.local[key], undefined);
});
