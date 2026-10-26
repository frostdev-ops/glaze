#!/bin/sh
# Package Glaze for Firefox (addons.mozilla.org) from the Chrome package: dist/glaze-v<version>-firefox.zip.
# Firefox has no extension service worker: the background runs as an event page from every script the worker
# imports, listed in order, and importScripts becomes a no-op. Google Calendar sync needs Chrome's identity API,
# so its oauth2 key and permission go, as in Safari. DIST: the folder the zips go in (default dist).
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
development=false
case "${1:-}" in
  '') ;;
  --development) development=true ;;
  *) echo 'usage: sh scripts/package-firefox.sh [--development]' >&2; exit 2 ;;
esac
branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
commit=$(git rev-parse --verify HEAD 2>/dev/null || printf unknown)
dirty=false
git diff --quiet HEAD -- 2>/dev/null || dirty=true
if [ "$development" = false ]; then
  if [ "$branch" != dev/firefox ] || [ "$dirty" = true ]; then
    echo 'Firefox release packages require a clean dev/firefox checkout. Use --development only for local checks.' >&2
    exit 1
  fi
else
  echo 'Building a Firefox development package; do not upload it to a store.' >&2
fi
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
cat > "$stage/lib/gcal-auth.js" <<'JS'
// Firefox has no Chrome Google sign-in API; calendar-file export remains available.
var GZ_GCAL_AUTH = {
  token: async () => { throw new Error('Google Calendar sign-in requires Chrome.'); },
  drop: async () => {},
  clear: async () => {},
};
JS
node - "$stage/manifest.json" "$stage/lib/background.js" "$stage/popup.js" "$development" "$branch" "$commit" "$dirty" <<'JS'
const fs = require('fs');
const path = require('path');
const [file, background, popup, development, branch, commit, dirty] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(file, 'utf8'));
if (development === 'true') m.name = `${m.short_name} (Firefox development)`;
fs.writeFileSync(path.join(path.dirname(file), 'glaze-build.json'), JSON.stringify({ target: 'firefox', development: development === 'true', branch, commit, dirty: dirty === 'true' }, null, 2) + '\n');
// Every importScripts call in the worker, in order, as paths from the package root.
const imports = [...fs.readFileSync(background, 'utf8').matchAll(/importScripts\(([^)]*)\)/g)]
  .flatMap(([, args]) => [...args.matchAll(/'([^']+)'/g)].map(([, f]) => path.posix.join('lib', f)));
m.background = { scripts: ['lib/firefox-background.js', ...new Set(imports), 'lib/background.js'] };
delete m.minimum_chrome_version;
delete m.oauth2;
m.optional_permissions = (m.optional_permissions || []).filter((p) => p !== 'identity');
if (!m.optional_permissions.length) delete m.optional_permissions;
for (const entry of m.web_accessible_resources || []) delete entry.use_dynamic_url;
// Firefox has no declarativeContent (Chrome's lit button) and no addHostAccessRequest; AMO's linter flags both, the second
// even behind popup.js's check, so the Firefox popup goes without that line. The button starts on the toolbar for new
// installs (default_area, Firefox's own key). The hosts stay Chrome's: built-in ones required, a school's own asked for.
m.permissions = m.permissions.filter((p) => p !== 'declarativeContent');
m.action = { ...m.action, default_area: 'navbar' };
if (fs.existsSync(popup)) {
  const hostAccess = /^(\s*)const hostAccess = typeof chrome\.permissions\.addHostAccessRequest === 'function' \? .*$/m;
  const popupJs = fs.readFileSync(popup, 'utf8');
  if (!hostAccess.test(popupJs)) throw new Error('popup.js: the extensions-menu line to leave out has changed');
  fs.writeFileSync(popup, popupJs.replace(hostAccess, '$1const hostAccess = null;'));
  if (fs.readFileSync(popup, 'utf8').includes('addHostAccessRequest')) throw new Error('popup.js still names addHostAccessRequest');
}
// Code mods need Chrome: no sandbox page, no sandbox CSP and none of its files. content.js starts code mods
// only where the manifest has the sandbox; declarative widgets (features/modwidgets.js, drawn by features/modui.js) run here.
delete m.sandbox;
delete m.content_security_policy?.sandbox;
m.web_accessible_resources = (m.web_accessible_resources || []).map((e) => ({ ...e, resources: e.resources.filter((r) => !r.startsWith('mods/')) })).filter((e) => e.resources.length);
// 140 (ESR) reads data_collection_permissions; 127+ grants host permissions at install. Glaze sends nothing anywhere
// on its own: shared sessions and the Looks gallery go out only when the user starts them.
m.browser_specific_settings = {
  gecko: { id: 'glaze@frostdev.io', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } },
  gecko_android: { strict_min_version: '142.0' },
};
fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n');
JS
rm -rf "$stage/mods" "$stage/features/mods.js"
chmod -R a+rX "$stage"
out="$(cd "$dist" && pwd)/glaze-v$version-firefox.zip"
rm -f "$out"
(cd "$stage" && zip -q -r -X "$out" . -x '*.DS_Store')
echo "packaged Glaze v$version for Firefox -> $dist/glaze-v$version-firefox.zip ($(du -h "$out" | cut -f1))"
