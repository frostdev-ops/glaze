// The release scripts keep the store and Apple credentials away from the steps that run third-party code (npm and npx
// packages' install scripts, the website's build).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('the store keys are left out of a third-party step\'s environment, and nothing else is', async () => {
  const { STORE_KEYS, withoutStoreKeys } = await import('../scripts/public-release.mjs');
  const keys = read('scripts/store-release.env.example').split('\n').map((l) => l.match(/^([A-Z_]+)=/)?.[1]).filter(Boolean);
  for (const k of ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET', 'CWS_SERVICE_ACCOUNT', 'ASC_KEY_PATH', 'ASC_KEY_ID', 'ASC_ISSUER_ID']) assert.ok(keys.includes(k) && STORE_KEYS.includes(k), k);
  const env = { PATH: '/usr/bin', HOME: '/home/me', FROSTDEV_SITE_DIR: '/site', AMO_JWT_SECRET: 's', WEB_EXT_API_SECRET: 's', ASC_KEY_PATH: '/k.p8' };
  assert.deepEqual(withoutStoreKeys(env), { PATH: '/usr/bin', HOME: '/home/me', FROSTDEV_SITE_DIR: '/site' });
});

test('every npm, npx and website step gets the environment without the store keys', () => {
  for (const f of ['scripts/store-release.mjs', 'scripts/public-release.mjs']) {
    for (const [call] of read(f).matchAll(/await run\('(?:npm|npx)'[^\n]*|await run\('node', [^\n]*, site, [^\n]*/g)) {
      assert.match(call, /, (?:bare|withoutStoreKeys\(env\)),/, `${f}: ${call.slice(0, 90)}`);
    }
  }
});
