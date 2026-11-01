#!/bin/bash
# Rebuilds extension/vendor/quickjs/ (run_js's engine, ai/agent/js.js) from the pinned npm packages: checks each tarball's
# sha256, bundles quickjs-emscripten-core with the release-sync variant into one classic script that sets GZ_QUICKJS, and
# copies the variant's .wasm and the license. PROVENANCE.md records the inputs and the outputs' sha256; a rebuild must
# match it byte for byte (test/ai/rime-tools.test.js). Needs network for npm; nothing it downloads runs.
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
out="$root/extension/vendor/quickjs"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
pins=(
  'quickjs-emscripten-core@0.32.0 2ea4461a54e87217adf3f2b327c130d8f6b034e334f9e7d87c0580d0406a206e'
  '@jitl/quickjs-wasmfile-release-sync@0.32.0 8459053841d6b053207b70287b5a6d762fd5608a3908b40956c5aa3178dcf9c8'
  '@jitl/quickjs-ffi-types@0.32.0 d7bf18745d8fb2144587fcfd15982a1a87347f6675538615623c3267c51965b1'
)
mkdir -p "$work/dl" "$work/build/node_modules/@jitl"
for pin in "${pins[@]}"; do
  set -- $pin
  name=$1 sum=$2
  (cd "$work/dl" && npm pack --silent --ignore-scripts "$name" >/dev/null)
  tgz="$work/dl/$(echo "${name%@*}" | sed 's/^@//; s#/#-#')-${name##*@}.tgz"
  echo "$sum  $tgz" | shasum -a 256 -c - >/dev/null
  mkdir -p "$work/build/node_modules/${name%@*}"
  tar -xzf "$tgz" -C "$work/build/node_modules/${name%@*}" --strip-components=1
done
cat > "$work/build/entry.mjs" <<'JS'
import { newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
globalThis.GZ_QUICKJS = { load: (wasmBinary, wasmMemory) => newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmBinary, wasmMemory })), shouldInterruptAfterDeadline };
JS
(cd "$work/build" && npx -y esbuild@0.28.2 entry.mjs --bundle --format=iife --platform=browser --target=es2020 --minify --legal-comments=none \
  --define:import.meta.url='"file:///vendor/quickjs/"' --log-level=error --outfile=quickjs.js)
mkdir -p "$out"
cp "$work/build/quickjs.js" "$out/quickjs.js"
cp "$work/build/node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm" "$out/quickjs.wasm"
cp "$work/build/node_modules/@jitl/quickjs-wasmfile-release-sync/LICENSE" "$out/quickjs.LICENSE"
(cd "$out" && shasum -a 256 quickjs.js quickjs.wasm)
