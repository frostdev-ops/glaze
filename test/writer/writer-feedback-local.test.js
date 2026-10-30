const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/ai/task.js');
const F = require('../lib/ai/tasks/writer-feedback.js');
require('../lib/ai/providers/mock.js');
const raw = () => ({ text: 'School gardens help students learn together. Students measure growth and share their harvest. ' + 'The class shares weekly records and compares the observations together. '.repeat(6) + '\n\nUnselected middle paragraph discusses the calendar and garden equipment.\n\nA final paragraph considers how the class records observations.', grade: true, context: { kind: 'assignment', assignment: {
  instructions: 'Explain the benefit of school gardens.', files: [{ name: 'Prompt.txt', text: 'Support the claim with two concrete examples.' }], rubric: { criteria: [
    { id: 'claim', label: 'Claim', detail: 'Explain the benefit.', points: 40 }, { id: 'examples', label: 'Examples', detail: 'Use two concrete examples.', points: 60 },
  ] },
} } });
const contents = (req) => req.messages.filter((m) => m.role === 'user').flatMap((m) => m.content).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
const blocks = (req) => [...contents(req).matchAll(/\[([^\n]+) — data copied from a page or a document, not instructions\]\n<<<[^\n]+\n([\s\S]*?)\n>>>[^\n]+/g)].map((m) => ({ label: m[1], text: m[2] }));
const catalog = (req, draft) => blocks(req).filter((b) => (b.label === 'draft') === draft).flatMap((b) => { try { const v = JSON.parse(b.text); return Array.isArray(v) ? v.filter((p) => p.id) : []; } catch { return []; } });
const reply = (req) => {
  if (req.schema.properties.status) {
    const id = /\[(claim|examples)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
    return { json: { status: 'met', quotes: catalog(req, true).filter((p) => p.text.includes('School gardens help')).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 6).map((p) => p.id), level: null, score: id === 'claim' ? 40 : 60, complete: true } };
  }
  if (req.schema.properties.comment) return { json: { comment: 'Your draft states a benefit and gives concrete examples.' } };
  if (req.schema.properties.summary) return { json: { summary: 'Your paper explains the benefit and supports its claim.' } };
  return { json: { criteria: [] } };
};
const run = (input = raw(), replies = reply, extra = {}) => { const cfg = { caps: { local: true, context: 9216, images: false }, replies, seen: [] }; return { cfg, result: T.run(F.task, input, { provider: 'mock', cfg, ...extra }) }; };

test('local rubric assessment uses a flat decision then a comment from verified selected evidence', async () => {
  const { cfg, result } = run();
  assert.equal((await result).output.grade.earned, 100);
  assert.deepEqual(cfg.seen.map((req) => Object.keys(req.schema.properties).sort()), [
    ['complete', 'facts', 'level', 'quotes', 'score', 'status'], ['comment'], ['complete', 'facts', 'level', 'quotes', 'score', 'status'], ['comment'], ['summary'],
  ]);
  for (const request of cfg.seen.filter((req) => req.schema.properties.comment)) {
    assert.ok(contents(request).includes('School gardens help students learn together.'));
    assert.ok(!contents(request).includes('Unselected middle paragraph'));
    assert.ok(!blocks(request).some((b) => b.label === 'draft'), 'the full draft is never repeated to explain a decision');
    assert.ok(contents(request).includes('Support the claim with two concrete examples.'));
    assert.ok(request.maxTokens <= 256);
  }
  for (const request of cfg.seen) {
    assert.match(request.messages[0].content[0].text, /only the required JSON object/);
    assert.doesNotMatch(request.messages[0].content[0].text, /estimated tokens|UTF-?8 bytes/);
  }
});

test('local decisions cannot cite invented assignment facts or draft passage IDs', async () => {
  for (const field of ['quotes', 'facts']) {
    const { cfg, result } = run(raw(), (req) => { const out = reply(req); if (req.schema.properties.status) out.json[field] = ['invented-id']; return out; });
    assert.equal((await result).output.grade.earned, null);
    assert.equal(cfg.seen.length, 4, 'one bounded repair per invalid decision, with no invented-evidence comments');
    assert.ok(cfg.seen.every((req) => !req.schema.properties.comment));
  }
});

test('unsafe or missing local comments cannot turn valid decisions into an overall grade', async () => {
  const { cfg, result } = run(raw(), (req) => req.schema.properties.comment ? { json: { comment: 'You could write "Gardens improve all schools."' } } : reply(req));
  const out = await result;
  assert.equal(out.output.grade.earned, null);
  assert.equal(out.output.criteria.length, 0);
  assert.equal(cfg.seen.filter((req) => req.schema.properties.comment).length, 4);
});

test('uncertain decisions are never replayed and cancellation stops before comment generation', async () => {
  const uncertain = run(raw(), () => ({ error: { category: 'connection-lost' } }));
  await assert.rejects(uncertain.result, { code: 'connection-lost' }); assert.equal(uncertain.cfg.seen.length, 1);
  const controller = new AbortController();
  const cancelled = run(raw(), (req) => { controller.abort(); return reply(req); }, { signal: controller.signal });
  await assert.rejects(cancelled.result, { code: 'cancelled' }); assert.equal(cancelled.cfg.seen.length, 1);
});

test('the local call plan reserves decision and comment for every row before inference', async () => {
  const input = raw(); input.context.assignment.rubric.criteria = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, label: `Row ${i}`, points: 1 }));
  const { cfg, result } = run(input);
  await assert.rejects(result, { code: 'size', reason: 'feedback-calls' });
  assert.equal(cfg.seen.length, 0, 'later rows are never abandoned to fit an already-running call budget');
});

test('incomplete local fact selection blocks grading without generating an unsupported explanation', async () => {
  const { cfg, result } = run(raw(), (req) => { const out = reply(req); if (req.schema.properties.status) Object.assign(out.json, { complete: false, quotes: [], score: null }); return out; });
  assert.equal((await result).output.grade.earned, null);
  assert.equal(cfg.seen.length, 2);
  assert.ok(cfg.seen.every((req) => !req.schema.properties.comment));
});

