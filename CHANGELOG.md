# Changelog

All notable changes to Glaze are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.3] — 2026-10-13

### Added

- **Animated backgrounds:** eight slow, soft three.js scenes, off until you pick one. Mist, Orbs,
  Borealis (swaying northern lights), Lava (a lava lamp), Waves, Dust, Contours (a topographic map that
  reshapes itself) and Horizon (a striped sun over a gliding grid). Drawn at low resolution, at most 30
  frames a second, paused in background tabs and still when motion is off. three.js loads only when a
  scene is chosen.
- **Intensity:** one slider for how much an animated background stands out. It sets color, contrast
  and pace together, from barely there to bold.
- **Gradient controls:** style (Linear, Radial, Conic, Mesh), angle, blend (soft to crisp bands) and
  spread. Gradients now fill the screen and are mixed in OKLab where the browser supports it, so the
  colors melt into each other instead of sitting in separate patches.
- **Background colors:** gradient, aurora and animated backgrounds can use your own three colors, or
  one of six ready-made sets, instead of the palette's.
- **Grain** for gradient, aurora and image backgrounds: a faint noise that hides color banding. On by default.

### Changed

- Score bars, countdowns and percentages, folder previews and course progress are now on by default.
  If you had already changed any Extra, your choices are kept.
- The background editor shows only the controls the chosen background uses.
- Palette-colored backgrounds use the accent, bright accent and muted text colors. The success green
  clashed with warm palettes once the gradient filled the screen.
- The aurora's fourth glow uses the background colors instead of the palette's error red.
- New store screenshots and promo tiles, drawn with the animated backgrounds.
- **Course documents** are a centered column on one frosted-glass card, with the title lined up above
  it, instead of a narrow stack of nested boxes at the left of the page. On wide screens the whole
  column scales up with the window, text, files and videos included, up to 1.5x.
- Videos at Ultra's default size fill the document column at 16:9. Attachments are rounded tiles, with
  an open preview framed inside them.
- **Safari updates:** opening a newer Glaze over an installed one offers **Update Glaze**, replaces the
  old copy where it is (`/Applications` or `~/Applications`), quits it if it's running, and then says
  what changed instead of repeating setup. An equal or newer Glaze, or the App Store's, is opened
  rather than replaced. The new copy is swapped in only once it's fully copied, so a failed update
  leaves the old Glaze working.
- **Safari:** after installing, the disk image's copy of Glaze unregisters itself and ejects the image.
  Running it had added a second Glaze to Safari's Extensions list; ticking that one left Glaze off
  once the image was ejected.
- Previous and Next above an item are themed buttons instead of a dark grey bar.
- **Assignment pages:** the title lines up with the content, and the instructions and the details
  panel are frosted-glass cards, without the divider between them.
- With Reading width on, text sits in the middle of its card instead of against the left edge.
- The current page in the main nav and in a course's Contents list is marked by a glowing accent bar,
  replacing Ultra's purple strip.

### Fixed

- With Reading width on, course documents were squeezed into a narrow column at the left of the page.
- The bundled Inter and Atkinson Hyperlegible fonts didn't load on Ultra pages in Chrome builds that
  give extension files their static address.

## [2.0.2] — 2026-10-11

### Added

- A Safari Mac app, released separately as `safari-v2.0.1`.
- The Safari Mac app installs itself: open it from the disk image and click **Install Glaze**. It
  copies itself into Applications, opens Safari's Extensions settings, and shows an illustrated
  guide that ticks off as Safari turns Glaze on.

### Changed

- The popup's "Open the editor" button works whether or not the browser returns a promise.
- American spelling: "colours" is now "colors".

## [2.0.1] — 2026-10-11

### Fixed

- With a background on, opening a slide-out (rubric, settings, attendance) covered the whole page with the background.
- Slide-outs now look like a sheet over the dimmed page, with an edge, a shadow and a round close button.
- Opening a slide-out no longer shifts the page sideways and leaves a strip beside the panel. This was Ultra's bug.
- The attendance slide-out showed a scrollbar along its bottom.
- Pressing a button could nudge it out from under the pointer; the slide-out close button swung away on hover.

## [2.0.0] — 2026-10-11

Glaze now reshapes Ultra's pages, not just their colors, and has a full editor.

### Added

- **Editor page** with a live preview. The popup keeps the master switch, palettes, motion level and a link to the editor.
- **Look:** font (System, Blackboard, Inter, Atkinson Hyperlegible, Serif, Mono; Inter and Atkinson are bundled), text size, line height, corner radius, density, depth and glass blur.
- **Backgrounds:** solid, gradient, aurora, or an image from an `https://` link, with dim and blur.
- **Motion levels:** Off, Subtle (default) and Expressive. Off is used automatically when the system asks for reduced motion, unless you opt out. The three 1.0 switches remain as fine-tuning.
- **Course colors:** Ultra's course stripes are blended into the palette, or set one by one.
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

[2.0.3]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.3
[2.0.2]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.2
[2.0.1]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.1
[2.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.0
[1.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v1.0.0
