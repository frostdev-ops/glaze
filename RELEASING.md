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

## Steps

1. Bump `version` in `manifest.json`, add the `CHANGELOG.md` entry, commit.
2. `sh scripts/release.sh` runs the tests and builds the Chrome and Firefox zips. With `MAC=1` and notarization
   credentials (`NOTARY_PROFILE`, or `ASC_KEY_PATH`/`ASC_KEY_ID`/`ASC_ISSUER_ID`) it also builds the notarized
   Mac app and DMG.
3. `sh scripts/safari-appcast.sh release/<v>/github/glaze-<v>-safari-macos.dmg /path/to/Sparkle/bin` signs the
   update entry into `release/appcast.xml`.
4. Tag `v<v>` and push it. CI (`.github/workflows/package.yml`) builds both extension zips and attaches them to
   the GitHub release; upload the DMG, Mac zip and their checksums from `release/<v>/github/`.
5. Publish the appcast on frostdev.io at `/projects/glaze/appcast.xml`, only after the DMG is on GitHub.
6. Stores, each from its folder:
   - Chrome Web Store: `sh scripts/publish-chrome.sh release/<v>/chrome-web-store/glaze-v<v>.zip`, or upload it in the dashboard.
   - Firefox Add-ons: upload `release/<v>/firefox/glaze-v<v>-firefox.zip` at addons.mozilla.org. When it asks for source
     code, upload `glaze-v<v>-source.zip` from the same folder: the vendored pdf.js gets a one-line shim and three.js
     is a custom build, and reviewers rebuild both with `scripts/vendor-pdfjs.sh` and `scripts/vendor-three.sh`.
   - App Store: `sh scripts/appstore-safari.sh` (Mac) and `APPSTORE_UPLOAD=1 sh scripts/appstore-ios.sh`.
