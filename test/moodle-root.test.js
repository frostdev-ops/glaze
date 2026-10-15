const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Moodle's front page is `/`, like Canvas's Dashboard: Canvas-only hooks keyed on that path must stay off there, or they
// load Canvas code and (cardsHere) stop the page-start due fetch Moodle's own due list relies on. They are Canvas's part
// (content-canvas.js), which a Moodle page doesn't load: content.js's own stand-ins (X) do nothing in their place.
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const canvas = fs.readFileSync(require.resolve('../content-canvas.js'), 'utf8');
const hook = (name) => canvas.match(new RegExp(`^  const ${name} = \\(\\) => [^\\n]*;$`, 'm'))[0];

test('Canvas-only hooks on `/` stay off on a Moodle site', () => {
  for (const name of ['todoHere', 'cardsHere', 'remindHere']) {
    const window = {};
    window.top = window;
    const on = vm.runInNewContext(`${hook(name)} ${name}()`, {
      I: { links: [{}], settings: { enhance: { todo: true, cardTasks: true, remind: true } } }, location: { pathname: '/' }, window,
    });
    assert.ok(on, `${name} runs on Canvas's Dashboard`);
    assert.ok(!source.includes(`const ${name} =`), `${name} isn't in the script Moodle runs`);
  }
  // Moodle's first script, as lib/background.js registers it: Canvas's without the Canvas part.
  const m = require('../manifest.json');
  const moodleScript = m.content_scripts.find((c) => c.matches.includes('https://*.instructure.com/*')).js.filter((f) => f !== 'content-canvas.js');
  assert.ok(!moodleScript.includes('content-canvas.js') && moodleScript.at(-1) === 'content.js');
  // What stands in for Canvas's hooks on Moodle: nothing runs, and the planner check says no, so the page start asks for
  // Moodle's due list (startSweep: `if (window.top === window && !X.planner()) dueWeek()`).
  const X = vm.runInNewContext(`${source.match(/^ {2}const no = .*\n {2}const X = \{[\s\S]*?\};$/m)[0]} X`, {});
  assert.ok(!X.planner());
  for (const k of ['syncTodo', 'syncCardTasks', 'syncWidgets', 'syncRemind', 'syncSyl', 'syncInsights', 'tagExtras', 'renderNew', 'renderCalc', 'renderProgress', 'paintCourses', 'syncNav', 'paintNav']) assert.equal(X[k](), undefined, k);
  assert.match(source, /^ {4}if \(window\.top === window && !X\.planner\(\)\) dueWeek\(\);$/m);
});

// Before B0b, Moodle ran Canvas's extras too (they were content.js's `!ultra` branches), and they found nothing there:
// what they key on is Canvas's own markup. Moodle's real pages (test/fixtures, Moodle 5.3) hold none of it, so leaving
// Canvas's part off Moodle changes nothing there.
test('what Canvas\'s part keys on is nowhere on Moodle\'s pages', () => {
  const dir = require('node:path').join(__dirname, 'fixtures');
  const pages = fs.readdirSync(dir).filter((f) => /^moodle-.*\.html$/.test(f));
  assert.ok(pages.length >= 8);
  const MARKUP = ['ic-DashboardCard', 'planner-grouping', 'student_grades', 'grades_summary', 'ig-row', 'context_module', 'ToDoSidebarItem',
    'mark-as-done-checkbox', 'set-module-item-completion-button', 'planner-item-completed-checkbox', 'breadcrumbs', 'section-tabs',
    'message-detail-item', 'gz-progress', 'data-gz-course-color'];
  for (const word of MARKUP) assert.ok(canvas.includes(word), `content-canvas.js keys on ${word}`);
  for (const f of pages) {
    const html = fs.readFileSync(require('node:path').join(dir, f), 'utf8');
    for (const word of MARKUP) assert.ok(!html.includes(word), `${f}: ${word}`);
  }
});

// The shared palette has Canvas and Ultra adapters; Moodle content search stays off.
test('search in your courses is Canvas and Ultra only', () => {
  const palette = fs.readFileSync(require.resolve('../features/palette.js'), 'utf8');
  const line = palette.match(/^ {2}const searchHere = \(\) => [^\n]*;$/m)?.[0];
  assert.ok(line, 'features/palette.js has searchHere');
  assert.match(palette, /^ {4}if \(searchHere\(\)\) need\('features\/search\.js'/m, 'and the search loads only through it');
  assert.equal(palette.match(/need\('features\/search\.js'/g).length, 1);
  const on = (site) => vm.runInNewContext(`${line} searchHere()`, { ultra: site === 'ultra', moodle: site === 'moodle', ctx: { settings: () => ({ enhance: { search: true } }) } });
  assert.ok(on('canvas'));
  assert.ok(!on('moodle'));
  assert.ok(on('ultra'));
});
