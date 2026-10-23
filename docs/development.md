# Development

How Glaze is put together, and how to build, test, package and publish it. See also [Contributing](../CONTRIBUTING.md), [Releasing](../RELEASING.md) and [Firefox for Android testing](firefox-android.md).

## How it works

The content script adds three stylesheets it owns (`theme.css`, `motion.css`, `extras.css`) at page
start, so the popup can switch the theme on and off without a reload. `theme.css` remaps Blackboard's
own `--palette-*` custom properties onto Glaze's `--gz-*` tokens and restyles Ultra's components. Every
setting becomes either a `--gz-*` variable or a `data-gz-*` attribute on `<html>`, which the content
script writes from your saved settings, so the CSS never needs JavaScript to decide anything. A small
DOM sweep tags the long tail — hardcoded light backgrounds, dark text, viewport-fixed bars — with
`data-gz-*` attributes the stylesheets then restyle.

Each LMS loads only what it needs at first paint: the shared `content.js` (with the small libraries it uses)
plus that site's own part, `content-ultra.js` on Blackboard Ultra and `content-canvas.js` on Canvas. Moodle
has no part; it is themed by `content.js` and `moodle.css`. Everything else, from the command palette to the
grade calculators, loads on demand from `features/` the first time a page needs it.

## Building

```sh
./package.sh
```

Writes `dist/glaze-v<version>.zip`, ready for the Chrome Web Store. Requires `node` and `zip`.
From a clean `dev/firefox` checkout, `sh scripts/package-firefox.sh` writes it too, plus `dist/glaze-v<version>-firefox.zip` for Firefox Add-ons. The Firefox compatibility branch must include the intended main release, as [Releasing](../RELEASING.md) describes. Other checkouts require an explicit `--development` argument; that produces a visibly named development build for local checks, not a store upload. Each Firefox ZIP records its source commit and development status in `glaze-build.json`.
For a release, `sh scripts/release.sh` builds everything into `release/<version>/`, from a fresh checkout of the committed `HEAD` (it refuses a dirty working tree); see [RELEASING.md](../RELEASING.md).

```sh
node --test
```

Runs the tests for the colour, settings and page-text logic. Use Node 26, matching CI and the browser's strict compression-stream behavior. No dependencies to install.

The browser checks in `scripts/*-check.js` need Playwright (`NODE_PATH=/path/to/node_modules`, and `npx playwright install chromium` once). They launch Playwright's own Chromium; set `CHROME` to use another executable. `mods-api-check.js`, `mods-sandbox-check.js` and `widgets-builder-check.js` also use macOS's `sandbox-exec` and run only there. The three heaviest checks (`background-shell-check.js`, `background-pages-check.js` and `docreview-check.js`) take a lock directory so only one runs at a time: `glaze-heavy.lock` in the OS temp directory, or `GLAZE_LOCK` if set (`scripts/check-env.js` resolves both).

For motion, run `NODE_PATH=/path/to/node_modules node scripts/motion-check.js [receipt.json]`. It traces every animation on the Ultra, Canvas and Moodle previews at Expressive and fails if an entrance, a card's hover lift or a loading pulse runs on the main thread instead of the compositor (a finished entrance that animates `transform` does that to the hover for the life of the page: entrances use `translate` and `scale`). It also checks that a Glaze dialog stays up while it fades out on closing. Paint-only effects are listed in the receipt but allowed.

For Ultra background clipping, run `NODE_PATH=/path/to/node_modules nice -n 15 node scripts/ultra-panel-background-check.js` with Playwright available. It checks native off-canvas gutters, close-button clicks, scene continuity and scrolled headers at desktop/mobile widths in both text directions, plus partial-width sheet exclusions. Panel course tabs are checked above and below native headers with negative margins, at every strip size, so announcement labels stay exposed. An optional output directory saves screenshots.

`scripts/background-shell-check.js` checks rendered pixels behind the navbar and sidebar across base pages, course tools and item panels, before and after scrolling, at desktop/mobile widths in both text directions. `scripts/background-pages-check.js` runs the unpacked extension and its contour renderer through Ultra's synthetic routes and retained course tabs, then checks cleanup when switching to solid. Both accept an optional evidence directory and hold the shared lock described above; they use local fixtures, not a signed-in LMS. Scene placement (`lib/scene-host.js`) loads only when an animated or mod background needs it.

