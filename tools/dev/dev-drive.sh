#!/usr/bin/env bash
# A dev copy of the extension for trying Google Drive with Glaze's real clients (background/google-config.js). Chrome's sign-in
# (getAuthToken with the "Chrome extension" client) and the Web client's redirect (https://<id>.chromiumapp.org/) both need
# the Chrome Web Store item's ID, which Chrome gives an unpacked copy only when its manifest carries the store's public key
# ("key"). So: the store package (package.sh), unzipped into a folder, with Drive's build-time switch turned on
# (background/google.js ON), the manifest's oauth2 client with Drive's scopes and the optional identity permission
# (tools/build/oauth-manifest.js), and the key added, in that copy only. Never in the repo or the package (test/platform/google.test.js).
#
#   tools/dev/dev-drive.sh <file holding the store's public key, one base64 line> [folder, default dist/glaze-dev-drive]
#
# Then chrome://extensions → Developer mode → Load unpacked → that folder. Remove the store's Glaze from that Chrome
# profile first: two copies can't share one ID.
set -euo pipefail
cd "$(dirname "$0")/.."
key_file="${1:?usage: tools/dev/dev-drive.sh <public-key file> [folder]}"
out="${2:-dist/glaze-dev-drive}"

./package.sh >/dev/null
version="$(node -p 'require("./manifest.json").version')"
rm -rf "$out"
mkdir -p "$out"
unzip -q "${DIST:-dist}/glaze-v$version.zip" -d "$out"
node - "$out" "$key_file" <<'JS'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [out, keyFile] = process.argv.slice(2);
const key = fs.readFileSync(keyFile, 'utf8').trim();
const der = Buffer.from(key, 'base64');
if (!der.length || der.toString('base64') !== key) throw new Error(`${keyFile}: not one line of base64`); // a public key, nothing else
const file = path.join(out, 'background/google.js'), src = fs.readFileSync(file, 'utf8');
if (!src.includes('\n  const ON = false;\n')) throw new Error('background/google.js: no ON switch');
fs.writeFileSync(file, src.replace('\n  const ON = false;\n', '\n  const ON = true;\n'));
const { oauth } = require(path.resolve('tools/build/oauth-manifest.js'));
const at = path.join(out, 'manifest.json');
const manifest = oauth(JSON.parse(fs.readFileSync(at, 'utf8')), {
  target: 'chrome', calendar: require(path.resolve('planner/gcal.js')).ON === true, drive: true, config: require(path.resolve('background/google-config.js')),
});
if (!manifest.oauth2) throw new Error('background/google-config.js: the Chrome client is not set');
manifest.key = key;
fs.writeFileSync(at, `${JSON.stringify(manifest, null, 2)}\n`);
// Chrome's extension ID: the key's SHA-256, first 32 hex digits, 0-f read as a-p.
const id = [...crypto.createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
console.log(`${at}: extension ID ${id}`);
JS
echo "Load unpacked: $out"