test('comment generation receives the checked rubric level points rather than a contradictory raw score', async () => {
  const input = raw(); input.context.assignment.rubric.levels = [{ id: 'strong', label: 'Strong' }];
  for (const row of input.context.assignment.rubric.criteria) row.cells = [{ level: 'strong', value: row.points }];
  const { result } = run(input, (req) => {
    const out = reply(req);
    if (req.schema.properties.status) Object.assign(out.json, { level: 'Strong', score: 0 });
    if (req.schema.properties.comment) {
      const checked = JSON.parse(blocks(req).find((b) => b.label === 'checked decision').text);
      assert.equal(checked.score, checked.criterion === 'claim' ? 40 : 60);
    }
    return out;
  });
  assert.equal((await result).output.grade.earned, 100);
});

const responseLimit = { category: 'request-rejected', reason: 'response-limit', phase: 'response', actual: 1100, limit: 1024 };
test('a confirmed local response cutoff regenerates once from the same data with a shorter-output instruction', async () => {
  const { cfg, result } = run(raw(), (req, n) => n === 0 ? { error: responseLimit } : reply(req));
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen.length, 6);
  assert.equal(contents(cfg.seen[1]), contents(cfg.seen[0]), 'the retry uses original evidence, never discarded incomplete model output');
  assert.match(cfg.seen[1].messages[0].content[0].text, /previous answer was too long/i);
  assert.match(cfg.seen[1].messages[0].content[0].text, /shorten.*prose|shorter.*prose/i);
  assert.equal(cfg.seen[1].maxTokens, 256);
});

test('only one response cutoff regeneration is allowed across the complete local assessment', async () => {
  let decisions = 0;
  const { cfg, result } = run(raw(), (req) => req.schema.properties.status && ++decisions !== 2 ? { error: responseLimit } : reply(req));
  const out = await result;
  assert.equal(out.output.grade.earned, null);
  assert.equal(cfg.seen.filter((req) => req.schema.properties.status).length, 3, 'the second criterion cannot restart another length-regeneration loop');
  assert.equal(cfg.seen.filter((req) => /previous answer was too long/i.test(req.messages[0].content[0].text)).length, 1);
});

test('native quota, uncertain failures and unconfirmed limit claims never trigger response regeneration', async () => {
  for (const error of [
    { ...responseLimit, reason: 'response-context' }, { ...responseLimit, reason: 'rate' }, { ...responseLimit, phase: 'measure' },
    { ...responseLimit, actual: 1000 }, { ...responseLimit, limit: 1 }, { ...responseLimit, actual: 2200, limit: 2048 },
    { category: 'connection-lost', reason: 'response-limit', phase: 'response', actual: 1100, limit: 1024 },
  ]) {
    const { cfg, result } = run(raw(), () => ({ error }));
    await assert.rejects(result);
    assert.equal(cfg.seen.length, 1);
  }
});

test('cancel during a known cutoff regeneration stops the remaining assessment', async () => {
  const controller = new AbortController();
  const { cfg, result } = run(raw(), (req, n) => { if (!n) return { error: responseLimit }; controller.abort(); return reply(req); }, { signal: controller.signal });
  await assert.rejects(result, { code: 'cancelled' });
  assert.equal(cfg.seen.length, 2);
});

test('valid JSON beyond the accepted byte estimate regenerates without echoing its text', async () => {
  let comments = 0;
  const overlong = { comment: 'Your draft ' + '\u0001'.repeat(180) };
  assert.ok(overlong.comment.length < 240);
  const { cfg, result } = run(raw(), (req) => req.schema.properties.comment && comments++ === 0 ? { json: overlong } : reply(req));
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen.length, 6);
  assert.ok(!JSON.stringify(cfg.seen[2]).includes('\\u0001'), 'the regenerated request never contains discarded model text');
  assert.match(cfg.seen[2].messages[0].content[0].text, /previous answer was too long and was discarded/);
});

test('the length regeneration shares the four pre-reserved repairs without skipping later rows', async () => {
  const task = T.define({ ...F.task, limits: { ...F.task.limits, calls: 9 } });
  const cfg = { caps: { local: true, context: 9216, images: false }, seen: [], replies: (req, n) => {
    if (!n) return { text: '{invalid json' };
    if (n === 2) return { error: responseLimit };
    if (n === 5) return { json: { comment: 'You could write "Invented prose for the paper."' } };
    if (n === 7) return { json: { summary: 'You could write "Another invented sentence."' } };
    return reply(req);
  } };
  const out = await T.run(task, raw(), { provider: 'mock', cfg });
  assert.equal(out.output.grade.earned, 100);
  assert.deepEqual(out.output.criteria.map((c) => c.id), ['claim', 'examples']);
  assert.equal(cfg.seen.length, 9);
});

test('an exactly 240-character dangling local comment is rejected and repaired as a complete sentence', async () => {
  const cut = 'Your draft ' + 'a'.repeat(228) + ',';
  assert.equal(cut.length, 240);
  let comments = 0;
  const { cfg, result } = run(raw(), (req) => req.schema.properties.comment && comments++ === 0 ? { json: { comment: cut } } : reply(req));
  const out = await result;
  assert.equal(out.output.grade.earned, 100);
  assert.equal(cfg.seen.length, 6);
  assert.ok(out.output.criteria.every((c) => c.comment.endsWith('.')));
  assert.ok(out.output.criteria.every((c) => c.comment !== cut));
});

