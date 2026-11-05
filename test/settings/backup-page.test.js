// Settings runs Back up… and Restore… itself, with no require: every module background/backup.js reaches for by its
// global has to be a script options.html loads (each resolves when first used, so order doesn't matter). Backups threw "require is not defined" once saved memories
// came in through ai/memory.js, which Settings never loaded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');

test('Settings loads every module Back up… and Restore… reach for', () => {
  const scripts = [...read('options.html').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const at = scripts.indexOf('background/backup.js');
  assert.ok(at >= 0, 'Settings loads the backup module');
  const deps = [...read('background/backup.js').matchAll(/(GZ_[A-Z_]+): \(\) => \(typeof \1 !== 'undefined' \? \1 : require\('\.\.\/([^']+)'\)\)/g)].map((m) => [m[1], m[2]]);
  assert.ok(deps.length >= 10, `found ${deps.length} lazily required modules`);
  for (const [name, file] of deps) {
    assert.ok(scripts.includes(file), `${name}: options.html loads ${file}`);
  }
});
