// The sweep: every browser check in checks/checks.json that can run where it is told to, once each, with a summary.md.
//   node tools/dev/all-checks.js --where runner|mac [--only area,name,...] [--needs canvas,moodle,...] [--jobs 8]
//                                [--known known.txt] [--evidence dir] [--grace secs] [--dry-run]
// runner: each check through `glaze-remote -o <evidence>/<name> -e TZ=UTC -t <limit> -- node checks/<script> /out`, at most
// --jobs at once (the runner's slots). mac: one at a time under `nice -n 10 lockf -k <heavy lock>` with NODE_PATH and TZ=UTC;
// --lock (or GLAZE_HEAVY_LOCK) names the lock file every agent's heavy job takes, --node-path (or NODE_PATH) the Playwright
// install, and the Mac refuses to start without them.
// A check whose needs aren't allowed here is skipped and says what it needs (runner: runner, linux, network, headed; mac:
// runner, mac, network; --needs adds more). glaze-remote's exit 255 means the runner failed: recorded as runner-failed, and
// nothing more goes to the runner. No retries. Exit: 1 a failure or time-out not in --known, else 2 a runner failure, else 0.
const { spawn: nodeSpawn, execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = { runner: ['runner', 'linux', 'network', 'headed'], mac: ['runner', 'mac', 'network'] };
const SLOTS = 8, DEFAULT_LIMIT = 300, GRACE = 600, KILL_AFTER = 10000, TAIL = 25;
const nameOf = (key) => path.basename(key).replace(/\.[^.]+$/, '');

// ---- checks/checks.json ------------------------------------------------------------------------------------------------------

// Every check file: <area>/*-check.{js,mjs,py}, and everything in firefox/ and safari/. Fixtures and tools beside them aren't.
const discover = (root = ROOT) => {
  const base = path.join(root, 'checks'), keys = [];
  for (const area of fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const f of fs.readdirSync(path.join(base, area.name), { withFileTypes: true }).filter((e) => e.isFile())) {
      if (['firefox', 'safari'].includes(area.name) || /-check\.(js|mjs|py)$/.test(f.name)) keys.push(`${area.name}/${f.name}`);
    }
  }
  return keys.sort();
};
const readManifest = (root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, 'checks/checks.json'), 'utf8'));

// Throws, naming each check file with no entry and each entry whose file, run target or partOf target is missing.
const verify = (root = ROOT, manifest = readManifest(root)) => {
  const bad = [], entries = manifest.checks, tags = Object.keys(manifest.tags || {});
  for (const f of discover(root)) if (!entries[f]) bad.push(`${f} has no entry in checks/checks.json`);
  for (const [key, e] of Object.entries(entries)) {
    if (!fs.existsSync(path.join(root, 'checks', key))) bad.push(`${key}: no such file`);
    if (e.run && !fs.existsSync(path.join(root, 'checks', e.run))) bad.push(`${key}: run ${e.run}: no such file`);
    if (e.partOf && !entries[e.partOf]) bad.push(`${key}: partOf ${e.partOf} is not an entry`);
    for (const n of e.needs || []) if (tags.length && !tags.includes(n)) bad.push(`${key}: unknown tag ${n}`);
  }
  if (bad.length) throw new Error(`checks/checks.json does not match checks/:\n  ${bad.join('\n  ')}`);
};

const loadManifest = (root = ROOT) => {
  const raw = readManifest(root);
  const checks = Object.keys(raw.checks).sort().map((key) => {
    const e = raw.checks[key];
    return { key, name: nameOf(key), area: key.split('/')[0], script: e.run || key, args: e.args || [], env: e.env || {}, limit: e.limit || DEFAULT_LIMIT,
      needs: e.needs || [], why: e.why, note: e.note, partOf: e.partOf };
  });
  return { tags: raw.tags, checks };
};

// ---- choosing ----------------------------------------------------------------------------------------------------------------

const matches = (c, t) => [c.area, c.name, c.name.replace(/-check$/, ''), c.key, `checks/${c.key}`].includes(t);

// → { run, skipped: [{ check, reason }] }, in manifest order, over what --only chose.
const plan = (checks, { where, only = [], needs = [] } = {}) => {
  if (!ALLOWED[where]) throw new Error('--where runner|mac');
  const allowed = new Set([...ALLOWED[where], ...needs]);
  if (where === 'runner') allowed.delete('mac');
  for (const t of only) if (!checks.some((c) => matches(c, t))) throw new Error(`no check matches "${t}"`);
  const run = [], skipped = [];
  for (const c of checks.filter((x) => !only.length || only.some((t) => matches(x, t)))) {
    const missing = c.needs.filter((n) => !allowed.has(n));
    if (c.partOf) skipped.push({ check: c, reason: `part of ${nameOf(c.partOf)}` });
    else if (missing.length) skipped.push({ check: c, reason: `needs ${missing.join(', ')}${c.why ? ` (${c.why})` : ''}` });
    else run.push(c);
  }
  return { run, skipped };
};

