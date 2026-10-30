// scripts/vendor-three.sh installs exact, integrity-pinned versions without running their install scripts, and checks
// what npm installed against the pins before anything it installed is executed. These tests never run the script (it
// installs from the network); they read it, run its integrity checker on synthetic lockfiles, and pin the checked-in output.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const script = read('scripts/vendor-three.sh');
const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const SRI = /^sha512-[A-Za-z0-9+/]{86}==$/;
const variable = (name) => script.match(new RegExp(`^${name}=(\\S+)\\s*$`, 'm'))?.[1];
const table = () => {
  const body = script.match(/<<'EOF'\n([\s\S]*?)\nEOF/)?.[1] ?? '';
  return body.split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/));
};

test('the install is exact, ignores install scripts, and uses the public registry', () => {
  const install = code.replace(/\\\n\s*/g, ' ').match(/npm install[^\n]*/)?.[0] ?? '';
  assert.match(install, /--ignore-scripts/);
  assert.match(install, /"three@\$three_version"/);
  assert.match(install, /"esbuild@\$esbuild_version"/);
  assert.match(install, /--registry https:\/\/registry\.npmjs\.org\//);
  assert.match(variable('three_version'), /^\d+\.\d+\.\d+$/);
  assert.match(variable('esbuild_version'), /^\d+\.\d+\.\d+$/);
  assert.doesNotMatch(code, /\bnpx\b|@latest|\^\d|~\d/);
});

test('there is no version argument: an upgrade edits the pins', () => {
  assert.doesNotMatch(code, /\$\{1:-|\$1\b/);
  assert.doesNotMatch(script.split('\n').slice(0, 8).join('\n'), /\[version\]/);
});

test('every installed package has a pinned SHA-512 integrity, for this three and esbuild and its platform binaries', () => {
  const rows = table();
  assert.ok(rows.length >= 4, 'three, esbuild and at least the Mac and Linux binaries');
  const seen = new Set();
  for (const [id, integrity] of rows) {
    assert.match(id, /^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+$/, id);
    assert.match(integrity, SRI, id);
    assert.ok(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
  }
  assert.ok(seen.has(`three@${variable('three_version')}`));
  assert.ok(seen.has(`esbuild@${variable('esbuild_version')}`));
  for (const id of seen) if (id.startsWith('@esbuild/')) assert.ok(id.endsWith(`@${variable('esbuild_version')}`), `${id} is not esbuild's version`);
  for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64']) assert.ok(seen.has(`@esbuild/${platform}@${variable('esbuild_version')}`), platform);
});

test('the integrity check runs on the installed tree before esbuild does', () => {
  const check = code.indexOf('npm-integrity.js'), run = code.indexOf('.bin/esbuild');
  assert.ok(check > 0 && run > check, 'verify first, then execute');
  assert.match(code, /npm-integrity\.js "\$tmp\/node_modules\/\.package-lock\.json"/);
});

test('the build is compared with the recorded hash of lib/three.js, which is the checked-in file', () => {
  const recorded = variable('file_sha256');
  assert.match(recorded, /^[0-9a-f]{64}$/);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'lib/three.js'))).digest('hex'), recorded,
    'rebuild with scripts/vendor-three.sh and record the new hash, rather than editing lib/three.js by hand');
  assert.match(code, /file_sha256/);
  assert.match(read('lib/three.js').split('\n')[0], new RegExp(`^// three\\.js ${variable('three_version').replace(/\./g, '\\.')} `));
});

// ---- the checker ----

const checker = () => require('../scripts/npm-integrity.js');
const integrity = (text) => `sha512-${crypto.createHash('sha512').update(text).digest('base64')}`;
const entry = (name, version, extra = {}) => [`node_modules/${name}`, { version, resolved: `https://registry.npmjs.org/${name}/-/${name.split('/').pop()}-${version}.tgz`, integrity: integrity(`${name}@${version}`), ...extra }];
const lockOf = (...entries) => ({ name: 'tmp', lockfileVersion: 3, requires: true, packages: Object.fromEntries(entries) });
const pinsOf = (...ids) => ids.map((id) => { const at = id.lastIndexOf('@'); return `${id} ${integrity(id)}`; }).join('\n');
const good = () => ({
  lock: lockOf(entry('three', '1.0.0'), entry('esbuild', '2.0.0', { hasInstallScript: true }), entry('@esbuild/linux-x64', '2.0.0', { os: ['linux'], optional: true })),
  pins: pinsOf('three@1.0.0', 'esbuild@2.0.0', '@esbuild/linux-x64@2.0.0', '@esbuild/darwin-arm64@2.0.0'),
});

