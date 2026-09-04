# Contributing to Glaze

## Development loop

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → pick this folder.
2. Edit a file.
3. Hit the reload arrow on the Glaze card, then reload your Blackboard Ultra tab.

Popup-only changes just need the popup reopened. `theme.css` changes need the extension reload.

## Conventions

- No build step, no dependencies, no bundler. Vanilla JS, plain CSS, files loaded directly.
- Keep diffs small and focused. One change per PR.
- Defaults live in exactly one place: `defaults.js`. Don't duplicate a colour or a toggle elsewhere.
- Comments explain *why*, not what.

## Adding a preset

Add an entry to `GZ_PRESETS` in `defaults.js`: a name and a map of the `--gz-*` tokens it overrides.
Anything you leave out falls back to the defaults. The popup picks presets up automatically.

## Adding a colour token

1. Add a row to `GZ_COLORS` in `defaults.js`: `['--gz-name', 'Popup label', '#default']`. The popup and
   `GZ_DEFAULTS` both build from this list, so nothing else needs touching there.
2. Use the token in `theme.css` — normally by mapping one of Blackboard's `--palette-*` variables onto it.

Existing users' stored settings are merged over the defaults by `GZ_MERGE`, so a new token gets its
default value without a migration.

## Reporting bugs

Open an issue with the bug report template. Include your institution's Blackboard host and a screenshot.
