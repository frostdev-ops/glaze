// GLAZE_TRUST_CI stands in for GitHub's Package run, GLAZE_TRUST_SITE_CI for the website's site.yml run. Each is accepted
// only when its text names the commit it vouches for, so a stray "1" or a note about another release cannot skip a gate.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pub = () => import('../../tools/release/public-release.mjs');
const source = fs.readFileSync(path.join(__dirname, '../../tools/release/public-release.mjs'), 'utf8');
const commit = '3f9c2a41b7d85e60a1c4d2f79b0e3a58c6d1e742';
const other = '9a1c0be5d27f4833c1e6a07d5b94f2e8d0c3a611';
const body = (name) => source.slice(source.indexOf(`function ${name}(`)).split(/\n(?:export )?(?:async )?function /)[0];

test('an unset or empty trust variable waits for the workflow as before', async () => {
  const { trustedCI } = await pub();
  assert.equal(trustedCI('GLAZE_TRUST_CI', undefined, commit), null);
  assert.equal(trustedCI('GLAZE_TRUST_CI', '', commit), null);
});

test('a trust value naming the commit by its full SHA or its first 12 characters is accepted as written', async () => {
  const { trustedCI } = await pub();
  const full = `runner node --test 12261/0 for ${commit}`;
  assert.equal(trustedCI('GLAZE_TRUST_CI', full, commit), full);
  const short = `runner run 7, ${commit.slice(0, 12)}`;
  assert.equal(trustedCI('GLAZE_TRUST_CI', short, commit), short);
  const upper = `evidence ${commit.slice(0, 12).toUpperCase()}`;
  assert.equal(trustedCI('GLAZE_TRUST_SITE_CI', upper, commit), upper);
});

test('any other non-empty trust value is refused, and the message says what to pass', async () => {
  const { trustedCI } = await pub();
  for (const value of ['1', 'true', 'trusted', ' ', 'runner evidence', `runner evidence for ${other}`, commit.slice(0, 11), commit.slice(1)]) {
    assert.throws(() => trustedCI('GLAZE_TRUST_CI', value, commit), (error) => {
      assert.match(error.message, /GLAZE_TRUST_CI must name the commit/);
      assert.ok(error.message.includes(commit.slice(0, 12)), 'names the 12-character SHA to pass');
      assert.match(error.message, /full SHA/);
      assert.match(error.message, /Unset it to wait for GitHub/);
      return true;
    }, JSON.stringify(value));
  }
  assert.throws(() => trustedCI('GLAZE_TRUST_SITE_CI', 'ok', commit), /GLAZE_TRUST_SITE_CI must name the commit/);
});

test('publishing refuses a trust value that does not name the source commit before it saves, pushes or tags anything', async () => {
  const { publishPublic } = await pub();
  let saved = 0;
  const context = { manifest: { sourceCommit: commit, version: '1.2.3', public: {} }, save: () => { saved++; }, out: os.tmpdir(), root: os.tmpdir(), env: { GLAZE_TRUST_CI: 'runner ok' }, run: async () => { throw new Error('ran a command'); } };
  await assert.rejects(publishPublic(context), /GLAZE_TRUST_CI must name the commit 3f9c2a41b7d8/);
  assert.equal(saved, 0);
});

test('the preflight refuses it too, so a bad value stops `doctor` and `release` before anything is built', () => {
  assert.match(body('publicPreflight'), /trustedCI\('GLAZE_TRUST_CI', env\.GLAZE_TRUST_CI, manifest\.sourceCommit\)/);
});

test('GLAZE_TRUST_CI skips only the Package run: the website needs GLAZE_TRUST_SITE_CI naming the website commit', () => {
  const publish = body('publishPublic'), site = body('publishWebsiteWith');
  assert.match(publish, /state\.packageCI = [^\n]*\bawait workflow\(repo, 'package\.yml'/);
  const websiteCI = site.split('\n').find((line) => /state\.websiteCI =/.test(line));
  assert.ok(websiteCI, 'the website CI line exists');
  assert.doesNotMatch(websiteCI, /GLAZE_TRUST_CI/, 'the package trust must not skip site.yml');
  assert.match(site, /trustedCI\('GLAZE_TRUST_SITE_CI', env\.GLAZE_TRUST_SITE_CI, state\.siteCommit\)/);
  assert.match(websiteCI, /await workflow\(siteRepo, 'site\.yml', state\.siteCommit/);
  assert.ok(site.indexOf('GLAZE_TRUST_SITE_CI') < site.indexOf("'push', 'origin', `${state.siteCommit}:refs/heads/main`"), 'checked before the website is pushed');
});

test('the script header documents both variables', () => {
  const header = source.split('\n').slice(0, 20).join('\n');
  assert.match(header, /GLAZE_TRUST_CI/);
  assert.match(header, /GLAZE_TRUST_SITE_CI/);
});