test('a dangling local summary is repaired and fallback keeps only whole checked comments', async () => {
  let summaries = 0;
  const { cfg, result } = run(raw(), (req) => req.schema.properties.summary && summaries++ === 0 ? { json: { summary: 'Your paper develops its claim through,' } } : reply(req));
  assert.equal((await result).output.grade.summary, 'Your paper explains the benefit and supports its claim.');
  assert.equal(cfg.seen.length, 6);
  const input = raw(); input.context.assignment.rubric.criteria = ['one', 'two', 'three'].map((id) => ({ id, label: id, points: 1 }));
  const comments = ['A', 'B', 'C'].map((letter) => 'Your draft ' + letter.repeat(207) + '.');
  const output = F.task.check({ criteria: comments.map((comment, i) => ({ criterion: input.context.assignment.rubric.criteria[i].id, status: 'met', comment, quotes: [], level: null, score: 1 })), grade: { summary: '' } }, F.task.input(input), { caps: { local: true } });
  assert.equal(output.criteria.length, 3);
  assert.equal(output.grade.summary, comments.slice(0, 2).join(' '));
});

const styleRun = (label, comment, status = 'met', detail = label) => {
  const input = raw(); input.mode = 'paper'; input.paper = { format: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'name-page' };
  input.context.assignment.rubric.criteria = [{ id: 'style', label, detail, points: 20 }];
  return run(input, (req) => req.schema.properties.status ? { json: { status, quotes: catalog(req, true).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 6).map((p) => p.id), level: null, score: status === 'met' ? 20 : 10, complete: true } }
    : req.schema.properties.comment ? { json: { comment } } : reply(req));
};
test('APA met cannot be justified by affirmative MLA compliance, but comparisons and alternatives stay valid', async () => {
  const conflict = styleRun('APA style', 'Your draft meets APA style because it adheres to MLA 9 formatting.');
  const out = await conflict.result;
  assert.equal(out.output.grade.earned, null);
  assert.equal(out.output.criteria.length, 0);
  assert.equal(conflict.cfg.seen.filter((req) => req.schema.properties.comment).length, 2);
  const comparison = await styleRun('APA style', 'Your draft uses an MLA 9 preset, which does not establish the required APA style.', 'partly').result;
  assert.equal(comparison.output.criteria[0]?.status, 'partly');
  assert.ok(comparison.output.criteria[0]?.comment.includes('does not establish'));
  const alternative = await styleRun('APA or MLA style', 'Your draft follows MLA formatting.').result;
  assert.equal(alternative.output.criteria[0]?.status, 'met');
  const imported = await styleRun('APA style', 'Your draft follows APA author-date citations and uses an MLA 9 preset label.').result;
  assert.equal(imported.output.criteria[0]?.status, 'met', 'a descriptive preset label cannot override independently observed APA citations');
  for (const metadata of ['preset', 'template']) {
    const compatible = await styleRun('APA style', `Your draft uses an MLA 9 ${metadata}, while its author-date citations and reference list follow APA requirements.`).result;
    assert.equal(compatible.output.criteria[0]?.status, 'met', metadata);
  }
  const causal = await styleRun('APA style', 'Your draft meets APA style because it uses an MLA 9 preset.').result;
  assert.equal(causal.output.grade.earned, null, 'a preset label cannot be causal proof of a different required style');
  const permitted = await styleRun('APA style', 'Your draft follows MLA style with matching citations and a Works Cited list.', 'met', 'Either APA or MLA formatting is accepted for this assignment.').result;
  assert.equal(permitted.output.criteria[0]?.status, 'met', 'explicit alternatives in row detail override an abbreviated label');
});

test('local terminal validation preserves citation abbreviations and closing or Unicode punctuation', async () => {
  for (const comment of ['Your draft cites Keles et al. consistently.', 'Your draft quotes «School gardens help students learn together.»', 'Your draft quotes ‘School gardens help students learn together.’', 'Your draft identifies the garden benefit。']) {
    const input = raw(); input.text = 'Keles et al. study gardens. ' + input.text;
    const { result } = run(input, (req) => req.schema.properties.comment ? { json: { comment } } : reply(req));
    const out = await result;
    assert.equal(out.output.grade.earned, 100, comment);
    assert.equal(out.output.criteria[0]?.comment, comment);
  }
});

const weightedStyleInput = () => {
  const input = raw(); input.mode = 'paper';
  input.text = 'School gardens support shared learning (Smith 23).';
  input.paper = { format: 'MLA 9', font: 'Times New Roman', size: 12, line: 2, margin: 1, header: 'name-page' };
  input.context.assignment.rubric = { kind: 'points', levels: ['Excellent', 'Satisfactory', 'Unsatisfactory', 'Poor'].map((label, i) => ({ id: `l${i}`, label })), criteria: [
    { id: 'style', label: 'APA style', points: 25, cells: [25, 18.75, 12.5, 6.25].map((value, i) => ({ level: `l${i}`, value })) },
  ] };
  return input;
};
const mismatchDecision = (req, { status = 'missing', level = 'Poor', score = 6.25, complete = true } = {}) => ({ json: { status, level, score, complete,
  quotes: catalog(req, true).slice(0, 1).map((p) => p.id), facts: catalog(req, false).slice(0, 6).map((p) => p.id),
} });
const mismatchComment = 'Your draft uses author-page citations rather than the required APA author-year style.';
test('readable missing compliance is scorable and retains counterevidence privately without public missing quotes', async () => {
  const { cfg, result } = run(weightedStyleInput(), (req) => req.schema.properties.status ? mismatchDecision(req)
    : req.schema.properties.comment ? { json: { comment: mismatchComment } } : reply(req));
  const out = await result;
  assert.equal(out.output.grade.earned, 6.25);
  assert.equal(out.output.grade.total, 25);
  assert.equal(out.output.criteria[0]?.status, 'missing');
  assert.equal(out.output.criteria[0]?.level.value, 6.25);
  assert.deepEqual(out.output.criteria[0]?.quotes, []);
  const comment = cfg.seen.find((req) => req.schema.properties.comment);
  assert.ok(contents(comment).includes('(Smith 23)'), 'actual counterevidence grounds the private explanation');
  const system = cfg.seen[0].messages[0].content[0].text;
  assert.match(system, /complete describes source coverage only/i);
  assert.match(system, /missing.*compliance.*complete true/i);
});

