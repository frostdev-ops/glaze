#!/usr/bin/env node
// Builds Claude Desktop's bundle, dist/glaze-mcp-<version>.mcpb: it stages mcpb/manifest.json, Glaze's icon and the npm
// package (bin, lib, package.json, LICENSE) under server/ in a scratch folder, then runs the MCPB CLI's validate and
// pack, and unpacks the result to check it holds exactly what was staged. Signing and publishing are the owner's.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MCPB = '@anthropic-ai/mcpb@2.1.2';
const PKG = path.join(__dirname, '..');
const ROOT = path.join(PKG, '..');
const ICON = path.join(ROOT, 'icons', 'icon128.png');

const files = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? files(dir, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();

// The bundle's tree in dir, replacing anything there. → its files, relative to dir.
const stage = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  const server = path.join(dir, 'server');
  fs.mkdirSync(server, { recursive: true });
  fs.copyFileSync(path.join(PKG, 'mcpb', 'manifest.json'), path.join(dir, 'manifest.json'));
  fs.copyFileSync(ICON, path.join(dir, 'icon.png'));
  for (const f of ['package.json', 'LICENSE']) fs.copyFileSync(path.join(PKG, f), path.join(server, f));
  for (const top of ['bin', 'lib']) fs.cpSync(path.join(PKG, top), path.join(server, top), { recursive: true });
  return files(dir);
};
const output = (version) => path.join(ROOT, 'dist', `glaze-mcp-${version}.mcpb`);
// npx runs the pinned CLI; on Windows npx is a .cmd, which only a shell starts.
const steps = (dir, out, back = `${dir}-unpacked`) => [
  ['validate', path.join(dir, 'manifest.json')],
  ['pack', dir, out],
  ['unpack', out, back],
].map((a) => ['npx', ['-y', MCPB, ...a]]);
const npx = ([cmd, args], cwd) => (process.platform === 'win32'
  ? execFileSync(`${cmd}.cmd`, args.map((a) => `"${a}"`), { cwd, stdio: 'inherit', shell: true })
  : execFileSync(cmd, args, { cwd, stdio: 'inherit' }));

const main = () => {
  const version = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
  const manifest = JSON.parse(fs.readFileSync(path.join(PKG, 'mcpb', 'manifest.json'), 'utf8'));
  if (manifest.version !== version) throw new Error(`mcpb/manifest.json is ${manifest.version}; package.json is ${version}`);
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcpb-')));
  try {
    const dir = path.join(tmp, 'glaze-mcp'), back = path.join(tmp, 'unpacked'), out = output(version);
    const staged = stage(dir);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.rmSync(out, { force: true });
    for (const s of steps(dir, out, back)) npx(s, tmp);
    const got = files(back);
    if (JSON.stringify(got) !== JSON.stringify(staged)) throw new Error(`the bundle holds ${got.join(', ')}; staged ${staged.join(', ')}`);
    for (const f of staged) if (!fs.readFileSync(path.join(back, f)).equals(fs.readFileSync(path.join(dir, f)))) throw new Error(`${f} changed in the bundle`);
    process.stdout.write(`${out}\n`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
};

module.exports = { MCPB, stage, output, steps };
if (require.main === module) {
  try { main(); } catch (e) { process.stderr.write(`pack-mcpb: ${e.message}\n`); process.exitCode = 1; }
}
