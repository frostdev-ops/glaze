// The browser gate's helpers: scripts/ci-chromium.js (the installed Chromium against ci/chromium.pins) and
// scripts/ci-browser-checks.js (each check under a time limit that also stops what it started).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('../scripts/ci-chromium.js');
const { run } = require('../scripts/ci-browser-checks.js');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const tree = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ci-tree-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    if (typeof body === 'object') fs.symlinkSync(body.link, path.join(dir, rel)); else fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
};
const base = { 'chrome-linux64/chrome': 'elf', 'chrome-linux64/locales/en-US.pak': 'pak', INSTALLATION_COMPLETE: '' };

test('the tree hash covers every path, byte and link, but not the markers Playwright writes beside the build', (t) => {
  const dirs = [];
  const hash = (files) => { const d = tree(files); dirs.push(d); return C.treeHash(d); };
  t.after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
  const h = hash(base);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hash({ ...base, DEPENDENCIES_VALIDATED: '' }), h);
  assert.notEqual(hash({ ...base, 'chrome-linux64/chrome': 'elf!' }), h);
  assert.notEqual(hash({ ...base, 'chrome-linux64/extra': '' }), h);
  assert.notEqual(hash({ ...base, 'chrome-linux64/INSTALLATION_COMPLETE': '' }), h, 'only the top-level markers are left out');
  assert.notEqual(hash({ ...base, 'chrome-linux64/lib': { link: 'chrome' } }), hash({ ...base, 'chrome-linux64/lib': { link: 'locales' } }));
  assert.throws(() => hash({ INSTALLATION_COMPLETE: '' }), /holds no files/);
});

test('a pin must match the installed build, version, platform and hash', () => {
  const hash = 'a'.repeat(64), pins = `# comment\nchromium-1243 153.0.8010.12 linux-x64 ${hash}\n`;
  assert.doesNotThrow(() => C.check(`chromium-1243 153.0.8010.12 linux-x64 ${hash}`, pins));
  assert.throws(() => C.check(`chromium-1243 153.0.8010.12 linux-x64 ${'b'.repeat(64)}`, pins), /hashes to b+, pinned a+/);
  assert.throws(() => C.check(`chromium-1243 153.0.8010.13 linux-x64 ${hash}`, pins), /is version 153\.0\.8010\.13, pinned as 153\.0\.8010\.12/);
  assert.throws(() => C.check(`chromium-1244 154.0.1.1 linux-x64 ${hash}`, pins), /no pin for chromium-1244 on linux-x64/);
  assert.throws(() => C.check(`chromium-1243 153.0.8010.12 linux-arm64 ${hash}`, pins), /no pin for chromium-1243 on linux-arm64/);
  assert.throws(() => C.parsePins('chromium-1243 153.0.8010.12 linux-x64 abc'), /bad pin/);
  assert.throws(() => C.parsePins(`${pins}${pins}`), /pinned twice/);
});

test('ci/chromium.pins pins the gate\'s Linux runner', () => {
  const pins = C.parsePins(fs.readFileSync(path.join(__dirname, '../ci/chromium.pins'), 'utf8'));
  assert.ok([...pins.keys()].some((k) => k.endsWith(' linux-x64')));
  assert.equal(new Set([...pins.keys()].map((k) => k.split(' ')[0])).size, 1, 'one Chromium build, the pinned playwright-core\'s');
});

test('without PLAYWRIGHT_BROWSERS_PATH the Chromium check refuses to guess', () => {
  assert.throws(() => C.installed({}), /set PLAYWRIGHT_BROWSERS_PATH/);
});

test('a check over its time limit fails, and its whole process group is stopped', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ci-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'slow-check.js'), pidFile = path.join(dir, 'grandchild');
  fs.writeFileSync(script, `const { spawn } = require('node:child_process');
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid));
console.log('started'); setInterval(() => {}, 1000);`);
  const result = await run({ name: 'slow', script, args: () => [] }, dir, path.join(dir, 'lock'), 1500);
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.match(fs.readFileSync(path.join(dir, 'slow.log'), 'utf8'), /started/);
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
  const alive = () => { try { process.kill(grandchild, 0); return true; } catch { return false; } };
  for (let i = 0; i < 50 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(), false, 'what the check started (its browser) is stopped too');
});

test('a passing check passes, with its own lock and evidence directory', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ci-run-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'quick-check.js');
  fs.writeFileSync(script, 'console.log(process.env.GLAZE_LOCK, process.argv[2], process.env.EXTRA);');
  const result = await run({ name: 'quick', script, args: (d) => [d], env: () => ({ EXTRA: 'x' }) }, dir, path.join(dir, 'lock-0'));
  assert.deepEqual([result.code, result.timedOut], [0, false]);
  assert.equal(fs.readFileSync(path.join(dir, 'quick.log'), 'utf8').trim(), `${path.join(dir, 'lock-0')} ${path.join(dir, 'quick')} x`);
  assert.ok(fs.statSync(path.join(dir, 'quick')).isDirectory());
});


const alive = (pid) => {
  try { process.kill(pid, 0); return !/^Z/.test(require('node:child_process').execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).trim()); }
  catch { return false; }
};
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail('fixture did not become ready');
};

