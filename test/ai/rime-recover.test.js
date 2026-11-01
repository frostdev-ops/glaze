// When Rime's answer fails its check (the owner's live Ultra, 2026-11-01: "Which assignments are coming up?" read the
// assignments and the schedule, then "Rime couldn't answer that"): the failure says why (the check's code in Activity and
// the error, the raw answer to the panel only), a run that read results retries once with a corrective turn naming the
// rule, and if that fails too Glaze writes the list from the results itself (MARKDOWN.md's format, no model). The error
// stays only when there is nothing to show.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../extension/ai/task.js');
const X = require('../../extension/ai/text.js');
const F = require('../../extension/ai/failure.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const K = require('../../extension/ai/ask.js');
require('../../extension/ai/providers/mock.js');

const ZONE = 'America/New_York';
const SUNDAY = Date.parse('2026-11-01T15:00:00-05:00'), MONDAY = Date.parse('2026-11-02T23:59:00-05:00'), FRIDAY = Date.parse('2026-10-30T23:59:00-04:00');
const ACC = 'https://bb.example.edu/_42_1';
// The owner's shape: three ENG 1100 items due Monday 11:59 PM not handed in, two past ones handed in.
const ITEMS = [
  ...['Reflection Week 11', 'Narrative Draft 2', 'Peer Review 3'].map((title, i) => ({ id: `_${21 + i}_1`, type: 'assignment', courseId: '_101_1', course: 'ENG 1100', title, due: MONDAY, url: '', done: false, submitted: false, graded: false, late: false, missing: false, marked: null, complete: false })),
  ...['Reflection Week 10', 'Narrative Example'].map((title, i) => ({ id: `_${11 + i}_1`, type: 'assignment', courseId: '_101_1', course: 'ENG 1100', title, due: FRIDAY, url: '', done: false, submitted: true, graded: false, late: false, missing: false, marked: null, complete: true })),
];
const SCHEDULE = { account: ACC, at: SUNDAY - 3600e3, covers: { from: SUNDAY - 7 * 864e5, to: SUNDAY + 7 * 864e5, complete: true }, items: ITEMS };
const STEP = { call: { name: 'schedule_list', arguments: { from: '2026-11-01', to: '2026-11-08' } }, result: SCHEDULE };
const inputOf = (more = {}) => A.task.input({ question: 'Which assignments are coming up?', tools: ['assignments_list', 'schedule_list', 'todo_list', 'accounts_list'], steps: [STEP], now: SUNDAY, zone: ZONE, locale: 'en', first: true, ...more });
// Typical bad answers from an untrained model.
const BAD = {
  prose: { call: null, answer: { text: 'You have a few assignments coming up this week in your English class.', quotes: [] } },
  nodate: { call: null, answer: { text: 'Reflection Week 11, Narrative Draft 2 and Peer Review 3 are coming up.', quotes: ['Reflection Week 11'] } },
  nothing: { call: null, answer: { text: 'Nothing is due this week.', quotes: [] } },
};

test('a check failure says which rule: the task\'s why travels on the error and into Activity, the raw answer only on the error', async () => {
  assert.equal(A.why(BAD.prose, inputOf()), 'ground');
  assert.equal(A.why(BAD.nothing, inputOf()), 'missed');
  const err = await T.run(A.task, { question: 'Which assignments are coming up?', tools: ['schedule_list', 'accounts_list'], steps: [STEP], now: SUNDAY, zone: ZONE, locale: 'en', first: true },
    { provider: 'mock', cfg: { replies: [{ json: BAD.prose }] } }).catch((e) => e);
  assert.equal(err.code, 'check');
  assert.equal(err.why, 'ground');
  assert.match(err.raw, /a few assignments coming up/);
  assert.deepEqual(F.diagnostic(err).why, 'ground');
  const rows = [];
  await F.record({ get: async () => ({ aiCalls: rows.slice() }), set: async (v) => { rows.splice(0, rows.length, ...v.aiCalls); } }, 'aiCalls', { id: 'r1', task: 'agent.tools', state: 'check', why: 'ground', toolSteps: 1, raw: 'never stored', model: 'r5' });
  assert.deepEqual(rows[0], { id: 'r1', task: 'agent.tools', state: 'check', toolSteps: 1, model: 'r5', why: 'ground' }, 'Activity keeps the code, never the answer');
});

test('the corrective turn: a check block after the results naming the broken rule, in the trained format; build() and fromRequest() keep it; level 1 has none', () => {
  const inp = inputOf({ fix: 'ground' });
  assert.equal(inp.fix, 'ground');
  const text = A.layout(inp).map((p) => p.special ?? p.text).join('');
  assert.match(text, /<\/tool_response><\|im_end\|>\n<\|im_start\|>user\n<\|gz_data\|>check\n[^<]*quote[^<]*<\|\/gz_data\|><\|im_end\|>\n<\|im_start\|>assistant\n$/);
  const req = require('../../extension/ai/request.js').clean({ ...A.task.build(inp, { text: X }), schema: A.OUTPUT, task: { id: 'agent.tools', version: 1 } });
  assert.equal(A.fromRequest(req).parts.map((p) => p.special ?? p.text).join(''), text);
  assert.equal(A.task.input({ question: 'q?', tools: ['schedule_list'], steps: [STEP], now: SUNDAY, zone: ZONE, locale: 'en', fix: 'ground' }), null, 'level 3 only');
  assert.equal(inputOf({ fix: 'tool' }), null, 'only an answer\'s rules');
  for (const code of A.FIXES) assert.ok(typeof A.FIX[code] === 'string' && A.FIX[code].length < 200);
});

test('Glaze\'s own list from the results: a lead sentence and one bullet per item, friendly dates and status, in the student\'s language; nothing to list gives null', () => {
  const en = A.listAnswer(inputOf().steps, { locale: 'en' });
  assert.match(en, /^[^\n]+\n- \*\*Reflection Week 11\*\* \(ENG 1100\): Monday, November 2, 11:59 PM, not submitted\n/);
  assert.match(en, /- \*\*Reflection Week 10\*\* \(ENG 1100\): Friday, October 30, 11:59 PM, submitted/);
  assert.ok(en.split('\n').filter((l) => l.startsWith('- ')).length === 5);
  assert.match(A.listAnswer(inputOf({ locale: 'de' }).steps, { locale: 'de' }), /- \*\*Reflection Week 11\*\* \(ENG 1100\): Montag, 2\. November, 23:59, nicht abgegeben/);
  assert.equal(A.listAnswer([], { locale: 'en' }), null);
  assert.equal(A.listAnswer([{ call: STEP.call, result: '{"account":"x","items":[]}' }], { locale: 'en' }), null);
});

test('the fallback keeps distinct same-title assignments, deduplicating only the same item in the same account and course', () => {
  const step = (account, items) => ({ call: { name: 'assignments_list', arguments: {} }, result: JSON.stringify({ account, items }) });
  const item = { assignment: '_21_1', type: 'assignment', courseId: '_101_1', course: 'ENG 1100', title: 'Homework 1' };
  const text = A.listAnswer([
    step(ACC, [item, { ...item, assignment: '_22_1' }, { ...item, courseId: '_102_1', course: 'BIO 1100' }]),
    step(ACC, [item]),
    step('https://bb.example.edu/_43_1', [item]),
  ]);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 4);
  assert.match(text, /\*\*Homework 1\*\* \(BIO 1100\)/);
});

