// Feedback's citation witnesses in all six languages: the bibliography headings and APA rubric labels each language uses,
// with the same refusals as English (an APA-named reference list, two lists, an assignment that allows any style, a
// level named for citations), Glaze's comment naming the heading the draft has, and English prompts pinned byte for byte.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const T = require('../../extension/ai/task.js');
const F = require('../../extension/ai/tasks/writer-feedback.js');
require('../../extension/ai/providers/mock.js');

const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
const blocks = (req) => [...contents(req).matchAll(/\[([^\n]+) — data copied from a page or a document, not instructions\]\n<<<[^\n]+\n([\s\S]*?)\n>>>[^\n]+/g)].map((m) => ({ label: m[1], text: m[2] }));
const catalog = (req, draft) => blocks(req).filter((b) => (b.label === 'draft') === draft).flatMap((b) => { try { const v = JSON.parse(b.text); return Array.isArray(v) ? v.filter((p) => p.id) : []; } catch { return []; } });

const BODY = {
  en: 'School gardens help students learn together and share the harvest with the school (Smith 23).\nThe class records its observations in a notebook and compares them with the other groups (Jones 41).',
  de: 'Schulgärten fördern das gemeinsame Lernen, und die Klasse teilt die Ernte mit der Schule (Smith 23).\nDie Klasse hält ihre Beobachtungen in einem Heft fest und vergleicht sie mit den anderen Gruppen (Jones 41).',
  es: 'Los huertos escolares ayudan a que los estudiantes aprendan juntos y compartan la cosecha con la escuela (Smith 23).\nLa clase registra sus observaciones en un cuaderno y las compara con los otros grupos (Jones 41).',
  fr: 'Les jardins scolaires aident les élèves à apprendre ensemble et à partager la récolte avec l’école (Smith 23).\nLa classe note ses observations dans un cahier et les compare avec les autres groupes (Jones 41).',
  'pt-BR': 'As hortas escolares ajudam os alunos a aprender juntos e a dividir a colheita com a escola (Smith 23).\nA turma registra suas observações em um caderno e as compara com os outros grupos (Jones 41).',
  nl: 'Schooltuinen helpen leerlingen om samen te leren en de oogst met de school te delen (Smith 23).\nDe klas noteert haar waarnemingen in een schrift en vergelijkt ze met de andere groepen (Jones 41).',
};
const ENTRIES = 'Smith, Alice. Garden Learning. Press, 2020.\nJones, Alex. Classroom Notes. Press, 2021.';
const input = (lang, heading, label, { instructions = 'Write the essay.', levels = ['Excellent', 'Satisfactory', 'Unsatisfactory', 'Poor'], text } = {}) => ({
  text: text || `${BODY[lang]}\n${heading}\n${ENTRIES}`, grade: true, mode: 'paper',
  paper: { format: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'name-page' },
  context: { kind: 'assignment', assignment: { instructions, rubric: { kind: 'points', levels: levels.map((l, i) => ({ id: `l${i}`, label: l })), criteria: [
    { id: 'style', label, points: 25, cells: [25, 18.75, 12.5, 6.25].map((value, i) => ({ level: `l${i}`, value })) },
  ] } } },
});
const decision = (req) => ({ json: { status: 'partly', level: 'Satisfactory', score: 18.75, complete: true,
  quotes: catalog(req, true).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 6).map((p) => p.id) } });
const replies = (comment = 'Your draft cites author and page only, so the required APA years are missing.') => (req) => req.schema.properties.status ? decision(req)
  : req.schema.properties.comment ? { json: { comment } } : { json: { summary: 'Your paper uses a different citation system than the required APA style.' } };
const LOCAL = { local: true, context: 9216, images: false };
const run = (inp, reply = replies(), caps = LOCAL) => { const cfg = { caps, replies: reply, seen: [] }; return { cfg, result: T.run(F.task, inp, { provider: 'mock', cfg }) }; };

