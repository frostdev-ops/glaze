// doctor: reads what setup wrote and says what is wrong with it. It checks our folders (owner and modes), each present
// browser's manifest (or, on Windows, the key that points at it), the extension ids it lets in, its launcher, the node
// that launcher names and that node's version, and which copy it runs. It reads files, runs `node --version` and
// `reg export`, and sends nothing anywhere. `live` is where the host and agent steps add a live handshake: an async
// function returning more rows.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const B = require('./browsers.js');
const IDS = require('./ids.js');
const L = require('./launcher.js');
const I = require('./install.js');

const MIN_NODE = 18;
const FIX = 'Run: npx glaze-mcp setup';
const LABEL = { ok: 'ok', warn: 'warn', fail: 'FAIL', info: '--' };

const run = async (o = {}) => {
  const ctx = I.context(o);
  const rows = [];
  const add = (level, what, detail) => rows.push({ level, what, detail });
  const done = () => ({ ok: !rows.some((r) => r.level === 'fail'), rows });
  const modes = ctx.platform !== 'win32' && process.platform !== 'win32';
  const version = I.versionOf(ctx.src);
  add('info', 'glaze-mcp', `${version} on Node ${process.version}`);

  // Anyone who can write a launcher runs code as this user when the browser starts it.
  const loose = (f, st) => {
    if (!modes) return null;
    if (st.uid !== 0 && st.uid !== process.getuid()) return `${f} belongs to another user`;
    // Homebrew uses user-owned 0775 folders with macOS's admin group. Only directories may share that write bit.
    const group = st.gid === process.getgid() || ctx.platform === 'darwin' && st.gid === 80;
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
      try { st = fs.lstatSync(part); } catch { return `${part} is missing. ${FIX}`; }
      if (st.uid !== 0 && st.uid !== process.getuid()) return `${part} belongs to another user`;
      if (st.isSymbolicLink()) {
        const link = fs.readlinkSync(part), target = path.isAbsolute(link) ? link : `${path.dirname(part)}${path.sep}${link}`;
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
  for (const [what, dir] of [['Folder', ctx.root], ['Launchers', ctx.hosts]]) {
    let st;
    try { I.safePath(dir); } catch (e) { add('fail', what, e.message); return done(); }
    try { st = fs.lstatSync(dir); } catch { add('fail', what, `${dir} is missing. ${FIX}`); return done(); }
    if (st.isSymbolicLink() || !st.isDirectory()) { add('fail', what, `${dir} is not a folder`); return done(); }
    const bad = trustedPath(dir) || loose(dir, st);
    add(bad ? 'fail' : 'ok', what, bad || dir);
    if (bad) return done();
  }

  const nodes = new Map();
  let allowed;
  try { allowed = I.granted(ctx); } catch (e) { add('fail', 'Extension ids', e.message); return done(); }
  const nodeVersion = (node) => {
    if (!nodes.has(node)) nodes.set(node, Promise.resolve(ctx.run(node, ['--version'])).then((r) => String(r.stdout).trim(), () => null));
    return nodes.get(node);
  };
  const keys = new Map();
  const key = (k) => { if (!keys.has(k)) keys.set(k, I.readKey(ctx, k)); return keys.get(k); };

  // What is wrong with one browser's manifest, launcher and node, or [] when nothing is.
  const check = async (b, file) => {
    try { I.safePath(file); } catch (e) { return [e.message]; }
    const fBad = trustedPath(file);
    if (fBad) return [fBad];
    const m = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; } })();
    if (m === undefined) return [`${file} is missing or not JSON. ${FIX}`];
    const out = [];
    if (!m || m.name !== B.HOST) return [`${file} is not named ${B.HOST}. ${FIX}`];
    if (m.type !== 'stdio') out.push(`${file} has type ${m.type}, not stdio`);
    if (b.family === 'firefox') {
      if (!Array.isArray(m.allowed_extensions) || m.allowed_extensions.length !== 1 || m.allowed_extensions[0] !== IDS.FIREFOX) out.push(`${file} must let in only ${IDS.FIREFOX}. ${FIX}`);
    } else {
      const ids = IDS.fromManifest(m);
      if (!ids.includes(IDS.STORE)) out.push(`${file} doesn't let in the store copy of Glaze (${IDS.STORE}). ${FIX}`);
      if (!Array.isArray(m.allowed_origins) || ids.length !== m.allowed_origins.length) out.push(`${file} has allowed_origins that aren't chrome-extension://<id>/`);
      if (ids.some((id) => !allowed.includes(id))) out.push(`${file} lets in extension ids that setup was never given. ${FIX}`);
    }
    const st = fs.statSync(file);
    const mLoose = loose(file, st);
    if (mLoose) out.push(mLoose);
    if (typeof m.path !== 'string') return [...out, `${file} names no launcher`];
    // The browser can't start a launcher it can't find, and says only that the host was not found.
    const notFound = b.family === 'firefox' ? '' : ', which the browser reports as "Specified native messaging host not found."';
    if (ctx.platform !== 'win32' && !path.isAbsolute(m.path)) return [...out, `${file} names its launcher by a relative path${notFound}; it must be absolute. ${FIX}`];
    const launcher = path.resolve(path.dirname(file), m.path);
    if (!I.inside(ctx, ctx.root, launcher)) return [...out, `${file} runs ${launcher}, outside ${ctx.root}`];
    try { I.safePath(launcher); } catch (e) { return [...out, e.message]; }
    const launcherBad = trustedPath(launcher);
    if (launcherBad) return [...out, `launcher ${launcherBad}${notFound}`];
    let text, lst;
    try { text = fs.readFileSync(launcher, 'utf8'); lst = fs.statSync(launcher); } catch { return [...out, `launcher ${launcher} is missing${notFound}. ${FIX}`]; }
    const l = L.parse(text);
    if (!l) return [...out, `${launcher} is not a glaze-mcp launcher. ${FIX}`];
    const vdir = path.dirname(path.dirname(l.script));
    const version = I.versionOf(vdir);
    if (!version || path.dirname(vdir) !== ctx.root || path.basename(vdir) !== version || l.script !== path.join(vdir, 'bin', 'glaze-mcp.js')) return [...out, `${launcher} names no installed glaze-mcp copy. ${FIX}`];
    try { I.safePath(l.script); } catch (e) { return [...out, e.message]; }
    const scriptBad = trustedPath(l.script);
    if (scriptBad) return [...out, scriptBad];
    const lLoose = loose(launcher, lst);
    if (lLoose) out.push(lLoose);
    if (modes && !(lst.mode & 0o100)) out.push(`${launcher} is not executable. ${FIX}`);
    const nodeBad = trustedPath(l.node);
    if (nodeBad) return [...out, nodeBad];
    let nst;
    try { nst = fs.statSync(l.node); } catch { return [...out, `node at ${l.node} is gone. ${FIX}`]; }
    if (!nst.isFile()) out.push(`${l.node} is not a regular file`);
    if (modes && !(nst.mode & 0o111)) out.push(`${l.node} is not executable`);
    if (out.length) return out;
    const v = await nodeVersion(l.node);
    const major = /^v(\d+)\./.exec(v || '');
    if (!major) out.push(`${l.node} didn't say its version`);
    else if (+major[1] < MIN_NODE) out.push(`${l.node} is Node ${v}; glaze-mcp needs ${MIN_NODE} or later. Run setup with a newer Node`);
    if (!fs.existsSync(l.script)) out.push(`${l.script} is missing. ${FIX}`);
    return out;
  };

  const present = B.present(B.table(ctx.platform, ctx.env));
  if (!present.length) add('warn', 'Browsers', 'No supported browser found');
  for (const b of present) {
    let file = I.manifestPath(ctx, b), via = '';
    if (ctx.platform === 'win32') {
      // The key the browser reads first.
      const v = await key(b.keys[0]);
      if (!v) { add('fail', b.name, `${b.keys[0]} is missing. ${FIX}`); continue; }
      file = v;
      via = `${b.keys[0]} → `;
    }
    const problems = await check(b, file);
    if (problems.length) { for (const p of problems) add('fail', b.name, p); continue; }
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    const l = L.parse(fs.readFileSync(path.resolve(path.dirname(file), m.path), 'utf8'));
    const extra = IDS.fromManifest(m).filter((id) => id !== IDS.STORE);
    add('ok', b.name, `${via}${file}${extra.length ? `; also lets in ${extra.join(', ')}` : ''}`);
    const copyVersion = I.versionOf(path.dirname(path.dirname(l.script)));
    if (copyVersion !== version) add('warn', b.name, `runs glaze-mcp ${copyVersion}; this is ${version}. To switch: npx glaze-mcp@${version} setup`);
  }

  for (const [node, v] of nodes) add('info', 'Node', `${node} (${(await v) || 'no version'})`);
  if (typeof o.live === 'function') {
    try { for (const r of (await o.live(ctx)) || []) rows.push(r); } catch (e) { add('fail', 'Live check', e.message); }
  }
  return done();
};

const text = (report) => report.rows.map((r) => `${String(LABEL[r.level] || r.level).padEnd(4)} ${r.what}: ${r.detail}\n`).join('');

module.exports = { run, text };