// ---- the commands ------------------------------------------------------------------------------------------------------------

// {out} is the evidence folder: /out inside the runner's container, <evidence>/<name> on the Mac.
const commandFor = (check, where, ctx = {}) => {
  const { evidence, root = ROOT, lock, nodePath, remote = 'glaze-remote' } = ctx;
  const outDir = path.join(evidence, check.name), script = `checks/${check.script}`;
  const interpreter = script.endsWith('.py') ? 'python3' : 'node';
  const put = (s, out) => s.replaceAll('{out}', out);
  if (where === 'runner') {
    const env = Object.entries(check.env).flatMap(([k, v]) => ['-e', `${k}=${put(v, '/out')}`]);
    return { command: remote, args: ['-o', outDir, '-e', 'TZ=UTC', ...env, '-t', String(check.limit), '--', interpreter, script, ...check.args.map((a) => put(a, '/out'))], cwd: root, outDir };
  }
  if (!lock || !nodePath) throw new Error('--where mac needs --lock <the heavy lock file> and --node-path <Playwright\'s node_modules>');
  const env = Object.entries(check.env).map(([k, v]) => `${k}=${put(v, outDir)}`);
  return { command: 'nice', args: ['-n', '10', 'lockf', '-k', lock, 'env', `NODE_PATH=${nodePath}`, 'TZ=UTC', ...env, interpreter, script, ...check.args.map((a) => put(a, outDir))], cwd: root, outDir };
};

// ---- running -----------------------------------------------------------------------------------------------------------------

// Playwright puts its browser in a process group of its own: signal the child, its group and every descendant ps lists.
function killTree(child, signal = 'SIGTERM') {
  const pid = child.pid;
  if (!pid) return child.kill(signal);
  const pids = new Set([pid]);
  try {
    const kids = new Map();
    for (const line of execFileSync('ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')) {
      const [p, pp] = line.trim().split(/\s+/).map(Number);
      kids.set(pp, [...(kids.get(pp) || []), p]);
    }
    for (const p of pids) for (const k of kids.get(p) || []) pids.add(k);
  } catch { /* ps failed: the group still goes */ }
  try { process.kill(-pid, signal); } catch { /* not a group leader, or gone */ }
  for (const p of [...pids].reverse()) { try { process.kill(p, signal); } catch { /* gone */ } }
}

const result = (check, status, extra = {}) => ({ key: check.key, name: check.name, status, code: null, ms: null, detail: '', tail: [], ...extra });
const skippedResult = (check, reason) => result(check, 'skipped', { detail: reason });

