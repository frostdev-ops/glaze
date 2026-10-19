#!/usr/bin/env bash
# Rebuild lib/three.min.js: only the parts of three.js that lib/scene.js imports, tree-shaken and
# minified into one ES module. Run it to upgrade three; the output is checked in, so the
# extension itself still has no build step. Usage: scripts/vendor-three.sh [version]
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-0.186.1}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The destructured exports in lib/scene.js's lazy renderer import.
names="$(sed -n "/^const {/,/three.min.js/p" lib/scene.js | tr -d '\n' | sed -E 's/^const \{(.*)\} = await.*/\1/')"
echo "export {$names} from 'three';" > "$tmp/entry.js"
npm install --prefix "$tmp" --silent --no-save --no-package-lock "three@$version" esbuild@0.28.2
"$tmp/node_modules/.bin/esbuild" "$tmp/entry.js" --bundle --minify --format=esm --legal-comments=eof \
  --banner:js="// three.js $version (MIT, lib/three.LICENSE), only what lib/scene.js uses. Built by scripts/vendor-three.sh." \
  --outfile=lib/three.min.js
cp "$tmp/node_modules/three/LICENSE" lib/three.LICENSE

echo "lib/three.min.js: three $version ($(du -h lib/three.min.js | cut -f1))"
