// Ask Rime's own tools (docs/ai-harness.md "Rime's own tools"): run_js and its sandbox, the places map and the panel's
// actions, wakes and monitors. Their specs in agent.tools (the <tools> lines Rime trains on), check()'s rules for them, each
// tool's run and refusals, the sandbox's limits, the alarms and the store's caps, and monitors over Glaze's caches as the
// code that writes them makes them (test/helpers/mcp-caches.cjs, from real responses' fixtures).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const S = require('../../extension/ai/schema.js');
const TL = require('../../extension/ai/tools.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const P = require('../../extension/ai/agent/places.js');
const J = require('../../extension/ai/agent/js.js');
const W = require('../../extension/ai/agent/wakes.js');
const SET = require('../../extension/ai/settings.js');
const ST = require('../../extension/agents/tools-study.js');
const GR = require('../../extension/agents/tools-grades.js');
const C = require('../helpers/mcp-caches.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OWN = ['run_js', 'places_list', 'place_open', 'page_highlight', 'wake_create', 'monitor_create', 'wakes_list', 'wake_cancel'];
const NOW = Date.UTC(2026, 9, 30, 19, 5); // Friday 2026-10-30 14:05 in Chicago
const ZONE = 'America/Chicago';
const step = (name, args, result) => ({ call: { name, arguments: args }, result });
const input = (question, steps = [], tools = [...A.NAMES]) => A.task.input({ question, tools, steps, now: NOW, zone: ZONE });
const call = (name, args) => ({ call: { name, arguments: args }, answer: null });

// ---- the specs ----------------------------------------------------------------------------------------------------------
test('Rime\'s own tools are agent.tools tools with the kinds and schemas Glaze sends, each run where ai/agent defines it', () => {
  assert.deepEqual(A.OWN, OWN);
  for (const n of OWN) assert.ok(A.NAMES.includes(n), n);
  const kinds = Object.fromEntries(A.SPECS.filter((t) => OWN.includes(t.name)).map((t) => [t.name, t.kind]));
  assert.deepEqual(kinds, { run_js: 'read', places_list: 'read', place_open: 'read', page_highlight: 'read', wake_create: 'confirm', monitor_create: 'confirm', wakes_list: 'read', wake_cancel: 'confirm' });
  const env = { local: C.area({}), alarms: null, read: async () => null, on: async () => true, now: () => NOW };
  const defs = [...J.tools(), ...P.tools(), ...W.tools(env)];
  assert.deepEqual(defs.map((d) => d.name).sort(), [...OWN].sort());
  for (const d of defs) {
    const t = TL.define(d), s = A.SPECS.find((x) => x.name === d.name);
    assert.equal(t.kind, s.kind, d.name);
    assert.equal(t.parameters, s.parameters, `${d.name}: one schema, agent.tools'`);
    assert.ok(S.clean(t.parameters), d.name);
    assert.ok(t.description.length <= 420, `${d.name}: short enough for a 1.7B model's window`);
    assert.equal(t.group, undefined, `${d.name}: no group, so Agents' MCP view never lists it`);
    if (t.kind === 'confirm') assert.equal(typeof t.summarize, 'function', `${d.name}: the student sees Glaze's own sentence`);
  }
  // Every parameter is a string or an integer: LFM3's native call holds nothing else (ai/local/grammar.js).
  for (const s of A.SPECS) for (const [k, p] of Object.entries(s.parameters.properties)) assert.ok(['string', 'integer'].includes(p.type) && p.enum === undefined, `${s.name}.${k}`);
});

test('the <tools> lines: Agents\' unchanged, Rime\'s own sorted in by name', () => {
  const lines = A.SPECS.filter((t) => OWN.includes(t.name)).map(A.line);
  assert.equal(lines[0], '{"name": "run_js", "description": "Run one line of JavaScript to work something out: arithmetic, unit conversions, statistics, dates, a small table. The last expression is the result; console.log adds lines. Round with toFixed to the digits you will say. No network, page or storage; it stops after 2 seconds. Never to work out a homework, quiz or exam problem.", "parameters": {"type": "object", "properties": {"code": {"type": "string", "description": "One line, as (72.5 * 0.4 + 88 * 0.6).toFixed(1)"}}, "required": ["code"]}}');
  const inp = input('Remind me at 9 pm to finish the lab', [], ['wake_create', 'todo_list']);
  assert.deepEqual(inp.tools, ['todo_list', 'wake_create']);
  // Agents' tools alone: the request Rime was trained on, byte for byte.
  const old = A.task.input({ question: 'What is due?', tools: ['todo_list', 'grades_list'], now: NOW, zone: ZONE });
  assert.ok(!JSON.stringify(A.task.build(old, { text: require('../../extension/ai/text.js') })).includes('run_js'));
});

test('a native call to run_js keeps the code as one raw line, quotes and backslashes and all', () => {
  const code = 'const a = [3, 4.5, "x\\\\y"]; console.log(a.length); (a[0] * a[1]).toFixed(2)';
  const text = A.native.text({ name: 'run_js', arguments: { code } });
  assert.equal(text, `<tool_call>\n<function=run_js>\n<parameter=code>\n${code}\n</parameter>\n</function>\n</tool_call>`);
  assert.deepEqual(A.fromNative(text), { call: { name: 'run_js', arguments: { code } }, answer: null });
  const w = A.native.text({ name: 'wake_create', arguments: { at: '2026-10-31 21:00', say: 'Finish the lab report' } });
  assert.deepEqual(A.fromNative(w).call.arguments, { at: '2026-10-31 21:00', say: 'Finish the lab report' });
});

// ---- check() ------------------------------------------------------------------------------------------------------------
test('check: run_js never works graded work, in each of the six languages, nor after an assignment or document is read', () => {
  for (const q of ['What is 17% of 2,340 for my homework?', 'Solve problem 3 on the worksheet', 'What is the answer to question 4b?', 'Calcula el ejercicio 5', 'Faz a lição de casa: 3 x 7',
    'Fais mes devoirs de maths', 'Rechne Aufgabe 2 vom Übungsblatt', 'Reken opgave 3 van mijn huiswerk uit', 'quiz question: 2^10?']) {
    assert.equal(A.why(call('run_js', { code: '1+1' }), input(q)), 'work', q);
  }
  for (const q of ['Convert 3.2 miles to kilometres', 'What do I need on the final to keep a B in BIO 101?', 'How many days until Thanksgiving?', 'Average of 81, 92 and 77']) {
    assert.equal(A.why(call('run_js', { code: '(3.2 * 1.609344).toFixed(2)' }), input(q)), '', q);
  }
  const read = step('assignment_read', { course: '5521', assignment: '88121' }, { title: 'Lab report 3', instructions: 'Compute the molarity of 2.5 g NaCl in 250 mL.' });
  assert.equal(A.why(call('run_js', { code: '2.5/58.44/0.25' }), input('What does lab report 3 ask?', [read], [...OWN, 'assignment_read'])), 'work');
});

test('check: unnumbered assessments and spaced problem references still forbid calculation', () => {
  for (const q of ['For my quiz, solve 2 + 2', 'My exam asks me to integrate x squared', 'Solve this assignment: 2 + 2',
    'Calculate problem\n3: 9 * 4', 'En mi examen, calcula 2 + 2', 'Na minha prova, calcula 2 + 2',
    'Pour mon examen, calcule 2 + 2', 'Für meine Klausur: berechne 2 + 2', 'Voor mijn toets: bereken 2 + 2']) {
    assert.equal(A.why(call('run_js', { code: '2+2' }), input(q)), 'work', q);
  }
});

test('check: place_open takes only a place places_list gave; page_highlight only words the question or a result holds', () => {
  const list = step('places_list', {}, { site: 'canvas', here: 'dashboard', places: [{ place: 'grades', title: 'Grades' }, { place: 'course:25', title: 'BIO 1100' }] });
  assert.equal(A.why(call('place_open', { place: 'grades' }), input('Take me to my grades', [list])), '');
  assert.equal(A.why(call('place_open', { place: 'dashboard' }), input('Go home', [list])), '', 'here is a place too');
  assert.equal(A.why(call('place_open', { place: 'grades' }), input('Take me to my grades')), 'place', 'never before places_list');
  assert.equal(A.why(call('place_open', { place: 'course:25/grades' }), input('BIO grades', [list])), 'place', 'a guess at a place is refused');
  const todo = step('todo_list', {}, { items: [{ id: '1', type: 'assignment', title: 'Lab report 3', course: 'BIO 1100' }] });
  assert.equal(A.why(call('page_highlight', { text: 'lab report 3', note: 'Due Friday' }), input('Show me the lab', [todo])), '');
  assert.equal(A.why(call('page_highlight', { text: 'Click here to win' }), input('Show me the lab', [todo])), 'text');
  assert.equal(A.why(call('page_highlight', { text: 'Week 9' }), input('Where is Week 9?')), '');
});

test('check: a blank highlight is not grounded text', () => {
  assert.equal(A.why(call('page_highlight', { text: ' \n\t ' }), input('Show me the lab')), 'text');
});

test('check: a monitor course must be an id', async () => {
  const args = { watch: 'due', type: 'assignment', id: '1', course: 'Biology' };
  const todo = step('todo_list', {}, { items: [{ type: 'assignment', id: '1', course: 'Biology' }] });
  assert.equal(A.why(call('monitor_create', args), input('Let me know when the lab moves', [todo])), 'arguments');
  const store = {}, env = wakesEnv(store);
  env.read = async () => ({ items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] });
  assert.equal((await wtool(env, 'monitor_create').run(args, { account: ACC })).ok, false, 'a successful creation must never disappear on the next store read');
});

test('check: a wake, monitor or cancel only when the question asks for one; a wake within 60 days; a monitor\'s fields', () => {
  const at = (s) => call('wake_create', { at: s, say: 'Finish the lab' });
  assert.equal(A.why(at('2026-10-30 21:00'), input('Remind me at 9 pm to finish the lab')), '');
  assert.equal(A.why(at('2026-10-30T21:00'), input('Recuérdame a las 9 terminar el laboratorio')), '');
  assert.equal(A.why(at('2026-10-30 21:00'), input('What is due tonight?')), 'asked', 'a page or result asking for one is not the student');
  assert.equal(A.why(at('2026-10-30 13:00'), input('Remind me at 1 pm')), 'time', 'passed');
  assert.equal(A.why(at('2027-01-05 09:00'), input('Remind me in January')), 'time', 'past 60 days');
  assert.equal(A.why(at('2026-10-30 25:00'), input('Remind me at 25:00')), 'time', 'no such hour');
  const mon = (args) => A.why(call('monitor_create', args), input('Let me know when BIO 1100 posts a grade or the lab moves', [step('todo_list', {}, { items: [{ id: '88121', type: 'assignment', courseId: '25' }] })]));
  assert.equal(mon({ watch: 'grade', course: '25' }), '');
  assert.equal(mon({ watch: 'due', type: 'assignment', id: '88121' }), '');
  assert.equal(mon({ watch: 'announcement' }), '');
  assert.equal(mon({ watch: 'grade' }), 'monitor');
  assert.equal(mon({ watch: 'due', course: '25' }), 'monitor');
  assert.equal(mon({ watch: 'grade', course: '25', type: 'assignment', id: '88121' }), 'monitor');
  assert.equal(mon({ watch: 'weather' }), 'arguments');
  assert.equal(mon({ watch: 'due', type: 'assignment', id: '99999' }), 'id', 'an item no result names');
  const listed = step('wakes_list', {}, { items: [{ id: 'w-abcd1234', what: 'wake', at: NOW + 3600e3, say: 'Lab' }] });
  assert.equal(A.why(call('wake_cancel', { id: 'w-abcd1234' }), input('Cancel my lab reminder', [listed])), '');
  assert.equal(A.why(call('wake_cancel', { id: 'w-zzzz9999' }), input('Cancel my lab reminder', [listed])), 'id');
});

test('check: reminder mentions, negations and cancellation requests do not authorize creation', () => {
  const listed = [step('wakes_list', {}, { items: [{ id: 'w-abcd1234', what: 'wake', say: 'Lab' }] })];
  const wake = call('wake_create', { at: '2026-10-31 21:00', say: 'Lab' });
  const monitor = call('monitor_create', { watch: 'announcement' });
  const cancel = call('wake_cancel', { id: 'w-abcd1234' });
  for (const q of ['What does the reminder switch do?', 'Show my reminders', 'Do not remind me tonight',
    "Please don't watch for announcements", 'I do not want you to remind me', 'What are you watching?', 'How do I cancel a reminder?']) {
    for (const c of [wake, monitor, cancel]) assert.equal(A.why(c, input(q, listed)), 'asked', `${q}: ${c.call.name}`);
  }
  assert.equal(A.why(wake, input('Cancel my lab reminder', listed)), 'asked');
  assert.equal(A.why(monitor, input('Stop watching announcements', listed)), 'asked');
  assert.equal(A.why(cancel, input('Remind me to cancel the lab', listed)), 'asked');
  for (const q of ['Please remind me tonight', 'Could you remind me tonight?', 'Recuérdame esta noche', 'Lembre-me hoje',
    'Rappelle-moi ce soir', 'Erinnere mich heute Abend', 'Herinner me vanavond']) assert.equal(A.why(wake, input(q)), '', q);
  for (const q of ['Watch for announcements', 'Let me know when an announcement posts']) assert.equal(A.why(monitor, input(q)), '', q);
  assert.equal(A.why(cancel, input('Cancel my lab reminder', listed)), '');
});

test('check: affirmative requests to set a reminder or set up a monitor remain usable', () => {
  for (const q of ['Set a reminder for tonight', 'Could you create a reminder for tonight?', 'I would like a reminder tonight']) {
    assert.equal(A.why(call('wake_create', { at: '2026-10-31 21:00', say: 'Lab' }), input(q)), '', q);
  }
  assert.equal(A.why(call('monitor_create', { watch: 'announcement' }), input('Please set up a monitor for announcements')), '');
});

test('moment: a time on the student\'s clock, through clock changes; an hour a change skips is none', () => {
  assert.equal(A.moment('2026-10-30 21:00', ZONE), Date.UTC(2026, 9, 31, 2, 0));
  assert.equal(A.moment('2026-11-02 21:00', ZONE), Date.UTC(2026, 10, 3, 3, 0), 'after the change back to CST');
  assert.equal(A.moment('2026-03-08 02:30', ZONE), null, 'skipped');
  assert.equal(A.moment('2026-02-30 10:00', ZONE), null);
  assert.equal(A.moment('2026-10-30 21:00', 'Europe/Amsterdam'), Date.UTC(2026, 9, 30, 20, 0));
});

// ---- places -------------------------------------------------------------------------------------------------------------
const CANVAS_COURSES = [{ id: '25', name: 'BIO 1100', code: 'BIO1100-01' }, { id: '26', name: 'ENG 1100', code: 'ENG1100-02' }];
const ui = () => { const actions = []; return { actions, push: (a) => actions.push(a) }; };
const placesCtx = (url, site = 'canvas', courses = CANVAS_COURSES, more = {}) => ({ page: { site, url }, courses: async () => courses, writer: true, ui: ui(), ...more });
const tool = (list, name) => list.find((t) => t.name === name);

test('places: Canvas\'s pages, Glaze\'s and each course; a course\'s own pages as its navigation links them; here from the address', async () => {
  const list = tool(P.tools(), 'places_list');
  const top = await list.run({}, placesCtx('https://school.instructure.com/courses/25/assignments/88121'));
  assert.equal(top.here, 'course:25/assignments');
  assert.deepEqual(top.places.map((p) => p.place), ['dashboard', 'courses', 'calendar', 'grades', 'documents', 'settings', 'course:25', 'course:26']);
  const bio = await list.run({ course: '25' }, placesCtx('https://school.instructure.com/'));
  assert.deepEqual(bio.places, [{ place: 'course:25', title: 'BIO 1100' }, { place: 'course:25/grades', title: 'BIO 1100 grades' }, { place: 'course:25/assignments', title: 'BIO 1100 assignments' },
    { place: 'course:25/announcements', title: 'BIO 1100 announcements' }, { place: 'course:25/modules', title: 'BIO 1100 modules' }]);
  assert.equal(bio.here, 'dashboard');
  // The links a Canvas course page's own navigation has (test/fixtures/canvas-course-grades.html), every one of them.
  const html = fs.readFileSync(path.join(ROOT, 'test/fixtures/canvas-course-grades.html'), 'utf8');
  const m = P.map({ site: 'canvas', url: 'https://school.instructure.com/courses/25', courses: CANVAS_COURSES });
  for (const p of m.places.filter((x) => x.course === '25')) assert.ok(html.includes(`href="${new URL(p.url).pathname}"`), p.place);
  assert.deepEqual(await list.run({ course: '99' }, placesCtx('https://school.instructure.com/')), { ok: false, error: 'No course 99 on this site. places_list without course names the courses.' });
  assert.match((await list.run({}, placesCtx('https://evil.example/', 'nope'))).error, /school site/);
});

test('places: Ultra and Moodle, from the paths Glaze already opens there', () => {
  const u = P.map({ site: 'ultra', url: 'https://lms.example.edu/ultra/courses/_101_1/outline/edit', courses: [{ id: '_101_1', name: 'BIO 1100: Biology I' }, { id: '42', name: 'not an Ultra id' }] });
  assert.equal(u.here, 'course:_101_1');
  assert.deepEqual(u.places.map((p) => [p.place, new URL(p.url || 'x:/').pathname]), [['courses', '/ultra/course'], ['calendar', '/ultra/calendar'], ['grades', '/ultra/grades'], ['stream', '/ultra/stream'],
    ['settings', '/'], ['course:_101_1', '/ultra/courses/_101_1/outline'], ['course:_101_1/grades', '/ultra/courses/_101_1/grades'], ['course:_101_1/announcements', '/ultra/courses/_101_1/announcements']]);
  // Every one of them is a link in Ultra's own course navigation (test/fixtures/ultra-instant-outline.html).
  const html = fs.readFileSync(path.join(ROOT, 'test/fixtures/ultra-instant-outline.html'), 'utf8');
  for (const p of u.places.filter((x) => x.course)) assert.ok(html.includes(`href="${new URL(p.url).pathname}"`), p.place);
  const m = P.map({ site: 'moodle', url: 'http://localhost:8081/course/view.php?id=16', courses: [{ id: '16', name: 'Biology' }] });
  assert.equal(m.here, 'course:16');
  assert.equal(m.places.find((p) => p.place === 'course:16/grades').url, 'http://localhost:8081/grade/report/user/index.php?id=16');
});

test('places: Moodle here tolerates page options while keeping course query ids distinct', () => {
  const at = (suffix) => P.map({ site: 'moodle', url: `https://school.example/course/view.php?${suffix}`, courses: [{ id: '16', name: 'Biology' }, { id: '17', name: 'History' }] }).here;
  assert.equal(at('id=16&section=2'), 'course:16');
  assert.equal(at('section=2&id=17'), 'course:17');
  assert.equal(at('id=160'), null);
  assert.equal(at('id=16&id=17'), null, 'ambiguous query ids are not a known course');
  const calendar = P.map({ site: 'moodle', url: 'https://school.example/calendar/view.php?view=week&time=1793404800' });
  assert.equal(calendar.here, 'calendar');
});

test('place_open: a real place goes to the panel as an action; anything else is refused with the nearest place', async () => {
  const open = tool(P.tools(), 'place_open'), c = placesCtx('https://school.instructure.com/');
  assert.deepEqual(await open.run({ place: 'course:25/grades' }, c), { opened: 'course:25/grades', title: 'BIO 1100 grades' });
  assert.deepEqual(c.ui.actions, [{ action: 'open', place: 'course:25/grades', title: 'BIO 1100 grades', url: 'https://school.instructure.com/courses/25/grades' }]);
  assert.deepEqual(await open.run({ place: 'documents' }, c), { opened: 'documents', title: 'Documents (Glaze Writer)' });
  assert.deepEqual(c.ui.actions[1], { action: 'open', place: 'documents', title: 'Documents (Glaze Writer)', app: 'documents' });
  const bad = await open.run({ place: 'course:25/quizzes' }, c);
  assert.equal(bad.error, 'There is no place "course:25/quizzes". The nearest is course:25 (BIO 1100). places_list names every place.');
  assert.match((await open.run({ place: 'gradebook' }, c)).error, /^There is no place "gradebook"\./);
  assert.equal(c.ui.actions.length, 2, 'nothing pushed for a refusal');
  assert.equal(P.SITES.canvas.fill, undefined);
  assert.ok(!P.tools().some((t) => /fill/.test(t.name)), 'no fill: Glaze never fills in the student\'s work or a site\'s forms');
});

test('page_highlight: words on this page, or on the place just opened; never words the page doesn\'t show', async () => {
  const [, open, mark] = P.tools();
  const c = placesCtx('https://school.instructure.com/courses/25/assignments', 'canvas', CANVAS_COURSES, { text: 'Assignments\nLab report 3  Due Oct 31\nReading quiz 6' });
  assert.deepEqual(await mark.run({ text: 'lab REPORT 3', note: 'This one' }, c), { marked: 'lab REPORT 3', on: 'this page' });
  assert.deepEqual(c.ui.actions, [{ action: 'highlight', text: 'lab REPORT 3', note: 'This one' }]);
  assert.match((await mark.run({ text: 'Final exam' }, c)).error, /not on this page/);
  await open.run({ place: 'course:25/grades' }, c);
  assert.deepEqual(await mark.run({ text: 'Final exam' }, c), { marked: 'Final exam', on: 'the place just opened' });
});

// ---- run_js: QuickJS in WebAssembly, the same engine in every browser ----------------------------------------------------
// The engine Glaze vendors (extension/vendor/quickjs/), loaded on the first run, in node as in the extension's background.
const run = (code, o) => J.run(code, o).then(({ ms: _, ...r }) => r);

test('run_js: promise inspection releases every result handle before disposing the runtime', async () => {
  require('../../extension/vendor/quickjs/quickjs.js');
  const handles = [], disposed = [];
  const sandbox = { process, require, __dirname: path.join(ROOT, 'extension/ai/agent'), WebAssembly,
    GZ_QUICKJS: { load: async (...args) => {
      const q = await globalThis.GZ_QUICKJS.load(...args), create = q.newRuntime.bind(q);
      q.newRuntime = () => {
        const rt = create(), context = rt.newContext.bind(rt), dispose = rt.dispose.bind(rt);
        rt.dispose = () => { disposed.push(true); return dispose(); };
        rt.newContext = () => {
          const ctx = context(), state = ctx.getPromiseState.bind(ctx);
          ctx.getPromiseState = (h) => { const s = state(h); if (!s.notAPromise && s.type !== 'pending') handles.push(s.value || s.error); return s; };
          return ctx;
        };
        return rt;
      };
      return q;
    } } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'extension/ai/agent/js.js'), 'utf8'), sandbox);
  for (const code of ['Promise.resolve({ n: 42 })', 'Promise.reject(new Error("no"))', 'Promise.resolve().then(() => 42)']) {
    await sandbox.GZ_AI_RIME_JS.run(code);
    assert.ok(handles.every((h) => !h.alive), code);
  }
  assert.equal(disposed.length, 3);
});

