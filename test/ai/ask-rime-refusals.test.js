// Ask Rime's checks refuse only replies that would mislead the student (owner, 2026-11-05: "The model did everything
// right, we just error out for no reason"). Each case below is a correct R11 reply that 4.0.3 refused, next to the
// refusals that must stay: made-up items, wrong numbers, wording for the student's paper.
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/ai/task.js');
require('../../extension/ai/providers/mock.js');
const A = require('../../extension/ai/tasks/agent-tools.js');
const H = require('../../extension/ai/tasks/study-help.js');

const NOW = Date.parse('2026-11-05T17:21:00Z'), AT = Date.parse('2026-11-05T17:23:00Z'), ZONE = 'America/New_York';
const answer = (text, quotes = []) => ({ call: null, answer: { text, quotes } });
const wake = { call: { name: 'wake_create', arguments: { at: '2026-11-05T12:23', say: 'Start my math homework' } },
  result: { id: `w-${'1'.padStart(32, '0')}`, what: 'wake', at: AT, say: 'Start my math homework' } };
const tools = (question, steps, extra = ['wake_create', 'wakes_list', 'wake_cancel']) => A.task.input({ question, tools: extra, steps, now: NOW, zone: ZONE, locale: 'en', first: true });

test('a reminder Rime set is confirmed in its own words, with the time it was shown', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  assert.equal(inp.steps[0].result.includes('Thursday, November 5, 12:23 PM'), true, 'the time as the student reads it');
  const said = 'Done — I’ll remind you to start your math homework at Thursday, November 5, 12:23 PM.';
  assert.equal(A.why(answer(said, ['Thursday, November 5, 12:23 PM', 'Start my math homework']), inp), '', 'the owner\'s reply');
  assert.equal(A.why(answer('Done — reminder set.'), inp), '', 'a receipt needs no quote');
  assert.equal(A.why(answer('Reminder set for 12:23 PM: start your math homework.', ['Start my math homework']), inp), '');
  assert.equal(A.why(answer('Reminder set for 12:45 PM.', ['12:45 PM']), inp), 'quote', 'a time the result never held');
  assert.equal(A.why(answer('Reminder set for 12:45 PM.'), inp), 'number', 'still a number no result, question or clock holds');
});

test('a fact from a read is stated in the student\'s person: their "my" is Rime\'s "your"', () => {
  const todo = { call: { name: 'todo_list', arguments: {} }, result: { items: [{ title: 'Finish my essay draft', course: 'ENG 101', due: AT, submitted: false }] } };
  const inp = tools('what do I still have to do?', [todo], ['todo_list']);
  assert.ok(inp, 'input');
  assert.equal(A.why(answer('You still need to finish your essay draft for ENG 101.', ['Finish my essay draft', 'ENG 101']), inp), '');
  assert.equal(A.why(answer('You still need to finish your lab report.', ['Finish my lab report']), inp), 'ground', 'an item the read never held');
  assert.equal(A.why(answer('You still need to finish something.'), inp), 'ground', 'a read that holds facts is still quoted');
});

const help = (raw) => H.task.input({ subject: 'other', ...raw });
const concept = (reply) => ({ kind: 'concept', step: null, reply, followUp: null });
const memory = (text, evidence) => ({ records: [{ id: `m-${'1'.padStart(32, '0')}`, revision: 'a'.repeat(32), kind: 'memory', category: 'fact', text, source: { type: 'user-message', evidence } }], truncated: false });

test('study help may tell the student their own name, quoting what they said or saved', () => {
  const owner = 'Yes, you’re James. The note I can see says, “My name is James.”';
  assert.equal(H.why(concept(owner), help({ question: 'do you know my name', recall: memory('My name is James.', 'my name is james') })), '', 'quoting a saved note');
  assert.equal(H.why(concept(owner), help({ question: 'do you know my name', history: [{ question: 'my name is james', answer: 'Nice to meet you, James.' }] })), '', 'the period they never typed');
  assert.equal(H.why(concept('Yes, you’re James.'), help({ question: 'do you know my name', history: [{ question: 'My name is James', answer: 'Nice to meet you, James.' }] })), '', 'their capitalised name');
  assert.equal(H.why(concept('Nice to meet you, James! What are you working on?'), help({ question: 'My name is James' })), '', 'meeting them');
  assert.equal(H.why(concept('Encantado, Ana. ¿En qué trabajas?'), help({ question: 'Me llamo Ana', locale: 'es' })), '');
});

test('study help still refuses wording for the student\'s paper', () => {
  const thesis = 'Screens before bed hurt sleep because they keep the brain alert.';
  const inp = H.task.input({ question: `Is my thesis good? ${thesis}`, subject: 'essay' });
  assert.equal(H.why({ kind: 'hint', step: null, reply: 'Your thesis is stronger once it says "screens delay melatonin release" instead.', followUp: null }, inp), 'quote');
});

