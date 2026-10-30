// theme.css paints any Ultra "*-header" block (and the guidance bars) in the page ground, for the header bars Ultra draws
// white on the page. The same names turn up inside surfaces Glaze paints a step up from the ground: the page header's
// tools slot (behind Glaze's toolbar on Courses, the settings button on Activity), each Announcements row, a Grades
// card's title band, the calendar's bars. Painted ground there they showed as dark patches (WP-F1, the owner's
// screenshots). Here the cascade picks each element's background from theme.css's rules, as the browser would: the
// elements and their ancestors are the ones read on the owner's pages.
const test = require('node:test');
const assert = require('node:assert/strict');

const { matches, specificity, chain, cssRules, winner } = require('./helpers/css-cascade.cjs');

const theme = cssRules('theme.css');
// The background the cascade gives `el` from theme.css: [the winning declaration's value, its rule's selector].
const background = (el) => winner(theme, el, 'background(?:-color)?');
const GROUND = /var\(--gz-ground\)|--gz-surface-2\)?\s*$/;

const PAGE = ['html', 'body', 'div#site-wrap', 'main#main-content', 'div#main-content-inner'];

test('the matcher reads selectors the way the cascade does', () => {
  const e = chain(...PAGE, 'section.route-view-container', 'div.base-header', 'div.base-header-tools-transclude');
  assert.ok(matches(e, '#site-wrap div:is([class*="-header"], [class*="header-"]):not(.base-header, .base-header-tools)'));
  assert.ok(!matches(e, '#site-wrap div:is([class*="-header"]):not(.base-header-tools-transclude)'));
  assert.ok(matches(e, '#site-wrap .base-header > div'));
  assert.ok(!matches(e, '#site-wrap > div'));
  assert.ok(!matches(e, '#site-wrap div:hover'));
  assert.ok(matches(e, 'section div[class^="base-header-tools"]'));
  assert.ok(specificity('#site-wrap div:is([class*="-header"], [class*="header-"]):not(.base-header, .base-header-tools)') === 1e6 + 2e3 + 1);
});

test('header-named blocks inside a surface take that surface; they are not ground patches on it', () => {
  const cases = {
    // Courses: the header's tools slot, Glaze's toolbar inside it (one order or the other).
    'Courses: the header tools slot behind Glaze\'s toolbar': chain(...PAGE, 'section.base-courses-container.route-view-container', 'div.base-courses-header-container.base-header', 'div.base-header-tools-transclude'),
    'Courses: the slot, inside the tools': chain(...PAGE, 'section.base-courses-container.route-view-container', 'div.base-courses-header-container.base-header', 'div.base-header-tools', 'div.base-header-tools-transclude'),
    // Activity: the settings button's slot.
    'Activity: the settings button\'s slot': chain(...PAGE, 'section.js-base-stream-container.route-view-container', 'div.base-header', 'div.base-header-tools-transclude'),
    // The Institution page's header slot, where the Dashboard's tabs go.
    'Institution page: the tabs\' slot': chain(...PAGE, 'section.institution-page-container.route-view-container', 'div.black-panel-header.base-header', 'div.base-header-tools-transclude'),
    // Announcements: each row's title, description and icon block, in the list's table.
    'Announcements: a row\'s block': chain(...PAGE, 'div.course-content-container', 'div.panel-wrap', 'div.tabular-list', 'table', 'tbody', 'tr.announcement-item-row', 'td.announcement-header-column', 'div.announcement-header'),
    // Grades: a course card's title band.
    'Grades: a card\'s title band': chain(...PAGE, 'section.route-view-container', 'div.grades-list', 'div.base-grades-course-tile', 'div.row.grades-header'),
    // Calendar: its header slot, the guidance bar and the day view's date bar, on the calendar's surface.
    'Calendar: the header tools slot': chain(...PAGE, 'section.page-base-calendar.route-view-container', 'div.base-header', 'div.base-header-tools-transclude'),
    'Calendar: the guidance bar': chain(...PAGE, 'section.page-base-calendar.route-view-container', 'div.calendar-wrapper', 'div.calendar-head.guidance-wrapper'),
    'Calendar: the day view\'s date bar': chain(...PAGE, 'section.page-base-calendar.route-view-container', 'div.calendar-wrapper', 'div.day-view-header'),
  };
  const wrong = Object.entries(cases).map(([name, el]) => [name, ...(background(el) || ['(none)', ''])]).filter(([, value]) => value !== 'transparent');
  assert.deepEqual(wrong.map(([name, value, sel]) => `${name}: ${value} from ${sel}`), []);
});

test('the bars the ground rule is for keep the ground, and the surfaces around them stay surfaces', () => {
  // A header bar straight on the page (no surface around it) is still ground.
  for (const el of [chain(...PAGE, 'section.route-view-container', 'div.discussion-list-header'), chain(...PAGE, 'div.panel-wrap', 'div.messages-header'),
    chain(...PAGE, 'section.route-view-container', 'div.guidance-wrapper')]) {
    const [value, sel] = background(el);
    assert.match(value, GROUND, `${el.cls.join('.')}: ground (${value} from ${sel})`);
  }
  // The header card, the list and the icon tile in a row are surfaces, as before.
  const surface = /var\(--gz-surface-(paint|fill)/;
  assert.match(background(chain(...PAGE, 'section.route-view-container', 'div.base-courses-header-container.base-header'))[0], surface);
  assert.match(background(chain(...PAGE, 'div.panel-wrap', 'div.tabular-list'))[0], surface);
  assert.match(background(chain(...PAGE, 'div.tabular-list', 'table', 'tbody', 'tr', 'td', 'div.announcement-header', 'div.announcement-icon', 'div.element-image'))[0], surface);
  // A header card inside another surface keeps its own card paint.
  assert.match(background(chain(...PAGE, 'div.element-card', 'div.course-groups-header'))[0], surface);
});
