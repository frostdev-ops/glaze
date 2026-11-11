// checks/checks.json and tools/dev/all-checks.js: every browser check is listed with how it is called and what it needs, and the
// sweep runs them where it is told to. Dispatch is tested with a fake spawn: no browser, no runner.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawn: realSpawn } = require('node:child_process');
const A = require('../../tools/dev/all-checks.js');

const ROOT = path.join(__dirname, '../..');
const scratch = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sweep-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

// ---- the manifest -----------------------------------------------------------------------------------------------------------

test('every check file has an entry and every entry names a file', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks/checks.json'), 'utf8'));
  const files = A.discover(ROOT), keys = Object.keys(manifest.checks);
  assert.deepEqual(files.filter((f) => !keys.includes(f)), [], 'a check file with no entry in checks/checks.json');
  assert.deepEqual(keys.filter((k) => !fs.existsSync(path.join(ROOT, 'checks', k))), [], 'an entry whose file is gone');
  assert.ok(files.length >= 160, 'the scan finds the checks');
  assert.ok(files.includes('firefox/firefox-check.mjs') && files.includes('safari/content-navigation-safari-check.py'));
  assert.ok(!files.includes('mocks/ultra-mock.js') && !files.includes('courses/neo-calibrate.js'), 'fixtures and tools are not checks');
});

test('discover takes <area>/*-check.{js,mjs,py} and everything in firefox/ and safari/', (t) => {
  const root = scratch(t);
  for (const f of ['a/x-check.js', 'a/y-check.mjs', 'a/z-check.py', 'a/helper.js', 'a/x-check-sites.js', 'a/sub/deep-check.js', 'firefox/any.mjs', 'safari/any.py', 'mocks/m.js']) {
    fs.mkdirSync(path.dirname(path.join(root, 'checks', f)), { recursive: true });
    fs.writeFileSync(path.join(root, 'checks', f), '');
  }
  assert.deepEqual(A.discover(root), ['a/x-check.js', 'a/y-check.mjs', 'a/z-check.py', 'firefox/any.mjs', 'safari/any.py']);
});

test('verify names each unlisted file and each dangling entry, and every entry\'s run or partOf target', (t) => {
  const root = scratch(t);
  for (const f of ['a/x-check.js', 'a/new-check.js']) { fs.mkdirSync(path.join(root, 'checks/a'), { recursive: true }); fs.writeFileSync(path.join(root, 'checks', f), ''); }
  const tags = { runner: '' };
  const manifest = { tags, checks: { 'a/x-check.js': { needs: ['runner'], limit: 60, args: [] }, 'a/gone-check.js': { needs: ['runner'], limit: 60, args: [] },
    'a/y-check.js': { needs: ['runner'], limit: 60, args: [], run: 'a/none.js' } } };
  assert.throws(() => A.verify(root, manifest), (e) => /a\/new-check\.js has no entry/.test(e.message) && /a\/gone-check\.js: no such file/.test(e.message) && /a\/none\.js/.test(e.message));
});

test('every entry is well formed: a platform, known tags, a limit the runner accepts, {out} the only placeholder', () => {
  const m = A.loadManifest(ROOT);
  const tags = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'checks/checks.json'), 'utf8')).tags);
  const names = new Set();
  for (const c of m.checks) {
    assert.ok(!names.has(c.name), `${c.name} is unique`);
    names.add(c.name);
    assert.ok(c.needs.length && c.needs.every((n) => tags.includes(n)), `${c.key}: needs ${c.needs}`);
    assert.ok(c.needs.some((n) => ['runner', 'mac'].includes(n)) || c.needs.some((n) => ['inputs', 'unknown'].includes(n)), `${c.key} says where it runs`);
    assert.ok(!(c.needs.includes('runner') && c.needs.includes('mac')), `${c.key}: runner and mac exclude each other`);
    if (c.needs.some((n) => ['inputs', 'unknown'].includes(n))) assert.ok(c.why, `${c.key} says why`);
    if (c.needs.some((n) => ['canvas', 'moodle', 'safari'].includes(n))) assert.ok(c.needs.includes('mac'), `${c.key}: the local LMS and Safari are on the Mac`);
    assert.ok(Number.isInteger(c.limit) && c.limit > 0 && c.limit <= 3600, `${c.key}: limit ${c.limit} fits glaze-remote -t`);
    for (const s of [...c.args, ...Object.values(c.env)]) assert.ok(!/\{(?!out\})[^}]*\}/.test(s), `${c.key}: placeholder in ${s}`);
    for (const [k, v] of Object.entries(c.env)) assert.match(k, /^[A-Z][A-Z0-9_]*$/), assert.equal(typeof v, 'string');
  }
});

