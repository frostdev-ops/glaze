#!/usr/bin/env bash
# Package the extension for the Chrome Web Store upload (and the Safari builds, which start from it).
# DIST: the folder the zip goes in (default dist); a relative DIST is from the repo root, where dist/ is.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root/extension"

version="$(node -p 'require("./manifest.json").version')"
dist="${DIST:-dist}"
case "$dist" in /*) ;; *) dist="$root/$dist" ;; esac
OUT="$dist/glaze-v$version.zip"
shown="${DIST:-dist}/glaze-v$version.zip"

mkdir -p "$dist"
rm -f "$OUT"
# Everything packaged is world-readable: a Safari app installed by the App Store is owned by root, and a
# file only its owner can read (the icons were 0600 here) would be unreadable to Safari.
chmod -R a+rX manifest.json popup.html options.html preview.html reader.html writer.html papers.html \
  background content core looks navigation courses planner writer documents ai agents sharing mods pet settings vendor i18n _locales fonts icons assets/logo.svg assets/logo-dark.svg assets/art/pets assets/art/stickers assets/art/cursors assets/shaders
zip -q -r -X "$OUT" manifest.json popup.html options.html preview.html reader.html writer.html papers.html \
  background content core looks navigation courses planner writer documents ai agents sharing mods pet settings vendor i18n _locales fonts icons assets/logo.svg assets/logo-dark.svg assets/art/pets assets/art/stickers assets/art/cursors assets/shaders -x '*.DS_Store'

# Google: the oauth2 key and the optional identity permission go in only for what uses them (tools/build/oauth-manifest.js):
# Calendar sync behind its build-time switch (planner/gcal.js ON, on since 4.0.1: its scope alone), Drive behind its own
# (background/google.js ON) once its clients in background/google-config.js are real. Without either, the manifest carries neither.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
node "$root/tools/build/oauth-manifest.js" chrome manifest.json > "$stage/manifest.json"
chmod a+r "$stage/manifest.json"
zip_abs="$(cd "$dist" && pwd)/glaze-v$version.zip"
(cd "$stage" && zip -q -X "$zip_abs" manifest.json)

echo "packaged Glaze v$version -> $shown ($(du -h "$OUT" | cut -f1))"
