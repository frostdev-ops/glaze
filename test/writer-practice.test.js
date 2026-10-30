const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const Module = require('node:module');
const { options, browserArgs, observe, main } = require('../scripts/writer-practice.js');

test('practice validates --ext and flags before opening a browser or resetting a profile', () => {
  assert.deepEqual(options(['--ext', '.', '--fresh', '--smoke']), { root: path.resolve('.'), fresh: true, smoke: true, help: false, ai: '' });
  assert.equal(options(['--ai', 'mock']).ai, 'mock');
  for (const args of [['--ext'], ['--ext', '--fresh'], ['--frseh'], ['unexpected'], ['--ai'], ['--ai', 'openai']]) assert.throws(() => options(args), /Invalid argument/);
  assert.equal(options(['--help']).help, true);
});

test('headed practice and smoke deny DNS, literal IPs and proxy loopback bypasses alike, all but through the AI proxy', () => {
  for (const smoke of [true, false]) {
    const args = browserArgs('/synthetic-extension', smoke);
    assert.ok(args.includes('--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'));
    assert.ok(args.includes('--proxy-server=http://127.0.0.1:0'));
    assert.ok(browserArgs('/synthetic-extension', smoke, 4321).includes('--proxy-server=http://127.0.0.1:4321'));
    assert.ok(args.includes('--proxy-bypass-list=<-loopback>'));
    assert.ok(args.includes('--disable-quic'));
  }
});

test('console observation includes resource errors and errors from every page and frame', () => {
  const context = new EventEmitter(), errors = [];
  observe(context, errors);
  context.emit('console', { type: () => 'error', text: () => 'Failed to load resource: synthetic failure' });
  context.emit('console', { type: () => 'log', text: () => 'normal output' });
  context.emit('weberror', { error: () => Error('synthetic frame exception') });
  assert.deepEqual(errors, ['console: Failed to load resource: synthetic failure', 'page: synthetic frame exception']);
});

test('an interrupted browser wait exits without waiting for an unrelated browser', async () => {
  const controller = new AbortController();
  controller.abort(Error('synthetic interrupt'));
  await assert.rejects(require('../scripts/wait-for-browser.js')(controller.signal), /synthetic interrupt/);
});

