// lib/ultra.js: Blackboard Ultra's answers in the shapes Glaze's features use, on the synthetic fixtures
// (test/fixtures/ultra-*.json, shapes from parity/spikes/B0.md).
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

// ---- the LTI credential fields (parity/spikes/B0.md, Safety notes) ---------------------------------------------------
test('private content is asked for without contentDetail, by both callers', () => {
  for (const f of [U.PEEK_FIELDS, U.FILES_FIELDS]) assert.doesNotMatch(f, /contentDetail|\//);
  assert.match(src('features/previews.js'), /\/children\?fields=\$\{GZ_ULTRA\.PEEK_FIELDS\}/);
  assert.match(src('features/download.js'), /\/children\?limit=200&fields=\$\{GZ_ULTRA\.FILES_FIELDS\}/);
  // Neither caller reads contentDetail, nor does anything else Glaze ships.
  for (const f of ['content.js', 'features/previews.js', 'features/download.js', 'lib/page.js', 'lib/ultra.js', 'lib/grades.js']) {
    assert.doesNotMatch(src(f).replace(/^\s*\/\/.*$/gm, ''), /contentDetail/, f);
  }
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
  ];
  for (const [name, row, now, state, flags, excepted] of cases) {
    const s = U.standing(row, now, excepted);
    assert.equal(s.state, state, name);
    for (const [k, v] of Object.entries(flags)) assert.equal(s[k], v, `${name}: ${k}`);
  }
  assert.equal(U.standing(noReceipt, NOW).at, Date.parse(late.lastAttempt.attemptDate));
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
  assert.equal(g.scale, null); // the overall column's schema is a percent scale
  // A letter scale: [[letter, min]], highest first.
  rows.find((r) => r.column.externalGrade).column.gradingSchemaId = '_403_1';
  assert.deepEqual(U.grade(rows, load('schemas').results).scale, [['A', 95], ['B', 85], ['C', 75], ['D', 65], ['F', 0]]);
  // No overall column returned: the share of points, flagged as an estimate.
  const e = U.grade(status());
  assert.deepEqual([e.kind, e.estimate, e.overall], ['points', true, null]);
  assert.equal(e.percent(), 85);
  // A formula Glaze can't read: the estimate, beside Blackboard's own figure, with why.
  const odd = book();
  odd.find((r) => r.column.externalGrade).column.calculatedFormula.formula = '@X@BBCalColElem(avg:{"items":[]})@X@';
  const u = U.grade(odd);
  assert.deepEqual([u.kind, u.estimate, u.overall], ['points', true, 88]);
  assert.match(u.why, /can't work out/);
  // One that doesn't reproduce Blackboard's figure: the same.
  const off = book();
  off.find((r) => r.column.externalGrade).displayGrade.score = 87;
  assert.deepEqual([U.grade(off).estimate, U.grade(off).overall], [true, 87]);
});

test('To Do is read in 14-day slices, the calendar in 56-day ones', () => {
  const s = U.slices(NOW, NOW + 30 * 864e5, 14);
  assert.deepEqual(s.map(([a, b]) => (Date.parse(b) - Date.parse(a)) / 864e5), [14, 14, 2]);
  assert.equal(s[0][0], new Date(NOW).toISOString());
  assert.equal(s[2][1], new Date(NOW + 30 * 864e5).toISOString());
  assert.deepEqual(U.slices(NOW, NOW, 14), []);
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
  const items = await U.planner(U.read({ origin: o, f }), { from: LATER - 14 * 864e5, to: LATER + 14 * 864e5, now: LATER });
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
