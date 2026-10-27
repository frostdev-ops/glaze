const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../lib/writer-context-discussion.js');
const source = fs.readFileSync(require.resolve('../lib/writer-context-discussion.js'), 'utf8');

const harness = () => {
  let enabled = true, now = 100000, signature = '_201_1', observe;
  const timers = new Map(), reads = [], sent = [];
  let seq = 0, pending = null;
  const r = {
    list: async () => ({ items: [{ id: '_1101_1', title: 'Topic', topic: { body: 'Prompt' } }] }),
    all: async (p) => { reads.push(p); return pending ? await pending : []; },
  };
  const X = { on: () => enabled, settings: () => ({ enabled, enhance: { writer: enabled } }),
    need: async (p, f) => f(), me: async () => '_42_1', myCourses: async () => [], bookFor: () => null };
  const sandbox = { URLSearchParams, AbortController, Date: { now: () => now },
    location: { pathname: '/ultra/courses/_101_1/discussion/_9_1', search: '', origin: 'https://bb.school.test' },
    GZ_ULTRA: { read: () => r }, GZ_LMSQ: {}, GZ_WRITER_TARGET: { parse: () => ({}), forKind: () => ({}) },
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout: (id) => timers.delete(id),
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() { observe = this; } disconnect() { observe = null; } },
    document: { body: {}, querySelectorAll: (sel) => sel === 'h1' ? [{ textContent: 'Topic' }] : [{ getAttribute: () => signature }],
      createElement: () => ({ set innerHTML(v) {}, content: { querySelectorAll: () => [], textContent: 'Prompt' } }) },
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const api = sandbox.GZ_WRITER_CONTEXT_DISCUSSION;
  const box = () => ({ kind: 'reply', ready: true, frame: { isConnected: true }, port: { postMessage: (m) => sent.push(m) }, context: { post: { id: '_201_1' } } });
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  return { api, X, box, reads, sent, timers, flush, sandbox, observed: () => !!observe,
    disable: () => { enabled = false; }, advance: () => { now += 21000; signature += ' _202_1'; },
    pending: () => { let resolve; pending = new Promise((r) => { resolve = r; }); return resolve; },
    check: async () => { observe?.fn(); for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } await flush(); } };
};

test('disabled Writer never starts discussion reads', async () => {
  const h = harness(); h.disable(); h.api.watch(h.box(), h.X); await h.flush();
  assert.equal(h.reads.length, 0);
  assert.equal(h.sent.length, 0);
});

test('a pending thread read is single flight across the twenty-second refresh', async () => {
  const h = harness(), finish = h.pending(); h.api.watch(h.box(), h.X); await h.flush();
  assert.equal(h.reads.length, 1);
  h.advance(); await h.check();
  assert.equal(h.reads.length, 1, 'no overlapping read of the same thread');
  finish([]); await h.flush();
});

test('closing the final writer drops context observers, timers and late results', async () => {
  const h = harness(), box = h.box(), finish = h.pending(); h.api.watch(box, h.X); await h.flush();
  const before = h.sent.length;
  box.frame.isConnected = false;
  h.api.unwatch?.(box);
  assert.equal(h.observed(), false);
  assert.equal(h.timers.size, 0);
  finish([]); await h.flush();
  assert.equal(h.sent.length, before);
  assert.equal(h.api.author('_201_1'), '');
});

test('a disabled or navigated page never publishes an outstanding read', async () => {
  for (const leave of [(h) => h.disable(), (h) => { h.sandbox.location.pathname = '/ultra/courses/_101_1/discussion/_10_1'; }]) {
    const h = harness(), finish = h.pending(); h.api.watch(h.box(), h.X); await h.flush();
    const before = h.sent.length; leave(h); finish([{ id: '_201_1', body: { rawText: 'A post' } }]); await h.flush();
    assert.equal(h.sent.length, before);
  }
});

test('authorization, throttle and server failures stop reply fanout for this read', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const asked = [];
    const r = { all: async (p) => {
      asked.push(p);
      if (p.endsWith('/messages')) return [1, 2, 3].map((n) => ({ id: `_${n}_1`, messageStatus: { numberOfChildren: 1 } }));
      throw Error(`HTTP ${status}`);
    } };
    await C.messages(r, '_101_1', '_1101_1');
    assert.equal(asked.length, 2, `HTTP ${status} ends the batch`);
  }
});
