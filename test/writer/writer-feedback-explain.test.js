// Writer Feedback's per-criterion explanation: a complete, verified decision keeps its grade when no model comment
// passes (Glaze writes the rubric rating itself, in the draft's language); an explanation failure is never reported as
// unassessed material; a comment cut at the cap keeps its last full sentence. Local and cloud with an 8k context run
// one criterion at a time; the D4 release-gate eval withheld 39 of 40 grades with the coverage reason (2026-10-31).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../extension/ai/task.js');
const F = require('../../extension/ai/tasks/writer-feedback.js');
require('../../extension/ai/providers/mock.js');

const COVERAGE = 'Some assignment material could not be assessed completely.';
const EXPLANATION = 'The assessment did not explain the rubric scores.';
const DRAFTS = {
  en: 'School gardens help students learn together. Students measure growth and share their harvest. ' + 'The class shares weekly records and compares the observations together. '.repeat(6),
  de: 'Schulgärten helfen den Schülern, gemeinsam zu lernen. Die Klasse misst das Wachstum der Pflanzen und teilt die Ernte. ' + 'Die Klasse führt wöchentliche Notizen und vergleicht die Beobachtungen mit den anderen Gruppen. '.repeat(6),
  es: 'Los huertos escolares ayudan a los estudiantes a aprender juntos. Los estudiantes miden el crecimiento y comparten la cosecha. ' + 'La clase comparte los registros semanales y compara las observaciones con los otros grupos. '.repeat(6),
  fr: 'Les jardins scolaires aident les élèves à apprendre ensemble. La classe mesure la croissance des plantes et partage la récolte. ' + 'La classe tient des notes chaque semaine et compare les observations avec les autres groupes. '.repeat(6),
  nl: 'Schooltuinen helpen leerlingen om samen te leren. De klas meet de groei van de planten en deelt de oogst. ' + 'De klas houdt wekelijks notities bij en vergelijkt de waarnemingen met de andere groepen. '.repeat(6),
  'pt-BR': 'As hortas escolares ajudam os alunos a aprender juntos. A turma mede o crescimento das plantas e divide a colheita. ' + 'A turma faz anotações semanais e compara as observações com os outros grupos. '.repeat(6),
};
const raw = ({ lang = 'en', levels = false, grade = true } = {}) => ({ text: DRAFTS[lang], grade, context: { kind: 'assignment', assignment: {
  instructions: 'Explain the benefit of school gardens.', files: [{ name: 'Prompt.txt', text: 'Support the claim with two concrete examples.' }],
  rubric: levels
    ? { levels: [{ id: 'hi', label: 'Proficient' }, { id: 'lo', label: 'Developing' }], criteria: ['claim', 'examples'].map((id) => ({ id, label: id === 'claim' ? 'Claim' : 'Examples', points: 40,
      cells: [{ level: 'hi', value: 30 }, { level: 'lo', value: 10 }] })) }
    : { criteria: [{ id: 'claim', label: 'Claim', detail: 'Explain the benefit.', points: 40 }, { id: 'examples', label: 'Examples', detail: 'Use two concrete examples.', points: 60 }] },
} } });
const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
const blocks = (req) => [...contents(req).matchAll(/\[([^\n]+) — data copied from a page or a document, not instructions\]\n<<<[^\n]+\n([\s\S]*?)\n>>>[^\n]+/g)].map((m) => ({ label: m[1], text: m[2] }));
const catalog = (req, draft) => blocks(req).filter((b) => (b.label === 'draft') === draft).flatMap((b) => { try { const v = JSON.parse(b.text); return Array.isArray(v) ? v.filter((p) => p.id) : []; } catch { return []; } });
const SUMMARY = 'Your paper explains the benefit and supports its claim.';
// Complete, verified decisions with full points (or the top named level); only the comment varies.
const reply = (comment, { levels = false } = {}) => (req) => {
  const row = req.schema.properties.criteria?.items?.properties;
  if (req.schema.properties.status || row?.criterion?.enum) {
    const id = row?.criterion?.enum[0] || /\[(claim|examples)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
    const level = levels ? 'Proficient' : null, score = levels ? 30 : id === 'claim' ? 40 : 60;
    if (row) return { json: { criteria: [{ criterion: id, status: 'met', comment, quotes: row.quotes.items.enum.slice(0, 1), level, score }] } };
    const ungraded = req.schema.properties.score?.type === 'null';
    return { json: { status: 'met', quotes: catalog(req, true).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 2).map((p) => p.id), level, score: ungraded ? null : score, complete: true } };
  }
  if (req.schema.properties.comment) return { json: { comment } };
  if (req.schema.properties.summary) return { json: { summary: SUMMARY } };
  throw new Error('unexpected request');
};
const LOCAL = { local: true, context: 4096, images: false }, CLOUD_8K = { context: 8192, images: false };
const run = (input, replies, caps) => { const cfg = { caps, replies, seen: [] }; return { cfg, result: T.run(F.task, input, { provider: 'mock', cfg }) }; };
const explains = (cfg) => cfg.seen.filter((r) => r.schema.properties.comment).length;

