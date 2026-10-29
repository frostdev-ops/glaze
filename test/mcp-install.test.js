// The glaze-mcp helper's setup, uninstall and doctor (mcp/): where each browser on each OS looks for a native host, the
// manifests and launchers setup writes, the Windows registry writes, extension ids, reruns, and what uninstall leaves
// alone. Every run gets a scratch HOME or LOCALAPPDATA and a fake runner, so nothing reaches the real ones.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { spawnSync } = require('node:child_process');

const PKG = path.join(__dirname, '..', 'mcp');
const B = require('../mcp/lib/browsers.js');
const IDS = require('../mcp/lib/ids.js');
const L = require('../mcp/lib/launcher.js');
const I = require('../mcp/lib/install.js');
const D = require('../mcp/lib/doctor.js');
const CLI = require('../mcp/bin/glaze-mcp.js');
const VERSION = require('../mcp/package.json').version;
const HOST = 'io.frostdev.glaze_mcp';
const STORE = 'jmmaeoajomodnbnlmdikjooalmcilooh';
const ORIGIN = `chrome-extension://${STORE}/`;
const DESCRIPTION = 'Lets AI apps on this computer use Glaze.';
const A = 'abcdefghijklmnopabcdefghijklmnop', Z = 'ponmlkjihgfedcbaponmlkjihgfedcba';
// Modes and sh launchers need a POSIX file system; on Windows (the CI job) those checks are skipped.
const POSIX = process.platform !== 'win32';
const K = (p) => `HKCU\\Software\\${p}\\NativeMessagingHosts\\${HOST}`;

const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-install-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const files = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();
// Every file under a folder with its bytes and mode, to compare one run with the next.
const tree = (dir) => Object.fromEntries(files(dir).map((f) => [f, [fs.readFileSync(path.join(dir, f), 'base64'), fs.statSync(path.join(dir, f)).mode]]));
const mode = (f) => fs.statSync(f).mode & 0o777;

// A registry kept in a Map, driven through the same reg.exe argv the real one gets, and `node --version` answered.
const runner = ({ nodeVersion = 'v22.11.0' } = {}) => {
  const keys = new Map(), calls = [];
  const missing = () => Object.assign(new Error('ERROR: The system was unable to find the specified registry key or value.'), { code: 1 });
  const run = async (file, args) => {
    calls.push([file, args]);
    if (/reg\.exe$/i.test(file)) {
      const [op, key] = args;
      if (op === 'add') { keys.set(key, args[args.indexOf('/d') + 1]); return { stdout: 'The operation completed successfully.\r\n', stderr: '' }; }
      if (op === 'delete') { if (!keys.delete(key)) throw missing(); return { stdout: 'The operation completed successfully.\r\n', stderr: '' }; }
      if (op === 'export') {
        if (!keys.has(key)) throw missing();
        const v = keys.get(key).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const text = `Windows Registry Editor Version 5.00\r\n\r\n[${key.replace(/^HKCU/, 'HKEY_CURRENT_USER')}]\r\n@="${v}"\r\n\r\n`;
        fs.writeFileSync(args[2], Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
        return { stdout: 'The operation completed successfully.\r\n', stderr: '' };
      }
    }
    if (args[0] === '--version') return { stdout: `${nodeVersion}\n`, stderr: '' };
    throw new Error(`unexpected run: ${file} ${args.join(' ')}`);
  };
  return { keys, calls, run, ops: (op) => calls.filter(([, a]) => a[0] === op).map(([, a]) => a) };
};

const mac = (home, over = {}) => ({ platform: 'darwin', env: { HOME: home }, node: '/opt/node/bin/node', src: PKG, run: runner().run, ...over });
const AS = (home) => path.join(home, 'Library', 'Application Support');
const win = (base, reg, over = {}) => ({
  platform: 'win32', env: { LOCALAPPDATA: path.join(base, 'Local'), APPDATA: path.join(base, 'Roaming'), SystemRoot: 'C:\\Windows' },
  node: 'C:\\Program Files\\nodejs\\node.exe', src: PKG, run: reg.run, ...over,
});
const REG = 'C:\\Windows\\System32\\reg.exe';
// A copy of the package that says it is another version.
const pkgAt = (t, version) => {
  const d = scratch(t);
  for (const f of ['bin', 'lib']) fs.cpSync(path.join(PKG, f), path.join(d, f), { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ ...json(path.join(PKG, 'package.json')), version }, null, 2));
  return d;
};

