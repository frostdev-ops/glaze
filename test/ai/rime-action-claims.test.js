// A factual quote is not evidence that a UI navigation happened. Use the actual places tool for result shapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../extension/ai/tasks/agent-tools.js');
const P = require('../../extension/ai/agent/places.js');
const TOOL = (name) => P.tools().find((tool) => tool.name === name);
const PHRASES = {
  en: { question: 'Open my calendar', passive: 'The requested place was opened successfully.', active: "I have opened Calendar.", failure: 'I could not open Calendar. You can open Calendar from the menu.', manual: 'To open Calendar, click Calendar in the menu.', quote: 'The page title is “I opened Calendar”.' },
  es: { question: 'Abre mi calendario', passive: 'El lugar solicitado se abrió correctamente.', active: 'He abierto Calendar.', failure: 'No he abierto Calendar. Puedes abrir Calendar desde el menú.', manual: 'Para abrir Calendar, pulsa Calendar en el menú.', quote: 'El título es «He abierto Calendar».' },
  'pt-BR': { question: 'Abra meu calendário', passive: 'O local solicitado foi aberto com sucesso.', active: 'Eu abri Calendar.', failure: 'Não abri Calendar. Você pode abrir Calendar no menu.', manual: 'Para abrir Calendar, clique em Calendar no menu.', quote: 'O título é “Eu abri Calendar”.' },
  fr: { question: 'Ouvre mon calendrier', passive: 'L’emplacement demandé a été ouvert avec succès.', active: 'J’ai ouvert Calendar.', failure: 'Je n’ai pas ouvert Calendar. Tu peux ouvrir Calendar dans le menu.', manual: 'Pour ouvrir Calendar, clique sur Calendar dans le menu.', quote: 'Le titre est « J’ai ouvert Calendar ».' },
  de: { question: 'Öffne meinen Kalender', passive: 'Der gewünschte Ort wurde erfolgreich geöffnet.', active: 'Ich habe Calendar geöffnet.', failure: 'Ich habe Calendar nicht geöffnet. Du kannst Calendar im Menü öffnen.', manual: 'Um Calendar zu öffnen, klicke im Menü auf Calendar.', quote: 'Der Titel lautet „Ich habe Calendar geöffnet“.' },
  nl: { question: 'Open mijn kalender', passive: 'De gevraagde locatie is succesvol geopend.', active: 'Ik heb Calendar geopend.', failure: 'Ik heb Calendar niet geopend. Je kunt Calendar openen via het menu.', manual: 'Om Calendar te openen, klik je op Calendar in het menu.', quote: 'De titel is “Ik heb Calendar geopend”.' },
};
const fixture = async (locale, state = 'failed') => {
  const actions = [];
  const ctx = { page: { site: 'canvas', url: 'https://school.example.edu/' }, courses: async () => [], ui: { push: (action) => actions.push(action) } };
  const list = await TOOL('places_list').run({}, ctx);
  const steps = [{ call: { name: 'places_list', arguments: {} }, result: list }];
  if (state !== 'unperformed') steps.push({ call: { name: 'place_open', arguments: { place: 'my-calendar' } }, result: await TOOL('place_open').run({ place: 'my-calendar' }, ctx) });
  if (state === 'success') steps.push({ call: { name: 'place_open', arguments: { place: 'calendar' } }, result: await TOOL('place_open').run({ place: 'calendar' }, ctx) });
  const input = A.task.input({ question: PHRASES[locale].question, locale, now: 1793577600000, zone: 'UTC', first: true, tools: ['places_list', 'place_open'], steps });
  assert.ok(input);
  return { input, steps, actions };
};
const answer = (value) => ({ call: null, answer: { text: `${value} Calendar`, quotes: ['Calendar'] } });
for (const [locale, words] of Object.entries(PHRASES)) {
  test(`${locale}: failed or unperformed navigation cannot support an assistant completion claim`, async () => {
    for (const state of ['failed', 'unperformed']) {
      const { input } = await fixture(locale, state);
      for (const claim of [words.passive, words.active]) {
        assert.equal(A.why(answer(claim), input), 'ground', `${state}: ${claim}`);
        assert.equal(A.task.check(answer(claim), input), null);
      }
    }
  });
  test(`${locale}: truthful failure, manual guidance and quoted titles remain usable`, async () => {
    const { input } = await fixture(locale);
    for (const phrase of [words.failure, words.manual, words.quote]) assert.equal(A.why(answer(phrase), input), '', phrase);
    assert.equal(A.why({ call: { name: 'place_open', arguments: { place: 'calendar' } }, answer: null }, input), '', 'the correct next call still passes');
  });
  test(`${locale}: a later matching success supports the completed navigation claim`, async () => {
    const { input, actions } = await fixture(locale, 'success');
    assert.equal(actions.length, 1);
    for (const claim of [words.passive, words.active]) assert.equal(A.why(answer(claim), input), '', claim);
  });
}


