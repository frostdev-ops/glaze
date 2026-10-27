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

test('a failure after Chromium starts closes it and removes its staged extension, profile and lock', async (t) => {
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
    process.env.GLAZE_PRACTICE = path.join(tmp, 'practice');
    await assert.rejects(main(['--smoke', '--ext', ext]), /synthetic initialization failure/);
    assert.equal(closed, 1);
    assert.equal(fs.existsSync(path.dirname(profile)), false);
    assert.equal(fs.existsSync(path.join(tmp, 'heavy.lock')), false);
  } finally {
    if (practice === undefined) delete process.env.GLAZE_PRACTICE; else process.env.GLAZE_PRACTICE = practice;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
