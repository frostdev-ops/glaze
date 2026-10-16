#!/bin/sh
# Build every Glaze package for the manifest version into release/<version>/. Uploads and publishes nothing.
#   sh scripts/release.sh          tests, then the Chrome and Firefox zips
#   MAC=1 sh scripts/release.sh    also the notarized Mac app and DMG (NOTARY_PROFILE or ASC_KEY_*)
# Store uploads, the GitHub release and the appcast follow RELEASING.md.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
version=$(node -p 'require("./manifest.json").version')
out=release/$version

node --test
mkdir -p "$out/github" "$out/chrome-web-store" "$out/firefox"
DIST=$out/github sh scripts/package-firefox.sh
cp "$out/github/glaze-v$version.zip" "$out/chrome-web-store/"
cp "$out/github/glaze-v$version-firefox.zip" "$out/firefox/"
# Firefox Add-ons reviewers rebuild the vendored pdf.js (shimmed) and three.js (custom build) from source.
git archive --format=zip -o "$out/firefox/glaze-v$version-source.zip" HEAD
[ -n "${MAC:-}" ] && sh scripts/build-safari.sh
(cd "$out/github" && shasum -a 256 glaze-* | grep -v '\.sha256$' > SHA256SUMS)
echo
echo "release/$version:"
find "$out" -maxdepth 2 -type f -newer manifest.json ! -name '*.log' | sort
