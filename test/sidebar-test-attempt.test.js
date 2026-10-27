// Ultra's older (Angular) test attempt keeps its own Details & Information column beside the questions; with Glaze's
// sidebar a second column stood beside it and squeezed the questions (the 2026-10-27 audit: about 409px at 1280). Its
// read-only details column becomes the sidebar, as the assignment attempt's does; the questions, their answers and the
// Save / Submit footer stay Ultra's, where they are. The nesting is the live page's (test/fixtures/ultra-test-attempt.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { page, record, natives, unmoved } = require('./sidebar-ultra-page.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const testAttempt = (width = 1800) => {
  const p = page({ at: 'stream', width, stored: record({ dock: [{ id: 'notes' }], dest: { notes: 'dock' } }) });
  p.c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/attempt/_8_1';
  const el = p.el;
  const radio = el('input', 'PrivateSwitchBase-input'); radio.setAttribute('type', 'radio');
  const questions = el('div', 'panel-content-full panel-content-separator', el('div', 'assessment-progress-header', '2 of 2 questions remaining'),
    el('bb-attempt-canvas', '', el('div', 'attempt-authoring-container', el('ol', 'question-list attempt-question-list',
      el('li', '', el('bb-assessment-question', '', el('div', 'assessment-question js-question-type-eitherOr', el('form', '', el('label', 'MuiFormControlLabel-root', radio, 'True')))))))));
  const details = el('div', 'panel-content-info assessment-summary', el('div', 'row collapse', el('div', 'small-10 columns', el('h2', '', 'Details & Information'))),
    el('ul', 'row assessment-features', el('li', '', 'Assessment due date: No due date'), el('li', '', 'Attempts: Unlimited')), el('div', 'row', 'Maximum points 20'));
  const flex = el('div', 'panel-content-flex panel-content-inner assessment-overview-panel', questions, details);
  const exit = el('button', '', 'Exit'); exit.setAttribute('type', 'button');
  const section = el('section', 'panel-content has-slide-up-section js-skip-link-target',
    el('bb-panel-header', '', el('div', 'panel-header persistent-white-header panel-header-directive', el('h1', 'panel-title secondary-title student', 'Practice Quiz'))), flex);
  const panel = el('div', 'panel-wrap panel-wrap-flex has-bb-panel-header assessment-attempt-panel has-footer scroll-footer',
    el('header', 'black-panel-header', el('div', 'black-header-contents', el('panel-header-exit-button', '', exit), el('h1', 'panel-title', 'Test'))), section);
  const save = el('button', 'button button--secondary js-save-draft-button assessment-save-draft-button', 'Save and Close');
  const submit = el('button', 'button js-send-draft-button assessment-send-draft-button', 'Submit');
  const footer = el('footer', 'submit-footer panel-footer panel-footer-fixed', el('div', 'submit-footer-inner-container', el('div', 'autosave-footer-right', save, submit)));
  const shell = el('div', 'tests test-attempt assessment-attempt', panel, el('bb-assessment-attempt-footer', '', footer));
  p.$('#main-content-inner').append(el('section', 'routed-page route-view-container bb-offcanvas-container', el('div', 'routed-page-body', el('bb-assessment-attempt', '', shell))));
  return { p, details, questions, flex, panel, shell, footer, save, submit, radio };
};

test("the older test attempt's Details & Information is the sidebar; the questions and Save / Submit stay Ultra's", async () => {
  const { p, details, questions, radio, footer, save, submit } = testAttempt(), before = natives(p);
  let submissions = 0;
  submit.addEventListener('click', () => submissions++);
  await p.pass();
  assert.ok(p.host() === details, 'the read-only details column owns the sidebar');
  assert.equal(details.getAttribute('data-gz-sidebar-host'), 'native');
  assert.equal(p.doc.root.dataset.gzSbAssessment, 'test');
  assert.equal(p.mode(), 'expanded');
  assert.equal(p.$('#gz-sidebar'), null, 'no second column of Glaze\'s own');
  assert.ok(details.contains(p.$('#gz-sb-widgets')));
  assert.ok(!details.contains(radio) && questions.contains(radio));
  assert.ok(footer.contains(save) && footer.contains(submit));
  assert.equal(submissions, 0, 'rendering never submits');
  await p.pass();
  assert.ok(p.host() === details, 'Glaze\'s own parts in it do not make the next pass reject it');
  unmoved(p, before, 'test sidebar');
  p.side.sync(false);
  assert.equal(details.hasAttribute('data-gz-sidebar-host'), false);
  assert.equal(details.querySelector('.gz-sb-head'), null);
  assert.equal(p.doc.root.dataset.gzSbAssessment, undefined);
  unmoved(p, before, 'test sidebar off');
});

