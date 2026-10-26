// features/rubric.js on Ultra's assessment overview, against the response shapes a real graded assignment returns
// (fixtures/ultra-rubric-graded.json): the attempt's state decides which visibility flag applies, and the evaluation's
// selections show only once the grade is posted and the evaluation belongs to the student's own attempt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches } = require('./stand-in-dom.js');

const root = path.join(__dirname, '..');
const real = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ultra-rubric-graded.json'), 'utf8'));
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://bb.school.test', PATH = '/ultra/courses/_101_1/assessment/_8120_1/overview';

class Box extends El {
  matches(sel) { return matches(this, sel); }
  getClientRects() { return [this.getBoundingClientRect()]; }
}

// The overview's Assessment Details section, 706 px wide, with the native rubric link; the school answers from data.
const page = (data) => {
  const asked = [];
  const doc = { activeElement: null, hidden: false, fire() {} };
  const make = (tag, cls = '', ...kids) => { const e = new Box(tag, doc); e.className = cls; e.append(...kids); return e; };
  doc.root = make('html');
  const link = make('a', 'graded-with-rubric-button', 'This item is graded with a rubric');
  link.setAttribute('analytics-id', 'course.content.assessment.overview.gradedWithRubric');
  const row = make('li', 'details-list-item js-rubric-overview', make('div', 'details-list-info', make('span', 'grid-item-label', 'Grading rubric'), link));
  const box = make('div', 'overview-section assessment-details-section main-section-container', make('h2', 'section-label', 'Assessment Details'), make('ul', 'section-content', row));
  box.box = { left: 0, top: 0, width: 706, height: 200 };
  doc.root.append(make('body', '', make('div', 'assessment-overview-grid', box)));
  const document = Object.assign(doc, {
    documentElement: doc.root, createElement: (tag) => new Box(tag, doc),
    querySelectorAll: (sel) => doc.root.querySelectorAll(sel), querySelector: (sel) => doc.root.querySelector(sel),
    addEventListener() {}, removeEventListener() {},
  });
  const answer = (u) => {
    if (/\/gradebook\/grades$/.test(u.pathname)) return { results: data.grade ? [data.grade] : [] };
    if (/\/gradebook\/columns\/_300_1$/.test(u.pathname)) return data.column;
    if (/\/gradebook\/attempts\/_400_1$/.test(u.pathname)) return data.attempt;
    return null;
  };
  const fetch = async (url) => {
    const u = new URL(url); asked.push(u.pathname);
    const body = answer(u);
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  };
  const globals = {
    GZ_RUBRIC_LIB: undefined, GZ_LMSQ: undefined, GZ_POPUP: undefined, GZ_ULTRA: undefined,
    document, location: { origin: ORIGIN, pathname: PATH, search: '' }, console, Promise, Intl, URL, URLSearchParams, AbortController,
    queueMicrotask, Response, Error, Object, Array, Map, Set, String, Number, JSON, Math, RegExp,
    getComputedStyle: () => ({ paddingLeft: '0px', paddingRight: '0px', fontSize: '16px' }),
    ResizeObserver: class { observe() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {},
    chrome: { storage: { onChanged: { addListener() {}, removeListener() {} } } },
  };
  const c = vm.createContext(globals);
  c.globalThis = c;
  const files = {
    'lib/rubric.js': () => { c.GZ_RUBRIC_LIB = require('../lib/rubric.js'); },
    'lib/ultra.js': () => { c.GZ_ULTRA = require('../lib/ultra.js'); },
    'lib/lmsq.js': () => { c.GZ_LMSQ = { fetch: (url) => fetch(url) }; },
    'features/popup.js': () => { c.GZ_POPUP = { ready: Promise.resolve(), safe: (text) => [text], open: () => ({ close() {}, isOpen: () => false }) }; },
  };
  c.GZ_CTX = {
    site: 'ultra', solo: true, tabFrame: '', t: (s) => s, locale: () => 'en', on: () => true, account: async () => '_42_1',
    settings: () => ({ rubric: { show: 'auto', inline: true } }),
    need: async (file, ready) => { if (!ready()) files[file](); assert.ok(ready(), file); },
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'features/rubric.js'), 'utf8'), c, { filename: 'features/rubric.js' });
  return { c, box, row, link, asked };
};

