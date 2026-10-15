const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const read = (file) => fs.readFileSync(process.env.GZ_LIFECYCLE_REPO ? path.join(process.env.GZ_LIFECYCLE_REPO, file) : require.resolve(`../${file}`), 'utf8');
const settle = () => new Promise(setImmediate);

test('Google sync permanently stops before storage access after reload', async () => {
  const timers = new Map(); let next = 0, reads = 0;
  const chrome = { runtime: { id: 'glaze', sendMessage: async () => ({}) }, storage: { local: { get: async () => { reads++; if (!chrome.runtime.id) throw new Error('invalidated'); return { gcal: { cal: 'calendar', last: {} } }; } }, onChanged: { addListener() {} } } };
  const c = { chrome, location: { origin: 'https://ultra.fixture.test' },
    setTimeout: (fn) => { timers.set(++next, fn); return next; }, clearTimeout: (id) => timers.delete(id),
    GZ_CTX: { site: 'ultra', on: () => true, settings: () => ({ enabled: true }), profile: async () => ({ id: '_900_1' }), need: async () => {} },
    GZ_CAL_UI: { compose: async () => ({ events: [], recheck: async () => true }) } };
  c.window = c; c.top = c;
  vm.runInNewContext(read('features/gcal.js'), c); await settle();
  assert.equal(reads, 1); assert.equal(timers.size, 1);
  delete chrome.runtime.id;
  const fn = [...timers.values()][0]; timers.clear(); fn(); await settle();
  assert.equal(reads, 1, 'the invalidated timer does not attempt extension storage');
  assert.equal(timers.size, 0, 'an invalidated context does not arm another timer');
});

test('Download all closes an invalidated port and rejects pending bytes without a keepalive exception', async () => {
  const source = read('features/download.js'), start = source.indexOf('  const canvasBytes = '), end = source.indexOf('  const jobs = ', start);
  let ping, clears = 0, disconnects = 0, posts = 0;
  const chrome = { runtime: { id: 'glaze', connect: () => port } };
  const port = { postMessage() { if (!chrome.runtime.id) throw new Error('invalidated'); posts++; }, disconnect() { disconnects++; throw new Error('already disconnected'); }, onDisconnect: { addListener() {} }, onMessage: { addListener() {} } };
  const make = vm.runInNewContext(`${source.slice(start, end)} canvasBytes`, {
    chrome, DOMException, setInterval: (fn) => { ping = fn; return 1; }, clearInterval: () => clears++, Uint8Array, atob,
  });
  const bridge = make(new AbortController().signal), pending = bridge.read('https://ultra.fixture.test/file');
  const failed = assert.rejects(pending, { name: 'AbortError' });
  delete chrome.runtime.id;
  assert.doesNotThrow(() => ping()); await failed;
  assert.equal(clears, 1); assert.equal(disconnects, 1); assert.equal(posts, 1);
});

test('the shared JSON reader stays on origin and rejects auth redirects', async () => {
  const source = read('content.js'), start = source.indexOf('  const api = '), end = source.indexOf('  // The Canvas course', start);
  const requests = [];
  const c = vm.createContext({ location: { origin: 'https://ultra.fixture.test' }, fetch: async (url, init) => {
    requests.push({ url, init });
    if (url.endsWith('/users/me')) {
      if (init.redirect === 'error') throw new TypeError('auth redirect refused');
      return { ok: true, text: async () => '{"id":"foreign-account"}' };
    }
    return { ok: true, text: async () => 'while(1);{"id":"_900_1"}' };
  } });
  const { api, capi } = vm.runInContext(`${source.slice(start, end)} ({api,capi})`, c);
  await assert.rejects(api('/users/me'), /redirect refused/);
  assert.equal((await capi('/users/self/profile')).id, '_900_1');
  assert.deepEqual(requests.map((r) => r.url), ['https://ultra.fixture.test/learn/api/v1/users/me', 'https://ultra.fixture.test/api/v1/users/self/profile']);
  assert.ok(requests.every((r) => r.init.credentials === 'same-origin' && r.init.redirect === 'error'));
  assert.equal(requests[1].init.headers.accept, 'application/json+canvas-string-ids');
});