test('the older test attempt is recognized only with its whole read-only structure', async () => {
  for (const [what, change] of [
    ['another route', ({ p }) => { p.c.location.pathname = '/ultra/courses/_101_1/assessment/_7_1/overview'; }],
    ['no footer', ({ footer }) => { footer.remove(); }],
    ['a third column', ({ flex, p }) => { flex.append(p.el('div', 'unknown', 'Unknown native column')); }],
    ['questions missing', ({ questions }) => { questions.className = 'panel-content-main'; }],
    ['a control in the details', ({ details, p }) => { const b = p.el('button', '', 'Edit'); b.setAttribute('type', 'button'); details.append(b); }],
    ['an editable field in the details', ({ details, p }) => { details.append(p.el('textarea', '', 'Notes')); }],
    ['hidden details', ({ details }) => { details.hidden = true; }],
    ['no heading', ({ details }) => { details.querySelector('h2').remove(); }],
    ['two attempts', ({ p }) => { p.$('#main-content-inner').append(p.el('div', 'panel-wrap assessment-attempt-panel', 'Another')); }],
    ['absorption off', ({ p }) => { p.c.sidebarSettings = { absorb: false }; }],
  ]) {
    const fixture = testAttempt();
    change(fixture);
    await fixture.p.pass();
    assert.ok(fixture.p.host() !== fixture.details, `${what}: the details stay Ultra's`);
    assert.equal(fixture.details.hasAttribute('data-gz-sidebar-host'), false, what);
  }
});

test("the test's Save / Submit footer lifts the drawer's opener, though Ultra places it absolutely", async () => {
  const { p, footer } = testAttempt(1024);
  const boxOf = p.doc.boxOf;
  p.doc.boxOf = (e) => e.id === 'gz-sb-launch' ? { left: 932, top: 818, width: 80, height: 34 } : boxOf(e);
  footer.box = { left: 0, top: 790, width: 1024, height: 78 };
  await p.pass();
  assert.equal(p.mode(), 'drawer');
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-bar'), '110px', 'the footer\'s top, from the window\'s bottom');
  // The copy Ultra keeps in the content, with no box, is no bar.
  footer.className = 'submit-footer panel-footer panel-footer-in-content';
  await p.resize(1024);
  assert.equal(p.doc.root.style.getPropertyValue('--gz-sb-bar'), '');
});

test("sidebar.css lays the test's questions and its details column out as the attempt's", () => {
  const css = read('features/sidebar.css');
  const grid = css.match(/html\[data-gz-sb-assessment="test"\]\[data-gz-sidebar\][^{]*\.panel-content-flex:has\(> \[data-gz-sidebar-host\]\)\s*\{([^}]*)\}/);
  assert.ok(grid, 'the details\' row is a grid while it holds the sidebar');
  assert.match(grid[1], /grid-template-columns: minmax\(0, 1fr\) var\(--gz-sidebar-w\)/);
  assert.match(css, /html\[data-gz-sb-assessment="test"\]\[data-gz-sidebar="collapsed"\][^{]*\.panel-content-flex:has\(> \[data-gz-sidebar-host\]\)\s*\{[^}]*minmax\(0, 1fr\) 3rem/);
  assert.match(css, /html\[data-gz-sb-assessment="test"\]:is\(\[data-gz-sidebar="drawer"\], \[data-gz-sidebar="none"\]\)[^{]*\.panel-content-flex:has\(> \[data-gz-sidebar-host\]\)\s*\{[^}]*minmax\(0, 1fr\) !important/);
  // Sticky in Ultra's own scroller, as the attempt's and the overview's columns.
  const sticky = css.slice(0, css.indexOf('position: sticky !important; grid-column: 2'));
  assert.match(sticky.slice(sticky.lastIndexOf('}')), /html\[data-gz-sb-native-root\]\[data-gz-sb-assessment="test"\]\[data-gz-sidebar\] #site-wrap \.assessment-attempt-panel \.panel-content-flex > \[data-gz-sidebar-host="native"\]/);
});
