// The unit suite on the Mac: `node --test` over what a clean checkout would run, as the runner and CI do.
//   nice -n 19 taskpolicy -b node tools/dev/suite.js [node --test options, e.g. --test-name-pattern=drive]
// A bare `node --test` in a working copy also runs test files in ignored folders (release/<version>/…/website/server/*.test.mjs
// fail there). This takes `git ls-files -co --exclude-standard` (tracked, and new but not ignored), keeps what Node 26's default
// discovery would take, and hands Node those files from the repo root. A new test under test/release/ is ignored by .gitignore's
// `release/` until `git add -f`.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

// Node 26.12 and 26.13, doc/api/test.md "Running tests from the command line": these name patterns, then the same with cts, mts
// and ts unless --no-strip-types. Dot folders and files, and node_modules, are never searched. Matching is case-sensitive, as on
// Linux (macOS's own Node matches without case; no tracked file differs).
const NAMES = ['[^/]*\\.test', '[^/]*-test', '[^/]*_test', 'test-[^/]*', 'test'];
const patterns = (ext) => [...NAMES.map((n) => new RegExp(`(^|/)${n}\\.${ext}$`)), new RegExp(`(^|/)test/(.+/)?[^/]*\\.${ext}$`)];
const JS = patterns('(?:cjs|mjs|js)'), TS = patterns('(?:cts|mts|ts)');

const isTestFile = (rel, { strip = true } = {}) => {
  if (rel.split('/').some((s) => s.startsWith('.') || s === 'node_modules')) return false;
  return (strip ? [...JS, ...TS] : JS).some((re) => re.test(rel));
};
const selectTests = (files, options) => [...new Set(files)].filter((f) => isTestFile(f, options)).sort();

// Paths in the index or untracked and not ignored, that exist: an index entry whose file was deleted is not run.
const gitFiles = (root, run = execFileSync, exists = (p) => fs.existsSync(p)) => {
  const out = run('git', ['ls-files', '-z', '-c', '-o', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  return [...new Set(String(out).split('\0').filter(Boolean))].filter((f) => exists(path.join(root, f)));
};

// Node reads explicit file arguments as globs, and its globs take no backslash escapes: a special character goes in a bracket.
const escapeGlob = (p) => p.replace(/[[*?{}()]/g, '[$&]');

async function main(argv = process.argv.slice(2), deps = {}) {
  const { root = ROOT, list = gitFiles, spawn: start = spawn, env = process.env, stdio = 'inherit' } = deps;
  const files = selectTests(list(root), { strip: !argv.includes('--no-strip-types') });
  if (!files.length) throw new Error('no test files found');
  console.error(`suite: ${files.length} test files from ${root}`);
  const child = start(process.execPath, ['--test', ...argv, ...files.map(escapeGlob)], { cwd: root, env, stdio });
  const forward = (sig) => () => child.kill(sig);
  const handlers = ['SIGINT', 'SIGTERM'].map((s) => [s, forward(s)]);
  for (const [s, h] of handlers) process.on(s, h);
  try {
    return await new Promise((resolve) => {
      child.on('error', (e) => { console.error(`suite: ${e.message}`); resolve(1); });
      child.on('close', (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    });
  } finally { for (const [s, h] of handlers) process.off(s, h); }
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`suite: ${e.message}`); process.exitCode = 1; });
}

module.exports = { isTestFile, selectTests, gitFiles, main };
