// The local engine's reference forward pass (lib/ai/local/reference.js) against llama.cpp on the same GGUF, and any
// two runs against each other (HF transformers too). Not in the suite: it needs the model and hours of CPU.
// A run is a folder of dumps, one per prompt of scripts/local-reference-prompts.json: <id>.json { prompt (token ids),
// gen (greedy: gen[0] from the prompt, gen[s + 1] from decode step s), vocab } and <id>.prefill.f32 / <id>.decode.f32,
// rows of vocab float32 logits: prefill row i predicts token i + 1, decode row s follows feeding gen[s].
//   node scripts/local-reference-check.js tsv <prompts.tsv>          the prompts for scripts/local-reference-logits.cpp
//   llama-logits <model.gguf> - <prompts.tsv> <llama dir> 64 <threads>     (llama.cpp's run; see that file)
//   node scripts/local-reference-check.js reference <model.gguf> <llama dir> <our dir> [--jobs 4] [--steps 64] [--only a,b]
//     our run, from llama.cpp's token ids, each prompt fed in chunks of 128 (the KV cache and conv state carry them)
//   node scripts/local-reference-check.js compare <dir a> <dir b> [--out results.json] [--strict]
//     per prompt: top-1 agreement at every prompt position, greedy tokens, max |Δlogit| (prefill, and decode while
//     the two greedy runs agree). --strict: exit 1 unless every top-1 and every greedy token agrees.
// HF transformers writes the same layout with scripts/local-reference-hf.py.
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const PROMPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'local-reference-prompts.json'), 'utf8')).prompts;
const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const has = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };

// A file as a source for lib/ai/local/gguf.js.
const fileSource = (file) => {
  const fd = fs.openSync(file, 'r');
  return { size: fs.fstatSync(fd).size, read(o, n) { const b = Buffer.allocUnsafe(n); let got = 0; while (got < n) { const r = fs.readSync(fd, b, got, n - got, o + got); if (!r) break; got += r; } return new Uint8Array(b.buffer, b.byteOffset, got); } };
};
// Row i of a dump's .f32 file.
const rows = (file, vocab) => {
  const fd = fs.openSync(file, 'r'), n = fs.fstatSync(fd).size / (4 * vocab);
  return { n, row(i) { const b = Buffer.allocUnsafe(4 * vocab); fs.readSync(fd, b, 0, 4 * vocab, i * 4 * vocab); return new Float32Array(b.buffer, b.byteOffset, vocab); }, close: () => fs.closeSync(fd) };
};
const argmax = (v) => { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; };
const second = (v, best) => { let s = -Infinity; for (let i = 0; i < v.length; i++) if (i !== best && v[i] > s) s = v[i]; return s; };

const mode = args.shift();

