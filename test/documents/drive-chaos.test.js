// Sync to Google Drive under chaos (test/helpers/drive-chaos.cjs): two or three devices editing documents, Settings, tasks,
// Notes, Looks and Gradescope, with Drive failing and lagging, edits and trash in Drive, Sync off and on, an account change,
// offline, and workers stopped mid-run; then every device converges, nothing is lost, a quiet run writes nothing, Drive
// holds one copy of each document and every device catches up. SEED=<n> [ITER=<ops>] [DEVICES=<n>] runs one seed and prints
// its trace; tools/dev/drive-chaos.js is the long mode (many seeds, shrinking).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../helpers/drive-chaos.cjs');

const ITER = Number(process.env.ITER || 30), DEVICES = Number(process.env.DEVICES || 3);
// Seeds that hit a known defect (C.KNOWN; glaze-plans/release-4.0.1/drive-chaos-findings.md), todo until it is fixed.
const TODO = { 16: 'null-setting', 22: 'null-setting', 27: 'trashed-data', 32: 'missed-file-trash' };
const SEEDS = process.env.SEED ? [Number(process.env.SEED)] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...Object.keys(TODO).map(Number)];
const FINDINGS = 'glaze-plans/release-4.0.1/drive-chaos-findings.md';

const show = (r) => [`seed ${r.seed}:`, ...r.failures.map((f) => `  ${f.inv}: ${f.msg}`), '', ...r.trace, '',
  `replay: SEED=${r.seed} ITER=${ITER} DEVICES=${DEVICES} node --test test/documents/drive-chaos.test.js; shrink: SEED=${r.seed} node tools/dev/drive-chaos.js --ops ${ITER} --devices ${DEVICES} --shrink`].join('\n');

for (const seed of SEEDS) {
  const todo = !process.env.SEED && TODO[seed] ? `known: ${TODO[seed]} (${FINDINGS})` : undefined;
  test(`seed ${seed}: ${ITER} operations on ${DEVICES} devices converge with nothing lost`, { todo }, async () => {
    const r = await C.play(seed, { ops: ITER, devices: DEVICES });
    if (process.env.SEED) console.log(show(r));
    assert.ok(r.ok, show(r));
  });
}

test('a seed plays the same every time: one clock, seeded randomness, every await in order', async () => {
  const a = await C.play(3, { ops: 25, devices: 3 }), b = await C.play(3, { ops: 25, devices: 3 });
  assert.deepEqual(b.trace, a.trace);
  assert.deepEqual(b.failures, a.failures);
  assert.deepEqual(b.stats, a.stats);
});

test('the checks see what they are for: a value one device holds and never sent, a document gone from one device', async () => {
  const list = [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'setting', d: 0, k: 'footer', v: false, pick: 0, s: 2 }, { t: 'run', d: 0, how: 'run', s: 3 }];
  const w = new C.World(1, list, { devices: 2, join: 'all', noCheck: true });
  await w.play();
  assert.deepEqual(await w.check(w.quietRun), [], 'settled');
  // Written past storage (no event, so nothing stamps it): B now holds a value no device sends.
  w.devices[1].disk.sync.set('footer', 'true');
  const kinds = (await w.check(w.quietRun)).map((f) => f.inv);
  assert.ok(kinds.includes('convergence:records'), kinds.join());
  // A document's record gone from B's disk as if never there: B differs, and its token is still on A.
  w.devices[1].disk.sync.set('footer', 'false');
  const key = [...w.devices[1].disk.local.keys()].find((k) => k.startsWith('writerPaper:'));
  w.devices[1].disk.local.delete(key);
  assert.ok((await w.check(w.quietRun)).some((f) => f.inv === 'convergence:docs'));
});

test('a worker stopped at any await of a first push (its write landed or not) still converges', async () => {
  const base = [{ t: 'paper', k: 'new', d: 0, pick: 0, pick2: 0, s: 1 }, { t: 'pdf', k: 'new', d: 0, pick: 0, pick2: 0, s: 2 }, { t: 'setting', d: 0, k: 'footer', v: false, pick: 0, s: 3 }, { t: 'note', k: 'new', d: 0, pick: 0, pick2: 0.9, s: 4 }];
  let stopped = 0;
  for (let kill = 1; ; kill += 17) {
    const r = await C.play(1, { list: [...base, { t: 'run', d: 0, how: 'run', s: 5, kill, apply: kill % 2 === 0 }], devices: 2, join: 'all' });
    if (!r.trace.some((l) => /killed/.test(l))) break;
    stopped++;
    assert.ok(r.ok, show(r));
  }
  assert.ok(stopped > 8, `stopped ${stopped} times`);
});

// Each known defect's fewest operations: todo while it stands, passing once it is fixed (then drop its mask and TODO seeds).
for (const [name, k] of Object.entries(C.KNOWN)) {
  test(`known (${name}): ${k.about}`, { todo: FINDINGS }, async () => {
    const r = await C.play(1, { list: k.repro, devices: 2, join: 'all' });
    assert.ok(r.ok, show(r));
  });
}
