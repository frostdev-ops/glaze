const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const lib = () => require('../lib/rubric.js');
const copy = (x) => structuredClone(x);
const cc = { courseId: '101', assignmentId: '7', userId: '21' };
const uc = { courseId: '_101_1', contentId: '_7_1', columnId: '_8_1', columnBound: true, userId: '_21_1', attemptId: '_22_1', state: 'graded', pointsPossible: 20 };
const canvas = () => ({ id: 7, course_id: 101, points_possible: 25,
  rubric_settings: { id: 9, title: 'Lab rubric', points_possible: 20 },
  rubric: [
    { id: 'crit1', description: 'Analysis', long_description: 'Explain <literal>.', points: 10,
      ratings: [{ id: 'high', description: 'Complete', points: 10 }, { id: 'low', description: 'Missing', points: 0 }] },
    { id: 'crit2', description: 'Sources', points: 10,
      ratings: [{ id: 'high', description: 'Complete', points: 10 }, { id: 'mid', description: 'Partial', points: 5 }, { id: 'low', description: 'Missing', points: 0 }] }
  ] });
const submission = () => ({ assignment_id: 7, user_id: 21, attempt: 1, posted_at: '2026-10-25T12:00:00Z', score: 3,
  rubric_assessment: { crit1: { rating_id: 'low', points: 0, comments: 'Use <literal> notation.' }, crit2: { rating_id: 'low', points: 0, comments: '' } },
  full_rubric_assessment: { rubric_id: 9, artifact_attempt: 1, score: 0, rubric_association: { association_id: 7, association_type: 'Assignment' } } });
const ultra = () => ({ id: '_9_1', courseId: '_101_1', title: 'Lab rubric', rubricType: 'PERCENTAGE',
  columnHeaders: [{ id: '_12_1', header: 'Missing', position: 1 }, { id: '_11_1', header: 'Complete', position: 0 }],
  rows: [{ id: '_13_1', header: 'Analysis', percentage: 100, position: 0, cells: [
    { id: '_15_1', rubricRowId: '_13_1', rubricColumnId: '_12_1', position: 1, percentage: 0, description: 'Absent' },
    { id: '_14_1', rubricRowId: '_13_1', rubricColumnId: '_11_1', position: 0, percentage: 100, description: '<p>Clear</p>' }
  ] }] });
const association = () => ({ id: '_10_1', entityId: '_8_1', rubricId: '_9_1', displayBefore: true, displayAfter: true, displayGraded: true });
const evaluation = () => ({ id: '_23_1', rubricAssociationId: '_10_1', attemptId: '_22_1', userId: '_21_1', published: true,
  totalScore: 0, maxScore: 20, cells: [{ rubricRowId: '_13_1', rubricCellId: '_15_1', selectedPercent: 0, feedback: { rawText: '<p>Try again</p>' } }] });

test('Canvas preserves unequal levels, literal text and original input', () => {
  const a = canvas(), before = copy(a), m = lib().parse.canvas(a, null, cc);
  assert.equal(m.site, 'canvas'); assert.equal(m.kind, 'points'); assert.equal(m.total, 20);
  assert.equal(m.criteria[0].detail, 'Explain <literal>.'); assert.equal(m.criteria[0].cells.length, 2);
  assert.equal(m.levels.length, 3); assert.equal(m.levels[0].label, 'Complete'); assert.equal(m.levels[1].label, '');
  assert.deepEqual(m.criteria[0].cells[1].value, { n: 0 }); assert.equal(m.result, null); assert.deepEqual(a, before);
});

test('Canvas visible zero scores use the rubric score and plain criterion comments', () => {
  const m = lib().parse.canvas(canvas(), submission(), cc);
  assert.equal(m.result.score, 0); assert.equal(m.result.possible, 20); assert.equal(m.result.commentFormat, 'text');
  assert.equal(m.result.criteria.crit1.score, 0); assert.equal(m.result.criteria.crit1.comment, 'Use <literal> notation.');
  assert.equal(m.result.criteria.crit1.cell, m.criteria[0].cells[1].id);
  assert.equal('assessor_name' in m.result, false);
});

