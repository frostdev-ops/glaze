#!/usr/bin/env bash
# Rebuild lib/harper/: Automattic's harper.js (Apache-2.0, lib/harper/LICENSE), the grammar and spelling checker Glaze
# Writer proofs with, offline (lib/harper/shared.js runs it). Source: https://github.com/Automattic/harper/tree/v3.0.0
# (packages/harper.js and the harper-wasm crate it builds). Only what LocalLinter needs on the slim binary: index.js,
# its BinaryModule chunk, slimBinary.js and harper_wasm_slim_bg.wasm (the full binary loads both wasm, ~40 MB). The
# readable modules as published, not minified: the Chrome Web Store rejects minified code. Two cuts, both code Glaze never
# runs and store reviewers would ask about: WorkerLinter, which carries its own worker as a 110 KB string of source and
# starts it from a blob: or data: URL (and builds that Blob on every import), and the Node path that reads the binary with a
# dynamic import('fs'). The tarball is checked against the SHA-256 pinned here. Run it to upgrade harper.js (new version,
# new hashes, check the cuts); the output is checked in, so the extension itself still has no build step.
# Usage: scripts/vendor-harper.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=3.0.0
sha256=339d7f8e81276a5c2a36397f2e8264b300cd438f664f007b5ccb0d9dc1ccf19d
wasm_sha256=507f3737088fcdfb1766d907c0232674e78629235f694d73801196d84f853b06
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/harper.tgz" "https://registry.npmjs.org/harper.js/-/harper.js-$version.tgz"
echo "$sha256  $tmp/harper.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/harper.tgz" -C "$tmp"
src="$tmp/package/dist"
echo "$wasm_sha256  $src/harper_wasm_slim_bg.wasm" | shasum -a 256 -c - >/dev/null

keep=(lib/harper/shared.js)
for f in "${keep[@]}"; do [ -f "$f" ] && cp "$f" "$tmp/"; done
rm -rf lib/harper
mkdir -p lib/harper
for f in "${keep[@]}"; do [ -f "$tmp/$(basename "$f")" ] && cp "$tmp/$(basename "$f")" "$f"; done
chunk="$(cd "$src" && ls BinaryModule-*.js)"
for f in index.js "$chunk" slimBinary.js; do
  { echo "// harper.js $version (Apache-2.0, lib/harper/LICENSE), as published on npm; source https://github.com/Automattic/harper/tree/v$version/packages/harper.js. Built by scripts/vendor-harper.sh."
    sed '/^\/\/# sourceMappingURL=/d' "$src/$f"; } > "lib/harper/$f"
done
node - lib/harper/index.js "lib/harper/$chunk" <<'EOF'
const fs = require('node:fs');
const [index, chunk] = process.argv.slice(2);
const edit = (file, fn) => fs.writeFileSync(file, fn(fs.readFileSync(file, 'utf8')));
const cut = (file, src, pattern, replacement) => {
  const hits = src.match(pattern)?.length ?? 0;
  if (hits !== 1) throw new Error(`${file}: harper.js changed (${hits} matches of ${pattern}); update this cut`);
  return src.replace(pattern, replacement);
};
edit(index, (src) => {
  src = cut(index, src, /^const jsContent = '[\s\S]*?\n(?=class WorkerLinter \{)/gm, '');
  src = cut(index, src, /^class WorkerLinter \{\n[\s\S]*?\n\}\n(?=var u8 = )/gm,
    '// scripts/vendor-harper.sh cut WorkerLinter here (its worker came as source text in a string, run from a blob: URL).\n' +
    'class WorkerLinter {\n  constructor() {\n    throw new Error("WorkerLinter is not bundled with Glaze; use LocalLinter in a worker");\n  }\n}\n');
  if (/jsContent|createObjectURL|data:text\/javascript/.test(src)) throw new Error(`${index}: WorkerLinter is left`);
  return src;
});
edit(chunk, (src) => {
  src = cut(chunk, src, /^function getInitInput\(binary\) \{\n[\s\S]*?\n\}\n(?=async function loadBinaryUncached)/gm,
    '// scripts/vendor-harper.sh cut the Node path here (a dynamic import of "fs" for file:// binaries): Glaze fetches the binary.\n' +
    'function getInitInput(binary) {\n  return binary;\n}\n');
  return src;
});
for (const file of [index, chunk]) {
  const src = fs.readFileSync(file, 'utf8');
  if (/\bimport\s*\(/.test(src)) throw new Error(`${file}: a dynamic import is left`);
  if (/\beval\s*\(|new\s+Function\s*\(|(^|[^\w$.])Function\s*\(\s*['"`]/.test(src)) throw new Error(`${file}: code made from text is left`);
}
EOF
cp "$src/harper_wasm_slim_bg.wasm" lib/harper/
cp "$tmp/package/LICENSE" lib/harper/LICENSE

echo "lib/harper: harper.js $version ($(du -sh lib/harper | cut -f1))"
