// Ask Rime's panel (ai/page/ask.js) on a stand-in page: it opens and asks only for the student's own click or key, sends the
// question on the port 'glaze:ask' in the page's language, shows the answer as text, says why a run didn't finish, closes
// when Ask or AI goes off, and the command palette offers it only while AI and Ask are on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const D = require('../../extension/content/defaults.js');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

const page = ({ ai = { on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }, lang = 'en', reply, setup } = {}) => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  doc.fire = (target, type, { trusted = true, ...extra } = {}) => {
    const route = [];
    for (let p = target; p; p = p.parentNode) route.push(p);
    const ev = { type, target, isTrusted: trusted, defaultPrevented: false, ...extra, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const el of [...route].reverse()) for (const l of el.listeners.filter((x) => x.type === type && x.capture)) l.f(ev);
    for (const el of route) for (const l of el.listeners.filter((x) => x.type === type && !x.capture)) l.f(ev);
    return ev;
  };
  // A form's requestSubmit fires its submit, as the browser does, carrying no isTrusted of its own: the key that asked for it
  // is the student's (the panel checks that key).
  doc.createElement = (t) => { const e = new El(t, doc); if (t === 'form') e.requestSubmit = () => doc.fire(e, 'submit', { trusted: true }); return e; };
  doc.createElementNS = (ns, t) => new El(t, doc);
  doc.getElementById = (x) => doc.root.all().find((e) => e.id === x) || null;
  doc.querySelector = (s) => doc.root.querySelector(s);
  const env = { doc, posted: [], ports: [], changed: [], activation: true, store: { ai }, reply: reply || ((m) => (m.op === 'status' ? { type: 'status', on: true, allowed: true, ready: true } : null)) };
  env.read = (cb) => cb({ ai: structuredClone(env.store.ai) });
  const connect = ({ name }) => {
    const on = [], gone = [];
    const port = { name, posted: [], hungUp: false, onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener: (f) => gone.push(f) },
      disconnect() { this.hungUp = true; },
      postMessage(m) { this.posted.push(m); env.posted.push(m); const a = env.reply(m); if (a) setTimeout(() => { for (const f of on) f({ id: m.id, ...a }); }, 0); },
      answer: (a) => { for (const f of on) f(a); } };
    env.ports.push(port);
    return port;
  };
  const context = vm.createContext({
    document: doc, window: {}, navigator: { get userActivation() { return { isActive: env.activation }; } }, setTimeout, clearTimeout, Promise, JSON, structuredClone, URL,
    GZ_I18N: require('../../extension/core/i18n.js'),
    GZ_CTX: { t: (k, v) => k.replace(/\{(\w+)\}/g, (m, x) => v?.[x] ?? m), on: () => true, locale: () => lang, settings: () => D.GZ_SANITIZE({ enabled: true }) },
    chrome: { runtime: { connect, lastError: undefined }, storage: { local: { get: (k, cb) => env.read(cb) }, onChanged: { addListener: (f) => env.changed.push(f) } } },
  });
  setup?.(env, context);
  // The chat component first, as ai/page/ask.js loads it beside itself.
  vm.runInContext(read('ai/page/ask-chat.js'), context);
  env.ui = vm.runInContext(read('ai/page/ask.js'), context);
  env.context = context;
  env.box = () => doc.getElementById('gz-ask');
  env.q = () => doc.getElementById('gz-ask-q');
  env.ask = (text, trusted = true) => { env.q().value = text; doc.fire(env.q(), 'keydown', { key: 'Enter', trusted }); };
  // Each question and answer as the student reads it: its class and its words (an answer's text and its follow-up question).
  env.turns = () => env.box().querySelectorAll('.gz-ask-log li').filter((li) => ['gz-ask-q', 'gz-ask-a'].includes(li.className))
    .map((li) => [li.className, li.querySelectorAll('.gz-ask-text').map((x) => x.textContent).join('')]);
  env.say = () => env.box().querySelector('.gz-ask-say').textContent;
  env.setAi = (next) => { env.store.ai = next; for (const f of env.changed) f({ ai: { newValue: next } }, 'local'); };
  return env;
};

test('it opens only for the student\'s own click or key, and only while AI and Ask are on', async () => {
  const P = page();
  await P.ui.open({ event: { isTrusted: false } });
  assert.equal(P.box(), null, 'a page script\'s event opens nothing');
  await P.ui.open({});
  assert.equal(P.box(), null);
  const off = page({ ai: { on: true, features: { ask: false } } });
  await off.ui.open({ event: { isTrusted: true } });
  assert.equal(off.box(), null, 'Ask off');
  await P.ui.open({ event: { isTrusted: true } });
  assert.ok(P.box()?.open);
  assert.equal(P.box().getAttribute('aria-labelledby'), 'gz-ask-title');
  assert.equal(P.doc.activeElement, P.q(), 'focus in the question');
  assert.equal(P.q().getAttribute('aria-label'), 'Your question');
  assert.equal(P.box().querySelector('.gz-ask-log').getAttribute('role'), 'log');
  assert.equal(P.box().querySelector('.gz-ask-say').getAttribute('role'), 'status');
  assert.deepEqual(P.posted.map((m) => m.op), ['status']);
  assert.equal(P.ports[0].name, 'glaze:ask');
});

test('a question goes on the port in the page\'s language; the answer is shown as text; a faked key sends nothing', async () => {
  const P = page({ lang: 'pt-PT', reply: (m) => (m.op === 'status' ? { type: 'status', on: true, allowed: true, ready: true }
    : m.op === 'ask' ? { type: 'end', task: 'study.help', output: { kind: 'hint', step: null, reply: 'What could you do to both sides? <b>x</b>', followUp: 'Which side has the 5?' } } : null) });
  await P.ui.open({ event: { isTrusted: true } });
  await settle();
  P.ask('How do I solve 3x + 5 = 20?', false);
  await settle();
  assert.deepEqual(P.posted.map((m) => m.op), ['status'], 'a faked Enter sends nothing');
  P.activation = false;
  P.ask('How do I solve 3x + 5 = 20?');
  await settle();
  assert.deepEqual(P.posted.map((m) => m.op), ['status'], 'nor a key without the user activation a real one has');
  P.activation = true;
  P.ask('How do I solve 3x + 5 = 20?');
  await settle();
  const sent = P.posted.find((m) => m.op === 'ask');
  assert.deepEqual({ ...sent, id: 0 }, { id: 0, op: 'ask', question: 'How do I solve 3x + 5 = 20?', locale: 'pt-BR' });
  assert.deepEqual(P.turns(), [['gz-ask-q', 'How do I solve 3x + 5 = 20?'], ['gz-ask-a', 'What could you do to both sides? <b>x</b>Which side has the 5?']]);
  assert.equal(P.box().querySelectorAll('b').length, 0, 'model words are text, never markup');
  assert.equal(P.q().value, '');
});

