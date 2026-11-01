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
  assert.match(src, /\.\.\.\(askOn \? \[\{ label: t\('Ask Rime'\), hint: 'Glaze', group: 'Glaze', run: \(e\) => e\?\.isTrusted && need\('ai\/page\/ask\.js'/);
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

test('a UI action a run returns goes to the handler for its kind, only while its question runs', async () => {
  const P = page({ reply: ready });
  const got = [];
  P.ui.on('highlight', (a) => got.push(a));
  await P.ui.open({ event: { isTrusted: true } });
  P.ask('Where are my grades?');
  await settle();
  answer(P, { type: 'action', action: { kind: 'highlight', text: 'Grades' } });
  answer(P, { type: 'action', action: { kind: 'nope' } });
  await settle();
  assert.deepEqual(got, [{ kind: 'highlight', text: 'Grades' }]);
  answer(P, { type: 'end', task: 'agent.tools', answer: { text: 'Here.' } });
  await settle();
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
  const src = read('ai/page/ask.js');
  const literals = [...src.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  const P = page();
  const all = [...new Set([...literals, ...Object.values(P.ui.STEPS)])];
  assert.ok(all.length > 20);
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    const file = read(`i18n/${lang}.js`);
    const missing = all.filter((k) => !file.includes(`${JSON.stringify(k)}:`));
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
  assert.doesNotMatch(rest.replace(/animation(?:-name)?:\s*none/g, ''), /animation|transition|@keyframes/, 'nothing moves outside the motion block');
  for (const [, selectors] of motion[1].matchAll(/(?:^|\})\s*([^{}@]+?)\s*\{/g)) {
    if (/^(from|to|\d+%)/.test(selectors)) continue;
    for (const sel of selectors.split(',')) assert.match(sel.trim(), /^html:not\(\[data-gz-motion="off"\]\) /, sel);
  }
  assert.match(sheet, /html\[data-gz-bg="solid"\] #gz-ask[^{]*\{[^}]*backdrop-filter: none/);
  assert.match(sheet, /prefers-reduced-transparency: reduce[\s\S]*#gz-ask[^{]*\{[^}]*backdrop-filter: none/);
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