// ---- the step loop: the stub model's bad answer, then each recovery path -------------------------------------------------
// outs: each agent.tools run's answer in order: an output, or { why, raw } for a check failure.
const loop = async (outs) => {
  const seen = [];
  const R = require('../../extension/ai/request.js');
  const run = async (task, input) => {
    seen.push(input);
    const next = outs[seen.length - 1];
    if (!next || next.why) throw Object.assign(R.error('check'), next ? { why: next.why, raw: next.raw } : {});
    return next;
  };
  const r = await K.episode({ question: 'Which assignments are coming up?', tools: ['schedule_list', 'accounts_list'], locale: 'en', now: SUNDAY, zone: ZONE, run,
    call: async () => ({ result: SCHEDULE }), first: true }).catch((e) => e);
  return { r, seen };
};
const call = { call: { name: 'schedule_list', arguments: { from: '2026-11-01', to: '2026-11-08' }, kind: 'read' }, answer: null };

test('a run that read results and then fails its check retries once with the corrective turn; the retry\'s answer shows', async () => {
  const { r, seen } = await loop([call, { why: 'ground', raw: JSON.stringify(BAD.prose) }, { call: null, answer: { text: 'Fixed.', quotes: [] } }]);
  assert.equal(seen.length, 3);
  assert.equal(seen[2].fix, 'ground');
  assert.equal(seen[2].steps.length, 1, 'the same results, then the check block');
  assert.deepEqual(r.answer, { text: 'Fixed.', quotes: [] });
});

test('when the retry fails too and the results hold a list, Glaze\'s own list is the answer; with nothing read, the error keeps its code and the raw answer', async () => {
  const { r } = await loop([call, { why: 'ground', raw: 'bad' }, { why: 'number', raw: JSON.stringify(BAD.nodate) }]);
  assert.equal(r.built, true, 'Glaze wrote it');
  assert.match(r.answer.text, /- \*\*Reflection Week 11\*\* \(ENG 1100\): Monday, November 2, 11:59 PM, not submitted/);
  const none = await loop([{ why: 'first', raw: JSON.stringify(BAD.prose) }]);
  assert.equal(none.r.code, 'check');
  assert.equal(none.r.why, 'first');
  assert.equal(none.r.steps, 0);
  assert.match(none.r.raw, /a few assignments/);
  assert.equal(none.seen.length, 1, 'no retry before anything was read');
});

test('the worker\'s error to the panel carries the code, the step count and the raw answer', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../extension/ai/ask.js'), 'utf8');
  assert.match(src, /type: 'error', error[^}]*why[^}]*steps[^}]*raw/);
});
