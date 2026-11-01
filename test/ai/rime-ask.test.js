// Ask Rime with Rime's own tools (docs/ai-harness.md "Rime's own tools", "Ask Rime"): the tools level that gates them (a local
// model's models.json `tools`; Rime r5's entries have none, so its requests are byte for byte what it was gated on), routing
// for computing, opening a place, reminders and watches in six languages, the call path that gives the tools their context,
// confirm tools asked in Glaze's approval window with the tool's own sentence, UI actions sent once the answer passes, a
// card's detail, and fired reminders and watches taken, shown and asked about.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const TL = require('../../extension/ai/tools.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const K = require('../../extension/ai/ask.js');
const W = require('../../extension/ai/agent/wakes.js');
const L = require('../../extension/ai/providers/local.js');
const C = require('../helpers/mcp-caches.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OWN = new Set(A.OWN);

// The router as it was before Rime's own tools (the chat port's head), loaded beside the real one.
const OLD = (() => {
  const file = path.join(ROOT, 'extension/ai/ask-ec74ace13.js'), m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(execFileSync('git', ['show', 'ec74ace13:extension/ai/ask.js'], { cwd: ROOT, encoding: 'utf8' }), file);
  return m.exports;
})();
const CORPUS = {
  en: ['What is due this week?', 'How are my grades?', 'Mark my lab report done', 'Convert 3.2 miles to km', 'Take me to my BIO grades', 'Remind me at 9 pm to finish the lab',
    'Let me know when my BIO grade posts', 'What do I need on the exam to keep a B?', 'Calculate my grade if I score 90 on the final', 'How do I solve 3x + 5 = 20?', 'Where are my assignments?', 'Cancel my lab reminder'],
  es: ['¿Qué tengo que entregar esta semana?', 'Convierte 3,2 millas a km', 'Llévame a mis notas', 'Recuérdame a las 9 terminar el laboratorio', 'Avísame cuando publiquen mi nota'],
  'pt-BR': ['Quais são minhas notas?', 'Converta 3,2 milhas em km', 'Me leve para minhas tarefas', 'Me lembre às 21h de terminar o laboratório', 'Me avise quando sair minha nota'],
  fr: ['Quelles sont mes notes ?', 'Convertis 3,2 miles en km', 'Emmène-moi à mes notes', 'Rappelle-moi à 21 h de finir le labo', 'Préviens-moi quand ma note sera publiée'],
  de: ['Wie sind meine Noten?', 'Rechne 3,2 Meilen in km um', 'Bring mich zu meinen Noten', 'Erinnere mich um 21 Uhr an das Labor', 'Sag mir, wenn meine Note da ist'],
  nl: ['Wat zijn mijn cijfers?', 'Reken 3,2 mijl om naar km', 'Breng me naar mijn cijfers', 'Herinner me om 21 uur aan het lab', 'Laat me weten wanneer mijn cijfer er is'],
};

// ---- the gate -----------------------------------------------------------------------------------------------------------
test('gate: Rime r5\'s models.json entries say no tools level, so a local model gets level 1', () => {
  const list = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/ai/local/models.json'), 'utf8')).models;
  assert.ok(list.filter((m) => !m.role).length >= 3);
  for (const m of list) assert.equal(m.tools, undefined, `${m.id} is r5's: never trained on Rime's own tools`);
  const tiers = list.filter((m) => !m.role).map((m, i) => ({ ...m, state: i === 0 ? 'ready' : 'missing' }));
  assert.equal(L.levelOf(tiers), 1);
  // The round that trains them sets `tools: 3` on its entries; the model the provider runs decides.
  assert.equal(L.levelOf(tiers.map((m) => ({ ...m, tools: 3 }))), 3);
  assert.equal(L.levelOf([{ ...tiers[0], tools: 3, state: 'missing' }, { ...tiers[1], state: 'ready' }]), 1, 'the one it runs, not any');
  assert.equal(L.levelOf([]), 1);
});

test('gate: at level 1 the router is the chat port\'s, question for question, so Rime r5\'s requests stay byte-identical', () => {
  for (const [locale, qs] of Object.entries(CORPUS)) for (const q of qs) {
    assert.deepEqual(K.route(q, { locale }), OLD.route(q, { locale }), `${locale}: ${q}`);
    assert.deepEqual(K.route(q, { locale, level: 1 }), OLD.route(q, { locale }), `${locale}: ${q}`);
    const r = K.route(q, { locale });
    assert.ok(r.task === 'study.help' || r.tools.every((n) => !OWN.has(n)), `${locale}: ${q}: no Rime tool at level 1`);
  }
  // And the request agent.tools builds from it is the same request, byte for byte.
  const text = require('../../extension/ai/text.js'), now = Date.UTC(2026, 9, 30), zone = 'UTC';
  const r = K.route('What is due this week?', { locale: 'en' }), o = OLD.route('What is due this week?', { locale: 'en' });
  assert.equal(JSON.stringify(A.task.build(A.task.input({ question: 'What is due this week?', tools: r.tools, now, zone }), { text })),
    JSON.stringify(A.task.build(A.task.input({ question: 'What is due this week?', tools: o.tools, now, zone }), { text })));
});

// ---- routing at level 3 -------------------------------------------------------------------------------------------------
test('route at level 3: computing, opening a place, reminders and watches, in each of the six languages', () => {
  const want = { compute: 'run_js', navigate: 'place_open', remind: 'wake_create', watch: 'monitor_create' };
  const by = {
    compute: { en: 'Convert 3.2 miles to km', es: 'Convierte 3,2 millas a km', 'pt-BR': 'Converta 3,2 milhas em km', fr: 'Convertis 3,2 miles en km', de: 'Rechne 3,2 Meilen in km um', nl: 'Reken 3,2 mijl om naar km' },
    navigate: { en: 'Take me to my BIO grades', es: 'Llévame a mis notas', 'pt-BR': 'Me leve para minhas tarefas', fr: 'Emmène-moi à mes notes', de: 'Bring mich zu meinen Noten', nl: 'Breng me naar mijn cijfers' },
    remind: { en: 'Remind me at 9 pm to finish the lab', es: 'Recuérdame a las 9 terminar el laboratorio', 'pt-BR': 'Me lembre às 21h de terminar o laboratório', fr: 'Rappelle-moi à 21 h de finir le labo', de: 'Erinnere mich um 21 Uhr an das Labor', nl: 'Herinner me om 21 uur aan het lab' },
    watch: { en: 'Let me know when my BIO grade posts', es: 'Avísame cuando publiquen mi nota', 'pt-BR': 'Me avise quando sair minha nota', fr: 'Préviens-moi quand ma note sera publiée', de: 'Sag mir, wenn meine Note da ist', nl: 'Laat me weten wanneer mijn cijfer er is' },
  };
  for (const [topic, qs] of Object.entries(by)) for (const [locale, q] of Object.entries(qs)) {
    const r = K.route(q, { locale, level: 3 });
    assert.equal(r.task, 'agent.tools', `${topic} ${locale}: ${q}`);
    assert.ok(r.tools.includes(want[topic]), `${topic} ${locale}: ${JSON.stringify(r.tools)}`);
    assert.ok(r.tools.length <= 6 && r.tools.every((n) => A.NAMES.includes(n)));
  }
  // The student's own grade math computes; graded work still goes to study help, which never gives the answer.
  const grade = K.route('Calculate my grade if I score 90 on the final', { locale: 'en', level: 3 });
  assert.deepEqual([grade.task, grade.tools.includes('run_js'), grade.tools.includes('grades_list')], ['agent.tools', true, true]);
  assert.equal(K.route('Calculate 17% of 2,340 for my homework', { locale: 'en', level: 3 }).task, 'study.help');
  assert.equal(K.route('How do I solve 3x + 5 = 20?', { locale: 'en', level: 3 }).task, 'study.help');
  // A fired record asks with the tools what it watched needs.
  assert.deepEqual(K.routeFired({ what: 'monitor', watch: 'grade' }).tools, ['course_grades', 'grades_list', 'wakes_list', 'accounts_list']);
  assert.ok(K.routeFired({ what: 'wake' }).tools.includes('wake_create'));
});

// ---- the port, with Rime's own tools ------------------------------------------------------------------------------------
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 60) => { for (let i = 0; i < n; i++) await tick(); };
const ports = () => {
  const side = () => ({ on: [], gone: [], closed: false });
  const a = side(), b = side();
  const end = (me, other) => ({
    postMessage: (m) => { if (me.closed) throw new Error('closed'); const c = structuredClone(m); setTimeout(() => { if (!other.closed) other.on.forEach((f) => f(c)); }, 0); },
    onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) },
    disconnect: () => { if (me.closed) return; me.closed = true; setTimeout(() => { if (!other.closed) { other.closed = true; other.gone.forEach((f) => f()); } }, 0); },
  });
  return [end(a, b), end(b, a)];
};
const call = (name, args) => ({ call: { name, arguments: args, kind: A.SPECS.find((s) => s.name === name).kind }, answer: null });
const said = (text, quotes = []) => ({ call: null, answer: { text, quotes } });
const ACC = `${C.CANVAS}/5`;
const memory = (store) => ({ get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(store, x)).map((x) => [x, store[x]]))), set: async (v) => { Object.assign(store, structuredClone(v)); } });
const harness = ({ script = [], approve = 'yes', level = 3, store = {}, now = C.NOW, scope, tab } = {}) => {
  const seen = { runs: [], asks: [] };
  const broker = (port) => port.onMessage.addListener(async (m) => {
    if (m.op !== 'run') return;
    seen.runs.push(m);
    const next = script[seen.runs.filter((r) => r.task === m.task).length - 1];
    port.postMessage(next ? { id: m.id, type: 'end', output: typeof next === 'function' ? next(m.input) : next } : { id: m.id, type: 'error', error: 'check' });
  });
  const wakes = { local: memory(store), alarms: null, read: async () => null, on: async () => true, now: () => now };
  const env = {
    allowed: async () => true, broker, settings: async () => ({ on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: () => null, describe: () => ({}) }, state: async () => ({}), refresh: async () => null, local: {}, keys: async () => [], turn: (f) => f(), zone: 'UTC', now: () => now,
    accounts: async () => [{ account: ACC, origin: C.CANVAS }], approve: { ask: async (kind, view) => { seen.asks.push({ kind, view }); return approve; } },
    scope, tab, level: async () => level, page: () => ({ url: `${C.CANVAS}/courses/25/grades` }),
    own: { read: async (name, args, account) => (name === 'courses_list' && account === ACC ? { items: [{ id: '25', name: 'BIO 1100', code: 'BIO1100' }] } : null), writer: async () => true, wakes },
  };
  const [page, worker] = ports();
  K.connect(worker, env);
  const got = [];
  page.onMessage.addListener((m) => got.push(m));
  return { got, seen, store, wakes, env, say: (m) => page.postMessage(m), ends: () => got.filter((m) => ['end', 'error'].includes(m.type)), steps: () => got.filter((m) => m.type === 'step').map((m) => m.step) };
};

test('port: run_js, then a place opened and words marked; each card\'s detail; the actions sent once the answer passes, before its end', async () => {
  const h = harness({ script: [call('run_js', { code: '(18 / 20 * 100).toFixed(0)' }), call('places_list', { course: '25' }), call('place_open', { place: 'course:25/grades' }),
    call('page_highlight', { text: 'Homework 6', note: '18 of 20' }), said('Homework 6 is 90%. Your grades page is open with it marked.', ['Homework 6'])] });
  h.say({ id: 1, op: 'ask', question: 'Take me to my BIO grades and show Homework 6', locale: 'en', site: 'canvas', text: 'Grades\nHomework 6  18 / 20' });
  await settle(200);
  assert.deepEqual(h.ends().map((m) => m.type), ['end'], JSON.stringify(h.ends()));
  const steps = h.steps().filter((s) => s.state !== 'run').map(({ ms: _, ...s }) => s);
  assert.deepEqual(steps, [{ n: 1, name: 'run_js', kind: 'read', state: 'done', detail: '90' }, { n: 2, name: 'places_list', kind: 'read', state: 'done' },
    { n: 3, name: 'place_open', kind: 'read', state: 'done', detail: 'BIO 1100 grades' }, { n: 4, name: 'page_highlight', kind: 'read', state: 'done', detail: 'Homework 6' }]);
  const tail = h.got.filter((m) => ['action', 'end'].includes(m.type));
  assert.deepEqual(tail.map((m) => [m.type, m.action?.kind]), [['action', 'open'], ['action', 'highlight'], ['end', undefined]]);
  assert.deepEqual(tail[0].action, { kind: 'open', place: 'course:25/grades', title: 'BIO 1100 grades', url: `${C.CANVAS}/courses/25/grades` });
  assert.deepEqual(tail[1].action, { kind: 'highlight', text: 'Homework 6', note: '18 of 20' });
  // What the model read: each tool's own answer, never Agents' wrapper.
  assert.deepEqual(h.seen.runs[1].input.steps[0].result, { ok: true, value: '90', logs: [] });
});

test('port: a confirm tool asks in Glaze\'s window with the tool\'s own sentence; Allow runs it once; anything else ends the question', async () => {
  const yes = harness({ script: [call('wake_create', { at: '2026-10-15 21:00', say: 'Finish the lab' }), said('I will remind you at 21:00.')] });
  yes.say({ id: 2, op: 'ask', question: 'Remind me at 9 pm to finish the lab', locale: 'en', site: 'canvas' });
  await settle(200);
  assert.deepEqual(yes.seen.asks.map((a) => [a.kind, a.view.summary, a.view.tool.title, a.view.app.name]), [['action', 'Come back Thu, Oct 15, 9:00 PM: “Finish the lab”', 'Set a reminder', 'Ask Rime']]);
  assert.deepEqual(yes.steps().map((s) => s.state), ['ask', 'done']);
  assert.equal(yes.store.rimeWakes.wakes.length, 1);
  assert.deepEqual(yes.ends().map((m) => m.type), ['end']);

  const no = harness({ approve: 'no', script: [call('wake_create', { at: '2026-10-15 21:00', say: 'Finish the lab' }), said('Done!')] });
  no.say({ id: 3, op: 'ask', question: 'Remind me at 9 pm to finish the lab', locale: 'en' });
  await settle(200);
  assert.deepEqual(no.ends(), [{ id: 3, type: 'end', task: 'agent.tools', declined: true }]);
  assert.deepEqual(no.steps().map((s) => s.state), ['ask', 'no']);
  assert.equal(no.store.rimeWakes, undefined, 'nothing kept');
  assert.equal(no.seen.runs.length, 1, 'the model is asked nothing more');
});

test('port: at level 1 a reminder question goes to study help as before, and no Rime tool is offered', async () => {
  const h = harness({ level: 1, script: [] });
  h.say({ id: 4, op: 'ask', question: 'Remind me at 9 pm to finish the lab', locale: 'en' });
  await settle(80);
  assert.equal(h.got.find((m) => m.type === 'route').task, OLD.route('Remind me at 9 pm to finish the lab', { locale: 'en' }).task);
  assert.ok(h.seen.runs.every((r) => r.task !== 'agent.tools' || r.input.tools.every((n) => !OWN.has(n))));
});

test('port: fired reminders are taken for the page, and the click that asks about one runs its own turn at level 3 only', async () => {
  const store = {}, at = C.NOW - 60e3;
  store.rimeWakes = { wakes: [{ id: 'w-abcdefgh', at, say: 'Finish the lab report', made: at - 864e5 }], monitors: [], fired: [] };
  const h = harness({ store, script: [said('Your reminder: finish the lab report.')] });
  h.say({ id: 5, op: 'fired' });
  await settle(60);
  assert.deepEqual(h.ends(), [{ id: 5, type: 'end', fired: [{ id: 'w-abcdefgh', what: 'wake', say: 'Finish the lab report', at: C.NOW }] }]);
  h.say({ id: 6, op: 'fired' });
  await settle(40);
  assert.deepEqual(h.ends().at(-1).fired, [], 'shown once');
  h.say({ id: 7, op: 'ask', question: 'Finish the lab report', fired: 'w-abcdefgh', locale: 'en' });
  await settle(120);
  const run = h.seen.runs.find((r) => r.task === 'agent.tools');
  assert.deepEqual(run.input.fired, { what: 'wake', say: 'Finish the lab report', at: C.NOW });
  assert.deepEqual(run.input.tools, ['todo_list', 'schedule_list', 'wakes_list', 'wake_create', 'accounts_list']);
  assert.equal(h.ends().at(-1).answer.text, 'Your reminder: finish the lab report.');

  const store1 = { rimeWakes: { wakes: [{ id: 'w-bcdefghi', at, say: 'What is due this week?', made: at - 864e5 }], monitors: [], fired: [] } };
  const old = harness({ level: 1, store: store1, script: [said('Nothing is due.')] });
  old.say({ id: 8, op: 'fired' });
  await settle(60);
  old.say({ id: 9, op: 'ask', question: 'What is due this week?', fired: 'w-bcdefghi', locale: 'en' });
  await settle(120);
  const r1 = old.seen.runs.find((r) => r.task === 'agent.tools');
  assert.equal(r1.input.fired, undefined, 'Rime r5 never sees a turn it wasn\'t trained on');
  assert.deepEqual(r1.input.tools, OLD.route('What is due this week?', { locale: 'en' }).tools);
});

test('port: a site the panel doesn\'t know, words that aren\'t text, or a fired id that isn\'t one are refused', async () => {
  const h = harness();
  for (const m of [{ id: 10, op: 'ask', question: 'x', site: 'myspace' }, { id: 11, op: 'ask', question: 'x', text: 5 }, { id: 12, op: 'ask', question: 'x', fired: 3 }]) h.say(m);
  await settle(40);
  assert.deepEqual(h.ends().map((m) => [m.id, m.error]), [[10, 'request'], [11, 'request'], [12, 'request']]);
});

test('grade math with an assignment named "Homework" runs, in each of the six languages', () => {
  const qs = { en: "If I get 18/20 on Homework 6, what's my grade?", es: 'Si saco 18/20 en la Tarea 6, ¿cuál es mi nota?', 'pt-BR': 'Se eu tirar 18/20 na Lição de casa 6, qual é a minha nota?',
    fr: 'Si j\'ai 18/20 au Devoir 6, quelle est ma moyenne ?', de: 'Wenn ich 18/20 in Hausaufgabe 6 bekomme, wie ist meine Note?', nl: 'Als ik 18/20 haal voor Huiswerk 6, wat is mijn cijfer?' };
  for (const [locale, q] of Object.entries(qs)) {
    assert.equal(A.why({ call: { name: 'run_js', arguments: { code: '18 / 20 * 100' } }, answer: null }, A.task.input({ question: q, tools: [...A.NAMES], now: C.NOW, zone: 'UTC', locale })), '', `${locale}: ${q}`);
  }
  // Doing the homework itself is still refused.
  assert.equal(A.why({ call: { name: 'run_js', arguments: { code: '4 * 12' } }, answer: null }, A.task.input({ question: 'Do my homework: 4 * 12', tools: [...A.NAMES], now: C.NOW, zone: 'UTC' })), 'work');
});


test('gate: the selected tier and explicit weights decide the level, including the worker vault configuration', async () => {
  const list = [{ id: 'new', tier: 1, tools: 3, state: 'ready' }, { id: 'r5', tier: 2, state: 'ready' }];
  assert.equal(L.levelOf(list, { weights: 'r5' }), 1);
  assert.equal(L.levelOf(list, { tier: 2 }), 1);
  assert.equal(L.levelOf(list, { weights: 'missing' }), 1);
  const source = fs.readFileSync(path.join(ROOT, 'extension/background/background.js'), 'utf8');
  const fn = /const rimeLevel = async \(\) => \{[\s\S]*?\n\};/.exec(source)[0];
  const cfg = { provider: 'local', tier: 2, weights: 'r5' };
  const level = vm.runInNewContext(`${fn} rimeLevel`, {
    chrome: { storage: { local: { get: async () => ({ ai: { on: true, model: { use: 'local' }, features: { ask: true } } }) } } },
    GZ_AI_SETTINGS: require('../../extension/ai/settings.js'),
    aiEnv: () => ({ vault: { get: async () => ({ local: cfg }) } }),
    GZ_AI_LOCAL: { config: L.config, toolsLevel: async (c) => L.levelOf(list, c) },
  });
  assert.equal(await level(), 1, 'the worker must pass the configuration the broker runs');
});


test('port: cancellation during context loading never opens an approval', async () => {
  let release;
  const waiting = new Promise((r) => { release = r; });
  const h = harness({ script: [call('wake_create', { at: '2026-10-15 21:00', say: 'Finish the lab' })] });
  h.env.own.writer = () => waiting;
  h.say({ id: 30, op: 'ask', question: 'Remind me at 9 pm to finish the lab' });
  await settle(25);
  h.say({ id: 30, op: 'cancel' });
  await settle(15);
  release(true);
  await settle(30);
  assert.deepEqual(h.seen.asks, [], 'Stop before the approval exists must not open it later');
  assert.equal(h.store.rimeWakes, undefined);
  assert.equal(h.ends().at(-1).error, 'cancelled');
});


test('port: a monitor runs against the same record its approval summarized', async () => {
  const h = harness({ script: [call('monitor_create', { watch: 'due', type: 'assignment', id: '1', say: 'Tell me when it moves' }), said('Watching the due date.')] });
  let reads = 0;
  h.wakes.read = async () => ({ items: [{ type: 'assignment', id: '1', due: C.NOW + 864e5, title: ++reads === 1 ? 'Biology lab' : 'History essay', course: 'BIO' }] });
  h.say({ id: 31, op: 'ask', question: 'Let me know when the due date moves' });
  await settle(90);
  assert.match(h.seen.asks[0].view.summary, /Biology lab/);
  assert.equal(h.store.rimeWakes.monitors[0].base.title, 'Biology lab', 'Allow binds the record the student saw');
  assert.equal(reads, 1, 'summary and run share one immutable reading');
});


const firedStore = (id, say = 'Finish the lab report') => ({ rimeWakes: { wakes: [], monitors: [], fired: [{ id, what: 'wake', say, at: C.NOW }] } });
test('port: fired records belong to their document across reconnects, expire, and are claimed once', async () => {
  const id = 'w-scope123', owner = harness({ scope: 'tab-1/document-1', store: firedStore(id) });
  owner.say({ id: 40, op: 'fired' }); await settle(25);
  const thief = harness({ scope: 'tab-2/document-2', script: [said('Stolen.')] });
  thief.say({ id: 41, op: 'ask', question: 'Finish the lab report', fired: id }); await settle(25);
  assert.equal(thief.seen.runs.length, 0, 'a different document cannot use the record');
  const again = harness({ scope: 'tab-1/document-1', script: [said('Your reminder: finish the lab report.')] });
  again.say({ id: 42, op: 'ask', question: 'Finish the lab report', fired: id }); await settle(25);
  assert.equal(again.seen.runs[0].input.fired.what, 'wake', 'panel status opens a new port in this document');
  again.say({ id: 43, op: 'ask', question: 'Finish the lab report', fired: id }); await settle(25);
  assert.equal(again.seen.runs.length, 1, 'a claimed record cannot become a new fired turn');
  const expired = harness({ scope: 'expiry', store: firedStore('w-expire12'), script: [said('Too late.')] });
  expired.say({ id: 44, op: 'fired' }); await settle(25);
  expired.env.now = () => C.NOW + 36e5 + 1;
  expired.say({ id: 45, op: 'ask', question: 'Finish the lab report', fired: 'w-expire12' }); await settle(25);
  assert.equal(expired.seen.runs.length, 0, 'expiry is enforced when used, without another fired poll');
});

test('port: a fired record cannot authorize a replacement question', async () => {
  const h = harness({ store: firedStore('w-replace1'), script: [said('Wrong question.')] });
  h.say({ id: 46, op: 'fired' }); await settle(25);
  h.say({ id: 47, op: 'ask', question: 'Open my grades', fired: 'w-replace1' }); await settle(25);
  assert.equal(h.seen.runs.length, 0);
});


test('port: own tools never fall back to another school account', async () => {
  const h = harness({ script: [call('places_list', {}), said('No cached courses on this site.')] });
  h.env.accounts = async () => [{ account: 'https://another.school/5', origin: 'https://another.school' }];
  const reads = [];
  h.env.own.read = async (...args) => { reads.push(args); return { items: [{ id: '25', name: 'Private other-school course' }] }; };
  h.say({ id: 50, op: 'ask', question: 'Take me to my courses', site: 'canvas' }); await settle(50);
  assert.deepEqual(reads, [], 'an unseen school has no inferred account');
  assert.ok(!JSON.stringify(h.seen.runs).includes('Private other-school course'));
});


test('port: carried highlights stay in the worker and reach only their tab and exact destination once', async () => {
  const url = `${C.CANVAS}/courses/25/grades?view=all`;
  const h = harness({ tab: 71, script: [call('place_open', { place: 'grades' }), call('page_highlight', { text: 'Homework', note: 'Read this' }), said('Grades are open.')] });
  // Use a real action-producing call, then inspect the extension-owned handoff.
  h.say({ id: 60, op: 'ask', question: 'Take me to my grades', site: 'canvas' }); await settle(80);
  const dest = `${C.CANVAS}/grades`;
  const env = { ...h.env, page: () => ({ url: dest }) };
  assert.equal((await K.arrival({ ...env, tab: 72 })).length, 0, 'other tabs get nothing');
  assert.equal((await K.arrival({ ...env, page: () => ({ url: `${dest}?other=1` }) })).length, 0, 'query parameters identify the destination too');
  assert.equal((await K.arrival({ ...env, page: () => ({ url: 'https://evil.example/grades' }) })).length, 0);
  assert.deepEqual(await K.arrival(env, true), [{ text: 'Homework', note: 'Read this' }]);
  assert.deepEqual(await K.arrival(env, true), [], 'one delivery');
});
