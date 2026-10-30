// The frame's admission and async races, without a browser or a provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../writer-ai.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const until = async (f, ms = 2000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 5)); return f(); };
const plain = (v) => JSON.parse(JSON.stringify(v));
// pace: how many times faster than real time the frame's timers run.
function frame({ answer = () => ({ allowed: true, ready: true }), settings: start, context: initialContext = { kind: 'reply' }, clock, mode = 'compose', format, look, pace = 1, hidden = false, safari = false } = {}) {
  class Element {
    constructor() { this.style = {}; this.attrs = {}; this.children = []; this.hidden = false; this.listeners = {}; }
    get textContent() { return (this.text || '') + this.children.map((c) => (c && typeof c === 'object' ? c.textContent : String(c))).join(' '); }
    set textContent(v) { this.text = String(v); this.children = []; }
    append(...es) { this.children.push(...es); for (const e of es) if (e && typeof e === 'object') e.parentNode = this; }
    setAttribute(k, v) { this.attrs[k] = v; }
    removeAttribute(k) { delete this.attrs[k]; }
    toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
    addEventListener(type, f) { this.listeners[type] = f; } remove() {} contains() { return false; } focus() {}
    querySelector() { return null; }
  }
  const hooks = {}, sent = [], receives = [], pendingStatus = [], pendingRun = [], said = [], ports = [];
  let ctx = initialContext, settings = start || { on: true, use: 'main', features: { completion: true, writing: true } }, holdStatus = false;
  const opened = [];
  const doc = { content: { size: 10 }, textBetween: () => 'draft words' };
  const interaction = { dispatch: 0, focus: 0 };
  const ed = { view: { state: { doc }, dispatch() { interaction.dispatch++; }, focus() { interaction.focus++; } } };
  const sandbox = { GZ_AI_FAILURE: require('../lib/ai/failure.js'), navigator: { platform: 'MacIntel' }, document: { hidden, createElement: () => new Element(), body: new Element(), addEventListener(type, f) { hooks[`document:${type}`] = f; } },
    addEventListener(type, f) { hooks[`window:${type}`] = f; }, requestAnimationFrame: (f) => f(), setTimeout: (f, ms, ...a) => setTimeout(f, ms / pace, ...a).unref(), clearTimeout, setInterval, clearInterval,
    GZ_PM: { state: { Plugin: class { constructor(spec) { this.spec = spec; } }, PluginKey: class { getState() { return null; } } }, view: {}, transform: { Mapping: class { appendMapping() {} map(v) { return v; } } } },
    GZ_WRITER_SCHEMA: { text: () => ({ text: 'draft words', posAt: (v) => v }) }, GZ_WRITER_PROOF: {},
    GZ_AI_WRITER: require('../lib/ai/tasks/writer-context.js'), GZ_WRITER_SOURCES: require('../lib/writer-sources.js'),
    GZ_WRITER_PAPER: format ? { current: () => ({ format: () => format, ...(look && { look }) }) } : undefined,
    GZ_WRITER_FRAME: { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), kind: () => 'reply', context: () => ctx, editor: () => ed, mode: () => mode,
      on: (ev, f) => { hooks[ev] = f; }, handle: (type, f) => { hooks[`page:${type}`] = f; }, say: (m) => said.push(m), plugin(p) { hooks.plugin = p.spec; }, slot: () => new Element(), item: () => new Element() },
    chrome: { storage: { local: { get: async () => ({ ai: structuredClone(settings) }), set: async ({ ai }) => { settings = structuredClone(ai); hooks.storage({ ai: { newValue: settings } }, 'local'); } }, onChanged: { addListener(f) { hooks.storage = f; } } }, runtime: { connect() {
      const p = { retired: false, disconnected: false, messages: [], receive: null,
        onMessage: { addListener: (f) => { receives.push(f); p.receive = f; } }, onDisconnect: { addListener(f) { p.disconnectedListener = f; } },
        disconnect() { p.disconnected = true; p.disconnectedListener?.(); }, postMessage(m) {
        sent.push(m);
        p.messages.push(m);
        if (p.retired) return; // Safari can leave a quiescent port inert without reporting onDisconnect.
        // An answer of null is never sent; one with its own type (an error) goes as that.
        if (m.op === 'status') { const a = holdStatus ? null : answer(m); if (holdStatus) pendingStatus.push(m); else if (a) queueMicrotask(() => reply({ id: m.id, type: 'status', ...a })); }
        if (m.op === 'run') pendingRun.push(m);
        if (m.op === 'warm') queueMicrotask(() => reply({ id: m.id, type: 'warmed', ok: true }));
      } };
      ports.push(p); return p;
    }, getURL: (p) => `${safari ? 'safari-web-extension' : 'chrome-extension'}://x/${p}`, onMessage: { addListener: (f) => { hooks.runtime = f; } } },
    tabs: { create: async (o) => { opened.push(o.url); } } } };
  if (clock) sandbox.Date = class extends Date { static now() { return clock.t; } };
  const reply = (m) => receives.forEach((f) => f(m));
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const ai = sandbox.GZ_WRITER_AI;
  const panel = (opts) => { const host = new Element(); return sandbox.GZ_WRITER_AI.feedbackView(host, opts); };
  const pane = (opts) => panel(opts).el;
  return { ai, sent, said, pendingStatus, pendingRun, reply, hooks, opened, pane, panel, interaction, ports, proof: sandbox.GZ_WRITER_PROOF,
    start: async () => { hooks.ready(); await flush(); },
    off: () => { settings.on = false; hooks.storage({ ai: { newValue: structuredClone(settings) } }, 'local'); },
    context: (c) => { ctx = c; hooks.context(c); }, hold: () => { holdStatus = true; },
    visibility: (value) => { sandbox.document.hidden = value; hooks['document:visibilitychange'](); }, destroy: () => hooks.plugin.view().destroy() };
}

test('a box whose gray text may run warms the model for writer.complete as it opens, both ways it asks; none when it may not', async () => {
  // Owner, 2026-10-27: "I think the model should be loaded into memory when the writer opens a new assignment."
  const warms = (f) => f.sent.filter((m) => m.op === 'warm');
  const f = frame(); await f.start();
  assert.deepEqual(warms(f).map((m) => [m.feature, m.task, / $/.test(m.input.before)]), [['completion', 'writer.complete', true], ['completion', 'writer.complete', false]]);
  assert.ok(warms(f).every((m) => m.input.context && m.input.kind === 'reply'), 'with the page\'s context, as a run sends it');
  const off = frame({ settings: { on: true, use: 'main', features: { completion: false, writing: true } } }); await off.start();
  assert.equal(warms(off).length, 0, 'completion off');
  const no = frame({ answer: (m) => (m.feature === 'completion' ? { allowed: false, why: 'attempt' } : { allowed: true, ready: true }) }); await no.start();
  assert.equal(warms(no).length, 0, 'refused here');
});

