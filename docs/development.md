# Development

How Glaze is put together, and how to build, test, package and publish it. See also [Contributing](../CONTRIBUTING.md) and [Firefox for Android testing](firefox-android.md).

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
grade calculators, loads on demand from its area's `page/` folder the first time a page needs it.

Pearson MyLab homework uses a separate appearance adapter, `content/pearson.js` and `content/pearson.css`.
Pearson's hosts are a grant, not manifest hosts: an update that adds a host warning makes Chrome disable Glaze until the
student accepts it. The three `enhance.pearson*` switches start off; turning one on asks for `GZ_PEARSON_EMBED_LIB.hosts`,
and the worker registers `gz-pearson` and `gz-pearson-launch` (background.js `PEARSON`) while one is on and all three are
held. The last one off hands them back. `enhance.pearsonEmbed` opens its native LTI launch inside Blackboard. The routed
`courses/page/pearson-embed.js` module owns sizing and controls, while `pearson/launch.js` checks the exact socket
opener and asks the worker for a document-pinned MAIN-world `pearson/launch-main.js` hook. It prepares a named child
frame before invoking the original Open Pearson click handler, changing only the launch destination. Authentication
callbacks and native launch models stay inside Pearson. The worker validates the current approved Ultra tab and
returns its origin for the parent handshake; Pearson redirects can leave an interop referrer.
`pearson/embedded.js` forwards a bounded, URL-free list of resolved appearance variables through the verified frame
chain, including the current course Look, while transparent native documents share Blackboard's existing background.
Native question frames keep their MyLab `Service/PlayerLaunch.ashx` source after redirecting; the bridge recognizes
that exact route as a tdx destination and still checks the sending frame and final origin. Only the top-level page
owns a background renderer. Embedded MyLab and tdx documents never start one, including before their context arrives;
standalone MyLab keeps one renderer in its top-level shell, visible through transparent child canvases.
Only the canonical homework URL and selected question ordinal travel back for Open in tab; other query parameters
are dropped. During authentication, pop-out rebuilds a fresh same-course Blackboard LTI launch, never a consumed
Pearson callback. Close invokes Blackboard's original Exit. Turning the switch off affects later launches and keeps
an existing session mounted so unsent work survives. No frame/security headers or cookie settings are changed.
`checks/pearson/embed-check.js` uses invented native launcher and homework fixtures; cold sign-in, grading submission
and native Safari/Firefox require separate live validation.
The manifest matches MyLab's homework player/overview and the assignment/player frames on
`tdx.acs.pearson.com`. The latter activate only when Pearson marks the viewer `playmode-homework`.
Each frame reads the saved Look's palette, typography, surfaces, depth, navigation styling, pointer and motion
settings, and follows automatic light/dark changes. The question player and overview reuse the existing Look
background renderer (`preview.html?site=canvas&backdrop&saved`), including scenes, shaders, layers and kept media.
That frame reads appearance keys itself and rejects settings messages from its Pearson parent.
The overview keeps Pearson's tables, question links and action handlers, with CSS for the assignment title,
detail cards, summary strip and responsive question grid. A question tile expands its original anchor's hit area;
the adapter does not copy or calculate any score or status. Hidden native actions and reminders stay hidden.
The problem viewer lays out the original prompt and answer nodes as one worksheet, with a collapsible question
list. Its page switch restores Pearson's layout; the persistent switch is under Course pages → Documents and quizzes.
Glaze off restores native appearance and removes the renderer, controls and icon filters. Diagrams and native answer
handling stay with Pearson. Common symbol templates use scalable Glaze artwork on the original buttons;
unrecognized controls retain Pearson's artwork. Names and shortcuts come from native button metadata. The question list
owns its scroll area even when Dijit writes a zero-pixel inner height. Shared motion knobs and saved Look animations
drive problem, panel and symbol transitions, with reduced motion and the entrance switch honored. Background frames
stay hidden over the palette fallback until their own renderer confirms its first theme paint.
The optional modern-math setting loads the packaged, readable MathLive 0.111.4 runtime on demand. `pearson/adapter.js`
renders exact LaTeX exported by the native label widget, preserving its original accessible label and DOM. A bounded
sanitizer rejects active markup and leaves unsupported expressions native. `pearson-math.html` is an extension-owned
composer with a source/origin-checked MessagePort, the saved palette, surfaces, text fonts, scale and motion preferences.
Opening, editing and preparing an expression do not modify the answer. Use equation explicitly applies it through
`background/pearson.js`, pinned to the requesting player document. `pearson/native.js` parses into a detached native
editor, while the frame compares mathematical structure before enabling transfer. Infinity imports use Pearson's
native `&inf;` token and must survive native reparsing; its grouped `{\infty_}` export is normalized for MathLive
without changing genuine subscripts. Apply retains native undo and emits
the native change event once; changed answers, replaced widgets, unsupported constructs and test mode are refused.
Glaze does not persist math values, send them to a service, or invoke Check answer, Save or submission actions;
Pearson continues its normal native handling of the explicit edit.
The runtime, math fonts and license are reproducible with `tools/vendor/vendor-mathlive.sh`; optional appearance fonts
use the existing font loader. The synthetic `checks/pearson/math-check.js` exercises the unpacked extension and invented
native API fixtures; real parser interoperability was probed separately in detached editors in the owner's Chrome.
The synthetic
`checks/pearson/homework-check.js` exercises the unpacked extension across the nested frames;
it does not establish support for Pearson tests, other products, or native Safari runtime.

