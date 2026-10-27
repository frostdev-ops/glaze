#!/usr/bin/env bash
# Rebuild lib/pdfjs/: Mozilla's prebuilt pdf.js (Apache-2.0, lib/pdfjs/LICENSE), only what Glaze's reader
# (reader.html) needs to pull the text out of a PDF and to draw a scanned page for OCR: the two modules, plus
# the JBIG2/CCITT and JPEG 2000 decoders scanned pages are often stored in (wasm, BSD; their licenses beside them).
# The legacy build, because the modern one calls Promise.try, Map.prototype.getOrInsertComputed and friends
# unpolyfilled, which Chrome 116 and Safari 17 lack. Even the legacy build skips Promise.withResolvers (Chrome 119,
# Safari 17.4), so a one-line fallback goes on top of both modules. The readable modules, not the minified ones: the
# Chrome Web Store rejects minified pdf.js as obfuscated (2026-10-26). For the same review, core-js's Object.create
# fallback for old Internet Explorer (an ActiveX document, or an iframe at a script URL) is cut; every browser Glaze
# supports has Object.create, so it never ran. So is core-js's last way to find the global object, a function made from
# text (globalThis always answers first), and scripts/vendor-pdfjs-brotli.js has the worker read Brotli's dictionary from
# google/brotli's dictionary.bin (pinned here, MIT) instead of the XORed string pdf.js packs it in. pdf.js's few calls of
# the old escape and unescape functions are written out as the same decoding. The tarball is checked against the SHA-256 pinned here. Run it to
# upgrade pdf.js (new version, new hash); the output is checked in, so the extension itself still has no build step.
# Usage: scripts/vendor-pdfjs.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=6.4.299
sha256=86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415
# google/brotli at v1.2.0: c/common/dictionary.bin (the RFC 7932 dictionary) and the licence it is under.
brotli=028fb5a23661f123017c060daa546b55cf4bde29
brotli_dictionary_sha256=20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70
brotli_license_sha256=3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/pdfjs.tgz" "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-$version.tgz"
echo "$sha256  $tmp/pdfjs.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/pdfjs.tgz" -C "$tmp"
src="$tmp/package"

shim='Promise.withResolvers||=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};'
rm -rf lib/pdfjs
mkdir -p lib/pdfjs
for f in pdf.mjs pdf.worker.mjs; do
  { echo "// pdf.js $version legacy build (Apache-2.0, lib/pdfjs/LICENSE). Built by scripts/vendor-pdfjs.sh."
    echo "$shim"
    sed '/^\/\/# sourceMappingURL=/d' "$src/legacy/build/$f"; } > "lib/pdfjs/$f"
