#!/bin/sh
# Build a universal Developer ID release of the Safari Mac app. Use NOTARY_PROFILE or ASC_KEY_* to notarize.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
if [ "$(uname)" != Darwin ]; then
  echo "build-safari: macOS and Xcode are required." >&2
  exit 1
fi

identity=${SAFARI_SIGN_IDENTITY:-Developer ID Application: James Kueller (22AAZFMTV8)}
team=${SAFARI_TEAM_ID:-22AAZFMTV8}
version=$(node -p 'require("./manifest.json").version')
out=release/$version
# Deleting an older indexed build can make Safari remove the installed extension's data.
if [ -e "$out/build/Glaze.app" ] || [ -L "$out/build/Glaze.app" ]; then
  echo "build-safari: $out/build/Glaze.app must be removed with a Safari data backup before building." >&2
  exit 1
fi
./package.sh

# Build from a copy, so the checked-in project's native code and any local Xcode edits stay as they are.
stage=$(mktemp -d)
lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
# Xcode registers every Mac app it builds, and Safari reacts to each copy of Glaze: one not yet notarized, or any copy
# unregistered (lsregister -u, pluginkit -r), can make it delete the installed Glaze's settings. So Xcode builds under ids
# of its own, ad hoc; Glaze's ids and signature go on a copy Launch Services never sees, in a folder Spotlight skips.
installed=$(pluginkit -m -v -i io.frostdev.Glaze.Extension 2>/dev/null |
  sed -n 's#^.*[[:space:]]\(/.*\.app\)/Contents/PlugIns/Glaze Extension\.appex$#\1#p' | head -n 1)
cleanup() {
  if [ -n "$installed" ] && [ -d "$installed" ]; then
    "$lsregister" -f "$installed" >/dev/null 2>&1 || true
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
built="$stage/DerivedData/Build/Products/Release/Glaze.app"
app="$stage/release/Glaze.app"
# The public half of the Sparkle signing key (generate_keys, login Keychain account "ed25519"); not a secret.
export SAFARI_UPDATE_PUBLIC_KEY="${SAFARI_UPDATE_PUBLIC_KEY:-0lbeC9MO1QDsjSGjs6iyxSBwXKMpEiKVoB+5wZwQEqY=}"
# Only the DMG project contains Sparkle. Stage-only usage never reaches signing/notarization.
python3 scripts/stage-safari-dmg.py "$stage"
python3 - "$stage/Glaze/Glaze.xcodeproj/project.pbxproj" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    project = plistlib.load(f)
n = 0
for o in project['objects'].values():
    s = o.get('buildSettings', {})
    i = s.get('PRODUCT_BUNDLE_IDENTIFIER', '')
    if i == 'io.frostdev.Glaze' or i.startswith('io.frostdev.Glaze.'):
        s['PRODUCT_BUNDLE_IDENTIFIER'] = 'io.frostdev.GlazeBuild' + i[len('io.frostdev.Glaze'):]
        n += 1
if not n:
    sys.exit('build-safari: the staged project has no Glaze bundle ids')
with open(sys.argv[1], 'wb') as f:
    plistlib.dump(project, f)
PY
# The app bundles only what the Xcode project lists: stop before building if the package has something it doesn't.
node scripts/safari-resources.js "$stage/Glaze/Glaze Extension/Resources"
case "${SAFARI_UPDATE_PUBLIC_KEY:-}" in
  ''|REPLACE_*) echo "build-safari: set SAFARI_UPDATE_PUBLIC_KEY from Sparkle generate_keys before releasing." >&2; exit 1 ;;
esac

# Everything for this version goes in release/<version>/: downloads in github/, logs in build/.
logs=$out/build/logs
mkdir -p "$logs" "$out/github"
if ! xcodebuild -project "$stage/Glaze/Glaze.xcodeproj" \
  -scheme Glaze -configuration Release -derivedDataPath "$stage/DerivedData" \
  -destination 'generic/platform=macOS' \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM="$team" \
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  'CODE_SIGN_ENTITLEMENTS=$(SRCROOT)/$(TARGET_NAME)/Release.entitlements' \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO MACOSX_DEPLOYMENT_TARGET=12.0 \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$version" build > "$logs/safari-build.log" 2>&1; then
  tail -n 60 "$logs/safari-build.log" >&2
  exit 1
fi

# The release copy, under Glaze's own ids.
mkdir "$stage/release"
ditto "$built" "$app"
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")" = io.frostdev.GlazeBuild
plutil -replace CFBundleIdentifier -string io.frostdev.Glaze "$app/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string io.frostdev.Glaze.Extension "$app/Contents/PlugIns/Glaze Extension.appex/Contents/Info.plist"

