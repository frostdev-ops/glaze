#!/usr/bin/env bash
# Rebuild lib/pdfjs/: Mozilla's prebuilt pdf.js (Apache-2.0, lib/pdfjs/LICENSE), only what Glaze's reader
# (reader.html) needs to pull the text out of a PDF and to draw a scanned page for OCR: the two modules, plus
# the JBIG2/CCITT and JPEG 2000 decoders scanned pages are often stored in (wasm, BSD; their licenses beside them).
# The legacy build, because the modern one calls Promise.try, Map.prototype.getOrInsertComputed and friends
# unpolyfilled, which Chrome 116 and Safari 17 lack. Even the legacy build skips Promise.withResolvers (Chrome 119,
# Safari 17.4), so a one-line fallback goes on top of both modules. The tarball is checked against the SHA-256
# pinned here. Run it to upgrade pdf.js (new version, new hash); the output is checked in, so the extension itself
# still has no build step. Usage: scripts/vendor-pdfjs.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=6.4.299
sha256=86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/pdfjs.tgz" "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-$version.tgz"
echo "$sha256  $tmp/pdfjs.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/pdfjs.tgz" -C "$tmp"
src="$tmp/package"

shim='Promise.withResolvers||=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};'
rm -rf lib/pdfjs
mkdir -p lib/pdfjs
for f in pdf.min.mjs pdf.worker.min.mjs; do
  { echo "// pdf.js $version legacy build (Apache-2.0, lib/pdfjs/LICENSE). Built by scripts/vendor-pdfjs.sh."
    echo "$shim"
    cat "$src/legacy/build/$f"; } > "lib/pdfjs/$f"
done
cp "$src/LICENSE" lib/pdfjs/LICENSE
for f in jbig2.wasm openjpeg.wasm LICENSE_JBIG2 LICENSE_PDFJS_JBIG2 LICENSE_OPENJPEG LICENSE_PDFJS_OPENJPEG; do cp "$src/wasm/$f" lib/pdfjs/; done

echo "lib/pdfjs: pdf.js $version ($(du -sh lib/pdfjs | cut -f1), $(cat lib/pdfjs/* | gzip -9 | wc -c | awk '{printf "%.0f KB", $1/1024}') gzipped)"
