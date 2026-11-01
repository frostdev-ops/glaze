// Ask Rime's reads of the student's school (ai/agent/school.js) and the tool-first rule (docs/ai-harness.md "Rime's own
// tools"): announcements, course content, the syllabus Glaze imported and discussions, read through Glaze's own readers in an
// open tab of the school (agents/tabs.js → agents/tab.js, over responses in the shape the fixtures copy) or its caches;
// check()'s first and ground rules; the help turn; routing for these questions in six languages; and the help flow on the port.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const S = require('../../extension/ai/schema.js');
const TL = require('../../extension/ai/tools.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const SC = require('../../extension/ai/agent/school.js');
const K = require('../../extension/ai/ask.js');
const TABS = require('../../extension/agents/tabs.js');
const SY = require('../../extension/planner/syllabus.js');
const C = require('../helpers/mcp-caches.cjs');
const H = require('../helpers/mcp-tabs.cjs');

const ROOT = path.join(__dirname, '..', '..');
const NEW = ['announcements_list', 'announcement_read', 'content_list', 'content_read', 'syllabus_read', 'discussions_list', 'discussion_read'];
const ACC = `${C.CANVAS}/5`, UL = `${C.ULTRA}/${C.ULTRA_UID}`;
const ULTRA = C.load('ultra-search.json');
// A Canvas topic as courses/announce.js SITES.canvas reads one (its fields only: title, author, posted_at, message, attachments).
const TOPIC = { id: 70, title: 'Lab moved to Room 204', author: { display_name: 'Dr. Rivera' }, posted_at: '2026-10-14T15:00:00Z', message: '<p>This week we meet in <b>Room 204</b>.</p><p>Bring goggles.</p>',
  attachments: [{ display_name: 'map.pdf', url: `${C.CANVAS}/files/9/download` }], read_state: 'unread', locked_for_user: false };
// Canvas modules with their items as the notes and progress features read them (name, published, state; id, title, type, published).
const MODULES = [{ id: 1, name: 'Week 1', published: true, items: [{ id: 11, title: 'Welcome', type: 'Page' }, { id: 12, title: 'Readings', type: 'SubHeader' }, { id: 13, title: 'Syllabus.pdf', type: 'File' },
  { id: 14, title: 'Draft', type: 'Page', published: false }] }, { id: 2, name: 'Week 2', state: 'locked', items: [{ id: 21, title: 'Locked page', type: 'Page' }] },
{ id: 3, name: 'Week 3', items: [{ id: 31, title: 'Lab report 3', type: 'Assignment' }, { id: 32, title: 'Simulator', type: 'ExternalTool' }] }];
const TOPICS = [{ id: 81, title: 'Cell questions' }, { id: 82, title: 'Week 2 reflections' }];

const tabsOf = (tabs) => { const b = H.browser(tabs); return TABS.create({ tabs: b.tabs, scripting: b.scripting, quiet: H.quiet }); };
const canvasTab = (o = {}) => H.tab({ id: 1, url: `${C.CANVAS}/courses/25`, routes: {
  '/api/v1/courses/25/discussion_topics/70': TOPIC, '/api/v1/courses/25/discussion_topics/81': { ...TOPIC, id: 81, title: 'Cell questions', message: '<p>Share one question about cells.</p>', attachments: [] },
  '/api/v1/courses/25/modules': MODULES, '/api/v1/courses/25/discussion_topics': TOPICS, ...o.routes }, ...o });
const ultraTab = (o = {}) => H.tab({ id: 2, url: `${C.ULTRA}/ultra/courses/_101_1/outline`, site: 'ultra', uid: C.ULTRA_UID, memberships: C.load('ultra-memberships.json').results, routes: {
  '/learn/api/public/v1/courses/_101_1/announcements': { results: ULTRA.announcements },
  '/learn/api/public/v1/courses/_101_1/announcements/_801_1': { ...ULTRA.announcements[0], created: '2026-10-13T12:00:00Z' },
  '/learn/api/public/v1/courses/_101_1/contents': { results: ULTRA.contents }, '/learn/api/public/v1/courses/_101_1/discussions': { results: ULTRA.discussions }, ...o.routes }, ...o });
const ctxFor = (account, tabs, store = {}) => ({ account, local: C.area(store), tab: (op, args) => tabs.run(account, op, args, {}) });
const tool = (name) => SC.tools().find((t) => t.name === name);

test('the seven reads are agent.tools tools, kind read, string and integer parameters, one schema with ai/agent/school.js', () => {
  for (const n of NEW) {
    const s = A.SPECS.find((x) => x.name === n), d = TL.define(tool(n));
    assert.ok(A.OWN.includes(n), n);
    assert.equal(s.kind, 'read', n);
    assert.equal(d.parameters, s.parameters, n);
    for (const [k, p] of Object.entries(s.parameters.properties)) assert.ok(['string', 'integer'].includes(p.type), `${n}.${k}`);
    assert.ok(s.description.length <= 260, n);
  }
});

test('Canvas: announcements from the to-do list Glaze keeps; one read in the tab as the pop-up reads it, paged, never marked read', async () => {
  const note = (id, title, at, read = false) => C.planner({ type: 'announcement', id, course: 25, name: 'BIO 1100', title, at, ...(read && {}) });
  const store = { todoCache: await C.canvasPlan('5', [note(70, 'Lab moved to Room 204', '2026-10-14T15:00:00Z'), note(71, 'Welcome', '2026-10-01T15:00:00Z'), C.planner({ id: 1, title: 'Lab report', at: '2026-10-16T03:59:00Z' })]) };
  const t = canvasTab(), tabs = tabsOf([t]);
  const list = await tool('announcements_list').run({}, ctxFor(ACC, tabs, store));
  assert.deepEqual(list.items.map((i) => [i.id, i.title, i.courseId]), [['70', 'Lab moved to Room 204', '25'], ['71', 'Welcome', '25']]);
  assert.ok(list.covers.from && list.covers.to, 'the span Glaze read');
  assert.deepEqual((await tool('announcements_list').run({ course: '26' }, ctxFor(ACC, tabs, store))).items, []);
  assert.match((await tool('announcements_list').run({}, ctxFor(ACC, tabs, {}))).missing, /^Open the Dashboard/);
  const one = await tool('announcement_read').run({ course: '25', id: '70' }, ctxFor(ACC, tabs, store));
  assert.deepEqual(one, { account: ACC, title: 'Lab moved to Room 204', author: 'Dr. Rivera', at: Date.parse('2026-10-14T15:00:00Z'), text: 'This week we meet in Room 204.\nBring goggles.', page: 1, pages: 1, files: ['map.pdf'] });
  assert.ok(t.page.asked.every((r) => r.method === 'GET'), 'no read mark: the pop-up\'s PUT is never sent');
  assert.deepEqual(await tool('announcement_read').run({ course: '25', id: '70', page: 2 }, ctxFor(ACC, tabs, store)), { ok: false, error: 'There are 1 pages.' });
  assert.deepEqual(await tool('announcement_read').run({ course: '25', id: '99' }, ctxFor(ACC, tabs, store)), { ok: false, error: 'The site has no such item, or it is not open to the student.' });
});

test('Ultra: a course\'s announcements as Ultra search lists them (what the student may see now), one read with its date; a course is needed', async () => {
  const tabs = tabsOf([ultraTab()]);
  assert.deepEqual(await tool('announcements_list').run({}, ctxFor(UL, tabs)), { ok: false, error: 'On Blackboard, name the course: courses_list gives its id.' });
  const list = await tool('announcements_list').run({ course: '_101_1' }, ctxFor(UL, tabs));
  assert.deepEqual(list.items, [{ id: '_801_1', title: 'Lab moved' }], 'not yet open and expired ones left out');
  const one = await tool('announcement_read').run({ course: '_101_1', id: '_801_1' }, ctxFor(UL, tabs));
  assert.deepEqual([one.title, one.at, one.text], ['Lab moved', Date.parse('2026-10-13T12:00:00Z'), 'Meet in the laboratory.']);
});

test('content: Canvas\'s module items (no headers, unpublished or locked ones); Ultra\'s visible content, a document read paged; Canvas pages not yet', async () => {
  const canvas = tabsOf([canvasTab()]), ultra = tabsOf([ultraTab()]);
  const c = await tool('content_list').run({ course: '25' }, ctxFor(ACC, canvas));
  assert.deepEqual(c.items, [{ id: '11', title: 'Welcome', kind: 'Page', module: 'Week 1' }, { id: '13', title: 'Syllabus.pdf', kind: 'File', module: 'Week 1' },
    { id: '31', title: 'Lab report 3', kind: 'Assignment', module: 'Week 3' }, { id: '32', title: 'Simulator', kind: 'Link', module: 'Week 3' }]);
  assert.match((await tool('content_read').run({ course: '25', id: '11' }, ctxFor(ACC, canvas))).error, /can't read Canvas pages/);
  const u = await tool('content_list').run({ course: '_101_1' }, ctxFor(UL, ultra));
  assert.ok(u.items.some((i) => i.id === '_701_1' && i.title === 'Reading: Cell membrane' && i.kind === 'Document'), JSON.stringify(u.items));
  const doc = await tool('content_read').run({ course: '_101_1', id: '_701_1' }, ctxFor(UL, ultra));
  assert.equal(doc.title, 'Reading: Cell membrane');
  assert.match(doc.text, /mitochondria/);
  assert.doesNotMatch(doc.text, /forbiddenword/, 'scripts are no text');
  assert.equal(doc.pages, 1);
  const folder = u.items.find((i) => i.kind === 'Folder');
  assert.match((await tool('content_read').run({ course: '_101_1', id: folder.id }, ctxFor(UL, ultra))).error, /holds no text/);
});

test('discussions: Canvas\'s topics and one prompt; Ultra\'s published, available ones and a prompt', async () => {
  const canvas = tabsOf([canvasTab()]), ultra = tabsOf([ultraTab()]);
  assert.deepEqual((await tool('discussions_list').run({ course: '25' }, ctxFor(ACC, canvas))).items, [{ id: '81', title: 'Cell questions' }, { id: '82', title: 'Week 2 reflections' }]);
  assert.equal((await tool('discussion_read').run({ course: '25', id: '81' }, ctxFor(ACC, canvas))).text, 'Share one question about cells.');
  assert.deepEqual((await tool('discussions_list').run({ course: '_101_1' }, ctxFor(UL, ultra))).items, [{ id: '_901_1', title: 'Cell questions' }]);
  assert.equal((await tool('discussion_read').run({ course: '_101_1', id: '_901_1' }, ctxFor(UL, ultra))).text, 'Share laboratory safety questions.');
});

test('partial school lists preserve the source coverage instead of reporting an empty complete course', async () => {
  const t = canvasTab({ routes: { '/api/v1/courses/25/modules': [{ id: 1, name: 'Large module', items_count: 50 }] } });
  const content = await tool('content_list').run({ course: '25' }, ctxFor(ACC, tabsOf([t])));
  assert.equal(content.complete, false, 'Canvas may omit inline items from large modules');
  assert.deepEqual(content.items, []);
  assert.ok(t.page.asked.every((r) => r.method === 'GET' && !r.url.includes('/modules/1/items')), 'no additional endpoint');
  const cache = await C.canvasPlan('5', []);
  cache.complete = false;
  const announcements = await tool('announcements_list').run({}, ctxFor(ACC, null, { todoCache: cache }));
  assert.equal(announcements.covers.complete, false, 'an incomplete planner cannot prove there are no announcements');
});

test('school text reads disclose body truncation and reject pages past the retained text', async () => {
  const body = 'a'.repeat(SC.LIMIT.text + 100);
  const t = canvasTab({ routes: { '/api/v1/courses/25/discussion_topics/70': { ...TOPIC, message: `<p>${body}</p>` } } });
  const ctx = ctxFor(ACC, tabsOf([t]));
  const r = await tool('announcement_read').run({ course: '25', id: '70' }, ctx);
  assert.equal(r.truncated, true);
  assert.equal(JSON.parse(A.readable(r, 'UTC')).truncated, true);
  assert.equal(r.pages, Math.ceil(SC.LIMIT.text / SC.PAGE));
  assert.equal((await tool('announcement_read').run({ course: '25', id: '70', page: r.pages + 1 }, ctx)).ok, false);
});

test('Ultra content reads disclose the palette reader text cap', async () => {
  const item = { ...ULTRA.contents.find((i) => i.id === '_701_1'), body: 'x'.repeat(25000) };
  const t = ultraTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents': { results: [item] } } });
  const r = await tool('content_read').run({ course: '_101_1', id: '_701_1' }, ctxFor(UL, tabsOf([t])));
  assert.equal(r.truncated, true);
});

test('syllabus: what Glaze kept from an import; nothing kept says how to import; no tab, wrong ids and no account say so', async () => {
  const rec = SY.tidy({ prof: { name: 'Dr. Rivera', email: 'rivera@school.edu', office: 'Science 204' }, hours: [{ label: 'Office hours', days: ['Mon'], start: '13:00', end: '14:00' }],
    dates: [{ title: 'Midterm', day: '2026-10-20', kind: 'exam' }], scale: [['A', 90], ['B', 80]], weights: [{ name: 'Labs', weight: 30 }, { name: 'Exams', weight: 70 }], at: C.NOW });
  const store = { [SY.key(C.CANVAS, '5', '25')]: rec };
  const r = await tool('syllabus_read').run({ course: '25' }, ctxFor(ACC, null, store));
  assert.deepEqual(r.weights, [{ name: 'Labs', weight: 30 }, { name: 'Exams', weight: 70 }]);
  assert.deepEqual(r.scale, [{ letter: 'A', min: 90 }, { letter: 'B', min: 80 }]);
  assert.equal(r.instructor.name, 'Dr. Rivera');
  assert.match((await tool('syllabus_read').run({ course: '26' }, ctxFor(ACC, null, store))).missing, /Syllabus import/);
  const none = { account: ACC, local: C.area({}), tab: async () => null };
  assert.match((await tool('discussions_list').run({ course: '25' }, none)).error, /^Open school\.instructure\.com in this browser/);
  assert.deepEqual(await tool('content_list').run({ course: '_1_1' }, ctxFor(ACC, tabsOf([canvasTab()]))), { ok: false, error: 'That id does not fit this site.' });
  assert.match((await tool('content_list').run({ course: '25' }, { local: C.area({}) })).error, /which school account/);
});

// ---- tool first -----------------------------------------------------------------------------------------------------------
const NOW = Date.UTC(2026, 9, 30, 19, 5);
const step = (name, args, result) => ({ call: { name, arguments: args }, result });
const inputOf = (question, steps = [], more = {}) => A.task.input({ question, tools: [...A.NAMES], steps, now: NOW, zone: 'UTC', ...more });
const answer = (text, quotes = []) => ({ call: null, answer: { text, quotes } });

test('school text pages survive the agent result formatter without losing characters between pages', async () => {
  const body = 'a'.repeat(1400) + 'The lab now meets in Science Hall.' + 'b'.repeat(1800);
  const ctx = { account: ACC, tab: async () => ({ ok: true, title: 'Lab', text: body, files: [], at: null }) };
  const first = await tool('announcement_read').run({ course: '25', id: '70' }, ctx);
  const pages = [];
  for (let page = 1; page <= first.pages; page++) {
    const result = await tool('announcement_read').run({ course: '25', id: '70', page }, ctx);
    pages.push(JSON.parse(A.readable(result, 'UTC')).text);
  }
  assert.equal(pages.join(''), body);
});

test('check, tool first: an answer with no result behind it fails; results that hold facts must be quoted; an empty or failed result is said plainly', () => {
  assert.equal(A.why(answer('You have three announcements.'), inputOf('Any new announcements?', [], { first: true })), 'first');
  assert.equal(A.why(answer('You have three announcements.'), inputOf('Any new announcements?')), '', 'without first, as before (Rime r5)');
  const list = step('announcements_list', { course: '25' }, { account: ACC, items: [{ id: '70', title: 'Lab moved to Room 204', at: NOW - 864e5 }] });
  assert.equal(A.why(answer('The lab moved.'), inputOf('Any new announcements in BIO?', [list], { first: true })), 'ground');
  assert.equal(A.why(answer('Your newest announcement: Lab moved to Room 204.', ['Lab moved to Room 204']), inputOf('Any new announcements in BIO?', [list], { first: true })), '');
  const empty = step('announcements_list', { course: '25' }, { account: ACC, items: [] });
  assert.equal(A.why(answer('BIO has no announcements in what Glaze read.'), inputOf('Any new announcements in BIO?', [empty], { first: true })), '');
  const failed = step('discussions_list', { course: '25' }, { ok: false, error: 'Open school.instructure.com in this browser, signed in, so Glaze can read it.' });
  assert.equal(A.why(answer('Glaze could not read it: open your school site first.'), inputOf('What discussions are open?', [failed], { first: true })), '');
  assert.equal(A.why(answer('There are two discussions, Cell questions and Week 2.', ['Cell questions']), inputOf('What discussions are open?', [failed], { first: true })), 'quote', 'never guessed past a failure');
  assert.equal(A.rich(JSON.stringify({ account: ACC, at: 5, items: [] })), false);
  assert.equal(A.rich(JSON.stringify({ missing: 'Open it.' })), false);
  assert.equal(A.rich(JSON.stringify({ account: ACC, items: [{ id: '1', title: 'Lab' }] })), true);
});

test('tool-first grounding requires a factual quote rather than an account metadata quote', () => {
  const list = step('announcements_list', {}, { account: ACC, items: [{ id: '70', title: 'Lab moved' }] });
  assert.equal(A.why(answer('The lab moved.', [ACC]), inputOf('Any announcements?', [list], { first: true })), 'ground');
});

test('tool-first grounding accepts boolean facts and does not require quotes of timing or an empty course id', () => {
  const bool = step('run_js', { code: '2 > 1' }, { ok: true, value: true, logs: [] });
  assert.equal(A.why(answer('The comparison is true.', ['true']), inputOf('Compare these values', [bool], { first: true })), '');
  assert.equal(A.rich(JSON.stringify({ ok: true, value: true })), true);
  assert.equal(A.rich(JSON.stringify({ items: [{ title: 'A' }] })), true);
  assert.equal(A.rich(JSON.stringify({ ok: true, value: null, logs: [], ms: 25 })), false);
  const empty = step('syllabus_read', { course: '25' }, { account: ACC, course: '25', at: 5, hours: [], meetings: [], dates: [], weights: [], scale: [] });
  assert.equal(A.why(answer('No syllabus facts were retained.'), inputOf('Read the syllabus', [empty], { first: true })), '');
});

test('the help turn: a help block before the question, its round trip, and no answer before something is read', () => {
  const inp = inputOf('Help me start Lab report 3', [], { help: 'science', first: true });
  const text = A.layout(inp).map((p) => p.special ?? p.text).join('');
  assert.match(text, /<\|gz_data\|>help\nscience<\|\/gz_data\|>\n<\|gz_data\|>question\nHelp me start Lab report 3/);
  const req = require('../../extension/ai/request.js').clean({ ...A.task.build(inp, { text: require('../../extension/ai/text.js') }), schema: A.OUTPUT, task: { id: 'agent.tools', version: 1 } });
  assert.deepEqual(A.fromRequest(req).parts, A.layout(inp));
  assert.equal(A.why(answer('Read it.'), inp), 'first');
  assert.equal(A.task.input({ question: 'x', tools: ['todo_list'], now: NOW, zone: 'UTC', help: 'cooking' }), null);
  assert.equal(A.task.input({ question: 'x', tools: ['todo_list'], now: NOW, zone: 'UTC', first: 'yes' }), null);
  // Without first or help, the request is byte for byte as before.
  const plain = inputOf('What is due?');
  assert.ok(!('first' in plain) && !('help' in plain));
});

test('study help refuses to solve a problem supplied only by the school reader', () => {
  const help = require('../../extension/ai/tasks/study-help.js');
  const inp = help.task.input({ question: 'Help me solve the problem in my assignment', subject: 'math',
    material: JSON.stringify({ instructions: 'Solve 3x + 5 = 20.' }) });
  assert.equal(help.why({ kind: 'hint', step: null, reply: 'Subtract 5 and divide by 3: x = 5.', followUp: null }, inp), 'solves');
  assert.equal(help.why({ kind: 'hint', step: null, reply: 'What operation would isolate the term with your variable?', followUp: null }, inp), '');
});

// ---- routing -----------------------------------------------------------------------------------------------------------
const OLD = (() => {
  const file = path.join(ROOT, 'extension/ai/ask-ec74ace13.js'), m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(execFileSync('git', ['show', 'ec74ace13:extension/ai/ask.js'], { cwd: ROOT, encoding: 'utf8' }), file);
  return m.exports;
})();
test('route at level 3: announcements, content, the syllabus and discussions read with their tools, in six languages; level 1 as before', () => {
  const by = {
    announcements: ['announcements_list', { en: 'Any new announcements in BIO 1100?', es: '¿Hay anuncios nuevos?', 'pt-BR': 'Tem avisos novos?', fr: 'Y a-t-il de nouvelles annonces ?', de: 'Gibt es neue Ankündigungen?', nl: 'Zijn er nieuwe aankondigingen?' }],
    content: ['content_list', { en: 'What is in the Week 3 module?', es: '¿Qué hay en el módulo 3?', 'pt-BR': 'O que tem no módulo 3?', fr: 'Que contient le module 3 ?', de: 'Was steht in den Folien?', nl: 'Wat staat er in module 3?' }],
    syllabus: ['syllabus_read', { en: 'What are the grade weights in BIO?', es: '¿Cuál es el horario de atención?', 'pt-BR': 'Qual é o plano de ensino?', fr: 'Quel est le plan de cours ?', de: 'Wann sind die Sprechstunden?', nl: 'Wat zegt de syllabus?' }],
    discussions: ['discussions_list', { en: 'Which discussions are open?', es: '¿Qué foros hay?', 'pt-BR': 'Quais fóruns estão abertos?', fr: 'Quels forums sont ouverts ?', de: 'Welche Diskussionen gibt es?', nl: 'Welke discussies zijn er?' }],
  };
  for (const [topic, [want, qs]] of Object.entries(by)) for (const [locale, q] of Object.entries(qs)) {
    const r = K.route(q, { locale, level: 3 });
    assert.equal(r.task, 'agent.tools', `${topic} ${locale}: ${q}`);
    assert.ok(r.tools.includes(want) && r.tools.length <= 6, `${topic} ${locale}: ${JSON.stringify(r.tools)}`);
    assert.deepEqual(K.route(q, { locale }), OLD.route(q, { locale }), `${locale}: ${q} at level 1`);
  }
  // Help naming the student's work reads it first; help naming nothing is study help alone.
  assert.deepEqual(K.route('Help me start Lab report 3', { level: 3 }), { task: 'study.help', subject: 'other', read: ['assignments_list', 'assignment_read', 'courses_list', 'accounts_list'] });
  assert.deepEqual(K.route('Explain mitosis', { level: 3 }), { task: 'study.help', subject: 'science' });
  assert.deepEqual(K.route('Help me start Lab report 3'), OLD.route('Help me start Lab report 3'));
});

test('ordinary study terms do not trigger school record reads', () => {
  for (const q of ['What is a Python module?', 'Explain Python modules', 'Explain reading comprehension',
    'What are atomic weights?', 'What is a discussion forum?', 'Explain essay structure', 'Help me write an essay', 'Explain project management', 'What is the news?']) {
    const r = K.route(q, { level: 3 });
    assert.equal(r.task, 'study.help', q);
    assert.equal(r.read, undefined, `${q}: no school records named`);
    assert.deepEqual(K.route(q), OLD.route(q), `${q}: level 1 unchanged`);
  }
  for (const q of ['Help me start my essay', 'Help me start Lab report 3', 'Help with the assignment', 'Explain the syllabus']) {
    assert.ok(K.route(q, { level: 3 }).read?.length, q);
  }
});

// ---- the help flow on the port ------------------------------------------------------------------------------------------
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 120) => { for (let i = 0; i < n; i++) await tick(); };
test('port: help with a named piece of work reads it with the tools, then study.help helps with what was read; its reader\'s words never show', async () => {
  const [page, worker] = (() => {
    const side = () => ({ on: [], gone: [] });
    const a = side(), b = side();
    const end = (me, other) => ({ postMessage: (m) => { const c = structuredClone(m); setTimeout(() => other.on.forEach((f) => f(c)), 0); }, onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) }, disconnect() {} });
    return [end(a, b), end(b, a)];
  })();
  const runs = [];
  const script = { 'agent.tools': [{ call: { name: 'assignments_list', arguments: {} }, answer: null }, { call: null, answer: { text: 'Read Lab report 3.', quotes: ['Lab report 3'] } }],
    'study.help': [{ kind: 'hint', step: null, reply: 'Start with the hypothesis the instructions ask for.', followUp: null }] };
  const broker = (port) => port.onMessage.addListener((m) => {
    if (m.op !== 'run') return;
    runs.push(m);
    const next = script[m.task].shift();
    port.postMessage(next ? { id: m.id, type: 'end', output: next } : { id: m.id, type: 'error', error: 'check' });
  });
  const reg = TL.registry();
  reg.add({ name: 'assignments_list', kind: 'read', group: 'assignments', scope: 'account', title: 'Assignments', description: 'Assignments', parameters: A.SPECS.find((s) => s.name === 'assignments_list').parameters,
    run: async () => ({ account: ACC, at: 5, items: [{ assignment: '171', type: 'assignment', courseId: '25', course: 'BIO 1100', title: 'Lab report 3', due: NOW + 864e5 }] }) });
  K.connect(worker, { allowed: async () => true, broker, settings: async () => ({ on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: (n) => reg.get(n), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}), refresh: async () => null, local: {}, keys: async () => [],
    turn: (f) => f(), zone: 'UTC', now: () => NOW, accounts: async () => [{ account: ACC, origin: C.CANVAS }], approve: { ask: async () => 'no' }, level: async () => 3, page: () => ({ url: `${C.CANVAS}/` }),
    own: { read: async () => null, writer: async () => true, wakes: { local: C.area({}), alarms: null, read: async () => null, on: async () => true, now: () => NOW } } });
  const got = [];
  page.onMessage.addListener((m) => got.push(m));
  page.postMessage({ id: 1, op: 'ask', question: 'Help me start Lab report 3', locale: 'en' });
  await settle();
  assert.deepEqual(runs.map((r) => r.task), ['agent.tools', 'agent.tools', 'study.help']);
  assert.deepEqual([runs[0].input.help, runs[0].input.first], ['other', true]);
  assert.match(runs[2].input.material, /Lab report 3/);
  assert.deepEqual(got.filter((m) => m.type === 'end').map((m) => [m.task, m.output?.reply]), [['study.help', 'Start with the hypothesis the instructions ask for.']]);
});
