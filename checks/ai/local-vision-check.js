// The local engine's picture reference (ai/local/vision-reference.js, feeding ai/local/reference.js) against llama.cpp's
// mtmd on the same GGUFs. Not in the suite: it needs the models and an hour of CPU.
// Five synthetic pictures (text, a chart, a table, a diagram, a photo-like gradient) with fixed prompts. A run is a
// folder of dumps per prompt: <id>.json { chunks: [{ text: [ids] } | { image: n }], gen, vocab, embd }, <id>.embd.f32
// (the image's n × embd), <id>.prefill.f32 (a row of vocab logits per text token of the prompt) and <id>.decode.f32 (greedy:
// gen[0] from the prompt, decode row s after feeding gen[s] gives gen[s + 1]).
//   node checks/ai/local-vision-check.js images <dir>          the pictures (<id>-<w>x<h>.rgba) and prompts.tsv
//   llama-vision <model.gguf> <mmproj.gguf> <dir>/prompts.tsv <dir> <llama dir> 32 <threads>   (checks/ai/local-vision-logits.cpp)
//   node checks/ai/local-vision-check.js reference <model.gguf> <mmproj.gguf> <dir> <llama dir> <our dir> [--jobs 5] [--steps 32]
//     our run: the same pictures through vision-reference.js, the same token ids as llama.cpp's chunks
//   node checks/ai/local-vision-check.js compare <dir a> <dir b> [--out results.json] [--strict]
//     per prompt: image tokens, max |Δ| of the embeddings, top-1 at every text position and max |Δlogit|, greedy tokens.
//     --strict: exit 1 unless embeddings are within 1e-3, every top-1 agrees and every greedy run is identical.
// Stock llama.cpp rounds the pixels to f16 before the patchifier (ggml_conv_2d's im2col), and the photo's embeddings
// then differ by 2.6e-3 (llama.cpp's side: a float64 run of this graph is within 4.4e-7 of ours). For the exact
// comparison build llama.cpp with that im2col F32 for F32 kernels (see local-vision-logits.cpp).
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i < 0 ? dflt : args.splice(i, 2)[1]; };
const has = (name) => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const EMBD_TOL = 1e-3;

