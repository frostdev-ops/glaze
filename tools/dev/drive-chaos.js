#!/usr/bin/env node
// Sync to Google Drive's chaos test, long mode (test/helpers/drive-chaos.cjs): many seeds, each failing one shrunk to the
// fewest operations that still break the same invariant, with its trace. Heavy: run it on the runner, or on the Mac under
//   NODE_PATH=/Users/jame/Projects/gemino/node_modules nice -n 19 taskpolicy -b node tools/dev/drive-chaos.js …
// Options: --from N --count N (seeds; default 1, 200), --ops N (40), --devices N (3), --minutes N (stop after),
// --masks a,b (leave out the operations a known defect needs: test/helpers/drive-chaos.cjs KNOWN; 'all' for every one),
// --shrink (shrink each failing seed), --json FILE (every result), SEED=n replays one seed with its full trace.
'use strict';
const C = require('../../test/helpers/drive-chaos.cjs');

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? d : process.argv[i + 1]; };
const flag = (name) => process.argv.includes(`--${name}`);
const o = { ops: Number(arg('ops', process.env.ITER || 40)), devices: Number(arg('devices', 3)) };
const masks = arg('masks', '');
o.masks = masks === 'all' ? Object.keys(C.KNOWN) : masks.split(',').filter(Boolean);
const from = Number(arg('from', 1)), count = Number(arg('count', 200)), minutes = Number(arg('minutes', 0));

const report = (r) => {
  const kinds = [...new Set(r.failures.map((f) => f.inv))];
  console.log(`seed ${r.seed}: ${r.ok ? 'ok' : `FAIL ${kinds.join(', ')}`}`);
  for (const f of r.failures.slice(0, 6)) console.log(`    ${f.inv}: ${f.msg.slice(0, 400)}`);
  return kinds;
};
const minimal = async (r) => {
  for (const inv of [...new Set(r.failures.map((f) => f.inv))]) {
    const list = await C.shrink(r.seed, r.ops, inv, o);
    const again = await C.play(r.seed, { ...o, list });
    console.log(`  minimal for ${inv} (${list.length} of ${r.ops.length} operations): SEED=${r.seed} list ${JSON.stringify(list)}`);
    for (const line of again.trace) console.log(`    ${line}`);
    for (const f of again.failures.filter((x) => x.inv === inv)) console.log(`    → ${f.inv}: ${f.msg.slice(0, 400)}`);
  }
};

(async () => {
  if (process.env.SEED) {
    const r = await C.play(Number(process.env.SEED), o);
    for (const line of r.trace) console.log(line);
    report(r);
    if (!r.ok && flag('shrink')) await minimal(r);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  const t0 = Date.now(), tally = {}, failing = [], all = [];
  let n = 0;
  for (let seed = from; seed < from + count; seed++) {
    if (minutes && Date.now() - t0 > minutes * 60e3) break;
    const r = await C.play(seed, o);
    n++;
    all.push({ seed, ok: r.ok, failures: r.failures });
    if (r.ok) continue;
    const kinds = report(r);
    for (const k of kinds) tally[k] = (tally[k] || 0) + 1;
    failing.push(seed);
    if (flag('shrink')) await minimal(r);
  }
  console.log(`\n${n} seeds × ${o.ops} operations × ${o.devices} devices in ${Math.round((Date.now() - t0) / 1000)} s; ${failing.length} failing${failing.length ? `: ${failing.join(' ')}` : ''}`);
  if (Object.keys(tally).length) console.log(`by invariant: ${JSON.stringify(tally)}`);
  if (arg('json')) require('node:fs').writeFileSync(arg('json'), JSON.stringify({ o, results: all }, null, 1));
  process.exitCode = failing.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 2; });