// → the check's result; it resolves once the child is gone and its log is written.
function runCheck(check, where, opts) {
  const { spawn = nodeSpawn, timers = { setTimeout, clearTimeout }, kill = killTree, graceMs = GRACE * 1000, killAfterMs = KILL_AFTER, tailLines = TAIL, signal, evidence } = opts;
  const cmd = commandFor(check, where, opts);
  if (where === 'mac') fs.mkdirSync(cmd.outDir, { recursive: true });
  const log = fs.createWriteStream(path.join(evidence, `${check.name}.log`));
  log.write(`$ ${[cmd.command, ...cmd.args].join(' ')}\n`);
  return new Promise((resolve) => {
    const started = Date.now(), tail = [];
    let partial = '', timedOut = false, interrupted = false, finished = false, limitTimer, killTimer;
    const take = (buf) => {
      log.write(buf);
      const lines = (partial + buf).split('\n');
      partial = lines.pop();
      tail.push(...lines);
      if (tail.length > tailLines) tail.splice(0, tail.length - tailLines);
    };
    const finish = (status, extra) => {
      if (finished) return;
      finished = true;
      timers.clearTimeout(limitTimer); timers.clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      if (partial) { tail.push(partial); if (tail.length > tailLines) tail.shift(); }
      log.end(() => resolve(result(check, status, { ms: Date.now() - started, tail: [...tail], ...extra })));
    };
    const stop = () => {
      kill(child, 'SIGTERM');
      killTimer = timers.setTimeout(() => kill(child, 'SIGKILL'), killAfterMs);
    };
    const onAbort = () => { interrupted = true; stop(); };
    const child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (e) => (where === 'runner' && e.code === 'ENOENT' ? finish('runner-failed', { detail: e.message }) : finish('fail', { detail: e.message })));
    child.on('close', (code, sig) => {
      if (interrupted) return finish('skipped', { code, detail: 'interrupted' });
      if (timedOut || (where === 'runner' && code === 124)) return finish('timed out', { code, detail: `limit ${check.limit}s` });
      if (where === 'runner' && code === 255) return finish('runner-failed', { code, detail: 'exit 255: the runner failed, not the check' });
      if (code === 0) return finish('pass', { code });
      finish('fail', { code, detail: code === null ? `signal ${sig}` : `exit ${code}` });
    });
    limitTimer = timers.setTimeout(() => { timedOut = true; stop(); }, check.limit * 1000 + graceMs);
    if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Results in the order given. The runner takes `jobs` at once and nothing new once it has failed; the Mac one at a time.
async function runAll(checks, where, opts) {
  const { jobs = SLOTS, signal, lock, evidence, onResult } = opts;
  fs.mkdirSync(evidence, { recursive: true });
  if (where === 'mac' && lock) fs.mkdirSync(path.dirname(lock), { recursive: true });
  const results = new Array(checks.length);
  let next = 0, runnerFailed = false;
  const worker = async () => {
    for (let i = next++; i < checks.length; i = next++) {
      const c = checks[i];
      if (signal?.aborted) results[i] = skippedResult(c, 'interrupted');
      else if (runnerFailed) results[i] = result(c, 'runner-failed', { detail: 'not dispatched: the runner failed' });
      else {
        results[i] = await runCheck(c, where, opts);
        if (results[i].status === 'runner-failed') runnerFailed = true;
      }
      onResult?.(results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(where === 'mac' ? 1 : jobs, checks.length) }, worker));
  return results;
}

// ---- summary.md --------------------------------------------------------------------------------------------------------------

const parseKnown = (text) => new Set(text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
const isKnown = (known, r) => !!known && (known.has(r.name) || known.has(r.key));
const isBad = (r) => r.status === 'fail' || r.status === 'timed out';
const duration = (ms) => { const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const fence = (text) => { const f = '`'.repeat(Math.max(2, ...(text.match(/`+/g) || []).map((m) => m.length)) + 1); return `${f}\n${text}\n${f}`; };
const plain = (s) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '');

const label = (r, known) => {
  if (r.status === 'skipped') return `skipped: ${r.detail}`;
  if (!known) return r.status;
  if (r.status === 'pass') return isKnown(known, r) ? 'pass (was known failing)' : 'pass';
  if (isBad(r)) return isKnown(known, r) ? `${r.status} (known)` : `${r.status === 'fail' ? 'FAIL' : 'TIMED OUT'} (new)`;
  return r.status;
};

const renderSummary = (results, { where, jobs, commit, started, finished, known } = {}) => {
  const count = (s) => results.filter((r) => r.status === s).length;
  const out = ['# Check sweep', ''];
  out.push(`- where: ${where}, ${jobs} at once`);
  if (commit) out.push(`- tree: ${commit}`);
  if (started) out.push(`- started: ${started.toISOString()}${finished ? `, took ${duration(finished - started)}` : ''}`);
  out.push(`- ${results.length} checks: ${['pass', 'fail', 'timed out', 'runner-failed', 'skipped'].map((s) => `${count(s)} ${s}`).join(', ')}`);
  if (known) out.push(`- new failures: ${results.filter((r) => isBad(r) && !isKnown(known, r)).length}`);
  out.push('', '| check | result | time | detail |', '|---|---|---|---|');
  for (const r of results) {
    const skipped = r.status === 'skipped';
    out.push(`| ${cell(r.key)} | ${cell(label(r, known))} | ${skipped || r.ms == null ? '' : duration(r.ms)} | ${skipped ? '' : cell(r.detail)} |`);
  }
  const shown = results.filter((r) => (isBad(r) || r.status === 'runner-failed') && r.tail.length)
    .sort((a, b) => (isBad(b) && !isKnown(known, b)) - (isBad(a) && !isKnown(known, a)));
  if (shown.length) {
    out.push('', '## Output of failing checks');
    for (const r of shown) out.push('', `### ${r.key} (${label(r, known)}${r.detail ? `, ${r.detail}` : ''})`, '', fence(plain(r.tail.join('\n'))));
  }
  return `${out.join('\n')}\n`;
};

const exitCode = (results, known) => {
  if (results.some((r) => isBad(r) && !isKnown(known, r))) return 1;
  return results.some((r) => r.status === 'runner-failed') ? 2 : 0;
};

// ---- the command line --------------------------------------------------------------------------------------------------------

const parseArgs = (argv, env = process.env) => {
  const a = { only: [], needs: [], jobs: SLOTS, dryRun: false };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    let [name, value] = argv[i].split(/=(.*)/s, 2);
    const take = () => { if (value === undefined) value = argv[++i]; if (value === undefined) throw new Error(`${name} needs a value`); return value; };
    if (name === '--where') a.where = take();
    else if (name === '--only') a.only.push(...list(take()));
    else if (name === '--needs') a.needs.push(...list(take()));
    else if (name === '--jobs') { a.jobs = Number(take()); if (!Number.isInteger(a.jobs) || a.jobs < 1) throw new Error('--jobs is a whole number from 1'); }
    else if (name === '--known') a.known = take();
    else if (name === '--evidence') a.evidence = take();
    else if (name === '--grace') a.grace = Number(take());
    else if (name === '--node-path') a.nodePath = take();
    else if (name === '--lock') a.lock = take();
    else if (name === '--dry-run') a.dryRun = true;
    else throw new Error(`unknown option ${name}`);
  }
  if (!ALLOWED[a.where]) throw new Error('--where runner|mac is required');
  if (a.where === 'mac') {
    a.jobs = 1;
    a.lock ??= env.GLAZE_HEAVY_LOCK;
    a.nodePath ??= env.NODE_PATH;
    if (!a.lock || !a.nodePath) throw new Error('--where mac needs --lock <the heavy lock file> and --node-path <Playwright\'s node_modules> (or GLAZE_HEAVY_LOCK and NODE_PATH)');
  }
  return a;
};

const treeState = () => {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    return execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim() ? `${sha} plus uncommitted changes` : sha;
  } catch { return undefined; }
};

async function main(argv = process.argv.slice(2), deps = {}) {
  const { root = ROOT, log = console.log, spawn, timers, kill } = deps;
  const a = parseArgs(argv, deps.env);
  verify(root);
  const { checks, tags } = loadManifest(root);
  for (const n of a.needs) if (!(n in tags)) throw new Error(`unknown --needs "${n}" (tags: ${Object.keys(tags).join(', ')})`);
  const chosen = plan(checks, a);
  const evidence = path.resolve(a.evidence || path.join(os.tmpdir(), `glaze-sweep-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  const ctx = { evidence, root, lock: a.lock, nodePath: a.nodePath };
  if (a.dryRun) {
    for (const c of chosen.run) { const { command, args } = commandFor(c, a.where, ctx); log(`${c.key}  ${[command, ...args].join(' ')}`); }
    for (const s of chosen.skipped) log(`${s.check.key}  skipped: ${s.reason}`);
    log(`${chosen.run.length} would run, ${chosen.skipped.length} skipped`);
    return 0;
  }
  const known = a.known ? parseKnown(fs.readFileSync(a.known, 'utf8')) : undefined;
  fs.mkdirSync(evidence, { recursive: true });
  log(`sweep: ${chosen.run.length} checks to run on the ${a.where}, ${chosen.skipped.length} skipped; evidence in ${evidence}`);
  const ac = new AbortController(), onSignal = () => ac.abort();
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, onSignal);
  const started = new Date();
  let ran;
  try {
    ran = await runAll(chosen.run, a.where, { ...ctx, jobs: a.jobs, spawn, timers, kill, graceMs: a.grace === undefined ? undefined : a.grace * 1000, signal: ac.signal,
      onResult: (r) => log(`${label(r, known).padEnd(14)} ${r.key}${r.ms == null ? '' : `  ${duration(r.ms)}`}`) });
  } finally { for (const s of ['SIGINT', 'SIGTERM']) process.off(s, onSignal); }
  const results = [...ran, ...chosen.skipped.map((s) => skippedResult(s.check, s.reason))].sort((x, y) => (x.key < y.key ? -1 : 1));
  const summary = path.join(evidence, 'summary.md');
  fs.writeFileSync(summary, renderSummary(results, { where: a.where, jobs: a.jobs, commit: deps.commit ?? treeState(), started, finished: new Date(), known }));
  log(`summary: ${summary}`);
  return ac.signal.aborted ? 130 : exitCode(results, known);
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`all-checks: ${e.message}`); process.exitCode = 64; });
}

module.exports = { discover, verify, loadManifest, plan, commandFor, killTree, runCheck, runAll, renderSummary, parseKnown, exitCode, parseArgs, main };
