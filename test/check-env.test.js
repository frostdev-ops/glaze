// The browser checks must start on any machine: their lock lives under the OS temp directory (or GLAZE_LOCK) and their
// Chromium is CHROME, else the one Playwright installed, never a path from one Mac.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scripts = path.join(root, 'scripts');
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-check-env-'));

test('the lock defaults to the OS temp directory and GLAZE_LOCK overrides it', () => {
  const { lockPath } = require('../scripts/check-env.js');
  const tmp = scratch();
  try {
    assert.equal(lockPath({}, tmp), path.join(tmp, 'glaze-heavy.lock'));
    const own = path.join(tmp, 'elsewhere', 'my.lock');
    assert.equal(lockPath({ GLAZE_LOCK: own }, tmp), own);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.equal(lockPath({}), path.join(os.tmpdir(), 'glaze-heavy.lock'));
});

test('taking the lock works when its parent directory does not exist yet, and a second holder is refused', () => {
  const { lockPath } = require('../scripts/check-env.js');
  const tmp = scratch();
  try {
    const lock = lockPath({ GLAZE_LOCK: path.join(tmp, 'a', 'b', 'heavy.lock') });
    fs.mkdirSync(lock); // what the checks do: only an existing lock may fail this
    assert.throws(() => fs.mkdirSync(lock), { code: 'EEXIST' });
    fs.rmSync(lock, { recursive: true });
    fs.mkdirSync(lock);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('CHROME picks the browser; otherwise Playwright launches its own full Chromium', () => {
  const { chromePath, chromeLaunch } = require('../scripts/check-env.js');
  assert.equal(chromePath({ CHROME: '/opt/chrome/chrome' }), '/opt/chrome/chrome');
  assert.equal(chromePath({}), undefined);
  assert.equal(chromePath({ CHROME: '' }), undefined);
  assert.deepEqual(chromeLaunch({ CHROME: '/opt/chrome/chrome' }), { executablePath: '/opt/chrome/chrome' });
  // Not the headless shell that headless:true alone picks: the checks load the extension.
  assert.deepEqual(chromeLaunch({}), { channel: 'chromium' });
});

test('no script hard-codes one machine\'s lock directory or Chromium build', () => {
  const offenders = [];
  for (const file of fs.readdirSync(scripts).filter((f) => /\.(js|mjs|sh|py|html)$/.test(f))) {
    const lines = fs.readFileSync(path.join(scripts, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/claude-\d{3}|ms-playwright\/chromium-\d+|chrome-mac-arm64/.test(line)) offenders.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('the checks that take the lock get its path from the shared helper', () => {
  const holders = fs.readdirSync(scripts).filter((f) => /-check\.js$/.test(f) && /\bmkdirSync\(lock\)/.test(fs.readFileSync(path.join(scripts, f), 'utf8')));
  assert.ok(holders.length >= 3, holders.join(', '));
  for (const file of holders) assert.match(fs.readFileSync(path.join(scripts, file), 'utf8'), /\block\s*=\s*require\('\.\/check-env\.js'\)\.lockPath\(\)/, file);
});

test('the checks that launch Chromium resolve it through the shared helper', () => {
  const launchers = fs.readdirSync(scripts).filter((f) => /\.js$/.test(f) && /chromium\.(?:launch|launchPersistentContext)\(/.test(fs.readFileSync(path.join(scripts, f), 'utf8')));
  assert.ok(launchers.length >= 40, String(launchers.length));
  for (const file of launchers) {
    const source = fs.readFileSync(path.join(scripts, file), 'utf8');
    assert.match(source, /require\('\.\/check-env\.js'\)\.(?:chromeLaunch|chromePath)\(\)|process\.env\.CHROME \?/, file);
    assert.doesNotMatch(source, /os\.homedir\(\)[^\n]*(?:Library|\.cache)[^\n]*(?:chrom|playwright)/i, file);
  }
});

test('the Chromium search of the scene check also looks in Playwright\'s Linux cache', () => {
  assert.match(fs.readFileSync(path.join(scripts, 'scene-check.mjs'), 'utf8'), /\.cache\/ms-playwright/);
});

test('the development guide names no machine-specific path and documents the overrides', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/development.md'), 'utf8');
  assert.doesNotMatch(doc, /claude-\d{3}|\/private\/tmp/);
  assert.match(doc, /GLAZE_LOCK/);
  assert.match(doc, /`CHROME`/);
});
