const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/page.js');
const I = require('../lib/i18n.js');

const now = new Date(2026, 9, 11, 15, 0); // Sun 11 Oct 2026, 3 PM

test('due dates in the formats Ultra writes', () => {
  assert.equal(P.due('Due date: 10/11/26, 11:59 PM (EDT)', now), 'today');
  assert.equal(P.due('Due: 10/13/26 9:00 AM', now), 'soon');
  assert.equal(P.due('Due date: 10/18/26, 11:59 PM (EDT)', now), null);
  assert.equal(P.due('Due Date: 10/4/26, 11:59 PM (EDT)', now), 'overdue');
  assert.equal(P.due('Due date: 10/11/2026, 2:59 PM', now), 'overdue');
});

test('12 AM and 12 PM', () => {
  assert.equal(P.due('Due date: 10/12/26, 12:00 AM', now), 'soon');   // midnight starting Monday
  assert.equal(P.due('Due date: 10/11/26, 12:00 PM', now), 'overdue'); // noon today, already past
});

test('the soon window is three days past today', () => {
  assert.equal(P.due('Due date: 10/14/26, 11:59 PM', now), 'soon');
  assert.equal(P.due('Due date: 10/15/26, 12:01 AM', now), null);
});

test('anything else is left alone', () => {
  for (const t of ['Due date: 18.10.26, 23:59', 'Posted 10/11/26', 'Due date: tomorrow', '', 'Due date: 13/45/26, 11:59 PM']) {
    assert.equal(P.due(t, now), null, t);
  }
});

test('score share and band', () => {
  assert.deepEqual(P.score('2', '2'), { ratio: 1, band: 'hi' });
  assert.deepEqual(P.score('7', '10'), { ratio: 0.7, band: 'mid' });
  assert.equal(P.score('0', '100').band, 'lo');
  assert.equal(P.score('12', '10').ratio, 1);
  for (const [g, m] of [['-', '10'], ['5', '0'], ['5', ''], ['A', 'B']]) assert.equal(P.score(g, m), null, `${g}/${m}`);
});

test('hover hints for dates read naturally', () => {
  assert.deepEqual(P.when('Due date: 10/13/26, 11:59 PM (EDT)', now), { title: 'Due in 2 days', sub: 'Tuesday, October 13 at 11:59 PM', rel: 'in 2 days', past: false });
  assert.deepEqual(P.when('Due date: 10/12/26, 9:00 AM', now), { title: 'Due tomorrow', sub: 'Monday, October 12 at 9:00 AM', rel: 'tomorrow', past: false });
  assert.equal(P.when('Due date: 10/11/26, 11:59 PM', now).title, 'Due in 9 hours');
  assert.equal(P.when('Due date: 10/11/26, 3:20 PM', now).title, 'Due in 20 minutes');
  assert.equal(P.when('Due Date: 10/4/26, 11:59 PM', now).title, 'Was due last week');
  assert.deepEqual(P.when('9/17/26', now), { title: '3 weeks ago', sub: 'Thursday, September 17', rel: '3 weeks ago', past: true });
  assert.equal(P.when('10/10/26', now).title, 'Yesterday');
  assert.equal(P.when('1/5/27', now).sub, 'Tuesday, January 5, 2027');
  assert.equal(P.when('Due: 12/25/26', now).title, 'Due in 2 months');
});

test('no hint where there is no real date', () => {
  for (const t of ['', 'Fall 2026', '2 / 2', '2/30/26', '13/1/26', null]) assert.equal(P.when(t, now), null, String(t));
});

// ---- other locales ----
const at = new Date(2026, 9, 18, 23, 59); // next Sunday, a minute before midnight
const fmt = (l, o, d = at) => new Intl.DateTimeFormat(l, o).format(d);
const same = (l, text, want = at, timed = true) => {
  const r = P.read(text, l, now);
  assert.ok(r, `${l}: ${text}`);
  assert.equal(r.at.getTime(), want.getTime(), `${l}: ${text} read as ${r.at}`);
  assert.equal(r.timed, timed, `${l}: ${text}`);
};
const LOCALES = ['en-GB', 'en-AU', 'en-CA', 'de', 'fr', 'fr-CA', 'es', 'es-MX', 'pt-BR', 'nl', 'it', 'pl', 'ru', 'tr', 'sv', 'fi', 'da', 'hu', 'cy', 'ja', 'zh', 'zh-TW', 'ko', 'ar', 'ar-SA', 'he'];

