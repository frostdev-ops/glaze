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
     shim, three.js is a custom build, and lottie-web's player is the official light canvas build with one comment line on top. Reviewers rebuild them with `scripts/vendor-pdfjs.sh`, `scripts/vendor-three.sh` and `scripts/vendor-lottie.sh`.
   - App Store: `sh scripts/appstore-safari.sh` (Mac) and `APPSTORE_UPLOAD=1 sh scripts/appstore-ios.sh`.

## The mod blocklist

Glaze stops mods that a list names, and only the owner can sign the list (`lib/blocklist.js`). The private
key lives on the owner's own computer: never in the repo, on a server, or in a backup others can read.

Once, before the first release that includes mods:

1. `node scripts/blocklist-sign.mjs keygen ~/glaze-blocklist.key` (any path outside the repo). The file is made mode 600; an
   existing file is never overwritten and a path inside the repo is refused. Back it up offline: with the key lost, only a
   new release with a new key can block anything again.
2. Paste the public key it prints over `PENDING_OWNER_KEY` in `lib/blocklist.js` (`OWNER_KEY`) and release that. Until
   then the extension accepts no list at all. Release check: `grep PENDING_OWNER_KEY lib/blocklist.js` finds nothing.
3. Put the same public key in `BLOCKLIST_KEY` in the gallery server's `/etc/glaze-gallery.env` and restart its container
   (frostdev.io `docs/looks-gallery.md`, "Mod blocklist").

To block something, and to renew (a list expires 30 days after it is signed):

1. Keep the working list in a file outside the repo, say `~/blocklist.json`:
   `{ "mods": [id], "bundles": [bundle hash], "authors": [author key], "reasons": { "<an entry above>": "why, in one plain line" } }`.
   A mod's id, bundle hash and author key are in its `mod:<id>` record and the gallery listing. A reason is shown to the
   student next to the stopped mod (at most 200 characters, one line, and only for something listed). Taking an entry out
   unblocks that mod; it stays off until the student turns it on.
2. `node scripts/blocklist-sign.mjs sign ~/glaze-blocklist.key ~/blocklist.json` writes `~/blocklist.signed.json` with
   `seq` one higher than the working file's (and records it there), `issued` now and `expires` 30 days later. It refuses
   a key other than the pinned one, a list the extension would reject, and a key file others can read.
3. Publish it: copy the signed file into the glaze-gallery volume on loothing-vps and run
   `docker exec glaze-gallery node gallery.mjs --blocklist /data/blocklist.signed.json`. The server checks the signature,
   expiry and `seq` and says why if it refuses; `curl -i https://frostdev.io/glaze/mods/api/blocklist` shows what is served.
4. Do 2 and 3 again before the 30 days are up, even with nothing new, or extensions treat the list as out of date: blocks it
   made stay, but later blocks and unblocks reach no one. Extensions pick a new list up within a day of opening.

## Build and submit all three stores

After updating the manifest/changelog and committing the release source, run:

```sh
node scripts/store-release.mjs release
```

This runs the Node suites, builds the Chrome and Firefox packages plus the Mac and iPhone/iPad App Store
packages, and submits the exact checksummed artifacts to all three stores. It uses the store APIs directly;
Fastlane is not required. Run it on a Mac with Node.js 22+, full Xcode selected, Python 3, Git 2.29+,
zip/unzip, and Google Cloud CLI. Firefox lint downloads pinned `web-ext@10.8.0` through npx.

Chrome is submitted with staged publication, and Apple versions use manual release after approval.
AMO listed submissions may become public as soon as Mozilla approves them. This command does not
publish a GitHub release, update the website/appcast, install an app, or push any branch.

### Credentials

```sh
mkdir -p ~/.config/glaze
cp scripts/store-release.env.example ~/.config/glaze/stores.env
chmod 600 ~/.config/glaze/stores.env
# Fill in the empty values locally, then check access without uploading:
node scripts/store-release.mjs doctor
```

Keep this file and Apple's private key outside the repository. The config is parsed as data (shell
commands are never evaluated); exported environment variables override it. `--config /path/to/file.env`
selects another file. Quoted values and paths with spaces work. `ASC_KEY_PATH` may be absolute, start
with `~/`, or be relative to the config file. Never paste private keys or tokens into logs or chat.

