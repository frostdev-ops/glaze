// The Claude Desktop bundle (mcp/mcpb/manifest.json, mcp/scripts/pack-mcpb.js): the manifest against MCPB 0.3, the tree
// the pack script stages, `glaze-mcp --from=mcpb` setting the browsers up from Claude's settings, and the node a launcher
// names when Claude runs the helper on its own runtime (spike R6): a system one, or a launcher that says there is none,
// which doctor reports and the worker shows as no-node.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'mcp');
const MANIFEST = path.join(PKG, 'mcpb', 'manifest.json');
const B = require('../mcp/lib/browsers.js');
const I = require('../mcp/lib/install.js');
const D = require('../mcp/lib/doctor.js');
const L = require('../mcp/lib/launcher.js');
const NATIVE = require('../mcp/lib/native.js');
const CLI = require('../mcp/bin/glaze-mcp.js');
const LINK = require('../lib/agent-link.js');
const { runner } = require('./helpers/mcp-reg.cjs');
const VERSION = require('../mcp/package.json').version;
const ORIGIN = 'chrome-extension://jmmaeoajomodnbnlmdikjooalmcilooh/';
const MISSING = 'Install Node.js 18+ for browsers to start the helper';
const NO_NODE = { t: 'error', why: 'no-node' };
const POSIX = process.platform !== 'win32';
const posixOnly = (why) => (POSIX ? false : why);
const windowsOnly = (why) => (POSIX ? why : false);
// Loaded per test, so a missing module fails that test alone.
const N = () => require('../mcp/lib/nodes.js');
const M = () => require('../mcp/lib/mcpb.js');
const P = () => require('../mcp/scripts/pack-mcpb.js');

const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcpb-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const files = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();
const AS = (home) => path.join(home, 'Library', 'Application Support');
// A stand-in node: a script that says its version (POSIX), safe to run where the doctor's checks look.
const fakeNode = (dir, version = 'v22.11.0') => {
  const f = path.join(mk(dir), 'node');
  fs.writeFileSync(f, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 });
  return f;
};
const sink = () => { const lines = []; return { lines, write: (s) => { lines.push(String(s)); return true; }, text: () => lines.join('') }; };
// A macOS home with Chrome and Firefox, and what start() needs to run there without touching this computer.
const macHome = (t) => {
  const home = scratch(t);
  mk(AS(home), 'Google', 'Chrome');
  mk(AS(home), 'Firefox');
  const node = fakeNode(path.join(home, 'opt', 'bin'));
  return { home, node, root: path.join(AS(home), 'glaze-mcp'), hosts: path.join(AS(home), 'glaze-mcp', 'hosts') };
};
const startAt = (h, env = {}, over = {}) => {
  const err = sink();
  return M().start({ platform: 'darwin', env: { HOME: h.home, ...env }, stderr: err, run: runner().run, execPath: h.node, versions: { node: '22.11.0' }, ...over })
    .then((r) => ({ ...r, log: err.text() }));
};

// ---- the manifest ------------------------------------------------------------------------------------------------------
// The top-level and user_config option keys of the MCPB 0.3 schema (@anthropic-ai/mcpb 2.1.2, mcpb-manifest-v0.3.schema.json).
const KEYS_03 = ['$schema', '_meta', 'author', 'compatibility', 'description', 'display_name', 'documentation', 'dxt_version',
  'homepage', 'icon', 'icons', 'keywords', 'license', 'localization', 'long_description', 'manifest_version', 'name',
  'privacy_policies', 'prompts', 'prompts_generated', 'repository', 'screenshots', 'server', 'support', 'tools',
  'tools_generated', 'user_config', 'version'];
const OPTION_03 = ['type', 'title', 'description', 'required', 'default', 'multiple', 'sensitive', 'min', 'max'];

