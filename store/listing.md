# Chrome Web Store listing — Glaze

## Name

Glaze for Blackboard Ultra

## Short summary (132 char max)

> Make Blackboard Ultra yours: palettes, fonts, animated backgrounds and due-date countdowns. Works on any institution's Ultra.

(125 characters.)

## Category

**Productivity.** Glaze is a look-and-feel customiser, not an assistive technology, so Accessibility
would overclaim — it makes no contrast or screen-reader guarantees.

## Detailed description

Blackboard Ultra looks the same at every institution, and you don't get a say in it. Glaze gives you one.

Pick a palette, or set all fourteen colors yourself, and every open Ultra tab updates as you choose. Save
your own palettes, or let Glaze switch between a light and a dark one with your system.

Then shape the rest:

• Look — font, text size, line height, rounded corners, spacing, depth and frosted glass
• Background — solid; a smooth gradient you shape (linear, radial, conic or mesh; angle, blend and spread);
  a drifting aurora; your own image; or one of eight animated scenes, from northern lights to a lava lamp,
  with one Intensity slider for how much it stands out. In your palette's colors or your own.
• Motion — Off, Subtle or Expressive. Reduced-motion settings are respected automatically.
• Course colors — Ultra's course stripes blended into your palette, or chosen one by one

Glaze also tidies Ultra itself: clearer buttons, a visible selected state on toggles, a readable
calendar, grade bands in the gradebook, and calmer assignment pages.

At-a-glance helpers, on from the start:

• Countdowns ("in 2 days") next to every deadline, and grade percentages
• Score bars under gradebook scores
• Folder previews: hover a folder to see what's inside and what's due
• Course progress: how much of a course you've completed

More you can switch on:

• Due-date urgency for overdue and soon-due items
• Keyboard shortcuts for courses, calendar, grades and messages
• Hide parts of the page you don't use

Everything lives in one editor page with a live preview; the popup keeps the quick controls. Back up
and restore your settings as a file.

Glaze works on any Blackboard Ultra deployment. Institutions self-host Ultra on their own domains, so
Glaze matches the path every Ultra install shares (/ultra/) rather than a fixed list of universities.

Privacy: Glaze stores your settings in Chrome's sync storage and your course names on your device. It
collects nothing and has no server. The only requests it makes are folder previews, to your own
Blackboard site when you hover a folder, and a background image you choose. The source is open at
https://github.com/frostdev-ops/glaze.

Blackboard is a trademark of Anthology Inc. Glaze is an independent project and is not affiliated with,
endorsed by, or sponsored by Anthology Inc.

## Single-purpose statement

Glaze has one purpose: to customise how Blackboard Ultra pages look and read, according to the user's
chosen colors, layout, motion and display preferences. The optional helpers (countdowns, previews,
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

**web_accessible_resources: `theme.css`, `motion.css`, `extras.css`, `fonts/*.woff2`, `lib/scene.js`, `lib/three.min.js`**
The content script injects the stylesheets as `<link>`s it owns, so the master switch can add and remove
the theme without reloading the page; the stylesheets load the bundled fonts. When the user picks an
animated background, the content script imports `lib/scene.js`, which draws it with the bundled three.js
(`lib/three.min.js`, a minified build of the MIT-licensed library). Chrome requires these files be
web-accessible to be loaded this way.

## Remote code

None. All code ships in the package, three.js included (`lib/three.min.js`, built from the npm package
by `scripts/vendor-three.sh`).

## Screenshots (1280x800, up to 5)

`assets/store/screenshots/`, captured by `scripts/store-screenshots.js` from the packaged extension and
its built-in sample course (no real coursework), with the clock fixed at October 11, 2026:

1. `1-course-frost.jpg` — a themed course with countdowns, urgency, score bars and course progress.
2. `2-backgrounds-editor.jpg` — the background editor (a Lagoon mesh gradient) beside its live preview.
3. `3-extras-paper.jpg` — the Extras section in the light Paper palette.
4. `4-horizon-midnight.jpg` — the Horizon animated background in Dusk colors, Midnight palette.
5. `5-popup-ember.jpg` — the quick-controls popup over a course in Ember, with a gradient.

Rerun after visible UI changes: `NODE_PATH=<a node_modules with playwright> node scripts/store-screenshots.js`.

## Promo images

Prepared in `assets/store/`, rendered by the same script from `store/promo.html` (the logo over the
real Borealis background):

- `small-tile.png` — 440x280, required.
- `marquee.png` — 1400x560, optional, for featured placement.

## Privacy policy URL

https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md

## What's new in 2.0.3

For the Mac App Store's "What's New" field; the Chrome Web Store has none.

> Animated backgrounds: eight slow, soft scenes, from swaying northern lights to a lava lamp and a
> synthwave horizon, with one Intensity slider for how much they stand out. They pause in background
> tabs and hold still when motion is off.
>
> Gradients you can shape: linear, radial, conic or mesh, with angle, blend and spread, in your
> palette's colors, your own, or one of six ready-made sets. A faint grain keeps them smooth.
>
> Score bars, countdowns, folder previews and course progress are now on from the start.

