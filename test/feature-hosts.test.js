// The features that reach hosts beyond the manifest's own, in the real worker (lib/background.js) with chrome.permissions
// stood in (test/helpers/worker-env.cjs): Canvas's Download all asks for its file server's host before the first fetch there,
// Look media and mods' network hosts are refused when the grant isn't held, and a local Canvas or Moodle runs on a held
// localhost grant alike. Without <all_urls> a fetch to a host Glaze lacks fails on CORS; here it is never made.
const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('./helpers/worker-env.cjs');

const CANVAS = 'https://school.instructure.com';
const CDN = 'inst-fs-iad.example-cdn.net';
const EXT = 'chrome-extension://x';
const course = (extra = {}) => ({ id: 'glaze', frameId: 0, url: `${CANVAS}/courses/25/modules`, origin: CANVAS, tab: { id: 7, url: `${CANVAS}/courses/25/modules` }, ...extra });
const bytes = (url, fetched) => async (u, init) => {
  fetched.push(u);
  return { ok: true, url: url || u, headers: { get: () => '3' },
    body: { getReader: () => { let sent = false; return { read: async () => (sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array([1, 2, 3]) })), cancel: async () => {} }; } } };
};
const types = (port) => port.posted.map((m) => m.type);
const posted = (port) => JSON.parse(JSON.stringify(port.posted)); // the worker's realm's objects, as plain ones

test('Download all: a file on a host Glaze lacks is asked for first, never fetched, and goes on once the host is granted', async () => {
  const fetched = [];
  const w = worker({ fetch: bytes(null, fetched) });
  const { port, say } = w.connect('canvas-zip', course());
  await w.settle();
  const file = { type: 'file', url: `https://${CDN}/files/9/doc.pdf?token=a` };
  say(file);
  await w.settle();
  assert.deepEqual(posted(port), [{ type: 'ask', host: CDN }], 'the page is told which host to ask for');
  assert.deepEqual(fetched, [], 'nothing is fetched before the grant');
  assert.equal(port.hungUp, false, 'the port waits for the student');
  assert.deepEqual(w.store.session[`allow https://${CDN}/*`] && Object.keys(w.store.session[`allow https://${CDN}/*`]).sort(), ['until'],
    'the worker notes the host was asked for a feature, so its grant is not taken for a school');
  // Still not granted (refused, or a forged answer): asked again, still nothing fetched.
  say(file);
  await w.settle();
  assert.deepEqual(types(port), ['ask', 'ask']);
  assert.deepEqual(fetched, []);
  // Granted: the same file streams.
  w.grants.add(`https://${CDN}/*`);
  say(file);
  await w.settle();
  assert.deepEqual(fetched, [file.url]);
  assert.deepEqual(types(port), ['ask', 'ask', 'chunk']);
  say({ type: 'ack' });
  await w.settle();
  assert.equal(port.posted.at(-1).type, 'done');
});

test('Download all: a host the manifest holds, or one the student holds through every site, is fetched without asking', async () => {
  for (const [url, grants] of [[`${CANVAS}/files/9/download?verifier=a`, []], [`https://${CDN}/files/9`, ['https://*/*']]]) {
    const fetched = [];
    const w = worker({ fetch: bytes(null, fetched), grants: new Set(grants) });
    const { port, say } = w.connect('canvas-zip', course());
    await w.settle();
    say({ type: 'file', url });
    await w.settle();
    assert.deepEqual(types(port), ['chunk'], url);
    assert.deepEqual(fetched, [url]);
  }
});

test('Download all: a response that lands on another host is kept when the browser let it through', async () => {
  const fetched = [];
  const w = worker({ fetch: bytes('https://uploads.example-s3.amazonaws.com/9?sig=x', fetched), grants: new Set([`https://${CDN}/*`]) });
  const { port, say } = w.connect('canvas-zip', course());
  await w.settle();
  say({ type: 'file', url: `https://${CDN}/files/9` });
  await w.settle();
  assert.deepEqual(types(port), ['chunk']);
});

test('Download all on Firefox, where a student can take a required host back: that host is asked for again', async () => {
  const fetched = [];
  const w = worker({ fetch: bytes(null, fetched), revoked: ['https://*.instructure.com/*'] });
  const { port, say } = w.connect('canvas-zip', course());
  await w.settle();
  say({ type: 'file', url: `${CANVAS}/files/9/download?verifier=a` });
  await w.settle();
  assert.deepEqual(posted(port), [{ type: 'ask', host: 'school.instructure.com' }]);
  assert.deepEqual(fetched, []);
});

