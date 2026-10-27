// Blackboard Ultra's legacy (Angular) test attempt and the item and tool pages around it, under theme.css. A live audit
// (2026-10-27) found the page drawn as loose pieces on the wallpaper: a bare title, bare section headings, no question
// card, answer rows whose control and letter sat on the scene while a square slab filled the text, a see-through sticky
// progress bar, an unthemed editor, and the editor's color swatches recolored by the theme. The elements and their
// ancestors here are the ones in test/fixtures/ultra-test-attempt.html, which copies the live captures' nesting; the
// cascade (test/helpers/css-cascade.cjs) picks each property from theme.css's rules as the browser would.
const test = require('node:test');
const assert = require('node:assert/strict');
const { chain, cssRules, winner } = require('./helpers/css-cascade.cjs');

const theme = cssRules('theme.css');
const bg = (el) => winner(theme, el, 'background(?:-color)?') || ['(none)', ''];
const radius = (el) => winner(theme, el, 'border-radius') || ['(none)', ''];
const SURFACE = /var\(--gz-surface-(paint|fill)/;
const with_ = (el, attrs) => Object.assign(el, { attrs });

const ROUTED = ['html', 'body', 'div#site-wrap.off-canvas-wrap', 'div.inner-wrap', 'section.routed-page.route-view-container.bb-offcanvas-container', 'div.routed-page-body.js-skip-link-target'];
const PANEL = [...ROUTED, 'bb-assessment-attempt', 'div.tests.test-attempt.assessment-attempt',
  'div.panel-wrap.panel-wrap-flex.has-bb-panel-header.assessment-attempt-panel.has-footer.without-last-saved-margin.scroll-footer'];
const SECTION = [...PANEL, 'section.panel-content.has-slide-up-section.js-skip-link-target'];
const FLEX = [...SECTION, 'div.panel-content-flex.panel-content-inner.assessment-overview-panel'];
const FULL = [...FLEX, 'div.panel-content-full.panel-content-separator'];
const CANVAS = [...FULL, 'bb-attempt-canvas', 'div.attempt-authoring-container'];
const QUESTION = (type) => [...CANVAS, 'div', 'section', 'ol.question-list.attempt-question-list', 'li', 'bb-assessment-question', `div.assessment-question.js-question-type-${type}`];
const READ_ONLY = ['div.bb-editor-root.bb-editor-heading-h4', 'div.editor-content-container.keyboard-tooltip-container.no-toolbar', 'div.bb-editor-container.ql-container.ql-disabled.is-read-only', 'div.ql-editor.bb-editor'];
const LABEL = (type, cls) => [...QUESTION(type), 'form', 'div.question-content', 'bb-question-attempt', 'div.MuiFormControl-root', 'div.MuiFormGroup-root',
  `label.MuiFormControlLabel-root.MuiFormControlLabel-labelPlacementEnd.makeStylesanswerOption-0-2-151.${cls}`];
const HEADER = ['bb-panel-header', 'div.panel-header.persistent-white-header.mode-.panel-header-directive'];
const ITEM = [...ROUTED, 'div.table-of-contents-disabled', 'div.panel-content-body', 'div.root-learning-module-panel', 'div.content-item-container', 'div.content-header-large', 'content-header'];
const EDITOR = [...CANVAS, 'div.freeform-response', 'ng-form', 'bb-freeform-response-editor', 'div.freeform-response-editor-template', 'div.freeform-response-editor.freeform-response-editor-row.js-bbml-editor',
  'form.freeform-response-form', 'bb-rich-text-editor.bb-text-editor-controls-wrapper.rich-text-editor', 'div.bb-editor-root.bb-editor-heading-h4'];
const SWATCH = (c) => [...EDITOR, 'div', 'div.bb-editor-toolbar.no-select', 'div.bb-editor-toolbar-button-container.bb-editor-toolbar-dropdown-container', 'ul.bb-editor-toolbar.bb-editor-toolbar-submenu', 'li',
  'div.bb-editor-toolbar-button-container', `button.bb-editor-toolbar-button.color-${c}-normal`, 'span', `span.icon.color-${c}-normal-icon.color-picker`, `div.MuiListItemIcon-root.picker-color.color-${c}`];

const surfaced = (cases) => Object.entries(cases).map(([name, el]) => [name, ...bg(el)]).filter(([, v]) => !SURFACE.test(v)).map(([n, v, s]) => `${n}: ${v} from ${s}`);
const clear = (cases) => Object.entries(cases).map(([name, el]) => [name, ...bg(el)]).filter(([, v]) => v !== 'transparent').map(([n, v, s]) => `${n}: ${v} from ${s}`);

test('title bands: the test, journal and file titles sit on one painted, rounded band', () => {
  const bands = { test: chain(...SECTION, ...HEADER), journal: chain(...ITEM, ...HEADER) };
  assert.deepEqual(surfaced(bands), []);
  for (const [name, el] of Object.entries(bands)) assert.equal(radius(el)[0], 'var(--gz-radius)', `${name} band radius`);
  // Its pieces paint nothing of their own over the band.
  const inner = ['div.panel-titles-container', 'div.panel-title-texteditor', 'div.editable-title-container', 'h1.panel-title.secondary-title.student'];
  assert.deepEqual(clear(Object.fromEntries(inner.map((c, i) => [c, chain(...SECTION, ...HEADER, ...inner.slice(0, i + 1))]))), []);
});

test('section headings are pills', () => {
  const pills = {
    'Test Content': chain(...CANVAS, 'div', 'div.attempt-header.assessment-header.uneditable', 'h2'),
    'Question N': chain(...QUESTION('eitherOr'), 'form', 'div.question-header.has-question-title.is-read-only', 'h3.question-label'),
    'Additional content': chain(...CANVAS, 'div.freeform-response', 'span.additional-content-label'),
    'Details & Information': chain(...FLEX, 'div.panel-content-info.assessment-summary', 'div.row.collapse', 'div.small-10.columns', 'h2'),
    'Submission (assignment attempt)': chain(...ROUTED, 'bb-assignment-attempt-authoring-panel.react-container', 'div.makeStylescontainer-0-2-24', 'div.makeStylesauthoring-0-2-26', 'div.makeStylessubmission-0-2-28', 'h2.MuiTypography-root.MuiTypography-h2'),
  };
  assert.deepEqual(surfaced(pills), []);
  const square = Object.entries(pills).map(([n, el]) => [n, radius(el)[0]]).filter(([, r]) => r !== '999px');
  assert.deepEqual(square, []);
});

test('each question is one card; nothing inside it paints a square slab', () => {
  for (const type of ['presentation', 'eitherOr', 'multipleanswer']) {
    const card = chain(...QUESTION(type));
    assert.match(bg(card)[0], SURFACE, `${type} card`);
    assert.match(radius(card)[0], /--gz-radius/, `${type} card radius`);
  }
  const prompt = [...QUESTION('eitherOr'), 'form', 'div.question-content', 'bb-question-attempt', 'div.MuiFormControl-root', 'div.js-true-false-group-label', 'div.bb-editor-wrapper.read-only'];
  const answer = [...LABEL('multipleanswer', 'js-multiple-answer-option'), 'span.MuiTypography-root.MuiFormControlLabel-label', 'div.makeStylesanswerOptionText-0-2-163'];
  // The instructions block has no .bb-editor-wrapper: its editor sits straight in .question-container.
  const intro = [...QUESTION('presentation'), 'form', 'div.question-content', 'div.question-container', 'bb-rich-text-editor.rich-text-editor'];
  const layers = (base, tag = '') => Object.fromEntries(READ_ONLY.map((c, i) => [`${tag}${c}`, chain(...base, ...READ_ONLY.slice(0, i + 1))]));
  assert.deepEqual(clear({ ...layers(prompt), ...layers(answer, 'answer '), ...layers(intro, 'instructions ') }), []);
});

test('answer rows: the whole row, control and letter included, is one rounded painted row', () => {
  for (const [type, cls] of [['eitherOr', 'js-true-false-answer-true'], ['multipleanswer', 'js-multiple-answer-option']]) {
    const row = chain(...LABEL(type, cls));
    assert.match(bg(row)[0], SURFACE, `${cls} row`);
    assert.match(radius(row)[0], /--gz-radius/, `${cls} radius`);
    assert.equal(bg(chain(...LABEL(type, cls), 'span.MuiTypography-root.MuiFormControlLabel-label'))[0], 'transparent', `${cls} label text`);
  }
});

test('the sticky progress header and the narrow bar have surfaces, and nothing inside paints a patch', () => {
  assert.match(bg(chain(...FULL, 'div.assessment-progress-header'))[0], SURFACE);
  assert.match(bg(chain(...PANEL, 'header.black-panel-header'))[0], SURFACE);
  assert.deepEqual(clear({ 'progress row': chain(...FULL, 'div.assessment-progress-header', 'div.assessment-progress-header-first-row'),
    'bar contents': chain(...PANEL, 'header.black-panel-header', 'div.black-header-contents'),
    'question header': chain(...QUESTION('eitherOr'), 'form', 'div.question-header.has-question-title.is-read-only') }), []);
});

test('the Additional content editor is one rounded card', () => {
  assert.equal(radius(chain(...EDITOR))[0], 'var(--gz-radius)');
  assert.match(bg(chain(...EDITOR, 'div', 'div.bb-editor-toolbar.no-select'))[0], SURFACE);
});

test('editor color swatches keep the colour they name', () => {
  const want = { black: '#000', grey: '#666', purple: '#a234b5' };
  for (const [c, hex] of Object.entries(want)) {
    assert.equal(bg(chain(...SWATCH(c)))[0], hex, c);
    assert.equal(bg(with_(chain(...SWATCH(c)), { 'data-gz-light': '' }))[0], hex, `${c} after the sweep tags it light`);
  }
});

test('rubric title band, Grades tabs and empty states sit on surfaces', () => {
  const RUBRIC = [...ROUTED, 'div.item-panel', 'content-body', 'div.base-body', 'div.content-root', 'div.rubric-details-panel', 'div.panel-section-header'];
  assert.deepEqual(surfaced({
    'rubric header': chain(...RUBRIC),
    'Grades tabs': chain(...ROUTED, 'div.item-panel', 'bb-course-grades-student', 'div.base-grades.course-grades-instructor', 'div.grades-list', 'bb-ui-student-tabs', 'div.makeStylesstudentTabs-0-2-125', 'div.MuiTabs-root'),
    'no announcements': chain(...ROUTED, 'div.item-panel', 'div.page-announcement.course-announcement-layer', 'div.list-announcement-content', 'div.row.collapse', 'div.columns.small-12.no-result-section', 'div.row', 'div.columns.small-12.small-centered.text-center.ftue-container', 'div.no-result-message'),
    'no posts': chain(...ROUTED, 'div.item-panel', 'div.discussion-container', 'div.is-empty-page', 'div.is-empty-wrapper'),
  }), []);
  assert.deepEqual(clear({ 'rubric title': with_(chain(...RUBRIC, 'h2.panel-section-header-text'), { 'data-gz-light': '' }) }), []);
});


test('editable question editors keep their control boundary', () => {
  const root = chain(...QUESTION('essay'), 'form', 'div.question-content', 'div.bb-editor-wrapper', 'div.bb-editor-root');
  assert.match(winner(theme, root, 'border')[0], /1px solid/, 'the editor remains a bordered control inside the question card');
});