test('Canvas missing rubric total is not reconstructed from rows or assignment points', () => {
  const a = canvas(), s = submission(); delete a.rubric_settings.points_possible; delete s.full_rubric_assessment;
  const m = lib().parse.canvas(a, s, cc);
  assert.equal(m.total, null); assert.equal(m.result.possible, null); assert.equal(m.result.score, null);
});

test('Canvas rubric total accepts its documented decimal-string form without widening other numeric fields', () => {
  for (const value of ['0', '12', '12.5']) {
    const a = canvas(); a.rubric_settings.points_possible = value;
    const m = lib().parse.canvas(a, submission(), cc);
    assert.equal(m.total, Number(value)); assert.equal(m.result.possible, Number(value));
  }
  for (const value of ['', ' ', 'Infinity', 'NaN', '0x10', '12px', '1e2', '-1']) {
    const a = canvas(); a.rubric_settings.points_possible = value;
    assert.equal(lib().parse.canvas(a, null, cc).total, null);
  }
  const a = canvas(), s = submission(); a.rubric[0].points = '10'; a.rubric[0].ratings[0].points = '10';
  assert.equal(lib().parse.canvas(a, s, cc), null);
  s.rubric_assessment.crit1.points = '0'; s.full_rubric_assessment.score = '0';
  const m = lib().parse.canvas(canvas(), s, cc);
  assert.equal(m.result.criteria.crit1.score, null); assert.equal(m.result.score, null);
});

test('Canvas ranges retain exclusive boundaries and zero endpoint', () => {
  const a = canvas(); a.rubric[1].criterion_use_range = true;
  const m = lib().parse.canvas(a, submission(), cc);
  assert.equal(m.kind, 'points-range');
  assert.deepEqual(m.criteria[1].cells.map((c) => c.value), [{ lo: 5, hi: 10, loExclusive: true }, { lo: 0, hi: 5, loExclusive: true }, { n: 0 }]);
});

test('Canvas a range does not invent an interval between equal adjacent ratings', () => {
  const a = canvas(); a.rubric[1].criterion_use_range = true; a.rubric[1].ratings[1].points = 10;
  assert.deepEqual(lib().parse.canvas(a, null, cc).criteria[1].cells[0].value, { n: 10 });
});

test('Canvas freeform and unscored criteria remain visible without manufactured selections', () => {
  const a = canvas(), s = submission(); a.rubric_settings.free_form_criterion_comments = true;
  a.rubric[0].ratings = []; a.rubric[0].ignore_for_scoring = true; delete s.rubric_assessment.crit1.rating_id;
  const m = lib().parse.canvas(a, s, cc);
  assert.equal(m.criteria[0].unscored, true); assert.deepEqual(m.criteria[0].cells, []);
  assert.equal(m.result.criteria.crit1.cell, null); assert.equal(m.result.criteria.crit1.score, 0);
});

test('Canvas freeform with null ratings supplies a valid one-column room model', () => {
  const a = canvas(); a.rubric_settings.free_form_criterion_comments = true;
  a.rubric = [{ id: 'crit1', description: 'Feedback', ratings: null }];
  const m = lib().parse.canvas(a, null, cc);
  assert.equal(m.levels.length, 0); assert.equal(lib().room(336, m), true); assert.equal(lib().room(335, m), false);
});

test('Canvas hidden totals are redacted without hiding authorized criterion scores', () => {
  const a = canvas(); a.rubric_settings.hide_score_total = true;
  const m = lib().parse.canvas(a, submission(), cc);
  assert.equal(m.hideTotal, true); assert.equal(m.total, null); assert.equal(m.result.score, null); assert.equal(m.result.possible, null);
  assert.equal(m.result.criteria.crit1.score, 0); assert.deepEqual(m.criteria[0].cells[0].value, { n: 10 });
});

