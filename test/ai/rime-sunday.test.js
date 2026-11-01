// The owner's live Sunday (2026-11-01, Ask Rime on their Ultra): "What's due this week?" answered from a backward window
// ("Nothing is due this week", with three unsubmitted items due Monday), pushback went to study help, and dates came out
// as raw ISO. At tools level 3 (first: true): the now block resolves the student's windows, results carry friendly
// localized dates, an answer that says nothing is due while results list unsubmitted work fails ('missed'), agent.tools
// gets the conversation and follow-ups route back to it, and the system text asks for MARKDOWN.md's format. Level 1 is
// byte-identical.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../extension/ai/tasks/agent-tools.js');
const K = require('../../extension/ai/ask.js');
const SH = require('../../extension/ai/tasks/study-help.js');
const ST = require('../../extension/agents/tools-study.js');
const C = require('../helpers/mcp-caches.cjs');

const ZONE = 'America/New_York';
const SUNDAY = Date.parse('2026-11-01T15:00:00-05:00');
const ACC = `${C.CANVAS}/5`;
// Friday's work handed in; Monday's three not yet; Thursday's past due and not handed in.
const PLAN = [
  C.planner({ id: 11, course: 25, name: 'ENG1001', title: 'Reflection Week 10', at: '2026-10-31T03:59:00Z', sub: { submitted: true } }),
  C.planner({ id: 12, course: 25, name: 'ENG1001', title: 'Narrative Example', at: '2026-10-30T17:59:00Z', sub: { submitted: true } }),
  C.planner({ id: 13, course: 26, name: 'PBHL1100', title: 'Behavior Change Project Step 4', at: '2026-10-31T03:59:00Z', sub: { submitted: true } }),
  C.planner({ id: 21, course: 25, name: 'ENG1001', title: 'Reflection Week 11', at: '2026-11-03T04:59:00Z' }),
  C.planner({ id: 22, course: 26, name: 'PBHL1100', title: 'Behavior Change Project Step 5', at: '2026-11-03T04:59:00Z' }),
  C.planner({ id: 23, course: 27, name: 'BIO1010', title: 'Lab 8 worksheet', at: '2026-11-03T04:59:00Z' }),
  C.planner({ id: 31, course: 27, name: 'BIO1010', title: 'Lab 7 worksheet', at: '2026-10-30T03:59:00Z', sub: { late: false, missing: true } }),
];
const store = async () => ({ todoCache: await C.canvasPlan('5', PLAN, SUNDAY - 60e3) });
const tool = (name) => ST.tools().find((t) => t.name === name);
const run = async (name, args) => tool(name).run(args, C.ctx(await store(), ACC, { now: () => SUNDAY }));
const inputOf = (question, steps = [], more = {}) => A.task.input({ question, tools: [...A.NAMES], steps, now: SUNDAY, zone: ZONE, locale: 'en', first: true, ...more });
const text = (parts) => parts.map((p) => p.special ?? p.text).join('');
const nowBlock = (inp) => /<\|gz_ctx\|>now\n([\s\S]*?)<\|\/gz_ctx\|>/.exec(text(A.layout(inp)))[1];

test('level 3: the now block gives the student\'s windows, resolved in their zone, from now forward', () => {
  assert.equal(nowBlock(inputOf("What's due this week?")), [
    '2026-11-01 15:00 (Sunday), America/New_York',
    'today 2026-11-01 (Sunday)',
    'tomorrow 2026-11-02 (Monday)',
    'this week 2026-11-01 to 2026-11-08',
    'this weekend 2026-11-01 to 2026-11-01',
    'next week 2026-11-09 to 2026-11-15',
    'due soon 2026-11-01 to 2026-11-08',
  ].join('\n'));
  // A Wednesday: this week runs to Sunday, this weekend is the coming one.
  const wed = Date.parse('2026-11-04T09:00:00-05:00');
  assert.match(nowBlock(inputOf('due soon?', [], { now: wed })), /this week 2026-11-04 to 2026-11-08\nthis weekend 2026-11-07 to 2026-11-08\nnext week 2026-11-09 to 2026-11-15\ndue soon 2026-11-04 to 2026-11-11/);
  // Level 1: as before.
  const one = A.task.input({ question: "What's due this week?", tools: [...A.NAMES], steps: [], now: SUNDAY, zone: ZONE, locale: 'en' });
  assert.equal(nowBlock(one), '2026-11-01 15:00 (Sunday), America/New_York');
});

test('level 3: dates in results are friendly and localized in the student\'s zone; level 1 keeps "YYYY-MM-DD HH:MM"', async () => {
  const r = await run('schedule_list', { from: '2026-11-01', to: '2026-11-08' });
  const step = { call: { name: 'schedule_list', arguments: { from: '2026-11-01', to: '2026-11-08' } }, result: r };
  const shown = inputOf("What's due this week?", [step]).steps[0].result;
  assert.match(shown, /"title":"Reflection Week 11"[^}]*"due":"Monday, November 2, 11:59 PM"/);
  assert.match(A.task.input({ question: 'Was ist fällig?', tools: [...A.NAMES], steps: [step], now: SUNDAY, zone: ZONE, locale: 'de', first: true }).steps[0].result, /"due":"Montag, 2\. November, 23:59"/);
  const one = A.task.input({ question: "What's due this week?", tools: [...A.NAMES], steps: [step], now: SUNDAY, zone: ZONE, locale: 'en' }).steps[0].result;
  assert.match(one, /"due":"2026-11-02 23:59"/);
});

