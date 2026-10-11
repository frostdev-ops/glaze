#!/bin/sh
# Generates the Safari Mac app project in safari/ from the Chrome package. Run on a Mac with Xcode.
# This replaces the project, native edits included; to rebuild the app, use build-safari.sh.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
if [ "$(uname)" != Darwin ]; then
  echo "package-safari: this needs macOS and Xcode (xcrun safari-web-extension-packager)." >&2
  exit 1
fi

./package.sh
version=$(node -p 'require("./manifest.json").version')
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
unzip -q "dist/glaze-v$version.zip" -d "$stage"
sh scripts/safari-manifest.sh "$stage/manifest.json"

rm -rf safari
xcrun safari-web-extension-packager "$stage" \
  --project-location "$root/safari" \
  --app-name Glaze \
  --bundle-identifier io.frostdev.Glaze \
  --swift \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt \
  --force

echo
echo "Open safari/Glaze/Glaze.xcodeproj, run the Glaze scheme, then enable Glaze in Safari Settings."
