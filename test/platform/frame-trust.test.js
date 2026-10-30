// Which frames the worker (lib/background.js) trusts. Course tabs and the Settings page of an LMS tab are frames, so the
// checks that once said "top frame" now say what the frame is: Download all's port from a course tab's frame on the tab's own
// site, and nicknames, Look media and the pet library from the Settings frame that claimed its ticket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const worker = require('./helpers/worker-env.cjs');

const CANVAS = 'https://school.instructure.com', OTHER = 'https://other.instructure.com', EXT = 'chrome-extension://x';

// ---- Download all (CVM-1) ----------------------------------------------------------------------------------------------
const course = (extra = {}) => ({ id: 'glaze', frameId: 3, url: `${CANVAS}/courses/25/modules`, origin: CANVAS, tab: { id: 7, url: `${CANVAS}/` }, ...extra });
const file = (type = 'file') => ({ type, url: `${CANVAS}/files/9/download?verifier=a` });
const fetchOnce = async () => ({ ok: true, url: 'https://files.instructure.com/9', headers: { get: () => '3' },
  body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array([1, 2, 3]) })), cancel: async () => {} }; } } });

test('Download all: a course tab\'s frame on the tab\'s own Canvas site gets the byte port, the top frame still does', async () => {
  const w = worker({ fetch: fetchOnce });
  for (const sender of [course({ frameId: 0, tab: { id: 7, url: `${CANVAS}/courses/25/modules` } }), course(), course({ url: `${CANVAS}/courses/25` })]) {
    const { port, say } = w.connect('canvas-zip', sender);
    await w.settle();
    assert.equal(port.hungUp, false, sender.url);
    say({ type: 'ping' }); say(file());
    await w.settle();
    assert.deepEqual(port.posted.map((m) => m.type), ['ping', 'chunk'], 'the file is streamed');
    say({ type: 'ack' });
    await w.settle();
    assert.equal(port.posted.at(-1).type, 'done');
  }
});

test('Download all: any other frame is refused before it can ask for a file', async () => {
  const w = worker({ fetch: fetchOnce });
  const refused = [
    ['another site than its tab', course({ url: `${OTHER}/courses/25/modules`, origin: OTHER })],
    ['a tab whose page is on another site', course({ tab: { id: 7, url: `${OTHER}/` } })],
    ['no address for its tab', course({ tab: { id: 7 } })],
    ['not a course page', course({ url: `${CANVAS}/courses/25/files` })],
    ['no tab', course({ tab: undefined })],
    ['another extension', course({ id: 'other' })],
    ['opaque sandbox origin', course({ origin: 'null' })],
    ['origin disagrees with URL', course({ origin: OTHER })],
    ...['about:blank', 'about:srcdoc', `blob:${CANVAS}/courses/25`, `data:text/html,/courses/25`].map((url) => [url, course({ url })]),
    ['a frame of no number', course({ frameId: undefined })],
    ['the top frame of a page that is not a course', course({ frameId: 0, url: `${CANVAS}/`, tab: { id: 7, url: `${CANVAS}/` } })],
  ];
  for (const [why, sender] of refused) {
    const { port, say } = w.connect('canvas-zip', sender);
    await w.settle();
    say(file());
    await w.settle();
    assert.equal(port.hungUp, true, why);
    assert.ok(!port.posted.some((m) => m.type === 'chunk'), `${why}: nothing is fetched`);
  }
});

// ---- Settings inside an LMS page (CORE-6) ---------------------------------------------------------------------------------
const page = { id: 'glaze', frameId: 0, url: `${CANVAS}/courses/1`, tab: { id: 4, url: `${CANVAS}/courses/1` } };
const frame = (extra = {}) => ({ id: 'glaze', frameId: 7, url: `${EXT}/options.html#look/courses`, origin: EXT, documentId: 'doc-7', tab: { id: 4, url: `${CANVAS}/courses/1` }, ...extra });
const editorTab = { id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 2, url: `${EXT}/options.html` } };
const claim = async (w, sender = frame()) => {
  const { ticket } = await w.send({ type: 'glaze:settings-ticket' }, page);
  return w.send({ type: 'glaze:settings-claim', ticket }, sender);
};
const asks = (w) => ({
  nickname: (s) => w.send({ type: 'glaze:courseName', id: '_12_1', name: 'Bio' }, s),
  media: (s) => w.send({ type: 'glaze:media', op: 'list' }, s),
  pets: (s) => w.send({ type: 'glaze:petSprites', op: 'list' }, s),
});

