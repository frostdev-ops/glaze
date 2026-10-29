// setup, ensure and uninstall. Setup copies the package (bin, lib, package.json) out of wherever npx put it into
// <data>/<version>, keeping the version it replaces, and writes one launcher and one host manifest per browser that is
// present. On Windows the manifests sit beside the launchers and a key under HKCU points at each; keys go through
// run('…\System32\reg.exe', argv), never a shell. ensure({ ifNeeded: true }) is the same code, writing only what
// differs: a moved node or a new version rewrites the launchers, and nothing else is touched. Uninstall removes only
// manifests and keys with our host name whose path points into our folder, our launchers and our copies.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const B = require('./browsers.js');
const IDS = require('./ids.js');
const L = require('./launcher.js');

const PKG = path.join(__dirname, '..');
const DESCRIPTION = 'Lets AI apps on this computer use Glaze.';
const SCRIPT = path.join('bin', 'glaze-mcp.js');
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// File modes exist only off Windows; the platform being set up can differ from the one running (tests).
const MODES = process.platform !== 'win32';

// A program with an argv and no shell: reg.exe for the registry, and `node --version` for doctor.
const runFile = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 15e3 }, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
});
const usage = (message) => Object.assign(new Error(message), { code: 'USAGE' });

const context = (o = {}) => {
  const platform = o.platform || process.platform;
  const env = o.env || { ...process.env, HOME: process.env.HOME || os.homedir() };
  return { platform, env, node: o.node || stableNode(process.execPath, platform, env), src: o.src || PKG, run: o.run || runFile, tmp: o.tmp || os.tmpdir(), ...B.folder(platform, env) };
};
// This node, named by the first PATH entry that leads to the same file: Homebrew's own path (…/Cellar/node/<version>)
// goes away at the next upgrade, its /opt/homebrew/bin/node doesn't.
const stableNode = (exe, platform, env) => {
  const want = real(exe);
  for (const dir of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const c = path.join(dir, platform === 'win32' ? 'node.exe' : 'node');
    if (fs.existsSync(c) && real(c) === want) return c;
  }
  return exe;
};

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const versionOf = (dir) => { const v = (readJson(path.join(dir, 'package.json')) || {}).version; return typeof v === 'string' && VERSION.test(v) ? v : null; };
const inside = (ctx, dir, p) => {
  if (typeof p !== 'string') return false;
  const r = ctx.platform === 'win32' ? path.relative(dir.toLowerCase(), p.toLowerCase()) : path.relative(dir, p);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};
const target = (f, m) => (m && typeof m.path === 'string' ? path.resolve(path.dirname(f), m.path) : null);
const ours = (ctx, f, m) => !!m && m.name === B.HOST && inside(ctx, ctx.root, target(f, m));
const manifestPath = (ctx, b) => (ctx.platform === 'win32' ? path.join(ctx.hosts, `${b.id}.json`) : path.join(b.dir, `${B.HOST}.json`));
const manifest = (b, launcher, ids) => ({
  name: B.HOST, description: DESCRIPTION, path: launcher, type: 'stdio',
  ...(b.family === 'firefox' ? { allowed_extensions: [IDS.FIREFOX] } : { allowed_origins: ids.map(IDS.origin) }),
});

const privateDir = (d) => {
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  if (MODES) fs.chmodSync(d, 0o700);
};
// Written whole through a rename, and only when it differs (or `force`).
const put = (file, text, mode, force) => {
  if (!force && readText(file) === text && (!MODES || !mode || (fs.statSync(file).mode & 0o777) === mode)) return false;
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { mode: mode || 0o644, flag: 'wx' });
    if (MODES && mode) fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  return true;
};