// ---- the pictures ------------------------------------------------------------------------------------------------------
// A 5 × 7 font: each glyph 7 rows of 5 bits, the high bit on the left.
const FONT = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31], 0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14], 4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
  6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8], 8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 12, 12], '-': [0, 0, 0, 31, 0, 0, 0], ':': [0, 12, 12, 0, 12, 12, 0], '%': [24, 25, 2, 4, 8, 19, 3],
};
const canvas = (w, h, [r, g, b] = [255, 255, 255]) => {
  const d = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[4 * i] = r; d[4 * i + 1] = g; d[4 * i + 2] = b; d[4 * i + 3] = 255; }
  const set = (x, y, [cr, cg, cb]) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const o = 4 * (y * w + x); d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; };
  const rect = (x0, y0, x1, y1, col) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, col); };
  const text = (s, x0, y0, scale, col = [0, 0, 0]) => {
    for (const [k, ch] of [...s].entries()) {
      const gl = FONT[ch] || FONT[' '];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r] & (16 >> c)) rect(x0 + (k * 6 + c) * scale, y0 + r * scale, x0 + (k * 6 + c + 1) * scale, y0 + (r + 1) * scale, col);
    }
  };
  const line = (x0, y0, x1, y1, col, wd = 2) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) { const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n); rect(x - (wd >> 1), y - (wd >> 1), x - (wd >> 1) + wd, y - (wd >> 1) + wd, col); }
  };
  return { w, h, d, set, rect, text, line };
};
const PICTURES = [
  {
    id: 'text', prompt: 'What does the text in this image say?',
    draw: () => {
      const c = canvas(360, 240);
      c.text('MEETING NOTES', 20, 20, 4); c.text('ROOM 214 AT 3:30', 20, 80, 3); c.text('BRING THE LAB REPORT', 20, 125, 3); c.text('DUE FRIDAY.', 20, 170, 3);
      return c;
    },
  },
  {
    id: 'chart', prompt: 'Which bar in this chart is the tallest?',
    draw: () => {
      const c = canvas(300, 200, [250, 250, 250]);
      c.line(40, 20, 40, 170, [40, 40, 40]); c.line(40, 170, 290, 170, [40, 40, 40]);
      const bars = [['A', 60, [220, 60, 60]], ['B', 130, [60, 120, 220]], ['C', 90, [60, 170, 90]], ['D', 40, [230, 160, 40]]];
      bars.forEach(([name, v, col], i) => { const x = 60 + i * 58; c.rect(x, 170 - v, x + 36, 170, col); c.text(name, x + 13, 178, 2); });
      for (const v of [0, 50, 100]) c.text(String(v), 4, 166 - v, 1);
      return c;
    },
  },
  {
    id: 'table', prompt: 'Describe this table.',
    draw: () => {
      const c = canvas(512, 384);
      const rows = [['NAME', 'SCORE', 'GRADE'], ['ANA', '92', 'A'], ['BEN', '78', 'C'], ['CHO', '85', 'B'], ['DEV', '64', 'D']];
      c.rect(16, 16, 496, 80, [210, 225, 245]);
      for (let r = 0; r <= rows.length; r++) c.line(16, 16 + r * 64, 496, 16 + r * 64, [30, 30, 30]);
      for (const x of [16, 208, 352, 496]) c.line(x, 16, x, 336, [30, 30, 30]);
      rows.forEach((row, r) => row.forEach((s, k) => c.text(s, [32, 224, 368][k], 36 + r * 64, 3)));
      return c;
    },
  },
  {
    id: 'diagram', prompt: 'Describe this diagram.',
    draw: () => {
      const c = canvas(400, 400, [255, 255, 255]);
      const box = (x, y, label, col) => { c.rect(x, y, x + 120, y + 60, col); c.rect(x + 3, y + 3, x + 117, y + 57, [255, 255, 255]); c.text(label, x + 12, y + 22, 2); };
      box(140, 30, 'INPUT', [40, 90, 200]); box(30, 170, 'PARSE', [40, 160, 80]); box(250, 170, 'CHECK', [200, 120, 30]); box(140, 310, 'OUTPUT', [180, 40, 40]);
      c.line(200, 90, 90, 170, [20, 20, 20], 3); c.line(200, 90, 310, 170, [20, 20, 20], 3);
      c.line(90, 230, 200, 310, [20, 20, 20], 3); c.line(310, 230, 200, 310, [20, 20, 20], 3);
      return c;
    },
  },
  {
    id: 'photo', prompt: 'Describe this image.',
    draw: () => {
      const c = canvas(500, 375);
      let seed = 12345;
      const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 16) / 65536; };
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
        const sky = y < 220, t = y / c.h;
        let r = sky ? 90 + 120 * t : 60 + 40 * t, g = sky ? 150 + 80 * t : 120 + 50 * t, b = sky ? 230 - 30 * t : 50 + 20 * t;
        const dx = x - 380, dy = y - 80, d = Math.sqrt(dx * dx + dy * dy);
        const sun = Math.max(0, Math.min(1, 40 - d)); // anti-aliased disc edge
        r = r * (1 - sun) + 255 * sun; g = g * (1 - sun) + 230 * sun; b = b * (1 - sun) + 120 * sun;
        const n = (rnd() - 0.5) * 12;
        c.set(x, y, [r + n, g + n, b + n].map((v) => Math.max(0, Math.min(255, Math.round(v)))));
      }
      return c;
    },
  },
];
const promptText = (q) => `<|startoftext|><|im_start|>user\n<__media__>${q}<|im_end|>\n<|im_start|>assistant\n<think></think>`;
const fileOf = (p, c) => `${p.id}-${c.w}x${c.h}.rgba`;

