// Drive the frame module with a real editor state and controlled worker replies/timers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const E = require('../lib/writer-editor.js'), P = require('../lib/writer-proof.js'), I = require('../lib/writer-issues.js');
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const frame = (options = {}) => {
  const events = {}, hooks = [], ports = [], timers = new Map(), life = {};
  let tid = 0;
  const doc = { activeElement: null, createElement: (t) => { const e = new El(t, doc); e.classList = { toggle() {} }; return e; } };
  doc.root = doc.body = new El('body', doc);
  const proof = { ...P };
  const view = { dom: new El('div', doc), composing: false, hasFocus: () => true, focus() {}, coordsAtPos: () => ({ left: 10, top: 10, bottom: 25 }),
    dispatch(tr) { const prev = this.state; this.state = this.state.apply(tr); for (const p of hooks) p.spec.view?.().update?.(this, prev); } };
  const issues = I.bind(view);
  const api = { t: (k) => k, kind: () => 'reply', context: () => options.context || {}, slot: () => null,
    plugin: (p) => hooks.push(p), on: (k, f) => { events[k] = f; } };
  const makePort = () => { const p = { sent: [], postMessage(m) { this.sent.push(m); }, start() {}, close() { this.closed = true; }, terminate() { this.terminated = true; }, addEventListener() {} }; ports.push(p); return p; };
  const ctx = vm.createContext({ GZ_WRITER_FRAME: api, GZ_WRITER_PROOF: proof, GZ_WRITER_ISSUES: issues, GZ_PM,
    document: doc, innerWidth: 800, innerHeight: 300, console,
    setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (k, fn) => { life[k] = fn; },
    SharedWorker: options.noShared ? undefined : class { constructor() { if (options.throwShared) throw Error('SharedWorker disabled'); this.port = makePort(); } addEventListener() {} },
    Worker: class { constructor() { return makePort(); } },
    chrome: { storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../writer-proof.js'), 'utf8'), ctx);
  view.state = E.state({ html: options.html || '<p>teh</p>', plugins: [I.plugin(), ...hooks] });
  events.ready({ view });
  const run = async (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } await flush(); };
  const reply = (p, m) => p.onmessage?.({ data: m });
  const lint = (p = ports.at(-1)) => p.sent.findLast((m) => m.op === 'lint');
  return { proof, view, issues, ports, run, reply, lint, life, events, doc };
};

test('a first lint after idle reconnect is sent only once', async () => {
  const f = frame(); await flush();
  const p = f.ports[0]; f.reply(p, { op: 'lint', id: f.lint(p).id, lints: [] });
  f.reply(p, { op: 'closing' }); await f.run(25);
  f.view.dispatch(f.view.state.tr.insertText('x', 4)); await f.run(150);
  const sent = f.ports.at(-1).sent.filter((m) => m.op === 'lint');
  assert.equal(sent.length, 1);
});

test('a stale paragraph reply cannot flag a prefix of the word now being typed', async () => {
  const f = frame(); await flush();
  f.view.dispatch(f.view.state.tr.insertText('x', 4));
  f.reply(f.ports[0], { op: 'lint', id: f.lint().id, lints: [{ start: 0, end: 3, kind: 'Typo', problem: 'teh', suggestions: [{ k: 0, t: 'the' }] }] });
  // First focus lints the document; now take a paragraph request and edit again before its reply.
  await f.run(150); const req = f.lint();
  f.view.dispatch(f.view.state.tr.insertText('y', 5));
  f.reply(f.ports[0], { op: 'lint', id: req.id, lints: [{ start: 0, end: 4, kind: 'Spelling', problem: 'tehx', suggestions: [{ k: 0, t: 'the' }] }] });
  assert.equal(f.issues.list().length, 0);
});

test('a constructor failure uses the per-frame Worker fallback, and pagehide releases it', async () => {
  const f = frame({ throwShared: true }); await flush();
  assert.equal(f.proof.mode, 'worker');
  f.life.pagehide();
  assert.ok(f.ports[0].terminated);
});

test('a missing SharedWorker uses a Worker and closes its port on pagehide', async () => {
  const f = frame({ noShared: true }); await flush();
  assert.equal(f.proof.mode, 'worker'); f.life.pagehide();
  assert.ok(f.ports[0].terminated);
});

test('decide cannot apply a verdict after the surrounding sentence changes', async () => {
  const f = frame({ html: '<p></p>' }); await flush();
  const plugin = f.view.state.plugins.find((p) => p.spec.key === P.key);
  for (const ch of 'Their going home. ') {
    const { from, to } = f.view.state.selection;
    if (!plugin.props.handleTextInput(f.view, from, to, ch)) f.view.dispatch(f.view.state.tr.insertText(ch));
  }
  let resolve;
  f.proof.decide = () => new Promise((r) => { resolve = r; });
  await f.run(150);
  f.reply(f.ports[0], { op: 'lint', id: f.lint().id, lints: [{ start: 0, end: 5, kind: 'Grammar', problem: 'Their', suggestions: [{ k: 0, t: "They're" }] }] });
  assert.equal(typeof resolve, 'function');
  f.view.dispatch(f.view.state.tr.insertText('going home was surprising. ', 7, f.view.state.doc.content.size - 1));
  resolve('apply'); await flush();
  assert.equal(f.view.state.doc.textContent, 'Their going home was surprising. ');
});