// The package's files, relative to its root.
const list = (dir) => {
  const out = ['package.json'];
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(rel, e.name));
      else if (e.isFile()) out.push(path.join(rel, e.name));
    }
  };
  for (const top of ['bin', 'lib']) if (B.isDir(path.join(dir, top))) walk(top);
  return out.sort();
};
const same = (a, b) => {
  try {
    const fa = list(a), fb = list(b);
    return fa.length === fb.length && fa.every((f, i) => f === fb[i] && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
  } catch { return false; }
};
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// <root>/<version>, built beside it and swapped in. Nothing to do when it is already there, or is where this runs from.
const copy = (ctx, version, ifNeeded) => {
  const dest = path.join(ctx.root, version);
  if (real(ctx.src) === real(dest)) return null;
  if (ifNeeded ? versionOf(dest) === version && fs.existsSync(path.join(dest, SCRIPT)) : same(ctx.src, dest)) return null;
  const tmp = path.join(ctx.root, `.${version}.${process.pid}.tmp`), old = path.join(ctx.root, `.${version}.${process.pid}.old`);
  fs.rmSync(tmp, { recursive: true, force: true });
  privateDir(tmp);
  for (const f of list(ctx.src)) {
    fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(ctx.src, f), path.join(tmp, f));
  }
  if (fs.existsSync(dest)) fs.renameSync(dest, old);
  fs.renameSync(tmp, dest);
  fs.rmSync(old, { recursive: true, force: true });
  return dest;
};
const copies = (ctx) => {
  try {
    return fs.readdirSync(ctx.root).filter((d) => VERSION.test(d) && versionOf(path.join(ctx.root, d)) === d && fs.existsSync(path.join(ctx.root, d, SCRIPT)));
  } catch { return []; }
};
const launchers = (ctx) => {
  let names = [];
  try { names = fs.readdirSync(ctx.hosts); } catch { /* none yet */ }
  return names.map((n) => path.join(ctx.hosts, n)).map((f) => ({ f, l: L.parse(readText(f)) })).filter((x) => x.l);
};
const newest = (a, b) => {
  const n = (v) => v.split(/[.-]/).slice(0, 3).map(Number);
  const x = n(a), y = n(b);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2] || (a < b ? 1 : -1);
};
// Keeps this version and the one the launchers ran before (else the newest other one).
const prune = (ctx, version, before) => {
  const others = copies(ctx).filter((v) => v !== version).sort(newest);
  const keep = others.find((v) => before.has(v)) || others[0];
  for (const v of others) if (v !== keep) fs.rmSync(path.join(ctx.root, v), { recursive: true, force: true });
};

// The registry, through reg.exe. `reg export` writes UTF-16, so a path with any letters in it reads back exactly
// (`reg query` prints in the console's code page).
const regExe = (ctx) => path.win32.join(ctx.env.SystemRoot || ctx.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'reg.exe');
const regDefault = (buf) => {
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  const m = text.match(/^@="((?:[^"\\]|\\.)*)"\r?$/m);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
};
const readKey = async (o, key) => {
  const ctx = context(o);
  const file = path.join(ctx.tmp, `glaze-mcp-${process.pid}-${crypto.randomBytes(6).toString('hex')}.reg`);
  try {
    await ctx.run(regExe(ctx), ['export', key, file, '/y']);
    return regDefault(fs.readFileSync(file));
  } catch {
    return null;
  } finally {
    fs.rmSync(file, { force: true });
  }
};

