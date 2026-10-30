#!/bin/sh
# Upload the Chrome package to the Web Store and submit it for review (Chrome Web Store API v2).
# gcloud mints a short-lived token by impersonating the publisher's service account: no key file.
# Listing text, screenshots and privacy answers are not in the API; edit those in the dashboard.
#   sh scripts/publish-chrome.sh [zip]     CWS_NO_PUBLISH=1 uploads without submitting.
# With no zip it packages a fresh checkout of the committed HEAD (as CI does for a tag) and refuses a working tree with
# uncommitted or untracked files, so it packages the same committed sources as the tag build. ZIP timestamps can differ;
# recovery publication must attach these exact local bytes and their matching checksum to the draft GitHub release.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"
publisher=${CWS_PUBLISHER_ID:-82318a69-812d-438a-842f-e87fcaec1bd6} # the dashboard URL after /devconsole/
item=${CWS_EXTENSION_ID:-jmmaeoajomodnbnlmdikjooalmcilooh}
account=${CWS_SERVICE_ACCOUNT:-cws-publisher@frostdev-507119.iam.gserviceaccount.com}
version=$(node -p 'require("./manifest.json").version')
zip=${1:-}
if [ -z "$zip" ]; then
  . "$root/scripts/clean-source.sh"
  glaze_require_clean "$root" publish-chrome
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  src=$work/glaze
  glaze_checkout_head "$root" "$src"
  (cd "$src" && DIST="$root/dist" ./package.sh)
  zip="dist/glaze-v$version.zip"
fi
[ -f "$zip" ] || { echo "publish-chrome: no package at $zip" >&2; exit 1; }

token=$(gcloud auth print-access-token --verbosity=error --impersonate-service-account="$account" \
  --scopes=https://www.googleapis.com/auth/chromewebstore)
api="https://chromewebstore.googleapis.com"
path="publishers/$publisher/items/$item"
call() { curl -sS --fail-with-body -H "Authorization: Bearer $token" "$@"; }
field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

echo "Uploading $zip to $item…"
reply=$(call -X POST -H 'Content-Type: application/zip' --data-binary "@$zip" "$api/upload/v2/$path:upload") || { printf '%s\n' "$reply" >&2; exit 1; }
state=$(printf '%s' "$reply" | field uploadState)
# Large or busy uploads finish asynchronously.
while [ "$state" = IN_PROGRESS ] || [ "$state" = UPLOAD_IN_PROGRESS ]; do
  sleep 5
  state=$(call "$api/v2/$path:fetchStatus" | field lastAsyncUploadState)
done
if [ "$state" != SUCCEEDED ]; then
  echo "publish-chrome: upload $state" >&2
  printf '%s\n' "$reply" >&2
  exit 1
fi
echo "Uploaded $(printf '%s' "$reply" | field crxVersion)."

if [ -n "${CWS_NO_PUBLISH:-}" ]; then
  echo "Not submitted (CWS_NO_PUBLISH). Submit from the dashboard or rerun without it."
  exit 0
fi
call -X POST -H 'Content-Type: application/json' -d '{}' "$api/v2/$path:publish"
echo
echo "Submitted for review."
