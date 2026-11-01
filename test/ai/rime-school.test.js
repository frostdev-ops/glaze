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
  assert.deepEqual(list.items, [{ id: '_801_1', title: 'Lab moved', at: null }], 'not yet open and expired ones left out');
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

test('discussions: Canvas topics are listed but prompt reads fail closed without verified instructor authorship', async () => {
  const canvas = tabsOf([canvasTab()]);
  assert.deepEqual((await tool('discussions_list').run({ course: '25' }, ctxFor(ACC, canvas))).items, [{ id: '81', title: 'Cell questions' }, { id: '82', title: 'Week 2 reflections' }]);
  const r = await tool('discussion_read').run({ course: '25', id: '81' }, ctxFor(ACC, canvas));
  assert.equal(r.ok, false);
  assert.match(r.error, /authorship/);
});

test('a Canvas peer-authored discussion cannot send the peer name or prompt to the worker', async () => {
  const tab = canvasTab({ routes: { '/api/v1/courses/25/discussion_topics/81': {
    ...TOPIC, id: 81, author: { display_name: 'Classmate One' }, message: '<p>CLASSMATE-PRIVATE-WORDS</p>',
  } } });
  const r = await tool('discussion_read').run({ course: '25', id: '81' }, ctxFor(ACC, tabsOf([tab])));
  assert.equal(r.ok, false);
  assert.doesNotMatch(JSON.stringify(r), /Classmate|CLASSMATE-PRIVATE-WORDS/);
  assert.ok(!tab.page.asked.some((q) => new URL(q.url).pathname.endsWith('/discussion_topics/81')), 'unverified text stays at the school');
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

test('Ultra non-page content discloses the HTML cap even when its retained text is short', async () => {
  const item = { ...ULTRA.contents.find((i) => i.id === '_701_1'), body: '<br>'.repeat(25000) + '<p>Instructions after the HTML cap.</p>' };
  const tab = ultraTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents': { results: [item] } } });
  const r = await tool('content_read').run({ course: '_101_1', id: '_701_1' }, ctxFor(UL, tabsOf([tab])));
  assert.equal(r.ok, false);
  assert.match(r.error, /only part/);
});

test('an incomplete Ultra search does not prove a requested item is absent', async () => {
  const page = { results: ULTRA.contents.slice(0, 1), paging: { nextPage: '/learn/api/public/v1/courses/_101_1/elsewhere?offset=200' } };
  const t = ultraTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents': page } });
  const r = await tool('content_read').run({ course: '_101_1', id: '_999_1' }, ctxFor(UL, tabsOf([t])));
  assert.equal(r.ok, false);
  assert.match(r.error, /only part/i);
  assert.doesNotMatch(r.error, /^No such/);
});

test('syllabus date limits disclose the omitted dates', async () => {
  const key = SY.key(C.CANVAS, '5', '25');
  const rec = SY.tidy({ dates: Array.from({ length: 50 }, (_, i) => ({ title: `Reading ${i + 1}`, day: '2026-11-01', kind: 'other' })) });
  const r = await tool('syllabus_read').run({ course: '25' }, ctxFor(ACC, null, { [key]: rec }));
  assert.equal(r.dates.length, SC.LIMIT.items);
  assert.deepEqual(r.more, { dates: 10 });
});

test('school tab operations discard data when the signed-in account changes during the read', async (t) => {
  for (const op of ['announcement', 'modules', 'topics', 'search']) await t.test(op, async () => {
    const ultra = op === 'search', tab = ultra ? ultraTab() : canvasTab();
    let uid = ultra ? C.ULTRA_UID : '5';
    const fetch = tab.context.fetch;
    tab.context.fetch = async (url, init) => {
      if (new URL(url).pathname === (ultra ? '/learn/api/v1/users/me' : '/api/v1/users/self/profile')) return H.json({ id: uid });
      const r = await fetch(url, init);
      uid = ultra ? '_999_1' : '6';
      return r;
    };
    const r = await tabsOf([tab]).run(ultra ? UL : ACC, op, { course: ultra ? '_101_1' : '25', id: '70', kind: 'contents' });
    assert.deepEqual(r, { ok: false, error: 'profile' });
  });
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

test('school pages fit the serialized result budget even for heavily escaped text', () => {
  const body = '\u0000'.repeat(1700) + 'Final lab instructions.';
  const first = SC.paged(body), held = [];
  for (let page = 1; page <= first.pages; page++) {
    const shown = A.readable({ account: ACC, title: 'Lab', ...SC.paged(body, page) }, 'UTC');
    assert.ok(shown, `page ${page} fits the model result budget`);
    held.push(JSON.parse(shown).text);
  }
  assert.equal(held.join(''), body);
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

test('tool-first grounding requires the factual quote in the visible answer, not only its hidden quotes list', () => {
  const list = step('discussions_list', { course: '25' }, { items: [{ id: '81', title: 'Thesis workshop' }] });
  assert.equal(A.why(answer('There are no open discussions.', ['Thesis workshop']), inputOf('Which discussions are open?', [list], { first: true })), 'ground');
  assert.equal(A.why(answer('An open discussion: Thesis workshop.', ['Thesis workshop']), inputOf('Which discussions are open?', [list], { first: true })), '');
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
    'What are atomic weights?', 'What is a discussion forum?', 'Explain essay structure', 'Help me write an essay',
    'Help me write an essay about the French Revolution', 'Explain project management', 'What is the news?']) {
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

// ---- the training-spec review's findings (glaze-plans/lfm-tune/FORMAT-tools-v3.md, round 4) -------------------------------
test('pt-BR names a single forum too; run_js after reading an announcement, a content page or a discussion is graded work\'s rule too', () => {
  const r = K.route('O que diz o fórum de BIO?', { locale: 'pt-BR', level: 3 });
  assert.ok(r.task === 'agent.tools' && r.tools.includes('discussions_list'), JSON.stringify(r));
  for (const name of ['announcement_read', 'content_read', 'discussion_read']) {
    const read = step(name, { course: '25', id: '70' }, { account: ACC, title: 'Problem set 4', text: 'Compute 17 * 23 and show your work.', page: 1, pages: 1 });
    assert.equal(A.why({ call: { name: 'run_js', arguments: { code: '17 * 23' } }, answer: null }, inputOf('What does it ask?', [read])), 'work', name);
  }
});

test('announcements_list promises a date on both sites; discussion_read promises classmates\' words never leave', () => {
  assert.match(A.SPECS.find((s) => s.name === 'announcements_list').description, /id, title and at \(when posted\)/);
  assert.match(A.SPECS.find((s) => s.name === 'discussion_read').description, /student's own replies and how many classmates replied, never their names or words/);
  assert.ok(A.SPECS.find((s) => s.name === 'syllabus_read').parameters.properties.page);
});

test('port: a help turn that fails its check still lets study help answer, without what it would have read', async () => {
  const [page, worker] = (() => {
    const side = () => ({ on: [], gone: [] });
    const a = side(), b = side();
    const end = (me, other) => ({ postMessage: (m) => { const c = structuredClone(m); setTimeout(() => other.on.forEach((f) => f(c)), 0); }, onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) }, disconnect() {} });
    return [end(a, b), end(b, a)];
  })();
  const runs = [];
  const broker = (port) => port.onMessage.addListener((m) => {
    if (m.op !== 'run') return;
    runs.push(m);
    port.postMessage(m.task === 'agent.tools' ? { id: m.id, type: 'error', error: 'check' } : { id: m.id, type: 'end', output: { kind: 'hint', step: null, reply: 'Start with what the lab asks you to measure.', followUp: null } });
  });
  K.connect(worker, { allowed: async () => true, broker, settings: async () => ({ on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
    registry: { get: () => null, describe: () => ({}) }, state: async () => ({}), refresh: async () => null, local: {}, keys: async () => [], turn: (f) => f(), zone: 'UTC', now: () => NOW,
    accounts: async () => [{ account: ACC, origin: C.CANVAS }], approve: { ask: async () => 'no' }, level: async () => 3, page: () => ({ url: `${C.CANVAS}/` }),
    own: { read: async () => null, writer: async () => true, wakes: { local: C.area({}), alarms: null, read: async () => null, on: async () => true, now: () => NOW } } });
  const got = [];
  page.onMessage.addListener((m) => got.push(m));
  page.postMessage({ id: 1, op: 'ask', question: 'Help me start Lab report 3', locale: 'en' });
  await settle();
  assert.deepEqual(runs.map((r) => r.task), ['agent.tools', 'study.help']);
  assert.equal(runs[1].input.material, undefined);
  assert.deepEqual(got.filter((m) => ['end', 'error'].includes(m.type)).map((m) => [m.type, m.output?.reply]), [['end', 'Start with what the lab asks you to measure.']]);
});

test('"where is" opens a place only for the student\'s own things; a general question stays study help', () => {
  for (const q of ['Where is the Golgi apparatus?', 'Where are mitochondria found?']) assert.equal(K.route(q, { level: 3 }).task, 'study.help', q);
  for (const q of ['Where are my grades?', 'Where is my BIO 1100 syllabus?', 'Where can I find the assignments?']) {
    const r = K.route(q, { level: 3 });
    assert.ok(r.task === 'agent.tools' && r.tools.includes('places_list'), `${q}: ${JSON.stringify(r)}`);
  }
});

// ---- the answer filter (ai/tasks/study-help.js hands, wording) --------------------------------------------------------------
test('a faithful summary quoting a record\'s title after a colon passes in all six languages; wording offered for the student\'s work still fails', () => {
  const SH = require('../../extension/ai/tasks/study-help.js');
  const material = JSON.stringify({ items: [{ id: '81', title: 'Week 9: Cell transport' }, { id: '82', title: 'Week 10: Mitosis' }] });
  const ok = {
    en: 'BIO 101 has two forums: “Week 9: Cell transport” and “Week 10: Mitosis”.',
    'pt-BR': 'Os fóruns de BIO 101: “Week 9: Cell transport” e “Week 10: Mitosis”.',
    es: 'Los foros de BIO 101: «Week 9: Cell transport» y «Week 10: Mitosis».',
    fr: 'Les forums de BIO 101 : « Week 9: Cell transport » et « Week 10: Mitosis ».',
    de: 'Die Foren von BIO 101: „Week 9: Cell transport“ und „Week 10: Mitosis“.',
    nl: 'De forums van BIO 101: ‘Week 9: Cell transport’ en ‘Week 10: Mitosis’.',
  };
  const offered = {
    en: 'For your reflection, try this opening: “Cells move nutrients across membranes in three ways.”',
    'pt-BR': 'Para sua reflexão, escreva: “As células transportam nutrientes de três formas.”',
    es: 'Para tu reflexión, escribe: «Las células transportan nutrientes de tres formas.»',
    fr: 'Pour ta réflexion, écris : « Les cellules transportent les nutriments de trois façons. »',
    de: 'Für deine Reflexion schreib: „Zellen transportieren Nährstoffe auf drei Arten.“',
    nl: 'Voor je reflectie, schrijf: ‘Cellen vervoeren voedingsstoffen op drie manieren.’',
  };
  for (const [locale, text] of Object.entries(ok)) {
    const inp = SH.task.input({ question: 'Which forums are open in BIO 101?', subject: 'math', locale, material });
    assert.equal(SH.hands(text, inp), '', `${locale}: ${text}`);
  }
  for (const [locale, text] of Object.entries(offered)) {
    const inp = SH.task.input({ question: 'Help me write my Week 9 reflection', subject: 'essay', locale, material });
    assert.equal(SH.hands(text, inp), 'wording', `${locale}: ${text}`);
  }
});

test('a copied citation cannot hide an explicit offer of wording for the student', () => {
  const SH = require('../../extension/ai/tasks/study-help.js');
  const material = 'Cells move nutrients across membranes.';
  for (const [locale, prefix] of [['en', 'For your reflection, write'], ['en', 'Try this opening:'],
    ['es', 'Para tu reflexión, escribe:'], ['pt-BR', 'Para sua reflexão, escreva:'],
    ['fr', 'Pour ta réflexion, écris :'], ['de', 'Für deine Reflexion schreib:'], ['nl', 'Voor je reflectie, schrijf:']]) {
    const inp = SH.task.input({ question: 'Help me write my reflection', subject: 'essay', locale, material });
    assert.equal(SH.hands(`${prefix} “${material}”`, inp), 'wording', `${locale}: ${prefix}`);
  }
});

test('multiword writing suggestions before copied citations remain offers in all six languages', () => {
  const SH = require('../../extension/ai/tasks/study-help.js'), material = 'Cells move nutrients across membranes.';
  for (const [locale, lead] of [['en', 'Use this opening:'], ['es', 'Usa esta apertura:'], ['pt-BR', 'Use esta abertura:'],
    ['fr', 'Utilise cette introduction :'], ['de', 'Verwende diesen Einstieg:'], ['nl', 'Gebruik deze opening:']]) {
    const inp = SH.task.input({ question: 'Help me write my reflection', subject: 'essay', locale, material });
    assert.equal(SH.hands(`${lead} “${material}”`, inp), 'wording', locale);
  }
});

// ---- direct requests: the question forms the router accepts pass the check too (the D4 agent's finding) ----------------------
test('a wake, a watch and a cancel are asked for in each language\'s common question and imperative forms; mentions still ask for nothing', () => {
  const later = new Date(NOW + 3 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const wake = { call: { name: 'wake_create', arguments: { at: later, say: 'Lab' } }, answer: null };
  const watch = { call: { name: 'monitor_create', arguments: { watch: 'announcement' } }, answer: null };
  const listed = step('wakes_list', {}, { items: [{ id: 'w-abcd1234', what: 'wake', at: NOW + 3600e3, say: 'Lab' }] });
  const cancel = { call: { name: 'wake_cancel', arguments: { id: 'w-abcd1234' } }, answer: null };
  const asks = {
    en: [['Remind me tonight about the lab', 'Can you remind me tonight about the lab?'], ['Watch for new announcements', 'Could you let me know when there is a new announcement?'], ['Cancel my lab reminder', 'Can you cancel my lab reminder?']],
    'pt-BR': [['Me lembra de terminar o laboratório hoje à noite', 'Você pode me lembrar de terminar o laboratório?'], ['Me avisa quando sair um aviso novo', 'Pode monitorar os avisos novos?'], ['Cancela meu lembrete do laboratório', 'Pode cancelar meu lembrete?']],
    es: [['Recuérdame terminar el laboratorio esta noche', '¿Puedes recordarme terminar el laboratorio?'], ['Avísame cuando haya un anuncio nuevo', '¿Puedes vigilar los anuncios nuevos?'], ['Cancela mi recordatorio del laboratorio', '¿Puedes cancelar mi recordatorio?']],
    fr: [['Rappelle-moi de finir le labo ce soir', 'Tu peux me rappeler de finir le labo ce soir ?'], ['Préviens-moi quand il y a une nouvelle annonce', 'Tu peux surveiller les nouvelles annonces ?'], ['Annule mon rappel du labo', 'Tu peux annuler mon rappel du labo ?']],
    de: [['Erinnere mich heute Abend an das Labor', 'Kannst du mich heute Abend an das Labor erinnern?'], ['Benachrichtige mich bei neuen Ankündigungen', 'Kannst du die Ankündigungen überwachen?'], ['Lösch meine Erinnerung für das Labor', 'Kannst du meine Erinnerung für das Labor löschen?']],
    nl: [['Herinner me vanavond aan het lab', 'Kun je me eraan herinneren dat ik het lab vanavond afmaak?'], ['Laat me weten als er een nieuwe aankondiging is', 'Kun je de aankondigingen in de gaten houden?'], ['Annuleer mijn herinnering voor het lab', 'Kun je mijn herinnering voor het lab annuleren?']],
  };
  for (const [locale, [w, m, c]] of Object.entries(asks)) {
    for (const q of w) assert.equal(A.why(wake, A.task.input({ question: q, tools: [...A.NAMES], steps: [], now: NOW, zone: 'UTC', locale })), '', `${locale} wake: ${q}`);
    for (const q of m) assert.equal(A.why(watch, A.task.input({ question: q, tools: [...A.NAMES], steps: [], now: NOW, zone: 'UTC', locale })), '', `${locale} watch: ${q}`);
    for (const q of c) assert.equal(A.why(cancel, A.task.input({ question: q, tools: [...A.NAMES], steps: [listed], now: NOW, zone: 'UTC', locale })), '', `${locale} cancel: ${q}`);
    // The router sends each one to the tool the check then lets through.
    const routed = (q, tool) => assert.ok((require('../../extension/ai/ask.js').route(q, { locale, level: 3 }).tools || []).includes(tool), `${locale} routes ${q} to ${tool}`);
    for (const q of w) routed(q, 'wake_create');
    for (const q of m) routed(q, 'monitor_create');
    for (const q of c) routed(q, 'wake_cancel');
  }
  // Nobody asked: a mention, a question about one, or a negation.
  for (const [locale, q] of [['en', 'What is due tonight?'], ['en', 'Did you remind me yesterday?'], ['en', "Don't remind me about the lab"], ['pt-BR', 'O lembrete de ontem funcionou?'],
    ['fr', 'Ne me rappelle pas le labo'], ['de', 'Erinnerst du dich an das Labor?'], ['nl', 'Herinner je je het lab nog?'], ['nl', 'Kun je je het lab nog herinneren?'], ['de', 'Kannst du dich an das Labor erinnern?'], ['de', 'Kannst du mich nicht erinnern?'], ['pt-BR', 'Você lembra do laboratório?'], ['fr', 'Tu te rappelles le labo ?'],
    ['es', '¿Qué tengo que entregar hoy?']]) {
    assert.equal(A.why(wake, A.task.input({ question: q, tools: [...A.NAMES], steps: [], now: NOW, zone: 'UTC', locale })), 'asked', `${locale}: ${q}`);
  }
});

test('recall questions and quoted commands do not authorize reminders', () => {
  const wake = { call: { name: 'wake_create', arguments: { at: '2026-10-30 22:05', say: 'Lab' } }, answer: null };
  for (const q of ['Kannst du erklären wie Menschen erinnern?', 'Kun je uitleggen hoe mensen dingen herinneren?',
    'Kun je me uitleggen hoe mensen dingen herinneren?', 'Tu peux rappeler ce que dit le syllabus ?',
    '¿Puedes recordar lo que dice el programa?', 'Você pode lembrar o que diz o programa?', '“Remind me tonight about the lab”']) {
    assert.equal(A.why(wake, inputOf(q)), 'asked', q);
  }
});

// ---- Ultra, in the shapes probed on a real Ultra (2026-11-01; fixtures/ultra-rime-reads.json, synthetic values) ----------
const PROBED = C.load('ultra-rime-reads.json');
const probedTab = (o = {}) => ultraTab({ routes: {
  '/learn/api/public/v1/courses/_101_1/announcements': PROBED.announcements, '/learn/api/public/v1/courses/_101_1/contents': PROBED.contents,
  '/learn/api/public/v1/courses/_101_1/contents/_721_1/children': PROBED.children._721_1, '/learn/api/public/v1/courses/_101_1/contents/_723_1/children': PROBED.children._723_1,
  '/learn/api/public/v1/courses/_101_1/discussions': PROBED.discussions, '/learn/api/public/v1/courses/_101_1/discussions/_911_1': PROBED.discussion,
  '/learn/api/public/v1/courses/_101_1/discussions/_911_1/messages': PROBED.messages, ...o.routes } });

test('direct Ultra announcement reads enforce the same release and draft rules as the list', async (t) => {
  const original = PROBED.announcements.results[0];
  for (const [label, patch] of [
    ['draft', { draft: true }],
    ['future', { availability: { duration: { type: 'DateRange', start: '2099-01-01T00:00:00Z', end: null } } }],
    ['expired', { availability: { duration: { type: 'DateRange', start: null, end: '2000-01-01T00:00:00Z' } } }],
  ]) await t.test(label, async () => {
    const tab = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/announcements/_811_1': { ...original, ...patch } } });
    const r = await tool('announcement_read').run({ course: '_101_1', id: '_811_1' }, ctxFor(UL, tabsOf([tab])));
    assert.equal(r.ok, false);
    assert.doesNotMatch(JSON.stringify(r), /Review is Thursday/);
    assert.ok(tab.page.asked.every((q) => q.method === 'GET' && new URL(q.url).origin === C.ULTRA && q.redirect === 'error'));
  });
});

test('Ultra announcements: in Ultra\'s order, each dated by when the student could first see it (start, else modified, else created); no drafts', async () => {
  const r = await tool('announcements_list').run({ course: '_101_1' }, ctxFor(UL, tabsOf([probedTab()])));
  assert.deepEqual(r.items, [
    { id: '_811_1', title: 'Midterm review session', at: Date.parse('2026-10-20T13:00:00.000Z') },
    { id: '_812_1', title: 'Office hours moved', at: Date.parse('2026-10-14T09:30:00.000Z') },
    { id: '_813_1', title: 'Welcome', at: Date.parse('2026-09-01T12:00:00.000Z') }]);
  const one = await tool('announcement_read').run({ course: '_101_1', id: '_812_1' }, ctxFor(UL, tabsOf([probedTab({ routes: {
    '/learn/api/public/v1/courses/_101_1/announcements/_812_1': PROBED.announcements.results[1] } })])));
  assert.equal(one.at, Date.parse('2026-10-14T09:30:00.000Z'), 'a reposted or undated one falls back to modified');
});

test('Ultra content: an Ultra document reads its body block with the names of the files it embeds, never their signed addresses', async () => {
  const tabs = tabsOf([probedTab()]);
  const list = await tool('content_list').run({ course: '_101_1' }, ctxFor(UL, tabs));
  assert.deepEqual(list.items.map((i) => [i.id, i.kind]), [['_720_1', 'Folder'], ['_721_1', 'Document'], ['_722_1', 'Module'], ['_723_1', 'Document'], ['_724_1', 'Link'], ['_725_1', 'Test']], 'a course link has no place of its own (contentLink)');
  const doc = await tool('content_read').run({ course: '_101_1', id: '_723_1' }, ctxFor(UL, tabs));
  assert.match(doc.text, /900 words on a place that matters/);
  assert.deepEqual(doc.files, [{ name: 'Essay rubric.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 48211 }]);
  assert.doesNotMatch(JSON.stringify(doc), /SIGNED|bbcswebdav|sessions/);
});

test('Ultra document body blocks use visibleIn, including adaptive release and unknown availability', async (t) => {
  const block = PROBED.children._723_1.results[0];
  for (const [label, availability] of [
    ['future', { available: 'Yes', adaptiveRelease: { start: '2099-01-01T00:00:00Z' } }],
    ['expired', { available: 'Yes', adaptiveRelease: { end: '2000-01-01T00:00:00Z' } }],
    ['unknown', { available: 'Yes' }],
  ]) await t.test(label, async () => {
    const tab = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents/_723_1/children': { results: [{ ...block, availability }] } } });
    const r = await tool('content_read').run({ course: '_101_1', id: '_723_1' }, ctxFor(UL, tabsOf([tab])));
    assert.equal(r.ok, false);
    assert.doesNotMatch(JSON.stringify(r), /900 words|Essay rubric/);
  });
});

test('signed file addresses never leave school reads even as visible text or embedded metadata', async () => {
  const signed = `${C.ULTRA}/bbcswebdav/xid-456_1?sig=SIGNED-SECRET`, session = '/sessions/7/a1b2c3/file.pdf?sig=SIGNED-SECRET';
  const tab = probedTab({ routes: {
    '/learn/api/public/v1/courses/_101_1/contents/_723_1/children': { results: [{ ...PROBED.children._723_1.results[0],
      body: `<p>Read the rubric: ${signed}</p><a data-bbfile='{&quot;displayName&quot;:&quot;${session}&quot;,&quot;mimeType&quot;:&quot;application/pdf&quot;}'>Rubric</a>` }] },
    '/learn/api/public/v1/courses/_101_1/announcements/_811_1': { ...PROBED.announcements.results[0], body: `<p>${session}</p>` },
    '/learn/api/public/v1/courses/_101_1/discussions/_911_1': { ...PROBED.discussion, topic: { ...PROBED.discussion.topic, body: `<p>${signed}</p>` } },
  } });
  const tabs = tabsOf([tab]);
  for (const [op, id] of [['document', '_723_1'], ['announcement', '_811_1'], ['discussion', '_911_1']]) {
    const r = await tabs.run(UL, op, { course: '_101_1', id });
    assert.equal(r.ok, true, op);
    assert.doesNotMatch(JSON.stringify(r), /bbcswebdav|\/sessions\/|SIGNED-SECRET/, op);
  }
});

test('Ultra unread document pages disclose truncation', async () => {
  const partial = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents/_723_1/children': {
    ...PROBED.children._723_1, paging: { nextPage: '/learn/api/public/v1/courses/_101_1/contents/_723_1/children?offset=200' },
  } } });
  const doc = await tool('content_read').run({ course: '_101_1', id: '_723_1' }, ctxFor(UL, tabsOf([partial])));
  assert.match(doc.text, /900 words/);
  assert.equal(doc.truncated, true, 'the child reader stopped before the rest of the document');
});

test('Ultra discussion text caps disclose truncation', async () => {
  const long = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/discussions/_911_1': {
    ...PROBED.discussion, topic: { ...PROBED.discussion.topic, body: 'x'.repeat(25000) },
  } } });
  const discussion = await tool('discussion_read').run({ course: '_101_1', id: '_911_1' }, ctxFor(UL, tabsOf([long])));
  assert.equal(discussion.truncated, true, 'the prompt text cap is smaller than the HTML cap');
});

test('Ultra syllabus: the course\'s syllabus document wherever it sits, a page at a time; a body that is only a file names the file; imported facts stay', async () => {
  const tabs = tabsOf([probedTab()]);
  const r = await tool('syllabus_read').run({ course: '_101_1' }, ctxFor(UL, tabs));
  assert.equal(r.document.title, 'ENG 1100 College Writing Syllabus');
  assert.match(r.document.text, /full syllabus is attached/);
  assert.deepEqual(r.document.files, [{ name: 'ENG 1100 Syllabus Fall.pdf', type: 'application/pdf' }]);
  assert.doesNotMatch(JSON.stringify(r), /SIGNED|bbcswebdav|sessions/);
  const bare = { results: [{ ...PROBED.children._721_1.results[0], body: PROBED.children._721_1.results[0].body.replace('<p>The full syllabus is attached.</p>', '').replace(/>ENG 1100 Syllabus Fall\.pdf</, '><') }] };
  const only = await tool('syllabus_read').run({ course: '_101_1' }, ctxFor(UL, tabsOf([probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents/_721_1/children': bare } })])));
  assert.deepEqual(only.document.files, [{ name: 'ENG 1100 Syllabus Fall.pdf', type: 'application/pdf' }]);
  assert.match(only.document.note, /attached file/);
  const rec = SY.tidy({ weights: [{ name: 'Essays', weight: 60 }], at: C.NOW });
  const both = await tool('syllabus_read').run({ course: '_101_1' }, ctxFor(UL, tabs, { [SY.key(C.ULTRA, C.ULTRA_UID, '_101_1')]: rec }));
  assert.deepEqual([both.weights, both.document.id], [[{ name: 'Essays', weight: 60 }], '_721_1']);
  const none = await tool('syllabus_read').run({ course: '_101_1' }, ctxFor(UL, tabsOf([probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/contents': { results: PROBED.contents.results.filter((c) => c.id !== '_721_1') } } })])));
  assert.match(none.missing, /no item named as a syllabus/);
});

test('Ultra discussions: the list as Ultra gives it (id and title); one gives its prompt, whether graded, the student\'s own replies and a count of classmates\' replies only', async () => {
  const tabs = tabsOf([probedTab()]);
  assert.deepEqual((await tool('discussions_list').run({ course: '_101_1' }, ctxFor(UL, tabs))).items, [{ id: '_911_1', title: 'Introduce yourself' }, { id: '_912_1', title: 'Thesis workshop' }]);
  const r = await tool('discussion_read').run({ course: '_101_1', id: '_911_1' }, ctxFor(UL, tabs));
  assert.equal(r.text, 'Tell the class your major and one book you liked.');
  assert.equal(r.gradable, true);
  assert.equal(r.at, Date.parse('2026-09-01T12:00:00.000Z'));
  assert.deepEqual(r.mine, [{ at: Date.parse('2026-09-03T12:00:00.000Z'), reply: false, text: 'I study nursing and liked Beloved.' }], 'an answer to the prompt, not a reply to a classmate');
  assert.equal(r.others, 2);
  assert.doesNotMatch(JSON.stringify(r), /CLASSMATE|Classmate|Instructor|Example/, 'no classmate\'s words or anyone\'s name');
});

test('Ultra discussion privacy also covers names and peer blockquotes embedded in the student\'s own reply', async () => {
  const messages = structuredClone(PROBED.messages);
  messages.results[1].body = `<p>Thanks, Classmate One. I am Student Self.</p><blockquote><p>CLASSMATE-PRIVATE-WORDS</p><blockquote>More quoted words.</blockquote><p>CLASSMATE-PRIVATE-WORDS after a nested quote.</p></blockquote><p>I study nursing.</p>`;
  const discussion = { ...PROBED.discussion, topic: { ...PROBED.discussion.topic, body: '<p>Instructor Example asks: describe your major.</p>' } };
  const tab = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/discussions/_911_1': discussion,
    '/learn/api/public/v1/courses/_101_1/discussions/_911_1/messages': messages } });
  const r = await tabsOf([tab]).run(UL, 'discussion', { course: '_101_1', id: '_911_1' });
  assert.equal(r.ok, true);
  assert.match(r.mine[0].text, /I study nursing/);
  assert.doesNotMatch(JSON.stringify(r), /CLASSMATE-PRIVATE-WORDS|More quoted words|Classmate One|Student Self|Instructor Example/);
});

test('Ultra discussions only return and count messages confirmed Published', async () => {
  const messages = structuredClone(PROBED.messages);
  delete messages.results[0].status;
  delete messages.results[1].status;
  const tab = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/discussions/_911_1/messages': messages } });
  const r = await tool('discussion_read').run({ course: '_101_1', id: '_911_1' }, ctxFor(UL, tabsOf([tab])));
  assert.deepEqual(r.mine, []);
  assert.equal(r.others, 1);
});

test('an empty Ultra discussion prompt still rejects pages beyond its one page', async () => {
  const tab = probedTab({ routes: { '/learn/api/public/v1/courses/_101_1/discussions/_911_1': {
    ...PROBED.discussion, topic: { ...PROBED.discussion.topic, body: '' },
  } } });
  const ctx = ctxFor(UL, tabsOf([tab]));
  const first = await tool('discussion_read').run({ course: '_101_1', id: '_911_1' }, ctx);
  assert.equal(first.pages, 1);
  const extra = await tool('discussion_read').run({ course: '_101_1', id: '_911_1', page: 2 }, ctx);
  assert.equal(extra.ok, false);
  assert.match(extra.error, /1 page/);
});