const show = async (data) => {
  const p = page(data);
  await p.c.GZ_RUBRIC_UI.ready;
  p.c.GZ_RUBRIC_UI.sync();
  await settle();
  const node = p.box.querySelector('#gz-rubric');
  const shadow = node?.shadowForTest;
  return { ...p, node, shadow,
    selected: shadow ? shadow.querySelectorAll('td[aria-current="true"]').map((td) => td.textContent) : [],
    nativeHidden: p.row.hasAttribute('data-gz-rubric-hidden') || !!p.row.closest('[data-gz-rubric-hidden]') };
};

test('a graded attempt shows its rubric inline with the selections, whatever the evaluation\'s published flag', async () => {
  const p = await show(real());
  assert.ok(p.node, 'the rubric renders inline in a 706 px section with three levels');
  assert.ok(p.nativeHidden, 'the native link gives way to it');
  assert.equal(p.selected.length, 2, 'both criteria show their selected level');
  assert.match(p.selected[0], /One A/); assert.match(p.selected[1], /Two B/);
  assert.match(p.shadow.textContent, /Synthetic note\./, 'with the criterion feedback');
});

test('a posted grade on a completed attempt is graded too: displayGrade or the column\'s released grades', async () => {
  for (const post of [(d) => { d.grade.displayGrade = { scaleType: 'PERCENT', score: 85 }; }, (d) => { d.column.gradesReleased = true; }]) {
    const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; post(d);
    const p = await show(d);
    assert.equal(p.selected.length, 2);
  }
});

test('submitted but not graded follows displayAfter: false keeps the native link, and no selections leak', async () => {
  for (const attempt of ['NEEDS_GRADING', 'COMPLETED']) {
    const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; d.attempt.status = attempt; d.grade.lastAttempt.status = attempt;
    const p = await show(d);
    assert.equal(p.node, null, `${attempt} without a posted grade is not graded`);
    assert.equal(p.nativeHidden, false);
  }
  const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; d.attempt.status = 'NEEDS_GRADING'; d.column.rubricAssociations[0].displayAfter = true;
  const p = await show(d);
  assert.ok(p.node, 'displayAfter shows the rubric');
  assert.deepEqual(p.selected, [], 'without the evaluation');
});

test('before a first attempt the rubric follows displayBefore, with no attempt read', async () => {
  const d = real();
  for (const k of ['lastAttemptId', 'lastAttempt', 'submissionStatus']) delete d.grade[k];
  const p = await show(d);
  assert.ok(p.node);
  assert.deepEqual(p.selected, []);
  assert.ok(!p.asked.some((x) => x.includes('/gradebook/attempts/')));
  d.column.rubricAssociations[0].displayBefore = false;
  assert.equal((await show(d)).node, null);
});

test('an evaluation naming another user shows the graded rubric without its selections', async () => {
  const d = real(); d.attempt.rubricEvaluation.userId = '_43_1';
  const p = await show(d);
  assert.ok(p.node);
  assert.deepEqual(p.selected, []);
  assert.doesNotMatch(p.shadow.textContent, /Synthetic note\./);
});

test('a graded attempt with no matching evaluation shows the rubric without selections', async () => {
  for (const strip of [(e) => { delete e.attempt.rubricEvaluation; }, (e) => { e.attempt.rubricEvaluation.attemptId = '_401_1'; }, (e) => { e.attempt.rubricEvaluation.rubricAssociationId = '_501_1'; }]) {
    const d = real(); strip(d);
    const p = await show(d);
    assert.ok(p.node);
    assert.deepEqual(p.selected, []);
  }
});

test('an attempt of another user is never read as the student\'s', async () => {
  const d = real(); d.attempt.userId = '_43_1';
  assert.equal((await show(d)).node, null);
});
