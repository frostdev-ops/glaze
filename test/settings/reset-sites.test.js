const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');

// Reset everything also forgets the schools said yes to (background/background.js answers { ok }); when the worker can't,
// Settings says so instead of leaving its "reset" hint standing over schools that are still allowed.
test('Reset everything says so when the schools said yes to could not be forgotten', () => {
  const src = fs.readFileSync(require.resolve('../../extension/settings/options.js'), 'utf8');
  const call = src.match(/chrome\.runtime\.sendMessage\(\{ type: 'glaze:sites', op: 'reset' \}\)[^;]*;/)?.[0];
  assert.ok(call, 'the reset asks the worker');
  assert.match(call, /\.then\(\(r\) => \{ if \(!r\?\.ok\) hint\(t\("Couldn't reset your school sites\. Try again in a moment\."\), true\)/);
  assert.match(call, /\.catch\(\(\) => hint\(/);
});
