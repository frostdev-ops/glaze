// The content script's gradebook and lateness hooks, with controlled Ultra answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const P = require('../lib/page.js'), G = require('../lib/grades.js');
const source = fs.readFileSync(require.resolve('../content-ultra.js'), 'utf8');
const settle = () => new Promise(setImmediate);
const { El } = require('./stand-in-dom.js');
const row = (columnId, patch = {}) => ({
  columnId, status: 'NEEDS_GRADING', lastAttemptId: `_8${columnId.slice(1)}`,
  column: { calculationType: 'NON_CALCULATED', dueDate: '2026-10-20T12:00:00Z', contentId: '_703_1' },
  submissionStatus: { status: 'SUBMITTED' }, lastAttempt: { status: 'COMPLETED', attemptDate: '2026-10-21T12:00:00Z' }, ...patch,
});
const lateness = ({ members = [{ courseId: '_101_1', id: '_901_1', dueDateExceptionType: 'Normal' }], exceptions = [], fail = false, inline = true } = {}) => {
  const asked = [], start = source.indexOf('  const lateIn = '), end = source.indexOf('  // Per-course gradebook cache.', start);
  const lateIn = vm.runInNewContext(`${source.slice(start, end)} lateIn`, {
    GZ_PAGE: P, GZ_GRADES: G, I: { settings: { enhance: { inline } } }, myCourses: async () => members,
    api: async (path) => { asked.push(path); if (fail) throw Error('offline'); return { results: exceptions }; },
  });
  return { lateIn, asked };
};

test('due-date lateness uses expanded submitted attempts and never requests individual attempts', async () => {
  const p = lateness(), rows = [
    row('_601_1'),
    row('_602_1', { lastAttempt: { status: 'COMPLETED', attemptDate: '2026-10-19T12:00:00Z' } }),
    row('_603_1', { submissionStatus: { status: 'NOT_SUBMITTED' } }),
    row('_604_1', { submissionStatus: undefined, lastAttempt: { status: 'IN_PROGRESS', attemptDate: '2026-10-21T12:00:00Z' }, firstAttemptId: '_800_1' }),
    row('_605_1', { lastAttempt: { status: 'IN_PROGRESS', attemptDate: '2026-10-21T12:00:00Z' } }),
    row('_606_1', { lastAttempt: undefined }),
  ];
  assert.deepEqual([...await p.lateIn('_101_1', rows)], ['_601_1']);
  assert.equal(p.asked.length, 1);
  assert.match(p.asked[0], /\/memberships\/_901_1\/exceptions\?columnId=/);
  assert.doesNotMatch(p.asked[0], /\/attempts\//);
  const drafts = lateness();
  assert.equal((await drafts.lateIn('_101_1', [rows[3]])).size, 0);
  assert.equal(drafts.asked.length, 0, 'drafts do not need due-date exception reads');
});

test('due-date exceptions and unavailable exception data suppress late chips', async () => {
  for (const options of [{ exceptions: [{ columnId: '_601_1' }] }, { members: [] },
    { members: [{ courseId: '_101_1', dueDateExceptionType: 'Unlimited' }] }, { fail: true }, { inline: false }]) {
    const p = lateness(options);
    assert.equal((await p.lateIn('_101_1', [row('_601_1')])).size, 0, JSON.stringify(options));
  }
});

test('the gradebook requests expanded submission data and redraws for each changed status field or coverage', async () => {
  const start = source.indexOf('  const bookFor = '), end = source.indexOf('  // undefined until', start);
  let changed = 0, now = 100000, partial = true;
  const grade = row('_601_1'), asked = [];
  const bookFor = vm.runInNewContext(`${source.slice(start, end)} bookFor`, {
    books: new Map(), covered: (rows, complete) => Object.defineProperty(rows, 'complete', { value: complete }),
    Date: { now: () => now }, me: async () => '_900_1', GZ_PAGE: P, locale: () => 'en', onBook: () => changed++,
    api: async (path) => { asked.push(path); return { results: [structuredClone(grade)], ...(partial && { paging: { nextPage: '?offset=200' } }) }; },
  });
  bookFor('_101_1'); await settle();
  assert.equal(new URL(asked[0], 'https://school.test').searchParams.get('expand'), 'column,lastAttempt,submissionStatus');
  assert.equal(changed, 1);
  const changes = [
    () => { grade.submissionStatus.status = 'NOT_SUBMITTED'; },
    () => { grade.lastAttempt.status = 'IN_PROGRESS'; },
    () => { grade.lastAttempt.attemptDate = '2026-10-22T12:00:00Z'; },
    () => { partial = false; },
  ];
  for (const change of changes) {
    change(); now += 60001;
    bookFor('_101_1'); await settle();
  }
  assert.equal(changed, 5);
  assert.equal(bookFor('_101_1').results.complete, true);
  now += 60001; bookFor('_101_1'); await settle();
  assert.equal(changed, 5, 'an identical expanded answer does not redraw');
});

test('course progress uses submission state while keeping native reading and external-tool completion', () => {
  const doc = {};
  doc.root = new El('main', doc);
  const grades = new Map(), draws = [];
  const add = (id, circle, grade) => {
    const item = new El('div', doc), button = new El('button', doc);
    item.className = 'content-list-item'; item.dataset.contentId = id;
    button.className = 'js-review-state-icon-button'; button.setAttribute('aria-checked', circle);
    item.append(button); doc.root.append(item);
    if (grade) grades.set(id, grade);
  };
  add('_701_1', 'true', row('_601_1', { submissionStatus: { status: 'NOT_SUBMITTED' }, lastAttempt: { status: 'IN_PROGRESS' } }));
  add('_702_1', 'true', row('_602_1'));
  add('_703_1', 'true', row('_603_1', { status: 'GRADED', submissionStatus: { status: 'GRADED' } }));
  add('_704_1', 'true', { submissionStatus: { status: 'NO_STATUS' } });
  add('_705_1', 'true'); // reading with native completion and no gradebook column
  doc.getElementById = () => null;
  doc.querySelectorAll = (s) => doc.root.querySelectorAll(s);
  const start = source.indexOf('  const renderProgress = '), end = source.indexOf('  // ---- new grades', start);
  const renderProgress = vm.runInNewContext(`${source.slice(start, end)} renderProgress`, {
    document: doc, location: { pathname: '/ultra/courses/_101_1/outline' },
    top: () => ({}), I: { settings: { enhance: { progress: true } } }, GZ_PAGE: P,
    gradesIn: () => grades, drawProgress: (old, done, total) => draws.push([done, total]),
  });
  renderProgress();
  assert.deepEqual(draws, [[4, 5]], 'a saved draft cannot complete the course; genuine submissions count');
  grades.set('_701_1', row('_601_1'));
  renderProgress();
  assert.deepEqual(draws[1], [5, 5], 'submitting the draft updates course progress');
});