test('person matching cannot ground an invented item with a pronoun, a placeholder, or another locale', () => {
  const todo = { call: { name: 'todo_list', arguments: {} }, result: { items: [{ title: 'Finish my essay draft', course: 'ENG 101', due: AT, submitted: false }] } };
  const inp = tools('what do I still have to do?', [todo], ['todo_list']);
  assert.equal(A.why(answer('Your lab report is due.', ['my']), inp), 'ground');
  assert.equal(A.why(answer('Finish @ essay draft.', ['Finish my essay draft']), inp), 'ground');
  const other = { call: { name: 'todo_list', arguments: {} }, result: { items: [{ title: 'Intro to Tu Delft', submitted: false }] } };
  assert.equal(A.why(answer('Intro to My Delft', ['Intro to Tu Delft']), tools('What is due?', [other], ['todo_list'])), 'ground');
});

test('a reminder receipt does not support a new school due-date claim', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  assert.equal(A.why(answer('Done. Your chemistry lab report is due tomorrow.'), inp), 'ground');
  assert.equal(A.why(answer('Your chemistry lab report is due tomorrow.'), inp), 'ground');
});

test('saved memory does not make new wording for a paper quotable', () => {
  const quote = 'screens delay melatonin release';
  for (const subject of ['essay', 'other']) {
    const inp = help({ subject, question: 'Is my thesis good?', recall: memory(quote, quote) });
    assert.equal(H.why({ kind: 'hint', step: null, reply: `Your thesis is stronger once it says "${quote}" instead.`, followUp: null }, inp), 'quote', subject);
  }
});

test('introductions in assignment material remain coursework in all six locales', () => {
  for (const [locale, question, reply] of [
    ['en', 'My name is Daisy', 'The green light symbolizes Gatsby’s hope of winning Daisy back.'],
    ['es', 'Me llamo Daisy', 'La luz verde simboliza la esperanza de Gatsby de recuperar a Daisy.'],
    ['pt-BR', 'Me chamo Daisy', 'A luz verde simboliza a esperança de Gatsby de reconquistar Daisy.'],
    ['fr', 'Je m’appelle Daisy', 'La lumière verte symbolise l’espoir de Gatsby de reconquérir Daisy.'],
    ['de', 'Ich heiße Daisy', 'Das grüne Licht steht für Gatsbys Hoffnung, Daisy zurückzugewinnen.'],
    ['nl', 'Ik heet Daisy', 'Het groene licht staat voor de hoop van Gatsby om Daisy terug te winnen.'],
  ]) {
    const inp = help({ question, locale, subject: 'reading', material: `${question}. Gatsby Daisy` });
    assert.equal(H.why({ kind: 'hint', step: null, reply, followUp: null }, inp), 'speaks', locale);
  }
});

test('a reminder receipt cannot prove memory actions or unpunctuated school items', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  for (const text of ['Done. I saved your preference.', 'Done. I forgot your preference.', 'Done. Chemistry lab report due tomorrow.', 'Done. You have a biology discussion.']) {
    assert.equal(A.why(answer(text), inp), 'ground', text);
  }
});

test('ambiguous social questions cannot bypass coursework supplied as material', () => {
  const inp = help({ question: 'Who am I?', subject: 'reading', material: 'The Great Gatsby. The green light symbolizes Gatsby’s hope of winning Daisy back.' });
  assert.equal(H.why({ kind: 'hint', step: null, reply: 'The green light symbolizes Gatsby’s hope of winning Daisy back.', followUp: null }, inp), 'speaks');
});

test('saved memory cannot supply new paper wording in a follow-up turn', () => {
  const quote = 'screens delay melatonin release';
  const inp = help({ subject: 'other', question: 'Does this sound stronger?', history: [{ question: 'Help with my thesis', answer: 'What evidence do you have?' }], recall: memory(quote, quote) });
  assert.equal(H.why({ kind: 'hint', step: null, reply: `Your thesis is stronger once it says "${quote}" instead.`, followUp: null }, inp), 'quote');
});

test('a direct memory question can quote a preference while essay help is open', () => {
  const inp = help({ subject: 'essay', question: 'What study preference did I save?', recall: memory('I study best in the morning', 'I study best in the morning') });
  assert.equal(H.why(concept('Your note says “I study best in the morning.”'), inp), '');
});

