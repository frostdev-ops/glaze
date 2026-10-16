#!/usr/bin/env bash
# Run the release ZIP on the dedicated Android emulator; never use a connected personal device.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
version=$(node -p 'require("./manifest.json").version')
state="$root/release/$version/firefox/android"
sdk="${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}"
emulator="$sdk/emulator/emulator"
webext="$state/tools/node_modules/.bin/web-ext"
avd=GlazeAndroid16
serial=emulator-5580
export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk" ANDROID_AVD_HOME="$state/avd"

die() { echo "$*" >&2; exit 1; }
owned_device() {
  local name
  name=$(adb -s "$serial" emu avd name 2>/dev/null | tr -d '\r' | head -1)
  [ "$name" = "$avd" ] || die "$serial is not $avd; leaving it alone."
}

case "${1:-run}" in
  check)
    command -v adb >/dev/null || die 'Missing adb; see docs/firefox-android.md.'
    [ -x "$emulator" ] && [ -x "$webext" ] || die 'Setup is incomplete; see docs/firefox-android.md.'
    "$emulator" -accel-check
    "$emulator" -list-avds
    adb devices -l
    "$webext" lint --no-config-discovery --source-dir "$state/extension"
    exit
    ;;
  stop)
    command -v adb >/dev/null || die 'adb is not installed.'
    if adb -s "$serial" get-state >/dev/null 2>&1; then
      owned_device
      adb -s "$serial" emu kill
    fi
    exit
    ;;
  run) ;;
  *) die 'Usage: sh scripts/firefox-android.sh [run|check|stop]' ;;
esac

command -v adb >/dev/null || die 'Missing adb; see docs/firefox-android.md.'
[ -x "$emulator" ] && [ -x "$webext" ] || die 'Setup is incomplete; see docs/firefox-android.md.'
[ -f "$ANDROID_AVD_HOME/$avd.ini" ] || die "Missing $avd; see docs/firefox-android.md."
zip="$root/release/$version/firefox/glaze-v$version-firefox.zip"
[ -f "$zip" ] || die "Missing release package: $zip"

emulator_pid=
if ! adb -s "$serial" get-state >/dev/null 2>&1; then
  nohup nice -n 10 "$emulator" -avd "$avd" -port 5580 -cores 2 -memory 2560 \
    -no-metrics -no-audio -no-boot-anim -camera-back none -camera-front none \
    > "$state/emulator.log" 2>&1 < /dev/null &
  emulator_pid=$!
fi
ready=false
for attempt in {1..120}; do
  if [ -n "$emulator_pid" ] && ! kill -0 "$emulator_pid" 2>/dev/null; then
    die "Emulator exited before boot; see $state/emulator.log."
  fi
  if [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
    ready=true
    break
  fi
  sleep 1
done
[ "$ready" = true ] || die "Emulator did not boot in 120 seconds; see $state/emulator.log."
owned_device
if ! adb -s "$serial" shell pm path org.mozilla.firefox | tr -d '\r' | grep -q '^package:'; then
  adb -s "$serial" install "$state/firefox-158.0-arm64.apk"
fi

source_dir=$(mktemp -d "$state/run.XXXXXX")
trap 'rm -rf "$source_dir"' EXIT
unzip -q "$zip" -d "$source_dir"
echo "Testing the release ZIP: $zip"
echo 'Enable Firefox Settings > Advanced > Remote debugging via USB on this emulator if prompted.'
echo 'Ctrl+C ends the extension session. Run this script with stop to close the emulator.'
"$webext" run --no-config-discovery --target firefox-android --adb-device "$serial" \
  --firefox-apk org.mozilla.firefox --source-dir "$source_dir" --no-reload --no-input \
  --adb-discovery-timeout 20000