test('dates as Intl writes them, in many locales', () => {
  const morning = new Date(2026, 0, 5, 0, 30); // 12:30 AM: the hour that tests a 12-hour clock
  for (const l of LOCALES) {
    same(l, `${fmt(l, { dateStyle: 'short', timeStyle: 'short' })} (EDT)`);
    same(l, fmt(l, { dateStyle: 'short', timeStyle: 'short', hour12: true }, morning), morning);
    same(l, fmt(l, { dateStyle: 'short', timeStyle: 'short', hour12: false }));
    same(l, fmt(l, { dateStyle: 'short' }), new Date(2026, 9, 18), false);
    same(l, fmt(l, { dateStyle: 'long', timeStyle: 'short' }));
    same(l, fmt(l, { dateStyle: 'medium' }), new Date(2026, 9, 18), false);
  }
});

test('dates as Ultra writes them: its CLDR, not always the browser\'s', () => {
  // Short patterns from Ultra's own cldrdata bundles (Oct 2026): year widths and clocks differ from Intl's.
  const rlm = String.fromCharCode(0x200f);
  for (const [l, t] of [['en-GB', '18/10/2026, 23:59'], ['en-GB', '18/10/2026, 11:59 pm'], ['de-DE', 'Fälligkeitsdatum: 18.10.26, 23:59 (MESZ)'],
    ['fr-FR', '18/10/2026 23:59'], ['es-ES', 'Fecha de vencimiento: 18/10/26 23:59'], ['es-ES', '18/10/26 11:59 p. m.'], ['pt-BR', '18/10/26 23:59'],
    ['nl-NL', '18-10-26 23:59'], ['it-IT', '18/10/26, 23:59'], ['ja-JP', '期限: 2026/10/18 23:59'], ['zh', '26/10/18 23:59'], ['zh', '26/10/18 下午11:59'],
    ['ko-KR', '26. 10. 18. 23:59'], ['ko-KR', '26. 10. 18. 오후 11:59'], ['he-IL', '18.10.2026, 23:59'], ['tr-TR', '18.10.2026 23:59'],
    ['ar-SA', `١٨${rlm}/١٠${rlm}/٢٠٢٦ ١١:٥٩ م`], ['ar', `١٨${rlm}/١٠${rlm}/٢٠٢٦، ١١:٥٩ م`]]) same(l, t);
  // Vietnamese puts the time first; Hong Kong writes 年 dates though its short dates are day-first.
  same('vi', '23:59 18/10/26');
  same('vi', '12:30 SA 18/10/26', new Date(2026, 9, 18, 0, 30));
  same('zh-HK', '2026年10月18日 下午11:59');  // Morning in Arabic: ص, not م.
  same('ar-SA', `١٨${rlm}/١٠${rlm}/٢٠٢٦ ١١:٥٩ ص`, new Date(2026, 9, 18, 11, 59));
});

test('month names, with or without a year', () => {
  same('fr', 'À rendre le 18 octobre 2026 à 23:59');
  same('es', 'Fecha de entrega: 18 de octubre de 2026, 23:59');
  same('pt-BR', '18 de out. de 2026', new Date(2026, 9, 18), false);
  same('de', '18. Okt.', new Date(2026, 9, 18), false);
  same('he', '18 באוק׳ 2026', new Date(2026, 9, 18), false);
  same('en-CA', 'Oct 18, 2026, 11:59 p.m.');
  // "Juniper" is no month.
  assert.equal(P.read('Projekt Juniper 3', 'de', now), null);
});

test('two dates: the first, and a later date is never read as a time', () => {
  same('fr', 'Dates d’échéance : 17/09/2026 23:59 et 20/09/2026 23:59', new Date(2026, 8, 17, 23, 59));
  same('de', 'Abgabetermine: 17.09.26 und 20.09.26', new Date(2026, 8, 17), false);
});

test('no date where there is none, in any locale', () => {
  for (const l of LOCALES) {
    for (const t of ['', null, 'Note: 5/5', 'Version 1.2.3', '31.31.31', '2 / 2', 'Module 3']) assert.equal(P.read(t, l, now), null, `${l}: ${t}`);
  }
  assert.equal(P.read('31.02.26', 'de', now), null); // rolls over: not a real date
  assert.equal(P.read('1.2.2026', 'not a locale!', now), null);
});

