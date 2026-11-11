// Exercise package-clean.test.js's real setup from the branch store-release tests for Firefox. Test bodies are registered
// but never run here: this checks the source checkout setup without packaging or invoking an App Store build.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

test('the clean-packaging tests can start from dev/firefox as store-release does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-clean-bootstrap-'));
  const cleanup = [];
  try {
    const repo = path.join(dir, 'source');
    fs.mkdirSync(path.join(repo, 'tools/release'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../../tools/release/clean-source.sh'), path.join(repo, 'tools/release/clean-source.sh'));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
    const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, stdio: 'pipe' });
    git('init', '--quiet', '--initial-branch=dev/firefox');
    git('add', '-f', 'tools/release/clean-source.sh');
    git('-c', 'user.name=Glaze fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'Create offline source fixture');
    const registered = [];
    const register = (name) => registered.push(name);
    register.after = (fn) => cleanup.push(fn);
    const file = path.join(__dirname, 'package-clean.test.js');
    assert.doesNotThrow(() => vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      require: (name) => name === 'node:test' ? register : require(name),
      __dirname: path.join(repo, 'test/release'), process,
    }, { filename: file }));
    assert.ok(registered.includes('package.sh packages a clean checkout of the commit'), 'setup completed and registered the packaging tests');
  } finally {
    for (const fn of cleanup) fn();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