test('Download all on a local Canvas: a held optional localhost grant counts, as a manifest entry does', async () => {
  const local = 'http://localhost:3000';
  const sender = course({ url: `${local}/courses/2/modules`, origin: local, tab: { id: 7, url: `${local}/courses/2/modules` } });
  const file = { type: 'file', url: `${local}/files/1/download` };
  const fetched = [];
  const held = worker({ fetch: bytes(null, fetched), grants: new Set(['http://localhost/*']) });
  const a = held.connect('canvas-zip', sender);
  await held.settle();
  assert.equal(a.port.hungUp, false, 'the port stays open on a held grant');
  a.say(file);
  await held.settle();
  assert.deepEqual(types(a.port), ['chunk']);
  const none = worker({ fetch: bytes(null, fetched) });
  const b = none.connect('canvas-zip', sender);
  await none.settle();
  assert.equal(b.port.hungUp, true, 'without the grant, no port');
});

// ---- Look media and mods' network hosts ----------------------------------------------------------------------------------
const editor = { id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 2, url: `${EXT}/options.html` } };
test('Look media at an address on a host Glaze lacks is refused before any fetch, and fetched once it is held', async () => {
  for (const [type, m] of [['glaze:remoteMedia', { src: 'https://cdn.loops.example/rain.webm', kind: 'video' }], ['glaze:lottie', { src: 'https://cdn.loops.example/rain.json' }]]) {
    const fetched = [];
    const fetch = async (u) => { fetched.push(u); throw new TypeError('Failed to fetch'); };
    const w = worker({ fetch });
    assert.deepEqual(await w.send({ type, ...m }, editor), { ok: false, error: 'host' }, type);
    assert.deepEqual(fetched, [], `${type}: no request`);
    w.grants.add('https://cdn.loops.example/*');
    assert.equal((await w.send({ type, ...m }, editor)).error, 'network', `${type}: held, the address is fetched`);
    assert.deepEqual(fetched, [m.src]);
  }
});

const MOD = 'abcdefghijklmnop';
const modRecord = () => ({
  id: MOD, enabled: true, hash: 'h1', key: 'k1', version: '1.0.0', source: 'file', installedAt: 1, dev: false,
  manifest: { glaze: 1, name: 'Weather', hooks: 'hooks.js', permissions: [{ id: 'network:api.weather.gov', why: 'w' }] },
  grants: { 'network:api.weather.gov': true }, files: { 'hooks.js': Buffer.from('glaze.ready').toString('base64') },
});
test('a mod\'s fetch to its granted network host is refused while the browser\'s grant for it isn\'t held', async () => {
  const fetched = [];
  const fetch = async (u) => { fetched.push(u); return new Response('hi', { status: 200 }); };
  const w = worker({ fetch, store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], mods: [MOD], [`mod:${MOD}`]: modRecord() }, session: {} } });
  const page = course({ url: `${CANVAS}/courses/25` });
  const ask = { type: 'glaze:mod', mod: MOD, call: 'fetch', args: ['https://api.weather.gov/points', {}], via: 'worker' };
  assert.deepEqual(await w.send(ask, page), { ok: false, error: 'permission' });
  assert.deepEqual(fetched, [], 'no request to a host the browser would refuse');
  w.grants.add('https://api.weather.gov/*');
  const r = await w.send(ask, page);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(fetched, ['https://api.weather.gov/points']);
});

// ---- Gradescope ----------------------------------------------------------------------------------------------------------
const GS = 'https://www.gradescope.com/*';
const turn = async (w, enhance, enabled = true) => { await w.context.chrome.storage.sync.set({ enabled, enhance }); await w.settle(); };
test('Gradescope: its script is registered only while the switch is on and the host is held; off, the grant goes back', async () => {
  const w = worker();
  await turn(w, { gradescope: true });
  assert.equal(w.registered.has('gz-gradescope'), false, 'on, but not held: nothing registered');
  w.grants.add(GS);
  await turn(w, { gradescope: true });
  assert.equal(w.registered.has('gz-gradescope'), true, 'on and held');
  // Glaze off as a whole: unregistered, and the grant stays for when it's on again.
  await turn(w, { gradescope: true }, false);
  assert.equal(w.registered.has('gz-gradescope'), false);
  assert.deepEqual(w.perms.removed, [], 'Glaze switched off keeps the Gradescope grant');
  await turn(w, { gradescope: true });
  assert.equal(w.registered.has('gz-gradescope'), true);
  // The switch off: unregistered, and the grant handed back.
  await turn(w, { gradescope: false });
  assert.equal(w.registered.has('gz-gradescope'), false);
  assert.deepEqual(w.perms.removed, [GS]);
  assert.equal(w.grants.has(GS), false);
});