test('Safari opens a fresh idle AI port when the old worker retired without onDisconnect, without replaying a run', async () => {
  const f = frame({ safari: true }); await f.start();
  const retired = f.ports.at(-1), count = f.ports.length;
  retired.retired = true;
  const work = f.ai.requirements('Write 250 words.');
  try {
    await flush();
    assert.equal(f.ports.length, count + 1, 'a new request batch must not be posted to a quiescent Safari port');
    assert.equal(retired.disconnected, true);
    assert.equal(retired.messages.some((m) => m.op === 'run'), false);
    const job = f.pendingRun[0]; assert.equal(job.task, 'writer.requirements');
    f.reply({ id: job.id, type: 'end', output: { minWords: 250 } });
    assert.deepEqual(plain(await work), { minWords: 250 });
    assert.equal(f.sent.filter((m) => m.op === 'run').length, 1, 'one request, no automatic inference replay');
  } finally { f.off(); await flush(); await work; }
});

test('Safari keeps concurrent pending requests on the same port until every waiter has completed', async () => {
  const f = frame({ safari: true }); await f.start();
  const first = f.ai.requirements('Write 250 words.'), count = f.ports.length;
  const second = f.ai.cite({ text: 'A source title' });
  try {
    assert.equal(f.ports.length, count);
    const [a, b] = f.pendingRun;
    f.reply({ id: a.id, type: 'end', output: { minWords: 250 } }); await first;
    const third = f.ai.requirements('Write 300 words.');
    assert.equal(f.ports.length, count, 'the second pending task still owns the active connection');
    const c = f.pendingRun.at(-1);
    f.reply({ id: b.id, type: 'end', output: { title: 'A source title' } });
    f.reply({ id: c.id, type: 'end', output: { minWords: 300 } });
    assert.deepEqual(plain(await second), { title: 'A source title' });
    assert.deepEqual(plain(await third), { minWords: 300 });
  } finally { f.off(); await flush(); await first; await second; }
});

test('messages from an obsolete AI port cannot resolve a current request', async () => {
  const f = frame(); await f.start();
  const obsolete = f.ports.at(-1);
  await f.ai.refresh(); await flush();
  let settled = false;
  const work = f.ai.requirements('Write 250 words.').then((value) => { settled = true; return value; });
  try {
    const job = f.pendingRun.at(-1);
    obsolete.receive({ id: job.id, type: 'end', output: { minWords: 999 } }); await flush();
    assert.equal(settled, false, 'late events are fenced by their connection, in addition to request ID');
    f.ports.at(-1).receive({ id: job.id, type: 'end', output: { minWords: 250 } });
    assert.deepEqual(plain(await work), { minWords: 250 });
  } finally { f.off(); await flush(); await work; }
});

test('Chrome continues to reuse its healthy idle AI port', async () => {
  const f = frame(); await f.start();
  const count = f.ports.length;
  for (const minWords of [250, 300]) {
    const work = f.ai.requirements(`Write ${minWords} words.`), job = f.pendingRun.at(-1);
    f.reply({ id: job.id, type: 'end', output: { minWords } }); await work;
  }
  assert.equal(f.ports.length, count);
  f.off(); await flush();
});

test('AI outline uses the writing route independently of Feedback’s switch and discards replies after opt-out', async () => {
  const f = frame({ mode: 'paper', settings: { on: true, model: { use: 'openai', model: 'default' }, models: { writing: { use: 'groq', model: 'feedback-model' } }, features: {} } });
  await f.start();
  assert.equal(f.ai.outlineInfo().enabled, true);
  const input = { blocks: [{ id: 'b0', kind: 'paragraph', text: 'An existing paragraph.' }] };
  const first = f.ai.outline(input); await flush();
  const run = f.pendingRun.at(-1);
  assert.equal(run.feature, 'writing'); assert.equal(run.task, 'writer.outline');
  assert.ok(f.sent.some((m) => m.op === 'status' && m.task === 'writer.outline'));
  const output = { sections: [{ heading: 'An argument', level: 1, start: 'b0', end: 'b0' }] };
  f.reply({ id: run.id, type: 'end', output }); assert.deepEqual(plain(await first), output);
  const late = f.ai.outline(input); await flush();
  await f.ai.setOutline(false); await flush();
  assert.equal(f.ai.outlineInfo().enabled, false); assert.equal(await late, null);
  assert.equal(await f.ai.outline(input), null);
});

test('outline cache identity survives frame reloads and resolves independently of Feedback consent', async () => {
  const identity = '["mock","main","feedback-model",3,[],null]';
  for (const writing of [true, false]) {
    const opts = { mode: 'paper', settings: { on: true, model: { use: 'main', model: 'feedback-model' }, features: { writing } },
      answer: () => ({ allowed: true, ready: true, provider: 'mock', identity }) };
    const first = frame(opts), reloaded = frame(opts);
    await first.start(); await reloaded.start();
    assert.equal(first.ai.outlineInfo().identity, identity);
    assert.equal(reloaded.ai.outlineInfo().identity, identity);
    if (!writing) assert.equal(first.ai.allowed('writing'), false, 'checking the independent outline must not enable Feedback');
    first.destroy(); reloaded.destroy();
  }
});

test('a fresh outline model identity discards the old cache before inference and rejects old in-flight output', async () => {
  for (const writing of [true, false]) {
    let identity = 'model-A';
    const f = frame({ mode: 'paper', settings: { on: true, model: { use: 'device' }, features: { writing } },
      answer: () => ({ allowed: true, ready: true, provider: 'device', identity }) });
    await f.start();
    const input = { blocks: [{ id: 'b0', kind: 'paragraph', text: 'Plants need sunlight.' }],
      cached: [{ heading: 'Model A title', role: 'body', level: 1, start: 'b0', end: 'b0' }] };
    const first = f.ai.outline(input, { identity }); await flush();
    const old = f.pendingRun.at(-1);
    identity = 'model-B';
    const changed = f.ai.outline(input, { identity: 'model-A' }); await flush();
    assert.equal(f.pendingRun.length, 1, 'model A cached labels never reach model B');
    assert.equal(await changed, null);
    assert.equal(f.ai.outlineInfo().identity, 'model-B', 'the controller can rebuild under the fresh identity');
    f.reply({ id: old.id, type: 'end', output: { sections: input.cached } });
    assert.equal(await first, null, 'an old-model result cannot be accepted after identity changes');
    const rebuilt = f.ai.outline({ ...input, cached: [] }, { identity }); await flush();
    const current = f.pendingRun.at(-1);
    assert.equal(f.pendingRun.length, 2); assert.deepEqual(plain(current.input.cached), []);
    f.reply({ id: current.id, type: 'end', output: { sections: [] } }); await rebuilt;
    f.destroy();
  }
});

