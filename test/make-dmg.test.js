'use strict';
// hdiutil create can fail transiently (a busy disk image service). The release's DMG step says why and tries again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'make-dmg.sh'), 'utf8');
const code = src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('make-dmg prints hdiutil\'s error instead of hiding it', () => {
  assert.doesNotMatch(code, /hdiutil create[^\n]*-quiet/);
});

test('make-dmg tries hdiutil create again after a failure, a bounded number of times', () => {
  const create = code.indexOf('hdiutil create');
  assert.ok(create > 0);
  const loop = code.lastIndexOf('while', create);
  assert.ok(loop >= 0 && create - loop < 400, 'hdiutil create sits inside a retry loop');
  assert.match(code.slice(loop, create + 400), /-ge 3|-lt 3|attempt/);
});