test('your work goes with the question as the attempt; an agent answer and a declined change are shown; a failure says why', async () => {
  const answers = [{ type: 'end', task: 'agent.tools', answer: { text: 'Lab report is due Friday.' } }, { type: 'end', task: 'agent.tools', declined: true }, { type: 'error', error: 'setup' }, { type: 'error', error: 'check' }];
  const P = page({ reply: (m) => (m.op === 'status' ? { type: 'status', on: true, allowed: true, ready: true } : m.op === 'ask' ? answers.shift() : null) });
  await P.ui.open({ event: { isTrusted: true } });
  P.doc.fire(P.box().querySelector('.gz-ask-more'), 'click');
  assert.equal(P.doc.getElementById('gz-ask-work').hidden, false);
  assert.equal(P.box().querySelector('.gz-ask-more').getAttribute('aria-expanded'), 'true');
  P.doc.getElementById('gz-ask-work').value = '3x = 25';
  P.ask('Is my step right?');
  await settle();
  assert.equal(P.posted.find((m) => m.op === 'ask').attempt, '3x = 25');
  P.ask('Mark my lab report done'); await settle();
  P.ask('What is due?'); await settle();
  assert.equal(P.say(), 'Choose a model for Ask Rime in Settings → AI.');
  P.ask('What is due?'); await settle();
  assert.equal(P.say(), 'Rime couldn’t answer that. Try asking another way.');
  assert.deepEqual(P.turns().filter(([c]) => c === 'gz-ask-a').map(([, t]) => t), ['Lab report is due Friday.', 'Nothing was changed.']);
});

test('Stop cancels the run in flight; Ask or AI turned off closes the panel and its port', async () => {
  const P = page({ reply: (m) => (m.op === 'status' ? { type: 'status', on: true, allowed: true, ready: true } : null) });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Explain mitosis');
  await settle();
  const stop = P.box().querySelector('.gz-ask-stop');
  assert.equal(stop.hidden, false);
  assert.equal(P.box().querySelector('.gz-ask-send').disabled, true);
  P.doc.fire(stop, 'click', { trusted: false });
  assert.ok(!P.posted.some((m) => m.op === 'cancel'), 'a faked click stops nothing');
  P.doc.fire(stop, 'click');
  const ask = P.posted.find((m) => m.op === 'ask');
  assert.deepEqual(JSON.parse(JSON.stringify(P.posted.at(-1))), { id: ask.id, op: 'cancel' });
  P.ports.at(-1).answer({ id: ask.id, type: 'error', error: 'cancelled' });
  await settle();
  assert.equal(P.say(), '');
  P.setAi({ on: true, features: { ask: false } });
  assert.equal(P.box(), null, 'closed');
  assert.equal(P.ports.at(-1).hungUp, true);
});

