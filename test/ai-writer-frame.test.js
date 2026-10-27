// The frame's admission and async races, without a browser or a provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../writer-ai.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const plain = (v) => JSON.parse(JSON.stringify(v));
function frame() {
  class Element {
    constructor() { this.style = {}; this.attrs = {}; this.children = []; this.hidden = false; }
    append(...es) { this.children.push(...es); for (const e of es) if (e && typeof e === 'object') e.parentNode = this; }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
    addEventListener() {} remove() {} contains() { return false; }
    querySelector() { return null; }
  }
  const hooks = {}, sent = [], receives = [], pendingStatus = [], pendingRun = [];
  let ctx = { kind: 'reply' }, settings = { on: true, use: 'main', features: { completion: true, writing: true } }, holdStatus = false;
  const doc = { content: { size: 10 }, textBetween: () => 'draft words' };
  const ed = { view: { state: { doc }, dispatch() {} } };
  const sandbox = { navigator: { platform: 'MacIntel' }, document: { createElement: () => new Element(), body: new Element(), addEventListener() {} },
    addEventListener() {}, requestAnimationFrame: (f) => f(), setTimeout, clearTimeout,
    GZ_PM: { state: { Plugin: class { constructor(spec) { this.spec = spec; } }, PluginKey: class { getState() { return null; } } }, view: {}, transform: { Mapping: class { appendMapping() {} map(v) { return v; } } } },
    GZ_WRITER_SCHEMA: { text: () => ({ text: 'draft words', posAt: (v) => v }) }, GZ_WRITER_PROOF: {},
    GZ_WRITER_FRAME: { t: (s) => s, kind: () => 'reply', context: () => ctx, editor: () => ed, mode: () => 'compose',
      on: (ev, f) => { hooks[ev] = f; }, plugin() {}, slot: () => new Element(), item: () => new Element() },
    chrome: { storage: { local: { get: async () => ({ ai: structuredClone(settings) }) }, onChanged: { addListener(f) { hooks.storage = f; } } }, runtime: { connect() {
      return { onMessage: { addListener: (f) => receives.push(f) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(m) {
        sent.push(m);
        if (m.op === 'status') { if (holdStatus) pendingStatus.push(m); else queueMicrotask(() => reply({ id: m.id, type: 'status', allowed: true, ready: true })); }
        if (m.op === 'run') pendingRun.push(m);
      } };
    } } } };
  const reply = (m) => receives.forEach((f) => f(m));
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const ai = sandbox.GZ_WRITER_AI;
  return { ai, sent, pendingStatus, pendingRun, reply, hooks, proof: sandbox.GZ_WRITER_PROOF,
    start: async () => { hooks.ready(); await flush(); },
    off: () => { settings.on = false; hooks.storage({ ai: { newValue: structuredClone(settings) } }, 'local'); },
    context: (c) => { ctx = c; hooks.context(c); }, hold: () => { holdStatus = true; } };
}

test('decide and the proof hook preserve the original candidate index, including duplicate candidates and keep', async () => {
  const f = frame(); await f.start();
  for (const [verdict, choice, expected] of [['apply', "they're", { verdict: 'apply', choice: 2 }], ['suggest', "they're", { verdict: 'suggest', choice: 2 }], ['keep', null, { verdict: 'keep', choice: -1 }]]) {
    const result = f.proof.decide({ text: 'They put there coats down.', from: 9, to: 14, suggestions: ['their', 'their', "they're"] });
    f.reply({ id: f.pendingRun.at(-1).id, type: 'end', output: { verdict, choice } });
    assert.deepEqual(plain(await result), expected);
  }
});

test('turning AI off closes admission immediately, before the async storage read completes', async () => {
  const f = frame(); await f.start(); const n = f.sent.length;
  f.off(); const r = f.ai.requirements('Write 250 words.');
  await flush();
  assert.equal(f.sent.slice(n).some((m) => m.op === 'run'), false);
  assert.equal(await r, null);
});

test('a late ready status cannot re-enable AI after it was turned off', async () => {
  const f = frame(); await f.start(); f.hold();
  const refresh = f.ai.refresh(); await flush();
  const pending = f.pendingStatus[0]; assert.ok(pending);
  f.off(); await flush();
  f.reply({ id: pending.id, type: 'status', allowed: true, ready: true }); await flush();
  // A stale refresh must not continue by asking for the other feature either.
  assert.equal(f.pendingStatus.length, 1);
  assert.equal(f.ai.allowed('completion'), false); assert.equal(f.ai.allowed('writing'), false);
  await refresh;
});

test('a test context stops all public task entry points and discards in-flight writing results', async () => {
  const f = frame(); await f.start();
  const r = f.ai.requirements('Write 250 words.'); const id = f.pendingRun.at(-1).id;
  f.context({ kind: 'test' }); await flush();
  f.reply({ id, type: 'end', output: { minWords: 250 } });
  assert.equal(await r, null);
  const n = f.sent.length;
  const later = f.ai.cite({ text: 'A title' }); await flush();
  assert.equal(f.sent.slice(n).some((m) => m.op === 'run'), false);
  assert.equal(await later, null);
});
