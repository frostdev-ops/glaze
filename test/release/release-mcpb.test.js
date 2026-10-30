// Claude Desktop's bundle in the release: store-release checks that the helper carries Glaze's version, then builds
// glaze-mcp-<version>.mcpb with mcp/scripts/pack-mcpb.js in the release clone. A stand-in npx plays the MCPB CLI, so
// nothing here reaches npm, and the stages that upload are never run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const VERSION = JSON.parse(read('manifest.json')).version;
const store = () => import('../scripts/store-release.mjs');
const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-release-mcpb-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};

// ---- the helper's version ----

const reader = (files) => (file) => { if (!(file in files)) throw new Error(`${file} is missing`); return JSON.stringify(files[file]); };

test('the helper and its bundle must carry Glaze\'s version', async () => {
  const { helperVersions } = await store();
  const ok = { 'mcp/package.json': { version: '4.0.0' }, 'mcp/mcpb/manifest.json': { version: '4.0.0' } };
  assert.doesNotThrow(() => helperVersions(reader(ok), '4.0.0'));
  assert.throws(() => helperVersions(reader({ ...ok, 'mcp/package.json': { version: '0.1.0' } }), '4.0.0'), /mcp\/package\.json is 0\.1\.0; manifest\.json is 4\.0\.0\./);
  assert.throws(() => helperVersions(reader({ ...ok, 'mcp/mcpb/manifest.json': { version: '4.0.1' } }), '4.0.0'), /mcp\/mcpb\/manifest\.json is 4\.0\.1; manifest\.json is 4\.0\.0\./);
  assert.throws(() => helperVersions(reader({ 'mcp/package.json': { version: '4.0.0' } }), '4.0.0'), /mcp\/mcpb\/manifest\.json is missing/);
});

test('a release checks the helper\'s committed version before it builds anything', () => {
  const source = read('scripts/store-release.mjs');
  const check = source.indexOf("if (['release', 'build', 'plan'].includes(opt.command) && publicStores(opt.stores)) helperVersions(show, version);");
  assert.ok(check > 0, 'release, build and plan check it whenever both store ZIPs are selected');
  assert.ok(check < source.indexOf("const saved = path.join(out, 'release.json');"), 'before any build starts');
});

// ---- building the bundle ----

// `npx -y @anthropic-ai/mcpb@2.1.2 validate|pack|unpack`, with zip and unzip for pack and unpack. Its validate fails
// while a `fail` file sits beside it. It records each call, and the environment validate saw.
const fakeNpx = (dir) => fs.writeFileSync(path.join(dir, 'npx'), `#!/bin/sh
here=$(dirname "$0")
[ "$1 $2" = "-y @anthropic-ai/mcpb@2.1.2" ] || exit 64
echo "$3" >> "$here/calls"
case "$3" in
  validate) env > "$here/env"; [ -f "$4" ] && [ ! -e "$here/fail" ] || { echo "manifest.json: invalid" >&2; exit 1; } ;;
  pack) cd "$4" && zip -qrX "$5" . ;;
  unpack) mkdir -p "$5" && unzip -q "$4" -d "$5" ;;
  *) exit 64 ;;
esac
`, { mode: 0o755 });
// The release clone, as far as pack-mcpb.js reads it, and the release workspace with its logs folder.
const release = (t) => {
  const base = scratch(t), source = path.join(base, 'source'), out = path.join(base, 'out'), bin = path.join(base, 'bin');
  fs.cpSync(path.join(root, 'mcp'), path.join(source, 'mcp'), { recursive: true });
  fs.mkdirSync(path.join(source, 'icons'));
  fs.copyFileSync(path.join(root, 'icons/icon128.png'), path.join(source, 'icons/icon128.png'));
  fs.mkdirSync(path.join(out, 'logs'), { recursive: true });
  fs.mkdirSync(bin);
  fakeNpx(bin);
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, GH_TOKEN: 'gh-release-token', ASC_KEY_ID: 'asc-release-key' };
  const calls = () => fs.readFileSync(path.join(bin, 'calls'), 'utf8').trim().split('\n');
  return { source, out, bin, env, calls, log: () => fs.readFileSync(path.join(out, 'logs/mcpb-pack.log'), 'utf8') };
};

test('the release packs glaze-mcp-<Glaze version>.mcpb with pack-mcpb.js, its npx seeing only the isolated environment', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { buildMcpb } = await store();
  const r = release(t);
  const file = await buildMcpb(r.source, r.out, r.env, VERSION);
  assert.equal(file, path.join(r.out, `glaze-mcp-${VERSION}.mcpb`));
  assert.ok(fs.readFileSync(file).equals(fs.readFileSync(path.join(r.source, 'dist', path.basename(file)))), 'the packed bytes, copied');
  assert.deepEqual(r.calls(), ['validate', 'pack', 'unpack']);
  const inside = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n');
  for (const f of ['manifest.json', 'icon.png', 'server/package.json', 'server/bin/glaze-mcp.js']) assert.ok(inside.includes(f), f);
  assert.equal(JSON.parse(execFileSync('unzip', ['-p', file, 'manifest.json'], { encoding: 'utf8' })).version, VERSION, 'Claude Desktop shows the version the file is named for');
  const seen = fs.readFileSync(path.join(r.bin, 'env'), 'utf8');
  for (const secret of ['GH_TOKEN', 'gh-release-token', 'ASC_KEY_ID', 'asc-release-key']) assert.ok(!seen.includes(secret), `${secret} reached npx`);
  assert.ok(!seen.split('\n').includes(`HOME=${os.homedir()}`), 'npx runs with a temporary HOME');
  assert.match(r.log(), /^\$ node mcp\/scripts\/pack-mcpb\.js\n/);
});

test('a failed mcpb validate stops the release build, and no bundle is packed or kept', async (t) => {
  t.mock.method(console, 'log', () => {});
  const { buildMcpb } = await store();
  const r = release(t);
  fs.writeFileSync(path.join(r.bin, 'fail'), '');
  await assert.rejects(buildMcpb(r.source, r.out, r.env, VERSION), /node exited 1; see .*mcpb-pack\.log/);
  assert.deepEqual(r.calls(), ['validate']);
  assert.equal(fs.existsSync(path.join(r.out, `glaze-mcp-${VERSION}.mcpb`)), false);
  assert.equal(fs.existsSync(path.join(r.source, 'dist', `glaze-mcp-${VERSION}.mcpb`)), false);
  assert.match(r.log(), /manifest\.json: invalid/);
  assert.match(r.log(), /pack-mcpb: Command failed: npx -y @anthropic-ai\/mcpb@2\.1\.2 validate/);
});

test('build packs the bundle whenever it builds both store ZIPs: after the suite, before the Firefox and Apple steps', () => {
  const source = read('scripts/store-release.mjs');
  const body = source.slice(source.indexOf('async function build('), source.indexOf('export function verify('));
  const pack = body.indexOf("if (publicStores(opt.stores)) artifact('mcpb', await buildMcpb(source, out, env, manifest.version));");
  assert.ok(pack > 0, 'recorded as the mcpb artifact');
  assert.ok(pack > body.indexOf("'logs/tests-main.log'"), 'after the suite passes on the clone');
  assert.ok(pack < body.indexOf("if (opt.stores.includes('firefox')) {"), 'a bad bundle stops the build before the long store steps');
});
