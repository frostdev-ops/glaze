// features/rubric.js on Ultra's assessment overview, against the response shapes a real graded assignment returns
// (fixtures/ultra-rubric-graded.json): the definition shows wherever Ultra's own rubric link does, and the evaluation's
// selections show only once the grade is posted, displayGraded allows it, and the evaluation is the student's own attempt's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches } = require('./stand-in-dom.js');

const root = path.join(__dirname, '..');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, `fixtures/${name}.json`), 'utf8'));
const real = () => fixture('ultra-rubric-graded'), numeric = () => fixture('ultra-rubric-numeric');
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://bb.school.test', PATH = '/ultra/courses/_101_1/assessment/_8120_1/overview';
const PATHS = { overview: PATH, discussion: '/ultra/courses/_101_1/discussion/_8120_1', attempt: '/ultra/courses/_101_1/assessment/_8120_1/attempt/create', draft: '/ultra/courses/_101_1/assessment/_8120_1/attempt/_400_1' };

class Box extends El {
  matches(sel) { return matches(this, sel); }
  getClientRects() { return [this.getBoundingClientRect()]; }
}

// The overview's Assessment Details section, 706 px wide, with the native rubric link; the school answers from data.
// kind 'discussion' and 'attempt' are the other pages with Ultra's rubric link, in the markup the real pages have: a
// discussion's Details panel (inside Glaze's sidebar) and the attempt page View instructions opens (React, no stable class);
// 'draft' is that attempt page once Ultra has saved it and numbered its address.
const page = (data, width = 706, kind = 'overview') => {
  const asked = [], listeners = [], popups = [];
  const doc = { activeElement: null, hidden: false, fire() {} };
  const make = (tag, cls = '', ...kids) => { const e = new Box(tag, doc); e.className = cls; e.append(...kids); return e; };
  doc.root = make('html');
  let link, row, box;
  if (kind === 'discussion') {
    link = make('a', 'rubric-title', 'This item is graded with a rubric');
    link.setAttribute('analytics-id', 'components.directives.discussionSettings.gradedWithRubric.li'); link.setAttribute('href', 'javascript:void(0);');
    row = make('div', 'settings-link', link);
    box = make('div', 'layer-details', make('bb-discussion-settings', '', make('div', 'full-panel-details', make('div', 'discussion-settings student-details',
      make('div', 'full-panel-details-info', make('div', 'element-card discussion-info-list', make('div', 'element-details discussion-info-details', row)))))));
    box.setAttribute('data-gz-sidebar-host', 'native');
  } else if (kind === 'attempt' || kind === 'draft') {
    link = make('a', 'MuiTypography-root MuiLink-root MuiLink-underlineAlways', 'This item is graded with a rubric');
    link.setAttribute('data-analytics-id', 'assignment.attempt.authoring.rubric.view.link'); link.setAttribute('href', ORIGIN + PATHS[kind]);
    row = make('div', 'makeStylescontentRoot-0-2-206', make('span', '', 'Grading rubric'), link);
    box = make('div', 'makeStylesdetails-0-2-92', make('div', 'makeStyleslistWrapper-0-2-204', make('div', 'makeStylesroot-0-2-205', row)));
  } else {
    link = make('a', 'graded-with-rubric-button', 'This item is graded with a rubric');
    link.setAttribute('analytics-id', 'course.content.assessment.overview.gradedWithRubric');
    row = make('li', 'details-list-item js-rubric-overview', make('div', 'details-list-info', make('span', 'grid-item-label', 'Grading rubric'), link));
    box = make('div', 'overview-section assessment-details-section main-section-container', make('h2', 'section-label', 'Assessment Details'), make('ul', 'section-content', row));
  }
  box.box = { left: 0, top: 0, width, height: 200 };
  doc.root.append(make('body', '', make('div', 'assessment-overview-grid', box)));
  const document = Object.assign(doc, {
    documentElement: doc.root, createElement: (tag) => new Box(tag, doc),
    querySelectorAll: (sel) => doc.root.querySelectorAll(sel), querySelector: (sel) => doc.root.querySelector(sel),
    addEventListener: (type, f) => listeners.push({ type, f }), removeEventListener() {},
  });
  const answer = (u) => {
    if (/\/gradebook\/grades$/.test(u.pathname)) return { results: data.grade ? [data.grade] : [] };
    if (/\/gradebook\/columns\/_300_1$/.test(u.pathname)) return data.column;
    const attemptId = /\/gradebook\/attempts\/(_\d+_\d+)$/.exec(u.pathname)?.[1];
    if (attemptId) return data.attempts?.[attemptId] ?? (data.attempt?.id === attemptId ? data.attempt : null);
    return null;
  };
  const fetch = async (url) => {
    const u = new URL(url); asked.push(u.pathname);
    const body = answer(u);
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  };
  const globals = {
    GZ_RUBRIC_LIB: undefined, GZ_LMSQ: undefined, GZ_POPUP: undefined, GZ_ULTRA: undefined,
    document, location: { origin: ORIGIN, pathname: PATHS[kind], search: kind === 'overview' ? '' : '?courseId=_101_1' }, console, Promise, Intl, URL, URLSearchParams, AbortController,
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
    'features/popup.js': () => { c.GZ_POPUP = { ready: Promise.resolve(), safe: (text) => [text], open: (o) => { popups.push(o); return { close() {}, isOpen: () => false }; } }; },
  };
  c.GZ_CTX = {
    site: 'ultra', solo: true, tabFrame: '', t: (s) => s, locale: () => 'en', on: () => true, account: async () => '_42_1',
    settings: () => ({ rubric: { show: 'auto', inline: true } }),
    need: async (file, ready) => { if (!ready()) files[file](); assert.ok(ready(), file); },
  };
  vm.runInContext(fs.readFileSync(path.join(root, 'features/rubric.js'), 'utf8'), c, { filename: 'features/rubric.js' });
  return { c, box, row, link, asked, listeners, popups };
};

