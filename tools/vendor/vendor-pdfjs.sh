#!/usr/bin/env bash
# Rebuild lib/pdfjs/: Mozilla's prebuilt pdf.js (Apache-2.0, lib/pdfjs/LICENSE), only what Glaze uses. The two modules
# Glaze's reader (reader.html) needs to pull the text out of a PDF and to draw a scanned page for OCR, plus the
# JBIG2/CCITT and JPEG 2000 decoders scanned pages are often stored in (wasm, BSD; their licenses beside them). And
# pdf.js's viewer layer, for PDF documents: pdf_viewer.mjs, pdf_viewer.css and the pictures that stylesheet names
# (lib/pdfjs/images; pdf.js's own, and one of Firefox's under the MPL-2.0, lib/pdfjs/LICENSE_MPL).
# The modules also bundle core-js (MIT, lib/pdfjs/LICENSE_CORE_JS).
# The legacy build, because the modern one calls Promise.try, Map.prototype.getOrInsertComputed and friends
# unpolyfilled, which Chrome 116 and Safari 17 lack. Even the legacy build skips Promise.withResolvers (Chrome 119,
# Safari 17.4), so a one-line fallback goes on top of each module. The readable modules, not the minified ones: the
# Chrome Web Store rejects minified pdf.js as obfuscated (2026-10-26). For the same review, core-js's Object.create
# fallback for old Internet Explorer (an ActiveX document, or an iframe at a script URL) is cut; every browser Glaze
# supports has Object.create, so it never ran. So is core-js's last way to find the global object, a function made from
# text (globalThis always answers first), and scripts/vendor-pdfjs-brotli.js has the worker read Brotli's dictionary from
# google/brotli's dictionary.bin (pinned here, MIT) instead of the XORed string pdf.js packs it in. pdf.js's few calls of
# the old escape and unescape functions are written out as the same encoding and decoding.
# The viewer's import of pdf.js's form-script sandbox (pdf.sandbox.mjs, not shipped) is cut, so a PDF's own JavaScript
# never runs: the scripting manager fails to start a sandbox, logs it, and the document opens without its scripts.
# extractPages() takes `rotations` on each page entry, keyed like its
# includePages by source page index, that turns that page a further multiple of 90 degrees clockwise: the copy's /Rotate
# is (its own /Rotate + rotations[i]) % 360. pdf.js's own copy always keeps the page's /Rotate. A rotation that is not a
# multiple of 90 fails the call, as pdf.js's other bad entries do.
# scripts/vendor-pdfjs-limits.js adds an optional output byte limit, checked before allocating a saved or extracted PDF.
# Each cut and the patch match its upstream text exactly once or the script stops. Every download is checked against the
# SHA-256 pinned here before anything in lib/pdfjs changes. Run it to upgrade pdf.js (new version, new hash); the output
# is checked in, so the extension itself still has no build step.
# Usage: scripts/vendor-pdfjs.sh
set -euo pipefail
cd "$(dirname "$0")/.."

version=6.4.299
sha256=86269b40170eb41740ea05ad2102d71d33de4f122b34eb2f478be0ea7779c415
# google/brotli at v1.2.0: c/common/dictionary.bin (the RFC 7932 dictionary) and the licence it is under.
brotli=028fb5a23661f123017c060daa546b55cf4bde29
brotli_dictionary_sha256=20e42eb1b511c21806d4d227d07e5dd06877d8ce7b3a817f378f313653f35c70
brotli_license_sha256=3d180008e36922a4e8daec11c34c7af264fed5962d07924aea928c38e8663c94
# The MPL-2.0's text, from SPDX's licence list at v3.29.0, for the viewer's one picture under it.
spdx=31ba1a50e5397e00a304dbadc76531740e89ee48
mpl_license_sha256=66a3107d5ad6a058aab753eaac2047ccb2ed0e39465dd0fe5844da3e300d5172
# The version recorded in each module's core-js metadata; retain its copyright and permission notice too.
core_js=3.50.0
core_js_license_sha256=b87653fff2d44426ab5cd4723cee3b1364dc8d35a0acdf098c54689543123bf8
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() { # url, sha256, file in $tmp
  curl -fsSL -o "$tmp/$3" "$1"
  echo "$2  $tmp/$3" | shasum -a 256 -c - >/dev/null
}
fetch "https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-$version.tgz" "$sha256" pdfjs.tgz
fetch "https://raw.githubusercontent.com/google/brotli/$brotli/c/common/dictionary.bin" "$brotli_dictionary_sha256" brotli-dictionary.bin
fetch "https://raw.githubusercontent.com/google/brotli/$brotli/LICENSE" "$brotli_license_sha256" LICENSE_BROTLI
fetch "https://raw.githubusercontent.com/spdx/license-list-data/$spdx/text/MPL-2.0.txt" "$mpl_license_sha256" LICENSE_MPL
fetch "https://raw.githubusercontent.com/zloirock/core-js/v$core_js/LICENSE" "$core_js_license_sha256" LICENSE_CORE_JS
tar -xzf "$tmp/pdfjs.tgz" -C "$tmp"
src="$tmp/package"