test('a different opened destination never proves the claimed target; an earlier named success remains truthful', async () => {
  const { input } = await fixture('en');
  const withSteps = (steps) => ({ ...input, steps: [...input.steps.slice(0, 1), ...steps.map(({ place, result }) => ({ call: { name: 'place_open', arguments: { place } }, result: JSON.stringify(result) }))] });
  const grades = { place: 'grades', result: { opened: 'grades', title: 'Grades' } };
  const calendar = { place: 'calendar', result: { ok: false, error: 'The page could not be opened.' } };
  for (const steps of [[grades, calendar], [calendar, grades]]) {
    const current = withSteps(steps);
    assert.equal(A.why(answer('I opened Calendar.'), current), 'ground');
    assert.equal(A.why({ call: null, answer: { text: 'I opened Grades. Calendar could not be opened.', quotes: ['Grades', 'Calendar'] } }, current), '');
  }
  assert.equal(A.why(answer('The requested place was opened successfully.'), withSteps([grades, calendar])), 'ground');
});

test('a course subpage claim uses the most specific listed destination, not the home-name prefix', () => {
  const places = [{ place: 'course:25', title: 'BIO 1100' }, { place: 'course:25/grades', title: 'BIO 1100 grades' }];
  const input = A.task.input({ question: 'Open BIO 1100 grades', tools: ['places_list', 'place_open'], now: 1793577600000, zone: 'UTC', first: true, steps: [
    { call: { name: 'places_list', arguments: {} }, result: { places } },
    { call: { name: 'place_open', arguments: { place: 'course:25/grades' } }, result: { opened: 'course:25/grades', title: 'BIO 1100 grades' } },
  ] });
  for (const name of ['BIO 1100 grades', 'course:25/grades']) assert.equal(A.why({ call: null, answer: { text: `I opened ${name}.`, quotes: [name] } }, input), '');
});

test('coordinated completions and failures each use their own destination', async () => {
  const ctx = { page: { site: 'canvas', url: 'https://school.example.edu/' }, courses: async () => [], ui: { push() {} } };
  const steps = [
    { call: { name: 'places_list', arguments: {} }, result: await TOOL('places_list').run({}, ctx) },
    { call: { name: 'place_open', arguments: { place: 'grades' } }, result: await TOOL('place_open').run({ place: 'grades' }, ctx) },
    { call: { name: 'place_open', arguments: { place: 'calendar' } }, result: await TOOL('place_open').run({ place: 'calendar' }, { page: {} }) },
  ];
  const phrases = {
    en: ['I opened Grades and I could not open Calendar.', 'I could not open Calendar and I opened Grades.', 'I never opened Calendar and I opened Calendar. Grades'],
    es: ['He abierto Grades y no he abierto Calendar.', 'No he abierto Calendar y he abierto Grades.', 'No he abierto Calendar y he abierto Calendar. Grades'],
    'pt-BR': ['Eu abri Grades e não abri Calendar.', 'Não abri Calendar e eu abri Grades.', 'Não abri Calendar e eu abri Calendar. Grades'],
    fr: ['J’ai ouvert Grades et je n’ai pas ouvert Calendar.', 'Je n’ai pas ouvert Calendar et j’ai ouvert Grades.', 'Je n’ai pas ouvert Calendar et j’ai ouvert Calendar. Grades'],
    de: ['Ich habe Grades geöffnet und ich habe Calendar nicht geöffnet.', 'Ich habe Calendar nicht geöffnet und ich habe Grades geöffnet.', 'Ich habe Calendar nicht geöffnet und ich habe Calendar geöffnet. Grades'],
    nl: ['Ik heb Grades geopend en ik heb Calendar niet geopend.', 'Ik heb Calendar niet geopend en ik heb Grades geopend.', 'Ik heb Calendar niet geopend en ik heb Calendar geopend. Grades'],
  };
  for (const [locale, [successFirst, failureFirst, falseSuccess]] of Object.entries(phrases)) {
    const input = A.task.input({ question: PHRASES[locale].question, tools: ['places_list', 'place_open'], locale, now: 1793577600000, zone: 'UTC', first: true, steps });
    for (const text of [successFirst, failureFirst]) assert.equal(A.why({ call: null, answer: { text, quotes: ['Grades', 'Calendar'] } }, input), '', text);
    assert.equal(A.why({ call: null, answer: { text: falseSuccess, quotes: ['Grades', 'Calendar'] } }, input), 'ground', falseSuccess);
  }
  const input = A.task.input({ question: 'Open Grades and Calendar', tools: ['places_list', 'place_open'], now: 1793577600000, zone: 'UTC', first: true, steps });
  assert.equal(A.why({ call: null, answer: { text: 'I opened Grades and Calendar.', quotes: ['Grades', 'Calendar'] } }, input), 'ground', 'a coordinated target list still needs both successes');
});