test('the checks the gate runs are in the manifest as runner checks', () => {
  const { CHECKS } = require('../../tools/dev/ci-browser-checks.js');
  const m = new Map(A.loadManifest(ROOT).checks.map((c) => [`checks/${c.key}`, c]));
  for (const g of CHECKS) assert.ok(m.get(g.script)?.needs.includes('runner'), `${g.name}: ${g.script}`);
});

test('a check not marked for the Mac, Canvas, Moodle or Safari names none of their facilities', () => {
  // Known mentions that are not use: Canvas boards' CANVAS_LOCAL variant, a regexp, a fixture rewrite.
  const exempt = new Set(['courses/canvas-boards-check.js', 'courses/docviewer-check.js', 'looks/motionx-check.js']);
  const bad = [];
  for (const c of A.loadManifest(ROOT).checks) {
    if (!c.needs.includes('runner') || exempt.has(c.key)) continue;
    const src = fs.readFileSync(path.join(ROOT, 'checks', c.run || c.key), 'utf8');
    for (const re of [/sandbox-exec/, /osascript/, /localhost:3000/, /localhost:8081/, /Firefox\.app/]) if (re.test(src)) bad.push(`${c.key} mentions ${re}`);
  }
  assert.deepEqual(bad, []);
});

test('the gate\'s heading names each check by its real path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tools/dev/ci-browser-checks.js'), 'utf8');
  assert.ok(!src.includes('scripts/${check.script}'), 'there is no scripts/ folder');
  const { CHECKS } = require('../../tools/dev/ci-browser-checks.js');
  for (const g of CHECKS) assert.ok(fs.existsSync(path.join(ROOT, g.script)), g.script);
});

// ---- selection --------------------------------------------------------------------------------------------------------------

const check = (key, over = {}) => ({ key, name: path.basename(key).replace(/\.[^.]+$/, ''), area: key.split('/')[0], script: key, args: ['{out}'], env: {}, limit: 300, needs: ['runner'], ...over });
const SET = [
  check('a/one-check.js'), check('a/two-check.js', { needs: ['runner', 'network'] }), check('b/three-check.js', { needs: ['mac', 'canvas'] }),
  check('b/four-check.mjs', { needs: ['mac'] }), check('c/five-check.js', { needs: ['runner', 'linux', 'headed'] }), check('c/six-check.js', { needs: ['inputs'], why: 'a model' }),
  check('c/seven-check.js', { needs: ['unknown'], why: 'cannot tell' }), check('d/eight-check.js', { needs: ['runner'], partOf: 'a/one-check.js' }),
  check('d/nine-check.js', { needs: ['mac', 'moodle'] }), check('d/ten-check.py', { needs: ['mac', 'safari'] }),
];
const reasons = (p) => Object.fromEntries(p.skipped.map((s) => [s.check.name, s.reason]));
const names = (list) => list.map((c) => c.name);

test('where=runner takes runner checks, and says what each other one needs', () => {
  const p = A.plan(SET, { where: 'runner' });
  assert.deepEqual(names(p.run), ['one-check', 'two-check', 'five-check']);
  assert.deepEqual(reasons(p), {
    'three-check': 'needs mac, canvas', 'four-check': 'needs mac', 'six-check': 'needs inputs (a model)', 'seven-check': 'needs unknown (cannot tell)',
    'eight-check': 'part of one-check', 'nine-check': 'needs mac, moodle', 'ten-check': 'needs mac, safari',
  });
});

