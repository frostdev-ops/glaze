const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const I = require('../lib/i18n.js');

test('kept media labels give small files a nonzero size and keep large file units', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/editor-xbg.js'), 'utf8');
  const line = source.match(/  const mb = [^\n]+/)[0];
  const format = vm.runInNewContext(`${line}\nmb`, { tr: I.t });
  assert.equal(format(460), '1 KB');
  assert.equal(format(0), '0 KB');
  assert.equal(format(1), '1 KB');
  assert.equal(format(2048), '2 KB');
  assert.equal(format(1048576), '1 MB');
  assert.equal(format(1.5 * 1048576), '1.5 MB');
});