test('Canvas every quantitative restriction redacts points while retaining comments', () => {
  for (const restrict of [
    (a) => { a.rubric_settings.hide_points = true; },
    (a) => { a.restrict_quantitative_data = true; },
    (a, s) => { s.full_rubric_assessment.rubric_association.hide_points = true; }
  ]) {
    const a = canvas(), s = submission(); restrict(a, s); const m = lib().parse.canvas(a, s, cc);
    assert.equal(m.hidePoints, true); assert.equal(m.hideTotal, true); assert.equal(m.total, null);
    assert.equal(m.criteria[0].points, null); assert.equal(m.criteria[0].cells[0].value, null);
    assert.equal(m.result.criteria.crit1.score, null); assert.equal(m.result.criteria.crit1.comment, 'Use <literal> notation.');
  }
  assert.equal(lib().parse.canvas(canvas(), submission(), { ...cc, hidePoints: true }).hidePoints, true);
});

test('Canvas absent or explicitly unposted evaluations are not treated as zero', () => {
  for (const s of [null, { assignment_id: 7 }, { ...submission(), posted_at: null }]) assert.equal(lib().parse.canvas(canvas(), s, cc).result, null);
});

test('Canvas foreign assignment, user, rubric and attempt data cannot be joined', () => {
  for (const a of [{ ...canvas(), id: 8 }, { ...canvas(), course_id: 102 }]) assert.equal(lib().parse.canvas(a, submission(), cc), null);
  for (const mutate of [
    (s) => { s.assignment_id = 8; }, (s) => { s.user_id = 22; },
    (s) => { s.full_rubric_assessment.rubric_id = 8; },
    (s) => { s.full_rubric_assessment.artifact_attempt = 2; },
    (s) => { s.full_rubric_assessment.rubric_association.association_id = 8; },
    (s) => { s.rubric_assessment.foreign = { points: 10 }; }
  ]) { const s = submission(); mutate(s); assert.equal(lib().parse.canvas(canvas(), s, cc).result, null); }
});

test('Canvas malformed criteria, unsafe identifiers and duplicates fall back natively', () => {
  for (const change of [
    (a) => { a.rubric = []; }, (a) => { a.rubric[0].id = '__proto__'; },
    (a) => { a.rubric.push(copy(a.rubric[0])); },
    (a) => { a.rubric[0].ratings.push(copy(a.rubric[0].ratings[0])); },
    (a) => { a.rubric[0].ratings = null; }
  ]) { const a = canvas(); change(a); assert.equal(lib().parse.canvas(a, null, cc), null); }
});

test('Ultra private percentage levels sort by position and retain unweighted scores', () => {
  const d = ultra(), before = copy(d), m = lib().parse.ultra(d, association(), evaluation(), uc);
  assert.equal(m.site, 'ultra'); assert.equal(m.kind, 'percent'); assert.equal(m.levels[0].id, '_11_1');
  assert.deepEqual(m.criteria[0].cells.map((c) => c.value), [{ n: 100 }, { n: 0 }]);
  assert.equal(m.criteria[0].weight, 100); assert.equal(m.result.score, 0); assert.equal(m.result.possible, 20);
  assert.equal(m.result.criteria._13_1.score, 0); assert.equal(m.result.criteria._13_1.cell, '_15_1');
  assert.equal(m.result.criteria._13_1.comment, '<p>Try again</p>'); assert.equal(m.result.commentFormat, 'html'); assert.deepEqual(d, before);
});

test('Rubric-level Ultra instructions remain complete untrusted model data', () => {
  const d = ultra(); d.description = '<p>Use <strong>all</strong> criteria.</p><script>bad()</script>';
  const m = lib().parse.ultra(d, association(), evaluation(), uc);
  assert.equal(m.detail, d.description);
  assert.equal(lib().parse.ultra(ultra(), association(), null, uc).detail, '');
  assert.equal(lib().parse.canvas(canvas(), null, cc).detail, '');
});