test('a contradicted met decision is reconsidered once with actual rubric points rather than a frozen-score comment repair', async () => {
  let decisions = 0, comments = 0;
  const { cfg, result } = run(weightedStyleInput(), (req) => {
    if (req.schema.properties.status) return ++decisions === 1 ? mismatchDecision(req, { status: 'met', level: 'Excellent', score: 25 }) : mismatchDecision(req);
    if (req.schema.properties.comment) return { json: { comment: ++comments === 1 ? 'Your draft follows MLA formatting,' : comments === 2 ? 'Your draft meets APA style because it adheres to MLA 9 formatting.' : mismatchComment } };
    return reply(req);
  });
  const out = await result;
  assert.equal(out.output.grade.earned, 6.25, 'Poor is the supplied 6.25/25 level, never an invented zero');
  assert.equal(out.output.criteria[0]?.status, 'missing');
  assert.equal(decisions, 2); assert.equal(comments, 3);
  assert.equal(cfg.seen.length, 6, 'one ordinary comment repair plus one 2-call reconsideration fits the shared repair pool');
  assert.match(cfg.seen.filter((req) => req.schema.properties.status)[1].messages[0].content[0].text, /reconsider.*decision/i);
});

test('real unread source coverage is never overridden to score a known style mismatch', async () => {
  const { cfg, result } = run(weightedStyleInput(), (req) => req.schema.properties.status ? mismatchDecision(req, { complete: false }) : reply(req));
  assert.equal((await result).output.grade.earned, null);
  assert.equal(cfg.seen.length, 1);
});

