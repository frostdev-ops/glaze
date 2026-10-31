// Writer Feedback in the draft's language: the answer language goes as its own request field (cloud providers say it,
// local ones ignore it) while every prompt text stays byte-identical; Glaze's fixed comments, the citation-row and
// style-contradiction checks, the local comment length allowance and the sentence counter work in all six locales.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const T = require('../../extension/ai/task.js');
const F = require('../../extension/ai/tasks/writer-feedback.js');
require('../../extension/ai/providers/mock.js');

const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
const blocks = (req) => [...contents(req).matchAll(/\[([^\n]+) — data copied from a page or a document, not instructions\]\n<<<[^\n]+\n([\s\S]*?)\n>>>[^\n]+/g)].map((m) => ({ label: m[1], text: m[2] }));
const catalog = (req, draft) => blocks(req).filter((b) => (b.label === 'draft') === draft).flatMap((b) => { try { const v = JSON.parse(b.text); return Array.isArray(v) ? v.filter((p) => p.id) : []; } catch { return []; } });

const GERMAN = 'Schulgärten helfen den Schülern, gemeinsam zu lernen. Die Klasse misst das Wachstum der Pflanzen und teilt die Ernte. '
  + 'Die Klasse führt wöchentliche Notizen und vergleicht die Beobachtungen mit den anderen Gruppen. '.repeat(6);
const ENGLISH = 'School gardens help students learn together. Students measure growth and share their harvest. ' + 'The class shares weekly records and compares the observations together. '.repeat(6);
const raw = (text = GERMAN) => ({ text, grade: true, context: { kind: 'assignment', assignment: {
  instructions: 'Erklären Sie den Nutzen von Schulgärten.', files: [{ name: 'Aufgabe.txt', text: 'Nennen Sie zwei konkrete Beispiele.' }], rubric: { criteria: [
    { id: 'claim', label: 'These', detail: 'Erklären Sie den Nutzen.', points: 40 }, { id: 'examples', label: 'Beispiele', detail: 'Nennen Sie zwei konkrete Beispiele.', points: 60 },
  ] },
} } });
const COMMENT = 'Ihr Entwurf nennt den Nutzen und belegt ihn mit den Beobachtungen der Klasse.';
const reply = (comment = COMMENT) => (req) => {
  if (req.schema.properties.status) {
    const id = /\[(claim|examples|style)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
    return { json: { status: 'met', quotes: catalog(req, true).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 6).map((p) => p.id), level: null, score: id === 'claim' ? 40 : id === 'style' ? 20 : 60, complete: true } };
  }
  if (req.schema.properties.comment) return { json: { comment: typeof comment === 'function' ? comment(req) : comment } };
  if (req.schema.properties.summary) return { json: { summary: 'Ihre Arbeit erklärt den Nutzen und stützt ihre These mit Beobachtungen.' } };
  return { json: { criteria: [{ criterion: 'claim', status: 'met', comment: COMMENT, quotes: [], level: null, score: 40 }, { criterion: 'examples', status: 'met', comment: COMMENT, quotes: [], level: null, score: 60 }], grade: { summary: 'Ihre Arbeit erklärt den Nutzen und stützt ihre These mit Beobachtungen.' } } };
};
const LOCAL = { local: true, context: 9216, images: false }, CLOUD = { context: 128000, images: false };
const run = (input, replies, caps = LOCAL) => { const cfg = { caps, replies, seen: [] }; return { cfg, result: T.run(F.task, input, { provider: 'mock', cfg }) }; };

// Every text Feedback sends (system, user parts and the schema the on-device providers render into the prompt), with each
// request's random fence tag made constant: pinned at 9e9aac17, the prompts the on-device model is fine-tuned on.
const digest = (seen) => crypto.createHash('sha256').update(JSON.stringify(seen.map((r) => ({ messages: r.messages, schema: r.schema, maxTokens: r.maxTokens })))
  .replace(/DATA-[0-9a-f]{12}/g, 'DATA-X')).digest('hex').slice(0, 16);
test('the answer language changes no prompt text Feedback sends, local or cloud', async () => {
  const pinned = { 'de local': 'c6559a107374bfa2', 'en local': '5a2b72719251bf61', 'de cloud': '5168d690b6102381', 'en cloud': '7cafd7fe0b98fc2f' };
  for (const [name, text, caps] of [['de local', GERMAN, LOCAL], ['en local', ENGLISH, LOCAL], ['de cloud', GERMAN, CLOUD], ['en cloud', ENGLISH, CLOUD]]) {
    const { cfg, result } = run(raw(text), reply(text === GERMAN ? COMMENT : 'Your draft states a benefit and gives concrete examples.'), caps);
    await result;
    assert.equal(digest(cfg.seen), pinned[name], name);
  }
});

