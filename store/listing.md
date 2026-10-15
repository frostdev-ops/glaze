# Chrome Web Store listing — Glaze

## Name

Glaze

## Short summary (132 char max)

> Restyle Blackboard Ultra and Canvas: palettes, fonts, backgrounds and motion, plus handy extras. Works at any school.

(116 characters.)

## Category

**Productivity.** Glaze is a look-and-feel customiser, not an assistive technology, so Accessibility
would overclaim — it makes no contrast or screen-reader guarantees.

## Detailed description

Blackboard Ultra looks the same at every institution, and you don't get a say in it. Glaze gives you one.

Pick a palette, or set all fourteen colors yourself, and every open Ultra tab updates as you choose. Save
your own palettes, or let Glaze switch between a light and a dark one with your system.

Then shape the rest:

• Look — fonts for text, headings and code, each previewed in its own face: readable faces like Lexend
  and OpenDyslexic, Google Fonts, Nerd Fonts, or any font by name; text size, line height, rounded
  corners, spacing, depth and frosted glass
• Background — solid; a smooth gradient you shape (linear, radial, conic or mesh; angle, blend and spread);
  a drifting aurora; your own image; or one of ten animated scenes, from northern lights to a lava lamp and a
  Halloween graveyard and pumpkin patch, with one Intensity slider for how much it stands out. In your palette's colors or your own.
• Motion — Off, Subtle or Expressive. Reduced-motion settings are respected automatically.
• Looks — ten ready-made combinations of palette, fonts, shape and background, one click each; give a
  course a Look of its own and its pages wear it
• Course colors — every course its own color, even where Ultra repeats one: blended into your palette or
  chosen one by one, on course pages, Messages, Grades and the calendar

Glaze also tidies Ultra itself: clearer buttons, a visible selected state on toggles, a readable
calendar, grade bands in the gradebook, and calmer assignment pages.

At-a-glance helpers, on from the start:

• Status beside every due date: "in 2 days · Unopened", "Submitted", "Submitted late", "Graded · 18/20", and grade percentages
• Score bars under gradebook scores
• Your overall grade on each course card, when your instructor shares it
• Folder previews: hover a folder to see what's inside and what's due
• Download all: save a folder's files as one zip
• Course progress: how much of a course you've completed
• New-grade badges on gradebook rows and course cards
• New-content badges: what your instructor added since you last looked, in the outline and on course cards
• What-if grade calculator: try scores for ungraded work, or see what you need for a target grade; your scores are kept until you clear them
• Due this week: what's left to do in the next seven days, in the popup and the command palette
• Remember your place: come back to a course and its folders are open and scrolled where you left them
• Typing backup: if the page reloads or your session times out before you post, get back what you wrote
• Focus mode for course documents: just the document, a reading-progress line and the reading time

More you can switch on:

• Dark documents: PDFs and file previews turned dark, colors kept
• Due-date urgency for overdue and soon-due items
• Keyboard shortcuts for courses, calendar, grades and messages, and a command palette (Ctrl+K) to jump
  to any course, item or setting
• Hide parts of the page you don't use

Everything lives in one editor page with a live preview; the popup keeps the quick controls. Share
your theme as a code a classmate can paste (it previews before it applies), and back up and restore
your settings as a file.

Glaze works on Blackboard Ultra and Canvas. On Canvas it themes the page (palettes, fonts, backgrounds, motion) and brings Due this week, the command palette and grades on course cards; the other extras are for Ultra. It works on any Blackboard Ultra deployment. Institutions self-host Ultra on their own domains, so
Glaze matches the path every Ultra install shares (/ultra/) rather than a fixed list of universities.

Privacy: Glaze stores your settings in Chrome's sync storage, including the course nicknames, colours, looks and tint you set, which
follow your Chrome sync when it's on; and the course names your LMS lists, which grades you've seen, where you were in
each course, your what-if scores, what's due this week and a backup of what you type (until it's posted, 14 days at most) on your
device. It
collects nothing and has no server. The only requests it makes go to your own Blackboard site, for folder
previews, for the files in a folder you choose to download, for which items you've submitted, opened or had graded, for your overall grade in each
course, for your course list and To Do list, and for calendar entries on the Calendar page; to Google Fonts or jsDelivr for a web
font you choose; and to a background image you choose. The source is open at
https://github.com/frostdev-ops/glaze.

Blackboard is a trademark of Anthology Inc. Glaze is an independent project and is not affiliated with,
endorsed by, or sponsored by Anthology Inc.

## Single-purpose statement

Glaze has one purpose: to customise how Blackboard Ultra pages look and read, according to the user's
chosen colors, layout, motion and display preferences, and to help the user keep track of and keep
their own coursework on those pages. The optional helpers (due-date status, grade badges, previews,
progress, due list, shortcuts) only present information already on the user's Blackboard pages; Download all saves
files the user can already open there, and the typing backup keeps a local copy of what the user writes
on those pages until it is posted. Every permission and every line of code serves that purpose.