test('the command palette offers Ask Rime only while AI and Ask are on, and opens it only for the student\'s own choice', () => {
  const src = read('navigation/page/palette.js');
  assert.match(src, /askOn = r\?\.ai\?\.on === true && r\.ai\.features\?\.ask === true/);
  assert.match(src, /\.\.\.\(askOn \? \[\{ label: t\('Ask Rime'\), hint: 'Glaze', group: 'Glaze', run: \(e\) => e\?\.isTrusted && \(globalThis\.GZ_WIDGETS_UI\?\.reveal\?\.\('ask'\) \|\| need\('ai\/page\/ask\.js'/);
  assert.match(src, /await Promise\.all\(\[keeping, asking\]\)/, 'read before the commands are built');
  const loadable = read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1];
  assert.ok(loadable.includes("'ai/page/ask.js'"));
});


test('a slow settings read admits only one submission and keeps text typed while it waits', async () => {
  const P = page();
  await P.ui.open({ event: { isTrusted: true } });
  const reads = [];
  P.read = (cb) => reads.push(cb);
  P.ask('What is due?');
  P.ask('What is due?');
  P.q().value = 'My next question';
  reads.forEach((cb) => cb({ ai: P.store.ai }));
  await settle();
  assert.equal(P.posted.filter((m) => m.op === 'ask').length, 1);
  assert.equal(P.turns().filter(([who]) => who === 'gz-ask-q').length, 1);
  assert.equal(P.q().value, 'My next question');
});

test('closing during the settings read invalidates that submission, including after reopening', async () => {
  const P = page();
  await P.ui.open({ event: { isTrusted: true } });
  let release;
  P.read = (cb) => { release = cb; };
  P.ask('What is due?');
  P.box().close();
  P.read = (cb) => cb({ ai: P.store.ai });
  await P.ui.open({ event: { isTrusted: true } });
  P.q().value = 'A new question';
  release({ ai: P.store.ai });
  await settle();
  assert.equal(P.posted.filter((m) => m.op === 'ask').length, 0);
  assert.deepEqual(P.turns(), []);
  assert.equal(P.q().value, 'A new question');
});

test('an opening status that arrives after a question cannot replace its result status', async () => {
  const P = page({ reply: () => null });
  const opened = P.ui.open({ event: { isTrusted: true } });
  await settle();
  const status = P.posted.find((m) => m.op === 'status');
  P.ask('What is due?');
  await settle();
  const ask = P.posted.find((m) => m.op === 'ask');
  P.ports.at(-1).answer({ id: ask.id, type: 'error', error: 'setup' });
  await settle();
  const message = P.say();
  P.ports[0].answer({ id: status.id, type: 'status', ready: false, why: 'size' });
  await opened;
  assert.equal(P.say(), message);
  assert.equal(message, 'Choose a model for Ask Rime in Settings → AI.');
});

test('a script-requested form submit cannot spend another page click’s user activation', async () => {
  const P = page();
  await P.ui.open({ event: { isTrusted: true } });
  P.q().value = 'A question planted by the page';
  P.box().querySelector('form').requestSubmit();
  await settle();
  assert.equal(P.posted.filter((m) => m.op === 'ask').length, 0, 'requestSubmit produces a trusted SubmitEvent without a student choice');
  P.q().value = 'My own question';
  P.doc.fire(P.box().querySelector('.gz-ask-send'), 'click');
  await settle();
  assert.equal(P.posted.filter((m) => m.op === 'ask').length, 1, 'the student can still use the Ask button');
  assert.equal(P.posted.find((m) => m.op === 'ask').question, 'My own question');
});

// ---- the chat (ported from the agent chat Rime's panel was modelled on) ----------------------------------------------------
const ready = (m) => (m.op === 'status' ? { type: 'status', on: true, allowed: true, ready: true } : null);
const asked = (P) => P.posted.filter((m) => m.op === 'ask');
const answer = (P, a) => P.ports.at(-1).answer({ id: asked(P).at(-1).id, ...a });
const study = (reply, followUp = null) => ({ type: 'end', task: 'study.help', output: { kind: 'hint', step: null, reply, followUp } });

// Drive browser animation frames, copy timers and resize observations without wall-clock waits.
const movingPage = () => page({ reply: ready, setup: (P, context) => {
  let seq = 0;
  P.frames = new Map(); P.timers = new Map(); P.observed = new Set(); P.reduced = false;
  P.doc.documentElement = P.doc.root;
  context.matchMedia = () => ({ get matches() { return P.reduced; } });
  context.requestAnimationFrame = (f) => { const id = ++seq; P.frames.set(id, f); return id; };
  context.cancelAnimationFrame = (id) => P.frames.delete(id);
  context.setTimeout = (f) => { const id = ++seq; P.timers.set(id, f); return id; };
  context.clearTimeout = (id) => P.timers.delete(id);
  context.ResizeObserver = class {
    observe(el) { P.observed.add(el); }
    unobserve(el) { P.observed.delete(el); }
    disconnect() { P.observed.clear(); }
  };
  context.navigator.clipboard = { writeText: async () => {} };
  P.flushFrame = () => { const next = [...P.frames.values()]; P.frames.clear(); for (const f of next) f(); };
  P.doc.createTreeWalker = (part) => {
    const nodes = [part, ...part.all()].flatMap((e) => e.children.filter((n) => n.nodeType === 3));
    for (const n of nodes) Object.defineProperties(n, {
      data: { configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; } },
      parentElement: { configurable: true, get() { return this.parentNode; } },
    });
    let at = 0;
    return { nextNode: () => nodes[at++] || null };
  };
} });

test('closing cancels every reveal frame, and New chat releases removed rows, copy timers and resize observations', async () => {
  const P = movingPage();
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Explain mitosis'); await settle();
  answer(P, study('Look at the chromosomes. '.repeat(15))); await settle();
  assert.ok(P.frames.size > 0, 'an answer is being revealed');
  P.box().close();
  assert.equal(P.frames.size, 0, 'no animation frame retains the closed chat');
  assert.equal(P.observed.size, 0);
  P.reduced = true;
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Explain meiosis'); await settle();
  answer(P, study('What happens first?')); await settle();
  P.doc.fire(P.box().querySelector('.gz-ask-copy'), 'click'); await settle();
  assert.equal(P.timers.size, 1, 'the copy acknowledgement has a reset timer');
  P.doc.fire(P.box().querySelector('.gz-ask-new'), 'click');
  assert.equal(P.timers.size, 0, 'removed copy controls leave no timers');
  assert.deepEqual([...P.observed], [P.box().querySelector('.gz-ask-log')], 'only the live log remains observed');
  P.box().close();
});

for (const mode of ['reduced motion', 'Motion off']) test(`enabling ${mode} stops an ongoing reveal and smooth scroll`, async () => {
  const P = movingPage();
  await P.ui.open({ event: { isTrusted: true } });
  const log = P.box().querySelector('.gz-ask-log');
  Object.defineProperties(log, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } });
  log.scrollTop = 0;
  P.ask('Explain mitosis'); await settle();
  const text = 'Look at the chromosomes. '.repeat(15);
  answer(P, study(text)); await settle();
  P.flushFrame();
  const row = P.box().querySelector('.gz-ask-a');
  assert.ok(row.dataset.streaming !== undefined, 'the reveal has started');
  if (mode === 'Motion off') P.doc.root.dataset.gzMotion = 'off'; else P.reduced = true;
  P.flushFrame();
  assert.equal(row.querySelector('.gz-ask-md').textContent, text, 'show the whole checked answer at once');
  assert.equal(row.dataset.streaming, undefined);
  assert.equal(P.frames.size, 0, 'neither reveal nor eased scroll continues');
  assert.ok(log.scrollTop >= 900, 'scroll directly to the bottom');
  P.box().close();
});

const exitEffects = (P) => {
  const effects = [];
  P.box().animate = () => {
    let reject;
    const effect = { cancelled: false, finished: new Promise((resolve, no) => { reject = no; }), cancel() { this.cancelled = true; reject(new Error('cancelled')); } };
    // A backdrop effect has no finished handler in the panel; suppress an unhandled test rejection for that effect.
    effect.finished.catch(() => {});
    effects.push(effect);
    return effect;
  };
  return effects;
};

test('closing cancels the active question before its exit effect finishes and releases both effects on close', async () => {
  const P = movingPage();
  await P.ui.open({ event: { isTrusted: true } });
  const effects = exitEffects(P);
  P.ask('Explain mitosis'); await settle();
  P.doc.fire(P.box().querySelector('.gz-ask-close'), 'click');
  assert.equal(effects.length, 2, 'the dialog and its backdrop are fading');
  assert.ok(P.posted.some((m) => m.op === 'cancel' && m.id === asked(P)[0].id), 'cancel immediately on the close click');
  P.box().close();
  assert.ok(effects.every((a) => a.cancelled), 'external closure leaves no live effect');
  assert.equal(P.frames.size, 0);
  await P.ui.open({ event: { isTrusted: true } }); await settle();
  assert.ok(P.box()?.open, 'old exit callbacks cannot close a reopened panel');
  P.box().close();
});

test('a closing dialog cannot start another question during its exit effect', async () => {
  const P = movingPage();
  await P.ui.open({ event: { isTrusted: true } });
  exitEffects(P);
  P.ask('Explain mitosis'); await settle();
  P.doc.fire(P.box().querySelector('.gz-ask-close'), 'click');
  P.ask('Explain meiosis'); await settle();
  assert.equal(asked(P).length, 1, 'closing must revoke admission before the fade ends');
  P.box().close();
});

for (const mode of ['reduced motion', 'Motion off']) test(`enabling ${mode} cancels an exit effect already in progress`, async () => {
  const P = movingPage();
  await P.ui.open({ event: { isTrusted: true } });
  const effects = exitEffects(P);
  P.doc.fire(P.box().querySelector('.gz-ask-close'), 'click');
  if (mode === 'Motion off') P.doc.root.dataset.gzMotion = 'off'; else P.reduced = true;
  P.flushFrame(); await settle();
  assert.equal(P.box(), null, 'close immediately once motion is disabled');
  assert.ok(effects.every((a) => a.cancelled));
  assert.equal(P.frames.size, 0);
});

test('the empty panel offers starters: one fills the question for the student\'s own click; New chat clears the conversation', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  const starters = P.box().querySelectorAll('.gz-ask-starter');
  assert.equal(starters.length, 4);
  P.doc.fire(starters[0], 'click', { trusted: false });
  assert.equal(P.q().value, '', 'a page script\'s click fills nothing');
  P.doc.fire(starters[0], 'click');
  assert.equal(P.q().value, starters[0].textContent);
  assert.equal(P.doc.activeElement, P.q());
  P.ask('Explain mitosis');
  await settle();
  assert.equal(P.box().querySelector('.gz-ask-empty'), null, 'the starters give way to the conversation');
  answer(P, study('What happens to the chromosomes first?'));
  await settle();
  assert.equal(P.turns().length, 2);
  const fresh = P.box().querySelector('.gz-ask-new');
  P.doc.fire(fresh, 'click', { trusted: false });
  assert.equal(P.turns().length, 2);
  P.doc.fire(fresh, 'click');
  assert.deepEqual(P.turns(), []);
  assert.ok(P.box().querySelector('.gz-ask-empty'), 'the starters again');
  P.ask('Explain meiosis');
  await settle();
  assert.equal(asked(P).at(-1).history, undefined, 'a new chat carries nothing over');
});

