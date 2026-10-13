<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="Glaze" width="360">
  </picture>
</p>

# Glaze for Blackboard Ultra

Glaze is a Chrome and Safari extension that restyles Blackboard Ultra. It replaces Ultra's palette with one you
control, reshapes the pages around it, and adds small helpers you can see at a glance. It works on any
institution's Blackboard Ultra install, because every Ultra deployment lives under `/ultra/` on its own
domain.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh"><b>Get it for Chrome</b></a> ·
  <a href="https://github.com/frostdev-ops/glaze/releases/download/v2.1.3/glaze-2.1.3-safari-macos.dmg"><b>Download for Mac (Safari)</b></a>
</p>

## Features

- **Palettes** — six presets, 14 colour tokens, your own saved palettes, and automatic light/dark palettes that follow the system.
- **Look** — fonts for text, headings and code (two bundled; about forty more from Google Fonts and Nerd Fonts, or any Google Font by name, each previewed in its own face), text size, line height, corner radius, density, depth and glass.
- **Backgrounds** — solid; a gradient you shape (linear, radial, conic or mesh; angle, blend, spread); a drifting aurora; your own image; or eight slow animated scenes (three.js, drawn at low resolution) with one Intensity slider. Palette colors or your own.
- **Motion** — Off, Subtle or Expressive. Reduced-motion users get Off automatically.
- **Course colors** — Ultra's course stripes blended into your palette, or set one by one.
- **Tooltips and hints** — themed tooltips. Hover a date for how far off it is, a grade for its share.
- **Extras** — score bars, due-date status ("in 2 days · Unopened", "Submitted", "Submitted late", "Graded · 18/20") and grade percentages, folder previews, course progress, new-grade and new-content badges, a what-if grade calculator, a Ctrl+K command palette for courses, items, pages and settings, a backup of what you type in Blackboard's editors, Download all, which saves a folder's files as one zip, and focus mode for course documents (on by default); due-date urgency, shorter descriptions, reading width, keyboard shortcuts, dark documents and hiding page parts you don't use (off by default).
- **Looks** — eight ready-made combinations of palette, fonts, shape and background, one click each in the popup or the editor.
- **Editor** — every setting in one page with a live preview; the popup keeps the quick controls.
- **Theme codes** — share your palette, fonts, look and background as one line of text; a pasted code previews before it applies.
- **Languages** — English, Spanish, French, German, Portuguese (Brazil) and Dutch. On Blackboard, Glaze writes in the language Ultra is shown in; the editor and popup follow the browser. Adding one is a file in `i18n/` (see `lib/i18n.js`); the five above are machine translations, and corrections are welcome as bug reports.

- **Any host** — matches `https://*/ultra/*`, so it works on your university's Blackboard without configuration.

## Install

**Chrome:** install from the [Chrome Web Store](https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh).

**Load unpacked (development):**

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Open your Blackboard Ultra site and click the Glaze icon.

## Safari

[Download the Mac app](https://github.com/frostdev-ops/glaze/releases/download/v2.1.3/glaze-2.1.3-safari-macos.dmg): signed and notarized, attached to each release on
[GitHub Releases](https://github.com/frostdev-ops/glaze/releases). It runs
on Intel and Apple Silicon Macs with macOS 12 or newer. Glaze's styling needs Safari 17.2 or newer;
the frosted-glass blur needs Safari 18.

1. Open the `.dmg`, open **Glaze** and click **Install Glaze**. It copies itself into Applications
   (your own `~/Applications` if you aren't an administrator) and reopens from there. Dragging it into
   **Applications** works too. (A `.zip` of the same app is there too.)
2. Glaze opens Safari's Extensions settings and shows an illustrated guide: tick Glaze, then allow it
   on your Blackboard site. The guide ticks off the first step as soon as Safari turns Glaze on.

Safari loads Glaze from this Mac app. The Xcode project is in `safari/`; to build the app yourself
you need Xcode:

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

### iPhone and iPad

Glaze for Safari on iPhone and iPad needs iOS or iPadOS 18 or newer. It comes from the same App Store
listing as the Mac app; buying or installing on one platform covers the other.

1. Install **Glaze** and open it. It shows a two-step guide.
2. Turn Glaze on in **Settings › Apps › Safari › Extensions › Glaze for Blackboard Ultra** by switching on
   **Allow Extension**. On iOS 26.2 and newer, the guide's **Open Settings** button takes you to
   Safari's extension settings, and the guide ticks the step off as soon as Glaze is on.
3. Open your Blackboard Ultra site in Safari and tap the extensions button in the address bar (a puzzle
   piece; on iPhone it can be in the page menu at the left of the address). Tap **Glaze for Blackboard
   Ultra**, then **Always Allow…** and **Always Allow on This Website**, and reload the page.

The popup and the editor are under the same button. The editor also opens from Settings › Apps › Safari ›
Extensions › Glaze for Blackboard Ultra › Settings.

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

Glaze stores your settings in `chrome.storage.sync`, and your course names, which grades and course
items you've seen and a backup of what you type in Blackboard's editors (until it's posted, 14 days at most) on your own
device. It collects nothing. The only requests it makes go to your own Blackboard site
(folder previews; a folder's files when you click Download all; your grades and submission status for due dates, new-grade badges, the calculator and
your overall grade on course cards;
your course list and a course's items for the command palette and new-content badges), to Google Fonts or jsDelivr for a web
font you choose, and to a background image you choose. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

---

Blackboard is a trademark of Anthology Inc. This project is not affiliated with, endorsed by, or
sponsored by Anthology Inc.
