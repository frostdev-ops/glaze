#!/usr/bin/env bash
# Package the extension for the Chrome Web Store upload.
set -euo pipefail
cd "$(dirname "$0")"

version="$(node -p 'require("./manifest.json").version')"
OUT="dist/glaze-v$version.zip"

mkdir -p dist
rm -f "$OUT"
# Everything packaged is world-readable: a Safari app installed by the App Store is owned by root, and a
# file only its owner can read (the icons were 0600 here) would be unreadable to Safari.
chmod -R a+rX manifest.json content.js defaults.js lib i18n _locales theme.css motion.css extras.css canvas.css features \
  popup.html popup.js options.html options.js preview.html ui.js ui.css fonts icons
zip -q -r -X "$OUT" manifest.json content.js defaults.js lib i18n _locales theme.css motion.css extras.css canvas.css features \
  popup.html popup.js options.html options.js preview.html ui.js ui.css fonts icons -x '*.DS_Store'

echo "packaged Glaze v$version -> $OUT ($(du -h "$OUT" | cut -f1))"