test('Rubric-level Ultra instructions obey the complete-text budget', () => {
  const d = ultra(); d.description = 'x'.repeat(20000);
  assert.equal(lib().parse.ultra(d, association(), null, uc).detail, d.description);
  d.description += 'x'; assert.equal(lib().parse.ultra(d, association(), null, uc), null);
});

test('Ultra numeric definition and awarded values scale to the current column points', () => {
  const d = ultra(), e = evaluation(); d.rubricType = 'NUMERIC'; d.rows[0].rowPoints = 10;
  d.rows[0].cells[0].numericPoints = 0; d.rows[0].cells[1].numericPoints = 10;
  e.cells[0].rubricCellId = '_14_1'; e.cells[0].selectedPercent = 10; e.totalScore = 20;
  const m = lib().parse.ultra(d, association(), e, uc);
  assert.equal(m.kind, 'points'); assert.equal(m.criteria[0].points, 20); assert.equal(m.criteria[0].weight, null);
  assert.deepEqual(m.criteria[0].cells[0].value, { n: 20 }); assert.equal(m.result.criteria._13_1.score, 20);
  assert.equal(m.total, 20); assert.equal(m.result.score, 20);
  assert.equal(lib().parse.ultra(d, association(), e, { ...uc, pointsPossible: undefined }), null);
});

test('Ultra numeric ranges scale endpoints and normalized awarded row shares consistently', () => {
  const d = ultra(), e = evaluation(); d.rubricType = 'NUMERIC_RANGE'; d.rows[0].rowPoints = 10;
  Object.assign(d.rows[0].cells[0], { startPointRange: 0, endPointRange: 5 });
  Object.assign(d.rows[0].cells[1], { startPointRange: 5, endPointRange: 10 });
  e.cells[0].rubricCellId = '_14_1'; e.cells[0].selectedPercent = 0.75;
  const m = lib().parse.ultra(d, association(), e, uc);
  assert.equal(m.kind, 'points-range'); assert.deepEqual(m.criteria[0].cells[0].value, { lo: 10, hi: 20, loExclusive: false });
  assert.equal(m.result.criteria._13_1.score, 15);
});

test('Ultra percentage ranges remain percentages without multiplying row weight', () => {
  const d = ultra(), e = evaluation(); d.rubricType = 'PERCENTAGE_RANGE'; d.rows[0].percentage = 40;
  Object.assign(d.rows[0].cells[0], { percentageMin: 0, percentageMax: 50 });
  Object.assign(d.rows[0].cells[1], { percentageMin: 50, percentageMax: 100 });
  e.cells[0].rubricCellId = '_14_1'; e.cells[0].selectedPercent = 75;
  const m = lib().parse.ultra(d, association(), e, uc);
  assert.equal(m.kind, 'percent-range'); assert.deepEqual(m.criteria[0].cells[0].value, { lo: 50, hi: 100, loExclusive: false });
  assert.equal(m.result.criteria._13_1.score, 75); assert.equal(m.criteria[0].weight, 40);
});

test('Ultra no-points rubrics retain selected criteria and feedback with no numeric values', () => {
  const d = ultra(); d.rubricType = 'NONNUMERIC';
  const m = lib().parse.ultra(d, association(), evaluation(), uc);
  assert.equal(m.kind, 'none'); assert.equal(m.hidePoints, true); assert.equal(m.hideTotal, true);
  assert.equal(m.total, null); assert.equal(m.criteria[0].weight, null); assert.equal(m.criteria[0].cells[0].value, null);
  assert.equal(m.result.score, null); assert.equal(m.result.criteria._13_1.score, null); assert.equal(m.result.criteria._13_1.cell, '_15_1');
});