// ---- dumps -------------------------------------------------------------------------------------------------------------
const floats = (file, want) => {
  const b = fs.readFileSync(file);
  if (want !== undefined && b.length !== 4 * want) throw new Error(`${file}: ${b.length} bytes, ${want} floats expected`);
  return new Float32Array(b.buffer, b.byteOffset, b.length / 4);
};
const finite = (v) => { for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false; return true; };
const argmax = (v) => { let b = 0; for (let i = 1; i < v.length; i++) if (v[i] > v[b]) b = i; return b; };
const fileSource = (file) => {
  const fd = fs.openSync(file, 'r');
  return { size: fs.fstatSync(fd).size, read(o, n) { const b = Buffer.allocUnsafe(n); let got = 0; while (got < n) { const r = fs.readSync(fd, b, got, n - got, o + got); if (!r) break; got += r; } return new Uint8Array(b.buffer, b.byteOffset, got); } };
};

const mode = args.shift();

if (mode === 'images') {
  const dir = args[0];
  fs.mkdirSync(dir, { recursive: true });
  const lines = [];
  for (const p of PICTURES) {
    const c = p.draw();
    fs.writeFileSync(path.join(dir, fileOf(p, c)), c.d);
    lines.push(`${p.id}\t${fileOf(p, c)}\t${promptText(p.prompt).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}`);
  }
  fs.writeFileSync(path.join(dir, 'prompts.tsv'), lines.join('\n') + '\n');
  console.log(`${PICTURES.length} pictures and prompts.tsv → ${dir}`);
} else if (mode === 'worker') {
  const [model, mmproj, imgDir, llamaDir, outDir, steps] = args;
  const G = require('../../extension/ai/local/gguf.js');
  const R = require('../../extension/ai/local/reference.js');
  const V = require('../../extension/ai/local/vision-reference.js');
  (async () => {
    const t0 = performance.now();
    const text = await R.load(await G.open(fileSource(model)));
    const vision = await V.load(await G.open(fileSource(mmproj)));
    process.send({ ready: true, loadMs: performance.now() - t0 });
    process.on('message', (id) => {
      if (id === null) process.exit(0);
      const want = JSON.parse(fs.readFileSync(path.join(llamaDir, `${id}.json`), 'utf8'));
      const file = fs.readdirSync(imgDir).find((f) => f.startsWith(`${id}-`) && f.endsWith('.rgba'));
      const [, w, h] = file.match(/-(\d+)x(\d+)\.rgba$/);
      const e0 = performance.now();
      const pre = V.preprocess(vision.config, new Uint8Array(fs.readFileSync(path.join(imgDir, file))), +w, +h);
      const enc = V.encode(vision, pre);
      const encodeMs = performance.now() - e0;
      fs.writeFileSync(path.join(outDir, `${id}.embd.f32`), new Uint8Array(enc.embeddings.buffer));
      const s = R.session(text), Vocab = text.config.vocab;
      const chunks = want.chunks.map((ch) => (ch.text ? { text: ch.text } : { image: enc.n }));
      const parts = chunks.map((ch) => (ch.text ? ch.text : enc.embeddings));
      const p0 = performance.now();
      const rows = V.feed(s, parts, { logits: 'text' });
      const prefillMs = performance.now() - p0;
      fs.writeFileSync(path.join(outDir, `${id}.prefill.f32`), new Uint8Array(rows.buffer));
      const gen = [R.greedy(rows.subarray(rows.length - Vocab))];
      const df = fs.openSync(path.join(outDir, `${id}.decode.f32`), 'w');
      const d0 = performance.now();
      for (let k = 0; k < +steps; k++) {
        const lg = s.forward([gen[gen.length - 1]]);
        fs.writeSync(df, new Uint8Array(lg.buffer));
        gen.push(R.greedy(lg));
      }
      fs.closeSync(df);
      const decodeMs = performance.now() - d0;
      const promptTokens = chunks.reduce((n, ch) => n + (ch.text ? ch.text.length : ch.image), 0);
      fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ id, vocab: Vocab, embd: text.config.nEmbd, size: [pre.width, pre.height], chunks, gen, encodeMs, prefillMs, decodeMs, promptTokens }) + '\n');
      process.send({ id, n: enc.n, size: [pre.width, pre.height], promptTokens, encodeMs, prefillMs, decodeMs });
    });
  })().catch((e) => { console.error(e); process.exit(1); });
} else if (mode === 'reference') {
  const jobs = +flag('--jobs', 5), steps = flag('--steps', '32');
  const [model, mmproj, imgDir, llamaDir, outDir] = args;
  if (!outDir) { console.error('usage: reference <model.gguf> <mmproj.gguf> <image dir> <llama dir> <our dir> [--jobs n] [--steps 32]'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const queue = PICTURES.map((p) => p.id);
  let live = Math.min(jobs, queue.length);
  for (let j = 0; j < live; j++) {
    const child = fork(__filename, ['worker', model, mmproj, imgDir, llamaDir, outDir, steps]);
    const next = () => child.send(queue.length ? queue.shift() : null);
    child.on('message', (m) => {
      if (m.ready) console.log(`worker ${j}: models loaded in ${Math.round(m.loadMs)} ms`);
      else console.log(`${m.id}: ${m.size.join(' × ')} → ${m.n} image tokens, encoded in ${(m.encodeMs / 1000).toFixed(1)} s; ${m.promptTokens} prompt positions in ${(m.prefillMs / 1000).toFixed(1)} s (${(m.promptTokens / (m.prefillMs / 1000)).toFixed(2)} tok/s); ${steps} decode steps in ${(m.decodeMs / 1000).toFixed(1)} s (${(+steps / (m.decodeMs / 1000)).toFixed(2)} tok/s)`);
      next();
    });
    child.on('exit', (code, signal) => {
      if (code !== 0) { console.error(`worker ${j} exited ${signal || code}`); process.exitCode = 1; }
      if (!--live) console.log(process.exitCode ? 'failed' : 'done');
    });
  }
} else if (mode === 'compare') {
  const out = flag('--out', null), strict = has('--strict');
  const [aDir, bDir] = args;
  const results = { a: aDir, b: bDir, embdTolerance: EMBD_TOL, prompts: [] };
  let ok = true, agree = 0, total = 0, maxEmbd = 0, maxPrefill = 0, maxDecode = 0;
  for (const p of PICTURES) {
    const fa = path.join(aDir, `${p.id}.json`), fb = path.join(bDir, `${p.id}.json`);
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) { console.log(`${p.id}: missing`); ok = false; continue; }
    const A = JSON.parse(fs.readFileSync(fa, 'utf8')), B = JSON.parse(fs.readFileSync(fb, 'utf8'));
    const shape = (X) => X.chunks.map((c) => (c.text ? c.text.join(',') : `image ${c.image}`)).join('|');
    if (shape(A) !== shape(B)) { console.log(`${p.id}: different prompts (${shape(A).length} vs ${shape(B).length} chars of chunks)`); ok = false; continue; }
    const Vc = A.vocab, E = A.embd, nImg = A.chunks.find((c) => c.image).image, nText = A.chunks.reduce((n, c) => n + (c.text ? c.text.length : 0), 0);
    const ea = floats(path.join(aDir, `${p.id}.embd.f32`), nImg * E), eb = floats(path.join(bDir, `${p.id}.embd.f32`), nImg * E);
    let emax = 0, esum = 0, emag = 0;
    for (let i = 0; i < ea.length; i++) { const d = Math.abs(ea[i] - eb[i]); esum += d; if (!(d <= emax)) emax = d; emag = Math.max(emag, Math.abs(eb[i])); }
    const pa = floats(path.join(aDir, `${p.id}.prefill.f32`), nText * Vc), pb = floats(path.join(bDir, `${p.id}.prefill.f32`), nText * Vc);
    let same = 0, dmax = 0;
    const misses = [];
    for (let i = 0; i < nText; i++) {
      const x = pa.subarray(i * Vc, (i + 1) * Vc), y = pb.subarray(i * Vc, (i + 1) * Vc);
      if (!finite(x) || !finite(y)) { misses.push({ pos: i, nonFinite: true }); continue; }
      for (let k = 0; k < Vc; k++) { const d = Math.abs(x[k] - y[k]); if (d > dmax) dmax = d; }
      const ta = argmax(x), tb = argmax(y);
      if (ta === tb) same++; else misses.push({ pos: i, a: ta, b: tb, gapA: +(x[ta] - x[tb]).toFixed(5), gapB: +(y[tb] - y[ta]).toFixed(5) });
    }
    const ga = A.gen, gb = B.gen;
    let firstDiff = 0;
    while (firstDiff < ga.length && firstDiff < gb.length && ga[firstDiff] === gb[firstDiff]) firstDiff++;
    const da = floats(path.join(aDir, `${p.id}.decode.f32`), (ga.length - 1) * Vc), db = floats(path.join(bDir, `${p.id}.decode.f32`), (gb.length - 1) * Vc);
    let ddmax = 0, compared = 0;
    for (let s = 0; s < Math.min(ga.length, gb.length) - 1 && s < firstDiff; s++) {
      const x = da.subarray(s * Vc, (s + 1) * Vc), y = db.subarray(s * Vc, (s + 1) * Vc);
      if (!finite(x) || !finite(y)) break;
      for (let k = 0; k < Vc; k++) { const d = Math.abs(x[k] - y[k]); if (d > ddmax) ddmax = d; }
      compared++;
    }
    const genSame = ga.length === gb.length && firstDiff === ga.length;
    const embOk = emax <= EMBD_TOL;
    const r = { id: p.id, imageTokens: nImg, size: A.size || B.size, embdMaxAbs: emax, embdMeanAbs: esum / ea.length, embdMaxMagnitude: emag, embdOk: embOk, textPositions: nText, top1: same, prefillMaxAbs: dmax, misses, gen: ga.length, genAgree: firstDiff, genSame, decodeCompared: compared, decodeMaxAbs: ddmax, genA: ga, genB: gb };
    results.prompts.push(r);
    agree += same; total += nText;
    maxEmbd = Math.max(maxEmbd, emax); maxPrefill = Math.max(maxPrefill, dmax); maxDecode = Math.max(maxDecode, ddmax);
    if (!embOk || same !== nText || !genSame) ok = false;
    console.log(`${p.id}: ${nImg} image tokens, embeddings max |Δ| ${emax.toExponential(3)} (mean ${(esum / ea.length).toExponential(2)}, values up to ${emag.toFixed(2)}); top-1 ${same}/${nText} text positions, max |Δlogit| ${dmax.toExponential(3)}; greedy ${firstDiff}/${ga.length} agree, decode max |Δ| ${ddmax.toExponential(3)} over ${compared} steps${misses.length ? `; misses ${JSON.stringify(misses.slice(0, 5))}` : ''}`);
  }
  Object.assign(results, { ok, top1: agree, of: total, embdMaxAbs: maxEmbd, prefillMaxAbs: maxPrefill, decodeMaxAbs: maxDecode });
  console.log(`all: embeddings max |Δ| ${maxEmbd.toExponential(3)} (target ${EMBD_TOL}), top-1 ${agree}/${total}, greedy identical on ${results.prompts.filter((r) => r.genSame).length}/${PICTURES.length}, max |Δlogit| prefill ${maxPrefill.toExponential(3)}, decode ${maxDecode.toExponential(3)}`);
  if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
  if (strict && !ok) process.exitCode = 1;
} else {
  console.error('usage: node checks/ai/local-vision-check.js images | reference | compare (see the top of this file)');
  process.exit(2);
}
