const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const B = require('../mcp/lib/browsers.js');
const I = require('../mcp/lib/install.js');
const L = require('../mcp/lib/launcher.js');
const R = require('../mcp/lib/rendezvous.js');
const CLI = require('../mcp/bin/glaze-mcp.js');
const M = require('../mcp/lib/mcpb.js');
const VERSION = require('../mcp/package.json').version;
const POSIX = process.platform !== 'win32';
const FRAME = Buffer.from('1d0000007b2274223a226572726f72222c22776879223a226e6f2d6e6f6465227d', 'hex');
const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-release-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const mkdir = (d) => { fs.mkdirSync(d, { recursive: true }); return d; };
const node = (d, code = 37) => {
  const f = path.join(mkdir(d), 'node');
  fs.writeFileSync(f, `#!/bin/sh\nif [ "$1" = --version ]; then echo v22.11.0; exit 0; fi\nprintf '%s\\n' "$@"\nexit ${code}\n`, { mode: 0o755 });
  return f;
};
const ctx = (home, exe) => ({ platform: 'linux', env: { HOME: home }, node: exe, run: I.runFile });
const doctor = async (c) => {
  let out = '';
  const code = await CLI.main(['doctor'], { ...c, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { out += s; } } });
  return { code, out };
};

test('plain Linux setup detects legacy and XDG Firefox profiles but writes the documented host location', { skip: !POSIX }, async (t) => {
  for (const kind of ['legacy', 'default-xdg', 'custom-xdg', 'both', 'relative-xdg', 'file']) await t.test(kind, async (t) => {
    const home = scratch(t), exe = node(path.join(home, 'bin'));
    const env = { HOME: home, CHROME_CONFIG_HOME: path.join(home, 'chrome-only') };
    if (kind === 'custom-xdg') env.XDG_CONFIG_HOME = path.join(home, 'custom config');
    if (kind === 'relative-xdg') env.XDG_CONFIG_HOME = 'relative';
    const legacy = path.join(home, '.mozilla', 'firefox');
    const xdg = path.join(env.XDG_CONFIG_HOME && path.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.join(home, '.config'), 'mozilla', 'firefox');
    if (kind === 'legacy' || kind === 'both') mkdir(legacy);
    if (kind === 'file') fs.writeFileSync(path.join(mkdir(path.dirname(xdg)), 'firefox'), 'not a profile folder');
    else if (kind !== 'legacy') mkdir(xdg);
    const c = { ...ctx(home, exe), env };
    const setup = await I.setup(c);
    assert.deepEqual(setup.browsers, kind === 'file' ? [] : ['firefox']);
    if (kind === 'file') return;
    const manifest = path.join(home, '.mozilla', 'native-messaging-hosts', `${B.HOST}.json`);
    assert.equal(JSON.parse(fs.readFileSync(manifest)).path, path.join(setup.root, 'hosts', 'firefox'));
    assert.equal(fs.existsSync(path.join(path.dirname(xdg), 'native-messaging-hosts')), false);
    const d = await doctor(c);
    assert.equal(d.code, 0, d.out);
    assert.match(d.out, /ok\s+Firefox:/);
    await I.uninstall(c);
    assert.equal(fs.existsSync(manifest), false);
    assert.equal(fs.existsSync(kind === 'legacy' ? legacy : xdg), true);
  });
});

test('doctor fails a lost forced-browser manifest even without that browser data folder', { skip: !POSIX }, async (t) => {
  const home = scratch(t), c = ctx(home, node(path.join(home, 'bin')));
  await I.setup({ ...c, browsers: ['chrome', 'firefox'] });
  assert.equal((await doctor(c)).code, 0);
  const b = B.table(c.platform, c.env).find((b) => b.id === 'firefox');
  fs.unlinkSync(I.manifestPath(I.context(c), b));
  const d = await doctor(c);
  assert.equal(d.code, 1, d.out);
  assert.match(d.out, /FAIL Firefox:/);
});