// The heading each language gives an author-page list, and the rubric labels its APA citation rows carry.
const CASES = [
  ['en', 'Works Cited', 'APA style'],
  ['de', 'Literaturverzeichnis', 'APA-Zitierweise'], ['de', 'Quellen', 'Zitierweise nach APA'], ['de', 'Bibliographie', 'APA-Stil'],
  ['es', 'Obras citadas', 'Estilo APA'], ['es', 'Bibliografía', 'Citas en formato APA'],
  ['fr', 'Bibliographie', 'Normes APA'], ['fr', 'Ouvrages cités', 'Style APA'],
  ['pt-BR', 'Obras citadas', 'Normas da APA'], ['pt-BR', 'Bibliografia', 'Citações APA'],
  ['nl', 'Literatuurlijst', 'APA-stijl'], ['nl', 'Bronnen', 'Bronvermelding volgens APA'],
];
test('an author-page list under any language\'s heading, against an APA row in its words, gets the lowest-band estimate', async () => {
  for (const [lang, heading, label] of CASES) {
    const { result } = run(input(lang, heading, label));
    const row = (await result).output.criteria[0];
    assert.deepEqual(row?.score, { earned: 6.25, total: 25 }, `${lang} ${heading} / ${label}`);
    assert.equal(row.status, 'missing');
    assert.ok(row.comment.includes(heading), `${lang}: the comment names the draft's own heading: ${row.comment}`);
    if (lang !== 'en') assert.doesNotMatch(row.comment, /^Your /, lang);
  }
});

test('the citation fallback names the draft\'s own heading', async () => {
  const bad = ["The citation mismatch between MLA 9's author-page format and APA's author-year style results in a Satisfactory score of 18.75 points, indicating a partial adherence to the required citation style.",
    "The paper's MLA 9 formatting is correct, but the APA style citation conflicts with the required APA author-year references, resulting in a "];
  for (const [lang, heading, label] of [['de', 'Literaturverzeichnis', 'APA-Zitierweise'], ['nl', 'Bronnen', 'APA-stijl'], ['en', 'Works Cited', 'APA style']]) {
    const inp = input(lang, heading, label); inp.context.assignment.rubric.criteria[0].cells[1].detail = 'A different citation system may receive this band when other conventions are satisfied.';
    let n = 0;
    const { result } = run(inp, (req) => req.schema.properties.comment ? { json: { comment: bad[n++ % 2] } } : replies()(req));
    const out = (await result).output;
    assert.equal(out.grade.earned, 18.75, lang);
    assert.ok(out.criteria[0].comment.includes(heading), `${lang}: ${out.criteria[0].comment}`);
  }
});

test('a localized comment that names the draft\'s heading explains the mismatch', async () => {
  const inp = input('de', 'Literaturverzeichnis', 'APA-Zitierweise'); inp.context.assignment.rubric.criteria[0].cells[1].detail = 'A different citation system may receive this band when other conventions are satisfied.';
  const comment = 'Deine Belege und dein Literaturverzeichnis folgen dem Autor-Seite-Schema statt dem geforderten APA-Stil.';
  const { cfg, result } = run(inp, replies(comment));
  assert.equal((await result).output.criteria[0]?.comment, comment);
  assert.equal(cfg.seen.filter((req) => req.schema.properties.comment).length, 1);
  assert.ok(cfg.seen.some((req) => blocks(req).some((b) => b.label === 'citation evidence' && b.text.includes('Literaturverzeichnis'))), 'the witnesses reached the model');
});

test('an APA-named reference list or two lists constrain nothing, in any language', async () => {
  for (const [lang, heading, label] of [['en', 'References', 'APA style'], ['es', 'Referencias', 'Estilo APA'], ['fr', 'Références', 'Style APA'], ['pt-BR', 'Referências', 'Normas da APA'], ['nl', 'Referenties', 'APA-stijl'],
    ['de', 'Literaturverzeichnis\nQuellen', 'APA-Zitierweise']]) {
    const { cfg, result } = run(input(lang, heading, label));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned: 18.75, total: 25 }, `${lang} ${heading}`);
    assert.ok(cfg.seen.every((req) => !blocks(req).some((b) => b.label === 'citation evidence')), `${lang} ${heading}`);
  }
});