## Activity Stream

Blackboard's Stream notification settings contain a Glaze section, also available at
Settings → Course pages → Blackboard Dashboard → More options → Activity Stream. Timeline dates default to due dates for deadline
notifications and posted dates for other updates. Choose posted dates or both, relative due
dates, compact cards, whether encouragement appears, and Submission status (on by default): each card that
names an assignment the planner holds gets its status chip, matched by course and title
(`GZ_STREAM.find`) and drawn by `courses/page/cardtasks.js` from the card tasks' planner answer
(`checks/courses/stream-status-check.js`). The exact deadline and time zone
remain available on the date's accessible label and hover title. Relative dates fall back to
calendar dates if Blackboard's zone differs from the browser's. These controls save Glaze
preferences immediately; Blackboard's notification delivery settings are unchanged.

The feature loads only on `/ultra/stream` routes. It reads the rendered deadline metadata,
keeps Blackboard's original timestamp nodes, and restores the native display when disabled.
The settings section also selects an Activity Stream preview. `node --test test/courses/stream.test.js`
checks the date policy; `checks/courses/stream-check.js` checks automatic redraws, delayed saves,
form isolation, accessible dates, narrow layouts and teardown. `checks/courses/stream-runtime-check.js`
loads the real unpacked extension on a synthetic Ultra page and checks the worker allowlist,
closed-root keyboard focus, storage notifications and all four editor preview controls.
Both browser checks accept an optional evidence directory and use the shared browser lock.

## Building

```sh
tools/build/package.sh
```

Writes `dist/glaze-v<version>.zip`, ready for the Chrome Web Store. Requires `node` and `zip`. It, `package-firefox.sh` and the App Store scripts refuse a working tree with edits or untracked files, because a release is built from a commit; `--allow-dirty` packages the tree as it stands for local work (`package-firefox.sh` takes `--development` for that).
From a clean `dev/firefox` checkout, `sh tools/build/package-firefox.sh` writes it too, plus `dist/glaze-v<version>-firefox.zip` for Firefox Add-ons. The Firefox compatibility branch must include the intended main release. Other checkouts require an explicit `--development` argument; that produces a visibly named development build for local checks, not a store upload. Each Firefox ZIP records its source commit and development status in `glaze-build.json`.
For a release, `sh tools/release/release.sh` builds everything into `release/<version>/`, from a fresh checkout of the committed `HEAD` (it refuses a dirty working tree).

```sh
node --test
```

