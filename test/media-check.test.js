const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../scripts/media-check.js'), 'utf8');
const line = source.split('\n').find((s) => s.includes("check('  shown again, it plays on'"));

test('the media browser check accepts a resumed video whose clock wrapped around its loop', () => {
  const run = new Function('shown', 'hidden', 'check', line);
  let passed;
  const check = (name, ok) => { passed = ok; };
  run({ paused: false, t: 0.2 }, { t: 0.9 }, check);
  assert.equal(passed, true);
  run({ paused: true, t: 0.2 }, { t: 0.9 }, check);
  assert.equal(passed, false);
  run({ paused: false, t: 0.9 }, { t: 0.9 }, check);
  assert.equal(passed, false);
});