| Store | Required values | Setup |
| --- | --- | --- |
| Chrome | Existing `gcloud` login | Glaze's publisher/item/service-account defaults are included. Run `gcloud auth login` if authentication expired. Your account needs Service Account Token Creator on the configured service account, which must be linked to the Chrome Web Store publisher. No service-account key file is needed. |
| Firefox | `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` | Create API credentials at [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/) using an account that owns Glaze. `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` are accepted aliases. Add-on ID defaults to `glaze@frostdev.io`. |
| Apple | `ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID` | Download the `.p8` for a team API key in App Store Connect → Users and Access → Integrations. Use Admin access when Xcode must create signing certificates/profiles. The existing app record must include Mac and iOS; bundle ID and team default to Glaze's. |

Existing store listings, privacy answers, review contact/demo access, screenshots, agreements and export
compliance must already be complete. Apple reuses the existing listing; English What's New is taken from
the current changelog entry. To supply shorter or separately prepared notes (Apple's limit is 4,000
characters), pass `--notes /path/to/notes.txt` on the first build. Other localizations stay unchanged.
The store APIs report any missing submission requirements; they cannot bypass store review.

### Source isolation and Firefox review

The command builds committed `HEAD`, excluding local uncommitted/untracked files. It creates disposable
clones so the current checkout and any other worktrees stay in place. Firefox starts from the permanent
`dev/firefox` branch, merges the chosen release source only in its disposable clone, and requires its
suite and zero-warning lint to pass. A merge conflict stops before uploads; resolve the compatibility
branch separately. The command never rebases, updates, pushes or deletes permanent `dev/firefox`.
`--firefox-ref REF` may select a newer candidate only if it contains permanent `dev/firefox`.
`--source-ref main` builds the current main commit even when running the command from a separate tooling
worktree. A tag or commit SHA also works. The resolved commit is frozen before any builds begin.

Firefox's source ZIP contains the exact source snapshot in `source/`, reconstruction metadata and a
rebuild script in `reviewer/`, and a README for reviewers. Before submitting, a fresh extraction must
reproduce every upload entry and the entire normalized ZIP byte for byte. Source and upload hashes,
source/Firefox commit IDs, build number, notes and submission receipts are recorded in
`release/<version>/stores/<source-commit>/release.json`. Logs and `SHA256SUMS` are beside it.

### Preview, build only, and recovery

```sh
node scripts/store-release.mjs plan                 # no network, builds or uploads
node scripts/store-release.mjs build                # signed packages; no uploads
node scripts/store-release.mjs build --stores chrome,firefox  # no Apple credentials needed
node scripts/store-release.mjs submit               # submit/resume saved verified packages
node scripts/store-release.mjs release --apple-platforms MAC_OS  # omit iPhone/iPad
```

All selected credentials are checked before the release command builds or uploads anything. Every
package must build successfully before the first upload. Independent submissions continue if a store
fails; the command exits nonzero and records which stages need attention. Rerun `submit` with the same
selection/options/output to resume. Completed submissions are skipped, remote versions/builds are
checked after interrupted responses, and changed artifact hashes are refused. A recorded submission
means accepted for processing/review at that point, not approved or publicly available.
An existing same-version Chrome/Firefox submission without a matching local receipt is refused when
its bytes cannot be verified (Mozilla adds signatures to signed XPIs). Inspect it in the dashboard or
use a new version; the command does not overwrite another release candidate.

Keep the source commit fixed while resuming (`--source-ref <original-SHA>` if the branch has advanced).
Saved packages are reused instead of being rebuilt.
`BUILD_NUMBER` can set a specific Apple build number before the first build; otherwise a UTC timestamp
is saved for both platforms. `--out DIRECTORY` chooses a separate release workspace for another build
or selection. A lock prevents simultaneous runs in the same output directory. If a run is killed,
check that the PID in `.lock` has stopped before removing that lock and resuming.

API references: [Chrome publishing](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish),
[AMO submissions](https://mozilla.github.io/addons-server/topics/api/addons.html),
[Apple review submissions](https://developer.apple.com/documentation/appstoreconnectapi/review-submissions).
