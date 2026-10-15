#!/usr/bin/env bash
# Rebuild lib/tesseract/: the Tesseract OCR engine compiled to WebAssembly (tesseract.js-core, Apache-2.0) and
# the tessdata_fast models (Apache-2.0) for the six languages Glaze speaks, all bundled: Glaze reads photos with
# them on the device and never fetches a model from anywhere. Only the core is taken, not tesseract.js's wrapper
# (lib/ocr.js drives the core itself, and the wrapper's defaults point at a CDN). One core: SIMD, LSTM only,
# which every browser Glaze supports runs and which is all the fast models use. The models are kept gzipped
# (lib/ocr.js unpacks them), which halves what the installed extension takes on disk. Every download is checked
# against the SHA-256 pinned here. Run it to upgrade (new versions, new hashes); the output is checked in, so the
# extension itself still has no build step. Usage: scripts/vendor-tesseract.sh
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
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/core.tgz" "https://registry.npmjs.org/tesseract.js-core/-/tesseract.js-core-$core.tgz"
echo "$core_sha256  $tmp/core.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/core.tgz" -C "$tmp"

rm -rf lib/tesseract
mkdir -p lib/tesseract
cp "$tmp/package/tesseract-core-simd-lstm.js" "$tmp/package/tesseract-core-simd-lstm.wasm" lib/tesseract/
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