test('where=mac takes runner and mac checks but not what needs Linux, a display, Canvas, Moodle or Safari, unless --needs', () => {
  assert.deepEqual(names(A.plan(SET, { where: 'mac' }).run), ['one-check', 'two-check', 'four-check']);
  assert.equal(reasons(A.plan(SET, { where: 'mac' }))['five-check'], 'needs linux, headed');
  assert.deepEqual(names(A.plan(SET, { where: 'mac', needs: ['canvas', 'moodle'] }).run), ['one-check', 'two-check', 'three-check', 'four-check', 'nine-check']);
  assert.deepEqual(names(A.plan(SET, { where: 'mac', needs: ['safari'] }).run), ['one-check', 'two-check', 'four-check', 'ten-check']);
  assert.deepEqual(names(A.plan(SET, { where: 'runner', needs: ['canvas'] }).run), ['one-check', 'two-check', 'five-check'], 'Canvas is on the Mac: still needs mac');
});

test('--only takes an area, a name with or without -check, a path, and several; an unknown one is an error', () => {
  assert.deepEqual(names(A.plan(SET, { where: 'runner', only: ['a'] }).run), ['one-check', 'two-check']);
  assert.deepEqual(names(A.plan(SET, { where: 'runner', only: ['five'] }).run), ['five-check']);
  assert.deepEqual(names(A.plan(SET, { where: 'runner', only: ['two-check', 'c/five-check.js'] }).run), ['two-check', 'five-check']);
  assert.deepEqual(A.plan(SET, { where: 'runner', only: ['b'] }).run, []);
  assert.deepEqual(names(A.plan(SET, { where: 'runner', only: ['b'] }).skipped), ['three-check', 'four-check'], 'only what --only chose is reported');
  assert.throws(() => A.plan(SET, { where: 'runner', only: ['nope'] }), /no check matches "nope"/);
  assert.throws(() => A.plan(SET, { where: 'moon' }), /--where/);
});

// ---- the commands -----------------------------------------------------------------------------------------------------------

const CTX = { evidence: '/ev', lock: '/private/tmp/claude-501/glaze-heavy.lock', nodePath: '/Users/jame/Projects/gemino/node_modules' };

test('on the runner: glaze-remote with the evidence folder, TZ=UTC, the check\'s env and limit, /out for {out}', () => {
  const c = check('settings/settings-ia-check.js', { args: [], env: { IA_OUT: '{out}' }, limit: 360 });
  const cmd = A.commandFor(c, 'runner', CTX);
  assert.equal(cmd.command, 'glaze-remote');
  assert.deepEqual(cmd.args, ['-o', '/ev/settings-ia-check', '-e', 'TZ=UTC', '-e', 'IA_OUT=/out', '-t', '360', '--', 'node', 'checks/settings/settings-ia-check.js']);
  const d = A.commandFor(check('ai/local-engine-check.js', { args: ['small', '--out', '{out}'] }), 'runner', CTX);
  assert.deepEqual(d.args.slice(-6), ['--', 'node', 'checks/ai/local-engine-check.js', 'small', '--out', '/out']);
  assert.equal(d.cwd, ROOT);
});

test('on the Mac: nice, the heavy lock, NODE_PATH and TZ, the evidence folder for {out}', () => {
  const c = check('looks/pointer-check.js');
  const cmd = A.commandFor(c, 'mac', CTX);
  assert.equal(cmd.command, 'nice');
  assert.deepEqual(cmd.args, ['-n', '10', 'lockf', '-k', CTX.lock, 'env', `NODE_PATH=${CTX.nodePath}`, 'TZ=UTC', 'node', 'checks/looks/pointer-check.js', '/ev/pointer-check']);
  assert.equal(cmd.outDir, '/ev/pointer-check');
  const w = A.commandFor(check('x/w-check.js', { env: { FIREFOX: '/Applications/Firefox.app', SHOTS: '{out}' }, args: [] }), 'mac', CTX);
  assert.deepEqual(w.args.slice(6, 11), [`NODE_PATH=${CTX.nodePath}`, 'TZ=UTC', 'FIREFOX=/Applications/Firefox.app', 'SHOTS=/ev/w-check', 'node']);
});