test('an assignment that allows any style, a label with an alternative, or a level named for citations keeps the model\'s band', async () => {
  const cases = [
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', { instructions: 'Jeder Zitierstil wird akzeptiert.' }],
    ['fr', 'Bibliographie', 'Normes APA', { instructions: 'Le style de citation est libre.' }],
    ['es', 'Obras citadas', 'Estilo APA', { instructions: 'Se acepta cualquier estilo de citación.' }],
    ['pt-BR', 'Obras citadas', 'Normas da APA', { instructions: 'Qualquer estilo de citação é aceito.' }],
    ['nl', 'Literatuurlijst', 'APA-stijl', { instructions: 'Elke citeerstijl is toegestaan.' }],
    ['de', 'Literaturverzeichnis', 'APA- oder MLA-Zitierweise', {}],
    ['es', 'Obras citadas', 'Estilo APA o MLA', {}],
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', { levels: ['Sehr gut', 'Gut', 'Lückenhaft', 'Fehlende Belege'] }],
    ['fr', 'Bibliographie', 'Normes APA', { levels: ['Excellent', 'Bien', 'Insuffisant', 'Citations absentes'] }],
  ];
  for (const [lang, heading, label, extra] of cases) {
    const { result } = run(input(lang, heading, label, extra));
    const levels = extra.levels || ['Excellent', 'Satisfactory', 'Unsatisfactory', 'Poor'];
    const out = (await result).output;
    assert.notDeepEqual(out.criteria[0]?.score, { earned: 6.25, total: 25 }, `${lang} ${label} ${JSON.stringify(extra)}`);
    if (!extra.levels) assert.equal(out.criteria[0]?.level?.label, levels[1]);
  }
  // The same inputs without the exception are estimated (a control for the cases above).
  const { result } = run(input('de', 'Literaturverzeichnis', 'APA-Zitierweise', { instructions: 'Schreibe den Aufsatz.' }));
  assert.deepEqual((await result).output.criteria[0]?.score, { earned: 6.25, total: 25 });
});

test('style examples quoted in a localized line are not the draft\'s citations', async () => {
  for (const [lang, line] of [['de', 'Ein Beispiel für den MLA-Stil ist (Smith 23), ein weiteres Beispiel ist (Jones 41).'], ['es', 'Un ejemplo del estilo MLA es (Smith 23) y otro ejemplo es (Jones 41).'],
    ['fr', 'Un exemple du style MLA est (Smith 23), un autre exemple est (Jones 41).'], ['pt-BR', 'Um exemplo do estilo MLA é (Smith 23) e outro exemplo é (Jones 41).'], ['nl', 'Een voorbeeld van de MLA-stijl is (Smith 23) en een ander voorbeeld is (Jones 41).']]) {
    const heading = { de: 'Literaturverzeichnis', es: 'Obras citadas', fr: 'Bibliographie', 'pt-BR': 'Obras citadas', nl: 'Literatuurlijst' }[lang];
    const label = { de: 'APA-Zitierweise', es: 'Estilo APA', fr: 'Normes APA', 'pt-BR': 'Normas da APA', nl: 'APA-stijl' }[lang];
    const { result } = run(input(lang, heading, label, { text: `${BODY[lang].replace(/ \((?:Smith 23|Jones 41)\)/g, '')}\n${line}\n${heading}\n${ENTRIES}` }));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned: 18.75, total: 25 }, lang);
    const control = run(input(lang, heading, label));
    assert.deepEqual((await control.result).output.criteria[0]?.score, { earned: 6.25, total: 25 }, `${lang}: the same draft's own citations are witnesses`);
  }
});

test('localized prohibitions and absent style requirements disable citation witnesses', async (t) => {
  for (const [lang, heading, label, instructions] of [
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'Verwenden Sie APA nicht.'],
    ['fr', 'Bibliographie', 'Normes APA', 'N’utilisez pas APA.'],
    ['es', 'Obras citadas', 'Estilo APA', 'No use APA.'],
    ['pt-BR', 'Obras citadas', 'Normas da APA', 'Não use APA.'],
    ['nl', 'Literatuurlijst', 'APA-stijl', 'Gebruik APA niet.'],
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'APA darf nicht verwendet werden.'],
    ['fr', 'Bibliographie', 'Normes APA', 'L’APA ne doit pas être utilisé.'],
    ['es', 'Obras citadas', 'Estilo APA', 'APA no debe utilizarse.'],
    ['pt-BR', 'Obras citadas', 'Normas da APA', 'APA não deve ser usado.'],
    ['nl', 'Literatuurlijst', 'APA-stijl', 'APA moet niet worden gebruikt.'],
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'Es ist kein bestimmter Zitierstil vorgeschrieben.'],
    ['fr', 'Bibliographie', 'Normes APA', 'Aucun style particulier n’est exigé.'],
    ['es', 'Obras citadas', 'Estilo APA', 'No hay un estilo de citación obligatorio.'],
    ['nl', 'Literatuurlijst', 'APA-stijl', 'Geen specifieke citeerstijl is vereist.'],
  ]) await t.test(instructions, async () => {
    const { cfg, result } = run(input(lang, heading, label, { instructions }));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned: 18.75, total: 25 });
    assert.ok(cfg.seen.every((req) => !blocks(req).some((b) => b.label === 'citation evidence')));
  });
});