const ensure = async (o = {}) => {
  const ctx = context(o);
  const force = !o.ifNeeded;
  const version = versionOf(ctx.src);
  if (!version) throw new Error(`no package.json version in ${ctx.src}`);
  const all = B.table(ctx.platform, ctx.env);
  const asked = o.browsers || [];
  const unknown = asked.filter((id) => !all.some((b) => b.id === id));
  if (unknown.length) throw usage(`unknown browser: ${unknown.join(', ')} (known here: ${all.map((b) => b.id).join(', ')})`);
  const bad = (o.ids || []).filter((id) => !IDS.valid(id));
  if (bad.length) throw usage(`not an extension id: ${bad.join(', ')}`);
  const chosen = asked.length ? all.filter((b) => asked.includes(b.id)) : B.present(all);
  const out = { version, root: ctx.root, browsers: chosen.map((b) => b.id), names: chosen.map((b) => b.name), ids: [], wrote: [], keys: [], copied: null, changed: false };
  if (!chosen.length) return out;

  const before = new Set(launchers(ctx).map(({ l }) => path.relative(ctx.root, l.script).split(path.sep)[0]));
  privateDir(ctx.root);
  privateDir(ctx.hosts);
  out.copied = copy(ctx, version, !force);
  // Ids already let in by any manifest with our name are kept, for every browser.
  out.ids = IDS.merge(...all.filter((b) => b.family === 'chromium').map((b) => readJson(manifestPath(ctx, b)))
    .filter((m) => m && m.name === B.HOST).map(IDS.fromManifest), o.ids || []);
  // On Windows a key read by several browsers points at the first present one's manifest.
  const owner = new Map();
  if (ctx.platform === 'win32') for (const b of chosen) for (const k of b.keys) if (!owner.has(k)) owner.set(k, b);
  const script = path.join(ctx.root, version, SCRIPT);
  for (const b of chosen) {
    const keys = ctx.platform === 'win32' ? b.keys.filter((k) => owner.get(k) === b) : [];
    if (ctx.platform === 'win32' && !keys.length) continue;
    const launcher = L.file(ctx.platform, ctx.hosts, b.id);
    if (put(launcher, L.text(ctx.platform, { node: ctx.node, script, browser: b.id }), ctx.platform === 'win32' ? 0 : 0o755, force)) out.wrote.push(launcher);
    const mf = manifestPath(ctx, b);
    fs.mkdirSync(path.dirname(mf), { recursive: true });
    if (put(mf, `${JSON.stringify(manifest(b, launcher, out.ids), null, 2)}\n`, 0, force)) out.wrote.push(mf);
    for (const k of keys) {
      if (!force && (await readKey(ctx, k)) === mf) continue;
      await ctx.run(regExe(ctx), ['add', k, '/ve', '/t', 'REG_SZ', '/d', mf, '/f']);
      out.keys.push(k);
    }
  }
  if (force) prune(ctx, version, before);
  out.changed = !!(out.copied || out.wrote.length || out.keys.length);
  return out;
};
const setup = (o = {}) => ensure({ ...o, ifNeeded: false });

const uninstall = async (o = {}) => {
  const ctx = context(o);
  const all = B.table(ctx.platform, ctx.env);
  const removed = [], kept = [];
  if (ctx.platform === 'win32') {
    for (const k of [...new Set(all.flatMap((b) => b.keys))]) {
      const v = await readKey(ctx, k);
      if (v === null) continue;
      if (!inside(ctx, ctx.root, v)) { kept.push(k); continue; }
      await ctx.run(regExe(ctx), ['delete', k, '/f']);
      removed.push(k);
    }
  }
  let inHosts = [];
  try { inHosts = fs.readdirSync(ctx.hosts).filter((n) => n.endsWith('.json')).map((n) => path.join(ctx.hosts, n)); } catch { /* none */ }
  for (const f of ctx.platform === 'win32' ? inHosts : all.map((b) => manifestPath(ctx, b))) {
    const m = readJson(f);
    if (ours(ctx, f, m)) { fs.rmSync(f, { force: true }); removed.push(f); } else if (m && m.name === B.HOST) kept.push(f);
  }
  for (const { f } of launchers(ctx)) { fs.rmSync(f, { force: true }); removed.push(f); }
  for (const v of copies(ctx)) { fs.rmSync(path.join(ctx.root, v), { recursive: true, force: true }); removed.push(path.join(ctx.root, v)); }
  for (const d of [ctx.hosts, ctx.root]) try { fs.rmdirSync(d); } catch { /* not empty, or gone */ }
  return { removed, kept };
};

module.exports = { DESCRIPTION, context, ensure, setup, uninstall, readKey, versionOf, manifestPath, inside, regExe, runFile, stableNode };
