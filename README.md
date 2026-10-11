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

## Features

- **Palettes** — six presets, 14 colour tokens, your own saved palettes, and automatic light/dark palettes that follow the system.
- **Look** — font (two bundled), text size, line height, corner radius, density, depth and glass.
- **Backgrounds** — solid, gradient, a drifting aurora, or your own image.
- **Motion** — Off, Subtle or Expressive. Reduced-motion users get Off automatically.
- **Course colours** — Ultra's course stripes blended into your palette, or set one by one.
- **Tooltips and hints** — themed tooltips. Hover a date for how far off it is, a grade for its share.
- **Extras** (each off by default) — due-date urgency, countdowns, score bars, folder previews, course progress, keyboard shortcuts, reading width, and hiding page parts you don't use.
- **Editor** — every setting in one page with a live preview; the popup keeps the quick controls.
- **Any host** — matches `https://*/ultra/*`, so it works on your university's Blackboard without configuration.

## Install

**Chrome Web Store:** _link coming once the listing is published._

**Load unpacked (development):**

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Open your Blackboard Ultra site and click the Glaze icon.

## Safari

Download the signed and notarized **Safari Mac app** from
[GitHub Releases](https://github.com/frostdev-ops/glaze/releases) (the `safari-v*` release). It runs
on Intel and Apple Silicon Macs with macOS 12 or newer. Glaze's styling needs Safari 17.2 or newer;
the frosted-glass blur needs Safari 18.

1. Unzip `glaze-<version>-safari-macos.zip` and move `Glaze.app` into Applications.
2. Open Glaze once, then choose **Quit and Open Safari Settings…**.
3. In Safari Settings → Extensions, turn Glaze on, and allow it on your Blackboard site.

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
`release/glaze-<version>-safari-macos.zip` with its SHA-256 checksum. Without credentials the zip is
marked `unnotarized` and is for development only.

`scripts/package-safari.sh` regenerates the Xcode project from scratch and replaces its native edits.
Use it only when you mean to regenerate the project.

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

Glaze stores your settings in `chrome.storage.sync` and your course names on your own device. It
collects nothing. The only requests it makes are the folder previews (to your own Blackboard site) and
a background image you choose, each only when you turn it on. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

---

Blackboard is a trademark of Anthology Inc. This project is not affiliated with, endorsed by, or
sponsored by Anthology Inc.
