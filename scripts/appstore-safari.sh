#!/bin/sh
# Build the Safari app for the Mac App Store and upload it to App Store Connect.
# Needs an App Store Connect API key with the Admin role (Xcode creates the distribution certificate
# and profiles on first use): ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID. APPSTORE_EXPORT_ONLY=1 builds the
# signed package into release/ without uploading. The app record must already exist in App Store Connect.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
: "${ASC_KEY_PATH:?ASC_KEY_PATH is required}" "${ASC_KEY_ID:?ASC_KEY_ID is required}" "${ASC_ISSUER_ID:?ASC_ISSUER_ID is required}"
team=${SAFARI_TEAM_ID:-22AAZFMTV8}
version=$(node -p 'require("./manifest.json").version')
# Every upload needs a new build number; the time keeps them increasing.
build=${BUILD_NUMBER:-$(date -u +%Y%m%d%H%M)}
./package.sh

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R safari/Glaze "$stage/Glaze"
resources="$stage/Glaze/Glaze Extension/Resources"
rm -rf "$resources"
mkdir -p "$resources"
unzip -q "dist/glaze-v$version.zip" -d "$resources"
sh scripts/safari-manifest.sh "$resources/manifest.json"

auth="-allowProvisioningUpdates -authenticationKeyPath $ASC_KEY_PATH -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
mkdir -p release
# shellcheck disable=SC2086
if ! xcodebuild archive -project "$stage/Glaze/Glaze.xcodeproj" -scheme Glaze -configuration Release \
  -archivePath "$stage/Glaze.xcarchive" -destination 'generic/platform=macOS' $auth \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$team" CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO \
  'CODE_SIGN_ENTITLEMENTS=$(SRCROOT)/$(TARGET_NAME)/Release.entitlements' \
  'ARCHS=arm64 x86_64' ONLY_ACTIVE_ARCH=NO MACOSX_DEPLOYMENT_TARGET=12.0 \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build" > release/appstore-build.log 2>&1; then
  tail -n 60 release/appstore-build.log >&2
  exit 1
fi

destination=upload
[ -n "${APPSTORE_EXPORT_ONLY:-}" ] && destination=export
cat > "$stage/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$destination</string>
  <key>teamID</key><string>$team</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
EOF
# shellcheck disable=SC2086
if ! xcodebuild -exportArchive -archivePath "$stage/Glaze.xcarchive" \
  -exportOptionsPlist "$stage/ExportOptions.plist" -exportPath "$stage/export" $auth \
  >> release/appstore-build.log 2>&1; then
  tail -n 40 release/appstore-build.log >&2
  exit 1
fi
if [ "$destination" = export ]; then
  cp "$stage"/export/*.pkg "release/glaze-$version-appstore.pkg"
  echo "Built release/glaze-$version-appstore.pkg (build $build); not uploaded."
else
  echo "Uploaded Glaze $version (build $build) to App Store Connect."
fi
