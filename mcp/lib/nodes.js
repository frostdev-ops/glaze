// The node a launcher names. A browser starts launchers outside any agent app, so it must be a node installed on this
// computer, never Claude Desktop's own runtime: Electron (process.versions.electron), which acts as node only under
// ELECTRON_RUN_AS_NODE, so started by a browser it would open Claude; or a node inside Claude's app, which moves at each
// update. ELECTRON_RUN_AS_NODE in a plain node's environment changes nothing, so it alone isn't Claude's. choose() keeps
// the node running this when it is a system one; under Claude it finds one (PATH, then where installers put one), the
// first that is safe to run and says v18 or later, or none. trust() is doctor's check of a path it would run.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MIN = 18;
const MISSING = 'Install Node.js 18+ for browsers to start the helper';
const CLAUDE = /[\\/](?:Claude[^\\/]*\.app|AnthropicClaude|WindowsApps[\\/]Claude[^\\/]*)[\\/]/i;

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const inClaude = (p) => CLAUDE.test(p) || CLAUDE.test(real(p));
const claude = ({ execPath = process.execPath, versions = process.versions } = {}) => !!versions.electron || inClaude(execPath);

// This node, named by the first PATH entry that leads to the same file: Homebrew's own path (…/Cellar/node/<version>)
// goes away at the next upgrade, its /opt/homebrew/bin/node doesn't.
const stable = (exe, platform, env) => {
  const want = real(exe);
  for (const dir of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const c = path.join(dir, platform === 'win32' ? 'node.exe' : 'node');
    if (fs.existsSync(c) && real(c) === want) return c;
  }
  return exe;
};

// nvm's versions under dir, newest first.
const versions = (dir, p, exe) => {
  let names = [];
  try { names = fs.readdirSync(dir).filter((d) => /^v\d+\.\d+\.\d+$/.test(d)); } catch { return []; }
  const n = (v) => v.slice(1).split('.').map(Number);
  return names.sort((a, b) => { const x = n(a), y = n(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; }).map((v) => p.join(dir, v, exe));
};
// Every place to look, in order, each once: PATH as Claude passed it, then installers' folders.
const places = (platform, env) => {
  const win = platform === 'win32', p = win ? path.win32 : path.posix, exe = win ? 'node.exe' : 'node';
  const at = (...parts) => (parts.every((x) => typeof x === 'string' && x) && p.isAbsolute(parts[0]) ? [p.join(...parts)] : []);
  const out = String(env.PATH || env.Path || '').split(win ? ';' : ':').flatMap((d) => at(d, exe));
  if (win) {
    for (const pf of [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']]) out.push(...at(pf, 'nodejs', exe));
    out.push(...at(env.NVM_SYMLINK, exe), ...at(env.LOCALAPPDATA, 'Volta', 'bin', exe));
    if (env.NVM_HOME && p.isAbsolute(env.NVM_HOME)) out.push(...versions(env.NVM_HOME, p, exe));
  } else {
    const home = env.HOME;
    out.push(...(platform === 'darwin' ? ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/opt/local/bin/node'] : ['/usr/local/bin/node', '/usr/bin/node']));
    out.push(...at(home, '.volta', 'bin', exe), ...at(home, '.local', 'bin', exe));
    const nvm = env.NVM_DIR && p.isAbsolute(env.NVM_DIR) ? env.NVM_DIR : home && p.isAbsolute(home) ? p.join(home, '.nvm') : null;
    if (nvm) out.push(...versions(p.join(nvm, 'versions', 'node'), p, 'bin/node'));
  }
  const seen = new Set();
  return out.filter((c) => { const k = win ? c.toLowerCase() : c; return !seen.has(k) && seen.add(k); });
};

// Anyone who can write a file we run, or a folder above it, runs code as this user. Off Windows only (both the platform
// set up and this one). loose(f, st) and path(file) say what is wrong, or null. io: the fs and process to ask (doctor's).
const trust = (platform, fix = '', io = {}) => {
  const F = io.fs || fs, proc = io.process || process;
  const modes = platform !== 'win32' && proc.platform !== 'win32';
  const loose = (f, st) => {
    if (!modes) return null;
    if (st.uid !== 0 && st.uid !== proc.getuid()) return `${f} belongs to another user`;
    // Homebrew uses user-owned 0775 folders with macOS's admin group. Only directories may share that write bit.
    const group = st.gid === proc.getgid() || platform === 'darwin' && st.gid === 80;
    if ((st.mode & 0o002) || (st.mode & 0o020) && !(st.isDirectory() && group)) {
      return `${f} can be changed by other users (mode ${(st.mode & 0o777).toString(8)}); chmod go-w it`;
    }
    return null;
  };
  // Check every ancestor of an execution path, including both sides of symlinks (e.g. a stable Node launcher).
  // Root-owned sticky temp directories protect each checked child's name; an ordinary writable ancestor does not.
  const trustedPath = (file, links = 0) => {
    if (!modes) return null;
    if (!path.isAbsolute(file)) return `${file} must be absolute`;
    if (links > 40) return `${file} has too many symlinks`;
    const root = path.parse(file).root, names = file.slice(root.length).split(path.sep).filter(Boolean);
    let part = root;
    for (let i = -1; i < names.length; i++) {
      if (i >= 0) part = path.join(part, names[i]);
      let st;
      try { st = F.lstatSync(part); } catch { return `${part} is missing.${fix ? ` ${fix}` : ''}`; }
      if (st.uid !== 0 && st.uid !== proc.getuid()) return `${part} belongs to another user`;
      if (st.isSymbolicLink()) {
        const link = F.readlinkSync(part), target = path.isAbsolute(link) ? link : `${path.dirname(part)}${path.sep}${link}`;
        // Resolve links before '..', as the OS does; lexical normalization could check a different executable.
        return trustedPath([target, ...names.slice(i + 1)].join(path.sep), links + 1);
      }
      const sticky = i < names.length - 1 && st.isDirectory() && st.uid === 0 && (st.mode & 0o1000);
      const bad = sticky ? null : loose(part, st);
      if (bad) return bad;
      if (i < names.length - 1 && !st.isDirectory()) return `${part} is not a folder`;
    }
    return null;
  };
  return { modes, loose, path: trustedPath };
};

// The first candidate that is a regular executable file, outside Claude, safe to run, and says v18 or later when asked.
const find = async ({ platform = process.platform, env = process.env, run, list = places(platform, env) } = {}) => {
  const t = trust(platform);
  for (const c of list) {
    if (inClaude(c)) continue;
    let st;
    try { st = fs.statSync(c); } catch { continue; }
    if (!st.isFile() || (t.modes && !(st.mode & 0o111)) || t.path(c)) continue;
    const v = await Promise.resolve().then(() => run(c, ['--version'])).then((r) => String(r.stdout).trim(), () => '');
    const m = /^v(\d+)\.\d+\.\d+/.exec(v);
    if (m && +m[1] >= MIN) return c;
  }
  return null;
};
const choose = async (o = {}) => {
  const platform = o.platform || process.platform, env = o.env || process.env;
  const execPath = o.execPath || process.execPath, vers = o.versions || process.versions;
  return claude({ execPath, versions: vers }) ? find({ ...o, platform, env }) : stable(execPath, platform, env);
};

module.exports = { MIN, MISSING, claude, stable, places, trust, find, choose };
