// Where the release tools take their source from: the Chrome recovery scripts package a clean checkout of the committed
// HEAD (as CI does for a tag), and the release command builds Firefox on the current origin/dev/firefox.
// Nothing here runs the release scripts themselves; the clean-source helper and the branch resolver are exercised against
// throwaway repositories on disk (a bare repository stands in for origin).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const helper = path.join(root, 'scripts/clean-source.sh');
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR)$/.test(key)) delete env[key];
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'protocol.file.allow=always', ...args],
  { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }).trim();
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sources-'));
const write = (dir, file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
const commit = (dir, file, text, message = `edit ${file}`) => { write(dir, file, text); git(dir, 'add', '--', file); git(dir, 'commit', '-qm', message); return git(dir, 'rev-parse', 'HEAD'); };

// ---- BLD-7: the packaging scripts build from a clean checkout of the commit, not the working tree ----

const project = () => {
  const dir = scratch();
  git(dir, 'init', '-q', '--initial-branch=main');
  commit(dir, '.gitignore', '*.env\ndist/\nrelease/\n');
  commit(dir, 'lib/a.js', 'committed\n');
  return dir;
};
const sh = (cwd, body) => spawnSync('sh', ['-c', `. "${helper}"; ${body}`], { cwd, encoding: 'utf8', env });

test('the clean-source helper accepts a tree that matches HEAD, ignored files included', () => {
  const dir = project();
  try {
    write(dir, 'dist/glaze-v1.zip', 'build output');
    write(dir, 'lib/local.env', 'SECRET=1');
    const result = sh(dir, 'glaze_require_clean "$PWD" publish-chrome');
    assert.equal(result.status, 0, result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the clean-source helper refuses edited tracked files and untracked files, and says which', () => {
  const dir = project();
  try {
    write(dir, 'lib/a.js', 'edited\n');
    let result = sh(dir, 'glaze_require_clean "$PWD" publish-chrome');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /publish-chrome:/);
    assert.match(result.stderr, /lib\/a\.js/);
    git(dir, 'checkout', '--', 'lib/a.js');
    write(dir, 'lib/scratch.js', 'oops');
    result = sh(dir, 'glaze_require_clean "$PWD" release.sh');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /release\.sh:/);
    assert.match(result.stderr, /lib\/scratch\.js/);
    fs.unlinkSync(path.join(dir, 'lib/scratch.js'));
    assert.equal(sh(dir, 'glaze_require_clean "$PWD" release.sh').status, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a checkout of HEAD carries the committed files only, and leaves the source repository alone', () => {
  const dir = project(), out = scratch();
  try {
    write(dir, 'lib/stray.env', 'ignored but present in the working tree');
    write(dir, 'lib/untracked.js', 'untracked');
    write(dir, 'lib/a.js', 'edited, not committed\n');
    const head = git(dir, 'rev-parse', 'HEAD'), before = git(dir, 'status', '--porcelain', '--ignored');
    const result = sh(dir, `glaze_checkout_head "$PWD" "${out}/glaze"`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(out, 'glaze/lib/a.js'), 'utf8'), 'committed\n');
    assert.equal(fs.existsSync(path.join(out, 'glaze/lib/stray.env')), false, 'an ignored file must not ride along');
    assert.equal(fs.existsSync(path.join(out, 'glaze/lib/untracked.js')), false);
    assert.equal(git(path.join(out, 'glaze'), 'rev-parse', 'HEAD'), head, 'the checkout is exactly the commit');
    assert.equal(git(path.join(out, 'glaze'), 'status', '--porcelain'), '');
    assert.equal(git(dir, 'status', '--porcelain', '--ignored'), before);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); }
});

const code = (file) => read(file).split('\n').filter((line) => !/^\s*#/.test(line));
for (const file of ['scripts/publish-chrome.sh', 'scripts/release.sh']) {
  test(`${file} refuses a dirty tree and packages from a checkout of HEAD`, () => {
    const lines = code(file);
    const first = (re) => lines.findIndex((line) => re.test(line));
    assert.ok(first(/^\s*\. "\$root\/scripts\/clean-source\.sh"/) >= 0, 'sources the helper');
    const gate = first(/\bglaze_require_clean\b/), checkout = first(/\bglaze_checkout_head\b/);
    assert.ok(gate >= 0 && checkout > gate, 'refuse first, then check out');
    const packaging = lines.map((line, i) => [line, i]).filter(([line]) => /\bpackage\.sh\b/.test(line));
    assert.ok(packaging.length >= 1);
    for (const [line, i] of packaging) {
      assert.ok(i > checkout, `package.sh runs before the checkout exists: ${line.trim()}`);
      assert.match(line, /\(cd "\$src" && DIST="[^"]+" \.\/package\.sh\)/, `packages the working tree: ${line.trim()}`);
    }
  });
}

test('release.sh runs the suite on the checkout too, so the tested bytes are the packaged bytes', () => {
  const lines = code('scripts/release.sh');
  assert.ok(lines.some((line) => /\(cd "\$src" && node --test\)/.test(line)));
  assert.ok(!lines.some((line) => /^\s*node --test\b/.test(line)), 'a bare node --test tests the working tree');
});

test('publish-chrome.sh only builds when no zip is given, so a given zip is uploaded as is', () => {
  assert.match(read('scripts/publish-chrome.sh'), /if \[ -z "\$zip" \]; then[\s\S]*glaze_require_clean[\s\S]*package\.sh[\s\S]*\nfi/);
});

// ---- BLD-8: the Firefox compatibility branch is fetched before the release uses it ----

const origin = () => {
  const base = scratch(), bare = path.join(base, 'origin.git'), seed = path.join(base, 'seed');
  git(base, 'init', '-q', '--bare', '--initial-branch=main', bare);
  git(base, 'clone', '-q', bare, seed);
  commit(seed, 'manifest.json', '{"version":"1.0.0"}\n', 'main 1');
  git(seed, 'branch', '-M', 'main');
  git(seed, 'push', '-q', 'origin', 'main');
  git(seed, 'checkout', '-q', '-b', 'dev/firefox');
  commit(seed, 'firefox.txt', 'compat 1\n', 'compat 1');
  git(seed, 'push', '-q', 'origin', 'dev/firefox');
  const work = path.join(base, 'work');
  git(base, 'clone', '-q', bare, work);
  return { base, bare, seed, work };
};
const advance = (fixture, text) => { git(fixture.seed, 'checkout', '-q', 'dev/firefox'); const sha = commit(fixture.seed, 'firefox.txt', text); git(fixture.seed, 'push', '-q', 'origin', 'dev/firefox'); return sha; };
const resolver = async () => (await import('../scripts/store-release.mjs')).resolveFirefoxBase;

test('with no local dev/firefox branch the release builds on origin\'s', async () => {
  const resolveFirefoxBase = await resolver(), fx = origin();
  try {
    const remote = git(fx.seed, 'rev-parse', 'dev/firefox');
    assert.throws(() => git(fx.work, 'rev-parse', '--verify', 'dev/firefox^{commit}'), 'the clone really has no local branch');
    assert.equal(resolveFirefoxBase('dev/firefox', { cwd: fx.work }), remote);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a local dev/firefox that equals origin\'s is used as is', async () => {
  const resolveFirefoxBase = await resolver(), fx = origin();
  try {
    git(fx.work, 'branch', 'dev/firefox', 'origin/dev/firefox');
    assert.equal(resolveFirefoxBase('dev/firefox', { cwd: fx.work }), git(fx.seed, 'rev-parse', 'dev/firefox'));
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a fix pushed to origin/dev/firefox is noticed: a stale local branch stops the release', async () => {
  const resolveFirefoxBase = await resolver(), fx = origin();
  try {
    git(fx.work, 'branch', 'dev/firefox', 'origin/dev/firefox');
    const stale = git(fx.work, 'rev-parse', 'dev/firefox');
    advance(fx, 'compat 2, pushed from another machine\n');
    assert.throws(() => resolveFirefoxBase('dev/firefox', { cwd: fx.work }), /dev\/firefox is behind origin\/dev\/firefox/);
    assert.equal(git(fx.work, 'rev-parse', 'dev/firefox'), stale, 'the permanent branch is never moved by the release');
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('a local dev/firefox ahead of origin is allowed, and a diverged one is not', async () => {
  const resolveFirefoxBase = await resolver(), fx = origin();
  try {
    git(fx.work, 'checkout', '-q', '-b', 'dev/firefox', 'origin/dev/firefox');
    const ahead = commit(fx.work, 'local.txt', 'unpushed\n');
    assert.equal(resolveFirefoxBase('dev/firefox', { cwd: fx.work }), ahead);
    advance(fx, 'compat 2\n');
    assert.throws(() => resolveFirefoxBase('dev/firefox', { cwd: fx.work }), /diverged/);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('--firefox-ref may name a newer candidate only if it contains the permanent branch', async () => {
  const resolveFirefoxBase = await resolver(), fx = origin();
  try {
    git(fx.work, 'checkout', '-q', '-b', 'dev/firefox', 'origin/dev/firefox');
    const candidate = commit(fx.work, 'next.txt', 'candidate\n');
    git(fx.work, 'checkout', '-q', 'main');
    git(fx.work, 'branch', '-f', 'dev/firefox', 'origin/dev/firefox');
    git(fx.work, 'branch', 'candidate', candidate);
    assert.equal(resolveFirefoxBase('candidate', { cwd: fx.work }), candidate);
    assert.throws(() => resolveFirefoxBase('main', { cwd: fx.work }), /must contain the permanent dev\/firefox/);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('without fetching, nothing touches origin (plan and resumed runs stay offline)', async () => {
  const resolveFirefoxBase = await resolver(), fx = origin();
  try {
    git(fx.work, 'branch', 'dev/firefox', 'origin/dev/firefox');
    const local = git(fx.work, 'rev-parse', 'dev/firefox');
    advance(fx, 'compat 2\n');
    git(fx.work, 'remote', 'set-url', 'origin', path.join(fx.base, 'gone.git'));
    assert.equal(resolveFirefoxBase('dev/firefox', { cwd: fx.work, fetch: false }), local);
    assert.throws(() => resolveFirefoxBase('dev/firefox', { cwd: fx.work }), /Could not fetch origin\/dev\/firefox/);
  } finally { fs.rmSync(fx.base, { recursive: true, force: true }); }
});

test('the release command resolves the Firefox base through the fetching helper, and plan stays offline', () => {
  const source = read('scripts/store-release.mjs');
  assert.doesNotMatch(source, /rev-parse', '--verify', `\$\{opt\.firefoxRef\}\^\{commit\}`/, 'the unfetched lookup is gone');
  assert.match(source, /resolveFirefoxBase\(opt\.firefoxRef, \{ fetch: /);
  assert.match(source, /building = \['release', 'build'\]\.includes\(opt\.command\)/, 'only commands that build fetch');
});
