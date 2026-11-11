// Settings framed in a school's page (settings/page/settingspage.js) cannot connect or disconnect Google Drive or switch Sync: the
// worker takes those from Settings' own tab only, as it takes mcp-config, mods and sessions (audit 2026-11-11 A8 #2). The account's
// status stays readable from the frame.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeIDB } = require('../helpers/fake-idb.cjs');

const EXT = 'chrome-extension://x';
const editorTab = { id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 2, url: `${EXT}/options.html` } };
const framed = (extra = {}) => ({ id: 'glaze', frameId: 7, url: `${EXT}/options.html#writer/papers`, origin: EXT, documentId: 'doc-7', tab: { id: 4, url: 'https://school.test/ultra/' }, ...extra });

const worker = () => {
  const calls = [], sync = [];
  const google = { status: async () => { calls.push('status'); return { ok: true, email: 'student@school.test', flow: 'chrome' }; },
    connect: async () => { calls.push('connect'); return { ok: true, email: 'student@school.test' }; },
    finish: async () => { calls.push('finish'); return { ok: true, email: 'student@school.test' }; },
    disconnect: async () => { calls.push('disconnect'); return { ok: true }; } };
  const w = require('../helpers/worker-env.cjs')({ globals: { ...fakeIDB(), GZ_GOOGLE_CONFIG: {}, GZ_GOOGLE: { ON: true, flowOf: () => 'chrome', create: () => google },
    GZ_DRIVE_SYNC: { create: () => ({ set: async (on) => { sync.push(on); return { ok: true }; }, poke() {} }) } } });
  return { ...w, calls, sync };
};

const ask = (w) => ({
  status: (s) => w.send({ type: 'glaze:google', op: 'status' }, s),
  connect: (s) => w.send({ type: 'glaze:google', op: 'connect' }, s),
  finish: (s) => w.send({ type: 'glaze:google', op: 'finish' }, s),
  disconnect: (s) => w.send({ type: 'glaze:google', op: 'disconnect' }, s),
  syncOn: (s) => w.send({ type: 'glaze:driveSync', op: 'set', on: true }, s),
  syncOff: (s) => w.send({ type: 'glaze:driveSync', op: 'set', on: false }, s),
});

test('Drive connect, finish, disconnect and the Sync switch are refused from Settings framed in a page, and taken from its own tab', async () => {
  const w = worker(), a = ask(w);
  for (const op of ['connect', 'finish', 'disconnect', 'syncOn', 'syncOff']) {
    const r = await a[op](framed());
    assert.equal(r.why, 'sender', `${op} from the frame`);
    assert.equal(r.ok, false);
  }
  assert.deepEqual(w.calls, [], 'nothing reached Google');
  assert.deepEqual(w.sync, [], 'Sync was not touched');
  for (const op of ['connect', 'finish', 'disconnect']) assert.equal((await a[op](editorTab)).ok, true, `${op} from Settings' own tab`);
  assert.deepEqual(w.calls, ['connect', 'finish', 'disconnect']);
  assert.equal((await a.syncOn(editorTab)).ok, true);
  assert.equal((await a.syncOff(editorTab)).ok, true);
  assert.deepEqual(w.sync, [true, false]);
});

test('the Drive account is still readable from the frame, and not from another page or extension', async () => {
  const w = worker(), a = ask(w);
  assert.equal((await a.status(framed())).email, 'student@school.test');
  assert.equal((await a.status(editorTab)).email, 'student@school.test');
  for (const sender of [framed({ id: 'other' }), framed({ url: `${EXT}/preview.html` }), { id: 'glaze', frameId: 0, url: 'https://school.test/ultra/', tab: { id: 4 } }]) {
    assert.equal((await a.status(sender)).why, 'sender');
  }
});

test('only an options page of the extension\'s own origin counts as Settings\' own tab', async () => {
  const w = worker(), a = ask(w);
  for (const [why, sender] of [['another extension', { ...editorTab, id: 'other' }], ['another origin', { ...editorTab, origin: 'https://evil.example' }],
    ['a page that is not Settings', { ...editorTab, url: `${EXT}/papers.html` }], ['a frame with no number', { ...editorTab, frameId: undefined }]]) {
    for (const op of ['connect', 'finish', 'disconnect', 'syncOn']) assert.equal((await a[op](sender)).why, 'sender', `${op}: ${why}`);
  }
  assert.deepEqual(w.calls, []);
  assert.deepEqual(w.sync, []);
});