test('en-US reads only what it always has', () => {
  for (const t of ['Due date: 18.10.26, 23:59', 'Oct 18, 2026', '2026-10-18', '18/10/2026']) {
    assert.equal(P.read(t, 'en-US', now), null, t);
    assert.equal(P.when(t, now, 'en-US'), null, t);
  }
  for (const l of [undefined, 'en', 'en-US']) {
    assert.deepEqual(P.when('Due date: 10/13/26, 11:59 PM (EDT)', now, l), { title: 'Due in 2 days', sub: 'Tuesday, October 13 at 11:59 PM', rel: 'in 2 days', past: false });
    assert.equal(P.due('Due date: 10/11/26, 11:59 PM (EDT)', now, l), 'today');
    assert.equal(P.due('Due date: 10/11/26', now, l), null); // no time, no urgency
  }
});

test('urgency, hints and status in another locale', () => {
  assert.equal(P.due('Fecha de vencimiento: 13/10/26 9:00', now, 'es-ES'), 'soon');
  assert.equal(P.due('Fälligkeitsdatum: 11.10.26, 23:59', now, 'de-DE'), 'today');
  assert.equal(P.due('Fälligkeitsdatum: 11.10.26', now, 'de-DE'), null);
  // Glaze's words, dates and numbers in Ultra's language; whether it's a due date comes from where the
  // text is.
  const t = (k, v, l) => I.t(k, v, l);
  assert.deepEqual(P.when('13/10/2026 23:59', now, 'fr', true), { title: t('Due {when}', { when: 'après-demain' }, 'fr'), sub: 'mardi 13 octobre à 23:59', rel: 'après-demain', past: false });
  assert.equal(P.when('13/10/2026', now, 'fr').title, 'Après-demain');
  assert.equal(P.when('4/10/26 9:00', now, 'es-ES', true).title, t('Was due {when}', { when: 'la semana pasada' }, 'es'));
  assert.deepEqual(P.status('18.10.26, 23:59', 'false', {}, now, false, 'de-DE'), { label: `nächste Woche · ${t('Unopened', {}, 'de')}`, tone: 'later' });
  assert.deepEqual(P.status('04.10.26, 23:59', null, {}, now, false, 'de-DE'), { label: t('Past due · {status}', { status: t('Not submitted', {}, 'de') }, 'de'), tone: 'overdue' });
  const graded = { status: 'GRADED', displayGrade: { score: 18.5 }, pointsPossible: 20 };
  assert.equal(P.status('13-10-26 23:59', null, graded, now, false, 'nl').label, t('Graded · {mark}', { mark: '18,5/20' }, 'nl'));
  assert.equal(P.overall([{ effectiveScore: 77.30273, pointsPossible: 93.75, column: { externalGrade: true } }], 'fr').label, '82,45 %');
  // A language Glaze doesn't speak is English throughout, dates included.
  assert.equal(P.when(new Date(2026, 9, 13, 23, 59), now, 'ar-SA', true).sub, 'Tuesday, October 13 at 11:59 PM');
});

test('dates from Ultra\'s data read the same in every locale', () => {
  const soon = new Date('2026-10-14T03:59:00.000Z'); // gradebook column.dueDate
  const d = new Date(2026, 9, 13, 23, 59);
  for (const l of [undefined, 'en-US', 'ar-SA', 'not a locale!']) {
    assert.equal(P.due(d, now, l), 'soon');
    assert.equal(P.when(d, now, l, true).title, 'Due in 2 days');
    assert.deepEqual(P.status(d, null, { status: 'NEEDS_GRADING' }, now, false, l), { label: 'Submitted · due in 2 days', tone: 'done' });
  }
  assert.equal(P.due(d, now, 'de'), 'soon');
  assert.equal(P.when(d, now, 'de', true).title, I.t('Due {when}', { when: 'übermorgen' }, 'de'));
  assert.equal(P.status(d, null, { status: 'NEEDS_GRADING' }, now, false, 'de').label, I.t('{status} · due {when}', { status: I.t('Submitted', {}, 'de'), when: 'übermorgen' }, 'de'));

  assert.equal(P.due(soon, now), P.due(new Date(soon), now));
  assert.equal(P.due(new Date('nonsense'), now), null);
  assert.equal(P.when(new Date('nonsense'), now), null);
});

