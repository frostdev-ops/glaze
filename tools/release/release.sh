#!/bin/sh
# Build main's Glaze packages for the manifest version into release/<version>/. Uploads and publishes nothing.
# The tests and the Chrome zip come from a fresh checkout of the committed HEAD (as CI builds a tag), so the script
# refuses a working tree with uncommitted or untracked files.
#   sh scripts/release.sh          tests, then the Chrome zip
#   MAC=1 sh scripts/release.sh    also the notarized Mac app and DMG (NOTARY_PROFILE or ASC_KEY_*)
# Firefox is built from dev/firefox; store uploads, GitHub and the appcast follow RELEASING.md.
# Complete automated publication: node scripts/store-release.mjs release
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
. "$root/scripts/clean-source.sh"
glaze_require_clean "$root" release.sh
version=$(node -p 'require("./manifest.json").version')
out=release/$version

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
src=$work/glaze
glaze_checkout_head "$root" "$src"
(cd "$src" && node --test)
mkdir -p "$out/github" "$out/chrome-web-store"
(cd "$src" && DIST="$root/$out/github" ./package.sh)
cp "$out/github/glaze-v$version.zip" "$out/chrome-web-store/"
# The Mac build packages the working tree itself, which glaze_require_clean has just shown to match HEAD.
[ -n "${MAC:-}" ] && sh scripts/build-safari.sh
(cd "$out/github" && shasum -a 256 glaze-* | grep -v '\.sha256$' > SHA256SUMS)
echo
echo "release/$version:"
find "$out" -maxdepth 2 -type f -newer manifest.json ! -name '*.log' | sort