test('answers are drawn from their markdown as elements, never markup; only https links, opened apart from the page', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Explain mitosis');
  await settle();
  answer(P, study('**Bold** and `code` <img src=x onerror=alert(1)>\n\n- one\n- two\n\n[bad](javascript:alert(1)) [ok](https://example.com/a) [near](//evil.example)\n\n```\nlet x = 1;\n```'));
  await settle();
  const a = P.box().querySelector('.gz-ask-a');
  assert.equal(a.querySelector('strong').textContent, 'Bold');
  assert.equal(a.querySelectorAll('code').map((c) => c.textContent)[0], 'code');
  assert.deepEqual(a.querySelectorAll('ul li').map((li) => li.textContent), ['one', 'two']);
  assert.ok(a.querySelector('pre'), 'a fenced block');
  const links = a.querySelectorAll('a');
  assert.deepEqual(links.map((l) => [l.href, l.target, l.rel]), [['https://example.com/a', '_blank', 'noopener noreferrer']]);
  assert.equal(a.querySelectorAll('img').length, 0);
  assert.ok(P.box().all().every((e) => !e._html), 'nothing set as HTML');
  assert.match(a.textContent, /<img src=x onerror=alert\(1\)>/, 'markup in the words stays words');
});

test('tool steps show as cards while they run; a write waits in an inline card for Glaze\'s window; an unknown tool shows its reason', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Mark my lab report done');
  await settle();
  assert.ok(P.box().querySelector('.gz-ask-busy'), 'thinking, in the conversation');
  const step = (s) => answer(P, { type: 'step', step: s });
  step({ n: 1, name: 'todo_list', kind: 'read', state: 'run' });
  await settle();
  const cards = () => P.box().querySelectorAll('.gz-ask-step');
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].dataset.state, 'run');
  assert.equal(cards()[0].querySelector('.gz-ask-step-label').textContent, 'Reading your to-do list');
  step({ n: 1, name: 'todo_list', kind: 'read', state: 'done', ms: 1240 });
  step({ n: 2, name: 'todo_mark_done', kind: 'write', state: 'ask' });
  await settle();
  assert.equal(cards().length, 2, 'one card a step');
  assert.equal(cards()[0].dataset.state, 'done');
  assert.equal(cards()[0].querySelector('.gz-ask-step-time').textContent, '1.2s');
  const write = cards()[1];
  assert.equal(write.dataset.kind, 'write');
  assert.equal(write.querySelector('.gz-ask-step-label').textContent, 'Mark a to-do done');
  assert.match(write.textContent, /Waiting for your answer in Glaze’s window/);
  assert.equal(write.querySelectorAll('button').length, 0, 'the answer is given in Glaze\'s window, never on the page');
  step({ n: 2, name: 'todo_mark_done', kind: 'write', state: 'no' });
  step({ n: 3, name: 'places_map', kind: 'read', state: 'run', reason: 'Finding the Grades page' });
  await settle();
  assert.equal(cards()[1].dataset.state, 'no');
  assert.doesNotMatch(cards()[1].textContent, /Waiting/);
  assert.equal(cards()[2].querySelector('.gz-ask-step-label').textContent, 'Finding the Grades page');
  answer(P, { type: 'end', task: 'agent.tools', declined: true });
  await settle();
  assert.equal(P.box().querySelector('.gz-ask-busy'), null);
  assert.equal(cards().length, 3, 'the steps stay in the conversation');
});

for (const error of ['cancelled', 'connection-lost']) test(`a run ending with ${error} settles its running and approval cards`, async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Mark my lab report done'); await settle();
  answer(P, { type: 'step', step: { n: 1, name: 'todo_list', kind: 'read', state: 'run' } });
  answer(P, { type: 'step', step: { n: 2, name: 'todo_mark_done', kind: 'write', state: 'ask' } });
  answer(P, { type: 'error', error }); await settle();
  const cards = P.box().querySelectorAll('.gz-ask-step');
  assert.equal(cards.length, 2, 'keep the run in the conversation');
  assert.ok(cards.every((c) => !['run', 'ask'].includes(c.dataset.state)), 'no card claims the ended run is still active');
  assert.equal(P.box().querySelector('.gz-ask-step-note'), null, 'an ended run is not waiting in the approval window');
  assert.equal(P.box().querySelector('.gz-ask-busy'), null);
  P.box().close();
});