test('describe() takes ISO dates from the content API', () => {
  assert.equal(P.describe(new Date('2026-10-19T03:59:00.000Z'), true, now).rel, 'next week');
  assert.equal(P.describe(new Date(2026, 9, 11, 18, 0), true, now).rel, 'in 3 hours');
});

test('the gradebook by content item, and what counts as done', () => {
  const grades = P.gradesByContent([
    { status: 'NEEDS_GRADING', column: { contentId: '_1_1' } },
    { status: 'GRADED', column: {} }, // an external tool's column: no content item
  ]);
  assert.deepEqual([...grades.keys()], ['_1_1']);
  assert.equal(P.gradesByContent(undefined).size, 0);
  assert.ok(P.isDone(null, { status: 'NEEDS_GRADING' }));
  assert.ok(P.isDone(null, { isExempt: true }));
  assert.ok(P.isDone('true', undefined));
  assert.ok(!P.isDone('mixed', {}));
});

test('command palette matching: in order, word starts and runs first', () => {
  const rank = (q, list) => list.map((t) => [t, P.fuzzy(q, t)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  assert.deepEqual(rank('cal', ['Calendar', 'Local files', 'Course calendar', 'Grades']), ['Calendar', 'Course calendar', 'Local files']);
  assert.deepEqual(rank('cs2010', ['202640-CS2010-800', '202640-SPAN1100-802']), ['202640-CS2010-800']);
  assert.deepEqual(rank('mod 3 disc', ['Module 3: Discussion', 'Module 4: Discussion', 'Discussions']), ['Module 3: Discussion']);
  assert.equal(P.fuzzy('', 'anything'), 0);
  assert.equal(P.fuzzy('zz', 'Grades'), -1);
});

test('status chips beside due dates in course content', () => {
  const soon = 'Due date: 10/13/26, 11:59 PM (EDT)'; // in 2 days
  const later = 'Due date: 10/18/26, 11:59 PM (EDT)'; // next week
  const gone = 'Due date: 10/4/26, 11:59 PM (EDT)'; // last week
  const S = (text, circle, grade) => P.status(text, circle, grade, now);
  // Graded, with the mark and a band like the score bars.
  assert.deepEqual(S(gone, null, { status: 'GRADED', displayGrade: { score: 18 }, pointsPossible: 20 }), { label: 'Graded · 18/20', tone: 'graded-hi' });
  assert.deepEqual(S(gone, null, { status: 'GRADED', displayGrade: { score: 2.5 }, pointsPossible: 5 }), { label: 'Graded · 2.5/5', tone: 'graded-lo' });
  assert.deepEqual(S(gone, null, { status: 'GRADED', displayGrade: { text: 'A-' } }), { label: 'Graded · A-', tone: 'done' });
  // Submitted: before the due date it still says when.
  assert.deepEqual(S(soon, null, { status: 'NEEDS_GRADING' }), { label: 'Submitted · due in 2 days', tone: 'done' });
  assert.deepEqual(S(gone, 'true', { status: 'NEEDS_GRADING' }), { label: 'Submitted', tone: 'done' });
  assert.deepEqual(S(gone, 'true', null), { label: 'Done', tone: 'done' });
  assert.deepEqual(P.status(gone, 'true', { status: 'NEEDS_GRADING' }, now, true), { label: 'Submitted late', tone: 'late' });
  assert.deepEqual(P.status(gone, null, { status: 'GRADED', displayGrade: { score: 9 }, pointsPossible: 10 }, now, true).label, 'Graded · 9/10', 'once graded, the grade is what matters');
  assert.deepEqual(S(soon, null, { isExempt: true }), { label: 'Exempt', tone: 'muted' });
  // Not done yet: the countdown, with the circle's word where the course has circles.
  assert.deepEqual(S(soon, 'false', {}), { label: 'in 2 days · Unopened', tone: 'soon' });
  assert.deepEqual(S(later, 'mixed', {}), { label: 'next week · Opened', tone: 'later' });
  assert.deepEqual(S(later, null, {}), { label: 'next week', tone: 'later' });
  // Past due: said only when the status is known.
  assert.deepEqual(S(gone, null, {}), { label: 'Past due · Not submitted', tone: 'overdue' });
  assert.deepEqual(S(gone, 'mixed', undefined), { label: 'Past due · Opened', tone: 'overdue' });
  assert.equal(S(gone, null, undefined), null);
  assert.equal(S(gone, null, null), null);
});

test('the overall grade for course cards', () => {
  const col = { externalGrade: true, visible: true, visibleInBook: true };
  // As Ultra's Grades page shows it: 77.30273 of 93.75 is 82.45%, cut, not rounded to 82.46.
  assert.deepEqual(P.overall([{ column: { contentId: '_1_1' } }, { effectiveScore: 77.30273, pointsPossible: 93.75, column: col }]), { label: '82.45%', tone: 'graded-mid' });
  assert.deepEqual(P.overall([{ effectiveScore: 90, pointsPossible: 100, column: col }]), { label: '90%', tone: 'graded-hi' });
  assert.deepEqual(P.overall([{ effectiveScore: 8.999, pointsPossible: 10, column: col }]), { label: '89.99%', tone: 'graded-mid' });
  assert.deepEqual(P.overall([{ effectiveScore: 61, pointsPossible: 100, displayGrade: { text: 'D-' }, column: col }]), { label: 'D-', tone: 'graded-lo' });
  // Nothing graded yet, hidden from students, or no overall column: no chip.
  assert.equal(P.overall([{ effectiveScore: null, pointsPossible: 0, column: col }]), null);
  assert.equal(P.overall([{ effectiveScore: 50, pointsPossible: 100, column: { ...col, visible: false } }]), null);
  assert.equal(P.overall([{ effectiveScore: 50, pointsPossible: 100, column: { ...col, visibleInBook: false } }]), null);
  assert.equal(P.overall([{ effectiveScore: 50, pointsPossible: 100, column: { contentId: '_1_1' } }]), null);
  assert.equal(P.overall(undefined), null);
});

test('the current score for Canvas course cards', () => {
  // As /api/v1/courses?include[]=total_scores gives it, ids as strings.
  const course = (id, o = {}, e = {}) => ({ id, name: `Course ${id}`, hide_final_grades: false, enrollments: [{ type: 'student', computed_current_score: 83.5, computed_current_grade: null, ...e }], ...o });
  assert.deepEqual(P.canvasOverall([course('9'), course('10', {}, { computed_current_score: 91.234, computed_current_grade: 'A-' }), course('11', {}, { computed_current_score: 61 })]),
    { 9: { label: '83.5%', tone: 'graded-mid' }, 10: { label: 'A-', tone: 'graded-hi' }, 11: { label: '61%', tone: 'graded-lo' } });
  assert.equal(P.canvasOverall([course(9, {}, { computed_current_score: 83.5 })], 'fr')[9].label, '83,5\u00a0%');
  // Hidden grades, no score yet, no student enrollment (a teacher, an observer), or nothing at all: no chip.
  assert.deepEqual(P.canvasOverall([course('1', { hide_final_grades: true }), course('2', {}, { computed_current_score: null }), course('3', { enrollments: [{ type: 'teacher' }] }),
    course('4', { enrollments: undefined }), { id: '5', access_restricted_by_date: true }, null]), {});
  assert.deepEqual(P.canvasOverall({ errors: [] }), {});
  assert.deepEqual(P.canvasOverall(undefined), {});
});

test('Canvas course cards: a course that restricts quantitative data shows only its letter', () => {
  const course = (id, o = {}, e = {}) => ({ id, name: `Course ${id}`, hide_final_grades: false, enrollments: [{ type: 'student', computed_current_score: 83.5, computed_current_grade: null, ...e }], ...o });
  const rqd = { restrict_quantitative_data: true };
  // The letter Canvas coerces the score to, never the score; in the score's band.
  assert.deepEqual(P.canvasOverall([course('1', rqd, { computed_current_letter_grade: 'B' }), course('2', rqd, { computed_current_score: 95, computed_current_grade: '95%', computed_current_letter_grade: 'A' })]),
    { 1: { label: 'B', tone: 'graded-mid' }, 2: { label: 'A', tone: 'graded-hi' } });
  // Restricted with no letter: no chip rather than a number.
  assert.deepEqual(P.canvasOverall([course('3', rqd), course('4', rqd, { computed_current_letter_grade: null })]), {});
  // Not restricted (false, or not said): as before, the letter is only Canvas's when the course grades in letters.
  assert.deepEqual(P.canvasOverall([course('5', { restrict_quantitative_data: false }, { computed_current_letter_grade: 'B' }), course('6', {}, { computed_current_letter_grade: 'B' })]),
    { 5: { label: '83.5%', tone: 'graded-mid' }, 6: { label: '83.5%', tone: 'graded-mid' } });
  // Hidden final grades stay hidden.
  assert.deepEqual(P.canvasOverall([course('7', { ...rqd, hide_final_grades: true }, { computed_current_letter_grade: 'B' })]), {});
});

test('Canvas course cards: with grading periods, the current period\'s score', () => {
  const course = (id, o = {}, e = {}) => ({ id, name: `Course ${id}`, hide_final_grades: false, enrollments: [{ type: 'student', computed_current_score: 91, computed_current_grade: null, ...e }], ...o });
  const gp = { has_grading_periods: true };
  assert.deepEqual(P.canvasOverall([
    course('1', gp, { current_period_computed_current_score: 43, current_period_computed_current_grade: null }),
    course('2', gp, { current_period_computed_current_score: 88.25, current_period_computed_current_grade: 'B+', computed_current_grade: 'A-' }),
    course('3', { has_grading_periods: false }, { current_period_computed_current_score: 43 }),
  ]), { 1: { label: '43%', tone: 'graded-lo' }, 2: { label: 'B+', tone: 'graded-mid' }, 3: { label: '91%', tone: 'graded-hi' } });
  // No current period (between periods): no score, so no chip, not the all-periods total.
  assert.deepEqual(P.canvasOverall([course('4', gp, { current_period_computed_current_score: null }), course('5', gp)]), {});
  // Restricted, with periods: Canvas's letter, the period's band.
  assert.deepEqual(P.canvasOverall([course('6', { ...gp, restrict_quantitative_data: true }, { current_period_computed_current_score: 43, computed_current_letter_grade: 'F' })]),
    { 6: { label: 'F', tone: 'graded-lo' } });
});

test('files in content items, as the content API sends them', () => {
  const o = 'https://learn.example.edu';
  // A File item.
  const file = { contentHandler: 'resource/x-bb-file', contentDetail: { 'resource/x-bb-file': { file: { permanentUrl: '/bbcswebdav/pid-1-dt-content-rid-2_1/xid-2_1', fileName: 'cheat sheet.jpg', fileSize: 81601 } } } };
  assert.deepEqual(P.files(file, o), [{ url: `${o}/bbcswebdav/pid-1-dt-content-rid-2_1/xid-2_1`, name: 'cheat sheet.jpg', size: 81601 }]);
  // A document block: file links carry data-bbfile (HTML-escaped JSON); videos and tool links don't count.
  const bf = (j) => JSON.stringify(j).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const rawText = `<div data-layout-row="r"><p><a data-bbid="x" data-bbfile="${bf({ linkName: 'Syllabus & Schedule.pdf', mimeType: 'application/pdf', render: 'inline' })}" href="${o}/bbcswebdav/pid-3-dt-content-rid-4_1/xid-4_1">Syllabus</a></p>`
    + `<a data-bbfile="${bf({ fileName: 'Foto.jpg', fileSize: 72864 })}" href="/bbcswebdav/pid-3-dt-content-rid-5_1/xid-5_1">pic</a>`
    + `<a data-bbfile="${bf({ src: 'https://video.example.com/V/Video?v=1', alt: 'Lecture' })}" href="https://video.example.com/V/Video?v=1">video</a>`
    + `<a data-bbfile="${bf({ linkType: 'LTI', title: 'Tool' })}">tool</a>`
    + `<a href="${o}/bbcswebdav/pid-3-dt-content-rid-6_1/xid-6_1">plain link</a>`
    + `<a data-bbfile="${bf({ linkName: 'elsewhere.pdf' })}" href="https://other.example.com/bbcswebdav/x">elsewhere</a></div>`;
  assert.deepEqual(P.files({ contentHandler: 'resource/x-bb-document', body: { rawText } }, o), [
    { url: `${o}/bbcswebdav/pid-3-dt-content-rid-4_1/xid-4_1`, name: 'Syllabus & Schedule.pdf', size: undefined },
    { url: `${o}/bbcswebdav/pid-3-dt-content-rid-5_1/xid-5_1`, name: 'Foto.jpg', size: 72864 },
  ]);
  for (const item of [null, {}, { body: { rawText: '<a data-bbfile="not json" href="/bbcswebdav/x">x</a>' } }]) assert.deepEqual(P.files(item, o), []);
});

test('reading time and progress for focus mode', () => {
  assert.equal(P.readMinutes(''), 0);
  assert.equal(P.readMinutes(null), 0);
  assert.equal(P.readMinutes('  a few words  '), 0); // an attachment's name, say: not worth a label
  assert.equal(P.readMinutes('word '.repeat(158)), 1);
  assert.equal(P.readMinutes('word '.repeat(1150)), 5);
  assert.equal(P.readShare(0, 2000, 800), 0);
  assert.equal(P.readShare(600, 2000, 800), 0.5);
  assert.equal(P.readShare(1300, 2000, 800), 1); // overscroll
  assert.equal(P.readShare(0, 800, 800), 1); // fits on screen: nothing left to scroll
});

test('folder completion in every language Ultra writes it', () => {
  // Ultra's own templates (its locale bundles), each in its language's order.
  const lines = ['3 of 7 completed', '3 de 7 completados', '3 éléments terminés sur 7', '3 von 7 abgeschlossen', '3 de 7 concluídos',
    '3 van 7 voltooid', '7 件中 3 件が完了済み', '3/7개 완료됨', 'Dokončeno: 3/7', '已完成 3 个 (共 7 个)', 'تم إكمال ٣ من أصل ٧', 'Ukończono 3 z 7'];
  for (const l of lines) assert.deepEqual(P.completion(l, true), { done: 3, total: 7 }, l);
  // "N of M started" is only shown while nothing is completed.
  assert.deepEqual(P.completion('7 件中 2 件が開始済み', false), { done: 0, total: 7 });
  for (const t of ['', null, 'Completed', '1,234 of 2,000 completed']) assert.equal(P.completion(t, true), null, t);
  // English reads as it did, wherever Ultra marks the line as it does: "completed" while some are, else "started".
  const old = (t) => { const m = t.match(/(\d+)\s+of\s+(\d+)\s+(completed|started)/i); return { done: /completed/i.test(m[3]) ? +m[1] : 0, total: +m[2] }; };
  for (let total = 1; total < 30; total++) {
    for (let k = 1; k <= total; k++) {
      assert.deepEqual(P.completion(`${k} of ${total} completed`, true), old(`${k} of ${total} completed`));
      assert.deepEqual(P.completion(`${k} of ${total} started`, false), old(`${k} of ${total} started`));
    }
  }
});

test('your place in a course: the latest 30 courses, the last 100 open folders each', () => {
  const all = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`_${i}_1`, { open: [], top: 0, at: 1000 + i }]));
  all.junk = null;
  const out = P.place(all, '_5_1', { open: ['_7_1', '_7_1', 'x"]', ...Array.from({ length: 120 }, (_, i) => `_${i + 100}_1`)], top: 812.6 }, 9999);
  assert.equal(Object.keys(out).length, 30);
  assert.deepEqual(Object.keys(out).slice(0, 3), ['_5_1', '_39_1', '_38_1']);
  assert.equal(out._5_1.open.length, 100);
  assert.equal(out._5_1.open[0], '_120_1', 'the oldest go first');
  assert.ok(!out._5_1.open.includes('x"]'));
  assert.equal(out._5_1.top, 813);
  assert.equal(out._5_1.at, 9999);
  assert.deepEqual(P.place(undefined, '_1_1', { open: ['_2_1'], top: -5 }, 1), { _1_1: { open: ['_2_1'], top: 0, at: 1 } });
  assert.deepEqual(P.place(undefined, '25', { open: [], top: 40, item: '271' }, 1), { 25: { open: [], top: 40, item: '271', at: 1 } });
  assert.equal(P.place(undefined, '25', { open: [], top: 0, item: '1"><b>' }, 1)['25'].item, undefined);
});
