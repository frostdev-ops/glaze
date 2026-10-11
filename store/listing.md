# Chrome Web Store listing — Glaze

## Name

Glaze for Blackboard Ultra

## Short summary (132 char max)

> Make Blackboard Ultra yours: palettes, fonts, backgrounds, motion and due-date countdowns. Works on any institution's Ultra.

(124 characters.)

## Category

**Productivity.** Glaze is a look-and-feel customiser, not an assistive technology, so Accessibility
would overclaim — it makes no contrast or screen-reader guarantees.

## Detailed description

Blackboard Ultra looks the same at every institution, and you don't get a say in it. Glaze gives you one.

Pick a palette, or set all fourteen colours yourself, and every open Ultra tab updates as you choose. Save
your own palettes, or let Glaze switch between a light and a dark one with your system.

Then shape the rest:

• Look — font, text size, line height, rounded corners, spacing, depth and frosted glass
• Background — solid, gradient, a slowly drifting aurora, or your own image
• Motion — Off, Subtle or Expressive. Reduced-motion settings are respected automatically.
• Course colours — Ultra's course stripes blended into your palette, or chosen one by one

Glaze also tidies Ultra itself: clearer buttons, a visible selected state on toggles, a readable
calendar, grade bands in the gradebook, and calmer assignment pages.

Optional helpers, each off until you switch it on:

• Due-date urgency and countdowns ("in 2 days") next to every deadline
• Grade percentages and score bars
• Folder previews: hover a folder to see what's inside and what's due
• Course progress: how much of a course you've completed
• Keyboard shortcuts for courses, calendar, grades and messages
• Hide parts of the page you don't use

Everything lives in one editor page with a live preview; the popup keeps the quick controls. Back up
and restore your settings as a file.

Glaze works on any Blackboard Ultra deployment. Institutions self-host Ultra on their own domains, so
Glaze matches the path every Ultra install shares (/ultra/) rather than a fixed list of universities.

Privacy: Glaze stores your settings in Chrome's sync storage and your course names on your device. It
collects nothing and has no server. The only requests it makes are folder previews, to your own
Blackboard site, and a background image you choose, each only if you turn it on. The source is open at
https://github.com/frostdev-ops/glaze.

Blackboard is a trademark of Anthology Inc. Glaze is an independent project and is not affiliated with,
endorsed by, or sponsored by Anthology Inc.

## Single-purpose statement

Glaze has one purpose: to customise how Blackboard Ultra pages look and read, according to the user's
chosen colours, layout, motion and display preferences. The optional helpers (countdowns, previews,
progress, shortcuts) only present information already on the user's Blackboard pages. Every permission
and every line of code serves that purpose.

## Permission justifications

**storage**
Saves the user's theme settings in `chrome.storage.sync`, so the theme persists across sessions and
devices, and the names of the user's courses in `chrome.storage.local`, so the editor can list them for
recolouring. No other data is stored.

**Host access: `https://*/ultra/*`**
Blackboard Ultra is self-hosted by each institution on its own arbitrary domain (for example
`learn.example.edu`, `blackboard.example.ac.uk`), with no common hostname. Every deployment serves the
Ultra interface under the `/ultra/` path, so that path is the narrowest match pattern that can reach the
pages the extension is for. The content script injects stylesheets, sets CSS custom properties on
`<html>`, and tags elements with `data-gz-*` attributes so they can be restyled. With optional helpers
on, it reads dates and grades already shown on the page to display countdowns and percentages, and
folder previews ask the same Blackboard site for a folder's contents. Nothing is sent anywhere else.

**web_accessible_resources: `theme.css`, `motion.css`, `extras.css`, `fonts/*.woff2`**
The content script injects the stylesheets as `<link>`s it owns, so the master switch can add and remove
the theme without reloading the page; the stylesheets load the bundled fonts. Chrome requires these
files be web-accessible to be linked this way.

## Remote code

None. All code ships in the package.

## Screenshots checklist (1280x800 each, PNG or JPEG, up to 5)

The 1.0 shots in `assets/store/screenshots-1280/` still show the palettes. For 2.0, replace or add:

- [ ] 1 — Ultra course outline, themed, with countdown chips and course progress on.
- [ ] 2 — The editor page with its live preview.
- [ ] 3 — An assignment page: instructions card, details column, editor.
- [ ] 4 — Aurora or image background with a light and a dark palette side by side.
- [ ] 5 — A folder preview and a themed tooltip.

Use the same course and viewport across shots. Blur or replace any real names, grades, or student data
before uploading.

## Promo images

Prepared in `assets/store/`:

- `small-tile.png` — 440x280, required.
- `marquee.png` — 1400x560, optional, for featured placement.

SVG sources sit alongside each PNG in the same folder; re-export from those if the branding changes.

## Privacy policy URL

https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md
