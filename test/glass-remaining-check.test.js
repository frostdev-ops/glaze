const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('glass frame check removes the base page before waiting for transparency', () => {
  const src = fs.readFileSync(path.join(process.env.EXT || path.join(__dirname, '..'), 'scripts/ctab-strip-glass-check.js'), 'utf8');
  const remove = src.indexOf("document.querySelector('#main-content')?.remove()");
  const wait = src.indexOf("await until(() => frame.evaluate(() => document.documentElement.hasAttribute('data-gz-through')");
  assert.ok(remove >= 0 && wait > remove, 'remove the base page before waiting for the course-only frame to become transparent');
});
