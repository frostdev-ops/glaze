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
const RECEIPT = '.glaze-mcp-copy.json';
const GRANTS = '.glaze-mcp-ids.json';
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
const versionOf = (dir) => { const p = readJson(path.join(dir, 'package.json')) || {}; return p.name === 'glaze-mcp' && typeof p.version === 'string' && VERSION.test(p.version) ? p.version : null; };
const inside = (ctx, dir, p) => {
  if (typeof p !== 'string') return false;
  const r = ctx.platform === 'win32' ? path.relative(dir.toLowerCase(), p.toLowerCase()) : path.relative(dir, p);
  return !!r && !r.startsWith('..') && !path.isAbsolute(r);
};
const target = (f, m) => (m && typeof m.path === 'string' ? path.resolve(path.dirname(f), m.path) : null);
const equalPath = (ctx, a, b) => typeof a === 'string' && typeof b === 'string' && (ctx.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
const ours = (ctx, b, f, m) => !!m && m.name === B.HOST && m.type === 'stdio' && equalPath(ctx, target(f, m), L.file(ctx.platform, ctx.hosts, b.id));
const manifestPath = (ctx, b) => (ctx.platform === 'win32' ? path.join(ctx.hosts, `${b.id}.json`) : path.join(b.dir, `${B.HOST}.json`));
const manifest = (b, launcher, ids) => ({
  name: B.HOST, description: DESCRIPTION, path: launcher, type: 'stdio',
  ...(b.family === 'firefox' ? { allowed_extensions: [IDS.FIREFOX] } : { allowed_origins: ids.map(IDS.origin) }),
});

// Never follow a destination symlink, including one in an ancestor. Private helper directories also belong to us.
const safePath = (f) => {
  const full = path.resolve(f), root = path.parse(full).root;
  let part = root;
  for (const name of full.slice(root.length).split(path.sep)) {
    part = path.join(part, name);
    let st;
    try { st = fs.lstatSync(part); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (st.isSymbolicLink()) throw new Error(`refusing symlink: ${part}`);
    if (part !== full && !st.isDirectory()) throw new Error(`not a directory: ${part}`);
  }
};
const safeTree = (dir) => {
  safePath(dir);
  if (!fs.existsSync(dir)) return;
  if (!fs.lstatSync(dir).isDirectory()) throw new Error(`not a directory: ${dir}`);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error(`refusing symlink: ${f}`);
    if (e.isDirectory()) safeTree(f);
    else if (!e.isFile()) throw new Error(`not a regular file: ${f}`);
  }
};
const destinations = (ctx, browsers) => {
  safePath(ctx.root);
  safePath(ctx.hosts);
  if (B.isDir(ctx.root)) for (const d of fs.readdirSync(ctx.root)) if (VERSION.test(d)) safeTree(path.join(ctx.root, d));
  if (B.isDir(ctx.hosts)) for (const f of fs.readdirSync(ctx.hosts)) safePath(path.join(ctx.hosts, f));
  safePath(path.join(ctx.root, GRANTS));
  for (const b of browsers) safePath(manifestPath(ctx, b));
};
const privateDir = (d) => {
  safePath(d);
  if (fs.existsSync(d) && typeof process.getuid === 'function' && fs.statSync(d).uid !== process.getuid()) throw new Error(`folder belongs to another user: ${d}`);
  fs.mkdirSync(path.dirname(d), { recursive: true });
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  if (MODES) fs.chmodSync(d, 0o700);
};
// Written whole through a rename, and only when it differs (or `force`).
const put = (file, text, mode, force) => {
  safePath(file);
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
  if (fs.existsSync(path.join(dir, 'LICENSE'))) out.push('LICENSE');
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
const granted = (ctx) => {
  const file = path.join(ctx.root, GRANTS);
  safePath(file);
  const g = readJson(file);
  if (!g && !fs.existsSync(file)) return IDS.merge();
  if (!g || g.name !== B.HOST || !Array.isArray(g.ids) || !g.ids.every(IDS.valid)) throw new Error(`refusing unrelated file: ${file}`);
  return IDS.merge(g.ids);
};
// Receipts describe every copied entry. An added or changed file makes a copy ineligible for recursive removal.
const inventory = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((e) => {
  const f = path.join(rel, e.name);
  if (f === RECEIPT) return [];
  if (e.isDirectory()) return [[f, 'dir'], ...inventory(dir, f)];
  return [[f, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')]];
});
const ownedCopy = (dir) => {
  const r = readJson(path.join(dir, RECEIPT));
  return !!r && r.name === 'glaze-mcp' && r.version === versionOf(dir) && JSON.stringify(r.entries) === JSON.stringify(inventory(dir));
};
// <root>/<version>, built beside it and swapped in. Nothing to do when it is already there, or is where this runs from.
const copy = (ctx, version, ifNeeded) => {
  const dest = path.join(ctx.root, version);
  if (fs.existsSync(dest) && !ownedCopy(dest)) throw new Error(`refusing to replace a copy we do not own: ${dest}`);
  if (real(ctx.src) === real(dest) || (ifNeeded ? versionOf(dest) === version && fs.existsSync(path.join(dest, SCRIPT)) : same(ctx.src, dest))) return null;
  const stage = fs.mkdtempSync(path.join(ctx.root, '.copy-'));
  const tmp = path.join(stage, 'new'), old = path.join(stage, 'old');
  try {
    privateDir(tmp);
    for (const f of list(ctx.src)) {
      fs.mkdirSync(path.join(tmp, path.dirname(f)), { recursive: true });
      fs.copyFileSync(path.join(ctx.src, f), path.join(tmp, f));
    }
    fs.writeFileSync(path.join(tmp, RECEIPT), JSON.stringify({ name: 'glaze-mcp', version, entries: inventory(tmp) }));
    if (fs.existsSync(dest)) fs.renameSync(dest, old);
    try { fs.renameSync(tmp, dest); } catch (e) { if (fs.existsSync(old)) fs.renameSync(old, dest); throw e; }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  return dest;
};
const copies = (ctx) => {
  try {
    return fs.readdirSync(ctx.root).filter((d) => VERSION.test(d) && ownedCopy(path.join(ctx.root, d)));
  } catch { return []; }
};
const launchers = (ctx) => {
  let names = [];
  try { names = fs.readdirSync(ctx.hosts); } catch { /* none yet */ }
  const browsers = B.table(ctx.platform, ctx.env);
  return names.map((n) => path.join(ctx.hosts, n)).map((f) => ({ f, l: L.parse(readText(f)) })).filter(({ f, l }) => {
    if (!l || !browsers.some((b) => b.id === l.browser && equalPath(ctx, f, L.file(ctx.platform, ctx.hosts, b.id)))) return false;
    const v = path.relative(ctx.root, l.script).split(path.sep)[0];
    return VERSION.test(v) && equalPath(ctx, l.script, path.join(ctx.root, v, SCRIPT)) && versionOf(path.join(ctx.root, v)) === v;
  });
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
const regExe = (ctx) => {
  const root = ctx.env.SystemRoot || ctx.env.SYSTEMROOT || 'C:\\Windows';
  if (!/^[a-z]:[\\/]/i.test(root) || /["\x00-\x1f]/.test(root)) throw new Error('SystemRoot must be an absolute drive path without invalid characters');
  return path.win32.join(root, 'System32', 'reg.exe');
};
const regDefault = (buf, key) => {
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  const section = text.split(/^\[([^\]\r\n]+)\]\r?$/m);
  const wanted = key.replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\').toLowerCase();
  let body = '';
  for (let i = 1; i < section.length; i += 2) if (section[i].toLowerCase() === wanted) body = section[i + 1];
  const m = body.match(/^@="((?:[^"\\]|\\.)*)"\r?$/m);
  return m ? m[1].replace(/\\(.)/g, '$1') : null;
};
const readKey = async (o, key) => {
  const ctx = context(o);
  const exe = regExe(ctx);
  const dir = fs.mkdtempSync(path.join(ctx.tmp, 'glaze-mcp-reg-'));
  const file = path.join(dir, 'key.reg');
  try {
    await ctx.run(exe, ['export', key, file, '/y']);
    return regDefault(fs.readFileSync(file), key);
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
  destinations(ctx, chosen);
  const grantsFile = path.join(ctx.root, GRANTS);
  out.ids = IDS.merge(granted(ctx), o.ids || []);
  const owner = new Map();
  if (ctx.platform === 'win32') for (const b of chosen) for (const k of b.keys) if (!owner.has(k)) owner.set(k, b);
  // Check every destination before the first write. A reserved name alone does not confer ownership.
  const priorLaunchers = launchers(ctx);
  for (const b of chosen) {
    if (ctx.platform === 'win32' && !b.keys.some((k) => owner.get(k) === b)) continue;
    const launcher = L.file(ctx.platform, ctx.hosts, b.id), mf = manifestPath(ctx, b);
    if (fs.existsSync(launcher) && !priorLaunchers.some(({ f }) => equalPath(ctx, f, launcher))) throw new Error(`refusing unrelated launcher: ${launcher}`);
    if (fs.existsSync(mf) && !ours(ctx, b, mf, readJson(mf))) throw new Error(`refusing unrelated manifest: ${mf}`);
    L.text(ctx.platform, { node: ctx.node, script: path.join(ctx.root, version, SCRIPT), browser: b.id });
  }
  const priorKeys = new Map();
  for (const [k, b] of owner) {
    const v = await readKey(ctx, k);
    priorKeys.set(k, v);
    if (v !== null && !equalPath(ctx, v, manifestPath(ctx, b)) && !all.some((x) => x.keys.includes(k) && equalPath(ctx, v, manifestPath(ctx, x)) && ours(ctx, x, v, readJson(v)))) throw new Error(`refusing registry value we do not own: ${k}`);
  }
  const before = new Set(launchers(ctx).map(({ l }) => path.relative(ctx.root, l.script).split(path.sep)[0]));
  privateDir(ctx.root);
  privateDir(ctx.hosts);
  out.copied = copy(ctx, version, !force);
  const grantsChanged = put(grantsFile, `${JSON.stringify({ name: B.HOST, ids: out.ids })}\n`, 0o600, false);
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
      if (!force && equalPath(ctx, priorKeys.get(k), mf)) continue;
      await ctx.run(regExe(ctx), ['add', k, '/ve', '/t', 'REG_SZ', '/d', mf, '/f']);
      out.keys.push(k);
    }
  }
  if (force) prune(ctx, version, before);
  out.changed = !!(out.copied || out.wrote.length || out.keys.length || grantsChanged);
  return out;
};
const setup = (o = {}) => ensure({ ...o, ifNeeded: false });

const uninstall = async (o = {}) => {
  const ctx = context(o);
  const all = B.table(ctx.platform, ctx.env);
  destinations(ctx, all);
  const removed = [], kept = [];
  if (ctx.platform === 'win32') {
    for (const k of [...new Set(all.flatMap((b) => b.keys))]) {
      const v = await readKey(ctx, k);
      if (v === null) continue;
      const b = all.find((b) => b.keys.includes(k) && equalPath(ctx, manifestPath(ctx, b), v) && ours(ctx, b, v, readJson(v)));
      if (!b) { kept.push(k); continue; }
      await ctx.run(regExe(ctx), ['delete', k, '/ve', '/f']);
      removed.push(k);
    }
  }
  for (const b of all) {
    const f = manifestPath(ctx, b);
    const m = readJson(f);
    if (ours(ctx, b, f, m)) { fs.rmSync(f, { force: true }); removed.push(f); } else if (m && m.name === B.HOST) kept.push(f);
  }
  for (const { f } of launchers(ctx)) { fs.rmSync(f, { force: true }); removed.push(f); }
  for (const v of copies(ctx)) { fs.rmSync(path.join(ctx.root, v), { recursive: true, force: true }); removed.push(path.join(ctx.root, v)); }
  const g = path.join(ctx.root, GRANTS), saved = readJson(g);
  if (saved && saved.name === B.HOST && Array.isArray(saved.ids) && saved.ids.every(IDS.valid)) { fs.rmSync(g); removed.push(g); }
  for (const d of [ctx.hosts, ctx.root]) try { fs.rmdirSync(d); } catch { /* not empty, or gone */ }
  return { removed, kept };
};

module.exports = { DESCRIPTION, context, ensure, setup, uninstall, readKey, versionOf, manifestPath, inside, regExe, runFile, stableNode, safePath, granted };