test('a module runs through the script that runs it; .py runs under python3, .mjs under node', () => {
  const m = check('writer/writer-adversarial-check.js', { script: 'writer/writer-paper-check.js', args: ['{out}', '--adversarial'] });
  assert.deepEqual(A.commandFor(m, 'runner', CTX).args.slice(-4), ['node', 'checks/writer/writer-paper-check.js', '/out', '--adversarial']);
  assert.deepEqual(A.commandFor(check('safari/s-check.py', { args: [] }), 'mac', CTX).args.slice(-2), ['python3', 'checks/safari/s-check.py']);
  assert.deepEqual(A.commandFor(check('firefox/f-check.mjs', { args: [] }), 'runner', CTX).args.slice(-2), ['node', 'checks/firefox/f-check.mjs']);
});

test('loadManifest resolves run into script, defaults args and env, and derives names and areas', () => {
  const m = A.loadManifest(ROOT);
  const adv = m.checks.find((c) => c.key === 'writer/writer-adversarial-check.js');
  assert.equal(adv.script, 'writer/writer-paper-check.js');
  assert.deepEqual(adv.args, ['{out}', '--adversarial']);
  const ia = m.checks.find((c) => c.name === 'settings-ia-check');
  assert.deepEqual([ia.area, ia.script, ia.env], ['settings', 'settings/settings-ia-check.js', { IA_OUT: '{out}' }]);
  assert.deepEqual(m.checks.map((c) => c.key), [...m.checks.map((c) => c.key)].sort(), 'in key order');
});

// ---- dispatch with a fake spawn -----------------------------------------------------------------------------------------------