test('Ultra rounds numeric ratings and awarded range points to five decimals before display', () => {
  for (const rubricType of ['NUMERIC', 'NUMERIC_RANGE']) {
    const d = ultra(), e = evaluation(); d.rubricType = rubricType; d.rows[0].rowPoints = 10;
    for (const c of d.rows[0].cells) Object.assign(c, { numericPoints: .6174975, startPointRange: 0, endPointRange: 10 });
    e.cells[0].selectedPercent = rubricType === 'NUMERIC' ? .6174975 : .06174975;
    const m = lib().parse.ultra(d, association(), e, uc);
    if (rubricType === 'NUMERIC') assert.equal(m.criteria[0].cells[0].value.n, 1.235);
    assert.equal(m.result.criteria._13_1.score, 1.235);
  }
});

test('Ultra incomplete scored definitions stay native for every scored type', () => {
  for (const [rubricType, fields] of [['PERCENTAGE', { percentage: 100 }], ['PERCENTAGE_RANGE', { percentageMin: 0, percentageMax: 100 }],
    ['NUMERIC', { numericPoints: 10 }], ['NUMERIC_RANGE', { startPointRange: 0, endPointRange: 10 }]]) {
    const d = ultra(); d.rubricType = rubricType; d.rows[0].rowPoints = 10;
    for (const c of d.rows[0].cells) Object.assign(c, fields);
    for (const field of Object.keys(fields)) {
      const broken = copy(d); delete broken.rows[0].cells[0][field];
      assert.equal(lib().parse.ultra(broken, association(), null, uc), null, `${rubricType}: ${field}`);
    }
    if (rubricType.startsWith('PERCENTAGE')) {
      delete d.rows[0].percentage;
      assert.equal(lib().parse.ultra(d, association(), null, uc), null, `${rubricType}: row weight`);
    }
  }
});

test('Canvas incomplete scored criteria and ratings stay native', () => {
  for (const change of [(a) => { delete a.rubric[0].points; }, (a) => { delete a.rubric[0].ratings[0].points; }]) {
    const a = canvas(); change(a); assert.equal(lib().parse.canvas(a, null, cc), null);
    a.rubric_settings.hide_points = true;
    assert.ok(lib().parse.canvas(a, null, cc), 'qualitative definitions do not require hidden points');
  }
});

test('Ultra shows the definition in every own-attempt state, as its own rubric link does; selections need graded and displayGraded', () => {
  // Real Ultra keeps "This item is graded with a rubric" on a submitted, ungraded item whose association says displayAfter:
  // false, and its link opens the rubric; the page's link, not the flag, decides whether the definition shows.
  for (const [state, flag] of [['before', 'displayBefore'], ['after', 'displayAfter'], ['graded', 'displayGraded']]) {
    for (const value of [false, true, undefined]) {
      const a = association(); if (value === undefined) delete a[flag]; else a[flag] = value;
      const m = lib().parse.ultra(ultra(), a, evaluation(), { ...uc, state });
      assert.ok(m, `${state} with ${flag} ${value} shows the definition`);
      assert.equal(!!m.result, state === 'graded' && value === true, `${state} with ${flag} ${value}: selections only once graded and displayGraded`);
    }
  }
  assert.equal(lib().parse.ultra(ultra(), association(), evaluation(), { ...uc, state: 'COMPLETED' }), null);
});