test('Settings in an LMS page saves nicknames, Look media and the pet library once its frame claimed the ticket', async () => {
  const w = worker();
  const ask = asks(w);
  for (const [what, f] of Object.entries(ask)) assert.equal((await f(frame())).error, 'sender', `${what}: a frame with no ticket`);
  assert.deepEqual(await claim(w), { ok: true });
  assert.equal((await ask.nickname(frame())).ok, true);
  assert.equal(w.store.sync.courses.names._12_1, 'Bio');
  assert.equal((await ask.media(frame())).ok, true);
  assert.equal((await ask.pets(frame())).ok, true);
  for (const [what, f] of Object.entries(ask)) assert.equal((await f(editorTab)).ok, true, `${what}: Settings in a tab of its own is as before`);
});

test('only the frame that claimed the ticket, in the tab it claimed it for, is trusted', async () => {
  const w = worker();
  const ask = asks(w);
  await claim(w);
  const refused = [
    ['another frame of the tab', frame({ frameId: 8, documentId: 'doc-8' })],
    ['the same frame as another document', frame({ documentId: 'doc-9' })],
    ['the same frame number in another tab', frame({ tab: { id: 5, url: `${CANVAS}/courses/1` } })],
    ['another extension', frame({ id: 'other' })],
    ['an extension page that is not Settings', frame({ url: `${EXT}/preview.html` })],
    ['Settings from another origin', frame({ origin: 'https://evil.example' })],
    ['a frame of the school\'s page', { ...page, frameId: 7, url: `${CANVAS}/embed` }],
  ];
  for (const [why, sender] of refused) for (const [what, f] of Object.entries(ask)) assert.equal((await f(sender)).error, 'sender', `${what}: ${why}`);
});

test('a claimed Settings frame is still trusted after the worker restarts, and not after its tab closes', async () => {
  const first = worker();
  await claim(first);
  const again = worker({ store: first.store });
  assert.equal((await asks(again).nickname(frame())).ok, true, 'the worker slept while Settings stayed open');
  for (const f of again.removed) f(4);
  await again.settle();
  assert.equal((await asks(again).nickname(frame())).error, 'sender');
  const later = worker({ store: first.store });
  assert.equal((await asks(later).nickname(frame())).error, 'sender', 'nothing about it outlives the tab');
});

test('without session storage the claim is still kept while the worker runs', async () => {
  const w = worker({ session: false });
  assert.deepEqual(await claim(w), { ok: true });
  assert.equal((await asks(w).nickname(frame())).ok, true);
  for (const f of w.removed) f(4);
  assert.equal((await asks(w).nickname(frame())).error, 'sender');
});

test('unrelated broker operations do not wait for Settings session restoration', async () => {
  const w = worker({ sessionArea: { get: () => new Promise(() => {}) } });
  const result = await Promise.race([asks(w).nickname(editorTab), new Promise((r) => setTimeout(() => r('stalled'), 80))]);
  assert.equal(result.ok, true);
});

test('a late session restore cannot revive a grant for a closed tab', async () => {
  let restore;
  const w = worker({ sessionArea: { get: () => new Promise((r) => { restore = r; }), remove: async () => {} } });
  await w.settle();
  for (const f of w.removed) f(4);
  restore({ 'settingsFrame:4': { frameId: 7, documentId: 'doc-7' } });
  assert.equal((await asks(w).nickname(frame())).error, 'sender');
});

