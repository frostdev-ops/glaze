const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Moodle's front page is `/`, like Canvas's Dashboard: Canvas-only hooks keyed on that path must stay off there, or they
// load Canvas code and (cardsHere) stop the page-start due fetch Moodle's own due list relies on.
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const hook = (name) => source.match(new RegExp(`^  const ${name} = \\(\\) => [^\\n]*;$`, 'm'))[0];

test('Canvas-only hooks on `/` stay off on a Moodle site', () => {
  for (const name of ['todoHere', 'cardsHere', 'remindHere']) {
    const window = {};
    window.top = window;
    const on = (moodle) => vm.runInNewContext(`${hook(name)} ${name}()`, {
      ultra: false, moodle, links: [{}], settings: { enhance: { todo: true, cardTasks: true, remind: true } }, location: { pathname: '/' }, window,
    });
    assert.ok(on(false), `${name} runs on Canvas's Dashboard`);
    assert.ok(!on(true), `${name} stays off on Moodle's front page`);
  }
});
