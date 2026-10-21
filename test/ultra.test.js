// lib/ultra.js: Blackboard Ultra's answers in the shapes Glaze's features use, on the synthetic fixtures
// (test/fixtures/ultra-*.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/ultra.js');
const Z = require('../lib/zip.js');

const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `ultra-${n}.json`), 'utf8'));
const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const o = 'https://lms.example.edu';
// Ultra applies a `fields` list to each item's top-level keys.
const project = (items, fields) => items.map((i) => Object.fromEntries(fields.split(',').filter((k) => k in i).map((k) => [k, i[k]])));
const LTI = /synthetic-lti-(secret|key)/;

// ---- the LTI credential fields (the B0 spike's safety notes) ---------------------------------------------------
test('private content is asked for without contentDetail, by both callers', () => {
  for (const f of [U.PEEK_FIELDS, U.FILES_FIELDS]) assert.doesNotMatch(f, /contentDetail|\//);
  assert.match(src('features/previews.js'), /\/children\?fields=\$\{GZ_ULTRA\.PEEK_FIELDS\}/);
  assert.match(src('features/download.js'), /\/children\?limit=200&fields=\$\{GZ_ULTRA\.FILES_FIELDS\}/);
  // Neither caller reads contentDetail, nor does anything else Glaze ships.
  for (const f of ['content.js', 'features/previews.js', 'features/download.js', 'lib/page.js', 'lib/ultra.js', 'lib/grades.js']) {
    assert.doesNotMatch(src(f).replace(/^\s*\/\/.*$/gm, ''), /contentDetail/, f);
  }
});

test('metadata reads refuse redirects: previews and Download all ask through the reader; only file bytes may follow one', async () => {
  // The only fetch left in either is Download all's file bytes, which Blackboard hands to its file CDN by a redirect.
  assert.doesNotMatch(src('features/previews.js'), /\bfetch\(/);
  assert.deepEqual(src('features/download.js').match(/\bfetch\([^,]+/g), ['fetch(f.url']);
  assert.match(src('features/previews.js'), /GZ_ULTRA\.read\(\{ origin: location\.origin \}\)\.get\(`\/learn\/api\/v1\/courses\/\$\{cid\}\/contents\/\$\{fid\}\/children\?fields=/);
  assert.match(src('features/download.js'), /const get = \(path\) => GZ_ULTRA\.read\(\{ origin: location\.origin, signal: ctl\.signal \}\)\.get\(/);
  // A signed-out answer (a redirect, which fetch then refuses) fails the read, recoverably, with nothing else asked.
  const asked = [];
  const f = async (url, init) => { asked.push([url, init.redirect]); throw new TypeError('Failed to fetch'); };
  const r = U.read({ origin: o, f });
  for (const p of [`/learn/api/v1/courses/_1_1/contents/_2_1/children?fields=${U.PEEK_FIELDS}`, `/learn/api/v1/courses/_1_1/contents/_2_1/children?limit=200&fields=${U.FILES_FIELDS}`, '/learn/api/public/v1/courses/_1_1/contents/_3_1/attachments?fields=id,fileName']) {
    await assert.rejects(r.get(p), TypeError);
  }
  assert.deepEqual(asked.map(([, x]) => x), ['error', 'error', 'error']);
  assert.ok(asked.every(([u]) => u.startsWith(`${o}/learn/api/`)));
});

test("a folder preview keeps only an item's id, title, state and due date, never an LTI link's secret or key", () => {
  const raw = load('children').results;
  assert.ok(raw.some((i) => LTI.test(JSON.stringify(i))), 'the fixture carries them, as Ultra sends them unasked');
  for (const items of [raw, project(raw, U.PEEK_FIELDS)]) {
    const kept = items.map(U.peekItem);
    assert.doesNotMatch(JSON.stringify(kept), LTI);
    for (const k of kept) assert.deepEqual(Object.keys(k), ['id', 'title', 'state', 'genericReadOnlyData']);
    assert.deepEqual(kept.find((k) => k.id === '_703_1'), { id: '_703_1', title: 'Lab Report 3', state: 'None', genericReadOnlyData: { dueDate: '2026-10-19T03:59:00.000Z' } });
    assert.equal(kept.find((k) => k.id === '_731_1').genericReadOnlyData.dueDate, undefined);
  }
});

test('Download all finds the same files from what the fields list leaves, and keeps nothing else', async () => {
  const raw = {
    _730_1: load('children').results,
    _731_1: [{ id: '_741_1', title: 'Week 2 reading', contentHandler: 'resource/x-bb-file', state: 'Started', contentDetail: {} }],
    _732_1: [{ id: '_742_1', title: 'Block', contentHandler: 'resource/x-bb-document', state: 'None',
      body: { rawText: `<a data-bbfile="{&quot;fileName&quot;:&quot;notes.pdf&quot;}" href="${o}/bbcswebdav/xid-10_1">notes</a>` } }],
  };
  const pub = { _731_1: false, _732_1: true, _733_1: false, _741_1: false };
  const att = { _733_1: [{ id: '_51_1', fileName: 'handout.pdf' }], _741_1: [{ id: '_52_1', fileName: 'reading.pdf' }] };
  const run = async (fields) => {
    const asked = [];
    const r = await U.files({
      root: '_730_1', origin: o, safeName: Z.safeName,
      list: async (id) => (fields ? project(raw[id] || [], fields) : raw[id] || []),
      isPage: async (c) => pub[c.id] ?? false,
      attachments: async (id) => { asked.push(id); return U.attachments(o, '_101_1', id, att[id]); },
    });
    return { ...r, asked };
  };
  const want = {
    found: [
      { url: `${o}/learn/api/public/v1/courses/_101_1/contents/_741_1/attachments/_52_1/download`, name: 'reading.pdf', size: undefined, dir: 'Week 2/' },
      { url: `${o}/bbcswebdav/xid-10_1`, name: 'notes.pdf', size: undefined, dir: '' },
      { url: `${o}/learn/api/public/v1/courses/_101_1/contents/_733_1/attachments/_51_1/download`, name: 'handout.pdf', size: undefined, dir: '' },
      { url: `${o}/bbcswebdav/pid-1-dt-content-rid-9_1/xid-9_1`, name: 'slides.pdf', size: 2048, dir: '' },
    ],
    // The unopened File item (_734_1) is counted and left out, its attachments never asked for.
    skipped: 1, failed: 0, asked: ['_741_1', '_733_1'],
  };
  assert.deepEqual(await run(U.FILES_FIELDS), want);
  // Fed everything Ultra could send, contentDetail and the LTI link's secret and key included, nothing of it is kept.
  const all = await run(null);
  assert.deepEqual(all, want);
  assert.doesNotMatch(JSON.stringify(all), LTI);
});

test('a File item whose attachments cannot be read counts as failed; attachment addresses stay on the site', async () => {
  const r = await U.files({ root: '_1_1', origin: o, safeName: Z.safeName, isPage: async () => false,
    list: async () => [{ id: '_2_1', title: 'f', contentHandler: 'resource/x-bb-file', state: 'Completed' }], attachments: async () => null });
  assert.deepEqual(r, { found: [], skipped: 0, failed: 1 });
  assert.deepEqual(U.attachments(o, '_1_1', '_2_1', [{ id: '../x', fileName: 'a' }, { id: '_3_1' }, null]),
    [{ url: `${o}/learn/api/public/v1/courses/_1_1/contents/_2_1/attachments/_3_1/download`, name: 'file' }]);
  for (const [cid, id] of [['x', '_2_1'], ['_1_1', '../_2_1']]) assert.deepEqual(U.attachments(o, cid, id, [{ id: '_3_1' }]), []);
});

// ---- the data layer -----------------------------------------------------------------------------------------------
const T = require('../lib/todo.js');
const R = require('../lib/remind.js');
const I = require('../lib/insights.js');
const C = require('../lib/calexport.js');
const NOW = Date.parse('2026-10-15T12:00:00Z');
const LATER = Date.parse('2026-10-24T12:00:00Z');
const clone = (v) => JSON.parse(JSON.stringify(v));
const status = () => clone(load('grades-status').results); // course _102_1: GRADED on time, SUBMITTED late, UNOPENED
const book = () => clone(load('grades').results); // course _101_1, with an overall column and its formula
const todoO = Object.fromEntries(Object.entries(T.SPEC).map(([k, [d]]) => [k, d]));

test('courses: GZ_COURSES with code, term dates as Canvas names them, and a banner from this site only', () => {
  const ms = clone(load('memberships').results);
  const c = U.courses(ms, { terms: load('terms').results, origin: o });
  assert.deepEqual(Object.keys(c), ['_101_1', '_102_1', '_103_1', '_104_1']);
  assert.deepEqual(c._101_1, { name: 'BIO 1100: Biology I', slot: '3', org: false, code: 'FA26-BIO1100-01', closed: false,
    term: { id: '_51_1', name: 'Fall 2026', start_at: '2026-08-31T04:00:00.000Z', end_at: '2026-12-22T04:59:00.000Z' }, banner: `${o}/bbcswebdav/banner.png` });
  // The term by id when the membership doesn't carry it; a banner elsewhere, or hidden, isn't kept.
  delete ms[0].course.term;
  ms[1].course.banner = { permanentUrl: 'https://cdn.example.com/x.png' };
  ms[2].course.banner = { permanentUrl: '/bbcswebdav/b.png' };
  ms[2].course.isBannerVisible = false;
  const d = U.courses(ms, { terms: load('terms').results, origin: o });
  assert.equal(d._101_1.term.name, 'Fall 2026');
  assert.equal(d._102_1.banner, null);
  assert.equal(d._103_1.banner, null);
  // lib/calexport.js reads the term's end for "to the end of term".
  const r = C.range('term', NOW, 'UTC', Object.values(c));
  assert.equal(r.guessed, false);
  assert.equal(r.last, T.dayOf(Date.parse('2026-12-22T04:59:00.000Z'), 'UTC') + 1);
});

test('where work stands: a table of measured and synthetic rows ([I] rules, unknown never guessed)', () => {
  const [graded, late, unopened] = status();
  const noReceipt = clone(late);
  delete noReceipt.lastAttempt.attemptReceipt;
  const exempt = { ...clone(unopened), isExempt: true };
  const exemptEnum = { ...clone(unopened), submissionStatus: { status: 'EXEMPT' } };
  const autoZero = { ...clone(unopened), status: 'GRADED', submissionStatus: { status: 'PAST_DUE_AUTO_ZERO' } };
  const strange = { ...clone(unopened), submissionStatus: { status: 'SOMETHING_NEW' } };
  const noStatus = { ...clone(unopened), submissionStatus: { status: 'NO_STATUS' } }; // [M] on LTI and attendance columns
  const draft = { ...clone(unopened), lastAttemptId: '_813_1', firstAttemptId: '_813_1', lastAttempt: { status: 'IN_PROGRESS', creationDate: '2026-10-10T00:00:00.000Z' } };
  delete draft.submissionStatus;
  const draftAfterOne = { ...clone(draft), firstAttemptId: '_810_1', submissionStatus: { status: 'SUBMITTED' } };
  const lti = book().find((r) => r.columnId === '_606_1'); // graded, no attempt (an LTI column)
  const noDue = clone(graded);
  delete noDue.column.dueDate;
  const badDue = clone(graded);
  badDue.column.dueDate = 'not a date';
  const nothing = book().find((r) => r.columnId === '_603_1'); // a row with nothing yet: no status at all
  const cases = [
    ['graded, handed in before the due date', graded, NOW, 'on-time', { submitted: true, graded: true }],
    ['handed in after the due date', late, NOW, 'late', { submitted: true, graded: false }],
    ['no receipt: attemptDate is the submission time', noReceipt, NOW, 'late', { submitted: true }],
    ['late, but a due-date exception', late, NOW, 'unknown', { submitted: true }, true],
    ['nothing handed in, not due yet', unopened, NOW, 'open', { submitted: false }],
    ['nothing handed in, past due', unopened, LATER, 'missing', { submitted: false }],
    ['past due, but a due-date exception', unopened, LATER, 'unknown', {}, true],
    ['exempt', exempt, LATER, 'excused', {}],
    ['EXEMPT status', exemptEnum, LATER, 'excused', {}],
    ["Ultra's automatic zero", autoZero, LATER, 'missing', { graded: true }],
    ['a status Glaze has never seen', strange, LATER, 'unknown', { submitted: false }],
    ['NO_STATUS, nothing graded', noStatus, LATER, 'unknown', { submitted: false, graded: false }],
    ['a saved draft is not a submission', draft, LATER, 'missing', { submitted: false, draft: true }],
    ['a draft after a submitted attempt: handed in, time unknown', draftAfterOne, LATER, 'unknown', { submitted: true, draft: true }],
    ['graded with no attempt (LTI)', lti, NOW, 'unknown', { graded: true, submitted: false }],
    ['a row with nothing yet', nothing, NOW, 'open', { submitted: false }],
    ['handed in, no due date: timeliness unknown', noDue, NOW, 'unknown', { submitted: true, graded: true }],
    ['handed in, a due date that is no date: unknown', badDue, NOW, 'unknown', { submitted: true, graded: true }],
  ];
  for (const [name, row, now, state, flags, excepted] of cases) {
    const s = U.standing(row, now, excepted);
    assert.equal(s.state, state, name);
    for (const [k, v] of Object.entries(flags)) assert.equal(s[k], v, `${name}: ${k}`);
  }
  assert.equal(U.standing(noReceipt, NOW).at, Date.parse(late.lastAttempt.attemptDate));
});

test('saved drafts stay open in Better To Do despite attempt dates or multiple attempt ids', () => {
  const T = require('../lib/todo.js');
  const column = { dueDate: '2026-10-20T12:00:00Z', contentId: '_703_1' };
  const base = { columnId: '_603_1', column, firstAttemptId: '_810_1', lastAttemptId: '_813_1', lastAttempt: { status: 'IN_PROGRESS', attemptDate: '2026-10-21T12:00:00Z' } };
  const cases = [
    base,
    { ...base, status: 'NEEDS_GRADING' },
    { ...base, submissionStatus: { status: 'NOT_SUBMITTED' } },
    { ...base, status: 'IN_PROGRESS', lastAttempt: { attemptDate: base.lastAttempt.attemptDate } },
    { ...base, lastAttempt: { attemptDate: base.lastAttempt.attemptDate } },
  ];
  for (const row of cases) {
    const st = U.standing(row, LATER);
    assert.equal(st.submitted, false, JSON.stringify(row));
    assert.equal(st.at, null, 'an attempt date is not a submission time');
    assert.equal(st.state, st.draft ? 'missing' : 'unknown');
    if (st.draft) {
      assert.equal(U.standing(row, NOW).state, 'open');
      assert.equal(U.standing(row, LATER, true).state, 'unknown');
    }
    const [item] = U.due({ todo: [{ overdueItems: [{ title: 'Draft', dueDate: column.dueDate, column: { id: row.columnId, courseId: '_101_1' } }] }], rows: { _101_1: [row] }, now: LATER });
    assert.equal(T.isDone(item, 'auto'), false, 'the planner cannot auto-complete a saved draft');
  }
  const prior = U.standing({ ...base, submissionStatus: { status: 'SUBMITTED' } }, LATER);
  assert.deepEqual([prior.state, prior.submitted, prior.draft, prior.at], ['unknown', true, true, null]);
});

test('due items: To Do and the calendar as planner items, twins deduped, joined by column id only', () => {
  const calendar = clone(load('calendar-items').results);
  // An item no gradebook row has: a calendar entry with no grade state. Titled like a real column, it still joins nothing.
  calendar.push({ ...clone(calendar[1]), itemSourceId: '_699_1', title: 'Essay 3', calendarId: '_102_1' });
  calendar.push({ ...clone(calendar[1]), itemSourceType: 'blackboard.platform.calendar.CalendarEvent', itemSourceId: '_698_1' }); // not work
  const rows = { _101_1: book(), _102_1: status() };
  const items = U.due({ todo: [load('todo')], calendar, rows, names: { _101_1: 'Biology', _102_1: 'English' }, now: NOW });
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(by).sort(), ['_603_1', '_605_1', '_606_1', '_613_1', '_699_1']);
  assert.equal(items.length, 5, 'the graded discussion appears once');
  assert.equal(by._605_1.type, 'discussion_topic');
  assert.deepEqual([by._603_1.type, by._603_1.state, by._603_1.url], ['assignment', 'open', '/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_703_1']);
  assert.deepEqual(by._613_1.sub, { submitted: false, excused: false, graded: false, late: false, missing: false, redo: false });
  assert.deepEqual([by._699_1.sub, by._699_1.state, by._699_1.url, by._699_1.title], [null, 'unknown', '/ultra/courses/_102_1/outline', 'Essay 3']);
  assert.equal(by._606_1.sub.graded, true); // graded LTI work: done, though when it was handed in is unknown
  assert.equal(by._613_1.course, 'English');
  assert.equal(by._603_1.at, Date.parse('2026-10-19T03:59:00.000Z'));
  // lib/todo.js lists them as they are, keeps marks on them, and counts graded work as done.
  const data = T.clean({ items: { 'assignment:_603_1': { done: true }, 'assignment:_699_1': { on: '2026-10-16' } } });
  assert.deepEqual(Object.keys(data.items), ['assignment:_603_1', 'assignment:_699_1']);
  const b = T.build({ items, data, o: { ...todoO, span: 'custom', n: 2, unit: 'weeks', past: 'always' }, now: NOW, tz: 'UTC' });
  assert.deepEqual(b.groups.map(([g, l]) => [g, l.map((r) => r.key)]), [['tomorrow', ['assignment:_699_1']], ['week', ['assignment:_699_1']], ['later', ['assignment:_613_1']]]);
  assert.deepEqual(b.done.map((r) => r.key), ['assignment:_603_1']);
  assert.deepEqual(b.graded.map((r) => r.key).sort(), ['assignment:_606_1', 'discussion_topic:_605_1']);
  // lib/remind.js: an item of unknown standing never counts toward a streak; Ultra keys stay in the reminder state.
  assert.ok(!(R.streak(b, null, T.dayOf(NOW, 'UTC')).keys || []).includes('assignment:_699_1'));
  assert.deepEqual(Object.keys(R.clean({ mute: { 'discussion_topic:_605_1': NOW } }, NOW).mute), ['discussion_topic:_605_1']);
  // lib/calexport.js: each item an event with a link on this site.
  const r = C.range('4w', NOW, 'UTC');
  const ev = C.events({ items, data, o: { ...todoO, icsDue: true }, ...r, site: o, host: 'lms.example.edu', words: { plan: (t) => t, focus: (t) => t, untitled: '?' } });
  assert.ok(ev.some((e) => e.summary === 'Lab Report 3' && e.url === `${o}/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_703_1`));
});

test('work for Insights: its item shape, unknown left undecided, and kept by its cleaner', () => {
  const w = U.work([...status(), ...book()], LATER);
  const by = Object.fromEntries(w.map((i) => [i.k, i]));
  assert.equal(by['assignment:_611_1'].s, 'on');
  assert.equal(by['assignment:_612_1'].s, 'late');
  assert.equal(by['assignment:_613_1'].s, 'missing');
  assert.equal(by['assignment:_606_1'].s, ''); // graded LTI, time unknown: neither on time nor late
  const noDue = status();
  delete noDue[0].column.dueDate;
  // Handed in, but never "on time" without a due date.
  assert.deepEqual(U.work(noDue, LATER).map((i) => [i.k, i.s, i.d, !!i.a])[0], ['assignment:_611_1', '', 0, true]);
  assert.ok(by['discussion_topic:_605_1']);
  assert.ok(!w.some((i) => i.k.endsWith(':_600_1')), 'the overall column is not work');
  const kept = I.clean({ courses: [{ id: '_102_1', name: 'English', items: w }] });
  assert.equal(kept.courses[0].id, '_102_1');
  assert.equal(kept.courses[0].items.length, w.length);
});

test("grades: B0's calibration (weighted categories, discrepancy 0), and the estimate path", () => {
  // Calibration receipt: one overall column with a formula, kind wgt, category elements only, proportional, running.
  const rows = book();
  const f = rows.find((r) => r.column.externalGrade).column.calculatedFormula;
  const body = JSON.parse(f.formula.match(/BBCalColElem\(wgt:(\{[\s\S]*\})\)/)[1]);
  assert.ok(body.running === true && body.weights.every((w) => w.element.type === 'cat' && (w.element.mode ?? 'proportional') === 'proportional'));
  const g = U.grade(rows, load('schemas').results);
  assert.deepEqual([g.kind, g.estimate, g.overall], ['weighted', false, 88]);
  assert.equal(g.percent() - g.overall, 0);
  // The what-if reads the same course through the calculator Canvas uses: still no discrepancy.
  assert.equal(require('../lib/gradecalc.js').calc(g.course, {}).current - g.overall, 0);
  assert.deepEqual(g.course.groups.map((x) => [x.id, x.name, x.weight]), [['_201_1', 'Assignment', 40], ['_202_1', 'Test', 40], ['_203_1', 'Discussion', 20]]);
  assert.equal(g.scale, null); // the overall column's schema is a percent scale
  // A letter scale as a student gets it (B4, measured): letters and the value an entered letter stands for, no bounds.
  // That value is no cut-off, so there's no scale.
  rows.find((r) => r.column.externalGrade).column.gradingSchemaId = '_403_1';
  const schemas = load('schemas').results;
  assert.equal(U.grade(rows, schemas).scale, null);
  // Where Ultra sends each symbol's lowerBound: [[letter, min]], highest first.
  const bounded = clone(schemas);
  bounded[2].symbols.forEach((s, i) => { s.lowerBound = [94, 84, 74, 64, 0][i]; });
  assert.deepEqual(U.grade(rows, bounded).scale, [['A', 94], ['B', 84], ['C', 74], ['D', 64], ['F', 0]]);
  delete bounded[2].symbols[1].lowerBound;
  assert.equal(U.grade(rows, bounded).scale, null, 'all or nothing: a gap is no scale');
  // No overall column returned: the share of points, flagged as an estimate.
  const e = U.grade(status());
  assert.deepEqual([e.kind, e.estimate, e.overall], ['points', true, null]);
  assert.equal(e.percent(), 85);
  // A formula Glaze can't read: the estimate, beside Blackboard's own figure, with why.
  const odd = book();
  odd.find((r) => r.column.externalGrade).column.calculatedFormula.formula = '@X@BBCalColElem(avg:{"items":[]})@X@';
  const u = U.grade(odd);
  assert.deepEqual([u.kind, u.estimate, u.overall], ['points', true, 88]);
  assert.equal(u.why, "its overall grade uses rules Glaze can't read");
  // One that doesn't reproduce Blackboard's figure: the same.
  const off = book();
  off.find((r) => r.column.externalGrade).displayGrade.score = 87;
  assert.deepEqual([U.grade(off).estimate, U.grade(off).overall], [true, 87]);
  assert.equal(U.grade(off).why, "its recipe doesn't come out at Blackboard's own figure");
  // The letter Blackboard writes for the overall grade, where it writes one.
  const lettered = book();
  lettered.find((r) => r.column.externalGrade).displayGrade.text = 'B+';
  assert.equal(U.grade(lettered).letter, 'B+');
  assert.equal(U.grade(book()).letter, null);
});

test("this term's courses: a student's, open, within their term's dates; organizations, closed and other roles left out", () => {
  const mem = clone(load('memberships').results);
  const all = U.current(mem, NOW);
  assert.deepEqual(all.courses.map((c) => c.id), ['_101_1', '_102_1', '_103_1', '_104_1']);
  assert.deepEqual([all.key, all.name, all.from, all.to], ['_51_1', 'Fall 2026', Date.parse('2026-08-31T04:00:00.000Z'), Date.parse('2026-12-22T04:59:00.000Z')]);
  assert.equal(all.courses[0].m, mem[0]);
  mem[0].course.isClosed = true;
  mem[1].role = 'P';
  mem[2].course.isOrganization = true;
  mem[3].course.term = { ...mem[3].course.term, id: '_52_1', name: 'Spring 2027', startDate: '2027-01-19T05:00:00.000Z', endDate: '2027-05-20T03:59:00.000Z' };
  assert.deepEqual(U.current(mem, NOW).courses, []);
  assert.deepEqual(U.current(mem, Date.parse('2027-02-01T00:00:00Z')).courses.map((c) => c.id), ['_104_1']);
  // A term with no dates counts as on.
  delete mem[3].course.term.startDate;
  mem[3].course.term.durationType = 'CONTINUOUS';
  assert.deepEqual(U.current(mem, NOW).courses.map((c) => c.id), ['_104_1']);
  assert.equal(U.current(mem, NOW).name, '');
});

test("a course's grade over the term, for Insights: Blackboard's own figure after each graded item, by due date", () => {
  const rows = book();
  const tr = U.trend(rows, 'UTC');
  // Discussion (Sep 14), Lab Report 1 (Sep 21), Quiz 1 (Sep 28); the last point is Blackboard's own 88.
  assert.deepEqual(tr.map(([at]) => new Date(at).toISOString().slice(0, 10)), ['2026-09-14', '2026-09-21', '2026-09-28']);
  assert.equal(tr.at(-1)[1], 88);
  assert.equal(tr[0][1], 100); // the discussion alone, 10 of 10
  // No overall grade: the estimate's points, the same way.
  const st = U.trend(status(), 'UTC');
  assert.deepEqual(st.map(([, pct]) => pct), [85]);
});

test('To Do is read in 14-day slices, the calendar in 56-day ones; a range that is not one is refused', () => {
  const s = U.slices(NOW, NOW + 30 * 864e5, 14);
  assert.deepEqual(s.map(([a, b]) => (b - a) / 864e5), [14, 14, 2]);
  assert.equal(s[0][0], NOW);
  assert.equal(s[2][1], NOW + 30 * 864e5);
  assert.deepEqual(U.slices(NOW, NOW, 14), []);
  for (const [a, b, d] of [[NOW, NOW + 1, 0], [NOW, NOW + 1, -1], [NOW + 1, NOW, 14], [NaN, NOW, 14], [NOW, Infinity, 14], [NOW, NOW + 1, NaN]]) {
    assert.throws(() => U.slices(a, b, d), RangeError);
  }
});

// A stand-in calendar: perDay items a day in each window asked for, at most cap a page, with paging.count saying how
// many there are and a nextPage that is never followed.
const calendarSite = (perDay, cap = 200) => {
  const asked = [];
  const f = async (url) => {
    const u = new URL(url);
    const a = Date.parse(u.searchParams.get('since')), b = Date.parse(u.searchParams.get('until'));
    asked.push([a, b]);
    const n = Math.round(((b - a) / 864e5) * perDay);
    const results = Array.from({ length: Math.min(n, cap) }, (_, i) => ({ itemSourceId: `_${(a / 1000) % 1e6 + i}_1`, itemSourceType: 'x.GradableItem', calendarId: '_1_1' }));
    return { ok: true, status: 200, text: async () => JSON.stringify({ results, paging: { count: n, nextPage: '/learn/api/v1/calendars/calendarItems?wider' } }) };
  };
  return { f, asked };
};

test("a full calendar page isn't taken as the whole window: it's split, within a bound, or marked incomplete", async () => {
  const D = 864e5;
  // Under the cap: one request for a 56-day slice, complete.
  const quiet = calendarSite(1);
  const q = await U.read({ origin: o, f: quiet.f }).calendar(NOW, NOW + 56 * D);
  assert.deepEqual([q.items.length, q.complete, quiet.asked.length], [56, true, 1]);
  // 250 in the window, 200 sent: asked again in halves, each of which answers whole.
  const busy = calendarSite(250 / 56);
  const b = await U.read({ origin: o, f: busy.f }).calendar(NOW, NOW + 56 * D);
  assert.equal(b.complete, true);
  assert.deepEqual(busy.asked, [[NOW, NOW + 56 * D], [NOW, NOW + 28 * D], [NOW + 28 * D, NOW + 56 * D]]);
  // A count above what came back is not whole either, under the cap too.
  const short = calendarSite(150 / 56, 100);
  assert.equal((await U.read({ origin: o, f: short.f }).calendar(NOW, NOW + 56 * D)).complete, true);
  assert.equal(short.asked.length, 3);
  // Too busy to cover within the bound: what came back, marked incomplete, never more than 16 requests.
  const flood = calendarSite(1e6);
  const fl = await U.read({ origin: o, f: flood.f }).calendar(NOW, NOW + 56 * D);
  assert.deepEqual([fl.complete, flood.asked.length], [false, 16]);
  assert.ok(fl.items.length > 0);
});

// A stand-in Ultra: answers by path (the longest prefix of path and query that matches), records every request.
const ultra = (answers) => {
  const asked = [];
  const f = async (url, init) => {
    asked.push({ url, init });
    const u = new URL(url);
    const key = Object.keys(answers).filter((k) => (u.pathname + u.search).startsWith(k)).sort((a, b) => b.length - a.length)[0];
    const body = key ? answers[key] : null;
    return { ok: !!body, status: body ? 200 : 404, text: async () => JSON.stringify(typeof body === 'function' ? body(u) : body) };
  };
  return { f, asked };
};

test('the reader: GET only, to this site, redirects refused, paged and bounded, stale answers dropped', async () => {
  const { f, asked } = ultra({
    '/learn/api/v1/terms?limit=200': { results: [{ id: '_1_1' }], paging: { nextPage: '/learn/api/v1/terms?limit=200&offset=1' } },
    '/learn/api/v1/terms?limit=200&offset=1': { results: [{ id: '_2_1' }], paging: { nextPage: 'https://elsewhere.example.com/learn/api/v1/terms?offset=2' } },
  });
  const r = U.read({ origin: o, f });
  assert.deepEqual((await r.terms()).map((t) => t.id), ['_1_1', '_2_1']);
  assert.equal(asked.length, 2, 'never follows a page to another site');
  for (const { url, init } of asked) {
    assert.ok(url.startsWith(`${o}/learn/api/`));
    assert.deepEqual([init.method, init.credentials, init.redirect], ['GET', 'same-origin', 'error']);
  }
  await assert.rejects(r.get('/ultra/course'), /not Ultra's API/);
  await assert.rejects(r.get('//elsewhere.example.com/learn/api/v1/x'), /not Ultra's API/);
  // Bounded: a list that pages forever stops at maxPages.
  const loop = ultra({ '/learn/api/v1/terms': { results: [{ id: '_1_1' }], paging: { nextPage: '/learn/api/v1/terms?limit=200' } } });
  assert.equal((await U.read({ origin: o, f: loop.f, maxPages: 3 }).terms()).length, 3);
  // A caller that moved on while a request was out gets nothing, and nothing more is asked.
  let live = true;
  const slow = ultra({ '/learn/api/v1/terms': () => { live = false; return { results: [{ id: '_1_1' }], paging: { nextPage: '/learn/api/v1/terms?x' } }; } });
  await assert.rejects(U.read({ origin: o, f: slow.f, live: () => live }).terms(), new RegExp(U.STALE));
  assert.equal(slow.asked.length, 1);
  const ac = new AbortController();
  ac.abort();
  const none = ultra({});
  await assert.rejects(U.read({ origin: o, f: none.f, signal: ac.signal }).terms(), new RegExp(U.STALE));
  assert.equal(none.asked.length, 0);
});

test('planner: everything due, one request at a time from this site, due-date exceptions honoured', async () => {
  const { f, asked } = ultra({
    '/learn/api/v1/users/me': { id: '_900_1' },
    '/learn/api/v1/users/_900_1/memberships': load('memberships'),
    '/learn/api/v1/calendars/todo/studentItems': load('todo'),
    // [M] its nextPage leads to a wider window, not to more of this one: never followed.
    '/learn/api/v1/calendars/calendarItems': { ...load('calendar-items'), paging: { nextPage: '/learn/api/v1/calendars/calendarItems?since=x' } },
    '/learn/api/v1/calendars/calendarItems?since=x': { results: [{ ...load('calendar-items').results[1], itemSourceId: '_697_1' }] },
    '/learn/api/v1/courses/_101_1/gradebook/grades': load('grades'),
    '/learn/api/v1/courses/_102_1/gradebook/grades': load('grades-status'),
    // Course _101_1 grants no exceptions here; in _102_1 the student has one for Essay 3.
    '/learn/api/v1/courses/_101_1/gradebook/memberships/_301_1/exceptions': { results: [] },
    '/learn/api/v1/courses/_102_1/gradebook/memberships/_302_1/exceptions': { results: [{ columnId: '_613_1', dueDate: '2026-10-30T03:59:00.000Z' }] },
  });
  const { items, complete } = await U.planner(U.read({ origin: o, f }), { from: LATER - 14 * 864e5, to: LATER + 14 * 864e5, now: LATER });
  assert.equal(complete, true);
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(by).sort(), ['_603_1', '_605_1', '_606_1', '_613_1']);
  assert.deepEqual([by._603_1.state, by._603_1.sub.missing], ['missing', true]); // past due, nothing handed in
  assert.deepEqual([by._613_1.state, by._613_1.sub], ['unknown', null]); // past due, but the student has an exception
  assert.equal(by._613_1.course, 'ENG 1100: College Writing');
  assert.ok(asked.every(({ url, init }) => url.startsWith(`${o}/learn/api/`) && init.method === 'GET'));
  const paths = asked.map(({ url }) => new URL(url).pathname);
  assert.equal(paths.filter((p) => p.endsWith('/studentItems')).length, 2, 'four weeks of To Do in two slices');
  assert.equal(asked.find(({ url }) => url.includes('/_302_1/exceptions')).url.split('columnId=')[1], '_613_1');
  assert.equal(asked.length, 9);
});

test('a due-date exception counts for its own column only, not one whose id starts the same', async () => {
  const row = (columnId) => ({ columnId, column: { dueDate: '2026-10-01T03:59:00.000Z' }, submissionStatus: { status: 'NOT_SUBMITTED' } });
  const r = { get: async () => ({ results: [{ columnId: '_612_10', dueDate: '2026-10-30T03:59:00.000Z' }] }) };
  const excepted = await U.excepts(r, { id: '_302_1', dueDateExceptionType: 'Normal' }, '_102_1', [row('_612_1'), row('_612_10')], LATER);
  assert.deepEqual([excepted('_612_10'), excepted('_612_1')], [true, false]);
});

test('the due-date chips\' late check takes an exception for its own column only, as excepts does', async () => {
  const part = src('content-ultra.js'), lateIn = part.slice(part.indexOf('  const lateIn = '), part.indexOf('  // Per-course gradebook cache.'));
  const row = (columnId) => ({ columnId, column: { dueDate: '2026-10-01T03:59:00.000Z' }, lastAttempt: { attemptDate: '2026-10-02T03:59:00.000Z' } });
  const late = await require('node:vm').runInNewContext(`${lateIn}\nlateIn`, {
    GZ_GRADES: { awaiting: (r) => r, late: () => true }, GZ_PAGE: { submitted: () => true }, I: { settings: { enhance: { inline: true } } }, Set, Promise,
    myCourses: async () => [{ courseId: '_102_1', id: '_302_1', dueDateExceptionType: 'Normal' }], api: async () => ({ results: [{ columnId: '_612_10' }] }),
  })('_102_1', [row('_612_1'), row('_612_10')]);
  assert.deepEqual([...late], ['_612_1']);
});

test("PRIVACY doesn't promise folder previews leave memory after a minute: the minute is only when they're asked again", () => {
  const para = src('PRIVACY.md').match(/- \*\*Folder previews\*\*[\s\S]*?(?=\n- \*\*)/)[0];
  assert.doesNotMatch(para, /kept in memory for a minute/);
  assert.match(para, /until you leave or reload the page/);
});

// Codex B5 review: the notes app's Blackboard link reads a course's content through the reader, never the old helper.
test("a course's content for links: the public API through the reader, kept to id, parent, title and links", async () => {
  const asked = [];
  const extra = { id: '_9_1', parentId: '_720_1', title: 'Synthetic LTI', links: [{ rel: 'alternate', href: '/ultra/redirect?x=9', type: 'text/html', title: 'UI' }],
    contentDetail: { 'resource/x-bb-blti-link': { secret: 'synthetic-lti-secret', key: 'synthetic-lti-key' } }, body: '<p>x</p>', availability: { available: 'Yes', adaptiveRelease: {} } };
  const hidden = { id: '_8_1', title: 'Hidden', links: [{ rel: 'alternate', href: '/ultra/redirect?x=8' }], availability: { available: 'No' } };
  const f = async (url, init) => {
    asked.push([url, init.method, init.redirect, init.signal]);
    return { ok: true, status: 200, text: async () => JSON.stringify({ results: [...load('contents').results, extra, hidden] }) };
  };
  const ctl = new AbortController();
  const { items, complete } = await U.read({ origin: o, f, signal: ctl.signal }).contents('_101_1');
  assert.deepEqual(asked.map(([u, m, r, s]) => [u, m, r, s === ctl.signal]),
    [[`${o}/learn/api/public/v1/courses/_101_1/contents?limit=200&fields=id%2CparentId%2Ctitle%2Cavailability%2Clinks&recursive=true`, 'GET', 'error', true]]);
  assert.equal(complete, true);
  assert.ok(items.some((x) => x.id === '_9_1') && !items.some((x) => x.id === '_8_1'), 'what students can open');
  assert.deepEqual(items.find((x) => x.id === '_9_1'), { id: '_9_1', parentId: '_720_1', title: 'Synthetic LTI', links: [{ rel: 'alternate', href: '/ultra/redirect?x=9' }] });
  assert.doesNotMatch(JSON.stringify(items), LTI, 'nothing else kept, whatever came back');
  assert.deepEqual(await U.read({ origin: o, f }).contents('7'), { items: [], complete: true }, 'an Ultra course id only');
  // Aborted (the picker closed): the read stops.
  ctl.abort();
  await assert.rejects(U.read({ origin: o, f, signal: ctl.signal }).contents('_101_1'), /stale/);
});

// Codex B5 fix verification #7: the picker shows what search may show, by one rule: released now, known availability,
// and every ancestor too.
test("a course's content for links: only what is released now, with known availability, under released folders", async () => {
  const shapes = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ultra-search.json'), 'utf8')).contents
    .map((x) => ({ ...x, links: [{ rel: 'alternate', href: `/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=${x.id}` }] }));
  const f = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ results: shapes }) });
  const { items } = await U.read({ origin: o, f }).contents('_101_1');
  assert.deepEqual(items.map((x) => x.title), ['Laboratory', 'Reading: Cell membrane', 'Lab report']);
  for (const t of ['Hidden unit', 'Lab hidden child', 'Lab unknown availability', 'Lab cycle', 'Final exam answer key', 'Expired answers', 'Restricted answers', 'Unknown release', 'Malformed release', 'Lab in future folder']) {
    assert.ok(!items.some((x) => x.title === t), t);
  }
  // The same rule as search's documents.
  const search = U.searchItems(U.SEARCH_KINDS[0], shapes, { id: '_101_1', name: 'BIO' }, (h) => h);
  assert.deepEqual(items.map((x) => x.id), search.map((x) => x.key.split(':')[1]));
});

// Codex B5 fix verification, finding 2: a nextPage may page this public list only, with its own fields.
test("a course's content for links pages only the public list, asking each page with its own fields", async () => {
  const run = async (nextPage) => {
    const asked = [];
    const f = async (url) => {
      asked.push(url);
      const page2 = asked.length > 1;
      return { ok: true, status: 200, text: async () => JSON.stringify({ results: [{ id: page2 ? '_2_1' : '_1_1', title: page2 ? 'Two' : 'One', availability: { available: 'Yes', adaptiveRelease: {} } }], paging: page2 ? {} : { nextPage } }) };
    };
    const { items, complete } = await U.read({ origin: o, f }).contents('_101_1');
    return { asked, titles: items.map((x) => x.title), complete };
  };
  const first = `${o}/learn/api/public/v1/courses/_101_1/contents?limit=200&fields=id%2CparentId%2Ctitle%2Cavailability%2Clinks&recursive=true`;
  // The ordinary second page: its offset, with this list's own fields and limit.
  const ok = await run('/learn/api/public/v1/courses/_101_1/contents?offset=200&limit=200');
  assert.deepEqual(ok.asked, [first, `${o}/learn/api/public/v1/courses/_101_1/contents?limit=200&fields=id%2CparentId%2Ctitle%2Cavailability%2Clinks&offset=200&recursive=true`]);
  assert.deepEqual(ok.titles, ['One', 'Two']);
  assert.equal(ok.complete, true);
  // A next page that drops the fields, or asks for more: still this list's fields only.
  const wider = await run('/learn/api/public/v1/courses/_101_1/contents?offset=200&fields=id,contentDetail,body&limit=999');
  assert.equal(wider.asked[1], ok.asked[1]);
  // The private contents, another course, another resource, another site: never asked.
  for (const next of ['/learn/api/v1/courses/_101_1/contents', '/learn/api/public/v1/courses/_102_1/contents?offset=200', '/learn/api/public/v1/courses/_101_1/contents/_1_1/children', 'https://evil.example/learn/api/public/v1/courses/_101_1/contents?offset=200']) {
    const r = await run(next);
    assert.deepEqual(r.asked, [first], next);
    assert.deepEqual(r.titles, ['One']);
    assert.equal(r.complete, false, 'and the list says it is incomplete');
  }
});