// A sentence about the subject with none of the words an assessment check looks for (the D4 eval's commonest rejection).
const SUBJECT = 'Students measuring growth and sharing the harvest show the benefit well, earning full points.';
// A comment the JSON grammar closed at the schema's 240 characters, mid-sentence.
const cut = (head) => (head + ' and the weekly records the class shares are compared carefully across every group'.repeat(4)).slice(0, 240);

for (const [path, caps] of [['local', LOCAL], ['cloud with an 8k context', CLOUD_8K]]) {
  test(`${path}: a complete, verified decision keeps its grade when no comment passes, with Glaze's rubric rating`, async () => {
    const { cfg, result } = run(raw(), reply(SUBJECT), caps);
    const out = (await result).output;
    assert.equal(out.grade.reason, null);
    assert.equal(out.grade.earned, 100); assert.equal(out.grade.total, 100);
    assert.deepEqual(out.criteria.map((c) => c.comment), ['Rubric score: 40/40 points.', 'Rubric score: 60/60 points.']);
    assert.ok(cfg.seen.length > 0);
  });
  test(`${path}: a named level's fallback names the level and its points`, async () => {
    const { result } = run(raw({ levels: true }), reply(SUBJECT, { levels: true }), caps);
    const out = (await result).output;
    assert.equal(out.grade.reason, null); assert.equal(out.grade.earned, 60);
    assert.deepEqual(out.criteria.map((c) => c.comment), ['Rubric rating: Proficient (30/40 points).', 'Rubric rating: Proficient (30/40 points).']);
  });
  test(`${path}: feedback without grading reports an unusable explanation as one, never as unassessed material`, async () => {
    const { result } = run(raw({ grade: false }), reply(SUBJECT), caps);
    const out = (await result).output;
    assert.notEqual(out.reason?.key, COVERAGE);
    assert.equal(out.reason?.key, EXPLANATION);
  });
}

test('local: a comment cut at the cap keeps its last full sentence, with no repair', async () => {
  const sentence = 'Your draft states a benefit and gives concrete examples.';
  const { cfg, result } = run(raw(), reply(cut(sentence)), LOCAL);
  const out = (await result).output;
  assert.equal(out.grade.earned, 100);
  assert.deepEqual(out.criteria.map((c) => c.comment), [sentence, sentence]);
  assert.equal(explains(cfg), 2, 'one explain call per row');
});

test('local: a cut comment with no full sentence fails as before, and the fallback keeps the grade', async () => {
  const { cfg, result } = run(raw(), reply(cut('Your draft states a benefit,')), LOCAL);
  const out = (await result).output;
  assert.equal(out.grade.earned, 100); assert.equal(out.grade.reason, null);
  assert.deepEqual(out.criteria.map((c) => c.comment), ['Rubric score: 40/40 points.', 'Rubric score: 60/60 points.']);
  assert.equal(explains(cfg), 4, 'each row still gets its one repair');
});

test('local: an abbreviation is no sentence end when a cut comment is trimmed', async () => {
  const { result } = run(raw(), reply(cut('Your draft gives examples, e.g. weekly records')), LOCAL);
  assert.equal((await result).output.criteria[0]?.comment, 'Rubric score: 40/40 points.', 'never the fragment ending at "e.g."');
});

test('the fallback is written in the draft\'s language in all six locales and keeps the grade', async () => {
  const want = { en: 'Rubric score: 40/40 points.', de: 'Punkte für dieses Kriterium: 40/40.', es: 'Puntuación según la rúbrica: 40/40 puntos.',
    fr: 'Note pour ce critère : 40/40 points.', nl: 'Score voor dit criterium: 40/40 punten.', 'pt-BR': 'Pontuação pela rubrica: 40/40 pontos.' };
  for (const lang of Object.keys(DRAFTS)) {
    const out = (await run(raw({ lang }), reply(SUBJECT), LOCAL).result).output;
    assert.equal(out.grade.earned, 100, lang); assert.equal(out.grade.reason, null, lang);
    assert.equal(out.criteria[0]?.comment, want[lang], lang);
    const named = (await run(raw({ lang, levels: true }), reply(SUBJECT, { levels: true }), LOCAL).result).output;
    assert.equal(named.grade.earned, 60, lang); assert.match(named.criteria[0]?.comment || '', /Proficient \(30\/40 /, lang);
  }
});

test('an incomplete decision still withholds the grade as unassessed material', async () => {
  const replies = (req) => { const r = reply(SUBJECT)(req); if (req.schema.properties.status) Object.assign(r.json, { complete: false, quotes: [], score: null }); return r; };
  const out = (await run(raw(), replies, LOCAL).result).output;
  assert.equal(out.grade.earned, null); assert.equal(out.grade.reason.key, COVERAGE);
});
