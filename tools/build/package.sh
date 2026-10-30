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

# Google Calendar sync waits behind its build-time switch (planner/gcal.js ON) until Google verifies the app. While it's
# off, the packaged manifest carries neither its oauth2 client nor the optional identity permission it would ask for.
if [ "$(node -p 'require("./planner/gcal.js").ON')" != true ]; then
  stage="$(mktemp -d)"
  trap 'rm -rf "$stage"' EXIT
  node -e '
    const m = require("./manifest.json");
    delete m.oauth2;
    m.optional_permissions = (m.optional_permissions || []).filter((p) => p !== "identity");
    if (!m.optional_permissions.length) delete m.optional_permissions;
    process.stdout.write(JSON.stringify(m, null, 2) + "\n");
  ' > "$stage/manifest.json"
  chmod a+r "$stage/manifest.json"
  zip_abs="$(cd "$dist" && pwd)/glaze-v$version.zip"
  (cd "$stage" && zip -q -X "$zip_abs" manifest.json)
fi

echo "packaged Glaze v$version -> $shown ($(du -h "$OUT" | cut -f1))"