Runs the tests for the colour, settings and page-text logic. Use Node 26, matching CI and the browser's strict compression-stream behavior. No dependencies to install.

The browser checks in `checks/*/*-check.js` need Playwright (`NODE_PATH=/path/to/node_modules`, and `npx playwright install chromium` once). They launch Playwright's own Chromium; set `CHROME` to use another executable. `mods-api-check.js`, `mods-sandbox-check.js` and `widgets-builder-check.js` also use macOS's `sandbox-exec` and run only there. The three heaviest checks (`background-shell-check.js`, `background-pages-check.js` and `docreview-check.js`) take a lock directory so only one runs at a time: `glaze-heavy.lock` in the OS temp directory, or `GLAZE_LOCK` if set (`tools/dev/check-env.js` resolves both).

### The suite on the Mac, and the sweep

A bare `node --test` in a working copy also runs test files in ignored folders (`release/<version>/…/website/server/*.test.mjs` fail there), which a clean checkout never has. When the runner is down, `nice -n 19 taskpolicy -b node tools/dev/suite.js` runs the files a clean checkout would: `git ls-files -co --exclude-standard` (tracked, and new but not ignored) filtered by Node 26's default test patterns, from the repo root. Arguments go to `node --test` (`--test-name-pattern=drive`). `.gitignore`'s `release/` also matches `test/release/`: a new test there runs only after `git add -f`.

`checks/checks.json` has one entry for each check file (`<area>/*-check.{js,mjs,py}`, `firefox/*`, `safari/*`): `needs`, `limit` (seconds; first guesses, not measured), `args` and `env` (`{out}` is the evidence folder), and a note. `test/release/all-checks.test.js` fails when a check file has no entry. `needs` says where a check can run:

- `runner`: plain Chromium, in the Linux runner's container (it also runs on the Mac). `mac`: only on the Mac (sandbox-exec, Safari, native Firefox). `canvas`, `moodle`: the local LMS on the Mac.
- `linux` and `headed` (Xvfb): the runner only. `network`: the real internet. `safari`: drives the owner's Safari, so only with the owner's OK. `inputs`: files or a revision that aren't in the repo. `gpu`: a real adapter. `unknown`: couldn't be told by reading, with a `why`.

`node tools/dev/all-checks.js --where runner|mac` runs each check that can run there once, no retries. On the runner each goes through `glaze-remote -o <evidence>/<name> -e TZ=UTC -t <limit> -- node checks/<script> /out`, `--jobs` at once (default 1: the runner is a person's own computer, so more at once needs their say), started a second and a half apart; exit 255 from `glaze-remote` means the runner failed, so it is recorded as `runner-failed`, never as a failing check, and nothing more is dispatched. On the Mac they run one at a time under `nice -n 10 lockf -k <heavy lock>` with `NODE_PATH` and `TZ=UTC`; it won't start without `--lock <the lock file every heavy job takes>` and `--node-path <Playwright's node_modules>` (or `GLAZE_HEAVY_LOCK` and `NODE_PATH`). A check whose `needs` aren't allowed is skipped and says which: `--needs canvas,moodle` allows those (local LMS up), `--only writer,ai/ask-check.js` picks areas or checks, `--dry-run` prints every command and skip.

`<evidence>/summary.md` has a row per check: `pass`, `fail`, `timed out` (the limit; the client waits `--grace` more, 10 minutes, for the queue), `runner-failed` (exit 255, or not dispatched after one), `skipped: needs …`, with the last 25 lines of each failing check below the table. `<name>.log` is a check's whole output and `<name>/` its evidence. `--known <file>` (a check's name or `<area>/<name>-check.js` per line, `#` comments) shows a known failure as `fail (known)`, an unlisted one as `FAIL (new)`, and a listed one that passes as `pass (was known failing)`. The exit status is 1 for a new failure or time-out, 2 for an incomplete sweep (the runner failed), else 0.

