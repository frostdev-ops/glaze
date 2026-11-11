#!/bin/sh
# Upload the Chrome package to the Web Store and submit it for review (Chrome Web Store API v2).
# gcloud mints a short-lived token by impersonating the publisher's service account: no key file.
# Listing text, screenshots and privacy answers are not in the API; edit those in the dashboard.
#   sh tools/release/publish-chrome.sh [zip]     CWS_NO_PUBLISH=1 uploads without submitting.
# The token goes to curl on its standard input, never as an argument (`ps` shows arguments to every user). An upload the
# store still reports as in progress after CWS_STATUS_TIMEOUT seconds (default 600, ten minutes) stops the script.
# With no zip it packages a fresh checkout of the committed HEAD (as CI does for a tag) and refuses a working tree with
# uncommitted or untracked files, so it packages the same committed sources as the tag build. ZIP timestamps can differ;
# recovery publication must attach these exact local bytes and their matching checksum to the draft GitHub release.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
cd "$root"
publisher=${CWS_PUBLISHER_ID:-82318a69-812d-438a-842f-e87fcaec1bd6} # the dashboard URL after /devconsole/
item=${CWS_EXTENSION_ID:-jmmaeoajomodnbnlmdikjooalmcilooh}
account=${CWS_SERVICE_ACCOUNT:-cws-publisher@frostdev-507119.iam.gserviceaccount.com}
version=$(node -p 'require("./extension/manifest.json").version')
zip=${1:-}
if [ -z "$zip" ]; then
  . "$root/tools/release/clean-source.sh"
  glaze_require_clean "$root" publish-chrome
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  src=$work/glaze
  glaze_checkout_head "$root" "$src"
  (cd "$src" && DIST="$root/dist" tools/build/package.sh)
  zip="dist/glaze-v$version.zip"
fi
[ -f "$zip" ] || { echo "publish-chrome: no package at $zip" >&2; exit 1; }

token=$(gcloud auth print-access-token --verbosity=error --impersonate-service-account="$account" \
  --scopes=https://www.googleapis.com/auth/chromewebstore)
api="https://chromewebstore.googleapis.com"
path="publishers/$publisher/items/$item"
case "$token" in ''|*[!A-Za-z0-9._~+/=-]*) echo "publish-chrome: gcloud gave no usable access token" >&2; exit 1 ;; esac
# printf is a shell builtin and curl reads the header as config from stdin: the token is in no process's arguments.
call() { printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -sS --fail-with-body --config - "$@"; }
field() { python3 -c 'import json,sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"; }

echo "Uploading $zip to ${item}…"
reply=$(call -X POST -H 'Content-Type: application/zip' --data-binary "@$zip" "$api/upload/v2/$path:upload") || { printf '%s\n' "$reply" >&2; exit 1; }
state=$(printf '%s' "$reply" | field uploadState)
# Large or busy uploads finish asynchronously; the store gets CWS_STATUS_TIMEOUT seconds (ten minutes) to finish one.
limit=${CWS_STATUS_TIMEOUT:-600}
deadline=$(( $(date +%s) + limit ))
status_timeout() {
  echo "publish-chrome: the upload is still $state after $limit seconds. Check the item in the Developer Dashboard, then submit it there or run this again." >&2
  exit 1
}
while [ "$state" = IN_PROGRESS ] || [ "$state" = UPLOAD_IN_PROGRESS ]; do
  remaining=$(( deadline - $(date +%s) ))
  [ "$remaining" -gt 0 ] || status_timeout
  pause=5
  [ "$remaining" -ge "$pause" ] || pause=$remaining
  sleep "$pause"
  remaining=$(( deadline - $(date +%s) ))
  [ "$remaining" -gt 0 ] || status_timeout
  poll_timeout=$remaining
  [ "$poll_timeout" -le 120 ] || poll_timeout=120
  status_reply=$(call --max-time "$poll_timeout" "$api/v2/$path:fetchStatus") || {
    [ "$(date +%s)" -lt "$deadline" ] || status_timeout
    printf '%s\n' "$status_reply" >&2
    exit 1
  }
  [ "$(date +%s)" -lt "$deadline" ] || status_timeout
  state=$(printf '%s' "$status_reply" | field lastAsyncUploadState)
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