test('a failure shows in the conversation with Try again, which asks the same question again for the student\'s own click', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('What is due this week?');
  await settle();
  answer(P, { type: 'error', error: 'check' });
  await settle();
  const err = P.box().querySelector('.gz-ask-err');
  assert.match(err.textContent, /Rime couldn’t answer that\. Try asking another way\./);
  const retry = err.querySelector('.gz-ask-retry');
  P.doc.fire(retry, 'click', { trusted: false });
  await settle();
  assert.equal(asked(P).length, 1);
  P.doc.fire(retry, 'click');
  await settle();
  assert.equal(asked(P).length, 2);
  assert.equal(asked(P)[1].question, 'What is due this week?');
  assert.equal(P.box().querySelector('.gz-ask-err'), null, 'the failure gives way to the new try');
  assert.equal(P.turns().filter(([c]) => c === 'gz-ask-q').length, 1, 'the question isn\'t shown twice');
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Lab report, Friday.' } });
  await settle();
  assert.deepEqual(P.turns().map(([, t]) => t), ['What is due this week?', 'Lab report, Friday.']);
});

test('follow-ups carry the conversation so far, the last three questions and answers', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  for (let i = 1; i <= 4; i++) {
    P.ask(`Question ${i}`);
    await settle();
    answer(P, study(`Answer ${i}`, i === 2 ? 'Which one?' : null));
    await settle();
  }
  assert.equal(asked(P)[0].history, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(asked(P)[2].history)), [{ question: 'Question 1', answer: 'Answer 1' }, { question: 'Question 2', answer: 'Answer 2\n\nWhich one?' }]);
  P.ask('Question 5');
  await settle();
  assert.deepEqual([...asked(P)[4].history.map((h) => h.question)], ['Question 2', 'Question 3', 'Question 4']);
});

test('a UI action a run returns goes to the handler for its kind once the answer shows, only for its question', async () => {
  const P = page({ reply: ready });
  const got = [];
  P.ui.on('highlight', (a) => got.push(a));
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Where are my grades?');
  await settle();
  answer(P, { type: 'action', action: { kind: 'highlight', text: 'Grades' } });
  answer(P, { type: 'action', action: { kind: 'nope' } });
  await settle();
  assert.deepEqual(got, [], 'nothing on the page before the answer shows');
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Here.' } });
  await settle();
  assert.deepEqual(got, [{ kind: 'highlight', text: 'Grades' }]);
  P.ports.at(-1).answer({ id: asked(P)[0].id, type: 'action', action: { kind: 'highlight', text: 'late' } });
  await settle();
  assert.equal(got.length, 1, 'nothing after its end');
});

test('run() asks a question the student didn\'t type, for their own click only', async () => {
  const P = page({ reply: ready });
  await P.ui.run({ event: { isTrusted: false }, question: 'What is due?' });
  assert.equal(P.box(), null);
  await P.ui.run({ event: { isTrusted: true }, question: 'What is due?' });
  await settle();
  assert.ok(P.box()?.open);
  assert.equal(asked(P).length, 1);
  assert.equal(asked(P)[0].question, 'What is due?');
  assert.deepEqual(P.turns(), [['gz-ask-q', 'What is due?']]);
});

test('every word the panel shows is in all five translations', () => {
  const src = read('ai/page/ask-chat.js') + read('ai/page/ask.js');
  const literals = [...src.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const P = page();
  const all = [...new Set([...literals, ...Object.values(P.ui.STEPS)])];
  assert.ok(all.length > 20);
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    const file = read(`i18n/${lang}.js`);
    const missing = all.filter((k) => !file.includes(`${JSON.stringify(k)}:`) && !file.includes(`'${k}':`));
    assert.deepEqual(missing, [], lang);
  }
});