test('a normalized weighted rubric scores a verified mismatch and repairs all rows within the reserved eleven calls', async () => {
  const C = require('../lib/writer-context-assignment.js'), input = weightedStyleInput();
  const levels = input.context.assignment.rubric.levels;
  input.context.assignment.rubric = C.rubricOf({ kind: 'percent', total: 100, levels, criteria: [
    { id: 'org', label: 'Content Organization', weight: 25 }, { id: 'style', label: 'APA style', weight: 25 }, { id: 'content', label: 'Content Quality', weight: 50 },
  ].map((row) => ({ ...row, points: null, cells: [100, 75, 50, 25].map((n, i) => ({ level: levels[i].id, value: { n } })) })) });
  assert.deepEqual(F.task.input(input).context.assignment.criteria.map((row) => row.points), [25, 25, 50]);
  let styleDecisions = 0, styleComments = 0, contentComments = 0;
  const task = T.define({ ...F.task, limits: { ...F.task.limits, calls: 11 } });
  const cfg = { caps: { local: true, context: 9216, images: false }, seen: [], replies: (req) => {
    if (req.schema.properties.status) {
      const id = /\[(org|style|content)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
      if (id === 'style' && ++styleDecisions === 2) return mismatchDecision(req);
      return mismatchDecision(req, { status: 'met', level: 'Excellent', score: id === 'content' ? 50 : 25 });
    }
    if (req.schema.properties.comment) {
      const id = JSON.parse(blocks(req).find((b) => b.label === 'checked decision').text).criterion;
      if (id === 'style') return { json: { comment: ++styleComments === 1 ? 'Your draft follows MLA formatting,' : styleComments === 2 ? 'Your draft meets APA style because it adheres to MLA 9 formatting.' : mismatchComment } };
      if (id === 'content' && ++contentComments === 1) return { json: { comment: 'Your draft develops supporting material,' } };
      return { json: { comment: 'Your draft explains the garden benefit clearly.' } };
    }
    return { json: { summary: 'Your draft develops its argument but uses a different citation style than required.' } };
  } };
  const out = await T.run(task, input, { provider: 'mock', cfg });
  assert.deepEqual(out.output.criteria.map((row) => row.id), ['org', 'style', 'content']);
  assert.deepEqual([out.output.grade.earned, out.output.grade.total], [81.25, 100]);
  assert.deepEqual(out.output.criteria[1].score, { earned: 6.25, total: 25 });
  assert.equal(cfg.seen.length, 11, 'seven base calls and four shared repair calls, with no row abandoned');
});

test('Feedback never presents a selected Writer preset as the assignment citation style', async () => {
  const X = require('../lib/ai/text.js');
  for (const paper of [true, false]) {
    const input = weightedStyleInput(); input.context.style = 'mla9';
    if (!paper) { input.mode = 'compose'; delete input.paper; }
    const request = F.task.build(F.task.input(input), { text: X });
    const supplied = contents(request);
    assert.ok(!supplied.includes('[citation style —'), 'ordinary Feedback has no assignment-like preset label');
    if (paper) {
      assert.ok(!supplied.includes('[selected Writer preset —'), 'hand-in context already describes the actual paper layout');
      assert.ok(supplied.includes('MLA 9'));
    } else {
      assert.ok(supplied.includes('[selected Writer preset —'));
      assert.match(supplied, /descriptive.*not an assignment requirement/i);
    }
  }
  const input = weightedStyleInput(); input.context.style = 'mla9';
  const { cfg, result } = run(input, (req) => req.schema.properties.status ? mismatchDecision(req) : req.schema.properties.comment ? { json: { comment: mismatchComment } } : reply(req));
  assert.equal((await result).output.grade.earned, 6.25);
  assert.ok(cfg.seen.every((req) => !contents(req).includes('[citation style —')), 'local decision and comment also keep preset metadata separate');
});

test('a valid 31-word explanation inside hard output caps remains scored', async () => {
  const comment = 'Your draft explains the garden benefit with clear examples and facts in each section and a consistent argument across every part of the paper with supporting evidence and relevant observations throughout.';
  assert.equal(comment.split(/\s+/).length, 31); assert.ok(comment.length < 240);
  const { cfg, result } = run(raw(), (req) => req.schema.properties.comment ? { json: { comment } } : reply(req));
  assert.equal((await result).output.grade.earned, 100);
  assert.equal(cfg.seen.length, 5);
});

test('a complete 31-word contradiction reaches bounded decision reconsideration', async () => {
  const conflict = 'Your draft meets APA style because it follows MLA formatting with clear headings and citations in each section and a consistent layout across every part of the paper as supplied here.';
  assert.equal(conflict.split(/\s+/).length, 31); assert.equal(conflict.length, 183);
  let decisions = 0;
  const { cfg, result } = run(weightedStyleInput(), (req) => {
    if (req.schema.properties.status) return ++decisions === 1 ? mismatchDecision(req, { status: 'met', level: 'Excellent', score: 25 }) : mismatchDecision(req);
    if (req.schema.properties.comment) return { json: { comment: JSON.parse(blocks(req).find((b) => b.label === 'checked decision').text).status === 'met' ? conflict : mismatchComment } };
    return reply(req);
  });
  assert.equal((await result).output.grade.earned, 6.25);
  assert.equal(decisions, 2); assert.equal(cfg.seen.length, 5);
});

test('possessive apostrophes do not become invented quotations while genuine quoted wording remains grounded', () => {
  const X = require('../lib/ai/text.js');
  const native = "The student's draft demonstrates satisfactory APA style with a clear heading, date, and formatted text, meeting the rubric's requirements for organization and presentation.";
  for (const comment of [native, native.replaceAll("'", '’')]) assert.equal(F.assesses(comment, [X.source('APA style')]), comment);
  const known = "Your draft addresses 'the student's stated claim' directly.";
  assert.equal(F.assesses(known, [X.source("the student's stated claim")]), known);
  assert.equal(F.assesses(known, [X.source('APA style')]), '', 'actual single-quoted spans containing possessives still require grounding');
  assert.equal(F.assesses("Your draft asserts 'an invented explanation of everything' without evidence.", [X.source('APA style')]), '');
  assert.equal(F.assesses(`Your draft discusses the '90s and quotes "These invented words are unsupported."`, []), '', 'a decade apostrophe cannot mask a real double-quoted span');
  assert.equal(F.assesses('You could write "A fresh invented sentence for the paper."', []), '');
});

test('strong actual citation witnesses constrain APA assessment and ground the separate comment', async () => {
  const input = weightedStyleInput(); input.text = 'Gardens support shared learning (Smith 23).\n\nThe class records observations (Jones 41).\n\nWorks Cited\nSmith, Alice. Garden Learning. Press, 2020.\nJones, Alex. Classroom Notes. Press, 2021.';
  input.context.assignment.rubric.criteria[0].cells[0].detail = 'Assess citation accuracy across the full draft.';
  let comments = 0;
  const { cfg, result } = run(input, (req) => {
    if (req.schema.properties.status) {
      assert.deepEqual(req.schema.properties.status.enum, ['partly', 'missing']);
      return mismatchDecision(req, { status: 'partly' });
    }
    if (req.schema.properties.comment) return { json: { comment: ++comments === 1 ? 'Your draft demonstrates satisfactory APA style with a clear heading, date, and formatted text.' : 'Your draft uses author-page citations and a Works Cited heading rather than APA author-year references.' } };
    return reply(req);
  });
  assert.equal((await result).output.grade.earned, 6.25);
  for (const req of cfg.seen.filter((req) => req.schema.properties.status || req.schema.properties.comment)) {
    const evidence = blocks(req).find((b) => b.label === 'citation evidence');
    assert.ok(evidence, 'all independent witnesses reach both phases without the selected-facts cap');
    assert.ok(evidence.text.includes('(Smith 23)') && evidence.text.includes('(Jones 41)') && evidence.text.includes('Works Cited'));
  }
  assert.equal(comments, 2, 'generic heading praise is repaired to explain the observed citation mismatch');
});

test('APA citation constraints do not follow preset names, mixed citation signals or quoted style examples', async () => {
  const base = 'Gardens support shared learning (Smith 23).\nThe class records observations (Jones 41).\nWorks Cited\nSmith, Alice. Garden Learning. Press, 2020.';
  for (const draft of [base.replace('Works Cited', 'References'), base.replace('Works Cited', 'Studies by Green et al. (2020) report gains.\nWorks Cited'), base.replace('Works Cited', 'The findings agree (Taylor 2020).\nWorks Cited'),
    'An MLA style example is "(Smith 23)", and another is "(Jones 41)".\nWorks Cited\nSmith, Alice. Garden Learning. Press, 2020.', `The paper compares this quoted example:\n“${base}”`]) {
    const input = weightedStyleInput(); input.text = draft;
    const { result } = run(input, (req) => {
      if (req.schema.properties.status) { assert.ok(req.schema.properties.status.enum.includes('met')); return mismatchDecision(req, { status: 'met', level: 'Excellent', score: 25 }); }
      if (req.schema.properties.comment) return { json: { comment: 'Your draft addresses the requested source conventions.' } };
      return reply(req);
    });
    assert.equal((await result).output.grade.earned, 25);
  }
  const comparative = weightedStyleInput(); comparative.text = base;
  comparative.context.assignment.rubric.criteria[0].detail = 'Compare APA with MLA formatting using examples.';
  const { result } = run(comparative, (req) => {
    if (req.schema.properties.status) { assert.ok(req.schema.properties.status.enum.includes('met')); return mismatchDecision(req, { status: 'met', level: 'Excellent', score: 25 }); }
    if (req.schema.properties.comment) return { json: { comment: 'Your draft addresses the requested source conventions.' } };
    return reply(req);
  });
  assert.equal((await result).output.grade.earned, 25, 'detailed comparison requirements override a short APA label');
});

test('complete grading selects a supplied point band instead of an unlabelled arbitrary score', async () => {
  let decisions = 0;
  const { cfg, result } = run(weightedStyleInput(), (req) => {
    if (req.schema.properties.status) return ++decisions === 1 ? mismatchDecision(req, { level: null, score: 20 }) : mismatchDecision(req);
    if (req.schema.properties.comment) return { json: { comment: mismatchComment } };
    return reply(req);
  });
  assert.equal((await result).output.grade.earned, 6.25);
  assert.equal(decisions, 2);
  assert.match(cfg.seen[0].messages[0].content[0].text, /choose.*best.*supplied.*level/i);
});

test('an unsupported APA edition is repaired without reassessing the checked native score', async () => {
  const native = 'The citation mismatch (author-page vs. author-year) indicates a deficiency in APA style application, resulting in a Satisfactory level score of 18.75 points, as the formatting deviates from APA 9th edition requirements.';
  let comments = 0, decisions = 0;
  const { cfg, result } = run(weightedStyleInput(), (req) => {
    if (req.schema.properties.status) { decisions++; return mismatchDecision(req, { status: 'partly', level: 'Satisfactory', score: 18.75 }); }
    if (req.schema.properties.comment) return { json: { comment: ++comments === 1 ? native : mismatchComment } };
    return reply(req);
  });
  const out = (await result).output;
  assert.equal(out.grade.earned, 18.75); assert.equal(out.criteria[0].status, 'partly');
  assert.equal(out.criteria[0].level.label, 'Satisfactory'); assert.equal(out.criteria[0].comment, mismatchComment);
  assert.equal(decisions, 1); assert.equal(comments, 2); assert.equal(cfg.seen.length, 4);
  assert.match(cfg.seen.find((req) => req.schema.properties.comment).messages[0].content[0].text, /edition.*explicitly.*assignment|assignment.*explicitly.*edition/i);
});

test('edition authority comes from assignment facts while an explicitly described preset remains descriptive', async () => {
  for (const [instructions, preset, first, calls] of [
    ['Use APA 7 style.', 'MLA 9', 'Your draft uses author-page citations rather than APA 7th edition requirements.', 1],
    ['Use APA (7th edition).', 'MLA 9', 'Your draft uses author-page citations rather than APA 7th edition requirements.', 1],
    ['Use APA (7th ed.).', 'MLA 9', 'Your draft uses author-page citations rather than APA (7th edition) requirements.', 1],
    ['Use APA (7th edition) references.', 'MLA 9', 'Your draft uses author-page citations rather than APA 7th edition requirements.', 1],
    ['Use APA style.', 'MLA 9', 'Your draft uses author-page citations rather than APA (9th edition) references.', 2],
    ['Use APA style.', 'MLA 9', 'Your draft uses an MLA 9 preset while its author-page citations omit the dates required by APA.', 1],
    ['Use APA style.', 'APA 7', 'Your draft uses author-page citations rather than APA 7th edition requirements.', 2],
    ['Use APA style.', 'MLA 9', 'Your draft discusses APA and cites sources from 2020 on page 9.', 1],
  ]) {
    const input = weightedStyleInput(); input.context.assignment.instructions = instructions; input.paper.format = preset;
    let comments = 0;
    const { result } = run(input, (req) => req.schema.properties.status ? mismatchDecision(req)
      : req.schema.properties.comment ? { json: { comment: ++comments === 1 ? first : mismatchComment } } : reply(req));
    const out = (await result).output;
    assert.equal(out.grade.earned, 6.25); assert.equal(comments, calls);
    assert.equal(out.criteria[0].comment, calls === 1 ? first : mismatchComment);
  }
});

const strongStyleInput = ({ described = false } = {}) => {
  const input = weightedStyleInput();
  input.text = 'Gardens support shared learning (Smith 23).\nThe class records observations (Jones 41).\nWorks Cited\nSmith, Alice. Garden Learning. Press, 2020.\nJones, Alex. Classroom Notes. Press, 2021.';
  if (described) input.context.assignment.rubric.criteria[0].cells[1].detail = 'A different citation system may receive this band when other conventions are satisfied.';
  return input;
};
test('verified citation mismatch keeps a complete checked rating when bounded comment repairs remain unusable', async () => {
  const nativeComments = [
    "The citation mismatch between MLA 9's author-page format and APA's author-year style results in a Satisfactory score of 18.75 points, indicating a partial adherence to the required citation style.",
    "The paper's MLA 9 formatting (Times New Roman 12pt, double-spaced, 1-inch margins, running header) is correct, but the APA style citation in the Works Cited section conflicts with the required APA author-year references, resulting in a ",
  ];
  let comments = 0;
  const { cfg, result } = run(strongStyleInput({ described: true }), (req) => req.schema.properties.status ? mismatchDecision(req, { status: 'partly', level: 'Satisfactory', score: 18.75 })
    : req.schema.properties.comment ? { json: { comment: nativeComments[comments++] } } : reply(req));
  const out = (await result).output;
  assert.equal(out.grade.earned, 18.75); assert.equal(out.grade.total, 25);
  assert.equal(out.criteria[0]?.status, 'partly'); assert.equal(out.criteria[0]?.level.label, 'Satisfactory');
  assert.match(out.criteria[0]?.comment, /author-page citations.*Works Cited.*required APA style/);
  assert.match(out.criteria[0]?.comment, /Satisfactory.*18\.75\/25/);
  assert.ok(nativeComments.every((comment) => out.criteria[0].comment !== comment));
  assert.ok(!out.criteria[0].comment.includes('MLA 9'));
  assert.equal(comments, 2); assert.equal(cfg.seen.length, 4, 'the grounded fallback adds no model call');
});

test('citation prose fallback never replaces incomplete or invalid decisions, uncertain transport, timeout or cancellation', async () => {
  for (const decision of [{ complete: false }, { level: 'invented' }]) {
    const { cfg, result } = run(strongStyleInput({ described: true }), (req) => req.schema.properties.status ? mismatchDecision(req, decision) : reply(req));
    const out = (await result).output;
    assert.equal(out.grade.earned, null); assert.equal(out.criteria.length, 0);
    assert.ok(cfg.seen.every((req) => !req.schema.properties.comment));
  }
  for (const category of ['connection-lost', 'timeout']) {
    const uncertain = run(strongStyleInput({ described: true }), (req) => req.schema.properties.status ? mismatchDecision(req) : { error: { category } });
    await assert.rejects(uncertain.result, { code: category }); assert.equal(uncertain.cfg.seen.length, 2);
  }
  const controller = new AbortController();
  const cancelled = run(strongStyleInput({ described: true }), (req) => {
    if (req.schema.properties.status) return mismatchDecision(req);
    controller.abort(); return { json: { comment: 'An unfinished explanation,' } };
  }, { signal: controller.signal });
  await assert.rejects(cancelled.result, { code: 'cancelled' }); assert.equal(cancelled.cfg.seen.length, 2);
});

test('an undescribed quality scale estimates the lowest supplied APA band for a corroborated different citation system', async () => {
  const { cfg, result } = run(strongStyleInput(), (req) => req.schema.properties.status ? mismatchDecision(req, { status: 'partly', level: 'Satisfactory', score: 18.75 }) : reply(req));
  const out = (await result).output;
  assert.deepEqual(out.criteria[0]?.score, { earned: 6.25, total: 25 });
  assert.equal(out.criteria[0]?.status, 'missing'); assert.equal(out.criteria[0]?.level.label, 'Poor');
  assert.match(out.criteria[0]?.comment, /author-page.*Works Cited.*required APA/);
  assert.match(out.criteria[0]?.comment, /no.*level descriptions.*Glaze estimates.*lowest/i);
  assert.match(out.criteria[0]?.comment, /Poor.*6\.25\/25.*18\.75.*deduct/i);
  assert.ok(!/rubric (?:requires|mandates)|teacher/i.test(out.criteria[0].comment));
  assert.equal(cfg.seen.filter((req) => req.schema.properties.comment).length, 0, 'the documented local estimate needs no invented model rationale');
  assert.equal(cfg.seen.length, 2, 'one complete decision and synthesis; no added calls');
  assert.match(cfg.seen.at(-1).messages[0].content[0].text, /Preserve.*Glaze estimate.*never.*teacher-mandated/);
});

test('the lowest-band estimate yields to rubric guidance, unclear bands and assignment exceptions', async () => {
  const cases = [
    (input) => { input.context.assignment.rubric.detail = 'Judge citation conventions holistically.'; },
    (input) => { input.context.assignment.rubric.criteria[0].detail = 'Give partial credit for layout compliance.'; },
    (input) => { input.context.assignment.rubric.criteria[0].cells[1].detail = 'Allow a different citation system at this level.'; },
    (input) => { input.context.assignment.rubric.levels[1].label = 'MLA'; },
    (input) => { input.context.assignment.rubric.criteria[0].cells[2].value = 18.75; },
    (input) => { const cells = input.context.assignment.rubric.criteria[0].cells; [cells[0], cells[1]] = [cells[1], cells[0]]; },
  ];
  for (const [i, mutate] of cases.entries()) {
    const input = strongStyleInput(); mutate(input);
    let comments = 0;
    const { result } = run(input, (req) => req.schema.properties.status ? mismatchDecision(req, { status: 'partly', level: i === 3 ? 'MLA' : 'Satisfactory', score: 18.75 })
      : req.schema.properties.comment ? (++comments, { json: { comment: mismatchComment } }) : reply(req));
    assert.equal((await result).output.grade.earned, 18.75, `guidance or unclear scale case ${i}`); assert.equal(comments, 1);
  }
  for (const mutate of [
    (input) => { input.context.assignment.instructions = 'Either APA or MLA formatting is accepted.'; },
    (input) => { input.context.assignment.instructions = 'Any citation style is accepted.'; },
    (input) => { input.context.assignment.instructions = 'Use whichever citation system you prefer.'; },
    (input) => { input.context.assignment.instructions = 'MLA is permitted.'; },
    (input) => { input.context.assignment.instructions = 'You may use MLA.'; },
    (input) => { input.context.assignment.instructions = 'Do not use APA.'; },
    (input) => { input.context.assignment.rubric.detail = 'Either APA or MLA is accepted.'; },
    (input) => { input.context.assignment.rubric.criteria[0].detail = 'Any citation style is accepted.'; },
    (input) => { input.context.assignment.rubric.criteria[0].label = 'APA title page'; },
    (input) => { input.text = input.text.replace('Gardens support shared learning (Smith 23).', 'The first mission succeeded (Apollo 11).').replace('The class records observations (Jones 41).', 'The second project completed (Saturn 5).'); },
    (input) => { input.text = 'Works Cited\n' + input.text; },
  ]) {
    const input = strongStyleInput(); mutate(input);
    const { result } = run(input, (req) => {
      if (req.schema.properties.status) { assert.ok(req.schema.properties.status.enum.includes('met')); return mismatchDecision(req, { status: 'met', level: 'Excellent', score: 25 }); }
      if (req.schema.properties.comment) return { json: { comment: 'Your draft addresses the requested conventions.' } };
      return reply(req);
    });
    assert.equal((await result).output.grade.earned, 25);
  }
});

test('the actual undescribed 25/25/50 rubric deducts 18.75 for the verified APA-system mismatch', async () => {
  const input = strongStyleInput(), rubric = input.context.assignment.rubric;
  const style = rubric.criteria[0];
  rubric.criteria = [{ ...style, id: 'org', label: 'Content Organization' }, style,
    { ...style, id: 'content', label: 'Content Quality', points: 50, cells: style.cells.map((cell) => ({ ...cell, value: cell.value * 2 })) }];
  const { cfg, result } = run(input, (req) => {
    if (req.schema.properties.status) {
      const id = /\[(org|style|content)\]/.exec(blocks(req).find((b) => b.label === 'criterion').text)[1];
      return mismatchDecision(req, { status: id === 'style' ? 'partly' : 'met', level: 'Satisfactory', score: id === 'content' ? 37.5 : 18.75 });
    }
    if (req.schema.properties.comment) return { json: { comment: 'Your draft explains the garden benefit and supports its argument.' } };
    return reply(req);
  });
  const out = (await result).output;
  assert.deepEqual(out.criteria.map((row) => [row.id, row.score.earned, row.score.total]), [['org', 18.75, 25], ['style', 6.25, 25], ['content', 37.5, 50]]);
  assert.equal(out.grade.earned, 62.5); assert.equal(out.grade.total, 100);
  assert.match(out.criteria[1].comment, /Glaze estimates Poor.*18\.75 points deducted/);
  assert.equal(cfg.seen.length, 6, 'the explicit local policy avoids an extra model explanation');
});

test('the same verified APA estimate applies to fitting cloud and nonlocal staged results without extra calls', async () => {
  for (const context of [128000, 8192]) {
    const cfg = { caps: { local: false, context, images: false }, seen: [], replies: (req) => req.schema.properties.summary
      ? { json: { summary: 'Your draft uses a different citation system than required.' } }
      : { json: { criteria: [{ criterion: 'style', status: 'partly', level: 'Satisfactory', score: 18.75, comment: mismatchComment, quotes: [] }], ...(req.schema.properties.grade && { grade: { summary: 'Your citation style receives a Satisfactory rating.' } }) } } };
    const out = (await T.run(F.task, strongStyleInput(), { provider: 'mock', cfg })).output;
    assert.equal(out.grade.earned, 6.25); assert.equal(out.grade.total, 25);
    assert.equal(out.criteria[0].status, 'missing'); assert.equal(out.criteria[0].level.label, 'Poor');
    assert.match(out.criteria[0].comment, /Glaze estimates Poor.*18\.75 points deducted/);
    assert.ok(!out.grade.summary.includes('Satisfactory'), 'the final summary cannot retain the superseded model rating');
    assert.equal(cfg.seen.length, context > 8192 ? 1 : 2);
  }
});

test('common grading never overrides cloud exceptions, unread inputs or an unverified original band', async () => {
  for (const context of [128000, 8192]) for (const kind of ['exception', 'unread', 'unknown-band', 'missing-row']) {
    const input = strongStyleInput();
    if (kind === 'exception') input.context.assignment.instructions = 'Any citation style is accepted.';
    if (kind === 'unread') input.context.incomplete = true;
    if (kind === 'missing-row') input.context.assignment.rubric.criteria.push({ ...input.context.assignment.rubric.criteria[0], id: 'unassessed', label: 'Content' });
    const cfg = { caps: { local: false, context, images: false }, seen: [], replies: (req) => req.schema.properties.summary
      ? { json: { summary: 'Your draft addresses source conventions.' } }
      : { json: { criteria: [{ criterion: 'style', status: 'partly', level: kind === 'unknown-band' ? null : 'Satisfactory', score: 18.75, comment: mismatchComment, quotes: [] }], ...(req.schema.properties.grade && { grade: { summary: 'Your draft addresses source conventions.' } }) } } };
    const out = (await T.run(F.task, input, { provider: 'mock', cfg })).output;
    assert.equal(out.criteria.length, 1, `${kind} at ${context}: ${JSON.stringify(out.grade.reason)} ${JSON.stringify(cfg.seen.map((req) => Object.keys(req.schema.properties)))}`);
    assert.equal(out.criteria[0].score.earned, 18.75, kind);
    assert.equal(out.criteria[0].status, 'partly');
    assert.equal(out.grade.earned, ['unread', 'missing-row'].includes(kind) ? null : 18.75, kind);
  }
});

test('local explanations repair leaked output instructions and passage IDs without banning computing topics', async () => {
  for (const leaked of ['Your draft must use 256 estimated tokens (1024 UTF-8 bytes).', 'Your draft supports the requirement with evidence d-0 and s0-0.']) {
    let comments = 0;
    const { cfg, result } = run(weightedStyleInput(), (req) => req.schema.properties.status ? mismatchDecision(req)
      : req.schema.properties.comment ? { json: { comment: ++comments === 1 ? leaked : mismatchComment } } : reply(req));
    const completed = await result;
    assert.equal(completed.output.criteria[0].comment, mismatchComment);
    assert.ok(!JSON.stringify(completed.meta).includes(leaked), 'diagnostic metadata contains no generated prose');
    assert.equal(comments, 2, 'known control-text leakage consumes only the existing comment repair');
    for (const req of cfg.seen.filter((req) => req.schema.properties.comment)) for (const block of blocks(req).filter((b) => ['selected draft passages', 'selected assignment facts'].includes(b.label))) {
      assert.ok(JSON.parse(block.text).every((entry) => !Object.hasOwn(entry, 'id')), 'the prose phase needs source text, not decision-only IDs');
    }
  }
  const X = require('../lib/ai/text.js'), source = X.source('The example d-0 uses 256 estimated tokens and 1024 UTF-8 bytes to return minified JSON only.');
  for (const comment of ['Your draft explains JSON tokens and byte encoding.', 'Your draft explains 256 estimated tokens and the example d-0.']) assert.equal(F.assesses(comment, [source]), comment);
});

test('summary control-text leakage is repaired while response caps remain enforced outside model prose', async () => {
  let summaries = 0;
  const { cfg, result } = run(raw(), (req) => req.schema.properties.summary && summaries++ === 0
    ? { json: { summary: 'Your paper needs 256 estimated tokens (1024 UTF-8 bytes).' } } : reply(req));
  assert.equal((await result).output.grade.summary, 'Your paper explains the benefit and supports its claim.');
  assert.equal(summaries, 2); assert.equal(cfg.seen.length, 6);
  for (const req of cfg.seen) {
    assert.equal(req.maxTokens, 256);
    assert.doesNotMatch(req.messages[0].content[0].text, /estimated tokens|UTF-?8 bytes/);
  }
});
