const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../scripts/motion-check.js'), 'utf8');
const parse = vm.runInNewContext(`${source.slice(source.indexOf('const animations ='), source.indexOf('\n(async () =>'))}; animations`);

test('motion receipts retain every compositor failure even when a later sample recovers', () => {
  const events = [
    { name: 'Animation', ph: 'b', ts: 1, id: '1', args: { data: { displayName: 'transform' } } },
    { name: 'Animation', ph: 'n', ts: 2, id: '1', args: { data: { compositeFailed: 64, unsupportedProperties: ['transform'] } } },
    { name: 'Animation', ph: 'n', ts: 3, id: '1', args: { data: { compositeFailed: 0 } } },
  ];
  assert.equal(parse(events)[0].failed, 64);
  assert.equal(parse(events)[0].props.join(','), 'transform');
});