test('a failed fresh outline status keeps its reason even when a cached identity is present', async () => {
  let unavailable = false;
  const f = frame({ mode: 'paper', settings: { on: true, model: { use: 'device' }, features: { writing: true } },
    answer: () => unavailable ? { allowed: true, ready: false, why: 'download' } : { allowed: true, ready: true, identity: 'model-A' } });
  await f.start(); unavailable = true;
  await assert.rejects(f.ai.outline({ blocks: [] }, { identity: 'model-A' }), { error: 'download' });
  assert.equal(f.pendingRun.length, 0); f.destroy();
});

test('cancelling an outline stops its pending request and never accepts a late result', async () => {
  const f = frame({ mode: 'paper', settings: { on: true, model: { use: 'device' }, features: {} } }); await f.start();
  const c = new AbortController(), request = f.ai.outline({ blocks: [] }, { signal: c.signal }); await flush();
  const run = f.pendingRun.at(-1); c.abort();
  assert.equal(await request, null); assert.ok(f.sent.some((m) => m.op === 'cancel' && m.id === run.id));
});

test('failed assessments show the available reason instead of only a generic feedback error', async () => {
  for (const [error, why] of [['timeout', 'Timed out'], ['connection-lost', 'Connection lost'], ['check', 'No usable answer']]) {
    const f = frame({ mode: 'paper' }); await f.start();
    f.context({ kind: 'assignment', assignment: { instructions: 'Explain the claim.' } }); await flush();
    const job = f.ai.feedback(); await flush();
    const run = f.pendingRun.at(-1); f.reply({ id: run.id, type: 'error', error }); await job;
    assert.ok(f.pane().textContent.includes(why));
  }
});

test('Feedback shows safe measured token counts and planning counts with their distinct reasons', async () => {
  for (const detail of [{ reason: 'context', tokens: 9500, context: 9216 }, { reason: 'response-context', phase: 'response', tokens: 4000, context: 9216 }, { reason: 'feedback-calls', actual: 65, limit: 64 }]) {
    const f = frame({ mode: 'paper' }); await f.start();
    f.context({ kind: 'assignment', assignment: { instructions: 'Explain the claim.' } }); await flush();
    const job = f.ai.feedback(); await flush();
    f.reply({ id: f.pendingRun.at(-1).id, type: 'error', error: 'size', ...detail }); await job;
    assert.ok(f.pane().textContent.includes(detail.tokens ? `(${detail.tokens}/${detail.context} tokens)` : '(65/64)'));
    assert.ok(f.pane().textContent.includes(require('../lib/ai/failure.js').explain(detail)));
  }
});

test('decide and the proof hook preserve the original candidate index, including duplicate candidates and keep', async () => {
  const f = frame(); await f.start();
  for (const [verdict, choice, expected] of [['apply', "they're", { verdict: 'apply', choice: 2 }], ['suggest', "they're", { verdict: 'suggest', choice: 2 }], ['keep', null, { verdict: 'keep', choice: -1 }]]) {
    const result = f.proof.decide({ text: 'They put there coats down.', from: 9, to: 14, suggestions: ['their', 'their', "they're"] });
    f.reply({ id: f.pendingRun.at(-1).id, type: 'end', output: { verdict, choice } });
    assert.deepEqual(plain(await result), expected);
  }
});

test('source identity enrichment and duplicate context messages preserve a pending AI ruling', async () => {
  const own = { prompt: 'Reading Journal' }, f = frame({ context: own }); await f.start();
  const before = f.sent.filter((m) => m.op === 'status').length;
  const result = f.proof.decide({ text: 'Their going home.', from: 0, to: 5, suggestions: ["They're"], context: own });
  const id = f.pendingRun.at(-1).id;
  const full = { ...own, school: 'bb.school.test', course: { id: '_101_1' }, item: { id: '_12_1' }, user: null };
  f.context(full);
  f.context({ ...full, user: { id: '_42_1' } });
  f.context({ ...full, user: { id: '_42_1' } });
  await flush();
  f.reply({ id, type: 'end', output: { verdict: 'apply', choice: "They're" } });
  assert.deepEqual(plain(await result), { verdict: 'apply', choice: 0 });
  assert.equal(f.sent.filter((m) => m.op === 'status').length, before, 'metadata re-sends do not restart AI admission');
});

