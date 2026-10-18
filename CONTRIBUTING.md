# Contributing to Glaze

## Development loop

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → pick this folder.
2. Edit a file.
3. Hit the reload arrow on the Glaze card, then reload your Blackboard Ultra or Canvas tab.

Popup and editor changes just need the page reopened. Stylesheet and content script changes need the
extension reload. Run `node --test` before sending a change.

## Layout

- `content.js` — runs on Ultra, Canvas and Moodle pages: adds the stylesheets, applies settings, the DOM sweep, tooltips and the extras. What only one site does is in its part, `content-ultra.js` or `content-canvas.js`, listed before `content.js` for that site (Moodle has none); each site's first script has its own budget (`test/perf-budget.test.js`).
- `theme.css` (palette and page polish), `motion.css` (motion levels), `extras.css` (backgrounds and extras).
- `defaults.js` — the settings schema, defaults, presets and `GZ_SANITIZE`. `lib/` — pure helpers with tests in `test/`, plus `scene.js` (the animated backgrounds) and the vendored `three.min.js`.
- `popup.*`, `options.*`, `ui.*` — the popup, the editor and what they share. `preview.html` is the editor's mock Ultra page.
- [Development](docs/development.md) — architecture, supported build paths, feature gates and release requirements.

## Conventions

- No build step, no dependencies, no bundler. Vanilla JS, plain CSS, files loaded directly. The exceptions are `lib/three.min.js`, a checked-in, tree-shaken three.js (`scripts/vendor-three.sh` rebuilds it), and lottie-web's official light canvas player in `lib/lottie/` (`scripts/vendor-lottie.sh` fetches it by a pinned hash); only an upgrade needs either.
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
