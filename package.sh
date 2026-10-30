#!/usr/bin/env bash
# Package the extension for the Chrome Web Store upload (and the Safari builds, which start from it).
# DIST: the folder the zip goes in (default dist).
set -euo pipefail
cd "$(dirname "$0")"

version="$(node -p 'require("./manifest.json").version')"
dist="${DIST:-dist}"
OUT="$dist/glaze-v$version.zip"

mkdir -p "$dist"
rm -f "$OUT"
# Everything packaged is world-readable: a Safari app installed by the App Store is owned by root, and a
# file only its owner can read (the icons were 0600 here) would be unreadable to Safari.
chmod -R a+rX manifest.json content.js content-ultra.js content-canvas.js defaults.js lib i18n _locales theme.css motion.css extras.css canvas.css moodle.css features \
  popup.html popup.js options.html options.js preview.html reader.html reader.js writer.html writer.js writer.css writer-ai.js writer-ai.css writer-mcp.js writer-compose.js writer-compose.css writer-proof.js writer-proof.css writer-cite.js writer-cite.css writer-paper.js writer-paper.css writer-submit.js writer-submit.css writer-import.js writer-import.css writer-kinds.js writer-objects.js writer-objects.css writer-find.js writer-print.js writer-counts.js writer-edit.css writer-paste.js writer-ruler.js writer-ruler.css papers.html papers.js papers.css papers-motion.js sheet-kind.js sheet-grid.js sheet-data.js sheet.css pdf-kind.js pdf-kind.css slides-kind.js slides-kind.css sharing mods ui.js ui.css fonts icons assets/logo.svg assets/logo-dark.svg assets/art/pets assets/art/stickers assets/art/cursors assets/shaders
zip -q -r -X "$OUT" manifest.json content.js content-ultra.js content-canvas.js defaults.js lib i18n _locales theme.css motion.css extras.css canvas.css moodle.css features \
  popup.html popup.js options.html options.js preview.html reader.html reader.js writer.html writer.js writer.css writer-ai.js writer-ai.css writer-mcp.js writer-compose.js writer-compose.css writer-proof.js writer-proof.css writer-cite.js writer-cite.css writer-paper.js writer-paper.css writer-submit.js writer-submit.css writer-import.js writer-import.css writer-kinds.js writer-objects.js writer-objects.css writer-find.js writer-print.js writer-counts.js writer-edit.css writer-paste.js writer-ruler.js writer-ruler.css papers.html papers.js papers.css papers-motion.js sheet-kind.js sheet-grid.js sheet-data.js sheet.css pdf-kind.js pdf-kind.css slides-kind.js slides-kind.css sharing mods ui.js ui.css fonts icons assets/logo.svg assets/logo-dark.svg assets/art/pets assets/art/stickers assets/art/cursors assets/shaders -x '*.DS_Store'

# Google: the oauth2 key and the optional identity permission go in only for what uses them (scripts/oauth-manifest.js):
# Calendar sync behind its build-time switch (lib/gcal.js ON, off until Google verifies the app), Drive once its clients
# in lib/google-config.js are real. Without either, the packaged manifest carries neither.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
node scripts/oauth-manifest.js chrome manifest.json > "$stage/manifest.json"
chmod a+r "$stage/manifest.json"
zip_abs="$(cd "$dist" && pwd)/glaze-v$version.zip"
(cd "$stage" && zip -q -X "$zip_abs" manifest.json)

echo "packaged Glaze v$version -> $OUT ($(du -h "$OUT" | cut -f1))"
