# Chrome Web Store listing — Glaze

## Name

Glaze for Blackboard Ultra

## Short summary (132 char max)

> Recolour Blackboard Ultra. 14 colour tokens, one-click presets, motion and footer toggles. Works on any institution's Ultra.

(123 characters.)

## Category

**Productivity.** Glaze is a look-and-feel customiser, not an assistive technology, so Accessibility
would overclaim — it makes no contrast or screen-reader guarantees.

## Detailed description

Blackboard Ultra looks the same at every institution, and you don't get a say in it. Glaze gives you one.

Open the popup and set fourteen colours — accent, surfaces, text, lines, and the success, warning and
error states. The page updates as you pick, in every open Ultra tab, with no reload. Start from a preset
if you'd rather not choose fourteen colours yourself, and reset back to the default "Frost" palette at
any time.

You also get switches for the things a theme usually forces on you:

• Entrance animations — on or off
• Hover lift and press feedback — on or off
• Colour and border transitions — on or off
• The Glaze footer bar — on or off
• The whole theme — one master switch, instant, no reload

Glaze works on any Blackboard Ultra deployment. Institutions self-host Ultra on their own domains, so
Glaze matches the path every Ultra install shares (/ultra/) rather than a fixed list of universities.
There is nothing to configure: install it, open your Blackboard, and pick your colours.

Privacy: Glaze stores only your settings, in Chrome's sync storage. It collects no data, sends nothing
anywhere, and makes no network requests at all. The source is open at
https://github.com/frostdev-ops/glaze.

Blackboard is a trademark of Anthology Inc. Glaze is an independent project and is not affiliated with,
endorsed by, or sponsored by Anthology Inc.

## Single-purpose statement

Glaze has one purpose: to restyle Blackboard Ultra pages according to the user's chosen colours and
motion preferences. Every permission and every line of code serves that purpose.

## Permission justifications

**storage**
Saves the user's theme settings — the on/off state, fourteen colour values, three motion toggles and the
footer toggle — in `chrome.storage.sync`, so the theme persists across sessions and devices. No other
data is stored.

**Host access: `https://*/ultra/*`**
Blackboard Ultra is self-hosted by each institution on its own arbitrary domain (for example
`learn.example.edu`, `blackboard.example.ac.uk`), with no common hostname. Every deployment serves the
Ultra interface under the `/ultra/` path, so that path is the narrowest match pattern that can reach the
pages the extension is for. The content script only injects a stylesheet, sets CSS custom properties on
`<html>`, and tags elements with `data-gz-*` attributes so they can be restyled. It reads no page
content, and transmits nothing.

**web_accessible_resources: `theme.css`**
The content script injects the stylesheet as a `<link>` it owns, so the master switch can add and remove
the theme without reloading the page. Chrome requires the file be web-accessible to be linked this way.

## Screenshots checklist (1280x800 each, PNG, up to 5)

- [ ] 1 — Ultra course page, themed, default "Frost" palette. The hero shot.
- [ ] 2 — Popup open over a themed Ultra page, showing the colour grid.
- [ ] 3 — A contrasting preset applied (light palette), same page as #1 for comparison.
- [ ] 4 — Popup motion and footer sections, with the footer bar visible on the page behind.
- [ ] 5 — Master switch off: unthemed Ultra, showing the extension is fully reversible.

Use the same course and same viewport across shots. Blur or replace any real names, grades, or student
data before uploading.

## Promo images

Prepared in `assets/store/`:

- `small-tile.png` — 440x280, required.
- `marquee.png` — 1400x560, optional, for featured placement.

SVG sources sit alongside each PNG in the same folder; re-export from those if the branding changes.

## Privacy policy URL

https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md