`checks/settings/settings-wiring-check.js [report.json]` exercises every generic settings control through its input/change handlers,
real sync storage, sanitization and reopened controls. It validates all offered choices and slider endpoints, respects the
storage write quota, and checks Blackboard's card preview after edits and reset. `WIRING_CASE=cards` runs that regression
alone. The check uses a disposable profile and blocks external requests. Gradescope's permission grant and custom editors
remain covered by their dedicated tests; this sweep complements the layout checks and feature runtime tests, and does not
establish signed-in LMS or native Safari behavior.

CI's browser gate (`.github/workflows/browser.yml`) runs on every push to `main` and `dev/firefox`, every pull request (a branch with a pull request runs once, there), and before a release zip is built; `workflow_dispatch` runs it on any branch by hand: `tools/dev/ci-browser-checks.js` runs the settings, popup, sites and pointer checks in the Playwright, Chromium and FFmpeg pinned in `.github/pins/`, and keeps their logs and screenshots as the `browser-evidence` artifact when one fails. Release tags run it through packaging only. The runner verifies binaries again before any check, rejects `CHROME`, `EXT` and `IA_CASE` overrides, allows six minutes for settings and two for each other check within an eleven-minute total budget, and awaits detached browser cleanup before releasing the lock. Firefox and Safari are checked separately before a release. Firefox: `FIREFOX=<Firefox.app> nice node checks/firefox/firefox-check.mjs` runs the package in native Firefox. Safari: `bash tools/build/sync-safari-resources.sh --check` proves packaged-resource parity only, that both targets bundle the package's files; native runtime needs the built app run in Safari on Mac and iOS.

`NODE_PATH=/path/to/node_modules node checks/courses/announce-read-check.js /path/to/evidence` checks Ultra announcement read
controls against synthetic native markup. It covers scroll/focus recovery after first-page resets, bulk reading across
pages, failed updates, cancellation, and narrow/RTL layouts. It takes the shared browser lock, writes screenshots and
results, and closes its browser. This does not establish signed-in LMS or native Safari behavior.

For motion, run `NODE_PATH=/path/to/node_modules node checks/looks/motion-check.js [receipt.json]`. It traces every animation on the Ultra, Canvas and Moodle previews at Expressive and fails if an entrance, a card's hover lift or a loading pulse runs on the main thread instead of the compositor (a finished entrance that animates `transform` does that to the hover for the life of the page: entrances use `translate` and `scale`). It also checks that a Glaze dialog stays up while it fades out on closing. Paint-only effects are listed in the receipt but allowed.
The check explicitly exercises positioned panel/tooltip and Look entrances and Moodle's loading pulse, requires their trace records, and retains failures even if a later sample recovers. It also checks final placement and instant dialogs with motion Off or transitions disabled. This Chromium check does not establish native Firefox or Safari behavior.
Glaze's own UI uses the lazy `core/motion.js`: local layout changes happen synchronously, then FLIP/exit motion follows. A native palette/sidebar crossfade may defer its update one frame for the old snapshot; consecutive swaps flush pending updates in order, and aborted/stalled captures still apply them once. Crossfades require recent activation on this page (where that signal exists), and are skipped in frames, hidden pages, with transitions off, or during another view transition. Unsolicited settings changes stay immediately clickable. Ghosts are inert and have no identifying attributes or roles; hidden/disconnected targets and interrupted moves release their animations.

For Ultra background clipping, run `NODE_PATH=/path/to/node_modules nice -n 15 node checks/navigation/ultra-panel-background-check.js` with Playwright available. It checks native off-canvas gutters, close-button clicks, scene continuity and scrolled headers at desktop/mobile widths in both text directions, plus partial-width sheet exclusions. Panel course tabs are checked above and below native headers with negative margins, at every strip size, so announcement labels stay exposed. An optional output directory saves screenshots.

`checks/platform/background-shell-check.js` checks rendered pixels behind the navbar and sidebar across base pages, course tools and item panels, before and after scrolling, at desktop/mobile widths in both text directions. `checks/platform/background-pages-check.js` runs the unpacked extension and its contour renderer through Ultra's synthetic routes and retained course tabs, then checks cleanup when switching to solid. Both accept an optional evidence directory and hold the shared lock described above; they use local fixtures, not a signed-in LMS. Scene placement (`looks/scene-host.js`) loads only when an animated or mod background needs it.