test('the panel\'s sheet moves nothing with reduced motion or Glaze\'s Motion off, and is solid on a solid background', () => {
  const css = read('core/page/apps.css');
  const start = css.indexOf('/* Ask Rime'), end = css.indexOf('/* ---- syllabus import');
  assert.ok(start > 0 && end > start);
  const sheet = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const motion = /@media \(prefers-reduced-motion: no-preference\) \{([\s\S]*)\}\s*$/.exec(sheet.trim());
  assert.ok(motion, 'one motion block, last');
  const rest = sheet.trim().slice(0, motion.index);
  assert.doesNotMatch(rest.replace(/(?:animation(?:-name)?|transition):\s*none/g, ''), /animation|transition|@keyframes/, 'nothing moves outside the motion block');
  for (const [, selectors] of motion[1].matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/g)) {
    if (/^(from|to|\d+%)/.test(selectors)) continue;
    for (const sel of selectors.split(/,(?![^(]*\))/)) assert.match(sel.trim(), /^html:not\(\[data-gz-motion="off"\]\) /, sel);
  }
  assert.match(sheet, /html\[data-gz-bg="solid"\] #gz-ask[^{]*\{[^}]*backdrop-filter: none/);
  assert.match(sheet, /prefers-reduced-transparency: reduce[\s\S]*#gz-ask[^{]*\{[^}]*backdrop-filter: none/);
});

test('the panel suppresses the host sheet\'s important button transitions when motion is disabled', () => {
  assert.match(read('content/theme.css'), /button, \.MuiButtonBase-root\s*\{[^}]*transition:[^}]*!important/, 'Ultra gives every button an important transition');
  const css = read('core/page/apps.css');
  // A gated animation rule alone cannot reset an unrelated transition from the host page.
  const off = /html\[data-gz-motion="off"\][^{]*(?:#gz-ask|:is\(#gz-ask, \.gz-ask-tile\)) button[^{}]*\{([^}]*)\}/.exec(css)?.[1] || '';
  const reduce = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*(?:#gz-ask|:is\(#gz-ask, \.gz-ask-tile\)) button\s*\{([^}]*)\}/.exec(css)?.[1] || '';
  for (const [mode, declarations] of [['Motion off', off], ['reduced motion', reduce]]) {
    assert.match(declarations, /transition:\s*none\s*!important/, mode);
  }
});

test('each starter, in each language, asks what it says: the first three about the student\'s records, the last for study help', () => {
  const K = require('../../extension/ai/ask.js');
  const EN = ['What’s due this week?', 'How are my grades?', 'Which assignments are coming up?', 'Help me study for my next test'];
  for (const lang of ['en', 'de', 'es', 'fr', 'nl', 'pt-BR']) {
    const table = lang === 'en' ? null : vm.runInNewContext(read(`i18n/${lang}.js`), { globalThis: {} });
    const tasks = EN.map((s) => K.route(table ? table[s] : s, { locale: lang }).task);
    assert.deepEqual(tasks, ['agent.tools', 'agent.tools', 'agent.tools', 'study.help'], lang);
  }
});

// ---- Rime's own tools in the panel (docs/ai-harness.md "Rime's own tools") ---------------------------------------------------
const onCanvas = (extra) => (env, context) => {
  context.GZ_CTX = { ...context.GZ_CTX, site: 'canvas' };
  env.assigned = [];
  env.session = new Map();
  context.location = { origin: 'https://school.instructure.com', href: 'https://school.instructure.com/courses/25', pathname: '/courses/25', assign: (u) => env.assigned.push(u) };
  context.sessionStorage = { getItem: (k) => env.session.get(k) ?? null, setItem: (k, v) => env.session.set(k, String(v)), removeItem: (k) => env.session.delete(k) };
  extra?.(env, context);
};

test('a question carries the school site and the page\'s words; a card shows its detail when it ends', async () => {
  const P = page({ reply: ready, setup: onCanvas((env) => { const main = env.doc.createElement('main'); main.textContent = 'Grades  Homework 6  18 / 20'; env.doc.body.append(main); }) });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('What is 18 of 20 as a percent?');
  await settle();
  const sent = asked(P)[0];
  assert.equal(sent.site, 'canvas');
  assert.equal(sent.text, 'Grades  Homework 6  18 / 20', 'the page\'s words, never the panel\'s');
  answer(P, { type: 'step', step: { n: 1, name: 'run_js', kind: 'read', state: 'run' } });
  answer(P, { type: 'step', step: { n: 1, name: 'run_js', kind: 'read', state: 'done', ms: 4, detail: '90' } });
  await settle();
  const c = P.box().querySelector('.gz-ask-step');
  assert.equal(c.querySelector('.gz-ask-step-label').textContent, 'Working it out');
  assert.equal(c.querySelector('.gz-ask-step-detail').textContent, '90');
});

test('open goes to a place on this site once the answer shows, a highlight after it carried to that page; another site\'s address is never opened', async () => {
  const P = page({ reply: ready, setup: onCanvas() });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Take me to my grades and show Homework 6');
  await settle();
  answer(P, { type: 'action', action: { kind: 'open', place: 'course:25/grades', title: 'BIO 1100 grades', url: 'https://school.instructure.com/courses/25/grades' } });
  answer(P, { type: 'action', action: { kind: 'highlight', text: 'Homework 6', note: '18 of 20' } });
  await settle();
  assert.deepEqual(P.assigned, [], 'nothing moves before the answer');
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Your grades page, with Homework 6 marked.' } });
  await settle();
  assert.deepEqual(P.assigned, ['https://school.instructure.com/courses/25/grades']);
  assert.equal(P.session.get('gz-ask-carry'), undefined, 'the page must not own the carried instruction');

  const Q = page({ reply: ready, setup: onCanvas() });
  await Q.ui.open({ event: { isTrusted: true } });
  Q.ask('Go');
  await settle();
  answer(Q, { type: 'action', action: { kind: 'open', url: 'https://evil.example/phish' } });
  answer(Q, { type: 'end', task: 'agent.tools', answer: { text: 'Here.' } });
  await settle();
  assert.deepEqual(Q.assigned, []);
});

test('reminders and watches that fired show as cards on the page; Ask Rime on one asks its words with its id, for the student\'s own click', async () => {
  const list = [{ id: 'w-abcdefgh', what: 'wake', say: 'Finish the lab report', at: 1 }, { id: 'm-abcdefgh', what: 'monitor', watch: 'grade', say: 'Tell me my new grade', at: 2 }];
  const P = page({ setup: onCanvas(), reply: (m) => (m.op === 'status' ? { type: 'status', on: true, allowed: true, ready: true } : m.op === 'fired' ? { type: 'end', fired: list } : null) });
  await P.ui.arrive({ fired: 0 });
  await settle();
  assert.equal(P.doc.getElementById('gz-ask-fired'), null, 'nothing waits: no look, no card');
  assert.deepEqual(P.posted, []);
  await P.ui.arrive({ fired: 2 });
  await settle();
  const tray = P.doc.getElementById('gz-ask-fired');
  assert.deepEqual(tray.querySelectorAll('.gz-ask-fired-card').map((c) => [c.querySelector('.gz-ask-fired-what').textContent, c.querySelector('.gz-ask-fired-say').textContent]),
    [['Reminder', 'Finish the lab report'], ['Something you asked Rime to watch changed', 'Tell me my new grade']]);
  const go = tray.querySelectorAll('.gz-ask-fired-go')[0];
  P.doc.fire(go, 'click', { trusted: false });
  await settle();
  assert.equal(P.box(), null, 'a page script\'s click asks nothing');
  P.doc.fire(go, 'click');
  await settle(20);
  assert.ok(P.box()?.open);
  const sent = asked(P).at(-1);
  assert.deepEqual([sent.question, sent.fired], ['Finish the lab report', 'w-abcdefgh']);
  assert.equal(tray.querySelectorAll('.gz-ask-fired-card').length, 1, 'the card asked is gone');
  P.doc.fire(tray.querySelector('.gz-ask-fired-no'), 'click');
  assert.equal(P.doc.getElementById('gz-ask-fired'), null);
});


test('arrival ignores carried highlights forged by school scripts in sessionStorage', async () => {
  let walks = 0;
  const P = page({ setup: onCanvas((env) => {
    env.doc.createTreeWalker = () => { walks++; return { nextNode: () => null }; };
    env.session.set('gz-ask-carry', JSON.stringify({ at: Date.now(), path: '/courses/25', marks: [{ text: 'Pay here', note: 'Approved by Rime' }] }));
  }) });
  await P.ui.arrive();
  assert.equal(walks, 0, 'page storage must not authorize extension annotations or scrolling');
});


test('every fired record gets a card, including a monitor without custom words; disabling reminders removes the tray', async () => {
  const list = Array.from({ length: 7 }, (_, i) => ({ id: `m-record0${i}`, what: 'monitor', watch: 'grade', say: i ? `Grade ${i}` : '', at: 1 }));
  const P = page({ setup: onCanvas(), reply: (m) => m.op === 'fired' ? { type: 'end', fired: list } : ready(m) });
  await P.ui.arrive({ fired: 7 }); await settle();
  const tray = P.doc.getElementById('gz-ask-fired');
  assert.equal(tray.querySelectorAll('.gz-ask-fired-card').length, 7, 'taking all records must not silently discard any');
  P.doc.fire(tray.querySelector('.gz-ask-fired-go'), 'click'); await settle(20);
  assert.equal(asked(P)[0].fired, 'm-record00', 'a monitor without a custom say can still be asked about');
  P.setAi({ ...P.store.ai, wakes: false });
  assert.equal(P.doc.getElementById('gz-ask-fired'), null, 'the reminders switch applies even with a panel open');
  P.box()?.close();
});

test('a fired response arriving after Ask is disabled never restores its tray', async () => {
  const P = page({ setup: onCanvas(), reply: ready });
  const arriving = P.ui.arrive({ fired: 1 }); await settle();
  const request = P.posted.find((m) => m.op === 'fired');
  P.setAi({ on: false, features: { ask: false } });
  P.ports.at(-1).answer({ id: request.id, type: 'end', fired: [{ id: 'w-late1234', what: 'wake', say: 'Late reminder' }] });
  await arriving;
  assert.equal(P.doc.getElementById('gz-ask-fired'), null);
});


test('navigation waits until the checked answer has finished revealing and is cancelled by closing', async () => {
  const P = movingPage(), performed = [];
  P.ui.on('open', () => performed.push(P.box().querySelector('.gz-ask-md').textContent));
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Take me to my grades'); await settle();
  answer(P, { type: 'action', action: { kind: 'open' } });
  const text = 'Your grades page is ready. '.repeat(3);
  answer(P, { type: 'end', task: 'agent.tools', answer: { text } }); await settle();
  assert.deepEqual(performed, [], 'navigation must not leave before the answer is visible');
  for (let i = 0; i < 100 && P.frames.size; i++) P.flushFrame();
  assert.deepEqual(performed, [text]);
  P.ask('Open grades again'); await settle();
  answer(P, { type: 'action', action: { kind: 'open' } });
  answer(P, { type: 'end', task: 'agent.tools', answer: { text } }); await settle();
  P.box().close();
  for (let i = 0; i < 100 && P.frames.size; i++) P.flushFrame();
  assert.equal(performed.length, 1, 'closing cancels actions queued behind a reveal');
});


test('a new question cancels navigation waiting behind the preceding answer reveal', async () => {
  const P = movingPage(), performed = [];
  P.ui.on('open', () => performed.push('open'));
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Open grades'); await settle();
  answer(P, { type: 'action', action: { kind: 'open' } });
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Your grades are ready. '.repeat(3) } }); await settle();
  P.ask('Wait, what is due?'); await settle();
  for (let i = 0; i < 100 && P.frames.size; i++) P.flushFrame();
  assert.deepEqual(performed, [], 'an earlier action must not navigate away during a new question');
  P.box().close();
});

// ---- the context meter, folded turns, and the chat in a tile --------------------------------------------------------------
const meterOf = (P, root = P.box()) => { const m = root.querySelector('.gz-ask-meter'); return { hidden: m.hidden, n: m.querySelector('.gz-ask-meter-n').textContent, band: m.dataset.band || '', label: m.getAttribute('aria-label'), text: m.textContent }; };

test('the context meter shows the share of the window the request takes, as a ring and its number, in three bands; New chat puts back the chat\'s own share', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  assert.equal(meterOf(P).hidden, true, 'nothing known yet');
  P.ask('Explain mitosis');
  await settle();
  const ctx = (used) => answer(P, { type: 'context', task: 'study.help', used, window: 1000, reserve: 100, exact: true });
  ctx(300);
  await settle();
  assert.deepEqual(meterOf(P), { hidden: false, n: '30%', band: '', label: '30% of the context window used', text: '30%' }, 'no word beside the number');
  assert.equal(P.box().querySelector('.gz-ask-meter-v').style.strokeDasharray, '30 100', 'the ring\'s arc set inline: the sheet\'s own dasharray would win over an attribute');
  for (const [used, band] of [[690, ''], [700, 'warm'], [899, 'warm'], [900, 'warn'], [1500, 'warn']]) {
    ctx(used);
    await settle();
    assert.equal(meterOf(P).band, band, String(used));
  }
  assert.equal(meterOf(P).n, '100%', 'never past the whole window');
  answer(P, study('What happens first?'));
  await settle();
  P.doc.fire(P.box().querySelector('.gz-ask-new'), 'click');
  assert.deepEqual([meterOf(P).n, meterOf(P).band], ['30%', ''], 'the chat\'s own share again');
});

test('turns the worker folded show as one line where they were, opened to read the summary; later questions carry it with only the newer turns', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  for (let i = 1; i <= 3; i++) { P.ask(`Question ${i}`); await settle(); answer(P, study(`Answer ${i}`)); await settle(); }
  const last = asked(P).at(-1);
  P.ports.at(-1).answer({ id: last.id - 1, type: 'summary', text: '- stale', turns: 2 });
  await settle();
  assert.equal(P.box().querySelector('.gz-ask-fold'), null, 'only the last question\'s summary');
  P.ports.at(-1).answer({ id: last.id, type: 'summary', text: '- **Mitosis**: asked twice', turns: 2 });
  await settle();
  const fold = P.box().querySelector('.gz-ask-fold');
  assert.ok(fold);
  const items = P.box().querySelector('.gz-ask-log').children;
  assert.equal(items.indexOf(fold), items.indexOf(P.box().querySelectorAll('.gz-ask-a')[1]) + 1, 'right after the second answer');
  assert.equal(fold.querySelector('summary').textContent, 'Earlier messages summarized');
  assert.equal(fold.querySelector('details').open, undefined, 'closed until the student opens it');
  assert.equal(fold.querySelector('details strong').textContent, 'Mitosis', 'the summary, drawn as the answers are');
  P.ask('Question 4');
  await settle();
  assert.equal(asked(P).at(-1).summary, '- **Mitosis**: asked twice');
  assert.deepEqual([...asked(P).at(-1).history.map((h) => h.question)], ['Question 3']);
  P.doc.fire(P.box().querySelector('.gz-ask-stop'), 'click');
  answer(P, { type: 'error', error: 'cancelled' });
  await settle();
  P.doc.fire(P.box().querySelector('.gz-ask-new'), 'click');
  assert.equal(P.box().querySelector('.gz-ask-fold'), null);
  P.ask('Question 5');
  await settle();
  assert.equal(asked(P).at(-1).summary, undefined, 'a new chat carries nothing');
});

test('New chat rejects a delayed summary from the conversation it cleared', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Old question'); await settle();
  answer(P, study('Old answer')); await settle();
  const oldPort = P.ports.at(-1), oldId = asked(P).at(-1).id;
  P.doc.fire(P.box().querySelector('.gz-ask-new'), 'click');
  oldPort.answer({ id: oldId, type: 'summary', text: '- Old conversation', turns: 1 });
  P.ask('New question'); await settle();
  answer(P, study('New answer')); await settle();
  P.ask('New follow-up'); await settle();
  assert.equal(asked(P).at(-1).summary, undefined, 'no old summary can enter the new conversation');
  assert.deepEqual([...asked(P).at(-1).history.map((h) => h.question)], ['New question']);
  P.box().close();
});

