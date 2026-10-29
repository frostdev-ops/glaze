// Where the host and an agent meet: a run folder of the user's own (0700, not a symlink), holding per browser and Glaze
// instance the host's socket <browser>.<instance>.sock (0600; on Windows a named pipe with a random name instead) and its
// run file <browser>.<instance>.json, {v, pid, path, token, browser, instance, at}. Only this user can read the run file,
// so the token in it is what the handshake proves (handshake.js). A host that is killed leaves its files; the next host
// or agent sweeps them once their pid is gone.
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
// macOS's sun_path is 104 bytes with its NUL (Linux's 108): a longer socket path is named from inside its folder.
const SUN = 104;
const MODES = process.platform !== 'win32';

const unsafe = (message) => Object.assign(new Error(message), { code: 'unsafe' });
const abs = (p, name) => { if (typeof p !== 'string' || !path.isAbsolute(p)) throw new Error(`${name} is not set`); return p; };

const dir = ({ platform = process.platform, env = process.env } = {}) => {
  if (platform === 'win32') return path.join(abs(env.LOCALAPPDATA, 'LOCALAPPDATA'), 'glaze-mcp', 'run');
  const home = abs(env.HOME, 'HOME');
  return platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'glaze-mcp', 'run') : path.join(home, '.local', 'state', 'glaze-mcp', 'run');
};

// false while the folder is missing; throws (code 'unsafe') unless it is a real folder, this user's, closed to others.
const check = (d, { uid = MODES && process.getuid ? process.getuid() : null } = {}) => {
  let st;
  try { st = fs.lstatSync(d); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (st.isSymbolicLink()) throw unsafe(`${d} is a symlink`);
  if (!st.isDirectory()) throw unsafe(`${d} is not a folder`);
  if (uid !== null && st.uid !== uid) throw unsafe(`${d} belongs to another user`);
  if (MODES && (st.mode & 0o777) !== 0o700) throw unsafe(`${d} has mode ${(st.mode & 0o777).toString(8)}, not 700; chmod 700 it`);
  return true;
};
const ready = (d, o) => {
  fs.mkdirSync(path.dirname(d), { recursive: true, mode: 0o700 });
  try {
    fs.mkdirSync(d, { mode: 0o700 });
    if (MODES) fs.chmodSync(d, 0o700);
  } catch (e) { if (e.code !== 'EEXIST') throw e; }
  check(d, o);
  return d;
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

// bind and connect take the name at once, so the working folder is put back straight after.
const reach = (p, fn) => {
  if (!MODES || Buffer.byteLength(p) < SUN) return fn(p);
  let was = null;
  try { was = process.cwd(); } catch { /* its folder is gone */ }
  process.chdir(path.dirname(p));
  try { return fn(`./${path.basename(p)}`); } finally { if (was) process.chdir(was); }
};
const listen = (server, p) => new Promise((resolve, reject) => {
  server.once('error', reject);
  reach(p, (name) => server.listen(name, () => { server.off('error', reject); resolve(); }));
});
const connect = (p) => reach(p, (name) => net.connect(name));
// Clears the way for a host's socket: a socket left there (a host gone, or one being replaced) is removed, anything else refused.
const claim = (p) => {
  if (!MODES) return;
  let st;
  try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!st.isSocket()) throw unsafe(`${p} is in the way and is not a socket`);
  fs.unlinkSync(p);
};

// Written beside its name and renamed over it, so a reader sees the old file or the new one, whole.
const write = (d, rec) => {
  const file = runFile(d, rec.browser, rec.instance);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(rec));
    if (MODES) fs.fchmodSync(fd, 0o600);
  } finally { fs.closeSync(fd); }
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return file; } catch (e) {
      // Windows refuses to replace a file another process has open for a moment (an agent reading it).
      if (MODES || i >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
};
const json = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; } };
// The record, or null unless every field fits its file's name and folder.
const read = (file, { platform = process.platform } = {}) => {
  const m = RUN.exec(path.basename(file)), r = json(file);
  if (!m || !r || typeof r !== 'object' || r.v !== 1 || r.browser !== m[1] || r.instance !== m[2]) return null;
  if (!Number.isSafeInteger(r.pid) || r.pid <= 0 || typeof r.token !== 'string' || !TOKEN.test(r.token) || !Number.isFinite(r.at)) return null;
  const where = platform === 'win32' ? PIPE.test(r.path) : r.path === path.join(path.dirname(file), `${m[1]}.${m[2]}.sock`);
  return where ? { v: 1, pid: r.pid, path: r.path, token: r.token, browser: r.browser, instance: r.instance, at: r.at } : null;
};

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
// The run files, newest first: { file, rec, alive }.
const list = (d, o) => {
  let names;
  try { names = fs.readdirSync(d); } catch { return []; }
  return names.filter((n) => RUN.test(n)).map((n) => path.join(d, n)).map((file) => {
    const rec = read(file, o);
    return { file, rec, alive: !!rec && alive(rec.pid) };
  }).filter((e) => e.rec).sort((a, b) => b.rec.at - a.rec.at);
};

const rm = (f, out) => { try { fs.unlinkSync(f); out.push(f); } catch { /* already gone */ } };
// Removes run files whose pid is gone (with their sockets), run files that aren't JSON, and writes cut short. A newer
// helper's file (another v) stays while its pid runs.
const sweep = (d) => {
  const out = [];
  let names;
  try { names = fs.readdirSync(d); } catch { return out; }
  for (const n of names) {
    const file = path.join(d, n), t = TMP.exec(n);
    if (t) { if (!alive(+t[1])) rm(file, out); continue; }
    const m = RUN.exec(n);
    if (!m) continue;
    const r = json(file);
    if (r && typeof r === 'object' && Number.isSafeInteger(r.pid) && r.pid > 0 && alive(r.pid)) continue;
    rm(file, out);
    const sock = path.join(d, `${m[1]}.${m[2]}.sock`);
    try { if (fs.lstatSync(sock).isSocket()) rm(sock, out); } catch { /* none */ }
  }
  return out;
};

// A host's own files, unless a newer host for the same name has taken them over: the run file while it holds this
// token, the socket while it is the one this host bound (ino).
const remove = (d, { browser, instance, token: tok, ino }) => {
  const file = runFile(d, browser, instance);
  const r = json(file);
  if (r && r.token === tok) try { fs.unlinkSync(file); } catch { /* gone */ }
  if (!MODES || !ino) return;
  const sock = path.join(d, `${base(browser, instance)}.sock`);
  try { if (fs.lstatSync(sock).ino === ino) fs.unlinkSync(sock); } catch { /* gone */ }
};

module.exports = { BROWSER, INSTANCE, dir, check, ready, runFile, socketPath, token, listen, connect, claim, write, read, alive, list, sweep, remove };