test('the manifest is MCPB 0.3: a node server run as glaze-mcp --from=mcpb, the package\'s version, two settings', () => {
  const m = json(MANIFEST);
  const pkg = json(path.join(PKG, 'package.json'));
  for (const k of Object.keys(m)) assert.ok(KEYS_03.includes(k), `not an MCPB 0.3 key: ${k}`);
  for (const k of ['name', 'version', 'description', 'author', 'server']) assert.ok(m[k], `required: ${k}`);
  assert.equal(m.manifest_version, '0.3');
  assert.equal(m.name, 'glaze-mcp');
  assert.equal(m.display_name, 'Glaze');
  assert.equal(m.version, pkg.version, 'the bundle carries the package version, which names its installed copy');
  assert.equal(m.author.name, pkg.author);
  assert.equal(m.license, pkg.license);
  assert.equal(typeof m.description, 'string');
  assert.ok(m.description.length > 0 && m.description.length <= 200);
  assert.deepEqual(m.server, {
    type: 'node',
    entry_point: 'server/bin/glaze-mcp.js',
    mcp_config: {
      command: 'node',
      args: ['${__dirname}/server/bin/glaze-mcp.js', '--from=mcpb'],
      env: { GLAZE_MCP_BROWSER: '${user_config.browser}', GLAZE_MCP_INSTALL_HOSTS: '${user_config.install_hosts}' },
    },
  });
  assert.deepEqual(Object.keys(m.user_config).sort(), ['browser', 'install_hosts']);
  for (const [k, o] of Object.entries(m.user_config)) {
    for (const key of Object.keys(o)) assert.ok(OPTION_03.includes(key), `${k}: not an MCPB 0.3 option key: ${key}`);
    assert.ok(o.title && typeof o.title === 'string', `${k} has a title`);
    assert.ok(o.description && typeof o.description === 'string', `${k} has a description`);
    assert.notEqual(o.required, true, `${k} is optional, so the bundle installs without questions`);
  }
  assert.equal(m.user_config.browser.type, 'string');
  assert.equal(m.user_config.browser.default, '');
  assert.equal(m.user_config.install_hosts.type, 'boolean');
  assert.equal(m.user_config.install_hosts.default, true);
  // Every placeholder is one MCPB fills in.
  const said = JSON.stringify(m.server.mcp_config).match(/\$\{[^}]*\}/g);
  for (const v of said) assert.ok(v === '${__dirname}' || Object.hasOwn(m.user_config, v.slice('${user_config.'.length, -1)), v);
  assert.deepEqual(m.compatibility, { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=18.0.0' } });
  assert.equal(pkg.engines.node, '>=18', 'the runtime the bundle asks for is the package\'s');
  assert.equal(m.tools_generated, true, 'the tools come from Glaze at run time');
  assert.equal(m.icon, 'icon.png');
});

// ---- staging and packing -----------------------------------------------------------------------------------------------
test('the staged tree is the npm package under server/, with the manifest and icon beside it; its entry point runs', (t) => {
  const dir = path.join(scratch(t), 'stage');
  const got = P().stage(dir);
  const lib = fs.readdirSync(path.join(PKG, 'lib')).filter((f) => f.endsWith('.js')).map((f) => path.join('server', 'lib', f));
  const want = ['manifest.json', 'icon.png', path.join('server', 'package.json'), path.join('server', 'LICENSE'), path.join('server', 'bin', 'glaze-mcp.js'), ...lib].sort();
  assert.deepEqual(files(dir), want);
  assert.deepEqual([...got].sort(), want);
  const m = json(path.join(dir, 'manifest.json'));
  assert.deepEqual(m, json(MANIFEST));
  // entry_point, and the script the command line names, are the same file in the tree.
  assert.ok(fs.statSync(path.join(dir, m.server.entry_point)).isFile());
  assert.equal(path.resolve(m.server.mcp_config.args[0].replace('${__dirname}', dir)), path.resolve(dir, m.server.entry_point));
  for (const f of want.filter((x) => x.startsWith('server'))) {
    const src = path.join(PKG, f.slice('server'.length + 1));
    assert.ok(fs.readFileSync(path.join(dir, f)).equals(fs.readFileSync(src)), `${f} is ${src} unchanged`);
  }
  assert.ok(fs.readFileSync(path.join(dir, 'icon.png')).equals(fs.readFileSync(path.join(ROOT, 'icons', 'icon128.png'))));
  // Run from the tree, as Claude runs it.
  const out = spawnSync(process.execPath, [path.join(dir, m.server.entry_point), '--version'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, `${VERSION}\n`);
  // A tree that is already there is replaced, never added to.
  fs.writeFileSync(path.join(dir, 'server', 'stray.js'), '');
  P().stage(dir);
  assert.deepEqual(files(dir), want);
});

test('pack-mcpb validates and packs with @anthropic-ai/mcpb 2.1.2 into dist/, which git ignores', () => {
  const p = P();
  assert.equal(p.MCPB, '@anthropic-ai/mcpb@2.1.2');
  const out = p.output(VERSION);
  assert.equal(out, path.join(ROOT, 'dist', `glaze-mcp-${VERSION}.mcpb`));
  const steps = p.steps('/s', out);
  assert.deepEqual(steps.map(([, args]) => args.slice(0, 3)), [['-y', p.MCPB, 'validate'], ['-y', p.MCPB, 'pack'], ['-y', p.MCPB, 'unpack']]);
  assert.equal(steps[0][1][3], path.join('/s', 'manifest.json'));
  assert.deepEqual(steps[1][1].slice(3), ['/s', out]);
  assert.equal(steps[2][1][3], out);
  assert.ok(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').includes('dist/'));
  const pkg = json(path.join(PKG, 'package.json'));
  assert.deepEqual(pkg.files, ['bin', 'lib', 'LICENSE'], 'the npm package leaves the bundle\'s files out');
});

// ---- the node a launcher names -----------------------------------------------------------------------------------------
test('Claude\'s own runtime is told apart: Electron, ELECTRON_RUN_AS_NODE, or a node inside Claude\'s app', () => {
  const { claude } = N();
  const plain = { execPath: '/opt/homebrew/bin/node', versions: { node: '22.11.0' }, env: {} };
  assert.equal(claude(plain), false);
  assert.equal(claude({ ...plain, versions: { node: '22.11.0', electron: '38.1.0' } }), true);
  assert.equal(claude({ ...plain, env: { ELECTRON_RUN_AS_NODE: '1' } }), true);
  assert.equal(claude({ ...plain, env: { ELECTRON_RUN_AS_NODE: '' } }), false);
  assert.equal(claude({ ...plain, execPath: '/Applications/Claude.app/Contents/MacOS/Claude' }), true);
  assert.equal(claude({ ...plain, execPath: '/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper' }), true);
  assert.equal(claude({ ...plain, execPath: 'C:\\Users\\Jo\\AppData\\Local\\AnthropicClaude\\app-0.14.10\\claude.exe' }), true);
  assert.equal(claude({ ...plain, execPath: 'C:\\Program Files\\WindowsApps\\Claude_0.14.10.0_x64__pzs8sxrjxfjjc\\app\\claude.exe' }), true);
  assert.equal(claude({ ...plain, execPath: 'C:\\Program Files\\nodejs\\node.exe' }), false);
  assert.equal(claude({ execPath: process.execPath, versions: process.versions, env: {} }), false, 'this test runs on a plain node');
});

test('where a system node is looked for: PATH, then where installers put one, newest nvm first', (t) => {
  const { places } = N();
  const home = scratch(t);
  for (const v of ['v9.11.2', 'v18.20.4', 'v22.11.0', 'v20.18.0', 'not-a-version']) mk(home, '.nvm', 'versions', 'node', v, 'bin');
  const mac = places('darwin', { HOME: home, PATH: `/a/bin:relative::${home}/b` });
  assert.deepEqual(mac.slice(0, 2), ['/a/bin/node', `${home}/b/node`], 'absolute PATH entries first, in order');
  const rest = mac.slice(2);
  for (const p of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/opt/local/bin/node', `${home}/.volta/bin/node`]) assert.ok(rest.includes(p), p);
  const nvm = rest.filter((p) => p.includes('.nvm'));
  assert.deepEqual(nvm, ['v22.11.0', 'v20.18.0', 'v18.20.4', 'v9.11.2'].map((v) => `${home}/.nvm/versions/node/${v}/bin/node`));
  assert.equal(new Set(mac).size, mac.length, 'each once');
  assert.deepEqual(places('darwin', { HOME: home, PATH: '/usr/local/bin' }).filter((p) => p === '/usr/local/bin/node').length, 1);
  // NVM_DIR moves nvm.
  assert.ok(places('darwin', { HOME: '/nowhere', NVM_DIR: path.join(home, '.nvm') }).includes(`${home}/.nvm/versions/node/v22.11.0/bin/node`));

  const linux = places('linux', { HOME: '/home/jo', PATH: '/usr/bin:/bin' });
  assert.deepEqual(linux.slice(0, 2), ['/usr/bin/node', '/bin/node']);
  for (const p of ['/usr/local/bin/node', '/home/jo/.volta/bin/node', '/home/jo/.local/bin/node']) assert.ok(linux.includes(p), p);

  const win = places('win32', {
    Path: 'C:\\Tools;relative;D:\\node', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    LOCALAPPDATA: 'C:\\Users\\Jo\\AppData\\Local', NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
  });
  assert.deepEqual(win.slice(0, 2), ['C:\\Tools\\node.exe', 'D:\\node\\node.exe']);
  for (const p of ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe', 'C:\\nvm4w\\nodejs\\node.exe', 'C:\\Users\\Jo\\AppData\\Local\\Volta\\bin\\node.exe']) assert.ok(win.includes(p), p);
  // Windows paths compare without case.
  assert.equal(places('win32', { Path: 'C:\\PROGRAM FILES\\NODEJS', ProgramFiles: 'C:\\Program Files' }).filter((p) => /program files\\nodejs/i.test(p)).length, 1);
});

test('find takes the first candidate that is a safe executable file saying v18 or later, and runs nothing else', { skip: posixOnly('POSIX modes and sh stand-ins; the Windows choice is covered through an injected run') }, async (t) => {
  const { find } = N();
  const d = scratch(t);
  const missing = path.join(d, 'missing', 'node');
  const old = fakeNode(path.join(d, 'old'), 'v16.20.2');
  const plain = path.join(mk(d, 'plain'), 'node');
  fs.writeFileSync(plain, '#!/bin/sh\necho v22.0.0\n', { mode: 0o644 });
  const shared = mk(d, 'shared');
  const loose = fakeNode(shared, 'v22.0.0');
  fs.chmodSync(shared, 0o777);
  t.after(() => fs.chmodSync(shared, 0o700));
  const folder = path.join(mk(d, 'folder', 'node'));
  const claudeApp = fakeNode(path.join(d, 'Claude.app', 'Contents', 'Resources'), 'v22.0.0');
  const good = fakeNode(path.join(d, 'good'), 'v20.18.0');
  const later = fakeNode(path.join(d, 'later'), 'v24.0.0');
  const ran = [];
  const run = (file, args) => { ran.push(file); return I.runFile(file, args); };
  const got = await find({ platform: 'darwin', env: {}, run, list: [missing, old, plain, loose, folder, claudeApp, good, later] });
  assert.equal(got, good);
  assert.deepEqual(ran, [old, good], 'only safe executable files are ever run, and nothing after the one found');
  assert.equal(await find({ platform: 'darwin', env: {}, run, list: [missing, old] }), null);
  // A node that fails or says nothing usable is passed over.
  const broken = path.join(mk(d, 'broken'), 'node');
  fs.writeFileSync(broken, '#!/bin/sh\nexit 3\n', { mode: 0o755 });
  const chatty = fakeNode(path.join(d, 'chatty'), 'hello');
  assert.equal(await find({ platform: 'darwin', env: {}, run, list: [broken, chatty, later] }), later);
});

test('choose keeps a plain node by its stable PATH name, and under Claude finds a system one or none', async (t) => {
  const { choose } = N();
  const d = scratch(t);
  const node = fakeNode(path.join(d, 'sys'), 'v22.11.0');
  const run = runner().run;
  // Not Claude's: this node, named as stableNode names it.
  assert.equal(await choose({ platform: 'darwin', env: { HOME: d }, execPath: node, versions: { node: '22.11.0' }, run, list: [] }), node);
  assert.equal(await choose({ platform: 'darwin', env: { HOME: d, PATH: '/elsewhere' }, execPath: node, versions: {}, run, list: [] }), node);
  // Claude's: never its own executable, whatever PATH says.
  const electron = { platform: 'darwin', env: { HOME: d, PATH: path.dirname(node) }, execPath: '/Applications/Claude.app/Contents/MacOS/Claude', versions: { electron: '38.1.0' }, run };
  assert.equal(await choose({ ...electron, list: [node] }), node);
  assert.equal(await choose({ ...electron, list: [] }), null);
  assert.equal(await choose({ ...electron, list: ['/Applications/Claude.app/Contents/MacOS/Claude'] }), null, 'Claude\'s app is never a candidate');
});

test('install refuses to default to Claude\'s runtime when no node is given', () => {
  // context() names this node unless told otherwise; under Electron it names none, so setup can't start Claude's app.
  const ctx = I.context({ platform: 'darwin', env: { HOME: '/h' } });
  assert.equal(typeof ctx.node, 'string');
  assert.equal(I.context({ platform: 'darwin', env: { HOME: '/h' }, node: null }).node, null, 'null means no node, not the default');
});

// ---- the launcher with no node ---------------------------------------------------------------------------------------
test('with no node, a launcher says {t:error, why:no-node} in one native message and exits; it parses back', () => {
  const script = "/Users/Jo's/glaze-mcp/0.1.0/bin/glaze-mcp.js";
  const sh = L.text('darwin', { node: null, script, browser: 'chrome' });
  assert.match(sh, /^#!\/bin\/sh\n/);
  assert.match(sh, /\nexit 1\n$/);
  assert.doesNotMatch(sh, /exec /);
  assert.deepEqual(L.parse(sh), { node: null, script, browser: 'chrome' });
  const wscript = 'C:\\Users\\Jo 100%\\AppData\\Local\\glaze-mcp\\0.1.0\\bin\\glaze-mcp.js';
  const bat = L.text('win32', { node: null, script: wscript, browser: 'edge' });
  assert.match(bat, /^@echo off\r\n@setlocal DisableDelayedExpansion\r\n/);
  assert.match(bat, /& exit \/b 1\r\n$/);
  assert.ok(!/[^\r]\n/.test(bat), 'CRLF only');
  assert.ok(bat.includes('"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"'));
  assert.ok(bat.includes('Jo 100%%'), 'cmd expands %, so it is doubled');
  assert.deepEqual(L.parse(bat), { node: null, script: wscript, browser: 'edge' });
  // An edited one is not ours.
  assert.equal(L.parse(sh.replace('exit 1', 'exit 0')), null);
  assert.equal(L.parse(bat.replace('-NoProfile ', '')), null);
  assert.equal(L.parse(sh.replace("why\":\"no-node", "why\":\"other")), null);
  // The bytes the PowerShell line writes are the native message.
  const bytes = bat.match(/\[byte\[\]\]\(([\d,]+)\)/)[1].split(',').map(Number);
  assert.deepEqual(Buffer.from(bytes), NATIVE.encode(NO_NODE));
  assert.throws(() => L.text('win32', { node: null, script: 'C:\\a"b\\glaze-mcp.js', browser: 'edge' }), /invalid character/);
  assert.throws(() => L.text('darwin', { node: null, script: 'relative/glaze-mcp.js', browser: 'chrome' }), /absolute/);
});

const decode = (buf) => {
  const got = [];
  NATIVE.reader((m) => got.push(m))(buf);
  return got;
};

test('the sh launcher with no node writes exactly that message and exits 1', { skip: posixOnly('sh launchers run on POSIX; the .bat test runs on Windows') }, (t) => {
  const d = scratch(t);
  const f = path.join(d, 'chrome');
  fs.writeFileSync(f, L.text(process.platform, { node: null, script: path.join(d, 'x y', 'glaze-mcp.js'), browser: 'chrome' }), { mode: 0o755 });
  const out = spawnSync(f, [ORIGIN], { input: Buffer.from([5, 0, 0, 0]) });
  assert.equal(out.status, 1, String(out.stderr));
  assert.ok(out.stdout.equals(NATIVE.encode(NO_NODE)), out.stdout.toString('hex'));
  assert.deepEqual(decode(out.stdout), [NO_NODE]);
});

test('the .bat launcher with no node writes exactly that message through cmd and exits 1', { skip: windowsOnly('cmd.exe is Windows only; the sh test covers POSIX') }, (t) => {
  const d = scratch(t);
  const f = path.join(d, 'chrome.bat');
  fs.writeFileSync(f, L.text('win32', { node: null, script: path.join(d, 'x y', 'glaze-mcp.js'), browser: 'chrome' }));
  const out = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${f}" ${ORIGIN} --parent-window=0`], { windowsVerbatimArguments: true });
  assert.equal(out.status, 1, String(out.stderr));
  assert.deepEqual(decode(out.stdout), [NO_NODE]);
});

// ---- --from=mcpb -------------------------------------------------------------------------------------------------------
test('start sets up every present browser with this node, once; a second start writes nothing', async (t) => {
  const h = macHome(t);
  const first = await startAt(h);
  assert.equal(first.node, h.node);
  assert.deepEqual([...first.setup.browsers].sort(), ['chrome', 'firefox']);
  assert.equal(first.setup.changed, true);
  const l = L.parse(fs.readFileSync(path.join(h.hosts, 'chrome'), 'utf8'));
  assert.deepEqual(l, { node: h.node, script: path.join(h.root, VERSION, 'bin', 'glaze-mcp.js'), browser: 'chrome' });
  assert.equal(json(path.join(AS(h.home), 'Google', 'Chrome', 'NativeMessagingHosts', `${B.HOST}.json`)).path, path.join(h.hosts, 'chrome'));
  const again = await startAt(h);
  assert.equal(again.setup.changed, false);
  assert.deepEqual(again.setup.wrote, []);
  const report = await D.run({ platform: 'darwin', env: { HOME: h.home }, run: runner().run });
  assert.equal(report.ok, true, D.text(report));
});

test('Claude\'s settings: GLAZE_MCP_BROWSER by id or name, unset as Claude leaves it; GLAZE_MCP_INSTALL_HOSTS=false sets nothing up', async (t) => {
  const { browser } = M();
  const table = B.table('darwin', { HOME: '/h' });
  for (const [v, want] of [
    ['${user_config.browser}', null], ['', null], ['   ', null], [undefined, null],
    ['chrome', 'chrome'], [' Chrome ', 'chrome'], ['Google Chrome', 'chrome'], ['microsoft edge', 'edge'], ['Firefox', 'firefox'],
    ['safari', 'safari'], ['Safari', 'safari'], ['not a browser!', null], ['${user_config.other}', null],
  ]) assert.equal(browser(v, table), want, JSON.stringify(v));

  const h = macHome(t);
  const off = await startAt(h, { GLAZE_MCP_INSTALL_HOSTS: 'false', GLAZE_MCP_BROWSER: '${user_config.browser}' });
  assert.equal(off.setup, null);
  assert.equal(fs.existsSync(h.root), false, 'nothing written');
  assert.equal('GLAZE_MCP_BROWSER' in off.env, false, 'an unset browser leaves the agent to choose');
  assert.equal('GLAZE_MCP_INSTALL_HOSTS' in off.env, false);

  // Edge named, with no Edge folder: it is set up too, beside those present.
  const named = await startAt(h, { GLAZE_MCP_INSTALL_HOSTS: 'true', GLAZE_MCP_BROWSER: 'Microsoft Edge' });
  assert.equal(named.env.GLAZE_MCP_BROWSER, 'edge');
  assert.deepEqual([...named.setup.browsers].sort(), ['chrome', 'edge', 'firefox']);
  assert.ok(fs.existsSync(path.join(h.hosts, 'edge')));

  for (const v of ['${user_config.install_hosts}', '', 'TRUE']) {
    const r = await startAt(h, { GLAZE_MCP_INSTALL_HOSTS: v });
    assert.ok(r.setup, `${JSON.stringify(v)} sets up`);
  }
  const bad = await startAt(h, { GLAZE_MCP_BROWSER: 'not a browser!' });
  assert.equal('GLAZE_MCP_BROWSER' in bad.env, false);
  assert.match(bad.log, /not a browser!/);
  // The rest of the environment is passed on as it was.
  assert.equal((await startAt(h, { KEEP: 'me' })).env.KEEP, 'me');
});

test('under Claude\'s runtime with no system node, start writes launchers that say so, logs it, and doctor reports it', async (t) => {
  const h = macHome(t);
  const claude = { execPath: '/Applications/Claude.app/Contents/MacOS/Claude', versions: { electron: '38.1.0' }, list: [] };
  const r = await startAt(h, {}, claude);
  assert.equal(r.node, null);
  assert.ok(r.log.includes(MISSING), r.log);
  for (const b of ['chrome', 'firefox']) {
    assert.deepEqual(L.parse(fs.readFileSync(path.join(h.hosts, b), 'utf8')), { node: null, script: path.join(h.root, VERSION, 'bin', 'glaze-mcp.js'), browser: b });
  }
  const reg = runner();
  const report = await D.run({ platform: 'darwin', env: { HOME: h.home }, run: reg.run });
  assert.equal(report.ok, false);
  for (const name of ['Google Chrome', 'Firefox']) {
    assert.ok(report.rows.some((row) => row.level === 'fail' && row.what === name && row.detail.startsWith(MISSING)), D.text(report));
  }
  assert.deepEqual(reg.calls, [], 'doctor runs no node for a launcher that names none');

  // Node.js installed: the next start names it.
  const found = await startAt(h, {}, { ...claude, list: [h.node] });
  assert.equal(found.node, h.node);
  assert.deepEqual(found.setup.wrote.sort(), [path.join(h.hosts, 'chrome'), path.join(h.hosts, 'firefox')].sort());
  assert.equal(L.parse(fs.readFileSync(path.join(h.hosts, 'chrome'), 'utf8')).node, h.node);
  assert.equal((await D.run({ platform: 'darwin', env: { HOME: h.home }, run: runner().run })).ok, true);

  // Uninstall takes launchers that name no node too.
  await startAt(h, {}, claude);
  await I.uninstall({ platform: 'darwin', env: { HOME: h.home }, run: runner().run });
  assert.equal(fs.existsSync(h.hosts), false);
});

test('start leaves a newer helper set up by npx alone, and a failed setup still lets the agent start', async (t) => {
  const h = macHome(t);
  const newer = scratch(t);
  for (const f of ['bin', 'lib']) fs.cpSync(path.join(PKG, f), path.join(newer, f), { recursive: true });
  fs.writeFileSync(path.join(newer, 'package.json'), JSON.stringify({ ...json(path.join(PKG, 'package.json')), version: '90.0.1' }));
  await I.setup({ platform: 'darwin', env: { HOME: h.home }, node: h.node, src: newer, run: runner().run });
  const before = fs.readFileSync(path.join(h.hosts, 'chrome'), 'utf8');
  const r = await startAt(h);
  assert.equal(r.setup.changed, false);
  assert.equal(r.setup.newer, '90.0.1');
  assert.equal(fs.readFileSync(path.join(h.hosts, 'chrome'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(h.root, VERSION)), false, 'no copy made for a version it won\'t run');

  const h2 = macHome(t);
  fs.writeFileSync(h2.root, 'not a folder');
  const failed = await startAt(h2, { GLAZE_MCP_BROWSER: 'chrome' });
  assert.equal(failed.setup, null);
  assert.match(failed.log, /glaze-mcp: /);
  assert.equal(failed.env.GLAZE_MCP_BROWSER, 'chrome');
});

test('the command: --from=mcpb sets up, then runs agent mode; any other --from is refused', { skip: posixOnly('a real setup on Windows writes HKCU keys; the in-process tests cover it') }, (t) => {
  const home = scratch(t);
  const B0 = B.table(process.platform, { HOME: home })[0];
  mk(B0.data);
  const env = { ...process.env, HOME: home, XDG_DATA_HOME: path.join(home, '.local', 'share'), XDG_CONFIG_HOME: path.join(home, '.config') };
  delete env.GLAZE_MCP_BROWSER;
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CONFIG_HOME;
  const bin = path.join(PKG, 'bin', 'glaze-mcp.js');
  const out = spawnSync(process.execPath, [bin, '--from=mcpb'], { env: { ...env, GLAZE_MCP_BROWSER: '${user_config.browser}', GLAZE_MCP_INSTALL_HOSTS: 'true' }, input: '', encoding: 'utf8', timeout: 20000 });
  assert.equal(out.status, 0, out.stderr);
  const { root, hosts } = B.folder(process.platform, { HOME: home, XDG_DATA_HOME: env.XDG_DATA_HOME });
  const l = L.parse(fs.readFileSync(path.join(hosts, B0.id), 'utf8'));
  assert.equal(fs.realpathSync(l.node), fs.realpathSync(process.execPath));
  assert.equal(l.script, path.join(root, VERSION, 'bin', 'glaze-mcp.js'));
  assert.doesNotMatch(out.stderr, /unknown option|GLAZE_MCP_BROWSER/);
  assert.equal(CLI.mode(['--from=mcpb']).mode, 'agent');
  const other = spawnSync(process.execPath, [bin, '--from=elsewhere'], { env, input: '', encoding: 'utf8', timeout: 20000 });
  assert.equal(other.status, 2);
  assert.match(other.stderr, /unknown option --from=elsewhere/);
});

// ---- the worker's state ----------------------------------------------------------------------------------------------
// A worker's link with a fake connectNative (as test/agent-link.test.js has it, cut down): ports, storage and timers.
const linkWorld = () => {
  const ports = [], session = {}, local = { mcp: { on: true } }, jobs = new Map();
  let id = 0;
  const timers = {
    setTimeout: (fn, ms) => { jobs.set(++id, { fn, ms }); return id; }, clearTimeout: (k) => jobs.delete(k),
    setInterval: (fn, ms) => { jobs.set(++id, { fn, ms }); return id; }, clearInterval: (k) => jobs.delete(k),
  };
  const runtime = {
    lastError: undefined,
    getManifest: () => ({ version: '4.0.0' }),
    connectNative(name) {
      const heard = [], gone = [];
      const p = {
        name, sent: [], disconnected: false, error: undefined,
        onMessage: { addListener: (f) => heard.push(f) }, onDisconnect: { addListener: (f) => gone.push(f) },
        postMessage(m) { if (p.disconnected) throw new Error('disconnected'); p.sent.push(m); },
        disconnect() { p.disconnected = true; },
        host(m) { for (const f of heard) f(structuredClone(m), p); },
        die(message, firefox = false) {
          p.disconnected = true;
          if (firefox) p.error = message == null ? null : { message }; else runtime.lastError = { message };
          for (const f of gone) f(p);
          runtime.lastError = undefined;
        },
      };
      ports.push(p);
      return p;
    },
  };
  const pick = (o, keys) => Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(o, k)).map((k) => [k, structuredClone(o[k])]));
  const storage = {
    local: { get: async (k) => pick(local, k), set: async (o) => { Object.assign(local, o); } },
    session: { set: async (o) => { Object.assign(session, structuredClone(o)); } },
  };
  const link = LINK.make({ runtime, permissions: { contains: async () => true }, storage, browser: 'chrome', timers, now: () => 1000, random: (n) => new Uint8Array(n).fill(7) });
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return { link, ports, session, jobs, port: () => ports[ports.length - 1], settle };
};
const HELLO = { t: 'hello', v: 1, host: VERSION, os: 'darwin', browser: 'chrome', node: 'v22.11.0' };

test('the worker shows a helper with no node as no-node, tries again only on a trigger, and connects once there is one', async () => {
  assert.ok(LINK.STATES.includes('no-node'));
  for (const firefox of [false, true]) {
    const w = linkWorld();
    await w.link.ensure();
    w.port().host(NO_NODE);
    w.port().die(firefox ? null : 'Native host has exited.', firefox);
    await w.settle();
    assert.equal(w.link.status().state, 'no-node');
    assert.equal(w.link.status().error, 'no-node');
    assert.equal(w.session.mcpLink.state, 'no-node', 'the options page reads it from storage.session');
    assert.equal(w.session.mcpLink.error, 'no-node');
    assert.equal(w.jobs.size, 0, 'no timed retry: nothing changes until Node.js is installed and setup runs again');
    // A trigger tries again; until the helper answers, the state stays what it was.
    await w.link.ensure();
    assert.equal(w.ports.length, 2);
    assert.equal(w.link.status().state, 'no-node');
    w.port().host(HELLO);
    await w.settle();
    assert.equal(w.link.status().state, 'connected');
    assert.equal(w.link.status().error, undefined);
  }
  // Any other first frame that isn't a hello is still a helper this worker can't use.
  const w = linkWorld();
  await w.link.ensure();
  w.port().host({ t: 'error', why: 'something else' });
  await w.settle();
  assert.equal(w.link.status().state, 'old-helper');
  // A host that said hello and then failed is exited, as before.
  const x = linkWorld();
  await x.link.ensure();
  x.port().host(HELLO);
  x.port().host({ t: 'error', why: 'no-node' });
  x.port().die('Native host has exited.');
  await x.settle();
  assert.equal(x.link.status().state, 'exited');
});
