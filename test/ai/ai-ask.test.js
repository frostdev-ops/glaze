// Ask Rime (ai/ask.js): the routing rule between study.help and agent.tools, the step loop over Agents' tools (six steps at
// most, the student's approval for the one write, a decline that stops), and the panel's port: model runs over the AI
// broker's own protocol (a stand-in broker here), tool calls through the real agents/calls.js with stand-in tools and
// approval window, and the study rule held on the agent path too.
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../../extension/ai/tools.js');
require('../../extension/ai/schema.js');
require('../../extension/ai/failure.js');
require('../../extension/ai/loop.js');
require('../../extension/agents/grants.js');
globalThis.GZ_MCP_CALLS = require('../../extension/agents/calls.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
require('../../extension/ai/tasks/study-help.js');
const K = require('../../extension/ai/ask.js');

// ---- the routing rule ---------------------------------------------------------------------------------------------------
const agent = (q, locale = 'en') => { const r = K.route(q, { locale }); assert.equal(r.task, 'agent.tools', `${locale}: ${q}`); return r.tools; };
const study = (q, subject, o = {}) => { const r = K.route(q, { locale: 'en', ...o }); assert.deepEqual(r, { task: 'study.help', subject }, q); };

test('route: the student\'s own records go to agent.tools with the tools their topic needs', () => {
  assert.deepEqual(agent('What do I have due this week?'), ['todo_list', 'schedule_list', 'accounts_list']);
  assert.deepEqual(agent('Mark Lab report 3 as done'), ['todo_list', 'schedule_list', 'todo_mark_done', 'accounts_list']);
  assert.deepEqual(agent('What are my grades?'), ['grades_list', 'course_grades', 'accounts_list']);
  assert.deepEqual(agent('Which Writer documents did I edit last?'), ['documents_list', 'document_read', 'document_assignment'], 'no account to choose for documents');
  assert.deepEqual(agent('What are the instructions for the lab report assignment?'), ['assignments_list', 'assignment_read', 'courses_list', 'accounts_list']);
  assert.deepEqual(agent('How many assignments are due this week?'), ['todo_list', 'schedule_list', 'assignments_list', 'assignment_read', 'courses_list', 'accounts_list'], '"how many" asks for records');
  const all = agent('Mark it done: my grades, my documents, what is due and the assignment rubric');
  assert.ok(all.length <= 6 && all.every((n) => A.NAMES.includes(n)), 'at most six, every one an agent.tools tool');
  assert.ok(all.includes('todo_mark_done'));
  const planning = 'Look at my assignments due this week, compare how hard they are, and tell me what should I do first based on that.';
  const expected = ['todo_list', 'schedule_list', 'assignments_list', 'assignment_read', 'courses_list', 'accounts_list'];
  for (const question of [planning, 'Which of my assignments is hardest, and which should I start first?',
    'Help me prioritize my assignments by deadline and workload.', 'How should I prioritize my assignments by difficulty?',
    'Compare my assignments by deadlines and required work.', 'Help me plan my assignments by deadline and workload.',
    'Help me schedule my assignments by deadline.', 'Help me compare the difficulty of my assignments.',
    'How should I prioritize my to-dos by deadline?', 'Help me prioritize my math assignments by deadline and workload.',
    'Help me prioritize my assignments based on how long it will take to do them.',
    'Compare my assignments by draft requirements and the time needed to complete them.',
    'Which assignment should I begin first, and why?', 'Which of my tasks should I tackle first, and why?',
    'Which assignment should I begin first,\r\nand why?',
    'Prioritize my assignments by deadlines, and why?',
    'Which assignment should I tackle first, and why? Keep the deadline window and exclusions I already gave you.']) {
    assert.deepEqual(K.route(question, { level: 3 }).tools, expected, question);
    assert.equal(K.route(question, { level: 3 }).task, 'agent.tools', question);
  }
  for (const question of ['Which assignment should I begin first, and why do cells divide?',
    'Prioritize my assignments, and why is this equation true?', 'Compare my assignments, and why? Then solve 2x + 3 = 7.',
    'Which assignment should I begin first in this proof, and why?', 'Which assignment should I tackle first, and why? Write my essay.',
    '"Which assignment should I begin first, and why?"']) assert.equal(K.route(question, { level: 3 }).task, 'study.help', question);
  assert.equal(K.route('Which assignment should I begin first, and why?', { level: 3, attempt: 'My next step is x = 4.' }).task, 'study.help');
  for (const current of [{ document: { id: 'draft' } }, { course: { id: '25' }, content: { id: '7' }, view: 'content' }]) {
    assert.deepEqual(K.route(planning, { level: 3, current }).tools, expected, 'incidental "that" keeps the planning readers within six tools');
  }
  for (const question of [planning, 'What is due this week?']) {
    const history = [{ question, answer: '[Glaze app status: request failed (check). No completed answer or verified tool results are carried in this history entry; tool activity may have occurred.]' }];
    assert.deepEqual(K.route('What should I do first?', { level: 3, history }).tools, expected, 'a records antecedent supports planning after an error');
    assert.deepEqual(K.route('Okay, what should I do first?', { level: 3, history }).tools, expected);
    assert.deepEqual(K.route('What should I begin first, and why?', { level: 3, history }).tools, expected);
    assert.deepEqual(K.route('What should I do first?', { level: 3, history: [...history,
      { question: 'What should I do first?', answer: 'Request failed.' }, { question: 'Are you sure?', answer: 'Request failed.' }] }).tools, expected);
  }
  const natural = [{ question: 'what i gotta do before tomorrow', answer: 'Request failed.' }];
  assert.ok(K.route(natural[0].question, { level: 3 }).tools.includes('schedule_list'));
  for (const question of ['which one should i start', 'which one should i begin?', 'nah i meant bio']) {
    assert.deepEqual(K.route(question, { level: 3, history: natural }).tools, expected, question);
  }
  const corrected = [...natural, { question: 'which one should i start', answer: 'Request failed.' },
    { question: 'nah i meant bio', answer: 'Request failed.' }];
  assert.deepEqual(K.route('ok what about next week', { level: 3, history: corrected }).tools, expected);
  for (const history of [
    [...corrected, { question: 'nah i meant debug my Python loop', answer: 'Show your attempt.' }],
    [{ question: '"Compare my assignments by difficulty."', answer: 'Request failed.' }, ...corrected.slice(1)],
  ]) assert.equal(K.route('ok what about next week', { level: 3, history }).task, 'study.help', 'a date follow-up cannot bypass work guards or quoted-only intent');
  for (const question of ['which one should i start', 'nah i meant bio', 'ok what about next week']) {
    if (!question.includes('next week')) assert.equal(K.route(question, { level: 3 }).task, 'study.help', 'no invented records antecedent');
    if (!question.includes('next week')) assert.equal(K.route(question, { level: 3, history: [{ question: 'Help me solve this equation.', answer: 'Try undoing addition.' }] }).task, 'study.help');
    if (!question.includes('next week')) assert.equal(K.route(question, { level: 3, history: [...natural, { question: 'Debug my Python loop.', answer: 'Show your attempt.' }] }).task, 'study.help');
    assert.equal(K.route(question, { level: 3, history: natural, attempt: 'My answer is x = 4.' }).task, 'study.help');
  }
  assert.equal(K.route('"which one should i start"', { level: 3, history: natural }).task, 'study.help');
  for (const question of ['nah i meant solve 2x = 8', 'nah i meant debug my Python loop'])
    assert.equal(K.route(question, { level: 3, history: natural }).task, 'study.help');
  assert.deepEqual(K.route('what i gotta do before tomorrow; debug my Python loop', { level: 3 }).task, 'study.help');
  assert.equal(K.route('what i gotta do before tomorrow; debug my Python loop', { level: 3 }).subject, 'code');
  assert.equal(K.route('When is my Debug Lab due?', { level: 3 }).task, 'agent.tools');
  assert.deepEqual(K.route("Compare my assignments by workload and tomorrow's deadline.", { level: 3,
    history: [...natural, { question: 'Exclude chapter notes.', answer: 'Okay.' },
      { question: 'nah i meant art history', answer: 'Okay.' }] }).tools, expected,
    'an independently explicit new planning request keeps its route across earlier generic filters');
  for (const question of ['not the outline, the report', 'report not outline', 'exclude chapter notes']) {
    assert.deepEqual(K.route(question, { level: 3, history: [...natural,
      { question: 'Just the report one. Not the outline', answer: 'Okay.' },
      { question: 'Skip reading notes and anything already turned in.', answer: 'Okay.' },
      { question: 'Leave gallery notes out.', answer: 'Okay.' },
      { question: 'nah i meant history', answer: 'Okay.' }] }).tools, expected,
    'record constraints and selection nouns do not become tutoring requests');
    assert.equal(K.route(question, { level: 3 }).task, 'study.help', 'record selection needs a prior anchor');
    assert.equal(K.route(question, { level: 3, history: [...natural,
      { question: 'Help me with my essay thesis.', answer: 'What is your claim?' }] }).task, 'study.help');
    assert.equal(K.route(question, { level: 3, history: natural, attempt: 'My answer is 4.' }).task, 'study.help');
  }
  for (const question of ['not the outline, write my report', 'skip reading notes and solve 2x = 8',
    'exclude chapter notes and debug my Python loop', 'not the equation the report', 'code not outline',
    'exclude notes and implement it', 'skip notes and finish it for me']) {
    assert.equal(K.route(question, { level: 3, history: natural }).task, 'study.help', question);
  }
  for (const question of ['the earlier one please', "i'm still lost", 'not those, the other set',
    'same deal but only the short ones', 'uh wait, the other class']) {
    assert.deepEqual(K.route(question, { level: 3, history: natural }).tools, expected, 'the model gets reads for unfamiliar contextual intent: ' + question);
    assert.deepEqual(K.route(question, { level: 3, history: [...natural,
      { question: 'not those, the other set', answer: 'Which set did you mean?' },
      { question: "i'm still lost", answer: 'We can check again.' }] }).tools, expected);
    assert.equal(K.route(question, { level: 3 }).task, 'study.help', 'no generic first-turn expansion');
    for (const previous of ['Help me solve this equation.', 'Debug my Python loop.', 'Write my essay.',
      'Do my homework.', '"What do I have due tomorrow?"', 'Mark Lab report 3 as done', 'What are my grades?',
      'Skip notes and mark Lab report 3 as done', 'Exclude chapter notes and show my grades']) {
      assert.equal(K.route(question, { level: 3, history: [...natural, { question: previous, answer: 'Request failed.' }] }).task,
        'study.help', 'a different substantive topic or untrusted anchor stops context inheritance');
    }
  }
  for (const question of ['"the earlier one please"', '> the earlier one please', '```text\nthe earlier one please\n```',
    'finish it for me', 'implement it', 'do my homework', '2x + 3 = 7', 'my essay thesis', 'photosynthesis']) {
    assert.equal(K.route(question, { level: 3, history: natural }).task, 'study.help', question);
  }
  assert.equal(K.route('the earlier one please', { level: 3, history: natural, attempt: 'My answer is x = 4.' }).task, 'study.help');
  const content = { site: 'ultra', view: 'content', course: { id: '_25_1' }, content: { id: '_7_1', kind: 'document' } };
  for (const question of ['Read the whole item and list the required materials and delivery format.', 'Read the full item and summarize its materials and later instructions.']) {
    const r = K.route(question, { level: 3, current: content });
    assert.equal(r.task, 'agent.tools'); assert.ok(r.tools.includes('content_read'), question);
  }
  for (const question of ['Find the course absence policy.', 'Who teaches Cedar Biology?', 'Get the instructor contact details for this course.']) {
    const r = K.route(question, { level: 3, current: content });
    assert.equal(r.task, 'agent.tools'); assert.ok(r.tools.includes('syllabus_read') && r.tools.includes('courses_list'), question);
    if (question.includes('absence')) assert.ok(r.tools.includes('content_list') && r.tools.includes('content_read'));
  }
  for (const [question, previous, required] of [
    ['Use the course from my previous question, not the page currently open, and get its instructor contact details.', 'Who teaches Cedar Biology?', 'syllabus_read'],
    ['The earlier lookup failed. Use a different read and keep my original filters.', 'Show only unsubmitted assignments for Cedar Biology, excluding quizzes and work already submitted.', 'todo_list'],
  ]) {
    const r = K.route(question, { level: 3, current: content, history: [{ question: previous, answer: 'No verified result was returned.' }] });
    assert.equal(r.task, 'agent.tools'); assert.ok(r.tools.includes(required), question);
  }
  const dates = K.route('List only work not submitted in this course from 2027-07-20T00:00:00Z through 2027-07-25T23:59:59Z. Keep those filters if the read needs recovery.', { level: 3, current: content });
  assert.equal(dates.task, 'agent.tools'); assert.ok(dates.tools.includes('schedule_list'));
});

test('route: in each of Glaze\'s languages, as the student\'s locale says', () => {
  assert.ok(agent('¿Qué tengo que entregar esta semana?', 'es').includes('todo_list'));
  assert.ok(agent('Quais são minhas notas?', 'pt-BR').includes('grades_list'));
  assert.ok(agent('Qu\'est-ce que j\'ai à rendre cette semaine ?', 'fr').includes('todo_list'));
  assert.ok(agent('Was ist diese Woche fällig?', 'de').includes('todo_list'));
  assert.ok(agent('Wat moet ik deze week inleveren?', 'nl').includes('todo_list'));
  assert.ok(agent('Welche Noten habe ich?', 'de').includes('grades_list'));
  assert.deepEqual(K.route('Wie löse ich 2x = 8?', { locale: 'de' }), { task: 'study.help', subject: 'math' });
  assert.deepEqual(K.route('¿Cómo resuelvo 2x = 8 para mañana?', { locale: 'es' }), { task: 'study.help', subject: 'math' });
  assert.deepEqual(K.route('Mes notes de cours sur la cellule', { locale: 'en' }).task, 'study.help', 'a French word counts only in French');
});

test('route: help with work goes to study.help, whatever records it mentions, with its subject', () => {
  study('How do I solve 3x + 5 = 20?', 'math');
  study('Can you explain photosynthesis for my test tomorrow?', 'science');
  study('Help me with my essay thesis', 'essay');
  study('Why does my for loop never stop? ```for (i = 0;;) {}```', 'code');
  study('What is the theme of chapter 3 of the novel?', 'reading');
  study('Tell me about the French Revolution', 'other');
  study('What is the answer to question 4 of my assignment due Friday?', 'other');
  study('What is due this week?', 'other', { attempt: 'I think the answer is 4' });
  for (const question of ['Prioritize my assignments and solve 2x + 3 = 7.', 'Compare my assignments and write my essay.',
    'Help me solve this equation, then prioritize my assignments.', 'Compare my assignments and draft the essay for me.',
    'Compare my assignments and finish them for me.', 'Explain the phrase "prioritize my assignments by deadline".',
    'How do I solve this equation? "Help me prioritize my assignments."',
    'How should I order the paragraphs in my assignments?', 'Help me compare the arguments in my assignments by difficulty.',
    'Help me prioritize my assignments, then implement my programming assignment.',
    'Help me prioritize my assignments and do my homework for me.',
    'Help me compare my assignments and "solve" this equation.',
    'Help me prioritize my assignments.\n```text\nsolve 2x + 3 = 7\n```',
    'Help me prioritize my assignments.\n> Write my essay for me.',
    'What should I do first in this equation?', 'Which task should I do first in this equation?',
    'Which assignment should I start first in this essay?']) assert.equal(K.route(question, { level: 3 }).task, 'study.help', question);
  for (const history of [undefined, [{ question: 'Help me solve this equation.', answer: 'Which operation could you undo?' }],
    [{ question: 'Help me with my essay thesis.', answer: 'Which claim will you support?' }],
    [{ question: '"Compare my assignments by difficulty."', answer: 'Request failed.' }],
    ...['What about solving this equation?', 'What about my essay thesis?', 'What about explaining the homework?'].map((question) =>
      [{ question: 'What is due this week?', answer: 'Request failed.' }, { question, answer: 'Request failed.' },
        { question: 'Are you sure?', answer: 'Request failed.' }])]) {
    assert.equal(K.route('What should I do first?', { level: 3, history }).task, 'study.help', 'ambiguous planning needs a records antecedent');
  }
  for (const question of ['What should I do first in this equation?', 'What should I do first? Write my essay.',
    'What should I do first? "Write my essay."', 'What should I do first? Explain this code.',
    'What should I do first?\n```text\nsolve 2x + 3 = 7\n```']) {
    assert.equal(K.route(question, { level: 3, history: [{ question: 'What is due this week?', answer: 'Request failed.' }] }).task,
      'study.help', 'an explicit new work request keeps tutoring priority');
  }
  assert.equal(K.route('Help me prioritize my assignments.', { level: 3, attempt: 'My answer is 4.' }).task, 'study.help', 'an attempt keeps tutoring priority');
  assert.equal(K.route('I am overwhelmed and lost track. Can you remind me what I just asked?', { level: 3 }).task, 'study.help');
  assert.ok(K.route('Remind me tomorrow at 9 to review what I just asked.', { level: 3 }).tools.includes('wake_create'), 'real future reminders remain available');
  assert.ok(K.route('Set a reminder for 2027-07-20 to review my notes. Can you remind me what I just asked?', { level: 3 }).tools.includes('wake_create'), 'a separate scheduled request survives conversational recall');
  assert.ok(K.route('At 10, can you remind me what I just asked?', { level: 3 }).tools.includes('wake_create'), 'a multi-digit scheduled time is not conversational recall');
  const current = { site: 'ultra', view: 'content', course: { id: '_25_1' }, content: { id: '_7_1', kind: 'document' } };
  for (const question of ['Read the full item and solve this equation.', 'Explain how to read the whole item.', '"Read the whole item and list its materials."',
    '"Find the course absence policy."', '"Who teaches Cedar Biology?"', '"Get the instructor contact details for Cedar Biology."']) {
    assert.equal(K.route(question, { level: 3, current }).task, 'study.help', question);
  }
  assert.equal(K.route('Read the whole item.', { level: 3, current, attempt: 'I think the answer is 4.' }).task, 'study.help');
  assert.equal(K.route('The earlier lookup failed. Use a different read and keep my original filters.', { level: 3,
    history: [{ question: 'Help me solve this equation.', answer: 'Which operation could you undo?' }] }).task, 'study.help');
});

// ---- the step loop --------------------------------------------------------------------------------------------------------
const TODO = { account: 'https://school.instructure.com/5', at: 1, items: [{ id: '1', type: 'assignment', courseId: '25', course: 'BIO 1100', title: 'Lab report', due: 2 }] };
const loop = ({ outs, results = {} } = {}) => {
  const runs = [], calls = [];
  const run = async (task, input) => { runs.push(structuredClone(input)); const o = outs[runs.length - 1]; if (!o) throw new Error('no more'); return typeof o === 'function' ? o(input) : o; };
  const call = async (c) => { calls.push(c); const r = results[c.name]; return typeof r === 'function' ? r(c) : r || { result: TODO }; };
  return { runs, calls, go: (o = {}) => K.episode({ question: 'What is due?', tools: ['todo_list', 'todo_mark_done'], locale: 'en', now: 1e12, zone: 'UTC', run, call, ...o }) };
};
const said = (text) => ({ call: null, answer: { text, quotes: [] } });
const asks = (name, args = {}, kind = 'read') => ({ call: { name, arguments: args, kind }, answer: null });

test('episode: an answer ends it; a read is run and appended, and the next run sees it', async () => {
  const one = loop({ outs: [said('Nothing is due.')] });
  assert.deepEqual(await one.go(), { answer: { text: 'Nothing is due.', quotes: [] }, steps: [] });
  assert.equal(one.runs.length, 1);
  const two = loop({ outs: [asks('todo_list', { days: 7 }), said('Lab report is due.')] });
  const r = await two.go();
  assert.equal(r.answer.text, 'Lab report is due.');
  assert.deepEqual(two.calls, [{ name: 'todo_list', arguments: { days: 7 }, kind: 'read' }]);
  assert.deepEqual(two.runs[1].steps, [{ call: { name: 'todo_list', arguments: { days: 7 } }, result: TODO }]);
  assert.deepEqual(two.runs[1].tools, ['todo_list', 'todo_mark_done']);
  const R = require('../../extension/ai/request.js');
  for (const error of ['timeout', 'connection-lost']) {
    let reads = 0;
    const retry = loop({ outs: [asks('todo_list'), asks('todo_list'), said('Lab report is due.')], results: { todo_list: () => {
      if (++reads === 1) return { result: { ok: false, error } };
      return { result: TODO };
    } } });
    const recovered = await retry.go();
    assert.equal(recovered.steps.length, 2);
    assert.equal(retry.runs[1].steps[0].result.ok, false, 'the model sees the failed read');
    assert.deepEqual(retry.calls[0], retry.calls[1]);
  }
  for (const result of [TODO, { ok: false, error: 'permission' }, { ok: false, error: 'Maybe a timeout?' }]) {
    const blocked = loop({ outs: [asks('todo_list'), asks('todo_list')], results: { todo_list: { result } } });
    assert.match((await blocked.go()).answer.text, /couldn't finish answering the full request/);
    assert.equal(blocked.calls.length, 1);
  }
  const exhausted = loop({ outs: [asks('todo_list'), asks('todo_list'), asks('todo_list')], results: { todo_list: { result: { ok: false, error: 'timeout' } } } });
  assert.match((await exhausted.go()).answer.text, /couldn't finish answering the full request/);
  assert.equal(exhausted.calls.length, 2);
  for (const error of ['timeout', 'connection-lost', 'permission', 'off', 'changed', 'cancelled', 'tool', 'request', 'refusal', 'invalid-response']) {
    const blocked = loop({ outs: [asks('todo_list')], results: { todo_list: () => { throw R.error(error); } } });
    await assert.rejects(blocked.go(), (e) => e.code === error);
    assert.equal(blocked.runs.length, 1, error);
  }
  const model = loop({ outs: [() => { throw R.error('timeout'); }] });
  await assert.rejects(model.go(), (e) => e.code === 'timeout');
  assert.equal(model.calls.length, 0, 'model errors are not tool receipts');
  const failedWrite = loop({ outs: [asks('todo_mark_done', {}, 'write')], results: { todo_mark_done: () => { throw R.error('timeout'); } } });
  await assert.rejects(failedWrite.go(), (e) => e.code === 'timeout');
});

test('episode: six steps at most, then a call ends it as steps', async () => {
  const many = loop({ outs: Array.from({ length: 10 }, (_, i) => asks('todo_list', { days: i + 1 })) });
  await assert.rejects(many.go(), (e) => e.code === 'steps');
  assert.equal(many.calls.length, A.LIMIT.steps);
  assert.equal(many.runs.length, A.LIMIT.steps + 1);
  assert.equal(A.LIMIT.steps, 6);
});

test('episode: a write waits for the student; a yes runs on, anything else ends it with no further run', async () => {
  const yes = loop({ outs: [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Marked Lab report done.')],
    results: { todo_mark_done: { result: { ok: true }, asked: 'yes' } } });
  assert.equal((await yes.go()).answer.text, 'Marked Lab report done.');
  assert.equal(yes.calls[1].kind, 'write');
  for (const asked of ['no', 'timeout', 'cancelled', 'interrupted', undefined]) {
    const no = loop({ outs: [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Done!')],
      results: { todo_mark_done: { result: { ok: false, error: 'The student declined in Glaze. Nothing was done.' }, asked } } });
    const r = await no.go();
    assert.equal(r.declined, asked || 'refused', String(asked));
    assert.equal(no.runs.length, 2, 'no run after the decline, so nothing can say it was done');
  }
});

test('episode: a cancel ends it', async () => {
  const ac = new AbortController();
  const l = loop({ outs: [() => { ac.abort(); return asks('todo_list'); }, said('x')] });
  await assert.rejects(l.go({ signal: ac.signal }), (e) => e.code === 'cancelled');
  assert.equal(l.calls.length, 0);
});

// ---- the panel's port -----------------------------------------------------------------------------------------------------
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await tick(); };
// A Chrome-like port pair: messages copied and delivered later; disconnect() tells the other end only.
const ports = () => {
  const side = () => ({ on: [], gone: [], closed: false });
  const a = side(), b = side();
  const end = (me, other) => ({
    postMessage: (m) => { if (me.closed) throw new Error('closed'); const c = structuredClone(m); setTimeout(() => { if (!other.closed) other.on.forEach((f) => f(c)); }, 0); },
    onMessage: { addListener: (f) => me.on.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) },
    disconnect: () => { if (me.closed) return; me.closed = true; setTimeout(() => { if (!other.closed) { other.closed = true; other.gone.forEach((f) => f()); } }, 0); },
    get closed() { return me.closed; },
  });
  return [end(a, b), end(b, a)];
};
// Stand-in tools, as Agents registers them (agents/tools-study.js's shape): a read and the one write.
const tools = () => {
  const reg = TL.registry(), wrote = [];
  reg.add({ name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-do list', description: 'To-dos', parameters: A.SPECS.find((s) => s.name === 'todo_list').parameters,
    run: async (args, ctx) => ({ account: ctx.account, at: 5, items: TODO.items, note: 'a tool may not set this', source: 'tab' }) });
  reg.add({ name: 'todo_mark_done', kind: 'write', group: 'courses', scope: 'account', title: 'Mark a to-do done', description: 'Mark', parameters: A.SPECS.find((s) => s.name === 'todo_mark_done').parameters,
    summarize: async (args) => `Mark item ${args.id} done.`, run: async (args) => { wrote.push(args); return { ok: true, marked: args.id }; } });
  reg.add({ name: 'grades_list', kind: 'read', group: 'grades', scope: 'account', title: 'Grades', description: 'Grades', parameters: A.SPECS.find((s) => s.name === 'grades_list').parameters,
    run: async () => ({ ok: false, error: 'Glaze has no grades yet.' }) });
  return { reg, wrote };
};
// The worker's side as background/background.js builds it, with a stand-in broker that answers runs from a script.
const harness = ({ script = {}, approve = 'yes', allowed = true, ai = { on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } } } = {}) => {
  const { reg, wrote } = tools();
  const seen = { runs: [], asks: [], statuses: 0 }, st = { ai };
  const broker = (port) => {
    port.onMessage.addListener(async (m) => {
      if (m.op === 'status') { seen.statuses++; return port.postMessage({ id: m.id, type: 'status', on: true, allowed: true, ready: true, provider: 'openai' }); }
      if (m.op === 'cancel') return;
      seen.runs.push(m);
      const list = script[m.task] || [];
      const next = list[seen.runs.filter((r) => r.task === m.task).length - 1];
      if (!next) return port.postMessage({ id: m.id, type: 'error', error: 'check' });
      if (next.error) return port.postMessage({ id: m.id, type: 'error', error: next.error });
      // events: what the broker forwards from the run before its end (the loop's thinking, the host's phases).
      for (const e of next.events || []) port.postMessage({ id: m.id, ...e });
      const output = next.events ? next.then : next;
      port.postMessage({ id: m.id, type: 'end', output: typeof output === 'function' ? await output(m.input) : output });
    });
  };
  const env = {
    allowed: async () => (typeof allowed === 'function' ? allowed() : allowed), broker, settings: async () => st.ai, enabled: async () => true,
    registry: { get: (name) => reg.get(name), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) }, state: async () => ({}),
    approve: { ask: async (kind, view, o) => { seen.asks.push({ kind, view }); o?.progress?.(1, undefined, 'Waiting'); return typeof approve === 'function' ? approve() : approve; } },
    refresh: async () => null, accounts: async () => [{ account: TODO.account }], local: {}, keys: async () => [], now: () => 1e12, turn: (f) => f(), zone: 'UTC',
  };
  const [page, worker] = ports();
  K.connect(worker, env);
  const got = [];
  page.onMessage.addListener((m) => got.push(m));
  return { page, got, seen, wrote, st, say: (m) => page.postMessage(m), ends: () => got.filter((m) => ['end', 'error'].includes(m.type)) };
};

test('port: a study question runs study.help through the broker, as the feature ask, with its subject and locale', async () => {
  const h = harness({ script: { 'study.help': [{ kind: 'hint', step: null, reply: 'What could you do to both sides?', followUp: null }] } });
  h.say({ id: 1, op: 'ask', question: 'How do I solve 3x + 5 = 20?', locale: 'de' });
  await settle();
  assert.deepEqual(h.seen.runs.map((r) => [r.op, r.feature, r.task, r.input]), [['run', 'ask', 'study.help', { question: 'How do I solve 3x + 5 = 20?', subject: 'math', locale: 'de' }]]);
  assert.deepEqual(h.got.map((m) => m.type), ['route', 'end']);
  assert.deepEqual(h.got[1], { id: 1, type: 'end', task: 'study.help', output: { kind: 'hint', step: null, reply: 'What could you do to both sides?', followUp: null } });
});

test('port: an agent question runs its steps through agents/calls.js; results as the tool gave them; the write waits for the student', async () => {
  const h = harness({ script: { 'agent.tools': [asks('todo_list', { days: 7 }), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Marked Lab report done.')] } });
  h.say({ id: 3, op: 'ask', question: 'Mark my Lab report done', locale: 'en' });
  await settle(60);
  assert.deepEqual(h.got.map((m) => m.type).filter((t) => t !== 'keepalive'), ['route', 'step', 'step', 'step', 'approve', 'step', 'end']);
  const steps = h.got.filter((m) => m.type === 'step').map((m) => m.step);
  assert.ok(steps.every((s, i) => i % 2 === 0 || (Number.isSafeInteger(s.ms) && s.ms >= 0)), 'a finished step says how long it took');
  assert.deepEqual(steps.map(({ ms: _, ...s }) => s), [{ n: 1, name: 'todo_list', kind: 'read', state: 'run' }, { n: 1, name: 'todo_list', kind: 'read', state: 'done' },
    { n: 2, name: 'todo_mark_done', kind: 'write', state: 'ask' }, { n: 2, name: 'todo_mark_done', kind: 'write', state: 'done' }]);
  assert.deepEqual(h.ends(), [{ id: 3, type: 'end', task: 'agent.tools', answer: { text: 'Marked Lab report done.' } }]);
  const [, second, third] = h.seen.runs;
  assert.deepEqual(second.input.steps[0].result, { account: TODO.account, at: 5, items: TODO.items }, 'the tool\'s own answer, as training saw it: none of the wrapper\'s note, source or age');
  assert.deepEqual(third.input.steps[1].result, { account: TODO.account, at: null, ok: true, marked: '1' });
  assert.equal(second.input.zone, 'UTC');
  assert.equal(second.input.now, 1e12);
  assert.deepEqual(h.seen.asks.map((a) => [a.kind, a.view.summary, a.view.app.name]), [['action', 'Mark item 1 done.', 'Ask Rime']]);
  assert.deepEqual(h.wrote, [{ type: 'assignment', id: '1' }], 'run once, after the yes');
});

test('port: a declined write runs nothing and asks the model nothing more', async () => {
  const h = harness({ approve: 'no', script: { 'agent.tools': [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Done!')] } });
  h.say({ id: 4, op: 'ask', question: 'Mark my Lab report done', locale: 'en' });
  await settle(60);
  assert.deepEqual(h.ends(), [{ id: 4, type: 'end', task: 'agent.tools', declined: true }]);
  assert.deepEqual(h.got.filter((m) => m.type === 'step').at(-1).step, { n: 2, name: 'todo_mark_done', kind: 'write', state: 'no' }, 'the card says it was not allowed');
  assert.deepEqual(h.wrote, []);
  assert.equal(h.seen.runs.length, 2);
});

test('port: a tool\'s failure is the model\'s to read; an answer that hands over work is refused on this path too', async () => {
  const h = harness({ script: { 'agent.tools': [asks('grades_list'), said('The answer is x = 5.')] } });
  h.say({ id: 5, op: 'ask', question: 'What are my grades?', locale: 'en' });
  await settle(60);
  assert.deepEqual(h.seen.runs[1].input.steps[0].result, { ok: false, error: 'Glaze has no grades yet.' });
  assert.equal(h.got.filter((m) => m.type === 'step').at(-1).step.state, 'fail', 'its card shows it failed');
  assert.deepEqual(h.ends(), [{ id: 5, type: 'error', error: 'check', why: 'hands', steps: 1 }]);
  let checks = 0;
  const sender = harness({ allowed: () => ++checks === 2 ? 'timeout' : true,
    script: { 'agent.tools': [asks('todo_list'), said('No verified records.')] } });
  sender.say({ id: 50, op: 'ask', question: 'What is due?' });
  await settle(60);
  assert.equal(sender.seen.runs.length, 1, 'a sender-port timeout is not a failed tool receipt');
  assert.deepEqual(sender.ends(), [{ id: 50, type: 'error', error: 'timeout' }]);
  for (const error of ['timeout', 'connection-lost']) for (const revoked of [false, true]) {
    let reads = 0, valid = true;
    const runs = [], got = [], [page, worker] = ports();
    const local = { get: async () => {
      if (++reads === 1) {
        if (revoked) valid = false;
        throw error === 'timeout' ? new DOMException('The read deadline elapsed.', 'TimeoutError') : require('../../extension/ai/request.js').error(error);
      }
      return {};
    } };
    const registry = TL.registry();
    const connected = K.connect(worker, {
      allowed: async () => true, settings: async () => ({ on: true, model: { use: 'openai', model: 'm' }, features: { ask: true } }), enabled: async () => true,
      level: async () => 3, current: async () => ({ valid: async () => valid }),
      registry: { get: (n) => registry.get(n), describe: (t) => ({ name: t.name, inputSchema: t.parameters }) },
      state: async () => ({}), approve: { ask: async () => assert.fail('reads need no approval') }, refresh: async () => null,
      accounts: async () => [], local, keys: async () => [], now: () => 1e12, turn: (f) => f(), zone: 'UTC',
      own: { writer: async () => false, wakes: { local, on: async () => true, now: () => 1e12 } },
      broker: (p) => p.onMessage.addListener((m) => {
        if (m.op !== 'run') return;
        runs.push(m.input);
        p.postMessage({ id: m.id, type: 'end', output: runs.length <= 2 ? asks('wakes_list') : said('No reminders.') });
      }),
    });
    page.onMessage.addListener((m) => got.push(m));
    try {
      page.postMessage({ id: 51, op: 'ask', question: 'List my reminders.' });
      await settle(80);
      if (revoked) {
        assert.equal(runs.length, 1, 'live identity is rechecked before a failed receipt reaches the model');
        assert.equal(got.at(-1)?.error, 'changed');
      } else {
        assert.equal(reads, 2, 'an actual allowlisted execution failure can retry once');
        assert.deepEqual(runs[1].steps[0].result, { ok: false, error });
        assert.equal(got.at(-1)?.type, 'end');
      }
    } finally { connected.close(); }
  }
});

test('port: Ask turned off, a sender refused, a second question while one runs, a cancel, a bad message', async () => {
  const off = harness({ script: { 'agent.tools': [(inp) => { off.st.ai = { ...off.st.ai, features: { ask: false } }; return asks('todo_list'); }, said('x')] } });
  off.say({ id: 6, op: 'ask', question: 'What is due this week?', locale: 'en' });
  await settle(60);
  assert.deepEqual(off.ends(), [{ id: 6, type: 'error', error: 'off' }]);

  const refused = harness({ allowed: false });
  refused.say({ id: 7, op: 'ask', question: 'What is due?', locale: 'en' });
  await settle();
  assert.equal(refused.page.closed, true, 'the port is closed');
  assert.deepEqual(refused.seen.runs, []);

  const busy = harness({ script: { 'study.help': [() => new Promise(() => {})] } });
  busy.say({ id: 8, op: 'ask', question: 'Explain mitosis', locale: 'en' });
  busy.say({ id: 9, op: 'ask', question: 'Explain meiosis', locale: 'en' });
  await settle();
  assert.deepEqual(busy.ends(), [{ id: 9, type: 'error', error: 'busy' }]);
  busy.say({ id: 8, op: 'cancel' });
  await settle();
  assert.deepEqual(busy.ends().at(-1), { id: 8, type: 'error', error: 'cancelled' });

  const bad = harness();
  for (const m of [{ id: 10, op: 'ask', question: '' }, { id: 11, op: 'ask', question: 'x'.repeat(2001) }, { id: 12, op: 'ask', question: 'Explain', attempt: 3 }, { id: 13, op: 'nope' }]) bad.say(m);
  await settle();
  assert.deepEqual(bad.ends().map((m) => [m.id, m.error]), [[10, 'request'], [11, 'size'], [12, 'request'], [13, 'request']]);
  bad.say({ id: 14, op: 'status' });
  await settle();
  assert.deepEqual(bad.got.at(-1), { id: 14, type: 'status', on: true, allowed: true, ready: true, provider: 'openai' });
});

test('an episode\'s seven runs fit agent.tools\' own rate: six questions a minute in a tab', () => {
  assert.deepEqual(A.task.rate, { perMinute: 6 * (A.LIMIT.steps + 1) });
  assert.equal(A.task.rate.supersede, undefined, 'a newer question never cancels a step in flight');
});


test('port: losing sender authority while the approval is open prevents the write', async () => {
  let permitted = true;
  const h = harness({ allowed: () => permitted, approve: () => { permitted = false; return 'yes'; },
    script: { 'agent.tools': [asks('todo_list'), asks('todo_mark_done', { type: 'assignment', id: '1' }, 'write'), said('Done.')] } });
  h.say({ id: 20, op: 'ask', question: 'Mark my Lab report done', locale: 'en' });
  await settle(60);
  assert.equal(h.seen.asks.length, 1, 'the sender was allowed when approval opened');
  assert.deepEqual(h.wrote, [], 'navigation or lost site access revokes the pending change');
  assert.equal(h.seen.runs.length, 2, 'no model run after losing authority');
  assert.equal(h.ends().at(-1)?.type, 'error');
});

test('route: mixed account topics always retain the account-discovery tool within the six-tool cap', () => {
  for (const question of ['What are my grades and assignments due this week?', 'Mark my assignment done and show my grades and documents']) {
    const names = agent(question);
    assert.ok(names.length <= K.LIMIT.tools);
    assert.ok(names.includes('accounts_list'), question);
    if (question.startsWith('Mark')) assert.ok(names.includes('todo_mark_done'));
  }
});

test('port: a sender check that never settles cannot hold later cancellation forever', async () => {
  let checks = 0;
  const h = harness({ allowed: () => ++checks === 2 ? new Promise(() => {}) : true,
    script: { 'study.help': [() => new Promise(() => {})] } });
  h.say({ id: 21, op: 'ask', question: 'Explain mitosis' });
  await settle();
  assert.equal(h.seen.runs.length, 1);
  h.say({ id: 22, op: 'status' });
  h.say({ id: 21, op: 'cancel' });
  const deadline = Date.now() + 6000;
  while (!h.ends().some((m) => m.id === 21) && Date.now() < deadline) await tick();
  assert.deepEqual(h.ends(), [{ id: 22, type: 'error', error: 'timeout' }, { id: 21, type: 'error', error: 'cancelled' }]);
});

test('port: a follow-up carries the conversation to study.help; never to agent.tools, whose trained turns hold none; a bad one is refused', async () => {
  const history = [{ question: 'Explain mitosis', answer: 'What happens to the chromosomes first?' }];
  const h = harness({ script: { 'study.help': [{ kind: 'hint', step: null, reply: 'Think about the second phase.', followUp: null }], 'agent.tools': [said('Nothing due.')] } });
  h.say({ id: 30, op: 'ask', question: 'And then what?', locale: 'en', history });
  await settle();
  assert.deepEqual(h.seen.runs[0].input.history, history);
  h.say({ id: 31, op: 'ask', question: 'What is due this week?', locale: 'en', history });
  await settle(60);
  assert.equal(h.seen.runs[1].task, 'agent.tools');
  assert.equal('history' in h.seen.runs[1].input, false);
  for (const [id, bad] of [[32, 'x'], [33, [{ question: 'a' }]], [34, Array(7).fill({ question: 'a', answer: 'b' })], [35, [{ question: 'a', answer: 'b'.repeat(2001) }]], [36, [{ question: 'a', answer: 'b', more: 1 }]]]) {
    h.say({ id, op: 'ask', question: 'Explain', history: bad });
  }
  await settle();
  assert.deepEqual(h.ends().filter((m) => m.id >= 32).map((m) => [m.id, m.error]), [[32, 'request'], [33, 'request'], [34, 'request'], [35, 'request'], [36, 'request']]);
});

// The 2026-11-04 evaluations: in a chat with history, "what did we talk about?" went to agent.tools as a follow-up of the
// records question before it; the model answered from the history without a tool, tool-first refused it, and no tool had run
// for a corrective turn. A question about this conversation is study.help's (its instructions answer chat metaquestions).
test('a question about the conversation itself routes to study.help, with or without history; record follow-ups still read', () => {
  const history = [{ question: "What's due this week?", answer: '- **Problem Set 8** (MATH 110): Friday, November 6, 11:59 PM, not submitted' }];
  for (const question of ['what did we talk about?', 'What did we talk about so far?', 'What have we discussed?', 'What did we just talk about?',
    'Summarize our conversation.', 'Can you summarize this chat?', 'What did I ask you earlier?', 'What was my first question?', 'What did you just say?',
    'What did you tell me before?', 'Recap our chat so far']) {
    for (const h of [undefined, history]) assert.equal(K.route(question, { level: 3, history: h }).task, 'study.help', `${h ? 'history' : 'fresh'}: ${question}`);
  }
  for (const [question, locale] of [['¿De qué hablamos?', 'es'], ['Sobre o que conversamos?', 'pt-BR'], ['De quoi avons-nous parlé ?', 'fr'],
    ['Worüber haben wir gesprochen?', 'de'], ['Waar hebben we het over gehad?', 'nl']]) {
    assert.equal(K.route(question, { level: 3, locale, history }).task, 'study.help', `${locale}: ${question}`);
  }
  // Not about this chat: a class's discussion, a records follow-up, a reminder.
  assert.equal(K.route('What did we talk about in class this week?', { level: 3, history }).task, 'agent.tools');
  assert.equal(K.route('What about next week?', { level: 3, history }).task, 'agent.tools');
  assert.ok(K.route('Remind me tomorrow at 9 what we talked about.', { level: 3, history }).tools?.includes('wake_create'));
});

test('port: the host\'s reading and thinking phases reach the panel as phase events; other thinking events stay in the worker', async () => {
  const reply = { kind: 'hint', step: null, reply: 'What could you do to both sides?', followUp: null };
  const h = harness({ script: { 'study.help': [{ events: [{ type: 'thinking', round: 0 }, { type: 'thinking', round: 0, phase: 'reading' }, { type: 'thinking', round: 0, phase: 'thinking' }, { type: 'thinking', round: 0, phase: 'x' }], then: reply }] } });
  h.say({ id: 1, op: 'ask', question: 'How do I solve 3x + 5 = 20?', locale: 'en' });
  await settle();
  assert.deepEqual(h.got.filter((m) => m.type !== 'keepalive'), [{ id: 1, type: 'route', task: 'study.help' }, { id: 1, type: 'phase', phase: 'reading' }, { id: 1, type: 'phase', phase: 'thinking' },
    { id: 1, type: 'end', task: 'study.help', output: reply }]);
});