// behave(call) → { out, err, code, signal, hold: Promise } | { hang: true }. A hanging child ends when it is killed.
const fake = (behave) => {
  const calls = [];
  const spawn = (command, args, options) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 4000 + calls.length, kills: [] });
    const call = { command, args, options, child };
    calls.push(call);
    const finish = (code, signal) => { child.stdout.end(); child.stderr.end(); setImmediate(() => child.emit('close', code, signal)); };
    child.kill = (sig) => { child.kills.push(sig); if (call.hang) finish(null, sig); };
    const b = behave(call) || {};
    call.hang = !!b.hang;
    (async () => {
      if (b.hold) await b.hold;
      else await new Promise((r) => setImmediate(r));
      if (call.hang) return;
      if (b.out) child.stdout.write(b.out);
      if (b.err) child.stderr.write(b.err);
      finish(b.code ?? 0, b.signal ?? null);
    })();
    return child;
  };
  return { spawn, calls };
};
const nameOf = (call) => (call.command === 'glaze-remote' ? call.args[call.args.indexOf('--') + 2] : call.args.at(-2)).replace(/^checks\/.*\//, '').replace(/\.[^.]+$/, '');
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
const opts = (t, extra = {}) => ({ evidence: scratch(t), lock: CTX.lock, nodePath: CTX.nodePath, timers: noTimers, kill: (c, s) => c.kill(s), ...extra });

test('a check that exits 0 passes; non-zero fails with its last lines; the log holds the command and the output', async (t) => {
  const f = fake((c) => (nameOf(c) === 'one-check' ? { out: 'ok one\n' } : { out: Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n', err: 'boom\n', code: 1 }));
  const o = opts(t, { spawn: f.spawn, tailLines: 5 });
  const r = await A.runAll([check('a/one-check.js'), check('a/two-check.js')], 'runner', o);
  assert.deepEqual(r.map((x) => [x.name, x.status, x.code]), [['one-check', 'pass', 0], ['two-check', 'fail', 1]]);
  assert.equal(r[1].tail.length, 5);
  assert.ok(r[1].tail.includes('boom') && r[1].tail.includes('line 39'));
  const log = fs.readFileSync(path.join(o.evidence, 'two-check.log'), 'utf8');
  assert.match(log, /^\$ glaze-remote -o .*two-check .* -- node checks\/a\/two-check\.js \/out\n/);
  assert.ok(log.includes('line 0') && log.includes('boom'), 'the whole output, not the tail');
  assert.ok(Number.isFinite(r[0].ms));
});

test('exit 255 from glaze-remote is runner-failed, never fail, and nothing more goes to the runner; running ones finish', async (t) => {
  const release = {}, held = new Promise((r) => { release.go = r; });
  const f = fake((c) => {
    const n = nameOf(c);
    if (n === 'c1-check') return { out: 'ssh: Could not resolve hostname omarchy.local\n', code: 255 };
    if (n === 'c2-check') return { hold: held, out: 'fine\n' };
    return {};
  });
  const cs = ['c1', 'c2', 'c3', 'c4', 'c5'].map((n) => check(`a/${n}-check.js`));
  const p = A.runAll(cs, 'runner', opts(t, { spawn: f.spawn, jobs: 2 }));
  await new Promise((r) => setTimeout(r, 30));
  release.go();
  const r = await p;
  assert.deepEqual(r.map((x) => x.status), ['runner-failed', 'pass', 'runner-failed', 'runner-failed', 'runner-failed']);
  assert.deepEqual(r.map((x) => x.detail), ['exit 255: the runner failed, not the check', '', 'not dispatched: the runner failed', 'not dispatched: the runner failed', 'not dispatched: the runner failed']);
  assert.deepEqual(f.calls.map(nameOf), ['c1-check', 'c2-check'], 'c3 to c5 were never spawned');
});

test('255 on the Mac is a check\'s own failure', async (t) => {
  const f = fake(() => ({ code: 255 }));
  const r = await A.runAll([check('a/x-check.js')], 'mac', opts(t, { spawn: f.spawn }));
  assert.equal(r[0].status, 'fail');
});

test('exit 124 from glaze-remote -t is timed out', async (t) => {
  const f = fake(() => ({ err: 'job j1 timed out after 300s\n', code: 124 }));
  const r = await A.runAll([check('a/slow-check.js')], 'runner', opts(t, { spawn: f.spawn }));
  assert.equal(r[0].status, 'timed out');
  assert.match(r[0].detail, /limit 300s/);
});

test('a check still running after limit + grace is stopped (SIGTERM, then SIGKILL) and reported timed out', async (t) => {
  const timers = [];
  const fakeTimers = { setTimeout: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; }, clearTimeout: (h) => { if (h) h.cleared = true; } };
  const killed = [];
  const f = fake(() => ({ hang: true, out: 'warming up\n' }));
  const o = opts(t, { spawn: f.spawn, timers: fakeTimers, graceMs: 1000, killAfterMs: 50, kill: (c, s) => { killed.push(s); c.kill(s); } });
  const p = A.runAll([check('a/hang-check.js', { limit: 7 })], 'runner', o);
  await new Promise((r) => setTimeout(r, 20));
  const limit = timers.find((h) => !h.cleared && h.ms === 8000);
  assert.ok(limit, `a timer at limit + grace = 8000 ms (${timers.map((h) => h.ms)})`);
  limit.fn();
  const r = await p;
  assert.deepEqual(killed, ['SIGTERM']);
  assert.equal(r[0].status, 'timed out');
  assert.match(r[0].detail, /limit 7s/);
  assert.ok(r[0].tail.includes('warming up'));
  assert.ok(timers.every((h) => h.cleared || h.ms === 8000 || h.ms === 50), 'no other timer left running');
});

test('a child that ignores SIGTERM gets SIGKILL after killAfterMs', async (t) => {
  const timers = [], killed = [];
  const fakeTimers = { setTimeout: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; }, clearTimeout: (h) => { if (h) h.cleared = true; } };
  const f = fake(() => ({ hang: true }));
  const o = opts(t, { spawn: f.spawn, timers: fakeTimers, graceMs: 0, killAfterMs: 50, kill: (c, s) => { killed.push(s); if (s === 'SIGKILL') c.kill(s); } });
  const p = A.runAll([check('a/stuck-check.js', { limit: 1 })], 'mac', o);
  await new Promise((r) => setTimeout(r, 20));
  timers.find((h) => h.ms === 1000).fn();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(killed, ['SIGTERM']);
  timers.find((h) => h.ms === 50).fn();
  const r = await p;
  assert.deepEqual(killed, ['SIGTERM', 'SIGKILL']);
  assert.equal(r[0].status, 'timed out');
});

test('the runner takes at most --jobs at once, the Mac one', async (t) => {
  for (const [where, jobs, want] of [['runner', 3, 3], ['mac', 8, 1]]) {
    let live = 0, peak = 0;
    const f = fake(() => { live++; peak = Math.max(peak, live); return { hold: new Promise((r) => setTimeout(r, 15)).then(() => { live--; }) }; });
    const r = await A.runAll(Array.from({ length: 9 }, (_, i) => check(`a/c${i}-check.js`)), where, opts(t, { spawn: f.spawn, jobs }));
    assert.equal(peak, want, where);
    assert.deepEqual(r.map((x) => x.status), Array(9).fill('pass'));
    assert.deepEqual(r.map((x) => x.name), Array.from({ length: 9 }, (_, i) => `c${i}-check`), 'results come back in the order given');
  }
});

test('a spawn error (no glaze-remote on the PATH) is a failure with the reason, not a crash', async (t) => {
  const spawn = () => { const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill() {} }); setImmediate(() => c.emit('error', Object.assign(new Error('spawn glaze-remote ENOENT'), { code: 'ENOENT' }))); return c; };
  const r = await A.runAll([check('a/x-check.js')], 'runner', opts(t, { spawn }));
  assert.equal(r[0].status, 'fail');
  assert.match(r[0].detail, /ENOENT/);
});

