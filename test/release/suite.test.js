// tools/dev/suite.js: the Mac's stand-in for the runner's `node --test` over a clean checkout. It runs the files Node 26's
// default discovery finds among `git ls-files -co --exclude-standard`, never the ignored copies (release/<version>/…) that a
// bare `node --test` in the main checkout also finds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { isTestFile, selectTests, gitFiles, main } = require('../../tools/dev/suite.js');

const scratch = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-suite-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const put = (root, names) => names.forEach((n) => {
  fs.mkdirSync(path.dirname(path.join(root, n)), { recursive: true });
  // Logs its own name; process.getBuiltinModule works in .mjs and .mts too.
  fs.writeFileSync(path.join(root, n), `process.getBuiltinModule('node:fs').appendFileSync(process.env.RAN_LOG, ${JSON.stringify(n)} + '\\n');\n`);
});
const walk = (root, rel = '') => fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(root, path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));
// A node --test started inside a test inherits NODE_TEST_CONTEXT from the runner above it and then runs nothing.
const envFor = (log) => { const e = { ...process.env, RAN_LOG: log }; delete e.NODE_TEST_CONTEXT; return e; };
const ran = (log) => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).sort() : []);

// Node 26.12 and 26.13 docs, "Running tests from the command line", and a run of both Node versions' discovery over these names.
const MATCH = [
  'a.test.js', 'a.test.cjs', 'a.test.mjs', 'b-test.js', 'b2-test.mjs', 'c_test.js', 'c2_test.cjs', 'test-d.js', 'test-d2.mjs', 'test-.js', 'test.js', 'test.cjs',
  'sub/x.test.js', 'sub/deep/test-y.mjs', 'sub/not-a-test.js', 'sub/test.mjs',
  'test/f.js', 'test/g.cjs', 'test/h.mjs', 'test/sub/j.js', 'test/helpers/k.cjs', 'test/fixtures/m.js', 'src/test/n.js', 'fixtures/test/aa.js',
  'tools/test-helper.js', 'test-dir/inner.test.js', 'a[1].test.js', 'b (2).test.js', 'test-star*.js',
  'a.test.ts', 'a.test.mts', 'a.test.cts', 'b-test.ts', 'c_test.mts', 'test-e.cts', 'test.ts', 'test/p.ts', 'test/q.mts',
];
const SKIP = [
  'e.spec.js', 'a.test.jsx', 'a.test.json', 'test/i.json', 'test/fixtures/l.html', 'src/test/o.txt', 'tests/p.js', 'atest.js', 'x_test.txt', 'tools/mytest.js', 'testing/t.js',
  '.hidden/r.test.js', '.hidden/test/s.js', 'sub/.dot.test.js', 'sub/.dotdir/t.test.js', '.github/u.test.js',
  'node_modules/pkg/v.test.js', 'sub/node_modules/w.test.js', 'test/node_modules/x.js', 'types/glaze.d.ts',
];

test('the patterns are Node 26\'s defaults: names, the test folder, TypeScript, and not dot folders or node_modules', () => {
  for (const f of MATCH) assert.ok(isTestFile(f), `${f} is a test file`);
  for (const f of SKIP) assert.ok(!isTestFile(f), `${f} is not`);
  assert.ok(!isTestFile('a.test.ts', { strip: false }) && !isTestFile('test/p.ts', { strip: false }), '--no-strip-types drops the TypeScript patterns');
  assert.ok(isTestFile('a.test.js', { strip: false }));
});

test('Node\'s own discovery agrees with isTestFile name for name (this Node)', async (t) => {
  const root = scratch(t), log = path.join(root, '..', `${path.basename(root)}.log`);
  t.after(() => fs.rmSync(log, { force: true }));
  put(root, [...MATCH, ...SKIP]);
  const child = spawn(process.execPath, ['--test', '--test-reporter=dot'], { cwd: root, env: envFor(log), stdio: 'ignore' });
  const [code] = await once(child, 'close');
  assert.equal(code, 0);
  // Linux matches case-sensitively, macOS not: every name here is lower case, so both agree.
  assert.deepEqual(ran(log), selectTests(walk(root)).sort());
  assert.deepEqual(ran(log), [...MATCH].sort());
});

test('selection keeps the new, drops the ignored: a fake git that omits ignored paths only under --exclude-standard', () => {
  const ignored = ['release/4.0.6/glaze/website/server/relay.test.mjs'];
  const clean = ['test/a.test.js', 'test/helpers/h.cjs', 'test/new-untracked.test.js', 'extension/x.js', 'docs/a.md', 'test/fixtures/d.json'];
  const calls = [];
  const run = (cmd, args, opts) => {
    calls.push([cmd, ...args]);
    assert.equal(cmd, 'git');
    return [...clean, ...(args.includes('--exclude-standard') ? [] : ignored)].join('\0') + '\0';
  };
  const files = gitFiles('/repo', run, () => true);
  assert.deepEqual(calls, [['git', 'ls-files', '-z', '-c', '-o', '--exclude-standard']]);
  assert.deepEqual(selectTests(files), ['test/a.test.js', 'test/helpers/h.cjs', 'test/new-untracked.test.js']);
  assert.deepEqual(selectTests([...files, ...ignored]).filter((f) => f.startsWith('release/')), ignored, 'the pattern alone would take the release copy');
});