test('uninstall keeps unrelated run-shaped files and links while removing dead records', { skip: !POSIX }, async (t) => {
  const home = scratch(t), c = ctx(home, node(path.join(home, 'bin'))), d = R.ready(R.dir(c));
  let dead = 0x3fffffff;
  while (R.alive(dead)) dead--;
  const rec = (instance, pid) => ({ v: 1, pid, browser: 'chrome', instance, path: R.socketPath(d, 'chrome', instance), token: R.token(), at: 1 });
  R.write(d, rec('dead', dead));
  R.write(d, rec('live', process.pid));
  const outside = path.join(home, 'outside');
  fs.writeFileSync(outside, 'leave me');
  const keep = {
    'chrome.unrelated.json': 'a different application',
    'chrome.partial.json': JSON.stringify({ pid: dead }),
    [`chrome.temp.json.${dead}.abc.tmp`]: 'not our temporary record',
  };
  for (const [name, value] of Object.entries(keep)) fs.writeFileSync(path.join(d, name), value, { mode: 0o600 });
  const link = path.join(d, 'chrome.link.json');
  fs.symlinkSync(outside, link);
  const live = fs.readFileSync(R.runFile(d, 'chrome', 'live'));
  await I.uninstall(c);
  assert.equal(fs.existsSync(R.runFile(d, 'chrome', 'dead')), false);
  assert.deepEqual(fs.readFileSync(R.runFile(d, 'chrome', 'live')), live);
  for (const [name, value] of Object.entries(keep)) assert.equal(fs.readFileSync(path.join(d, name), 'utf8'), value, name);
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'leave me');
});

test('uninstall preserves foreign-owned installation files and run records', { skip: !POSIX }, async (t) => {
  for (const kind of ['manifest', 'launcher', 'copy-file', 'run-record', 'run-temp']) await t.test(kind, async (t) => {
    const home = scratch(t), c = ctx(home, node(path.join(home, 'bin')));
    await I.setup({ ...c, browsers: ['chrome'] });
    const root = I.context(c).root, d = R.ready(R.dir(c));
    let dead = 0x3fffffff;
    while (R.alive(dead)) dead--;
    const record = { v: 1, pid: dead, browser: 'chrome', instance: 'foreign', path: R.socketPath(d, 'chrome', 'foreign'), token: R.token(), at: 1 };
    const targets = {
      manifest: I.manifestPath(I.context(c), B.table(c.platform, c.env).find((b) => b.id === 'chrome')),
      launcher: path.join(root, 'hosts', 'chrome'),
      'copy-file': path.join(root, VERSION, 'lib', 'nodes.js'),
      'run-record': R.runFile(d, 'chrome', 'foreign'),
      'run-temp': `${R.runFile(d, 'chrome', 'foreign')}.${dead}.abc.tmp`,
    };
    if (kind.startsWith('run-')) fs.writeFileSync(targets[kind], JSON.stringify(record), { mode: 0o600 });
    const target = targets[kind], before = fs.readFileSync(target), opened = new Map();
    const foreign = (st, f) => path.resolve(f) === target ? new Proxy(st, { get: (s, k) => k === 'uid' ? process.getuid() + 1 : Reflect.get(s, k) }) : st;
    const shim = { ...fs,
      lstatSync: (f, ...a) => foreign(fs.lstatSync(f, ...a), f),
      openSync: (f, ...a) => { const fd = fs.openSync(f, ...a); opened.set(fd, path.resolve(f)); return fd; },
      fstatSync: (fd, ...a) => foreign(fs.fstatSync(fd, ...a), opened.get(fd) || ''),
    };
    const load = (name, overrides = {}) => {
      const file = require.resolve(`../mcp/lib/${name}.js`), req = createRequire(file), module = { exports: {} };
      vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, exports: module.exports, __dirname: path.dirname(file), process, Buffer,
        require: (n) => n === 'node:fs' ? shim : overrides[n] || req(n) }, { filename: file });
      return module.exports;
    };
    const install = load('install', { './rendezvous.js': load('rendezvous') });
    await install.uninstall(c);
    assert.deepEqual(fs.readFileSync(target), before, kind);
  });
});

test('bundle reuse retains safe installed fallbacks when its own discovery finds none', { skip: !POSIX }, async (t) => {
  const home = scratch(t), first = node(path.join(home, 'first')), other = node(path.join(home, 'other'));
  const c = ctx(home, first);
  mkdir(B.table(c.platform, c.env).find((b) => b.id === 'chrome').data);
  await I.setup({ ...c, also: [other] });
  const launcher = path.join(I.context(c).hosts, 'chrome');
  const before = fs.readFileSync(launcher, 'utf8');
  const r = await M.start({ platform: c.platform, env: c.env, execPath: '/Applications/Claude.app/Contents/MacOS/Claude', versions: { electron: '38.0.0' }, list: [], run: I.runFile, stderr: { write() {} } });
  assert.equal(r.node, first);
  assert.equal(fs.readFileSync(launcher, 'utf8'), before);
  fs.unlinkSync(first);
  assert.equal(spawnSync(launcher).status, 37);
});