test('smoke output can stay in a hidden checkout folder, and a launch failure cleans its profile and lock', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-practice-cleanup-'));
  const context = new EventEmitter();
  const load = Module._load, practice = process.env.GLAZE_PRACTICE;
  let profile, closed = 0;
  context.pages = () => [];
  context.setDefaultTimeout = () => {};
  context.route = async () => { throw Error('synthetic initialization failure'); };
  context.close = async () => { closed++; context.emit('close'); };
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'playwright') return { chromium: { launchPersistentContext: async (p) => { profile = p; return context; } } };
    if (id === './wait-for-browser.js') return async () => {};
    return load.call(this, id, ...args);
  });
  t.mock.method(require('../scripts/check-env.js'), 'lockPath', () => path.join(tmp, 'heavy.lock'));
  t.mock.method(require('../scripts/ultra-mock.js'), 'quill', async () => Buffer.alloc(0));
  try {
    const ext = path.join(tmp, 'source');
    fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), '{"manifest_version":3,"name":"Synthetic practice","version":"0.0.0"}');
    process.env.GLAZE_PRACTICE = path.join(ext, '.glaze-practice');
    await assert.rejects(main(['--smoke', '--ext', ext]), /synthetic initialization failure/);
    assert.equal(closed, 1);
    assert.equal(fs.existsSync(path.dirname(profile)), false);
    assert.equal(fs.existsSync(path.join(tmp, 'heavy.lock')), false);
  } finally {
    if (practice === undefined) delete process.env.GLAZE_PRACTICE; else process.env.GLAZE_PRACTICE = practice;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Exercise the private allow-list without opening a browser. Only sanitized worker results cross this boundary.
const proxyPolicy = () => {
  const file = require.resolve('../scripts/writer-practice.js');
  const logs = [];
  const helpers = require('node:vm').runInNewContext(`${fs.readFileSync(file, 'utf8')}\n;({ connections, reachable });`, {
    require: Module.createRequire(file), module: { exports: {} }, __dirname: path.dirname(file), process, URL,
    console: { log: (...args) => logs.push(args.join(' ')) },
  });
  return { ...helpers, logs };
};

test('the proxy rechecks a saved connection on use so removal or permission revocation takes effect at once', async () => {
  const { reachable } = proxyPolicy();
  const target = { protocol: 'https:', host: 'ai.example', port: 443 };
  let list = [target];
  const context = { serviceWorkers: () => [{ url: () => 'chrome-extension://own/worker.js', evaluate: async () => list }] };
  const allowed = reachable(() => context, () => 'own');
  assert.equal(await allowed(target), true);
  list = [];
  assert.equal(await allowed(target), false, 'no previously allowed origin survives a revoked grant or removed connection');
});

test('only the extension worker supplies the proxy allow-list; absent or foreign workers fail closed', async () => {
  const { connections } = proxyPolicy();
  const context = { serviceWorkers: () => [{ url: () => 'https://page.example/worker.js', evaluate: async () => { throw Error('a page worker must never be evaluated'); } }] };
  assert.deepEqual(Array.from(await connections(context, 'own')), []);
  assert.deepEqual(Array.from(await connections(null, 'own')), []);
});

test('the practice route blocks page traffic even to an AI host and continues only its own extension worker', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-practice-route-'));
  const context = new EventEmitter(), load = Module._load, practice = process.env.GLAZE_PRACTICE;
  let handler, id;
  context.pages = () => [];
  context.setDefaultTimeout = () => {};
  context.route = async (pattern, fn) => { handler = fn; };
  context.routeWebSocket = async () => { throw Error('synthetic stop after route installation'); };
  context.close = async () => context.emit('close');
  t.mock.method(Module, '_load', function (name, ...args) {
    if (name === 'playwright') return { chromium: { launchPersistentContext: async (profile, options) => {
      const ext = options.args.find((a) => a.startsWith('--load-extension=')).slice('--load-extension='.length);
      id = [...require('node:crypto').createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
      return context;
    } } };
    if (name === './wait-for-browser.js') return async () => {};
    return load.call(this, name, ...args);
  });
  t.mock.method(require('../scripts/check-env.js'), 'lockPath', () => path.join(tmp, 'heavy.lock'));
  t.mock.method(require('../scripts/ultra-mock.js'), 'quill', async () => Buffer.alloc(0));
  try {
    const ext = path.join(tmp, 'source'); fs.mkdirSync(ext);
    fs.writeFileSync(path.join(ext, 'manifest.json'), '{"manifest_version":3,"name":"Synthetic practice","version":"0.0.0"}');
    process.env.GLAZE_PRACTICE = path.join(tmp, 'practice');
    await assert.rejects(main(['--smoke', '--ext', ext]), /synthetic stop after route installation/);
    const request = async (worker, url = 'https://ai.example/v1/chat/completions') => {
      let disposition;
      await handler({ request: () => ({ serviceWorker: () => worker && { url: () => worker }, url: () => url, method: () => 'POST' }),
        abort: () => { disposition = 'aborted'; }, continue: () => { disposition = 'continued'; } });
      return disposition;
    };
    assert.equal(await request(null), 'aborted', 'a page cannot reach even a permitted AI origin');
    assert.equal(await request('https://page.example/worker.js'), 'aborted', 'nor can a page service worker');
    assert.equal(await request('chrome-extension://another/worker.js'), 'aborted', 'nor another extension');
    assert.equal(await request(`chrome-extension://${id}/lib/background.js`), 'continued', 'only this extension worker may reach the proxy');
  } finally {
    if (practice === undefined) delete process.env.GLAZE_PRACTICE; else process.env.GLAZE_PRACTICE = practice;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the worker allow-list returns only saved, granted origins and never connection credentials or paths', async () => {
  const { connections, reachable, logs } = proxyPolicy();
  const secret = 'SYNTHETIC-PRIVATE-KEY';
  const saved = { own: { provider: 'openai', base: `https://ai.example:8443/v1?token=${secret}`, key: secret },
    denied: { base: 'https://denied.example/v1', key: secret }, bad: { base: 'not a URL' } };
  let closed = 0;
  const request = (result) => { const r = { result }; queueMicrotask(() => r.onsuccess()); return r; };
  const db = { objectStoreNames: { contains: (name) => name === 'vault' }, close: () => closed++,
    transaction: (name) => { assert.equal(name, 'vault'); return { objectStore: (store) => { assert.equal(store, 'vault'); return { get: (key) => { assert.equal(key, 'connections'); return request(saved); } }; } }; } };
  const globals = { URL, indexedDB: { databases: async () => [{ name: 'glaze-ai' }], open: (name) => { assert.equal(name, 'glaze-ai'); return request(db); } },
    chrome: { permissions: { contains: async ({ origins }) => origins.length === 1 && origins[0] === 'https://ai.example/*' } } };
  const worker = { url: () => 'chrome-extension://own/lib/background.js', evaluate: (fn) => require('node:vm').runInNewContext(`(${fn})()`, globals) };
  const context = { serviceWorkers: () => [worker] };
  const list = JSON.parse(JSON.stringify(await connections(context, 'own')));
  assert.deepEqual(list, [{ protocol: 'https:', host: 'ai.example', port: 8443 }]);
  assert.equal(closed, 1);
  assert.equal(await reachable(() => context, () => 'own')(list[0]), true);
  assert.doesNotMatch(JSON.stringify({ list, logs }), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify({ list, logs }), /token=|\/v1/);
});