test('cloud requests name the draft\'s language in their own field; local requests carry none', async () => {
  const cloud = run(raw(GERMAN), reply(), CLOUD);
  await cloud.result;
  assert.ok(cloud.cfg.seen.length > 0);
  for (const req of cloud.cfg.seen) assert.deepEqual(req.reply, { lang: 'de' });
  const english = run(raw(ENGLISH), reply('Your draft states a benefit and gives concrete examples.'), CLOUD);
  await english.result;
  for (const req of english.cfg.seen) assert.deepEqual(req.reply, { lang: 'en' });
  const local = run(raw(GERMAN), reply());
  await local.result;
  assert.ok(local.cfg.seen.length > 2);
  for (const req of local.cfg.seen) assert.equal(req.reply, undefined, 'the fine-tuned prompts go exactly as before');
});

test('a draft in no recognisable language falls back to Glaze\'s UI language', async () => {
  const was = globalThis.chrome;
  globalThis.chrome = { ...was, i18n: { getUILanguage: () => 'pt-BR' } };
  try {
    const { cfg, result } = run(raw('CO2 + H2O → C6H12O6 + O2 (1) 6CO2 + 6H2O → C6H12O6 + 6O2 (2) ΔG = −2870 kJ/mol (3)'), reply(), CLOUD);
    await result;
    for (const req of cfg.seen) assert.deepEqual(req.reply, { lang: 'pt-BR' });
  } finally { globalThis.chrome = was; }
});

// The citation rows: a German paper whose list keeps the "Works Cited" heading, against an APA rubric row.
const citationInput = ({ described = false } = {}) => {
  const input = raw(); input.mode = 'paper';
  input.text = 'Schulgärten fördern das gemeinsame Lernen, und die Klasse teilt die Ernte mit der Schule (Smith 23).\nDie Klasse hält ihre Beobachtungen in einem Heft fest und vergleicht sie mit den Notizen der anderen Gruppen (Jones 41).\nWorks Cited\nSmith, Alice. Garden Learning. Press, 2020.\nJones, Alex. Classroom Notes. Press, 2021.';
  input.paper = { format: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'name-page' };
  input.context.assignment.rubric = { kind: 'points', levels: ['Excellent', 'Satisfactory', 'Unsatisfactory', 'Poor'].map((label, i) => ({ id: `l${i}`, label })), criteria: [
    { id: 'style', label: 'APA style', points: 25, cells: [25, 18.75, 12.5, 6.25].map((value, i) => ({ level: `l${i}`, value })) },
  ] };
  if (described) input.context.assignment.rubric.criteria[0].cells[1].detail = 'A different citation system may receive this band when other conventions are satisfied.';
  return input;
};
const mismatch = (req, { status = 'partly', level = 'Satisfactory', score = 18.75 } = {}) => ({ json: { status, level, score, complete: true,
  quotes: catalog(req, true).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 6).map((p) => p.id) } });

test('the lowest-band citation estimate is written in the draft\'s language', async () => {
  const { result } = run(citationInput(), (req) => req.schema.properties.status ? mismatch(req) : reply()(req));
  const out = (await result).output;
  assert.deepEqual(out.criteria[0]?.score, { earned: 6.25, total: 25 });
  const comment = out.criteria[0]?.comment;
  assert.doesNotMatch(comment, /Your author-page|lowest band|deducted/);
  assert.match(comment, /Deine .*Works Cited.*APA.*Glaze.*Poor.*6,25\/25/);
  assert.ok(comment.length <= 312);
});

test('the citation fallback comment is written in the draft\'s language', async () => {
  const bad = ["The citation mismatch between MLA 9's author-page format and APA's author-year style results in a Satisfactory score of 18.75 points, indicating a partial adherence to the required citation style.",
    "The paper's MLA 9 formatting is correct, but the APA style citation in the Works Cited section conflicts with the required APA author-year references, resulting in a "];
  let n = 0;
  const { cfg, result } = run(citationInput({ described: true }), (req) => req.schema.properties.status ? mismatch(req) : req.schema.properties.comment ? { json: { comment: bad[n++] } } : reply()(req));
  const out = (await result).output;
  assert.equal(out.grade.earned, 18.75);
  assert.doesNotMatch(out.criteria[0]?.comment, /Your author-page|conflict with required/);
  assert.match(out.criteria[0]?.comment, /Deine .*Works Cited.*APA.*Satisfactory.*18,75\/25/);
  assert.equal(cfg.seen.length, 4);
});

