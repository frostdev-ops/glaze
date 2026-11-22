// --submit picks the stores a release uploads to, out of the ones it builds (--stores): a Safari-only release builds
// Chrome's and Firefox's packages for GitHub and the website, and submits Apple alone.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../../tools/release/store-release.mjs');

test('a release submits every store it builds unless --submit names fewer', async () => {
  const { options } = await load();
  assert.deepEqual(options(['release']).submit, ['chrome', 'firefox', 'apple']);
  assert.deepEqual(options(['build', '--stores', 'apple']).submit, ['apple']);
  const safari = options(['release', '--submit', 'apple']);
  assert.deepEqual([safari.stores, safari.submit], [['chrome', 'firefox', 'apple'], ['apple']]);
  assert.deepEqual(options(['submit', '--submit', 'apple,apple']).submit, ['apple']);
});

test('--submit names only stores the release builds', async () => {
  const { options } = await load();
  assert.throws(() => options(['release', '--stores', 'apple', '--submit', 'chrome']), /Each --submit store must be one --stores builds/);
  assert.throws(() => options(['release', '--submit', 'edge']), /Each --submit store must be one --stores builds/);
  assert.throws(() => options(['release', '--submit']), /--submit is required/);
});