test('a failed session write does not grant the Settings frame permission', async () => {
  const w = worker({ sessionArea: { get: async () => ({}), set: async () => { throw Error('unavailable'); }, remove: async () => {} } });
  assert.deepEqual(await claim(w), { ok: false });
  assert.equal((await asks(w).nickname(frame())).error, 'sender');
});

test('Settings tickets expire, cannot be replayed, and work without document ids', async () => {
  const w = worker();
  const sender = frame({ documentId: undefined });
  const { ticket } = await w.send({ type: 'glaze:settings-ticket' }, page);
  assert.deepEqual(await w.send({ type: 'glaze:settings-claim', ticket }, sender), { ok: true });
  assert.equal((await asks(w).nickname(sender)).ok, true);
  assert.deepEqual(await w.send({ type: 'glaze:settings-claim', ticket }, frame({ frameId: 8 })), { ok: false });
  const next = await w.send({ type: 'glaze:settings-ticket' }, page);
  const now = Date.now();
  w.context.Date = class extends Date { static now() { return now + 60001; } };
  assert.deepEqual(await w.send({ type: 'glaze:settings-claim', ticket: next.ticket }, frame({ frameId: 8 })), { ok: false });
  assert.equal((await asks(w).nickname(frame({ frameId: 8 }))).error, 'sender');
});

test('session read failure fails closed for a restored frame while top Settings still saves', async () => {
  const w = worker({ sessionArea: { get: async () => { throw Error('unavailable'); } } });
  assert.equal((await asks(w).nickname(frame())).error, 'sender');
  assert.equal((await asks(w).nickname(editorTab)).ok, true);
});

test('a frame is untrusted while its grant write is pending and after tab close during that write', async () => {
  let persist;
  const store = {};
  const w = worker({ sessionArea: { get: async () => ({}), set: (v) => new Promise((r) => { persist = () => { Object.assign(store, v); r(); }; }),
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; } } });
  const claiming = claim(w);
  await w.settle();
  assert.equal((await asks(w).nickname(frame())).error, 'sender');
  for (const f of w.removed) f(4);
  persist();
  assert.deepEqual(await claiming, { ok: false });
  assert.equal((await asks(w).nickname(frame())).error, 'sender');
  assert.deepEqual(store, {});
});

test('a claimed Settings frame is trusted for those three writes only, never for mods, sharing or a restore', async () => {
  const w = worker();
  await claim(w);
  assert.equal((await w.send({ type: 'glaze:mods', op: 'list', id: 'mabcdefghijklmn0' }, frame())).error, 'sender');
  assert.equal((await w.send({ type: 'glaze:sessions', op: 'list' }, frame())).error, 'sender');
  assert.equal((await w.send({ type: 'glaze:mods', op: 'list', id: 'mabcdefghijklmn0' }, editorTab)).error !== 'sender', true, 'a Settings tab of its own may');
  assert.equal((await w.send({ type: 'glaze:todo', restore: { tasks: {}, folders: {}, settings: {} } }, frame())).error, 'sender');
});

test('a nickname the worker refuses for its sender says to open Settings in its own tab, not that there is too much to sync', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
  const start = source.indexOf("nickname.addEventListener('change', ");
  const handler = source.slice(start + "nickname.addEventListener('change', ".length, source.indexOf('\n        });', start) + '\n        }'.length);
  const run = async (reply) => {
    const hints = [];
    const ctx = vm.createContext({ id: '_12_1', nickname: { value: 'Bio' }, s: {}, flush() {}, renderCourses() {}, refresh() {}, t: (x) => x, hint: (text, bad) => hints.push([text, !!bad]),
      chrome: { runtime: { sendMessage: async () => reply } } });
    await vm.runInContext(`(${handler})()`, ctx);
    return hints;
  };
  assert.deepEqual(await run({ ok: false, error: 'sender' }), [['Open Settings in its own tab.', true]]);
  assert.deepEqual(await run({ ok: false }), [['Too much to sync. Shorten a nickname or clear one.', true]], 'a name over the sync size still says so');
  assert.deepEqual(await run({ ok: true, courses: {} }), [['Saved', false]]);
});