test('run_js: the last expression\'s value and console lines; errors and promises as the browser\'s sandbox gave them', async () => {
  assert.deepEqual(await run('const g = [81, 92, 77]; console.log("n", g.length); (g.reduce((x, y) => x + y) / g.length).toFixed(2)'), { ok: true, value: '83.33', logs: ['n 3'] });
  assert.equal((await run('3.2 * 1.609344')).value, 3.2 * 1.609344);
  assert.deepEqual((await run('[1, 2].map((x) => ({ x, sq: x * x }))')).value, [{ x: 1, sq: 1 }, { x: 2, sq: 4 }]);
  assert.deepEqual((await run('console.info({ a: 1 }, [2]); console.warn(true); undefined')), { ok: true, value: 'undefined', logs: ['{"a":1} [2]', 'true'] });
  const bad = await run('undefinedThing + 1');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /^ReferenceError: .*undefinedThing.* is not defined$/);
  assert.match((await run('1 +')).error, /^SyntaxError: /);
  assert.match((await run('throw new RangeError("too far")')).error, /^RangeError: too far$/);
  assert.equal((await run('Promise.resolve(6 * 7)')).value, 42);
  assert.match((await run('Promise.reject(new Error("no"))')).error, /^Error: no$/);
  assert.match((await run('new Promise(() => {})')).error, /never settled/);
});