test('the checker accepts exactly the pinned packages, including unused platform pins', () => {
  const { check } = checker(), { lock, pins } = good();
  assert.deepEqual(check(lock, pins, ['three', 'esbuild']).sort(), ['@esbuild/linux-x64@2.0.0', 'esbuild@2.0.0', 'three@1.0.0']);
});

test('the checker refuses a package whose integrity npm recorded differently', () => {
  const { check } = checker(), { lock, pins } = good();
  lock.packages['node_modules/three'].integrity = integrity('tampered');
  assert.throws(() => check(lock, pins, ['three']), /integrity mismatch for three@1\.0\.0/);
});

test('the checker refuses a package nobody pinned, such as a new dependency or another version', () => {
  const { check } = checker(), { lock, pins } = good();
  lock.packages['node_modules/evil-dep'] = entry('evil-dep', '0.0.1')[1];
  assert.throws(() => check(lock, pins, ['three']), /unpinned package evil-dep@0\.0\.1/);
  const upgraded = good();
  upgraded.lock.packages['node_modules/three'].version = '1.0.1';
  assert.throws(() => check(upgraded.lock, upgraded.pins, ['three']), /unpinned package three@1\.0\.1/);
});

test('the checker refuses nested copies, links and packages that did not come from the npm registry', () => {
  const { check } = checker();
  for (const [what, mutate, message] of [
    ['a git dependency', (p) => { p.resolved = 'git+ssh://git@github.com/x/y.git#abc'; }, /not fetched from the npm registry/],
    ['another registry', (p) => { p.resolved = 'https://registry.example.invalid/three/-/three-1.0.0.tgz'; }, /not fetched from the npm registry/],
    ['a link', (p) => { p.link = true; }, /is a link/],
    ['no integrity', (p) => { delete p.integrity; }, /has no integrity/],
    ['a weak hash', (p) => { p.integrity = 'sha1-abcdefghijklmnopqrstuvwxyz0='; }, /integrity mismatch|has no integrity/],
  ]) {
    const { lock, pins } = good();
    mutate(lock.packages['node_modules/three']);
    assert.throws(() => check(lock, pins, ['three']), message, what);
  }
  const nested = good();
  nested.lock.packages['node_modules/esbuild/node_modules/three'] = entry('three', '1.0.0')[1];
  assert.doesNotThrow(() => check(nested.lock, nested.pins, ['three']), 'a nested copy is judged by name and version like any other');
});

test('the checker insists that the packages it was asked about are installed', () => {
  const { check } = checker(), { lock, pins } = good();
  delete lock.packages['node_modules/esbuild'];
  assert.throws(() => check(lock, pins, ['three', 'esbuild']), /required package esbuild is not installed/);
});

test('the checker refuses malformed input rather than passing it', () => {
  const { check } = checker();
  assert.throws(() => check({}, pinsOf('three@1.0.0'), ['three']), /not an npm lockfile/);
  assert.throws(() => check(good().lock, 'three@1.0.0 md5-nope', ['three']), /bad pin/);
  assert.throws(() => check(good().lock, pinsOf('three@1.0.0') + '\nthree@1.0.0 ' + integrity('other'), ['three']), /pinned twice/);
});

test('the command line checks a lockfile against pins on stdin and fails closed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-integrity-'));
  try {
    const { lock, pins } = good();
    fs.writeFileSync(path.join(dir, '.package-lock.json'), JSON.stringify(lock));
    const run = (args, input) => spawnSync(process.execPath, [path.join(root, 'scripts/npm-integrity.js'), ...args], { input, encoding: 'utf8' });
    let result = run([path.join(dir, '.package-lock.json'), '-', 'three', 'esbuild'], pins + '\n');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3 packages match their pinned integrity/);
    result = run([path.join(dir, '.package-lock.json'), '-', 'three', 'esbuild'], pinsOf('three@1.0.0', 'esbuild@2.0.0') + '\n');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unpinned package @esbuild\/linux-x64@2\.0\.0/);
    result = run([path.join(dir, 'missing.json'), '-', 'three'], pins);
    assert.notEqual(result.status, 0, 'npm wrote no lockfile: nothing can be verified');
    assert.match(result.stderr, /missing\.json/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
