// Run the real relay permission helpers with a browser that ends input handling at the first async boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
for (const file of ['sharing/quick.js', 'lib/sessions-ui.js']) test(`review: ${file} requests relay hosts in the input task`, async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = src.indexOf('  const permission = '), end = src.indexOf('\n  };', start) + 5;
  let active = true;
  const requests = [];
  const g = vm.createContext({ GZ_RELAY: require('../lib/relay.js'), chrome: { permissions: {
    contains: async () => false,
    request: (o) => { requests.push({ origins: [...o.origins], active }); return Promise.resolve(active); },
  } } });
  vm.runInContext(src.slice(start, end) + '\nglobalThis.ask = permission;', g);
  const result = g.ask(['https://relay.school.edu', 'https://relay.school.edu']);
  active = false;
  assert.equal(await result, true);
  assert.deepEqual(requests, [{ origins: ['https://relay.school.edu/*'], active: true }]);
  assert.equal(await g.ask(['https://relay.school.edu/path']), false);
  assert.equal(requests.length, 1, 'invalid origins never prompt');
});