test('a German citation-row comment needs no English words to explain the mismatch', async () => {
  const comment = 'Ihre Belege nennen nur Autor und Seite, ohne Jahreszahlen, und verfehlen damit den geforderten APA-Stil.';
  const { cfg, result } = run(citationInput({ described: true }), (req) => req.schema.properties.status ? mismatch(req) : req.schema.properties.comment ? { json: { comment } } : reply()(req));
  const out = (await result).output;
  assert.equal(out.criteria[0]?.comment, comment);
  assert.equal(cfg.seen.filter((req) => req.schema.properties.comment).length, 1, 'accepted the first time');
  for (const [lang, said] of [['fr', 'Vos citations indiquent seulement l’auteur et la page, sans année, contrairement au style APA exigé.'],
    ['es', 'Sus citas indican solo autor y página, sin año, por lo que no siguen el estilo APA exigido.'],
    ['pt-BR', 'Suas citações indicam apenas autor e página, sem o ano, e não seguem o estilo APA exigido.'],
    ['nl', 'Je bronvermeldingen noemen alleen auteur en pagina, zonder jaartal, en volgen de vereiste APA-stijl niet.']]) {
    const other = run(citationInput({ described: true }), (req) => req.schema.properties.status ? mismatch(req) : req.schema.properties.comment ? { json: { comment: said } } : reply()(req));
    assert.equal((await other.result).output.criteria[0]?.comment, said, lang);
  }
});

test('a French citation comment can name missing years with an elided article', async () => {
  const comment = 'Vos citations ne comportent pas d’année, contrairement au style APA exigé.';
  const { cfg, result } = run(citationInput({ described: true }), (req) => req.schema.properties.status ? mismatch(req) : req.schema.properties.comment ? { json: { comment } } : reply()(req));
  assert.equal((await result).output.criteria[0]?.comment, comment);
  assert.equal(cfg.seen.filter((req) => req.schema.properties.comment).length, 1, 'accepted without repair');
});

const styleRun = (comment, status = 'met') => {
  const input = raw(); input.mode = 'paper'; input.paper = { format: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'name-page' };
  input.context.assignment.rubric.criteria = [{ id: 'style', label: 'APA style', detail: 'APA style', points: 20 }];
  return run(input, (req) => req.schema.properties.status ? { json: { ...reply()(req).json, status, score: status === 'met' ? 20 : 10 } } : req.schema.properties.comment ? { json: { comment } } : reply()(req));
};
test('a met APA row justified by another style is a contradiction in every locale', async () => {
  for (const comment of ['Ihr Entwurf erfüllt den APA-Stil, weil er der MLA-9-Formatierung folgt.', 'Ihr Entwurf erfüllt den APA-Stil nicht.',
    'Votre brouillon respecte le style APA car il suit la mise en forme MLA 9.', 'Su borrador cumple el estilo APA porque sigue el formato MLA 9.',
    'Seu rascunho cumpre o estilo APA porque segue a formatação MLA 9.', 'Je tekst voldoet aan de APA-stijl omdat hij de MLA 9-opmaak volgt.']) {
    const out = (await styleRun(comment).result).output;
    assert.equal(out.grade.earned, null, comment);
    assert.equal(out.criteria.length, 0, comment);
  }
  for (const comment of ['Ihr Entwurf folgt dem APA-Stil und nicht der MLA-Formatierung.', 'Votre brouillon suit le style APA plutôt que la mise en forme MLA.']) {
    const out = (await styleRun(comment).result).output;
    assert.equal(out.criteria[0]?.status, 'met', comment);
  }
});

test('the local comment allowance is scaled for the draft\'s language; the schema sent stays as it was', async () => {
  const long = 'Ihr Entwurf erklärt den Nutzen der Schulgärten verständlich und belegt ihn mit wöchentlichen Beobachtungen der Klasse, doch die zwei konkreten Beispiele bleiben knapp und werden kaum mit der These verbunden, weshalb die Bewertung trotz klarer Gliederung nicht höher ausfällt.';
  assert.ok(long.length > 240 && long.length <= 312, String(long.length));
  const { cfg, result } = run(raw(), reply(long));
  const out = (await result).output;
  assert.equal(out.criteria[0]?.comment, long);
  assert.equal(cfg.seen.filter((req) => req.schema.properties.comment).length, 2, 'no repair');
  for (const req of cfg.seen.filter((r) => r.schema.properties.comment)) assert.equal(req.schema.properties.comment.maxLength, 240);
  const english = 'Your draft explains the garden benefit clearly and supports it with weekly class observations, but the two concrete examples stay brief and barely connect to the thesis, so the rating stays lower despite a clear and well organized structure throughout.';
  assert.ok(english.length > 240);
  const en = run(raw(ENGLISH), reply(english));
  assert.equal((await en.result).output.criteria.length, 0, 'English keeps its 240 characters');
});

