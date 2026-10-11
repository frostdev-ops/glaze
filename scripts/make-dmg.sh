#!/bin/sh
# Wrap a notarized Glaze.app in a signed, notarized disk image with a drag-to-Applications link.
#   sh scripts/make-dmg.sh release/Glaze.app release/glaze-2.0.1-safari-macos.dmg
# Uses the same signing identity and notarization credentials as build-safari.sh.
set -eu

app=$1
out=$2
identity=${SAFARI_SIGN_IDENTITY:-Developer ID Application: James Kueller (22AAZFMTV8)}
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir "$stage/Glaze"
ditto "$app" "$stage/Glaze/Glaze.app"
ln -s /Applications "$stage/Glaze/Applications"
rm -f "$out"
hdiutil create -quiet -volname Glaze -srcfolder "$stage/Glaze" -fs HFS+ -format UDZO -ov "$out"
codesign --force --sign "$identity" --timestamp "$out"

if [ -n "${NOTARY_PROFILE:-}" ]; then
  xcrun notarytool submit "$out" --keychain-profile "$NOTARY_PROFILE" --wait --output-format json > "$stage/n.json"
elif [ -n "${ASC_KEY_PATH:-}" ]; then
  xcrun notarytool submit "$out" --key "$ASC_KEY_PATH" --key-id "$ASC_KEY_ID" --issuer "$ASC_ISSUER_ID" \
    --wait --output-format json > "$stage/n.json"
else
  echo "make-dmg: signed only; set NOTARY_PROFILE or ASC_KEY_* to notarize." >&2
  exit 0
fi
python3 - "$stage/n.json" <<'PY'
import json, sys
if json.load(open(sys.argv[1])).get('status') != 'Accepted':
    sys.exit('make-dmg: notarization was not accepted')
PY
xcrun stapler staple "$out"
spctl --assess --type open --context context:primary-signature --verbose=2 "$out"
(cd "$(dirname "$out")" && shasum -a 256 "$(basename "$out")" > "$(basename "$out" .dmg).dmg.sha256")
echo "Built $out"