## Permission justifications

**storage**
Saves the user's theme settings in `chrome.storage.sync`, so the theme persists across sessions and follows
Chrome sync between devices when it's on, including the per-course colours, looks, tint and nicknames the user sets
(nicknames are typed by the user); the names of the user's courses as the LMS lists them in
`chrome.storage.local`, on the device only, so the editor can list them for
recolouring; which grades and course items the user has seen, in `chrome.storage.local`, so new ones
can be marked; which folders were open and how far down the user was in each course's content, so
coming back restores it; hypothetical scores typed into the what-if calculator; and the user's own To
Do list for the next seven days, so the popup can show it;
and, with the typing backup on, a copy of what the user is writing in Blackboard's editors in
`chrome.storage.local`, deleted once it is posted or after 14 days. No other data is stored, and
nothing is sent anywhere.

**Host access: `https://*/ultra/*`**
Blackboard Ultra is self-hosted by each institution on its own arbitrary domain (for example
`learn.example.edu`, `blackboard.example.ac.uk`), with no common hostname. Every deployment serves the
Ultra interface under the `/ultra/` path, so that path is the narrowest match pattern that can reach the
pages the extension is for. The content script injects stylesheets, sets CSS custom properties on
`<html>`, and tags elements with `data-gz-*` attributes so they can be restyled. With optional helpers
on, it reads dates and grades already shown on the page to display due-date status and percentages, and
folder previews ask the same Blackboard site for a folder's contents, and Download all fetches the files
in a folder the user chooses from that site and zips them in the browser. Due-date status asks that site's
gradebook which of the user's items are submitted, late or graded, and new-grade badges ask it which
grades are new in the courses listed on the page, and card grades ask it for the user's overall grade
in each course shown on the Courses page. The command palette asks the site for the user's
course list and the current course's items, and new-content badges ask it for the items of the course
being viewed and of courses shown on the Courses and Grades pages. The due list asks it for the user's
To Do list for the next seven days, and on the Calendar page Glaze asks for the user's calendar entries
to color each by its course. Apart from a web font the user picks (downloaded from Google
Fonts or jsDelivr, without cookies or the page's address), nothing is sent anywhere else.

**Host access: `https://*.instructure.com/*`**
Most schools' Canvas LMS is hosted by Instructure under `*.instructure.com`. On those pages the content
script injects Glaze's Canvas stylesheet, sets CSS custom properties on `<html>` and tags elements with
`data-gz-*` attributes so they can be restyled. With its helpers on, it asks the same Canvas site, with
the user's session, for the user's planner items for the next seven days (the due list, kept in
`chrome.storage.local`), the user's active courses with their current scores (grades on course cards,
the command palette) and the current course's navigation tabs (the command palette). Nothing is sent
anywhere else.

**Host access: `https://*/*`, `scripting`**
Some schools serve Canvas from their own domain (for example `canvas.example.edu`), so no match pattern
can name it. A small content script (`lib/detect.js`) runs on https pages and checks only whether the
page's `<head>` links Canvas's own stylesheet (a path containing `/dist/brandable_css/`), stopping when
the body begins. When it does, the background injects the same theme script into that page with
`scripting.executeScript` and registers it for that one host with `scripting.registerContentScripts`, so
later pages there are themed from the first paint. The detector reads nothing else and sends no page
content; the only thing kept is that hostname, in `chrome.storage.local`. Nothing is sent anywhere.

**web_accessible_resources: `theme.css`, `motion.css`, `extras.css`, `canvas.css`, `fonts/*.woff2`, `lib/scene.js`, `lib/three.min.js`**
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

## What's new in 2.1.4

For the Mac App Store's "What's New" field; the Chrome Web Store has none.

> What's due this week, in the popup and the command palette. Give a course a Look of its own. Coming
> back to a course reopens your folders where you left them, and the what-if calculator keeps your
> scores. Every course its own color, on the calendar too. A new tiled popup, slide switches in the
> editor, and rounder corners throughout.

## What's new in 2.1

For the Mac App Store's "What's New" field; the Chrome Web Store has none.

> Fonts: about forty, each shown in its own face, for text, headings and code. Share your whole look
> with a classmate as one line of text.
>
> Due dates say where your work stands: "in 2 days · Unopened", "Submitted", "Submitted late",
> "Graded · 18/20". Grades show on your course cards, new grades and new course content get a badge
> that takes you straight to them, and a what-if calculator shows what you need on what's left.
>
> Press Ctrl+K (⌘K) to jump to any course or item. Download a whole folder as one zip. If your session
> times out mid-post, Glaze offers back what you wrote.
>
> Dark documents and focus mode for reading, course tint, settings search, and Glaze in Spanish,
> French, German, Brazilian Portuguese and Dutch.

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