# Check package integration and URL registration before final re-signing and packaging.
test -d "$app/Contents/Frameworks/Sparkle.framework" || { echo "build-safari: Sparkle framework is missing" >&2; exit 1; }
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$app/Contents/Info.plist" | grep -qx 'io.frostdev.glaze-update'
/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$app/Contents/Info.plist" | grep -qxF "$SAFARI_UPDATE_PUBLIC_KEY" || { echo "build-safari: the app doesn't carry the Sparkle public key" >&2; exit 1; }

extension="$app/Contents/PlugIns/Glaze Extension.appex"
# Re-sign Sparkle's nested helpers inside out; never use --deep for signing.
sparkle="$app/Contents/Frameworks/Sparkle.framework/Versions/B"
# What Xcode signs keeps Xcode's designated requirement, which also accepts the Mac App Store's signature.
xcode_signed() { case "$1" in "$app/Contents/Frameworks/Sparkle.framework" | "$extension" | "$app") return 0 ;; esac; return 1; }
for bundle in "$sparkle/XPCServices/Downloader.xpc" "$sparkle/XPCServices/Installer.xpc" \
  "$sparkle/Autoupdate" "$sparkle/Updater.app" "$app/Contents/Frameworks/Sparkle.framework" \
  "$extension" "$app"; do
  if xcode_signed "$bundle"; then
    plist="$bundle/Contents/Info.plist"
    [ -f "$plist" ] || plist="$bundle/Resources/Info.plist"
    id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")
    codesign --force --sign "$identity" --timestamp --options runtime --identifier "$id" --preserve-metadata=entitlements,flags \
      --requirements "=designated => anchor apple generic and identifier \"$id\" and (certificate leaf[field.1.2.840.113635.100.6.1.9] /* exists */ or certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = \"$team\")" \
      "$bundle"
  else
    codesign --force --sign "$identity" --timestamp --options runtime --preserve-metadata=identifier,entitlements,flags "$bundle"
  fi
done
codesign --verify --deep --strict --verbose=2 "$app"
codesign -dv "$app" 2>&1 | grep -qx 'Identifier=io.frostdev.Glaze' && codesign -dv "$extension" 2>&1 | grep -qx 'Identifier=io.frostdev.Glaze.Extension' ||
  { echo "build-safari: the release copy isn't signed under Glaze's own ids" >&2; exit 1; }
find "$app" -type f | while IFS= read -r file; do
  if file -b "$file" | grep -q Mach-O && ! codesign -dvv "$file" 2>&1 | grep -qxF "Authority=$identity"; then
    echo "build-safari: $file is not signed with $identity" >&2
    exit 1
  fi
done

# Keep a debug entitlement from slipping into a release.
for bundle in "$extension" "$app"; do
  codesign -d --entitlements - --xml "$bundle" > "$stage/entitlements.plist" 2>/dev/null
  python3 - "$stage/entitlements.plist" "$bundle" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as f:
    entitlements = plistlib.load(f)
if entitlements.get('com.apple.security.get-task-allow'):
    sys.exit('build-safari: debug entitlement found in release')
if sys.argv[2].endswith('.appex') and not entitlements.get('com.apple.security.app-sandbox'):
    sys.exit('build-safari: the Safari extension must be sandboxed')
PY
done

archive="$stage/glaze-safari.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
if [ -n "${NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$archive" --keychain-profile "$NOTARY_PROFILE" \
    --wait --output-format json > "$logs/safari-notarization.json"
elif [ -n "${ASC_KEY_PATH:-}" ]; then
  : "${ASC_KEY_ID:?ASC_KEY_ID is required with ASC_KEY_PATH}"
  : "${ASC_ISSUER_ID:?ASC_ISSUER_ID is required with ASC_KEY_PATH}"
  xcrun notarytool submit "$archive" --key "$ASC_KEY_PATH" \
    --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
    --wait --output-format json > "$logs/safari-notarization.json"
fi
if [ -n "${NOTARY_PROFILE:-}${ASC_KEY_PATH:-}" ]; then
  python3 - "$logs/safari-notarization.json" <<'PY'
import json, sys
result = json.load(open(sys.argv[1]))
if result.get('status') != 'Accepted':
    sys.exit(f'build-safari: notarization was not accepted; see {sys.argv[1]}')
PY
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  spctl --assess --type execute --verbose=4 "$app"
  name="glaze-$version-safari-macos"
else
  name="glaze-$version-safari-macos-unnotarized"
  echo "Signed only: Safari requires notarization for normal installation."
  echo "Set NOTARY_PROFILE to a saved notarytool Keychain profile and rerun."
fi

# Only the downloads hold the app: an unpacked copy in release/ would be another Glaze to Safari.
ditto -c -k --sequesterRsrc --keepParent "$app" "$out/github/$name.zip"
(cd "$out/github" && shasum -a 256 "$name.zip" > "$name.sha256")
echo "Built $out/github/$name.zip"
if [ -n "${NOTARY_PROFILE:-}${ASC_KEY_PATH:-}" ]; then
  sh scripts/make-dmg.sh "$app" "$out/github/$name.dmg"
fi
