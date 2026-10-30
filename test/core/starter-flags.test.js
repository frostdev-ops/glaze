// The synced starterOff:* flags (lib/background.js defaultEdits and resumeDefaults) keep a removed starter from returning on a
// device whose Dashboard is still the untouched seed. They never reach a board its student has edited, and "the board was
// emptied" turns off the starter widgets only: never other widgets, never course cards.
const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('./helpers/worker-env.cjs');
const W = require('../lib/widgets.js');

const CANVAS = 'https://school.instructure.com', ULTRA = 'https://bb.example.edu', EXT = 'chrome-extension://x';
const CP = { id: 'glaze', url: `${CANVAS}/`, frameId: 0, tab: { id: 1, url: `${CANVAS}/` } };
const editor = { id: 'glaze', url: `${EXT}/options.html`, frameId: 0, origin: EXT, tab: { id: 2, url: `${EXT}/options.html` } };
const cards = [1, 2, 3].map((i) => `course:${CANVAS}/${i}`);
const STARTERS = ['pet', 'timer', 'notes', 'quotes'];
const install = async () => {
  const w = worker({ store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [ULTRA] }, session: {} } });
  w.installed[0]({ reason: 'install' }); await w.settle();
  return w;
};
const fillCards = (w) => w.send({ type: 'glaze:widgetLayout', fill: 'cdash', ops: cards.map((id) => ({ s: 'cdash', id, set: { on: true } })) }, CP);
const edit = (w, board, id, on = true) => w.send({ type: 'glaze:widgetLayout', ops: [{ s: board, id, set: { on } }] }, editor);
const on = (w, board = 'cdash') => w.store.local.widgetLayout.boards[board].filter((t) => t.on).map((t) => t.id);
// What another device's edits did to sync, arriving here.
const remote = async (w, flags) => {
  Object.assign(w.store.sync, flags);
  for (const f of w.changed) f(Object.fromEntries(Object.entries(flags).map(([k, newValue]) => [k, { newValue, oldValue: undefined }])), 'sync');
  await w.settle();
};

test('device B\'s own Dashboard survives device A emptying its Dashboard, and every flag that follows', async () => {
  const w = await install();
  await fillCards(w);
  await edit(w, 'cdash', 'agenda'); await edit(w, 'cdash', 'music');
  const before = on(w);
  assert.deepEqual(before.filter((id) => !W.course(id)).sort(), ['agenda', 'music', 'notes', 'pet', 'quotes', 'timer', 'todo']);
  await remote(w, { 'starterOff:cdash:empty': true });
  assert.deepEqual(on(w), before, 'emptied elsewhere: nothing here is turned off or removed');
  await remote(w, { 'starterOff:cdash:pet': true, 'starterOff:cdash:notes': true, [`starterOff:cdash:${cards[0]}`]: true });
  assert.deepEqual(on(w), before, 'removals made elsewhere no longer apply to a board its student has arranged');
  await w.send({ type: 'glaze:widgetTimer', op: 'advance' }, CP);
  await edit(w, 'cdash', 'breathe');
  assert.deepEqual(on(w).sort(), [...before, 'breathe'].sort(), 'nor does a later edit here bring them back');
});

test('an untouched seed follows another device\'s removals; "emptied" turns off the starters, not other widgets or course cards', async () => {
  const w = await install();
  await fillCards(w);
  assert.deepEqual(on(w).filter((id) => !W.course(id)).sort(), ['notes', 'pet', 'quotes', 'timer', 'todo']);
  await remote(w, { 'starterOff:cdash:empty': true, 'starterOff:cdash:cards': true, [`starterOff:cdash:${cards[1]}`]: true });
  assert.deepEqual(on(w).filter((id) => STARTERS.includes(id)), [], 'the starter widgets are off');
  assert.deepEqual(on(w).filter((id) => !STARTERS.includes(id)), ['todo', cards[0], cards[2]], 'To Do and the cards stay; the one card removed there goes');
  assert.ok(!w.store.local.widgetLayout.boards.cdash.some((t) => t.id === cards[1]), 'a card removed on the other device is removed here');
  assert.ok(w.store.local.widgetLayout.filled.includes('cdash'));
  assert.deepEqual(on(w, 'dash').filter((id) => STARTERS.includes(id)).sort(), STARTERS.slice().sort(), 'the other board is its own');
});

test('a board stops following the flags at its first edit while the other board still does', async () => {
  const w = await install();
  await edit(w, 'dash', 'agenda');
  assert.equal(w.store.local.freshDefaults.fresh, true, 'a first edit does not end the install\'s other defaults');
  await remote(w, { 'starterOff:dash:quotes': true, 'starterOff:cdash:quotes': true });
  assert.equal(w.store.local.widgetLayout.boards.dash.find((t) => t.id === 'quotes').on, true);
  assert.equal(w.store.local.widgetLayout.boards.cdash.find((t) => t.id === 'quotes').on, false);
});

test('an edited board is remembered across a worker restart', async () => {
  const first = await install();
  await edit(first, 'cdash', 'agenda');
  const again = worker({ store: first.store });
  await remote(again, { 'starterOff:cdash:empty': true });
  assert.ok(on(again).includes('pet') && on(again).includes('agenda'));
});

test('legacy starter layouts without edit markers keep their existing arrangement', async () => {
  const first = await install();
  await fillCards(first);
  await edit(first, 'cdash', 'agenda');
  delete first.store.local.starterTouched;
  const before = on(first);
  const again = worker({ store: first.store });
  await remote(again, { 'starterOff:cdash:empty': true, 'starterOff:cdash:pet': true });
  assert.deepEqual(on(again), before);
  assert.deepEqual(again.store.local.starterTouched, ['dash', 'cdash']);
});

test('the first edit after upgrading preserves the other legacy board too', async () => {
  const first = await install();
  await edit(first, 'dash', 'music');
  delete first.store.local.starterTouched;
  const again = worker({ store: first.store });
  await edit(again, 'cdash', 'agenda');
  await remote(again, { 'starterOff:dash:empty': true });
  assert.ok(on(again, 'dash').includes('pet'));
});

test('an edit made before the install event also counts, and only for its own board', async () => {
  const w = worker({ store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [ULTRA] }, session: {} } });
  await w.send({ type: 'glaze:widgetLayout', ops: [{ s: 'cdash', id: 'quotes', set: { on: false } }] }, CP);
  w.installed[0]({ reason: 'install' }); await w.settle();
  await remote(w, { 'starterOff:cdash:pet': true, 'starterOff:dash:pet': true });
  assert.equal(w.store.local.widgetLayout.boards.cdash.find((t) => t.id === 'pet').on, true, 'edited before the install: kept as the student left it');
  assert.equal(w.store.local.widgetLayout.boards.dash.find((t) => t.id === 'pet').on, false, 'untouched: follows');
});

test('once seeding has settled, a broker turn does not read all of sync', async () => {
  const w = await install();
  await fillCards(w);
  await w.send({ type: 'glaze:widgetTimer', op: 'advance' }, CP);
  const before = w.reads.syncAll;
  for (const op of ['toggle', 'reset', 'advance']) assert.equal((await w.send({ type: 'glaze:widgetTimer', op }, CP)).ok, true);
  assert.equal(w.reads.syncAll, before);
});
