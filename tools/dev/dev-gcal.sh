#!/usr/bin/env bash
# A dev copy of the extension for trying Google Calendar sync with the real OAuth client. That client (a "Chrome
# extension" client, S3 §1) is tied to the Chrome Web Store item's ID, and Chrome gives an unpacked copy that ID only when
# its manifest carries the store's public key ("key"). So: the store package (package.sh), unzipped into a folder, with
# the key added, in that copy only. Never in manifest.json or the package (test/planner/gcal.test.js checks).
#
#   tools/dev/dev-gcal.sh <file holding the store's public key, one base64 line> [folder, default dist/glaze-dev-gcal]
#
# Then chrome://extensions → Developer mode → Load unpacked → that folder. Remove the store's Glaze from that Chrome
# profile first: two copies can't share one ID.
set -euo pipefail
cd "$(dirname "$0")/../.."
key_file="${1:?usage: tools/dev/dev-gcal.sh <public-key file> [folder]}"
out="${2:-dist/glaze-dev-gcal}"

tools/build/package.sh >/dev/null
version="$(node -p 'require("./extension/manifest.json").version')"
rm -rf "$out"
mkdir -p "$out"
unzip -q "${DIST:-dist}/glaze-v$version.zip" -d "$out"
python3 - "$out" "$key_file" <<'PY'
import base64, hashlib, json, sys
out, key_file = sys.argv[1], sys.argv[2]
key = open(key_file).read().strip()
der = base64.b64decode(key, validate=True)  # a public key in base64, nothing else
path = f'{out}/manifest.json'
manifest = json.load(open(path))
assert 'oauth2' in manifest and 'identity' in manifest.get('optional_permissions', []), 'the package has no Google sync (lib/gcal.js ON off?)'
manifest['key'] = key
open(path, 'w').write(json.dumps(manifest, indent=2) + '\n')
# Chrome's extension ID: the key's SHA-256, first 32 hex digits, 0-f read as a-p.
ext_id = ''.join(chr(ord('a') + int(c, 16)) for c in hashlib.sha256(der).hexdigest()[:32])
print(f'{path}: extension ID {ext_id}')
PY
echo "Load unpacked: $out"
