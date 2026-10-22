// The release scripts keep credentials away from the steps that run third-party code (npm and npx packages and their
// install scripts, the website's build): those steps get a short allowlist of variables and a temporary HOME.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// Everything a release Mac could plausibly carry that a package must not see, including names no denylist knew about.
const SECRETS = {
  SSH_AUTH_SOCK: '/tmp/ssh-agent.sock', GH_TOKEN: 'gh', GITHUB_TOKEN: 'gh', NPM_TOKEN: 'npm', npm_config__authToken: 'npm',
  GOOGLE_APPLICATION_CREDENTIALS: '/k.json', CLOUDSDK_CORE_PROJECT: 'p', AWS_SECRET_ACCESS_KEY: 's', NOTARY_PROFILE: 'p',
  AMO_JWT_ISSUER: 'i', AMO_JWT_SECRET: 's', WEB_EXT_API_KEY: 'k', WEB_EXT_API_SECRET: 's', CWS_SERVICE_ACCOUNT: 'a',
  ASC_KEY_PATH: '/k.p8', ASC_KEY_ID: 'k', ASC_ISSUER_ID: 'i', SPARKLE_BIN: '/sparkle/bin', FROSTDEV_SITE_DIR: '/site',
  NODE_OPTIONS: '--require /evil.js', SOME_FUTURE_SECRET: 'x',
};

test('a third-party step gets an allowlisted environment and a temporary HOME', async () => {
  const { isolatedEnv } = await import('../scripts/public-release.mjs');
  const env = isolatedEnv({
    PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TZ: 'UTC', TMPDIR: '/var/tmp/x', HTTPS_PROXY: 'http://proxy.example:8080',
    HOME: '/Users/me', ...SECRETS,
  }, '/scratch/home');
  assert.equal(env.HOME, '/scratch/home', 'the step must not see the real home directory (~/.config/glaze, ~/.ssh, ~/.npmrc)');
  for (const key of Object.keys(SECRETS)) assert.ok(!(key in env), `${key} reached the third-party step`);
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.LANG, 'en_US.UTF-8');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example:8080', 'npm still has to reach the registry');
  // Nothing may point back at the real home through the XDG and npm cache variables.
  for (const [key, value] of Object.entries(env)) if (/^(XDG_|npm_config_cache$)/.test(key)) assert.ok(value.startsWith('/scratch/home'), `${key}=${value}`);
  assert.ok(Object.keys(env).every((key) => !/token|secret|key|credential|auth/i.test(key)), JSON.stringify(Object.keys(env)));
});

test('the temporary HOME exists for the step, lives in the OS temp directory, and is removed afterwards', async () => {
  const { withIsolatedEnv } = await import('../scripts/public-release.mjs');
  let seen;
  const result = await withIsolatedEnv({ PATH: '/usr/bin', HOME: os.homedir(), GH_TOKEN: 'gh' }, async (env) => {
    seen = env.HOME;
    assert.ok(fs.statSync(seen).isDirectory());
    assert.equal(fs.statSync(seen).mode & 0o077, 0, 'private to this user');
    return 'ran';
  });
  assert.equal(result, 'ran');
  assert.notEqual(seen, os.homedir());
  assert.ok(seen.startsWith(fs.realpathSync(os.tmpdir())) || seen.startsWith(os.tmpdir()), seen);
  assert.equal(fs.existsSync(seen), false);
  await assert.rejects(withIsolatedEnv({ PATH: '/usr/bin' }, async (env) => { seen = env.HOME; throw new Error('step failed'); }), /step failed/);
  assert.equal(fs.existsSync(seen), false, 'removed when the step fails too');
});

test('the Firefox lint runs a pinned web-ext', async () => {
  const { WEB_EXT } = await import('../scripts/store-release.mjs');
  assert.match(WEB_EXT, /^web-ext@\d+\.\d+\.\d+$/, 'an exact version, never a range or a tag');
  const source = read('scripts/store-release.mjs');
  assert.match(source, /'npx', \['--yes', WEB_EXT, 'lint'/);
  assert.equal(source.match(/web-ext@/g).length, 1, 'the version lives in one constant');
});

test('every npm, npx and website step gets the isolated environment', () => {
  let steps = 0;
  for (const f of ['scripts/store-release.mjs', 'scripts/public-release.mjs']) {
    for (const [call] of read(f).matchAll(/[^\n]*\brun\('(?:npm|npx)'[^\n]*|[^\n]*\brun\('node', \[[^\n]*, site, [^\n]*/g)) {
      steps++;
      assert.match(call, /, (?:bare|isolated),/, `${f}: ${call.trim().slice(0, 100)}`);
      assert.doesNotMatch(call, /, (?:env|\{ \.\.\.env[^}]*\}),/, `${f}: raw environment in ${call.trim().slice(0, 100)}`);
    }
  }
  assert.ok(steps >= 8, `expected the lint and the website steps, found ${steps}`);
});

test('the old denylist is gone', () => {
  for (const f of ['scripts/store-release.mjs', 'scripts/public-release.mjs']) assert.doesNotMatch(read(f), /withoutStoreKeys|STORE_KEYS/, f);
});