shim='Promise.withResolvers||=function(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};'
rm -rf lib/pdfjs
mkdir -p lib/pdfjs/images
for f in build/pdf.mjs build/pdf.worker.mjs web/pdf_viewer.mjs; do
  { echo "// pdf.js $version legacy build (Apache-2.0, lib/pdfjs/LICENSE). Built by scripts/vendor-pdfjs.sh."
    echo "$shim"
    sed '/^\/\/# sourceMappingURL=/d' "$src/legacy/$f"; } > "lib/pdfjs/${f#*/}"
done
node - lib/pdfjs/pdf.mjs lib/pdfjs/pdf.worker.mjs lib/pdfjs/pdf_viewer.mjs <<'EOF'
const fs = require('node:fs');
// pdf.js's calls of the old escape functions, written out exactly (test/vendor-pdfjs.test.js compares them with the
// originals): %XX and %uXXXX back to characters, and characters to them the way escape wrote them.
const percent = '.replace(/%u([0-9A-Fa-f]{4})|%([0-9A-Fa-f]{2})/g, (_, u, x) => String.fromCharCode(parseInt(u ?? x, 16)))';
const escaped = '.replace(/[^\\w@*+\\-.\\/]/g, (c) => (c.charCodeAt(0) < 256 ? "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0") : "%u" + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")))';
for (const file of process.argv.slice(2)) {
  let src = fs.readFileSync(file, 'utf8');
  const cut = (pattern, replacement = '') => {
    const hits = src.match(pattern)?.length ?? 0;
    if (hits !== 1) throw new Error(`${file}: core-js changed (${hits} matches of ${pattern}); update this cut`);
    src = src.replace(pattern, () => replacement);
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
  if (!file.endsWith('/pdf_viewer.mjs')) {
    // Text to and from UTF-8.
    cut(/^  return decodeURIComponent\(escape\(str\)\);\n/gm,
      '  return decodeURIComponent(str.replace(/[^A-Za-z0-9]/g, (c) => (c.charCodeAt(0) < 256 ? "%" + c.charCodeAt(0).toString(16).padStart(2, "0") : "%u")));\n');
    cut(/^  return unescape\(encodeURIComponent\(str\)\);\n/gm,
      '  return encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));\n');
  }
  if (file.endsWith('/pdf.mjs')) {
    // A Content-Disposition file name's %XX and %uXXXX.
    cut(/^    filename = unescape\(filename\);\n/gm, `    filename = filename${percent};\n`);
    cut(/^        part = unescape\(part\);\n/gm, `        part = part${percent};\n`);
  }
  // Firefox: AMO's linter refuses an import it can't read, so the fake worker and the image decoders' no-wasm fallbacks
  // import fixed local files.
  if (file.endsWith('/pdf.mjs')) cut(/this\.workerSrc\);\n      return worker\.WorkerMessageHandler;/g, '"./pdf.worker.mjs");\n      return worker.WorkerMessageHandler;');
  if (file.endsWith('/pdf.worker.mjs')) {
    cut(/const mod = await import\(/g, 'const mod = await (');
    cut(/`\$\{WasmImage\.#wasmUrl\}\$\{this\._noWasmFilename\}`\);/g, 'this._noWasmFilename === "jbig2_nowasm_fallback.js" ? import("./jbig2_nowasm_fallback.js")\n        : this._noWasmFilename === "openjpeg_nowasm_fallback.js" ? import("./openjpeg_nowasm_fallback.js")\n        : Promise.reject(new Error("Unknown PDF image decoder")));');
  }
  if (file.endsWith('/pdf_viewer.mjs')) {
    // Firefox Add-ons flags Fluent's innerHTML sink even though its overlay sanitizes the result. Parse in an inert
    // document instead, with an explicit body to retain leading whitespace and head-like elements, then keep the same
    // template fragment and Fluent allowlists.
    cut(/^      templateElement\.innerHTML = value;\n/gm,
      '      // scripts/vendor-pdfjs.sh: parse Fluent overlays without an HTML assignment sink.\n' +
      '      const translated = new DOMParser().parseFromString("<body>" + value, "text/html");\n' +
      '      templateElement.content.append(...translated.body.childNodes);\n');
    // A destination written into a link's #hash, and read back out of the address.
    cut(/^        return this\.getAnchorUrl\("#" \+ escape\(dest\)\);\n/gm, `        return this.getAnchorUrl("#" + dest${escaped});\n`);
    cut(/^        return this\.getAnchorUrl\("#" \+ escape\(str\)\);\n/gm, `        return this.getAnchorUrl("#" + str${escaped});\n`);
    cut(/^    dest = unescape\(hash\);\n/gm, `    dest = hash${percent};\n`);
    cut(/^    console\.error\(`PDFLinkService\.setHash: "\$\{unescape\(hash\)\}" is not a valid destination\.`\);\n/gm,
      '    console.error(`PDFLinkService.setHash: "${hash' + percent + '}" is not a valid destination.`);\n');
    cut(/^    const hash = unescape\(getCurrentHash\(\)\)\.substring\(1\);\n/gm, `    const hash = getCurrentHash()${percent}.substring(1);\n`);
    // A PDF's form scripts run in a sandbox the viewer imports; PDFScriptingManager catches the throw and opens the
    // document without them.
    cut(/^  constructor\(sandboxBundleSrc, wasmUrl\) \{\n    this\._ready = new Promise\(\(resolve, reject\) => \{\n      const sandbox = import\([\s\S]*?\n      \}\)\.catch\(reject\);\n    \}\);\n  \}\n/gm,
      '  constructor() {\n    // scripts/vendor-pdfjs.sh cut the import of pdf.js\'s form-script sandbox here: Glaze runs no PDF scripts.\n' +
      '    throw new Error("PDF scripts are off in Glaze.");\n  }\n');
    if (/\bimport\s*\(/.test(src)) throw new Error(`${file}: the viewer still imports a module at run time`);
  }
  if (/(?<![\w$.]|function )(?:un)?escape\s*\(/.test(src)) throw new Error(`${file}: an escape function is left`);
  if (/ActiveXObject|javascript:|['"]java['"]\s*\+/i.test(src)) throw new Error(`${file}: old-IE code is left`);
  if (/\beval\s*\(|(^|[^\w$.])Function\s*\(\s*['"`]/.test(src)) throw new Error(`${file}: code made from text is left`);
  fs.writeFileSync(file, src);
}
EOF
# The rotation patch (see the top).
node - lib/pdfjs/pdf.worker.mjs <<'EOF'
const fs = require('node:fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const patch = (find, replacement) => {
  const hits = src.split(find).length - 1;
  if (hits !== 1) throw new Error(`${file}: pdf.js's extractPages changed (${hits} matches of ${JSON.stringify(find)}); update the rotation patch`);
  src = src.replace(find, () => replacement);
};
if (src.split('new PageData(').length !== 2) throw new Error(`${file}: pdf.js makes a page copy somewhere new; give it a rotation in the patch`);
// Where extractPages takes source page i of an entry for copying.
patch('          this.oldPages[newPageIndex] = new PageData(page, documentData);\n',
  '          this.oldPages[newPageIndex] = new PageData(page, documentData);\n' +
  '          // scripts/vendor-pdfjs.sh: the entry\'s rotations[i] turns source page i further clockwise.\n' +
  '          const extraRotate = pageInfo.rotations?.[i] ?? 0;\n' +
  '          if (!Number.isInteger(extraRotate) || extraRotate % 90 !== 0) {\n' +
  '            throw new Error("extractPages: invalid rotation.");\n' +
  '          }\n' +
  '          this.oldPages[newPageIndex].extraRotate = (extraRotate % 360 + 360) % 360;\n');
// Where #makePageCopy writes the copy's /Rotate.
patch('      copyLevel\n    } = this.oldPages[pageIndex];\n', '      copyLevel,\n      extraRotate\n    } = this.oldPages[pageIndex];\n');
patch('    pageDict.set("Rotate", rotate);\n', '    pageDict.set("Rotate", (rotate + extraRotate) % 360);\n');
fs.writeFileSync(file, src);
EOF
cp "$tmp/brotli-dictionary.bin" "$tmp/LICENSE_BROTLI" "$tmp/LICENSE_MPL" "$tmp/LICENSE_CORE_JS" lib/pdfjs/
node scripts/vendor-pdfjs-limits.js lib/pdfjs
node scripts/vendor-pdfjs-brotli.js lib/pdfjs/pdf.worker.mjs lib/pdfjs/brotli-dictionary.bin
cp "$src/LICENSE" lib/pdfjs/LICENSE
for f in jbig2.wasm openjpeg.wasm jbig2_nowasm_fallback.js openjpeg_nowasm_fallback.js LICENSE_JBIG2 LICENSE_PDFJS_JBIG2 LICENSE_OPENJPEG LICENSE_PDFJS_OPENJPEG; do cp "$src/wasm/$f" lib/pdfjs/; done
{ echo "/* pdf.js $version legacy viewer styles (Apache-2.0, lib/pdfjs/LICENSE). Built by scripts/vendor-pdfjs.sh. */"
  sed '/^\/\*# sourceMappingURL=/d' "$src/legacy/web/pdf_viewer.css"; } > lib/pdfjs/pdf_viewer.css
for image in $(grep -oE 'url\("?images/[A-Za-z0-9_-]+\.(svg|gif)' lib/pdfjs/pdf_viewer.css | sed -E 's/^url\("?//' | sort -u); do
  cp "$src/legacy/web/$image" "lib/pdfjs/$image"
done

echo "lib/pdfjs: pdf.js $version ($(du -sh lib/pdfjs | cut -f1), $(find lib/pdfjs -type f -exec cat {} + | gzip -9 | wc -c | awk '{printf "%.0f KB", $1/1024}') gzipped)"
