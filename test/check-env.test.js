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

// Chrome's manifest holds each LMS's own hosts only; a school's own host is the student's grant, which headless can't give.
test('a staged copy holds the hosts named, links every other file, leaves the source alone and goes at exit', () => {
  const tmp = scratch();
  try {
    const src = path.join(tmp, 'src');
    fs.mkdirSync(path.join(src, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(src, '.git'));
    const manifest = { name: 'Glaze', host_permissions: ['https://*.instructure.com/*'] };
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(src, 'lib', 'a.js'), 'a');
    const script = `const d = require(${JSON.stringify(path.join(scripts, 'check-env.js'))}).staged(${JSON.stringify(src)}, ['https://bb.school.test/*', 'https://*.instructure.com/*'], ${JSON.stringify(tmp)});
      const fs = require('fs'), path = require('path');
      console.log(JSON.stringify({ d, m: JSON.parse(fs.readFileSync(path.join(d, 'manifest.json'), 'utf8')), same: fs.statSync(path.join(d, 'lib/a.js')).ino === fs.statSync(${JSON.stringify(path.join(src, 'lib/a.js'))}).ino, git: fs.existsSync(path.join(d, '.git')) }));`;
    const r = JSON.parse(require('node:child_process').execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
    assert.deepEqual(r.m.host_permissions, ['https://*.instructure.com/*', 'https://bb.school.test/*']);
    assert.equal(r.d, fs.realpathSync(path.dirname(r.d)) + path.sep + path.basename(r.d), 'a real path: Chrome derives the id from it');
    assert.deepEqual([r.same, r.git], [true, false]);
    assert.ok(!fs.existsSync(r.d), 'removed when the check exits');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')), manifest);
    assert.equal(fs.readFileSync(path.join(src, 'lib', 'a.js'), 'utf8'), 'a');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('the checks that load Glaze on a school\'s own host give it a staged copy holding that host', () => {
  const own = fs.readdirSync(scripts).filter((f) => /\.js$/.test(f)).filter((f) => {
    const src = fs.readFileSync(path.join(scripts, f), 'utf8');
    return /--load-extension=/.test(src) && /'https:\/\/[\w.-]+\.(?:school|moodle)\.test'?/.test(src) && !/writeFileSync\(path\.join\(ext, 'manifest\.json'\)/.test(src);
  });
  assert.ok(own.length >= 15, own.join(', '));
  for (const f of own) assert.match(fs.readFileSync(path.join(scripts, f), 'utf8'), /require\('\.\/check-env\.js'\)\.staged\(/, f);
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

test('school-host readiness waits for Ultra registration, with static entries and ports respected', async () => {
  const { ultraReady } = require('../scripts/check-env.js');
  assert.equal(typeof ultraReady, 'function', 'a stored approval must not race the first navigation');
  let predicate;
  await ultraReady({ evaluate: async (fn) => { predicate = fn; return true; } });
  const vm = require('node:vm');
  let matches = ['https://*.blackboard.com/ultra', 'https://*.blackboard.com/ultra/*'], registered = [];
  const context = vm.createContext({ URL, chrome: {
    runtime: { getManifest: () => ({ content_scripts: [{ js: ['content-ultra.js'], matches }] }) },
    storage: { local: { get: async () => ({ ultra: ['https://bb.school.test:8443'] }) } },
    scripting: { getRegisteredContentScripts: async () => registered },
  } });
  const ready = () => vm.runInContext(`(${predicate.toString()})()`, context);
  assert.equal(await ready(), false, 'the local write is visible before the worker registers it');
  registered = [{ js: ['content-canvas.js'], matches: ['https://bb.school.test/*'] }];
  assert.equal(await ready(), false, 'another LMS bundle does not make Ultra ready');
  registered.push({ js: ['content-ultra.js'], matches: ['https://bb.school.test/ultra', 'https://bb.school.test/ultra/*'] });
  assert.equal(await ready(), true, 'the portless registration covers the approved port');
  registered = []; matches = ['https://*/ultra', 'https://*/ultra/*'];
  assert.equal(await ready(), true, 'Safari has its static entry already');
});

test('Ultra readiness polls resolved async state instead of treating a predicate Promise as ready', async () => {
  const { ultraReady } = require('../scripts/check-env.js');
  let probes = 0;
  await ultraReady({ waitForFunction: async () => {}, evaluate: async () => ++probes > 1 });
  assert.equal(probes, 2, 'wait for the registration result, then poll until it is ready');
});

test('the first-load glass and background checks wait for their listed Ultra fixture', () => {
  for (const name of ['glass-remaining', 'background-pages']) assert.match(fs.readFileSync(path.join(scripts, `${name}-check.js`), 'utf8'), /await require\('\.\/check-env\.js'\)\.ultraReady\(opts\)/, name);
});

test('a check that wants only its own tabs closes Glaze\'s first screen, open already or opening later', async () => {
  const { noFirstRun } = require('../scripts/check-env.js');
  const welcome = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/features/welcome.html';
  const tab = (url, later) => {
    const p = { at: url, closed: false, url: () => p.at, close: async () => { p.closed = true; } };
    p.waitForURL = async (re) => { await later; if (!re.test(p.at)) throw Error('timeout'); };
    return p;
  };
  let landOpen;
  const open = [tab(welcome), tab('about:blank', new Promise((r) => { landOpen = r; }))];
  let onPage;
  noFirstRun({ pages: () => open, on: (e, f) => { if (e === 'page') onPage = f; } });
  let land;
  const late = tab('about:blank', new Promise((r) => { land = r; })), mine = tab('https://bb.school.test/ultra/');
  onPage(late);
  onPage(mine);
  late.at = welcome;
  open[1].at = welcome;
  landOpen();
  land();
  await new Promise(setImmediate);
  assert.deepEqual([...open, late, mine].map((p) => p.closed), [true, true, true, false]);
});

test('noFirstRun says when it has closed Glaze\'s first screen, so a check can start after the install\'s tab', async () => {
  const { noFirstRun } = require('../scripts/check-env.js');
  const welcome = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/features/welcome.html';
  let onPage, closed = false, land;
  const closing = noFirstRun({ pages: () => [], on: (e, f) => { if (e === 'page') onPage = f; } });
  assert.equal(typeof closing?.then, 'function', 'a promise of the first screen closed');
  closing.then(() => { closed = true; });
  const tab = { at: 'about:blank', url: () => tab.at, close: async () => { tab.gone = true; }, waitForURL: async (re) => { await new Promise((r) => { land = r; }); if (!re.test(tab.at)) throw Error('timeout'); } };
  onPage(tab);
  await new Promise(setImmediate);
  assert.equal(closed, false, 'not before the first screen opens');
  tab.at = welcome; land();
  await closing;
  assert.equal(tab.gone, true);
});

test('ultraReady polls the page until Glaze has registered its Ultra script, and says so when it never does', async () => {
  const { ultraReady } = require('../scripts/check-env.js');
  const answers = [false, false, true];
  const page = { evaluate: async (f) => { assert.equal(typeof f, 'function'); return answers.shift(); } };
  await ultraReady(page);
  assert.deepEqual(answers, []);
  await assert.rejects(ultraReady({ evaluate: async () => false }, 250), /not registered/);
});

test('installed polls a new profile until each install task has made its last write, and says so when one never does', async () => {
  const { installed } = require('../scripts/check-env.js');
  const vm = require('node:vm');
  const done = { fresh: true, pending: false };
  const states = [{}, { freshDefaults: { fresh: true, pending: true } }, { freshDefaults: done, migrated: ['tabs-auto'] }, { freshDefaults: done, channelKeysMoved: true },
    { freshDefaults: done, migrated: ['tabs-auto'], channelKeysMoved: true }];
  let polls = 0;
  const page = { evaluate: async (f) => {
    const local = states[Math.min(polls++, states.length - 1)];
    return vm.runInContext(`(${f})()`, vm.createContext({ chrome: { storage: { local: { get: async () => local } } } }));
  } };
  await installed(page);
  assert.equal(polls, states.length, 'ready at the last write, not before');
  await assert.rejects(installed({ evaluate: async () => false }, 250), /install/);
});

test('the backup check lets each new profile finish installing before it seeds or compares storage', () => {
  assert.match(fs.readFileSync(path.join(scripts, 'backup-check.js'), 'utf8'), /await env\.installed\(page\)/);
});

test('the popup check starts after the install and its first screen, and reads the popup once its row has settled', () => {
  const source = fs.readFileSync(path.join(scripts, 'popup-check.js'), 'utf8');
  assert.match(source, /await env\.installed\(sw\)/);
  assert.match(source, /await welcomed/);
  assert.match(source, /hasAttribute\('data-settled'\)/);
  assert.doesNotMatch(source, /pause\(([2-9]\d{2}|\d{4,})\)/, 'no fixed waits stand in for the browser');
});

test('the Sites check starts after the install and its first screen, and reads each state once it has landed', () => {
  const source = fs.readFileSync(path.join(scripts, 'sites-check.js'), 'utf8');
  assert.match(source, /await env\.installed\(sw\)/);
  assert.match(source, /await welcomed/);
  assert.doesNotMatch(source, /pause\(([2-9]\d{2}|\d{4,})\)/, 'no fixed waits stand in for the page');
});
