#!/usr/bin/env bash
# Rebuild lib/lottie/: the official lottie-web player (MIT, lib/lottie/LICENSE), only its light canvas build, the one lib/scene-media.js
# and the sticker player import for a Lottie animation. "Light" leaves out expressions, the only part of lottie-web that
# evaluates text as code, so the player never runs anything a file says; "canvas" draws into one <canvas> instead of
# building an SVG tree in the page. The file is Bodymovin's readable build/player/lottie_light_canvas.js as published, not
# the minified one (the Chrome Web Store can take minified code for obfuscation, 2026-10-26), with one comment line on top
# and one cut: the optional Web Worker, which lottie builds from its own function's text, never runs in Glaze (nothing
# turns it on, and Glaze hands the player animation data, never a path to load). The tarball is checked against the
# SHA-256 pinned here, then the file against its own. Run it to upgrade lottie-web (new version, new hashes); the output
# is checked in, so the extension itself still has no build step. Usage: scripts/vendor-lottie.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=5.13.0
tarball_sha256=00f306a9b5669abf9622c418b549681d1b858e0b7fa7ea6adc0772ca57c3fd4f
file_sha256=b38821d1b75729636d91d31c3fd681210ef037164468d278bc59641d5f48f065
# The checked-in file: the build above with its comment line and the cut.
out_sha256=edd64fb8da108efea0f5364e1292f6be9958fc4d0e2b00928adc97a52edd464b
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/lottie.tgz" "https://registry.npmjs.org/lottie-web/-/lottie-web-$version.tgz"
echo "$tarball_sha256  $tmp/lottie.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/lottie.tgz" -C "$tmp"
src="$tmp/package"
echo "$file_sha256  $src/build/player/lottie_light_canvas.js" | shasum -a 256 -c - >/dev/null

rm -rf lib/lottie
mkdir -p lib/lottie
{ echo "// lottie-web $version light canvas build (MIT, lib/lottie/LICENSE), as published after this line but for one cut. Fetched by scripts/vendor-lottie.sh."
  cat "$src/build/player/lottie_light_canvas.js"; } > lib/lottie/lottie_light_canvas.js
node - lib/lottie/lottie_light_canvas.js <<'EOF'
const fs = require('node:fs');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const worker = /\n( *)if \(window\.Worker && window\.Blob && getWebWorker\(\)\) \{\n[\s\S]*?\n\1  return new Worker\(url\);\n\1\}/g;
const hits = src.match(worker)?.length ?? 0;
if (hits !== 1) throw new Error(`${file}: lottie's createWorker changed (${hits} matches); update this cut`);
fs.writeFileSync(file, src.replace(worker, '\n$1// scripts/vendor-lottie.sh cut the Web Worker built from this function\'s text: Glaze never turns it on.'));
EOF
echo "$out_sha256  lib/lottie/lottie_light_canvas.js" | shasum -a 256 -c - >/dev/null || {
  echo "vendor-lottie: lib/lottie/lottie_light_canvas.js is not the recorded out_sha256; if you upgraded on purpose, record its hash." >&2; exit 1; }
cp "$src/LICENSE.md" lib/lottie/LICENSE

echo "lib/lottie: lottie-web $version light canvas ($(du -h lib/lottie/lottie_light_canvas.js | cut -f1), $(gzip -9 < lib/lottie/lottie_light_canvas.js | wc -c | awk '{printf "%.0f KB", $1/1024}') gzipped)"
