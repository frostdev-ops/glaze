// The host and agent meet through private run files and sockets. All filesystem operations stay in a verified run
// folder; the token is never exposed through a path replaced between checking the folder and using it.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const BROWSER = /^[a-z][a-z-]{0,31}$/;
const INSTANCE = /^[A-Za-z0-9_-]{1,64}$/;
const RUN = /^([a-z][a-z-]{0,31})\.([A-Za-z0-9_-]{1,64})\.json$/;
const TMP = /^[a-z][a-z-]{0,31}\.[A-Za-z0-9_-]{1,64}\.json\.(\d+)\.[0-9a-f]+\.tmp$/;
const PIPE = /^\\\\\.\\pipe\\glaze-mcp-[0-9a-f]{32}$/;
const TOKEN = /^[A-Za-z0-9+/]{43}=$/;
const SUN = 104, RECORD = 64 * 1024;
const MODES = process.platform !== 'win32';
const LOCK = '.rendezvous.lock';
const REQUIRED = Symbol('required folder');

const unsafe = (message) => Object.assign(new Error(message), { code: 'unsafe' });
const abs = (p, name) => { if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`${name} is not set`); return p; };
const dir = ({ platform = process.platform, env = process.env } = {}) => {
  if (platform === 'win32') return path.join(abs(env.LOCALAPPDATA, 'LOCALAPPDATA'), 'glaze-mcp', 'run');
  const home = abs(env.HOME, 'HOME');
  return platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'glaze-mcp', 'run') : path.join(home, '.local', 'state', 'glaze-mcp', 'run');
};
const folder = (d, st, { uid = MODES && process.getuid ? process.getuid() : null } = {}) => {
  if (st.isSymbolicLink()) throw unsafe(`${d} is a symlink`);
  if (!st.isDirectory()) throw unsafe(`${d} is not a folder`);
  if (uid !== null && st.uid !== uid) throw unsafe(`${d} belongs to another user`);
  if (MODES && (st.mode & 0o777) !== 0o700) throw unsafe(`${d} has mode ${(st.mode & 0o777).toString(8)}, not 700; chmod 700 it`);
};
const check = (d, o) => {
  let st;
  try { st = fs.lstatSync(d); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  folder(d, st, o);
  return true;
};
// Node has no openat/fchdir. Pin the directory with an fd, enter it, then compare its identity before using relative
// names synchronously. Renaming any ancestor afterwards cannot redirect those operations. No await inside this scope.
const within = (d, fn, missing = REQUIRED) => {
  d = path.resolve(d);
  let st;
  try { st = fs.lstatSync(d); } catch (e) {
    if (e.code === 'ENOENT' && missing !== REQUIRED) return missing;
    throw e;
  }
  folder(d, st);
  const was = process.cwd();
  let fd;
  try {
    if (MODES) {
      fd = fs.openSync(d, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(fd);
      folder(d, opened);
      if (opened.dev !== st.dev || opened.ino !== st.ino) throw unsafe(`${d} changed while opening it`);
    }
    process.chdir(d);
    const here = fs.statSync('.');
    folder(d, here);
    if (here.dev !== st.dev || here.ino !== st.ino) throw unsafe(`${d} changed while entering it`);
    return fn();
  } finally {
    try { process.chdir(was); } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
};
const ready = (d, o) => {
  fs.mkdirSync(path.dirname(d), { recursive: true, mode: 0o700 });
  try { fs.mkdirSync(d, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  check(d, o);
  return d;
};
// Serialize cooperating hosts' mutations, including the stale check and unlink. Never reclaim a lock by PID: that
// would race a replacement owner. A process killed in this tiny synchronous section leaves a lock that fails closed.
const locked = (fn) => {
  let fd;
  try { fd = fs.openSync(LOCK, 'wx', 0o600); }
  catch (e) {
    if (e.code === 'EEXIST') throw Object.assign(new Error('run folder is busy (.rendezvous.lock)'), { code: 'EBUSY' });
    throw e;
  }
  try { fs.writeSync(fd, String(process.pid)); return fn(); }
  finally { fs.closeSync(fd); fs.unlinkSync(LOCK); }
};
const base = (browser, instance) => {
  if (typeof browser !== 'string' || !BROWSER.test(browser)) throw new Error(`not a browser id: ${browser}`);
  if (typeof instance !== 'string' || !INSTANCE.test(instance)) throw new Error(`not an instance id: ${instance}`);
  return `${browser}.${instance}`;
};
const runFile = (d, browser, instance) => path.join(d, `${base(browser, instance)}.json`);
const socketPath = (d, browser, instance, { platform = process.platform } = {}) => {
  const name = base(browser, instance);
  return platform === 'win32' ? `\\\\.\\pipe\\glaze-mcp-${crypto.randomBytes(16).toString('hex')}` : path.join(d, `${name}.sock`);
};
const token = () => crypto.randomBytes(32).toString('base64');
const reach = (p, fn) => {
  if (!MODES) return fn(p);
  const name = path.basename(p);
  // Do not prepend "./": the largest valid basename is 102 bytes. Node 18 silently truncates a 104-byte name.
  if (Buffer.byteLength(name) >= SUN) throw unsafe('socket name exceeds 103 bytes');
  return within(path.dirname(p), () => fn(name));
};
const listen = (server, p) => new Promise((resolve, reject) => {
  const error = (e) => { server.off('error', error); reject(e); };
  let ino = null;
  server.once('error', error);
  try {
    reach(p, (name) => {
      const mask = MODES ? process.umask(0o177) : null;
      try {
        server.listen(name, () => { server.off('error', error); resolve(ino); });
        // bind is synchronous on POSIX. Capture the identity in the pinned folder, before yielding to callers.
        if (MODES && server.listening) {
          const st = fs.lstatSync(name);
          if (!st.isSocket()) throw unsafe(`${p} is not our socket`);
          ino = st.ino;
        }
      } finally { if (mask !== null) process.umask(mask); }
    });
  } catch (e) { error(e); }
});
const connect = (p) => reach(p, (name) => net.connect(name));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
// Refuse links, FIFOs, foreign owners and oversized files before reading any contents.
const json = (file, privateMode = true) => {
  let fd;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink()) return undefined;
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const got = fs.fstatSync(fd);
    if (!got.isFile() || got.dev !== st.dev || got.ino !== st.ino || got.size > RECORD) return undefined;
    if (MODES && (got.uid !== process.getuid() || (privateMode && (got.mode & 0o777) !== 0o600))) return undefined;
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch { return undefined; } finally { if (fd !== undefined) fs.closeSync(fd); }
};
const record = (file, r, platform = process.platform) => {
  const m = RUN.exec(path.basename(file));
  if (!m || !r || typeof r !== 'object' || r.v !== 1 || r.browser !== m[1] || r.instance !== m[2]) return null;
  if (!Number.isSafeInteger(r.pid) || r.pid <= 0 || typeof r.token !== 'string' || !TOKEN.test(r.token) || !Number.isFinite(r.at)) return null;
  const where = platform === 'win32' ? PIPE.test(r.path) : r.path === path.join(path.dirname(file), `${m[1]}.${m[2]}.sock`);
  return where ? { v: 1, pid: r.pid, path: r.path, token: r.token, browser: r.browser, instance: r.instance, at: r.at } : null;
};
const read = (file, { platform = process.platform } = {}) => within(path.dirname(file), () => record(file, json(path.basename(file)), platform), null);
const write = (d, rec, ino) => {
  const file = runFile(d, rec.browser, rec.instance), name = path.basename(file);
  return within(d, () => locked(() => {
    const old = json(name, false);
    if (old && old.pid !== process.pid && Number.isSafeInteger(old.pid) && old.pid > 0 && alive(old.pid)) throw unsafe('another live host owns this run file');
    if (MODES && ino) {
      const st = fs.lstatSync(`${base(rec.browser, rec.instance)}.sock`);
      if (!st.isSocket() || st.ino !== ino) throw unsafe('the bound socket was replaced before publication');
    }
    const tmp = `${name}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    let fd, made = false;
    try {
      fd = fs.openSync(tmp, 'wx', 0o600);
      made = true;
      if (MODES) fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, JSON.stringify(rec));
      fs.closeSync(fd);
      fd = undefined;
      for (let i = 0; ; i++) {
        try { fs.renameSync(tmp, name); return file; } catch (e) {
          if (MODES || i >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (made) fs.rmSync(tmp, { force: true });
    }
  }));
};
const claim = (p, { dir = MODES ? path.dirname(p) : null, browser, instance } = {}) => {
  if (!dir) return;
  return within(dir, () => locked(() => {
    const sock = MODES ? path.basename(p) : null;
    let st;
    if (sock) try { st = fs.lstatSync(sock); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const name = `${MODES ? path.basename(p, '.sock') : base(browser, instance)}.json`, r = json(name, false);
    const known = record(path.join(dir, name), r);
    // Only an exact recorded host can be superseded. Unrecorded listeners and unrelated paths stay untouched.
    if (st && (!st.isSocket() || !known)) throw unsafe(`${p} is already claimed`);
    if (!known && r && Number.isSafeInteger(r.pid) && r.pid > 0 && alive(r.pid)) throw unsafe(`${p} belongs to a live host`);
    if (st) fs.unlinkSync(sock);
    // Otherwise a sweeper could use the previous host's metadata to unlink our socket before write publishes it.
    fs.rmSync(name, { force: true });
  }));
};
const list = (d, { platform = process.platform } = {}) => within(d, () => fs.readdirSync('.').filter((n) => RUN.test(n)).map((n) => {
  const file = path.join(d, n), rec = record(file, json(n), platform);
  return { file, rec, alive: !!rec && alive(rec.pid) };
}).filter((e) => e.rec).sort((a, b) => b.rec.at - a.rec.at), []);
const rm = (f, out, d) => { try { fs.unlinkSync(f); out.push(path.join(d, f)); } catch { /* already gone */ } };
const sweep = (d, { ownedOnly = false, platform = process.platform } = {}) => within(d, () => locked(() => {
  const out = [];
  for (const n of fs.readdirSync('.')) {
    const t = TMP.exec(n);
    if (t) {
      const r = ownedOnly ? json(n, false) : null;
      const valid = !ownedOnly || r && r.pid === +t[1] && record(path.join(d, n.slice(0, n.indexOf('.json.') + 5)), r, platform);
      if (valid && !alive(+t[1])) rm(n, out, d);
      continue;
    }
    const m = RUN.exec(n);
    if (!m) continue;
    const r = json(n, false);
    if (ownedOnly && !record(path.join(d, n), r, platform)) continue;
    if (r && Number.isSafeInteger(r.pid) && r.pid > 0 && alive(r.pid)) continue;
    rm(n, out, d);
    // Only a valid, dead host's record authorizes deleting its socket, under the same mutation lock.
    if (!record(path.join(d, n), r, platform)) continue;
    const sock = `${m[1]}.${m[2]}.sock`;
    try {
      const st = fs.lstatSync(sock);
      if (st.isSocket() && (!ownedOnly || !MODES || st.uid === process.getuid())) rm(sock, out, d);
    } catch { /* none */ }
  }
  return out;
}), []);
const remove = (d, { browser, instance, token: tok, ino }) => within(d, () => locked(() => {
  const name = `${base(browser, instance)}.json`, r = json(name);
  if (r && r.token !== tok) return;
  if (r) fs.unlinkSync(name);
  if (!MODES || !ino) return;
  const sock = `${base(browser, instance)}.sock`;
  try { const st = fs.lstatSync(sock); if (st.isSocket() && st.ino === ino) fs.unlinkSync(sock); } catch { /* gone */ }
}));

module.exports = { BROWSER, INSTANCE, dir, check, ready, runFile, socketPath, token, listen, connect, claim, write, read, alive, list, sweep, remove };