test('an abort stops what runs and marks the rest not run', async (t) => {
  const ac = new AbortController(), killed = [];
  const f = fake((c) => (nameOf(c) === 'c0-check' ? { hang: true } : {}));
  const p = A.runAll(['c0', 'c1', 'c2'].map((n) => check(`a/${n}-check.js`)), 'mac', opts(t, { spawn: f.spawn, signal: ac.signal, kill: (c, s) => { killed.push(s); c.kill(s); } }));
  await new Promise((r) => setTimeout(r, 20));
  ac.abort();
  const r = await p;
  assert.deepEqual(killed, ['SIGTERM']);
  assert.deepEqual(r.map((x) => [x.status, x.detail]), Array(3).fill(['skipped', 'interrupted']));
});

test('the Mac creates the evidence folder the check will write to, and the lock\'s folder', async (t) => {
  const f = fake(() => ({}));
  const lock = path.join(scratch(t), 'locks/glaze-heavy.lock');
  const o = opts(t, { spawn: f.spawn, lock });
  await A.runAll([check('a/x-check.js')], 'mac', o);
  assert.ok(fs.statSync(path.join(o.evidence, 'x-check')).isDirectory());
  assert.ok(fs.statSync(path.dirname(lock)).isDirectory());
});

// ---- the summary ------------------------------------------------------------------------------------------------------------

const R = (name, status, extra = {}) => ({ key: `a/${name}.js`, name, status, code: status === 'pass' ? 0 : 1, ms: 12000, detail: '', tail: [], ...extra });

