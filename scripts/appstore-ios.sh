#!/bin/sh
# Archive the iPhone and iPad app for the App Store: release/Glaze-iOS.xcarchive and release/glaze-<version>-ios.ipa.
# Same bundle ids as the Mac app, so both platforms share one App Store record (universal purchase).
# Signs with App Store profiles already on this Mac. With an App Store Connect API key (ASC_KEY_PATH, ASC_KEY_ID,
# ASC_ISSUER_ID) Xcode may create missing certificates and profiles. Nothing is uploaded unless APPSTORE_UPLOAD=1.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
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
# The app bundles only what the Xcode project lists: stop before building if the package has something it doesn't.
node scripts/safari-resources.js "$resources"

auth=""
if [ -n "${ASC_KEY_PATH:-}" ]; then
  : "${ASC_KEY_ID:?ASC_KEY_ID is required with ASC_KEY_PATH}" "${ASC_ISSUER_ID:?ASC_ISSUER_ID is required with ASC_KEY_PATH}"
  auth="-allowProvisioningUpdates -authenticationKeyPath $ASC_KEY_PATH -authenticationKeyID $ASC_KEY_ID -authenticationKeyIssuerID $ASC_ISSUER_ID"
fi
mkdir -p release
# The archive is left unsigned and the export signs it for the App Store (cloud signing through the API key):
# signing the archive itself needs a development profile, which Apple only makes once the team has a device.
# shellcheck disable=SC2086
if ! xcodebuild archive -project "$stage/Glaze/Glaze.xcodeproj" -scheme "Glaze iOS" -configuration Release \
  -archivePath "$stage/Glaze-iOS.xcarchive" -destination 'generic/platform=iOS' $auth \
  CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$team" CODE_SIGNING_ALLOWED=NO \
  MARKETING_VERSION="$version" CURRENT_PROJECT_VERSION="$build" > release/ios-build.log 2>&1; then
  tail -n 60 release/ios-build.log >&2
  exit 1
fi
rm -rf release/Glaze-iOS.xcarchive
ditto "$stage/Glaze-iOS.xcarchive" release/Glaze-iOS.xcarchive

destination=export
[ -n "${APPSTORE_UPLOAD:-}" ] && destination=upload
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
if ! xcodebuild -exportArchive -archivePath "$stage/Glaze-iOS.xcarchive" \
  -exportOptionsPlist "$stage/ExportOptions.plist" -exportPath "$stage/export" $auth \
  >> release/ios-build.log 2>&1; then
  tail -n 40 release/ios-build.log >&2
  echo "Archived release/Glaze-iOS.xcarchive (build $build), but the App Store export failed; see release/ios-build.log." >&2
  exit 1
fi
if [ "$destination" = export ]; then
  cp "$stage"/export/*.ipa "release/glaze-$version-ios.ipa"
  echo "Built release/glaze-$version-ios.ipa and release/Glaze-iOS.xcarchive (build $build); not uploaded."
else
  echo "Uploaded Glaze $version for iOS (build $build) to App Store Connect."
fi