test('changing a known source scope or prompt still cancels a pending AI ruling', async () => {
  const own = { prompt: 'Reading Journal', school: 'bb.school.test', course: { id: '_101_1' }, item: { id: '_12_1' }, user: { id: '_42_1' } };
  for (const next of [{ ...own, user: { id: '_43_1' } }, { ...own, user: null }, { ...own, prompt: 'A different prompt' }]) {
    const f = frame({ context: own }); await f.start();
    const result = f.proof.decide({ text: 'Their going home.', from: 0, to: 5, suggestions: ["They're"] });
    const id = f.pendingRun.at(-1).id;
    f.context(next); await flush();
    f.reply({ id, type: 'end', output: { verdict: 'apply', choice: "They're" } });
    assert.equal(await result, null);
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

test('a frame refused before the worker knew the attempt was an assignment asks again when the page says so', async () => {
  let known = false;
  const f = frame({ answer: (m) => (m.feature === 'writing' && !known ? { on: true, allowed: false, why: 'attempt' } : { on: true, allowed: true, ready: true }) });
  await f.start();
  assert.equal(f.ai.allowed('writing'), false);
  assert.match(f.pane().textContent, /Checking whether AI can run here…/, 'nothing alarming while the attempt is being checked');
  known = true;
  assert.equal(typeof f.hooks['page:ai'], 'function', 'the frame listens for the page\'s word');
  f.hooks['page:ai'](); await flush();
  assert.equal(f.ai.allowed('writing'), true);
  assert.doesNotMatch(f.pane().textContent, /Checking|Settings/);
});

test('Feedback says why AI can\'t give it, with Settings → AI one click away where the student can change it', async () => {
  const on = { on: true, model: { use: 'main', model: 'gpt-x' }, features: { completion: true, writing: true } };
  const cases = [
    [{ ...on, on: false }, undefined, /^AI is off\. Turn it on in Settings → AI\./, true],
    [{ ...on, features: { completion: true, writing: false } }, undefined, /^Feedback is off\. Turn it on in Settings → AI\./, true],
    // No model chosen for Feedback: the worker's status says so (lib/ai/settings.js resolve).
    [{ ...on, model: { use: 'openrouter', model: '' } }, { allowed: true, ready: false, why: 'setup' }, /^No AI model is chosen\. Choose one in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'permission', to: 'openrouter.ai' }, /^Glaze needs permission to reach openrouter\.ai\. Allow it in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'download', provider: 'device' }, /^The on-device model isn’t downloaded\. Download it in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'downloading', provider: 'device' }, /^Downloading the model…/, false],
    [on, { allowed: true, ready: false, why: 'unavailable', provider: 'device' }, /^Chrome on-device AI is unavailable\. Choose another model in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'unavailable', provider: 'apple', reason: 'off' }, /^Apple Intelligence is off\. Turn it on in System Settings\./, false],
    [on, { type: 'error', error: 'failed' }, /^Glaze couldn’t confirm this page may use AI\. Reload the page to try again\./, false],
  ];
  for (const [settings, st, text, button] of cases) {
    const f = frame({ settings, answer: () => ({ on: settings.on, ...st }) }); await f.start();
    const pane = f.pane(), go = pane.children.find((c) => c.className === 'gz-fb-run' && c.textContent === 'Settings');
    assert.match(pane.textContent, text, JSON.stringify(st || settings));
    assert.equal(!!go, button, `a Settings button: ${text}`);
    if (go) { go.listeners.click(); assert.deepEqual(f.opened, ['chrome-extension://x/options.html#ai/setup']); }
  }
});

test('an attempt Glaze can\'t confirm as an assignment says so after its wait: AI runs on assignments, never on tests', async () => {
  const clock = { t: 1000 };
  const f = frame({ clock, answer: () => ({ on: true, allowed: false, why: 'attempt' }) }); await f.start();
  assert.match(f.pane().textContent, /^Checking whether AI can run here…/);
  clock.t += 10001;
  const pane = f.pane();
  assert.match(pane.textContent, /^AI is only available on confirmed assignments, never on tests\./);
  assert.equal(pane.children.some((c) => c.className === 'gz-fb-run'), false, 'nothing in Settings changes it');
});

