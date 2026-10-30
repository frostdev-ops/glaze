// One entry of lib/ai/local/models.json (read by lib/ai/local/store.js): a Hugging Face file pinned to a commit, streamed
// once for the SHA-256 of each 64 MB chunk and of the whole file. Size and LFS SHA-256 come from HF's API at that commit;
// the whole-file hash must match it. --local hashes a copy already here instead of downloading, once its size matches.
//   node tools/vendor/model-manifest.js --repo <owner/name> --commit <sha> --file <f.gguf> --tier <n>
//     [--local <path>] [--id <id>] [--name <name>] [--quant <Q>] [--license <id>] [--stock] [--out lib/ai/local/models.json]
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const S = require('../../extension/lib/ai/local/store.js');

const CHUNK = 67108864;
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const bool = (name) => { const i = args.indexOf(name); return i < 0 ? false : (args.splice(i, 1), true); };
const repo = flag('--repo'), commit = flag('--commit'), file = flag('--file'), local = flag('--local');
const tier = Number(flag('--tier')), stock = bool('--stock');
const out = path.resolve(flag('--out') || path.join(__dirname, '../../extension/lib/ai/local/models.json'));
const base = file && path.basename(file).replace(/\.gguf$/i, '');
const id = flag('--id') || (base && base.toLowerCase());
const name = flag('--name') || (base && base.replace(/-/g, ' '));
const quant = flag('--quant') || (base && base.split('-').pop());
let license = flag('--license');
if (!repo || !/^[0-9a-f]{40}$/.test(commit || '') || !file || !Number.isSafeInteger(tier) || args.length) {
  console.error('usage: node scripts/model-manifest.js --repo <owner/name> --commit <40-hex sha> --file <f.gguf> --tier <n> [--local <path>] [--id] [--name] [--quant] [--license] [--stock] [--out]');
  process.exit(2);
}

const api = async (u) => {
  const r = await fetch(`https://huggingface.co/api/models/${repo}/${u}`, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HF API ${u}: ${r.status}`);
  return r.json();
};

(async () => {
  const tree = await api(`tree/${commit}`);
  const meta = tree.find((t) => t.path === file);
  if (!meta) throw new Error(`${file} is not in ${repo} at ${commit}`);
  const size = meta.lfs?.size ?? meta.size, oid = meta.lfs?.oid;
  if (!license) { const card = (await api(`revision/${commit}`)).cardData || {}; license = card.license_name || card.license; }
  if (!license) throw new Error('no license in the model card: pass --license');
  const url = `https://huggingface.co/${repo}/resolve/${commit}/${file}`;

  let stream, from;
  if (local) {
    const have = fs.statSync(local).size;
    if (have !== size) throw new Error(`${local} is ${have} bytes; HF says ${size} at ${commit}`);
    stream = fs.createReadStream(local, { highWaterMark: 8 << 20 }); from = local;
  } else {
    const r = await fetch(url, { redirect: 'follow' });
    if (r.status !== 200) throw new Error(`${url}: ${r.status}`);
    stream = Readable.fromWeb(r.body); from = r.url;
  }

  const total = crypto.createHash('sha256');
  const sums = [];
  let part = crypto.createHash('sha256'), inPart = 0, seen = 0;
  for await (let buf of stream) {
    total.update(buf); seen += buf.length;
    while (buf.length) {
      const take = Math.min(buf.length, CHUNK - inPart);
      part.update(buf.subarray(0, take)); inPart += take; buf = buf.subarray(take);
      if (inPart === CHUNK) { sums.push(part.digest('hex')); part = crypto.createHash('sha256'); inPart = 0; }
    }
  }
  if (inPart) sums.push(part.digest('hex'));
  if (seen !== size) throw new Error(`read ${seen} bytes from ${from}; HF says ${size}`);
  const whole = total.digest('hex');
  if (oid && whole !== oid) throw new Error(`SHA-256 ${whole} is not HF's LFS oid ${oid}`);

  const entry = { id, name, repo, commit, file, url, size, chunk: CHUNK, sha256: sums, total: whole, license, quant, tier, ...(stock && { stock: true }) };
  if (!S.valid(entry)) throw new Error(`the entry would not pass store.valid: ${JSON.stringify({ ...entry, sha256: sums.length })}`);
  const doc = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { models: [] };
  doc.models = [...doc.models.filter((m) => m.id !== id), entry].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${id}: ${size} bytes, ${sums.length} chunks, sha256 ${whole}${oid ? ' (matches HF)' : ''} → ${path.relative(process.cwd(), out)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
