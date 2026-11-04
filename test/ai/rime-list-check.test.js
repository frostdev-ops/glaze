// A due list must list each item once and say its count right (the 2026-11-04 evaluations: "five things" listing Problem
// Set 8 twice passed every check). agent.tools' check refuses it as 'list', the corrective turn names the rule, and when
// the retry fails too Glaze's own list from the results shows, each item once.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../extension/ai/request.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const K = require('../../extension/ai/ask.js');

const ZONE = 'America/New_York';
const NOW = Date.parse('2026-11-04T10:00:00-05:00'), FRIDAY = Date.parse('2026-11-06T23:59:00-05:00'), MONDAY = Date.parse('2026-11-09T23:59:00-05:00');
const ACC = 'https://bb.example.edu/_42_1';
const ITEMS = [
  ['Problem Set 8', 'MATH 110', FRIDAY], ['Lab Report 5', 'BIO 101', FRIDAY], ['Reading Response 9', 'ENG 1100', MONDAY], ['Discussion: Week 10', 'BIO 101', MONDAY],
].map(([title, course, due], i) => ({ id: `_${30 + i}_1`, type: 'assignment', courseId: `_${200 + i}_1`, course, title, due, url: '', done: false, submitted: false, graded: false, late: false, missing: false, marked: null, complete: false }));
const STEP = { call: { name: 'todo_list', arguments: {} }, result: { account: ACC, at: NOW - 60e3, covers: { from: NOW, to: NOW + 7 * 864e5, complete: true }, items: ITEMS } };
const inputOf = (more = {}) => A.task.input({ question: "What's due this week?", tools: ['todo_list', 'schedule_list', 'accounts_list'], steps: [STEP], now: NOW, zone: ZONE, locale: 'en', first: true, ...more });
const answer = (text) => ({ call: null, answer: { text, quotes: ['Problem Set 8'] } });
const lines = (titles) => titles.map((t) => `- **${t}**`).join('\n');

test('a list answer that repeats an item, or whose stated count is not the items listed, breaks the list rule', () => {
  const four = ['Problem Set 8', 'Lab Report 5', 'Reading Response 9', 'Discussion: Week 10'];
  for (const [text, rule] of [
    [`You have five things due this week:\n${lines(['Problem Set 8', 'Lab Report 5', 'Problem Set 8', 'Reading Response 9', 'Discussion: Week 10'])}`, 'list'],
    [`You have four things due this week:\n${lines(['Problem Set 8', 'Lab Report 5', 'Problem Set 8', 'Reading Response 9'])}`, 'list'],
    [`Due this week:\n- **Problem Set 8** (MATH 110): Friday\n- Lab Report 5 (BIO 101): Friday\n- **Problem Set 8** (MATH 110): Friday`, 'list'],
    [`Due this week:\n1. Problem Set 8: Friday\n2. Lab Report 5: Friday\n3. problem set 8: Friday`, 'list'],
    [`You have 5 assignments due this week:\n${lines(four)}`, 'list'],
    [`You have three things due:\n${lines(four)}`, 'list'],
    [`You have four things due this week:\n${lines(four)}`, ''],
    [`You have 4 assignments due:\n${lines(four)}`, ''],
    [`Here is what is due:\n${lines(four)}`, ''],
    [`Problem Set 8 is due Friday, and Lab Report 5 is due Friday too.`, ''],
  ]) assert.equal(A.why(answer(text), inputOf()), rule, text);
  assert.ok(A.FIXES.includes('list') && A.FIX.list.length < 200, 'a corrective turn names the rule');
  // The same title in two courses is two items; Glaze's list writes it with each course.
  const twin = { ...STEP, result: { ...STEP.result, items: [...ITEMS, { ...ITEMS[0], id: '_39_1', courseId: '_299_1', course: 'MATH 120' }] } };
  assert.equal(A.why(answer(`Two problem sets:\n- **Problem Set 8** (MATH 110)\n- **Problem Set 8** (MATH 120)`), inputOf({ steps: [twin] })), '');
});

test('in the step loop, a repeated item gets the corrective turn; a second failure shows Glaze\'s own list, each item once', async () => {
  const bad = { why: 'list', raw: '{}' };
  const call = { call: { name: 'todo_list', arguments: {}, kind: 'read' }, answer: null };
  const run1 = async (outs) => {
    const seen = [];
    const run = async (_task, input) => {
      seen.push(input);
      const next = outs[seen.length - 1];
      if (!next || next.why) throw Object.assign(R.error('check'), next ? { why: next.why, raw: next.raw } : {});
      return next;
    };
    const r = await K.episode({ question: "What's due this week?", tools: ['todo_list', 'accounts_list'], locale: 'en', now: NOW, zone: ZONE, run, call: async () => ({ result: STEP.result }), first: true }).catch((e) => e);
    return { r, seen };
  };
  const fixed = await run1([call, bad, answer('Fixed.')]);
  assert.equal(fixed.seen[2].fix, 'list');
  assert.equal(fixed.r.answer.text, 'Fixed.');
  const built = await run1([call, bad, bad]);
  assert.equal(built.r.built, true);
  const bullets = built.r.answer.text.split('\n').filter((l) => l.startsWith('- '));
  assert.equal(bullets.length, 4);
  assert.equal(bullets.filter((l) => l.includes('Problem Set 8')).length, 1);
});