test('run_js: stopped at its time, its memory capped, value and logs sharing one output budget, its code held to its length', async () => {
  const t = Date.now(), loop = await run('while (true) {}', { ms: 300 });
  assert.deepEqual(loop, { ok: false, value: null, logs: [], error: 'Stopped after 0.3 seconds.' });
  assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`);
  assert.equal(J.LIMIT.ms, 2000);
  const greedy = await run('const a = []; while (true) a.push("x".repeat(1e6));');
  assert.equal(greedy.ok, false);
  assert.match(greedy.error, /memory/i);
  const many = await run('for (let i = 0; i < 1000; i++) console.log(i); "done"');
  assert.deepEqual([many.logs.length, many.logs[39], many.value, many.cut], [J.LIMIT.lines, '39', 'done', true]);
  const loud = await run('for (let i = 0; i < 1000; i++) console.log("x".repeat(300)); "done"');
  assert.ok(loud.logs.join('').length <= J.LIMIT.output && loud.cut === true && loud.logs.every((l) => l.length <= J.LIMIT.line));
  const big = await run('"y".repeat(100000)');
  assert.ok(big.value.length <= J.LIMIT.output && big.cut === true);
  const both = await run('console.log("z".repeat(450)); console.log("z".repeat(450)); "w".repeat(4000)');
  assert.ok(both.logs.join('').length + both.value.length <= J.LIMIT.output && both.cut === true, 'one budget for both');
  assert.match((await run('1;'.repeat(600))).error, /longer than 1000/);
  assert.match((await run('   ')).error, /No code/);
  // A stopped or failed run leaves the engine working.
  assert.equal((await run('6 * 7')).value, 42);
});

test('run_js: the engine\'s whole heap is capped, so many small allocations end fast; a built-in that backtracks still stops', async () => {
  // QuickJS can't total a run's allocations in this build: without the heap's own maximum, 1 MB strings ran to 2 GB in 7 s.
  for (const code of ['const a = []; while (true) a.push("x".repeat(1e6));', 'const a = []; while (true) a.push({ x: 1 });', 'Array.from({ length: 2e6 }, (_, i) => -i).sort((a, b) => a - b).length']) {
    const t = Date.now(), r = await run(code);
    assert.deepEqual([r.ok, r.error], [false, 'The code ran out of memory.'], code);
    assert.ok(Date.now() - t < 1500, `${code}: ${Date.now() - t} ms`);
  }
  const t = Date.now(), regex = await run('/(a+)+$/.test("a".repeat(32) + "b")', { ms: 500 });
  assert.equal(regex.error, 'Stopped after 0.5 seconds.');
  assert.ok(Date.now() - t < 1500, `${Date.now() - t} ms`);
  assert.equal(J.LIMIT.heap, 64 << 20);
  assert.equal((await run('6 * 7')).value, 42, 'and the engine works after');
});

test('run_js: nothing outside ECMAScript reaches the code, and each run starts from a fresh context', async () => {
  const names = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'setTimeout', 'setInterval', 'indexedDB', 'localStorage', 'caches', 'Worker', 'postMessage',
    'navigator', 'location', 'document', 'window', 'self', 'chrome', 'browser', 'require', 'process', 'std', 'os', 'WebAssembly'];
  const r = await run(`${JSON.stringify(names)}.map((k) => k + ':' + typeof globalThis[k]).join(' ')`);
  assert.equal(r.value, names.map((k) => `${k}:undefined`).join(' '));
  assert.match((await run('fetch("https://example.com")')).error, /^ReferenceError: .*fetch/);
  assert.match((await run('import("https://example.com/x.js").then(() => "loaded", (e) => "refused " + e.name)')).value, /^refused /);
  await run('globalThis.kept = 1; Object.prototype.polluted = 2; 0');
  assert.equal((await run('typeof kept + " " + typeof ({}).polluted')).value, 'undefined undefined');
});

test('run_js: one tool and one result shape in Chrome, Firefox and Safari, with no page, frame or eval sandbox', async () => {
  const [js] = J.tools();
  assert.deepEqual(await js.run({ code: '(72.5 * 0.4 + 88 * 0.6).toFixed(1)' }, {}), { ok: true, value: '81.8', logs: [] });
  assert.deepEqual(await js.run({ code: 'nope' }, {}), { ok: false, value: null, logs: [], error: (await run('nope')).error });
  assert.equal(J.NONE, undefined, 'no browser is refused');
  for (const f of ['extension/ai/sandbox', 'extension/ai/sandbox/js.html', 'extension/ai/sandbox/frame.js']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  assert.deepEqual(m.sandbox, { pages: ['mods/host.html'] });
  assert.ok(!JSON.stringify(m.web_accessible_resources).includes('quickjs'), 'no page can load the engine');
  assert.match(m.content_security_policy.extension_pages, /'wasm-unsafe-eval'/);
  // The worker caches the engine at install (Chrome imports later only what it imported then); Firefox's event page loads
  // the same file by name; Safari's package keeps it.
  const bg = fs.readFileSync(path.join(ROOT, 'extension/background/background.js'), 'utf8');
  assert.match(bg, /addEventListener\?\.\('install', \(\) => importScripts\('\.\.\/vendor\/quickjs\/quickjs\.js'\)\)/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'tools/build/safari-drop.txt'), 'utf8'), /quickjs|ai\/sandbox/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'tools/build/package-firefox.sh'), 'utf8'), /quickjs|ai\/sandbox/);
});

test('the vendored engine: pinned, licensed, and byte for byte what its provenance note records', () => {
  const crypto = require('node:crypto');
  const dir = path.join(ROOT, 'extension/vendor/quickjs');
  const note = fs.readFileSync(path.join(dir, 'PROVENANCE.md'), 'utf8');
  for (const pkg of ['quickjs-emscripten-core@0.32.0', '@jitl/quickjs-wasmfile-release-sync@0.32.0', '@jitl/quickjs-ffi-types@0.32.0']) assert.ok(note.includes(pkg), pkg);
  for (const f of ['quickjs.js', 'quickjs.wasm']) {
    const sum = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex');
    assert.ok(note.includes(`${sum}  ${f}`), `${f} ${sum}`);
  }
  const license = fs.readFileSync(path.join(dir, 'quickjs.LICENSE'), 'utf8');
  assert.match(license, /MIT/);
  assert.match(license, /Fabrice Bellard/);
  assert.match(license, /Jake Teton-Landis/);
});

// ---- wakes and monitors -------------------------------------------------------------------------------------------------
const { CANVAS, ULTRA } = C;
const ACC = `${CANVAS}/5`, UL = `${ULTRA}/${C.ULTRA_UID}`;
const T0 = C.NOW;
const alarms = () => { const live = new Map(), log = []; return { live, log, getAll: async () => [...live].map(([name, o]) => ({ name, scheduledTime: o.when, periodInMinutes: o.periodInMinutes })), create: async (n, o) => { live.set(n, o); log.push(['create', n, o]); }, clear: async (n) => { live.delete(n); log.push(['clear', n]); return true; } }; };
const memory = (store) => ({ get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(store, x)).map((x) => [x, store[x]]))), set: async (v) => { Object.assign(store, structuredClone(v)); } });
// The worker's env: Agents' own tools read Glaze's caches for the monitor's account.
const reader = (store) => { const all = [...ST.tools(), ...GR.tools()]; return (name, args, account) => all.find((t) => t.name === name).run(args, C.ctx(store, account)); };
const wakesEnv = (store, o = {}) => { let now = o.now ?? T0, on = o.on ?? true; const a = alarms(); return { local: memory(store), alarms: a, read: reader(store), on: async () => on, now: () => now, at: (t) => { now = t; }, off: () => { on = false; } }; };
const wtool = (env, name) => W.tools(env).find((t) => t.name === name);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test('wakes: switching off during a monitor baseline read prevents its creation', async () => {
  const store = {}, env = wakesEnv(store), entered = deferred(), resume = deferred();
  env.read = async () => { entered.resolve(); await resume.promise; return { items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] }; };
  const pending = wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, { account: ACC });
  await entered.promise;
  env.off(); resume.resolve();
  assert.equal((await pending).ok, false);
  assert.equal(store.rimeWakes?.monitors?.length || 0, 0);
});

test('monitor_create: an explicit account owns both the baseline and subsequent reads', async () => {
  const store = {}, env = wakesEnv(store), accounts = [], other = `${CANVAS}/77`;
  env.read = async (name, args, account) => { accounts.push(account); return { items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] }; };
  const mk = wtool(env, 'monitor_create');
  assert.ok((await mk.run({ watch: 'due', type: 'assignment', id: '1', account: other }, { account: ACC })).id);
  await W.tick(env);
  assert.deepEqual(accounts, [other, other]);
  assert.equal(store.rimeWakes.monitors[0].account, other);
  assert.equal((await mk.run({ watch: 'due', type: 'assignment', id: '1', account: 'https://school.example@evil.example/77' }, { account: ACC })).ok, false);
});

test('wakes: switching off during a tick preserves pending records and suppresses delivery', async () => {
  const store = {}, env = wakesEnv(store), entered = deferred(), resume = deferred();
  env.read = async () => ({ items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] });
  await wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, { account: ACC });
  env.read = async () => { entered.resolve(); await resume.promise; return { items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 2 * 864e5 }] }; };
  const before = structuredClone(store.rimeWakes), pending = W.tick(env);
  await entered.promise;
  env.off(); resume.resolve();
  assert.equal(await pending, 0);
  assert.deepEqual(store.rimeWakes, before);
  store.rimeWakes.fired = [{ id: 'w-abcdefgh', what: 'wake', say: 'Lab', at: T0 }];
  let checks = 0;
  env.on = async () => ++checks === 1;
  assert.deepEqual(await W.take(env), []);
  assert.equal(store.rimeWakes.fired.length, 1, 'off during take must not consume a waiting message');
});

test('wakes: malformed stored monitors cannot block other wakes or leak unbounded records', async () => {
  const store = { rimeWakes: {
    wakes: [{ id: 'w-abcdefgh', at: T0 - 1, say: 'x'.repeat(1000), made: T0 - 1000 }],
    monitors: [
      { id: 'm-abcdefgh', watch: 'due', account: ACC, until: T0 + 864e5 },
      { id: 'm-bcdefghi', watch: 'announcement', account: ACC, until: T0 + 864e5, base: {} },
      { id: 'm-cdefghij', watch: 'submitted', account: ACC, until: T0 + 864e5, item: null, base: { submitted: false } },
    ], fired: [],
  } }, env = wakesEnv(store);
  assert.deepEqual((await wtool(env, 'wakes_list').run()).items.map((x) => x.id), ['w-abcdefgh']);
  assert.equal(await W.tick(env), 1);
  const [fired] = await W.take(env);
  assert.equal(fired.say.length, W.LIMIT.say);
  assert.deepEqual(store.rimeWakes.monitors, []);
});

test('wakes: rearming preserves an existing monitor cadence and removes spent wake alarms', async () => {
  const store = {}, env = wakesEnv(store), ctx = { account: ACC, zone: 'UTC' };
  env.read = async () => ({ items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] });
  await wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, ctx);
  await wtool(env, 'wake_create').run({ at: '2026-10-15 21:00', say: 'Lab' }, ctx);
  await W.tick(env);
  assert.equal(env.alarms.log.filter(([op, name]) => op === 'create' && name === W.TICK).length, 1, 'page activity must not push the periodic alarm back');
  env.at(Date.UTC(2026, 9, 15, 22));
  await W.take(env);
  assert.equal([...env.alarms.live.keys()].some((n) => n.startsWith('gz-rime:wake:')), false);
});

test('wakes: startup and the off/on switch restore missing alarms from the stored records', async () => {
  const store = {}, env = wakesEnv(store), events = { startup: [], installed: [], changed: [] };
  await wtool(env, 'wake_create').run({ at: '2026-10-15 21:00', say: 'Lab' }, { zone: 'UTC' });
  const id = store.rimeWakes.wakes[0].id;
  env.alarms.live.clear();
  const source = fs.readFileSync(path.join(ROOT, 'extension/background/background.js'), 'utf8');
  const block = source.slice(source.indexOf('const rimeWakesEnv ='), source.indexOf('// The registry\'s state', source.indexOf('const rimeWakesEnv =')));
  let enabled = true;
  vm.runInNewContext(block, {
    chrome: { alarms: { ...env.alarms, onAlarm: { addListener() {} } }, storage: { local: env.local, onChanged: { addListener: (f) => events.changed.push(f) } },
      runtime: { onStartup: { addListener: (f) => events.startup.push(f) }, onInstalled: { addListener: (f) => events.installed.push(f) } } },
    GZ_AI_RIME_WAKES: W, GZ_AI_SETTINGS: { clean: () => ({ wakes: enabled }), allowed: () => true },
    ai() {}, glazeOn: async () => true, Date: { now: env.now },
  });
  assert.equal(events.startup.length, 1, 'startup must rebuild browser alarms');
  await events.startup[0]();
  assert.ok(env.alarms.live.has(`gz-rime:wake:${id}`));
  enabled = false;
  await Promise.all(events.changed.map((f) => f({ ai: {} }, 'local')));
  assert.equal(env.alarms.live.size, 0);
  assert.equal(store.rimeWakes.wakes.length, 1, 'turning off retains the saved wake');
  enabled = true;
  await Promise.all(events.changed.map((f) => f({ ai: {} }, 'local')));
  assert.ok(env.alarms.live.has(`gz-rime:wake:${id}`));
});

test('wakes: expired monitors and overdue wakes release capacity before concurrent creation', async () => {
  const store = { rimeWakes: {
    wakes: Array.from({ length: 20 }, (_, i) => ({ id: `w-${String(i).padStart(8, '0')}`, at: T0 - 1, say: 'Old wake', made: T0 - 864e5 })),
    monitors: Array.from({ length: 20 }, (_, i) => ({ id: `m-${String(i).padStart(8, '0')}`, watch: 'due', account: ACC, item: { type: 'assignment', id: '1' }, until: T0 - 1, made: T0 - 31 * 864e5, base: { due: T0, title: 'Lab', course: '' } })),
    fired: [],
  } }, env = wakesEnv(store);
  env.read = async () => ({ items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] });
  assert.ok((await wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, { account: ACC })).id, 'expired monitors must not consume the cap');
  const made = await Promise.all(Array.from({ length: 25 }, (_, i) => wtool(env, 'wake_create').run({ at: '2026-10-15 21:00', say: `New ${i}` }, { zone: 'UTC' })));
  assert.equal(made.filter((r) => r.id).length, 20, 'the queue enforces the cap without losing concurrent writes');
  assert.equal(store.rimeWakes.wakes.length, 20);
  assert.equal(store.rimeWakes.monitors.length, 1);
  assert.equal(store.rimeWakes.fired.length, 20, 'overdue wakes are retained for delivery');
});

test('wake_create: approved first, kept with its alarm, at most 20, refused when passed, too far off or switched off', async () => {
  const store = {}, env = wakesEnv(store), ctx = { zone: 'UTC' };
  const make_ = wtool(env, 'wake_create');
  assert.equal(await make_.summarize({ at: '2026-10-15 21:00', say: 'Finish the lab' }, ctx), 'Come back Thu, Oct 15, 9:00 PM: “Finish the lab”');
  const r = await make_.run({ at: '2026-10-15 21:00', say: 'Finish the lab' }, ctx);
  assert.match(r.id, /^w-[a-z0-9]{8}$/);
  assert.deepEqual({ ...r, id: 0 }, { id: 0, what: 'wake', at: Date.UTC(2026, 9, 15, 21), say: 'Finish the lab' });
  assert.deepEqual(env.alarms.live.get(`gz-rime:wake:${r.id}`), { when: Date.UTC(2026, 9, 15, 21) });
  assert.deepEqual((await make_.run({ at: '2026-10-15 11:00', say: 'x' }, ctx)).error, 'That time has passed or is less than a minute away.');
  assert.deepEqual((await make_.run({ at: '2026-12-31 11:00', say: 'x' }, ctx)).error, 'A wake can be at most 60 days ahead.');
  for (let i = 1; i < W.LIMIT.wakes; i++) assert.ok((await make_.run({ at: '2026-10-16 09:00', say: `n${i}` }, ctx)).id);
  assert.match((await make_.run({ at: '2026-10-16 09:00', say: 'one more' }, ctx)).error, /^20 wakes are waiting already/);
  env.off();
  assert.deepEqual(await make_.run({ at: '2026-10-16 09:00', say: 'x' }, ctx), { ok: false, error: 'Reminders and watches are off in Glaze settings (AI, Ask Rime).' });
  await assert.rejects(make_.summarize({ at: '2026-10-16 09:00', say: 'x' }, ctx), /off in Glaze settings/);
});

test('a wake fires once its time comes, by its alarm or when the next school page asks; fired ones are shown once, at most 20 kept', async () => {
  const store = {}, env = wakesEnv(store), ctx = { zone: 'UTC' };
  const { id } = await wtool(env, 'wake_create').run({ at: '2026-10-15 21:00', say: 'Finish the lab' }, ctx);
  assert.equal(await W.alarm(env, { name: 'other-feature' }), 0);
  assert.equal(await W.alarm(env, { name: `gz-rime:wake:${id}` }), 0, 'not yet');
  env.at(Date.UTC(2026, 9, 15, 21, 0, 5));
  assert.equal(await W.alarm(env, { name: `gz-rime:wake:${id}` }), 1);
  assert.deepEqual(store.rimeWakes.wakes, []);
  assert.deepEqual(await W.take(env), [{ id, what: 'wake', say: 'Finish the lab', at: Date.UTC(2026, 9, 15, 21, 0, 5) }]);
  assert.deepEqual(await W.take(env), [], 'shown once');
  // Safari may never wake the background for an alarm: the page's take() finds it all the same.
  const second = await wtool(env, 'wake_create').run({ at: '2026-10-16 08:00', say: 'Quiz' }, ctx);
  env.at(Date.UTC(2026, 9, 16, 9));
  assert.deepEqual((await W.take(env)).map((f) => f.id), [second.id]);
  // Switched off: nothing is shown or checked.
  await wtool(env, 'wake_create').run({ at: '2026-10-16 10:00', say: 'later' }, ctx);
  env.at(Date.UTC(2026, 9, 16, 11));
  env.off();
  assert.deepEqual(await W.take(env), []);
  assert.equal(store.rimeWakes.wakes.length, 1, 'kept for when it is on again');
  // The store keeps what fits, at most 20 fired.
  const s = W.clean({ wakes: [{ id: 'w-bad', at: 1, say: 'x' }, { id: 'w-abcdefgh', at: 5, say: '' }], monitors: [{ id: 'm-abcdefgh', watch: 'weather', account: ACC, until: 9 }],
    fired: Array.from({ length: 30 }, (_, i) => ({ id: `w-${String(i).padStart(8, '0')}`, what: 'wake', at: T0, say: 'Lab' })) });
  assert.deepEqual([s.wakes.length, s.monitors.length, s.fired.length, s.fired[0].id], [0, 0, 20, 'w-00000010']);
});

test('monitor due and submitted: Glaze\'s own to-do list, compared with what it read when the monitor was made', async () => {
  const lab = (o = {}) => C.planner({ id: 1, course: 25, name: 'BIO 1100', title: 'Lab report', at: '2026-10-16T03:59:00Z', ...o });
  const store = { todoCache: await C.canvasPlan('5', [lab()]) }, env = wakesEnv(store), ctx = { account: ACC, zone: 'UTC' };
  const mk = wtool(env, 'monitor_create');
  assert.equal(await mk.summarize({ watch: 'due', type: 'assignment', id: '1' }, ctx), 'Watch for the due date of “Lab report” to move for 30 days.');
  const due = await mk.run({ watch: 'due', type: 'assignment', id: '1', say: 'Tell me the new date' }, ctx);
  const sub = await mk.run({ watch: 'submitted', type: 'assignment', id: '1' }, ctx);
  assert.deepEqual({ ...due, id: 0 }, { id: 0, what: 'monitor', watch: 'due', about: 'the due date of “Lab report” to move', say: 'Tell me the new date' });
  assert.deepEqual(env.alarms.live.get('gz-rime:tick'), { periodInMinutes: 30 });
  assert.equal((await mk.run({ watch: 'due', type: 'assignment', id: '404' }, ctx)).error, 'That item is not on the to-do list as Glaze last read it; todo_list names them.');
  assert.equal(await W.tick(env), 0, 'nothing changed');
  // Canvas moves the date and then shows it handed in, as its planner answers.
  store.todoCache = await C.canvasPlan('5', [lab({ at: '2026-10-18T03:59:00Z' })]);
  assert.equal(await W.tick(env), 1);
  store.todoCache = await C.canvasPlan('5', [lab({ at: '2026-10-18T03:59:00Z', sub: { submitted: true } })]);
  assert.equal(await W.tick(env), 1);
  const fired = await W.take(env);
  assert.deepEqual(fired.map((f) => [f.id, f.watch, f.fact]), [
    [due.id, 'due', { title: 'Lab report', course: 'BIO 1100', from: Date.parse('2026-10-16T03:59:00Z'), due: Date.parse('2026-10-18T03:59:00Z') }],
    [sub.id, 'submitted', { title: 'Lab report', course: 'BIO 1100', submitted: true }]]);
  assert.equal(fired[0].say, 'Tell me the new date');
  assert.deepEqual(store.rimeWakes.monitors, []);
  assert.equal(env.alarms.live.has('gz-rime:tick'), false, 'no monitor left: no tick');
});

test('monitor grade: a score posting in Insights\' record of the course; letters-only courses and missing records refused', async () => {
  const courses = C.canvasGrades(), at = C.NOW - 7200e3;
  const store = {};
  await C.keepInsights(store, CANVAS, '5', courses.map((c) => C.canvasCourse(c, at)), at);
  const env = wakesEnv(store), ctx = { account: ACC, zone: 'UTC' }, mk = wtool(env, 'monitor_create');
  const id = String(courses[0].course.id);
  const m = await mk.run({ watch: 'grade', course: id, say: 'Tell me my new grade' }, ctx);
  assert.equal(m.what, 'monitor');
  assert.equal(await W.tick(env), 0);
  // Homework 5 comes back graded, as Canvas's answer shapes a graded submission.
  const later = structuredClone(courses);
  const hw = later[0].groups.flatMap((g) => g.assignments).find((a) => a.name === 'Homework 5');
  const graded = later[0].groups.flatMap((g) => g.assignments).find((a) => a.name === 'Homework 1').submission;
  hw.submission = { ...graded, assignment_id: hw.id, score: 18, grade: '18' };
  await C.keepInsights(store, CANVAS, '5', later.map((c) => C.canvasCourse(c, C.NOW)), C.NOW);
  assert.equal(await W.tick(env), 1);
  const [f] = await W.take(env);
  assert.equal(f.id, m.id);
  assert.deepEqual(f.fact, { course: 'MATH 1350', was: 83.5, percent: f.fact.percent });
  assert.ok(Number.isFinite(f.fact.percent) && f.fact.percent !== 83.5);
  assert.match((await mk.run({ watch: 'grade', course: '999' }, ctx)).error, /Insights keeps no course/);
  assert.match((await mk.run({ watch: 'grade', course: id }, { account: `${CANVAS}/77`, zone: 'UTC' })).error, /^Turn on Insights/);
  assert.equal((await mk.run({ watch: 'grade' }, ctx)).error, 'grade takes the course id.');
});

test('monitor grade: a new day at the same percent is visible after Insights reaches its trend cap', async () => {
  const store = {}, env = wakesEnv(store), ctx = { account: ACC, zone: 'UTC' };
  const keep = async (last) => C.keepInsights(store, CANVAS, '5', [{ id: '25', name: 'Biology', items: [],
    trend: Array.from({ length: 401 }, (_, i) => [last - (400 - i) * 864e5, 80]) }], last);
  await keep(T0);
  const mk = await wtool(env, 'monitor_create').run({ watch: 'grade', course: '25' }, ctx);
  assert.ok(mk.id);
  assert.equal((await reader(store)('course_grades', { course: '25' }, ACC)).trend.length, 400);
  await keep(T0 + 864e5);
  assert.equal(await W.tick(env), 1, 'a new trend point must fire even when the retained count and percent stay the same');
  assert.equal((await W.take(env))[0].id, mk.id);
});

test('monitor announcement: a new one in Canvas\'s planner; on Blackboard refused; expired monitors go without firing', async () => {
  const note = (id, title, at) => C.planner({ type: 'announcement', id, course: 25, name: 'BIO 1100', title, at });
  const store = { todoCache: await C.canvasPlan('5', [note(70, 'Welcome', '2026-10-10T12:00:00Z')]) }, env = wakesEnv(store), ctx = { account: ACC, zone: 'UTC' };
  const mk = wtool(env, 'monitor_create');
  const m = await mk.run({ watch: 'announcement', course: '25' }, ctx);
  assert.equal(m.about, 'a new announcement in BIO 1100');
  store.todoCache = await C.canvasPlan('5', [note(70, 'Welcome', '2026-10-10T12:00:00Z'), note(71, 'Lab moved to Room 204', '2026-10-15T11:00:00Z')]);
  assert.equal(await W.tick(env), 1);
  assert.deepEqual((await W.take(env))[0].fact, { course: 'BIO 1100', titles: ['Lab moved to Room 204'] });
  assert.match((await mk.run({ watch: 'announcement' }, { account: UL, zone: 'UTC' })).error, /^On Blackboard/);
  await mk.run({ watch: 'announcement' }, ctx);
  env.at(T0 + 31 * 864e5);
  store.todoCache = await C.canvasPlan('5', [note(72, 'New', '2026-11-10T12:00:00Z')]);
  assert.equal(await W.tick(env), 0);
  assert.deepEqual(store.rimeWakes.monitors, []);
});

test('monitors: expiry during a data read suppresses a late change and expired watches are not listed', async () => {
  const store = {}, env = wakesEnv(store), args = { watch: 'due', type: 'assignment', id: '1' };
  env.read = async () => ({ items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 864e5 }] });
  await wtool(env, 'monitor_create').run(args, { account: ACC });
  const saved = structuredClone(store.rimeWakes);
  env.read = async () => { env.at(T0 + 31 * 864e5); return { items: [{ type: 'assignment', id: '1', title: 'Lab', due: T0 + 2 * 864e5 }] }; };
  assert.equal(await W.tick(env), 0, 'the watch expired while the data read was pending');
  assert.deepEqual(await W.take(env), []);
  assert.equal(store.rimeWakes.monitors.length, 0);
  store.rimeWakes = saved;
  assert.deepEqual((await wtool(env, 'wakes_list').run()).items, []);
});

test('wakes_list and wake_cancel: what waits, by id; a cancel approved first, its alarm cleared; monitors capped at 20', async () => {
  const store = { todoCache: await C.canvasPlan('5', [C.planner({ id: 1, title: 'Lab report', at: '2026-10-16T03:59:00Z' })]) }, env = wakesEnv(store), ctx = { account: ACC, zone: 'UTC' };
  const w = await wtool(env, 'wake_create').run({ at: '2026-10-15 21:00', say: 'Finish the lab' }, ctx);
  const m = await wtool(env, 'monitor_create').run({ watch: 'submitted', type: 'assignment', id: '1' }, ctx);
  assert.deepEqual(await wtool(env, 'wakes_list').run({}, ctx), { items: [{ id: w.id, what: 'wake', at: Date.UTC(2026, 9, 15, 21), say: 'Finish the lab' },
    { id: m.id, what: 'monitor', watch: 'submitted', about: '“Lab report” to show as handed in' }] });
  const cancel = wtool(env, 'wake_cancel');
  assert.equal(await cancel.summarize({ id: w.id }, ctx), 'Cancel coming back Thu, Oct 15, 9:00 PM: “Finish the lab”.');
  assert.deepEqual(await cancel.run({ id: w.id }, ctx), { cancelled: w.id, what: 'wake' });
  assert.equal(env.alarms.live.has(`gz-rime:wake:${w.id}`), false);
  await assert.rejects(cancel.summarize({ id: 'w-00000000' }, ctx), /No wake or monitor has that id/);
  for (let i = 1; i < W.LIMIT.monitors; i++) await wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, ctx);
  assert.match((await wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, ctx)).error, /^20 monitors are watching already/);
});

test('Settings → AI → Ask Rime: Reminders and watches, on unless turned off, on this device only', () => {
  assert.equal(SET.DEFAULTS.wakes, true);
  assert.equal(SET.clean({}).wakes, true);
  assert.equal(SET.clean({ wakes: false }).wakes, false);
  assert.equal(SET.clean({ wakes: 'no' }).wakes, true);
  const ed = fs.readFileSync(path.join(ROOT, 'extension/settings/editor-ai.js'), 'utf8');
  assert.match(ed, /\['wakes', 'Reminders and watches'\]/);
  for (const l of ['de', 'es', 'fr', 'nl', 'pt-BR']) assert.match(fs.readFileSync(path.join(ROOT, `extension/i18n/${l}.js`), 'utf8'), /"Reminders and watches":/, l);
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8'));
  assert.ok(m.permissions.includes('alarms'));
});

// ---- training-spec review (glaze-plans/lfm-tune/FORMAT-tools-v3.md) ------------------------------------------------------
test('places_list names each course\'s id, so places_list with course follows it in check()', async () => {
  const top = await tool(P.tools(), 'places_list').run({}, placesCtx('https://school.instructure.com/'));
  assert.deepEqual(top.places.find((p) => p.place === 'course:25'), { place: 'course:25', title: 'BIO 1100', course: '25' });
  const list = step('places_list', {}, top);
  assert.equal(A.why(call('places_list', { course: '25' }), input('Show me BIO 1100\'s pages', [list])), '');
});

test('"don\'t let me forget" asks for a wake, in each language', () => {
  for (const q of ["Don't let me forget the lab at 9 pm", 'No me dejes olvidar el laboratorio', 'Não me deixe esquecer o laboratório', "Ne me laisse pas oublier le labo", 'Lass mich das Labor nicht vergessen', 'Laat me het lab niet vergeten']) {
    assert.equal(A.why(call('wake_create', { at: '2026-10-30 21:00', say: 'Lab' }), input(q)), '', q);
  }
});

test('a due or submitted monitor watches an item the to-do list named, not one from assignments_list alone', () => {
  const asg = step('assignments_list', {}, { items: [{ assignment: '88121', type: 'assignment', courseId: '25', title: 'Lab report 3' }] });
  const todo = step('todo_list', {}, { items: [{ id: '88121', type: 'assignment', courseId: '25', title: 'Lab report 3' }] });
  const q = 'Let me know when the lab report shows as submitted';
  assert.equal(A.why(call('monitor_create', { watch: 'submitted', type: 'assignment', id: '88121' }), input(q, [asg])), 'monitor');
  assert.equal(A.why(call('monitor_create', { watch: 'submitted', type: 'assignment', id: '88121' }), input(q, [todo])), '');
});

// ---- owner decisions, 2026-11-01 -------------------------------------------------------------------------------------------
test('check: the student\'s own grade math runs; solving a graded problem does not, in each of the six languages', () => {
  const allowed = {
    en: ['What do I need on the exam to keep a B?', 'If I get 85 on the quiz, what is my grade?', 'Calculate my grade if I score 90 on the final exam', 'What average do I need on the last two assignments to pass?'],
    es: ['¿Qué nota necesito en el examen para mantener un 8?', 'Calcula mi promedio si saco 90 en el examen'],
    'pt-BR': ['Que nota preciso na prova para passar?', 'Calcula minha média se eu tirar 8 na prova'],
    fr: ['Quelle note me faut-il à l\'examen pour garder 14 de moyenne ?', 'Calcule ma moyenne si j\'ai 15 au contrôle'],
    de: ['Welche Note brauche ich in der Klausur für eine 2?', 'Berechne meinen Durchschnitt, wenn ich in der Prüfung 80 Punkte habe'],
    nl: ['Welk cijfer moet ik halen voor de toets om een 7 gemiddeld te houden?', 'Bereken mijn gemiddelde als ik een 6 haal voor het tentamen'],
  };
  const refused = {
    en: ['Solve question 3 of my exam: 2x + 4 = 10', 'For my quiz, compute 17 * 23', 'Do my homework: 4 * 12', 'x^2 - 5x + 6 = 0', 'Solve for y: 3y + 2 = 11'],
    es: ['Resuelve el problema 2 del examen', 'Para mi examen, calcula 17 * 23'],
    'pt-BR': ['Resolva a questão 4 da prova', 'Na minha prova, calcula 17 * 23'],
    fr: ['Résous l\'exercice 3 de mon devoir', 'Pour mon examen, calcule 17 * 23'],
    de: ['Löse Aufgabe 5 der Klausur', 'Für meine Prüfung: berechne 17 * 23'],
    nl: ['Los vraag 2 van de toets op', 'Voor mijn tentamen: bereken 17 * 23'],
  };
  const ask = (q, locale) => A.why(call('run_js', { code: '1 + 1' }), A.task.input({ question: q, tools: [...A.NAMES], now: NOW, zone: ZONE, locale }));
  for (const [l, qs] of Object.entries(allowed)) for (const q of qs) assert.equal(ask(q, l), '', `${l}: ${q}`);
  for (const [l, qs] of Object.entries(refused)) for (const q of qs) assert.equal(ask(q, l), 'work', `${l}: ${q}`);
});

test('monitor results and approval sentences speak the student\'s language, in all six', async () => {
  const lab = C.planner({ id: 1, course: 25, name: 'BIO 1100', title: 'Lab report', at: '2026-10-16T03:59:00Z' });
  const store = { todoCache: await C.canvasPlan('5', [lab]) }, env = wakesEnv(store);
  const want = { en: 'the due date of “Lab report” to move', de: 'eine Verschiebung des Abgabetermins von „Lab report“', es: 'un cambio en la fecha de entrega de «Lab report»',
    fr: 'un changement de la date de remise de « Lab report »', nl: 'een verschuiving van de inleverdatum van ‘Lab report’', 'pt-BR': 'uma mudança no prazo de “Lab report”' };
  for (const [locale, about] of Object.entries(want)) {
    const ctx = { account: ACC, zone: 'UTC', locale };
    const m = await wtool(env, 'monitor_create').run({ watch: 'due', type: 'assignment', id: '1' }, ctx);
    assert.equal(m.about, about, locale);
    assert.ok((await wtool(env, 'monitor_create').summarize({ watch: 'due', type: 'assignment', id: '1' }, ctx)).includes(about), locale);
    assert.equal((await wtool(env, 'wakes_list').run({}, ctx)).items.find((x) => x.id === m.id).about, about, `${locale}: listed`);
  }
  // Every sentence the tools say has its translation in each language's table.
  for (const l of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    const table = (require(`../../extension/i18n/${l}.js`), globalThis.GZ_LANGS[l]);
    for (const key of W.WORDS) assert.ok(Object.hasOwn(table, key), `${l}: ${key}`);
  }
});

test('a fired wake or monitor is a turn of its own: a fired block before the question, the earlier turns unchanged', () => {
  const fired = { what: 'monitor', watch: 'grade', say: 'Tell me my new grade', at: NOW - 600e3, fact: { course: 'MATH 1350', was: 83.5, percent: 85.2 } };
  const inp = A.task.input({ question: 'Tell me my new grade', fired, tools: ['grades_list', 'course_grades', 'wakes_list'], now: NOW, zone: ZONE });
  assert.ok(inp);
  assert.equal(inp.fired, '{"what":"monitor","watch":"grade","at":"2026-10-30 13:55","fact":{"course":"MATH 1350","was":83.5,"percent":85.2}}');
  const text = A.layout(inp).map((p) => p.special ?? p.text).join('');
  assert.match(text, /<\|im_start\|>user\n<\|gz_ctx\|>now\n[^<]+<\|\/gz_ctx\|>\n<\|gz_data\|>fired\n\{"what":"monitor"[^<]+<\|\/gz_data\|>\n<\|gz_data\|>question\nTell me my new grade<\|\/gz_data\|><\|im_end\|>/);
  // build()'s request reads back to the same turns.
  const req = require('../../extension/ai/request.js').clean({ ...A.task.build(inp, { text: require('../../extension/ai/text.js') }), schema: A.OUTPUT, task: { id: 'agent.tools', version: 1 } });
  assert.deepEqual(A.fromRequest(req).parts, A.layout(inp));
  // Without fired, nothing changes: the same request and turns as before.
  const plain = A.task.input({ question: 'Tell me my new grade', tools: ['grades_list'], now: NOW, zone: ZONE });
  assert.equal(plain.fired, undefined);
  assert.doesNotMatch(A.layout(plain).map((p) => p.special ?? p.text).join(''), /fired/);
  // The fired record grounds the answer as a result does; a made-up number is still refused.
  assert.equal(A.why({ call: null, answer: { text: 'MATH 1350 is at 85.2% now, up from 83.5%.', quotes: ['MATH 1350'] } }, inp), '');
  assert.equal(A.why({ call: null, answer: { text: 'MATH 1350 is at 91% now.', quotes: [] } }, inp), 'number');
  // Only a fired record's own shape is taken.
  for (const bad of [{ ...fired, what: 'nag' }, { ...fired, extra: 1 }, { ...fired, say: '' }, { ...fired, at: 'soon' }, { what: 'wake', say: 'x' }]) {
    assert.equal(A.task.input({ question: 'x', fired: bad, tools: ['grades_list'], now: NOW, zone: ZONE }), null, JSON.stringify(bad));
  }
  const wake = A.task.input({ question: 'Finish the lab', fired: { what: 'wake', say: 'Finish the lab', at: NOW }, tools: ['todo_list'], now: NOW, zone: ZONE });
  assert.equal(wake.fired, '{"what":"wake","at":"2026-10-30 14:05"}');
});