test('the sentence counter skips each locale\'s common abbreviations', () => {
  for (const comment of ['Ihr Entwurf nennt Belege, z. B. zwei Studien bzw. eine Umfrage. Die Quellenangaben fehlen jedoch.',
    'Ihr Entwurf nennt Belege, d. h. zwei Studien u. a. von 2020, vgl. Abschnitt zwei. Die Quellenangaben fehlen jedoch.',
    'Votre brouillon cite des sources, p. ex. deux études, etc. dans la section deux. La conclusion manque toutefois.',
    'Su borrador cita fuentes, p. ej. dos estudios, etc. en la sección dos. La conclusión falta, sin embargo.',
    'Seu rascunho cita fontes, p. ex. dois estudos, etc. na seção dois. A conclusão falta, porém.',
    'Je tekst noemt bronnen, bijv. twee studies, d.w.z. onderzoek uit 2020. De conclusie ontbreekt echter.',
    'Your draft cites sources, e.g. two studies, i.e. research from 2020. The conclusion is missing.']) {
    assert.equal(F.assesses(comment, []), comment, comment);
  }
  assert.equal(F.assesses('Ihr Entwurf nennt Belege. Die These fehlt. Der Schluss fehlt auch.', []), '', 'three real sentences stay too many');
  assert.equal(F.assesses('Your draft cites sources. The thesis is missing. The conclusion is missing too.', []), '');
});

test('a sentence ending in an abbreviation still counts before a capitalized sentence', () => {
  for (const comment of ['Your draft lists sources etc. The thesis is missing. The conclusion is missing too.',
    'Ihr Entwurf nennt Quellen usw. Die These fehlt. Der Schluss fehlt auch.',
    'Votre brouillon cite des sources etc. La thèse manque. La conclusion manque aussi.',
    'Su borrador cita fuentes etc. La tesis falta. La conclusión falta también.',
    'Seu rascunho cita fontes etc. A tese falta. A conclusão falta também.',
    'Je tekst noemt bronnen enz. De these ontbreekt. De conclusie ontbreekt ook.']) {
    assert.equal(F.sentenceEnds(comment), 3, comment);
    assert.equal(F.assesses(comment, []), '', comment);
  }
});

test('uncertainty about another style does not contradict a met APA assessment', async () => {
  for (const comment of ['Ihr Entwurf erfüllt den APA-Stil; der MLA-Stil ist unbestätigt.',
    'Votre brouillon respecte le style APA ; le style MLA reste incertain.',
    'Su borrador cumple el estilo APA; el estilo MLA es incierto.',
    'Seu rascunho cumpre o estilo APA; o estilo MLA é incerto.',
    'Je tekst voldoet aan de APA-stijl; de MLA-stijl blijft onzeker.']) {
    const { cfg, result } = styleRun(comment);
    const out = (await result).output;
    assert.equal(out.criteria[0]?.comment, comment, comment);
    assert.equal(out.grade.earned, 20, comment);
    assert.equal(cfg.seen.filter((req) => req.schema.properties.status).length, 1, 'no reconsideration');
  }
});

test('Glaze\'s own Feedback comments pass its comment check and fit the allowance in every locale', () => {
  const I = require('../../extension/core/i18n.js');
  const keys = [['Your author-page citations and Works Cited miss required APA style; no rubric level descriptions are supplied, so Glaze estimates {level}, the lowest band ({value}/{points}; {deduction} points deducted).', { level: 'Unsatisfactory', value: '12,5', points: '25', deduction: '12,5' }],
    ['Your author-page citations and Works Cited miss required APA style; with no level descriptions, Glaze estimates the lowest band ({value}/{points}; {deduction} points deducted).', { value: '12,5', points: '25', deduction: '12,5' }],
    ['Your author-page citations and Works Cited heading conflict with required APA style; rubric rating: {level} ({earned}/{total} points).', { level: 'Unsatisfactory', earned: '12,5', total: '25' }]];
  for (const [lang, limit] of [['de', 312], ['es', 288], ['fr', 288], ['nl', 288], ['pt-BR', 288]]) {
    for (const [key, vars] of keys) {
      const said = I.t(key, vars, lang);
      assert.notEqual(said, I.t(key, vars, 'en'), `${lang} has its own words`);
      assert.equal(F.assesses(said, []), said, `${lang}: ${said}`);
      assert.ok(said.length <= limit, `${lang}: ${said.length}`);
    }
  }
});
