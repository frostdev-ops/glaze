# Firefox for Android testing

The local environment uses Android 16 (API 36), an ARM64 Pixel 7 AOSP emulator,
Firefox 158.0 from Mozilla's archive, and web-ext 10.8.0. It loads the existing
Firefox release ZIP, rather than rebuilding the working tree.

```sh
sh scripts/firefox-android.sh check
sh scripts/firefox-android.sh
# Ctrl+C ends web-ext's temporary-extension session.
sh scripts/firefox-android.sh stop
```

The emulator is `GlazeAndroid16`, on `emulator-5580`, with two CPU cores and
2.5 GB of RAM (Android 16's minimum here). Its private data, browser APK and web-ext installation are in
`release/<version>/firefox/android/`. The SDK is in `~/Library/Android/sdk`.
The launcher refuses to use or stop another virtual device on that port.
It does not target a USB-connected phone or change the submitted ZIP.

On first use, complete Firefox's welcome screens, skip account sign-in, then
enable **Settings > Advanced > Remote debugging via USB** on the emulator.
Open a normal browser tab before loading Glaze.
This debugging setting is only needed on the dedicated test device. Firefox
loads temporary extensions into its normal Android profile; that profile is
isolated here by the dedicated emulator. Accept the local debugging connection
when Firefox asks, then rerun the launcher if its first attempt timed out.
Find Glaze through Firefox's Extensions menu and open its settings.

The prepared emulator already has Firefox's documented
`pref_key_remote_debugging` preference enabled. Its original preferences were
backed up before that single setting was changed. No phone or desktop browser
profile was configured. The emulator uses software graphics on this Mac; its
timings are not a physical-phone performance benchmark.

## One-time installation

The setup performed on this Mac uses Homebrew's `android-commandlinetools` and
`android-platform-tools`, and its existing OpenJDK 25. The SDK installer requires
accepting Google's Android SDK license before downloading the system image.

```sh
brew install --cask android-commandlinetools android-platform-tools
# Use an installed JDK. On this Mac:
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk" ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
sdkmanager --sdk_root="$HOME/Library/Android/sdk" \
  'cmdline-tools;latest' platform-tools emulator 'system-images;android-36;default;arm64-v8a'

version=$(node -p 'require("./manifest.json").version')
state="$PWD/release/$version/firefox/android"
mkdir -p "$state/avd" "$state/extension"
ANDROID_AVD_HOME="$state/avd" "$ANDROID_HOME/cmdline-tools/latest/bin/avdmanager" create avd --name GlazeAndroid16 \
  --device pixel_7 --package 'system-images;android-36;default;arm64-v8a' \
  --path "$state/avd/GlazeAndroid16.avd"
npm install --prefix "$state/tools" --save-exact web-ext@10.8.0
curl -fL -o "$state/firefox-158.0-arm64.apk" \
  https://archive.mozilla.org/pub/fenix/releases/158.0/android/fenix-158.0-android-arm64-v8a/fenix-158.0.multi.android-arm64-v8a.apk
unzip -q "release/$version/firefox/glaze-v$version-firefox.zip" -d "$state/extension"
```

## Validation

Installing Glaze is a smoke check, not Android compatibility acceptance. Check:

- Settings, popup and preview fit portrait and landscape; controls work by touch.
- A Look applies, settings persist after Firefox restarts, and disabling Glaze
  restores the page.
- Blackboard Ultra, Canvas and Moodle on real supported pages: site detection,
  colors, course cards, navigation and the relevant extras.
- Better To Do, typing backup, notes, and course tabs, including Android's Back
  button, backgrounding the browser and returning to it.
- File import/export and downloads, keyboard appearance, text zoom, reduced
  motion, dark/light appearance and an interrupted network connection.

The existing local Canvas server is reachable from the emulator as
`http://10.0.2.2:3000`. The release manifest targets HTTPS LMS sites, so this HTTP
server is not a release-package content-script test without a separately labeled
development manifest. Do not report a patched localhost build as the release.

Save evidence in `release/<version>/validation/firefox-android/`. Initial lint
of the unmodified 3.0.1 ZIP has zero errors and 20 warnings. One Android warning
says its minimum version 140 predates data-collection manifest support in 142.
The other warnings require their own review; lint success does not prove runtime
compatibility. Do not change the published Android compatibility range until
runtime validation is complete. Physical-device testing remains a separate gate.
The setup smoke check installed `glaze@frostdev.io` successfully in Firefox 158.0
on this emulator, with no runtime manifest warnings. Its event-page background
was stopped when inspected; this is not evidence that every feature ran. See
`setup.json` in the evidence folder for the exact package hash and observations.

References: [Mozilla's Android extension workflow](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/),
[Android emulator commands](https://developer.android.com/studio/run/emulator-commandline),
[SDK Manager](https://developer.android.com/tools/sdkmanager).