// ---- the package ------------------------------------------------------------------------------------------------------
test('the package is glaze-mcp: one bin, Node 18 and later, MIT license included, no dependencies', () => {
  const pkg = json(path.join(PKG, 'package.json'));
  assert.equal(pkg.name, 'glaze-mcp');
  assert.deepEqual(pkg.bin, { 'glaze-mcp': 'bin/glaze-mcp.js' });
  assert.deepEqual(pkg.engines, { node: '>=18' });
  assert.deepEqual(pkg.files, ['bin', 'lib', 'LICENSE']);
  assert.equal(pkg.license, 'MIT');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8'), /^MIT License/);
  assert.equal(fs.readFileSync(path.join(PKG, 'LICENSE'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'LICENSE'), 'utf8'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies']) assert.equal(k in pkg, false, k);
  const bin = fs.readFileSync(path.join(PKG, 'bin', 'glaze-mcp.js'), 'utf8');
  assert.equal(bin.split('\n')[0], '#!/usr/bin/env node');
  if (POSIX) assert.equal(mode(path.join(PKG, 'bin', 'glaze-mcp.js')) & 0o111, 0o111, 'the bin is executable');
  // Node's own modules and the package's files only.
  for (const f of files(PKG).filter((x) => x.endsWith('.js'))) {
    for (const [, name] of fs.readFileSync(path.join(PKG, f), 'utf8').matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(name.startsWith('.') || name.startsWith('node:') || builtinModules.includes(name), `${f} requires ${name}`);
    }
  }
});

// ---- where each browser looks -----------------------------------------------------------------------------------------
test('macOS: every browser\'s NativeMessagingHosts folder under Application Support, and Firefox\'s in Mozilla', () => {
  const home = '/Users/s';
  const at = (...p) => path.join(AS(home), ...p);
  const want = {
    chrome: 'Google/Chrome', 'chrome-beta': 'Google/Chrome Beta', 'chrome-dev': 'Google/Chrome Dev', 'chrome-canary': 'Google/Chrome Canary',
    chromium: 'Chromium', edge: 'Microsoft Edge', 'edge-beta': 'Microsoft Edge Beta', 'edge-dev': 'Microsoft Edge Dev',
    'edge-canary': 'Microsoft Edge Canary', brave: 'BraveSoftware/Brave-Browser', vivaldi: 'Vivaldi', arc: 'Arc/User Data',
  };
  const table = B.table('darwin', { HOME: home });
  assert.deepEqual(table.map((b) => b.id), [...Object.keys(want), 'firefox']);
  for (const [id, rel] of Object.entries(want)) {
    const b = table.find((x) => x.id === id);
    assert.deepEqual({ family: b.family, data: b.data, dir: b.dir }, { family: 'chromium', data: at(rel), dir: at(rel, 'NativeMessagingHosts') }, id);
    assert.equal(typeof b.name, 'string');
  }
  const ff = table.find((x) => x.id === 'firefox');
  assert.deepEqual({ family: ff.family, data: ff.data, dir: ff.dir, name: ff.name }, { family: 'firefox', data: at('Firefox'), dir: at('Mozilla', 'NativeMessagingHosts'), name: 'Firefox' });
  assert.deepEqual(B.folder('darwin', { HOME: home }), { root: at('glaze-mcp'), hosts: at('glaze-mcp', 'hosts') });
});

test('Linux: ~/.config (or CHROME_CONFIG_HOME, then XDG_CONFIG_HOME) for the Chromium family, ~/.mozilla for Firefox', () => {
  const home = '/home/s';
  const want = {
    chrome: 'google-chrome', 'chrome-beta': 'google-chrome-beta', 'chrome-dev': 'google-chrome-unstable', 'chrome-canary': 'google-chrome-canary',
    chromium: 'chromium', edge: 'microsoft-edge', 'edge-beta': 'microsoft-edge-beta', 'edge-dev': 'microsoft-edge-dev',
    brave: 'BraveSoftware/Brave-Browser', vivaldi: 'vivaldi',
  };
  for (const [env, base] of [[{ HOME: home }, path.join(home, '.config')], [{ HOME: home, XDG_CONFIG_HOME: '/x' }, '/x'],
    [{ HOME: home, XDG_CONFIG_HOME: '/x', CHROME_CONFIG_HOME: '/c' }, '/c'], [{ HOME: home, XDG_CONFIG_HOME: 'relative' }, path.join(home, '.config')]]) {
    const table = B.table('linux', env);
    assert.deepEqual(table.map((b) => b.id), [...Object.keys(want), 'firefox']);
    for (const [id, rel] of Object.entries(want)) {
      const b = table.find((x) => x.id === id);
      assert.deepEqual({ family: b.family, data: b.data, dir: b.dir }, { family: 'chromium', data: path.join(base, rel), dir: path.join(base, rel, 'NativeMessagingHosts') }, `${id} ${JSON.stringify(env)}`);
    }
    const ff = table.find((x) => x.id === 'firefox');
    assert.deepEqual({ data: ff.data, dir: ff.dir }, { data: path.join(home, '.mozilla', 'firefox'), dir: path.join(home, '.mozilla', 'native-messaging-hosts') });
  }
  assert.deepEqual(B.folder('linux', { HOME: home }), { root: path.join(home, '.local', 'share', 'glaze-mcp'), hosts: path.join(home, '.local', 'share', 'glaze-mcp', 'hosts') });
  assert.deepEqual(B.folder('linux', { HOME: home, XDG_DATA_HOME: '/d' }).root, path.join('/d', 'glaze-mcp'));
});

test('Windows: a key under HKCU\\Software per browser (Vivaldi and Brave also read Chrome\'s), data in LOCALAPPDATA', () => {
  const env = { LOCALAPPDATA: '/w/Local', APPDATA: '/w/Roaming' };
  const want = {
    chrome: ['Google/Chrome/User Data', ['Google\\Chrome']],
    'chrome-beta': ['Google/Chrome Beta/User Data', ['Google\\Chrome']],
    'chrome-dev': ['Google/Chrome Dev/User Data', ['Google\\Chrome']],
    'chrome-canary': ['Google/Chrome SxS/User Data', ['Google\\Chrome']],
    chromium: ['Chromium/User Data', ['Chromium']],
    edge: ['Microsoft/Edge/User Data', ['Microsoft\\Edge']],
    'edge-beta': ['Microsoft/Edge Beta/User Data', ['Microsoft\\Edge']],
    'edge-dev': ['Microsoft/Edge Dev/User Data', ['Microsoft\\Edge']],
    'edge-canary': ['Microsoft/Edge SxS/User Data', ['Microsoft\\Edge']],
    brave: ['BraveSoftware/Brave-Browser/User Data', ['BraveSoftware\\Brave-Browser', 'Google\\Chrome']],
    vivaldi: ['Vivaldi/User Data', ['Google\\Chrome']],
  };
  const table = B.table('win32', env);
  assert.deepEqual(table.map((b) => b.id), [...Object.keys(want), 'firefox']);
  for (const [id, [rel, keys]] of Object.entries(want)) {
    const b = table.find((x) => x.id === id);
    assert.deepEqual({ family: b.family, data: b.data, keys: b.keys }, { family: 'chromium', data: path.join('/w/Local', rel), keys: keys.map(K) }, id);
  }
  const ff = table.find((x) => x.id === 'firefox');
  assert.deepEqual({ family: ff.family, data: ff.data, keys: ff.keys }, { family: 'firefox', data: path.join('/w/Roaming', 'Mozilla', 'Firefox'), keys: [K('Mozilla')] });
  // Without APPDATA, Roaming beside Local.
  assert.equal(B.table('win32', { LOCALAPPDATA: '/w/Local' }).find((x) => x.id === 'firefox').data, path.join('/w/Roaming', 'Mozilla', 'Firefox'));
  assert.deepEqual(B.folder('win32', env), { root: path.join('/w/Local', 'glaze-mcp'), hosts: path.join('/w/Local', 'glaze-mcp', 'hosts') });
  assert.throws(() => B.folder('win32', {}), /LOCALAPPDATA/);
  assert.throws(() => B.folder('darwin', {}), /HOME/);
});

test('a browser counts as present when its data folder exists (a file there doesn\'t count)', (t) => {
  const home = scratch(t);
  mk(AS(home), 'Google', 'Chrome');
  mk(AS(home), 'BraveSoftware', 'Brave-Browser');
  mk(AS(home), 'Firefox');
  fs.writeFileSync(path.join(mk(AS(home)), 'Vivaldi'), '');
  assert.deepEqual(B.present(B.table('darwin', { HOME: home })).map((b) => b.id), ['chrome', 'brave', 'firefox']);
  assert.deepEqual(B.present(B.table('darwin', { HOME: path.join(home, 'nobody') })), []);
});

// ---- extension ids ----------------------------------------------------------------------------------------------------
test('ids: the store id, an unpacked folder\'s id as Chrome derives it, validation and the --extension-id/--dev flags', (t) => {
  assert.equal(IDS.STORE, STORE);
  assert.equal(IDS.FIREFOX, 'glaze@frostdev.io');
  // scripts/blocklist-check.js's derivation, and a fixed vector of it.
  const derive = (p) => [...crypto.createHash('sha256').update(p).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  for (const p of ['/Users/s/Projects/glaze', '/home/s/glaze ext/é']) assert.equal(IDS.devId(p), derive(p));
  assert.equal(IDS.devId('/Users/s/Projects/glaze'), derive('/Users/s/Projects/glaze'));
  assert.match(IDS.devId('/x'), /^[a-p]{32}$/);
  for (const ok of [STORE, A, Z]) assert.equal(IDS.valid(ok), true, ok);
  for (const bad of ['', STORE.slice(1), `${STORE}a`, STORE.toUpperCase(), 'q'.repeat(32), null, 7, `chrome-extension://${STORE}/`]) assert.equal(IDS.valid(bad), false, String(bad));

  const dir = scratch(t);
  const ext = mk(dir, 'glaze');
  const got = IDS.fromArgs(['--extension-id', A, `--extension-id=${Z}`, '--dev', ext, '--browser=chrome', 'x'], { platform: 'darwin' });
  assert.deepEqual(got, { ids: [A, Z, derive(ext)], rest: ['--browser=chrome', 'x'] });
  if (POSIX) {
    // Chrome names an unpacked folder by its real path.
    fs.symlinkSync(ext, path.join(dir, 'link'));
    assert.deepEqual(IDS.fromArgs([`--dev=${path.join(dir, 'link')}`], { platform: 'linux' }).ids, [derive(ext)]);
  }
  assert.throws(() => IDS.fromArgs(['--extension-id', 'nope']), /nope/);
  assert.throws(() => IDS.fromArgs(['--extension-id']), /--extension-id/);
  assert.throws(() => IDS.fromArgs(['--dev']), /--dev/);
  assert.throws(() => IDS.fromArgs(['--dev', path.join(dir, 'missing')], { platform: 'darwin' }), /missing/);
  assert.throws(() => IDS.fromArgs(['--dev', ext], { platform: 'win32' }), /--extension-id/);

  assert.deepEqual(IDS.merge([A, STORE], [Z, A, 'bad', null]), [STORE, A, Z]);
  assert.deepEqual(IDS.merge(), [STORE]);
  assert.deepEqual(IDS.fromManifest({ allowed_origins: [ORIGIN, `chrome-extension://${A}/`, 'chrome-extension://bad/', `chrome-extension://${Z}`, 3] }), [STORE, A]);
  assert.deepEqual(IDS.fromManifest(null), []);
  assert.equal(IDS.origin(A), `chrome-extension://${A}/`);
});

// ---- launchers --------------------------------------------------------------------------------------------------------
test('launchers: sh with absolute, quoted paths and exec; a .bat with CRLF, %* and its % doubled', () => {
  assert.equal(L.sh({ node: "/opt/o'k/node", script: '/a b/glaze-mcp.js', browser: 'brave' }),
    `#!/bin/sh\nexec '/opt/o'\\''k/node' '/a b/glaze-mcp.js' host --browser=brave "$@"\n`);
  const bat = L.bat({ node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\Users\\100%\\glaze-mcp\\0.1.0\\bin\\glaze-mcp.js', browser: 'edge' });
  // `& exit /b` on the same line: cmd reads a .bat line by line from where it left off, so a rewrite while a host runs
  // must leave nothing after the command for it to read.
  assert.equal(bat, '@echo off\r\n@setlocal DisableDelayedExpansion\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\100%%\\glaze-mcp\\0.1.0\\bin\\glaze-mcp.js" host --browser=edge %* & exit /b\r\n');
  assert.equal(/[^\r]\n/.test(bat), false, 'every line ends in CRLF');
  assert.equal(L.text('win32', { node: 'C:\\n.exe', script: 'C:\\s.js', browser: 'b' }), L.bat({ node: 'C:\\n.exe', script: 'C:\\s.js', browser: 'b' }));
  assert.equal(L.text('linux', { node: '/n', script: '/s', browser: 'b' }), L.sh({ node: '/n', script: '/s', browser: 'b' }));
  assert.equal(L.file('win32', '/h', 'chrome'), path.join('/h', 'chrome.bat'));
  assert.equal(L.file('darwin', '/h', 'chrome'), path.join('/h', 'chrome'));
  for (const o of [{ node: "/opt/o'k/node", script: '/a b/glaze-mcp.js', browser: 'brave' }, { node: 'C:\\n\\node.exe', script: 'C:\\100%\\g.js', browser: 'edge' }]) {
    assert.deepEqual(L.parse(L.sh(o)), o);
    assert.deepEqual(L.parse(L.bat(o)), o);
  }
  assert.equal(L.parse('#!/bin/sh\necho hi\n'), null);
  assert.throws(() => L.sh({ node: 'node', script: '/s', browser: 'b' }), /absolute/);
});

test('the sh launcher setup writes runs node on the copied script with host --browser and the browser\'s arguments', { skip: !POSIX }, async (t) => {
  const home = path.join(scratch(t), "Jo's home");
  mk(AS(home), 'Google', 'Chrome');
  // A stand-in for node that prints what it was given.
  const node = path.join(mk(home, 'node dir'), 'node');
  fs.writeFileSync(node, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  await I.setup(mac(home, { node }));
  const launcher = path.join(AS(home), 'glaze-mcp', 'hosts', 'chrome');
  const out = spawnSync(launcher, [ORIGIN], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.stdout.split('\n'), [path.join(AS(home), 'glaze-mcp', VERSION, 'bin', 'glaze-mcp.js'), 'host', '--browser=chrome', ORIGIN, '']);
});

test('launchers name node by the PATH entry that leads to it, so a Homebrew upgrade doesn\'t break them', { skip: !POSIX }, (t) => {
  const d = scratch(t);
  // A "Cellar" node, the stable link to it, and another node earlier in PATH that is a different file.
  const cellar = path.join(mk(d, 'Cellar', 'node', '26.0.0', 'bin'), 'node');
  fs.writeFileSync(cellar, '');
  const other = path.join(mk(d, 'other'), 'node');
  fs.writeFileSync(other, '');
  fs.symlinkSync(cellar, path.join(mk(d, 'bin'), 'node'));
  const env = { HOME: d, PATH: ['relative', path.join(d, 'missing'), path.join(d, 'other'), path.join(d, 'bin')].join(':') };
  assert.equal(I.stableNode(cellar, 'darwin', env), path.join(d, 'bin', 'node'));
  assert.equal(I.stableNode(cellar, 'darwin', { HOME: d, PATH: path.join(d, 'other') }), cellar);
  assert.equal(I.stableNode(cellar, 'darwin', { HOME: d }), cellar);
  // The default node is this one, named that way.
  fs.symlinkSync(process.execPath, path.join(mk(d, 'link'), 'node'));
  assert.equal(I.context({ platform: 'darwin', env: { HOME: d, PATH: path.join(d, 'link') } }).node, path.join(d, 'link', 'node'));
  assert.equal(I.context({ platform: 'darwin', env: { HOME: d, PATH: path.join(d, 'link') }, node: '/given/node' }).node, '/given/node');
});

// ---- setup ------------------------------------------------------------------------------------------------------------
test('setup on macOS: a versioned copy, one launcher and one manifest per present browser, Chromium and Firefox shapes', async (t) => {
  const home = scratch(t);
  mk(AS(home), 'Google', 'Chrome');
  mk(AS(home), 'Firefox');
  const r = await I.setup(mac(home));
  const root = path.join(AS(home), 'glaze-mcp');
  assert.deepEqual(r.browsers, ['chrome', 'firefox']);
  assert.equal(r.version, VERSION);
  assert.equal(r.root, root);
  assert.deepEqual(r.ids, [STORE]);
  const script = path.join(root, VERSION, 'bin', 'glaze-mcp.js');
  // The copy: bin, lib and package.json, byte for byte.
  const shipped = ['package.json', 'LICENSE', ...files(PKG).filter((f) => /^(bin|lib)[\\/]/.test(f))].sort();
  assert.deepEqual(files(path.join(root, VERSION)).filter((f) => f !== '.glaze-mcp-copy.json'), shipped);
  for (const f of shipped) assert.equal(fs.readFileSync(path.join(root, VERSION, f), 'utf8'), fs.readFileSync(path.join(PKG, f), 'utf8'), f);
  const chrome = path.join(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST}.json`);
  const firefox = path.join(AS(home), 'Mozilla', 'NativeMessagingHosts', `${HOST}.json`);
  assert.deepEqual(json(chrome), { name: HOST, description: DESCRIPTION, path: path.join(root, 'hosts', 'chrome'), type: 'stdio', allowed_origins: [ORIGIN] });
  assert.deepEqual(json(firefox), { name: HOST, description: DESCRIPTION, path: path.join(root, 'hosts', 'firefox'), type: 'stdio', allowed_extensions: ['glaze@frostdev.io'] });
  for (const b of ['chrome', 'firefox']) {
    const f = path.join(root, 'hosts', b);
    assert.equal(fs.readFileSync(f, 'utf8'), `#!/bin/sh\nexec '/opt/node/bin/node' '${script}' host --browser=${b} "$@"\n`);
    if (POSIX) assert.equal(mode(f), 0o755, b);
  }
  if (POSIX) for (const d of [root, path.join(root, 'hosts'), path.join(root, VERSION)]) assert.equal(mode(d), 0o700, d);
  assert.deepEqual([...r.wrote].sort(), [chrome, firefox, path.join(root, 'hosts', 'chrome'), path.join(root, 'hosts', 'firefox')].sort());
  // Nothing for browsers that aren't there.
  assert.equal(fs.existsSync(path.join(AS(home), 'Microsoft Edge')), false);
  assert.equal(fs.existsSync(path.join(AS(home), 'Google', 'Chrome Beta')), false);
});

test('setup on Linux writes under ~/.config and ~/.mozilla; --browser names one whose folder isn\'t there yet', async (t) => {
  const home = scratch(t);
  mk(home, '.config', 'chromium');
  mk(home, '.mozilla', 'firefox');
  const ctx = { platform: 'linux', env: { HOME: home }, node: '/usr/bin/node', src: PKG, run: runner().run };
  const r = await I.setup(ctx);
  assert.deepEqual(r.browsers, ['chromium', 'firefox']);
  const root = path.join(home, '.local', 'share', 'glaze-mcp');
  assert.equal(json(path.join(home, '.config', 'chromium', 'NativeMessagingHosts', `${HOST}.json`)).path, path.join(root, 'hosts', 'chromium'));
  assert.equal(json(path.join(home, '.mozilla', 'native-messaging-hosts', `${HOST}.json`)).path, path.join(root, 'hosts', 'firefox'));
  const forced = await I.setup({ ...ctx, browsers: ['vivaldi'] });
  assert.deepEqual(forced.browsers, ['vivaldi']);
  assert.equal(json(path.join(home, '.config', 'vivaldi', 'NativeMessagingHosts', `${HOST}.json`)).path, path.join(root, 'hosts', 'vivaldi'));
  await assert.rejects(I.setup({ ...ctx, browsers: ['arc'] }), /arc.*chrome/s);
  // No browser at all: nothing is written.
  const empty = scratch(t);
  const none = await I.setup({ ...ctx, env: { HOME: empty } });
  assert.deepEqual(none.browsers, []);
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('setup on Windows: manifests and .bat launchers in LOCALAPPDATA, one reg.exe add per key, shared keys written once', async (t) => {
  const base = scratch(t);
  const local = path.join(base, 'Local');
  mk(local, 'Google', 'Chrome', 'User Data');
  mk(local, 'Microsoft', 'Edge', 'User Data');
  mk(local, 'BraveSoftware', 'Brave-Browser', 'User Data');
  mk(local, 'Vivaldi', 'User Data');
  mk(base, 'Roaming', 'Mozilla', 'Firefox');
  const reg = runner();
  const r = await I.setup(win(base, reg));
  const root = path.join(local, 'glaze-mcp'), hosts = path.join(root, 'hosts');
  assert.deepEqual(r.browsers, ['chrome', 'edge', 'brave', 'vivaldi', 'firefox']);
  // Chrome's key is Chrome's; Brave gets its own key; Vivaldi reads Chrome's.
  assert.deepEqual(reg.ops('add'), [
    ['add', K('Google\\Chrome'), '/ve', '/t', 'REG_SZ', '/d', path.join(hosts, 'chrome.json'), '/f'],
    ['add', K('Microsoft\\Edge'), '/ve', '/t', 'REG_SZ', '/d', path.join(hosts, 'edge.json'), '/f'],
    ['add', K('BraveSoftware\\Brave-Browser'), '/ve', '/t', 'REG_SZ', '/d', path.join(hosts, 'brave.json'), '/f'],
    ['add', K('Mozilla'), '/ve', '/t', 'REG_SZ', '/d', path.join(hosts, 'firefox.json'), '/f'],
  ]);
  assert.deepEqual(r.keys, [K('Google\\Chrome'), K('Microsoft\\Edge'), K('BraveSoftware\\Brave-Browser'), K('Mozilla')]);
  assert.deepEqual([...new Set(reg.calls.map(([f]) => f))], [REG]);
  const script = path.join(root, VERSION, 'bin', 'glaze-mcp.js');
  for (const b of ['chrome', 'edge', 'brave', 'firefox']) {
    const m = json(path.join(hosts, `${b}.json`));
    assert.equal(m.name, HOST);
    assert.equal(m.path, path.join(hosts, `${b}.bat`));
    assert.deepEqual(b === 'firefox' ? m.allowed_extensions : m.allowed_origins, b === 'firefox' ? ['glaze@frostdev.io'] : [ORIGIN]);
    assert.equal(fs.readFileSync(m.path, 'utf8'), `@echo off\r\n@setlocal DisableDelayedExpansion\r\n"C:\\Program Files\\nodejs\\node.exe" "${script}" host --browser=${b} %* & exit /b\r\n`);
  }
  assert.equal(fs.existsSync(path.join(hosts, 'vivaldi.json')), false);
  assert.equal(fs.existsSync(path.join(hosts, 'vivaldi.bat')), false);
  // Only Vivaldi: it takes Chrome's key itself.
  const solo = scratch(t);
  mk(solo, 'Local', 'Vivaldi', 'User Data');
  const reg2 = runner();
  await I.setup(win(solo, reg2));
  assert.deepEqual(reg2.ops('add').map((a) => [a[1], a[6]]), [[K('Google\\Chrome'), path.join(solo, 'Local', 'glaze-mcp', 'hosts', 'vivaldi.json')]]);
});

test('the registry runner is execFile on reg.exe with an argv, never a shell; doctor reaches nothing outside the computer', () => {
  // The code without its comments.
  const code = (f) => fs.readFileSync(path.join(PKG, 'lib', f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const src = code('install.js');
  assert.match(src, /execFile\(/);
  assert.doesNotMatch(src, /\bshell\s*:|\bexecSync\(|\bexec\(|\bspawn(Sync)?\(/);
  for (const f of ['install.js', 'doctor.js', 'browsers.js', 'ids.js', 'launcher.js']) {
    assert.doesNotMatch(code(f), /require\(['"](node:)?(net|http|https|http2|dgram|tls|dns)['"]\)|\bfetch\(/, f);
  }
  assert.doesNotMatch(code('doctor.js'), /child_process/);
});

// ---- ids kept across runs ---------------------------------------------------------------------------------------------
test('ids already in an installed manifest are kept, shared with browsers set up later, and invalid ones dropped', async (t) => {
  const home = scratch(t);
  mk(AS(home), 'Google', 'Chrome');
  const ctx = mac(home);
  const chrome = path.join(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST}.json`);
  assert.deepEqual((await I.setup({ ...ctx, ids: [A] })).ids, [STORE, A]);
  assert.deepEqual(json(chrome).allowed_origins, [ORIGIN, `chrome-extension://${A}/`]);
  await I.setup(ctx);
  assert.deepEqual(json(chrome).allowed_origins, [ORIGIN, `chrome-extension://${A}/`]);
  mk(AS(home), 'BraveSoftware', 'Brave-Browser');
  fs.writeFileSync(chrome, JSON.stringify({ ...json(chrome), allowed_origins: [...json(chrome).allowed_origins, 'chrome-extension://bad/', `chrome-extension://${Z}/`] }));
  await I.setup(ctx);
  const brave = path.join(AS(home), 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts', `${HOST}.json`);
  for (const f of [chrome, brave]) assert.deepEqual(json(f).allowed_origins, [ORIGIN, `chrome-extension://${A}/`], f);
  await assert.rejects(I.setup({ ...ctx, ids: ['nope'] }), /nope/);
});

// ---- reruns -----------------------------------------------------------------------------------------------------------
test('reruns: setup twice leaves the same files; ensure({ifNeeded}) writes nothing until the node path or version moves', async (t) => {
  const home = scratch(t);
  mk(AS(home), 'Google', 'Chrome');
  mk(AS(home), 'Firefox');
  const ctx = mac(home);
  const root = path.join(AS(home), 'glaze-mcp');
  await I.setup(ctx);
  const once = tree(home);
  await I.setup(ctx);
  assert.deepEqual(tree(home), once);
  const same = await I.ensure({ ...ctx, ifNeeded: true });
  assert.equal(same.changed, false);
  assert.deepEqual(same.wrote, []);
  assert.deepEqual(tree(home), once);

  // A new node: only the launchers change.
  const moved = await I.ensure({ ...ctx, node: '/usr/local/bin/node', ifNeeded: true });
  assert.equal(moved.changed, true);
  assert.deepEqual([...moved.wrote].sort(), [path.join(root, 'hosts', 'chrome'), path.join(root, 'hosts', 'firefox')].sort());
  assert.match(fs.readFileSync(path.join(root, 'hosts', 'chrome'), 'utf8'), /^exec '\/usr\/local\/bin\/node' /m);

  // A new version: a new copy beside the old one, and the launchers move to it.
  const v1 = pkgAt(t, '90.0.0'), v2 = pkgAt(t, '90.0.1');
  const up = await I.ensure({ ...ctx, src: v1, ifNeeded: true });
  assert.equal(up.version, '90.0.0');
  assert.ok(fs.readFileSync(path.join(root, 'hosts', 'chrome'), 'utf8').includes(`'${path.join(root, '90.0.0', 'bin', 'glaze-mcp.js')}'`));
  assert.equal(json(path.join(root, '90.0.0', 'package.json')).version, '90.0.0');
  assert.equal(fs.existsSync(path.join(root, VERSION, 'bin', 'glaze-mcp.js')), true, 'ensure keeps the old copy');
  // setup keeps the version it replaces and drops older ones.
  await I.setup({ ...ctx, src: v2 });
  assert.deepEqual(fs.readdirSync(root).filter((d) => /^\d/.test(d)).sort(), ['90.0.0', '90.0.1']);
  await I.setup({ ...ctx, src: v2 });
  assert.deepEqual(fs.readdirSync(root).filter((d) => /^\d/.test(d)).sort(), ['90.0.0', '90.0.1']);
  // Run from its own copy, it copies nothing.
  const own = await I.ensure({ ...ctx, src: path.join(root, '90.0.1'), ifNeeded: true });
  assert.equal(own.changed, false);
});

test('reruns on Windows: setup writes the same keys again; ensure({ifNeeded}) reads them and adds nothing', async (t) => {
  const base = scratch(t);
  mk(base, 'Local', 'Google', 'Chrome', 'User Data');
  const reg = runner();
  const ctx = win(base, reg);
  await I.setup(ctx);
  const once = tree(base);
  await I.setup(ctx);
  assert.deepEqual(tree(base), once);
  assert.equal(reg.ops('add').length, 2);
  const before = reg.calls.length;
  const same = await I.ensure({ ...ctx, ifNeeded: true });
  assert.equal(same.changed, false);
  assert.deepEqual(reg.calls.slice(before).map(([, a]) => a[0]), ['export']);
  // A key pointed elsewhere is put back; a path with non-ASCII letters reads back exactly (reg export is UTF-16).
  reg.keys.set(K('Google\\Chrome'), 'C:\\Users\\Jürgen\\other.json');
  await assert.rejects(I.ensure({ ...ctx, ifNeeded: true }), /own|refus/i);
  assert.equal(reg.keys.get(K('Google\\Chrome')), 'C:\\Users\\Jürgen\\other.json');
  reg.keys.set(K('Google\\Chrome'), 'C:\\Users\\Jürgen\\AppData\\Local\\glaze-mcp\\hosts\\chrome.json');
  assert.equal(await I.readKey(ctx, K('Google\\Chrome')), 'C:\\Users\\Jürgen\\AppData\\Local\\glaze-mcp\\hosts\\chrome.json');
  assert.equal(await I.readKey(ctx, K('Chromium')), null);
  // The export went to a temporary file that is gone again.
  for (const [, a] of reg.calls.filter(([, x]) => x[0] === 'export')) assert.equal(fs.existsSync(a[2]), false);
});

// ---- uninstall --------------------------------------------------------------------------------------------------------
test('uninstall removes only manifests that carry our host name and point into our folder, our launchers and copies', async (t) => {
  const home = scratch(t);
  for (const d of [['Google', 'Chrome'], ['BraveSoftware', 'Brave-Browser'], ['Firefox']]) mk(AS(home), ...d);
  const ctx = mac(home);
  await I.setup(ctx);
  const root = path.join(AS(home), 'glaze-mcp');
  const chromeDir = path.join(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts');
  const braveFile = path.join(AS(home), 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts', `${HOST}.json`);
  // Another app's host, our name pointing at a developer's checkout, a stray file and a run folder: all left alone.
  const keep = {
    [path.join(chromeDir, 'com.other.host.json')]: JSON.stringify({ name: 'com.other.host', path: path.join(root, 'hosts', 'chrome') }),
    [braveFile]: JSON.stringify({ name: HOST, path: '/Users/dev/glaze/mcp/bin/glaze-mcp.js', type: 'stdio', allowed_origins: [ORIGIN] }),
    [path.join(root, 'hosts', 'notes.txt')]: 'mine',
    [path.join(root, 'hosts', 'edge')]: '#!/bin/sh\necho not ours\n',
    [path.join(mk(root, 'run'), 'x')]: 'live',
  };
  for (const [f, text] of Object.entries(keep)) fs.writeFileSync(f, text);
  const r = await I.uninstall(ctx);
  for (const gone of [path.join(chromeDir, `${HOST}.json`), path.join(AS(home), 'Mozilla', 'NativeMessagingHosts', `${HOST}.json`),
    path.join(root, 'hosts', 'chrome'), path.join(root, 'hosts', 'brave'), path.join(root, 'hosts', 'firefox'), path.join(root, VERSION)]) {
    assert.equal(fs.existsSync(gone), false, gone);
  }
  for (const [f, text] of Object.entries(keep)) assert.equal(fs.readFileSync(f, 'utf8'), text, f);
  assert.ok(r.kept.includes(braveFile));
  assert.ok(r.removed.includes(path.join(chromeDir, `${HOST}.json`)));
  // Twice is fine, and removes nothing more.
  const again = await I.uninstall(ctx);
  assert.deepEqual(again.removed, []);
});

test('uninstall on Windows deletes only keys that point into our folder, and our manifests', async (t) => {
  const base = scratch(t);
  mk(base, 'Local', 'Google', 'Chrome', 'User Data');
  mk(base, 'Roaming', 'Mozilla', 'Firefox');
  const reg = runner();
  const ctx = win(base, reg);
  await I.setup(ctx);
  reg.keys.set(K('Chromium'), 'C:\\dev\\glaze\\host.json');
  const hosts = path.join(base, 'Local', 'glaze-mcp', 'hosts');
  fs.writeFileSync(path.join(hosts, 'other.json'), JSON.stringify({ name: 'com.other.host', path: path.join(hosts, 'chrome.bat') }));
  const r = await I.uninstall(ctx);
  assert.deepEqual(reg.ops('delete'), [['delete', K('Google\\Chrome'), '/ve', '/f'], ['delete', K('Mozilla'), '/ve', '/f']]);
  assert.deepEqual([...reg.keys], [[K('Chromium'), 'C:\\dev\\glaze\\host.json']]);
  assert.ok(r.kept.includes(K('Chromium')));
  assert.deepEqual(fs.readdirSync(hosts), ['other.json']);
});

// ---- doctor -----------------------------------------------------------------------------------------------------------
test('doctor: a clean setup passes; a missing launcher, an old node, loose folder modes or a missing store id fail', async (t) => {
  const home = scratch(t);
  mk(AS(home), 'Google', 'Chrome');
  mk(AS(home), 'Firefox');
  const ctx = mac(home, { node: process.execPath });
  const notSet = await D.run(ctx);
  assert.equal(notSet.ok, false);
  assert.match(D.text(notSet), /setup/);
  await I.setup(ctx);
  const clean = await D.run(ctx);
  assert.equal(clean.ok, true, D.text(clean));
  assert.ok(clean.rows.some((r) => r.level === 'ok' && /Google Chrome/.test(r.what)));
  assert.ok(clean.rows.some((r) => r.level === 'ok' && /Firefox/.test(r.what)));
  assert.match(D.text(clean), /v22\.11\.0/);

  const old = await D.run({ ...ctx, run: runner({ nodeVersion: 'v16.20.0' }).run });
  assert.equal(old.ok, false);
  assert.match(D.text(old), /16\.20\.0/);

  const live = await D.run({ ...ctx, live: async () => [{ level: 'fail', what: 'Live', detail: 'no host answered' }] });
  assert.equal(live.ok, false);
  assert.match(D.text(live), /no host answered/);

  const chrome = path.join(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST}.json`);
  const saved = fs.readFileSync(chrome, 'utf8');
  fs.writeFileSync(chrome, JSON.stringify({ ...JSON.parse(saved), allowed_origins: [`chrome-extension://${A}/`] }));
  assert.match(D.text(await D.run(ctx)), new RegExp(STORE));
  fs.writeFileSync(chrome, saved);

  if (POSIX) {
    fs.chmodSync(path.join(AS(home), 'glaze-mcp', 'hosts'), 0o777);
    const loose = await D.run(ctx);
    assert.equal(loose.ok, false);
    assert.match(D.text(loose), /hosts/);
    fs.chmodSync(path.join(AS(home), 'glaze-mcp', 'hosts'), 0o700);
  }
  fs.rmSync(path.join(AS(home), 'glaze-mcp', 'hosts', 'chrome'));
  const broken = await D.run(ctx);
  assert.equal(broken.ok, false);
  assert.ok(broken.rows.some((r) => r.level === 'fail' && /Google Chrome/.test(r.what)), D.text(broken));
  assert.ok(broken.rows.some((r) => r.level === 'ok' && /Firefox/.test(r.what)), D.text(broken));
});

test('doctor on Windows reads each key and follows it to our manifest', async (t) => {
  const base = scratch(t);
  mk(base, 'Local', 'Google', 'Chrome', 'User Data');
  const reg = runner();
  const ctx = win(base, reg, { node: process.execPath });
  await I.setup(ctx);
  const ok = await D.run(ctx);
  assert.equal(ok.ok, true, D.text(ok));
  assert.ok(reg.ops('export').some((a) => a[1] === K('Google\\Chrome')));
  reg.keys.delete(K('Google\\Chrome'));
  const gone = await D.run(ctx);
  assert.equal(gone.ok, false);
  assert.match(D.text(gone), /Google\\Chrome/);
});

// ---- the command ------------------------------------------------------------------------------------------------------
test('the command: agent by default; host from the browser\'s argv (Chromium, Windows --parent-window, Firefox)', () => {
  const M = CLI.mode;
  assert.deepEqual(M([], 'darwin'), { mode: 'agent', args: [] });
  assert.deepEqual(M(['--browser=chrome'], 'darwin'), { mode: 'agent', args: ['--browser=chrome'] });
  assert.deepEqual(M(['agent', '--from=mcpb'], 'darwin'), { mode: 'agent', args: ['--from=mcpb'] });
  assert.deepEqual(M([ORIGIN], 'darwin'), { mode: 'host', args: [ORIGIN], browser: null, caller: ORIGIN });
  assert.deepEqual(M([ORIGIN, '--parent-window=1234'], 'win32'), { mode: 'host', args: [ORIGIN, '--parent-window=1234'], browser: null, caller: ORIGIN });
  assert.notEqual(M([ORIGIN, '--parent-window=1234'], 'linux').mode, 'host');
  assert.notEqual(M([ORIGIN, 'x'], 'win32').mode, 'host');
  assert.notEqual(M(['chrome-extension://short/'], 'linux').mode, 'host');
  assert.notEqual(M([`chrome-extension://${STORE}`], 'linux').mode, 'host');
  const manifest = '/home/s/.mozilla/native-messaging-hosts/io.frostdev.glaze_mcp.json';
  assert.deepEqual(M([manifest, 'glaze@frostdev.io'], 'linux'), { mode: 'host', args: [manifest, 'glaze@frostdev.io'], browser: null, caller: 'glaze@frostdev.io' });
  assert.notEqual(M([manifest, 'other@example.com'], 'linux').mode, 'host');
  assert.deepEqual(M(['host', '--browser=chrome', ORIGIN], 'darwin'), { mode: 'host', args: ['--browser=chrome', ORIGIN], browser: 'chrome', caller: ORIGIN });
  assert.deepEqual(M(['host', '--browser=firefox', manifest, 'glaze@frostdev.io'], 'darwin').caller, 'glaze@frostdev.io');
  for (const m of ['setup', 'uninstall', 'doctor']) assert.deepEqual(M([m, '--x'], 'darwin'), { mode: m, args: ['--x'] });
  assert.equal(M(['--version'], 'darwin').mode, 'version');
  assert.equal(M(['--help'], 'darwin').mode, 'help');
  assert.equal(M(['bogus'], 'darwin').mode, 'unknown');
});

const io = (over = {}) => {
  const out = [], err = [];
  return { stdin: { isTTY: false }, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join(''), ...over };
};

test('setup and uninstall refuse symlinks in installation destinations without changing their targets', { skip: !POSIX }, async (t) => {
  for (const rel of ['', 'hosts', VERSION, path.join(VERSION, 'bin')]) {
    await t.test(rel || 'root', async (t) => {
      const home = scratch(t), outside = scratch(t), ctx = mac(home);
      mk(AS(home), 'Google', 'Chrome');
      const root = path.join(AS(home), 'glaze-mcp');
      const link = rel ? path.join(root, rel) : root;
      mk(path.dirname(link));
      fs.writeFileSync(path.join(outside, 'keep'), 'unrelated');
      fs.symlinkSync(outside, link, 'dir');
      const before = tree(outside), perms = mode(outside);
      await assert.rejects(I.setup(ctx), /symlink|symbolic/i);
      await assert.rejects(I.uninstall(ctx), /symlink|symbolic/i);
      assert.deepEqual(tree(outside), before);
      assert.equal(mode(outside), perms);
      assert.ok(fs.lstatSync(link).isSymbolicLink());
    });
  }
});

test('browser manifest directories and files cannot redirect setup or uninstall through a symlink', { skip: !POSIX }, async (t) => {
  for (const leaf of [false, true]) await t.test(String(leaf), async (t) => {
    const home = scratch(t), outside = scratch(t), ctx = mac(home);
    const dir = mk(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts');
    const f = path.join(dir, `${HOST}.json`);
    const target = path.join(outside, 'keep.json');
    fs.writeFileSync(target, JSON.stringify({ name: HOST, path: path.join(AS(home), 'glaze-mcp', 'hosts', 'chrome') }));
    if (leaf) fs.symlinkSync(target, f);
    else { fs.rmdirSync(dir); fs.symlinkSync(outside, dir, 'dir'); }
    const before = tree(outside);
    await assert.rejects(I.setup(ctx), /symlink|symbolic/i);
    await assert.rejects(I.uninstall(ctx), /symlink|symbolic/i);
    assert.deepEqual(tree(outside), before);
  });
});

test('setup refuses unrelated files occupying its launcher, manifest or version paths', async (t) => {
  for (const which of ['launcher', 'manifest', 'copy']) await t.test(which, async (t) => {
    const home = scratch(t), ctx = mac(home);
    const bdir = mk(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts');
    const root = mk(AS(home), 'glaze-mcp');
    let f;
    if (which === 'launcher') f = path.join(mk(root, 'hosts'), 'chrome');
    else if (which === 'manifest') f = path.join(bdir, `${HOST}.json`);
    else f = path.join(mk(root, VERSION), 'notes.txt');
    fs.writeFileSync(f, 'mine');
    await assert.rejects(I.setup(ctx), /own|unrelated|refus/i);
    assert.equal(fs.readFileSync(f, 'utf8'), 'mine');
  });
});

test('uninstall leaves script-shaped foreign files, version-shaped foreign packages and modified copies alone', async (t) => {
  const home = scratch(t), ctx = mac(home);
  mk(AS(home), 'Google', 'Chrome');
  await I.setup(ctx);
  const root = path.join(AS(home), 'glaze-mcp');
  const foreign = path.join(root, 'hosts', 'notes');
  fs.writeFileSync(foreign, L.sh({ node: '/usr/bin/node', script: '/outside/script.js', browser: 'chrome' }));
  const copy = mk(root, '9.9.9');
  fs.writeFileSync(path.join(copy, 'package.json'), JSON.stringify({ name: 'someone-else', version: '9.9.9' }));
  fs.writeFileSync(path.join(mk(copy, 'bin'), 'glaze-mcp.js'), 'mine');
  const note = path.join(root, VERSION, 'notes.txt');
  fs.writeFileSync(note, 'mine too');
  const saved = fs.readFileSync(foreign, 'utf8');
  await I.uninstall(ctx);
  assert.equal(fs.readFileSync(foreign, 'utf8'), saved);
  assert.equal(json(path.join(copy, 'package.json')).name, 'someone-else');
  assert.equal(fs.readFileSync(note, 'utf8'), 'mine too');
});

test('Windows setup preserves foreign registrations; uninstall requires its exact owned manifest and deletes only the default value', async (t) => {
  const base = scratch(t), reg = runner(), ctx = win(base, reg);
  mk(base, 'Local', 'Google', 'Chrome', 'User Data');
  reg.keys.set(K('Google\\Chrome'), 'C:\\dev\\manual.json');
  await assert.rejects(I.setup(ctx), /own|unrelated|refus/i);
  assert.equal(reg.keys.get(K('Google\\Chrome')), 'C:\\dev\\manual.json');
  assert.deepEqual(reg.ops('add'), []);
  reg.keys.delete(K('Google\\Chrome'));
  await I.setup(ctx);
  const foreign = path.join(base, 'Local', 'glaze-mcp', 'hosts', 'notes.json');
  fs.writeFileSync(foreign, JSON.stringify({ name: 'another.host', path: 'elsewhere' }));
  reg.keys.set(K('Chromium'), foreign);
  await I.uninstall(ctx);
  assert.equal(reg.keys.get(K('Chromium')), foreign);
  assert.deepEqual(reg.ops('delete'), [['delete', K('Google\\Chrome'), '/ve', '/f']]);
  assert.equal(json(foreign).name, 'another.host');
});

test('ids come only from explicit grants, never another manifest carrying our name', async (t) => {
  const home = scratch(t), ctx = mac(home);
  const chrome = path.join(mk(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts'), `${HOST}.json`);
  fs.writeFileSync(chrome, JSON.stringify({ name: HOST, path: '/developer/host', type: 'stdio', allowed_origins: [`chrome-extension://${Z}/`] }));
  mk(AS(home), 'Firefox');
  const r = await I.setup({ ...ctx, browsers: ['firefox'], ids: [A] });
  assert.deepEqual(r.ids, [STORE, A]);
  assert.equal(json(chrome).path, '/developer/host');
});

test('doctor reports a valid Chromium id that was never granted', async (t) => {
  const home = scratch(t), ctx = mac(home, { node: process.execPath });
  const dir = mk(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts');
  await I.setup({ ...ctx, ids: [A] });
  const file = path.join(dir, `${HOST}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...json(file), allowed_origins: [ORIGIN, `chrome-extension://${A}/`, `chrome-extension://${Z}/`] }));
  assert.equal((await D.run(ctx)).ok, false);
});

test('a shared Windows key can move between our browsers as they are installed', async (t) => {
  const base = scratch(t), reg = runner(), ctx = win(base, reg, { node: process.execPath });
  mk(base, 'Local', 'Vivaldi', 'User Data');
  await I.setup(ctx);
  mk(base, 'Local', 'Google', 'Chrome', 'User Data');
  await I.setup(ctx);
  assert.equal(reg.keys.get(K('Google\\Chrome')), path.join(base, 'Local', 'glaze-mcp', 'hosts', 'chrome.json'));
  assert.equal((await D.run({ ...ctx, node: process.execPath })).ok, true);
});

test('registry exports read only the requested key default, never a subkey default', async (t) => {
  const base = scratch(t), key = K('Google\\Chrome');
  const ctx = win(base, runner(), { run: async (_file, argv) => {
    fs.writeFileSync(argv[2], Buffer.from(`\ufeffWindows Registry Editor Version 5.00\r\n\r\n[${key.replace('HKCU', 'HKEY_CURRENT_USER')}]\r\n"named"="keep"\r\n\r\n[${key.replace('HKCU', 'HKEY_CURRENT_USER')}\\child]\r\n@="not the default"\r\n`, 'utf16le'));
    return {};
  } });
  assert.equal(await I.readKey(ctx, key), null);
});

test('registry executable must be an absolute System32 path even with a malformed SystemRoot', () => {
  for (const SystemRoot of ['relative', '\\Windows', 'C:Windows', 'C:\\Win"dows', 'C:\\Win\ndows']) {
    assert.throws(() => I.regExe({ env: { SystemRoot } }), /absolute|SystemRoot|invalid/i, SystemRoot);
  }
  assert.equal(I.regExe({ env: { SystemRoot: 'D:\\Win dows' } }), 'D:\\Win dows\\System32\\reg.exe');
});

test('batch launchers reject quote and line injection, preserve carets and percents, and disable delayed expansion', () => {
  for (const p of ['C:\\bad" & echo injected & "\\node.exe', 'C:\\bad\nnode.exe', 'C:\\bad\rnode.exe', 'C:\\bad\0node.exe']) {
    assert.throws(() => L.bat({ node: p, script: 'C:\\s.js', browser: 'chrome' }), /invalid|path|character/i);
    assert.throws(() => L.bat({ node: 'C:\\n.exe', script: p, browser: 'chrome' }), /invalid|path|character/i);
  }
  const o = { node: 'C:\\a ^ b\\node.exe', script: 'C:\\100% !name!\\s.js', browser: 'chrome' };
  const text = L.bat(o);
  assert.match(text, /setlocal DisableDelayedExpansion/i);
  assert.match(text, /"C:\\a \^ b\\node.exe"/);
  assert.match(text, /100%% !name!/);
  assert.ok(text.endsWith('%* & exit /b\r\n'));
  assert.deepEqual(L.parse(text), o);
});

test('doctor rejects unsafe folders before running a node path and rejects extra Firefox ids', { skip: !POSIX }, async (t) => {
  const home = scratch(t), calls = [], ctx = mac(home, { node: process.execPath, run: async (...args) => { calls.push(args); return { stdout: 'v18.20.8' }; } });
  mk(AS(home), 'Firefox');
  await I.setup(ctx);
  const root = path.join(AS(home), 'glaze-mcp');
  fs.chmodSync(root, 0o777);
  assert.equal((await D.run(ctx)).ok, false);
  assert.deepEqual(calls, []);
  fs.chmodSync(root, 0o700);
  const file = path.join(AS(home), 'Mozilla', 'NativeMessagingHosts', `${HOST}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...json(file), allowed_extensions: [IDS.FIREFOX, 'unasked@example.org'] }));
  assert.equal((await D.run(ctx)).ok, false);
});

test('--dev refuses a keyed manifest instead of granting a different path-derived id', (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ key: 'cHVibGljLWtleQ==' }));
  assert.throws(() => IDS.fromArgs(['--dev', dir], { platform: 'linux' }), /--extension-id/);
});

test('the command: --version, a TTY refused in host mode, and host and agent waiting for their steps', async () => {
  const bin = path.join(PKG, 'bin', 'glaze-mcp.js');
  const v = spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
  assert.equal(v.status, 0);
  assert.equal(v.stdout, `${VERSION}\n`);
  const tty = io({ stdin: { isTTY: true } });
  assert.equal(await CLI.main(['host', '--browser=chrome', ORIGIN], tty), 2);
  assert.match(tty.err(), /started by the browser/);
  assert.match(tty.err(), /glaze-mcp setup/);
  const bad = io();
  assert.equal(await CLI.main(['bogus'], bad), 2);
  assert.match(bad.err(), /Usage/);
  const help = io();
  assert.equal(await CLI.main(['--help'], help), 0);
  assert.match(help.out(), /glaze-mcp setup/);
  // Until the host and agent steps land, both say so and exit 2.
  for (const [file, args] of [['host.js', [ORIGIN]], ['agent.js', []]]) {
    if (fs.existsSync(path.join(PKG, 'lib', file))) continue;
    const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', input: '' });
    assert.equal(r.status, 2, file);
    assert.match(r.stderr, /not built yet/, file);
  }
});

test('the command: setup, doctor and uninstall through the same context, and their refusals', async (t) => {
  const home = scratch(t);
  const ctx = { platform: 'darwin', env: { HOME: home }, node: process.execPath, run: runner().run, src: PKG };
  const none = io(ctx);
  assert.equal(await CLI.main(['setup'], none), 1);
  assert.match(none.err(), /No supported browser/);
  mk(AS(home), 'Google', 'Chrome');
  mk(AS(home), 'Firefox');
  const unknown = io(ctx);
  assert.equal(await CLI.main(['setup', '--browser=nope'], unknown), 2);
  assert.match(unknown.err(), /nope/);
  const flag = io(ctx);
  assert.equal(await CLI.main(['setup', '--frobnicate'], flag), 2);
  assert.match(flag.err(), /--frobnicate/);
  const badId = io(ctx);
  assert.equal(await CLI.main(['setup', '--extension-id', 'nope'], badId), 2);
  assert.match(badId.err(), /nope/);
  const ok = io(ctx);
  assert.equal(await CLI.main(['setup', '--extension-id', A], ok), 0, ok.err());
  assert.match(ok.out(), /Google Chrome/);
  assert.match(ok.out(), /Firefox/);
  assert.deepEqual(json(path.join(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST}.json`)).allowed_origins, [ORIGIN, `chrome-extension://${A}/`]);
  const doc = io(ctx);
  assert.equal(await CLI.main(['doctor'], doc), 0, doc.out());
  const un = io(ctx);
  assert.equal(await CLI.main(['uninstall'], un), 0, un.err());
  assert.equal(fs.existsSync(path.join(AS(home), 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST}.json`)), false);
  const after = io(ctx);
  assert.equal(await CLI.main(['doctor'], after), 1);
});
