// The owner's signing of Rime's model list (ai/local/updates.js; docs/ai-harness.md "Publishing a model"), behind
// tools/vendor/model-manifest.js --keygen and --sign. Run on the owner's computer only: the private key never goes in the
// repo, a log or a backup the owner doesn't control, and nothing here prints it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const U = require('../../extension/ai/local/updates.js');

const repo = fs.realpathSync(path.resolve(__dirname, '../..'));

// The key pair: the private key in `file` (PKCS#8 PEM, mode 600, never overwritten, outside the repo). → the public key,
// the raw 32 bytes in base64url, as updates.js KEY holds it.
const keygen = (file) => {
  const abs = path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  if (abs === repo || abs.startsWith(repo + path.sep)) throw new Error('the private key must be kept outside the repo');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  try { fs.writeFileSync(abs, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 }); } catch (e) {
    throw new Error(e.code === 'EEXIST' ? `${abs} already exists; refusing to overwrite a key` : e.message);
  }
  return publicKey.export({ format: 'jwk' }).x;
};

const nextSerial = (live) => (Number.isSafeInteger(live?.list?.serial) ? live.list.serial + 1 : 1);

// The signed list { list, sig } of `entries` at `serial`, issued `now`. Refused: a key file others can read, a key other
// than updates.js KEY (unless force, for a test list), a serial at or below `live` (the published list's), an entry the
// extension's schema refuses, or a shipped size (`bundled`, models.json's entries) under a new id: a new version keeps its id.
const sign = (keyFile, { entries, serial, bundled = [], live = 0, force = false, now = Date.now() }) => {
  if (fs.statSync(keyFile).mode & 0o077) throw new Error(`${keyFile} can be read by others; chmod 600 it`);
  const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
  const pub = crypto.createPublicKey(key).export({ format: 'jwk' }).x;
  if (pub !== U.KEY && !force) throw new Error('this is not the key the extension trusts (ai/local/updates.js KEY); pass --force-unpinned only for a test list');
  if (!Number.isSafeInteger(serial) || serial < 1) throw new Error('the serial is a whole number from 1');
  if (serial <= live) throw new Error(`serial ${serial} must be above the live list's ${live}`);
  for (const m of entries) {
    const shipped = bundled.find((b) => !b.role && b.tier === m.tier);
    if (shipped && shipped.id !== m.id) throw new Error(`${m.id}: tier ${m.tier} is ${shipped.id} in models.json; a new version keeps its id`);
  }
  const issued = new Date(Math.floor(now / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const list = U.clean({ v: 1, serial, issued, models: entries });
  if (!list) throw new Error('an entry is outside the schema: each needs a pinned huggingface.co URL, chunk hashes, a tier, tools, minGlaze and version (ai/local/updates.js entry), ids and tiers once each');
  return { list, sig: crypto.sign(null, Buffer.from(`glaze-models-1|${U.canon(list)}`), key).toString('base64url') };
};

module.exports = { keygen, sign, nextSerial };