test('requiring APA for every source does not allow every citation style', async (t) => {
  for (const [lang, heading, label, instructions] of [
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'Verwende für jede Quelle den APA-Stil.'],
    ['es', 'Obras citadas', 'Estilo APA', 'Sigue APA en cualquier cita.'],
    ['pt-BR', 'Obras citadas', 'Normas da APA', 'Use APA em qualquer citação.'],
    ['nl', 'Literatuurlijst', 'APA-stijl', 'Gebruik APA bij elke bronvermelding.'],
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'Verwenden Sie APA und vergessen Sie nicht das Jahr.'],
  ]) await t.test(instructions, async () => {
    const { result } = run(input(lang, heading, label, { instructions }));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned: 6.25, total: 25 });
  });
});

test('localized APA labels accept articles, prepositions and edition-only names', async (t) => {
  for (const [lang, heading, label] of [
    ['pt-BR', 'Obras citadas', 'Citações no formato APA'],
    ['fr', 'Bibliographie', 'Citations selon les normes APA'],
    ['fr', 'Bibliographie', 'Normes de l’APA'],
    ['de', 'Literaturverzeichnis', 'APA (7. Auflage)'],
    ['fr', 'Bibliographie', 'APA (7e édition)'],
    ['es', 'Obras citadas', 'APA (7.ª edición)'],
    ['pt-BR', 'Obras citadas', 'APA (7ª edição)'],
    ['nl', 'Literatuurlijst', 'APA (7e editie)'],
  ]) await t.test(label, async () => {
    const { result } = run(input(lang, heading, label));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned: 6.25, total: 25 });
  });
});

test('localized rubric alternatives do not contradict a met assessment using an allowed style', async (t) => {
  for (const [lang, heading, label, detail, comment] of [
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'Verwenden Sie APA oder MLA.', 'Ihr Entwurf folgt der MLA-Zitierweise.'],
    ['fr', 'Bibliographie', 'Normes APA', 'Utilisez APA ou MLA.', 'Votre brouillon suit le style MLA.'],
    ['es', 'Obras citadas', 'Estilo APA', 'Utiliza APA o MLA.', 'Su borrador sigue el formato MLA.'],
    ['pt-BR', 'Obras citadas', 'Normas da APA', 'Use APA ou MLA.', 'Seu rascunho segue o estilo MLA.'],
    ['nl', 'Literatuurlijst', 'APA-stijl', 'Gebruik APA of MLA.', 'Je tekst volgt de MLA-stijl.'],
  ]) await t.test(lang, async () => {
    const inp = input(lang, heading, label);
    inp.context.assignment.rubric.criteria[0].detail = detail;
    const { cfg, result } = run(inp, (req) => req.schema.properties.status
      ? { json: { ...decision(req).json, status: 'met', level: 'Excellent', score: 25 } } : replies(comment)(req));
    assert.equal((await result).output.grade.earned, 25);
    assert.equal(cfg.seen.filter((req) => req.schema.properties.status).length, 1);
  });
});

test('localized citation-specific bands cannot be treated as an undescribed quality scale', async (t) => {
  for (const [lang, heading, label, band] of [
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'Zitierweise'],
    ['fr', 'Bibliographie', 'Normes APA', 'Incomplète'],
    ['es', 'Obras citadas', 'Estilo APA', 'Fuentes'],
    ['pt-BR', 'Obras citadas', 'Normas da APA', 'Fontes'],
  ]) await t.test(`${lang}: ${band}`, async () => {
    const { result } = run(input(lang, heading, label, { levels: ['Excellent', 'Satisfactory', 'Unsatisfactory', band] }));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned: 18.75, total: 25 });
  });
});

