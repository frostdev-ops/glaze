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
./package.sh

# Build from a copy, so the checked-in project's native code and any local Xcode edits stay as they are.
stage=$(mktemp -d)
cleanup() {
  # Xcode registers build products; remove the temporary copy from Safari's list.
  if [ -n "${app:-}" ] && [ -d "$app" ]; then
    pluginkit -r "$app/Contents/PlugIns/Glaze Extension.appex" >/dev/null 2>&1 || true
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
      -u "$app" >/dev/null 2>&1 || true
  fi
  rm -rf "$stage"
}
trap cleanup EXIT
app="$stage/DerivedData/Build/Products/Release/Glaze.app"
# Only the DMG project contains Sparkle. Stage-only usage never reaches signing/notarization.
python3 scripts/stage-safari-dmg.py "$stage"
case "${SAFARI_UPDATE_PUBLIC_KEY:-}" in
  ''|REPLACE_*) echo "build-safari: set SAFARI_UPDATE_PUBLIC_KEY from Sparkle generate_keys before releasing." >&2; exit 1 ;;
esac

mkdir -p release
if ! xcodebuild -project "$stage/Glaze/Glaze.xcodeproj" \
  -scheme Glaze -configuration Release -derivedDataPath "$stage/DerivedData" \
  -destination 'generic/platform=macOS' \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="$identity" DEVELOPMENT_TEAM="$team" \
  CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  'CODE_SIGN_ENTITLEMENTS=$(SRCROOT)/$(TARGET_NAME)/Release.entitlements' \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO MACOSX_DEPLOYMENT_TARGET=12.0 \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$version" build > release/safari-build.log 2>&1; then
  tail -n 60 release/safari-build.log >&2
  exit 1
fi

# Check package integration and URL registration before final re-signing and packaging.
test -d "$app/Contents/Frameworks/Sparkle.framework" || { echo "build-safari: Sparkle framework is missing" >&2; exit 1; }
/usr/libexec/PlistBuddy -c 'Print :CFBundleURLTypes:0:CFBundleURLSchemes:0' "$app/Contents/Info.plist" | grep -qx 'io.frostdev.glaze-update'

extension="$app/Contents/PlugIns/Glaze Extension.appex"
# Re-sign Sparkle's nested helpers inside out; never use --deep for signing.
sparkle="$app/Contents/Frameworks/Sparkle.framework/Versions/B"
for bundle in "$sparkle/XPCServices/Downloader.xpc" "$sparkle/XPCServices/Installer.xpc" \
  "$sparkle/Autoupdate" "$sparkle/Updater.app" "$app/Contents/Frameworks/Sparkle.framework" \
  "$extension" "$app"; do
  codesign --force --sign "$identity" --timestamp --options runtime \
    --preserve-metadata=identifier,entitlements,requirements,flags "$bundle"
done
codesign --verify --deep --strict --verbose=2 "$app"

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
    --wait --output-format json > release/safari-notarization.json
elif [ -n "${ASC_KEY_PATH:-}" ]; then
  : "${ASC_KEY_ID:?ASC_KEY_ID is required with ASC_KEY_PATH}"
  : "${ASC_ISSUER_ID:?ASC_ISSUER_ID is required with ASC_KEY_PATH}"
  xcrun notarytool submit "$archive" --key "$ASC_KEY_PATH" \
    --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
    --wait --output-format json > release/safari-notarization.json
fi
if [ -n "${NOTARY_PROFILE:-}${ASC_KEY_PATH:-}" ]; then
  python3 - <<'PY'
import json, sys
result = json.load(open('release/safari-notarization.json'))
if result.get('status') != 'Accepted':
    sys.exit('build-safari: notarization was not accepted; see release/safari-notarization.json')
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

# Replace only the generated release app, after all requested checks pass.
rm -rf release/Glaze.app
ditto "$app" release/Glaze.app
ditto -c -k --sequesterRsrc --keepParent release/Glaze.app "release/$name.zip"
(cd release && shasum -a 256 "$name.zip" > "$name.sha256")
echo "Built release/Glaze.app and release/$name.zip"
if [ -n "${NOTARY_PROFILE:-}${ASC_KEY_PATH:-}" ]; then
  sh scripts/make-dmg.sh release/Glaze.app "release/$name.dmg"
fi
# Keep the release copy out of Safari's Extensions list too (making the disk image registers it).
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -u release/Glaze.app >/dev/null 2>&1 || true