test('a file the index lists but the disk lost is not run, and a twice-listed one runs once', () => {
  const run = () => 'test/a.test.js\0test/a.test.js\0test/gone.test.js\0';
  const files = gitFiles('/repo', run, (p) => !p.endsWith('gone.test.js'));
  assert.deepEqual(selectTests(files), ['test/a.test.js']);
});

test('in a real git checkout: tracked and new tests run, the ignored release copy does not, a bare node --test would', async (t) => {
  const root = scratch(t), log = path.join(root, '..', `${path.basename(root)}.log`), bare = `${log}.bare`;
  t.after(() => { fs.rmSync(log, { force: true }); fs.rmSync(bare, { force: true }); });
  put(root, ['test/a.test.js', 'test/helpers/h.cjs', 'lib/b-test.js', 'release/1.0/website/server/c.test.mjs', 'test/new-untracked.test.js', 'docs/readme.md', 'test/fixtures/d.json']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'release/\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  // Everything but the new test is staged: tracked. release/ is ignored.
  execFileSync('git', ['add', '.gitignore', 'test/a.test.js', 'test/helpers/h.cjs', 'lib/b-test.js', 'docs/readme.md', 'test/fixtures/d.json'], { cwd: root });
  const bareRun = spawn(process.execPath, ['--test', '--test-reporter=dot'], { cwd: root, env: envFor(bare), stdio: 'ignore' });
  await once(bareRun, 'close');
  assert.ok(ran(bare).includes('release/1.0/website/server/c.test.mjs'), 'a bare node --test takes the ignored copy');
  const code = await main(['--test-reporter=dot'], { root, env: envFor(log), stdio: 'ignore' });
  assert.equal(code, 0);
  assert.deepEqual(ran(log), ['lib/b-test.js', 'test/a.test.js', 'test/helpers/h.cjs', 'test/new-untracked.test.js']);
});

test('extra arguments go to node --test before the files, from the repo root', async () => {
  const calls = [];
  const child = Object.assign(new (require('node:events'))(), { kill() {} });
  const spawnFake = (cmd, args, opts) => { calls.push({ cmd, args, opts }); setImmediate(() => child.emit('close', 3, null)); return child; };
  const code = await main(['--test-name-pattern=drive', '--test-concurrency=2'], { root: '/repo', spawn: spawnFake, list: () => ['test/b.test.js', 'a/c-test.js', 'test/x.json'] });
  assert.equal(code, 3, 'node\'s exit status comes back');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, process.execPath);
  assert.deepEqual(calls[0].args, ['--test', '--test-name-pattern=drive', '--test-concurrency=2', 'a/c-test.js', 'test/b.test.js']);
  assert.equal(calls[0].opts.cwd, '/repo');
});

test('--no-strip-types is node\'s and also leaves the TypeScript names out', async () => {
  const calls = [];
  const child = Object.assign(new (require('node:events'))(), { kill() {} });
  const spawnFake = (cmd, args) => { calls.push(args); setImmediate(() => child.emit('close', 0, null)); return child; };
  await main(['--no-strip-types'], { root: '/repo', spawn: spawnFake, list: () => ['test/a.test.js', 'test/b.test.ts'] });
  assert.deepEqual(calls[0], ['--test', '--no-strip-types', 'test/a.test.js']);
});

test('a name with glob characters reaches node as that file', async (t) => {
  const root = scratch(t), log = path.join(root, '..', `${path.basename(root)}.log`);
  t.after(() => fs.rmSync(log, { force: true }));
  put(root, ['a[1].test.js', 'b (2).test.js', 'test-star*.js', 'plain.test.js', 'a1.test.js', 'x+(y).test.js', 'xy.test.js']);
  const code = await main(['--test-reporter=dot'], { root, env: envFor(log), stdio: 'ignore', list: () => ['a[1].test.js', 'b (2).test.js', 'test-star*.js', 'plain.test.js', 'a1.test.js', 'x+(y).test.js', 'xy.test.js'] });
  assert.equal(code, 0);
  assert.deepEqual(ran(log), ['a1.test.js', 'a[1].test.js', 'b (2).test.js', 'plain.test.js', 'test-star*.js', 'x+(y).test.js', 'xy.test.js']);
  // Each file once: a[1] did not also take a1, nor x+(y) take xy.
  assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 7);
});

test('no test files is an error, not a green run', async () => {
  await assert.rejects(main([], { root: '/repo', list: () => ['docs/a.md'] }), /no test files/);
});

test('suite.js finds this checkout\'s tests, and not the ones git ignores', () => {
  const files = selectTests(gitFiles(path.join(__dirname, '../..')));
  assert.ok(files.includes('test/release/suite.test.js'));
  assert.ok(files.length > 600);
  assert.ok(!files.some((f) => f.startsWith('release/')));
});