`scripts/navbar-check.js` checks Glaze's own navigation bar in the editor's Ultra preview: the drawer it stands in for,
the room it keeps, items, badges and the current page, the icons rail's tooltips, peek and keyboard, right-to-left, the
phone bar and its More sheet, and turning it off. Run it with the same `NODE_PATH` setup and an optional screenshots
directory.

`scripts/scene-page-check.js` also aborts the first scene module and renderer dependency requests to
check automatic recovery with fresh module URLs. Run it with the same `NODE_PATH` setup and an
optional evidence directory. It uses a routed synthetic site and a temporary browser profile;
it does not establish live Blackboard behavior.

`scripts/ultra-live-frames-check.js` holds course document requests to check a single automatic
retry, a foreground manual recovery after a hidden tab stalls, and preservation of edited live
frames. It accepts the same `NODE_PATH` setup and an optional evidence directory, and also uses
only routed synthetic sites in a temporary browser profile.

### Publishing to the Chrome Web Store

For one command that submits Chrome, Firefox, Mac and iPhone/iPad releases, pushes the release tag,
publishes the universal notarized DMG on GitHub, and deploys frostdev.io with the signed update feed, use
`node scripts/store-release.mjs release`. Credential setup, build-only mode and resumable submission
are documented in [Releasing Glaze](../RELEASING.md#release-command-and-credentials).

```sh
sh scripts/publish-chrome.sh
```

Packages the extension from a fresh checkout of the committed `HEAD` (it refuses a working tree with uncommitted or untracked files), uploads it with the Chrome Web Store API, and submits it for review. Pass a
zip path to upload a specific build; set `CWS_NO_PUBLISH=1` to upload without submitting. It signs in
as the `cws-publisher` service account through `gcloud` impersonation, so no key file is kept: your
Google account needs the Service Account Token Creator role on it, and the service account must be
added under **Account** in the Developer Dashboard. The listing text, screenshots and privacy answers
aren't in the API; edit those in the dashboard. The publisher and item IDs default to Glaze's; override them with `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID` (the publisher ID is in the dashboard's address, after `/devconsole/`).

## Google Calendar sync

Google Calendar sync is unavailable in the current build while Google verification is pending. Keep the build-time switch in `lib/gcal.js` off until verification and an authorized release enable it. While off, the editor hides connection controls, the worker refuses sync operations, and packages omit the OAuth client and optional identity permission. Calendar export (.ics) remains available.

## Safari

Safari loads Glaze from this Mac app. The Xcode project is in `safari/`; to build the app yourself
you need Xcode and the public key from [Mac update release setup](#mac-update-release-setup):

```sh
sh scripts/build-safari.sh
```

That packages the extension, copies it into a temporary copy of the project, and builds a universal
app in `release/<version>/build/Glaze.app`, signed with the configured Developer ID. Override `SAFARI_SIGN_IDENTITY`
and `SAFARI_TEAM_ID` to use a different identity. Safari only installs apps from outside the App Store
when they are notarized, so pass a saved `notarytool` Keychain profile:

```sh
NOTARY_PROFILE=your-profile sh scripts/build-safari.sh
```

or set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` for an App Store Connect API key. The script
then notarizes the app, staples the ticket, checks Gatekeeper, and writes
`release/<version>/github/glaze-<version>-safari-macos.zip` and a notarized `.dmg`, each with its SHA-256 checksum. Without credentials the zip is
marked `unnotarized` and is for development only.

For the Mac App Store, `scripts/appstore-safari.sh` archives the same project with App Store signing
and uploads the build to App Store Connect. It needs an App Store Connect API key with the Admin role in
`ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID`; Xcode creates the distribution certificate and profiles
on first use. `APPSTORE_EXPORT_ONLY=1` builds the signed package without uploading. Listing text,
screenshots and review submission happen in App Store Connect.

The app bundles only the files the Xcode project lists for its two extension targets (Mac and iOS); a folder
reference brings everything under it. Every build script copies the package into the project's Resources folder
and then runs `node scripts/safari-resources.js` on it, which stops the build if the package has a file the
project doesn't list. Add a new top-level file or folder to both extension targets in Xcode;
`test/safari-resources.test.js` checks the project against everything the package ships.

For direct development in `safari/Glaze/Glaze.xcodeproj`, refresh the checked-in generated resources
with `bash scripts/sync-safari-resources.sh --refresh` after changing extension sources. Both extension
targets check every packaged file before copying resources and stop with that command if the bundle
is stale. The check uses Node, Python 3, zip and unzip; the Xcode phase also searches the usual Homebrew
binary directories. `bash scripts/sync-safari-resources.sh --check` runs the same check without building
or signing an app. Release scripts continue to stage and validate a fresh temporary copy.

`scripts/package-safari.sh` regenerates the Xcode project from scratch and replaces its native edits.
Use it only when you mean to regenerate the project. It doesn't know about the iPhone and iPad targets below.

### Mac update release setup

The Developer ID build stages Sparkle 2.10.0 in a temporary Mac project through
`scripts/stage-safari-dmg.py`; the checked-in App Store project stays free of Sparkle.
Glaze's signing key was made once with the [Sparkle distribution's key generator](https://sparkle-project.org/documentation/#eddsa-ed25519-signatures)
(`bin/generate_keys`), which keeps the private key in the login Keychain (account `ed25519`) of the Mac
that made it. Back it up with `generate_keys -x <file>` and keep that file somewhere safe: without it,
no update can be signed for apps already installed. `scripts/build-safari.sh` passes the public key
(`0lbeC9MO1QDsjSGjs6iyxSBwXKMpEiKVoB+5wZwQEqY=`, or `SAFARI_UPDATE_PUBLIC_KEY` if set) into
`SUPublicEDKey` in the staged Mac app's `Glaze/Info.plist`. Staging on its own without a key leaves
updates disabled; a release build rejects the `REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY` placeholder.

After building and notarizing a release, generate its signed update entry locally (replace
`<version>` with the manifest version):

```sh
sh scripts/safari-appcast.sh "release/<version>/github/glaze-<version>-safari-macos.dmg" /path/to/Sparkle/bin
```

The helper verifies the notarized DMG and app, checks that the Keychain signing key matches the
app's public key, and writes `release/appcast.xml`, preserving older entries. It does not publish
anything. Upload the DMG to its GitHub release before publishing that feed at
`https://frostdev.io/projects/glaze/appcast.xml` (the frostdev.io path is `/projects/glaze/appcast.xml`).
Use the same Sparkle Keychain account for key generation and appcast signing; if you choose a
custom account, set `SAFARI_UPDATE_KEY_ACCOUNT` to it when running the helper.

The containing app's **Updates** controls use Sparkle's persisted `automaticallyChecksForUpdates`
and `automaticallyDownloadsUpdates` settings. Explicit **Check for Updates…** uses Sparkle's user
initiated check, including its progress and installation approval UI. Quiet native checks honor the
automatic-check setting. Update controls are compiled into the Developer ID app only; the shared
guide shows the App Store link in store builds. The guide's message bridge accepts only its bundled
main-frame page, and status checks stop when the app is inactive or the guide goes away.

### iPhone and iPad

The iOS app is two more targets in the same Xcode project (`Glaze iOS` and `Glaze iOS Extension`), sharing
the extension's resources and native handler with the Mac targets. `scripts/appstore-ios.sh` archives it
with App Store signing into `release/<version>/build/Glaze-iOS.xcarchive` and `release/<version>/app-store/glaze-<version>-ios.ipa`. It uses
the App Store profiles already on the Mac; set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` to let Xcode
create them. It never uploads unless `APPSTORE_UPLOAD=1` is set. To try it in the Simulator, run the
`Glaze iOS` scheme in Xcode.

## Bundled libraries

Glaze is MIT licensed ([LICENSE](../LICENSE)). Bundled with it, each under its own license beside it: three.js (MIT, `lib/three.LICENSE`), lottie-web's light canvas player (MIT, `lib/lottie/LICENSE`), pdf.js and its JBIG2 and JPEG 2000 decoders (Apache-2.0 and BSD, `lib/pdfjs/`), and the Tesseract OCR engine and its tessdata_fast models (Apache-2.0, `lib/tesseract/`), each rebuilt by its `scripts/vendor-*.sh`. The scripts check what they download against pinned hashes; `vendor-three.sh`, which uses npm, installs with install scripts off and checks the installed packages against pinned integrity values (`scripts/npm-integrity.js`).
