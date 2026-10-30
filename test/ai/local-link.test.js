const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../../extension/ai/local/link.js');

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const clock = () => {
  let seq = 0;
  const pending = new Map();
  return { pending, setTimeout: (f) => { pending.set(++seq, f); return seq; }, clearTimeout: (id) => pending.delete(id),
    tick: () => { const all = [...pending.values()]; pending.clear(); for (const f of all) f(); } };
};
const port = () => {
  const messages = [], gone = [], sent = [];
  return { sent, onMessage: { addListener: (f) => messages.push(f) }, onDisconnect: { addListener: (f) => gone.push(f) },
    postMessage: (m) => sent.push(m), disconnect: () => gone.forEach((f) => f()), hear: (m) => messages.forEach((f) => f(m)) };
};
const runtime = { getURL: (f) => `chrome-extension://glaze/${f}`, getContexts: async () => [] };

test('failed offscreen startup clears its connection deadline before a retry', async () => {
  const timers = clock();
  const link = L.create({ runtime, offscreen: { createDocument: async () => { throw new Error('cannot open'); } }, ...timers });
  await assert.rejects(link.call('prepare'), (e) => e.reason === 'host');
  assert.equal(timers.pending.size, 0, 'the abandoned waiter must not reject later as an unhandled promise');
});

test('older Chrome reconnects an existing document through service-worker clients', async () => {
  const p = port();
  let created = 0, link;
  link = L.create({ runtime: { getURL: runtime.getURL, sendMessage: async () => link.accept(p) },
    clients: { matchAll: async () => [{ url: runtime.getURL(L.PAGE) }] },
    offscreen: { createDocument: async () => { created++; link.accept(p); } }, ...clock() });
  const run = link.call('prepare'); await settle();
  p.hear({ id: p.sent.at(-1).id, type: 'done', result: 'ok' });
  assert.equal(await run, 'ok');
  assert.equal(created, 0, 'an existing document must be reconnected rather than created again');
});

test('an idle message already in transit cannot close a host with a new call', async () => {
  const p = port(), timers = clock();
  let closed = 0, link;
  link = L.create({ runtime, offscreen: { createDocument: async () => link.accept(p), closeDocument: async () => { closed++; } }, ...timers });
  const run = link.call('run');
  await settle();
  p.hear({ type: 'idle' }); await settle();
  const count = closed;
  const id = p.sent.find((m) => m.op === 'run').id;
  p.hear({ id, type: 'done', result: 'ok' });
  await run;
  assert.equal(count, 0, 'the call arrived after the worker emitted idle');
});

test('new calls wait for offscreen closing and reopen a fresh host', async () => {
  const old = port(), fresh = port(), timers = clock();
  let finishClose, opened = 0, link;
  link = L.create({ runtime, offscreen: {
    createDocument: async () => link.accept(++opened === 1 ? old : fresh),
    closeDocument: () => new Promise((resolve) => { finishClose = resolve; }),
  }, ...timers });
  const first = link.call('run'); await settle();
  old.hear({ id: old.sent.at(-1).id, type: 'done', result: 'first' }); await first;
  old.hear({ type: 'idle' }); await settle();
  const second = link.call('run'); second.catch(() => {}); await settle();
  try {
    assert.equal(old.sent.filter((m) => m.op === 'run').length, 1, 'no calls sent to a closing document');
  } finally {
    finishClose(); old.disconnect(); await settle();
    const next = fresh.sent.find((m) => m.op === 'run');
    if (next) fresh.hear({ id: next.id, type: 'done', result: 'second' });
    await second.catch(() => {});
  }
  assert.equal(opened, 2);
});

test('messages from a replaced host port are ignored', async () => {
  const old = port(), fresh = port();
  let closed = 0;
  const link = L.create({ runtime, offscreen: { createDocument: async () => {}, closeDocument: async () => { closed++; } }, ...clock() });
  link.accept(old); link.accept(fresh);
  old.hear({ type: 'idle' }); await settle();
  assert.equal(closed, 0, 'a retired port cannot close the current document');
});

test('offscreen idle fallback is canceled when the worker sends new work', () => {
  const timers = clock(), p = port();
  let worker, closed = 0;
  class Worker { constructor() { worker = this; } postMessage() {} }
  const context = vm.createContext({ Worker, chrome: { runtime: { id: 'glaze', connect: () => p, onMessage: { addListener() {} } } },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, close: () => { closed++; } });
  vm.runInContext(fs.readFileSync(require.resolve('../../extension/ai/local/offscreen.js'), 'utf8'), context);
  worker.onmessage({ data: { type: 'idle' } });
  p.hear({ id: 1, op: 'run' });
  timers.tick();
  assert.equal(closed, 0, 'idle shutdown cannot terminate newly admitted work');
});

test('a late disconnect from an old background port cannot detach its replacement', () => {
  const old = port(), fresh = port(), forwarded = [];
  let worker, reconnect, connections = 0;
  old.postMessage = () => { throw new Error('disconnected'); };
  class Worker { constructor() { worker = this; } postMessage(m) { forwarded.push(m); } }
  const context = vm.createContext({ Worker, chrome: { runtime: { id: 'glaze', connect: () => ++connections === 1 ? old : fresh,
    onMessage: { addListener: (f) => { reconnect = f; } } } }, ...clock(), close() {} });
  vm.runInContext(fs.readFileSync(require.resolve('../../extension/ai/local/offscreen.js'), 'utf8'), context);
  worker.onmessage({ data: { type: 'tick' } }); // Detect the dead port before its disconnect event arrives.
  reconnect({ type: 'glaze:local-host', op: 'connect' }, { id: 'glaze' });
  old.disconnect();
  worker.onmessage({ data: { id: 1, type: 'delta', text: 'ok' } });
  assert.equal(forwarded.some((m) => m.op === 'detach'), false, 'the replacement still owns the worker');
  assert.equal(fresh.sent.at(-1)?.text, 'ok');
});
