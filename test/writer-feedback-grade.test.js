const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/ai/tasks/writer-feedback.js');
const T = require('../lib/ai/task.js');
require('../lib/ai/providers/mock.js');
const rubric = { levels: [{ id: 'strong', label: 'Strong' }, { id: 'developing', label: 'Developing' }], criteria: [
  { id: 'claim', label: 'Claim', points: 40, cells: [{ level: 'strong', value: 40 }, { level: 'developing', value: 20 }] },
  { id: 'evidence', label: 'Evidence', points: 60, cells: [{ level: 'strong', value: 60 }, { level: 'developing', value: 30 }] },
] };
const raw = () => ({ text: 'School gardens help students learn together.', grade: true, kind: 'assignment', context: {
  kind: 'assignment', assignment: { instructions: 'Explain the benefits of school gardens.', rubric,
    files: [{ name: 'Prompt.txt', text: 'Support the claim with two concrete examples.' }] },
} });
const reply = () => ({ criteria: [
  { criterion: 'claim', status: 'met', comment: 'Your claim clearly identifies the benefit.', quotes: [], level: 'Strong', score: 39 },
  { criterion: 'evidence', status: 'partly', comment: 'Your paper gives no concrete examples for the claim.', quotes: [], level: null, score: 35 },
], grade: { summary: 'Your paper states a clear claim but lacks the two examples required by the prompt.' } });

test('grade as is reads the supplied documents and derives its total from the rubric’s actual points', async () => {
  const cfg = { replies: [{ json: reply() }], seen: [] };
  const { output } = await T.run(F.task, raw(), { provider: 'mock', cfg });
  assert.deepEqual(output.grade, { earned: 75, total: 100, summary: reply().grade.summary, reason: null });
  assert.deepEqual(output.criteria[0].score, { earned: 40, total: 40 }, 'a named rubric level supplies its actual score');
  const [system, data] = cfg.seen[0].messages.map((m) => m.content[0].text);
  assert.match(system, /Grade this paper as is/);
  assert.ok(data.includes('Support the claim with two concrete examples.') && !system.includes('Support the claim'));
});

test('missing rubric rows, invalid scores and unknown grading scales cannot produce a misleading total', () => {
  const inp = F.task.input(raw());
  const partial = reply(); partial.criteria.pop();
  assert.equal(F.task.check(partial, inp).grade.earned, null);
  assert.match(F.task.check(partial, inp).grade.reason.key, /every rubric category/);
  const high = reply(); high.criteria[1].score = 1000;
  assert.equal(F.task.check(high, inp).grade.earned, null);
  assert.match(F.task.check(high, inp).grade.reason.key, /point limits/);
  const unread = raw(); unread.unreadFiles = ['Prompt.txt'];
  assert.equal(F.task.check(reply(), F.task.input(unread)).grade.earned, null, 'unread requirements cannot be graded as fully checked');
  assert.equal(F.task.check(reply(), F.task.input(unread)).grade.reason.vars.files, 'Prompt.txt');
  const vague = raw(); vague.context.assignment.rubric = 'Assess the quality of the argument.';
  const checked = F.task.check({ criteria: [], grade: { summary: 'Your paper states a claim but provides no examples.' } }, F.task.input(vague));
  assert.equal(checked.grade.total, null); assert.ok(checked.grade.summary);
  assert.match(checked.grade.reason.key, /grading scale/);
});

test('grading never invents prose, and ordinary compose feedback does not acquire a grade', () => {
  const offering = reply(); offering.grade.summary = 'You could write "Gardens unite schools and communities."';
  assert.ok(!F.task.check(offering, F.task.input(raw())).grade.summary.includes('Gardens unite'), 'unsafe summary falls back to the grounded criterion comments');
  const plain = raw(); delete plain.grade;
  const checked = F.task.check(reply(), F.task.input(plain));
  assert.ok(!('grade' in checked) && !('score' in checked.criteria[0]));
});

test('every unavailable score has a concrete reason, including missing explanations and unread images', () => {
  const noWhy = reply(); noWhy.grade.summary = ''; noWhy.criteria.forEach((c) => c.comment = '');
  const unexplained = F.task.check(noWhy, F.task.input(raw())).grade;
  assert.equal(unexplained.earned, null); assert.match(unexplained.reason.key, /did not explain/);
  const pictures = raw(); pictures.context.assignment.files.push({ name: 'Prompt.png', image: { mime: 'image/png', data: 'aGVsbG8=' } });
  const unseen = F.task.check(reply(), F.task.input(pictures), { caps: { images: false } }).grade;
  assert.equal(unseen.earned, null); assert.match(unseen.reason.key, /attached images/);
  const zero = raw(); zero.context.assignment.rubric.criteria.forEach((c) => { c.points = 0; c.cells.forEach((l) => l.value = 0); });
  const answer = reply(); answer.criteria.forEach((c) => { c.score = 0; c.level = 'Strong'; });
  assert.match(F.task.check(answer, F.task.input(zero)).grade.reason.key, /positive point total/);
});

test('custom headers and mixed formatting describe base settings without claiming uniform typography', () => {
  const input = raw(); input.mode = 'paper'; input.paper = { font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'custom', mixed: true };
  input.context.assignment.instructions += ' Use Times New Roman throughout.';
  const inp = F.task.input(input);
  assert.equal(inp.paper.header, 'custom'); assert.equal(inp.paper.mixed, true);
  assert.match(F.handIn(inp.paper), /base layout/);
  assert.match(F.handIn(inp.paper), /do not establish every passage/);
  assert.match(F.handIn(inp.paper), /contents are not supplied/);
  assert.equal(F.task.check(reply(), inp).grade.earned, null, 'unknown overrides cannot establish a uniform font requirement');
});

test('an unspecified custom header cannot establish an explicit header requirement', () => {
  const input = raw(); input.mode = 'paper'; input.paper = { font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'custom' };
  input.context.assignment.instructions += ' Include your last name in the header.';
  const inp = F.task.input(input);
  assert.equal(inp.paper.header, 'custom');
  assert.equal(F.task.check(reply(), inp).grade.earned, null);
});

test('explicit unresolved percent units never become point values in worker feedback', () => {
  const input = raw(); input.context.assignment.rubric = { kind: 'percent', levels: [{ id: 'high', label: 'High' }], criteria: [
    { id: 'claim', label: 'Claim', weight: 25, points: null, cells: [{ level: 'high', value: 100, percentage: 100 }] },
  ] };
  const clean = F.task.input(input).context.assignment;
  assert.equal(clean.criteria[0].points, null);
  assert.equal(clean.criteria[0].levels[0].value, null);
  assert.match(clean.rubric, /100%/);
  assert.ok(!clean.rubric.includes('100 points'));
  input.context.assignment.rubric.kind = 'percent-range';
  input.context.assignment.rubric.criteria[0].cells[0] = { level: 'high', value: null, percentageRange: { lo: 75, hi: 100, loExclusive: true } };
  const ranged = F.task.input(input).context.assignment;
  assert.equal(ranged.criteria[0].levels[0].value, null);
  assert.match(ranged.rubric, />75–100%/);
});
