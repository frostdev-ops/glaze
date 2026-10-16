# Releasing Glaze

Everything a release builds goes in `release/<version>/` (gitignored), one folder per version:

| Folder | What's in it | Where it goes |
| --- | --- | --- |
| `github/` | `glaze-v<v>.zip`, `glaze-v<v>-firefox.zip`, Mac `.dmg`/`.zip` with `.sha256`, `SHA256SUMS`, `release-notes.md` | GitHub release assets |
| `chrome-web-store/` | the upload zip, `listing.md`, screenshots, promo tiles | Chrome Web Store |
| `firefox/` | the upload zip and a source zip for review | Firefox Add-ons (addons.mozilla.org) |
| `app-store/` | `.pkg` (Mac), `.ipa` (iPhone/iPad), metadata, screenshots | App Store Connect |
| `build/` | `Glaze.app`, `Glaze-iOS.xcarchive`, `logs/` | nowhere; kept for checking |
| `validation/` | check output for that release | nowhere |

`release/appcast.xml` is the one file outside a version folder: the signed Mac update feed, holding every version.

## Firefox maintenance

`dev/firefox` is the permanent Firefox compatibility branch. Keep its dedicated worktree, merge `origin/main`
into it as main changes, and push normally after validation. Do not rebase, force-push or delete this branch.
Keep the manifest version from main; unpublished release branches are not inputs unless explicitly requested.
Shared fixes may be ported to main separately, but merging main must retain Firefox's local-only PDF imports,
event-page background, unavailable Google sign-in adapter and minimum versions (desktop 140, Android 142).

The GitHub test workflow runs the existing suite, packages Firefox, and runs pinned `web-ext@10.8.0` lint with
warnings treated as failures on this branch and pull requests into it. Its Firefox artifact includes the upload
ZIP and a reviewer source ZIP from the same commit. Lint does not replace Firefox desktop/Android runtime QA.

For a Firefox release, first merge the corresponding published main commit into `dev/firefox`, validate, and build
the upload and source ZIPs there. Use these artifacts for Firefox Add-ons and any Firefox GitHub asset; a Firefox ZIP
built from main alone is not the compatibility candidate. Do not replace already published 3.0.2 packages or tags.
Never submit or publish as part of routine branch synchronization.

## Steps

1. Bump `version` in `manifest.json`, add the `CHANGELOG.md` entry, commit.
2. `sh scripts/release.sh` runs the tests and builds the Chrome zip. With `MAC=1` and notarization
   credentials (`NOTARY_PROFILE`, or `ASC_KEY_PATH`/`ASC_KEY_ID`/`ASC_ISSUER_ID`) it also builds the notarized
   Mac app and DMG.
3. `sh scripts/safari-appcast.sh release/<v>/github/glaze-<v>-safari-macos.dmg /path/to/Sparkle/bin` signs the
   update entry into `release/appcast.xml`.
4. Tag `v<v>` and push it. CI (`.github/workflows/package.yml`) builds the Chrome zip into a draft GitHub release.
   Merge the same main release commit into the permanent `dev/firefox` branch, retaining its compatibility fixes,
   and require its tests and zero-warning Firefox lint to pass. Build the Firefox upload and reviewer source ZIPs
   from that exact Firefox commit (`sh scripts/package-firefox.sh`, then `git archive --format=zip -o <source.zip> HEAD`).
   Copy its Firefox package into `release/<v>/github/` and `release/<v>/firefox/`, with the source ZIP in `firefox/`.
   Upload the Firefox package, notarized DMG, Mac zip and matching checksums, then publish the completed draft.
   Never publish a Firefox package built from main alone. Do not rebase, force-push or delete `dev/firefox`.
5. Publish the appcast on frostdev.io at `/projects/glaze/appcast.xml`, only after the DMG is on GitHub.
6. Stores, each from its folder:
   - Chrome Web Store: `sh scripts/publish-chrome.sh release/<v>/chrome-web-store/glaze-v<v>.zip`, or upload it in the dashboard.
   - Firefox Add-ons: upload `release/<v>/firefox/glaze-v<v>-firefox.zip` at addons.mozilla.org. When it asks for source
     code, upload `glaze-v<v>-source.zip` from the same Firefox commit: pdf.js has fixed local imports and a compatibility
     shim, and three.js is a custom build. Reviewers rebuild both with `scripts/vendor-pdfjs.sh` and
     `scripts/vendor-three.sh`; the required tools and pinned versions are in README.md.
   - App Store: `sh scripts/appstore-safari.sh` (Mac) and `APPSTORE_UPLOAD=1 sh scripts/appstore-ios.sh`.