`checks/navigation/ctab-background-check.js` opens a course tab over an animated background and checks that the frame draws none of its own: inside the frame's box the page's background shows unchanged, and the page's own tab strip doesn't show through. `EXT=<checkout>/extension` runs it against other code.

`checks/navigation/ctab-strip-glass-check.js` checks computed strip, course-header and Announcements-pill styles across every built-in Look, placements, phone width, RTL and forced colors. Its header includes Ultra's hashed class; its frame has no base page or native nav. It also tests the scroll backing with the timeline support block disabled: older engines keep a static backing, while supporting engines fade it in over 48px. Run with `NODE_PATH=/path/to/node_modules nice node checks/navigation/ctab-strip-glass-check.js /path/to/evidence`, holding the shared browser lock externally. It uses a temporary headless profile, accepts `EXT=<checkout>/extension`, and writes screenshots and `results.json`; it does not verify a signed-in LMS or Safari.

`checks/looks/glass-remaining-check.js` checks tool and routed headers, Gradebook, routed discussions, announcement glass/search, over-course item headers and Canvas breadcrumbs. Run it like the strip check, with an evidence directory; optional scenario names and `--looks=Library,Clear` narrow it. `W=375 H=812`, `RTL=1`, `FORCED=1`, and `COLLAPSED=1` exercise narrow, mirrored, forced-color and collapsed states. Fixture changes stay inside the check. The strip check removes its synthetic base page before waiting for frame transparency: a frame over a base page intentionally paints its own aligned background. These are headless fixture checks, not live LMS or Safari verification.

`checks/navigation/navbar-check.js` checks Glaze's own navigation bar in the editor's Ultra preview: the drawer it stands in for,
the room it keeps, items, badges and the current page, the icons rail's tooltips, peek and keyboard, right-to-left, the
phone bar and its More sheet, and turning it off. Run it with the same `NODE_PATH` setup and an optional screenshots
directory.

`checks/looks/scene-page-check.js` also aborts the first scene module and renderer dependency requests to
check automatic recovery with fresh module URLs. Run it with the same `NODE_PATH` setup and an
optional evidence directory. It uses a routed synthetic site and a temporary browser profile;
it does not establish live Blackboard behavior.

`checks/courses/ultra-live-frames-check.js` holds course document requests to check a single automatic
retry, a foreground manual recovery after a hidden tab stalls, and preservation of edited live
frames. It accepts the same `NODE_PATH` setup and an optional evidence directory, and also uses
only routed synthetic sites in a temporary browser profile.

## Google Calendar sync

Google Calendar sync is on in Chrome builds since 4.0.1 (the build-time switch `ON` in `planner/gcal.js`). The Chrome package keeps the manifest's `oauth2` client (`calendar.app.created` scope) and the optional `identity` permission; with Drive enabled, the same client also carries `drive.file`, `openid` and `email`. Firefox leaves out `oauth2` but holds `identity` from install for Drive's web sign-in; Safari leaves both out. With the Calendar switch off, Settings hides its section, the worker refuses Calendar operations and `package.sh` removes Calendar's scope, keeping the client and permission while Drive needs them. `test/planner/gcal.test.js` runs Calendar against a local mock of Google's API (`checks/mocks/gcal-mock.js`); `test/planner/gcal-package.test.js` checks the packaged manifest and development copy.

The OAuth client belongs to the Chrome Web Store item, so `getAuthToken` works only in a copy with the store's ID. An unpacked checkout has its own ID; for a copy with the store's, save the item's public key (Developer Dashboard → the item → Package → View public key, the base64 between the BEGIN and END lines, on one line) to a file outside the repo and run:

```sh
tools/dev/dev-gcal.sh <key file>
```

