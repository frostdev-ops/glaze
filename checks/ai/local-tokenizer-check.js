// Glaze's local tokenizer (ai/local/tokenizer.js) against a model's own: every line of a JSONL of references
// { text, ids, plain } made with HF tokenizers must give exactly `ids` with added tokens parsed (specials: true), and
// exactly `plain` (HF with its added tokens taken out) the default way, and decode back to the text. Then encode speed.
// Not in the suite: it needs the model's tokenizer.json and the references, which stay out of the repo.
//   node checks/ai/local-tokenizer-check.js <tokenizer.json> <refs.jsonl> [--config tokenizer_config.json]
//     [--gguf kv.json (the GGUF's tokenizer.* keys as JSON: checked the same way)] [--out results.json]
const fs = require('node:fs');
const K = require('../../extension/ai/local/tokenizer.js');

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const config = flag('--config');
const gguf = flag('--gguf');
const out = flag('--out');
const [tokPath, refPath] = args;
if (!tokPath || !refPath) { console.error('usage: node checks/ai/local-tokenizer-check.js <tokenizer.json> <refs.jsonl> [--config f] [--gguf f] [--out f]'); process.exit(2); }

const cfg = config ? JSON.parse(fs.readFileSync(config, 'utf8')) : {};
const name = (t) => (t && typeof t === 'object' ? t.content : t);
const loaders = { hf: () => K.fromHF(JSON.parse(fs.readFileSync(tokPath, 'utf8')), { bos: name(cfg.bos_token), eos: name(cfg.eos_token), pad: name(cfg.pad_token) }) };
if (gguf) loaders.gguf = () => K.fromGGUF(JSON.parse(fs.readFileSync(gguf, 'utf8')));
const refs = fs.readFileSync(refPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const well = (s) => (String.prototype.toWellFormed ? s.toWellFormed() : s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd'));
const bytes = refs.reduce((n, r) => n + Buffer.byteLength(well(r.text)), 0);

const firstDiff = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
const show = (r, ours, want, what) => {
  const i = firstDiff(ours, want);
  return `${what} ${r.src || ''}: first difference at id ${i} of ${want.length}; ours ${JSON.stringify(ours.slice(Math.max(0, i - 3), i + 5))} want ${JSON.stringify(want.slice(Math.max(0, i - 3), i + 5))}; text ${JSON.stringify(r.text.slice(0, 160))}`;
};

const results = { tokenizer: tokPath, references: refPath, lines: refs.length, bytes, runs: {} };
let failed = false;
for (const [label, make] of Object.entries(loaders)) {
  let t0 = performance.now();
  const tk = make();
  const loadMs = performance.now() - t0;
  const bad = [];
  let ok = 0;
  for (const r of refs) {
    const errs = [];
    const sp = [...tk.encode(r.text, { specials: true })];
    if (sp.length !== r.ids.length || firstDiff(sp, r.ids) !== sp.length) errs.push(show(r, sp, r.ids, 'specials'));
    if (r.plain) {
      const pl = [...tk.encode(r.text)];
      if (pl.length !== r.plain.length || firstDiff(pl, r.plain) !== pl.length) errs.push(show(r, pl, r.plain, 'plain'));
      if (tk.decode(pl) !== well(r.text)) errs.push(`decode ${r.src || ''}: ${JSON.stringify(r.text.slice(0, 160))}`);
    }
    if (tk.decode(sp, { specials: true }) !== well(r.text)) errs.push(`decode specials ${r.src || ''}: ${JSON.stringify(r.text.slice(0, 160))}`);
    if (errs.length) bad.push(...errs); else ok++;
  }
  // Speed: a fresh tokenizer (cold word cache), then the same text again (warm).
  const fresh = make();
  const time = (tk2) => { const s = performance.now(); let n = 0; for (const r of refs) n += tk2.encode(r.text).length; return [performance.now() - s, n]; };
  const [coldMs, ids] = time(fresh);
  const [warmMs] = time(fresh);
  const mbs = (ms) => +(bytes / 1e6 / (ms / 1000)).toFixed(2);
  results.runs[label] = { match: ok, of: refs.length, mismatches: bad.slice(0, 50), loadMs: Math.round(loadMs), ids, coldMBs: mbs(coldMs), warmMBs: mbs(warmMs) };
  console.log(`${label}: ${ok}/${refs.length} lines match exactly; load ${Math.round(loadMs)} ms; encode ${(bytes / 1e6).toFixed(2)} MB → ${ids} ids: cold ${mbs(coldMs)} MB/s, warm ${mbs(warmMs)} MB/s`);
  for (const m of bad.slice(0, 20)) console.log(`  ${m}`);
  if (ok !== refs.length) failed = true;
  if (mbs(coldMs) < 1) { console.log(`  cold encode under 1 MB/s`); failed = true; }
}
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
