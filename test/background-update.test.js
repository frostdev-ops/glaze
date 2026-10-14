const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
const day = 24 * 60 * 60 * 1000;
const now = 5 * day;
const settle = () => new Promise(setImmediate);

function worker({ protocol = 'safari-web-extension:', stored = {}, get, set, send } = {}) {
  const calls = [];
  const listener = { addListener() {} };
  const local = {
    get(key) { calls.push(['get', key]); return get ? get(key) : Promise.resolve({ ...stored }); },
    set(value) {
      calls.push(['set', value]);
      if (set) return set(value);
      Object.assign(stored, value);
      return Promise.resolve();
    },
  };
  const context = vm.createContext({
    URL, console, Date: { now: () => now },
    chrome: {
      runtime: {
        getURL: () => `${protocol}//extension/`,
        onMessage: listener, onInstalled: listener, onStartup: listener,
        sendNativeMessage(app, message) {
          calls.push(['send', app, message]);
          return send ? send(app, message) : Promise.resolve({});
        },
      },
      storage: { local },
    },
  });
  vm.runInContext(source, context, { filename: 'lib/background.js' });
  // Normalize VM objects for strict comparison without exporting production internals.
  return { calls: () => JSON.parse(JSON.stringify(calls)), stored };
}

test('Chrome, Firefox and lookalike schemes make no update storage or native calls', async () => {
  for (const protocol of ['chrome-extension:', 'moz-extension:', 'safari-web-extension-evil:', 'https:']) {
    const run = worker({ protocol });
    await settle();
    assert.deepEqual(run.calls(), [], protocol);
  }
});

test('Safari first worker start records its attempt before one check-only native message', async () => {
  const run = worker();
  await settle();
  assert.deepEqual(run.calls(), [
    ['get', 'safariUpdateCheckAt'],
    ['set', { safariUpdateCheckAt: now }],
    ['send', 'io.frostdev.Glaze', { type: 'check-updates' }],
  ]);
});

test('Safari worker restarts suppress attempts less than 24 hours old, including future timestamps', async () => {
  for (const timestamp of [now, now - day + 1, now + day]) {
    const run = worker({ stored: { safariUpdateCheckAt: timestamp } });
    await settle();
    assert.deepEqual(run.calls(), [['get', 'safariUpdateCheckAt']]);
  }
});

test('Safari attempts again at or after 24 hours and persists the new throttle across workers', async () => {
  for (const timestamp of [now - day, now - day - 1]) {
    const stored = { safariUpdateCheckAt: timestamp };
    const first = worker({ stored });
    await settle();
    assert.equal(first.calls().filter(([kind]) => kind === 'send').length, 1);
    assert.equal(stored.safariUpdateCheckAt, now);
    const second = worker({ stored });
    await settle();
    assert.deepEqual(second.calls(), [['get', 'safariUpdateCheckAt']]);
  }
});

test('Safari waits for the timestamp write to finish before sending', async () => {
  let saved;
  const run = worker({ set: () => new Promise((resolve) => { saved = resolve; }) });
  await settle();
  assert.deepEqual(run.calls(), [['get', 'safariUpdateCheckAt'], ['set', { safariUpdateCheckAt: now }]]);
  saved();
  await settle();
  assert.equal(run.calls().at(-1)[0], 'send');
});

for (const method of ['get', 'set']) {
  for (const failure of ['throw', 'reject']) {
    test(`Safari fails closed when storage ${method} ${failure}s`, async () => {
      const fail = () => {
        if (failure === 'throw') throw new Error('storage unavailable');
        return Promise.reject(new Error('storage unavailable'));
      };
      const run = worker({ [method]: fail });
      await settle();
      assert.equal(run.calls().some(([kind]) => kind === 'send'), false);
      assert.equal(run.calls().at(-1)[0], method);
    });
  }
}

for (const failure of ['throw', 'reject']) {
  test(`Safari keeps the daily throttle when native messaging ${failure}s`, async () => {
    const stored = {};
    const run = worker({ stored, send: () => {
      if (failure === 'throw') throw new Error('native app unavailable');
      return Promise.reject(new Error('native app unavailable'));
    } });
    await settle();
    assert.equal(run.calls().filter(([kind]) => kind === 'send').length, 1);
    assert.equal(stored.safariUpdateCheckAt, now);
    const restarted = worker({ stored });
    await settle();
    assert.deepEqual(restarted.calls(), [['get', 'safariUpdateCheckAt']]);
  });
}
