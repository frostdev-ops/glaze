// Ask Glaze's panel (ai/page/ask.js) on a stand-in page: it opens and asks only for the student's own click or key, sends the
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

const page = ({ ai = { on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }, lang = 'en', reply } = {}) => {
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
    document: doc, window: {}, navigator: { get userActivation() { return { isActive: env.activation }; } }, setTimeout, clearTimeout, Promise, JSON, structuredClone,
    GZ_I18N: require('../../extension/core/i18n.js'),
    GZ_CTX: { t: (k, v) => k.replace(/\{(\w+)\}/g, (m, x) => v?.[x] ?? m), on: () => true, locale: () => lang, settings: () => D.GZ_SANITIZE({ enabled: true }) },
    chrome: { runtime: { connect, lastError: undefined }, storage: { local: { get: (k, cb) => env.read(cb) }, onChanged: { addListener: (f) => env.changed.push(f) } } },
  });
  env.ui = vm.runInContext(read('ai/page/ask.js'), context);
  env.context = context;
  env.box = () => doc.getElementById('gz-ask');
  env.q = () => doc.getElementById('gz-ask-q');
  env.ask = (text, trusted = true) => { env.q().value = text; doc.fire(env.q(), 'keydown', { key: 'Enter', trusted }); };
  env.turns = () => env.box().querySelectorAll('.gz-ask-log li').map((li) => [li.className, li.textContent]);
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
  assert.equal(P.say(), 'Choose a model for Ask Glaze in Settings → AI.');
  P.ask('What is due?'); await settle();
  assert.equal(P.say(), 'Glaze couldn’t answer that. Try asking another way.');
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

test('the command palette offers Ask Glaze only while AI and Ask are on, and opens it only for the student\'s own choice', () => {
  const src = read('navigation/page/palette.js');
  assert.match(src, /askOn = r\?\.ai\?\.on === true && r\.ai\.features\?\.ask === true/);
  assert.match(src, /\.\.\.\(askOn \? \[\{ label: t\('Ask Glaze'\), hint: 'Glaze', group: 'Glaze', run: \(e\) => e\?\.isTrusted && need\('ai\/page\/ask\.js'/);
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
  assert.equal(message, 'Choose a model for Ask Glaze in Settings → AI.');
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