test('Ultra evaluation requires the current association, attempt and user, and ignores its published flag', () => {
  for (const mutate of [(e) => { e.published = false; }, (e) => { delete e.published; }, (e) => { e.userId = null; }, (e) => { delete e.userId; }]) {
    const e = evaluation(); mutate(e); assert.ok(lib().parse.ultra(ultra(), association(), e, uc).result, 'the graded state, not the flag, gates selections');
  }
  const real = require('./fixtures/ultra-rubric-graded.json'), a = real.column.rubricAssociations[0];
  const m = lib().parse.ultra(a.rubricDefinition, a, real.attempt.rubricEvaluation, { ...uc, columnId: '_300_1', contentId: '_8120_1', userId: '_42_1', attemptId: '_400_1', pointsPossible: 100 });
  assert.deepEqual(Object.values(m.result.criteria).map((c) => [c.cell, c.score]), [['_630_1', 100], ['_634_1', 70]]);
  for (const mutate of [
    (e) => { e.rubricAssociationId = '_99_1'; }, (e) => { e.attemptId = '_99_1'; }, (e) => { e.userId = '_99_1'; },
    (e) => { e.cells[0].rubricRowId = '_99_1'; }, (e) => { e.cells[0].rubricCellId = '_99_1'; },
    (e) => { e.cells.push(copy(e.cells[0])); }
  ]) { const e = evaluation(); mutate(e); assert.equal(lib().parse.ultra(ultra(), association(), e, uc).result, null); }
});

test('Ultra rejects foreign definitions and requires the runtime validated column binding', () => {
  for (const mutate of [(d) => { d.courseId = '_99_1'; }, (d) => { d.id = '_99_1'; }, (d) => { d.rows[0].cells[0].rubricRowId = '_99_1'; }, (d) => { d.rows[0].cells[0].rubricColumnId = '_99_1'; }]) {
    const d = ultra(); mutate(d); assert.equal(lib().parse.ultra(d, association(), null, uc), null);
  }
  const a = association(); a.entityId = '_99_1'; assert.ok(lib().parse.ultra(ultra(), a, null, uc));
  delete a.entityId; assert.ok(lib().parse.ultra(ultra(), a, null, uc));
  assert.equal(lib().parse.ultra(ultra(), a, null, { ...uc, columnBound: false }), null);
  assert.equal(lib().parse.ultra(ultra(), a, null, { ...uc, columnBound: undefined }), null);
});

test('Ultra unknown and public rubric types remain native', () => {
  for (const rubricType of ['Percentage', 'UNKNOWN', '', null]) assert.equal(lib().parse.ultra({ ...ultra(), rubricType }, association(), null, uc), null);
});

test('Ultra rejects duplicate row, level and cell identities', () => {
  for (const mutate of [(d) => { d.rows.push(copy(d.rows[0])); }, (d) => { d.columnHeaders.push(copy(d.columnHeaders[0])); }, (d) => { d.rows[0].cells.push(copy(d.rows[0].cells[0])); }]) {
    const d = ultra(); mutate(d); assert.equal(lib().parse.ultra(d, association(), null, uc), null);
  }
});

test('Ultra incomplete rows fall back rather than shifting values under a different level heading', () => {
  for (const missing of ['_11_1', '_12_1']) {
    const d = ultra(); d.columnHeaders.push({ id: '_16_1', header: 'Partial', position: 2 });
    d.rows[0].cells.push({ id: '_17_1', rubricRowId: '_13_1', rubricColumnId: '_16_1', position: 2, percentage: 50 });
    d.rows[0].cells = d.rows[0].cells.filter((c) => c.rubricColumnId !== missing);
    assert.equal(lib().parse.ultra(d, association(), null, uc), null);
  }
});

test('Structural caps refuse oversized tables rather than omitting criteria', () => {
  const a = canvas(); a.rubric = Array.from({ length: 51 }, (_, i) => ({ ...a.rubric[0], id: `c${i}` }));
  assert.equal(lib().parse.canvas(a, null, cc), null);
  const b = canvas(); b.rubric[0].ratings = Array.from({ length: 13 }, (_, i) => ({ id: `r${i}`, points: i }));
  assert.equal(lib().parse.canvas(b, null, cc), null);
  const d = ultra(); d.columnHeaders = Array.from({ length: 13 }, (_, i) => ({ id: `_${100 + i}_1`, position: i }));
  assert.equal(lib().parse.ultra(d, association(), null, uc), null);
});

