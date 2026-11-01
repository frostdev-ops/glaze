// One entry of ai/local/models.json (read by ai/local/store.js): a Hugging Face file pinned to a commit, streamed
// once for the SHA-256 of each 64 MB chunk and of the whole file. Size and LFS SHA-256 come from HF's API at that commit;
// the whole-file hash must match it. --local hashes a copy already here instead of downloading, once its size matches.
//   node tools/vendor/model-manifest.js --repo <owner/name> --commit <sha> --file <f.gguf> --tier <n>
//     [--local <path>] [--id <id>] [--name <name>] [--quant <Q>] [--license <id>] [--stock] [--out ai/local/models.json]
// The picture download's two files take --role instead of --tier: pictures (its language model, with --projector <id>
// naming the other) or projector (the vision encoder and projector, mmproj).
// A Rime size for the signed model list (ai/local/updates.js) adds --tools <n> --version <rN> --min-glaze <x.y.z>, written
// to its own entries file (--out), never models.json. Then (docs/ai-harness.md "Publishing a model"):
//   node tools/vendor/model-manifest.js --keygen ~/.glaze-signing/models.key
//   node tools/vendor/model-manifest.js --sign --entries <entries.json> --key ~/.glaze-signing/models.key --out <glaze-models.json>
//     [--serial <n>] [--offline] [--force-unpinned]
//   The serial defaults to one above the published list's (fetched from updates.js URL); --offline skips that fetch and
//   needs --serial. The private key is never printed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const S = require('../../extension/ai/local/store.js');
const U = require('../../extension/ai/local/updates.js');

const CHUNK = 67108864;
const args = process.argv.slice(2);
if (args[0] === '--keygen' || args[0] === '--sign') {
  const L = require('./model-list.js'), U = require('../../extension/ai/local/updates.js');
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
  (async () => {
    if (args[0] === '--keygen') {
      if (args.length !== 2) throw new Error('usage: --keygen <keyfile>');
      const pub = L.keygen(args[1]);
      console.log(`Private key written to ${args[1]} (mode 600). Keep it offline and back it up.\nPublic key, for KEY in extension/ai/local/updates.js:\n${pub}`);
      return;
    }
    const entriesFile = opt('--entries'), keyFile = opt('--key'), outFile = opt('--out'), offline = args.includes('--offline');
    if (!entriesFile || !keyFile || !outFile) throw new Error('usage: --sign --entries <file> --key <keyfile> --out <file> [--serial n] [--offline] [--force-unpinned]');
    let live = null;
    if (!offline) {
      const r = await fetch(U.URL, { redirect: 'follow', cache: 'no-store' });
      if (r.status === 200) live = await r.json();
      else if (r.status !== 404) throw new Error(`the published list answered ${r.status}; pass --offline --serial <n> to sign without it`);
    } else if (!opt('--serial')) throw new Error('--offline needs --serial');
    const held = live && (await U.verify(live, { serial: 0 })).ok ? live.list.serial : 0;
    if (live && !held) console.warn('The published list does not verify against the bundled key; signing above its serial anyway.');
    const serial = opt('--serial') ? Number(opt('--serial')) : L.nextSerial(live);
    const doc0 = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
    const entries = Array.isArray(doc0) ? doc0 : doc0.models;
    const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, '../../extension/ai/local/models.json'), 'utf8')).models;
    const doc = L.sign(keyFile, { entries, serial, bundled, live: Math.max(held, live?.list?.serial || 0), force: args.includes('--force-unpinned') });
    if (fs.existsSync(outFile) && [keyFile, entriesFile].some((f) => fs.realpathSync(f) === fs.realpathSync(outFile))) throw new Error('the output must not overwrite the key or the entries');
    fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
    console.log(`Signed serial ${doc.list.serial}, issued ${doc.list.issued}: ${doc.list.models.map((m) => `${m.id} ${m.version}`).join(', ')}.\nKey fingerprint ${await U.fingerprint()}. Wrote ${outFile}; upload it to the repo's main as glaze-models.json after the owner's go.`);
  })().catch((e) => { console.error(e.message); process.exit(1); });
  return;
}
const flag = (name) => { const i = args.indexOf(name); return i < 0 ? null : args.splice(i, 2)[1]; };
const bool = (name) => { const i = args.indexOf(name); return i < 0 ? false : (args.splice(i, 1), true); };
const repo = flag('--repo'), commit = flag('--commit'), file = flag('--file'), local = flag('--local');
const toolsArg = flag('--tools'), versionArg = flag('--version'), minGlaze = flag('--min-glaze');
const tierArg = flag('--tier'), tier = tierArg === null ? NaN : Number(tierArg), stock = bool('--stock'), role = flag('--role'), projector = flag('--projector');
const out = path.resolve(flag('--out') || path.join(__dirname, '../../extension/ai/local/models.json'));
const base = file && path.basename(file).replace(/\.gguf$/i, '');
const id = flag('--id') || (base && base.toLowerCase());
const name = flag('--name') || (base && base.replace(/-/g, ' '));
const quant = flag('--quant') || (base && base.split('-').pop());
let license = flag('--license');
const placed = role ? ['pictures', 'projector'].includes(role) && tierArg === null && (role === 'pictures') === !!projector : Number.isSafeInteger(tier) && !projector;
const listed = toolsArg !== null || versionArg !== null || minGlaze !== null;
if (listed && (toolsArg === null || versionArg === null || minGlaze === null || role || tierArg === null)) { console.error('a list entry takes --tools, --version and --min-glaze together, with --tier'); process.exit(2); }
if (!repo || !/^[0-9a-f]{40}$/.test(commit || '') || !file || !placed || args.length) {
  console.error('usage: node tools/vendor/model-manifest.js --repo <owner/name> --commit <40-hex sha> --file <f.gguf> (--tier <n> | --role pictures --projector <id> | --role projector) [--local <path>] [--id] [--name] [--quant] [--license] [--stock] [--out]');
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

  const entry = { id, name, repo, commit, file, url, size, chunk: CHUNK, sha256: sums, total: whole, license, quant, ...(role ? { role, ...(projector && { projector }) } : { tier }), ...(stock && { stock: true }),
    ...(listed && { tools: Number(toolsArg), minGlaze, version: versionArg }) };
  if (listed && !U.clean({ v: 1, serial: 1, issued: '2026-01-01T00:00:00Z', models: [entry] })) throw new Error('the entry would not pass the model list\'s schema (ai/local/updates.js entry)');
  if (!S.valid(entry)) throw new Error(`the entry would not pass store.valid: ${JSON.stringify({ ...entry, sha256: sums.length })}`);
  const doc = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { models: [] };
  // The tiers in order, then the picture download's files.
  const rank = (m) => (m.role ? Infinity : m.tier);
  doc.models = [...doc.models.filter((m) => m.id !== id), entry].sort((a, b) => (rank(a) === rank(b) ? a.id.localeCompare(b.id) : rank(a) - rank(b)));
  fs.writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`${id}: ${size} bytes, ${sums.length} chunks, sha256 ${whole}${oid ? ' (matches HF)' : ''} → ${path.relative(process.cwd(), out)}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
