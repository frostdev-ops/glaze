#!/bin/sh
# Package Glaze for Firefox (addons.mozilla.org) from the Chrome package: dist/glaze-v<version>-firefox.zip.
# Firefox has no extension service worker: the background runs as an event page from every script the worker
# imports, listed in order, and importScripts becomes a no-op. Google Calendar sync needs Chrome's identity API,
# so its oauth2 key and permission go, as in Safari. DIST: the folder the zips go in (default dist).
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
dist=${DIST:-dist}
version=$(node -p 'require("./manifest.json").version')
DIST=$dist ./package.sh >/dev/null

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
unzip -q "$dist/glaze-v$version.zip" -d "$stage"
cat > "$stage/lib/firefox-background.js" <<'JS'
// Firefox runs the background as an event page: the manifest already loads every script the worker would import.
globalThis.importScripts = () => {};
JS
node - "$stage/manifest.json" "$stage/lib/background.js" <<'JS'
const fs = require('fs');
const path = require('path');
const [file, background] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
// Every importScripts call in the worker, in order, as paths from the package root.
const imports = [...fs.readFileSync(background, 'utf8').matchAll(/importScripts\(([^)]*)\)/g)]
  .flatMap(([, args]) => [...args.matchAll(/'([^']+)'/g)].map(([, f]) => path.posix.join('lib', f)));
m.background = { scripts: ['lib/firefox-background.js', ...new Set(imports), 'lib/background.js'] };
delete m.minimum_chrome_version;
delete m.oauth2;
m.optional_permissions = (m.optional_permissions || []).filter((p) => p !== 'identity');
if (!m.optional_permissions.length) delete m.optional_permissions;
for (const entry of m.web_accessible_resources || []) delete entry.use_dynamic_url;
// 140 (ESR) reads data_collection_permissions; 127+ grants host permissions at install. Glaze sends nothing anywhere
// on its own: shared sessions and the Looks gallery go out only when the user starts them.
m.browser_specific_settings = { gecko: { id: 'glaze@frostdev.io', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } } };
fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
JS
chmod -R a+rX "$stage"
out="$(cd "$dist" && pwd)/glaze-v$version-firefox.zip"
rm -f "$out"
(cd "$stage" && zip -q -r -X "$out" . -x '*.DS_Store')
echo "packaged Glaze v$version for Firefox -> $dist/glaze-v$version-firefox.zip ($(du -h "$out" | cut -f1))"
