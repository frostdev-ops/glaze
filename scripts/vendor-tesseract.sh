#!/usr/bin/env bash
# Rebuild lib/tesseract/: the Tesseract OCR engine compiled to WebAssembly (tesseract.js-core, Apache-2.0) and
# the tessdata_fast models (Apache-2.0) for the six languages Glaze speaks, all bundled: Glaze reads photos with
# them on the device and never fetches a model from anywhere. Only the core is taken, not tesseract.js's wrapper
# (lib/ocr.js drives the core itself, and the wrapper's defaults point at a CDN). One core: SIMD, LSTM only,
# which every browser Glaze supports runs and which is all the fast models use. The models are kept gzipped
# (lib/ocr.js unpacks them), which halves what the installed extension takes on disk. Every download is checked
# against the SHA-256 pinned here. The core's loader is published minified only, and the Chrome Web Store can take
# minified code for obfuscation (2026-10-26), so esbuild (pinned and integrity-checked as in scripts/vendor-three.sh)
# re-prints it with line breaks and indentation: the same code, still under Emscripten's short names, checked against
# out_sha256. Run it to upgrade (new versions, new hashes); the output is checked in, so the extension itself still has
# no build step. Usage: scripts/vendor-tesseract.sh
set -euo pipefail
cd "$(dirname "$0")/.."

core=7.0.0
core_sha256=ba584355515eaff877552022853c0e71f2cb70466e759d1d6940484929718ee0
# tessdata_fast at its 4.1.0 tag.
data=65727574dfcd264acbb0c3e07860e4e9e9b22185
models="eng:7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2
deu:19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d
spa:6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464
fra:ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca
nld:ced0e5e046a84c908a6aa7accbef9a232c4a5d9a8276691b81c6ee64d02963f6
por:c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb
LICENSE:cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
# The checked-in loader: the core's, re-printed by esbuild under one comment line.
out_sha256=6d754a6825fc544e1f0572cb2ebc1b1b9ff92ca2f0fe1f15c6b4570066c643b3
esbuild_version=0.28.2
integrity=$(cat <<'EOF'
esbuild@0.28.2 sha512-HKVLS8dvII+xoKW9kmqxbRKrnWEXfJJr/FZhhJmiqIB0e053QNYFqOBouTMO/k5sID4MvCiUCvv8b9M4h32wIA==
@esbuild/darwin-arm64@0.28.2 sha512-n4KqkOQrraxHJcgjM1RvwbigfQKIKJVpM7xp+KsxiyUSrRdIXnt73VhrPAx0fV44hgfmIVKjxMN9J1t5jySVkw==
@esbuild/darwin-x64@0.28.2 sha512-uq6suIWYP37qzGddBKPw5QEQPi6HiLGsO7UmkpfyaYNQ3D+rN6w6WfwH+nuqcGXWvawGwxOEroO4YGnFh95azw==
@esbuild/linux-arm64@0.28.2 sha512-pW4AC0P3it8c7do9MVM4p51FzHzdM/TZrerurgRcHJ2WTa1VQ1CIq18xncfpBJw4ojkiZZrKW2yIBWBP92j6Ug==
@esbuild/linux-x64@0.28.2 sha512-4xTZr1FUmSoQW4XIWmit3tzQrUTZM+N3P0XV8xROKYF50XfI7xeO90+1bZvNwxIufQ9hDQVRJH5YhgPVF8A/HQ==
EOF
)
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/core.tgz" "https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-$core.tgz"
echo "$core_sha256  $tmp/core.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/core.tgz" -C "$tmp"

rm -rf lib/tesseract
mkdir -p lib/tesseract
# --ignore-scripts: esbuild's install script (an optimisation only) never runs; npm-integrity.js checks it before it does.
npm install --prefix "$tmp/esbuild" --silent --no-save --no-package-lock --ignore-scripts --no-audit --no-fund \
  --registry https://registry.npmjs.org/ "esbuild@$esbuild_version"
printf '%s\n' "$integrity" | node scripts/npm-integrity.js "$tmp/esbuild/node_modules/.package-lock.json" - esbuild
# A plain script (lib/ocr.js loads it with importScripts), re-printed as it is: no bundling, no format change, no lowering.
{ echo "// tesseract.js-core $core loader (Apache-2.0, lib/tesseract/tesseract-core.LICENSE), as published but re-printed with line breaks. Built by scripts/vendor-tesseract.sh."
  "$tmp/esbuild/node_modules/.bin/esbuild" --loader=js --log-level=warning < "$tmp/package/tesseract-core-simd-lstm.js"; } > lib/tesseract/tesseract-core-simd-lstm.js
echo "$out_sha256  lib/tesseract/tesseract-core-simd-lstm.js" | shasum -a 256 -c - >/dev/null || {
  echo "vendor-tesseract: the loader is $(shasum -a 256 lib/tesseract/tesseract-core-simd-lstm.js | cut -d' ' -f1), not the recorded out_sha256; record it if you upgraded on purpose." >&2; exit 1; }
cp "$tmp/package/tesseract-core-simd-lstm.wasm" lib/tesseract/
cp "$tmp/package/LICENSE" lib/tesseract/tesseract-core.LICENSE
chmod 644 lib/tesseract/*
for entry in $models; do
  name="${entry%%:*}" sum="${entry#*:}"
  file="$name.traineddata"
  [ "$name" = LICENSE ] && file=LICENSE
  curl -fsSL -o "$tmp/$file" "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/$data/$file"
  echo "$sum  $tmp/$file" | shasum -a 256 -c - >/dev/null
  if [ "$name" = LICENSE ]; then cp "$tmp/LICENSE" lib/tesseract/tessdata.LICENSE; else gzip -9n -c "$tmp/$file" > "lib/tesseract/$file.gz"; fi
done

echo "lib/tesseract: core $core (simd-lstm), tessdata_fast $(echo "$models" | grep -v LICENSE | cut -d: -f1 | tr '\n' ' ')($(du -sh lib/tesseract | cut -f1))"