test('Gradescope: the switch off hands back only a grant for Gradescope itself, never every site\'s', async () => {
  const w = worker({ grants: new Set(['https://*/*']) });
  await turn(w, { gradescope: true });
  assert.equal(w.registered.has('gz-gradescope'), true, 'held through every site');
  await turn(w, { gradescope: false });
  assert.deepEqual(w.perms.removed, []);
  assert.equal(w.grants.has('https://*/*'), true);
});

// ---- local Canvas and Moodle ---------------------------------------------------------------------------------------------
const rail = (url) => ({ type: 'glaze:navbar', patch: { rail: 'icons' } });
test('a local Moodle and a local Canvas run alike on a held localhost or 127.0.0.1 grant, and not without it', async () => {
  for (const [origin, grant] of [['http://localhost:8081', 'http://localhost/*'], ['http://127.0.0.1:8081', 'http://127.0.0.1/*'], ['http://localhost:3000', 'http://localhost/*']]) {
    const page = { id: 'glaze', frameId: 0, url: `${origin}/my/`, tab: { id: 3, url: `${origin}/my/` } };
    const held = worker({ grants: new Set([grant]) });
    assert.deepEqual(await held.send(rail(), page), { ok: true }, `${origin}: held`);
    const none = worker();
    assert.equal((await none.send(rail(), page)).ok, false, `${origin}: not held`);
  }
  // A grant with a port (a scratch build's manifest) counts for that port.
  const page = { id: 'glaze', frameId: 0, url: 'http://localhost:8081/my/', tab: { id: 3, url: 'http://localhost:8081/my/' } };
  const ported = worker({ manifest: (m) => m.host_permissions.push('http://localhost:8081/*') });
  assert.deepEqual(await ported.send(rail(), page), { ok: true });
  // Never over https on a local name, nor any other host over http.
  for (const url of ['https://localhost/my/', 'http://school.edu/my/', 'http://localhost.evil.test/my/']) {
    const w = worker({ grants: new Set(['http://localhost/*', 'https://*/*', 'http://*/*']) });
    assert.equal((await w.send(rail(), { ...page, url, tab: { id: 3, url } })).ok, false, url);
  }
});

test('review: embedded Settings feature grants never probe the feature as a school', async () => {
  const fetched = [];
  const w = worker({ fetch: async (u) => { fetched.push(u); throw Error('unexpected LMS probe'); } });
  const embedded = { ...editor, frameId: 12, tab: { id: 7, url: `${CANVAS}/courses/25` } };
  for (const origin of ['https://www.gradescope.com', 'https://media.example']) {
    assert.deepEqual(await w.send({ type: 'glaze:allow', op: 'feature', origin }, embedded), { ok: true });
    const pattern = `${origin}/*`;
    w.grants.add(pattern);
    for (const f of w.perms.added) f({ origins: [pattern] });
    await w.settle();
  }
  assert.deepEqual(fetched, [], 'feature hosts are not LMS candidates');
  assert.deepEqual(await w.send({ type: 'glaze:allow', op: 'feature', origin: 'https://media.example' }, course()), { ok: false, error: 'sender' });
  assert.deepEqual(await w.send({ type: 'glaze:allow', op: 'ask', origin: 'https://school.example' }, embedded), { ok: false, error: 'sender' }, 'embedding does not authorize adding a school');
});

test('review: a browser-menu Gradescope grant does not probe LMS APIs and refreshes registration', async () => {
  const fetched = [];
  const w = worker({ fetch: async (u) => { fetched.push(u); throw Error('unexpected LMS probe'); } });
  await turn(w, { gradescope: true });
  w.grants.add(GS);
  for (const f of w.perms.added) f({ origins: [GS] });
  await w.settle();
  assert.deepEqual(fetched, []);
  assert.equal(w.registered.has('gz-gradescope'), true);
});

test('review: narrowed downloads refuse opaque redirects before following an unknown host', async () => {
  const modes = [];
  const w = worker({ grants: new Set([`https://${CDN}/*`]), fetch: async (u, init) => {
    modes.push(init.redirect);
    return { type: 'opaqueredirect', ok: false, url: '', headers: new Headers() };
  } });
  const { port, say } = w.connect('canvas-zip', course());
  say({ type: 'file', url: `https://${CDN}/redirect` });
  await w.settle();
  assert.deepEqual(modes, ['manual']);
  assert.deepEqual(posted(port), [{ type: 'error', code: 'redirect' }]);
});
