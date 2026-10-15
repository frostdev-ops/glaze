<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="Glaze" width="360">
  </picture>
</p>

# Glaze

Glaze is a Chrome and Safari extension that restyles Blackboard Ultra and Canvas. It replaces the palette with one you
control, reshapes the pages around it, and adds small helpers you can see at a glance. It works on any
institution's Blackboard Ultra install, because every Ultra deployment lives under `/ultra/` on its own
domain, and on Canvas, which Glaze recognizes on any school's domain.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh"><b>Get it for Chrome</b></a> ·
  <a href="https://github.com/frostdev-ops/glaze/releases/download/v2.2.0/glaze-2.2.0-safari-macos.dmg"><b>Download for Mac (Safari)</b></a>
</p>

## Features

- **Palettes** — six presets, 14 colour tokens, your own saved palettes, and automatic light/dark palettes that follow the system or a schedule (dark from 20:00 to 08:00, say). Keep quizzes light (off by default) leaves quizzes you're taking and external tools such as New Quizzes unthemed on Canvas.
- **Look** — fonts for text, headings and code (two bundled; about forty more from Google Fonts and Nerd Fonts, or any Google Font by name, each previewed in its own face), text size, line height, corner radius, density, depth and glass.
- **Backgrounds** — solid; a gradient you shape (linear, radial, conic or mesh; angle, blend, spread); a drifting aurora; your own image; or ten slow animated scenes (three.js, drawn at low resolution; two for Halloween, a moonlit graveyard and a pumpkin patch) with one Intensity slider. Palette colors or your own.
- **Motion** — Off, Subtle or Expressive. Reduced-motion users get Off automatically.
- **Course colors** — every course its own color, from Ultra's stripes blended into your palette or set one by one, on course pages, Messages, Grades and the calendar.
- **Tooltips and hints** — themed tooltips. Hover a date for how far off it is, a grade for its share.
- **Extras** — score bars, due-date status ("in 2 days · Unopened", "Submitted", "Submitted late", "Graded · 18/20") and grade percentages, folder previews, course progress, new-grade and new-content badges, a what-if grade calculator that keeps your scores, a Ctrl+K command palette for courses, items, pages, settings and what's due this week (also in the popup), remembering your place in a course's content, a backup of what you type in Blackboard's editors, Download all, which saves a folder's files as one zip, and focus mode for course documents (on by default); due-date urgency, shorter descriptions, reading width, keyboard shortcuts, dark documents and hiding page parts you don't use (off by default).
- **On Canvas** — the same extras, each where Canvas keeps the same thing: progress, previews, new-item badges, your place and Download all on Modules; score bars and percentages on Grades and Assignments; due-date status and urgency on Assignments, Modules and To Do; tint, a Look per course and card grades on the Dashboard (click one for the course's grades, or keep them hidden until you point at the card); draft backup for new Inbox messages to individual users in uniquely named courses. A **what-if calculator** above a course's grades works out your grade by Canvas's own rules (weights, dropped scores, excused work, grading periods) and matches Canvas's totals: change real scores, leave work out, add pretend assignments and see what you'd need for a target. It keeps what you change on your device until the real grade arrives, and never writes to Canvas. An optional **GPA** on the Dashboard gives your term and cumulative GPA on a 4.0 or plus/minus scale, weighted for honors and AP if you like, with credits, a grading scale and a what-if grade per course. Where Canvas has its own (editor recovery, course nicknames and colors, folder zips, unread counts), Glaze leaves it to Canvas, themed; Canvas's own what-if scores still work beside Glaze's. Course progress counts module completion requirements, so a course without any shows no bar.
- **Looks** — ten ready-made combinations (Graveyard and Pumpkin Patch are for Halloween) of palette, fonts, shape and background, one click each in the popup or the editor, or one for a single course.
- **Editor** — every setting in one page with a live preview; the popup keeps the quick controls.
- **Theme codes** — share your palette, fonts, look and background as one line of text; a pasted code previews before it applies.
- **Canvas course cards** — each Dashboard card its own color, gradient or picture (a link, or a file kept on your computer) with filters, focus, zoom and overlay; bookmarks as icons on the card; card width, spacing, corners, picture height and a condensed layout; hover effects, particles and a cat or bunny on your first card; an optional create button. The card editor warns, with the measured ratio, when text on a card would be hard to read. Fonts can be searched.
- **Looks gallery** — free Looks shared openly at [frostdev.io/glaze/looks](https://frostdev.io/glaze/looks). Use this Look in Glaze opens it in the editor's preview; save favorites, and go back with Previous Look from a history of the themes you wore. Both stay on your device.
- **Languages** — English, Spanish, French, German, Portuguese (Brazil) and Dutch. On Blackboard, Glaze writes in the language Ultra is shown in; the editor and popup follow the browser. Adding one is a file in `i18n/` (see `lib/i18n.js`); the five above are machine translations, and corrections are welcome as bug reports.

- **Any host** — matches `https://*/ultra/*`, so it works on your university's Blackboard without configuration. Canvas is matched on `*.instructure.com`, and recognized by its own stylesheet on a school's own domain.

## Install

**Chrome:** install from the [Chrome Web Store](https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh).

**Load unpacked (development):**

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Open your Blackboard Ultra or Canvas site and click the Glaze icon.

## Safari

[Download the Mac app](https://github.com/frostdev-ops/glaze/releases/download/v2.2.0/glaze-2.2.0-safari-macos.dmg): signed and notarized, attached to each release on
[GitHub Releases](https://github.com/frostdev-ops/glaze/releases). It runs
on Intel and Apple Silicon Macs with macOS 12 or newer. Glaze's styling needs Safari 17.2 or newer;
the frosted-glass blur needs Safari 18.

1. Open the `.dmg`, open **Glaze** and click **Install Glaze**. It copies itself into Applications
   (your own `~/Applications` if you aren't an administrator) and reopens from there. Dragging it into
   **Applications** works too. (A `.zip` of the same app is there too.)
2. Glaze opens Safari's Extensions settings and shows an illustrated guide: tick Glaze, then allow it
   on your Blackboard or Canvas site. The guide ticks off the first step as soon as Safari turns Glaze on.

The downloaded Mac app checks `https://frostdev.io/projects/glaze/appcast.xml` about once a day
while Glaze is in use and downloads updates from GitHub. Sparkle system profiling is disabled.
Background checks stay silent and skip updates that need user interaction; opening Glaze yourself
can show the standard updater interface. An installation previously prepared through that interface
may still show its existing progress window when a background check finishes it. The Mac App Store
and iPhone/iPad apps use App Store updates and include no Sparkle updater.

Safari loads Glaze from this Mac app. The Xcode project is in `safari/`; to build the app yourself
you need Xcode and the public key from [Mac update release setup](#mac-update-release-setup):

```sh
sh scripts/build-safari.sh
```

That packages the extension, copies it into a temporary copy of the project, and builds a universal
app in `release/Glaze.app`, signed with the configured Developer ID. Override `SAFARI_SIGN_IDENTITY`
and `SAFARI_TEAM_ID` to use a different identity. Safari only installs apps from outside the App Store
when they are notarized, so pass a saved `notarytool` Keychain profile:

```sh
NOTARY_PROFILE=your-profile sh scripts/build-safari.sh
```

or set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` for an App Store Connect API key. The script
then notarizes the app, staples the ticket, checks Gatekeeper, and writes
`release/glaze-<version>-safari-macos.zip` and a notarized `.dmg`, each with its SHA-256 checksum. Without credentials the zip is
marked `unnotarized` and is for development only.

For the Mac App Store, `scripts/appstore-safari.sh` archives the same project with App Store signing
and uploads the build to App Store Connect. It needs an App Store Connect API key with the Admin role in
`ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID`; Xcode creates the distribution certificate and profiles
on first use. `APPSTORE_EXPORT_ONLY=1` builds the signed package without uploading. Listing text,
screenshots and review submission happen in App Store Connect.

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
sh scripts/safari-appcast.sh "release/glaze-<version>-safari-macos.dmg" /path/to/Sparkle/bin
```

The helper verifies the notarized DMG and app, checks that the Keychain signing key matches the
app's public key, and writes `release/appcast.xml`, preserving older entries. It does not publish
anything. Upload the DMG to its GitHub release before publishing that feed at
`https://frostdev.io/projects/glaze/appcast.xml` (the frostdev.io path is `/projects/glaze/appcast.xml`).
Use the same Sparkle Keychain account for key generation and appcast signing; if you choose a
custom account, set `SAFARI_UPDATE_KEY_ACCOUNT` to it when running the helper.

### iPhone and iPad

Glaze for Safari on iPhone and iPad needs iOS or iPadOS 18 or newer. It comes from the same App Store
listing as the Mac app; buying or installing on one platform covers the other.

1. Install **Glaze** and open it. It shows a two-step guide.
2. Turn Glaze on in **Settings › Apps › Safari › Extensions › Glaze** by switching on
   **Allow Extension**. On iOS 26.2 and newer, the guide's **Open Settings** button takes you to
   Safari's extension settings, and the guide ticks the step off as soon as Glaze is on.
3. Open your Blackboard Ultra or Canvas site in Safari and tap the extensions button in the address bar (a puzzle
   piece; on iPhone it can be in the page menu at the left of the address). Tap **Glaze**, then **Always Allow…** and **Always Allow on This Website**, and reload the page.

The popup and the editor are under the same button. The editor also opens from Settings › Apps › Safari ›
Extensions › Glaze › Settings.

The iOS app is two more targets in the same Xcode project (`Glaze iOS` and `Glaze iOS Extension`), sharing
the extension's resources and native handler with the Mac targets. `scripts/appstore-ios.sh` archives it
with App Store signing into `release/Glaze-iOS.xcarchive` and `release/glaze-<version>-ios.ipa`. It uses
the App Store profiles already on the Mac; set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` to let Xcode
create them. It never uploads unless `APPSTORE_UPLOAD=1` is set. To try it in the Simulator, run the
`Glaze iOS` scheme in Xcode.

## How it works

The content script adds three stylesheets it owns (`theme.css`, `motion.css`, `extras.css`) at page
start, so the popup can switch the theme on and off without a reload. `theme.css` remaps Blackboard's
own `--palette-*` custom properties onto Glaze's `--gz-*` tokens and restyles Ultra's components. Every
setting becomes either a `--gz-*` variable or a `data-gz-*` attribute on `<html>`, which the content
script writes from your saved settings, so the CSS never needs JavaScript to decide anything. A small
DOM sweep tags the long tail — hardcoded light backgrounds, dark text, viewport-fixed bars — with
`data-gz-*` attributes the stylesheets then restyle.

## Building

```sh
./package.sh
```

Writes `dist/glaze-v<version>.zip`, ready for the Chrome Web Store. Requires `node` and `zip`.

```sh
node --test
```

Runs the tests for the colour, settings and page-text logic. No dependencies to install.

### Publishing to the Chrome Web Store

```sh
sh scripts/publish-chrome.sh
```

Packages the extension, uploads it with the Chrome Web Store API, and submits it for review. Pass a
zip path to upload a specific build; set `CWS_NO_PUBLISH=1` to upload without submitting. It signs in
as the `cws-publisher` service account through `gcloud` impersonation, so no key file is kept: your
Google account needs the Service Account Token Creator role on it, and the service account must be
added under **Account** in the Developer Dashboard. The listing text, screenshots and privacy answers
aren't in the API; edit those in the dashboard. The publisher and item IDs default to Glaze's; override them with `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID` (the publisher ID is in the dashboard's address, after `/devconsole/`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

Glaze stores your settings in `chrome.storage.sync`, including the course nicknames, colours, looks and tint
you set in a course's menu. These follow Chrome sync when it's on; Safari keeps them on this device only.
It keeps the course names your LMS lists, which grades and course
items you've seen and a backup of what you type in Blackboard's editors (until it's posted, 14 days at most) on your own
device. On Canvas it also keeps course names, codes and colors, unread-grade counts, module-item ids and your place,
with site and account identifiers for badge records, and the what-if scores and pretend assignments you enter per site,
account and course. Your GPA choices per course (credits, level, scale) sync with your settings. Supported new Inbox drafts keep the body, subject and destination
identifiers locally for up to 14 days. Your Looks history (the last 20 themes) and favorites stay on your device too;
the Looks gallery is a website you visit yourself, and Glaze sends it nothing. Canvas's own what-if scores and editor recovery remain with Canvas.
It has no analytics. The extension's read-only requests go to your own Blackboard or Canvas site
(folder previews; a folder's files when you click Download all; your grades and submission status for due dates, new-grade badges, the calculator and
your overall grade on course cards; on Canvas a course's assignment groups when you use its what-if calculator;
your course list and a course's items for the command palette and new-content badges), to Google Fonts or jsDelivr for a web
font you choose, and to a background image or course card picture you choose. For Canvas Download all, the extension's background worker
fetches signed file links from your school's file host without cookies. Links and file bytes stay in memory while
Glaze makes the zip; they are not saved in extension storage. The downloaded Mac app also checks
`https://frostdev.io/projects/glaze/appcast.xml` about once a day and downloads updates from GitHub,
with system profiling disabled. These services receive ordinary network requests, including your IP
address. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

---

Blackboard is a trademark of Anthology Inc. This project is not affiliated with, endorsed by, or
sponsored by Anthology Inc.