done
node - lib/pdfjs/pdf.mjs lib/pdfjs/pdf.worker.mjs <<'EOF'
const fs = require('node:fs');
for (const file of process.argv.slice(2)) {
  let src = fs.readFileSync(file, 'utf8');
  const cut = (pattern, replacement = '') => {
    const hits = src.match(pattern)?.length ?? 0;
    if (hits !== 1) throw new Error(`${file}: core-js changed (${hits} matches of ${pattern}); update this cut`);
    src = src.replace(pattern, replacement);
  };
  cut(/^\/\* global ActiveXObject -- old IE, WSH \*\/\n/gm);
  cut(/^var GT = '>';\nvar LT = '<';\n/gm);
  cut(/^var SCRIPT = 'script';\n/gm);
  cut(/^var scriptTag = function \(content\) \{\n[\s\S]*?\n  return NullProtoObject\(\);\n\};\n/gm,
    '// Only without Object.create. scripts/vendor-pdfjs.sh replaced core-js\'s old Internet Explorer fallback here.\n' +
    'var NullProtoObject = function () { return { __proto__: null }; };\n');
  cut(/^  \/\/ eslint-disable-next-line no-new-func -- fallback\n  \(function \(\) \{ return this; \}\)\(\) \|\| Function\('return this'\)\(\);\n/gm,
    '  // scripts/vendor-pdfjs.sh cut core-js\'s function-from-text fallback here: every browser Glaze supports has globalThis.\n' +
    '  (function () { return this; })();\n');
  // pdf.js's four calls of the old escape functions, written out exactly (test/vendor-pdfjs.test.js compares them with
  // the originals): text to and from UTF-8, and a Content-Disposition file name's %XX and %uXXXX.
  cut(/^  return decodeURIComponent\(escape\(str\)\);\n/gm,
    '  return decodeURIComponent(str.replace(/[^A-Za-z0-9]/g, (c) => (c.charCodeAt(0) < 256 ? "%" + c.charCodeAt(0).toString(16).padStart(2, "0") : "%u")));\n');
  cut(/^  return unescape\(encodeURIComponent\(str\)\);\n/gm,
    '  return encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));\n');
  if (file.endsWith('/pdf.mjs')) {
    const percent = '.replace(/%u([0-9A-Fa-f]{4})|%([0-9A-Fa-f]{2})/g, (_, u, x) => String.fromCharCode(parseInt(u ?? x, 16)))';
    cut(/^    filename = unescape\(filename\);\n/gm, `    filename = filename${percent};\n`);
    cut(/^        part = unescape\(part\);\n/gm, `        part = part${percent};\n`);
  }
  // Firefox: AMO's linter refuses an import it can't read, so the fake worker and the image decoders' no-wasm fallbacks
  // import fixed local files.
  if (file.endsWith('/pdf.mjs')) cut(/this\.workerSrc\);\n      return worker\.WorkerMessageHandler;/g, '"./pdf.worker.mjs");\n      return worker.WorkerMessageHandler;');
  else {
    cut(/const mod = await import\(/g, 'const mod = await (');
    cut(/`\$\{WasmImage\.#wasmUrl\}\$\{this\._noWasmFilename\}`\);/g, 'this._noWasmFilename === "jbig2_nowasm_fallback.js" ? import("./jbig2_nowasm_fallback.js")\n        : this._noWasmFilename === "openjpeg_nowasm_fallback.js" ? import("./openjpeg_nowasm_fallback.js")\n        : Promise.reject(new Error("Unknown PDF image decoder")));');
  }
  if (/\b(?:un)?escape\s*\(/.test(src)) throw new Error(`${file}: an escape function is left`);
  if (/ActiveXObject|javascript:|['"]java['"]\s*\+/i.test(src)) throw new Error(`${file}: old-IE code is left`);
  if (/\beval\s*\(|(^|[^\w$.])Function\s*\(\s*['"`]/.test(src)) throw new Error(`${file}: code made from text is left`);
  fs.writeFileSync(file, src);
}
EOF
curl -fsSL -o lib/pdfjs/brotli-dictionary.bin "https://raw.githubusercontent.com/google/brotli/$brotli/c/common/dictionary.bin"
curl -fsSL -o lib/pdfjs/LICENSE_BROTLI "https://raw.githubusercontent.com/google/brotli/$brotli/LICENSE"
echo "$brotli_dictionary_sha256  lib/pdfjs/brotli-dictionary.bin" | shasum -a 256 -c - >/dev/null
echo "$brotli_license_sha256  lib/pdfjs/LICENSE_BROTLI" | shasum -a 256 -c - >/dev/null
node scripts/vendor-pdfjs-brotli.js lib/pdfjs/pdf.worker.mjs lib/pdfjs/brotli-dictionary.bin
cp "$src/LICENSE" lib/pdfjs/LICENSE
for f in jbig2.wasm openjpeg.wasm jbig2_nowasm_fallback.js openjpeg_nowasm_fallback.js LICENSE_JBIG2 LICENSE_PDFJS_JBIG2 LICENSE_OPENJPEG LICENSE_PDFJS_OPENJPEG; do cp "$src/wasm/$f" lib/pdfjs/; done

echo "lib/pdfjs: pdf.js $version ($(du -sh lib/pdfjs | cut -f1), $(cat lib/pdfjs/* | gzip -9 | wc -c | awk '{printf "%.0f KB", $1/1024}') gzipped)"