test('personal introductions and matching possessives work in every supported locale', () => {
  for (const [locale, question, greeting, from, to] of [
    ['en', 'My name is Ana', 'Nice to meet you, Ana!', 'Finish my essay', 'Finish your essay'],
    ['es', 'Me llamo Ana', 'Encantado, Ana.', 'Terminar mi ensayo', 'Terminar tu ensayo'],
    ['pt-BR', 'Me chamo Ana', 'Prazer, Ana.', 'Terminar meu ensaio', 'Terminar seu ensaio'],
    ['fr', 'Je m’appelle Ana', 'Enchanté, Ana.', 'Finir mon essai', 'Finir ton essai'],
    ['de', 'Ich heiße Ana', 'Freut mich, Ana.', 'Mein Essay beenden', 'Dein Essay beenden'],
    ['nl', 'Ik heet Ana', 'Aangenaam, Ana.', 'Mijn essay afronden', 'Jouw essay afronden'],
  ]) {
    assert.equal(H.why(concept(greeting), help({ question, locale })), '', locale);
    const todo = { call: { name: 'todo_list', arguments: {} }, result: { items: [{ title: from, submitted: false }] } };
    const inp = A.task.input({ question: 'What is due?', tools: ['todo_list'], steps: [todo], now: NOW, zone: ZONE, locale, first: true });
    assert.equal(A.why(answer(to, [from]), inp), '', locale);
  }
});

test('a memory question cannot turn a saved phrase into thesis wording', () => {
  const quote = 'screens delay melatonin release';
  const inp = help({ subject: 'essay', question: 'What study preference did I save?', recall: memory(quote, quote) });
  assert.equal(H.why({ kind: 'hint', step: null, reply: `Your thesis is stronger once it says "${quote}" instead.`, followUp: null }, inp), 'quote');
});

test('direct Xcode Safari resources contain the same refusal checks', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  for (const name of ['agent-tools.js', 'study-help.js']) {
    const source = path.join(__dirname, '../../extension/ai/tasks', name);
    const safari = path.join(__dirname, '../../safari/Glaze/Glaze Extension/Resources/ai/tasks', name);
    assert.equal(fs.readFileSync(safari, 'utf8'), fs.readFileSync(source, 'utf8'), name);
  }
});

test('ambiguous identity questions with prior coursework or inverted punctuation stay in coursework', () => {
  const reply = 'The green light symbolizes Gatsby’s hope of winning Daisy back.';
  const out = { kind: 'hint', step: null, reply, followUp: null };
  const history = [{ question: 'My essay is about Gatsby and Daisy.', answer: 'What evidence supports your interpretation?' }];
  assert.equal(H.why(out, help({ question: 'Who am I?', subject: 'reading', history })), 'speaks');
  assert.equal(H.why(out, help({ question: '¿Quién soy?', locale: 'es', subject: 'reading', material: 'The green light symbolizes Gatsby’s hope of winning Daisy back.' })), 'speaks');
});

test('identity questions retain the coursework guard when the subject is other', () => {
  const history = [{ question: 'Help me with my essay about Gatsby and Daisy.', answer: 'What evidence supports your interpretation?' }];
  const inp = help({ question: 'Who am I?', subject: 'other', history });
  assert.equal(H.why({ kind: 'hint', step: null, reply: 'The green light symbolizes Gatsby’s hope of winning Daisy back.', followUp: null }, inp), 'speaks');
});

test('a confirmation alone cannot introduce a different school item', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  assert.equal(A.why(answer('Done. A biology project awaits you.'), inp), 'ground');
  assert.equal(A.why(answer('Done — I’ll remind you to start your math homework.'), inp), '');
});

test('a reminder cannot mask a coordinated invented school item', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  for (const text of ['Reminder set, and a biology project awaits you.', 'Reminder set and a biology project awaits you.']) assert.equal(A.why(answer(text), inp), 'ground');
});

test('a school assertion after an unpunctuated conjunction needs school evidence', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  assert.equal(A.why(answer('Reminder set and a biology project is on your list.'), inp), 'ground');
  assert.equal(A.why(answer('Reminder set and I’ll remind you to start your math homework.'), inp), '');
});

test('a reminder receipt may say when the reminder itself is due', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  assert.equal(A.why(answer('Your reminder is due at Thursday, November 5, 12:23 PM.'), inp), '');
});

test('a confirmation cannot hide an unrelated item after a conjunction', () => {
  const inp = tools('remind me to start my math homework in 2 minutes', [wake]);
  assert.equal(A.why(answer('Reminder set and a biology project appears on your list.'), inp), 'ground');
  const two = { ...wake, call: { ...wake.call, arguments: { ...wake.call.arguments, say: 'Start my math homework and finish my biology project' } }, result: { ...wake.result, say: 'Start my math homework and finish my biology project' } };
  const both = tools('remind me to start my math homework and finish my biology project in 2 minutes', [two]);
  assert.equal(A.why(answer('I’ll remind you to start your math homework and finish your biology project.'), both), '');
});
