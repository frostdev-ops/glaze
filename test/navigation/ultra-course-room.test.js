// A course on Ultra keeps clear of Glaze's bar however Ultra nests it: theme.css pads the course section when it sits in
// .inner-wrap, and the course panel when the panel holds the section (the synthetic course test/fixtures/ultra-course.html
// builds), but never both.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the course panel keeps the bar\'s room when it holds the course section, and only then', () => {
  // The fixture's course: a panel over the page, absolute, the section inside it; no .inner-wrap around it.
  const fixture = read('test/fixtures/ultra-course.html');
  assert.match(fixture, /el\('course-content-container', `<div class="panel-wrap hide-in-background modern"><section class="course /);
  assert.match(fixture, /\.panel-wrap \{ position: absolute;/);
  assert.doesNotMatch(fixture, /inner-wrap/);
  const css = read('theme.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const wide = css.slice(css.indexOf('@media (min-width: 900px) {\n  html[data-gz-navbar~="rail"]'));
  const rule = 'html[data-gz-navbar] .course-content-container:not(.inner-wrap > section.course *) > .panel-wrap { box-sizing: border-box; padding-inline-start: var(--gz-navbar-left) !important; padding-top: var(--gz-navbar-top) !important; }';
  assert.ok(wide.includes(rule), 'the panel pads for the rail and the top bar, beside the course section\'s rule');
  assert.ok(wide.includes('html[data-gz-navbar] .inner-wrap > :is(section.course, .routed-page) { box-sizing: border-box; padding-inline-start: var(--gz-navbar-left) !important;'), 'the section\'s own rule stays');
});