test('a card storage answer held across reload does not resume painting', async () => {
  const source = read('features/cards.js'), start = source.indexOf('  const paint = async '), end = source.indexOf('  // ---- bookmarks', start);
  let release, writes = 0;
  const chrome = { runtime: { id: 'glaze' } }, waiting = new Promise((r) => { release = r; });
  const c = { chrome, location: { pathname: '/ultra/course' }, read: () => waiting,
    html: { hasAttribute: () => true }, K: { page: () => ({ vars: {}, attrs: {} }) }, ultra: false,
    prop: () => writes++, attr: () => writes++, document: { querySelectorAll: () => [] } };
  c.window = c; c.top = c;
  const paint = vm.runInNewContext(`${source.slice(start, end)} paint`, c), pending = paint();
  delete chrome.runtime.id; release({ card: {} }); await pending;
  assert.equal(writes, 0, 'late storage does not redraw or construct extension asset URLs');
});

test('stale sticker draw and place callbacks bail before constructing asset elements', () => {
  const source = read('features/lookx.js'); let removed = 0, made = 0;
  const c = { ctx: { on: () => false }, editing: true, list: [{}], layer: { remove: () => removed++ },
    sheet: () => { throw new Error('invalidated getURL'); }, make: () => made++ };
  const drawStart = source.indexOf('  const draw = '), drawEnd = source.indexOf('  // A change to one sticker', drawStart);
  const draw = vm.runInNewContext(`${source.slice(drawStart, drawEnd)} draw`, c);
  assert.doesNotThrow(draw); assert.equal(removed, 1); assert.equal(made, 0);
  const placeStart = source.indexOf('  const place = '), placeEnd = source.indexOf('  // ---- sticker mode', placeStart);
  const place = vm.runInNewContext(`${source.slice(placeStart, placeEnd)} place`, {
    ctx: c.ctx, editing: true, layer: { getBoundingClientRect: () => { throw new Error('stale placement'); } },
  });
  assert.doesNotThrow(() => place('cat'));
});

test('an unloaded feature rejects after reload without a synchronous exception or orphan retry', async () => {
  const source = read('content.js'), start = source.indexOf('  const need = '), end = source.indexOf('  // Moodle', start);
  let calls = 0, retries = 0, loaded = false;
  const chrome = { runtime: { sendMessage: () => { calls++; throw new Error('invalidated API'); } } };
  const need = vm.runInNewContext(`${source.slice(start, end)} need`, {
    loading: new Map(), docId: 'document', isPreview: false, chrome, setTimeout: () => retries++,
  });
  let pending;
  assert.doesNotThrow(() => { pending = need('features/keys.js', () => false); });
  await assert.rejects(pending, /reloaded/);
  assert.equal(calls, 0); assert.equal(retries, 0);
  chrome.runtime.id = 'glaze';
  chrome.runtime.sendMessage = async () => { calls++; loaded = true; return { ok: true }; };
  await need('features/palette.js', () => loaded);
  assert.equal(calls, 1, 'a valid context still loads the requested feature');
});

test('real shortcut listeners leave keys alone after reload before a body mutation', async () => {
  const source = read('content.js'), start = source.indexOf('  const keyOn = '), end = source.indexOf('  // ---- footer', start);
  const handlers = []; let consumed = 0, loads = 0;
  const c = { chrome: { runtime: {} }, observer: {}, ultra: true, moodle: false, typing: () => false,
    settings: { enhance: { keys: true, palette: true } },
    document: { addEventListener: (_, fn) => handlers.push(fn) },
    need: () => { loads++; return Promise.reject(new Error('reloaded')); } };
  c.window = c; c.top = c;
  vm.runInNewContext(source.slice(start, end), c);
  for (const key of ['?', 'k']) for (const handler of handlers) assert.doesNotThrow(() => handler({
    key, ctrlKey: key === 'k', target: {}, preventDefault: () => consumed++, stopPropagation() {},
  }));
  await settle();
  assert.equal(consumed, 0); assert.equal(loads, 0);
});
