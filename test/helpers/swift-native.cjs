// Swift's toolchain for the Safari native tests, never an app bundle: typecheck sources as the Mac targets build them
// (Swift 5 with the upcoming features SWIFT_APPROACHABLE_CONCURRENCY turns on, for build-safari.sh's macOS 12), and
// spawn a source in the interpreter, its stdout as JSON lines.
const { spawn, spawnSync } = require('node:child_process');

const supported = process.platform === 'darwin' && spawnSync('xcrun', ['--find', 'swiftc'], { encoding: 'utf8' }).status === 0;
const FEATURES = ['MemberImportVisibility', 'NonisolatedNonsendingByDefault', 'InferIsolatedConformances', 'GlobalActorIsolatedTypesUsability',
  'InferSendableFromCaptures', 'DisableOutwardActorInference'].flatMap((f) => ['-enable-upcoming-feature', f]);
const TARGET = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos12.0`;
const typecheck = (files, flags = []) => spawnSync('xcrun', ['swiftc', '-typecheck', '-target', TARGET, '-swift-version', '5', ...FEATURES, ...flags, ...files],
  { encoding: 'utf8', timeout: 180000 });

// The interpreter on file with args; next() → the next stdout line parsed, rejecting if the program ends first or after ms.
const run = (file, args = [], { flags = [], env } = {}) => {
  const child = spawn('xcrun', ['swift', ...flags, file, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: env || process.env });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const lines = [], waiting = [];
  let ended = false;
  const done = new Promise((resolve) => child.on('close', (code) => {
    ended = true;
    for (const w of waiting.splice(0)) { clearTimeout(w.timer); w.reject(new Error(`swift exited ${code} before a line: ${stderr.slice(-4000)}`)); }
    resolve(code);
  }));
  // Lines end at \n only: readline also ends them at U+2028 and U+2029, which JSONSerialization leaves unescaped.
  let partial = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    const parts = (partial + chunk).split('\n');
    partial = parts.pop();
    for (const l of parts) {
      let m;
      try { m = JSON.parse(l); } catch { m = { raw: l }; }
      const w = waiting.shift();
      if (w) { clearTimeout(w.timer); w.resolve(m); } else lines.push(m);
    }
  });
  const next = (ms = 120000) => (lines.length ? Promise.resolve(lines.shift()) : ended ? Promise.reject(new Error(`swift ended: ${stderr.slice(-4000)}`))
    : new Promise((resolve, reject) => {
      const w = { resolve, reject, timer: setTimeout(() => { waiting.splice(waiting.indexOf(w), 1); reject(new Error(`no line in ${ms} ms: ${stderr.slice(-4000)}`)); }, ms) };
      waiting.push(w);
    }));
  const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
  const stop = async () => {
    const wait = (ms) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); timer.unref(); done.then(() => { clearTimeout(timer); resolve(); }); });
    if (!ended) { child.stdin.end(); await wait(1000); }
    if (!ended) { child.kill('SIGTERM'); await wait(1000); }
    if (!ended && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    return done;
  };
  return { child, next, send, done, stop, stderr: () => stderr };
};

// Typecheck Sparkle callers with its stand-in in the same source unit; never emit a module or build an app.
const sparkleSources = (files, temp) => files.map((file) => {
  const fs = require('node:fs'), path = require('node:path'), src = fs.readFileSync(file, 'utf8');
  if (!/^import Sparkle$/m.test(src)) return file;
  const out = path.join(temp, path.basename(file));
  fs.writeFileSync(out, fs.readFileSync(path.join(__dirname, '../fixtures/sparkle-stand-in.swift'), 'utf8') + src.replace(/^import Sparkle$/m, ''));
  return out;
});

module.exports = { supported, FEATURES, TARGET, typecheck, run, sparkleSources };