// Stand-ins exercise the command's startup and shutdown without launching a browser or taking the shared lock.
const gate = (t, { corrupt = '', env = {} } = {}) => {
  const dir = tree({
    'node_modules/playwright-core/package.json': '{"name":"playwright-core"}',
    'node_modules/playwright-core/browsers.json': JSON.stringify({ browsers: [
      { name: 'chromium', revision: '1243', browserVersion: '153.0.8010.12' }, { name: 'ffmpeg', revision: '1011' },
    ] }),
    'browsers/chromium-1243/chrome': 'chromium', 'browsers/chromium-1243/INSTALLATION_COMPLETE': '',
    'browsers/ffmpeg-1011/ffmpeg': 'ffmpeg', 'browsers/ffmpeg-1011/INSTALLATION_COMPLETE': '',
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.mkdirSync(path.join(dir, 'ci'));
  for (const name of ['ci-browser-checks.js', 'ci-chromium.js', 'check-env.js']) fs.copyFileSync(path.join(__dirname, '../scripts', name), path.join(dir, 'scripts', name));
  for (const [name, rev, version] of [['chromium', '1243', '153.0.8010.12'], ['ffmpeg', '1011', '-']]) {
    const build = `${name}-${rev}`, hash = C.treeHash(path.join(dir, 'browsers', build));
    fs.writeFileSync(path.join(dir, 'ci', `${name}.pins`), `${build} ${version} ${process.platform}-${process.arch} ${hash}\n`);
    if (corrupt === name) fs.appendFileSync(path.join(dir, 'browsers', build, name === 'chromium' ? 'chrome' : name), '!');
  }
  for (const { script } of require('../scripts/ci-browser-checks.js').CHECKS) fs.writeFileSync(path.join(dir, 'scripts', script), "console.log('CHECK STARTED');");
  const childEnv = { ...process.env, NODE_PATH: path.join(dir, 'node_modules'), PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'browsers'), GLAZE_LOCK: path.join(dir, 'shared.lock') };
  for (const key of ['CHROME', 'IA_CASE', 'EXT']) delete childEnv[key];
  return { dir, args: [path.join(dir, 'scripts/ci-browser-checks.js'), path.join(dir, 'out')], env: { ...childEnv, ...env } };
};

for (const corrupt of ['chromium', 'ffmpeg']) test(`the gate refuses a changed ${corrupt} before starting any check`, (t) => {
  const f = gate(t, { corrupt });
  const result = spawnSync(process.execPath, f.args, { env: f.env, encoding: 'utf8', timeout: 10000 });
  assert.doesNotMatch(result.stdout, /CHECK STARTED/, 'no check may run before every binary matches its pin');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /hashes to .*pinned/);
});

for (const [key, value] of [['CHROME', '/tmp/unchecked-chrome'], ['IA_CASE', 'glass-parity'], ['EXT', '/tmp/another-checkout']]) {
  test(`the gate rejects the ${key} override instead of checking a different browser or subset`, (t) => {
    const f = gate(t, { env: { [key]: value } });
    const result = spawnSync(process.execPath, f.args, { env: f.env, encoding: 'utf8', timeout: 10000 });
    assert.doesNotMatch(result.stdout, /CHECK STARTED/);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(key));
  });
}

test('a timeout waits for a detached browser that ignores SIGTERM and removes its temporary profile', { skip: process.platform === 'win32' }, async (t) => {
  const dir = tree({}), pidFile = path.join(dir, 'browser'), tmpFile = path.join(dir, 'profile-root');
  let pid;
  t.after(() => { if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); });
  const script = path.join(dir, 'detached.js');
  fs.writeFileSync(script, `const fs = require('node:fs'), os = require('node:os');
const c = require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { detached: true, stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); fs.writeFileSync(${JSON.stringify(tmpFile)}, os.tmpdir());
setInterval(() => {}, 1000);`);
  const pending = run({ name: 'detached', script }, dir, path.join(dir, 'lock'), 1200);
  await waitFor(() => fs.existsSync(pidFile)); pid = Number(fs.readFileSync(pidFile));
  const result = await pending;
  assert.equal(result.timedOut, true);
  assert.equal(alive(pid), false, 'detached browser survived run()');
  assert.equal(fs.existsSync(fs.readFileSync(tmpFile, 'utf8')), false, 'the owned temporary profile is removed after the browser stops');
});

test('cancellation waits for detached children before releasing the shared lock', { skip: process.platform === 'win32' }, async (t) => {
  const f = gate(t), pidFile = path.join(f.dir, 'browser');
  fs.writeFileSync(path.join(f.dir, 'scripts/settings-ia-check.js'), `const c = require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { detached: true, stdio: 'ignore' });
setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)), 200); setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, f.args, { env: f.env, stdio: 'ignore' });
  let pid;
  t.after(() => { if (alive(child.pid)) child.kill('SIGKILL'); if (pid && alive(pid)) process.kill(pid, 'SIGKILL'); });
  const closed = once(child, 'exit');
  await waitFor(() => fs.existsSync(pidFile)); pid = Number(fs.readFileSync(pidFile));
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  const heldDuringCleanup = fs.existsSync(f.env.GLAZE_LOCK);
  await closed;
  assert.equal(alive(pid), false, 'cancellation left its detached browser alive');
  assert.equal(heldDuringCleanup, true, 'the shared lock must stay held during shutdown');
  assert.equal(fs.existsSync(f.env.GLAZE_LOCK), false);
});

test('settings has room for the narrow route sweep while the gate leaves time for setup and artifacts', () => {
  const { CHECKS, BUDGET } = require('../scripts/ci-browser-checks.js');
  const settings = CHECKS.find((c) => c.name === 'settings');
  assert.ok(settings.limit > 4 * 60 * 1000 && settings.limit <= 6 * 60 * 1000, 'settings needs more than the old four-minute allowance');
  assert.ok(BUDGET >= settings.limit && BUDGET <= 11 * 60 * 1000, 'the runner must finish before the fifteen-minute job limit');
});

test('the browser gate includes a portable backup within its existing total budget', () => {
  const { CHECKS, BUDGET } = require('../scripts/ci-browser-checks.js');
  assert.ok(CHECKS.some((c) => c.script === 'backup-check.js'));
  assert.equal(BUDGET, 11 * 60 * 1000);
});
