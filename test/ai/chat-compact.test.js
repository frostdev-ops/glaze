// chat.compact (ai/tasks/chat-compact.js): an Ask Rime chat's older turns, and the summary before them, folded into a few
// markdown bullets of what the student and Rime settled. Its check holds every bullet to values the turns hold; a summary
// that fails it falls back to a deterministic one (the older questions and the items their answers named).
const test = require('node:test');
const assert = require('node:assert/strict');
const CC = require('../../extension/ai/tasks/chat-compact.js');
const X = require('../../extension/ai/text.js');

const TURNS = [
  { question: "What's due this week?", answer: 'You have three things due Monday, none handed in yet:\n- **Reflection Week 11** (ENG1001): Monday, November 2, 11:59 PM, not submitted\n- **Lab 8 worksheet** (BIO1010): Monday, November 2, 11:59 PM, not submitted' },
  { question: 'Remind me Monday at 6 pm about the lab', answer: 'I will remind you Monday, November 2, 6:00 PM: Lab 8 worksheet.' },
  { question: 'What does the BIO1010 syllabus say about late labs?', answer: 'Late labs lose 10% a day.' },
];
const inputOf = (more = {}) => CC.task.input({ turns: TURNS, locale: 'en', ...more });

test('input: one to six turns, each cut; an earlier summary; a language', () => {
  const inp = inputOf({ summary: '- Asked about grades in ENG1001.' });
  assert.equal(inp.turns.length, 3);
  assert.equal(inp.summary, '- Asked about grades in ENG1001.');
  assert.equal(CC.task.input({ turns: [], locale: 'en' }), null);
  assert.equal(CC.task.input({ turns: Array(7).fill(TURNS[0]), locale: 'en' }), null);
  assert.ok(CC.task.input({ turns: [{ question: 'q', answer: 'a'.repeat(5000) }], locale: 'en' }).turns[0].answer.length <= CC.LIMIT.answer);
});

test('build: the turns and the summary are data; the system asks for at most six bullets in the student\'s language', () => {
  const req = CC.task.build(inputOf({ locale: 'de' }), { text: X });
  const all = JSON.stringify(req);
  assert.match(all, /Student: What's due this week\?/);
  assert.match(all, /at most six/);
  assert.match(all, /Reply in German/);
});

test('check: every bullet rests on values the turns hold; no new numbers; bullets only, at most six', () => {
  const inp = inputOf();
  const good = { text: '- Due Monday, November 2, 11:59 PM, not handed in: **Reflection Week 11** (ENG1001), **Lab 8 worksheet** (BIO1010).\n- Reminder set for Monday, November 2, 6:00 PM: Lab 8 worksheet.\n- BIO1010 late labs lose 10% a day.',
    quotes: ['Reflection Week 11', 'Lab 8 worksheet', 'Monday, November 2, 11:59 PM', 'Monday, November 2, 6:00 PM', 'Late labs lose 10% a day'] };
  assert.equal(CC.why(good, inp), '');
  assert.equal(CC.why({ ...good, quotes: [...good.quotes, 'Essay 2'] }, inp), 'quote', 'a value no turn holds');
  assert.equal(CC.why({ text: `${good.text}\n- Something else entirely.`, quotes: good.quotes }, inp), 'ground', 'a bullet with no quoted value');
  assert.equal(CC.why({ text: good.text.replace('10%', '15%'), quotes: good.quotes }, inp), 'number');
  assert.equal(CC.why({ text: 'Due Monday: Reflection Week 11.', quotes: ['Reflection Week 11'] }, inp), 'format');
  assert.equal(CC.why({ text: Array(7).fill('- Reflection Week 11').join('\n'), quotes: ['Reflection Week 11'] }, inp), 'format');
  assert.deepEqual(CC.task.check(good, inp), { text: good.text, quotes: good.quotes });
  assert.equal(CC.task.check({ ...good, quotes: ['Essay 2'] }, inp), null);
});

test('fallback: the older questions and the items their answers named, newest kept within the bounds', () => {
  const f = CC.fallback(inputOf({ summary: '- Asked about grades in ENG1001.' }));
  assert.equal(f.text.split('\n')[0], '- Asked about grades in ENG1001.');
  assert.match(f.text, /- Asked: What's due this week\?/);
  assert.match(f.text, /- Reflection Week 11 \(ENG1001\): Monday, November 2, 11:59 PM/);
  assert.ok(f.text.split('\n').every((l) => l.startsWith('- ')));
  assert.ok(f.text.split('\n').length <= CC.LIMIT.lines && f.text.length <= CC.LIMIT.summary);
  assert.equal(CC.why(f, inputOf({ summary: '- Asked about grades in ENG1001.' })), '', 'the fallback passes the check itself');
});
