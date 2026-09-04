<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="Glaze" width="360">
  </picture>
</p>

# Glaze for Blackboard Ultra

Glaze is a Chrome extension that recolours Blackboard Ultra. It replaces Ultra's palette with one you
control — fourteen colour tokens, a set of presets, and switches for motion and the footer bar — and it
works on any institution's Blackboard Ultra install, because every Ultra deployment lives under `/ultra/`
on its own domain.

## Features

- **Custom palette** — 14 colour tokens (accent, surfaces, text, lines, success/warning/error) picked from the popup, applied live to open tabs.
- **Presets** — one-click palettes, plus reset back to the default "Frost".
- **Motion toggles** — entrance animations, hover lift, and colour transitions each switch off independently.
- **Footer toggle** — show or hide the Glaze footer bar.
- **Any host** — matches `https://*/ultra/*`, so it works on your university's Blackboard without configuration.

## Install

**Chrome Web Store:** _link coming once the listing is published._

**Load unpacked (development):**

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Open your Blackboard Ultra site and click the Glaze icon.

## How it works

The content script injects `theme.css` into the page as a `<link>` it owns, so the popup can toggle the
theme on and off without a reload. The stylesheet remaps Blackboard's own `--palette-*` custom properties
onto Glaze's `--gz-*` tokens, which the content script writes onto `<html>` from your saved settings. A
small DOM sweep tags the long tail — elements with hardcoded light backgrounds, dark text, viewport-fixed
bars — with `data-gz-*` attributes that `theme.css` then restyles.

## Building

```sh
./package.sh
```

Writes `dist/glaze-v<version>.zip`, ready for the Chrome Web Store. Requires `node` and `zip`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

Glaze stores only your settings in `chrome.storage.sync`. It collects nothing and makes no network
requests. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

---

Blackboard is a trademark of Anthology Inc. This project is not affiliated with, endorsed by, or
sponsored by Anthology Inc.