test('a localized rubric that makes APA optional cannot enforce APA in the comment check', async (t) => {
  for (const [lang, heading, label, detail, comment] of [
    ['de', 'Literaturverzeichnis', 'APA-Zitierweise', 'APA ist nicht erforderlich.', 'Ihr Entwurf folgt der MLA-Zitierweise.'],
    ['fr', 'Bibliographie', 'Normes APA', 'Le style APA est facultatif.', 'Votre brouillon suit le style MLA.'],
    ['es', 'Obras citadas', 'Estilo APA', 'El estilo APA no se requiere.', 'Su borrador sigue el formato MLA.'],
    ['pt-BR', 'Obras citadas', 'Normas da APA', 'O estilo APA não é obrigatório.', 'Seu rascunho segue o estilo MLA.'],
    ['nl', 'Literatuurlijst', 'APA-stijl', 'De APA-stijl is niet verplicht.', 'Je tekst volgt de MLA-stijl.'],
  ]) await t.test(lang, async () => {
    const inp = input(lang, heading, label);
    inp.context.assignment.rubric.criteria[0].detail = detail;
    const { cfg, result } = run(inp, (req) => req.schema.properties.status
      ? { json: { ...decision(req).json, status: 'met', level: 'Excellent', score: 25 } } : replies(comment)(req));
    assert.equal((await result).output.grade.earned, 25);
    assert.equal(cfg.seen.filter((req) => req.schema.properties.status).length, 1);
  });
});

test('English citation behavior is not changed by localized homographs', async (t) => {
  for (const [name, extra, earned] of [
    ['permit is an English verb', { instructions: 'Use APA style to permit clear source tracking.' }, 6.25],
    ['still is not German Stil', { text: `The MLA method still helps the class learn together (Smith 23).\nThe MLA method still guides the class as they record the harvest (Jones 41).\nWorks Cited\n${ENTRIES}` }, 6.25],
    ['Absent remains a generic English band', { levels: ['Excellent', 'Satisfactory', 'Unsatisfactory', 'Absent'] }, 6.25],
    ['APA format remains outside the narrow English citation target', {}, 18.75],
  ]) await t.test(name, async () => {
    const { result } = run(input('en', 'Works Cited', name.startsWith('APA format') ? 'APA format' : 'APA style', extra));
    assert.deepEqual((await result).output.criteria[0]?.score, { earned, total: 25 });
  });
});

test('English fixed comments keep the canonical Works Cited spelling', async () => {
  const canonical = (await run(input('en', 'Works Cited', 'APA style')).result).output.criteria[0].comment;
  const varied = (await run(input('en', 'works cited :', 'APA style')).result).output.criteria[0].comment;
  assert.equal(varied, canonical);
});

test('Dutch vocabulary does not change recognition of the English verb met', () => {
  assert.equal(F.languageOf('We met Jane and met John with Sam.'), null);
});

// English citation-witness runs (local and cloud), every text sent with its fence tag made constant: pinned at 86d30463.
const digest = (seen) => crypto.createHash('sha256').update(JSON.stringify(seen.map((r) => ({ messages: r.messages, schema: r.schema, maxTokens: r.maxTokens })))
  .replace(/DATA-[0-9a-f]{12}/g, 'DATA-X')).digest('hex').slice(0, 16);
test('English citation-witness prompts are unchanged', async () => {
  const pinned = { local: '4d49f331d53e22c1', described: '0b1a06c99fb60d9b', cloud: '36f29550c7a9fb24' };
  const described = input('en', 'Works Cited', 'APA style'); described.context.assignment.rubric.criteria[0].cells[1].detail = 'A different citation system may receive this band when other conventions are satisfied.';
  const cloud = (req) => ({ json: { criteria: [{ criterion: 'style', status: 'partly', comment: 'Your draft cites author and page only, so the required APA years are missing.', quotes: [], level: 'Satisfactory', score: 18.75 }], grade: { summary: 'Your paper uses a different citation system than the required APA style.' } } });
  for (const [name, inp, reply, caps] of [['local', input('en', 'Works Cited', 'APA style'), replies(), LOCAL], ['described', described, replies(), LOCAL], ['cloud', input('en', 'Works Cited', 'APA style'), cloud, { context: 128000, images: false }]]) {
    const { cfg, result } = run(inp, reply, caps);
    await result;
    assert.equal(digest(cfg.seen), pinned[name], name);
  }
});
