#!/usr/bin/env node
// The owner's tool for the mod blocklist (lib/blocklist.js). Run it on the owner's own computer, offline: the private key
// never goes on a server, in the repo or in a backup the key's owner doesn't control (RELEASING.md).
//   node scripts/blocklist-sign.mjs keygen <keyfile>
//       Makes the Ed25519 key pair. The private key goes in <keyfile> (mode 600, outside the repo, never overwritten);
//       the public key is printed, to paste over PENDING_OWNER_KEY in lib/blocklist.js.
//   node scripts/blocklist-sign.mjs sign <keyfile> <list.json> [<signed.json>] [--force-unpinned]
//       Signs the list in <list.json> { mods: [id], bundles: [hash], authors: [key], reasons: { entry: text }, seq }:
//       seq one higher than the file's (and written back to it), issued now, expires 30 days later. <signed.json>
//       (default: <list>.signed.json) is what `gallery.mjs --blocklist` takes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const B = createRequire(import.meta.url)('../lib/blocklist.js');
const repo = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const LIFETIME = 30 * 864e5;

export const keygen = (file) => {
  // Resolved through the folder it's in, so a link into the repo doesn't hide it.
  const abs = path.join(fs.realpathSync(path.dirname(path.resolve(file))), path.basename(file));
  if (abs === repo || abs.startsWith(repo + path.sep)) throw new Error('the private key must be kept outside the repo');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  try { fs.writeFileSync(abs, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 }); } catch (e) {
    throw new Error(e.code === 'EEXIST' ? `${abs} already exists; refusing to overwrite a key` : e.message);
  }
  return publicKey.export({ format: 'jwk' }).x;
};

// Signs `listFile` into `outFile`. → the signed document, { list, sig }.
export const sign = (keyFile, listFile, outFile, { now = Date.now(), force = false } = {}) => {
  const output = fs.statSync(outFile, { throwIfNoEntry: false });
  if (output && [keyFile, listFile].some((file) => {
    const input = fs.statSync(file);
    return input.dev === output.dev && input.ino === output.ino;
  })) throw new Error('the signed output must not overwrite the private key or working list');
  if (fs.statSync(keyFile).mode & 0o077) throw new Error(`${keyFile} can be read by others; chmod 600 it`);
  const key = crypto.createPrivateKey(fs.readFileSync(keyFile));
  const pub = crypto.createPublicKey(key).export({ format: 'jwk' }).x;
  // A list the extension would ignore is worse than none: the owner thinks it is in force.
  if (pub !== B.OWNER_KEY && !force) throw new Error('this is not the key pinned as OWNER_KEY in lib/blocklist.js, so the extension would ignore the list (paste the public key there, or --force-unpinned to test)');
  const input = JSON.parse(fs.readFileSync(listFile, 'utf8'));
  const seen = input.seq ?? 0;
  if (!Number.isSafeInteger(seen) || seen < 0) throw new Error('seq must be a whole number');
  const issued = Math.floor(now / 1000) * 1000;
  const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const sorted = (a) => (Array.isArray(a) ? [...new Set(a)].sort() : a);
  const list = B.clean({ v: 1, seq: seen + 1, issued: iso(issued), expires: iso(issued + LIFETIME), mods: sorted(input.mods ?? []), bundles: sorted(input.bundles ?? []), authors: sorted(input.authors ?? []), reasons: input.reasons ?? {} });
  if (!list) throw new Error('not a valid list: mods are 16 base32 characters (a-z, 2-7), bundles and authors 43 base64url characters, a reason is one line of at most 200 characters and belongs to a listed entry');
  const doc = { list, sig: crypto.sign(null, Buffer.from(`glaze-blocklist-1|${B.canon(list)}`), key).toString('base64url') };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (Buffer.byteLength(text) > B.CAP) throw new Error(`the signed list is over ${B.CAP} bytes; the extension would refuse it`);
  fs.writeFileSync(outFile, text);
  fs.writeFileSync(listFile, `${JSON.stringify({ ...input, seq: list.seq }, null, 2)}\n`);
  return doc;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [cmd, a, b, c] = args;
  try {
    if (cmd === 'keygen' && a && args.length === 2) {
      const pub = keygen(a);
      console.log(`Private key written to ${a} (mode 600). Keep it offline and back it up; it can't be recovered.\nPublic key, to paste over PENDING_OWNER_KEY in lib/blocklist.js, and into BLOCKLIST_KEY for gallery.mjs:\n${pub}`);
    } else if (cmd === 'sign' && a && b && args.length <= 4) {
      const out = c || b.replace(/(\.json)?$/, '.signed.json');
      const { list } = sign(a, b, out, { force: process.argv.includes('--force-unpinned') });
      console.log(`Signed seq ${list.seq}: ${list.mods.length} mods, ${list.bundles.length} bundles, ${list.authors.length} authors; issued ${list.issued}, expires ${list.expires}.\nWrote ${out} and set seq ${list.seq} in ${b}. Publish it: gallery.mjs --blocklist ${out} (RELEASING.md).`);
    } else {
      console.error('usage: blocklist-sign.mjs keygen <keyfile> | sign <keyfile> <list.json> [<signed.json>] [--force-unpinned]');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`blocklist-sign: ${e.message}`);
    process.exitCode = 1;
  }
}