Then load `dist/glaze-dev-gcal` unpacked, in a Chrome profile without the store's Glaze. The key never goes in `manifest.json` or the package.

This applies to Google Drive too: the source checkout's extension ID is not registered with either Google client. A
client-ID or redirect mismatch now reports a setup error instead of looking like a cancelled sign-in. When moving an
existing development install to the keyed build, use **Back up…** first, disable the old copy, load the keyed build and
use **Restore…** there. Keep the old copy installed until its documents and settings have been checked in the new one;
Chrome stores each extension ID's data separately.

### Google in Safari

Safari has no identity API, so Drive and Calendar sync sign in through the Glaze app: the extension's handler (`safari/Glaze/Glaze Extension/GlazeGoogle.swift`) starts an authorization-code sign-in with PKCE for Google's "iOS" client, the app (`GlazeGoogleSignIn.swift`) shows Google's page and leaves the redirect in the app group's container, and the handler exchanges the code and keeps the refresh token in the extension's own Keychain items. Drive and Calendar are separate grants (`feature: 'drive' | 'calendar'` in each `google.*` message), each with its own Connect, refresh token and Disconnect, which forgets only that grant on this device. The handler holds a sign-in under way, so one finishes after Safari unloads the worker (Settings asks `finish` until it has). The worker keeps access tokens in memory only, until their last minute. A Calendar run in Safari stops starting writes after 20 s and resumes on the page's next request, and large Drive transfers resume across workers from the session saved in storage, so neither needs a background helper. Safari has no `launchWebAuthFlow`, so its Picker opens the picker page in a tab of the worker's, which comes back to `documents/picked.html` (web-accessible to the two picker origins only, through `tools/build/safari-manifest.sh`). That page hands its address to the worker, which checks the state and tab and then closes the tab. The pick under way waits in `storage.session`, and Documents and Writer ask `picked` every second until it answers. The app group is `group.io.frostdev.Glaze` on iOS and `22AAZFMTV8.io.frostdev.Glaze` on the Mac (both Mac builds; Team ID-prefixed groups need no provisioning profile on macOS). The whole path is off until `native: true` in `background/google-config.js`. `test/safari/google-native.test.js` runs the handler in Swift's interpreter (Mac only), and `test/platform/google.test.js` and `test/planner/gcal.test.js` cover the worker and Settings.

## Safari