test('summary.md: a table row per check, skipped with what it needs, failing output below, counts on top', () => {
  const md = A.renderSummary([
    R('p-check', 'pass'), R('f-check', 'fail', { detail: 'exit 1', tail: ['expected 3', 'got 4'] }), R('t-check', 'timed out', { detail: 'limit 300s', tail: ['stuck'] }),
    R('r-check', 'runner-failed', { detail: 'exit 255: the runner failed, not the check', code: 255, tail: ['no route'] }),
    R('s-check', 'skipped', { detail: 'needs canvas', code: null, ms: null }),
  ], { where: 'runner', jobs: 8, commit: 'abc1234', started: new Date('2026-11-11T10:00:00Z'), finished: new Date('2026-11-11T10:12:03Z') });
  assert.match(md, /^# Check sweep/);
  assert.match(md, /where: runner, 8 at once/);
  assert.match(md, /tree: abc1234/);
  assert.match(md, /took 12m 03s/);
  assert.match(md, /5 checks: 1 pass, 1 fail, 1 timed out, 1 runner-failed, 1 skipped/);
  assert.match(md, /\| a\/p-check\.js \| pass \| 12s \|/);
  assert.match(md, /\| a\/s-check\.js \| skipped: needs canvas \| {2}\|/);
  assert.match(md, /\| a\/t-check\.js \| timed out \| 12s \| limit 300s \|/);
  assert.match(md, /\| a\/r-check\.js \| runner-failed \| 12s \| exit 255: the runner failed, not the check \|/);
  const out = md.slice(md.indexOf('## Output of failing checks'));
  assert.ok(out.includes('### a/f-check.js') && out.includes('expected 3\ngot 4') && out.includes('stuck') && out.includes('no route'));
  assert.ok(!out.includes('p-check') && !out.includes('s-check'));
});

test('--known: a known failure reads (known), a new one NEW, a known one that now passes says so', () => {
  const known = A.parseKnown('# the audit\nf-check   # argv[2] is a filter\n\nok-check\na/other-check.js\n');
  assert.deepEqual([...known].sort(), ['a/other-check.js', 'f-check', 'ok-check']);
  const rs = [R('f-check', 'fail', { tail: ['x'] }), R('n-check', 'fail', { tail: ['y'] }), R('ok-check', 'pass'), R('other-check', 'timed out', { tail: ['z'] })];
  const md = A.renderSummary(rs, { where: 'mac', jobs: 1, known });
  assert.match(md, /\| a\/f-check\.js \| fail \(known\) \|/);
  assert.match(md, /\| a\/n-check\.js \| FAIL \(new\) \|/);
  assert.match(md, /\| a\/ok-check\.js \| pass \(was known failing\) \|/);
  assert.match(md, /\| a\/other-check\.js \| timed out \(known\) \|/);
  assert.match(md, /new failures: 1/);
  assert.ok(md.indexOf('### a/n-check.js') < md.indexOf('### a/f-check.js'), 'new failures first');
  assert.deepEqual(A.exitCode(rs, known), 1);
  assert.equal(A.exitCode([R('f-check', 'fail'), R('ok-check', 'pass')], known), 0, 'only known failures: clean');
  assert.equal(A.exitCode([R('f-check', 'fail')], undefined), 1, 'without a list, every failure is new');
  assert.equal(A.exitCode([R('a', 'pass'), R('b', 'runner-failed')], known), 2, 'a runner failure leaves the sweep incomplete');
  assert.equal(A.exitCode([R('a', 'pass'), R('b', 'skipped')], known), 0);
});

test('table cells and fences survive pipes and backticks in output', () => {
  const md = A.renderSummary([R('a-check', 'fail', { detail: 'a | b', tail: ['``` end of fence', '\u001b[31mred\u001b[0m'] })], { where: 'runner', jobs: 8 });
  assert.match(md, /\| a\/a-check\.js \| fail \| 12s \| a \\\| b \|/);
  assert.ok(md.includes('````\n``` end of fence\nred\n````'), 'a longer fence, colour codes gone');
});

// ---- arguments and a dry run --------------------------------------------------------------------------------------------------

test('arguments: --where is required, lists split on commas, --jobs defaults to the runner\'s 8', () => {
  assert.throws(() => A.parseArgs([]), /--where runner\|mac/);
  assert.throws(() => A.parseArgs(['--where', 'runner', '--bogus']), /unknown option --bogus/);
  assert.throws(() => A.parseArgs(['--where', 'runner', '--jobs', '0']), /--jobs/);
  const a = A.parseArgs(['--where', 'runner', '--only', 'writer,ai/ask-check.js', '--needs', 'canvas,moodle', '--known', 'k.txt', '--evidence', '/e', '--dry-run']);
  assert.deepEqual([a.where, a.only, a.needs, a.known, a.evidence, a.dryRun, a.jobs], ['runner', ['writer', 'ai/ask-check.js'], ['canvas', 'moodle'], 'k.txt', '/e', true, 8]);
  assert.equal(A.parseArgs(['--where', 'mac', '--jobs', '4']).jobs, 1, 'the Mac runs one at a time whatever --jobs says');
});

test('--dry-run prints each command and each skip, spawns nothing, and exits 0', async (t) => {
  const lines = [];
  const f = fake(() => assert.fail('a dry run spawns nothing'));
  const code = await A.main(['--where', 'runner', '--only', 'settings,agents/agent-link-check.js,writer-core,core/widgets-builder-check.js', '--evidence', scratch(t), '--dry-run'], { spawn: f.spawn, log: (s) => lines.push(s) });
  assert.equal(code, 0);
  const text = lines.join('\n');
  assert.match(text, /glaze-remote -o \S+\/settings-ia-check -e TZ=UTC -e IA_OUT=\/out -t 360 -- node checks\/settings\/settings-ia-check\.js/);
  assert.match(text, /-- node checks\/writer\/writer-core-check\.js \/out/);
  assert.match(text, /widgets-builder-check\.js\s+skipped: needs mac/);
  assert.equal(f.calls.length, 0);
});

test('main sweeps, writes summary.md and returns the exit code (known list honoured)', async (t) => {
  const dir = scratch(t), known = path.join(dir, 'known.txt');
  fs.writeFileSync(known, 'settings-ia-check\n');
  const f = fake((c) => (c.args.includes('checks/settings/settings-ia-check.js') ? { out: 'FAIL narrow-320\n', code: 1 } : { out: 'ok\n' }));
  const code = await A.main(['--where', 'runner', '--only', 'settings', '--known', known, '--evidence', path.join(dir, 'ev')], { spawn: f.spawn, log() {}, timers: noTimers, kill: (c, s) => c.kill(s) });
  assert.equal(code, 0, 'the only failure is known');
  const md = fs.readFileSync(path.join(dir, 'ev/summary.md'), 'utf8');
  assert.match(md, /\| settings\/settings-ia-check\.js \| fail \(known\) \|/);
  assert.match(md, /\| settings\/popup-check\.js \| pass \|/);
  assert.match(md, /FAIL narrow-320/);
  assert.ok(f.calls.length >= 10 && f.calls.every((c) => c.command === 'glaze-remote'));
});

test('main refuses a sweep when a check file has no entry', async (t) => {
  const root = scratch(t);
  fs.mkdirSync(path.join(root, 'checks/a'), { recursive: true });
  fs.writeFileSync(path.join(root, 'checks/a/new-check.js'), '');
  fs.writeFileSync(path.join(root, 'checks/checks.json'), JSON.stringify({ tags: { runner: '' }, checks: {} }));
  await assert.rejects(A.main(['--where', 'runner', '--evidence', scratch(t)], { root, spawn: () => assert.fail('nothing spawns'), log() {} }), /a\/new-check\.js has no entry in checks\/checks\.json/);
});

// ---- stopping a process tree --------------------------------------------------------------------------------------------------

test('killTree stops a child and the grandchild it detached into its own group', { skip: process.platform === 'win32' }, async (t) => {
  const code = `const { spawn } = require('node:child_process');
    const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    console.log(g.pid); setInterval(() => {}, 1000);`;
  const child = realSpawn(process.execPath, ['-e', code], { detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  const [chunk] = await new Promise((r) => child.stdout.once('data', (d) => r([d])));
  const grand = Number(String(chunk).trim());
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  t.after(() => { for (const p of [child.pid, grand]) { try { process.kill(p, 'SIGKILL'); } catch {} } });
  assert.ok(alive(child.pid) && alive(grand));
  const closed = new Promise((r) => child.on('close', r));
  await A.killTree(child, 'SIGTERM');
  await closed;
  for (let i = 0; i < 40 && alive(grand); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(!alive(child.pid), 'the child is gone');
  assert.ok(!alive(grand), 'so is the grandchild in its own group');
});
