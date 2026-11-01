const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../../extension/courses/ultra.js'), 'utf8');
const settle = async () => { for (let n = 0; n < 10; n++) await new Promise(setImmediate); };
const page = () => {
  const events = {}, timers = new Map(), observers = [], sent = [], storage = [], asked = [];
  let now = Date.now(), serial = 0;
  const main = {}, control = { nodeType: 1, closest: (q) => q === 'main' ? main : /button/.test(q) ? control : null, matches: () => false };
  const doc = { visibilityState: 'visible', documentElement: { hasAttribute: () => false }, addEventListener: (t, f) => (events[t] ||= []).push(f), dispatchEvent() {} };
  const c = vm.createContext({ GZ_PAGE: require('../../extension/core/page.js'), GZ_COURSES: require('../../extension/content/defaults.js').GZ_COURSES, location: { origin: 'https://school.blackboard.com' }, document: doc, URL, Intl, Date: class extends Date { static now() { return now; } },
    setTimeout: (f, ms) => { timers.set(++serial, { f, ms }); return serial; }, clearTimeout: (id) => timers.delete(id), addEventListener: (t, f) => (events[t] ||= []).push(f),
    CustomEvent: class { constructor(t, v) { this.type = t; this.detail = v.detail; } },
    MutationObserver: class { constructor(f) { this.f = f; observers.push(this); } observe(target) { this.target = target; } disconnect() {} },
    fetch: async (u) => { asked.push(u); return { ok: true, text: async () => JSON.stringify({ results: [] }) }; },
    chrome: { runtime: { sendMessage: (m, cb) => { sent.push(m); const r = m.op === 'begin' ? { epoch: 'test' } : null; cb?.(r); return Promise.resolve(r); } }, storage: {
      local: { get: (k, cb) => cb({}) }, onChanged: { addListener: (f) => storage.push(f) },
    } },
  });
  vm.runInContext(source, c);
  return { c, doc, sent, asked, control, main, observers, fire: (t, target = control) => events[t]?.forEach((f) => f({ type: t, target })),
    run: (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.f(); } }, advance: (ms) => { now += ms; } };
};

test('a retained document rechecks its gradebook after browser visibility returns', async () => {
  const p = page();
  await p.c.GZ_ULTRA.page.book('_1_1', '_2_1', { maxAge: Infinity });
  p.doc.visibilityState = 'hidden'; p.fire('visibilitychange'); p.advance(60001);
  p.doc.visibilityState = 'visible'; p.fire('visibilitychange');
  await p.c.GZ_ULTRA.page.book('_1_1', '_2_1', { maxAge: Infinity });
  assert.equal(p.asked.length, 2);
});

test('native write completion invalidates again after its delayed DOM answer', async () => {
  const p = page(); p.fire('click'); p.run(300); await settle();
  assert.equal(p.sent.filter((m) => m.op === 'invalidate').length, 1);
  const watcher = p.observers.find((o) => o.target === p.main);
  assert.ok(watcher, 'the pending native write is observed until it settles');
  watcher.f([{ type: 'attributes', target: p.control, attributeName: 'aria-checked' }]);
  p.run(300); await settle();
  assert.equal(p.sent.filter((m) => m.op === 'invalidate').length, 2);
});

// Opening a folder or a learning module, or a menu, writes nothing: it purged every tab's kept Ultra data, and each Glaze part
// on the page redrew as the data came back (2026-11-01, a real course: the outline jumped under its folder's controls).
test('a click that only opens a folder, a module or a menu is no write', async () => {
  for (const attr of ['aria-expanded', 'aria-haspopup']) {
    const p = page();
    const toggle = { nodeType: 1, closest: (q) => q === 'main' ? p.main : /button/.test(q) ? toggle : null, matches: (q) => q.includes(`[${attr}]`) };
    p.fire('click', toggle); p.run(300); await settle();
    assert.equal(p.sent.filter((m) => m.op === 'invalidate').length, 0, attr);
    assert.ok(!p.observers.some((o) => o.target === p.main), `${attr}: nothing watched`);
  }
});
