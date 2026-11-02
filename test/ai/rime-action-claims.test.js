// A factual quote is not evidence that a UI navigation happened. Use the actual places tool for result shapes.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../extension/ai/tasks/agent-tools.js');
const P = require('../../extension/ai/agent/places.js');
const text = require('../../extension/ai/text.js');
const R = require('../../extension/ai/request.js');
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