test('Feedback as the mockup draws it: a head row with the run button in every state, skeletons while it reads, cards with status, level and page, an error card', async () => {
  const f = frame(); await f.start();
  f.context({ kind: 'assignment', assignment: { instructions: 'Write three things you learned.' } }); await flush();
  const all = (n, c, out = []) => { if (n && typeof n === 'object') { if (String(n.className || '').split(' ').includes(c)) out.push(n); for (const x of n.children) all(x, c, out); } return out; };
  const one = (n, c) => all(n, c)[0];
  let p = f.pane();
  const head = one(p, 'gz-fb-head');
  assert.ok(head && one(head, 'gz-fb-run'), 'the run button sits in the head row, not alone in the pane\'s corner');
  assert.equal(one(head, 'gz-fb-sum').textContent.trim(), 'Not run yet');
  assert.equal(one(head, 'gz-fb-run').textContent, 'Get feedback');
  f.ai.feedback(); await flush();
  p = f.pane();
  assert.match(one(p, 'gz-fb-run').textContent, /Reading your draft…/);
  assert.equal(all(p, 'gz-fb-skel').length, 3, 'three skeleton cards while it reads');
  f.reply({ id: f.pendingRun.at(-1).id, type: 'end', output: { criteria: [
    { id: 'a', label: 'Thesis', status: 'met', comment: 'Clear.', quotes: [{ start: 0, end: 11, quote: 'draft words' }], level: { label: 'Proficient', value: 9, points: 10 } },
    { id: 'b', label: 'Evidence', status: 'partly', comment: 'Thin.', quotes: [], level: { label: 'Developing', value: null, points: null } },
    { id: 'c', label: 'Works Cited', status: 'missing', comment: 'None yet.', quotes: [], level: null }] } });
  await flush();
  p = f.pane({ pageAt: () => 2 });
  assert.equal(one(p, 'gz-fb-sum').textContent.replace(/\s+/g, ' ').trim(), '1 met 1 partly 1 missing');
  assert.equal(one(p, 'gz-fb-run').textContent, 'Check again');
  assert.deepEqual(all(p, 'gz-fb-item').map((c) => [one(c, 'gz-fb-chip').className, one(c, 'gz-fb-chip').textContent, one(c, 'gz-fb-crit').textContent, one(c, 'gz-fb-level')?.textContent || '']),
    [['gz-fb-chip met', 'Met', 'Thesis', 'Proficient · 9/10'], ['gz-fb-chip partly', 'Partly', 'Evidence', 'Developing'], ['gz-fb-chip missing', 'Missing', 'Works Cited', '']]);
  assert.equal(one(one(p, 'gz-fb-quote'), 'gz-fb-page').textContent, 'p. 2', 'a passage says its page in the paper');
  f.ai.feedback(); await flush();
  f.reply({ id: f.pendingRun.at(-1).id, type: 'error', error: 'failed' }); await flush();
  p = f.pane();
  const err = one(p, 'gz-fb-error');
  assert.ok(err && /AI couldn't give feedback\./.test(err.textContent) && one(err, 'gz-fb-run').textContent === 'Try again', 'an error is a card with Try again');
});

test('a paper\'s Feedback run carries the paper\'s layout, which the .docx has; compose sends none', async () => {
  const ST = require('../lib/writer-styles.js');
  const f = frame({ mode: 'paper', format: ST.get('mla9') }); await f.start();
  f.context({ kind: 'assignment', assignment: { description: 'Three things you learned.' } }); await flush();
  f.ai.feedback(); await flush();
  assert.deepEqual(plain(f.pendingRun.at(-1).input.paper), { format: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'name-page' });
  const c = frame(); await c.start();
  c.context({ kind: 'reply', assignment: { instructions: 'Discuss memory.' } }); await flush();
  c.ai.feedback(); await flush();
  assert.equal('paper' in c.pendingRun.at(-1).input, false);
});

test('Feedback asks the page for the assignment\'s attached files first and sends what it read; without files it asks nothing', async () => {
  const f = frame({ mode: 'paper', answer: () => ({ allowed: true, ready: true, caps: { images: false } }) }); await f.start();
  f.context({ kind: 'assignment', assignment: { instructions: 'The prompt is attached.', files: [{ name: 'prompt.docx', image: false }, { name: 'explore3.png', image: true }] } }); await flush();
  const runs = f.pendingRun.length;
  f.ai.feedback(); await flush();
  assert.deepEqual(plain(f.said), [{ type: 'attachments', id: 1, images: false }], 'pictures aren\'t asked for a model known to take none');
  assert.equal(f.pendingRun.length, runs, 'no run before the page answers');
  const read = [{ name: 'prompt.docx', text: 'Quote each scene at least once.' }];
  f.hooks['page:attachments']({ type: 'attachments', id: 1, files: read }); await flush();
  assert.deepEqual(plain(f.pendingRun.at(-1).input.context.assignment.files), read);
  const c = frame(); await c.start();
  c.context({ kind: 'assignment', assignment: { instructions: 'Discuss memory.', files: [] } }); await flush();
  c.ai.feedback(); await flush();
  assert.deepEqual([c.said.length, c.pendingRun.at(-1).task], [0, 'writer.feedback']);
});

const vision = () => ({ allowed: true, ready: true, provider: 'openai', model: 'vision-model', caps: { images: true } });
const imageContext = () => ({ kind: 'assignment', paper: { school: 'school.example', user: 'student-a', course: 'course-a', content: 'assignment-a' },
  assignment: { instructions: 'Explain the diagram.', files: [{ id: 'attachment-1', name: 'Diagram.png', image: true }] } });
const imageFiles = () => [{ id: 'attachment-1', name: 'Diagram.png', image: { mime: 'image/png', data: 'cGl4ZWxz' } }];
const imageReading = { description: 'A diagram of a growing plant.', requirements: [], complete: true, reason: '', relevance: 'relevant' };
const cancelFeedback = (f) => {
  const head = f.pane().children.find((c) => c.className === 'gz-fb-head');
  head.children.find((c) => c.textContent === 'Cancel').listeners.click();
};

test('a ready assignment quietly prepares image bytes before Feedback and reuses the preparation without editor interaction', async () => {
  const format = require('../lib/writer-styles.js').get('mla9');
  const f = frame({ mode: 'paper', format, answer: vision, pace: 100 }); await f.start();
  const context = imageContext();
  context.assignment.files.push({ id: 'attachment-2', name: 'Rubric.jpg', image: true });
  f.context(context);
  assert.equal(await until(() => f.said.length === 1), true, 'preparation starts before Get feedback is pressed');
  const files = [...imageFiles(), { id: 'attachment-2', name: 'Rubric.jpg', image: { mime: 'image/jpeg', data: 'cnVicmlj' } }];
  f.hooks['page:attachments']({ id: f.said[0].id, files }); await flush();
  const first = f.pendingRun[0];
  assert.deepEqual([first.task, first.feature, first.input.name], ['writer.image', 'writing', 'Diagram.png']);
  assert.deepEqual(plain(first.input.image), files[0].image);
  assert.equal('text' in first.input, false, 'the draft is absent from image preparation');
  assert.equal(f.pendingRun.length, 1, 'one image is prepared at a time');
  f.reply({ id: first.id, type: 'end', output: imageReading }); await flush();
  assert.deepEqual([f.pendingRun.length, f.pendingRun[1].input.name], [2, 'Rubric.jpg']);
  f.reply({ id: f.pendingRun[1].id, type: 'end', output: imageReading }); await flush();
  assert.deepEqual(f.interaction, { dispatch: 0, focus: 0 });
  const work = f.ai.feedback(); await flush();
  const assessment = f.pendingRun.at(-1);
  assert.equal(assessment.task, 'writer.feedback');
  assert.equal(f.said.length, 1, 'Feedback joins the attachment read as well as image preparation');
  assert.deepEqual(plain(assessment.input.context), plain(first.input.context));
  assert.deepEqual(plain(assessment.input.paper), plain(first.input.paper));
  assert.equal('description' in assessment.input.context.assignment.files[0], false, 'no visual description is accepted from the frame');
  f.reply({ id: assessment.id, type: 'end', output: { criteria: [] } }); await work;
  f.context(structuredClone(context)); await flush();
  for (let i = 0; i < 5; i++) f.ai.layoutChanged();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(f.said.length, 1, 'repeated context/status/layout notifications do not prepare the same snapshot again');
  assert.equal(f.pendingRun.filter((m) => m.task === 'writer.image').length, 2);
  f.off(); await flush();
});

test('background image preparation requires opted-in ready vision on a visible verified paper assignment', async () => {
  const cases = [
    { settings: { on: false, use: 'main', features: { writing: true } } },
    { settings: { on: true, use: 'main', features: { writing: false } } },
    { mode: 'compose' }, { hidden: true },
    { context: { ...imageContext(), kind: 'test' } },
    { context: { ...imageContext(), kind: 'reply' } },
    { context: { kind: 'assignment', assignment: { instructions: 'Write about plants.', files: [{ name: 'Prompt.txt' }] } } },
    { context: { kind: 'assignment', assignment: { files: [{ image: true }] } } },
    { answer: () => ({ allowed: false, ready: true, why: 'attempt', caps: { images: true } }) },
    { answer: () => ({ allowed: true, ready: false, why: 'setup', caps: { images: true } }) },
    { answer: () => ({ allowed: true, ready: false, why: 'download', provider: 'device', caps: { images: true } }) },
    { answer: () => ({ allowed: true, ready: true, caps: { images: false } }) },
    { answer: () => ({ allowed: true, ready: true }) },
  ];
  for (const options of cases) {
    const f = frame({ mode: 'paper', answer: vision, pace: 100, ...options }); await f.start();
    f.context(options.context || imageContext()); await flush();
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(f.said.length, 0, JSON.stringify(options.context || options.settings || options));
    assert.equal(f.pendingRun.length, 0);
    assert.equal(f.sent.some((m) => m.op === 'download'), false);
    f.off(); await flush();
  }
});

test('Feedback joins an in-flight background attachment read and image call before assessment', async () => {
  const f = frame({ mode: 'paper', answer: vision, pace: 100 }); await f.start();
  f.context(imageContext());
  assert.equal(await until(() => f.said.length === 1), true);
  const work = f.ai.feedback(); await flush();
  assert.equal(f.said.length, 1);
  assert.equal(f.pendingRun.length, 0);
  f.hooks['page:attachments']({ id: f.said[0].id, files: imageFiles() }); await flush();
  assert.deepEqual(f.pendingRun.map((m) => m.task), ['writer.image']);
  f.reply({ id: f.pendingRun[0].id, type: 'end', output: imageReading }); await flush();
  assert.deepEqual(f.pendingRun.map((m) => m.task), ['writer.image', 'writer.feedback']);
  f.reply({ id: f.pendingRun[1].id, type: 'end', output: { criteria: [] } }); await work;
  f.off(); await flush();
});

test('image-preparation errors leave completion and writing available and Feedback continues with the original attachments', async () => {
  const rejected = [], onRejected = (reason) => rejected.push(reason);
  process.on('unhandledRejection', onRejected);
  try {
    for (const error of ['connection-lost', 'unavailable', 'invalid-response', 'timeout']) {
      const f = frame({ mode: 'paper', answer: vision, pace: error === 'timeout' ? 1000 : 100 });
      try {
        await f.start(); f.context(imageContext());
        assert.equal(await until(() => f.said.length === 1), true);
        const files = imageFiles();
        f.hooks['page:attachments']({ id: f.said[0].id, files }); await flush();
        const image = f.pendingRun[0]; assert.equal(image.task, 'writer.image');
        const work = f.ai.feedback(); await flush();
        assert.equal(f.pendingRun.some((m) => m.task === 'writer.feedback'), false, 'Feedback joins the pending image job');
        const requirements = f.ai.requirements('Write 250 words.');
        const other = f.pendingRun.at(-1); assert.equal(other.task, 'writer.requirements');
        f.reply({ id: other.id, type: 'end', output: { minWords: 250 } });
        assert.deepEqual(plain(await requirements), { minWords: 250 }, 'another writing task can finish while image preparation is pending');
        if (error === 'timeout') {
          assert.equal(await until(() => f.pendingRun.some((m) => m.task === 'writer.feedback')), true, 'an unanswered image task has a finite frame deadline');
          assert.ok(f.sent.some((m) => m.op === 'cancel' && m.id === image.id));
        } else { f.reply({ id: image.id, type: 'error', error }); await flush(); }
        const assessment = f.pendingRun.at(-1);
        assert.equal(assessment.task, 'writer.feedback', error);
        assert.deepEqual(plain(assessment.input.context.assignment.files), files, 'preparation failure does not discard attachment evidence');
        assert.deepEqual([f.ai.allowed('completion'), f.ai.allowed('writing')], [true, true], error);
        f.reply({ id: assessment.id, type: 'end', output: { criteria: [] } }); await work;
        assert.equal(f.said.length, 1);
        assert.equal(f.pendingRun.filter((m) => m.task === 'writer.image').length, 1);
        assert.deepEqual([f.ai.allowed('completion'), f.ai.allowed('writing')], [true, true]);
      } finally { f.off(); await flush(); }
    }
    assert.deepEqual(rejected, [], 'background preparation and its Feedback join produce no unhandled rejection');
  } finally { process.removeListener('unhandledRejection', onRejected); }
});

test('Feedback starts pending image preparation immediately and Cancel stops either its attachment read or image job', async () => {
  for (const stage of ['attachments', 'image']) {
    const f = frame({ mode: 'paper', answer: vision }); await f.start();
    f.context(imageContext()); await flush();
    const work = f.ai.feedback(); await flush();
    assert.equal(f.said.length, 1, 'foreground joins the scheduled preparation without waiting for the debounce');
    const read = f.said[0];
    if (stage === 'image') { f.hooks['page:attachments']({ id: read.id, files: imageFiles() }); await flush(); }
    const image = f.pendingRun.at(-1);
    cancelFeedback(f); await work;
    if (image) assert.ok(f.sent.some((m) => m.op === 'cancel' && m.id === image.id));
    f.hooks['page:attachments']({ id: read.id, files: imageFiles() });
    if (image) f.reply({ id: image.id, type: 'end', output: imageReading });
    await flush();
    assert.equal(f.pendingRun.some((m) => m.task === 'writer.feedback'), false);
    assert.equal(f.pendingRun.filter((m) => m.task === 'writer.image').length, stage === 'image' ? 1 : 0);
    assert.match(f.pane().textContent, /Not run yet/);
    f.off(); await flush();
  }
});

test('settings, context, hiding, page exit and editor destruction cancel background image work and discard late replies', async () => {
  for (const change of [(f) => f.off(), (f) => f.context({ kind: 'test' }), (f) => f.visibility(true), (f) => f.hooks['window:pagehide'](), (f) => f.destroy()]) {
    const f = frame({ mode: 'paper', answer: vision, pace: 100 }); await f.start();
    f.context(imageContext());
    assert.equal(await until(() => f.said.length === 1), true);
    f.hooks['page:attachments']({ id: f.said[0].id, files: imageFiles() }); await flush();
    const image = f.pendingRun[0]; assert.equal(image.task, 'writer.image');
    change(f); await flush();
    assert.ok(f.sent.some((m) => m.op === 'cancel' && m.id === image.id));
    f.reply({ id: image.id, type: 'end', output: imageReading }); await flush();
    assert.equal(f.pendingRun.length, 1);
    f.off(); await flush();
  }
});

test('a hidden prefetch read is discarded and a visible assignment can prepare it again', async () => {
  const f = frame({ mode: 'paper', answer: vision, pace: 100 }); await f.start();
  f.context(imageContext()); assert.equal(await until(() => f.said.length === 1), true);
  const read = f.said[0];
  f.visibility(true);
  f.hooks['page:attachments']({ id: read.id, files: imageFiles() }); await flush();
  assert.equal(f.pendingRun.length, 0);
  f.visibility(false); assert.equal(await until(() => f.said.length === 2), true);
  f.hooks['page:attachments']({ id: f.said[1].id, files: imageFiles() }); await flush();
  assert.equal(f.pendingRun[0].task, 'writer.image');
  f.off(); await flush();
});

test('Feedback updates passage pages after layout without replacing its focused controls', async () => {
  const f = frame(); await f.start();
  f.context({ assignment: { instructions: 'Discuss memory.' } }); await flush();
  f.ai.feedback(); await flush();
  f.reply({ id: f.pendingRun.at(-1).id, type: 'end', output: { criteria: [
    { id: 'a', label: 'Memory', status: 'met', comment: '', quotes: [{ start: 0, end: 11, quote: 'draft words' }], level: null },
  ] } }); await flush();
  let number = 1;
  const panel = f.panel({ pageAt: () => number });
  const find = (n, cls) => n && typeof n === 'object' && (n.className === cls ? n : n.children.map((c) => find(c, cls)).find(Boolean));
  const passage = find(panel.el, 'gz-fb-quote'), page = find(passage, 'gz-fb-page');
  assert.equal(page.textContent, 'p. 1');
  number = 3; panel.updatePages?.();
  assert.equal(page.textContent, 'p. 3');
  assert.equal(find(panel.el, 'gz-fb-quote'), passage, 'the existing passage button keeps focus');
  number = 0; panel.updatePages();
  assert.equal(page.hidden, true, 'a passage without a current page shows no stale number');
});

test('a download in progress shows its share and checks again once it is in', async () => {
  let done = false;
  const f = frame({ answer: () => (done ? { allowed: true, ready: true, provider: 'device' } : { allowed: true, ready: false, why: 'downloading', provider: 'device' }) });
  await f.start();
  const pane = f.pane();
  f.hooks.runtime({ type: 'glaze:ai-config', event: 'progress', provider: 'device', loaded: 0.42 });
  assert.match(pane.textContent, /Downloading the model: 42%/);
  done = true;
  f.hooks.runtime({ type: 'glaze:ai-config', event: 'progress', provider: 'device', loaded: 1 }); await flush();
  assert.equal(f.ai.allowed('writing'), true);
});


test('a later attempt nudge rechecks both ready features and closes admission on refusal', async () => {
  let allowed = true;
  const f = frame({ answer: () => allowed ? { allowed: true, ready: true } : { allowed: false, why: 'attempt' } });
  await f.start();
  assert.equal(f.ai.allowed('writing'), true);
  assert.equal(f.ai.allowed('completion'), true);
  allowed = false;
  f.hooks['page:ai']();
  assert.equal(f.ai.allowed('writing'), false, 'admission closes before the asynchronous status check');
  await flush();
  assert.equal(f.ai.allowed('completion'), false);
  assert.equal(f.ai.allowed('writing'), false);
});

test('a feature whose status ask got no status asks again in the same generation; the other keeps its answer', async () => {
  // Safari, 2026-10-27: after a switch to the endpoint the gray text never ran while Feedback, asked a moment later, did.
  let lost = 1;
  const f = frame({ pace: 100, answer: (m) => (m.feature === 'completion' && lost-- > 0 ? { type: 'error', error: 'connection-lost' } : { allowed: true, ready: true }) });
  await f.start();
  const asks = (feature) => f.sent.filter((m) => m.op === 'status' && m.feature === feature).length;
  assert.equal(f.ai.allowed('writing'), true);
  assert.ok(lost <= 0, 'the first completion ask was answered with connection-lost');
  // The re-ask comes after the pace; on a loaded machine it may already have landed, so wait for it, not for a window.
  assert.equal(await until(() => asks('completion') === 2), true, 'asked again');
  assert.equal(await until(() => f.ai.allowed('completion')), true, 'and on');
  assert.deepEqual([asks('completion'), asks('writing')], [2, 1]);
  assert.ok(f.sent.some((m) => m.op === 'warm'), 'and warmed once it may run');
});

test('a recovered completion status stays ready when the initial writing status arrives later', async () => {
  let lost = true;
  const f = frame({ pace: 100, answer: (m) => {
    if (m.feature === 'writing') return null;
    if (lost) { lost = false; return { type: 'error', error: 'connection-lost' }; }
    return { allowed: true, ready: true };
  } });
  await f.start();
  assert.equal(await until(() => f.ai.allowed('completion')), true, 'completion recovers while writing is pending');
  const writing = f.sent.find((m) => m.op === 'status' && m.feature === 'writing');
  f.reply({ id: writing.id, type: 'status', allowed: true, ready: true });
  await flush();
  assert.equal(f.ai.allowed('writing'), true);
  assert.equal(f.ai.allowed('completion'), true, 'the earlier failed status must not replace its recovered answer');
  f.off();
});

test('a status ask the worker never answers ends after its bound, the next feature is asked, and it asks again', async () => {
  let silent = 1;
  const f = frame({ pace: 1000, answer: (m) => (m.feature === 'completion' && silent-- > 0 ? null : { allowed: true, ready: true }) });
  await f.start();
  assert.equal(await until(() => f.ai.allowed('writing') && f.ai.allowed('completion')), true);
});

test('a refusal for the attempt\'s kind is asked again, a few times, for the gray text as for Feedback, with no word from the page', async () => {
  let known = false;
  const f = frame({ pace: 100, answer: (m) => (m.feature === 'completion' && !known ? { on: true, allowed: false, why: 'attempt' } : { on: true, allowed: true, ready: true }) });
  await f.start();
  assert.equal(f.ai.allowed('completion'), false);
  assert.equal(f.ai.allowed('writing'), true);
  known = true;
  assert.equal(await until(() => f.ai.allowed('completion')), true);
  const never = frame({ pace: 1000, answer: (m) => (m.feature === 'completion' ? { on: true, allowed: false, why: 'attempt' } : { on: true, allowed: true, ready: true }) });
  await never.start();
  const asks = () => never.sent.filter((m) => m.op === 'status' && m.feature === 'completion').length;
  await until(() => asks() >= 6);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(asks(), 6, 'bounded: once, then five times more');
  assert.equal(never.ai.allowed('completion'), false);
});

test('Feedback on a known test gives the assignments-only reason instead of checking forever', async () => {
  const f = frame(); await f.start();
  f.context({ kind: 'test' }); await flush();
  assert.match(f.pane().textContent, /^AI is only available on confirmed assignments, never on tests\./);
  assert.equal(f.ai.allowed('completion'), false);
  assert.equal(f.ai.allowed('writing'), false);
});

test('an unavailable on-device provider does not claim this computer can never run it', async () => {
  for (const [provider, name] of [['device', 'Chrome on-device AI'], ['apple', 'Apple Intelligence']]) {
    const f = frame({ answer: () => ({ allowed: true, ready: false, why: 'unavailable', provider }) }); await f.start();
    assert.ok(f.pane().textContent.startsWith(`${name} is unavailable. Choose another model in Settings → AI.`));
  }
});

test('a transient local availability failure recovers without changing settings and displays its reason', async () => {
  let ready = false;
  const f = frame({ pace: 100, answer: () => ({ on: true, allowed: true, ready, why: ready ? undefined : 'unavailable', provider: 'device', reason: 'failed' }) });
  await f.start(); assert.match(f.pane().textContent, /could not check.*availability/);
  ready = true;
  assert.equal(await until(() => f.ai.allowed('writing')), true);
});

test('AI source extraction has independent consent and uses a cancellable Feedback-model task', async () => {
  const f = frame({ mode: 'paper', settings: { on: true, model: { use: 'device' }, sources: true, features: { writing: false } } });
  await f.start(); assert.equal(f.ai.sourcesInfo().enabled, true);
  const c = new AbortController(), request = f.ai.extractSource('Rivera. Garden Learning. 2024.', { signal: c.signal }); await flush();
  assert.equal(f.pendingRun.at(-1).task, 'writer.sources');
  c.abort(); assert.equal(await request, null);
  assert.ok(f.sent.some((m) => m.op === 'cancel'));
  await f.ai.setSourcesAI(false); assert.equal(f.ai.sourcesInfo().enabled, false);
});

test('staged Feedback progress is visible and Cancel stops the whole job', async () => {
  const f = frame({ mode: 'paper' }); await f.start();
  f.context({ kind: 'assignment', assignment: { instructions: 'Explain the claim.' } }); await flush();
  const work = f.ai.feedback(); await flush(); const job = f.pendingRun.at(-1);
  f.reply({ id: job.id, type: 'note', stage: 'criterion', part: 2, parts: 3 });
  const pane = f.pane(); assert.match(pane.textContent, /Checking criterion 2 of 3/);
  const head = pane.children.find((c) => c.className === 'gz-fb-head'), cancel = head.children.find((c) => c.textContent === 'Cancel');
  assert.ok(cancel); cancel.listeners.click(); await work;
  assert.ok(f.sent.some((m) => m.op === 'cancel' && m.id === job.id)); assert.match(f.pane().textContent, /Not run yet/);
});

test('cancelling while assignment files load prevents inference and ignores late attachment replies', async () => {
  const f = frame({ mode: 'paper' }); await f.start();
  f.context({ kind: 'assignment', assignment: { instructions: 'Explain the claim.', files: [{ name: 'Prompt.txt' }] } }); await flush();
  const pending = f.ai.feedback(); await flush(); const read = f.said.find((m) => m.type === 'attachments');
  const pane = f.pane(), head = pane.children.find((c) => c.className === 'gz-fb-head');
  head.children.find((c) => c.textContent === 'Cancel').listeners.click(); await pending;
  f.hooks['page:attachments']({ id: read.id, files: [{ name: 'Prompt.txt', text: 'A late file response.' }] }); await flush();
  assert.equal(f.pendingRun.length, 0); assert.match(f.pane().textContent, /Not run yet/);
});

test('Feedback uses actual imported page setup and marks a layout-only change stale', async () => {
  const format = { label: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margins: [1, 1, 1, 1], header: { text: 'name-page' } };
  let actual = { ...format, font: 'Arial', size: 14, margins: [2, 2, 2, 2] };
  const f = frame({ mode: 'paper', format, look: () => actual }); await f.start();
  f.context({ kind: 'assignment', assignment: { instructions: 'Discuss the claim.' } }); await flush();
  const work = f.ai.feedback(); await flush(); const job = f.pendingRun.at(-1);
  assert.deepEqual([job.input.paper.font, job.input.paper.size, job.input.paper.margin], ['Arial', 14, 2]);
  f.reply({ id: job.id, type: 'end', output: { criteria: [], grade: { earned: 10, total: 10, summary: 'Your paper addresses the claim.', reason: null } } }); await work;
  assert.match(f.pane().textContent, /Estimated grade: 10\/10/);
  actual = { ...actual, size: 16 }; f.ai.layoutChanged();
  assert.match(f.pane().textContent, /Draft changed after this assessment/); assert.doesNotMatch(f.pane().textContent, /Estimated grade/);
});

test('Feedback availability copy is translated in all five catalogues', () => {
  const I = require('../lib/i18n.js');
  const keys = ['Checking whether AI can run here…', 'AI is off. Turn it on in Settings → AI.',
    'Feedback is off. Turn it on in Settings → AI.', 'No AI model is chosen. Choose one in Settings → AI.',
    'Glaze needs permission to reach {host}. Allow it in Settings → AI.', 'The on-device model isn’t downloaded. Download it in Settings → AI.',
    'Downloading the model…', 'Downloading the model: {pct}', '{provider} is unavailable. Choose another model in Settings → AI.', 'Apple Intelligence is off. Turn it on in System Settings.',
    'Glaze couldn’t confirm this page may use AI. Reload the page to try again.',
    'AI is only available on confirmed assignments, never on tests.', 'AI isn’t available right now.', 'Settings'];
  for (const locale of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    require(`../i18n/${locale}.js`);
    const catalogue = globalThis.GZ_LANGS[locale];
    for (const key of keys) {
      assert.equal(typeof catalogue[key], 'string', `${locale}: ${key}`);
      assert.notEqual(I.t(key, { host: 'ai.example', pct: '42%' }, locale), key);
    }
  }
});

test('the frame asks the worker whatever model Settings names, an older store\'s too; the worker says whether one is chosen', async () => {
  for (const settings of [{ on: true, use: 'endpoint', features: { completion: true, writing: true } }, { on: true, models: { writing: { use: 'groq', model: 'llama' } }, features: { writing: true } }]) {
    const f = frame({ settings, answer: () => ({ on: true, allowed: true, ready: true }) }); await f.start();
    assert.ok(f.sent.some((m) => m.op === 'status' && m.feature === 'writing'), JSON.stringify(settings));
    assert.equal(f.ai.allowed('writing'), true);
  }
});

test('the gray text waits Advanced\'s pause when the student set one, else its own', () => {
  const W = require('../writer-ai.js');
  assert.equal(W.wait({ mode: 'advanced', tune: { completion: { pause: 350 } } }, 0.5), 350);
  assert.equal(W.wait({ mode: 'simple', tune: { completion: { pause: 350 } } }, 0.5), W.pause(0.5));
  assert.equal(W.wait({ mode: 'advanced', tune: { completion: { pause: 99999 } } }, 0.5), W.pause(0.5), 'only within lib/ai/settings.js TUNE');
  assert.equal(W.wait(null, 0.5), W.pause(0.5));
});
