// The packagers build from a commit: edits and untracked files stop them before anything is written (tools/release/
// clean-source.sh), so a scratch file can't ride into an upload. Run against a checkout of this repository's HEAD in a
// temporary folder, with a stand-in xcodebuild first on PATH: nothing here builds an app or reaches a store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const repo = path.join(__dirname, '../..');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(key)) delete env[key];
const read = (file) => fs.readFileSync(path.join(repo, file), 'utf8');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-package-clean-'));
test.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
const tree = path.join(scratch, 'glaze');
execFileSync('sh', ['-c', `. "${path.join(repo, 'tools/release/clean-source.sh')}"; glaze_checkout_head "${repo}" "${tree}"`], { env, stdio: 'pipe' });
execFileSync('git', ['-C', tree, 'checkout', '-q', '-b', 'dev/firefox'], { env, stdio: 'pipe' });
// A stand-in xcodebuild: the App Store scripts reach it only after packaging, and it fails.
const bin = path.join(scratch, 'bin'), marker = path.join(scratch, 'xcodebuild-called');
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, 'xcodebuild'), `#!/bin/sh\necho "$@" >> "${marker}"\nexit 1\n`, { mode: 0o755 });

let runs = 0;
const run = (script, args = [], extra = {}) => {
  const dist = path.join(scratch, `dist-${runs++}`);
  // The shells the release tools use: package.sh and the sync script are bash, the rest run under sh.
  const result = spawnSync(/(?:package|sync-safari-resources)\.sh$/.test(script) ? 'bash' : 'sh', [script, ...args], {
    cwd: tree, encoding: 'utf8', env: { ...env, DIST: dist, PATH: `${bin}:${process.env.PATH}`, ASC_KEY_PATH: '/nonexistent', ASC_KEY_ID: 'X', ASC_ISSUER_ID: 'X', BUILD_NUMBER: '1', ...extra },
  });
  return { ...result, dist, made: fs.existsSync(dist) };
};
const stray = path.join(tree, 'extension/scratch-note.js');
const dirty = (body) => { fs.writeFileSync(stray, '// not committed\n'); try { return body(); } finally { fs.rmSync(stray, { force: true }); } };
const zipOf = (result) => fs.readdirSync(result.dist).find((f) => /^glaze-v[\d.]+\.zip$/.test(f));

test('package.sh packages a clean checkout of the commit', () => {
  const result = run('tools/build/package.sh');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(zipOf(result), 'the zip is written');
});

test('package.sh refuses an untracked file before it writes anything, and says which', () => {
  dirty(() => {
    const result = run('tools/build/package.sh');
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /package\.sh: the working tree has changes that are not committed/);
    assert.match(result.stderr, /extension\/scratch-note\.js/);
    assert.match(result.stderr, /--allow-dirty/, 'names the way to package a working tree on purpose');
    assert.equal(result.made, false, 'nothing was written');
  });
});

test('package.sh refuses an edited tracked file too', () => {
  const manifest = path.join(tree, 'extension/manifest.json'), original = fs.readFileSync(manifest);
  fs.appendFileSync(manifest, '\n');
  try {
    const result = run('tools/build/package.sh');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /extension\/manifest\.json/);
    assert.equal(result.made, false);
  } finally { fs.writeFileSync(manifest, original); }
});

test('package.sh --allow-dirty packages the working tree as it stands', () => {
  dirty(() => {
    const result = run('tools/build/package.sh', ['--allow-dirty']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(zipOf(result));
  });
});

test('package.sh takes no other argument', () => {
  const result = run('tools/build/package.sh', ['--force']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: .*package\.sh \[--allow-dirty\]/);
  assert.equal(result.made, false);
});

test('package-firefox.sh refuses an untracked file, which its old check did not see', () => {
  const stray = path.join(tree, 'notes-for-later.txt');
  fs.writeFileSync(stray, 'x');
  try {
    const result = run('tools/build/package-firefox.sh');
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /package-firefox: the working tree has changes that are not committed/);
    assert.match(result.stderr, /notes-for-later\.txt/);
    assert.equal(result.made, false);
    // --development is the existing way to package a dirty tree for local checks, and records that it was.
    const development = run('tools/build/package-firefox.sh', ['--development']);
    assert.equal(development.status, 0, development.stderr);
    const build = JSON.parse(execFileSync('unzip', ['-p', path.join(development.dist, fs.readdirSync(development.dist).find((f) => f.endsWith('-firefox.zip'))), 'glaze-build.json']));
    assert.equal(build.dirty, true, 'an untracked file counts');
    assert.equal(build.development, true);
  } finally { fs.rmSync(stray, { force: true }); }
});

test('package-firefox.sh still packages a clean dev/firefox checkout, recorded as clean', () => {
  const result = run('tools/build/package-firefox.sh');
  assert.equal(result.status, 0, result.stderr);
  const build = JSON.parse(execFileSync('unzip', ['-p', path.join(result.dist, fs.readdirSync(result.dist).find((f) => f.endsWith('-firefox.zip'))), 'glaze-build.json']));
  assert.deepEqual([build.dirty, build.development, build.branch], [false, false, 'dev/firefox']);
});

for (const script of ['appstore-safari.sh', 'appstore-ios.sh']) {
  test(`${script} refuses a dirty tree before it packages or builds anything`, () => {
    dirty(() => {
      fs.rmSync(marker, { force: true }); fs.rmSync(path.join(tree, 'dist'), { recursive: true, force: true });
      const result = run(`tools/build/${script}`, [], { DIST: '' });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, new RegExp(`${script.replace('.sh', '')}: the working tree has changes that are not committed`));
      assert.match(result.stderr, /extension\/scratch-note\.js/);
      assert.equal(fs.existsSync(path.join(tree, 'dist')), false, 'no package was made');
      assert.equal(fs.existsSync(marker), false, 'xcodebuild was never reached');
    });
  });
}

test('sync-safari-resources.sh --check keeps working on a dirty tree, packaging it on purpose', () => {
  fs.writeFileSync(path.join(tree, 'notes-for-later.txt'), 'x');
  try {
    const result = run('tools/build/sync-safari-resources.sh', ['--check']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Direct Xcode resources match/);
  } finally { fs.rmSync(path.join(tree, 'notes-for-later.txt'), { force: true }); }
});

test('only the callers that package a working tree on purpose pass --allow-dirty', () => {
  const callers = (dir) => fs.readdirSync(path.join(repo, dir)).filter((f) => !fs.statSync(path.join(repo, dir, f)).isDirectory())
    .filter((f) => f !== 'package.sh' && /--allow-dirty/.test(read(`${dir}/${f}`))).map((f) => `${dir}/${f}`);
  assert.deepEqual([...callers('tools/build'), ...callers('tools/dev'), ...callers('tools/release')].sort(), [
    'tools/build/build-safari.sh', 'tools/build/package-firefox.sh', 'tools/build/package-safari.sh', 'tools/build/sync-safari-resources.sh',
    'tools/dev/dev-drive.sh', 'tools/dev/dev-gcal.sh',
  ]);
  for (const file of ['tools/build/appstore-safari.sh', 'tools/build/appstore-ios.sh', 'tools/release/release.sh', 'tools/release/publish-chrome.sh', 'tools/release/store-release.mjs']) {
    assert.doesNotMatch(read(file), /--allow-dirty/, `${file} builds from the commit`);
  }
  // Firefox passes it only for --development.
  assert.match(read('tools/build/package-firefox.sh'), /else\s+allow=--allow-dirty\s+echo 'Building a Firefox development package/);
});
