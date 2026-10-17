#!/usr/bin/env bash
# Rebuild lib/lottie/: the official lottie-web player (MIT, lib/lottie/LICENSE), only its light canvas build, the one lib/scene-media.js
# and the sticker player import for a Lottie animation. "Light" leaves out expressions, the only part of lottie-web that
# evaluates text as code, so the player never runs anything a file says; "canvas" draws into one <canvas> instead of
# building an SVG tree in the page. The file is Bodymovin's build/player/lottie_light_canvas.min.js as published, with
# one comment line on top. The tarball is checked against the SHA-256 pinned here, then the file against its own. Run it
# to upgrade lottie-web (new version, new hashes); the output is checked in, so the extension itself still has no build
# step. Usage: scripts/vendor-lottie.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=5.13.0
tarball_sha256=00f306a9b5669abf9622c418b549681d1b858e0b7fa7ea6adc0772ca57c3fd4f
file_sha256=0930bfecb5b5dad59dd9049a139fa957e57f70e0805fc94a311204e524e45e28
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/lottie.tgz" "https://registry.npmjs.org/lottie-web/-/lottie-web-$version.tgz"
echo "$tarball_sha256  $tmp/lottie.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/lottie.tgz" -C "$tmp"
src="$tmp/package"
echo "$file_sha256  $src/build/player/lottie_light_canvas.min.js" | shasum -a 256 -c - >/dev/null

rm -rf lib/lottie
mkdir -p lib/lottie
{ echo "// lottie-web $version light canvas build (MIT, lib/lottie/LICENSE), as published, after this line. Fetched by scripts/vendor-lottie.sh."
  cat "$src/build/player/lottie_light_canvas.min.js"; } > lib/lottie/lottie_light_canvas.min.js
cp "$src/LICENSE.md" lib/lottie/LICENSE

echo "lib/lottie: lottie-web $version light canvas ($(du -h lib/lottie/lottie_light_canvas.min.js | cut -f1), $(gzip -9 < lib/lottie/lottie_light_canvas.min.js | wc -c | awk '{printf "%.0f KB", $1/1024}') gzipped)"
