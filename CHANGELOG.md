# Changelog

All notable changes to Glaze are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A Safari Mac app, released separately as `safari-v2.0.1`.

### Changed

- The popup's "Open the editor" button works whether or not the browser returns a promise.

## [2.0.1] — 2026-10-11

### Fixed

- With a background on, opening a slide-out (rubric, settings, attendance) covered the whole page with the background.
- Slide-outs now look like a sheet over the dimmed page, with an edge, a shadow and a round close button.
- Opening a slide-out no longer shifts the page sideways and leaves a strip beside the panel. This was Ultra's bug.
- The attendance slide-out showed a scrollbar along its bottom.
- Pressing a button could nudge it out from under the pointer; the slide-out close button swung away on hover.

## [2.0.0] — 2026-10-11

Glaze now reshapes Ultra's pages, not just their colours, and has a full editor.

### Added

- **Editor page** with a live preview. The popup keeps the master switch, palettes, motion level and a link to the editor.
- **Look:** font (System, Blackboard, Inter, Atkinson Hyperlegible, Serif, Mono; Inter and Atkinson are bundled), text size, line height, corner radius, density, depth and glass blur.
- **Backgrounds:** solid, gradient, aurora, or an image from an `https://` link, with dim and blur.
- **Motion levels:** Off, Subtle (default) and Expressive. Off is used automatically when the system asks for reduced motion, unless you opt out. The three 1.0 switches remain as fine-tuning.
- **Course colours:** Ultra's course stripes are blended into the palette, or set one by one.
- **Theme management:** save, rename and delete your own palettes; export and import settings as JSON; contrast badges; automatic light/dark palettes that follow the system.
- **Tooltips and hints:** themed tooltips replace the browser's plain ones. Hovering a date shows how far off it is, a grade shows its share, and cut-off text shows in full.
- **Extras**, each off until switched on: due-date urgency, countdowns and grade percentages, shorter descriptions, score bars, reading width, folder previews, course progress, keyboard shortcuts, and hiding parts of the page you don't use.
- Tests (`node --test`) and a CI workflow.

### Changed

- Page polish across Ultra: button hierarchy, a clear selected state on segmented controls, glass headers, the calendar month view, gradebook grade bands, discussions, rich text, empty states and the course outline.
- Assignment pages: instructions in one card, details that stay in view, a single-card text editor with a focus ring, and a drop zone that responds to the pointer.
- The theme's stylesheets are added at page start, so Ultra no longer flashes unthemed.
- 1.0 settings carry over: your palette, motion switches and footer setting are migrated on first run.

### Fixed

- Glass headers were painted opaque, so the blur never showed.
- Under reduced motion, cards could stay invisible until their entrance delay ran out.
- On light palettes, chips and badges were flattened to the background.
- Ultra's grey course header and breadcrumb bar ignored the palette.
- Dark labels on accent buttons were recoloured light and became hard to read.
- Finished entrance animations left panels scrollable sideways under a background.

## [1.0.0] — 2026-09-04

Initial release.

- Full theme for Blackboard Ultra, applied on any host under `https://*/ultra/*`.
- Popup with 14 customisable colour tokens and live application to open tabs.
- Palette presets with a reset to the default "Frost" palette.
- Independent toggles for entrance animations, hover lift, and colour transitions.
- Footer bar toggle.
- Master on/off switch that adds and removes the theme without a page reload.
- Settings stored in `chrome.storage.sync`; no data collection and no network requests.

[2.0.1]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.1
[2.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.0
[1.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v1.0.0
