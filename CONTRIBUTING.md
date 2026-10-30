# Contributing to Glaze

## Development loop

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the `extension` folder.
2. Edit a file.
3. Hit the reload arrow on the Glaze card, then reload your Blackboard Ultra or Canvas tab.

Popup and editor changes just need the page reopened. Stylesheet and content script changes need the
extension reload. Run `node --test` before sending a change.

## Layout

The whole tree, with diagrams: [docs/layout.md](docs/layout.md).

- `extension/` — the extension as the stores ship it; the paths below are inside it. `checks/` holds the browser checks and `test/` the unit tests, each by feature area; `tools/` the build, release, vendor, fidelity and dev scripts.
- `content/content.js` — runs on Ultra, Canvas and Moodle pages: adds the stylesheets, applies settings, the DOM sweep, tooltips and the extras. What only one site does is in its part, `content/content-ultra.js` or `content/content-canvas.js`, listed before `content.js` for that site (Moodle has none); each site's first script has its own budget (`test/platform/perf-budget.test.js`).
- `content/theme.css` (palette and page polish), `content/motion.css` (motion levels), `content/extras.css` (backgrounds and extras).
- `content/defaults.js` — the settings schema, defaults, presets and `GZ_SANITIZE`.
- One folder per feature area: `looks/`, `navigation/`, `courses/`, `planner/`, `writer/`, `documents/`, `ai/`, `agents/`, `sharing/`, `mods/`, `pet/`, `settings/`, with `core/` shared by all and `background/` the worker. An area's helpers sit at its top, with tests in `test/<area>/`; the code that touches the LMS page is in `<area>/page/`. `looks/scene.js` draws the animated backgrounds; third-party code (three.js, pdf.js, ProseMirror …) is in `vendor/`.
- `popup.html`, `options.html` (their scripts in `settings/`) and `core/ui.*` — the popup, the editor and what they share. `preview.html` is the editor's mock Ultra page.
- [Development](docs/development.md) — architecture, supported build paths, feature gates and release requirements.

## Conventions

- No build step, no dependencies, no bundler. Vanilla JS, plain CSS, files loaded directly. The exceptions are `vendor/three.js`, a checked-in, tree-shaken, readable three.js (`tools/vendor/vendor-three.sh` rebuilds it), lottie-web's official readable light canvas player in `vendor/lottie/` (`tools/vendor/vendor-lottie.sh` fetches it by a pinned hash), pdf.js in `vendor/pdfjs/` and Tesseract in `vendor/tesseract/` (`tools/vendor/vendor-pdfjs.sh`, `tools/vendor/vendor-tesseract.sh`), ProseMirror as one readable bundle in `vendor/pm.js` and `vendor/pm.css` (`tools/vendor/vendor-prosemirror.sh`), harper.js in `vendor/harper/` (`tools/vendor/vendor-harper.sh`), and Writer's paper fonts in `vendor/fonts/` (`tools/vendor/vendor-paper-fonts.sh`); only an upgrade needs any of them.
- Keep diffs small and focused. One change per PR.
- Defaults live in exactly one place: `defaults.js`. Don't duplicate a colour or a toggle elsewhere.
- Every setting reaches the page as a `--gz-*` variable or an `html[data-gz-*]` attribute. CSS matches on those; it never waits on JavaScript.
- Comments explain *why*, not what.

## Adding a preset

Add an entry to `GZ_PRESETS` in `defaults.js`, built with `GZ_PALETTE(...)`. The popup and editor pick
presets up automatically, and the tests check every preset against the contrast targets.

## Adding a colour token

1. Add a row to `GZ_COLORS` in `defaults.js`: `['--gz-name', 'Editor label', '#default']`. The editor and
   `GZ_DEFAULTS` both build from this list, so nothing else needs touching there.
2. Use the token in `theme.css` — normally by mapping one of Blackboard's `--palette-*` variables onto it.

Stored settings and imports both go through `GZ_SANITIZE`, which merges them over the defaults, so a new
token gets its default value without a migration.

## Adding a setting

Add it to `GZ_SPEC` in `defaults.js` with its default and its allowed values; `GZ_SANITIZE` validates it
from there. Turn it into a variable or attribute in `applySettings` in `content.js`, and give it a
`data-key` control in `options.html`.

## Reporting bugs

Open an issue with the bug report template. Include your institution's Blackboard host and a screenshot.