test('the Sunday scenario: the week\'s window holds Monday\'s three unsubmitted items; "nothing is due" fails; a markdown list of them passes', async () => {
  const r = await run('schedule_list', { from: '2026-11-01', to: '2026-11-08' });
  assert.deepEqual(r.items.filter((i) => !i.submitted).map((i) => i.title).sort(), ['Behavior Change Project Step 5', 'Lab 8 worksheet', 'Reflection Week 11']);
  const todo = await run('todo_list', {});
  const late = todo.items.find((i) => i.title === 'Lab 7 worksheet');
  assert.equal(late.missing, true, 'past due and not handed in shows as missing');
  assert.equal(todo.items.find((i) => i.title === 'Reflection Week 10').submitted, true);
  const steps = [{ call: { name: 'schedule_list', arguments: { from: '2026-11-01', to: '2026-11-08' } }, result: r }];
  const inp = inputOf("What's due this week?", steps);
  const nothing = { call: null, answer: { text: 'Nothing is due this week.', quotes: [] } };
  assert.equal(A.why(nothing, inp), 'missed');
  const md = { call: null, answer: { text: [
    'You have three things due Monday, none handed in yet:',
    '- **Reflection Week 11** (ENG1001): Monday, November 2, 11:59 PM, not submitted',
    '- **Behavior Change Project Step 5** (PBHL1100): Monday, November 2, 11:59 PM, not submitted',
    '- **Lab 8 worksheet** (BIO1010): Monday, November 2, 11:59 PM, not submitted',
  ].join('\n'), quotes: ['Reflection Week 11', 'Behavior Change Project Step 5', 'Lab 8 worksheet', 'Monday, November 2, 11:59 PM'] } };
  assert.equal(A.why(md, inp), '');
  const material = inp.steps.map((s) => s.result).join('\n');
  assert.equal(SH.hands(md.answer.text, SH.task.input({ question: inp.question, subject: 'math', locale: 'en', material })), '');
});

test('level 3: the system text asks for MARKDOWN.md\'s answer format; level 1\'s is unchanged', () => {
  const sys = (inp) => /<\|im_start\|>system\n([\s\S]*?)<\|im_end\|>/.exec(text(A.layout(inp)))[1];
  const three = sys(inputOf('x?')), one = sys(A.task.input({ question: 'x?', tools: [...A.NAMES], steps: [], now: SUNDAY, zone: ZONE, locale: 'en' }));
  assert.ok(three.includes('- **title** (course): friendly date, status'), three);
  assert.ok(three.includes('the windows in now'), three);
  assert.ok(!one.includes('**title**') && one.includes(`${A.SYSTEM}\nReply in English.`));
});

test('level 3: agent.tools gets the conversation, bounded, as an earlier block; build() and fromRequest() keep it', () => {
  const history = [{ question: "What's due this week?", answer: 'Nothing is due this week.' }];
  const inp = inputOf("I don't think that's true.", [], { history });
  assert.deepEqual(inp.history, history);
  const t = text(A.layout(inp));
  assert.match(t, /<\|gz_data\|>earlier\nStudent: What's due this week\?\nRime: Nothing is due this week\.<\|\/gz_data\|>\n<\|gz_data\|>question\nI don't think that's true\./);
  const X = require('../../extension/ai/text.js');
  const req = require('../../extension/ai/request.js').clean({ ...A.task.build(inp, { text: X }), schema: A.OUTPUT, task: { id: 'agent.tools', version: 1 } });
  assert.equal(text(A.fromRequest(req).parts), t);
  // Bounded: at most three turns, each cut.
  const long = Array.from({ length: 6 }, (_, i) => ({ question: `q${i} ${'x'.repeat(900)}`, answer: `a${i} ${'y'.repeat(900)}` }));
  const b = inputOf('and next week?', [], { history: long });
  assert.equal(b.history.length, 3);
  assert.ok(b.history.every((h) => h.question.length <= 300 && h.answer.length <= 600));
  // Level 1 takes none.
  assert.equal(A.task.input({ question: 'x?', tools: [...A.NAMES], steps: [], now: SUNDAY, zone: ZONE, locale: 'en', history }), null);
});

test('level 3: pushback and follow-ups go back to agent.tools with the earlier question\'s tools, never study help', () => {
  const history = [{ question: "What's due this week?", answer: 'Nothing is due this week.' }];
  const due = K.route("What's due this week?", { locale: 'en', level: 3 });
  for (const q of ["I don't think that's true.", 'You missed something.', 'What about Monday?', 'And next week?', 'Are you sure?', "That's wrong, there are things due Monday"]) {
    const r = K.route(q, { locale: 'en', level: 3, history });
    assert.equal(r.task, 'agent.tools', q);
    assert.ok(due.tools.every((t) => r.tools.includes(t)), `${q}: ${JSON.stringify(r)}`);
  }
  for (const [locale, q] of [['es', 'No creo que sea verdad.'], ['pt-BR', 'Acho que isso não está certo.'], ['fr', "Je ne pense pas que ce soit vrai."], ['de', 'Das stimmt nicht.'], ['nl', 'Dat klopt niet.']]) {
    assert.equal(K.route(q, { locale, level: 3, history }).task, 'agent.tools', `${locale}: ${q}`);
  }
  // No conversation, or level 1: as before.
  assert.equal(K.route("I don't think that's true.", { locale: 'en', level: 3 }).task, 'study.help');
  assert.deepEqual(K.route("I don't think that's true.", { locale: 'en', level: 1, history }), K.route("I don't think that's true.", { locale: 'en', level: 1 }));
  // A new study question after a records answer stays study help.
  assert.equal(K.route('What is mitosis?', { locale: 'en', level: 3, history }).task, 'study.help');
});