test('the chat mounts in a tile with its own port and conversation, no ids, its meter and New chat in its head, beside the dialog', async () => {
  const P = page({ reply: ready });
  const host = P.doc.createElement('div');
  P.doc.body.append(host);
  const chat = P.context.GZ_ASK_CHAT.mount(host, { variant: 'tile' });
  await settle();
  const root = host.querySelector('.gz-ask-chat');
  assert.equal(root.dataset.variant, 'tile');
  assert.ok(root.querySelector('.gz-ask-meter') && root.querySelector('.gz-ask-new'));
  assert.equal(root.querySelector('.gz-ask-close'), null);
  assert.equal(root.querySelector('h2'), null, 'the tile\'s own head names it');
  assert.equal(root.all().filter((e) => e.id).length, 0, 'no ids');
  await P.ui.open({ event: { isTrusted: true } });
  assert.equal(P.doc.root.all().filter((e) => e.id === 'gz-ask-q').length, 1, 'the dialog\'s ids stay unique');
  const input = root.querySelector('.gz-ask-input');
  input.value = 'From the tile';
  P.doc.fire(input, 'keydown', { key: 'Enter' });
  await settle();
  const sent = asked(P).find((m) => m.question === 'From the tile');
  assert.ok(sent);
  chat.focus();
  assert.equal(P.doc.activeElement, input);
  chat.stop();
  assert.equal(host.querySelector('.gz-ask-chat'), null, 'gone with stop');
  assert.ok(P.ports.filter((p) => p.posted.includes(sent))[0].hungUp, 'its port with it');
  assert.ok(P.box()?.open, 'the dialog untouched');
});

