const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { GZ_COURSE_VARS } = require('../../extension/content/defaults.js');

// Ultra reuses an Activity card's element: the card follows whatever slot its text column has now, or none.
test('a reused Activity card follows its text column\'s course, and drops it when the column has none', () => {
  const source = fs.readFileSync(require.resolve('../../extension/content/content-ultra.js'), 'utf8');
  const start = source.indexOf('  const paintCourses = () => {');
  const end = source.indexOf('  // The course tinting the page now', start);
  assert.ok(start >= 0 && end > start);
  const style = () => {
    const vars = {};
    return { getPropertyValue: (k) => vars[k] || '', setProperty: (k, v) => { vars[k] = v; }, removeProperty: (k) => { delete vars[k]; } };
  };
  const slotted = () => /course-color-\d+/.test(details.className);
  const card = { dataset: {}, style: style(), matches: (s) => s === '.stream-panel-activity-card',
    removeAttribute: (a) => { if (a === 'data-gz-course-slot') delete card.dataset.gzCourseSlot; },
    querySelector: () => (slotted() ? details : null) };
  const details = { className: 'element-details course-color-3', parentElement: card, style: style() };
  const document = { querySelectorAll: (s) => {
    if (s.includes('stream-panel-activity-card')) return [card];
    return s.includes('course-color-') && slotted() ? [details] : [];
  } };
  const ctx = vm.createContext({ document, sessionStorage: { getItem: () => null }, location: { pathname: '/ultra/stream' },
    I: { settings: {}, setAttr() {} }, GZ_TABS_AUTO: () => 'above', tabFrame: false, tabsOn: () => false, isPreview: false,
    courseColors: () => ({ course: { own: false, picked: false, color: '#c473d4' } }), courseOf: () => 'course', GZ_COURSE_VARS });
  const paint = vm.runInContext(`${source.slice(start, end)}\npaintCourses`, ctx);
  paint();
  assert.equal(card.dataset.gzCourseSlot, '3');
  assert.equal(card.style.getPropertyValue('--gz-course-raw'), '#c473d4');
  details.className = 'element-details course-color-10';
  paint();
  assert.equal(card.dataset.gzCourseSlot, '10', 'a changed slot replaces the old one');
  details.className = 'element-details';
  paint();
  assert.equal(card.dataset.gzCourseSlot, undefined, 'the old slot is removed');
  assert.equal(card.style.getPropertyValue('--gz-course-raw'), '', 'the old color is removed');
  assert.equal(card.style.getPropertyValue('--gz-pick'), '', 'the old pick is removed');
  details.className = 'element-details course-color-3';
  paint();
  assert.equal(card.dataset.gzCourseSlot, '3', 'a course put back is painted again');
  assert.equal(card.style.getPropertyValue('--gz-course-raw'), '#c473d4');
});