if (mode === 'tsv') {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
  fs.writeFileSync(args[0], PROMPTS.map((p) => `${p.id}\t${p.maxTokens || 0}\t${esc(p.text)}`).join('\n') + '\n');
  console.log(`${PROMPTS.length} prompts → ${args[0]}`);
} else if (mode === 'worker') {
  // One child: loads the model once and runs the prompts the parent sends.
  const [model, llamaDir, outDir, steps, chunk] = args;
  const G = require('../lib/ai/local/gguf.js');
  const R = require('../lib/ai/local/reference.js');
  (async () => {
    const t0 = performance.now();
    const m = await R.load(await G.open(fileSource(model)));
    const loadMs = performance.now() - t0;
    process.on('message', (id) => {
      if (id === null) process.exit(0);
      const want = JSON.parse(fs.readFileSync(path.join(llamaDir, `${id}.json`), 'utf8'));
      const s = R.session(m), V = m.config.vocab, n = want.prompt.length;
      const pf = fs.openSync(path.join(outDir, `${id}.prefill.f32`), 'w');
      let last = null;
      const p0 = performance.now();
      for (let i = 0; i < n; i += +chunk) {
        const lg = s.forward(want.prompt.slice(i, i + +chunk), { logits: 'all' });
        fs.writeSync(pf, new Uint8Array(lg.buffer));
        last = lg.subarray(lg.length - V);
      }
      fs.closeSync(pf);
      const prefillMs = performance.now() - p0;
      const gen = [R.greedy(last)];
      const df = fs.openSync(path.join(outDir, `${id}.decode.f32`), 'w');
      const d0 = performance.now();
      for (let k = 0; k < +steps; k++) {
        const lg = s.forward([gen[gen.length - 1]]);
        fs.writeSync(df, new Uint8Array(lg.buffer));
        gen.push(R.greedy(lg));
      }
      fs.closeSync(df);
      const decodeMs = performance.now() - d0;
      fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ id, vocab: V, prompt: want.prompt, gen, prefillMs, decodeMs, loadMs, prefillTokS: n / (prefillMs / 1000), decodeTokS: +steps / (decodeMs / 1000) }) + '\n');
      process.send({ id, n, prefillMs, decodeMs });
    });
    process.send({ ready: true, loadMs });
  })().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === 'reference') {
  const jobs = +flag('--jobs', 4), steps = flag('--steps', '64'), chunk = flag('--chunk', '128'), only = flag('--only', null);
  const [model, llamaDir, outDir] = args;
  if (!model || !llamaDir || !outDir) { console.error('usage: reference <model.gguf> <llama dir> <our dir> [--jobs n] [--steps 64] [--chunk 128] [--only a,b]'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  // The longest prompt first, so it isn't the one left running alone at the end.
  const ids = PROMPTS.map((p) => p.id).filter((id) => !only || only.split(',').includes(id))
    .map((id) => [id, JSON.parse(fs.readFileSync(path.join(llamaDir, `${id}.json`), 'utf8')).prompt.length]).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const queue = [...ids];
  let live = Math.min(jobs, queue.length);
  for (let j = 0; j < live; j++) {
    const child = fork(__filename, ['worker', model, llamaDir, outDir, steps, chunk]);
    const next = () => child.send(queue.length ? queue.shift() : null);
    child.on('message', (msg) => {
      if (msg.ready) console.log(`worker ${j}: model loaded in ${Math.round(msg.loadMs)} ms`);
      else console.log(`${msg.id}: ${msg.n} prompt tokens in ${(msg.prefillMs / 1000).toFixed(1)} s (${(msg.n / (msg.prefillMs / 1000)).toFixed(2)} tok/s), ${steps} decode steps in ${(msg.decodeMs / 1000).toFixed(1)} s (${(+steps / (msg.decodeMs / 1000)).toFixed(2)} tok/s)`);
      next();
    });
    child.on('exit', (code) => { if (code) { console.error(`worker ${j} exited ${code}`); process.exitCode = 1; } if (!--live) console.log('done'); });
  }
} else if (mode === 'compare') {
  const out = flag('--out', null), strict = has('--strict');
  const [aDir, bDir] = args;
  const results = { a: aDir, b: bDir, prompts: [] };
  let allTop1 = true, allGen = true, maxPrefill = 0, maxDecode = 0, agree = 0, total = 0;
  for (const p of PROMPTS) {
    const fa = path.join(aDir, `${p.id}.json`), fb = path.join(bDir, `${p.id}.json`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) { console.log(`${p.id}: missing`); allTop1 = allGen = false; continue; }
    const A = JSON.parse(fs.readFileSync(fa, 'utf8')), B = JSON.parse(fs.readFileSync(fb, 'utf8'));
    if (A.prompt.join() !== B.prompt.join()) { console.log(`${p.id}: different prompt tokens`); allTop1 = allGen = false; continue; }
    const V = A.vocab, n = A.prompt.length;
    const ra = rows(path.join(aDir, `${p.id}.prefill.f32`), V), rb = rows(path.join(bDir, `${p.id}.prefill.f32`), V);
    let same = 0, dmax = 0, dsum = 0;
    const misses = [];
    for (let i = 0; i < n; i++) {
      const x = ra.row(i), y = rb.row(i);
      for (let k = 0; k < V; k++) { const d = Math.abs(x[k] - y[k]); dsum += d; if (d > dmax) dmax = d; }
      const ta = argmax(x), tb = argmax(y);
      if (ta === tb) same++;
      else misses.push({ pos: i, a: ta, b: tb, gapA: +(x[ta] - x[tb]).toFixed(5), gapB: +(y[tb] - y[ta]).toFixed(5), bTop2Gap: +(y[tb] - second(y, tb)).toFixed(5) });
    }
    ra.close(); rb.close();
    // Decode rows compare while both greedy runs fed the same tokens.
    const ga = A.gen, gb = B.gen;
    let firstDiff = 0;
    while (firstDiff < ga.length && firstDiff < gb.length && ga[firstDiff] === gb[firstDiff]) firstDiff++;
    const da = rows(path.join(aDir, `${p.id}.decode.f32`), V), db = rows(path.join(bDir, `${p.id}.decode.f32`), V);
    let ddmax = 0, compared = 0;
    for (let s = 0; s < Math.min(da.n, db.n) && s < firstDiff; s++) {
      const x = da.row(s), y = db.row(s);
      for (let k = 0; k < V; k++) { const d = Math.abs(x[k] - y[k]); if (d > ddmax) ddmax = d; }
      compared++;
    }
    let atDiff = null;
    if (firstDiff < Math.min(ga.length, gb.length) && firstDiff > 0 && firstDiff - 1 < Math.min(da.n, db.n)) {
      const x = da.row(firstDiff - 1), y = db.row(firstDiff - 1);
      atDiff = { step: firstDiff, a: ga[firstDiff], b: gb[firstDiff], gapA: +(x[ga[firstDiff]] - x[gb[firstDiff]]).toFixed(5), gapB: +(y[gb[firstDiff]] - y[ga[firstDiff]]).toFixed(5) };
    }
    da.close(); db.close();
    const genSame = ga.length === gb.length && firstDiff === ga.length;
    const r = { id: p.id, tokens: n, top1: same, of: n, prefillMaxAbs: dmax, prefillMeanAbs: dsum / (n * V), misses, gen: ga.length, genAgree: firstDiff, genSame, decodeCompared: compared, decodeMaxAbs: ddmax, atDiff, speed: A.prefillTokS ? { prefillTokS: A.prefillTokS, decodeTokS: A.decodeTokS } : B.prefillTokS ? { prefillTokS: B.prefillTokS, decodeTokS: B.decodeTokS } : undefined };
    results.prompts.push(r);
    agree += same; total += n;
    if (same !== n) allTop1 = false;
    if (!genSame) allGen = false;
    maxPrefill = Math.max(maxPrefill, dmax); maxDecode = Math.max(maxDecode, ddmax);
    console.log(`${p.id}: top-1 ${same}/${n}, max |Δ| ${dmax.toExponential(3)} (mean ${(dsum / (n * V)).toExponential(2)}); greedy ${firstDiff}/${ga.length} agree, decode max |Δ| ${ddmax.toExponential(3)} over ${compared} steps${misses.length ? `; misses ${JSON.stringify(misses.slice(0, 5))}` : ''}${atDiff ? `; first different token ${JSON.stringify(atDiff)}` : ''}`);
  }
  Object.assign(results, { top1: agree, of: total, allTop1, allGen, prefillMaxAbs: maxPrefill, decodeMaxAbs: maxDecode });
  console.log(`all: top-1 ${agree}/${total} (${total ? ((100 * agree) / total).toFixed(2) : 'n/a'}%), greedy identical on ${results.prompts.filter((r) => r.genSame).length}/${PROMPTS.length}, max |Δ| prefill ${maxPrefill.toExponential(3)}, decode ${maxDecode.toExponential(3)}`);
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
  if (strict && !(allTop1 && allGen)) process.exitCode = 1;
} else {
  console.error('usage: node scripts/local-reference-check.js tsv | reference | compare (see the top of this file)');
  process.exit(2);
}
