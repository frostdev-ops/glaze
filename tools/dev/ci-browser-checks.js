// The browser gate: verified Chromium, settings, popup, site permissions and the student's pointer, one check at a time.
//   NODE_PATH=<pinned playwright> PLAYWRIGHT_BROWSERS_PATH=<dir> nice -n 10 node scripts/ci-browser-checks.js <out dir>
// Holds the shared lock throughout cleanup. Each check gets its own lock and temporary directory.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { lockPath } = require('./check-env.js');

const CHECKS = [
  { name: 'settings', script: 'settings-ia-check.js', limit: 6 * 60 * 1000, env: (dir) => ({ IA_OUT: dir }) },
  { name: 'backup', script: 'backup-check.js', limit: 60 * 1000, args: (dir) => [dir] },
  { name: 'popup', script: 'popup-check.js', args: (dir) => [dir] },
  { name: 'sites', script: 'sites-check.js', args: (dir) => [dir] },
  { name: 'pointer', script: 'pointer-check.js', args: (dir) => [dir] },
  { name: 'register-update', script: 'register-update-check.js', limit: 60 * 1000, args: (dir) => [dir] },
];
const LIMIT = 2 * 60 * 1000, BUDGET = 11 * 60 * 1000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const running = new Set();

// Playwright detaches the browser into another process group. Track descendants too, before their parent can exit.
// Retain start times so escalation never targets a recycled PID; zombies have already stopped executing.
const processes = () => new Map(execFileSync('ps', ['-axo', 'pid=,ppid=,stat=,lstart='], { encoding: 'utf8' }).trim().split('\n').map((line) => {
  const [, pid, parent, status, started] = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
  return [Number(pid), { parent: Number(parent), status, started }];
}));
const track = (state, table = processes()) => {
  const parents = new Set();
  if (table.has(state.pid) && (!state.seen.has(state.pid) || state.seen.get(state.pid) === table.get(state.pid).started)) parents.add(state.pid);
  for (const [pid, started] of state.seen) if (table.get(pid)?.started === started) parents.add(pid);
  for (let changed = true; changed;) {
    changed = false;
    for (const [pid, row] of table) if (parents.has(row.parent) && !parents.has(pid)) { parents.add(pid); changed = true; }
  }
  for (const pid of parents) if (table.has(pid) && !state.seen.has(pid)) state.seen.set(pid, table.get(pid).started);
  return [...state.seen].filter(([pid, started]) => table.get(pid)?.started === started && !table.get(pid).status.startsWith('Z')).map(([pid]) => pid);
};
const stop = (state) => state.stopping ||= (async () => {
  const signal = (pids, name) => { for (const pid of pids.reverse()) { try { process.kill(pid, name); } catch (e) { if (e.code !== 'ESRCH') throw e; } } };
  signal(track(state), 'SIGTERM');
  const end = Date.now() + 5000;
  let live;
  while ((live = track(state)).length && Date.now() < end) await pause(50);
  if (live.length) signal(live, 'SIGKILL');
  for (let i = 0; i < 40 && track(state).length; i++) await pause(50);
  if (track(state).length) throw new Error(`processes survived cleanup for check ${state.pid}`);
})();

// → { code, timedOut, ms }. Resolve only once the browser tree and its temporary files are gone.
async function run(check, out, lock, limit = check.limit || LIMIT) {
  const dir = path.join(out, check.name), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ci-check-'));
  fs.mkdirSync(dir, { recursive: true });
  const log = fs.createWriteStream(path.join(out, `${check.name}.log`)), start = Date.now();
  const child = spawn(process.execPath, [path.resolve(__dirname, check.script), ...(check.args?.(dir) || [])], {
    env: { ...process.env, ...check.env?.(dir), GLAZE_LOCK: lock, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const state = { pid: child.pid, seen: new Map() };
  running.add(state);
  let timedOut = false, error;
  child.on('error', (e) => { error = e; });
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve(code ?? signal ?? 1)));
  for (const [from, to] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) from.on('data', (d) => { to.write(d); log.write(d); });
  const watch = setInterval(() => track(state), 250);
  const timer = setTimeout(() => { timedOut = true; stop(state).catch((e) => { error = e; }); }, limit);
  try {
    track(state);
    const code = await closed;
    clearTimeout(timer);
    await stop(state);
    if (error) throw error;
    return { code, timedOut, ms: Date.now() - start };
  } finally {
    clearTimeout(timer); clearInterval(watch);
    await stop(state);
    running.delete(state);
    fs.rmSync(scratch, { recursive: true, force: true });
    await new Promise((resolve) => log.end(resolve));
  }
}

async function main(out) {
  if (!out) throw new Error('usage: ci-browser-checks.js <out dir>');
  for (const key of ['CHROME', 'EXT', 'IA_CASE']) if (process.env[key]) throw new Error(`unset ${key}; the gate checks the pinned browser and every case in this checkout`);
  require('./ci-chromium.js').verify();
  fs.mkdirSync(out, { recursive: true });
  const shared = lockPath(), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ci-locks-')), deadline = Date.now() + BUDGET;
  let held = false, cancelled = false;
  const cancel = (signal) => {
    cancelled = true;
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
    for (const state of running) stop(state).catch((e) => console.error(e.message));
  };
  const signals = ['SIGINT', 'SIGTERM'].map((name) => [name, () => cancel(name)]);
  for (const [name, handler] of signals) process.on(name, handler);
  try {
    for (let i = 0; !held; i++) {
      if (cancelled) return false;
      if (Date.now() >= deadline) throw new Error(`timed out waiting for ${shared}`);
      try { fs.mkdirSync(shared); held = true; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        if (i % 30 === 0) console.error(`[ci-browser-checks] waiting for ${shared}`);
        await pause(1000);
      }
    }
    fs.writeFileSync(path.join(shared, 'owner'), `${process.pid}\nci-browser-checks\n`);
    const results = [];
    for (const [i, check] of CHECKS.entries()) {
      if (cancelled) break;
      const limit = Math.min(check.limit || LIMIT, deadline - Date.now());
      if (limit <= 0) { console.error('FAIL browser gate exceeded its total time budget'); break; }
      console.log(`\n== ${check.name} (scripts/${check.script})`);
      results.push({ name: check.name, limit, ...await run(check, out, path.join(scratch, `lock-${i}`), limit) });
    }
    console.log('');
    for (const r of results) {
      const why = r.timedOut ? `timed out after ${Math.round(r.limit / 1000)}s` : r.code === 0 ? '' : `exit ${r.code}`;
      console.log(`${why ? 'FAIL' : 'ok  '} ${r.name} ${Math.round(r.ms / 1000)}s${why ? `  ${why}` : ''}`);
    }
    return !cancelled && results.length === CHECKS.length && results.every((r) => r.code === 0 && !r.timedOut);
  } finally {
    await Promise.all([...running].map(stop));
    if (held) fs.rmSync(shared, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    for (const [name, handler] of signals) process.off(name, handler);
  }
}

if (require.main === module) {
  main(process.argv[2] && path.resolve(process.argv[2])).then(
    (ok) => { process.exitCode ||= ok ? 0 : 1; },
    (e) => { console.error(`ci-browser-checks: ${e.message}`); process.exitCode ||= 1; });
}

module.exports = { CHECKS, run, BUDGET };