test('Non-finite definitions stay native and non-finite results never become zero', () => {
  const a = canvas(), s = submission(); a.rubric_settings.points_possible = Infinity; a.rubric[0].points = NaN;
  a.rubric[0].ratings[0].points = '10'; s.rubric_assessment.crit1.points = Infinity; s.full_rubric_assessment.score = NaN;
  assert.equal(lib().parse.canvas(a, s, cc), null);
  const m = lib().parse.canvas(canvas(), s, cc);
  assert.equal(m.result.criteria.crit1.score, null); assert.equal(m.result.score, null);
});

test('Malformed contexts and oversized Ultra identifiers fail without throwing', () => {
  for (const c of [null, false, {}, { ...uc, courseId: `_${'1'.repeat(1000)}_1` }]) assert.equal(lib().parse.ultra(ultra(), association(), null, c), null);
  for (const c of [null, false, {}]) assert.equal(lib().parse.canvas(canvas(), null, c), null);
  const d = ultra(); d.columnHeaders[0].id = `_${'1'.repeat(1000)}_1`;
  assert.equal(lib().parse.ultra(d, association(), null, uc), null);
});

test('Ultra scaling cannot return non-finite computed values', () => {
  const d = ultra(), e = evaluation(); d.rubricType = 'NUMERIC'; d.rows[0].rowPoints = 1;
  d.rows[0].cells[1].numericPoints = 1e308; e.cells[0].selectedPercent = 1e308;
  assert.equal(lib().parse.ultra(d, association(), e, { ...uc, pointsPossible: 1e308 }), null);
  for (const c of d.rows[0].cells) c.numericPoints = 1;
  const m = lib().parse.ultra(d, association(), e, { ...uc, pointsPossible: 1e308 });
  assert.equal(m.result.criteria._13_1.score, null);
});

test('Hostile strings stay untrusted data; parser never creates a DOM', () => {
  const a = canvas(), s = submission(), hostile = '<script>bad()</script><img onerror="bad()" src="javascript:bad()">';
  a.rubric[0].long_description = hostile; s.rubric_assessment.crit1.comments = hostile;
  const m = lib().parse.canvas(a, s, cc);
  assert.equal(m.criteria[0].detail, hostile); assert.equal(m.result.criteria.crit1.comment, hostile);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../lib/rubric.js'), 'utf8'), /\b(document|DOMParser|innerHTML|fetch)\b/);
});

test('Oversized labels, instructions and visible feedback fall back without truncation', () => {
  for (const mutate of [
    (a) => { a.rubric_settings.title = 'x'.repeat(301); },
    (a) => { a.rubric[0].description = 'x'.repeat(301); },
    (a) => { a.rubric[0].ratings[0].description = 'x'.repeat(301); },
    (a) => { a.rubric[0].long_description = 'x'.repeat(20001); },
    (a) => { a.rubric[0].ratings[0].long_description = 'x'.repeat(20001); },
    (a, s) => { s.rubric_assessment.crit1.comments = 'x'.repeat(20001); }
  ]) { const a = canvas(), s = submission(); mutate(a, s); assert.equal(lib().parse.canvas(a, s, cc), null); }
  for (const mutate of [
    (d) => { d.title = 'x'.repeat(301); },
    (d) => { d.columnHeaders[0].header = 'x'.repeat(301); },
    (d) => { d.rows[0].header = 'x'.repeat(301); },
    (d) => { d.rows[0].cells[0].description = 'x'.repeat(20001); },
    (d, e) => { e.cells[0].feedback.rawText = 'x'.repeat(20001); }
  ]) { const d = ultra(), e = evaluation(); mutate(d, e); assert.equal(lib().parse.ultra(d, association(), e, uc), null); }
});