Safari loads Glaze from this Mac app. The Xcode project is in `safari/`; to build the app yourself
you need Xcode (the script sets Glaze's update public key; `SAFARI_UPDATE_PUBLIC_KEY` overrides it):

```sh
sh tools/build/build-safari.sh
```

That packages the extension, copies it into a temporary copy of the project, and builds a universal
app, signed with the configured Developer ID, into `release/<version>/github/` as a zip (and a disk image when
notarized). Override `SAFARI_SIGN_IDENTITY` and `SAFARI_TEAM_ID` to use a different identity. Safari only installs
apps from outside the App Store when they are notarized, so pass a saved `notarytool` Keychain profile:

```sh
NOTARY_PROFILE=your-profile sh tools/build/build-safari.sh
```

or set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` for an App Store Connect API key. The script
then notarizes the app, staples the ticket, checks Gatekeeper, and writes
`release/<version>/github/glaze-<version>-safari-macos.zip` and a notarized `.dmg`, each with its SHA-256 checksum. Without credentials the zip is
marked `unnotarized` and is for development only.

For the Mac App Store, `tools/build/appstore-safari.sh` archives the same project with App Store signing
and uploads the build to App Store Connect. It needs an App Store Connect API key with the Admin role in
`ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID`; Xcode creates the distribution certificate and profiles
on first use. `APPSTORE_EXPORT_ONLY=1` builds the signed package without uploading. Listing text,
screenshots and review submission happen in App Store Connect.

The app bundles only the files the Xcode project lists for its two extension targets (Mac and iOS); a folder
reference brings everything under it. Every build script copies the package into the project's Resources folder
and then runs `node tools/build/safari-resources.js` on it, which stops the build if the package has a file the
project doesn't list. Add a new top-level file or folder to both extension targets in Xcode;
`test/safari/safari-resources.test.js` checks the project against everything the package ships.

For direct development in `safari/Glaze/Glaze.xcodeproj`, refresh the checked-in generated resources
with `bash tools/build/sync-safari-resources.sh --refresh` after changing extension sources. Both extension
targets check every packaged file before copying resources and stop with that command if the bundle
is stale. The check uses Node, Python 3, zip and unzip; the Xcode phase also searches the usual Homebrew
binary directories. `bash tools/build/sync-safari-resources.sh --check` runs the same check without building
or signing an app. Release scripts continue to stage and validate a fresh temporary copy.

`tools/build/package-safari.sh` regenerates the Xcode project from scratch and replaces its native edits.
Use it only when you mean to regenerate the project. It doesn't know about the iPhone and iPad targets below.

### iPhone and iPad

The iOS app is two more targets in the same Xcode project (`Glaze iOS` and `Glaze iOS Extension`), sharing
the extension's resources and native handler with the Mac targets. To try it in the Simulator, run the
`Glaze iOS` scheme in Xcode.

## Bundled libraries

Glaze is MIT licensed ([LICENSE](../LICENSE)). Bundled with it, each under its own license beside it: three.js (MIT, `vendor/three.LICENSE`), lottie-web's light canvas player (MIT, `vendor/lottie/LICENSE`), pdf.js 6.4.299 with its JBIG2 and JPEG 2000 decoders, the core-js it bundles, Brotli's dictionary and one of Firefox's viewer images (Apache-2.0, BSD, MIT and MPL-2.0, `vendor/pdfjs/`), the Tesseract OCR engine and its tessdata_fast models (Apache-2.0, `vendor/tesseract/`), ProseMirror, Writer's editor engine, as one readable esbuild bundle (MIT, `vendor/pm.js`, `vendor/pm.css`, `vendor/pm.LICENSE`), harper.js, Writer's spelling and grammar checker, as published with its slim wasm and two unused paths cut (Apache-2.0, `vendor/harper/`), and Writer's paper fonts Tinos, Arimo, Carlito and Cousine from @fontsource (SIL OFL 1.1, `vendor/fonts/`), each rebuilt by its `tools/vendor/vendor-*.sh` (`vendor-pdfjs.sh`, `vendor-prosemirror.sh`, `vendor-harper.sh`, `vendor-paper-fonts.sh`). MathLive 0.111.4 (MIT, `vendor/mathlive/`) ships its readable ESM distribution and math fonts, reproduced from an integrity-pinned tarball by `tools/vendor/vendor-mathlive.sh`. QuickJS (MIT, `vendor/quickjs/`), the engine behind Rime's `run_js`, is quickjs-emscripten 0.32.0's WebAssembly build, rebuilt and checked against its recorded hashes by `tools/build/vendor-quickjs.sh`. Inter and Atkinson Hyperlegible (SIL OFL 1.1, `fonts/`) have no vendor script. The scripts check what they download against pinned hashes; `vendor-three.sh` and `vendor-prosemirror.sh`, which use npm, install with install scripts off and checks the installed packages against pinned integrity values (`tools/vendor/npm-integrity.js`).

### Settings and setup

`extension/settings/choices.js` owns shared Frost behavior, paper formats, motion levels and feature dependencies. `choice-art.css` supplies theme thumbnails and motion demonstrations to both setup and Settings. Settings adds visual controls through `editor-visual.js`, keeps search and its keyboard boundary in `editor-search.js`, and school permission operations in `editor-sites.js`. Existing `data-key` paths own persistence and resets; the paper sample never duplicates controls or starts model requests.

Run `glaze-remote -o <evidence> -- node checks/settings/settings-clarity-check.js /out` for credential typing, complete-theme selection, dependencies, keyboard use, Speed resets, sample updates, setup links and responsive screenshots. The existing settings ownership, wiring, layout, embedded-settings and wizard checks remain applicable.
