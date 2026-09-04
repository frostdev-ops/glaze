#!/usr/bin/env bash
# Package the extension for the Chrome Web Store upload.
set -euo pipefail
cd "$(dirname "$0")"

version="$(node -p 'require("./manifest.json").version')"
OUT="dist/glaze-v$version.zip"

mkdir -p dist
rm -f "$OUT"
zip -q -r -X "$OUT" manifest.json content.js theme.css defaults.js popup.html popup.js presets.js icons

echo "packaged Glaze v$version -> $OUT ($(du -h "$OUT" | cut -f1))"
