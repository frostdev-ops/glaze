const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

// Reset everything also forgets the schools said yes to (background/background.js answers { ok }); when the worker can't,
// Settings says so instead of leaving its "reset" hint standing over schools that are still allowed.
test('Reset everything says so when the schools said yes to could not be forgotten', () => {
  const src = fs.readFileSync(require.resolve('../../extension/settings/options.js'), 'utf8');
  const at = src.indexOf("{ type: 'glaze:sites', op: 'reset' }");
  assert.ok(at > 0, 'the reset asks the worker');
  const around = src.slice(src.lastIndexOf('\n', src.lastIndexOf('\n', at) - 1), src.indexOf('\n', at));
  assert.match(around, /"Couldn't reset your school sites\. Try again in a moment\."/, 'a message of its own');
  assert.match(around, /!r\?\.ok/, 'a refused reset is said');
  assert.doesNotMatch(around, /\.catch\(\(\) => \{\}\)/, 'an unanswered one is too');
});
