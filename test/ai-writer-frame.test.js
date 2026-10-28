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
function frame({ answer = () => ({ allowed: true, ready: true }), settings: start, clock, mode = 'compose', format, pace = 1 } = {}) {
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
  const hooks = {}, sent = [], receives = [], pendingStatus = [], pendingRun = [], said = [];
  let ctx = { kind: 'reply' }, settings = start || { on: true, use: 'main', features: { completion: true, writing: true } }, holdStatus = false;
  const opened = [];
  const doc = { content: { size: 10 }, textBetween: () => 'draft words' };
  const ed = { view: { state: { doc }, dispatch() {} } };
  const sandbox = { navigator: { platform: 'MacIntel' }, document: { createElement: () => new Element(), body: new Element(), addEventListener() {} },
    addEventListener() {}, requestAnimationFrame: (f) => f(), setTimeout: (f, ms, ...a) => setTimeout(f, ms / pace, ...a).unref(), clearTimeout,
    GZ_PM: { state: { Plugin: class { constructor(spec) { this.spec = spec; } }, PluginKey: class { getState() { return null; } } }, view: {}, transform: { Mapping: class { appendMapping() {} map(v) { return v; } } } },
    GZ_WRITER_SCHEMA: { text: () => ({ text: 'draft words', posAt: (v) => v }) }, GZ_WRITER_PROOF: {},
    GZ_WRITER_PAPER: format ? { current: () => ({ format: () => format }) } : undefined,
    GZ_WRITER_FRAME: { t: (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v && k in v ? v[k] : m)), kind: () => 'reply', context: () => ctx, editor: () => ed, mode: () => mode,
      on: (ev, f) => { hooks[ev] = f; }, handle: (type, f) => { hooks[`page:${type}`] = f; }, say: (m) => said.push(m), plugin() {}, slot: () => new Element(), item: () => new Element() },
    chrome: { storage: { local: { get: async () => ({ ai: structuredClone(settings) }) }, onChanged: { addListener(f) { hooks.storage = f; } } }, runtime: { connect() {
      return { onMessage: { addListener: (f) => receives.push(f) }, onDisconnect: { addListener() {} }, disconnect() {}, postMessage(m) {
        sent.push(m);
        // An answer of null is never sent; one with its own type (an error) goes as that.
        if (m.op === 'status') { const a = holdStatus ? null : answer(m); if (holdStatus) pendingStatus.push(m); else if (a) queueMicrotask(() => reply({ id: m.id, type: 'status', ...a })); }
        if (m.op === 'run') pendingRun.push(m);
      } };
    }, getURL: (p) => `chrome-extension://x/${p}`, onMessage: { addListener: (f) => { hooks.runtime = f; } } },
    tabs: { create: async (o) => { opened.push(o.url); } } } };
  if (clock) sandbox.Date = class extends Date { static now() { return clock.t; } };
  const reply = (m) => receives.forEach((f) => f(m));
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const ai = sandbox.GZ_WRITER_AI;
  const panel = (opts) => { const host = new Element(); return sandbox.GZ_WRITER_AI.feedbackView(host, opts); };
  const pane = (opts) => panel(opts).el;
  return { ai, sent, said, pendingStatus, pendingRun, reply, hooks, opened, pane, panel, proof: sandbox.GZ_WRITER_PROOF,
    start: async () => { hooks.ready(); await flush(); },
    off: () => { settings.on = false; hooks.storage({ ai: { newValue: structuredClone(settings) } }, 'local'); },
    context: (c) => { ctx = c; hooks.context(c); }, hold: () => { holdStatus = true; } };
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
  const on = { on: true, use: 'main', features: { completion: true, writing: true } };
  const cases = [
    [{ ...on, on: false }, undefined, /^AI is off\. Turn it on in Settings → AI\./, true],
    [{ ...on, features: { completion: true, writing: false } }, undefined, /^Writing feedback is off\. Turn it on in Settings → AI\./, true],
    [{ ...on, use: null }, undefined, /^No AI model is chosen\. Choose one in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'permission', to: 'openrouter.ai' }, /^Glaze needs permission to reach openrouter\.ai\. Allow it in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'download', provider: 'device' }, /^The on-device model isn’t downloaded\. Download it in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'downloading', provider: 'device' }, /^Downloading the model…/, false],
    [on, { allowed: true, ready: false, why: 'unavailable', provider: 'device' }, /^Gemini Nano is unavailable\. Choose another model in Settings → AI\./, true],
    [on, { allowed: true, ready: false, why: 'unavailable', provider: 'apple', reason: 'off' }, /^Apple Intelligence is off\. Turn it on in System Settings\./, false],
    [on, { type: 'error', error: 'failed' }, /^Glaze couldn’t confirm this page may use AI\. Reload the page to try again\./, false],
  ];
  for (const [settings, st, text, button] of cases) {
    const f = frame({ settings, answer: () => ({ on: settings.on, ...st }) }); await f.start();
    const pane = f.pane(), go = pane.children.find((c) => c.className === 'gz-fb-run');
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
  assert.equal(f.ai.allowed('writing'), true);
  assert.equal(f.ai.allowed('completion'), false);
  assert.equal(await until(() => f.ai.allowed('completion')), true, 'asked again, and on');
  const asks = (feature) => f.sent.filter((m) => m.op === 'status' && m.feature === feature).length;
  assert.deepEqual([asks('completion'), asks('writing')], [2, 1]);
  assert.ok(f.sent.some((m) => m.op === 'warm'), 'and warmed once it may run');
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
  for (const [provider, name] of [['device', 'Gemini Nano'], ['apple', 'Apple Intelligence']]) {
    const f = frame({ answer: () => ({ allowed: true, ready: false, why: 'unavailable', provider }) }); await f.start();
    assert.ok(f.pane().textContent.startsWith(`${name} is unavailable. Choose another model in Settings → AI.`));
  }
});

test('Feedback availability copy is translated in all five catalogues', () => {
  const I = require('../lib/i18n.js');
  const keys = ['Checking whether AI can run here…', 'AI is off. Turn it on in Settings → AI.',
    'Writing feedback is off. Turn it on in Settings → AI.', 'No AI model is chosen. Choose one in Settings → AI.',
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