test('sh launchers preserve special paths and exit codes and skip unsafe candidates at launch time', { skip: !POSIX }, async (t) => {
  for (const unsafe of ['file-mode', 'ancestor-mode', 'symlink-target', 'non-executable', 'directory']) await t.test(unsafe, async (t) => {
    const home = path.join(scratch(t), `Jo's "100% !x! &" home`);
    const first = node(path.join(home, 'pinned')), other = node(path.join(home, 'fallback'));
    const script = path.join(home, 'glaze-mcp.js'), launcher = path.join(mkdir(home), 'launch');
    const args = ['origin', `quote'" % ! & argument`];
    fs.writeFileSync(launcher, L.sh({ node: first, also: [other], script, browser: 'chrome' }), { mode: 0o755 });
    const run = () => spawnSync(launcher, args, { env: { ...process.env, PATH: '/no-such-path' } });
    let out = run();
    assert.equal(out.status, 37, String(out.stderr));
    assert.deepEqual(out.stdout.toString().split('\n'), [script, 'host', '--browser=chrome', ...args, '']);
    if (unsafe === 'file-mode') fs.chmodSync(first, 0o777);
    if (unsafe === 'ancestor-mode') fs.chmodSync(path.dirname(first), 0o777);
    if (unsafe === 'non-executable') fs.chmodSync(first, 0o600);
    if (unsafe === 'directory') { fs.unlinkSync(first); mkdir(first); }
    if (unsafe === 'symlink-target') {
      const target = node(path.join(home, 'unsafe target'), 99);
      fs.chmodSync(target, 0o777);
      fs.unlinkSync(first);
      fs.symlinkSync(target, first);
    }
    // Different exit codes identify which real program ran.
    fs.writeFileSync(other, fs.readFileSync(other, 'utf8').replace('exit 37', 'exit 42'));
    out = run();
    assert.equal(out.status, 42, `${unsafe}: ${out.stderr}`);
    fs.unlinkSync(other);
    out = run();
    assert.equal(out.status, 1, String(out.stderr));
    assert.deepEqual(out.stdout, FRAME);
    if (unsafe === 'ancestor-mode') fs.chmodSync(path.dirname(first), 0o755);
  });
});

test('doctor skips unsafe fallbacks consistently with the launcher and warns', { skip: !POSIX }, async (t) => {
  const home = scratch(t), first = node(path.join(home, 'first')), bad = node(path.join(home, 'bad')), good = node(path.join(home, 'good'));
  const c = ctx(home, first);
  await I.setup({ ...c, browsers: ['chrome'], also: [bad, good] });
  fs.unlinkSync(first);
  fs.chmodSync(bad, 0o777);
  const d = await doctor(c);
  assert.equal(d.code, 0, d.out);
  assert.match(d.out, /warn Google Chrome:.*good/);
  fs.chmodSync(good, 0o600);
  const failed = await doctor(c);
  assert.equal(failed.code, 1, failed.out);
});

test('batch candidate guards exclude directories without expanding the selected exit code early', () => {
  const o = { node: 'C:\\Jo 100% !x! & (home)\\node.exe', also: ['C:\\other ^ bin\\node.exe'], script: "C:\\Jo's 100% !x! & (home)\\glaze.js", browser: 'chrome' };
  const text = L.bat(o);
  assert.match(text, /if not exist "C:\\Jo 100%% !x! & \(home\)\\node.exe\\"/);
  assert.doesNotMatch(text, /%errorlevel%|!errorlevel!/i);
  assert.deepEqual(L.parse(text), o);
  const bytes = text.match(/\[byte\[\]\]\(([\d,]+)\)/)[1].split(',').map(Number);
  assert.deepEqual(Buffer.from(bytes), FRAME);
  for (const bad of ['C:\\bad" & echo injected & "\\node.exe', 'C:\\bad\r\nnode.exe']) {
    assert.throws(() => L.bat({ ...o, also: [bad] }), /invalid/);
  }
});

test('batch fallback runs real Node with special paths, returns its status, and writes the exact no-node frame', { skip: POSIX && 'requires Windows cmd.exe' }, (t) => {
  const home = mkdir(path.join(scratch(t), "Jo's 100% !x! & (home)"));
  const pinned = mkdir(path.join(home, 'directory.exe')), other = path.join(home, 'node.exe');
  fs.copyFileSync(process.execPath, other);
  const script = path.join(home, 'glaze.js'), launcher = path.join(home, 'chrome.bat');
  fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(1))); process.exitCode = 37;');
  fs.writeFileSync(launcher, L.bat({ node: pinned, also: [other], script, browser: 'chrome' }));
  const run = () => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/v:on', '/s', '/c', '"".\\chrome.bat" origin"'], { cwd: home, windowsVerbatimArguments: true });
  const out = run();
  assert.equal(out.status, 37, String(out.stderr));
  assert.deepEqual(JSON.parse(out.stdout), [script, 'host', '--browser=chrome', 'origin']);
  fs.unlinkSync(other);
  const none = run();
  assert.equal(none.status, 1, String(none.stderr));
  assert.deepEqual(none.stdout, FRAME);
});