const show = async (data, width, kind) => {
  const p = page(data, width, kind);
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

test('a completed ungraded attempt cannot use column release settings or displayGrade to reveal grading', async () => {
  for (const post of [(d) => { d.column.gradesReleased = true; }, (d) => { d.grade.displayGrade = {}; }, (d) => { d.grade.displayGrade = { scaleType: 'PERCENT', score: 85 }; }]) {
    const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; post(d);
    const p = await show(d);
    assert.ok(p.node, 'the definition shows, as Ultra\'s own link does');
    assert.deepEqual(p.selected, [], 'an ungraded attempt has no selections, even on a released column or with a display grade');
    assert.doesNotMatch(p.shadow.textContent, /Synthetic note\./);
  }
});

test('submitted but not graded shows the definition Ultra\'s own link opens, whatever displayAfter says, and no selections leak', async () => {
  for (const attempt of ['NEEDS_GRADING', 'COMPLETED']) {
    const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; d.attempt.status = attempt; d.grade.lastAttempt.status = attempt;
    const p = await show(d);
    assert.ok(p.node, `${attempt}: the rubric shows with displayAfter false`);
    assert.deepEqual(p.selected, [], `${attempt} without a posted grade is not graded`);
    assert.doesNotMatch(p.shadow.textContent, /Synthetic note\./);
  }
  const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; d.attempt.status = 'NEEDS_GRADING'; d.column.rubricAssociations[0].displayAfter = true;
  const p = await show(d);
  assert.ok(p.node, 'displayAfter shows the rubric');
  assert.deepEqual(p.selected, [], 'without the evaluation');
});

test('before a first attempt the rubric shows bare, with no attempt read', async () => {
  const d = real();
  for (const k of ['lastAttemptId', 'lastAttempt', 'submissionStatus']) delete d.grade[k];
  const p = await show(d);
  assert.ok(p.node);
  assert.deepEqual(p.selected, []);
  assert.ok(!p.asked.some((x) => x.includes('/gradebook/attempts/')));
  d.column.rubricAssociations[0].displayBefore = false;
  assert.ok((await show(d)).node, 'the page\'s own rubric link, not displayBefore, decides');
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

test('a graded row whose latest attempt is still being graded shows the rubric without that attempt\'s selections', async () => {
  const d = real(); d.attempt.status = 'NEEDS_GRADING'; d.grade.lastAttempt.status = 'NEEDS_GRADING';
  const p = await show(d);
  assert.ok(p.node);
  assert.deepEqual(p.selected, []);
});

// NUMERIC rubrics: a row's points (rowPoints) and each level's numericPoints; an evaluation cell's selectedPercent is the
// selected level's points, not a percentage.
const marks = (shadow) => shadow.querySelectorAll('td[aria-current="true"]').map((td) => td.textContent);
test('a graded NUMERIC rubric shows the selected levels with their points, in the pop-up when five levels do not fit', async () => {
  const p = await show(numeric());
  assert.equal(p.node, null, 'five levels need more than 706 px');
  assert.equal(p.nativeHidden, false);
  const click = p.listeners.find((l) => l.type === 'click').f;
  click({ defaultPrevented: false, button: 0, target: p.link, preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(p.popups.length, 1, 'the native link opens Glaze\'s pop-up');
  const shadow = p.popups[0].body.shadowForTest;
  assert.equal(marks(shadow).length, 2);
  assert.match(marks(shadow)[0], /One B/); assert.match(marks(shadow)[1], /Two A/);
  assert.match(shadow.textContent, /Score: 8 Points/); assert.match(shadow.textContent, /Score: 10 Points/);
  assert.match(shadow.textContent, /Total: 18 \/ 20 Points/);
  const wide = await show(numeric(), 1000);
  assert.ok(wide.node, 'inline where five levels fit');
  assert.equal(wide.selected.length, 2);
});

test('the other states real Ultra columns are in: submitted without evaluations and unopened both show the rubric bare', async () => {
  const d = real();
  Object.assign(d.column.rubricAssociations[0], { isWithEvaluations: false });
  d.grade.submissionStatus = { status: 'SUBMITTED' }; d.grade.lastAttempt.status = 'NEEDS_GRADING'; d.attempt.status = 'NEEDS_GRADING'; delete d.attempt.rubricEvaluation;
  const s = await show(d);
  assert.ok(s.node, 'submitted with displayAfter false shows the rubric, as Ultra does');
  assert.deepEqual(s.selected, []);
  // An item never opened: Ultra's row has only these keys, no userId (live, 2026-10-27: the owner's rubric links opened
  // Ultra's panel on every such item), though the query asked for the student's rows alone.
  const u = real();
  for (const k of Object.keys(u.grade)) if (!['columnId', 'courseId', 'averageScore', 'submissionStatus', 'column', 'isCorrupt', 'columnUrl'].includes(k)) delete u.grade[k];
  u.grade.submissionStatus = { status: 'UNOPENED' };
  const p = await show(u);
  assert.ok(p.node);
  assert.deepEqual(p.selected, []);
  assert.ok(!p.asked.some((x) => x.includes('/gradebook/attempts/')));
  // Another user's row is still no row of the student's.
  const o = real(); o.grade.userId = '_43_1';
  assert.equal((await show(o)).node, null);
});

test('a graded attempt whose association hides graded rubrics shows the definition without selections', async () => {
  const d = real(); d.column.rubricAssociations[0].displayGraded = false;
  const p = await show(d);
  assert.ok(p.node);
  assert.deepEqual(p.selected, []);
  assert.doesNotMatch(p.shadow.textContent, /Synthetic note\./);
});

test('the inline rubric keeps sideways scrolling to itself and lets the page scroll vertically over it', () => {
  const css = fs.readFileSync(path.join(root, 'features/rubric.js'), 'utf8').match(/const CSS = `([\s\S]*?)`;/)[1];
  const scroll = css.match(/\.scroll \{([^}]*)\}/)[1];
  assert.match(scroll, /overflow-x:auto/);
  assert.match(scroll, /overscroll-behavior-x:contain/);
  assert.doesNotMatch(scroll, /overscroll-behavior:|overscroll-behavior-y:contain|overflow:auto/, 'a wheel over the rubric reaches the page');
});

// Discussions and the attempt page (View instructions): Ultra's link there opens its own Rubric Details panel. Glaze's
// pop-up takes its place, opening from the link; these pages have no room for the table, so it never goes inline.
const press = (p) => {
  const e = { defaultPrevented: false, button: 0, target: p.link, prevented: false, stopped: false };
  e.preventDefault = () => { e.prevented = true; }; e.stopImmediatePropagation = () => { e.stopped = true; };
  p.listeners.find((l) => l.type === 'click').f(e);
  return e;
};
test('a graded discussion\'s rubric link opens Glaze\'s pop-up from the link, with the selections, never inline', async () => {
  const p = await show(real(), 1400, 'discussion');
  assert.equal(p.node, null, 'nothing goes into the Details panel, however wide');
  assert.equal(p.nativeHidden, false, 'the link stays');
  const e = press(p);
  assert.ok(e.prevented && e.stopped, 'Ultra\'s own panel does not open');
  assert.equal(p.popups.length, 1);
  assert.equal(p.popups[0].source, p.link, 'the pop-up opens from the link');
  assert.equal(marks(p.popups[0].body.shadowForTest).length, 2, 'with the graded selections');
});

test('View instructions on a submitted, ungraded attempt: the rubric link opens the pop-up with the definition only', async () => {
  const d = real(); d.grade.submissionStatus = { status: 'SUBMITTED' }; d.attempt.status = 'NEEDS_GRADING'; d.grade.lastAttempt.status = 'NEEDS_GRADING';
  const p = await show(d, 1400, 'attempt');
  assert.equal(p.node, null);
  const e = press(p);
  assert.ok(e.prevented && e.stopped);
  assert.equal(p.popups.length, 1);
  assert.equal(p.popups[0].source, p.link);
  const shadow = p.popups[0].body.shadowForTest;
  assert.deepEqual(marks(shadow), [], 'no selections before the grade is posted');
  assert.doesNotMatch(shadow.textContent, /Synthetic note\./);
});

// As a real saved draft reads (2026-10-29): the row NEEDS_GRADING, its submission DRAFT_SAVED_STUDENT, the attempt IN_PROGRESS.
test('a saved draft at its numbered attempt address: the rubric link opens the pop-up with the definition only', async () => {
  const d = real(); d.grade.status = 'NEEDS_GRADING'; d.grade.submissionStatus = { actionCount: null, status: 'DRAFT_SAVED_STUDENT' };
  d.attempt.status = 'IN_PROGRESS'; d.grade.lastAttempt.status = 'IN_PROGRESS';
  const p = await show(d, 1400, 'draft');
  const e = press(p);
  assert.ok(e.prevented && e.stopped);
  assert.equal(p.popups.length, 1);
  assert.deepEqual(marks(p.popups[0].body.shadowForTest), [], 'no selections on a draft');
});

test('a numbered attempt never borrows the latest attempt\'s selections or feedback', async () => {
  for (const status of ['IN_PROGRESS', 'COMPLETED']) {
    const d = real(), latest = structuredClone(d.attempt);
    latest.id = '_401_1'; latest.rubricEvaluation.attemptId = latest.id;
    d.grade.lastAttemptId = latest.id; d.grade.lastAttempt.id = latest.id;
    d.attempt.status = status;
    d.attempts = { [d.attempt.id]: d.attempt, [latest.id]: latest };
    const p = await show(d, 1400, 'draft');
    assert.ok(press(p).prevented, status);
    const shadow = p.popups[0].body.shadowForTest;
    assert.deepEqual(marks(shadow), [], `${status}: the latest grade row cannot release another attempt's evaluation`);
    assert.doesNotMatch(shadow.textContent, /Synthetic note\./);
    assert.ok(p.asked.some((x) => x.endsWith('/attempts/_400_1')), 'read the attempt in the address');
    assert.ok(!p.asked.some((x) => x.endsWith('/attempts/_401_1')), 'do not read a different attempt');
  }
});

test('a numbered latest attempt retains its released selections, but a foreign column or user stays native', async () => {
  const p = await show(real(), 1400, 'draft');
  assert.ok(press(p).prevented);
  assert.equal(marks(p.popups[0].body.shadowForTest).length, 2);
  for (const field of ['columnId', 'userId']) {
    const d = real(); d.attempt[field] = '_999_1';
    const p = await show(d, 1400, 'draft');
    assert.ok(!press(p).prevented, field);
    assert.equal(p.popups.length, 0, field);
  }
});

test('until Glaze has the rubric, the discussion and attempt links still open Ultra\'s own', async () => {
  for (const kind of ['discussion', 'attempt']) {
    const d = real(); d.grade = null;
    const p = await show(d, 1400, kind);
    const e = press(p);
    assert.ok(!e.prevented && !e.stopped, kind);
    assert.equal(p.popups.length, 0, kind);
  }
});

test('routes: features/rubric.js loads on Ultra\'s overview, attempt and discussion pages, and Canvas\'s assignment page', async () => {
  const where = async (site, pathname) => {
    const loaded = [];
    const ctx = vm.createContext({ GZ_CTX: { site, need: async (f) => { loaded.push(f); ctx.GZ_RUBRIC_UI = { sync() {} }; ctx.GZ_ANNOUNCE = { sync() {} }; ctx.GZ_EDITOR_MENU = { sync() {} }; ctx.GZ_STICKY_FOLD = { sync() {} }; } }, location: { pathname, search: '' }, Set, Promise });
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync(path.join(root, 'features/routes.js'), 'utf8'), ctx);
    ctx.GZ_ROUTES.sync(); await settle();
    return loaded.includes('features/rubric.js');
  };
  for (const p of [PATHS.overview, PATHS.discussion, PATHS.attempt, PATHS.draft, '/ultra/courses/_101_1/assessment/_8120_1/attempt']) assert.equal(await where('ultra', p), true, p);
  assert.equal(await where('canvas', '/courses/101/assignments/7'), true);
  for (const p of ['/ultra/courses/_101_1/discussion/_8120_1/rubric-view', '/ultra/courses/_101_1/assessment/_8120_1/attempt/create/rubric-view',
    '/ultra/courses/_101_1/discussions', '/ultra/courses/_101_1/outline', `${PATHS.draft}/rubric-view`]) assert.equal(await where('ultra', p), false, p);
});
