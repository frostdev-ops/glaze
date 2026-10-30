const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/ai/tasks/writer-complete.js');
const RV = require('../lib/ai/tasks/writer-review.js');
const FB = require('../lib/ai/tasks/writer-feedback.js');
const CT = require('../lib/ai/tasks/writer-cite.js');
const RQ = require('../lib/ai/tasks/writer-requirements.js');
const WT = require('../lib/writer-tools.js');

const before = 'The river carries what it';
test('completion stops at adjacent and Unicode sentence endings', () => {
  const inp = C.task.input({ before });
  for (const mark of ['.', '!', '?', '…', '。', '！', '？']) {
    assert.equal(C.finish(`it returns${mark}Zebras take over.`, inp), ` returns${mark}`, mark);
    assert.equal(C.finish(`it${mark}Zebras take over.`, inp), null, `new sentence ${mark}`);
  }
  assert.equal(C.fits('Three old words。 Then two'), false);
});

test('completion refuses invented single quotes, citations, links, numbers and an unfinished quotation', () => {
  const inp = C.task.input({ before });
  for (const reply of ["it becomes 'a novel quotation' here.", 'it becomes ‘a novel quotation’ here.',
    'it returns (Morrison).', 'it returns at example.org/path.', 'it contains 73 memories.']) {
    assert.equal(C.finish(reply, inp), null, reply);
  }
  // Closing a student's quotation must not supply words they did not quote.
  assert.equal(C.finish('the ticket," he writes.', C.task.input({ before: 'Baldwin calls history "the price of the' })), null);
  assert.equal(C.finish("it can't return.", inp), " can't return.", 'contractions are not quotes');
});

test('review cannot grow the replaced words or offer a fresh sentence in its message', () => {
  const inp = RV.task.input({ text: 'The clearing seem quiet.' });
  const issue = { quote: 'seem', before: 'The clearing', after: 'quiet', kind: 'grammar', message: 'Agreement.', suggestions: ['seems', 'becomes a haunted place'] };
  assert.deepEqual(RV.task.check({ issues: [issue] }, inp).issues[0].suggestions, ['seems']);
  assert.equal(RV.task.check({ issues: [{ ...issue, message: 'Try: The town conceals its violent history.' }] }, inp).issues[0].message, '');
});

test('feedback cannot return rewritten passages with different quote delimiters or no delimiters', () => {
  const inp = FB.task.input({ text: 'Memory is a debt.', context: { kind: 'assignment', assignment: { instructions: 'Discuss memory.' } } });
  for (const comment of ["Try 'Memory shackles every generation to the violence of the past.'", 'Rewrite: Memory shackles every generation to the violence of the past.',
    'Memory shackles every generation to the violence of the past.', 'Try "Debt wins".', 'Your draft needs a thesis. For example, memory imprisons the town.']) {
    const out = FB.task.check({ criteria: [{ criterion: 'Discuss memory', status: 'partly', comment, quotes: [], level: null }] }, inp);
    assert.equal(out.criteria[0].comment, '', comment);
  }
});

const citation = (date) => ({ type: 'webpage', title: 'A Study of Memory', authors: [], date,
  container: null, publisher: null, volume: null, issue: null, page: null, doi: null, isbn: null });
test('citation dates cannot use a day as the month or a word fragment as a month name', () => {
  const inp = CT.task.input({ text: 'A Study of Memory. Published 3 May 1985.' });
  const out = CT.task.check(citation({ year: 1985, month: 3, day: 3, quote: 'Published 3 May 1985' }), inp);
  assert.deepEqual(out.issued['date-parts'], [[1985]], 'May is not March');
  const other = CT.task.input({ text: 'A Study of Memory. Marching in 1985.' });
  assert.deepEqual(CT.task.check(citation({ year: 1985, month: 3, day: null, quote: 'Marching in 1985' }), other).issued['date-parts'], [[1985]]);
  const invalid = CT.task.input({ text: 'A Study of Memory. February 31, 1985.' });
  assert.deepEqual(CT.task.check(citation({ year: 1985, month: 2, day: 31, quote: 'February 31, 1985' }), invalid).issued['date-parts'], [[1985, 2]]);
});

test('requirements do not ground a count in a fragment of a spelled number or identifier', () => {
  for (const [prompt, x] of [['Write two hundred words.', 2], ['Write twenty two words.', 20], ['Write twenty two words.', 2], ['Read chapter250 before writing.', 250]]) {
    assert.equal(RQ.states(prompt, x), false, `${x}: ${prompt}`);
  }
  assert.equal(RQ.states('Write two hundred words and cite two sources.', 2), true);
});

test('editor read tools bound a single long paragraph', () => {
  const pages = WT.pages('x'.repeat(30000));
  assert.ok(pages.every((p) => p.length <= WT.LIMIT.page));
  assert.equal(pages.join(''), 'x'.repeat(30000));
});

test('feedback accepts only rubric criteria actually sent within the bounded context', () => {
  const W = require('../lib/ai/tasks/writer-context.js');
  const criteria = Array.from({ length: 50 }, (_, i) => ({ id: `row${i}`, label: `Criterion ${i}`, detail: 'x'.repeat(600),
    cells: Array.from({ length: 12 }, (_, j) => ({ level: `l${j}`, detail: 'y'.repeat(600) })) }));
  const r = W.rubric({ title: 'Rubric', criteria });
  assert.ok(r.text.length <= W.LIMIT.rubric);
  assert.ok(r.ids.length > 0 && r.ids.length < criteria.length);
  for (const { id, label } of r.ids) assert.ok(r.text.includes(`[${id}] ${label}`), id);
});

test('completion keeps quote types separate, and number words cannot match inside ordinary words', () => {
  assert.equal(C.task.input({ before: `The author writes "the 'river always` }), null);
  assert.equal(RQ.states('Discuss someone remembered in the novel.', 1), false);
});

test('review suggestions cannot smuggle citations, links or invented numbers into a short replacement', () => {
  const inp = RV.task.input({ text: 'The memory seems quiet.' });
  const issue = { quote: 'memory', before: 'The', after: 'seems', kind: 'grammar', message: 'Grammar.',
    suggestions: ['(Morrison)', 'example.org', '73', '"debt"', 'memories'] };
  for (const suggestion of issue.suggestions.slice(0, -1)) {
    assert.deepEqual(RV.task.check({ issues: [{ ...issue, suggestions: [suggestion, 'memories'] }] }, inp).issues[0].suggestions, ['memories'], suggestion);
  }
});

test('citation fields need whole tokens rather than fragments of names or numbers', () => {
  const inp = CT.task.input({ text: 'A Study of Memory. By James Baldwin. Published 1985.' });
  const out = CT.task.check({ ...citation({ year: null, month: null, day: null, quote: null }),
    authors: [{ given: 'Jam', family: 'Bald', literal: null }], volume: '19' }, inp);
  assert.deepEqual(out.author, []);
  assert.equal(out.volume, undefined);
});

test('review rejects same-length rewrites, single-quoted wording and sentences joined without spaces', () => {
  for (const [quote, suggestions, expected] of [
    ['Memory is a debt.', ['History is a prison.', 'Memory is a debt. Zebras win.'], []],
    ['memory', ["'debt'", 'the.Baldwin.claims.', 'memories'], ['memories']],
  ]) {
    const inp = RV.task.input({ text: quote });
    const out = RV.task.check({ issues: [{ quote, before: '', after: '', kind: 'style', message: 'Unclear wording.', suggestions }] }, inp);
    assert.deepEqual(out.issues[0].suggestions, expected);
  }
});