test('The aggregate text budget falls back instead of omitting later grading instructions', () => {
  const a = canvas(); a.rubric = Array.from({ length: 8 }, (_, i) => ({ ...copy(a.rubric[0]), id: `c${i}`, long_description: 'x'.repeat(17000) }));
  assert.equal(lib().parse.canvas(a, null, cc), null);
  const d = ultra(); d.rows = Array.from({ length: 8 }, (_, i) => ({ ...copy(d.rows[0]), id: `_${100 + i}_1`, position: i,
    cells: d.rows[0].cells.map((c, j) => ({ ...c, id: `_${200 + 2 * i + j}_1`, rubricRowId: `_${100 + i}_1`, description: 'x'.repeat(17000) })) }));
  assert.equal(lib().parse.ultra(d, association(), null, uc), null);
});

test('Accepted text budgets preserve full strings at their exact field limits', () => {
  const a = canvas(); a.rubric[0].description = 'x'.repeat(300); a.rubric[0].long_description = 'x'.repeat(20000);
  const m = lib().parse.canvas(a, null, cc);
  assert.equal(m.criteria[0].label, a.rubric[0].description); assert.equal(m.criteria[0].detail, a.rubric[0].long_description);
});

test('Room uses real column count, root text scale and scaled hysteresis', () => {
  const m = { criteria: [{}], levels: Array.from({ length: 4 }, () => ({})) };
  assert.equal(lib().room(720, m), true); assert.equal(lib().room(719, m), false);
  assert.equal(lib().room(696, m, 16, true), true); assert.equal(lib().room(695, m, 16, true), false);
  assert.equal(lib().room(900, m, 20), true); assert.equal(lib().room(899, m, 20), false);
  assert.equal(lib().room(870, m, 20, true), true); assert.equal(lib().room(869, m, 20, true), false);
  for (const w of [NaN, Infinity, -1, 0, '720']) assert.equal(lib().room(w, m), false);
  assert.equal(lib().room(1000, m, 0), false); assert.equal(lib().room(1000, { levels: [] }), false);
});

test('Mode resolves only the rubric settings with default sanitation', () => {
  for (const inline of [true, false]) {
    assert.equal(lib().mode({ rubric: { show: 'site', inline } }), 'site');
    assert.equal(lib().mode({ rubric: { show: 'popup', inline } }), 'popup');
    assert.equal(lib().mode({ rubric: { show: 'auto', inline } }), inline ? 'auto-inline' : 'popup');
  }
  for (const s of [undefined, {}, { rubric: { show: 'junk', inline: 'false' } }]) assert.equal(lib().mode(s), 'auto-inline');
});

test('Routes accept only complete assignment and Ultra overview or attempt paths', () => {
  assert.deepEqual(lib().route('canvas', '/courses/101/assignments/7/'), { courseId: '101', assignmentId: '7', view: 'assignment' });
  assert.deepEqual(lib().route('ultra', '/ultra/courses/_101_1/assessment/_7_1/overview'), { courseId: '_101_1', contentId: '_7_1', view: 'overview' });
  for (const suffix of ['attempt', 'attempt/', 'attempt/create']) assert.equal(lib().route('ultra', `/ultra/courses/_101_1/assessment/_7_1/${suffix}`).view, 'attempt');
  for (const [site, p] of [['canvas', '/courses/101/assignments/7/submissions/21'], ['canvas', '/courses/101/assignments/7?courseId=102'], ['canvas', '/courses/101/assignments/%37'], ['ultra', '/ultra/courses/_101_1/assessment/_7_1/overview/student-submission-view'], ['ultra', '/ultra/courses/_101_1/grades/student-submission-view'], ['ultra', '/ultra/courses/_101_1/assessment/_7_1/attempt/_3_1'], ['other', '/courses/101/assignments/7']]) assert.equal(lib().route(site, p), null);
});

test('Classic-script reinjection keeps the original library without browser dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/rubric.js'), 'utf8'), context = vm.createContext({});
  vm.runInContext(source, context); const first = context.GZ_RUBRIC_LIB;
  assert.equal(typeof first.parse.canvas, 'function'); vm.runInContext(source, context); assert.equal(context.GZ_RUBRIC_LIB, first);
});
