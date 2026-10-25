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

## Activity Stream

Blackboard's Stream notification settings contain a Glaze section, also available at
Settings → Course pages → Blackboard Dashboard → More options → Activity Stream. Timeline dates default to due dates for deadline
notifications and posted dates for other updates. Choose posted dates or both, relative due
dates, compact cards, and whether encouragement appears. The exact deadline and time zone
remain available on the date's accessible label and hover title. Relative dates fall back to
calendar dates if Blackboard's zone differs from the browser's. These controls save Glaze
preferences immediately; Blackboard's notification delivery settings are unchanged.

The feature loads only on `/ultra/stream` routes. It reads the rendered deadline metadata,
keeps Blackboard's original timestamp nodes, and restores the native display when disabled.
The settings section also selects an Activity Stream preview. `node --test test/stream.test.js`
checks the date policy; `scripts/stream-check.js` checks automatic redraws, delayed saves,
form isolation, accessible dates, narrow layouts and teardown. `scripts/stream-runtime-check.js`
loads the real unpacked extension on a synthetic Ultra page and checks the worker allowlist,
closed-root keyboard focus, storage notifications and all four editor preview controls.
Both browser checks accept an optional evidence directory and use the shared browser lock.

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

CI's browser gate (`.github/workflows/browser.yml`) runs on every push and pull request and before a release zip is built: `scripts/ci-browser-checks.js` runs the settings, popup, sites and pointer checks in the Playwright, Chromium and FFmpeg pinned in `ci/`, and keeps their logs and screenshots as the `browser-evidence` artifact when one fails. Release tags run it through packaging only. The runner verifies binaries again before any check, rejects `CHROME`, `EXT` and `IA_CASE` overrides, allows six minutes for settings and two for each other check within an eleven-minute total budget, and awaits detached browser cleanup before releasing the lock. Firefox and Safari are checked separately before a release. Firefox: `FIREFOX=<Firefox.app> nice node scripts/firefox-check.mjs` runs the package in native Firefox. Safari: `bash scripts/sync-safari-resources.sh --check` proves packaged-resource parity only, that both targets bundle the package's files; native runtime needs the built app run in Safari on Mac and iOS.

For motion, run `NODE_PATH=/path/to/node_modules node scripts/motion-check.js [receipt.json]`. It traces every animation on the Ultra, Canvas and Moodle previews at Expressive and fails if an entrance, a card's hover lift or a loading pulse runs on the main thread instead of the compositor (a finished entrance that animates `transform` does that to the hover for the life of the page: entrances use `translate` and `scale`). It also checks that a Glaze dialog stays up while it fades out on closing. Paint-only effects are listed in the receipt but allowed.
The check explicitly exercises positioned panel/tooltip and Look entrances and Moodle's loading pulse, requires their trace records, and retains failures even if a later sample recovers. It also checks final placement and instant dialogs with motion Off or transitions disabled. This Chromium check does not establish native Firefox or Safari behavior.
Glaze's own UI uses the lazy `lib/motion.js`: local layout changes happen synchronously, then FLIP/exit motion follows. A native palette/sidebar crossfade may defer its update one frame for the old snapshot; consecutive swaps flush pending updates in order, and aborted/stalled captures still apply them once. Crossfades require recent activation on this page (where that signal exists), and are skipped in frames, hidden pages, with transitions off, or during another view transition. Unsolicited settings changes stay immediately clickable. Ghosts are inert and have no identifying attributes or roles; hidden/disconnected targets and interrupted moves release their animations.

For Ultra background clipping, run `NODE_PATH=/path/to/node_modules nice -n 15 node scripts/ultra-panel-background-check.js` with Playwright available. It checks native off-canvas gutters, close-button clicks, scene continuity and scrolled headers at desktop/mobile widths in both text directions, plus partial-width sheet exclusions. Panel course tabs are checked above and below native headers with negative margins, at every strip size, so announcement labels stay exposed. An optional output directory saves screenshots.

`scripts/background-shell-check.js` checks rendered pixels behind the navbar and sidebar across base pages, course tools and item panels, before and after scrolling, at desktop/mobile widths in both text directions. `scripts/background-pages-check.js` runs the unpacked extension and its contour renderer through Ultra's synthetic routes and retained course tabs, then checks cleanup when switching to solid. Both accept an optional evidence directory and hold the shared lock described above; they use local fixtures, not a signed-in LMS. Scene placement (`lib/scene-host.js`) loads only when an animated or mod background needs it.

`scripts/ctab-background-check.js` opens a course tab over an animated background and checks that the frame draws none of its own: inside the frame's box the page's background shows unchanged, and the page's own tab strip doesn't show through. `EXT=<checkout>` runs it against other code.

`scripts/ctab-strip-glass-check.js` checks computed strip, course-header and Announcements-pill styles across every built-in Look, placements, phone width, RTL and forced colors. Its header includes Ultra's hashed class; its frame has no base page or native nav. It also tests the scroll backing with the timeline support block disabled: older engines keep a static backing, while supporting engines fade it in over 48px. Run with `NODE_PATH=/path/to/node_modules nice node scripts/ctab-strip-glass-check.js /path/to/evidence`, holding the shared browser lock externally. It uses a temporary headless profile, accepts `EXT=<checkout>`, and writes screenshots and `results.json`; it does not verify a signed-in LMS or Safari.

`scripts/glass-remaining-check.js` checks tool and routed headers, Gradebook, routed discussions, announcement glass/search, over-course item headers and Canvas breadcrumbs. Run it like the strip check, with an evidence directory; optional scenario names and `--looks=Library,Clear` narrow it. `W=375 H=812`, `RTL=1`, `FORCED=1`, and `COLLAPSED=1` exercise narrow, mirrored, forced-color and collapsed states. Fixture changes stay inside the check. The strip check removes its synthetic base page before waiting for frame transparency: a frame over a base page intentionally paints its own aligned background. These are headless fixture checks, not live LMS or Safari verification.

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
app, signed with the configured Developer ID, into `release/<version>/github/` as a zip (and a disk image when
notarized). Override `SAFARI_SIGN_IDENTITY` and `SAFARI_TEAM_ID` to use a different identity. Safari only installs
apps from outside the App Store when they are notarized, so pass a saved `notarytool` Keychain profile:

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
