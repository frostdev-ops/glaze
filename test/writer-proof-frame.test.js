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
  const issues = { ...I.bind(view), look: I.look };
  const context = options.context || {};
  const defaults = require('../defaults.js').GZ_DEFAULTS.writer;
  let preferences = { ...defaults }, follow;
  const settings = { now: () => preferences, clean: () => defaults, follow: (fn) => { follow = fn; } };
  const configure = (patch) => { const was = preferences; preferences = { ...was, ...patch }; follow(preferences, was); };
  const api = { t: (k) => k, kind: () => 'reply', context: () => context, slot: () => null,
    plugin: (p) => hooks.push(p), on: (k, f) => { events[k] = f; } };
  const makePort = () => { const p = { sent: [], postMessage(m) { this.sent.push(m); }, start() {}, close() { this.closed = true; }, terminate() { this.terminated = true; }, addEventListener() {} }; ports.push(p); return p; };
  const ctx = vm.createContext({ GZ_WRITER_FRAME: api, GZ_WRITER_SETTINGS: settings, GZ_WRITER_PROOF: proof, GZ_WRITER_ISSUES: issues, GZ_PM,
    document: doc, innerWidth: 800, innerHeight: 300, console,
    setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms }); return tid; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (k, fn) => { life[k] = fn; },
    SharedWorker: options.noShared ? undefined : class { constructor() { if (options.throwShared) throw Error('SharedWorker disabled'); this.port = makePort(); } addEventListener() {} },
    Worker: class { constructor() { return makePort(); } },
    navigator: { locks: options.locks },
    chrome: { storage: { local: options.store || { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(require.resolve('../writer-proof.js'), 'utf8'), ctx);
  view.state = E.state({ html: options.html || '<p>teh</p>', plugins: [I.plugin(), ...hooks] });
  events.ready({ view });
  const run = async (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } await flush(); };
  const reply = (p, m) => p.onmessage?.({ data: m });
  const lint = (p = ports.at(-1)) => p.sent.findLast((m) => m.op === 'lint');
  return { proof, view, issues, ports, run, reply, lint, life, events, doc, configure };
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

test('full and paragraph lints skip course codes and URL fragments, while retaining a nearby typo', async () => {
  const text = 'ENG1100-008 https://doi.org/10.5555/pgph.123 apsac.org/wp/file.pdf e0001091 and recieve.';
  const lints = ['ENG1100', 'pgph', 'wp', 'pdf', 'e0001091', 'recieve'].map((problem) => ({
    start: text.indexOf(problem), end: text.indexOf(problem) + problem.length, kind: 'Spelling', problem, suggestions: [{ k: 0, t: 'wrong' }],
  }));
  const f = frame({ html: `<p>${text}</p>` }); await flush();
  const reply = () => f.reply(f.ports[0], { op: 'lint', id: f.lint().id, lints });
  reply();
  assert.deepEqual(f.issues.list().map((i) => i.text), ['recieve']);
  f.view.dispatch(f.view.state.tr.insertText(' ', text.length + 1)); await f.run(150);
  reply();
  assert.deepEqual(f.issues.list().map((i) => i.text), ['recieve']);
});

test('a late spelling reply cannot flag text that has since become part of an address', async () => {
  const f = frame({ html: '<p>recieve</p>' }); await flush();
  const id = f.lint().id;
  f.view.dispatch(f.view.state.tr.insertText('https://example.test/', 1));
  f.reply(f.ports[0], { op: 'lint', id, lints: [{ start: 0, end: 7, kind: 'Spelling', problem: 'recieve', suggestions: [{ k: 0, t: 'receive' }] }] });
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

test('the autocorrect Undo stays available while it has keyboard focus', async () => {
  const f = frame({ html: '<p></p>' }); await flush();
  const plugin = f.view.state.plugins.find((p) => p.spec.key === P.key);
  for (const ch of 'teh ') {
    const { from, to } = f.view.state.selection;
    if (!plugin.props.handleTextInput(f.view, from, to, ch)) f.view.dispatch(f.view.state.tr.insertText(ch));
  }
  const pop = f.doc.body.querySelector('.gp-fix'), button = pop.querySelector('button');
  assert.equal(pop.hidden, false);
  button.focus(); pop.dispatchEvent({ type: 'focusin' }); await f.run(4000);
  assert.equal(pop.hidden, false, 'a focused action must not disappear on its timer');
  pop.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  assert.equal(pop.hidden, true);
});


test('simultaneous dictionary additions in two frames are both persisted', async () => {
  let stored = [], chain = Promise.resolve();
  const locks = { request: (_name, fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; } };
  const store = { get: async () => ({ writerWords: stored.slice() }), set: async (v) => { stored = v.writerWords; } };
  const a = frame({ html: '<p>Sethe</p>', locks, store }), b = frame({ html: '<p>Glazeville</p>', locks, store });
  await flush();
  const add = async (f, word) => {
    f.issues.set('harper', [{ from: 1, to: word.length + 1, kind: 'spelling' }]);
    const span = new El('span', f.doc); span.className = 'gz-iss'; span.dataset.issue = f.issues.list()[0].id;
    f.view.dom.dispatchEvent({ type: 'mouseover', target: span }); await f.run(200);
    return f.doc.body.querySelectorAll('button').find((e) => e.textContent === 'Add to dictionary');
  };
  const [x, y] = await Promise.all([add(a, 'Sethe'), add(b, 'Glazeville')]);
  x.dispatchEvent({ type: 'click' }); y.dispatchEvent({ type: 'click' }); await flush();
  assert.deepEqual(stored.slice().sort(), ['Glazeville', 'Sethe']);
});

test('proofing reconnects when a cached page returns after pagehide', async () => {
  const f = frame(); await flush();
  f.life.pagehide();
  f.life.pageshow?.({ persisted: true }); await flush();
  f.view.dispatch(f.view.state.tr.insertText('x', 4)); await f.run(150);
  assert.equal(f.ports.length, 2);
  assert.ok(f.ports[1].sent.some((m) => m.op === 'lint'));
});

test('disabled proofing stays quiet through context updates and cached-page restoration', async () => {
  const f = frame(); await flush();
  f.configure({ proofing: false });
  const before = f.ports.flatMap((p) => p.sent).filter((m) => m.op === 'lint').length;
  f.events.context({ course: { name: 'New course' } }); await f.run(50);
  assert.equal(f.ports.flatMap((p) => p.sent).filter((m) => m.op === 'lint').length, before);
  f.life.pagehide(); f.life.pageshow({ persisted: true }); await flush();
  assert.equal(f.ports.length, 1, 'restoration cannot restart disabled proofing');
  f.configure({ proofing: true }); await flush();
  assert.equal(f.ports.length, 2, 'turning it back on resumes proofing');
});

test('disabling proofing during its dictionary read prevents a late worker start', async () => {
  let finish;
  const f = frame({ store: { get: () => new Promise((r) => { finish = r; }) } });
  f.configure({ proofing: false }); finish({ writerWords: [] }); await flush();
  assert.equal(f.ports.length, 0);
  f.configure({ proofing: true }); await flush();
  finish({ writerWords: [] }); await flush();
  assert.equal(f.ports.length, 1);
});

test('a dialect change discards outstanding results from the old dialect', async () => {
  const f = frame({ html: '<p>colour</p>' }); await flush();
  const old = f.lint();
  f.configure({ dialect: 'en-GB' });
  f.reply(f.ports[0], { op: 'lint', id: old.id, lints: [{ start: 0, end: 6, kind: 'Spelling', problem: 'colour', suggestions: [{ k: 0, t: 'color' }] }] });
  assert.equal(f.issues.list().length, 0, 'American findings cannot land after British was selected');
  assert.notEqual(f.lint().id, old.id);
});

test('Alt+Enter reaches the visible autocorrect Undo with the keyboard', async () => {
  const f = frame({ html: '<p></p>' }); await flush();
  const plugin = f.view.state.plugins.find((p) => p.spec.key === P.key);
  for (const ch of 'teh ') {
    const { from, to } = f.view.state.selection;
    if (!plugin.props.handleTextInput(f.view, from, to, ch)) f.view.dispatch(f.view.state.tr.insertText(ch));
  }
  const pop = f.doc.body.querySelector('.gp-fix'), undo = pop.querySelector('button');
  assert.ok(!pop.hidden);
  const event = { key: 'Enter', keyCode: 13, altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, preventDefault() {} };
  assert.ok(f.view.state.plugins.some((p) => p.props.handleKeyDown?.(f.view, event)));
  assert.equal(f.doc.activeElement, undo);
  await f.run(4000);
  assert.ok(!pop.hidden);
});
