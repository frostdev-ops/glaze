#!/bin/sh
# Build main's Glaze packages for the manifest version into release/<version>/. Uploads and publishes nothing.
#   sh scripts/release.sh          tests, then the Chrome zip
#   MAC=1 sh scripts/release.sh    also the notarized Mac app and DMG (NOTARY_PROFILE or ASC_KEY_*)
# Firefox is built from dev/firefox; store uploads, GitHub and the appcast follow RELEASING.md.
# Complete automated publication: node scripts/store-release.mjs release
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
version=$(node -p 'require("./manifest.json").version')
out=release/$version

node --test
mkdir -p "$out/github" "$out/chrome-web-store"
DIST=$out/github ./package.sh
cp "$out/github/glaze-v$version.zip" "$out/chrome-web-store/"
[ -n "${MAC:-}" ] && sh scripts/build-safari.sh
(cd "$out/github" && shasum -a 256 glaze-* | grep -v '\.sha256$' > SHA256SUMS)
echo
echo "release/$version:"
find "$out" -maxdepth 2 -type f -newer manifest.json ! -name '*.log' | sort