test('a tile answer preserves focus after the student moves to the host page', async () => {
  const P = page({ reply: ready });
  const host = P.doc.createElement('div'), other = P.doc.createElement('textarea');
  P.doc.body.append(host, other);
  const chat = P.context.GZ_ASK_CHAT.mount(host, { variant: 'tile' });
  await settle();
  const input = chat.root.querySelector('.gz-ask-input');
  input.value = 'Explain mitosis';
  input.focus();
  P.doc.fire(input, 'keydown', { key: 'Enter' }); await settle();
  other.focus();
  answer(P, study('What happens to the chromosomes?')); await settle();
  assert.equal(P.doc.activeElement, other, 'the answer must not steal focus from another editor');
  chat.stop();
});

// ---- why a question failed, and Glaze's own answers (built) --------------------------------------------------------------
test('a failure\'s card opens to the rule, the steps run and the model\'s raw answer, as text; without them, no detail', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('What is due this week?');
  await settle();
  answer(P, { type: 'error', error: 'check', why: 'hands', steps: 2, raw: '{"call":null,"answer":{"text":"<b>x = 5</b>"}}' });
  await settle();
  const why = P.box().querySelector('.gz-ask-err details.gz-ask-why');
  assert.ok(why, 'a detail on the card');
  assert.equal(why.open, undefined, 'closed until opened');
  assert.equal(why.querySelector('summary').textContent, 'check: hands · 2');
  assert.equal(why.querySelector('pre').textContent, '{"call":null,"answer":{"text":"<b>x = 5</b>"}}');
  assert.equal(why.querySelectorAll('b').length, 0, 'the raw answer stays text');
  P.doc.fire(P.box().querySelector('.gz-ask-retry'), 'click');
  await settle();
  answer(P, { type: 'error', error: 'busy' });
  await settle();
  assert.equal(P.box().querySelector('.gz-ask-err details.gz-ask-why'), null, 'nothing to show, no detail');
});

test('an answer Glaze built itself renders as any answer, with the same detail under it when it carries why and raw', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Which assignments are coming up?');
  await settle();
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: '- **Lab report** (BIO 1100)\n- **Reading response**', built: true, why: 'number', steps: 3, raw: 'Lab report is due on the 14th.' } });
  await settle();
  const a = P.box().querySelector('.gz-ask-a');
  assert.deepEqual(a.querySelectorAll('.gz-ask-md li strong').map((x) => x.textContent), ['Lab report', 'Reading response']);
  assert.equal(a.dataset.built, '');
  const why = a.querySelector('details.gz-ask-why');
  assert.equal(why.querySelector('summary').textContent, 'number · 3');
  assert.equal(why.querySelector('pre').textContent, 'Lab report is due on the 14th.');
  assert.deepEqual(P.turns().at(-1), ['gz-ask-a', 'Lab report (BIO 1100)Reading response'], 'the detail is not part of the answer\'s words');
  P.ask('And next week?');
  await settle();
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: '- **Essay**', built: true } });
  await settle();
  assert.equal(P.box().querySelectorAll('.gz-ask-a')[1].querySelector('details.gz-ask-why'), null, 'built, nothing more to show: no detail');
});

test('the chat carries its worker tool union across fresh ports and clears it with New chat', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('What is due?'); await settle();
  answer(P, { type: 'tools', tools: ['todo_list', 'accounts_list'] });
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Nothing due.' } });
  await settle();
  P.ask('Any announcements?'); await settle();
  const sent = P.posted.filter((m) => m.op === 'ask');
  assert.deepEqual(Array.from(sent[1].tools), ['todo_list', 'accounts_list']);
  assert.ok(P.ports.at(-2).hungUp, 'each question uses a new port');
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Nothing new.' } }); await settle();
  P.doc.fire(P.box().querySelector('.gz-ask-new'), 'click');
  P.ask('What is my grade?'); await settle();
  assert.equal(P.posted.filter((m) => m.op === 'ask').at(-1).tools, undefined);
  P.setAi({ on: false });
});

test('a built answer shows diagnostics from the worker end envelope, excluded from the next turn', async () => {
  const P = page({ reply: ready });
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('What is due?'); await settle();
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: '- Lab report', built: true }, why: 'number', raw: '<b>42 tasks</b>' });
  await settle();
  const detail = P.box().querySelector('.gz-ask-a details.gz-ask-why');
  assert.ok(detail);
  assert.equal(detail.querySelector('pre').textContent, '<b>42 tasks</b>');
  assert.equal(detail.querySelector('b'), null);
  P.ask('And next week?'); await settle();
  assert.equal(P.posted.filter((m) => m.op === 'ask').at(-1).history[0].answer, '- Lab report');
  P.setAi({ on: false });
});
